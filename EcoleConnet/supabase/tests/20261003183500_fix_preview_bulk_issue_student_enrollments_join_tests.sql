-- Test SQL : 20261003183500_fix_preview_bulk_issue_student_enrollments_join_tests.sql
-- Description : Suite de tests automatisés transactionnels pour preview_bulk_issue_student_invoices (Lot 2K-FIN-BULK-ISSUE-ENROLLMENT-HOTFIX)
-- Exigences : commence par BEGIN;, se termine par ROLLBACK;, zéro COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.preview_bulk_issue_student_invoices(
  p_source_batch_key TEXT DEFAULT NULL,
  p_fee_id UUID DEFAULT NULL,
  p_invoice_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_selector_count INTEGER := 0;
  v_selector_type TEXT;
  v_selector_label TEXT;
  
  v_candidate_ids UUID[] := ARRAY[]::UUID[];
  v_inv RECORD;
  
  v_selected INTEGER := 0;
  v_eligible INTEGER := 0;
  v_already_issued INTEGER := 0;
  v_invalid INTEGER := 0;
  v_estimated_total NUMERIC(14, 2) := 0.00;
  v_currency TEXT := NULL;
  
  v_eligible_list JSONB := '[]'::JSONB;
  v_excluded_list JSONB := '[]'::JSONB;
  v_item_count INTEGER;
  v_sum_items NUMERIC(14, 2);
  
  v_clean_invoice_ids UUID[];
BEGIN
  -- 1. Contrôle d'authentification
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id
  INTO v_caller_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif peut prévisualiser l’émission groupée.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validation stricte du sélecteur unique
  IF p_source_batch_key IS NOT NULL AND trim(p_source_batch_key) <> '' THEN
    v_selector_count := v_selector_count + 1;
    v_selector_type := 'source_batch_key';
    v_selector_label := 'Brouillons du traitement groupé';
  END IF;

  IF p_fee_id IS NOT NULL THEN
    v_selector_count := v_selector_count + 1;
    v_selector_type := 'fee_id';
    v_selector_label := 'Brouillons du tarif sélectionné';
  END IF;

  IF p_invoice_ids IS NOT NULL AND ARRAY_LENGTH(p_invoice_ids, 1) > 0 THEN
    v_selector_count := v_selector_count + 1;
    v_selector_type := 'invoice_ids';
    v_selector_label := 'Sélection explicite de factures';
  END IF;

  IF v_selector_count <> 1 THEN
    RAISE EXCEPTION 'REJET : Vous devez fournir exactement un seul sélecteur (p_source_batch_key, p_fee_id ou p_invoice_ids).'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Récupération des factures candidates (max 2 000 pour la prévisualisation)
  IF v_selector_type = 'source_batch_key' THEN
    SELECT ARRAY_AGG(id ORDER BY created_at ASC)
    INTO v_candidate_ids
    FROM (
      SELECT id, created_at
      FROM public.student_invoices
      WHERE school_id = v_caller_school_id
        AND idempotency_key LIKE 'bulk:' || trim(p_source_batch_key) || ':%'
      LIMIT 2000
    ) sub;

  ELSIF v_selector_type = 'fee_id' THEN
    SELECT ARRAY_AGG(id ORDER BY created_at ASC)
    INTO v_candidate_ids
    FROM (
      SELECT DISTINCT inv.id, inv.created_at
      FROM public.student_invoices inv
      JOIN public.student_invoice_items itm ON itm.invoice_id = inv.id
      WHERE inv.school_id = v_caller_school_id
        AND itm.fee_id = p_fee_id
      LIMIT 2000
    ) sub;

  ELSIF v_selector_type = 'invoice_ids' THEN
    SELECT ARRAY_AGG(DISTINCT elem)
    INTO v_clean_invoice_ids
    FROM UNNEST(p_invoice_ids) elem
    WHERE elem IS NOT NULL;

    IF v_clean_invoice_ids IS NULL OR ARRAY_LENGTH(v_clean_invoice_ids, 1) = 0 THEN
      RAISE EXCEPTION 'REJET : Le tableau d’identifiants de factures ne peut être vide.' USING ERRCODE = '22023';
    END IF;

    IF ARRAY_LENGTH(v_clean_invoice_ids, 1) > 2000 THEN
      RAISE EXCEPTION 'REJET : La prévisualisation d’émission est limitée à 2 000 factures maximum.' USING ERRCODE = '22023';
    END IF;

    v_candidate_ids := v_clean_invoice_ids;
  END IF;

  v_candidate_ids := COALESCE(v_candidate_ids, ARRAY[]::UUID[]);
  v_selected := ARRAY_LENGTH(v_candidate_ids, 1);
  IF v_selected IS NULL THEN v_selected := 0; END IF;

  -- 4. Évaluation détaillée de chaque facture candidate
  IF v_selected > 0 THEN
    FOR v_inv IN
      SELECT DISTINCT ON (inv.id)
        inv.id,
        inv.created_at,
        inv.school_id,
        inv.status,
        inv.currency,
        inv.due_date,
        inv.total_amount,
        st.student_number,
        st.first_name || ' ' || st.last_name AS student_name,
        COALESCE(c.name, 'Non assigné') AS class_name
      FROM public.student_invoices inv
      JOIN public.students st ON st.id = inv.student_id
      LEFT JOIN public.student_enrollments se
        ON se.student_id = st.id
       AND se.school_id = inv.school_id
       AND se.academic_year_id = inv.academic_year_id
       AND se.status = 'active'
      LEFT JOIN public.classes c
        ON c.id = se.class_id
      WHERE inv.id = ANY(v_candidate_ids)
        AND inv.school_id = v_caller_school_id
      ORDER BY inv.id, inv.created_at ASC
    LOOP
      IF v_currency IS NULL THEN
        v_currency := v_inv.currency;
      END IF;

      -- Vérification des lignes
      SELECT COUNT(*), COALESCE(SUM(total_price), 0.00)
      INTO v_item_count, v_sum_items
      FROM public.student_invoice_items
      WHERE invoice_id = v_inv.id;

      IF v_inv.status <> 'draft' THEN
        v_already_issued := v_already_issued + 1;
        v_excluded_list := v_excluded_list || pg_catalog.jsonb_build_object(
          'invoice_id', v_inv.id,
          'student_number', COALESCE(v_inv.student_number, 'N/A'),
          'student_name', v_inv.student_name,
          'reason_code', 'already_issued',
          'reason_label', 'Facture déjà émise ou non-brouillon'
        );
      ELSIF v_item_count < 1 OR v_sum_items <= 0.00 THEN
        v_invalid := v_invalid + 1;
        v_excluded_list := v_excluded_list || pg_catalog.jsonb_build_object(
          'invoice_id', v_inv.id,
          'student_number', COALESCE(v_inv.student_number, 'N/A'),
          'student_name', v_inv.student_name,
          'reason_code', 'invalid_total',
          'reason_label', 'Montant de facture invalide ou sans ligne de frais'
        );
      ELSE
        v_eligible := v_eligible + 1;
        v_estimated_total := v_estimated_total + v_sum_items;
        v_eligible_list := v_eligible_list || pg_catalog.jsonb_build_object(
          'invoice_id', v_inv.id,
          'student_number', COALESCE(v_inv.student_number, 'N/A'),
          'student_name', v_inv.student_name,
          'class_name', v_inv.class_name,
          'amount', v_sum_items,
          'currency', v_inv.currency,
          'due_date', v_inv.due_date
        );
      END IF;
    END LOOP;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'selector', pg_catalog.jsonb_build_object(
      'type', v_selector_type,
      'label', v_selector_label
    ),
    'summary', pg_catalog.jsonb_build_object(
      'selected', v_selected,
      'eligible', v_eligible,
      'already_issued', v_already_issued,
      'invalid', v_invalid,
      'estimated_total', v_estimated_total,
      'currency', COALESCE(v_currency, 'USD')
    ),
    'eligible_invoices', v_eligible_list,
    'excluded_invoices', v_excluded_list
  );
END;
$$;

ALTER FUNCTION public.preview_bulk_issue_student_invoices(TEXT, UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_bulk_issue_student_invoices(TEXT, UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_bulk_issue_student_invoices(TEXT, UUID, UUID[]) TO authenticated;

DO $$
DECLARE
  -- Identifiants de test isolés Établissement A
  v_school_a UUID := 'e1000000-0000-4000-a000-000000000001';
  v_year_a_2026 UUID := 'e2000000-0000-4000-a000-000000000001';
  v_year_a_2025 UUID := 'e2000000-0000-4000-a000-000000000002';
  v_class_a1 UUID := 'e3000000-0000-4000-a000-000000000001';
  v_class_a2 UUID := 'e3000000-0000-4000-a000-000000000002';
  v_admin_a  UUID := 'e4000000-0000-4000-a000-000000000001';

  -- Inscriptions UUIDs
  v_enr_active_same UUID := 'e8000000-0000-4000-a000-000000000010';
  v_enr_other_year  UUID := 'e8000000-0000-4000-a000-000000000020';
  v_enr_transferred UUID := 'e8000000-0000-4000-a000-000000000030';
  v_enr_daniel      UUID := 'e8000000-0000-4000-a000-000000000040';
  v_enr_anomalous_1 UUID := 'e8000000-0000-4000-a000-000000000001';
  v_enr_anomalous_2 UUID := 'e8000000-0000-4000-a000-000000000002';
  v_enr_school_b    UUID := 'f8000000-0000-4000-a000-000000000010';

  -- Élèves
  v_st_active_same_year UUID := 'e9000000-0000-4000-a000-000000000001';
  v_st_other_year       UUID := 'e9000000-0000-4000-a000-000000000002';
  v_st_transferred      UUID := 'e9000000-0000-4000-a000-000000000003';
  v_st_daniel           UUID := 'e9000000-0000-4000-a000-000000000004';
  v_st_anomalous_dup    UUID := 'e9000000-0000-4000-a000-000000000005';

  -- Établissement B (Autre établissement)
  v_school_b UUID := 'f1000000-0000-4000-a000-000000000001';
  v_year_b   UUID := 'f2000000-0000-4000-a000-000000000001';
  v_class_b1 UUID := 'f3000000-0000-4000-a000-000000000001';
  v_admin_b  UUID := 'f4000000-0000-4000-a000-000000000001';
  v_st_school_b UUID := 'f9000000-0000-4000-a000-000000000001';

  -- Tarifs & Factures
  v_fee_a1 UUID := 'fe000000-0000-4000-a000-000000000001';
  v_fee_a2 UUID := 'fe000000-0000-4000-a000-000000000002';
  v_fee_b1 UUID := 'fe000000-0000-4000-b000-000000000001';

  v_inv_active_same UUID := 'c1000000-0000-4000-a000-000000000001';
  v_inv_other_year  UUID := 'c1000000-0000-4000-a000-000000000002';
  v_inv_transferred UUID := 'c1000000-0000-4000-a000-000000000003';
  v_inv_daniel      UUID := 'c1000000-0000-4000-a000-000000000004';
  v_inv_anomalous   UUID := 'c1000000-0000-4000-a000-000000000005';
  v_inv_school_b    UUID := 'c2000000-0000-4000-a000-000000000001';

  -- Contrôles
  v_res JSONB;
  v_summary JSONB;
  v_eligible_list JSONB;
  v_sel INT;
  v_elig INT;
  v_iss INT;
  v_inv INT;

  -- Count baselines
  v_cnt_inv_before INT;
  v_cnt_cnt_before INT;
  v_cnt_pay_before INT;
  v_cnt_rec_before INT;
  v_cnt_ops_before INT;

  v_cnt_inv_after INT;
  v_cnt_cnt_after INT;
  v_cnt_pay_after INT;
  v_cnt_rec_after INT;
  v_cnt_ops_after INT;
BEGIN
  RAISE NOTICE '=== DÉBUT SUITE DE TESTS COMPLÈTE HOTFIX ENROLLMENT JOIN ===';

  -- 1. Compteurs initiaux
  SELECT COUNT(*) INTO v_cnt_inv_before FROM public.student_invoices;
  SELECT COUNT(*) INTO v_cnt_cnt_before FROM public.school_finance_counters;
  SELECT COUNT(*) INTO v_cnt_pay_before FROM public.student_payments;
  SELECT COUNT(*) INTO v_cnt_rec_before FROM public.payment_receipts;
  SELECT COUNT(*) INTO v_cnt_ops_before FROM public.school_finance_bulk_issue_operations;

  -- 2. Seeding des structures de test isolées
  INSERT INTO public.schools (id, name, slug, status)
  VALUES (v_school_a, 'École Hotfix A', 'ecole-hotfix-a', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES 
    (v_year_a_2026, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_a_2025, v_school_a, '2025-2026', '2025-09-01', '2026-06-30', false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.classes (id, school_id, name, academic_year_id)
  VALUES 
    (v_class_a1, v_school_a, 'Classe 6e A', v_year_a_2026),
    (v_class_a2, v_school_a, 'Classe 5e A', v_year_a_2025)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (id, instance_id, email, role, aud)
  VALUES (v_admin_a, '00000000-0000-0000-0000-000000000000', 'admin.hotfix@test.com', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_admin_a, v_school_a, 'school_admin', 'Admin', 'Hotfix', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.school_fees (id, school_id, academic_year_id, name, fee_type, amount, currency, due_date, is_active, created_by)
  VALUES 
    (v_fee_a1, v_school_a, v_year_a_2026, 'Frais Test Hotfix', 'minerval', 50.00, 'USD', '2026-10-31', true, v_admin_a),
    (v_fee_a2, v_school_a, v_year_a_2025, 'Frais Test Hotfix 2025', 'minerval', 50.00, 'USD', '2025-10-31', true, v_admin_a)
  ON CONFLICT (id) DO NOTHING;

  -- Élèves Établissement A
  INSERT INTO public.students (id, school_id, student_number, first_name, last_name)
  VALUES 
    (v_st_active_same_year, v_school_a, 'ELV-H01', 'Active', 'SameYear'),
    (v_st_other_year,       v_school_a, 'ELV-H02', 'Active', 'OtherYear'),
    (v_st_transferred,      v_school_a, 'ELV-H03', 'Inactive', 'Transferred'),
    (v_st_daniel,           v_school_a, 'ELV-H04', 'Daniel', 'Kabeya'),
    (v_st_anomalous_dup,    v_school_a, 'ELV-H05', 'Anomalous', 'MultiActive')
  ON CONFLICT (id) DO NOTHING;

  -- Inscriptions Élèves A
  -- 1. Inscription active de la même année
  INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status)
  VALUES (v_enr_active_same, v_school_a, v_st_active_same_year, v_class_a1, v_year_a_2026, 'active')
  ON CONFLICT DO NOTHING;

  -- 2. Inscription d'une autre année (2025-2026, statut 'transferred')
  INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status)
  VALUES (v_enr_other_year, v_school_a, v_st_other_year, v_class_a2, v_year_a_2025, 'transferred')
  ON CONFLICT DO NOTHING;

  -- 3. Inscription transférée/suspendue sur 2026-2027
  INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status)
  VALUES (v_enr_transferred, v_school_a, v_st_transferred, v_class_a1, v_year_a_2026, 'transferred')
  ON CONFLICT DO NOTHING;

  -- 4. Brouillon Daniel (1 inscription active sur 2026-2027)
  INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status)
  VALUES (v_enr_daniel, v_school_a, v_st_daniel, v_class_a1, v_year_a_2026, 'active')
  ON CONFLICT DO NOTHING;

  -- 5. Inscriptions multiples anormales (2 inscriptions actives pour la même année 2026-2027)
  INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status)
  VALUES 
    (v_enr_anomalous_1, v_school_a, v_st_anomalous_dup, v_class_a1, v_year_a_2026, 'active'),
    (v_enr_anomalous_2, v_school_a, v_st_anomalous_dup, v_class_a1, v_year_a_2026, 'active')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.schools (id, name, slug, status)
  VALUES (v_school_b, 'École Hotfix B', 'ecole-hotfix-b', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (v_year_b, v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.classes (id, school_id, name, academic_year_id)
  VALUES (v_class_b1, v_school_b, 'Classe B1', v_year_b)
  ON CONFLICT DO NOTHING;

  INSERT INTO auth.users (id, instance_id, email, role, aud)
  VALUES (v_admin_b, '00000000-0000-0000-0000-000000000000', 'admin.b@test.com', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_admin_b, v_school_b, 'school_admin', 'Admin', 'Beta', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.school_fees (id, school_id, academic_year_id, name, fee_type, amount, currency, due_date, is_active, created_by)
  VALUES (v_fee_b1, v_school_b, v_year_b, 'Frais Test B', 'minerval', 50.00, 'USD', '2026-10-31', true, v_admin_b)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.students (id, school_id, student_number, first_name, last_name)
  VALUES (v_st_school_b, v_school_b, 'ELV-HB01', 'Student', 'Beta')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status)
  VALUES (v_enr_school_b, v_school_b, v_st_school_b, v_class_b1, v_year_b, 'active')
  ON CONFLICT DO NOTHING;

  -- Brouillons de factures avec enrollment_id et invoice_number
  -- 1. Inscription active même année (50.00 USD)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, status, total_amount, paid_amount, currency, due_date, created_by)
  VALUES (v_inv_active_same, v_school_a, v_year_a_2026, v_st_active_same_year, v_enr_active_same, v_class_a1, 'DRAFT-H01', 9901, 'draft', 50.00, 0.00, 'USD', '2026-10-31', v_admin_a)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.student_invoice_items (school_id, academic_year_id, invoice_id, student_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price, currency)
  VALUES (v_school_a, v_year_a_2026, v_inv_active_same, v_st_active_same_year, v_fee_a1, 'Frais Test Hotfix', 'minerval', 50.00, 1, 50.00, 'USD') ON CONFLICT DO NOTHING;

  -- 2. Inscription autre année (50.00 USD)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, status, total_amount, paid_amount, currency, due_date, created_by)
  VALUES (v_inv_other_year, v_school_a, v_year_a_2025, v_st_other_year, v_enr_other_year, v_class_a2, 'DRAFT-H02', 9902, 'draft', 50.00, 0.00, 'USD', '2026-10-31', v_admin_a)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.student_invoice_items (school_id, academic_year_id, invoice_id, student_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price, currency)
  VALUES (v_school_a, v_year_a_2025, v_inv_other_year, v_st_other_year, v_fee_a2, 'Frais Test Hotfix 2025', 'minerval', 50.00, 1, 50.00, 'USD') ON CONFLICT DO NOTHING;

  -- 3. Inscription transférée (50.00 USD)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, status, total_amount, paid_amount, currency, due_date, created_by)
  VALUES (v_inv_transferred, v_school_a, v_year_a_2026, v_st_transferred, v_enr_transferred, v_class_a1, 'DRAFT-H03', 9903, 'draft', 50.00, 0.00, 'USD', '2026-10-31', v_admin_a)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.student_invoice_items (school_id, academic_year_id, invoice_id, student_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price, currency)
  VALUES (v_school_a, v_year_a_2026, v_inv_transferred, v_st_transferred, v_fee_a1, 'Frais Test Hotfix', 'minerval', 50.00, 1, 50.00, 'USD') ON CONFLICT DO NOTHING;

  -- 4. Brouillon Daniel (5.00 USD)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, status, total_amount, paid_amount, currency, due_date, created_by)
  VALUES (v_inv_daniel, v_school_a, v_year_a_2026, v_st_daniel, v_enr_daniel, v_class_a1, 'DRAFT-H04', 9904, 'draft', 5.00, 0.00, 'USD', '2026-10-31', v_admin_a)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.student_invoice_items (school_id, academic_year_id, invoice_id, student_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price, currency)
  VALUES (v_school_a, v_year_a_2026, v_inv_daniel, v_st_daniel, v_fee_a1, 'Frais Test Hotfix (Daniel)', 'minerval', 5.00, 1, 5.00, 'USD') ON CONFLICT DO NOTHING;

  -- 5. Inscriptions anormales (50.00 USD)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, status, total_amount, paid_amount, currency, due_date, created_by)
  VALUES (v_inv_anomalous, v_school_a, v_year_a_2026, v_st_anomalous_dup, v_enr_anomalous_1, v_class_a1, 'DRAFT-H05', 9905, 'draft', 50.00, 0.00, 'USD', '2026-10-31', v_admin_a)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.student_invoice_items (school_id, academic_year_id, invoice_id, student_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price, currency)
  VALUES (v_school_a, v_year_a_2026, v_inv_anomalous, v_st_anomalous_dup, v_fee_a1, 'Frais Test Hotfix', 'minerval', 50.00, 1, 50.00, 'USD') ON CONFLICT DO NOTHING;

  -- 6. Facture Établissement B (50.00 USD)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, status, total_amount, paid_amount, currency, due_date, created_by)
  VALUES (v_inv_school_b, v_school_b, v_year_b, v_st_school_b, v_enr_school_b, v_class_b1, 'DRAFT-HB01', 9906, 'draft', 50.00, 0.00, 'USD', '2026-10-31', v_admin_b)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.student_invoice_items (school_id, academic_year_id, invoice_id, student_id, fee_id, fee_name, fee_type, unit_price, quantity, total_price, currency)
  VALUES (v_school_b, v_year_b, v_inv_school_b, v_st_school_b, v_fee_b1, 'Frais Test B', 'minerval', 50.00, 1, 50.00, 'USD') ON CONFLICT DO NOTHING;


  ------------------------------------------------------------------------------
  -- EXÉCUTION DU TEST DE PRÉVISUALISATION
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_admin_a::text);

  v_res := public.preview_bulk_issue_student_invoices(
    p_invoice_ids => ARRAY[
      v_inv_active_same,
      v_inv_other_year,
      v_inv_transferred,
      v_inv_daniel,
      v_inv_anomalous,
      v_inv_school_b
    ]
  );

  v_summary := v_res->'summary';
  v_eligible_list := v_res->'eligible_invoices';

  v_sel  := (v_summary->>'selected')::INT;
  v_elig := (v_summary->>'eligible')::INT;
  v_iss  := (v_summary->>'already_issued')::INT;
  v_inv  := (v_summary->>'invalid')::INT;

  -- CAS A : Autre établissement exclu de la liste éligible
  IF (SELECT COUNT(*) FROM jsonb_array_elements(v_eligible_list) elem WHERE elem->>'invoice_id' = v_inv_school_b::text) <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 1 : Autre établissement non exclu des éligibles.';
  END IF;

  -- CAS B : Invariant (eligible + already_issued + invalid) = factures de l’établissement (5)
  IF (v_elig + v_iss + v_inv) <> 5 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 2 : Invariant rompu (eligible % + already_issued % + invalid % != 5).',
      v_elig, v_iss, v_inv;
  END IF;

  -- CAS C : Toutes les 5 factures candidates de l'école A sont au statut draft et valides -> eligible = 5
  IF v_elig <> 5 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 3 : Nombre d’éligibles incorrect (eligible = %, attendu: 5).', v_elig;
  END IF;

  -- CAS D : Brouillon Daniel (v_inv_daniel) est présent EXACTEMENT une seule fois dans la liste éligible
  IF (SELECT COUNT(*) FROM jsonb_array_elements(v_eligible_list) elem WHERE elem->>'invoice_id' = v_inv_daniel::text) <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 4 : Le brouillon de Daniel n’est pas présent exactement 1 fois dans les éligibles.';
  END IF;

  -- CAS E : Facture v_inv_anomalous (élève avec 2 inscriptions actives) est présente EXACTEMENT une seule fois (pas de duplication)
  IF (SELECT COUNT(*) FROM jsonb_array_elements(v_eligible_list) elem WHERE elem->>'invoice_id' = v_inv_anomalous::text) <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 5 : Facture avec inscriptions anormales dupliquée (count != 1).';
  END IF;

  -- CAS F : Inscription active même année -> Nom de classe "Classe 6e A" associé
  IF (SELECT elem->>'class_name' FROM jsonb_array_elements(v_eligible_list) elem WHERE elem->>'invoice_id' = v_inv_active_same::text) <> 'Classe 6e A' THEN
    RAISE EXCEPTION 'ÉCHEC TEST 6 : Inscription active même année n’a pas récupéré la bonne classe.';
  END IF;

  -- CAS G : Inscription d'une autre année -> classe_name = "Non assigné"
  IF (SELECT elem->>'class_name' FROM jsonb_array_elements(v_eligible_list) elem WHERE elem->>'invoice_id' = v_inv_other_year::text) <> 'Non assigné' THEN
    RAISE EXCEPTION 'ÉCHEC TEST 7 : Inscription d’une autre année doit donner "Non assigné".';
  END IF;

  -- CAS H : Inscription transférée -> classe_name = "Non assigné"
  IF (SELECT elem->>'class_name' FROM jsonb_array_elements(v_eligible_list) elem WHERE elem->>'invoice_id' = v_inv_transferred::text) <> 'Non assigné' THEN
    RAISE EXCEPTION 'ÉCHEC TEST 8 : Inscription transférée doit donner "Non assigné".';
  END IF;

  RAISE NOTICE '✓ SUITE SQL TEST PASSED : Invariants, jointures et exclusions validés.';

  ------------------------------------------------------------------------------
  -- VÉRIFICATION DE LA MUTATION NULLE (DELTAS = 0 CONTRÔLÉS)
  ------------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_cnt_cnt_after FROM public.school_finance_counters;
  SELECT COUNT(*) INTO v_cnt_pay_after FROM public.student_payments;
  SELECT COUNT(*) INTO v_cnt_rec_after FROM public.payment_receipts;
  SELECT COUNT(*) INTO v_cnt_ops_after FROM public.school_finance_bulk_issue_operations;

  IF v_cnt_cnt_before <> v_cnt_cnt_after THEN
    RAISE EXCEPTION 'ÉCHEC DELTA : Altération des compteurs détectée.';
  END IF;

  IF v_cnt_pay_before <> v_cnt_pay_after THEN
    RAISE EXCEPTION 'ÉCHEC DELTA : Altération des paiements détectée.';
  END IF;

  IF v_cnt_rec_before <> v_cnt_rec_after THEN
    RAISE EXCEPTION 'ÉCHEC DELTA : Altération des reçus détectée.';
  END IF;

  IF v_cnt_ops_before <> v_cnt_ops_after THEN
    RAISE EXCEPTION 'ÉCHEC DELTA : Altération des opérations d’idempotence détectée.';
  END IF;

  RAISE NOTICE '✓ DELTA CHECK PASSED : 0 mutation sur compteurs, paiements, reçus et opérations.';
END;
$$;

ROLLBACK;
