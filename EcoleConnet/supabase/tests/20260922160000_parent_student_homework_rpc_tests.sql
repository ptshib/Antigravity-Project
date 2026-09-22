-- Suite de Tests SQL : 20260922160000_parent_student_homework_rpc_tests.sql
-- Validation complète des scénarios d'accès et d'isolation de get_parent_student_homework

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

  v_teacher_id UUID := 'f0000000-0000-0000-0000-000000000001';
  v_subject_id UUID := 'f0000000-0000-0000-0000-000000000002';

  v_hw_draft_id UUID := 'f0000000-0000-0000-0000-000000000003';
  v_hw_pub_id UUID := 'f0000000-0000-0000-0000-000000000004';
  v_hw_cancelled_id UUID := 'f0000000-0000-0000-0000-000000000005';
  v_hw_diff_class_id UUID := 'f0000000-0000-0000-0000-000000000006';

  v_res JSONB;
  v_err_caught BOOLEAN := false;
BEGIN
  SET LOCAL session_replication_role = 'replica';

  -- 1. Établissements
  INSERT INTO public.schools (id, name, slug, status) VALUES 
    (v_school_a_id, 'École Test Alpha', 'ecole-test-alpha', 'active'),
    (v_school_b_id, 'École Test Beta', 'ecole-test-beta', 'active')
  ON CONFLICT DO NOTHING;

  -- 2. Profils
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
    (v_parent_auth_id, v_school_a_id, 'parent', 'Jonas', 'Banza', true),
    (v_parent_no_perm_id, v_school_a_id, 'parent', 'Marc', 'Kambale', true),
    (v_parent_school_b_id, v_school_b_id, 'parent', 'Paul', 'Mukendi', true)
  ON CONFLICT DO NOTHING;

  -- 3. Années Académiques & Classes
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
    (v_year_a_id, v_school_a_id, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_b_id, v_school_b_id, '2026-2027', '2026-09-01', '2027-06-30', true)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.classes (id, school_id, academic_year_id, name) VALUES
    (v_class_a_id, v_school_a_id, v_year_a_id, '6ème Math-Physique'),
    (v_class_b_id, v_school_a_id, v_year_a_id, '5ème Biologie')
  ON CONFLICT DO NOTHING;

  -- 4. Enseignant & Matière
  INSERT INTO public.teachers (id, school_id, employee_number, first_name, last_name) VALUES
    (v_teacher_id, v_school_a_id, 'EMP-001', 'Alain', 'Kasongo')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.subjects (id, school_id, name, code) VALUES
    (v_subject_id, v_school_a_id, 'Mathématiques', 'MATH6')
  ON CONFLICT DO NOTHING;

  -- 5. Élèves & Inscriptions Actives
  INSERT INTO public.students (id, school_id, student_number, first_name, last_name) VALUES
    (v_student_auth_id, v_school_a_id, 'MAT-001', 'Christian', 'Banza'),
    (v_student_unlinked_id, v_school_a_id, 'MAT-002', 'Franck', 'Banza')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status) VALUES
    (gen_random_uuid(), v_school_a_id, v_student_auth_id, v_class_a_id, v_year_a_id, 'active'),
    (gen_random_uuid(), v_school_a_id, v_student_unlinked_id, v_class_a_id, v_year_a_id, 'active')
  ON CONFLICT DO NOTHING;

  -- 6. Liens Parent-Élève
  INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_view_homework) VALUES
    (gen_random_uuid(), v_school_a_id, v_parent_auth_id, v_student_auth_id, 'approved', true),
    (gen_random_uuid(), v_school_a_id, v_parent_no_perm_id, v_student_auth_id, 'approved', false)
  ON CONFLICT DO NOTHING;

  -- 7. Devoirs de Test (Brouillon, Publié, Annulé, Autre Classe)
  INSERT INTO public.school_homework (
    id, school_id, academic_year_id, class_id, subject_id, teacher_id, title, instructions, assigned_on, due_at, status, created_by
  ) VALUES
    (v_hw_draft_id, v_school_a_id, v_year_a_id, v_class_a_id, v_subject_id, v_teacher_id, 'Brouillon Équations', 'Non publié', '2026-09-20', '2026-09-25 17:00:00+00', 'draft', v_parent_auth_id),
    (v_hw_pub_id, v_school_a_id, v_year_a_id, v_class_a_id, v_subject_id, v_teacher_id, 'Devoir Algèbre n°1', 'Résoudre les exercices 1 à 5', '2026-09-21', '2026-09-28 17:00:00+00', 'published', v_parent_auth_id),
    (v_hw_cancelled_id, v_school_a_id, v_year_a_id, v_class_a_id, v_subject_id, v_teacher_id, 'Devoir Annulé', 'Annulé par le prof', '2026-09-19', '2026-09-22 17:00:00+00', 'cancelled', v_parent_auth_id),
    (v_hw_diff_class_id, v_school_a_id, v_year_a_id, v_class_b_id, v_subject_id, v_teacher_id, 'Devoir Autre Classe', 'Pour la 5ème', '2026-09-20', '2026-09-26 17:00:00+00', 'published', v_parent_auth_id)
  ON CONFLICT DO NOTHING;

  ------------------------------------------------------------------------------
  -- TEST 1 : Parent autorisé consultait son enfant rattaché (Devoirs filtrés)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_auth_id::text);
  EXECUTE 'SET LOCAL "request.jwt.claim.role" = ''authenticated''';

  v_res := public.get_parent_student_homework(v_student_auth_id);

  IF v_res IS NULL THEN
    RAISE EXCEPTION 'TEST 1 ÉCHOUÉ : v_res ne doit pas être NULL';
  END IF;

  IF (v_res->'summary'->>'total')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 1 ÉCHOUÉ : Attendu 1 seul devoir publié, obtenu %', (v_res->'summary'->>'total');
  END IF;

  IF jsonb_array_length(v_res->'homework') <> 1 THEN
    RAISE EXCEPTION 'TEST 1 ÉCHOUÉ : Le tableau homework doit contenir exactement 1 élément';
  END IF;

  IF v_res->'homework'->0->>'title' <> 'Devoir Algèbre n°1' THEN
    RAISE EXCEPTION 'TEST 1 ÉCHOUÉ : Titre inattendu %', (v_res->'homework'->0->>'title');
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 2 : Parent avec can_view_homework = false -> Exception 42501
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_no_perm_id::text);
  
  v_err_caught := false;
  BEGIN
    v_res := public.get_parent_student_homework(v_student_auth_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 2 ÉCHOUÉ : Accès non rejeté pour permission can_view_homework = false';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 3 : Parent d'une autre école -> Exception 42501
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_school_b_id::text);
  
  v_err_caught := false;
  BEGIN
    v_res := public.get_parent_student_homework(v_student_auth_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 3 ÉCHOUÉ : Accès non rejeté pour parent d''une autre école';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 4 : Élève non rattaché -> Exception 42501
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_auth_id::text);
  
  v_err_caught := false;
  BEGIN
    v_res := public.get_parent_student_homework(v_student_unlinked_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 4 ÉCHOUÉ : Accès non rejeté pour élève non rattaché';
  END IF;

  RAISE NOTICE 'SUITE DE TESTS GET_PARENT_STUDENT_HOMEWORK : 100%% SUCCÈS';
END;
$$;

ROLLBACK;
