-- ============================================================================
-- Migration Corrective : RPC Dédiée pour la Signature Numérique Enseignant
-- Fichier : supabase/migrations/20260819170000_update_my_teacher_signature.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION IDEMPOTENTE DE LA COLONNE SUR PUBLIC.TEACHERS
--------------------------------------------------------------------------------

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS signature_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

--------------------------------------------------------------------------------
-- 2. CRÉATION DE LA RPC DÉDIÉE : update_my_teacher_signature
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_my_teacher_signature(
  p_signature_path TEXT
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
  v_school_id UUID;
  v_teacher_id UUID;
  v_account_status TEXT;
  v_employment_status TEXT;
  v_clean_path TEXT;
  v_expected_path TEXT;
  v_updated_record RECORD;
BEGIN
  -- A. Récupération & Vérification de l'Utilisateur Authentifié
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié : Session utilisateur requise.' USING ERRCODE = 'P0001';
  END IF;

  -- B. Chargement du Profil Utilisateur
  SELECT role, school_id, is_active
  INTO v_caller_role, v_school_id, v_caller_active
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable ou non rattaché à un établissement.' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Compte utilisateur inactif.' USING ERRCODE = 'P0003';
  END IF;

  IF v_caller_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un enseignant (teacher) est autorisé à modifier sa signature numérique.' USING ERRCODE = 'P0004';
  END IF;

  -- C. Contrôle de l'Enregistrement Enseignant
  SELECT id, account_status, employment_status
  INTO v_teacher_id, v_account_status, v_employment_status
  FROM public.teachers
  WHERE profile_id = v_caller_id AND school_id = v_school_id;

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Enregistrement enseignant introuvable dans cet établissement.' USING ERRCODE = 'P0005';
  END IF;

  IF v_account_status IS DISTINCT FROM 'active' OR v_employment_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Compte enseignant non actif (statut compte: %, statut emploi: %).', v_account_status, v_employment_status USING ERRCODE = 'P0006';
  END IF;

  -- D. Nettoyage & Validation Stricte Obligatoire du Chemin Storage
  v_clean_path := NULLIF(TRIM(p_signature_path), '');

  IF v_clean_path IS NULL THEN
    RAISE EXCEPTION 'Le chemin de la signature est obligatoire.' USING ERRCODE = 'P0007';
  END IF;

  -- Rejet des traversées et URLs externes
  IF v_clean_path ~ '\.\.' OR v_clean_path ~ '//' OR v_clean_path ~* '^https?://' THEN
    RAISE EXCEPTION 'Sécurité Storage : Chemin de signature invalide.' USING ERRCODE = 'P0008';
  END IF;

  -- Format strict canonique : {school_id}/signatures/teachers/{auth.uid()}.png
  v_expected_path := v_school_id::text || '/signatures/teachers/' || v_caller_id::text || '.png';
  IF v_clean_path <> v_expected_path THEN
    RAISE EXCEPTION 'Sécurité Storage : Le chemin de signature doit être exactement % (reçu: %).', v_expected_path, v_clean_path USING ERRCODE = 'P0009';
  END IF;

  -- Vérification physique de l'existence de l'objet dans storage.objects
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'school-official-assets' AND name = v_clean_path
  ) THEN
    RAISE EXCEPTION 'Objet introuvable : Le fichier de signature % n’existe pas dans le bucket school-official-assets.', v_clean_path USING ERRCODE = 'P0010';
  END IF;

  -- E. Mise à Jour Atomique de public.teachers
  UPDATE public.teachers
  SET
    signature_url = v_clean_path,
    updated_at = NOW()
  WHERE id = v_teacher_id
  RETURNING id, school_id, profile_id, signature_url, updated_at
  INTO v_updated_record;

  IF v_updated_record.id IS NULL THEN
    RAISE EXCEPTION 'Échec de la mise à jour de la signature pour l’enseignant %.', v_teacher_id USING ERRCODE = 'P0011';
  END IF;

  -- F. Retour JSONB Confirmé
  RETURN jsonb_build_object(
    'teacher_id', v_updated_record.id,
    'school_id', v_updated_record.school_id,
    'profile_id', v_updated_record.profile_id,
    'signature_url', v_updated_record.signature_url,
    'updated_at', v_updated_record.updated_at
  );
END;
$$;

--------------------------------------------------------------------------------
-- 3. MATRICE DES PRIVILÈGES (SÉCURITÉ STRICTE)
--------------------------------------------------------------------------------

-- Révocation stricte pour le public et les anonymes
REVOKE ALL ON FUNCTION public.update_my_teacher_signature(TEXT) FROM PUBLIC, anon;

-- Attribution contrôlée uniquement aux utilisateurs authentifiés
GRANT EXECUTE ON FUNCTION public.update_my_teacher_signature(TEXT) TO authenticated;

COMMIT;

-- ============================================================================
-- INVENTAIRE DES OBJETS & VÉRIFICATIONS POST-MIGRATION
-- ============================================================================
/*
OBJETS CRÉÉS OU MODIFIÉS :
1. Table public.teachers :
   - Colonnes signature_url (TEXT) et updated_at (TIMESTAMPTZ).
2. Fonction RPC sécurisée :
   - public.update_my_teacher_signature(TEXT) RETURNS JSONB (SECURITY DEFINER).
3. Privilèges :
   - REVOKE ALL FROM PUBLIC, anon.
   - GRANT EXECUTE TO authenticated.

VÉRIFICATIONS POST-MIGRATION :
--------------------------------------------------------------------------------
-- A. Vérifier la fonction RPC
SELECT routine_name, routine_type, security_type, data_type
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'update_my_teacher_signature';

-- B. Vérifier les privilèges d'exécution
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'update_my_teacher_signature';

TESTS NÉGATIFS CONÇUS :
--------------------------------------------------------------------------------
1. Test Chemin NULL ou Vide :
   - Appel de update_my_teacher_signature(NULL) ou update_my_teacher_signature('').
   - Résultat attendu : Erreur P0007 "Le chemin de la signature est obligatoire.".

2. Test Enseignant Inactif ou Suspendu :
   - Appel avec teachers.account_status IS DISTINCT FROM 'active'.
   - Résultat attendu : Erreur P0006 "Compte enseignant non actif...".

3. Test Parent, Élève ou School Admin :
   - Appel avec v_caller_role IS DISTINCT FROM 'teacher'.
   - Résultat attendu : Erreur P0004 "Accès refusé : Seul un enseignant...".

4. Test Autre Enseignant / Usurpation d'UID :
   - Tentative de transmettre le chemin d'un autre enseignant.
   - Résultat attendu : Erreur P0009 "Sécurité Storage : Le chemin de signature doit être exactement...".

5. Test Chemin d'une Autre École :
   - Appel avec chemin préfixé par un autre school_id.
   - Résultat attendu : Erreur P0009 "Sécurité Storage : Le chemin de signature doit être exactement...".

6. Test Fichier Inexistant dans Storage :
   - Appel avec chemin canonique valide sans upload physique préalable.
   - Résultat attendu : Erreur P0010 "Objet introuvable : Le fichier de signature ... n’existe pas...".
*/
