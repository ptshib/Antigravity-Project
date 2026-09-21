-- Test Suite: 20260921000000_finance_4e6_fix_real_email_claim_rpc_tests.sql
-- Validation de la fonction _claim_scheduled_real_email_campaigns corrigée

BEGIN;

DO $$
DECLARE
    v_school_id UUID := '22222222-2222-2222-2222-222222222222';
    v_campaign_id UUID := '33333333-3333-3333-3333-333333333333';
    v_profile_id UUID := '44444444-4444-4444-4444-444444444444';
    v_idem_id UUID := '55555555-5555-5555-5555-555555555555';
    v_hash TEXT := '0000000000000000000000000000000000000000000000000000000000000000';
    v_found BOOLEAN := false;
    v_rec RECORD;
BEGIN
    SET LOCAL session_replication_role = 'replica';

    -- 1. Configuration globale et établissement pour activer la readiness
    INSERT INTO public.schools (id, name, slug) VALUES (v_school_id, 'École Test 4E6', 'ecole-test-4e6') ON CONFLICT DO NOTHING;
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name) VALUES (v_profile_id, v_school_id, 'school_admin', 'Admin', 'Test') ON CONFLICT DO NOTHING;

    INSERT INTO public.school_delivery_global_config (id, real_email_enabled, sender_identity_verified, verified_from_email)
    VALUES (1, true, true, 'expediteur@test.org')
    ON CONFLICT (id) DO UPDATE
    SET real_email_enabled = true, sender_identity_verified = true, verified_from_email = 'expediteur@test.org';

    INSERT INTO public.school_delivery_settings (school_id, email_real_enabled, from_name, reply_to_email, daily_email_quota)
    VALUES (v_school_id, true, 'Expéditeur Test', 'reply@test.org', 100)
    ON CONFLICT (school_id) DO UPDATE
    SET email_real_enabled = true, from_name = 'Expéditeur Test', reply_to_email = 'reply@test.org', daily_email_quota = 100;

    -- 2. Création d'une campagne scheduled due
    INSERT INTO public.school_collection_campaigns (
        id, school_id, created_by, idempotency_key, payload_hash, name, channel, status, delivery_mode, scheduled_at, recipient_count, pending_count
    ) VALUES (
        v_campaign_id, v_school_id, v_profile_id, v_idem_id, v_hash, 'Campagne Test 4E6', 'email', 'scheduled', 'real', NOW() - INTERVAL '1 minute', 1, 1
    );

    SET LOCAL session_replication_role = 'origin';

    -- 3. Invocations de _claim_scheduled_real_email_campaigns
    FOR v_rec IN SELECT * FROM public._claim_scheduled_real_email_campaigns(10, 'worker-4e6-test') LOOP
        IF v_rec.campaign_id = v_campaign_id THEN
            v_found := true;
            IF v_rec.school_id <> v_school_id THEN
                RAISE EXCEPTION 'TEST 4E6-2 ECHEC : school_id inattendu';
            END IF;
            IF v_rec.from_name <> 'Expéditeur Test' THEN
                RAISE EXCEPTION 'TEST 4E6-3 ECHEC : from_name inattendu';
            END IF;
            IF v_rec.daily_quota <> 100 THEN
                RAISE EXCEPTION 'TEST 4E6-4 ECHEC : daily_quota inattendu';
            END IF;
        END IF;
    END LOOP;

    IF NOT v_found THEN
        RAISE EXCEPTION 'TEST 4E6-5 ECHEC : La campagne v_campaign_id n''a pas été réclamée';
    END IF;

    RAISE NOTICE '✓ SUITE SQL 4E-6 : RPC _claim_scheduled_real_email_campaigns validée avec succès';
END;
$$;

ROLLBACK;
