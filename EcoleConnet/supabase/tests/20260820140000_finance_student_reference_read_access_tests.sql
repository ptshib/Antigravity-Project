-- ============================================================================
-- Test Suite : Isolation et Sécurité de Lecture des Références Élèves Finance
-- Fichier    : supabase/tests/20260820140000_finance_student_reference_read_access_tests.sql
-- Mode       : Strictement Transactionnel (BEGIN ... ROLLBACK, ZÉRO COMMIT)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  -- Identifiants École A (Fixtures frontend locales)
  v_school_a_id        UUID := 'a1000000-0000-4000-a000-000000000001';
  v_academic_year_a_id UUID := 'a2000000-0000-4000-a000-000000000001';
  v_class_a1_id        UUID := 'a3000000-0000-4000-a000-000000000001';
  v_active_agent_id    UUID := 'a5000000-0000-4000-a000-000000000001';
  v_parent_a_id        UUID := 'a6000000-0000-4000-a000-000000000001';
  v_teacher_a_id       UUID := 'a7000000-0000-4000-a000-000000000001';
  v_student_a1_id      UUID := 'a9000000-0000-4000-a000-000000000001';

  -- Fixtures supplémentaires dans l'École A (Non liées au parent A / Non affectées à l'enseignant A)
  v_class_a2_id        UUID := 'a3000000-0000-4000-a000-000000000002';
  v_student_a2_id      UUID := 'a9000000-0000-4000-a000-000000000002';
  v_enrollment_a2_id   UUID := 'aa000000-0000-4000-a000-000000000002';
  v_inactive_agent_id  UUID := 'a5000000-0000-4000-a000-000000000099';

  -- Identifiants École B (Isolation multi-tenant inter-écoles)
  v_school_b_id        UUID := 'b1000000-0000-4000-a000-000000000001';
  v_academic_year_b_id UUID := 'b2000000-0000-4000-a000-000000000001';
  v_class_b_id         UUID := 'b3000000-0000-4000-a000-000000000001';
  v_student_b_id       UUID := 'b9000000-0000-4000-a000-000000000001';
  v_enrollment_b_id    UUID := 'ba000000-0000-4000-a000-000000000001';

  v_count INTEGER;
  v_forbidden_col TEXT;
BEGIN
  ------------------------------------------------------------------------------
  -- 1. PRÉCONDITIONS FAIL-FAST SUR LES FIXTURES DU SEED LOCAL A
  ------------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = v_school_a_id) OR
     NOT EXISTS (SELECT 1 FROM public.academic_years WHERE id = v_academic_year_a_id) OR
     NOT EXISTS (SELECT 1 FROM public.classes WHERE school_id = v_school_a_id) OR
     NOT EXISTS (SELECT 1 FROM public.student_enrollments WHERE school_id = v_school_a_id) OR
     NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_active_agent_id AND role = 'finance_agent') OR
     NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_parent_a_id AND role = 'parent') OR
     NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_teacher_a_id AND role = 'teacher') OR
     NOT EXISTS (SELECT 1 FROM public.students WHERE id = v_student_a1_id) THEN
    RAISE EXCEPTION 'Fixtures frontend locales absentes';
  END IF;


  ------------------------------------------------------------------------------
  -- 2. CRÉATION DES FIXTURES DE TEST TRANSACTIONNELLES (SOUS POSTGRES)
  ------------------------------------------------------------------------------

  -- A. Fixtures supplémentaires dans l'École A (Classe A2, Élève A2 non lié, Inscription A2)
  INSERT INTO public.classes (id, school_id, academic_year_id, name)
  VALUES (v_class_a2_id, v_school_a_id, v_academic_year_a_id, 'Classe A2 Non Affectée')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.students (id, school_id, student_number, first_name, last_name)
  VALUES (v_student_a2_id, v_school_a_id, 'STD-A2-002', 'ÉlèveA2', 'Unlinked')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status)
  VALUES (v_enrollment_a2_id, v_school_a_id, v_student_a2_id, v_academic_year_a_id, v_class_a2_id, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- B. Compte Agent Financier Inactif A
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    phone_change, phone_change_token, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
    created_at, updated_at
  ) VALUES (
    v_inactive_agent_id, '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'agent.inactif@ecoleconnect.test',
    '$2a$10$abcdefghijklmnopqrstuv', now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Agent","last_name":"Inactif","role":"finance_agent"}'::jsonb,
    false, false, false, now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_inactive_agent_id,
    jsonb_build_object('sub', v_inactive_agent_id, 'email', 'agent.inactif@ecoleconnect.test'),
    'email', v_inactive_agent_id::text, now(), now(), now()
  ) ON CONFLICT (provider, provider_id) DO NOTHING;

  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_inactive_agent_id, v_school_a_id, 'finance_agent', 'Agent', 'Inactif', false)
  ON CONFLICT (id) DO UPDATE SET is_active = false;

  -- C. Structure complète de l'École B
  INSERT INTO public.schools (id, name, slug, status)
  VALUES (v_school_b_id, 'École B Test', 'ecole-b-test', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on)
  VALUES (v_academic_year_b_id, v_school_b_id, '2025-2026', '2025-09-01', '2026-06-30')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.classes (id, school_id, academic_year_id, name)
  VALUES (v_class_b_id, v_school_b_id, v_academic_year_b_id, 'Classe B Test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.students (id, school_id, student_number, first_name, last_name)
  VALUES (v_student_b_id, v_school_b_id, 'STD-B-001', 'Élève', 'ÉcoleB')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status)
  VALUES (v_enrollment_b_id, v_school_b_id, v_student_b_id, v_academic_year_b_id, v_class_b_id, 'active')
  ON CONFLICT (id) DO NOTHING;


  ------------------------------------------------------------------------------
  -- 3. RÉSOLUTION DU NOM DE LA COLONNE INTERDITE SOUS POSTGRES
  ------------------------------------------------------------------------------
  SELECT attname INTO v_forbidden_col
  FROM pg_attribute
  WHERE attrelid = 'public.students'::regclass
    AND attnum > 0
    AND NOT attisdropped
    AND attname NOT IN ('id', 'school_id', 'student_number', 'first_name', 'middle_name', 'last_name')
  ORDER BY attnum
  LIMIT 1;

  IF v_forbidden_col IS NULL THEN
    RAISE EXCEPTION 'Aucune colonne sensible trouvée sur public.students';
  END IF;


  ------------------------------------------------------------------------------
  -- 4. TESTS DU RÔLE FINANCE_AGENT ACTIF A
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_active_agent_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- A. Visibilité des entités de son école A (y compris A2)
  SELECT COUNT(*) INTO v_count FROM public.students WHERE id = v_student_a2_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : finance_agent actif doit voir l''élève A2 de son école A.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.classes WHERE id = v_class_a2_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : finance_agent actif doit voir la classe A2 de son école A.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.student_enrollments WHERE id = v_enrollment_a2_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : finance_agent actif doit voir l''inscription A2 de son école A.';
  END IF;

  -- B. Étanchéité multi-tenant : 0 entité visible dans l'école B
  SELECT COUNT(*) INTO v_count FROM public.students WHERE school_id = v_school_b_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : finance_agent ne doit voir aucun élève de l''école B.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.classes WHERE school_id = v_school_b_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : finance_agent ne doit voir aucune classe de l''école B.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.student_enrollments WHERE school_id = v_school_b_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : finance_agent ne doit voir aucune inscription de l''école B.';
  END IF;

  -- C. Tentative de lecture d'une colonne interdite sur students -> Doit produire SQLSTATE 42501
  BEGIN
    EXECUTE format('SELECT %I FROM public.students WHERE id = %L', v_forbidden_col, v_student_a1_id);
    RAISE EXCEPTION 'TEST ÉCHOUÉ : La lecture de la colonne interdite % aurait dû échouer avec 42501.', v_forbidden_col;
  EXCEPTION
    WHEN insufficient_privilege THEN -- SQLSTATE 42501
      NULL; -- Succès attendu
  END;


  ------------------------------------------------------------------------------
  -- 5. TESTS DU RÔLE FINANCE_AGENT INACTIF A
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_inactive_agent_id::text, true);

  -- 0 élève A, 0 classe A, 0 inscription A visible
  SELECT COUNT(*) INTO v_count FROM public.students WHERE school_id = v_school_a_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : finance_agent inactif ne doit pouvoir lire aucun élève de l''école A.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.classes WHERE school_id = v_school_a_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : finance_agent inactif ne doit pouvoir lire aucune classe de l''école A.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.student_enrollments WHERE school_id = v_school_a_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : finance_agent inactif ne doit pouvoir lire aucune inscription de l''école A.';
  END IF;


  ------------------------------------------------------------------------------
  -- 6. TEST PARENT A : RESTRICTION INTRA-ÉCOLE (0 LIGNE POUR ÉLÈVE A2 NON LIÉ)
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_parent_a_id::text, true);

  -- Élève A2 non lié au parent A dans l'école A -> Doit retourner 0 ligne
  SELECT COUNT(*) INTO v_count FROM public.students WHERE id = v_student_a2_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Le parent A ne doit pas pouvoir lire l''élève A2 non lié dans la même école A.';
  END IF;

  -- Test inter-écoles : Élève B dans l'école B -> Doit retourner 0 ligne
  SELECT COUNT(*) INTO v_count FROM public.students WHERE id = v_student_b_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : Le parent A ne doit pas pouvoir lire l''élève B de l''école B.';
  END IF;


  ------------------------------------------------------------------------------
  -- 7. TEST ENSEIGNANT A : RESTRICTION INTRA-ÉCOLE (0 LIGNE POUR INSCRIPTION A2)
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_teacher_a_id::text, true);

  -- Inscription A2 d'une classe A2 non affectée à l'enseignant A -> Doit retourner 0 ligne
  SELECT COUNT(*) INTO v_count FROM public.student_enrollments WHERE id = v_enrollment_a2_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : L''enseignant A ne doit pas voir l''inscription A2 d''une classe non affectée dans l''école A.';
  END IF;

  -- Test inter-écoles : Inscription B dans la classe B -> Doit retourner 0 ligne
  SELECT COUNT(*) INTO v_count FROM public.student_enrollments WHERE id = v_enrollment_b_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST ÉCHOUÉ : L''enseignant A ne doit pas voir l''inscription B de l''école B.';
  END IF;


  ------------------------------------------------------------------------------
  -- 8. REJET DES MUTATIONS ET TRUNCATE POUR AUTHENTICATED (SQLSTATE 42501)
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_active_agent_id::text, true);

  -- public.students
  BEGIN INSERT INTO public.students (id, school_id, student_number, first_name, last_name) VALUES (gen_random_uuid(), v_school_a_id, 'M1', 'F', 'L'); RAISE EXCEPTION 'INSERT students failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.students SET first_name = 'M' WHERE id = v_student_a1_id; RAISE EXCEPTION 'UPDATE students failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.students WHERE id = v_student_a1_id; RAISE EXCEPTION 'DELETE students failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE public.students; RAISE EXCEPTION 'TRUNCATE students failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- public.classes
  BEGIN INSERT INTO public.classes (id, school_id, academic_year_id, name) VALUES (gen_random_uuid(), v_school_a_id, v_academic_year_a_id, 'C'); RAISE EXCEPTION 'INSERT classes failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.classes SET name = 'C2' WHERE id = v_class_a2_id; RAISE EXCEPTION 'UPDATE classes failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.classes WHERE id = v_class_a2_id; RAISE EXCEPTION 'DELETE classes failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE public.classes; RAISE EXCEPTION 'TRUNCATE classes failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- public.student_enrollments
  BEGIN INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status) VALUES (gen_random_uuid(), v_school_a_id, v_student_a1_id, v_academic_year_a_id, v_class_a2_id, 'active'); RAISE EXCEPTION 'INSERT enrollments failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.student_enrollments SET status = 'ended' WHERE id = v_enrollment_a2_id; RAISE EXCEPTION 'UPDATE enrollments failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.student_enrollments WHERE id = v_enrollment_a2_id; RAISE EXCEPTION 'DELETE enrollments failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE public.student_enrollments; RAISE EXCEPTION 'TRUNCATE enrollments failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;


  ------------------------------------------------------------------------------
  -- 9. REJET TOTAL DE LECTURE ET MUTATIONS POUR ANON (SQLSTATE 42501)
  ------------------------------------------------------------------------------
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);

  -- SELECT sous anon -> Doit échouer avec 42501
  BEGIN PERFORM id FROM public.students LIMIT 1; RAISE EXCEPTION 'SELECT students anon failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM id FROM public.classes LIMIT 1; RAISE EXCEPTION 'SELECT classes anon failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM id FROM public.student_enrollments LIMIT 1; RAISE EXCEPTION 'SELECT enrollments anon failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- TRUNCATE sous anon -> Doit échouer avec 42501
  BEGIN TRUNCATE public.students; RAISE EXCEPTION 'TRUNCATE students anon failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE public.classes; RAISE EXCEPTION 'TRUNCATE classes anon failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE public.student_enrollments; RAISE EXCEPTION 'TRUNCATE enrollments anon failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  RAISE NOTICE 'SUCCÈS : Tous les tests d''accès, d''isolation intra/inter-écoles et de sécurité des références élèves Finance ont réussi.';
END $$;

ROLLBACK;
