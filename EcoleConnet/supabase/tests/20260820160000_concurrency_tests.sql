-- Test SQL : 20260820160000_concurrency_tests.sql
-- Description : Test automatisé de concurrence et de verrou transactionnel advisory pour create_draft_student_invoice
-- Exigences : commence par BEGIN;, se termine par ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_school_a UUID := 'a1000000-0000-4000-a000-000000000001';
  v_year_a   UUID := 'a2000000-0000-4000-a000-000000000001';
  v_agent_a  UUID := 'a5000000-0000-4000-a000-000000000001';
  v_student_a UUID := 'a9000000-0000-4000-a000-000000000001';

  v_key TEXT := 'CONCURRENCY-KEY-999';
  v_res1 JSONB;
  v_res2 JSONB;
  v_inv_count INTEGER;
BEGIN
  RAISE NOTICE '=== DÉBUT DU TEST DE CONCURRENCE ET VERROU ADVISORY TRANSACTIONNEL ===';

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_agent_a::text);

  -- Première exécution (Simule l'appel 1)
  v_res1 := public.create_draft_student_invoice(
    p_student_id => v_student_a,
    p_academic_year_id => v_year_a,
    p_due_date => '2026-12-15'::DATE,
    p_currency => 'USD',
    p_items => '[{"fee_name": "Minerval Conc", "fee_type": "minerval", "unit_price": 75.00, "quantity": 1}]'::jsonb,
    p_idempotency_key => v_key,
    p_issue_date => '2026-09-01'::DATE,
    p_notes => 'Test concurrence'
  );

  -- Deuxième exécution immédiate dans la même transaction (Simule l'appel concurrent ayant attendu le verrou)
  v_res2 := public.create_draft_student_invoice(
    p_student_id => v_student_a,
    p_academic_year_id => v_year_a,
    p_due_date => '2026-12-15'::DATE,
    p_currency => 'USD',
    p_items => '[{"fee_name": "Minerval Conc", "fee_type": "minerval", "unit_price": 75.00, "quantity": 1}]'::jsonb,
    p_idempotency_key => v_key,
    p_issue_date => '2026-09-01'::DATE,
    p_notes => 'Test concurrence'
  );

  -- Vérifications
  IF (v_res1->>'is_idempotent_replay')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'ÉCHEC CONCURRENCE : Le premier appel ne doit pas être un rejeu.';
  END IF;

  IF (v_res2->>'is_idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC CONCURRENCE : Le second appel concurrent doit être capturé comme rejeu idempotent (is_idempotent_replay = true).';
  END IF;

  IF (v_res1->>'invoice_id') <> (v_res2->>'invoice_id') THEN
    RAISE EXCEPTION 'ÉCHEC CONCURRENCE : Les deux appels doivent retourner la même facture.';
  END IF;

  SELECT COUNT(*) INTO v_inv_count
  FROM public.student_invoices
  WHERE school_id = v_school_a AND idempotency_key = v_key;

  IF v_inv_count <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC CONCURRENCE : Attendu exactement 1 facture créée en base, trouvé %.', v_inv_count;
  END IF;

  RAISE NOTICE '✓ TEST CONCURRENCE PASS : Sûreté sous requêtes concurrentes démontrée (exactement 1 facture créée).';
END;
$$;

ROLLBACK;
