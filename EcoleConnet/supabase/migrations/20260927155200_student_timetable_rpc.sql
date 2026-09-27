-- Migration Lot 2K-T6-B-V2 : RPC Sécurisée public.get_authenticated_student_timetable()
-- Fichier : supabase/migrations/20260927155200_student_timetable_rpc.sql

CREATE OR REPLACE FUNCTION public.get_authenticated_student_timetable()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_profile_count INT := 0;
  v_student_count INT := 0;
  v_enrollment_count INT := 0;
  v_profile RECORD;
  v_student RECORD;
  v_enrollment RECORD;
  v_slots JSONB;
  v_total_slots INT := 0;
  v_total_days INT := 0;
BEGIN
  -- 1. Contrôle d'authentification
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  -- 2. Contrôle du profil actif avec rôle élève
  SELECT pg_catalog.count(*) INTO v_profile_count
  FROM public.profiles p
  WHERE p.id = v_caller_id
    AND p.role = 'student'
    AND p.is_active IS TRUE;

  IF v_profile_count <> 1 THEN
    RAISE EXCEPTION 'REJET ACCÈS : Profil élève inactif ou introuvable.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.school_id, p.first_name, p.last_name
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_caller_id
    AND p.role = 'student'
    AND p.is_active IS TRUE;

  -- 3. Validation stricte du dossier élève unique & actif dans un établissement actif (Fail-Closed)
  SELECT pg_catalog.count(*) INTO v_student_count
  FROM public.students st
  JOIN public.schools sch ON sch.id = st.school_id
  WHERE st.profile_id = v_caller_id
    AND st.school_id = v_profile.school_id
    AND st.account_status = 'active'
    AND st.enrollment_status = 'active'
    AND sch.status = 'active';

  IF v_student_count <> 1 THEN
    RAISE EXCEPTION 'REJET ACCÈS : Aucun dossier élève unique et actif trouvé.' USING ERRCODE = '42501';
  END IF;

  SELECT 
    st.id AS student_id,
    st.school_id,
    st.student_number,
    st.first_name AS student_first_name,
    st.last_name AS student_last_name
  INTO v_student
  FROM public.students st
  JOIN public.schools sch ON sch.id = st.school_id
  WHERE st.profile_id = v_caller_id
    AND st.school_id = v_profile.school_id
    AND st.account_status = 'active'
    AND st.enrollment_status = 'active'
    AND sch.status = 'active';

  -- 4. Validation de l'inscription active unique dans l'année courante (Fail-Closed)
  SELECT pg_catalog.count(*) INTO v_enrollment_count
  FROM public.student_enrollments se
  JOIN public.classes c ON c.id = se.class_id AND c.school_id = se.school_id
  JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
  WHERE se.student_id = v_student.student_id
    AND se.school_id = v_student.school_id
    AND se.status = 'active'
    AND c.school_id = v_student.school_id
    AND ay.school_id = v_student.school_id
    AND se.academic_year_id = ay.id
    AND c.academic_year_id = ay.id
    AND c.is_active IS TRUE
    AND ay.is_current IS TRUE;

  IF v_enrollment_count <> 1 THEN
    RAISE EXCEPTION 'REJET ACCÈS : Aucune inscription active unique trouvée pour cet élève.' USING ERRCODE = '42501';
  END IF;

  SELECT 
    se.class_id,
    c.name AS class_name,
    se.academic_year_id,
    ay.name AS academic_year_name
  INTO v_enrollment
  FROM public.student_enrollments se
  JOIN public.classes c ON c.id = se.class_id AND c.school_id = se.school_id
  JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
  WHERE se.student_id = v_student.student_id
    AND se.school_id = v_student.school_id
    AND se.status = 'active'
    AND c.school_id = v_student.school_id
    AND ay.school_id = v_student.school_id
    AND se.academic_year_id = ay.id
    AND c.academic_year_id = ay.id
    AND c.is_active IS TRUE
    AND ay.is_current IS TRUE;

  -- 5. Résumé des créneaux actifs de la classe dans l'année courante
  SELECT 
    pg_catalog.count(t.id),
    pg_catalog.count(DISTINCT t.day_of_week)
  INTO 
    v_total_slots,
    v_total_days
  FROM public.school_timetables t
  JOIN public.academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = t.school_id
  WHERE t.school_id = v_student.school_id
    AND t.class_id = v_enrollment.class_id
    AND t.academic_year_id = v_enrollment.academic_year_id
    AND ay.is_current IS TRUE
    AND t.status = 'active';

  -- 6. Construction des créneaux de l'emploi du temps (sans status, sans UUIDs)
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'slot_type', COALESCE(t.slot_type, 'course'),
      'label', t.label,
      'day_of_week', t.day_of_week,
      'day_name', CASE t.day_of_week
        WHEN 1 THEN 'Lundi'
        WHEN 2 THEN 'Mardi'
        WHEN 3 THEN 'Mercredi'
        WHEN 4 THEN 'Jeudi'
        WHEN 5 THEN 'Vendredi'
        WHEN 6 THEN 'Samedi'
        WHEN 7 THEN 'Dimanche'
        ELSE 'Inconnu'
      END,
      'subject_name', CASE
        WHEN t.slot_type = 'break' THEN COALESCE(NULLIF(pg_catalog.btrim(t.label), ''), 'Pause')
        ELSE COALESCE(pg_catalog.btrim(s.name), 'Matière non spécifiée')
      END,
      'teacher_name', CASE
        WHEN t.slot_type = 'break' THEN ''
        WHEN tp.id IS NOT NULL THEN COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', tp.first_name, tp.last_name)), ''), 'Enseignant non assigné')
        ELSE 'Enseignant non assigné'
      END,
      'room', COALESCE(t.room, ''),
      'start_time', pg_catalog.to_char(t.start_time, 'HH24:MI'),
      'end_time', pg_catalog.to_char(t.end_time, 'HH24:MI')
    ) ORDER BY t.day_of_week ASC, t.start_time ASC
  ), '[]'::jsonb)
  INTO v_slots
  FROM public.school_timetables t
  JOIN public.academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = t.school_id
  LEFT JOIN public.subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
  LEFT JOIN public.teachers te ON te.id = t.teacher_id AND te.school_id = t.school_id
  LEFT JOIN public.profiles tp ON tp.id = te.profile_id
  WHERE t.school_id = v_student.school_id
    AND t.class_id = v_enrollment.class_id
    AND t.academic_year_id = v_enrollment.academic_year_id
    AND ay.is_current IS TRUE
    AND t.status = 'active';

  -- 7. Contrat JSON épuré (sans UUIDs internes et sans status)
  RETURN pg_catalog.jsonb_build_object(
    'student_name', COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', COALESCE(v_student.student_first_name, v_profile.first_name), COALESCE(v_student.student_last_name, v_profile.last_name))), ''), 'Élève'),
    'student_number', COALESCE(v_student.student_number, ''),
    'class_name', COALESCE(v_enrollment.class_name, 'Classe non définie'),
    'academic_year_name', COALESCE(v_enrollment.academic_year_name, 'Année non spécifiée'),
    'summary', pg_catalog.jsonb_build_object(
      'total_slots', v_total_slots,
      'total_days', v_total_days
    ),
    'slots', v_slots
  );
END;
$$;

ALTER FUNCTION public.get_authenticated_student_timetable() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_authenticated_student_timetable() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authenticated_student_timetable() TO authenticated;
