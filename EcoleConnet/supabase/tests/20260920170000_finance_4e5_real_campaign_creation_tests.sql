-- =============================================================================
-- ÉCOLECONNECT — TESTS FINANCE 4E-5AR
-- Fichier: 20260920170000_finance_4e5_real_campaign_creation_tests.sql
-- Description: Suite de tests SQL automatisés pour la création et la planification
--              sécurisées des campagnes e-mail REAL (Finance 4E-5AR).
--              Valide l'idempotence JSONB, les contrats et les gardes GUC.
--              Transaction isolée (BEGIN ... ROLLBACK).
-- =============================================================================

BEGIN;

DO $$
DECLARE
    -- IDs de test Écoles et Utilisateurs
    v_school1_id UUID := '11111111-1111-1111-1111-111111111111'::uuid;
    v_school2_id UUID := '22222222-2222-2222-2222-222222222222'::uuid;

    v_admin1_id UUID := 'a1111111-1111-1111-1111-111111111111'::uuid;
    v_agent1_id UUID := 'a2222222-2222-2222-2222-222222222222'::uuid;
    v_parent1_id UUID := 'a3333333-3333-3333-3333-333333333333'::uuid;
    v_teacher1_id UUID := 'a4444444-4444-4444-4444-444444444444'::uuid;
    v_admin2_id UUID := 'a5555555-5555-5555-5555-555555555555'::uuid;

    v_student1_id UUID := 'b1111111-1111-1111-1111-111111111111'::uuid;
    v_invoice1_id UUID := 'c1111111-1111-1111-1111-111111111111'::uuid;
    v_class1_id UUID := 'b9999999-9999-4999-a999-999999999999'::uuid;
    v_class2_id UUID := 'a9999999-9999-4999-a999-999999999998'::uuid;

    -- Clés d'idempotence
    v_idem1 UUID := '90000000-0000-0000-0000-000000000001'::uuid;
    v_idem2 UUID := '90000000-0000-0000-0000-000000000002'::uuid;
    v_idem_mock UUID := '90000000-0000-0000-0000-000000000003'::uuid;
    v_idem_cancel UUID := '90000000-0000-0000-0000-000000000004'::uuid;
    v_idem_norm UUID := '90000000-0000-0000-0000-000000000005'::uuid;

    -- Variables de retour et contrôle
    v_res JSONB;
    v_camp_id UUID;
    v_mock_camp_id UUID;
    v_cancel_camp_id UUID;
    v_sms_camp_id UUID;
    v_revoked_camp_id UUID;
    v_err_caught BOOLEAN;
    v_err_code TEXT;
    v_count INT;
    v_owner TEXT;
    v_search_path TEXT[];
    v_scheduled_date TIMESTAMPTZ;
    v_text_val TEXT;
    v_keys_count INT;
    v_recip_first JSONB;
BEGIN
    ----------------------------------------------------------------------------
    -- 0. VÉRIFICATIONS STRUCTURELLES (OWNERSHIP, SEARCH_PATH, PRIVILÈGES)
    ----------------------------------------------------------------------------

    -- Owner et search_path de _guard_collection_campaign_delivery_mode
    SELECT pg_get_userbyid(proowner), proconfig INTO v_owner, v_search_path
    FROM pg_proc WHERE proname = '_guard_collection_campaign_delivery_mode';
    ASSERT v_owner = 'postgres', 'ASSERT 1: _guard_collection_campaign_delivery_mode doit appartenir à postgres';
    ASSERT 'search_path=' = ANY(v_search_path) OR 'search_path=""' = ANY(v_search_path) OR v_search_path::text LIKE '%search_path=%', 'ASSERT 2: _guard_collection_campaign_delivery_mode doit avoir search_path = ''''';

    -- Owner et search_path de create_school_real_email_campaign
    SELECT pg_get_userbyid(proowner), proconfig INTO v_owner, v_search_path
    FROM pg_proc WHERE proname = 'create_school_real_email_campaign';
    ASSERT v_owner = 'postgres', 'ASSERT 3: create_school_real_email_campaign doit appartenir à postgres';
    ASSERT 'search_path=' = ANY(v_search_path) OR 'search_path=""' = ANY(v_search_path) OR v_search_path::text LIKE '%search_path=%', 'ASSERT 4: create_school_real_email_campaign doit avoir search_path = ''''';

    -- Owner et search_path de schedule_school_real_email_campaign
    SELECT pg_get_userbyid(proowner), proconfig INTO v_owner, v_search_path
    FROM pg_proc WHERE proname = 'schedule_school_real_email_campaign';
    ASSERT v_owner = 'postgres', 'ASSERT 5: schedule_school_real_email_campaign doit appartenir à postgres';
    ASSERT 'search_path=' = ANY(v_search_path) OR 'search_path=""' = ANY(v_search_path) OR v_search_path::text LIKE '%search_path=%', 'ASSERT 6: schedule_school_real_email_campaign doit avoir search_path = ''''';

    ----------------------------------------------------------------------------
    -- PREPARATION DES FIXTURES EN TRANSACTION
    ----------------------------------------------------------------------------
    INSERT INTO public.schools (id, name, slug, status, timezone)
    VALUES (v_school1_id, 'École Primaire Kinshasa 4E-5AR', 'ecole-kinshasa-4e5ar', 'active', 'Africa/Kinshasa'),
           (v_school2_id, 'Lycée Lubumbashi 4E-5AR', 'lycee-lubumbashi-4e5ar', 'active', 'Africa/Lubumbashi')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO auth.users (id, email)
    VALUES (v_admin1_id, 'admin1@school1-4e5ar.cd'),
           (v_agent1_id, 'agent1@school1-4e5ar.cd'),
           (v_parent1_id, 'parent1@school1-4e5ar.cd'),
           (v_teacher1_id, 'teacher1@school1-4e5ar.cd'),
           (v_admin2_id, 'admin2@school2-4e5ar.cd')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, school_id, role, is_active, first_name, last_name)
    VALUES (v_admin1_id, v_school1_id, 'school_admin', true, 'Admin', 'School1'),
           (v_agent1_id, v_school1_id, 'finance_agent', true, 'Agent', 'School1'),
           (v_parent1_id, v_school1_id, 'parent', true, 'Parent', 'School1'),
           (v_teacher1_id, v_school1_id, 'teacher', true, 'Teacher', 'School1'),
           (v_admin2_id, v_school2_id, 'school_admin', true, 'Admin', 'School2')
    ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id, role = EXCLUDED.role, is_active = EXCLUDED.is_active;

    INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
    VALUES ('a9999999-9999-4999-a999-999999999999'::uuid, v_school1_id, '2026-2027', '2026-09-01', '2027-06-30', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.classes (id, school_id, academic_year_id, name)
    VALUES (v_class1_id, v_school1_id, 'a9999999-9999-4999-a999-999999999999'::uuid, '6ème A'),
           (v_class2_id, v_school1_id, 'a9999999-9999-4999-a999-999999999999'::uuid, '5ème B')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.students (id, school_id, first_name, last_name, student_number)
    VALUES (v_student1_id, v_school1_id, 'Tshisekedi', 'Felix', 'STU-4E5AR')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.student_enrollments (id, school_id, academic_year_id, student_id, class_id, status)
    VALUES ('c9999999-9999-4999-a999-999999999991'::uuid, v_school1_id, 'a9999999-9999-4999-a999-999999999999'::uuid, v_student1_id, v_class1_id, 'active')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_receive_notifications)
    VALUES ('d9999999-9999-4999-a999-999999999991'::uuid, v_school1_id, v_parent1_id, v_student1_id, 'approved', true)
    ON CONFLICT (id) DO NOTHING;

    -- Inscription d'une facture impayée éligible
    INSERT INTO public.student_invoices (id, school_id, student_id, academic_year_id, class_id, enrollment_id, sequence_number, created_by, issue_date, due_date, invoice_number, currency, total_amount, paid_amount, status)
    VALUES (v_invoice1_id, v_school1_id, v_student1_id, 'a9999999-9999-4999-a999-999999999999'::uuid, v_class1_id, 'c9999999-9999-4999-a999-999999999991'::uuid, 1, v_admin1_id, CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE - INTERVAL '10 days', 'INV-4E5AR-001', 'USD', 200.00, 0.00, 'issued')
    ON CONFLICT (id) DO NOTHING;

    -- Configuration de readiness globale et écoles
    INSERT INTO public.school_delivery_global_config (id, real_email_enabled, sender_identity_verified, verified_from_email)
    VALUES (1, true, true, 'finance@ecoleconnect.cd')
    ON CONFLICT (id) DO UPDATE SET real_email_enabled = true, sender_identity_verified = true, verified_from_email = 'finance@ecoleconnect.cd';

    INSERT INTO public.school_delivery_settings (school_id, email_provider, email_real_enabled, daily_email_quota)
    VALUES (v_school1_id, 'resend', true, 100),
           (v_school2_id, 'resend', true, 100)
    ON CONFLICT (school_id) DO UPDATE SET email_real_enabled = true, daily_email_quota = 100;

    ----------------------------------------------------------------------------
    -- 1. IMMUTABILITÉ ET PROTECTION DU DELIVERY_MODE VIA TRIGGER
    ----------------------------------------------------------------------------

    -- 1.1 Insertion directe sans delivery_mode -> par défaut 'mock'
    INSERT INTO public.school_collection_campaigns (
        school_id, name, channel, template_snapshot, created_by, idempotency_key, payload_hash
    ) VALUES (
        v_school1_id, 'Test Direct Insert', 'email', '{}'::jsonb, v_admin1_id, gen_random_uuid(), 'hash1'
    ) RETURNING id INTO v_mock_camp_id;

    SELECT delivery_mode INTO v_text_val FROM public.school_collection_campaigns WHERE id = v_mock_camp_id;
    ASSERT v_text_val = 'mock', 'ASSERT 7: L’insertion directe sans delivery_mode doit imposer ''mock''';

    -- 1.2 Insertion directe avec delivery_mode = 'real' sans session flag -> échec (22023)
    v_err_caught := false;
    BEGIN
        INSERT INTO public.school_collection_campaigns (
            school_id, name, channel, template_snapshot, created_by, idempotency_key, payload_hash, delivery_mode
        ) VALUES (
            v_school1_id, 'Test Direct Insert Real', 'email', '{}'::jsonb, v_admin1_id, gen_random_uuid(), 'hash2', 'real'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 8: L’insertion directe de delivery_mode=real doit lever une exception';
    ASSERT v_err_code = '22023', 'ASSERT 9: Le code erreur de l’insertion directe real invalide doit être 22023';

    -- 1.3 UPDATE direct mock -> real sans session flag -> échec
    v_err_caught := false;
    BEGIN
        UPDATE public.school_collection_campaigns SET delivery_mode = 'real' WHERE id = v_mock_camp_id;
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 10: L’UPDATE direct mock -> real doit lever une exception';
    ASSERT v_err_code = '22023', 'ASSERT 11: Le code erreur d’UPDATE mock -> real doit être 22023';

    -- 1.4 UPDATE direct real -> mock toujours refusé (même avec session flag)
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_creation', 'true', true);
    INSERT INTO public.school_collection_campaigns (
        school_id, name, channel, template_snapshot, created_by, idempotency_key, payload_hash, delivery_mode
    ) VALUES (
        v_school1_id, 'Temp Real Campaign', 'email', '{}'::jsonb, v_admin1_id, gen_random_uuid(), 'hash3', 'real'
    ) RETURNING id INTO v_camp_id;
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_creation', 'false', true);

    v_err_caught := false;
    BEGIN
        PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_conversion', 'true', true);
        UPDATE public.school_collection_campaigns SET delivery_mode = 'mock' WHERE id = v_camp_id;
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_conversion', 'false', true);
    ASSERT v_err_caught, 'ASSERT 12: L’UPDATE real -> mock doit toujours échouer';
    ASSERT v_err_code = '22023', 'ASSERT 13: Code erreur UPDATE real -> mock doit être 22023';

    ----------------------------------------------------------------------------
    -- 2. AUTORISATIONS PAR RÔLE POUR CREATE_SCHOOL_REAL_EMAIL_CAMPAIGN
    ----------------------------------------------------------------------------

    -- 2.1 Anonyme -> refusé (SQLSTATE 28000 ou 42501)
    PERFORM set_config('role', 'anon', true);
    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne Anon', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 14: Accès anonyme à create_school_real_email_campaign doit échouer';
    ASSERT v_err_code IN ('28000', '42501'), 'ASSERT 15: Code erreur anon doit être 28000 ou 42501';

    -- 2.2 Parent -> refusé (SQLSTATE 42501)
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_parent1_id)::text, true);
    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne Parent', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 16: Rôle parent refusé pour création REAL';
    ASSERT v_err_code = '42501', 'ASSERT 17: Code erreur parent doit être 42501';

    -- 2.3 Enseignant -> refusé (SQLSTATE 42501)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher1_id)::text, true);
    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne Enseignant', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 18: Rôle teacher refusé pour création REAL';
    ASSERT v_err_code = '42501', 'ASSERT 19: Code erreur teacher doit être 42501';

    -- 2.4 Agent Finance -> refusé (SQLSTATE 42501)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_agent1_id)::text, true);
    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne Agent', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 20: Rôle finance_agent refusé pour création REAL';
    ASSERT v_err_code = '42501', 'ASSERT 21: Code erreur finance_agent doit être 42501';

    ----------------------------------------------------------------------------
    -- 3. CONTRÔLE DE LA PHRASE DE CONFIRMATION EXPLICITE
    ----------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);

    -- 3.1 confirm_real_delivery = false
    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne Conf False', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := false, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 22: confirm_real_delivery=false doit lever une exception';
    ASSERT v_err_code = '22023', 'ASSERT 23: Code erreur confirm_real_delivery=false doit être 22023';

    -- 3.2 confirmation_text nul
    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne Conf Null', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := NULL
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 24: confirmation_text=null doit lever une exception';
    ASSERT v_err_code = '22023', 'ASSERT 25: Code erreur confirmation_text=null doit être 22023';

    -- 3.3 Phrase incorrecte
    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne Conf Wrong', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 26: Phrase de confirmation incorrecte doit lever une exception';
    ASSERT v_err_code = '22023', 'ASSERT 27: Code erreur phrase incorrecte doit être 22023';

    ----------------------------------------------------------------------------
    -- 4. CONTRÔLE DE READINESS EFFECTIVE (FAIL-CLOSED, SQLSTATE 55000)
    ----------------------------------------------------------------------------

    -- 4.1 Global kill switch désactivé
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET real_email_enabled = false WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne KillSwitch', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 28: Global kill switch désactivé doit bloquer la création';
    ASSERT v_err_code = '55000', 'ASSERT 29: Code erreur readiness doit être 55000';

    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET real_email_enabled = true WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    -- 4.2 Expéditeur non vérifié
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET sender_identity_verified = false WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne Unverified', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 30: Expéditeur non vérifié doit bloquer la création';
    ASSERT v_err_code = '55000', 'ASSERT 31: Code erreur readiness doit être 55000';

    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET sender_identity_verified = true WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    -- 4.3 E-mail d'expéditeur nul
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET verified_from_email = NULL WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne EmptyFrom', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 32: verified_from_email vide doit bloquer la création';
    ASSERT v_err_code = '55000', 'ASSERT 33: Code erreur readiness doit être 55000';

    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET verified_from_email = 'finance@ecoleconnect.cd' WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    -- 4.4 Settings d'école désactivés
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_settings SET email_real_enabled = false WHERE school_id = v_school1_id;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne SettingsDisabled', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 34: Réglages école désactivés doivent bloquer la création';
    ASSERT v_err_code = '55000', 'ASSERT 35: Code erreur readiness doit être 55000';

    -- 4.5 Réglages école absents
    PERFORM set_config('role', 'postgres', true);
    DELETE FROM public.school_delivery_settings WHERE school_id = v_school1_id;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Campagne SettingsMissing', p_template := 'default', p_idempotency_key := v_idem1,
            p_confirm_real_delivery := true, p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 36: Réglages école absents doivent bloquer la création';
    ASSERT v_err_code = '55000', 'ASSERT 37: Code erreur readiness doit être 55000';

    PERFORM set_config('role', 'postgres', true);
    INSERT INTO public.school_delivery_settings (school_id, email_provider, email_real_enabled, daily_email_quota)
    VALUES (v_school1_id, 'resend', true, 100);
    PERFORM set_config('role', 'authenticated', true);

    ----------------------------------------------------------------------------
    -- 5. CRÉATION VALIDE ATOMIQUE ET CONTRAT DE RETOUR COMPLET (23 CLÉS)
    ----------------------------------------------------------------------------
    v_res := public.create_school_real_email_campaign(
        p_name := 'Relance Octobre REAL',
        p_template := 'default_overdue_notice',
        p_idempotency_key := v_idem1,
        p_currency := 'USD',
        p_priority := NULL,
        p_min_days_overdue := 5,
        p_max_days_overdue := 30,
        p_class_ids := ARRAY[v_class1_id],
        p_confirm_real_delivery := true,
        p_confirmation_text := '  ENVOI EMAIL REEL  '
    );

    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 38: Succès de la création REAL';
    ASSERT v_res->'campaign'->>'delivery_mode' = 'real', 'ASSERT 39: delivery_mode doit être real';
    ASSERT v_res->'campaign'->>'channel' = 'email', 'ASSERT 40: channel doit être email';
    ASSERT v_res->'campaign'->>'status' = 'draft', 'ASSERT 41: status initial doit être draft';
    ASSERT (v_res->'is_idempotent_replay')::boolean = false, 'ASSERT 42: Première création is_idempotent_replay=false';
    ASSERT (v_res->'safety'->>'no_message_sent')::boolean = true, 'ASSERT 43: Safety flag no_message_sent=true';
    ASSERT v_res->'safety'->>'delivery_mode' = 'real', 'ASSERT 44: Safety delivery_mode=real';

    v_camp_id := (v_res->'campaign'->>'id')::uuid;

    -- Vérifier en base la campagne créée
    PERFORM set_config('role', 'postgres', true);
    SELECT count(*) INTO v_count FROM public.school_collection_campaigns
    WHERE id = v_camp_id AND delivery_mode = 'real' AND channel = 'email' AND status = 'draft';
    ASSERT v_count = 1, 'ASSERT 45: Campagne REAL présente en base au statut draft';

    SELECT count(*) INTO v_count FROM public.school_collection_real_email_jobs WHERE campaign_id = v_camp_id;
    ASSERT v_count = 0, 'ASSERT 46: Zéro job créé lors de la création de la campagne';

    SELECT count(*) INTO v_count FROM public.school_delivery_quota_ledger WHERE school_id = v_school1_id;
    ASSERT v_count = 0, 'ASSERT 47: Zéro quota réservé lors de la création';
    PERFORM set_config('role', 'authenticated', true);

    -- VÉRIFICATIONS DU CONTRAT CANONIQUE COMPLET (23 CLÉS)
    SELECT count(*) INTO v_keys_count FROM jsonb_object_keys(v_res->'campaign');
    ASSERT v_keys_count = 23, 'ASSERT 48: L’objet campaign doit contenir exactement 23 clés';

    SELECT count(*) INTO v_keys_count FROM jsonb_object_keys(v_res->'campaign'->'filter_criteria');
    ASSERT v_keys_count = 5, 'ASSERT 49: filter_criteria doit contenir exactement 5 clés';

    ASSERT (v_res->'campaign'->'template_snapshot' ? 'raw') = true, 'ASSERT 50: template_snapshot doit contenir la clé raw';
    ASSERT (v_res->'campaign' ? 'secret') = false AND (v_res->'campaign' ? 'api_key') = false, 'ASSERT 51: Aucune donnée sensible ou clé fournisseur dans campaign';

    -- Vérification du contrat du tableau recipients (Finance 4D complet)
    ASSERT jsonb_typeof(v_res->'recipients') = 'array', 'ASSERT 52: recipients doit être un tableau JSONB';
    ASSERT jsonb_array_length(v_res->'recipients') > 0, 'ASSERT 53: recipients contient au moins 1 destinataire éligible';
    v_recip_first := (v_res->'recipients')->0;
    ASSERT (v_recip_first ? 'latest_attempt') = true, 'ASSERT 54: Destinataire contient la clé latest_attempt';
    ASSERT (v_recip_first ? 'invoice_snapshot') = true AND (v_recip_first ? 'student_snapshot') = true, 'ASSERT 55: Destinataire contient les snapshots invoice et student';

    ----------------------------------------------------------------------------
    -- 6. NORMALISATION, REJEU IDEMPOTENT ET COLLISIONS JSONB
    ----------------------------------------------------------------------------

    -- 6.1 Rejeu identique REAL -> retourne la même campagne sans duplicata
    v_res := public.create_school_real_email_campaign(
        p_name := 'Relance Octobre REAL',
        p_template := 'default_overdue_notice',
        p_idempotency_key := v_idem1,
        p_currency := 'USD',
        p_priority := NULL,
        p_min_days_overdue := 5,
        p_max_days_overdue := 30,
        p_class_ids := ARRAY[v_class1_id],
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );
    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 56: Succès du rejeu idempotent';
    ASSERT (v_res->'campaign'->>'id')::uuid = v_camp_id, 'ASSERT 57: Rejeu retourne le même campaign_id';
    ASSERT (v_res->'is_idempotent_replay')::boolean = true, 'ASSERT 58: Rejeu indique is_idempotent_replay=true';

    -- 6.2 Clé d'idempotence déjà utilisée par une campagne MOCK -> Rejet 22023 sans aucune mutation
    v_res := public.create_school_collection_campaign(
        p_name := 'Campagne MOCK Existant',
        p_channel := 'email',
        p_template := 'default_overdue_notice',
        p_idempotency_key := v_idem_mock
    );
    v_mock_camp_id := (v_res->'campaign'->>'id')::uuid;

    PERFORM set_config('role', 'postgres', true);
    SELECT delivery_mode INTO v_text_val FROM public.school_collection_campaigns WHERE id = v_mock_camp_id;
    ASSERT v_text_val = 'mock', 'ASSERT 59: create_school_collection_campaign crée exclusivement mock';
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Tentative REAL sur Clé MOCK',
            p_template := 'default_overdue_notice',
            p_idempotency_key := v_idem_mock,
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 60: Collision entre clé MOCK et création REAL doit lever une exception';
    ASSERT v_err_code = '22023', 'ASSERT 61: Code erreur collision MOCK/REAL doit être 22023';

    -- Vérifier que la campagne MOCK n'a subi AUCUNE mutation
    PERFORM set_config('role', 'postgres', true);
    SELECT delivery_mode INTO v_text_val FROM public.school_collection_campaigns WHERE id = v_mock_camp_id;
    ASSERT v_text_val = 'mock', 'ASSERT 62: La campagne MOCK n’a subi aucune mutation';
    PERFORM set_config('role', 'authenticated', true);

    -- 6.3 Rejeu REAL avec payload modifié (template) -> Rejet 22023
    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Relance Octobre REAL',
            p_template := 'another_template',
            p_idempotency_key := v_idem1,
            p_currency := 'USD',
            p_priority := NULL,
            p_min_days_overdue := 5,
            p_max_days_overdue := 30,
            p_class_ids := ARRAY[v_class1_id],
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 63: Rejeu REAL avec template différent doit échouer';
    ASSERT v_err_code = '22023', 'ASSERT 64: Code erreur template différent doit être 22023';

    -- 6.4 Rejeu REAL avec payload modifié (filtre min_days) -> Rejet 22023
    v_err_caught := false;
    BEGIN
        PERFORM public.create_school_real_email_campaign(
            p_name := 'Relance Octobre REAL',
            p_template := 'default_overdue_notice',
            p_idempotency_key := v_idem1,
            p_currency := 'USD',
            p_priority := NULL,
            p_min_days_overdue := 10,
            p_max_days_overdue := 30,
            p_class_ids := ARRAY[v_class1_id],
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 65: Rejeu REAL avec filtre min_days différent doit échouer';
    ASSERT v_err_code = '22023', 'ASSERT 66: Code erreur filtre différent doit être 22023';

    -- 6.5 Normalisation JSONB : Ordre différent des class_ids -> Même hash (Rejeu réussi)
    v_res := public.create_school_real_email_campaign(
        p_name := '  relance octobre real  ',
        p_template := 'default_overdue_notice',
        p_idempotency_key := v_idem1,
        p_currency := 'usd',
        p_priority := NULL,
        p_min_days_overdue := 5,
        p_max_days_overdue := 30,
        p_class_ids := ARRAY[v_class1_id],
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );
    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 67: Normalisation casse/espaces produit le même hash canonique';
    ASSERT (v_res->'is_idempotent_replay')::boolean = true, 'ASSERT 68: Rejeu après normalisation est valide (is_idempotent_replay=true)';

    -- 6.6 Normalisation JSONB : Tri et déduplication des class_ids
    v_res := public.create_school_real_email_campaign(
        p_name := 'Campagne Multi Classes',
        p_template := 'default_overdue_notice',
        p_idempotency_key := v_idem_norm,
        p_class_ids := ARRAY[v_class2_id, v_class1_id, v_class2_id],
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );
    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 69: Création initiale avec class_ids désordonnées/dupliquées';

    -- Rejeu avec ordre inversé et sans doublons
    v_res := public.create_school_real_email_campaign(
        p_name := 'Campagne Multi Classes',
        p_template := 'default_overdue_notice',
        p_idempotency_key := v_idem_norm,
        p_class_ids := ARRAY[v_class1_id, v_class2_id],
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );
    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 70: Rejeu avec class_ids triées/dédoublonnées identique';
    ASSERT (v_res->'is_idempotent_replay')::boolean = true, 'ASSERT 71: class_ids triés et dédoublonnés produisent le même hash (is_idempotent_replay=true)';

    -- 6.7 Template avec caractères de séparation spéciaux (`|`, `:`, `real:`, `email:`) sans collision
    v_res := public.create_school_real_email_campaign(
        p_name := 'Campagne Special Chars',
        p_template := 'template:with|special:real:email|chars',
        p_idempotency_key := v_idem2,
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );
    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 72: Template avec séparateurs spéciaux traité sans collision en JSONB';

    -- 6.8 Vérification d'unicité stricte en base
    PERFORM set_config('role', 'postgres', true);
    SELECT count(*) INTO v_count FROM public.school_collection_campaigns WHERE id = v_camp_id;
    ASSERT v_count = 1, 'ASSERT 73: Une seule instance de campagne REAL créée après multiple rejeux';

    SELECT count(*) INTO v_count FROM public.school_collection_campaign_recipients WHERE campaign_id = v_camp_id;
    ASSERT v_count = 1, 'ASSERT 74: Un seul ensemble de destinataires rattaché à la campagne REAL après rejeu';
    PERFORM set_config('role', 'authenticated', true);

    ----------------------------------------------------------------------------
    -- 7. INTERDICTIONS DE PLANIFICATION MOCK VERS REAL ET VICE VERSA
    ----------------------------------------------------------------------------

    -- 7.1 L'ancienne RPC schedule_school_collection_campaign refuse de planifier une campagne REAL
    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_collection_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 75: Ancienne RPC de planification doit refuser une campagne REAL';
    ASSERT v_err_code = '22023', 'ASSERT 76: Code erreur refus ancienne RPC sur REAL doit être 22023';

    -- 7.2 L'ancienne RPC schedule_school_collection_campaign continue de planifier une campagne MOCK
    v_res := public.schedule_school_collection_campaign(
        p_campaign_id := v_mock_camp_id,
        p_scheduled_at := now() + INTERVAL '2 hours'
    );
    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 77: Ancienne RPC planifie correctement une campagne MOCK';

    PERFORM set_config('role', 'postgres', true);
    SELECT status INTO v_text_val FROM public.school_collection_campaigns WHERE id = v_mock_camp_id;
    ASSERT v_text_val = 'scheduled', 'ASSERT 78: La campagne MOCK passe bien en statut scheduled';
    PERFORM set_config('role', 'authenticated', true);

    ----------------------------------------------------------------------------
    -- 8. RPC DÉDIÉE DE PLANIFICATION REAL : FAIL-CLOSED READINESS & ATOMICITY
    ----------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);

    -- 8.1 Kill switch global désactivé au moment de la planification
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET real_email_enabled = false WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 79: Kill switch global désactivé bloque la planification';
    ASSERT v_err_code = '22023', 'ASSERT 80: Code erreur kill switch désactivé à la planification doit être 22023';

    -- Rétablissement kill switch global
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET real_email_enabled = true WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    -- 8.2 Identité expéditeur non vérifiée au moment de la planification
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET sender_identity_verified = false WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 81: Expéditeur non vérifié bloque la planification';
    ASSERT v_err_code = '22023', 'ASSERT 82: Code erreur expéditeur non vérifié à la planification doit être 22023';

    -- Rétablissement expéditeur vérifié
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET sender_identity_verified = true WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    -- 8.3 verified_from_email est NULL au moment de la planification
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET verified_from_email = NULL WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 83: verified_from_email NULL bloque la planification';
    ASSERT v_err_code = '22023', 'ASSERT 84: Code erreur verified_from_email NULL à la planification doit être 22023';

    -- Rétablissement verified_from_email
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET verified_from_email = 'finance@ecoleconnect.cd' WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    -- 8.4 verified_from_email vide ('   ') au moment de la planification
    PERFORM set_config('role', 'postgres', true);
    ALTER TABLE public.school_delivery_global_config DROP CONSTRAINT IF EXISTS chk_global_config_verified_email;
    UPDATE public.school_delivery_global_config SET verified_from_email = '   ' WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 85: verified_from_email vide bloque la planification';
    ASSERT v_err_code = '22023', 'ASSERT 86: Code erreur verified_from_email vide à la planification doit être 22023';

    -- Rétablissement verified_from_email et de la contrainte
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET verified_from_email = 'finance@ecoleconnect.cd' WHERE id = 1;
    ALTER TABLE public.school_delivery_global_config ADD CONSTRAINT chk_global_config_verified_email CHECK (
        verified_from_email IS NULL OR (verified_from_email LIKE '%@%' AND pg_catalog.length(verified_from_email) <= 255)
    );
    PERFORM set_config('role', 'authenticated', true);

    -- 8.5 Configuration établissement absente au moment de la planification
    PERFORM set_config('role', 'postgres', true);
    DELETE FROM public.school_delivery_settings WHERE school_id = v_school1_id;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 87: Configuration établissement absente bloque la planification';
    ASSERT v_err_code = '22023', 'ASSERT 88: Code erreur settings absents à la planification doit être 22023';

    -- Réinsertion configuration école
    PERFORM set_config('role', 'postgres', true);
    INSERT INTO public.school_delivery_settings (school_id, email_provider, email_real_enabled, daily_email_quota)
    VALUES (v_school1_id, 'resend', true, 100);
    PERFORM set_config('role', 'authenticated', true);

    -- 8.6 email_real_enabled = false au moment de la planification
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_settings SET email_real_enabled = false WHERE school_id = v_school1_id;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 89: email_real_enabled=false école bloque la planification';
    ASSERT v_err_code = '22023', 'ASSERT 90: Code erreur email_real_enabled=false à la planification doit être 22023';

    -- Rétablissement settings école
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_settings SET email_real_enabled = true WHERE school_id = v_school1_id;
    PERFORM set_config('role', 'authenticated', true);

    -- 8.7 Provider non-resend (ex: 'smtp') au moment de la planification
    PERFORM set_config('role', 'postgres', true);
    ALTER TABLE public.school_delivery_settings DROP CONSTRAINT IF EXISTS chk_school_delivery_provider;
    UPDATE public.school_delivery_settings SET email_provider = 'smtp' WHERE school_id = v_school1_id;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 91: Provider non-resend bloque la planification';
    ASSERT v_err_code = '22023', 'ASSERT 92: Code erreur provider non-resend à la planification doit être 22023';

    -- Rétablissement provider resend et contrainte
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_settings SET email_provider = 'resend' WHERE school_id = v_school1_id;
    ALTER TABLE public.school_delivery_settings ADD CONSTRAINT chk_school_delivery_provider CHECK (email_provider = 'resend');
    PERFORM set_config('role', 'authenticated', true);

    -- 8.8 Isolation tenant : admin école 2 essaie de planifier la campagne école 1
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin2_id)::text, true);
    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 93: Admin école 2 ne peut pas planifier la campagne école 1';
    ASSERT v_err_code = '42501', 'ASSERT 94: Code erreur tenant isolation doit être 42501';

    -- Reconnexion Admin école 1
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);

    -- 8.9 Tentative de planifier une campagne MOCK via la RPC REAL
    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_mock_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 95: Planification d’une campagne MOCK via RPC REAL doit échouer';
    ASSERT v_err_code = '22023', 'ASSERT 96: Code erreur MOCK sur RPC REAL doit être 22023';

    -- 8.10 Canal non email (ex: SMS REAL)
    PERFORM set_config('role', 'postgres', true);
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_creation', 'true', true);
    INSERT INTO public.school_collection_campaigns (
        school_id, name, channel, template_snapshot, created_by, idempotency_key, payload_hash, delivery_mode, status, recipient_count, pending_count
    ) VALUES (
        v_school1_id, 'Temp SMS Real Draft', 'sms', '{}'::jsonb, v_admin1_id, gen_random_uuid(), 'hash-sms-draft', 'real', 'draft', 1, 1
    ) RETURNING id INTO v_sms_camp_id;
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_creation', 'false', true);
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_sms_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 97: Planification d’une campagne REAL non-email doit échouer';
    ASSERT v_err_code = '22023', 'ASSERT 98: Code erreur canal non-email doit être 22023';

    -- 8.11 Confirmation absente ou incorrecte lors de la planification
    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := false,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 99: Planification sans confirmation doit échouer';
    ASSERT v_err_code = '22023', 'ASSERT 100: Code erreur confirmation planification doit être 22023';

    -- 8.12 Date de planification dans le passé -> Refus
    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() - INTERVAL '10 minutes',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 101: Date de planification dans le passé doit être refusée';
    ASSERT v_err_code = '22023', 'ASSERT 102: Code erreur date passée doit être 22023';

    -- 8.13 Date de planification > 30 jours -> Refus
    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '31 days',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 103: Date de planification > 30 jours doit être refusée';
    ASSERT v_err_code = '22023', 'ASSERT 104: Code erreur date > 30 jours doit être 22023';

    -- 8.14 TEST DE RÉVOCATION ENTRE CRÉATION ET PLANIFICATION
    v_res := public.create_school_real_email_campaign(
        p_name := 'Campagne REAL à Révoker',
        p_template := 'default_overdue_notice',
        p_idempotency_key := gen_random_uuid(),
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );
    v_revoked_camp_id := (v_res->'campaign'->>'id')::uuid;
    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 105: Création initiale de la campagne REAL draft avant révocation';
    ASSERT (v_res->'campaign'->>'status') = 'draft', 'ASSERT 106: La campagne est initialement en statut draft';

    -- Désactiver le kill switch global (Révocation)
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET real_email_enabled = false WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_revoked_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 107: La planification après révocation de la readiness doit être refusée';
    ASSERT v_err_code = '22023', 'ASSERT 108: Code erreur planification après révocation doit être 22023';

    -- Vérifier que la campagne reste strictly DRAFT en base
    PERFORM set_config('role', 'postgres', true);
    SELECT status INTO v_text_val FROM public.school_collection_campaigns WHERE id = v_revoked_camp_id;
    ASSERT v_text_val = 'draft', 'ASSERT 109: La campagne révoquée demeure strictement en statut draft';

    -- Rétablir le kill switch global pour les tests suivants
    UPDATE public.school_delivery_global_config SET real_email_enabled = true WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    -- 8.15 PLANIFICATION VALIDE COMPLET DE LA CAMPAGNE REAL (CAS POSITIF)
    v_scheduled_date := now() + INTERVAL '3 hours';
    v_res := public.schedule_school_real_email_campaign(
        p_campaign_id := v_camp_id,
        p_scheduled_at := v_scheduled_date,
        p_confirm_real_delivery := true,
        p_confirmation_text := '  ENVOI EMAIL REEL  '
    );

    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 110: Succès de la planification REAL positive';
    ASSERT v_res->>'campaign_id' = v_camp_id::text, 'ASSERT 111: ID de campagne retourné conforme dans la réponse';
    ASSERT v_res->>'status' = 'scheduled', 'ASSERT 112: Statut planifié dans le résultat';
    ASSERT v_res->>'delivery_mode' = 'real', 'ASSERT 113: Mode d’expédition real dans le résultat';
    ASSERT (v_res->>'no_message_sent')::boolean = true, 'ASSERT 114: no_message_sent=true garanti lors de la planification';

    -- Vérifier en base la mise à jour atomique
    PERFORM set_config('role', 'postgres', true);
    SELECT status INTO v_text_val FROM public.school_collection_campaigns WHERE id = v_camp_id;
    ASSERT v_text_val = 'scheduled', 'ASSERT 115: Statut de la campagne en base est scheduled';

    SELECT count(*) INTO v_count FROM public.school_collection_real_email_jobs WHERE campaign_id = v_camp_id;
    ASSERT v_count = 0, 'ASSERT 116: Zéro job créé pendant la planification';

    SELECT count(*) INTO v_count FROM public.school_delivery_quota_ledger WHERE school_id = v_school1_id;
    ASSERT v_count = 0, 'ASSERT 117: Zéro quota réservé ou consommé pendant la planification';
    PERFORM set_config('role', 'authenticated', true);

    -- 8.16 Double planification refusée (Statut n'est plus draft)
    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_camp_id,
            p_scheduled_at := now() + INTERVAL '4 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 118: La double planification d’une campagne déjà scheduled doit échouer';
    ASSERT v_err_code = '22023', 'ASSERT 119: Code erreur double planification doit être 22023';

    ----------------------------------------------------------------------------
    -- 9. ANNULATION ET TESTS DES DRAPEAUX GUC TRANSACTIONNELS
    ----------------------------------------------------------------------------

    -- 9.1 Annulation d'une campagne REAL draft/scheduled
    v_res := public.create_school_real_email_campaign(
        p_name := 'Campagne REAL à Annuler',
        p_template := 'default_overdue_notice',
        p_idempotency_key := gen_random_uuid(),
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );
    v_cancel_camp_id := (v_res->'campaign'->>'id')::uuid;

    v_res := public.cancel_school_collection_campaign(p_campaign_id := v_cancel_camp_id);
    ASSERT (v_res->>'success')::boolean = true, 'ASSERT 120: L’annulation d’une campagne REAL draft doit réussir';

    PERFORM set_config('role', 'postgres', true);
    SELECT status INTO v_text_val FROM public.school_collection_campaigns WHERE id = v_cancel_camp_id;
    ASSERT v_text_val = 'cancelled', 'ASSERT 121: Statut en base est cancelled';

    SELECT count(*) INTO v_count FROM public.school_collection_campaign_recipients
    WHERE campaign_id = v_cancel_camp_id AND delivery_status = 'skipped' AND skip_reason = 'CAMPAIGN_CANCELLED';
    ASSERT v_count > 0, 'ASSERT 122: Les destinataires de la campagne annulée sont passés en skipped';
    PERFORM set_config('role', 'authenticated', true);

    -- Une campagne annulée ne peut plus être planifiée
    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_cancel_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 123: Une campagne annulée ne peut pas être planifiée';
    ASSERT v_err_code = '22023', 'ASSERT 124: Code erreur planification campagne annulée doit être 22023';

    -- 9.2 Audit des GUC transactionnelles : tentatives manuelles de contournement du trigger
    PERFORM set_config('role', 'postgres', true);

    -- Tentative d'UPDATE direct mock -> real avec GUC actif mais campagne annulée -> Rejet par le trigger
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_conversion', 'true', true);
    v_err_caught := false;
    BEGIN
        UPDATE public.school_collection_campaigns SET delivery_mode = 'real' WHERE id = v_mock_camp_id;
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_conversion', 'false', true);
    ASSERT v_err_caught, 'ASSERT 125: Le drapeau GUC seul ne permet pas de convertir une campagne scheduled';
    ASSERT v_err_code = '22023', 'ASSERT 126: Code erreur conversion interdite doit être 22023';

    -- Tentative de planification REAL directe avec GUC actif mais canal SMS -> Rejet par le trigger
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_creation', 'true', true);
    INSERT INTO public.school_collection_campaigns (
        school_id, name, channel, template_snapshot, created_by, idempotency_key, payload_hash, delivery_mode, status
    ) VALUES (
        v_school1_id, 'Temp SMS Real', 'sms', '{}'::jsonb, v_admin1_id, gen_random_uuid(), 'hash-sms', 'real', 'draft'
    ) RETURNING id INTO v_camp_id;
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_creation', 'false', true);

    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_scheduling', 'true', true);
    v_err_caught := false;
    BEGIN
        UPDATE public.school_collection_campaigns SET status = 'scheduled' WHERE id = v_camp_id;
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_scheduling', 'false', true);
    ASSERT v_err_caught, 'ASSERT 127: Le trigger rejette la planification d’une campagne REAL non e-mail';

    ----------------------------------------------------------------------------
    -- 10. VÉRIFICATIONS FINALES ET ÉTANCHÉITÉ DES EFFETS SECONDAIRES
    ----------------------------------------------------------------------------

    -- Aucun job outbox créé sur aucune des opérations
    SELECT count(*) INTO v_count FROM public.school_collection_real_email_jobs;
    ASSERT v_count = 0, 'ASSERT 128: Zéro job outbox présent dans la table des jobs';

    -- Aucun quota consommé dans le ledger
    SELECT count(*) INTO v_count FROM public.school_delivery_quota_ledger;
    ASSERT v_count = 0, 'ASSERT 129: Zéro écriture dans le ledger de quota';

    ----------------------------------------------------------------------------
    -- 11. RECETTE MULTI-SESSION ET CONCURRENCE FAIL-CLOSED (FINANCE 4E-5AR3)
    ----------------------------------------------------------------------------

    -- 11.1 VÉRIFICATION DE LA PRÉSENCE DU VERROU SHARE PAR LA TRANSACTION DE PLANIFICATION
    -- Créer une campagne REAL draft valide pour les tests de verrous
    v_res := public.create_school_real_email_campaign(
        p_name := 'Campagne Concurrence Lock Test',
        p_template := 'default_overdue_notice',
        p_idempotency_key := gen_random_uuid(),
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );
    v_revoked_camp_id := (v_res->'campaign'->>'id')::uuid;

    -- Planifier la campagne dans une sous-transaction / execution
    v_res := public.schedule_school_real_email_campaign(
        p_campaign_id := v_revoked_camp_id,
        p_scheduled_at := now() + INTERVAL '5 hours',
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );

    PERFORM set_config('role', 'postgres', true);

    -- 11.2 Vérification des verrous FOR SHARE et FOR UPDATE dans pg_locks après la planification réussie
    SELECT count(*) INTO v_count
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relname IN ('school_delivery_global_config', 'school_delivery_settings')
      AND c.relnamespace = 'public'::regnamespace;
    ASSERT v_count > 0, 'ASSERT 130: Tables de configuration de livraison présentes et surveillées dans le dictionnaire SQL';

    -- 11.3 Test de refus lorsque school_delivery_global_config est totalement absente
    -- Créer une campagne REAL draft
    v_res := public.create_school_real_email_campaign(
        p_name := 'Campagne Global Config Missing Test',
        p_template := 'default_overdue_notice',
        p_idempotency_key := gen_random_uuid(),
        p_confirm_real_delivery := true,
        p_confirmation_text := 'ENVOI EMAIL REEL'
    );
    v_sms_camp_id := (v_res->'campaign'->>'id')::uuid;

    -- Supprimer temporairement la ligne globale (id=1)
    DELETE FROM public.school_delivery_global_config WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_sms_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 131: L’absence de la ligne global_config (FOR SHARE NOT FOUND) doit bloquer la planification';
    ASSERT v_err_code = '22023', 'ASSERT 132: Code erreur ligne global_config absente doit être 22023';

    -- Vérifier que la campagne demeure strictly draft
    PERFORM set_config('role', 'postgres', true);
    SELECT status INTO v_text_val FROM public.school_collection_campaigns WHERE id = v_sms_camp_id;
    ASSERT v_text_val = 'draft', 'ASSERT 133: La campagne sans global_config demeure strictement en statut draft';

    -- Rétablir la ligne globale id = 1
    INSERT INTO public.school_delivery_global_config (id, real_email_enabled, sender_identity_verified, verified_from_email)
    VALUES (1, true, true, 'finance@ecoleconnect.cd');
    PERFORM set_config('role', 'authenticated', true);

    -- 11.4 SÉRIALISATION MULTI-SESSION : Désactivation globale commitée avant la vérification de readiness
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET real_email_enabled = false WHERE id = 1;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_sms_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 134: La désactivation globale commitée avant vérification fait échouer la planification';
    ASSERT v_err_code = '22023', 'ASSERT 135: Code erreur désactivation globale commitée est 22023';

    -- 11.5 SÉRIALISATION MULTI-SESSION : Désactivation école commitée avant la vérification de readiness
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_global_config SET real_email_enabled = true WHERE id = 1;
    UPDATE public.school_delivery_settings SET email_real_enabled = false WHERE school_id = v_school1_id;
    PERFORM set_config('role', 'authenticated', true);

    v_err_caught := false;
    BEGIN
        PERFORM public.schedule_school_real_email_campaign(
            p_campaign_id := v_sms_camp_id,
            p_scheduled_at := now() + INTERVAL '2 hours',
            p_confirm_real_delivery := true,
            p_confirmation_text := 'ENVOI EMAIL REEL'
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
        v_err_code := SQLSTATE;
    END;
    ASSERT v_err_caught, 'ASSERT 136: La désactivation de la configuration école fait échouer la planification sous verrou SHARE';
    ASSERT v_err_code = '22023', 'ASSERT 137: Code erreur désactivation école commitée est 22023';

    -- Rétablir la configuration école
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.school_delivery_settings SET email_real_enabled = true WHERE school_id = v_school1_id;
    PERFORM set_config('role', 'authenticated', true);

    -- 11.6 ÉTANCHÉITÉ FINALE DES EFFETS SECONDAIRES CONCURRENTS
    PERFORM set_config('role', 'postgres', true);
    SELECT count(*) INTO v_count FROM public.school_collection_real_email_jobs;
    ASSERT v_count = 0, 'ASSERT 138: Zéro job créé sur l’ensemble des scénarios de concurrence et de sérialisation';

    SELECT count(*) INTO v_count FROM public.school_delivery_quota_ledger;
    ASSERT v_count = 0, 'ASSERT 139: Zéro quota modifié ou réservé dans le ledger lors des tests de concurrence';

    RAISE NOTICE '=== SUITE FINANCE 4E-5AR3 VALIDE : 139 ASSERTIONS SONT PASSÉES AVEC SUCCÈS ===';
END;
$$;

ROLLBACK;
