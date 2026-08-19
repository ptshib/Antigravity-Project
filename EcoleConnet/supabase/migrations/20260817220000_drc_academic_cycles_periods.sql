-- Migration Phase 2D.3 : Cycles Scolaires RDC et Structure des Périodes (Version Finale Durcie & Validée)
-- Fichier : supabase/migrations/20260817220000_drc_academic_cycles_periods.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. CRÉATION PRÉALABLE DES COLONNES SUR SCHOOL_TERMS ET CLASSES
--------------------------------------------------------------------------------

-- Création impérative des colonnes en premier pour garantir la validité des contrôles fail-fast
ALTER TABLE public.school_terms
  ADD COLUMN IF NOT EXISTS education_cycle TEXT NULL,
  ADD COLUMN IF NOT EXISTS division_type TEXT NULL;

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS education_cycle TEXT NULL;

--------------------------------------------------------------------------------
-- 2. CONTRÔLE FAIL-FAST DES DONNÉES ET VALEURS DE CYCLE
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_invalid_cycles INT;
  v_dup_legacy INT;
  v_dup_cycles INT;
BEGIN
  -- A. Vérification de validité des valeurs de cycle existantes
  SELECT COUNT(*) INTO v_invalid_cycles
  FROM public.school_terms
  WHERE education_cycle IS NOT NULL AND education_cycle NOT IN ('primary', 'secondary');

  IF v_invalid_cycles > 0 THEN
    RAISE EXCEPTION 'Contrôle fail-fast échoué : % ligne(s) dans school_terms possèdent une valeur invalide pour education_cycle (autorisés: NULL, primary, secondary).', v_invalid_cycles;
  END IF;

  -- B. Contrôle d'unicité sur les termes legacy (education_cycle IS NULL)
  SELECT COUNT(*) INTO v_dup_legacy
  FROM (
    SELECT school_id, academic_year_id, position, COUNT(*)
    FROM public.school_terms
    WHERE education_cycle IS NULL
    GROUP BY school_id, academic_year_id, position
    HAVING COUNT(*) > 1
  ) dups_leg;

  IF v_dup_legacy > 0 THEN
    RAISE EXCEPTION 'Contrôle fail-fast échoué : Des doublons existent sur les termes legacy (school_id, academic_year_id, position). % collision(s) détectée(s).', v_dup_legacy;
  END IF;

  -- C. Contrôle d'unicité sur les termes avec cycle (education_cycle IS NOT NULL)
  SELECT COUNT(*) INTO v_dup_cycles
  FROM (
    SELECT school_id, academic_year_id, education_cycle, position, COUNT(*)
    FROM public.school_terms
    WHERE education_cycle IS NOT NULL
    GROUP BY school_id, academic_year_id, education_cycle, position
    HAVING COUNT(*) > 1
  ) dups_cyc;

  IF v_dup_cycles > 0 THEN
    RAISE EXCEPTION 'Contrôle fail-fast échoué : Des doublons existent sur les termes avec cycle (school_id, academic_year_id, education_cycle, position). % collision(s) détectée(s).', v_dup_cycles;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 3. SUPPRESSION CIBLÉE DES ANCIENNES CONTRAINTES/INDEX UNIQUES INCOMPATIBLES
--------------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
  v_cdef TEXT;
  idx RECORD;
  v_idef TEXT;
BEGIN
  -- A. Suppression ciblée des contraintes UNIQUE portant sur les combinaisons incompatibles
  FOR r IN (
    SELECT conname, oid
    FROM pg_constraint
    WHERE conrelid = 'public.school_terms'::regclass
      AND contype = 'u'
  ) LOOP
    v_cdef := pg_get_constraintdef(r.oid);
    -- On cible exclusivement les combinaisons (academic_year_id, position) ou (school_id, academic_year_id, position) sans education_cycle
    IF (v_cdef ~* 'UNIQUE\s*\(\s*academic_year_id\s*,\s*position\s*\)' OR
        v_cdef ~* 'UNIQUE\s*\(\s*school_id\s*,\s*academic_year_id\s*,\s*position\s*\)') AND
       v_cdef !~* 'education_cycle' THEN
      EXECUTE 'ALTER TABLE public.school_terms DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
    END IF;
  END LOOP;

  -- B. Suppression ciblée des INDEX UNIQUE portant sur les combinaisons incompatibles
  FOR idx IN (
    SELECT c.relname AS indexname, c.oid AS index_oid
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'school_terms'
      AND i.indisunique = true
      AND i.indisprimary = false
  ) LOOP
    v_idef := pg_get_indexdef(idx.index_oid);
    IF (v_idef ~* '\(\s*academic_year_id\s*,\s*position\s*\)' OR
        v_idef ~* '\(\s*school_id\s*,\s*academic_year_id\s*,\s*position\s*\)') AND
       v_idef !~* 'education_cycle' THEN
      EXECUTE 'DROP INDEX IF EXISTS public.' || quote_ident(idx.indexname);
    END IF;
  END LOOP;

  -- Suppression des index spécifiques connus s'ils existent
  DROP INDEX IF EXISTS public.idx_school_terms_academic_year_position;
  DROP INDEX IF EXISTS public.school_terms_school_id_academic_year_id_position_key;
  DROP INDEX IF EXISTS public.school_terms_academic_year_id_position_key;
  DROP INDEX IF EXISTS public.idx_school_terms_legacy_position;
  DROP INDEX IF EXISTS public.idx_school_terms_cycle_position;
END $$;

--------------------------------------------------------------------------------
-- 4. CONTRAINTES CHECK ET NOUVEAUX INDEX D'UNICITÉ SUR SCHOOL_TERMS ET CLASSES
--------------------------------------------------------------------------------

-- Contraintes CHECK sur school_terms
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_school_terms_education_cycle'
      AND conrelid = 'public.school_terms'::regclass
  ) THEN
    ALTER TABLE public.school_terms
      ADD CONSTRAINT chk_school_terms_education_cycle
      CHECK (education_cycle IS NULL OR education_cycle IN ('primary', 'secondary'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_school_terms_division_type'
      AND conrelid = 'public.school_terms'::regclass
  ) THEN
    ALTER TABLE public.school_terms
      ADD CONSTRAINT chk_school_terms_division_type
      CHECK (division_type IS NULL OR division_type IN ('trimester', 'semester'));
  END IF;
END $$;

-- Nouveaux index uniques partiels permettant la coexistence de primary et secondary
CREATE UNIQUE INDEX idx_school_terms_legacy_position 
  ON public.school_terms (school_id, academic_year_id, position)
  WHERE education_cycle IS NULL;

CREATE UNIQUE INDEX idx_school_terms_cycle_position
  ON public.school_terms (school_id, academic_year_id, education_cycle, position)
  WHERE education_cycle IS NOT NULL;

-- Contraintes CHECK et index sur classes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_classes_education_cycle'
      AND conrelid = 'public.classes'::regclass
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT chk_classes_education_cycle
      CHECK (education_cycle IS NULL OR education_cycle IN ('primary', 'secondary'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_classes_education_cycle
  ON public.classes (school_id, academic_year_id, education_cycle);

--------------------------------------------------------------------------------
-- 5. CRÉATION DE LA TABLE PUBLIC.SCHOOL_PERIODS
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  parent_term_id UUID NOT NULL REFERENCES public.school_terms(id) ON DELETE CASCADE,
  education_cycle TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  position_within_parent INTEGER NOT NULL,
  starts_on DATE,
  ends_on DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_school_periods_education_cycle CHECK (education_cycle IN ('primary', 'secondary')),
  CONSTRAINT chk_school_periods_position CHECK (position > 0),
  CONSTRAINT chk_school_periods_position_within_parent CHECK (position_within_parent > 0),
  CONSTRAINT chk_school_periods_date_range CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_periods_unique_cycle_position
  ON public.school_periods (school_id, academic_year_id, education_cycle, position);

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_periods_unique_parent_position
  ON public.school_periods (parent_term_id, position_within_parent);

CREATE INDEX IF NOT EXISTS idx_school_periods_school_year
  ON public.school_periods (school_id, academic_year_id);

CREATE INDEX IF NOT EXISTS idx_school_periods_parent_term
  ON public.school_periods (parent_term_id);

--------------------------------------------------------------------------------
-- 6. TRIGGER D'INTÉGRITÉ STRICT SUR SCHOOL_PERIODS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_school_period_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_term RECORD;
  v_year RECORD;
BEGIN
  -- A. Contrôle strict de l'immuabilité
  IF TG_OP = 'UPDATE' THEN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      RAISE EXCEPTION 'Modification interdite : school_id est immuable.';
    END IF;
    IF NEW.academic_year_id IS DISTINCT FROM OLD.academic_year_id THEN
      RAISE EXCEPTION 'Modification interdite : academic_year_id est immuable.';
    END IF;
    IF NEW.parent_term_id IS DISTINCT FROM OLD.parent_term_id THEN
      RAISE EXCEPTION 'Modification interdite : parent_term_id est immuable.';
    END IF;
    IF NEW.education_cycle IS DISTINCT FROM OLD.education_cycle THEN
      RAISE EXCEPTION 'Modification interdite : education_cycle est immuable.';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Modification interdite : created_at est immuable.';
    END IF;
    NEW.updated_at := now();
  END IF;

  -- B. Contrôle du terme parent
  SELECT id, school_id, academic_year_id, education_cycle, division_type, starts_on, ends_on
  INTO v_term
  FROM public.school_terms
  WHERE id = NEW.parent_term_id;

  IF v_term.id IS NULL THEN
    RAISE EXCEPTION 'Incohérence : Le terme parent spécifié est introuvable.';
  END IF;

  IF v_term.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : Le terme parent appartient à un autre établissement.';
  END IF;

  IF v_term.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence académique : Le terme parent appartient à une autre année scolaire.';
  END IF;

  IF v_term.education_cycle IS DISTINCT FROM NEW.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle : Le terme parent (cycle %) ne correspond pas à la période (cycle %).', COALESCE(v_term.education_cycle, 'NULL'), NEW.education_cycle;
  END IF;

  -- C. Contrôles structurels selon le cycle RDC
  IF NEW.education_cycle = 'primary' THEN
    IF v_term.division_type IS DISTINCT FROM 'trimester' THEN
      RAISE EXCEPTION 'Incohérence de structure : Le cycle primaire exige des trimestres (trimester).';
    END IF;
    IF NEW.position < 1 OR NEW.position > 9 THEN
      RAISE EXCEPTION 'Position invalide : Les périodes primaires doivent être comprises entre 1 et 9 (obtenu : %).', NEW.position;
    END IF;
    IF NEW.position_within_parent < 1 OR NEW.position_within_parent > 3 THEN
      RAISE EXCEPTION 'Position interne invalide : Un trimestre primaire contient exactement 3 périodes (position 1 à 3, obtenu : %).', NEW.position_within_parent;
    END IF;
  ELSIF NEW.education_cycle = 'secondary' THEN
    IF v_term.division_type IS DISTINCT FROM 'semester' THEN
      RAISE EXCEPTION 'Incohérence de structure : Le cycle secondaire exige des semestres (semester).';
    END IF;
    IF NEW.position < 1 OR NEW.position > 4 THEN
      RAISE EXCEPTION 'Position invalide : Les périodes secondaires doivent être comprises entre 1 et 4 (obtenu : %).', NEW.position;
    END IF;
    IF NEW.position_within_parent < 1 OR NEW.position_within_parent > 2 THEN
      RAISE EXCEPTION 'Position interne invalide : Un semestre secondaire contient exactement 2 périodes (position 1 à 2, obtenu : %).', NEW.position_within_parent;
    END IF;
  ELSE
    RAISE EXCEPTION 'Cycle scolaire invalide : %', NEW.education_cycle;
  END IF;

  -- D. Contrôle de l'année scolaire
  SELECT id, school_id, starts_on, ends_on
  INTO v_year
  FROM public.academic_years
  WHERE id = NEW.academic_year_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Incohérence : L’année scolaire spécifiée est introuvable.';
  END IF;

  IF v_year.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire appartient à un autre établissement.';
  END IF;

  -- E. Bornes temporelles
  IF v_term.starts_on IS NOT NULL AND NEW.starts_on IS NOT NULL AND NEW.starts_on < v_term.starts_on THEN
    RAISE EXCEPTION 'Date invalide : Le début de la période (%) est antérieur au début du terme parent (%).', NEW.starts_on, v_term.starts_on;
  END IF;

  IF v_term.ends_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.ends_on > v_term.ends_on THEN
    RAISE EXCEPTION 'Date invalide : La fin de la période (%) est postérieure à la fin du terme parent (%).', NEW.ends_on, v_term.ends_on;
  END IF;

  IF v_year.starts_on IS NOT NULL AND NEW.starts_on IS NOT NULL AND NEW.starts_on < v_year.starts_on THEN
    RAISE EXCEPTION 'Date invalide : Le début de la période (%) est antérieur au début de l’année scolaire (%).', NEW.starts_on, v_year.starts_on;
  END IF;

  IF v_year.ends_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.ends_on > v_year.ends_on THEN
    RAISE EXCEPTION 'Date invalide : La fin de la période (%) est postérieure à la fin de l’année scolaire (%).', NEW.ends_on, v_year.ends_on;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_school_period_integrity ON public.school_periods;
CREATE TRIGGER trg_check_school_period_integrity
  BEFORE INSERT OR UPDATE ON public.school_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.check_school_period_integrity();

--------------------------------------------------------------------------------
-- 7. RPC DE DÉFINITION DU CYCLE D'UNE CLASSE (AVEC CONTRÔLE TOUTES TRANSITIONS)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_class_education_cycle(
  p_class_id UUID,
  p_education_cycle TEXT
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
  v_class RECORD;
  v_year_school UUID;
  v_old_cycle TEXT;
  v_conflict_count INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise : auth.uid() est NULL.';
  END IF;

  SELECT p.role, p.school_id, p.is_active, s.status
  INTO v_role, v_school_id, v_is_active, v_school_status
  FROM public.profiles p
  LEFT JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent modifier le cycle d’une classe.';
  END IF;

  IF p_education_cycle IS NOT NULL AND p_education_cycle NOT IN ('primary', 'secondary') THEN
    RAISE EXCEPTION 'Paramètre invalide : Le cycle scolaire doit être ''primary'', ''secondary'' ou NULL.';
  END IF;

  SELECT c.id, c.school_id, c.name, c.education_cycle, c.academic_year_id
  INTO v_class
  FROM public.classes c
  WHERE c.id = p_class_id
  FOR UPDATE;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  IF v_role = 'school_admin' THEN
    IF v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre établissement est suspendu ou inactif.';
    END IF;
    IF v_class.school_id <> v_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Cette classe appartient à un autre établissement.';
    END IF;
  ELSE
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_class.school_id;
    IF v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement ciblé est suspendu ou inactif.';
    END IF;
    v_school_id := v_class.school_id;
  END IF;

  -- Vérification de l'existence et de l'appartenance de l'année scolaire
  SELECT school_id INTO v_year_school FROM public.academic_years WHERE id = v_class.academic_year_id;
  IF v_year_school IS NULL OR v_year_school IS DISTINCT FROM v_class.school_id THEN
    RAISE EXCEPTION 'Incohérence : L’année scolaire de la classe est introuvable ou appartient à un autre établissement.';
  END IF;

  v_old_cycle := v_class.education_cycle;

  -- Contrôles d'incompatibilité avec des données dépendantes (Y compris transition NULL -> primary / NULL -> secondary)
  IF p_education_cycle IS DISTINCT FROM v_old_cycle AND p_education_cycle IS NOT NULL THEN
    -- 1. Évaluations existantes
    IF to_regclass('public.school_assessments') IS NOT NULL THEN
      EXECUTE 'SELECT COUNT(*) FROM public.school_assessments sa JOIN public.school_terms st ON st.id = sa.term_id WHERE sa.class_id = $1 AND st.education_cycle IS DISTINCT FROM $2'
      INTO v_conflict_count
      USING p_class_id, p_education_cycle;

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Modification de cycle impossible : % évaluation(s) sont déjà enregistrées avec des termes incompatibles (ou legacy non adoptés) pour cette classe.', v_conflict_count;
      END IF;
    END IF;

    -- 2. Devoirs existants
    IF to_regclass('public.school_homework') IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'school_homework' AND column_name = 'term_id'
      ) THEN
        EXECUTE 'SELECT COUNT(*) FROM public.school_homework hw JOIN public.school_terms st ON st.id = hw.term_id WHERE hw.class_id = $1 AND st.education_cycle IS DISTINCT FROM $2'
        INTO v_conflict_count
        USING p_class_id, p_education_cycle;

        IF v_conflict_count > 0 THEN
          RAISE EXCEPTION 'Modification de cycle impossible : % devoir(s) sont déjà enregistrés avec des termes incompatibles (ou legacy non adoptés) pour cette classe.', v_conflict_count;
        END IF;
      END IF;
    END IF;

    -- 3. Sessions de présence
    IF to_regclass('public.attendance_sessions') IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'attendance_sessions' AND column_name = 'term_id'
      ) THEN
        EXECUTE 'SELECT COUNT(*) FROM public.attendance_sessions att JOIN public.school_terms st ON st.id = att.term_id WHERE att.class_id = $1 AND st.education_cycle IS DISTINCT FROM $2'
        INTO v_conflict_count
        USING p_class_id, p_education_cycle;

        IF v_conflict_count > 0 THEN
          RAISE EXCEPTION 'Modification de cycle impossible : % session(s) d’appel sont déjà enregistrées avec des termes incompatibles (ou legacy non adoptés) pour cette classe.', v_conflict_count;
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.classes
  SET education_cycle = p_education_cycle,
      updated_at = now()
  WHERE id = p_class_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_school_id,
    v_uid,
    'class_education_cycle_updated',
    jsonb_build_object(
      'class_id', p_class_id,
      'class_name', v_class.name,
      'academic_year_id', v_class.academic_year_id,
      'old_cycle', v_old_cycle,
      'new_cycle', p_education_cycle
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'class_id', p_class_id,
    'old_cycle', v_old_cycle,
    'new_cycle', p_education_cycle
  );
END;
$$;

--------------------------------------------------------------------------------
-- 8. RPC DE CONFIGURATION DU CALENDRIER RDC
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.configure_drc_academic_calendar(
  p_academic_year_id UUID,
  p_education_cycle TEXT,
  p_adopt_legacy_terms BOOLEAN DEFAULT false
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
  v_year RECORD;
  v_term1_id UUID;
  v_term2_id UUID;
  v_term3_id UUID;
  v_chk_term RECORD;
  v_total_legacy INT;
  v_legacy_positions INT[];
  v_created_terms_count INT := 0;
  v_adopted_terms_count INT := 0;
  v_created_periods_count INT := 0;
  v_updated_periods_count INT := 0;
  v_existing_periods_count INT := 0;
  v_adopted_term_ids UUID[] := ARRAY[]::UUID[];
  v_details JSONB;
  v_existing_period_id UUID;
  v_existing_parent UUID;
  v_existing_name TEXT;
  v_existing_pos_parent INT;
BEGIN
  -- 1. Contrôles d'authentification et de rôle
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise : auth.uid() est NULL.';
  END IF;

  SELECT p.role, p.school_id, p.is_active, s.status
  INTO v_role, v_school_id, v_is_active, v_school_status
  FROM public.profiles p
  LEFT JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent configurer le calendrier académique.';
  END IF;

  IF p_education_cycle NOT IN ('primary', 'secondary') THEN
    RAISE EXCEPTION 'Paramètre invalide : Le cycle scolaire doit être ''primary'' ou ''secondary''.';
  END IF;

  -- 2. Verrouillage et validation de l'année scolaire
  SELECT id, school_id, name, starts_on, ends_on
  INTO v_year
  FROM public.academic_years
  WHERE id = p_academic_year_id
  FOR UPDATE;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Année scolaire introuvable.';
  END IF;

  IF v_role = 'school_admin' THEN
    IF v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre établissement est inactif ou suspendu.';
    END IF;
    IF v_year.school_id <> v_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Année scolaire d’un autre établissement.';
    END IF;
  ELSE
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_year.school_id;
    IF v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement ciblé est suspendu ou inactif.';
    END IF;
    v_school_id := v_year.school_id;
  END IF;

  -- 3. Configuration selon le cycle
  IF p_education_cycle = 'primary' THEN
    -- A. Gestion stricte de l'adoption des trimestres legacy
    IF p_adopt_legacy_terms IS TRUE THEN
      -- Vérifier qu'aucun terme primary n'est déjà présent
      IF EXISTS (
        SELECT 1 FROM public.school_terms
        WHERE school_id = v_school_id AND academic_year_id = p_academic_year_id AND education_cycle = 'primary'
      ) THEN
        RAISE EXCEPTION 'Adoption impossible : Des trimestres primaires sont déjà configurés pour cette année scolaire.';
      END IF;

      -- Vérifier le nombre total de termes legacy
      SELECT COUNT(*) INTO v_total_legacy
      FROM public.school_terms
      WHERE school_id = v_school_id AND academic_year_id = p_academic_year_id AND education_cycle IS NULL;

      IF v_total_legacy <> 3 THEN
        RAISE EXCEPTION 'Adoption impossible : L’établissement possède % trimestre(s) historique(s) au lieu d’exactement 3 pour cette année scolaire.', v_total_legacy;
      END IF;

      -- Vérifier que les positions sont exactement 1, 2 et 3
      SELECT array_agg(position ORDER BY position) INTO v_legacy_positions
      FROM public.school_terms
      WHERE school_id = v_school_id AND academic_year_id = p_academic_year_id AND education_cycle IS NULL;

      IF v_legacy_positions IS DISTINCT FROM ARRAY[1, 2, 3] THEN
        RAISE EXCEPTION 'Adoption impossible : Les trimestres historiques doivent occuper exactement les positions 1, 2 et 3 sans doublon.';
      END IF;

      -- Vérifier la compatibilité de division_type
      IF EXISTS (
        SELECT 1 FROM public.school_terms
        WHERE school_id = v_school_id AND academic_year_id = p_academic_year_id AND education_cycle IS NULL AND division_type IS NOT NULL AND division_type <> 'trimester'
      ) THEN
        RAISE EXCEPTION 'Adoption impossible : Un trimestre historique possède un type de division incompatible.';
      END IF;

      -- Récupérer les 3 IDs dans un ordre déterministe
      SELECT array_agg(id ORDER BY position) INTO v_adopted_term_ids
      FROM public.school_terms
      WHERE school_id = v_school_id 
        AND academic_year_id = p_academic_year_id 
        AND education_cycle IS NULL;

      -- Adoption atomique
      UPDATE public.school_terms
      SET education_cycle = 'primary',
          division_type = 'trimester',
          updated_at = now()
      WHERE school_id = v_school_id 
        AND academic_year_id = p_academic_year_id 
        AND education_cycle IS NULL;

      v_adopted_terms_count := 3;
    END IF;

    -- B. Création/Validation des 3 trimestres primaires
    -- Trimestre 1
    SELECT id, education_cycle, division_type, school_id, academic_year_id INTO v_chk_term
    FROM public.school_terms
    WHERE school_id = v_school_id AND academic_year_id = p_academic_year_id AND education_cycle = 'primary' AND position = 1;

    IF v_chk_term.id IS NULL THEN
      INSERT INTO public.school_terms (school_id, academic_year_id, name, position, education_cycle, division_type)
      VALUES (v_school_id, p_academic_year_id, '1er Trimestre', 1, 'primary', 'trimester')
      RETURNING id INTO v_term1_id;
      v_created_terms_count := v_created_terms_count + 1;
    ELSE
      IF v_chk_term.division_type IS DISTINCT FROM 'trimester' THEN
        RAISE EXCEPTION 'Incohérence détectée sur le 1er Trimestre primaire : division_type invalide (%).', v_chk_term.division_type;
      END IF;
      v_term1_id := v_chk_term.id;
    END IF;

    -- Trimestre 2
    SELECT id, education_cycle, division_type, school_id, academic_year_id INTO v_chk_term
    FROM public.school_terms
    WHERE school_id = v_school_id AND academic_year_id = p_academic_year_id AND education_cycle = 'primary' AND position = 2;

    IF v_chk_term.id IS NULL THEN
      INSERT INTO public.school_terms (school_id, academic_year_id, name, position, education_cycle, division_type)
      VALUES (v_school_id, p_academic_year_id, '2e Trimestre', 2, 'primary', 'trimester')
      RETURNING id INTO v_term2_id;
      v_created_terms_count := v_created_terms_count + 1;
    ELSE
      IF v_chk_term.division_type IS DISTINCT FROM 'trimester' THEN
        RAISE EXCEPTION 'Incohérence détectée sur le 2e Trimestre primaire : division_type invalide (%).', v_chk_term.division_type;
      END IF;
      v_term2_id := v_chk_term.id;
    END IF;

    -- Trimestre 3
    SELECT id, education_cycle, division_type, school_id, academic_year_id INTO v_chk_term
    FROM public.school_terms
    WHERE school_id = v_school_id AND academic_year_id = p_academic_year_id AND education_cycle = 'primary' AND position = 3;

    IF v_chk_term.id IS NULL THEN
      INSERT INTO public.school_terms (school_id, academic_year_id, name, position, education_cycle, division_type)
      VALUES (v_school_id, p_academic_year_id, '3e Trimestre', 3, 'primary', 'trimester')
      RETURNING id INTO v_term3_id;
      v_created_terms_count := v_created_terms_count + 1;
    ELSE
      IF v_chk_term.division_type IS DISTINCT FROM 'trimester' THEN
        RAISE EXCEPTION 'Incohérence détectée sur le 3e Trimestre primaire : division_type invalide (%).', v_chk_term.division_type;
      END IF;
      v_term3_id := v_chk_term.id;
    END IF;

    -- C. Gestion des 9 périodes primaires (Respect strict de l'immuabilité de parent_term_id)
    FOR i IN 1..9 LOOP
      DECLARE
        v_target_term UUID;
        v_pos_in_parent INT;
        v_period_name TEXT;
      BEGIN
        IF i IN (1, 2, 3) THEN
          v_target_term := v_term1_id;
          v_pos_in_parent := i;
        ELSIF i IN (4, 5, 6) THEN
          v_target_term := v_term2_id;
          v_pos_in_parent := i - 3;
        ELSE
          v_target_term := v_term3_id;
          v_pos_in_parent := i - 6;
        END IF;

        IF i = 1 THEN v_period_name := '1re Période';
        ELSE v_period_name := i || 'e Période';
        END IF;

        SELECT id, parent_term_id, name, position_within_parent
        INTO v_existing_period_id, v_existing_parent, v_existing_name, v_existing_pos_parent
        FROM public.school_periods
        WHERE school_id = v_school_id 
          AND academic_year_id = p_academic_year_id 
          AND education_cycle = 'primary' 
          AND position = i;

        IF v_existing_period_id IS NULL THEN
          INSERT INTO public.school_periods (
            school_id, academic_year_id, parent_term_id, education_cycle, name, position, position_within_parent
          ) VALUES (
            v_school_id, p_academic_year_id, v_target_term, 'primary', v_period_name, i, v_pos_in_parent
          );
          v_created_periods_count := v_created_periods_count + 1;
        ELSE
          -- Si le parent diffère, lever une exception car parent_term_id est immuable
          IF v_existing_parent IS DISTINCT FROM v_target_term THEN
            RAISE EXCEPTION 'Incohérence structurelle : La période primaire % (pos %) est déjà rattachée à un autre terme (%). Réaffectation impossible.', v_existing_name, i, v_existing_parent;
          END IF;

          -- Mise à jour autorisée uniquement sur les champs modifiables
          IF v_existing_name IS DISTINCT FROM v_period_name OR v_existing_pos_parent IS DISTINCT FROM v_pos_in_parent THEN
            UPDATE public.school_periods
            SET name = v_period_name,
                position_within_parent = v_pos_in_parent,
                updated_at = now()
            WHERE id = v_existing_period_id;
            v_updated_periods_count := v_updated_periods_count + 1;
          ELSE
            v_existing_periods_count := v_existing_periods_count + 1;
          END IF;
        END IF;
      END;
    END LOOP;

  ELSIF p_education_cycle = 'secondary' THEN
    -- A. Création/Validation des 2 semestres secondaires
    -- Semestre 1
    SELECT id, education_cycle, division_type, school_id, academic_year_id INTO v_chk_term
    FROM public.school_terms
    WHERE school_id = v_school_id AND academic_year_id = p_academic_year_id AND education_cycle = 'secondary' AND position = 1;

    IF v_chk_term.id IS NULL THEN
      INSERT INTO public.school_terms (school_id, academic_year_id, name, position, education_cycle, division_type)
      VALUES (v_school_id, p_academic_year_id, '1er Semestre', 1, 'secondary', 'semester')
      RETURNING id INTO v_term1_id;
      v_created_terms_count := v_created_terms_count + 1;
    ELSE
      IF v_chk_term.division_type IS DISTINCT FROM 'semester' THEN
        RAISE EXCEPTION 'Incohérence détectée sur le 1er Semestre secondaire : division_type invalide (%).', v_chk_term.division_type;
      END IF;
      v_term1_id := v_chk_term.id;
    END IF;

    -- Semestre 2
    SELECT id, education_cycle, division_type, school_id, academic_year_id INTO v_chk_term
    FROM public.school_terms
    WHERE school_id = v_school_id AND academic_year_id = p_academic_year_id AND education_cycle = 'secondary' AND position = 2;

    IF v_chk_term.id IS NULL THEN
      INSERT INTO public.school_terms (school_id, academic_year_id, name, position, education_cycle, division_type)
      VALUES (v_school_id, p_academic_year_id, '2e Semestre', 2, 'secondary', 'semester')
      RETURNING id INTO v_term2_id;
      v_created_terms_count := v_created_terms_count + 1;
    ELSE
      IF v_chk_term.division_type IS DISTINCT FROM 'semester' THEN
        RAISE EXCEPTION 'Incohérence détectée sur le 2e Semestre secondaire : division_type invalide (%).', v_chk_term.division_type;
      END IF;
      v_term2_id := v_chk_term.id;
    END IF;

    -- B. Gestion des 4 périodes secondaires (Respect strict de l'immuabilité de parent_term_id)
    FOR i IN 1..4 LOOP
      DECLARE
        v_target_term UUID;
        v_pos_in_parent INT;
        v_period_name TEXT;
      BEGIN
        IF i IN (1, 2) THEN
          v_target_term := v_term1_id;
          v_pos_in_parent := i;
        ELSE
          v_target_term := v_term2_id;
          v_pos_in_parent := i - 2;
        END IF;

        IF i = 1 THEN v_period_name := '1re Période';
        ELSE v_period_name := i || 'e Période';
        END IF;

        SELECT id, parent_term_id, name, position_within_parent
        INTO v_existing_period_id, v_existing_parent, v_existing_name, v_existing_pos_parent
        FROM public.school_periods
        WHERE school_id = v_school_id 
          AND academic_year_id = p_academic_year_id 
          AND education_cycle = 'secondary' 
          AND position = i;

        IF v_existing_period_id IS NULL THEN
          INSERT INTO public.school_periods (
            school_id, academic_year_id, parent_term_id, education_cycle, name, position, position_within_parent
          ) VALUES (
            v_school_id, p_academic_year_id, v_target_term, 'secondary', v_period_name, i, v_pos_in_parent
          );
          v_created_periods_count := v_created_periods_count + 1;
        ELSE
          IF v_existing_parent IS DISTINCT FROM v_target_term THEN
            RAISE EXCEPTION 'Incohérence structurelle : La période secondaire % (pos %) est déjà rattachée à un autre terme (%). Réaffectation impossible.', v_existing_name, i, v_existing_parent;
          END IF;

          IF v_existing_name IS DISTINCT FROM v_period_name OR v_existing_pos_parent IS DISTINCT FROM v_pos_in_parent THEN
            UPDATE public.school_periods
            SET name = v_period_name,
                position_within_parent = v_pos_in_parent,
                updated_at = now()
            WHERE id = v_existing_period_id;
            v_updated_periods_count := v_updated_periods_count + 1;
          ELSE
            v_existing_periods_count := v_existing_periods_count + 1;
          END IF;
        END IF;
      END;
    END LOOP;
  END IF;

  -- 4. Enregistrement d'audit
  v_details := jsonb_build_object(
    'academic_year_id', p_academic_year_id,
    'education_cycle', p_education_cycle,
    'adopt_legacy_terms', p_adopt_legacy_terms,
    'adopted_term_ids', v_adopted_term_ids,
    'created_terms_count', v_created_terms_count,
    'adopted_terms_count', v_adopted_terms_count,
    'created_periods_count', v_created_periods_count,
    'updated_periods_count', v_updated_periods_count,
    'existing_periods_count', v_existing_periods_count
  );

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_school_id,
    v_uid,
    'drc_academic_calendar_configured',
    v_details
  );

  RETURN jsonb_build_object(
    'success', true,
    'education_cycle', p_education_cycle,
    'academic_year_id', p_academic_year_id,
    'created_terms_count', v_created_terms_count,
    'adopted_terms_count', v_adopted_terms_count,
    'created_periods_count', v_created_periods_count,
    'updated_periods_count', v_updated_periods_count,
    'existing_periods_count', v_existing_periods_count,
    'adopted_term_ids', v_adopted_term_ids
  );
END;
$$;

--------------------------------------------------------------------------------
-- 9. RPC DE LECTURE DU CALENDRIER PAR CLASSE
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_academic_calendar_for_class(p_class_id UUID)
RETURNS TABLE (
  term_id UUID,
  term_name TEXT,
  term_position INTEGER,
  term_division_type TEXT,
  term_starts_on DATE,
  term_ends_on DATE,
  period_id UUID,
  period_name TEXT,
  period_position INTEGER,
  period_position_within_parent INTEGER,
  period_starts_on DATE,
  period_ends_on DATE
)
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
  v_class RECORD;
  v_is_authorized BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise : auth.uid() est NULL.';
  END IF;

  SELECT p.role, p.school_id, p.is_active, s.status
  INTO v_role, v_school_id, v_is_active, v_school_status
  FROM public.profiles p
  LEFT JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil inactif ou introuvable.';
  END IF;

  SELECT c.id, c.school_id, c.academic_year_id, c.education_cycle
  INTO v_class
  FROM public.classes c
  WHERE c.id = p_class_id;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  -- Contrôle strict d'autorisation selon le rôle
  IF v_role = 'super_admin' THEN
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_class.school_id;
    IF v_school_status IS NULL THEN
      RAISE EXCEPTION 'Établissement introuvable.';
    END IF;
    IF v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement ciblé est suspendu ou inactif.';
    END IF;
    v_is_authorized := true;

  ELSIF v_role = 'school_admin' THEN
    IF v_school_status = 'active' AND v_school_id = v_class.school_id THEN
      v_is_authorized := true;
    END IF;

  ELSIF v_role = 'teacher' THEN
    IF v_school_status = 'active' AND v_school_id = v_class.school_id THEN
      SELECT EXISTS (
        SELECT 1 FROM public.teachers t
        JOIN public.teacher_class_assignments tca ON tca.teacher_id = t.id
        WHERE t.profile_id = v_uid
          AND t.school_id = v_class.school_id
          AND tca.school_id = v_class.school_id
          AND t.account_status = 'active'
          AND t.employment_status = 'active'
          AND tca.class_id = p_class_id
          AND tca.academic_year_id = v_class.academic_year_id
          AND tca.is_active = true
      ) INTO v_is_authorized;
    END IF;

  ELSIF v_role = 'student' THEN
    IF v_school_status = 'active' AND v_school_id = v_class.school_id THEN
      SELECT EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.student_enrollments se ON se.student_id = s.id
        WHERE s.profile_id = v_uid
          AND s.school_id = v_class.school_id
          AND se.school_id = v_class.school_id
          AND se.class_id = p_class_id
          AND se.academic_year_id = v_class.academic_year_id
          AND se.status = 'active'
      ) INTO v_is_authorized;
    END IF;

  ELSIF v_role = 'parent' THEN
    IF v_school_status = 'active' AND v_school_id = v_class.school_id THEN
      SELECT EXISTS (
        SELECT 1 FROM public.parent_student_links psl
        JOIN public.students s ON s.id = psl.student_id
        JOIN public.student_enrollments se ON se.student_id = s.id
        WHERE psl.parent_profile_id = v_uid
          AND psl.school_id = v_class.school_id
          AND psl.status = 'approved'
          AND s.school_id = v_class.school_id
          AND se.school_id = v_class.school_id
          AND se.class_id = p_class_id
          AND se.academic_year_id = v_class.academic_year_id
          AND se.status = 'active'
      ) INTO v_is_authorized;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Accès refusé : Vous n’avez pas l’autorisation de consulter le calendrier académique de cette classe.';
  END IF;

  IF v_class.education_cycle IS NULL THEN
    RAISE EXCEPTION 'Le cycle scolaire de cette classe n’est pas encore configuré.';
  END IF;

  RETURN QUERY
  SELECT 
    st.id AS term_id,
    st.name AS term_name,
    st.position AS term_position,
    st.division_type AS term_division_type,
    st.starts_on AS term_starts_on,
    st.ends_on AS term_ends_on,
    sp.id AS period_id,
    sp.name AS period_name,
    sp.position AS period_position,
    sp.position_within_parent AS period_position_within_parent,
    sp.starts_on AS period_starts_on,
    sp.ends_on AS period_ends_on
  FROM public.school_terms st
  JOIN public.school_periods sp ON sp.parent_term_id = st.id
  WHERE st.school_id = v_class.school_id
    AND st.academic_year_id = v_class.academic_year_id
    AND st.education_cycle = v_class.education_cycle
    AND sp.is_active = true
  ORDER BY st.position ASC, sp.position_within_parent ASC;
END;
$$;

--------------------------------------------------------------------------------
-- 10. RPC DE LECTURE GLOBALE DU CALENDRIER DE L'ÉTABLISSEMENT
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_academic_calendar(
  p_academic_year_id UUID,
  p_education_cycle TEXT DEFAULT NULL
)
RETURNS TABLE (
  term_id UUID,
  term_name TEXT,
  term_position INTEGER,
  term_division_type TEXT,
  term_education_cycle TEXT,
  term_starts_on DATE,
  term_ends_on DATE,
  period_id UUID,
  period_name TEXT,
  period_position INTEGER,
  period_position_within_parent INTEGER,
  period_starts_on DATE,
  period_ends_on DATE,
  period_is_active BOOLEAN
)
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
  v_year RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise : auth.uid() est NULL.';
  END IF;

  SELECT p.role, p.school_id, p.is_active, s.status
  INTO v_role, v_school_id, v_is_active, v_school_status
  FROM public.profiles p
  LEFT JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs d’établissement peuvent consulter le calendrier global.';
  END IF;

  IF p_education_cycle IS NOT NULL AND p_education_cycle NOT IN ('primary', 'secondary') THEN
    RAISE EXCEPTION 'Paramètre invalide : Le cycle d’enseignement doit être ''primary'', ''secondary'' ou NULL.';
  END IF;

  SELECT ay.id, ay.school_id
  INTO v_year
  FROM public.academic_years ay
  WHERE ay.id = p_academic_year_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Année scolaire introuvable.';
  END IF;

  IF v_role = 'school_admin' THEN
    IF v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre établissement est inactif ou suspendu.';
    END IF;
    IF v_year.school_id <> v_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Année scolaire d’un autre établissement.';
    END IF;
  ELSE
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_year.school_id;
    IF v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement ciblé est suspendu ou inactif.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT 
    st.id AS term_id,
    st.name AS term_name,
    st.position AS term_position,
    st.division_type AS term_division_type,
    st.education_cycle AS term_education_cycle,
    st.starts_on AS term_starts_on,
    st.ends_on AS term_ends_on,
    sp.id AS period_id,
    sp.name AS period_name,
    sp.position AS period_position,
    sp.position_within_parent AS period_position_within_parent,
    sp.starts_on AS period_starts_on,
    sp.ends_on AS period_ends_on,
    sp.is_active AS period_is_active
  FROM public.school_terms st
  LEFT JOIN public.school_periods sp ON sp.parent_term_id = st.id
  WHERE st.school_id = v_year.school_id
    AND st.academic_year_id = p_academic_year_id
    AND (p_education_cycle IS NULL OR st.education_cycle = p_education_cycle)
  ORDER BY st.education_cycle ASC NULLS LAST, st.position ASC, sp.position_within_parent ASC NULLS LAST;
END;
$$;

--------------------------------------------------------------------------------
-- 11. HELPERS RLS DURCIS ET POLITIQUES SUR SCHOOL_PERIODS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_teacher_read_school_periods(
  target_school_id UUID,
  target_academic_year_id UUID,
  target_education_cycle TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    JOIN public.teacher_class_assignments tca ON tca.teacher_id = t.id AND tca.school_id = p.school_id
    JOIN public.classes c ON c.id = tca.class_id
    WHERE p.id = auth.uid()
      AND p.role = 'teacher'
      AND p.is_active = true
      AND p.school_id = target_school_id
      AND s.status = 'active'
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND tca.school_id = target_school_id
      AND tca.academic_year_id = target_academic_year_id
      AND tca.is_active = true
      AND c.school_id = target_school_id
      AND c.academic_year_id = target_academic_year_id
      AND tca.academic_year_id = c.academic_year_id
      AND c.education_cycle = target_education_cycle
  );
$$;

CREATE OR REPLACE FUNCTION public.can_student_read_school_periods(
  target_school_id UUID,
  target_academic_year_id UUID,
  target_education_cycle TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.students st ON st.profile_id = p.id AND st.school_id = p.school_id
    JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = p.school_id
    JOIN public.classes c ON c.id = se.class_id
    WHERE p.id = auth.uid()
      AND p.role = 'student'
      AND p.is_active = true
      AND p.school_id = target_school_id
      AND s.status = 'active'
      AND st.school_id = target_school_id
      AND se.school_id = target_school_id
      AND se.academic_year_id = target_academic_year_id
      AND se.status = 'active'
      AND c.school_id = target_school_id
      AND c.academic_year_id = target_academic_year_id
      AND se.academic_year_id = c.academic_year_id
      AND c.education_cycle = target_education_cycle
  );
$$;

CREATE OR REPLACE FUNCTION public.can_parent_read_school_periods(
  target_school_id UUID,
  target_academic_year_id UUID,
  target_education_cycle TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id
    JOIN public.students st ON st.id = psl.student_id AND st.school_id = p.school_id
    JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = p.school_id
    JOIN public.classes c ON c.id = se.class_id
    WHERE p.id = auth.uid()
      AND p.role = 'parent'
      AND p.is_active = true
      AND p.school_id = target_school_id
      AND s.status = 'active'
      AND psl.school_id = target_school_id
      AND psl.status = 'approved'
      AND st.school_id = target_school_id
      AND se.school_id = target_school_id
      AND se.academic_year_id = target_academic_year_id
      AND se.status = 'active'
      AND c.school_id = target_school_id
      AND c.academic_year_id = target_academic_year_id
      AND se.academic_year_id = c.academic_year_id
      AND c.education_cycle = target_education_cycle
  );
$$;

-- Nettoyage de toutes les anciennes politiques sur school_periods
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN (
    SELECT policyname
    FROM pg_policies
    WHERE tablename = 'school_periods'
      AND schemaname = 'public'
  ) LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol.policyname) || ' ON public.school_periods';
  END LOOP;
END $$;

ALTER TABLE public.school_periods ENABLE ROW LEVEL SECURITY;

-- Politiques SELECT exclusives
CREATE POLICY "SuperAdmin read all school periods"
  ON public.school_periods FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "SchoolAdmin read school periods"
  ON public.school_periods FOR SELECT
  USING (public.is_school_admin(school_id));

CREATE POLICY "Teacher read assigned class periods"
  ON public.school_periods FOR SELECT
  USING (public.can_teacher_read_school_periods(school_id, academic_year_id, education_cycle));

CREATE POLICY "Student read own class periods"
  ON public.school_periods FOR SELECT
  USING (public.can_student_read_school_periods(school_id, academic_year_id, education_cycle));

CREATE POLICY "Parent read approved child class periods"
  ON public.school_periods FOR SELECT
  USING (public.can_parent_read_school_periods(school_id, academic_year_id, education_cycle));

--------------------------------------------------------------------------------
-- 12. PRIVILÈGES ET ACCÈS SÉCURISÉS (REVOKE / GRANT)
--------------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.school_periods FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.set_class_education_cycle(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.configure_drc_academic_calendar(UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_academic_calendar_for_class(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_school_academic_calendar(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_teacher_read_school_periods(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_student_read_school_periods(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_read_school_periods(UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_class_education_cycle(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.configure_drc_academic_calendar(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_academic_calendar_for_class(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_school_academic_calendar(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_teacher_read_school_periods(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_student_read_school_periods(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_read_school_periods(UUID, UUID, TEXT) TO authenticated;

COMMIT;

--------------------------------------------------------------------------------
-- 13. MATRICE DE TESTS SQL DOCUMENTÉS (NON EXÉCUTÉS)
--------------------------------------------------------------------------------
/*
================================================================================
TEST 1 : Configuration primaire et secondaire dans la même année scolaire
--------------------------------------------------------------------------------
-- Appel 1 : configure_drc_academic_calendar(v_year_id, 'primary', false)
-- Résultat attendu : success = true, created_terms_count = 3, created_periods_count = 9
-- Appel 2 : configure_drc_academic_calendar(v_year_id, 'secondary', false)
-- Résultat attendu : success = true, created_terms_count = 2, created_periods_count = 4
-- Vérification : Les termes primary (pos 1, 2, 3) et secondary (pos 1, 2) coexistent sans conflit d'unicité.

================================================================================
TEST 2 : Seconde exécution idempotente
--------------------------------------------------------------------------------
-- Appel 3 : configure_drc_academic_calendar(v_year_id, 'primary', false)
-- Résultat attendu : success = true, created_terms_count = 0, created_periods_count = 0, existing_periods_count = 9.

================================================================================
TEST 3 : Enseignant non affecté demandant le calendrier d'une classe
--------------------------------------------------------------------------------
-- Scénario : auth.uid() = Enseignant A (sans affectation active sur la classe B)
-- Appel : get_academic_calendar_for_class(v_class_b_id)
-- Résultat attendu : EXCEPTION 'Accès refusé : Vous n’avez pas l’autorisation de consulter le calendrier académique de cette classe.'

================================================================================
TEST 4 : Enseignant suspendu demandant le calendrier
--------------------------------------------------------------------------------
-- Scénario : auth.uid() = Enseignant affecté mais teachers.account_status = 'suspended'
-- Appel : get_academic_calendar_for_class(v_class_id)
-- Résultat attendu : EXCEPTION 'Accès refusé : Vous n’avez pas l’autorisation de consulter le calendrier académique de cette classe.'

================================================================================
TEST 5 : Élève demandant une autre classe
--------------------------------------------------------------------------------
-- Scénario : auth.uid() = Élève inscrit en 1A demandant la classe 1B
-- Appel : get_academic_calendar_for_class(v_class_1b_id)
-- Résultat attendu : EXCEPTION 'Accès refusé : Vous n’avez pas l’autorisation de consulter le calendrier académique de cette classe.'

================================================================================
TEST 6 : Parent sans aucun lien élève
--------------------------------------------------------------------------------
-- Scénario : auth.uid() = Parent sans enregistrement dans parent_student_links
-- Appel : get_academic_calendar_for_class(v_class_id)
-- Résultat attendu : EXCEPTION 'Accès refusé : Vous n’avez pas l’autorisation de consulter le calendrier académique de cette classe.'

================================================================================
TEST 7 : Parent avec lien en statut 'pending'
--------------------------------------------------------------------------------
-- Scénario : auth.uid() = Parent dont le lien parent_student_links.status = 'pending'
-- Appel : get_academic_calendar_for_class(v_class_id)
-- Résultat attendu : EXCEPTION 'Accès refusé : Vous n’avez pas l’autorisation de consulter le calendrier académique de cette classe.'

================================================================================
TEST 8 : Parent avec lien 'approved'
--------------------------------------------------------------------------------
-- Scénario : auth.uid() = Parent dont le lien est 'approved' et l'enfant inscrit actif dans la classe
-- Appel : get_academic_calendar_for_class(v_class_id)
-- Résultat attendu : TABLE retournant les trimestres/semestres et périodes du cycle de la classe.

================================================================================
TEST 9 : Accès à une autre école
--------------------------------------------------------------------------------
-- Scénario : school_admin de l'école A demandant l'année ou la classe de l'école B
-- Appel : configure_drc_academic_calendar(v_year_ecole_b_id, 'primary', false)
-- Résultat attendu : EXCEPTION 'Accès refusé : Année scolaire d’un autre établissement.'

================================================================================
TEST 10 : Établissement suspendu
--------------------------------------------------------------------------------
-- Scénario : schools.status = 'suspended'
-- Appel : configure_drc_academic_calendar(v_year_id, 'primary', false)
-- Résultat attendu : EXCEPTION 'Accès refusé : Votre établissement est inactif ou suspendu.' (ou 'L’établissement ciblé est suspendu ou inactif.')

================================================================================
TEST 11 : Écriture directe INSERT/UPDATE/DELETE par authenticated
--------------------------------------------------------------------------------
-- Scénario : INSERT INTO public.school_periods (...) VALUES (...)
-- Résultat attendu : ERROR: permission denied for table school_periods (bloqué par REVOKE).

================================================================================
TEST 12 : Configuration du calendrier par rôle parent/student/teacher
--------------------------------------------------------------------------------
-- Scénario : auth.uid() avec rôle 'teacher', 'student' ou 'parent'
-- Appel : configure_drc_academic_calendar(v_year_id, 'primary', false)
-- Résultat attendu : EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent configurer le calendrier académique.'

================================================================================
TEST 13 : Structure legacy partielle (ex: 2 trimestres au lieu de 3)
--------------------------------------------------------------------------------
-- Scénario : 2 trimestres legacy présents, p_adopt_legacy_terms = true
-- Appel : configure_drc_academic_calendar(v_year_id, 'primary', true)
-- Résultat attendu : EXCEPTION 'Adoption impossible : L’établissement possède 2 trimestre(s) historique(s) au lieu d’exactement 3 pour cette année scolaire.'

================================================================================
TEST 14 : Doublon de terme actif pour un cycle
--------------------------------------------------------------------------------
-- Scénario : Tentative d'insertion manuelle de 2 termes avec (school_id, year_id, 'primary', 1)
-- Résultat attendu : ERROR: duplicate key value violates unique constraint "idx_school_terms_cycle_position".

================================================================================
TEST 15 : Position de période invalide
--------------------------------------------------------------------------------
-- Scénario : Insertion directe dans school_periods avec position = 10 pour le cycle primary
-- Résultat attendu : EXCEPTION 'Position invalide : Les périodes primaires doivent être comprises entre 1 et 9 (obtenu : 10).'

================================================================================
TEST 16 : Super_admin multi-écoles
--------------------------------------------------------------------------------
-- Scénario : auth.uid() avec rôle 'super_admin' configurant l'école A puis l'école B
-- Résultat attendu : Les configurations s'exécutent avec succès et sont isolées par school_id.

================================================================================
TEST 17 : Classe education_cycle NULL possédant une évaluation liée à un terme legacy
--------------------------------------------------------------------------------
-- Scénario : Classe avec education_cycle = NULL et une évaluation liée à un trimestre legacy (education_cycle IS NULL).
-- Appel : set_class_education_cycle(v_class_id, 'secondary')
-- Résultat attendu : EXCEPTION 'Modification de cycle impossible : 1 évaluation(s) sont déjà enregistrées avec des termes incompatibles (ou legacy non adoptés) pour cette classe.'

================================================================================
TEST 18 : Parent avec lien 'approved' mais school_id différent de l'école ciblée
--------------------------------------------------------------------------------
-- Scénario : Parent lié à un élève d'une autre école (psl.school_id <> target_school_id).
-- Appel : SELECT * FROM public.school_periods WHERE school_id = target_school_id
-- Résultat attendu : 0 ligne retournée (helper RLS can_parent_read_school_periods retourne false).
================================================================================
*/
