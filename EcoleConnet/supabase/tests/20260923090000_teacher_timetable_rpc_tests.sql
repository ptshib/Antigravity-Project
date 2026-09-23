-- Suite de Tests SQL : 20260923090000_teacher_timetable_rpc_tests.sql
-- Validation complète de la RPC get_authenticated_teacher_timetable (Lot 2H / 2H-V / 2H-V2)

BEGIN;

-- 1. Application temporaire de la RPC dans la transaction
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

  SELECT t.id, COALESCE(t.account_status, 'active'), COALESCE(t.first_name, p.first_name), COALESCE(t.last_name, p.last_name)
  INTO v_tch_id, v_tch_account_status, v_tch_first_name, v_tch_last_name
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.profile_id = v_uid AND t.school_id = v_prof_school_id;

  IF v_tch_id IS NULL OR LOWER(v_tch_account_status) NOT IN ('active', 'enabled') THEN
    RAISE EXCEPTION 'REJET ACCÈS : Compte enseignant inactif ou non trouvé.'
      USING ERRCODE = '42501';
  END IF;

  SELECT ay.id, ay.name
  INTO v_active_ay_id, v_active_ay_name
  FROM public.academic_years ay
  WHERE ay.school_id = v_prof_school_id
    AND ay.is_current = true
  LIMIT 1;

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

-- Table temporaire pour capturer la sortie des 16 scénarios
CREATE TEMP TABLE temp_test_results (
  scenario_id INT,
  description TEXT,
  status TEXT
) ON COMMIT DROP;

-- 2. Scénarios de tests transactionnels
DO $$
DECLARE
  v_school_a_id UUID := 'a1111111-1111-1111-1111-111111111111'::uuid;
  v_school_b_id UUID := 'b2222222-2222-2222-2222-222222222222'::uuid;
  v_ay_a_id UUID := 'a1111111-aaaa-1111-1111-111111111111'::uuid;
  v_ay_b_id UUID := 'b2222222-bbbb-2222-2222-222222222222'::uuid;

  v_prof_teacher_a_id UUID := 'a1111111-3333-1111-1111-111111111111'::uuid;
  v_tch_a_id UUID := 'a1111111-4444-1111-1111-111111111111'::uuid;

  v_prof_teacher_b_id UUID := 'b2222222-3333-2222-2222-222222222222'::uuid;
  v_tch_b_id UUID := 'b2222222-4444-2222-2222-222222222222'::uuid;

  v_prof_admin_id UUID := 'a1111111-9999-1111-1111-111111111111'::uuid;
  v_prof_parent_id UUID := 'a1111111-5555-1111-1111-111111111111'::uuid;
  v_prof_student_id UUID := 'a1111111-6666-1111-1111-111111111111'::uuid;
  v_prof_inactive_tch_id UUID := 'a1111111-7777-1111-1111-111111111111'::uuid;
  v_tch_inactive_id UUID := 'a1111111-8888-1111-1111-111111111111'::uuid;

  v_class_a1_id UUID := 'c1111111-1111-1111-1111-111111111111'::uuid;
  v_class_a2_id UUID := 'c1111111-2222-1111-1111-111111111111'::uuid;
  v_class_b1_id UUID := 'c2222222-1111-2222-2222-222222222222'::uuid;
  v_class_other_homeroom UUID := 'c1111111-3333-1111-1111-111111111111'::uuid;

  v_subj_math_a_id UUID := 'e1111111-1111-1111-1111-111111111111'::uuid;
  v_subj_french_a_id UUID := 'e1111111-2222-1111-1111-111111111111'::uuid;
  v_subj_math_b_id UUID := 'e2222222-1111-2222-2222-222222222222'::uuid;

  v_slot_1_id UUID := 'f1111111-1111-1111-1111-111111111111'::uuid;
  v_slot_2_id UUID := 'f1111111-2222-1111-1111-111111111111'::uuid;
  v_slot_break_id UUID := 'f1111111-3333-1111-1111-111111111111'::uuid;
  v_slot_other_tch_id UUID := 'f1111111-4444-1111-1111-111111111111'::uuid;
  v_slot_school_b_id UUID := 'f2222222-1111-2222-2222-222222222222'::uuid;

  v_res JSONB;
  v_slots JSONB;
  v_secdef BOOLEAN;
  v_config TEXT[];
BEGIN
  -- SETUP DE FIXTURES TEMPORAIRES DANS AUTH.USERS ET PUBLIC.PROFILES
  INSERT INTO auth.users (id, email) VALUES
    (v_prof_teacher_a_id, 'teacher.a@test.cd'),
    (v_prof_teacher_b_id, 'teacher.b@test.cd'),
    (v_prof_admin_id, 'admin@test.cd'),
    (v_prof_parent_id, 'parent@test.cd'),
    (v_prof_student_id, 'student@test.cd'),
    (v_prof_inactive_tch_id, 'inactive@test.cd');

  INSERT INTO public.schools (id, name, slug, status) VALUES
    (v_school_a_id, 'École Test A', 'ecole-test-a', 'active'),
    (v_school_b_id, 'École Test B', 'ecole-test-b', 'active');

  INSERT INTO public.academic_years (id, school_id, name, is_current, starts_on, ends_on) VALUES
    (v_ay_a_id, v_school_a_id, '2026-2027', true, '2026-09-01', '2027-06-30'),
    (v_ay_b_id, v_school_b_id, '2026-2027', true, '2026-09-01', '2027-06-30');

  INSERT INTO public.profiles (id, school_id, first_name, last_name, role, is_active) VALUES
    (v_prof_teacher_a_id, v_school_a_id, 'Grâce', 'Kabeya', 'teacher', true),
    (v_prof_teacher_b_id, v_school_b_id, 'Marc', 'Tshi', 'teacher', true),
    (v_prof_admin_id, v_school_a_id, 'Admin', 'Ecole', 'school_admin', true),
    (v_prof_parent_id, v_school_a_id, 'Jean', 'Parent', 'parent', true),
    (v_prof_student_id, v_school_a_id, 'Paul', 'Elève', 'student', true),
    (v_prof_inactive_tch_id, v_school_a_id, 'Pierre', 'Inactif', 'teacher', false);

  INSERT INTO public.teachers (id, school_id, profile_id, account_status, employment_status, employee_number, first_name, last_name) VALUES
    (v_tch_a_id, v_school_a_id, v_prof_teacher_a_id, 'active', 'active', 'ENS-001', 'Grâce', 'Kabeya'),
    (v_tch_b_id, v_school_b_id, v_prof_teacher_b_id, 'active', 'active', 'ENS-002', 'Marc', 'Tshi'),
    (v_tch_inactive_id, v_school_a_id, v_prof_inactive_tch_id, 'suspended', 'terminated', 'ENS-999', 'Pierre', 'Inactif');

  -- v_class_other_homeroom a homeroom_teacher_id = v_prof_teacher_b_id (profil de l'enseignant B)
  INSERT INTO public.classes (id, school_id, academic_year_id, name, homeroom_teacher_id, is_active) VALUES
    (v_class_a1_id, v_school_a_id, v_ay_a_id, '1re Secondaire A', NULL, true),
    (v_class_a2_id, v_school_a_id, v_ay_a_id, '2e Secondaire A', NULL, true),
    (v_class_b1_id, v_school_b_id, v_ay_b_id, '1re Secondaire B', NULL, true),
    (v_class_other_homeroom, v_school_a_id, v_ay_a_id, 'Classe Titulaire Autre Enseignant', v_prof_teacher_b_id, true);

  INSERT INTO public.teacher_class_assignments (id, school_id, teacher_id, teacher_profile_id, class_id, academic_year_id, subject_name, is_active) VALUES
    (gen_random_uuid(), v_school_a_id, v_tch_a_id, v_prof_teacher_a_id, v_class_a1_id, v_ay_a_id, 'Mathématiques', true),
    (gen_random_uuid(), v_school_a_id, v_tch_a_id, v_prof_teacher_a_id, v_class_a2_id, v_ay_a_id, 'Français', true);

  INSERT INTO public.subjects (id, school_id, name, code, is_active) VALUES
    (v_subj_math_a_id, v_school_a_id, 'Mathématiques', 'MATH-A', true),
    (v_subj_french_a_id, v_school_a_id, 'Français', 'FRAN-A', true),
    (v_subj_math_b_id, v_school_b_id, 'Mathématiques B', 'MATH-B', true);

  -- Créneaux de cours & pause École A & B
  INSERT INTO public.school_timetables (
    id, school_id, academic_year_id, class_id, subject_id, teacher_id,
    day_of_week, start_time, end_time, room, slot_type, label, status
  ) VALUES
    (v_slot_1_id, v_school_a_id, v_ay_a_id, v_class_a1_id, v_subj_math_a_id, v_tch_a_id, 1, '08:00', '09:30', 'Salle 101', 'course', NULL, 'active'),
    (v_slot_2_id, v_school_a_id, v_ay_a_id, v_class_a2_id, v_subj_french_a_id, v_tch_a_id, 1, '10:00', '11:30', 'Salle 102', 'course', NULL, 'active'),
    (v_slot_break_id, v_school_a_id, v_ay_a_id, v_class_a1_id, NULL, NULL, 1, '09:30', '10:00', NULL, 'break', 'Récréation du Matin', 'active'),
    (v_slot_other_tch_id, v_school_a_id, v_ay_a_id, v_class_a1_id, v_subj_french_a_id, v_tch_inactive_id, 2, '08:00', '09:30', 'Salle 101', 'course', NULL, 'active'),
    (v_slot_school_b_id, v_school_b_id, v_ay_b_id, v_class_b1_id, v_subj_math_b_id, v_tch_b_id, 1, '08:00', '09:30', 'Salle B1', 'course', NULL, 'active');

  -- SCÉNARIO 1 : ENSEIGNANT ACTIF AUTORISÉ (Grâce Kabeya)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_teacher_a_id::text, 'role', 'authenticated')::text, true);
  v_res := public.get_authenticated_teacher_timetable();
  IF (v_res->>'total_slots')::int = 3 THEN
    INSERT INTO temp_test_results VALUES (1, 'Enseignant actif autorisé', 'PASS');
  END IF;

  -- SCÉNARIO 2 : UNIQUEMENT SES PROPRES COURS
  v_slots := v_res->'slots';
  IF v_slots::text NOT LIKE '%' || v_slot_other_tch_id::text || '%' THEN
    INSERT INTO temp_test_results VALUES (2, 'Uniquement ses propres cours', 'PASS');
  END IF;

  -- SCÉNARIO 3 : ISOLATION MULTI-ÉCOLES
  IF v_slots::text NOT LIKE '%' || v_slot_school_b_id::text || '%' THEN
    INSERT INTO temp_test_results VALUES (3, 'Isolation multi-écoles', 'PASS');
  END IF;

  -- SCÉNARIO 4 : PARENT REFUSÉ
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_parent_id::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.get_authenticated_teacher_timetable();
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN INSERT INTO temp_test_results VALUES (4, 'Parent refusé (42501)', 'PASS'); END IF;
  END;

  -- SCÉNARIO 5 : ÉLÈVE REFUSÉ
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_student_id::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.get_authenticated_teacher_timetable();
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN INSERT INTO temp_test_results VALUES (5, 'Élève refusé (42501)', 'PASS'); END IF;
  END;

  -- SCÉNARIO 6 : ADMIN NON ENSEIGNANT REFUSÉ
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_admin_id::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.get_authenticated_teacher_timetable();
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN INSERT INTO temp_test_results VALUES (6, 'Administrateur non enseignant refusé (42501)', 'PASS'); END IF;
  END;

  -- SCÉNARIO 7 : UTILISATEUR ANONYME REFUSÉ
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.get_authenticated_teacher_timetable();
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN INSERT INTO temp_test_results VALUES (7, 'Utilisateur anonyme refusé (42501)', 'PASS'); END IF;
  END;

  -- SCÉNARIO 8 : ENSEIGNANT INACTIF REFUSÉ
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_inactive_tch_id::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.get_authenticated_teacher_timetable();
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN INSERT INTO temp_test_results VALUES (8, 'Enseignant inactif refusé (42501)', 'PASS'); END IF;
  END;

  -- SCÉNARIO 9 : ANNÉE SCOLAIRE ACTIVE CORRECTEMENT RÉSOLUE
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_teacher_a_id::text, 'role', 'authenticated')::text, true);
  v_res := public.get_authenticated_teacher_timetable();
  IF v_res->>'academic_year_id' = v_ay_a_id::text AND v_res->>'academic_year_name' = '2026-2027' THEN
    INSERT INTO temp_test_results VALUES (9, 'Année scolaire active correctement résolue', 'PASS');
  END IF;

  -- SCÉNARIO 10 : PAUSE SANS ENTRÉE CORRECTEMENT RETOURNÉE
  IF (v_res->>'total_breaks')::int = 1 AND v_slots::text LIKE '%Récréation du Matin%' THEN
    INSERT INTO temp_test_results VALUES (10, 'Pause sans entrée correctement retournée', 'PASS');
  END IF;

  -- SCÉNARIO 11 : ORDRE CHRONOLOGIQUE CORRECT
  IF (v_slots->0->>'start_time') = '08:00' AND (v_slots->1->>'start_time') = '09:30' AND (v_slots->2->>'start_time') = '10:00' THEN
    INSERT INTO temp_test_results VALUES (11, 'Ordre chronologique correct', 'PASS');
  END IF;

  -- SCÉNARIO 12 : EMPLOI DU TEMPS VIDE PROPRE
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_teacher_b_id::text, 'role', 'authenticated')::text, true);
  DELETE FROM public.school_timetables WHERE school_id = v_school_b_id;
  v_res := public.get_authenticated_teacher_timetable();
  IF (v_res->>'total_slots')::int = 0 AND jsonb_array_length(v_res->'slots') = 0 THEN
    INSERT INTO temp_test_results VALUES (12, 'Emploi du temps vide propre', 'PASS');
  END IF;

  -- SCÉNARIO 13 : IMPOSSIBILITÉ DE FOURNIR UN teacher_id OU school_id
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_teacher_a_id::text, 'role', 'authenticated')::text, true);
  v_res := public.get_authenticated_teacher_timetable(v_class_a1_id);
  IF v_res->>'school_id' = v_school_a_id::text AND v_res->>'teacher_id' = v_tch_a_id::text THEN
    INSERT INTO temp_test_results VALUES (13, 'Aucune injection de teacher_id ou school_id', 'PASS');
  END IF;

  -- SCÉNARIO 14 : PRIVILÈGES DE SÉCURITÉ & CONFIGURATION RPC
  SELECT prosecdef, proconfig INTO v_secdef, v_config
  FROM pg_proc WHERE proname = 'get_authenticated_teacher_timetable';
  IF NOT has_function_privilege('anon', 'public.get_authenticated_teacher_timetable(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('public', 'public.get_authenticated_teacher_timetable(uuid)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.get_authenticated_teacher_timetable(uuid)', 'EXECUTE')
     AND v_secdef AND v_config::text LIKE '%search_path%' THEN
    INSERT INTO temp_test_results VALUES (14, 'Privilèges PUBLIC et anon absents, SECURITY DEFINER et search_path ok', 'PASS');
  END IF;

  -- SCÉNARIO 15 : CLASSE NON ATTRIBUÉE REFUSÉE AVEC 42501
  BEGIN
    PERFORM public.get_authenticated_teacher_timetable(v_class_b1_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN INSERT INTO temp_test_results VALUES (15, 'Classe non attribuée refusée avec 42501', 'PASS'); END IF;
  END;

  -- SCÉNARIO 16 : VERIFICATION DE LA TITULARISATION (homeroom_teacher_id comparé exclusivement avec profiles.id [v_uid])
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_teacher_a_id::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.get_authenticated_teacher_timetable(v_class_other_homeroom);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_test_results VALUES (16, 'Titularisation strictement contrôlée via profiles.id (v_uid)', 'PASS');
    END IF;
  END;

END;
$$;

SELECT scenario_id, description, status FROM temp_test_results ORDER BY scenario_id;

ROLLBACK;
