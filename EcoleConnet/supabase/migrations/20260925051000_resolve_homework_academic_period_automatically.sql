-- Migration : 20260925051000_resolve_homework_academic_period_automatically.sql
-- Description : Resolution automatique et deterministe du terme et de la periode scolaire lors du cycle de vie des devoirs

-- 1. Helper Function : Resolution deterministe du calendrier scolaire
-- 1. Helper Function : Resolution deterministe du calendrier scolaire
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


-- 2. RPC : create_teacher_homework (Resolves term_id and period_id upon draft creation)
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

  -- CONTRÔLE 1 : La matière doit être effective pour la classe
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

  -- Résolution automatique du terme et de la période scolaire
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
    created_by
  ) VALUES (
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
    v_uid
  ) RETURNING id INTO v_homework_id;

  RETURN v_homework_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) TO authenticated;
ALTER FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) OWNER TO postgres;


-- 3. RPC : update_teacher_homework (Recalculates term_id and period_id if assigned_on changes)
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

  SELECT education_cycle INTO v_education_cycle FROM public.classes WHERE id = v_hw.class_id;

  -- Résolution automatique du terme et de la période scolaire
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

REVOKE ALL ON FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) TO authenticated;
ALTER FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) OWNER TO postgres;


-- 4. RPC : publish_teacher_homework (Resolves missing term_id/period_id automatically when publishing existing drafts)
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

  -- Auto-résolution si term_id ou period_id est absent sur le brouillon
  IF v_hw.term_id IS NULL OR v_hw.period_id IS NULL THEN
    SELECT education_cycle INTO v_education_cycle FROM public.classes WHERE id = v_hw.class_id;

    SELECT out_term_id, out_period_id
    INTO v_resolved_term_id, v_resolved_period_id
    FROM public.resolve_homework_academic_period(v_hw.school_id, v_hw.academic_year_id, v_education_cycle, v_hw.assigned_on, v_hw.term_id);
  ELSE
    v_resolved_term_id := v_hw.term_id;
    v_resolved_period_id := v_hw.period_id;
  END IF;

  UPDATE public.school_homework
  SET status = 'published',
      term_id = v_resolved_term_id,
      period_id = v_resolved_period_id,
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
