-- Migration: 20260925180000_create_multi_school_identity_foundations.sql
-- Description: Fondations Additives pour l'Identité Multi-Écoles & Rôles de Plateforme

-- ============================================================================
-- 1. Table Canonique des Rôles de Plateforme (Platform Roles) & Audit
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.platform_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'platform_auditor')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Table d'Audit Immuable des Rôles de Plateforme
CREATE TABLE IF NOT EXISTS public.platform_role_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked', 'updated')),
  old_role TEXT NULL,
  new_role TEXT NULL,
  performed_by UUID NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Révocation stricte des accès directs
REVOKE ALL ON public.platform_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_role_audit_logs FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. Table d'Appartenance Multi-Écoles (school_memberships)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.school_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  suspended_at TIMESTAMPTZ NULL,
  left_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Validation des rôles d'établissement autorisés
  CONSTRAINT chk_school_memberships_role CHECK (
    role IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent')
  ),

  -- Validation des statuts effectifs
  CONSTRAINT chk_school_memberships_status CHECK (
    status IN ('active', 'suspended', 'left')
  ),

  -- Invariants stricts des dates selon le statut
  CONSTRAINT chk_school_memberships_status_dates CHECK (
    (status = 'active' AND suspended_at IS NULL AND left_at IS NULL) OR
    (status = 'suspended' AND suspended_at IS NOT NULL AND left_at IS NULL) OR
    (status = 'left' AND left_at IS NOT NULL)
  ),

  -- Invariants chronologiques
  CONSTRAINT chk_school_memberships_chronology CHECK (
    joined_at >= accepted_at AND
    (suspended_at IS NULL OR suspended_at >= joined_at) AND
    (left_at IS NULL OR left_at >= joined_at)
  ),

  -- Unicité par profil, école et rôle
  CONSTRAINT uq_school_membership_profile_school_role UNIQUE (profile_id, school_id, role)
);

-- Index d'optimisation
CREATE INDEX IF NOT EXISTS idx_school_memberships_profile_lookup 
  ON public.school_memberships(profile_id, school_id, status);

CREATE INDEX IF NOT EXISTS idx_school_memberships_school_role_lookup 
  ON public.school_memberships(school_id, role, status);

-- Trigger d'horodatage updated_at
CREATE OR REPLACE FUNCTION public.update_school_memberships_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_school_memberships_updated_at ON public.school_memberships;
CREATE TRIGGER trg_school_memberships_updated_at
  BEFORE UPDATE ON public.school_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.update_school_memberships_updated_at();

-- Privilèges & RLS sur school_memberships
REVOKE ALL ON public.school_memberships FROM PUBLIC, anon;
GRANT SELECT ON public.school_memberships TO authenticated;

ALTER TABLE public.school_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Utilisateurs lisent leurs propres memberships" ON public.school_memberships;
CREATE POLICY "Utilisateurs lisent leurs propres memberships"
  ON public.school_memberships FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

-- ============================================================================
-- 3. RPCs Sécurisées d'Administration des Rôles Plateforme
-- ============================================================================

CREATE OR REPLACE FUNCTION public.grant_platform_role(
  p_target_user_id UUID,
  p_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_old_role TEXT;
  v_super_admin_count INTEGER;
BEGIN
  -- 1. Vérifier que l'appelant est un super_admin authentifié
  IF v_caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_roles 
    WHERE user_id = v_caller_id AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Seul un super_admin de plateforme peut attribuer des rôles globaux.';
  END IF;

  -- 2. Vérifier l'existence de l'utilisateur cible dans auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Utilisateur cible introuvable dans auth.users.';
  END IF;

  -- 3. Valider le rôle demandé
  IF p_role NOT IN ('super_admin', 'platform_auditor') THEN
    RAISE EXCEPTION 'Rôle de plateforme non valide : %', p_role;
  END IF;

  -- 4. Verrouillage pour empêcher une rétgradation concurrente du dernier super_admin
  PERFORM 1 FROM public.platform_roles FOR UPDATE;

  SELECT role INTO v_old_role
  FROM public.platform_roles
  WHERE user_id = p_target_user_id;

  -- Protection : si on rétrograde un super_admin en platform_auditor, vérifier qu'il reste un autre super_admin
  IF v_old_role = 'super_admin' AND p_role != 'super_admin' THEN
    SELECT COUNT(*) INTO v_super_admin_count
    FROM public.platform_roles
    WHERE role = 'super_admin';

    IF v_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Opération refusée : Impossible de rétrograder le dernier super_admin de la plateforme.';
    END IF;
  END IF;

  -- 5. Mutation et audit
  INSERT INTO public.platform_roles (user_id, role, granted_at, granted_by)
  VALUES (p_target_user_id, p_role, now(), v_caller_id)
  ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role, granted_at = now(), granted_by = v_caller_id;

  INSERT INTO public.platform_role_audit_logs (
    target_user_id, action, old_role, new_role, performed_by
  ) VALUES (
    p_target_user_id,
    CASE WHEN v_old_role IS NULL THEN 'granted' ELSE 'updated' END,
    v_old_role,
    p_role,
    v_caller_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_platform_role(
  p_target_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_old_role TEXT;
  v_super_admin_count INTEGER;
BEGIN
  -- 1. Vérifier que l'appelant est un super_admin authentifié
  IF v_caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_roles 
    WHERE user_id = v_caller_id AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Seul un super_admin de plateforme peut révoquer des rôles globaux.';
  END IF;

  -- 2. Verrouillage sous transaction
  PERFORM 1 FROM public.platform_roles FOR UPDATE;

  SELECT role INTO v_old_role
  FROM public.platform_roles
  WHERE user_id = p_target_user_id;

  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'Aucun rôle de plateforme à révoquer pour cet utilisateur.';
  END IF;

  -- 3. Protection du dernier Super Admin
  IF v_old_role = 'super_admin' THEN
    SELECT COUNT(*) INTO v_super_admin_count
    FROM public.platform_roles
    WHERE role = 'super_admin';

    IF v_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Opération refusée : Impossible de révoquer le dernier super_admin de la plateforme.';
    END IF;
  END IF;

  -- 4. Suppression et audit
  DELETE FROM public.platform_roles WHERE user_id = p_target_user_id;

  INSERT INTO public.platform_role_audit_logs (
    target_user_id, action, old_role, new_role, performed_by
  ) VALUES (
    p_target_user_id, 'revoked', v_old_role, NULL, v_caller_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_platform_role(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_platform_role(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_platform_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_platform_role(UUID) TO authenticated;

-- ============================================================================
-- 4. Script de Backfill Sécurisé avec Pré-Contrôles Bloquants
-- ============================================================================

DO $$
DECLARE
  v_invalid_count INTEGER := 0;
  v_super_admin_count INTEGER := 0;
  v_active_memberships_count INTEGER := 0;
  v_suspended_memberships_count INTEGER := 0;
  v_source_profile_count INTEGER := 0;
  v_target_membership_count INTEGER := 0;
BEGIN
  -- --------------------------------------------------------------------------
  -- PRÉ-CONTRÔLES STRICTS (Toute erreur stoppe immédiatement la transaction)
  -- --------------------------------------------------------------------------

  -- 1. Profils scolaires actifs sans school_id
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.profiles
  WHERE role != 'super_admin' AND is_active = true AND school_id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % profil(s) actif(s) possèdent un school_id NULL.', v_invalid_count;
  END IF;

  -- 2. Rôles inattendus / non reconnus
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.profiles
  WHERE role NOT IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent', 'super_admin');

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % profil(s) ont un rôle non reconnu.', v_invalid_count;
  END IF;

  -- 3. Enseignants rattachés à un profil avec school_id différent
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.profile_id IS NOT NULL AND t.school_id <> p.school_id;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % enseignant(s) ont un school_id différent de leur profil.', v_invalid_count;
  END IF;

  -- 4. Élèves rattachés à un profil avec school_id différent
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.students s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.profile_id IS NOT NULL AND s.school_id <> p.school_id;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % élève(s) ont un school_id différent de leur profil.', v_invalid_count;
  END IF;

  -- 5. Parent accounts rattachés à un profil avec school_id différent
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.parent_accounts pa
  JOIN public.profiles p ON p.id = pa.profile_id
  WHERE pa.profile_id IS NOT NULL AND pa.school_id <> p.school_id;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % parent_account(s) ont un school_id différent de leur profil.', v_invalid_count;
  END IF;

  -- 6. Enseignants avec profile_id non nul mais profil introuvable (LEFT JOIN)
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.teachers t
  LEFT JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.profile_id IS NOT NULL AND p.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % enseignant(s) ont un profile_id introuvable dans profiles.', v_invalid_count;
  END IF;

  -- 7. Élèves avec profile_id non nul mais profil introuvable (LEFT JOIN)
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.students s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.profile_id IS NOT NULL AND p.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % élève(s) ont un profile_id introuvable dans profiles.', v_invalid_count;
  END IF;

  -- 8. Parent accounts avec profile_id introuvable (LEFT JOIN)
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.parent_accounts pa
  LEFT JOIN public.profiles p ON p.id = pa.profile_id
  WHERE pa.profile_id IS NOT NULL AND p.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % parent_account(s) ont un profile_id introuvable dans profiles.', v_invalid_count;
  END IF;

  -- 9. Super admins actifs sans compte auth.users correspondant
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'super_admin' AND p.is_active = true AND u.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % super_admin(s) n’ont pas de compte dans auth.users.', v_invalid_count;
  END IF;

  -- --------------------------------------------------------------------------
  -- BOOTSTRAP SUPER_ADMIN -> platform_roles
  -- --------------------------------------------------------------------------
  INSERT INTO public.platform_roles (user_id, role, granted_at)
  SELECT id, 'super_admin', created_at
  FROM public.profiles
  WHERE role = 'super_admin' AND is_active = true
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_super_admin_count FROM public.platform_roles WHERE role = 'super_admin';
  IF v_super_admin_count < 1 THEN
    RAISE EXCEPTION 'Backfill bloqué : Aucun super_admin n’a pu être initialisé dans platform_roles.';
  END IF;

  -- --------------------------------------------------------------------------
  -- POPULATION DES MEMBERSHIPS (Scolaires uniquement)
  -- --------------------------------------------------------------------------

  -- A. Profils scolaires actifs -> status = 'active'
  INSERT INTO public.school_memberships (
    profile_id, school_id, role, status, accepted_at, joined_at
  )
  SELECT 
    id AS profile_id,
    school_id,
    role,
    'active' AS status,
    created_at AS accepted_at,
    created_at AS joined_at
  FROM public.profiles
  WHERE school_id IS NOT NULL 
    AND is_active = true
    AND role IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent')
  ON CONFLICT (profile_id, school_id, role) DO NOTHING;

  GET DIAGNOSTICS v_active_memberships_count = ROW_COUNT;

  -- B. Profils scolaires inactifs -> status = 'suspended' (jamais activés)
  INSERT INTO public.school_memberships (
    profile_id, school_id, role, status, accepted_at, joined_at, suspended_at
  )
  SELECT 
    id AS profile_id,
    school_id,
    role,
    'suspended' AS status,
    created_at AS accepted_at,
    created_at AS joined_at,
    updated_at AS suspended_at
  FROM public.profiles
  WHERE school_id IS NOT NULL 
    AND is_active = false
    AND role IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent')
  ON CONFLICT (profile_id, school_id, role) DO NOTHING;

  GET DIAGNOSTICS v_suspended_memberships_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- VÉRIFICATION STRICTE DE COHÉRENCE ET D'EXHAUSTIVITÉ
  -- --------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_source_profile_count
  FROM public.profiles
  WHERE school_id IS NOT NULL 
    AND role IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent');

  SELECT COUNT(*) INTO v_target_membership_count
  FROM public.school_memberships;

  IF v_source_profile_count != v_target_membership_count THEN
    RAISE EXCEPTION 'Divergence de backfill : % profils scolaires source vs % memberships créés.', 
      v_source_profile_count, v_target_membership_count;
  END IF;

  RAISE NOTICE '====================================================';
  RAISE NOTICE 'BACKFILL SUCCÈS :';
  RAISE NOTICE 'Super Admins dans platform_roles : %', v_super_admin_count;
  RAISE NOTICE 'Memberships Actifs créés : %', v_active_memberships_count;
  RAISE NOTICE 'Memberships Suspendus créés : %', v_suspended_memberships_count;
  RAISE NOTICE 'Total Memberships créés : %', v_target_membership_count;
  RAISE NOTICE '====================================================';
END $$;
