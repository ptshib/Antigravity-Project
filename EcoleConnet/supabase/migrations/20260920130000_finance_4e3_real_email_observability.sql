-- =============================================================================
-- ÉCOLECONNECT — MIGRATION FINANCE 4E-3A
-- Fichier: 20260920130000_finance_4e3_real_email_observability.sql
-- Description: RPCs de lecture et observabilité des e-mails réels (Readiness,
--              Dashboard de supervision et liste paginée des jobs).
-- Accès:       school_admin et finance_agent uniquement (SECURITY DEFINER,
--              owner postgres, search_path vide, pas de fuite de données sensibles).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RPC : get_school_real_email_readiness
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_real_email_readiness()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_profile public.profiles%ROWTYPE;
    v_school public.schools%ROWTYPE;
    v_global_config public.school_delivery_global_config%ROWTYPE;
    v_settings public.school_delivery_settings%ROWTYPE;

    v_global_enabled BOOLEAN := false;
    v_identity_verified BOOLEAN := false;
    v_identity_configured BOOLEAN := false;
    v_school_enabled BOOLEAN := false;
    v_effective_enabled BOOLEAN := false;

    v_quota INT := 100;
    v_from_name TEXT := NULL;
    v_reply_to TEXT := NULL;

    v_blockers JSONB := '[]'::jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated access' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id;
    IF v_profile.id IS NULL OR v_profile.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('school_admin', 'finance_agent') THEN
        RAISE EXCEPTION 'Forbidden: insufficient finance privileges' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
    IF v_school.id IS NULL OR v_school.status != 'active' THEN
        RAISE EXCEPTION 'Active school required' USING ERRCODE = '42501';
    END IF;

    -- 1. Configuration globale (Singleton ID = 1)
    SELECT * INTO v_global_config FROM public.school_delivery_global_config WHERE id = 1;
    IF v_global_config.id IS NOT NULL THEN
        v_global_enabled := COALESCE(v_global_config.real_email_enabled, false);
        v_identity_verified := COALESCE(v_global_config.sender_identity_verified, false);
        v_identity_configured := (v_global_config.verified_from_email IS NOT NULL AND pg_catalog.btrim(v_global_config.verified_from_email) != '');
    END IF;

    -- 2. Configuration spécifique établissement
    SELECT * INTO v_settings FROM public.school_delivery_settings WHERE school_id = v_profile.school_id;
    IF v_settings.school_id IS NOT NULL THEN
        v_school_enabled := COALESCE(v_settings.email_real_enabled, false);
        v_quota := COALESCE(v_settings.daily_email_quota, 100);
        IF v_settings.from_name IS NOT NULL AND pg_catalog.btrim(v_settings.from_name) != '' THEN
            v_from_name := pg_catalog.btrim(v_settings.from_name);
        END IF;
        IF v_settings.reply_to_email IS NOT NULL AND pg_catalog.btrim(v_settings.reply_to_email) != '' THEN
            v_reply_to := pg_catalog.btrim(v_settings.reply_to_email);
        END IF;
    END IF;

    -- 3. Évaluation du statut effectif
    v_effective_enabled := (
        v_global_enabled AND
        v_identity_verified AND
        v_identity_configured AND
        v_school_enabled
    );

    -- 4. Détermination déterministe et ordonnée des bloquants
    IF NOT v_global_enabled THEN
        v_blockers := v_blockers || pg_catalog.jsonb_build_array('GLOBAL_KILL_SWITCH_DISABLED');
    END IF;

    IF NOT v_identity_verified THEN
        v_blockers := v_blockers || pg_catalog.jsonb_build_array('SENDER_IDENTITY_NOT_VERIFIED');
    END IF;

    IF NOT v_identity_configured THEN
        v_blockers := v_blockers || pg_catalog.jsonb_build_array('SENDER_IDENTITY_NOT_CONFIGURED');
    END IF;

    IF v_settings.school_id IS NULL THEN
        v_blockers := v_blockers || pg_catalog.jsonb_build_array('SCHOOL_SETTINGS_NOT_CONFIGURED');
    ELSIF NOT v_school_enabled THEN
        v_blockers := v_blockers || pg_catalog.jsonb_build_array('SCHOOL_EMAIL_DISABLED');
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'school_id', v_profile.school_id,
        'provider', COALESCE(v_settings.email_provider, 'resend'),
        'global_real_email_enabled', v_global_enabled,
        'sender_identity_verified', v_identity_verified,
        'sender_identity_configured', v_identity_configured,
        'school_email_enabled', v_school_enabled,
        'effective_real_email_enabled', v_effective_enabled,
        'daily_email_quota', v_quota,
        'from_name', v_from_name,
        'reply_to_email', v_reply_to,
        'blockers', v_blockers
    );
END;
$$;

ALTER FUNCTION public.get_school_real_email_readiness() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_school_real_email_readiness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_real_email_readiness() TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. RPC : get_school_real_email_delivery_dashboard
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_real_email_delivery_dashboard(
    p_business_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_profile public.profiles%ROWTYPE;
    v_school public.schools%ROWTYPE;
    v_settings public.school_delivery_settings%ROWTYPE;
    v_ledger public.school_delivery_quota_ledger%ROWTYPE;

    v_valid_tz TEXT;
    v_tz_fallback BOOLEAN := false;
    v_today DATE;
    v_target_date DATE;

    v_daily_limit INT := 100;
    v_reserved_count INT := 0;
    v_submitted_count INT := 0;
    v_remaining_count INT := 100;

    -- Statuts Campagnes Real Email
    v_camp_total INT := 0;
    v_camp_draft INT := 0;
    v_camp_scheduled INT := 0;
    v_camp_processing INT := 0;
    v_camp_completed INT := 0;
    v_camp_partially_failed INT := 0;
    v_camp_failed INT := 0;
    v_camp_cancelled INT := 0;

    -- Statuts Jobs Outbox Real Email
    v_job_total INT := 0;
    v_job_pending INT := 0;
    v_job_claimed INT := 0;
    v_job_submitted INT := 0;
    v_job_network_unknown INT := 0;
    v_job_retry_wait INT := 0;
    v_job_terminal_failed INT := 0;
    v_job_delivery_confirmed INT := 0;
    v_job_bounced INT := 0;
    v_job_complained INT := 0;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated access' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id;
    IF v_profile.id IS NULL OR v_profile.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('school_admin', 'finance_agent') THEN
        RAISE EXCEPTION 'Forbidden: insufficient finance privileges' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
    IF v_school.id IS NULL OR v_school.status != 'active' THEN
        RAISE EXCEPTION 'Active school required' USING ERRCODE = '42501';
    END IF;

    -- Timezone et date métier
    IF v_school.timezone IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_school.timezone
    ) THEN
        v_valid_tz := v_school.timezone;
        v_tz_fallback := false;
    ELSE
        v_valid_tz := 'Africa/Kinshasa';
        v_tz_fallback := true;
    END IF;

    v_today := (pg_catalog.now() AT TIME ZONE v_valid_tz)::DATE;

    -- SÉMANTIQUE : p_business_date sélectionne la journée du quota ledger.
    -- Les compteurs 'campaigns' et 'jobs' ci-dessous représentent l'état courant
    -- tenant-scoped de toutes les campagnes/jobs REAL, indépendamment de leur date de création.
    IF p_business_date IS NULL THEN
        v_target_date := v_today;
    ELSE
        IF p_business_date > v_today THEN
            RAISE EXCEPTION 'REJET : Date métier future interdite.' USING ERRCODE = '22023';
        END IF;

        IF p_business_date < (v_today - INTERVAL '90 days')::DATE THEN
            RAISE EXCEPTION 'REJET : Date métier antérieure de plus de 90 jours interdite.' USING ERRCODE = '22023';
        END IF;
        v_target_date := p_business_date;
    END IF;

    -- Lecture Quota (spécifique à v_target_date)
    SELECT * INTO v_settings FROM public.school_delivery_settings WHERE school_id = v_profile.school_id;
    IF v_settings.school_id IS NOT NULL THEN
        v_daily_limit := COALESCE(v_settings.daily_email_quota, 100);
    END IF;

    SELECT * INTO v_ledger FROM public.school_delivery_quota_ledger
    WHERE school_id = v_profile.school_id AND business_date = v_target_date;

    IF v_ledger.school_id IS NOT NULL THEN
        v_reserved_count := COALESCE(v_ledger.reserved_count, 0);
        v_submitted_count := COALESCE(v_ledger.submitted_count, 0);
    END IF;

    v_remaining_count := GREATEST(v_daily_limit - v_reserved_count - v_submitted_count, 0);

    -- Agrégation Campagnes REAL (delivery_mode = 'real' ET channel = 'email')
    -- Compteurs courants tenant-scoped non-filtrés par date
    SELECT
        COUNT(*)::INT,
        COUNT(*) FILTER (WHERE status = 'draft')::INT,
        COUNT(*) FILTER (WHERE status = 'scheduled')::INT,
        COUNT(*) FILTER (WHERE status = 'processing')::INT,
        COUNT(*) FILTER (WHERE status = 'completed')::INT,
        COUNT(*) FILTER (WHERE status = 'partially_failed')::INT,
        COUNT(*) FILTER (WHERE status = 'failed')::INT,
        COUNT(*) FILTER (WHERE status = 'cancelled')::INT
    INTO
        v_camp_total,
        v_camp_draft,
        v_camp_scheduled,
        v_camp_processing,
        v_camp_completed,
        v_camp_partially_failed,
        v_camp_failed,
        v_camp_cancelled
    FROM public.school_collection_campaigns
    WHERE school_id = v_profile.school_id
      AND delivery_mode = 'real'
      AND channel = 'email';

    -- Agrégation Jobs Outbox Real Email (provider = 'resend')
    -- Compteurs courants tenant-scoped non-filtrés par date
    SELECT
        COUNT(*)::INT,
        COUNT(*) FILTER (WHERE state = 'pending')::INT,
        COUNT(*) FILTER (WHERE state = 'claimed')::INT,
        COUNT(*) FILTER (WHERE state = 'submitted')::INT,
        COUNT(*) FILTER (WHERE state = 'network_unknown')::INT,
        COUNT(*) FILTER (WHERE state = 'retry_wait')::INT,
        COUNT(*) FILTER (WHERE state = 'terminal_failed')::INT,
        COUNT(*) FILTER (WHERE state = 'delivery_confirmed')::INT,
        COUNT(*) FILTER (WHERE state = 'bounced')::INT,
        COUNT(*) FILTER (WHERE state = 'complained')::INT
    INTO
        v_job_total,
        v_job_pending,
        v_job_claimed,
        v_job_submitted,
        v_job_network_unknown,
        v_job_retry_wait,
        v_job_terminal_failed,
        v_job_delivery_confirmed,
        v_job_bounced,
        v_job_complained
    FROM public.school_collection_real_email_jobs
    WHERE school_id = v_profile.school_id
      AND provider = 'resend';

    RETURN pg_catalog.jsonb_build_object(
        'business_date', v_target_date::text,
        'timezone', v_valid_tz,
        'timezone_fallback_applied', v_tz_fallback,
        'quota', pg_catalog.jsonb_build_object(
            'daily_limit', v_daily_limit,
            'reserved_count', v_reserved_count,
            'submitted_count', v_submitted_count,
            'remaining_count', v_remaining_count
        ),
        'campaigns', pg_catalog.jsonb_build_object(
            'real_total_count', v_camp_total,
            'draft_count', v_camp_draft,
            'scheduled_count', v_camp_scheduled,
            'processing_count', v_camp_processing,
            'completed_count', v_camp_completed,
            'partially_failed_count', v_camp_partially_failed,
            'failed_count', v_camp_failed,
            'cancelled_count', v_camp_cancelled
        ),
        'jobs', pg_catalog.jsonb_build_object(
            'total_count', v_job_total,
            'pending_count', v_job_pending,
            'claimed_count', v_job_claimed,
            'submitted_count', v_job_submitted,
            'network_unknown_count', v_job_network_unknown,
            'retry_wait_count', v_job_retry_wait,
            'terminal_failed_count', v_job_terminal_failed,
            'delivery_confirmed_count', v_job_delivery_confirmed,
            'bounced_count', v_job_bounced,
            'complained_count', v_job_complained
        )
    );
END;
$$;

ALTER FUNCTION public.get_school_real_email_delivery_dashboard(DATE) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_school_real_email_delivery_dashboard(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_real_email_delivery_dashboard(DATE) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. RPC : get_school_real_email_delivery_jobs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_real_email_delivery_jobs(
    p_status TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_job_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_profile public.profiles%ROWTYPE;
    v_school public.schools%ROWTYPE;

    v_rec RECORD;
    v_items JSONB := '[]'::jsonb;
    v_count INT := 0;
    v_has_more BOOLEAN := false;
    v_next_cursor JSONB := NULL;
    v_last_created_at TIMESTAMPTZ;
    v_last_job_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated access' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id;
    IF v_profile.id IS NULL OR v_profile.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('school_admin', 'finance_agent') THEN
        RAISE EXCEPTION 'Forbidden: insufficient finance privileges' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
    IF v_school.id IS NULL OR v_school.status != 'active' THEN
        RAISE EXCEPTION 'Active school required' USING ERRCODE = '42501';
    END IF;

    -- Validation de p_limit
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'REJET : p_limit doit être compris entre 1 et 100.' USING ERRCODE = '22023';
    END IF;

    -- Validation du filtre de statut
    IF p_status IS NOT NULL AND p_status NOT IN (
        'pending', 'claimed', 'submitted', 'network_unknown',
        'retry_wait', 'terminal_failed', 'delivery_confirmed',
        'bounced', 'complained'
    ) THEN
        RAISE EXCEPTION 'REJET : Statut de filtre invalide.' USING ERRCODE = '22023';
    END IF;

    -- Validation stricte de la paire de curseurs
    IF (p_cursor_created_at IS NULL AND p_cursor_job_id IS NOT NULL)
       OR (p_cursor_created_at IS NOT NULL AND p_cursor_job_id IS NULL) THEN
        RAISE EXCEPTION 'REJET : La paire de curseurs doit être entièrement renseignée ou entièrement NULL.' USING ERRCODE = '22023';
    END IF;

    -- Requête Keyset N+1 avec tri (created_at DESC, id DESC)
    FOR v_rec IN
        SELECT
            j.id AS job_id,
            j.campaign_id,
            c.name AS campaign_name,
            r.invoice_id,
            COALESCE(r.invoice_snapshot->>'invoice_number', 'FAC-000') AS invoice_number,
            r.student_id,
            pg_catalog.btrim(COALESCE(r.student_snapshot->>'first_name', '') || ' ' || COALESCE(r.student_snapshot->>'last_name', '')) AS student_name,
            j.state AS status,
            j.attempt_count,
            j.first_provider_attempt_at,
            j.last_provider_attempt_at,
            (j.provider_message_id IS NOT NULL AND pg_catalog.btrim(j.provider_message_id) != '') AS provider_message_recorded,
            j.next_attempt_at,
            j.last_error_code,
            j.created_at,
            j.updated_at
        FROM public.school_collection_real_email_jobs j
        JOIN public.school_collection_campaigns c ON c.id = j.campaign_id
        JOIN public.school_collection_campaign_recipients r ON r.id = j.recipient_id
        WHERE j.school_id = v_profile.school_id
          AND j.provider = 'resend'
          AND (p_status IS NULL OR j.state = p_status)
          AND (
              p_cursor_created_at IS NULL
              OR (j.created_at, j.id) < (p_cursor_created_at, p_cursor_job_id)
          )
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT (p_limit + 1)
    LOOP
        v_count := v_count + 1;
        IF v_count <= p_limit THEN
            v_last_created_at := v_rec.created_at;
            v_last_job_id := v_rec.job_id;

            v_items := v_items || pg_catalog.jsonb_build_object(
                'job_id', v_rec.job_id,
                'campaign_id', v_rec.campaign_id,
                'campaign_name', v_rec.campaign_name,
                'invoice_id', v_rec.invoice_id,
                'invoice_number', v_rec.invoice_number,
                'student_id', v_rec.student_id,
                'student_name', v_rec.student_name,
                'status', v_rec.status,
                'attempt_count', v_rec.attempt_count,
                'first_provider_attempt_at', v_rec.first_provider_attempt_at,
                'last_provider_attempt_at', v_rec.last_provider_attempt_at,
                'provider_message_recorded', v_rec.provider_message_recorded,
                'next_attempt_at', v_rec.next_attempt_at,
                'last_error_code', v_rec.last_error_code,
                'created_at', v_rec.created_at,
                'updated_at', v_rec.updated_at
            );
        ELSE
            v_has_more := true;
        END IF;
    END LOOP;

    IF v_has_more THEN
        v_next_cursor := pg_catalog.jsonb_build_object(
            'created_at', v_last_created_at,
            'job_id', v_last_job_id
        );
    ELSE
        v_next_cursor := NULL;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'items', v_items,
        'has_more', v_has_more,
        'next_cursor', v_next_cursor
    );
END;
$$;

ALTER FUNCTION public.get_school_real_email_delivery_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_school_real_email_delivery_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_real_email_delivery_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) TO authenticated;
