-- Migration Phase 2D.3.1 : Cycles d'Enseignement et Création d'École avec Calendrier Scolaire RDC Intégré
-- Fichier : supabase/migrations/20260818090000_school_education_cycles_and_wizard.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION DE PUBLIC.SCHOOLS (COLONNE EDUCATION_CYCLES)
--------------------------------------------------------------------------------

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS education_cycles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Contrainte CHECK sans sous-requête garantissant uniquement les formes canoniques autorisées
DO $$
BEGIN
  ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS chk_schools_education_cycles;

  ALTER TABLE public.schools
    ADD CONSTRAINT chk_schools_education_cycles
    CHECK (
      education_cycles IN (
        ARRAY[]::TEXT[],
        ARRAY['primary']::TEXT[],
        ARRAY['secondary']::TEXT[],
        ARRAY['primary', 'secondary']::TEXT[]
      )
    );
END $$;

--------------------------------------------------------------------------------
-- 2. BACKFILL PRUDENT ET DÉTERMINISTE DES ÉCOLES EXISTANTES
--------------------------------------------------------------------------------

DO $$
DECLARE
  s RECORD;
  v_has_pri_classes BOOLEAN;
  v_has_sec_classes BOOLEAN;
  v_has_pri_terms BOOLEAN;
  v_has_sec_terms BOOLEAN;
  v_cycles TEXT[];
BEGIN
  FOR s IN (SELECT id FROM public.schools) LOOP
    -- Priorité A : Déduction stricte depuis les classes réelles
    SELECT 
      EXISTS (SELECT 1 FROM public.classes WHERE school_id = s.id AND education_cycle = 'primary'),
      EXISTS (SELECT 1 FROM public.classes WHERE school_id = s.id AND education_cycle = 'secondary')
    INTO v_has_pri_classes, v_has_sec_classes;

    IF v_has_pri_classes AND v_has_sec_classes THEN
      v_cycles := ARRAY['primary', 'secondary']::TEXT[];
    ELSIF v_has_pri_classes THEN
      v_cycles := ARRAY['primary']::TEXT[];
    ELSIF v_has_sec_classes THEN
      v_cycles := ARRAY['secondary']::TEXT[];
    ELSE
      -- Priorité B : Si aucune classe n'a de cycle défini, déduire depuis school_terms
      SELECT 
        EXISTS (SELECT 1 FROM public.school_terms WHERE school_id = s.id AND education_cycle = 'primary'),
        EXISTS (SELECT 1 FROM public.school_terms WHERE school_id = s.id AND education_cycle = 'secondary')
      INTO v_has_pri_terms, v_has_sec_terms;

      IF v_has_pri_terms AND v_has_sec_terms THEN
        v_cycles := ARRAY['primary', 'secondary']::TEXT[];
      ELSIF v_has_pri_terms THEN
        v_cycles := ARRAY['primary']::TEXT[];
      ELSIF v_has_sec_terms THEN
        v_cycles := ARRAY['secondary']::TEXT[];
      ELSE
        -- Priorité C : Aucune info fiable -> tableau vide (À configurer)
        v_cycles := ARRAY[]::TEXT[];
      END IF;
    END IF;

    UPDATE public.schools
    SET education_cycles = v_cycles
    WHERE id = s.id;
  END LOOP;
END $$;

--------------------------------------------------------------------------------
-- 3. RPC DE CRÉATION D'ÉCOLE AVEC WIZARD ET CALENDRIER AUTOMATIQUE
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_school_with_initial_setup(
  p_name TEXT,
  p_slug TEXT,
  p_education_cycles TEXT[],
  p_phone TEXT DEFAULT NULL,
  p_whatsapp TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'RD Congo',
  p_timezone TEXT DEFAULT 'Africa/Kinshasa',
  p_create_academic_year BOOLEAN DEFAULT false,
  p_academic_year_name TEXT DEFAULT NULL,
  p_academic_year_starts_on DATE DEFAULT NULL,
  p_academic_year_ends_on DATE DEFAULT NULL,
  p_academic_year_is_current BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_is_active BOOLEAN;
  v_clean_name TEXT;
  v_clean_slug TEXT;
  v_normalized_cycles TEXT[];
  v_school_id UUID;
  v_academic_year_id UUID := NULL;
  v_primary_res JSONB := NULL;
  v_secondary_res JSONB := NULL;
  v_total_terms INT := 0;
  v_total_periods INT := 0;
BEGIN
  -- 1. Contrôle d'authentification et privilèges Super-Admin
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise : auth.uid() est NULL.';
  END IF;

  SELECT role, is_active INTO v_role, v_is_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE OR v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les super-administrateurs actifs peuvent créer un établissement.';
  END IF;

  -- 2. Validation des données de base de l'établissement
  v_clean_name := trim(p_name);
  v_clean_slug := lower(trim(p_slug));

  IF v_clean_name IS NULL OR v_clean_name = '' THEN
    RAISE EXCEPTION 'Validation échouée : Le nom de l’établissement est obligatoire.';
  END IF;

  IF v_clean_slug IS NULL OR v_clean_slug = '' THEN
    RAISE EXCEPTION 'Validation échouée : L’identifiant unique (slug) est obligatoire.';
  END IF;

  IF v_clean_slug !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'Validation échouée : Le slug ne peut contenir que des lettres minuscules, chiffres et tirets.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.schools WHERE slug = v_clean_slug) THEN
    RAISE EXCEPTION 'Validation échouée : Le slug "%" est déjà utilisé par un autre établissement.', v_clean_slug;
  END IF;

  -- 3. Validation et normalisation canonique des cycles
  IF p_education_cycles IS NULL OR cardinality(p_education_cycles) = 0 THEN
    RAISE EXCEPTION 'Validation échouée : Vous devez sélectionner au moins un cycle d’enseignement (primaire et/ou secondaire).';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_education_cycles) elem WHERE elem IS NULL OR elem NOT IN ('primary', 'secondary')) THEN
    RAISE EXCEPTION 'Validation échouée : Le tableau contient des valeurs de cycle invalides ou NULL.';
  END IF;

  -- Normalisation canonique (ordre strict primary puis secondary)
  IF ('primary' = ANY(p_education_cycles)) AND ('secondary' = ANY(p_education_cycles)) THEN
    v_normalized_cycles := ARRAY['primary', 'secondary']::TEXT[];
  ELSIF 'primary' = ANY(p_education_cycles) THEN
    v_normalized_cycles := ARRAY['primary']::TEXT[];
  ELSIF 'secondary' = ANY(p_education_cycles) THEN
    v_normalized_cycles := ARRAY['secondary']::TEXT[];
  ELSE
    RAISE EXCEPTION 'Validation échouée : Aucun cycle d’enseignement valide.';
  END IF;

  -- 4. Insertion de l'établissement
  INSERT INTO public.schools (
    name,
    slug,
    education_cycles,
    phone,
    whatsapp,
    email,
    address,
    country,
    timezone,
    status
  ) VALUES (
    v_clean_name,
    v_clean_slug,
    v_normalized_cycles,
    nullif(trim(p_phone), ''),
    nullif(trim(p_whatsapp), ''),
    nullif(trim(p_email), ''),
    nullif(trim(p_address), ''),
    coalesce(nullif(trim(p_country), ''), 'RD Congo'),
    coalesce(nullif(trim(p_timezone), ''), 'Africa/Kinshasa'),
    'active'
  ) RETURNING id INTO v_school_id;

  -- 5. Création optionnelle de la première année scolaire et configuration du Calendrier Scolaire
  IF p_create_academic_year IS TRUE THEN
    IF p_academic_year_name IS NULL OR trim(p_academic_year_name) = '' THEN
      RAISE EXCEPTION 'Validation échouée : L’intitulé de l’année scolaire est obligatoire.';
    END IF;

    IF p_academic_year_starts_on IS NULL OR p_academic_year_ends_on IS NULL THEN
      RAISE EXCEPTION 'Validation échouée : Les dates de début et de fin de l’année scolaire sont obligatoires.';
    END IF;

    IF p_academic_year_starts_on >= p_academic_year_ends_on THEN
      RAISE EXCEPTION 'Validation échouée : La date de début de l’année scolaire doit être antérieure à la date de fin.';
    END IF;

    INSERT INTO public.academic_years (
      school_id,
      name,
      starts_on,
      ends_on,
      is_current
    ) VALUES (
      v_school_id,
      trim(p_academic_year_name),
      p_academic_year_starts_on,
      p_academic_year_ends_on,
      coalesce(p_academic_year_is_current, true)
    ) RETURNING id INTO v_academic_year_id;

    -- Génération automatique du Calendrier Scolaire pour chaque cycle sélectionné
    IF 'primary' = ANY(v_normalized_cycles) THEN
      v_primary_res := public.configure_drc_academic_calendar(v_academic_year_id, 'primary', false);
      v_total_terms := v_total_terms + coalesce((v_primary_res->>'created_terms_count')::int, 0);
      v_total_periods := v_total_periods + coalesce((v_primary_res->>'created_periods_count')::int, 0);
    END IF;

    IF 'secondary' = ANY(v_normalized_cycles) THEN
      v_secondary_res := public.configure_drc_academic_calendar(v_academic_year_id, 'secondary', false);
      v_total_terms := v_total_terms + coalesce((v_secondary_res->>'created_terms_count')::int, 0);
      v_total_periods := v_total_periods + coalesce((v_secondary_res->>'created_periods_count')::int, 0);
    END IF;
  END IF;

  -- 6. Journalisation d'audit
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_school_id,
    v_uid,
    'school_created_with_initial_setup',
    jsonb_build_object(
      'school_name', v_clean_name,
      'school_slug', v_clean_slug,
      'education_cycles', v_normalized_cycles,
      'academic_year_created', p_create_academic_year,
      'academic_year_id', v_academic_year_id,
      'primary_calendar', v_primary_res,
      'secondary_calendar', v_secondary_res,
      'created_terms_count', v_total_terms,
      'created_periods_count', v_total_periods
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'school_id', v_school_id,
    'slug', v_clean_slug,
    'name', v_clean_name,
    'education_cycles', v_normalized_cycles,
    'academic_year_id', v_academic_year_id,
    'created_terms_count', v_total_terms,
    'created_periods_count', v_total_periods,
    'primary_result', v_primary_res,
    'secondary_result', v_secondary_res
  );
END;
$$;

--------------------------------------------------------------------------------
-- 4. RPC DE MISE À JOUR DES CYCLES D'ENSEIGNEMENT D'UNE ÉCOLE
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_school_education_cycles(
  p_school_id UUID,
  p_education_cycles TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_is_active BOOLEAN;
  v_school RECORD;
  v_old_cycles TEXT[];
  v_normalized_cycles TEXT[];
  v_removed_cycle TEXT;
  v_conflict_count INT;
BEGIN
  -- 1. Contrôle super_admin
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise : auth.uid() est NULL.';
  END IF;

  SELECT role, is_active INTO v_role, v_is_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE OR v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les super-administrateurs peuvent modifier les cycles d’un établissement.';
  END IF;

  -- 2. Validation de l'école
  SELECT id, name, education_cycles INTO v_school
  FROM public.schools
  WHERE id = p_school_id
  FOR UPDATE;

  IF v_school.id IS NULL THEN
    RAISE EXCEPTION 'Établissement introuvable.';
  END IF;

  -- 3. Validation et normalisation canonique des nouveaux cycles
  IF p_education_cycles IS NULL OR cardinality(p_education_cycles) = 0 THEN
    RAISE EXCEPTION 'Validation échouée : Un établissement doit organiser au moins un cycle d’enseignement.';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_education_cycles) elem WHERE elem IS NULL OR elem NOT IN ('primary', 'secondary')) THEN
    RAISE EXCEPTION 'Validation échouée : Le tableau contient des valeurs de cycle invalides ou NULL.';
  END IF;

  IF ('primary' = ANY(p_education_cycles)) AND ('secondary' = ANY(p_education_cycles)) THEN
    v_normalized_cycles := ARRAY['primary', 'secondary']::TEXT[];
  ELSIF 'primary' = ANY(p_education_cycles) THEN
    v_normalized_cycles := ARRAY['primary']::TEXT[];
  ELSIF 'secondary' = ANY(p_education_cycles) THEN
    v_normalized_cycles := ARRAY['secondary']::TEXT[];
  ELSE
    RAISE EXCEPTION 'Validation échouée : Aucun cycle valide identifié.';
  END IF;

  v_old_cycles := v_school.education_cycles;

  -- 4. Contrôle de sécurité en cas de suppression d'un cycle utilisé
  FOREACH v_removed_cycle IN ARRAY v_old_cycles LOOP
    IF NOT (v_removed_cycle = ANY(v_normalized_cycles)) THEN
      -- Vérifier si des classes utilisent ce cycle
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.classes
      WHERE school_id = p_school_id AND education_cycle = v_removed_cycle;

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Impossible de retirer le cycle "%" : % classe(s) y sont actuellement associées.', 
          CASE WHEN v_removed_cycle = 'primary' THEN 'Primaire' ELSE 'Secondaire' END,
          v_conflict_count;
      END IF;
    END IF;
  END LOOP;

  -- 5. Mise à jour
  UPDATE public.schools
  SET education_cycles = v_normalized_cycles,
      updated_at = now()
  WHERE id = p_school_id;

  -- 6. Audit
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    p_school_id,
    v_uid,
    'school_education_cycles_updated',
    jsonb_build_object(
      'old_cycles', v_old_cycles,
      'new_cycles', v_normalized_cycles
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'school_id', p_school_id,
    'old_cycles', v_old_cycles,
    'new_cycles', v_normalized_cycles
  );
END;
$$;

--------------------------------------------------------------------------------
-- 5. PRIVILÈGES ET ACCÈS SÉCURISÉS (REVOKE / GRANT)
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_school_with_initial_setup(TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, DATE, DATE, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_school_education_cycles(UUID, TEXT[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_school_with_initial_setup(TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, DATE, DATE, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_school_education_cycles(UUID, TEXT[]) TO authenticated;

COMMIT;

--------------------------------------------------------------------------------
-- MATRICE DE TESTS DOCUMENTÉS (NON EXÉCUTÉS)
--------------------------------------------------------------------------------
/*
================================================================================
TEST 1 : Migration sur école existante avec uniquement des classes secondaires
--------------------------------------------------------------------------------
-- Cas : Établissement Complexe Scolaire Les Petits Anges avec classes 1A, 1B, 1C (secondaire).
-- Résultat attendu : education_cycles devient ARRAY['secondary'] (Priorité A).

================================================================================
TEST 2 : École sans classe mais avec termes primaires
--------------------------------------------------------------------------------
-- Cas : Établissement ayant 3 trimestres primaires mais 0 classe enregistrée.
-- Résultat attendu : education_cycles devient ARRAY['primary'] (Priorité B).

================================================================================
TEST 3 : École sans classe ni terme (legacy vierge)
--------------------------------------------------------------------------------
-- Cas : Établissement nouvellement créé ou sans configuration académique.
-- Résultat attendu : education_cycles reste ARRAY[]::TEXT[] signifiant "À configurer" (Priorité C).

================================================================================
TEST 4 : Création d'une école primaire avec Calendrier Scolaire
--------------------------------------------------------------------------------
-- Appel : create_school_with_initial_setup('École Primaire A', 'ecole-primaire-a', ARRAY['primary'], ..., true, '2026–2027', '2026-09-01', '2027-07-02', true)
-- Résultat attendu : success = true, created_terms_count = 3, created_periods_count = 9.

================================================================================
TEST 5 : Création d'une école secondaire avec Calendrier Scolaire
--------------------------------------------------------------------------------
-- Appel : create_school_with_initial_setup('Institut B', 'institut-b', ARRAY['secondary'], ..., true, '2026–2027', '2026-09-01', '2027-07-02', true)
-- Résultat attendu : success = true, created_terms_count = 2, created_periods_count = 4.

================================================================================
TEST 6 : Création mixte avec ordre inversé ARRAY['secondary', 'primary']
--------------------------------------------------------------------------------
-- Appel avec p_education_cycles = ARRAY['secondary', 'primary']
-- Résultat attendu : success = true, education_cycles normalisé en ARRAY['primary', 'secondary']::TEXT[].
-- 5 termes (3T + 2S) et 13 périodes (9 + 4) créés pour la même année scolaire.

================================================================================
TEST 7 : Tableau contenant un élément NULL ou inconnu
--------------------------------------------------------------------------------
-- Appel avec p_education_cycles = ARRAY['primary', NULL] ou ARRAY['universite']
-- Résultat attendu : EXCEPTION 'Validation échouée : Le tableau contient des valeurs de cycle invalides ou NULL.'

================================================================================
TEST 8 : Tableau contenant des doublons ARRAY['primary', 'primary']
--------------------------------------------------------------------------------
-- Appel avec p_education_cycles = ARRAY['primary', 'primary']
-- Résultat attendu : Normalisation canonique en ARRAY['primary'] sans doublon, insertion réussie.

================================================================================
TEST 9 : Erreur pendant la génération de calendrier -> Rollback transactionnel complet
--------------------------------------------------------------------------------
-- Scénario : Erreur survenue lors de configure_drc_academic_calendar()
-- Résultat attendu : Rollback complet, aucune ligne créée dans schools, academic_years ou audit_logs.

================================================================================
TEST 10 : Retrait d'un cycle utilisé par une classe existante
--------------------------------------------------------------------------------
-- Scénario : École mixte avec classes secondaires. Tentative d'update vers ARRAY['primary'].
-- Résultat attendu : EXCEPTION 'Impossible de retirer le cycle "Secondaire" : X classe(s) y sont actuellement associées.'

================================================================================
TEST 11 : Ajout ultérieur d'un cycle sans année scolaire
--------------------------------------------------------------------------------
-- Scénario : École primaire passant à ARRAY['primary', 'secondary'] sans année active.
-- Résultat attendu : Mise à jour réussie de education_cycles sans création automatique de calendrier fantôme.
================================================================================
*/
