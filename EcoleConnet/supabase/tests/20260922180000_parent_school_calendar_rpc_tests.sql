-- Tests automatisés du Lot 2E-R : RPC get_parent_student_calendar et sécurité multi-écoles
-- Fichier : supabase/tests/20260922180000_parent_school_calendar_rpc_tests.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. APPLIQUER LA MIGRATION EN MÉMOIRE DE TRANSACTION
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NULL,
  event_type TEXT NOT NULL DEFAULT 'event' CHECK (event_type IN ('academic', 'sports', 'meeting', 'holiday', 'event')),
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN NOT NULL DEFAULT true,
  location TEXT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_school_events_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_school_events_lookup
  ON public.school_events (school_id, academic_year_id, status, start_date);

ALTER TABLE public.school_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_events FROM PUBLIC;
REVOKE ALL ON TABLE public.school_events FROM anon;
REVOKE ALL ON TABLE public.school_events FROM authenticated;

CREATE OR REPLACE FUNCTION public.check_parent_student_school_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student_school UUID;
BEGIN
  SELECT school_id INTO v_student_school FROM public.students WHERE id = NEW.student_id;

  IF v_student_school IS NULL THEN
    RAISE EXCEPTION 'Élève non trouvé pour le raccordement parent-élève.' USING ERRCODE = '42501';
  END IF;

  NEW.school_id := v_student_school;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_school_event_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_year_school_id UUID;
BEGIN
  SELECT school_id INTO v_year_school_id
  FROM public.academic_years
  WHERE id = NEW.academic_year_id;

  IF v_year_school_id IS NULL OR v_year_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_school_event_integrity ON public.school_events;
CREATE TRIGGER trg_check_school_event_integrity
  BEFORE INSERT OR UPDATE ON public.school_events
  FOR EACH ROW
  EXECUTE FUNCTION public.check_school_event_integrity();

ALTER TABLE public.school_events ENABLE ALWAYS TRIGGER trg_check_school_event_integrity;

CREATE OR REPLACE FUNCTION public.get_parent_student_calendar(
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_student RECORD;
  v_academic_year_id UUID;
  v_academic_year_name TEXT := 'Non spécifiée';
  v_events JSONB;
  v_total_events INT := 0;
BEGIN
  -- A. Authentification & rôle parent actif
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_caller_id
      AND p.role = 'parent'
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un compte parent actif peut consulter le calendrier scolaire.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Validation du lien parent-élève (approved + can_view_academic) & résolution de l'école de l'élève
  SELECT 
    st.id,
    st.school_id,
    st.student_number,
    st.first_name,
    st.last_name,
    st.class_id,
    c.name AS class_name,
    c.academic_year_id AS class_academic_year_id,
    ay.name AS class_academic_year_name,
    s.status AS school_status
  INTO v_student
  FROM public.students st
  JOIN public.parent_student_links psl ON psl.student_id = st.id
  JOIN public.schools s ON s.id = st.school_id
  LEFT JOIN public.classes c ON c.id = st.class_id
  LEFT JOIN public.academic_years ay ON ay.id = c.academic_year_id
  WHERE st.id = p_student_id
    AND psl.parent_profile_id = v_caller_id
    AND psl.status = 'approved'
    AND psl.can_view_academic = true
    AND (psl.school_id IS NULL OR psl.school_id = st.school_id);

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Élève introuvable ou vous n’avez pas l’autorisation académique requise.'
      USING ERRCODE = '42501';
  END IF;

  IF v_student.school_status <> 'active' THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’établissement de cet élève n’est pas actif.'
      USING ERRCODE = '42501';
  END IF;

  -- C. Résolution de l'année scolaire
  v_academic_year_id := v_student.class_academic_year_id;
  v_academic_year_name := COALESCE(v_student.class_academic_year_name, 'Non spécifiée');

  IF v_academic_year_id IS NULL THEN
    SELECT ay.id, ay.name
    INTO v_academic_year_id, v_academic_year_name
    FROM public.academic_years ay
    WHERE ay.school_id = v_student.school_id
      AND ay.is_current = true
    LIMIT 1;
  END IF;

  -- D. Comptage des événements publiés pour cet établissement
  SELECT pg_catalog.count(e.id)
  INTO v_total_events
  FROM public.school_events e
  WHERE e.school_id = v_student.school_id
    AND (v_academic_year_id IS NULL OR e.academic_year_id = v_academic_year_id)
    AND e.status = 'published';

  -- E. Récupération des événements ordonnés par date de début
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'description', COALESCE(e.description, ''),
      'event_type', e.event_type,
      'start_date', e.start_date,
      'end_date', e.end_date,
      'is_all_day', e.is_all_day,
      'location', COALESCE(e.location, ''),
      'status', e.status,
      'created_at', e.created_at
    ) ORDER BY e.start_date ASC
  ), '[]'::jsonb)
  INTO v_events
  FROM public.school_events e
  WHERE e.school_id = v_student.school_id
    AND (v_academic_year_id IS NULL OR e.academic_year_id = v_academic_year_id)
    AND e.status = 'published';

  -- F. Assemblage du résultat JSON
  RETURN pg_catalog.jsonb_build_object(
    'student_id', v_student.id,
    'student_number', v_student.student_number,
    'student_name', TRIM(v_student.first_name || ' ' || v_student.last_name),
    'class_id', COALESCE(v_student.class_id::text, ''),
    'class_name', COALESCE(v_student.class_name, 'Non assignée'),
    'academic_year_id', COALESCE(v_academic_year_id::text, ''),
    'academic_year_name', COALESCE(v_academic_year_name, 'Non spécifiée'),
    'summary', pg_catalog.jsonb_build_object(
      'total_events', v_total_events
    ),
    'events', v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_parent_student_calendar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_calendar(UUID) TO authenticated;

--------------------------------------------------------------------------------
-- 2. DÉROULEMENT DES 13 SCÉNARIOS DE TEST
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_school_a UUID := gen_random_uuid();
  v_school_b UUID := gen_random_uuid();
  
  v_year_a UUID := gen_random_uuid();
  v_year_b UUID := gen_random_uuid();
  v_year_a_empty UUID := gen_random_uuid();
  
  v_parent_multi UUID := gen_random_uuid();
  v_parent_no_link UUID := gen_random_uuid();

  v_class_a UUID := gen_random_uuid();
  v_class_b UUID := gen_random_uuid();
  v_class_a_empty UUID := gen_random_uuid();

  v_student_a UUID := gen_random_uuid();
  v_student_b UUID := gen_random_uuid();
  v_student_pending UUID := gen_random_uuid();
  v_student_rejected UUID := gen_random_uuid();
  v_student_no_acad UUID := gen_random_uuid();
  v_student_empty UUID := gen_random_uuid();
  v_student_other_school UUID := gen_random_uuid();

  v_event_a_pub1 UUID := gen_random_uuid();
  v_event_a_pub2 UUID := gen_random_uuid();
  v_event_a_draft UUID := gen_random_uuid();
  v_event_b_pub UUID := gen_random_uuid();

  v_result JSONB;
BEGIN
  -- SETUP FIXTURES DE TEST

  -- Écoles
  INSERT INTO public.schools (id, name, slug, status)
  VALUES 
    (v_school_a, 'École A (Principale)', 'sch-a', 'active'),
    (v_school_b, 'École B (Seconde)', 'sch-b', 'active');

  -- Années scolaires
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES 
    (v_year_a, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_b, v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_a_empty, v_school_a, '2027-2028', '2027-09-01', '2028-06-30', false);

  -- Classes
  INSERT INTO public.classes (id, school_id, academic_year_id, name, level)
  VALUES 
    (v_class_a, v_school_a, v_year_a, 'Terminales A', 'Tle'),
    (v_class_b, v_school_b, v_year_b, '5ème B', '5eme'),
    (v_class_a_empty, v_school_a, v_year_a_empty, 'Futurs CP', 'CP');

  -- Élèves
  INSERT INTO public.students (id, school_id, class_id, first_name, last_name, student_number)
  VALUES 
    (v_student_a, v_school_a, v_class_a, 'Jean', 'Dupont', 'STU-001'),
    (v_student_b, v_school_b, v_class_b, 'Marie', 'Dupont', 'STU-002'),
    (v_student_pending, v_school_a, v_class_a, 'Lucas', 'Pending', 'STU-003'),
    (v_student_rejected, v_school_a, v_class_a, 'Sophie', 'Rejected', 'STU-004'),
    (v_student_no_acad, v_school_a, v_class_a, 'Marc', 'NoAcad', 'STU-005'),
    (v_student_empty, v_school_a, v_class_a_empty, 'Eric', 'Vide', 'STU-006'),
    (v_student_other_school, v_school_b, v_class_b, 'Inconnu', 'Autre', 'STU-999');

  -- Auth Users
  INSERT INTO auth.users (id, email)
  VALUES 
    (v_parent_multi, 'parent.multi@test.com'),
    (v_parent_no_link, 'parent.nolink@test.com');

  -- Profils Parents (Le profil de v_parent_multi est dans v_school_a, mais il a un enfant dans A et un enfant dans B)
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES 
    (v_parent_multi, v_school_a, 'parent', 'Pierre', 'Dupont', true),
    (v_parent_no_link, v_school_a, 'parent', 'Paul', 'SansLien', true);

  -- Liens Parent-Élève
  INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_view_academic)
  VALUES 
    (gen_random_uuid(), v_school_a, v_parent_multi, v_student_a, 'approved', true),
    (gen_random_uuid(), v_school_b, v_parent_multi, v_student_b, 'approved', true),
    (gen_random_uuid(), v_school_a, v_parent_multi, v_student_pending, 'pending', true),
    (gen_random_uuid(), v_school_a, v_parent_multi, v_student_rejected, 'rejected', true),
    (gen_random_uuid(), v_school_a, v_parent_multi, v_student_no_acad, 'approved', false),
    (gen_random_uuid(), v_school_a, v_parent_multi, v_student_empty, 'approved', true);

  -- Événements École A
  INSERT INTO public.school_events (id, school_id, academic_year_id, title, description, event_type, start_date, end_date, is_all_day, location, status)
  VALUES 
    (v_event_a_pub1, v_school_a, v_year_a, 'Rentrée École A', 'Bienvenue élèves A', 'academic', '2026-09-02 08:00:00+00', '2026-09-02 17:00:00+00', true, 'Cour A', 'published'),
    (v_event_a_pub2, v_school_a, v_year_a, 'Réunion École A', 'Rencontre parents A', 'meeting', '2026-09-15 18:00:00+00', '2026-09-15 20:00:00+00', false, 'Amphi A', 'published'),
    (v_event_a_draft, v_school_a, v_year_a, 'Brouillon École A', 'Non publié', 'event', '2026-09-20 08:00:00+00', '2026-09-20 17:00:00+00', true, 'Bureau', 'draft');

  -- Événements École B
  INSERT INTO public.school_events (id, school_id, academic_year_id, title, description, event_type, start_date, end_date, is_all_day, location, status)
  VALUES 
    (v_event_b_pub, v_school_b, v_year_b, 'Fête de la Science École B', 'Projets scientifiques B', 'sports', '2026-10-05 08:00:00+00', '2026-10-05 17:00:00+00', true, 'Labo B', 'published');

  ------------------------------------------------------------------------------
  -- TEST 1 : PARENT APPROUVÉ AVEC PERMISSION ACADÉMIQUE AUTORISÉ
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_multi, 'role', 'authenticated')::text);

  v_result := public.get_parent_student_calendar(v_student_a);

  IF (v_result->>'student_id')::uuid <> v_student_a THEN
    RAISE EXCEPTION 'TEST 1 ÉCHEC : ID élève incorrect.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 2 : PARENT SANS LIEN REFUSÉ (42501)
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_no_link, 'role', 'authenticated')::text);

  BEGIN
    v_result := public.get_parent_student_calendar(v_student_a);
    RAISE EXCEPTION 'TEST 2 ÉCHEC : L’accès d’un parent sans lien aurait dû être refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 2 ÉCHEC : Code SQL: %', SQLSTATE; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 3 : LIEN PENDING REFUSÉ (42501)
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_multi, 'role', 'authenticated')::text);

  BEGIN
    v_result := public.get_parent_student_calendar(v_student_pending);
    RAISE EXCEPTION 'TEST 3 ÉCHEC : Un lien pending aurait dû être refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 3 ÉCHEC : Code SQL: %', SQLSTATE; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 4 : LIEN REJECTED REFUSÉ (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_result := public.get_parent_student_calendar(v_student_rejected);
    RAISE EXCEPTION 'TEST 4 ÉCHEC : Un lien rejected aurait dû être refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 4 ÉCHEC : Code SQL: %', SQLSTATE; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 5 : LIEN APPROVED MAIS CAN_VIEW_ACADEMIC = FALSE REFUSÉ (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_result := public.get_parent_student_calendar(v_student_no_acad);
    RAISE EXCEPTION 'TEST 5 ÉCHEC : L’absence de permission académique aurait dû être refusée.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 5 ÉCHEC : Code SQL: %', SQLSTATE; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 6 : ÉLÈVE D'UNE AUTRE ÉCOLE SANS LIEN REFUSÉ (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_result := public.get_parent_student_calendar(v_student_other_school);
    RAISE EXCEPTION 'TEST 6 ÉCHEC : Élève d’une autre école sans lien aurait dû être refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 6 ÉCHEC : Code SQL: %', SQLSTATE; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 7 : PARENT AUTORISÉ AVEC 2 ENFANTS DANS 2 ÉCOLES DIFFÉRENTES (AUCUNE FUITE INTER-ÉCOLES)
  ------------------------------------------------------------------------------
  -- Enfant A dans École A
  v_result := public.get_parent_student_calendar(v_student_a);
  IF (v_result->'summary'->>'total_events')::int <> 2 THEN
    RAISE EXCEPTION 'TEST 7 ÉCHEC : Mauvais nombre d’événements pour Enfant A (attendu 2, reçu %).', v_result->'summary'->>'total_events';
  END IF;
  IF (v_result->'events'->0->>'title') NOT LIKE '%École A%' THEN
    RAISE EXCEPTION 'TEST 7 ÉCHEC : Événement de l’école A mal nommé.';
  END IF;

  -- Enfant B dans École B
  v_result := public.get_parent_student_calendar(v_student_b);
  IF (v_result->'summary'->>'total_events')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 7 ÉCHEC : Mauvais nombre d’événements pour Enfant B (attendu 1, reçu %).', v_result->'summary'->>'total_events';
  END IF;
  IF (v_result->'events'->0->>'title') <> 'Fête de la Science École B' THEN
    RAISE EXCEPTION 'TEST 7 ÉCHEC : Fuite ou mauvais événement pour Enfant B.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 8 : ÉVÉNEMENT DRAFT INVISIBLE
  ------------------------------------------------------------------------------
  v_result := public.get_parent_student_calendar(v_student_a);
  IF v_result::text LIKE '%Brouillon École A%' THEN
    RAISE EXCEPTION 'TEST 8 ÉCHEC : Un événement draft est visible dans le calendrier parent !';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 9 : ÉVÉNEMENT PUBLISHED VISIBLE
  ------------------------------------------------------------------------------
  IF v_result::text NOT LIKE '%Rentrée École A%' THEN
    RAISE EXCEPTION 'TEST 9 ÉCHEC : Événement publié invisible.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 10 : UTILISATEUR NON AUTHENTIFIÉ REFUSÉ (42501)
  ------------------------------------------------------------------------------
  EXECUTE 'RESET "request.jwt.claims"';

  BEGIN
    v_result := public.get_parent_student_calendar(v_student_a);
    RAISE EXCEPTION 'TEST 10 ÉCHEC : Utilisateur non authentifié aurait dû être refusé.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 10 ÉCHEC : Code SQL: %', SQLSTATE; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 11 : ANNÉE SCOLAIRE VALIDE SANS ÉVÉNEMENT (RETOURNE TABLEAU VIDE [])
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_multi, 'role', 'authenticated')::text);

  v_result := public.get_parent_student_calendar(v_student_empty);
  IF (v_result->'summary'->>'total_events')::int <> 0 THEN
    RAISE EXCEPTION 'TEST 11 ÉCHEC : total_events devrait être 0 pour année sans événement.';
  END IF;
  IF jsonb_array_length(v_result->'events') <> 0 THEN
    RAISE EXCEPTION 'TEST 11 ÉCHEC : Tableau events devrait être vide [] pour année sans événement.';
  END IF;

  ------------------------------------------------------------------------------
  -- TEST 12 : INCOHÉRENCE ENTRE SCHOOL_EVENTS.SCHOOL_ID ET ACADEMIC_YEARS.SCHOOL_ID BLOQUÉE
  ------------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.school_events (school_id, academic_year_id, title, start_date, end_date, status)
    VALUES (v_school_a, v_year_b, 'Événement Incohérent', '2026-09-01 08:00:00+00', '2026-09-01 17:00:00+00', 'published');
    RAISE EXCEPTION 'TEST 12 ÉCHEC : Le trigger d’intégrité aurait dû bloquer l’incohérence multi-école.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 12 ÉCHEC : Code SQL non attendu: %', SQLSTATE; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 13 : DATES INVALIDES (END_DATE < START_DATE) BLOQUÉES PAR CONTRAINTE
  ------------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.school_events (school_id, academic_year_id, title, start_date, end_date, status)
    VALUES (v_school_a, v_year_a, 'Dates Invalides', '2026-09-10 08:00:00+00', '2026-09-01 08:00:00+00', 'published');
    RAISE EXCEPTION 'TEST 13 ÉCHEC : La contrainte de date aurait dû bloquer end_date < start_date.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '23514' THEN RAISE EXCEPTION 'TEST 13 ÉCHEC : Code SQL non attendu: %', SQLSTATE; END IF;
  END;

  RAISE NOTICE 'SUCCÈS : LES 13 TESTS SQL ET RLS DU LOT 2E-R SONT PASSÉS AVEC SUCCÈS !';
END;
$$;

SELECT 'TOUS LES 13 TESTS DU LOT 2E-R SONT VALIDÉS SUR BASE DISTANTE' AS test_status;

ROLLBACK;
