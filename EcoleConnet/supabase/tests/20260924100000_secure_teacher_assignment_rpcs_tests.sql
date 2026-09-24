-- Test Suite: 20260924100000_secure_teacher_assignment_rpcs_tests.sql
-- Lot 2I-P2-V2 : Tests d'univoque stricte des identifiants (teachers.id uniquement), dérivation profiles.id et contrôles de sécurité 42501

BEGIN;

-- Setup Mock Test Data
DO $$
DECLARE
  v_school_a UUID := '11111111-1111-4111-a111-111111111111';
  v_school_b UUID := '22222222-2222-4222-a222-222222222222';
  v_admin_a UUID  := '33333333-3333-4333-a333-333333333333';
  v_admin_b UUID  := '44444444-4444-4444-a444-444444444444';
  v_teacher_profile_a UUID := '55555555-5555-4555-a555-555555555555'; -- Profile ID (User UUID)
  v_teacher_record_a  UUID := '66666666-6666-4666-a666-666666666666'; -- Teacher Row ID (teachers.id) -> DISTINCT!
  v_teacher_profile_b UUID := '77777777-7777-4777-a777-777777777777';
  v_teacher_record_b  UUID := '88888888-8888-4888-a888-888888888888';
  v_year_a UUID   := '99999999-9999-4999-a999-999999999999';
  v_class_pri_a UUID := 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  v_class_sec_a UUID := 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  v_class_pri_b UUID := 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  v_subject_a   UUID := 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
  v_subject_b   UUID := 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
BEGIN
  -- Insert Auth Users
  INSERT INTO auth.users (id, email)
  VALUES
    (v_admin_a, 'admin.alpha@test.com'),
    (v_admin_b, 'admin.beta@test.com'),
    (v_teacher_profile_a, 'teacher.alpha@test.com'),
    (v_teacher_profile_b, 'teacher.beta@test.com')
  ON CONFLICT (id) DO NOTHING;

  -- Insert Schools
  INSERT INTO public.schools (id, name, slug, status)
  VALUES 
    (v_school_a, 'École Test Alpha', 'alpha-test-school', 'active'),
    (v_school_b, 'École Test Bêta',  'beta-test-school',  'active');

  -- Insert Profiles
  INSERT INTO public.profiles (id, school_id, first_name, last_name, role, is_active)
  VALUES
    (v_admin_a, v_school_a, 'Admin', 'Alpha', 'school_admin', true),
    (v_admin_b, v_school_b, 'Admin', 'Beta', 'school_admin', true),
    (v_teacher_profile_a, v_school_a, 'Prof', 'Alpha', 'teacher', true),
    (v_teacher_profile_b, v_school_b, 'Prof', 'Beta', 'teacher', true);

  -- Insert Teachers (Note: teachers.id is distinct from profile_id!)
  INSERT INTO public.teachers (id, school_id, profile_id, employee_number, first_name, last_name, account_status, employment_status)
  VALUES
    (v_teacher_record_a, v_school_a, v_teacher_profile_a, 'EMP-ALPHA-01', 'Prof', 'Alpha', 'active', 'active'),
    (v_teacher_record_b, v_school_b, v_teacher_profile_b, 'EMP-BETA-01', 'Prof', 'Beta', 'active', 'active');

  -- Insert Academic Year
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (v_year_a, v_school_a, '2025-2026', '2025-09-01', '2026-06-30', true);

  -- Insert Classes
  INSERT INTO public.classes (id, school_id, academic_year_id, name, pedagogical_mode)
  VALUES
    (v_class_pri_a, v_school_a, v_year_a, '1A Primaire', 'primary_homeroom'),
    (v_class_sec_a, v_school_a, v_year_a, '7A Secondaire', 'secondary_subjects'),
    (v_class_pri_b, v_school_b, v_year_a, '1B Primaire Bêta', 'primary_homeroom');

  -- Insert Subjects
  INSERT INTO public.subjects (id, school_id, name, is_active)
  VALUES
    (v_subject_a, v_school_a, 'Mathématiques Alpha', true),
    (v_subject_b, v_school_b, 'Mathématiques Bêta', true);
END;
$$;


-- Test 1 & 4: Un véritable teachers.id est accepté et enregistre le bon profiles.id côté serveur (Primaire)
DO $$
DECLARE
  v_admin_a UUID := '33333333-3333-4333-a333-333333333333';
  v_teacher_record_a UUID := '66666666-6666-4666-a666-666666666666'; -- teachers.id
  v_teacher_profile_a UUID := '55555555-5555-4555-a555-555555555555'; -- profiles.id
  v_class_pri_a UUID := 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  v_result BOOLEAN;
  v_stored_homeroom UUID;
  v_assign_count INT;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_a)::text, true);

  -- Appel valide avec teachers.id
  v_result := public.assign_class_homeroom_teacher(v_class_pri_a, v_teacher_record_a);
  ASSERT v_result = true, 'Test 1 Échoué : assign_class_homeroom_teacher doit accepter un teachers.id valide';

  -- Vérification Test 4 : classes.homeroom_teacher_id contient le profiles.id dérivé côté serveur
  SELECT homeroom_teacher_id INTO v_stored_homeroom FROM public.classes WHERE id = v_class_pri_a;
  ASSERT v_stored_homeroom = v_teacher_profile_a, 'Test 4 Échoué : homeroom_teacher_id doit être égal au profiles.id (5555...)';

  -- Isolement Primaire : Aucune ligne teacher_class_assignments
  SELECT COUNT(*) INTO v_assign_count FROM public.teacher_class_assignments WHERE class_id = v_class_pri_a;
  ASSERT v_assign_count = 0, 'Test Isolement Primaire Échoué : Aucune ligne teacher_class_assignments ne doit être créée';

  RAISE NOTICE 'PASSED: Test 1 & 4 (teachers.id accepté, profiles.id dérivé et enregistré en Primaire)';
END;
$$;


-- Test 2: Le profiles.id passé directement comme p_teacher_id est strictement REFUSÉ
DO $$
DECLARE
  v_admin_a UUID := '33333333-3333-4333-a333-333333333333';
  v_teacher_profile_a UUID := '55555555-5555-4555-a555-555555555555'; -- profiles.id (et non teachers.id)
  v_class_pri_a UUID := 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  v_caught BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_a)::text, true);

  BEGIN
    PERFORM public.assign_class_homeroom_teacher(v_class_pri_a, v_teacher_profile_a);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Fiche enseignant introuvable%' THEN
      v_caught := true;
    END IF;
  END;

  ASSERT v_caught = true, 'Test 2 Échoué : Un profiles.id passé directement comme p_teacher_id doit être refusé avec "Fiche enseignant introuvable"';
  RAISE NOTICE 'PASSED: Test 2 (Refus strict du profiles.id transmis directement comme p_teacher_id)';
END;
$$;


-- Test 3: Simulation de collision (un profiles.id d'un autre prof passé comme p_teacher_id est refusé)
DO $$
DECLARE
  v_admin_a UUID := '33333333-3333-4333-a333-333333333333';
  v_teacher_profile_b UUID := '77777777-7777-4777-a777-777777777777'; -- Profile ID du Prof Beta
  v_class_pri_a UUID := 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  v_caught BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_a)::text, true);

  BEGIN
    PERFORM public.assign_class_homeroom_teacher(v_class_pri_a, v_teacher_profile_b);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Fiche enseignant introuvable%' THEN
      v_caught := true;
    END IF;
  END;

  ASSERT v_caught = true, 'Test 3 Échoué : Un profiles.id ne doit jamais être interprété par collision';
  RAISE NOTICE 'PASSED: Test 3 (Pas de résolution par collision d''identifiants)';
END;
$$;


-- Test 5: Affectation secondaire stocke les deux identifiants dans leurs colonnes respectives
DO $$
DECLARE
  v_admin_a UUID := '33333333-3333-4333-a333-333333333333';
  v_teacher_record_a UUID := '66666666-6666-4666-a666-666666666666';
  v_teacher_profile_a UUID := '55555555-5555-4555-a555-555555555555';
  v_class_sec_a UUID := 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  v_subject_a UUID := 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
  v_result BOOLEAN;
  v_row RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_a)::text, true);

  v_result := public.assign_teacher_subject(v_class_sec_a, v_teacher_record_a, v_subject_a);
  ASSERT v_result = true, 'Test 5 Échoué : assign_teacher_subject doit retourner true';

  SELECT teacher_id, teacher_profile_id INTO v_row FROM public.teacher_class_assignments WHERE class_id = v_class_sec_a AND subject_id = v_subject_a;
  ASSERT v_row.teacher_id = v_teacher_record_a, 'Test 5 Échoué : teacher_class_assignments.teacher_id doit être teachers.id (6666...)';
  ASSERT v_row.teacher_profile_id = v_teacher_profile_a, 'Test 5 Échoué : teacher_class_assignments.teacher_profile_id doit être profiles.id (5555...)';

  RAISE NOTICE 'PASSED: Test 5 (Secondaire - Stockage univoque teacher_id = teachers.id & teacher_profile_id = profiles.id)';
END;
$$;


-- Test 6: Contrôles inter-écoles et de rôle (42501)
DO $$
DECLARE
  v_admin_a UUID := '33333333-3333-4333-a333-333333333333';
  v_teacher_record_b UUID := '88888888-8888-4888-a888-888888888888'; -- Enseignant École Bêta
  v_teacher_profile_a UUID := '55555555-5555-4555-a555-555555555555'; -- Rôle teacher
  v_class_pri_a UUID := 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'; -- Classe École Alpha
  v_caught_cross_school BOOLEAN := false;
  v_caught_non_admin BOOLEAN := false;
BEGIN
  -- Test 6a : Enseignant d'une autre école
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_a)::text, true);
  BEGIN
    PERFORM public.assign_class_homeroom_teacher(v_class_pri_a, v_teacher_record_b);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_caught_cross_school := true;
  END;
  ASSERT v_caught_cross_school = true, 'Test 6a Échoué : Doit lever 42501 pour un enseignant d’un autre établissement';

  -- Test 6b : Utilisateur non admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher_profile_a)::text, true);
  BEGIN
    PERFORM public.assign_class_homeroom_teacher(v_class_pri_a, v_teacher_record_b);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_caught_non_admin := true;
  END;
  ASSERT v_caught_non_admin = true, 'Test 6b Échoué : Doit lever 42501 pour un utilisateur non admin';

  RAISE NOTICE 'PASSED: Test 6 (Sécurité inter-écoles et rôles 42501 préservée)';
END;
$$;


-- Test 7: Exclusion des privilèges d'exécution PUBLIC & anon
DO $$
DECLARE
  v_priv_pri_anon BOOLEAN;
  v_priv_pri_public BOOLEAN;
  v_priv_sec_anon BOOLEAN;
  v_priv_sec_public BOOLEAN;
BEGIN
  v_priv_pri_anon   := has_function_privilege('anon',   'public.assign_class_homeroom_teacher(uuid, uuid)', 'EXECUTE');
  v_priv_pri_public := has_function_privilege('public', 'public.assign_class_homeroom_teacher(uuid, uuid)', 'EXECUTE');
  v_priv_sec_anon   := has_function_privilege('anon',   'public.assign_teacher_subject(uuid, uuid, uuid)', 'EXECUTE');
  v_priv_sec_public := has_function_privilege('public', 'public.assign_teacher_subject(uuid, uuid, uuid)', 'EXECUTE');

  ASSERT v_priv_pri_anon = false, 'Test 7 Échoué : anon ne doit pas pouvoir exécuter assign_class_homeroom_teacher';
  ASSERT v_priv_pri_public = false, 'Test 7 Échoué : public ne doit pas pouvoir exécuter assign_class_homeroom_teacher';
  ASSERT v_priv_sec_anon = false, 'Test 7 Échoué : anon ne doit pas pouvoir exécuter assign_teacher_subject';
  ASSERT v_priv_sec_public = false, 'Test 7 Échoué : public ne doit pas pouvoir exécuter assign_teacher_subject';

  RAISE NOTICE 'PASSED: Test 7 (Exclusion privilèges public & anon)';
END;
$$;


-- Test 8: Security Definer & search_path vide
DO $$
DECLARE
  v_secdef_pri BOOLEAN;
  v_secdef_sec BOOLEAN;
  v_config_pri TEXT[];
  v_config_sec TEXT[];
BEGIN
  SELECT prosecdef, proconfig INTO v_secdef_pri, v_config_pri
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'assign_class_homeroom_teacher';

  SELECT prosecdef, proconfig INTO v_secdef_sec, v_config_sec
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'assign_teacher_subject';

  ASSERT v_secdef_pri = true, 'Test 8 Échoué : assign_class_homeroom_teacher doit être SECURITY DEFINER';
  ASSERT v_secdef_sec = true, 'Test 8 Échoué : assign_teacher_subject doit être SECURITY DEFINER';

  ASSERT ('search_path=""' = ANY(v_config_pri) OR 'search_path=' = ANY(v_config_pri)),
    'Test 8 Échoué : search_path doit être vide pour assign_class_homeroom_teacher';
  ASSERT ('search_path=""' = ANY(v_config_sec) OR 'search_path=' = ANY(v_config_sec)),
    'Test 8 Échoué : search_path doit être vide pour assign_teacher_subject';

  RAISE NOTICE 'PASSED: Test 8 (SECURITY DEFINER & search_path vide)';
END;
$$;

ROLLBACK;
