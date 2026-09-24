-- Migration : 20260924140000_align_class_subjects_and_teacher_authorizations.sql
-- Description : Lot 2I-P4-V — Gate de Cohérence, Sécurité et Source Unique pour Matières & Coefficients

-- 1. Internal Helper Function : get_effective_class_subjects
-- Fonction privée backend (non exposée à authenticated, anon, PUBLIC)
-- Détermine les matières effectives d'une classe pour une année scolaire donnée.

CREATE OR REPLACE FUNCTION public.get_effective_class_subjects(
  p_class_id UUID,
  p_academic_year_id UUID DEFAULT NULL
)
RETURNS TABLE (
  subject_id UUID,
  subject_name TEXT,
  subject_code TEXT,
  coefficient NUMERIC,
  is_custom BOOLEAN,
  setting_id UUID,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_class_school_id UUID;
  v_class_year_id UUID;
  v_target_year_id UUID;
BEGIN
  SELECT c.school_id, c.academic_year_id
  INTO v_class_school_id, v_class_year_id
  FROM public.classes c
  WHERE c.id = p_class_id;

  IF v_class_school_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  v_target_year_id := coalesce(p_academic_year_id, v_class_year_id);

  RETURN QUERY
  SELECT
    s.id AS subject_id,
    s.name AS subject_name,
    s.code AS subject_code,
    coalesce(css.coefficient, 1.0)::NUMERIC AS coefficient,
    (css.id IS NOT NULL)::BOOLEAN AS is_custom,
    css.id AS setting_id,
    true::BOOLEAN AS is_active
  FROM public.subjects s
  LEFT JOIN public.class_subject_settings css
    ON css.class_id = p_class_id
   AND css.subject_id = s.id
   AND css.school_id = v_class_school_id
   AND css.academic_year_id = v_target_year_id
  WHERE s.school_id = v_class_school_id
    AND s.is_active = true
    AND coalesce(css.is_active, true) = true
  ORDER BY s.name ASC;
END;
$$;

-- Sécurisation stricte : Révoquer l'exécution à PUBLIC, anon et authenticated
REVOKE ALL ON FUNCTION public.get_effective_class_subjects(UUID, UUID) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.get_effective_class_subjects(UUID, UUID) OWNER TO postgres;


-- 2. Exposed Admin RPC : get_admin_class_subject_coefficients
-- Source unique pour la page Admin Coefficients des Matières
CREATE OR REPLACE FUNCTION public.get_admin_class_subject_coefficients(
  p_class_id UUID,
  p_academic_year_id UUID DEFAULT NULL
)
RETURNS TABLE (
  subject_id UUID,
  subject_name TEXT,
  subject_code TEXT,
  coefficient NUMERIC,
  is_custom BOOLEAN,
  setting_id UUID,
  is_active BOOLEAN
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
  v_class_school_id UUID;
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

  IF v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent consulter la configuration des coefficients.';
  END IF;

  SELECT c.school_id INTO v_class_school_id
  FROM public.classes c WHERE c.id = p_class_id;

  IF v_class_school_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' AND v_class_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cette classe appartient à un autre établissement.';
  END IF;

  RETURN QUERY
  SELECT * FROM public.get_effective_class_subjects(p_class_id, p_academic_year_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_class_subject_coefficients(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_class_subject_coefficients(UUID, UUID) TO authenticated;
ALTER FUNCTION public.get_admin_class_subject_coefficients(UUID, UUID) OWNER TO postgres;


-- 3. Exposed Teacher RPC : get_teacher_authorized_subjects
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
  v_class_year_id UUID;
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

  SELECT c.school_id, c.academic_year_id, coalesce(c.pedagogical_mode, 'secondary_subjects'), c.homeroom_teacher_id
  INTO v_class_school_id, v_class_year_id, v_class_pedagogical_mode, v_class_homeroom_teacher_id
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
      SELECT
        e.subject_id,
        e.subject_name,
        e.subject_code,
        'primary_homeroom'::TEXT AS pedagogical_mode
      FROM public.get_effective_class_subjects(p_class_id, v_class_year_id) e
      ORDER BY e.subject_name ASC;
    ELSE
      RETURN QUERY
      SELECT DISTINCT
        e.subject_id,
        e.subject_name,
        e.subject_code,
        'secondary_subjects'::TEXT AS pedagogical_mode
      FROM public.teacher_class_assignments tca
      JOIN public.get_effective_class_subjects(p_class_id, v_class_year_id) e ON e.subject_id = tca.subject_id
      WHERE tca.teacher_id = v_tch_id
        AND tca.class_id = p_class_id
        AND tca.school_id = v_class_school_id
        AND tca.academic_year_id = v_class_year_id
        AND tca.is_active = true
        AND tca.subject_id IS NOT NULL
      ORDER BY e.subject_name ASC;
    END IF;
  ELSIF v_caller_role IN ('school_admin', 'super_admin') THEN
    RETURN QUERY
    SELECT
      e.subject_id,
      e.subject_name,
      e.subject_code,
      v_class_pedagogical_mode AS pedagogical_mode
    FROM public.get_effective_class_subjects(p_class_id, v_class_year_id) e
    ORDER BY e.subject_name ASC;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_authorized_subjects(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_authorized_subjects(UUID) TO authenticated;
ALTER FUNCTION public.get_teacher_authorized_subjects(UUID) OWNER TO postgres;


-- 4. RPC : create_teacher_homework (Contrôles renforcés Primaire & Secondaire)
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

  -- CONTRÔLE 1 : La matière doit être effective pour la classe (active et non désactivée pour cette année)
  IF NOT EXISTS (
    SELECT 1
    FROM public.get_effective_class_subjects(p_class_id, v_year_id) e
    WHERE e.subject_id = p_subject_id
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Cette matière n’est pas configurée ou est désactivée pour cette classe.';
  END IF;

  -- CONTRÔLE 2 : Habilitation de l'enseignant selon le mode pédagogique
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

  RETURN v_homework_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) TO authenticated;
ALTER FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) OWNER TO postgres;


-- 5. RPC : update_teacher_homework (Contrôles renforcés Primaire & Secondaire)
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

    -- CONTRÔLE 1 : La matière doit toujours être effective
    IF NOT EXISTS (
      SELECT 1
      FROM public.get_effective_class_subjects(v_hw.class_id, v_hw.academic_year_id) e
      WHERE e.subject_id = v_hw.subject_id
    ) THEN
      RAISE EXCEPTION 'Accès refusé : Cette matière n’est pas configurée ou est désactivée pour cette classe.';
    END IF;

    -- CONTRÔLE 2 : Habilitation de l'enseignant
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
  SET
    title = trim(p_title),
    instructions = trim(p_instructions),
    assigned_on = p_assigned_on,
    due_at = p_due_at,
    estimated_minutes = p_estimated_minutes,
    term_id = coalesce(p_term_id, term_id),
    period_id = coalesce(v_period_id, period_id),
    updated_at = now()
  WHERE id = p_homework_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) TO authenticated;
ALTER FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) OWNER TO postgres;
