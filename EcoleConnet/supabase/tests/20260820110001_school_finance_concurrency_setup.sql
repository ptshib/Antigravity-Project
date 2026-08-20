-- ============================================================================
-- SETUP INITIAL FIXTURES POUR TESTS DE CONCURRENCE MULTI-SESSIONS (FINANCE 1)
-- Fichier : supabase/tests/20260820110001_school_finance_concurrency_setup.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. VÉRIFICATION STRICTE D'ENVIRONNEMENT LOCAL VIA MARQUEUR SUR (ANTI-PRODUCTION)
--------------------------------------------------------------------------------

DO $$
BEGIN
  -- Vérification obligatoire du marqueur spécifique transmis uniquement par le runner local
  IF current_setting('ecoleconnect.finance_concurrency_environment', true) IS DISTINCT FROM 'local_docker_EcoleConnet' THEN
    RAISE EXCEPTION 'REJET SÉCURITÉ : Le setup de concurrence est strictement réservé à la base locale Supabase (Marqueur "ecoleconnect.finance_concurrency_environment=local_docker_EcoleConnet" manquant ou invalide).'
      USING ERRCODE = 'P0001';
  END IF;
END $$;


--------------------------------------------------------------------------------
-- 2. CONTRÔLE FAIL-FAST DE PRÉSENCE PRÉALABLE (AUCUN DELETE, IMPOSITION DB RESET)
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.schools WHERE id = '11111111-1111-4111-a111-111111111111'::uuid) OR
     EXISTS (SELECT 1 FROM public.student_invoices WHERE id IN ('77777777-7777-4777-a777-777777777771'::uuid, '77777777-7777-4777-a777-777777777772'::uuid)) OR
     EXISTS (SELECT 1 FROM public.student_payments WHERE idempotency_key IN ('IDEMP-CONC-001', 'IDEMP-CONC-002A', 'IDEMP-CONC-002B')) THEN
    RAISE EXCEPTION 'REJET FAIL-FAST : Des fixtures de concurrence préexistantes ont été détectées. Veuillez réinitialiser la base locale avec "npx supabase db reset" avant de réexécuter ce test.'
      USING ERRCODE = '23505';
  END IF;
END $$;


--------------------------------------------------------------------------------
-- 3. INJECTION DES FIXTURES MINIMALES STRUCTURALES (UUIDs FIXES)
--------------------------------------------------------------------------------

-- A. Établissement de Test Concurrence
INSERT INTO public.schools (id, name, slug, status)
VALUES (
  '11111111-1111-4111-a111-111111111111',
  'École Concurrence Test',
  'ecole-concurrence-test',
  'active'
);

-- B. Utilisateur Auth & Profil Agent Financier
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '33333333-3333-4333-a333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'agent_concurrency@test.com',
  'hash',
  now(),
  '{"provider":"email"}',
  '{"first_name":"Agent","last_name":"Concurrency","role":"finance_agent"}'::jsonb,
  now(),
  now()
);

INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
VALUES (
  '33333333-3333-4333-a333-333333333333',
  '11111111-1111-4111-a111-111111111111',
  'finance_agent',
  'Agent',
  'Concurrency',
  true
);

-- C. Année Scolaire
INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
VALUES (
  '22222222-2222-4222-a222-222222222222',
  '11111111-1111-4111-a111-111111111111',
  '2026-2027',
  '2026-09-01',
  '2027-06-30',
  true
);

-- D. Classe
INSERT INTO public.classes (id, school_id, academic_year_id, name, is_active)
VALUES (
  '44444444-4444-4444-a444-444444444444',
  '11111111-1111-4111-a111-111111111111',
  '22222222-2222-4222-a222-222222222222',
  'Classe Concurrence 6A',
  true
);

-- E. Élève & Inscription Active
INSERT INTO public.students (id, school_id, student_number, first_name, last_name)
VALUES (
  '55555555-5555-4555-a555-555555555555',
  '11111111-1111-4111-a111-111111111111',
  'MAT-CONC-001',
  'Élève',
  'Concurrence'
);

INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status, enrolled_on)
VALUES (
  '66666666-6666-4666-a666-666666666666',
  '11111111-1111-4111-a111-111111111111',
  '55555555-5555-4555-a555-555555555555',
  '22222222-2222-4222-a222-222222222222',
  '44444444-4444-4444-a444-444444444444',
  'active',
  '2026-09-01'
);


--------------------------------------------------------------------------------
-- 4. INJECTION DES DEUX FACTURES BROUILLON ET DE LEURS LIGNES
--------------------------------------------------------------------------------

-- Facture 1 : Scénario 1 (Idempotence sous rejeu concurrent) - Brouillon initial
INSERT INTO public.student_invoices (
  id,
  school_id,
  academic_year_id,
  student_id,
  enrollment_id,
  class_id,
  invoice_number,
  sequence_number,
  issue_date,
  due_date,
  currency,
  total_amount,
  paid_amount,
  status,
  created_by
) VALUES (
  '77777777-7777-4777-a777-777777777771',
  '11111111-1111-4111-a111-111111111111',
  '22222222-2222-4222-a222-222222222222',
  '55555555-5555-4555-a555-555555555555',
  '66666666-6666-4666-a666-666666666666',
  '44444444-4444-4444-a444-444444444444',
  'INV-2026-CONC01',
  1001,
  CURRENT_DATE,
  CURRENT_DATE + 30,
  'USD',
  100.00,
  0.00,
  'draft',
  '33333333-3333-4333-a333-333333333333'
);

INSERT INTO public.student_invoice_items (
  invoice_id, school_id, academic_year_id, student_id, currency, fee_name, fee_type, unit_price, quantity, total_price
) VALUES (
  '77777777-7777-4777-a777-777777777771',
  '11111111-1111-4111-a111-111111111111',
  '22222222-2222-4222-a222-222222222222',
  '55555555-5555-4555-a555-555555555555',
  'USD',
  'Frais Scénario 1',
  'autre',
  100.00,
  1,
  100.00
);

-- Facture 2 : Scénario 2 (Double paiement de 70 USD -> Anti-surpaiement) - Brouillon initial
INSERT INTO public.student_invoices (
  id,
  school_id,
  academic_year_id,
  student_id,
  enrollment_id,
  class_id,
  invoice_number,
  sequence_number,
  issue_date,
  due_date,
  currency,
  total_amount,
  paid_amount,
  status,
  created_by
) VALUES (
  '77777777-7777-4777-a777-777777777772',
  '11111111-1111-4111-a111-111111111111',
  '22222222-2222-4222-a222-222222222222',
  '55555555-5555-4555-a555-555555555555',
  '66666666-6666-4666-a666-666666666666',
  '44444444-4444-4444-a444-444444444444',
  'INV-2026-CONC02',
  1002,
  CURRENT_DATE,
  CURRENT_DATE + 30,
  'USD',
  100.00,
  0.00,
  'draft',
  '33333333-3333-4333-a333-333333333333'
);

INSERT INTO public.student_invoice_items (
  invoice_id, school_id, academic_year_id, student_id, currency, fee_name, fee_type, unit_price, quantity, total_price
) VALUES (
  '77777777-7777-4777-a777-777777777772',
  '11111111-1111-4111-a111-111111111111',
  '22222222-2222-4222-a222-222222222222',
  '55555555-5555-4555-a555-555555555555',
  'USD',
  'Frais Scénario 2',
  'autre',
  100.00,
  1,
  100.00
);


--------------------------------------------------------------------------------
-- 5. ÉMISSION OFFICIELLE DES DEUX FACTURES VIA LA RPC SECURITY DEFINER
--------------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT public.issue_student_invoice('77777777-7777-4777-a777-777777777771');
SELECT public.issue_student_invoice('77777777-7777-4777-a777-777777777772');

RESET ROLE;


--------------------------------------------------------------------------------
-- 6. RAPPORT D'INITIALISATION
--------------------------------------------------------------------------------

DO $$
BEGIN
  RAISE NOTICE '======================================================================';
  RAISE NOTICE 'SETUP DE CONCURRENCE FINANCE 1 INITIALISÉ AVEC SUCCÈS (COMMIT)';
  RAISE NOTICE '======================================================================';
  RAISE NOTICE 'AGENT_UUID     : 33333333-3333-4333-a333-333333333333';
  RAISE NOTICE 'INVOICE_1_UUID : 77777777-7777-4777-a777-777777777771 (Scénario 1 Idempotence - Émise)';
  RAISE NOTICE 'INVOICE_2_UUID : 77777777-7777-4777-a777-777777777772 (Scénario 2 Surpaiement - Émise)';
  RAISE NOTICE '======================================================================';
END $$;

COMMIT;
