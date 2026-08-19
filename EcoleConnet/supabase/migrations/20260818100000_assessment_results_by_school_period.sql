-- Migration Phase 2D.3.2 : Notes, Évaluations et Résultats par Période Scolaire (Version Renforcée & Sécurisée)
-- Fichier : supabase/migrations/20260818100000_assessment_results_by_school_period.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. SUPPRESSION PRÉALABLE DES ANCIENNES FONCTIONS RPC POUR MODIFICATION DU RETURNS TABLE
--------------------------------------------------------------------------------

-- Suppression des anciennes versions de lecture et de saisie pour éviter l'erreur PostgreSQL :
-- "cannot change return type of existing function"
DROP FUNCTION IF EXISTS public.get_teacher_assessments();
DROP FUNCTION IF EXISTS public.get_assessment_gradebook(UUID);
DROP FUNCTION IF EXISTS public.get_grades_for_student();
DROP FUNCTION IF EXISTS public.get_grades_for_student(UUID);
DROP FUNCTION IF EXISTS public.get_grades_for_parent_child(UUID);
DROP FUNCTION IF EXISTS public.get_student_period_results(UUID, UUID);
DROP FUNCTION IF EXISTS public.create_teacher_assessment(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, BOOLEAN);
DROP FUNCTION IF EXISTS public.create_teacher_assessment(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS public.update_teacher_assessment(UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.update_teacher_assessment(UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, TEXT, UUID);
DROP FUNCTION IF EXISTS public.assign_assessment_to_period(UUID, UUID, TEXT);

--------------------------------------------------------------------------------
-- 2. EXTENSION DE PUBLIC.SCHOOL_ASSESSMENTS (COLONNE PERIOD_ID & INDEX)
--------------------------------------------------------------------------------

ALTER TABLE public.school_assessments
  ADD COLUMN IF NOT EXISTS period_id UUID NULL REFERENCES public.school_periods(id) ON DELETE RESTRICT;

-- Index composite optimisé pour les requêtes de supervision et de saisie des notes par période
CREATE INDEX IF NOT EXISTS idx_school_assessments_period_lookup
  ON public.school_assessments (school_id, academic_year_id, term_id, period_id, class_id, subject_id, status);

CREATE INDEX IF NOT EXISTS idx_school_assessments_period_id
  ON public.school_assessments (period_id);

--------------------------------------------------------------------------------
-- 3. TRIGGER D'INTÉGRITÉ STRICTE SUR LES ÉVALUATIONS
--------------------------------------------------------------------------------

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
  v_cls_cycle TEXT;
  v_year_school_id UUID;
  v_year_is_current BOOLEAN;
  v_year_starts DATE;
  v_year_ends DATE;
  v_sbj_school_id UUID;
  v_sbj_active BOOLEAN;
  v_term_school_id UUID;
  v_term_year_id UUID;
  v_term_cycle TEXT;
  v_term_starts DATE;
  v_term_ends DATE;
  v_period_school_id UUID;
  v_period_year_id UUID;
  v_period_term_id UUID;
  v_period_cycle TEXT;
  v_period_starts DATE;
  v_period_ends DATE;
  v_has_active_assignment BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A1. Période obligatoire pour toute nouvelle évaluation
    IF NEW.period_id IS NULL THEN
      RAISE EXCEPTION 'Paramètre obligatoire manquant : La période (period_id) est obligatoire pour toute nouvelle évaluation.';
    END IF;

    -- A2. Vérification Année Scolaire (appartient à l'école ET est l'année courante)
    SELECT ay.school_id, ay.is_current, ay.starts_on, ay.ends_on 
    INTO v_year_school_id, v_year_is_current, v_year_starts, v_year_ends
    FROM public.academic_years ay
    WHERE ay.id = NEW.academic_year_id;

    IF v_year_school_id IS NULL OR v_year_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id;
    END IF;

    IF v_year_is_current IS NOT TRUE THEN
      RAISE EXCEPTION 'Accès refusé : L’année scolaire (%) n’est pas l’année scolaire courante de l’établissement.', NEW.academic_year_id;
    END IF;

    -- A3. Vérification Classe et Cycle
    SELECT c.school_id, c.academic_year_id, c.education_cycle 
    INTO v_cls_school_id, v_cls_year_id, v_cls_cycle
    FROM public.classes c
    WHERE c.id = NEW.class_id;

    IF v_cls_school_id IS NULL OR v_cls_school_id <> NEW.school_id OR v_cls_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La classe (%) n’appartient pas à la même école ou année scolaire.', NEW.class_id;
    END IF;

    IF v_cls_cycle IS NULL OR v_cls_cycle NOT IN ('primary', 'secondary') THEN
      RAISE EXCEPTION 'Cycle non défini : La classe (%) ne possède aucun cycle scolaire défini (primary ou secondary requis).', NEW.class_id;
    END IF;

    -- A4. Vérification Période
    SELECT sp.school_id, sp.academic_year_id, sp.parent_term_id, sp.education_cycle, sp.starts_on, sp.ends_on
    INTO v_period_school_id, v_period_year_id, v_period_term_id, v_period_cycle, v_period_starts, v_period_ends
    FROM public.school_periods sp
    WHERE sp.id = NEW.period_id;

    IF v_period_school_id IS NULL OR v_period_school_id <> NEW.school_id OR v_period_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La période (%) n’appartient pas à la même école ou année scolaire.', NEW.period_id;
    END IF;

    IF v_period_term_id IS NULL THEN
      RAISE EXCEPTION 'Structure invalide : La période (%) ne possède aucun trimestre/semestre parent.', NEW.period_id;
    END IF;

    -- Cohérence du cycle entre Période et Classe
    IF v_period_cycle IS DISTINCT FROM v_cls_cycle THEN
      RAISE EXCEPTION 'Incohérence de cycle : Le cycle de la période (%) ne correspond pas au cycle de la classe (%).', v_period_cycle, v_cls_cycle;
    END IF;

    -- Dérivation et vérification stricte du term_id
    IF NEW.term_id IS NOT NULL AND NEW.term_id IS DISTINCT FROM v_period_term_id THEN
      RAISE EXCEPTION 'Incohérence structurelle : Le trimestre/semestre spécifié (%) ne correspond pas au terme parent de la période (%).', NEW.term_id, v_period_term_id;
    END IF;

    NEW.term_id := v_period_term_id;

    -- A5. Vérification Trimestre / Semestre Parent
    SELECT st.school_id, st.academic_year_id, st.education_cycle, st.starts_on, st.ends_on
    INTO v_term_school_id, v_term_year_id, v_term_cycle, v_term_starts, v_term_ends
    FROM public.school_terms st
    WHERE st.id = NEW.term_id;

    IF v_term_school_id IS NULL OR v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : Le trimestre/semestre (%) n’appartient pas à la même école ou année scolaire.', NEW.term_id;
    END IF;

    IF v_term_cycle IS DISTINCT FROM v_cls_cycle THEN
      RAISE EXCEPTION 'Incohérence de cycle : Le cycle du trimestre/semestre parent (%) ne correspond pas au cycle de la classe (%).', v_term_cycle, v_cls_cycle;
    END IF;

    -- A6. Bornes temporelles de l'évaluation
    IF v_year_starts IS NOT NULL AND NEW.assessment_date < v_year_starts THEN
      RAISE EXCEPTION 'Date d’évaluation invalide : La date (%) est antérieure au début de l’année scolaire (%).', NEW.assessment_date, v_year_starts;
    END IF;

    IF v_year_ends IS NOT NULL AND NEW.assessment_date > v_year_ends THEN
      RAISE EXCEPTION 'Date d’évaluation invalide : La date (%) est postérieure à la fin de l’année scolaire (%).', NEW.assessment_date, v_year_ends;
    END IF;

    IF v_term_starts IS NOT NULL AND NEW.assessment_date < v_term_starts THEN
      RAISE EXCEPTION 'Date d’évaluation invalide : La date (%) est antérieure au début du trimestre/semestre (%).', NEW.assessment_date, v_term_starts;
    END IF;

    IF v_term_ends IS NOT NULL AND NEW.assessment_date > v_term_ends THEN
      RAISE EXCEPTION 'Date d’évaluation invalide : La date (%) est postérieure à la fin du trimestre/semestre (%).', NEW.assessment_date, v_term_ends;
    END IF;

    IF v_period_starts IS NOT NULL AND NEW.assessment_date < v_period_starts THEN
      RAISE EXCEPTION 'Date d’évaluation invalide : La date (%) est antérieure au début de la période scolaire (%).', NEW.assessment_date, v_period_starts;
    END IF;

    IF v_period_ends IS NOT NULL AND NEW.assessment_date > v_period_ends THEN
      RAISE EXCEPTION 'Date d’évaluation invalide : La date (%) est postérieure à la fin de la période scolaire (%).', NEW.assessment_date, v_period_ends;
    END IF;

    -- A7. Vérification Matière
    SELECT sb.school_id, sb.is_active INTO v_sbj_school_id, v_sbj_active
    FROM public.subjects sb
    WHERE sb.id = NEW.subject_id;

    IF v_sbj_school_id IS NULL OR v_sbj_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La matière (%) n’appartient pas à cet établissement.', NEW.subject_id;
    END IF;

    IF v_sbj_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Accès refusé : La matière sélectionnée est inactive.';
    END IF;

    -- A8. Vérification Enseignant
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

    -- A9. Vérification de l'affectation active exacte
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
    -- Verrouillage strict des champs structurels immuables
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

    -- Charger systématiquement la classe réelle et son cycle
    SELECT c.school_id, c.academic_year_id, c.education_cycle 
    INTO v_cls_school_id, v_cls_year_id, v_cls_cycle
    FROM public.classes c
    WHERE c.id = NEW.class_id;

    IF v_cls_cycle IS NULL OR v_cls_cycle NOT IN ('primary', 'secondary') THEN
      RAISE EXCEPTION 'Cycle non défini : La classe (%) ne possède aucun cycle scolaire défini.', NEW.class_id;
    END IF;

    -- Contrôle du changement de période
    IF NEW.period_id IS DISTINCT FROM OLD.period_id THEN
      -- Interdiction de supprimer la période d'une évaluation qui en possède déjà une
      IF OLD.period_id IS NOT NULL AND NEW.period_id IS NULL THEN
        RAISE EXCEPTION 'Modification interdite : La période d’une évaluation ne peut pas être annulée ou définie à NULL.';
      END IF;

      -- Marqueur transactionnel obligatoire pour modifier period_id
      IF current_setting('app.assessment_period_assignment_id', true) IS DISTINCT FROM NEW.id::text THEN
        RAISE EXCEPTION 'Modification interdite : La modification de la période d’une évaluation doit obligatoirement être effectuée via la fonction assign_assessment_to_period().';
      END IF;
    END IF;

    -- Vérification lorsque period_id est défini
    IF NEW.period_id IS NOT NULL THEN
      SELECT sp.school_id, sp.academic_year_id, sp.parent_term_id, sp.education_cycle, sp.starts_on, sp.ends_on
      INTO v_period_school_id, v_period_year_id, v_period_term_id, v_period_cycle, v_period_starts, v_period_ends
      FROM public.school_periods sp
      WHERE sp.id = NEW.period_id;

      IF v_period_school_id IS NULL OR v_period_school_id <> NEW.school_id OR v_period_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : La période (%) n’appartient pas à la même école ou année scolaire.', NEW.period_id;
      END IF;

      IF v_period_cycle IS DISTINCT FROM v_cls_cycle THEN
        RAISE EXCEPTION 'Incohérence de cycle : Le cycle de la période (%) ne correspond pas au cycle de la classe (%).', v_period_cycle, v_cls_cycle;
      END IF;

      IF v_period_term_id IS NULL THEN
        RAISE EXCEPTION 'Structure invalide : La période (%) ne possède aucun trimestre/semestre parent.', NEW.period_id;
      END IF;

      -- Imposer NEW.term_id = period.parent_term_id et refuser modification isolée
      IF NEW.term_id IS DISTINCT FROM v_period_term_id THEN
        RAISE EXCEPTION 'Incohérence structurelle : Le trimestre/semestre d’une évaluation doit toujours correspondre au parent_term_id de sa période.';
      END IF;

      NEW.term_id := v_period_term_id;

      -- Vérification des dates de période lors d'un changement de date
      IF v_period_starts IS NOT NULL AND NEW.assessment_date < v_period_starts THEN
        RAISE EXCEPTION 'Date d’évaluation invalide : La date (%) est antérieure au début de la période scolaire (%).', NEW.assessment_date, v_period_starts;
      END IF;

      IF v_period_ends IS NOT NULL AND NEW.assessment_date > v_period_ends THEN
        RAISE EXCEPTION 'Date d’évaluation invalide : La date (%) est postérieure à la fin de la période scolaire (%).', NEW.assessment_date, v_period_ends;
      END IF;

    ELSE
      -- Évaluation legacy sans period_id : refuser le changement isolé de term_id
      IF NEW.term_id IS DISTINCT FROM OLD.term_id THEN
        RAISE EXCEPTION 'Modification non autorisée : Pour modifier le découpage d’une évaluation sans période, veuillez utiliser la fonction de rattachement assign_assessment_to_period().';
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

--------------------------------------------------------------------------------
-- 4. CRÉATION D'ÉVALUATION PAR L'ENSEIGNANT (CREATE_TEACHER_ASSESSMENT)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_teacher_assessment(
  p_class_id UUID,
  p_subject_id UUID,
  p_period_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_assessment_type TEXT,
  p_assessment_date DATE,
  p_max_score NUMERIC,
  p_coefficient NUMERIC DEFAULT 1,
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
  v_period RECORD;
  v_term_id UUID;
  v_term_starts DATE;
  v_term_ends DATE;
  v_cls_cycle TEXT;
  v_has_assign BOOLEAN;
  v_subject_active BOOLEAN;
  v_assessment_id UUID;
  v_status TEXT := 'draft';
  v_published_at TIMESTAMPTZ := NULL;
BEGIN
  -- 1. Contrôle d'authentification
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

  -- 2. Création réservée exclusivement au rôle teacher actif
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

  -- 3. Vérification du dossier enseignant
  SELECT t.id, t.account_status, t.employment_status
  INTO v_teacher_id, v_teacher_acc, v_teacher_emp
  FROM public.teachers t
  WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

  IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
  END IF;

  -- 4. Interdiction de publication directe à la création
  IF p_publish_now IS TRUE THEN
    RAISE EXCEPTION 'Création directe en statut publié interdite : Une évaluation doit obligatoirement être créée en brouillon et ses notes saisies avant publication.';
  END IF;

  -- 5. Validation stricte des paramètres obligatoires
  IF p_class_id IS NULL THEN
    RAISE EXCEPTION 'Paramètre obligatoire manquant : La classe (p_class_id) est requise.';
  END IF;

  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'Paramètre obligatoire manquant : La matière (p_subject_id) est requise.';
  END IF;

  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'Paramètre obligatoire manquant : La période (p_period_id) est obligatoire.';
  END IF;

  IF p_assessment_date IS NULL THEN
    RAISE EXCEPTION 'Paramètre obligatoire manquant : La date d’évaluation (p_assessment_date) est requise.';
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le titre ne peut pas être vide.';
  END IF;

  IF p_max_score IS NULL OR p_max_score <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le barème maximal doit être supérieur à zéro.';
  END IF;

  IF p_coefficient IS NULL OR p_coefficient <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le coefficient doit être supérieur à zéro.';
  END IF;

  IF p_assessment_type NOT IN ('quiz', 'test', 'exam', 'homework', 'project', 'oral', 'practical', 'other') THEN
    RAISE EXCEPTION 'Paramètre invalide : Type d’évaluation non reconnu.';
  END IF;

  -- 6. Validation de la classe et de son cycle
  SELECT c.academic_year_id, c.education_cycle 
  INTO v_year_id, v_cls_cycle
  FROM public.classes c
  WHERE c.id = p_class_id AND c.school_id = v_school_id;

  IF v_year_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable dans votre établissement.';
  END IF;

  IF v_cls_cycle IS NULL OR v_cls_cycle NOT IN ('primary', 'secondary') THEN
    RAISE EXCEPTION 'Cycle de classe non défini : La classe doit avoir un cycle primary ou secondary.';
  END IF;

  -- 7. Validation de la matière
  SELECT sb.is_active INTO v_subject_active
  FROM public.subjects sb
  WHERE sb.id = p_subject_id AND sb.school_id = v_school_id;

  IF v_subject_active IS NULL THEN
    RAISE EXCEPTION 'Matière introuvable dans votre établissement.';
  END IF;

  IF v_subject_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Matière inactive : Impossible de créer une évaluation pour une matière désactivée.';
  END IF;

  -- 8. Validation et dérivation de la période et du terme parent
  SELECT sp.id, sp.parent_term_id, sp.starts_on, sp.ends_on, sp.education_cycle, sp.name
  INTO v_period
  FROM public.school_periods sp
  WHERE sp.id = p_period_id 
    AND sp.school_id = v_school_id 
    AND sp.academic_year_id = v_year_id;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Période scolaire invalide ou introuvable pour cette année scolaire.';
  END IF;

  IF v_period.parent_term_id IS NULL THEN
    RAISE EXCEPTION 'Structure invalide : La période sélectionnée n’a aucun terme parent configuré.';
  END IF;

  IF v_period.education_cycle IS DISTINCT FROM v_cls_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle : La période (%) ne correspond pas au cycle de la classe (%).', v_period.education_cycle, v_cls_cycle;
  END IF;

  v_term_id := v_period.parent_term_id;

  IF p_term_id IS NOT NULL AND p_term_id IS DISTINCT FROM v_term_id THEN
    RAISE EXCEPTION 'Incohérence structurelle : La période (%) n’appartient pas au trimestre/semestre spécifié.', v_period.name;
  END IF;

  -- Validation des dates par rapport à l'année, au terme et à la période
  SELECT ay.starts_on, ay.ends_on INTO v_year_starts, v_year_ends
  FROM public.academic_years ay
  WHERE ay.id = v_year_id AND ay.school_id = v_school_id;

  IF v_year_starts IS NOT NULL AND p_assessment_date < v_year_starts THEN
    RAISE EXCEPTION 'Date d’évaluation hors de l’année scolaire (antérieure au %).', v_year_starts;
  END IF;

  IF v_year_ends IS NOT NULL AND p_assessment_date > v_year_ends THEN
    RAISE EXCEPTION 'Date d’évaluation hors de l’année scolaire (postérieure au %).', v_year_ends;
  END IF;

  SELECT st.starts_on, st.ends_on INTO v_term_starts, v_term_ends
  FROM public.school_terms st
  WHERE st.id = v_term_id AND st.school_id = v_school_id AND st.academic_year_id = v_year_id;

  IF v_term_starts IS NOT NULL AND p_assessment_date < v_term_starts THEN
    RAISE EXCEPTION 'Date d’évaluation antérieure au début du trimestre/semestre sélectionné (%).', v_term_starts;
  END IF;

  IF v_term_ends IS NOT NULL AND p_assessment_date > v_term_ends THEN
    RAISE EXCEPTION 'Date d’évaluation postérieure à la fin du trimestre/semestre sélectionné (%).', v_term_ends;
  END IF;

  IF v_period.starts_on IS NOT NULL AND p_assessment_date < v_period.starts_on THEN
    RAISE EXCEPTION 'Date d’évaluation antérieure au début de la période scolaire sélectionnée (%).', v_period.starts_on;
  END IF;

  IF v_period.ends_on IS NOT NULL AND p_assessment_date > v_period.ends_on THEN
    RAISE EXCEPTION 'Date d’évaluation postérieure à la fin de la période scolaire sélectionnée (%).', v_period.ends_on;
  END IF;

  -- 9. Vérification stricte de l'affectation active de l'enseignant
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
    RAISE EXCEPTION 'Affectation non autorisée : Vous n’êtes pas affecté à cette classe et matière pour l’année active.';
  END IF;

  -- 10. Insertion de l'évaluation en statut 'draft'
  v_status := 'draft';
  v_published_at := NULL;

  INSERT INTO public.school_assessments (
    school_id,
    academic_year_id,
    term_id,
    period_id,
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
    v_term_id,
    p_period_id,
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

  -- 11. Journalisation d'audit
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
      'period_id', p_period_id,
      'term_id', v_term_id,
      'status', v_status,
      'max_score', p_max_score,
      'coefficient', COALESCE(p_coefficient, 1)
    )
  );

  RETURN v_assessment_id;
END;
$$;

--------------------------------------------------------------------------------
-- 5. MODIFICATION D'ÉVALUATION (UPDATE_TEACHER_ASSESSMENT)
--------------------------------------------------------------------------------

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
  v_period RECORD;
  v_effective_term_id UUID;
  v_term_starts DATE;
  v_term_ends DATE;
  v_year_starts DATE;
  v_year_ends DATE;
  v_has_excessive_scores BOOLEAN;
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

  -- Validation null-safe des paramètres obligatoires
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le titre ne peut pas être vide.';
  END IF;

  IF p_assessment_date IS NULL THEN
    RAISE EXCEPTION 'Paramètre invalide : La date d’évaluation est obligatoire.';
  END IF;

  IF p_assessment_type IS NULL OR p_assessment_type NOT IN ('quiz', 'test', 'exam', 'homework', 'project', 'oral', 'practical', 'other') THEN
    RAISE EXCEPTION 'Paramètre invalide : Type d’évaluation non reconnu.';
  END IF;

  IF p_max_score IS NULL OR p_max_score <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le barème doit être strictement supérieur à zéro.';
  END IF;

  IF p_coefficient IS NULL OR p_coefficient <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le coefficient doit être strictement supérieur à zéro.';
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

  -- Une évaluation annulée est définitivement verrouillée
  IF v_asmt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Opération interdite : Une évaluation annulée ne peut plus être modifiée.';
  END IF;

  -- Contrôle strict des permissions selon le rôle
  IF v_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_teacher_id, v_teacher_acc, v_teacher_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

    IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
    END IF;

    -- Contrôle strict du titulaire (aucun fallback created_by)
    IF v_asmt.teacher_id IS DISTINCT FROM v_teacher_id THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez modifier que les évaluations dont vous êtes le titulaire.';
    END IF;

    -- Un enseignant peut modifier UNIQUEMENT une évaluation draft ou reopened
    IF v_asmt.status NOT IN ('draft', 'reopened') THEN
      RAISE EXCEPTION 'Opération interdite : Un enseignant ne peut modifier que des évaluations en statut draft ou reopened. Statut actuel: %', v_asmt.status;
    END IF;

  ELSIF v_role IN ('school_admin', 'super_admin') THEN
    -- Admin et Super-Admin doivent fournir un motif d'au moins 5 caractères si l'évaluation est published, closed ou reopened
    IF v_asmt.status IN ('published', 'closed', 'reopened') THEN
      IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Motif administratif obligatoire : Un motif explicite (au moins 5 caractères) est requis pour modifier une évaluation en statut %.', v_asmt.status;
      END IF;
    END IF;
  END IF;

  -- Validation barème vs notes existantes
  SELECT EXISTS (
    SELECT 1 FROM public.student_grades sg
    WHERE sg.assessment_id = p_assessment_id
      AND sg.is_absent = false
      AND sg.score IS NOT NULL
      AND sg.score > p_max_score
  ) INTO v_has_excessive_scores;

  IF v_has_excessive_scores THEN
    RAISE EXCEPTION 'Nouveau barème incompatible : Des notes déjà saisies dépassent %.', p_max_score;
  END IF;

  -- Initialisation scalaire sûre du terme effectif
  v_effective_term_id := v_asmt.term_id;

  -- Gestion stricte de la cohérence term_id / period_id (sans jamais accéder à un RECORD non affecté)
  IF v_asmt.period_id IS NOT NULL THEN
    SELECT sp.parent_term_id, sp.starts_on, sp.ends_on 
    INTO v_period
    FROM public.school_periods sp
    WHERE sp.id = v_asmt.period_id;

    IF v_period.parent_term_id IS NULL THEN
      RAISE EXCEPTION 'Structure invalide : La période (%) ne possède aucun terme parent.', v_asmt.period_id;
    END IF;

    v_effective_term_id := v_period.parent_term_id;

    IF p_term_id IS NOT NULL AND p_term_id IS DISTINCT FROM v_effective_term_id THEN
      RAISE EXCEPTION 'Incohérence structurelle : Le trimestre/semestre ne peut pas être modifié indépendamment de la période. Utilisez assign_assessment_to_period() pour changer de période.';
    END IF;

    IF v_period.starts_on IS NOT NULL AND p_assessment_date < v_period.starts_on THEN
      RAISE EXCEPTION 'Date d’évaluation antérieure au début de la période scolaire (%).', v_period.starts_on;
    END IF;

    IF v_period.ends_on IS NOT NULL AND p_assessment_date > v_period.ends_on THEN
      RAISE EXCEPTION 'Date d’évaluation postérieure à la fin de la période scolaire (%).', v_period.ends_on;
    END IF;
  ELSE
    IF p_term_id IS NOT NULL AND p_term_id IS DISTINCT FROM v_effective_term_id THEN
      RAISE EXCEPTION 'Modification non autorisée : Pour modifier le découpage d’une évaluation sans période, utilisez la fonction assign_assessment_to_period().';
    END IF;
  END IF;

  -- Validation dates année et terme
  SELECT ay.starts_on, ay.ends_on INTO v_year_starts, v_year_ends
  FROM public.academic_years ay
  WHERE ay.id = v_asmt.academic_year_id;

  IF v_year_starts IS NOT NULL AND p_assessment_date < v_year_starts THEN
    RAISE EXCEPTION 'Date d’évaluation hors de l’année scolaire (antérieure au %).', v_year_starts;
  END IF;

  IF v_year_ends IS NOT NULL AND p_assessment_date > v_year_ends THEN
    RAISE EXCEPTION 'Date d’évaluation hors de l’année scolaire (postérieure au %).', v_year_ends;
  END IF;

  IF v_effective_term_id IS NOT NULL THEN
    SELECT st.starts_on, st.ends_on INTO v_term_starts, v_term_ends
    FROM public.school_terms st
    WHERE st.id = v_effective_term_id;

    IF v_term_starts IS NOT NULL AND p_assessment_date < v_term_starts THEN
      RAISE EXCEPTION 'Date d’évaluation antérieure au début du trimestre/semestre (%).', v_term_starts;
    END IF;

    IF v_term_ends IS NOT NULL AND p_assessment_date > v_term_ends THEN
      RAISE EXCEPTION 'Date d’évaluation postérieure à la fin du trimestre/semestre (%).', v_term_ends;
    END IF;
  END IF;

  -- Construction JSON d'audit
  v_old_data := jsonb_build_object(
    'title', v_asmt.title,
    'description', v_asmt.description,
    'assessment_type', v_asmt.assessment_type,
    'assessment_date', v_asmt.assessment_date,
    'max_score', v_asmt.max_score,
    'coefficient', v_asmt.coefficient,
    'period_id', v_asmt.period_id,
    'term_id', v_asmt.term_id,
    'status', v_asmt.status
  );

  v_new_data := jsonb_build_object(
    'title', trim(p_title),
    'description', p_description,
    'assessment_type', p_assessment_type,
    'assessment_date', p_assessment_date,
    'max_score', p_max_score,
    'coefficient', p_coefficient,
    'period_id', v_asmt.period_id,
    'term_id', v_effective_term_id,
    'status', v_asmt.status
  );

  -- Mise à jour
  UPDATE public.school_assessments
  SET title = trim(p_title),
      description = p_description,
      assessment_type = p_assessment_type,
      assessment_date = p_assessment_date,
      max_score = p_max_score,
      coefficient = p_coefficient,
      term_id = v_effective_term_id,
      updated_at = now()
  WHERE id = p_assessment_id;

  -- Journalisation d'audit
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
      'reason', trim(p_reason)
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 6. RPC DE RATTACHEMENT D'UNE ÉVALUATION À UNE PÉRIODE (ASSIGN_ASSESSMENT_TO_PERIOD)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_assessment_to_period(
  p_assessment_id UUID,
  p_period_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
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
  v_tch_acc TEXT;
  v_tch_emp TEXT;
  v_asmt RECORD;
  v_period RECORD;
  v_term RECORD;
  v_cls RECORD;
  v_clean_reason TEXT;
  v_year_starts DATE;
  v_year_ends DATE;
  v_has_active_assignment BOOLEAN;
BEGIN
  -- 1. Authentification
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

  -- 2. Validation du motif
  v_clean_reason := trim(p_reason);
  IF v_clean_reason IS NULL OR length(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'Validation échouée : Un motif explicatif d’au moins 5 caractères est obligatoire.';
  END IF;

  -- 3. Validation paramètre période
  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'Paramètre obligatoire manquant : La période cible est obligatoire.';
  END IF;

  -- 4. Verrouillage de l'évaluation
  SELECT * INTO v_asmt
  FROM public.school_assessments sa
  WHERE sa.id = p_assessment_id
  FOR UPDATE;

  IF v_asmt.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  -- 5. Contrôle des autorisations selon le rôle
  IF v_caller_role = 'teacher' THEN
    IF v_caller_school_id IS NULL OR v_asmt.school_id <> v_caller_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Cette évaluation n’appartient pas à votre établissement.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_caller_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Établissement suspendu ou inactif.';
    END IF;

    SELECT t.id, t.account_status, t.employment_status
    INTO v_tch_id, v_tch_acc, v_tch_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_caller_school_id;

    IF v_tch_id IS NULL OR v_tch_acc <> 'active' OR v_tch_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Dossier enseignant inactif.';
    END IF;

    -- Contrôle strict du titulaire exact (aucun fallback created_by)
    IF v_asmt.teacher_id IS DISTINCT FROM v_tch_id THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez modifier la période que des évaluations dont vous êtes le titulaire.';
    END IF;

    IF v_asmt.status NOT IN ('draft', 'reopened') THEN
      RAISE EXCEPTION 'Accès refusé : Seul l’administrateur peut modifier la période d’une évaluation publiée ou clôturée.';
    END IF;

    -- Vérification de l'affectation active exacte
    SELECT EXISTS (
      SELECT 1 FROM public.teacher_class_assignments tca
      WHERE tca.school_id = v_asmt.school_id
        AND tca.teacher_id = v_tch_id
        AND tca.class_id = v_asmt.class_id
        AND tca.subject_id = v_asmt.subject_id
        AND tca.academic_year_id = v_asmt.academic_year_id
        AND tca.is_active = true
    ) INTO v_has_active_assignment;

    IF NOT v_has_active_assignment THEN
      RAISE EXCEPTION 'Accès refusé : Aucune affectation active pour cet enseignant sur la classe et matière de l’évaluation.';
    END IF;

  ELSIF v_caller_role = 'school_admin' THEN
    IF v_caller_school_id IS NULL OR v_asmt.school_id <> v_caller_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Cette évaluation appartient à un autre établissement.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_caller_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Établissement suspendu ou inactif.';
    END IF;

  ELSIF v_caller_role = 'super_admin' THEN
    -- Super-Admin autorisé globalement (même sur école suspendue pour audit/remédiation)
    NULL;
  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  -- 6. Validation de la nouvelle période
  SELECT sp.id, sp.school_id, sp.academic_year_id, sp.parent_term_id, sp.education_cycle, sp.starts_on, sp.ends_on, sp.name
  INTO v_period
  FROM public.school_periods sp
  WHERE sp.id = p_period_id;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Période scolaire cible introuvable.';
  END IF;

  IF v_period.school_id <> v_asmt.school_id OR v_period.academic_year_id <> v_asmt.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence : La période cible n’appartient pas au même établissement ou à la même année scolaire.';
  END IF;

  IF v_period.parent_term_id IS NULL THEN
    RAISE EXCEPTION 'Structure invalide : La période cible ne possède aucun trimestre/semestre parent.';
  END IF;

  -- 7. Validation du trimestre/semestre parent
  SELECT st.id, st.school_id, st.academic_year_id, st.education_cycle, st.starts_on, st.ends_on, st.name
  INTO v_term
  FROM public.school_terms st
  WHERE st.id = v_period.parent_term_id;

  IF v_term.id IS NULL OR v_term.school_id <> v_asmt.school_id OR v_term.academic_year_id <> v_asmt.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence : Le trimestre/semestre parent de la période est invalide ou incompatible.';
  END IF;

  -- 8. Validation de la classe et des cycles
  SELECT c.id, c.education_cycle 
  INTO v_cls
  FROM public.classes c
  WHERE c.id = v_asmt.class_id;

  IF v_cls.education_cycle IS NULL OR v_cls.education_cycle NOT IN ('primary', 'secondary') THEN
    RAISE EXCEPTION 'Cycle de classe non défini : La classe doit avoir un cycle primary ou secondary.';
  END IF;

  IF v_period.education_cycle IS DISTINCT FROM v_cls.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle : Le cycle de la période (%) ne correspond pas au cycle de la classe (%).', v_period.education_cycle, v_cls.education_cycle;
  END IF;

  IF v_term.education_cycle IS DISTINCT FROM v_cls.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle : Le cycle du trimestre parent (%) ne correspond pas au cycle de la classe (%).', v_term.education_cycle, v_cls.education_cycle;
  END IF;

  -- 9. Validation des dates de l'évaluation avec la nouvelle période
  SELECT ay.starts_on, ay.ends_on INTO v_year_starts, v_year_ends
  FROM public.academic_years ay
  WHERE ay.id = v_asmt.academic_year_id;

  IF v_year_starts IS NOT NULL AND v_asmt.assessment_date < v_year_starts THEN
    RAISE EXCEPTION 'Date d’évaluation hors de l’année scolaire (antérieure au %).', v_year_starts;
  END IF;

  IF v_year_ends IS NOT NULL AND v_asmt.assessment_date > v_year_ends THEN
    RAISE EXCEPTION 'Date d’évaluation hors de l’année scolaire (postérieure au %).', v_year_ends;
  END IF;

  IF v_term.starts_on IS NOT NULL AND v_asmt.assessment_date < v_term.starts_on THEN
    RAISE EXCEPTION 'Date d’évaluation antérieure au début du trimestre parent (%).', v_term.starts_on;
  END IF;

  IF v_term.ends_on IS NOT NULL AND v_asmt.assessment_date > v_term.ends_on THEN
    RAISE EXCEPTION 'Date d’évaluation postérieure à la fin du trimestre parent (%).', v_term.ends_on;
  END IF;

  IF v_period.starts_on IS NOT NULL AND v_asmt.assessment_date < v_period.starts_on THEN
    RAISE EXCEPTION 'Date d’évaluation antérieure au début de la période scolaire (%).', v_period.starts_on;
  END IF;

  IF v_period.ends_on IS NOT NULL AND v_asmt.assessment_date > v_period.ends_on THEN
    RAISE EXCEPTION 'Date d’évaluation postérieure à la fin de la période scolaire (%).', v_period.ends_on;
  END IF;

  -- 10. Poser le marqueur transactionnel local pour autoriser l'UPDATE de period_id dans le trigger
  PERFORM set_config('app.assessment_period_assignment_id', p_assessment_id::text, true);

  -- 11. Mise à jour de l'évaluation (notes et statut inchangés)
  UPDATE public.school_assessments
  SET period_id = p_period_id,
      term_id = v_period.parent_term_id,
      updated_at = now()
  WHERE id = p_assessment_id;

  -- Nettoyer le marqueur transactionnel immédiatement après l'UPDATE
  PERFORM set_config('app.assessment_period_assignment_id', '', true);

  -- 12. Journalisation d'audit détaillée
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_asmt.school_id,
    v_uid,
    'assessment_period_assigned',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', p_assessment_id,
      'assessment_id', p_assessment_id,
      'old_period_id', v_asmt.period_id,
      'new_period_id', p_period_id,
      'old_term_id', v_asmt.term_id,
      'new_term_id', v_period.parent_term_id,
      'class_id', v_asmt.class_id,
      'subject_id', v_asmt.subject_id,
      'academic_year_id', v_asmt.academic_year_id,
      'education_cycle', v_period.education_cycle,
      'assessment_status', v_asmt.status,
      'reason', v_clean_reason
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 7. LECTURES ET RPC EXISTANTES MISES À JOUR
--------------------------------------------------------------------------------

-- A. get_teacher_assessments()
CREATE OR REPLACE FUNCTION public.get_teacher_assessments()
RETURNS TABLE (
  id UUID,
  school_id UUID,
  academic_year_id UUID,
  term_id UUID,
  term_name TEXT,
  period_id UUID,
  period_name TEXT,
  period_position INT,
  position_within_parent INT,
  division_type TEXT,
  education_cycle TEXT,
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
      sa.period_id,
      sp.name AS period_name,
      sp.position AS period_position,
      sp.position_within_parent AS position_within_parent,
      st.division_type AS division_type,
      COALESCE(sp.education_cycle, st.education_cycle, c.education_cycle) AS education_cycle,
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
    LEFT JOIN public.school_periods sp ON sp.id = sa.period_id
    LEFT JOIN public.student_grades sg ON sg.assessment_id = sa.id AND sg.is_absent = false
    WHERE sa.school_id = v_caller_school_id
      AND sa.teacher_id = v_tch_id
    GROUP BY sa.id, st.name, st.division_type, st.education_cycle, sp.name, sp.position, sp.position_within_parent, sp.education_cycle, c.name, c.education_cycle, sb.name, t.first_name, t.last_name
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
      sa.period_id,
      sp.name AS period_name,
      sp.position AS period_position,
      sp.position_within_parent AS position_within_parent,
      st.division_type AS division_type,
      COALESCE(sp.education_cycle, st.education_cycle, c.education_cycle) AS education_cycle,
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
    LEFT JOIN public.school_periods sp ON sp.id = sa.period_id
    LEFT JOIN public.student_grades sg ON sg.assessment_id = sa.id AND sg.is_absent = false
    WHERE sa.school_id = v_caller_school_id
    GROUP BY sa.id, st.name, st.division_type, st.education_cycle, sp.name, sp.position, sp.position_within_parent, sp.education_cycle, c.name, c.education_cycle, sb.name, t.first_name, t.last_name
    ORDER BY sa.assessment_date DESC, sa.created_at DESC;

  ELSIF v_caller_role = 'super_admin' THEN
    RETURN QUERY
    SELECT
      sa.id,
      sa.school_id,
      sa.academic_year_id,
      sa.term_id,
      st.name AS term_name,
      sa.period_id,
      sp.name AS period_name,
      sp.position AS period_position,
      sp.position_within_parent AS position_within_parent,
      st.division_type AS division_type,
      COALESCE(sp.education_cycle, st.education_cycle, c.education_cycle) AS education_cycle,
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
    LEFT JOIN public.school_periods sp ON sp.id = sa.period_id
    LEFT JOIN public.student_grades sg ON sg.assessment_id = sa.id AND sg.is_absent = false
    GROUP BY sa.id, st.name, st.division_type, st.education_cycle, sp.name, sp.position, sp.position_within_parent, sp.education_cycle, c.name, c.education_cycle, sb.name, t.first_name, t.last_name
    ORDER BY sa.assessment_date DESC, sa.created_at DESC;

  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;
END;
$$;

-- B. get_assessment_gradebook(p_assessment_id UUID)
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
  period_id UUID,
  period_name TEXT,
  period_position INT,
  position_within_parent INT,
  term_id UUID,
  term_name TEXT,
  division_type TEXT,
  education_cycle TEXT,
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

  IF v_caller_role NOT IN ('teacher', 'school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé à accéder au carnet de notes.';
  END IF;

  SELECT 
    sa.*,
    sp.name AS period_name,
    sp.position AS period_position,
    sp.position_within_parent AS position_within_parent,
    st.name AS term_name,
    st.division_type,
    COALESCE(sp.education_cycle, st.education_cycle) AS education_cycle
  INTO v_asmt
  FROM public.school_assessments sa
  LEFT JOIN public.school_periods sp ON sp.id = sa.period_id
  LEFT JOIN public.school_terms st ON st.id = sa.term_id
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

    -- Contrôle strict du titulaire (aucun fallback created_by)
    IF v_asmt.teacher_id IS DISTINCT FROM v_tch_id THEN
      RAISE EXCEPTION 'Accès refusé : Seul l’enseignant titulaire ou l’administration peut consulter le carnet complet.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_asmt.id AS assessment_id,
    st_stud.id AS student_id,
    se.id AS enrollment_id,
    st_stud.student_number,
    COALESCE(st_stud.first_name, '') AS first_name,
    COALESCE(st_stud.last_name, '') AS last_name,
    sg.score,
    COALESCE(sg.is_absent, false) AS is_absent,
    COALESCE(sg.is_excused, false) AS is_excused,
    sg.teacher_comment,
    v_asmt.period_id,
    v_asmt.period_name,
    v_asmt.period_position,
    v_asmt.position_within_parent,
    v_asmt.term_id,
    v_asmt.term_name,
    v_asmt.division_type,
    v_asmt.education_cycle,
    sg.created_at,
    sg.updated_at
  FROM public.student_enrollments se
  JOIN public.students st_stud ON st_stud.id = se.student_id
  LEFT JOIN public.student_grades sg ON sg.assessment_id = v_asmt.id
    AND sg.student_id = st_stud.id
    AND sg.school_id = v_asmt.school_id
  WHERE se.school_id = v_asmt.school_id
    AND se.class_id = v_asmt.class_id
    AND se.academic_year_id = v_asmt.academic_year_id
    AND se.status = 'active'
    AND st_stud.school_id = v_asmt.school_id
  ORDER BY st_stud.last_name ASC, st_stud.first_name ASC;
END;
$$;

-- C. get_grades_for_student(p_student_id UUID)
CREATE OR REPLACE FUNCTION public.get_grades_for_student(p_student_id UUID DEFAULT NULL)
RETURNS TABLE (
  grade_id UUID,
  assessment_id UUID,
  school_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  period_id UUID,
  period_name TEXT,
  period_position INT,
  position_within_parent INT,
  term_id UUID,
  term_name TEXT,
  division_type TEXT,
  education_cycle TEXT,
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
    sa.period_id,
    sp.name AS period_name,
    sp.position AS period_position,
    sp.position_within_parent AS position_within_parent,
    sa.term_id,
    st_term.name AS term_name,
    st_term.division_type,
    COALESCE(sp.education_cycle, st_term.education_cycle, c.education_cycle) AS education_cycle,
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
  LEFT JOIN public.school_periods sp ON sp.id = sa.period_id
  WHERE sg.school_id = v_student_school_id
    AND sg.student_id = v_student_id
    AND sa.school_id = v_student_school_id
    AND sa.status IN ('published', 'closed')
  ORDER BY sa.assessment_date DESC, sa.created_at DESC;
END;
$$;

-- D. get_grades_for_parent_child(p_student_id UUID)
CREATE OR REPLACE FUNCTION public.get_grades_for_parent_child(p_student_id UUID)
RETURNS TABLE (
  grade_id UUID,
  assessment_id UUID,
  school_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  period_id UUID,
  period_name TEXT,
  period_position INT,
  position_within_parent INT,
  term_id UUID,
  term_name TEXT,
  division_type TEXT,
  education_cycle TEXT,
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
    sa.period_id,
    sp.name AS period_name,
    sp.position AS period_position,
    sp.position_within_parent AS position_within_parent,
    sa.term_id,
    st_term.name AS term_name,
    st_term.division_type,
    COALESCE(sp.education_cycle, st_term.education_cycle, c.education_cycle) AS education_cycle,
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
  LEFT JOIN public.school_periods sp ON sp.id = sa.period_id
  WHERE sg.school_id = v_profile_school_id
    AND sg.student_id = p_student_id
    AND sa.school_id = v_profile_school_id
    AND sa.status IN ('published', 'closed')
  ORDER BY sa.assessment_date DESC, sa.created_at DESC;
END;
$$;

--------------------------------------------------------------------------------
-- 8. RPC DE SYNTHÈSE DES RÉSULTATS D'UN ÉLÈVE PAR PÉRIODE (GET_STUDENT_PERIOD_RESULTS)
--------------------------------------------------------------------------------

-- Formule de weighted_percentage :
-- weighted_percentage = (score / max_score) * 100 * coefficient
-- Si is_absent = true ou score IS NULL ou max_score <= 0, retourne NULL.

CREATE OR REPLACE FUNCTION public.get_student_period_results(
  p_student_id UUID,
  p_period_id UUID
)
RETURNS TABLE (
  student_id UUID,
  assessment_id UUID,
  assessment_title TEXT,
  assessment_type TEXT,
  assessment_date DATE,
  subject_id UUID,
  subject_name TEXT,
  score NUMERIC,
  max_score NUMERIC,
  coefficient NUMERIC,
  weighted_percentage NUMERIC,
  is_absent BOOLEAN,
  is_excused BOOLEAN,
  teacher_comment TEXT,
  period_id UUID,
  period_name TEXT,
  period_position INT,
  position_within_parent INT,
  term_id UUID,
  term_name TEXT,
  division_type TEXT,
  education_cycle TEXT,
  assessment_status TEXT
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
  v_student_school_id UUID;
  v_student_profile_id UUID;
  v_period_school_id UUID;
  v_period_year_id UUID;
  v_enrollment_id UUID;
  v_tch_id UUID;
  v_tch_acc TEXT;
  v_tch_emp TEXT;
  v_has_approved_parent_link BOOLEAN;
BEGIN
  -- 1. Paramètres obligatoires
  IF p_student_id IS NULL OR p_period_id IS NULL THEN
    RAISE EXCEPTION 'Paramètres obligatoires manquants : L’identifiant de l’élève et de la période sont requis.';
  END IF;

  -- 2. Authentification & profil
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

  -- 3. Validation élève
  SELECT st.school_id, st.profile_id 
  INTO v_student_school_id, v_student_profile_id
  FROM public.students st
  WHERE st.id = p_student_id;

  IF v_student_school_id IS NULL THEN
    RAISE EXCEPTION 'Élève introuvable.';
  END IF;

  -- 4. Validation période
  SELECT sp.school_id, sp.academic_year_id 
  INTO v_period_school_id, v_period_year_id
  FROM public.school_periods sp
  WHERE sp.id = p_period_id;

  IF v_period_school_id IS NULL THEN
    RAISE EXCEPTION 'Période scolaire introuvable.';
  END IF;

  IF v_period_school_id <> v_student_school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La période et l’élève n’appartiennent pas au même établissement.';
  END IF;

  -- 5. Validation inscription active pour l'année scolaire exacte de la période
  SELECT se.id INTO v_enrollment_id
  FROM public.student_enrollments se
  WHERE se.student_id = p_student_id
    AND se.academic_year_id = v_period_year_id
    AND se.school_id = v_student_school_id
    AND se.status = 'active';

  IF v_enrollment_id IS NULL THEN
    RAISE EXCEPTION 'Aucune inscription active trouvée pour cet élève sur l’année scolaire de cette période.';
  END IF;

  -- 6. Contrôle statut école (sauf pour super_admin)
  IF v_caller_role <> 'super_admin' THEN
    IF v_caller_school_id IS NULL OR v_caller_school_id <> v_student_school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : Profil utilisateur et établissement incompatibles.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_student_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  -- 7. Contrôle d'accès par rôle
  IF v_caller_role = 'student' THEN
    IF v_student_profile_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres résultats.';
    END IF;

  ELSIF v_caller_role = 'parent' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.parent_student_links psl
      WHERE psl.parent_profile_id = v_uid
        AND psl.student_id = p_student_id
        AND psl.status = 'approved'
    ) INTO v_has_approved_parent_link;

    IF NOT v_has_approved_parent_link THEN
      RAISE EXCEPTION 'Accès refusé : Aucun lien de parenté approuvé avec cet élève.';
    END IF;

  ELSIF v_caller_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_tch_id, v_tch_acc, v_tch_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_student_school_id;

    IF v_tch_id IS NULL OR v_tch_acc <> 'active' OR v_tch_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Compte ou contrat enseignant inactif.';
    END IF;

  ELSIF v_caller_role = 'school_admin' THEN
    -- Admin de la même école autorisé
    NULL;

  ELSIF v_caller_role = 'super_admin' THEN
    -- Super-Admin autorisé
    NULL;

  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  -- 8. Requête des résultats publiés ou clôturés de la période
  RETURN QUERY
  SELECT
    p_student_id AS student_id,
    sa.id AS assessment_id,
    sa.title AS assessment_title,
    sa.assessment_type,
    sa.assessment_date,
    sb.id AS subject_id,
    sb.name AS subject_name,
    sg.score,
    sa.max_score,
    sa.coefficient,
    CASE 
      WHEN sg.is_absent = true OR sg.score IS NULL OR sa.max_score IS NULL OR sa.max_score <= 0 THEN NULL
      ELSE ROUND(((sg.score / sa.max_score) * 100.0 * sa.coefficient)::numeric, 2)
    END AS weighted_percentage,
    COALESCE(sg.is_absent, false) AS is_absent,
    COALESCE(sg.is_excused, false) AS is_excused,
    sg.teacher_comment,
    sp.id AS period_id,
    sp.name AS period_name,
    sp.position AS period_position,
    sp.position_within_parent AS position_within_parent,
    st.id AS term_id,
    st.name AS term_name,
    st.division_type,
    COALESCE(sp.education_cycle, st.education_cycle, c.education_cycle) AS education_cycle,
    sa.status AS assessment_status
  FROM public.school_assessments sa
  JOIN public.classes c ON c.id = sa.class_id
  JOIN public.subjects sb ON sb.id = sa.subject_id
  JOIN public.school_periods sp ON sp.id = sa.period_id
  LEFT JOIN public.school_terms st ON st.id = sa.term_id
  JOIN public.student_enrollments se ON se.school_id = sa.school_id
    AND se.student_id = p_student_id
    AND se.class_id = sa.class_id
    AND se.academic_year_id = sa.academic_year_id
    AND se.academic_year_id = sp.academic_year_id
    AND se.status = 'active'
  LEFT JOIN public.student_grades sg ON sg.school_id = sa.school_id
    AND sg.assessment_id = sa.id
    AND sg.student_id = p_student_id
    AND sg.enrollment_id = se.id
  WHERE sa.school_id = v_student_school_id
    AND sa.period_id = p_period_id
    AND sa.status IN ('published', 'closed')
    AND (
      v_caller_role <> 'teacher'
      OR (
        sa.teacher_id = v_tch_id
        AND EXISTS (
          SELECT 1 FROM public.teacher_class_assignments tca
          WHERE tca.school_id = sa.school_id
            AND tca.teacher_id = v_tch_id
            AND tca.class_id = sa.class_id
            AND tca.subject_id = sa.subject_id
            AND tca.academic_year_id = sa.academic_year_id
            AND tca.is_active = true
        )
      )
    )
  ORDER BY sa.assessment_date DESC, sb.name ASC;
END;
$$;

--------------------------------------------------------------------------------
-- 9. INTERDICTION STRICTE DES ÉCRITURES DIRECTES SUR TABLES SENSIBLES
--------------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.school_assessments FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_grades FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 10. PRIVILÈGES ET ACCÈS SÉCURISÉS SUR LES FONCTIONS RPC
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_teacher_assessment(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, BOOLEAN, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_teacher_assessment(UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_assessment_to_period(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_teacher_assessments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_assessment_gradebook(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_grades_for_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_grades_for_parent_child(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_period_results(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_teacher_assessment(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_teacher_assessment(UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_assessment_to_period(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_assessments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_assessment_gradebook(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_grades_for_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_grades_for_parent_child(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_period_results(UUID, UUID) TO authenticated;

COMMIT;

--------------------------------------------------------------------------------
-- MATRICE DE TESTS SQL DOCUMENTÉS (NON EXÉCUTÉS)
--------------------------------------------------------------------------------
/*
================================================================================
TEST 1 : Création primaire avec période appartenant au bon trimestre
--------------------------------------------------------------------------------
-- Classe : 3ème Primaire (education_cycle = 'primary')
-- Période : 1re Période (position = 1, parent_term = 1er Trimestre)
-- Appel : create_teacher_assessment(class_id, subject_id, period_id, 'Interro 1', ..., 'quiz', '2026-10-15', 20, 1)
-- Résultat attendu : ID retourné, status = 'draft', period_id et term_id correctement renseignés.

================================================================================
TEST 2 : Création secondaire avec période appartenant au bon semestre
--------------------------------------------------------------------------------
-- Classe : 1A (education_cycle = 'secondary')
-- Période : 1re Période (position = 1, parent_term = 1er Semestre)
-- Appel : create_teacher_assessment(class_1a_id, subject_chimie_id, period_1_sec_id, 'Interro Chimie', ..., 'quiz', '2026-10-15', 20, 1)
-- Résultat attendu : ID retourné, status = 'draft', term_id = 1er Semestre.

================================================================================
TEST 3 : Rejet période primaire pour une classe secondaire
--------------------------------------------------------------------------------
-- Classe : 1A (education_cycle = 'secondary')
-- Période : Période Primaire (education_cycle = 'primary')
-- Résultat attendu : EXCEPTION 'Incohérence de cycle : Le cycle de la période (primary) ne correspond pas au cycle de la classe (secondary).'

================================================================================
TEST 4 : Rejet période secondaire pour une classe primaire
--------------------------------------------------------------------------------
-- Classe : 2ème Primaire (education_cycle = 'primary')
-- Période : Période Secondaire (education_cycle = 'secondary')
-- Résultat attendu : EXCEPTION 'Incohérence de cycle : Le cycle de la période (secondary) ne correspond pas au cycle de la classe (primary).'

================================================================================
TEST 5 : Rejet période d’une autre école
--------------------------------------------------------------------------------
-- Période : school_id = Ecole_B
-- Classe : school_id = Ecole_A
-- Résultat attendu : EXCEPTION 'Incohérence multi-écoles : La période (%) n’appartient pas à la même école ou année scolaire.'

================================================================================
TEST 6 : Rejet période d’une autre année scolaire
--------------------------------------------------------------------------------
-- Période : academic_year_id = Annee_2025_2026
-- Classe : academic_year_id = Annee_2026_2027
-- Résultat attendu : EXCEPTION 'Incohérence multi-écoles : La période (%) n’appartient pas à la même école ou année scolaire.'

================================================================================
TEST 7 : Update d'une ancienne évaluation period_id NULL sans erreur RECORD
--------------------------------------------------------------------------------
-- Évaluation legacy : period_id = NULL, term_id = Term_Legacy, status = 'draft'
-- Appel : update_teacher_assessment(assessment_id, p_term_id = Term_Legacy, p_title = 'Nouveau Titre', ...)
-- Résultat attendu : TRUE retourné sans erreur 'record v_period is not assigned yet', v_effective_term_id = Term_Legacy.

================================================================================
TEST 8 : Enseignant tentant de modifier une évaluation published
--------------------------------------------------------------------------------
-- Enseignant titulaire : évaluation status = 'published'
-- Appel : update_teacher_assessment(assessment_id, ...)
-- Résultat attendu : EXCEPTION 'Opération interdite : Un enseignant ne peut modifier que des évaluations en statut draft ou reopened. Statut actuel: published'

================================================================================
TEST 9 : Enseignant créateur (created_by) mais non titulaire (teacher_id)
--------------------------------------------------------------------------------
-- Enseignant A a créé l'évaluation pour Enseignant B (teacher_id = Enseignant B, created_by = Enseignant A)
-- Appel : update_teacher_assessment(assessment_id, ...) par Enseignant A
-- Résultat attendu : EXCEPTION 'Accès refusé : Vous ne pouvez modifier que les évaluations dont vous êtes le titulaire.'

================================================================================
TEST 10 : Enseignant tentant de consulter le carnet d'un autre titulaire
--------------------------------------------------------------------------------
-- Enseignant A tente d'accéder au carnet de notes de l'évaluation dont teacher_id = Enseignant B
-- Appel : get_assessment_gradebook(assessment_id) par Enseignant A
-- Résultat attendu : EXCEPTION 'Accès refusé : Seul l’enseignant titulaire ou l’administration peut consulter le carnet complet.'

================================================================================
TEST 11 : School Admin modifiant une évaluation publiée sans motif
--------------------------------------------------------------------------------
-- Admin de l'école : évaluation status = 'published'
-- Appel : update_teacher_assessment(assessment_id, ..., p_reason = NULL)
-- Résultat attendu : EXCEPTION 'Motif administratif obligatoire : Un motif explicite (au moins 5 caractères) est requis pour modifier une évaluation en statut published.'

================================================================================
TEST 12 : Super Admin modifiant une évaluation clôturée sans motif
--------------------------------------------------------------------------------
-- Super-Admin : évaluation status = 'closed'
-- Appel : update_teacher_assessment(assessment_id, ..., p_reason = '')
-- Résultat attendu : EXCEPTION 'Motif administratif obligatoire : Un motif explicite (au moins 5 caractères) est requis pour modifier une évaluation en statut closed.'

================================================================================
TEST 13 : Tentative d'UPDATE direct de period_id sans marqueur transactionnel
--------------------------------------------------------------------------------
-- Requête directe : UPDATE public.school_assessments SET period_id = '...' WHERE id = '...'
-- Résultat attendu : Bloqué par trigger avec EXCEPTION 'Modification interdite : La modification de la période d’une évaluation doit obligatoirement être effectuée via la fonction assign_assessment_to_period().'

================================================================================
TEST 14 : Assignation de période avec marqueur transactionnel nettoyé après UPDATE
--------------------------------------------------------------------------------
-- Évaluation : status = 'draft', period_id = NULL
-- Appel : assign_assessment_to_period(assessment_id, period_id, 'Rattachement officiel P1')
-- Résultat attendu : TRUE retourné, period_id mis à jour, marqueur 'app.assessment_period_assignment_id' réinitialisé à '' après l'exécution.

================================================================================
TEST 15 : Date d’évaluation en dehors des dates de la période
--------------------------------------------------------------------------------
-- Période : starts_on = '2026-09-01', ends_on = '2026-10-31'
-- Date évaluation : '2026-11-15'
-- Appel : create_teacher_assessment(..., p_assessment_date = '2026-11-15')
-- Résultat attendu : EXCEPTION 'Date d’évaluation invalide : La date (2026-11-15) est postérieure à la fin de la période scolaire (2026-10-31).'

================================================================================
TEST 16 : Classe avec education_cycle = NULL
--------------------------------------------------------------------------------
-- Classe : education_cycle IS NULL
-- Appel : create_teacher_assessment(class_id, ...)
-- Résultat attendu : EXCEPTION 'Cycle de classe non défini : La classe doit avoir un cycle primary ou secondary.'

================================================================================
TEST 17 : Tentative d'écriture directe INSERT/UPDATE/DELETE par authenticated
--------------------------------------------------------------------------------
-- Requête : INSERT INTO public.school_assessments (...) VALUES (...)
-- Résultat attendu : Bloqué par REVOKE INSERT, UPDATE, DELETE (permission denied).
================================================================================
*/
