-- Migration corrective : Correction des expressions SQL COALESCE / ROUND dans get_parent_student_attendance
-- Fichier : supabase/migrations/20260922151000_fix_parent_attendance_sql_expressions.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.get_parent_student_attendance(
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
  v_today_status TEXT := 'not_recorded';
  v_records JSONB;
  v_total_sessions INT := 0;
  v_present_count INT := 0;
  v_absent_count INT := 0;
  v_late_count INT := 0;
  v_excused_count INT := 0;
  v_left_early_count INT := 0;
  v_present_effective INT := 0;
  v_evaluated_sessions INT := 0;
  v_attendance_rate NUMERIC := NULL;
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

  -- 2. Contrôle de la Relation Parent Validée et Flag can_view_attendance
  IF NOT EXISTS (
    SELECT 1
    FROM public.parent_student_links psl
    JOIN public.students st ON st.id = psl.student_id
    WHERE psl.parent_profile_id = v_caller_id
      AND psl.student_id = p_student_id
      AND psl.status = 'approved'
      AND psl.can_view_attendance = true
      AND psl.school_id = v_caller_school_id
      AND st.school_id = v_caller_school_id
  ) THEN
    RAISE EXCEPTION 'REJET ACCÈS : La consultation des présences pour cet élève n’est pas autorisée sur votre compte parent.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Métadonnées de l'Élève & Classe Active
  SELECT 
    st.id,
    st.student_number,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name,
    c.name AS class_name
  INTO v_student
  FROM public.students st
  LEFT JOIN LATERAL (
    SELECT c2.name
    FROM public.student_enrollments se2
    JOIN public.classes c2 ON c2.id = se2.class_id
    WHERE se2.student_id = st.id
      AND se2.school_id = st.school_id
    ORDER BY (se2.status = 'active') DESC, se2.enrolled_on DESC, se2.created_at DESC
    LIMIT 1
  ) c ON true
  WHERE st.id = p_student_id
    AND st.school_id = v_caller_school_id;

  -- 4. Statut du jour (uniquement si une séance clôturée/completed existe aujourd'hui)
  SELECT sa.status
  INTO v_today_status
  FROM public.student_attendance sa
  JOIN public.attendance_sessions ses ON ses.id = sa.attendance_session_id
  WHERE sa.student_id = p_student_id
    AND sa.school_id = v_caller_school_id
    AND ses.attendance_date = CURRENT_DATE
    AND ses.status = 'completed'
  ORDER BY ses.started_at DESC
  LIMIT 1;

  IF v_today_status IS NULL THEN
    v_today_status := 'not_recorded';
  END IF;

  -- 5. Statistiques globales d'assiduité (uniquement sur séances comptabilisées = completed)
  -- RÈGLE DE CALCUL ECOLECONNECT :
  -- Numérateur : present + late + left_early (présences effectives)
  -- Dénominateur évalué : total_sessions - excused
  -- Les absences excusées ne sont pas des présences et ne pénalisent pas le dénominateur.
  -- Si dénominateur = 0 -> attendance_rate = NULL
  SELECT 
    pg_catalog.count(sa.id),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'present'),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'absent'),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'late'),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'excused'),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'left_early')
  INTO 
    v_total_sessions,
    v_present_count,
    v_absent_count,
    v_late_count,
    v_excused_count,
    v_left_early_count
  FROM public.student_attendance sa
  JOIN public.attendance_sessions ses ON ses.id = sa.attendance_session_id
  WHERE sa.student_id = p_student_id
    AND sa.school_id = v_caller_school_id
    AND ses.status = 'completed';

  v_present_effective := v_present_count + v_late_count + v_left_early_count;
  v_evaluated_sessions := v_total_sessions - v_excused_count;

  IF v_evaluated_sessions > 0 THEN
    v_attendance_rate := ROUND(
      (v_present_effective::numeric / v_evaluated_sessions::numeric) * 100.0,
      1
    );
  ELSE
    v_attendance_rate := NULL;
  END IF;

  -- 6. Historique détaillé des séances (uniquement status = 'completed')
  -- Utilisation de COALESCE(...) native (non qualifiée par pg_catalog.)
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', sa.id,
      'attendance_date', ses.attendance_date,
      'status', sa.status,
      'arrival_time', sa.arrival_time,
      'justification', sa.justification,
      'justified', sa.justified,
      'subject_name', sbj.name,
      'teacher_name', pg_catalog.btrim(pg_catalog.concat_ws(' ', t_prof.first_name, t_prof.last_name))
    ) ORDER BY ses.attendance_date DESC, ses.started_at DESC
  ), '[]'::jsonb)
  INTO v_records
  FROM public.student_attendance sa
  JOIN public.attendance_sessions ses ON ses.id = sa.attendance_session_id
  LEFT JOIN public.subjects sbj ON sbj.id = ses.subject_id
  LEFT JOIN public.teachers t ON t.id = ses.teacher_id
  LEFT JOIN public.profiles t_prof ON t_prof.id = t.profile_id
  WHERE sa.student_id = p_student_id
    AND sa.school_id = v_caller_school_id
    AND ses.status = 'completed';

  RETURN pg_catalog.jsonb_build_object(
    'student', pg_catalog.jsonb_build_object(
      'id', v_student.id,
      'student_number', v_student.student_number,
      'student_full_name', v_student.student_full_name,
      'class_name', v_student.class_name
    ),
    'today_status', v_today_status,
    'stats', pg_catalog.jsonb_build_object(
      'total_sessions', v_total_sessions,
      'evaluated_sessions', v_evaluated_sessions,
      'present_effective', v_present_effective,
      'present_count', v_present_count,
      'absent_count', v_absent_count,
      'late_count', v_late_count,
      'excused_count', v_excused_count,
      'left_early_count', v_left_early_count,
      'attendance_rate', v_attendance_rate
    ),
    'records', v_records
  );
END;
$$;

ALTER FUNCTION public.get_parent_student_attendance(UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_parent_student_attendance(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_parent_student_attendance(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_attendance(UUID) TO authenticated;

COMMIT;
