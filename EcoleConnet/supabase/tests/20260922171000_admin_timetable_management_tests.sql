-- Suite de Tests SQL : 20260922171000_admin_timetable_management_tests.sql
-- Validation complète des RPCs administratives de gestion des emplois du temps (Lot 2D)

BEGIN;

DO $$
DECLARE
  v_school_a_id UUID := 'a0000000-0000-0000-0000-000000000001';
  v_school_b_id UUID := 'a0000000-0000-0000-0000-000000000002';

  v_admin_a_id UUID := 'b0000000-0000-0000-0000-000000000010';
  v_admin_b_id UUID := 'b0000000-0000-0000-0000-000000000020';
  v_teacher_user_id UUID := 'b0000000-0000-0000-0000-000000000030';
  v_parent_user_id UUID := 'b0000000-0000-0000-0000-000000000040';
  v_student_user_id UUID := 'b0000000-0000-0000-0000-000000000050';

  v_student_id UUID := 'c0000000-0000-0000-0000-000000000001';

  v_class_a_id UUID := 'd0000000-0000-0000-0000-000000000001';
  v_class_b_id UUID := 'd0000000-0000-0000-0000-000000000002';

  v_year_a_id UUID := 'e0000000-0000-0000-0000-000000000001';
  v_year_b_id UUID := 'e0000000-0000-0000-0000-000000000002';

  v_teacher_a1_id UUID := 'f0000000-0000-0000-0000-000000000001';
  v_teacher_a2_id UUID := 'f0000000-0000-0000-0000-000000000002';
  v_teacher_b_id UUID := 'f0000000-0000-0000-0000-000000000099';

  v_subject_math_id UUID := 'f0000000-0000-0000-0000-000000000010';
  v_subject_phys_id UUID := 'f0000000-0000-0000-0000-000000000011';
  v_subject_b_id UUID := 'f0000000-0000-0000-0000-000000000098';

  v_res JSONB;
  v_slot_1_id UUID;
  v_slot_2_id UUID;
  v_err_caught BOOLEAN := false;
BEGIN
  SET LOCAL session_replication_role = 'replica';

  ------------------------------------------------------------------------------
  -- 1. FIXTURES DE TEST
  ------------------------------------------------------------------------------
  -- Établissements
  INSERT INTO public.schools (id, name, slug, status) VALUES 
    (v_school_a_id, 'École Admin Alpha', 'ecole-admin-alpha', 'active'),
    (v_school_b_id, 'École Admin Beta', 'ecole-admin-beta', 'active')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'active';

  -- Profils
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
    (v_admin_a_id, v_school_a_id, 'school_admin', 'Admin', 'Alpha', true),
    (v_admin_b_id, v_school_b_id, 'school_admin', 'Admin', 'Beta', true),
    (v_teacher_user_id, v_school_a_id, 'teacher', 'Prof', 'Alpha', true),
    (v_parent_user_id, v_school_a_id, 'parent', 'Parent', 'Alpha', true)
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  -- Années Académiques & Classes
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
    (v_year_a_id, v_school_a_id, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_b_id, v_school_b_id, '2026-2027', '2026-09-01', '2027-06-30', true)
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  INSERT INTO public.classes (id, school_id, academic_year_id, name) VALUES
    (v_class_a_id, v_school_a_id, v_year_a_id, '6ème Scientifique'),
    (v_class_b_id, v_school_b_id, v_year_b_id, '5ème Biologie')
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id, academic_year_id = EXCLUDED.academic_year_id;

  -- Enseignants & Matières
  INSERT INTO public.teachers (id, school_id, employee_number, first_name, last_name, employment_status) VALUES
    (v_teacher_a1_id, v_school_a_id, 'EMP-101', 'Alain', 'Kasongo', 'active'),
    (v_teacher_a2_id, v_school_a_id, 'EMP-102', 'Claude', 'Mukendi', 'active'),
    (v_teacher_b_id, v_school_b_id, 'EMP-201', 'Benoit', 'Tshimanga', 'active')
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  INSERT INTO public.subjects (id, school_id, name, code) VALUES
    (v_subject_math_id, v_school_a_id, 'Mathématiques', 'MATH6'),
    (v_subject_phys_id, v_school_a_id, 'Physique', 'PHYS6'),
    (v_subject_b_id, v_school_b_id, 'Chimie', 'CHIM5')
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  -- Élève & Inscription & Lien Parent
  INSERT INTO public.students (id, school_id, student_number, first_name, last_name) VALUES
    (v_student_id, v_school_a_id, 'MAT-800', 'Christian', 'Banza')
  ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id;

  INSERT INTO public.student_enrollments (id, school_id, student_id, class_id, academic_year_id, status) VALUES
    (gen_random_uuid(), v_school_a_id, v_student_id, v_class_a_id, v_year_a_id, 'active')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_view_academic) VALUES
    (gen_random_uuid(), v_school_a_id, v_parent_user_id, v_student_id, 'approved', true)
  ON CONFLICT DO NOTHING;

  ------------------------------------------------------------------------------
  -- 2. TEST CONTRÔLES D'ACCÈS ET RÔLES (RPC create_school_timetable_slot)
  ------------------------------------------------------------------------------
  -- Parent tente de créer un créneau -> Refusé
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_user_id::text);
  EXECUTE 'SET LOCAL "request.jwt.claim.role" = ''authenticated''';

  v_err_caught := false;
  BEGIN
    v_res := public.create_school_timetable_slot(v_class_a_id, v_subject_math_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Un parent ne doit pas pouvoir créer de créneau d''emploi du temps';
  END IF;

  -- Enseignant tente de créer un créneau -> Refusé
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_teacher_user_id::text);

  v_err_caught := false;
  BEGIN
    v_res := public.create_school_timetable_slot(v_class_a_id, v_subject_math_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Un enseignant non admin ne doit pas pouvoir créer de créneau';
  END IF;

  ------------------------------------------------------------------------------
  -- 3. CRÉATION PAR ADMIN A (Inactif par défaut & Activation)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_admin_a_id::text);

  -- Création créneau 1 (Lundi 08:00 - 09:00, Inactif par défaut)
  v_res := public.create_school_timetable_slot(
    p_class_id => v_class_a_id,
    p_subject_id => v_subject_math_id,
    p_teacher_id => v_teacher_a1_id,
    p_room => 'Salle 101',
    p_day_of_week => 1,
    p_start_time => '08:00:00'::time,
    p_end_time => '09:00:00'::time,
    p_status => 'inactive'
  );

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 3.1 ÉCHOUÉ : La création inactive du créneau a échoué';
  END IF;

  v_slot_1_id := (v_res->>'slot_id')::uuid;

  -- Le parent ne doit pas encore voir ce créneau inactif
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_user_id::text);
  v_res := public.get_parent_student_timetable(v_student_id);

  IF (v_res->'summary'->>'total_slots')::int <> 0 THEN
    RAISE EXCEPTION 'TEST 3.2 ÉCHOUÉ : Le parent ne doit pas voir les créneaux inactifs (attendu 0, obtenu %)', (v_res->'summary'->>'total_slots');
  END IF;

  -- Activation du créneau 1 par Admin A
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_admin_a_id::text);
  v_res := public.set_school_timetable_slot_status(v_slot_1_id, 'active');

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 3.3 ÉCHOUÉ : L''activation du créneau 1 a échoué';
  END IF;

  -- Le parent doit immédiatement voir le créneau activé
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_user_id::text);
  v_res := public.get_parent_student_timetable(v_student_id);

  IF (v_res->'summary'->>'total_slots')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 3.4 ÉCHOUÉ : Le parent doit voir 1 créneau actif (obtenu %)', (v_res->'summary'->>'total_slots');
  END IF;

  ------------------------------------------------------------------------------
  -- 4. TEST DES CONFLITS ATOMIQUES (Classe, Enseignant, Salle, Créneaux Adjacents)
  ------------------------------------------------------------------------------
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_admin_a_id::text);

  -- Créneau adjacent (09:00 - 10:00) -> Doit réussir sans conflit !
  v_res := public.create_school_timetable_slot(
    p_class_id => v_class_a_id,
    p_subject_id => v_subject_phys_id,
    p_teacher_id => v_teacher_a2_id,
    p_room => 'Labo 1',
    p_day_of_week => 1,
    p_start_time => '09:00:00'::time,
    p_end_time => '10:00:00'::time,
    p_status => 'active'
  );

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 4.1 ÉCHOUÉ : Le créneau adjacent (09:00-10:00) aurait dû être accepté';
  END IF;

  v_slot_2_id := (v_res->>'slot_id')::uuid;

  -- Conflit 1 : Classe occupée (08:30 - 09:30 chevauche 08:00 - 09:00)
  v_err_caught := false;
  BEGIN
    v_res := public.create_school_timetable_slot(
      p_class_id => v_class_a_id,
      p_subject_id => v_subject_phys_id,
      p_day_of_week => 1,
      p_start_time => '08:30:00'::time,
      p_end_time => '09:30:00'::time,
      p_status => 'active'
    );
  EXCEPTION WHEN unique_violation THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 4.2 ÉCHOUÉ : Le conflit de classe aurait dû être rejeté par la RPC';
  END IF;

  -- Conflit 2 : Enseignant occupé (v_teacher_a1_id a déjà cours de 08:00 - 09:00)
  v_err_caught := false;
  BEGIN
    v_res := public.create_school_timetable_slot(
      p_class_id => v_class_a_id,
      p_subject_id => v_subject_phys_id,
      p_teacher_id => v_teacher_a1_id,
      p_day_of_week => 1,
      p_start_time => '08:30:00'::time,
      p_end_time => '09:30:00'::time,
      p_status => 'active'
    );
  EXCEPTION WHEN unique_violation THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 4.3 ÉCHOUÉ : Le conflit d''enseignant aurait dû être rejeté';
  END IF;

  -- Conflit 3 : Salle occupée ('Salle 101' occupée de 08:00 - 09:00)
  v_err_caught := false;
  BEGIN
    v_res := public.create_school_timetable_slot(
      p_class_id => v_class_a_id,
      p_subject_id => v_subject_phys_id,
      p_room => 'Salle 101',
      p_day_of_week => 1,
      p_start_time => '08:30:00'::time,
      p_end_time => '09:30:00'::time,
      p_status => 'active'
    );
  EXCEPTION WHEN unique_violation THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 4.4 ÉCHOUÉ : Le conflit de salle aurait dû être rejeté';
  END IF;

  ------------------------------------------------------------------------------
  -- 5. TEST ACCÈS INTER-ÉCOLES ET ANNULATION LOGIQUE
  ------------------------------------------------------------------------------
  -- Admin B tente de modifier un créneau de l'école A -> Refusé
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_admin_b_id::text);

  v_err_caught := false;
  BEGIN
    v_res := public.set_school_timetable_slot_status(v_slot_1_id, 'cancelled');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 5.1 ÉCHOUÉ : Admin B ne doit pas pouvoir modifier un créneau de l''École A';
  END IF;

  -- Admin A annule logiquement le créneau 1
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_admin_a_id::text);
  v_res := public.set_school_timetable_slot_status(v_slot_1_id, 'cancelled');

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 5.2 ÉCHOUÉ : L''annulation du créneau 1 par Admin A a échoué';
  END IF;

  -- Le parent ne doit plus voir le créneau annulé
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_parent_user_id::text);
  v_res := public.get_parent_student_timetable(v_student_id);

  IF (v_res->'summary'->>'total_slots')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 5.3 ÉCHOUÉ : Le parent ne doit plus voir le créneau annulé (attendu 1 restant, obtenu %)', (v_res->'summary'->>'total_slots');
  END IF;

  RAISE NOTICE 'SUITE DE TESTS GET_ADMIN_CLASS_TIMETABLE & WRITES (LOT 2D) : 100%% SUCCÈS';
END;
$$;

ROLLBACK;
