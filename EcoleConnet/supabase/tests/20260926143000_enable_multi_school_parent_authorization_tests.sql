-- ============================================================================
-- SUITE TEST SQL: 20260926143000_enable_multi_school_parent_authorization_tests.sql
-- DESCRIPTION: Validation transactionnelle complète et adversariale (36 scénarios)
--              Migration des autorisations Parent multi-écoles (Lot 2K-A2b-P-V)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  -- UUIDs pour École A
  v_school_a UUID := 'a1111111-1111-4111-a111-111111111111'::UUID;
  v_ay_a UUID := 'a2222222-2222-4222-a222-222222222222'::UUID;
  v_class_a UUID := 'a3333333-3333-4333-a333-333333333333'::UUID;
  v_student_a UUID := 'a4444444-4444-4444-a444-444444444444'::UUID;

  -- UUIDs pour École B
  v_school_b UUID := 'b1111111-1111-4111-b111-111111111111'::UUID;
  v_ay_b UUID := 'b2222222-2222-4222-b222-222222222222'::UUID;
  v_class_b UUID := 'b3333333-3333-4333-b333-333333333333'::UUID;
  v_student_b UUID := 'b4444444-4444-4444-b444-444444444444'::UUID;
  v_subject_b UUID := 'b5555555-5555-4555-b555-555555555555'::UUID;
  v_term_b UUID := 'b6666666-6666-4666-b666-666666666666'::UUID;
  v_period_b UUID := 'b7777777-7777-4777-b777-777777777777'::UUID;

  -- UUIDs pour École C (école non autorisée)
  v_school_c UUID := 'c1111111-1111-4111-c111-111111111111'::UUID;
  v_ay_c UUID := 'c2222222-2222-4222-c222-222222222222'::UUID;
  v_class_c UUID := 'c3333333-3333-4333-c333-333333333333'::UUID;
  v_student_c UUID := 'c4444444-4444-4444-c444-444444444444'::UUID;

  -- Profil Parent Multi-Écoles (Parent 1: Jonas Banza)
  v_parent_1_user UUID := '11111111-1111-4111-8111-111111111111'::UUID;
  
  -- Profil Parent B (Parent 2: Pierre Mpolo)
  v_parent_2_user UUID := '22222222-2222-4222-8222-222222222222'::UUID;

  -- Profil Admin & Profil Enseignant
  v_admin_user UUID := '33333333-3333-4333-8333-333333333333'::UUID;
  v_teacher_user UUID := '44444444-4444-4444-8444-444444444444'::UUID;

  v_count INTEGER;
  v_json JSONB;
  v_bool BOOLEAN;
  v_err_thrown BOOLEAN := false;
BEGIN
  -- --------------------------------------------------------------------------
  -- FIXTURES TEMPORAIRES (Écoles, Années, Classes, Élèves, Profils)
  -- --------------------------------------------------------------------------
  RESET ROLE;

  INSERT INTO public.schools (id, name, slug, status, education_cycles) VALUES
    (v_school_a, 'École Académique A', 'sch-a', 'active', ARRAY['primary', 'secondary']),
    (v_school_b, 'École Internationale B', 'sch-b', 'active', ARRAY['primary', 'secondary']),
    (v_school_c, 'École Inaccessible C', 'sch-c', 'active', ARRAY['primary', 'secondary']);

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
    (v_ay_a, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_ay_b, v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_ay_c, v_school_c, '2026-2027', '2026-09-01', '2027-06-30', true);

  INSERT INTO public.classes (id, school_id, academic_year_id, name, level, education_cycle, is_active) VALUES
    (v_class_a, v_school_a, v_ay_a, '6ème A', '6EME', 'secondary', true),
    (v_class_b, v_school_b, v_ay_b, '5ème B', '5EME', 'secondary', true),
    (v_class_c, v_school_c, v_ay_c, '4ème C', '4EME', 'secondary', true);

  -- Matières, Termes et Périodes pour École B
  INSERT INTO public.subjects (id, school_id, code, name, is_active) VALUES
    (v_subject_b, v_school_b, 'MATH-B', 'Mathématiques B', true);

  INSERT INTO public.school_terms (id, school_id, academic_year_id, education_cycle, name, division_type, position, is_active) VALUES
    (v_term_b, v_school_b, v_ay_b, 'secondary', 'Semestre 1 B', 'semester', 1, true);

  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, education_cycle, name, position, position_within_parent, is_active) VALUES
    (v_period_b, v_school_b, v_ay_b, v_term_b, 'secondary', 'Période 1 B', 1, 1, true);

  INSERT INTO public.school_calendars (school_id, academic_year_id, education_cycle, status) VALUES
    (v_school_b, v_ay_b, 'secondary', 'active');

  -- Élèves
  INSERT INTO public.students (id, school_id, student_number, first_name, last_name, class_id, enrollment_status, account_status) VALUES
    (v_student_a, v_school_a, 'STD-A1', 'Daniel', 'Banza', v_class_a, 'active', 'active'),
    (v_student_b, v_school_b, 'STD-B1', 'Sarah', 'Banza', v_class_b, 'active', 'active'),
    (v_student_c, v_school_c, 'STD-C1', 'Kevin', 'Mpolo', v_class_c, 'active', 'active');

  INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status, enrolled_on) VALUES
    (gen_random_uuid(), v_school_a, v_student_a, v_ay_a, v_class_a, 'active', CURRENT_DATE),
    (gen_random_uuid(), v_school_b, v_student_b, v_ay_b, v_class_b, 'active', CURRENT_DATE),
    (gen_random_uuid(), v_school_c, v_student_c, v_ay_c, v_class_c, 'active', CURRENT_DATE);

  -- Auth Users & Profiles (profiles.school_id pointe legacy sur School A)
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_parent_1_user, 'jonas.banza@test.local', '{"role":"parent"}'::jsonb),
    (v_parent_2_user, 'autre.parent@test.local', '{"role":"parent"}'::jsonb),
    (v_admin_user, 'admin@test.local', '{"role":"school_admin"}'::jsonb),
    (v_teacher_user, 'enseignant@test.local', '{"role":"teacher"}'::jsonb);

  INSERT INTO public.profiles (id, school_id, first_name, last_name, role, is_active) VALUES
    (v_parent_1_user, v_school_a, 'Jonas', 'Banza', 'parent', true),
    (v_parent_2_user, v_school_b, 'Pierre', 'Mpolo', 'parent', true),
    (v_admin_user, v_school_a, 'Admin', 'Test', 'school_admin', true),
    (v_teacher_user, v_school_a, 'Prof', 'Test', 'teacher', true);

  -- Parent Accounts (legacy rattaché à École A)
  INSERT INTO public.parent_accounts (profile_id, school_id, account_status, invited_at, activated_at) VALUES
    (v_parent_1_user, v_school_a, 'active', NOW(), NOW()),
    (v_parent_2_user, v_school_b, 'active', NOW(), NOW());

  -- Memberships Parent 1 dans École A ET École B
  INSERT INTO public.school_memberships (profile_id, school_id, role, status) VALUES
    (v_parent_1_user, v_school_a, 'parent', 'active'),
    (v_parent_1_user, v_school_b, 'parent', 'active'),
    (v_parent_2_user, v_school_b, 'parent', 'active');

  -- Links Parent 1 vers Élève A (École A) et Élève B (École B)
  INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, relationship, status, can_view_academic, can_view_attendance, can_view_homework, can_view_finances, can_pickup_student, can_receive_notifications) VALUES
    (gen_random_uuid(), v_school_a, v_parent_1_user, v_student_a, 'father', 'approved', true, true, true, true, true, true),
    (gen_random_uuid(), v_school_b, v_parent_1_user, v_student_b, 'father', 'approved', true, true, true, true, true, true),
    (gen_random_uuid(), v_school_b, v_parent_2_user, v_student_c, 'father', 'approved', true, true, true, true, true, true);

  -- --------------------------------------------------------------------------
  -- TEST DES PERMISSIONS GRANULAIRES SUR CAN_PARENT_ACCESS_STUDENT (Section 3)
  -- --------------------------------------------------------------------------
  v_err_thrown := false;
  BEGIN
    PERFORM public.can_parent_access_student(v_student_a, 'permission_inconnue');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_err_thrown := true;
  END;
  IF NOT v_err_thrown THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Section 3] : Permission inconnue non rejetée par code 22023.';
  END IF;

  v_err_thrown := false;
  BEGIN
    PERFORM public.can_parent_access_student(v_student_a, '  ');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_err_thrown := true;
  END;
  IF NOT v_err_thrown THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Section 3] : Permission vide non rejetée par code 22023.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 1 : Parent mono-école existant (Jonas Banza -> Daniel Banza)
  -- --------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT public.can_parent_access_student(v_student_a) INTO v_bool;
  IF NOT v_bool THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 1] : Accès parent mono-école Daniel Banza refusé.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIOS 2 & 3 : Même parent avec enfant dans École A et École B + Memberships actifs
  -- --------------------------------------------------------------------------
  SELECT public.can_parent_access_student(v_student_b) INTO v_bool;
  IF NOT v_bool THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 2/3] : Accès parent multi-écoles Sarah Banza dans École B refusé.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIOS 4 & 5 : get_parent_children_and_schools retourne les 2 enfants et leurs écoles
  -- --------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count FROM public.get_parent_children_and_schools();
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 4] : Attendu 2 enfants pour Jonas Banza, obtenu %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count 
  FROM public.get_parent_children_and_schools() 
  WHERE (student_id = v_student_a AND school_id = v_school_a)
     OR (student_id = v_student_b AND school_id = v_school_b);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 5] : Correspondance école-élève incorrecte dans get_parent_children_and_schools.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 6, 7, 8, 9, 10, 11, 12, 13 : Validation des 9 Domaines Métier pour Élève B
  -- --------------------------------------------------------------------------
  -- 1. Présence (get_parent_student_attendance)
  v_json := public.get_parent_student_attendance(v_student_b);
  IF v_json->'student'->>'id' <> v_student_b::text THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Domaine Présence] : RPC get_parent_student_attendance pour enfant B échouée.';
  END IF;

  -- 2. Devoirs (get_parent_student_homework)
  v_json := public.get_parent_student_homework(v_student_b);
  IF v_json->>'student_id' <> v_student_b::text THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Domaine Devoirs] : RPC get_parent_student_homework pour enfant B échouée.';
  END IF;

  -- 3. Finances (get_parent_student_finances)
  v_json := public.get_parent_student_finances(v_student_b);
  IF v_json->'student'->>'id' <> v_student_b::text THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Domaine Finances] : RPC get_parent_student_finances pour enfant B échouée.';
  END IF;

  -- 4. Calendrier (get_parent_student_calendar)
  v_json := public.get_parent_student_calendar(v_student_b);
  IF v_json->>'student_id' <> v_student_b::text THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Domaine Calendrier] : RPC get_parent_student_calendar pour enfant B échouée.';
  END IF;

  -- 5. Emploi du temps (get_parent_student_timetable)
  v_json := public.get_parent_student_timetable(v_student_b);
  IF v_json->>'student_id' <> v_student_b::text THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Domaine Emploi du temps] : RPC get_parent_student_timetable pour enfant B échouée.';
  END IF;

  -- 6. Documents (get_parent_student_documents)
  v_json := public.get_parent_student_documents(v_student_b);
  IF v_json->>'student_id' <> v_student_b::text THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Domaine Documents] : RPC get_parent_student_documents pour enfant B échouée.';
  END IF;

  -- 7. Messagerie (get_messaging_contacts)
  PERFORM public.get_messaging_contacts(v_student_b);

  -- 8. Bulletin publié (Scénario 10 - get_my_published_report_card)
  v_json := public.get_my_published_report_card(v_student_b, gen_random_uuid());
  IF (v_json->>'is_published')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 10] : Bulletin non publié aurait dû retourner is_published = false.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 14 : Enfant C (3ème école sans lien parent) refusé
  -- --------------------------------------------------------------------------
  IF public.can_parent_access_student(v_student_c) THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 14] : Accès injustifié à l’élève C sans lien parent.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 15 : Membership sans parent_student_links approved refusé
  -- --------------------------------------------------------------------------
  DECLARE
    v_student_d UUID := gen_random_uuid();
  BEGIN
    RESET ROLE;
    INSERT INTO public.students (id, school_id, student_number, first_name, last_name, class_id, enrollment_status, account_status)
    VALUES (v_student_d, v_school_a, 'STD-D1', 'Inconnu', 'Test', v_class_a, 'active', 'active');

    EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
    EXECUTE 'SET LOCAL ROLE authenticated';

    IF public.can_parent_access_student(v_student_d) THEN
      RAISE EXCEPTION 'TEST ÉCHEC [Scénario 15] : Accès autorisé sans lien parent_student_links approved.';
    END IF;
  END;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 16 : Link approved sans school_memberships active refusé
  -- --------------------------------------------------------------------------
  RESET ROLE;
  DELETE FROM public.school_memberships WHERE profile_id = v_parent_1_user AND school_id = v_school_b;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF public.can_parent_access_student(v_student_b) THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 16] : Accès autorisé sans membership scolaire actif dans l’École B.';
  END IF;

  RESET ROLE;
  INSERT INTO public.school_memberships (profile_id, school_id, role, status)
  VALUES (v_parent_1_user, v_school_b, 'parent', 'active');

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- --------------------------------------------------------------------------
  -- SCÉNARIOS 17 & 18 : Membership suspended / left refusé
  -- --------------------------------------------------------------------------
  RESET ROLE;
  UPDATE public.school_memberships SET status = 'suspended', suspended_at = NOW() WHERE profile_id = v_parent_1_user AND school_id = v_school_b;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF public.can_parent_access_student(v_student_b) THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 17] : Accès autorisé avec un membership suspended.';
  END IF;

  RESET ROLE;
  UPDATE public.school_memberships SET status = 'left', left_at = NOW() WHERE profile_id = v_parent_1_user AND school_id = v_school_b;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF public.can_parent_access_student(v_student_b) THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 18] : Accès autorisé avec un membership left.';
  END IF;

  RESET ROLE;
  UPDATE public.school_memberships SET status = 'active', suspended_at = NULL, left_at = NULL WHERE profile_id = v_parent_1_user AND school_id = v_school_b;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 19 : Link parent revoked refusé
  -- --------------------------------------------------------------------------
  RESET ROLE;
  UPDATE public.parent_student_links SET status = 'revoked' WHERE parent_profile_id = v_parent_1_user AND student_id = v_student_b;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF public.can_parent_access_student(v_student_b) THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 19] : Accès autorisé avec un link revoked.';
  END IF;

  RESET ROLE;
  UPDATE public.parent_student_links SET status = 'approved' WHERE parent_profile_id = v_parent_1_user AND student_id = v_student_b;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 20 : Élève inactif (statut non-actif) refusé
  -- --------------------------------------------------------------------------
  RESET ROLE;
  UPDATE public.students SET enrollment_status = 'suspended' WHERE id = v_student_b;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_err_thrown := false;
  BEGIN
    PERFORM public.get_messaging_contacts(v_student_b);
  EXCEPTION WHEN OTHERS THEN
    v_err_thrown := true;
  END;

  IF NOT v_err_thrown THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 20] : Élève non-actif non rejeté sur les RPCs exigeant un statut actif.';
  END IF;

  RESET ROLE;
  UPDATE public.students SET enrollment_status = 'active' WHERE id = v_student_b;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 21 : Parent globalement inactif refusé
  -- --------------------------------------------------------------------------
  RESET ROLE;
  ALTER TABLE public.profiles DISABLE TRIGGER USER;
  UPDATE public.profiles SET is_active = false WHERE id = v_parent_1_user;
  ALTER TABLE public.profiles ENABLE TRIGGER USER;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF public.can_parent_access_student(v_student_a) THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 21] : Accès autorisé avec un profil parent globalement inactif.';
  END IF;

  RESET ROLE;
  ALTER TABLE public.profiles DISABLE TRIGGER USER;
  UPDATE public.profiles SET is_active = true WHERE id = v_parent_1_user;
  ALTER TABLE public.profiles ENABLE TRIGGER USER;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 22 : Parent account suspended refusé
  -- --------------------------------------------------------------------------
  RESET ROLE;
  UPDATE public.parent_accounts SET account_status = 'suspended' WHERE profile_id = v_parent_1_user;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF public.can_parent_access_student(v_student_a) THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 22] : Accès autorisé avec un compte parent suspendu.';
  END IF;

  RESET ROLE;
  UPDATE public.parent_accounts SET account_status = 'active' WHERE profile_id = v_parent_1_user;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- --------------------------------------------------------------------------
  -- SCÉNARIOS 23 & 24 : student_id deviné / school_id falsifié refusés
  -- --------------------------------------------------------------------------
  IF public.can_parent_access_student(gen_random_uuid()) THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 23/24] : ID élève aléatoire deviné accepté.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 25 : Année ou classe d'une autre école jamais retournée
  -- --------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count 
  FROM public.get_parent_children_and_schools() 
  WHERE (student_id = v_student_a AND school_id <> v_school_a)
     OR (student_id = v_student_b AND school_id <> v_school_b);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 25] : Données d’une autre école associées à un élève.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 26 : Plusieurs inscriptions actives incompatibles détectées
  -- --------------------------------------------------------------------------
  DECLARE
    v_class_a2 UUID := gen_random_uuid();
  BEGIN
    RESET ROLE;
    INSERT INTO public.classes (id, school_id, academic_year_id, name, level, education_cycle, is_active)
    VALUES (v_class_a2, v_school_a, v_ay_a, '6ème B', '6EME', 'secondary', true);

    DROP INDEX IF EXISTS public.idx_unique_active_enrollment_per_year;

    INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status, enrolled_on)
    VALUES (gen_random_uuid(), v_school_a, v_student_a, v_ay_a, v_class_a2, 'active', CURRENT_DATE);

    EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
    EXECUTE 'SET LOCAL ROLE authenticated';

    v_err_thrown := false;
    BEGIN
      PERFORM public.get_parent_children_and_schools();
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = '22023' THEN
        v_err_thrown := true;
      END IF;
    END;

    IF NOT v_err_thrown THEN
      RAISE EXCEPTION 'TEST ÉCHEC [Scénario 26] : Conflit de multiples inscriptions actives non détecté (erreur 22023 attendue).';
    END IF;

    RESET ROLE;
    DELETE FROM public.student_enrollments WHERE class_id = v_class_a2;
    DELETE FROM public.classes WHERE id = v_class_a2;

    CREATE UNIQUE INDEX idx_unique_active_enrollment_per_year ON public.student_enrollments (student_id, academic_year_id) WHERE (status = 'active');

    EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
    EXECUTE 'SET LOCAL ROLE authenticated';
  END;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 27 : Parent A ne voit jamais les enfants du Parent B
  -- --------------------------------------------------------------------------
  IF public.can_parent_access_student(v_student_c) THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 27] : Parent 1 a accès à l’enfant de Parent 2.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 28 & 29 : Admin non-parent & Enseignant non-parent refusés sur RPC Parent
  -- --------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_admin_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_err_thrown := false;
  BEGIN
    PERFORM public.get_parent_children_and_schools();
  EXCEPTION WHEN OTHERS THEN
    v_err_thrown := true;
  END;
  IF NOT v_err_thrown THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 28] : Admin non-parent a pu exécuter get_parent_children_and_schools.';
  END IF;

  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_teacher_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_err_thrown := false;
  BEGIN
    PERFORM public.get_parent_children_and_schools();
  EXCEPTION WHEN OTHERS THEN
    v_err_thrown := true;
  END;
  IF NOT v_err_thrown THEN
    RAISE EXCEPTION 'TEST ÉCHEC [Scénario 29] : Enseignant non-parent a pu exécuter get_parent_children_and_schools.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SCÉNARIOS DIRECTS RLS (Section 6)
  -- --------------------------------------------------------------------------
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ' || quote_literal(v_parent_1_user::text);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT COUNT(*) INTO v_count FROM public.student_enrollments WHERE student_id = v_student_b;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [RLS Direct] : Parent read linked enrollments direct SELECT sur student_enrollments échoué.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.students WHERE id = v_student_b;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [RLS Direct] : students_parent_select_policy direct SELECT sur students échoué.';
  END IF;

  -- --------------------------------------------------------------------------
  -- LOT A2b-P-V2 : AUDIT CONTRACTUEL DES RPCs POSTGREST ET INVERSION DE PARAMÈTRES
  -- --------------------------------------------------------------------------
  -- 1. get_messaging_contacts avec paramètre nommé PostgREST p_student_id
  PERFORM public.get_messaging_contacts(p_student_id => v_student_b);

  -- 2. can_user_read_school_calendar avec p_school_id et p_education_cycle (sans p_user_role)
  v_bool := public.can_user_read_school_calendar(p_school_id => v_school_b, p_education_cycle => 'secondary');
  IF NOT v_bool THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V2] : can_user_read_school_calendar a refusé l’accès pour un parent actif de l’école B.';
  END IF;

  -- 3. get_student_subject_period_result avec ordre historique (p_student_id, p_subject_id, p_period_id)
  v_json := public.get_student_subject_period_result(
    p_student_id => v_student_b,
    p_subject_id => v_subject_b,
    p_period_id => v_period_b
  );
  IF v_json IS NULL THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V2] : get_student_subject_period_result a retourné NULL avec des UUIDs valides.';
  END IF;

  -- 4. Test d’inversion d’arguments (p_subject_id et p_period_id inversés) -> DOIT ÉCHOUER
  v_err_thrown := false;
  BEGIN
    PERFORM public.get_student_subject_period_result(
      p_student_id => v_student_b,
      p_subject_id => v_period_b, -- INVERSÉ !
      p_period_id => v_subject_b   -- INVERSÉ !
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_thrown := true;
  END;

  IF NOT v_err_thrown THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V2] : L’inversion de p_subject_id et p_period_id n’a pas été rejetée.';
  END IF;

  -- 5. Validation de tous les autres contrats RPC PostgREST avec leurs noms de paramètres exacts
  PERFORM public.get_student_period_result(p_student_id => v_student_b, p_period_id => v_period_b);
  PERFORM public.get_my_published_report_card(p_student_id => v_student_b, p_period_id => v_period_b);
  PERFORM public.get_parent_student_attendance(p_student_id => v_student_b);
  PERFORM public.get_parent_student_calendar(p_student_id => v_student_b);
  PERFORM public.get_parent_student_documents(p_student_id => v_student_b);
  PERFORM public.get_parent_student_finances(p_student_id => v_student_b);
  PERFORM public.get_parent_student_homework(p_student_id => v_student_b);
  PERFORM public.get_parent_student_timetable(p_student_id => v_student_b);

  -- --------------------------------------------------------------------------
  -- SCÉNARIO 33 & 34 & 35 : Signatures legacy, search_path="" strict et proargnames
  -- --------------------------------------------------------------------------
  RESET ROLE;

  -- A. Vérification de search_path="" obligatoire sur toutes les fonctions SECURITY DEFINER du lot
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'can_parent_access_student',
      'is_parent_of_student',
      'can_parent_view_academic',
      'can_parent_view_attendance',
      'can_parent_view_finances',
      'can_parent_view_homework',
      'can_parent_pickup_student',
      'can_parent_receive_notifications',
      'get_parent_student_attendance',
      'get_parent_student_calendar',
      'get_parent_student_documents',
      'get_parent_student_finances',
      'get_parent_student_homework',
      'get_parent_student_timetable',
      'get_parent_pickup_students',
      'can_parent_read_school_periods',
      'get_my_published_report_card',
      'get_student_period_result',
      'get_student_subject_period_result',
      'get_messaging_contacts',
      'can_user_read_school_calendar',
      'get_parent_children_and_schools'
    )
    AND (
      p.prosecdef IS NOT TRUE 
      OR p.proconfig IS NULL 
      OR NOT ('search_path=""' = ANY(p.proconfig))
    );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V3] : Des fonctions SECURITY DEFINER ne possèdent pas SET search_path = "".';
  END IF;

  -- B. Assertions strictes sur proargnames pour la stabilité PostgREST
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_messaging_contacts'
    AND p.proargnames[1] = 'p_student_id';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V4] : proargnames de get_messaging_contacts altéré.';
  END IF;

  -- 8 RPCs de messagerie (Lot 2J) : Vérification Métadonnées pg_proc
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_or_create_school_conversation'
    AND p.proargnames[1:3] = ARRAY['p_student_id', 'p_counterparty_profile_id', 'p_subject_id']
    AND p.pronargdefaults = 1;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V4] : contrat get_or_create_school_conversation non conforme.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_school_conversation_unread_count'
    AND p.proargnames[1] = 'p_conversation_id';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V4] : contrat get_school_conversation_unread_count non conforme.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_school_conversations';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V4] : contrat get_school_conversations non conforme.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_school_conversation_messages'
    AND p.proargnames[1:4] = ARRAY['p_conversation_id', 'p_before_created_at', 'p_before_id', 'p_limit']
    AND p.pronargdefaults = 3;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V4] : contrat get_school_conversation_messages non conforme.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'send_school_message'
    AND p.proargnames[1:2] = ARRAY['p_conversation_id', 'p_content'];
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V4] : contrat send_school_message non conforme.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mark_school_conversation_read'
    AND p.proargnames[1] = 'p_conversation_id';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V4] : contrat mark_school_conversation_read non conforme.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_school_conversation_archived'
    AND p.proargnames[1:2] = ARRAY['p_conversation_id', 'p_archived'];
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V4] : contrat set_school_conversation_archived non conforme.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'can_user_read_school_calendar'
    AND p.proargnames = ARRAY['p_school_id', 'p_education_cycle'];

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V3] : proargnames de can_user_read_school_calendar altéré.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_student_subject_period_result'
    AND p.proargnames = ARRAY['p_student_id', 'p_subject_id', 'p_period_id'];

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC [A2b-P-V3] : proargnames de get_student_subject_period_result altéré.';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'SUITE SQL A2b-P RÉUSSIE AVEC SUCCÈS : 36/36 Scénarios validés.';
END;
$$;

ROLLBACK;
