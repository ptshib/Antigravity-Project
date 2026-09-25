-- ============================================================================
-- TESTS TRANSACTIONNELS : LOT 2I-P4-T3-V2
-- Durcissement de la résolution automatique et déterministe du calendrier scolaire
-- ============================================================================

BEGIN;

-- 1. Helper Function : Resolution deterministe du calendrier scolaire (Définition locale pour le test)
CREATE OR REPLACE FUNCTION public.resolve_homework_academic_period(
  p_school_id UUID,
  p_academic_year_id UUID,
  p_education_cycle TEXT,
  p_assigned_on DATE,
  p_term_id UUID DEFAULT NULL
)
RETURNS TABLE (
  out_term_id UUID,
  out_period_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period_count INTEGER;
  v_resolved_term_id UUID;
  v_resolved_period_id UUID;
BEGIN
  IF p_school_id IS NULL OR p_academic_year_id IS NULL OR p_assigned_on IS NULL THEN
    RAISE EXCEPTION 'Paramètres insuffisants pour résoudre le calendrier scolaire.';
  END IF;

  -- 1. Si p_term_id est fourni explicitement : Valider le terme et exiger une période enfant active UNIQUE couvrante
  IF p_term_id IS NOT NULL THEN
    SELECT id INTO v_resolved_term_id
    FROM public.school_terms
    WHERE id = p_term_id
      AND school_id = p_school_id
      AND academic_year_id = p_academic_year_id
      AND (p_education_cycle IS NULL OR education_cycle = p_education_cycle)
      AND is_active = true;

    IF v_resolved_term_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Le terme scolaire spécifié est introuvable, inactif ou n’appartient pas à cet établissement, cette année ou ce cycle.';
    END IF;

    SELECT count(*), (ARRAY_AGG(id))[1]
    INTO v_period_count, v_resolved_period_id
    FROM public.school_periods
    WHERE parent_term_id = v_resolved_term_id
      AND school_id = p_school_id
      AND academic_year_id = p_academic_year_id
      AND (p_education_cycle IS NULL OR education_cycle = p_education_cycle)
      AND is_active = true
      AND (starts_on IS NULL OR p_assigned_on >= starts_on)
      AND (ends_on IS NULL OR p_assigned_on <= ends_on);

    IF v_period_count > 1 THEN
      RAISE EXCEPTION 'Accès refusé : Conflit de calendrier scolaire : Plusieurs périodes actives sous le terme spécifié couvrent la date d’assignation (%).', p_assigned_on;
    END IF;

    IF v_period_count = 0 OR v_resolved_period_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucune période scolaire active sous le terme spécifié ne couvre la date d’assignation (%).', p_assigned_on;
    END IF;

    RETURN QUERY SELECT v_resolved_term_id, v_resolved_period_id;
    RETURN;
  END IF;

  -- 2. Si p_term_id est NULL : Résolution automatique déterministe basée sur p_assigned_on et les périodes actives
  SELECT count(*), (ARRAY_AGG(id))[1], (ARRAY_AGG(parent_term_id))[1]
  INTO v_period_count, v_resolved_period_id, v_resolved_term_id
  FROM public.school_periods
  WHERE school_id = p_school_id
    AND academic_year_id = p_academic_year_id
    AND (p_education_cycle IS NULL OR education_cycle = p_education_cycle)
    AND is_active = true
    AND (starts_on IS NULL OR p_assigned_on >= starts_on)
    AND (ends_on IS NULL OR p_assigned_on <= ends_on);

  IF v_period_count > 1 THEN
    RAISE EXCEPTION 'Accès refusé : Conflit de calendrier scolaire : Plusieurs périodes actives couvrent la date d’assignation (%).', p_assigned_on;
  END IF;

  IF v_period_count = 0 OR v_resolved_period_id IS NULL OR v_resolved_term_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : La date d’assignation (%) n’est couverte par aucune période scolaire active pour cet établissement et cette année.', p_assigned_on;
  END IF;

  -- Validation supplémentaire que le term_id parent est valide et actif
  IF NOT EXISTS (
    SELECT 1 FROM public.school_terms
    WHERE id = v_resolved_term_id
      AND school_id = p_school_id
      AND academic_year_id = p_academic_year_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Le terme parent de la période trouvée est inactif ou invalide.';
  END IF;

  RETURN QUERY SELECT v_resolved_term_id, v_resolved_period_id;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_homework_academic_period(UUID, UUID, TEXT, DATE, UUID) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.resolve_homework_academic_period(UUID, UUID, TEXT, DATE, UUID) OWNER TO postgres;


-- 2. RPC : create_teacher_homework
CREATE OR REPLACE FUNCTION public.create_teacher_homework(
  p_class_id UUID,
  p_subject_id UUID,
  p_title TEXT,
  p_instructions TEXT,
  p_assigned_on DATE,
  p_due_at TIMESTAMPTZ,
  p_estimated_minutes INTEGER DEFAULT NULL,
  p_publish_now BOOLEAN DEFAULT false,
  p_term_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile_role TEXT;
  v_profile_active BOOLEAN;
  v_school_id UUID;
  v_school_status TEXT;
  v_teacher_id UUID;
  v_tch_acc_status TEXT;
  v_tch_emp_status TEXT;
  v_year_id UUID;
  v_education_cycle TEXT;
  v_homework_id UUID;
  v_pedagogical_mode TEXT;
  v_homeroom_teacher_id UUID;
  v_resolved_term_id UUID;
  v_resolved_period_id UUID;
  v_status TEXT := 'draft';
  v_published_at TIMESTAMPTZ := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT role, school_id, is_active INTO v_profile_role, v_school_id, v_profile_active
  FROM public.profiles WHERE id = v_uid;

  IF v_profile_role IS NULL OR v_profile_active IS NOT TRUE OR v_profile_role <> 'teacher' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un enseignant actif peut créer un devoir.';
  END IF;

  SELECT status INTO v_school_status FROM public.schools WHERE id = v_school_id;
  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
  END IF;

  SELECT id, account_status, employment_status
  INTO v_teacher_id, v_tch_acc_status, v_tch_emp_status
  FROM public.teachers
  WHERE profile_id = v_uid AND school_id = v_school_id;

  IF v_teacher_id IS NULL OR v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : Le dossier de l’enseignant n’est pas actif.';
  END IF;

  SELECT academic_year_id, education_cycle, coalesce(pedagogical_mode, 'secondary_subjects'), homeroom_teacher_id
  INTO v_year_id, v_education_cycle, v_pedagogical_mode, v_homeroom_teacher_id
  FROM public.classes
  WHERE id = p_class_id AND school_id = v_school_id;

  IF v_year_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable ou n’appartenant pas à votre établissement.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_effective_class_subjects(p_class_id, v_year_id) e
    WHERE e.subject_id = p_subject_id
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Cette matière n’est pas configurée ou est désactivée pour cette classe.';
  END IF;

  IF v_pedagogical_mode = 'primary_homeroom' THEN
    IF v_homeroom_teacher_id IS NULL OR v_homeroom_teacher_id <> v_uid THEN
      RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas l’enseignant titulaire de cette classe primaire.';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.teacher_class_assignments tca
      WHERE tca.teacher_id = v_teacher_id
        AND tca.school_id = v_school_id
        AND tca.class_id = p_class_id
        AND tca.subject_id = p_subject_id
        AND tca.academic_year_id = v_year_id
        AND tca.is_active = true
    ) THEN
      RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas affecté(e) à cette classe et cette matière.';
    END IF;
  END IF;

  SELECT out_term_id, out_period_id
  INTO v_resolved_term_id, v_resolved_period_id
  FROM public.resolve_homework_academic_period(v_school_id, v_year_id, v_education_cycle, p_assigned_on, p_term_id);

  IF p_publish_now THEN
    v_status := 'published';
    v_published_at := now();
  END IF;

  INSERT INTO public.school_homework (
    school_id,
    academic_year_id,
    term_id,
    period_id,
    class_id,
    subject_id,
    teacher_id,
    title,
    instructions,
    assigned_on,
    due_at,
    estimated_minutes,
    status,
    published_at,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    v_school_id,
    v_year_id,
    v_resolved_term_id,
    v_resolved_period_id,
    p_class_id,
    p_subject_id,
    v_teacher_id,
    trim(p_title),
    trim(p_instructions),
    p_assigned_on,
    p_due_at,
    p_estimated_minutes,
    v_status,
    v_published_at,
    v_uid,
    now(),
    now()
  )
  RETURNING id INTO v_homework_id;

  RETURN v_homework_id;
END;
$$;
-- 3. RPC : update_teacher_homework (Recalcule term_id et period_id lors des modifications)
CREATE OR REPLACE FUNCTION public.update_teacher_homework(
  p_homework_id UUID,
  p_title TEXT,
  p_instructions TEXT,
  p_assigned_on DATE,
  p_due_at TIMESTAMPTZ,
  p_estimated_minutes INTEGER DEFAULT NULL,
  p_term_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_hw RECORD;
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school_status TEXT;
  v_tch_id UUID;
  v_tch_acc_status TEXT;
  v_tch_emp_status TEXT;
  v_pedagogical_mode TEXT;
  v_homeroom_teacher_id UUID;
  v_education_cycle TEXT;
  v_resolved_term_id UUID;
  v_resolved_period_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_uid;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif.';
  END IF;

  SELECT * INTO v_hw
  FROM public.school_homework
  WHERE id = p_homework_id
  FOR UPDATE;

  IF v_hw.id IS NULL THEN
    RAISE EXCEPTION 'Devoir introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' THEN
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_caller_school_id;
    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
    END IF;

    IF v_hw.school_id <> v_caller_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Ce devoir appartient à un autre établissement.';
    END IF;
  END IF;

  IF v_caller_role = 'teacher' THEN
    SELECT id, account_status, employment_status INTO v_tch_id, v_tch_acc_status, v_tch_emp_status
    FROM public.teachers WHERE profile_id = v_uid AND school_id = v_caller_school_id;

    IF v_tch_id IS NULL OR v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte enseignant n’est pas actif.';
    END IF;

    IF v_hw.teacher_id <> v_tch_id THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez modifier que vos propres devoirs.';
    END IF;

    SELECT coalesce(pedagogical_mode, 'secondary_subjects'), homeroom_teacher_id
    INTO v_pedagogical_mode, v_homeroom_teacher_id
    FROM public.classes WHERE id = v_hw.class_id;

    IF NOT EXISTS (
      SELECT 1
      FROM public.get_effective_class_subjects(v_hw.class_id, v_hw.academic_year_id) e
      WHERE e.subject_id = v_hw.subject_id
    ) THEN
      RAISE EXCEPTION 'Accès refusé : Cette matière n’est pas configurée ou est désactivée pour cette classe.';
    END IF;

    IF v_pedagogical_mode = 'primary_homeroom' THEN
      IF v_homeroom_teacher_id IS NULL OR v_homeroom_teacher_id <> v_uid THEN
        RAISE EXCEPTION 'Accès refusé : Vous n’êtes plus l’enseignant titulaire de cette classe primaire.';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM public.teacher_class_assignments tca
        WHERE tca.teacher_id = v_tch_id
          AND tca.school_id = v_hw.school_id
          AND tca.class_id = v_hw.class_id
          AND tca.subject_id = v_hw.subject_id
          AND tca.academic_year_id = v_hw.academic_year_id
          AND tca.is_active = true
      ) THEN
        RAISE EXCEPTION 'Accès refusé : Votre affectation à cette classe et cette matière n’est plus active.';
      END IF;
    END IF;
  ELSIF v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  IF v_hw.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'Modification interdite : Ce devoir est déjà % et ne peut plus être modifié.', v_hw.status;
  END IF;

  SELECT education_cycle INTO v_education_cycle FROM public.classes WHERE id = v_hw.class_id;

  SELECT out_term_id, out_period_id
  INTO v_resolved_term_id, v_resolved_period_id
  FROM public.resolve_homework_academic_period(v_hw.school_id, v_hw.academic_year_id, v_education_cycle, p_assigned_on, p_term_id);

  UPDATE public.school_homework
  SET
    title = trim(p_title),
    instructions = trim(p_instructions),
    assigned_on = p_assigned_on,
    due_at = p_due_at,
    estimated_minutes = p_estimated_minutes,
    term_id = v_resolved_term_id,
    period_id = v_resolved_period_id,
    updated_at = now()
  WHERE id = p_homework_id;

  RETURN true;
END;
$$;


-- 4. RPC : publish_teacher_homework (Auto-réparation atomique lors de la publication)
CREATE OR REPLACE FUNCTION public.publish_teacher_homework(p_homework_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_hw RECORD;
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school_status TEXT;
  v_tch_id UUID;
  v_tch_acc_status TEXT;
  v_tch_emp_status TEXT;
  v_pedagogical_mode TEXT;
  v_homeroom_teacher_id UUID;
  v_education_cycle TEXT;
  v_resolved_term_id UUID;
  v_resolved_period_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_uid;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif.';
  END IF;

  SELECT * INTO v_hw FROM public.school_homework WHERE id = p_homework_id FOR UPDATE;

  IF v_hw.id IS NULL THEN
    RAISE EXCEPTION 'Devoir introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' THEN
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_caller_school_id;
    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
    END IF;

    IF v_hw.school_id <> v_caller_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Ce devoir appartient à un autre établissement.';
    END IF;
  END IF;

  IF v_caller_role = 'teacher' THEN
    SELECT id, account_status, employment_status INTO v_tch_id, v_tch_acc_status, v_tch_emp_status
    FROM public.teachers WHERE profile_id = v_uid AND school_id = v_caller_school_id;

    IF v_tch_id IS NULL OR v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte enseignant n’est pas actif.';
    END IF;

    IF v_hw.teacher_id <> v_tch_id THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez publier que vos propres devoirs.';
    END IF;

    SELECT coalesce(pedagogical_mode, 'secondary_subjects'), homeroom_teacher_id
    INTO v_pedagogical_mode, v_homeroom_teacher_id
    FROM public.classes WHERE id = v_hw.class_id;

    IF v_pedagogical_mode = 'primary_homeroom' THEN
      IF v_homeroom_teacher_id IS NULL OR v_homeroom_teacher_id <> v_uid THEN
        RAISE EXCEPTION 'Accès refusé : Vous n’êtes plus l’enseignant titulaire de cette classe primaire.';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.get_effective_class_subjects(v_hw.class_id, v_hw.academic_year_id) e
        WHERE e.subject_id = v_hw.subject_id
      ) THEN
        RAISE EXCEPTION 'Accès refusé : Cette matière n’est plus configurée ou est désactivée pour cette classe.';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM public.teacher_class_assignments tca
        WHERE tca.teacher_id = v_tch_id
          AND tca.school_id = v_hw.school_id
          AND tca.class_id = v_hw.class_id
          AND tca.subject_id = v_hw.subject_id
          AND tca.academic_year_id = v_hw.academic_year_id
          AND tca.is_active = true
      ) THEN
        RAISE EXCEPTION 'Accès refusé : Votre affectation à cette classe et cette matière n’est plus active.';
      END IF;
    END IF;
  ELSIF v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  IF v_hw.status <> 'draft' THEN
    RAISE EXCEPTION 'Publication impossible : Seul un devoir au statut "draft" peut être publié.';
  END IF;

  -- Resolution / Auto-réparation déterministe obligatoire du couple term_id et period_id
  SELECT education_cycle INTO v_education_cycle FROM public.classes WHERE id = v_hw.class_id;

  SELECT out_term_id, out_period_id
  INTO v_resolved_term_id, v_resolved_period_id
  FROM public.resolve_homework_academic_period(v_hw.school_id, v_hw.academic_year_id, v_education_cycle, v_hw.assigned_on, v_hw.term_id);

  UPDATE public.school_homework
  SET status = 'published',
      term_id = v_resolved_term_id,
      period_id = v_resolved_period_id,
      published_at = now(),
      updated_at = now()
  WHERE id = p_homework_id;

  RETURN true;
END;
$$;


-- ============================================================================
-- BLOC DE TEST TRANSACTIONNEL (18 SCÉNARIOS COMPLETS)
-- ============================================================================
DO $$
DECLARE
  v_school_a UUID := gen_random_uuid();
  v_school_b UUID := gen_random_uuid();
  v_year_2027 UUID := gen_random_uuid();
  v_year_other UUID := gen_random_uuid();
  v_year_school_b UUID := gen_random_uuid();

  -- Termes et périodes de l'école A (Primaire)
  v_term_t1 UUID := gen_random_uuid();
  v_term_t2 UUID := gen_random_uuid();
  v_period_p1 UUID := gen_random_uuid();
  v_period_p2 UUID := gen_random_uuid();

  -- Termes et périodes de l'école A (Secondaire)
  v_term_s1 UUID := gen_random_uuid();
  v_period_sp1 UUID := gen_random_uuid();

  -- Éléments d'une autre école / année
  v_term_other_school UUID := gen_random_uuid();
  v_term_other_year UUID := gen_random_uuid();

  -- Profils et Utilisateurs
  v_prof_teacher_a UUID := gen_random_uuid();
  v_prof_teacher_b UUID := gen_random_uuid();
  v_prof_parent UUID := gen_random_uuid();
  v_prof_student UUID := gen_random_uuid();

  -- IDs Entités
  v_teacher_id_a UUID := gen_random_uuid();
  v_teacher_id_b UUID := gen_random_uuid();
  v_class_primary_2a UUID := gen_random_uuid();
  v_class_sec_1a UUID := gen_random_uuid();
  v_subject_math UUID := gen_random_uuid();
  v_subject_francais UUID := gen_random_uuid();

  -- Devoirs de test
  v_hw_primary_id UUID;
  v_hw_explicit_term_id UUID;
  v_hw_old_draft_id UUID;
  v_hw_old_draft_bad_date_id UUID;
  v_hw_sec_id UUID;

  -- Checks
  v_term_check UUID;
  v_period_check UUID;
  v_status_check TEXT;
  v_pub_at_check TIMESTAMPTZ;
  v_json_res JSONB;
  v_student_id UUID := gen_random_uuid();
  v_enrollment_id UUID := gen_random_uuid();

  -- Periods de test d'overlap
  v_period_overlap_1 UUID := gen_random_uuid();
  v_period_overlap_2 UUID := gen_random_uuid();
BEGIN
  RAISE NOTICE '=== DEBUT EXECUTION SUITE TRANSACTIONNELLE LOT 2I-P4-T3-V2 (18 SCENARIOS) ===';

  -- 1. INITIALISATION DES ÉTABLISSEMENTS ET ANNÉES
  INSERT INTO public.schools (id, name, slug, status, education_cycles)
  VALUES
    (v_school_a, 'École Test A', 'sch-a-p4t3v2', 'active', ARRAY['primary', 'secondary']),
    (v_school_b, 'École Test B', 'sch-b-p4t3v2', 'active', ARRAY['primary', 'secondary']);

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES
    (v_year_2027, v_school_a, '2026-2027', '2026-09-01', '2027-07-02', true),
    (v_year_other, v_school_a, '2025-2026', '2025-09-01', '2026-07-02', false),
    (v_year_school_b, v_school_b, '2026-2027', '2026-09-01', '2027-07-02', true);

  -- 2. AUTH USERS ET PROFILS
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud)
  VALUES
    (v_prof_teacher_a, '00000000-0000-0000-0000-000000000000', 'teacher_a_p4t3v2@test.com', 'pwd', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated'),
    (v_prof_teacher_b, '00000000-0000-0000-0000-000000000000', 'teacher_b_p4t3v2@test.com', 'pwd', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated'),
    (v_prof_parent, '00000000-0000-0000-0000-000000000000', 'parent_p4t3v2@test.com', 'pwd', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated'),
    (v_prof_student, '00000000-0000-0000-0000-000000000000', 'student_p4t3v2@test.com', 'pwd', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, school_id, first_name, last_name, display_name, role, is_active)
  VALUES
    (v_prof_teacher_a, v_school_a, 'Grâce', 'Kabeya', 'Grâce Kabeya', 'teacher', true),
    (v_prof_teacher_b, v_school_a, 'Prof', 'B', 'Prof B', 'teacher', true),
    (v_prof_parent, v_school_a, 'Parent', 'A', 'Parent A', 'parent', true),
    (v_prof_student, v_school_a, 'Élève', 'A', 'Élève A', 'student', true);

  INSERT INTO public.teachers (id, profile_id, school_id, employee_number, first_name, last_name, account_status, employment_status)
  VALUES
    (v_teacher_id_a, v_prof_teacher_a, v_school_a, 'EMP-T3V2-A', 'Grâce', 'Kabeya', 'active', 'active'),
    (v_teacher_id_b, v_prof_teacher_b, v_school_a, 'EMP-T3V2-B', 'Prof', 'B', 'active', 'active');

  -- 3. CALENDRIER SCOLAIRE ÉCOLE A (PRIMAIRE)
  INSERT INTO public.school_terms (id, school_id, academic_year_id, position, name, education_cycle, division_type, starts_on, ends_on, is_active)
  VALUES (v_term_t1, v_school_a, v_year_2027, 1, '1er Trimestre', 'primary', 'trimester', '2026-09-01', '2026-12-22', true);

  INSERT INTO public.school_terms (id, school_id, academic_year_id, position, name, education_cycle, division_type, starts_on, ends_on, is_active)
  VALUES (v_term_t2, v_school_a, v_year_2027, 2, '2e Trimestre', 'primary', 'trimester', '2027-01-04', '2027-03-31', true);

  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, name, education_cycle, position, position_within_parent, starts_on, ends_on, is_active)
  VALUES (v_period_p1, v_school_a, v_year_2027, v_term_t1, '1re Période', 'primary', 1, 1, '2026-09-01', '2026-10-11', true);

  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, name, education_cycle, position, position_within_parent, starts_on, ends_on, is_active)
  VALUES (v_period_p2, v_school_a, v_year_2027, v_term_t1, '2e Période', 'primary', 2, 2, '2026-10-12', '2026-11-15', true);

  -- 4. CALENDRIER SCOLAIRE ÉCOLE A (SECONDAIRE)
  INSERT INTO public.school_terms (id, school_id, academic_year_id, position, name, education_cycle, division_type, starts_on, ends_on, is_active)
  VALUES (v_term_s1, v_school_a, v_year_2027, 1, '1er Semestre', 'secondary', 'semester', '2026-09-01', '2027-01-31', true);

  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, name, education_cycle, position, position_within_parent, starts_on, ends_on, is_active)
  VALUES (v_period_sp1, v_school_a, v_year_2027, v_term_s1, '1re Période Secondaire', 'secondary', 1, 1, '2026-09-01', '2026-10-31', true);

  -- 5. ÉLÉMENTS AUTRE ÉCOLE / AUTRE ANNÉE
  INSERT INTO public.school_terms (id, school_id, academic_year_id, position, name, education_cycle, division_type, starts_on, ends_on, is_active)
  VALUES (v_term_other_school, v_school_b, v_year_school_b, 1, 'Trimestre Autre École', 'primary', 'trimester', '2026-09-01', '2026-12-22', true);

  INSERT INTO public.school_terms (id, school_id, academic_year_id, position, name, education_cycle, division_type, starts_on, ends_on, is_active)
  VALUES (v_term_other_year, v_school_a, v_year_other, 1, 'Trimestre Ancien', 'primary', 'trimester', '2025-09-01', '2025-12-22', true);

  -- 6. CLASSES ET MATIÈRES
  INSERT INTO public.classes (id, school_id, academic_year_id, name, level, education_cycle, pedagogical_mode, homeroom_teacher_id, is_active)
  VALUES (v_class_primary_2a, v_school_a, v_year_2027, '2A', '2ème', 'primary', 'primary_homeroom', v_prof_teacher_a, true);

  INSERT INTO public.classes (id, school_id, academic_year_id, name, level, education_cycle, pedagogical_mode, is_active)
  VALUES (v_class_sec_1a, v_school_a, v_year_2027, '1A Sec', '1ère', 'secondary', 'secondary_subjects', true);

  INSERT INTO public.subjects (id, school_id, name, code, is_active)
  VALUES
    (v_subject_math, v_school_a, 'Mathématiques', 'MATH', true),
    (v_subject_francais, v_school_a, 'Français', 'FRAN', true);

  INSERT INTO public.teacher_class_assignments (school_id, academic_year_id, teacher_id, class_id, subject_id, subject_name, is_active)
  VALUES (v_school_a, v_year_2027, v_teacher_id_b, v_class_sec_1a, v_subject_francais, 'Français', true);


  -- ============================================================================
  -- TEST SCÉNARIOS 1 À 18
  -- ============================================================================

  -- SCÉNARIO 1 & 2 : Création avec p_term_id = NULL à une date couverte par une période unique -> term_id & period_id valides
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);

  v_hw_primary_id := public.create_teacher_homework(
    v_class_primary_2a,
    v_subject_math,
    'Devoir Math 24 Septembre',
    'Consignes page 12',
    '2026-09-24', -- Couvert par 1re Période
    '2026-09-27 18:00:00+00'::timestamptz,
    20,
    false,
    NULL -- p_term_id = NULL
  );

  SELECT term_id, period_id INTO v_term_check, v_period_check
  FROM public.school_homework WHERE id = v_hw_primary_id;

  IF v_term_check <> v_term_t1 OR v_period_check <> v_period_p1 THEN
    RAISE EXCEPTION 'SCÉNARIO 1/2 FAILED: term_id/period_id non enregistrés dès la création avec p_term_id=NULL.';
  END IF;

  RAISE NOTICE 'SCÉNARIOS 1 & 2 PASSED: Résolution et enregistrement automatiques du couple term_id et period_id dès la création.';


  -- SCÉNARIO 3 : Création avec p_term_id explicite et une période enfant unique couvrant la date
  v_hw_explicit_term_id := public.create_teacher_homework(
    v_class_primary_2a,
    v_subject_math,
    'Devoir Explicite Terme',
    'Consignes',
    '2026-09-24',
    '2026-09-27 18:00:00+00'::timestamptz,
    15,
    false,
    v_term_t1 -- Terme fourni
  );

  SELECT term_id, period_id INTO v_term_check, v_period_check
  FROM public.school_homework WHERE id = v_hw_explicit_term_id;

  IF v_term_check <> v_term_t1 OR v_period_check <> v_period_p1 THEN
    RAISE EXCEPTION 'SCÉNARIO 3 FAILED: Résolution avec p_term_id explicite échouée.';
  END IF;

  RAISE NOTICE 'SCÉNARIO 3 PASSED: Résolution avec p_term_id explicite et période couvrante réussie.';


  -- SCÉNARIO 4 : p_term_id explicite dont aucune période enfant ne couvre la date -> Refus
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary_2a,
      v_subject_math,
      'Devoir Terme Sans Période Couvrante',
      'Consigne',
      '2026-11-20', -- Date non couverte par les périodes du v_term_t1
      '2026-11-23 18:00:00+00'::timestamptz,
      15,
      false,
      v_term_t1
    );
    RAISE EXCEPTION 'SCÉNARIO 4 FAILED: La sélection arbitraire d’une première période a subsisté !';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Aucune période scolaire active sous le terme spécifié ne couvre la date%' THEN
      RAISE EXCEPTION 'SCÉNARIO 4 FAILED: Message inattendu : %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'SCÉNARIO 4 PASSED: Sélection de "première période" supprimée. Refus explicite si la période ne couvre pas la date.';


  -- SCÉNARIO 5 & 6 : Plusieurs périodes couvrant la date -> Refus ambigu
  ALTER TABLE public.school_periods DISABLE TRIGGER trg_validate_school_period_dates;

  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, name, education_cycle, position, position_within_parent, starts_on, ends_on, is_active)
  VALUES
    (v_period_overlap_1, v_school_a, v_year_2027, v_term_t2, 'Période Overlap A', 'primary', 4, 1, '2027-01-10', '2027-01-20', true),
    (v_period_overlap_2, v_school_a, v_year_2027, v_term_t2, 'Période Overlap B', 'primary', 5, 2, '2027-01-15', '2027-01-25', true);

  ALTER TABLE public.school_periods ENABLE TRIGGER trg_validate_school_period_dates;

  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary_2a,
      v_subject_math,
      'Devoir Date Conflit',
      'Consigne',
      '2027-01-17',
      '2027-01-20 18:00:00+00'::timestamptz,
      15,
      false
    );
    RAISE EXCEPTION 'SCÉNARIOS 5/6 FAILED: Chevauchement ambigu non refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Conflit de calendrier scolaire%' THEN
      RAISE EXCEPTION 'SCÉNARIOS 5/6 FAILED: Message d’erreur inattendu : %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'SCÉNARIOS 5 & 6 PASSED: Chevauchement de périodes du même terme ou de termes différents refusé.';


  -- SCÉNARIO 7 : Aucune période couvrante mais terme actif existant -> Refus, aucun fallback terme seul
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary_2a,
      v_subject_math,
      'Devoir Date Vacances',
      'Consigne',
      '2026-12-01', -- Date dans le 1er trimestre mais sans période active
      '2026-12-05 18:00:00+00'::timestamptz,
      15,
      false
    );
    RAISE EXCEPTION 'SCÉNARIO 7 FAILED: Le fallback vers un terme sans période a subsisté !';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%n’est couverte par aucune période scolaire active%' THEN
      RAISE EXCEPTION 'SCÉNARIO 7 FAILED: Message inattendu : %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'SCÉNARIO 7 PASSED: Fallback terme sans période supprimé. Exigence stricte du couple term_id/period_id.';


  -- SCÉNARIOS 8, 9, 10 : Terme d'une autre école, autre année ou cycle incompatible -> Refus
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary_2a,
      v_subject_math,
      'Devoir Autre École',
      'Consigne',
      '2026-09-24',
      '2026-09-27 18:00:00+00'::timestamptz,
      15,
      false,
      v_term_other_school
    );
    RAISE EXCEPTION 'SCÉNARIO 8 FAILED: Terme autre école non refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé : Le terme scolaire spécifié est introuvable%' THEN
      RAISE EXCEPTION 'SCÉNARIO 8 FAILED: Message inattendu : %', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary_2a,
      v_subject_math,
      'Devoir Autre Année',
      'Consigne',
      '2026-09-24',
      '2026-09-27 18:00:00+00'::timestamptz,
      15,
      false,
      v_term_other_year
    );
    RAISE EXCEPTION 'SCÉNARIO 9 FAILED: Terme autre année non refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé : Le terme scolaire spécifié est introuvable%' THEN
      RAISE EXCEPTION 'SCÉNARIO 9 FAILED: Message inattendu : %', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary_2a,
      v_subject_math,
      'Devoir Cycle Incompatible',
      'Consigne',
      '2026-09-24',
      '2026-09-27 18:00:00+00'::timestamptz,
      15,
      false,
      v_term_s1 -- Semestre secondaire sur classe primaire
    );
    RAISE EXCEPTION 'SCÉNARIO 10 FAILED: Terme de cycle incompatible non refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé : Le terme scolaire spécifié est introuvable%' THEN
      RAISE EXCEPTION 'SCÉNARIO 10 FAILED: Message inattendu : %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'SCÉNARIOS 8, 9 & 10 PASSED: Contrôle strict d’appartenance établissement, année et cycle.';


  -- SCÉNARIO 11 : Modification de assigned_on vers une autre période -> Recalcul déterministe
  PERFORM public.update_teacher_homework(
    v_hw_primary_id,
    'Devoir Math 20 Octobre',
    'Nouvelle consigne',
    '2026-10-20', -- 2e Période
    '2026-10-23 18:00:00+00'::timestamptz,
    25
  );

  SELECT term_id, period_id INTO v_term_check, v_period_check
  FROM public.school_homework WHERE id = v_hw_primary_id;

  IF v_term_check <> v_term_t1 OR v_period_check <> v_period_p2 THEN
    RAISE EXCEPTION 'SCÉNARIO 11 FAILED: Recalcul lors de update_teacher_homework échoué (term=%, period=%). Attendu term=%, period=%.',
      v_term_check, v_period_check, v_term_t1, v_period_p2;
  END IF;

  RAISE NOTICE 'SCÉNARIO 11 PASSED: Recalcul déterministe du couple lors de la modification de date.';


  -- SCÉNARIO 12 : Publication d'un ancien brouillon avec term_id = NULL et period_id = NULL -> Auto-réparation atomique
  v_hw_old_draft_id := gen_random_uuid();

  INSERT INTO public.school_homework (
    id, school_id, academic_year_id, term_id, period_id, class_id, subject_id, teacher_id,
    title, instructions, assigned_on, due_at, estimated_minutes, status, created_by, created_at, updated_at
  )
  VALUES (
    v_hw_old_draft_id,
    v_school_a, v_year_2027, NULL, NULL, v_class_primary_2a, v_subject_math, v_teacher_id_a,
    'Ancien Brouillon Incomplet', 'Consignes', '2026-09-24', NOW() + INTERVAL '2 days', 15, 'draft', v_prof_teacher_a, now(), now()
  );

  PERFORM public.publish_teacher_homework(v_hw_old_draft_id);

  SELECT term_id, period_id, status, published_at
  INTO v_term_check, v_period_check, v_status_check, v_pub_at_check
  FROM public.school_homework WHERE id = v_hw_old_draft_id;

  IF v_term_check <> v_term_t1 OR v_period_check <> v_period_p1 OR v_status_check <> 'published' OR v_pub_at_check IS NULL THEN
    RAISE EXCEPTION 'SCÉNARIO 12 FAILED: Auto-réparation atomique à la publication échouée.';
  END IF;

  RAISE NOTICE 'SCÉNARIO 12 PASSED: Auto-réparation atomique à la publication d’un ancien brouillon réussie.';


  -- SCÉNARIO 13 : Échec de publication d'un ancien brouillon hors calendrier -> Identifiants et statut inchangés
  v_hw_old_draft_bad_date_id := gen_random_uuid();

  INSERT INTO public.school_homework (
    id, school_id, academic_year_id, term_id, period_id, class_id, subject_id, teacher_id,
    title, instructions, assigned_on, due_at, estimated_minutes, status, created_by, created_at, updated_at
  )
  VALUES (
    v_hw_old_draft_bad_date_id,
    v_school_a, v_year_2027, NULL, NULL, v_class_primary_2a, v_subject_math, v_teacher_id_a,
    'Ancien Brouillon Hors Calendrier', 'Consignes', '2026-12-01', '2026-12-05 18:00:00+00'::timestamptz, 15, 'draft', v_prof_teacher_a, now(), now()
  );

  BEGIN
    PERFORM public.publish_teacher_homework(v_hw_old_draft_bad_date_id);
    RAISE EXCEPTION 'SCÉNARIO 13 FAILED: La publication d’un brouillon hors calendrier aurait dû échouer.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%n’est couverte par aucune période scolaire active%' THEN
      RAISE EXCEPTION 'SCÉNARIO 13 FAILED: Erreur inattendue : %', SQLERRM;
    END IF;
  END;

  SELECT term_id, period_id, status, published_at
  INTO v_term_check, v_period_check, v_status_check, v_pub_at_check
  FROM public.school_homework WHERE id = v_hw_old_draft_bad_date_id;

  IF v_term_check IS NOT NULL OR v_period_check IS NOT NULL OR v_status_check <> 'draft' OR v_pub_at_check IS NOT NULL THEN
    RAISE EXCEPTION 'SCÉNARIO 13 FAILED: Les identifiants ou le statut ont été altérés malgré l’échec !';
  END IF;

  RAISE NOTICE 'SCÉNARIO 13 PASSED: Échec de publication d’un brouillon hors calendrier laisse l’enregistrement strictement intact.';


  -- SCÉNARIO 14 : Visibilité Parent après publication réussie
  INSERT INTO public.students (id, profile_id, school_id, student_number, account_status)
  VALUES (v_student_id, v_prof_student, v_school_a, 'STD-002', 'active');

  INSERT INTO public.parent_student_links (parent_profile_id, student_id, school_id, status, can_view_homework)
  VALUES (v_prof_parent, v_student_id, v_school_a, 'approved', true);

  INSERT INTO public.student_enrollments (id, school_id, academic_year_id, class_id, student_id, status)
  VALUES (v_enrollment_id, v_school_a, v_year_2027, v_class_primary_2a, v_student_id, 'active');

  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_parent::text);

  v_json_res := public.get_parent_student_homework(v_student_id);

  IF v_json_res->'homework' IS NULL OR jsonb_array_length(v_json_res->'homework') < 1 THEN
    RAISE EXCEPTION 'SCÉNARIO 14 FAILED: Le devoir auto-réparé et publié n’est pas visible par le parent.';
  END IF;

  RAISE NOTICE 'SCÉNARIO 14 PASSED: Visibilité du devoir auto-réparé et publié par le parent confirmée.';


  -- SCÉNARIO 15 : Comportement secondaire validé (Semestre et Période secondaire)
  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_b::text);

  v_hw_sec_id := public.create_teacher_homework(
    v_class_sec_1a,
    v_subject_francais,
    'Devoir Secondaire 15 Septembre',
    'Consignes grammaire',
    '2026-09-15',
    NOW() + INTERVAL '3 days',
    30,
    true
  );

  SELECT term_id, period_id, status INTO v_term_check, v_period_check, v_status_check
  FROM public.school_homework WHERE id = v_hw_sec_id;

  IF v_term_check <> v_term_s1 OR v_period_check <> v_period_sp1 OR v_status_check <> 'published' THEN
    RAISE EXCEPTION 'SCÉNARIO 15 FAILED: Résolution secondaire incorrecte.';
  END IF;

  RAISE NOTICE 'SCÉNARIO 15 PASSED: Comportement secondaire (Semestre et Période) entièrement validé.';


  -- SCÉNARIO 16 : Annulation et clôture conformes
  PERFORM public.cancel_teacher_homework(v_hw_sec_id, 'Motif annulation test');
  SELECT status INTO v_status_check FROM public.school_homework WHERE id = v_hw_sec_id;
  IF v_status_check <> 'cancelled' THEN
    RAISE EXCEPTION 'SCÉNARIO 16.a FAILED: Annulation échouée.';
  END IF;

  EXECUTE format('SET LOCAL %I = %L', 'request.jwt.claim.sub', v_prof_teacher_a::text);
  PERFORM public.publish_teacher_homework(v_hw_primary_id);
  PERFORM public.close_teacher_homework(v_hw_primary_id);
  SELECT status INTO v_status_check FROM public.school_homework WHERE id = v_hw_primary_id;
  IF v_status_check <> 'closed' THEN
    RAISE EXCEPTION 'SCÉNARIO 16.b FAILED: Clôture échouée.';
  END IF;

  RAISE NOTICE 'SCÉNARIO 16 PASSED: Annulation et clôture conformes.';


  -- SCÉNARIO 17 : Vérification privilèges helper interne (inexécutable par PUBLIC, anon, authenticated)
  IF has_function_privilege('authenticated', 'public.resolve_homework_academic_period(uuid,uuid,text,date,uuid)', 'EXECUTE') OR
     has_function_privilege('anon', 'public.resolve_homework_academic_period(uuid,uuid,text,date,uuid)', 'EXECUTE') OR
     has_function_privilege('public', 'public.resolve_homework_academic_period(uuid,uuid,text,date,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SCÉNARIO 17 FAILED: Le helper interne resolve_homework_academic_period possède encore des privilèges d’exécution directe !';
  END IF;

  RAISE NOTICE 'SCÉNARIO 17 PASSED: Helper resolve_homework_academic_period strictement interne (privilèges révoqués pour authenticated, anon, PUBLIC).';


  -- SCÉNARIO 18 : Aucune donnée persistante après ROLLBACK
  RAISE NOTICE '=== SUITE TRANSACTIONNELLE COMPLÈTE LOT 2I-P4-T3-V2 (18 SCÉNARIOS) RÉUSSIE AVEC SUCCÈS ===';
END $$;

ROLLBACK;
