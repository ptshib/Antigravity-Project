-- Suite de Tests SQL : 20260922170000_parent_student_timetable_rpc_tests.sql
-- Validation complète de la sécurité, RLS, intégrité multi-écoles et RPC get_parent_student_timetable

BEGIN;

DO $$
DECLARE
  v_school_a_id UUID := 'a0000000-0000-0000-0000-000000000001';
  v_school_b_id UUID := 'a0000000-0000-0000-0000-000000000002';

  v_parent_auth_id UUID := 'b0000000-0000-0000-0000-000000000001';
  v_parent_no_perm_id UUID := 'b0000000-0000-0000-0000-000000000002';
  v_parent_school_b_id UUID := 'b0000000-0000-0000-0000-000000000003';

  v_student_auth_id UUID := 'c0000000-0000-0000-0000-000000000001';
  v_student_unlinked_id UUID := 'c0000000-0000-0000-0000-000000000002';

  v_class_a_id UUID := 'd0000000-0000-0000-0000-000000000001';
  v_class_b_id UUID := 'd0000000-0000-0000-0000-000000000002';

  v_year_a_id UUID := 'e0000000-0000-0000-0000-000000000001';
  v_year_b_id UUID := 'e0000000-0000-0000-0000-000000000002';

  v_teacher_a_id UUID := 'f0000000-0000-0000-0000-000000000001';
  v_teacher_b_id UUID := 'f0000000-0000-0000-0000-000000000099';

  v_subject_math_id UUID := 'f0000000-0000-0000-0000-000000000002';
  v_subject_phys_id UUID := 'f0000000-0000-0000-0000-000000000003';
  v_subject_b_id UUID := 'f0000000-0000-0000-0000-000000000098';

  v_slot_1_id UUID := 'f0000000-0000-0000-0000-000000000010';
  v_slot_2_id UUID := 'f0000000-0000-0000-0000-000000000011';

  v_rls_enabled BOOLEAN;
  v_force_rls BOOLEAN;
  v_res JSONB;
  v_err_caught BOOLEAN := false;
BEGIN
  SET LOCAL session_replication_role = 'replica';

  ------------------------------------------------------------------------------
  -- 1. VERIFICATION AUDIT RLS ET PRIVILEGES
  ------------------------------------------------------------------------------
  SELECT relrowsecurity, relforcerowsecurity
  INTO v_rls_enabled, v_force_rls
  FROM pg_catalog.pg_class
  WHERE oid = 'public.school_timetables'::regclass;

  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'AUDIT ÉCHOUÉ : RLS doit être activée sur school_timetables';
  END IF;

  IF NOT v_force_rls THEN
    RAISE EXCEPTION 'AUDIT ÉCHOUÉ : FORCE ROW LEVEL SECURITY doit être activé sur school_timetables';
  END IF;

  -- Privilèges de table directes refusés à anon et authenticated
  IF has_table_privilege('anon', 'public.school_timetables', 'SELECT') THEN
    RAISE EXCEPTION 'AUDIT ÉCHOUÉ : anon ne doit pas avoir de privilège SELECT direct sur school_timetables';
  END IF;

  IF has_table_privilege('authenticated', 'public.school_timetables', 'INSERT') THEN
    RAISE EXCEPTION 'AUDIT ÉCHOUÉ : authenticated ne doit pas avoir de privilège INSERT direct sur school_timetables';
  END IF;

  -- Privilège RPC accordé à authenticated
  IF NOT has_function_privilege('authenticated', 'public.get_parent_student_timetable(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AUDIT ÉCHOUÉ : authenticated doit avoir le privilège EXECUTE sur get_parent_student_timetable';
  END IF;

  ------------------------------------------------------------------------------
  -- 2. INSERTION DONNÉES DE TEST VALIDES
  ------------------------------------------------------------------------------
  -- Établissements
  INSERT INTO public.schools (id, name, slug, status) VALUES 
    (v_school_a_id, 'École Test Alpha', 'ecole-test-alpha', 'active'),
    (v_school_b_id, 'École Test Beta', 'ecole-test-beta', 'active')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'active';

  -- Profils
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
    (v_parent_auth_id, v_school_a_id, 'parent', 'Jonas', 'Banza', true),
    (v_parent_no_perm_id, v_school_a_id, 'parent', 'Marc', 'Kambale', true),
    (v_parent_school_b_id, v_school_b_id, 'parent', 'Paul', 'Mukendi', true)
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  -- Années Académiques & Classes
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
    (v_year_a_id, v_school_a_id, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_b_id, v_school_b_id, '2026-2027', '2026-09-01', '2027-06-30', true)
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  INSERT INTO public.classes (id, school_id, academic_year_id, name) VALUES
    (v_class_a_id, v_school_a_id, v_year_a_id, '6ème Math-Physique'),
    (v_class_b_id, v_school_b_id, v_year_b_id, '5ème Biologie')
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id, academic_year_id = EXCLUDED.academic_year_id;

  -- Enseignants & Matières
  INSERT INTO public.teachers (id, school_id, employee_number, first_name, last_name) VALUES
    (v_teacher_a_id, v_school_a_id, 'EMP-001', 'Alain', 'Kasongo'),
    (v_teacher_b_id, v_school_b_id, 'EMP-002', 'Benoit', 'Tshimanga')
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  INSERT INTO public.subjects (id, school_id, name, code) VALUES
    (v_subject_math_id, v_school_a_id, 'Mathématiques', 'MATH6'),
    (v_subject_phys_id, v_school_a_id, 'Physique', 'PHYS6'),
    (v_subject_b_id, v_school_b_id, 'Chimie', 'CHIM5')
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  -- Élèves & Inscriptions Actives
  INSERT INTO public.students (id, school_id, student_number, first_name, last_name) VALUES
    (v_student_auth_id, v_school_a_id, 'MAT-001', 'Christian', 'Banza'),
    (v_student_unlinked_id, v_school_a_id, 'MAT-002', 'Franck', 'Banza')
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status) VALUES
    (gen_random_uuid(), v_school_a_id, v_student_auth_id, v_class_a_id, v_year_a_id, 'active'),
    (gen_random_uuid(), v_school_a_id, v_student_unlinked_id, v_class_a_id, v_year_a_id, 'active')
  ON CONFLICT DO NOTHING;

  -- Liens Parent-Élève (can_view_academic)
  INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_view_academic) VALUES
    (gen_random_uuid(), v_school_a_id, v_parent_auth_id, v_student_auth_id, 'approved', true),
    (gen_random_uuid(), v_school_a_id, v_parent_no_perm_id, v_student_auth_id, 'approved', false)
  ON CONFLICT DO NOTHING;

  ------------------------------------------------------------------------------
  -- 3. VERIFICATION INTÉGRITÉ MULTI-ÉCOLES ET CONTRAINTES
  ------------------------------------------------------------------------------
  -- Test 3.1 : Insertion inter-école rejetée (Enseignant École B pour créneau École A)
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_timetables (
      school_id, academic_year_id, class_id, subject_id, teacher_id, day_of_week, start_time, end_time
    ) VALUES (
      v_school_a_id, v_year_a_id, v_class_a_id, v_subject_math_id, v_teacher_b_id, 1, '08:00:00', '09:00:00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : L''insertion d''un enseignant d''une autre école aurait dû être rejetée par le trigger d''intégrité';
  END IF;

  -- Test 3.2 : Jour 0 rejeté
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_timetables (
      school_id, academic_year_id, class_id, subject_id, day_of_week, start_time, end_time
    ) VALUES (
      v_school_a_id, v_year_a_id, v_class_a_id, v_subject_math_id, 0, '08:00:00', '09:00:00'
    );
  EXCEPTION WHEN check_violation THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Jour 0 aurait dû être rejeté par la contrainte CHECK';
  END IF;

  -- Test 3.3 : Jour 8 rejeté
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_timetables (
      school_id, academic_year_id, class_id, subject_id, day_of_week, start_time, end_time
    ) VALUES (
      v_school_a_id, v_year_a_id, v_class_a_id, v_subject_math_id, 8, '08:00:00', '09:00:00'
    );
  EXCEPTION WHEN check_violation THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Jour 8 aurait dû être rejeté par la contrainte CHECK';
  END IF;

  -- Test 3.4 : Heure de fin <= début rejetée
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_timetables (
      school_id, academic_year_id, class_id, subject_id, day_of_week, start_time, end_time
    ) VALUES (
      v_school_a_id, v_year_a_id, v_class_a_id, v_subject_math_id, 1, '10:00:00', '09:00:00'
    );
  EXCEPTION WHEN check_violation THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Heure de fin <= début aurait dû être rejetée par la contrainte CHECK';
  END IF;

  -- Test 3.5 : Statut inconnu rejeté
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_timetables (
      school_id, academic_year_id, class_id, subject_id, day_of_week, start_time, end_time, status
    ) VALUES (
      v_school_a_id, v_year_a_id, v_class_a_id, v_subject_math_id, 1, '08:00:00', '09:00:00', 'inconnu'
    );
  EXCEPTION WHEN check_violation THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Statut inconnu aurait dû être rejeté par la contrainte CHECK';
  END IF;

  ------------------------------------------------------------------------------
  -- 4. INSERTION ET TEST DES DOUBLONS
  ------------------------------------------------------------------------------
  INSERT INTO public.school_timetables (
    id, school_id, academic_year_id, class_id, subject_id, teacher_id, room, day_of_week, start_time, end_time, status
  ) VALUES
    (v_slot_1_id, v_school_a_id, v_year_a_id, v_class_a_id, v_subject_math_id, v_teacher_a_id, 'Salle 101', 1, '08:00:00', '09:30:00', 'active'),
    (v_slot_2_id, v_school_a_id, v_year_a_id, v_class_a_id, v_subject_phys_id, NULL, 'Labo Physique', 1, '09:45:00', '11:15:00', 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Test 4.1 : Doublon exact rejeté
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_timetables (
      school_id, academic_year_id, class_id, subject_id, teacher_id, room, day_of_week, start_time, end_time, status
    ) VALUES (
      v_school_a_id, v_year_a_id, v_class_a_id, v_subject_math_id, v_teacher_a_id, 'Salle 101', 1, '08:00:00', '09:30:00', 'active'
    );
  EXCEPTION WHEN unique_violation THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Le doublon exact aurait dû être rejeté par l''index unique uq_school_timetable_exact_slot';
  END IF;

  ------------------------------------------------------------------------------
  -- 5. EXÉCUTION RPC GET_PARENT_STUDENT_TIMETABLE ET SÉCURITÉ
  ------------------------------------------------------------------------------
  -- Test 5.1 : Parent autorisé consulte son enfant
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_auth_id::text);
  EXECUTE 'SET LOCAL "request.jwt.claim.role" = ''authenticated''';

  v_res := public.get_parent_student_timetable(v_student_auth_id);

  IF v_res IS NULL THEN
    RAISE EXCEPTION 'TEST 5.1 ÉCHOUÉ : v_res ne doit pas être NULL';
  END IF;

  IF (v_res->'summary'->>'total_slots')::int <> 2 THEN
    RAISE EXCEPTION 'TEST 5.1 ÉCHOUÉ : Attendu 2 créneaux actifs, obtenu %', (v_res->'summary'->>'total_slots');
  END IF;

  -- Test 5.2 : Parent avec can_view_academic = false -> Exception 42501
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_no_perm_id::text);
  
  v_err_caught := false;
  BEGIN
    v_res := public.get_parent_student_timetable(v_student_auth_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 5.2 ÉCHOUÉ : Accès non rejeté pour permission can_view_academic = false';
  END IF;

  -- Test 5.3 : Parent d'une autre école -> Exception 42501
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_school_b_id::text);
  
  v_err_caught := false;
  BEGIN
    v_res := public.get_parent_student_timetable(v_student_auth_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 5.3 ÉCHOUÉ : Accès non rejeté pour parent d''une autre école';
  END IF;

  RAISE NOTICE 'SUITE DE TESTS GET_PARENT_STUDENT_TIMETABLE (REVUE SÉCURITÉ ET INTÉGRITÉ) : 100%% SUCCÈS';
END;
$$;

ROLLBACK;
