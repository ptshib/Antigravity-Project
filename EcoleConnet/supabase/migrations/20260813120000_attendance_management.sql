-- Migration Phase 2C : Module Réel de Gestion des Présences (Idempotente & Sécurisée)
-- Fichier : supabase/migrations/20260813120000_attendance_management.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. TABLE public.attendance_sessions (Séances de Présence)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  term_id uuid REFERENCES public.school_terms(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  attendance_date date NOT NULL DEFAULT CURRENT_DATE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  reopen_reason text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_sessions_status_check CHECK (status IN ('draft', 'completed', 'reopened', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_school ON public.attendance_sessions(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_class_date ON public.attendance_sessions(class_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_academic_year ON public.attendance_sessions(academic_year_id);

--------------------------------------------------------------------------------
-- 2. TABLE public.student_attendance (Présences Élèves par Séance)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  attendance_session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  enrollment_id uuid NOT NULL REFERENCES public.student_enrollments(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'present',
  arrival_time time,
  departure_time time,
  justification text,
  justified boolean NOT NULL DEFAULT false,
  marked_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  marked_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_attendance_status_check CHECK (status IN ('present', 'absent', 'late', 'excused', 'left_early')),
  CONSTRAINT student_attendance_unique_session_student UNIQUE (attendance_session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_attendance_school ON public.student_attendance(school_id);
CREATE INDEX IF NOT EXISTS idx_student_attendance_session ON public.student_attendance(attendance_session_id);
CREATE INDEX IF NOT EXISTS idx_student_attendance_student ON public.student_attendance(student_id);

--------------------------------------------------------------------------------
-- 3. TABLE public.attendance_audit_logs (Registre d'Audit Immuable)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attendance_session_id uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
  student_attendance_id uuid REFERENCES public.student_attendance(id) ON DELETE SET NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action text NOT NULL,
  old_status text,
  new_status text,
  old_data jsonb,
  new_data jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_school ON public.attendance_audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_session ON public.attendance_audit_logs(attendance_session_id);

--------------------------------------------------------------------------------
-- 4. TRIGGERS UPDATED_AT AUTOMATIQUES
--------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_set_attendance_sessions_updated_at ON public.attendance_sessions;
CREATE TRIGGER trg_set_attendance_sessions_updated_at
  BEFORE UPDATE ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

DROP TRIGGER IF EXISTS trg_set_student_attendance_updated_at ON public.student_attendance;
CREATE TRIGGER trg_set_student_attendance_updated_at
  BEFORE UPDATE ON public.student_attendance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

--------------------------------------------------------------------------------
-- 5. INTÉGRITÉ POSTGRESQL & VERROUILLAGE DES CHAMPS IMMUABLES (INCLUANT TERM_ID)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_attendance_session_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_school_id uuid;
  v_class_year_id uuid;
  v_term_school_id uuid;
  v_term_year_id uuid;
  v_subj_school_id uuid;
  v_tch_school_id uuid;
  v_assigned boolean;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Verrouiller STRICTEMENT après INSERT (Point 7 : term_id inclut)
    IF OLD.school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable school_id.';
    END IF;
    IF OLD.class_id <> NEW.class_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable class_id.';
    END IF;
    IF OLD.academic_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable academic_year_id.';
    END IF;
    IF OLD.term_id IS DISTINCT FROM NEW.term_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable term_id.';
    END IF;
    IF OLD.teacher_id IS DISTINCT FROM NEW.teacher_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable teacher_id.';
    END IF;
    IF OLD.subject_id IS DISTINCT FROM NEW.subject_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable subject_id.';
    END IF;
    IF OLD.attendance_date <> NEW.attendance_date THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable attendance_date.';
    END IF;
    IF OLD.created_by <> NEW.created_by THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable created_by.';
    END IF;
  END IF;

  -- 1. Vérifier la classe
  SELECT school_id, academic_year_id INTO v_class_school_id, v_class_year_id
  FROM public.classes WHERE id = NEW.class_id;

  IF v_class_school_id IS NULL THEN
    RAISE EXCEPTION 'La classe spécifiée est introuvable.';
  END IF;

  IF v_class_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'La classe n’appartient pas à l’établissement de la séance.';
  END IF;

  IF v_class_year_id <> NEW.academic_year_id THEN
    RAISE EXCEPTION 'La classe n’appartient pas à l’année scolaire sélectionnée.';
  END IF;

  -- 2. Vérifier le trimestre si renseigné
  IF NEW.term_id IS NOT NULL THEN
    SELECT school_id, academic_year_id INTO v_term_school_id, v_term_year_id
    FROM public.school_terms WHERE id = NEW.term_id;

    IF v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Le trimestre n’appartient pas à l’année scolaire et l’école de la séance.';
    END IF;
  END IF;

  -- 3. Vérifier la matière si renseignée
  IF NEW.subject_id IS NOT NULL THEN
    SELECT school_id INTO v_subj_school_id FROM public.subjects WHERE id = NEW.subject_id;
    IF v_subj_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'La matière n’appartient pas à la même école.';
    END IF;
  END IF;

  -- 4. Vérifier l'enseignant et son affectation exacte classe & matière
  IF NEW.teacher_id IS NOT NULL THEN
    SELECT school_id INTO v_tch_school_id FROM public.teachers WHERE id = NEW.teacher_id;
    IF v_tch_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'L’enseignant n’appartient pas à la même école.';
    END IF;

    IF NEW.subject_id IS NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.teacher_class_assignments
        WHERE teacher_id = NEW.teacher_id
          AND class_id = NEW.class_id
          AND is_active = true
      ) INTO v_assigned;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.teacher_class_assignments
        WHERE teacher_id = NEW.teacher_id
          AND class_id = NEW.class_id
          AND subject_id = NEW.subject_id
          AND is_active = true
      ) INTO v_assigned;
    END IF;

    IF NOT v_assigned THEN
      RAISE EXCEPTION 'L’enseignant sélectionné n’est pas affecté activement à cette classe et matière.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_attendance_session_integrity ON public.attendance_sessions;
CREATE TRIGGER trg_check_attendance_session_integrity
  BEFORE INSERT OR UPDATE ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.check_attendance_session_integrity();

CREATE OR REPLACE FUNCTION public.check_student_attendance_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_school_id uuid;
  v_session_class_id uuid;
  v_session_year_id uuid;
  v_student_school_id uuid;
  v_enr_school_id uuid;
  v_enr_student_id uuid;
  v_enr_class_id uuid;
  v_enr_year_id uuid;
  v_enr_status text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.marked_by := auth.uid();
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.updated_by := auth.uid();
    END IF;
    IF OLD.school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable school_id.';
    END IF;
    IF OLD.attendance_session_id <> NEW.attendance_session_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable attendance_session_id.';
    END IF;
    IF OLD.student_id <> NEW.student_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable student_id.';
    END IF;
    IF OLD.enrollment_id <> NEW.enrollment_id THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable enrollment_id.';
    END IF;
    IF OLD.marked_by <> NEW.marked_by THEN
      RAISE EXCEPTION 'Modification interdite du champ immuable marked_by.';
    END IF;
  END IF;

  -- 1. Récupérer la séance
  SELECT school_id, class_id, academic_year_id INTO v_session_school_id, v_session_class_id, v_session_year_id
  FROM public.attendance_sessions WHERE id = NEW.attendance_session_id;

  IF v_session_school_id IS NULL THEN
    RAISE EXCEPTION 'La séance de présence spécifiée n’existe pas.';
  END IF;

  IF NEW.school_id <> v_session_school_id THEN
    RAISE EXCEPTION 'Incohérence d’établissement pour la présence élève.';
  END IF;

  -- 2. Vérifier l'élève
  SELECT school_id INTO v_student_school_id FROM public.students WHERE id = NEW.student_id;
  IF v_student_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'L’élève n’appartient pas à cette école.';
  END IF;

  -- 3. Vérifier l'inscription
  SELECT school_id, student_id, class_id, academic_year_id, status 
  INTO v_enr_school_id, v_enr_student_id, v_enr_class_id, v_enr_year_id, v_enr_status
  FROM public.student_enrollments WHERE id = NEW.enrollment_id;

  IF v_enr_school_id IS NULL THEN
    RAISE EXCEPTION 'L’inscription scolaire spécifiée est introuvable.';
  END IF;

  IF v_enr_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'L’inscription appartient à une autre école.';
  END IF;

  IF v_enr_student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'L’inscription ne correspond pas à l’élève spécifié.';
  END IF;

  IF v_enr_class_id <> v_session_class_id THEN
    RAISE EXCEPTION 'L’élève doit être inscrit dans la classe de la séance d’appel.';
  END IF;

  IF v_enr_year_id <> v_session_year_id THEN
    RAISE EXCEPTION 'L’inscription appartient à une autre année scolaire.';
  END IF;

  IF v_enr_status <> 'active' THEN
    RAISE EXCEPTION 'L’élève doit posséder une inscription active dans la classe.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_student_attendance_integrity ON public.student_attendance;
CREATE TRIGGER trg_check_student_attendance_integrity
  BEFORE INSERT OR UPDATE ON public.student_attendance
  FOR EACH ROW EXECUTE FUNCTION public.check_student_attendance_integrity();

--------------------------------------------------------------------------------
-- 6. HELPER SECURITY DEFINER DE PROPRIÉTÉ EXACTE ENSEIGNANT (Point 2)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_teacher_owner_of_attendance_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_role text := public.get_auth_role();
  v_user_school_id uuid := public.get_auth_school_id();
  v_sess_school_id uuid;
  v_sess_teacher_id uuid;
  v_sess_class_id uuid;
  v_sess_subject_id uuid;
  v_teacher_profile_id uuid;
  v_teacher_emp_status text;
  v_user_active boolean := false;
  v_school_active boolean := false;
  v_assigned boolean := false;
BEGIN
  IF v_uid IS NULL OR v_user_role <> 'teacher' THEN
    RETURN false;
  END IF;

  -- 1. Profil et École Actifs
  SELECT p.is_active, (s.status = 'active') INTO v_user_active, v_school_active
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_uid;

  IF NOT (v_user_active AND v_school_active) THEN
    RETURN false;
  END IF;

  -- 2. Détails Séance
  SELECT school_id, teacher_id, class_id, subject_id
  INTO v_sess_school_id, v_sess_teacher_id, v_sess_class_id, v_sess_subject_id
  FROM public.attendance_sessions WHERE id = p_session_id;

  IF v_sess_school_id IS NULL OR v_sess_school_id <> v_user_school_id THEN
    RETURN false;
  END IF;

  -- 3. Vérifier que teacher_id référence teachers.id correspondant au compte authentifié
  SELECT profile_id, employment_status INTO v_teacher_profile_id, v_teacher_emp_status
  FROM public.teachers WHERE id = v_sess_teacher_id;

  IF v_teacher_profile_id IS NULL OR v_teacher_profile_id <> v_uid OR v_teacher_emp_status <> 'active' THEN
    RETURN false;
  END IF;

  -- 4. Vérifier l'affectation active classe/matière
  IF v_sess_subject_id IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.teacher_class_assignments
      WHERE teacher_id = v_sess_teacher_id
        AND class_id = v_sess_class_id
        AND is_active = true
    ) INTO v_assigned;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.teacher_class_assignments
      WHERE teacher_id = v_sess_teacher_id
        AND class_id = v_sess_class_id
        AND subject_id = v_sess_subject_id
        AND is_active = true
    ) INTO v_assigned;
  END IF;

  RETURN v_assigned;
END;
$$;

--------------------------------------------------------------------------------
-- 7. HELPERS LECTURE ET ÉCRITURE
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_user_read_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := public.get_auth_role();
  v_school_id uuid := public.get_auth_school_id();
  v_sess_school_id uuid;
  v_sess_class_id uuid;
  v_uid uuid := auth.uid();
  v_has_access boolean := false;
BEGIN
  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  SELECT school_id, class_id INTO v_sess_school_id, v_sess_class_id
  FROM public.attendance_sessions WHERE id = p_session_id;

  IF v_sess_school_id IS NULL OR v_sess_school_id <> v_school_id THEN
    RETURN false;
  END IF;

  IF v_role = 'school_admin' THEN
    RETURN true;
  ELSIF v_role = 'teacher' THEN
    -- L'enseignant peut lire les séances des classes auxquelles il est affecté (Point 6)
    RETURN public.is_teacher_of_class(v_sess_class_id);
  ELSIF v_role = 'parent' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.student_attendance sa
      JOIN public.parent_student_links psl ON psl.student_id = sa.student_id
      WHERE sa.attendance_session_id = p_session_id
        AND psl.parent_profile_id = v_uid
        AND psl.status = 'approved'
    ) INTO v_has_access;
    RETURN v_has_access;
  ELSIF v_role = 'student' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.student_attendance sa
      JOIN public.students st ON st.id = sa.student_id
      WHERE sa.attendance_session_id = p_session_id
        AND st.profile_id = v_uid
    ) INTO v_has_access;
    RETURN v_has_access;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_user_write_attendance(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := public.get_auth_role();
  v_school_id uuid := public.get_auth_school_id();
  v_sess_school_id uuid;
  v_sess_status text;
  v_user_active boolean := false;
  v_school_active boolean := false;
BEGIN
  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  SELECT p.is_active, (s.status = 'active') INTO v_user_active, v_school_active
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = auth.uid();

  IF NOT (v_user_active AND v_school_active) THEN
    RETURN false;
  END IF;

  SELECT school_id, status INTO v_sess_school_id, v_sess_status
  FROM public.attendance_sessions WHERE id = p_session_id;

  IF v_sess_school_id IS NULL OR v_sess_school_id <> v_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Séance dans un autre établissement.';
  END IF;

  IF v_role = 'school_admin' THEN
    RETURN true;
  ELSIF v_role = 'teacher' THEN
    -- Pour l'enseignant, exigence de propriété exacte et statut draft/reopened (Point 5)
    IF v_sess_status NOT IN ('draft', 'reopened') THEN
      RETURN false;
    END IF;
    RETURN public.is_teacher_owner_of_attendance_session(p_session_id);
  END IF;

  RETURN false;
END;
$$;

--------------------------------------------------------------------------------
-- 8. RPC SÉCURISÉES DÉDIÉES (FOR UPDATE LOCKS & AUDIT LOGS OBLIGATOIRES)
--------------------------------------------------------------------------------

-- RPC 1 : Créer une séance d'appel (Point 1)
CREATE OR REPLACE FUNCTION public.create_attendance_session(
  p_class_id uuid,
  p_subject_id uuid DEFAULT NULL,
  p_attendance_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid := public.get_auth_school_id();
  v_year_id uuid;
  v_session_id uuid;
  v_role text := public.get_auth_role();
  v_uid uuid := auth.uid();
  v_teacher_id uuid := NULL;
  v_assigned boolean;
BEGIN
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Aucun établissement associé.';
  END IF;

  IF v_role NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs et enseignants peuvent créer un appel.';
  END IF;

  SELECT academic_year_id INTO v_year_id FROM public.classes WHERE id = p_class_id AND school_id = v_school_id;
  IF v_year_id IS NULL THEN
    RAISE EXCEPTION 'La classe spécifiée n’existe pas dans votre établissement.';
  END IF;

  IF v_role = 'teacher' THEN
    SELECT id INTO v_teacher_id FROM public.teachers WHERE profile_id = v_uid AND school_id = v_school_id AND employment_status = 'active' LIMIT 1;
    IF v_teacher_id IS NULL THEN
      RAISE EXCEPTION 'Profil enseignant actif introuvable.';
    END IF;

    -- Contrôle strict d'affectation
    IF p_subject_id IS NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.teacher_class_assignments
        WHERE teacher_id = v_teacher_id AND class_id = p_class_id AND is_active = true
      ) INTO v_assigned;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.teacher_class_assignments
        WHERE teacher_id = v_teacher_id AND class_id = p_class_id AND subject_id = p_subject_id AND is_active = true
      ) INTO v_assigned;
    END IF;

    IF NOT v_assigned THEN
      RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas affecté à cette classe et matière.';
    END IF;
  END IF;

  INSERT INTO public.attendance_sessions (
    school_id,
    class_id,
    academic_year_id,
    subject_id,
    teacher_id,
    attendance_date,
    notes,
    status,
    created_by
  ) VALUES (
    v_school_id,
    p_class_id,
    v_year_id,
    p_subject_id,
    v_teacher_id,
    p_attendance_date,
    p_notes,
    'draft',
    v_uid
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.attendance_audit_logs (
    school_id,
    attendance_session_id,
    actor_id,
    action,
    new_status
  ) VALUES (
    v_school_id,
    v_session_id,
    v_uid,
    'session_created',
    'draft'
  );

  RETURN v_session_id;
END;
$$;

-- RPC 2 : Finaliser une séance d'appel (Propriété exacte requise pour teacher - Point 3)
CREATE OR REPLACE FUNCTION public.complete_attendance_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid := public.get_auth_school_id();
  v_old_status text;
  v_role text := public.get_auth_role();
  v_uid uuid := auth.uid();
BEGIN
  SELECT status, school_id INTO v_old_status, v_school_id
  FROM public.attendance_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Séance de présence introuvable.';
  END IF;

  IF v_old_status NOT IN ('draft', 'reopened') THEN
    RAISE EXCEPTION 'Transition invalide : Seule une séance en brouillon ou rouverte peut être finalisée.';
  END IF;

  IF v_role = 'teacher' THEN
    IF NOT public.is_teacher_owner_of_attendance_session(p_session_id) THEN
      RAISE EXCEPTION 'Accès refusé : Seul l’enseignant propriétaire de cette séance peut la finaliser.';
    END IF;
  ELSIF NOT (public.is_super_admin() OR (v_role = 'school_admin' AND v_school_id = public.get_auth_school_id())) THEN
    RAISE EXCEPTION 'Accès refusé pour finaliser cette séance d’appel.';
  END IF;

  UPDATE public.attendance_sessions
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = p_session_id;

  INSERT INTO public.attendance_audit_logs (
    school_id,
    attendance_session_id,
    actor_id,
    action,
    old_status,
    new_status
  ) VALUES (
    v_school_id,
    p_session_id,
    v_uid,
    'session_completed',
    v_old_status,
    'completed'
  );

  RETURN true;
END;
$$;

-- RPC 3 : Rouvrir une séance terminée (FOR UPDATE lock & SchoolAdmin/SuperAdmin uniquement)
CREATE OR REPLACE FUNCTION public.reopen_attendance_session(
  p_session_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid := public.get_auth_school_id();
  v_old_status text;
  v_uid uuid := auth.uid();
BEGIN
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Le motif de réouverture est obligatoire et ne peut pas être vide.';
  END IF;

  SELECT status, school_id INTO v_old_status, v_school_id
  FROM public.attendance_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Séance de présence introuvable.';
  END IF;

  IF v_old_status <> 'completed' THEN
    RAISE EXCEPTION 'Seule une séance avec le statut completed peut être rouverte.';
  END IF;

  IF NOT (public.is_super_admin() OR (public.is_school_admin(v_school_id) AND v_school_id = public.get_auth_school_id())) THEN
    RAISE EXCEPTION 'Accès refusé : Seul le Super-Admin ou l’Administrateur d’Établissement peut rouvrir une séance terminée.';
  END IF;

  UPDATE public.attendance_sessions
  SET status = 'reopened',
      reopen_reason = trim(p_reason),
      updated_at = now()
  WHERE id = p_session_id;

  INSERT INTO public.attendance_audit_logs (
    school_id,
    attendance_session_id,
    actor_id,
    action,
    old_status,
    new_status,
    reason
  ) VALUES (
    v_school_id,
    p_session_id,
    v_uid,
    'session_reopened',
    'completed',
    'reopened',
    trim(p_reason)
  );

  RETURN true;
END;
$$;

-- RPC 4 : Mettre à jour / Créer une présence élève (Point 4 & Point 8 : action creation/update)
CREATE OR REPLACE FUNCTION public.update_student_attendance(
  p_session_id uuid,
  p_student_id uuid,
  p_status text,
  p_arrival_time time DEFAULT NULL,
  p_justification text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid := public.get_auth_school_id();
  v_role text := public.get_auth_role();
  v_uid uuid := auth.uid();
  v_session_status text;
  v_session_class_id uuid;
  v_old_status text;
  v_old_rec jsonb;
  v_new_rec jsonb;
  v_enr_id uuid;
  v_audit_action text;
BEGIN
  -- 1. Récupérer la séance
  SELECT status, class_id, school_id INTO v_session_status, v_session_class_id, v_school_id
  FROM public.attendance_sessions WHERE id = p_session_id;

  IF v_session_status IS NULL THEN
    RAISE EXCEPTION 'Séance de présence introuvable.';
  END IF;

  IF v_school_id <> public.get_auth_school_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Incohérence d’établissement.';
  END IF;

  -- 2. Contrôle de rôle et propriété exacte (Point 4)
  IF v_role = 'teacher' THEN
    IF v_session_status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Accès refusé : La séance est terminée ou annulée pour un enseignant.';
    END IF;
    IF NOT public.is_teacher_owner_of_attendance_session(p_session_id) THEN
      RAISE EXCEPTION 'Accès refusé : Seul l’enseignant propriétaire de cette séance peut modifier les présences.';
    END IF;
  ELSIF v_role = 'school_admin' OR public.is_super_admin() THEN
    IF v_session_status = 'completed' AND (p_reason IS NULL OR trim(p_reason) = '') THEN
      RAISE EXCEPTION 'Un motif est obligatoire pour corriger une présence sur une séance finalisée.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  -- 3. Obtenir l'inscription active
  SELECT id INTO v_enr_id
  FROM public.student_enrollments
  WHERE student_id = p_student_id
    AND class_id = v_session_class_id
    AND school_id = v_school_id
    AND status = 'active'
  LIMIT 1;

  IF v_enr_id IS NULL THEN
    RAISE EXCEPTION 'Élève non inscrit ou inscription inactive dans la classe de cette séance.';
  END IF;

  -- 4. Ancien enregistrement
  SELECT row_to_json(sa)::jsonb INTO v_old_rec
  FROM public.student_attendance sa
  WHERE sa.attendance_session_id = p_session_id AND sa.student_id = p_student_id;

  IF v_old_rec IS NOT NULL THEN
    v_old_status := v_old_rec->>'status';
    v_audit_action := 'attendance_updated';
  ELSE
    v_old_status := NULL;
    v_audit_action := 'attendance_created';
  END IF;

  -- 5. Upsert sécurisé
  INSERT INTO public.student_attendance (
    school_id,
    attendance_session_id,
    student_id,
    enrollment_id,
    status,
    arrival_time,
    justification,
    marked_by,
    updated_by,
    updated_at
  ) VALUES (
    v_school_id,
    p_session_id,
    p_student_id,
    v_enr_id,
    p_status,
    p_arrival_time,
    p_justification,
    v_uid,
    v_uid,
    now()
  )
  ON CONFLICT (attendance_session_id, student_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    arrival_time = EXCLUDED.arrival_time,
    justification = EXCLUDED.justification,
    updated_by = v_uid,
    updated_at = now();

  -- 6. Nouvel enregistrement
  SELECT row_to_json(sa)::jsonb INTO v_new_rec
  FROM public.student_attendance sa
  WHERE sa.attendance_session_id = p_session_id AND sa.student_id = p_student_id;

  -- 7. Audit log immuable (Action distinguée : attendance_created vs attendance_updated - Point 8)
  INSERT INTO public.attendance_audit_logs (
    school_id,
    attendance_session_id,
    student_attendance_id,
    actor_id,
    action,
    old_status,
    new_status,
    old_data,
    new_data,
    reason
  ) VALUES (
    v_school_id,
    p_session_id,
    (v_new_rec->>'id')::uuid,
    v_uid,
    v_audit_action,
    v_old_status,
    p_status,
    v_old_rec,
    v_new_rec,
    trim(p_reason)
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 9. NETTOYAGE EXPLICITE DE TOUTES LES ANCIENNES POLITIQUES
--------------------------------------------------------------------------------

-- NETTOYAGE ATTENDANCE_SESSIONS
DROP POLICY IF EXISTS "SuperAdmin sessions all" ON public.attendance_sessions;
DROP POLICY IF EXISTS "SchoolAdmin sessions all" ON public.attendance_sessions;
DROP POLICY IF EXISTS "SuperAdmin session read all" ON public.attendance_sessions;
DROP POLICY IF EXISTS "SuperAdmin session update all" ON public.attendance_sessions;
DROP POLICY IF EXISTS "SchoolAdmin session all" ON public.attendance_sessions;
DROP POLICY IF EXISTS "SuperAdmin sessions read/update" ON public.attendance_sessions;
DROP POLICY IF EXISTS "SchoolAdmin sessions select" ON public.attendance_sessions;
DROP POLICY IF EXISTS "SchoolAdmin sessions insert" ON public.attendance_sessions;
DROP POLICY IF EXISTS "SchoolAdmin sessions update" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Teacher session read assigned" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Teacher session insert assigned" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Teacher session update draft assigned" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Teacher sessions select assigned" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Teacher sessions insert assigned" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Teacher sessions update draft assigned" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Parent session read children" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Student session read self" ON public.attendance_sessions;
DROP POLICY IF EXISTS "User sessions read via helper" ON public.attendance_sessions;
DROP POLICY IF EXISTS "SuperAdmin sessions select" ON public.attendance_sessions;

-- NETTOYAGE STUDENT_ATTENDANCE
DROP POLICY IF EXISTS "SuperAdmin student_attendance all" ON public.student_attendance;
DROP POLICY IF EXISTS "SchoolAdmin student_attendance all" ON public.student_attendance;
DROP POLICY IF EXISTS "SuperAdmin student_attendance read all" ON public.student_attendance;
DROP POLICY IF EXISTS "SuperAdmin student_attendance update all" ON public.student_attendance;
DROP POLICY IF EXISTS "SuperAdmin student_attendance select" ON public.student_attendance;
DROP POLICY IF EXISTS "SchoolAdmin student_attendance select" ON public.student_attendance;
DROP POLICY IF EXISTS "SchoolAdmin student_attendance insert" ON public.student_attendance;
DROP POLICY IF EXISTS "SchoolAdmin student_attendance update" ON public.student_attendance;
DROP POLICY IF EXISTS "Teacher student_attendance read assigned" ON public.student_attendance;
DROP POLICY IF EXISTS "Teacher student_attendance insert assigned" ON public.student_attendance;
DROP POLICY IF EXISTS "Teacher student_attendance update assigned" ON public.student_attendance;
DROP POLICY IF EXISTS "Teacher student_attendance select assigned" ON public.student_attendance;
DROP POLICY IF EXISTS "Parent student_attendance read children" ON public.student_attendance;
DROP POLICY IF EXISTS "Parent student_attendance select children" ON public.student_attendance;
DROP POLICY IF EXISTS "Student student_attendance read self" ON public.student_attendance;
DROP POLICY IF EXISTS "Student student_attendance select self" ON public.student_attendance;

-- NETTOYAGE ATTENDANCE_AUDIT_LOGS
DROP POLICY IF EXISTS "SuperAdmin audit_logs read/insert" ON public.attendance_audit_logs;
DROP POLICY IF EXISTS "SchoolAdmin audit_logs read/insert" ON public.attendance_audit_logs;
DROP POLICY IF EXISTS "SuperAdmin audit_logs read" ON public.attendance_audit_logs;
DROP POLICY IF EXISTS "SchoolAdmin audit_logs read" ON public.attendance_audit_logs;

--------------------------------------------------------------------------------
-- 10. POLITIQUES RLS SEULEMENT LECTURE (SEULEMENT SELECT, AUCUN INSERT/UPDATE/DELETE DIRECT - Point 1)
--------------------------------------------------------------------------------
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_audit_logs ENABLE ROW LEVEL SECURITY;

-- A. POLITIQUES ATTENDANCE_SESSIONS (SEULEMENT SELECT)
CREATE POLICY "SuperAdmin sessions select"
ON public.attendance_sessions FOR SELECT
USING (public.is_super_admin());

CREATE POLICY "SchoolAdmin sessions select"
ON public.attendance_sessions FOR SELECT
USING (
  public.is_school_admin(school_id)
  AND school_id = public.get_auth_school_id()
);

CREATE POLICY "Teacher sessions select assigned"
ON public.attendance_sessions FOR SELECT
USING (
  public.get_auth_role() = 'teacher'
  AND school_id = public.get_auth_school_id()
  AND public.is_teacher_of_class(class_id)
);

CREATE POLICY "User sessions read via helper"
ON public.attendance_sessions FOR SELECT
USING (
  public.can_user_read_session(id)
);

-- B. POLITIQUES STUDENT_ATTENDANCE (SEULEMENT SELECT)
CREATE POLICY "SuperAdmin student_attendance select"
ON public.student_attendance FOR SELECT
USING (public.is_super_admin());

CREATE POLICY "SchoolAdmin student_attendance select"
ON public.student_attendance FOR SELECT
USING (
  public.is_school_admin(school_id)
  AND school_id = public.get_auth_school_id()
);

CREATE POLICY "Teacher student_attendance select assigned"
ON public.student_attendance FOR SELECT
USING (
  public.get_auth_role() = 'teacher'
  AND school_id = public.get_auth_school_id()
  AND public.can_user_read_session(attendance_session_id)
);

CREATE POLICY "Parent student_attendance select children"
ON public.student_attendance FOR SELECT
USING (
  public.get_auth_role() = 'parent'
  AND school_id = public.get_auth_school_id()
  AND public.is_parent_of_student(student_id)
);

CREATE POLICY "Student student_attendance select self"
ON public.student_attendance FOR SELECT
USING (
  public.get_auth_role() = 'student'
  AND school_id = public.get_auth_school_id()
  AND public.is_student_self(student_id)
);

-- C. POLITIQUES ATTENDANCE_AUDIT_LOGS (IMMUABLE : SEULEMENT SELECT)
CREATE POLICY "SuperAdmin audit_logs read"
ON public.attendance_audit_logs FOR SELECT
USING (public.is_super_admin());

CREATE POLICY "SchoolAdmin audit_logs read"
ON public.attendance_audit_logs FOR SELECT
USING (
  public.is_school_admin(school_id)
  AND school_id = public.get_auth_school_id()
);

--------------------------------------------------------------------------------
-- 11. RÉVOCATION DES PRIVILÈGES ET ATTRIBUTION RESTREINTE
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_attendance_session(uuid, uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_attendance_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_attendance_session(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_student_attendance(uuid, uuid, text, time, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_teacher_owner_of_attendance_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_user_read_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_user_write_attendance(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_attendance_session(uuid, uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_attendance_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_attendance_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_student_attendance(uuid, uuid, text, time, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_teacher_owner_of_attendance_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_user_read_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_user_write_attendance(uuid) TO authenticated;

COMMIT;
