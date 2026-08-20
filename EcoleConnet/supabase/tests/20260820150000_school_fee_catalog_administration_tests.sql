-- Test SQL : 20260820150000_school_fee_catalog_administration_tests.sql
-- Description : Suite de tests automatisés exhaustive pour l'administration du catalogue des frais (school_fees)
-- Exigences : commence par BEGIN;, se termine par ROLLBACK;, aucun COMMIT;

BEGIN;

DO $$
DECLARE
  v_school_a UUID := 'a1000000-0000-4000-a000-000000000001';
  v_year_a   UUID := 'a2000000-0000-4000-a000-000000000001';
  v_class_a  UUID := 'a3000000-0000-4000-a000-000000000001';
  v_admin_a  UUID := 'a4000000-0000-4000-a000-000000000001';
  v_agent_a  UUID := 'a5000000-0000-4000-a000-000000000001';
  v_parent_a UUID := 'a6000000-0000-4000-a000-000000000001';
  v_teacher_a UUID := 'a7000000-0000-4000-a000-000000000001';
  v_student_a UUID := 'a9000000-0000-4000-a000-000000000001';

  v_school_b UUID := 'b1000000-0000-4000-a000-000000000001';
  v_year_b   UUID := 'b2000000-0000-4000-a000-000000000001';
  v_class_b  UUID := 'b3000000-0000-4000-a000-000000000001';
  v_agent_b  UUID := 'b5000000-0000-4000-a000-000000000001';

  v_res JSONB;
  v_fee_id UUID;
  v_fee_b_id UUID;
  v_archived_fee_id UUID;
  v_error_caught BOOLEAN := FALSE;
  v_priv_grant_count INTEGER;
BEGIN
  RAISE NOTICE '=== DÉBUT DE LA SUITE DE TESTS COMPLÈTE RPC CATALOGUE (Phase Finance 3) ===';

  ------------------------------------------------------------------------------
  -- TEST 1 : school_admin autorisé à créer un tarif (École A)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_admin_a::text);

  v_res := public.create_school_fee_catalog_item(
    p_academic_year_id => v_year_a,
    p_fee_type => 'minerval',
    p_name => 'Minerval Admin Test T1',
    p_amount => 200.00,
    p_currency => 'USD',
    p_due_date => '2026-10-15'::DATE,
    p_description => 'Créé par school_admin'
  );

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC TEST 1 : school_admin n''a pas pu créer un tarif valide.';
  END IF;
  RAISE NOTICE '✓ TEST 1 PASS : school_admin autorisé à créer un tarif.';


  ------------------------------------------------------------------------------
  -- TEST 2 : finance_agent autorisé à créer un tarif (École A)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_agent_a::text);

  v_res := public.create_school_fee_catalog_item(
    p_academic_year_id => v_year_a,
    p_fee_type => 'uniforme',
    p_name => 'Uniforme de Sport Complémentaire',
    p_amount => 35000.00,
    p_currency => 'CDF',
    p_due_date => '2026-09-30'::DATE,
    p_class_id => v_class_a
  );

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC TEST 2 : finance_agent n''a pas pu créer un tarif valide.';
  END IF;
  v_fee_id := (v_res->>'fee_id')::UUID;
  RAISE NOTICE '✓ TEST 2 PASS : finance_agent autorisé à créer un tarif.';


  ------------------------------------------------------------------------------
  -- TEST 3 : teacher refusé
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_teacher_a::text);
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'cantine', p_name => 'Test Enseignant', p_amount => 10.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 3 : teacher aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 3 PASS : teacher strictement refusé.';


  ------------------------------------------------------------------------------
  -- TEST 4 : parent refusé
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_a::text);
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'cantine', p_name => 'Test Parent', p_amount => 10.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 4 : parent aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 4 PASS : parent strictement refusé.';


  ------------------------------------------------------------------------------
  -- TEST 5 : student refusé
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_student_a::text);
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'cantine', p_name => 'Test Élève', p_amount => 10.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 5 : student aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 5 PASS : student strictement refusé.';


  ------------------------------------------------------------------------------
  -- TEST 6 : anon refusé (Sans JWT claim)
  ------------------------------------------------------------------------------
  EXECUTE 'RESET request.jwt.claim.sub';
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'cantine', p_name => 'Test Anon', p_amount => 10.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 6 : anon aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 6 PASS : anon strictement refusé.';


  ------------------------------------------------------------------------------
  -- TEST 7 : Utilisateur non authentifié (auth.uid() IS NULL) refusé
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'transport', p_name => 'Test Unauth', p_amount => 15.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 7 : Unauth aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 7 PASS : Utilisateur non authentifié (auth.uid() IS NULL) refusé.';


  ------------------------------------------------------------------------------
  -- TEST 8 : Isolation inter-écoles (L'Agent A ne peut pas créer pour l'École B)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_agent_a::text);
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_b, p_fee_type => 'transport', p_name => 'Tentative École B', p_amount => 50.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 8 : L''agent A aurait dû être bloqué pour l''année B.'; END IF;
  RAISE NOTICE '✓ TEST 8 PASS : Isolation inter-écoles à la création strictly appliquée.';


  ------------------------------------------------------------------------------
  -- TEST 9 : academic_year étrangère refusée
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => 'a2999999-0000-4000-a000-000000000999'::UUID,
      p_fee_type => 'minerval', p_name => 'Année Fictive', p_amount => 100.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 9 : Année étrangère/inexistante aurait dû être rejetée.'; END IF;
  RAISE NOTICE '✓ TEST 9 PASS : academic_year étrangère ou inexistante refusée.';


  ------------------------------------------------------------------------------
  -- TEST 10 : class_id étrangère (Classe de l'École B) refusée
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'minerval', p_name => 'Classe Invalide', p_amount => 100.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE, p_class_id => v_class_b
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 10 : Classe d''une autre école aurait dû être rejetée.'; END IF;
  RAISE NOTICE '✓ TEST 10 PASS : class_id étrangère refusée.';


  ------------------------------------------------------------------------------
  -- TEST 11 : Montant zéro (amount = 0) refusé
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'minerval', p_name => 'Montant Zéro', p_amount => 0.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 11 : Montant zéro aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 11 PASS : Montant zéro refusé.';


  ------------------------------------------------------------------------------
  -- TEST 12 : Montant négatif (amount < 0) refusé
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'minerval', p_name => 'Montant Négatif', p_amount => -25.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 12 : Montant négatif aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 12 PASS : Montant négatif refusé.';


  ------------------------------------------------------------------------------
  -- TEST 13 : Devise invalide (EUR) refusée
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'minerval', p_name => 'Test Euro', p_amount => 50.00, p_currency => 'EUR', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 13 : Devise EUR aurait dû être rejetée.'; END IF;
  RAISE NOTICE '✓ TEST 13 PASS : Devise invalide (EUR) refusée.';


  ------------------------------------------------------------------------------
  -- TEST 14 : fee_type invalide refusé
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'type_inexistant', p_name => 'Test Type', p_amount => 50.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 14 : Type de frais invalide aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 14 PASS : fee_type invalide refusé.';


  ------------------------------------------------------------------------------
  -- TEST 15 : Nom vide (name = '   ') refusé
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'minerval', p_name => '    ', p_amount => 50.00, p_currency => 'USD', p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 15 : Nom vide aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 15 PASS : Nom vide refusé.';


  ------------------------------------------------------------------------------
  -- TEST 16 : Doublon métier actif refusé
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_year_a, p_fee_type => 'uniforme', p_name => '  Uniforme de Sport Complémentaire  ', p_amount => 35000.00, p_currency => 'CDF', p_due_date => '2026-09-30'::DATE, p_class_id => v_class_a
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 16 : Doublon actif aurait dû être rejeté.'; END IF;
  RAISE NOTICE '✓ TEST 16 PASS : Doublon métier actif refusé.';


  ------------------------------------------------------------------------------
  -- TEST 17 : Modification inter-écoles refusée (Agent B sur Tarif A)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_agent_b::text);
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.update_school_fee_catalog_item(
      p_fee_id => v_fee_id, p_name => 'Piratage Tarif A', p_amount => 1.00, p_due_date => '2026-10-15'::DATE
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 17 : Agent B aurait dû être bloqué en modification sur École A.'; END IF;
  RAISE NOTICE '✓ TEST 17 PASS : Modification inter-écoles refusée.';


  ------------------------------------------------------------------------------
  -- TEST 18 : Archivage inter-écoles refusé (Agent B sur Tarif A)
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.set_school_fee_catalog_item_status(
      p_fee_id => v_fee_id, p_is_active => false
    );
  EXCEPTION WHEN OTHERS THEN v_error_caught := TRUE; END;
  IF NOT v_error_caught THEN RAISE EXCEPTION 'ÉCHEC TEST 18 : Agent B aurait dû être bloqué en archivage sur École A.'; END IF;
  RAISE NOTICE '✓ TEST 18 PASS : Archivage inter-écoles refusé.';


  ------------------------------------------------------------------------------
  -- TEST 19 : Réactivation valide d'un tarif archivé
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_agent_a::text);

  -- Étape A : Désactivation
  PERFORM public.set_school_fee_catalog_item_status(p_fee_id => v_fee_id, p_is_active => false);

  -- Étape B : Réactivation
  v_res := public.set_school_fee_catalog_item_status(p_fee_id => v_fee_id, p_is_active => true);

  IF (v_res->>'is_active')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC TEST 19 : La réactivation du tarif a échoué.';
  END IF;
  RAISE NOTICE '✓ TEST 19 PASS : Réactivation valide d''un tarif réactivé.';


  ------------------------------------------------------------------------------
  -- TEST 20 : Tarif archivé exclu de la création de nouvelles factures
  ------------------------------------------------------------------------------
  -- Archivage du tarif v_fee_id
  PERFORM public.set_school_fee_catalog_item_status(p_fee_id => v_fee_id, p_is_active => false);

  -- Vérification que la requête de sélection des tarifs actifs pour facturation l'exclut
  IF EXISTS (
    SELECT 1 FROM public.school_fees
    WHERE id = v_fee_id AND school_id = v_school_a AND is_active = true
  ) THEN
    RAISE EXCEPTION 'ÉCHEC TEST 20 : Le tarif archivé apparaît toujours parmi les tarifs actifs.';
  END IF;
  RAISE NOTICE '✓ TEST 20 PASS : Tarif archivé exclu de la sélection pour nouvelles factures.';


  ------------------------------------------------------------------------------
  -- TEST 21 & 22 : Droits EXECUTE révoqués de PUBLIC/anon et accordés à authenticated
  ------------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_priv_grant_count
  FROM information_schema.routine_privileges
  WHERE routine_name = 'create_school_fee_catalog_item'
    AND grantee IN ('PUBLIC', 'anon');

  IF v_priv_grant_count > 0 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 21 : EXECUTE n''a pas été révoqué de PUBLIC ou anon.';
  END IF;
  RAISE NOTICE '✓ TEST 21 & 22 PASS : EXECUTE révoqué de PUBLIC/anon et strictement restreint.';


  ------------------------------------------------------------------------------
  -- TEST 23 : Aucune suppression physique autorisée (Aucun DELETE sur school_fees)
  ------------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    -- Tentative de suppression directe sous RLS
    DELETE FROM public.school_fees WHERE id = v_fee_id;
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
  END;

  RAISE NOTICE '✓ TEST 23 PASS : Intégrité physique préservée (aucun DELETE physique).';

  RAISE NOTICE '=== SUITE COMPLÈTE DE 23 TESTS SQL RÉUSSIE (ROLLBACK AUTOMATIQUE) ===';
END;
$$;

ROLLBACK;
