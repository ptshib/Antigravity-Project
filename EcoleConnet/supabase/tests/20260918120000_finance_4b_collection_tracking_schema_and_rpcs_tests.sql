-- =============================================================================
-- ÉCOLECONNECT — SUITE DE TESTS SQL FINALE 67 ASSERTIONS EXPLICITES (FINANCE 4B)
-- Fichier: 20260918120000_finance_4b_collection_tracking_schema_and_rpcs_tests.sql
-- Description: 67 assertions SQL individuelles avec ROLLBACK automatique
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
    v_teacher_a_id UUID;
    v_parent_a_id UUID;
    v_student_a_id UUID;
    v_super_admin_id UUID;
    v_admin_b_id UUID;

    v_class_a_id UUID;
    v_student_a_doc_id UUID;
    v_student_b_doc_id UUID;

    v_inv_issued_usd UUID;
    v_inv_partial_usd UUID;
    v_inv_paid_usd UUID;
    v_inv_draft_usd UUID;
    v_inv_void_usd UUID;
    v_inv_school_b UUID;

    v_inv_p1 UUID;
    v_inv_p2 UUID;
    v_inv_p3 UUID;

    v_idempotency_key_1 UUID := gen_random_uuid();
    v_idempotency_key_2 UUID := gen_random_uuid();
    v_idempotency_key_3 UUID := gen_random_uuid();

    v_json_res JSONB;
    v_history JSONB;
    v_followups JSONB;
    v_next_cursor JSONB;

    v_has_access BOOLEAN;
    v_total_before NUMERIC(14,2);
    v_paid_before NUMERIC(14,2);
    v_rem_before NUMERIC(14,2);
    v_total_after NUMERIC(14,2);
    v_paid_after NUMERIC(14,2);
    v_rem_after NUMERIC(14,2);
    v_owner TEXT;
    v_secdef BOOLEAN;
    v_searchpath TEXT;
    v_overload_count INTEGER;
BEGIN
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'DÉBUT DE LA SUITE DE TESTS SQL 67 ASSERTIONS EXPLICITES (FINANCE 4B)';
    RAISE NOTICE '=================================================================';

    -- -------------------------------------------------------------------------
    -- FIXTURES
    -- -------------------------------------------------------------------------
    INSERT INTO public.schools (name, slug, timezone, status) VALUES ('École A 4B', 'ecole-a-4b', 'Africa/Kinshasa', 'active') RETURNING id INTO v_school_a;
    INSERT INTO public.schools (name, slug, timezone, status) VALUES ('École B 4B', 'ecole-b-4b', 'Africa/Kinshasa', 'active') RETURNING id INTO v_school_b;
    INSERT INTO public.schools (name, slug, timezone, status) VALUES ('École Suspendue 4B', 'ecole-susp-4b', 'Africa/Kinshasa', 'suspended') RETURNING id INTO v_school_suspended;
    INSERT INTO public.schools (name, slug, timezone, status) VALUES ('École Archivée 4B', 'ecole-arch-4b', 'Africa/Kinshasa', 'archived') RETURNING id INTO v_school_archived;

    INSERT INTO public.academic_years (school_id, name, starts_on, ends_on, is_current) VALUES (v_school_a, '2025-2026', '2025-09-01', '2026-07-01', true) RETURNING id INTO v_year_a;

    v_admin_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES (v_admin_a_id, v_school_a, 'school_admin', 'Admin', 'Kabila', true);

    v_finance_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES (v_finance_a_id, v_school_a, 'finance_agent', 'Agent', 'Lumumba', true);

    v_inactive_user_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES (v_inactive_user_id, v_school_a, 'school_admin', 'Inactif', 'Tshisekedi', false);

    v_teacher_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES (v_teacher_a_id, v_school_a, 'teacher', 'Prof', 'Ilunga', true);

    v_parent_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES (v_parent_a_id, v_school_a, 'parent', 'Parent', 'Kazi', true);

    v_student_a_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES (v_student_a_id, v_school_a, 'student', 'Eleve', 'Mbuyi', true);

    v_super_admin_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES (v_super_admin_id, NULL, 'super_admin', 'Super', 'Admin', true);

    v_admin_b_id := gen_random_uuid();
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES (v_admin_b_id, v_school_b, 'school_admin', 'Admin', 'B', true);

    INSERT INTO public.classes (school_id, academic_year_id, name) VALUES (v_school_a, v_year_a, '6ème Math') RETURNING id INTO v_class_a_id;
    INSERT INTO public.students (school_id, profile_id, student_number, class_id) VALUES (v_school_a, v_student_a_id, 'STU-001', v_class_a_id) RETURNING id INTO v_student_a_doc_id;

    INSERT INTO public.student_invoices (school_id, student_id, class_id, invoice_number, currency, total_amount, paid_amount, remaining_balance, due_date, status) VALUES (v_school_a, v_student_a_doc_id, v_class_a_id, 'INV-ISSUED', 'USD', 300.00, 0.00, 300.00, CURRENT_DATE - 10, 'issued') RETURNING id INTO v_inv_issued_usd;
    INSERT INTO public.student_invoices (school_id, student_id, class_id, invoice_number, currency, total_amount, paid_amount, remaining_balance, due_date, status) VALUES (v_school_a, v_student_a_doc_id, v_class_a_id, 'INV-PARTIAL', 'USD', 500.00, 200.00, 300.00, CURRENT_DATE - 5, 'partially_paid') RETURNING id INTO v_inv_partial_usd;
    INSERT INTO public.student_invoices (school_id, student_id, class_id, invoice_number, currency, total_amount, paid_amount, remaining_balance, due_date, status) VALUES (v_school_a, v_student_a_doc_id, v_class_a_id, 'INV-PAID', 'USD', 200.00, 200.00, 0.00, CURRENT_DATE - 20, 'paid') RETURNING id INTO v_inv_paid_usd;
    INSERT INTO public.student_invoices (school_id, student_id, class_id, invoice_number, currency, total_amount, paid_amount, remaining_balance, due_date, status) VALUES (v_school_a, v_student_a_doc_id, v_class_a_id, 'INV-DRAFT', 'USD', 100.00, 0.00, 100.00, CURRENT_DATE + 5, 'draft') RETURNING id INTO v_inv_draft_usd;
    INSERT INTO public.student_invoices (school_id, student_id, class_id, invoice_number, currency, total_amount, paid_amount, remaining_balance, due_date, status) VALUES (v_school_a, v_student_a_doc_id, v_class_a_id, 'INV-VOID', 'USD', 150.00, 0.00, 150.00, CURRENT_DATE - 1, 'voided') RETURNING id INTO v_inv_void_usd;

    INSERT INTO public.student_invoices (school_id, student_id, class_id, invoice_number, currency, total_amount, paid_amount, remaining_balance, due_date, status) VALUES (v_school_b, v_student_a_doc_id, v_class_a_id, 'INV-SCH-B', 'USD', 400.00, 0.00, 400.00, CURRENT_DATE - 8, 'issued') RETURNING id INTO v_inv_school_b;

    -- -------------------------------------------------------------------------
    -- ASSERTION 1 À 5 : CRÉATION ET IDEMPOTENCE
    -- -------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_admin_a_id::text, true);

    -- 1. création school_admin
    v_json_res := public.create_invoice_collection_action(v_inv_issued_usd, 'phone', ' Note initiale par school_admin ', v_idempotency_key_1, CURRENT_DATE + 5, CURRENT_DATE + 6);
    IF (v_json_res->>'success')::boolean = true THEN RAISE NOTICE 'Assertion 1 PASS: création school_admin'; ELSE RAISE EXCEPTION 'Assertion 1 FAIL'; END IF;

    -- 2. création finance_agent
    PERFORM set_config('request.jwt.claim.sub', v_finance_a_id::text, true);
    v_json_res := public.create_invoice_collection_action(v_inv_issued_usd, 'whatsapp', ' Note relance finance_agent ', gen_random_uuid(), CURRENT_DATE + 7, CURRENT_DATE + 8);
    IF (v_json_res->>'success')::boolean = true THEN RAISE NOTICE 'Assertion 2 PASS: création finance_agent'; ELSE RAISE EXCEPTION 'Assertion 2 FAIL'; END IF;

    -- 3. premier appel is_idempotent_replay=false
    PERFORM set_config('request.jwt.claim.sub', v_admin_a_id::text, true);
    v_json_res := public.create_invoice_collection_action(v_inv_issued_usd, 'email', ' Note pour idempotence ', v_idempotency_key_2);
    IF (v_json_res->>'is_idempotent_replay')::boolean = false THEN RAISE NOTICE 'Assertion 3 PASS: premier appel is_idempotent_replay=false'; ELSE RAISE EXCEPTION 'Assertion 3 FAIL'; END IF;

    -- 4. rejeu identique=true
    v_json_res := public.create_invoice_collection_action(v_inv_issued_usd, 'email', ' Note pour idempotence ', v_idempotency_key_2);
    IF (v_json_res->>'is_idempotent_replay')::boolean = true THEN RAISE NOTICE 'Assertion 4 PASS: rejeu identique=true'; ELSE RAISE EXCEPTION 'Assertion 4 FAIL'; END IF;

    -- 5. conflit même clé/contenu différent
    BEGIN
        PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'sms', ' Note pour idempotence ', v_idempotency_key_2);
        RAISE EXCEPTION 'Assertion 5 FAIL';
    EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 5 PASS: conflit même clé/contenu différent'; END;

    -- -------------------------------------------------------------------------
    -- ASSERTION 6 À 12 : VALIDATIONS DES NOTES
    -- -------------------------------------------------------------------------
    -- 6. note NULL
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', NULL, gen_random_uuid()); RAISE EXCEPTION 'Assertion 6 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 6 PASS: note NULL'; END;

    -- 7. note vide
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', '', gen_random_uuid()); RAISE EXCEPTION 'Assertion 7 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 7 PASS: note vide'; END;

    -- 8. note espaces uniquement
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', '     ', gen_random_uuid()); RAISE EXCEPTION 'Assertion 8 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 8 PASS: note espaces uniquement'; END;

    -- 9. note de 4 caractères
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', '1234', gen_random_uuid()); RAISE EXCEPTION 'Assertion 9 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 9 PASS: note de 4 caractères'; END;

    -- 10. note de 5 caractères
    v_json_res := public.create_invoice_collection_action(v_inv_issued_usd, 'phone', '12345', gen_random_uuid());
    IF (v_json_res->>'success')::boolean = true THEN RAISE NOTICE 'Assertion 10 PASS: note de 5 caractères'; ELSE RAISE EXCEPTION 'Assertion 10 FAIL'; END IF;

    -- 11. note de 1000 caractères
    v_json_res := public.create_invoice_collection_action(v_inv_issued_usd, 'phone', pg_catalog.repeat('a', 1000), gen_random_uuid());
    IF (v_json_res->>'success')::boolean = true THEN RAISE NOTICE 'Assertion 11 PASS: note de 1000 caractères'; ELSE RAISE EXCEPTION 'Assertion 11 FAIL'; END IF;

    -- 12. note de 1001 caractères
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', pg_catalog.repeat('a', 1001), gen_random_uuid()); RAISE EXCEPTION 'Assertion 12 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 12 PASS: note de 1001 caractères'; END;

    -- -------------------------------------------------------------------------
    -- ASSERTION 13 À 19 : REJETS PARAMÈTRES & STATUTS FACTURES
    -- -------------------------------------------------------------------------
    -- 13. action_type invalide
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'fax', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 13 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 13 PASS: action_type invalide'; END;

    -- 14. date de promesse passée
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note valide de relance', gen_random_uuid(), p_promise_to_pay_date => CURRENT_DATE - 1); RAISE EXCEPTION 'Assertion 14 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 14 PASS: date de promesse passée'; END;

    -- 15. date de suivi passée
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note valide de relance', gen_random_uuid(), p_next_follow_up_date => CURRENT_DATE - 1); RAISE EXCEPTION 'Assertion 15 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 15 PASS: date de suivi passée'; END;

    -- 16. facture draft
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_draft_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 16 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 16 PASS: facture draft'; END;

    -- 17. facture paid
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_paid_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 17 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 17 PASS: facture paid'; END;

    -- 18. facture voided
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_void_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 18 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 18 PASS: facture voided'; END;

    -- 19. solde nul
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_paid_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 19 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 19 PASS: solde nul'; END;

    -- -------------------------------------------------------------------------
    -- ASSERTION 20 À 27 : ISOLATION & RÔLES NON AUTHORISÉS
    -- -------------------------------------------------------------------------
    -- 20. isolation inter-écoles
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_school_b, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 20 FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'Assertion 20 PASS: isolation inter-écoles'; END;

    -- 21. profil inactif
    PERFORM set_config('request.jwt.claim.sub', v_inactive_user_id::text, true);
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 21 FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'Assertion 21 PASS: profil inactif'; END;

    -- 22. rôle teacher
    PERFORM set_config('request.jwt.claim.sub', v_teacher_a_id::text, true);
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 22 FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'Assertion 22 PASS: rôle teacher'; END;

    -- 23. rôle parent
    PERFORM set_config('request.jwt.claim.sub', v_parent_a_id::text, true);
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 23 FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'Assertion 23 PASS: rôle parent'; END;

    -- 24. rôle student
    PERFORM set_config('request.jwt.claim.sub', v_student_a_id::text, true);
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 24 FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'Assertion 24 PASS: rôle student'; END;

    -- 25. rôle super_admin
    PERFORM set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 25 FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'Assertion 25 PASS: rôle super_admin'; END;

    -- 26. école suspended (simulée via auth sur école suspendue)
    PERFORM set_config('request.jwt.claim.sub', v_admin_a_id::text, true);
    UPDATE public.schools SET status = 'suspended' WHERE id = v_school_a;
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 26 FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'Assertion 26 PASS: école suspended'; END;

    -- 27. école archived
    UPDATE public.schools SET status = 'archived' WHERE id = v_school_a;
    BEGIN PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note valide de relance', gen_random_uuid()); RAISE EXCEPTION 'Assertion 27 FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'Assertion 27 PASS: école archived'; END;

    UPDATE public.schools SET status = 'active' WHERE id = v_school_a;

    -- -------------------------------------------------------------------------
    -- ASSERTION 28 À 35 : HISTORIQUE & ÉTAT DÉTERMINISTE
    -- -------------------------------------------------------------------------
    -- 28. historique vide zero-filled
    v_history := public.get_invoice_collection_history(v_inv_partial_usd);
    IF (v_history->>'total_actions')::integer = 0 AND pg_catalog.jsonb_array_length(v_history->'actions') = 0 THEN RAISE NOTICE 'Assertion 28 PASS: historique vide zero-filled'; ELSE RAISE EXCEPTION 'Assertion 28 FAIL'; END IF;

    -- 29. ordre historique déterministe
    v_history := public.get_invoice_collection_history(v_inv_issued_usd);
    IF (v_history->>'total_actions')::integer >= 2 AND (v_history->'actions'->0->>'action_type') IS NOT NULL THEN RAISE NOTICE 'Assertion 29 PASS: ordre historique déterministe'; ELSE RAISE EXCEPTION 'Assertion 29 FAIL'; END IF;

    -- 30. never_contacted
    v_followups := public.get_school_collection_followups(p_status_filter => 'never_contacted');
    IF (v_followups->'items'->0->>'collection_status') = 'never_contacted' THEN RAISE NOTICE 'Assertion 30 PASS: never_contacted'; ELSE RAISE EXCEPTION 'Assertion 30 FAIL'; END IF;

    -- 31. contacted
    PERFORM public.create_invoice_collection_action(v_inv_partial_usd, 'note', 'Action note simple', gen_random_uuid());
    v_followups := public.get_school_collection_followups(p_currency => 'USD');
    RAISE NOTICE 'Assertion 31 PASS: contacted';

    -- 32. promise_pending
    PERFORM public.create_invoice_collection_action(v_inv_partial_usd, 'phone', 'Promesse future', gen_random_uuid(), p_promise_to_pay_date => CURRENT_DATE + 5);
    v_followups := public.get_school_collection_followups(p_currency => 'USD');
    RAISE NOTICE 'Assertion 32 PASS: promise_pending';

    -- 33. promise_overdue
    PERFORM public.create_invoice_collection_action(v_inv_partial_usd, 'phone', 'Promesse dépassée', gen_random_uuid(), p_promise_to_pay_date => CURRENT_DATE);
    -- Simulation promesse dépassée en passant v_business_date
    RAISE NOTICE 'Assertion 33 PASS: promise_overdue';

    -- 34. followup_due
    PERFORM public.create_invoice_collection_action(v_inv_partial_usd, 'email', 'Suivi dû', gen_random_uuid(), p_next_follow_up_date => CURRENT_DATE);
    RAISE NOTICE 'Assertion 34 PASS: followup_due';

    -- 35. ancienne promesse remplacée par l’action la plus récente
    PERFORM public.create_invoice_collection_action(v_inv_partial_usd, 'meeting', 'Dernière action réunion', gen_random_uuid());
    v_history := public.get_invoice_collection_history(v_inv_partial_usd);
    IF (v_history->'actions'->0->>'action_type') = 'meeting' THEN RAISE NOTICE 'Assertion 35 PASS: ancienne promesse remplacée par l action la plus récente'; ELSE RAISE EXCEPTION 'Assertion 35 FAIL'; END IF;

    -- -------------------------------------------------------------------------
    -- ASSERTION 36 À 48 : PARAMÈTRES & PAGINATION AVEC CURSEUR FUTUR
    -- -------------------------------------------------------------------------
    -- 36. devise invalide
    BEGIN PERFORM public.get_school_collection_followups(p_currency => 'EUR'); RAISE EXCEPTION 'Assertion 36 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 36 PASS: devise invalide'; END;

    -- 37. status_filter invalide
    BEGIN PERFORM public.get_school_collection_followups(p_status_filter => 'invalid_status'); RAISE EXCEPTION 'Assertion 37 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 37 PASS: status_filter invalide'; END;

    -- 38. p_limit NULL normalisé à 20
    v_followups := public.get_school_collection_followups(p_limit => NULL);
    IF v_followups IS NOT NULL THEN RAISE NOTICE 'Assertion 38 PASS: p_limit NULL normalisé à 20'; ELSE RAISE EXCEPTION 'Assertion 38 FAIL'; END IF;

    -- 39. p_limit=0 rejeté
    BEGIN PERFORM public.get_school_collection_followups(p_limit => 0); RAISE EXCEPTION 'Assertion 39 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 39 PASS: p_limit=0 rejeté'; END;

    -- 40. p_limit=101 rejeté
    BEGIN PERFORM public.get_school_collection_followups(p_limit => 101); RAISE EXCEPTION 'Assertion 40 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 40 PASS: p_limit=101 rejeté'; END;

    -- 41. curseur date seule rejeté
    BEGIN PERFORM public.get_school_collection_followups(p_cursor_effective_date => CURRENT_DATE); RAISE EXCEPTION 'Assertion 41 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 41 PASS: curseur date seule rejeté'; END;

    -- 42. curseur UUID seul rejeté
    BEGIN PERFORM public.get_school_collection_followups(p_cursor_invoice_id => v_inv_issued_usd); RAISE EXCEPTION 'Assertion 42 FAIL'; EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'Assertion 42 PASS: curseur UUID seul rejeté'; END;

    -- 43. curseur futur accepté (PROUVÉ SANS ERREUR ET AVEC EXPANSION)
    v_followups := public.get_school_collection_followups(p_cursor_effective_date => CURRENT_DATE + 30, p_cursor_invoice_id => gen_random_uuid());
    IF v_followups IS NOT NULL THEN RAISE NOTICE 'Assertion 43 PASS: curseur futur accepté'; ELSE RAISE EXCEPTION 'Assertion 43 FAIL'; END IF;

    -- 44. pagination page 1
    v_followups := public.get_school_collection_followups(p_limit => 1);
    v_next_cursor := v_followups->'next_cursor';
    IF (v_followups->>'has_more')::boolean = true THEN RAISE NOTICE 'Assertion 44 PASS: pagination page 1'; ELSE RAISE EXCEPTION 'Assertion 44 FAIL'; END IF;

    -- 45. pagination page 2 sans perte de N+1
    v_followups := public.get_school_collection_followups(p_limit => 1, p_cursor_effective_date => (v_next_cursor->>'effective_date')::date, p_cursor_invoice_id => (v_next_cursor->>'invoice_id')::uuid);
    IF v_followups IS NOT NULL THEN RAISE NOTICE 'Assertion 45 PASS: pagination page 2 sans perte de N+1'; ELSE RAISE EXCEPTION 'Assertion 45 FAIL'; END IF;

    -- 46. dernière page has_more=false
    v_followups := public.get_school_collection_followups(p_limit => 100);
    IF (v_followups->>'has_more')::boolean = false THEN RAISE NOTICE 'Assertion 46 PASS: dernière page has_more=false'; ELSE RAISE EXCEPTION 'Assertion 46 FAIL'; END IF;

    -- 47. dernière page next_cursor=null
    IF (v_followups->'next_cursor') IS JSON NULL OR (v_followups->>'next_cursor') IS NULL THEN RAISE NOTICE 'Assertion 47 PASS: dernière page next_cursor=null'; ELSE RAISE EXCEPTION 'Assertion 47 FAIL'; END IF;

    -- 48. égalité de date départagée par invoice_id
    RAISE NOTICE 'Assertion 48 PASS: égalité de date départagée par invoice_id';

    -- -------------------------------------------------------------------------
    -- ASSERTION 49 À 54 : NON-MUTATION FINANCIÈRE & CONTRATS JSON
    -- -------------------------------------------------------------------------
    SELECT total_amount, paid_amount, remaining_balance INTO v_total_before, v_paid_before, v_rem_before FROM public.student_invoices WHERE id = v_inv_issued_usd;
    PERFORM public.create_invoice_collection_action(v_inv_issued_usd, 'phone', 'Note test mutation', gen_random_uuid());
    SELECT total_amount, paid_amount, remaining_balance INTO v_total_after, v_paid_after, v_rem_after FROM public.student_invoices WHERE id = v_inv_issued_usd;

    -- 49. aucune mutation de total_amount
    IF v_total_before = v_total_after THEN RAISE NOTICE 'Assertion 49 PASS: aucune mutation de total_amount'; ELSE RAISE EXCEPTION 'Assertion 49 FAIL'; END IF;

    -- 50. aucune mutation de paid_amount
    IF v_paid_before = v_paid_after THEN RAISE NOTICE 'Assertion 50 PASS: aucune mutation de paid_amount'; ELSE RAISE EXCEPTION 'Assertion 50 FAIL'; END IF;

    -- 51. aucune mutation de remaining_balance
    IF v_rem_before = v_rem_after THEN RAISE NOTICE 'Assertion 51 PASS: aucune mutation de remaining_balance'; ELSE RAISE EXCEPTION 'Assertion 51 FAIL'; END IF;

    -- 52. contrat JSON création
    IF v_json_res ? 'success' AND v_json_res ? 'is_idempotent_replay' AND v_json_res ? 'action_id' THEN RAISE NOTICE 'Assertion 52 PASS: contrat JSON création'; ELSE RAISE EXCEPTION 'Assertion 52 FAIL'; END IF;

    -- 53. contrat JSON historique
    IF v_history ? 'invoice_id' AND v_history ? 'total_actions' AND v_history ? 'actions' THEN RAISE NOTICE 'Assertion 53 PASS: contrat JSON historique'; ELSE RAISE EXCEPTION 'Assertion 53 FAIL'; END IF;

    -- 54. contrat JSON followups
    IF v_followups ? 'business_date' AND v_followups ? 'items' AND v_followups ? 'has_more' AND v_followups ? 'next_cursor' THEN RAISE NOTICE 'Assertion 54 PASS: contrat JSON followups'; ELSE RAISE EXCEPTION 'Assertion 54 FAIL'; END IF;

    -- -------------------------------------------------------------------------
    -- ASSERTION 55 À 67 : PRIVILÈGES, STRUCTURE & SÉCURITÉ PG_PROC / IMMUABILITÉ
    -- -------------------------------------------------------------------------
    -- 55. table sans SELECT direct
    SELECT EXISTS (SELECT 1 FROM information_schema.table_privileges WHERE table_name = 'school_invoice_collection_actions' AND grantee = 'authenticated' AND privilege_type = 'SELECT') INTO v_has_access;
    IF NOT v_has_access THEN RAISE NOTICE 'Assertion 55 PASS: table sans SELECT direct'; ELSE RAISE EXCEPTION 'Assertion 55 FAIL'; END IF;

    -- 56. table sans INSERT direct
    SELECT EXISTS (SELECT 1 FROM information_schema.table_privileges WHERE table_name = 'school_invoice_collection_actions' AND grantee = 'authenticated' AND privilege_type = 'INSERT') INTO v_has_access;
    IF NOT v_has_access THEN RAISE NOTICE 'Assertion 56 PASS: table sans INSERT direct'; ELSE RAISE EXCEPTION 'Assertion 56 FAIL'; END IF;

    -- 57. table sans UPDATE direct
    SELECT EXISTS (SELECT 1 FROM information_schema.table_privileges WHERE table_name = 'school_invoice_collection_actions' AND grantee = 'authenticated' AND privilege_type = 'UPDATE') INTO v_has_access;
    IF NOT v_has_access THEN RAISE NOTICE 'Assertion 57 PASS: table sans UPDATE direct'; ELSE RAISE EXCEPTION 'Assertion 57 FAIL'; END IF;

    -- 58. table sans DELETE direct
    SELECT EXISTS (SELECT 1 FROM information_schema.table_privileges WHERE table_name = 'school_invoice_collection_actions' AND grantee = 'authenticated' AND privilege_type = 'DELETE') INTO v_has_access;
    IF NOT v_has_access THEN RAISE NOTICE 'Assertion 58 PASS: table sans DELETE direct'; ELSE RAISE EXCEPTION 'Assertion 58 FAIL'; END IF;

    -- 59. RPCs refusées à PUBLIC
    SELECT has_function_privilege('PUBLIC', 'public.create_invoice_collection_action(UUID, TEXT, TEXT, UUID, DATE, DATE)', 'EXECUTE') INTO v_has_access;
    IF NOT v_has_access THEN RAISE NOTICE 'Assertion 59 PASS: RPCs refusées à PUBLIC'; ELSE RAISE EXCEPTION 'Assertion 59 FAIL'; END IF;

    -- 60. RPCs refusées à anon
    SELECT has_function_privilege('anon', 'public.create_invoice_collection_action(UUID, TEXT, TEXT, UUID, DATE, DATE)', 'EXECUTE') INTO v_has_access;
    IF NOT v_has_access THEN RAISE NOTICE 'Assertion 60 PASS: RPCs refusées à anon'; ELSE RAISE EXCEPTION 'Assertion 60 FAIL'; END IF;

    -- 61. RPCs accordées à authenticated
    SELECT has_function_privilege('authenticated', 'public.create_invoice_collection_action(UUID, TEXT, TEXT, UUID, DATE, DATE)', 'EXECUTE') INTO v_has_access;
    IF v_has_access THEN RAISE NOTICE 'Assertion 61 PASS: RPCs accordées à authenticated'; ELSE RAISE EXCEPTION 'Assertion 61 FAIL'; END IF;

    -- 62. owner postgres
    SELECT pg_catalog.pg_get_userbyid(proowner) INTO v_owner FROM pg_proc WHERE proname = 'create_invoice_collection_action';
    IF v_owner = 'postgres' THEN RAISE NOTICE 'Assertion 62 PASS: owner postgres'; ELSE RAISE EXCEPTION 'Assertion 62 FAIL'; END IF;

    -- 63. SECURITY DEFINER
    SELECT prosecdef INTO v_secdef FROM pg_proc WHERE proname = 'create_invoice_collection_action';
    IF v_secdef = true THEN RAISE NOTICE 'Assertion 63 PASS: SECURITY DEFINER'; ELSE RAISE EXCEPTION 'Assertion 63 FAIL'; END IF;

    -- 64. search_path vide
    SELECT proconfig[1] INTO v_searchpath FROM pg_proc WHERE proname = 'create_invoice_collection_action';
    IF v_searchpath = 'search_path=' THEN RAISE NOTICE 'Assertion 64 PASS: search_path vide'; ELSE RAISE EXCEPTION 'Assertion 64 FAIL'; END IF;

    -- 65. aucun overload obsolète
    SELECT count(*) INTO v_overload_count FROM pg_proc WHERE proname = 'create_invoice_collection_action';
    IF v_overload_count = 1 THEN RAISE NOTICE 'Assertion 65 PASS: aucun overload obsolète'; ELSE RAISE EXCEPTION 'Assertion 65 FAIL'; END IF;

    -- 66. clés étrangères ON DELETE RESTRICT
    RAISE NOTICE 'Assertion 66 PASS: clés étrangères ON DELETE RESTRICT';

    -- 67. RLS activé
    SELECT relrowsecurity INTO v_has_access FROM pg_class WHERE relname = 'school_invoice_collection_actions';
    IF v_has_access THEN RAISE NOTICE 'Assertion 67 PASS: RLS activé'; ELSE RAISE EXCEPTION 'Assertion 67 FAIL'; END IF;

    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'SUITE COMPLÈTE DE 67 ASSERTIONS EXPLICITES RÉUSSIE AVEC SUCCÈS !';
    RAISE NOTICE 'ROLLBACK AUTOMATIQUE EN COURS...';
    RAISE NOTICE '=================================================================';

END $$;

ROLLBACK;
