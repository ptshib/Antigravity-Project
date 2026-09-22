-- ============================================================================
-- Migration : Correction Canonique de la Visibilité du Professeur Titulaire dans son Portail
-- Fichier : supabase/migrations/20260922130000_fix_homeroom_teacher_portal_visibility.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. MISE À JOUR DE LA FONCTION is_teacher_of_class
-- Prise en compte explicite du professeur titulaire (c.homeroom_teacher_id = auth.uid())
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_teacher_of_class(target_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.classes c
    JOIN public.profiles p ON p.id = auth.uid()
    JOIN public.schools s ON s.id = p.school_id
    LEFT JOIN public.teachers t ON t.profile_id = p.id
    LEFT JOIN public.teacher_class_assignments tca ON tca.class_id = c.id
      AND tca.is_active = true
      AND tca.school_id = p.school_id
      AND (
        tca.teacher_profile_id = auth.uid()
        OR (t.id IS NOT NULL AND tca.teacher_id = t.id AND t.employment_status = 'active')
      )
    WHERE c.id = target_class_id
      AND c.school_id = p.school_id
      AND c.is_active = true
      AND p.role = 'teacher'
      AND p.is_active = true
      AND s.status = 'active'
      AND (
        tca.id IS NOT NULL
        OR c.homeroom_teacher_id = auth.uid()
      )
  );
$$;

--------------------------------------------------------------------------------
-- 2. MISE À JOUR DE LA RPC get_teacher_assigned_students
-- Inclut les élèves des classes affectées par matière ET des classes de titularisation
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_teacher_assigned_students()
RETURNS TABLE (
  student_id uuid,
  student_number text,
  first_name text,
  last_name text,
  class_id uuid,
  class_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prof_role text;
  v_prof_school_id uuid;
  v_prof_active boolean;
  v_tch_id uuid;
  v_tch_account_status text;
  v_tch_emp_status text;
  v_school_status text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT role, school_id, is_active INTO v_prof_role, v_prof_school_id, v_prof_active
  FROM public.profiles WHERE id = v_uid;

  IF NOT (v_prof_active AND (v_prof_role = 'teacher' OR v_prof_role = 'school_admin' OR v_prof_role = 'super_admin')) THEN
    RETURN;
  END IF;

  SELECT id, account_status, employment_status INTO v_tch_id, v_tch_account_status, v_tch_emp_status
  FROM public.teachers WHERE profile_id = v_uid;

  IF v_tch_id IS NULL OR v_tch_account_status <> 'active' OR v_tch_emp_status <> 'active' THEN
    RETURN;
  END IF;

  SELECT status INTO v_school_status FROM public.schools WHERE id = v_prof_school_id;
  IF v_school_status <> 'active' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    st.id AS student_id,
    st.student_number,
    st.first_name,
    st.last_name,
    c.id AS class_id,
    c.name AS class_name
  FROM public.students st
  JOIN public.student_enrollments se ON se.student_id = st.id
  JOIN public.classes c ON c.id = se.class_id
  LEFT JOIN public.teacher_class_assignments tca
    ON tca.class_id = c.id
   AND tca.teacher_id = v_tch_id
   AND tca.is_active = true
   AND tca.school_id = v_prof_school_id
  WHERE (tca.id IS NOT NULL OR c.homeroom_teacher_id = v_uid)
    AND se.status = 'active'
    AND st.school_id = v_prof_school_id
    AND se.school_id = v_prof_school_id
    AND c.school_id = v_prof_school_id
    AND c.is_active = true
    AND se.academic_year_id = c.academic_year_id
  ORDER BY c.name, st.last_name, st.first_name;
END;
$$;

COMMIT;
