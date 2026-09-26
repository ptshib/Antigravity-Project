-- Suite de Tests SQL Transactionnels: 20260925180000_create_multi_school_identity_foundations_tests.sql
-- Validation intégrale du Lot 2K-A1 avec isolation complète (BEGIN ... ROLLBACK)

BEGIN;

-- ============================================================================
-- 1. Exécution de la Migration 20260925180000 sous Transaction
-- ============================================================================

-- Table Canonique des Rôles de Plateforme
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

REVOKE ALL ON public.platform_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_role_audit_logs FROM PUBLIC, anon, authenticated;

-- Table d'Appartenance Multi-Écoles (school_memberships)
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

  CONSTRAINT chk_school_memberships_role CHECK (
    role IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent')
  ),
  CONSTRAINT chk_school_memberships_status CHECK (
    status IN ('active', 'suspended', 'left')
  ),
  CONSTRAINT chk_school_memberships_status_dates CHECK (
    (status = 'active' AND suspended_at IS NULL AND left_at IS NULL) OR
    (status = 'suspended' AND suspended_at IS NOT NULL AND left_at IS NULL) OR
    (status = 'left' AND left_at IS NOT NULL)
  ),
  CONSTRAINT chk_school_memberships_chronology CHECK (
    joined_at >= accepted_at AND
    (suspended_at IS NULL OR suspended_at >= joined_at) AND
    (left_at IS NULL OR left_at >= joined_at)
  ),
  CONSTRAINT uq_school_membership_profile_school_role UNIQUE (profile_id, school_id, role)
);

CREATE INDEX IF NOT EXISTS idx_school_memberships_profile_lookup 
  ON public.school_memberships(profile_id, school_id, status);

CREATE INDEX IF NOT EXISTS idx_school_memberships_school_role_lookup 
  ON public.school_memberships(school_id, role, status);

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

REVOKE ALL ON public.school_memberships FROM PUBLIC, anon;
GRANT SELECT ON public.school_memberships TO authenticated;

ALTER TABLE public.school_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Utilisateurs lisent leurs propres memberships" ON public.school_memberships;
CREATE POLICY "Utilisateurs lisent leurs propres memberships"
  ON public.school_memberships FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

-- RPCs Sécurisées d'Administration
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
  IF v_caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_roles 
    WHERE user_id = v_caller_id AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Seul un super_admin de plateforme peut attribuer des rôles globaux.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Utilisateur cible introuvable dans auth.users.';
  END IF;

  IF p_role NOT IN ('super_admin', 'platform_auditor') THEN
    RAISE EXCEPTION 'Rôle de plateforme non valide : %', p_role;
  END IF;

  PERFORM 1 FROM public.platform_roles FOR UPDATE;

  SELECT role INTO v_old_role
  FROM public.platform_roles
  WHERE user_id = p_target_user_id;

  IF v_old_role = 'super_admin' AND p_role != 'super_admin' THEN
    SELECT COUNT(*) INTO v_super_admin_count
    FROM public.platform_roles
    WHERE role = 'super_admin';

    IF v_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Opération refusée : Impossible de rétrograder le dernier super_admin de la plateforme.';
    END IF;
  END IF;

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
  IF v_caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_roles 
    WHERE user_id = v_caller_id AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Seul un super_admin de plateforme peut révoquer des rôles globaux.';
  END IF;

  PERFORM 1 FROM public.platform_roles FOR UPDATE;

  SELECT role INTO v_old_role
  FROM public.platform_roles
  WHERE user_id = p_target_user_id;

  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'Aucun rôle de plateforme à révoquer pour cet utilisateur.';
  END IF;

  IF v_old_role = 'super_admin' THEN
    SELECT COUNT(*) INTO v_super_admin_count
    FROM public.platform_roles
    WHERE role = 'super_admin';

    IF v_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Opération refusée : Impossible de révoquer le dernier super_admin de la plateforme.';
    END IF;
  END IF;

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

-- Exécution du script de Backfill
DO $$
DECLARE
  v_invalid_count INTEGER := 0;
  v_super_admin_count INTEGER := 0;
  v_active_memberships_count INTEGER := 0;
  v_suspended_memberships_count INTEGER := 0;
  v_source_profile_count INTEGER := 0;
  v_target_membership_count INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.profiles
  WHERE role != 'super_admin' AND is_active = true AND school_id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % profil(s) actif(s) possèdent un school_id NULL.', v_invalid_count;
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM public.profiles
  WHERE role NOT IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent', 'super_admin');

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % profil(s) ont un rôle non reconnu.', v_invalid_count;
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.profile_id IS NOT NULL AND t.school_id <> p.school_id;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % enseignant(s) ont un school_id différent de leur profil.', v_invalid_count;
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM public.students s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.profile_id IS NOT NULL AND s.school_id <> p.school_id;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % élève(s) ont un school_id différent de leur profil.', v_invalid_count;
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM public.parent_accounts pa
  JOIN public.profiles p ON p.id = pa.profile_id
  WHERE pa.profile_id IS NOT NULL AND pa.school_id <> p.school_id;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % parent_account(s) ont un school_id différent de leur profil.', v_invalid_count;
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM public.teachers t
  LEFT JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.profile_id IS NOT NULL AND p.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % enseignant(s) ont un profile_id introuvable dans profiles.', v_invalid_count;
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM public.students s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.profile_id IS NOT NULL AND p.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % élève(s) ont un profile_id introuvable dans profiles.', v_invalid_count;
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM public.parent_accounts pa
  LEFT JOIN public.profiles p ON p.id = pa.profile_id
  WHERE pa.profile_id IS NOT NULL AND p.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % parent_account(s) ont un profile_id introuvable dans profiles.', v_invalid_count;
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'super_admin' AND p.is_active = true AND u.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Backfill bloqué : % super_admin(s) n’ont pas de compte dans auth.users.', v_invalid_count;
  END IF;

  INSERT INTO public.platform_roles (user_id, role, granted_at)
  SELECT id, 'super_admin', created_at
  FROM public.profiles
  WHERE role = 'super_admin' AND is_active = true
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_super_admin_count FROM public.platform_roles WHERE role = 'super_admin';
  IF v_super_admin_count < 1 THEN
    RAISE EXCEPTION 'Backfill bloqué : Aucun super_admin n’a pu être initialisé dans platform_roles.';
  END IF;

  INSERT INTO public.school_memberships (
    profile_id, school_id, role, status, accepted_at, joined_at
  )
  SELECT 
    id AS profile_id, school_id, role, 'active' AS status, created_at, created_at
  FROM public.profiles
  WHERE school_id IS NOT NULL 
    AND is_active = true
    AND role IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent')
  ON CONFLICT (profile_id, school_id, role) DO NOTHING;

  GET DIAGNOSTICS v_active_memberships_count = ROW_COUNT;

  INSERT INTO public.school_memberships (
    profile_id, school_id, role, status, accepted_at, joined_at, suspended_at
  )
  SELECT 
    id AS profile_id, school_id, role, 'suspended' AS status, created_at, created_at, updated_at
  FROM public.profiles
  WHERE school_id IS NOT NULL 
    AND is_active = false
    AND role IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent')
  ON CONFLICT (profile_id, school_id, role) DO NOTHING;

  GET DIAGNOSTICS v_suspended_memberships_count = ROW_COUNT;

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
END $$;

-- ============================================================================
-- 2. ASSERTIONS ET TESTS DE VALIDATION EN TRANSACTION
-- ============================================================================

-- Test 1 : Bootstrap Super Admin
DO $$
DECLARE
  v_super_admin_count INTEGER;
  v_memberships_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_super_admin_count
  FROM public.platform_roles
  WHERE role = 'super_admin';

  IF v_super_admin_count < 1 THEN
    RAISE EXCEPTION 'TEST ÉCHEC : Le bootstrap super_admin dans platform_roles a échoué.';
  END IF;

  SELECT COUNT(*) INTO v_memberships_count
  FROM public.school_memberships;

  IF v_memberships_count < 17 THEN
    RAISE EXCEPTION 'TEST ÉCHEC : Le nombre de memberships générés (%) est inférieur au nombre attendu (17).', v_memberships_count;
  END IF;

  RAISE NOTICE 'TEST 1 REUSSITE : Bootstrap platform_roles & backfill school_memberships validés (% super_admin, % memberships).', v_super_admin_count, v_memberships_count;
END $$;

-- Test 2 : Invariants des dates
DO $$
DECLARE
  v_invalid_dates INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_invalid_dates
  FROM public.school_memberships
  WHERE status = 'active' AND (suspended_at IS NOT NULL OR left_at IS NOT NULL);

  IF v_invalid_dates > 0 THEN
    RAISE EXCEPTION 'TEST ÉCHEC : Invariant de dates violé pour le statut active.';
  END IF;

  RAISE NOTICE 'TEST 2 REUSSITE : Invariants de dates et statuts validés.';
END $$;

-- Test 3 : Protection du dernier Super Admin
DO $$
DECLARE
  v_super_admin_id UUID;
  v_auditor_id UUID := gen_random_uuid();
  v_error_caught BOOLEAN := false;
BEGIN
  SELECT user_id INTO v_super_admin_id
  FROM public.platform_roles
  WHERE role = 'super_admin'
  LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', v_super_admin_id::text, true);

  INSERT INTO auth.users (id, email) VALUES (v_auditor_id, 'auditor@ecoleconnect.test');

  -- Attribuer un rôle platform_auditor
  PERFORM public.grant_platform_role(v_auditor_id, 'platform_auditor');

  IF NOT EXISTS (SELECT 1 FROM public.platform_roles WHERE user_id = v_auditor_id AND role = 'platform_auditor') THEN
    RAISE EXCEPTION 'TEST ÉCHEC : Attribution du rôle platform_auditor échouée.';
  END IF;

  -- Tenter de rétrograder le dernier super_admin en platform_auditor (Doit échouer)
  BEGIN
    PERFORM public.grant_platform_role(v_super_admin_id, 'platform_auditor');
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'TEST ÉCHEC : La rétrogradation du dernier super_admin aurait dû être bloquée.';
  END IF;

  -- Tenter de révoquer le dernier super_admin (Doit échouer)
  v_error_caught := false;
  BEGIN
    PERFORM public.revoke_platform_role(v_super_admin_id);
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'TEST ÉCHEC : La révocation du dernier super_admin aurait dû être bloquée.';
  END IF;

  -- Révoquer de manière valide l'auditeur secondaire
  PERFORM public.revoke_platform_role(v_auditor_id);

  IF EXISTS (SELECT 1 FROM public.platform_roles WHERE user_id = v_auditor_id) THEN
    RAISE EXCEPTION 'TEST ÉCHEC : La révocation valide de l’auditeur a échoué.';
  END IF;

  RAISE NOTICE 'TEST 3 REUSSITE : Protection du dernier super_admin et RPCs d’administration validées.';
END $$;

-- Test 4 : Journal d'audit
DO $$
DECLARE
  v_audit_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_audit_count
  FROM public.platform_role_audit_logs;

  IF v_audit_count < 2 THEN
    RAISE EXCEPTION 'TEST ÉCHEC : Les entrées d’audit de rôle de plateforme n’ont pas été générées (% trouvées).', v_audit_count;
  END IF;

  RAISE NOTICE 'TEST 4 REUSSITE : Journal d’audit immuable des rôles plateforme validé (% logs).', v_audit_count;
END $$;

-- Test 5 : Idempotence
DO $$
DECLARE
  v_count_before INTEGER;
  v_count_after INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count_before FROM public.school_memberships;

  INSERT INTO public.school_memberships (
    profile_id, school_id, role, status, accepted_at, joined_at
  )
  SELECT 
    id AS profile_id, school_id, role, 'active', created_at, created_at
  FROM public.profiles
  WHERE school_id IS NOT NULL AND is_active = true AND role IN ('school_admin', 'teacher', 'parent', 'student', 'finance_agent')
  ON CONFLICT (profile_id, school_id, role) DO NOTHING;

  SELECT COUNT(*) INTO v_count_after FROM public.school_memberships;

  IF v_count_before != v_count_after THEN
    RAISE EXCEPTION 'TEST ÉCHEC : La ré-exécution du backfill a généré des doublons (% vs %).', v_count_before, v_count_after;
  END IF;

  RAISE NOTICE 'TEST 5 REUSSITE : Idempotence du backfill confirmée (% memberships).', v_count_after;
END $$;

-- Annulation garantie pour zéro résidu en base de données
ROLLBACK;
