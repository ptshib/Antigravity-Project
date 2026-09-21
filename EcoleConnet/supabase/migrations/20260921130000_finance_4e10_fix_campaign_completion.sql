-- Migration: 20260921130000_finance_4e10_fix_campaign_completion.sql
-- Description: Recalcul automatique et générique du statut et des compteurs des campagnes d'envoi réelles et idempotence des webhooks

-- 1. Fonction helper générique de recalcul de statut et compteurs de campagne
CREATE OR REPLACE FUNCTION public._recalculate_campaign_status(p_campaign_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_campaign public.school_collection_campaigns%ROWTYPE;
    v_total_recipients INT;
    v_pending_count INT;
    v_processing_count INT;
    v_success_count INT;
    v_failed_count INT;
    v_skipped_count INT;
    v_final_status TEXT;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
    SELECT c.* INTO v_campaign
    FROM public.school_collection_campaigns c
    WHERE c.id = p_campaign_id
    FOR UPDATE OF c;

    IF v_campaign.id IS NULL THEN
        RETURN;
    END IF;

    -- Compter les destinataires par statut de livraison
    SELECT
        COUNT(*) FILTER (WHERE r.delivery_status = 'pending') AS pending_cnt,
        COUNT(*) FILTER (WHERE r.delivery_status = 'processing') AS processing_cnt,
        COUNT(*) FILTER (WHERE r.delivery_status = 'success') AS success_cnt,
        COUNT(*) FILTER (WHERE r.delivery_status = 'failed') AS failed_cnt,
        COUNT(*) FILTER (WHERE r.delivery_status = 'skipped') AS skipped_cnt,
        COUNT(*) AS total_cnt
    INTO
        v_pending_count,
        v_processing_count,
        v_success_count,
        v_failed_count,
        v_skipped_count,
        v_total_recipients
    FROM public.school_collection_campaign_recipients r
    WHERE r.campaign_id = p_campaign_id;

    -- Détermination du statut canonique de la campagne
    IF v_campaign.status = 'cancelled' THEN
        v_final_status := 'cancelled';
    ELSIF (v_pending_count + v_processing_count) > 0 THEN
        v_final_status := 'processing';
    ELSE
        -- Tous les destinataires ont atteint un statut terminal ('success', 'failed', 'skipped')
        IF v_failed_count = 0 THEN
            v_final_status := 'completed';
        ELSIF v_success_count > 0 AND v_failed_count > 0 THEN
            v_final_status := 'partially_failed';
        ELSE
            v_final_status := 'failed';
        END IF;
    END IF;

    -- Mise à jour atomique de la campagne
    UPDATE public.school_collection_campaigns c
    SET status = v_final_status,
        recipient_count = v_total_recipients,
        pending_count = v_pending_count,
        processing_count = v_processing_count,
        success_count = v_success_count,
        failed_count = v_failed_count,
        skipped_count = v_skipped_count,
        completed_at = CASE
            WHEN v_final_status IN ('completed', 'partially_failed', 'failed') AND c.completed_at IS NULL THEN v_now
            ELSE c.completed_at
        END,
        updated_at = v_now
    WHERE c.id = p_campaign_id;
END;
$$;

REVOKE ALL ON FUNCTION public._recalculate_campaign_status FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recalculate_campaign_status TO service_role;
ALTER FUNCTION public._recalculate_campaign_status OWNER TO postgres;

-- 2. Mise à jour de _record_real_email_submission_result pour déclencher le recalcul
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
    IF p_status IS NULL OR p_status NOT IN ('submitted', 'network_unknown', 'retry_wait', 'terminal_failed') THEN
        RAISE EXCEPTION 'REJET : Statut de soumission invalide.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_job FROM public.school_collection_real_email_jobs WHERE id = p_job_id FOR UPDATE;
    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Job non trouvé' USING ERRCODE = 'P0002';
    END IF;

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

    UPDATE public.school_collection_real_email_jobs
    SET state = v_new_job_state,
        first_provider_attempt_at = COALESCE(first_provider_attempt_at, v_now),
        last_provider_attempt_at = v_now,
        provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
        last_error_code = p_error_code,
        last_error_message = p_error_message,
        updated_at = v_now
    WHERE id = p_job_id;

    IF v_new_job_state = 'terminal_failed' THEN
        UPDATE public.school_collection_campaign_recipients
        SET delivery_status = 'failed',
            failed_at = COALESCE(failed_at, v_now),
            updated_at = v_now
        WHERE id = v_job.recipient_id AND delivery_status NOT IN ('success', 'skipped');
    END IF;

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

    IF p_provider_message_id IS NOT NULL THEN
        PERFORM public._reconcile_delivery_inbox(p_provider_message_id);
    END IF;

    PERFORM public._recalculate_campaign_status(v_job.campaign_id);

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

-- 3. Mise à jour de _ingest_delivery_event pour déclencher le recalcul
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

    SELECT * INTO v_job
    FROM public.school_collection_real_email_jobs
    WHERE provider = p_provider AND provider_message_id = p_provider_message_id;

    IF v_job.id IS NULL THEN
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
                    NULL;
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
    ELSIF p_event_type = 'delivery_failed' THEN
        UPDATE public.school_collection_campaign_recipients
        SET delivery_status = 'failed',
            failed_at = v_now,
            updated_at = v_now
        WHERE id = v_job.recipient_id;
    END IF;

    PERFORM public._recalculate_campaign_status(v_job.campaign_id);

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

-- 4. Exécution générique du recalcul sur toutes les campagnes en cours
DO $$
DECLARE
    v_camp RECORD;
BEGIN
    FOR v_camp IN SELECT id FROM public.school_collection_campaigns WHERE status IN ('scheduled', 'processing') LOOP
        PERFORM public._recalculate_campaign_status(v_camp.id);
    END LOOP;
END;
$$;
