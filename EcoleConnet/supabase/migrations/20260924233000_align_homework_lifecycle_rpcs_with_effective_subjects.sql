-- Migration : 20260924233000_align_homework_lifecycle_rpcs_with_effective_subjects.sql
-- Description : Alignement de publish_teacher_homework sur get_effective_class_subjects et suppression du blocage d'annulation/clôture post-désactivation

-- 1. RPC : publish_teacher_homework (Vérifie l'effectivité de la matière au moment de la publication)
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


-- 2. RPC : cancel_teacher_homework (Autorise l'annulation même si la matière a été désactivée post-publication)
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


-- 3. RPC : close_teacher_homework (Autorise la clôture même si la matière a été désactivée post-publication)
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
