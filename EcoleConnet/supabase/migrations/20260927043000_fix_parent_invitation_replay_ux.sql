-- HOTFIX LOT 2K-T3-V2 — MIGRATION ADDITIVE ANTI-REJEU ET PREVISUALISATION INVITATION PARENT
-- Fichier : supabase/migrations/20260927043000_fix_parent_invitation_replay_ux.sql

-- 1. RPC de prévisualisation non-mutante et sécurisée
CREATE OR REPLACE FUNCTION public.get_parent_school_invitation_preview(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_email TEXT;
  v_caller_norm_email TEXT;
  v_computed_hash TEXT;
  v_inv RECORD;
  v_school_name TEXT;
  v_student_count INT := 0;
BEGIN
  -- A. Exiger authentification
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'INVALID');
  END IF;

  SELECT u.email INTO v_caller_email
  FROM auth.users u
  WHERE u.id = v_caller_id;

  IF v_caller_email IS NULL OR pg_catalog.btrim(v_caller_email) = '' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'INVALID');
  END IF;

  v_caller_norm_email := public.normalize_email(v_caller_email);

  -- B. Validation format du jeton
  IF p_token IS NULL OR pg_catalog.btrim(p_token) = '' OR pg_catalog.length(p_token) < 10 OR pg_catalog.length(p_token) > 500 THEN
    RETURN pg_catalog.jsonb_build_object('status', 'INVALID');
  END IF;

  v_computed_hash := public.hash_invitation_token(p_token);

  -- C. Recherche invitation par token_hash (indépendamment du statut)
  SELECT smi.id, smi.school_id, smi.status, smi.expires_at, smi.email_normalized, smi.auth_user_id
  INTO v_inv
  FROM public.school_membership_invitations smi
  WHERE smi.token_hash = v_computed_hash
    AND smi.intended_role = 'parent';

  IF v_inv.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'INVALID');
  END IF;

  -- D. Vérification compte destinataire
  IF v_inv.email_normalized <> v_caller_norm_email THEN
    RETURN pg_catalog.jsonb_build_object('status', 'WRONG_ACCOUNT');
  END IF;

  IF v_inv.auth_user_id IS NOT NULL AND v_inv.auth_user_id <> v_caller_id THEN
    RETURN pg_catalog.jsonb_build_object('status', 'WRONG_ACCOUNT');
  END IF;

  -- E. Évaluation statut
  IF v_inv.status = 'accepted' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'ALREADY_ACCEPTED');
  ELSIF v_inv.status = 'revoked' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'REVOKED');
  ELSIF v_inv.status = 'expired' OR v_inv.expires_at <= pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('status', 'EXPIRED');
  ELSIF v_inv.status = 'pending' THEN
    SELECT s.name INTO v_school_name
    FROM public.schools s
    WHERE s.id = v_inv.school_id;

    SELECT pg_catalog.count(*)::INT INTO v_student_count
    FROM public.school_membership_invitation_students smis
    WHERE smis.invitation_id = v_inv.id;

    RETURN pg_catalog.jsonb_build_object(
      'status', 'PENDING',
      'school_name', COALESCE(v_school_name, 'Établissement scolaire'),
      'student_count', v_student_count
    );
  ELSE
    RETURN pg_catalog.jsonb_build_object('status', 'INVALID');
  END IF;
END;
$$;

ALTER FUNCTION public.get_parent_school_invitation_preview(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_parent_school_invitation_preview(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_school_invitation_preview(TEXT) TO authenticated;


-- 2. RPC d'acceptation mutante avec anti-rejeu et verrouillage de ligne FOR UPDATE
CREATE OR REPLACE FUNCTION public.accept_parent_school_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_email TEXT;
  v_caller_email_confirmed_at TIMESTAMPTZ;
  v_caller_norm_email TEXT;
  v_computed_hash TEXT;
  v_inv RECORD;
  v_school_status TEXT;
  v_school_name TEXT;
  v_profile_exists BOOLEAN;
  v_profile_role TEXT;
  v_parent_account_status TEXT;
  v_existing_membership_status TEXT;
  v_inv_student RECORD;
  v_st_exists BOOLEAN;
  v_existing_link RECORD;
  v_accepted_count INT := 0;
BEGIN
  -- 1. Exiger authentification
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  -- 2. Email vérifié de l'utilisateur
  SELECT u.email, u.email_confirmed_at INTO v_caller_email, v_caller_email_confirmed_at
  FROM auth.users u
  WHERE u.id = v_caller_id;

  IF v_caller_email IS NULL OR pg_catalog.btrim(v_caller_email) = '' THEN
    RAISE EXCEPTION 'REJET ACCÈS : Email utilisateur non vérifié ou introuvable.' USING ERRCODE = '42501';
  END IF;

  IF v_caller_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’adresse email de l’utilisateur n’est pas encore confirmée dans Auth.' USING ERRCODE = '42501';
  END IF;

  v_caller_norm_email := public.normalize_email(v_caller_email);

  -- 3. Hash token
  IF p_token IS NULL OR pg_catalog.btrim(p_token) = '' THEN
    RAISE EXCEPTION 'REJET : Jeton d’invitation invalide.' USING ERRCODE = '22023';
  END IF;

  v_computed_hash := public.hash_invitation_token(p_token);

  -- 4. Recherche et verrouillage FOR UPDATE par token_hash indépendant du statut
  SELECT smi.* INTO v_inv
  FROM public.school_membership_invitations smi
  WHERE smi.token_hash = v_computed_hash
    AND smi.intended_role = 'parent'
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Jeton d’invitation invalide ou inconnu.' USING ERRCODE = '22023';
  END IF;

  -- 5. Évaluation stricte du statut et rejet explicite
  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'REJET : Cette invitation a déjà été acceptée.' USING ERRCODE = '22023';
  ELSIF v_inv.status = 'revoked' THEN
    RAISE EXCEPTION 'REJET : Cette invitation a été révoquée.' USING ERRCODE = '22023';
  ELSIF v_inv.status = 'expired' OR v_inv.expires_at <= pg_catalog.now() THEN
    UPDATE public.school_membership_invitations
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = v_inv.id;
    RAISE EXCEPTION 'REJET : L’invitation a expiré.' USING ERRCODE = '22023';
  ELSIF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'REJET : Jeton d’invitation invalide ou inconnu.' USING ERRCODE = '22023';
  END IF;

  -- 6. Vérification du destinataire
  IF v_inv.email_normalized <> v_caller_norm_email THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’adresse email du compte connecté ne correspond pas à l’invitation.' USING ERRCODE = '42501';
  END IF;

  IF v_inv.auth_user_id IS NOT NULL AND v_inv.auth_user_id <> v_caller_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : Ce jeton d’invitation est réservé à un autre compte d’authentification.' USING ERRCODE = '42501';
  END IF;

  -- 7. Établissement actif
  SELECT s.status, s.name INTO v_school_status, v_school_name
  FROM public.schools s
  WHERE s.id = v_inv.school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'REJET : L’établissement scolaire est inactif ou suspendu.' USING ERRCODE = '42501';
  END IF;

  -- 8. Profil & compatibilité rôle Parent
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_caller_id), role
  INTO v_profile_exists, v_profile_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT v_profile_exists THEN
    RAISE EXCEPTION 'REJET ACCÈS : Profil utilisateur introuvable.' USING ERRCODE = '42501';
  END IF;

  IF v_profile_role <> 'parent' THEN
    IF NOT EXISTS (SELECT 1 FROM public.parent_accounts WHERE profile_id = v_caller_id) THEN
      RAISE EXCEPTION 'EXISTING_ACCOUNT_NOT_PARENT_COMPATIBLE : Ce compte possède le rôle % et ne peut pas recevoir un accès Parent direct.', v_profile_role USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT account_status INTO v_parent_account_status
  FROM public.parent_accounts
  WHERE profile_id = v_caller_id;

  IF v_parent_account_status IS NULL THEN
    INSERT INTO public.parent_accounts (profile_id, school_id, account_status, created_at, updated_at)
    VALUES (v_caller_id, v_inv.school_id, 'active', pg_catalog.now(), pg_catalog.now());
  ELSIF v_parent_account_status = 'suspended' THEN
    RAISE EXCEPTION 'REJET ACCÈS : Le compte Parent est suspendu.' USING ERRCODE = '42501';
  ELSIF v_parent_account_status = 'invited' THEN
    UPDATE public.parent_accounts
    SET account_status = 'active', updated_at = pg_catalog.now()
    WHERE profile_id = v_caller_id;
  END IF;

  -- 9. Appartenance école (school_membership)
  SELECT sm.status INTO v_existing_membership_status
  FROM public.school_memberships sm
  WHERE sm.profile_id = v_caller_id
    AND sm.school_id = v_inv.school_id
    AND sm.role = 'parent';

  IF v_existing_membership_status IS NULL THEN
    INSERT INTO public.school_memberships (
      school_id,
      profile_id,
      role,
      status,
      created_at,
      updated_at
    ) VALUES (
      v_inv.school_id,
      v_caller_id,
      'parent',
      'active',
      pg_catalog.now(),
      pg_catalog.now()
    );
  ELSIF v_existing_membership_status IN ('suspended', 'left') THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’appartenance parent dans cet établissement est %.', v_existing_membership_status USING ERRCODE = '42501';
  END IF;

  -- 10. Liens parent-élève (parent_student_links)
  FOR v_inv_student IN
    SELECT smis.*
    FROM public.school_membership_invitation_students smis
    WHERE smis.invitation_id = v_inv.id
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = v_inv_student.student_id
        AND s.school_id = v_inv.school_id
    ) INTO v_st_exists;

    IF NOT v_st_exists THEN
      RAISE EXCEPTION 'REJET : L’élève % n’appartient plus à cet établissement.', v_inv_student.student_id USING ERRCODE = '22023';
    END IF;

    SELECT psl.id, psl.status INTO v_existing_link
    FROM public.parent_student_links psl
    WHERE psl.parent_profile_id = v_caller_id
      AND psl.student_id = v_inv_student.student_id;

    IF v_existing_link.id IS NULL THEN
      INSERT INTO public.parent_student_links (
        school_id,
        parent_profile_id,
        student_id,
        relationship,
        is_primary,
        status,
        can_view_academic,
        can_view_attendance,
        can_view_homework,
        can_view_finances,
        can_pickup_student,
        can_receive_notifications,
        created_at,
        updated_at
      ) VALUES (
        v_inv.school_id,
        v_caller_id,
        v_inv_student.student_id,
        v_inv_student.relationship,
        v_inv_student.is_primary,
        'approved',
        v_inv_student.can_view_academic,
        v_inv_student.can_view_attendance,
        v_inv_student.can_view_homework,
        v_inv_student.can_view_finances,
        v_inv_student.can_pickup_student,
        v_inv_student.can_receive_notifications,
        pg_catalog.now(),
        pg_catalog.now()
      );
      v_accepted_count := v_accepted_count + 1;
    ELSIF v_existing_link.status = 'approved' THEN
      v_accepted_count := v_accepted_count + 1;
    ELSIF v_existing_link.status IN ('rejected', 'revoked') THEN
      RAISE EXCEPTION 'REJET ACCÈS : Le lien avec l’élève % est %.', v_inv_student.student_id, v_existing_link.status USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- 11. Activation du profil si inactif
  PERFORM pg_catalog.set_config('app.parent_activation_uid', v_caller_id::text, true);

  UPDATE public.profiles
  SET is_active = true, updated_at = pg_catalog.now()
  WHERE id = v_caller_id AND is_active = false;

  -- 12. Marquage statut 'accepted'
  UPDATE public.school_membership_invitations
  SET status = 'accepted',
      accepted_by_profile_id = v_caller_id,
      consumed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = v_inv.id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'school_id', v_inv.school_id,
    'school_name', v_school_name,
    'students_linked', v_accepted_count
  );
END;
$$;

ALTER FUNCTION public.accept_parent_school_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_parent_school_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_parent_school_invitation(TEXT) TO authenticated;
