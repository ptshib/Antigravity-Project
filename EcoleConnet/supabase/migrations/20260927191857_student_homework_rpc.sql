-- Migration : 20260927191857_student_homework_rpc.sql
-- Description : RPC sécurisée sans argument pour la consultation des devoirs et du cahier de texte par l'élève connecté (LOT 2K-T7-B)

-- 1. Durcissement des privilèges directs sur la table public.school_homework
REVOKE ALL ON TABLE public.school_homework FROM PUBLIC;
REVOKE ALL ON TABLE public.school_homework FROM anon;
REVOKE ALL ON TABLE public.school_homework FROM authenticated;

-- 2. Création de la RPC sans argument public.get_authenticated_student_homework()
CREATE OR REPLACE FUNCTION public.get_authenticated_student_homework()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_role text;
  v_profile_active boolean;
  v_profile_school_id uuid;

  v_student_id uuid;
  v_student_school_id uuid;
  v_student_status text;
  v_student_first_name text;
  v_student_last_name text;
  v_student_number text;

  v_school_status text;

  v_enrollment_id uuid;
  v_class_id uuid;
  v_academic_year_id uuid;
  v_enrollment_school_id uuid;
  v_class_name text;
  v_academic_year_name text;
  v_active_enrollment_count integer;
  v_current_ay_count integer;

  v_total integer := 0;
  v_open integer := 0;
  v_closed integer := 0;

  v_homework_json jsonb := '[]'::jsonb;
BEGIN
  -- A. Vérification de l'authentification
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.' USING ERRCODE = '42501';
  END IF;

  -- B. Vérification du rôle et du statut du profil
  SELECT role, school_id, is_active
  INTO v_profile_role, v_profile_school_id, v_profile_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_profile_role IS NULL OR v_profile_active IS NOT TRUE OR v_profile_role <> 'student' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un élève actif peut consulter ses devoirs.' USING ERRCODE = '42501';
  END IF;

  IF v_profile_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Établissement non renseigné dans le profil.' USING ERRCODE = '42501';
  END IF;

  -- C. Vérification du statut de l'établissement
  SELECT status
  INTO v_school_status
  FROM public.schools
  WHERE id = v_profile_school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.' USING ERRCODE = '42501';
  END IF;

  -- D. Vérification du dossier élève
  SELECT id, school_id, enrollment_status, first_name, last_name, student_number
  INTO v_student_id, v_student_school_id, v_student_status, v_student_first_name, v_student_last_name, v_student_number
  FROM public.students
  WHERE profile_id = v_uid;

  IF v_student_id IS NULL OR v_student_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : Dossier élève introuvable ou inactif.' USING ERRCODE = '42501';
  END IF;

  IF v_student_school_id <> v_profile_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Incohérence d’établissement (Cross-School Mismatch).' USING ERRCODE = '42501';
  END IF;

  -- E. Vérification de l'année académique courante unique
  SELECT COUNT(*)
  INTO v_current_ay_count
  FROM public.academic_years
  WHERE school_id = v_profile_school_id
    AND is_current = true;

  IF v_current_ay_count <> 1 THEN
    RAISE EXCEPTION 'Accès refusé : Aucune année académique courante valide.' USING ERRCODE = '42501';
  END IF;

  -- F. Vérification de l'inscription active unique (Mode Fail-Closed)
  SELECT COUNT(*)
  INTO v_active_enrollment_count
  FROM public.student_enrollments se
  JOIN public.classes c ON c.id = se.class_id
  JOIN public.academic_years ay ON ay.id = se.academic_year_id
  WHERE se.student_id = v_student_id
    AND se.school_id = v_profile_school_id
    AND se.status = 'active'
    AND c.is_active = true
    AND c.school_id = v_profile_school_id
    AND ay.is_current = true
    AND ay.school_id = v_profile_school_id;

  IF v_active_enrollment_count <> 1 THEN
    RAISE EXCEPTION 'Accès refusé : Inscription active introuvable ou multiple.' USING ERRCODE = '42501';
  END IF;

  -- G. Récupération des données d'inscription
  SELECT
    se.id,
    se.class_id,
    se.academic_year_id,
    se.school_id,
    c.name,
    ay.name
  INTO
    v_enrollment_id,
    v_class_id,
    v_academic_year_id,
    v_enrollment_school_id,
    v_class_name,
    v_academic_year_name
  FROM public.student_enrollments se
  JOIN public.classes c ON c.id = se.class_id
  JOIN public.academic_years ay ON ay.id = se.academic_year_id
  WHERE se.student_id = v_student_id
    AND se.school_id = v_profile_school_id
    AND se.status = 'active'
    AND c.is_active = true
    AND c.school_id = v_profile_school_id
    AND ay.is_current = true
    AND ay.school_id = v_profile_school_id
  LIMIT 1;

  IF v_enrollment_school_id <> v_profile_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Incohérence d’établissement sur l’inscription.' USING ERRCODE = '42501';
  END IF;

  -- H. Calcul des compteurs de synthèse
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE h.status = 'published' AND h.closed_at IS NULL),
    COUNT(*) FILTER (WHERE h.status = 'closed' OR h.closed_at IS NOT NULL)
  INTO v_total, v_open, v_closed
  FROM public.school_homework h
  WHERE h.school_id = v_profile_school_id
    AND h.class_id = v_class_id
    AND h.academic_year_id = v_academic_year_id
    AND h.status IN ('published', 'closed');

  -- I. Agrégation des devoirs au format JSONB
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'title', h.title,
        'instructions', COALESCE(h.instructions, ''),
        'subject_name', COALESCE(s.name, 'Matière non renseignée'),
        'teacher_name', COALESCE(NULLIF(pg_catalog.btrim(COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '')), ''), 'Enseignant non renseigné'),
        'assigned_on', to_char(h.assigned_on, 'YYYY-MM-DD'),
        'due_at', to_char(h.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'estimated_minutes', h.estimated_minutes,
        'is_closed', CASE WHEN h.status = 'closed' OR h.closed_at IS NOT NULL THEN true ELSE false END
      )
      ORDER BY
        (CASE WHEN h.status = 'closed' OR h.closed_at IS NOT NULL THEN 1 ELSE 0 END) ASC,
        h.due_at ASC,
        h.assigned_on ASC,
        h.title ASC
    ),
    '[]'::jsonb
  )
  INTO v_homework_json
  FROM public.school_homework h
  LEFT JOIN public.subjects s ON s.id = h.subject_id
  LEFT JOIN public.teachers t ON t.id = h.teacher_id
  WHERE h.school_id = v_profile_school_id
    AND h.class_id = v_class_id
    AND h.academic_year_id = v_academic_year_id
    AND h.status IN ('published', 'closed');

  -- J. Construction et retour du document JSONB final
  RETURN jsonb_build_object(
    'student_name', COALESCE(NULLIF(pg_catalog.btrim(COALESCE(v_student_first_name, '') || ' ' || COALESCE(v_student_last_name, '')), ''), 'Élève'),
    'student_number', COALESCE(v_student_number, ''),
    'class_name', COALESCE(v_class_name, ''),
    'academic_year_name', COALESCE(v_academic_year_name, ''),
    'summary', jsonb_build_object(
      'total', v_total,
      'open', v_open,
      'closed', v_closed
    ),
    'homework', v_homework_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_authenticated_student_homework() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authenticated_student_homework() TO authenticated;
ALTER FUNCTION public.get_authenticated_student_homework() OWNER TO postgres;

-- 3. Révocation de l'accès public à la RPC legacy public.get_homework_for_student(uuid)
REVOKE ALL ON FUNCTION public.get_homework_for_student(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_homework_for_student(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_homework_for_student(uuid) FROM authenticated;
