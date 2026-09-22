-- Migration Lot 2E-R : Table public.school_events, RPC get_parent_student_calendar et remédiation multi-écoles
-- Fichier : supabase/migrations/20260922180000_parent_school_calendar_rpc.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. CRÉATION DE LA TABLE PUBLIC.SCHOOL_EVENTS
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

-- Index d'optimisation
CREATE INDEX IF NOT EXISTS idx_school_events_lookup
  ON public.school_events (school_id, academic_year_id, status, start_date);

--------------------------------------------------------------------------------
-- 2. RLS & PRIVILÈGES STRICTS SUR SCHOOL_EVENTS
--------------------------------------------------------------------------------
ALTER TABLE public.school_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_events FROM PUBLIC;
REVOKE ALL ON TABLE public.school_events FROM anon;
REVOKE ALL ON TABLE public.school_events FROM authenticated;

--------------------------------------------------------------------------------
-- 3. REMÉDIATION MULTI-ÉCOLES SUR CHECK_PARENT_STUDENT_SCHOOL_MATCH
-- Permet à un parent d'avoir des enfants dans des établissements différents sans blocage
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- 4. TRIGGER D'INTÉGRITÉ MULTI-ÉCOLES ET MULTI-ANNÉES SUR SCHOOL_EVENTS
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- 5. RPC PARENT : GET_PARENT_STUDENT_CALENDAR (SUPPORT MULTI-ÉCOLES)
--------------------------------------------------------------------------------
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

  -- C. Résolution de l'année scolaire (année de la classe ou année courante de l'école)
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

--------------------------------------------------------------------------------
-- 6. PRIVILÈGES RPC
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_parent_student_calendar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_calendar(UUID) TO authenticated;

COMMIT;
