-- ============================================================================
-- Migration Phase 2F.1 : Calendrier Scolaire Daté par Établissement et par Cycle
-- Fichier : supabase/migrations/20260818140000_dated_school_calendar.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION IDEMPOTENTE DES TABLES EXISTANTES (COLONNES ET CONTRAINTES)
--------------------------------------------------------------------------------

-- A. Table schools : ajout idempotent de education_cycles et détection stricte
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS education_cycles TEXT[] NULL;

-- Contrainte de validité des valeurs de cycles (uniquement 'primary' et 'secondary')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_schools_education_cycles_valid'
      AND conrelid = 'public.schools'::regclass
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT chk_schools_education_cycles_valid
      CHECK (education_cycles IS NULL OR education_cycles <@ ARRAY['primary'::text, 'secondary'::text]);
  END IF;
END $$;

-- Initialisation pour les écoles existantes UNIQUEMENT d'après leurs classes réelles
UPDATE public.schools s
SET education_cycles = sub.detected_cycles
FROM (
  SELECT
    school_id,
    ARRAY_AGG(DISTINCT education_cycle ORDER BY education_cycle) AS detected_cycles
  FROM public.classes
  WHERE education_cycle IN ('primary', 'secondary')
  GROUP BY school_id
) sub
WHERE s.id = sub.school_id
  AND (s.education_cycles IS NULL OR cardinality(s.education_cycles) = 0);

-- B. Table school_terms : dates et colonne is_active
ALTER TABLE public.school_terms
  ADD COLUMN IF NOT EXISTS starts_on DATE NULL,
  ADD COLUMN IF NOT EXISTS ends_on DATE NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- C. Table school_periods : dates et colonne is_active
ALTER TABLE public.school_periods
  ADD COLUMN IF NOT EXISTS starts_on DATE NULL,
  ADD COLUMN IF NOT EXISTS ends_on DATE NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Contraintes de cohérence temporelle starts_on <= ends_on
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_school_terms_dates_order'
      AND conrelid = 'public.school_terms'::regclass
  ) THEN
    ALTER TABLE public.school_terms
      ADD CONSTRAINT chk_school_terms_dates_order
      CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_school_periods_dates_order'
      AND conrelid = 'public.school_periods'::regclass
  ) THEN
    ALTER TABLE public.school_periods
      ADD CONSTRAINT chk_school_periods_dates_order
      CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on);
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 2. TABLE PUBLIC.SCHOOL_CALENDARS (STATUT ET CYCLE DU CALENDRIER)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  education_cycle TEXT NOT NULL CONSTRAINT chk_school_calendar_cycle CHECK (education_cycle IN ('primary', 'secondary')),
  status TEXT NOT NULL DEFAULT 'draft' CONSTRAINT chk_school_calendar_status CHECK (status IN ('draft', 'active', 'closed')),
  activated_at TIMESTAMPTZ NULL,
  activated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_calendar_year_cycle UNIQUE (school_id, academic_year_id, education_cycle)
);

CREATE INDEX IF NOT EXISTS idx_school_calendars_lookup
  ON public.school_calendars (school_id, academic_year_id, education_cycle);

ALTER TABLE public.school_calendars ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 3. TRIGGER D'INTÉGRITÉ SUR PUBLIC.SCHOOL_CALENDARS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_school_calendar_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school RECORD;
  v_year RECORD;
  v_actor_profile RECORD;
BEGIN
  -- 1. Validation de l'école et du cycle organisé (pas de fallback)
  SELECT id, status, education_cycles
  INTO v_school
  FROM public.schools
  WHERE id = NEW.school_id;

  IF v_school.id IS NULL THEN
    RAISE EXCEPTION 'Établissement introuvable pour ce calendrier scolaire.';
  END IF;

  IF v_school.education_cycles IS NULL OR cardinality(v_school.education_cycles) = 0 THEN
    RAISE EXCEPTION 'Les cycles d’enseignement de cet établissement ne sont pas encore configurés.';
  END IF;

  IF NOT (NEW.education_cycle = ANY(v_school.education_cycles)) THEN
    RAISE EXCEPTION 'Le cycle scolaire "%" n’est pas organisé par cet établissement.', NEW.education_cycle;
  END IF;

  -- 2. Validation de l'année scolaire et appartenance à la même école
  SELECT id, school_id
  INTO v_year
  FROM public.academic_years
  WHERE id = NEW.academic_year_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Année scolaire introuvable pour ce calendrier.';
  END IF;

  IF v_year.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire appartient à un autre établissement.';
  END IF;

  -- 3. Validation de l'acteur ayant activé (concordance d'école pour school_admin)
  IF NEW.activated_by IS NOT NULL THEN
    SELECT id, role, school_id, is_active
    INTO v_actor_profile
    FROM public.profiles
    WHERE id = NEW.activated_by;

    IF v_actor_profile.id IS NULL OR v_actor_profile.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Profil de l’administrateur ayant activé le calendrier est inactif ou introuvable.';
    END IF;

    IF v_actor_profile.role = 'school_admin' THEN
      IF v_actor_profile.school_id IS DISTINCT FROM NEW.school_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : L’administrateur ayant activé le calendrier appartient à un autre établissement.';
      END IF;
    ELSIF v_actor_profile.role <> 'super_admin' THEN
      RAISE EXCEPTION 'Seul un administrateur peut être enregistré comme ayant activé le calendrier.';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_school_calendar_record() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_school_calendar ON public.school_calendars;
CREATE TRIGGER trg_validate_school_calendar
  BEFORE INSERT OR UPDATE ON public.school_calendars
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_school_calendar_record();

--------------------------------------------------------------------------------
-- 4. VALIDATIONS POSTGRESQL STRICTES (TRIGGERS TERMES ET PÉRIODES)
--------------------------------------------------------------------------------

-- A. Validation temporelle des termes (School Terms)
CREATE OR REPLACE FUNCTION public.validate_school_term_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year RECORD;
  v_school RECORD;
  v_overlap_term RECORD;
BEGIN
  -- 1. Contrôle ordre des dates
  IF NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.starts_on > NEW.ends_on THEN
    RAISE EXCEPTION 'Date invalide : La date de début du terme (%) est postérieure à la date de fin (%).', NEW.starts_on, NEW.ends_on;
  END IF;

  -- 2. Validation de l'école et cycle organisé (pas de fallback)
  SELECT id, status, education_cycles
  INTO v_school
  FROM public.schools
  WHERE id = NEW.school_id;

  IF v_school.id IS NULL THEN
    RAISE EXCEPTION 'Établissement scolaire introuvable.';
  END IF;

  IF NEW.education_cycle IS NOT NULL THEN
    IF v_school.education_cycles IS NULL OR cardinality(v_school.education_cycles) = 0 THEN
      RAISE EXCEPTION 'Les cycles d’enseignement de cet établissement ne sont pas encore configurés.';
    END IF;

    IF NOT (NEW.education_cycle = ANY(v_school.education_cycles)) THEN
      RAISE EXCEPTION 'Cycle d’enseignement "%" non organisé par cet établissement.', NEW.education_cycle;
    END IF;
  END IF;

  -- 3. Récupération de l'année scolaire associée
  SELECT id, school_id, starts_on, ends_on
  INTO v_year
  FROM public.academic_years
  WHERE id = NEW.academic_year_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Incohérence : L’année scolaire associée est introuvable.';
  END IF;

  IF v_year.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire appartient à un autre établissement.';
  END IF;

  -- 4. Bornes par rapport à l'année scolaire
  IF v_year.starts_on IS NOT NULL AND NEW.starts_on IS NOT NULL AND NEW.starts_on < v_year.starts_on THEN
    RAISE EXCEPTION 'Date hors limites : Le début du terme (%) est antérieur au début de l’année scolaire (%).', NEW.starts_on, v_year.starts_on;
  END IF;

  IF v_year.ends_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.ends_on > v_year.ends_on THEN
    RAISE EXCEPTION 'Date hors limites : La fin du terme (%) est postérieure à la fin de l’année scolaire (%).', NEW.ends_on, v_year.ends_on;
  END IF;

  -- 5. Vérification d'absence de chevauchement entre termes du même cycle
  IF NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.education_cycle IS NOT NULL THEN
    SELECT id, name, starts_on, ends_on
    INTO v_overlap_term
    FROM public.school_terms
    WHERE school_id = NEW.school_id
      AND academic_year_id = NEW.academic_year_id
      AND education_cycle = NEW.education_cycle
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND is_active = true
      AND starts_on IS NOT NULL
      AND ends_on IS NOT NULL
      AND (
        (NEW.starts_on BETWEEN starts_on AND ends_on) OR
        (NEW.ends_on BETWEEN starts_on AND ends_on) OR
        (starts_on BETWEEN NEW.starts_on AND NEW.ends_on)
      )
    LIMIT 1;

    IF v_overlap_term.id IS NOT NULL THEN
      RAISE EXCEPTION 'Chevauchement interdit : Les dates du terme (%) chevauchent celles de "%" (% au %).',
        NEW.name, v_overlap_term.name, v_overlap_term.starts_on, v_overlap_term.ends_on;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_school_term_dates() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_school_term_dates ON public.school_terms;
CREATE TRIGGER trg_validate_school_term_dates
  BEFORE INSERT OR UPDATE ON public.school_terms
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_school_term_dates();

-- B. Validation temporelle des périodes (School Periods)
CREATE OR REPLACE FUNCTION public.validate_school_period_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_term RECORD;
  v_year RECORD;
  v_school RECORD;
  v_overlap_period RECORD;
BEGIN
  -- 1. Contrôle ordre des dates
  IF NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.starts_on > NEW.ends_on THEN
    RAISE EXCEPTION 'Date invalide : La date de début de la période (%) est postérieure à la date de fin (%).', NEW.starts_on, NEW.ends_on;
  END IF;

  -- 2. Validation de l'école et cycle organisé (pas de fallback)
  SELECT id, status, education_cycles
  INTO v_school
  FROM public.schools
  WHERE id = NEW.school_id;

  IF v_school.id IS NULL THEN
    RAISE EXCEPTION 'Établissement scolaire introuvable.';
  END IF;

  IF v_school.education_cycles IS NULL OR cardinality(v_school.education_cycles) = 0 THEN
    RAISE EXCEPTION 'Les cycles d’enseignement de cet établissement ne sont pas encore configurés.';
  END IF;

  IF NOT (NEW.education_cycle = ANY(v_school.education_cycles)) THEN
    RAISE EXCEPTION 'Cycle d’enseignement "%" non organisé par cet établissement.', NEW.education_cycle;
  END IF;

  -- 3. Récupération et contrôle strict du terme parent
  SELECT id, school_id, academic_year_id, education_cycle, starts_on, ends_on, is_active
  INTO v_term
  FROM public.school_terms
  WHERE id = NEW.parent_term_id;

  IF v_term.id IS NULL THEN
    RAISE EXCEPTION 'Incohérence : Le terme parent de la période est introuvable.';
  END IF;

  IF v_term.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Incohérence : Le terme parent (%) est désactivé.', NEW.parent_term_id;
  END IF;

  IF v_term.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : Le terme parent appartient à un autre établissement.';
  END IF;

  IF v_term.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
    RAISE EXCEPTION 'Incohérence académique : Le terme parent appartient à une autre année scolaire.';
  END IF;

  IF v_term.education_cycle IS DISTINCT FROM NEW.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle : Le cycle du terme parent (%) ne correspond pas à celui de la période (%).',
      v_term.education_cycle, NEW.education_cycle;
  END IF;

  -- 4. Récupération et contrôle de l'année scolaire
  SELECT id, school_id, starts_on, ends_on
  INTO v_year
  FROM public.academic_years
  WHERE id = NEW.academic_year_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Incohérence : L’année scolaire associée est introuvable.';
  END IF;

  IF v_year.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire de la période appartient à un autre établissement.';
  END IF;

  -- 5. Bornes temporelles par rapport au terme parent
  IF v_term.starts_on IS NOT NULL AND NEW.starts_on IS NOT NULL AND NEW.starts_on < v_term.starts_on THEN
    RAISE EXCEPTION 'Date hors limites : Le début de la période (%) est antérieur au début de son terme parent (%).', NEW.starts_on, v_term.starts_on;
  END IF;

  IF v_term.ends_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.ends_on > v_term.ends_on THEN
    RAISE EXCEPTION 'Date hors limites : La fin de la période (%) est postérieure à la fin de son terme parent (%).', NEW.ends_on, v_term.ends_on;
  END IF;

  -- 6. Bornes temporelles par rapport à l'année scolaire
  IF v_year.starts_on IS NOT NULL AND NEW.starts_on IS NOT NULL AND NEW.starts_on < v_year.starts_on THEN
    RAISE EXCEPTION 'Date hors limites : Le début de la période (%) est antérieur au début de l’année scolaire (%).', NEW.starts_on, v_year.starts_on;
  END IF;

  IF v_year.ends_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.ends_on > v_year.ends_on THEN
    RAISE EXCEPTION 'Date hors limites : La fin de la période (%) est postérieure à la fin de l’année scolaire (%).', NEW.ends_on, v_year.ends_on;
  END IF;

  -- 7. Vérification d'absence de chevauchement entre périodes du même terme
  IF NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL THEN
    SELECT id, name, starts_on, ends_on
    INTO v_overlap_period
    FROM public.school_periods
    WHERE school_id = NEW.school_id
      AND academic_year_id = NEW.academic_year_id
      AND education_cycle = NEW.education_cycle
      AND parent_term_id = NEW.parent_term_id
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND is_active = true
      AND starts_on IS NOT NULL
      AND ends_on IS NOT NULL
      AND (
        (NEW.starts_on BETWEEN starts_on AND ends_on) OR
        (NEW.ends_on BETWEEN starts_on AND ends_on) OR
        (starts_on BETWEEN NEW.starts_on AND NEW.ends_on)
      )
    LIMIT 1;

    IF v_overlap_period.id IS NOT NULL THEN
      RAISE EXCEPTION 'Chevauchement interdit : Les dates de la période (%) chevauchent celles de "%" (% au %).',
        NEW.name, v_overlap_period.name, v_overlap_period.starts_on, v_overlap_period.ends_on;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_school_period_dates() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_school_period_dates ON public.school_periods;
CREATE TRIGGER trg_validate_school_period_dates
  BEFORE INSERT OR UPDATE ON public.school_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_school_period_dates();

--------------------------------------------------------------------------------
-- 5. HELPER SECURITY DEFINER : CONTRÔLE D'ACCÈS PAR RÔLE ET CYCLE UTILISATEUR
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_user_read_school_calendar(
  p_school_id UUID,
  p_education_cycle TEXT
)
RETURNS BOOLEAN
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
  v_school_status TEXT;
  v_teacher_active BOOLEAN;
  v_parent_active BOOLEAN;
  v_student_active BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.role, p.school_id, p.is_active, s.status
  INTO v_role, v_caller_school_id, v_caller_active, v_school_status
  FROM public.profiles p
  LEFT JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_uid;

  -- 1. Le profil doit exister et être actif
  IF v_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- 2. Super admin actif : accès superviseur complet
  IF v_role = 'super_admin' THEN
    RETURN true;
  END IF;

  -- 3. Pour tous les autres rôles : même école requise
  IF v_caller_school_id IS DISTINCT FROM p_school_id THEN
    RETURN false;
  END IF;

  -- 4. School admin actif
  IF v_role = 'school_admin' THEN
    RETURN true;
  END IF;

  -- 5. L'école doit être active pour les enseignants, parents et élèves
  IF v_school_status <> 'active' THEN
    RETURN false;
  END IF;

  -- 6. Enseignant : statut actif strict + affectation active à une classe du cycle dans l'année courante
  IF v_role = 'teacher' THEN
    SELECT (t.employment_status = 'active' AND t.account_status = 'active')
    INTO v_teacher_active
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = p_school_id;

    IF v_teacher_active IS NOT TRUE THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.teacher_class_assignments tca
      JOIN public.classes c ON c.id = tca.class_id AND c.school_id = tca.school_id
      JOIN public.academic_years ay ON ay.id = tca.academic_year_id AND ay.school_id = tca.school_id
      WHERE (tca.teacher_profile_id = v_uid OR tca.teacher_id IN (SELECT id FROM public.teachers WHERE profile_id = v_uid))
        AND tca.school_id = p_school_id
        AND tca.is_active = true
        AND ay.is_current = true
        AND c.education_cycle = p_education_cycle
    );
  END IF;

  -- 7. Élève : compte élève actif + inscription active dans l'année courante du cycle
  IF v_role = 'student' THEN
    SELECT (s.account_status = 'active' AND s.enrollment_status = 'active')
    INTO v_student_active
    FROM public.students s
    WHERE s.profile_id = v_uid AND s.school_id = p_school_id;

    IF v_student_active IS NOT TRUE THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.student_enrollments se
      JOIN public.classes c ON c.id = se.class_id AND c.school_id = se.school_id
      JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
      JOIN public.students st ON st.id = se.student_id AND st.school_id = se.school_id
      WHERE st.profile_id = v_uid
        AND se.school_id = p_school_id
        AND se.status = 'active'
        AND ay.is_current = true
        AND c.education_cycle = p_education_cycle
    );
  END IF;

  -- 8. Parent : compte parent actif + lien approved + élève inscrit actif (sans exiger account_status élève actif)
  IF v_role = 'parent' THEN
    SELECT (pa.account_status = 'active')
    INTO v_parent_active
    FROM public.parent_accounts pa
    WHERE pa.profile_id = v_uid AND pa.school_id = p_school_id;

    IF v_parent_active IS NOT TRUE THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.parent_student_links psl
      JOIN public.students st ON st.id = psl.student_id AND st.school_id = psl.school_id
      JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = st.school_id
      JOIN public.classes c ON c.id = se.class_id AND c.school_id = se.school_id
      JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
      WHERE psl.parent_profile_id = v_uid
        AND psl.school_id = p_school_id
        AND psl.status = 'approved'
        AND st.enrollment_status = 'active'
        AND se.status = 'active'
        AND ay.is_current = true
        AND c.education_cycle = p_education_cycle
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_user_read_school_calendar(UUID, TEXT) FROM PUBLIC;

--------------------------------------------------------------------------------
-- 6. RPC DE CONSULTATION SÉCURISÉE DU CALENDRIER SCOLAIRE (GET_SCHOOL_CALENDAR)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_school_calendar(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.get_school_calendar(
  p_school_id UUID,
  p_academic_year_id UUID,
  p_education_cycle TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school RECORD;
  v_year RECORD;
  v_calendar RECORD;
  v_terms JSONB;
  v_errors TEXT[] := ARRAY[]::TEXT[];
  v_expected_terms_count INT;
  v_expected_periods_count INT;
  v_actual_terms_count INT := 0;
  v_actual_periods_count INT := 0;
  v_missing_dates_terms INT := 0;
  v_missing_dates_periods INT := 0;
BEGIN
  -- 1. Validation de l'authentification
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil inactif ou introuvable';
  END IF;

  IF p_education_cycle NOT IN ('primary', 'secondary') THEN
    RAISE EXCEPTION 'Cycle d’enseignement invalide (autorisés: primary, secondary)';
  END IF;

  -- 2. Validation de l'école et du cycle organisé (pas de fallback)
  SELECT id, name, status, education_cycles INTO v_school
  FROM public.schools WHERE id = p_school_id;

  IF v_school.id IS NULL THEN
    RAISE EXCEPTION 'Établissement scolaire introuvable';
  END IF;

  IF v_school.education_cycles IS NULL OR cardinality(v_school.education_cycles) = 0 THEN
    RAISE EXCEPTION 'Les cycles d’enseignement de cet établissement ne sont pas encore configurés.';
  END IF;

  IF NOT (p_education_cycle = ANY(v_school.education_cycles)) THEN
    RAISE EXCEPTION 'Le cycle scolaire "%" n’est pas organisé par cet établissement.', p_education_cycle;
  END IF;

  -- 3. Contrôle des autorisations d'accès par rôle et cycle
  IF v_caller_role = 'super_admin' THEN
    NULL; -- Super admin autorisé
  ELSIF v_caller_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM p_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez administrer que votre propre établissement.';
    END IF;
  ELSE
    -- Enseignants, Parents, Élèves : contrôle strict via helper
    IF NOT public.can_user_read_school_calendar(p_school_id, p_education_cycle) THEN
      RAISE EXCEPTION 'Accès refusé : Vous n’avez pas l’autorisation de consulter le Calendrier Scolaire pour ce cycle.';
    END IF;
  END IF;

  -- 4. Validation de l'année scolaire
  SELECT id, name, starts_on, ends_on, is_current INTO v_year
  FROM public.academic_years
  WHERE id = p_academic_year_id AND school_id = p_school_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Année scolaire introuvable dans cet établissement';
  END IF;

  -- 5. Récupération de l'enregistrement school_calendars
  SELECT * INTO v_calendar
  FROM public.school_calendars
  WHERE school_id = p_school_id
    AND academic_year_id = p_academic_year_id
    AND education_cycle = p_education_cycle;

  -- Contrôle supplémentaire pour rôles non-admin : le calendrier doit être actif
  IF v_caller_role NOT IN ('super_admin', 'school_admin') THEN
    IF v_calendar.id IS NULL OR v_calendar.status <> 'active' THEN
      RAISE EXCEPTION 'Le Calendrier Scolaire pour ce cycle n’est pas encore publié ou actif.';
    END IF;
  END IF;

  -- 6. Construction de la hiérarchie des termes et périodes (uniquement is_active = true)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', st.id,
        'name', st.name,
        'position', st.position,
        'education_cycle', st.education_cycle,
        'division_type', st.division_type,
        'starts_on', st.starts_on,
        'ends_on', st.ends_on,
        'is_active', st.is_active,
        'periods', COALESCE(p_data.periods_json, '[]'::jsonb)
      )
      ORDER BY st.position ASC
    ),
    '[]'::jsonb
  ) INTO v_terms
  FROM public.school_terms st
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', sp.id,
        'name', sp.name,
        'position', sp.position,
        'position_within_parent', sp.position_within_parent,
        'education_cycle', sp.education_cycle,
        'starts_on', sp.starts_on,
        'ends_on', sp.ends_on,
        'is_active', sp.is_active,
        'parent_term_id', sp.parent_term_id
      )
      ORDER BY sp.position ASC
    ) AS periods_json
    FROM public.school_periods sp
    WHERE sp.parent_term_id = st.id
      AND sp.school_id = p_school_id
      AND sp.academic_year_id = p_academic_year_id
      AND sp.education_cycle = p_education_cycle
      AND sp.is_active = true
  ) p_data ON true
  WHERE st.school_id = p_school_id
    AND st.academic_year_id = p_academic_year_id
    AND st.education_cycle = p_education_cycle
    AND st.is_active = true;

  -- 7. Audit des erreurs de configuration
  IF p_education_cycle = 'primary' THEN
    v_expected_terms_count := 3;
    v_expected_periods_count := 9;
  ELSE
    v_expected_terms_count := 2;
    v_expected_periods_count := 4;
  END IF;

  SELECT COUNT(*) INTO v_actual_terms_count
  FROM public.school_terms
  WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = p_education_cycle AND is_active = true;

  SELECT COUNT(*) INTO v_actual_periods_count
  FROM public.school_periods
  WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = p_education_cycle AND is_active = true;

  SELECT COUNT(*) INTO v_missing_dates_terms
  FROM public.school_terms
  WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = p_education_cycle AND is_active = true
    AND (starts_on IS NULL OR ends_on IS NULL);

  SELECT COUNT(*) INTO v_missing_dates_periods
  FROM public.school_periods
  WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = p_education_cycle AND is_active = true
    AND (starts_on IS NULL OR ends_on IS NULL);

  IF v_actual_terms_count <> v_expected_terms_count THEN
    v_errors := array_append(v_errors, format('Nombre de termes actifs incorrect : % attendu(s), % présent(s).', v_expected_terms_count, v_actual_terms_count));
  END IF;

  IF v_actual_periods_count <> v_expected_periods_count THEN
    v_errors := array_append(v_errors, format('Nombre de périodes actives incorrect : % attendue(s), % présente(s).', v_expected_periods_count, v_actual_periods_count));
  END IF;

  IF v_missing_dates_terms > 0 THEN
    v_errors := array_append(v_errors, format('Dates manquantes sur % terme(s).', v_missing_dates_terms));
  END IF;

  IF v_missing_dates_periods > 0 THEN
    v_errors := array_append(v_errors, format('Dates manquantes sur % période(s).', v_missing_dates_periods));
  END IF;

  -- 8. Construction du résultat complet
  RETURN jsonb_build_object(
    'calendar_id', v_calendar.id,
    'school_id', p_school_id,
    'academic_year_id', p_academic_year_id,
    'academic_year_name', v_year.name,
    'academic_year_starts_on', v_year.starts_on,
    'academic_year_ends_on', v_year.ends_on,
    'education_cycle', p_education_cycle,
    'status', COALESCE(v_calendar.status, 'draft'),
    'activated_at', v_calendar.activated_at,
    'activated_by', v_calendar.activated_by,
    'closed_at', v_calendar.closed_at,
    'is_complete', (cardinality(v_errors) = 0),
    'configuration_errors', to_jsonb(v_errors),
    'terms', v_terms
  );
END;
$$;

--------------------------------------------------------------------------------
-- 7. RPC DE SAUVEGARDE DES DATES DE TERMES (SAVE_SCHOOL_TERM_DATES)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.save_school_term_dates(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.save_school_term_dates(
  p_term_id UUID,
  p_starts_on DATE,
  p_ends_on DATE
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
  v_term RECORD;
  v_school RECORD;
  v_calendar_id UUID;
  v_calendar_status TEXT;
  v_old_data JSONB;
  v_new_data JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'school_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent modifier les dates du calendrier.';
  END IF;

  -- 1. Verrouillage du terme
  SELECT * INTO v_term
  FROM public.school_terms
  WHERE id = p_term_id
  FOR UPDATE;

  IF v_term.id IS NULL THEN
    RAISE EXCEPTION 'Terme introuvable';
  END IF;

  -- 2. Validation de l'école (pas de fallback)
  SELECT id, status, education_cycles INTO v_school
  FROM public.schools WHERE id = v_term.school_id;

  IF v_caller_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM v_term.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Terme d’un autre établissement.';
    END IF;
    IF v_school.status <> 'active' THEN
      RAISE EXCEPTION 'L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  -- 3. Validation du cycle organisé
  IF v_term.education_cycle IS NOT NULL THEN
    IF v_school.education_cycles IS NULL OR cardinality(v_school.education_cycles) = 0 THEN
      RAISE EXCEPTION 'Les cycles d’enseignement de cet établissement ne sont pas encore configurés.';
    END IF;

    IF NOT (v_term.education_cycle = ANY(v_school.education_cycles)) THEN
      RAISE EXCEPTION 'Le cycle scolaire "%" n’est pas organisé par cet établissement.', v_term.education_cycle;
    END IF;
  END IF;

  -- 4. Verrouillage et contrôle strict de school_calendars
  IF v_term.education_cycle IS NOT NULL THEN
    -- Création idempotente en 'draft' si la ligne n'existe pas encore
    INSERT INTO public.school_calendars (
      school_id,
      academic_year_id,
      education_cycle,
      status,
      created_at,
      updated_at
    ) VALUES (
      v_term.school_id,
      v_term.academic_year_id,
      v_term.education_cycle,
      'draft',
      now(),
      now()
    )
    ON CONFLICT (school_id, academic_year_id, education_cycle) DO NOTHING;

    -- Verrouillage FOR UPDATE
    SELECT id, status
    INTO v_calendar_id, v_calendar_status
    FROM public.school_calendars
    WHERE school_id = v_term.school_id
      AND academic_year_id = v_term.academic_year_id
      AND education_cycle = v_term.education_cycle
    FOR UPDATE;

    -- Verrouillage : Modification interdite si status <> 'draft'
    IF v_calendar_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Modification refusée : Le Calendrier Scolaire est actuellement "%". Vous devez obligatoirement le rouvrir en brouillon via reopen_school_calendar() pour modifier les dates.', v_calendar_status;
    END IF;
  END IF;

  v_old_data := jsonb_build_object('starts_on', v_term.starts_on, 'ends_on', v_term.ends_on);
  v_new_data := jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on);

  -- 5. Mise à jour du terme
  UPDATE public.school_terms
  SET starts_on = p_starts_on,
      ends_on = p_ends_on,
      updated_at = now()
  WHERE id = p_term_id;

  -- 6. Journal d'audit conforme
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_term.school_id,
    v_uid,
    'school_term_dates_updated',
    jsonb_build_object(
      'entity_type', 'school_term',
      'entity_id', p_term_id,
      'academic_year_id', v_term.academic_year_id,
      'education_cycle', v_term.education_cycle,
      'term_name', v_term.name,
      'old_data', v_old_data,
      'new_data', v_new_data,
      'actor_id', v_uid,
      'date', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'term_id', p_term_id,
    'starts_on', p_starts_on,
    'ends_on', p_ends_on
  );
END;
$$;

--------------------------------------------------------------------------------
-- 8. RPC DE SAUVEGARDE DES DATES DE PÉRIODES (SAVE_SCHOOL_PERIOD_DATES)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.save_school_period_dates(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.save_school_period_dates(
  p_period_id UUID,
  p_starts_on DATE,
  p_ends_on DATE
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
  v_period RECORD;
  v_school RECORD;
  v_calendar_id UUID;
  v_calendar_status TEXT;
  v_old_data JSONB;
  v_new_data JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'school_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent modifier les dates des périodes.';
  END IF;

  -- 1. Verrouillage de la période
  SELECT * INTO v_period
  FROM public.school_periods
  WHERE id = p_period_id
  FOR UPDATE;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Période introuvable';
  END IF;

  -- 2. Validation de l'école (pas de fallback)
  SELECT id, status, education_cycles INTO v_school
  FROM public.schools WHERE id = v_period.school_id;

  IF v_caller_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM v_period.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Période d’un autre établissement.';
    END IF;
    IF v_school.status <> 'active' THEN
      RAISE EXCEPTION 'L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  -- 3. Validation du cycle organisé
  IF v_school.education_cycles IS NULL OR cardinality(v_school.education_cycles) = 0 THEN
    RAISE EXCEPTION 'Les cycles d’enseignement de cet établissement ne sont pas encore configurés.';
  END IF;

  IF NOT (v_period.education_cycle = ANY(v_school.education_cycles)) THEN
    RAISE EXCEPTION 'Le cycle scolaire "%" n’est pas organisé par cet établissement.', v_period.education_cycle;
  END IF;

  -- 4. Verrouillage et contrôle strict de school_calendars
  INSERT INTO public.school_calendars (
    school_id,
    academic_year_id,
    education_cycle,
    status,
    created_at,
    updated_at
  ) VALUES (
    v_period.school_id,
    v_period.academic_year_id,
    v_period.education_cycle,
    'draft',
    now(),
    now()
  )
  ON CONFLICT (school_id, academic_year_id, education_cycle) DO NOTHING;

  SELECT id, status
  INTO v_calendar_id, v_calendar_status
  FROM public.school_calendars
  WHERE school_id = v_period.school_id
    AND academic_year_id = v_period.academic_year_id
    AND education_cycle = v_period.education_cycle
  FOR UPDATE;

  IF v_calendar_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Modification refusée : Le Calendrier Scolaire est actuellement "%". Vous devez obligatoirement le rouvrir en brouillon via reopen_school_calendar() pour modifier les dates.', v_calendar_status;
  END IF;

  v_old_data := jsonb_build_object('starts_on', v_period.starts_on, 'ends_on', v_period.ends_on);
  v_new_data := jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on);

  -- 5. Mise à jour de la période
  UPDATE public.school_periods
  SET starts_on = p_starts_on,
      ends_on = p_ends_on,
      updated_at = now()
  WHERE id = p_period_id;

  -- 6. Journal d'audit conforme
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_period.school_id,
    v_uid,
    'school_period_dates_updated',
    jsonb_build_object(
      'entity_type', 'school_period',
      'entity_id', p_period_id,
      'academic_year_id', v_period.academic_year_id,
      'education_cycle', v_period.education_cycle,
      'period_name', v_period.name,
      'parent_term_id', v_period.parent_term_id,
      'old_data', v_old_data,
      'new_data', v_new_data,
      'actor_id', v_uid,
      'date', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'period_id', p_period_id,
    'starts_on', p_starts_on,
    'ends_on', p_ends_on
  );
END;
$$;

--------------------------------------------------------------------------------
-- 9. RPC D'ACTIVATION DU CALENDRIER SCOLAIRE (ACTIVATE_SCHOOL_CALENDAR)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.activate_school_calendar(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.activate_school_calendar(
  p_school_id UUID,
  p_academic_year_id UUID,
  p_education_cycle TEXT
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
  v_school RECORD;
  v_year RECORD;
  v_calendar_id UUID;
  v_calendar_status TEXT;
  v_term_positions INT[];
  v_period_positions INT[];
  v_term_cur RECORD;
  v_periods_in_term_count INT;
  v_periods_in_term_positions INT[];
  v_missing_terms INT;
  v_missing_periods INT;
  v_invalid_period_bounds RECORD;
  v_overlap_term RECORD;
  v_overlap_period RECORD;
  v_term_out_of_year RECORD;
  v_period_out_of_year RECORD;
BEGIN
  -- 1. Validation de l'administrateur appelant
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'school_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent activer un Calendrier Scolaire.';
  END IF;

  IF p_education_cycle NOT IN ('primary', 'secondary') THEN
    RAISE EXCEPTION 'Cycle scolaire invalide (primary ou secondary).';
  END IF;

  -- 2. Validation de l'école et cycle organisé (pas de fallback)
  SELECT id, status, education_cycles INTO v_school
  FROM public.schools WHERE id = p_school_id;

  IF v_school.id IS NULL THEN
    RAISE EXCEPTION 'Établissement scolaire introuvable';
  END IF;

  IF v_caller_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM p_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
    END IF;
    IF v_school.status <> 'active' THEN
      RAISE EXCEPTION 'L’établissement scolaire est inactif ou suspendu.';
    END IF;
  END IF;

  IF v_school.education_cycles IS NULL OR cardinality(v_school.education_cycles) = 0 THEN
    RAISE EXCEPTION 'Les cycles d’enseignement de cet établissement ne sont pas encore configurés.';
  END IF;

  IF NOT (p_education_cycle = ANY(v_school.education_cycles)) THEN
    RAISE EXCEPTION 'Activation impossible : Le cycle "%" n’est pas organisé par cet établissement.', p_education_cycle;
  END IF;

  -- 3. Validation de l'année scolaire
  SELECT id, starts_on, ends_on INTO v_year
  FROM public.academic_years
  WHERE id = p_academic_year_id AND school_id = p_school_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Année scolaire introuvable dans cet établissement';
  END IF;

  -- 4. Verrouillage anti-concurrence et contrôle machine d'états
  INSERT INTO public.school_calendars (
    school_id,
    academic_year_id,
    education_cycle,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_school_id,
    p_academic_year_id,
    p_education_cycle,
    'draft',
    now(),
    now()
  )
  ON CONFLICT (school_id, academic_year_id, education_cycle) DO NOTHING;

  SELECT id, status
  INTO v_calendar_id, v_calendar_status
  FROM public.school_calendars
  WHERE school_id = p_school_id
    AND academic_year_id = p_academic_year_id
    AND education_cycle = p_education_cycle
  FOR UPDATE;

  IF v_calendar_status = 'active' THEN
    RAISE EXCEPTION 'Activation refusée : Le Calendrier Scolaire est déjà actif pour ce cycle.';
  ELSIF v_calendar_status = 'closed' THEN
    RAISE EXCEPTION 'Activation refusée : Le Calendrier Scolaire est clôturé. Vous devez d’abord le rouvrir en brouillon via reopen_school_calendar().';
  ELSIF v_calendar_status <> 'draft' THEN
    RAISE EXCEPTION 'Transition d’état invalide (% -> active). Seul un calendrier en brouillon peut être activé.', v_calendar_status;
  END IF;

  -- 5. Validation structurelle complète selon le cycle (is_active = true uniquement)
  IF p_education_cycle = 'primary' THEN
    -- A. Contrôle des 3 trimestres
    SELECT array_agg(position ORDER BY position)
    INTO v_term_positions
    FROM public.school_terms
    WHERE school_id = p_school_id
      AND academic_year_id = p_academic_year_id
      AND education_cycle = 'primary'
      AND is_active = true;

    IF v_term_positions IS DISTINCT FROM ARRAY[1, 2, 3] THEN
      RAISE EXCEPTION 'Activation refusée : Le cycle primaire exige exactement 3 trimestres actifs aux positions 1, 2 et 3 sans doublon.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.school_terms
      WHERE school_id = p_school_id
        AND academic_year_id = p_academic_year_id
        AND education_cycle = 'primary'
        AND is_active = true
        AND division_type IS DISTINCT FROM 'trimester'
    ) THEN
      RAISE EXCEPTION 'Activation refusée : Tous les termes primaires doivent avoir division_type = ''trimester''.';
    END IF;

    -- B. Contrôle global des 9 périodes
    SELECT array_agg(position ORDER BY position)
    INTO v_period_positions
    FROM public.school_periods
    WHERE school_id = p_school_id
      AND academic_year_id = p_academic_year_id
      AND education_cycle = 'primary'
      AND is_active = true;

    IF v_period_positions IS DISTINCT FROM ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9] THEN
      RAISE EXCEPTION 'Activation refusée : Le cycle primaire exige exactement 9 périodes actives aux positions 1 à 9 sans doublon.';
    END IF;

    -- C. Contrôle de répartition stricte : exactement 3 périodes par trimestre
    FOR v_term_cur IN (
      SELECT id, name, position FROM public.school_terms
      WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = 'primary' AND is_active = true
      ORDER BY position ASC
    ) LOOP
      SELECT COUNT(*), array_agg(position_within_parent ORDER BY position_within_parent)
      INTO v_periods_in_term_count, v_periods_in_term_positions
      FROM public.school_periods
      WHERE parent_term_id = v_term_cur.id AND is_active = true;

      IF v_periods_in_term_count <> 3 OR v_periods_in_term_positions IS DISTINCT FROM ARRAY[1, 2, 3] THEN
        RAISE EXCEPTION 'Activation refusée : Le trimestre "%" possède % période(s) au lieu d’exactement 3 (positions 1, 2 et 3).',
          v_term_cur.name, v_periods_in_term_count;
      END IF;
    END LOOP;

  ELSIF p_education_cycle = 'secondary' THEN
    -- A. Contrôle des 2 semestres
    SELECT array_agg(position ORDER BY position)
    INTO v_term_positions
    FROM public.school_terms
    WHERE school_id = p_school_id
      AND academic_year_id = p_academic_year_id
      AND education_cycle = 'secondary'
      AND is_active = true;

    IF v_term_positions IS DISTINCT FROM ARRAY[1, 2] THEN
      RAISE EXCEPTION 'Activation refusée : Le cycle secondaire exige exactement 2 semestres actifs aux positions 1 et 2 sans doublon.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.school_terms
      WHERE school_id = p_school_id
        AND academic_year_id = p_academic_year_id
        AND education_cycle = 'secondary'
        AND is_active = true
        AND division_type IS DISTINCT FROM 'semester'
    ) THEN
      RAISE EXCEPTION 'Activation refusée : Tous les termes secondaires doivent avoir division_type = ''semester''.';
    END IF;

    -- B. Contrôle global des 4 périodes
    SELECT array_agg(position ORDER BY position)
    INTO v_period_positions
    FROM public.school_periods
    WHERE school_id = p_school_id
      AND academic_year_id = p_academic_year_id
      AND education_cycle = 'secondary'
      AND is_active = true;

    IF v_period_positions IS DISTINCT FROM ARRAY[1, 2, 3, 4] THEN
      RAISE EXCEPTION 'Activation refusée : Le cycle secondaire exige exactement 4 périodes actives aux positions 1 à 4 sans doublon.';
    END IF;

    -- C. Contrôle de répartition stricte : exactement 2 périodes par semestre
    FOR v_term_cur IN (
      SELECT id, name, position FROM public.school_terms
      WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = 'secondary' AND is_active = true
      ORDER BY position ASC
    ) LOOP
      SELECT COUNT(*), array_agg(position_within_parent ORDER BY position_within_parent)
      INTO v_periods_in_term_count, v_periods_in_term_positions
      FROM public.school_periods
      WHERE parent_term_id = v_term_cur.id AND is_active = true;

      IF v_periods_in_term_count <> 2 OR v_periods_in_term_positions IS DISTINCT FROM ARRAY[1, 2] THEN
        RAISE EXCEPTION 'Activation refusée : Le semestre "%" possède % période(s) au lieu d’exactement 2 (positions 1 et 2).',
          v_term_cur.name, v_periods_in_term_count;
      END IF;
    END LOOP;
  END IF;

  -- 6. Contrôle de présence de toutes les dates (Non NULL)
  SELECT COUNT(*) INTO v_missing_terms
  FROM public.school_terms
  WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = p_education_cycle AND is_active = true
    AND (starts_on IS NULL OR ends_on IS NULL);

  IF v_missing_terms > 0 THEN
    RAISE EXCEPTION 'Activation refusée : % terme(s) n’ont pas de dates définies.', v_missing_terms;
  END IF;

  SELECT COUNT(*) INTO v_missing_periods
  FROM public.school_periods
  WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = p_education_cycle AND is_active = true
    AND (starts_on IS NULL OR ends_on IS NULL);

  IF v_missing_periods > 0 THEN
    RAISE EXCEPTION 'Activation refusée : % période(s) n’ont pas de dates définies.', v_missing_periods;
  END IF;

  -- 7. Revalidation des dates de termes par rapport à l'année scolaire
  IF v_year.starts_on IS NOT NULL OR v_year.ends_on IS NOT NULL THEN
    SELECT name, starts_on, ends_on INTO v_term_out_of_year
    FROM public.school_terms
    WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = p_education_cycle AND is_active = true
      AND (
        (v_year.starts_on IS NOT NULL AND starts_on < v_year.starts_on) OR
        (v_year.ends_on IS NOT NULL AND ends_on > v_year.ends_on)
      )
    LIMIT 1;

    IF v_term_out_of_year.name IS NOT NULL THEN
      RAISE EXCEPTION 'Activation refusée : Le terme "%" (% au %) déborde de l’année scolaire (% au %).',
        v_term_out_of_year.name, v_term_out_of_year.starts_on, v_term_out_of_year.ends_on, v_year.starts_on, v_year.ends_on;
    END IF;
  END IF;

  -- 8. Revalidation de l'inclusion des périodes dans leur terme parent et l'année scolaire
  SELECT sp.name AS period_name, st.name AS term_name, sp.starts_on AS p_starts, sp.ends_on AS p_ends, st.starts_on AS t_starts, st.ends_on AS t_ends
  INTO v_invalid_period_bounds
  FROM public.school_periods sp
  JOIN public.school_terms st ON st.id = sp.parent_term_id
  WHERE sp.school_id = p_school_id
    AND sp.academic_year_id = p_academic_year_id
    AND sp.education_cycle = p_education_cycle
    AND sp.is_active = true
    AND (sp.starts_on < st.starts_on OR sp.ends_on > st.ends_on)
  LIMIT 1;

  IF v_invalid_period_bounds.period_name IS NOT NULL THEN
    RAISE EXCEPTION 'Activation refusée : La période "%" (% au %) déborde des dates de son terme parent "%" (% au %).',
      v_invalid_period_bounds.period_name, v_invalid_period_bounds.p_starts, v_invalid_period_bounds.p_ends,
      v_invalid_period_bounds.term_name, v_invalid_period_bounds.t_starts, v_invalid_period_bounds.t_ends;
  END IF;

  -- 9. Revalidation d'absence de chevauchements entre termes
  SELECT t1.name AS term1_name, t2.name AS term2_name
  INTO v_overlap_term
  FROM public.school_terms t1
  JOIN public.school_terms t2 ON t1.id < t2.id
  WHERE t1.school_id = p_school_id AND t1.academic_year_id = p_academic_year_id AND t1.education_cycle = p_education_cycle AND t1.is_active = true
    AND t2.school_id = p_school_id AND t2.academic_year_id = p_academic_year_id AND t2.education_cycle = p_education_cycle AND t2.is_active = true
    AND (
      (t1.starts_on BETWEEN t2.starts_on AND t2.ends_on) OR
      (t1.ends_on BETWEEN t2.starts_on AND t2.ends_on) OR
      (t2.starts_on BETWEEN t1.starts_on AND t1.ends_on)
    )
  LIMIT 1;

  IF v_overlap_term.term1_name IS NOT NULL THEN
    RAISE EXCEPTION 'Activation refusée : Chevauchement détecté entre les termes "%" et "%".',
      v_overlap_term.term1_name, v_overlap_term.term2_name;
  END IF;

  -- 10. Revalidation d'absence de chevauchements entre périodes d'un même terme
  SELECT p1.name AS p1_name, p2.name AS p2_name
  INTO v_overlap_period
  FROM public.school_periods p1
  JOIN public.school_periods p2 ON p1.id < p2.id AND p1.parent_term_id = p2.parent_term_id
  WHERE p1.school_id = p_school_id AND p1.academic_year_id = p_academic_year_id AND p1.education_cycle = p_education_cycle AND p1.is_active = true
    AND p2.school_id = p_school_id AND p2.academic_year_id = p_academic_year_id AND p2.education_cycle = p_education_cycle AND p2.is_active = true
    AND (
      (p1.starts_on BETWEEN p2.starts_on AND p2.ends_on) OR
      (p1.ends_on BETWEEN p2.starts_on AND p2.ends_on) OR
      (p2.starts_on BETWEEN p1.starts_on AND p1.ends_on)
    )
  LIMIT 1;

  IF v_overlap_period.p1_name IS NOT NULL THEN
    RAISE EXCEPTION 'Activation refusée : Chevauchement détecté entre les périodes "%" et "%".',
      v_overlap_period.p1_name, v_overlap_period.p2_name;
  END IF;

  -- 11. Mise à jour atomique vers 'active'
  UPDATE public.school_calendars
  SET status = 'active',
      activated_at = now(),
      activated_by = v_uid,
      closed_at = NULL,
      updated_at = now()
  WHERE id = v_calendar_id;

  -- 12. Journal d'audit complet
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    p_school_id,
    v_uid,
    'school_calendar_activated',
    jsonb_build_object(
      'entity_type', 'school_calendar',
      'entity_id', v_calendar_id,
      'academic_year_id', p_academic_year_id,
      'education_cycle', p_education_cycle,
      'old_data', jsonb_build_object('status', v_calendar_status),
      'new_data', jsonb_build_object('status', 'active', 'activated_at', now()),
      'actor_id', v_uid,
      'date', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'calendar_id', v_calendar_id,
    'school_id', p_school_id,
    'academic_year_id', p_academic_year_id,
    'education_cycle', p_education_cycle,
    'status', 'active'
  );
END;
$$;

--------------------------------------------------------------------------------
-- 10. RPC DE RÉOUVERTURE DU CALENDRIER SCOLAIRE (REOPEN_SCHOOL_CALENDAR)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.reopen_school_calendar(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.reopen_school_calendar(UUID, UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.reopen_school_calendar(
  p_school_id UUID,
  p_academic_year_id UUID,
  p_education_cycle TEXT,
  p_reason TEXT
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
  v_school RECORD;
  v_year RECORD;
  v_calendar RECORD;
  v_old_status TEXT;
BEGIN
  -- 1. Validation authentification
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'school_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent rouvrir un Calendrier Scolaire.';
  END IF;

  -- 2. Validation du motif (Obligatoire, min 5 caractères)
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Motif obligatoire : Vous devez fournir un motif de réouverture explicite d’au moins 5 caractères.';
  END IF;

  -- 3. Validation de l'école et du cycle organisé (pas de fallback)
  SELECT id, status, education_cycles INTO v_school
  FROM public.schools WHERE id = p_school_id;

  IF v_school.id IS NULL THEN
    RAISE EXCEPTION 'Établissement scolaire introuvable';
  END IF;

  IF v_caller_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM p_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
    END IF;
    IF v_school.status <> 'active' THEN
      RAISE EXCEPTION 'L’établissement scolaire est inactif ou suspendu.';
    END IF;
  END IF;

  IF v_school.education_cycles IS NULL OR cardinality(v_school.education_cycles) = 0 THEN
    RAISE EXCEPTION 'Les cycles d’enseignement de cet établissement ne sont pas encore configurés.';
  END IF;

  IF NOT (p_education_cycle = ANY(v_school.education_cycles)) THEN
    RAISE EXCEPTION 'Le cycle scolaire "%" n’est pas organisé par cet établissement.', p_education_cycle;
  END IF;

  -- 4. Validation de l'année scolaire
  SELECT id INTO v_year
  FROM public.academic_years
  WHERE id = p_academic_year_id AND school_id = p_school_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Année scolaire introuvable dans cet établissement';
  END IF;

  -- 5. Verrouillage FOR UPDATE et contrôle machine d'états
  SELECT * INTO v_calendar
  FROM public.school_calendars
  WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = p_education_cycle
  FOR UPDATE;

  IF v_calendar.id IS NULL THEN
    RAISE EXCEPTION 'Calendrier Scolaire introuvable pour ce cycle.';
  END IF;

  IF v_calendar.status = 'draft' THEN
    RAISE EXCEPTION 'Réouverture refusée : Le Calendrier Scolaire est déjà en statut brouillon.';
  END IF;

  v_old_status := v_calendar.status;

  -- 6. Transition vers 'draft'
  UPDATE public.school_calendars
  SET status = 'draft',
      updated_at = now()
  WHERE id = v_calendar.id;

  -- 7. Journal d'audit complet avec motif
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    p_school_id,
    v_uid,
    'school_calendar_reopened',
    jsonb_build_object(
      'entity_type', 'school_calendar',
      'entity_id', v_calendar.id,
      'academic_year_id', p_academic_year_id,
      'education_cycle', p_education_cycle,
      'reason', trim(p_reason),
      'old_data', jsonb_build_object('status', v_old_status),
      'new_data', jsonb_build_object('status', 'draft'),
      'actor_id', v_uid,
      'date', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'calendar_id', v_calendar.id,
    'status', 'draft'
  );
END;
$$;

--------------------------------------------------------------------------------
-- 11. RPC DE CLÔTURE DU CALENDRIER SCOLAIRE (CLOSE_SCHOOL_CALENDAR)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.close_school_calendar(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.close_school_calendar(
  p_school_id UUID,
  p_academic_year_id UUID,
  p_education_cycle TEXT
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
  v_school RECORD;
  v_year RECORD;
  v_calendar RECORD;
  v_old_status TEXT;
BEGIN
  -- 1. Validation authentification
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'school_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent clôturer un Calendrier Scolaire.';
  END IF;

  -- 2. Validation de l'école et du cycle organisé (pas de fallback)
  SELECT id, status, education_cycles INTO v_school
  FROM public.schools WHERE id = p_school_id;

  IF v_school.id IS NULL THEN
    RAISE EXCEPTION 'Établissement scolaire introuvable';
  END IF;

  IF v_caller_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM p_school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
    END IF;
    IF v_school.status <> 'active' THEN
      RAISE EXCEPTION 'L’établissement scolaire est inactif ou suspendu.';
    END IF;
  END IF;

  IF v_school.education_cycles IS NULL OR cardinality(v_school.education_cycles) = 0 THEN
    RAISE EXCEPTION 'Les cycles d’enseignement de cet établissement ne sont pas encore configurés.';
  END IF;

  IF NOT (p_education_cycle = ANY(v_school.education_cycles)) THEN
    RAISE EXCEPTION 'Le cycle scolaire "%" n’est pas organisé par cet établissement.', p_education_cycle;
  END IF;

  -- 3. Validation de l'année scolaire
  SELECT id INTO v_year
  FROM public.academic_years
  WHERE id = p_academic_year_id AND school_id = p_school_id;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Année scolaire introuvable dans cet établissement';
  END IF;

  -- 4. Verrouillage FOR UPDATE et contrôle machine d'états
  SELECT * INTO v_calendar
  FROM public.school_calendars
  WHERE school_id = p_school_id AND academic_year_id = p_academic_year_id AND education_cycle = p_education_cycle
  FOR UPDATE;

  IF v_calendar.id IS NULL THEN
    RAISE EXCEPTION 'Calendrier Scolaire introuvable pour ce cycle.';
  END IF;

  -- Transition stricte : Seul un calendrier 'active' peut être clôturé
  IF v_calendar.status = 'draft' THEN
    RAISE EXCEPTION 'Clôture refusée : Un calendrier en brouillon ne peut pas être clôturé directement. Vous devez d’abord l’activer.';
  ELSIF v_calendar.status = 'closed' THEN
    RAISE EXCEPTION 'Clôture refusée : Le Calendrier Scolaire est déjà clôturé.';
  ELSIF v_calendar.status <> 'active' THEN
    RAISE EXCEPTION 'Transition d’état invalide (% -> closed).', v_calendar.status;
  END IF;

  v_old_status := v_calendar.status;

  -- 5. Transition vers 'closed'
  UPDATE public.school_calendars
  SET status = 'closed',
      closed_at = now(),
      updated_at = now()
  WHERE id = v_calendar.id;

  -- 6. Journal d'audit complet
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    p_school_id,
    v_uid,
    'school_calendar_closed',
    jsonb_build_object(
      'entity_type', 'school_calendar',
      'entity_id', v_calendar.id,
      'academic_year_id', p_academic_year_id,
      'education_cycle', p_education_cycle,
      'old_data', jsonb_build_object('status', v_old_status),
      'new_data', jsonb_build_object('status', 'closed', 'closed_at', now()),
      'actor_id', v_uid,
      'date', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'calendar_id', v_calendar.id,
    'status', 'closed'
  );
END;
$$;

--------------------------------------------------------------------------------
-- 12. POLITIQUES RLS SUR SCHOOL_CALENDARS
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS school_calendars_select_policy ON public.school_calendars;
CREATE POLICY school_calendars_select_policy ON public.school_calendars
  FOR SELECT TO authenticated
  USING (
    public.can_user_read_school_calendar(school_calendars.school_id, school_calendars.education_cycle)
  );

--------------------------------------------------------------------------------
-- 13. PRIVILÈGES ET SÉCURISATION (REVOKE / GRANT)
--------------------------------------------------------------------------------

-- Privilèges table school_calendars
GRANT SELECT ON public.school_calendars TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.school_calendars FROM PUBLIC, anon, authenticated;

-- Révocation publique des fonctions RPC
REVOKE ALL ON FUNCTION public.can_user_read_school_calendar(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_school_calendar(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_school_term_dates(UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_school_period_dates(UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_school_calendar(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_school_calendar(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_school_calendar(UUID, UUID, TEXT) FROM PUBLIC;

-- Attribution aux utilisateurs authentifiés
GRANT EXECUTE ON FUNCTION public.can_user_read_school_calendar(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_school_calendar(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_school_term_dates(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_school_period_dates(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_school_calendar(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_school_calendar(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_school_calendar(UUID, UUID, TEXT) TO authenticated;

--------------------------------------------------------------------------------
-- 14. TESTS SQL NÉGATIFS ET POSITIFS DOCUMENTÉS
--------------------------------------------------------------------------------
/*
SCÉNARIOS DE TESTS DE VALIDATION INTÉGRÉS :

1. Modification directe d'un calendrier active :
   - save_school_term_dates() ou save_school_period_dates() alors que school_calendars.status = 'active'
   -> REJET : "Modification refusée : Le Calendrier Scolaire est actuellement 'active'. Vous devez obligatoirement le rouvrir en brouillon via reopen_school_calendar()."

2. Modification directe d'un calendrier closed :
   - save_school_term_dates() ou save_school_period_dates() alors que school_calendars.status = 'closed'
   -> REJET : "Modification refusée : Le Calendrier Scolaire est actuellement 'closed'. Vous devez obligatoirement le rouvrir en brouillon via reopen_school_calendar()."

3. Transition closed -> active sans réouverture :
   - activate_school_calendar() sur un calendrier avec status = 'closed'
   -> REJET : "Activation refusée : Le Calendrier Scolaire est clôturé. Vous devez d’abord le rouvrir en brouillon via reopen_school_calendar()."

4. Transition draft -> closed directe :
   - close_school_calendar() sur un calendrier en 'draft'
   -> REJET : "Clôture refusée : Un calendrier en brouillon ne peut pas être clôturé directement. Vous devez d’abord l’activer."

5. Réouverture sans motif ou motif < 5 caractères :
   - reopen_school_calendar(..., p_reason: 'ok')
   -> REJET : "Motif obligatoire : Vous devez fournir un motif de réouverture explicite d’au moins 5 caractères."

6. Réouverture d'un calendrier déjà draft :
   - reopen_school_calendar() sur un calendrier status = 'draft'
   -> REJET : "Réouverture refusée : Le Calendrier Scolaire est déjà en statut brouillon."

7. Activation d'un calendrier déjà actif :
   - activate_school_calendar() sur un calendrier status = 'active'
   -> REJET : "Activation refusée : Le Calendrier Scolaire est déjà actif pour ce cycle."

8. Émulation élève dont le compte personnel est not_invited :
   - get_school_calendar() par un élève avec students.account_status = 'not_invited'
   -> REJET (can_user_read_school_calendar() = false).

9. Émulation parent d'un élève not_invited :
   - get_school_calendar() par un parent avec parent_accounts.account_status = 'active', parent_student_links.status = 'approved', students.enrollment_status = 'active', student_enrollments.status = 'active'
   -> ACCÈS AUTORISÉ (le parent peut consulter même si l'enfant est not_invited).

10. Émulation élève primaire demandant le cycle secondaire :
    - get_school_calendar(p_education_cycle: 'secondary') par un élève inscrit en primaire
    -> REJET : "Accès refusé : Vous n’avez pas l’autorisation de consulter le Calendrier Scolaire pour ce cycle."

11. Émulation parent lié uniquement à un enfant primaire demandant le secondaire :
    - get_school_calendar(p_education_cycle: 'secondary')
    -> REJET : "Accès refusé : Vous n’avez pas l’autorisation de consulter le Calendrier Scolaire pour ce cycle."

12. École dont education_cycles est non configuré (NULL ou vide) :
    - activate_school_calendar() ou get_school_calendar()
    -> REJET : "Les cycles d’enseignement de cet établissement ne sont pas encore configurés."

13. 9 périodes placées dans un seul trimestre (ou répartition incorrecte) :
    - Activation d'une structure primaire où un trimestre a 9 périodes et les autres 0
    -> REJET : "Activation refusée : Le trimestre X possède Y période(s) au lieu d’exactement 3 (positions 1, 2 et 3)."

14. Positions de périodes ou termes dupliqués :
    - Présence de deux termes avec position = 1
    -> REJET : "Activation refusée : Le cycle primaire exige exactement 3 trimestres actifs aux positions 1, 2 et 3 sans doublon."

15. Cycle non organisé par l'établissement :
    - Activation ou lecture d'un calendrier primaire pour une école qui a education_cycles = ARRAY['secondary']
    -> REJET : "Activation impossible : Le cycle 'primary' n’est pas organisé par cet établissement."

16. Deux activations concurrentes :
    - Verrouillage SELECT ... FOR UPDATE sur la ligne school_calendars garantit qu'une seule transaction réussit la transition draft -> active.

17. Tentative d'activation par un school_admin d'une autre école :
    - validate_school_calendar_record()
    -> REJET : "Incohérence multi-écoles : L’administrateur ayant activé le calendrier appartient à un autre établissement."
*/

COMMIT;
