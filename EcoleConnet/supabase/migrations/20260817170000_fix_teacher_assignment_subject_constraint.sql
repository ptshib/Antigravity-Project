-- Migration Phase 2D.1 Fix : Correction de la contrainte d'unicité des affectations enseignants/matières
-- Fichier : supabase/migrations/20260817170000_fix_teacher_assignment_subject_constraint.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. BACKFILL DES TEACHER_ID ET PRESERVATION DES DONNEES EXISTANTES
--------------------------------------------------------------------------------
-- S'assurer que tous les enregistrements possèdent leur teacher_id renseigné depuis teacher_profile_id
UPDATE public.teacher_class_assignments tca
SET teacher_id = t.id
FROM public.teachers t
WHERE tca.teacher_id IS NULL
  AND tca.teacher_profile_id IS NOT NULL
  AND t.profile_id = tca.teacher_profile_id
  AND t.school_id = tca.school_id;

--------------------------------------------------------------------------------
-- 2. CONTROLE FAIL-FAST DES DOUBLONS ACTIFS EXISTANTS
--------------------------------------------------------------------------------
-- Détecter et lever une exception si des affectations actives en double existent déjà
DO $$
DECLARE
  v_duplicate_subject_count INTEGER := 0;
  v_duplicate_general_count INTEGER := 0;
BEGIN
  -- Contrôle fail-fast pour les matières réelles actives
  SELECT COUNT(*) INTO v_duplicate_subject_count
  FROM (
    SELECT school_id, teacher_id, class_id, subject_id, academic_year_id
    FROM public.teacher_class_assignments
    WHERE subject_id IS NOT NULL
      AND teacher_id IS NOT NULL
      AND is_active = true
    GROUP BY school_id, teacher_id, class_id, subject_id, academic_year_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF v_duplicate_subject_count > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % groupe(s) d’affectations actives en double pour une matière spécifique détecté(s).', v_duplicate_subject_count;
  END IF;

  -- Contrôle fail-fast pour les affectations générales actives
  SELECT COUNT(*) INTO v_duplicate_general_count
  FROM (
    SELECT school_id, teacher_id, class_id, academic_year_id
    FROM public.teacher_class_assignments
    WHERE subject_id IS NULL
      AND teacher_id IS NOT NULL
      AND is_active = true
    GROUP BY school_id, teacher_id, class_id, academic_year_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF v_duplicate_general_count > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % groupe(s) d’affectations générales actives en double détecté(s).', v_duplicate_general_count;
  END IF;
END;
$$;

--------------------------------------------------------------------------------
-- 3. SUPPRESSION DE L'ANCIENNE CONTRAINTE D'UNICITE (LEGACY SUBJECT_NAME)
--------------------------------------------------------------------------------
ALTER TABLE public.teacher_class_assignments
  DROP CONSTRAINT IF EXISTS uq_teacher_class_subject;

DROP INDEX IF EXISTS public.uq_teacher_class_subject;
DROP INDEX IF EXISTS public.idx_teacher_assign_unique_subject;
DROP INDEX IF EXISTS public.idx_teacher_assign_unique_general;
DROP INDEX IF EXISTS public.uq_teacher_class_subject_id;
DROP INDEX IF EXISTS public.uq_teacher_class_general;
DROP INDEX IF EXISTS public.uq_teacher_profile_class_subject_id;
DROP INDEX IF EXISTS public.uq_teacher_profile_class_general;

--------------------------------------------------------------------------------
-- 4. CREATION DES INDEX D'UNICITE SUR LES AFFECTATIONS ACTIVES (is_active = true)
--------------------------------------------------------------------------------

-- A. Unicité pour une matière réelle active (subject_id IS NOT NULL)
-- Permet de ré-affecter la même matière plus tard si l'ancienne affectation est passée is_active = false
CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_class_subject_id
  ON public.teacher_class_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id)
  WHERE subject_id IS NOT NULL
    AND teacher_id IS NOT NULL
    AND is_active = true;

-- B. Unicité pour une affectation générale active (subject_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_class_general
  ON public.teacher_class_assignments (school_id, teacher_id, class_id, academic_year_id)
  WHERE subject_id IS NULL
    AND teacher_id IS NOT NULL
    AND is_active = true;

-- C. Unicité de fallback sur teacher_profile_id si teacher_id est temporairement nul (avec teacher_profile_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_profile_class_subject_id
  ON public.teacher_class_assignments (school_id, teacher_profile_id, class_id, subject_id, academic_year_id)
  WHERE subject_id IS NOT NULL
    AND teacher_id IS NULL
    AND teacher_profile_id IS NOT NULL
    AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_profile_class_general
  ON public.teacher_class_assignments (school_id, teacher_profile_id, class_id, academic_year_id)
  WHERE subject_id IS NULL
    AND teacher_id IS NULL
    AND teacher_profile_id IS NOT NULL
    AND is_active = true;

COMMIT;
