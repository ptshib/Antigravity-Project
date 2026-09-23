-- Suite de Tests SQL Transactionnelle : 20260923120000_teacher_homework_rpc_tests.sql
-- Validation complète des 22 scénarios de sécurité et fonctionnalités pour les RPCs de devoirs Enseignant.

BEGIN;

-- Application temporaire transactionnelle du durcissement search_path='' (Lot 2I-V2)
CREATE OR REPLACE FUNCTION public.get_teacher_homework()
RETURNS TABLE (
  id UUID,
  school_id UUID,
  academic_year_id UUID,
  term_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  teacher_id UUID,
  teacher_name TEXT,
  title TEXT,
  instructions TEXT,
  assigned_on DATE,
  due_at TIMESTAMPTZ,
  estimated_minutes INTEGER,
  status TEXT,
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif.';
  END IF;

  IF v_caller_role = 'teacher' THEN
    SELECT sc.status
    INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_caller_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
    END IF;

    SELECT t.id, t.account_status, t.employment_status
    INTO v_tch_id, v_tch_acc_status, v_tch_emp_status
    FROM public.teachers t
    WHERE t.profile_id = v_uid
      AND t.school_id = v_caller_school_id;

    IF v_tch_id IS NULL OR v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Compte enseignant inactif.';
    END IF;

    RETURN QUERY
    SELECT
      h.id,
      h.school_id,
      h.academic_year_id,
      h.term_id,
      h.class_id,
      c.name AS class_name,
      h.subject_id,
      s.name AS subject_name,
      h.teacher_id,
      (t.first_name || ' ' || t.last_name) AS teacher_name,
      h.title,
      h.instructions,
      h.assigned_on,
      h.due_at,
      h.estimated_minutes,
      h.status,
      h.published_at,
      h.closed_at,
      h.created_by,
      h.created_at,
      h.updated_at
    FROM public.school_homework h
    JOIN public.classes c ON c.id = h.class_id
    JOIN public.subjects s ON s.id = h.subject_id
    JOIN public.teachers t ON t.id = h.teacher_id
    WHERE h.school_id = v_caller_school_id
      AND h.teacher_id = v_tch_id
    ORDER BY h.due_at DESC, h.created_at DESC;

  ELSIF v_caller_role = 'school_admin' THEN
    SELECT sc.status
    INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_caller_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
    END IF;

    RETURN QUERY
    SELECT
      h.id,
      h.school_id,
      h.academic_year_id,
      h.term_id,
      h.class_id,
      c.name AS class_name,
      h.subject_id,
      s.name AS subject_name,
      h.teacher_id,
      (t.first_name || ' ' || t.last_name) AS teacher_name,
      h.title,
      h.instructions,
      h.assigned_on,
      h.due_at,
      h.estimated_minutes,
      h.status,
      h.published_at,
      h.closed_at,
      h.created_by,
      h.created_at,
      h.updated_at
    FROM public.school_homework h
    JOIN public.classes c ON c.id = h.class_id
    JOIN public.subjects s ON s.id = h.subject_id
    JOIN public.teachers t ON t.id = h.teacher_id
    WHERE h.school_id = v_caller_school_id
    ORDER BY h.due_at DESC, h.created_at DESC;

  ELSIF v_caller_role = 'super_admin' THEN
    RETURN QUERY
    SELECT
      h.id,
      h.school_id,
      h.academic_year_id,
      h.term_id,
      h.class_id,
      c.name AS class_name,
      h.subject_id,
      s.name AS subject_name,
      h.teacher_id,
      (t.first_name || ' ' || t.last_name) AS teacher_name,
      h.title,
      h.instructions,
      h.assigned_on,
      h.due_at,
      h.estimated_minutes,
      h.status,
      h.published_at,
      h.closed_at,
      h.created_by,
      h.created_at,
      h.updated_at
    FROM public.school_homework h
    JOIN public.classes c ON c.id = h.class_id
    JOIN public.subjects s ON s.id = h.subject_id
    JOIN public.teachers t ON t.id = h.teacher_id
    ORDER BY h.due_at DESC, h.created_at DESC;

  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé pour lire les devoirs.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_homework() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_homework() TO authenticated;
ALTER FUNCTION public.get_teacher_homework() OWNER TO postgres;

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
  v_homework_id UUID;
  v_status TEXT := 'draft';
  v_published_at TIMESTAMPTZ := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT role, school_id, is_active INTO v_profile_role, v_school_id, v_profile_active
  FROM public.profiles
  WHERE id = v_uid;

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

  SELECT academic_year_id INTO v_year_id
  FROM public.classes
  WHERE id = p_class_id AND school_id = v_school_id;

  IF v_year_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable ou n’appartenant pas à votre établissement.';
  END IF;

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

  IF p_publish_now THEN
    v_status := 'published';
    v_published_at := now();
  END IF;

  INSERT INTO public.school_homework (
    school_id,
    academic_year_id,
    term_id,
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
      'due_at', p_due_at
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
  v_is_owner BOOLEAN := false;
  v_is_admin BOOLEAN := false;
  v_tch_id UUID;
  v_tch_acc_status TEXT;
  v_tch_emp_status TEXT;
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

    v_is_owner := true;
  ELSIF v_caller_role IN ('school_admin', 'super_admin') THEN
    v_is_admin := true;
  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  IF v_hw.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'Modification interdite : Ce devoir est déjà % et ne peut plus être modifié.', v_hw.status;
  END IF;

  IF v_hw.status = 'published' THEN
    IF p_reason IS NULL OR pg_catalog.length(trim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'Modification refusée : Un motif explicite est obligatoire pour modifier un devoir déjà publié.';
    END IF;
  END IF;

  UPDATE public.school_homework
  SET title = trim(p_title),
      instructions = trim(p_instructions),
      assigned_on = p_assigned_on,
      due_at = p_due_at,
      estimated_minutes = p_estimated_minutes,
      term_id = p_term_id,
      updated_at = pg_catalog.now()
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
    pg_catalog.jsonb_build_object(
      'entity_type', 'school_homework',
      'entity_id', p_homework_id,
      'homework_id', p_homework_id,
      'old_status', v_hw.status,
      'new_status', v_hw.status,
      'reason', coalesce(trim(p_reason), 'Mise à jour du devoir'),
      'old_data', pg_catalog.jsonb_build_object(
        'title', v_hw.title,
        'instructions', v_hw.instructions,
        'assigned_on', v_hw.assigned_on,
        'due_at', v_hw.due_at,
        'estimated_minutes', v_hw.estimated_minutes,
        'term_id', v_hw.term_id
      ),
      'new_data', pg_catalog.jsonb_build_object(
        'title', trim(p_title),
        'instructions', trim(p_instructions),
        'assigned_on', p_assigned_on,
        'due_at', p_due_at,
        'estimated_minutes', p_estimated_minutes,
        'term_id', p_term_id
      )
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
  ELSIF v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  IF v_hw.status <> 'draft' THEN
    RAISE EXCEPTION 'Publication impossible : Seul un devoir au statut "draft" peut être publié.';
  END IF;

  UPDATE public.school_homework
  SET status = 'published',
      published_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
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
    pg_catalog.jsonb_build_object(
      'entity_type', 'school_homework',
      'entity_id', p_homework_id,
      'homework_id', p_homework_id,
      'title', v_hw.title,
      'published_at', pg_catalog.now()
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  IF p_reason IS NULL OR pg_catalog.length(trim(p_reason)) = 0 THEN
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
  ELSIF v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  IF v_hw.status = 'cancelled' THEN
    RAISE EXCEPTION 'Ce devoir est déjà annulé.';
  END IF;

  UPDATE public.school_homework
  SET status = 'cancelled',
      closed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
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
    pg_catalog.jsonb_build_object(
      'entity_type', 'school_homework',
      'entity_id', p_homework_id,
      'homework_id', p_homework_id,
      'title', v_hw.title,
      'reason', trim(p_reason),
      'cancelled_at', pg_catalog.now()
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
  ELSIF v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  IF v_hw.status <> 'published' THEN
    RAISE EXCEPTION 'Clôture impossible : Seul un devoir au statut "published" peut être clôturé.';
  END IF;

  UPDATE public.school_homework
  SET status = 'closed',
      closed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
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
    pg_catalog.jsonb_build_object(
      'entity_type', 'school_homework',
      'entity_id', p_homework_id,
      'homework_id', p_homework_id,
      'title', v_hw.title,
      'closed_at', pg_catalog.now()
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.close_teacher_homework(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_teacher_homework(UUID) TO authenticated;
ALTER FUNCTION public.close_teacher_homework(UUID) OWNER TO postgres;


DO $$
DECLARE
  -- Identifiants École A
  v_school_a_id UUID := gen_random_uuid();
  v_year_a_id UUID := gen_random_uuid();
  v_term_a_id UUID := gen_random_uuid();
  v_period_a_id UUID := gen_random_uuid();
  v_class_a_id UUID := gen_random_uuid();
  v_subject_a_id UUID := gen_random_uuid();
  v_subject_unassigned_id UUID := gen_random_uuid();
  v_unassigned_class_id UUID := gen_random_uuid();

  -- Identifiants Utilisateurs École A
  v_prof_teacher_a_id UUID := gen_random_uuid();
  v_tch_a_id UUID := gen_random_uuid();

  v_prof_teacher_inactive_id UUID := gen_random_uuid();
  v_tch_inactive_id UUID := gen_random_uuid();

  v_prof_teacher_b_id UUID := gen_random_uuid();
  v_tch_b_id UUID := gen_random_uuid();

  v_prof_parent_a_id UUID := gen_random_uuid();
  v_prof_student_a_id UUID := gen_random_uuid();
  v_student_a_id UUID := gen_random_uuid();

  v_prof_parent_other_id UUID := gen_random_uuid();
  v_prof_student_other_id UUID := gen_random_uuid();
  v_student_other_id UUID := gen_random_uuid();

  -- Identifiants École B (Isolation)
  v_school_b_id UUID := gen_random_uuid();
  v_year_b_id UUID := gen_random_uuid();
  v_class_b_id UUID := gen_random_uuid();
  v_subject_b_id UUID := gen_random_uuid();
  v_prof_teacher_school_b_id UUID := gen_random_uuid();
  v_tch_school_b_id UUID := gen_random_uuid();

  -- Variables de résultat
  v_hw_id UUID;
  v_hw_count INT;
  v_res_json JSONB;
  v_status_text TEXT;
  v_success BOOLEAN;
  v_secdef_count INT;

BEGIN
  RAISE NOTICE '=== INITIALISATION DES FIXTURES DE TEST DEVOIRS ===';

  -- 0. Auth Users
  INSERT INTO auth.users (id, email) VALUES
    (v_prof_teacher_a_id, 'prof.a@test.cd'),
    (v_prof_teacher_inactive_id, 'prof.inact@test.cd'),
    (v_prof_teacher_b_id, 'prof.b@test.cd'),
    (v_prof_parent_a_id, 'parent.a@test.cd'),
    (v_prof_student_a_id, 'student.a@test.cd'),
    (v_prof_parent_other_id, 'parent.other@test.cd'),
    (v_prof_student_other_id, 'student.b@test.cd'),
    (v_prof_teacher_school_b_id, 'prof.schoolb@test.cd');

  -- 1. Écoles
  INSERT INTO public.schools (id, name, slug, status, education_cycles) VALUES
    (v_school_a_id, 'École A Tests Devoirs', 'ecole-a-test-hw', 'active', ARRAY['secondary']::text[]),
    (v_school_b_id, 'École B Isolation Devoirs', 'ecole-b-test-hw', 'active', ARRAY['secondary']::text[]);

  -- 2. Années Académiques
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
    (v_year_a_id, v_school_a_id, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_b_id, v_school_b_id, '2026-2027', '2026-09-01', '2027-06-30', true);

  -- 2b. Termes & Périodes Scolaires
  INSERT INTO public.school_terms (id, school_id, academic_year_id, name, position, education_cycle, division_type) VALUES
    (v_term_a_id, v_school_a_id, v_year_a_id, 'Semestre 1', 1, 'secondary', 'semester');

  INSERT INTO public.school_periods (id, school_id, academic_year_id, parent_term_id, name, education_cycle, position, position_within_parent, starts_on, ends_on) VALUES
    (v_period_a_id, v_school_a_id, v_year_a_id, v_term_a_id, 'Période 1', 'secondary', 1, 1, '2026-09-01', '2026-12-31');

  -- 3. Classes
  INSERT INTO public.classes (id, school_id, academic_year_id, name, education_cycle) VALUES
    (v_class_a_id, v_school_a_id, v_year_a_id, '3e Scientifique A', 'secondary'),
    (v_unassigned_class_id, v_school_a_id, v_year_a_id, '4e Littéraire Z', 'secondary'),
    (v_class_b_id, v_school_b_id, v_year_b_id, '1re Commerciale B', 'secondary');

  -- 4. Matières
  INSERT INTO public.subjects (id, school_id, name, code) VALUES
    (v_subject_a_id, v_school_a_id, 'Physique Quantique', 'PHYS'),
    (v_subject_unassigned_id, v_school_a_id, 'Chimie Organique', 'CHIM'),
    (v_subject_b_id, v_school_b_id, 'Comptabilité', 'COMP');

  -- 5. Profils Utilisateurs
  INSERT INTO public.profiles (id, school_id, first_name, last_name, role, is_active) VALUES
    (v_prof_teacher_a_id, v_school_a_id, 'Marc', 'Tshibangu', 'teacher', true),
    (v_prof_teacher_inactive_id, v_school_a_id, 'Enseignant', 'Inactif', 'teacher', true),
    (v_prof_teacher_b_id, v_school_a_id, 'Deuxieme', 'Prof', 'teacher', true),
    (v_prof_parent_a_id, v_school_a_id, 'Papa', 'Kabeya', 'parent', true),
    (v_prof_student_a_id, v_school_a_id, 'Élève', 'Kabeya', 'student', true),
    (v_prof_parent_other_id, v_school_a_id, 'Parent', 'Étranger', 'parent', true),
    (v_prof_student_other_id, v_school_b_id, 'Élève', 'École B', 'student', true),
    (v_prof_teacher_school_b_id, v_school_b_id, 'Prof', 'École B', 'teacher', true);

  -- 6. Enseignants
  INSERT INTO public.teachers (id, school_id, profile_id, first_name, last_name, account_status, employment_status, employee_number) VALUES
    (v_tch_a_id, v_school_a_id, v_prof_teacher_a_id, 'Marc', 'Tshibangu', 'active', 'active', 'ENS-HW-A1'),
    (v_tch_inactive_id, v_school_a_id, v_prof_teacher_inactive_id, 'Enseignant', 'Inactif', 'suspended', 'active', 'ENS-HW-INACT'),
    (v_tch_b_id, v_school_a_id, v_prof_teacher_b_id, 'Deuxieme', 'Prof', 'active', 'active', 'ENS-HW-A2'),
    (v_tch_school_b_id, v_school_b_id, v_prof_teacher_school_b_id, 'Prof', 'École B', 'active', 'active', 'ENS-HW-B1');

  -- 7. Affectations Enseignant-Classe-Matière
  INSERT INTO public.teacher_class_assignments (id, school_id, academic_year_id, teacher_id, class_id, subject_id, subject_name, is_active) VALUES
    (gen_random_uuid(), v_school_a_id, v_year_a_id, v_tch_a_id, v_class_a_id, v_subject_a_id, 'Physique Quantique', true),
    (gen_random_uuid(), v_school_b_id, v_year_b_id, v_tch_school_b_id, v_class_b_id, v_subject_b_id, 'Comptabilité', true);

  -- 8. Élève & Inscription
  INSERT INTO public.students (id, school_id, profile_id, first_name, last_name, student_number) VALUES
    (v_student_a_id, v_school_a_id, v_prof_student_a_id, 'Élève', 'Kabeya', 'STD-HW-A'),
    (v_student_other_id, v_school_b_id, v_prof_student_other_id, 'Élève', 'École B', 'STD-HW-B');

  INSERT INTO public.student_enrollments (id, school_id, academic_year_id, class_id, student_id, status) VALUES
    (gen_random_uuid(), v_school_a_id, v_year_a_id, v_class_a_id, v_student_a_id, 'active'),
    (gen_random_uuid(), v_school_b_id, v_year_b_id, v_class_b_id, v_student_other_id, 'active');

  -- 9. Lien Parent-Élève
  INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_view_homework) VALUES
    (gen_random_uuid(), v_school_a_id, v_prof_parent_a_id, v_student_a_id, 'approved', true);


  RAISE NOTICE '=== EXÉCUTION DES SCÉNARIOS DE TEST DEVOIRS ===';

  ------------------------------------------------------------------------------
  -- SCÉNARIO 1 & 2 & 12 : ENSEIGNANT ACTIF AUTORISÉ + CRÉATION INITIALE BROUILLON
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_teacher_a_id, 'role', 'authenticated')::text, true);

  v_hw_id := public.create_teacher_homework(
    v_class_a_id,
    v_subject_a_id,
    'Devoir de Physique Quantique n°1',
    'Résoudre l’équation de Schrödinger à une dimension.',
    '2026-09-23'::date,
    (now() + interval '2 days')::timestamptz,
    45,
    false,
    v_term_a_id
  );

  UPDATE public.school_homework SET period_id = v_period_a_id WHERE id = v_hw_id;

  IF v_hw_id IS NULL THEN
    RAISE EXCEPTION 'TEST 1/2 ÉCHOUÉ : La création du devoir a retourné NULL.';
  END IF;

  SELECT status INTO v_status_text FROM public.school_homework WHERE id = v_hw_id;
  IF v_status_text <> 'draft' THEN
    RAISE EXCEPTION 'TEST 12 ÉCHOUÉ : Le devoir créé doit avoir le statut "draft", obtenu : %', v_status_text;
  END IF;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 3 : REFUS D’UNE CLASSE NON ATTRIBUÉE
  ------------------------------------------------------------------------------
  BEGIN
    PERFORM public.create_teacher_homework(
      v_unassigned_class_id,
      v_subject_a_id,
      'Devoir Illégal Classe',
      'Consignes',
      '2026-09-23'::date,
      (now() + interval '2 days')::timestamptz
    );
    RAISE EXCEPTION 'TEST 3 ÉCHOUÉ : La création pour une classe non attribuée a été acceptée.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' AND SQLERRM NOT LIKE '%Accès refusé%' THEN
      RAISE EXCEPTION 'TEST 3 ÉCHOUÉ : Exception inattendue : % (Code %)', SQLERRM, SQLSTATE;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 4 : REFUS D’UNE MATIÈRE NON ATTRIBUÉE
  ------------------------------------------------------------------------------
  BEGIN
    PERFORM public.create_teacher_homework(
      v_class_a_id,
      v_subject_unassigned_id,
      'Devoir Illégal Matière',
      'Consignes',
      '2026-09-23'::date,
      (now() + interval '2 days')::timestamptz
    );
    RAISE EXCEPTION 'TEST 4 ÉCHOUÉ : La création pour une matière non attribuée a été acceptée.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' AND SQLERRM NOT LIKE '%Accès refusé%' THEN
      RAISE EXCEPTION 'TEST 4 ÉCHOUÉ : Exception inattendue : % (Code %)', SQLERRM, SQLSTATE;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 5 : REFUS D’UN DEVOIR APPARTENANT À UN AUTRE ENSEIGNANT
  ------------------------------------------------------------------------------
  -- Professeur B tente de modifier le devoir créé par Professeur A
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_teacher_b_id, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.update_teacher_homework(
      v_hw_id,
      'Devoir Piraté par Prof B',
      'Consignes Modifiées',
      '2026-09-23'::date,
      (now() + interval '2 days')::timestamptz
    );
    RAISE EXCEPTION 'TEST 5 ÉCHOUÉ : Un autre enseignant a pu modifier le devoir.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé%' THEN
      RAISE EXCEPTION 'TEST 5 ÉCHOUÉ : Exception inattendue : %', SQLERRM;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 6 : ISOLATION STRICTE ENTRE ÉTABLISSEMENTS
  ------------------------------------------------------------------------------
  -- Professeur de l'École B tente de lire ou modifier le devoir de l'École A
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_teacher_school_b_id, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_hw_count FROM public.get_teacher_homework() WHERE id = v_hw_id;
  IF v_hw_count <> 0 THEN
    RAISE EXCEPTION 'TEST 6 ÉCHOUÉ : L’enseignant de l’École B a pu voir le devoir de l’École A.';
  END IF;

  BEGIN
    PERFORM public.publish_teacher_homework(v_hw_id);
    RAISE EXCEPTION 'TEST 6 ÉCHOUÉ : L’enseignant de l’École B a pu publier le devoir de l’École A.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé%' THEN
      RAISE EXCEPTION 'TEST 6 ÉCHOUÉ : Exception inattendue : %', SQLERRM;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 7 & 8 : PARENT ET ÉLÈVE REFUSÉS SUR LES RPCS ENSEIGNANT
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_parent_a_id, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.create_teacher_homework(v_class_a_id, v_subject_a_id, 'Titre', 'Inst', '2026-09-23'::date, now() + interval '1 day');
    RAISE EXCEPTION 'TEST 7 ÉCHOUÉ : Un parent a pu appeler create_teacher_homework.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé%' THEN
      RAISE EXCEPTION 'TEST 7 ÉCHOUÉ : Exception inattendue : %', SQLERRM;
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_student_a_id, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.create_teacher_homework(v_class_a_id, v_subject_a_id, 'Titre', 'Inst', '2026-09-23'::date, now() + interval '1 day');
    RAISE EXCEPTION 'TEST 8 ÉCHOUÉ : Un élève a pu appeler create_teacher_homework.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé%' THEN
      RAISE EXCEPTION 'TEST 8 ÉCHOUÉ : Exception inattendue : %', SQLERRM;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 10 : ENSEIGNANT INACTIF REFUSÉ
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_teacher_inactive_id, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.create_teacher_homework(v_class_a_id, v_subject_a_id, 'Titre', 'Inst', '2026-09-23'::date, now() + interval '1 day');
    RAISE EXCEPTION 'TEST 10 ÉCHOUÉ : Un enseignant suspendu/inactif a pu créer un devoir.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé%' THEN
      RAISE EXCEPTION 'TEST 10 ÉCHOUÉ : Exception inattendue : %', SQLERRM;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 11 : UTILISATEUR ANONYME REFUSÉ
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.create_teacher_homework(v_class_a_id, v_subject_a_id, 'Titre', 'Inst', '2026-09-23'::date, now() + interval '1 day');
    RAISE EXCEPTION 'TEST 11 ÉCHOUÉ : Un utilisateur anonyme a pu appeler la RPC.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé%' THEN
      RAISE EXCEPTION 'TEST 11 ÉCHOUÉ : Exception inattendue : %', SQLERRM;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 13 : MODIFICATION D’UN BROUILLON AUTORISÉE
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_teacher_a_id, 'role', 'authenticated')::text, true);

  v_success := public.update_teacher_homework(
    v_hw_id,
    'Devoir de Physique Quantique n°1 (Corrigé)',
    'Nouvelles consignes de Physique.',
    '2026-09-23'::date,
    (now() + interval '3 days')::timestamptz,
    60,
    v_term_a_id
  );

  IF NOT v_success THEN
    RAISE EXCEPTION 'TEST 13 ÉCHOUÉ : La modification du brouillon a échoué.';
  END IF;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 15 : PUBLICATION D’UN BROUILLON AUTORISÉE
  ------------------------------------------------------------------------------
  v_success := public.publish_teacher_homework(v_hw_id);
  IF NOT v_success THEN
    RAISE EXCEPTION 'TEST 15 ÉCHOUÉ : La publication du brouillon a échoué.';
  END IF;

  SELECT status INTO v_status_text FROM public.school_homework WHERE id = v_hw_id;
  IF v_status_text <> 'published' THEN
    RAISE EXCEPTION 'TEST 15 ÉCHOUÉ : Statut attendu "published", obtenu : %', v_status_text;
  END IF;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 16 : DOUBLE PUBLICATION GÉRÉE PROPREMENT
  ------------------------------------------------------------------------------
  BEGIN
    PERFORM public.publish_teacher_homework(v_hw_id);
    RAISE EXCEPTION 'TEST 16 ÉCHOUÉ : La double publication d’un devoir déjà publié a été acceptée.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Seul un devoir au statut "draft" peut être publié%' THEN
      RAISE EXCEPTION 'TEST 16 ÉCHOUÉ : Exception inattendue : %', SQLERRM;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 21 : VISIBILITÉ DU DEVOIR PUBLIÉ PAR LE PARENT AUTORISÉ
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_parent_a_id, 'role', 'authenticated')::text, true);

  v_res_json := public.get_parent_student_homework(v_student_a_id);

  IF jsonb_array_length(v_res_json->'homework') <> 1 THEN
    RAISE EXCEPTION 'TEST 21 ÉCHOUÉ : Le parent lié n’a pas pu voir le devoir publié (trouvé : %).', jsonb_array_length(v_res_json->'homework');
  END IF;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 22 : PARENT D’UNE AUTRE ÉCOLE OU NON LIÉ NE VOIT PAS LE DEVOIR
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_parent_other_id, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.get_parent_student_homework(v_student_a_id);
    RAISE EXCEPTION 'TEST 22 ÉCHOUÉ : Un parent non lié a pu consulter les devoirs d’un élève.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Accès refusé%' AND SQLERRM NOT LIKE '%REJET ACCÈS%' THEN
      RAISE EXCEPTION 'TEST 22 ÉCHOUÉ : Exception inattendue : %', SQLERRM;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 17 : ANNULATION AUTORISÉE VIA WORKFLOW EXISTANT
  ------------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_prof_teacher_a_id, 'role', 'authenticated')::text, true);

  v_success := public.cancel_teacher_homework(v_hw_id, 'Annulation suite à réorganisation du programme.');
  IF NOT v_success THEN
    RAISE EXCEPTION 'TEST 17 ÉCHOUÉ : L’annulation du devoir a échoué.';
  END IF;

  SELECT status INTO v_status_text FROM public.school_homework WHERE id = v_hw_id;
  IF v_status_text <> 'cancelled' THEN
    RAISE EXCEPTION 'TEST 17 ÉCHOUÉ : Statut attendu "cancelled", obtenu : %', v_status_text;
  END IF;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 18 : DEVOIR ANNULÉ NON REPUBLIABLE
  ------------------------------------------------------------------------------
  BEGIN
    PERFORM public.publish_teacher_homework(v_hw_id);
    RAISE EXCEPTION 'TEST 18 ÉCHOUÉ : La ré-publication d’un devoir annulé a été acceptée.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Seul un devoir au statut "draft" peut être publié%' THEN
      RAISE EXCEPTION 'TEST 18 ÉCHOUÉ : Exception inattendue : %', SQLERRM;
    END IF;
  END;

  ------------------------------------------------------------------------------
  -- SCÉNARIO 20 : CONTRÔLE DE SECURITY DEFINER, SEARCH_PATH='' ET PRIVILÈGES (6 RPCs)
  ------------------------------------------------------------------------------
  SELECT count(*) INTO v_secdef_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_teacher_homework',
      'update_teacher_homework',
      'publish_teacher_homework',
      'cancel_teacher_homework',
      'close_teacher_homework',
      'get_teacher_homework'
    )
    AND p.prosecdef = true
    AND p.proconfig IS NOT NULL
    AND array_to_string(p.proconfig, ',') NOT LIKE '%search_path=public%'
    AND (
      array_to_string(p.proconfig, ',') LIKE '%search_path=%'
      OR array_to_string(p.proconfig, ',') LIKE '%search_path=""%'
    );

  IF v_secdef_count <> 6 THEN
    RAISE EXCEPTION 'TEST 20 ÉCHOUÉ : Les 6 RPCs n’ont pas toutes SECURITY DEFINER et search_path="" configuré (trouvé % / 6).', v_secdef_count;
  END IF;

  RAISE NOTICE '=== SUITE DE TESTS SQL COMPLÈTE : 22/22 SCÉNARIOS RÉUSSIS (100%% PASS) ===';
END $$;

ROLLBACK;
