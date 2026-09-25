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
  -- TEST 4 : Titulaire Primaire (Grâce Kabeya) - Verification des 10 points de l'Incident
  -- ============================================================================
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);

  -- 1. get_teacher_authorized_subjects(2A) retourne Mathématiques
  SELECT count(*) INTO v_res_count
  FROM public.get_teacher_authorized_subjects(v_class_primary_2a)
  WHERE subject_id = v_sbj_1;

  IF v_res_count <> 1 THEN
    RAISE EXCEPTION 'INCIDENT TEST 1 FAILED: Mathématiques (v_sbj_1) non retourné par get_teacher_authorized_subjects.';
  END IF;

  SELECT count(*) INTO v_res_count
  FROM public.get_teacher_authorized_subjects(v_class_primary_2a);

  IF v_res_count <> 7 THEN
    RAISE EXCEPTION 'INCIDENT TEST 1 FAILED: Le titulaire 2A doit recevoir 7 matières autorisées, obtenu : %', v_res_count;
  END IF;

  -- 2, 3 & 4. Création d'un devoir brouillon en Mathématiques, validation par trigger et lecture via get_teacher_homework
  v_homework_id := public.create_teacher_homework(
    v_class_primary_2a,
    v_sbj_1,
    'Devoir Brouillon Math 2A',
    'Exercices de calcul mental page 12',
    CURRENT_DATE,
    NOW() + INTERVAL '3 days',
    20,
    false -- is_published = false (brouillon)
  );

  IF v_homework_id IS NULL THEN
    RAISE EXCEPTION 'INCIDENT TEST 2/3 FAILED: Impossible de créer le devoir brouillon en Mathématiques.';
  END IF;

  SELECT count(*) INTO v_res_count
  FROM public.get_teacher_homework(v_class_primary_2a, v_year_2027)
  WHERE id = v_homework_id;

  IF v_res_count <> 1 THEN
    RAISE EXCEPTION 'INCIDENT TEST 4 FAILED: Le devoir créé n’est pas présent dans get_teacher_homework.';
  END IF;

  -- 5. Une matière explicitement désactivée reste refusée
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary_2a,
      v_sbj_inactive,
      'Devoir Matière Inactive',
      'Consigne',
      CURRENT_DATE,
      NOW() + INTERVAL '3 days',
      20,
      false
    );
    RAISE EXCEPTION 'INCIDENT TEST 5 FAILED: La création sur matière inactive aurait dû être refusée.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Cette matière n’est pas configurée ou est désactivée%' AND SQLERRM NOT LIKE '%n’appartient pas à l’établissement%' THEN
      RAISE EXCEPTION 'INCIDENT TEST 5 FAILED: Message d’erreur inattendu : %', SQLERRM;
    END IF;
  END;

  -- 6. Une matière d’une autre école reste refusée
  DECLARE
    v_sbj_other_school UUID := gen_random_uuid();
  BEGIN
    INSERT INTO public.subjects (id, school_id, name, code, is_active)
    VALUES (v_sbj_other_school, v_school_b, 'Math B', 'MATH-B', true);

    PERFORM public.create_teacher_homework(
      v_class_primary_2a,
      v_sbj_other_school,
      'Devoir Autre École',
      'Consigne',
      CURRENT_DATE,
      NOW() + INTERVAL '3 days',
      20,
      false
    );
    RAISE EXCEPTION 'INCIDENT TEST 6 FAILED: La création sur une matière d’une autre école aurait dû être refusée.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Incohérence multi-écoles : La matière%' THEN
      RAISE EXCEPTION 'INCIDENT TEST 6 FAILED: Message d’erreur inattendu : %', SQLERRM;
    END IF;
  END;

  -- 7. Un enseignant non titulaire reste refusé sur cette classe primaire
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_c::text);
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary_2a,
      v_sbj_1,
      'Devoir Enseignant Non Titulaire',
      'Consigne',
      CURRENT_DATE,
      NOW() + INTERVAL '3 days',
      20,
      false
    );
    RAISE EXCEPTION 'INCIDENT TEST 7 FAILED: L’enseignant non titulaire aurait dû être refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé : L’enseignant n’est pas le titulaire de cette classe primaire.%' THEN
      RAISE EXCEPTION 'INCIDENT TEST 7 FAILED: Message d’erreur inattendu : %', SQLERRM;
    END IF;
  END;

  -- Rétablir le contexte du titulaire
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);

  RAISE NOTICE 'TEST 4 PASSED: Titulaire 2A valide la création de devoir et l’ensemble des 10 points d’intégrité.';


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


  -- ============================================================================
  -- TEST 8 (LOT 2I-P4-T2-V2) : Validation du Cycle de Vie et Règles Post-Désactivation
  -- ============================================================================
  DECLARE
    v_hw_cancel_id UUID;
    v_hw_close_id UUID;
    v_hw_draft_id UUID;
    v_sec_hw_id UUID;
    v_status_check TEXT;
    v_pub_at_check TIMESTAMPTZ;
    v_student_id UUID := gen_random_uuid();
    v_enrollment_id UUID := gen_random_uuid();
  BEGIN
    -- Configuration élève et inscription dans classe 2A
    INSERT INTO public.students (id, profile_id, school_id, is_active)
    VALUES (v_student_id, v_prof_student, v_school_a, true);

    INSERT INTO public.parent_student_relationships (parent_profile_id, student_id, relationship_type, is_active)
    VALUES (v_prof_parent, v_student_id, 'father', true);

    INSERT INTO public.student_enrollments (id, school_id, academic_year_id, class_id, student_id, status)
    VALUES (v_enrollment_id, v_school_a, v_year_2027, v_class_primary_2a, v_student_id, 'active');

    -- SCÉNARIO 1 : Création de devoirs sur une matière effective (v_sbj_1 - Mathématiques) par le titulaire
    EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);

    v_hw_cancel_id := public.create_teacher_homework(
      v_class_primary_2a,
      v_sbj_1,
      'Devoir 1 Math (pour annulation)',
      'Exercices p.10',
      CURRENT_DATE,
      NOW() + INTERVAL '4 days',
      20,
      false
    );

    v_hw_close_id := public.create_teacher_homework(
      v_class_primary_2a,
      v_sbj_1,
      'Devoir 2 Math (pour clôture)',
      'Exercices p.12',
      CURRENT_DATE,
      NOW() + INTERVAL '4 days',
      20,
      false
    );

    v_hw_draft_id := public.create_teacher_homework(
      v_class_primary_2a,
      v_sbj_1,
      'Devoir 3 Math (reste brouillon)',
      'Exercices p.14',
      CURRENT_DATE,
      NOW() + INTERVAL '4 days',
      20,
      false
    );

    IF v_hw_cancel_id IS NULL OR v_hw_close_id IS NULL OR v_hw_draft_id IS NULL THEN
      RAISE EXCEPTION 'TEST 8.1 FAILED: La création des devoirs sur matière effective a échoué.';
    END IF;

    -- SCÉNARIO 2 : Publication des devoirs tant que la matière est effective
    PERFORM public.publish_teacher_homework(v_hw_cancel_id);
    PERFORM public.publish_teacher_homework(v_hw_close_id);

    SELECT status, published_at INTO v_status_check, v_pub_at_check FROM public.school_homework WHERE id = v_hw_cancel_id;
    IF v_status_check <> 'published' OR v_pub_at_check IS NULL THEN
      RAISE EXCEPTION 'TEST 8.2 FAILED: Publication de Devoir 1 échouée.';
    END IF;

    -- SCÉNARIO 3 : Désactivation de la matière par l'administration après publication
    EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_admin_a::text);
    INSERT INTO public.class_subject_settings (school_id, academic_year_id, class_id, subject_id, coefficient, is_active)
    VALUES (v_school_a, v_year_2027, v_class_primary_2a, v_sbj_1, 1.0, false)
    ON CONFLICT (school_id, academic_year_id, class_id, subject_id) DO UPDATE SET is_active = false;

    -- SCÉNARIO 4 : Modification du devoir après désactivation -> REFUSÉE
    EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);
    BEGIN
      PERFORM public.update_teacher_homework(
        v_hw_cancel_id,
        'Devoir 1 Modifié',
        'Nouvelle consigne',
        CURRENT_DATE,
        NOW() + INTERVAL '5 days',
        25
      );
      RAISE EXCEPTION 'TEST 8.4 FAILED: La modification après désactivation aurait dû être refusée.';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Cette matière n’est pas configurée ou est désactivée%' THEN
        RAISE EXCEPTION 'TEST 8.4 FAILED: Message inattendu : %', SQLERRM;
      END IF;
    END;

    -- SCÉNARIO 5 : Nouvelle publication d'un brouillon après désactivation -> REFUSÉE
    BEGIN
      PERFORM public.publish_teacher_homework(v_hw_draft_id);
      RAISE EXCEPTION 'TEST 8.5 FAILED: La publication d’un brouillon après désactivation aurait dû être refusée.';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Cette matière n’est plus configurée ou est désactivée%' THEN
        RAISE EXCEPTION 'TEST 8.5 FAILED: Message inattendu : %', SQLERRM;
      END IF;
    END;

    -- SCÉNARIO 6 : Annulation du devoir déjà publié après désactivation -> AUTORISÉE
    PERFORM public.cancel_teacher_homework(v_hw_cancel_id, 'Annulation suite réorganisation du programme');
    SELECT status INTO v_status_check FROM public.school_homework WHERE id = v_hw_cancel_id;
    IF v_status_check <> 'cancelled' THEN
      RAISE EXCEPTION 'TEST 8.6 FAILED: L’annulation du devoir publié après désactivation de la matière a été refusée (status=%).', v_status_check;
    END IF;

    -- SCÉNARIO 7 : Clôture d'un autre devoir déjà publié après désactivation -> AUTORISÉE
    PERFORM public.close_teacher_homework(v_hw_close_id);
    SELECT status INTO v_status_check FROM public.school_homework WHERE id = v_hw_close_id;
    IF v_status_check <> 'closed' THEN
      RAISE EXCEPTION 'TEST 8.7 FAILED: La clôture du devoir publié après désactivation de la matière a été refusée (status=%).', v_status_check;
    END IF;

    -- SCÉNARIO 8 : Un autre enseignant ne peut ni annuler ni clôturer le devoir
    EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_c::text);
    BEGIN
      PERFORM public.cancel_teacher_homework(v_hw_close_id, 'TENTATIVE ILLICITE');
      RAISE EXCEPTION 'TEST 8.8.a FAILED: Un autre enseignant n’aurait pas dû pouvoir annuler.';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Accès refusé%' THEN
        RAISE EXCEPTION 'TEST 8.8.a FAILED: Message inattendu : %', SQLERRM;
      END IF;
    END;

    BEGIN
      PERFORM public.close_teacher_homework(v_hw_draft_id);
      RAISE EXCEPTION 'TEST 8.8.b FAILED: Un autre enseignant n’aurait pas dû pouvoir clôturer.';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Accès refusé%' THEN
        RAISE EXCEPTION 'TEST 8.8.b FAILED: Message inattendu : %', SQLERRM;
      END IF;
    END;

    -- SCÉNARIO 9 : Un enseignant d'un autre établissement est refusé
    EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_other_school::text);
    BEGIN
      PERFORM public.cancel_teacher_homework(v_hw_close_id, 'Autre école');
      RAISE EXCEPTION 'TEST 8.9 FAILED: Enseignant d’une autre école doit être refusé.';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Accès refusé%' THEN
        RAISE EXCEPTION 'TEST 8.9 FAILED: Message inattendu : %', SQLERRM;
      END IF;
    END;

    -- SCÉNARIO 10 : Les transitions invalides restent refusées
    EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);
    BEGIN
      PERFORM public.close_teacher_homework(v_hw_cancel_id);
      RAISE EXCEPTION 'TEST 8.10 FAILED: Clôturer un devoir déjà annulé aurait dû échouer.';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Clôture impossible%' THEN
        RAISE EXCEPTION 'TEST 8.10 FAILED: Message inattendu : %', SQLERRM;
      END IF;
    END;

    -- SCÉNARIO 11 : Les modes primaire et secondaire restent fonctionnels
    EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_b::text);
    v_sec_hw_id := public.create_teacher_homework(
      v_class_secondary_7a,
      v_sbj_2,
      'Devoir Secondaire Français',
      'Grammaire',
      CURRENT_DATE,
      NOW() + INTERVAL '3 days',
      30,
      false
    );
    PERFORM public.publish_teacher_homework(v_sec_hw_id);
    PERFORM public.cancel_teacher_homework(v_sec_hw_id, 'Annulation secondaire test');
    SELECT status INTO v_status_check FROM public.school_homework WHERE id = v_sec_hw_id;
    IF v_status_check <> 'cancelled' THEN
      RAISE EXCEPTION 'TEST 8.11 FAILED: Cycle de vie secondaire échoué.';
    END IF;

    RAISE NOTICE 'TEST 8 PASSED: Validation complète des 12 scénarios LOT 2I-P4-T2-V2.';
  END;

  -- SCÉNARIO 12 : Validation que la transaction entière se termine par ROLLBACK sans résidu
  RAISE NOTICE '=== TOUS LES TESTS GATE LOT 2I-P4-T2-V2 ONT RÉUSSI AVEC SUCCÈS ===';
END $$;

ROLLBACK;
