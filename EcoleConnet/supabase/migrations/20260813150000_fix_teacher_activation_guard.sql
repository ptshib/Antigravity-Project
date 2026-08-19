-- Migration Phase 2D Correction : Autorisation du Trigger de Sécurité pour Activation Enseignant (Idempotente & Sécurisée)
-- Fichier : supabase/migrations/20260813150000_fix_teacher_activation_guard.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. MISE À JOUR DU TRIGGER DE PROTECTION POUR AUTORISER LA RPC D'ACTIVATION
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_sensitive_profile_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activation_uid text;
  v_teacher_school_id uuid;
  v_teacher_account_status text;
  v_teacher_emp_status text;
  v_school_status text;
BEGIN
  -- Permet au super_admin de tout modifier
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- Empêche la modification de role par un utilisateur non super_admin
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Modification non autorisée du rôle utilisateur';
  END IF;

  -- Empêche la modification de school_id par un utilisateur non super_admin
  IF OLD.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Modification non autorisée de l’établissement scolaire';
  END IF;

  -- Contrôle strict lors de la modification de is_active
  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    -- A. Récupérer le marqueur transactionnel d'activation s'il existe (session local flag)
    v_activation_uid := current_setting('app.teacher_activation_uid', true);

    -- B. Vérifier l'exception exacte et stricte d'activation d'un enseignant invité
    IF OLD.is_active = false
       AND NEW.is_active = true
       AND OLD.role = 'teacher'
       AND NEW.role = 'teacher'
       AND OLD.school_id IS NOT DISTINCT FROM NEW.school_id
       AND NEW.id = auth.uid()
       AND v_activation_uid IS NOT NULL
       AND v_activation_uid = NEW.id::text
    THEN
      -- Vérifier la présence du dossier enseignant correspondant
      SELECT school_id, account_status, employment_status
      INTO v_teacher_school_id, v_teacher_account_status, v_teacher_emp_status
      FROM public.teachers
      WHERE profile_id = NEW.id;

      -- Vérifier l'état de l'école
      IF NEW.school_id IS NOT NULL THEN
        SELECT status INTO v_school_status FROM public.schools WHERE id = NEW.school_id;
      END IF;

      -- Exiger toutes les conditions de sécurité
      IF v_teacher_school_id IS NOT NULL
         AND v_teacher_school_id = NEW.school_id
         AND v_teacher_account_status = 'invited'
         AND v_teacher_emp_status = 'active'
         AND v_school_status = 'active'
      THEN
        -- Transition false -> true autorisée EXCLUSIVEMENT pour cette RPC d'activation transactionnelle
        RETURN NEW;
      END IF;
    END IF;

    -- Tout autre changement de is_active est strictement interdit
    RAISE EXCEPTION 'Modification non autorisée du statut de compte';
  END IF;

  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- 2. MISE À JOUR DE LA RPC D'ACTIVATION ENSEIGNANT AVEC MARQUEUR TRANSACTIONNEL
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
  v_prof_is_active boolean;
  v_tch_id uuid;
  v_tch_school_id uuid;
  v_tch_account_status text;
  v_tch_emp_status text;
  v_school_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  -- 1. Charger le profil dans public.profiles
  SELECT role, school_id, is_active INTO v_prof_role, v_prof_school_id, v_prof_is_active
  FROM public.profiles
  WHERE id = v_uid;

  IF v_prof_role IS NULL OR v_prof_role <> 'teacher' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un profil enseignant peut activer son compte.';
  END IF;

  -- Si le profil et le dossier sont déjà actifs, refuser une seconde activation
  IF v_prof_is_active THEN
    SELECT account_status INTO v_tch_account_status FROM public.teachers WHERE profile_id = v_uid;
    IF v_tch_account_status = 'active' THEN
      RAISE EXCEPTION 'Activation refusée : Le compte enseignant est déjà actif.';
    END IF;
  END IF;

  -- 2. Charger et verrouiller le dossier teachers avec FOR UPDATE
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

  -- 3. Définir le marqueur transactionnel local pour autoriser le trigger (3ème paramètre true = transaction local)
  PERFORM set_config(
    'app.teacher_activation_uid',
    v_uid::text,
    true
  );

  -- 4. Activer public.profiles
  UPDATE public.profiles
  SET is_active = true,
      updated_at = now()
  WHERE id = v_uid;

  -- 5. Activer public.teachers
  UPDATE public.teachers
  SET account_status = 'active',
      updated_at = now()
  WHERE id = v_tch_id;

  -- 6. Journal d'audit conforme
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
-- 3. RÉVOCATION ET ATTRIBUTION DES PRIVILÈGES DE SÉCURITÉ
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.prevent_sensitive_profile_updates() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_teacher_on_password_set() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.activate_teacher_on_password_set() TO authenticated;

COMMIT;
