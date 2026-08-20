-- ============================================================================
-- SUITE COMPLETE DE TESTS AUTOMATISES ET D'AUDIT : PHASE FINANCE 1
-- Fichier : supabase/tests/20260820110000_school_finance_rpcs_tests.sql
-- ============================================================================
--
-- DIRECTIVES D'EXECUTION ET DE SECURITE :
-- 1. ENVIRONNEMENT : Base locale ou branche Supabase jetable uniquement. Ne jamais exécuter en production.
-- 2. ENCAPSULATION : Transaction unique BEGIN ... ROLLBACK sans aucun COMMIT.
-- 3. ORDRE DES FIXTURES : schools -> auth.users (métadonnées complètes) -> profiles (UPSERT).
-- 4. RLS & PRIVILEGES : ENABLE RLS, FORCE RLS, cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE') = 0.
-- 5. MUTATIONS DIRECTES PRIVÉES : INSERT, UPDATE, DELETE et TRUNCATE direct émettent SQLSTATE 42501 sans privilèges.
-- 6. TESTS D'EXCEPTIONS : Vérification stricte via pg_temp.assert_raises sans masquage d'erreurs.
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. FONCTIONS HELPERS TEMPORAIRES DANS PG_TEMP
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION ECHOUEE [assert_true] : %', p_message
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_false(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS NOT FALSE THEN
    RAISE EXCEPTION 'ASSERTION ECHOUEE [assert_false] : %', p_message
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_equals(
  p_actual TEXT,
  p_expected TEXT,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ASSERTION ECHOUEE [assert_equals] : % (Attendu: "%", Obtenu: "%")',
      p_message, p_expected, p_actual
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_equals_numeric(
  p_actual NUMERIC,
  p_expected NUMERIC,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ASSERTION ECHOUEE [assert_equals_numeric] : % (Attendu: %, Obtenu: %)',
      p_message, p_expected, p_actual
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(
  p_expected_sqlstate TEXT,
  p_expected_msg_pattern TEXT,
  p_sqlstate TEXT,
  p_sqlerrm TEXT,
  p_context_msg TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_sqlstate IS DISTINCT FROM p_expected_sqlstate THEN
    RAISE EXCEPTION 'ASSERTION ECHOUEE [assert_raises code]: % (Attendu: %, Obtenu: % - Message: %)',
      p_context_msg, p_expected_sqlstate, p_sqlstate, p_sqlerrm
      USING ERRCODE = 'P0001';
  END IF;
  
  IF p_expected_msg_pattern IS NOT NULL AND p_sqlerrm NOT LIKE ('%' || p_expected_msg_pattern || '%') THEN
    RAISE EXCEPTION 'ASSERTION ECHOUEE [assert_raises message]: % (Pattern attendu: "%", Message obtenu: "%")',
      p_context_msg, p_expected_msg_pattern, p_sqlerrm
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.set_auth_context(
  p_user_id UUID,
  p_role TEXT DEFAULT 'authenticated'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_role = 'anon' OR p_user_id IS NULL THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', 'anon', true);
    EXECUTE 'SET LOCAL ROLE anon';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', p_role, true);
    EXECUTE 'SET LOCAL ROLE ' || quote_ident(p_role);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.reset_auth_context()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  EXECUTE 'SET LOCAL ROLE postgres';
END;
$$;


--------------------------------------------------------------------------------
-- 2. RUNNER PRINCIPAL DE LA SUITE DE TESTS
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_test_count INTEGER := 0;
  v_passed_count INTEGER := 0;

  -- UUIDs Écoles (A: standard, B: sans montants, C: vue enseignant désactivée, Susp: suspendue)
  v_school_a UUID := gen_random_uuid();
  v_school_b UUID := gen_random_uuid();
  v_school_c UUID := gen_random_uuid();
  v_school_susp UUID := gen_random_uuid();

  -- UUIDs Années Scolaires
  v_year_a UUID := gen_random_uuid();
  v_year_b UUID := gen_random_uuid();
  v_year_c UUID := gen_random_uuid();

  -- UUIDs Utilisateurs / Profils
  v_super_admin UUID := gen_random_uuid();
  v_admin_a UUID := gen_random_uuid();
  v_agent_a UUID := gen_random_uuid();
  v_agent_a_inact UUID := gen_random_uuid();
  v_agent_b UUID := gen_random_uuid();
  v_agent_susp UUID := gen_random_uuid();
  v_teacher_a UUID := gen_random_uuid();
  v_teacher_b UUID := gen_random_uuid();
  v_teacher_c UUID := gen_random_uuid();
  v_teacher_inact UUID := gen_random_uuid();
  v_parent_a UUID := gen_random_uuid();
  v_parent_b UUID := gen_random_uuid();
  v_parent_inact UUID := gen_random_uuid();
  v_parent_pending UUID := gen_random_uuid();
  v_parent_rejected UUID := gen_random_uuid();
  v_parent_revoked UUID := gen_random_uuid();
  v_parent_nofin UUID := gen_random_uuid();
  v_student_user_a UUID := gen_random_uuid();

  -- UUIDs Classes
  v_class_a1 UUID := gen_random_uuid();
  v_class_a2 UUID := gen_random_uuid();
  v_class_b UUID := gen_random_uuid();
  v_class_c UUID := gen_random_uuid();

  -- UUIDs Élèves & Inscriptions
  v_student_a UUID := gen_random_uuid();
  v_student_b UUID := gen_random_uuid();
  v_student_c UUID := gen_random_uuid();
  v_enroll_a1 UUID := gen_random_uuid();
  v_enroll_b UUID := gen_random_uuid();
  v_enroll_c UUID := gen_random_uuid();

  -- UUIDs Catalogue de Frais
  v_fee_usd_cat UUID := gen_random_uuid();
  v_fee_cdf_cat UUID := gen_random_uuid();
  v_fee_inact UUID := gen_random_uuid();
  v_fee_class_a2 UUID := gen_random_uuid();
  v_fee_school_b UUID := gen_random_uuid();

  -- Variables d'exécution
  v_res JSONB;
  v_invoice_usd_id UUID;
  v_invoice_usd_num TEXT;
  v_invoice_cdf_id UUID;
  v_payment_id1 UUID;
  v_payment_id2 UUID;
  v_receipt_id1 UUID;
  v_cancel_res JSONB;
  v_parent_res JSONB;
  v_teacher_res JSONB;
  v_admin_res JSONB;

  -- Variables de diagnostics
  v_caught BOOLEAN;
  v_sqlstate TEXT;
  v_errmsg TEXT;
  v_rowcount INTEGER;

  v_date_issue DATE := CURRENT_DATE;
  v_date_due_usd DATE := CURRENT_DATE + 30;
  v_date_due_cdf DATE := CURRENT_DATE + 45;
  v_date_pay1 DATE := CURRENT_DATE + 1;
  v_date_pay2 DATE := CURRENT_DATE + 2;
  
  v_rls_ok BOOLEAN;
  v_force_rls_ok BOOLEAN;
  v_write_policies_count INTEGER;
  v_fee_amount_check NUMERIC;
BEGIN
  RAISE NOTICE '======================================================================';
  RAISE NOTICE 'DEBUT DE L''AUDIT COMPLET DE LA PHASE FINANCE 1 (TRANSACTION ISOLEE)';
  RAISE NOTICE '======================================================================';

  ------------------------------------------------------------------------------
  -- SECTION 1 : AUDIT DE SCHEMA, PRECONDITIONS, ENABLE RLS & FORCE RLS
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 1] Verification du schema, ENABLE RLS et FORCE RLS...';

  -- 1.1 Existence des 6 tables financières
  v_test_count := v_test_count + 1;
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'school_finance_counters') AND
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'school_fees') AND
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_invoices') AND
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_invoice_items') AND
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_payments') AND
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_receipts'),
    'Les 6 tables financières doivent exister dans le schéma public.'
  );
  v_passed_count := v_passed_count + 1;

  -- 1.2 Verification ENABLE RLS et FORCE RLS avec pg_class.relrowsecurity et pg_class.relforcerowsecurity sur les 6 tables
  v_test_count := v_test_count + 1;
  SELECT bool_and(c.relrowsecurity), bool_and(c.relforcerowsecurity)
  INTO v_rls_ok, v_force_rls_ok
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('school_finance_counters', 'school_fees', 'student_invoices', 'student_invoice_items', 'student_payments', 'payment_receipts');

  PERFORM pg_temp.assert_true(
    v_rls_ok IS TRUE AND v_force_rls_ok IS TRUE,
    'ENABLE RLS et FORCE RLS doivent être activés sur les 6 tables financières.'
  );
  v_passed_count := v_passed_count + 1;

  -- 1.3 Absence totale de politiques d'écriture directe (ALL, INSERT, UPDATE, DELETE) sur les 6 tables financières
  v_test_count := v_test_count + 1;
  SELECT COUNT(*) INTO v_write_policies_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('school_finance_counters', 'school_fees', 'student_invoices', 'student_invoice_items', 'student_payments', 'payment_receipts')
    AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    AND (roles && ARRAY['authenticated', 'anon', 'public']::name[]);

  PERFORM pg_temp.assert_equals_numeric(
    v_write_policies_count::numeric,
    0.0,
    'Aucune politique d''écriture directe (ALL, INSERT, UPDATE, DELETE) ne doit exister sur les tables financières.'
  );
  v_passed_count := v_passed_count + 1;

  -- 1.4 Vérification des privilèges EXECUTE révoqués pour PUBLIC/anon/authenticated sur le compteur interne
  v_test_count := v_test_count + 1;
  PERFORM pg_temp.assert_false(
    has_function_privilege('anon', 'public.get_next_finance_counter(UUID, UUID, TEXT)', 'EXECUTE') OR
    has_function_privilege('authenticated', 'public.get_next_finance_counter(UUID, UUID, TEXT)', 'EXECUTE'),
    'public.get_next_finance_counter ne doit être accessible ni à anon ni à authenticated.'
  );
  v_passed_count := v_passed_count + 1;

  -- 1.5 Audit explicite des privilèges TRUNCATE, REFERENCES, TRIGGER et mutations (anon & authenticated)
  v_test_count := v_test_count + 1;
  PERFORM pg_temp.assert_false(
    EXISTS (
      SELECT 1 
      FROM (VALUES ('school_finance_counters'), ('school_fees'), ('student_invoices'), ('student_invoice_items'), ('student_payments'), ('payment_receipts')) AS t(tbl)
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
      CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv_name)
      WHERE has_table_privilege(r.role_name, 'public.' || t.tbl, p.priv_name)
    ),
    'Aucun rôle anon ou authenticated ne doit posséder TRUNCATE, REFERENCES, TRIGGER, INSERT, UPDATE ou DELETE sur les 6 tables financières.'
  );
  v_passed_count := v_passed_count + 1;

  -- 1.6 Audit d''étanchéité totale du rôle anon (aucun privilège y compris SELECT)
  v_test_count := v_test_count + 1;
  PERFORM pg_temp.assert_false(
    EXISTS (
      SELECT 1 
      FROM (VALUES ('school_finance_counters'), ('school_fees'), ('student_invoices'), ('student_invoice_items'), ('student_payments'), ('payment_receipts')) AS t(tbl)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv_name)
      WHERE has_table_privilege('anon', 'public.' || t.tbl, p.priv_name)
    ),
    'Le rôle anon ne doit posséder aucun privilège (y compris SELECT) sur les 6 tables financières.'
  );
  v_passed_count := v_passed_count + 1;

  -- 1.7 Audit de la présence obligatoire du privilège SELECT pour authenticated (requis par la RLS)
  v_test_count := v_test_count + 1;
  PERFORM pg_temp.assert_true(
    (
      SELECT bool_and(has_table_privilege('authenticated', 'public.' || tbl, 'SELECT'))
      FROM (VALUES ('school_finance_counters'), ('school_fees'), ('student_invoices'), ('student_invoice_items'), ('student_payments'), ('payment_receipts')) AS t(tbl)
    ),
    'Le rôle authenticated doit posséder le privilège SELECT sur les 6 tables financières pour que la RLS s''applique.'
  );
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- SECTION 2 : CREATION DES FIXTURES ADMINISTRATIVES (ORDRE ADAPTE AUX TRIGGERS)
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 2] Injection ordonnee des fixtures de test...';

  -- 2.1 Établissements (Créés en premier pour satisfaire les clés étrangères)
  INSERT INTO public.schools (id, name, slug, status, allow_teacher_finance_view, allow_teacher_finance_amounts)
  VALUES 
    (v_school_a, 'École Alpha Test', 'alpha-test-' || v_school_a::text, 'active', true, true),
    (v_school_b, 'École Bêta Test', 'beta-test-' || v_school_b::text, 'active', true, false),
    (v_school_c, 'École Gamma Test', 'gamma-test-' || v_school_c::text, 'active', false, false),
    (v_school_susp, 'École Suspendue Test', 'susp-test-' || v_school_susp::text, 'suspended', false, false);

  -- 2.2 Insertion dans auth.users avec emails uniques et métadonnées complètes
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES 
    (v_super_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_super_' || v_super_admin::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Super', 'last_name', 'Admin', 'role', 'super_admin'), now(), now()),
    (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_admin_' || v_admin_a::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Admin', 'last_name', 'Alpha', 'role', 'school_admin', 'school_id', v_school_a), now(), now()),
    (v_agent_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_agent_' || v_agent_a::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Agent', 'last_name', 'FinAlpha', 'role', 'finance_agent', 'school_id', v_school_a), now(), now()),
    (v_agent_a_inact, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_agentinact_' || v_agent_a_inact::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Agent', 'last_name', 'Inactif', 'role', 'finance_agent', 'school_id', v_school_a), now(), now()),
    (v_agent_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_agentb_' || v_agent_b::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Agent', 'last_name', 'FinBeta', 'role', 'finance_agent', 'school_id', v_school_b), now(), now()),
    (v_agent_susp, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_agentsusp_' || v_agent_susp::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Agent', 'last_name', 'Susp', 'role', 'finance_agent', 'school_id', v_school_susp), now(), now()),
    (v_teacher_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_teachera_' || v_teacher_a::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Prof', 'last_name', 'Alpha', 'role', 'teacher', 'school_id', v_school_a), now(), now()),
    (v_teacher_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_teacherb_' || v_teacher_b::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Prof', 'last_name', 'Beta', 'role', 'teacher', 'school_id', v_school_b), now(), now()),
    (v_teacher_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_teacherc_' || v_teacher_c::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Prof', 'last_name', 'Gamma', 'role', 'teacher', 'school_id', v_school_c), now(), now()),
    (v_teacher_inact, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_teacherinact_' || v_teacher_inact::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Prof', 'last_name', 'Inactif', 'role', 'teacher', 'school_id', v_school_a), now(), now()),
    (v_parent_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_parenta_' || v_parent_a::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Parent', 'last_name', 'Alpha', 'role', 'parent', 'school_id', v_school_a), now(), now()),
    (v_parent_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_parentb_' || v_parent_b::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Parent', 'last_name', 'Beta', 'role', 'parent', 'school_id', v_school_b), now(), now()),
    (v_parent_inact, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_parentinact_' || v_parent_inact::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Parent', 'last_name', 'Inactif', 'role', 'parent', 'school_id', v_school_a), now(), now()),
    (v_parent_pending, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_parentpend_' || v_parent_pending::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Parent', 'last_name', 'Pending', 'role', 'parent', 'school_id', v_school_a), now(), now()),
    (v_parent_rejected, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_parentrej_' || v_parent_rejected::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Parent', 'last_name', 'Rejected', 'role', 'parent', 'school_id', v_school_a), now(), now()),
    (v_parent_revoked, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_parentrev_' || v_parent_revoked::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Parent', 'last_name', 'Revoked', 'role', 'parent', 'school_id', v_school_a), now(), now()),
    (v_parent_nofin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_parentnofin_' || v_parent_nofin::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Parent', 'last_name', 'NoFinance', 'role', 'parent', 'school_id', v_school_a), now(), now()),
    (v_student_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'usr_studenta_' || v_student_user_a::text || '@test.com', 'hash', now(), '{"provider":"email"}', jsonb_build_object('first_name', 'Eleve', 'last_name', 'Alpha', 'role', 'student', 'school_id', v_school_a), now(), now());

  -- 2.3 Insertion / UPSERT Profiles
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES 
    (v_super_admin, NULL, 'super_admin', 'Super', 'Admin', true),
    (v_admin_a, v_school_a, 'school_admin', 'Admin', 'Alpha', true),
    (v_agent_a, v_school_a, 'finance_agent', 'Agent', 'FinAlpha', true),
    (v_agent_a_inact, v_school_a, 'finance_agent', 'Agent', 'Inactif', false),
    (v_agent_b, v_school_b, 'finance_agent', 'Agent', 'FinBeta', true),
    (v_agent_susp, v_school_susp, 'finance_agent', 'Agent', 'Susp', true),
    (v_teacher_a, v_school_a, 'teacher', 'Prof', 'Alpha', true),
    (v_teacher_b, v_school_b, 'teacher', 'Prof', 'Beta', true),
    (v_teacher_c, v_school_c, 'teacher', 'Prof', 'Gamma', true),
    (v_teacher_inact, v_school_a, 'teacher', 'Prof', 'Inactif', false),
    (v_parent_a, v_school_a, 'parent', 'Parent', 'Alpha', true),
    (v_parent_b, v_school_b, 'parent', 'Parent', 'Beta', true),
    (v_parent_inact, v_school_a, 'parent', 'Parent', 'Inactif', false),
    (v_parent_pending, v_school_a, 'parent', 'Parent', 'Pending', true),
    (v_parent_rejected, v_school_a, 'parent', 'Parent', 'Rejected', true),
    (v_parent_revoked, v_school_a, 'parent', 'Parent', 'Revoked', true),
    (v_parent_nofin, v_school_a, 'parent', 'Parent', 'NoFinance', true),
    (v_student_user_a, v_school_a, 'student', 'Eleve', 'Alpha', true)
  ON CONFLICT (id) DO UPDATE SET
    school_id = EXCLUDED.school_id,
    role = EXCLUDED.role,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    is_active = EXCLUDED.is_active;

  -- 2.4 Années Scolaires
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES 
    (v_year_a, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_b, v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_c, v_school_c, '2026-2027', '2026-09-01', '2027-06-30', true);

  -- 2.5 Classes
  INSERT INTO public.classes (id, school_id, academic_year_id, name, homeroom_teacher_id, is_active)
  VALUES 
    (v_class_a1, v_school_a, v_year_a, '6ème Primaire A1', v_teacher_a, true),
    (v_class_a2, v_school_a, v_year_a, '6ème Primaire A2', NULL, true),
    (v_class_b, v_school_b, v_year_b, '6ème Primaire B', v_teacher_b, true),
    (v_class_c, v_school_c, v_year_c, '6ème Primaire C', v_teacher_c, true);

  -- 2.6 Élèves
  INSERT INTO public.students (id, school_id, profile_id, student_number, first_name, last_name, middle_name)
  VALUES 
    (v_student_a, v_school_a, v_student_user_a, 'MAT-ALP-001', 'David', 'Alpha', 'Mukubwa'),
    (v_student_b, v_school_b, NULL, 'MAT-BET-001', 'Grace', 'Beta', 'Taty'),
    (v_student_c, v_school_c, NULL, 'MAT-GAM-001', 'Paul', 'Gamma', 'Kabasele');

  -- 2.7 Inscriptions
  INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status, enrolled_on)
  VALUES 
    (v_enroll_a1, v_school_a, v_student_a, v_year_a, v_class_a1, 'active', '2026-09-01'),
    (v_enroll_b, v_school_b, v_student_b, v_year_b, v_class_b, 'active', '2026-09-01'),
    (v_enroll_c, v_school_c, v_student_c, v_year_c, v_class_c, 'active', '2026-09-01');

  -- 2.8 Liens Parents
  INSERT INTO public.parent_student_links (school_id, parent_profile_id, student_id, status, can_view_finances)
  VALUES 
    (v_school_a, v_parent_a, v_student_a, 'approved', true),
    (v_school_b, v_parent_b, v_student_b, 'approved', true),
    (v_school_a, v_parent_inact, v_student_a, 'approved', true),
    (v_school_a, v_parent_pending, v_student_a, 'pending', true),
    (v_school_a, v_parent_rejected, v_student_a, 'rejected', true),
    (v_school_a, v_parent_revoked, v_student_a, 'revoked', true),
    (v_school_a, v_parent_nofin, v_student_a, 'approved', false);

  -- 2.9 Affectations Enseignants
  INSERT INTO public.teacher_class_assignments (school_id, teacher_profile_id, class_id, subject_name, academic_year_id, is_active)
  VALUES 
    (v_school_a, v_teacher_a, v_class_a1, 'Mathématiques', v_year_a, true),
    (v_school_b, v_teacher_b, v_class_b, 'Français', v_year_b, true),
    (v_school_c, v_teacher_c, v_class_c, 'Sciences', v_year_c, true);

  -- 2.10 Catalogue de Frais
  INSERT INTO public.school_fees (id, school_id, academic_year_id, class_id, fee_type, name, amount, currency, due_date, is_active, created_by)
  VALUES 
    (v_fee_usd_cat, v_school_a, v_year_a, v_class_a1, 'minerval', 'Frais Minerval USD', 150.00, 'USD', v_date_due_usd, true, v_admin_a),
    (v_fee_cdf_cat, v_school_a, v_year_a, NULL, 'frais_etat', 'Frais Dossier État CDF', 50000.00, 'CDF', v_date_due_cdf, true, v_admin_a),
    (v_fee_inact, v_school_a, v_year_a, v_class_a1, 'transport', 'Frais Inactif', 80.00, 'USD', v_date_due_usd, false, v_admin_a),
    (v_fee_class_a2, v_school_a, v_year_a, v_class_a2, 'minerval', 'Frais Classe A2 Uniquement', 200.00, 'USD', v_date_due_usd, true, v_admin_a),
    (v_fee_school_b, v_school_b, v_year_b, v_class_b, 'minerval', 'Frais École B', 100.00, 'USD', v_date_due_usd, true, v_agent_b);


  ------------------------------------------------------------------------------
  -- SECTION 3 : REJET DES MUTATIONS DIRECTES PRIVÉES (INSERT, UPDATE, DELETE, TRUNCATE -> 42501)
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 3] Tests de rejet des mutations directes sans privilèges (SQLSTATE 42501)...';

  -- 3.1 Rejet INSERT direct -> exception 42501 attendue
  PERFORM pg_temp.set_auth_context(v_agent_a, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    INSERT INTO public.student_invoices (
      school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number,
      sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by
    ) VALUES (
      v_school_a, v_year_a, v_student_a, v_enroll_a1, v_class_a1, 'INV-HACK-001',
      999, CURRENT_DATE, CURRENT_DATE + 30, 'USD', 100.00, 0.00, 'draft', v_agent_a
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'INSERT direct doit échouer avec 42501.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet INSERT direct');
  v_passed_count := v_passed_count + 1;

  -- 3.2 Rejet UPDATE direct -> exception 42501 attendue et données inchangées
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    UPDATE public.school_fees SET amount = 1.00 WHERE id = v_fee_usd_cat;
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'UPDATE direct sans privilège doit échouer avec 42501.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet UPDATE direct');
  
  SELECT amount INTO v_fee_amount_check FROM public.school_fees WHERE id = v_fee_usd_cat;
  PERFORM pg_temp.assert_equals_numeric(v_fee_amount_check, 150.00, 'Le montant en base doit rester inchangé à 150.00 USD.');
  v_passed_count := v_passed_count + 1;

  -- 3.3 Rejet DELETE direct -> exception 42501 attendue et données inchangées
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    DELETE FROM public.school_fees WHERE id = v_fee_usd_cat;
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'DELETE direct sans privilège doit échouer avec 42501.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet DELETE direct');
  PERFORM pg_temp.assert_true(EXISTS (SELECT 1 FROM public.school_fees WHERE id = v_fee_usd_cat), 'Le frais ne doit pas être supprimé.');
  v_passed_count := v_passed_count + 1;

  -- 3.4 Rejet TRUNCATE direct -> exception 42501 attendue
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    EXECUTE 'TRUNCATE TABLE public.school_fees';
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'TRUNCATE direct sans privilège doit échouer avec 42501.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet TRUNCATE direct');
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- SECTION 4 : REJET DES MUTATIONS RPC POUR ROLES NON FINANCIERS ET ANON
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 4] Tests de rejet des RPCs de mutation pour rôles non autorisés...';

  -- 4.1 Rejet anon sur create_draft_student_invoice
  PERFORM pg_temp.set_auth_context(NULL, 'anon');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', jsonb_build_array(jsonb_build_object('fee_name', 'T', 'fee_type', 'autre', 'unit_price', 10.00, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Anon rejeté sur création facture.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet anon create');
  v_passed_count := v_passed_count + 1;

  -- 4.2 Rejet parent sur create_draft_student_invoice
  PERFORM pg_temp.set_auth_context(v_parent_a, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', jsonb_build_array(jsonb_build_object('fee_name', 'T', 'fee_type', 'autre', 'unit_price', 10.00, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Parent rejeté sur création facture.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet parent create');
  v_passed_count := v_passed_count + 1;

  -- 4.3 Rejet student sur create_draft_student_invoice
  PERFORM pg_temp.set_auth_context(v_student_user_a, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', jsonb_build_array(jsonb_build_object('fee_name', 'T', 'fee_type', 'autre', 'unit_price', 10.00, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Student rejeté sur création facture.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet student create');
  v_passed_count := v_passed_count + 1;

  -- 4.4 Rejet teacher sur create_draft_student_invoice
  PERFORM pg_temp.set_auth_context(v_teacher_a, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', jsonb_build_array(jsonb_build_object('fee_name', 'T', 'fee_type', 'autre', 'unit_price', 10.00, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Teacher rejeté sur création facture.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet teacher create');
  v_passed_count := v_passed_count + 1;

  -- 4.5 Rejet super_admin sans établissement rattaché
  PERFORM pg_temp.set_auth_context(v_super_admin, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', jsonb_build_array(jsonb_build_object('fee_name', 'T', 'fee_type', 'autre', 'unit_price', 10.00, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Super_admin rejeté sur création facture.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet super_admin create');
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- SECTION 5 : VALIDATIONS METIER FACTURATION (create_draft_student_invoice)
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 5] Tests des contrôles de facturation et catalogue serveur...';

  PERFORM pg_temp.set_auth_context(v_agent_a, 'authenticated');

  -- 5.1 Rejet sur frais inactif
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', jsonb_build_array(jsonb_build_object('fee_id', v_fee_inact, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Frais inactif rejeté.');
  PERFORM pg_temp.assert_raises('22023', 'inactif', v_sqlstate, v_errmsg, 'Rejet frais inactif');
  v_passed_count := v_passed_count + 1;

  -- 5.2 Rejet sur frais réservé à la classe A2
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', jsonb_build_array(jsonb_build_object('fee_id', v_fee_class_a2, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Frais classe A2 rejeté pour élève en A1.');
  PERFORM pg_temp.assert_raises('22023', 'restreint à une autre classe', v_sqlstate, v_errmsg, 'Rejet classe A2');
  v_passed_count := v_passed_count + 1;

  -- 5.3 Rejet sur frais d'une autre école (école B)
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', jsonb_build_array(jsonb_build_object('fee_id', v_fee_school_b, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Frais autre école rejeté.');
  PERFORM pg_temp.assert_raises('22023', 'introuvable', v_sqlstate, v_errmsg, 'Rejet frais autre école');
  v_passed_count := v_passed_count + 1;

  -- 5.4 Rejet devise non supportée
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'EUR', jsonb_build_array(jsonb_build_object('fee_name', 'EUR', 'fee_type', 'autre', 'unit_price', 50.00, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Devise EUR rejetée.');
  PERFORM pg_temp.assert_raises('22023', 'Devise non supportée', v_sqlstate, v_errmsg, 'Rejet devise EUR');
  v_passed_count := v_passed_count + 1;

  -- 5.5 Rejet tableau vide
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Tableau vide rejeté.');
  PERFORM pg_temp.assert_raises('22023', 'au moins une ligne', v_sqlstate, v_errmsg, 'Rejet tableau vide');
  v_passed_count := v_passed_count + 1;

  -- 5.6 Rejet quantité nulle
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_usd, 'USD', jsonb_build_array(jsonb_build_object('fee_name', 'T', 'fee_type', 'autre', 'unit_price', 10.00, 'quantity', 0)));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Quantité 0 rejetée.');
  PERFORM pg_temp.assert_raises('22023', 'quantité doit être comprise', v_sqlstate, v_errmsg, 'Rejet quantité 0');
  v_passed_count := v_passed_count + 1;

  -- 5.7 Rejet date échéance antérieure à date émission
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.create_draft_student_invoice(v_student_a, v_year_a, CURRENT_DATE - 5, 'USD', jsonb_build_array(jsonb_build_object('fee_name', 'T', 'fee_type', 'autre', 'unit_price', 10.00, 'quantity', 1)), CURRENT_DATE);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Échéance antérieure rejetée.');
  PERFORM pg_temp.assert_raises('22023', 'ne peut être antérieure', v_sqlstate, v_errmsg, 'Rejet échéance');
  v_passed_count := v_passed_count + 1;

  -- 5.8 Création valide USD avec écrasement serveur du prix catalogue (client envoie 1.00 USD)
  v_test_count := v_test_count + 1;
  v_res := public.create_draft_student_invoice(
    v_student_a, v_year_a, v_date_due_usd, 'USD',
    jsonb_build_array(
      jsonb_build_object('fee_id', v_fee_usd_cat, 'unit_price', 1.00, 'quantity', 1),
      jsonb_build_object('fee_name', 'Carnet Scolaire', 'fee_type', 'autre', 'unit_price', 10.00, 'quantity', 1)
    )
  );
  v_invoice_usd_id := (v_res->>'invoice_id')::UUID;
  v_invoice_usd_num := v_res->>'invoice_number';

  PERFORM pg_temp.assert_equals(v_res->>'status', 'draft', 'Statut = draft');
  PERFORM pg_temp.assert_equals_numeric((v_res->>'total_amount')::numeric, 160.00, 'Total calculé serveur = 160.00 USD (150+10)');
  v_passed_count := v_passed_count + 1;

  -- 5.9 Création d'une seconde facture en CDF pour test multidevise
  v_test_count := v_test_count + 1;
  v_res := public.create_draft_student_invoice(v_student_a, v_year_a, v_date_due_cdf, 'CDF', jsonb_build_array(jsonb_build_object('fee_id', v_fee_cdf_cat, 'quantity', 1)));
  v_invoice_cdf_id := (v_res->>'invoice_id')::UUID;
  PERFORM pg_temp.assert_equals_numeric((v_res->>'total_amount')::numeric, 50000.00, 'Total CDF = 50000.00 CDF');
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- SECTION 6 : TESTS D'EMISSION ET IMMUABILITE (issue_student_invoice)
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 6] Tests de l''émission de facture et étanchéité inter-écoles...';

  -- 6.1 Émission normale draft -> issued
  v_test_count := v_test_count + 1;
  v_res := public.issue_student_invoice(v_invoice_usd_id);
  PERFORM pg_temp.assert_equals(v_res->>'status', 'issued', 'Statut USD = issued');
  PERFORM public.issue_student_invoice(v_invoice_cdf_id);
  v_passed_count := v_passed_count + 1;

  -- 6.2 Rejet de la double émission
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.issue_student_invoice(v_invoice_usd_id);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Double émission rejetée.');
  PERFORM pg_temp.assert_raises('22023', 'draft', v_sqlstate, v_errmsg, 'Rejet double émission');
  v_passed_count := v_passed_count + 1;

  -- 6.3 Rejet d'émission par un agent d'une autre école (école B)
  PERFORM pg_temp.set_auth_context(v_agent_b, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.issue_student_invoice(v_invoice_usd_id);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Agent B ne peut pas émettre une facture de l''école A.');
  PERFORM pg_temp.assert_raises('42501', 'n’appartient pas à votre établissement', v_sqlstate, v_errmsg, 'Rejet émission inter-école');
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- SECTION 7 : REGLEMENT, IDEMPOTENCE ET ANTI-SURPAIEMENT
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 7] Tests de paiement, rejeu idempotent et anti-surpaiement...';

  PERFORM pg_temp.set_auth_context(v_agent_a, 'authenticated');

  -- 7.1 Premier paiement partiel de 100.00 USD (sur 160.00 USD)
  v_test_count := v_test_count + 1;
  v_res := public.record_student_payment(
    v_invoice_usd_id,
    100.00,
    'bank_transfer',
    'IDEMP-SECURE-ALPHA-01',
    v_date_pay1,
    'REF-VIR-001',
    'Parent Alpha',
    'Note interne confidentielle 1'
  );
  v_payment_id1 := (v_res->>'payment_id')::UUID;
  v_receipt_id1 := (v_res->>'receipt_id')::UUID;

  PERFORM pg_temp.assert_equals(v_res->>'is_idempotent_replay', 'false', '1er appel = insertion');
  PERFORM pg_temp.assert_equals(v_res->>'invoice_status', 'partially_paid', 'Statut facture = partially_paid');
  PERFORM pg_temp.assert_equals_numeric((v_res->>'balance_after_payment')::numeric, 60.00, 'Solde restant = 60.00 USD');
  v_passed_count := v_passed_count + 1;

  -- 7.2 Rejeu idempotent rigoureusement identique
  v_test_count := v_test_count + 1;
  v_res := public.record_student_payment(
    v_invoice_usd_id,
    100.00,
    'bank_transfer',
    'IDEMP-SECURE-ALPHA-01',
    v_date_pay1,
    'REF-VIR-001',
    'Parent Alpha',
    'Note interne confidentielle 1'
  );
  PERFORM pg_temp.assert_equals(v_res->>'is_idempotent_replay', 'true', '2e appel identique = rejeu');
  PERFORM pg_temp.assert_equals((v_res->>'payment_id')::text, v_payment_id1::text, 'Même ID de paiement retourné');
  v_passed_count := v_passed_count + 1;

  -- 7.3 Rejet d'idempotence sur divergence de paramètre (montant altéré)
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.record_student_payment(
      v_invoice_usd_id,
      50.00,
      'bank_transfer',
      'IDEMP-SECURE-ALPHA-01',
      v_date_pay1,
      'REF-VIR-001',
      'Parent Alpha',
      'Note interne confidentielle 1'
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Clé avec montant différent rejetée.');
  PERFORM pg_temp.assert_raises('23505', NULL, v_sqlstate, v_errmsg, 'Rejet divergence montant');
  v_passed_count := v_passed_count + 1;

  -- 7.4 Rejet sur surpaiement (solde restant = 60.00 USD, tentative 100.00 USD)
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.record_student_payment(v_invoice_usd_id, 100.00, 'cash', 'IDEMP-OVERPAY-01', v_date_pay2);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Surpaiement rejeté.');
  PERFORM pg_temp.assert_raises('22023', 'dépasse le solde', v_sqlstate, v_errmsg, 'Rejet surpaiement');
  v_passed_count := v_passed_count + 1;

  -- 7.5 Paiement du solde final exact de 60.00 USD -> Statut 'paid'
  v_test_count := v_test_count + 1;
  v_res := public.record_student_payment(v_invoice_usd_id, 60.00, 'cash', 'IDEMP-FINAL-01', v_date_pay2);
  v_payment_id2 := (v_res->>'payment_id')::UUID;
  PERFORM pg_temp.assert_equals(v_res->>'invoice_status', 'paid', 'Facture payée = paid');
  PERFORM pg_temp.assert_equals_numeric((v_res->>'balance_after_payment')::numeric, 0.00, 'Solde final = 0.00 USD');
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- SECTION 8 : ANNULATION ATOMIQUE ET REJEU CANCELLED (cancel_student_payment)
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 8] Tests d''annulation de paiement et rejeu cancelled...';

  PERFORM pg_temp.set_auth_context(v_agent_a, 'authenticated');

  -- 8.1 Rejet si motif vide ou trop court
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.cancel_student_payment(v_payment_id1, '  ');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Annulation sans motif rejetée.');
  PERFORM pg_temp.assert_raises('22023', 'motif explicite', v_sqlstate, v_errmsg, 'Rejet motif vide');
  v_passed_count := v_passed_count + 1;

  -- 8.2 Annulation valide du paiement de 100.00 USD
  v_test_count := v_test_count + 1;
  v_cancel_res := public.cancel_student_payment(v_payment_id1, 'Erreur de caisse');
  PERFORM pg_temp.assert_equals(v_cancel_res->>'new_invoice_status', 'partially_paid', 'Facture repasse en partially_paid');
  PERFORM pg_temp.assert_equals_numeric((v_cancel_res->>'remaining_balance')::numeric, 100.00, 'Nouveau solde = 100.00 USD');
  v_passed_count := v_passed_count + 1;

  -- 8.3 Rejet de la double annulation
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.cancel_student_payment(v_payment_id1, 'Seconde tentative');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Double annulation rejetée.');
  PERFORM pg_temp.assert_raises('22023', 'déjà annulé', v_sqlstate, v_errmsg, 'Rejet double annulation');
  v_passed_count := v_passed_count + 1;

  -- 8.4 Rejeu idempotent d'un paiement annulé -> status = 'cancelled' et is_cancelled = true
  v_test_count := v_test_count + 1;
  v_res := public.record_student_payment(
    v_invoice_usd_id,
    100.00,
    'bank_transfer',
    'IDEMP-SECURE-ALPHA-01',
    v_date_pay1,
    'REF-VIR-001',
    'Parent Alpha',
    'Note interne confidentielle 1'
  );
  PERFORM pg_temp.assert_equals(v_res->>'is_idempotent_replay', 'true', 'Rejeu détecté');
  PERFORM pg_temp.assert_equals(v_res->>'status', 'cancelled', 'Statut rejoué = cancelled');
  PERFORM pg_temp.assert_equals(v_res->>'is_cancelled', 'true', 'Flag is_cancelled = true');
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- SECTION 9 : TESTS DES STATUTS PARENTAUX ET SYNTHESE MULTIDEVISE
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 9] Tests de consultation parent (approved, pending, rejected, revoked, inactif)...';

  -- 9.1 Consultation autorisée pour Parent A
  PERFORM pg_temp.set_auth_context(v_parent_a, 'authenticated');
  v_test_count := v_test_count + 1;
  v_parent_res := public.get_parent_student_finances(v_student_a);
  PERFORM pg_temp.assert_equals(v_parent_res->'summary_by_currency'->'USD'->>'total_invoiced', '160.00', 'Synthèse USD parent');
  PERFORM pg_temp.assert_equals(v_parent_res->'summary_by_currency'->'CDF'->>'total_invoiced', '50000.00', 'Synthèse CDF parent');
  PERFORM pg_temp.assert_false(v_parent_res::text LIKE '%Note interne confidentielle%', 'Note interne masquée');
  v_passed_count := v_passed_count + 1;

  -- 9.2 Rejet si can_view_finances = false
  PERFORM pg_temp.set_auth_context(v_parent_nofin, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.get_parent_student_finances(v_student_a);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'can_view_finances = false rejeté.');
  PERFORM pg_temp.assert_raises('42501', 'pas autorisée', v_sqlstate, v_errmsg, 'Rejet can_view_finances false');
  v_passed_count := v_passed_count + 1;

  -- 9.3 Rejet si statut lien = pending
  PERFORM pg_temp.set_auth_context(v_parent_pending, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.get_parent_student_finances(v_student_a);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Lien pending rejeté.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet lien pending');
  v_passed_count := v_passed_count + 1;

  -- 9.4 Rejet si statut lien = rejected
  PERFORM pg_temp.set_auth_context(v_parent_rejected, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.get_parent_student_finances(v_student_a);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Lien rejected rejeté.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet lien rejected');
  v_passed_count := v_passed_count + 1;

  -- 9.5 Rejet si statut lien = revoked
  PERFORM pg_temp.set_auth_context(v_parent_revoked, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.get_parent_student_finances(v_student_a);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Lien revoked rejeté.');
  PERFORM pg_temp.assert_raises('42501', NULL, v_sqlstate, v_errmsg, 'Rejet lien revoked');
  v_passed_count := v_passed_count + 1;

  -- 9.6 Rejet si profil parent inactif
  PERFORM pg_temp.set_auth_context(v_parent_inact, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.get_parent_student_finances(v_student_a);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Parent inactif rejeté.');
  PERFORM pg_temp.assert_raises('42501', 'actif', v_sqlstate, v_errmsg, 'Rejet parent inactif');
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- SECTION 10 : TESTS DE LA CONSULTATION ENSEIGNANT (TOUS CAS DE DRAPEAUX)
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 10] Tests de consultation enseignant (drapeaux, montants et restrictions)...';

  -- 10.1 Classe A1 : allow_teacher_finance_view = true, allow_teacher_finance_amounts = true
  PERFORM pg_temp.set_auth_context(v_teacher_a, 'authenticated');
  v_test_count := v_test_count + 1;
  v_teacher_res := public.get_teacher_class_finance_overview(v_class_a1);
  PERFORM pg_temp.assert_equals(v_teacher_res->>'allowed', 'true', 'Enseignant A autorisé classe A1');
  PERFORM pg_temp.assert_equals(v_teacher_res->>'amounts_included', 'true', 'Montants inclus');
  v_passed_count := v_passed_count + 1;

  -- 10.2 Classe B : allow_teacher_finance_view = true, allow_teacher_finance_amounts = false (qualitatif pur)
  PERFORM pg_temp.set_auth_context(v_teacher_b, 'authenticated');
  v_test_count := v_test_count + 1;
  v_teacher_res := public.get_teacher_class_finance_overview(v_class_b);
  PERFORM pg_temp.assert_equals(v_teacher_res->>'allowed', 'true', 'Enseignant B autorisé classe B');
  PERFORM pg_temp.assert_equals(v_teacher_res->>'amounts_included', 'false', 'Montants NON inclus');
  PERFORM pg_temp.assert_false(v_teacher_res::text LIKE '%currencies%', 'Aucun montant ni devise en mode qualitatif');
  v_passed_count := v_passed_count + 1;

  -- 10.3 Classe C : allow_teacher_finance_view = false (sur école C active et enseignant C affecté)
  PERFORM pg_temp.set_auth_context(v_teacher_c, 'authenticated');
  v_test_count := v_test_count + 1;
  v_teacher_res := public.get_teacher_class_finance_overview(v_class_c);
  PERFORM pg_temp.assert_equals(v_teacher_res->>'allowed', 'false', 'allow_teacher_finance_view = false retourne allowed = false');
  PERFORM pg_temp.assert_true(v_teacher_res->'students' = '[]'::jsonb, 'Liste élèves vide quand consultation désactivée');
  v_passed_count := v_passed_count + 1;

  -- 10.4 Rejet classe non affectée
  PERFORM pg_temp.set_auth_context(v_teacher_a, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.get_teacher_class_finance_overview(v_class_a2);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Classe non affectée rejetée.');
  PERFORM pg_temp.assert_raises('42501', 'affecté', v_sqlstate, v_errmsg, 'Rejet classe non affectée');
  v_passed_count := v_passed_count + 1;

  -- 10.5 Rejet enseignant inactif
  PERFORM pg_temp.set_auth_context(v_teacher_inact, 'authenticated');
  v_test_count := v_test_count + 1;
  v_caught := false;
  BEGIN
    PERFORM public.get_teacher_class_finance_overview(v_class_a1);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.assert_true(v_caught, 'Enseignant inactif rejeté.');
  PERFORM pg_temp.assert_raises('42501', 'actif', v_sqlstate, v_errmsg, 'Rejet enseignant inactif');
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- SECTION 11 : DOSSIER FINANCIER ADMINISTRATIF COMPLET
  ------------------------------------------------------------------------------
  RAISE NOTICE '[SECTION 11] Tests du dossier administratif complet...';

  PERFORM pg_temp.set_auth_context(v_agent_a, 'authenticated');
  v_test_count := v_test_count + 1;
  v_admin_res := public.get_student_finance_dossier_admin(v_student_a, v_year_a);
  PERFORM pg_temp.assert_true(v_admin_res->'summary_by_currency'->'USD' IS NOT NULL, 'Synthèse USD présente');
  PERFORM pg_temp.assert_true(v_admin_res->'summary_by_currency'->'CDF' IS NOT NULL, 'Synthèse CDF présente');
  PERFORM pg_temp.assert_true(v_admin_res->'payments' IS NOT NULL, 'Historique des paiements présent');
  v_passed_count := v_passed_count + 1;


  ------------------------------------------------------------------------------
  -- RAPPORT FINAL DU RUNNER DYNAMIQUE
  ------------------------------------------------------------------------------
  IF v_passed_count <> v_test_count THEN
    RAISE EXCEPTION 'TEST RUNNER ECHOUE : % / % tests passés.', v_passed_count, v_test_count
      USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE '======================================================================';
  RAISE NOTICE 'AUDIT VALIDE AVEC SUCCES : % / % SCENARIOS REUSSIS.', v_passed_count, v_test_count;
  RAISE NOTICE '======================================================================';
END $$;

--------------------------------------------------------------------------------
-- 3. ANNULATION SYSTEMATIQUE DE TOUTES LES MODIFICATIONS (BASE INTACTE A 100%)
--------------------------------------------------------------------------------
ROLLBACK;
