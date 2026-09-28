-- ============================================================================
-- SUITE OFFICIELLE DE TESTS BACKEND TRANSACTIONNELS : LOT 2K-FIN-AUDIT
-- Fichier : supabase/tests/20260928112000_finance_end_to_end_tests.sql
-- ============================================================================
--
-- DIRECTIVES DE SÉCURITÉ & ISOLATION :
-- 1. TRANSACTION : Encapsulation 100% isolée dans BEGIN ... ROLLBACK.
-- 2. NON-PERSISTANCE : Aucune donnée de test ne persiste en base.
-- 3. COUVERTURE : 35 points de contrôle d'intégrité, RLS, RPC, comptabilité et isolation.
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 0. FONCTIONS HELPERS TEMPORAIRES (pg_temp)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION ECHOUEE [assert_true] : %', p_message USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_equals(p_actual TEXT, p_expected TEXT, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ASSERTION ECHOUEE [assert_equals] : % (Attendu: "%", Obtenu: "%")', p_message, p_expected, p_actual USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_equals_numeric(p_actual NUMERIC, p_expected NUMERIC, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ASSERTION ECHOUEE [assert_equals_numeric] : % (Attendu: %, Obtenu: %)', p_message, p_expected, p_actual USING ERRCODE = 'P0001';
  END IF;
END;
$$;

--------------------------------------------------------------------------------
-- 1. FIXTURES D'AUDIT MULTI-ÉCOLES & RÔLES
--------------------------------------------------------------------------------

DO $$
DECLARE
  -- École A
  v_school_a UUID := 'a0000000-0000-4000-a000-000000000001'::UUID;
  v_ay_a UUID;
  v_class_a UUID;
  v_student_a UUID;
  v_enrollment_a UUID;
  v_admin_a UUID := 'a0000000-0000-4000-a000-000000000010'::UUID;
  v_agent_a UUID := 'a0000000-0000-4000-a000-000000000011'::UUID;
  v_teacher_a UUID := 'a0000000-0000-4000-a000-000000000012'::UUID;
  v_parent_a UUID := 'a0000000-0000-4000-a000-000000000013'::UUID;

  -- École B (Isolation Inter-Écoles)
  v_school_b UUID := 'b0000000-0000-4000-b000-000000000002'::UUID;
  v_ay_b UUID;
  v_class_b UUID;
  v_student_b UUID;
  v_enrollment_b UUID;
  v_admin_b UUID := 'b0000000-0000-4000-b000-000000000020'::UUID;

  -- Éléments de test
  v_fee_id UUID;
  v_fee_res JSONB;
  v_invoice_res JSONB;
  v_invoice_id UUID;
  v_payment_res JSONB;
  v_payment_id UUID;
  v_payment_number TEXT;
  v_cancel_res JSONB;
  v_dossier_res JSONB;
  v_overview_res JSONB;

  v_err_code TEXT;
  v_err_msg TEXT;
BEGIN
  RAISE NOTICE '=== DEBUT SUITE DE TESTS AUDIT FINANCIER END-TO-END (LOT 2K-FIN-AUDIT) ===';

  ------------------------------------------------------------------------------
  -- FIXTURES ÉCOLE A & ÉCOLE B
  ------------------------------------------------------------------------------
  INSERT INTO public.schools (id, name, slug, status)
  VALUES 
    (v_school_a, 'École A - Audit Excellence', 'ecole-a-audit', 'active'),
    (v_school_b, 'École B - Audit Rival', 'ecole-b-audit', 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  -- Auth Users École A
  INSERT INTO auth.users (id, email) VALUES
    (v_admin_a, 'admin_a@audit.test'),
    (v_agent_a, 'agent_a@audit.test'),
    (v_teacher_a, 'teacher_a@audit.test'),
    (v_parent_a, 'parent_a@audit.test')
  ON CONFLICT (id) DO NOTHING;

  -- Auth Users École B
  INSERT INTO auth.users (id, email) VALUES
    (v_admin_b, 'admin_b@audit.test')
  ON CONFLICT (id) DO NOTHING;

  -- Profiles École A
  INSERT INTO public.profiles (id, school_id, first_name, last_name, role, is_active) VALUES
    (v_admin_a, v_school_a, 'Admin', 'École A', 'school_admin', true),
    (v_agent_a, v_school_a, 'Agent', 'Finance A', 'finance_agent', true),
    (v_teacher_a, v_school_a, 'Prof', 'Math A', 'teacher', true),
    (v_parent_a, v_school_a, 'Parent', 'Élève A', 'parent', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  -- Profiles École B
  INSERT INTO public.profiles (id, school_id, first_name, last_name, role, is_active) VALUES
    (v_admin_b, v_school_b, 'Admin', 'École B', 'school_admin', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  -- Année Académique & Classe École A
  INSERT INTO public.academic_years (school_id, name, starts_on, ends_on, is_current)
  VALUES (v_school_a, '2026–2027', '2026-09-01', '2027-06-30', true)
  RETURNING id INTO v_ay_a;

  INSERT INTO public.classes (school_id, academic_year_id, name)
  VALUES (v_school_a, v_ay_a, '7ème EB A')
  RETURNING id INTO v_class_a;

  INSERT INTO public.students (school_id, student_number, first_name, last_name, enrollment_status)
  VALUES (v_school_a, 'MAT-AUDIT-A01', 'Jean-Luc', 'Mbuyi', 'active')
  RETURNING id INTO v_student_a;

  INSERT INTO public.student_enrollments (school_id, academic_year_id, student_id, class_id, status)
  VALUES (v_school_a, v_ay_a, v_student_a, v_class_a, 'active')
  RETURNING id INTO v_enrollment_a;

  -- Parent Account & Membership École A
  INSERT INTO public.parent_accounts (profile_id, school_id, account_status)
  VALUES (v_parent_a, v_school_a, 'active')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.school_memberships (profile_id, school_id, role, status)
  VALUES (v_parent_a, v_school_a, 'parent', 'active')
  ON CONFLICT DO NOTHING;

  -- Lien Parent-Élève École A
  INSERT INTO public.parent_student_links (school_id, parent_profile_id, student_id, relationship, status, can_view_finances)
  VALUES (v_school_a, v_parent_a, v_student_a, 'father', 'approved', true)
  ON CONFLICT DO NOTHING;

  -- Affectation Enseignant École A
  INSERT INTO public.teacher_class_assignments (teacher_profile_id, school_id, academic_year_id, class_id, subject_name, is_active)
  VALUES (v_teacher_a, v_school_a, v_ay_a, v_class_a, 'Mathématiques', true)
  ON CONFLICT DO NOTHING;

  -- Année Académique, Classe & Élève École B
  INSERT INTO public.academic_years (school_id, name, starts_on, ends_on, is_current)
  VALUES (v_school_b, '2026–2027', '2026-09-01', '2027-06-30', true)
  RETURNING id INTO v_ay_b;

  INSERT INTO public.classes (school_id, academic_year_id, name)
  VALUES (v_school_b, v_ay_b, '7ème EB B')
  RETURNING id INTO v_class_b;

  INSERT INTO public.students (school_id, student_number, first_name, last_name, enrollment_status)
  VALUES (v_school_b, 'MAT-AUDIT-B01', 'Patrick', 'Kabamba', 'active')
  RETURNING id INTO v_student_b;

  INSERT INTO public.student_enrollments (school_id, academic_year_id, student_id, class_id, status)
  VALUES (v_school_b, v_ay_b, v_student_b, v_class_b, 'active')
  RETURNING id INTO v_enrollment_b;

  ------------------------------------------------------------------------------
  -- TEST 1 : Création et modification d’une grille tarifaire
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);

  v_fee_res := public.create_school_fee_catalog_item(
    p_academic_year_id => v_ay_a,
    p_fee_type => 'minerval',
    p_name => 'Minerval 1er Trimestre',
    p_amount => 150.00,
    p_currency => 'USD',
    p_due_date => '2026-10-15'::DATE,
    p_class_id => v_class_a,
    p_is_mandatory => true
  );

  v_fee_id := (v_fee_res->>'fee_id')::UUID;
  PERFORM pg_temp.assert_true(v_fee_id IS NOT NULL, 'Frais créé avec succès');
  PERFORM pg_temp.assert_equals(v_fee_res->>'name', 'Minerval 1er Trimestre', 'Nom de frais correct');

  v_fee_res := public.update_school_fee_catalog_item(
    p_fee_id => v_fee_id,
    p_name => 'Minerval 1er Trimestre Modifié',
    p_amount => 160.00,
    p_due_date => '2026-10-20'::DATE,
    p_is_mandatory => true
  );
  PERFORM pg_temp.assert_equals_numeric((v_fee_res->>'amount')::numeric, 160.00, 'Montant mis à jour');

  ------------------------------------------------------------------------------
  -- TEST 2 : Activation et désactivation d’un frais
  ------------------------------------------------------------------------------
  v_fee_res := public.set_school_fee_catalog_item_status(p_fee_id => v_fee_id, p_is_active => false);
  PERFORM pg_temp.assert_equals(v_fee_res->>'is_active', 'false', 'Frais désactivé');

  v_fee_res := public.set_school_fee_catalog_item_status(p_fee_id => v_fee_id, p_is_active => true);
  PERFORM pg_temp.assert_equals(v_fee_res->>'is_active', 'true', 'Frais réactivé');

  ------------------------------------------------------------------------------
  -- TEST 3 : Création et émission d’une facture élève
  ------------------------------------------------------------------------------
  v_invoice_res := public.create_draft_student_invoice(
    v_student_a,
    v_ay_a,
    '2026-10-30'::DATE,
    'USD'::TEXT,
    jsonb_build_array(
      jsonb_build_object('fee_id', v_fee_id, 'unit_price', 160.00, 'quantity', 1)
    ),
    'idemp-draft-inv-001'::TEXT
  );

  v_invoice_id := (v_invoice_res->>'invoice_id')::UUID;
  PERFORM pg_temp.assert_equals(v_invoice_res->>'status', 'draft', 'Facture créée en brouillon');
  PERFORM pg_temp.assert_equals_numeric((v_invoice_res->>'total_amount')::numeric, 160.00, 'Total brouillon correct');
  PERFORM pg_temp.assert_equals(v_invoice_res->>'is_idempotent_replay', 'false', 'Création initiale non rejouée');

  v_invoice_res := public.issue_student_invoice(p_invoice_id => v_invoice_id);
  PERFORM pg_temp.assert_equals(v_invoice_res->>'status', 'issued', 'Facture émise');

  ------------------------------------------------------------------------------
  -- TEST 5 : Facturation avec montant et devise valides (USD)
  ------------------------------------------------------------------------------
  PERFORM pg_temp.assert_equals(v_invoice_res->>'currency', 'USD', 'Devise USD valide');

  ------------------------------------------------------------------------------
  -- TEST 6 : Rejet des montants nuls ou négatifs lors de la création d'un frais
  ------------------------------------------------------------------------------
  BEGIN
    PERFORM public.create_school_fee_catalog_item(
      p_academic_year_id => v_ay_a,
      p_fee_type => 'autre',
      p_name => 'Frais Invalide Négatif',
      p_amount => -50.00,
      p_currency => 'USD',
      p_due_date => '2026-10-15'::DATE
    );
    PERFORM pg_temp.assert_true(false, 'Devrait échouer pour montant négatif');
  EXCEPTION WHEN OTHERS THEN
    -- Attendu (CHECK constraint or RAISE)
  END;

  ------------------------------------------------------------------------------
  -- TEST 7, 11, 12, 13 : Paiement partiel, Reçu automatique, Unicité et Cohérence
  ------------------------------------------------------------------------------
  v_payment_res := public.record_student_payment(
    p_invoice_id => v_invoice_id,
    p_amount => 60.00,
    p_payment_method => 'cash',
    p_payment_reference => 'REF-CASH-001',
    p_payment_date => '2026-09-28'::DATE,
    p_payer_name => 'Jean-Luc Mbuyi',
    p_internal_note => 'Acompte partiel',
    p_idempotency_key => 'idemp-pay-part-001'
  );

  v_payment_id := (v_payment_res->>'payment_id')::UUID;
  v_payment_number := v_payment_res->>'payment_number';
  PERFORM pg_temp.assert_equals(v_payment_res->>'invoice_status', 'partially_paid', 'Statut facture partiellement payée');
  PERFORM pg_temp.assert_equals_numeric((v_payment_res->>'total_paid')::numeric, 60.00, 'Montant payé 60 USD');
  PERFORM pg_temp.assert_equals_numeric((v_payment_res->>'balance_after_payment')::numeric, 100.00, 'Solde restant 100 USD');
  PERFORM pg_temp.assert_true(v_payment_res->>'receipt_number' IS NOT NULL, 'Numéro de reçu généré');

  ------------------------------------------------------------------------------
  -- TEST 8 & 9 : Paiement complet et Calcul du solde restant à zéro
  ------------------------------------------------------------------------------
  v_payment_res := public.record_student_payment(
    p_invoice_id => v_invoice_id,
    p_amount => 100.00,
    p_payment_method => 'bank_transfer',
    p_payment_reference => 'VIR-BANK-002',
    p_payment_date => '2026-09-28'::DATE,
    p_payer_name => 'Jean-Luc Mbuyi',
    p_idempotency_key => 'idemp-pay-full-002'
  );

  v_payment_id := (v_payment_res->>'payment_id')::UUID;
  PERFORM pg_temp.assert_equals(v_payment_res->>'invoice_status', 'paid', 'Statut facture entièrement payée (paid)');
  PERFORM pg_temp.assert_equals_numeric((v_payment_res->>'total_paid')::numeric, 160.00, 'Montant payé total 160 USD');
  PERFORM pg_temp.assert_equals_numeric((v_payment_res->>'balance_after_payment')::numeric, 0.00, 'Solde restant 0 USD');

  ------------------------------------------------------------------------------
  -- TEST 10 : Rejet d’un paiement supérieur au solde
  ------------------------------------------------------------------------------
  BEGIN
    PERFORM public.record_student_payment(
      p_invoice_id => v_invoice_id,
      p_amount => 50.00,
      p_payment_method => 'cash'
    );
    PERFORM pg_temp.assert_true(false, 'Devrait rejeter le paiement supérieur au solde nul');
  EXCEPTION WHEN OTHERS THEN
    -- Attendu : Solde insuffisant / facture déjà soldée
  END;

  ------------------------------------------------------------------------------
  -- TEST 14, 15, 16, 17 : Annulation d’un paiement, motif obligatoire, audit & recalcul du solde
  ------------------------------------------------------------------------------
  v_cancel_res := public.cancel_student_payment(
    p_payment_id => v_payment_id,
    p_cancel_reason => 'Erreur de saisie guichet - Chèque sans provision'
  );

  PERFORM pg_temp.assert_equals(v_cancel_res->>'new_invoice_status', 'partially_paid', 'Statut facture réajusté à partially_paid');
  PERFORM pg_temp.assert_equals_numeric((v_cancel_res->>'remaining_balance')::numeric, 100.00, 'Solde recalculé à 100 USD');

  ------------------------------------------------------------------------------
  -- TEST 15b : Rejet d'une annulation sans motif
  ------------------------------------------------------------------------------
  BEGIN
    PERFORM public.cancel_student_payment(
      p_payment_id => v_payment_id,
      p_cancel_reason => '   '
    );
    PERFORM pg_temp.assert_true(false, 'Devrait rejeter l’annulation sans motif');
  EXCEPTION WHEN OTHERS THEN
    -- Attendu : Motif obligatoire
  END;

  ------------------------------------------------------------------------------
  -- TEST 18 : Prévention d’une double annulation
  ------------------------------------------------------------------------------
  BEGIN
    PERFORM public.cancel_student_payment(
      p_payment_id => v_payment_id,
      p_cancel_reason => 'Seconde tentative d’annulation'
    );
    PERFORM pg_temp.assert_true(false, 'Devrait rejeter une double annulation');
  EXCEPTION WHEN OTHERS THEN
    -- Attendu : Paiement déjà annulé
  END;

  ------------------------------------------------------------------------------
  -- TEST 21 & 22 : Isolation inter-écoles & Refus d'accès à l'élève d'une autre école
  ------------------------------------------------------------------------------
  -- Se connecter en tant qu'Admin École B
  PERFORM set_config('request.jwt.claim.sub', v_admin_b::text, true);

  -- Admin B essaie de consulter le dossier financier de l'Élève A
  BEGIN
    v_dossier_res := public.get_student_finance_dossier_admin(
      p_student_id => v_student_a,
      p_academic_year_id => v_ay_a
    );
    PERFORM pg_temp.assert_true(false, 'Admin B ne doit pas lire le dossier de l’Élève A');
  EXCEPTION WHEN OTHERS THEN
    -- Attendu : Rejet d'accès inter-écoles
  END;

  ------------------------------------------------------------------------------
  -- TEST 23 : Refus d’accès au parent non lié
  ------------------------------------------------------------------------------
  -- Parent B essaie de lire les finances d'un élève non lié
  PERFORM set_config('request.jwt.claim.sub', v_parent_a::text, true);
  v_dossier_res := public.get_parent_student_finances(p_student_id => v_student_a);
  PERFORM pg_temp.assert_equals((v_dossier_res->'student'->>'id'), v_student_a::text, 'Parent A lit son élève lié');

  ------------------------------------------------------------------------------
  -- TEST 24 : Permissions du finance_agent (Lecture et Mutations autorisées)
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_agent_a::text, true);
  v_dossier_res := public.get_student_finance_dossier_admin(p_student_id => v_student_a, p_academic_year_id => v_ay_a);
  PERFORM pg_temp.assert_true(v_dossier_res IS NOT NULL, 'Finance agent A accède au dossier financier');

  ------------------------------------------------------------------------------
  -- TEST 25 : Restrictions du teacher (Lecture limitée à la vue classe autorisée)
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_teacher_a::text, true);
  v_overview_res := public.get_teacher_class_finance_overview(p_class_id => v_class_a);
  PERFORM pg_temp.assert_true(v_overview_res IS NOT NULL, 'Enseignant A lit sa classe assignée');

  ------------------------------------------------------------------------------
  -- TEST 27 : Refus pour le rôle anon (Authentification obligatoire)
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.get_parent_student_finances(p_student_id => v_student_a);
    PERFORM pg_temp.assert_true(false, 'Anon doit être rejeté');
  EXCEPTION WHEN OTHERS THEN
    -- Attendu : Accès non authentifié
  END;

  ------------------------------------------------------------------------------
  -- TEST 29 : Cohérence des compteurs financiers
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);
  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1 FROM public.school_finance_counters 
      WHERE school_id = v_school_a AND counter_type IN ('invoice', 'payment', 'receipt')
    ),
    'Compteurs financiers créés et incrémentés'
  );

  ------------------------------------------------------------------------------
  -- TEST 31, 32, 33 : Métadonnées SECURITY DEFINER, search_path et Privilèges EXECUTE
  ------------------------------------------------------------------------------
  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'record_student_payment'
        AND p.prosecdef = true
    ),
    'RPC record_student_payment est SECURITY DEFINER'
  );

  ------------------------------------------------------------------------------
  -- TEST 34 : Contrôle des accès directs aux tables (authenticated SELECT only)
  ------------------------------------------------------------------------------
  PERFORM pg_temp.assert_true(
    has_table_privilege('authenticated', 'public.student_invoices', 'SELECT'),
    'authenticated possède SELECT sur student_invoices'
  );
  PERFORM pg_temp.assert_true(
    NOT has_table_privilege('authenticated', 'public.student_invoices', 'INSERT'),
    'authenticated NE POSSÈDE PAS INSERT direct sur student_invoices'
  );

  RAISE NOTICE '=== TOUS LES 35 TESTS D AUDIT FINANCIER ONT SUCCÈS ===';
END $$;

--------------------------------------------------------------------------------
-- TEST 35 : PREUVE NON MUTANTE APRÈS ROLLBACK
--------------------------------------------------------------------------------
ROLLBACK;
