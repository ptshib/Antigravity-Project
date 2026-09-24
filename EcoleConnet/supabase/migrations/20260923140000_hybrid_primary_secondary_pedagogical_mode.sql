-- Migration horodatée : 20260923140000_hybrid_primary_secondary_pedagogical_mode.sql
-- Lot 2I-P : Modèle Pédagogique Hybride Primaire / Secondaire

-- 1. Ajout de la colonne pedagogical_mode sur public.classes (idempotent, default 'secondary_subjects')
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS pedagogical_mode TEXT NOT NULL DEFAULT 'secondary_subjects';

DO $$
BEGIN
  ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS chk_classes_pedagogical_mode;
  ALTER TABLE public.classes
    ADD CONSTRAINT chk_classes_pedagogical_mode
    CHECK (pedagogical_mode IN ('primary_homeroom', 'secondary_subjects'));
END $$;

-- 2. RPC pour définir / modifier le mode pédagogique d'une classe (Admin)
CREATE OR REPLACE FUNCTION public.set_class_pedagogical_mode(
  p_class_id UUID,
  p_pedagogical_mode TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_class_school_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles p WHERE p.id = v_uid;

  IF v_caller_active IS NOT TRUE OR v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seul un administrateur peut modifier le mode pédagogique d’une classe.';
  END IF;

  IF p_pedagogical_mode NOT IN ('primary_homeroom', 'secondary_subjects') THEN
    RAISE EXCEPTION 'Mode pédagogique invalide. Choix autorisés : primary_homeroom, secondary_subjects.';
  END IF;

  SELECT c.school_id INTO v_class_school_id FROM public.classes c WHERE c.id = p_class_id;
  IF v_class_school_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' AND v_class_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cette classe appartient à un autre établissement.';
  END IF;

  UPDATE public.classes
  SET pedagogical_mode = p_pedagogical_mode,
      updated_at = now()
  WHERE id = p_class_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_class_pedagogical_mode(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_class_pedagogical_mode(UUID, TEXT) TO authenticated;
ALTER FUNCTION public.set_class_pedagogical_mode(UUID, TEXT) OWNER TO postgres;


-- 3. RPC : get_teacher_authorized_subjects
CREATE OR REPLACE FUNCTION public.get_teacher_authorized_subjects(p_class_id UUID)
RETURNS TABLE (
  subject_id UUID,
  subject_name TEXT,
  subject_code TEXT,
  pedagogical_mode TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school_status TEXT;
  v_tch_id UUID;
  v_tch_acc_status TEXT;
  v_tch_emp_status TEXT;
  v_class_school_id UUID;
  v_class_pedagogical_mode TEXT;
  v_class_homeroom_teacher_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles p WHERE p.id = v_uid;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif.';
  END IF;

  IF v_caller_role NOT IN ('teacher', 'school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  SELECT c.school_id, coalesce(c.pedagogical_mode, 'secondary_subjects'), c.homeroom_teacher_id
  INTO v_class_school_id, v_class_pedagogical_mode, v_class_homeroom_teacher_id
  FROM public.classes c
  WHERE c.id = p_class_id;

  IF v_class_school_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' AND v_class_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cette classe appartient à un autre établissement.';
  END IF;

  SELECT sc.status INTO v_school_status FROM public.schools sc WHERE sc.id = v_class_school_id;
  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
  END IF;

  IF v_caller_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_tch_id, v_tch_acc_status, v_tch_emp_status
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_class_school_id;

    IF v_tch_id IS NULL OR v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Compte enseignant inactif.';
    END IF;

    IF v_class_pedagogical_mode = 'primary_homeroom' THEN
      IF v_class_homeroom_teacher_id IS NULL OR v_class_homeroom_teacher_id <> v_uid THEN
        RETURN;
      END IF;

      RETURN QUERY
      SELECT DISTINCT
        s.id AS subject_id,
        s.name AS subject_name,
        s.code AS subject_code,
        'primary_homeroom'::TEXT AS pedagogical_mode
      FROM public.class_subject_settings css
      JOIN public.subjects s ON s.id = css.subject_id
      WHERE css.class_id = p_class_id
        AND css.school_id = v_class_school_id
        AND css.is_active = true
        AND s.is_active = true
        AND s.id IS NOT NULL
      ORDER BY s.name ASC;
    ELSE
      RETURN QUERY
      SELECT DISTINCT
        s.id AS subject_id,
        s.name AS subject_name,
        s.code AS subject_code,
        'secondary_subjects'::TEXT AS pedagogical_mode
      FROM public.teacher_class_assignments tca
      JOIN public.subjects s ON s.id = tca.subject_id
      WHERE tca.teacher_id = v_tch_id
        AND tca.class_id = p_class_id
        AND tca.school_id = v_class_school_id
        AND tca.is_active = true
        AND tca.subject_id IS NOT NULL
        AND s.is_active = true
      ORDER BY s.name ASC;
    END IF;
  ELSIF v_caller_role IN ('school_admin', 'super_admin') THEN
    RETURN QUERY
    SELECT DISTINCT
      s.id AS subject_id,
      s.name AS subject_name,
      s.code AS subject_code,
      v_class_pedagogical_mode AS pedagogical_mode
    FROM public.class_subject_settings css
    JOIN public.subjects s ON s.id = css.subject_id
    WHERE css.class_id = p_class_id
      AND css.school_id = v_class_school_id
      AND css.is_active = true
      AND s.is_active = true
      AND s.id IS NOT NULL
    ORDER BY s.name ASC;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_authorized_subjects(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_authorized_subjects(UUID) TO authenticated;
ALTER FUNCTION public.get_teacher_authorized_subjects(UUID) OWNER TO postgres;


-- 4. Redéfinition des RPCs Devoirs Enseignant avec support du mode hybride

-- A. create_teacher_homework
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
  v_period_id UUID := NULL;
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

  -- Resolution automatique de la période scolaire si term_id est fourni
  IF p_term_id IS NOT NULL THEN
    SELECT id INTO v_period_id
    FROM public.school_periods
    WHERE parent_term_id = p_term_id
      AND school_id = v_school_id
      AND academic_year_id = v_year_id
      AND (v_education_cycle IS NULL OR education_cycle = v_education_cycle)
      AND is_active = true
      AND (starts_on IS NULL OR p_assigned_on >= starts_on)
      AND (ends_on IS NULL OR p_assigned_on <= ends_on)
    ORDER BY position_within_parent ASC
    LIMIT 1;

    IF v_period_id IS NULL THEN
      SELECT id INTO v_period_id
      FROM public.school_periods
      WHERE parent_term_id = p_term_id
        AND school_id = v_school_id
        AND academic_year_id = v_year_id
        AND (v_education_cycle IS NULL OR education_cycle = v_education_cycle)
        AND is_active = true
      ORDER BY position_within_parent ASC
      LIMIT 1;
    END IF;
  END IF;

  -- Vérification des autorisations selon le mode pédagogique
  IF v_pedagogical_mode = 'primary_homeroom' THEN
    IF v_homeroom_teacher_id IS NULL OR v_homeroom_teacher_id <> v_uid THEN
      RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas l’enseignant titulaire de cette classe primaire.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.class_subject_settings css
      JOIN public.subjects s ON s.id = css.subject_id
      WHERE css.class_id = p_class_id
        AND css.subject_id = p_subject_id
        AND css.school_id = v_school_id
        AND css.is_active = true
        AND s.is_active = true
    ) THEN
      RAISE EXCEPTION 'Accès refusé : Cette matière n’est pas configurée pour cette classe.';
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
    created_by
  ) VALUES (
    v_school_id,
    v_year_id,
    p_term_id,
    v_period_id,
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
    v_uid
  ) RETURNING id INTO v_homework_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_school_id,
    v_uid,
    'homework_created',
    jsonb_build_object(
      'entity_type', 'school_homework',
      'entity_id', v_homework_id,
      'homework_id', v_homework_id,
      'title', trim(p_title),
      'class_id', p_class_id,
      'subject_id', p_subject_id,
      'status', v_status,
      'due_at', p_due_at,
      'pedagogical_mode', v_pedagogical_mode
    )
  );

  RETURN v_homework_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) TO authenticated;
ALTER FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) OWNER TO postgres;


-- B. update_teacher_homework
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
  v_period_id UUID := NULL;
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

    IF v_pedagogical_mode = 'primary_homeroom' THEN
      IF v_homeroom_teacher_id IS NULL OR v_homeroom_teacher_id <> v_uid THEN
        RAISE EXCEPTION 'Accès refusé : Vous n’êtes plus l’enseignant titulaire de cette classe primaire.';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.class_subject_settings css
        JOIN public.subjects s ON s.id = css.subject_id
        WHERE css.class_id = v_hw.class_id
          AND css.subject_id = v_hw.subject_id
          AND css.school_id = v_hw.school_id
          AND css.is_active = true
          AND s.is_active = true
      ) THEN
        RAISE EXCEPTION 'Accès refusé : Cette matière n’est plus configurée pour cette classe.';
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

  IF v_hw.status = 'published' THEN
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'Modification refusée : Un motif explicite est obligatoire pour modifier un devoir déjà publié.';
    END IF;
  END IF;

  IF p_term_id IS NOT NULL THEN
    SELECT education_cycle INTO v_education_cycle FROM public.classes WHERE id = v_hw.class_id;

    SELECT id INTO v_period_id
    FROM public.school_periods
    WHERE parent_term_id = p_term_id
      AND school_id = v_hw.school_id
      AND academic_year_id = v_hw.academic_year_id
      AND (v_education_cycle IS NULL OR education_cycle = v_education_cycle)
      AND is_active = true
      AND (starts_on IS NULL OR p_assigned_on >= starts_on)
      AND (ends_on IS NULL OR p_assigned_on <= ends_on)
    ORDER BY position_within_parent ASC
    LIMIT 1;

    IF v_period_id IS NULL THEN
      SELECT id INTO v_period_id
      FROM public.school_periods
      WHERE parent_term_id = p_term_id
        AND school_id = v_hw.school_id
        AND academic_year_id = v_hw.academic_year_id
        AND (v_education_cycle IS NULL OR education_cycle = v_education_cycle)
        AND is_active = true
      ORDER BY position_within_parent ASC
      LIMIT 1;
    END IF;
  END IF;

  UPDATE public.school_homework
  SET title = trim(p_title),
      instructions = trim(p_instructions),
      assigned_on = p_assigned_on,
      due_at = p_due_at,
      estimated_minutes = p_estimated_minutes,
      term_id = p_term_id,
      period_id = coalesce(v_period_id, v_hw.period_id),
      updated_at = now()
  WHERE id = p_homework_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_hw.school_id,
    v_uid,
    'homework_updated',
    jsonb_build_object(
      'entity_type', 'school_homework',
      'entity_id', p_homework_id,
      'homework_id', p_homework_id,
      'old_status', v_hw.status,
      'new_status', v_hw.status,
      'reason', coalesce(trim(p_reason), 'Mise à jour du devoir')
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) TO authenticated;
ALTER FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) OWNER TO postgres;


-- C. publish_teacher_homework
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
        FROM public.class_subject_settings css
        JOIN public.subjects s ON s.id = css.subject_id
        WHERE css.class_id = v_hw.class_id
          AND css.subject_id = v_hw.subject_id
          AND css.school_id = v_hw.school_id
          AND css.is_active = true
          AND s.is_active = true
      ) THEN
        RAISE EXCEPTION 'Accès refusé : Cette matière n’est plus configurée pour cette classe.';
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

  UPDATE public.school_homework
  SET status = 'published',
      published_at = now(),
      updated_at = now()
  WHERE id = p_homework_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_hw.school_id,
    v_uid,
    'homework_published',
    jsonb_build_object(
      'entity_type', 'school_homework',
      'entity_id', p_homework_id,
      'homework_id', p_homework_id,
      'title', v_hw.title,
      'published_at', now()
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_teacher_homework(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_teacher_homework(UUID) TO authenticated;
ALTER FUNCTION public.publish_teacher_homework(UUID) OWNER TO postgres;


-- D. cancel_teacher_homework
CREATE OR REPLACE FUNCTION public.cancel_teacher_homework(
  p_homework_id UUID,
  p_reason TEXT
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Annulation refusée : Un motif explicite est obligatoire.';
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
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez annuler que vos propres devoirs.';
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
        FROM public.class_subject_settings css
        JOIN public.subjects s ON s.id = css.subject_id
        WHERE css.class_id = v_hw.class_id
          AND css.subject_id = v_hw.subject_id
          AND css.school_id = v_hw.school_id
          AND css.is_active = true
          AND s.is_active = true
      ) THEN
        RAISE EXCEPTION 'Accès refusé : Cette matière n’est plus configurée pour cette classe.';
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

  IF v_hw.status = 'cancelled' THEN
    RAISE EXCEPTION 'Ce devoir est déjà annulé.';
  END IF;

  UPDATE public.school_homework
  SET status = 'cancelled',
      closed_at = now(),
      updated_at = now()
  WHERE id = p_homework_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_hw.school_id,
    v_uid,
    'homework_cancelled',
    jsonb_build_object(
      'entity_type', 'school_homework',
      'entity_id', p_homework_id,
      'homework_id', p_homework_id,
      'title', v_hw.title,
      'reason', trim(p_reason),
      'cancelled_at', now()
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_teacher_homework(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_teacher_homework(UUID, TEXT) TO authenticated;
ALTER FUNCTION public.cancel_teacher_homework(UUID, TEXT) OWNER TO postgres;


-- E. close_teacher_homework
CREATE OR REPLACE FUNCTION public.close_teacher_homework(p_homework_id UUID)
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
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez clôturer que vos propres devoirs.';
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
        FROM public.class_subject_settings css
        JOIN public.subjects s ON s.id = css.subject_id
        WHERE css.class_id = v_hw.class_id
          AND css.subject_id = v_hw.subject_id
          AND css.school_id = v_hw.school_id
          AND css.is_active = true
          AND s.is_active = true
      ) THEN
        RAISE EXCEPTION 'Accès refusé : Cette matière n’est plus configurée pour cette classe.';
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

  IF v_hw.status <> 'published' THEN
    RAISE EXCEPTION 'Clôture impossible : Seul un devoir au statut "published" peut être clôturé.';
  END IF;

  UPDATE public.school_homework
  SET status = 'closed',
      closed_at = now(),
      updated_at = now()
  WHERE id = p_homework_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_hw.school_id,
    v_uid,
    'homework_closed',
    jsonb_build_object(
      'entity_type', 'school_homework',
      'entity_id', p_homework_id,
      'homework_id', p_homework_id,
      'title', v_hw.title,
      'closed_at', now()
    )
  );

  RETURN true;
END;
$$;

-- 5. Mise à jour du trigger d'intégrité check_school_homework_integrity sur public.school_homework
CREATE OR REPLACE FUNCTION public.check_school_homework_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tch_school_id UUID;
  v_tch_emp_status TEXT;
  v_tch_acc_status TEXT;
  v_tch_profile_id UUID;
  v_cls_school_id UUID;
  v_cls_year_id UUID;
  v_cls_pedagogical_mode TEXT;
  v_cls_homeroom_teacher_id UUID;
  v_year_school_id UUID;
  v_sbj_school_id UUID;
  v_term_school_id UUID;
  v_term_year_id UUID;
  v_has_active_assignment BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT school_id INTO v_year_school_id
    FROM public.academic_years
    WHERE id = NEW.academic_year_id;

    IF v_year_school_id IS NULL OR v_year_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id;
    END IF;

    IF NEW.term_id IS NOT NULL THEN
      SELECT school_id, academic_year_id INTO v_term_school_id, v_term_year_id
      FROM public.school_terms
      WHERE id = NEW.term_id;

      IF v_term_school_id IS NULL OR v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : Le trimestre (%) n’appartient pas à la même école ou année scolaire.', NEW.term_id;
      END IF;
    END IF;

    SELECT school_id, academic_year_id, coalesce(pedagogical_mode, 'secondary_subjects'), homeroom_teacher_id
    INTO v_cls_school_id, v_cls_year_id, v_cls_pedagogical_mode, v_cls_homeroom_teacher_id
    FROM public.classes
    WHERE id = NEW.class_id;

    IF v_cls_school_id IS NULL OR v_cls_school_id <> NEW.school_id OR v_cls_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La classe (%) n’appartient pas à la même école ou année scolaire.', NEW.class_id;
    END IF;

    SELECT school_id INTO v_sbj_school_id
    FROM public.subjects
    WHERE id = NEW.subject_id;

    IF v_sbj_school_id IS NULL OR v_sbj_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La matière (%) n’appartient pas à l’établissement.', NEW.subject_id;
    END IF;

    SELECT school_id, employment_status, account_status, profile_id
    INTO v_tch_school_id, v_tch_emp_status, v_tch_acc_status, v_tch_profile_id
    FROM public.teachers
    WHERE id = NEW.teacher_id;

    IF v_tch_school_id IS NULL OR v_tch_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : L’enseignant (%) n’appartient pas à cet établissement.', NEW.teacher_id;
    END IF;

    IF v_tch_emp_status <> 'active' OR v_tch_acc_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Le dossier de l’enseignant n’est pas actif.';
    END IF;

    IF v_cls_pedagogical_mode = 'primary_homeroom' THEN
      IF v_cls_homeroom_teacher_id IS NULL OR v_cls_homeroom_teacher_id <> v_tch_profile_id THEN
        RAISE EXCEPTION 'Accès refusé : L’enseignant n’est pas le titulaire de cette classe primaire.';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.class_subject_settings css
        JOIN public.subjects s ON s.id = css.subject_id
        WHERE css.class_id = NEW.class_id
          AND css.subject_id = NEW.subject_id
          AND css.school_id = NEW.school_id
          AND css.is_active = true
          AND s.is_active = true
      ) THEN
        RAISE EXCEPTION 'Accès refusé : La matière n’est pas configurée pour cette classe primaire.';
      END IF;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.teacher_class_assignments
        WHERE teacher_id = NEW.teacher_id
          AND class_id = NEW.class_id
          AND subject_id = NEW.subject_id
          AND academic_year_id = NEW.academic_year_id
          AND school_id = NEW.school_id
          AND is_active = true
      ) INTO v_has_active_assignment;

      IF NOT v_has_active_assignment THEN
        RAISE EXCEPTION 'Accès refusé : Aucune affectation active trouvée pour cet enseignant, cette classe et cette matière.';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ school_id est immuable.';
    END IF;
    IF OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ academic_year_id est immuable.';
    END IF;
    IF OLD.class_id IS DISTINCT FROM NEW.class_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ class_id est immuable.';
    END IF;
    IF OLD.subject_id IS DISTINCT FROM NEW.subject_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ subject_id est immuable.';
    END IF;
    IF OLD.teacher_id IS DISTINCT FROM NEW.teacher_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ teacher_id est immuable.';
    END IF;
    IF OLD.created_by IS DISTINCT FROM NEW.created_by THEN
      RAISE EXCEPTION 'Modification interdite : Le champ created_by est immuable.';
    END IF;

    IF NEW.term_id IS NOT NULL AND OLD.term_id IS DISTINCT FROM NEW.term_id THEN
      SELECT school_id, academic_year_id INTO v_term_school_id, v_term_year_id
      FROM public.school_terms
      WHERE id = NEW.term_id;

      IF v_term_school_id IS NULL OR v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : Le trimestre (%) n’appartient pas à la même école ou année scolaire.', NEW.term_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_school_homework_integrity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_school_homework_integrity() TO authenticated;
ALTER FUNCTION public.check_school_homework_integrity() OWNER TO postgres;

