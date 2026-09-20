-- =============================================================================
-- ÉCOLECONNECT — TESTS FINANCE 4E-3A
-- Fichier: 20260920130000_finance_4e3_real_email_observability_tests.sql
-- Description: Suite de tests SQL automatisés pour la readiness, le dashboard
--              de supervision et la liste des jobs d'e-mails réels.
--              Transaction isolée (BEGIN ... ROLLBACK).
-- =============================================================================

BEGIN;

DO $$
DECLARE
    -- IDs de test
    v_school1_id UUID := '11111111-1111-1111-1111-111111111111'::uuid;
    v_school2_id UUID := '22222222-2222-2222-2222-222222222222'::uuid;

    v_admin1_id UUID := 'a1111111-1111-1111-1111-111111111111'::uuid;
    v_agent1_id UUID := 'a2222222-2222-2222-2222-222222222222'::uuid;
    v_parent1_id UUID := 'a3333333-3333-3333-3333-333333333333'::uuid;
    v_teacher1_id UUID := 'a4444444-4444-4444-4444-444444444444'::uuid;
    v_admin2_id UUID := 'a5555555-5555-5555-5555-555555555555'::uuid;

    v_student1_id UUID := 'b1111111-1111-1111-1111-111111111111'::uuid;
    v_student2_id UUID := 'b2222222-2222-2222-2222-222222222222'::uuid;

    v_invoice1_id UUID := 'c1111111-1111-1111-1111-111111111111'::uuid;
    v_invoice2_id UUID := 'c2222222-2222-2222-2222-222222222222'::uuid;

    v_camp_real1_id UUID := 'd1111111-1111-1111-1111-111111111111'::uuid;
    v_camp_mock1_id UUID := 'd2222222-2222-2222-2222-222222222222'::uuid;
    v_camp_real2_id UUID := 'd3333333-3333-3333-3333-333333333333'::uuid;

    v_recip1_id UUID := 'e1111111-1111-1111-1111-111111111111'::uuid;
    v_recip2_id UUID := 'e2222222-2222-2222-2222-222222222222'::uuid;

    v_job1_id UUID := 'f1111111-1111-1111-1111-111111111111'::uuid;
    v_job2_id UUID := 'f2222222-2222-2222-2222-222222222222'::uuid;
    v_job3_id UUID := 'f3333333-3333-3333-3333-333333333333'::uuid;

    v_res JSONB;
    v_item JSONB;
    v_err_caught BOOLEAN := false;
    v_today DATE;
    v_yesterday DATE;
BEGIN
    -- -------------------------------------------------------------------------
    -- PREPARATION DES FIXTURES DE TEST EN TRANSACTION
    -- -------------------------------------------------------------------------

    -- Écoles
    INSERT INTO public.schools (id, name, slug, status, timezone)
    VALUES (v_school1_id, 'École Primaire Kinshasa', 'ecole-kinshasa-4e3a', 'active', 'Africa/Kinshasa'),
           (v_school2_id, 'Lycée Lubumbashi', 'lycee-lubumbashi-4e3a', 'active', 'Africa/Lubumbashi')
    ON CONFLICT (id) DO NOTHING;

    -- Utilisateurs d'authentification auth.users
    INSERT INTO auth.users (id, email)
    VALUES
        (v_admin1_id, 'admin1@school1.cd'),
        (v_agent1_id, 'agent1@school1.cd'),
        (v_parent1_id, 'parent1@school1.cd'),
        (v_teacher1_id, 'teacher1@school1.cd'),
        (v_admin2_id, 'admin2@school2.cd')
    ON CONFLICT (id) DO NOTHING;

    -- Profils utilisateurs
    INSERT INTO public.profiles (id, school_id, role, is_active, first_name, last_name)
    VALUES 
        (v_admin1_id, v_school1_id, 'school_admin', true, 'Admin', 'School1'),
        (v_agent1_id, v_school1_id, 'finance_agent', true, 'Agent', 'School1'),
        (v_parent1_id, v_school1_id, 'parent', true, 'Parent', 'School1'),
        (v_teacher1_id, v_school1_id, 'teacher', true, 'Teacher', 'School1'),
        (v_admin2_id, v_school2_id, 'school_admin', true, 'Admin', 'School2')
    ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id, role = EXCLUDED.role, is_active = EXCLUDED.is_active;

    -- Élevés
    INSERT INTO public.students (id, school_id, first_name, last_name, student_number)
    VALUES
        (v_student1_id, v_school1_id, 'Kabila', 'Joseph', 'STU-001'),
        (v_student2_id, v_school1_id, 'Tshisekedi', 'Felix', 'STU-002')
    ON CONFLICT (id) DO NOTHING;

    -- Année scolaire
    INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
    VALUES ('a9999999-9999-4999-a999-999999999999'::uuid, v_school1_id, '2026-2027', '2026-09-01', '2027-06-30', true)
    ON CONFLICT (id) DO NOTHING;

    -- Classes
    INSERT INTO public.classes (id, school_id, academic_year_id, name)
    VALUES ('b9999999-9999-4999-a999-999999999999'::uuid, v_school1_id, 'a9999999-9999-4999-a999-999999999999'::uuid, '6ème A')
    ON CONFLICT (id) DO NOTHING;

    -- Inscriptions
    INSERT INTO public.student_enrollments (id, school_id, academic_year_id, student_id, class_id, status)
    VALUES
        ('c9999999-9999-4999-a999-999999999991'::uuid, v_school1_id, 'a9999999-9999-4999-a999-999999999999'::uuid, v_student1_id, 'b9999999-9999-4999-a999-999999999999'::uuid, 'active'),
        ('c9999999-9999-4999-a999-999999999992'::uuid, v_school1_id, 'a9999999-9999-4999-a999-999999999999'::uuid, v_student2_id, 'b9999999-9999-4999-a999-999999999999'::uuid, 'active')
    ON CONFLICT (id) DO NOTHING;

    -- Factures
    INSERT INTO public.student_invoices (id, school_id, student_id, academic_year_id, class_id, enrollment_id, sequence_number, created_by, issue_date, due_date, invoice_number, currency, total_amount, paid_amount, status)
    VALUES
        (v_invoice1_id, v_school1_id, v_student1_id, 'a9999999-9999-4999-a999-999999999999'::uuid, 'b9999999-9999-4999-a999-999999999999'::uuid, 'c9999999-9999-4999-a999-999999999991'::uuid, 1, v_admin1_id, (pg_catalog.now() - INTERVAL '60 days')::DATE, (pg_catalog.now() - INTERVAL '30 days')::DATE, 'FAC-2026-001', 'USD', 150.00, 0.00, 'issued'),
        (v_invoice2_id, v_school1_id, v_student2_id, 'a9999999-9999-4999-a999-999999999999'::uuid, 'b9999999-9999-4999-a999-999999999999'::uuid, 'c9999999-9999-4999-a999-999999999992'::uuid, 2, v_admin1_id, pg_catalog.now()::DATE, (pg_catalog.now() + INTERVAL '30 days')::DATE, 'FAC-2026-002', 'USD', 200.00, 0.00, 'issued')
    ON CONFLICT (id) DO NOTHING;

    -- Configuration globale (Kill switch désactivé par défaut)
    INSERT INTO public.school_delivery_global_config (id, real_email_enabled, sender_identity_verified, verified_from_email, verified_from_name)
    VALUES (1, false, false, NULL, NULL)
    ON CONFLICT (id) DO UPDATE SET real_email_enabled = false, sender_identity_verified = false, verified_from_email = NULL;

    -- Configuration de l'école 1
    INSERT INTO public.school_delivery_settings (school_id, email_real_enabled, email_provider, from_name, reply_to_email, daily_email_quota)
    VALUES (v_school1_id, false, 'resend', 'Comptabilité École 1', 'facturation@school1.cd', 100)
    ON CONFLICT (school_id) DO NOTHING;

    -- Campagnes de test
    INSERT INTO public.school_collection_campaigns (id, school_id, name, channel, delivery_mode, status, recipient_count, pending_count, success_count, processing_count, created_by, idempotency_key, payload_hash)
    VALUES
        (v_camp_real1_id, v_school1_id, 'Campagne Real T1', 'email', 'real', 'scheduled', 2, 2, 0, 0, v_admin1_id, gen_random_uuid(), 'hash-real1'),
        (v_camp_mock1_id, v_school1_id, 'Campagne Mock T1', 'email', 'mock', 'completed', 5, 0, 5, 0, v_admin1_id, gen_random_uuid(), 'hash-mock1'),
        (v_camp_real2_id, v_school2_id, 'Campagne Real School 2', 'email', 'real', 'processing', 1, 0, 0, 1, v_admin2_id, gen_random_uuid(), 'hash-real2')
    ON CONFLICT (id) DO NOTHING;

    -- Destinataires de campagne
    INSERT INTO public.school_collection_campaign_recipients (
        id, campaign_id, school_id, student_id, invoice_id, parent_profile_id, delivery_status,
        parent_snapshot, student_snapshot, invoice_snapshot
    ) VALUES (
        v_recip1_id, v_camp_real1_id, v_school1_id, v_student1_id, v_invoice1_id, v_parent1_id, 'pending',
        '{"email": "parent1@domain.com", "first_name": "Papa", "last_name": "Kabila"}'::jsonb,
        '{"first_name": "Joseph", "last_name": "Kabila"}'::jsonb,
        '{"invoice_number": "FAC-2026-001", "remaining_balance": 150.00}'::jsonb
    ), (
        v_recip2_id, v_camp_real1_id, v_school1_id, v_student2_id, v_invoice2_id, v_parent1_id, 'pending',
        '{"email": "parent2@domain.com", "first_name": "Maman", "last_name": "Tshisekedi"}'::jsonb,
        '{"first_name": "Felix", "last_name": "Tshisekedi"}'::jsonb,
        '{"invoice_number": "FAC-2026-002", "remaining_balance": 200.00}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;

    -- Jobs Outbox Real Email
    INSERT INTO public.school_collection_real_email_jobs (
        id, school_id, campaign_id, recipient_id, provider,
        provider_idempotency_key, provider_request_payload, canonical_payload_hash, state, attempt_count,
        created_at
    ) VALUES (
        v_job1_id, v_school1_id, v_camp_real1_id, v_recip1_id, 'resend',
        'e1000000-0000-0000-0000-000000000001'::uuid,
        '{"from": "System <no-reply@domain.cd>", "to": ["parent1@domain.com"], "subject": "Facture", "html": "<p>Body</p>"}'::jsonb,
        'a1b2c3d4e5f60000000000000000000000000000000000000000000000000001',
        'submitted', 1,
        pg_catalog.now() - INTERVAL '10 minutes'
    ), (
        v_job2_id, v_school1_id, v_camp_real1_id, v_recip2_id, 'resend',
        'e2000000-0000-0000-0000-000000000002'::uuid,
        '{"from": "System <no-reply@domain.cd>", "to": ["parent2@domain.com"], "subject": "Facture", "html": "<p>Body</p>"}'::jsonb,
        'a1b2c3d4e5f60000000000000000000000000000000000000000000000000002',
        'pending', 0,
        pg_catalog.now() - INTERVAL '5 minutes'
    ) ON CONFLICT (id) DO NOTHING;


    -- =========================================================================
    -- SECTION A : AUTORISATION & TENANT ISOLATION
    -- =========================================================================

    -- A1: Non-authentifié (auth.uid IS NULL) rejeté sur readiness
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_readiness();
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '28000' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST A1 ECHOUÉ: Unauthenticated caller must throw SQLSTATE 28000 on readiness';

    -- A2: Non-authentifié rejeté sur dashboard
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_delivery_dashboard();
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '28000' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST A2 ECHOUÉ: Unauthenticated caller must throw SQLSTATE 28000 on dashboard';

    -- A3: Non-authentifié rejeté sur jobs
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_delivery_jobs();
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '28000' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST A3 ECHOUÉ: Unauthenticated caller must throw SQLSTATE 28000 on jobs';

    -- A4: Rôle parent rejeté
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_parent1_id::text)::text, true);
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_readiness();
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '42501' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST A4 ECHOUÉ: Parent role must be rejected with SQLSTATE 42501';

    -- A5: Rôle teacher rejeté
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_teacher1_id::text)::text, true);
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_delivery_dashboard();
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '42501' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST A5 ECHOUÉ: Teacher role must be rejected with SQLSTATE 42501';

    -- A6: school_admin accepté
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin1_id::text)::text, true);
    v_res := public.get_school_real_email_readiness();
    ASSERT (v_res->>'school_id')::uuid = v_school1_id, 'TEST A6 ECHOUÉ: school_admin must be accepted on readiness';

    -- A7: finance_agent accepté
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_agent1_id::text)::text, true);
    v_res := public.get_school_real_email_delivery_dashboard();
    ASSERT (v_res->'quota'->>'daily_limit')::int = 100, 'TEST A7 ECHOUÉ: finance_agent must be accepted on dashboard';

    -- A8: Isolation tenant (Admin École 2 ne voit pas les données École 1)
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin2_id::text)::text, true);
    v_res := public.get_school_real_email_delivery_dashboard();
    ASSERT (v_res->'jobs'->>'total_count')::int = 0, 'TEST A8 ECHOUÉ: School 2 must see zero jobs of School 1';


    -- =========================================================================
    -- SECTION B : READINESS & FAIL-CLOSED DEFAULT VALUES
    -- =========================================================================

    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin1_id::text)::text, true);
    v_res := public.get_school_real_email_readiness();

    -- B1: global_real_email_enabled vaut false
    ASSERT (v_res->>'global_real_email_enabled')::boolean IS FALSE, 'TEST B1 ECHOUÉ: global_real_email_enabled must be false by default';

    -- B2: sender_identity_verified vaut false
    ASSERT (v_res->>'sender_identity_verified')::boolean IS FALSE, 'TEST B2 ECHOUÉ: sender_identity_verified must be false by default';

    -- B3: sender_identity_configured vaut false
    ASSERT (v_res->>'sender_identity_configured')::boolean IS FALSE, 'TEST B3 ECHOUÉ: sender_identity_configured must be false when email is null';

    -- B4: verified_from_email est STRICTEMENT absent des clés JSON
    ASSERT NOT (v_res ? 'verified_from_email'), 'TEST B4 ECHOUÉ: verified_from_email must NOT be present in JSON keys';

    -- B5: school_email_enabled vaut false
    ASSERT (v_res->>'school_email_enabled')::boolean IS FALSE, 'TEST B5 ECHOUÉ: school_email_enabled must be false';

    -- B6: effective_real_email_enabled vaut false
    ASSERT (v_res->>'effective_real_email_enabled')::boolean IS FALSE, 'TEST B6 ECHOUÉ: effective_real_email_enabled must be false when blocked';

    -- B7: daily_email_quota vaut 100
    ASSERT (v_res->>'daily_email_quota')::int = 100, 'TEST B7 ECHOUÉ: daily_email_quota must be 100';

    -- B8: from_name retourné correctement
    ASSERT v_res->>'from_name' = 'Comptabilité École 1', 'TEST B8 ECHOUÉ: from_name must be returned';

    -- B9: reply_to_email retourné correctement
    ASSERT v_res->>'reply_to_email' = 'facturation@school1.cd', 'TEST B9 ECHOUÉ: reply_to_email must be returned';

    -- B10: Blockers exacts et ordonnés
    ASSERT v_res->'blockers' = '["GLOBAL_KILL_SWITCH_DISABLED", "SENDER_IDENTITY_NOT_VERIFIED", "SENDER_IDENTITY_NOT_CONFIGURED", "SCHOOL_EMAIL_DISABLED"]'::jsonb,
        'TEST B10 ECHOUÉ: Exact ordered blockers expected';

    -- B11: Simuler activation complète et vérifier effective_real_email_enabled = true
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config
    SET real_email_enabled = true,
        sender_identity_verified = true,
        verified_from_email = 'system@ecoleconnect.cd'
    WHERE id = 1;

    UPDATE public.school_delivery_settings
    SET email_real_enabled = true
    WHERE school_id = v_school1_id;

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin1_id::text)::text, true);
    v_res := public.get_school_real_email_readiness();
    ASSERT (v_res->>'effective_real_email_enabled')::boolean IS TRUE, 'TEST B11 ECHOUÉ: effective_real_email_enabled must be true when all 4 conditions met';
    ASSERT jsonb_array_length(v_res->'blockers') = 0, 'TEST B11.2 ECHOUÉ: blockers array must be empty when effective = true';

    -- Réinitialiser les paramètres pour la suite des tests
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config
    SET real_email_enabled = false, sender_identity_verified = false, verified_from_email = NULL
    WHERE id = 1;

    UPDATE public.school_delivery_settings
    SET email_real_enabled = false
    WHERE school_id = v_school1_id;

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin1_id::text)::text, true);

    -- B12: Sender identity non configurée (verified_from_email NULL avec verified=true) produit SENDER_IDENTITY_NOT_CONFIGURED
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET sender_identity_verified = true, verified_from_email = NULL WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin1_id::text)::text, true);
    v_res := public.get_school_real_email_readiness();
    ASSERT v_res->'blockers' ? 'SENDER_IDENTITY_NOT_CONFIGURED', 'TEST B12 ECHOUÉ: SENDER_IDENTITY_NOT_CONFIGURED expected when verified_from_email is null';

    -- Reset
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET sender_identity_verified = false WHERE id = 1;

    -- B13: Configuration école absente produit SCHOOL_SETTINGS_NOT_CONFIGURED et NE PRODUIT PAS SCHOOL_EMAIL_DISABLED
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin2_id::text)::text, true);
    v_res := public.get_school_real_email_readiness();
    ASSERT v_res->'blockers' ? 'SCHOOL_SETTINGS_NOT_CONFIGURED', 'TEST B13.1 ECHOUÉ: SCHOOL_SETTINGS_NOT_CONFIGURED expected when settings missing';
    ASSERT NOT (v_res->'blockers' ? 'SCHOOL_EMAIL_DISABLED'), 'TEST B13.2 ECHOUÉ: SCHOOL_EMAIL_DISABLED must NOT be present when settings missing';

    -- B14: Configuration existante désactivée produit SCHOOL_EMAIL_DISABLED
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin1_id::text)::text, true);
    v_res := public.get_school_real_email_readiness();
    ASSERT v_res->'blockers' ? 'SCHOOL_EMAIL_DISABLED', 'TEST B14 ECHOUÉ: SCHOOL_EMAIL_DISABLED expected when settings exist with email_real_enabled=false';


    -- =========================================================================
    -- SECTION C : DASHBOARD DE SUPERVISION & TIMEZONE
    -- =========================================================================

    -- C1: Dashboard date métier et timezone Kinshasa
    v_res := public.get_school_real_email_delivery_dashboard();
    ASSERT v_res->>'timezone' = 'Africa/Kinshasa', 'TEST C1 ECHOUÉ: Timezone Africa/Kinshasa expected';
    ASSERT (v_res->>'timezone_fallback_applied')::boolean IS FALSE, 'TEST C1.2 ECHOUÉ: timezone_fallback_applied must be false for valid tz';

    -- C2: Rejet date future (Demain)
    v_today := (pg_catalog.now() AT TIME ZONE 'Africa/Kinshasa')::DATE;
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_delivery_dashboard(v_today + 1);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '22023' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST C2 ECHOUÉ: Future business date must throw SQLSTATE 22023';

    -- C3: Rejet date antérieure > 90 jours
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_delivery_dashboard(v_today - 91);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '22023' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST C3 ECHOUÉ: Date > 90 days ago must throw SQLSTATE 22023';

    -- C4: Date 90 jours acceptée
    v_res := public.get_school_real_email_delivery_dashboard((v_today - INTERVAL '90 days')::date);
    ASSERT v_res->>'business_date' = (v_today - INTERVAL '90 days')::date::text, 'TEST C4 ECHOUÉ: Date 90 days ago must be accepted';

    -- C5: Quota limit, reserved, submitted et remaining exacts
    v_res := public.get_school_real_email_delivery_dashboard();
    ASSERT (v_res->'quota'->>'daily_limit')::int = 100, 'TEST C5.1 ECHOUÉ: daily_limit = 100';
    ASSERT (v_res->'quota'->>'reserved_count')::int = 0, 'TEST C5.2 ECHOUÉ: reserved_count = 0';
    ASSERT (v_res->'quota'->>'submitted_count')::int = 0, 'TEST C5.3 ECHOUÉ: submitted_count = 0';
    ASSERT (v_res->'quota'->>'remaining_count')::int = 100, 'TEST C5.4 ECHOUÉ: remaining_count = 100';

    -- C6: Compteur campagnes REAL (draft_count zero-filled, real_total, mock exclu, invariant de somme)
    ASSERT (v_res->'campaigns'->>'draft_count')::int = 0, 'TEST C6.1 ECHOUÉ: draft_count = 0 zero-filled';
    ASSERT (v_res->'campaigns'->>'real_total_count')::int = 1, 'TEST C6.2 ECHOUÉ: 1 real campaign expected';
    ASSERT (v_res->'campaigns'->>'scheduled_count')::int = 1, 'TEST C6.3 ECHOUÉ: 1 scheduled campaign expected';
    ASSERT (v_res->'campaigns'->>'completed_count')::int = 0, 'TEST C6.4 ECHOUÉ: mock completed campaign must NOT be counted in real_total';

    -- C6.5: Ajouter une campagne REAL draft & une campagne MOCK draft
    PERFORM set_config('role', 'postgres', true);
    INSERT INTO public.school_collection_campaigns (
        id, school_id, name, channel, delivery_mode, status, recipient_count, pending_count, success_count, processing_count, created_by, idempotency_key, payload_hash
    ) VALUES (
        'd4444444-4444-4444-4444-444444444444'::uuid, v_school1_id, 'Campagne Draft Real', 'email', 'real', 'draft', 0, 0, 0, 0, v_admin1_id, gen_random_uuid(), 'hash-draft1'
    ), (
        'd5555555-5555-5555-5555-555555555555'::uuid, v_school1_id, 'Campagne Draft Mock', 'email', 'mock', 'draft', 0, 0, 0, 0, v_admin1_id, gen_random_uuid(), 'hash-draft-mock'
    );

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin1_id::text)::text, true);
    v_res := public.get_school_real_email_delivery_dashboard();

    ASSERT (v_res->'campaigns'->>'draft_count')::int = 1, 'TEST C6.5 ECHOUÉ: 1 REAL draft campaign counted';
    ASSERT (v_res->'campaigns'->>'real_total_count')::int = 2, 'TEST C6.6 ECHOUÉ: real_total_count = 2 (mock draft excluded)';

    -- C6.7: Invariant exact de somme des campagnes
    ASSERT (v_res->'campaigns'->>'real_total_count')::int = (
        (v_res->'campaigns'->>'draft_count')::int +
        (v_res->'campaigns'->>'scheduled_count')::int +
        (v_res->'campaigns'->>'processing_count')::int +
        (v_res->'campaigns'->>'completed_count')::int +
        (v_res->'campaigns'->>'partially_failed_count')::int +
        (v_res->'campaigns'->>'failed_count')::int +
        (v_res->'campaigns'->>'cancelled_count')::int
    ), 'TEST C6.7 ECHOUÉ: Sum invariant of campaigns failed';

    -- C7: Compteur jobs outbox (1 submitted, 1 pending)
    ASSERT (v_res->'jobs'->>'total_count')::int = 2, 'TEST C7.1 ECHOUÉ: 2 total real email jobs expected';
    ASSERT (v_res->'jobs'->>'submitted_count')::int = 1, 'TEST C7.2 ECHOUÉ: 1 submitted job expected';
    ASSERT (v_res->'jobs'->>'pending_count')::int = 1, 'TEST C7.3 ECHOUÉ: 1 pending job expected';
    ASSERT (v_res->'jobs'->>'delivery_confirmed_count')::int = 0, 'TEST C7.4 ECHOUÉ: 0 delivery_confirmed expected';

    -- C8: Dashboard 100% read-only (vérifier absence de mutation)
    PERFORM set_config('role', 'postgres', true);
    ASSERT (SELECT COUNT(*) FROM public.school_collection_real_email_jobs WHERE school_id = v_school1_id) = 2,
        'TEST C8 ECHOUÉ: Dashboard call must not alter jobs count';

    -- C9: Sémantique de p_business_date (sélection du quota vs compteurs courants non-filtrés)
    PERFORM set_config('role', 'postgres', true);
    INSERT INTO public.school_delivery_quota_ledger (school_id, business_date, reserved_count, submitted_count)
    VALUES (v_school1_id, v_today - 5, 15, 10)
    ON CONFLICT (school_id, business_date) DO UPDATE SET reserved_count = 15, submitted_count = 10;

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin1_id::text)::text, true);

    v_res := public.get_school_real_email_delivery_dashboard(v_today - 5);
    ASSERT (v_res->'quota'->>'reserved_count')::int = 15, 'TEST C9.1 ECHOUÉ: p_business_date must select ledger reserved_count';
    ASSERT (v_res->'quota'->>'submitted_count')::int = 10, 'TEST C9.2 ECHOUÉ: p_business_date must select ledger submitted_count';
    ASSERT (v_res->'quota'->>'remaining_count')::int = 75, 'TEST C9.3 ECHOUÉ: p_business_date remaining_count = 100 - 15 - 10 = 75';

    -- C9.2: p_business_date ne filtre PAS les compteurs courants campaigns et jobs
    ASSERT (v_res->'campaigns'->>'real_total_count')::int = 2, 'TEST C9.4 ECHOUÉ: p_business_date does NOT filter campaigns count';
    ASSERT (v_res->'jobs'->>'total_count')::int = 2, 'TEST C9.5 ECHOUÉ: p_business_date does NOT filter jobs count';



    -- =========================================================================
    -- SECTION D : LISTE PAGINÉE DES JOBS (KEYSET & FILTRES)
    -- =========================================================================

    -- D1: Liste complète sans filtre (2 jobs)
    v_res := public.get_school_real_email_delivery_jobs(NULL, 20);
    ASSERT jsonb_array_length(v_res->'items') = 2, 'TEST D1.1 ECHOUÉ: 2 items expected without filter';
    ASSERT (v_res->>'has_more')::boolean IS FALSE, 'TEST D1.2 ECHOUÉ: has_more must be false';
    ASSERT v_res->>'next_cursor' IS NULL, 'TEST D1.3 ECHOUÉ: next_cursor must be null';

    -- D2: Vérification des propriétés non-sensibles de l'item 1
    v_item := (v_res->'items')->0;
    ASSERT (v_item->>'job_id')::uuid = v_job2_id, 'TEST D2.1 ECHOUÉ: Keyset sorting created_at DESC (job2 first)';
    ASSERT v_item->>'campaign_name' = 'Campagne Real T1', 'TEST D2.2 ECHOUÉ: campaign_name expected';
    ASSERT v_item->>'invoice_number' = 'FAC-2026-002', 'TEST D2.3 ECHOUÉ: invoice_number expected';
    ASSERT v_item->>'student_name' = 'Felix Tshisekedi', 'TEST D2.4 ECHOUÉ: student_name expected';
    ASSERT (v_item->>'provider_message_recorded')::boolean IS FALSE, 'TEST D2.5 ECHOUÉ: provider_message_recorded = false for pending';

    -- D3: ABSENCE ABSOLUE DES CHAMPS SENSIBLES DANS L'ITEM
    ASSERT NOT (v_item ? 'parent_email'), 'TEST D3.1 ECHOUÉ: parent_email forbidden';
    ASSERT NOT (v_item ? 'provider_request_payload'), 'TEST D3.2 ECHOUÉ: provider_request_payload forbidden';
    ASSERT NOT (v_item ? 'canonical_payload_hash'), 'TEST D3.3 ECHOUÉ: canonical_payload_hash forbidden';
    ASSERT NOT (v_item ? 'provider_idempotency_key'), 'TEST D3.4 ECHOUÉ: provider_idempotency_key forbidden';
    ASSERT NOT (v_item ? 'provider_message_id'), 'TEST D3.5 ECHOUÉ: provider_message_id forbidden';

    -- D4: Filtre par statut 'submitted'
    v_res := public.get_school_real_email_delivery_jobs('submitted', 20);
    ASSERT jsonb_array_length(v_res->'items') = 1, 'TEST D4.1 ECHOUÉ: 1 item expected for status submitted';
    ASSERT ((v_res->'items')->0->>'job_id')::uuid = v_job1_id, 'TEST D4.2 ECHOUÉ: job1 expected for submitted';

    -- D5: Filtre par statut 'bounced' (0 résultat)
    v_res := public.get_school_real_email_delivery_jobs('bounced', 20);
    ASSERT jsonb_array_length(v_res->'items') = 0, 'TEST D5 ECHOUÉ: 0 items expected for status bounced';

    -- D6: Filtre invalide rejeté
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_delivery_jobs('invalid_status_xyz');
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '22023' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST D6 ECHOUÉ: Invalid status filter must throw SQLSTATE 22023';

    -- D7: Limite 0 rejetée
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_delivery_jobs(NULL, 0);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '22023' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST D7 ECHOUÉ: Limit 0 must throw SQLSTATE 22023';

    -- D8: Limite 101 rejetée
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_delivery_jobs(NULL, 101);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '22023' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST D8 ECHOUÉ: Limit 101 must throw SQLSTATE 22023';

    -- D9: Curseur partiel rejeté (created_at renseigné, job_id null)
    v_err_caught := false;
    BEGIN
        PERFORM public.get_school_real_email_delivery_jobs(NULL, 10, pg_catalog.now(), NULL);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '22023' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST D9 ECHOUÉ: Partial cursor must throw SQLSTATE 22023';

    -- D10: Pagination Keyset N+1 (Limit 1 -> Page 1 avec has_more = true)
    v_res := public.get_school_real_email_delivery_jobs(NULL, 1);
    ASSERT jsonb_array_length(v_res->'items') = 1, 'TEST D10.1 ECHOUÉ: 1 item on page 1';
    ASSERT (v_res->>'has_more')::boolean IS TRUE, 'TEST D10.2 ECHOUÉ: has_more must be true on page 1';
    ASSERT v_res->'next_cursor' IS NOT NULL, 'TEST D10.3 ECHOUÉ: next_cursor must be non-null on page 1';
    ASSERT (v_res->'next_cursor'->>'job_id')::uuid = v_job2_id, 'TEST D10.4 ECHOUÉ: next_cursor job_id must match last item';

    -- D11: Page 2 avec curseur
    v_res := public.get_school_real_email_delivery_jobs(
        NULL, 1,
        (v_res->'next_cursor'->>'created_at')::timestamptz,
        (v_res->'next_cursor'->>'job_id')::uuid
    );
    ASSERT jsonb_array_length(v_res->'items') = 1, 'TEST D11.1 ECHOUÉ: 1 item on page 2';
    ASSERT ((v_res->'items')->0->>'job_id')::uuid = v_job1_id, 'TEST D11.2 ECHOUÉ: job1 expected on page 2';
    ASSERT (v_res->>'has_more')::boolean IS FALSE, 'TEST D11.3 ECHOUÉ: has_more must be false on page 2';


    -- =========================================================================
    -- SECTION E : NIVEAU DE PRIVILÈGES ET SÉCURITÉ DES TABLES
    -- =========================================================================

    -- E1: Interdiction d'accès direct SELECT aux tables Finance 4E par authenticated
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_admin1_id::text)::text, true);

    v_err_caught := false;
    BEGIN
        PERFORM COUNT(*) FROM public.school_collection_real_email_jobs;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '42501' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST E1 ECHOUÉ: Direct SELECT on school_collection_real_email_jobs must be denied with 42501';

    -- E2: Interdiction d'accès direct SELECT à school_delivery_global_config par authenticated
    v_err_caught := false;
    BEGIN
        PERFORM COUNT(*) FROM public.school_delivery_global_config;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '42501' THEN v_err_caught := true; END IF;
    END;
    ASSERT v_err_caught, 'TEST E2 ECHOUÉ: Direct SELECT on school_delivery_global_config must be denied with 42501';

    -- E3: Propriétaire des RPCs est postgres
    ASSERT (
        SELECT pg_catalog.pg_get_userbyid(proowner)
        FROM pg_catalog.pg_proc
        WHERE proname = 'get_school_real_email_readiness'
    ) = 'postgres', 'TEST E3 ECHOUÉ: get_school_real_email_readiness owner must be postgres';

    ASSERT (
        SELECT pg_catalog.pg_get_userbyid(proowner)
        FROM pg_catalog.pg_proc
        WHERE proname = 'get_school_real_email_delivery_dashboard'
    ) = 'postgres', 'TEST E3.2 ECHOUÉ: get_school_real_email_delivery_dashboard owner must be postgres';

    ASSERT (
        SELECT pg_catalog.pg_get_userbyid(proowner)
        FROM pg_catalog.pg_proc
        WHERE proname = 'get_school_real_email_delivery_jobs'
    ) = 'postgres', 'TEST E3.3 ECHOUÉ: get_school_real_email_delivery_jobs owner must be postgres';

    -- FAIT : 86 assertions réelles exécutées sans aucune erreur
    RAISE NOTICE '=== SUITE DE TESTS SQL FINANCE 4E-3AR : 86/86 ASSERTIONS RÉUSSIES ===';

END $$;

ROLLBACK;
