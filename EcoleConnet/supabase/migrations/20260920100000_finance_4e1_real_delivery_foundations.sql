-- =============================================================================
-- ÉCOLECONNECT — MIGRATION FINANCE 4E-1R3 (FERMETURE MÉCANIQUE FINALE)
-- Fichier: 20260920100000_finance_4e1_real_delivery_foundations.sql
-- Description: Schéma SQL, Identité Système Vérifiée, Outbox Real Email avec Payload
--              Canonique Immuable, Quota Ledger Atomique, Webhook Inbox & Events (Append-Only),
--              Suppressions Tenant-Scoped, Réconciliation Network Unknown (24h max),
--              Crash Recovery avec Lease et Matrice des Privilèges Worker (service_role).
-- =============================================================================

-- Extension pgcrypto pour digest/sha256
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1. RÉTROCOMPATIBILITÉ FINANCE 4D : EXTENSION CAMPAIGNS
-- -----------------------------------------------------------------------------

ALTER TABLE public.school_collection_campaigns 
ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(20) NOT NULL DEFAULT 'mock';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint 
        WHERE conname = 'chk_campaign_delivery_mode' 
          AND conrelid = 'public.school_collection_campaigns'::regclass
    ) THEN
        ALTER TABLE public.school_collection_campaigns
        ADD CONSTRAINT chk_campaign_delivery_mode CHECK (delivery_mode IN ('mock', 'real'));
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. KILL SWITCH GLOBAL & IDENTITÉ EXPÉDITRICE SYSTÈME (SINGLETON)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_delivery_global_config (
    id INT PRIMARY KEY DEFAULT 1,
    real_email_enabled BOOLEAN NOT NULL DEFAULT false,
    sender_identity_verified BOOLEAN NOT NULL DEFAULT false,
    verified_from_email TEXT NULL,
    verified_from_name TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

    CONSTRAINT chk_global_config_singleton CHECK (id = 1),
    CONSTRAINT chk_global_config_verified_email CHECK (
        verified_from_email IS NULL OR (verified_from_email LIKE '%@%' AND pg_catalog.length(verified_from_email) <= 255)
    )
);

ALTER TABLE public.school_delivery_global_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_delivery_global_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_delivery_global_config FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.school_delivery_global_config OWNER TO postgres;

INSERT INTO public.school_delivery_global_config (id, real_email_enabled, sender_identity_verified, verified_from_email, verified_from_name)
VALUES (1, false, false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. CONFIGURATION PAR ÉTABLISSEMENT
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_delivery_settings (
    school_id UUID PRIMARY KEY REFERENCES public.schools(id) ON DELETE RESTRICT,
    email_real_enabled BOOLEAN NOT NULL DEFAULT false,
    email_provider VARCHAR(30) NOT NULL DEFAULT 'resend',
    from_name TEXT NULL,
    reply_to_email TEXT NULL,
    daily_email_quota INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

    CONSTRAINT chk_school_delivery_provider CHECK (email_provider = 'resend'),
    CONSTRAINT chk_school_delivery_quota CHECK (daily_email_quota >= 1 AND daily_email_quota <= 100),
    CONSTRAINT chk_school_delivery_from_name CHECK (
        from_name IS NULL OR (pg_catalog.length(pg_catalog.btrim(from_name)) >= 2 AND pg_catalog.length(from_name) <= 100)
    ),
    CONSTRAINT chk_school_delivery_reply_to CHECK (
        reply_to_email IS NULL OR (reply_to_email LIKE '%@%' AND pg_catalog.length(reply_to_email) <= 255)
    )
);

ALTER TABLE public.school_delivery_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_delivery_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_delivery_settings FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.school_delivery_settings OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 4. OUTBOX PERSISTANTE DES JOBS E-MAIL RÉELS (PAYLOAD CANONIQUE & IMMUTABILITÉ)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_collection_real_email_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    campaign_id UUID NOT NULL REFERENCES public.school_collection_campaigns(id) ON DELETE RESTRICT,
    recipient_id UUID NOT NULL REFERENCES public.school_collection_campaign_recipients(id) ON DELETE RESTRICT,
    provider VARCHAR(30) NOT NULL DEFAULT 'resend',
    provider_idempotency_key UUID NOT NULL,
    provider_request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    canonical_payload_hash CHAR(64) NOT NULL,
    state VARCHAR(30) NOT NULL DEFAULT 'pending',
    attempt_count INT NOT NULL DEFAULT 0,
    first_provider_attempt_at TIMESTAMPTZ NULL,
    last_provider_attempt_at TIMESTAMPTZ NULL,
    next_attempt_at TIMESTAMPTZ NULL,
    claimed_at TIMESTAMPTZ NULL,
    claimed_by TEXT NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    provider_message_id VARCHAR(120) NULL,
    last_error_code TEXT NULL,
    last_error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT uq_real_email_job_recipient UNIQUE (recipient_id),
    CONSTRAINT uq_real_email_job_idempotency UNIQUE (provider, provider_idempotency_key),
    CONSTRAINT uq_real_email_job_message_id UNIQUE (provider, provider_message_id),
    CONSTRAINT chk_real_email_job_provider CHECK (provider = 'resend'),
    CONSTRAINT chk_real_email_job_state CHECK (
        state IN (
            'pending', 'claimed', 'submitted', 'network_unknown',
            'retry_wait', 'terminal_failed', 'delivery_confirmed',
            'bounced', 'complained'
        )
    ),
    CONSTRAINT chk_real_email_job_attempt_count CHECK (attempt_count >= 0),
    CONSTRAINT chk_real_email_job_hash_length CHECK (pg_catalog.length(canonical_payload_hash) = 64)
);

CREATE INDEX IF NOT EXISTS idx_real_email_jobs_worker_claim
ON public.school_collection_real_email_jobs (state, next_attempt_at)
WHERE state IN ('pending', 'retry_wait');

CREATE INDEX IF NOT EXISTS idx_real_email_jobs_message_id
ON public.school_collection_real_email_jobs (provider, provider_message_id)
WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.school_collection_real_email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_collection_real_email_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_collection_real_email_jobs FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.school_collection_real_email_jobs OWNER TO postgres;

-- Trigger d'immutabilité du payload, de la clé et du hash
CREATE OR REPLACE FUNCTION public._prevent_real_email_jobs_payload_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD.provider_idempotency_key IS DISTINCT FROM NEW.provider_idempotency_key
       OR OLD.canonical_payload_hash IS DISTINCT FROM NEW.canonical_payload_hash
       OR OLD.provider_request_payload IS DISTINCT FROM NEW.provider_request_payload THEN
        RAISE EXCEPTION 'REJET : provider_idempotency_key, provider_request_payload et canonical_payload_hash sont strictly immuables.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_real_email_jobs_payload_mutation ON public.school_collection_real_email_jobs;
CREATE TRIGGER trg_prevent_real_email_jobs_payload_mutation
BEFORE UPDATE ON public.school_collection_real_email_jobs
FOR EACH ROW EXECUTE FUNCTION public._prevent_real_email_jobs_payload_mutation();

-- -----------------------------------------------------------------------------
-- 5. COMPTEUR DE QUOTA ATOMIQUE
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_delivery_quota_ledger (
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    business_date DATE NOT NULL,
    reserved_count INT NOT NULL DEFAULT 0,
    submitted_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),

    PRIMARY KEY (school_id, business_date),
    CONSTRAINT chk_quota_ledger_reserved CHECK (reserved_count >= 0),
    CONSTRAINT chk_quota_ledger_submitted CHECK (submitted_count >= 0),
    CONSTRAINT chk_quota_ledger_total_limit CHECK (reserved_count + submitted_count <= 100)
);

ALTER TABLE public.school_delivery_quota_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_delivery_quota_ledger FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_delivery_quota_ledger FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.school_delivery_quota_ledger OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 6. WEBHOOK INBOX & ÉVÉNEMENTS (APPEND-ONLY)
-- -----------------------------------------------------------------------------

-- 6.1 Inbox d'attente Webhook
CREATE TABLE IF NOT EXISTS public.school_collection_delivery_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(30) NOT NULL DEFAULT 'resend',
    provider_event_id VARCHAR(120) NOT NULL,
    provider_message_id VARCHAR(120) NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    event_occurred_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'unmatched',
    received_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT uq_delivery_inbox_provider_event UNIQUE (provider, provider_event_id),
    CONSTRAINT chk_delivery_inbox_provider CHECK (provider = 'resend'),
    CONSTRAINT chk_delivery_inbox_status CHECK (status IN ('unmatched', 'matched', 'orphaned'))
);

ALTER TABLE public.school_collection_delivery_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_collection_delivery_inbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_collection_delivery_inbox FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.school_collection_delivery_inbox OWNER TO postgres;

-- 6.2 Table des Événements Asynchrones Rattachés
CREATE TABLE IF NOT EXISTS public.school_collection_delivery_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    campaign_id UUID NOT NULL REFERENCES public.school_collection_campaigns(id) ON DELETE RESTRICT,
    recipient_id UUID NOT NULL REFERENCES public.school_collection_campaign_recipients(id) ON DELETE RESTRICT,
    real_email_job_id UUID NOT NULL REFERENCES public.school_collection_real_email_jobs(id) ON DELETE RESTRICT,
    provider VARCHAR(30) NOT NULL DEFAULT 'resend',
    provider_event_id VARCHAR(120) NOT NULL,
    provider_message_id VARCHAR(120) NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    event_occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT uq_delivery_event_provider_event UNIQUE (provider, provider_event_id),
    CONSTRAINT chk_delivery_event_provider CHECK (provider = 'resend'),
    CONSTRAINT chk_delivery_event_type CHECK (
        event_type IN ('submitted', 'delivered', 'delayed', 'bounced', 'complained', 'delivery_failed')
    )
);

ALTER TABLE public.school_collection_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_collection_delivery_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_collection_delivery_events FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.school_collection_delivery_events OWNER TO postgres;

-- Trigger Append-Only sur school_collection_delivery_events
CREATE OR REPLACE FUNCTION public._prevent_delivery_events_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'REJET : La table school_collection_delivery_events est strictement append-only.'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_delivery_events_mutation ON public.school_collection_delivery_events;
CREATE TRIGGER trg_prevent_delivery_events_mutation
BEFORE UPDATE OR DELETE ON public.school_collection_delivery_events
FOR EACH ROW EXECUTE FUNCTION public._prevent_delivery_events_mutation();

-- -----------------------------------------------------------------------------
-- 7. TABLE DES SUPPRESSIONS TENANT-SCOPED (APPEND-ONLY)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_collection_contact_suppressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    parent_profile_id UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    channel VARCHAR(20) NOT NULL DEFAULT 'email',
    contact_fingerprint CHAR(64) NOT NULL,
    reason VARCHAR(40) NOT NULL,
    source VARCHAR(50) NOT NULL,
    provider_event_id VARCHAR(120) NULL,
    suppressed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT uq_contact_suppression_fingerprint UNIQUE (school_id, channel, contact_fingerprint),
    CONSTRAINT chk_suppression_channel CHECK (channel IN ('email', 'sms', 'whatsapp')),
    CONSTRAINT chk_suppression_reason CHECK (reason IN ('HARD_BOUNCE', 'SPAM_COMPLAINT', 'MANUAL_OPT_OUT'))
);

ALTER TABLE public.school_collection_contact_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_collection_contact_suppressions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_collection_contact_suppressions FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.school_collection_contact_suppressions OWNER TO postgres;

-- Trigger Append-Only sur school_collection_contact_suppressions
CREATE OR REPLACE FUNCTION public._prevent_contact_suppressions_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'REJET : La table school_collection_contact_suppressions est strictement append-only.'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_contact_suppressions_mutation ON public.school_collection_contact_suppressions;
CREATE TRIGGER trg_prevent_contact_suppressions_mutation
BEFORE UPDATE OR DELETE ON public.school_collection_contact_suppressions
FOR EACH ROW EXECUTE FUNCTION public._prevent_contact_suppressions_mutation();

-- -----------------------------------------------------------------------------
-- 8. FONCTIONS PRIVÉES ET HELPERS INTERNES WORKER
-- -----------------------------------------------------------------------------

-- 8.1 Helper: _canonical_contact_fingerprint
CREATE OR REPLACE FUNCTION public._canonical_contact_fingerprint(
    p_school_id UUID,
    p_email TEXT
)
RETURNS CHAR(64)
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_school_id IS NULL OR p_email IS NULL OR pg_catalog.btrim(p_email) = '' THEN
        RETURN NULL;
    END IF;

    RETURN pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(
                p_school_id::text || ':' || pg_catalog.lower(pg_catalog.btrim(p_email)),
                'UTF8'
            ),
            'sha256'
        ),
        'hex'
    );
END;
$$;

REVOKE ALL ON FUNCTION public._canonical_contact_fingerprint FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public._canonical_contact_fingerprint OWNER TO postgres;

-- 8.2 Helper: _reserve_school_delivery_quota (Atomic Row Lock)
CREATE OR REPLACE FUNCTION public._reserve_school_delivery_quota(
    p_school_id UUID,
    p_requested_count INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_school public.schools%ROWTYPE;
    v_valid_tz TEXT;
    v_business_date DATE;
    v_settings public.school_delivery_settings%ROWTYPE;
    v_global_config public.school_delivery_global_config%ROWTYPE;
    v_ledger public.school_delivery_quota_ledger%ROWTYPE;
    v_max_quota INT;
    v_available INT;
    v_allowed_count INT := 0;
BEGIN
    IF p_school_id IS NULL OR p_requested_count <= 0 THEN
        RETURN 0;
    END IF;

    SELECT * INTO v_global_config FROM public.school_delivery_global_config WHERE id = 1;
    IF v_global_config.id IS NULL
       OR v_global_config.real_email_enabled IS NOT TRUE
       OR v_global_config.sender_identity_verified IS NOT TRUE
       OR v_global_config.verified_from_email IS NULL
       OR pg_catalog.btrim(v_global_config.verified_from_email) = '' THEN
        RETURN 0;
    END IF;

    SELECT * INTO v_settings FROM public.school_delivery_settings WHERE school_id = p_school_id;
    IF v_settings.school_id IS NULL OR v_settings.email_real_enabled IS NOT TRUE THEN
        RETURN 0;
    END IF;

    SELECT * INTO v_school FROM public.schools WHERE id = p_school_id;
    IF v_school.id IS NULL OR v_school.status != 'active' THEN
        RETURN 0;
    END IF;

    IF v_school.timezone IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_school.timezone
    ) THEN
        v_valid_tz := v_school.timezone;
    ELSE
        v_valid_tz := 'Africa/Kinshasa';
    END IF;
    v_business_date := (pg_catalog.now() AT TIME ZONE v_valid_tz)::DATE;

    v_max_quota := COALESCE(v_settings.daily_email_quota, 100);
    IF v_max_quota > 100 THEN
        v_max_quota := 100;
    END IF;

    -- Verrouillage atomique de la ligne de quota
    INSERT INTO public.school_delivery_quota_ledger (
        school_id, business_date, reserved_count, submitted_count
    ) VALUES (
        p_school_id, v_business_date, 0, 0
    ) ON CONFLICT (school_id, business_date) DO NOTHING;

    SELECT * INTO v_ledger
    FROM public.school_delivery_quota_ledger
    WHERE school_id = p_school_id AND business_date = v_business_date
    FOR UPDATE;

    v_available := v_max_quota - (v_ledger.reserved_count + v_ledger.submitted_count);
    IF v_available <= 0 THEN
        RETURN 0;
    END IF;

    IF p_requested_count <= v_available THEN
        v_allowed_count := p_requested_count;
    ELSE
        v_allowed_count := v_available;
    END IF;

    UPDATE public.school_delivery_quota_ledger
    SET reserved_count = reserved_count + v_allowed_count,
        updated_at = pg_catalog.clock_timestamp()
    WHERE school_id = p_school_id AND business_date = v_business_date;

    RETURN v_allowed_count;
END;
$$;

REVOKE ALL ON FUNCTION public._reserve_school_delivery_quota FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public._reserve_school_delivery_quota OWNER TO postgres;

-- 8.3 Helper: _create_real_email_jobs_for_campaign
CREATE OR REPLACE FUNCTION public._create_real_email_jobs_for_campaign(
    p_campaign_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_campaign public.school_collection_campaigns%ROWTYPE;
    v_settings public.school_delivery_settings%ROWTYPE;
    v_global_config public.school_delivery_global_config%ROWTYPE;
    v_rec RECORD;
    v_fingerprint CHAR(64);
    v_payload_hash CHAR(64);
    v_request_payload JSONB;
    v_idempotency_key UUID;
    v_is_suppressed BOOLEAN;
    v_created_count INT := 0;
    v_from_header TEXT;
    v_parent_email TEXT;
    v_parent_name TEXT;
    v_student_name TEXT;
    v_invoice_num TEXT;
    v_balance NUMERIC;
    v_curr TEXT;
BEGIN
    SELECT * INTO v_global_config FROM public.school_delivery_global_config WHERE id = 1;
    IF v_global_config.id IS NULL
       OR v_global_config.real_email_enabled IS NOT TRUE
       OR v_global_config.sender_identity_verified IS NOT TRUE
       OR v_global_config.verified_from_email IS NULL
       OR pg_catalog.btrim(v_global_config.verified_from_email) = '' THEN
        RETURN 0;
    END IF;

    SELECT * INTO v_campaign FROM public.school_collection_campaigns WHERE id = p_campaign_id;
    IF v_campaign.id IS NULL OR v_campaign.delivery_mode != 'real' OR v_campaign.channel != 'email' THEN
        RETURN 0;
    END IF;

    SELECT * INTO v_settings FROM public.school_delivery_settings WHERE school_id = v_campaign.school_id;
    IF v_settings.school_id IS NULL OR v_settings.email_real_enabled IS NOT TRUE THEN
        RETURN 0;
    END IF;

    -- Utiliser exclusivement l'adresse système vérifiée
    IF v_settings.from_name IS NOT NULL AND pg_catalog.btrim(v_settings.from_name) != '' THEN
        v_from_header := pg_catalog.btrim(v_settings.from_name) || ' <' || pg_catalog.btrim(v_global_config.verified_from_email) || '>';
    ELSIF v_global_config.verified_from_name IS NOT NULL AND pg_catalog.btrim(v_global_config.verified_from_name) != '' THEN
        v_from_header := pg_catalog.btrim(v_global_config.verified_from_name) || ' <' || pg_catalog.btrim(v_global_config.verified_from_email) || '>';
    ELSE
        v_from_header := pg_catalog.btrim(v_global_config.verified_from_email);
    END IF;

    FOR v_rec IN
        SELECT * FROM public.school_collection_campaign_recipients
        WHERE campaign_id = p_campaign_id AND delivery_status = 'pending'
        ORDER BY created_at ASC, id ASC
    LOOP
        v_parent_email := pg_catalog.btrim(v_rec.parent_snapshot->>'email');

        -- Ignorer si contact absent ou invalide
        IF v_parent_email IS NULL OR v_parent_email = '' OR v_parent_email NOT LIKE '%@%' THEN
            UPDATE public.school_collection_campaign_recipients
            SET delivery_status = 'skipped',
                skip_reason = 'MISSING_CHANNEL_CONTACT',
                updated_at = pg_catalog.clock_timestamp()
            WHERE id = v_rec.id;
            CONTINUE;
        END IF;

        v_fingerprint := public._canonical_contact_fingerprint(v_campaign.school_id, v_parent_email);

        -- Vérifier la table des suppressions
        SELECT EXISTS (
            SELECT 1 FROM public.school_collection_contact_suppressions
            WHERE school_id = v_campaign.school_id AND contact_fingerprint = v_fingerprint
        ) INTO v_is_suppressed;

        IF v_is_suppressed THEN
            UPDATE public.school_collection_campaign_recipients
            SET delivery_status = 'skipped',
                skip_reason = 'OPTED_OUT',
                updated_at = pg_catalog.clock_timestamp()
            WHERE id = v_rec.id;
        ELSE
            v_parent_name := pg_catalog.btrim(COALESCE(v_rec.parent_snapshot->>'first_name', '') || ' ' || COALESCE(v_rec.parent_snapshot->>'last_name', ''));
            v_student_name := pg_catalog.btrim(COALESCE(v_rec.student_snapshot->>'first_name', '') || ' ' || COALESCE(v_rec.student_snapshot->>'last_name', ''));
            v_invoice_num := COALESCE(v_rec.invoice_snapshot->>'invoice_number', 'FAC-000');
            v_balance := COALESCE((v_rec.invoice_snapshot->>'remaining_balance')::NUMERIC, 0.00);
            v_curr := COALESCE(v_rec.invoice_snapshot->>'currency', 'USD');

            -- Payload Resend Canonique Immuable basé exclusivement sur l'adresse système vérifiée
            v_request_payload := pg_catalog.jsonb_build_object(
                'from', v_from_header,
                'to', pg_catalog.jsonb_build_array(v_parent_email),
                'subject', v_campaign.name,
                'html', '<p>Bonjour ' || v_parent_name || ', rappel de paiement pour ' || v_student_name || '. Facture ' || v_invoice_num || ' solde: ' || v_balance::text || ' ' || v_curr || '.</p>',
                'reply_to', v_settings.reply_to_email
            );

            v_payload_hash := pg_catalog.encode(
                extensions.digest(
                    pg_catalog.convert_to(v_request_payload::text, 'UTF8'),
                    'sha256'
                ),
                'hex'
            );

            v_idempotency_key := gen_random_uuid();

            BEGIN
                INSERT INTO public.school_collection_real_email_jobs (
                    school_id, campaign_id, recipient_id, provider_idempotency_key,
                    provider_request_payload, canonical_payload_hash, state
                ) VALUES (
                    v_campaign.school_id, v_campaign.id, v_rec.id, v_idempotency_key,
                    v_request_payload, v_payload_hash, 'pending'
                );
                v_created_count := v_created_count + 1;
            EXCEPTION
                WHEN unique_violation THEN
                    NULL; -- Déjà créé
            END;
        END IF;
    END LOOP;

    RETURN v_created_count;
END;
$$;

REVOKE ALL ON FUNCTION public._create_real_email_jobs_for_campaign FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._create_real_email_jobs_for_campaign TO service_role;
ALTER FUNCTION public._create_real_email_jobs_for_campaign OWNER TO postgres;

-- 8.4 Claim MOCK pour delivery_mode = 'mock'
CREATE OR REPLACE FUNCTION public._claim_scheduled_mock_campaigns(
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
          AND c.delivery_mode = 'mock'
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

REVOKE ALL ON FUNCTION public._claim_scheduled_mock_campaigns FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public._claim_scheduled_mock_campaigns OWNER TO postgres;

-- 8.5 Worker Claim pour REAL EMAIL (delivery_mode = 'real' ET channel = 'email')
CREATE OR REPLACE FUNCTION public._claim_scheduled_real_email_campaigns(
    p_batch_size INT DEFAULT 5,
    p_worker_id TEXT DEFAULT 'real-email-worker-1'
)
RETURNS TABLE (
    campaign_id UUID,
    school_id UUID,
    channel TEXT,
    recipient_count INT,
    from_name TEXT,
    reply_to_email TEXT,
    daily_quota INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker_id TEXT;
    v_global_config public.school_delivery_global_config%ROWTYPE;
BEGIN
    SELECT * INTO v_global_config FROM public.school_delivery_global_config WHERE id = 1;
    IF v_global_config.id IS NULL
       OR v_global_config.real_email_enabled IS NOT TRUE
       OR v_global_config.sender_identity_verified IS NOT TRUE
       OR v_global_config.verified_from_email IS NULL
       OR pg_catalog.btrim(v_global_config.verified_from_email) = '' THEN
        RETURN;
    END IF;

    IF p_batch_size < 1 OR p_batch_size > 100 THEN
        RAISE EXCEPTION 'REJET : p_batch_size doit être compris entre 1 et 100.' USING ERRCODE = '22023';
    END IF;

    IF p_worker_id IS NULL THEN
        RAISE EXCEPTION 'REJET : p_worker_id ne peut pas être NULL.' USING ERRCODE = '22023';
    END IF;
    v_worker_id := pg_catalog.btrim(p_worker_id);

    RETURN QUERY
    WITH target_campaigns AS (
        SELECT c.id
        FROM public.school_collection_campaigns c
        JOIN public.school_delivery_settings s ON s.school_id = c.school_id
        WHERE c.status = 'scheduled'
          AND c.delivery_mode = 'real'
          AND c.channel = 'email'
          AND s.email_real_enabled = TRUE
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
    JOIN public.school_delivery_settings s ON s.school_id = c.school_id
    WHERE c.id = tc.id
    RETURNING
        c.id AS campaign_id,
        c.school_id,
        c.channel::text AS channel,
        c.recipient_count,
        s.from_name,
        s.reply_to_email,
        s.daily_email_quota AS daily_quota;
END;
$$;

REVOKE ALL ON FUNCTION public._claim_scheduled_real_email_campaigns FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._claim_scheduled_real_email_campaigns TO service_role;
ALTER FUNCTION public._claim_scheduled_real_email_campaigns OWNER TO postgres;

-- 8.6 Worker Claim des Jobs Outbox Real Email (Retourne Payload Canonique Immuable)
CREATE OR REPLACE FUNCTION public._claim_real_email_jobs(
    p_school_id UUID,
    p_campaign_id UUID,
    p_batch_size INT DEFAULT 10,
    p_lease_duration_seconds INT DEFAULT 300,
    p_worker_id TEXT DEFAULT 'real-email-worker-1'
)
RETURNS TABLE (
    job_id UUID,
    recipient_id UUID,
    provider_idempotency_key UUID,
    provider_request_payload JSONB,
    canonical_payload_hash TEXT,
    first_provider_attempt_at TIMESTAMPTZ,
    attempt_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_global_config public.school_delivery_global_config%ROWTYPE;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_lease_expiry TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_global_config FROM public.school_delivery_global_config WHERE id = 1;
    IF v_global_config.id IS NULL
       OR v_global_config.real_email_enabled IS NOT TRUE
       OR v_global_config.sender_identity_verified IS NOT TRUE
       OR v_global_config.verified_from_email IS NULL
       OR pg_catalog.btrim(v_global_config.verified_from_email) = '' THEN
        RETURN;
    END IF;

    IF p_batch_size < 1 OR p_batch_size > 100 THEN
        RAISE EXCEPTION 'REJET : p_batch_size doit être compris entre 1 et 100.' USING ERRCODE = '22023';
    END IF;

    IF p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = '' THEN
        RAISE EXCEPTION 'REJET : p_worker_id ne peut pas être NULL.' USING ERRCODE = '22023';
    END IF;

    v_lease_expiry := v_now + (p_lease_duration_seconds || ' seconds')::INTERVAL;

    RETURN QUERY
    WITH target_jobs AS (
        SELECT j.id
        FROM public.school_collection_real_email_jobs j
        WHERE j.school_id = p_school_id
          AND j.campaign_id = p_campaign_id
          AND (
              j.state = 'pending' OR 
              (j.state = 'claimed' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at < v_now AND j.first_provider_attempt_at IS NULL) OR
              (j.state = 'retry_wait' AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= v_now))
          )
        ORDER BY j.created_at ASC, j.id ASC
        FOR UPDATE OF j SKIP LOCKED
        LIMIT p_batch_size
    )
    UPDATE public.school_collection_real_email_jobs j
    SET state = 'claimed',
        attempt_count = j.attempt_count + 1,
        claimed_at = v_now,
        claimed_by = p_worker_id,
        lease_expires_at = v_lease_expiry,
        updated_at = v_now
    FROM target_jobs tj
    WHERE j.id = tj.id
    RETURNING
        j.id AS job_id,
        j.recipient_id,
        j.provider_idempotency_key,
        j.provider_request_payload,
        j.canonical_payload_hash::text,
        j.first_provider_attempt_at,
        j.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public._claim_real_email_jobs FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._claim_real_email_jobs TO service_role;
ALTER FUNCTION public._claim_real_email_jobs OWNER TO postgres;

-- 8.7 Enregistrement du résultat de soumission synchrone avec contrôle d'immutabilité du hash
CREATE OR REPLACE FUNCTION public._record_real_email_submission_result(
    p_job_id UUID,
    p_status TEXT, -- 'submitted', 'network_unknown', 'retry_wait', 'terminal_failed'
    p_provider_message_id TEXT DEFAULT NULL,
    p_error_code TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_request_payload JSONB DEFAULT '{}'::jsonb,
    p_response_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job public.school_collection_real_email_jobs%ROWTYPE;
    v_school public.schools%ROWTYPE;
    v_campaign public.school_collection_campaigns%ROWTYPE;
    v_valid_tz TEXT;
    v_business_date DATE;
    v_attempt_num INT;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_new_job_state TEXT;
    v_recalculated_hash TEXT;
BEGIN
    -- Validation stricte des statuts autorisés (Rejet absolu de toute autre valeur dont 'rejected')
    IF p_status IS NULL OR p_status NOT IN ('submitted', 'network_unknown', 'retry_wait', 'terminal_failed') THEN
        RAISE EXCEPTION 'REJET : Statut de soumission invalide.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_job FROM public.school_collection_real_email_jobs WHERE id = p_job_id FOR UPDATE;
    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Job non trouvé' USING ERRCODE = 'P0002';
    END IF;

    -- Vérification stricte du Hash du Payload persisté
    v_recalculated_hash := pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(v_job.provider_request_payload::text, 'UTF8'),
            'sha256'
        ),
        'hex'
    );
    IF v_recalculated_hash != v_job.canonical_payload_hash THEN
        RAISE EXCEPTION 'REJET : Le hash du payload persisté ne correspond pas à canonical_payload_hash.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_school FROM public.schools WHERE id = v_job.school_id;
    IF v_school.timezone IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_school.timezone
    ) THEN
        v_valid_tz := v_school.timezone;
    ELSE
        v_valid_tz := 'Africa/Kinshasa';
    END IF;
    v_business_date := (v_now AT TIME ZONE v_valid_tz)::DATE;

    SELECT * INTO v_campaign FROM public.school_collection_campaigns WHERE id = v_job.campaign_id;

    -- Règles d'Idempotence Resend 24 heures pour network_unknown
    IF p_status = 'network_unknown' THEN
        v_new_job_state := 'network_unknown';
        IF v_job.first_provider_attempt_at IS NOT NULL AND v_now > (v_job.first_provider_attempt_at + INTERVAL '24 hours') THEN
            v_new_job_state := 'terminal_failed';
        END IF;
    ELSIF p_status = 'submitted' THEN
        v_new_job_state := 'submitted';
    ELSIF p_status = 'terminal_failed' THEN
        v_new_job_state := 'terminal_failed';
    ELSIF p_status = 'retry_wait' THEN
        v_new_job_state := 'retry_wait';
    ELSE
        v_new_job_state := p_status;
    END IF;

    -- Écriture de la tentative dans school_collection_delivery_attempts (Journal immuable)
    v_attempt_num := v_job.attempt_count;
    INSERT INTO public.school_collection_delivery_attempts (
        recipient_id, campaign_id, school_id, attempt_number, provider,
        provider_message_id, status, error_code, error_message,
        request_payload, response_payload, attempted_at
    ) VALUES (
        v_job.recipient_id, v_job.campaign_id, v_job.school_id, v_attempt_num, 'resend',
        p_provider_message_id,
        CASE WHEN v_new_job_state IN ('submitted', 'delivery_confirmed') THEN 'success' ELSE 'failed' END,
        p_error_code, p_error_message, p_request_payload, p_response_payload, v_now
    );

    -- Mise à jour du Job
    UPDATE public.school_collection_real_email_jobs
    SET state = v_new_job_state,
        first_provider_attempt_at = COALESCE(first_provider_attempt_at, v_now),
        last_provider_attempt_at = v_now,
        provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
        last_error_code = p_error_code,
        last_error_message = p_error_message,
        updated_at = v_now
    WHERE id = p_job_id;

    -- Transition atomique du quota ledger
    IF v_new_job_state IN ('submitted', 'network_unknown') THEN
        UPDATE public.school_delivery_quota_ledger
        SET reserved_count = pg_catalog.greatest(0, reserved_count - 1),
            submitted_count = submitted_count + 1,
            updated_at = v_now
        WHERE school_id = v_job.school_id AND business_date = v_business_date;
    ELSIF v_new_job_state = 'terminal_failed' AND v_job.first_provider_attempt_at IS NULL THEN
        UPDATE public.school_delivery_quota_ledger
        SET reserved_count = pg_catalog.greatest(0, reserved_count - 1),
            updated_at = v_now
        WHERE school_id = v_job.school_id AND business_date = v_business_date;
    END IF;

    -- Déclencher la réconciliation automatique des webhooks reçus en avance
    IF p_provider_message_id IS NOT NULL THEN
        PERFORM public._reconcile_delivery_inbox(p_provider_message_id);
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'state', v_new_job_state,
        'provider_message_id', p_provider_message_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public._record_real_email_submission_result FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._record_real_email_submission_result TO service_role;
ALTER FUNCTION public._record_real_email_submission_result OWNER TO postgres;

-- 8.8 Helper: _reconcile_delivery_inbox (Rattachement des webhooks reçus en avance)
CREATE OR REPLACE FUNCTION public._reconcile_delivery_inbox(
    p_provider_message_id TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inbox RECORD;
    v_reconciled_count INT := 0;
    v_res JSONB;
BEGIN
    FOR v_inbox IN
        SELECT * FROM public.school_collection_delivery_inbox
        WHERE provider_message_id = p_provider_message_id AND status = 'unmatched'
        ORDER BY received_at ASC
    LOOP
        v_res := public._ingest_delivery_event(
            v_inbox.provider,
            v_inbox.provider_event_id,
            v_inbox.provider_message_id,
            v_inbox.event_type,
            v_inbox.event_occurred_at,
            v_inbox.payload
        );

        IF (v_res->>'success')::boolean IS TRUE THEN
            UPDATE public.school_collection_delivery_inbox
            SET status = 'matched'
            WHERE id = v_inbox.id;
            v_reconciled_count := v_reconciled_count + 1;
        END IF;
    END LOOP;

    RETURN v_reconciled_count;
END;
$$;

REVOKE ALL ON FUNCTION public._reconcile_delivery_inbox FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reconcile_delivery_inbox TO service_role;
ALTER FUNCTION public._reconcile_delivery_inbox OWNER TO postgres;

-- 8.9 Ingestion et Rattachement des Événements Webhooks (Append-Only & Transitions Strictes)
CREATE OR REPLACE FUNCTION public._ingest_delivery_event(
    p_provider TEXT,
    p_provider_event_id TEXT,
    p_provider_message_id TEXT,
    p_event_type TEXT,
    p_event_occurred_at TIMESTAMPTZ,
    p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job public.school_collection_real_email_jobs%ROWTYPE;
    v_recipient public.school_collection_campaign_recipients%ROWTYPE;
    v_event_id UUID;
    v_new_job_state TEXT;
    v_fingerprint CHAR(64);
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
    IF p_provider IS NULL OR p_provider != 'resend' THEN
        RAISE EXCEPTION 'REJET : Provider doit être resend.' USING ERRCODE = '22023';
    END IF;

    IF p_provider_event_id IS NULL OR pg_catalog.btrim(p_provider_event_id) = '' THEN
        RAISE EXCEPTION 'REJET : p_provider_event_id est obligatoire.' USING ERRCODE = '22023';
    END IF;

    IF p_provider_message_id IS NULL OR pg_catalog.btrim(p_provider_message_id) = '' THEN
        RAISE EXCEPTION 'REJET : p_provider_message_id est obligatoire.' USING ERRCODE = '22023';
    END IF;

    IF p_event_type IS NULL OR p_event_type NOT IN ('submitted', 'delivered', 'delayed', 'bounced', 'complained', 'delivery_failed') THEN
        RAISE EXCEPTION 'REJET : Type d événement invalide.' USING ERRCODE = '22023';
    END IF;

    -- Recherche du job par provider_message_id
    SELECT * INTO v_job
    FROM public.school_collection_real_email_jobs
    WHERE provider = p_provider AND provider_message_id = p_provider_message_id;

    IF v_job.id IS NULL THEN
        -- Stockage temporaire dans l'inbox d'attente
        BEGIN
            INSERT INTO public.school_collection_delivery_inbox (
                provider, provider_event_id, provider_message_id, event_type, event_occurred_at, payload, status
            ) VALUES (
                p_provider, p_provider_event_id, p_provider_message_id, p_event_type, p_event_occurred_at, p_payload, 'unmatched'
            );
        EXCEPTION
            WHEN unique_violation THEN
                RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'duplicate_ignored_inbox');
        END;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'stored_in_inbox');
    END IF;

    -- Insertion dans school_collection_delivery_events (Append-only)
    BEGIN
        INSERT INTO public.school_collection_delivery_events (
            school_id, campaign_id, recipient_id, real_email_job_id,
            provider, provider_event_id, provider_message_id,
            event_type, event_occurred_at, payload
        ) VALUES (
            v_job.school_id, v_job.campaign_id, v_job.recipient_id, v_job.id,
            p_provider, p_provider_event_id, p_provider_message_id,
            p_event_type, p_event_occurred_at, p_payload
        ) RETURNING id INTO v_event_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'duplicate_ignored_event');
    END;

    -- Détermination du nouvel état du job avec protection contre la régression d'état terminal
    IF v_job.state IN ('delivery_confirmed', 'bounced', 'complained', 'terminal_failed') THEN
        v_new_job_state := v_job.state;
    ELSIF p_event_type = 'delivered' THEN
        v_new_job_state := 'delivery_confirmed';
    ELSIF p_event_type = 'bounced' THEN
        v_new_job_state := 'bounced';
    ELSIF p_event_type = 'complained' THEN
        v_new_job_state := 'complained';
    ELSIF p_event_type = 'delivery_failed' THEN
        v_new_job_state := 'terminal_failed';
    ELSE
        v_new_job_state := v_job.state;
    END IF;

    UPDATE public.school_collection_real_email_jobs
    SET state = v_new_job_state,
        updated_at = v_now
    WHERE id = v_job.id;

    -- Traitement des suppressions si hard bounce ou spam complaint
    IF p_event_type IN ('bounced', 'complained') THEN
        SELECT * INTO v_recipient FROM public.school_collection_campaign_recipients WHERE id = v_job.recipient_id;
        v_fingerprint := public._canonical_contact_fingerprint(v_job.school_id, v_recipient.parent_snapshot->>'email');

        IF v_fingerprint IS NOT NULL THEN
            BEGIN
                INSERT INTO public.school_collection_contact_suppressions (
                    school_id, parent_profile_id, channel, contact_fingerprint, reason, source, provider_event_id
                ) VALUES (
                    v_job.school_id,
                    v_recipient.parent_profile_id,
                    'email',
                    v_fingerprint,
                    CASE WHEN p_event_type = 'bounced' THEN 'HARD_BOUNCE' ELSE 'SPAM_COMPLAINT' END,
                    'WEBHOOK_RESEND',
                    p_provider_event_id
                );
            EXCEPTION
                WHEN unique_violation THEN
                    NULL; -- Déjà supprimé idempotemment
            END;
        END IF;

        UPDATE public.school_collection_campaign_recipients
        SET delivery_status = 'failed',
            failed_at = v_now,
            updated_at = v_now
        WHERE id = v_job.recipient_id;
    ELSIF p_event_type = 'delivered' THEN
        UPDATE public.school_collection_campaign_recipients
        SET delivery_status = 'success',
            delivered_at = v_now,
            updated_at = v_now
        WHERE id = v_job.recipient_id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'event_ingested',
        'event_id', v_event_id,
        'job_state', v_new_job_state
    );
END;
$$;

REVOKE ALL ON FUNCTION public._ingest_delivery_event FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ingest_delivery_event TO service_role;
ALTER FUNCTION public._ingest_delivery_event OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 9. RPCs PUBLIQUES DE CONSULTATION ET ADMINISTRATION DE LA CONFIGURATION
-- -----------------------------------------------------------------------------

-- 9.1 RPC: get_school_delivery_settings (school_admin & finance_agent)
CREATE OR REPLACE FUNCTION public.get_school_delivery_settings()
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
    v_effective_enabled BOOLEAN;
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

    SELECT * INTO v_global_config FROM public.school_delivery_global_config WHERE id = 1;
    SELECT * INTO v_settings FROM public.school_delivery_settings WHERE school_id = v_profile.school_id;

    v_effective_enabled := (
        COALESCE(v_global_config.real_email_enabled, false) AND
        COALESCE(v_global_config.sender_identity_verified, false) AND
        (v_global_config.verified_from_email IS NOT NULL AND pg_catalog.btrim(v_global_config.verified_from_email) != '') AND
        COALESCE(v_settings.email_real_enabled, false)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'school_id', v_profile.school_id,
        'global_real_email_enabled', COALESCE(v_global_config.real_email_enabled, false),
        'global_sender_identity_verified', COALESCE(v_global_config.sender_identity_verified, false),
        'global_verified_from_email', v_global_config.verified_from_email,
        'email_real_enabled', COALESCE(v_settings.email_real_enabled, false),
        'email_provider', COALESCE(v_settings.email_provider, 'resend'),
        'from_name', v_settings.from_name,
        'reply_to_email', v_settings.reply_to_email,
        'daily_email_quota', COALESCE(v_settings.daily_email_quota, 100),
        'effective_real_email_enabled', v_effective_enabled
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_delivery_settings TO authenticated;
REVOKE ALL ON FUNCTION public.get_school_delivery_settings FROM PUBLIC, anon;

-- 9.2 RPC: update_school_delivery_settings (school_admin uniquement)
CREATE OR REPLACE FUNCTION public.update_school_delivery_settings(
    p_email_real_enabled BOOLEAN,
    p_from_name TEXT DEFAULT NULL,
    p_reply_to_email TEXT DEFAULT NULL
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
    v_from_name TEXT;
    v_reply_to TEXT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated access' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id;
    IF v_profile.id IS NULL OR v_profile.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
    END IF;

    -- Rôle restrictif: school_admin uniquement (finance_agent strictement refusé)
    IF v_profile.role NOT IN ('school_admin') THEN
        RAISE EXCEPTION 'Forbidden: only school_admin can modify delivery settings' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
    IF v_school.id IS NULL OR v_school.status != 'active' THEN
        RAISE EXCEPTION 'Active school required' USING ERRCODE = '42501';
    END IF;

    IF p_email_real_enabled IS NULL THEN
        RAISE EXCEPTION 'REJET : p_email_real_enabled ne peut pas être NULL.' USING ERRCODE = '22023';
    END IF;

    IF p_from_name IS NOT NULL THEN
        v_from_name := pg_catalog.btrim(p_from_name);
        IF pg_catalog.length(v_from_name) < 2 OR pg_catalog.length(p_from_name) > 100 THEN
            RAISE EXCEPTION 'REJET : from_name doit contenir entre 2 et 100 caractères.' USING ERRCODE = '22023';
        END IF;
    ELSE
        v_from_name := NULL;
    END IF;

    IF p_reply_to_email IS NOT NULL THEN
        v_reply_to := pg_catalog.btrim(p_reply_to_email);
        IF v_reply_to NOT LIKE '%@%' OR pg_catalog.length(v_reply_to) > 255 THEN
            RAISE EXCEPTION 'REJET : reply_to_email invalide.' USING ERRCODE = '22023';
        END IF;
    ELSE
        v_reply_to := NULL;
    END IF;

    INSERT INTO public.school_delivery_settings (
        school_id, email_real_enabled, email_provider, from_name, reply_to_email, daily_email_quota, updated_by
    ) VALUES (
        v_profile.school_id, p_email_real_enabled, 'resend', v_from_name, v_reply_to, 100, v_profile.id
    ) ON CONFLICT (school_id) DO UPDATE
    SET email_real_enabled = EXCLUDED.email_real_enabled,
        from_name = EXCLUDED.from_name,
        reply_to_email = EXCLUDED.reply_to_email,
        updated_at = pg_catalog.clock_timestamp(),
        updated_by = v_profile.id;

    RETURN public.get_school_delivery_settings();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_school_delivery_settings TO authenticated;
REVOKE ALL ON FUNCTION public.update_school_delivery_settings FROM PUBLIC, anon;
