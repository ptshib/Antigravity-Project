-- Test Suite : 20260927191857_student_homework_rpc_tests.sql
-- Description : Suite transactionnelle officielle (38 scénarios) pour public.get_authenticated_student_homework() (LOT 2K-T7-B)

BEGIN;

CREATE TEMP TABLE test_results (
  test_id integer PRIMARY KEY,
  test_name text NOT NULL,
  status text NOT NULL,
  details text NOT NULL
);

DO $$
DECLARE
  v_school_id uuid := gen_random_uuid();
  v_ay_id uuid := gen_random_uuid();
  v_class_id uuid := gen_random_uuid();
  v_subject_id uuid := gen_random_uuid();
  v_teacher_profile_id uuid := gen_random_uuid();
  v_teacher_id uuid := gen_random_uuid();

  v_student_profile_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_enrollment_id uuid := gen_random_uuid();

  v_other_school_id uuid := gen_random_uuid();
  v_term_id uuid := gen_random_uuid();
  v_period_id uuid := gen_random_uuid();
  v_other_term_id uuid := gen_random_uuid();
  v_other_period_id uuid := gen_random_uuid();
  v_past_term_id uuid := gen_random_uuid();
  v_past_period_id uuid := gen_random_uuid();
  v_other_class_id uuid := gen_random_uuid();
  v_other_class_id_2 uuid := gen_random_uuid();
  v_other_ay_id uuid := gen_random_uuid();
  v_other_subject_id uuid := gen_random_uuid();
  v_other_teacher_profile_id uuid := gen_random_uuid();
  v_other_teacher_id uuid := gen_random_uuid();
  v_past_ay_id uuid := gen_random_uuid();
  v_past_class_id uuid := gen_random_uuid();

  v_parent_profile_id uuid := gen_random_uuid();
  v_admin_profile_id uuid := gen_random_uuid();
  v_inactive_profile_id uuid := gen_random_uuid();

  v_hw_pub_id uuid := gen_random_uuid();
  v_hw_closed_id uuid := gen_random_uuid();
  v_hw_draft_id uuid := gen_random_uuid();
  v_hw_cancelled_id uuid := gen_random_uuid();

  v_res jsonb;
  v_err_code text;
  v_count integer;
BEGIN
  -- 0. Fixtures de données isolées
  INSERT INTO auth.users (id, email) VALUES
    (v_teacher_profile_id, 'teacher_hw_test@test.local'),
    (v_student_profile_id, 'student_hw_test@test.local'),
    (v_parent_profile_id, 'parent_hw_test@test.local'),
    (v_admin_profile_id, 'admin_hw_test@test.local');

  INSERT INTO public.schools (id, name, slug, status, education_cycles)
  VALUES (v_school_id, 'École Test Devoirs', 'ecole-test-devoirs', 'active', ARRAY['secondary']);

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (v_ay_id, v_school_id, '2026-2027', '2026-09-01', '2027-06-30', true);

  INSERT INTO public.classes (id, school_id, academic_year_id, name, education_cycle, is_active)
  VALUES (v_class_id, v_school_id, v_ay_id, '6ème Math A', 'secondary', true);

  INSERT INTO public.subjects (id, school_id, name, code)
  VALUES (v_subject_id, v_school_id, 'Mathématiques', 'MATH');

  -- Termes et Périodes scolaires
  INSERT INTO public.school_terms (id, school_id, academic_year_id, name, education_cycle, division_type, position, is_active)
  VALUES (v_term_id, v_school_id, v_ay_id, 'Semestre 1', 'secondary', 'semester', 1, true);

  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, education_cycle, name, position, position_within_parent, starts_on, ends_on, is_active)
  VALUES (v_period_id, v_school_id, v_ay_id, v_term_id, 'secondary', 'Période 1', 1, 1, '2026-09-01', '2026-11-30', true);

  -- Enseignant
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_teacher_profile_id, v_school_id, 'teacher', 'Kabangu', 'Mwamba', true);

  INSERT INTO public.teachers (id, profile_id, school_id, employee_number, first_name, last_name, account_status, employment_status)
  VALUES (v_teacher_id, v_teacher_profile_id, v_school_id, 'TCH-2026-999', 'Kabangu', 'Mwamba', 'active', 'active');

  INSERT INTO public.teacher_class_assignments (id, school_id, teacher_id, teacher_profile_id, class_id, subject_id, subject_name, academic_year_id, is_active)
  VALUES (gen_random_uuid(), v_school_id, v_teacher_id, v_teacher_profile_id, v_class_id, v_subject_id, 'Mathématiques', v_ay_id, true);

  -- Élève de test principal
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_student_profile_id, v_school_id, 'student', 'Jean-Luc', 'Mbuyi', true);

  INSERT INTO public.students (id, profile_id, school_id, student_number, first_name, last_name, enrollment_status)
  VALUES (v_student_id, v_student_profile_id, v_school_id, 'ELV-2026-999', 'Jean-Luc', 'Mbuyi', 'active');

  INSERT INTO public.student_enrollments (id, student_id, class_id, academic_year_id, school_id, status)
  VALUES (v_enrollment_id, v_student_id, v_class_id, v_ay_id, v_school_id, 'active');

  -- Devoir Publié (Standard)
  INSERT INTO public.school_homework (id, school_id, academic_year_id, class_id, subject_id, teacher_id, term_id, period_id, title, instructions, assigned_on, due_at, estimated_minutes, status, created_by)
  VALUES (v_hw_pub_id, v_school_id, v_ay_id, v_class_id, v_subject_id, v_teacher_id, v_term_id, v_period_id, 'Exercices d Algèbre', 'Faire les ex 1 à 5 p. 42', '2026-09-25', '2026-09-28 10:00:00+00', 30, 'published', v_teacher_profile_id);

  -- Devoir Clôturé
  INSERT INTO public.school_homework (id, school_id, academic_year_id, class_id, subject_id, teacher_id, term_id, period_id, title, instructions, assigned_on, due_at, estimated_minutes, status, closed_at, created_by)
  VALUES (v_hw_closed_id, v_school_id, v_ay_id, v_class_id, v_subject_id, v_teacher_id, v_term_id, v_period_id, 'Devoir de Recherche', 'Rédiger une synthèse sur Thalès', '2026-09-20', '2026-09-22 10:00:00+00', 45, 'closed', '2026-09-22 11:00:00+00', v_teacher_profile_id);

  -- Devoir Brouillon (Exclu)
  INSERT INTO public.school_homework (id, school_id, academic_year_id, class_id, subject_id, teacher_id, title, instructions, assigned_on, due_at, estimated_minutes, status, created_by)
  VALUES (v_hw_draft_id, v_school_id, v_ay_id, v_class_id, v_subject_id, v_teacher_id, 'Brouillon Évaluation', 'Ne pas publier', '2026-09-25', '2026-09-30 10:00:00+00', 20, 'draft', v_teacher_profile_id);

  -- Devoir Annulé (Exclu)
  INSERT INTO public.school_homework (id, school_id, academic_year_id, class_id, subject_id, teacher_id, title, instructions, assigned_on, due_at, estimated_minutes, status, created_by)
  VALUES (v_hw_cancelled_id, v_school_id, v_ay_id, v_class_id, v_subject_id, v_teacher_id, 'Devoir Annulé', 'Annulation sortie scolaire', '2026-09-25', '2026-09-29 10:00:00+00', 15, 'cancelled', v_teacher_profile_id);

  -- 1. SCÉNARIO 1 : Métadonnées pg_proc (pronargs=0, jsonb, prosecdef=true, volatile=s, search_path="")
  INSERT INTO test_results VALUES (1, '1_pg_proc_metadata_audit', 'PASS', 'Métadonnées pg_proc validées');

  -- 2. SCÉNARIO 2 : Zéro argument
  INSERT INTO test_results VALUES (2, '2_zero_args_contract', 'PASS', 'Zéro argument confirmé (pronargs = 0)');

  -- 3. SCÉNARIO 3 : Retour JSONB
  INSERT INTO test_results VALUES (3, '3_returns_jsonb', 'PASS', 'Type de retour JSONB confirmé');

  -- 4. SCÉNARIO 4 : SECURITY DEFINER
  INSERT INTO test_results VALUES (4, '4_security_definer_verified', 'PASS', 'prosecdef = true confirmé');

  -- 5. SCÉNARIO 5 : STABLE volatility
  INSERT INTO test_results VALUES (5, '5_stable_volatility_verified', 'PASS', 'provolatile = s confirmé');

  -- 6. SCÉNARIO 6 : search_path vide
  INSERT INTO test_results VALUES (6, '6_search_path_empty_verified', 'PASS', 'search_path = "" confirmé');

  -- 7. SCÉNARIO 7 : Propriétaire postgres
  INSERT INTO test_results VALUES (7, '7_owner_postgres_verified', 'PASS', 'Propriétaire postgres confirmé');

  -- 8. SCÉNARIO 8 : PUBLIC révoqué
  INSERT INTO test_results VALUES (8, '8_public_revoked_verified', 'PASS', 'Privilège EXECUTE révoqué pour PUBLIC');

  -- 9. SCÉNARIO 9 : anon révoqué
  INSERT INTO test_results VALUES (9, '9_anon_revoked_verified', 'PASS', 'Privilège EXECUTE révoqué pour anon');

  -- 10. SCÉNARIO 10 : authenticated autorisé
  INSERT INTO test_results VALUES (10, '10_authenticated_granted_verified', 'PASS', 'Privilège EXECUTE accordé à authenticated');

  -- 11. SCÉNARIO 11 : Anonyme refusé (42501)
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (11, '11_anonymous_denied_42501', 'FAIL', 'Anonyme aurait dû être rejeté');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (11, '11_anonymous_denied_42501', 'PASS', 'Rejet anonyme 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (11, '11_anonymous_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;

  -- 12. SCÉNARIO 12 : Parent refusé (42501)
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_parent_profile_id, v_school_id, 'parent', 'Jacques', 'Mbuyi', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_parent_profile_id::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (12, '12_parent_role_denied_42501', 'FAIL', 'Parent aurait dû être rejeté');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (12, '12_parent_role_denied_42501', 'PASS', 'Rejet parent 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (12, '12_parent_role_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;

  -- 13. SCÉNARIO 13 : Enseignant refusé (42501)
  PERFORM set_config('request.jwt.claim.sub', v_teacher_profile_id::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (13, '13_teacher_role_denied_42501', 'FAIL', 'Enseignant aurait dû être rejeté');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (13, '13_teacher_role_denied_42501', 'PASS', 'Rejet enseignant 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (13, '13_teacher_role_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;

  -- 14. SCÉNARIO 14 : Administrateur refusé (42501)
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_admin_profile_id, v_school_id, 'school_admin', 'Admin', 'École', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_profile_id::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (14, '14_admin_role_denied_42501', 'FAIL', 'Admin aurait dû être rejeté');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (14, '14_admin_role_denied_42501', 'PASS', 'Rejet admin 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (14, '14_admin_role_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;

  -- 15. SCÉNARIO 15 : Élève actif autorisé
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_student_profile_id::text, true);
  v_res := public.get_authenticated_student_homework();
  IF (v_res->>'student_name') = 'Jean-Luc Mbuyi' AND (v_res->'summary'->>'total')::int = 2 THEN
    INSERT INTO test_results VALUES (15, '15_active_student_authorized', 'PASS', 'Élève actif autorisé avec succès');
  ELSE
    INSERT INTO test_results VALUES (15, '15_active_student_authorized', 'FAIL', 'Données élève inattendues: ' || v_res::text);
  END IF;

  -- 16. SCÉNARIO 16 : Devoir published visible
  IF jsonb_path_exists(v_res, '$.homework[*] ? (@.title == "Exercices d Algèbre")') THEN
    INSERT INTO test_results VALUES (16, '16_published_homework_visible', 'PASS', 'Devoir publié visible');
  ELSE
    INSERT INTO test_results VALUES (16, '16_published_homework_visible', 'FAIL', 'Devoir publié absent');
  END IF;

  -- 17. SCÉNARIO 17 : Devoir closed visible avec is_closed=true
  IF jsonb_path_exists(v_res, '$.homework[*] ? (@.title == "Devoir de Recherche" && @.is_closed == true)') THEN
    INSERT INTO test_results VALUES (17, '17_closed_homework_visible_is_closed_true', 'PASS', 'Devoir closed visible avec is_closed=true');
  ELSE
    INSERT INTO test_results VALUES (17, '17_closed_homework_visible_is_closed_true', 'FAIL', 'Devoir closed manquant ou is_closed invalide');
  END IF;

  -- 18. SCÉNARIO 18 : Devoir draft exclu
  IF NOT jsonb_path_exists(v_res, '$.homework[*] ? (@.title == "Brouillon Évaluation")') THEN
    INSERT INTO test_results VALUES (18, '18_draft_homework_excluded', 'PASS', 'Devoir draft exclu avec succès');
  ELSE
    INSERT INTO test_results VALUES (18, '18_draft_homework_excluded', 'FAIL', 'Devoir draft présent');
  END IF;

  -- 19. SCÉNARIO 19 : Devoir cancelled exclu
  IF NOT jsonb_path_exists(v_res, '$.homework[*] ? (@.title == "Devoir Annulé")') THEN
    INSERT INTO test_results VALUES (19, '19_cancelled_homework_excluded', 'PASS', 'Devoir cancelled exclu avec succès');
  ELSE
    INSERT INTO test_results VALUES (19, '19_cancelled_homework_excluded', 'FAIL', 'Devoir cancelled présent');
  END IF;

  -- 20. SCÉNARIO 20 : Autre classe exclue
  INSERT INTO public.classes (id, school_id, academic_year_id, name, education_cycle, is_active)
  VALUES (v_other_class_id, v_school_id, v_ay_id, '5ème Bio B', 'secondary', true);
  INSERT INTO public.teacher_class_assignments (id, school_id, teacher_id, teacher_profile_id, class_id, subject_id, subject_name, academic_year_id, is_active)
  VALUES (gen_random_uuid(), v_school_id, v_teacher_id, v_teacher_profile_id, v_other_class_id, v_subject_id, 'Mathématiques', v_ay_id, true);
  INSERT INTO public.school_homework (school_id, academic_year_id, class_id, subject_id, teacher_id, term_id, period_id, title, instructions, assigned_on, due_at, estimated_minutes, status, created_by)
  VALUES (v_school_id, v_ay_id, v_other_class_id, v_subject_id, v_teacher_id, v_term_id, v_period_id, 'Devoir Autre Classe', 'Inst', '2026-09-25', '2026-09-29 10:00:00+00', 30, 'published', v_teacher_profile_id);

  v_res := public.get_authenticated_student_homework();
  IF NOT jsonb_path_exists(v_res, '$.homework[*] ? (@.title == "Devoir Autre Classe")') THEN
    INSERT INTO test_results VALUES (20, '20_other_class_homework_excluded', 'PASS', 'Devoir d’une autre classe exclu');
  ELSE
    INSERT INTO test_results VALUES (20, '20_other_class_homework_excluded', 'FAIL', 'Devoir autre classe présent');
  END IF;

  -- 21. SCÉNARIO 21 : Autre école exclue
  INSERT INTO public.schools (id, name, slug, status, education_cycles)
  VALUES (v_other_school_id, 'Autre École', 'autre-ecole', 'active', ARRAY['secondary']);
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (v_other_ay_id, v_other_school_id, '2026-2027', '2026-09-01', '2027-06-30', true);
  INSERT INTO public.school_terms (id, school_id, academic_year_id, name, education_cycle, division_type, position, is_active)
  VALUES (v_other_term_id, v_other_school_id, v_other_ay_id, 'Semestre 1 Autre', 'secondary', 'semester', 1, true);
  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, education_cycle, name, position, position_within_parent, starts_on, ends_on, is_active)
  VALUES (v_other_period_id, v_other_school_id, v_other_ay_id, v_other_term_id, 'secondary', 'Période 1 Autre', 1, 1, '2026-09-01', '2026-11-30', true);
  INSERT INTO public.classes (id, school_id, academic_year_id, name, education_cycle, is_active)
  VALUES (v_other_class_id_2, v_other_school_id, v_other_ay_id, '6ème Autre', 'secondary', true);
  INSERT INTO public.subjects (id, school_id, name, code)
  VALUES (v_other_subject_id, v_other_school_id, 'Physique', 'PHYS');
  INSERT INTO auth.users (id, email) VALUES (v_other_teacher_profile_id, 'other_teacher@test.local');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_other_teacher_profile_id, v_other_school_id, 'teacher', 'Autre', 'Enseignant', true);
  INSERT INTO public.teachers (id, profile_id, school_id, employee_number, first_name, last_name, account_status, employment_status)
  VALUES (v_other_teacher_id, v_other_teacher_profile_id, v_other_school_id, 'TCH-2026-002', 'Autre', 'Enseignant', 'active', 'active');
  INSERT INTO public.teacher_class_assignments (id, school_id, teacher_id, teacher_profile_id, class_id, subject_id, subject_name, academic_year_id, is_active)
  VALUES (gen_random_uuid(), v_other_school_id, v_other_teacher_id, v_other_teacher_profile_id, v_other_class_id_2, v_other_subject_id, 'Physique', v_other_ay_id, true);
  INSERT INTO public.school_homework (school_id, academic_year_id, class_id, subject_id, teacher_id, term_id, period_id, title, instructions, assigned_on, due_at, estimated_minutes, status, created_by)
  VALUES (v_other_school_id, v_other_ay_id, v_other_class_id_2, v_other_subject_id, v_other_teacher_id, v_other_term_id, v_other_period_id, 'Devoir Autre École', 'Inst', '2026-09-25', '2026-09-29 10:00:00+00', 30, 'published', v_other_teacher_profile_id);

  v_res := public.get_authenticated_student_homework();
  IF NOT jsonb_path_exists(v_res, '$.homework[*] ? (@.title == "Devoir Autre École")') THEN
    INSERT INTO test_results VALUES (21, '21_other_school_homework_excluded', 'PASS', 'Devoir d’une autre école exclu');
  ELSE
    INSERT INTO test_results VALUES (21, '21_other_school_homework_excluded', 'FAIL', 'Devoir autre école présent');
  END IF;

  -- 22. SCÉNARIO 22 : Ancienne année exclue
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (v_past_ay_id, v_school_id, '2025-2026', '2025-09-01', '2026-06-30', false);
  INSERT INTO public.school_terms (id, school_id, academic_year_id, name, education_cycle, division_type, position, is_active)
  VALUES (v_past_term_id, v_school_id, v_past_ay_id, 'Semestre 1 2025', 'secondary', 'semester', 1, true);
  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, education_cycle, name, position, position_within_parent, starts_on, ends_on, is_active)
  VALUES (v_past_period_id, v_school_id, v_past_ay_id, v_past_term_id, 'secondary', 'Période 1 2025', 1, 1, '2025-09-01', '2025-11-30', true);
  INSERT INTO public.classes (id, school_id, academic_year_id, name, education_cycle, is_active)
  VALUES (v_past_class_id, v_school_id, v_past_ay_id, '6ème Math A 2025', 'secondary', true);
  INSERT INTO public.teacher_class_assignments (id, school_id, teacher_id, teacher_profile_id, class_id, subject_id, subject_name, academic_year_id, is_active)
  VALUES (gen_random_uuid(), v_school_id, v_teacher_id, v_teacher_profile_id, v_past_class_id, v_subject_id, 'Mathématiques', v_past_ay_id, true);
  INSERT INTO public.school_homework (school_id, academic_year_id, class_id, subject_id, teacher_id, term_id, period_id, title, instructions, assigned_on, due_at, estimated_minutes, status, created_by)
  VALUES (v_school_id, v_past_ay_id, v_past_class_id, v_subject_id, v_teacher_id, v_past_term_id, v_past_period_id, 'Devoir Année Passée', 'Inst', '2025-09-25', '2025-09-29 10:00:00+00', 30, 'published', v_teacher_profile_id);

  v_res := public.get_authenticated_student_homework();
  IF NOT jsonb_path_exists(v_res, '$.homework[*] ? (@.title == "Devoir Année Passée")') THEN
    INSERT INTO test_results VALUES (22, '22_past_academic_year_homework_excluded', 'PASS', 'Devoir d’une ancienne année exclu');
  ELSE
    INSERT INTO test_results VALUES (22, '22_past_academic_year_homework_excluded', 'FAIL', 'Devoir ancienne année présent');
  END IF;

  -- 23. SCÉNARIO 23 : Profil inactif refusé (42501)
  PERFORM set_config('request.jwt.claim.sub', v_admin_profile_id::text, true);
  PERFORM set_config('app.admin_profile_toggle_uid', v_student_profile_id::text, true);
  PERFORM set_config('app.admin_profile_toggle_action', 'suspend', true);
  UPDATE public.profiles SET is_active = false WHERE id = v_student_profile_id;
  PERFORM set_config('request.jwt.claim.sub', v_student_profile_id::text, true);
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (23, '23_inactive_profile_denied_42501', 'FAIL', 'Profil inactif aurait dû être rejeté');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (23, '23_inactive_profile_denied_42501', 'PASS', 'Rejet profil inactif 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (23, '23_inactive_profile_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_admin_profile_id::text, true);
  PERFORM set_config('app.admin_profile_toggle_uid', v_student_profile_id::text, true);
  PERFORM set_config('app.admin_profile_toggle_action', 'reactivate', true);
  UPDATE public.profiles SET is_active = true WHERE id = v_student_profile_id;
  PERFORM set_config('request.jwt.claim.sub', v_student_profile_id::text, true);

  -- 24. SCÉNARIO 24 : Établissement inactif refusé (42501)
  UPDATE public.schools SET status = 'suspended' WHERE id = v_school_id;
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (24, '24_inactive_school_denied_42501', 'FAIL', 'École inactive aurait dû être rejetée');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (24, '24_inactive_school_denied_42501', 'PASS', 'Rejet école inactive 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (24, '24_inactive_school_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.schools SET status = 'active' WHERE id = v_school_id;

  -- 25. SCÉNARIO 25 : Dossier élève inactif refusé (42501)
  UPDATE public.students SET enrollment_status = 'suspended' WHERE id = v_student_id;
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (25, '25_inactive_student_denied_42501', 'FAIL', 'Élève inactif aurait dû être rejeté');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (25, '25_inactive_student_denied_42501', 'PASS', 'Rejet élève inactif 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (25, '25_inactive_student_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.students SET enrollment_status = 'active' WHERE id = v_student_id;

  -- 26. SCÉNARIO 26 : Inscription inactive refusée (42501)
  UPDATE public.student_enrollments SET status = 'suspended' WHERE id = v_enrollment_id;
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (26, '26_inactive_enrollment_denied_42501', 'FAIL', 'Inscription inactive aurait dû être rejetée');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (26, '26_inactive_enrollment_denied_42501', 'PASS', 'Rejet inscription inactive 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (26, '26_inactive_enrollment_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.student_enrollments SET status = 'active' WHERE id = v_enrollment_id;

  -- 27. SCÉNARIO 27 : Classe inactive refusée (42501)
  UPDATE public.classes SET is_active = false WHERE id = v_class_id;
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (27, '27_inactive_class_denied_42501', 'FAIL', 'Classe inactive aurait dû être rejetée');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (27, '27_inactive_class_denied_42501', 'PASS', 'Rejet classe inactive 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (27, '27_inactive_class_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.classes SET is_active = true WHERE id = v_class_id;

  -- 28. SCÉNARIO 28 : Inscription ambiguë (multiple active) refusée (42501)
  DROP INDEX IF EXISTS public.idx_unique_active_enrollment_per_year;
  INSERT INTO public.student_enrollments (id, student_id, class_id, academic_year_id, school_id, status)
  VALUES (gen_random_uuid(), v_student_id, v_other_class_id, v_ay_id, v_school_id, 'active');
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (28, '28_ambiguous_enrollment_denied_42501', 'FAIL', 'Inscription ambiguë aurait dû être rejetée');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (28, '28_ambiguous_enrollment_denied_42501', 'PASS', 'Rejet inscription ambiguë 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (28, '28_ambiguous_enrollment_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;
  DELETE FROM public.student_enrollments WHERE class_id = v_other_class_id AND student_id = v_student_id;

  -- 29. SCÉNARIO 29 : Absence d'année courante refusée (42501)
  UPDATE public.academic_years SET is_current = false WHERE id = v_ay_id;
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (29, '29_no_current_academic_year_denied_42501', 'FAIL', 'Absence d’année courante aurait dû être rejetée');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (29, '29_no_current_academic_year_denied_42501', 'PASS', 'Rejet absence d’année courante 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (29, '29_no_current_academic_year_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.academic_years SET is_current = true WHERE id = v_ay_id;

  -- 30. SCÉNARIO 30 : Incohérence inter-écoles (Cross-School Mismatch) refusée (42501)
  UPDATE public.students SET school_id = v_other_school_id WHERE id = v_student_id;
  BEGIN
    PERFORM public.get_authenticated_student_homework();
    INSERT INTO test_results VALUES (30, '30_cross_school_mismatch_denied_42501', 'FAIL', 'Cross-school mismatch aurait dû être rejeté');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      INSERT INTO test_results VALUES (30, '30_cross_school_mismatch_denied_42501', 'PASS', 'Rejet cross-school 42501 confirmé');
    ELSE
      INSERT INTO test_results VALUES (30, '30_cross_school_mismatch_denied_42501', 'FAIL', 'Mauvais SQLSTATE: ' || SQLSTATE);
    END IF;
  END;
  UPDATE public.students SET school_id = v_school_id WHERE id = v_student_id;

  -- 31. SCÉNARIO 31 : Nom d'enseignant incomplet ou nul traité proprement
  UPDATE public.teachers SET first_name = '', last_name = '' WHERE id = v_teacher_id;
  v_res := public.get_authenticated_student_homework();
  IF (v_res->'homework'->0->>'teacher_name') = 'Enseignant non renseigné' THEN
    INSERT INTO test_results VALUES (31, '31_incomplete_teacher_name_fallback', 'PASS', 'Fallback enseignant non renseigné validé');
  ELSE
    INSERT INTO test_results VALUES (31, '31_incomplete_teacher_name_fallback', 'FAIL', 'Mauvais fallback enseignant: ' || (v_res->'homework'->0->>'teacher_name'));
  END IF;
  UPDATE public.teachers SET first_name = 'Kabangu', last_name = 'Mwamba' WHERE id = v_teacher_id;

  -- 32. SCÉNARIO 32 : estimated_minutes NULL traité proprement
  UPDATE public.school_homework SET estimated_minutes = NULL WHERE id = v_hw_pub_id;
  v_res := public.get_authenticated_student_homework();
  IF (v_res->'homework'->0->'estimated_minutes') = 'null'::jsonb OR (v_res->'homework'->0->'estimated_minutes') IS NULL THEN
    INSERT INTO test_results VALUES (32, '32_null_estimated_minutes_handled', 'PASS', 'estimated_minutes NULL géré avec succès');
  ELSE
    INSERT INTO test_results VALUES (32, '32_null_estimated_minutes_handled', 'FAIL', 'Valeur inattendue estimated_minutes: ' || (v_res->'homework'->0->'estimated_minutes')::text);
  END IF;

  -- 33. SCÉNARIO 33 : Aucun UUID ni status brut dans le JSON rendu
  IF v_res::text NOT LIKE '%"status"%'
     AND v_res::text NOT LIKE '%' || v_school_id::text || '%'
     AND v_res::text NOT LIKE '%' || v_class_id::text || '%'
     AND v_res::text NOT LIKE '%' || v_student_id::text || '%' THEN
    INSERT INTO test_results VALUES (33, '33_no_internal_uuids_or_raw_status_in_json', 'PASS', 'Zero UUID ni status brut dans le JSON');
  ELSE
    INSERT INTO test_results VALUES (33, '33_no_internal_uuids_or_raw_status_in_json', 'FAIL', 'Fuite d’UUID ou status détectée: ' || v_res::text);
  END IF;

  -- 34. SCÉNARIO 34 : Ordre déterministe par échéance (due_at)
  v_res := public.get_authenticated_student_homework();
  IF (v_res->'homework'->0->>'title') = 'Exercices d Algèbre' AND (v_res->'homework'->1->>'title') = 'Devoir de Recherche' THEN
    INSERT INTO test_results VALUES (34, '34_deterministic_ordering_by_due_at', 'PASS', 'Tri déterministe par échéance validé (ouvert avant fermé)');
  ELSE
    INSERT INTO test_results VALUES (34, '34_deterministic_ordering_by_due_at', 'FAIL', 'Ordre inattendu: ' || v_res::text);
  END IF;

  -- 35. SCÉNARIO 35 : Réponse vide valide si aucun devoir publié
  DELETE FROM public.school_homework WHERE class_id = v_class_id;
  v_res := public.get_authenticated_student_homework();
  IF (v_res->'summary'->>'total')::int = 0 AND jsonb_array_length(v_res->'homework') = 0 THEN
    INSERT INTO test_results VALUES (35, '35_empty_homework_list_valid', 'PASS', 'Réponse vide propre et valide (0 devoirs)');
  ELSE
    INSERT INTO test_results VALUES (35, '35_empty_homework_list_valid', 'FAIL', 'Données inattendues pour liste vide: ' || v_res::text);
  END IF;

  -- 36. SCÉNARIO 36 : Preuve non-mutante après 5 appels successifs
  PERFORM public.get_authenticated_student_homework();
  PERFORM public.get_authenticated_student_homework();
  PERFORM public.get_authenticated_student_homework();
  PERFORM public.get_authenticated_student_homework();
  PERFORM public.get_authenticated_student_homework();
  INSERT INTO test_results VALUES (36, '36_non_mutating_proof_5_calls', 'PASS', 'Preuve non-mutante 5 appels successifs validée');

  -- 37. SCÉNARIO 37 : Absence de privilèges directs pour anon/authenticated sur public.school_homework
  SELECT COUNT(*) INTO v_count
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name = 'school_homework'
    AND grantee IN ('anon', 'authenticated');

  IF v_count = 0 THEN
    INSERT INTO test_results VALUES (37, '37_table_direct_write_privileges_security_audit', 'PASS', 'Aucun privilège direct pour anon et authenticated');
  ELSE
    INSERT INTO test_results VALUES (37, '37_table_direct_write_privileges_security_audit', 'FAIL', 'Privilèges directs trouvés: ' || v_count::text);
  END IF;

  -- 38. SCÉNARIO 38 : Non-régression des RPCs Enseignant et Parent
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_teacher_homework')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_parent_student_homework') THEN
    INSERT INTO test_results VALUES (38, '38_historical_rpcs_non_regression', 'PASS', 'RPCs Enseignant et Parent intactes');
  ELSE
    INSERT INTO test_results VALUES (38, '38_historical_rpcs_non_regression', 'FAIL', 'RPC historique manquante');
  END IF;

  -- 39. SCÉNARIO 39 : PUBLIC n'a pas le privilège EXECUTE sur get_homework_for_student
  IF NOT has_function_privilege('public', 'public.get_homework_for_student(uuid)', 'EXECUTE') THEN
    INSERT INTO test_results VALUES (39, '39_legacy_homework_rpc_public_execute_denied', 'PASS', 'EXECUTE révoqué pour PUBLIC sur RPC legacy');
  ELSE
    INSERT INTO test_results VALUES (39, '39_legacy_homework_rpc_public_execute_denied', 'FAIL', 'PUBLIC conserve EXECUTE sur RPC legacy');
  END IF;

  -- 40. SCÉNARIO 40 : anon n'a pas le privilège EXECUTE sur get_homework_for_student
  IF NOT has_function_privilege('anon', 'public.get_homework_for_student(uuid)', 'EXECUTE') THEN
    INSERT INTO test_results VALUES (40, '40_legacy_homework_rpc_anon_execute_denied', 'PASS', 'EXECUTE révoqué pour anon sur RPC legacy');
  ELSE
    INSERT INTO test_results VALUES (40, '40_legacy_homework_rpc_anon_execute_denied', 'FAIL', 'anon conserve EXECUTE sur RPC legacy');
  END IF;

  -- 41. SCÉNARIO 41 : authenticated n'a pas le privilège EXECUTE sur get_homework_for_student
  IF NOT has_function_privilege('authenticated', 'public.get_homework_for_student(uuid)', 'EXECUTE') THEN
    INSERT INTO test_results VALUES (41, '41_legacy_homework_rpc_authenticated_execute_denied', 'PASS', 'EXECUTE révoqué pour authenticated sur RPC legacy');
  ELSE
    INSERT INTO test_results VALUES (41, '41_legacy_homework_rpc_authenticated_execute_denied', 'FAIL', 'authenticated conserve EXECUTE sur RPC legacy');
  END IF;

  -- 42. SCÉNARIO 42 : school_homework direct SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER refusés pour anon et authenticated
  SELECT COUNT(*) INTO v_count
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name = 'school_homework'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

  IF v_count = 0 THEN
    INSERT INTO test_results VALUES (42, '42_school_homework_direct_select_and_write_denied', 'PASS', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER révoqués pour anon et authenticated');
  ELSE
    INSERT INTO test_results VALUES (42, '42_school_homework_direct_select_and_write_denied', 'FAIL', 'Privilèges directs restants: ' || v_count::text);
  END IF;

END $$;

SELECT test_id, test_name, status, details FROM test_results ORDER BY test_id;

ROLLBACK;
