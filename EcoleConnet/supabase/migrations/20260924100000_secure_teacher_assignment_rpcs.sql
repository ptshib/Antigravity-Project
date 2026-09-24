-- Migration : 20260924100000_secure_teacher_assignment_rpcs.sql
-- Lot 2I-P2-V2 : RPCs d'affectation sécurisées Enseignant <-> Classe avec résolution stricte sur teachers.id uniquement

DROP FUNCTION IF EXISTS public.assign_class_homeroom_teacher(UUID, UUID);
DROP FUNCTION IF EXISTS public.assign_class_homeroom_teacher(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.assign_teacher_subject(UUID, UUID, UUID);

-- 1. RPC : Affecter un enseignant titulaire à une classe primaire
CREATE OR REPLACE FUNCTION public.assign_class_homeroom_teacher(
  p_class_id UUID,
  p_teacher_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school_status TEXT;
  v_class_school_id UUID;
  v_class_pedagogical_mode TEXT;
  v_teacher_school_id UUID;
  v_teacher_profile_id UUID;
  v_tch_acc_status TEXT;
  v_tch_emp_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles p WHERE p.id = v_uid;

  IF v_caller_active IS NOT TRUE OR v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seul un administrateur peut affecter un titulaire de classe.' USING ERRCODE = '42501';
  END IF;

  SELECT c.school_id, coalesce(c.pedagogical_mode, 'secondary_subjects')
  INTO v_class_school_id, v_class_pedagogical_mode
  FROM public.classes c
  WHERE c.id = p_class_id;

  IF v_class_school_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' AND v_class_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cette classe appartient à un autre établissement.' USING ERRCODE = '42501';
  END IF;

  SELECT sc.status INTO v_school_status FROM public.schools sc WHERE sc.id = v_class_school_id;
  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.' USING ERRCODE = '42501';
  END IF;

  IF v_class_pedagogical_mode <> 'primary_homeroom' THEN
    RAISE EXCEPTION 'Affectation refusée : Cette classe est en mode Secondaire par matière, pas en mode Titulaire Primaire.';
  END IF;

  -- Résolution stricte et univoque sur teachers.id uniquement (pas de fallback profile_id)
  SELECT t.school_id, t.profile_id, t.account_status, t.employment_status
  INTO v_teacher_school_id, v_teacher_profile_id, v_tch_acc_status, v_tch_emp_status
  FROM public.teachers t
  WHERE t.id = p_teacher_id;

  IF v_teacher_school_id IS NULL THEN
    RAISE EXCEPTION 'Fiche enseignant introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' AND v_teacher_school_id <> v_class_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cet enseignant appartient à un autre établissement.' USING ERRCODE = '42501';
  END IF;

  IF v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
    RAISE EXCEPTION 'Affectation refusée : Le compte enseignant n’est pas actif.';
  END IF;

  IF v_teacher_profile_id IS NULL THEN
    RAISE EXCEPTION 'Affectation refusée : Aucun profil utilisateur associé à cet enseignant.';
  END IF;

  -- Pour le mode Primaire, enregistrer le profile_id dérivé côté serveur dans classes.homeroom_teacher_id
  UPDATE public.classes
  SET homeroom_teacher_id = v_teacher_profile_id,
      updated_at = now()
  WHERE id = p_class_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_class_school_id,
    v_uid,
    'homeroom_teacher_assigned',
    jsonb_build_object(
      'class_id', p_class_id,
      'teacher_id', p_teacher_id,
      'teacher_profile_id', v_teacher_profile_id,
      'pedagogical_mode', v_class_pedagogical_mode
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_class_homeroom_teacher(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_class_homeroom_teacher(UUID, UUID) TO authenticated;
ALTER FUNCTION public.assign_class_homeroom_teacher(UUID, UUID) OWNER TO postgres;


-- 2. RPC : Affecter un enseignant à une classe et matière (mode secondaire)
CREATE OR REPLACE FUNCTION public.assign_teacher_subject(
  p_class_id UUID,
  p_teacher_id UUID,
  p_subject_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school_status TEXT;
  v_class_school_id UUID;
  v_academic_year_id UUID;
  v_class_pedagogical_mode TEXT;
  v_teacher_school_id UUID;
  v_teacher_profile_id UUID;
  v_tch_acc_status TEXT;
  v_tch_emp_status TEXT;
  v_subject_school_id UUID;
  v_subject_name TEXT;
  v_subject_active BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles p WHERE p.id = v_uid;

  IF v_caller_active IS NOT TRUE OR v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seul un administrateur peut créer une affectation enseignant-matière.' USING ERRCODE = '42501';
  END IF;

  SELECT c.school_id, c.academic_year_id, coalesce(c.pedagogical_mode, 'secondary_subjects')
  INTO v_class_school_id, v_academic_year_id, v_class_pedagogical_mode
  FROM public.classes c
  WHERE c.id = p_class_id;

  IF v_class_school_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' AND v_class_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cette classe appartient à un autre établissement.' USING ERRCODE = '42501';
  END IF;

  SELECT sc.status INTO v_school_status FROM public.schools sc WHERE sc.id = v_class_school_id;
  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est suspendu ou inactif.' USING ERRCODE = '42501';
  END IF;

  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'Matière obligatoire pour une affectation en mode secondaire par matière.';
  END IF;

  -- Résolution stricte et univoque sur teachers.id uniquement (pas de fallback profile_id)
  SELECT t.school_id, t.profile_id, t.account_status, t.employment_status
  INTO v_teacher_school_id, v_teacher_profile_id, v_tch_acc_status, v_tch_emp_status
  FROM public.teachers t
  WHERE t.id = p_teacher_id;

  IF v_teacher_school_id IS NULL THEN
    RAISE EXCEPTION 'Fiche enseignant introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' AND v_teacher_school_id <> v_class_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cet enseignant appartient à un autre établissement.' USING ERRCODE = '42501';
  END IF;

  IF v_tch_acc_status <> 'active' OR v_tch_emp_status <> 'active' THEN
    RAISE EXCEPTION 'Affectation refusée : Le compte enseignant n’est pas actif.';
  END IF;

  SELECT s.school_id, s.name, s.is_active
  INTO v_subject_school_id, v_subject_name, v_subject_active
  FROM public.subjects s
  WHERE s.id = p_subject_id;

  IF v_subject_school_id IS NULL THEN
    RAISE EXCEPTION 'Matière introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' AND v_subject_school_id <> v_class_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cette matière appartient à un autre établissement.' USING ERRCODE = '42501';
  END IF;

  IF v_subject_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Affectation refusée : La matière est inactive.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.teacher_class_assignments
    WHERE school_id = v_class_school_id
      AND teacher_id = p_teacher_id
      AND class_id = p_class_id
      AND subject_id = p_subject_id
      AND academic_year_id = v_academic_year_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Cette affectation active existe déjà pour cet enseignant, cette classe et cette matière.';
  END IF;

  -- Pour le mode Secondaire, enregistrer p_teacher_id (teachers.id) dans teacher_id et v_teacher_profile_id dans teacher_profile_id
  INSERT INTO public.teacher_class_assignments (
    school_id,
    academic_year_id,
    teacher_id,
    teacher_profile_id,
    class_id,
    subject_id,
    subject_name,
    is_active
  ) VALUES (
    v_class_school_id,
    v_academic_year_id,
    p_teacher_id,
    v_teacher_profile_id,
    p_class_id,
    p_subject_id,
    v_subject_name,
    true
  );

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_class_school_id,
    v_uid,
    'teacher_subject_assigned',
    jsonb_build_object(
      'class_id', p_class_id,
      'teacher_id', p_teacher_id,
      'teacher_profile_id', v_teacher_profile_id,
      'subject_id', p_subject_id,
      'subject_name', v_subject_name,
      'pedagogical_mode', v_class_pedagogical_mode
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_teacher_subject(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_teacher_subject(UUID, UUID, UUID) TO authenticated;
ALTER FUNCTION public.assign_teacher_subject(UUID, UUID, UUID) OWNER TO postgres;
