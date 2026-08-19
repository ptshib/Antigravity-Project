-- ============================================================================
-- Migration Phase 2F.2 : Résultats Scolaires Périodiques, Moyennes par Matière et Pourcentage Général
-- Fichier : supabase/migrations/20260818160000_periodic_academic_results.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION DES TABLES ET CRÉATION DE CLASS_SUBJECT_SETTINGS (IDEMPOTENT)
--------------------------------------------------------------------------------

-- A. Table des coefficients de matières par classe
CREATE TABLE IF NOT EXISTS public.class_subject_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  coefficient NUMERIC NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_class_subject_settings UNIQUE (school_id, academic_year_id, class_id, subject_id),
  CONSTRAINT chk_class_subject_coefficient_positive CHECK (coefficient > 0)
);

-- B. Extension de school_homework (colonne period_id)
ALTER TABLE public.school_homework
  ADD COLUMN IF NOT EXISTS period_id UUID NULL REFERENCES public.school_periods(id) ON DELETE RESTRICT;

-- C. Extension de school_assessments (colonne period_id)
ALTER TABLE public.school_assessments
  ADD COLUMN IF NOT EXISTS period_id UUID NULL REFERENCES public.school_periods(id) ON DELETE RESTRICT;

--------------------------------------------------------------------------------
-- 2. CRÉATION DES INDEX DE PERFORMANCE
--------------------------------------------------------------------------------

-- Index class_subject_settings
CREATE INDEX IF NOT EXISTS idx_class_subject_settings_lookup
  ON public.class_subject_settings (school_id, academic_year_id, class_id, subject_id);

CREATE INDEX IF NOT EXISTS idx_class_subject_settings_class_year
  ON public.class_subject_settings (class_id, academic_year_id);

CREATE INDEX IF NOT EXISTS idx_class_subject_settings_subject
  ON public.class_subject_settings (subject_id);

CREATE INDEX IF NOT EXISTS idx_class_subject_settings_school
  ON public.class_subject_settings (school_id);

-- Index school_homework
CREATE INDEX IF NOT EXISTS idx_homework_period_id
  ON public.school_homework (period_id);

CREATE INDEX IF NOT EXISTS idx_homework_class_period
  ON public.school_homework (class_id, period_id);

-- Index school_assessments
CREATE INDEX IF NOT EXISTS idx_assessments_period_id
  ON public.school_assessments (period_id);

CREATE INDEX IF NOT EXISTS idx_assessments_class_period
  ON public.school_assessments (class_id, period_id);

CREATE INDEX IF NOT EXISTS idx_assessments_subject_period
  ON public.school_assessments (subject_id, period_id);

CREATE INDEX IF NOT EXISTS idx_assessments_school_year_period
  ON public.school_assessments (school_id, academic_year_id, period_id);

-- Index student_grades
CREATE INDEX IF NOT EXISTS idx_student_grades_assessment_id
  ON public.student_grades (assessment_id);

CREATE INDEX IF NOT EXISTS idx_student_grades_student_id
  ON public.student_grades (student_id);

CREATE INDEX IF NOT EXISTS idx_student_grades_enrollment_id
  ON public.student_grades (enrollment_id);

--------------------------------------------------------------------------------
-- 3. DÉSACTIVATION TEMPORAIRE DU TRIGGER D'ÉVALUATION POUR LE BACKFILL ATOMIQUE
--------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_school_assessment_integrity ON public.school_assessments;
DROP TRIGGER IF EXISTS trg_school_assessments_integrity ON public.school_assessments;
DROP TRIGGER IF EXISTS trg_validate_school_homework_period ON public.school_homework;
DROP TRIGGER IF EXISTS trg_school_homework_period ON public.school_homework;

--------------------------------------------------------------------------------
-- 4. BACKFILL ATOMIQUE ET PRUDENT DES DONNÉES HISTORIQUES
--------------------------------------------------------------------------------

-- A. Renseignement atomique de period_id et term_id sur school_assessments
UPDATE public.school_assessments a
SET
  period_id = sp_match.unique_period_id,
  term_id = sp_match.parent_term_id,
  updated_at = now()
FROM (
  SELECT
    a2.id AS assessment_id,
    (array_agg(sp.id))[1] AS unique_period_id,
    (array_agg(sp.parent_term_id))[1] AS parent_term_id
  FROM public.school_assessments a2
  JOIN public.classes c ON c.id = a2.class_id
  JOIN public.school_periods sp
    ON sp.school_id = a2.school_id
   AND sp.academic_year_id = a2.academic_year_id
   AND sp.education_cycle = c.education_cycle
   AND (a2.term_id IS NULL OR sp.parent_term_id = a2.term_id)
   AND sp.starts_on IS NOT NULL
   AND sp.ends_on IS NOT NULL
   AND a2.assessment_date >= sp.starts_on
   AND a2.assessment_date <= sp.ends_on
   AND sp.is_active = true
  WHERE a2.period_id IS NULL
  GROUP BY a2.id
  HAVING count(sp.id) = 1
) sp_match
WHERE a.id = sp_match.assessment_id
  AND a.period_id IS NULL;

-- B. Renseignement atomique de period_id et term_id sur school_homework
UPDATE public.school_homework h
SET
  period_id = sp_match.unique_period_id,
  term_id = sp_match.parent_term_id,
  updated_at = now()
FROM (
  SELECT
    h2.id AS homework_id,
    (array_agg(sp.id))[1] AS unique_period_id,
    (array_agg(sp.parent_term_id))[1] AS parent_term_id
  FROM public.school_homework h2
  JOIN public.classes c ON c.id = h2.class_id
  JOIN public.school_periods sp
    ON sp.school_id = h2.school_id
   AND sp.academic_year_id = h2.academic_year_id
   AND sp.education_cycle = c.education_cycle
   AND (h2.term_id IS NULL OR sp.parent_term_id = h2.term_id)
   AND sp.starts_on IS NOT NULL
   AND sp.ends_on IS NOT NULL
   AND h2.assigned_on >= sp.starts_on
   AND h2.assigned_on <= sp.ends_on
   AND sp.is_active = true
  WHERE h2.period_id IS NULL
  GROUP BY h2.id
  HAVING count(sp.id) = 1
) sp_match
WHERE h.id = sp_match.homework_id
  AND h.period_id IS NULL;

-- C. Initialisation des coefficients par défaut (1.0) pour couples classe/matière issus d'affectations réelles
INSERT INTO public.class_subject_settings (
  school_id,
  academic_year_id,
  class_id,
  subject_id,
  coefficient,
  is_active
)
SELECT DISTINCT
  tca.school_id,
  tca.academic_year_id,
  tca.class_id,
  tca.subject_id,
  1.0 AS coefficient,
  true AS is_active
FROM public.teacher_class_assignments tca
WHERE tca.is_active = true
  AND tca.subject_id IS NOT NULL
ON CONFLICT (school_id, academic_year_id, class_id, subject_id) DO NOTHING;

--------------------------------------------------------------------------------
-- 5. RÉACTIVATION / CRÉATION DES TRIGGERS STRICTS
--------------------------------------------------------------------------------

-- A. Réactivation du trigger canonique existant sur school_assessments
-- (Conserve intégralement toutes les protections de check_school_assessment_integrity et assign_assessment_to_period)
DROP TRIGGER IF EXISTS trg_school_assessment_integrity ON public.school_assessments;
CREATE TRIGGER trg_school_assessment_integrity
  BEFORE INSERT OR UPDATE ON public.school_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.check_school_assessment_integrity();

-- B. Trigger d'intégrité pour class_subject_settings
CREATE OR REPLACE FUNCTION public.validate_class_subject_settings_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class RECORD;
  v_subject RECORD;
  v_year RECORD;
BEGIN
  -- 1. Validation de la classe
  SELECT id, school_id, academic_year_id INTO v_class
  FROM public.classes WHERE id = NEW.class_id;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  IF v_class.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La classe appartient à un autre établissement.';
  END IF;

  IF v_class.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence académique : La classe n’appartient pas à cette année scolaire.';
  END IF;

  -- 2. Validation de la matière
  SELECT id, school_id INTO v_subject
  FROM public.subjects WHERE id = NEW.subject_id;

  IF v_subject.id IS NULL THEN
    RAISE EXCEPTION 'Matière introuvable.';
  END IF;

  IF v_subject.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La matière appartient à un autre établissement.';
  END IF;

  -- 3. Validation de l'année scolaire
  SELECT id, school_id INTO v_year
  FROM public.academic_years WHERE id = NEW.academic_year_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Année scolaire introuvable.';
  END IF;

  IF v_year.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire appartient à un autre établissement.';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_class_subject_settings_record() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_class_subject_settings ON public.class_subject_settings;
CREATE TRIGGER trg_validate_class_subject_settings
  BEFORE INSERT OR UPDATE ON public.class_subject_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_class_subject_settings_record();

-- C. Trigger de validation temporelle et de cycle sur school_homework
CREATE OR REPLACE FUNCTION public.validate_school_homework_period_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period RECORD;
  v_term RECORD;
  v_class RECORD;
BEGIN
  -- 1. Contrôle de la classe
  SELECT id, school_id, academic_year_id, education_cycle INTO v_class
  FROM public.classes WHERE id = NEW.class_id;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable pour ce devoir.';
  END IF;

  IF v_class.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La classe appartient à un autre établissement.';
  END IF;

  IF v_class.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence académique : La classe n’appartient pas à cette année scolaire.';
  END IF;

  -- 2. Contrôles stricts pour devoirs publiés ou clôturés
  IF NEW.status IN ('published', 'closed') THEN
    IF NEW.term_id IS NULL THEN
      RAISE EXCEPTION 'Le terme parent est obligatoire pour publier ou clôturer un devoir.';
    END IF;

    IF NEW.period_id IS NULL THEN
      RAISE EXCEPTION 'Une période scolaire est obligatoire pour publier ou clôturer un devoir.';
    END IF;

    -- Contrôle du terme
    SELECT id, school_id, academic_year_id, is_active
    INTO v_term
    FROM public.school_terms
    WHERE id = NEW.term_id;

    IF v_term.id IS NULL OR v_term.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Le terme sélectionné est inactif ou introuvable.';
    END IF;

    IF v_term.school_id IS DISTINCT FROM NEW.school_id OR v_term.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
      RAISE EXCEPTION 'Incohérence d’établissement ou d’année scolaire sur le terme du devoir.';
    END IF;

    -- Contrôle de la période
    SELECT id, school_id, academic_year_id, parent_term_id, education_cycle, starts_on, ends_on, is_active
    INTO v_period
    FROM public.school_periods
    WHERE id = NEW.period_id;

    IF v_period.id IS NULL OR v_period.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'La période scolaire sélectionnée est inactive ou introuvable.';
    END IF;

    IF v_period.school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La période appartient à un autre établissement.';
    END IF;

    IF v_period.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
      RAISE EXCEPTION 'Incohérence académique : La période appartient à une autre année scolaire.';
    END IF;

    IF v_period.education_cycle IS DISTINCT FROM v_class.education_cycle THEN
      RAISE EXCEPTION 'Incohérence de cycle : Le cycle de la période (%) ne correspond pas à celui de la classe (%).',
        v_period.education_cycle, v_class.education_cycle;
    END IF;

    IF v_period.parent_term_id IS DISTINCT FROM NEW.term_id THEN
      RAISE EXCEPTION 'Incohérence structurelle : La période n’appartient pas au terme parent spécifié.';
    END IF;

    IF v_period.starts_on IS NOT NULL AND v_period.ends_on IS NOT NULL THEN
      IF NEW.assigned_on < v_period.starts_on OR NEW.assigned_on > v_period.ends_on THEN
        RAISE EXCEPTION 'Date de devoir hors limites : La date d’assignation (%) doit être comprise dans la période scolaire (% au %).',
          NEW.assigned_on, v_period.starts_on, v_period.ends_on;
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_school_homework_period_rules() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_school_homework_period ON public.school_homework;
CREATE TRIGGER trg_validate_school_homework_period
  BEFORE INSERT OR UPDATE ON public.school_homework
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_school_homework_period_rules();

-- D. Trigger de validation supplémentaire sur student_grades (sans remplacer check_student_grade_integrity)
CREATE OR REPLACE FUNCTION public.validate_periodic_grade_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assessment RECORD;
  v_student RECORD;
  v_enrollment RECORD;
BEGIN
  -- 1. L’évaluation existe et n’est pas annulée
  SELECT id, school_id, class_id, academic_year_id, status INTO v_assessment
  FROM public.school_assessments WHERE id = NEW.assessment_id;

  IF v_assessment.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  IF v_assessment.status = 'cancelled' THEN
    RAISE EXCEPTION 'Saisie interdite : L’évaluation a été annulée.';
  END IF;

  IF v_assessment.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’évaluation appartient à un autre établissement.';
  END IF;

  -- 2. L’élève existe et possède un statut d'inscription actif
  SELECT id, school_id, enrollment_status INTO v_student
  FROM public.students WHERE id = NEW.student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Élève introuvable.';
  END IF;

  IF v_student.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’élève appartient à un autre établissement.';
  END IF;

  IF v_student.enrollment_status <> 'active' THEN
    RAISE EXCEPTION 'Saisie refusée : L’élève n’a pas un statut d’inscription actif.';
  END IF;

  -- 3. Inscription de l’élève
  SELECT id, student_id, class_id, academic_year_id, school_id, status INTO v_enrollment
  FROM public.student_enrollments WHERE id = NEW.enrollment_id;

  IF v_enrollment.id IS NULL THEN
    RAISE EXCEPTION 'Inscription de l’élève introuvable.';
  END IF;

  IF v_enrollment.student_id IS DISTINCT FROM NEW.student_id THEN
    RAISE EXCEPTION 'Incohérence : L’inscription ne correspond pas à cet élève.';
  END IF;

  IF v_enrollment.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’inscription appartient à un autre établissement.';
  END IF;

  IF v_enrollment.status <> 'active' THEN
    RAISE EXCEPTION 'Saisie refusée : L’inscription sélectionnée est inactive.';
  END IF;

  IF v_enrollment.class_id IS DISTINCT FROM v_assessment.class_id OR v_enrollment.academic_year_id IS DISTINCT FROM v_assessment.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence : L’inscription de l’élève ne correspond pas à la classe ou à l’année de l’évaluation.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_periodic_grade_rules() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_periodic_grade_rules ON public.student_grades;
CREATE TRIGGER trg_validate_periodic_grade_rules
  BEFORE INSERT OR UPDATE ON public.student_grades
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_periodic_grade_rules();

--------------------------------------------------------------------------------
-- 6. RPC 1 : MOYENNE D'UNE MATIÈRE PAR PÉRIODE (GET_STUDENT_SUBJECT_PERIOD_RESULT)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_student_subject_period_result(UUID, UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_student_subject_period_result(
  p_student_id UUID,
  p_subject_id UUID,
  p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_student RECORD;
  v_period RECORD;
  v_term RECORD;
  v_subject RECORD;
  v_class RECORD;
  v_enrollment RECORD;
  v_parent_link RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_assessment_cur RECORD;
  v_assessments_json JSONB := '[]'::jsonb;
  v_total_weighted_points NUMERIC := 0;
  v_total_effective_coefficient NUMERIC := 0;
  v_assessment_count INT := 0;
  v_completed_assessment_count INT := 0;
  v_pending_assessment_count INT := 0;
  v_excused_absence_count INT := 0;
  v_unexcused_absence_count INT := 0;
  v_final_percentage NUMERIC := NULL;
  v_is_complete BOOLEAN := true;
BEGIN
  -- 1. Validation de l'authentification
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  -- 2. Récupération de l'élève (colonnes réelles students & profiles)
  SELECT s.id, s.school_id, s.profile_id, s.enrollment_status, s.account_status,
         s.student_number,
         COALESCE(p.first_name, s.first_name, '') AS first_name,
         COALESCE(p.last_name, s.last_name, '') AS last_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.id = p_student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Élève introuvable';
  END IF;

  -- 3. Récupération de la période et du terme avec contrôles d'intégrité multi-écoles
  SELECT sp.id, sp.school_id, sp.academic_year_id, sp.parent_term_id, sp.name, sp.education_cycle, sp.is_active
  INTO v_period
  FROM public.school_periods sp
  WHERE sp.id = p_period_id;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Période scolaire introuvable';
  END IF;

  IF v_period.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'La période scolaire demandée est inactive.';
  END IF;

  IF v_period.school_id IS DISTINCT FROM v_student.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La période appartient à un autre établissement.';
  END IF;

  SELECT st.id, st.school_id, st.academic_year_id, st.education_cycle, st.name, st.division_type, st.is_active
  INTO v_term
  FROM public.school_terms st WHERE st.id = v_period.parent_term_id;

  IF v_term.id IS NULL OR v_term.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Le terme parent de la période est inactif ou introuvable.';
  END IF;

  IF v_term.school_id IS DISTINCT FROM v_period.school_id OR v_term.academic_year_id IS DISTINCT FROM v_period.academic_year_id OR v_term.education_cycle IS DISTINCT FROM v_period.education_cycle THEN
    RAISE EXCEPTION 'Incohérence structurelle entre le terme et la période scolaire.';
  END IF;

  -- 4. Récupération de la matière
  SELECT id, school_id, name, code INTO v_subject
  FROM public.subjects WHERE id = p_subject_id;

  IF v_subject.id IS NULL OR v_subject.school_id IS DISTINCT FROM v_student.school_id THEN
    RAISE EXCEPTION 'Matière introuvable dans cet établissement';
  END IF;

  -- 5. Récupération de l'inscription active de l'élève pour cette année (inclut homeroom_teacher_id)
  SELECT se.id, se.class_id, se.school_id, se.academic_year_id, se.status,
         c.name AS class_name, c.education_cycle, c.school_id AS class_school_id,
         c.homeroom_teacher_id
  INTO v_enrollment
  FROM public.student_enrollments se
  JOIN public.classes c ON c.id = se.class_id
  WHERE se.student_id = p_student_id
    AND se.school_id = v_student.school_id
    AND se.academic_year_id = v_period.academic_year_id
    AND se.status = 'active';

  IF v_enrollment.id IS NULL THEN
    RAISE EXCEPTION 'Inscription active introuvable pour cet élève sur cette période et année scolaire.';
  END IF;

  IF v_period.education_cycle IS DISTINCT FROM v_enrollment.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle entre la période et la classe de l’élève.';
  END IF;

  -- 6. Contrôle strict des autorisations d'accès par rôle
  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM v_student.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF v_caller_school_id IS DISTINCT FROM v_student.school_id THEN
      RAISE EXCEPTION 'Accès refusé';
    END IF;

    SELECT id, profile_id, employment_status, account_status
    INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid AND school_id = v_student.school_id;

    IF v_teacher.id IS NULL OR v_teacher.employment_status <> 'active' OR v_teacher.account_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Enseignant inactif ou introuvable.';
    END IF;

    -- Vérification si professeur titulaire (homeroom)
    IF v_enrollment.homeroom_teacher_id = v_uid OR v_enrollment.homeroom_teacher_id = v_teacher.id THEN
      v_is_homeroom := true;
    END IF;

    -- Autorisé si : affecté à la matière OU professeur titulaire de la classe
    IF NOT v_is_homeroom THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.teacher_class_assignments tca
        WHERE (tca.teacher_profile_id = v_uid OR tca.teacher_id = v_teacher.id)
          AND tca.class_id = v_enrollment.class_id
          AND tca.subject_id = p_subject_id
          AND tca.academic_year_id = v_period.academic_year_id
          AND tca.school_id = v_student.school_id
          AND tca.is_active = true
      ) THEN
        RAISE EXCEPTION 'Accès refusé : Vous n’êtes ni le professeur titulaire de cette classe ni affecté à cette matière.';
      END IF;
    END IF;

  ELSIF v_role = 'student' THEN
    IF v_student.profile_id IS DISTINCT FROM v_uid OR v_student.account_status <> 'active' OR v_student.enrollment_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres résultats scolaires.';
    END IF;

    -- Contrôle Calendrier Scolaire Actif
    IF NOT EXISTS (
      SELECT 1 FROM public.school_calendars
      WHERE school_id = v_period.school_id
        AND academic_year_id = v_period.academic_year_id
        AND education_cycle = v_period.education_cycle
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Le Calendrier Scolaire pour ce cycle n’est pas encore publié ou actif.';
    END IF;

  ELSIF v_role = 'parent' THEN
    SELECT psl.status, psl.can_view_academic, pa.account_status
    INTO v_parent_link
    FROM public.parent_student_links psl
    JOIN public.parent_accounts pa ON pa.profile_id = psl.parent_profile_id AND pa.school_id = psl.school_id
    WHERE psl.parent_profile_id = v_uid
      AND psl.student_id = p_student_id
      AND psl.school_id = v_student.school_id;

    IF v_parent_link.status IS DISTINCT FROM 'approved' OR v_parent_link.account_status <> 'active' OR v_parent_link.can_view_academic IS NOT TRUE THEN
      RAISE EXCEPTION 'Accès refusé : Lien parental non approuvé ou consultation académique désactivée.';
    END IF;

    -- Contrôle Calendrier Scolaire Actif
    IF NOT EXISTS (
      SELECT 1 FROM public.school_calendars
      WHERE school_id = v_period.school_id
        AND academic_year_id = v_period.academic_year_id
        AND education_cycle = v_period.education_cycle
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Le Calendrier Scolaire pour ce cycle n’est pas encore publié ou actif.';
    END IF;

  ELSE
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  -- 7. Calculs officiels sur les évaluations de la période (uniquement published ou closed)
  FOR v_assessment_cur IN (
    SELECT
      a.id AS assessment_id,
      a.title,
      a.assessment_type,
      a.assessment_date,
      a.max_score,
      a.coefficient,
      a.status,
      g.score,
      g.is_absent,
      g.is_excused,
      g.teacher_comment
    FROM public.school_assessments a
    LEFT JOIN public.student_grades g
      ON g.assessment_id = a.id
      AND g.student_id = p_student_id
    WHERE a.school_id = v_student.school_id
      AND a.academic_year_id = v_period.academic_year_id
      AND a.period_id = p_period_id
      AND a.class_id = v_enrollment.class_id
      AND a.subject_id = p_subject_id
      AND a.status IN ('published', 'closed')
    ORDER BY a.assessment_date ASC, a.created_at ASC
  ) LOOP
    v_assessment_count := v_assessment_count + 1;

    -- Cas A : Présent avec note saisie
    IF (v_assessment_cur.is_absent IS FALSE OR v_assessment_cur.is_absent IS NULL) AND v_assessment_cur.score IS NOT NULL THEN
      v_completed_assessment_count := v_completed_assessment_count + 1;
      v_total_weighted_points := v_total_weighted_points + ((v_assessment_cur.score / v_assessment_cur.max_score) * 100.0 * v_assessment_cur.coefficient);
      v_total_effective_coefficient := v_total_effective_coefficient + v_assessment_cur.coefficient;

      v_assessments_json := v_assessments_json || jsonb_build_object(
        'assessment_id', v_assessment_cur.assessment_id,
        'title', v_assessment_cur.title,
        'assessment_type', v_assessment_cur.assessment_type,
        'assessment_date', v_assessment_cur.assessment_date,
        'max_score', v_assessment_cur.max_score,
        'coefficient', v_assessment_cur.coefficient,
        'status', v_assessment_cur.status,
        'score', v_assessment_cur.score,
        'normalized_percentage', ROUND((v_assessment_cur.score / v_assessment_cur.max_score) * 100.0, 2),
        'is_absent', false,
        'is_excused', false,
        'pending_grade', false,
        'is_included_in_average', true,
        'teacher_comment', v_assessment_cur.teacher_comment
      );

    -- Cas B : Absence non justifiée (Zéro comptabilisé)
    ELSIF v_assessment_cur.is_absent IS TRUE AND v_assessment_cur.is_excused IS NOT TRUE THEN
      v_unexcused_absence_count := v_unexcused_absence_count + 1;
      v_completed_assessment_count := v_completed_assessment_count + 1;
      v_total_effective_coefficient := v_total_effective_coefficient + v_assessment_cur.coefficient;
      -- 0 * coefficient = 0

      v_assessments_json := v_assessments_json || jsonb_build_object(
        'assessment_id', v_assessment_cur.assessment_id,
        'title', v_assessment_cur.title,
        'assessment_type', v_assessment_cur.assessment_type,
        'assessment_date', v_assessment_cur.assessment_date,
        'max_score', v_assessment_cur.max_score,
        'coefficient', v_assessment_cur.coefficient,
        'status', v_assessment_cur.status,
        'score', NULL,
        'normalized_percentage', 0.0,
        'is_absent', true,
        'is_excused', false,
        'pending_grade', false,
        'is_included_in_average', true,
        'teacher_comment', v_assessment_cur.teacher_comment
      );

    -- Cas C : Absence justifiée (Exclusion totale sans pénalité)
    ELSIF v_assessment_cur.is_absent IS TRUE AND v_assessment_cur.is_excused IS TRUE THEN
      v_excused_absence_count := v_excused_absence_count + 1;

      v_assessments_json := v_assessments_json || jsonb_build_object(
        'assessment_id', v_assessment_cur.assessment_id,
        'title', v_assessment_cur.title,
        'assessment_type', v_assessment_cur.assessment_type,
        'assessment_date', v_assessment_cur.assessment_date,
        'max_score', v_assessment_cur.max_score,
        'coefficient', v_assessment_cur.coefficient,
        'status', v_assessment_cur.status,
        'score', NULL,
        'normalized_percentage', NULL,
        'is_absent', true,
        'is_excused', true,
        'pending_grade', false,
        'is_included_in_average', false,
        'teacher_comment', v_assessment_cur.teacher_comment
      );

    -- Cas D : Note manquante sans absence
    ELSE
      v_pending_assessment_count := v_pending_assessment_count + 1;
      v_is_complete := false;

      v_assessments_json := v_assessments_json || jsonb_build_object(
        'assessment_id', v_assessment_cur.assessment_id,
        'title', v_assessment_cur.title,
        'assessment_type', v_assessment_cur.assessment_type,
        'assessment_date', v_assessment_cur.assessment_date,
        'max_score', v_assessment_cur.max_score,
        'coefficient', v_assessment_cur.coefficient,
        'status', v_assessment_cur.status,
        'score', NULL,
        'normalized_percentage', NULL,
        'is_absent', false,
        'is_excused', false,
        'pending_grade', true,
        'is_included_in_average', false,
        'teacher_comment', v_assessment_cur.teacher_comment
      );
    END IF;
  END LOOP;

  -- 8. Calcul de la moyenne finale de la matière
  IF v_total_effective_coefficient > 0 THEN
    v_final_percentage := ROUND(v_total_weighted_points / v_total_effective_coefficient, 2);
  ELSE
    v_final_percentage := NULL;
  END IF;

  RETURN jsonb_build_object(
    'school_id', v_student.school_id,
    'academic_year_id', v_period.academic_year_id,
    'student_id', p_student_id,
    'enrollment_id', v_enrollment.id,
    'class_id', v_enrollment.class_id,
    'class_name', v_enrollment.class_name,
    'subject_id', p_subject_id,
    'subject_name', v_subject.name,
    'period_id', p_period_id,
    'period_name', v_period.name,
    'term_id', v_term.id,
    'term_name', v_term.name,
    'assessment_count', v_assessment_count,
    'completed_assessment_count', v_completed_assessment_count,
    'pending_assessment_count', v_pending_assessment_count,
    'excused_absence_count', v_excused_absence_count,
    'unexcused_absence_count', v_unexcused_absence_count,
    'total_assessment_coefficient', v_total_effective_coefficient,
    'subject_percentage', v_final_percentage,
    'is_complete', (v_assessment_count > 0 AND v_pending_assessment_count = 0),
    'assessments', v_assessments_json
  );
END;
$$;

--------------------------------------------------------------------------------
-- 7. RPC 2 : RÉSULTAT GÉNÉRAL D'UN ÉLÈVE POUR UNE PÉRIODE (GET_STUDENT_PERIOD_RESULT)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_student_period_result(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_student_period_result(
  p_student_id UUID,
  p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_student RECORD;
  v_period RECORD;
  v_term RECORD;
  v_enrollment RECORD;
  v_parent_link RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_assigned_subject_count INT := 0;
  v_total_class_subject_count INT := 0;
  v_subject_cur RECORD;
  v_subject_result JSONB;
  v_subjects_json JSONB := '[]'::jsonb;
  v_total_weighted_subjects NUMERIC := 0;
  v_total_subject_coefficients NUMERIC := 0;
  v_subjects_count INT := 0;
  v_completed_subjects_count INT := 0;
  v_pending_subjects_count INT := 0;
  v_overall_percentage NUMERIC := NULL;
  v_is_period_complete BOOLEAN := true;
BEGIN
  -- 1. Validation de l'authentification
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  -- 2. Récupération de l'élève (colonnes réelles de students et profiles)
  SELECT s.id, s.school_id, s.profile_id, s.enrollment_status, s.account_status,
         s.student_number,
         COALESCE(p.first_name, s.first_name, '') AS first_name,
         COALESCE(p.last_name, s.last_name, '') AS last_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.id = p_student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Élève introuvable';
  END IF;

  -- 3. Récupération de la période et du terme avec contrôles d'intégrité multi-écoles
  SELECT sp.id, sp.school_id, sp.academic_year_id, sp.parent_term_id, sp.name, sp.education_cycle, sp.is_active
  INTO v_period
  FROM public.school_periods sp
  WHERE sp.id = p_period_id;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Période scolaire introuvable';
  END IF;

  IF v_period.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'La période scolaire demandée est inactive.';
  END IF;

  IF v_period.school_id IS DISTINCT FROM v_student.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La période appartient à un autre établissement.';
  END IF;

  SELECT st.id, st.school_id, st.academic_year_id, st.education_cycle, st.name, st.is_active
  INTO v_term
  FROM public.school_terms st WHERE st.id = v_period.parent_term_id;

  IF v_term.id IS NULL OR v_term.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Le terme parent de la période est inactif ou introuvable.';
  END IF;

  IF v_term.school_id IS DISTINCT FROM v_period.school_id OR v_term.academic_year_id IS DISTINCT FROM v_period.academic_year_id OR v_term.education_cycle IS DISTINCT FROM v_period.education_cycle THEN
    RAISE EXCEPTION 'Incohérence structurelle entre le terme et la période scolaire.';
  END IF;

  -- 4. Récupération de l'inscription active de l'élève
  SELECT se.id, se.class_id, se.school_id, se.academic_year_id, se.status,
         c.name AS class_name, c.education_cycle, c.homeroom_teacher_id
  INTO v_enrollment
  FROM public.student_enrollments se
  JOIN public.classes c ON c.id = se.class_id
  WHERE se.student_id = p_student_id
    AND se.school_id = v_student.school_id
    AND se.academic_year_id = v_period.academic_year_id
    AND se.status = 'active';

  IF v_enrollment.id IS NULL THEN
    RAISE EXCEPTION 'Inscription active introuvable pour cet élève.';
  END IF;

  IF v_period.education_cycle IS DISTINCT FROM v_enrollment.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle entre la période et la classe de l’élève.';
  END IF;

  -- 5. Contrôle des autorisations d'accès par rôle
  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM v_student.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF v_caller_school_id IS DISTINCT FROM v_student.school_id THEN
      RAISE EXCEPTION 'Accès refusé';
    END IF;

    SELECT id, profile_id, employment_status, account_status
    INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid AND school_id = v_student.school_id;

    IF v_teacher.id IS NULL OR v_teacher.employment_status <> 'active' OR v_teacher.account_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Enseignant inactif ou introuvable.';
    END IF;

    -- Vérification si professeur titulaire (homeroom)
    IF v_enrollment.homeroom_teacher_id = v_uid OR v_enrollment.homeroom_teacher_id = v_teacher.id THEN
      v_is_homeroom := true;
    END IF;

    -- Si non titulaire, vérification de l'affectation à TOUTES les matières actives de la classe
    IF NOT v_is_homeroom THEN
      SELECT COUNT(DISTINCT subject_id) INTO v_total_class_subject_count
      FROM (
        SELECT DISTINCT subject_id
        FROM public.teacher_class_assignments
        WHERE class_id = v_enrollment.class_id
          AND academic_year_id = v_period.academic_year_id
          AND school_id = v_student.school_id
          AND is_active = true
          AND subject_id IS NOT NULL
        UNION
        SELECT subject_id
        FROM public.class_subject_settings
        WHERE class_id = v_enrollment.class_id
          AND academic_year_id = v_period.academic_year_id
          AND school_id = v_student.school_id
          AND is_active = true
          AND subject_id IS NOT NULL
      ) active_sbj;

      SELECT COUNT(DISTINCT subject_id) INTO v_assigned_subject_count
      FROM public.teacher_class_assignments
      WHERE (teacher_profile_id = v_uid OR teacher_id = v_teacher.id)
        AND class_id = v_enrollment.class_id
        AND academic_year_id = v_period.academic_year_id
        AND school_id = v_student.school_id
        AND is_active = true
        AND subject_id IS NOT NULL;

      IF v_total_class_subject_count = 0 OR v_assigned_subject_count < v_total_class_subject_count THEN
        RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire de la classe ou un enseignant affecté à toutes les matières peut consulter le résultat général. Veuillez utiliser le résultat par matière (get_student_subject_period_result).';
      END IF;
    END IF;

  ELSIF v_role = 'student' THEN
    IF v_student.profile_id IS DISTINCT FROM v_uid OR v_student.account_status <> 'active' OR v_student.enrollment_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres résultats scolaires.';
    END IF;

    -- Calendrier Actif requis
    IF NOT EXISTS (
      SELECT 1 FROM public.school_calendars
      WHERE school_id = v_period.school_id
        AND academic_year_id = v_period.academic_year_id
        AND education_cycle = v_period.education_cycle
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Le Calendrier Scolaire pour ce cycle n’est pas encore publié ou actif.';
    END IF;

  ELSIF v_role = 'parent' THEN
    SELECT psl.status, psl.can_view_academic, pa.account_status
    INTO v_parent_link
    FROM public.parent_student_links psl
    JOIN public.parent_accounts pa ON pa.profile_id = psl.parent_profile_id AND pa.school_id = psl.school_id
    WHERE psl.parent_profile_id = v_uid
      AND psl.student_id = p_student_id
      AND psl.school_id = v_student.school_id;

    IF v_parent_link.status IS DISTINCT FROM 'approved' OR v_parent_link.account_status <> 'active' OR v_parent_link.can_view_academic IS NOT TRUE THEN
      RAISE EXCEPTION 'Accès refusé : Lien parental non approuvé ou consultation académique désactivée.';
    END IF;

    -- Calendrier Actif requis
    IF NOT EXISTS (
      SELECT 1 FROM public.school_calendars
      WHERE school_id = v_period.school_id
        AND academic_year_id = v_period.academic_year_id
        AND education_cycle = v_period.education_cycle
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Le Calendrier Scolaire pour ce cycle n’est pas encore publié ou actif.';
    END IF;

  ELSE
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  -- 6. Parcours de toutes les matières actives de la classe
  FOR v_subject_cur IN (
    SELECT
      s.id AS subject_id,
      s.name AS subject_name,
      COALESCE(css.coefficient, 1.0) AS subject_coefficient
    FROM (
      SELECT DISTINCT subject_id
      FROM public.teacher_class_assignments
      WHERE class_id = v_enrollment.class_id
        AND academic_year_id = v_period.academic_year_id
        AND school_id = v_student.school_id
        AND is_active = true
        AND subject_id IS NOT NULL
      UNION
      SELECT subject_id
      FROM public.class_subject_settings
      WHERE class_id = v_enrollment.class_id
        AND academic_year_id = v_period.academic_year_id
        AND school_id = v_student.school_id
        AND is_active = true
        AND subject_id IS NOT NULL
    ) sub_list
    JOIN public.subjects s ON s.id = sub_list.subject_id
    LEFT JOIN public.class_subject_settings css
      ON css.class_id = v_enrollment.class_id
      AND css.subject_id = s.id
      AND css.academic_year_id = v_period.academic_year_id
      AND css.is_active = true
    WHERE s.is_active = true
    ORDER BY s.name ASC
  ) LOOP
    v_subjects_count := v_subjects_count + 1;

    -- Appel du calcul par matière (autorisé pour le professeur titulaire de la classe)
    v_subject_result := public.get_student_subject_period_result(
      p_student_id,
      v_subject_cur.subject_id,
      p_period_id
    );

    IF (v_subject_result->>'is_complete')::boolean IS TRUE AND (v_subject_result->>'subject_percentage') IS NOT NULL THEN
      v_completed_subjects_count := v_completed_subjects_count + 1;
      v_total_weighted_subjects := v_total_weighted_subjects + ((v_subject_result->>'subject_percentage')::numeric * v_subject_cur.subject_coefficient);
      v_total_subject_coefficients := v_total_subject_coefficients + v_subject_cur.subject_coefficient;
    ELSE
      v_pending_subjects_count := v_pending_subjects_count + 1;
      v_is_period_complete := false;
    END IF;

    v_subjects_json := v_subjects_json || jsonb_build_object(
      'subject_id', v_subject_cur.subject_id,
      'subject_name', v_subject_cur.subject_name,
      'subject_coefficient', v_subject_cur.subject_coefficient,
      'subject_percentage', (v_subject_result->>'subject_percentage')::numeric,
      'is_complete', (v_subject_result->>'is_complete')::boolean,
      'assessment_count', (v_subject_result->>'assessment_count')::int,
      'completed_assessment_count', (v_subject_result->>'completed_assessment_count')::int,
      'pending_assessment_count', (v_subject_result->>'pending_assessment_count')::int
    );
  END LOOP;

  -- 7. Calcul du pourcentage général
  IF v_total_subject_coefficients > 0 THEN
    v_overall_percentage := ROUND(v_total_weighted_subjects / v_total_subject_coefficients, 2);
  ELSE
    v_overall_percentage := NULL;
  END IF;

  RETURN jsonb_build_object(
    'school_id', v_student.school_id,
    'academic_year_id', v_period.academic_year_id,
    'student_id', p_student_id,
    'enrollment_id', v_enrollment.id,
    'student_number', COALESCE(v_student.student_number, ''),
    'student_name', TRIM(v_student.first_name || ' ' || v_student.last_name),
    'class_id', v_enrollment.class_id,
    'class_name', v_enrollment.class_name,
    'period_id', p_period_id,
    'period_name', v_period.name,
    'term_id', v_term.id,
    'term_name', v_term.name,
    'subjects_count', v_subjects_count,
    'completed_subjects_count', v_completed_subjects_count,
    'pending_subjects_count', v_pending_subjects_count,
    'total_subject_coefficients', v_total_subject_coefficients,
    'overall_percentage', v_overall_percentage,
    'is_complete', (v_subjects_count > 0 AND v_is_period_complete),
    'subjects', v_subjects_json
  );
END;
$$;

--------------------------------------------------------------------------------
-- 8. RPC 3 : RÉSULTATS D'UNE CLASSE POUR UNE PÉRIODE (GET_CLASS_PERIOD_RESULTS)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_class_period_results(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_class_period_results(
  p_class_id UUID,
  p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_class RECORD;
  v_period RECORD;
  v_term RECORD;
  v_teacher RECORD;
  v_student_cur RECORD;
  v_student_res JSONB;
  v_students_json JSONB := '[]'::jsonb;
BEGIN
  -- 1. Validation de l'authentification
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  -- 2. Récupération de la classe
  SELECT id, school_id, academic_year_id, name, education_cycle, homeroom_teacher_id INTO v_class
  FROM public.classes WHERE id = p_class_id;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable';
  END IF;

  -- 3. Récupération de la période avec contrôles de cohérence
  SELECT id, school_id, academic_year_id, parent_term_id, name, education_cycle, is_active INTO v_period
  FROM public.school_periods WHERE id = p_period_id;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Période scolaire introuvable';
  END IF;

  IF v_period.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'La période scolaire demandée est inactive.';
  END IF;

  IF v_period.school_id IS DISTINCT FROM v_class.school_id OR v_period.academic_year_id IS DISTINCT FROM v_class.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence entre la classe et la période scolaire.';
  END IF;

  IF v_period.education_cycle IS DISTINCT FROM v_class.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle entre la période et la classe.';
  END IF;

  SELECT id, school_id, academic_year_id, name, is_active INTO v_term
  FROM public.school_terms WHERE id = v_period.parent_term_id;

  IF v_term.id IS NULL OR v_term.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Le terme associé est inactif ou introuvable.';
  END IF;

  -- 4. Contrôle d'accès strict par rôle
  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM v_class.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF v_caller_school_id IS DISTINCT FROM v_class.school_id THEN
      RAISE EXCEPTION 'Accès refusé';
    END IF;

    SELECT id, profile_id, employment_status, account_status
    INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid AND school_id = v_class.school_id;

    IF v_teacher.id IS NULL OR v_teacher.employment_status <> 'active' OR v_teacher.account_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Enseignant inactif ou introuvable.';
    END IF;

    -- Seul le professeur titulaire (homeroom) a accès à la synthèse générale de toute la classe
    IF v_class.homeroom_teacher_id IS DISTINCT FROM v_uid AND v_class.homeroom_teacher_id IS DISTINCT FROM v_teacher.id THEN
      RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire de la classe peut consulter la synthèse générale de classe. Pour votre matière, veuillez utiliser le résultat par matière.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé à consulter la synthèse de classe.';
  END IF;

  -- 5. Parcours des élèves inscrits actifs
  FOR v_student_cur IN (
    SELECT
      s.id AS student_id,
      se.id AS enrollment_id,
      s.student_number,
      TRIM(COALESCE(p.first_name, s.first_name, '') || ' ' || COALESCE(p.last_name, s.last_name, '')) AS student_name
    FROM public.student_enrollments se
    JOIN public.students s ON s.id = se.student_id
    LEFT JOIN public.profiles p ON p.id = s.profile_id
    WHERE se.class_id = p_class_id
      AND se.academic_year_id = v_class.academic_year_id
      AND se.school_id = v_class.school_id
      AND se.status = 'active'
      AND s.enrollment_status = 'active'
    ORDER BY COALESCE(p.last_name, s.last_name, '') ASC, COALESCE(p.first_name, s.first_name, '') ASC
  ) LOOP
    v_student_res := public.get_student_period_result(v_student_cur.student_id, p_period_id);

    v_students_json := v_students_json || jsonb_build_object(
      'student_id', v_student_cur.student_id,
      'enrollment_id', v_student_cur.enrollment_id,
      'student_number', COALESCE(v_student_cur.student_number, ''),
      'student_name', v_student_cur.student_name,
      'overall_percentage', (v_student_res->>'overall_percentage')::numeric,
      'completed_subjects_count', (v_student_res->>'completed_subjects_count')::int,
      'pending_subjects_count', (v_student_res->>'pending_subjects_count')::int,
      'is_complete', (v_student_res->>'is_complete')::boolean
    );
  END LOOP;

  RETURN jsonb_build_object(
    'school_id', v_class.school_id,
    'academic_year_id', v_class.academic_year_id,
    'class_id', p_class_id,
    'class_name', v_class.name,
    'period_id', p_period_id,
    'period_name', v_period.name,
    'term_id', v_term.id,
    'term_name', v_term.name,
    'students_count', jsonb_array_length(v_students_json),
    'students', v_students_json
  );
END;
$$;

--------------------------------------------------------------------------------
-- 9. RPC 4 : GESTION DES COEFFICIENTS PAR CLASSE (UPSERT_CLASS_SUBJECT_COEFFICIENT)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.upsert_class_subject_coefficient(UUID, UUID, NUMERIC);
CREATE OR REPLACE FUNCTION public.upsert_class_subject_coefficient(
  p_class_id UUID,
  p_subject_id UUID,
  p_coefficient NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_class RECORD;
  v_subject RECORD;
  v_old_setting RECORD;
  v_new_id UUID;
BEGIN
  -- 1. Validation de l'administrateur appelant
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'school_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent configurer les coefficients de matières.';
  END IF;

  IF p_coefficient IS NULL OR p_coefficient <= 0 THEN
    RAISE EXCEPTION 'Le coefficient doit être un nombre strictement supérieur à zéro.';
  END IF;

  -- 2. Validation de la classe
  SELECT id, school_id, academic_year_id, name INTO v_class
  FROM public.classes WHERE id = p_class_id;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable';
  END IF;

  IF v_caller_role = 'school_admin' AND v_caller_school_id IS DISTINCT FROM v_class.school_id THEN
    RAISE EXCEPTION 'Accès refusé : Vous ne pouvez administrer que votre propre établissement.';
  END IF;

  -- 3. Validation de la matière
  SELECT id, school_id, name INTO v_subject
  FROM public.subjects WHERE id = p_subject_id;

  IF v_subject.id IS NULL OR v_subject.school_id IS DISTINCT FROM v_class.school_id THEN
    RAISE EXCEPTION 'Matière introuvable dans cet établissement';
  END IF;

  -- 4. Recherche de l'ancienne valeur
  SELECT * INTO v_old_setting
  FROM public.class_subject_settings
  WHERE school_id = v_class.school_id
    AND academic_year_id = v_class.academic_year_id
    AND class_id = p_class_id
    AND subject_id = p_subject_id;

  -- 5. Insertion ou mise à jour atomique
  INSERT INTO public.class_subject_settings (
    school_id,
    academic_year_id,
    class_id,
    subject_id,
    coefficient,
    is_active,
    created_by,
    updated_by,
    updated_at
  ) VALUES (
    v_class.school_id,
    v_class.academic_year_id,
    p_class_id,
    p_subject_id,
    p_coefficient,
    true,
    v_uid,
    v_uid,
    now()
  )
  ON CONFLICT (school_id, academic_year_id, class_id, subject_id)
  DO UPDATE SET
    coefficient = EXCLUDED.coefficient,
    is_active = true,
    updated_by = v_uid,
    updated_at = now()
  RETURNING id INTO v_new_id;

  -- 6. Journal d'audit conforme
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_class.school_id,
    v_uid,
    'class_subject_coefficient_updated',
    jsonb_build_object(
      'entity_type', 'class_subject_settings',
      'entity_id', v_new_id,
      'class_id', p_class_id,
      'class_name', v_class.name,
      'subject_id', p_subject_id,
      'subject_name', v_subject.name,
      'academic_year_id', v_class.academic_year_id,
      'old_coefficient', v_old_setting.coefficient,
      'new_coefficient', p_coefficient,
      'actor_id', v_uid,
      'date', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'setting_id', v_new_id,
    'class_id', p_class_id,
    'subject_id', p_subject_id,
    'coefficient', p_coefficient
  );
END;
$$;

--------------------------------------------------------------------------------
-- 10. POLITIQUES RLS SUR CLASS_SUBJECT_SETTINGS
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS class_subject_settings_select_policy ON public.class_subject_settings;
CREATE POLICY class_subject_settings_select_policy ON public.class_subject_settings
  FOR SELECT TO authenticated
  USING (
    public.can_user_read_school_calendar(class_subject_settings.school_id, (SELECT education_cycle FROM public.classes WHERE id = class_subject_settings.class_id))
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND (p.role = 'super_admin' OR (p.role = 'school_admin' AND p.school_id = class_subject_settings.school_id))
    )
  );

GRANT SELECT ON public.class_subject_settings TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.class_subject_settings FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 11. PRIVILÈGES ET PERMISSIONS (REVOKE / GRANT)
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_student_subject_period_result(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_period_result(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_class_period_results(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_class_subject_coefficient(UUID, UUID, NUMERIC) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_student_subject_period_result(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_period_result(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_period_results(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_class_subject_coefficient(UUID, UUID, NUMERIC) TO authenticated;

--------------------------------------------------------------------------------
-- 12. TESTS SQL ET REQUÊTES D'AUDIT DOCUMENTÉES
--------------------------------------------------------------------------------
/*
SCÉNARIOS DE TESTS DE VALIDATION DE LA PHASE 2F.2 :

1. Intégrité des fonctions et triggers maîtresses d'évaluation et de notes :
   - check_school_assessment_integrity() et assign_assessment_to_period() sont intégralement préservées avec leurs verrous transactionnels et structurels.
   - check_student_grade_integrity() et trg_student_grade_integrity restent intactes et actives.
   - validate_periodic_grade_rules() et trg_validate_periodic_grade_rules ajoutent le contrôle non-annulé et cohérence d'inscription.
   - save_student_grades() est préservée intacte.

2. Enseignant de matière vs Enseignant titulaire :
   - Enseignant de Mathématiques tente get_student_period_result() -> REJET : "Seul le professeur titulaire de la classe ou un enseignant affecté à toutes les matières peut consulter le résultat général."
   - Enseignant titulaire appelle get_student_period_result() -> SUCCÈS (il peut lire chaque matière via get_student_subject_period_result()).

3. Note normale présente :
   - Évaluation Max 20, Coeff 2. Note saisie: 16/20 -> 80%.
   - Résultat: 80% avec coeff 2 dans la moyenne.

4. Score supérieur au maximum :
   - Évaluation Max 20. Note saisie: 22.
   -> REJET TRG : "La note ne peut pas dépasser la note maximale."

5. Absence non justifiée (is_absent = true, is_excused = false) :
   - Note normalisée: 0%.
   - Le coefficient de l'évaluation est inclus dans le dénominateur.

6. Absence justifiée (is_absent = true, is_excused = true) :
   - Note normalisée: NULL.
   - Aucun zéro, coefficient non inclus dans le dénominateur de la moyenne.

7. Note manquante sans absence :
   - L'évaluation est marquée pending_grade = true.
   - is_complete = false, la note manquante n'est pas transformée silencieusement en zéro.

8. Évaluation annulée (status = 'cancelled') :
   - Exclue de tous les calculs de moyennes et de pourcentages.
   - Rejetée à la saisie de note par validate_periodic_grade_rules().

9. Matière avec coefficient personnalisé (ex: Coeff 4) :
   - Configurée via upsert_class_subject_coefficient(..., 4.0).
   - Le calcul de overall_percentage pondère la moyenne de cette matière par 4.0.

10. Parent non lié ou non approuvé :
    - get_student_period_result()
    -> REJET : "Accès refusé : Lien parental non approuvé ou consultation académique désactivée."

11. Enseignant non titulaire appelant la synthèse de classe :
    - get_class_period_results()
    -> REJET : "Accès refusé : Seul le professeur titulaire de la classe peut consulter la synthèse générale de classe."

--------------------------------------------------------------------------------
REQUÊTES D'AUDIT ET DE CONTRÔLE POST-MIGRATION :

-- 1. Détection des affectations actives avec subject_id NULL (à corriger par l'administration) :
SELECT id, school_id, teacher_id, class_id, academic_year_id
FROM public.teacher_class_assignments
WHERE is_active = true AND subject_id IS NULL;

-- 2. Détection des évaluations sans period_id (non rattachables automatiquement) :
SELECT id, school_id, class_id, subject_id, title, assessment_date, status
FROM public.school_assessments
WHERE period_id IS NULL;

-- 3. Détection des devoirs publiés sans period_id :
SELECT id, school_id, class_id, subject_id, title, assigned_on, status
FROM public.school_homework
WHERE status IN ('published', 'closed') AND period_id IS NULL;

-- 4. Détection des évaluations dont la date est hors de la période scolaire :
SELECT a.id, a.title, a.assessment_date, sp.name AS period_name, sp.starts_on, sp.ends_on
FROM public.school_assessments a
JOIN public.school_periods sp ON sp.id = a.period_id
WHERE sp.starts_on IS NOT NULL AND sp.ends_on IS NOT NULL
  AND (a.assessment_date < sp.starts_on OR a.assessment_date > sp.ends_on);

-- 5. Détection des notes liées à une inscription inactive :
SELECT g.id, g.student_id, g.enrollment_id, se.status AS enrollment_status
FROM public.student_grades g
JOIN public.student_enrollments se ON se.id = g.enrollment_id
WHERE se.status <> 'active';

-- 6. Détection des incohérences inter-écoles sur les évaluations :
SELECT a.id, a.school_id AS assessment_school, c.school_id AS class_school, sp.school_id AS period_school
FROM public.school_assessments a
JOIN public.classes c ON c.id = a.class_id
LEFT JOIN public.school_periods sp ON sp.id = a.period_id
WHERE a.school_id <> c.school_id OR (sp.id IS NOT NULL AND a.school_id <> sp.school_id);

-- 7. Détection des classes et matières sans class_subject_settings :
SELECT DISTINCT tca.class_id, tca.subject_id, tca.academic_year_id
FROM public.teacher_class_assignments tca
LEFT JOIN public.class_subject_settings css
  ON css.class_id = tca.class_id
 AND css.subject_id = tca.subject_id
 AND css.academic_year_id = tca.academic_year_id
WHERE tca.is_active = true AND tca.subject_id IS NOT NULL AND css.id IS NULL;
*/

COMMIT;
