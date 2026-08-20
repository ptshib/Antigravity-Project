-- ============================================================================
-- FIXTURES FRONTEND LOCALES AVEC COMPTES AUTH UTILISABLES (PHASE FINANCE 2)
-- Fichier : supabase/tests/finance_frontend_local_seed.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. VÉRIFICATION STRICTE DU MARQUEUR DE SÉCURITÉ LOCAL
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF current_setting('ecoleconnect.finance_frontend_environment', true) IS DISTINCT FROM 'local_docker_EcoleConnet' THEN
    RAISE EXCEPTION 'REJET SÉCURITÉ : Le script de seed frontend local est strictly réservé à la base locale Supabase (Marqueur "ecoleconnect.finance_frontend_environment=local_docker_EcoleConnet" manquant ou invalide).'
      USING ERRCODE = 'P0001';
  END IF;
END $$;


--------------------------------------------------------------------------------
-- 2. CONTRÔLE FAIL-FAST DE PRÉSENCE PRÉALABLE (AUCUN DELETE, IMPOSITION DB RESET)
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.schools WHERE id = 'a1000000-0000-4000-a000-000000000001'::uuid) OR
     EXISTS (SELECT 1 FROM auth.users WHERE email IN (
       'admin.finance.local@ecoleconnect.test',
       'agent.finance.local@ecoleconnect.test',
       'parent.finance.local@ecoleconnect.test',
       'teacher.finance.local@ecoleconnect.test'
     )) THEN
    RAISE EXCEPTION 'REJET FAIL-FAST : Des fixtures frontend locales ou des comptes de test existent déjà dans la base locale. Veuillez réinitialiser la base locale avec "npx supabase db reset" avant de réexécuter ce script.'
      USING ERRCODE = '23505';
  END IF;
END $$;


--------------------------------------------------------------------------------
-- 3. ÉTABLISSEMENT DE TEST LOCAL ET PARAMÈTRES FINANCIERS ENSEIGNANTS
--------------------------------------------------------------------------------

INSERT INTO public.schools (
  id, name, slug, status, allow_teacher_finance_view, allow_teacher_finance_amounts, country, timezone
) VALUES (
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'École Finance Locale',
  'ecole-finance-locale',
  'active',
  true,
  false,
  'RD Congo',
  'Africa/Kinshasa'
);


--------------------------------------------------------------------------------
-- 4. CRÉATION DES 4 COMPTES AUTH LOCALEMENT CONNECTABLES (auth.users + auth.identities)
--------------------------------------------------------------------------------

-- Mot de passe commun pour les 4 comptes : FinanceLocal2026!
-- Hashé via pgcrypto extensions.crypt('FinanceLocal2026!', extensions.gen_salt('bf'))

-- A. Compte school_admin
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
  created_at, updated_at
) VALUES (
  'a4000000-0000-4000-a000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'admin.finance.local@ecoleconnect.test',
  extensions.crypt('FinanceLocal2026!', extensions.gen_salt('bf')),
  now(),
  '', '', '', '',
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Admin","last_name":"Local","role":"school_admin"}'::jsonb,
  false, false, false,
  now(), now()
);

INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'a4000000-0000-4000-a000-000000000001'::uuid,
  jsonb_build_object('sub', 'a4000000-0000-4000-a000-000000000001', 'email', 'admin.finance.local@ecoleconnect.test'),
  'email',
  'a4000000-0000-4000-a000-000000000001',
  now(), now(), now()
);

INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
VALUES (
  'a4000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'school_admin',
  'Admin',
  'Local',
  true
);

-- B. Compte finance_agent
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
  created_at, updated_at
) VALUES (
  'a5000000-0000-4000-a000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'agent.finance.local@ecoleconnect.test',
  extensions.crypt('FinanceLocal2026!', extensions.gen_salt('bf')),
  now(),
  '', '', '', '',
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Agent","last_name":"Financier","role":"finance_agent"}'::jsonb,
  false, false, false,
  now(), now()
);

INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'a5000000-0000-4000-a000-000000000001'::uuid,
  jsonb_build_object('sub', 'a5000000-0000-4000-a000-000000000001', 'email', 'agent.finance.local@ecoleconnect.test'),
  'email',
  'a5000000-0000-4000-a000-000000000001',
  now(), now(), now()
);

INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
VALUES (
  'a5000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'finance_agent',
  'Agent',
  'Financier',
  true
);

-- C. Compte parent
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
  created_at, updated_at
) VALUES (
  'a6000000-0000-4000-a000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'parent.finance.local@ecoleconnect.test',
  extensions.crypt('FinanceLocal2026!', extensions.gen_salt('bf')),
  now(),
  '', '', '', '',
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Parent","last_name":"Tuteur","role":"parent"}'::jsonb,
  false, false, false,
  now(), now()
);

INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'a6000000-0000-4000-a000-000000000001'::uuid,
  jsonb_build_object('sub', 'a6000000-0000-4000-a000-000000000001', 'email', 'parent.finance.local@ecoleconnect.test'),
  'email',
  'a6000000-0000-4000-a000-000000000001',
  now(), now(), now()
);

INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
VALUES (
  'a6000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'parent',
  'Parent',
  'Tuteur',
  true
);

-- D. Compte teacher
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
  created_at, updated_at
) VALUES (
  'a7000000-0000-4000-a000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'teacher.finance.local@ecoleconnect.test',
  extensions.crypt('FinanceLocal2026!', extensions.gen_salt('bf')),
  now(),
  '', '', '', '',
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Enseignant","last_name":"Titulaire","role":"teacher"}'::jsonb,
  false, false, false,
  now(), now()
);

INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'a7000000-0000-4000-a000-000000000001'::uuid,
  jsonb_build_object('sub', 'a7000000-0000-4000-a000-000000000001', 'email', 'teacher.finance.local@ecoleconnect.test'),
  'email',
  'a7000000-0000-4000-a000-000000000001',
  now(), now(), now()
);

INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
VALUES (
  'a7000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'teacher',
  'Enseignant',
  'Titulaire',
  true
);


--------------------------------------------------------------------------------
-- 5. ANNÉE SCOLAIRE, CLASSE ET FICHE ENSEIGNANT
--------------------------------------------------------------------------------

-- A. Année Scolaire Active
INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
VALUES (
  'a2000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  '2026–2027',
  '2026-09-01',
  '2027-06-30',
  true
);

-- B. Fiche Enseignant dans public.teachers
INSERT INTO public.teachers (
  id, school_id, profile_id, employee_number, first_name, last_name, email, employment_status, account_status
) VALUES (
  'a8000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'a7000000-0000-4000-a000-000000000001'::uuid,
  'ENS-LOC-001',
  'Enseignant',
  'Titulaire',
  'teacher.finance.local@ecoleconnect.test',
  'active',
  'invited'
);

-- C. Classe Active avec Titulaire
INSERT INTO public.classes (
  id, school_id, academic_year_id, name, level, homeroom_teacher_id, is_active
) VALUES (
  'a3000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'a2000000-0000-4000-a000-000000000001'::uuid,
  '6ème Scientifique Locale',
  '6ème Secondaire',
  'a7000000-0000-4000-a000-000000000001'::uuid,
  true
);

-- D. Affectation de Matière à l'Enseignant
INSERT INTO public.teacher_class_assignments (
  id, school_id, teacher_profile_id, class_id, subject_name, academic_year_id
) VALUES (
  gen_random_uuid(),
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'a7000000-0000-4000-a000-000000000001'::uuid,
  'a3000000-0000-4000-a000-000000000001'::uuid,
  'Mathématiques',
  'a2000000-0000-4000-a000-000000000001'::uuid
);


--------------------------------------------------------------------------------
-- 6. ÉLÈVE (SANS COMPTE AUTH), INSCRIPTION ET LIEN PARENT-ÉLÈVE
--------------------------------------------------------------------------------

-- A. Fiche Élève Métier (profile_id = NULL)
INSERT INTO public.students (
  id, school_id, profile_id, student_number, class_id, gender, enrollment_status
) VALUES (
  'a9000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  NULL,
  'ELV-LOC-001',
  'a3000000-0000-4000-a000-000000000001'::uuid,
  'M',
  'active'
);

-- B. Inscription Active (student_enrollments)
INSERT INTO public.student_enrollments (
  id, school_id, student_id, academic_year_id, class_id, status, enrolled_on
) VALUES (
  'aa000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'a9000000-0000-4000-a000-000000000001'::uuid,
  'a2000000-0000-4000-a000-000000000001'::uuid,
  'a3000000-0000-4000-a000-000000000001'::uuid,
  'active',
  CURRENT_DATE
);

-- C. Lien Parent-Élève (parent_student_links) avec Autorisations
INSERT INTO public.parent_student_links (
  id, school_id, parent_profile_id, student_id, relationship, is_primary,
  status, can_view_finances, can_view_academic, can_receive_notifications
) VALUES (
  'ab000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'a6000000-0000-4000-a000-000000000001'::uuid,
  'a9000000-0000-4000-a000-000000000001'::uuid,
  'Père',
  true,
  'approved',
  true,
  true,
  true
);


--------------------------------------------------------------------------------
-- 7. CATALOGUE DES FRAIS (public.school_fees : USD & CDF SÉPARÉS)
--------------------------------------------------------------------------------

-- A. Frais Scolaires en USD (fee_type: 'minerval')
INSERT INTO public.school_fees (
  id, school_id, academic_year_id, fee_type, name, amount, currency, due_date, is_mandatory, is_active, created_by
) VALUES (
  'f1000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'a2000000-0000-4000-a000-000000000001'::uuid,
  'minerval',
  'Frais Scolaires Trimestriels (USD)',
  150.00,
  'USD',
  '2026-12-31'::date,
  true,
  true,
  'a5000000-0000-4000-a000-000000000001'::uuid
);

-- B. Frais d'Inscription en CDF (fee_type: 'inscription')
INSERT INTO public.school_fees (
  id, school_id, academic_year_id, fee_type, name, amount, currency, due_date, is_mandatory, is_active, created_by
) VALUES (
  'f2000000-0000-4000-a000-000000000001'::uuid,
  'a1000000-0000-4000-a000-000000000001'::uuid,
  'a2000000-0000-4000-a000-000000000001'::uuid,
  'inscription',
  'Frais d''Inscriptions (CDF)',
  50000.00,
  'CDF',
  '2026-10-31'::date,
  true,
  true,
  'a5000000-0000-4000-a000-000000000001'::uuid
);


--------------------------------------------------------------------------------
-- 8. GÉNÉRATION DES DONNÉES FINANCIÈRES VIA RPCS (CONTEXTE FINANCE_AGENT SIMULÉ)
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_res_draft JSONB;
  v_res_unpaid JSONB;
  v_res_partial JSONB;

  v_inv_draft_id UUID;
  v_inv_unpaid_id UUID;
  v_inv_partial_id UUID;

  v_items_draft JSONB;
  v_items_unpaid JSONB;
  v_items_partial JSONB;
  v_pay_res JSONB;
BEGIN
  -- Configuration du contexte de sécurité pour exécuter les RPCs en tant qu'agent financier
  PERFORM set_config('request.jwt.claim.sub', 'a5000000-0000-4000-a000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 1. Facture Draft USD (Brouillon non émise)
  v_items_draft := jsonb_build_array(
    jsonb_build_object(
      'fee_id', 'f1000000-0000-4000-a000-000000000001',
      'fee_name', 'Frais Scolaires Trimestriels (USD)',
      'fee_type', 'minerval',
      'unit_price', 150.00,
      'quantity', 1
    )
  );

  v_res_draft := public.create_draft_student_invoice(
    p_student_id := 'a9000000-0000-4000-a000-000000000001'::uuid,
    p_academic_year_id := 'a2000000-0000-4000-a000-000000000001'::uuid,
    p_due_date := '2026-10-31'::date,
    p_currency := 'USD',
    p_items := v_items_draft
  );

  v_inv_draft_id := (v_res_draft->>'invoice_id')::UUID;
  IF v_inv_draft_id IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC : La création de la facture brouillon USD a échoué.';
  END IF;

  -- 2. Facture Émise Impayée USD (Status: issued, Solde: 150 USD)
  v_items_unpaid := jsonb_build_array(
    jsonb_build_object(
      'fee_id', 'f1000000-0000-4000-a000-000000000001',
      'fee_name', 'Frais Scolaires Trimestriels (USD)',
      'fee_type', 'minerval',
      'unit_price', 150.00,
      'quantity', 1
    )
  );

  v_res_unpaid := public.create_draft_student_invoice(
    p_student_id := 'a9000000-0000-4000-a000-000000000001'::uuid,
    p_academic_year_id := 'a2000000-0000-4000-a000-000000000001'::uuid,
    p_due_date := '2026-11-15'::date,
    p_currency := 'USD',
    p_items := v_items_unpaid
  );

  v_inv_unpaid_id := (v_res_unpaid->>'invoice_id')::UUID;
  IF v_inv_unpaid_id IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC : La création de la facture impayée USD a échoué.';
  END IF;
  PERFORM public.issue_student_invoice(v_inv_unpaid_id);

  -- 3. Facture Émise Partiellement Payée CDF (Status: partially_paid, Payé: 20.000 CDF sur 50.000 CDF)
  v_items_partial := jsonb_build_array(
    jsonb_build_object(
      'fee_id', 'f2000000-0000-4000-a000-000000000001',
      'fee_name', 'Frais d''Inscriptions (CDF)',
      'fee_type', 'inscription',
      'unit_price', 50000.00,
      'quantity', 1
    )
  );

  v_res_partial := public.create_draft_student_invoice(
    p_student_id := 'a9000000-0000-4000-a000-000000000001'::uuid,
    p_academic_year_id := 'a2000000-0000-4000-a000-000000000001'::uuid,
    p_due_date := '2026-10-15'::date,
    p_currency := 'CDF',
    p_items := v_items_partial
  );

  v_inv_partial_id := (v_res_partial->>'invoice_id')::UUID;
  IF v_inv_partial_id IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC : La création de la facture CDF a échoué.';
  END IF;
  PERFORM public.issue_student_invoice(v_inv_partial_id);

  -- Encaisser un acompte via RPC (génère automatiquement le paiement et le reçu officiel)
  v_pay_res := public.record_student_payment(
    p_invoice_id := v_inv_partial_id,
    p_amount := 20000.00,
    p_payment_method := 'cash',
    p_idempotency_key := 'IDEMP-FRONTEND-LOCAL-SEED-001',
    p_payment_date := CURRENT_DATE,
    p_payment_reference := NULL,
    p_payer_name := 'Parent Tuteur',
    p_internal_note := 'Acompte espèces encaissé en local'
  );

  RESET ROLE;
END $$;


--------------------------------------------------------------------------------
-- 9. VÉRIFICATION FINALE STRICTE DES ASSERTIONS PAR EXCEPTION
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_total_invoices INTEGER;
  v_draft_count INTEGER;
  v_issued_count INTEGER;
  v_partial_count INTEGER;
  v_cdf_paid NUMERIC(14,2);
  v_cdf_remaining NUMERIC(14,2);
  v_receipt_count INTEGER;
BEGIN
  -- 1. Nombre total de factures
  SELECT COUNT(*) INTO v_total_invoices
  FROM public.student_invoices
  WHERE school_id = 'a1000000-0000-4000-a000-000000000001'::uuid
    AND student_id = 'a9000000-0000-4000-a000-000000000001'::uuid;

  IF v_total_invoices <> 3 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Attendu 3 factures, obtenu %.', v_total_invoices;
  END IF;

  -- 2. Répartition des statuts
  SELECT COUNT(*) FILTER (WHERE status = 'draft'),
         COUNT(*) FILTER (WHERE status = 'issued'),
         COUNT(*) FILTER (WHERE status = 'partially_paid')
  INTO v_draft_count, v_issued_count, v_partial_count
  FROM public.student_invoices
  WHERE school_id = 'a1000000-0000-4000-a000-000000000001'::uuid
    AND student_id = 'a9000000-0000-4000-a000-000000000001'::uuid;

  IF v_draft_count <> 1 OR v_issued_count <> 1 OR v_partial_count <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Mauvaise répartition des statuts (draft: %, issued: %, partially_paid: %).',
      v_draft_count, v_issued_count, v_partial_count;
  END IF;

  -- 3. Vérification des montants CDF (payé: 20.000, reste: 30.000)
  SELECT paid_amount, remaining_balance
  INTO v_cdf_paid, v_cdf_remaining
  FROM public.student_invoices
  WHERE school_id = 'a1000000-0000-4000-a000-000000000001'::uuid
    AND student_id = 'a9000000-0000-4000-a000-000000000001'::uuid
    AND currency = 'CDF';

  IF v_cdf_paid <> 20000.00 OR v_cdf_remaining <> 30000.00 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Montants CDF incorrects (Payé: %, Solde: %).', v_cdf_paid, v_cdf_remaining;
  END IF;

  -- 4. Reçu officiel généré
  SELECT COUNT(*) INTO v_receipt_count
  FROM public.payment_receipts
  WHERE school_id = 'a1000000-0000-4000-a000-000000000001'::uuid
    AND student_id = 'a9000000-0000-4000-a000-000000000001'::uuid
    AND currency = 'CDF';

  IF v_receipt_count <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Attendu 1 reçu officiel CDF, obtenu %.', v_receipt_count;
  END IF;

  -- 5. Vérification que les 8 colonnes de tokens GoTrue ne sont NULL pour aucun des 4 comptes locaux
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE email IN (
      'admin.finance.local@ecoleconnect.test',
      'agent.finance.local@ecoleconnect.test',
      'parent.finance.local@ecoleconnect.test',
      'teacher.finance.local@ecoleconnect.test'
    )
    AND (
      confirmation_token IS NULL OR
      recovery_token IS NULL OR
      email_change_token_new IS NULL OR
      email_change IS NULL OR
      phone_change IS NULL OR
      phone_change_token IS NULL OR
      email_change_token_current IS NULL OR
      reauthentication_token IS NULL OR
      email_confirmed_at IS NULL OR
      encrypted_password IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Un ou plusieurs comptes Auth de test possèdent des colonnes de tokens GoTrue à NULL ou des mots de passe/emails non confirmés.';
  END IF;

  -- 6. Vérification de la présence d'une identité email dans auth.identities
  IF (
    SELECT COUNT(DISTINCT user_id) FROM auth.identities
    WHERE user_id IN (
      'a4000000-0000-4000-a000-000000000001'::uuid,
      'a5000000-0000-4000-a000-000000000001'::uuid,
      'a6000000-0000-4000-a000-000000000001'::uuid,
      'a7000000-0000-4000-a000-000000000001'::uuid
    ) AND provider = 'email'
  ) <> 4 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Identités email manquantes dans auth.identities pour les 4 comptes locaux.';
  END IF;
END $$;

COMMIT;
