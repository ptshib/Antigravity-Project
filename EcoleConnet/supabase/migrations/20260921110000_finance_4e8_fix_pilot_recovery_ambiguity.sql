-- Migration: 20260921100000 -> 20260921110000_finance_4e8_fix_pilot_recovery_ambiguity.sql
-- Description: Qualification stricte des colonnes dans recover_pilot_real_email_job pour éliminer l'ambiguïté 42702 avec RETURNS TABLE

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
    -- 1. Verrouillage et contrôles de sécurité sur le job (alias j pour éviter toute collision avec campaign_id/job_id de RETURNS TABLE)
    SELECT j.* INTO v_job
    FROM public.school_collection_real_email_jobs j
    WHERE j.id = v_target_job_id AND j.campaign_id = v_target_campaign_id
    FOR UPDATE OF j;

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

    -- 2. Verrouillage et contrôle de la campagne (alias c pour éviter toute collision)
    SELECT c.* INTO v_campaign
    FROM public.school_collection_campaigns c
    WHERE c.id = v_target_campaign_id
    FOR UPDATE OF c;

    IF v_campaign.id IS NULL THEN
        RAISE EXCEPTION 'REJET RECUPERATION : La campagne pilote % n''existe pas.', v_target_campaign_id
            USING ERRCODE = '22023';
    END IF;

    -- 3. Verrouillage et contrôle du destinataire (alias r pour éviter toute collision)
    SELECT r.* INTO v_recipient
    FROM public.school_collection_campaign_recipients r
    WHERE r.id = v_job.recipient_id AND r.campaign_id = v_target_campaign_id
    FOR UPDATE OF r;

    IF v_recipient.id IS NULL THEN
        RAISE EXCEPTION 'REJET RECUPERATION : Destinataire % introuvable.', v_job.recipient_id
            USING ERRCODE = '22023';
    END IF;

    IF v_recipient.delivery_status <> 'pending' OR v_recipient.attempt_count <> 0 THEN
        RAISE EXCEPTION 'REJET RECUPERATION SÉCURITÉ : Statut destinataire non-pending ou attempt_count > 0 (status : %, attempt_count : %).',
            v_recipient.delivery_status, v_recipient.attempt_count
            USING ERRCODE = '22023';
    END IF;

    -- 4. Recalcul exact de l'empreinte SHA-256 canonique PostgreSQL
    v_correct_hash := pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(v_job.provider_request_payload::text, 'UTF8'),
            'sha256'
        ),
        'hex'
    );

    -- 5. Réarmement sécurisé du Job (alias j dans UPDATE pour zéro ambiguïté)
    UPDATE public.school_collection_real_email_jobs j
    SET state = 'pending',
        claimed_at = NULL,
        claimed_by = NULL,
        lease_expires_at = NULL,
        canonical_payload_hash = v_correct_hash,
        last_error_message = 'RECOVERED_FROM_HASH_MISMATCH: ' || COALESCE(v_job.last_error_message, ''),
        provider_message_id = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE j.id = v_target_job_id;

    -- 6. Remise de la Campagne au statut 'scheduled' (alias c dans UPDATE pour zéro ambiguïté)
    UPDATE public.school_collection_campaigns c
    SET status = 'scheduled',
        claimed_at = NULL,
        claimed_by = NULL,
        processing_started_at = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE c.id = v_target_campaign_id;

    -- 7. Retour des métadonnées de récupération
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
