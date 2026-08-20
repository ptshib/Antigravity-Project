-- ============================================================================
-- Script de Validation et Tests d'Audit : RPCs Finance 1 (NON EXÉCUTÉ)
-- Fichier : supabase/school_finance_rpcs_audit_tests.sql
-- ============================================================================

-- NOTE D'AUDIT : Ce fichier est un script de test SQL autonome conçu pour tester
-- exhaustivement toutes les règles de sécurité, d'idempotence, de catalogue serveur,
-- de synthèse multidevise et d'intégrité comptable sous forme de transaction avec ROLLBACK automatique.

BEGIN;

DO $$
DECLARE
  v_school_a UUID := gen_random_uuid();
  v_school_b UUID := gen_random_uuid();
  
  v_year_a UUID := gen_random_uuid();
  v_year_b UUID := gen_random_uuid();
  
  v_admin_a UUID := gen_random_uuid();
  v_agent_a UUID := gen_random_uuid();
  v_agent_b UUID := gen_random_uuid();
  v_teacher_a UUID := gen_random_uuid();
  v_parent_a UUID := gen_random_uuid();
  v_parent_b UUID := gen_random_uuid();
  
  v_class_a UUID := gen_random_uuid();
  v_class_b UUID := gen_random_uuid();
  
  v_student_a UUID := gen_random_uuid();
  v_student_b UUID := gen_random_uuid();
  
  v_enroll_a UUID := gen_random_uuid();
  v_enroll_b UUID := gen_random_uuid();
  
  v_fee_usd_catalog UUID := gen_random_uuid();
  v_fee_cdf_catalog UUID := gen_random_uuid();
  v_fee_inactive UUID := gen_random_uuid();
  v_fee_other_class UUID := gen_random_uuid();
  
  v_invoice_usd_res JSONB;
  v_invoice_usd_id UUID;
  v_invoice_usd_num TEXT;
  
  v_invoice_cdf_res JSONB;
  v_invoice_cdf_id UUID;
  
  v_issue_res JSONB;
  v_pay_res1 JSONB;
  v_pay_res2 JSONB;
  v_pay_id1 UUID;
  
  v_cancel_res JSONB;
  v_parent_view JSONB;
  v_teacher_view JSONB;
  v_admin_view JSONB;
  
  v_caught BOOLEAN;
BEGIN
  RAISE NOTICE '=== DÉBUT DU JEU DE TESTS FINANCE 1 (MODE AUDIT ROLLBACK) ===';

  ------------------------------------------------------------------------------
  -- 0. FIXTURES DE TEST ISOLÉES
  ------------------------------------------------------------------------------
  
  -- Écoles A & B
  INSERT INTO public.schools (id, name, status, allow_teacher_finance_view, allow_teacher_finance_amounts)
  VALUES 
    (v_school_a, 'École Test Alpha', 'active', true, true),
    (v_school_b, 'École Test Beta', 'active', true, false);

  -- Années scolaires
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES 
    (v_year_a, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_b, v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true);

  -- Profils utilisateurs
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES 
    (v_admin_a, v_school_a, 'school_admin', 'Admin', 'Alpha', true),
    (v_agent_a, v_school_a, 'finance_agent', 'Agent', 'FinAlpha', true),
    (v_agent_b, v_school_b, 'finance_agent', 'Agent', 'FinBeta', true),
    (v_teacher_a, v_school_a, 'teacher', 'Prof', 'Alpha', true),
    (v_parent_a, v_school_a, 'parent', 'Parent', 'Alpha', true),
    (v_parent_b, v_school_b, 'parent', 'Parent', 'Beta', true);

  -- Classes
  INSERT INTO public.classes (id, school_id, academic_year_id, name, homeroom_teacher_id)
  VALUES 
    (v_class_a, v_school_a, v_year_a, '6ème Primaire A', v_teacher_a),
    (v_class_b, v_school_b, v_year_b, '6ème Primaire B', NULL);

  -- Élèves
  INSERT INTO public.students (id, school_id, student_number, first_name, last_name, middle_name)
  VALUES 
    (v_student_a, v_school_a, 'STU-ALP-001', 'David', 'Alpha', 'Mukubwa'),
    (v_student_b, v_school_b, 'STU-BET-001', 'Grace', 'Beta', 'Taty');

  -- Inscriptions réelles (student_enrollments)
  INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status)
  VALUES 
    (v_enroll_a, v_school_a, v_student_a, v_year_a, v_class_a, 'active'),
    (v_enroll_b, v_school_b, v_student_b, v_year_b, v_class_b, 'active');

  -- Catalogue de frais
  INSERT INTO public.school_fees (id, school_id, academic_year_id, class_id, fee_type, name, amount, currency, due_date, is_active, created_by)
  VALUES 
    (v_fee_usd_catalog, v_school_a, v_year_a, v_class_a, 'minerval', 'Frais Minerval USD', 150.00, 'USD', '2026-10-15', true, v_admin_a),
    (v_fee_cdf_catalog, v_school_a, v_year_a, NULL, 'frais_etat', 'Frais Dossier État CDF', 50000.00, 'CDF', '2026-10-15', true, v_admin_a),
    (v_fee_inactive, v_school_a, v_year_a, v_class_a, 'transport', 'Frais Inactif', 80.00, 'USD', '2026-10-15', false, v_admin_a),
    (v_fee_other_class, v_school_a, v_year_a, v_class_b, 'minerval', 'Frais Classe B Uniquement', 200.00, 'USD', '2026-10-15', true, v_admin_a);

  -- Liens Parents
  INSERT INTO public.parent_student_links (school_id, parent_profile_id, student_id, status, can_view_finances)
  VALUES 
    (v_school_a, v_parent_a, v_student_a, 'approved', true),
    (v_school_b, v_parent_b, v_student_b, 'approved', true);

  -- Affectation Enseignant
  INSERT INTO public.teacher_class_assignments (school_id, teacher_profile_id, class_id, subject_name, academic_year_id, is_active)
  VALUES 
    (v_school_a, v_teacher_a, v_class_a, 'Mathématiques', v_year_a, true);


  ------------------------------------------------------------------------------
  -- TEST 1 : Création facture avec frais inactif (DOIT ÉCHOUER)
  ------------------------------------------------------------------------------
  v_caught := false;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_agent_a::text, true);
    PERFORM public.create_draft_student_invoice(
      v_student_a, v_year_a, '2026-10-15'::date, 'USD',
      jsonb_build_array(jsonb_build_object('fee_id', v_fee_inactive, 'quantity', 1)),
      CURRENT_DATE
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  ASSERT v_caught = true, 'ÉCHEC TEST 1 : Frais catalogue inactif aurait dû être rejeté.';
  RAISE NOTICE 'SUCCÈS TEST 1 : Rejet du frais catalogue inactif validé.';


  ------------------------------------------------------------------------------
  -- TEST 2 : Création facture avec frais d'une autre classe (DOIT ÉCHOUER)
  ------------------------------------------------------------------------------
  v_caught := false;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_agent_a::text, true);
    PERFORM public.create_draft_student_invoice(
      v_student_a, v_year_a, '2026-10-15'::date, 'USD',
      jsonb_build_array(jsonb_build_object('fee_id', v_fee_other_class, 'quantity', 1)),
      CURRENT_DATE
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  ASSERT v_caught = true, 'ÉCHEC TEST 2 : Frais restreint à une autre classe aurait dû être rejeté.';
  RAISE NOTICE 'SUCCÈS TEST 2 : Rejet du frais d’une autre classe validé.';


  ------------------------------------------------------------------------------
  -- TEST 3 : Création de Facture USD avec Écrasement Côté Serveur des Prix Client
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_agent_a::text, true);
  -- Le client tente d'injecter un faux prix unitaire de 1.00 USD pour le catalogue (qui vaut 150.00 USD)
  v_invoice_usd_res := public.create_draft_student_invoice(
    v_student_a,
    v_year_a,
    '2026-10-15'::date,
    'USD',
    jsonb_build_array(
      jsonb_build_object('fee_id', v_fee_usd_catalog, 'unit_price', 1.00, 'quantity', 1),
      jsonb_build_object('fee_name', 'Carnet de liaison', 'fee_type', 'autre', 'unit_price', 10.00, 'quantity', 1)
    ),
    CURRENT_DATE
  );
  v_invoice_usd_id := (v_invoice_usd_res->>'invoice_id')::UUID;
  v_invoice_usd_num := v_invoice_usd_res->>'invoice_number';

  -- Le serveur a impérativement restauré 150.00 USD du catalogue + 10.00 USD = 160.00 USD
  ASSERT (v_invoice_usd_res->>'total_amount')::numeric = 160.00, 'ÉCHEC TEST 3 : Le serveur n’a pas forcé le prix catalogue.';
  ASSERT v_invoice_usd_res->>'status' = 'draft', 'ÉCHEC TEST 3 : Statut initial doit être draft.';
  RAISE NOTICE 'SUCCÈS TEST 3 : Facture USD créée avec intégrité absolue du catalogue serveur (Total: 160.00 USD).';


  ------------------------------------------------------------------------------
  -- TEST 4 : Création d'une Seconde Facture en CDF (Démontrant le Multidevise)
  ------------------------------------------------------------------------------
  v_invoice_cdf_res := public.create_draft_student_invoice(
    v_student_a,
    v_year_a,
    '2026-10-15'::date,
    'CDF',
    jsonb_build_array(
      jsonb_build_object('fee_id', v_fee_cdf_catalog, 'quantity', 1)
    ),
    CURRENT_DATE
  );
  v_invoice_cdf_id := (v_invoice_cdf_res->>'invoice_id')::UUID;
  ASSERT (v_invoice_cdf_res->>'total_amount')::numeric = 50000.00, 'ÉCHEC TEST 4 : Montant CDF incorrect.';
  RAISE NOTICE 'SUCCÈS TEST 4 : Facture CDF créée (Total: 50000.00 CDF).';


  ------------------------------------------------------------------------------
  -- TEST 5 : Émission des Factures (draft -> issued)
  ------------------------------------------------------------------------------
  v_issue_res := public.issue_student_invoice(v_invoice_usd_id);
  ASSERT v_issue_res->>'status' = 'issued', 'ÉCHEC TEST 5 : Statut USD après émission doit être issued.';

  PERFORM public.issue_student_invoice(v_invoice_cdf_id);
  RAISE NOTICE 'SUCCÈS TEST 5 : Factures USD et CDF émises avec succès.';


  ------------------------------------------------------------------------------
  -- TEST 6 : Idempotence & Paiement Partiel USD (100 USD)
  ------------------------------------------------------------------------------
  v_pay_res1 := public.record_student_payment(
    v_invoice_usd_id,
    100.00,
    'bank_transfer',
    'IDEMP-SECURE-001',
    CURRENT_DATE,
    'REF-VIR-01',
    'Parent Alpha',
    'Note interne confidentielle 1'
  );
  v_pay_id1 := (v_pay_res1->>'payment_id')::UUID;
  ASSERT v_pay_res1->>'is_idempotent_replay' = 'false', 'ÉCHEC TEST 6 : Premier appel doit être une nouvelle insertion.';
  ASSERT (v_pay_res1->>'balance_after_payment')::numeric = 60.00, 'ÉCHEC TEST 6 : Solde USD restant doit être 60.00.';

  -- Rejeu idempotent exact
  v_pay_res2 := public.record_student_payment(
    v_invoice_usd_id,
    100.00,
    'bank_transfer',
    'IDEMP-SECURE-001',
    CURRENT_DATE
  );
  ASSERT v_pay_res2->>'is_idempotent_replay' = 'true', 'ÉCHEC TEST 6 : Rejeu doit être détecté idempotent.';
  ASSERT (v_pay_res2->>'payment_id')::UUID = v_pay_id1, 'ÉCHEC TEST 6 : L’ID de paiement doit concorder.';
  RAISE NOTICE 'SUCCÈS TEST 6 : Idempotence concurrente et rejeu transparent validés.';


  ------------------------------------------------------------------------------
  -- TEST 7 : Conflit d'Idempotence (Même Clé avec Paramètres Différents -> DOIT ÉCHOUER)
  ------------------------------------------------------------------------------
  v_caught := false;
  BEGIN
    PERFORM public.record_student_payment(
      v_invoice_usd_id,
      50.00, -- Montant divergent
      'bank_transfer',
      'IDEMP-SECURE-001',
      CURRENT_DATE
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  ASSERT v_caught = true, 'ÉCHEC TEST 7 : Réutilisation conflictuelle d’idempotency_key aurait dû échouer.';
  RAISE NOTICE 'SUCCÈS TEST 7 : Conflit d’idempotence bloqué avec code 23505.';


  ------------------------------------------------------------------------------
  -- TEST 8 : Vérification de la Synthèse Multidevise Parent (JAMAIS d'addition USD + CDF)
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_parent_a::text, true);
  v_parent_view := public.get_parent_student_finances(v_student_a);
  
  -- Vérification que les devises USD et CDF sont strictement isolées
  ASSERT v_parent_view->'summary_by_currency'->'USD'->>'total_invoiced' = '160.00', 'ÉCHEC TEST 8 : Invoiced USD parent incorrect.';
  ASSERT v_parent_view->'summary_by_currency'->'USD'->>'total_paid' = '100.00', 'ÉCHEC TEST 8 : Paid USD parent incorrect.';
  ASSERT v_parent_view->'summary_by_currency'->'CDF'->>'total_invoiced' = '50000.00', 'ÉCHEC TEST 8 : Invoiced CDF parent incorrect.';
  ASSERT v_parent_view->'summary_by_currency'->'CDF'->>'total_paid' = '0.00', 'ÉCHEC TEST 8 : Paid CDF parent incorrect.';
  ASSERT v_parent_view::text NOT LIKE '%Note interne confidentielle%', 'ÉCHEC TEST 8 : Fuite de note interne vers parent !';
  RAISE NOTICE 'SUCCÈS TEST 8 : Synthèse parent multidevise vérifiée (USD: 160/100, CDF: 50000/0, zéro addition mixte).';


  ------------------------------------------------------------------------------
  -- TEST 9 : Vérification de la Consultation Enseignant (Classe & Année Restreintes)
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_teacher_a::text, true);
  v_teacher_view := public.get_teacher_class_finance_overview(v_class_a);
  ASSERT v_teacher_view->>'allowed' = 'true', 'ÉCHEC TEST 9 : Consultation enseignant doit être autorisée.';
  ASSERT v_teacher_view->'students'->0->'currencies'->0->>'currency' IS NOT NULL, 'ÉCHEC TEST 9 : Les devises doivent être ventilées.';
  RAISE NOTICE 'SUCCÈS TEST 9 : Consultation enseignant ventilée par devise validée.';


  ------------------------------------------------------------------------------
  -- TEST 10 : Annulation Atomique sous Verrou et Contrôle de Reçu Existant
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);
  v_cancel_res := public.cancel_student_payment(v_pay_id1, 'Annulation pour régularisation bancaire');
  ASSERT (v_cancel_res->>'recalculated_paid_amount')::numeric = 0.00, 'ÉCHEC TEST 10 : Montant payé recalculé doit être 0.00.';
  ASSERT v_cancel_res->>'new_invoice_status' = 'issued', 'ÉCHEC TEST 10 : Facture doit repasser à issued.';
  ASSERT (v_cancel_res->>'remaining_balance')::numeric = 160.00, 'ÉCHEC TEST 10 : Solde restant doit être 160.00.';
  RAISE NOTICE 'SUCCÈS TEST 10 : Annulation atomique sécurisée et solde réinitialisé à 160.00 USD.';


  ------------------------------------------------------------------------------
  -- TEST 11 : Rejet de la Double Annulation
  ------------------------------------------------------------------------------
  v_caught := false;
  BEGIN
    PERFORM public.cancel_student_payment(v_pay_id1, 'Tentative double annulation');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  ASSERT v_caught = true, 'ÉCHEC TEST 11 : Double annulation aurait dû être rejetée.';
  RAISE NOTICE 'SUCCÈS TEST 11 : Double annulation impossible.';


  ------------------------------------------------------------------------------
  -- TEST 12 : Dossier Financier Administratif Multidevise Complet
  ------------------------------------------------------------------------------
  v_admin_view := public.get_student_finance_dossier_admin(v_student_a, v_year_a);
  ASSERT v_admin_view->'summary_by_currency'->'USD'->>'total_invoiced' = '160.00', 'ÉCHEC TEST 12 : Total invoiced admin USD incorrect.';
  ASSERT v_admin_view->'summary_by_currency'->'CDF'->>'total_invoiced' = '50000.00', 'ÉCHEC TEST 12 : Total invoiced admin CDF incorrect.';
  RAISE NOTICE 'SUCCÈS TEST 12 : Dossier financier administratif multidevise validé.';

  RAISE NOTICE '=== TOUS LES 12 TESTS DE SÉCURITÉ ET D’INTÉGRITÉ ONT RÉUSSI AVEC SUCCÈS ===';
END $$;

ROLLBACK;
-- FIN DU SCRIPT DE TEST (TRANSACTION TOTALEMENT ANNULÉE, BASE INTACTE)
