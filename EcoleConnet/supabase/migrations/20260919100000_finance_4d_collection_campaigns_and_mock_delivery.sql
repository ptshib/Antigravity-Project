-- =============================================================================
-- ÉCOLECONNECT — MIGRATION FINANCE 4D-1R (DURCISSEMENT TECHNIQUE ET SÉCURITÉ)
-- Fichier: 20260919100000_finance_4d_collection_campaigns_and_mock_delivery.sql
-- Description: Schéma SQL, triggers d'immutabilité et d'intégrité tenant,
--              RPCs sécurisées (SHA-256, rôle parent strict, validations d'entrée)
--              et worker mock déterministe avec tentatives status success/failed.
-- =============================================================================

-- S'assurer que l'extension pgcrypto est disponible
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1. SCHÉMA DES TABLES
-- -----------------------------------------------------------------------------

-- 1.1 Table des campagnes
CREATE TABLE IF NOT EXISTS public.school_collection_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    name VARCHAR(120) NOT NULL,
    channel VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ NULL,
    claimed_at TIMESTAMPTZ NULL,
    claimed_by VARCHAR(100) NULL,
    processing_started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    idempotency_key UUID NOT NULL,
    payload_hash TEXT NOT NULL,
    filter_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    template_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    recipient_count INT NOT NULL DEFAULT 0,
    pending_count INT NOT NULL DEFAULT 0,
    processing_count INT NOT NULL DEFAULT 0,
    success_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT uq_campaign_school_idempotency UNIQUE (school_id, idempotency_key),
    CONSTRAINT chk_campaign_name_length CHECK (
        pg_catalog.length(pg_catalog.btrim(name)) >= 3 AND pg_catalog.length(name) <= 120
    ),
    CONSTRAINT chk_campaign_channel CHECK (channel IN ('sms', 'email', 'whatsapp')),
    CONSTRAINT chk_campaign_status CHECK (status IN ('draft', 'scheduled', 'processing', 'completed', 'partially_failed', 'failed', 'cancelled')),
    CONSTRAINT chk_campaign_recipient_count CHECK (recipient_count >= 0),
    CONSTRAINT chk_campaign_pending_count CHECK (pending_count >= 0),
    CONSTRAINT chk_campaign_processing_count CHECK (processing_count >= 0),
    CONSTRAINT chk_campaign_success_count CHECK (success_count >= 0),
    CONSTRAINT chk_campaign_failed_count CHECK (failed_count >= 0),
    CONSTRAINT chk_campaign_skipped_count CHECK (skipped_count >= 0),
    CONSTRAINT chk_campaign_counters_invariant CHECK (
        recipient_count = pending_count + processing_count + success_count + failed_count + skipped_count
    )
);

CREATE INDEX IF NOT EXISTS idx_campaigns_school_status
ON public.school_collection_campaigns (school_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_worker_claim
ON public.school_collection_campaigns (status, scheduled_at)
WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_campaigns_pagination
ON public.school_collection_campaigns (school_id, created_at DESC, id DESC);

ALTER TABLE public.school_collection_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_collection_campaigns FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_collection_campaigns FROM PUBLIC, anon, authenticated;
ALTER TABLE public.school_collection_campaigns OWNER TO postgres;

-- 1.2 Table des destinataires
CREATE TABLE IF NOT EXISTS public.school_collection_campaign_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.school_collection_campaigns(id) ON DELETE RESTRICT,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES public.student_invoices(id) ON DELETE RESTRICT,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
    parent_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    skip_reason VARCHAR(50) NULL,
    invoice_snapshot JSONB NOT NULL,
    student_snapshot JSONB NOT NULL,
    parent_snapshot JSONB NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ NULL,
    delivered_at TIMESTAMPTZ NULL,
    failed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT uq_recipient_campaign_invoice_parent UNIQUE (campaign_id, invoice_id, parent_profile_id),
    CONSTRAINT chk_recipient_delivery_status CHECK (delivery_status IN ('pending', 'processing', 'success', 'failed', 'skipped')),
    CONSTRAINT chk_recipient_skip_reason CHECK (
        skip_reason IS NULL OR skip_reason IN ('MISSING_CHANNEL_CONTACT', 'OPTED_OUT', 'PARENT_INACTIVE', 'INVALID_TARGET', 'CAMPAIGN_CANCELLED')
    ),
    CONSTRAINT chk_recipient_skip_consistency CHECK (
        (delivery_status = 'skipped' AND skip_reason IS NOT NULL) OR
        (delivery_status != 'skipped' AND skip_reason IS NULL)
    ),
    CONSTRAINT chk_recipient_attempt_count CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_recipients_campaign_lookup
ON public.school_collection_campaign_recipients (school_id, campaign_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_recipients_worker_process
ON public.school_collection_campaign_recipients (campaign_id, delivery_status)
WHERE delivery_status = 'pending';

ALTER TABLE public.school_collection_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_collection_campaign_recipients FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_collection_campaign_recipients FROM PUBLIC, anon, authenticated;
ALTER TABLE public.school_collection_campaign_recipients OWNER TO postgres;

-- 1.3 Table des tentatives de livraison (Append-only strict, status success/failed)
CREATE TABLE IF NOT EXISTS public.school_collection_delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES public.school_collection_campaign_recipients(id) ON DELETE RESTRICT,
    campaign_id UUID NOT NULL REFERENCES public.school_collection_campaigns(id) ON DELETE RESTRICT,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    attempt_number INT NOT NULL,
    provider VARCHAR(30) NOT NULL DEFAULT 'mock',
    provider_message_id VARCHAR(100) NULL,
    status VARCHAR(20) NOT NULL,
    error_code VARCHAR(50) NULL,
    error_message TEXT NULL,
    request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT uq_delivery_attempt_recipient_number UNIQUE (recipient_id, attempt_number),
    CONSTRAINT chk_delivery_attempt_number CHECK (attempt_number >= 1),
    CONSTRAINT chk_delivery_attempt_status CHECK (status IN ('success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_recipient_lookup
ON public.school_collection_delivery_attempts (school_id, recipient_id, attempt_number DESC);

ALTER TABLE public.school_collection_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_collection_delivery_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_collection_delivery_attempts FROM PUBLIC, anon, authenticated;
ALTER TABLE public.school_collection_delivery_attempts OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 2. TRIGGERS STRUCTURELS D'IMMUTABILITÉ ET D'INTÉGRITÉ TENANT
-- -----------------------------------------------------------------------------

-- 2.1 Trigger Append-Only strict sur school_collection_delivery_attempts
CREATE OR REPLACE FUNCTION public._prevent_delivery_attempts_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'REJET : La table school_collection_delivery_attempts est strictement append-only.'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_delivery_attempts_mutation ON public.school_collection_delivery_attempts;
CREATE TRIGGER trg_prevent_delivery_attempts_mutation
BEFORE UPDATE OR DELETE ON public.school_collection_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION public._prevent_delivery_attempts_mutation();

-- 2.2 Trigger Immutabilité sur school_collection_campaigns
CREATE OR REPLACE FUNCTION public._prevent_campaign_immutable_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'REJET : La suppression directe d une campagne est interdite.'
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.school_id IS DISTINCT FROM NEW.school_id OR
           OLD.created_by IS DISTINCT FROM NEW.created_by OR
           OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR
           OLD.payload_hash IS DISTINCT FROM NEW.payload_hash OR
           OLD.channel IS DISTINCT FROM NEW.channel OR
           OLD.filter_criteria IS DISTINCT FROM NEW.filter_criteria OR
           OLD.template_snapshot IS DISTINCT FROM NEW.template_snapshot THEN
            RAISE EXCEPTION 'REJET : Modification interdite des champs immuables de la campagne.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_campaign_immutable_mutation ON public.school_collection_campaigns;
CREATE TRIGGER trg_prevent_campaign_immutable_mutation
BEFORE UPDATE OR DELETE ON public.school_collection_campaigns
FOR EACH ROW EXECUTE FUNCTION public._prevent_campaign_immutable_mutation();

-- 2.3 Trigger Immutabilité sur school_collection_campaign_recipients
CREATE OR REPLACE FUNCTION public._prevent_recipient_immutable_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'REJET : La suppression directe d un destinataire de campagne est interdite.'
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.campaign_id IS DISTINCT FROM NEW.campaign_id OR
           OLD.school_id IS DISTINCT FROM NEW.school_id OR
           OLD.invoice_id IS DISTINCT FROM NEW.invoice_id OR
           OLD.student_id IS DISTINCT FROM NEW.student_id OR
           OLD.parent_profile_id IS DISTINCT FROM NEW.parent_profile_id OR
           OLD.invoice_snapshot IS DISTINCT FROM NEW.invoice_snapshot OR
           OLD.student_snapshot IS DISTINCT FROM NEW.student_snapshot OR
           OLD.parent_snapshot IS DISTINCT FROM NEW.parent_snapshot THEN
            RAISE EXCEPTION 'REJET : Modification interdite des snapshots ou identifiants d un destinataire.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_recipient_immutable_mutation ON public.school_collection_campaign_recipients;
CREATE TRIGGER trg_prevent_recipient_immutable_mutation
BEFORE UPDATE OR DELETE ON public.school_collection_campaign_recipients
FOR EACH ROW EXECUTE FUNCTION public._prevent_recipient_immutable_mutation();

-- 2.4 Trigger Intégrité Multi-Tenant sur school_collection_campaign_recipients
CREATE OR REPLACE FUNCTION public._validate_recipient_tenant_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_camp_school UUID;
    v_inv_school UUID;
    v_inv_student UUID;
    v_parent_school UUID;
    v_parent_role TEXT;
BEGIN
    SELECT school_id INTO v_camp_school
    FROM public.school_collection_campaigns
    WHERE id = NEW.campaign_id;

    IF v_camp_school IS NULL OR v_camp_school IS DISTINCT FROM NEW.school_id THEN
        RAISE EXCEPTION 'Incohérence intégrité recipient : la campagne n appartient pas à l établissement.'
            USING ERRCODE = '23514';
    END IF;

    SELECT school_id, student_id INTO v_inv_school, v_inv_student
    FROM public.student_invoices
    WHERE id = NEW.invoice_id;

    IF v_inv_school IS NULL OR v_inv_school IS DISTINCT FROM NEW.school_id OR v_inv_student IS DISTINCT FROM NEW.student_id THEN
        RAISE EXCEPTION 'Incohérence intégrité recipient : la facture n appartient pas à l établissement ou à l élève du destinataire.'
            USING ERRCODE = '23514';
    END IF;

    SELECT school_id, role INTO v_parent_school, v_parent_role
    FROM public.profiles
    WHERE id = NEW.parent_profile_id;

    IF v_parent_school IS NULL OR v_parent_school IS DISTINCT FROM NEW.school_id OR v_parent_role IS DISTINCT FROM 'parent' THEN
        RAISE EXCEPTION 'Incohérence intégrité recipient : le profil parent n appartient pas à l établissement ou n a pas le rôle parent.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_recipient_tenant_integrity ON public.school_collection_campaign_recipients;
CREATE TRIGGER trg_validate_recipient_tenant_integrity
BEFORE INSERT ON public.school_collection_campaign_recipients
FOR EACH ROW EXECUTE FUNCTION public._validate_recipient_tenant_integrity();

-- 2.5 Trigger Intégrité Multi-Tenant sur school_collection_delivery_attempts
CREATE OR REPLACE FUNCTION public._validate_attempt_tenant_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rec_school UUID;
    v_rec_camp UUID;
BEGIN
    SELECT school_id, campaign_id INTO v_rec_school, v_rec_camp
    FROM public.school_collection_campaign_recipients
    WHERE id = NEW.recipient_id;

    IF v_rec_school IS DISTINCT FROM NEW.school_id OR v_rec_camp IS DISTINCT FROM NEW.campaign_id THEN
        RAISE EXCEPTION 'Incohérence multi-tenant : school_id ou campaign_id de la tentative différent du destinataire.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_attempt_tenant_integrity ON public.school_collection_delivery_attempts;
CREATE TRIGGER trg_validate_attempt_tenant_integrity
BEFORE INSERT ON public.school_collection_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION public._validate_attempt_tenant_integrity();

-- -----------------------------------------------------------------------------
-- 3. RPCs PUBLIQUES SÉCURISÉES
-- -----------------------------------------------------------------------------

-- 3.1 RPC: preview_school_collection_campaign
CREATE OR REPLACE FUNCTION public.preview_school_collection_campaign(
    p_channel TEXT,
    p_template TEXT,
    p_currency TEXT DEFAULT NULL,
    p_priority TEXT DEFAULT NULL,
    p_min_days_overdue INTEGER DEFAULT NULL,
    p_max_days_overdue INTEGER DEFAULT NULL,
    p_class_ids UUID[] DEFAULT NULL
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
    v_valid_tz TEXT;
    v_business_date DATE;
    v_template TEXT;
    v_target_invoices_count INT := 0;
    v_total_eligible_recipients INT := 0;
    v_total_skipped_recipients INT := 0;
    v_total_overdue_amount NUMERIC := 0.00;
    v_preview_recipients JSONB := '[]'::jsonb;
    v_inv RECORD;
    v_parent RECORD;
    v_contact TEXT;
    v_is_eligible BOOLEAN;
    v_skip_reason TEXT;
    v_invoice_had_parent BOOLEAN;
BEGIN
    -- Authentification et profil
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

    IF v_school.timezone IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_school.timezone
    ) THEN
        v_valid_tz := v_school.timezone;
    ELSE
        v_valid_tz := 'Africa/Kinshasa';
    END IF;
    v_business_date := (pg_catalog.now() AT TIME ZONE v_valid_tz)::DATE;

    -- Validations d'entrée strictes
    IF p_channel IS NULL OR p_channel NOT IN ('sms', 'email', 'whatsapp') THEN
        RAISE EXCEPTION 'REJET : Canal invalide (sms, email, whatsapp requis).' USING ERRCODE = '22023';
    END IF;

    IF p_template IS NULL THEN
        RAISE EXCEPTION 'REJET : Le modèle de message p_template ne peut pas être NULL.' USING ERRCODE = '22023';
    END IF;

    v_template := pg_catalog.btrim(p_template);
    IF pg_catalog.length(v_template) < 10 OR pg_catalog.length(p_template) > 2000 THEN
        RAISE EXCEPTION 'REJET : Le modèle de message doit contenir entre 10 et 2000 caractères.' USING ERRCODE = '22023';
    END IF;

    IF p_currency IS NOT NULL AND p_currency NOT IN ('USD', 'CDF') THEN
        RAISE EXCEPTION 'REJET : Devise non supportée (USD ou CDF requis).' USING ERRCODE = '22023';
    END IF;

    IF p_priority IS NOT NULL AND p_priority NOT IN ('P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW', 'critical', 'high', 'normal') THEN
        RAISE EXCEPTION 'REJET : Niveau de priorité invalide.' USING ERRCODE = '22023';
    END IF;

    IF p_min_days_overdue IS NOT NULL AND p_min_days_overdue < 1 THEN
        RAISE EXCEPTION 'REJET : p_min_days_overdue doit être supérieur ou égal à 1.' USING ERRCODE = '22023';
    END IF;

    IF p_max_days_overdue IS NOT NULL AND p_max_days_overdue < 1 THEN
        RAISE EXCEPTION 'REJET : p_max_days_overdue doit être supérieur ou égal à 1.' USING ERRCODE = '22023';
    END IF;

    IF p_min_days_overdue IS NOT NULL AND p_max_days_overdue IS NOT NULL AND p_min_days_overdue > p_max_days_overdue THEN
        RAISE EXCEPTION 'REJET : p_min_days_overdue ne peut pas être supérieur à p_max_days_overdue.' USING ERRCODE = '22023';
    END IF;

    -- Parcours des factures échues filtrées
    FOR v_inv IN
        SELECT
            inv.id AS invoice_id,
            inv.invoice_number,
            inv.student_id,
            inv.due_date,
            (v_business_date - inv.due_date)::INTEGER AS days_overdue,
            inv.currency,
            inv.total_amount,
            inv.paid_amount,
            inv.remaining_balance,
            st.student_number,
            pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_name,
            c.name AS class_name,
            CASE
                WHEN (v_business_date - inv.due_date) >= 90 THEN 'P1_CRITICAL'
                WHEN (v_business_date - inv.due_date) >= 60 THEN 'P2_HIGH'
                WHEN (v_business_date - inv.due_date) >= 30 THEN 'P3_MEDIUM'
                ELSE 'P4_LOW'
            END AS calculated_priority
        FROM public.student_invoices inv
        JOIN public.students st ON st.id = inv.student_id AND st.school_id = inv.school_id
        JOIN public.classes c ON c.id = inv.class_id AND c.school_id = inv.school_id
        WHERE inv.school_id = v_profile.school_id
          AND inv.status IN ('issued', 'partially_paid')
          AND inv.remaining_balance > 0
          AND inv.due_date < v_business_date
          AND (p_currency IS NULL OR inv.currency = p_currency)
          AND (p_min_days_overdue IS NULL OR (v_business_date - inv.due_date)::INTEGER >= p_min_days_overdue)
          AND (p_max_days_overdue IS NULL OR (v_business_date - inv.due_date)::INTEGER <= p_max_days_overdue)
          AND (p_class_ids IS NULL OR inv.class_id = ANY(p_class_ids))
        ORDER BY inv.due_date ASC, inv.id ASC
    LOOP
        IF p_priority IS NOT NULL AND (
            v_inv.calculated_priority = p_priority OR
            (p_priority = 'critical' AND v_inv.calculated_priority = 'P1_CRITICAL') OR
            (p_priority = 'high' AND v_inv.calculated_priority = 'P2_HIGH') OR
            (p_priority = 'normal' AND v_inv.calculated_priority IN ('P3_MEDIUM', 'P4_LOW'))
        ) = FALSE THEN
            CONTINUE;
        END IF;

        v_invoice_had_parent := FALSE;

        -- Recherche des parents liés éligibles (Rôle parent strict + Consentement)
        FOR v_parent IN
            SELECT
                psl.parent_profile_id,
                pg_catalog.btrim(pg_catalog.concat_ws(' ', pr.first_name, pr.last_name)) AS parent_name,
                pr.phone AS parent_phone,
                u.email AS parent_email
            FROM public.parent_student_links psl
            JOIN public.profiles pr ON pr.id = psl.parent_profile_id AND pr.school_id = psl.school_id
            LEFT JOIN auth.users u ON u.id = pr.id
            WHERE psl.school_id = v_profile.school_id
              AND psl.student_id = v_inv.student_id
              AND psl.status = 'approved'
              AND psl.can_receive_notifications = TRUE
              AND pr.is_active = TRUE
              AND pr.role = 'parent'
            ORDER BY psl.id ASC
        LOOP
            v_invoice_had_parent := TRUE;

            IF p_channel = 'email' THEN
                v_contact := pg_catalog.btrim(COALESCE(v_parent.parent_email, ''));
            ELSE
                v_contact := pg_catalog.btrim(COALESCE(v_parent.parent_phone, ''));
            END IF;

            IF v_contact IS NULL OR v_contact = '' THEN
                v_is_eligible := FALSE;
                v_skip_reason := 'MISSING_CHANNEL_CONTACT';
                v_total_skipped_recipients := v_total_skipped_recipients + 1;
            ELSE
                v_is_eligible := TRUE;
                v_skip_reason := NULL;
                v_total_eligible_recipients := v_total_eligible_recipients + 1;
            END IF;

            v_preview_recipients := v_preview_recipients || pg_catalog.jsonb_build_object(
                'invoice_id', v_inv.invoice_id,
                'invoice_number', v_inv.invoice_number,
                'student_id', v_inv.student_id,
                'student_name', v_inv.student_name,
                'parent_profile_id', v_parent.parent_profile_id,
                'parent_name', v_parent.parent_name,
                'channel_contact', v_contact,
                'remaining_balance', v_inv.remaining_balance,
                'currency', v_inv.currency,
                'days_overdue', v_inv.days_overdue,
                'is_eligible', v_is_eligible,
                'skip_reason', v_skip_reason
            );
        END LOOP;

        IF v_invoice_had_parent THEN
            v_target_invoices_count := v_target_invoices_count + 1;
            v_total_overdue_amount := v_total_overdue_amount + v_inv.remaining_balance;
        END IF;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'channel', p_channel,
        'currency', p_currency,
        'target_invoices_count', v_target_invoices_count,
        'total_eligible_recipients', v_total_eligible_recipients,
        'total_skipped_recipients', v_total_skipped_recipients,
        'total_overdue_amount', v_total_overdue_amount,
        'preview_recipients', v_preview_recipients
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_school_collection_campaign TO authenticated;
REVOKE ALL ON FUNCTION public.preview_school_collection_campaign FROM PUBLIC, anon;

-- 3.1.2 Helper: _canonical_campaign_hash
CREATE OR REPLACE FUNCTION public._canonical_campaign_hash(
    p_name TEXT,
    p_channel TEXT,
    p_template TEXT,
    p_currency TEXT DEFAULT NULL,
    p_priority TEXT DEFAULT NULL,
    p_min_days_overdue INTEGER DEFAULT NULL,
    p_max_days_overdue INTEGER DEFAULT NULL,
    p_class_ids UUID[] DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sorted_distinct_class_ids UUID[] := NULL;
    v_canonical_jsonb JSONB;
BEGIN
    IF p_class_ids IS NOT NULL AND pg_catalog.array_length(p_class_ids, 1) > 0 THEN
        SELECT pg_catalog.array_agg(elem ORDER BY elem)
        INTO v_sorted_distinct_class_ids
        FROM (
            SELECT DISTINCT unnest(p_class_ids) AS elem
        ) s;
    ELSE
        v_sorted_distinct_class_ids := NULL;
    END IF;

    v_canonical_jsonb := pg_catalog.jsonb_build_object(
        'name', pg_catalog.lower(pg_catalog.btrim(p_name)),
        'channel', pg_catalog.lower(pg_catalog.btrim(p_channel)),
        'template', pg_catalog.btrim(p_template),
        'currency', CASE
            WHEN p_currency IS NULL THEN NULL
            ELSE pg_catalog.upper(pg_catalog.btrim(p_currency))
        END,
        'priority', CASE
            WHEN p_priority IS NULL THEN NULL
            ELSE pg_catalog.lower(pg_catalog.btrim(p_priority))
        END,
        'min_days_overdue', p_min_days_overdue,
        'max_days_overdue', p_max_days_overdue,
        'class_ids', pg_catalog.to_jsonb(v_sorted_distinct_class_ids)
    );

    RETURN pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(v_canonical_jsonb::text, 'UTF8'),
            'sha256'
        ),
        'hex'
    );
END;
$$;

REVOKE ALL ON FUNCTION public._canonical_campaign_hash FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public._canonical_campaign_hash OWNER TO postgres;

-- 3.2 RPC: create_school_collection_campaign (Idempotence SHA-256 + tri class_ids)
CREATE OR REPLACE FUNCTION public.create_school_collection_campaign(
    p_name TEXT,
    p_channel TEXT,
    p_template TEXT,
    p_idempotency_key UUID,
    p_currency TEXT DEFAULT NULL,
    p_priority TEXT DEFAULT NULL,
    p_min_days_overdue INTEGER DEFAULT NULL,
    p_max_days_overdue INTEGER DEFAULT NULL,
    p_class_ids UUID[] DEFAULT NULL
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
    v_valid_tz TEXT;
    v_business_date DATE;
    v_name TEXT;
    v_template TEXT;
    v_payload_hash TEXT;
    v_existing_campaign public.school_collection_campaigns%ROWTYPE;
    v_campaign_id UUID;
    v_inv RECORD;
    v_parent RECORD;
    v_contact TEXT;
    v_is_eligible BOOLEAN;
    v_skip_reason TEXT;
    v_recipient_count INT := 0;
    v_pending_count INT := 0;
    v_skipped_count INT := 0;
BEGIN
    -- Authentification et profil
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

    IF v_school.timezone IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_school.timezone
    ) THEN
        v_valid_tz := v_school.timezone;
    ELSE
        v_valid_tz := 'Africa/Kinshasa';
    END IF;
    v_business_date := (pg_catalog.now() AT TIME ZONE v_valid_tz)::DATE;

    -- Validations strictes
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'REJET : La clé d idempotence p_idempotency_key est obligatoire.' USING ERRCODE = '22023';
    END IF;

    IF p_name IS NULL THEN
        RAISE EXCEPTION 'REJET : Le nom de la campagne p_name ne peut pas être NULL.' USING ERRCODE = '22023';
    END IF;
    v_name := pg_catalog.btrim(p_name);
    IF pg_catalog.length(v_name) < 3 OR pg_catalog.length(p_name) > 120 THEN
        RAISE EXCEPTION 'REJET : Le nom de la campagne doit contenir entre 3 et 120 caractères.' USING ERRCODE = '22023';
    END IF;

    IF p_channel IS NULL OR p_channel NOT IN ('sms', 'email', 'whatsapp') THEN
        RAISE EXCEPTION 'REJET : Canal invalide (sms, email, whatsapp requis).' USING ERRCODE = '22023';
    END IF;

    IF p_template IS NULL THEN
        RAISE EXCEPTION 'REJET : Le modèle de message p_template ne peut pas être NULL.' USING ERRCODE = '22023';
    END IF;

    v_template := pg_catalog.btrim(p_template);
    IF pg_catalog.length(v_template) < 10 OR pg_catalog.length(p_template) > 2000 THEN
        RAISE EXCEPTION 'REJET : Le modèle de message doit contenir entre 10 et 2000 caractères.' USING ERRCODE = '22023';
    END IF;

    IF p_currency IS NOT NULL AND p_currency NOT IN ('USD', 'CDF') THEN
        RAISE EXCEPTION 'REJET : Devise non supportée (USD ou CDF requis).' USING ERRCODE = '22023';
    END IF;

    IF p_priority IS NOT NULL AND p_priority NOT IN ('P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW', 'critical', 'high', 'normal') THEN
        RAISE EXCEPTION 'REJET : Niveau de priorité invalide.' USING ERRCODE = '22023';
    END IF;

    IF p_min_days_overdue IS NOT NULL AND p_min_days_overdue < 1 THEN
        RAISE EXCEPTION 'REJET : p_min_days_overdue doit être supérieur ou égal à 1.' USING ERRCODE = '22023';
    END IF;

    IF p_max_days_overdue IS NOT NULL AND p_max_days_overdue < 1 THEN
        RAISE EXCEPTION 'REJET : p_max_days_overdue doit être supérieur ou égal à 1.' USING ERRCODE = '22023';
    END IF;

    IF p_min_days_overdue IS NOT NULL AND p_max_days_overdue IS NOT NULL AND p_min_days_overdue > p_max_days_overdue THEN
        RAISE EXCEPTION 'REJET : p_min_days_overdue ne peut pas être supérieur à p_max_days_overdue.' USING ERRCODE = '22023';
    END IF;

    -- Empreinte SHA-256 canonique du payload via le helper privé _canonical_campaign_hash
    v_payload_hash := public._canonical_campaign_hash(
        p_name,
        p_channel,
        p_template,
        p_currency,
        p_priority,
        p_min_days_overdue,
        p_max_days_overdue,
        p_class_ids
    );

    -- Contrôle d'Idempotence (Détection de rejeu)
    SELECT * INTO v_existing_campaign
    FROM public.school_collection_campaigns
    WHERE school_id = v_profile.school_id AND idempotency_key = p_idempotency_key;

    IF v_existing_campaign.id IS NOT NULL THEN
        IF v_existing_campaign.payload_hash = v_payload_hash THEN
            RETURN public.get_school_collection_campaign(v_existing_campaign.id)
                || pg_catalog.jsonb_build_object('is_idempotent_replay', true);
        ELSE
            RAISE EXCEPTION 'REJET : Clé idempotence déjà utilisée avec un payload différent.' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Insertion de la campagne (draft)
    BEGIN
        INSERT INTO public.school_collection_campaigns (
            school_id,
            name,
            channel,
            status,
            created_by,
            idempotency_key,
            payload_hash,
            filter_criteria,
            template_snapshot,
            recipient_count,
            pending_count,
            processing_count,
            success_count,
            failed_count,
            skipped_count
        ) VALUES (
            v_profile.school_id,
            v_name,
            p_channel,
            'draft',
            v_profile.id,
            p_idempotency_key,
            v_payload_hash,
            pg_catalog.jsonb_build_object(
                'currency', p_currency,
                'priority', p_priority,
                'min_days_overdue', p_min_days_overdue,
                'max_days_overdue', p_max_days_overdue,
                'class_ids', p_class_ids
            ),
            pg_catalog.jsonb_build_object('raw', v_template),
            0, 0, 0, 0, 0, 0
        )
        RETURNING id INTO v_campaign_id;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT * INTO v_existing_campaign
            FROM public.school_collection_campaigns
            WHERE school_id = v_profile.school_id AND idempotency_key = p_idempotency_key;

            IF v_existing_campaign.id IS NOT NULL AND v_existing_campaign.payload_hash = v_payload_hash THEN
                RETURN public.get_school_collection_campaign(v_existing_campaign.id)
                    || pg_catalog.jsonb_build_object('is_idempotent_replay', true);
            ELSE
                RAISE EXCEPTION 'REJET : Clé idempotence déjà utilisée avec un payload différent.' USING ERRCODE = '22023';
            END IF;
    END;

    -- Insertion des destinataires et création des snapshots
    FOR v_inv IN
        SELECT
            inv.id AS invoice_id,
            inv.invoice_number,
            inv.student_id,
            inv.due_date,
            (v_business_date - inv.due_date)::INTEGER AS days_overdue,
            inv.currency,
            inv.total_amount,
            inv.paid_amount,
            inv.remaining_balance,
            st.student_number,
            st.first_name AS student_first_name,
            st.last_name AS student_last_name,
            c.name AS class_name,
            CASE
                WHEN (v_business_date - inv.due_date) >= 90 THEN 'P1_CRITICAL'
                WHEN (v_business_date - inv.due_date) >= 60 THEN 'P2_HIGH'
                WHEN (v_business_date - inv.due_date) >= 30 THEN 'P3_MEDIUM'
                ELSE 'P4_LOW'
            END AS calculated_priority
        FROM public.student_invoices inv
        JOIN public.students st ON st.id = inv.student_id AND st.school_id = inv.school_id
        JOIN public.classes c ON c.id = inv.class_id AND c.school_id = inv.school_id
        WHERE inv.school_id = v_profile.school_id
          AND inv.status IN ('issued', 'partially_paid')
          AND inv.remaining_balance > 0
          AND inv.due_date < v_business_date
          AND (p_currency IS NULL OR inv.currency = p_currency)
          AND (p_min_days_overdue IS NULL OR (v_business_date - inv.due_date)::INTEGER >= p_min_days_overdue)
          AND (p_max_days_overdue IS NULL OR (v_business_date - inv.due_date)::INTEGER <= p_max_days_overdue)
          AND (p_class_ids IS NULL OR inv.class_id = ANY(p_class_ids))
        ORDER BY inv.due_date ASC, inv.id ASC
    LOOP
        IF p_priority IS NOT NULL AND (
            v_inv.calculated_priority = p_priority OR
            (p_priority = 'critical' AND v_inv.calculated_priority = 'P1_CRITICAL') OR
            (p_priority = 'high' AND v_inv.calculated_priority = 'P2_HIGH') OR
            (p_priority = 'normal' AND v_inv.calculated_priority IN ('P3_MEDIUM', 'P4_LOW'))
        ) = FALSE THEN
            CONTINUE;
        END IF;

        FOR v_parent IN
            SELECT
                psl.parent_profile_id,
                pr.first_name AS parent_first_name,
                pr.last_name AS parent_last_name,
                pr.phone AS parent_phone,
                u.email AS parent_email
            FROM public.parent_student_links psl
            JOIN public.profiles pr ON pr.id = psl.parent_profile_id AND pr.school_id = psl.school_id
            LEFT JOIN auth.users u ON u.id = pr.id
            WHERE psl.school_id = v_profile.school_id
              AND psl.student_id = v_inv.student_id
              AND psl.status = 'approved'
              AND psl.can_receive_notifications = TRUE
              AND pr.is_active = TRUE
              AND pr.role = 'parent'
            ORDER BY psl.id ASC
        LOOP
            IF p_channel = 'email' THEN
                v_contact := pg_catalog.btrim(COALESCE(v_parent.parent_email, ''));
            ELSE
                v_contact := pg_catalog.btrim(COALESCE(v_parent.parent_phone, ''));
            END IF;

            IF v_contact IS NULL OR v_contact = '' THEN
                v_is_eligible := FALSE;
                v_skip_reason := 'MISSING_CHANNEL_CONTACT';
                v_skipped_count := v_skipped_count + 1;
            ELSE
                v_is_eligible := TRUE;
                v_skip_reason := NULL;
                v_pending_count := v_pending_count + 1;
            END IF;
            v_recipient_count := v_recipient_count + 1;

            INSERT INTO public.school_collection_campaign_recipients (
                campaign_id,
                school_id,
                invoice_id,
                student_id,
                parent_profile_id,
                delivery_status,
                skip_reason,
                invoice_snapshot,
                student_snapshot,
                parent_snapshot
            ) VALUES (
                v_campaign_id,
                v_profile.school_id,
                v_inv.invoice_id,
                v_inv.student_id,
                v_parent.parent_profile_id,
                CASE WHEN v_is_eligible THEN 'pending' ELSE 'skipped' END,
                v_skip_reason,
                pg_catalog.jsonb_build_object(
                    'invoice_number', v_inv.invoice_number,
                    'total_amount', v_inv.total_amount,
                    'paid_amount', v_inv.paid_amount,
                    'remaining_balance', v_inv.remaining_balance,
                    'due_date', v_inv.due_date,
                    'currency', v_inv.currency
                ),
                pg_catalog.jsonb_build_object(
                    'student_number', v_inv.student_number,
                    'first_name', v_inv.student_first_name,
                    'last_name', v_inv.student_last_name,
                    'class_name', v_inv.class_name
                ),
                pg_catalog.jsonb_build_object(
                    'parent_profile_id', v_parent.parent_profile_id,
                    'first_name', v_parent.parent_first_name,
                    'last_name', v_parent.parent_last_name,
                    'email', v_parent.parent_email,
                    'phone', v_parent.parent_phone,
                    'channel_contact', v_contact
                )
            );
        END LOOP;
    END LOOP;

    -- Mise à jour des compteurs de la campagne
    UPDATE public.school_collection_campaigns
    SET recipient_count = v_recipient_count,
        pending_count = v_pending_count,
        skipped_count = v_skipped_count,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_campaign_id;

    RETURN public.get_school_collection_campaign(v_campaign_id)
        || pg_catalog.jsonb_build_object('is_idempotent_replay', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_school_collection_campaign TO authenticated;
REVOKE ALL ON FUNCTION public.create_school_collection_campaign FROM PUBLIC, anon;

-- 3.3 RPC: get_school_collection_campaigns (Validation stricte paire curseur)
CREATE OR REPLACE FUNCTION public.get_school_collection_campaigns(
    p_status TEXT DEFAULT NULL,
    p_channel TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL
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
    v_limit INT;
    v_rows JSONB := '[]'::jsonb;
    v_count INT := 0;
    v_has_more BOOLEAN := FALSE;
    v_next_cursor_created_at TIMESTAMPTZ := NULL;
    v_next_cursor_id UUID := NULL;
    v_rec RECORD;
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

    v_limit := COALESCE(p_limit, 20);
    IF v_limit < 1 OR v_limit > 100 THEN
        v_limit := 20;
    END IF;

    -- Validation d'intégrité de la paire de curseur Keyset
    IF (p_cursor_created_at IS NOT NULL AND p_cursor_id IS NULL) OR
       (p_cursor_created_at IS NULL AND p_cursor_id IS NOT NULL) THEN
        RAISE EXCEPTION 'REJET : Les curseurs p_cursor_created_at et p_cursor_id doivent être tous les deux fournis ou tous les deux NULL.'
            USING ERRCODE = '22023';
    END IF;

    FOR v_rec IN
        SELECT
            c.id,
            c.school_id,
            c.name,
            c.channel,
            c.status,
            c.scheduled_at,
            c.claimed_at,
            c.claimed_by,
            c.processing_started_at,
            c.completed_at,
            c.created_by,
            c.idempotency_key,
            c.filter_criteria,
            c.template_snapshot,
            c.recipient_count,
            c.pending_count,
            c.processing_count,
            c.success_count,
            c.failed_count,
            c.skipped_count,
            c.created_at,
            c.updated_at
        FROM public.school_collection_campaigns c
        WHERE c.school_id = v_profile.school_id
          AND (p_status IS NULL OR c.status = p_status)
          AND (p_channel IS NULL OR c.channel = p_channel)
          AND (
            p_cursor_created_at IS NULL
            OR c.created_at < p_cursor_created_at
            OR (c.created_at = p_cursor_created_at AND c.id < p_cursor_id)
          )
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT v_limit + 1
    LOOP
        v_count := v_count + 1;
        IF v_count > v_limit THEN
            v_has_more := TRUE;
            EXIT;
        END IF;

        v_next_cursor_created_at := v_rec.created_at;
        v_next_cursor_id := v_rec.id;

        v_rows := v_rows || pg_catalog.jsonb_build_object(
            'id', v_rec.id,
            'school_id', v_rec.school_id,
            'name', v_rec.name,
            'channel', v_rec.channel,
            'status', v_rec.status,
            'scheduled_at', v_rec.scheduled_at,
            'claimed_at', v_rec.claimed_at,
            'claimed_by', v_rec.claimed_by,
            'processing_started_at', v_rec.processing_started_at,
            'completed_at', v_rec.completed_at,
            'created_by', v_rec.created_by,
            'idempotency_key', v_rec.idempotency_key,
            'filter_criteria', v_rec.filter_criteria,
            'template_snapshot', v_rec.template_snapshot,
            'recipient_count', v_rec.recipient_count,
            'pending_count', v_rec.pending_count,
            'processing_count', v_rec.processing_count,
            'success_count', v_rec.success_count,
            'failed_count', v_rec.failed_count,
            'skipped_count', v_rec.skipped_count,
            'created_at', v_rec.created_at,
            'updated_at', v_rec.updated_at
        );
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'campaigns', v_rows,
        'has_more', v_has_more,
        'next_cursor_created_at', CASE WHEN v_has_more THEN v_next_cursor_created_at ELSE NULL END,
        'next_cursor_id', CASE WHEN v_has_more THEN v_next_cursor_id ELSE NULL END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_collection_campaigns TO authenticated;
REVOKE ALL ON FUNCTION public.get_school_collection_campaigns FROM PUBLIC, anon;

-- 3.4 RPC: get_school_collection_campaign
CREATE OR REPLACE FUNCTION public.get_school_collection_campaign(
    p_campaign_id UUID,
    p_recipients_limit INTEGER DEFAULT 50,
    p_cursor_recipient_id UUID DEFAULT NULL
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
    v_campaign public.school_collection_campaigns%ROWTYPE;
    v_limit INT;
    v_recipients JSONB := '[]'::jsonb;
    v_count INT := 0;
    v_has_more BOOLEAN := FALSE;
    v_next_cursor_id UUID := NULL;
    v_rec RECORD;
    v_latest_attempt JSONB;
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

    SELECT * INTO v_campaign
    FROM public.school_collection_campaigns
    WHERE id = p_campaign_id AND school_id = v_profile.school_id;

    IF v_campaign.id IS NULL THEN
        RAISE EXCEPTION 'Campagne introuvable' USING ERRCODE = 'P0002';
    END IF;

    v_limit := COALESCE(p_recipients_limit, 50);
    IF v_limit < 1 OR v_limit > 200 THEN
        v_limit := 50;
    END IF;

    FOR v_rec IN
        SELECT
            r.id,
            r.campaign_id,
            r.invoice_id,
            r.student_id,
            r.parent_profile_id,
            r.delivery_status,
            r.skip_reason,
            r.invoice_snapshot,
            r.student_snapshot,
            r.parent_snapshot,
            r.attempt_count,
            r.last_attempt_at,
            r.delivered_at,
            r.failed_at,
            r.created_at
        FROM public.school_collection_campaign_recipients r
        WHERE r.campaign_id = p_campaign_id
          AND r.school_id = v_profile.school_id
          AND (p_cursor_recipient_id IS NULL OR r.id > p_cursor_recipient_id)
        ORDER BY r.created_at ASC, r.id ASC
        LIMIT v_limit + 1
    LOOP
        v_count := v_count + 1;
        IF v_count > v_limit THEN
            v_has_more := TRUE;
            EXIT;
        END IF;

        v_next_cursor_id := v_rec.id;

        -- Dernière tentative pour ce destinataire
        SELECT pg_catalog.jsonb_build_object(
            'id', a.id,
            'attempt_number', a.attempt_number,
            'provider', a.provider,
            'provider_message_id', a.provider_message_id,
            'status', a.status,
            'error_code', a.error_code,
            'error_message', a.error_message,
            'attempted_at', a.attempted_at
        ) INTO v_latest_attempt
        FROM public.school_collection_delivery_attempts a
        WHERE a.recipient_id = v_rec.id
        ORDER BY a.attempt_number DESC
        LIMIT 1;

        v_recipients := v_recipients || pg_catalog.jsonb_build_object(
            'id', v_rec.id,
            'campaign_id', v_rec.campaign_id,
            'invoice_id', v_rec.invoice_id,
            'student_id', v_rec.student_id,
            'parent_profile_id', v_rec.parent_profile_id,
            'delivery_status', v_rec.delivery_status,
            'skip_reason', v_rec.skip_reason,
            'invoice_snapshot', v_rec.invoice_snapshot,
            'student_snapshot', v_rec.student_snapshot,
            'parent_snapshot', v_rec.parent_snapshot,
            'attempt_count', v_rec.attempt_count,
            'last_attempt_at', v_rec.last_attempt_at,
            'delivered_at', v_rec.delivered_at,
            'failed_at', v_rec.failed_at,
            'latest_attempt', v_latest_attempt
        );
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'campaign', pg_catalog.jsonb_build_object(
            'id', v_campaign.id,
            'school_id', v_campaign.school_id,
            'name', v_campaign.name,
            'channel', v_campaign.channel,
            'status', v_campaign.status,
            'scheduled_at', v_campaign.scheduled_at,
            'claimed_at', v_campaign.claimed_at,
            'claimed_by', v_campaign.claimed_by,
            'processing_started_at', v_campaign.processing_started_at,
            'completed_at', v_campaign.completed_at,
            'created_by', v_campaign.created_by,
            'idempotency_key', v_campaign.idempotency_key,
            'filter_criteria', v_campaign.filter_criteria,
            'template_snapshot', v_campaign.template_snapshot,
            'recipient_count', v_campaign.recipient_count,
            'pending_count', v_campaign.pending_count,
            'processing_count', v_campaign.processing_count,
            'success_count', v_campaign.success_count,
            'failed_count', v_campaign.failed_count,
            'skipped_count', v_campaign.skipped_count,
            'created_at', v_campaign.created_at,
            'updated_at', v_campaign.updated_at
        ),
        'recipients', v_recipients,
        'recipients_has_more', v_has_more,
        'next_cursor_recipient_id', CASE WHEN v_has_more THEN v_next_cursor_id ELSE NULL END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_collection_campaign TO authenticated;
REVOKE ALL ON FUNCTION public.get_school_collection_campaign FROM PUBLIC, anon;

-- 3.5 RPC: schedule_school_collection_campaign (Validation tolérance date non passée)
CREATE OR REPLACE FUNCTION public.schedule_school_collection_campaign(
    p_campaign_id UUID,
    p_scheduled_at TIMESTAMPTZ DEFAULT NULL
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
    v_campaign public.school_collection_campaigns%ROWTYPE;
    v_scheduled_at TIMESTAMPTZ;
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

    SELECT * INTO v_campaign
    FROM public.school_collection_campaigns
    WHERE id = p_campaign_id AND school_id = v_profile.school_id
    FOR UPDATE;

    IF v_campaign.id IS NULL THEN
        RAISE EXCEPTION 'Campagne introuvable' USING ERRCODE = 'P0002';
    END IF;

    IF v_campaign.status != 'draft' THEN
        RAISE EXCEPTION 'REJET : Seule une campagne au statut draft peut être planifiée.' USING ERRCODE = '22023';
    END IF;

    -- Contrôle tolérance date non passée (max 5 minutes dans le passé autorisées pour décalage horloge)
    IF p_scheduled_at IS NOT NULL AND p_scheduled_at < (pg_catalog.clock_timestamp() - interval '5 minutes') THEN
        RAISE EXCEPTION 'REJET : p_scheduled_at ne peut pas être fixé dans le passé.' USING ERRCODE = '22023';
    END IF;

    v_scheduled_at := COALESCE(p_scheduled_at, pg_catalog.clock_timestamp());

    UPDATE public.school_collection_campaigns
    SET status = 'scheduled',
        scheduled_at = v_scheduled_at,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_campaign_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'campaign_id', p_campaign_id,
        'status', 'scheduled',
        'scheduled_at', v_scheduled_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_school_collection_campaign TO authenticated;
REVOKE ALL ON FUNCTION public.schedule_school_collection_campaign FROM PUBLIC, anon;

-- 3.6 RPC: cancel_school_collection_campaign
CREATE OR REPLACE FUNCTION public.cancel_school_collection_campaign(
    p_campaign_id UUID,
    p_reason TEXT DEFAULT NULL
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
    v_campaign public.school_collection_campaigns%ROWTYPE;
    v_cancelled_pending_count INT := 0;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
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

    SELECT * INTO v_campaign
    FROM public.school_collection_campaigns
    WHERE id = p_campaign_id AND school_id = v_profile.school_id
    FOR UPDATE;

    IF v_campaign.id IS NULL THEN
        RAISE EXCEPTION 'Campagne introuvable' USING ERRCODE = 'P0002';
    END IF;

    IF v_campaign.status NOT IN ('draft', 'scheduled') THEN
        RAISE EXCEPTION 'REJET : Impossible d annuler une campagne au statut %.', v_campaign.status USING ERRCODE = '22023';
    END IF;

    -- Passer tous les destinataires pending à skipped (CAMPAIGN_CANCELLED)
    WITH updated_recipients AS (
        UPDATE public.school_collection_campaign_recipients
        SET delivery_status = 'skipped',
            skip_reason = 'CAMPAIGN_CANCELLED',
            updated_at = v_now
        WHERE campaign_id = p_campaign_id AND delivery_status = 'pending'
        RETURNING id
    )
    SELECT COUNT(*) INTO v_cancelled_pending_count FROM updated_recipients;

    UPDATE public.school_collection_campaigns
    SET status = 'cancelled',
        pending_count = 0,
        skipped_count = skipped_count + v_cancelled_pending_count,
        updated_at = v_now
    WHERE id = p_campaign_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'campaign_id', p_campaign_id,
        'status', 'cancelled',
        'cancelled_pending_count', v_cancelled_pending_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_school_collection_campaign TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_school_collection_campaign FROM PUBLIC, anon;

-- -----------------------------------------------------------------------------
-- 4. INTERFACE DE TRAITEMENT MOCK PRIVÉE POUR LE WORKER
-- -----------------------------------------------------------------------------

-- 4.1 Function: _claim_scheduled_campaigns (Validations p_batch_size et worker_id)
CREATE OR REPLACE FUNCTION public._claim_scheduled_campaigns(
    p_batch_size INT DEFAULT 5,
    p_worker_id TEXT DEFAULT 'mock-worker-1'
)
RETURNS TABLE (
    campaign_id UUID,
    school_id UUID,
    channel TEXT,
    recipient_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker_id TEXT;
BEGIN
    IF p_batch_size < 1 OR p_batch_size > 100 THEN
        RAISE EXCEPTION 'REJET : p_batch_size doit être compris entre 1 et 100.' USING ERRCODE = '22023';
    END IF;

    IF p_worker_id IS NULL THEN
        RAISE EXCEPTION 'REJET : p_worker_id ne peut pas être NULL.' USING ERRCODE = '22023';
    END IF;
    v_worker_id := pg_catalog.btrim(p_worker_id);
    IF pg_catalog.length(v_worker_id) < 3 OR pg_catalog.length(p_worker_id) > 100 THEN
        RAISE EXCEPTION 'REJET : p_worker_id doit contenir entre 3 et 100 caractères.' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH target_campaigns AS (
        SELECT c.id
        FROM public.school_collection_campaigns c
        WHERE c.status = 'scheduled'
          AND (c.scheduled_at IS NULL OR c.scheduled_at <= pg_catalog.clock_timestamp())
        ORDER BY c.scheduled_at ASC, c.created_at ASC, c.id ASC
        FOR UPDATE OF c SKIP LOCKED
        LIMIT p_batch_size
    )
    UPDATE public.school_collection_campaigns c
    SET status = 'processing',
        claimed_at = pg_catalog.clock_timestamp(),
        claimed_by = v_worker_id,
        processing_started_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    FROM target_campaigns tc
    WHERE c.id = tc.id
    RETURNING c.id AS campaign_id, c.school_id, c.channel::text AS channel, c.recipient_count;
END;
$$;

REVOKE ALL ON FUNCTION public._claim_scheduled_campaigns FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public._claim_scheduled_campaigns OWNER TO postgres;

-- 4.2 Function: _process_mock_campaign (Contrat attempts status success/failed strict)
CREATE OR REPLACE FUNCTION public._process_mock_campaign(
    p_campaign_id UUID,
    p_fail_ratio NUMERIC DEFAULT 0.0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_campaign public.school_collection_campaigns%ROWTYPE;
    v_rec RECORD;
    v_sim_status TEXT;
    v_error_code TEXT;
    v_error_msg TEXT;
    v_attempt_num INT;
    v_processed_count INT := 0;
    v_success_count INT := 0;
    v_failed_count INT := 0;
    v_skipped_count INT := 0;
    v_pending_count INT := 0;
    v_processing_count INT := 0;
    v_total_recipients INT := 0;
    v_final_status TEXT;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
    IF p_fail_ratio < 0.0 OR p_fail_ratio > 1.0 THEN
        RAISE EXCEPTION 'REJET : p_fail_ratio doit être compris entre 0.0 et 1.0.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_campaign
    FROM public.school_collection_campaigns
    WHERE id = p_campaign_id FOR UPDATE;

    IF v_campaign.id IS NULL THEN
        RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002';
    END IF;

    -- Si la campagne est déjà terminée, retourner le résultat courant sans dupliquer
    IF v_campaign.status IN ('completed', 'partially_failed', 'failed', 'cancelled') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'campaign_id', p_campaign_id,
            'processed_recipients', 0,
            'final_status', v_campaign.status,
            'recipient_count', v_campaign.recipient_count,
            'pending_count', v_campaign.pending_count,
            'success_count', v_campaign.success_count,
            'failed_count', v_campaign.failed_count,
            'skipped_count', v_campaign.skipped_count
        );
    END IF;

    IF v_campaign.status != 'processing' THEN
        RAISE EXCEPTION 'Campaign must be in processing status to be executed by mock worker' USING ERRCODE = '22023';
    END IF;

    FOR v_rec IN
        SELECT *
        FROM public.school_collection_campaign_recipients
        WHERE campaign_id = p_campaign_id AND delivery_status = 'pending'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
    LOOP
        v_attempt_num := v_rec.attempt_count + 1;

        IF p_fail_ratio > 0 AND (
            p_fail_ratio >= 1.0 OR
            (pg_catalog.hashtext(v_rec.id::text) % 100)::NUMERIC / 100.0 < p_fail_ratio
        ) THEN
            v_sim_status := 'failed';
            v_error_code := 'MOCK_DELIVERY_FAILED';
            v_error_msg := 'Simulated mock delivery failure';
        ELSE
            v_sim_status := 'success';
            v_error_code := NULL;
            v_error_msg := NULL;
        END IF;

        -- Insertion tentative (status success/failed strict avec simulated: true dans les payloads)
        INSERT INTO public.school_collection_delivery_attempts (
            recipient_id,
            campaign_id,
            school_id,
            attempt_number,
            provider,
            provider_message_id,
            status,
            error_code,
            error_message,
            request_payload,
            response_payload,
            attempted_at
        ) VALUES (
            v_rec.id,
            p_campaign_id,
            v_campaign.school_id,
            v_attempt_num,
            'mock',
            CASE WHEN v_sim_status = 'success' THEN 'mock-msg-' || gen_random_uuid()::text ELSE NULL END,
            v_sim_status,
            v_error_code,
            v_error_msg,
            pg_catalog.jsonb_build_object('simulated', true, 'channel', v_campaign.channel, 'target', v_rec.parent_snapshot->>'channel_contact'),
            pg_catalog.jsonb_build_object('simulated', true, 'outcome', v_sim_status),
            v_now
        );

        UPDATE public.school_collection_campaign_recipients
        SET delivery_status = v_sim_status,
            attempt_count = v_attempt_num,
            last_attempt_at = v_now,
            delivered_at = CASE WHEN v_sim_status = 'success' THEN v_now ELSE delivered_at END,
            failed_at = CASE WHEN v_sim_status = 'failed' THEN v_now ELSE failed_at END,
            updated_at = v_now
        WHERE id = v_rec.id;

        v_processed_count := v_processed_count + 1;
    END LOOP;

    -- Recalcul des agrégats réels
    SELECT
        COUNT(*) FILTER (WHERE delivery_status = 'pending'),
        COUNT(*) FILTER (WHERE delivery_status = 'processing'),
        COUNT(*) FILTER (WHERE delivery_status = 'success'),
        COUNT(*) FILTER (WHERE delivery_status = 'failed'),
        COUNT(*) FILTER (WHERE delivery_status = 'skipped'),
        COUNT(*)
    INTO
        v_pending_count,
        v_processing_count,
        v_success_count,
        v_failed_count,
        v_skipped_count,
        v_total_recipients
    FROM public.school_collection_campaign_recipients
    WHERE campaign_id = p_campaign_id;

    IF v_pending_count = 0 THEN
        IF v_failed_count = 0 THEN
            v_final_status := 'completed';
        ELSIF v_success_count > 0 THEN
            v_final_status := 'partially_failed';
        ELSE
            v_final_status := 'failed';
        END IF;
    ELSE
        v_final_status := 'processing';
    END IF;

    UPDATE public.school_collection_campaigns
    SET status = v_final_status,
        recipient_count = v_total_recipients,
        pending_count = v_pending_count,
        processing_count = v_processing_count,
        success_count = v_success_count,
        failed_count = v_failed_count,
        skipped_count = v_skipped_count,
        completed_at = CASE WHEN v_pending_count = 0 THEN v_now ELSE completed_at END,
        updated_at = v_now
    WHERE id = p_campaign_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'campaign_id', p_campaign_id,
        'processed_recipients', v_processed_count,
        'final_status', v_final_status,
        'recipient_count', v_total_recipients,
        'pending_count', v_pending_count,
        'success_count', v_success_count,
        'failed_count', v_failed_count,
        'skipped_count', v_skipped_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public._process_mock_campaign FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public._process_mock_campaign OWNER TO postgres;
