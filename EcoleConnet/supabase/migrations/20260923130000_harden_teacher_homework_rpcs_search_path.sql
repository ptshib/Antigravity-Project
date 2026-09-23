-- Migration horodatée : 20260923130000_harden_teacher_homework_rpcs_search_path.sql
-- Durcissement sécurisé des 6 RPCs Devoirs Enseignant : SET search_path = ''

-- 1. RPC : get_teacher_homework
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


-- 3. RPC : update_teacher_homework
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
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
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
      'reason', coalesce(trim(p_reason), 'Mise à jour du devoir'),
      'old_data', jsonb_build_object(
        'title', v_hw.title,
        'instructions', v_hw.instructions,
        'assigned_on', v_hw.assigned_on,
        'due_at', v_hw.due_at,
        'estimated_minutes', v_hw.estimated_minutes,
        'term_id', v_hw.term_id
      ),
      'new_data', jsonb_build_object(
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


-- 4. RPC : publish_teacher_homework
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


-- 5. RPC : cancel_teacher_homework
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


-- 6. RPC : close_teacher_homework
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
