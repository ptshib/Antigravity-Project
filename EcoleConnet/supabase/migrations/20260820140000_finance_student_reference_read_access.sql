-- ============================================================================
-- Migration : Accès Minimal en Lecture aux Références Élèves pour le Module Finance
-- Fichier   : supabase/migrations/20260820140000_finance_student_reference_read_access.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. NETTOYAGE STRICT DES PRIVILÈGES SUR STUDENTS, CLASSES ET ENROLLMENTS
--------------------------------------------------------------------------------

REVOKE ALL PRIVILEGES ON TABLE public.students FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.classes FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.student_enrollments FROM anon, authenticated;


--------------------------------------------------------------------------------
-- 2. OCTROI STRICT DES GRANTS MINIMAUX PAR COLONNE POUR AUTHENTICATED
--------------------------------------------------------------------------------

-- public.students : Identité minimale nécessaire à la facturation (exclusion stricte des données sensibles)
GRANT SELECT (id, school_id, student_number, first_name, middle_name, last_name) ON TABLE public.students TO authenticated;

-- public.classes : Références de classe indispensables au ciblage tarifaire et au dossier
GRANT SELECT (id, school_id, academic_year_id, name) ON TABLE public.classes TO authenticated;

-- public.student_enrollments : Inscriptions requises pour joindre la classe de l'élève à sa facture
GRANT SELECT (id, school_id, student_id, academic_year_id, class_id, status) ON TABLE public.student_enrollments TO authenticated;


--------------------------------------------------------------------------------
-- 3. POLITIQUES RLS DÉDIÉES À FINANCE_AGENT
--------------------------------------------------------------------------------

-- A. Lecture des fiches élèves de son propre établissement pour l'Agent Financier
DROP POLICY IF EXISTS "FinanceAgent read school student references" ON public.students;
CREATE POLICY "FinanceAgent read school student references"
  ON public.students FOR SELECT TO authenticated
  USING (
    public.get_auth_role() = 'finance_agent' AND
    school_id = public.get_auth_school_id() AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.school_id = public.students.school_id
        AND p.role = 'finance_agent'
        AND p.is_active = true
    )
  );

-- B. Lecture des inscriptions d'élèves de son propre établissement pour l'Agent Financier
DROP POLICY IF EXISTS "FinanceAgent read school enrollments" ON public.student_enrollments;
CREATE POLICY "FinanceAgent read school enrollments"
  ON public.student_enrollments FOR SELECT TO authenticated
  USING (
    public.get_auth_role() = 'finance_agent' AND
    school_id = public.get_auth_school_id() AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.school_id = public.student_enrollments.school_id
        AND p.role = 'finance_agent'
        AND p.is_active = true
    )
  );


--------------------------------------------------------------------------------
-- 4. ASSERTIONS FAIL-FAST POST-MIGRATION DYNAMIQUES
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_invalid_cols TEXT[];
  v_missing_cols TEXT[];
  v_policy_expr TEXT;
  v_count INTEGER;
BEGIN
  -- A. Anon ne possède aucun privilège sur les trois tables
  IF has_table_privilege('anon', 'public.students', 'SELECT') OR
     has_table_privilege('anon', 'public.students', 'INSERT') OR
     has_table_privilege('anon', 'public.students', 'UPDATE') OR
     has_table_privilege('anon', 'public.students', 'DELETE') OR
     has_table_privilege('anon', 'public.students', 'TRUNCATE') OR
     has_table_privilege('anon', 'public.students', 'REFERENCES') OR
     has_table_privilege('anon', 'public.students', 'TRIGGER') OR
     has_table_privilege('anon', 'public.classes', 'SELECT') OR
     has_table_privilege('anon', 'public.classes', 'INSERT') OR
     has_table_privilege('anon', 'public.classes', 'UPDATE') OR
     has_table_privilege('anon', 'public.classes', 'DELETE') OR
     has_table_privilege('anon', 'public.classes', 'TRUNCATE') OR
     has_table_privilege('anon', 'public.classes', 'REFERENCES') OR
     has_table_privilege('anon', 'public.classes', 'TRIGGER') OR
     has_table_privilege('anon', 'public.student_enrollments', 'SELECT') OR
     has_table_privilege('anon', 'public.student_enrollments', 'INSERT') OR
     has_table_privilege('anon', 'public.student_enrollments', 'UPDATE') OR
     has_table_privilege('anon', 'public.student_enrollments', 'DELETE') OR
     has_table_privilege('anon', 'public.student_enrollments', 'TRUNCATE') OR
     has_table_privilege('anon', 'public.student_enrollments', 'REFERENCES') OR
     has_table_privilege('anon', 'public.student_enrollments', 'TRIGGER') THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Le rôle anon ne doit posséder aucun privilège sur students, classes ou student_enrollments.';
  END IF;

  -- B. Authenticated ne possède aucun privilège de mutation, TRUNCATE, REFERENCES ou TRIGGER
  IF has_table_privilege('authenticated', 'public.students', 'INSERT') OR
     has_table_privilege('authenticated', 'public.students', 'UPDATE') OR
     has_table_privilege('authenticated', 'public.students', 'DELETE') OR
     has_table_privilege('authenticated', 'public.students', 'TRUNCATE') OR
     has_table_privilege('authenticated', 'public.students', 'REFERENCES') OR
     has_table_privilege('authenticated', 'public.students', 'TRIGGER') OR
     has_table_privilege('authenticated', 'public.classes', 'INSERT') OR
     has_table_privilege('authenticated', 'public.classes', 'UPDATE') OR
     has_table_privilege('authenticated', 'public.classes', 'DELETE') OR
     has_table_privilege('authenticated', 'public.classes', 'TRUNCATE') OR
     has_table_privilege('authenticated', 'public.classes', 'REFERENCES') OR
     has_table_privilege('authenticated', 'public.classes', 'TRIGGER') OR
     has_table_privilege('authenticated', 'public.student_enrollments', 'INSERT') OR
     has_table_privilege('authenticated', 'public.student_enrollments', 'UPDATE') OR
     has_table_privilege('authenticated', 'public.student_enrollments', 'DELETE') OR
     has_table_privilege('authenticated', 'public.student_enrollments', 'TRUNCATE') OR
     has_table_privilege('authenticated', 'public.student_enrollments', 'REFERENCES') OR
     has_table_privilege('authenticated', 'public.student_enrollments', 'TRIGGER') THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Le rôle authenticated ne doit posséder aucun privilège de mutation, TRUNCATE, REFERENCES ou TRIGGER.';
  END IF;

  -- C. Contrôle dynamique par liste blanche des colonnes de public.students
  SELECT ARRAY_AGG(column_name) INTO v_missing_cols
  FROM (
    SELECT unnest(ARRAY['id', 'school_id', 'student_number', 'first_name', 'middle_name', 'last_name']) AS column_name
  ) w
  WHERE NOT has_column_privilege('authenticated', 'public.students', w.column_name, 'SELECT');

  IF v_missing_cols IS NOT NULL AND array_length(v_missing_cols, 1) > 0 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Colonnes manquantes en SELECT pour authenticated sur students: %', v_missing_cols;
  END IF;

  SELECT ARRAY_AGG(c.column_name) INTO v_invalid_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'students'
    AND c.column_name NOT IN ('id', 'school_id', 'student_number', 'first_name', 'middle_name', 'last_name')
    AND has_column_privilege('authenticated', 'public.students', c.column_name, 'SELECT');

  IF v_invalid_cols IS NOT NULL AND array_length(v_invalid_cols, 1) > 0 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Authenticated possède des droits SELECT non autorisés sur des colonnes de students: %', v_invalid_cols;
  END IF;

  -- D. Contrôle dynamique par liste blanche des colonnes de public.classes
  SELECT ARRAY_AGG(column_name) INTO v_missing_cols
  FROM (
    SELECT unnest(ARRAY['id', 'school_id', 'academic_year_id', 'name']) AS column_name
  ) w
  WHERE NOT has_column_privilege('authenticated', 'public.classes', w.column_name, 'SELECT');

  IF v_missing_cols IS NOT NULL AND array_length(v_missing_cols, 1) > 0 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Colonnes manquantes en SELECT pour authenticated sur classes: %', v_missing_cols;
  END IF;

  SELECT ARRAY_AGG(c.column_name) INTO v_invalid_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'classes'
    AND c.column_name NOT IN ('id', 'school_id', 'academic_year_id', 'name')
    AND has_column_privilege('authenticated', 'public.classes', c.column_name, 'SELECT');

  IF v_invalid_cols IS NOT NULL AND array_length(v_invalid_cols, 1) > 0 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Authenticated possède des droits SELECT non autorisés sur des colonnes de classes: %', v_invalid_cols;
  END IF;

  -- E. Contrôle dynamique par liste blanche des colonnes de public.student_enrollments
  SELECT ARRAY_AGG(column_name) INTO v_missing_cols
  FROM (
    SELECT unnest(ARRAY['id', 'school_id', 'student_id', 'academic_year_id', 'class_id', 'status']) AS column_name
  ) w
  WHERE NOT has_column_privilege('authenticated', 'public.student_enrollments', w.column_name, 'SELECT');

  IF v_missing_cols IS NOT NULL AND array_length(v_missing_cols, 1) > 0 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Colonnes manquantes en SELECT pour authenticated sur student_enrollments: %', v_missing_cols;
  END IF;

  SELECT ARRAY_AGG(c.column_name) INTO v_invalid_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'student_enrollments'
    AND c.column_name NOT IN ('id', 'school_id', 'student_id', 'academic_year_id', 'class_id', 'status')
    AND has_column_privilege('authenticated', 'public.student_enrollments', c.column_name, 'SELECT');

  IF v_invalid_cols IS NOT NULL AND array_length(v_invalid_cols, 1) > 0 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Authenticated possède des droits SELECT non autorisés sur des colonnes de student_enrollments: %', v_invalid_cols;
  END IF;

  -- F. RLS activée sur les trois tables
  SELECT COUNT(*) INTO v_count
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace
    AND relname IN ('students', 'classes', 'student_enrollments')
    AND relrowsecurity = true;

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : RLS doit être activée sur students, classes et student_enrollments.';
  END IF;

  -- G. Vérification dans le catalogue des expressions des politiques RLS FinanceAgent
  SELECT pg_get_expr(polqual, polrelid) INTO v_policy_expr
  FROM pg_policy
  WHERE polrelid = 'public.students'::regclass
    AND polname = 'FinanceAgent read school student references'
    AND polcmd = 'r'
    AND 'authenticated'::regrole = ANY(polroles);

  IF v_policy_expr IS NULL OR
     v_policy_expr NOT ILIKE '%get_auth_role%' OR
     v_policy_expr NOT ILIKE '%get_auth_school_id%' OR
     v_policy_expr NOT ILIKE '%auth.uid%' OR
     v_policy_expr NOT ILIKE '%is_active%' THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : La politique FinanceAgent sur students ne contient pas les expressions de sécurité requises.';
  END IF;

  SELECT pg_get_expr(polqual, polrelid) INTO v_policy_expr
  FROM pg_policy
  WHERE polrelid = 'public.student_enrollments'::regclass
    AND polname = 'FinanceAgent read school enrollments'
    AND polcmd = 'r'
    AND 'authenticated'::regrole = ANY(polroles);

  IF v_policy_expr IS NULL OR
     v_policy_expr NOT ILIKE '%get_auth_role%' OR
     v_policy_expr NOT ILIKE '%get_auth_school_id%' OR
     v_policy_expr NOT ILIKE '%auth.uid%' OR
     v_policy_expr NOT ILIKE '%is_active%' THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : La politique FinanceAgent sur student_enrollments ne contient pas les expressions de sécurité requises.';
  END IF;

  -- H. Aucune politique de mutation pour finance_agent sur students ou student_enrollments
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid IN ('public.students'::regclass, 'public.student_enrollments'::regclass, 'public.classes'::regclass)
      AND polcmd IN ('w', 'a', 'd')
      AND polname ILIKE '%finance%'
  ) THEN
    RAISE EXCEPTION 'ÉCHEC ASSERTION : Aucune politique RLS de mutation ne doit exister pour finance_agent.';
  END IF;
END $$;

COMMIT;
