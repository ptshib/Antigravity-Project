-- Migration Phase 2D.1 : Gestion Réelle et Sécurisée des Devoirs (School Homework)
-- Fichier : supabase/migrations/20260817150000_teacher_homework_management.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. CREATION DE LA TABLE PUBLIC.SCHOOL_HOMEWORK
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_homework (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  term_id UUID REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  assigned_on DATE NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  estimated_minutes INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'closed', 'cancelled')),
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Contraintes nommées explicites
  CONSTRAINT chk_homework_estimated_minutes_positive CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  CONSTRAINT chk_homework_due_after_assigned CHECK (due_at >= (assigned_on::text || ' 00:00:00+00')::timestamptz),
  CONSTRAINT chk_homework_title_not_empty CHECK (length(trim(title)) > 0),
  CONSTRAINT chk_homework_instructions_not_empty CHECK (length(trim(instructions)) > 0)
);

-- Index d'optimisation
CREATE INDEX IF NOT EXISTS idx_homework_school_id ON public.school_homework(school_id);
CREATE INDEX IF NOT EXISTS idx_homework_class_id ON public.school_homework(class_id);
CREATE INDEX IF NOT EXISTS idx_homework_teacher_id ON public.school_homework(teacher_id);
CREATE INDEX IF NOT EXISTS idx_homework_subject_id ON public.school_homework(subject_id);
CREATE INDEX IF NOT EXISTS idx_homework_status ON public.school_homework(status);
CREATE INDEX IF NOT EXISTS idx_homework_due_at ON public.school_homework(due_at);
CREATE INDEX IF NOT EXISTS idx_homework_academic_year ON public.school_homework(academic_year_id);

--------------------------------------------------------------------------------
-- 2. TRIGGER D'INTEGRITE MULTI-ECOLES ET DE VERROUILLAGE DES CHAMPS
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_school_homework_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tch_school_id UUID;
  v_tch_emp_status TEXT;
  v_tch_acc_status TEXT;
  v_cls_school_id UUID;
  v_cls_year_id UUID;
  v_year_school_id UUID;
  v_sbj_school_id UUID;
  v_term_school_id UUID;
  v_term_year_id UUID;
  v_has_active_assignment BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A. Vérifier que l'année scolaire appartient à l'école
    SELECT school_id INTO v_year_school_id
    FROM public.academic_years
    WHERE id = NEW.academic_year_id;

    IF v_year_school_id IS NULL OR v_year_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id;
    END IF;

    -- B. Si un trimestre est renseigné, vérifier son école et son année scolaire
    IF NEW.term_id IS NOT NULL THEN
      SELECT school_id, academic_year_id INTO v_term_school_id, v_term_year_id
      FROM public.academic_terms
      WHERE id = NEW.term_id;

      IF v_term_school_id IS NULL OR v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : Le trimestre (%) n’appartient pas à la même école ou année scolaire.', NEW.term_id;
      END IF;
    END IF;

    -- C. Vérifier que la classe appartient à l'école et à l'année scolaire
    SELECT school_id, academic_year_id INTO v_cls_school_id, v_cls_year_id
    FROM public.classes
    WHERE id = NEW.class_id;

    IF v_cls_school_id IS NULL OR v_cls_school_id <> NEW.school_id OR v_cls_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La classe (%) n’appartient pas à la même école ou année scolaire.', NEW.class_id;
    END IF;

    -- D. Vérifier que la matière appartient à l'école
    SELECT school_id INTO v_sbj_school_id
    FROM public.subjects
    WHERE id = NEW.subject_id;

    IF v_sbj_school_id IS NULL OR v_sbj_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La matière (%) n’appartient pas à l’établissement.', NEW.subject_id;
    END IF;

    -- E. Vérifier que l'enseignant appartient à l'école et est actif
    SELECT school_id, employment_status, account_status
    INTO v_tch_school_id, v_tch_emp_status, v_tch_acc_status
    FROM public.teachers
    WHERE id = NEW.teacher_id;

    IF v_tch_school_id IS NULL OR v_tch_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : L’enseignant (%) n’appartient pas à cet établissement.', NEW.teacher_id;
    END IF;

    IF v_tch_emp_status <> 'active' OR v_tch_acc_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Le dossier de l’enseignant n’est pas actif.';
    END IF;

    -- F. Exiger une affectation active exacte (teacher_id + class_id + subject_id + academic_year_id)
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

  IF TG_OP = 'UPDATE' THEN
    -- Verrouillage strict des champs immuables
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

    -- Si term_id change, vérifier sa cohérence avec l'école et l'année scolaire
    IF NEW.term_id IS NOT NULL AND OLD.term_id IS DISTINCT FROM NEW.term_id THEN
      SELECT school_id, academic_year_id INTO v_term_school_id, v_term_year_id
      FROM public.academic_terms
      WHERE id = NEW.term_id;

      IF v_term_school_id IS NULL OR v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : Le trimestre (%) n’appartient pas à la même école ou année scolaire.', NEW.term_id;
      END IF;
    END IF;

    -- Note : Sur UPDATE, la vérification de statut de l'enseignant ou de l'affectation
    -- n'est pas ré-exigée pour permettre les annulations/clôtures administratives légitimes.
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_school_homework_integrity ON public.school_homework;
CREATE TRIGGER trg_check_school_homework_integrity
  BEFORE INSERT OR UPDATE ON public.school_homework
  FOR EACH ROW EXECUTE FUNCTION public.check_school_homework_integrity();

DROP TRIGGER IF EXISTS trg_school_homework_updated_at ON public.school_homework;
CREATE TRIGGER trg_school_homework_updated_at
  BEFORE UPDATE ON public.school_homework
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

--------------------------------------------------------------------------------
-- 3. RPCS SECURISEES POUR LA GESTION DES DEVOIRS
--------------------------------------------------------------------------------

-- A. RPC: Créer un devoir (create_teacher_homework)
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
SET search_path = public
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

  -- Profil et rôle
  SELECT role, school_id, is_active INTO v_profile_role, v_school_id, v_profile_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_profile_role IS NULL OR v_profile_active IS NOT TRUE OR v_profile_role <> 'teacher' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un enseignant actif peut créer un devoir.';
  END IF;

  -- Statut École
  SELECT status INTO v_school_status FROM public.schools WHERE id = v_school_id;
  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
  END IF;

  -- Dossier Enseignant
  SELECT id, account_status, employment_status
  INTO v_teacher_id, v_tch_acc_status, v_tch_emp_status
  FROM public.teachers
  WHERE profile_id = v_uid AND school_id = v_school_id;

  IF v_teacher_id IS NULL OR v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : Le dossier de l’enseignant n’est pas actif.';
  END IF;

  -- Déduire l'année scolaire depuis la classe
  SELECT academic_year_id INTO v_year_id
  FROM public.classes
  WHERE id = p_class_id AND school_id = v_school_id;

  IF v_year_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable ou n’appartenant pas à votre établissement.';
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

  -- Journal d'audit conforme
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

-- B. RPC: Modifier un devoir (update_teacher_homework)
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
SET search_path = public
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

  -- Verrouiller la ligne pour mise à jour atomique
  SELECT * INTO v_hw
  FROM public.school_homework
  WHERE id = p_homework_id
  FOR UPDATE;

  IF v_hw.id IS NULL THEN
    RAISE EXCEPTION 'Devoir introuvable.';
  END IF;

  -- SuperAdmin peut intervenir sur toute école
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

  -- Audit renforcé avec old_data et new_data complets
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

-- C. RPC: Publier un devoir (publish_teacher_homework)
CREATE OR REPLACE FUNCTION public.publish_teacher_homework(p_homework_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- D. RPC: Clôturer un devoir (close_teacher_homework)
CREATE OR REPLACE FUNCTION public.close_teacher_homework(p_homework_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- E. RPC: Annuler un devoir avec motif (cancel_teacher_homework)
CREATE OR REPLACE FUNCTION public.cancel_teacher_homework(
  p_homework_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
      'previous_status', v_hw.status,
      'reason', trim(p_reason),
      'cancelled_at', now()
    )
  );

  RETURN true;
END;
$$;

-- F. RPC: Obtenir les devoirs pour le portail enseignant / admin (get_teacher_homework)
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
SET search_path = public
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

  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_uid;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif.';
  END IF;

  IF v_caller_role = 'teacher' THEN
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_caller_school_id;
    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
    END IF;

    SELECT t.id, t.account_status, t.employment_status
    INTO v_tch_id, v_tch_acc_status, v_tch_emp_status
    FROM public.teachers t WHERE t.profile_id = v_uid AND t.school_id = v_caller_school_id;

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
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_caller_school_id;
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
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;
END;
$$;

-- G. RPC: Obtenir les devoirs pour un élève (get_homework_for_student)
CREATE OR REPLACE FUNCTION public.get_homework_for_student(p_student_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  school_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  teacher_name TEXT,
  title TEXT,
  instructions TEXT,
  assigned_on DATE,
  due_at TIMESTAMPTZ,
  estimated_minutes INTEGER,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile_role TEXT;
  v_profile_active BOOLEAN;
  v_profile_school_id UUID;
  v_student_id UUID;
  v_student_school_id UUID;
  v_school_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT role, school_id, is_active INTO v_profile_role, v_profile_school_id, v_profile_active
  FROM public.profiles WHERE id = v_uid;

  IF v_profile_role IS NULL OR v_profile_active IS NOT TRUE OR v_profile_role <> 'student' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un élève actif peut consulter ses devoirs.';
  END IF;

  -- Obtenir le dossier élève lié à l'utilisateur connecté
  SELECT st.id, st.school_id INTO v_student_id, v_student_school_id
  FROM public.students st
  WHERE st.profile_id = v_uid;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Dossier élève introuvable pour votre compte.';
  END IF;

  IF p_student_id IS NOT NULL AND p_student_id <> v_student_id THEN
    RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres devoirs.';
  END IF;

  IF v_profile_school_id IS NULL OR v_student_school_id IS NULL OR v_profile_school_id <> v_student_school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : Profil et dossier élève incompatibles.';
  END IF;

  SELECT status INTO v_school_status FROM public.schools WHERE id = v_student_school_id;
  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
  END IF;

  -- Sélection directe sans SELECT ... LIMIT 1 non déterministe
  RETURN QUERY
  SELECT
    h.id,
    h.school_id,
    h.class_id,
    c.name AS class_name,
    h.subject_id,
    s.name AS subject_name,
    (t.first_name || ' ' || t.last_name) AS teacher_name,
    h.title,
    h.instructions,
    h.assigned_on,
    h.due_at,
    h.estimated_minutes,
    h.status
  FROM public.school_homework h
  JOIN public.classes c ON c.id = h.class_id
  JOIN public.subjects s ON s.id = h.subject_id
  JOIN public.teachers t ON t.id = h.teacher_id
  JOIN public.student_enrollments se ON se.class_id = h.class_id
    AND se.academic_year_id = h.academic_year_id
    AND se.school_id = v_student_school_id
    AND se.student_id = v_student_id
    AND se.status = 'active'
  JOIN public.academic_years ay ON ay.id = se.academic_year_id
    AND ay.school_id = v_student_school_id
    AND ay.is_current = true
  WHERE h.school_id = v_student_school_id
    AND c.academic_year_id = se.academic_year_id
    AND h.status IN ('published', 'closed')
  ORDER BY h.due_at DESC;
END;
$$;

-- H. RPC: Obtenir les devoirs pour le parent d'un élève (get_homework_for_parent_child)
CREATE OR REPLACE FUNCTION public.get_homework_for_parent_child(p_student_id UUID)
RETURNS TABLE (
  id UUID,
  school_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  teacher_name TEXT,
  title TEXT,
  instructions TEXT,
  assigned_on DATE,
  due_at TIMESTAMPTZ,
  estimated_minutes INTEGER,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile_role TEXT;
  v_profile_active BOOLEAN;
  v_profile_school_id UUID;
  v_student_school_id UUID;
  v_school_status TEXT;
  v_is_parent BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Identifiant élève obligatoire.';
  END IF;

  SELECT role, school_id, is_active INTO v_profile_role, v_profile_school_id, v_profile_active
  FROM public.profiles WHERE id = v_uid;

  IF v_profile_role IS NULL OR v_profile_active IS NOT TRUE OR v_profile_role <> 'parent' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un parent actif peut utiliser cette fonction.';
  END IF;

  -- Vérification du lien parent-élève avec helper public.is_parent_of_student(p_student_id)
  v_is_parent := public.is_parent_of_student(p_student_id);

  IF NOT v_is_parent THEN
    RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas un parent approuvé pour cet élève.';
  END IF;

  -- École de l'élève
  SELECT st.school_id INTO v_student_school_id FROM public.students st WHERE st.id = p_student_id;

  IF v_student_school_id IS NULL OR v_profile_school_id IS NULL OR v_student_school_id <> v_profile_school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’élève n’appartient pas au même établissement.';
  END IF;

  SELECT status INTO v_school_status FROM public.schools WHERE id = v_student_school_id;
  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.';
  END IF;

  -- Sélection directe sans SELECT ... LIMIT 1 non déterministe
  RETURN QUERY
  SELECT
    h.id,
    h.school_id,
    h.class_id,
    c.name AS class_name,
    h.subject_id,
    s.name AS subject_name,
    (t.first_name || ' ' || t.last_name) AS teacher_name,
    h.title,
    h.instructions,
    h.assigned_on,
    h.due_at,
    h.estimated_minutes,
    h.status
  FROM public.school_homework h
  JOIN public.classes c ON c.id = h.class_id
  JOIN public.subjects s ON s.id = h.subject_id
  JOIN public.teachers t ON t.id = h.teacher_id
  JOIN public.student_enrollments se ON se.class_id = h.class_id
    AND se.academic_year_id = h.academic_year_id
    AND se.school_id = v_student_school_id
    AND se.student_id = p_student_id
    AND se.status = 'active'
  JOIN public.academic_years ay ON ay.id = se.academic_year_id
    AND ay.school_id = v_student_school_id
    AND ay.is_current = true
  WHERE h.school_id = v_student_school_id
    AND c.academic_year_id = se.academic_year_id
    AND h.status IN ('published', 'closed')
  ORDER BY h.due_at DESC;
END;
$$;

--------------------------------------------------------------------------------
-- 4. PRIVILEGES ET ATTRIBUTION STRICTE DES RPCS
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_teacher_homework(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_teacher_homework(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_teacher_homework(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_teacher_homework() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_homework_for_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_homework_for_parent_child(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_teacher_homework(UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_teacher_homework(UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, INTEGER, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_teacher_homework(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_teacher_homework(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_teacher_homework(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_homework() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_homework_for_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_homework_for_parent_child(UUID) TO authenticated;

--------------------------------------------------------------------------------
-- 5. POLITIQUES RLS SUR PUBLIC.SCHOOL_HOMEWORK (EXCLUSIVEMENT SELECT)
--------------------------------------------------------------------------------
ALTER TABLE public.school_homework ENABLE ROW LEVEL SECURITY;

-- Suppression intégrale de toute politique d'écriture directe pour authenticated
DROP POLICY IF EXISTS "SuperAdmin full access homework" ON public.school_homework;
DROP POLICY IF EXISTS "SuperAdmin read all homework" ON public.school_homework;
DROP POLICY IF EXISTS "SchoolAdmin read school homework" ON public.school_homework;
DROP POLICY IF EXISTS "SchoolAdmin update school homework" ON public.school_homework;
DROP POLICY IF EXISTS "Teacher read own homework" ON public.school_homework;
DROP POLICY IF EXISTS "Teacher insert own homework" ON public.school_homework;
DROP POLICY IF EXISTS "Teacher update own homework" ON public.school_homework;
DROP POLICY IF EXISTS "Student read class homework" ON public.school_homework;
DROP POLICY IF EXISTS "Parent read child class homework" ON public.school_homework;

-- Garantie fail-closed : supprimer toute politique d'écriture historique,
-- même si son nom ne figure pas dans la liste ci-dessus.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'school_homework'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.school_homework', v_policy.policyname);
  END LOOP;
END;
$$;

-- SuperAdmin (SELECT uniquement)
CREATE POLICY "SuperAdmin read all homework"
  ON public.school_homework FOR SELECT
  USING (public.is_super_admin());

-- SchoolAdmin (SELECT uniquement sur son école)
CREATE POLICY "SchoolAdmin read school homework"
  ON public.school_homework FOR SELECT
  USING (public.is_school_admin(school_id));

-- Teacher (SELECT uniquement sur ses devoirs créés)
CREATE POLICY "Teacher read own homework"
  ON public.school_homework FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.schools sc ON sc.id = p.school_id
      JOIN public.teachers t
        ON t.profile_id = p.id
       AND t.school_id = p.school_id
      WHERE p.id = auth.uid()
        AND p.role = 'teacher'
        AND p.is_active = true
        AND sc.status = 'active'
        AND t.id = school_homework.teacher_id
        AND t.school_id = school_homework.school_id
        AND t.account_status = 'active'
        AND t.employment_status = 'active'
    )
  );

-- Student (SELECT uniquement sur les devoirs publiés ou clôturés de sa classe active)
CREATE POLICY "Student read class homework"
  ON public.school_homework FOR SELECT
  USING (
    status IN ('published', 'closed') AND
    EXISTS (
      SELECT 1 FROM public.student_enrollments se
      JOIN public.students st ON st.id = se.student_id
      JOIN public.academic_years ay ON ay.id = se.academic_year_id
      JOIN public.classes c ON c.id = se.class_id
      WHERE st.profile_id = auth.uid()
        AND public.is_student_self(st.id)
        AND st.school_id = school_homework.school_id
        AND se.school_id = st.school_id
        AND se.class_id = school_homework.class_id
        AND se.academic_year_id = school_homework.academic_year_id
        AND c.academic_year_id = se.academic_year_id
        AND se.status = 'active'
        AND ay.is_current = true
    )
  );

-- Parent (SELECT uniquement sur les devoirs publiés ou clôturés de ses enfants liés et approuvés)
CREATE POLICY "Parent read child class homework"
  ON public.school_homework FOR SELECT
  USING (
    status IN ('published', 'closed') AND
    EXISTS (
      SELECT 1 FROM public.parent_student_links psl
      JOIN public.students st ON st.id = psl.student_id
      JOIN public.student_enrollments se ON se.student_id = st.id
      JOIN public.academic_years ay ON ay.id = se.academic_year_id
      JOIN public.classes c ON c.id = se.class_id
      WHERE psl.parent_profile_id = auth.uid()
        AND psl.status = 'approved'
        AND public.is_parent_of_student(st.id)
        AND st.school_id = school_homework.school_id
        AND se.school_id = st.school_id
        AND se.class_id = school_homework.class_id
        AND se.academic_year_id = school_homework.academic_year_id
        AND c.academic_year_id = se.academic_year_id
        AND se.status = 'active'
        AND ay.is_current = true
    )
  );

--------------------------------------------------------------------------------
-- 6. TESTS NEGATIFS ET DE SECURITE DOCUMENTES (SQL SCENARIOS)
--------------------------------------------------------------------------------
/*
TEST NEGATIF 1: Écriture directe interdite (INSERT / UPDATE / DELETE) pour authenticated
---------------------------------------------------------------------------------------
-- Exécuté en tant qu'utilisateur 'authenticated' sans passer par les RPCs :
INSERT INTO public.school_homework (school_id, academic_year_id, class_id, subject_id, teacher_id, title, instructions, assigned_on, due_at, status, created_by)
VALUES ('...', '...', '...', '...', '...', 'Test Hacking', 'Code malveillant', '2026-08-17', '2026-08-18 10:00:00+00', 'published', auth.uid());
-- RÉSULTAT ATTENDU : ERROR: new row violates row-level security policy for table "school_homework" (Zero INSERT policy defined).

UPDATE public.school_homework SET title = 'Hacked Title' WHERE id = '...';
-- RÉSULTAT ATTENDU : 0 rows updated / ERROR: RLS policy violation.

DELETE FROM public.school_homework WHERE id = '...';
-- RÉSULTAT ATTENDU : 0 rows deleted / ERROR: RLS policy violation.


TEST NEGATIF 2: Élève demandant les devoirs d'un autre élève
---------------------------------------------------------------------------------------
-- Élève A connecté (auth.uid() = profile_eleve_A, student_id = std_A)
SELECT * FROM public.get_homework_for_student('uuid-student-B');
-- RÉSULTAT ATTENDU : ERROR: Accès refusé : Vous ne pouvez consulter que vos propres devoirs.


TEST NEGATIF 3: Parent avec lien 'pending' ou non lié demandant les devoirs
---------------------------------------------------------------------------------------
-- Parent P connecté (auth.uid() = profile_parent_P) sur élève non lié ou status != 'approved'
SELECT * FROM public.get_homework_for_parent_child('uuid-student-unlinked');
-- RÉSULTAT ATTENDU : ERROR: Accès refusé : Vous n’êtes pas un parent approuvé pour cet élève.


TEST NEGATIF 4: Enseignant suspendu ou contrat inactif créant un devoir
---------------------------------------------------------------------------------------
-- Enseignant E avec account_status = 'suspended' ou employment_status = 'terminated'
SELECT public.create_teacher_homework('uuid-class', 'uuid-subject', 'Titre', 'Consigne', '2026-08-17', '2026-08-18 10:00:00+00');
-- RÉSULTAT ATTENDU : ERROR: Accès refusé : Le dossier de l’enseignant n’est pas actif.


TEST NEGATIF 5: Établissement (School) suspendu
---------------------------------------------------------------------------------------
-- Établissement S avec status = 'suspended'
SELECT public.create_teacher_homework('uuid-class', 'uuid-subject', 'Titre', 'Consigne', '2026-08-17', '2026-08-18 10:00:00+00');
-- RÉSULTAT ATTENDU : ERROR: Accès refusé : L’établissement est suspendu ou inactif.


TEST NEGATIF 6: SchoolAdmin tentant de lire les devoirs d'une autre école
---------------------------------------------------------------------------------------
-- Admin Ecole X connecté (school_id = school_X)
SELECT * FROM public.school_homework WHERE school_id = 'uuid-school-Y';
-- RÉSULTAT ATTENDU : 0 ligne retournée (RLS filtre strictly par school_id).


TEST POSITIF 7: SuperAdmin en lecture globale multi-écoles
---------------------------------------------------------------------------------------
-- SuperAdmin connecté (role = 'super_admin')
SELECT * FROM public.get_teacher_homework();
-- RÉSULTAT ATTENDU : Retourne la liste intégrale des devoirs de TOUS les établissements sans filtre school_id = NULL.


TEST POSITIF 8: Annulation administrative d'un devoir dont l'enseignant ou l'affectation est devenu inactif
---------------------------------------------------------------------------------------
-- SchoolAdmin annule un devoir créé par un enseignant dont le contrat est désormais inactif ou suspendu :
SELECT public.cancel_teacher_homework('uuid-homework-id', 'Annulation administrative suite à départ enseignant');
-- RÉSULTAT ATTENDU : Succès (true). Le trigger sur UPDATE permet le verrouillage sans rejeter les clôtures/annulations légitimes, et l'action est tracée dans school_audit_logs.
*/

COMMIT;
