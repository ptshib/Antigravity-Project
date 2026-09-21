-- Test Suite: 20260921130000_finance_4e10_fix_campaign_completion_tests.sql
-- Validation du recalcul automatique des campagnes (completed, partially_failed, failed, processing, idempotence webhook)

BEGIN;

DO $$
DECLARE
    v_school_id UUID := '11111111-1111-1111-1111-111111111111';
    v_profile_id UUID := '22222222-2222-2222-2222-222222222222';

    -- IDs de test pour completed
    v_c1_id UUID := 'c1111111-1111-1111-1111-111111111111';
    v_r1_id UUID := 'r1111111-1111-1111-1111-111111111111';
    v_j1_id UUID := 'j1111111-1111-1111-1111-111111111111';

    -- IDs de test pour partially_failed
    v_c2_id UUID := 'c2222222-2222-2222-2222-222222222222';
    v_r2a_id UUID := 'r2a22222-2222-2222-2222-222222222222';
    v_r2b_id UUID := 'r2b22222-2222-2222-2222-222222222222';
    v_j2a_id UUID := 'j2a22222-2222-2222-2222-222222222222';
    v_j2b_id UUID := 'j2b22222-2222-2222-2222-222222222222';

    -- IDs de test pour failed
    v_c3_id UUID := 'c3333333-3333-3333-3333-333333333333';
    v_r3_id UUID := 'r3333333-3333-3333-3333-333333333333';
    v_j3_id UUID := 'j3333333-3333-3333-3333-333333333333';

    -- IDs de test pour processing
    v_c4_id UUID := 'c4444444-4444-4444-4444-444444444444';
    v_r4_id UUID := 'r4444444-4444-4444-4444-444444444444';

    v_rec RECORD;
    v_res JSONB;
BEGIN
    SET LOCAL session_replication_role = 'replica';

    INSERT INTO public.schools (id, name, slug) VALUES (v_school_id, 'École Test 4E10', 'ecole-test-4e10') ON CONFLICT DO NOTHING;
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name) VALUES (v_profile_id, v_school_id, 'school_admin', 'Admin', 'Test') ON CONFLICT DO NOTHING;

    -- =========================================================================
    -- TEST 1 : Transition vers COMPLETED (Tous destinataires success/skipped, 0 failed)
    -- =========================================================================
    INSERT INTO public.school_collection_campaigns (
        id, school_id, created_by, idempotency_key, payload_hash, name, channel, status, delivery_mode, recipient_count, pending_count
    ) VALUES (
        v_c1_id, v_school_id, v_profile_id, gen_random_uuid(), 'hash1', 'Campagne Completed', 'email', 'processing', 'real', 1, 1
    );

    INSERT INTO public.school_collection_campaign_recipients (
        id, campaign_id, school_id, invoice_id, student_id, parent_profile_id, delivery_status, invoice_snapshot, student_snapshot, parent_snapshot
    ) VALUES (
        v_r1_id, v_c1_id, v_school_id, gen_random_uuid(), gen_random_uuid(), v_profile_id, 'pending', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
    );

    INSERT INTO public.school_collection_real_email_jobs (
        id, school_id, campaign_id, recipient_id, provider, provider_idempotency_key, provider_message_id, provider_request_payload, canonical_payload_hash, state
    ) VALUES (
        v_j1_id, v_school_id, v_c1_id, v_r1_id, 'resend', gen_random_uuid(), 'msg_resend_1', '{"from":"a@b.com"}'::jsonb, 'hash1', 'submitted'
    );

    SET LOCAL session_replication_role = 'origin';

    -- Ingestion de l'événement webhook delivered
    v_res := public._ingest_delivery_event('resend', 'evt_deliv_1', 'msg_resend_1', 'delivered', NOW(), '{}'::jsonb);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST 4E10-1 ECHEC : _ingest_delivery_event a échoué';
    END IF;

    -- Vérifier que la campagne C1 est au statut 'completed'
    SELECT * INTO v_rec FROM public.school_collection_campaigns WHERE id = v_c1_id;
    IF v_rec.status <> 'completed' THEN
        RAISE EXCEPTION 'TEST 4E10-1 ECHEC : Statut C1 = % (attendu: completed)', v_rec.status;
    END IF;
    IF v_rec.success_count <> 1 OR v_rec.pending_count <> 0 OR v_rec.failed_count <> 0 THEN
        RAISE EXCEPTION 'TEST 4E10-1 ECHEC : Compteurs C1 inattendus (success: %, pending: %, failed: %)',
            v_rec.success_count, v_rec.pending_count, v_rec.failed_count;
    END IF;
    IF v_rec.completed_at IS NULL THEN
        RAISE EXCEPTION 'TEST 4E10-1 ECHEC : completed_at de C1 doit être renseigné';
    END IF;

    -- =========================================================================
    -- TEST 1B : Idempotence de répétition du Webhook (duplication)
    -- =========================================================================
    v_res := public._ingest_delivery_event('resend', 'evt_deliv_1', 'msg_resend_1', 'delivered', NOW(), '{}'::jsonb);
    IF v_res->>'status' <> 'duplicate_ignored_event' THEN
        RAISE EXCEPTION 'TEST 4E10-1B ECHEC : L''événement dupliqué n''a pas été ignoré avec duplicate_ignored_event (obtenu: %)', v_res->>'status';
    END IF;

    SELECT * INTO v_rec FROM public.school_collection_campaigns WHERE id = v_c1_id;
    IF v_rec.status <> 'completed' OR v_rec.success_count <> 1 THEN
        RAISE EXCEPTION 'TEST 4E10-1B ECHEC : Altération de statut lors de la répétition du webhook';
    END IF;

    -- =========================================================================
    -- TEST 2 : Transition vers PARTIALLY_FAILED (Coexistence de success et failed)
    -- =========================================================================
    SET LOCAL session_replication_role = 'replica';

    INSERT INTO public.school_collection_campaigns (
        id, school_id, created_by, idempotency_key, payload_hash, name, channel, status, delivery_mode, recipient_count, pending_count
    ) VALUES (
        v_c2_id, v_school_id, v_profile_id, gen_random_uuid(), 'hash2', 'Campagne Partial', 'email', 'processing', 'real', 2, 2
    );

    INSERT INTO public.school_collection_campaign_recipients (
        id, campaign_id, school_id, invoice_id, student_id, parent_profile_id, delivery_status, invoice_snapshot, student_snapshot, parent_snapshot
    ) VALUES
        (v_r2a_id, v_c2_id, v_school_id, gen_random_uuid(), gen_random_uuid(), v_profile_id, 'pending', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb),
        (v_r2b_id, v_c2_id, v_school_id, gen_random_uuid(), gen_random_uuid(), v_profile_id, 'pending', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);

    INSERT INTO public.school_collection_real_email_jobs (
        id, school_id, campaign_id, recipient_id, provider, provider_idempotency_key, provider_message_id, provider_request_payload, canonical_payload_hash, state
    ) VALUES
        (v_j2a_id, v_school_id, v_c2_id, v_r2a_id, 'resend', gen_random_uuid(), 'msg_resend_2a', '{"from":"a@b.com"}'::jsonb, 'hash2', 'submitted'),
        (v_j2b_id, v_school_id, v_c2_id, v_r2b_id, 'resend', gen_random_uuid(), 'msg_resend_2b', '{"from":"a@b.com"}'::jsonb, 'hash2', 'submitted');

    SET LOCAL session_replication_role = 'origin';

    -- Ingestion R2A -> delivered (success)
    PERFORM public._ingest_delivery_event('resend', 'evt_deliv_2a', 'msg_resend_2a', 'delivered', NOW(), '{}'::jsonb);

    -- À ce stade, R2B est encore pending -> Campagne C2 doit être au statut 'processing'
    SELECT * INTO v_rec FROM public.school_collection_campaigns WHERE id = v_c2_id;
    IF v_rec.status <> 'processing' THEN
        RAISE EXCEPTION 'TEST 4E10-2A ECHEC : Statut C2 intermédiaire = % (attendu: processing)', v_rec.status;
    END IF;

    -- Ingestion R2B -> bounced (failed)
    PERFORM public._ingest_delivery_event('resend', 'evt_deliv_2b', 'msg_resend_2b', 'bounced', NOW(), '{}'::jsonb);

    -- Tous terminaux (1 success, 1 failed) -> Campagne C2 doit être au statut 'partially_failed'
    SELECT * INTO v_rec FROM public.school_collection_campaigns WHERE id = v_c2_id;
    IF v_rec.status <> 'partially_failed' THEN
        RAISE EXCEPTION 'TEST 4E10-2B ECHEC : Statut C2 = % (attendu: partially_failed)', v_rec.status;
    END IF;
    IF v_rec.success_count <> 1 OR v_rec.failed_count <> 1 THEN
        RAISE EXCEPTION 'TEST 4E10-2B ECHEC : Compteurs C2 inattendus (success: %, failed: %)', v_rec.success_count, v_rec.failed_count;
    END IF;

    -- =========================================================================
    -- TEST 3 : Transition vers FAILED (Tous destinataires en échec terminal)
    -- =========================================================================
    SET LOCAL session_replication_role = 'replica';

    INSERT INTO public.school_collection_campaigns (
        id, school_id, created_by, idempotency_key, payload_hash, name, channel, status, delivery_mode, recipient_count, pending_count
    ) VALUES (
        v_c3_id, v_school_id, v_profile_id, gen_random_uuid(), 'hash3', 'Campagne Failed', 'email', 'processing', 'real', 1, 1
    );

    INSERT INTO public.school_collection_campaign_recipients (
        id, campaign_id, school_id, invoice_id, student_id, parent_profile_id, delivery_status, invoice_snapshot, student_snapshot, parent_snapshot
    ) VALUES (
        v_r3_id, v_c3_id, v_school_id, gen_random_uuid(), gen_random_uuid(), v_profile_id, 'pending', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
    );

    INSERT INTO public.school_collection_real_email_jobs (
        id, school_id, campaign_id, recipient_id, provider, provider_idempotency_key, provider_message_id, provider_request_payload, canonical_payload_hash, state
    ) VALUES (
        v_j3_id, v_school_id, v_c3_id, v_r3_id, 'resend', gen_random_uuid(), 'msg_resend_3', '{"from":"a@b.com"}'::jsonb, 'hash3', 'submitted'
    );

    SET LOCAL session_replication_role = 'origin';

    -- Ingestion R3 -> delivery_failed
    PERFORM public._ingest_delivery_event('resend', 'evt_fail_3', 'msg_resend_3', 'delivery_failed', NOW(), '{}'::jsonb);

    -- Tous échecs -> Campagne C3 doit être au statut 'failed'
    SELECT * INTO v_rec FROM public.school_collection_campaigns WHERE id = v_c3_id;
    IF v_rec.status <> 'failed' THEN
        RAISE EXCEPTION 'TEST 4E10-3 ECHEC : Statut C3 = % (attendu: failed)', v_rec.status;
    END IF;
    IF v_rec.failed_count <> 1 OR v_rec.success_count <> 0 THEN
        RAISE EXCEPTION 'TEST 4E10-3 ECHEC : Compteurs C3 inattendus (failed: %, success: %)', v_rec.failed_count, v_rec.success_count;
    END IF;

    -- =========================================================================
    -- TEST 4 : Maintien du statut PROCESSING s'il reste des destinataires non-terminaux
    -- =========================================================================
    SET LOCAL session_replication_role = 'replica';

    INSERT INTO public.school_collection_campaigns (
        id, school_id, created_by, idempotency_key, payload_hash, name, channel, status, delivery_mode, recipient_count, pending_count
    ) VALUES (
        v_c4_id, v_school_id, v_profile_id, gen_random_uuid(), 'hash4', 'Campagne Processing', 'email', 'scheduled', 'real', 1, 1
    );

    INSERT INTO public.school_collection_campaign_recipients (
        id, campaign_id, school_id, invoice_id, student_id, parent_profile_id, delivery_status, invoice_snapshot, student_snapshot, parent_snapshot
    ) VALUES (
        v_r4_id, v_c4_id, v_school_id, gen_random_uuid(), gen_random_uuid(), v_profile_id, 'pending', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
    );

    SET LOCAL session_replication_role = 'origin';

    PERFORM public._recalculate_campaign_status(v_c4_id);

    SELECT * INTO v_rec FROM public.school_collection_campaigns WHERE id = v_c4_id;
    IF v_rec.status <> 'processing' THEN
        RAISE EXCEPTION 'TEST 4E10-4 ECHEC : Statut C4 = % (attendu: processing)', v_rec.status;
    END IF;

    RAISE NOTICE '✓ SUITE SQL 4E-10 : Recalcul automatique des campagnes et idempotency webhooks validés avec succès';
END;
$$;

ROLLBACK;
