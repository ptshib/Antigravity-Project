-- Test Suite: 20260921110000_finance_4e8_fix_pilot_recovery_ambiguity_tests.sql
-- Validation de recover_pilot_real_email_job() sans ambiguïté 42702

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
    v_recovery_rec RECORD;
    v_err_caught BOOLEAN := false;
BEGIN
    SET LOCAL session_replication_role = 'replica';

    -- 1. Infrastructure de test et Readiness Global
    INSERT INTO public.schools (id, name, slug) VALUES (v_school_id, 'École Test 4E8', 'ecole-test-4e8') ON CONFLICT DO NOTHING;
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name) VALUES (v_profile_id, v_school_id, 'school_admin', 'Admin', 'Test') ON CONFLICT DO NOTHING;

    INSERT INTO public.school_delivery_global_config (id, real_email_enabled, sender_identity_verified, verified_from_email)
    VALUES (1, true, true, 'finance@ecole.org')
    ON CONFLICT (id) DO UPDATE
    SET real_email_enabled = true, sender_identity_verified = true, verified_from_email = 'finance@ecole.org';

    INSERT INTO public.school_delivery_settings (school_id, email_real_enabled, from_name, reply_to_email, daily_email_quota)
    VALUES (v_school_id, true, 'Finance', 'reply@ecole.org', 100)
    ON CONFLICT (school_id) DO UPDATE
    SET email_real_enabled = true, from_name = 'Finance', reply_to_email = 'reply@ecole.org', daily_email_quota = 100;

    -- 2. Création / Simulation du job pilote et de sa campagne
    INSERT INTO public.school_collection_campaigns (
        id, school_id, created_by, idempotency_key, payload_hash, name, channel, status, delivery_mode, scheduled_at, recipient_count, pending_count
    ) VALUES (
        v_pilot_campaign_id, v_school_id, v_profile_id, gen_random_uuid(), '0000000000000000000000000000000000000000000000000000000000000000', 'Campagne Pilote Simulée 4E8', 'email', 'processing', 'real', NOW(), 1, 0
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

    -- 3. Exécution de recover_pilot_real_email_job() (doit s'exécuter SANS ERREUR 42702)
    SELECT * INTO v_recovery_rec FROM public.recover_pilot_real_email_job();

    IF NOT v_recovery_rec.success THEN
        RAISE EXCEPTION 'TEST 4E8-1 ECHEC : recover_pilot_real_email_job a retourné success = false';
    END IF;

    IF v_recovery_rec.job_id <> v_pilot_job_id THEN
        RAISE EXCEPTION 'TEST 4E8-2 ECHEC : job_id inattendu dans les résultats (obtenu: %, attendu: %)', v_recovery_rec.job_id, v_pilot_job_id;
    END IF;

    IF v_recovery_rec.campaign_id <> v_pilot_campaign_id THEN
        RAISE EXCEPTION 'TEST 4E8-3 ECHEC : campaign_id inattendu dans les résultats (obtenu: %, attendu: %)', v_recovery_rec.campaign_id, v_pilot_campaign_id;
    END IF;

    IF v_recovery_rec.previous_attempt_count <> 1 THEN
        RAISE EXCEPTION 'TEST 4E8-4 ECHEC : previous_attempt_count inattendu (%)', v_recovery_rec.previous_attempt_count;
    END IF;

    IF v_recovery_rec.new_hash <> v_expected_hash THEN
        RAISE EXCEPTION 'TEST 4E8-5 ECHEC : new_hash inattendu (%)', v_recovery_rec.new_hash;
    END IF;

    -- 4. Contrôle post-récupération du job dans la base
    SELECT j.* INTO v_rec FROM public.school_collection_real_email_jobs j WHERE j.id = v_pilot_job_id;
    IF v_rec.state <> 'pending' THEN
        RAISE EXCEPTION 'TEST 4E8-6 ECHEC : Statut job post-recovery = % (attendu: pending)', v_rec.state;
    END IF;
    IF v_rec.claimed_at IS NOT NULL OR v_rec.claimed_by IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 4E8-7 ECHEC : Les champs claim du job ne sont pas NULL';
    END IF;
    IF v_rec.provider_message_id IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 4E8-8 ECHEC : provider_message_id n''est pas NULL';
    END IF;
    IF v_rec.attempt_count <> 1 THEN
        RAISE EXCEPTION 'TEST 4E8-9 ECHEC : attempt_count a été modifié (%) - doit rester à 1 pour audit', v_rec.attempt_count;
    END IF;
    IF v_rec.canonical_payload_hash <> v_expected_hash THEN
        RAISE EXCEPTION 'TEST 4E8-10 ECHEC : Le hash corrigé % ne correspond pas à %', v_rec.canonical_payload_hash, v_expected_hash;
    END IF;

    -- 5. Contrôle post-récupération de la campagne dans la base
    SELECT c.* INTO v_rec FROM public.school_collection_campaigns c WHERE c.id = v_pilot_campaign_id;
    IF v_rec.status <> 'scheduled' THEN
        RAISE EXCEPTION 'TEST 4E8-11 ECHEC : Statut campagne post-recovery = % (attendu: scheduled)', v_rec.status;
    END IF;

    -- 6. Un deuxième appel doit échouer car state <> terminal_failed
    BEGIN
        PERFORM public.recover_pilot_real_email_job();
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
    END;

    IF NOT v_err_caught THEN
        RAISE EXCEPTION 'TEST 4E8-12 ECHEC : Un deuxième appel aurait dû être refusé';
    END IF;

    RAISE NOTICE '✓ SUITE SQL 4E-8 : RPC recover_pilot_real_email_job validée sans ambiguïté 42702';
END;
$$;

ROLLBACK;
