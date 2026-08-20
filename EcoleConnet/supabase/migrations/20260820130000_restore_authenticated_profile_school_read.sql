-- ============================================================================
-- Migration : Rétablissement du Privilège SELECT sur Profiles & Schools
-- Fichier   : supabase/migrations/20260820130000_restore_authenticated_profile_school_read.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. NETTOYAGE STRICT ET OCTROI DES PRIVILÈGES MINIMAUX EXCLUSIFS POUR AUTHENTICATED
--------------------------------------------------------------------------------

-- Récurage des privilèges résiduels sur profiles et schools
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.schools FROM anon, authenticated;

-- Octroi STRICT ET UNIQUE du droit de lecture (SELECT) au rôle authenticated
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.schools TO authenticated;

-- Octroi STRICT du droit d'exécution (EXECUTE) sur les fonctions helper de sécurité RLS
GRANT EXECUTE ON FUNCTION public.get_auth_school_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_role() TO authenticated;

-- Révocation de l'accès EXECUTE pour anon et PUBLIC
REVOKE EXECUTE ON FUNCTION public.get_auth_school_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_auth_role() FROM anon, PUBLIC;


--------------------------------------------------------------------------------
-- 2. ASSERTIONS FAIL-FAST POST-GRANT/REVOKE
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- A. Authenticated possède SELECT sur public.profiles
  IF NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Le rôle authenticated doit posséder le privilège SELECT sur public.profiles.';
  END IF;

  -- B. Authenticated possède SELECT sur public.schools
  IF NOT has_table_privilege('authenticated', 'public.schools', 'SELECT') THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Le rôle authenticated doit posséder le privilège SELECT sur public.schools.';
  END IF;

  -- C. Anon ne possède aucun privilège (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) sur public.profiles et public.schools
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
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Le rôle anon ne doit posséder aucun privilège sur profiles ou schools.';
  END IF;

  -- D. Authenticated ne possède aucun privilège de mutation (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)
  IF has_table_privilege('authenticated', 'public.profiles', 'INSERT') OR
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
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Le rôle authenticated ne doit posséder aucun privilège autre que SELECT sur profiles et schools.';
  END IF;

  -- E. Vérification que RLS est activée sur public.profiles et public.schools
  SELECT count(*) INTO v_count
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace
    AND relname IN ('profiles', 'schools')
    AND relrowsecurity = true;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : RLS doit être activée sur public.profiles et public.schools.';
  END IF;

  -- F. Vérification des politiques SELECT existantes
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.profiles'::regclass
      AND polcmd = 'r'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.schools'::regclass
      AND polcmd = 'r'
  ) THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Les politiques RLS SELECT sur profiles et schools doivent être présentes.';
  END IF;

  -- G. Authenticated possède EXECUTE sur get_auth_school_id et get_auth_role
  IF NOT has_function_privilege('authenticated', 'public.get_auth_school_id()', 'EXECUTE') OR
     NOT has_function_privilege('authenticated', 'public.get_auth_role()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Le rôle authenticated doit posséder EXECUTE sur public.get_auth_school_id() et public.get_auth_role().';
  END IF;

  -- H. Anon ne possède pas EXECUTE sur get_auth_school_id et get_auth_role
  IF has_function_privilege('anon', 'public.get_auth_school_id()', 'EXECUTE') OR
     has_function_privilege('anon', 'public.get_auth_role()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Le rôle anon ne doit pas posséder EXECUTE sur public.get_auth_school_id() ou public.get_auth_role().';
  END IF;
END $$;

COMMIT;
