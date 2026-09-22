-- Test Suite: 20260922151000_fix_parent_attendance_sql_expressions_tests.sql
-- Non-regression test for COALESCE SQL expression in get_parent_student_attendance

BEGIN;

DO $$
DECLARE
    v_school_id UUID := 'a1111111-1111-1111-1111-111111111111';
    v_parent_id UUID := 'p1111111-1111-1111-1111-111111111111';
    v_student_id UUID := 's1111111-1111-1111-1111-111111111111';
    v_class_id UUID := 'c1111111-1111-1111-1111-111111111111';
    v_year_id UUID := 'y1111111-1111-1111-1111-111111111111';

    v_res JSONB;
BEGIN
    SET LOCAL session_replication_role = 'replica';

    INSERT INTO public.schools (id, name, slug, status) VALUES 
      (v_school_id, 'École Test Fix COALESCE', 'ecole-fix-coalesce', 'active')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
      (v_parent_id, v_school_id, 'parent', 'Jonas', 'Banza', true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.academic_years (id, school_id, name, is_current) VALUES
      (v_year_id, v_school_id, '2026-2027', true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.classes (id, school_id, academic_year_id, name) VALUES
      (v_class_id, v_school_id, v_year_id, '6ème Math-Physique')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.students (id, school_id, student_number, first_name, last_name) VALUES
      (v_student_id, v_school_id, 'MAT-001', 'Christian', 'Banza')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status) VALUES
      (gen_random_uuid(), v_school_id, v_student_id, v_class_id, v_year_id, 'active')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_view_attendance) VALUES
      (gen_random_uuid(), v_school_id, v_parent_id, v_student_id, 'approved', true)
    ON CONFLICT DO NOTHING;

    -- Simulation de contexte d'authentification parent
    EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_id::text);
    EXECUTE 'SET LOCAL "request.jwt.claim.role" = ''authenticated''';

    -- Exécution directe de la RPC pour valider qu'aucune erreur runtime pg_catalog.coalesce ne survient
    v_res := public.get_parent_student_attendance(v_student_id);

    IF v_res IS NULL THEN
      RAISE EXCEPTION 'Test Échoué : v_res ne doit pas être NULL';
    END IF;

    IF v_res->'records' IS NULL THEN
      RAISE EXCEPTION 'Test Échoué : v_res.records doit être un tableau JSONB (COALESCE valide)';
    END IF;

    RAISE NOTICE 'NON-REGRESSION COALESCE GET_PARENT_STUDENT_ATTENDANCE : 100%% SUCCÈS';
END;
$$;

ROLLBACK;
