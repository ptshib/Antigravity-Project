-- ============================================================================
-- TESTS AUTOMATISÉS : Rétablissement de la Lecture Sécurisée Profiles & Schools
-- Fichier : supabase/tests/20260820130000_profile_school_read_tests.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. VÉRIFICATION DES PRIVILÈGES EFFECTIFS VIA HAS_TABLE_PRIVILEGE
--------------------------------------------------------------------------------

DO $$
BEGIN
  -- A. Vérification de l'absence totale des 7 privilèges pour anon
  IF has_table_privilege('anon', 'public.profiles', 'SELECT') OR
     has_table_privilege('anon', 'public.profiles', 'INSERT') OR
     has_table_privilege('anon', 'public.profiles', 'UPDATE') OR
     has_table_privilege('anon', 'public.profiles', 'DELETE') OR
     has_table_privilege('anon', 'public.profiles', 'TRUNCATE') OR
     has_table_privilege('anon', 'public.profiles', 'REFERENCES') OR
     has_table_privilege('anon', 'public.profiles', 'TRIGGER') OR
     has_table_privilege('anon', 'public.schools', 'SELECT') OR
     has_table_privilege('anon', 'public.schools', 'INSERT') OR
     has_table_privilege('anon', 'public.schools', 'UPDATE') OR
     has_table_privilege('anon', 'public.schools', 'DELETE') OR
     has_table_privilege('anon', 'public.schools', 'TRUNCATE') OR
     has_table_privilege('anon', 'public.schools', 'REFERENCES') OR
     has_table_privilege('anon', 'public.schools', 'TRIGGER') THEN
    RAISE EXCEPTION 'ÉCHEC TEST PRIVILÈGES : Le rôle anon possède un privilège non autorisé sur profiles ou schools.';
  END IF;

  -- B. Vérification que authenticated possède SELECT et AUCUN des 6 autres privilèges
  IF NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT') OR
     NOT has_table_privilege('authenticated', 'public.schools', 'SELECT') OR
     has_table_privilege('authenticated', 'public.profiles', 'INSERT') OR
     has_table_privilege('authenticated', 'public.profiles', 'UPDATE') OR
     has_table_privilege('authenticated', 'public.profiles', 'DELETE') OR
     has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE') OR
     has_table_privilege('authenticated', 'public.profiles', 'REFERENCES') OR
     has_table_privilege('authenticated', 'public.profiles', 'TRIGGER') OR
     has_table_privilege('authenticated', 'public.schools', 'INSERT') OR
     has_table_privilege('authenticated', 'public.schools', 'UPDATE') OR
     has_table_privilege('authenticated', 'public.schools', 'DELETE') OR
     has_table_privilege('authenticated', 'public.schools', 'TRUNCATE') OR
     has_table_privilege('authenticated', 'public.schools', 'REFERENCES') OR
     has_table_privilege('authenticated', 'public.schools', 'TRIGGER') THEN
    RAISE EXCEPTION 'ÉCHEC TEST PRIVILÈGES : Le rôle authenticated doit posséder SELECT uniquement sur profiles et schools.';
  END IF;
END $$;


--------------------------------------------------------------------------------
-- 2. PRÉPARATION D'UNE DEUXIÈME ÉCOLE DE TEST ISOLÉE
--------------------------------------------------------------------------------

INSERT INTO public.schools (
  id, name, slug, status, country, timezone
) VALUES (
  'a1000000-0000-4000-a000-000000000002'::uuid,
  'École Test Isolation',
  'ecole-test-isolation',
  'active',
  'RD Congo',
  'Africa/Kinshasa'
);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
  created_at, updated_at
) VALUES (
  'a5000000-0000-4000-a000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'agent.autre_ecole@ecoleconnect.test',
  extensions.crypt('FinanceLocal2026!', extensions.gen_salt('bf')),
  now(),
  '', '', '', '',
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Agent2","last_name":"AutreEcole","role":"finance_agent"}'::jsonb,
  false, false, false,
  now(), now()
);

INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
VALUES (
  'a5000000-0000-4000-a000-000000000002'::uuid,
  'a1000000-0000-4000-a000-000000000002'::uuid,
  'finance_agent',
  'Agent2',
  'AutreEcole',
  true
);


--------------------------------------------------------------------------------
-- 3. TEST A : RÔLE ANON - REJET TOTAL DE LECTURE ET DE TRUNCATE (SQLSTATE 42501)
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_err_sqlstate TEXT;
  v_rec RECORD;
BEGIN
  SET LOCAL ROLE anon;

  -- 1. Rejet SELECT profiles
  v_err_sqlstate := '';
  BEGIN
    SELECT * INTO v_rec FROM public.profiles LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_err_sqlstate := SQLSTATE;
  END;

  IF v_err_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'ÉCHEC TEST ANON : SELECT profiles doit échouer avec SQLSTATE 42501 (reçu: %).', v_err_sqlstate;
  END IF;

  -- 2. Rejet SELECT schools
  v_err_sqlstate := '';
  BEGIN
    SELECT * INTO v_rec FROM public.schools LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_err_sqlstate := SQLSTATE;
  END;

  IF v_err_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'ÉCHEC TEST ANON : SELECT schools doit échouer avec SQLSTATE 42501 (reçu: %).', v_err_sqlstate;
  END IF;

  -- 3. Rejet TRUNCATE profiles sous anon (SQLSTATE 42501)
  v_err_sqlstate := '';
  BEGIN
    EXECUTE 'TRUNCATE TABLE public.profiles';
  EXCEPTION WHEN OTHERS THEN
    v_err_sqlstate := SQLSTATE;
  END;

  IF v_err_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'ÉCHEC TEST ANON : TRUNCATE profiles doit échouer avec SQLSTATE 42501 (reçu: %).', v_err_sqlstate;
  END IF;

  -- 4. Rejet TRUNCATE schools sous anon (SQLSTATE 42501)
  v_err_sqlstate := '';
  BEGIN
    EXECUTE 'TRUNCATE TABLE public.schools';
  EXCEPTION WHEN OTHERS THEN
    v_err_sqlstate := SQLSTATE;
  END;

  IF v_err_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'ÉCHEC TEST ANON : TRUNCATE schools doit échouer avec SQLSTATE 42501 (reçu: %).', v_err_sqlstate;
  END IF;

  RESET ROLE;
END $$;


--------------------------------------------------------------------------------
-- 4. TEST B : SIMULATION AGENT FINANCIER (AUTHENTICATED) - LECTURE PROPRE PROFIL & ÉCOLE
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_prof_count INTEGER;
  v_school_count INTEGER;
  v_my_prof_id UUID;
  v_my_school_id UUID;
BEGIN
  -- Simulation du contexte JWT de finance_agent (a5000000-0000-4000-a000-000000000001)
  PERFORM set_config('request.jwt.claim.sub', 'a5000000-0000-4000-a000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 1. Lecture réussie de son propre profil
  SELECT id, school_id INTO v_my_prof_id, v_my_school_id
  FROM public.profiles
  WHERE id = 'a5000000-0000-4000-a000-000000000001'::uuid;

  IF v_my_prof_id IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC TEST : L''agent financier doit pouvoir lire son propre profil.';
  END IF;

  -- 2. Isolement RLS : L'agent ne doit voir QUE les profils de son propre établissement
  SELECT COUNT(*) INTO v_prof_count FROM public.profiles;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE school_id = 'a1000000-0000-4000-a000-000000000002'::uuid
  ) THEN
    RAISE EXCEPTION 'ÉCHEC TEST ISOLATION RLS : L''agent financier peut voir le profil d''une autre école !';
  END IF;

  -- 3. Lecture réussie de son école
  SELECT COUNT(*) INTO v_school_count FROM public.schools;

  IF v_school_count <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC TEST ISOLATION RLS : Attendu exactement 1 école visible, obtenu %.', v_school_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.schools WHERE id = 'a1000000-0000-4000-a000-000000000002'::uuid
  ) THEN
    RAISE EXCEPTION 'ÉCHEC TEST ISOLATION RLS : L''agent financier peut voir l''école d''un autre établissement !';
  END IF;

  RESET ROLE;
END $$;


--------------------------------------------------------------------------------
-- 5. TEST C : MUTATION ET TRUNCATE PAR AUTHENTICATED - REJET SQLSTATE 42501
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_err_sqlstate TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a5000000-0000-4000-a000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 1. Rejet INSERT profiles (SQLSTATE 42501)
  v_err_sqlstate := '';
  BEGIN
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name)
    VALUES (gen_random_uuid(), 'a1000000-0000-4000-a000-000000000001'::uuid, 'student', 'Hacker', 'Test');
  EXCEPTION WHEN OTHERS THEN
    v_err_sqlstate := SQLSTATE;
  END;

  IF v_err_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'ÉCHEC TEST AUTHENTICATED : INSERT profiles doit échouer avec SQLSTATE 42501 (reçu: %).', v_err_sqlstate;
  END IF;

  -- 2. Rejet UPDATE profiles (SQLSTATE 42501)
  v_err_sqlstate := '';
  BEGIN
    UPDATE public.profiles SET first_name = 'Modif' WHERE id = 'a5000000-0000-4000-a000-000000000001'::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_err_sqlstate := SQLSTATE;
  END;

  IF v_err_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'ÉCHEC TEST AUTHENTICATED : UPDATE profiles doit échouer avec SQLSTATE 42501 (reçu: %).', v_err_sqlstate;
  END IF;

  -- 3. Rejet DELETE profiles (SQLSTATE 42501)
  v_err_sqlstate := '';
  BEGIN
    DELETE FROM public.profiles WHERE id = 'a5000000-0000-4000-a000-000000000001'::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_err_sqlstate := SQLSTATE;
  END;

  IF v_err_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'ÉCHEC TEST AUTHENTICATED : DELETE profiles doit échouer avec SQLSTATE 42501 (reçu: %).', v_err_sqlstate;
  END IF;

  -- 4. Rejet TRUNCATE profiles sous authenticated (SQLSTATE 42501)
  v_err_sqlstate := '';
  BEGIN
    EXECUTE 'TRUNCATE TABLE public.profiles';
  EXCEPTION WHEN OTHERS THEN
    v_err_sqlstate := SQLSTATE;
  END;

  IF v_err_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'ÉCHEC TEST AUTHENTICATED : TRUNCATE profiles doit échouer avec SQLSTATE 42501 (reçu: %).', v_err_sqlstate;
  END IF;

  -- 5. Rejet TRUNCATE schools sous authenticated (SQLSTATE 42501)
  v_err_sqlstate := '';
  BEGIN
    EXECUTE 'TRUNCATE TABLE public.schools';
  EXCEPTION WHEN OTHERS THEN
    v_err_sqlstate := SQLSTATE;
  END;

  IF v_err_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'ÉCHEC TEST AUTHENTICATED : TRUNCATE schools doit échouer avec SQLSTATE 42501 (reçu: %).', v_err_sqlstate;
  END IF;

  RESET ROLE;
END $$;

ROLLBACK;
