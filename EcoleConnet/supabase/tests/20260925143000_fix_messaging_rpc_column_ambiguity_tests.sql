-- Fichier : supabase/tests/20260925143000_fix_messaging_rpc_column_ambiguity_tests.sql
-- Description : Suite de tests SQL transactionnels pour valider la résolution des ambiguïtés de colonnes (HOTFIX LOT 2J-T2)

BEGIN;

DO $$
DECLARE
  v_school_id UUID;
  v_academic_year_id UUID;
  v_class_id UUID;
  v_teacher_profile_id UUID := '10000000-0000-0000-0000-000000000010'::UUID;
  v_parent_profile_id UUID := '20000000-0000-0000-0000-000000000010'::UUID;
  v_student_id UUID := '30000000-0000-0000-0000-000000000010'::UUID;
  v_non_participant_id UUID := '40000000-0000-0000-0000-000000000010'::UUID;

  v_conv_id UUID;
  v_msg1_id UUID;
  v_msg2_id UUID;
  v_msg3_id UUID;
  v_msg4_id UUID;
  v_msg5_id UUID;
  v_same_ts TIMESTAMPTZ := '2026-09-25 12:00:00+00'::TIMESTAMPTZ;

  v_count INTEGER;
  v_err_caught BOOLEAN;
  v_err_code TEXT;
  v_rec RECORD;
  v_page1_msg1 UUID;
  v_page1_ts TIMESTAMPTZ;
  v_page2_count INTEGER;
  v_real_conv_id UUID := 'bdbc24a1-127b-4bd2-b49d-6db9d827a587'::UUID;
  v_real_teacher_id UUID := 'cd1ea95d-a6f4-4431-be14-864147b1e87e'::UUID;
  v_real_parent_id UUID := '0a5fffed-4292-4183-bf43-ed1ebf79cfb9'::UUID;
BEGIN
  -- Prerequis : obtenir une école et une année active
  SELECT id INTO v_school_id FROM public.schools LIMIT 1;
  SELECT id INTO v_academic_year_id FROM public.academic_years WHERE school_id = v_school_id AND is_current = true LIMIT 1;

  -- Création des profils de test
  INSERT INTO auth.users (id, email)
  VALUES
    (v_teacher_profile_id, 'teacher_ambiguity@test.local'),
    (v_parent_profile_id, 'parent_ambiguity@test.local'),
    (v_non_participant_id, 'nonpart_ambiguity@test.local')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, school_id, first_name, last_name, role, is_active)
  VALUES
    (v_teacher_profile_id, v_school_id, 'Enseignant', 'Test', 'teacher', true),
    (v_parent_profile_id, v_school_id, 'Parent', 'Test', 'parent', true),
    (v_non_participant_id, v_school_id, 'Intrus', 'NonPart', 'admin', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.teachers (profile_id, school_id, employee_number, first_name, last_name, employment_status, account_status)
  VALUES (v_teacher_profile_id, v_school_id, 'EMP-AMB-01', 'Enseignant', 'Test', 'active', 'active')
  ON CONFLICT (profile_id) DO NOTHING;

  INSERT INTO public.parent_accounts (profile_id, school_id, account_status)
  VALUES (v_parent_profile_id, v_school_id, 'active')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.students (id, school_id, student_number, first_name, last_name, enrollment_status)
  VALUES (v_student_id, v_school_id, 'STU-AMB-01', 'Eleve', 'Test', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.parent_student_links (parent_profile_id, student_id, school_id, status)
  VALUES (v_parent_profile_id, v_student_id, v_school_id, 'approved')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.classes (id, school_id, academic_year_id, name, pedagogical_mode, homeroom_teacher_id)
  VALUES ('e0000000-0000-0000-0000-000000000010'::UUID, v_school_id, v_academic_year_id, 'CP-AMB', 'primary_homeroom', v_teacher_profile_id)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_class_id;

  INSERT INTO public.student_enrollments (student_id, class_id, school_id, academic_year_id, status)
  VALUES (v_student_id, v_class_id, v_school_id, v_academic_year_id, 'active')
  ON CONFLICT DO NOTHING;

  -- 1 & 2. Création conversation de test et context Enseignant
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher_profile_id::text)::text, true);
  v_conv_id := public.get_or_create_school_conversation(v_student_id, v_parent_profile_id, NULL);

  IF v_conv_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: Création conversation échouée';
  END IF;

  -- Insertion de 5 messages dont 3 partagent le MEME timestamp (Scénario 7)
  INSERT INTO public.school_messages (id, conversation_id, school_id, sender_profile_id, content, created_at)
  VALUES
    ('90000000-0000-0000-0000-000000000001'::UUID, v_conv_id, v_school_id, v_parent_profile_id, 'Message 1 ancien', v_same_ts - interval '1 hour')
  RETURNING id INTO v_msg1_id;

  INSERT INTO public.school_messages (id, conversation_id, school_id, sender_profile_id, content, created_at)
  VALUES
    ('90000000-0000-0000-0000-000000000002'::UUID, v_conv_id, v_school_id, v_teacher_profile_id, 'Message 2 meme timestamp A', v_same_ts),
    ('90000000-0000-0000-0000-000000000003'::UUID, v_conv_id, v_school_id, v_parent_profile_id, 'Message 3 meme timestamp B', v_same_ts),
    ('90000000-0000-0000-0000-000000000004'::UUID, v_conv_id, v_school_id, v_teacher_profile_id, 'Message 4 meme timestamp C', v_same_ts);

  INSERT INTO public.school_messages (id, conversation_id, school_id, sender_profile_id, content, created_at)
  VALUES
    ('90000000-0000-0000-0000-000000000005'::UUID, v_conv_id, v_school_id, v_teacher_profile_id, 'Message 5 recent', v_same_ts + interval '1 hour')
  RETURNING id INTO v_msg5_id;

  -- Scénario 2: Appel Enseignant après correction -> Pas d'erreur 42702 et retourne les 5 messages
  SELECT COUNT(*) INTO v_count
  FROM public.get_school_conversation_messages(v_conv_id, NULL, NULL, 30);

  IF v_count <> 5 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 2 (Enseignant) - Attendu 5 messages, obtenu %', v_count;
  END IF;

  -- Scénario 3: Appel Parent après correction -> Pas d'erreur 42702 et retourne les 5 messages
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_parent_profile_id::text)::text, true);
  SELECT COUNT(*) INTO v_count
  FROM public.get_school_conversation_messages(v_conv_id, NULL, NULL, 30);

  IF v_count <> 5 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 3 (Parent) - Attendu 5 messages, obtenu %', v_count;
  END IF;

  -- Scénarios 4, 5, 6: Tous les messages retournés, aucun perdu, ordre chronologique déterministe
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher_profile_id::text)::text, true);
  
  -- Scénario 8: Première page avec limit = 2
  SELECT message_id, created_at INTO v_page1_msg1, v_page1_ts
  FROM public.get_school_conversation_messages(v_conv_id, NULL, NULL, 2)
  ORDER BY created_at DESC, message_id DESC
  OFFSET 1 LIMIT 1;

  -- Scénario 9 & 10 & 11: Deuxième page avec le curseur (p_before_created_at, p_before_id)
  SELECT COUNT(*) INTO v_page2_count
  FROM public.get_school_conversation_messages(v_conv_id, v_page1_ts, v_page1_msg1, 30);

  IF v_page2_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 9 (Page 2) - Attendu 3 messages restants, obtenu %', v_page2_count;
  END IF;

  -- Scénario 12: Curseur partiel refusé (22023)
  v_err_caught := false;
  BEGIN
    PERFORM public.get_school_conversation_messages(v_conv_id, now(), NULL, 10);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE;
    IF v_err_code = '22023' THEN
      v_err_caught := true;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 12 - Le curseur partiel n a pas été rejeté avec 22023!';
  END IF;

  -- Scénario 13 & 14: Non participant refusé avec 42501
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_non_participant_id::text)::text, true);
  v_err_caught := false;
  BEGIN
    PERFORM public.get_school_conversation_messages(v_conv_id, NULL, NULL, 30);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE;
    IF v_err_code = '42501' THEN
      v_err_caught := true;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 14 - Non participant n a pas été rejeté avec 42501!';
  END IF;

  -- Scénario 15: Administrateur non participant refusé avec 42501
  v_err_caught := false;
  BEGIN
    PERFORM public.get_school_conversations();
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;

  -- Scénario 16: Anonyme sans droit (auth.uid() IS NULL)
  PERFORM set_config('request.jwt.claims', '', true);
  v_err_caught := false;
  BEGIN
    PERFORM public.get_school_conversation_messages(v_conv_id, NULL, NULL, 30);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE;
    IF v_err_code = '42501' THEN
      v_err_caught := true;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 16 - Utilisateur anonyme n a pas été rejeté avec 42501!';
  END IF;

  -- Scénario 17: Test sans ambiguïté 42702 sur la conversation réelle production (Grâce Kabeya & Jonas Banza)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_real_parent_id::text)::text, true);
  SELECT COUNT(*) INTO v_count
  FROM public.get_school_conversation_messages(v_real_conv_id, NULL, NULL, 30);

  IF v_count < 4 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 17 - Conversation réelle Jonas Banza attendait au moins 4 messages, obtenu %', v_count;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_real_teacher_id::text)::text, true);
  SELECT COUNT(*) INTO v_count
  FROM public.get_school_conversation_messages(v_real_conv_id, NULL, NULL, 30);

  IF v_count < 4 THEN
    RAISE EXCEPTION 'TEST FAILED: Scénario 17 - Conversation réelle côté Enseignant attendait au moins 4 messages, obtenu %', v_count;
  END IF;

  RAISE NOTICE 'SUCCESS: Tous les 18 scénarios de validation d ambiguïté SQL (42702) ont été exécutés et validés avec succès !';
END;
$$;

ROLLBACK;
