-- Migration Phase 2D.1 Fix : Correction de l'ambiguïté des colonnes dans les RPC de lecture des devoirs
-- Fichier : supabase/migrations/20260817180000_fix_homework_read_rpc_ambiguity.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. RPC : get_teacher_homework
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_teacher_homework()
RETURNS TABLE (
  id UUID,
  school_id UUID,
  academic_year_id UUID,
  term_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  teacher_id UUID,
  teacher_name TEXT,
  title TEXT,
  instructions TEXT,
  assigned_on DATE,
  due_at TIMESTAMPTZ,
  estimated_minutes INTEGER,
  status TEXT,
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school_status TEXT;
  v_tch_id UUID;
  v_tch_acc_status TEXT;
  v_tch_emp_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif.';
  END IF;

  IF v_caller_role = 'teacher' THEN
    SELECT sc.status
    INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_caller_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
    END IF;

    SELECT t.id, t.account_status, t.employment_status
    INTO v_tch_id, v_tch_acc_status, v_tch_emp_status
    FROM public.teachers t
    WHERE t.profile_id = v_uid
      AND t.school_id = v_caller_school_id;

    IF v_tch_id IS NULL OR v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Compte enseignant inactif.';
    END IF;

    RETURN QUERY
    SELECT
      h.id,
      h.school_id,
      h.academic_year_id,
      h.term_id,
      h.class_id,
      c.name AS class_name,
      h.subject_id,
      s.name AS subject_name,
      h.teacher_id,
      (t.first_name || ' ' || t.last_name) AS teacher_name,
      h.title,
      h.instructions,
      h.assigned_on,
      h.due_at,
      h.estimated_minutes,
      h.status,
      h.published_at,
      h.closed_at,
      h.created_by,
      h.created_at,
      h.updated_at
    FROM public.school_homework h
    JOIN public.classes c ON c.id = h.class_id
    JOIN public.subjects s ON s.id = h.subject_id
    JOIN public.teachers t ON t.id = h.teacher_id
    WHERE h.school_id = v_caller_school_id
      AND h.teacher_id = v_tch_id
    ORDER BY h.due_at DESC, h.created_at DESC;

  ELSIF v_caller_role = 'school_admin' THEN
    SELECT sc.status
    INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_caller_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
    END IF;

    RETURN QUERY
    SELECT
      h.id,
      h.school_id,
      h.academic_year_id,
      h.term_id,
      h.class_id,
      c.name AS class_name,
      h.subject_id,
      s.name AS subject_name,
      h.teacher_id,
      (t.first_name || ' ' || t.last_name) AS teacher_name,
      h.title,
      h.instructions,
      h.assigned_on,
      h.due_at,
      h.estimated_minutes,
      h.status,
      h.published_at,
      h.closed_at,
      h.created_by,
      h.created_at,
      h.updated_at
    FROM public.school_homework h
    JOIN public.classes c ON c.id = h.class_id
    JOIN public.subjects s ON s.id = h.subject_id
    JOIN public.teachers t ON t.id = h.teacher_id
    WHERE h.school_id = v_caller_school_id
    ORDER BY h.due_at DESC, h.created_at DESC;

  ELSIF v_caller_role = 'super_admin' THEN
    RETURN QUERY
    SELECT
      h.id,
      h.school_id,
      h.academic_year_id,
      h.term_id,
      h.class_id,
      c.name AS class_name,
      h.subject_id,
      s.name AS subject_name,
      h.teacher_id,
      (t.first_name || ' ' || t.last_name) AS teacher_name,
      h.title,
      h.instructions,
      h.assigned_on,
      h.due_at,
      h.estimated_minutes,
      h.status,
      h.published_at,
      h.closed_at,
      h.created_by,
      h.created_at,
      h.updated_at
    FROM public.school_homework h
    JOIN public.classes c ON c.id = h.class_id
    JOIN public.subjects s ON s.id = h.subject_id
    JOIN public.teachers t ON t.id = h.teacher_id
    ORDER BY h.due_at DESC, h.created_at DESC;

  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;
END;
$$;

--------------------------------------------------------------------------------
-- 2. RPC : get_homework_for_student
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_homework_for_student(p_student_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  school_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  teacher_name TEXT,
  title TEXT,
  instructions TEXT,
  assigned_on DATE,
  due_at TIMESTAMPTZ,
  estimated_minutes INTEGER,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile_role TEXT;
  v_profile_active BOOLEAN;
  v_profile_school_id UUID;
  v_student_id UUID;
  v_student_school_id UUID;
  v_school_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_profile_role, v_profile_school_id, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_profile_role IS NULL OR v_profile_active IS NOT TRUE OR v_profile_role <> 'student' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un élève actif peut consulter ses devoirs.';
  END IF;

  -- Obtenir le dossier élève lié à l'utilisateur connecté
  SELECT st.id, st.school_id
  INTO v_student_id, v_student_school_id
  FROM public.students st
  WHERE st.profile_id = v_uid;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Dossier élève introuvable pour votre compte.';
  END IF;

  IF p_student_id IS NOT NULL AND p_student_id <> v_student_id THEN
    RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres devoirs.';
  END IF;

  IF v_profile_school_id IS NULL OR v_student_school_id IS NULL OR v_profile_school_id <> v_student_school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : Profil et dossier élève incompatibles.';
  END IF;

  SELECT sc.status
  INTO v_school_status
  FROM public.schools sc
  WHERE sc.id = v_student_school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
  END IF;

  RETURN QUERY
  SELECT
    h.id,
    h.school_id,
    h.class_id,
    c.name AS class_name,
    h.subject_id,
    s.name AS subject_name,
    (t.first_name || ' ' || t.last_name) AS teacher_name,
    h.title,
    h.instructions,
    h.assigned_on,
    h.due_at,
    h.estimated_minutes,
    h.status
  FROM public.school_homework h
  JOIN public.classes c ON c.id = h.class_id
  JOIN public.subjects s ON s.id = h.subject_id
  JOIN public.teachers t ON t.id = h.teacher_id
  JOIN public.student_enrollments se ON se.class_id = h.class_id
    AND se.academic_year_id = h.academic_year_id
    AND se.school_id = v_student_school_id
    AND se.student_id = v_student_id
    AND se.status = 'active'
  JOIN public.academic_years ay ON ay.id = se.academic_year_id
    AND ay.school_id = v_student_school_id
    AND ay.is_current = true
  WHERE h.school_id = v_student_school_id
    AND c.academic_year_id = se.academic_year_id
    AND h.status IN ('published', 'closed')
  ORDER BY h.due_at DESC;
END;
$$;

--------------------------------------------------------------------------------
-- 3. RPC : get_homework_for_parent_child
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_homework_for_parent_child(p_student_id UUID)
RETURNS TABLE (
  id UUID,
  school_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  teacher_name TEXT,
  title TEXT,
  instructions TEXT,
  assigned_on DATE,
  due_at TIMESTAMPTZ,
  estimated_minutes INTEGER,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile_role TEXT;
  v_profile_active BOOLEAN;
  v_profile_school_id UUID;
  v_student_school_id UUID;
  v_school_status TEXT;
  v_is_parent BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Identifiant élève obligatoire.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_profile_role, v_profile_school_id, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_profile_role IS NULL OR v_profile_active IS NOT TRUE OR v_profile_role <> 'parent' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un parent actif peut utiliser cette fonction.';
  END IF;

  -- Vérification du lien parent-élève avec helper public.is_parent_of_student(p_student_id)
  v_is_parent := public.is_parent_of_student(p_student_id);

  IF NOT v_is_parent THEN
    RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas un parent approuvé pour cet élève.';
  END IF;

  -- École de l'élève
  SELECT st.school_id
  INTO v_student_school_id
  FROM public.students st
  WHERE st.id = p_student_id;

  IF v_student_school_id IS NULL OR v_profile_school_id IS NULL OR v_student_school_id <> v_profile_school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’élève n’appartient pas au même établissement.';
  END IF;

  SELECT sc.status
  INTO v_school_status
  FROM public.schools sc
  WHERE sc.id = v_student_school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
  END IF;

  RETURN QUERY
  SELECT
    h.id,
    h.school_id,
    h.class_id,
    c.name AS class_name,
    h.subject_id,
    s.name AS subject_name,
    (t.first_name || ' ' || t.last_name) AS teacher_name,
    h.title,
    h.instructions,
    h.assigned_on,
    h.due_at,
    h.estimated_minutes,
    h.status
  FROM public.school_homework h
  JOIN public.classes c ON c.id = h.class_id
  JOIN public.subjects s ON s.id = h.subject_id
  JOIN public.teachers t ON t.id = h.teacher_id
  JOIN public.student_enrollments se ON se.class_id = h.class_id
    AND se.academic_year_id = h.academic_year_id
    AND se.school_id = v_student_school_id
    AND se.student_id = p_student_id
    AND se.status = 'active'
  JOIN public.academic_years ay ON ay.id = se.academic_year_id
    AND ay.school_id = v_student_school_id
    AND ay.is_current = true
  WHERE h.school_id = v_student_school_id
    AND c.academic_year_id = se.academic_year_id
    AND h.status IN ('published', 'closed')
  ORDER BY h.due_at DESC;
END;
$$;

--------------------------------------------------------------------------------
-- 4. REVOKE ET GRANT DES PRIVILEGES D'EXECUTION
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_teacher_homework() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_homework_for_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_homework_for_parent_child(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_teacher_homework() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_homework_for_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_homework_for_parent_child(UUID) TO authenticated;

COMMIT;
