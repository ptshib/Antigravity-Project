-- ============================================================================
-- Migration Phase 2F.3 : Bulletins Périodiques Officiels, Classement,
-- Appréciations, Validation, Publication et Export PDF (Version Finale)
-- Fichier : supabase/migrations/20260819100000_period_report_cards.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION IDEMPOTENTE DES TABLES SCHOOLS ET TEACHERS
--------------------------------------------------------------------------------

-- A. Informations officielles et d'identité dans public.schools
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS principal_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS director_signature_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS stamp_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS motto TEXT NULL,
  ADD COLUMN IF NOT EXISTS official_registration_number TEXT NULL;

-- B. Signature numérique du personnel enseignant dans public.teachers
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS signature_url TEXT NULL;

--------------------------------------------------------------------------------
-- 2. CRÉATION ET ALIGNEMENT IDEMPOTENT DES TABLES DE BULLETINS
--------------------------------------------------------------------------------

-- A. Table des Lots de Bulletins par Classe et Période (report_card_batches)
CREATE TABLE IF NOT EXISTS public.report_card_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.school_periods(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number >= 1),
  status TEXT NOT NULL DEFAULT 'draft',
  total_students_count INTEGER NOT NULL DEFAULT 0 CHECK (total_students_count >= 0),
  complete_students_count INTEGER NOT NULL DEFAULT 0 CHECK (complete_students_count >= 0),
  incomplete_students_count INTEGER NOT NULL DEFAULT 0 CHECK (incomplete_students_count >= 0),
  submitted_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NULL,
  validated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ NULL,
  published_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NULL,
  returned_to_draft_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  returned_to_draft_at TIMESTAMPTZ NULL,
  return_reason TEXT NULL,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_card_batch_revision UNIQUE (school_id, academic_year_id, class_id, period_id, revision_number)
);

-- Colonnes additionnelles pour idempotence
ALTER TABLE public.report_card_batches
  ADD COLUMN IF NOT EXISTS returned_to_draft_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_to_draft_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS return_reason TEXT NULL;

-- Remplacement propre de la contrainte CHECK de statut
ALTER TABLE public.report_card_batches
  DROP CONSTRAINT IF EXISTS report_card_batches_status_check;

ALTER TABLE public.report_card_batches
  ADD CONSTRAINT report_card_batches_status_check CHECK (
    status IN ('draft', 'submitted_by_homeroom', 'validated_by_admin', 'published', 'superseded')
  );

-- B. Table des Bulletins Individuels par Élève (period_report_cards)
CREATE TABLE IF NOT EXISTS public.period_report_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.report_card_batches(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.school_periods(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  overall_percentage NUMERIC(5, 2) NULL CHECK (overall_percentage IS NULL OR (overall_percentage >= 0 AND overall_percentage <= 100)),
  rank INTEGER NULL CHECK (rank IS NULL OR rank >= 1),
  total_students_ranked INTEGER NOT NULL DEFAULT 0 CHECK (total_students_ranked >= 0),
  rank_type TEXT NOT NULL DEFAULT 'provisional' CHECK (rank_type IN ('official', 'provisional')),
  is_incomplete BOOLEAN NOT NULL DEFAULT true,
  completed_subjects_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_subjects_count >= 0),
  pending_subjects_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_subjects_count >= 0),
  total_subject_coefficients NUMERIC(6, 2) NOT NULL DEFAULT 0.0 CHECK (total_subject_coefficients >= 0),
  homeroom_teacher_remarks TEXT NULL,
  conduct_grade TEXT NULL,
  principal_remarks TEXT NULL,
  calculation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  identity_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  pdf_storage_path TEXT NULL,
  pdf_generated_at TIMESTAMPTZ NULL,
  pdf_checksum TEXT NULL,
  pdf_version INTEGER NOT NULL DEFAULT 1 CHECK (pdf_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_period_report_cards_batch_student UNIQUE (batch_id, student_id)
);

ALTER TABLE public.period_report_cards
  ADD COLUMN IF NOT EXISTS pdf_checksum TEXT NULL,
  ADD COLUMN IF NOT EXISTS pdf_version INTEGER NOT NULL DEFAULT 1;

-- C. Table des Résultats Détaillés par Matière dans le Bulletin (report_card_subject_results)
CREATE TABLE IF NOT EXISTS public.report_card_subject_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_card_id UUID NOT NULL REFERENCES public.period_report_cards(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  subject_name_snapshot TEXT NOT NULL,
  subject_code_snapshot TEXT NULL,
  coefficient NUMERIC(5, 2) NOT NULL DEFAULT 1.0 CHECK (coefficient > 0),
  subject_percentage NUMERIC(5, 2) NULL CHECK (subject_percentage IS NULL OR (subject_percentage >= 0 AND subject_percentage <= 100)),
  assessment_count INTEGER NOT NULL DEFAULT 0 CHECK (assessment_count >= 0),
  completed_assessment_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_assessment_count >= 0),
  pending_assessment_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_assessment_count >= 0),
  is_complete BOOLEAN NOT NULL DEFAULT false,
  subject_remark TEXT NULL,
  display_position INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_card_subject_results UNIQUE (report_card_id, subject_id)
);

--------------------------------------------------------------------------------
-- 3. INDEX DE PERFORMANCE ET CONTRAINTE UNIQUE PARTIELLE
--------------------------------------------------------------------------------

-- Index partiel garantissant qu'une seule révision est publiée à la fois par classe et période
CREATE UNIQUE INDEX IF NOT EXISTS uq_published_batch_per_class_period
  ON public.report_card_batches (school_id, academic_year_id, class_id, period_id)
  WHERE (status = 'published');

CREATE INDEX IF NOT EXISTS idx_rc_batches_lookup
  ON public.report_card_batches (school_id, class_id, period_id, status);

CREATE INDEX IF NOT EXISTS idx_rc_batches_class_period
  ON public.report_card_batches (class_id, period_id, revision_number DESC);

CREATE INDEX IF NOT EXISTS idx_period_report_cards_lookup
  ON public.period_report_cards (school_id, class_id, period_id, student_id);

CREATE INDEX IF NOT EXISTS idx_period_report_cards_batch_id
  ON public.period_report_cards (batch_id);

CREATE INDEX IF NOT EXISTS idx_period_report_cards_student_period
  ON public.period_report_cards (student_id, period_id);

CREATE INDEX IF NOT EXISTS idx_period_report_cards_enrollment
  ON public.period_report_cards (enrollment_id);

CREATE INDEX IF NOT EXISTS idx_rc_subject_results_report_card
  ON public.report_card_subject_results (report_card_id, display_position ASC);

CREATE INDEX IF NOT EXISTS idx_rc_subject_results_subject
  ON public.report_card_subject_results (subject_id);

--------------------------------------------------------------------------------
-- 4. TRIGGERS D'INTÉGRITÉ ET D'IMMUTABILITÉ STRICTS
--------------------------------------------------------------------------------

-- A. Trigger automatique updated_at
CREATE OR REPLACE FUNCTION public.set_report_card_timestamp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_card_batches_updated_at ON public.report_card_batches;
CREATE TRIGGER trg_report_card_batches_updated_at
  BEFORE UPDATE ON public.report_card_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_report_card_timestamp_updated_at();

DROP TRIGGER IF EXISTS trg_period_report_cards_updated_at ON public.period_report_cards;
CREATE TRIGGER trg_period_report_cards_updated_at
  BEFORE UPDATE ON public.period_report_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.set_report_card_timestamp_updated_at();

DROP TRIGGER IF EXISTS trg_report_card_subject_results_updated_at ON public.report_card_subject_results;
CREATE TRIGGER trg_report_card_subject_results_updated_at
  BEFORE UPDATE ON public.report_card_subject_results
  FOR EACH ROW
  EXECUTE FUNCTION public.set_report_card_timestamp_updated_at();

-- B. Trigger d'Intégrité Structurelle Multi-Écoles sur report_card_batches
CREATE OR REPLACE FUNCTION public.check_report_card_batch_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class RECORD;
  v_period RECORD;
  v_year RECORD;
BEGIN
  -- 1. Validation de la classe
  SELECT id, school_id, academic_year_id, education_cycle INTO v_class
  FROM public.classes WHERE id = NEW.class_id;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Intégrité violée : Classe introuvable (%).', NEW.class_id;
  END IF;

  IF v_class.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La classe appartient à un autre établissement.';
  END IF;

  IF v_class.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence académique : La classe n’appartient pas à l’année scolaire spécifiée.';
  END IF;

  -- 2. Validation de la période
  SELECT id, school_id, academic_year_id, education_cycle, is_active INTO v_period
  FROM public.school_periods WHERE id = NEW.period_id;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Intégrité violée : Période scolaire introuvable (%).', NEW.period_id;
  END IF;

  IF v_period.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La période appartient à un autre établissement.';
  END IF;

  IF v_period.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence académique : La période n’appartient pas à l’année scolaire spécifiée.';
  END IF;

  IF v_period.education_cycle IS DISTINCT FROM v_class.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle : Le cycle de la période (%) ne correspond pas au cycle de la classe (%).',
      v_period.education_cycle, v_class.education_cycle;
  END IF;

  -- 3. Validation de l'année scolaire
  SELECT id, school_id INTO v_year
  FROM public.academic_years WHERE id = NEW.academic_year_id;

  IF v_year.id IS NULL OR v_year.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire appartient à un autre établissement.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_report_card_batch_integrity ON public.report_card_batches;
CREATE TRIGGER trg_validate_report_card_batch_integrity
  BEFORE INSERT OR UPDATE ON public.report_card_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.check_report_card_batch_integrity();

-- C. Trigger d'Intégrité Structurelle sur period_report_cards
CREATE OR REPLACE FUNCTION public.check_period_report_card_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_student RECORD;
  v_enrollment RECORD;
BEGIN
  -- 1. Validation du lot parent
  SELECT id, school_id, academic_year_id, class_id, period_id, status INTO v_batch
  FROM public.report_card_batches WHERE id = NEW.batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Intégrité violée : Lot de bulletins parent introuvable (%).', NEW.batch_id;
  END IF;

  IF NEW.school_id IS DISTINCT FROM v_batch.school_id OR
     NEW.academic_year_id IS DISTINCT FROM v_batch.academic_year_id OR
     NEW.class_id IS DISTINCT FROM v_batch.class_id OR
     NEW.period_id IS DISTINCT FROM v_batch.period_id THEN
    RAISE EXCEPTION 'Incohérence relationnelle : Les identifiants d’école, d’année, de classe ou de période ne correspondent pas au lot parent.';
  END IF;

  -- 2. Validation de l'élève
  SELECT id, school_id INTO v_student
  FROM public.students WHERE id = NEW.student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Intégrité violée : Élève introuvable (%).', NEW.student_id;
  END IF;

  IF v_student.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’élève n’appartient pas au même établissement que le bulletin.';
  END IF;

  -- 3. Validation de l'inscription scolaire active
  SELECT id, student_id, class_id, academic_year_id, school_id, status INTO v_enrollment
  FROM public.student_enrollments WHERE id = NEW.enrollment_id;

  IF v_enrollment.id IS NULL THEN
    RAISE EXCEPTION 'Intégrité violée : Inscription scolaire introuvable (%).', NEW.enrollment_id;
  END IF;

  IF v_enrollment.student_id IS DISTINCT FROM NEW.student_id OR
     v_enrollment.class_id IS DISTINCT FROM NEW.class_id OR
     v_enrollment.academic_year_id IS DISTINCT FROM NEW.academic_year_id OR
     v_enrollment.school_id IS DISTINCT FROM NEW.school_id OR
     v_enrollment.status <> 'active' THEN
    RAISE EXCEPTION 'Incohérence d’inscription : L’inscription active ne correspond pas à l’élève, à la classe ou à l’année scolaire.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_period_report_card_integrity ON public.period_report_cards;
CREATE TRIGGER trg_validate_period_report_card_integrity
  BEFORE INSERT OR UPDATE ON public.period_report_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.check_period_report_card_integrity();

-- D. Trigger d'Intégrité Structurelle sur report_card_subject_results
CREATE OR REPLACE FUNCTION public.check_report_card_subject_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rc RECORD;
  v_subject RECORD;
  v_batch RECORD;
  v_setting_coeff NUMERIC;
BEGIN
  -- 1. Validation du bulletin parent
  SELECT id, batch_id, school_id, class_id, academic_year_id INTO v_rc
  FROM public.period_report_cards WHERE id = NEW.report_card_id;

  IF v_rc.id IS NULL THEN
    RAISE EXCEPTION 'Intégrité violée : Bulletin individuel parent introuvable (%).', NEW.report_card_id;
  END IF;

  SELECT status INTO v_batch FROM public.report_card_batches WHERE id = v_rc.batch_id;

  -- 2. Validation de la matière
  SELECT id, school_id, is_active INTO v_subject
  FROM public.subjects WHERE id = NEW.subject_id;

  IF v_subject.id IS NULL THEN
    RAISE EXCEPTION 'Intégrité violée : Matière introuvable (%).', NEW.subject_id;
  END IF;

  IF v_subject.school_id IS DISTINCT FROM v_rc.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La matière appartient à un autre établissement.';
  END IF;

  IF TG_OP = 'INSERT' AND v_batch.status = 'draft' AND v_subject.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Intégrité violée : Impossible d’ajouter une matière inactive (%) dans un nouveau bulletin.', v_subject.id;
  END IF;

  IF NEW.coefficient <= 0 THEN
    RAISE EXCEPTION 'Intégrité violée : Le coefficient de la matière doit être strictement positif.';
  END IF;

  -- 3. Vérification de la configuration de coefficient lors de l'insertion dans un draft
  IF TG_OP = 'INSERT' AND v_batch.status = 'draft' THEN
    SELECT coefficient INTO v_setting_coeff
    FROM public.class_subject_settings
    WHERE class_id = v_rc.class_id
      AND subject_id = NEW.subject_id
      AND academic_year_id = v_rc.academic_year_id
      AND school_id = v_rc.school_id
      AND is_active = true;

    IF v_setting_coeff IS NOT NULL THEN
      IF NEW.coefficient IS DISTINCT FROM v_setting_coeff THEN
        RAISE EXCEPTION 'Incohérence de coefficient : Le coefficient (%) ne correspond pas à la configuration de classe (%).',
          NEW.coefficient, v_setting_coeff;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_report_card_subject_integrity ON public.report_card_subject_results;
CREATE TRIGGER trg_validate_report_card_subject_integrity
  BEFORE INSERT OR UPDATE ON public.report_card_subject_results
  FOR EACH ROW
  EXECUTE FUNCTION public.check_report_card_subject_integrity();

-- E. Trigger d'Immutabilité et de Machine d'États avec Contexte Interne Sécurisé (Garanti sans OLD sur INSERT)
CREATE OR REPLACE FUNCTION public.enforce_report_card_state_machine()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_transition_ctx TEXT;
  v_pdf_service_ctx TEXT;
  v_target_batch_id UUID;
  v_target_report_card_id UUID;
BEGIN
  -- Récupérer les contextes de session internes
  v_transition_ctx := current_setting('app.report_card_transition_ctx', true);
  v_pdf_service_ctx := current_setting('app.report_card_pdf_service_ctx', true);

  -- 1. Table report_card_batches
  IF TG_TABLE_NAME = 'report_card_batches' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'Sécurité : Un nouveau lot de bulletins doit impérativement être créé avec le statut initial "draft" (statut fourni: %).', NEW.status;
      END IF;

      IF NEW.revision_number < 1 THEN
        RAISE EXCEPTION 'Intégrité : Le numéro de révision doit être supérieur ou égal à 1.';
      END IF;

      IF NEW.submitted_by IS NOT NULL OR NEW.submitted_at IS NOT NULL OR
         NEW.validated_by IS NOT NULL OR NEW.validated_at IS NOT NULL OR
         NEW.published_by IS NOT NULL OR NEW.published_at IS NOT NULL OR
         NEW.returned_to_draft_by IS NOT NULL OR NEW.returned_to_draft_at IS NOT NULL OR
         NEW.return_reason IS NOT NULL THEN
        RAISE EXCEPTION 'Sécurité : Les métadonnées de soumission, validation ou publication doivent être nulles à la création.';
      END IF;

      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      IF OLD.status IN ('published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Impossible de supprimer un lot de bulletins publié ou archivé (statut: %).', OLD.status;
      END IF;
      RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- Vérification stricte des contextes de transition d'état
      IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF OLD.status = 'draft' AND NEW.status = 'submitted_by_homeroom' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_submit_transition' THEN
            RAISE EXCEPTION 'Sécurité : Transition draft -> submitted_by_homeroom non autorisée sans contexte légitime (contexte: %).', v_transition_ctx;
          END IF;
        ELSIF OLD.status = 'submitted_by_homeroom' AND NEW.status = 'validated_by_admin' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_validate_transition' THEN
            RAISE EXCEPTION 'Sécurité : Transition submitted_by_homeroom -> validated_by_admin non autorisée sans contexte légitime (contexte: %).', v_transition_ctx;
          END IF;
        ELSIF OLD.status = 'submitted_by_homeroom' AND NEW.status = 'draft' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_return_to_draft_transition' THEN
            RAISE EXCEPTION 'Sécurité : Transition submitted_by_homeroom -> draft non autorisée sans contexte légitime (contexte: %).', v_transition_ctx;
          END IF;
        ELSIF OLD.status = 'validated_by_admin' AND NEW.status = 'published' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_publish_transition' THEN
            RAISE EXCEPTION 'Sécurité : Transition validated_by_admin -> published non autorisée sans contexte légitime (contexte: %).', v_transition_ctx;
          END IF;
        ELSIF OLD.status = 'validated_by_admin' AND NEW.status = 'draft' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_return_to_draft_transition' THEN
            RAISE EXCEPTION 'Sécurité : Transition validated_by_admin -> draft non autorisée sans contexte légitime (contexte: %).', v_transition_ctx;
          END IF;
        ELSIF OLD.status = 'published' AND NEW.status = 'superseded' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_publish_transition' THEN
            RAISE EXCEPTION 'Sécurité : Transition published -> superseded non autorisée en dehors d’une nouvelle publication (contexte: %).', v_transition_ctx;
          END IF;
        ELSE
          RAISE EXCEPTION 'Sécurité : Transition d’état interdite de % vers % (contexte: %).', OLD.status, NEW.status, v_transition_ctx;
        END IF;
      END IF;

      -- Verrouillage absolu des données sur lot publié ou archivé
      IF OLD.status IN ('published', 'superseded') THEN
        IF (OLD.school_id IS DISTINCT FROM NEW.school_id OR
            OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id OR
            OLD.class_id IS DISTINCT FROM NEW.class_id OR
            OLD.period_id IS DISTINCT FROM NEW.period_id OR
            OLD.revision_number IS DISTINCT FROM NEW.revision_number OR
            OLD.total_students_count IS DISTINCT FROM NEW.total_students_count OR
            OLD.complete_students_count IS DISTINCT FROM NEW.complete_students_count OR
            OLD.incomplete_students_count IS DISTINCT FROM NEW.incomplete_students_count) THEN
          RAISE EXCEPTION 'Immutabilité : Les données d’un lot publié ou archivé sont strictement non modifiables.';
        END IF;
      END IF;

      RETURN NEW;
    END IF;
  END IF;

  -- 2. Table period_report_cards
  IF TG_TABLE_NAME = 'period_report_cards' THEN
    IF TG_OP = 'INSERT' THEN
      v_target_batch_id := NEW.batch_id;
    ELSE
      v_target_batch_id := OLD.batch_id;
    END IF;

    SELECT status INTO v_batch FROM public.report_card_batches WHERE id = v_target_batch_id;

    IF TG_OP = 'INSERT' THEN
      IF v_batch.status IN ('published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Impossible d’insérer un nouveau bulletin dans un lot publié ou archivé.';
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      IF v_batch.status IN ('published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Impossible de supprimer un bulletin individuel d’un lot publié ou archivé.';
      END IF;
      RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF OLD.batch_id IS DISTINCT FROM NEW.batch_id THEN
        RAISE EXCEPTION 'Sécurité : Le rattachement au lot (batch_id) d’un bulletin ne peut être modifié.';
      END IF;

      IF v_batch.status IN ('published', 'superseded') THEN
        -- Mise à jour autorisée UNIQUEMENT pour les métadonnées PDF via le service serveur
        IF (OLD.pdf_storage_path IS DISTINCT FROM NEW.pdf_storage_path OR
            OLD.pdf_generated_at IS DISTINCT FROM NEW.pdf_generated_at OR
            OLD.pdf_checksum IS DISTINCT FROM NEW.pdf_checksum OR
            OLD.pdf_version IS DISTINCT FROM NEW.pdf_version) THEN
          IF v_pdf_service_ctx IS DISTINCT FROM 'authorized_pdf_update' THEN
            RAISE EXCEPTION 'Sécurité : La mise à jour des métadonnées PDF requiert l’exécution du service serveur habilité.';
          END IF;
        END IF;

        IF (OLD.school_id IS DISTINCT FROM NEW.school_id OR
            OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id OR
            OLD.class_id IS DISTINCT FROM NEW.class_id OR
            OLD.period_id IS DISTINCT FROM NEW.period_id OR
            OLD.student_id IS DISTINCT FROM NEW.student_id OR
            OLD.enrollment_id IS DISTINCT FROM NEW.enrollment_id OR
            OLD.overall_percentage IS DISTINCT FROM NEW.overall_percentage OR
            OLD.rank IS DISTINCT FROM NEW.rank OR
            OLD.total_students_ranked IS DISTINCT FROM NEW.total_students_ranked OR
            OLD.rank_type IS DISTINCT FROM NEW.rank_type OR
            OLD.is_incomplete IS DISTINCT FROM NEW.is_incomplete OR
            OLD.completed_subjects_count IS DISTINCT FROM NEW.completed_subjects_count OR
            OLD.pending_subjects_count IS DISTINCT FROM NEW.pending_subjects_count OR
            OLD.total_subject_coefficients IS DISTINCT FROM NEW.total_subject_coefficients OR
            OLD.calculation_snapshot IS DISTINCT FROM NEW.calculation_snapshot OR
            OLD.identity_snapshot IS DISTINCT FROM NEW.identity_snapshot OR
            OLD.signature_snapshot IS DISTINCT FROM NEW.signature_snapshot OR
            OLD.homeroom_teacher_remarks IS DISTINCT FROM NEW.homeroom_teacher_remarks OR
            OLD.conduct_grade IS DISTINCT FROM NEW.conduct_grade OR
            OLD.principal_remarks IS DISTINCT FROM NEW.principal_remarks) THEN
          RAISE EXCEPTION 'Immutabilité : Les résultats, rangs et appréciations d’un bulletin publié sont figés.';
        END IF;
      END IF;

      RETURN NEW;
    END IF;
  END IF;

  -- 3. Table report_card_subject_results
  IF TG_TABLE_NAME = 'report_card_subject_results' THEN
    IF TG_OP = 'INSERT' THEN
      v_target_report_card_id := NEW.report_card_id;
    ELSE
      v_target_report_card_id := OLD.report_card_id;
    END IF;

    SELECT b.status INTO v_batch
    FROM public.period_report_cards rc
    JOIN public.report_card_batches b ON b.id = rc.batch_id
    WHERE rc.id = v_target_report_card_id;

    IF TG_OP = 'INSERT' THEN
      IF v_batch.status IN ('published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Impossible d’insérer un résultat par matière dans un bulletin publié ou archivé.';
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      IF v_batch.status IN ('published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Impossible de supprimer les résultats d’un bulletin publié ou archivé.';
      END IF;
      RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF OLD.report_card_id IS DISTINCT FROM NEW.report_card_id THEN
        RAISE EXCEPTION 'Sécurité : Le rattachement au bulletin (report_card_id) ne peut être modifié.';
      END IF;

      IF v_batch.status IN ('published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Les résultats par matière d’un bulletin publié sont figés.';
      END IF;

      RETURN NEW;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_rc_batches_state_machine ON public.report_card_batches;
CREATE TRIGGER trg_enforce_rc_batches_state_machine
  BEFORE INSERT OR UPDATE OR DELETE ON public.report_card_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_report_card_state_machine();

DROP TRIGGER IF EXISTS trg_enforce_period_rc_state_machine ON public.period_report_cards;
CREATE TRIGGER trg_enforce_period_rc_state_machine
  BEFORE INSERT OR UPDATE OR DELETE ON public.period_report_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_report_card_state_machine();

DROP TRIGGER IF EXISTS trg_enforce_rc_subject_results_state_machine ON public.report_card_subject_results;
CREATE TRIGGER trg_enforce_rc_subject_results_state_machine
  BEFORE INSERT OR UPDATE OR DELETE ON public.report_card_subject_results
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_report_card_state_machine();

--------------------------------------------------------------------------------
-- 5. STOCKAGE SUPABASE (STORAGE BUCKETS & POLICIES SÉCURISÉES)
--------------------------------------------------------------------------------

-- Création idempotente des buckets de stockage privés
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('school-official-assets', 'school-official-assets', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp']),
  ('report-card-pdfs', 'report-card-pdfs', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Suppression préalable idempotente des politiques storage
DROP POLICY IF EXISTS "school_admin_manage_official_assets" ON storage.objects;
DROP POLICY IF EXISTS "teacher_manage_own_signature" ON storage.objects;
DROP POLICY IF EXISTS "school_admin_read_report_card_pdfs" ON storage.objects;
DROP POLICY IF EXISTS "student_read_own_report_card_pdf" ON storage.objects;
DROP POLICY IF EXISTS "parent_read_linked_student_report_card_pdf" ON storage.objects;

-- Politiques Storage : school-official-assets
CREATE POLICY "school_admin_manage_official_assets"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'school-official-assets' AND
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.role IN ('school_admin', 'super_admin')
      AND (p.role = 'super_admin' OR (storage.foldername(name))[1] = p.school_id::text)
  )
)
WITH CHECK (
  bucket_id = 'school-official-assets' AND
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.role IN ('school_admin', 'super_admin')
      AND (p.role = 'super_admin' OR (storage.foldername(name))[1] = p.school_id::text)
  )
);

CREATE POLICY "teacher_manage_own_signature"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'school-official-assets' AND
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND storage.foldername(name) = ARRAY[t.school_id::text, 'signatures', 'teachers']
      AND storage.filename(name) ~* ('^' || auth.uid()::text || '\.(png|jpg|jpeg|webp)$')
  )
)
WITH CHECK (
  bucket_id = 'school-official-assets' AND
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND storage.foldername(name) = ARRAY[t.school_id::text, 'signatures', 'teachers']
      AND storage.filename(name) ~* ('^' || auth.uid()::text || '\.(png|jpg|jpeg|webp)$')
  )
);

-- Politiques Storage : report-card-pdfs
CREATE POLICY "school_admin_read_report_card_pdfs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'report-card-pdfs' AND
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND (p.role = 'super_admin' OR (p.role = 'school_admin' AND (storage.foldername(name))[1] = p.school_id::text))
  )
);

CREATE POLICY "student_read_own_report_card_pdf"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'report-card-pdfs' AND
  EXISTS (
    SELECT 1 FROM public.students s
    JOIN public.period_report_cards rc ON rc.student_id = s.id
    JOIN public.report_card_batches b ON b.id = rc.batch_id
    WHERE s.profile_id = auth.uid()
      AND s.account_status = 'active'
      AND s.enrollment_status = 'active'
      AND b.status = 'published'
      AND rc.pdf_storage_path = name
  )
);

CREATE POLICY "parent_read_linked_student_report_card_pdf"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'report-card-pdfs' AND
  EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    JOIN public.parent_accounts pa ON pa.profile_id = psl.parent_profile_id AND pa.school_id = psl.school_id
    JOIN public.period_report_cards rc ON rc.student_id = psl.student_id
    JOIN public.report_card_batches b ON b.id = rc.batch_id
    WHERE psl.parent_profile_id = auth.uid()
      AND psl.status = 'approved'
      AND psl.can_view_academic = true
      AND pa.account_status = 'active'
      AND b.status = 'published'
      AND rc.pdf_storage_path = name
  )
);

--------------------------------------------------------------------------------
-- 6. RPC 1 : GÉNÉRATION DU BROUILLON DE LOT DE BULLETINS
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.generate_class_report_card_draft(UUID, UUID);
CREATE OR REPLACE FUNCTION public.generate_class_report_card_draft(
  p_class_id UUID,
  p_period_id UUID
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
  v_active BOOLEAN;
  v_class RECORD;
  v_period RECORD;
  v_term RECORD;
  v_year RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_batch_id UUID;
  v_next_revision INTEGER := 1;
  v_existing_batch RECORD;
  v_active_enrollments_count INTEGER := 0;
  v_student_cur RECORD;
  v_student_period_res JSONB;
  v_report_card_id UUID;
  v_subj_elem JSONB;
  v_pos INTEGER := 1;
  v_complete_count INTEGER := 0;
  v_incomplete_count INTEGER := 0;
  v_total_ranked INTEGER := 0;
  v_school_record RECORD;
  v_homeroom_teacher_name TEXT := '';
  v_homeroom_teacher_signature TEXT := NULL;
  v_active_student_ids UUID[] := ARRAY[]::UUID[];
  v_active_subject_ids UUID[] := ARRAY[]::UUID[];
  v_subject_row RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  -- 1. Acquisition uniforme du verrou exclusif sur la classe et la période
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || p_class_id::text || '_' || p_period_id::text));

  -- 2. Validation de la classe
  SELECT id, school_id, academic_year_id, name, education_cycle, homeroom_teacher_id
  INTO v_class
  FROM public.classes WHERE id = p_class_id;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  -- 3. Validation de la période
  SELECT id, school_id, academic_year_id, parent_term_id, name, education_cycle, starts_on, ends_on, is_active
  INTO v_period
  FROM public.school_periods WHERE id = p_period_id;

  IF v_period.id IS NULL OR v_period.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Période scolaire inactive ou introuvable.';
  END IF;

  IF v_period.school_id IS DISTINCT FROM v_class.school_id OR v_period.academic_year_id IS DISTINCT FROM v_class.academic_year_id OR v_period.education_cycle IS DISTINCT FROM v_class.education_cycle THEN
    RAISE EXCEPTION 'Incohérence structurelle entre la période et la classe.';
  END IF;

  -- Validation du terme parent et de l'année
  SELECT id, name INTO v_term FROM public.school_terms WHERE id = v_period.parent_term_id;
  SELECT id, name INTO v_year FROM public.academic_years WHERE id = v_class.academic_year_id;

  -- Validation des droits d'accès : school_admin ou professeur titulaire actif
  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'school_admin' THEN
    IF v_school_id IS DISTINCT FROM v_class.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF v_school_id IS DISTINCT FROM v_class.school_id THEN
      RAISE EXCEPTION 'Accès refusé.';
    END IF;

    SELECT id, profile_id, employment_status, account_status
    INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid
      AND school_id = v_class.school_id
      AND account_status = 'active'
      AND employment_status = 'active';

    IF v_teacher.id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Dossier enseignant inactif ou introuvable.';
    END IF;

    IF v_class.homeroom_teacher_id = v_uid OR v_class.homeroom_teacher_id = v_teacher.id THEN
      v_is_homeroom := true;
    END IF;

    IF NOT v_is_homeroom THEN
      RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire de cette classe ou l’administrateur peut générer les bulletins.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  -- Récupération de l'identité de l'établissement
  SELECT id, name, logo_url, principal_name, director_signature_url, stamp_url, motto, address, phone, email, official_registration_number
  INTO v_school_record
  FROM public.schools WHERE id = v_class.school_id;

  -- Récupération du nom et de la signature du titulaire
  IF v_class.homeroom_teacher_id IS NOT NULL THEN
    SELECT
      TRIM(COALESCE(p.first_name, t.first_name, '') || ' ' || COALESCE(p.last_name, t.last_name, '')),
      t.signature_url
    INTO v_homeroom_teacher_name, v_homeroom_teacher_signature
    FROM public.teachers t
    JOIN public.profiles p ON p.id = t.profile_id
    WHERE (t.id = v_class.homeroom_teacher_id OR t.profile_id = v_class.homeroom_teacher_id)
      AND t.school_id = v_class.school_id
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND p.is_active = true;
  END IF;

  -- 4. Lecture du lot le plus récent avec verrouillage FOR UPDATE
  SELECT id, revision_number, status INTO v_existing_batch
  FROM public.report_card_batches
  WHERE school_id = v_class.school_id
    AND academic_year_id = v_class.academic_year_id
    AND class_id = p_class_id
    AND period_id = p_period_id
  ORDER BY revision_number DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_batch.id IS NOT NULL THEN
    IF v_existing_batch.status = 'published' THEN
      RAISE EXCEPTION 'Un lot de bulletins a déjà été publié pour cette classe et période (Révision #%). Utilisez la réouverture administrative.', v_existing_batch.revision_number;
    ELSIF v_existing_batch.status = 'submitted_by_homeroom' THEN
      RAISE EXCEPTION 'Le lot actuel (Révision #%) a déjà été soumis par le titulaire. Il doit être validé ou renvoyé en brouillon par la direction.', v_existing_batch.revision_number;
    ELSIF v_existing_batch.status = 'validated_by_admin' THEN
      RAISE EXCEPTION 'Le lot actuel (Révision #%) est validé par la direction en attente de publication.', v_existing_batch.revision_number;
    ELSIF v_existing_batch.status = 'draft' THEN
      v_batch_id := v_existing_batch.id;
      v_next_revision := v_existing_batch.revision_number;
    END IF;
  END IF;

  IF v_batch_id IS NULL THEN
    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_revision
    FROM public.report_card_batches
    WHERE school_id = v_class.school_id
      AND academic_year_id = v_class.academic_year_id
      AND class_id = p_class_id
      AND period_id = p_period_id;

    INSERT INTO public.report_card_batches (
      school_id, academic_year_id, class_id, period_id, revision_number,
      status, created_by
    ) VALUES (
      v_class.school_id, v_class.academic_year_id, p_class_id, p_period_id, v_next_revision,
      'draft', v_uid
    )
    RETURNING id INTO v_batch_id;
  END IF;

  -- 5. Parcours de tous les élèves inscrits actifs
  FOR v_student_cur IN (
    SELECT
      s.id AS student_id,
      se.id AS enrollment_id,
      s.student_number,
      COALESCE(p.first_name, s.first_name, '') AS first_name,
      COALESCE(p.last_name, s.last_name, '') AS last_name,
      s.gender,
      s.date_of_birth
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
    v_active_enrollments_count := v_active_enrollments_count + 1;
    v_active_student_ids := array_append(v_active_student_ids, v_student_cur.student_id);

    -- Calcul officiel de la période pour cet élève
    v_student_period_res := public.get_student_period_result(v_student_cur.student_id, p_period_id);

    IF (v_student_period_res->>'is_complete')::boolean IS TRUE THEN
      v_complete_count := v_complete_count + 1;
    ELSE
      v_incomplete_count := v_incomplete_count + 1;
    END IF;

    -- Création ou mise à jour du bulletin individuel (préserve les remarques existantes)
    INSERT INTO public.period_report_cards (
      batch_id, school_id, academic_year_id, class_id, period_id,
      student_id, enrollment_id,
      overall_percentage,
      rank, total_students_ranked, rank_type,
      is_incomplete,
      completed_subjects_count, pending_subjects_count,
      total_subject_coefficients,
      calculation_snapshot,
      identity_snapshot,
      signature_snapshot
    ) VALUES (
      v_batch_id, v_class.school_id, v_class.academic_year_id, p_class_id, p_period_id,
      v_student_cur.student_id, v_student_cur.enrollment_id,
      (v_student_period_res->>'overall_percentage')::numeric,
      NULL, 0, 'provisional',
      NOT ((v_student_period_res->>'is_complete')::boolean),
      COALESCE((v_student_period_res->>'completed_subjects_count')::int, 0),
      COALESCE((v_student_period_res->>'pending_subjects_count')::int, 0),
      COALESCE((v_student_period_res->>'total_subject_coefficients')::numeric, 0),
      v_student_period_res,
      jsonb_build_object(
        'student_id', v_student_cur.student_id,
        'student_number', v_student_cur.student_number,
        'student_name', TRIM(v_student_cur.first_name || ' ' || v_student_cur.last_name),
        'student_first_name', v_student_cur.first_name,
        'student_last_name', v_student_cur.last_name,
        'gender', v_student_cur.gender,
        'date_of_birth', v_student_cur.date_of_birth,
        'class_id', v_class.id,
        'class_name', v_class.name,
        'education_cycle', v_class.education_cycle,
        'academic_year_id', v_year.id,
        'academic_year_name', v_year.name,
        'period_id', v_period.id,
        'period_name', v_period.name,
        'period_starts_on', v_period.starts_on,
        'period_ends_on', v_period.ends_on,
        'term_name', v_term.name,
        'school_name', v_school_record.name,
        'school_address', v_school_record.address,
        'school_phone', v_school_record.phone,
        'school_email', v_school_record.email,
        'logo_url', v_school_record.logo_url,
        'official_registration_number', v_school_record.official_registration_number,
        'motto', v_school_record.motto
      ),
      jsonb_build_object(
        'principal_name', v_school_record.principal_name,
        'director_signature_url', v_school_record.director_signature_url,
        'stamp_url', v_school_record.stamp_url,
        'homeroom_teacher_name', v_homeroom_teacher_name,
        'homeroom_teacher_signature_url', v_homeroom_teacher_signature
      )
    )
    ON CONFLICT (batch_id, student_id) DO UPDATE SET
      overall_percentage = EXCLUDED.overall_percentage,
      is_incomplete = EXCLUDED.is_incomplete,
      completed_subjects_count = EXCLUDED.completed_subjects_count,
      pending_subjects_count = EXCLUDED.pending_subjects_count,
      total_subject_coefficients = EXCLUDED.total_subject_coefficients,
      calculation_snapshot = EXCLUDED.calculation_snapshot,
      identity_snapshot = EXCLUDED.identity_snapshot,
      signature_snapshot = EXCLUDED.signature_snapshot,
      updated_at = now()
    RETURNING id INTO v_report_card_id;

    -- Insertion / Mise à jour des lignes de matières détaillées
    v_pos := 1;
    v_active_subject_ids := ARRAY[]::UUID[];

    FOR v_subj_elem IN SELECT * FROM jsonb_array_elements(COALESCE(v_student_period_res->'subjects', '[]'::jsonb))
    LOOP
      v_active_subject_ids := array_append(v_active_subject_ids, (v_subj_elem->>'subject_id')::uuid);

      -- Récupération du code officiel de la matière
      SELECT code INTO v_subject_row FROM public.subjects WHERE id = (v_subj_elem->>'subject_id')::uuid;

      INSERT INTO public.report_card_subject_results (
        report_card_id, subject_id,
        subject_name_snapshot, subject_code_snapshot,
        coefficient, subject_percentage,
        assessment_count, completed_assessment_count, pending_assessment_count,
        is_complete, display_position
      ) VALUES (
        v_report_card_id,
        (v_subj_elem->>'subject_id')::uuid,
        v_subj_elem->>'subject_name',
        v_subject_row.code,
        COALESCE((v_subj_elem->>'subject_coefficient')::numeric, 1.0),
        (v_subj_elem->>'subject_percentage')::numeric,
        COALESCE((v_subj_elem->>'assessment_count')::int, 0),
        COALESCE((v_subj_elem->>'completed_assessment_count')::int, 0),
        COALESCE((v_subj_elem->>'pending_assessment_count')::int, 0),
        COALESCE((v_subj_elem->>'is_complete')::boolean, false),
        v_pos
      )
      ON CONFLICT (report_card_id, subject_id) DO UPDATE SET
        subject_name_snapshot = EXCLUDED.subject_name_snapshot,
        subject_code_snapshot = EXCLUDED.subject_code_snapshot,
        coefficient = EXCLUDED.coefficient,
        subject_percentage = EXCLUDED.subject_percentage,
        assessment_count = EXCLUDED.assessment_count,
        completed_assessment_count = EXCLUDED.completed_assessment_count,
        pending_assessment_count = EXCLUDED.pending_assessment_count,
        is_complete = EXCLUDED.is_complete,
        display_position = EXCLUDED.display_position,
        updated_at = now();

      v_pos := v_pos + 1;
    END LOOP;

    -- Nettoyer les matières devenues inactives
    DELETE FROM public.report_card_subject_results
    WHERE report_card_id = v_report_card_id
      AND NOT (subject_id = ANY(v_active_subject_ids));
  END LOOP;

  -- Supprimer du lot les élèves qui ne sont plus activement inscrits
  DELETE FROM public.period_report_cards
  WHERE batch_id = v_batch_id
    AND NOT (student_id = ANY(v_active_student_ids));

  -- Calcul officiel du classement standard de compétition (1, 2, 2, 4) parmi les élèves notés
  SELECT COUNT(*) INTO v_total_ranked
  FROM public.period_report_cards
  WHERE batch_id = v_batch_id AND overall_percentage IS NOT NULL;

  WITH ranked AS (
    SELECT
      id,
      RANK() OVER (ORDER BY overall_percentage DESC) as calculated_rank
    FROM public.period_report_cards
    WHERE batch_id = v_batch_id AND overall_percentage IS NOT NULL
  )
  UPDATE public.period_report_cards rc
  SET
    rank = ranked.calculated_rank,
    total_students_ranked = v_total_ranked,
    rank_type = 'provisional',
    updated_at = now()
  FROM ranked
  WHERE rc.id = ranked.id;

  -- Mise à jour du récapitulatif du lot
  UPDATE public.report_card_batches
  SET
    total_students_count = v_active_enrollments_count,
    complete_students_count = v_complete_count,
    incomplete_students_count = v_incomplete_count,
    updated_at = now()
  WHERE id = v_batch_id;

  -- Audit log
  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_class.school_id, v_uid, 'generate_class_report_card_draft',
    jsonb_build_object(
      'batch_id', v_batch_id,
      'class_id', p_class_id,
      'period_id', p_period_id,
      'revision_number', v_next_revision,
      'total_students', v_active_enrollments_count,
      'complete_students', v_complete_count,
      'incomplete_students', v_incomplete_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'revision_number', v_next_revision,
    'status', 'draft',
    'total_students_count', v_active_enrollments_count,
    'complete_students_count', v_complete_count,
    'incomplete_students_count', v_incomplete_count,
    'total_students_ranked', v_total_ranked
  );
END;
$$;

--------------------------------------------------------------------------------
-- 7. RPC 2 : SAISIE STRICTE DES APPRÉCIATIONS PAR RÔLE
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.save_report_card_remarks(UUID, TEXT, TEXT, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.save_report_card_remarks(
  p_report_card_id UUID,
  p_homeroom_remarks TEXT DEFAULT NULL,
  p_conduct_grade TEXT DEFAULT NULL,
  p_principal_remarks TEXT DEFAULT NULL,
  p_subject_remarks JSONB DEFAULT NULL
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
  v_active BOOLEAN;
  v_rc RECORD;
  v_batch RECORD;
  v_class RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_subj_elem JSONB;
  v_target_subject_id UUID;
  v_target_remark TEXT;
  v_updated_rows INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  SELECT rc.id, rc.batch_id, rc.class_id, rc.school_id, rc.student_id
  INTO v_rc
  FROM public.period_report_cards rc WHERE rc.id = p_report_card_id;

  IF v_rc.id IS NULL THEN
    RAISE EXCEPTION 'Bulletin introuvable.';
  END IF;

  SELECT id, status, academic_year_id INTO v_batch FROM public.report_card_batches WHERE id = v_rc.batch_id;

  IF v_batch.status IN ('validated_by_admin', 'published', 'superseded') THEN
    RAISE EXCEPTION 'Action refusée : Impossible de modifier les remarques d’un bulletin validé ou publié (statut actuel: %).', v_batch.status;
  END IF;

  SELECT id, homeroom_teacher_id INTO v_class FROM public.classes WHERE id = v_rc.class_id;

  IF v_role = 'super_admin' THEN
    INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
    VALUES (
      v_rc.school_id, v_uid, 'super_admin_override_report_card_remarks',
      jsonb_build_object('report_card_id', p_report_card_id, 'batch_id', v_rc.batch_id)
    );
  ELSIF v_role = 'school_admin' THEN
    IF v_school_id IS DISTINCT FROM v_rc.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF v_school_id IS DISTINCT FROM v_rc.school_id THEN
      RAISE EXCEPTION 'Accès refusé.';
    END IF;

    SELECT id, profile_id, employment_status, account_status
    INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid
      AND school_id = v_rc.school_id
      AND account_status = 'active'
      AND employment_status = 'active';

    IF v_teacher.id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Enseignant inactif ou non habilité.';
    END IF;

    IF v_class.homeroom_teacher_id = v_uid OR v_class.homeroom_teacher_id = v_teacher.id THEN
      v_is_homeroom := true;
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  -- 1. Appréciations du Titulaire (uniquement homeroom_teacher_remarks et conduct_grade, batch en statut draft)
  IF p_homeroom_remarks IS NOT NULL OR p_conduct_grade IS NOT NULL THEN
    IF v_role <> 'super_admin' AND NOT v_is_homeroom THEN
      RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire de cette classe peut modifier l’appréciation générale et la note de conduite.';
    END IF;

    IF v_batch.status <> 'draft' AND v_role <> 'super_admin' THEN
      RAISE EXCEPTION 'Les appréciations du titulaire ne peuvent être saisies qu’en statut Brouillon (draft).';
    END IF;

    IF LENGTH(COALESCE(p_homeroom_remarks, '')) > 1000 THEN
      RAISE EXCEPTION 'L’appréciation générale du titulaire ne doit pas dépasser 1000 caractères.';
    END IF;

    IF LENGTH(COALESCE(p_conduct_grade, '')) > 50 THEN
      RAISE EXCEPTION 'La mention de conduite ne doit pas dépasser 50 caractères.';
    END IF;

    UPDATE public.period_report_cards
    SET
      homeroom_teacher_remarks = NULLIF(TRIM(p_homeroom_remarks), ''),
      conduct_grade = NULLIF(TRIM(p_conduct_grade), ''),
      updated_at = now()
    WHERE id = p_report_card_id;
  END IF;

  -- 2. Appréciation de la Direction (uniquement principal_remarks, batch en statut submitted_by_homeroom)
  IF p_principal_remarks IS NOT NULL THEN
    IF v_role NOT IN ('school_admin', 'super_admin') THEN
      RAISE EXCEPTION 'Accès refusé : Seule la direction de l’établissement peut renseigner l’appréciation de direction.';
    END IF;

    IF v_batch.status <> 'submitted_by_homeroom' AND v_role <> 'super_admin' THEN
      RAISE EXCEPTION 'L’appréciation de direction ne peut être saisie que sur un lot soumis par le titulaire (statut actuel: %).', v_batch.status;
    END IF;

    IF LENGTH(COALESCE(p_principal_remarks, '')) > 1000 THEN
      RAISE EXCEPTION 'L’appréciation de direction ne doit pas dépasser 1000 caractères.';
    END IF;

    UPDATE public.period_report_cards
    SET
      principal_remarks = NULLIF(TRIM(p_principal_remarks), ''),
      updated_at = now()
    WHERE id = p_report_card_id;
  END IF;

  -- 3. Remarques par matière (vérification stricte de l'affectation active, batch en statut draft)
  IF p_subject_remarks IS NOT NULL AND jsonb_typeof(p_subject_remarks) = 'array' THEN
    IF v_batch.status <> 'draft' AND v_role <> 'super_admin' THEN
      RAISE EXCEPTION 'Les remarques par matière ne peuvent être modifiées qu’en statut Brouillon.';
    END IF;

    FOR v_subj_elem IN SELECT * FROM jsonb_array_elements(p_subject_remarks)
    LOOP
      v_target_subject_id := (v_subj_elem->>'subject_id')::uuid;
      v_target_remark := NULLIF(TRIM(v_subj_elem->>'remark'), '');

      IF LENGTH(COALESCE(v_target_remark, '')) > 500 THEN
        RAISE EXCEPTION 'La remarque par matière ne doit pas dépasser 500 caractères.';
      END IF;

      -- L'enseignant (même s'il est titulaire) doit impérativement être affecté à la matière
      IF v_role = 'teacher' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.teacher_class_assignments tca
          WHERE (tca.teacher_profile_id = v_uid OR tca.teacher_id = v_teacher.id)
            AND tca.class_id = v_rc.class_id
            AND tca.subject_id = v_target_subject_id
            AND tca.academic_year_id = v_batch.academic_year_id
            AND tca.school_id = v_rc.school_id
            AND tca.is_active = true
        ) THEN
          RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas affecté à la matière (%) dans cette classe.', v_target_subject_id;
        END IF;
      ELSIF v_role = 'school_admin' THEN
        RAISE EXCEPTION 'Accès refusé : La direction ne modifie pas les remarques individuelles des matières.';
      END IF;

      UPDATE public.report_card_subject_results
      SET
        subject_remark = v_target_remark,
        updated_at = now()
      WHERE report_card_id = p_report_card_id
        AND subject_id = v_target_subject_id;

      GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
      IF v_updated_rows <> 1 THEN
        RAISE EXCEPTION 'Erreur de mise à jour : La matière (%) n’existe pas dans ce bulletin.', v_target_subject_id;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'report_card_id', p_report_card_id);
END;
$$;

--------------------------------------------------------------------------------
-- 8. RPC 3 : SOUMISSION DU LOT DE BULLETINS PAR LE PROFESSEUR TITULAIRE
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.submit_report_card_batch(UUID);
CREATE OR REPLACE FUNCTION public.submit_report_card_batch(
  p_batch_id UUID
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
  v_active BOOLEAN;
  v_batch RECORD;
  v_class RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_active_enrollments_count INTEGER := 0;
  v_report_cards_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  -- 1. Lecture préliminaire de la classe et période
  SELECT id, class_id, period_id, school_id, status INTO v_batch
  FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  -- 2. Acquisition uniforme du verrou exclusif
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || v_batch.class_id::text || '_' || v_batch.period_id::text));

  -- 3. Verrouillage FOR UPDATE du lot et revérification du statut
  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_batch.status <> 'draft' THEN
    RAISE EXCEPTION 'Seul un lot en statut Brouillon peut être soumis (statut actuel: %).', v_batch.status;
  END IF;

  SELECT id, homeroom_teacher_id INTO v_class FROM public.classes WHERE id = v_batch.class_id;

  IF v_class.homeroom_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Opération bloquée : Aucun professeur titulaire n’est affecté à cette classe.';
  END IF;

  -- Vérification stricte du titulaire actif
  IF v_role = 'teacher' THEN
    SELECT id INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid
      AND school_id = v_batch.school_id
      AND account_status = 'active'
      AND employment_status = 'active';

    IF v_teacher.id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Dossier enseignant inactif ou introuvable.';
    END IF;

    IF v_class.homeroom_teacher_id = v_uid OR v_class.homeroom_teacher_id = v_teacher.id THEN
      v_is_homeroom := true;
    END IF;
  ELSIF v_role = 'super_admin' THEN
    v_is_homeroom := true;
  END IF;

  IF NOT v_is_homeroom THEN
    RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire actif de cette classe peut soumettre les bulletins à la direction.';
  END IF;

  -- Vérifier que le nombre de bulletins correspond aux inscriptions actives
  SELECT COUNT(*) INTO v_active_enrollments_count
  FROM public.student_enrollments se
  JOIN public.students s ON s.id = se.student_id
  WHERE se.class_id = v_batch.class_id
    AND se.academic_year_id = v_batch.academic_year_id
    AND se.school_id = v_batch.school_id
    AND se.status = 'active'
    AND s.enrollment_status = 'active';

  SELECT COUNT(*) INTO v_report_cards_count
  FROM public.period_report_cards WHERE batch_id = p_batch_id;

  IF v_report_cards_count <> v_active_enrollments_count THEN
    RAISE EXCEPTION 'Incohérence d’effectif : Le lot contient % bulletins pour % élèves actifs. Veuillez régénérer le brouillon.',
      v_report_cards_count, v_active_enrollments_count;
  END IF;

  -- Définir le contexte sécurisé de transition
  PERFORM set_config('app.report_card_transition_ctx', 'authorized_submit_transition', true);

  UPDATE public.report_card_batches
  SET
    status = 'submitted_by_homeroom',
    submitted_by = v_uid,
    submitted_at = now(),
    updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_batch.school_id, v_uid, 'submit_report_card_batch',
    jsonb_build_object('batch_id', p_batch_id, 'class_id', v_batch.class_id, 'period_id', v_batch.period_id)
  );

  RETURN jsonb_build_object('success', true, 'batch_id', p_batch_id, 'status', 'submitted_by_homeroom');
END;
$$;

--------------------------------------------------------------------------------
-- 9. RPC 4 : VALIDATION ADMINISTRATIVE DU LOT DE BULLETINS
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.validate_report_card_batch(UUID);
CREATE OR REPLACE FUNCTION public.validate_report_card_batch(
  p_batch_id UUID
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
  v_active BOOLEAN;
  v_batch RECORD;
  v_school RECORD;
  v_class RECORD;
  v_period RECORD;
  v_term RECORD;
  v_year RECORD;
  v_homeroom_teacher RECORD;
  v_cards_count INTEGER;
  v_subjects_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seul l’administrateur de l’établissement peut valider un lot de bulletins.';
  END IF;

  -- 1. Lecture préliminaire
  SELECT id, class_id, period_id, school_id, status INTO v_batch
  FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_role = 'school_admin' AND v_school_id IS DISTINCT FROM v_batch.school_id THEN
    RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
  END IF;

  -- 2. Acquisition uniforme du verrou exclusif
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || v_batch.class_id::text || '_' || v_batch.period_id::text));

  -- 3. Verrouillage FOR UPDATE du lot et revérification du statut
  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_batch.status <> 'submitted_by_homeroom' THEN
    RAISE EXCEPTION 'Ce lot ne peut être validé que s’il est soumis par le titulaire (statut actuel: %).', v_batch.status;
  END IF;

  -- Vérification des métadonnées de l'école
  SELECT name, logo_url, principal_name, director_signature_url, stamp_url, motto, address, phone, email, official_registration_number
  INTO v_school
  FROM public.schools WHERE id = v_batch.school_id;

  IF v_school.principal_name IS NULL OR LENGTH(TRIM(v_school.principal_name)) = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Le nom du chef d’établissement n’est pas configuré dans les paramètres de l’école.';
  END IF;

  IF v_school.director_signature_url IS NULL OR LENGTH(TRIM(v_school.director_signature_url)) = 0 THEN
    RAISE EXCEPTION 'Validation impossible : La signature numérique de la direction n’est pas enregistrée.';
  END IF;

  IF v_school.stamp_url IS NULL OR LENGTH(TRIM(v_school.stamp_url)) = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Le cachet officiel de l’établissement n’est pas enregistré.';
  END IF;

  -- Vérification du titulaire actif (avec profiles.school_id = batch.school_id)
  SELECT id, name, education_cycle, homeroom_teacher_id INTO v_class FROM public.classes WHERE id = v_batch.class_id;

  IF v_class.homeroom_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Validation impossible : Aucun professeur titulaire n’est affecté à cette classe.';
  END IF;

  SELECT t.id, t.profile_id, t.signature_url, t.first_name, t.last_name
  INTO v_homeroom_teacher
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE (t.id = v_class.homeroom_teacher_id OR t.profile_id = v_class.homeroom_teacher_id)
    AND t.school_id = v_batch.school_id
    AND p.school_id = v_batch.school_id
    AND t.account_status = 'active'
    AND t.employment_status = 'active'
    AND p.is_active = true;

  IF v_homeroom_teacher.id IS NULL THEN
    RAISE EXCEPTION 'Validation impossible : Le titulaire de la classe est inactif ou n’appartient pas à cet établissement.';
  END IF;

  IF v_homeroom_teacher.signature_url IS NULL OR LENGTH(TRIM(v_homeroom_teacher.signature_url)) = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Le professeur titulaire (%) n’a pas encore téléversé sa signature numérique.',
      TRIM(COALESCE(v_homeroom_teacher.first_name, '') || ' ' || COALESCE(v_homeroom_teacher.last_name, ''));
  END IF;

  -- Vérifier la présence des bulletins et matières
  SELECT COUNT(*) INTO v_cards_count FROM public.period_report_cards WHERE batch_id = p_batch_id;
  IF v_cards_count = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Le lot ne contient aucun bulletin.';
  END IF;

  SELECT COUNT(*) INTO v_subjects_count
  FROM public.report_card_subject_results s
  JOIN public.period_report_cards rc ON rc.id = s.report_card_id
  WHERE rc.batch_id = p_batch_id;

  IF v_subjects_count = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Aucun résultat de matière n’est rattaché aux bulletins de ce lot.';
  END IF;

  -- Rafraîchir et figer l'identité et les signatures pour chaque bulletin
  SELECT name, starts_on, ends_on, parent_term_id INTO v_period FROM public.school_periods WHERE id = v_batch.period_id;
  SELECT name INTO v_term FROM public.school_terms WHERE id = v_period.parent_term_id;
  SELECT name INTO v_year FROM public.academic_years WHERE id = v_batch.academic_year_id;

  UPDATE public.period_report_cards rc
  SET
    identity_snapshot = jsonb_build_object(
      'student_id', s.id,
      'student_number', s.student_number,
      'student_name', TRIM(COALESCE(p.first_name, s.first_name, '') || ' ' || COALESCE(p.last_name, s.last_name, '')),
      'student_first_name', COALESCE(p.first_name, s.first_name, ''),
      'student_last_name', COALESCE(p.last_name, s.last_name, ''),
      'gender', s.gender,
      'date_of_birth', s.date_of_birth,
      'class_id', v_class.id,
      'class_name', v_class.name,
      'education_cycle', v_class.education_cycle,
      'academic_year_id', v_batch.academic_year_id,
      'academic_year_name', v_year.name,
      'period_id', v_batch.period_id,
      'period_name', v_period.name,
      'period_starts_on', v_period.starts_on,
      'period_ends_on', v_period.ends_on,
      'term_name', v_term.name,
      'school_name', v_school.name,
      'school_address', v_school.address,
      'school_phone', v_school.phone,
      'school_email', v_school.email,
      'logo_url', v_school.logo_url,
      'official_registration_number', v_school.official_registration_number,
      'motto', v_school.motto
    ),
    signature_snapshot = jsonb_build_object(
      'principal_name', v_school.principal_name,
      'director_signature_url', v_school.director_signature_url,
      'stamp_url', v_school.stamp_url,
      'homeroom_teacher_name', TRIM(COALESCE(v_homeroom_teacher.first_name, '') || ' ' || COALESCE(v_homeroom_teacher.last_name, '')),
      'homeroom_teacher_signature_url', v_homeroom_teacher.signature_url,
      'validated_at', now()
    ),
    updated_at = now()
  FROM public.students s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE rc.student_id = s.id AND rc.batch_id = p_batch_id;

  -- Définir le contexte sécurisé de transition
  PERFORM set_config('app.report_card_transition_ctx', 'authorized_validate_transition', true);

  UPDATE public.report_card_batches
  SET
    status = 'validated_by_admin',
    validated_by = v_uid,
    validated_at = now(),
    updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_batch.school_id, v_uid, 'validate_report_card_batch',
    jsonb_build_object('batch_id', p_batch_id, 'class_id', v_batch.class_id, 'period_id', v_batch.period_id)
  );

  RETURN jsonb_build_object('success', true, 'batch_id', p_batch_id, 'status', 'validated_by_admin');
END;
$$;

--------------------------------------------------------------------------------
-- 10. RPC 5 : PUBLICATION OFFICIELLE DU LOT DE BULLETINS
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.publish_report_card_batch(UUID);
CREATE OR REPLACE FUNCTION public.publish_report_card_batch(
  p_batch_id UUID
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
  v_active BOOLEAN;
  v_batch RECORD;
  v_old_batch_id UUID;
  v_superseded_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seul l’administrateur de l’établissement peut publier les bulletins.';
  END IF;

  -- 1. Lecture préliminaire
  SELECT id, class_id, period_id, school_id, academic_year_id, status INTO v_batch
  FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_role = 'school_admin' AND v_school_id IS DISTINCT FROM v_batch.school_id THEN
    RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
  END IF;

  -- 2. Acquisition uniforme du verrou exclusif
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || v_batch.class_id::text || '_' || v_batch.period_id::text));

  -- 3. Verrouillage FOR UPDATE du lot et revérification du statut
  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_batch.status <> 'validated_by_admin' THEN
    RAISE EXCEPTION 'Le lot doit impérativement être validé administrativement (validated_by_admin) avant publication (statut actuel: %).', v_batch.status;
  END IF;

  -- 4. Définir le contexte sécurisé de transition
  PERFORM set_config('app.report_card_transition_ctx', 'authorized_publish_transition', true);

  -- 5. Verrouiller et passer l'ancienne révision publiée à superseded
  SELECT id INTO v_old_batch_id
  FROM public.report_card_batches
  WHERE school_id = v_batch.school_id
    AND academic_year_id = v_batch.academic_year_id
    AND class_id = v_batch.class_id
    AND period_id = v_batch.period_id
    AND id <> p_batch_id
    AND status = 'published'
  FOR UPDATE;

  IF v_old_batch_id IS NOT NULL THEN
    UPDATE public.report_card_batches
    SET status = 'superseded', updated_at = now()
    WHERE id = v_old_batch_id;
    v_superseded_count := 1;
  END IF;

  -- 6. Figer les types de rangs officiels / provisoires
  UPDATE public.period_report_cards
  SET
    rank_type = CASE WHEN is_incomplete THEN 'provisional' ELSE 'official' END,
    updated_at = now()
  WHERE batch_id = p_batch_id;

  -- 7. Publication officielle du lot
  UPDATE public.report_card_batches
  SET
    status = 'published',
    published_by = v_uid,
    published_at = now(),
    updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_batch.school_id, v_uid, 'publish_report_card_batch',
    jsonb_build_object(
      'batch_id', p_batch_id,
      'class_id', v_batch.class_id,
      'period_id', v_batch.period_id,
      'revision_number', v_batch.revision_number,
      'superseded_previous_batch_id', v_old_batch_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'status', 'published',
    'superseded_previous_batches', v_superseded_count
  );
END;
$$;

--------------------------------------------------------------------------------
-- 11. RPC 6 : RENVOI EN BROUILLON PAR LA DIRECTION
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.return_report_card_batch_to_draft(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.return_report_card_batch_to_draft(
  p_batch_id UUID,
  p_reason TEXT
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
  v_active BOOLEAN;
  v_batch RECORD;
  v_clean_reason TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seule la direction de l’établissement peut renvoyer un lot en brouillon.';
  END IF;

  v_clean_reason := TRIM(COALESCE(p_reason, ''));
  IF LENGTH(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'Le motif de renvoi en brouillon est obligatoire et doit comporter au moins 5 caractères.';
  END IF;

  -- 1. Lecture préliminaire
  SELECT id, class_id, period_id, school_id, status INTO v_batch
  FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_role = 'school_admin' AND v_school_id IS DISTINCT FROM v_batch.school_id THEN
    RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
  END IF;

  -- 2. Acquisition uniforme du verrou exclusif
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || v_batch.class_id::text || '_' || v_batch.period_id::text));

  -- 3. Verrouillage FOR UPDATE du lot et revérification du statut
  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_batch.status NOT IN ('submitted_by_homeroom', 'validated_by_admin') THEN
    RAISE EXCEPTION 'Seul un lot soumis ou validé peut être renvoyé en brouillon (statut actuel: %).', v_batch.status;
  END IF;

  -- Définir le contexte sécurisé de transition
  PERFORM set_config('app.report_card_transition_ctx', 'authorized_return_to_draft_transition', true);

  UPDATE public.report_card_batches
  SET
    status = 'draft',
    returned_to_draft_by = v_uid,
    returned_to_draft_at = now(),
    return_reason = v_clean_reason,
    updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_batch.school_id, v_uid, 'return_report_card_batch_to_draft',
    jsonb_build_object(
      'batch_id', p_batch_id,
      'class_id', v_batch.class_id,
      'period_id', v_batch.period_id,
      'reason', v_clean_reason
    )
  );

  RETURN jsonb_build_object('success', true, 'batch_id', p_batch_id, 'status', 'draft');
END;
$$;

--------------------------------------------------------------------------------
-- 12. RPC 7 : RÉOUVERTURE ADMINISTRATIVE DU LOT DE BULLETINS
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.reopen_report_card_batch(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.reopen_report_card_batch(
  p_batch_id UUID,
  p_reason TEXT
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
  v_active BOOLEAN;
  v_old_batch RECORD;
  v_new_revision INTEGER;
  v_new_batch_id UUID;
  v_clean_reason TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seul l’administrateur de l’établissement peut réouvrir un lot de bulletins.';
  END IF;

  v_clean_reason := TRIM(COALESCE(p_reason, ''));
  IF LENGTH(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'Le motif de réouverture est obligatoire et doit comporter au moins 5 caractères.';
  END IF;

  -- 1. Lecture préliminaire
  SELECT id, class_id, period_id, school_id, academic_year_id, status INTO v_old_batch
  FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_old_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_role = 'school_admin' AND v_school_id IS DISTINCT FROM v_old_batch.school_id THEN
    RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
  END IF;

  -- 2. Acquisition uniforme du verrou exclusif
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || v_old_batch.class_id::text || '_' || v_old_batch.period_id::text));

  -- 3. Verrouillage FOR UPDATE du lot et revérification du statut
  SELECT * INTO v_old_batch FROM public.report_card_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_old_batch.status <> 'published' THEN
    RAISE EXCEPTION 'Seul un lot publié peut faire l’objet d’une réouverture administrative (statut actuel: %).', v_old_batch.status;
  END IF;

  -- Déterminer la nouvelle révision
  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_new_revision
  FROM public.report_card_batches
  WHERE school_id = v_old_batch.school_id
    AND academic_year_id = v_old_batch.academic_year_id
    AND class_id = v_old_batch.class_id
    AND period_id = v_old_batch.period_id;

  -- L'ancien lot reste en statut published jusqu'à la publication de la nouvelle révision
  INSERT INTO public.report_card_batches (
    school_id, academic_year_id, class_id, period_id, revision_number,
    status, created_by, return_reason, returned_to_draft_by, returned_to_draft_at
  ) VALUES (
    v_old_batch.school_id, v_old_batch.academic_year_id, v_old_batch.class_id, v_old_batch.period_id, v_new_revision,
    'draft', v_uid, v_clean_reason, v_uid, now()
  )
  RETURNING id INTO v_new_batch_id;

  -- Générer automatiquement le brouillon de la nouvelle révision
  PERFORM public.generate_class_report_card_draft(v_old_batch.class_id, v_old_batch.period_id);

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_old_batch.school_id, v_uid, 'reopen_report_card_batch',
    jsonb_build_object(
      'original_batch_id', p_batch_id,
      'new_batch_id', v_new_batch_id,
      'new_revision_number', v_new_revision,
      'reason', v_clean_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'original_batch_id', p_batch_id,
    'new_batch_id', v_new_batch_id,
    'new_revision_number', v_new_revision,
    'status', 'draft'
  );
END;
$$;

--------------------------------------------------------------------------------
-- 13. RPC 8 : CONSULTATION INDIVIDUELLE SÉCURISÉE (PORTAIL ÉLÈVE ET PARENT)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_my_published_report_card(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_my_published_report_card(
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
  v_active BOOLEAN;
  v_student RECORD;
  v_parent_link RECORD;
  v_rc RECORD;
  v_subjects_json JSONB := '[]'::jsonb;
  v_subj_cur RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, is_active INTO v_role, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  SELECT id, school_id, profile_id, account_status, enrollment_status, student_number
  INTO v_student
  FROM public.students WHERE id = p_student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Dossier élève introuvable.';
  END IF;

  -- Vérification des autorisations par rôle
  IF v_role = 'student' THEN
    IF v_student.profile_id IS DISTINCT FROM v_uid OR v_student.account_status <> 'active' OR v_student.enrollment_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que votre propre bulletin.';
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
      RAISE EXCEPTION 'Accès refusé : Consultation académique désactivée ou lien parental non approuvé.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  -- Récupérer la dernière révision publiée
  SELECT rc.*, b.revision_number, b.published_at
  INTO v_rc
  FROM public.period_report_cards rc
  JOIN public.report_card_batches b ON b.id = rc.batch_id
  WHERE rc.student_id = p_student_id
    AND rc.period_id = p_period_id
    AND b.status = 'published'
  ORDER BY b.revision_number DESC
  LIMIT 1;

  IF v_rc.id IS NULL THEN
    RETURN jsonb_build_object(
      'is_published', false,
      'message', 'Le bulletin officiel pour cette période n’a pas encore été publié par l’établissement.'
    );
  END IF;

  -- Récupérer les matières du bulletin
  FOR v_subj_cur IN (
    SELECT * FROM public.report_card_subject_results
    WHERE report_card_id = v_rc.id
    ORDER BY display_position ASC
  ) LOOP
    v_subjects_json := v_subjects_json || jsonb_build_object(
      'subject_id', v_subj_cur.subject_id,
      'subject_name', v_subj_cur.subject_name_snapshot,
      'subject_code', v_subj_cur.subject_code_snapshot,
      'coefficient', v_subj_cur.coefficient,
      'subject_percentage', v_subj_cur.subject_percentage,
      'assessment_count', v_subj_cur.assessment_count,
      'completed_assessment_count', v_subj_cur.completed_assessment_count,
      'pending_assessment_count', v_subj_cur.pending_assessment_count,
      'is_complete', v_subj_cur.is_complete,
      'subject_remark', v_subj_cur.subject_remark
    );
  END LOOP;

  -- Retourne strictement les données académiques et le chemin PDF sans exposer les signatures brutes
  RETURN jsonb_build_object(
    'is_published', true,
    'report_card_id', v_rc.id,
    'batch_id', v_rc.batch_id,
    'revision_number', v_rc.revision_number,
    'published_at', v_rc.published_at,
    'student_id', v_rc.student_id,
    'overall_percentage', v_rc.overall_percentage,
    'my_rank', v_rc.rank,
    'class_size', v_rc.total_students_ranked,
    'rank_type', v_rc.rank_type,
    'is_incomplete', v_rc.is_incomplete,
    'completed_subjects_count', v_rc.completed_subjects_count,
    'pending_subjects_count', v_rc.pending_subjects_count,
    'total_subject_coefficients', v_rc.total_subject_coefficients,
    'homeroom_teacher_remarks', v_rc.homeroom_teacher_remarks,
    'conduct_grade', v_rc.conduct_grade,
    'principal_remarks', v_rc.principal_remarks,
    'identity', v_rc.identity_snapshot,
    'pdf_storage_path', v_rc.pdf_storage_path,
    'pdf_version', v_rc.pdf_version,
    'subjects', v_subjects_json
  );
END;
$$;

--------------------------------------------------------------------------------
-- 14. RPC 9 : CONSULTATION COMPLÈTE DE GESTION (ADMINISTRATION ET TITULAIRE)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_report_card_for_management(UUID);
CREATE OR REPLACE FUNCTION public.get_report_card_for_management(
  p_batch_id UUID
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
  v_school_id UUID;
  v_active BOOLEAN;
  v_batch RECORD;
  v_class RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_cards_json JSONB := '[]'::jsonb;
  v_card_cur RECORD;
  v_subj_json JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  SELECT id, name, education_cycle, homeroom_teacher_id INTO v_class
  FROM public.classes WHERE id = v_batch.class_id;

  IF v_role = 'super_admin' THEN
    v_is_homeroom := true;
  ELSIF v_role = 'school_admin' THEN
    IF v_school_id IS DISTINCT FROM v_batch.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
    END IF;
    v_is_homeroom := true;
  ELSIF v_role = 'teacher' THEN
    IF v_school_id IS DISTINCT FROM v_batch.school_id THEN
      RAISE EXCEPTION 'Accès refusé.';
    END IF;

    SELECT id INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid
      AND school_id = v_batch.school_id
      AND account_status = 'active'
      AND employment_status = 'active';

    IF v_teacher.id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Dossier enseignant inactif ou introuvable.';
    END IF;

    IF v_class.homeroom_teacher_id = v_uid OR v_class.homeroom_teacher_id = v_teacher.id THEN
      v_is_homeroom := true;
    END IF;

    IF NOT v_is_homeroom THEN
      RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire de cette classe ou l’administrateur peut gérer ce lot.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  -- Construction des bulletins
  FOR v_card_cur IN (
    SELECT rc.*
    FROM public.period_report_cards rc
    WHERE rc.batch_id = p_batch_id
    ORDER BY rc.rank ASC NULLS LAST, (rc.identity_snapshot->>'student_name') ASC
  ) LOOP
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'subject_id', s.subject_id,
          'subject_name', s.subject_name_snapshot,
          'subject_code', s.subject_code_snapshot,
          'coefficient', s.coefficient,
          'subject_percentage', s.subject_percentage,
          'assessment_count', s.assessment_count,
          'completed_assessment_count', s.completed_assessment_count,
          'pending_assessment_count', s.pending_assessment_count,
          'is_complete', s.is_complete,
          'subject_remark', s.subject_remark,
          'display_position', s.display_position
        ) ORDER BY s.display_position ASC
      ), '[]'::jsonb
    ) INTO v_subj_json
    FROM public.report_card_subject_results s
    WHERE s.report_card_id = v_card_cur.id;

    v_cards_json := v_cards_json || jsonb_build_object(
      'report_card_id', v_card_cur.id,
      'student_id', v_card_cur.student_id,
      'student_number', v_card_cur.identity_snapshot->>'student_number',
      'student_name', v_card_cur.identity_snapshot->>'student_name',
      'overall_percentage', v_card_cur.overall_percentage,
      'rank', v_card_cur.rank,
      'total_students_ranked', v_card_cur.total_students_ranked,
      'rank_type', v_card_cur.rank_type,
      'is_incomplete', v_card_cur.is_incomplete,
      'completed_subjects_count', v_card_cur.completed_subjects_count,
      'pending_subjects_count', v_card_cur.pending_subjects_count,
      'total_subject_coefficients', v_card_cur.total_subject_coefficients,
      'homeroom_teacher_remarks', v_card_cur.homeroom_teacher_remarks,
      'conduct_grade', v_card_cur.conduct_grade,
      'principal_remarks', v_card_cur.principal_remarks,
      'pdf_storage_path', v_card_cur.pdf_storage_path,
      'pdf_generated_at', v_card_cur.pdf_generated_at,
      'pdf_checksum', v_card_cur.pdf_checksum,
      'pdf_version', v_card_cur.pdf_version,
      'identity', v_card_cur.identity_snapshot,
      'signatures', v_card_cur.signature_snapshot,
      'subjects', v_subj_json
    );
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', v_batch.id,
    'school_id', v_batch.school_id,
    'academic_year_id', v_batch.academic_year_id,
    'class_id', v_batch.class_id,
    'class_name', v_class.name,
    'period_id', v_batch.period_id,
    'revision_number', v_batch.revision_number,
    'status', v_batch.status,
    'total_students_count', v_batch.total_students_count,
    'complete_students_count', v_batch.complete_students_count,
    'incomplete_students_count', v_batch.incomplete_students_count,
    'submitted_at', v_batch.submitted_at,
    'validated_at', v_batch.validated_at,
    'published_at', v_batch.published_at,
    'returned_to_draft_at', v_batch.returned_to_draft_at,
    'return_reason', v_batch.return_reason,
    'report_cards', v_cards_json
  );
END;
$$;

--------------------------------------------------------------------------------
-- 15. RPC 10 : ATTACHEMENT DES MÉTADONNÉES PDF PAR LE SERVICE SERVEUR UNIQUEMENT
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.set_report_card_pdf_metadata(UUID, TEXT, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.set_report_card_pdf_metadata(
  p_report_card_id UUID,
  p_storage_path TEXT,
  p_checksum TEXT,
  p_version INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rc RECORD;
  v_batch RECORD;
  v_expected_path_prefix TEXT;
  v_storage_obj_exists BOOLEAN;
BEGIN
  -- 1. Vérification stricte que l'appel émane exclusivement du service_role
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès refusé : Seul le service serveur (service_role) est habilité à enregistrer les métadonnées PDF.';
  END IF;

  SELECT id, batch_id, school_id, student_id INTO v_rc
  FROM public.period_report_cards WHERE id = p_report_card_id;

  IF v_rc.id IS NULL THEN
    RAISE EXCEPTION 'Bulletin introuvable.';
  END IF;

  SELECT id, status INTO v_batch FROM public.report_card_batches WHERE id = v_rc.batch_id;

  IF v_batch.status <> 'published' THEN
    RAISE EXCEPTION 'Action refusée : Le PDF officiel ne peut être rattaché qu’à un bulletin publié (statut actuel: %).', v_batch.status;
  END IF;

  -- 2. Validation du format du chemin canonique
  v_expected_path_prefix := v_rc.school_id::text || '/' || v_rc.batch_id::text || '/' || v_rc.student_id::text || '/';

  IF p_storage_path IS NULL OR
     p_storage_path NOT LIKE (v_expected_path_prefix || 'report-card-v' || GREATEST(COALESCE(p_version, 1), 1)::text || '.pdf') OR
     p_storage_path LIKE '%..%' OR
     p_storage_path LIKE '%//%' THEN
    RAISE EXCEPTION 'Chemin de stockage invalide ou non canonique (attendu: %report-card-v%.pdf).', v_expected_path_prefix, GREATEST(COALESCE(p_version, 1), 1);
  END IF;

  -- 3. Validation du checksum SHA-256 (exactement 64 caractères hexadécimaux)
  IF p_checksum IS NULL OR p_checksum !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Checksum SHA-256 invalide : Exactement 64 caractères hexadécimaux requis.';
  END IF;

  -- 4. Vérification obligatoire de l'existence de l'objet dans storage.objects
  SELECT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'report-card-pdfs'
      AND name = p_storage_path
  ) INTO v_storage_obj_exists;

  IF NOT v_storage_obj_exists THEN
    RAISE EXCEPTION 'Fichier introuvable : Le fichier PDF (%) doit exister dans le bucket "report-card-pdfs" avant l’enregistrement des métadonnées.', p_storage_path;
  END IF;

  -- 5. Définir le contexte sécurisé pour autoriser la mise à jour PDF sur le trigger d'immutabilité
  PERFORM set_config('app.report_card_pdf_service_ctx', 'authorized_pdf_update', true);

  UPDATE public.period_report_cards
  SET
    pdf_storage_path = p_storage_path,
    pdf_checksum = LOWER(p_checksum),
    pdf_version = GREATEST(COALESCE(p_version, 1), 1),
    pdf_generated_at = now(),
    updated_at = now()
  WHERE id = p_report_card_id;

  RETURN jsonb_build_object(
    'success', true,
    'report_card_id', p_report_card_id,
    'pdf_storage_path', p_storage_path,
    'pdf_checksum', LOWER(p_checksum),
    'pdf_version', GREATEST(COALESCE(p_version, 1), 1)
  );
END;
$$;

--------------------------------------------------------------------------------
-- 16. POLITIQUES RLS SUR LES TABLES DE BULLETINS (LECTURE SEULE FRONTEND)
--------------------------------------------------------------------------------

ALTER TABLE public.report_card_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_report_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_card_subject_results ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.report_card_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.period_report_cards FORCE ROW LEVEL SECURITY;
ALTER TABLE public.report_card_subject_results FORCE ROW LEVEL SECURITY;

-- Suppression préalable idempotente de toutes les anciennes policies
DROP POLICY IF EXISTS "school_admin_manage_rc_batches" ON public.report_card_batches;
DROP POLICY IF EXISTS "teacher_read_rc_batches" ON public.report_card_batches;
DROP POLICY IF EXISTS "student_read_published_rc_batches" ON public.report_card_batches;
DROP POLICY IF EXISTS "parent_read_published_rc_batches" ON public.report_card_batches;
DROP POLICY IF EXISTS "school_admin_select_rc_batches" ON public.report_card_batches;
DROP POLICY IF EXISTS "teacher_select_rc_batches" ON public.report_card_batches;
DROP POLICY IF EXISTS "student_select_published_rc_batches" ON public.report_card_batches;
DROP POLICY IF EXISTS "parent_select_published_rc_batches" ON public.report_card_batches;

DROP POLICY IF EXISTS "school_admin_manage_period_rc" ON public.period_report_cards;
DROP POLICY IF EXISTS "teacher_manage_period_rc" ON public.period_report_cards;
DROP POLICY IF EXISTS "student_read_own_published_rc" ON public.period_report_cards;
DROP POLICY IF EXISTS "parent_read_linked_student_published_rc" ON public.period_report_cards;
DROP POLICY IF EXISTS "school_admin_select_period_rc" ON public.period_report_cards;
DROP POLICY IF EXISTS "teacher_select_period_rc" ON public.period_report_cards;
DROP POLICY IF EXISTS "student_select_own_published_rc" ON public.period_report_cards;
DROP POLICY IF EXISTS "parent_select_linked_student_published_rc" ON public.period_report_cards;

DROP POLICY IF EXISTS "school_admin_manage_rc_subjects" ON public.report_card_subject_results;
DROP POLICY IF EXISTS "teacher_manage_rc_subjects" ON public.report_card_subject_results;
DROP POLICY IF EXISTS "student_read_own_rc_subjects" ON public.report_card_subject_results;
DROP POLICY IF EXISTS "parent_read_linked_rc_subjects" ON public.report_card_subject_results;
DROP POLICY IF EXISTS "school_admin_select_rc_subjects" ON public.report_card_subject_results;
DROP POLICY IF EXISTS "teacher_select_rc_subjects" ON public.report_card_subject_results;
DROP POLICY IF EXISTS "student_select_own_rc_subjects" ON public.report_card_subject_results;
DROP POLICY IF EXISTS "parent_select_linked_rc_subjects" ON public.report_card_subject_results;

-- Policies SELECT report_card_batches
CREATE POLICY "school_admin_select_rc_batches"
ON public.report_card_batches FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND (p.role = 'super_admin' OR (p.role = 'school_admin' AND p.school_id = report_card_batches.school_id))
  )
);

CREATE POLICY "teacher_select_rc_batches"
ON public.report_card_batches FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    JOIN public.classes c ON c.id = report_card_batches.class_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.school_id = report_card_batches.school_id
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND (c.homeroom_teacher_id = auth.uid() OR c.homeroom_teacher_id = t.id)
  )
);

CREATE POLICY "student_select_published_rc_batches"
ON public.report_card_batches FOR SELECT
TO authenticated
USING (
  report_card_batches.status = 'published' AND
  EXISTS (
    SELECT 1 FROM public.students s
    JOIN public.student_enrollments se ON se.student_id = s.id
    WHERE s.profile_id = auth.uid()
      AND s.account_status = 'active'
      AND se.class_id = report_card_batches.class_id
      AND se.academic_year_id = report_card_batches.academic_year_id
      AND se.status = 'active'
  )
);

CREATE POLICY "parent_select_published_rc_batches"
ON public.report_card_batches FOR SELECT
TO authenticated
USING (
  report_card_batches.status = 'published' AND
  EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    JOIN public.student_enrollments se ON se.student_id = psl.student_id
    JOIN public.parent_accounts pa ON pa.profile_id = psl.parent_profile_id AND pa.school_id = psl.school_id
    WHERE psl.parent_profile_id = auth.uid()
      AND psl.status = 'approved'
      AND psl.can_view_academic = true
      AND pa.account_status = 'active'
      AND se.class_id = report_card_batches.class_id
      AND se.academic_year_id = report_card_batches.academic_year_id
      AND se.status = 'active'
  )
);

-- Policies SELECT period_report_cards
CREATE POLICY "school_admin_select_period_rc"
ON public.period_report_cards FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND (p.role = 'super_admin' OR (p.role = 'school_admin' AND p.school_id = period_report_cards.school_id))
  )
);

CREATE POLICY "teacher_select_period_rc"
ON public.period_report_cards FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    JOIN public.classes c ON c.id = period_report_cards.class_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.school_id = period_report_cards.school_id
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND (c.homeroom_teacher_id = auth.uid() OR c.homeroom_teacher_id = t.id)
  )
);

CREATE POLICY "student_select_own_published_rc"
ON public.period_report_cards FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.students s
    JOIN public.report_card_batches b ON b.id = period_report_cards.batch_id
    WHERE s.profile_id = auth.uid()
      AND s.id = period_report_cards.student_id
      AND s.account_status = 'active'
      AND b.status = 'published'
  )
);

CREATE POLICY "parent_select_linked_student_published_rc"
ON public.period_report_cards FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    JOIN public.parent_accounts pa ON pa.profile_id = psl.parent_profile_id AND pa.school_id = psl.school_id
    JOIN public.report_card_batches b ON b.id = period_report_cards.batch_id
    WHERE psl.parent_profile_id = auth.uid()
      AND psl.student_id = period_report_cards.student_id
      AND psl.status = 'approved'
      AND psl.can_view_academic = true
      AND pa.account_status = 'active'
      AND b.status = 'published'
  )
);

-- Policies SELECT report_card_subject_results
CREATE POLICY "school_admin_select_rc_subjects"
ON public.report_card_subject_results FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.period_report_cards rc
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE rc.id = report_card_subject_results.report_card_id
      AND p.is_active = true
      AND (p.role = 'super_admin' OR (p.role = 'school_admin' AND p.school_id = rc.school_id))
  )
);

CREATE POLICY "teacher_select_rc_subjects"
ON public.report_card_subject_results FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.period_report_cards rc
    JOIN public.classes c ON c.id = rc.class_id
    JOIN public.profiles p ON p.id = auth.uid()
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    WHERE rc.id = report_card_subject_results.report_card_id
      AND p.is_active = true
      AND p.school_id = rc.school_id
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND (c.homeroom_teacher_id = auth.uid() OR c.homeroom_teacher_id = t.id)
  )
);

CREATE POLICY "student_select_own_rc_subjects"
ON public.report_card_subject_results FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.period_report_cards rc
    JOIN public.report_card_batches b ON b.id = rc.batch_id
    JOIN public.students s ON s.id = rc.student_id
    WHERE rc.id = report_card_subject_results.report_card_id
      AND s.profile_id = auth.uid()
      AND s.account_status = 'active'
      AND b.status = 'published'
  )
);

CREATE POLICY "parent_select_linked_rc_subjects"
ON public.report_card_subject_results FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.period_report_cards rc
    JOIN public.report_card_batches b ON b.id = rc.batch_id
    JOIN public.parent_student_links psl ON psl.student_id = rc.student_id
    JOIN public.parent_accounts pa ON pa.profile_id = psl.parent_profile_id AND pa.school_id = psl.school_id
    WHERE rc.id = report_card_subject_results.report_card_id
      AND psl.parent_profile_id = auth.uid()
      AND psl.status = 'approved'
      AND psl.can_view_academic = true
      AND pa.account_status = 'active'
      AND b.status = 'published'
  )
);

--------------------------------------------------------------------------------
-- 17. MATRICE DES PRIVILÈGES ET RÉVOCATIONS DE SÉCURITÉ
--------------------------------------------------------------------------------

-- Révocation stricte des privilèges publics et anonymes sur toutes les RPC
REVOKE ALL ON FUNCTION public.generate_class_report_card_draft(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_report_card_remarks(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_report_card_batch(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_report_card_batch(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_report_card_batch(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_report_card_batch_to_draft(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_report_card_batch(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_published_report_card(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_report_card_for_management(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_report_card_pdf_metadata(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

-- Révocation stricte sur les triggers internes et fonctions d'intégrité
REVOKE ALL ON FUNCTION public.set_report_card_timestamp_updated_at() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_report_card_batch_integrity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_period_report_card_integrity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_report_card_subject_integrity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_report_card_state_machine() FROM PUBLIC, anon;

-- Révocation de sécurité demandée sur les fonctions triggers historiques
REVOKE ALL ON FUNCTION public.check_school_assessment_integrity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_school_period_integrity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_student_grade_integrity() FROM PUBLIC, anon;

-- Attribution contrôlée aux utilisateurs authentifiés et au service_role
GRANT EXECUTE ON FUNCTION public.generate_class_report_card_draft(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_report_card_remarks(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_report_card_batch(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_report_card_batch(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_report_card_batch(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.return_report_card_batch_to_draft(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_report_card_batch(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_published_report_card(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_card_for_management(UUID) TO authenticated, service_role;

-- La RPC PDF est exclusivement réservée au service_role
GRANT EXECUTE ON FUNCTION public.set_report_card_pdf_metadata(UUID, TEXT, TEXT, INTEGER) TO service_role;

-- Privilèges SELECT stricts sur les tables pour authenticated (toutes écritures via RPC)
GRANT SELECT ON public.report_card_batches TO authenticated, service_role;
GRANT SELECT ON public.period_report_cards TO authenticated, service_role;
GRANT SELECT ON public.report_card_subject_results TO authenticated, service_role;

COMMIT;
