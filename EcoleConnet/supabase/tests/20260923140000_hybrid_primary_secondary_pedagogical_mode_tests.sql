-- Fichier de tests versionné : 20260923140000_hybrid_primary_secondary_pedagogical_mode_tests.sql
-- Lot 2I-PV : Gate Final du Modèle Pédagogique Hybride Primaire / Secondaire

BEGIN;

-- 1. APPLICATION DE LA MIGRATION DANS LA TRANSACTION TEMPORAIRE
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS pedagogical_mode TEXT NOT NULL DEFAULT 'secondary_subjects';

DO $$
BEGIN
  ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS chk_classes_pedagogical_mode;
  ALTER TABLE public.classes
    ADD CONSTRAINT chk_classes_pedagogical_mode
    CHECK (pedagogical_mode IN ('primary_homeroom', 'secondary_subjects'));
END $$;

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

REVOKE ALL ON FUNCTION public.close_teacher_homework(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_teacher_homework(UUID) TO authenticated;
ALTER FUNCTION public.close_teacher_homework(UUID) OWNER TO postgres;


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


-- 2. EXÉCUTION DU HARNAIS DE TESTS VERSIONNÉ
CREATE TEMP TABLE IF NOT EXISTS temp_test_results (
  id serial primary key,
  test_name text,
  status text,
  message text
);

DO $$
DECLARE
  v_school_a UUID;
  v_school_b UUID;
  v_year_a UUID;
  v_year_b UUID;
  v_term_primary UUID;
  v_term_secondary UUID;
  v_sub_math UUID;
  v_sub_french UUID;
  v_sub_history UUID;
  v_sub_inactive UUID;
  
  v_prof_primary_homeroom UUID;
  v_prof_secondary_homeroom UUID;
  v_prof_secondary_teacher UUID;
  v_prof_other_school UUID;
  v_prof_inactive UUID;
  v_prof_student UUID;
  v_prof_parent UUID;
  v_prof_school_admin UUID;
  v_prof_finance_agent UUID;

  v_tch_primary_homeroom UUID;
  v_tch_secondary_homeroom UUID;
  v_tch_secondary_teacher UUID;
  v_tch_other_school UUID;
  v_tch_inactive UUID;

  v_class_primary UUID;
  v_class_secondary UUID;
  v_class_default UUID;

  v_hw_primary UUID;
  v_hw_secondary UUID;

  v_res_count INTEGER;
  v_err_occurred BOOLEAN;
  v_default_mode TEXT;
BEGIN
  RAISE NOTICE '=== SUITE DE TESTS VERSIONNÉE LOT 2I-PV : MODÈLE HYBRIDE PRIMAIRE/SECONDAIRE ===';

  -- 1. Setup des Établissements & Années Scolaires
  INSERT INTO public.schools (id, name, slug, status, education_cycles)
  VALUES (gen_random_uuid(), 'École Test Alpha ' || gen_random_uuid(), 'school-test-alpha-' || gen_random_uuid(), 'active', ARRAY['primary', 'secondary'])
  RETURNING id INTO v_school_a;
  
  INSERT INTO public.schools (id, name, slug, status, education_cycles)
  VALUES (gen_random_uuid(), 'École Test Bêta ' || gen_random_uuid(), 'school-test-beta-' || gen_random_uuid(), 'active', ARRAY['primary', 'secondary'])
  RETURNING id INTO v_school_b;

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (gen_random_uuid(), v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true)
  RETURNING id INTO v_year_a;

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (gen_random_uuid(), v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true)
  RETURNING id INTO v_year_b;

  -- 2. Setup des Termes et Périodes
  INSERT INTO public.school_terms (id, school_id, academic_year_id, education_cycle, division_type, name, position, starts_on, ends_on, is_active)
  VALUES (gen_random_uuid(), v_school_a, v_year_a, 'primary', 'trimester', '1er Trimestre', 1, '2026-09-01', '2026-12-31', true)
  RETURNING id INTO v_term_primary;

  INSERT INTO public.school_terms (id, school_id, academic_year_id, education_cycle, division_type, name, position, starts_on, ends_on, is_active)
  VALUES (gen_random_uuid(), v_school_a, v_year_a, 'secondary', 'semester', '1er Semestre', 1, '2026-09-01', '2026-12-31', true)
  RETURNING id INTO v_term_secondary;

  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, education_cycle, name, position, position_within_parent, starts_on, ends_on, is_active)
  VALUES 
    (gen_random_uuid(), v_school_a, v_year_a, v_term_primary, 'primary', 'P1 Primaire', 1, 1, '2026-09-01', '2026-12-31', true),
    (gen_random_uuid(), v_school_a, v_year_a, v_term_secondary, 'secondary', 'P1 Secondaire', 1, 1, '2026-09-01', '2026-12-31', true);

  -- 3. Setup des Matières
  INSERT INTO public.subjects (id, school_id, name, code, is_active)
  VALUES (gen_random_uuid(), v_school_a, 'Mathématiques', 'MATH', true)
  RETURNING id INTO v_sub_math;

  INSERT INTO public.subjects (id, school_id, name, code, is_active)
  VALUES (gen_random_uuid(), v_school_a, 'Français', 'FRAN', true)
  RETURNING id INTO v_sub_french;

  INSERT INTO public.subjects (id, school_id, name, code, is_active)
  VALUES (gen_random_uuid(), v_school_a, 'Histoire', 'HIST', true)
  RETURNING id INTO v_sub_history;

  INSERT INTO public.subjects (id, school_id, name, code, is_active)
  VALUES (gen_random_uuid(), v_school_a, 'Matière Inactive', 'INACT', false)
  RETURNING id INTO v_sub_inactive;

  -- 4. Setup des Utilisateurs et Rôles
  -- Admin d'école
  v_prof_school_admin := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_prof_school_admin, 'admin.alpha@test.com');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_prof_school_admin, v_school_a, 'school_admin', 'Admin', 'Alpha', true);

  -- Agent Finance
  v_prof_finance_agent := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_prof_finance_agent, 'finance.alpha@test.com');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_prof_finance_agent, v_school_a, 'finance_agent', 'Finance', 'Agent', true);

  -- Enseignant Titulaire Primaire
  v_prof_primary_homeroom := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_prof_primary_homeroom, 'jean.pri@test.com');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_prof_primary_homeroom, v_school_a, 'teacher', 'Jean', 'PrimaryHomeroom', true);

  INSERT INTO public.teachers (id, school_id, profile_id, employee_number, first_name, last_name, account_status, employment_status)
  VALUES (gen_random_uuid(), v_school_a, v_prof_primary_homeroom, 'TCH_PRI_01', 'Jean', 'PrimaryHomeroom', 'active', 'active')
  RETURNING id INTO v_tch_primary_homeroom;

  -- Enseignant Titulaire Secondaire
  v_prof_secondary_homeroom := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_prof_secondary_homeroom, 'marc.sec@test.com');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_prof_secondary_homeroom, v_school_a, 'teacher', 'Marc', 'SecondaryHomeroom', true);

  INSERT INTO public.teachers (id, school_id, profile_id, employee_number, first_name, last_name, account_status, employment_status)
  VALUES (gen_random_uuid(), v_school_a, v_prof_secondary_homeroom, 'TCH_SEC_01', 'Marc', 'SecondaryHomeroom', 'active', 'active')
  RETURNING id INTO v_tch_secondary_homeroom;

  -- Enseignant Secondaire Affecté à la matière Math
  v_prof_secondary_teacher := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_prof_secondary_teacher, 'alice.math@test.com');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_prof_secondary_teacher, v_school_a, 'teacher', 'Alice', 'MathTeacher', true);

  INSERT INTO public.teachers (id, school_id, profile_id, employee_number, first_name, last_name, account_status, employment_status)
  VALUES (gen_random_uuid(), v_school_a, v_prof_secondary_teacher, 'TCH_SEC_02', 'Alice', 'MathTeacher', 'active', 'active')
  RETURNING id INTO v_tch_secondary_teacher;

  -- Enseignant Autre École
  v_prof_other_school := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_prof_other_school, 'david.other@test.com');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_prof_other_school, v_school_b, 'teacher', 'David', 'OtherSchool', true);

  INSERT INTO public.teachers (id, school_id, profile_id, employee_number, first_name, last_name, account_status, employment_status)
  VALUES (gen_random_uuid(), v_school_b, v_prof_other_school, 'TCH_OTH_01', 'David', 'OtherSchool', 'active', 'active')
  RETURNING id INTO v_tch_other_school;

  -- Profil Inactif
  v_prof_inactive := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_prof_inactive, 'bob.inact@test.com');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_prof_inactive, v_school_a, 'teacher', 'Bob', 'InactiveTeacher', false);

  INSERT INTO public.teachers (id, school_id, profile_id, employee_number, first_name, last_name, account_status, employment_status)
  VALUES (gen_random_uuid(), v_school_a, v_prof_inactive, 'TCH_INACT_01', 'Bob', 'InactiveTeacher', 'suspended', 'terminated')
  RETURNING id INTO v_tch_inactive;

  -- Profil Élève
  v_prof_student := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_prof_student, 'pierre.student@test.com');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_prof_student, v_school_a, 'student', 'Pierre', 'Student', true);

  -- Profil Tuteur / Parent
  v_prof_parent := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_prof_parent, 'marie.parent@test.com');
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES (v_prof_parent, v_school_a, 'parent', 'Marie', 'Parent', true);

  -- 5. Setup des Classes
  INSERT INTO public.classes (id, school_id, academic_year_id, name, education_cycle, pedagogical_mode, homeroom_teacher_id, is_active)
  VALUES (gen_random_uuid(), v_school_a, v_year_a, '3ème Primaire A', 'primary', 'primary_homeroom', v_prof_primary_homeroom, true)
  RETURNING id INTO v_class_primary;

  INSERT INTO public.class_subject_settings (school_id, academic_year_id, class_id, subject_id, coefficient, is_active)
  VALUES 
    (v_school_a, v_year_a, v_class_primary, v_sub_math, 2, true),
    (v_school_a, v_year_a, v_class_primary, v_sub_french, 3, true),
    (v_school_a, v_year_a, v_class_primary, v_sub_inactive, 1, false);

  INSERT INTO public.classes (id, school_id, academic_year_id, name, education_cycle, pedagogical_mode, homeroom_teacher_id, is_active)
  VALUES (gen_random_uuid(), v_school_a, v_year_a, '4ème Humanités A', 'secondary', 'secondary_subjects', v_prof_secondary_homeroom, true)
  RETURNING id INTO v_class_secondary;

  INSERT INTO public.teacher_class_assignments (school_id, academic_year_id, class_id, subject_id, subject_name, teacher_id, teacher_profile_id, is_active)
  VALUES (v_school_a, v_year_a, v_class_secondary, v_sub_math, 'Mathématiques', v_tch_secondary_teacher, v_prof_secondary_teacher, true);

  INSERT INTO public.teacher_class_assignments (school_id, academic_year_id, class_id, subject_id, subject_name, teacher_id, teacher_profile_id, is_active)
  VALUES (v_school_a, v_year_a, v_class_secondary, NULL, 'Titularisation (Appel Général)', v_tch_secondary_homeroom, v_prof_secondary_homeroom, true);


  -- TEST 1: Titulaire classe primaire autorisé sur toutes les matières configurées actives (Math & Français, Inactive ignorée)
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_primary_homeroom::text);
  SELECT count(*) INTO v_res_count FROM public.get_teacher_authorized_subjects(v_class_primary);
  IF v_res_count <> 2 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Attendu 2 matières configurées actives pour le titulaire primaire, obtenu %', v_res_count;
  ELSE
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 1', 'PASSED', 'Titulaire primaire voit les 2 matières configurées actives (Math & Français).');
  END IF;

  v_hw_primary := public.create_teacher_homework(
    v_class_primary, v_sub_math, 'Devoir Calcul Primaire', 'Exercices 1 à 5', CURRENT_DATE, NOW() + INTERVAL '2 days', NULL, false, v_term_primary
  );
  IF v_hw_primary IS NOT NULL THEN
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 1b', 'PASSED', 'Création devoir primaire Math réussie.');
  END IF;

  -- TEST 2: Matière non configurée (Histoire) refusée pour titulaire classe primaire
  v_err_occurred := false;
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary, v_sub_history, 'Devoir Histoire Non Configuré', 'Consigne', CURRENT_DATE, NOW() + INTERVAL '2 days', NULL, false, v_term_primary
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := true;
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 2', 'PASSED', 'Devoir refusé sur matière non configurée (Histoire).');
  END;
  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'TEST 2 FAILED: La création d’un devoir sur une matière non configurée aurait dû échouer.';
  END IF;

  -- TEST 3: Autre enseignant (non titulaire) refusé sur la classe primaire
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_secondary_teacher::text);
  v_err_occurred := false;
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_primary, v_sub_math, 'Devoir Non Titulaire Primaire', 'Consigne', CURRENT_DATE, NOW() + INTERVAL '2 days', NULL, false, v_term_primary
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := true;
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 3', 'PASSED', 'Autre enseignant refusé sur classe primaire.');
  END;
  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Un non-titulaire sur une classe primaire aurait dû être refusé.';
  END IF;

  -- TEST 4: Isolation multi-écoles (enseignant autre école refusé)
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_other_school::text);
  v_err_occurred := false;
  BEGIN
    PERFORM public.get_teacher_authorized_subjects(v_class_primary);
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := true;
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 4', 'PASSED', 'Isolation multi-écoles : Enseignant autre établissement refusé.');
  END;
  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Enseignant autre établissement aurait dû être refusé.';
  END IF;

  -- TEST 5: Titulaire secondaire sans affectation matière refusé (Marc)
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_secondary_homeroom::text);
  SELECT count(*) INTO v_res_count FROM public.get_teacher_authorized_subjects(v_class_secondary);
  IF v_res_count <> 0 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Attendu 0 matière pour titulaire secondaire sans affectation, obtenu %', v_res_count;
  ELSE
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 5', 'PASSED', 'Titulaire secondaire sans affectation matière ne voit aucune matière.');
  END IF;

  v_err_occurred := false;
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_secondary, v_sub_math, 'Devoir Titulaire Secondaire', 'Consigne', CURRENT_DATE, NOW() + INTERVAL '2 days', NULL, false, v_term_secondary
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := true;
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 5b', 'PASSED', 'Titulaire secondaire sans affectation refusé en création de devoir.');
  END;
  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'TEST 5b FAILED: Titulaire secondaire sans affectation matière aurait dû être refusé.';
  END IF;

  -- TEST 6 & 7: Enseignant secondaire affecté autorisé uniquement sur sa matière (Alice sur Math, refusée sur Français)
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_secondary_teacher::text);
  SELECT count(*) INTO v_res_count FROM public.get_teacher_authorized_subjects(v_class_secondary);
  IF v_res_count <> 1 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: Attendu 1 matière (Math) pour enseignant secondaire affecté, obtenu %', v_res_count;
  ELSE
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 6', 'PASSED', 'Enseignant secondaire affecté voit sa matière (Math).');
  END IF;

  v_hw_secondary := public.create_teacher_homework(
    v_class_secondary, v_sub_math, 'Devoir Algèbre Secondaire', 'Consigne Math', CURRENT_DATE, NOW() + INTERVAL '2 days', NULL, false, v_term_secondary
  );
  IF v_hw_secondary IS NOT NULL THEN
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 6b', 'PASSED', 'Enseignant secondaire crée son devoir Math avec succès.');
  END IF;

  v_err_occurred := false;
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_secondary, v_sub_french, 'Devoir Français Non Affecté', 'Consigne', CURRENT_DATE, NOW() + INTERVAL '2 days', NULL, false, v_term_secondary
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := true;
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 7', 'PASSED', 'Enseignant secondaire refusé sur matière non affectée (Français).');
  END;
  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'TEST 7 FAILED: Enseignant secondaire sur matière non affectée aurait dû être refusé.';
  END IF;

  -- TEST 8: Titulaire primaire inactif refusé
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_inactive::text);
  v_err_occurred := false;
  BEGIN
    PERFORM public.get_teacher_authorized_subjects(v_class_primary);
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := true;
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 8', 'PASSED', 'Profil inactif refusé.');
  END;
  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Titulaire inactif aurait dû être refusé.';
  END IF;

  -- TEST 9: Profil élève refusé
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_student::text);
  v_err_occurred := false;
  BEGIN
    PERFORM public.get_teacher_authorized_subjects(v_class_primary);
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := true;
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 9', 'PASSED', 'Profil élève refusé sur RPCs enseignant.');
  END;
  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Profil élève aurait dû être refusé.';
  END IF;

  -- TEST 9b: Profil parent refusé
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_parent::text);
  v_err_occurred := false;
  BEGIN
    PERFORM public.get_teacher_authorized_subjects(v_class_primary);
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := true;
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 9b', 'PASSED', 'Profil parent refusé sur RPCs enseignant.');
  END;
  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'TEST 9b FAILED: Profil parent aurait dû être refusé.';
  END IF;

  -- TEST 10: Aucune matière synthétique (subject_id IS NULL) retournée
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_primary_homeroom::text);
  IF EXISTS (
    SELECT 1 FROM public.get_teacher_authorized_subjects(v_class_primary) WHERE subject_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.get_teacher_authorized_subjects(v_class_secondary) WHERE subject_id IS NULL
  ) THEN
    RAISE EXCEPTION 'TEST 10 FAILED: get_teacher_authorized_subjects ne doit JAMAIS retourner subject_id IS NULL.';
  ELSE
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 10', 'PASSED', 'Aucune matière synthétique IS NULL n’est retournée.');
  END IF;

  -- TEST 11: Cycle de vie complet des devoirs dans les deux modes (Modification, Publication, Annulation)
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_primary_homeroom::text);
  PERFORM public.update_teacher_homework(v_hw_primary, 'Devoir Calcul Modifié', 'Consigne modifiée', CURRENT_DATE, NOW() + INTERVAL '3 days', NULL, v_term_primary);
  PERFORM public.publish_teacher_homework(v_hw_primary);
  PERFORM public.cancel_teacher_homework(v_hw_primary, 'Motif annulation primaire');
  INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 11a', 'PASSED', 'Cycle de vie devoir Primaire (Draft -> Update -> Publish -> Cancel) réussi.');

  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_secondary_teacher::text);
  PERFORM public.update_teacher_homework(v_hw_secondary, 'Devoir Algèbre Modifié', 'Consigne modifiée sec', CURRENT_DATE, NOW() + INTERVAL '3 days', NULL, v_term_secondary);
  PERFORM public.publish_teacher_homework(v_hw_secondary);
  PERFORM public.close_teacher_homework(v_hw_secondary);
  INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 11b', 'PASSED', 'Cycle de vie devoir Secondaire (Draft -> Update -> Publish -> Close) réussi.');

  -- TEST 12: Admin d'école autorisé à modifier le mode d'une classe de son école
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_school_admin::text);
  PERFORM public.set_class_pedagogical_mode(v_class_secondary, 'primary_homeroom');
  SELECT pedagogical_mode INTO v_default_mode FROM public.classes WHERE id = v_class_secondary;
  IF v_default_mode <> 'primary_homeroom' THEN
    RAISE EXCEPTION 'TEST 12 FAILED: Le mode pédagogique de la classe n’a pas été mis à jour par l’admin d’école.';
  ELSE
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 12', 'PASSED', 'Admin d’école autorisé à modifier le mode pédagogique d’une classe existante.');
  END IF;

  -- TEST 13: Agent Finance refusé sur set_class_pedagogical_mode
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_prof_finance_agent::text);
  v_err_occurred := false;
  BEGIN
    PERFORM public.set_class_pedagogical_mode(v_class_secondary, 'secondary_subjects');
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := true;
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 13', 'PASSED', 'Finance agent refusé sur set_class_pedagogical_mode.');
  END;
  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'TEST 13 FAILED: Le rôle finance_agent aurait dû être refusé sur set_class_pedagogical_mode.';
  END IF;

  -- TEST 14: Mode par défaut 'secondary_subjects' sur création de nouvelle classe
  INSERT INTO public.classes (id, school_id, academic_year_id, name, education_cycle, homeroom_teacher_id, is_active)
  VALUES (gen_random_uuid(), v_school_a, v_year_a, 'Classe Nouvelle Test', 'secondary', NULL, true)
  RETURNING id INTO v_class_default;

  SELECT pedagogical_mode INTO v_default_mode FROM public.classes WHERE id = v_class_default;
  IF v_default_mode <> 'secondary_subjects' THEN
    RAISE EXCEPTION 'TEST 14 FAILED: Le mode par défaut des nouvelles classes doit être secondary_subjects (obtenu: %).', v_default_mode;
  ELSE
    INSERT INTO temp_test_results(test_name, status, message) VALUES ('TEST 14', 'PASSED', 'Valeur par défaut "secondary_subjects" confirmée sur nouvelle classe.');
  END IF;

  RAISE NOTICE '=== TOUS LES TESTS SQL ONT RÉUSSI AVEC SUCCÈS ! ANNULATION DE LA TRANSACTION... ===';
END $$;

SELECT id, test_name, status, message FROM temp_test_results ORDER BY id;

ROLLBACK;
