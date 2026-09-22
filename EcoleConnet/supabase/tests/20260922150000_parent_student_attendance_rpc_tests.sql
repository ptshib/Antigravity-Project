-- Test Suite: 20260922150000_parent_student_attendance_rpc_tests.sql
-- Validation automatisée de la RPC get_parent_student_attendance

BEGIN;

DO $$
DECLARE
    v_school_a UUID := 'a1111111-1111-1111-1111-111111111111';
    v_school_b UUID := 'b2222222-2222-2222-2222-222222222222';

    v_parent_auth UUID := 'p1111111-1111-1111-1111-111111111111';
    v_parent_no_perm UUID := 'p2222222-2222-2222-2222-222222222222';
    v_parent_school_b UUID := 'p3333333-3333-3333-3333-333333333333';

    v_student_1 UUID := 's1111111-1111-1111-1111-111111111111';
    v_student_2 UUID := 's2222222-2222-2222-2222-222222222222';
    v_student_excused UUID := 's4444444-4444-4444-4444-444444444444';

    v_class_a UUID := 'c1111111-1111-1111-1111-111111111111';
    v_year_a UUID := 'y1111111-1111-1111-1111-111111111111';
    v_session_1 UUID := 'e1111111-1111-1111-1111-111111111111';
    v_session_2 UUID := 'e2222222-2222-2222-2222-222222222222';
    v_session_reopened UUID := 'e3333333-3333-3333-3333-333333333333';

    v_res JSONB;
    v_caught BOOLEAN := false;
    v_sqlstate TEXT;
BEGIN
    SET LOCAL session_replication_role = 'replica';

    -- Setup Écoles
    INSERT INTO public.schools (id, name, slug, status) VALUES 
      (v_school_a, 'École Test Présences A', 'ecole-att-a', 'active'),
      (v_school_b, 'École Test Présences B', 'ecole-att-b', 'active')
    ON CONFLICT DO NOTHING;

    -- Setup Profils Parents
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
      (v_parent_auth, v_school_a, 'parent', 'Jonas', 'Banza', true),
      (v_parent_no_perm, v_school_a, 'parent', 'Parent', 'SansPerm', true),
      (v_parent_school_b, v_school_b, 'parent', 'Parent', 'EcoleB', true)
    ON CONFLICT DO NOTHING;

    -- Setup Année scolaire et Classe
    INSERT INTO public.academic_years (id, school_id, name, is_current) VALUES
      (v_year_a, v_school_a, '2026-2027', true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.classes (id, school_id, academic_year_id, name) VALUES
      (v_class_a, v_school_a, v_year_a, '6ème Math-Physique')
    ON CONFLICT DO NOTHING;

    -- Setup Élèves
    INSERT INTO public.students (id, school_id, student_number, first_name, last_name) VALUES
      (v_student_1, v_school_a, 'MAT-001', 'Christian', 'Banza'),
      (v_student_2, v_school_a, 'MAT-002', 'Daniel', 'Banza'),
      (v_student_excused, v_school_a, 'MAT-004', 'Franck', 'Banza')
    ON CONFLICT DO NOTHING;

    -- Setup Inscriptions
    INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status) VALUES
      (gen_random_uuid(), v_school_a, v_student_1, v_class_a, v_year_a, 'active'),
      (gen_random_uuid(), v_school_a, v_student_2, v_class_a, v_year_a, 'active'),
      (gen_random_uuid(), v_school_a, v_student_excused, v_class_a, v_year_a, 'active')
    ON CONFLICT DO NOTHING;

    -- Setup Liens Parents
    INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_view_attendance) VALUES
      (gen_random_uuid(), v_school_a, v_parent_auth, v_student_1, 'approved', true),
      (gen_random_uuid(), v_school_a, v_parent_auth, v_student_2, 'approved', true),
      (gen_random_uuid(), v_school_a, v_parent_auth, v_student_excused, 'approved', true),
      (gen_random_uuid(), v_school_a, v_parent_no_perm, v_student_1, 'approved', false)
    ON CONFLICT DO NOTHING;

    -- Setup Séances : 2 complétées, 1 reopened (doit être exclue)
    INSERT INTO public.attendance_sessions (id, school_id, class_id, academic_year_id, attendance_date, status, created_by) VALUES
      (v_session_1, v_school_a, v_class_a, v_year_a, CURRENT_DATE - INTERVAL '2 days', 'completed', v_parent_auth),
      (v_session_2, v_school_a, v_class_a, v_year_a, CURRENT_DATE - INTERVAL '1 day', 'completed', v_parent_auth),
      (v_session_reopened, v_school_a, v_class_a, v_year_a, CURRENT_DATE, 'reopened', v_parent_auth)
    ON CONFLICT DO NOTHING;

    -- Présences v_student_1 : 1 present, 1 late dans sessions completed; 1 absent dans session reopened
    INSERT INTO public.student_attendance (id, school_id, attendance_session_id, student_id, enrollment_id, status, marked_by) VALUES
      (gen_random_uuid(), v_school_a, v_session_1, v_student_1, (SELECT id FROM public.student_enrollments WHERE student_id = v_student_1 LIMIT 1), 'present', v_parent_auth),
      (gen_random_uuid(), v_school_a, v_session_2, v_student_1, (SELECT id FROM public.student_enrollments WHERE student_id = v_student_1 LIMIT 1), 'late', v_parent_auth),
      (gen_random_uuid(), v_school_a, v_session_reopened, v_student_1, (SELECT id FROM public.student_enrollments WHERE student_id = v_student_1 LIMIT 1), 'absent', v_parent_auth)
    ON CONFLICT DO NOTHING;

    -- Présences v_student_excused : uniquement absences excusées
    INSERT INTO public.student_attendance (id, school_id, attendance_session_id, student_id, enrollment_id, status, marked_by) VALUES
      (gen_random_uuid(), v_school_a, v_session_1, v_student_excused, (SELECT id FROM public.student_enrollments WHERE student_id = v_student_excused LIMIT 1), 'excused', v_parent_auth)
    ON CONFLICT DO NOTHING;

    -- =========================================================================
    -- TEST 1 : v_student_1 -> 2 séances completed (present + late), session reopened exclue. Taux = 100.0%
    -- =========================================================================
    EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_auth::text);
    EXECUTE 'SET LOCAL "request.jwt.claim.role" = ''authenticated''';

    v_res := public.get_parent_student_attendance(v_student_1);
    IF (v_res->'stats'->>'total_sessions')::int <> 2 THEN
      RAISE EXCEPTION 'Test 1 Échoué : total_sessions attendu 2 (reopened exclue), obtenu %', v_res->'stats'->>'total_sessions';
    END IF;
    IF (v_res->'stats'->>'attendance_rate')::numeric <> 100.0 THEN
      RAISE EXCEPTION 'Test 1 Échoué : attendance_rate attendu 100.0, obtenu %', v_res->'stats'->>'attendance_rate';
    END IF;

    -- =========================================================================
    -- TEST 2 : v_student_2 -> 0 séance -> attendance_rate = NULL (pas 100%)
    -- =========================================================================
    v_res := public.get_parent_student_attendance(v_student_2);
    IF (v_res->'stats'->>'total_sessions')::int <> 0 THEN
      RAISE EXCEPTION 'Test 2 Échoué : total_sessions attendu 0, obtenu %', v_res->'stats'->>'total_sessions';
    END IF;
    IF v_res->'stats'->'attendance_rate' IS NOT NULL AND (v_res->'stats'->>'attendance_rate') <> 'null' THEN
      RAISE EXCEPTION 'Test 2 Échoué : attendance_rate attendu NULL pour 0 séance, obtenu %', v_res->'stats'->>'attendance_rate';
    END IF;

    -- =========================================================================
    -- TEST 3 : v_student_excused -> 1 séance excused -> evaluated_sessions = 0 -> attendance_rate = NULL
    -- =========================================================================
    v_res := public.get_parent_student_attendance(v_student_excused);
    IF (v_res->'stats'->>'total_sessions')::int <> 1 THEN
      RAISE EXCEPTION 'Test 3 Échoué : total_sessions attendu 1, obtenu %', v_res->'stats'->>'total_sessions';
    END IF;
    IF (v_res->'stats'->>'excused_count')::int <> 1 THEN
      RAISE EXCEPTION 'Test 3 Échoué : excused_count attendu 1, obtenu %', v_res->'stats'->>'excused_count';
    END IF;
    IF (v_res->'stats'->>'evaluated_sessions')::int <> 0 THEN
      RAISE EXCEPTION 'Test 3 Échoué : evaluated_sessions attendu 0, obtenu %', v_res->'stats'->>'evaluated_sessions';
    END IF;
    IF v_res->'stats'->'attendance_rate' IS NOT NULL AND (v_res->'stats'->>'attendance_rate') <> 'null' THEN
      RAISE EXCEPTION 'Test 3 Échoué : attendance_rate attendu NULL pour 100%% d’absences excusées, obtenu %', v_res->'stats'->>'attendance_rate';
    END IF;

    -- =========================================================================
    -- TEST 4 : Rejet parent sans permission
    -- =========================================================================
    EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_no_perm::text);
    v_caught := false;
    BEGIN
      PERFORM public.get_parent_student_attendance(v_student_1);
    EXCEPTION WHEN OTHERS THEN
      v_caught := true;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    END;
    IF NOT v_caught OR v_sqlstate <> '42501' THEN
      RAISE EXCEPTION 'Test 4 Échoué : Rejet SQLSTATE 42501 attendu';
    END IF;

    RAISE NOTICE 'SUITE DE TESTS GET_PARENT_STUDENT_ATTENDANCE CORRECTIVE : 100%% SUCCÈS';
END;
$$;

ROLLBACK;
