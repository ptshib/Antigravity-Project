-- Migration: 20260923090000_teacher_timetable_rpc.sql
-- Description: RPC Sécurisée pour l'emploi du temps de l'enseignant authentifié (Lot 2H / 2H-V / 2H-V2)

CREATE OR REPLACE FUNCTION public.get_authenticated_teacher_timetable(
  p_class_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_prof_role TEXT;
  v_prof_school_id UUID;
  v_prof_active BOOLEAN;
  v_tch_id UUID;
  v_tch_first_name TEXT;
  v_tch_last_name TEXT;
  v_tch_account_status TEXT;
  v_school_status TEXT;
  v_active_ay_id UUID;
  v_active_ay_name TEXT;
  v_slots JSONB;
  v_total_slots INT := 0;
  v_total_courses INT := 0;
  v_total_breaks INT := 0;
  v_total_classes INT := 0;
  v_total_duration_minutes INT := 0;
  v_is_class_assigned BOOLEAN := FALSE;
BEGIN
  -- A. Authentification et validation de session
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_prof_role, v_prof_school_id, v_prof_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT (COALESCE(v_prof_active, false) AND v_prof_role IN ('teacher', 'school_admin', 'super_admin')) THEN
    RAISE EXCEPTION 'REJET ACCÈS : Rôle non autorisé pour l’emploi du temps enseignant.'
      USING ERRCODE = '42501';
  END IF;

  IF v_prof_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Aucun établissement rattaché.'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.status INTO v_school_status
  FROM public.schools s
  WHERE s.id = v_prof_school_id;

  IF COALESCE(v_school_status, '') <> 'active' THEN
    RAISE EXCEPTION 'REJET ACCÈS : Établissement inactif ou suspendu.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Résolution de l'enseignant rattaché au profil
  SELECT t.id, COALESCE(t.account_status, 'active'), COALESCE(t.first_name, p.first_name), COALESCE(t.last_name, p.last_name)
  INTO v_tch_id, v_tch_account_status, v_tch_first_name, v_tch_last_name
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.profile_id = v_uid AND t.school_id = v_prof_school_id;

  IF v_tch_id IS NULL OR LOWER(v_tch_account_status) NOT IN ('active', 'enabled') THEN
    RAISE EXCEPTION 'REJET ACCÈS : Compte enseignant inactif ou non trouvé.'
      USING ERRCODE = '42501';
  END IF;

  -- C. Résolution de l'année scolaire courante
  SELECT ay.id, ay.name
  INTO v_active_ay_id, v_active_ay_name
  FROM public.academic_years ay
  WHERE ay.school_id = v_prof_school_id
    AND ay.is_current = true
  LIMIT 1;

  -- D. Contrôle strict de la classe demandée si p_class_id est fourni
  IF p_class_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.teacher_class_assignments tca
      WHERE (tca.teacher_id = v_tch_id OR tca.teacher_profile_id = v_uid)
        AND tca.class_id = p_class_id
        AND tca.school_id = v_prof_school_id
        AND COALESCE(tca.is_active, true) = true
      UNION
      SELECT 1 FROM public.classes c
      WHERE c.id = p_class_id
        AND c.homeroom_teacher_id = v_uid
        AND c.school_id = v_prof_school_id
      UNION
      SELECT 1 FROM public.school_timetables stt
      WHERE stt.teacher_id = v_tch_id
        AND stt.class_id = p_class_id
        AND stt.school_id = v_prof_school_id
        AND stt.status IN ('active', 'published')
    ) INTO v_is_class_assigned;

    IF NOT v_is_class_assigned THEN
      RAISE EXCEPTION 'REJET ACCÈS : Classe non attribuée à cet enseignant.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- E. Agrégation des statistiques et des créneaux
  WITH teacher_classes AS (
    SELECT tca.class_id
    FROM public.teacher_class_assignments tca
    WHERE (tca.teacher_id = v_tch_id OR tca.teacher_profile_id = v_uid)
      AND tca.school_id = v_prof_school_id
      AND COALESCE(tca.is_active, true) = true
    UNION
    SELECT c.id AS class_id
    FROM public.classes c
    WHERE c.homeroom_teacher_id = v_uid
      AND c.school_id = v_prof_school_id
    UNION
    SELECT stt.class_id
    FROM public.school_timetables stt
    WHERE stt.teacher_id = v_tch_id
      AND stt.school_id = v_prof_school_id
      AND stt.status IN ('active', 'published')
  ),
  teacher_course_slots AS (
    SELECT t.*
    FROM public.school_timetables t
    WHERE t.school_id = v_prof_school_id
      AND t.status IN ('active', 'published')
      AND (v_active_ay_id IS NULL OR t.academic_year_id = v_active_ay_id)
      AND (p_class_id IS NULL OR t.class_id = p_class_id)
      AND t.teacher_id = v_tch_id
      AND COALESCE(t.slot_type, 'course') = 'course'
  ),
  teacher_break_slots AS (
    SELECT DISTINCT ON (t.day_of_week, t.start_time, t.end_time, COALESCE(t.label, 'Pause')) t.*
    FROM public.school_timetables t
    WHERE t.school_id = v_prof_school_id
      AND t.status IN ('active', 'published')
      AND (v_active_ay_id IS NULL OR t.academic_year_id = v_active_ay_id)
      AND (p_class_id IS NULL OR t.class_id = p_class_id)
      AND t.slot_type = 'break'
      AND t.class_id IN (SELECT class_id FROM teacher_classes)
    ORDER BY t.day_of_week, t.start_time, t.end_time, COALESCE(t.label, 'Pause'), t.id
  ),
  relevant_slots AS (
    SELECT * FROM teacher_course_slots
    UNION ALL
    SELECT * FROM teacher_break_slots
  )
  SELECT
    pg_catalog.count(rs.id)::INT,
    pg_catalog.count(rs.id) FILTER (WHERE COALESCE(rs.slot_type, 'course') = 'course')::INT,
    pg_catalog.count(rs.id) FILTER (WHERE rs.slot_type = 'break')::INT,
    pg_catalog.count(DISTINCT rs.class_id) FILTER (WHERE COALESCE(rs.slot_type, 'course') = 'course')::INT,
    COALESCE(SUM(
      EXTRACT(EPOCH FROM (rs.end_time - rs.start_time)) / 60
    ) FILTER (WHERE COALESCE(rs.slot_type, 'course') = 'course'), 0)::INT
  INTO
    v_total_slots,
    v_total_courses,
    v_total_breaks,
    v_total_classes,
    v_total_duration_minutes
  FROM relevant_slots rs;

  -- F. Construction du JSONB des créneaux
  WITH teacher_classes AS (
    SELECT tca.class_id
    FROM public.teacher_class_assignments tca
    WHERE (tca.teacher_id = v_tch_id OR tca.teacher_profile_id = v_uid)
      AND tca.school_id = v_prof_school_id
      AND COALESCE(tca.is_active, true) = true
    UNION
    SELECT c.id AS class_id
    FROM public.classes c
    WHERE c.homeroom_teacher_id = v_uid
      AND c.school_id = v_prof_school_id
    UNION
    SELECT stt.class_id
    FROM public.school_timetables stt
    WHERE stt.teacher_id = v_tch_id
      AND stt.school_id = v_prof_school_id
      AND stt.status IN ('active', 'published')
  ),
  teacher_course_slots AS (
    SELECT t.*
    FROM public.school_timetables t
    WHERE t.school_id = v_prof_school_id
      AND t.status IN ('active', 'published')
      AND (v_active_ay_id IS NULL OR t.academic_year_id = v_active_ay_id)
      AND (p_class_id IS NULL OR t.class_id = p_class_id)
      AND t.teacher_id = v_tch_id
      AND COALESCE(t.slot_type, 'course') = 'course'
  ),
  teacher_break_slots AS (
    SELECT DISTINCT ON (t.day_of_week, t.start_time, t.end_time, COALESCE(t.label, 'Pause')) t.*
    FROM public.school_timetables t
    WHERE t.school_id = v_prof_school_id
      AND t.status IN ('active', 'published')
      AND (v_active_ay_id IS NULL OR t.academic_year_id = v_active_ay_id)
      AND (p_class_id IS NULL OR t.class_id = p_class_id)
      AND t.slot_type = 'break'
      AND t.class_id IN (SELECT class_id FROM teacher_classes)
    ORDER BY t.day_of_week, t.start_time, t.end_time, COALESCE(t.label, 'Pause'), t.id
  ),
  relevant_slots AS (
    SELECT * FROM teacher_course_slots
    UNION ALL
    SELECT * FROM teacher_break_slots
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', t.id,
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
      'subject_id', t.subject_id,
      'subject_name', CASE
        WHEN t.slot_type = 'break' THEN COALESCE(t.label, 'Pause')
        ELSE COALESCE(s.name, 'Matière non spécifiée')
      END,
      'class_id', t.class_id,
      'class_name', COALESCE(c.name, 'Classe non spécifiée'),
      'teacher_id', t.teacher_id,
      'teacher_name', CASE
        WHEN t.slot_type = 'break' THEN ''
        WHEN tp.id IS NOT NULL THEN TRIM(tp.first_name || ' ' || tp.last_name)
        ELSE TRIM(v_tch_first_name || ' ' || v_tch_last_name)
      END,
      'room', COALESCE(t.room, ''),
      'start_time', pg_catalog.to_char(t.start_time, 'HH24:MI'),
      'end_time', pg_catalog.to_char(t.end_time, 'HH24:MI'),
      'status', t.status,
      'academic_year_id', t.academic_year_id,
      'academic_year_name', COALESCE(v_active_ay_name, 'Non spécifiée')
    ) ORDER BY t.day_of_week ASC, t.start_time ASC
  ), '[]'::jsonb)
  INTO v_slots
  FROM relevant_slots t
  LEFT JOIN public.classes c ON c.id = t.class_id
  LEFT JOIN public.subjects s ON s.id = t.subject_id
  LEFT JOIN public.teachers te ON te.id = t.teacher_id
  LEFT JOIN public.profiles tp ON tp.id = te.profile_id;

  RETURN pg_catalog.jsonb_build_object(
    'teacher_id', v_tch_id,
    'teacher_name', TRIM(v_tch_first_name || ' ' || v_tch_last_name),
    'school_id', v_prof_school_id,
    'academic_year_id', v_active_ay_id,
    'academic_year_name', COALESCE(v_active_ay_name, 'Non spécifiée'),
    'selected_class_id', p_class_id,
    'slots', v_slots,
    'total_slots', v_total_slots,
    'total_courses', v_total_courses,
    'total_breaks', v_total_breaks,
    'total_classes', v_total_classes,
    'total_duration_minutes', v_total_duration_minutes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_authenticated_teacher_timetable(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authenticated_teacher_timetable(UUID) TO authenticated;
ALTER FUNCTION public.get_authenticated_teacher_timetable(UUID) OWNER TO postgres;
