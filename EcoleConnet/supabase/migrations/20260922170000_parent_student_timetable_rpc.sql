-- Migration Lot 2C : Table school_timetables, Triggers d'intégrité & RPC Sécurisée get_parent_student_timetable
-- Fichier : supabase/migrations/20260922170000_parent_student_timetable_rpc.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. CRÉATION DE LA TABLE PUBLIC.SCHOOL_TIMETABLES
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_timetables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
  room TEXT,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Lundi, ..., 7=Dimanche
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_timetable_start_before_end CHECK (start_time < end_time)
);

-- Index d'optimisation de recherche
CREATE INDEX IF NOT EXISTS idx_timetables_school_class_day 
  ON public.school_timetables (school_id, class_id, day_of_week);

-- Index unique anti-doublon pour créneau actif identique
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_timetable_exact_slot
  ON public.school_timetables (school_id, academic_year_id, class_id, day_of_week, start_time, end_time, subject_id)
  WHERE (status = 'active');

--------------------------------------------------------------------------------
-- 2. RLS & PRIVILÈGES SUR SCHOOL_TIMETABLES
--------------------------------------------------------------------------------
ALTER TABLE public.school_timetables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_timetables FORCE ROW LEVEL SECURITY;

-- Révocation stricte des privilèges directs pour la sécurité maximale
REVOKE ALL ON TABLE public.school_timetables FROM PUBLIC;
REVOKE ALL ON TABLE public.school_timetables FROM anon;
REVOKE ALL ON TABLE public.school_timetables FROM authenticated;

--------------------------------------------------------------------------------
-- 3. TRIGGER D'INTÉGRITÉ ISOLATION MULTI-ÉCOLES ET MULTI-ANNÉES
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_school_timetable_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_year_school_id UUID;
  v_cls_school_id UUID;
  v_cls_year_id UUID;
  v_sbj_school_id UUID;
  v_tch_school_id UUID;
BEGIN
  -- A. Vérifier que l'année scolaire appartient à l'école
  SELECT school_id INTO v_year_school_id
  FROM public.academic_years
  WHERE id = NEW.academic_year_id;

  IF v_year_school_id IS NULL OR v_year_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id
      USING ERRCODE = '42501';
  END IF;

  -- B. Vérifier que la classe appartient à l'école et à la même année scolaire
  SELECT school_id, academic_year_id INTO v_cls_school_id, v_cls_year_id
  FROM public.classes
  WHERE id = NEW.class_id;

  IF v_cls_school_id IS NULL OR v_cls_school_id <> NEW.school_id OR v_cls_year_id <> NEW.academic_year_id THEN
    RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : La classe (%) n’appartient pas à la même école ou année scolaire.', NEW.class_id
      USING ERRCODE = '42501';
  END IF;

  -- C. Vérifier que la matière appartient à l'école
  SELECT school_id INTO v_sbj_school_id
  FROM public.subjects
  WHERE id = NEW.subject_id;

  IF v_sbj_school_id IS NULL OR v_sbj_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : La matière (%) n’appartient pas à l’établissement.', NEW.subject_id
      USING ERRCODE = '42501';
  END IF;

  -- D. Si un enseignant est spécifié, vérifier qu'il appartient à l'école
  IF NEW.teacher_id IS NOT NULL THEN
    SELECT school_id INTO v_tch_school_id
    FROM public.teachers
    WHERE id = NEW.teacher_id;

    IF v_tch_school_id IS NULL OR v_tch_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : L’enseignant (%) n’appartient pas à l’établissement.', NEW.teacher_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_school_timetable_integrity ON public.school_timetables;
CREATE TRIGGER trg_check_school_timetable_integrity
  BEFORE INSERT OR UPDATE ON public.school_timetables
  FOR EACH ROW
  EXECUTE FUNCTION public.check_school_timetable_integrity();

ALTER TABLE public.school_timetables ENABLE ALWAYS TRIGGER trg_check_school_timetable_integrity;

--------------------------------------------------------------------------------
-- 4. TRIGGER DE MISE À JOUR AUTOMATIQUE DE UPDATED_AT
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_school_timetables_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_school_timetables_updated_at ON public.school_timetables;
CREATE TRIGGER trg_school_timetables_updated_at
  BEFORE UPDATE ON public.school_timetables
  FOR EACH ROW
  EXECUTE FUNCTION public.update_school_timetables_updated_at();

ALTER TABLE public.school_timetables ENABLE ALWAYS TRIGGER trg_school_timetables_updated_at;

--------------------------------------------------------------------------------
-- 5. RPC : PUBLIC.GET_PARENT_STUDENT_TIMETABLE
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_parent_student_timetable(
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
  v_caller_school_id UUID;
  v_student RECORD;
  v_slots JSONB;
  v_total_slots INT := 0;
  v_total_days INT := 0;
BEGIN
  -- 1. Authentification & Contrôle de Rôle Parent Actif sur Établissement Actif
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id
  INTO v_caller_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role = 'parent'
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un compte parent actif d’un établissement actif peut consulter ce dossier.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Contrôle de la Relation Parent Validée et Permission can_view_academic
  IF NOT EXISTS (
    SELECT 1
    FROM public.parent_student_links psl
    JOIN public.students st ON st.id = psl.student_id
    WHERE psl.parent_profile_id = v_caller_id
      AND psl.student_id = p_student_id
      AND psl.status = 'approved'
      AND psl.can_view_academic = true
      AND psl.school_id = v_caller_school_id
      AND st.school_id = v_caller_school_id
  ) THEN
    RAISE EXCEPTION 'REJET ACCÈS : La consultation de l’emploi du temps pour cet élève n’est pas autorisée sur votre compte parent.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Métadonnées de l'Élève & Classe Active
  SELECT 
    st.id,
    st.student_number,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name,
    se.class_id,
    c.name AS class_name,
    se.academic_year_id,
    ay.name AS academic_year_name
  INTO v_student
  FROM public.students st
  JOIN public.student_enrollments se ON se.student_id = st.id
    AND se.school_id = st.school_id
    AND se.status = 'active'
  JOIN public.classes c ON c.id = se.class_id AND c.school_id = st.school_id
  LEFT JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = st.school_id
  WHERE st.id = p_student_id
    AND st.school_id = v_caller_school_id
  ORDER BY se.enrolled_on DESC, se.created_at DESC
  LIMIT 1;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’élève sélectionné ne possède aucune inscription active dans cet établissement.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Métriques de créneaux d'emploi du temps (uniquement status = 'active')
  SELECT 
    pg_catalog.count(t.id),
    pg_catalog.count(DISTINCT t.day_of_week)
  INTO 
    v_total_slots,
    v_total_days
  FROM public.school_timetables t
  WHERE t.school_id = v_caller_school_id
    AND t.class_id = v_student.class_id
    AND t.status = 'active'
    AND (t.academic_year_id IS NULL OR t.academic_year_id = v_student.academic_year_id);

  -- 5. Liste des créneaux d'emploi du temps triés par jour (1->7) puis heure de début
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', t.id,
      'day_of_week', t.day_of_week,
      'day_name', CASE t.day_of_week
        WHEN 1 THEN 'Lundi'
        WHEN 2 THEN 'Mardi'
        WHEN 3 THEN 'Mercredi'
        WHEN 4 THEN 'Jeudi'
        WHEN 5 THEN 'Vendredi'
        WHEN 6 THEN 'Samedi'
        WHEN 7 THEN 'Dimanche'
        ELSE 'Jour'
      END,
      'subject_id', t.subject_id,
      'subject_name', s.name,
      'teacher_id', t.teacher_id,
      'teacher_name', COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', tech.first_name, tech.last_name)), ''), 'Enseignant non assigné'),
      'room', COALESCE(NULLIF(pg_catalog.btrim(t.room), ''), 'Salle non spécifiée'),
      'start_time', pg_catalog.to_char(t.start_time, 'HH24:MI'),
      'end_time', pg_catalog.to_char(t.end_time, 'HH24:MI'),
      'status', t.status
    )
  ), pg_catalog.jsonb_build_array())
  INTO v_slots
  FROM (
    SELECT t2.*
    FROM public.school_timetables t2
    WHERE t2.school_id = v_caller_school_id
      AND t2.class_id = v_student.class_id
      AND t2.status = 'active'
      AND (t2.academic_year_id IS NULL OR t2.academic_year_id = v_student.academic_year_id)
    ORDER BY t2.day_of_week ASC, t2.start_time ASC
  ) t
  JOIN public.subjects s ON s.id = t.subject_id AND s.school_id = v_caller_school_id
  LEFT JOIN public.teachers tech ON tech.id = t.teacher_id AND tech.school_id = v_caller_school_id;

  -- 6. Construction de la réponse JSONB finale
  RETURN pg_catalog.jsonb_build_object(
    'student_id', v_student.id,
    'student_number', v_student.student_number,
    'student_name', v_student.student_full_name,
    'class_id', v_student.class_id,
    'class_name', v_student.class_name,
    'academic_year_id', v_student.academic_year_id,
    'academic_year_name', COALESCE(v_student.academic_year_name, ''),
    'summary', pg_catalog.jsonb_build_object(
      'total_slots', v_total_slots,
      'total_days', v_total_days
    ),
    'slots', COALESCE(v_slots, pg_catalog.jsonb_build_array())
  );
END;
$$;

-- Sécurisation des privilèges RPC
REVOKE ALL ON FUNCTION public.get_parent_student_timetable(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_parent_student_timetable(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_timetable(UUID) TO authenticated;

COMMIT;
