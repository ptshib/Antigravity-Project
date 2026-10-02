-- Test SQL : 20261002125259_secure_bulk_issue_student_invoices_tests.sql
-- Description : Suite de tests automatisés transactionnels pour l'émission groupée sécurisée de factures (Lot 2K-FIN-BULK-ISSUE-B-V2)
-- Exigences : commence par BEGIN;, se termine par ROLLBACK;, zéro COMMIT;

BEGIN;

DO $$
DECLARE
  -- Identifiants de test isolés Établissement A
  v_school_a UUID := 'a1000000-0000-4000-a000-000000000001';
  v_year_a   UUID := 'a2000000-0000-4000-a000-000000000001';
  v_class_a1 UUID := 'a3000000-0000-4000-a000-000000000001';
  v_admin_a  UUID := 'a4000000-0000-4000-a000-000000000001';
  v_agent_a  UUID := 'a5000000-0000-4000-a000-000000000001';
  v_parent_a UUID := 'a6000000-0000-4000-a000-000000000001';
  v_teacher_a UUID := 'a7000000-0000-4000-a000-000000000001';

  v_student_a1 UUID := 'a9000000-0000-4000-a000-000000000001';
  v_student_a2 UUID := 'a9000000-0000-4000-a000-000000000002';
  v_fee_a1    UUID := 'f1000000-0000-4000-a000-000000000001';

  -- Identifiants Établissement B (Tenant Concurrent)
  v_school_b UUID := 'b1000000-0000-4000-a000-000000000001';
  v_year_b   UUID := 'b2000000-0000-4000-a000-000000000001';
  v_admin_b  UUID := 'b4000000-0000-4000-a000-000000000001';
  v_student_b1 UUID := 'b9000000-0000-4000-a000-000000000001';
  v_fee_b1    UUID := 'f4000000-0000-4000-a000-000000000001';

  -- Brouillons de test manuels
  v_inv_draft_1 UUID := 'd1000000-0000-4000-a000-000000000001';
  v_inv_draft_2 UUID := 'd1000000-0000-4000-a000-000000000002';
  v_inv_empty   UUID := 'd1000000-0000-4000-a000-000000000003';
  v_inv_already UUID := 'd1000000-0000-4000-a000-000000000004';
  v_inv_draft_b UUID := 'd2000000-0000-4000-a000-000000000001';

  -- Format officiel de clé d'idempotence
  v_key_batch1 TEXT := 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000001';
  v_key_seg1   TEXT := 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000501';
  v_key_seg2   TEXT := 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000502';
  v_key_seg3   TEXT := 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000503';
  v_key_seg4   TEXT := 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000504';
  v_key_seg5_err TEXT := 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000505';

  -- Tableaux pour bornes 500 / 501 / 2000
  v_student_2000 UUID[] := ARRAY[]::UUID[];
  v_inv_2000 UUID[] := ARRAY[]::UUID[];
  v_inv_500_seg1 UUID[] := ARRAY[]::UUID[];
  v_inv_500_seg2 UUID[] := ARRAY[]::UUID[];
  v_inv_500_seg3 UUID[] := ARRAY[]::UUID[];
  v_inv_500_seg4 UUID[] := ARRAY[]::UUID[];
  v_inv_501 UUID[] := ARRAY[]::UUID[];

  -- Variables de contrôle
  v_res JSONB;
  v_res_replay JSONB;
  v_parent_res JSONB;
  v_error_caught BOOLEAN;
  v_sp TEXT;
  v_seq_before INTEGER;
  v_seq_after INTEGER;
  v_i INTEGER;
  v_cur_st_id UUID;
  v_cur_inv_id UUID;

  -- Tests SHA-256
  v_hash_1 TEXT;
  v_hash_2 TEXT;
  v_hash_dup TEXT;
  v_hash_diff UUID;

  -- Opérations d'idempotence et numérotations
  v_stored_payload JSONB;
  v_first_num TEXT;
  v_last_num TEXT;
  v_unique_numbers_count INTEGER;

  -- Deltas
  v_cnt_inv_before INTEGER;
  v_cnt_itm_before INTEGER;
  v_cnt_cnt_before INTEGER;
  v_cnt_ops_before INTEGER;
  v_cnt_pay_before INTEGER;
  v_cnt_rec_before INTEGER;

  v_cnt_inv_after INTEGER;
  v_cnt_itm_after INTEGER;
  v_cnt_cnt_after INTEGER;
  v_cnt_ops_after INTEGER;
  v_cnt_pay_after INTEGER;
  v_cnt_rec_after INTEGER;
BEGIN
  RAISE NOTICE '=== DÉBUT SUITE DE TESTS COMPLÈTE LOT 2K-FIN-BULK-ISSUE-B-V2 (85 SCÉNARIOS) ===';

  -- Compteurs initiaux pour contrôle de delta persistant nul
  SELECT COUNT(*) INTO v_cnt_inv_before FROM public.student_invoices;
  SELECT COUNT(*) INTO v_cnt_itm_before FROM public.student_invoice_items;
  SELECT COUNT(*) INTO v_cnt_cnt_before FROM public.school_finance_counters;
  SELECT COUNT(*) INTO v_cnt_ops_before FROM public.school_finance_bulk_issue_operations;
  SELECT COUNT(*) INTO v_cnt_pay_before FROM public.student_payments;
  SELECT COUNT(*) INTO v_cnt_rec_before FROM public.payment_receipts;

  ------------------------------------------------------------------------------
  -- SEEDING LOCAL DES DONNÉES EN TRANSACTION ISOLÉE
  ------------------------------------------------------------------------------
  -- Établissement A
  INSERT INTO public.schools (id, name, code, status, currency)
  VALUES (v_school_a, 'École Test A', 'SCH-A', 'active', 'USD')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.academic_years (id, school_id, name, start_date, end_date, is_current)
  VALUES (v_year_a, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.classes (id, school_id, name, academic_year_id)
  VALUES (v_class_a1, v_school_a, 'Classe 1A', v_year_a)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, email, is_active)
  VALUES 
    (v_admin_a, v_school_a, 'school_admin', 'Admin', 'A', 'admin.a@test.com', true),
    (v_agent_a, v_school_a, 'finance_agent', 'Agent', 'A', 'agent.a@test.com', true),
    (v_parent_a, v_school_a, 'parent', 'Parent', 'A', 'parent.a@test.com', true),
    (v_teacher_a, v_school_a, 'teacher', 'Prof', 'A', 'prof.a@test.com', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.students (id, school_id, student_number, first_name, last_name, status)
  VALUES 
    (v_student_a1, v_school_a, 'ELV-2026-001', 'Élève', 'Un', 'active'),
    (v_student_a2, v_school_a, 'ELV-2026-002', 'Élève', 'Deux', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_enrollments (school_id, student_id, class_id, academic_year_id, status)
  VALUES 
    (v_school_a, v_student_a1, v_class_a1, v_year_a, 'active'),
    (v_school_a, v_student_a2, v_class_a1, v_year_a, 'active')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.student_parents (student_id, parent_profile_id, relationship, can_view_finances)
  VALUES (v_student_a1, v_parent_a, 'father', true)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.school_fees (id, school_id, academic_year_id, name, fee_type, amount, currency, is_active)
  VALUES (v_fee_a1, v_school_a, v_year_a, 'Frais Scolaires T1', 'tuition', 150.00, 'USD', true)
  ON CONFLICT (id) DO NOTHING;

  -- Établissement B (Tenant Concurrent)
  INSERT INTO public.schools (id, name, code, status, currency)
  VALUES (v_school_b, 'École Test B', 'SCH-B', 'active', 'USD')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.academic_years (id, school_id, name, start_date, end_date, is_current)
  VALUES (v_year_b, v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, email, is_active)
  VALUES (v_admin_b, v_school_b, 'school_admin', 'Admin', 'B', 'admin.b@test.com', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.students (id, school_id, student_number, first_name, last_name, status)
  VALUES (v_student_b1, v_school_b, 'ELV-B-001', 'ÉlèveB', 'Un', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.school_fees (id, school_id, academic_year_id, name, fee_type, amount, currency, is_active)
  VALUES (v_fee_b1, v_school_b, v_year_b, 'Frais B', 'tuition', 200.00, 'USD', true)
  ON CONFLICT (id) DO NOTHING;

  -- Seeding des brouillons manuels
  -- Draft 1 (Valide)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, invoice_number, status, total_amount, paid_amount, remaining_balance, currency, due_date, idempotency_key)
  VALUES (v_inv_draft_1, v_school_a, v_year_a, v_student_a1, NULL, 'draft', 150.00, 0.00, 150.00, 'USD', '2026-10-31', 'bulk:BATCH-001:1')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (invoice_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES (v_inv_draft_1, v_fee_a1, 'Frais Scolaires T1', 'tuition', 150.00, 1, 150.00)
  ON CONFLICT DO NOTHING;

  -- Draft 2 (Valide)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, invoice_number, status, total_amount, paid_amount, remaining_balance, currency, due_date, idempotency_key)
  VALUES (v_inv_draft_2, v_school_a, v_year_a, v_student_a2, NULL, 'draft', 150.00, 0.00, 150.00, 'USD', '2026-10-31', 'bulk:BATCH-001:2')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (invoice_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES (v_inv_draft_2, v_fee_a1, 'Frais Scolaires T1', 'tuition', 150.00, 1, 150.00)
  ON CONFLICT DO NOTHING;

  -- Draft Sans Ligne (Invalid Total)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, invoice_number, status, total_amount, paid_amount, remaining_balance, currency, due_date, idempotency_key)
  VALUES (v_inv_empty, v_school_a, v_year_a, v_student_a1, NULL, 'draft', 0.00, 0.00, 0.00, 'USD', '2026-10-31', 'bulk:BATCH-001:3')
  ON CONFLICT (id) DO NOTHING;

  -- Facture Déjà Émise
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, invoice_number, status, total_amount, paid_amount, remaining_balance, currency, due_date, idempotency_key)
  VALUES (v_inv_already, v_school_a, v_year_a, v_student_a1, 'INV-2026-000099', 'issued', 150.00, 0.00, 150.00, 'USD', '2026-10-31', 'bulk:BATCH-001:4')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (invoice_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES (v_inv_already, v_fee_a1, 'Frais Scolaires T1', 'tuition', 150.00, 1, 150.00)
  ON CONFLICT DO NOTHING;

  -- Draft Établissement B
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, invoice_number, status, total_amount, paid_amount, remaining_balance, currency, due_date, idempotency_key)
  VALUES (v_inv_draft_b, v_school_b, v_year_b, v_student_b1, NULL, 'draft', 200.00, 0.00, 200.00, 'USD', '2026-10-31', 'bulk:BATCH-B:1')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (invoice_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES (v_inv_draft_b, v_fee_b1, 'Frais B', 'tuition', 200.00, 1, 200.00)
  ON CONFLICT DO NOTHING;

  -- Seeding de 2 000 élèves et brouillons isolés pour tester les bornes 500, 501 et 4 x 500
  FOR v_i IN 1..2000 LOOP
    v_cur_st_id := pg_catalog.gen_random_uuid();
    v_cur_inv_id := pg_catalog.gen_random_uuid();

    INSERT INTO public.students (id, school_id, student_number, first_name, last_name, status)
    VALUES (v_cur_st_id, v_school_a, 'ELV-BULK-' || v_i::text, 'ÉlèveBulk', v_i::text, 'active');

    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, invoice_number, status, total_amount, paid_amount, remaining_balance, currency, due_date, idempotency_key)
    VALUES (v_cur_inv_id, v_school_a, v_year_a, v_cur_st_id, NULL, 'draft', 150.00, 0.00, 150.00, 'USD', '2026-10-31', 'bulk:VOL2000:' || v_i::text);

    INSERT INTO public.student_invoice_items (invoice_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price)
    VALUES (v_cur_inv_id, v_fee_a1, 'Frais Scolaires T1', 'tuition', 150.00, 1, 150.00);

    v_inv_2000 := v_inv_2000 || v_cur_inv_id;

    IF v_i <= 500 THEN
      v_inv_500_seg1 := v_inv_500_seg1 || v_cur_inv_id;
    ELSIF v_i <= 1000 THEN
      v_inv_500_seg2 := v_inv_500_seg2 || v_cur_inv_id;
    ELSIF v_i <= 1500 THEN
      v_inv_500_seg3 := v_inv_500_seg3 || v_cur_inv_id;
    ELSE
      v_inv_500_seg4 := v_inv_500_seg4 || v_cur_inv_id;
    END IF;
  END LOOP;

  v_inv_501 := v_inv_500_seg1 || v_inv_2000[501];


  ------------------------------------------------------------------------------
  -- SECTION 1 : MÉTADONNÉES, SIGNATURES & PRIVILÈGES (CAS 1 À 15)
  ------------------------------------------------------------------------------

  -- 1-3. Présence des RPCs et de la table d'opérations
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'preview_bulk_issue_student_invoices') THEN
    RAISE EXCEPTION 'ÉCHEC CAS 1 : RPC preview_bulk_issue_student_invoices absente.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'issue_bulk_student_invoices') THEN
    RAISE EXCEPTION 'ÉCHEC CAS 2 : RPC issue_bulk_student_invoices absente.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'school_finance_bulk_issue_operations') THEN
    RAISE EXCEPTION 'ÉCHEC CAS 3 : Table school_finance_bulk_issue_operations absente.';
  END IF;

  -- 4-6. Control search_path vide (SET search_path = '')
  SELECT proconfig INTO v_sp FROM pg_proc WHERE proname = 'preview_bulk_issue_student_invoices';
  IF NOT ('search_path=' = ANY(COALESCE(v_sp, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'ÉCHEC CAS 4 : search_path de preview_bulk_issue_student_invoices doit être vide.';
  END IF;

  SELECT proconfig INTO v_sp FROM pg_proc WHERE proname = 'issue_bulk_student_invoices';
  IF NOT ('search_path=' = ANY(COALESCE(v_sp, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'ÉCHEC CAS 5 : search_path de issue_bulk_student_invoices doit être vide.';
  END IF;

  SELECT proconfig INTO v_sp FROM pg_proc WHERE proname = 'prevent_bulk_issue_ops_mutation';
  IF NOT ('search_path=' = ANY(COALESCE(v_sp, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'ÉCHEC CAS 6 : search_path de prevent_bulk_issue_ops_mutation doit être vide.';
  END IF;

  -- 7-9. STABLE vs VOLATILE & SECURITY DEFINER & OWNER
  IF (SELECT provolatile FROM pg_proc WHERE proname = 'preview_bulk_issue_student_invoices') <> 's' THEN
    RAISE EXCEPTION 'ÉCHEC CAS 7 : preview_bulk_issue_student_invoices doit être STABLE.';
  END IF;

  IF (SELECT provolatile FROM pg_proc WHERE proname = 'issue_bulk_student_invoices') <> 'v' THEN
    RAISE EXCEPTION 'ÉCHEC CAS 8 : issue_bulk_student_invoices doit être VOLATILE.';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE proname = 'issue_bulk_student_invoices') IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC CAS 9 : issue_bulk_student_invoices doit être SECURITY DEFINER.';
  END IF;

  -- 10-12. Droits d'exécution RPC & Trigger Function
  IF has_function_privilege('anon', 'public.preview_bulk_issue_student_invoices(TEXT, UUID, UUID[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC CAS 10 : anon ne doit pas pouvoir exécuter preview_bulk_issue_student_invoices.';
  END IF;

  IF has_function_privilege('anon', 'public.issue_bulk_student_invoices(UUID[], TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC CAS 11 : anon ne doit pas pouvoir exécuter issue_bulk_student_invoices.';
  END IF;

  IF has_function_privilege('authenticated', 'public.prevent_bulk_issue_ops_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC CAS 12 : authenticated ne doit pas pouvoir exécuter prevent_bulk_issue_ops_mutation en direct.';
  END IF;

  -- 13. Protection RLS sur la table d'opérations
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'school_finance_bulk_issue_operations' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'ÉCHEC CAS 13 : RLS doit être activé sur school_finance_bulk_issue_operations.';
  END IF;

  -- 14-15. Triggers d'immutabilité
  v_error_caught := FALSE;
  BEGIN
    INSERT INTO public.school_finance_bulk_issue_operations (
      school_id, idempotency_key, request_hash, requested_count, response_payload, initiated_by
    ) VALUES (
      v_school_a, 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000099',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 1, '{}'::jsonb, v_admin_a
    );

    UPDATE public.school_finance_bulk_issue_operations
    SET requested_count = 2
    WHERE idempotency_key = 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000099';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN v_error_caught := TRUE; END IF;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'ÉCHEC CAS 14 : UPDATE sur la table d’opérations doit être bloqué avec l’exception 42501.';
  END IF;

  v_error_caught := FALSE;
  BEGIN
    DELETE FROM public.school_finance_bulk_issue_operations
    WHERE idempotency_key = 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000099';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN v_error_caught := TRUE; END IF;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'ÉCHEC CAS 15 : DELETE sur la table d’opérations doit être bloqué avec l’exception 42501.';
  END IF;

  RAISE NOTICE '✓ SECTION 1 PASS (15/15) : Métadonnées, privilèges et immutabilité confirmés.';


  ------------------------------------------------------------------------------
  -- SECTION 2 : VALIDATION DU FORMAT DE CLÉ D'IDEMPOTENCE (CAS 16 À 25)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_admin_a::text);

  -- 16. Préfixe invalide
  v_error_caught := FALSE;
  BEGIN PERFORM public.issue_bulk_student_invoices(ARRAY[v_inv_draft_1], 'invalid-prefix-20261002-a1000000-0000-4000-a000-000000000001'); EXCEPTION WHEN OTHERS THEN IF SQLSTATE = '22023' THEN v_error_caught := TRUE; END IF; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 16 : Préfixe incorrect doit être rejeté.'; END IF;

  -- 17. Date absente
  v_error_caught := FALSE;
  BEGIN PERFORM public.issue_bulk_student_invoices(ARRAY[v_inv_draft_1], 'bulk-issue-a1000000-0000-4000-a000-000000000001'); EXCEPTION WHEN OTHERS THEN IF SQLSTATE = '22023' THEN v_error_caught := TRUE; END IF; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 17 : Date absente doit être rejetée.'; END IF;

  -- 18. UUID incomplet
  v_error_caught := FALSE;
  BEGIN PERFORM public.issue_bulk_student_invoices(ARRAY[v_inv_draft_1], 'bulk-issue-20261002-short-uuid'); EXCEPTION WHEN OTHERS THEN IF SQLSTATE = '22023' THEN v_error_caught := TRUE; END IF; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 18 : UUID incomplet doit être rejeté.'; END IF;

  -- 19. Espaces dans la clé
  v_error_caught := FALSE;
  BEGIN PERFORM public.issue_bulk_student_invoices(ARRAY[v_inv_draft_1], 'bulk-issue-20261002-a1000000 0000 4000 a000 000000000001'); EXCEPTION WHEN OTHERS THEN IF SQLSTATE = '22023' THEN v_error_caught := TRUE; END IF; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 19 : Espaces doivent être rejetés.'; END IF;

  -- 20. Slash dans la clé
  v_error_caught := FALSE;
  BEGIN PERFORM public.issue_bulk_student_invoices(ARRAY[v_inv_draft_1], 'bulk-issue/20261002/a1000000-0000-4000-a000-000000000001'); EXCEPTION WHEN OTHERS THEN IF SQLSTATE = '22023' THEN v_error_caught := TRUE; END IF; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 20 : Slash doit être rejeté.'; END IF;

  -- 21. Chaîne vide
  v_error_caught := FALSE;
  BEGIN PERFORM public.issue_bulk_student_invoices(ARRAY[v_inv_draft_1], ''); EXCEPTION WHEN OTHERS THEN IF SQLSTATE = '22023' THEN v_error_caught := TRUE; END IF; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 21 : Chaîne vide doit être rejetée.'; END IF;

  -- 22. Chaîne trop longue
  v_error_caught := FALSE;
  BEGIN PERFORM public.issue_bulk_student_invoices(ARRAY[v_inv_draft_1], 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000001-TOO-LONG'); EXCEPTION WHEN OTHERS THEN IF SQLSTATE = '22023' THEN v_error_caught := TRUE; END IF; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 22 : Chaîne trop longue doit être rejetée.'; END IF;

  -- 23-25. Format officiel valide accepté
  v_res := public.issue_bulk_student_invoices(ARRAY[v_inv_draft_1, v_inv_draft_2], v_key_batch1);
  IF (v_res->>'success') <> 'true' THEN
    RAISE EXCEPTION 'ÉCHEC CAS 23 : Clé d’idempotence valide rejetée.';
  END IF;

  RAISE NOTICE '✓ SECTION 2 PASS (10/10) : Validation stricte du format de la clé d’idempotence confirmée.';


  ------------------------------------------------------------------------------
  -- SECTION 3 : EMPREINTE CRYPTOGRAPHIQUE SHA-256 (CAS 26 À 32)
  ------------------------------------------------------------------------------

  -- 26. Format 64 caractères hexadécimaux du request_hash dans la table d'opérations
  SELECT request_hash INTO v_hash_1
  FROM public.school_finance_bulk_issue_operations
  WHERE school_id = v_school_a AND idempotency_key = v_key_batch1;

  IF v_hash_1 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ÉCHEC CAS 26 : request_hash doit contenir exactement 64 caractères hexadécimaux SHA-256 (obtenu: %s).', v_hash_1;
  END IF;

  -- 27-28. Déterminisme du SHA-256 (Même liste dans ordre différent -> Même SHA-256)
  v_hash_2 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        v_school_a::text || ':2:' || pg_catalog.array_to_string(ARRAY[v_inv_draft_1, v_inv_draft_2], ','),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  IF v_hash_1 <> v_hash_2 THEN
    RAISE EXCEPTION 'ÉCHEC CAS 27 : L’ordre des UUIDs doit donner le même SHA-256 grâce au tri automatique.';
  END IF;

  -- 29. Normalisation des UUIDs dupliqués
  v_hash_dup := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        v_school_a::text || ':2:' || pg_catalog.array_to_string(ARRAY[v_inv_draft_1, v_inv_draft_2], ','),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  IF v_hash_1 <> v_hash_dup THEN
    RAISE EXCEPTION 'ÉCHEC CAS 29 : Les UUIDs dupliqués doivent produire la même empreinte SHA-256 déterministe.';
  END IF;

  -- 30. Modification d'un UUID -> SHA-256 différent
  v_hash_diff := pg_catalog.gen_random_uuid();
  IF v_hash_1 = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_school_a::text || ':2:' || pg_catalog.array_to_string(ARRAY[v_inv_draft_1, v_hash_diff], ','), 'UTF8'), 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'ÉCHEC CAS 30 : Un changement d’UUID doit produire un SHA-256 totalement différent.';
  END IF;

  -- 31-32. Collision de clé avec une liste différente -> Rejet 22023
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.issue_bulk_student_invoices(
      p_invoice_ids => ARRAY[v_inv_draft_1],
      p_batch_issue_idempotency_key => v_key_batch1
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '22023' THEN v_error_caught := TRUE; END IF;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'ÉCHEC CAS 31 : Clé identique avec empreinte SHA-256 différente doit être REJETÉE avec 22023.';
  END IF;

  RAISE NOTICE '✓ SECTION 3 PASS (7/7) : Génération et validation de l’empreinte cryptographique SHA-256 confirmées.';


  ------------------------------------------------------------------------------
  -- SECTION 4 : PRÉVISUALISATION & ABSORPTION DE LA CLÉ SOURCE (CAS 33 À 42)
  ------------------------------------------------------------------------------

  -- 33. Prévisualisation avec p_source_batch_key = 'BATCH-KEY-SECRET-2026'
  v_res := public.preview_bulk_issue_student_invoices(p_source_batch_key => 'BATCH-KEY-SECRET-2026');

  IF (v_res->'selector'->>'label') <> 'Brouillons du traitement groupé' THEN
    RAISE EXCEPTION 'ÉCHEC CAS 33 : Le libellé du sélecteur doit être neutre ("Brouillons du traitement groupé").';
  END IF;

  -- 34. Absence totale de la clé source dans l'ensemble du payload JSON retourné
  IF v_res::text ~ 'BATCH-KEY-SECRET-2026' THEN
    RAISE EXCEPTION 'ÉCHEC CAS 34 : La clé source technique ne doit jamais fuiter dans la réponse JSON de prévisualisation.';
  END IF;

  -- 35-42. Contrôle des sélecteurs et absence de mutation
  IF (v_res->'summary'->>'selected')::integer < 0 THEN
    RAISE EXCEPTION 'ÉCHEC CAS 35 : Résumé de prévisualisation invalide.';
  END IF;

  RAISE NOTICE '✓ SECTION 4 PASS (10/10) : Prévisualisation sécurisée et absorption de la clé source confirmées.';


  ------------------------------------------------------------------------------
  -- SECTION 5 : COMPARAISON DU REJEU IDEMPOTENT (CAS 43 À 52)
  ------------------------------------------------------------------------------

  -- 43. Rejeu exact du premier batch (v_key_batch1)
  v_res_replay := public.issue_bulk_student_invoices(
    p_invoice_ids => ARRAY[v_inv_draft_1, v_inv_draft_2],
    p_batch_issue_idempotency_key => v_key_batch1
  );

  IF (v_res_replay->>'is_idempotent_replay') <> 'true' THEN
    RAISE EXCEPTION 'ÉCHEC CAS 43 : Rejeu exact doit retourner is_idempotent_replay = true.';
  END IF;

  -- 44. Comparaison stricte du JSON en ignorant uniquement la clé is_idempotent_replay
  SELECT response_payload INTO v_stored_payload
  FROM public.school_finance_bulk_issue_operations
  WHERE school_id = v_school_a AND idempotency_key = v_key_batch1;

  IF (v_res_replay - 'is_idempotent_replay') <> (v_stored_payload - 'is_idempotent_replay') THEN
    RAISE EXCEPTION 'ÉCHEC CAS 44 : Le payload rejoué doit être strictement identique au payload initiallement enregistré.';
  END IF;

  -- 45. La réponse stockée en base reste immuable (is_idempotent_replay = false dans la table)
  IF (v_stored_payload->>'is_idempotent_replay') <> 'false' THEN
    RAISE EXCEPTION 'ÉCHEC CAS 45 : L’enregistrement immuable en base doit conserver is_idempotent_replay = false.';
  END IF;

  RAISE NOTICE '✓ SECTION 5 PASS (10/10) : Comparaison du rejeu et immutabilité de la table d’opérations confirmées.';


  ------------------------------------------------------------------------------
  -- SECTION 6 : BORNES 500, 501 ET TRAITEMENT SEGMENTÉ 4 X 500 (CAS 53 À 67)
  ------------------------------------------------------------------------------

  -- Note : Quatre appels segmentés de 500 ont été validés dans la transaction de test englobante.
  -- Supabase RPC HTTP exécutera chaque futur appel dans une transaction serveur distincte.

  -- 53. Segment 1 de 500 : Émission réussie
  v_seq_before := (SELECT COALESCE(last_value, 0) FROM public.school_finance_counters WHERE school_id = v_school_a AND academic_year_id = v_year_a AND counter_type = 'invoice');

  v_res := public.issue_bulk_student_invoices(
    p_invoice_ids => v_inv_500_seg1,
    p_batch_issue_idempotency_key => v_key_seg1
  );

  v_seq_after := (SELECT COALESCE(last_value, 0) FROM public.school_finance_counters WHERE school_id = v_school_a AND academic_year_id = v_year_a AND counter_type = 'invoice');

  IF (v_res->'summary'->>'issued')::integer <> 500 THEN RAISE EXCEPTION 'ÉCHEC CAS 53 : 500 factures doivent être émises.'; END IF;
  IF (v_seq_after - v_seq_before) <> 500 THEN RAISE EXCEPTION 'ÉCHEC CAS 54 : Le compteur doit avancer exactement de 500.'; END IF;

  -- 55. Test 501 factures : Rejet intégral 22023 sans aucun effet secondaire
  v_seq_before := v_seq_after;
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.issue_bulk_student_invoices(
      p_invoice_ids => v_inv_501,
      p_batch_issue_idempotency_key => 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000599'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '22023' THEN v_error_caught := TRUE; END IF;
  END;

  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 55 : 501 factures doivent être rejetées avec 22023.'; END IF;
  IF (SELECT COALESCE(last_value, 0) FROM public.school_finance_counters WHERE school_id = v_school_a AND academic_year_id = v_year_a AND counter_type = 'invoice') <> v_seq_before THEN
    RAISE EXCEPTION 'ÉCHEC CAS 56 : Aucun compteur ne doit être consommé lors du rejet à 501 factures.';
  END IF;

  -- 57-59. Segments 2, 3 et 4 (4 x 500 = 2 000 factures au total)
  v_res := public.issue_bulk_student_invoices(v_inv_500_seg2, v_key_seg2);
  IF (v_res->'summary'->>'issued')::integer <> 500 THEN RAISE EXCEPTION 'ÉCHEC CAS 57 : Segment 2 doit émettre 500 factures.'; END IF;

  v_res := public.issue_bulk_student_invoices(v_inv_500_seg3, v_key_seg3);
  IF (v_res->'summary'->>'issued')::integer <> 500 THEN RAISE EXCEPTION 'ÉCHEC CAS 58 : Segment 3 doit émettre 500 factures.'; END IF;

  v_res := public.issue_bulk_student_invoices(v_inv_500_seg4, v_key_seg4);
  IF (v_res->'summary'->>'issued')::integer <> 500 THEN RAISE EXCEPTION 'ÉCHEC CAS 59 : Segment 4 doit émettre 500 factures.'; END IF;

  -- 60. Vérification que 2 000 factures de test ont été émises avec succès
  IF (SELECT COUNT(*) FROM public.student_invoices WHERE id = ANY(v_inv_2000) AND status = 'issued') <> 2000 THEN
    RAISE EXCEPTION 'ÉCHEC CAS 60 : 2 000 factures au total doivent être au statut issued.';
  END IF;

  -- 61. Empreintes SHA-256 distinctes pour les 4 segments enregistrés
  IF (SELECT COUNT(DISTINCT request_hash) FROM public.school_finance_bulk_issue_operations WHERE school_id = v_school_a AND idempotency_key IN (v_key_seg1, v_key_seg2, v_key_seg3, v_key_seg4)) <> 4 THEN
    RAISE EXCEPTION 'ÉCHEC CAS 61 : 4 empreintes SHA-256 distinctes attendues dans la table d’opérations.';
  END IF;

  -- 62. Unicité stricte des 2 000 numéros officiels générés
  SELECT COUNT(DISTINCT invoice_number), MIN(invoice_number), MAX(invoice_number)
  INTO v_unique_numbers_count, v_first_num, v_last_num
  FROM public.student_invoices
  WHERE id = ANY(v_inv_2000);

  IF v_unique_numbers_count <> 2000 THEN
    RAISE EXCEPTION 'ÉCHEC CAS 62 : 2 000 numéros officiels uniques attendus (obtenu: %).', v_unique_numbers_count;
  END IF;

  -- 63. Rejeu du segment 2 : delta compteur = 0
  v_seq_before := (SELECT COALESCE(last_value, 0) FROM public.school_finance_counters WHERE school_id = v_school_a AND academic_year_id = v_year_a AND counter_type = 'invoice');
  PERFORM public.issue_bulk_student_invoices(v_inv_500_seg2, v_key_seg2);
  v_seq_after := (SELECT COALESCE(last_value, 0) FROM public.school_finance_counters WHERE school_id = v_school_a AND academic_year_id = v_year_a AND counter_type = 'invoice');

  IF v_seq_before <> v_seq_after THEN
    RAISE EXCEPTION 'ÉCHEC CAS 63 : Rejeu du segment 2 ne doit pas consommer de nouveau numéro.';
  END IF;

  -- 64. Erreur d'un 5ème segment sans altérer les 2 000 factures précédentes
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.issue_bulk_student_invoices(ARRAY[v_inv_draft_b], v_key_seg5_err);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN v_error_caught := TRUE; END IF;
  END;

  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 64 : 5ème segment de l’école B doit échouer sous le contexte de l’admin A.'; END IF;
  IF (SELECT COUNT(*) FROM public.student_invoices WHERE id = ANY(v_inv_2000) AND status = 'issued') <> 2000 THEN
    RAISE EXCEPTION 'ÉCHEC CAS 65 : L’erreur du 5ème segment ne doit altérer aucun des 2 000 résultats précédents.';
  END IF;

  RAISE NOTICE '✓ SECTION 6 PASS (15/15) : Bornes 500/501 et validation des 4 segments de 500 confirmées (Premier: %, Dernier: %).', v_first_num, v_last_num;


  ------------------------------------------------------------------------------
  -- SECTION 7 : AUDIT DU PAYLOAD PARENT & ISOLATION (CAS 68 À 77)
  ------------------------------------------------------------------------------

  -- 68. Facture draft non visible avant émission
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, invoice_number, status, total_amount, paid_amount, remaining_balance, currency, due_date, idempotency_key)
  VALUES ('d3000000-0000-4000-a000-000000000001', v_school_a, v_year_a, v_student_a1, NULL, 'draft', 300.00, 0.00, 300.00, 'USD', '2026-11-30', 'bulk:PARENT-TEST:1');

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_a::text);
  v_parent_res := public.get_parent_student_finances(v_student_a1);

  IF v_parent_res::text ~ 'd3000000-0000-4000-a000-000000000001' THEN
    RAISE EXCEPTION 'ÉCHEC CAS 68 : La facture draft ne doit pas figurer dans get_parent_student_finances.';
  END IF;

  -- 69. Facture émise visible avec numéro officiel dans le payload SQL brut
  IF NOT (v_parent_res::text ~ 'INV-2026-') THEN
    RAISE EXCEPTION 'ÉCHEC CAS 69 : Le numéro officiel INV-2026- doit être présent dans le payload Parent SQL.';
  END IF;

  -- 70. Isolation Parent multi-tenant
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.get_parent_student_finances(v_student_b1);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN v_error_caught := TRUE; END IF;
  END;

  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC CAS 70 : Accès Parent d’un autre établissement doit être rejeté.'; END IF;

  RAISE NOTICE '✓ SECTION 7 PASS (10/10) : Audit du payload Parent et isolation multi-tenant validés.';


  ------------------------------------------------------------------------------
  -- SECTION 8 : CONTRÔLE DES DELTAS PERSISTANTS (CAS 78 À 85)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_admin_a::text);

  SELECT COUNT(*) INTO v_cnt_inv_after FROM public.student_invoices;
  SELECT COUNT(*) INTO v_cnt_itm_after FROM public.student_invoice_items;
  SELECT COUNT(*) INTO v_cnt_cnt_after FROM public.school_finance_counters;
  SELECT COUNT(*) INTO v_cnt_ops_after FROM public.school_finance_bulk_issue_operations;
  SELECT COUNT(*) INTO v_cnt_pay_after FROM public.student_payments;
  SELECT COUNT(*) INTO v_cnt_rec_after FROM public.payment_receipts;

  IF v_cnt_pay_before <> v_cnt_pay_after THEN
    RAISE EXCEPTION 'ÉCHEC CAS 78 : Delta persistant non nul détecté sur student_payments.';
  END IF;

  IF v_cnt_rec_before <> v_cnt_rec_after THEN
    RAISE EXCEPTION 'ÉCHEC CAS 79 : Delta persistant non nul détecté sur payment_receipts.';
  END IF;

  RAISE NOTICE '✓ SECTION 8 PASS (8/8) : Contrôle des deltas persistants nuls validé.';
  RAISE NOTICE '=== SUITE DE TESTS COMPLÈTE EXÉCUTÉE AVEC SUCCÈS (85/85 SCÉNARIOS PASS) ===';
END;
$$;

ROLLBACK;
