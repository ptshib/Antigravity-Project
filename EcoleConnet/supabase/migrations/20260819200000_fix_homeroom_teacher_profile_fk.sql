-- ============================================================================
-- Migration : Correction Canonique de la Gestion du Professeur Titulaire (FK profiles.id)
-- Fichier : supabase/migrations/20260819200000_fix_homeroom_teacher_profile_fk.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. NETTOYAGE DES ANCIENNES SIGNATURES RPC
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.assign_class_homeroom_teacher(UUID, UUID);
DROP FUNCTION IF EXISTS public.assign_class_homeroom_teacher(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.remove_class_homeroom_teacher(UUID);
DROP FUNCTION IF EXISTS public.remove_class_homeroom_teacher(UUID, UUID);

--------------------------------------------------------------------------------
-- 2. RPC : assign_class_homeroom_teacher (Enregistre exclusivement teachers.profile_id)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_class_homeroom_teacher(
  p_class_id UUID,
  p_teacher_id UUID,
  p_expected_current_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_active BOOLEAN;
  v_caller_school_id UUID;
  
  v_class RECORD;
  v_teacher RECORD;
  v_conflicting_class RECORD;
  v_updated_rows INTEGER;
  v_action_type TEXT;

  -- Variables scalaires pour l'ancien titulaire (initialisées à NULL)
  v_old_teacher_id UUID := NULL;
  v_old_teacher_profile_id UUID := NULL;
  v_old_teacher_employee_number TEXT := NULL;
  v_old_teacher_first_name TEXT := NULL;
  v_old_teacher_last_name TEXT := NULL;
BEGIN
  -- A. Authentification & Profil Appelant (Strictement school_admin actif)
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié : Session requise.' USING ERRCODE = 'P0001';
  END IF;

  SELECT role, school_id, is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'Profil non rattaché à un établissement.' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Compte administrateur inactif.' USING ERRCODE = 'P0003';
  END IF;

  IF v_caller_role IS DISTINCT FROM 'school_admin' THEN
    RAISE EXCEPTION 'Accès refusé : Seul l’administrateur de l’établissement (school_admin) peut affecter un professeur titulaire.' USING ERRCODE = 'P0004';
  END IF;

  -- B. Validation des Paramètres Obligatoires
  IF p_class_id IS NULL THEN
    RAISE EXCEPTION 'L’identifiant de la classe est obligatoire.' USING ERRCODE = 'P0005';
  END IF;

  IF p_teacher_id IS NULL THEN
    RAISE EXCEPTION 'L’identifiant de l’enseignant est obligatoire.' USING ERRCODE = 'P0006';
  END IF;

  -- C. Verrouillage de la Classe Cible (FOR UPDATE)
  SELECT id, school_id, academic_year_id, name, education_cycle, homeroom_teacher_id, is_active
  INTO v_class
  FROM public.classes
  WHERE id = p_class_id
  FOR UPDATE;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.' USING ERRCODE = 'P0007';
  END IF;

  IF v_class.school_id IS DISTINCT FROM v_caller_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cette classe n’appartient pas à votre établissement.' USING ERRCODE = 'P0008';
  END IF;

  IF v_class.academic_year_id IS NULL THEN
    RAISE EXCEPTION 'Intégrité : La classe sélectionnée n’est rattachée à aucune année scolaire valide.' USING ERRCODE = 'P0009';
  END IF;

  IF v_class.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Action impossible : Cette classe est inactive, désactivée ou archivée.' USING ERRCODE = 'P0010';
  END IF;

  -- D. Contrôle de Concurrence Optimiste (Comparaison avec profiles.id actuel)
  IF v_class.homeroom_teacher_id IS NULL THEN
    IF p_expected_current_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conflit de concurrence : La classe "%" n’a plus de titulaire affecté. Veuillez rafraîchir la page.',
        v_class.name
        USING ERRCODE = 'P0015';
    END IF;
    v_action_type := 'class_homeroom_teacher_assigned';
  ELSE
    IF p_expected_current_profile_id IS DISTINCT FROM v_class.homeroom_teacher_id THEN
      RAISE EXCEPTION 'Conflit de concurrence : Le titulaire de la classe "%" a été modifié par un autre administrateur. Veuillez recharger les données.',
        v_class.name
        USING ERRCODE = 'P0015';
    END IF;
    v_action_type := 'class_homeroom_teacher_replaced';
  END IF;

  -- E. Contrôle Rigoureux de l'Enseignant Cible & son Profil (FK profiles.id)
  SELECT t.id, t.school_id, t.profile_id, t.employee_number, t.account_status, t.employment_status,
         p.first_name, p.last_name, p.role AS profile_role, p.is_active AS profile_is_active, p.school_id AS profile_school_id
  INTO v_teacher
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.id = p_teacher_id;

  IF v_teacher.id IS NULL OR v_teacher.profile_id IS NULL THEN
    RAISE EXCEPTION 'Dossier enseignant introuvable ou compte utilisateur non activé (profile_id manquant).' USING ERRCODE = 'P0011';
  END IF;

  IF v_teacher.school_id IS DISTINCT FROM v_caller_school_id OR v_teacher.profile_school_id IS DISTINCT FROM v_caller_school_id THEN
    RAISE EXCEPTION 'Sécurité : Cet enseignant n’appartient pas au même établissement que la classe.' USING ERRCODE = 'P0012';
  END IF;

  IF v_teacher.profile_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Rôle invalide : Le profil utilisateur lié à cet enseignant n’a pas le rôle "teacher".' USING ERRCODE = 'P0013';
  END IF;

  IF v_teacher.profile_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Le compte utilisateur de cet enseignant est inactif.' USING ERRCODE = 'P0014';
  END IF;

  IF v_teacher.account_status IS DISTINCT FROM 'active' OR v_teacher.employment_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Cet enseignant ne peut pas être nommé titulaire car son statut n’est pas actif (compte: %, emploi: %).',
      v_teacher.account_status, v_teacher.employment_status USING ERRCODE = 'P0016';
  END IF;

  -- F. Verrouillage Concurrence Titularisation (Advisory Xact Lock sur profiles.id)
  PERFORM pg_advisory_xact_lock(hashtext(v_caller_school_id::text || ':' || v_class.academic_year_id::text || ':' || v_teacher.profile_id::text));

  -- G. Règle Métier : Titularisation Unique par Année Scolaire (Comparaison sur profiles.id)
  SELECT id, name
  INTO v_conflicting_class
  FROM public.classes
  WHERE school_id = v_caller_school_id
    AND academic_year_id = v_class.academic_year_id
    AND homeroom_teacher_id = v_teacher.profile_id
    AND id <> p_class_id
  LIMIT 1;

  IF v_conflicting_class.id IS NOT NULL THEN
    RAISE EXCEPTION 'L’enseignant % % est déjà professeur titulaire de la classe "%". Veuillez d’abord retirer sa titularisation précédente avant une nouvelle affectation.',
      v_teacher.first_name, v_teacher.last_name, v_conflicting_class.name
      USING ERRCODE = 'P0017';
  END IF;

  -- H. Chargement Sécurisé des Variables Scalaires de l'Ancien Titulaire si Remplacement
  IF v_class.homeroom_teacher_id IS NOT NULL THEN
    SELECT
      t.id,
      t.profile_id,
      t.employee_number,
      p.first_name,
      p.last_name
    INTO
      v_old_teacher_id,
      v_old_teacher_profile_id,
      v_old_teacher_employee_number,
      v_old_teacher_first_name,
      v_old_teacher_last_name
    FROM public.teachers t
    JOIN public.profiles p ON p.id = t.profile_id
    WHERE t.profile_id = v_class.homeroom_teacher_id
      AND t.school_id = v_caller_school_id;
  END IF;

  -- I. Mise à Jour Atomique de la Classe : Enregistrement Exclusif de profiles.id
  UPDATE public.classes
  SET
    homeroom_teacher_id = v_teacher.profile_id,
    updated_at = NOW()
  WHERE id = p_class_id AND school_id = v_caller_school_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION 'Échec de l’affectation du titulaire (lignes affectées: %).', v_updated_rows USING ERRCODE = 'P0018';
  END IF;

  -- J. Journalisation Audit Sécurisée (Variables scalaires, sans risque de record non assigné)
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_caller_school_id,
    v_caller_id,
    v_action_type,
    jsonb_build_object(
      'class_id', v_class.id,
      'class_name', v_class.name,
      'academic_year_id', v_class.academic_year_id,
      'previous_homeroom_profile_id', v_class.homeroom_teacher_id,
      'previous_teacher_id', v_old_teacher_id,
      'previous_teacher_name', CASE WHEN v_old_teacher_id IS NOT NULL THEN TRIM(COALESCE(v_old_teacher_first_name, '') || ' ' || COALESCE(v_old_teacher_last_name, '')) ELSE NULL END,
      'previous_teacher_employee_number', v_old_teacher_employee_number,
      'new_homeroom_profile_id', v_teacher.profile_id,
      'new_teacher_id', v_teacher.id,
      'new_teacher_name', TRIM(COALESCE(v_teacher.first_name, '') || ' ' || COALESCE(v_teacher.last_name, '')),
      'new_teacher_employee_number', v_teacher.employee_number,
      'performed_at', NOW()
    )
  );

  -- K. Retour JSONB Confirmé
  RETURN jsonb_build_object(
    'success', true,
    'class_id', v_class.id,
    'class_name', v_class.name,
    'homeroom_profile_id', v_teacher.profile_id,
    'teacher_id', v_teacher.id,
    'teacher_profile_id', v_teacher.profile_id,
    'teacher_name', TRIM(COALESCE(v_teacher.first_name, '') || ' ' || COALESCE(v_teacher.last_name, '')),
    'employee_number', v_teacher.employee_number,
    'action', v_action_type,
    'assigned_at', NOW()
  );
END;
$$;

--------------------------------------------------------------------------------
-- 3. RPC : remove_class_homeroom_teacher (FK profiles.id, variables scalaires)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.remove_class_homeroom_teacher(
  p_class_id UUID,
  p_expected_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_active BOOLEAN;
  v_caller_school_id UUID;
  
  v_class RECORD;
  v_updated_rows INTEGER;

  -- Variables scalaires pour l'enseignant retiré (initialisées à NULL)
  v_old_teacher_id UUID := NULL;
  v_old_teacher_profile_id UUID := NULL;
  v_old_teacher_employee_number TEXT := NULL;
  v_old_teacher_first_name TEXT := NULL;
  v_old_teacher_last_name TEXT := NULL;
BEGIN
  -- A. Authentification & Profil Appelant (Strictement school_admin actif)
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié : Session requise.' USING ERRCODE = 'P0001';
  END IF;

  SELECT role, school_id, is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'Profil non rattaché à un établissement.' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Compte administrateur inactif.' USING ERRCODE = 'P0003';
  END IF;

  IF v_caller_role IS DISTINCT FROM 'school_admin' THEN
    RAISE EXCEPTION 'Accès refusé : Seul l’administrateur de l’établissement peut retirer un professeur titulaire.' USING ERRCODE = 'P0004';
  END IF;

  -- B. Paramètres Obligatoires
  IF p_class_id IS NULL THEN
    RAISE EXCEPTION 'L’identifiant de la classe est obligatoire.' USING ERRCODE = 'P0005';
  END IF;

  IF p_expected_profile_id IS NULL THEN
    RAISE EXCEPTION 'L’identifiant du profil du titulaire attendu est obligatoire pour confirmer le retrait.' USING ERRCODE = 'P0006';
  END IF;

  -- C. Verrouillage de la Classe Cible (FOR UPDATE)
  SELECT id, school_id, academic_year_id, name, education_cycle, homeroom_teacher_id, is_active
  INTO v_class
  FROM public.classes
  WHERE id = p_class_id
  FOR UPDATE;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.' USING ERRCODE = 'P0007';
  END IF;

  IF v_class.school_id IS DISTINCT FROM v_caller_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Cette classe n’appartient pas à votre établissement.' USING ERRCODE = 'P0008';
  END IF;

  IF v_class.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Action impossible : Cette classe est inactive, désactivée ou archivée.' USING ERRCODE = 'P0010';
  END IF;

  -- D. Contrôle de Concurrence Optimiste sur profiles.id
  IF v_class.homeroom_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Cette classe n’a aucun professeur titulaire affecté.' USING ERRCODE = 'P0019';
  END IF;

  IF v_class.homeroom_teacher_id IS DISTINCT FROM p_expected_profile_id THEN
    RAISE EXCEPTION 'Conflit de concurrence : Le titulaire actuel de la classe "%" ne correspond plus à l’enseignant sélectionné. Veuillez recharger la page.',
      v_class.name
      USING ERRCODE = 'P0020';
  END IF;

  -- E. Chargement Sécurisé des Variables Scalaires de l'Ancien Titulaire (si existant)
  SELECT
    t.id,
    t.profile_id,
    t.employee_number,
    p.first_name,
    p.last_name
  INTO
    v_old_teacher_id,
    v_old_teacher_profile_id,
    v_old_teacher_employee_number,
    v_old_teacher_first_name,
    v_old_teacher_last_name
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.profile_id = v_class.homeroom_teacher_id
    AND t.school_id = v_caller_school_id;

  -- F. Retrait Atomique
  UPDATE public.classes
  SET
    homeroom_teacher_id = NULL,
    updated_at = NOW()
  WHERE id = p_class_id AND school_id = v_caller_school_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION 'Échec du retrait du titulaire (lignes affectées: %).', v_updated_rows USING ERRCODE = 'P0018';
  END IF;

  -- G. Journalisation Audit Sécurisée
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_caller_school_id,
    v_caller_id,
    'class_homeroom_teacher_removed',
    jsonb_build_object(
      'class_id', v_class.id,
      'class_name', v_class.name,
      'academic_year_id', v_class.academic_year_id,
      'removed_homeroom_profile_id', p_expected_profile_id,
      'removed_teacher_id', v_old_teacher_id,
      'removed_teacher_name', CASE WHEN v_old_teacher_id IS NOT NULL THEN TRIM(COALESCE(v_old_teacher_first_name, '') || ' ' || COALESCE(v_old_teacher_last_name, '')) ELSE NULL END,
      'removed_teacher_employee_number', v_old_teacher_employee_number,
      'performed_at', NOW()
    )
  );

  -- H. Retour Confirmé
  RETURN jsonb_build_object(
    'success', true,
    'class_id', v_class.id,
    'class_name', v_class.name,
    'homeroom_profile_id', NULL,
    'removed_at', NOW()
  );
END;
$$;

--------------------------------------------------------------------------------
-- 4. MATRICE DES PRIVILÈGES (SÉCURITÉ STRICTE)
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.assign_class_homeroom_teacher(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_class_homeroom_teacher(UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_class_homeroom_teacher(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_class_homeroom_teacher(UUID, UUID) TO authenticated;

COMMIT;
