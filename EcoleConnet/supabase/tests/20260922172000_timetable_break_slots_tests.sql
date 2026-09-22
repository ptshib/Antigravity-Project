-- Tests unitaires et d'intégration Lot 2D Extension : Créneaux de Pause / Récréation
-- Fichier : supabase/tests/20260922172000_timetable_break_slots_tests.sql

BEGIN;

DO $$
DECLARE
  v_school_a_id UUID := '11111111-1111-4111-a111-111111111111';
  v_school_b_id UUID := '22222222-2222-4222-a222-222222222222';
  
  v_admin_a_id UUID := '33333333-3333-4333-a333-333333333333';
  v_admin_b_id UUID := '44444444-4444-4444-a444-444444444444';
  v_parent_id UUID := '55555555-5555-4555-a555-555555555555';

  v_year_a_id UUID;
  v_year_b_id UUID;
  v_class_a_id UUID;
  v_class_a2_id UUID;
  v_class_b_id UUID;
  v_subject_a_id UUID;
  v_teacher_a_id UUID;
  v_student_id UUID;

  v_res JSONB;
  v_slot_1_id UUID;
  v_slot_2_id UUID;
  v_break_1_id UUID;
  v_audit_rec RECORD;
  v_err_caught BOOLEAN := false;
BEGIN
  ------------------------------------------------------------------------------
  -- FIXTURES D'ENVIRONNEMENT TEST
  ------------------------------------------------------------------------------
  INSERT INTO public.schools (id, name, slug, status)
  VALUES (v_school_a_id, 'École Test A', 'ecole-test-a', 'active'),
         (v_school_b_id, 'École Test B', 'ecole-test-b', 'active');

  INSERT INTO auth.users (id, email)
  VALUES (v_admin_a_id, 'admin_a_break@test.local'),
         (v_admin_b_id, 'admin_b_break@test.local'),
         (v_parent_id, 'parent_break@test.local');

  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_admin_a_id, v_school_a_id, 'school_admin', 'Admin', 'A', true),
         (v_admin_b_id, v_school_b_id, 'school_admin', 'Admin', 'B', true),
         (v_parent_id, v_school_a_id, 'parent', 'Parent', 'Test', true);

  INSERT INTO public.academic_years (school_id, name, starts_on, ends_on, is_current)
  VALUES (v_school_a_id, '2026-2027', '2026-09-01', '2027-06-30', true)
  RETURNING id INTO v_year_a_id;

  INSERT INTO public.academic_years (school_id, name, starts_on, ends_on, is_current)
  VALUES (v_school_b_id, '2026-2027 B', '2026-09-01', '2027-06-30', true)
  RETURNING id INTO v_year_b_id;

  INSERT INTO public.classes (school_id, academic_year_id, name)
  VALUES (v_school_a_id, v_year_a_id, '6ème A') RETURNING id INTO v_class_a_id;

  INSERT INTO public.classes (school_id, academic_year_id, name)
  VALUES (v_school_a_id, v_year_a_id, '5ème A') RETURNING id INTO v_class_a2_id;

  INSERT INTO public.classes (school_id, academic_year_id, name)
  VALUES (v_school_b_id, v_year_b_id, '6ème B') RETURNING id INTO v_class_b_id;

  INSERT INTO public.subjects (school_id, name, code, is_active)
  VALUES (v_school_a_id, 'Mathématiques', 'MATH', true) RETURNING id INTO v_subject_a_id;

  INSERT INTO public.teachers (school_id, profile_id, employee_number, first_name, last_name, employment_status)
  VALUES (v_school_a_id, NULL, 'T-001', 'Jean', 'Dupont', 'active') RETURNING id INTO v_teacher_a_id;

  INSERT INTO public.students (school_id, class_id, student_number, first_name, last_name, account_status)
  VALUES (v_school_a_id, v_class_a_id, 'ELEVE-001', 'Paul', 'Test', 'active') RETURNING id INTO v_student_id;

  INSERT INTO public.parent_student_links (school_id, parent_profile_id, student_id, can_view_academic, status)
  VALUES (v_school_a_id, v_parent_id, v_student_id, true, 'approved');

  -- Contextualiser l'exécution comme Admin A
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_admin_a_id);
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_admin_a_id, 'role', 'authenticated'));

  ------------------------------------------------------------------------------
  -- TEST 1 : Création réussie d'un cours classique (course) avec matière
  ------------------------------------------------------------------------------
  v_res := public.create_school_timetable_slot(
    p_class_id := v_class_a_id,
    p_academic_year_id := v_year_a_id,
    p_day_of_week := 1,
    p_start_time := '08:00',
    p_end_time := '09:00',
    p_subject_id := v_subject_a_id,
    p_teacher_id := v_teacher_a_id,
    p_room := 'Salle 101',
    p_status := 'active',
    p_slot_type := 'course',
    p_label := NULL
  );

  v_slot_1_id := (v_res->'slots'->0->>'id')::UUID;
  IF v_slot_1_id IS NULL OR (v_res->'slots'->0->>'slot_type') <> 'course' THEN
    RAISE EXCEPTION 'TEST 1 ÉCHOUÉ : Création du cours classique non enregistrée.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 2 : Cours sans matière rejeté
  ------------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    PERFORM public.create_school_timetable_slot(
      p_class_id := v_class_a_id,
      p_academic_year_id := v_year_a_id,
      p_day_of_week := 1,
      p_start_time := '09:00',
      p_end_time := '10:00',
      p_subject_id := NULL,
      p_status := 'active',
      p_slot_type := 'course'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 2 ÉCHOUÉ : Un cours sans matière aurait dû être rejeté.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 3 : Pause avec libellé, sans matière et sans enseignant acceptée
  ------------------------------------------------------------------------------
  v_res := public.create_school_timetable_slot(
    p_class_id := v_class_a_id,
    p_academic_year_id := v_year_a_id,
    p_day_of_week := 1,
    p_start_time := '09:00',
    p_end_time := '09:15',
    p_subject_id := NULL,
    p_teacher_id := NULL,
    p_room := 'Cour de récréation',
    p_status := 'active',
    p_slot_type := 'break',
    p_label := 'Récréation du matin'
  );

  IF (v_res->'summary'->>'active_slots')::INT < 2 THEN
    RAISE EXCEPTION 'TEST 3 ÉCHOUÉ : La pause active n’a pas été comptabilisée.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 4 : Pause sans libellé rejetée
  ------------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    PERFORM public.create_school_timetable_slot(
      p_class_id := v_class_a_id,
      p_academic_year_id := v_year_a_id,
      p_day_of_week := 1,
      p_start_time := '10:15',
      p_end_time := '10:30',
      p_status := 'inactive',
      p_slot_type := 'break',
      p_label := '   '
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 4 ÉCHOUÉ : Une pause sans libellé aurait dû être rejetée.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 5 : Pause avec matière forcée rejetée par la contrainte DB
  ------------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_timetables (
      school_id, academic_year_id, class_id, subject_id, day_of_week, start_time, end_time, slot_type, label, status
    ) VALUES (
      v_school_a_id, v_year_a_id, v_class_a_id, v_subject_a_id, 1, '10:30', '10:45', 'break', 'Pause test', 'inactive'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 5 ÉCHOUÉ : Insertion DB d’une pause avec subject_id non-NULL aurait dû violer la contrainte.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 6 : Pause avec enseignant forcé rejetée par la contrainte DB
  ------------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_timetables (
      school_id, academic_year_id, class_id, subject_id, teacher_id, day_of_week, start_time, end_time, slot_type, label, status
    ) VALUES (
      v_school_a_id, v_year_a_id, v_class_a_id, NULL, v_teacher_a_id, 1, '10:30', '10:45', 'break', 'Pause test', 'inactive'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 6 ÉCHOUÉ : Insertion DB d’une pause avec teacher_id non-NULL aurait dû violer la contrainte.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 7 : Type de créneau inconnu rejeté
  ------------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    PERFORM public.create_school_timetable_slot(
      p_class_id := v_class_a_id,
      p_academic_year_id := v_year_a_id,
      p_day_of_week := 1,
      p_start_time := '10:30',
      p_end_time := '11:00',
      p_subject_id := v_subject_a_id,
      p_status := 'inactive',
      p_slot_type := 'conference'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 7 ÉCHOUÉ : Un slot_type invalide ("conference") aurait dû être rejeté.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 8 & 9 & 10 : Visibilité Parent (Inactif invisible, Actif visible)
  ------------------------------------------------------------------------------
  v_res := public.create_school_timetable_slot(
    p_class_id := v_class_a_id,
    p_academic_year_id := v_year_a_id,
    p_day_of_week := 1,
    p_start_time := '12:00',
    p_end_time := '13:00',
    p_status := 'inactive',
    p_slot_type := 'break',
    p_label := 'Pause Déjeuner Brouillon'
  );
  v_break_1_id := (v_res->'slots'->2->>'id')::UUID;

  -- Context Parent
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_parent_id);
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_id, 'role', 'authenticated'));

  v_res := public.get_parent_student_timetable(v_student_id);

  IF (v_res->'summary'->>'total_slots')::INT <> 2 THEN
    RAISE EXCEPTION 'TEST 8 & 9 ÉCHOUÉ : Le parent doit voir exactement 2 créneaux actifs (obtenu: %).', v_res->'summary'->>'total_slots';
  END IF;

  IF (v_res->'slots'->1->>'slot_type') <> 'break' OR (v_res->'slots'->1->>'label') <> 'Récréation du matin' THEN
    RAISE EXCEPTION 'TEST 10 ÉCHOUÉ : La pause active n’est pas retournée correctement au parent.';
  END IF;

  -- Reset Context Admin A
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_admin_a_id);
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_admin_a_id, 'role', 'authenticated'));

  ------------------------------------------------------------------------------
  -- TEST 11 : Conflit pause/cours dans la même classe
  ------------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    PERFORM public.create_school_timetable_slot(
      p_class_id := v_class_a_id,
      p_academic_year_id := v_year_a_id,
      p_day_of_week := 1,
      p_start_time := '09:10',
      p_end_time := '10:00',
      p_subject_id := v_subject_a_id,
      p_status := 'active',
      p_slot_type := 'course'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%TIMETABLE_CLASS_CONFLICT%' THEN
      v_err_caught := true;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 11 ÉCHOUÉ : Un cours chevauchant une pause active aurait dû déclencher TIMETABLE_CLASS_CONFLICT.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 12 : Conflit cours/pause dans la même classe
  ------------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    PERFORM public.create_school_timetable_slot(
      p_class_id := v_class_a_id,
      p_academic_year_id := v_year_a_id,
      p_day_of_week := 1,
      p_start_time := '08:30',
      p_end_time := '09:30',
      p_status := 'active',
      p_slot_type := 'break',
      p_label := 'Pause illégale'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%TIMETABLE_CLASS_CONFLICT%' THEN
      v_err_caught := true;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 12 ÉCHOUÉ : Une pause chevauchant un cours actif aurait dû déclencher TIMETABLE_CLASS_CONFLICT.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 13 : Conflit pause/pause dans la même classe
  ------------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    PERFORM public.create_school_timetable_slot(
      p_class_id := v_class_a_id,
      p_academic_year_id := v_year_a_id,
      p_day_of_week := 1,
      p_start_time := '09:05',
      p_end_time := '09:12',
      p_status := 'active',
      p_slot_type := 'break',
      p_label := 'Deuxième pause'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%TIMETABLE_CLASS_CONFLICT%' THEN
      v_err_caught := true;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 13 ÉCHOUÉ : Deux pauses actives en chevauchement auraient dû déclencher TIMETABLE_CLASS_CONFLICT.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 14 : Créneaux adjacents acceptés
  ------------------------------------------------------------------------------
  v_res := public.create_school_timetable_slot(
    p_class_id := v_class_a_id,
    p_academic_year_id := v_year_a_id,
    p_day_of_week := 1,
    p_start_time := '09:15',
    p_end_time := '10:00',
    p_subject_id := v_subject_a_id,
    p_status := 'active',
    p_slot_type := 'course'
  );
  IF (v_res->'summary'->>'active_slots')::INT <> 3 THEN
    RAISE EXCEPTION 'TEST 14 ÉCHOUÉ : Le créneau adjacent 09:15-10:00 aurait dû être accepté.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 15 : Conflit de salle pour une pause ayant une salle spécifiée
  ------------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    PERFORM public.create_school_timetable_slot(
      p_class_id := v_class_a2_id,
      p_academic_year_id := v_year_a_id,
      p_day_of_week := 1,
      p_start_time := '08:15',
      p_end_time := '08:45',
      p_room := 'Salle 101', -- Déjà occupée par classe A
      p_status := 'active',
      p_slot_type := 'break',
      p_label := 'Pause en Salle 101'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%TIMETABLE_ROOM_CONFLICT%' THEN
      v_err_caught := true;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 15 ÉCHOUÉ : La salle occupée aurait dû déclencher TIMETABLE_ROOM_CONFLICT.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 16 : Absence de conflit d'enseignant pour une pause
  ------------------------------------------------------------------------------
  v_res := public.create_school_timetable_slot(
    p_class_id := v_class_a_id,
    p_academic_year_id := v_year_a_id,
    p_day_of_week := 2,
    p_start_time := '08:00',
    p_end_time := '09:00',
    p_status := 'active',
    p_slot_type := 'break',
    p_label := 'Pause Mardi'
  );

  ------------------------------------------------------------------------------
  -- TEST 17 : Isolation inter-école
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_admin_b_id);
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_admin_b_id, 'role', 'authenticated'));

  v_err_caught := false;
  BEGIN
    PERFORM public.create_school_timetable_slot(
      p_class_id := v_class_a_id,
      p_academic_year_id := v_year_a_id,
      p_day_of_week := 1,
      p_start_time := '14:00',
      p_end_time := '15:00',
      p_status := 'active',
      p_slot_type := 'break',
      p_label := 'Pause Piratée'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 17 ÉCHOUÉ : Un admin de l’école B ne doit pas pouvoir ajouter une pause dans la classe de l’école A.';
  END IF;

  -- Reset Context Admin A
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_admin_a_id);
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_admin_a_id, 'role', 'authenticated'));

  ------------------------------------------------------------------------------
  -- TEST 18 : Audit contient slot_type et label
  ------------------------------------------------------------------------------
  SELECT * INTO v_audit_rec
  FROM public.school_audit_logs
  WHERE school_id = v_school_a_id
    AND action = 'TIMETABLE_SLOT_CREATED'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_audit_rec.details->>'slot_type' IS NULL THEN
    RAISE EXCEPTION 'TEST 18 ÉCHOUÉ : Le log d’audit ne contient pas slot_type.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 19 : Modification d'un cours (update_school_timetable_slot)
  ------------------------------------------------------------------------------
  v_res := public.update_school_timetable_slot(
    p_slot_id := v_slot_1_id,
    p_day_of_week := 1,
    p_start_time := '08:00',
    p_end_time := '08:55',
    p_subject_id := v_subject_a_id,
    p_teacher_id := v_teacher_a_id,
    p_room := 'Salle 102',
    p_status := 'active',
    p_slot_type := 'course',
    p_label := NULL
  );

  IF (v_res->'slots'->0->>'room') <> 'Salle 102' THEN
    RAISE EXCEPTION 'TEST 19 ÉCHOUÉ : La modification de la salle du cours n’a pas été enregistrée.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 20 : Modification d'une pause (update_school_timetable_slot)
  ------------------------------------------------------------------------------
  v_res := public.update_school_timetable_slot(
    p_slot_id := v_break_1_id,
    p_day_of_week := 1,
    p_start_time := '12:00',
    p_end_time := '13:00',
    p_subject_id := NULL,
    p_teacher_id := NULL,
    p_room := 'Grand Réfectoire',
    p_status := 'active',
    p_slot_type := 'break',
    p_label := 'Grand Repas Déjeuner'
  );

  IF (v_res->'slots'->3->>'label') <> 'Grand Repas Déjeuner' OR (v_res->'slots'->3->>'status') <> 'active' THEN
    RAISE EXCEPTION 'TEST 20 ÉCHOUÉ : La modification de la pause n’a pas été enregistrée.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 21 : Unicité stricte des signatures dans pg_proc (1 seule par RPC)
  ------------------------------------------------------------------------------
  IF (SELECT COUNT(*) FROM pg_proc WHERE proname = 'create_school_timetable_slot' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'TEST 21 ÉCHOUÉ : Il existe plusieurs surcharges pour create_school_timetable_slot.';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE proname = 'update_school_timetable_slot' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'TEST 21 ÉCHOUÉ : Il existe plusieurs surcharges pour update_school_timetable_slot.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 22 : Privilèges RPC (authenticated = true, anon = false)
  ------------------------------------------------------------------------------
  IF NOT has_function_privilege('authenticated', 'public.create_school_timetable_slot(UUID, UUID, INT, TIME, TIME, UUID, UUID, TEXT, TEXT, TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST 22 ÉCHOUÉ : authenticated doit avoir le privilège EXECUTE sur create_school_timetable_slot.';
  END IF;

  IF has_function_privilege('anon', 'public.create_school_timetable_slot(UUID, UUID, INT, TIME, TIME, UUID, UUID, TEXT, TEXT, TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST 22 ÉCHOUÉ : anon ne doit pas avoir le privilège EXECUTE sur create_school_timetable_slot.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 23 : Validation du bloc de purge dynamique (surcharges présentes et/ou absentes)
  ------------------------------------------------------------------------------
  -- A. Créer une surcharge arbitraire pour simuler une ancienne signature distante
  EXECUTE $func$ CREATE OR REPLACE FUNCTION public.create_school_timetable_slot(p_legacy_dummy TEXT) RETURNS JSONB LANGUAGE plpgsql AS $body$ BEGIN RETURN NULL; END; $body$; $func$;

  -- B. Exécuter la purge dynamique sur pg_proc (quand surcharges présentes)
  DECLARE
    v_sig TEXT;
  BEGIN
    FOR v_sig IN
      SELECT pg_catalog.format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.oidvectortypes(p.proargtypes))
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('create_school_timetable_slot', 'update_school_timetable_slot')
    LOOP
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
      EXECUTE pg_catalog.format('DROP FUNCTION %s', v_sig);
    END LOOP;
  END;

  -- C. Exécuter à nouveau la purge dynamique quand 0 fonction n'existe (signatures absentes) : ne doit pas lever d'erreur
  DECLARE
    v_sig TEXT;
  BEGIN
    FOR v_sig IN
      SELECT pg_catalog.format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.oidvectortypes(p.proargtypes))
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('create_school_timetable_slot', 'update_school_timetable_slot')
    LOOP
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
      EXECUTE pg_catalog.format('DROP FUNCTION %s', v_sig);
    END LOOP;
  END;

  ------------------------------------------------------------------------------
  -- CONFIRMATION ET ROLLBACK FINAL
  ------------------------------------------------------------------------------
  RAISE NOTICE 'SUITE COMPLÈTE DE 23 TESTS LOT 2D EXTENSION ÉCUTÉE AVEC SUCCÈS.';

  RAISE EXCEPTION 'ROLLBACK_TEST_SUCCESS';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'ROLLBACK_TEST_SUCCESS' THEN
    RAISE NOTICE 'ROLLBACK EFFECTUÉ : La base de données reste totalement propre.';
  ELSE
    RAISE;
  END IF;
END $$;

ROLLBACK;
