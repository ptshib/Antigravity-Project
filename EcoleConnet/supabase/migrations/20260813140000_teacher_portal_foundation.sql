-- Migration Phase 2D : Activation des Enseignants et Fondations du Portail Enseignant (Idempotente & Sécurisée)
-- Fichier : supabase/migrations/20260813140000_teacher_portal_foundation.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. FONCTION RPC DE SÉCURITÉ : BASCULER LE STATUT D'UN ENSEIGNANT (SUSPEND / REACTIVATE)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_teacher_status(
  p_teacher_id uuid,
  p_action text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_caller_role text;
  v_caller_school_id uuid;
  v_caller_active boolean;
  v_teacher_school_id uuid;
  v_teacher_profile_id uuid;
  v_old_account_status text;
  v_emp_status text;
  v_new_account_status text;
  v_is_active_flag boolean;
  v_school_status text;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié.';
  END IF;

  IF p_action NOT IN ('suspend', 'reactivate') THEN
    RAISE EXCEPTION 'Action non reconnue. Seules suspend et reactivate sont autorisées.';
  END IF;

  -- 1. Vérifier le compte de l'appelant directement sans helper récursif
  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_caller_uid;

  IF v_caller_role IS NULL OR NOT v_caller_active THEN
    RAISE EXCEPTION 'Profil de l’administrateur inactif ou introuvable.';
  END IF;

  IF v_caller_role <> 'super_admin' AND v_caller_role <> 'school_admin' THEN
    RAISE EXCEPTION 'Accès refusé : Seuls les administrateurs peuvent modifier le statut d’un enseignant.';
  END IF;

  -- 2. Charger et verrouiller la ligne teacher avec FOR UPDATE
  SELECT school_id, profile_id, account_status, employment_status
  INTO v_teacher_school_id, v_teacher_profile_id, v_old_account_status, v_emp_status
  FROM public.teachers
  WHERE id = p_teacher_id
  FOR UPDATE;

  IF v_teacher_school_id IS NULL THEN
    RAISE EXCEPTION 'Dossier enseignant introuvable.';
  END IF;

  -- Contrôle d'accès d'établissement
  IF v_caller_role = 'school_admin' AND v_caller_school_id <> v_teacher_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cet enseignant n’appartient pas à votre établissement.';
  END IF;

  -- Refus strict pour dossier sans profile_id ou terminated lors d'une réactivation
  IF p_action = 'reactivate' THEN
    IF v_teacher_profile_id IS NULL THEN
      RAISE EXCEPTION 'Réactivation refusée : Aucun profil Auth n’est associé à ce dossier enseignant.';
    END IF;

    IF v_emp_status = 'terminated' THEN
      RAISE EXCEPTION 'Réactivation refusée : Le contrat de cet enseignant est terminé (terminated).';
    END IF;

    -- Vérifier l'état de l'école EXCLUSIVEMENT pour la réactivation
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_teacher_school_id;
    IF v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Réactivation refusée : L’établissement scolaire est suspendu ou inactif.';
    END IF;
  END IF;

  IF p_action = 'suspend' THEN
    v_new_account_status := 'suspended';
    v_is_active_flag := false;
  ELSE
    v_new_account_status := 'active';
    v_is_active_flag := true;
  END IF;

  -- 3. Mise à jour public.teachers
  UPDATE public.teachers
  SET account_status = v_new_account_status,
      updated_at = now()
  WHERE id = p_teacher_id;

  -- 4. Mise à jour public.profiles si profil lié
  IF v_teacher_profile_id IS NOT NULL THEN
    UPDATE public.profiles
    SET is_active = v_is_active_flag,
        updated_at = now()
    WHERE id = v_teacher_profile_id;
  END IF;

  -- 5. Journal d'audit conforme aux colonnes exactes de school_audit_logs
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_teacher_school_id,
    v_caller_uid,
    'teacher_status_toggled',
    jsonb_build_object(
      'entity_type', 'teacher',
      'entity_id', p_teacher_id,
      'action', p_action,
      'old_account_status', v_old_account_status,
      'new_account_status', v_new_account_status,
      'is_active', v_is_active_flag
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 2. FONCTION RPC DE SÉCURITÉ : ACTIVATION DE COMPTE SUR DEFINITION DU MOT DE PASSE
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_teacher_on_password_set()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prof_role text;
  v_prof_school_id uuid;
  v_tch_id uuid;
  v_tch_school_id uuid;
  v_tch_account_status text;
  v_tch_emp_status text;
  v_school_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT role, school_id INTO v_prof_role, v_prof_school_id
  FROM public.profiles
  WHERE id = v_uid;

  IF v_prof_role IS NULL OR v_prof_role <> 'teacher' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un profil enseignant peut activer son compte.';
  END IF;

  SELECT id, school_id, account_status, employment_status
  INTO v_tch_id, v_tch_school_id, v_tch_account_status, v_tch_emp_status
  FROM public.teachers
  WHERE profile_id = v_uid
  FOR UPDATE;

  IF v_tch_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Aucun dossier enseignant associé à ce profil.';
  END IF;

  IF v_prof_school_id <> v_tch_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Incohérence d’établissement scolaire.';
  END IF;

  -- REFUS EXPLICITE des statuts 'suspended', 'active', 'not_invited', 'terminated'
  IF v_tch_account_status <> 'invited' THEN
    RAISE EXCEPTION 'Activation refusée : Transition non autorisée depuis le statut "%". Seul le statut "invited" peut être activé.', v_tch_account_status;
  END IF;

  IF v_tch_emp_status <> 'active' THEN
    RAISE EXCEPTION 'Activation refusée : Le contrat de l’enseignant n’est pas actif.';
  END IF;

  SELECT status INTO v_school_status FROM public.schools WHERE id = v_tch_school_id;
  IF v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Activation refusée : L’établissement scolaire est inactif ou suspendu.';
  END IF;

  UPDATE public.profiles
  SET is_active = true,
      updated_at = now()
  WHERE id = v_uid;

  UPDATE public.teachers
  SET account_status = 'active',
      updated_at = now()
  WHERE id = v_tch_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_tch_school_id,
    v_uid,
    'teacher_account_activated',
    jsonb_build_object(
      'entity_type', 'teacher',
      'entity_id', v_tch_id,
      'previous_account_status', 'invited',
      'new_account_status', 'active',
      'activated_at', now()
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 3. RPC DÉDIÉE SECURITY DEFINER DE RÉCUPÉRATION RESTREINTE DES ÉLÈVES
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_teacher_assigned_students()
RETURNS TABLE (
  student_id uuid,
  student_number text,
  first_name text,
  last_name text,
  class_id uuid,
  class_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prof_role text;
  v_prof_school_id uuid;
  v_prof_active boolean;
  v_tch_id uuid;
  v_tch_account_status text;
  v_tch_emp_status text;
  v_school_status text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT role, school_id, is_active INTO v_prof_role, v_prof_school_id, v_prof_active
  FROM public.profiles WHERE id = v_uid;

  IF NOT (v_prof_active AND v_prof_role = 'teacher') THEN
    RETURN;
  END IF;

  SELECT id, account_status, employment_status INTO v_tch_id, v_tch_account_status, v_tch_emp_status
  FROM public.teachers WHERE profile_id = v_uid;

  IF v_tch_id IS NULL OR v_tch_account_status <> 'active' OR v_tch_emp_status <> 'active' THEN
    RETURN;
  END IF;

  SELECT status INTO v_school_status FROM public.schools WHERE id = v_prof_school_id;
  IF v_school_status <> 'active' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    st.id AS student_id,
    st.student_number,
    st.first_name,
    st.last_name,
    c.id AS class_id,
    c.name AS class_name
  FROM public.students st
  JOIN public.student_enrollments se ON se.student_id = st.id
  JOIN public.classes c ON c.id = se.class_id
  JOIN public.teacher_class_assignments tca ON tca.class_id = c.id
  JOIN public.teachers t ON t.id = tca.teacher_id
  WHERE tca.teacher_id = v_tch_id
    AND tca.is_active = true
    AND tca.school_id = v_prof_school_id
    AND t.school_id = v_prof_school_id
    AND se.status = 'active'
    AND st.school_id = v_prof_school_id
    AND se.school_id = v_prof_school_id
    AND c.school_id = v_prof_school_id
    AND se.academic_year_id = c.academic_year_id
    AND tca.academic_year_id = c.academic_year_id
  ORDER BY c.name, st.last_name, st.first_name;
END;
$$;

--------------------------------------------------------------------------------
-- 4. RPC TRANSACTIONNELLE D'INVITATION ENSEIGNANT SECURISEE (REDUITE A 2 PARAMETRES)
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_teacher_invitation(uuid, uuid, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.process_teacher_invitation(uuid, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.process_teacher_invitation(uuid, uuid);

CREATE OR REPLACE FUNCTION public.process_teacher_invitation(
  p_teacher_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_caller_school_id uuid;
  v_caller_role text;
  v_caller_active boolean;
  v_caller_school_status text;
  v_teacher_school_id uuid;
  v_teacher_profile_id uuid;
  v_account_status text;
  v_emp_status text;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_phone text;
  v_auth_email text;
  v_existing_profile_id uuid;
  v_existing_teacher_id uuid;
  v_rows_affected integer;
BEGIN
  -- 1. Contrôle d'accès directement via auth.uid() (Point 1)
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_caller_uid;

  IF v_caller_role IS NULL OR NOT v_caller_active OR v_caller_role <> 'school_admin' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un administrateur d’établissement actif peut exécuter cette action.';
  END IF;

  SELECT status INTO v_caller_school_status FROM public.schools WHERE id = v_caller_school_id;
  IF v_caller_school_status IS NULL OR v_caller_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement scolaire est suspendu ou inactif.';
  END IF;

  -- 2. Charger et verrouiller le dossier teacher depuis la DB (FOR UPDATE) (Point 1.C)
  SELECT school_id, profile_id, account_status, employment_status, email, first_name, last_name, phone
  INTO v_teacher_school_id, v_teacher_profile_id, v_account_status, v_emp_status, v_email, v_first_name, v_last_name, v_phone
  FROM public.teachers
  WHERE id = p_teacher_id
  FOR UPDATE;

  IF v_teacher_school_id IS NULL THEN
    RAISE EXCEPTION 'Dossier enseignant introuvable.';
  END IF;

  IF v_teacher_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cet enseignant n’appartient pas à votre établissement.';
  END IF;

  -- Condition stricte pour première invitation (Point 1.D & Point 2)
  IF v_teacher_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation refusée : Un profil Auth est déjà associé à ce dossier enseignant.';
  END IF;

  IF v_account_status IS DISTINCT FROM 'not_invited' THEN
    RAISE EXCEPTION 'Invitation refusée : Le statut actuel "%" ne permet pas une première invitation (doit être "not_invited").', v_account_status;
  END IF;

  IF v_emp_status <> 'active' THEN
    RAISE EXCEPTION 'Invitation refusée : Le contrat de l’enseignant n’est pas actif.';
  END IF;

  IF v_email IS NULL OR trim(v_email) = '' THEN
    RAISE EXCEPTION 'Invitation refusée : Le dossier enseignant ne contient pas d’adresse email valide.';
  END IF;

  -- 3. Vérifications dans auth.users et public.profiles (Point 1.B & Point 1.E)
  -- A. Vérifier que p_user_id existe dans auth.users
  SELECT email INTO v_auth_email FROM auth.users WHERE id = p_user_id;
  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Invitation refusée : Utilisateur Auth % introuvable.', p_user_id;
  END IF;

  -- B. Vérifier que son email normalisé correspond exactement à l'email du dossier teachers
  IF trim(lower(v_auth_email)) <> trim(lower(v_email)) THEN
    RAISE EXCEPTION 'Invitation refusée : Incohérence d’adresse email entre Auth (%) et dossier enseignant (%).', v_auth_email, v_email;
  END IF;

  -- C. Vérifier qu'aucun profil n'existe déjà avec cet ID (Point 1.A)
  SELECT id INTO v_existing_profile_id FROM public.profiles WHERE id = p_user_id;
  IF v_existing_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation refusée : Un profil public.profiles existe déjà pour l’ID %.', p_user_id;
  END IF;

  -- D. Vérifier qu'aucun autre dossier teachers n'utilise cet ID (toutes écoles confondues) (Point 1.E)
  SELECT id INTO v_existing_teacher_id FROM public.teachers WHERE profile_id = p_user_id;
  IF v_existing_teacher_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation refusée : Le compte Auth % est déjà associé au dossier enseignant %.', p_user_id, v_existing_teacher_id;
  END IF;

  -- 4. INSERT strict dans public.profiles (SANS ON CONFLICT DO UPDATE et SANS colonne email qui n'existe pas sur profiles) (Point 1)
  INSERT INTO public.profiles (
    id,
    school_id,
    role,
    first_name,
    last_name,
    phone,
    is_active,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    v_caller_school_id,
    'teacher',
    trim(v_first_name),
    trim(v_last_name),
    v_phone,
    false,
    now(),
    now()
  );

  -- 5. Mettre à jour public.teachers de manière conditionnelle stricte (Point 1.D)
  UPDATE public.teachers
  SET profile_id = p_user_id,
      account_status = 'invited',
      updated_at = now()
  WHERE id = p_teacher_id
    AND profile_id IS NULL
    AND account_status = 'not_invited'
    AND employment_status = 'active';

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  IF v_rows_affected = 0 THEN
    RAISE EXCEPTION 'Mise à jour conditionnelle de l’enseignant a échoué (course de concurrence détectée).';
  END IF;

  -- 6. Journal d'audit conforme
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_caller_school_id,
    v_caller_uid,
    'teacher_invited',
    jsonb_build_object(
      'entity_type', 'teacher',
      'entity_id', p_teacher_id,
      'email', trim(lower(v_email)),
      'teacher_name', trim(v_first_name) || ' ' || trim(v_last_name),
      'invited_at', now()
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 5. SUPPRESSION EXPLICITE DE TOUTES LES ANCIENNES POLITIQUES ENSEIGNANT SUR STUDENTS
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Teacher read class students" ON public.students;
DROP POLICY IF EXISTS "Teacher view students in assigned classes" ON public.students;
DROP POLICY IF EXISTS "Teacher read assigned class students" ON public.students;
DROP POLICY IF EXISTS "Teacher read students" ON public.students;
DROP POLICY IF EXISTS "Teacher select students" ON public.students;

--------------------------------------------------------------------------------
-- 6. RÉVOCATION PRIVILÈGES PUBLIC ET ATTRIBUTION AUTHENTICATED
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.toggle_teacher_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_teacher_on_password_set() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_teacher_assigned_students() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_teacher_invitation(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.toggle_teacher_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_teacher_on_password_set() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_assigned_students() TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_teacher_invitation(uuid, uuid) TO authenticated;

COMMIT;
