-- ============================================================================
-- Migration Phase 2F.1 : Validation de Continuité et Bornage du Calendrier Scolaire
-- Fichier : supabase/migrations/20260818150000_school_calendar_continuity_validation.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. MISE À JOUR DE GET_SCHOOL_CALENDAR AVEC VALIDATION DE CONTINUITÉ ET RÉPARTITION
--------------------------------------------------------------------------------

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
  v_term_cur RECORD;
  v_period_cur RECORD;
  v_prev_period_id UUID;
  v_prev_period_name TEXT;
  v_prev_period_ends_on DATE;
  v_expected_periods_per_term INT;
  v_expected_positions INT[];
  v_periods_in_term_count INT;
  v_periods_in_term_positions INT[];
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
    v_expected_periods_per_term := 3;
    v_expected_positions := ARRAY[1, 2, 3];
  ELSE
    v_expected_terms_count := 2;
    v_expected_periods_count := 4;
    v_expected_periods_per_term := 2;
    v_expected_positions := ARRAY[1, 2];
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

  -- 8. Contrôle strict de la répartition et de la continuité des périodes par terme
  FOR v_term_cur IN (
    SELECT id, name, position, starts_on, ends_on
    FROM public.school_terms
    WHERE school_id = p_school_id
      AND academic_year_id = p_academic_year_id
      AND education_cycle = p_education_cycle
      AND is_active = true
    ORDER BY position ASC
  ) LOOP
    -- Contrôle de la répartition exacte des périodes dans le terme
    SELECT COUNT(*), array_agg(position_within_parent ORDER BY position_within_parent)
    INTO v_periods_in_term_count, v_periods_in_term_positions
    FROM public.school_periods
    WHERE parent_term_id = v_term_cur.id AND is_active = true;

    IF v_periods_in_term_count <> v_expected_periods_per_term OR v_periods_in_term_positions IS DISTINCT FROM v_expected_positions THEN
      v_errors := array_append(
        v_errors,
        format('Répartition incorrecte : Le terme "%s" possède %s période(s) au lieu d’exactement %s (positions %s requises).',
          v_term_cur.name, v_periods_in_term_count, v_expected_periods_per_term, array_to_string(v_expected_positions, ', '))
      );
    END IF;

    -- Contrôle de continuité et bornage (si dates renseignées)
    v_prev_period_id := NULL;
    v_prev_period_name := NULL;
    v_prev_period_ends_on := NULL;

    FOR v_period_cur IN (
      SELECT id, name, position, position_within_parent, starts_on, ends_on
      FROM public.school_periods
      WHERE parent_term_id = v_term_cur.id
        AND is_active = true
      ORDER BY position_within_parent ASC
    ) LOOP
      IF v_period_cur.starts_on IS NOT NULL AND v_period_cur.ends_on IS NOT NULL AND v_term_cur.starts_on IS NOT NULL AND v_term_cur.ends_on IS NOT NULL THEN
        -- Règle 1 : La 1re période doit commencer exactement à la date de début du terme
        IF v_period_cur.position_within_parent = 1 THEN
          IF v_period_cur.starts_on <> v_term_cur.starts_on THEN
            v_errors := array_append(
              v_errors,
              format('La première période "%s" de "%s" doit commencer exactement à la date de début du terme (%s au lieu de %s).',
                v_period_cur.name, v_term_cur.name, v_term_cur.starts_on, v_period_cur.starts_on)
            );
          END IF;
        END IF;

        -- Règle 2 : Continuité exacte entre périodes consécutives d'un même terme
        IF v_prev_period_id IS NOT NULL THEN
          IF v_period_cur.starts_on <> (v_prev_period_ends_on + 1) THEN
            IF v_period_cur.starts_on > (v_prev_period_ends_on + 1) THEN
              v_errors := array_append(
                v_errors,
                format('Un espace non couvert existe entre la période "%s" (fin le %s) et la période "%s" (début le %s).',
                  v_prev_period_name, v_prev_period_ends_on, v_period_cur.name, v_period_cur.starts_on)
              );
            ELSE
              v_errors := array_append(
                v_errors,
                format('Chevauchement ou incohérence de dates entre "%s" et "%s".',
                  v_prev_period_name, v_period_cur.name)
              );
            END IF;
          END IF;
        END IF;

        -- Règle 3 : La dernière période doit se terminer exactement à la date de fin du terme
        IF v_period_cur.position_within_parent = v_expected_periods_per_term THEN
          IF v_period_cur.ends_on <> v_term_cur.ends_on THEN
            v_errors := array_append(
              v_errors,
              format('La dernière période "%s" de "%s" doit se terminer exactement à la date de fin du terme (%s au lieu de %s).',
                v_period_cur.name, v_term_cur.name, v_term_cur.ends_on, v_period_cur.ends_on)
            );
          END IF;
        END IF;
      END IF;

      v_prev_period_id := v_period_cur.id;
      v_prev_period_name := v_period_cur.name;
      v_prev_period_ends_on := v_period_cur.ends_on;
    END LOOP;
  END LOOP;

  -- 9. Construction du résultat complet
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
-- 2. MISE À JOUR DE ACTIVATE_SCHOOL_CALENDAR AVEC REVALIDATION DE CONTINUITÉ
--------------------------------------------------------------------------------

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
  v_period_cur RECORD;
  v_prev_period_id UUID;
  v_prev_period_name TEXT;
  v_prev_period_ends_on DATE;
  v_periods_in_term_count INT;
  v_periods_in_term_positions INT[];
  v_expected_periods_per_term INT;
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
    v_expected_periods_per_term := 3;

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
    v_expected_periods_per_term := 2;

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

  -- 8. Revalidation de l'inclusion des périodes dans leur terme parent
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

  -- 11. Contrôle strict de continuité et de bornage exact par trimestre/semestre (avec variables scalaires)
  FOR v_term_cur IN (
    SELECT id, name, position, starts_on, ends_on
    FROM public.school_terms
    WHERE school_id = p_school_id
      AND academic_year_id = p_academic_year_id
      AND education_cycle = p_education_cycle
      AND is_active = true
    ORDER BY position ASC
  ) LOOP
    v_prev_period_id := NULL;
    v_prev_period_name := NULL;
    v_prev_period_ends_on := NULL;

    FOR v_period_cur IN (
      SELECT id, name, position, position_within_parent, starts_on, ends_on
      FROM public.school_periods
      WHERE parent_term_id = v_term_cur.id
        AND is_active = true
      ORDER BY position_within_parent ASC
    ) LOOP
      -- Règle 1 : La première période doit commencer exactement à la date de début du terme
      IF v_period_cur.position_within_parent = 1 THEN
        IF v_period_cur.starts_on <> v_term_cur.starts_on THEN
          RAISE EXCEPTION 'Activation refusée : La première période "%" de "%" doit commencer exactement à la date de début du terme (% au lieu de %).',
            v_period_cur.name, v_term_cur.name, v_term_cur.starts_on, v_period_cur.starts_on;
        END IF;
      END IF;

      -- Règle 2 : Continuité exacte entre périodes consécutives du même terme
      IF v_prev_period_id IS NOT NULL THEN
        IF v_period_cur.starts_on <> (v_prev_period_ends_on + 1) THEN
          IF v_period_cur.starts_on > (v_prev_period_ends_on + 1) THEN
            RAISE EXCEPTION 'Activation refusée : Un espace non couvert existe entre la période "%" (fin le %) et la période "%" (début le %).',
              v_prev_period_name, v_prev_period_ends_on, v_period_cur.name, v_period_cur.starts_on;
          ELSE
            RAISE EXCEPTION 'Activation refusée : Chevauchement entre la période "%" (fin le %) et la période "%" (début le %).',
              v_prev_period_name, v_prev_period_ends_on, v_period_cur.name, v_period_cur.starts_on;
          END IF;
        END IF;
      END IF;

      -- Règle 3 : La dernière période doit se terminer exactement à la date de fin du terme
      IF v_period_cur.position_within_parent = v_expected_periods_per_term THEN
        IF v_period_cur.ends_on <> v_term_cur.ends_on THEN
          RAISE EXCEPTION 'Activation refusée : La dernière période "%" de "%" doit se terminer exactement à la date de fin du terme (% au lieu de %).',
            v_period_cur.name, v_term_cur.name, v_term_cur.ends_on, v_period_cur.ends_on;
        END IF;
      END IF;

      v_prev_period_id := v_period_cur.id;
      v_prev_period_name := v_period_cur.name;
      v_prev_period_ends_on := v_period_cur.ends_on;
    END LOOP;
  END LOOP;

  -- 12. Mise à jour atomique vers 'active'
  UPDATE public.school_calendars
  SET status = 'active',
      activated_at = now(),
      activated_by = v_uid,
      closed_at = NULL,
      updated_at = now()
  WHERE id = v_calendar_id;

  -- 13. Journal d'audit complet
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
-- 3. PERMISSIONS ET PRIVILÈGES
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_school_calendar(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_school_calendar(UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_school_calendar(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_school_calendar(UUID, UUID, TEXT) TO authenticated;

--------------------------------------------------------------------------------
-- 4. TESTS SQL NÉGATIFS ET POSITIFS DOCUMENTÉS
--------------------------------------------------------------------------------
/*
SCÉNARIOS DE TESTS DE VALIDATION DE CONTINUITÉ :

1. Première période ne commençant pas à la date de début du semestre/trimestre :
   - Terme : 2026-09-01 au 2027-02-15
   - Période 1 : 2026-09-05 au 2026-11-15
   -> REJET : "Activation refusée : La première période '1ère Période' de '1er Semestre' doit commencer exactement à la date de début du terme (2026-09-01 au lieu de 2026-09-05)."

2. Espace non couvert entre deux périodes consécutives d'un même terme :
   - Période 1 : 2026-09-01 au 2026-11-15
   - Période 2 : 2026-11-18 au 2027-02-15 (écart de 2 jours non couverts)
   -> REJET : "Activation refusée : Un espace non couvert existe entre la période '1ère Période' (fin le 2026-11-15) et la période '2ème Période' (début le 2026-11-18)."

3. Dernière période ne se terminant pas à la date de fin du semestre/trimestre :
   - Terme : 2026-09-01 au 2027-02-15
   - Période 2 : 2026-11-16 au 2027-02-10 (fin prématurée)
   -> REJET : "Activation refusée : La dernière période '2ème Période' de '1er Semestre' doit se terminer exactement à la date de fin du terme (2027-02-15 au lieu de 2027-02-10)."

4. Répartition erronée (ex: 4 périodes dans le 1er semestre, 0 dans le 2e) :
   - is_complete sera FALSE avec configuration_errors spécifiant l'anomalie par terme.

5. Continuité parfaite et bornage exact (Succès) :
   - Terme : 2026-09-01 au 2027-02-15
   - Période 1 : 2026-09-01 au 2026-11-15
   - Période 2 : 2026-11-16 au 2027-02-15
   -> SUCCÈS : Activation du Calendrier Scolaire avec statut 'active'.
*/

COMMIT;
