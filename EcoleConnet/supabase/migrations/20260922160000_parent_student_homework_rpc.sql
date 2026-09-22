-- Migration Lot 2B : RPC Sécurisée get_parent_student_homework pour le portail Parent
-- Fichier : supabase/migrations/20260922160000_parent_student_homework_rpc.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.get_parent_student_homework(
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_student RECORD;
  v_homework_list JSONB;
  v_total_count INT := 0;
  v_upcoming_count INT := 0;
  v_overdue_count INT := 0;
BEGIN
  -- 1. Authentification & Contrôle de Rôle Parent Actif sur Établissement Actif
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id
  INTO v_caller_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role = 'parent'
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un compte parent actif d’un établissement actif peut consulter ce dossier.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Contrôle de la Relation Parent Validée et Flag can_view_homework
  IF NOT EXISTS (
    SELECT 1
    FROM public.parent_student_links psl
    JOIN public.students st ON st.id = psl.student_id
    WHERE psl.parent_profile_id = v_caller_id
      AND psl.student_id = p_student_id
      AND psl.status = 'approved'
      AND psl.can_view_homework = true
      AND psl.school_id = v_caller_school_id
      AND st.school_id = v_caller_school_id
  ) THEN
    RAISE EXCEPTION 'REJET ACCÈS : La consultation des devoirs pour cet élève n’est pas autorisée sur votre compte parent.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Métadonnées de l'Élève & Classe Active
  SELECT 
    st.id,
    st.student_number,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name,
    se.class_id,
    c.name AS class_name,
    se.academic_year_id,
    ay.name AS academic_year_name
  INTO v_student
  FROM public.students st
  JOIN public.student_enrollments se ON se.student_id = st.id
    AND se.school_id = st.school_id
    AND se.status = 'active'
  JOIN public.classes c ON c.id = se.class_id AND c.school_id = st.school_id
  LEFT JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = st.school_id
  WHERE st.id = p_student_id
    AND st.school_id = v_caller_school_id
  ORDER BY se.enrolled_on DESC, se.created_at DESC
  LIMIT 1;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’élève sélectionné ne possède aucune inscription active dans cet établissement.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Métriques de devoirs (uniquement status IN ('published', 'closed'), hors draft et cancelled)
  SELECT 
    pg_catalog.count(h.id),
    pg_catalog.count(h.id) FILTER (WHERE h.due_at >= CURRENT_TIMESTAMP),
    pg_catalog.count(h.id) FILTER (WHERE h.due_at < CURRENT_TIMESTAMP)
  INTO 
    v_total_count,
    v_upcoming_count,
    v_overdue_count
  FROM public.school_homework h
  WHERE h.school_id = v_caller_school_id
    AND h.class_id = v_student.class_id
    AND h.status IN ('published', 'closed')
    AND (h.academic_year_id IS NULL OR h.academic_year_id = v_student.academic_year_id);

  -- 5. Liste des devoirs visibles (triés par à venir d'abord échéance croissante, puis échus plus récents)
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', h.id,
      'title', h.title,
      'instructions', h.instructions,
      'subject_id', h.subject_id,
      'subject_name', s.name,
      'teacher_id', h.teacher_id,
      'teacher_name', pg_catalog.btrim(pg_catalog.concat_ws(' ', t.first_name, t.last_name)),
      'assigned_on', h.assigned_on,
      'published_at', h.published_at,
      'due_at', h.due_at,
      'estimated_minutes', h.estimated_minutes,
      'status', h.status,
      'is_overdue', (h.due_at < CURRENT_TIMESTAMP)
    )
  ), pg_catalog.jsonb_build_array())
  INTO v_homework_list
  FROM (
    SELECT h2.*
    FROM public.school_homework h2
    WHERE h2.school_id = v_caller_school_id
      AND h2.class_id = v_student.class_id
      AND h2.status IN ('published', 'closed')
      AND (h2.academic_year_id IS NULL OR h2.academic_year_id = v_student.academic_year_id)
    ORDER BY 
      CASE WHEN h2.due_at >= CURRENT_TIMESTAMP THEN 0 ELSE 1 END ASC,
      CASE WHEN h2.due_at >= CURRENT_TIMESTAMP THEN h2.due_at END ASC,
      CASE WHEN h2.due_at < CURRENT_TIMESTAMP THEN h2.due_at END DESC,
      h2.created_at DESC
  ) h
  JOIN public.subjects s ON s.id = h.subject_id AND s.school_id = v_caller_school_id
  JOIN public.teachers t ON t.id = h.teacher_id AND t.school_id = v_caller_school_id;

  -- 6. Construction de la réponse JSONB finale
  RETURN pg_catalog.jsonb_build_object(
    'student_id', v_student.id,
    'student_number', v_student.student_number,
    'student_name', v_student.student_full_name,
    'class_id', v_student.class_id,
    'class_name', v_student.class_name,
    'academic_year_id', v_student.academic_year_id,
    'academic_year_name', COALESCE(v_student.academic_year_name, ''),
    'summary', pg_catalog.jsonb_build_object(
      'total', v_total_count,
      'upcoming', v_upcoming_count,
      'overdue', v_overdue_count
    ),
    'homework', COALESCE(v_homework_list, pg_catalog.jsonb_build_array())
  );
END;
$$;

-- Sécurisation des privilèges
REVOKE ALL ON FUNCTION public.get_parent_student_homework(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_parent_student_homework(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_homework(UUID) TO authenticated;

COMMIT;
