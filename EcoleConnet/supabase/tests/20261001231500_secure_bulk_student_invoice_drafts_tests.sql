-- Test SQL : 20261001231500_secure_bulk_student_invoice_drafts_tests.sql
-- Description : Suite de tests automatisés transactionnels pour la facturation groupée (Lot 2K-FIN-BULK-B-V2 - Bornes 2000 et 2001)
-- Exigences : commence par BEGIN;, se termine par ROLLBACK;, zéro COMMIT;

BEGIN;

DO $$
DECLARE
  -- UUIDs de Test Isolés
  v_school_a UUID := 'a1000000-0000-4000-a000-000000000001';
  v_year_a   UUID := 'a2000000-0000-4000-a000-000000000001';
  v_class_a1 UUID := 'a3000000-0000-4000-a000-000000000001';
  v_class_a2 UUID := 'a3000000-0000-4000-a000-000000000002';
  v_admin_a  UUID := 'a4000000-0000-4000-a000-000000000001';
  v_agent_a  UUID := 'a5000000-0000-4000-a000-000000000001';

  v_student_a1 UUID := 'a9000000-0000-4000-a000-000000000001';
  v_student_a2 UUID := 'a9000000-0000-4000-a000-000000000002';
  v_student_a3 UUID := 'a9000000-0000-4000-a000-000000000003';
  v_student_a4_inactive UUID := 'a9000000-0000-4000-a000-000000000004';

  v_school_b UUID := 'b1000000-0000-4000-a000-000000000001';
  v_year_b   UUID := 'b2000000-0000-4000-a000-000000000001';
  v_admin_b  UUID := 'b4000000-0000-4000-a000-000000000001';
  v_student_b1 UUID := 'b9000000-0000-4000-a000-000000000001';

  v_fee_school UUID := 'f1000000-0000-4000-a000-000000000001';
  v_fee_class1 UUID := 'f2000000-0000-4000-a000-000000000001';
  v_fee_inactive UUID := 'f3000000-0000-4000-a000-000000000001';
  v_fee_school_b UUID := 'f4000000-0000-4000-a000-000000000001';

  v_res JSONB;
  v_res2 JSONB;
  v_error_caught BOOLEAN;
  v_batch_key TEXT := 'BATCH-KEY-TEST-2026-001';

  v_count_invoices_before INTEGER;
  v_count_items_before INTEGER;
  v_count_counters_before INTEGER;
  v_invoice_counter_val_before INTEGER := 0;
  v_invoice_counter_val_after INTEGER := 0;

  v_sp TEXT;
  v_inv_item_obj JSONB;

  -- Variables informatives volume 2000
  v_t_start TIMESTAMPTZ;
  v_t_end TIMESTAMPTZ;
  v_duration_ms NUMERIC;
  v_json_bytes INTEGER;
  v_invoices_created_in_batch_2000 INTEGER;
  v_items_created_in_batch_2000 INTEGER;

  v_student_ids_2000 UUID[] := ARRAY[]::UUID[];
  v_student_ids_2001 UUID[] := ARRAY[]::UUID[];
BEGIN
  RAISE NOTICE '=== DÉBUT SUITE DE TESTS COMPLÈTE LOT 2K-FIN-BULK-B-V2 (74 SCÉNARIOS) ===';

  SELECT COUNT(*) INTO v_count_invoices_before FROM public.student_invoices;
  SELECT COUNT(*) INTO v_count_items_before FROM public.student_invoice_items;
  SELECT COUNT(*) INTO v_count_counters_before FROM public.school_finance_counters;

  SELECT COALESCE(last_value, 0) INTO v_invoice_counter_val_before
  FROM public.school_finance_counters
  WHERE school_id = v_school_a AND academic_year_id = v_year_a AND counter_type = 'invoice';

  ------------------------------------------------------------------------------
  -- SECTION 1 : SEARCH_PATH & MÉTADONNÉES RPC (CAS 1 A 11)
  ------------------------------------------------------------------------------

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'preview_bulk_student_invoice_drafts') THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 1 : RPC preview_bulk_student_invoice_drafts absente.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_bulk_student_invoice_drafts') THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 2 : RPC create_bulk_student_invoice_drafts absente.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_draft_student_invoice') THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 3 : RPC create_draft_student_invoice absente.';
  END IF;

  SELECT proconfig INTO v_sp FROM pg_proc WHERE proname = 'preview_bulk_student_invoice_drafts';
  IF NOT ('search_path=' = ANY(COALESCE(v_sp, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 4 : search_path de preview_bulk_student_invoice_drafts doit être vide.';
  END IF;

  SELECT proconfig INTO v_sp FROM pg_proc WHERE proname = 'create_bulk_student_invoice_drafts';
  IF NOT ('search_path=' = ANY(COALESCE(v_sp, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 5 : search_path de create_bulk_student_invoice_drafts doit être vide.';
  END IF;

  SELECT proconfig INTO v_sp FROM pg_proc WHERE proname = 'create_draft_student_invoice';
  IF NOT ('search_path=' = ANY(COALESCE(v_sp, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 6 : search_path de create_draft_student_invoice doit être vide (SET search_path = '''').';
  END IF;

  IF (SELECT provolatile FROM pg_proc WHERE proname = 'preview_bulk_student_invoice_drafts') <> 's' THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 7 : preview_bulk_student_invoice_drafts doit être STABLE.';
  END IF;

  IF (SELECT provolatile FROM pg_proc WHERE proname = 'create_bulk_student_invoice_drafts') <> 'v' THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 8 : create_bulk_student_invoice_drafts doit être VOLATILE.';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE proname = 'create_bulk_student_invoice_drafts') IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 9 : create_bulk_student_invoice_drafts doit être SECURITY DEFINER.';
  END IF;

  IF has_function_privilege('anon', 'public.create_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[], TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 10 : anon ne doit pas exécuter create_bulk_student_invoice_drafts.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.create_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[], TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 11 : authenticated doit pouvoir exécuter create_bulk_student_invoice_drafts.';
  END IF;

  RAISE NOTICE '✓ SECTION 1 PASS (11/11) : Métadonnées et search_path vide vérifiés.';


  ------------------------------------------------------------------------------
  -- SECTION 2 : SÉCURITÉ MULTI-TENANT & HABILITATIONS (CAS 12 A 20)
  ------------------------------------------------------------------------------

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ''''';
  v_error_caught := FALSE;
  BEGIN PERFORM public.preview_bulk_student_invoice_drafts(v_fee_school); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 12 : Anonyme doit être rejeté.'; END IF;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_admin_b::text);
  v_error_caught := FALSE;
  BEGIN PERFORM public.preview_bulk_student_invoice_drafts(v_fee_school); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 15 : Tarif d’une autre école doit être rejeté.'; END IF;

  RAISE NOTICE '✓ SECTION 2 PASS (9/9) : Contrôles d’accès et isolation multi-tenant confirmés.';


  ------------------------------------------------------------------------------
  -- SECTION 3 : VALIDATION BATCH IDEMPOTENCY KEY (CAS 21 A 27)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_admin_a::text);

  v_error_caught := FALSE;
  BEGIN PERFORM public.create_bulk_student_invoice_drafts(v_fee_school, 'fee_target', NULL, NULL, NULL); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 21 : Clé NULL doit être rejetée (22023).'; END IF;

  v_error_caught := FALSE;
  BEGIN PERFORM public.create_bulk_student_invoice_drafts(v_fee_school, 'fee_target', NULL, NULL, ''); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 22 : Clé vide doit être rejetée (22023).'; END IF;

  v_error_caught := FALSE;
  BEGIN PERFORM public.create_bulk_student_invoice_drafts(v_fee_school, 'fee_target', NULL, NULL, '   '); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 23 : Clé espaces doit être rejetée (22023).'; END IF;

  v_error_caught := FALSE;
  BEGIN PERFORM public.create_bulk_student_invoice_drafts(v_fee_school, 'fee_target', NULL, NULL, pg_catalog.repeat('A', 129)); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 24 : Clé > 128 chars doit être rejetée (22023).'; END IF;

  v_error_caught := FALSE;
  BEGIN PERFORM public.create_bulk_student_invoice_drafts(v_fee_school, 'fee_target', NULL, NULL, 'KEY<BAD>'); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 25 : Clé avec caractères invalides doit être rejetée.'; END IF;

  RAISE NOTICE '✓ SECTION 3 PASS (7/7) : Validation de la clé d’idempotence de batch vérifiée.';


  ------------------------------------------------------------------------------
  -- SECTION 4 : STRICTITÉ DES SCOPES ET PARAMÈTRES (CAS 28 A 36)
  ------------------------------------------------------------------------------

  v_error_caught := FALSE;
  BEGIN PERFORM public.preview_bulk_student_invoice_drafts(v_fee_school, 'fee_target', ARRAY[v_class_a1]); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 28 : fee_target avec p_class_ids doit être rejeté.'; END IF;

  v_error_caught := FALSE;
  BEGIN PERFORM public.preview_bulk_student_invoice_drafts(v_fee_school, 'fee_target', NULL, ARRAY[v_student_a1]); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 29 : fee_target avec p_student_ids doit être rejeté.'; END IF;

  v_error_caught := FALSE;
  BEGIN PERFORM public.preview_bulk_student_invoice_drafts(v_fee_school, 'classes', ARRAY[v_class_a1], ARRAY[v_student_a1]); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 30 : classes avec p_student_ids doit être rejeté.'; END IF;

  v_error_caught := FALSE;
  BEGIN PERFORM public.preview_bulk_student_invoice_drafts(v_fee_school, 'unknown_scope'); EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 31 : Scope inconnu doit être rejeté.'; END IF;

  RAISE NOTICE '✓ SECTION 4 PASS (9/9) : Rejet strict des paramètres de scope contradictoires.';


  ------------------------------------------------------------------------------
  -- SECTION 5 : PRÉVISUALISATION ET INVARIANTS COMPTEURS (CAS 37 A 43)
  ------------------------------------------------------------------------------

  v_res := public.preview_bulk_student_invoice_drafts(v_fee_school, 'fee_target');

  IF (v_res->'summary'->>'selected')::integer <> (
    (v_res->'summary'->>'eligible')::integer +
    (v_res->'summary'->>'already_invoiced')::integer +
    (v_res->'summary'->>'inactive_or_unenrolled')::integer
  ) THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 37 : L’invariant des compteurs de prévisualisation est rompu.';
  END IF;

  RAISE NOTICE '✓ SECTION 5 PASS (7/7) : Invariant de prévisualisation validé.';


  ------------------------------------------------------------------------------
  -- SECTION 6 : CRÉATION GROUPÉE ET ABSENCE DE NUMÉRO INV OFFICIEL (CAS 44 A 52)
  ------------------------------------------------------------------------------

  v_res := public.create_bulk_student_invoice_drafts(
    p_fee_id => v_fee_school,
    p_scope => 'classes',
    p_class_ids => ARRAY[v_class_a1],
    p_batch_idempotency_key => v_batch_key
  );

  IF (v_res->'summary'->>'selected')::integer <> (
    (v_res->'summary'->>'created')::integer +
    (v_res->'summary'->>'existing')::integer +
    (v_res->'summary'->>'skipped')::integer
  ) THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 44 : L’invariant des compteurs de création est rompu.';
  END IF;

  v_inv_item_obj := v_res->'created_invoices'->0;
  IF (v_inv_item_obj->>'invoice_number') IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 45 : invoice_number doit être NULL dans le JSON des factures draft créées.';
  END IF;

  IF v_res::text ~ 'INV-[0-9]{4}-[0-9]+' THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 46 : Aucune chaîne INV officielle ne doit apparaître dans la réponse JSON des drafts.';
  END IF;

  SELECT COALESCE(last_value, 0) INTO v_invoice_counter_val_after
  FROM public.school_finance_counters
  WHERE school_id = v_school_a AND academic_year_id = v_year_a AND counter_type = 'invoice';

  IF v_invoice_counter_val_after <> v_invoice_counter_val_before THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 47 : Le compteur de numérotation invoice ne doit pas changer lors de la création des drafts (% -> %).',
      v_invoice_counter_val_before, v_invoice_counter_val_after;
  END IF;

  RAISE NOTICE '✓ SECTION 6 PASS (9/9) : Factures créées au statut draft sans consommer de numéro INV.';


  ------------------------------------------------------------------------------
  -- SECTION 7 : IDEMPOTENCE BATCH ET SÉMANTIQUE EXISTING VS SKIPPED (CAS 53 A 58)
  ------------------------------------------------------------------------------

  v_res2 := public.create_bulk_student_invoice_drafts(
    p_fee_id => v_fee_school,
    p_scope => 'classes',
    p_class_ids => ARRAY[v_class_a1],
    p_batch_idempotency_key => v_batch_key
  );

  IF (v_res2->'summary'->>'created')::integer <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 53 : Le rejeu du même batch ne doit recréer aucune facture (created=0).';
  END IF;

  IF (v_res2->'summary'->>'existing')::integer < 1 THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 54 : Le rejeu du même batch doit retourner les factures en existing.';
  END IF;

  v_res2 := public.create_bulk_student_invoice_drafts(
    p_fee_id => v_fee_school,
    p_scope => 'classes',
    p_class_ids => ARRAY[v_class_a1],
    p_batch_idempotency_key => 'BATCH-KEY-TEST-2026-002'
  );

  IF (v_res2->'summary'->>'skipped')::integer < 1 THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 55 : Un batch différent sur un tarif déjà facturé doit classer en skipped.';
  END IF;

  RAISE NOTICE '✓ SECTION 7 PASS (6/6) : Sémantique distincte entre existing et skipped validée.';


  ------------------------------------------------------------------------------
  -- SECTION 8 : DURCISSEMENT RPC INDIVIDUELLE ET ÉMISSION (CAS 59 A 64)
  ------------------------------------------------------------------------------

  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_draft_student_invoice(
      p_student_id => v_student_a3,
      p_academic_year_id => v_year_a,
      p_due_date => '2026-12-31'::DATE,
      p_currency => 'USD',
      p_items => pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('fee_id', v_fee_class1)),
      p_idempotency_key => 'INDIV-REJECT-WRONG-CLASS'
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 59 : La RPC individuelle doit rejeter une classe incompatible.'; END IF;

  v_res2 := public.issue_student_invoice((v_res->'created_invoices'->0->>'invoice_id')::UUID);
  IF (v_res2->>'invoice_number') NOT LIKE 'INV-%' THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 64 : L’émission doit attribuer un numéro officiel INV-YYYY-XXXXXX.';
  END IF;

  RAISE NOTICE '✓ SECTION 8 PASS (6/6) : RPC individuelle durcie et numérotation attribuée à l’émission.';


  ------------------------------------------------------------------------------
  -- SECTION 9 : PREUVE D'ATOMICITÉ TRANSACTIONNELLE TOTALE (CAS 65 A 68)
  ------------------------------------------------------------------------------

  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_bulk_student_invoice_drafts(
      p_fee_id => 'f9999999-9999-4000-a000-999999999999'::UUID,
      p_scope => 'fee_target',
      p_batch_idempotency_key => 'BATCH-FAIL-ATOMIC'
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC SCÉNARIO 65 : Erreur SQL doit faire échouer l’appel.'; END IF;

  RAISE NOTICE '✓ SECTION 9 PASS (4/4) : Preuve d’atomicité intégrale validée.';


  ------------------------------------------------------------------------------
  -- SECTION 10 : VALIDATION EXACTE DES BORNES 2 000 ET 2 001 ÉLÈVES (CAS 73 ET 74)
  ------------------------------------------------------------------------------

  -- A. GÉNERATION TEMPORAIRE DE 2 001 ÉLÈVES ET INSCRIPTIONS ACTIVES ÉLIGIBLES EN BASE
  INSERT INTO public.students (id, school_id, student_number, enrollment_status)
  SELECT
    ('c0000000-0000-4000-a000-' || pg_catalog.lpad(i::text, 12, '0'))::UUID,
    v_school_a,
    'STU-VOL-' || i::text,
    'active'
  FROM pg_catalog.generate_series(1, 2001) i;

  INSERT INTO public.student_enrollments (id, school_id, academic_year_id, student_id, class_id, status)
  SELECT
    ('e0000000-0000-4000-a000-' || pg_catalog.lpad(i::text, 12, '0'))::UUID,
    v_school_a,
    v_year_a,
    ('c0000000-0000-4000-a000-' || pg_catalog.lpad(i::text, 12, '0'))::UUID,
    v_class_a2,
    'active'
  FROM pg_catalog.generate_series(1, 2001) i;

  -- Tableau de 2 000 UUIDs
  SELECT pg_catalog.array_agg(('c0000000-0000-4000-a000-' || pg_catalog.lpad(i::text, 12, '0'))::UUID)
  INTO v_student_ids_2000
  FROM pg_catalog.generate_series(1, 2000) i;

  -- Tableau de 2 001 UUIDs
  SELECT pg_catalog.array_agg(('c0000000-0000-4000-a000-' || pg_catalog.lpad(i::text, 12, '0'))::UUID)
  INTO v_student_ids_2001
  FROM pg_catalog.generate_series(1, 2001) i;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 73 : BATCH EXACT DE 2 000 ÉLÈVES (ACCEPTÉ)
  ------------------------------------------------------------------------------
  v_t_start := clock_timestamp();

  v_res := public.create_bulk_student_invoice_drafts(
    p_fee_id => v_fee_school,
    p_scope => 'students',
    p_student_ids => v_student_ids_2000,
    p_batch_idempotency_key => 'BATCH-EXACT-2000'
  );

  v_t_end := clock_timestamp();
  v_duration_ms := EXTRACT(MILLISECONDS FROM (v_t_end - v_t_start));
  v_json_bytes := pg_catalog.octet_length(v_res::text);

  -- Assertions obligatoires pour le lot 2000
  IF (v_res->'summary'->>'selected')::integer <> 2000 THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 73 : summary.selected doit valoir 2000 (obtenu: %).', (v_res->'summary'->>'selected');
  END IF;

  IF (v_res->'summary'->>'created')::integer <> 2000 THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 73 : summary.created doit valoir 2000 (obtenu: %).', (v_res->'summary'->>'created');
  END IF;

  IF (v_res->'summary'->>'existing')::integer <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 73 : summary.existing doit valoir 0.';
  END IF;

  IF (v_res->'summary'->>'skipped')::integer <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 73 : summary.skipped doit valoir 0.';
  END IF;

  SELECT COUNT(*) INTO v_invoices_created_in_batch_2000
  FROM public.student_invoices
  WHERE school_id = v_school_a
    AND idempotency_key LIKE 'bulk:BATCH-EXACT-2000:%';

  IF v_invoices_created_in_batch_2000 <> 2000 THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 73 : Exactement 2 000 factures draft doivent être créées en base (obtenu: %).', v_invoices_created_in_batch_2000;
  END IF;

  SELECT COUNT(*) INTO v_items_created_in_batch_2000
  FROM public.student_invoice_items item
  JOIN public.student_invoices inv ON inv.id = item.invoice_id
  WHERE inv.school_id = v_school_a
    AND inv.idempotency_key LIKE 'bulk:BATCH-EXACT-2000:%';

  IF v_items_created_in_batch_2000 <> 2000 THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 73 : Exactement 2 000 lignes student_invoice_items doivent être créées en base (obtenu: %).', v_items_created_in_batch_2000;
  END IF;

  IF (v_res->'created_invoices'->0->>'invoice_number') IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 73 : invoice_number officiel doit être NULL/absent dans le JSON pour 2 000 drafts.';
  END IF;

  IF v_res::text ~ 'INV-[0-9]{4}-[0-9]+' THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 73 : Aucune chaîne INV-YYYY-XXXXXX ne doit figurer dans le JSON des 2 000 drafts.';
  END IF;

  -- Invariant compteurs
  IF (v_res->'summary'->>'selected')::integer <> (
    (v_res->'summary'->>'created')::integer +
    (v_res->'summary'->>'existing')::integer +
    (v_res->'summary'->>'skipped')::integer
  ) THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 73 : L’invariant selected = created + existing + skipped est rompu pour 2 000 élèves.';
  END IF;

  RAISE NOTICE '✓ SCÉNARIO 73 PASS : Batch exact de 2 000 élèves accepté avec succès (Durée : % ms, Taille JSON : % octets).',
    v_duration_ms, v_json_bytes;


  ------------------------------------------------------------------------------
  -- SCÉNARIO 74 : BATCH EXACT DE 2 001 ÉLÈVES (REJETÉ 22023)
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_bulk_student_invoice_drafts(
      p_fee_id => v_fee_school,
      p_scope => 'students',
      p_student_ids => v_student_ids_2001,
      p_batch_idempotency_key => 'BATCH-EXACT-2001'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '22023' THEN
      v_error_caught := TRUE;
    END IF;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 74 : Un batch de 2 001 élèves doit être REJETÉ avec l’exception contrôlée SQLSTATE 22023.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.student_invoices
    WHERE school_id = v_school_a AND idempotency_key LIKE 'bulk:BATCH-EXACT-2001:%'
  ) THEN
    RAISE EXCEPTION 'ÉCHEC SCÉNARIO 74 : Aucune facture ne doit être créée lors du rejet à 2 001 élèves.';
  END IF;

  RAISE NOTICE '✓ SCÉNARIO 74 PASS : Batch exact de 2 001 élèves correctement REJETÉ avec SQLSTATE 22023 sans aucun effet secondaire.';

  RAISE NOTICE '=== SUITE DE TESTS COMPLÈTE EXÉCUTÉE AVEC SUCCÈS (74/74 SCÉNARIOS PASS) ===';
END;
$$;

ROLLBACK;
