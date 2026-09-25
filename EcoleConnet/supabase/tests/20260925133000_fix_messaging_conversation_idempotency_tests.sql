-- Fichier : supabase/tests/20260925133000_fix_messaging_conversation_idempotency_tests.sql
-- Description : Suite de tests SQL transactionnels pour la correction de l'idempotence de messagerie (HOTFIX LOT 2J-T1)

BEGIN;

DO $$
DECLARE
  v_school_id UUID;
  v_academic_year_id UUID;
  v_class_id UUID;
  v_teacher_profile_id UUID := '10000000-0000-0000-0000-000000000001'::UUID;
  v_teacher_profile_2_id UUID := '10000000-0000-0000-0000-000000000002'::UUID;
  v_parent_profile_id UUID := '20000000-0000-0000-0000-000000000001'::UUID;
  v_student_id UUID := '30000000-0000-0000-0000-000000000001'::UUID;
  v_third_profile_id UUID := '40000000-0000-0000-0000-000000000001'::UUID;

  v_conv_id1 UUID;
  v_conv_id2 UUID;
  v_conv_id_seq UUID;
  v_i INTEGER;
  v_conv_count INTEGER;
  v_part_count INTEGER;
  v_parent_count INTEGER;
  v_teacher_count INTEGER;
  v_err_caught BOOLEAN;
  v_msg_res JSONB;
BEGIN
  SELECT id INTO v_school_id FROM public.schools LIMIT 1;
  SELECT id INTO v_academic_year_id FROM public.academic_years WHERE school_id = v_school_id AND is_current = true LIMIT 1;

  INSERT INTO auth.users (id, email)
  VALUES
    (v_teacher_profile_id, 'mcurie@test.local'),
    (v_teacher_profile_2_id, 'aeinstein@test.local'),
    (v_parent_profile_id, 'pcurie@test.local'),
    (v_third_profile_id, 'intrus@test.local')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, school_id, first_name, last_name, role, is_active)
  VALUES
    (v_teacher_profile_id, v_school_id, 'Marie', 'Curie', 'teacher', true),
    (v_teacher_profile_2_id, v_school_id, 'Albert', 'Einstein', 'teacher', true),
    (v_parent_profile_id, v_school_id, 'Pierre', 'Curie', 'parent', true),
    (v_third_profile_id, v_school_id, 'Intrus', 'Pirate', 'parent', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.teachers (profile_id, school_id, employee_number, first_name, last_name, employment_status, account_status)
  VALUES
    (v_teacher_profile_id, v_school_id, 'EMP-TEST-01', 'Marie', 'Curie', 'active', 'active'),
    (v_teacher_profile_2_id, v_school_id, 'EMP-TEST-02', 'Albert', 'Einstein', 'active', 'active')
  ON CONFLICT (profile_id) DO NOTHING;

  INSERT INTO public.parent_accounts (profile_id, school_id, account_status)
  VALUES (v_parent_profile_id, v_school_id, 'active')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.students (id, school_id, student_number, first_name, last_name, enrollment_status)
  VALUES (v_student_id, v_school_id, 'STU-TEST-01', 'Thomas', 'Curie', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.parent_student_links (parent_profile_id, student_id, school_id, status)
  VALUES (v_parent_profile_id, v_student_id, v_school_id, 'approved')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.classes (id, school_id, academic_year_id, name, pedagogical_mode, homeroom_teacher_id)
  VALUES ('e0000000-0000-0000-0000-000000000003'::UUID, v_school_id, v_academic_year_id, 'CP-A-TEST', 'primary_homeroom', v_teacher_profile_id)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_class_id;

  INSERT INTO public.student_enrollments (student_id, class_id, school_id, academic_year_id, status)
  VALUES (v_student_id, v_class_id, v_school_id, v_academic_year_id, 'active')
  ON CONFLICT DO NOTHING;

  -- Scénario 1 : Premier appel crée une conversation et 2 participants
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_parent_profile_id::text)::text, true);
  v_conv_id1 := public.get_or_create_school_conversation(v_student_id, v_teacher_profile_id, NULL);

  IF v_conv_id1 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 1 - Conversation UUID is NULL';
  END IF;

  -- Scénario 2 : Deuxième appel identique retourne le même UUID
  v_conv_id2 := public.get_or_create_school_conversation(v_student_id, v_teacher_profile_id, NULL);
  IF v_conv_id2 <> v_conv_id1 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 2 - Different UUIDs returned % vs %', v_conv_id1, v_conv_id2;
  END IF;

  -- Scénario 3 : 10 appels séquentiels -> toujours le même UUID
  FOR v_i IN 1..10 LOOP
    v_conv_id_seq := public.get_or_create_school_conversation(v_student_id, v_teacher_profile_id, NULL);
    IF v_conv_id_seq <> v_conv_id1 THEN
      RAISE EXCEPTION 'TEST FAILED: Scénario 3 - Iteration % returned different UUID %', v_i, v_conv_id_seq;
    END IF;
  END LOOP;

  -- Scénario 4 : Nombre total de conversations = 1
  SELECT COUNT(*) INTO v_conv_count FROM public.school_conversations WHERE student_id = v_student_id;
  IF v_conv_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 4 - Expected 1 conversation, got %', v_conv_count;
  END IF;

  -- Scénario 5 : Nombre total de participants = 2
  SELECT COUNT(*) INTO v_part_count FROM public.school_conversation_participants WHERE conversation_id = v_conv_id1;
  IF v_part_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 5 - Expected 2 participants, got %', v_part_count;
  END IF;

  -- Scénarios 6 & 7 : Aucun doublon parent, aucun doublon enseignant
  SELECT COUNT(*) INTO v_parent_count FROM public.school_conversation_participants WHERE conversation_id = v_conv_id1 AND role = 'parent';
  SELECT COUNT(*) INTO v_teacher_count FROM public.school_conversation_participants WHERE conversation_id = v_conv_id1 AND role = 'teacher';
  IF v_parent_count <> 1 OR v_teacher_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénarios 6/7 - Expected 1 parent and 1 teacher, got % parents and % teachers', v_parent_count, v_teacher_count;
  END IF;

  -- Scénario 8 : Tentative d’un troisième profil direct -> refusée
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_conversation_participants (conversation_id, profile_id, role)
    VALUES (v_conv_id1, v_third_profile_id, 'parent');
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 8 - 3rd profile insertion was not rejected!';
  END IF;

  -- Scénario 9 : Tentative de rôle parent avec profil enseignant -> refusée
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_conversation_participants (conversation_id, profile_id, role)
    VALUES (v_conv_id1, v_teacher_profile_id, 'parent');
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 9 - Teacher profile with parent role was not rejected!';
  END IF;

  -- Scénario 10 : Tentative de rôle enseignant avec profil parent -> refusée
  v_err_caught := false;
  BEGIN
    INSERT INTO public.school_conversation_participants (conversation_id, profile_id, role)
    VALUES (v_conv_id1, v_parent_profile_id, 'teacher');
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 10 - Parent profile with teacher role was not rejected!';
  END IF;

  -- Scénario 11 : Conversation existante avec 2 participants corrects -> ouverture réussie
  v_conv_id2 := public.get_or_create_school_conversation(v_student_id, v_teacher_profile_id, NULL);
  IF v_conv_id2 <> v_conv_id1 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 11 - Opening existing conversation failed';
  END IF;

  -- Scénario 12 : Conversation partielle (1 participant manquant) -> complétée atomiquement
  DELETE FROM public.school_conversation_participants WHERE conversation_id = v_conv_id1 AND profile_id = v_teacher_profile_id;
  SELECT COUNT(*) INTO v_part_count FROM public.school_conversation_participants WHERE conversation_id = v_conv_id1;
  IF v_part_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 12 setup - Expected 1 participant remaining, got %', v_part_count;
  END IF;

  v_conv_id2 := public.get_or_create_school_conversation(v_student_id, v_teacher_profile_id, NULL);
  IF v_conv_id2 <> v_conv_id1 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 12 - Completion returned different UUID';
  END IF;
  SELECT COUNT(*) INTO v_part_count FROM public.school_conversation_participants WHERE conversation_id = v_conv_id1;
  IF v_part_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 12 - Missing participant was not completed! Got %', v_part_count;
  END IF;

  -- Scénario 13 : Participant incorrect existant (corruption) -> RPC refusée
  ALTER TABLE public.school_conversation_participants DISABLE TRIGGER trg_check_school_conversation_participant_integrity;
  INSERT INTO public.school_conversation_participants (conversation_id, profile_id, role)
  VALUES (v_conv_id1, v_third_profile_id, 'parent');
  ALTER TABLE public.school_conversation_participants ENABLE TRIGGER trg_check_school_conversation_participant_integrity;

  v_err_caught := false;
  BEGIN
    PERFORM public.get_or_create_school_conversation(v_student_id, v_teacher_profile_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 13 - Corrupted conversation did not cause RPC exception!';
  END IF;
  DELETE FROM public.school_conversation_participants WHERE profile_id = v_third_profile_id;

  -- Scénario 14 : Simulation concurrence unique violation
  v_conv_id2 := public.get_or_create_school_conversation(v_student_id, v_teacher_profile_id, NULL);
  IF v_conv_id2 <> v_conv_id1 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 14 - Concurrency resolution failed';
  END IF;

  -- Scénario 15 : Historique existant inchangé
  SELECT COUNT(*) INTO v_conv_count FROM public.school_conversations WHERE id = v_conv_id1;
  IF v_conv_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 15 - Existing conversation history missing!';
  END IF;

  -- Scénario 16 : Aucune régression sur envoi, lecture, archivage
  v_msg_res := public.send_school_message(v_conv_id1, 'Message de test idempotence');
  IF (v_msg_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 16 - Message sending failed %', v_msg_res;
  END IF;
  PERFORM public.mark_school_conversation_read(v_conv_id1);
  PERFORM public.set_school_conversation_archived(v_conv_id1, true);
  PERFORM public.set_school_conversation_archived(v_conv_id1, false);

  -- Scénario 17 : Appel Parent puis appel Enseignant -> même UUID
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher_profile_id::text)::text, true);
  v_conv_id2 := public.get_or_create_school_conversation(v_student_id, v_parent_profile_id, NULL);
  IF v_conv_id2 <> v_conv_id1 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 17 - Teacher caller got different UUID % vs %', v_conv_id2, v_conv_id1;
  END IF;

  -- Scénario 18 : TEST DE REPRODUCTION EXACT DU CONTEXTE RÉEL DANIEL BANZA / GRÂCE KABEYA
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'cd1ea95d-a6f4-4431-be14-864147b1e87e')::text, true);
  v_conv_id2 := public.get_or_create_school_conversation('28af7451-c3a3-4e84-bf03-6058d76cceb7'::UUID, '0a5fffed-4292-4183-bf43-ed1ebf79cfb9'::UUID, NULL);
  IF v_conv_id2 <> 'bdbc24a1-127b-4bd2-b49d-6db9d827a587'::UUID THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 18 - Real conversation UUID mismatch %', v_conv_id2;
  END IF;

  RAISE NOTICE 'SUCCESS: Tous les 18 scénarios d idempotence de messagerie sont validés sans erreur !';
END;
$$;

ROLLBACK;
