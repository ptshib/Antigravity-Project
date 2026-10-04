-- =============================================================================
-- ÉCOLECONNECT — SUITE DE TESTS SQL TRANSACTIONNELS V4 (LOT 2K-FIN-CASH-F-V2)
-- Fichier: supabase/tests/20261004150000_cash_register_journal_rpc_tests.sql
-- Description: Inactifs, Invariants, by_class & Fuseaux horaires (Lot 2K-FIN-CASH-F-V2)
-- Exigences: commence par BEGIN;, se termine par ROLLBACK;, zéro COMMIT;
-- =============================================================================

BEGIN;

DO $$
DECLARE
  -- Identifiants Établissement A (Kinshasa)
  v_school_a UUID := 'a1000000-0000-4000-a000-000000000001';
  v_year_a   UUID := 'a2000000-0000-4000-a000-000000000001';
  v_class_a1 UUID := 'a3000000-0000-4000-a000-000000000001';
  v_class_a2 UUID := 'a3000000-0000-4000-a000-000000000002';
  v_admin_a  UUID := 'a4000000-0000-4000-a000-000000000001';
  v_agent_a  UUID := 'a5000000-0000-4000-a000-000000000001';
  v_teacher_a UUID := 'a6000000-0000-4000-a000-000000000001';
  v_parent_a  UUID := 'a7000000-0000-4000-a000-000000000001';

  v_student_a1 UUID := 'a9000000-0000-4000-a000-000000000001';
  v_student_a2 UUID := 'a9000000-0000-4000-a000-000000000002';
  v_enroll_a1 UUID := 'ae000000-0000-4000-a000-000000000001';
  v_enroll_a2 UUID := 'ae000000-0000-4000-a000-000000000002';

  -- Profil inactif et Établissement suspendu
  v_inactive_agent UUID := 'a8000000-0000-4000-a000-000000000001';
  v_school_suspended UUID := 'c1000000-0000-4000-a000-000000000001';
  v_admin_suspended  UUID := 'c4000000-0000-4000-a000-000000000001';

  -- Identifiants Établissement B (Lubumbashi)
  v_school_b UUID := 'b1000000-0000-4000-a000-000000000001';
  v_year_b   UUID := 'b2000000-0000-4000-a000-000000000001';
  v_class_b1 UUID := 'b3000000-0000-4000-a000-000000000001';
  v_admin_b  UUID := 'b4000000-0000-4000-a000-000000000001';
  v_student_b1 UUID := 'b9000000-0000-4000-a000-000000000001';
  v_enroll_b1 UUID := 'be000000-0000-4000-a000-000000000001';

  -- Factures
  v_inv_mono UUID := 'd1000000-0000-4000-a000-000000000001';
  v_inv_multi_cat UUID := 'd1000000-0000-4000-a000-000000000002';
  v_inv_same_day UUID := 'd1000000-0000-4000-a000-000000000003';
  v_inv_mismatch UUID := 'd1000000-0000-4000-a000-000000000004';
  v_inv_empty UUID := 'd1000000-0000-4000-a000-000000000005';
  v_inv_cdf   UUID := 'd1000000-0000-4000-a000-000000000006';
  v_inv_b     UUID := 'd2000000-0000-4000-a000-000000000001';

  -- Paiements
  v_pay_mono UUID := 'e1000000-0000-4000-a000-000000000001';
  v_pay_multi_cat UUID := 'e1000000-0000-4000-a000-000000000002';
  v_pay_multi_cancel UUID := 'e1000000-0000-4000-a000-000000000003';
  v_pay_same_day UUID := 'e1000000-0000-4000-a000-000000000004';
  v_pay_mismatch UUID := 'e1000000-0000-4000-a000-000000000005';
  v_pay_empty UUID := 'e1000000-0000-4000-a000-000000000006';
  v_pay_cdf   UUID := 'e1000000-0000-4000-a000-000000000007';
  v_pay_b     UUID := 'e2000000-0000-4000-a000-000000000001';

  -- Contrôle des compteurs
  v_cnt_payments_before INTEGER;
  v_cnt_payments_after INTEGER;

  -- Résultats et contrôles d'invariants
  v_res JSONB;
  v_res_p1 JSONB;
  v_res_p2 JSONB;
  v_res_b JSONB;
  v_res_null_dates JSONB;

  v_summary_usd JSONB;
  v_summary_cdf JSONB;
  v_by_class_usd JSONB;

  v_class_gross_sum NUMERIC;
  v_class_cancelled_sum NUMERIC;
  v_class_net_sum NUMERIC;
  v_class_confirmed_sum NUMERIC;

  v_uuid_matches INT;
  v_assertions_count INT := 0;

  v_p1_numbers TEXT[];
  v_p2_numbers TEXT[];
BEGIN
  RAISE NOTICE '=== DÉBUT SUITE DE TESTS COMPLÈTE V4 (LOT 2K-FIN-CASH-F-V2) ===';

  -- Nettoyage pré-fixture idempotent
  DELETE FROM public.payment_receipts WHERE payment_id IN (v_pay_mono, v_pay_multi_cat, v_pay_multi_cancel, v_pay_same_day, v_pay_mismatch, v_pay_empty, v_pay_cdf, v_pay_b) OR school_id IN (v_school_a, v_school_b, v_school_suspended);
  DELETE FROM public.student_payments WHERE id IN (v_pay_mono, v_pay_multi_cat, v_pay_multi_cancel, v_pay_same_day, v_pay_mismatch, v_pay_empty, v_pay_cdf, v_pay_b) OR school_id IN (v_school_a, v_school_b, v_school_suspended);
  DELETE FROM public.student_invoice_items WHERE invoice_id IN (v_inv_mono, v_inv_multi_cat, v_inv_same_day, v_inv_mismatch, v_inv_empty, v_inv_cdf, v_inv_b) OR school_id IN (v_school_a, v_school_b, v_school_suspended);
  DELETE FROM public.student_invoices WHERE id IN (v_inv_mono, v_inv_multi_cat, v_inv_same_day, v_inv_mismatch, v_inv_empty, v_inv_cdf, v_inv_b) OR school_id IN (v_school_a, v_school_b, v_school_suspended);
  DELETE FROM public.student_enrollments WHERE id IN (v_enroll_a1, v_enroll_a2, v_enroll_b1) OR school_id IN (v_school_a, v_school_b, v_school_suspended);
  DELETE FROM public.students WHERE id IN (v_student_a1, v_student_a2, v_student_b1) OR school_id IN (v_school_a, v_school_b, v_school_suspended);
  DELETE FROM public.profiles WHERE id IN (v_admin_a, v_agent_a, v_inactive_agent, v_admin_suspended, v_teacher_a, v_parent_a, v_student_a1, v_student_a2, v_admin_b, v_student_b1) OR school_id IN (v_school_a, v_school_b, v_school_suspended);
  DELETE FROM auth.users WHERE id IN (v_admin_a, v_agent_a, v_inactive_agent, v_admin_suspended, v_teacher_a, v_parent_a, v_student_a1, v_student_a2, v_admin_b, v_student_b1) OR email LIKE '%@test.cd';
  DELETE FROM public.classes WHERE id IN (v_class_a1, v_class_a2, v_class_b1) OR school_id IN (v_school_a, v_school_b, v_school_suspended);
  DELETE FROM public.academic_years WHERE id IN (v_year_a, v_year_b) OR school_id IN (v_school_a, v_school_b, v_school_suspended);
  DELETE FROM public.schools WHERE id IN (v_school_a, v_school_b, v_school_suspended);

  SELECT COUNT(*) INTO v_cnt_payments_before FROM public.student_payments WHERE school_id IN (v_school_a, v_school_b);

  ------------------------------------------------------------------------------
  -- FIXTURES MULTI-TENANT (Écoles A, B et Suspendue)
  ------------------------------------------------------------------------------
  INSERT INTO public.schools (id, name, slug, timezone, status)
  VALUES
    (v_school_a, 'Complexe Scolaire Congo A', 'cs-congo-a', 'Africa/Kinshasa', 'active'),
    (v_school_b, 'Académie Kivuvu B', 'academie-kivuvu-b', 'Africa/Lubumbashi', 'active'),
    (v_school_suspended, 'École Inactive C', 'ecole-inactive-c', 'Africa/Kinshasa', 'suspended')
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES
    (v_year_a, v_school_a, '2025-2026', '2025-09-01', '2026-07-01', true),
    (v_year_b, v_school_b, '2025-2026', '2025-09-01', '2026-07-01', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.classes (id, school_id, academic_year_id, name)
  VALUES
    (v_class_a1, v_school_a, v_year_a, '6ème Math-Physique'),
    (v_class_a2, v_school_a, v_year_a, '5ème Biologie-Chimie'),
    (v_class_b1, v_school_b, v_year_b, '4ème Littéraire')
  ON CONFLICT (id) DO NOTHING;

  -- Users dans auth.users
  INSERT INTO auth.users (id, email)
  VALUES
    (v_admin_a, 'admin_a@test.cd'),
    (v_agent_a, 'agent_a@test.cd'),
    (v_inactive_agent, 'inactive_agent@test.cd'),
    (v_admin_suspended, 'admin_suspended@test.cd'),
    (v_teacher_a, 'teacher_a@test.cd'),
    (v_parent_a, 'parent_a@test.cd'),
    (v_student_a1, 'student_a1@test.cd'),
    (v_student_a2, 'student_a2@test.cd'),
    (v_admin_b, 'admin_b@test.cd'),
    (v_student_b1, 'student_b1@test.cd')
  ON CONFLICT (id) DO NOTHING;

  -- Profils École A & B & Inactifs
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES
    (v_admin_a, v_school_a, 'school_admin', 'Chantal', 'Mukendi', true),
    (v_agent_a, v_school_a, 'finance_agent', 'Kizito', 'Ilunga', true),
    (v_inactive_agent, v_school_a, 'finance_agent', 'Inactif', 'Agent', false),
    (v_admin_suspended, v_school_suspended, 'school_admin', 'Admin', 'Suspendu', true),
    (v_teacher_a, v_school_a, 'teacher', 'Patrice', 'Lumumba', true),
    (v_parent_a, v_school_a, 'parent', 'Joseph', 'Kasa', true),
    (v_student_a1, v_school_a, 'student', 'Dieudonné', 'Mbala', true),
    (v_student_a2, v_school_a, 'student', 'Grace', 'Kabeya', true),
    (v_admin_b, v_school_b, 'school_admin', 'Barthélémy', 'Kagame', true),
    (v_student_b1, v_school_b, 'student', 'Sifa', 'Bahati', true)
  ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

  -- Élèves
  INSERT INTO public.students (id, school_id, profile_id, student_number, first_name, last_name, gender, date_of_birth, enrollment_status)
  VALUES
    (v_student_a1, v_school_a, v_student_a1, 'MAT-2026-001', 'Dieudonné', 'Mbala', 'M', '2010-05-12', 'active'),
    (v_student_a2, v_school_a, v_student_a2, 'MAT-2026-002', 'Grace', 'Kabeya', 'F', '2011-08-20', 'active'),
    (v_student_b1, v_school_b, v_student_b1, 'MAT-2026-B01', 'Sifa', 'Bahati', 'F', '2010-01-10', 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Inscriptions (Classe A1 et Classe A2)
  INSERT INTO public.student_enrollments (id, school_id, academic_year_id, student_id, class_id, status)
  VALUES
    (v_enroll_a1, v_school_a, v_year_a, v_student_a1, v_class_a1, 'active'),
    (v_enroll_a2, v_school_a, v_year_a, v_student_a2, v_class_a2, 'active'),
    (v_enroll_b1, v_school_b, v_year_b, v_student_b1, v_class_b1, 'active')
  ON CONFLICT (id) DO NOTHING;

  ------------------------------------------------------------------------------
  -- FACTURES ET LIGNES DE FACTURE
  ------------------------------------------------------------------------------
  -- 1. Facture Monocatégorie USD Classe A1 ($100)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
  VALUES (v_inv_mono, v_school_a, v_year_a, v_student_a1, v_enroll_a1, v_class_a1, 'FAC-2026-001', 1, CURRENT_DATE - 5, CURRENT_DATE + 30, 'USD', 100.00, 0.00, 'draft', v_admin_a)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (id, invoice_id, school_id, academic_year_id, student_id, currency, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES (gen_random_uuid(), v_inv_mono, v_school_a, v_year_a, v_student_a1, 'USD', 'Minerval Trimestre 1', 'minerval', 100.00, 1, 100.00)
  ON CONFLICT DO NOTHING;

  UPDATE public.student_invoices SET status = 'issued' WHERE id = v_inv_mono;
  UPDATE public.student_invoices SET status = 'paid', paid_amount = 100.00 WHERE id = v_inv_mono;

  -- 2. Facture Multicatégorie USD Classe A2 ($30)
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
  VALUES (v_inv_multi_cat, v_school_a, v_year_a, v_student_a2, v_enroll_a2, v_class_a2, 'FAC-2026-002', 2, CURRENT_DATE - 5, CURRENT_DATE + 30, 'USD', 30.00, 0.00, 'draft', v_admin_a)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (id, invoice_id, school_id, academic_year_id, student_id, currency, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES
    (gen_random_uuid(), v_inv_multi_cat, v_school_a, v_year_a, v_student_a2, 'USD', 'Frais Minerval', 'minerval', 10.00, 1, 10.00),
    (gen_random_uuid(), v_inv_multi_cat, v_school_a, v_year_a, v_student_a2, 'USD', 'Frais Transport', 'transport', 10.00, 1, 10.00),
    (gen_random_uuid(), v_inv_multi_cat, v_school_a, v_year_a, v_student_a2, 'USD', 'Frais Uniforme', 'uniforme', 10.00, 1, 10.00)
  ON CONFLICT DO NOTHING;

  UPDATE public.student_invoices SET status = 'issued' WHERE id = v_inv_multi_cat;
  UPDATE public.student_invoices SET status = 'partially_paid', paid_amount = 10.00 WHERE id = v_inv_multi_cat;

  -- 3. Facture pour paiement créé et annulé le même jour ($50) Classe A1
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
  VALUES (v_inv_same_day, v_school_a, v_year_a, v_student_a1, v_enroll_a1, v_class_a1, 'FAC-2026-003', 3, CURRENT_DATE - 2, CURRENT_DATE + 30, 'USD', 50.00, 0.00, 'draft', v_admin_a)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (id, invoice_id, school_id, academic_year_id, student_id, currency, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES (gen_random_uuid(), v_inv_same_day, v_school_a, v_year_a, v_student_a1, 'USD', 'Frais examen', 'activites', 50.00, 1, 50.00)
  ON CONFLICT DO NOTHING;

  UPDATE public.student_invoices SET status = 'issued', paid_amount = 0.00 WHERE id = v_inv_same_day;

  -- 4. Facture Mismatch ($80) Classe A1
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
  VALUES (v_inv_mismatch, v_school_a, v_year_a, v_student_a1, v_enroll_a1, v_class_a1, 'FAC-2026-004', 4, CURRENT_DATE - 2, CURRENT_DATE + 30, 'USD', 80.00, 0.00, 'draft', v_admin_a)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (id, invoice_id, school_id, academic_year_id, student_id, currency, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES
    (gen_random_uuid(), v_inv_mismatch, v_school_a, v_year_a, v_student_a1, 'USD', 'Partie 1', 'minerval', 40.00, 1, 40.00),
    (gen_random_uuid(), v_inv_mismatch, v_school_a, v_year_a, v_student_a1, 'USD', 'Partie 2', 'cantine', 40.00, 1, 40.00)
  ON CONFLICT DO NOTHING;

  UPDATE public.student_invoices SET status = 'issued' WHERE id = v_inv_mismatch;
  UPDATE public.student_invoices SET status = 'partially_paid', paid_amount = 40.00 WHERE id = v_inv_mismatch;

  -- 5. Facture Sans ligne au départ ($20) Classe A1
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
  VALUES (v_inv_empty, v_school_a, v_year_a, v_student_a1, v_enroll_a1, v_class_a1, 'FAC-2026-005', 5, CURRENT_DATE - 2, CURRENT_DATE + 30, 'USD', 20.00, 0.00, 'draft', v_admin_a)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (id, invoice_id, school_id, academic_year_id, student_id, currency, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES (gen_random_uuid(), v_inv_empty, v_school_a, v_year_a, v_student_a1, 'USD', 'Frais divers', 'divers', 20.00, 1, 20.00)
  ON CONFLICT DO NOTHING;

  UPDATE public.student_invoices SET status = 'issued' WHERE id = v_inv_empty;
  UPDATE public.student_invoices SET status = 'paid', paid_amount = 20.00 WHERE id = v_inv_empty;

  -- 6. Facture CDF (250,000 CDF) Classe A1
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
  VALUES (v_inv_cdf, v_school_a, v_year_a, v_student_a1, v_enroll_a1, v_class_a1, 'FAC-2026-006', 6, CURRENT_DATE - 2, CURRENT_DATE + 30, 'CDF', 250000.00, 0.00, 'draft', v_admin_a)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_invoice_items (id, invoice_id, school_id, academic_year_id, student_id, currency, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES (gen_random_uuid(), v_inv_cdf, v_school_a, v_year_a, v_student_a1, 'CDF', 'Minerval CDF', 'minerval', 250000.00, 1, 250000.00)
  ON CONFLICT DO NOTHING;

  UPDATE public.student_invoices SET status = 'issued' WHERE id = v_inv_cdf;
  UPDATE public.student_invoices SET status = 'paid', paid_amount = 250000.00 WHERE id = v_inv_cdf;

  -- 7. Facture École B Classe B1
  INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by)
  VALUES (v_inv_b, v_school_b, v_year_b, v_student_b1, v_enroll_b1, v_class_b1, 'FAC-B-001', 1, CURRENT_DATE - 2, CURRENT_DATE + 30, 'USD', 150.00, 0.00, 'draft', v_admin_b);

  INSERT INTO public.student_invoice_items (id, invoice_id, school_id, academic_year_id, student_id, currency, fee_name, fee_type, unit_price, quantity, total_price)
  VALUES (gen_random_uuid(), v_inv_b, v_school_b, v_year_b, v_student_b1, 'USD', 'Minerval B', 'minerval', 150.00, 1, 150.00);

  UPDATE public.student_invoices SET status = 'issued' WHERE id = v_inv_b;
  UPDATE public.student_invoices SET status = 'paid', paid_amount = 150.00 WHERE id = v_inv_b;

  ------------------------------------------------------------------------------
  -- PAIEMENTS ET REÇUS DE TEST
  ------------------------------------------------------------------------------
  -- P1 : USD cash $100 (Confirmé)
  INSERT INTO public.student_payments (id, school_id, academic_year_id, invoice_id, student_id, currency, payment_number, sequence_number, amount, payment_method, payment_date, recorded_by, status)
  VALUES (v_pay_mono, v_school_a, v_year_a, v_inv_mono, v_student_a1, 'USD', 'PAY-2026-001', 1, 100.00, 'cash', CURRENT_DATE, v_agent_a, 'confirmed');

  INSERT INTO public.payment_receipts (school_id, academic_year_id, payment_id, invoice_id, student_id, currency, receipt_number, sequence_number, receipt_date, amount, payment_method, student_matricule, student_full_name, class_name, invoice_number, balance_after_payment, cashier_name, is_cancelled)
  VALUES (v_school_a, v_year_a, v_pay_mono, v_inv_mono, v_student_a1, 'USD', 'REC-2026-001', 1, CURRENT_DATE, 100.00, 'cash', 'MAT-2026-001', 'Dieudonné Mbala', '6ème Math-Physique', 'FAC-2026-001', 0.00, 'Kizito Ilunga', false);

  -- P2 : USD cash $10 (Confirmé) Classe A2
  INSERT INTO public.student_payments (id, school_id, academic_year_id, invoice_id, student_id, currency, payment_number, sequence_number, amount, payment_method, payment_date, recorded_by, status)
  VALUES (v_pay_multi_cat, v_school_a, v_year_a, v_inv_multi_cat, v_student_a2, 'USD', 'PAY-2026-002', 2, 10.00, 'cash', CURRENT_DATE, v_agent_a, 'confirmed');

  INSERT INTO public.payment_receipts (school_id, academic_year_id, payment_id, invoice_id, student_id, currency, receipt_number, sequence_number, receipt_date, amount, payment_method, student_matricule, student_full_name, class_name, invoice_number, balance_after_payment, cashier_name, is_cancelled)
  VALUES (v_school_a, v_year_a, v_pay_multi_cat, v_inv_multi_cat, v_student_a2, 'USD', 'REC-2026-002', 2, CURRENT_DATE, 10.00, 'cash', 'MAT-2026-002', 'Grace Kabeya', '5ème Biologie-Chimie', 'FAC-2026-002', 20.00, 'Kizito Ilunga', false);

  -- P3 : USD bank_transfer $30 (Annulé) Classe A2
  INSERT INTO public.student_payments (id, school_id, academic_year_id, invoice_id, student_id, currency, payment_number, sequence_number, amount, payment_method, payment_date, recorded_by, status, cancelled_at, cancelled_by, cancel_reason)
  VALUES (v_pay_multi_cancel, v_school_a, v_year_a, v_inv_multi_cat, v_student_a2, 'USD', 'PAY-2026-003', 3, 30.00, 'bank_transfer', CURRENT_DATE - 10, v_agent_a, 'cancelled', NOW(), v_admin_a, 'Annulation comptable chèque sans provision');

  INSERT INTO public.payment_receipts (school_id, academic_year_id, payment_id, invoice_id, student_id, currency, receipt_number, sequence_number, receipt_date, amount, payment_method, student_matricule, student_full_name, class_name, invoice_number, balance_after_payment, cashier_name, is_cancelled, cancelled_at, cancelled_by, cancel_reason)
  VALUES (v_school_a, v_year_a, v_pay_multi_cancel, v_inv_multi_cat, v_student_a2, 'USD', 'REC-2026-003', 3, CURRENT_DATE - 10, 30.00, 'bank_transfer', 'MAT-2026-002', 'Grace Kabeya', '5ème Biologie-Chimie', 'FAC-2026-002', 30.00, 'Kizito Ilunga', true, NOW(), v_admin_a, 'Annulation comptable chèque sans provision');

  -- P4 : USD cash $50 (Créé et annulé aujourd'hui)
  INSERT INTO public.student_payments (id, school_id, academic_year_id, invoice_id, student_id, currency, payment_number, sequence_number, amount, payment_method, payment_date, recorded_by, status, cancelled_at, cancelled_by, cancel_reason)
  VALUES (v_pay_same_day, v_school_a, v_year_a, v_inv_same_day, v_student_a1, 'USD', 'PAY-2026-004', 4, 50.00, 'cash', CURRENT_DATE, v_agent_a, 'cancelled', NOW(), v_admin_a, 'Erreur de caissier annulation immédiate');

  INSERT INTO public.payment_receipts (school_id, academic_year_id, payment_id, invoice_id, student_id, currency, receipt_number, sequence_number, receipt_date, amount, payment_method, student_matricule, student_full_name, class_name, invoice_number, balance_after_payment, cashier_name, is_cancelled, cancelled_at, cancelled_by, cancel_reason)
  VALUES (v_school_a, v_year_a, v_pay_same_day, v_inv_same_day, v_student_a1, 'USD', 'REC-2026-004', 4, CURRENT_DATE, 50.00, 'cash', 'MAT-2026-001', 'Dieudonné Mbala', '6ème Math-Physique', 'FAC-2026-003', 50.00, 'Kizito Ilunga', true, NOW(), v_admin_a, 'Erreur de caissier annulation immédiate');

  -- P5 : USD check $40 (Confirmé)
  INSERT INTO public.student_payments (id, school_id, academic_year_id, invoice_id, student_id, currency, payment_number, sequence_number, amount, payment_method, payment_date, recorded_by, status)
  VALUES (v_pay_mismatch, v_school_a, v_year_a, v_inv_mismatch, v_student_a1, 'USD', 'PAY-2026-005', 5, 40.00, 'check', CURRENT_DATE, v_agent_a, 'confirmed');

  INSERT INTO public.payment_receipts (school_id, academic_year_id, payment_id, invoice_id, student_id, currency, receipt_number, sequence_number, receipt_date, amount, payment_method, student_matricule, student_full_name, class_name, invoice_number, balance_after_payment, cashier_name, is_cancelled)
  VALUES (v_school_a, v_year_a, v_pay_mismatch, v_inv_mismatch, v_student_a1, 'USD', 'REC-2026-005', 5, CURRENT_DATE, 40.00, 'check', 'MAT-2026-001', 'Dieudonné Mbala', '6ème Math-Physique', 'FAC-2026-004', 60.00, 'Kizito Ilunga', false);

  -- P6 : USD mobile_money_manual $20 (Confirmé - SANS REÇU)
  INSERT INTO public.student_payments (id, school_id, academic_year_id, invoice_id, student_id, currency, payment_number, sequence_number, amount, payment_method, payment_date, recorded_by, status)
  VALUES (v_pay_empty, v_school_a, v_year_a, v_inv_empty, v_student_a1, 'USD', 'PAY-2026-006', 6, 20.00, 'mobile_money_manual', CURRENT_DATE, v_agent_a, 'confirmed');

  -- P7 : CDF cash 250,000 CDF (Confirmé)
  INSERT INTO public.student_payments (id, school_id, academic_year_id, invoice_id, student_id, currency, payment_number, sequence_number, amount, payment_method, payment_date, recorded_by, status)
  VALUES (v_pay_cdf, v_school_a, v_year_a, v_inv_cdf, v_student_a1, 'CDF', 'PAY-2026-007', 7, 250000.00, 'cash', CURRENT_DATE, v_agent_a, 'confirmed');

  INSERT INTO public.payment_receipts (school_id, academic_year_id, payment_id, invoice_id, student_id, currency, receipt_number, sequence_number, receipt_date, amount, payment_method, student_matricule, student_full_name, class_name, invoice_number, balance_after_payment, cashier_name, is_cancelled)
  VALUES (v_school_a, v_year_a, v_pay_cdf, v_inv_cdf, v_student_a1, 'CDF', 'REC-2026-007', 7, CURRENT_DATE, 250000.00, 'cash', 'MAT-2026-001', 'Dieudonné Mbala', '6ème Math-Physique', 'FAC-2026-006', 0.00, 'Kizito Ilunga', false);

  -- P8 : École B
  INSERT INTO public.student_payments (id, school_id, academic_year_id, invoice_id, student_id, currency, payment_number, sequence_number, amount, payment_method, payment_date, recorded_by, status)
  VALUES (v_pay_b, v_school_b, v_year_b, v_inv_b, v_student_b1, 'USD', 'PAY-B-001', 1, 150.00, 'cash', CURRENT_DATE, v_admin_b, 'confirmed');

  ------------------------------------------------------------------------------
  -- ASSERTIONS SUR EXÉCUTION RPC ET RECONCILIATION BY_CLASS
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_res := public.get_school_cash_register_journal(p_start_date => CURRENT_DATE - 1, p_end_date => CURRENT_DATE + 1);

  CREATE TEMP TABLE IF NOT EXISTS _test_results(id int, title text, status text, detail text);
  GRANT ALL ON _test_results TO PUBLIC;
  TRUNCATE TABLE _test_results;

  -- Assertion 1 : Exécution réussie par school_admin
  v_assertions_count := v_assertions_count + 1;
  IF (v_res->'pagination'->>'total_records')::int = 8 THEN
    INSERT INTO _test_results VALUES (1, 'Exécution RPC par school_admin', 'PASS', 'total_records = 8 exact');
  ELSE
    RAISE EXCEPTION 'Assertion 1 FAIL: total_records attendu 8, obtenu %', (v_res->'pagination'->>'total_records');
  END IF;

  -- Assertion 2 : Présence et réconciliation stricte de by_class USD
  v_assertions_count := v_assertions_count + 1;
  v_by_class_usd := v_res->'summary'->'USD'->'by_class';
  IF jsonb_array_length(v_by_class_usd) >= 2 THEN
    SELECT
      SUM((elem->>'gross_collected')::numeric),
      SUM((elem->>'cancellations_amount')::numeric),
      SUM((elem->>'net_event_amount')::numeric),
      SUM((elem->>'confirmed_current_total')::numeric)
    INTO v_class_gross_sum, v_class_cancelled_sum, v_class_net_sum, v_class_confirmed_sum
    FROM jsonb_array_elements(v_by_class_usd) elem;

    IF v_class_gross_sum = (v_res->'summary'->'USD'->>'gross_collected')::numeric AND
       v_class_cancelled_sum = (v_res->'summary'->'USD'->>'cancellations_amount')::numeric AND
       v_class_net_sum = (v_res->'summary'->'USD'->>'net_event_amount')::numeric THEN
      INSERT INTO _test_results VALUES (2, 'Réconciliation by_class USD', 'PASS', 'Somme par classe = résumé USD exact');
    ELSE
      RAISE EXCEPTION 'Assertion 2 FAIL: Discordance agrégats par classe vs résumé USD';
    END IF;
  ELSE
    RAISE EXCEPTION 'Assertion 2 FAIL: array by_class USD vide ou incomplet';
  END IF;

  ------------------------------------------------------------------------------
  -- ASSERTION 3 : DATES PAR DÉFAUT SELON LE FUSEAU HORAIRE DE L'ÉTABLISSEMENT
  ------------------------------------------------------------------------------
  v_assertions_count := v_assertions_count + 1;
  v_res_null_dates := public.get_school_cash_register_journal(p_start_date => NULL, p_end_date => NULL);

  IF (v_res_null_dates->'period'->>'school_timezone') = 'Africa/Kinshasa' AND
     (v_res_null_dates->'period'->>'start_date') = to_char((now() AT TIME ZONE 'Africa/Kinshasa')::DATE, 'YYYY-MM-DD') THEN
    INSERT INTO _test_results VALUES (3, 'Date locale Kinshasa par défaut', 'PASS', 'Africa/Kinshasa résolue dynamiquement');
  ELSE
    RAISE EXCEPTION 'Assertion 3 FAIL: Résolution date locale fuseau échouée';
  END IF;

  ------------------------------------------------------------------------------
  -- TESTS DES INACTIFS ET SÉCURITÉ (PROFIL INACTIF & ÉTABLISSEMENT INACTIF)
  ------------------------------------------------------------------------------
  -- Assertion 4 : Profil financier inactif (is_active = false) rejeté avec 42501
  v_assertions_count := v_assertions_count + 1;
  PERFORM set_config('request.jwt.claim.sub', v_inactive_agent::text, true);
  BEGIN
    PERFORM public.get_school_cash_register_journal();
    RAISE EXCEPTION 'Assertion 4 FAIL: Profil inactif non rejeté';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    INSERT INTO _test_results VALUES (4, 'Profil financier inactif', 'PASS', 'Erreur 42501 levée');
  END;

  -- Assertion 5 : Établissement inactif/suspendu rejeté avec 42501
  v_assertions_count := v_assertions_count + 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_suspended::text, true);
  BEGIN
    PERFORM public.get_school_cash_register_journal();
    RAISE EXCEPTION 'Assertion 5 FAIL: Établissement inactif non rejeté';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    INSERT INTO _test_results VALUES (5, 'Établissement suspendu', 'PASS', 'Erreur 42501 levée');
  END;

  PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);

  ------------------------------------------------------------------------------
  -- ASSERTION 6 : AUTORISATIONS ET AUTRES RÔLES
  ------------------------------------------------------------------------------
  -- finance_agent actif
  v_assertions_count := v_assertions_count + 1;
  PERFORM set_config('request.jwt.claim.sub', v_agent_a::text, true);
  v_res := public.get_school_cash_register_journal();
  IF (v_res->'pagination'->>'total_records')::int = 8 THEN
    INSERT INTO _test_results VALUES (6, 'finance_agent actif', 'PASS', 'Accès autorisé');
  ELSE
    RAISE EXCEPTION 'Assertion 6 FAIL: finance_agent échoué';
  END IF;

  -- teacher
  v_assertions_count := v_assertions_count + 1;
  PERFORM set_config('request.jwt.claim.sub', v_teacher_a::text, true);
  BEGIN PERFORM public.get_school_cash_register_journal(); RAISE EXCEPTION 'FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO _test_results VALUES (7, 'Rôle teacher rejeté', 'PASS', 'Erreur 42501 levée'); END;

  -- parent
  v_assertions_count := v_assertions_count + 1;
  PERFORM set_config('request.jwt.claim.sub', v_parent_a::text, true);
  BEGIN PERFORM public.get_school_cash_register_journal(); RAISE EXCEPTION 'FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO _test_results VALUES (8, 'Rôle parent rejeté', 'PASS', 'Erreur 42501 levée'); END;

  -- student
  v_assertions_count := v_assertions_count + 1;
  PERFORM set_config('request.jwt.claim.sub', v_student_a1::text, true);
  BEGIN PERFORM public.get_school_cash_register_journal(); RAISE EXCEPTION 'FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO _test_results VALUES (9, 'Rôle student rejeté', 'PASS', 'Erreur 42501 levée'); END;

  -- anon
  v_assertions_count := v_assertions_count + 1;
  PERFORM set_config('role', 'anon', true);
  BEGIN PERFORM public.get_school_cash_register_journal(); RAISE EXCEPTION 'FAIL'; EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO _test_results VALUES (10, 'Rôle anon rejeté', 'PASS', 'Erreur 42501 levée'); END;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_b::text, true);

  ------------------------------------------------------------------------------
  -- ASSERTION 7 : FUSEAU HORAIRE LUBUMBASHI (ÉCOLE B)
  ------------------------------------------------------------------------------
  v_assertions_count := v_assertions_count + 1;
  v_res_b := public.get_school_cash_register_journal(p_start_date => NULL, p_end_date => NULL);

  IF (v_res_b->'period'->>'school_timezone') = 'Africa/Lubumbashi' AND
     (v_res_b->'pagination'->>'total_records')::int = 1 THEN
    INSERT INTO _test_results VALUES (11, 'Date locale Lubumbashi (École B)', 'PASS', 'Africa/Lubumbashi et isolation RLS validées');
  ELSE
    RAISE EXCEPTION 'Assertion 11 FAIL: Échec test fuseau Lubumbashi';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);

  ------------------------------------------------------------------------------
  -- ASSERTION 8 : ZÉRO UUID DANS LE CONTRAT JSON FRONTEND
  ------------------------------------------------------------------------------
  v_assertions_count := v_assertions_count + 1;
  v_res := public.get_school_cash_register_journal(p_start_date => CURRENT_DATE - 1, p_end_date => CURRENT_DATE + 1);

  SELECT COUNT(*) INTO v_uuid_matches
  FROM regexp_matches(v_res::text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'gi');

  IF v_uuid_matches = 0 THEN
    INSERT INTO _test_results VALUES (12, 'Zéro UUID contrat JSON', 'PASS', 'Aucun UUID dans la réponse RPC');
  ELSE
    RAISE EXCEPTION 'Assertion 12 FAIL: % UUID détectés', v_uuid_matches;
  END IF;

  ------------------------------------------------------------------------------
  -- ASSERTION 14 : AUDIT SÉCURITÉ ET LECTURES RPC FILTER OPTIONS
  ------------------------------------------------------------------------------
  v_assertions_count := v_assertions_count + 1;

  -- 14a. school_admin École A
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);
  v_res := public.get_school_cash_register_filter_options();
  IF jsonb_array_length(v_res->'classes') >= 2 AND jsonb_array_length(v_res->'cashiers') >= 2 THEN
    -- Verify no email, phone, or unnecessary personal data in cashiers
    IF (v_res->'cashiers'->0 ? 'email') = false AND (v_res->'cashiers'->0 ? 'phone') = false THEN
      -- 14b. Rejet teacher (42501)
      PERFORM set_config('request.jwt.claim.sub', v_teacher_a::text, true);
      BEGIN
        PERFORM public.get_school_cash_register_filter_options();
        RAISE EXCEPTION 'Assertion 14 FAIL: teacher non rejeté';
      EXCEPTION WHEN SQLSTATE '42501' THEN
        -- 14c. Rejet inactif (42501)
        PERFORM set_config('request.jwt.claim.sub', v_inactive_agent::text, true);
        BEGIN
          PERFORM public.get_school_cash_register_filter_options();
          RAISE EXCEPTION 'Assertion 14 FAIL: inactif non rejeté';
        EXCEPTION WHEN SQLSTATE '42501' THEN
          -- 14d. Isolation École B
          PERFORM set_config('request.jwt.claim.sub', v_admin_b::text, true);
          v_res_b := public.get_school_cash_register_filter_options();
          IF jsonb_array_length(v_res_b->'classes') = 1 AND (v_res_b->'classes'->0->>'name') = '4ème Littéraire' THEN
            INSERT INTO _test_results VALUES (14, 'Audit RLS Filter Options', 'PASS', 'Sécurité 100% étanche (0 email/phone, isolation RLS, 42501 sur inactifs/rôles)');
          ELSE
            RAISE EXCEPTION 'Assertion 14 FAIL: Isolation École B échouée';
          END IF;
        END;
      END;
    ELSE
      RAISE EXCEPTION 'Assertion 14 FAIL: Données personnelles sensibles exposées dans cashiers';
    END IF;
  ELSE
    RAISE EXCEPTION 'Assertion 14 FAIL: Classes ou Caissiers incomplets pour École A';
  END IF;

  ------------------------------------------------------------------------------
  -- ASSERTION 15 : PERSISTENCE DE MUTATION NULLE
  ------------------------------------------------------------------------------
  v_assertions_count := v_assertions_count + 1;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT COUNT(*) INTO v_cnt_payments_after FROM public.student_payments WHERE school_id IN (v_school_a, v_school_b);

  IF v_cnt_payments_before + 8 = v_cnt_payments_after THEN
    INSERT INTO _test_results VALUES (15, 'Delta insertions temporaires', 'PASS', '+8 paiements temporaires insérés (0 mutation persistante)');
  ELSE
    RAISE EXCEPTION 'Assertion 15 FAIL: before=%, after=%', v_cnt_payments_before, v_cnt_payments_after;
  END IF;
END;
$$;

SELECT * FROM _test_results ORDER BY id;

ROLLBACK;
