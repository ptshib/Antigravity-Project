-- Suite de Tests SQL Transactionnels : Lot 2I-P4-V2 — Test Final Update Homework & Security
-- Fichier : supabase/tests/20260924140000_align_class_subjects_and_teacher_authorizations_tests.sql

BEGIN;

DO $$
DECLARE
  v_school_a UUID := gen_random_uuid();
  v_school_b UUID := gen_random_uuid();
  v_year_2026 UUID := gen_random_uuid();
  v_year_2027 UUID := gen_random_uuid();
  v_year_b UUID := gen_random_uuid();

  -- Profils
  v_prof_admin_a UUID := gen_random_uuid();
  v_prof_teacher_a UUID := gen_random_uuid(); -- Titulaire 2A Primaire
  v_prof_teacher_b UUID := gen_random_uuid(); -- Enseignant Secondaire 7A
  v_prof_teacher_c UUID := gen_random_uuid(); -- Enseignant Non Autorisé Établissement A
  v_prof_teacher_other_school UUID := gen_random_uuid(); -- Enseignant Établissement B
  v_prof_parent UUID := gen_random_uuid();
  v_prof_student UUID := gen_random_uuid();

  -- Teachers
  v_tch_a_id UUID := gen_random_uuid();
  v_tch_b_id UUID := gen_random_uuid();
  v_tch_c_id UUID := gen_random_uuid();
  v_tch_other_school_id UUID := gen_random_uuid();

  -- Classes
  v_class_primary_2a UUID := gen_random_uuid(); -- 2A Primaire (primary_homeroom)
  v_class_secondary_7a UUID := gen_random_uuid(); -- 7A Secondaire (secondary_subjects)

  -- Matières Établissement A (7 matières actives)
  v_sbj_1 UUID := gen_random_uuid();
  v_sbj_2 UUID := gen_random_uuid();
  v_sbj_3 UUID := gen_random_uuid();
  v_sbj_4 UUID := gen_random_uuid();
  v_sbj_5 UUID := gen_random_uuid();
  v_sbj_6 UUID := gen_random_uuid();
  v_sbj_7 UUID := gen_random_uuid();
  v_sbj_inactive UUID := gen_random_uuid(); -- Matière inactive école

  v_homework_id UUID;
  v_res_count INTEGER;
  v_null_count INTEGER;
  v_coef NUMERIC;
  v_is_custom BOOLEAN;
  v_title_check TEXT;
BEGIN
  RAISE NOTICE '=== DEBUT SUITE DE TESTS GATE LOT 2I-P4-V2 ===';

  -- 1. Établissements
  INSERT INTO public.schools (id, name, code, status)
  VALUES 
    (v_school_a, 'École Gate A', 'SCH-GATE-A', 'active'),
    (v_school_b, 'École Gate B', 'SCH-GATE-B', 'active');

  -- 2. Années scolaires
  INSERT INTO public.academic_years (id, school_id, name, is_current)
  VALUES
    (v_year_2026, v_school_a, '2025-2026', false),
    (v_year_2027, v_school_a, '2026-2027', true),
    (v_year_b, v_school_b, '2026-2027', true);

  -- 3. Profils
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES
    (v_prof_admin_a, v_school_a, 'school_admin', 'Admin', 'SchoolA', true),
    (v_prof_teacher_a, v_school_a, 'teacher', 'Jeanne', 'Titulaire', true),
    (v_prof_teacher_b, v_school_a, 'teacher', 'Marc', 'Secondaire', true),
    (v_prof_teacher_c, v_school_a, 'teacher', 'Luc', 'Autre', true),
    (v_prof_teacher_other_school, v_school_b, 'teacher', 'Paul', 'Extérieur', true),
    (v_prof_parent, v_school_a, 'parent', 'Papa', 'Parent', true),
    (v_prof_student, v_school_a, 'student', 'Élève', 'Student', true);

  -- 4. Teachers
  INSERT INTO public.teachers (id, profile_id, school_id, account_status, employment_status)
  VALUES
    (v_tch_a_id, v_prof_teacher_a, v_school_a, 'active', 'active'),
    (v_tch_b_id, v_prof_teacher_b, v_school_a, 'active', 'active'),
    (v_tch_c_id, v_prof_teacher_c, v_school_a, 'active', 'active'),
    (v_tch_other_school_id, v_prof_teacher_other_school, v_school_b, 'active', 'active');

  -- 5. Classes (2A est en 2026-2027)
  INSERT INTO public.classes (id, school_id, academic_year_id, name, education_cycle, pedagogical_mode, homeroom_teacher_id)
  VALUES
    (v_class_primary_2a, v_school_a, v_year_2027, '2A Primaire', 'primary', 'primary_homeroom', v_prof_teacher_a),
    (v_class_secondary_7a, v_school_a, v_year_2027, '7A Secondaire', 'secondary', 'secondary_subjects', NULL);

  -- 6. Matières (7 actives + 1 inactive)
  INSERT INTO public.subjects (id, school_id, name, code, is_active)
  VALUES
    (v_sbj_1, v_school_a, 'Mathématiques', 'MATH-P', true),
    (v_sbj_2, v_school_a, 'Français', 'FRAN-P', true),
    (v_sbj_3, v_school_a, 'Sciences', 'SCIE-P', true),
    (v_sbj_4, v_school_a, 'Histoire', 'HIST-P', true),
    (v_sbj_5, v_school_a, 'Géographie', 'GEO-P', true),
    (v_sbj_6, v_school_a, 'Éducation Physique', 'EPS-P', true),
    (v_sbj_7, v_school_a, 'Dessin et Arts', 'ART-P', true),
    (v_sbj_inactive, v_school_a, 'Matière Inactive', 'OLD-P', false);

  -- 7. Affectations Secondaire pour 7A (Matière 1 et Matière 2)
  INSERT INTO public.teacher_class_assignments (school_id, academic_year_id, class_id, teacher_id, subject_id, is_active)
  VALUES
    (v_school_a, v_year_2027, v_class_secondary_7a, v_tch_b_id, v_sbj_1, true),
    (v_school_a, v_year_2027, v_class_secondary_7a, v_tch_b_id, v_sbj_2, true);


  -- ============================================================================
  -- TEST 1 : Isolation par année scolaire (Surcharges 2025-2026 vs 2026-2027)
  -- ============================================================================
  INSERT INTO public.class_subject_settings (school_id, academic_year_id, class_id, subject_id, coefficient, is_active)
  VALUES (v_school_a, v_year_2026, v_class_primary_2a, v_sbj_1, 4.0, true);

  INSERT INTO public.class_subject_settings (school_id, academic_year_id, class_id, subject_id, coefficient, is_active)
  VALUES (v_school_a, v_year_2027, v_class_primary_2a, v_sbj_1, 2.0, true);

  SELECT coefficient INTO v_coef
  FROM public.get_effective_class_subjects(v_class_primary_2a, v_year_2027)
  WHERE subject_id = v_sbj_1;

  IF v_coef <> 2.0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Attendu coeff 2.0 pour 2026-2027, obtenu : %', v_coef;
  END IF;

  SELECT count(*), count(DISTINCT subject_id) INTO v_res_count, v_null_count
  FROM public.get_effective_class_subjects(v_class_primary_2a, v_year_2027);

  IF v_res_count <> 7 OR v_null_count <> 7 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Doublon détecté entre années scolaires (lignes=%, distinct=%)', v_res_count, v_null_count;
  END IF;

  RAISE NOTICE 'TEST 1 PASSED: Isolation stricte par année scolaire sans contamination ni doublon.';


  -- ============================================================================
  -- TEST 2 : Privilèges et accès refusés (Parent, Élève, Autre École)
  -- ============================================================================
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_parent::text);

  BEGIN
    PERFORM public.get_admin_class_subject_coefficients(v_class_primary_2a, v_year_2027);
    RAISE EXCEPTION 'TEST 2A FAILED: Le parent ne doit pas pouvoir exécuter la RPC Admin.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Seuls les administrateurs peuvent consulter%' THEN
      RAISE EXCEPTION 'TEST 2A FAILED: Message d’erreur inattendu : %', SQLERRM;
    END IF;
  END;

  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_student::text);

  BEGIN
    PERFORM public.get_admin_class_subject_coefficients(v_class_primary_2a, v_year_2027);
    RAISE EXCEPTION 'TEST 2B FAILED: L’élève ne doit pas pouvoir exécuter la RPC Admin.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Seuls les administrateurs peuvent consulter%' THEN
      RAISE EXCEPTION 'TEST 2B FAILED: Message d’erreur inattendu : %', SQLERRM;
    END IF;
  END;

  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_other_school::text);

  BEGIN
    PERFORM public.get_admin_class_subject_coefficients(v_class_primary_2a, v_year_2027);
    RAISE EXCEPTION 'TEST 2C FAILED: Un admin/utilisateur d’une autre école ne peut pas consulter les matières.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Seuls les administrateurs peuvent consulter%' AND SQLERRM NOT LIKE '%Cette classe appartient à un autre établissement%' THEN
      RAISE EXCEPTION 'TEST 2C FAILED: Message d’erreur inattendu : %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'TEST 2 PASSED: Accès parent, élève et autre école correctement rejetés par la RPC Admin.';


  -- ============================================================================
  -- TEST 3 : Admin autorisé sur son école uniquement via get_admin_class_subject_coefficients
  -- ============================================================================
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_admin_a::text);

  SELECT count(*) INTO v_res_count
  FROM public.get_admin_class_subject_coefficients(v_class_primary_2a, v_year_2027);

  IF v_res_count <> 7 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: L’admin doit recevoir les 7 matières effectives, obtenu : %', v_res_count;
  END IF;

  RAISE NOTICE 'TEST 3 PASSED: Admin autorisé à lire les matières effectives de sa classe.';


  -- ============================================================================
  -- TEST 4 : Titulaire Primaire reçoit les 7 matières effectives via RPC Enseignant
  -- ============================================================================
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);

  SELECT count(*) INTO v_res_count
  FROM public.get_teacher_authorized_subjects(v_class_primary_2a);

  IF v_res_count <> 7 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Le titulaire 2A doit recevoir 7 matières autorisées, obtenu : %', v_res_count;
  END IF;

  RAISE NOTICE 'TEST 4 PASSED: Titulaire 2A reçoit exactement ses 7 matières effectives.';


  -- ============================================================================
  -- TEST 5 : Secondaire reçoit uniquement ses matières affectées et effectives
  -- ============================================================================
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_b::text);

  SELECT count(*) INTO v_res_count
  FROM public.get_teacher_authorized_subjects(v_class_secondary_7a);

  IF v_res_count <> 2 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Enseignant secondaire 7A doit recevoir 2 matières affectées, obtenu : %', v_res_count;
  END IF;

  RAISE NOTICE 'TEST 5 PASSED: Secondaire restreint strictly aux matières affectées.';


  -- ============================================================================
  -- TEST 6 : Identité exacte des IDs entre RPC Admin et RPC Enseignant
  -- ============================================================================
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_admin_a::text);

  SELECT count(*) INTO v_res_count
  FROM (
    SELECT subject_id FROM public.get_admin_class_subject_coefficients(v_class_primary_2a, v_year_2027)
    EXCEPT
    SELECT subject_id FROM public.get_teacher_authorized_subjects(v_class_primary_2a)
  ) diff;

  IF v_res_count <> 0 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: Différence d’IDs entre RPC Admin et RPC Enseignant.';
  END IF;

  RAISE NOTICE 'TEST 6 PASSED: Identité exacte des IDs entre RPC Admin et RPC Enseignant.';


  -- ============================================================================
  -- TEST 7 (LOT 2I-P4-V2) : Scénario complet UPDATE HOMEWORK sur matière désactivée post-création
  -- ============================================================================
  
  -- A. CLASSE PRIMAIRE (primary_homeroom)
  -- 1. Titulaire v_prof_teacher_a crée un devoir valide sur v_sbj_3
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);

  v_homework_id := public.create_teacher_homework(
    v_class_primary_2a,
    v_sbj_3,
    'Titre Original Primaire',
    'Consigne Originale Primaire',
    CURRENT_DATE,
    NOW() + INTERVAL '2 days',
    30,
    true
  );

  IF v_homework_id IS NULL THEN
    RAISE EXCEPTION 'TEST 7A FAILED: Impossible de créer le devoir primaire initial.';
  END IF;

  -- 2. Admin désactive v_sbj_3 pour 2A en 2026-2027 via class_subject_settings.is_active = false
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_admin_a::text);

  INSERT INTO public.class_subject_settings (school_id, academic_year_id, class_id, subject_id, coefficient, is_active)
  VALUES (v_school_a, v_year_2027, v_class_primary_2a, v_sbj_3, 1.0, false)
  ON CONFLICT (school_id, academic_year_id, class_id, subject_id)
  DO UPDATE SET is_active = false;

  -- 3 & 4. Titulaire propriétaire v_prof_teacher_a tente de modifier son devoir
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);

  BEGIN
    PERFORM public.update_teacher_homework(
      v_homework_id,
      'Titre Modification Interdite Primaire',
      'Consigne Modifiée Primaire',
      CURRENT_DATE,
      NOW() + INTERVAL '5 days'
    );
    RAISE EXCEPTION 'TEST 7A FAILED: La RPC update_teacher_homework aurait dû refuser la modification sur matière désactivée (Primaire).';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé : Cette matière n’est pas configurée ou est désactivée pour cette classe.%' THEN
      RAISE EXCEPTION 'TEST 7A FAILED: Message d’erreur inattendu (Primaire) : %', SQLERRM;
    END IF;
  END;

  -- 5. Vérification qu'aucune modification n'est persistée
  SELECT title INTO v_title_check
  FROM public.school_homework WHERE id = v_homework_id;

  IF v_title_check <> 'Titre Original Primaire' THEN
    RAISE EXCEPTION 'TEST 7A FAILED: Le titre du devoir a été altéré malgré le refus de la RPC ! Obtenu: %', v_title_check;
  END IF;


  -- B. CLASSE SECONDAIRE (secondary_subjects)
  -- 1. Enseignant secondaire v_prof_teacher_b crée un devoir valide sur v_sbj_1
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_b::text);

  v_homework_id := public.create_teacher_homework(
    v_class_secondary_7a,
    v_sbj_1,
    'Titre Original Secondaire',
    'Consigne Originale Secondaire',
    CURRENT_DATE,
    NOW() + INTERVAL '2 days',
    45,
    true
  );

  IF v_homework_id IS NULL THEN
    RAISE EXCEPTION 'TEST 7B FAILED: Impossible de créer le devoir secondaire initial.';
  END IF;

  -- 2. Admin désactive v_sbj_1 pour 7A en 2026-2027 via class_subject_settings.is_active = false
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_admin_a::text);

  INSERT INTO public.class_subject_settings (school_id, academic_year_id, class_id, subject_id, coefficient, is_active)
  VALUES (v_school_a, v_year_2027, v_class_secondary_7a, v_sbj_1, 1.0, false)
  ON CONFLICT (school_id, academic_year_id, class_id, subject_id)
  DO UPDATE SET is_active = false;

  -- 3 & 4. Enseignant propriétaire v_prof_teacher_b tente de modifier son devoir
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_b::text);

  BEGIN
    PERFORM public.update_teacher_homework(
      v_homework_id,
      'Titre Modification Interdite Secondaire',
      'Consigne Modifiée Secondaire',
      CURRENT_DATE,
      NOW() + INTERVAL '5 days'
    );
    RAISE EXCEPTION 'TEST 7B FAILED: La RPC update_teacher_homework aurait dû refuser la modification sur matière désactivée (Secondaire).';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé : Cette matière n’est pas configurée ou est désactivée pour cette classe.%' THEN
      RAISE EXCEPTION 'TEST 7B FAILED: Message d’erreur inattendu (Secondaire) : %', SQLERRM;
    END IF;
  END;

  -- 5. Vérification qu'aucune modification n'est persistée
  SELECT title INTO v_title_check
  FROM public.school_homework WHERE id = v_homework_id;

  IF v_title_check <> 'Titre Original Secondaire' THEN
    RAISE EXCEPTION 'TEST 7B FAILED: Le titre du devoir a été altéré malgré le refus de la RPC ! Obtenu: %', v_title_check;
  END IF;

  RAISE NOTICE 'TEST 7 PASSED: Validation complète UPDATE HOMEWORK sur matière désactivée post-création (Primaire & Secondaire).';

  RAISE NOTICE '=== TOUS LES TESTS GATE LOT 2I-P4-V2 ONT RÉUSSI AVEC SUCCÈS ===';
END $$;

ROLLBACK;
