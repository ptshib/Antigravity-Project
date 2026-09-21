-- Migration: 20260921100000_finance_4e7_fix_canonical_hash_and_recovery_rpc.sql
-- Description: Retours textuels canoniques JSONB dans _claim_real_email_jobs et RPC de récupération sécurisée du pilote

-- 1. Modification de la signature de _claim_real_email_jobs (DROP explicite sans CASCADE requis)
DROP FUNCTION IF EXISTS public._claim_real_email_jobs(uuid, uuid, integer, integer, text);

CREATE FUNCTION public._claim_real_email_jobs(
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
    provider_request_json_text TEXT,
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
        j.provider_request_payload::text AS provider_request_json_text,
        j.canonical_payload_hash::text,
        j.first_provider_attempt_at,
        j.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public._claim_real_email_jobs FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._claim_real_email_jobs TO service_role;
ALTER FUNCTION public._claim_real_email_jobs OWNER TO postgres;

-- 2. RPC d'administration strictement bornée au rétablissement du job pilote
CREATE OR REPLACE FUNCTION public.recover_pilot_real_email_job()
RETURNS TABLE (
    success BOOLEAN,
    job_id UUID,
    campaign_id UUID,
    previous_state TEXT,
    new_state TEXT,
    previous_attempt_count INT,
    new_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target_campaign_id CONSTANT UUID := 'e0d06161-8605-4939-bf05-40ad0549c1b6';
    v_target_job_id CONSTANT UUID := 'a6c51625-079e-4db8-a117-97b369efbe42';

    v_job public.school_collection_real_email_jobs%ROWTYPE;
    v_campaign public.school_collection_campaigns%ROWTYPE;
    v_recipient public.school_collection_campaign_recipients%ROWTYPE;
    v_correct_hash TEXT;
BEGIN
    -- Verrouillage et contrôle du job
    SELECT * INTO v_job
    FROM public.school_collection_real_email_jobs
    WHERE id = v_target_job_id AND campaign_id = v_target_campaign_id
    FOR UPDATE;

    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'REJET RECUPERATION : Le job pilote % n''existe pas.', v_target_job_id
            USING ERRCODE = '22023';
    END IF;

    IF v_job.state <> 'terminal_failed' THEN
        RAISE EXCEPTION 'REJET RECUPERATION : Le job n''est pas au statut terminal_failed (état actuel : %).', v_job.state
            USING ERRCODE = '22023';
    END IF;

    IF v_job.last_error_code <> 'CANONICAL_HASH_MISMATCH' THEN
        RAISE EXCEPTION 'REJET RECUPERATION : Code erreur inattendu (obtenu : %, attendu : CANONICAL_HASH_MISMATCH).', v_job.last_error_code
            USING ERRCODE = '22023';
    END IF;

    IF v_job.provider_message_id IS NOT NULL THEN
        RAISE EXCEPTION 'REJET RECUPERATION SÉCURITÉ : Un provider_message_id existe déjà (%), risque de réémission.', v_job.provider_message_id
            USING ERRCODE = '22023';
    END IF;

    -- Verrouillage et contrôle de la campagne
    SELECT * INTO v_campaign
    FROM public.school_collection_campaigns
    WHERE id = v_target_campaign_id
    FOR UPDATE;

    IF v_campaign.id IS NULL THEN
        RAISE EXCEPTION 'REJET RECUPERATION : La campagne pilote % n''existe pas.', v_target_campaign_id
            USING ERRCODE = '22023';
    END IF;

    -- Verrouillage et contrôle du destinataire
    SELECT * INTO v_recipient
    FROM public.school_collection_campaign_recipients
    WHERE id = v_job.recipient_id AND campaign_id = v_target_campaign_id
    FOR UPDATE;

    IF v_recipient.id IS NULL THEN
        RAISE EXCEPTION 'REJET RECUPERATION : Destinataire % introuvable.', v_job.recipient_id
            USING ERRCODE = '22023';
    END IF;

    IF v_recipient.delivery_status <> 'pending' OR v_recipient.attempt_count <> 0 THEN
        RAISE EXCEPTION 'REJET RECUPERATION SÉCURITÉ : Statut destinataire non-pending ou attempt_count > 0 (status : %, attempt_count : %).',
            v_recipient.delivery_status, v_recipient.attempt_count
            USING ERRCODE = '22023';
    END IF;

    -- Recalcul de l'empreinte SHA-256 canonique PostgreSQL exacte
    v_correct_hash := pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(v_job.provider_request_payload::text, 'UTF8'),
            'sha256'
        ),
        'hex'
    );

    -- Réarmement sécurisé du Job (conserve attempt_count et s'assure que provider_message_id est NULL)
    UPDATE public.school_collection_real_email_jobs
    SET state = 'pending',
        claimed_at = NULL,
        claimed_by = NULL,
        lease_expires_at = NULL,
        canonical_payload_hash = v_correct_hash,
        last_error_message = 'RECOVERED_FROM_HASH_MISMATCH: ' || COALESCE(v_job.last_error_message, ''),
        provider_message_id = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_target_job_id;

    -- Remise de la Campagne au statut 'scheduled'
    UPDATE public.school_collection_campaigns
    SET status = 'scheduled',
        claimed_at = NULL,
        claimed_by = NULL,
        processing_started_at = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_target_campaign_id;

    RETURN QUERY
    SELECT true AS success,
           v_target_job_id AS job_id,
           v_target_campaign_id AS campaign_id,
           'terminal_failed'::text AS previous_state,
           'pending'::text AS new_state,
           v_job.attempt_count AS previous_attempt_count,
           v_correct_hash AS new_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_pilot_real_email_job FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_pilot_real_email_job TO service_role;
ALTER FUNCTION public.recover_pilot_real_email_job OWNER TO postgres;
