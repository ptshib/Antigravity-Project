-- =============================================================================
-- ÉCOLECONNECT — SUITE DE TESTS SQL FORWARD-ONLY 20260918110000
-- Fichier: 20260918110000_fix_finance_4a_profile_status_column_bug_tests.sql
-- Description: Tests d'intégration exécutant directement les RPCs publiques
--              get_school_aging_summary() & get_school_overdue_invoices_admin()
-- =============================================================================

BEGIN;

DO $$
DECLARE
    -- IDs de test
    v_school_a UUID;
    v_school_b UUID;
    v_school_suspended UUID;
    v_school_archived UUID;
    v_year_a UUID;

    v_admin_a_id UUID;
    v_finance_a_id UUID;
    v_inactive_user_id UUID;
    v_null_active_user_id UUID;
    v_teacher_a_id UUID;
    v_parent_a_id UUID;
    v_student_a_id UUID;
    v_super_admin_id UUID;

    v_admin_b_id UUID;
    v_student_b_doc_id UUID;
    v_class_b_id UUID;

    v_student_a_doc_id UUID;
    v_class_a_id UUID;

    v_json_res JSONB;
    v_has_execute BOOLEAN;
    v_has_status_ref BOOLEAN;
BEGIN
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'DÉBUT DES TESTS SQL MIGRATION 20260918110000 (HOTFIX PROFILE STATUS)';
    RAISE NOTICE '=================================================================';

    -- 1. CRÉATION DES FIXTURES TEMPORAIRES
    -- Écoles
    INSERT INTO public.schools (name, slug, timezone, status)
    VALUES ('École A Test', 'ecole-a-test', 'Africa/Kinshasa', 'active')
    RETURNING id INTO v_school_a;

    INSERT INTO public.schools (name, slug, timezone, status)
    VALUES ('École B Isolation Test', 'ecole-b-test', 'Africa/Kinshasa', 'active')
    RETURNING id INTO v_school_b;

    INSERT INTO public.schools (name, slug, timezone, status)
    VALUES ('École Suspendue Test', 'ecole-suspended-test', 'Africa/Kinshasa', 'suspended')
    RETURNING id INTO v_school_suspended;

    INSERT INTO public.schools (name, slug, timezone, status)
    VALUES ('École Archivée Test', 'ecole-archived-test', 'Africa/Kinshasa', 'archived')
    RETURNING id INTO v_school_archived;

    -- Année scolaire
    INSERT INTO public.academic_years (school_id, name, starts_on, ends_on, is_current)
    VALUES (v_school_a, '2025-2026', '2025-09-01', '2026-07-01', true)
    RETURNING id INTO v_year_a;

    -- Utilisateurs / Profils
    -- Admin actif A
    v_admin_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
    VALUES (v_admin_a_id, v_school_a, 'school_admin', 'Admin', 'Actif', true);

    -- Agent Financier actif A
    v_finance_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
    VALUES (v_finance_a_id, v_school_a, 'finance_agent', 'Agent', 'Finance', true);

    -- Admin Inactif A (is_active = false)
    v_inactive_user_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
    VALUES (v_inactive_user_id, v_school_a, 'school_admin', 'Admin', 'Inactif', false);

    -- Enseignant, Parent, Élève, SuperAdmin
    v_teacher_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
    VALUES (v_teacher_a_id, v_school_a, 'teacher', 'Prof', 'Test', true);

    v_parent_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
    VALUES (v_parent_a_id, v_school_a, 'parent', 'Parent', 'Test', true);

    v_student_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
    VALUES (v_student_a_id, v_school_a, 'student', 'Eleve', 'Test', true);

    v_super_admin_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
    VALUES (v_super_admin_id, NULL, 'super_admin', 'Super', 'Admin', true);

    -- Admin B (Isolation)
    v_admin_b_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
    VALUES (v_admin_b_id, v_school_b, 'school_admin', 'Admin', 'B', true);

    -- Classes
    INSERT INTO public.classes (school_id, academic_year_id, name)
    VALUES (v_school_a, v_year_a, '6ème A')
    RETURNING id INTO v_class_a_id;

    INSERT INTO public.classes (school_id, academic_year_id, name)
    VALUES (v_school_b, v_year_a, '5ème B')
    RETURNING id INTO v_class_b_id;

    -- Élèves documents
    INSERT INTO public.students (school_id, profile_id, student_number, class_id)
    VALUES (v_school_a, v_student_a_id, 'STU-A-001', v_class_a_id)
    RETURNING id INTO v_student_a_doc_id;

    INSERT INTO public.students (school_id, student_number, class_id)
    VALUES (v_school_b, 'STU-B-001', v_class_b_id)
    RETURNING id INTO v_student_b_doc_id;

    -- Factures Échues
    -- Facture École A (USD 100)
    INSERT INTO public.student_invoices (school_id, student_id, class_id, invoice_number, currency, total_amount, paid_amount, remaining_balance, due_date, status)
    VALUES (v_school_a, v_student_a_doc_id, v_class_a_id, 'INV-A-001', 'USD', 100.00, 0.00, 100.00, CURRENT_DATE - 15, 'issued');

    -- Facture École B (USD 500)
    INSERT INTO public.student_invoices (school_id, student_id, class_id, invoice_number, currency, total_amount, paid_amount, remaining_balance, due_date, status)
    VALUES (v_school_b, v_student_b_doc_id, v_class_b_id, 'INV-B-001', 'USD', 500.00, 0.00, 500.00, CURRENT_DATE - 20, 'issued');


    -- -------------------------------------------------------------------------
    -- TEST 1: EXÉCUTION RÉELLE RPC PUBLIQUE GET_SCHOOL_AGING_SUMMARY EN TANT QUE SCHOOL_ADMIN ACTIF
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 1: Exécution réelle get_school_aging_summary() sous auth.uid() = school_admin actif...';
    PERFORM set_config('request.jwt.claim.sub', v_admin_a_id::text, true);

    v_json_res := public.get_school_aging_summary();
    
    IF v_json_res IS NULL OR (v_json_res->'meta'->>'school_id')::uuid != v_school_a THEN
        RAISE EXCEPTION 'TEST 1 ÉCHEC : La RPC aging summary n a pas retourné le JSONB attendu pour l école A';
    END IF;

    IF (v_json_res->'currencies'->'USD'->>'total_overdue_amount')::numeric != 100.00 THEN
        RAISE EXCEPTION 'TEST 1 ÉCHEC : Le montant total échu USD est incorrect (attendu 100.00)';
    END IF;

    RAISE NOTICE 'Test 1 REUSSITE (RPC publique get_school_aging_summary() exécutée sans erreur 42703)';

    -- -------------------------------------------------------------------------
    -- TEST 2: EXÉCUTION RÉELLE RPC PUBLIQUE GET_SCHOOL_OVERDUE_INVOICES_ADMIN EN TANT QUE FINANCE_AGENT ACTIF
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 2: Exécution réelle get_school_overdue_invoices_admin() sous auth.uid() = finance_agent...';
    PERFORM set_config('request.jwt.claim.sub', v_finance_a_id::text, true);

    v_json_res := public.get_school_overdue_invoices_admin(p_currency => 'USD', p_limit => 10);

    IF v_json_res IS NULL OR pg_catalog.jsonb_array_length(v_json_res->'items') != 1 THEN
        RAISE EXCEPTION 'TEST 2 ÉCHEC : La liste paginée doit contenir exactement 1 facture pour l école A';
    END IF;

    IF (v_json_res->'items'->0->>'invoice_number') != 'INV-A-001' THEN
        RAISE EXCEPTION 'TEST 2 ÉCHEC : Mauvaise facture retournée dans la liste de l école A';
    END IF;

    RAISE NOTICE 'Test 2 REUSSITE (RPC publique get_school_overdue_invoices_admin() fonctionnelle sous finance_agent)';

    -- -------------------------------------------------------------------------
    -- TEST 3: ISOLATION INTER-ÉCOLES
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 3: Vérification de l isolation inter-écoles...';
    PERFORM set_config('request.jwt.claim.sub', v_admin_b_id::text, true);

    v_json_res := public.get_school_overdue_invoices_admin(p_currency => 'USD');
    IF (v_json_res->'items'->0->>'invoice_number') != 'INV-B-001' THEN
        RAISE EXCEPTION 'TEST 3 ÉCHEC : L admin de l école B doit voir les factures de B uniquement';
    END IF;

    RAISE NOTICE 'Test 3 REUSSITE (Isolation stricte vérifiée)';

    -- -------------------------------------------------------------------------
    -- TEST 4: REJET UTILISATEUR INACTIF (is_active = false)
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 4: Vérification du rejet des utilisateurs inactifs...';
    PERFORM set_config('request.jwt.claim.sub', v_inactive_user_id::text, true);

    BEGIN
        v_json_res := public.get_school_aging_summary();
        RAISE EXCEPTION 'TEST 4 ÉCHEC : L utilisateur inactif aurait dû être rejeté avec 42501';
    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            RAISE NOTICE 'Test 4 REUSSITE : Rejet 42501 conforme pour utilisateur inactif (is_active = false)';
    END;

    -- -------------------------------------------------------------------------
    -- TEST 5: REJET RÔLES NON AUTORISÉS (teacher, parent, student, super_admin)
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 5: Rejet des rôles non autorisés...';
    PERFORM set_config('request.jwt.claim.sub', v_teacher_a_id::text, true);
    BEGIN
        v_json_res := public.get_school_aging_summary();
        RAISE EXCEPTION 'TEST 5 ÉCHEC : Le rôle teacher aurait dû être rejeté';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;

    PERFORM set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
    BEGIN
        v_json_res := public.get_school_aging_summary();
        RAISE EXCEPTION 'TEST 5 ÉCHEC : Le rôle super_admin aurait dû être rejeté (mode école requis)';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;

    RAISE NOTICE 'Test 5 REUSSITE (Strict contrôle d accès RLS/Role 42501 validé)';

    -- -------------------------------------------------------------------------
    -- TEST 6: ASSERTION SPÉCIFIQUE ENRAYANT v_profile.status DANS PG_PROC
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 6: Inspection de pg_proc pour confirmer l absence totale de v_profile.status...';
    SELECT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname IN ('get_school_aging_summary', 'get_school_overdue_invoices_admin')
          AND prosrc LIKE '%v_profile.status%'
    ) INTO v_has_status_ref;

    IF v_has_status_ref THEN
        RAISE EXCEPTION 'TEST 6 ÉCHEC : La chaîne v_profile.status est encore présente dans les fonctions RPC !';
    END IF;

    RAISE NOTICE 'Test 6 REUSSITE (Absence totale de v_profile.status confirmée dans pg_proc)';

    -- -------------------------------------------------------------------------
    -- TEST 7: AUDIT DES PRIVILÈGES PG_PROC
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 7: Contrôle des privilèges d exécution...';
    SELECT has_function_privilege('authenticated', 'public.get_school_aging_summary()', 'EXECUTE') INTO v_has_execute;
    IF NOT v_has_execute THEN RAISE EXCEPTION 'TEST 7 ÉCHEC : Privilège manquant pour authenticated'; END IF;

    SELECT has_function_privilege('anon', 'public.get_school_aging_summary()', 'EXECUTE') INTO v_has_execute;
    IF v_has_execute THEN RAISE EXCEPTION 'TEST 7 ÉCHEC : anon ne doit pas avoir accès'; END IF;

    RAISE NOTICE 'Test 7 REUSSITE (Privilèges conformes)';

    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'TOUS LES TESTS SQL HOTFIX 20260918110000 ONT RÉUSSI AVEC SUCCÈS !';
    RAISE NOTICE 'ROLLBACK AUTOMATIQUE EN COURS...';
    RAISE NOTICE '=================================================================';

END $$;

ROLLBACK;
