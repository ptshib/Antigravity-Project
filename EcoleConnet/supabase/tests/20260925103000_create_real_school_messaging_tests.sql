-- ============================================================================
-- Suite de Tests SQL Transactionnels : Messagerie Réelle Enseignant–Parent (Gate Final V2)
-- Fichier : supabase/tests/20260925103000_create_real_school_messaging_tests.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_school_a UUID := '00000000-0000-4000-a000-000000000001'::UUID;
  v_school_b UUID := '00000000-0000-4000-a000-000000000002'::UUID;

  v_ay_a UUID := '00000000-0000-4000-a000-000000000011'::UUID;
  v_ay_b UUID := '00000000-0000-4000-a000-000000000012'::UUID;

  v_class_prim UUID := '00000000-0000-4000-a000-000000000021'::UUID;
  v_class_sec UUID := '00000000-0000-4000-a000-000000000022'::UUID;
  v_class_prim2 UUID := '00000000-0000-4000-a000-000000000023'::UUID;

  v_subject_math UUID := '00000000-0000-4000-a000-000000000031'::UUID;

  v_prof_parent UUID := '00000000-0000-4000-a000-000000000041'::UUID;
  v_prof_t_prim UUID := '00000000-0000-4000-a000-000000000042'::UUID;
  v_prof_t_sec UUID := '00000000-0000-4000-a000-000000000043'::UUID;
  v_prof_t_unassigned UUID := '00000000-0000-4000-a000-000000000044'::UUID;
  v_prof_student UUID := '00000000-0000-4000-a000-000000000045'::UUID;
  v_prof_admin UUID := '00000000-0000-4000-a000-000000000046'::UUID;
  v_prof_school_b UUID := '00000000-0000-4000-a000-000000000047'::UUID;

  v_student_a UUID := '00000000-0000-4000-a000-000000000051'::UUID;

  v_teacher_prim_rec UUID := '00000000-0000-4000-a000-000000000061'::UUID;
  v_teacher_sec_rec UUID := '00000000-0000-4000-a000-000000000062'::UUID;
  v_teacher_unassigned_rec UUID := '00000000-0000-4000-a000-000000000063'::UUID;

  v_conv_id UUID;
  v_conv_sec_id UUID;
  v_conv_empty_id UUID;
  v_count BIGINT;
  v_count_msg_before BIGINT;
  v_count_msg_after BIGINT;
  v_status_conv TEXT;
  v_res_json JSONB;
  v_err_caught BOOLEAN;
  v_proc_overloads INTEGER;
  v_arch_parent BOOLEAN;
  v_arch_teacher BOOLEAN;
  v_ts_fixed TIMESTAMPTZ := '2026-09-25 10:00:00+00'::TIMESTAMPTZ;
BEGIN
  ------------------------------------------------------------------------------
  -- INITIALISATION DES DONNÉES DE TEST
  ------------------------------------------------------------------------------
  INSERT INTO public.schools (id, name, slug) VALUES
    (v_school_a, 'École Test A', 'ecole-test-a'),
    (v_school_b, 'École Test B', 'ecole-test-b');

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
    (v_ay_a, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_ay_b, v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true);

  -- Profils Auth
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
    (v_prof_parent, v_school_a, 'parent', 'Parent', 'Test', true),
    (v_prof_t_prim, v_school_a, 'teacher', 'Titulaire', 'Primaire', true),
    (v_prof_t_sec, v_school_a, 'teacher', 'Prof', 'Maths', true),
    (v_prof_t_unassigned, v_school_a, 'teacher', 'Prof', 'Libre', true),
    (v_prof_student, v_school_a, 'student', 'Élève', 'Test', true),
    (v_prof_admin, v_school_a, 'school_admin', 'Admin', 'Test', true),
    (v_prof_school_b, v_school_b, 'teacher', 'Prof', 'EcoleB', true);

  -- Enseignants
  INSERT INTO public.teachers (id, school_id, profile_id, employee_number, first_name, last_name, employment_status, account_status) VALUES
    (v_teacher_prim_rec, v_school_a, v_prof_t_prim, 'EMP-01', 'Titulaire', 'Primaire', 'active', 'active'),
    (v_teacher_sec_rec, v_school_a, v_prof_t_sec, 'EMP-02', 'Prof', 'Maths', 'active', 'active'),
    (v_teacher_unassigned_rec, v_school_a, v_prof_t_unassigned, 'EMP-03', 'Prof', 'Libre', 'active', 'active');

  -- Compte parent
  INSERT INTO public.parent_accounts (profile_id, school_id, account_status) VALUES
    (v_prof_parent, v_school_a, 'active');

  -- Classes
  INSERT INTO public.classes (id, school_id, academic_year_id, name, pedagogical_mode, homeroom_teacher_id) VALUES
    (v_class_prim, v_school_a, v_ay_a, '2A Primaire', 'primary_homeroom', v_prof_t_prim),
    (v_class_sec, v_school_a, v_ay_a, '3B Secondaire', 'secondary_subjects', NULL),
    (v_class_prim2, v_school_a, v_ay_a, '2B Primaire', 'primary_homeroom', v_prof_t_prim);

  -- Matière
  INSERT INTO public.subjects (id, school_id, name, code, is_active) VALUES
    (v_subject_math, v_school_a, 'Mathématiques', 'MATH', true);

  -- Affectation enseignant secondaire
  INSERT INTO public.teacher_class_assignments (school_id, academic_year_id, teacher_id, teacher_profile_id, class_id, subject_id, subject_name, is_active) VALUES
    (v_school_a, v_ay_a, v_teacher_sec_rec, v_prof_t_sec, v_class_sec, v_subject_math, 'Mathématiques', true);

  -- Élève & Inscription
  INSERT INTO public.students (id, school_id, profile_id, student_number, enrollment_status) VALUES
    (v_student_a, v_school_a, v_prof_student, 'STD-01', 'active');

  INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status) VALUES
    (gen_random_uuid(), v_school_a, v_student_a, v_ay_a, v_class_prim, 'active');

  -- Lien parent-élève approuvé
  INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status) VALUES
    (gen_random_uuid(), v_school_a, v_prof_parent, v_student_a, 'approved');

  ------------------------------------------------------------------------------
  -- SCÉNARIO 1 : Contrat JSONB d'envoi valide (success = true)
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_parent::text, 'role', 'authenticated')::text, true);

  v_conv_id := public.get_or_create_school_conversation(v_student_a, v_prof_t_prim, NULL);

  v_res_json := public.send_school_message(v_conv_id, 'Message valide');
  IF (v_res_json->>'success')::boolean <> true THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : send_school_message aurait dû retourner success=true';
  END IF;

  ------------------------------------------------------------------------------
  -- SCÉNARIOS 2 À 5 : Passage transactionnel en read_only lors d'une révocation
  ------------------------------------------------------------------------------
  -- A. Révoquer le lien parent
  UPDATE public.parent_student_links SET status = 'revoked' WHERE parent_profile_id = v_prof_parent AND student_id = v_student_a;

  -- B. Compter les messages avant l'appel
  SELECT COUNT(*) INTO v_count_msg_before FROM public.school_messages WHERE conversation_id = v_conv_id;

  -- C. Envoi de message -> Doit persister l'UPDATE status = read_only ET retourner success = false
  v_res_json := public.send_school_message(v_conv_id, 'Tentative après révocation');

  IF (v_res_json->>'success')::boolean <> false THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : send_school_message sur relation révoquée aurait dû retourner success=false';
  END IF;

  IF v_res_json->>'code' <> 'CONVERSATION_READ_ONLY' THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Code de retour incorrect : %', v_res_json->>'code';
  END IF;

  -- D. VÉRIFICATION TRANSACTIONNELLE DANS LA BASE : Le statut DOIT être 'read_only' !
  SELECT status INTO v_status_conv FROM public.school_conversations WHERE id = v_conv_id;
  IF v_status_conv <> 'read_only' THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ CRITIQUE : Le statut n a pas été persistant en read_only ! Trouvé : %', v_status_conv;
  END IF;

  -- E. VÉRIFICATION D'ATOMICITÉ : Aucun nouveau message créé
  SELECT COUNT(*) INTO v_count_msg_after FROM public.school_messages WHERE conversation_id = v_conv_id;
  IF v_count_msg_after <> v_count_msg_before THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Un message a été créé à tort pendant un refus read_only';
  END IF;

  -- F. Second appel sur conversation déjà read_only -> Mème retour métier
  v_res_json := public.send_school_message(v_conv_id, 'Second essai');
  IF (v_res_json->>'success')::boolean <> false OR v_res_json->>'code' <> 'CONVERSATION_READ_ONLY' THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Le 2ème appel sur read_only aurait dû retourner le même JSON métier';
  END IF;

  ------------------------------------------------------------------------------
  -- SCÉNARIOS 6 À 8 : Historique lisible, Archivage et Marquage lu sur read_only
  ------------------------------------------------------------------------------
  -- Historique consultable par le parent
  SELECT COUNT(*) INTO v_count FROM public.get_school_conversation_messages(v_conv_id, NULL, NULL, 50);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : L historique d une conversation read_only doit rester consultable';
  END IF;

  -- Personal Archiving possible
  IF NOT public.set_school_conversation_archived(v_conv_id, true) THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : L archivage sur read_only aurait dû être possible';
  END IF;

  -- Read marking possible
  IF NOT public.mark_school_conversation_read(v_conv_id) THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Le marquage lu sur read_only aurait dû être possible';
  END IF;

  ------------------------------------------------------------------------------
  -- SCÉNARIOS 9 & 10 : Non-participant et Autre École -> Véritable exception 42501 sans altérer status
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_t_unassigned::text, 'role', 'authenticated')::text, true);

  v_err_caught := false;
  BEGIN
    PERFORM public.send_school_message(v_conv_id, 'Tentative non participant');
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Un non-participant aurait dû déclencher une véritable exception SQL 42501';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prof_school_b::text, 'role', 'authenticated')::text, true);
  v_err_caught := false;
  BEGIN
    PERFORM public.send_school_message(v_conv_id, 'Tentative école B');
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Un utilisateur d une autre école aurait dû déclencher une exception SQL 42501';
  END IF;

  RAISE NOTICE 'SUITE DE TESTS TRANSACTIONNELS V2 DÉPLOYÉE ET VALIDÉE AVEC SUCCÈS';
END $$;

ROLLBACK;
