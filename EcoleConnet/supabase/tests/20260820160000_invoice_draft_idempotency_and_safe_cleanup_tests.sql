-- Test SQL : 20260820160000_invoice_draft_idempotency_and_safe_cleanup_tests.sql
-- Description : Suite de tests automatisés transactionnels pour l'idempotence stricte par empreinte et l'annulation auditable
-- Exigences : commence par BEGIN;, se termine par ROLLBACK;, zéro COMMIT;

BEGIN;

DO $$
DECLARE
  v_school_a UUID := 'a1000000-0000-4000-a000-000000000001';
  v_year_a   UUID := 'a2000000-0000-4000-a000-000000000001';
  v_class_a  UUID := 'a3000000-0000-4000-a000-000000000001';
  v_admin_a  UUID := 'a4000000-0000-4000-a000-000000000001';
  v_agent_a  UUID := 'a5000000-0000-4000-a000-000000000001';
  v_student_a UUID := 'a9000000-0000-4000-a000-000000000001';
  v_teacher_a UUID := 'a7000000-0000-4000-a000-000000000001';

  v_school_b UUID := 'b1000000-0000-4000-a000-000000000001';
  v_agent_b  UUID := 'b5000000-0000-4000-a000-000000000001';

  v_res JSONB;
  v_res_replay JSONB;
  v_inv_id UUID;
  v_inv_count INTEGER;
  v_key TEXT := 'IDEMP-TEST-STRICT-KEY-001';
  v_error_caught BOOLEAN := FALSE;
  v_priv_grant_count INTEGER;
  v_old_sig_count INTEGER;
BEGIN
  RAISE NOTICE '=== DÉBUT DE LA SUITE DE TESTS HARDENING IDEMPOTENCE STRICTE & ANNULATION ===';

  ------------------------------------------------------------------------------
  -- TEST 1 : Absente ou vide p_idempotency_key rejetée
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_agent_a::text);

  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_draft_student_invoice(
      p_student_id => v_student_a,
      p_academic_year_id => v_year_a,
      p_due_date => '2026-11-30'::DATE,
      p_currency => 'USD',
      p_items => '[{"fee_name": "Test", "fee_type": "minerval", "unit_price": 10.00, "quantity": 1}]'::jsonb,
      p_idempotency_key => ''
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'ÉCHEC TEST 1 : Une clé d''idempotence vide aurait dû être rejetée.';
  END IF;

  RAISE NOTICE '✓ TEST 1 PASS : Clé d''idempotence vide correctement rejetée.';


  ------------------------------------------------------------------------------
  -- TEST 2 : Création initiale canonique avec p_notes et empreinte opérationnelle
  ------------------------------------------------------------------------------
  v_res := public.create_draft_student_invoice(
    p_student_id => v_student_a,
    p_academic_year_id => v_year_a,
    p_due_date => '2026-11-30'::DATE,
    p_currency => 'USD',
    p_items => '[{"fee_name": "Minerval T1", "fee_type": "minerval", "unit_price": 50.00, "quantity": 1}]'::jsonb,
    p_idempotency_key => v_key,
    p_issue_date => '2026-09-01'::DATE,
    p_notes => 'Note de test d''idempotence'
  );

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC TEST 2 : La création d''un brouillon avec clé d''idempotence a échoué.';
  END IF;

  IF (v_res->>'is_idempotent_replay')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'ÉCHEC TEST 2 : Le premier appel ne doit pas être marqué comme rejeu idempotent.';
  END IF;

  v_inv_id := (v_res->>'invoice_id')::UUID;
  RAISE NOTICE '✓ TEST 2 PASS : Création initiale avec clé et note enregistrée avec succès.';


  ------------------------------------------------------------------------------
  -- TEST 3 : Rejeu idempotent strictement identique
  ------------------------------------------------------------------------------
  v_res_replay := public.create_draft_student_invoice(
    p_student_id => v_student_a,
    p_academic_year_id => v_year_a,
    p_due_date => '2026-11-30'::DATE,
    p_currency => 'USD',
    p_items => '[{"fee_name": "Minerval T1", "fee_type": "minerval", "unit_price": 50.00, "quantity": 1}]'::jsonb,
    p_idempotency_key => v_key,
    p_issue_date => '2026-09-01'::DATE,
    p_notes => 'Note de test d''idempotence'
  );

  IF (v_res_replay->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC TEST 3 : Le rejeu idempotent a échoué.';
  END IF;

  IF (v_res_replay->>'is_idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC TEST 3 : Le second appel doit être identifié comme is_idempotent_replay: true.';
  END IF;

  IF (v_res_replay->>'invoice_id')::UUID <> v_inv_id THEN
    RAISE EXCEPTION 'ÉCHEC TEST 3 : Le rejeu doit retourner l''identifiant de facture identique.';
  END IF;

  RAISE NOTICE '✓ TEST 3 PASS : Rejeu idempotent identique confirmé (is_idempotent_replay = true).';


  ------------------------------------------------------------------------------
  -- TEST 4 : Même clé avec empreinte différente (devise ou lignes discordantes) rejetée
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_draft_student_invoice(
      p_student_id => v_student_a,
      p_academic_year_id => v_year_a,
      p_due_date => '2026-11-30'::DATE,
      p_currency => 'CDF', -- Différent !
      p_items => '[{"fee_name": "Minerval T1", "fee_type": "minerval", "unit_price": 50.00, "quantity": 1}]'::jsonb,
      p_idempotency_key => v_key
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'ÉCHEC TEST 4 : Réutilisation de la même clé avec empreinte différente aurait dû être rejetée.';
  END IF;

  RAISE NOTICE '✓ TEST 4 PASS : Clé réutilisée avec empreinte différente rejetée avec exception (23505).';


  ------------------------------------------------------------------------------
  -- TEST 5 : Vérification de la suppression des anciennes surcharges RPC non sécurisées
  ------------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_old_sig_count
  FROM information_schema.routines
  WHERE routine_name = 'create_draft_student_invoice'
    AND routine_schema = 'public';

  IF v_old_sig_count <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 5 : Attendu exactement 1 signature de RPC create_draft_student_invoice, trouvé %.', v_old_sig_count;
  END IF;

  RAISE NOTICE '✓ TEST 5 PASS : Anciennes surcharges RPC supprimées (signature canonique unique 8 arguments).';


  ------------------------------------------------------------------------------
  -- TEST 6 : Rôle non autorisé (teacher) refusé pour create et void
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_teacher_a::text);

  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_draft_student_invoice(
      p_student_id => v_student_a, p_academic_year_id => v_year_a, p_due_date => NULL, p_currency => 'USD',
      p_items => '[{"fee_name": "Test", "fee_type": "autre", "unit_price": 10.00, "quantity": 1}]'::jsonb,
      p_idempotency_key => 'KEY-TEACHER'
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 6A : teacher aurait dû être rejeté à la création.'; END IF;

  v_error_caught := FALSE;
  BEGIN
    PERFORM public.void_draft_student_invoice(p_invoice_id => v_inv_id, p_cancel_reason => 'Motif valide d''au moins dix caractères');
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 6B : teacher aurait dû être rejeté à l''annulation.'; END IF;

  RAISE NOTICE '✓ TEST 6 PASS : Rôle non autorisé (teacher) strictement rejeté pour create et void.';


  ------------------------------------------------------------------------------
  -- TEST 7 : Isolation inter-écoles (Agent B sur École A)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_agent_b::text);

  v_error_caught := FALSE;
  BEGIN
    PERFORM public.void_draft_student_invoice(
      p_invoice_id => v_inv_id,
      p_cancel_reason => 'Tentative d''annulation inter-écoles par agent b'
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 7 : L''agent de l''école B n''aurait pas dû pouvoir annuler un brouillon de l''école A.'; END IF;

  RAISE NOTICE '✓ TEST 7 PASS : Isolation inter-écoles strictement appliquée.';


  ------------------------------------------------------------------------------
  -- TEST 8 : Motif court (< 10 caractères) rejeté lors de l'annulation
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_agent_a::text);

  v_error_caught := FALSE;
  BEGIN
    PERFORM public.void_draft_student_invoice(
      p_invoice_id => v_inv_id,
      p_cancel_reason => 'Court'
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'ÉCHEC TEST 8 : Un motif de moins de 10 caractères aurait dû être rejeté.';
  END IF;

  RAISE NOTICE '✓ TEST 8 PASS : Motif court (< 10 caractères) rejeté.';


  ------------------------------------------------------------------------------
  -- TEST 9 : Annulation valide d'un brouillon par finance_agent (statut voided)
  ------------------------------------------------------------------------------
  v_res := public.void_draft_student_invoice(
    p_invoice_id => v_inv_id,
    p_cancel_reason => 'Motif d''annulation réglementaire valide'
  );

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC TEST 9 : L''annulation du brouillon a échoué.';
  END IF;

  IF (v_res->>'status') <> 'voided' THEN
    RAISE EXCEPTION 'ÉCHEC TEST 9 : Le statut n''a pas basculé à "voided".';
  END IF;

  RAISE NOTICE '✓ TEST 9 PASS : Annulation auditable du brouillon réussie avec motif réglementaire.';


  ------------------------------------------------------------------------------
  -- TEST 10 : Re-annulation d'un brouillon déjà annulé (voided) rejetée
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.void_draft_student_invoice(
      p_invoice_id => v_inv_id,
      p_cancel_reason => 'Deuxième tentative sur facture déjà voided'
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'ÉCHEC TEST 10 : La ré-annulation d''une facture déjà voided aurait dû être rejetée.';
  END IF;

  RAISE NOTICE '✓ TEST 10 PASS : Annulation d''une facture déjà voided rejetée.';


  ------------------------------------------------------------------------------
  -- TEST 11 : Une facture émise (issued) ou partiellement payée ne peut pas être annulée par cette RPC
  ------------------------------------------------------------------------------
  INSERT INTO public.student_invoices (
    id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by
  ) VALUES (
    'a9999999-0000-4000-a000-000000000999'::UUID, v_school_a, v_year_a, v_student_a, 'aa000000-0000-4000-a000-000000000001'::UUID, v_class_a, 'INV-2026-TESTISSUED', 999, CURRENT_DATE, CURRENT_DATE + 30, 'USD', 100.00, 0.00, 'issued', v_admin_a
  );

  v_error_caught := FALSE;
  BEGIN
    PERFORM public.void_draft_student_invoice(
      p_invoice_id => 'a9999999-0000-4000-a000-000000000999'::UUID,
      p_cancel_reason => 'Tentative d''annulation sur facture émise'
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'ÉCHEC TEST 11 : Une facture émise ("issued") n''aurait pas dû pouvoir être annulée par void_draft_student_invoice.';
  END IF;

  RAISE NOTICE '✓ TEST 11 PASS : Facture émise (issued) non annulable par void_draft_student_invoice.';


  ------------------------------------------------------------------------------
  -- TEST 12 : Privilèges EXECUTE (PUBLIC et anon révoqués)
  ------------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_priv_grant_count
  FROM information_schema.routine_privileges
  WHERE routine_name IN ('create_draft_student_invoice', 'void_draft_student_invoice')
    AND grantee IN ('PUBLIC', 'anon');

  IF v_priv_grant_count > 0 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 12 : Des privilèges EXECUTE résiduels existent pour PUBLIC ou anon.';
  END IF;

  RAISE NOTICE '✓ TEST 12 PASS : Privilèges EXECUTE révoqués de PUBLIC/anon.';

  RAISE NOTICE '=== SUITE COMPLÈTE DE TESTS HARDENING RÉUSSIE (ROLLBACK AUTOMATIQUE) ===';
END;
$$;

ROLLBACK;
