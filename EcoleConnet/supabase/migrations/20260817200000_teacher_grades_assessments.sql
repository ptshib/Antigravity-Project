-- Migration Phase 2D.2 : Gestion Réelle et Sécurisée des Évaluations et Notes (School Assessments & Student Grades)
-- Fichier : supabase/migrations/20260817200000_teacher_grades_assessments.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. CREATION DE LA TABLE PUBLIC.SCHOOL_ASSESSMENTS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  term_id UUID REFERENCES public.school_terms(id) ON DELETE RESTRICT,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  assessment_type TEXT NOT NULL,
  assessment_date DATE NOT NULL,
  max_score NUMERIC NOT NULL,
  coefficient NUMERIC NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Contraintes nommées explicites
  CONSTRAINT chk_assessment_title_not_empty CHECK (length(trim(title)) > 0),
  CONSTRAINT chk_assessment_max_score_positive CHECK (max_score > 0),
  CONSTRAINT chk_assessment_coefficient_positive CHECK (coefficient > 0),
  CONSTRAINT chk_assessment_type_valid CHECK (assessment_type IN ('quiz', 'test', 'exam', 'homework', 'project', 'oral', 'practical', 'other')),
  CONSTRAINT chk_assessment_status_valid CHECK (status IN ('draft', 'published', 'closed', 'cancelled', 'reopened'))
);

-- Index d'optimisation pour school_assessments
CREATE INDEX IF NOT EXISTS idx_assessments_school_id ON public.school_assessments(school_id);
CREATE INDEX IF NOT EXISTS idx_assessments_teacher_id ON public.school_assessments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assessments_class_id ON public.school_assessments(class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_subject_id ON public.school_assessments(subject_id);
CREATE INDEX IF NOT EXISTS idx_assessments_academic_year_id ON public.school_assessments(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_assessments_term_id ON public.school_assessments(term_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status ON public.school_assessments(status);
CREATE INDEX IF NOT EXISTS idx_assessments_assessment_date ON public.school_assessments(assessment_date);

--------------------------------------------------------------------------------
-- 2. CREATION DE LA TABLE PUBLIC.STUDENT_GRADES
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL REFERENCES public.school_assessments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  enrollment_id UUID NOT NULL REFERENCES public.student_enrollments(id) ON DELETE RESTRICT,
  score NUMERIC,
  is_absent BOOLEAN NOT NULL DEFAULT false,
  is_excused BOOLEAN NOT NULL DEFAULT false,
  teacher_comment TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Contraintes d'unicité et cohérence de notation
  CONSTRAINT uq_student_grade_assessment_student UNIQUE (assessment_id, student_id),
  CONSTRAINT chk_grade_absence_score CHECK (
    (is_absent = true AND score IS NULL) OR
    (is_absent = false AND score IS NOT NULL AND score >= 0)
  ),
  CONSTRAINT chk_grade_excused_only_if_absent CHECK (
    is_excused = false OR is_absent = true
  )
);

-- Index d'optimisation pour student_grades
CREATE INDEX IF NOT EXISTS idx_student_grades_school_id ON public.student_grades(school_id);
CREATE INDEX IF NOT EXISTS idx_student_grades_assessment_id ON public.student_grades(assessment_id);
CREATE INDEX IF NOT EXISTS idx_student_grades_student_id ON public.student_grades(student_id);
CREATE INDEX IF NOT EXISTS idx_student_grades_enrollment_id ON public.student_grades(enrollment_id);

--------------------------------------------------------------------------------
-- 3. TRIGGERS D'INTEGRITE MULTI-ECOLES ET VERROUILLAGE DES CHAMPS
--------------------------------------------------------------------------------

-- A. Trigger d'intégrité sur school_assessments
CREATE OR REPLACE FUNCTION public.check_school_assessment_integrity()
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
  v_year_is_current BOOLEAN;
  v_sbj_school_id UUID;
  v_sbj_active BOOLEAN;
  v_term_school_id UUID;
  v_term_year_id UUID;
  v_has_active_assignment BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A1. Vérification Année Scolaire (appartient à l'école ET est l'année courante)
    SELECT ay.school_id, ay.is_current INTO v_year_school_id, v_year_is_current
    FROM public.academic_years ay
    WHERE ay.id = NEW.academic_year_id;

    IF v_year_school_id IS NULL OR v_year_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id;
    END IF;

    IF v_year_is_current IS NOT TRUE THEN
      RAISE EXCEPTION 'Accès refusé : L’année scolaire (%) n’est pas l’année scolaire courante de l’établissement.', NEW.academic_year_id;
    END IF;

    -- A2. Vérification Trimestre si renseigné
    IF NEW.term_id IS NOT NULL THEN
      SELECT st.school_id, st.academic_year_id INTO v_term_school_id, v_term_year_id
      FROM public.school_terms st
      WHERE st.id = NEW.term_id;

      IF v_term_school_id IS NULL OR v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : Le trimestre (%) n’appartient pas à la même école ou année scolaire.', NEW.term_id;
      END IF;
    END IF;

    -- A3. Vérification Classe
    SELECT c.school_id, c.academic_year_id INTO v_cls_school_id, v_cls_year_id
    FROM public.classes c
    WHERE c.id = NEW.class_id;

    IF v_cls_school_id IS NULL OR v_cls_school_id <> NEW.school_id OR v_cls_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La classe (%) n’appartient pas à la même école ou année scolaire.', NEW.class_id;
    END IF;

    -- A4. Vérification Matière
    SELECT sb.school_id, sb.is_active INTO v_sbj_school_id, v_sbj_active
    FROM public.subjects sb
    WHERE sb.id = NEW.subject_id;

    IF v_sbj_school_id IS NULL OR v_sbj_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La matière (%) n’appartient pas à cet établissement.', NEW.subject_id;
    END IF;

    IF v_sbj_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Accès refusé : La matière sélectionnée est inactive.';
    END IF;

    -- A5. Vérification Enseignant
    SELECT t.school_id, t.employment_status, t.account_status
    INTO v_tch_school_id, v_tch_emp_status, v_tch_acc_status
    FROM public.teachers t
    WHERE t.id = NEW.teacher_id;

    IF v_tch_school_id IS NULL OR v_tch_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : L’enseignant (%) n’appartient pas à cet établissement.', NEW.teacher_id;
    END IF;

    IF v_tch_emp_status <> 'active' OR v_tch_acc_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Le dossier de l’enseignant n’est pas actif.';
    END IF;

    -- A6. Vérification de l'affectation active exacte
    SELECT EXISTS (
      SELECT 1 FROM public.teacher_class_assignments tca
      WHERE tca.school_id = NEW.school_id
        AND tca.teacher_id = NEW.teacher_id
        AND tca.class_id = NEW.class_id
        AND tca.subject_id = NEW.subject_id
        AND tca.academic_year_id = NEW.academic_year_id
        AND tca.is_active = true
    ) INTO v_has_active_assignment;

    IF NOT v_has_active_assignment THEN
      RAISE EXCEPTION 'Accès refusé : Aucune affectation active trouvée pour cet enseignant sur cette classe et matière.';
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Verrouillage strict des champs immuables avec IS DISTINCT FROM
    IF OLD.school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'Modification interdite : L’établissement (school_id) est immuable.';
    END IF;

    IF OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
      RAISE EXCEPTION 'Modification interdite : L’année scolaire (academic_year_id) est immuable.';
    END IF;

    IF OLD.class_id IS DISTINCT FROM NEW.class_id THEN
      RAISE EXCEPTION 'Modification interdite : La classe (class_id) est immuable.';
    END IF;

    IF OLD.subject_id IS DISTINCT FROM NEW.subject_id THEN
      RAISE EXCEPTION 'Modification interdite : La matière (subject_id) est immuable.';
    END IF;

    IF OLD.teacher_id IS DISTINCT FROM NEW.teacher_id THEN
      RAISE EXCEPTION 'Modification interdite : L’enseignant responsable (teacher_id) est immuable.';
    END IF;

    IF OLD.created_by IS DISTINCT FROM NEW.created_by THEN
      RAISE EXCEPTION 'Modification interdite : Le créateur de l’évaluation (created_by) est immuable.';
    END IF;

    -- Si le trimestre change, vérifier sa validité
    IF NEW.term_id IS DISTINCT FROM OLD.term_id AND NEW.term_id IS NOT NULL THEN
      SELECT st.school_id, st.academic_year_id INTO v_term_school_id, v_term_year_id
      FROM public.school_terms st
      WHERE st.id = NEW.term_id;

      IF v_term_school_id IS NULL OR v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : Le nouveau trimestre n’appartient pas à la même école/année.';
      END IF;
    END IF;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_school_assessment_integrity ON public.school_assessments;
CREATE TRIGGER trg_school_assessment_integrity
  BEFORE INSERT OR UPDATE ON public.school_assessments
  FOR EACH ROW EXECUTE FUNCTION public.check_school_assessment_integrity();

-- B. Trigger d'intégrité sur student_grades
CREATE OR REPLACE FUNCTION public.check_student_grade_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asmt_school_id UUID;
  v_asmt_class_id UUID;
  v_asmt_year_id UUID;
  v_asmt_max_score NUMERIC;
  v_enr_school_id UUID;
  v_enr_student_id UUID;
  v_enr_class_id UUID;
  v_enr_year_id UUID;
  v_enr_status TEXT;
  v_std_school_id UUID;
BEGIN
  -- Récupération et contrôle de l'évaluation parente
  SELECT sa.school_id, sa.class_id, sa.academic_year_id, sa.max_score
  INTO v_asmt_school_id, v_asmt_class_id, v_asmt_year_id, v_asmt_max_score
  FROM public.school_assessments sa
  WHERE sa.id = NEW.assessment_id;

  IF v_asmt_school_id IS NULL OR v_asmt_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’évaluation (%) n’appartient pas à l’établissement (%).', NEW.assessment_id, NEW.school_id;
  END IF;

  -- Vérification du dossier élève
  SELECT st.school_id INTO v_std_school_id
  FROM public.students st
  WHERE st.id = NEW.student_id;

  IF v_std_school_id IS NULL OR v_std_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’élève (%) n’appartient pas à cet établissement.', NEW.student_id;
  END IF;

  -- Vérification de l'inscription active
  SELECT se.school_id, se.student_id, se.class_id, se.academic_year_id, se.status
  INTO v_enr_school_id, v_enr_student_id, v_enr_class_id, v_enr_year_id, v_enr_status
  FROM public.student_enrollments se
  WHERE se.id = NEW.enrollment_id;

  IF v_enr_school_id IS NULL OR v_enr_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’inscription (%) n’appartient pas à cet établissement.', NEW.enrollment_id;
  END IF;

  IF v_enr_student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'Incohérence : L’inscription n’appartient pas à l’élève spécifié.';
  END IF;

  IF v_enr_class_id <> v_asmt_class_id OR v_enr_year_id <> v_asmt_year_id THEN
    RAISE EXCEPTION 'Incohérence : L’inscription ne correspond pas à la classe ou à l’année scolaire de l’évaluation.';
  END IF;

  IF v_enr_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’inscription de l’élève n’est pas active (statut: %).', v_enr_status;
  END IF;

  -- Cohérence notes / absences
  IF NEW.is_absent IS TRUE THEN
    IF NEW.score IS NOT NULL THEN
      RAISE EXCEPTION 'Note invalide : Un élève absent ne peut pas avoir de note.';
    END IF;
  ELSE
    IF NEW.is_excused IS TRUE THEN
      RAISE EXCEPTION 'Absence invalide : Un élève présent ne peut pas être marqué comme excusé.';
    END IF;
    IF NEW.score IS NOT NULL AND (NEW.score < 0 OR NEW.score > v_asmt_max_score) THEN
      RAISE EXCEPTION 'Note invalide : La note attribuée (%) doit être comprise entre 0 et le barème maximal (%).', NEW.score, v_asmt_max_score;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Verrouillage strict des champs immuables par IS DISTINCT FROM
    IF OLD.school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'Modification interdite : L’établissement (school_id) est immuable.';
    END IF;
    IF OLD.assessment_id IS DISTINCT FROM NEW.assessment_id THEN
      RAISE EXCEPTION 'Modification interdite : L’identifiant d’évaluation est immuable.';
    END IF;
    IF OLD.student_id IS DISTINCT FROM NEW.student_id THEN
      RAISE EXCEPTION 'Modification interdite : L’identifiant élève est immuable.';
    END IF;
    IF OLD.enrollment_id IS DISTINCT FROM NEW.enrollment_id THEN
      RAISE EXCEPTION 'Modification interdite : L’inscription est immuable.';
    END IF;
    IF OLD.created_by IS DISTINCT FROM NEW.created_by THEN
      RAISE EXCEPTION 'Modification interdite : Le créateur d’origine est immuable.';
    END IF;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_grade_integrity ON public.student_grades;
CREATE TRIGGER trg_student_grade_integrity
  BEFORE INSERT OR UPDATE ON public.student_grades
  FOR EACH ROW EXECUTE FUNCTION public.check_student_grade_integrity();

--------------------------------------------------------------------------------
-- 4. RPCS D'ECRITURE ET DE GESTION DU CYCLE DE VIE
--------------------------------------------------------------------------------

-- A. RPC : Créer une évaluation (create_teacher_assessment) — Réservée STRICTEMENT au rôle 'teacher' actif
CREATE OR REPLACE FUNCTION public.create_teacher_assessment(
  p_class_id UUID,
  p_subject_id UUID,
  p_term_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_assessment_type TEXT,
  p_assessment_date DATE,
  p_max_score NUMERIC,
  p_coefficient NUMERIC DEFAULT 1,
  p_publish_now BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_is_active BOOLEAN;
  v_school_status TEXT;
  v_teacher_id UUID;
  v_teacher_acc TEXT;
  v_teacher_emp TEXT;
  v_year_id UUID;
  v_year_starts DATE;
  v_year_ends DATE;
  v_term_starts DATE;
  v_term_ends DATE;
  v_has_assign BOOLEAN;
  v_subject_active BOOLEAN;
  v_assessment_id UUID;
  v_status TEXT := 'draft';
  v_published_at TIMESTAMPTZ := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_role, v_school_id, v_is_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  -- Création réservée exclusivement au rôle teacher
  IF v_role <> 'teacher' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un enseignant actif peut initier une évaluation pédagogique.';
  END IF;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil enseignant.';
  END IF;

  SELECT sc.status INTO v_school_status
  FROM public.schools sc
  WHERE sc.id = v_school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
  END IF;

  -- Vérification stricte du dossier enseignant
  SELECT t.id, t.account_status, t.employment_status
  INTO v_teacher_id, v_teacher_acc, v_teacher_emp
  FROM public.teachers t
  WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

  IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
  END IF;

  -- Interdiction formelle de publier directement à la création
  IF p_publish_now IS TRUE THEN
    RAISE EXCEPTION 'Création directe en statut publié interdite : Une évaluation doit obligatoirement être créée en brouillon et ses notes saisies avant publication.';
  END IF;

  -- Validation des paramètres
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le titre ne peut pas être vide.';
  END IF;

  IF p_max_score IS NULL OR p_max_score <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le barème maximal doit être supérieur à zéro.';
  END IF;

  IF p_coefficient IS NOT NULL AND p_coefficient <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le coefficient doit être supérieur à zéro.';
  END IF;

  IF p_assessment_type NOT IN ('quiz', 'test', 'exam', 'homework', 'project', 'oral', 'practical', 'other') THEN
    RAISE EXCEPTION 'Paramètre invalide : Type d’évaluation non reconnu.';
  END IF;

  -- Validation de la classe et de l'année scolaire
  SELECT c.academic_year_id INTO v_year_id
  FROM public.classes c
  WHERE c.id = p_class_id AND c.school_id = v_school_id;

  IF v_year_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable dans votre établissement.';
  END IF;

  -- Validation de la matière
  SELECT sb.is_active INTO v_subject_active
  FROM public.subjects sb
  WHERE sb.id = p_subject_id AND sb.school_id = v_school_id;

  IF v_subject_active IS NULL THEN
    RAISE EXCEPTION 'Matière introuvable dans votre établissement.';
  END IF;

  IF v_subject_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : La matière sélectionnée est inactive.';
  END IF;

  SELECT ay.starts_on, ay.ends_on INTO v_year_starts, v_year_ends
  FROM public.academic_years ay
  WHERE ay.id = v_year_id AND ay.school_id = v_school_id;

  -- Validation des bornes temporelles de l'année scolaire
  IF v_year_starts IS NOT NULL AND p_assessment_date < v_year_starts THEN
    RAISE EXCEPTION 'Date invalide : La date d’évaluation (%) est antérieure au début de l’année scolaire (%).', p_assessment_date, v_year_starts;
  END IF;
  IF v_year_ends IS NOT NULL AND p_assessment_date > v_year_ends THEN
    RAISE EXCEPTION 'Date invalide : La date d’évaluation (%) est postérieure à la fin de l’année scolaire (%).', p_assessment_date, v_year_ends;
  END IF;

  -- Validation du trimestre si spécifié
  IF p_term_id IS NOT NULL THEN
    SELECT st.starts_on, st.ends_on INTO v_term_starts, v_term_ends
    FROM public.school_terms st
    WHERE st.id = p_term_id AND st.school_id = v_school_id AND st.academic_year_id = v_year_id;

    IF v_term_starts IS NULL AND v_term_ends IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.school_terms WHERE id = p_term_id AND school_id = v_school_id AND academic_year_id = v_year_id
    ) THEN
      RAISE EXCEPTION 'Trimestre introuvable ou incohérent avec l’année scolaire.';
    END IF;

    IF v_term_starts IS NOT NULL AND p_assessment_date < v_term_starts THEN
      RAISE EXCEPTION 'Date invalide : La date d’évaluation (%) est antérieure au début du trimestre (%).', p_assessment_date, v_term_starts;
    END IF;
    IF v_term_ends IS NOT NULL AND p_assessment_date > v_term_ends THEN
      RAISE EXCEPTION 'Date invalide : La date d’évaluation (%) est postérieure à la fin du trimestre (%).', p_assessment_date, v_term_ends;
    END IF;
  END IF;

  -- Contrôle d'affectation active exacte
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_class_assignments tca
    WHERE tca.school_id = v_school_id
      AND tca.teacher_id = v_teacher_id
      AND tca.class_id = p_class_id
      AND tca.subject_id = p_subject_id
      AND tca.academic_year_id = v_year_id
      AND tca.is_active = true
  ) INTO v_has_assign;

  IF NOT v_has_assign THEN
    RAISE EXCEPTION 'Accès refusé : Vous n’avez aucune affectation active pour cette matière dans cette classe.';
  END IF;

  IF p_publish_now IS TRUE THEN
    v_status := 'published';
    v_published_at := now();
  END IF;

  -- Insertion de l'évaluation
  INSERT INTO public.school_assessments (
    school_id,
    academic_year_id,
    term_id,
    class_id,
    subject_id,
    teacher_id,
    title,
    description,
    assessment_type,
    assessment_date,
    max_score,
    coefficient,
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
    p_description,
    p_assessment_type,
    p_assessment_date,
    p_max_score,
    COALESCE(p_coefficient, 1),
    v_status,
    v_published_at,
    v_uid
  ) RETURNING id INTO v_assessment_id;

  -- Journalisation d'audit
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_school_id,
    v_uid,
    'assessment_created',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', v_assessment_id,
      'assessment_id', v_assessment_id,
      'title', trim(p_title),
      'class_id', p_class_id,
      'subject_id', p_subject_id,
      'teacher_id', v_teacher_id,
      'status', v_status,
      'max_score', p_max_score,
      'coefficient', COALESCE(p_coefficient, 1)
    )
  );

  RETURN v_assessment_id;
END;
$$;

-- B. RPC : Mettre à jour une évaluation (update_teacher_assessment)
CREATE OR REPLACE FUNCTION public.update_teacher_assessment(
  p_assessment_id UUID,
  p_term_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_assessment_type TEXT,
  p_assessment_date DATE,
  p_max_score NUMERIC,
  p_coefficient NUMERIC,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_is_active BOOLEAN;
  v_school_status TEXT;
  v_teacher_id UUID;
  v_teacher_acc TEXT;
  v_teacher_emp TEXT;
  v_asmt RECORD;
  v_has_excessive_scores BOOLEAN;
  v_year_starts DATE;
  v_year_ends DATE;
  v_term_starts DATE;
  v_term_ends DATE;
  v_old_data JSONB;
  v_new_data JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_role, v_school_id, v_is_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('teacher', 'school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  -- Vérification établissement pour teacher et school_admin
  IF v_role IN ('teacher', 'school_admin') THEN
    IF v_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  -- Verrouillage de la ligne d'évaluation
  SELECT * INTO v_asmt
  FROM public.school_assessments sa
  WHERE sa.id = p_assessment_id
  FOR UPDATE;

  IF v_asmt.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  IF v_role IN ('teacher', 'school_admin') AND v_asmt.school_id <> v_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Évaluation d’un autre établissement.';
  END IF;

  IF v_asmt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Opération interdite : Une évaluation annulée ne peut plus être modifiée.';
  END IF;

  -- Contrôle des permissions selon le rôle
  IF v_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_teacher_id, v_teacher_acc, v_teacher_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

    IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
    END IF;

    IF v_asmt.teacher_id <> v_teacher_id THEN
      RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas l’enseignant titulaire de cette évaluation.';
    END IF;

    IF v_asmt.status NOT IN ('draft', 'reopened') THEN
      RAISE EXCEPTION 'Accès refusé : Un enseignant ne peut modifier directement que les évaluations en brouillon ou réouvertes.';
    END IF;

  ELSIF v_role = 'school_admin' THEN
    IF v_asmt.status IN ('published', 'closed', 'reopened') AND (p_reason IS NULL OR length(trim(p_reason)) < 5) THEN
      RAISE EXCEPTION 'Motif obligatoire : Toute modification administrative exige une justification détaillée (min 5 caractères).';
    END IF;

  ELSIF v_role = 'super_admin' THEN
    IF v_asmt.status IN ('published', 'closed', 'reopened') AND (p_reason IS NULL OR length(trim(p_reason)) < 5) THEN
      RAISE EXCEPTION 'Motif obligatoire : Toute modification super-admin exige une justification détaillée (min 5 caractères).';
    END IF;
  END IF;

  -- Validation des champs
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le titre ne peut pas être vide.';
  END IF;

  IF p_max_score IS NULL OR p_max_score <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le barème maximal doit être supérieur à zéro.';
  END IF;

  IF p_coefficient IS NOT NULL AND p_coefficient <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le coefficient doit être supérieur à zéro.';
  END IF;

  IF p_assessment_type NOT IN ('quiz', 'test', 'exam', 'homework', 'project', 'oral', 'practical', 'other') THEN
    RAISE EXCEPTION 'Paramètre invalide : Type d’évaluation non reconnu.';
  END IF;

  -- Contrôle du nouveau barème max_score par rapport aux notes déjà attribuées
  IF p_max_score < v_asmt.max_score THEN
    SELECT EXISTS (
      SELECT 1 FROM public.student_grades sg
      WHERE sg.assessment_id = p_assessment_id
        AND sg.score > p_max_score
    ) INTO v_has_excessive_scores;

    IF v_has_excessive_scores THEN
      RAISE EXCEPTION 'Barème invalide : Des notes déjà attribuées sont supérieures au nouveau barème proposé (%).', p_max_score;
    END IF;
  END IF;

  -- Validation du trimestre si fourni
  IF p_term_id IS NOT NULL THEN
    SELECT st.starts_on, st.ends_on INTO v_term_starts, v_term_ends
    FROM public.school_terms st
    WHERE st.id = p_term_id AND st.school_id = v_asmt.school_id AND st.academic_year_id = v_asmt.academic_year_id;

    IF v_term_starts IS NULL AND v_term_ends IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.school_terms WHERE id = p_term_id AND school_id = v_asmt.school_id AND academic_year_id = v_asmt.academic_year_id
    ) THEN
      RAISE EXCEPTION 'Incohérence : Le trimestre spécifié n’appartient pas à la même école et année scolaire.';
    END IF;

    IF v_term_starts IS NOT NULL AND p_assessment_date < v_term_starts THEN
      RAISE EXCEPTION 'Date invalide : La date d’évaluation (%) est antérieure au début du trimestre (%).', p_assessment_date, v_term_starts;
    END IF;
    IF v_term_ends IS NOT NULL AND p_assessment_date > v_term_ends THEN
      RAISE EXCEPTION 'Date invalide : La date d’évaluation (%) est postérieure à la fin du trimestre (%).', p_assessment_date, v_term_ends;
    END IF;
  END IF;

  -- Validation des dates de l'année scolaire
  SELECT ay.starts_on, ay.ends_on INTO v_year_starts, v_year_ends
  FROM public.academic_years ay
  WHERE ay.id = v_asmt.academic_year_id AND ay.school_id = v_asmt.school_id;

  IF v_year_starts IS NOT NULL AND p_assessment_date < v_year_starts THEN
    RAISE EXCEPTION 'Date invalide : La date d’évaluation (%) est antérieure au début de l’année scolaire (%).', p_assessment_date, v_year_starts;
  END IF;
  IF v_year_ends IS NOT NULL AND p_assessment_date > v_year_ends THEN
    RAISE EXCEPTION 'Date invalide : La date d’évaluation (%) est postérieure à la fin de l’année scolaire (%).', p_assessment_date, v_year_ends;
  END IF;

  v_old_data := jsonb_build_object(
    'id', v_asmt.id,
    'school_id', v_asmt.school_id,
    'academic_year_id', v_asmt.academic_year_id,
    'term_id', v_asmt.term_id,
    'class_id', v_asmt.class_id,
    'subject_id', v_asmt.subject_id,
    'teacher_id', v_asmt.teacher_id,
    'title', v_asmt.title,
    'description', v_asmt.description,
    'assessment_type', v_asmt.assessment_type,
    'assessment_date', v_asmt.assessment_date,
    'max_score', v_asmt.max_score,
    'coefficient', v_asmt.coefficient,
    'status', v_asmt.status,
    'published_at', v_asmt.published_at,
    'closed_at', v_asmt.closed_at,
    'created_by', v_asmt.created_by,
    'created_at', v_asmt.created_at,
    'updated_at', v_asmt.updated_at
  );

  v_new_data := jsonb_build_object(
    'id', v_asmt.id,
    'school_id', v_asmt.school_id,
    'academic_year_id', v_asmt.academic_year_id,
    'term_id', p_term_id,
    'class_id', v_asmt.class_id,
    'subject_id', v_asmt.subject_id,
    'teacher_id', v_asmt.teacher_id,
    'title', trim(p_title),
    'description', p_description,
    'assessment_type', p_assessment_type,
    'assessment_date', p_assessment_date,
    'max_score', p_max_score,
    'coefficient', COALESCE(p_coefficient, 1),
    'status', v_asmt.status
  );

  UPDATE public.school_assessments sa
  SET
    term_id = p_term_id,
    title = trim(p_title),
    description = p_description,
    assessment_type = p_assessment_type,
    assessment_date = p_assessment_date,
    max_score = p_max_score,
    coefficient = COALESCE(p_coefficient, 1)
  WHERE sa.id = p_assessment_id;

  -- Audit Log exhaustif
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_asmt.school_id,
    v_uid,
    'assessment_updated',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', p_assessment_id,
      'assessment_id', p_assessment_id,
      'old_data', v_old_data,
      'new_data', v_new_data,
      'old_status', v_asmt.status,
      'new_status', v_asmt.status,
      'reason', p_reason,
      'title', trim(p_title),
      'description', p_description,
      'assessment_type', p_assessment_type,
      'assessment_date', p_assessment_date,
      'max_score', p_max_score,
      'coefficient', COALESCE(p_coefficient, 1),
      'term_id', p_term_id
    )
  );

  RETURN true;
END;
$$;

-- C. RPC : Sauvegarde des notes du carnet (save_student_grades)
CREATE OR REPLACE FUNCTION public.save_student_grades(
  p_assessment_id UUID,
  p_grades JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_is_active BOOLEAN;
  v_school_status TEXT;
  v_teacher_id UUID;
  v_teacher_acc TEXT;
  v_teacher_emp TEXT;
  v_asmt RECORD;
  v_grade_item JSONB;
  v_student_id UUID;
  v_enrollment_id UUID;
  v_score NUMERIC;
  v_is_absent BOOLEAN;
  v_is_excused BOOLEAN;
  v_comment TEXT;
  v_seen_student_ids UUID[] := '{}';
  v_saved_count INTEGER := 0;
  v_corrected_count INTEGER := 0;
  v_existing_grade RECORD;
  v_enr_check RECORD;
  v_grade_id UUID;
  v_old_grade_data JSONB;
  v_new_grade_data JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  IF p_grades IS NULL OR jsonb_typeof(p_grades) <> 'array' OR jsonb_array_length(p_grades) = 0 THEN
    RAISE EXCEPTION 'Payload invalide : Le paramètre p_grades doit être un tableau JSONB non vide.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_role, v_school_id, v_is_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('teacher', 'school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé à saisir des notes.';
  END IF;

  -- Vérification établissement pour teacher et school_admin
  IF v_role IN ('teacher', 'school_admin') THEN
    IF v_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  -- Verrouillage de l'évaluation parente
  SELECT * INTO v_asmt
  FROM public.school_assessments sa
  WHERE sa.id = p_assessment_id
  FOR UPDATE;

  IF v_asmt.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  IF v_role IN ('teacher', 'school_admin') AND v_asmt.school_id <> v_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Évaluation d’un autre établissement.';
  END IF;

  IF v_asmt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Opération interdite : L’évaluation est annulée.';
  END IF;

  IF v_asmt.status = 'closed' THEN
    RAISE EXCEPTION 'Opération interdite : L’évaluation est clôturée. Demandez une réouverture préalable à l’administration.';
  END IF;

  -- Contrôle des droits d'écriture sur les notes
  IF v_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_teacher_id, v_teacher_acc, v_teacher_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

    IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
    END IF;

    IF v_asmt.teacher_id <> v_teacher_id THEN
      RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas l’enseignant titulaire de cette évaluation.';
    END IF;

    IF v_asmt.status NOT IN ('draft', 'reopened') THEN
      RAISE EXCEPTION 'Accès refusé : L’évaluation est publiée. Une réouverture administrative est requise pour modifier les notes.';
    END IF;

  ELSIF v_role = 'school_admin' THEN
    IF v_asmt.status = 'published' AND (p_reason IS NULL OR length(trim(p_reason)) < 5) THEN
      RAISE EXCEPTION 'Motif obligatoire : Toute rectification administrative sur une évaluation publiée exige une justification traçable (min 5 caractères).';
    END IF;

  ELSIF v_role = 'super_admin' THEN
    IF v_asmt.status = 'published' AND (p_reason IS NULL OR length(trim(p_reason)) < 5) THEN
      RAISE EXCEPTION 'Motif obligatoire : Toute rectification super-admin sur une évaluation publiée exige une justification traçable (min 5 caractères).';
    END IF;
  END IF;

  -- Boucle de traitement et verrouillage individuel des notes
  FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_grades)
  LOOP
    IF v_grade_item IS NULL OR jsonb_typeof(v_grade_item) <> 'object' THEN
      RAISE EXCEPTION 'Payload invalide : Chaque élément de notation doit être un objet JSON valide.';
    END IF;

    BEGIN
      v_student_id := (v_grade_item->>'student_id')::UUID;
      v_enrollment_id := (v_grade_item->>'enrollment_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Identifiant invalide : student_id ou enrollment_id n’est pas un UUID valide.';
    END;

    IF v_student_id IS NULL OR v_enrollment_id IS NULL THEN
      RAISE EXCEPTION 'Ligne de note invalide : student_id et enrollment_id sont obligatoires.';
    END IF;

    -- Détection de doublon d'élève dans le même lot
    IF v_student_id = ANY(v_seen_student_ids) THEN
      RAISE EXCEPTION 'Payload invalide : Doublon détecté pour l’élève (%) dans le même lot de notation.', v_student_id;
    END IF;
    v_seen_student_ids := array_append(v_seen_student_ids, v_student_id);

    BEGIN
      v_score := CASE 
        WHEN (v_grade_item->>'score') IS NOT NULL AND trim(v_grade_item->>'score') <> '' 
        THEN (v_grade_item->>'score')::NUMERIC 
        ELSE NULL 
      END;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Note invalide : Le score fourni n’est pas une valeur numérique valide pour l’élève (%).', v_student_id;
    END;

    BEGIN
      v_is_absent := COALESCE((v_grade_item->>'is_absent')::BOOLEAN, false);
      v_is_excused := COALESCE((v_grade_item->>'is_excused')::BOOLEAN, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Paramètre invalide : is_absent ou is_excused doit être un booléen pour l’élève (%).', v_student_id;
    END;

    v_comment := v_grade_item->>'teacher_comment';

    -- Vérification stricte de l'inscription active dans la classe et l'année exactes de l'évaluation
    SELECT se.id INTO v_enr_check
    FROM public.student_enrollments se
    JOIN public.students st ON st.id = se.student_id
    WHERE se.id = v_enrollment_id
      AND se.student_id = v_student_id
      AND se.class_id = v_asmt.class_id
      AND se.academic_year_id = v_asmt.academic_year_id
      AND se.school_id = v_asmt.school_id
      AND st.school_id = v_asmt.school_id
      AND se.status = 'active';

    IF v_enr_check.id IS NULL THEN
      RAISE EXCEPTION 'Incohérence : L’élève (%) ne possède pas d’inscription active dans la classe/année de l’évaluation.', v_student_id;
    END IF;

    -- Validation de cohérence absence / note
    IF v_is_absent IS TRUE THEN
      v_score := NULL;
    ELSE
      v_is_excused := false;
      IF v_score IS NULL THEN
        -- Non noté : continuer
        CONTINUE;
      END IF;
      IF v_score < 0 OR v_score > v_asmt.max_score THEN
        RAISE EXCEPTION 'Note hors barème pour l’élève (%) : % (barème: 0-%).', v_student_id, v_score, v_asmt.max_score;
      END IF;
    END IF;

    -- Verrouillage de la note existante si présente
    SELECT * INTO v_existing_grade
    FROM public.student_grades sg
    WHERE sg.assessment_id = p_assessment_id AND sg.student_id = v_student_id
    FOR UPDATE;

    IF v_existing_grade.id IS NOT NULL THEN
      v_grade_id := v_existing_grade.id;
      IF v_existing_grade.score IS DISTINCT FROM v_score 
         OR v_existing_grade.is_absent IS DISTINCT FROM v_is_absent
         OR v_existing_grade.is_excused IS DISTINCT FROM v_is_excused
         OR v_existing_grade.teacher_comment IS DISTINCT FROM v_comment THEN
        v_corrected_count := v_corrected_count + 1;

        v_old_grade_data := jsonb_build_object(
          'id', v_existing_grade.id,
          'school_id', v_existing_grade.school_id,
          'assessment_id', v_existing_grade.assessment_id,
          'student_id', v_existing_grade.student_id,
          'enrollment_id', v_existing_grade.enrollment_id,
          'score', v_existing_grade.score,
          'is_absent', v_existing_grade.is_absent,
          'is_excused', v_existing_grade.is_excused,
          'teacher_comment', v_existing_grade.teacher_comment,
          'created_by', v_existing_grade.created_by,
          'updated_by', v_existing_grade.updated_by,
          'created_at', v_existing_grade.created_at,
          'updated_at', v_existing_grade.updated_at
        );

        v_new_grade_data := jsonb_build_object(
          'id', v_existing_grade.id,
          'school_id', v_asmt.school_id,
          'assessment_id', p_assessment_id,
          'student_id', v_student_id,
          'enrollment_id', v_enrollment_id,
          'score', v_score,
          'is_absent', v_is_absent,
          'is_excused', v_is_excused,
          'teacher_comment', v_comment,
          'updated_by', v_uid
        );

        -- Journal d'audit détaillé par note modifiée
        INSERT INTO public.school_audit_logs (
          school_id,
          actor_id,
          action,
          details
        ) VALUES (
          v_asmt.school_id,
          v_uid,
          'student_grade_updated',
          jsonb_build_object(
            'entity_type', 'student_grade',
            'entity_id', v_grade_id,
            'grade_id', v_grade_id,
            'assessment_id', p_assessment_id,
            'student_id', v_student_id,
            'enrollment_id', v_enrollment_id,
            'old_data', v_old_grade_data,
            'new_data', v_new_grade_data,
            'old_score', v_existing_grade.score,
            'new_score', v_score,
            'is_absent', v_is_absent,
            'is_excused', v_is_excused,
            'teacher_comment', v_comment,
            'assessment_status', v_asmt.status,
            'reason', p_reason
          )
        );
      END IF;

      UPDATE public.student_grades sg
      SET
        score = v_score,
        is_absent = v_is_absent,
        is_excused = v_is_excused,
        teacher_comment = v_comment,
        updated_by = v_uid
      WHERE sg.id = v_grade_id;
    ELSE
      INSERT INTO public.student_grades (
        school_id,
        assessment_id,
        student_id,
        enrollment_id,
        score,
        is_absent,
        is_excused,
        teacher_comment,
        created_by,
        updated_by
      ) VALUES (
        v_asmt.school_id,
        p_assessment_id,
        v_student_id,
        v_enrollment_id,
        v_score,
        v_is_absent,
        v_is_excused,
        v_comment,
        v_uid,
        v_uid
      ) RETURNING id INTO v_grade_id;

      v_new_grade_data := jsonb_build_object(
        'id', v_grade_id,
        'school_id', v_asmt.school_id,
        'assessment_id', p_assessment_id,
        'student_id', v_student_id,
        'enrollment_id', v_enrollment_id,
        'score', v_score,
        'is_absent', v_is_absent,
        'is_excused', v_is_excused,
        'teacher_comment', v_comment,
        'created_by', v_uid,
        'updated_by', v_uid
      );

      INSERT INTO public.school_audit_logs (
        school_id,
        actor_id,
        action,
        details
      ) VALUES (
        v_asmt.school_id,
        v_uid,
        'student_grade_created',
        jsonb_build_object(
          'entity_type', 'student_grade',
          'entity_id', v_grade_id,
          'grade_id', v_grade_id,
          'assessment_id', p_assessment_id,
          'student_id', v_student_id,
          'enrollment_id', v_enrollment_id,
          'old_data', NULL,
          'new_data', v_new_grade_data,
          'old_score', NULL,
          'new_score', v_score,
          'is_absent', v_is_absent,
          'is_excused', v_is_excused,
          'teacher_comment', v_comment,
          'assessment_status', v_asmt.status,
          'reason', p_reason
        )
      );
    END IF;

    v_saved_count := v_saved_count + 1;
  END LOOP;

  -- Journal global de sauvegarde
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_asmt.school_id,
    v_uid,
    'grades_saved',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', p_assessment_id,
      'assessment_id', p_assessment_id,
      'saved_count', v_saved_count,
      'corrected_count', v_corrected_count,
      'assessment_status', v_asmt.status,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'saved_count', v_saved_count,
    'corrected_count', v_corrected_count
  );
END;
$$;

-- D. RPC : Publier une évaluation (publish_teacher_assessment)
-- Transitions autorisées : draft -> published, reopened -> published
CREATE OR REPLACE FUNCTION public.publish_teacher_assessment(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_is_active BOOLEAN;
  v_school_status TEXT;
  v_teacher_id UUID;
  v_teacher_acc TEXT;
  v_teacher_emp TEXT;
  v_asmt RECORD;
  v_active_students_count INTEGER := 0;
  v_unprocessed_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_role, v_school_id, v_is_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('teacher', 'school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  -- Vérification établissement pour teacher et school_admin
  IF v_role IN ('teacher', 'school_admin') THEN
    IF v_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  SELECT * INTO v_asmt
  FROM public.school_assessments sa
  WHERE sa.id = p_assessment_id
  FOR UPDATE;

  IF v_asmt.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  IF v_role IN ('teacher', 'school_admin') AND v_asmt.school_id <> v_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Évaluation d’un autre établissement.';
  END IF;

  -- Machine d'états stricte : Seuls draft et reopened peuvent être publiés
  IF v_asmt.status = 'published' THEN
    RAISE EXCEPTION 'Transition invalide : L’évaluation est déjà publiée.';
  END IF;
  IF v_asmt.status = 'closed' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation clôturée ne peut pas être publiée directement. Réouverture requise.';
  END IF;
  IF v_asmt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation annulée ne peut pas être publiée.';
  END IF;
  IF v_asmt.status NOT IN ('draft', 'reopened') THEN
    RAISE EXCEPTION 'Transition invalide : Statut actuel incompatible avec la publication.';
  END IF;

  -- Contrôle des droits enseignant
  IF v_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_teacher_id, v_teacher_acc, v_teacher_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

    IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
    END IF;

    IF v_asmt.teacher_id <> v_teacher_id THEN
      RAISE EXCEPTION 'Accès refusé : Seul l’enseignant titulaire actif peut publier cette évaluation.';
    END IF;
  END IF;

  -- 1. Contrôle : Au moins une inscription active doit exister dans la classe
  SELECT COUNT(*) INTO v_active_students_count
  FROM public.student_enrollments se
  WHERE se.school_id = v_asmt.school_id
    AND se.class_id = v_asmt.class_id
    AND se.academic_year_id = v_asmt.academic_year_id
    AND se.status = 'active';

  IF v_active_students_count = 0 THEN
    RAISE EXCEPTION 'Publication impossible : Aucun élève activement inscrit dans cette classe pour cette année scolaire.';
  END IF;

  -- 2. Contrôle d'exhaustivité : chaque élève actif doit avoir une note saisie ou être marqué absent
  SELECT COUNT(*) INTO v_unprocessed_count
  FROM public.student_enrollments se
  LEFT JOIN public.student_grades sg 
    ON sg.enrollment_id = se.id 
   AND sg.assessment_id = p_assessment_id
   AND sg.student_id = se.student_id
   AND sg.school_id = v_asmt.school_id
  WHERE se.school_id = v_asmt.school_id
    AND se.class_id = v_asmt.class_id
    AND se.academic_year_id = v_asmt.academic_year_id
    AND se.status = 'active'
    AND (
      sg.id IS NULL
      OR (
        (sg.is_absent IS NOT TRUE AND (sg.score IS NULL OR sg.score < 0 OR sg.score > v_asmt.max_score))
        OR (sg.is_absent IS TRUE AND sg.score IS NOT NULL)
      )
    );

  IF v_unprocessed_count > 0 THEN
    RAISE EXCEPTION 'Publication impossible : Il reste % élève(s) non noté(s) ou dont la saisie est incomplète avant publication.', v_unprocessed_count;
  END IF;

  UPDATE public.school_assessments sa
  SET
    status = 'published',
    published_at = COALESCE(v_asmt.published_at, now())
  WHERE sa.id = p_assessment_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_asmt.school_id,
    v_uid,
    'assessment_published',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', p_assessment_id,
      'assessment_id', p_assessment_id,
      'old_status', v_asmt.status,
      'new_status', 'published'
    )
  );

  RETURN true;
END;
$$;

-- E. RPC : Clôturer une évaluation (close_teacher_assessment)
-- Transition autorisée : published -> closed
CREATE OR REPLACE FUNCTION public.close_teacher_assessment(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_is_active BOOLEAN;
  v_school_status TEXT;
  v_teacher_id UUID;
  v_teacher_acc TEXT;
  v_teacher_emp TEXT;
  v_asmt RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_role, v_school_id, v_is_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('teacher', 'school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  -- Vérification établissement pour teacher et school_admin
  IF v_role IN ('teacher', 'school_admin') THEN
    IF v_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  SELECT * INTO v_asmt
  FROM public.school_assessments sa
  WHERE sa.id = p_assessment_id
  FOR UPDATE;

  IF v_asmt.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  IF v_role IN ('teacher', 'school_admin') AND v_asmt.school_id <> v_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Évaluation d’un autre établissement.';
  END IF;

  -- Machine d'états stricte : Seul published peut être clôturé
  IF v_asmt.status = 'closed' THEN
    RAISE EXCEPTION 'Transition invalide : L’évaluation est déjà clôturée.';
  END IF;
  IF v_asmt.status = 'draft' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation en brouillon ne peut pas être clôturée directement.';
  END IF;
  IF v_asmt.status = 'reopened' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation réouverte doit être publiée avant d’être clôturée.';
  END IF;
  IF v_asmt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation annulée ne peut pas être clôturée.';
  END IF;
  IF v_asmt.status <> 'published' THEN
    RAISE EXCEPTION 'Transition invalide : Seule une évaluation publiée peut être clôturée.';
  END IF;

  IF v_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_teacher_id, v_teacher_acc, v_teacher_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

    IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
    END IF;

    IF v_asmt.teacher_id <> v_teacher_id THEN
      RAISE EXCEPTION 'Accès refusé : Seul l’enseignant titulaire actif peut clôturer cette évaluation.';
    END IF;
  END IF;

  UPDATE public.school_assessments sa
  SET
    status = 'closed',
    closed_at = now()
  WHERE sa.id = p_assessment_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_asmt.school_id,
    v_uid,
    'assessment_closed',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', p_assessment_id,
      'assessment_id', p_assessment_id,
      'old_status', v_asmt.status,
      'new_status', 'closed'
    )
  );

  RETURN true;
END;
$$;

-- F. RPC : Annuler une évaluation (cancel_teacher_assessment)
-- Transitions autorisées : draft -> cancelled, published -> cancelled, reopened -> cancelled
CREATE OR REPLACE FUNCTION public.cancel_teacher_assessment(
  p_assessment_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_is_active BOOLEAN;
  v_school_status TEXT;
  v_teacher_id UUID;
  v_teacher_acc TEXT;
  v_teacher_emp TEXT;
  v_asmt RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Motif obligatoire : L’annulation d’une évaluation exige une justification explicite (au moins 5 caractères).';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_role, v_school_id, v_is_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('teacher', 'school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  -- Vérification établissement pour teacher et school_admin
  IF v_role IN ('teacher', 'school_admin') THEN
    IF v_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  SELECT * INTO v_asmt
  FROM public.school_assessments sa
  WHERE sa.id = p_assessment_id
  FOR UPDATE;

  IF v_asmt.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  IF v_role IN ('teacher', 'school_admin') AND v_asmt.school_id <> v_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Évaluation d’un autre établissement.';
  END IF;

  -- Machine d'états stricte : Seuls draft, published et reopened peuvent être annulés
  IF v_asmt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Transition invalide : L’évaluation est déjà annulée.';
  END IF;
  IF v_asmt.status = 'closed' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation clôturée ne peut pas être annulée directement.';
  END IF;
  IF v_asmt.status NOT IN ('draft', 'published', 'reopened') THEN
    RAISE EXCEPTION 'Transition invalide : Impossible d’annuler une évaluation dans cet état.';
  END IF;

  IF v_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_teacher_id, v_teacher_acc, v_teacher_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

    IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
    END IF;

    IF v_asmt.teacher_id <> v_teacher_id THEN
      RAISE EXCEPTION 'Accès refusé : Seul l’enseignant titulaire actif peut annuler cette évaluation.';
    END IF;
  END IF;

  UPDATE public.school_assessments sa
  SET status = 'cancelled'
  WHERE sa.id = p_assessment_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_asmt.school_id,
    v_uid,
    'assessment_cancelled',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', p_assessment_id,
      'assessment_id', p_assessment_id,
      'old_status', v_asmt.status,
      'new_status', 'cancelled',
      'reason', trim(p_reason)
    )
  );

  RETURN true;
END;
$$;

-- G. RPC : Réouvrir une évaluation (reopen_teacher_assessment)
-- Transition autorisée : closed -> reopened. Réservée à school_admin de la même école ou super_admin actif
CREATE OR REPLACE FUNCTION public.reopen_teacher_assessment(
  p_assessment_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_is_active BOOLEAN;
  v_school_status TEXT;
  v_asmt RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Motif obligatoire : La réouverture d’une évaluation exige un motif administratif détaillé (au moins 5 caractères).';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_role, v_school_id, v_is_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  -- Règle métier : Seul school_admin ou super_admin peut réouvrir une évaluation clôturée
  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seule l’administration de l’établissement (school_admin) ou un super_admin peut réouvrir une évaluation clôturée.';
  END IF;

  IF v_role = 'school_admin' THEN
    IF v_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  SELECT * INTO v_asmt
  FROM public.school_assessments sa
  WHERE sa.id = p_assessment_id
  FOR UPDATE;

  IF v_asmt.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  IF v_role = 'school_admin' AND v_asmt.school_id <> v_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cette évaluation appartient à un autre établissement.';
  END IF;

  -- Machine d'états stricte : Seul closed peut être réouvert
  IF v_asmt.status = 'reopened' THEN
    RAISE EXCEPTION 'Transition invalide : L’évaluation est déjà réouverte.';
  END IF;
  IF v_asmt.status = 'draft' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation en brouillon est déjà ouverte.';
  END IF;
  IF v_asmt.status = 'published' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation publiée ne peut pas être réouverte.';
  END IF;
  IF v_asmt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation annulée ne peut pas être réouverte.';
  END IF;
  IF v_asmt.status <> 'closed' THEN
    RAISE EXCEPTION 'Transition invalide : Seule une évaluation clôturée peut être réouverte.';
  END IF;

  UPDATE public.school_assessments sa
  SET status = 'reopened'
  WHERE sa.id = p_assessment_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_asmt.school_id,
    v_uid,
    'assessment_reopened',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', p_assessment_id,
      'assessment_id', p_assessment_id,
      'old_status', v_asmt.status,
      'new_status', 'reopened',
      'reason', trim(p_reason)
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 5. RPCS DE LECTURE SECURISEE (AVEC ALIAS DE TABLES EXPLICITES)
--------------------------------------------------------------------------------

-- A. RPC : Liste des évaluations pour le portail enseignant / admin (get_teacher_assessments)
CREATE OR REPLACE FUNCTION public.get_teacher_assessments()
RETURNS TABLE (
  id UUID,
  school_id UUID,
  academic_year_id UUID,
  term_id UUID,
  term_name TEXT,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  teacher_id UUID,
  teacher_name TEXT,
  title TEXT,
  description TEXT,
  assessment_type TEXT,
  assessment_date DATE,
  max_score NUMERIC,
  coefficient NUMERIC,
  status TEXT,
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  grades_count BIGINT,
  average_score NUMERIC
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

  SELECT p.role, p.school_id, p.is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_caller_role = 'teacher' THEN
    IF v_caller_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_caller_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Établissement suspendu ou inactif.';
    END IF;

    SELECT t.id, t.account_status, t.employment_status
    INTO v_tch_id, v_tch_acc_status, v_tch_emp_status
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_caller_school_id;

    IF v_tch_id IS NULL OR v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Compte enseignant inactif.';
    END IF;

    RETURN QUERY
    SELECT
      sa.id,
      sa.school_id,
      sa.academic_year_id,
      sa.term_id,
      st.name AS term_name,
      sa.class_id,
      c.name AS class_name,
      sa.subject_id,
      sb.name AS subject_name,
      sa.teacher_id,
      (t.first_name || ' ' || t.last_name) AS teacher_name,
      sa.title,
      sa.description,
      sa.assessment_type,
      sa.assessment_date,
      sa.max_score,
      sa.coefficient,
      sa.status,
      sa.published_at,
      sa.closed_at,
      sa.created_by,
      sa.created_at,
      sa.updated_at,
      COUNT(sg.id) AS grades_count,
      ROUND(AVG(sg.score)::NUMERIC, 2) AS average_score
    FROM public.school_assessments sa
    JOIN public.classes c ON c.id = sa.class_id
    JOIN public.subjects sb ON sb.id = sa.subject_id
    JOIN public.teachers t ON t.id = sa.teacher_id
    LEFT JOIN public.school_terms st ON st.id = sa.term_id
    LEFT JOIN public.student_grades sg ON sg.assessment_id = sa.id AND sg.is_absent = false
    WHERE sa.school_id = v_caller_school_id
      AND sa.teacher_id = v_tch_id
    GROUP BY sa.id, st.name, c.name, sb.name, t.first_name, t.last_name
    ORDER BY sa.assessment_date DESC, sa.created_at DESC;

  ELSIF v_caller_role = 'school_admin' THEN
    IF v_caller_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_caller_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Établissement suspendu ou inactif.';
    END IF;

    RETURN QUERY
    SELECT
      sa.id,
      sa.school_id,
      sa.academic_year_id,
      sa.term_id,
      st.name AS term_name,
      sa.class_id,
      c.name AS class_name,
      sa.subject_id,
      sb.name AS subject_name,
      sa.teacher_id,
      (t.first_name || ' ' || t.last_name) AS teacher_name,
      sa.title,
      sa.description,
      sa.assessment_type,
      sa.assessment_date,
      sa.max_score,
      sa.coefficient,
      sa.status,
      sa.published_at,
      sa.closed_at,
      sa.created_by,
      sa.created_at,
      sa.updated_at,
      COUNT(sg.id) AS grades_count,
      ROUND(AVG(sg.score)::NUMERIC, 2) AS average_score
    FROM public.school_assessments sa
    JOIN public.classes c ON c.id = sa.class_id
    JOIN public.subjects sb ON sb.id = sa.subject_id
    JOIN public.teachers t ON t.id = sa.teacher_id
    LEFT JOIN public.school_terms st ON st.id = sa.term_id
    LEFT JOIN public.student_grades sg ON sg.assessment_id = sa.id AND sg.is_absent = false
    WHERE sa.school_id = v_caller_school_id
    GROUP BY sa.id, st.name, c.name, sb.name, t.first_name, t.last_name
    ORDER BY sa.assessment_date DESC, sa.created_at DESC;

  ELSIF v_caller_role = 'super_admin' THEN
    RETURN QUERY
    SELECT
      sa.id,
      sa.school_id,
      sa.academic_year_id,
      sa.term_id,
      st.name AS term_name,
      sa.class_id,
      c.name AS class_name,
      sa.subject_id,
      sb.name AS subject_name,
      sa.teacher_id,
      (t.first_name || ' ' || t.last_name) AS teacher_name,
      sa.title,
      sa.description,
      sa.assessment_type,
      sa.assessment_date,
      sa.max_score,
      sa.coefficient,
      sa.status,
      sa.published_at,
      sa.closed_at,
      sa.created_by,
      sa.created_at,
      sa.updated_at,
      COUNT(sg.id) AS grades_count,
      ROUND(AVG(sg.score)::NUMERIC, 2) AS average_score
    FROM public.school_assessments sa
    JOIN public.classes c ON c.id = sa.class_id
    JOIN public.subjects sb ON sb.id = sa.subject_id
    JOIN public.teachers t ON t.id = sa.teacher_id
    LEFT JOIN public.school_terms st ON st.id = sa.term_id
    LEFT JOIN public.student_grades sg ON sg.assessment_id = sa.id AND sg.is_absent = false
    GROUP BY sa.id, st.name, c.name, sb.name, t.first_name, t.last_name
    ORDER BY sa.assessment_date DESC, sa.created_at DESC;

  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;
END;
$$;

-- B. RPC : Obtenir le carnet de notes d'une évaluation (get_assessment_gradebook)
CREATE OR REPLACE FUNCTION public.get_assessment_gradebook(p_assessment_id UUID)
RETURNS TABLE (
  assessment_id UUID,
  student_id UUID,
  enrollment_id UUID,
  student_number TEXT,
  first_name TEXT,
  last_name TEXT,
  score NUMERIC,
  is_absent BOOLEAN,
  is_excused BOOLEAN,
  teacher_comment TEXT,
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
  v_asmt RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  -- Refus strict pour parent, student, rôle NULL ou tout rôle inconnu
  IF v_caller_role NOT IN ('teacher', 'school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé à accéder au carnet de notes.';
  END IF;

  SELECT * INTO v_asmt
  FROM public.school_assessments sa
  WHERE sa.id = p_assessment_id;

  IF v_asmt.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  IF v_caller_role IN ('teacher', 'school_admin') THEN
    IF v_caller_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil.';
    END IF;

    IF v_asmt.school_id <> v_caller_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Cette évaluation appartient à un autre établissement.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_caller_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Établissement suspendu ou inactif.';
    END IF;
  END IF;

  IF v_caller_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_tch_id, v_tch_acc_status, v_tch_emp_status
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_caller_school_id;

    IF v_tch_id IS NULL OR v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
    END IF;

    IF v_asmt.teacher_id <> v_tch_id THEN
      RAISE EXCEPTION 'Accès refusé : Seul l’enseignant titulaire ou l’administration peut consulter le carnet complet.';
    END IF;
  END IF;

  -- Retourne tous les élèves inscrits actifs de la classe avec vérification stricte multi-écoles/inscriptions
  RETURN QUERY
  SELECT
    v_asmt.id AS assessment_id,
    st.id AS student_id,
    se.id AS enrollment_id,
    st.student_number,
    COALESCE(st.first_name, '') AS first_name,
    COALESCE(st.last_name, '') AS last_name,
    sg.score,
    COALESCE(sg.is_absent, false) AS is_absent,
    COALESCE(sg.is_excused, false) AS is_excused,
    sg.teacher_comment,
    sg.created_at,
    sg.updated_at
  FROM public.student_enrollments se
  JOIN public.students st ON st.id = se.student_id
  LEFT JOIN public.student_grades sg ON sg.assessment_id = v_asmt.id
    AND sg.student_id = st.id
    AND sg.school_id = v_asmt.school_id
  WHERE se.school_id = v_asmt.school_id
    AND se.class_id = v_asmt.class_id
    AND se.academic_year_id = v_asmt.academic_year_id
    AND se.status = 'active'
    AND st.school_id = v_asmt.school_id
  ORDER BY st.last_name ASC, st.first_name ASC;
END;
$$;

-- C. RPC : Obtenir les notes pour un élève (get_grades_for_student)
CREATE OR REPLACE FUNCTION public.get_grades_for_student(p_student_id UUID DEFAULT NULL)
RETURNS TABLE (
  grade_id UUID,
  assessment_id UUID,
  school_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  term_name TEXT,
  teacher_name TEXT,
  title TEXT,
  assessment_type TEXT,
  assessment_date DATE,
  max_score NUMERIC,
  coefficient NUMERIC,
  score NUMERIC,
  is_absent BOOLEAN,
  is_excused BOOLEAN,
  teacher_comment TEXT,
  assessment_status TEXT
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

  SELECT p.role, p.school_id, p.is_active
  INTO v_profile_role, v_profile_school_id, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_profile_role IS NULL OR v_profile_active IS NOT TRUE OR v_profile_role <> 'student' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un élève actif peut consulter ses notes.';
  END IF;

  SELECT st.id, st.school_id
  INTO v_student_id, v_student_school_id
  FROM public.students st
  WHERE st.profile_id = v_uid;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Dossier élève introuvable pour votre compte.';
  END IF;

  IF p_student_id IS NOT NULL AND p_student_id <> v_student_id THEN
    RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres notes.';
  END IF;

  IF v_profile_school_id IS NULL OR v_student_school_id IS NULL OR v_profile_school_id <> v_student_school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : Profil et dossier élève incompatibles.';
  END IF;

  SELECT sc.status INTO v_school_status
  FROM public.schools sc
  WHERE sc.id = v_student_school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
  END IF;

  RETURN QUERY
  SELECT
    sg.id AS grade_id,
    sa.id AS assessment_id,
    sa.school_id,
    sa.class_id,
    c.name AS class_name,
    sa.subject_id,
    sb.name AS subject_name,
    st_term.name AS term_name,
    (t.first_name || ' ' || t.last_name) AS teacher_name,
    sa.title,
    sa.assessment_type,
    sa.assessment_date,
    sa.max_score,
    sa.coefficient,
    sg.score,
    sg.is_absent,
    sg.is_excused,
    sg.teacher_comment,
    sa.status AS assessment_status
  FROM public.student_grades sg
  JOIN public.school_assessments sa ON sa.id = sg.assessment_id
  JOIN public.student_enrollments se ON se.id = sg.enrollment_id
    AND se.student_id = v_student_id
    AND se.class_id = sa.class_id
    AND se.academic_year_id = sa.academic_year_id
    AND se.school_id = v_student_school_id
    AND se.status = 'active'
  JOIN public.classes c ON c.id = sa.class_id
  JOIN public.subjects sb ON sb.id = sa.subject_id
  JOIN public.teachers t ON t.id = sa.teacher_id
  LEFT JOIN public.school_terms st_term ON st_term.id = sa.term_id
  WHERE sg.school_id = v_student_school_id
    AND sg.student_id = v_student_id
    AND sa.school_id = v_student_school_id
    AND sa.status IN ('published', 'closed')
  ORDER BY sa.assessment_date DESC, sa.created_at DESC;
END;
$$;

-- D. RPC : Obtenir les notes pour le parent d'un élève (get_grades_for_parent_child)
CREATE OR REPLACE FUNCTION public.get_grades_for_parent_child(p_student_id UUID)
RETURNS TABLE (
  grade_id UUID,
  assessment_id UUID,
  school_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  term_name TEXT,
  teacher_name TEXT,
  title TEXT,
  assessment_type TEXT,
  assessment_date DATE,
  max_score NUMERIC,
  coefficient NUMERIC,
  score NUMERIC,
  is_absent BOOLEAN,
  is_excused BOOLEAN,
  teacher_comment TEXT,
  assessment_status TEXT
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
  v_has_approved_link BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Identifiant élève obligatoire.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_profile_role, v_profile_school_id, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_profile_role IS NULL OR v_profile_active IS NOT TRUE OR v_profile_role <> 'parent' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un parent actif peut utiliser cette fonction.';
  END IF;

  IF v_profile_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre compte parent.';
  END IF;

  -- Vérification stricte du lien parent-élève (statut 'approved' obligatoire, rejet de pending/rejected/revoked)
  SELECT EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    JOIN public.students st ON st.id = psl.student_id
    WHERE psl.parent_profile_id = v_uid
      AND psl.student_id = p_student_id
      AND st.school_id = v_profile_school_id
      AND psl.status = 'approved'
  ) INTO v_has_approved_link;

  IF NOT v_has_approved_link THEN
    RAISE EXCEPTION 'Accès refusé : Aucun lien parent-élève approuvé pour cet élève dans votre établissement.';
  END IF;

  SELECT st.school_id INTO v_student_school_id
  FROM public.students st
  WHERE st.id = p_student_id;

  IF v_student_school_id IS NULL OR v_student_school_id <> v_profile_school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’élève n’appartient pas au même établissement.';
  END IF;

  SELECT sc.status INTO v_school_status
  FROM public.schools sc
  WHERE sc.id = v_profile_school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
  END IF;

  RETURN QUERY
  SELECT
    sg.id AS grade_id,
    sa.id AS assessment_id,
    sa.school_id,
    sa.class_id,
    c.name AS class_name,
    sa.subject_id,
    sb.name AS subject_name,
    st_term.name AS term_name,
    (t.first_name || ' ' || t.last_name) AS teacher_name,
    sa.title,
    sa.assessment_type,
    sa.assessment_date,
    sa.max_score,
    sa.coefficient,
    sg.score,
    sg.is_absent,
    sg.is_excused,
    sg.teacher_comment,
    sa.status AS assessment_status
  FROM public.student_grades sg
  JOIN public.school_assessments sa ON sa.id = sg.assessment_id
  JOIN public.student_enrollments se ON se.id = sg.enrollment_id
    AND se.student_id = p_student_id
    AND se.class_id = sa.class_id
    AND se.academic_year_id = sa.academic_year_id
    AND se.school_id = v_profile_school_id
    AND se.status = 'active'
  JOIN public.classes c ON c.id = sa.class_id
  JOIN public.subjects sb ON sb.id = sa.subject_id
  JOIN public.teachers t ON t.id = sa.teacher_id
  LEFT JOIN public.school_terms st_term ON st_term.id = sa.term_id
  WHERE sg.school_id = v_profile_school_id
    AND sg.student_id = p_student_id
    AND sa.school_id = v_profile_school_id
    AND sa.status IN ('published', 'closed')
  ORDER BY sa.assessment_date DESC, sa.created_at DESC;
END;
$$;

--------------------------------------------------------------------------------
-- 6. HELPERS DE SECURITE ANTI-RECURSION POUR RLS
--------------------------------------------------------------------------------

-- Helper 1 : Enseignant titulaire actif d'une évaluation
CREATE OR REPLACE FUNCTION public.is_teacher_of_assessment(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_assessments sa
    JOIN public.profiles p ON p.id = auth.uid()
    JOIN public.schools sc ON sc.id = p.school_id
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    WHERE sa.id = p_assessment_id
      AND p.role = 'teacher'
      AND p.is_active = true
      AND sc.status = 'active'
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND t.id = sa.teacher_id
      AND sa.school_id = p.school_id
  );
$$;

-- Helper 2 : Élève inscrit actif autorisé à lire une évaluation publiée/clôturée
CREATE OR REPLACE FUNCTION public.can_student_read_assessment(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_assessments sa
    JOIN public.profiles p ON p.id = auth.uid()
    JOIN public.schools sc ON sc.id = p.school_id
    JOIN public.students st ON st.profile_id = p.id AND st.school_id = p.school_id
    JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = p.school_id
    WHERE sa.id = p_assessment_id
      AND p.role = 'student'
      AND p.is_active = true
      AND sc.status = 'active'
      AND sa.status IN ('published', 'closed')
      AND sa.school_id = p.school_id
      AND se.class_id = sa.class_id
      AND se.academic_year_id = sa.academic_year_id
      AND se.status = 'active'
  );
$$;

-- Helper 3 : Parent approuvé autorisé à lire une évaluation publiée/clôturée
CREATE OR REPLACE FUNCTION public.can_parent_read_assessment(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_assessments sa
    JOIN public.profiles p ON p.id = auth.uid()
    JOIN public.schools sc ON sc.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id
    JOIN public.students st ON st.id = psl.student_id AND st.school_id = p.school_id
    JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = p.school_id
    WHERE sa.id = p_assessment_id
      AND p.role = 'parent'
      AND p.is_active = true
      AND sc.status = 'active'
      AND psl.status = 'approved'
      AND sa.status IN ('published', 'closed')
      AND sa.school_id = p.school_id
      AND se.class_id = sa.class_id
      AND se.academic_year_id = sa.academic_year_id
      AND se.status = 'active'
  );
$$;

-- Helper 4 : Élève autorisé à lire sa propre note publiée/clôturée
CREATE OR REPLACE FUNCTION public.can_student_read_grade(p_student_id UUID, p_assessment_id UUID, p_enrollment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.schools sc ON sc.id = p.school_id
    JOIN public.students st ON st.profile_id = p.id AND st.school_id = p.school_id
    JOIN public.school_assessments sa ON sa.id = p_assessment_id
    JOIN public.student_enrollments se ON se.id = p_enrollment_id
    WHERE p.id = auth.uid()
      AND p.role = 'student'
      AND p.is_active = true
      AND sc.status = 'active'
      AND st.id = p_student_id
      AND sa.school_id = p.school_id
      AND sa.status IN ('published', 'closed')
      AND se.student_id = st.id
      AND se.class_id = sa.class_id
      AND se.academic_year_id = sa.academic_year_id
      AND se.school_id = p.school_id
      AND se.status = 'active'
  );
$$;

-- Helper 5 : Parent approuvé autorisé à lire la note publiée/clôturée de son enfant
CREATE OR REPLACE FUNCTION public.can_parent_read_grade(p_student_id UUID, p_assessment_id UUID, p_enrollment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.schools sc ON sc.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id
    JOIN public.students st ON st.id = psl.student_id AND st.school_id = p.school_id
    JOIN public.school_assessments sa ON sa.id = p_assessment_id
    JOIN public.student_enrollments se ON se.id = p_enrollment_id
    WHERE p.id = auth.uid()
      AND p.role = 'parent'
      AND p.is_active = true
      AND sc.status = 'active'
      AND psl.status = 'approved'
      AND st.id = p_student_id
      AND sa.school_id = p.school_id
      AND sa.status IN ('published', 'closed')
      AND se.student_id = st.id
      AND se.class_id = sa.class_id
      AND se.academic_year_id = sa.academic_year_id
      AND se.school_id = p.school_id
      AND se.status = 'active'
  );
$$;

--------------------------------------------------------------------------------
-- 7. POLITIQUES RLS SUR SCHOOL_ASSESSMENTS ET STUDENT_GRADES (EXCLUSIVEMENT SELECT)
--------------------------------------------------------------------------------
ALTER TABLE public.school_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_grades ENABLE ROW LEVEL SECURITY;

-- Suppression intégrale fail-closed de toute politique antérieure
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('school_assessments', 'student_grades')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;
END;
$$;

-- A. RLS School Assessments (SELECT uniquement)
CREATE POLICY "SuperAdmin read all assessments"
  ON public.school_assessments FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "SchoolAdmin read school assessments"
  ON public.school_assessments FOR SELECT
  USING (public.is_school_admin(school_id));

CREATE POLICY "Teacher read own assessments"
  ON public.school_assessments FOR SELECT
  USING (public.is_teacher_of_assessment(id));

CREATE POLICY "Student read published assessments"
  ON public.school_assessments FOR SELECT
  USING (public.can_student_read_assessment(id));

CREATE POLICY "Parent read published assessments"
  ON public.school_assessments FOR SELECT
  USING (public.can_parent_read_assessment(id));

-- B. RLS Student Grades (SELECT uniquement)
CREATE POLICY "SuperAdmin read all grades"
  ON public.student_grades FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "SchoolAdmin read school grades"
  ON public.student_grades FOR SELECT
  USING (public.is_school_admin(school_id));

CREATE POLICY "Teacher read own assessment grades"
  ON public.student_grades FOR SELECT
  USING (public.is_teacher_of_assessment(assessment_id));

CREATE POLICY "Student read own published grades"
  ON public.student_grades FOR SELECT
  USING (public.can_student_read_grade(student_id, assessment_id, enrollment_id));

CREATE POLICY "Parent read approved child published grades"
  ON public.student_grades FOR SELECT
  USING (public.can_parent_read_grade(student_id, assessment_id, enrollment_id));

--------------------------------------------------------------------------------
-- 8. PRIVILEGES STRICTS ET VERROUILLAGE DES ACCES DIRECTS
--------------------------------------------------------------------------------
-- Révocation totale des écritures directes sur les tables
REVOKE INSERT, UPDATE, DELETE ON public.school_assessments FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_grades FROM PUBLIC, anon, authenticated;

-- Révocation et attribution exclusive des RPCs d'écriture
REVOKE ALL ON FUNCTION public.create_teacher_assessment(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_teacher_assessment(UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_student_grades(UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_teacher_assessment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_teacher_assessment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_teacher_assessment(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_teacher_assessment(UUID, TEXT) FROM PUBLIC;

-- Révocation et attribution exclusive des RPCs de lecture
REVOKE ALL ON FUNCTION public.get_teacher_assessments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_assessment_gradebook(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_grades_for_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_grades_for_parent_child(UUID) FROM PUBLIC;

-- Révocation et attribution exclusive des helpers RLS
REVOKE ALL ON FUNCTION public.is_teacher_of_assessment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_student_read_assessment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_read_assessment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_student_read_grade(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_read_grade(UUID, UUID, UUID) FROM PUBLIC;

-- Attribution aux utilisateurs authentifiés
GRANT EXECUTE ON FUNCTION public.create_teacher_assessment(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_teacher_assessment(UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_student_grades(UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_teacher_assessment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_teacher_assessment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_teacher_assessment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_teacher_assessment(UUID, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_teacher_assessments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_assessment_gradebook(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_grades_for_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_grades_for_parent_child(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_teacher_of_assessment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_student_read_assessment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_read_assessment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_student_read_grade(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_read_grade(UUID, UUID, UUID) TO authenticated;

COMMIT;

--------------------------------------------------------------------------------
-- 8. PLAN DE TESTS SQL DOCUMENTÉS (NE PAS EXÉCUTER SUR PRODUCTION)
--------------------------------------------------------------------------------
/*
TEST SCENARIOS DOCUMENTATION :

1. TEST_UNAUTHORIZED_PARENT_OPEN_GRADEBOOK :
   -- Contexte : Parent connecté (auth.uid() = parent_profile_id)
   SELECT * FROM public.get_assessment_gradebook('00000000-0000-0000-0000-000000000001');
   -> Attendu : EXCEPTION 'Accès refusé : Rôle non autorisé à accéder au carnet de notes.'

2. TEST_UNAUTHORIZED_STUDENT_OPEN_GRADEBOOK :
   -- Contexte : Élève connecté (auth.uid() = student_profile_id)
   SELECT * FROM public.get_assessment_gradebook('00000000-0000-0000-0000-000000000001');
   -> Attendu : EXCEPTION 'Accès refusé : Rôle non autorisé à accéder au carnet de notes.'

3. TEST_SUSPENDED_TEACHER_CREATE_ASSESSMENT :
   -- Contexte : Enseignant avec account_status = 'suspended' ou employment_status = 'inactive'
   SELECT public.create_teacher_assessment(
     '11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222',
     NULL,
     'Devoir Math',
     NULL,
     'test',
     CURRENT_DATE,
     20,
     1,
     false
   );
   -> Attendu : EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.'

4. TEST_TEACHER_OTHER_SCHOOL :
   -- Contexte : Enseignant de l'école A essayant de créer une évaluation sur une classe de l'école B
   SELECT public.create_teacher_assessment(
     '33333333-3333-3333-3333-333333333333', -- classe école B
     '22222222-2222-2222-2222-222222222222',
     NULL,
     'Devoir Math',
     NULL,
     'test',
     CURRENT_DATE,
     20,
     1,
     false
   );
   -> Attendu : EXCEPTION 'Classe introuvable dans votre établissement.'

5. TEST_SCHOOL_ADMIN_OTHER_SCHOOL :
   -- Contexte : Administrateur de l'école A tentant de modifier une évaluation de l'école B
   SELECT public.update_teacher_assessment(
     '44444444-4444-4444-4444-444444444444', -- eval école B
     NULL,
     'Modification Titre',
     NULL,
     'test',
     CURRENT_DATE,
     20,
     1,
     'Motif administratif valide'
   );
   -> Attendu : EXCEPTION 'Accès refusé : Évaluation d’un autre établissement.'

6. TEST_SUSPENDED_SCHOOL :
   -- Contexte : Enseignant ou school_admin dont l'école a status = 'suspended'
   SELECT public.publish_teacher_assessment('00000000-0000-0000-0000-000000000001');
   -> Attendu : EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.'

7. TEST_STUDENT_OTHER_STUDENT_GRADES :
   -- Contexte : Élève A tentant de consulter les notes de l'élève B via son ID
   SELECT * FROM public.get_grades_for_student('55555555-5555-5555-5555-555555555555');
   -> Attendu : EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres notes.'

8. TEST_PARENT_PENDING_LINK_GRADES :
   -- Contexte : Parent avec un lien au statut 'pending', 'rejected' ou 'revoked'
   SELECT * FROM public.get_grades_for_parent_child('66666666-6666-6666-6666-666666666666');
   -> Attendu : EXCEPTION 'Accès refusé : Aucun lien parent-élève approuvé pour cet élève dans votre établissement.'

9. TEST_SCORE_EXCEEDING_MAX :
   -- Contexte : Évaluation avec max_score = 20. Saisie d'une note de 25
   SELECT public.save_student_grades(
     '00000000-0000-0000-0000-000000000001',
     '[{"student_id":"55555555-5555-5555-5555-555555555555","enrollment_id":"66666666-6666-6666-6666-666666666666","score":25,"is_absent":false}]'::jsonb,
     NULL
   );
   -> Attendu : EXCEPTION 'Note hors barème pour l’élève (%) : 25 (barème: 0-20).'

10. TEST_ENROLLMENT_OTHER_CLASS :
    -- Contexte : Inscription appartenant à la classe B envoyée sur une évaluation de la classe A
    SELECT public.save_student_grades(
      '00000000-0000-0000-0000-000000000001',
      '[{"student_id":"55555555-5555-5555-5555-555555555555","enrollment_id":"77777777-7777-7777-7777-777777777777","score":15,"is_absent":false}]'::jsonb,
      NULL
    );
    -> Attendu : EXCEPTION 'Incohérence : L’élève (%) ne possède pas d’inscription active dans la classe/année de l’évaluation.'

11. TEST_INVALID_UUID_OR_JSONB :
    -- Contexte : Payload avec format JSONB corrompu ou UUID non conforme
    SELECT public.save_student_grades(
      '00000000-0000-0000-0000-000000000001',
      '[{"student_id":"not-an-uuid","enrollment_id":"66666666-6666-6666-6666-666666666666","score":15}]'::jsonb,
      NULL
    );
    -> Attendu : EXCEPTION 'Identifiant invalide : student_id ou enrollment_id n’est pas un UUID valide.'

12. TEST_DUPLICATE_STUDENT_IN_PAYLOAD :
    -- Contexte : Deux notes pour le même student_id dans le même tableau JSONB
    SELECT public.save_student_grades(
      '00000000-0000-0000-0000-000000000001',
      '[{"student_id":"55555555-5555-5555-5555-555555555555","enrollment_id":"66666666-6666-6666-6666-666666666666","score":12}, {"student_id":"55555555-5555-5555-5555-555555555555","enrollment_id":"66666666-6666-6666-6666-666666666666","score":14}]'::jsonb,
      NULL
    );
    -> Attendu : EXCEPTION 'Payload invalide : Doublon détecté pour l’élève (%) dans le même lot de notation.'

13. TEST_DIRECT_TABLE_WRITE_BLOCK :
    -- Contexte : Utilisateur authentifié standard tentant une insertion SQL directe
    INSERT INTO public.school_assessments (school_id, academic_year_id, class_id, subject_id, teacher_id, title, assessment_type, assessment_date, max_score, created_by)
    VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555', 'Hack', 'test', CURRENT_DATE, 20, auth.uid());
    -> Attendu : ERROR 'permission denied for table school_assessments'

14. TEST_DOUBLE_PUBLISH :
    -- Contexte : Évaluation déjà à status = 'published'
    SELECT public.publish_teacher_assessment('00000000-0000-0000-0000-000000000001');
    -> Attendu : EXCEPTION 'Transition invalide : L’évaluation est déjà publiée.'

15. TEST_CLOSE_FROM_DRAFT :
    -- Contexte : Évaluation à status = 'draft'
    SELECT public.close_teacher_assessment('00000000-0000-0000-0000-000000000001');
    -> Attendu : EXCEPTION 'Transition invalide : Une évaluation en brouillon ne peut pas être clôturée directement.'

16. TEST_REOPEN_FROM_DRAFT_OR_PUBLISHED :
    -- Contexte : Évaluation à status = 'published'
    SELECT public.reopen_teacher_assessment('00000000-0000-0000-0000-000000000001', 'Motif administratif valide');
    -> Attendu : EXCEPTION 'Transition invalide : Une évaluation publiée est déjà ouverte.'

17. TEST_TEACHER_UPDATE_AFTER_CLOSE :
    -- Contexte : Enseignant tentant d'exécuter update_teacher_assessment sur une évaluation à status = 'closed'
    SELECT public.update_teacher_assessment(
      '00000000-0000-0000-0000-000000000001',
      NULL,
      'Titre Modifié',
      NULL,
      'test',
      CURRENT_DATE,
      20,
      1,
      NULL
    );
    -> Attendu : EXCEPTION 'Accès refusé : Un enseignant ne peut modifier directement que les évaluations en brouillon ou réouvertes.'

18. TEST_SUPER_ADMIN_GLOBAL_READ :
    -- Contexte : SuperAdmin connecté (profiles.role = 'super_admin', school_id IS NULL)
    SELECT * FROM public.get_teacher_assessments();
    -> Attendu : Succès (retourne les évaluations multi-établissements sans filtre school_id).

19. TEST_ADMIN_CANCEL_WITH_INACTIVE_TEACHER :
    -- Contexte : Administrateur annulant une évaluation orpheline dont l'enseignant a quitté l'établissement
    SELECT public.cancel_teacher_assessment(
      '00000000-0000-0000-0000-000000000001',
      'Annulation administrative pour départ enseignant'
    );
    -> Attendu : Succès (statut passe à 'cancelled' sans exiger de contrat enseignant actif).
*/
