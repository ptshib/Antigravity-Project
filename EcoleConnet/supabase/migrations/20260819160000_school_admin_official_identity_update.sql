-- ============================================================================
-- Migration Corrective : RPC Dédiée pour la Mise à Jour de l'Identité Officielle
-- Fichier : supabase/migrations/20260819160000_school_admin_official_identity_update.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION IDEMPOTENTE DES COLONNES SUR PUBLIC.SCHOOLS
--------------------------------------------------------------------------------

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS principal_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS official_registration_number TEXT NULL,
  ADD COLUMN IF NOT EXISTS motto TEXT NULL,
  ADD COLUMN IF NOT EXISTS address TEXT NULL,
  ADD COLUMN IF NOT EXISTS phone TEXT NULL,
  ADD COLUMN IF NOT EXISTS email TEXT NULL,
  ADD COLUMN IF NOT EXISTS logo_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS director_signature_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS stamp_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

--------------------------------------------------------------------------------
-- 2. NETTOYAGE PRÉALABLE IDEMPOTENT (AUCUNE POLICY UPDATE GLOBALE REQUISE)
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS "SchoolAdmin update own school" ON public.schools;
DROP TRIGGER IF EXISTS trg_guard_schools_sensitive_columns ON public.schools;
DROP FUNCTION IF EXISTS public.guard_schools_sensitive_columns();

--------------------------------------------------------------------------------
-- 3. CRÉATION DE LA RPC DÉDIÉE : update_school_official_identity
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_school_official_identity(
  p_principal_name TEXT DEFAULT NULL,
  p_official_registration_number TEXT DEFAULT NULL,
  p_motto TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_director_signature_url TEXT DEFAULT NULL,
  p_stamp_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_active BOOLEAN;
  v_school_id UUID;
  v_school_status TEXT;

  -- Valeurs nettoyées
  v_principal_name TEXT;
  v_official_reg_num TEXT;
  v_motto TEXT;
  v_address TEXT;
  v_phone TEXT;
  v_email TEXT;
  v_logo_url TEXT;
  v_director_sig_url TEXT;
  v_stamp_url TEXT;

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

  IF v_caller_role <> 'school_admin' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un administrateur d’établissement (school_admin) est autorisé à modifier l’identité officielle.' USING ERRCODE = 'P0004';
  END IF;

  -- C. Vérification du Statut de l'Établissement
  SELECT status INTO v_school_status
  FROM public.schools
  WHERE id = v_school_id;

  IF v_school_status IS NULL THEN
    RAISE EXCEPTION 'Établissement scolaire introuvable.' USING ERRCODE = 'P0005';
  END IF;

  IF v_school_status <> 'active' THEN
    RAISE EXCEPTION 'L’établissement scolaire n’est pas actif.' USING ERRCODE = 'P0006';
  END IF;

  -- D. Nettoyage & Validation des Textes
  v_principal_name := NULLIF(TRIM(p_principal_name), '');
  v_official_reg_num := NULLIF(TRIM(p_official_registration_number), '');
  v_motto := NULLIF(TRIM(p_motto), '');
  v_address := NULLIF(TRIM(p_address), '');
  v_phone := NULLIF(TRIM(p_phone), '');
  v_email := NULLIF(TRIM(p_email), '');

  IF v_principal_name IS NOT NULL AND LENGTH(v_principal_name) > 255 THEN
    RAISE EXCEPTION 'Validation : Le nom du chef d’établissement ne peut dépasser 255 caractères.';
  END IF;

  IF v_official_reg_num IS NOT NULL AND LENGTH(v_official_reg_num) > 100 THEN
    RAISE EXCEPTION 'Validation : Le numéro d’agrément officiel ne peut dépasser 100 caractères.';
  END IF;

  IF v_motto IS NOT NULL AND LENGTH(v_motto) > 255 THEN
    RAISE EXCEPTION 'Validation : La devise ne peut dépasser 255 caractères.';
  END IF;

  IF v_address IS NOT NULL AND LENGTH(v_address) > 500 THEN
    RAISE EXCEPTION 'Validation : L’adresse physique ne peut dépasser 500 caractères.';
  END IF;

  IF v_phone IS NOT NULL AND LENGTH(v_phone) > 50 THEN
    RAISE EXCEPTION 'Validation : Le numéro de téléphone ne peut dépasser 50 caractères.';
  END IF;

  IF v_email IS NOT NULL THEN
    IF LENGTH(v_email) > 255 THEN
      RAISE EXCEPTION 'Validation : L’adresse e-mail ne peut dépasser 255 caractères.';
    END IF;
    IF v_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
      RAISE EXCEPTION 'Validation : L’adresse e-mail fournie est invalide (%s).', v_email;
    END IF;
  END IF;

  -- E. Nettoyage & Validation Stricte des Chemins Storage
  v_logo_url := NULLIF(TRIM(p_logo_url), '');
  v_director_sig_url := NULLIF(TRIM(p_director_signature_url), '');
  v_stamp_url := NULLIF(TRIM(p_stamp_url), '');

  -- 1. Logo
  IF v_logo_url IS NOT NULL THEN
    IF v_logo_url ~ '\.\.' OR v_logo_url ~ '//' OR v_logo_url ~* '^https?://' THEN
      RAISE EXCEPTION 'Sécurité Storage : Chemin logo invalide.';
    END IF;
    IF v_logo_url !~* ('^' || v_school_id::text || '/official/logo\.(png|jpg|jpeg|webp)$') THEN
      RAISE EXCEPTION 'Sécurité Storage : Le chemin du logo doit respecter le format canonique %/official/logo.(png|jpg|jpeg|webp)', v_school_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'school-official-assets' AND name = v_logo_url
    ) THEN
      RAISE EXCEPTION 'Objet introuvable : Le fichier logo % n’existe pas dans le bucket school-official-assets.', v_logo_url;
    END IF;
  END IF;

  -- 2. Signature Direction
  IF v_director_sig_url IS NOT NULL THEN
    IF v_director_sig_url ~ '\.\.' OR v_director_sig_url ~ '//' OR v_director_sig_url ~* '^https?://' THEN
      RAISE EXCEPTION 'Sécurité Storage : Chemin signature direction invalide.';
    END IF;
    IF v_director_sig_url !~* ('^' || v_school_id::text || '/official/director-signature\.(png|jpg|jpeg|webp)$') THEN
      RAISE EXCEPTION 'Sécurité Storage : Le chemin de la signature doit respecter le format canonique %/official/director-signature.(png|jpg|jpeg|webp)', v_school_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'school-official-assets' AND name = v_director_sig_url
    ) THEN
      RAISE EXCEPTION 'Objet introuvable : Le fichier signature % n’existe pas dans le bucket school-official-assets.', v_director_sig_url;
    END IF;
  END IF;

  -- 3. Cachet Officiel
  IF v_stamp_url IS NOT NULL THEN
    IF v_stamp_url ~ '\.\.' OR v_stamp_url ~ '//' OR v_stamp_url ~* '^https?://' THEN
      RAISE EXCEPTION 'Sécurité Storage : Chemin cachet officiel invalide.';
    END IF;
    IF v_stamp_url !~* ('^' || v_school_id::text || '/official/stamp\.(png|jpg|jpeg|webp)$') THEN
      RAISE EXCEPTION 'Sécurité Storage : Le chemin du cachet doit respecter le format canonique %/official/stamp.(png|jpg|jpeg|webp)', v_school_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'school-official-assets' AND name = v_stamp_url
    ) THEN
      RAISE EXCEPTION 'Objet introuvable : Le fichier cachet % n’existe pas dans le bucket school-official-assets.', v_stamp_url;
    END IF;
  END IF;

  -- F. Exécution de la Mise à Jour Atomique
  UPDATE public.schools
  SET
    principal_name = v_principal_name,
    official_registration_number = v_official_reg_num,
    motto = v_motto,
    address = v_address,
    phone = v_phone,
    email = v_email,
    logo_url = v_logo_url,
    director_signature_url = v_director_sig_url,
    stamp_url = v_stamp_url,
    updated_at = NOW()
  WHERE id = v_school_id
  RETURNING id, name, slug, principal_name, official_registration_number, motto, address, phone, email, logo_url, director_signature_url, stamp_url, updated_at
  INTO v_updated_record;

  IF v_updated_record.id IS NULL THEN
    RAISE EXCEPTION 'Échec de mise à jour : Aucune ligne modifiée pour l’école %.', v_school_id;
  END IF;

  -- G. Retour JSONB Confirmé
  RETURN jsonb_build_object(
    'id', v_updated_record.id,
    'name', v_updated_record.name,
    'slug', v_updated_record.slug,
    'principal_name', v_updated_record.principal_name,
    'official_registration_number', v_updated_record.official_registration_number,
    'motto', v_updated_record.motto,
    'address', v_updated_record.address,
    'phone', v_updated_record.phone,
    'email', v_updated_record.email,
    'logo_url', v_updated_record.logo_url,
    'director_signature_url', v_updated_record.director_signature_url,
    'stamp_url', v_updated_record.stamp_url,
    'updated_at', v_updated_record.updated_at
  );
END;
$$;

--------------------------------------------------------------------------------
-- 4. MATRICE DES PRIVILÈGES (SÉCURITÉ STRICTE)
--------------------------------------------------------------------------------

-- Révocation stricte pour le public et les anonymes
REVOKE ALL ON FUNCTION public.update_school_official_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

-- Attribution contrôlée aux utilisateurs authentifiés et au service_role
GRANT EXECUTE ON FUNCTION public.update_school_official_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- INVENTAIRE DES OBJETS & VÉRIFICATIONS POST-MIGRATION
-- ============================================================================
/*
OBJETS CRÉÉS OU MODIFIÉS :
1. Extension colonnes public.schools (idempotent) :
   - principal_name, official_registration_number, motto, address, phone, email, logo_url, director_signature_url, stamp_url, updated_at.
2. Fonction RPC sécurisée :
   - public.update_school_official_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) RETURNS JSONB (SECURITY DEFINER).
3. Nettoyage des policies :
   - Suppression de toute politique UPDATE générale sur public.schools.
4. Privilèges :
   - REVOKE ALL FROM PUBLIC, anon.
   - GRANT EXECUTE TO authenticated, service_role.

VÉRIFICATIONS POST-MIGRATION :
--------------------------------------------------------------------------------
-- A. Vérifier la fonction RPC
SELECT routine_name, routine_type, security_type, data_type
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'update_school_official_identity';

-- B. Vérifier les privilèges d'exécution
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'update_school_official_identity';

-- C. Vérifier qu'aucune policy UPDATE non autorisée n'existe sur schools
SELECT policyname, cmd, roles 
FROM pg_policies 
WHERE tablename = 'schools' AND schemaname = 'public';

TESTS NÉGATIFS CONÇUS :
--------------------------------------------------------------------------------
1. Test Enseignant :
   - Appel de update_school_official_identity(...) avec session d'un enseignant.
   - Résultat : Erreur P0004 "Accès refusé : Seul un administrateur d’établissement (school_admin)...".

2. Test Parent ou Élève :
   - Appel de update_school_official_identity(...) avec session d'un parent/élève.
   - Résultat : Erreur P0004 "Accès refusé...".

3. Test Profil Inactif :
   - Appel avec profiles.is_active = false.
   - Résultat : Erreur P0003 "Compte utilisateur inactif.".

4. Test Utilisateur Anonyme (anon) :
   - Appel sans session / anon.
   - Résultat : Erreur Permission Denied (REVOKE ALL FROM anon).

5. Test Chemin Storage Falsifié / Autre École :
   - Appel avec p_director_signature_url = '<AUTRE_ECOLE_ID>/official/director-signature.png'.
   - Résultat : Exception SQL "Sécurité Storage : Le chemin de la signature doit respecter le format canonique...".

6. Test Fichier Inexistant dans Storage :
   - Appel avec p_logo_url = '<MON_ECOLE_ID>/official/logo.png' alors que le fichier n'a pas été uploadé.
   - Résultat : Exception SQL "Objet introuvable : Le fichier logo ... n’existe pas dans le bucket school-official-assets.".
*/
