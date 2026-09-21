-- Test Suite: 20260921100000_finance_4e7_fix_canonical_hash_and_recovery_rpc_tests.sql
-- Validation de _claim_real_email_jobs (retour provider_request_json_text) et de recover_pilot_real_email_job

BEGIN;

DO $$
DECLARE
    v_pilot_campaign_id CONSTANT UUID := 'e0d06161-8605-4939-bf05-40ad0549c1b6';
    v_pilot_job_id CONSTANT UUID := 'a6c51625-079e-4db8-a117-97b369efbe42';
    v_school_id UUID := '11111111-1111-1111-1111-111111111111';
    v_profile_id UUID := '22222222-2222-2222-2222-222222222222';
    v_recipient_id UUID := '33333333-3333-3333-3333-333333333333';
    v_idem_key UUID := '44444444-4444-4444-4444-444444444444';

    v_test_payload JSONB := '{"from": "Finance <finance@ecole.org>", "to": ["parent@test.org"], "subject": "Rappel de paiement", "html": "<p>Bonjour</p>"}'::jsonb;
    v_expected_json_text TEXT := v_test_payload::text;
    v_expected_hash TEXT := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_expected_json_text, 'UTF8'), 'sha256'), 'hex');

    v_rec RECORD;
    v_claimed_found BOOLEAN := false;
    v_recovery_rec RECORD;
    v_err_caught BOOLEAN;
BEGIN
    SET LOCAL session_replication_role = 'replica';

    -- 1. Infrastructure de test et Readiness Global
    INSERT INTO public.schools (id, name, slug) VALUES (v_school_id, 'École Test 4E7', 'ecole-test-4e7') ON CONFLICT DO NOTHING;
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name) VALUES (v_profile_id, v_school_id, 'school_admin', 'Admin', 'Test') ON CONFLICT DO NOTHING;

    INSERT INTO public.school_delivery_global_config (id, real_email_enabled, sender_identity_verified, verified_from_email)
    VALUES (1, true, true, 'finance@ecole.org')
    ON CONFLICT (id) DO UPDATE
    SET real_email_enabled = true, sender_identity_verified = true, verified_from_email = 'finance@ecole.org';

    INSERT INTO public.school_delivery_settings (school_id, email_real_enabled, from_name, reply_to_email, daily_email_quota)
    VALUES (v_school_id, true, 'Finance', 'reply@ecole.org', 100)
    ON CONFLICT (school_id) DO UPDATE
    SET email_real_enabled = true, from_name = 'Finance', reply_to_email = 'reply@ecole.org', daily_email_quota = 100;

    -- 2. Création d'une campagne et d'un job standard pour valider _claim_real_email_jobs
    INSERT INTO public.school_collection_campaigns (
        id, school_id, created_by, idempotency_key, payload_hash, name, channel, status, delivery_mode, scheduled_at, recipient_count, pending_count
    ) VALUES (
        '77777777-7777-7777-7777-777777777777'::uuid, v_school_id, v_profile_id, gen_random_uuid(), v_expected_hash, 'Campagne Test Job Claim', 'email', 'processing', 'real', NOW(), 1, 1
    );

    INSERT INTO public.school_collection_real_email_jobs (
        id, school_id, campaign_id, recipient_id, provider_idempotency_key, provider_request_payload, canonical_payload_hash, state, attempt_count
    ) VALUES (
        '88888888-8888-8888-8888-888888888888'::uuid, v_school_id, '77777777-7777-7777-7777-777777777777'::uuid, v_recipient_id, v_idem_key, v_test_payload, v_expected_hash, 'pending', 0
    );

    SET LOCAL session_replication_role = 'origin';

    -- Tester _claim_real_email_jobs
    FOR v_rec IN SELECT * FROM public._claim_real_email_jobs(v_school_id, '77777777-7777-7777-7777-777777777777'::uuid, 10, 300, 'worker-4e7') LOOP
        IF v_rec.job_id = '88888888-8888-8888-8888-888888888888'::uuid THEN
            v_claimed_found := true;
            IF v_rec.provider_request_json_text IS NULL OR v_rec.provider_request_json_text <> v_expected_json_text THEN
                RAISE EXCEPTION 'TEST 4E7-1 ECHEC : provider_request_json_text (obtenu: %) ne correspond pas à (attendu: %)',
                    v_rec.provider_request_json_text, v_expected_json_text;
            END IF;
            IF v_rec.canonical_payload_hash <> v_expected_hash THEN
                RAISE EXCEPTION 'TEST 4E7-2 ECHEC : canonical_payload_hash inattendu';
            END IF;
        END IF;
    END LOOP;

    IF NOT v_claimed_found THEN
        RAISE EXCEPTION 'TEST 4E7-3 ECHEC : Le job 88888888-... n''a pas été réclamé';
    END IF;

    -- 3. Mise en place d'une simulation du job pilote et de sa campagne protégée pour valider recover_pilot_real_email_job
    SET LOCAL session_replication_role = 'replica';

    INSERT INTO public.school_collection_campaigns (
        id, school_id, created_by, idempotency_key, payload_hash, name, channel, status, delivery_mode, scheduled_at, recipient_count, pending_count
    ) VALUES (
        v_pilot_campaign_id, v_school_id, v_profile_id, gen_random_uuid(), '0000000000000000000000000000000000000000000000000000000000000000', 'Campagne Pilote Simulée', 'email', 'processing', 'real', NOW(), 1, 0
    ) ON CONFLICT (id) DO UPDATE SET status = 'processing', claimed_at = NOW(), claimed_by = 'worker-1';

    INSERT INTO public.school_collection_campaign_recipients (
        id, campaign_id, student_id, parent_id, recipient_email, recipient_name, delivery_status, attempt_count
    ) VALUES (
        v_recipient_id, v_pilot_campaign_id, gen_random_uuid(), gen_random_uuid(), 'pilote@test.org', 'Parent Pilote', 'pending', 0
    ) ON CONFLICT (id) DO UPDATE SET delivery_status = 'pending', attempt_count = 0;

    INSERT INTO public.school_collection_real_email_jobs (
        id, school_id, campaign_id, recipient_id, provider_idempotency_key, provider_request_payload, canonical_payload_hash, state, last_error_code, last_error_message, provider_message_id, attempt_count
    ) VALUES (
        v_pilot_job_id, v_school_id, v_pilot_campaign_id, v_recipient_id, v_idem_key, v_test_payload, 'bad_hash_123456789012345678901234567890123456789012345678901234567890', 'terminal_failed', 'CANONICAL_HASH_MISMATCH', 'Payload hash mismatch', NULL, 1
    ) ON CONFLICT (id) DO UPDATE SET
        state = 'terminal_failed',
        last_error_code = 'CANONICAL_HASH_MISMATCH',
        last_error_message = 'Payload hash mismatch',
        provider_message_id = NULL,
        attempt_count = 1;

    SET LOCAL session_replication_role = 'origin';

    -- 4. Tester l'exécution réussie de recover_pilot_real_email_job()
    SELECT * INTO v_recovery_rec FROM public.recover_pilot_real_email_job();

    IF NOT v_recovery_rec.success THEN
        RAISE EXCEPTION 'TEST 4E7-4 ECHEC : recover_pilot_real_email_job a retourné success = false';
    END IF;

    IF v_recovery_rec.previous_attempt_count <> 1 THEN
        RAISE EXCEPTION 'TEST 4E7-5 ECHEC : previous_attempt_count inattendu (%)', v_recovery_rec.previous_attempt_count;
    END IF;

    IF v_recovery_rec.new_hash <> v_expected_hash THEN
        RAISE EXCEPTION 'TEST 4E7-6 ECHEC : new_hash inattendu (%)', v_recovery_rec.new_hash;
    END IF;

    -- Vérifier que le job est réarmé sans altérer attempt_count
    SELECT * INTO v_rec FROM public.school_collection_real_email_jobs WHERE id = v_pilot_job_id;
    IF v_rec.state <> 'pending' THEN
        RAISE EXCEPTION 'TEST 4E7-7 ECHEC : État job post-recovery = % (attendu: pending)', v_rec.state;
    END IF;
    IF v_rec.claimed_at IS NOT NULL OR v_rec.claimed_by IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 4E7-8 ECHEC : Les champs claim du job ne sont pas NULL';
    END IF;
    IF v_rec.attempt_count <> 1 THEN
        RAISE EXCEPTION 'TEST 4E7-9 ECHEC : attempt_count a été réinitialisé à % (attendu: 1 pour audit)', v_rec.attempt_count;
    END IF;
    IF v_rec.canonical_payload_hash <> v_expected_hash THEN
        RAISE EXCEPTION 'TEST 4E7-10 ECHEC : Le hash corrigé du job % ne correspond pas à %', v_rec.canonical_payload_hash, v_expected_hash;
    END IF;
    IF POSITION('RECOVERED_FROM_HASH_MISMATCH' IN v_rec.last_error_message) = 0 THEN
        RAISE EXCEPTION 'TEST 4E7-11 ECHEC : La trace d''erreur n''a pas été conservée dans last_error_message (%)', v_rec.last_error_message;
    END IF;

    -- Vérifier que la campagne est au statut 'scheduled' et déverrouillée
    SELECT * INTO v_rec FROM public.school_collection_campaigns WHERE id = v_pilot_campaign_id;
    IF v_rec.status <> 'scheduled' THEN
        RAISE EXCEPTION 'TEST 4E7-12 ECHEC : Statut campagne post-recovery = % (attendu: scheduled)', v_rec.status;
    END IF;
    IF v_rec.claimed_at IS NOT NULL OR v_rec.claimed_by IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 4E7-13 ECHEC : Les champs claim de la campagne ne sont pas NULL';
    END IF;

    -- 5. Vérifier qu'une tentative ultérieure de recovery est refusée car l'état n'est plus terminal_failed
    v_err_caught := false;
    BEGIN
        PERFORM public.recover_pilot_real_email_job();
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
    END;

    IF NOT v_err_caught THEN
        RAISE EXCEPTION 'TEST 4E7-14 ECHEC : recover_pilot_real_email_job aurait dû échouer car l''état n''est plus terminal_failed';
    END IF;

    RAISE NOTICE '✓ SUITE SQL 4E-7 : RPC _claim_real_email_jobs et recover_pilot_real_email_job validées avec succès';
END;
$$;

ROLLBACK;
