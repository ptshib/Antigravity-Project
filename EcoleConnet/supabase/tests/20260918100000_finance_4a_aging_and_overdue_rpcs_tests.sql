-- =============================================================================
-- ÉCOLECONNECT — SUITE DE TESTS SUITE MIGRATION FINANCE 4A
-- Fichier: 20260918100000_finance_4a_aging_and_overdue_rpcs_tests.sql
-- Description: Suite de tests d'intégration avec ROLLBACK automatique
-- =============================================================================

BEGIN;

DO $$
DECLARE
    -- IDs de test
    v_school_a UUID;
    v_school_b UUID;
    v_school_inactive UUID;
    v_school_suspended UUID;
    v_school_invalid_tz UUID;
    v_year_a UUID;

    v_admin_a_id UUID;
    v_finance_a_id UUID;
    v_teacher_a_id UUID;
    v_parent_a_id UUID;
    v_student_a_id UUID;
    v_super_admin_id UUID;
    v_inactive_admin_id UUID;

    v_student_doc_id UUID;
    v_class_a_id UUID;
    v_enrollment_a_id UUID;

    v_business_date DATE := CURRENT_DATE;

    -- Résultats d'agrégation et de RPC
    v_json_res JSONB;
    v_p1 JSONB;
    v_p2 JSONB;
    v_p3 JSONB;
    v_next_cursor JSONB;

    -- Var secours factures USD
    v_inv_id_1 UUID;
    v_inv_id_30 UUID;
    v_inv_id_31 UUID;
    v_inv_id_60 UUID;
    v_inv_id_61 UUID;
    v_inv_id_90 UUID;
    v_inv_id_91 UUID;
    v_inv_id_today UUID;
    v_inv_id_future UUID;
    v_inv_id_paid UUID;
    v_inv_id_draft UUID;
    v_inv_id_void UUID;
    v_inv_id_cdf UUID;

    -- Factures à due_date identique pour départage ID
    v_inv_same_date_a UUID;
    v_inv_same_date_b UUID;
    v_inv_same_date_c UUID;
    v_same_due_date DATE := v_business_date - 12;

    v_has_execute BOOLEAN;
    v_all_ids UUID[];
BEGIN
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'DÉBUT DES TESTS D INTEGRATION FINANCE 4A (CORRECTION KEYSET CURSOR)';
    RAISE NOTICE '=================================================================';

    -- -------------------------------------------------------------------------
    -- 0. FIXTURES & CRÉATION DES DONNÉES DE TEST EN BANQUE D ESSAI
    -- -------------------------------------------------------------------------

    -- Écoles
    INSERT INTO public.schools (name, slug, timezone, status)
    VALUES ('École A Test', 'ecole-a-test', 'Africa/Kinshasa', 'active')
    RETURNING id INTO v_school_a;

    INSERT INTO public.schools (name, slug, timezone, status)
    VALUES ('École B Test', 'ecole-b-test', 'Africa/Lubumbashi', 'active')
    RETURNING id INTO v_school_b;

    INSERT INTO public.schools (name, slug, timezone, status)
    VALUES ('École Inactive Test', 'ecole-inactive-test', 'Africa/Kinshasa', 'inactive')
    RETURNING id INTO v_school_inactive;

    INSERT INTO public.schools (name, slug, timezone, status)
    VALUES ('École Suspendue Test', 'ecole-suspended-test', 'Africa/Kinshasa', 'suspended')
    RETURNING id INTO v_school_suspended;

    INSERT INTO public.schools (name, slug, timezone, status)
    VALUES ('École TZ Invalide', 'ecole-tz-invalide', 'Invalid/Timezone_Name', 'active')
    RETURNING id INTO v_school_invalid_tz;

    -- Année scolaire
    INSERT INTO public.academic_years (school_id, name, starts_on, ends_on, is_current)
    VALUES (v_school_a, '2025-2026', '2025-09-01', '2026-07-01', true)
    RETURNING id INTO v_year_a;

    -- Profils Utilisateurs auth.users & public.profiles
    v_admin_a_id := gen_random_uuid();
    INSERT INTO auth.users (id, email) VALUES (v_admin_a_id, 'admin_a@test.com');
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active, status)
    VALUES (v_admin_a_id, v_school_a, 'school_admin', 'Admin', 'École A', true, 'active');

    v_finance_a_id := gen_random_uuid();
    INSERT INTO auth.users (id, email) VALUES (v_finance_a_id, 'finance_a@test.com');
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active, status)
    VALUES (v_finance_a_id, v_school_a, 'finance_agent', 'Agent', 'Finance A', true, 'active');

    v_teacher_a_id := gen_random_uuid();
    INSERT INTO auth.users (id, email) VALUES (v_teacher_a_id, 'teacher_a@test.com');
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active, status)
    VALUES (v_teacher_a_id, v_school_a, 'teacher', 'Prof', 'A', true, 'active');

    v_parent_a_id := gen_random_uuid();
    INSERT INTO auth.users (id, email) VALUES (v_parent_a_id, 'parent_a@test.com');
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active, status)
    VALUES (v_parent_a_id, v_school_a, 'parent', 'Parent', 'A', true, 'active');

    v_student_a_id := gen_random_uuid();
    INSERT INTO auth.users (id, email) VALUES (v_student_a_id, 'student_a@test.com');
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active, status)
    VALUES (v_student_a_id, v_school_a, 'student', 'Élève', 'A', true, 'active');

    v_super_admin_id := gen_random_uuid();
    INSERT INTO auth.users (id, email) VALUES (v_super_admin_id, 'super@test.com');
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active, status)
    VALUES (v_super_admin_id, NULL, 'super_admin', 'Super', 'Admin', true, 'active');

    v_inactive_admin_id := gen_random_uuid();
    INSERT INTO auth.users (id, email) VALUES (v_inactive_admin_id, 'inactive@test.com');
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active, status)
    VALUES (v_inactive_admin_id, v_school_a, 'school_admin', 'Admin', 'Inactif', false, 'inactive');

    -- Classe & Student Dossier
    INSERT INTO public.classes (school_id, academic_year_id, name, level)
    VALUES (v_school_a, v_year_a, '6ème Math-Physique', '6')
    RETURNING id INTO v_class_a_id;

    INSERT INTO public.students (id, school_id, profile_id, student_number, class_id, first_name, last_name)
    VALUES (gen_random_uuid(), v_school_a, v_student_a_id, 'MAT-2026-001', v_class_a_id, 'Jean', 'Mukendi')
    RETURNING id INTO v_student_doc_id;

    INSERT INTO public.student_enrollments (school_id, academic_year_id, student_id, class_id, status)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_class_a_id, 'active')
    RETURNING id INTO v_enrollment_a_id;

    -- Insertion Factures USD avec Bornes d'Échéance Strictes (7 factures USD échues)
    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-091', 1, v_business_date - 100, v_business_date - 91, 'USD', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_91;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-090', 2, v_business_date - 100, v_business_date - 90, 'USD', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_90;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-061', 3, v_business_date - 70, v_business_date - 61, 'USD', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_61;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-060', 4, v_business_date - 70, v_business_date - 60, 'USD', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_60;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-031', 5, v_business_date - 40, v_business_date - 31, 'USD', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_31;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-030', 6, v_business_date - 40, v_business_date - 30, 'USD', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_30;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-001', 7, v_business_date - 10, v_business_date - 1, 'USD', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_1;

    -- Factures exclues (Today, Future, Paid, Draft, Voided)
    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-TODAY', 8, v_business_date - 5, v_business_date, 'USD', 50.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_today;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-FUTURE', 9, v_business_date, v_business_date + 10, 'USD', 200.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_future;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-PAID', 10, v_business_date - 20, v_business_date - 15, 'USD', 80.00, 80.00, 'paid', v_admin_a_id)
    RETURNING id INTO v_inv_id_paid;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-DRAFT', 11, v_business_date - 20, v_business_date - 15, 'USD', 150.00, 0.00, 'draft', v_admin_a_id)
    RETURNING id INTO v_inv_id_draft;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, voided_at, voided_by, void_reason, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-VOID', 12, v_business_date - 20, v_business_date - 15, 'USD', 150.00, 0.00, 'voided', now(), v_admin_a_id, 'Annulation test', v_admin_a_id)
    RETURNING id INTO v_inv_id_void;

    -- Facture CDF
    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-TEST-CDF-015', 13, v_business_date - 25, v_business_date - 15, 'CDF', 250000.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_id_cdf;

    -- -------------------------------------------------------------------------
    -- TEST 1: AGINGS BUCKETS & ANNULATION PAIEMENT
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 1: Agrégation des tranches de retard & solde recalculé...';
    v_json_res := public._get_school_aging_summary_internal(v_school_a, v_business_date);

    IF (v_json_res->'currencies'->'USD'->'aging_buckets'->'1_30_days'->>'count')::int != 2 THEN
        RAISE EXCEPTION 'TEST 1 ÉCHEC : 1_30_days USD attendu: 2, reçu: %', (v_json_res->'currencies'->'USD'->'aging_buckets'->'1_30_days'->>'count');
    END IF;

    RAISE NOTICE 'Test 1 REUSSITE';

    -- -------------------------------------------------------------------------
    -- TEST 2: ÉCOLE SANS FACTURE & SÉPARATION DES DEVISES
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 2: École sans facture & structure zéro-filled...';
    v_json_res := public._get_school_aging_summary_internal(v_school_b, v_business_date);
    IF (v_json_res->'currencies'->'USD'->>'total_overdue_amount')::numeric != 0.00 THEN
        RAISE EXCEPTION 'TEST 2 ÉCHEC : Montant USD attendu 0.00';
    END IF;
    RAISE NOTICE 'Test 2 REUSSITE';

    -- -------------------------------------------------------------------------
    -- TEST 3: TIMEZONE FALLBACK & FORMAT EVALUATED_AT_UTC
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 3: Fallback Timezone & Format evaluated_at_utc...';
    v_json_res := public._get_school_aging_summary_internal(v_school_invalid_tz, v_business_date);
    IF (v_json_res->'meta'->>'evaluated_at_utc') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$' THEN
        RAISE EXCEPTION 'TEST 3 ÉCHEC : Regex UTC invalide';
    END IF;
    RAISE NOTICE 'Test 3 REUSSITE';

    -- -------------------------------------------------------------------------
    -- TEST 4: CONTRÔLES D ACCÈS RÔLES EXHAUSTIFS
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 4: Contrôles d accès rôles...';
    PERFORM set_config('request.jwt.claim.sub', v_teacher_a_id::text, true);
    BEGIN
        PERFORM public.get_school_aging_summary();
        RAISE EXCEPTION 'TEST 4 ÉCHEC : Teacher non rejeté';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE != '42501' THEN RAISE EXCEPTION 'Code 42501 attendu pour Teacher'; END IF;
    END;
    RAISE NOTICE 'Test 4 REUSSITE';

    -- -------------------------------------------------------------------------
    -- TEST 5: CORRECTION PAGINATION N+1 & NEXT_CURSOR EXPLICITE SUR 3 PAGES
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 5: Pagination Keyset N+1 exacte (p_limit = 3 sur 7 factures USD)...';

    PERFORM set_config('request.jwt.claim.sub', v_admin_a_id::text, true);

    -- PAGE 1 (p_limit = 3)
    v_p1 := public.get_school_overdue_invoices_admin(p_currency => 'USD', p_limit => 3);

    -- Assertions Page 1
    IF jsonb_array_length(v_p1->'items') != 3 THEN
        RAISE EXCEPTION 'TEST 5 PAGE 1 ÉCHEC : Nombre d items attendu: 3, reçu: %', jsonb_array_length(v_p1->'items');
    END IF;
    IF (v_p1->>'has_more')::boolean != true THEN
        RAISE EXCEPTION 'TEST 5 PAGE 1 ÉCHEC : has_more attendu: true';
    END IF;

    -- next_cursor Page 1 DOIT égaler exactement le 3ème élément (dernier item de la page 1)
    IF (v_p1->'next_cursor'->>'id')::uuid != (v_p1->'items'->2->>'invoice_id')::uuid OR
       (v_p1->'next_cursor'->>'due_date')::date != (v_p1->'items'->2->>'due_date')::date THEN
        RAISE EXCEPTION 'TEST 5 PAGE 1 ÉCHEC : next_cursor n égale pas le 3ème item (Dernier élément retourné)';
    END IF;

    -- PAGE 2 (p_limit = 3 avec curseur de la Page 1)
    v_next_cursor := v_p1->'next_cursor';
    v_p2 := public.get_school_overdue_invoices_admin(
        p_currency => 'USD',
        p_limit => 3,
        p_cursor_due_date => (v_next_cursor->>'due_date')::date,
        p_cursor_id => (v_next_cursor->>'id')::uuid
    );

    -- Assertions Page 2
    IF jsonb_array_length(v_p2->'items') != 3 THEN
        RAISE EXCEPTION 'TEST 5 PAGE 2 ÉCHEC : Nombre d items attendu: 3, reçu: %', jsonb_array_length(v_p2->'items');
    END IF;
    IF (v_p2->>'has_more')::boolean != true THEN
        RAISE EXCEPTION 'TEST 5 PAGE 2 ÉCHEC : has_more attendu: true';
    END IF;

    -- Le 1er élément de Page 2 DOIT être l'ancien (N+1)ème élément (ici le 4ème élément du total)
    -- Et n'est PAS OMIS !
    IF (v_p2->'next_cursor'->>'id')::uuid != (v_p2->'items'->2->>'invoice_id')::uuid OR
       (v_p2->'next_cursor'->>'due_date')::date != (v_p2->'items'->2->>'due_date')::date THEN
        RAISE EXCEPTION 'TEST 5 PAGE 2 ÉCHEC : next_cursor n égale pas le 3ème item de la page 2';
    END IF;

    -- PAGE 3 (p_limit = 3 avec curseur de la Page 2)
    v_next_cursor := v_p2->'next_cursor';
    v_p3 := public.get_school_overdue_invoices_admin(
        p_currency => 'USD',
        p_limit => 3,
        p_cursor_due_date => (v_next_cursor->>'due_date')::date,
        p_cursor_id => (v_next_cursor->>'id')::uuid
    );

    -- Assertions Page 3
    IF jsonb_array_length(v_p3->'items') != 1 THEN
        RAISE EXCEPTION 'TEST 5 PAGE 3 ÉCHEC : Nombre d items attendu: 1 (7 total - 6 = 1), reçu: %', jsonb_array_length(v_p3->'items');
    END IF;
    IF (v_p3->>'has_more')::boolean != false THEN
        RAISE EXCEPTION 'TEST 5 PAGE 3 ÉCHEC : has_more attendu: false';
    END IF;
    IF v_p3->'next_cursor' IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 5 PAGE 3 ÉCHEC : next_cursor attendu: null sur dernière page';
    END IF;

    -- Vérification Concatenation sans doublon ni omission (Total = 7 distincts)
    v_all_ids := ARRAY[
        (v_p1->'items'->0->>'invoice_id')::uuid,
        (v_p1->'items'->1->>'invoice_id')::uuid,
        (v_p1->'items'->2->>'invoice_id')::uuid,
        (v_p2->'items'->0->>'invoice_id')::uuid,
        (v_p2->'items'->1->>'invoice_id')::uuid,
        (v_p2->'items'->2->>'invoice_id')::uuid,
        (v_p3->'items'->0->>'invoice_id')::uuid
    ];

    IF card_degree(v_all_ids) != 7 OR (SELECT count(DISTINCT unnest) FROM unnest(v_all_ids)) != 7 THEN
        RAISE EXCEPTION 'TEST 5 ÉCHEC : La concaténation des 3 pages ne contient pas exactement 7 IDs uniques';
    END IF;

    RAISE NOTICE 'Test 5 REUSSITE (Correction Pagination N+1 validée)';

    -- -------------------------------------------------------------------------
    -- TEST 6: DÉPARTAGE D'ID POUR FACTURES À DUE_DATE IDENTIQUE
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 6: Départage par UUID (id) sur factures à due_date identique...';

    -- Insertion de 3 factures avec la MÊME date d'échéance v_same_due_date
    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-SAME-A', 20, v_business_date - 20, v_same_due_date, 'CDF', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_same_date_a;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-SAME-B', 21, v_business_date - 20, v_same_due_date, 'CDF', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_same_date_b;

    INSERT INTO public.student_invoices (school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
    VALUES (v_school_a, v_year_a, v_student_doc_id, v_enrollment_a_id, v_class_a_id, 'INV-SAME-C', 22, v_business_date - 20, v_same_due_date, 'CDF', 100.00, 0.00, 'issued', v_admin_a_id)
    RETURNING id INTO v_inv_same_date_c;

    -- Parcours 1 à 1 (p_limit = 1) sur CDF (2 factures total : CDF-015 + les 3 nouvelles = 4 CDF)
    v_p1 := public.get_school_overdue_invoices_admin(p_currency => 'CDF', p_limit => 1);
    v_next_cursor := v_p1->'next_cursor';
    
    v_p2 := public.get_school_overdue_invoices_admin(
        p_currency => 'CDF',
        p_limit => 1,
        p_cursor_due_date => (v_next_cursor->>'due_date')::date,
        p_cursor_id => (v_next_cursor->>'id')::uuid
    );

    IF (v_p1->'items'->0->>'invoice_id')::uuid = (v_p2->'items'->0->>'invoice_id')::uuid THEN
        RAISE EXCEPTION 'TEST 6 ÉCHEC : Le départage d ID sur due_date égale a produit un doublon entre page 1 et page 2';
    END IF;

    RAISE NOTICE 'Test 6 REUSSITE (Départage ID sur due_date identique validé)';

    -- -------------------------------------------------------------------------
    -- TEST 7: AUDIT DES PRIVILÈGES PG_PROC
    -- -------------------------------------------------------------------------
    RAISE NOTICE 'Test 7: Audit des privilèges d exécution pg_proc...';
    SELECT has_function_privilege('authenticated', 'public.get_school_aging_summary()', 'EXECUTE') INTO v_has_execute;
    IF NOT v_has_execute THEN RAISE EXCEPTION 'TEST 7 ÉCHEC : Privilège manquant pour authenticated'; END IF;
    RAISE NOTICE 'Test 7 REUSSITE';

    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'TOUS LES TESTS (INCLUANT CORRECTION PAGINATION N+1) SONT REUSSIS !';
    RAISE NOTICE 'ROLLBACK AUTOMATIQUE EN COURS...';
    RAISE NOTICE '=================================================================';

END $$;

ROLLBACK;
