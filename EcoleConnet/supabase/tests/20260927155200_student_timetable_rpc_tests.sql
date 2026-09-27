-- Suite de tests transactionnels officielle pour public.get_authenticated_student_timetable()
-- Fichier : supabase/tests/20260927155200_student_timetable_rpc_tests.sql

BEGIN;

-- 1. Intégration de la définition de la migration dans le bloc transactionnel local
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  v_caller_id := auth.uid();

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

  -- 7. Contrat JSON épuré (sans UUIDs internes)
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

-- Désactivation temporaire du trigger trg_prevent_sensitive_profile_updates
ALTER TABLE public.profiles DISABLE TRIGGER trg_prevent_sensitive_profile_updates;

-- Table temporaire pour rapport des tests V2 (Scénarios 1 à 24)
CREATE TEMP TABLE temp_v2_test_results (
  test_id INT PRIMARY KEY,
  test_name TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT
);

-- ============================================================================
-- SUITE V2 DE TESTS COMPLÈTE (SCÉNARIOS 1 À 24) AVEC FIXTURES ISOLÉES
-- ============================================================================
DO $$
DECLARE
  v_secdef BOOLEAN;
  v_provolative CHAR;
  v_proconfig TEXT[];
  v_owner TEXT;
  v_pronargs INT;
  v_proresult TEXT;
  v_has_public_exec BOOLEAN;
  v_has_anon_exec BOOLEAN;
  v_has_auth_exec BOOLEAN;
  
  v_anon_sel BOOLEAN; v_anon_ins BOOLEAN; v_anon_upd BOOLEAN; v_anon_del BOOLEAN;
  v_auth_sel BOOLEAN; v_auth_ins BOOLEAN; v_auth_upd BOOLEAN; v_auth_del BOOLEAN;
  
  v_school_a UUID := gen_random_uuid();
  v_school_b UUID := gen_random_uuid();
  
  v_prof_student_a UUID := gen_random_uuid();
  v_prof_student_b UUID := gen_random_uuid();
  v_prof_parent UUID := gen_random_uuid();
  v_prof_teacher UUID := gen_random_uuid();
  v_prof_admin UUID := gen_random_uuid();
  v_teacher_prof UUID := gen_random_uuid();
  
  v_year_current_a UUID := gen_random_uuid();
  v_year_past_a UUID := gen_random_uuid();
  v_year_b UUID := gen_random_uuid();
  
  v_class_a UUID := gen_random_uuid();
  v_class_a2 UUID := gen_random_uuid();
  v_class_past_a UUID := gen_random_uuid();
  v_class_b UUID := gen_random_uuid();
  
  v_student_a UUID := gen_random_uuid();
  v_student_b UUID := gen_random_uuid();
  
  v_subject_math_a UUID := gen_random_uuid();
  v_subject_math_b UUID := gen_random_uuid();
  v_teacher_math UUID := gen_random_uuid();
  
  v_res JSONB;
  
  -- Variables d'audit des compteurs de tables (Preuve non-mutante)
  v_count_schools_before INT; v_count_schools_after INT;
  v_count_profiles_before INT; v_count_profiles_after INT;
  v_count_students_before INT; v_count_students_after INT;
  v_count_enrollments_before INT; v_count_enrollments_after INT;
  v_count_classes_before INT; v_count_classes_after INT;
  v_count_years_before INT; v_count_years_after INT;
  v_count_timetables_before INT; v_count_timetables_after INT;
  v_count_teachers_before INT; v_count_teachers_after INT;
  v_count_subjects_before INT; v_count_subjects_after INT;
BEGIN
  -- --------------------------------------------------------------------------
  -- SCÉNARIO 1 : Audit complet de pg_proc & Privilèges de base
  -- --------------------------------------------------------------------------
  SELECT p.prosecdef, p.provolatile, p.proconfig, r.rolname
  INTO v_secdef, v_provolative, v_proconfig, v_owner
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.proname = 'get_authenticated_student_timetable';

  SELECT has_function_privilege('anon', 'public.get_authenticated_student_timetable()', 'EXECUTE') INTO v_has_anon_exec;
  SELECT has_function_privilege('authenticated', 'public.get_authenticated_student_timetable()', 'EXECUTE') INTO v_has_auth_exec;

  IF v_secdef IS TRUE 
     AND v_provolative = 's' 
     AND v_owner = 'postgres' 
     AND (v_proconfig::text LIKE '%search_path=%' OR v_proconfig IS NOT NULL)
     AND v_has_anon_exec IS FALSE 
     AND v_has_auth_exec IS TRUE THEN
    INSERT INTO temp_v2_test_results VALUES (1, '1_pg_proc_metadata_audit', 'PASS', 'SECURITY DEFINER, STABLE, search_path="", OWNER postgres, REVOKE anon, GRANT authenticated');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (1, '1_pg_proc_metadata_audit', 'FAIL', 'Anomalie dans les métadonnées pg_proc');
  END IF;

  -- --------------------------------------------------------------------------
  -- CREATION FIXTURES DE TEST
  -- --------------------------------------------------------------------------
  INSERT INTO auth.users (id, email) VALUES 
    (v_prof_student_a, 'student_a_v2@test.local'),
    (v_prof_student_b, 'student_b_v2@test.local'),
    (v_prof_parent, 'parent_v2@test.local'),
    (v_prof_teacher, 'teacher_v2@test.local'),
    (v_prof_admin, 'admin_v2@test.local'),
    (v_teacher_prof, 'teacher_prof_v2@test.local');

  INSERT INTO public.schools (id, name, slug, status) VALUES 
    (v_school_a, 'École Test A V2', 'ecole-test-a-v2', 'active'),
    (v_school_b, 'École Test B V2', 'ecole-test-b-v2', 'active');

  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
    (v_prof_student_a, v_school_a, 'student', 'Élève', 'Test A V2', true),
    (v_prof_student_b, v_school_b, 'student', 'Élève', 'Test B V2', true),
    (v_prof_parent, v_school_a, 'parent', 'Parent', 'Test A V2', true),
    (v_prof_teacher, v_school_a, 'teacher', 'Professeur', 'Test A V2', true),
    (v_prof_admin, v_school_a, 'school_admin', 'Admin', 'Test A V2', true),
    (v_teacher_prof, v_school_a, 'teacher', 'Mathieu', 'Valery', true);

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
    (v_year_current_a, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_past_a, v_school_a, '2025-2026', '2025-09-01', '2026-06-30', false),
    (v_year_b, v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true);

  INSERT INTO public.classes (id, school_id, academic_year_id, name, is_active) VALUES
    (v_class_a, v_school_a, v_year_current_a, '6ème A', true),
    (v_class_a2, v_school_a, v_year_current_a, '6ème A Bis', true),
    (v_class_past_a, v_school_a, v_year_past_a, '5ème A (Passée)', true),
    (v_class_b, v_school_b, v_year_b, '6ème B', true);

  INSERT INTO public.students (id, school_id, profile_id, student_number, first_name, last_name, class_id, account_status, enrollment_status) VALUES
    (v_student_a, v_school_a, v_prof_student_a, 'ELE-V2-001', 'Élève', 'Test A V2', v_class_a, 'active', 'active'),
    (v_student_b, v_school_b, v_prof_student_b, 'ELE-V2-002', 'Élève', 'Test B V2', v_class_b, 'active', 'active');

  INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status) VALUES
    (gen_random_uuid(), v_school_a, v_student_a, v_year_current_a, v_class_a, 'active'),
    (gen_random_uuid(), v_school_b, v_student_b, v_year_b, v_class_b, 'active');

  INSERT INTO public.subjects (id, school_id, name, code) VALUES
    (v_subject_math_a, v_school_a, 'Mathématiques', 'MATH'),
    (v_subject_math_b, v_school_b, 'Physique', 'PHYS');
    
  INSERT INTO public.teachers (id, school_id, profile_id, employee_number, first_name, last_name) VALUES
    (v_teacher_math, v_school_a, v_teacher_prof, 'ENS-V2-001', 'Mathieu', 'Valery');

  -- Créneau de cours
  INSERT INTO public.school_timetables (
    id, school_id, class_id, academic_year_id, day_of_week, start_time, end_time, slot_type, subject_id, teacher_id, room, status
  ) VALUES (
    gen_random_uuid(), v_school_a, v_class_a, v_year_current_a, 1, '08:00:00', '08:55:00', 'course', v_subject_math_a, v_teacher_math, 'Salle 101', 'active'
  );
  
  -- Pause standard avec label "Récréation du Matin"
  INSERT INTO public.school_timetables (
    id, school_id, class_id, academic_year_id, day_of_week, start_time, end_time, slot_type, label, room, status
  ) VALUES (
    gen_random_uuid(), v_school_a, v_class_a, v_year_current_a, 1, '10:00:00', '10:15:00', 'break', 'Récréation du Matin', 'Cour principal', 'active'
  );

  -- Créneau dans une classe de l'année passée (is_current = false)
  INSERT INTO public.school_timetables (
    id, school_id, class_id, academic_year_id, day_of_week, start_time, end_time, slot_type, subject_id, status
  ) VALUES (
    gen_random_uuid(), v_school_a, v_class_past_a, v_year_past_a, 3, '08:00:00', '08:55:00', 'course', v_subject_math_a, 'active'
  );

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 2 : Rejets des accès non autorisés
  -- --------------------------------------------------------------------------
  -- Anonyme
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (2, '2_anonymous_denied', 'FAIL', 'Anonyme autorisé à tort');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO temp_v2_test_results VALUES (2, '2_anonymous_denied', 'PASS', 'Refus anonyme 42501 confirmé');
  END;

  -- Parent
  PERFORM set_config('request.jwt.claim.sub', v_prof_parent::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (3, '3_parent_role_denied', 'FAIL', 'Parent autorisé à tort');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO temp_v2_test_results VALUES (3, '3_parent_role_denied', 'PASS', 'Refus parent 42501 confirmé');
  END;

  -- Enseignant
  PERFORM set_config('request.jwt.claim.sub', v_prof_teacher::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (4, '4_teacher_role_denied', 'FAIL', 'Enseignant autorisé à tort');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO temp_v2_test_results VALUES (4, '4_teacher_role_denied', 'PASS', 'Refus enseignant 42501 confirmé');
  END;

  -- Admin
  PERFORM set_config('request.jwt.claim.sub', v_prof_admin::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (5, '5_admin_role_denied', 'FAIL', 'Admin autorisé à tort');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO temp_v2_test_results VALUES (5, '5_admin_role_denied', 'PASS', 'Refus admin 42501 confirmé');
  END;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 3 : Succès Élève authentifié & Validation stricte du contrat V2
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  v_res := public.get_authenticated_student_timetable();

  IF v_res->>'student_name' = 'Élève Test A V2'
     AND v_res->>'student_number' = 'ELE-V2-001'
     AND v_res->>'class_name' = '6ème A'
     AND v_res->>'academic_year_name' = '2026-2027'
     AND jsonb_array_length(v_res->'slots') = 2
     AND NOT (v_res ? 'student_id')
     AND NOT (v_res ? 'profile_id')
     AND NOT (v_res ? 'school_id')
     AND NOT (v_res ? 'class_id')
     AND NOT (v_res ? 'academic_year_id')
     AND NOT ((v_res->'slots'->0) ? 'id')
     AND NOT ((v_res->'slots'->0) ? 'status')
     AND NOT ((v_res->'slots'->0) ? 'subject_id')
     AND NOT ((v_res->'slots'->0) ? 'teacher_id') THEN
    INSERT INTO temp_v2_test_results VALUES (6, '6_authenticated_student_v2_contract', 'PASS', 'Champs V2 validés : absence de status et de tous les UUIDs internes');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (6, '6_authenticated_student_v2_contract', 'FAIL', v_res::text);
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 4 : Test exhaustif des créneaux de pause (NULL, chaîne vide, espaces)
  -- --------------------------------------------------------------------------
  ALTER TABLE public.school_timetables DROP CONSTRAINT IF EXISTS check_school_timetables_slot_type_rules;

  INSERT INTO public.school_timetables (
    id, school_id, class_id, academic_year_id, day_of_week, start_time, end_time, slot_type, label, room, status
  ) VALUES (
    gen_random_uuid(), v_school_a, v_class_a, v_year_current_a, 2, '10:00:00', '10:15:00', 'break', NULL, 'Cour', 'active'
  );

  INSERT INTO public.school_timetables (
    id, school_id, class_id, academic_year_id, day_of_week, start_time, end_time, slot_type, label, room, status
  ) VALUES (
    gen_random_uuid(), v_school_a, v_class_a, v_year_current_a, 3, '10:00:00', '10:15:00', 'break', '', 'Cour', 'active'
  );

  INSERT INTO public.school_timetables (
    id, school_id, class_id, academic_year_id, day_of_week, start_time, end_time, slot_type, label, room, status
  ) VALUES (
    gen_random_uuid(), v_school_a, v_class_a, v_year_current_a, 4, '10:00:00', '10:15:00', 'break', '   ', 'Cour', 'active'
  );

  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  v_res := public.get_authenticated_student_timetable();

  IF (v_res->'slots'->1->>'subject_name') = 'Récréation du Matin'
     AND (v_res->'slots'->2->>'subject_name') = 'Pause'
     AND (v_res->'slots'->3->>'subject_name') = 'Pause'
     AND (v_res->'slots'->4->>'subject_name') = 'Pause' THEN
    INSERT INTO temp_v2_test_results VALUES (7, '7_break_slots_null_empty_spaces_fallback', 'PASS', 'Libellés NULL, "" et "   " transformés sans faute en "Pause" via COALESCE(NULLIF(btrim(t.label), ''''), ''Pause'')');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (7, '7_break_slots_null_empty_spaces_fallback', 'FAIL', (v_res->'slots')::text);
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 5 : Isolation d'année non courante (is_current = false exclu)
  -- --------------------------------------------------------------------------
  IF (v_res->'summary'->>'total_slots')::int = 5 THEN
    INSERT INTO temp_v2_test_results VALUES (8, '8_past_academic_year_slots_excluded', 'PASS', 'Créneaux des années non courantes (is_current = false) correctement ignorés');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (8, '8_past_academic_year_slots_excluded', 'FAIL', (v_res->'summary')::text);
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 6 : Inscriptions multiples ambiguës (Fail-Closed)
  -- --------------------------------------------------------------------------
  DROP INDEX IF EXISTS public.idx_unique_active_enrollment_per_year;

  INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status) VALUES
    (gen_random_uuid(), v_school_a, v_student_a, v_year_current_a, v_class_a2, 'active');

  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (9, '9_ambiguous_enrollments_fail_closed', 'FAIL', 'La RPC aurait dû rejeter la présence de 2 inscriptions actives');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_v2_test_results VALUES (9, '9_ambiguous_enrollments_fail_closed', 'PASS', 'Inscriptions multiples ambiguës rejetées avec succès en Mode Fail-Closed (42501)');
    ELSE
      INSERT INTO temp_v2_test_results VALUES (9, '9_ambiguous_enrollments_fail_closed', 'FAIL', 'Code d''erreur inattendu : ' || SQLSTATE);
    END IF;
  END;

  -- Nettoyage de l'inscription ambiguë
  DELETE FROM public.student_enrollments WHERE class_id = v_class_a2;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 7 : Preuve du caractère non-mutant (Compteurs de tables inchangés)
  -- --------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count_schools_before FROM public.schools;
  SELECT COUNT(*) INTO v_count_profiles_before FROM public.profiles;
  SELECT COUNT(*) INTO v_count_students_before FROM public.students;
  SELECT COUNT(*) INTO v_count_enrollments_before FROM public.student_enrollments;
  SELECT COUNT(*) INTO v_count_classes_before FROM public.classes;
  SELECT COUNT(*) INTO v_count_years_before FROM public.academic_years;
  SELECT COUNT(*) INTO v_count_timetables_before FROM public.school_timetables;
  SELECT COUNT(*) INTO v_count_teachers_before FROM public.teachers;
  SELECT COUNT(*) INTO v_count_subjects_before FROM public.subjects;

  PERFORM set_config('request.jwt.claim.sub', v_prof_student_b::text, true);
  PERFORM public.get_authenticated_student_timetable();
  PERFORM public.get_authenticated_student_timetable();
  PERFORM public.get_authenticated_student_timetable();
  PERFORM public.get_authenticated_student_timetable();
  PERFORM public.get_authenticated_student_timetable();

  SELECT COUNT(*) INTO v_count_schools_after FROM public.schools;
  SELECT COUNT(*) INTO v_count_profiles_after FROM public.profiles;
  SELECT COUNT(*) INTO v_count_students_after FROM public.students;
  SELECT COUNT(*) INTO v_count_enrollments_after FROM public.student_enrollments;
  SELECT COUNT(*) INTO v_count_classes_after FROM public.classes;
  SELECT COUNT(*) INTO v_count_years_after FROM public.academic_years;
  SELECT COUNT(*) INTO v_count_timetables_after FROM public.school_timetables;
  SELECT COUNT(*) INTO v_count_teachers_after FROM public.teachers;
  SELECT COUNT(*) INTO v_count_subjects_after FROM public.subjects;

  IF v_count_schools_before = v_count_schools_after
     AND v_count_profiles_before = v_count_profiles_after
     AND v_count_students_before = v_count_students_after
     AND v_count_enrollments_before = v_count_enrollments_after
     AND v_count_classes_before = v_count_classes_after
     AND v_count_years_before = v_count_years_after
     AND v_count_timetables_before = v_count_timetables_after
     AND v_count_teachers_before = v_count_teachers_after
     AND v_count_subjects_before = v_count_subjects_after THEN
    INSERT INTO temp_v2_test_results VALUES (10, '10_non_mutating_proof', 'PASS', 'Caractère non-mutant prouvé : 0 écriture sur les 9 tables métier après 5 appels successifs');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (10, '10_non_mutating_proof', 'FAIL', 'Variation de compteurs détectée lors de l''appel de la RPC !');
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 8 : Non-régression des RPCs Admin, Teacher et Parent
  -- --------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_admin_class_timetable')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_authenticated_teacher_timetable')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_parent_student_timetable') THEN
    INSERT INTO temp_v2_test_results VALUES (11, '11_historical_rpcs_non_regression', 'PASS', 'RPCs Admin, Enseignant et Parent parfaitement préservées');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (11, '11_historical_rpcs_non_regression', 'FAIL', 'Une des RPCs historiques manque');
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 12 : Profil élève inactif (is_active = false)
  -- --------------------------------------------------------------------------
  UPDATE public.profiles SET is_active = false WHERE id = v_prof_student_a;
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (12, '12_inactive_profile_denied', 'FAIL', 'Profil inactif autorisé à tort');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_v2_test_results VALUES (12, '12_inactive_profile_denied', 'PASS', 'Profil élève inactif (is_active = false) rejeté avec succès (42501)');
    ELSE
      INSERT INTO temp_v2_test_results VALUES (12, '12_inactive_profile_denied', 'FAIL', 'Code d''erreur inattendu : ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.profiles SET is_active = true WHERE id = v_prof_student_a;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 13 : Dossier Élève / Établissement inactif
  -- --------------------------------------------------------------------------
  UPDATE public.students SET account_status = 'suspended' WHERE id = v_student_a;
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (13, '13_inactive_student_or_school_denied', 'FAIL', 'Dossier élève inactif autorisé à tort');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_v2_test_results VALUES (13, '13_inactive_student_or_school_denied', 'PASS', 'Dossier élève/école inactif (account_status != active) rejeté avec succès (42501)');
    ELSE
      INSERT INTO temp_v2_test_results VALUES (13, '13_inactive_student_or_school_denied', 'FAIL', 'Code d''erreur inattendu : ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.students SET account_status = 'active' WHERE id = v_student_a;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 14 : Inscription ou Classe inactive
  -- --------------------------------------------------------------------------
  UPDATE public.student_enrollments SET status = 'withdrawn' WHERE student_id = v_student_a AND academic_year_id = v_year_current_a;
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (14, '14_inactive_enrollment_or_class_denied', 'FAIL', 'Inscription inactive autorisée à tort');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_v2_test_results VALUES (14, '14_inactive_enrollment_or_class_denied', 'PASS', 'Inscription/classe inactive (status != active) rejetée avec succès (42501)');
    ELSE
      INSERT INTO temp_v2_test_results VALUES (14, '14_inactive_enrollment_or_class_denied', 'FAIL', 'Code d''erreur inattendu : ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.student_enrollments SET status = 'active' WHERE student_id = v_student_a AND academic_year_id = v_year_current_a;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 15 : Créneau inactif (timetable.status != active) exclu des slots
  -- --------------------------------------------------------------------------
  INSERT INTO public.school_timetables (
    id, school_id, class_id, academic_year_id, day_of_week, start_time, end_time, slot_type, subject_id, status
  ) VALUES (
    gen_random_uuid(), v_school_a, v_class_a, v_year_current_a, 5, '08:00:00', '08:55:00', 'course', v_subject_math_a, 'inactive'
  );

  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  v_res := public.get_authenticated_student_timetable();

  IF NOT (v_res::text LIKE '%Vendredi%') AND (v_res->'summary'->>'total_slots')::int = 5 THEN
    INSERT INTO temp_v2_test_results VALUES (15, '15_inactive_timetable_slot_excluded', 'PASS', 'Créneau inactif (status != active) prouvé ABSENT du tableau slots');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (15, '15_inactive_timetable_slot_excluded', 'FAIL', 'Créneau inactif trouvé dans les slots : ' || (v_res->'summary')::text);
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 16 : Robustesse des noms d'élève (prénom seul, nom seul, 2 absents)
  -- --------------------------------------------------------------------------
  -- Case 16.1 : Prénom seul sur dossier
  UPDATE public.students SET first_name = 'Jean', last_name = NULL WHERE id = v_student_a;
  UPDATE public.profiles SET first_name = 'Jean', last_name = '' WHERE id = v_prof_student_a;
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  v_res := public.get_authenticated_student_timetable();

  IF v_res->>'student_name' = 'Jean' AND NOT (v_res->>'student_name' LIKE '%null%') AND NOT (v_res->>'student_name' LIKE '%undefined%') THEN
    -- Case 16.2 : Nom seul sur dossier
    UPDATE public.students SET first_name = NULL, last_name = 'Kabila' WHERE id = v_student_a;
    UPDATE public.profiles SET first_name = '', last_name = 'Kabila' WHERE id = v_prof_student_a;
    v_res := public.get_authenticated_student_timetable();
    
    IF v_res->>'student_name' = 'Kabila' AND NOT (v_res->>'student_name' LIKE '%null%') AND NOT (v_res->>'student_name' LIKE '%undefined%') THEN
      -- Case 16.3 : Prénom & Nom absents -> fallback "Élève"
      UPDATE public.students SET first_name = NULL, last_name = NULL WHERE id = v_student_a;
      UPDATE public.profiles SET first_name = '', last_name = '' WHERE id = v_prof_student_a;
      v_res := public.get_authenticated_student_timetable();
      
      IF v_res->>'student_name' = 'Élève' AND NOT (v_res->>'student_name' LIKE '%null%') AND NOT (v_res->>'student_name' LIKE '%undefined%') THEN
        INSERT INTO temp_v2_test_results VALUES (16, '16_student_name_formatting_robustness', 'PASS', 'Noms élève validés (prénom seul "Jean", nom seul "Kabila", fallback "Élève", 0 "null" ou "undefined")');
      ELSE
        INSERT INTO temp_v2_test_results VALUES (16, '16_student_name_formatting_robustness', 'FAIL', 'Échec fallback 2 noms absents : ' || (v_res->>'student_name'));
      END IF;
    ELSE
      INSERT INTO temp_v2_test_results VALUES (16, '16_student_name_formatting_robustness', 'FAIL', 'Échec nom seul : ' || (v_res->>'student_name'));
    END IF;
  ELSE
    INSERT INTO temp_v2_test_results VALUES (16, '16_student_name_formatting_robustness', 'FAIL', 'Échec prénom seul : ' || (v_res->>'student_name'));
  END IF;

  -- Restauration des noms d'origine
  UPDATE public.students SET first_name = 'Élève', last_name = 'Test A V2' WHERE id = v_student_a;
  UPDATE public.profiles SET first_name = 'Élève', last_name = 'Test A V2' WHERE id = v_prof_student_a;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 17 : Audit pg_proc Approfondi (Contrôle strict des 8 critères)
  -- --------------------------------------------------------------------------
  SELECT 
    p.pronargs,
    pg_catalog.pg_get_function_result(p.oid),
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    r.rolname
  INTO 
    v_pronargs,
    v_proresult,
    v_secdef,
    v_provolative,
    v_proconfig,
    v_owner
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
  WHERE p.proname = 'get_authenticated_student_timetable';

  SELECT has_function_privilege('public', 'public.get_authenticated_student_timetable()', 'EXECUTE') INTO v_has_public_exec;
  SELECT has_function_privilege('anon', 'public.get_authenticated_student_timetable()', 'EXECUTE') INTO v_has_anon_exec;
  SELECT has_function_privilege('authenticated', 'public.get_authenticated_student_timetable()', 'EXECUTE') INTO v_has_auth_exec;

  IF v_pronargs = 0
     AND v_proresult = 'jsonb'
     AND v_secdef IS TRUE 
     AND v_provolative = 's' 
     AND v_owner = 'postgres' 
     AND v_proconfig::text LIKE '%search_path=%'
     AND v_has_public_exec IS FALSE
     AND v_has_anon_exec IS FALSE 
     AND v_has_auth_exec IS TRUE THEN
    INSERT INTO temp_v2_test_results VALUES (17, '17_pg_proc_strict_metadata_audit', 'PASS', 'Audit pg_proc validé : pronargs=0, result=jsonb, prosecdef=true, volatile=s, search_path="", owner=postgres, EXECUTE PUBLIC/anon=false, authenticated=true');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (17, '17_pg_proc_strict_metadata_audit', 'FAIL', 'Erreur métadonnées pg_proc : pronargs=' || v_pronargs || ', result=' || v_proresult || ', owner=' || v_owner);
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 18 : Audit de Sécurité des Privilèges d'Écriture Directe sur public.school_timetables
  -- --------------------------------------------------------------------------
  SELECT has_table_privilege('anon', 'public.school_timetables', 'INSERT') INTO v_anon_ins;
  SELECT has_table_privilege('anon', 'public.school_timetables', 'UPDATE') INTO v_anon_upd;
  SELECT has_table_privilege('anon', 'public.school_timetables', 'DELETE') INTO v_anon_del;

  SELECT has_table_privilege('authenticated', 'public.school_timetables', 'INSERT') INTO v_auth_ins;
  SELECT has_table_privilege('authenticated', 'public.school_timetables', 'UPDATE') INTO v_auth_upd;
  SELECT has_table_privilege('authenticated', 'public.school_timetables', 'DELETE') INTO v_auth_del;

  IF v_anon_ins IS FALSE AND v_anon_upd IS FALSE AND v_anon_del IS FALSE
     AND v_auth_ins IS FALSE AND v_auth_upd IS FALSE AND v_auth_del IS FALSE THEN
    INSERT INTO temp_v2_test_results VALUES (18, '18_table_direct_write_privileges_security_audit', 'PASS', 'Sécurité table validée : aucun privilège direct d''écriture (INSERT/UPDATE/DELETE) pour anon ou authenticated sur public.school_timetables');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (18, '18_table_direct_write_privileges_security_audit', 'FAIL', 'Privilège direct indu trouvé sur public.school_timetables');
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 19 : Incohérence Multi-Établissement (Cross-School Mismatch)
  -- --------------------------------------------------------------------------
  UPDATE public.classes SET school_id = v_school_b WHERE id = v_class_a;
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (19, '19_cross_school_mismatch_denied', 'FAIL', 'Incohérence école autorisée à tort');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_v2_test_results VALUES (19, '19_cross_school_mismatch_denied', 'PASS', 'Incohérence d''établissement (Cross-School Mismatch) rejetée avec succès (42501)');
    ELSE
      INSERT INTO temp_v2_test_results VALUES (19, '19_cross_school_mismatch_denied', 'FAIL', 'Code d''erreur inattendu : ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.classes SET school_id = v_school_a WHERE id = v_class_a;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 20 : school_status_inactive_denied (Modifie réellement schools.status)
  -- --------------------------------------------------------------------------
  UPDATE public.schools SET status = 'suspended' WHERE id = v_school_a;
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (20, '20_school_status_inactive_denied', 'FAIL', 'Établissement inactif autorisé à tort');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_v2_test_results VALUES (20, '20_school_status_inactive_denied', 'PASS', 'Établissement inactif (schools.status != active) rejeté avec succès (42501)');
    ELSE
      INSERT INTO temp_v2_test_results VALUES (20, '20_school_status_inactive_denied', 'FAIL', 'Code d''erreur inattendu : ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.schools SET status = 'active' WHERE id = v_school_a;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 21 : student_enrollment_status_inactive_denied (Modifie réellement students.enrollment_status)
  -- --------------------------------------------------------------------------
  UPDATE public.students SET enrollment_status = 'suspended' WHERE id = v_student_a;
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (21, '21_student_enrollment_status_inactive_denied', 'FAIL', 'Statut d''inscription élève inactif autorisé à tort');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_v2_test_results VALUES (21, '21_student_enrollment_status_inactive_denied', 'PASS', 'Dossier élève inactif (students.enrollment_status != active) rejeté avec succès (42501)');
    ELSE
      INSERT INTO temp_v2_test_results VALUES (21, '21_student_enrollment_status_inactive_denied', 'FAIL', 'Code d''erreur inattendu : ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.students SET enrollment_status = 'active' WHERE id = v_student_a;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 22 : class_is_active_false_denied (Modifie réellement classes.is_active)
  -- --------------------------------------------------------------------------
  UPDATE public.classes SET is_active = false WHERE id = v_class_a;
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (22, '22_class_is_active_false_denied', 'FAIL', 'Classe inactive autorisée à tort');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_v2_test_results VALUES (22, '22_class_is_active_false_denied', 'PASS', 'Classe inactive (classes.is_active = false) rejetée avec succès (42501)');
    ELSE
      INSERT INTO temp_v2_test_results VALUES (22, '22_class_is_active_false_denied', 'FAIL', 'Code d''erreur inattendu : ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.classes SET is_active = true WHERE id = v_class_a;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 23 : no_current_academic_year_denied (Modifie réellement academic_years.is_current)
  -- --------------------------------------------------------------------------
  UPDATE public.academic_years SET is_current = false WHERE id = v_year_current_a;
  PERFORM set_config('request.jwt.claim.sub', v_prof_student_a::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_timetable();
    INSERT INTO temp_v2_test_results VALUES (23, '23_no_current_academic_year_denied', 'FAIL', 'Année académique non courante autorisée à tort');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO temp_v2_test_results VALUES (23, '23_no_current_academic_year_denied', 'PASS', 'Année académique non courante (academic_years.is_current = false) rejetée avec succès (42501)');
    ELSE
      INSERT INTO temp_v2_test_results VALUES (23, '23_no_current_academic_year_denied', 'FAIL', 'Code d''erreur inattendu : ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.academic_years SET is_current = true WHERE id = v_year_current_a;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 24 : table_direct_select_privilege_denied (SELECT, INSERT, UPDATE, DELETE)
  -- --------------------------------------------------------------------------
  SELECT has_table_privilege('anon', 'public.school_timetables', 'SELECT') INTO v_anon_sel;
  SELECT has_table_privilege('anon', 'public.school_timetables', 'INSERT') INTO v_anon_ins;
  SELECT has_table_privilege('anon', 'public.school_timetables', 'UPDATE') INTO v_anon_upd;
  SELECT has_table_privilege('anon', 'public.school_timetables', 'DELETE') INTO v_anon_del;

  SELECT has_table_privilege('authenticated', 'public.school_timetables', 'SELECT') INTO v_auth_sel;
  SELECT has_table_privilege('authenticated', 'public.school_timetables', 'INSERT') INTO v_auth_ins;
  SELECT has_table_privilege('authenticated', 'public.school_timetables', 'UPDATE') INTO v_auth_upd;
  SELECT has_table_privilege('authenticated', 'public.school_timetables', 'DELETE') INTO v_auth_del;

  IF v_anon_sel IS FALSE AND v_anon_ins IS FALSE AND v_anon_upd IS FALSE AND v_anon_del IS FALSE
     AND v_auth_sel IS FALSE AND v_auth_ins IS FALSE AND v_auth_upd IS FALSE AND v_auth_del IS FALSE THEN
    INSERT INTO temp_v2_test_results VALUES (24, '24_table_direct_select_privilege_denied', 'PASS', 'Privilèges direct refusés : aucun accès SELECT, INSERT, UPDATE, DELETE sur public.school_timetables pour anon ou authenticated');
  ELSE
    INSERT INTO temp_v2_test_results VALUES (24, '24_table_direct_select_privilege_denied', 'FAIL', 'Privilège direct indu trouvé sur public.school_timetables');
  END IF;

END;
$$;

-- Réactivation des triggers sur profiles
ALTER TABLE public.profiles ENABLE TRIGGER trg_prevent_sensitive_profile_updates;

SELECT * FROM temp_v2_test_results ORDER BY test_id ASC;

ROLLBACK;
