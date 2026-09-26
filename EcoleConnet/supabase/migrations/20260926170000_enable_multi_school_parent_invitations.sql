-- Migration: Enable Multi-School Parent Invitations Backend Infrastructure
-- File: supabase/migrations/20260926170000_enable_multi_school_parent_invitations.sql

-- 1. ADD TYPED COLUMNS TO school_membership_invitation_students
ALTER TABLE public.school_membership_invitation_students
  ADD COLUMN IF NOT EXISTS relationship TEXT NOT NULL DEFAULT 'parent',
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_academic BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_view_attendance BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_view_homework BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_view_finances BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_pickup_student BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_receive_notifications BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_invitation_student_relationship'
  ) THEN
    ALTER TABLE public.school_membership_invitation_students
      ADD CONSTRAINT chk_invitation_student_relationship
      CHECK (relationship IN ('father', 'mother', 'guardian', 'parent', 'legal_guardian', 'other'));
  END IF;
END $$;

-- 1.1 RESTORE RESTRICT ON DELETE FOR parent_accounts -> profiles (LEGACY FK SAFETY)
ALTER TABLE public.parent_accounts
  DROP CONSTRAINT IF EXISTS parent_accounts_profile_id_fkey,
  ADD CONSTRAINT parent_accounts_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- 1.2 SERVICE_ROLE RPC: prepare_parent_invitee_identity
CREATE OR REPLACE FUNCTION public.prepare_parent_invitee_identity(
  p_auth_user_id UUID,
  p_email TEXT,
  p_school_id UUID,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  profile_id UUID,
  school_id UUID,
  profile_created BOOLEAN,
  parent_account_created BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_email TEXT;
  v_norm_email TEXT;
  v_norm_param_email TEXT;
  v_school_status TEXT;
  v_existing_profile RECORD;
  v_existing_parent_acct RECORD;
  v_first TEXT;
  v_last TEXT;
  v_prof_created BOOLEAN := false;
  v_pa_created BOOLEAN := false;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'REJET : Identifiant utilisateur Auth obligatoire.' USING ERRCODE = '22023';
  END IF;

  SELECT u.email INTO v_auth_email
  FROM auth.users u
  WHERE u.id = p_auth_user_id;

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'REJET : Utilisateur Auth % introuvable dans auth.users.', p_auth_user_id USING ERRCODE = '22023';
  END IF;

  v_norm_email := public.normalize_email(v_auth_email);

  IF p_email IS NOT NULL AND pg_catalog.btrim(p_email) <> '' THEN
    v_norm_param_email := public.normalize_email(p_email);
    IF v_norm_email <> v_norm_param_email THEN
      RAISE EXCEPTION 'REJET : L’email spécifié (%) ne correspond pas à l’email du compte Auth (%).', p_email, v_auth_email USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET : Identifiant établissement obligatoire.' USING ERRCODE = '22023';
  END IF;

  SELECT s.status INTO v_school_status
  FROM public.schools s
  WHERE s.id = p_school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'REJET : L’établissement scolaire est inactif ou introuvable.' USING ERRCODE = '42501';
  END IF;

  v_first := COALESCE(pg_catalog.btrim(p_first_name), 'Parent');
  v_last := COALESCE(pg_catalog.btrim(p_last_name), 'Invité');

  SELECT p.id, p.role, p.is_active, p.school_id INTO v_existing_profile
  FROM public.profiles p
  WHERE p.id = p_auth_user_id;

  IF v_existing_profile.id IS NOT NULL THEN
    IF v_existing_profile.role <> 'parent' THEN
      RAISE EXCEPTION 'EXISTING_ACCOUNT_NOT_PARENT_COMPATIBLE : Le profil existant a le rôle % et ne peut pas être converti en Parent.', v_existing_profile.role USING ERRCODE = '22023';
    END IF;
  ELSE
    INSERT INTO public.profiles (
      id,
      school_id,
      role,
      first_name,
      last_name,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      p_auth_user_id,
      p_school_id,
      'parent',
      v_first,
      v_last,
      false,
      pg_catalog.now(),
      pg_catalog.now()
    );
    v_prof_created := true;
  END IF;

  SELECT pa.profile_id, pa.account_status, pa.school_id INTO v_existing_parent_acct
  FROM public.parent_accounts pa
  WHERE pa.profile_id = p_auth_user_id;

  IF v_existing_parent_acct.profile_id IS NULL THEN
    INSERT INTO public.parent_accounts (
      profile_id,
      school_id,
      account_status,
      created_at,
      updated_at
    ) VALUES (
      p_auth_user_id,
      p_school_id,
      'invited',
      pg_catalog.now(),
      pg_catalog.now()
    );
    v_pa_created := true;
  END IF;

  RETURN QUERY SELECT p_auth_user_id, p_school_id, v_prof_created, v_pa_created;
END;
$$;

ALTER FUNCTION public.prepare_parent_invitee_identity(UUID, TEXT, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_parent_invitee_identity(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_parent_invitee_identity(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;

-- 1.3 SERVICE_ROLE RPC: cleanup_prepared_parent_identity
CREATE OR REPLACE FUNCTION public.cleanup_prepared_parent_identity(
  p_auth_user_id UUID,
  p_invitation_id UUID DEFAULT NULL,
  p_profile_created BOOLEAN DEFAULT false,
  p_parent_account_created BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prof RECORD;
  v_pa RECORD;
  v_inv_status TEXT;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT p.id, p.role, p.is_active INTO v_prof
  FROM public.profiles p
  WHERE p.id = p_auth_user_id;

  -- Refuse cleanup if profile is active or non-parent
  IF v_prof.id IS NOT NULL THEN
    IF v_prof.is_active = true OR v_prof.role <> 'parent' THEN
      RETURN;
    END IF;
  END IF;

  -- Refuse cleanup if memberships or parent_student_links exist
  IF EXISTS (SELECT 1 FROM public.school_memberships WHERE profile_id = p_auth_user_id) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.parent_student_links WHERE parent_profile_id = p_auth_user_id) THEN
    RETURN;
  END IF;

  -- Cleanup invitation
  IF p_invitation_id IS NOT NULL THEN
    SELECT status INTO v_inv_status
    FROM public.school_membership_invitations
    WHERE id = p_invitation_id;

    IF v_inv_status IS NOT NULL AND v_inv_status <> 'accepted' THEN
      DELETE FROM public.school_membership_invitation_students
      WHERE invitation_id = p_invitation_id;

      DELETE FROM public.school_membership_invitations
      WHERE id = p_invitation_id;
    END IF;
  END IF;

  -- Cleanup parent account in explicit order (before profile to respect ON DELETE RESTRICT)
  IF p_parent_account_created OR (v_prof.id IS NOT NULL AND v_prof.is_active = false) THEN
    SELECT account_status INTO v_pa FROM public.parent_accounts WHERE profile_id = p_auth_user_id;
    IF v_pa.account_status = 'invited' THEN
      DELETE FROM public.parent_accounts WHERE profile_id = p_auth_user_id;
    END IF;
  END IF;

  -- Cleanup profile
  IF p_profile_created OR (v_prof.id IS NOT NULL AND v_prof.is_active = false) THEN
    DELETE FROM public.profiles WHERE id = p_auth_user_id AND is_active = false;
  END IF;
END;
$$;

ALTER FUNCTION public.cleanup_prepared_parent_identity(UUID, UUID, BOOLEAN, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cleanup_prepared_parent_identity(UUID, UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_prepared_parent_identity(UUID, UUID, BOOLEAN, BOOLEAN) TO service_role;

-- 1.4 MULTI-SCHOOL PARENT ACTIVATION TRIGGER HARDENING
CREATE OR REPLACE FUNCTION public.prevent_sensitive_profile_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_teacher_act_uid TEXT;
  v_parent_act_uid TEXT;
  v_student_act_uid TEXT;
  v_admin_toggle_uid TEXT;
  v_admin_toggle_action TEXT;
  v_teacher_school_id UUID;
  v_teacher_account_status TEXT;
  v_teacher_emp_status TEXT;
  v_parent_acc_status TEXT;
  v_parent_school_id UUID;
  v_school_status TEXT;
  v_has_approved_link BOOLEAN;
  v_has_valid_student BOOLEAN;
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
BEGIN
  -- 1. Super-Admin
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- 2. Interdiction formelle de modifier role
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Modification non autorisée du rôle utilisateur';
  END IF;

  -- 3. Interdiction formelle de modifier school_id
  IF OLD.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Modification non autorisée de l’établissement scolaire';
  END IF;

  -- 4. Contrôle strict de la modification de is_active
  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    v_teacher_act_uid := pg_catalog.current_setting('app.teacher_activation_uid', true);
    v_parent_act_uid  := pg_catalog.current_setting('app.parent_activation_uid', true);
    v_student_act_uid := pg_catalog.current_setting('app.student_activation_uid', true);
    v_admin_toggle_uid := pg_catalog.current_setting('app.admin_profile_toggle_uid', true);
    v_admin_toggle_action := pg_catalog.current_setting('app.admin_profile_toggle_action', true);

    -- Cas A : Auto-activation Enseignant (false -> true)
    IF OLD.is_active = false
       AND NEW.is_active = true
       AND OLD.role = 'teacher'
       AND NEW.role = 'teacher'
       AND OLD.school_id IS NOT DISTINCT FROM NEW.school_id
       AND NEW.id = auth.uid()
       AND v_teacher_act_uid = NEW.id::text
    THEN
      SELECT school_id, account_status, employment_status
      INTO v_teacher_school_id, v_teacher_account_status, v_teacher_emp_status
      FROM public.teachers
      WHERE profile_id = NEW.id;

      IF NEW.school_id IS NOT NULL THEN
        SELECT status INTO v_school_status FROM public.schools WHERE id = NEW.school_id;
      END IF;

      IF v_teacher_school_id IS NOT NULL
         AND v_teacher_school_id = NEW.school_id
         AND v_teacher_account_status = 'invited'
         AND v_teacher_emp_status = 'active'
         AND v_school_status = 'active'
      THEN
        RETURN NEW;
      END IF;
    END IF;

    -- Cas B : Auto-activation Parent (false -> true) - Multi-Écoles compatible
    IF OLD.is_active = false
       AND NEW.is_active = true
       AND OLD.role = 'parent'
       AND NEW.role = 'parent'
       AND OLD.school_id IS NOT DISTINCT FROM NEW.school_id
       AND NEW.id = auth.uid()
       AND v_parent_act_uid = NEW.id::text
    THEN
      SELECT school_id, account_status INTO v_parent_school_id, v_parent_acc_status
      FROM public.parent_accounts
      WHERE profile_id = NEW.id;

      IF NEW.school_id IS NOT NULL THEN
        SELECT status INTO v_school_status FROM public.schools WHERE id = NEW.school_id;
      ELSE
        v_school_status := 'active';
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.parent_student_links psl
        JOIN public.students st ON st.id = psl.student_id
        WHERE psl.parent_profile_id = NEW.id
          AND psl.status = 'approved'
      ) INTO v_has_approved_link;

      IF (v_parent_acc_status IN ('invited', 'active'))
         AND v_has_approved_link
         AND (v_school_status IS NULL OR v_school_status = 'active')
      THEN
        RETURN NEW;
      END IF;
    END IF;

    -- Cas C : Auto-activation Élève (false -> true)
    IF OLD.is_active = false
       AND NEW.is_active = true
       AND OLD.role = 'student'
       AND NEW.role = 'student'
       AND OLD.school_id IS NOT DISTINCT FROM NEW.school_id
       AND NEW.id = auth.uid()
       AND v_student_act_uid = NEW.id::text
    THEN
      IF NEW.school_id IS NOT NULL THEN
        SELECT status INTO v_school_status FROM public.schools WHERE id = NEW.school_id;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.students st
        JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = st.school_id
        JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = st.school_id
        WHERE st.profile_id = NEW.id
          AND st.school_id = NEW.school_id
          AND st.account_status = 'invited'
          AND se.status = 'active'
          AND ay.is_current = true
      ) INTO v_has_valid_student;

      IF v_has_valid_student AND v_school_status = 'active' THEN
        RETURN NEW;
      END IF;
    END IF;

    -- Cas D : Modification administrative par School Admin (suspend / reactivate)
    IF v_admin_toggle_uid = NEW.id::text THEN
      SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
      FROM public.profiles WHERE id = auth.uid();

      IF v_caller_role = 'school_admin' AND v_caller_active AND v_caller_school_id = NEW.school_id THEN
        SELECT status INTO v_school_status FROM public.schools WHERE id = NEW.school_id;

        IF v_admin_toggle_action = 'suspend' AND NEW.is_active = false THEN
          RETURN NEW;
        END IF;

        IF v_admin_toggle_action = 'reactivate' AND NEW.is_active = true AND v_school_status = 'active' THEN
          RETURN NEW;
        END IF;
      END IF;
    END IF;

    RAISE EXCEPTION 'Modification non autorisée du statut de compte';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. INTERNAL HELPER: find_auth_user_by_email
CREATE OR REPLACE FUNCTION public.find_auth_user_by_email(p_email TEXT)
RETURNS TABLE (
  user_id UUID,
  email_normalized TEXT,
  email_confirmed BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_norm TEXT;
  v_count INT;
BEGIN
  IF p_email IS NULL OR pg_catalog.btrim(p_email) = '' THEN
    RETURN;
  END IF;

  v_norm := public.normalize_email(p_email);

  SELECT COUNT(*) INTO v_count
  FROM auth.users u
  WHERE public.normalize_email(u.email) = v_norm;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'Doublons normaux détectés dans Auth pour l’email %', v_norm USING ERRCODE = '23505';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    v_norm AS email_normalized,
    (u.email_confirmed_at IS NOT NULL) AS email_confirmed
  FROM auth.users u
  WHERE public.normalize_email(u.email) = v_norm
  LIMIT 1;
END;
$$;

ALTER FUNCTION public.find_auth_user_by_email(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.find_auth_user_by_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_by_email(TEXT) TO service_role;

-- 3. INTERNAL RPC: create_parent_membership_invitation
CREATE OR REPLACE FUNCTION public.create_parent_membership_invitation(
  p_invited_by UUID,
  p_email TEXT,
  p_auth_user_id UUID,
  p_token_hash TEXT,
  p_student_ids UUID[],
  p_students_metadata JSONB,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  invitation_id UUID,
  school_id UUID
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_school_id UUID;
  v_email_norm TEXT;
  v_token_hash_clean TEXT;
  v_school_id UUID;
  v_student_id UUID;
  v_invitation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_elem JSONB;
  v_meta_student_id UUID;
  v_rel TEXT;
  v_is_pri BOOLEAN;
  v_academic BOOLEAN;
  v_attendance BOOLEAN;
  v_homework BOOLEAN;
  v_finances BOOLEAN;
  v_pickup BOOLEAN;
  v_notif BOOLEAN;
  v_st_count INT;
  v_sch_count INT;
BEGIN
  -- 1. Validate inviter
  IF p_invited_by IS NULL THEN
    RAISE EXCEPTION 'REJET : Identifiant administrateur obligatoire.' USING ERRCODE = '42501';
  END IF;

  SELECT sm.school_id INTO v_admin_school_id
  FROM public.profiles p
  JOIN public.school_memberships sm ON sm.profile_id = p.id AND sm.role = 'school_admin' AND sm.status = 'active'
  WHERE p.id = p_invited_by AND p.is_active = true;

  IF v_admin_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur d’école actif peut créer une invitation parent.' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate email
  IF p_email IS NULL OR pg_catalog.btrim(p_email) = '' THEN
    RAISE EXCEPTION 'REJET : Adresse email obligatoire.' USING ERRCODE = '22023';
  END IF;
  v_email_norm := public.normalize_email(p_email);

  -- 3. Validate token hash (64 hex chars)
  v_token_hash_clean := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_token_hash, '')));
  IF v_token_hash_clean !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'REJET : Hash de jeton invalide (64 caractères hexadécimaux requis).' USING ERRCODE = '22023';
  END IF;

  -- 4. Validate students list
  IF p_student_ids IS NULL OR pg_catalog.cardinality(p_student_ids) = 0 THEN
    RAISE EXCEPTION 'REJET : Au moins un élève doit être sélectionné.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT s.school_id), (pg_catalog.array_agg(s.school_id))[1], COUNT(DISTINCT s.id)
  INTO v_sch_count, v_school_id, v_st_count
  FROM public.students s
  WHERE s.id = ANY(p_student_ids);

  IF v_st_count <> pg_catalog.cardinality(p_student_ids) THEN
    RAISE EXCEPTION 'REJET : Un ou plusieurs élèves spécifiés n’existent pas.' USING ERRCODE = '22023';
  END IF;

  IF v_school_id IS NULL OR v_school_id <> v_admin_school_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : Les élèves doivent appartenir à l’établissement de l’administrateur invitant.' USING ERRCODE = '42501';
  END IF;

  -- 5. Strict Validation of p_students_metadata JSONB
  IF p_students_metadata IS NULL OR pg_catalog.jsonb_typeof(p_students_metadata) <> 'array' THEN
    RAISE EXCEPTION 'REJET : Métadonnées élèves invalides (tableau JSONB requis).' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_array_length(p_students_metadata) <> pg_catalog.cardinality(p_student_ids) THEN
    RAISE EXCEPTION 'REJET : Nombre de métadonnées ne correspond pas au nombre d’élèves.' USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_students_metadata)
  LOOP
    IF pg_catalog.jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'REJET : Chaque élément de métadonnées doit être un objet JSON.' USING ERRCODE = '22023';
    END IF;

    IF (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(v_elem)) <> 9 THEN
      RAISE EXCEPTION 'REJET : Structure JSONB invalide ou clés inattendues détectées.' USING ERRCODE = '22023';
    END IF;

    IF v_elem->>'student_id' IS NULL OR v_elem->>'student_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'REJET : Identifiant élève invalide dans les métadonnées.' USING ERRCODE = '22023';
    END IF;

    v_meta_student_id := (v_elem->>'student_id')::uuid;
    IF NOT (v_meta_student_id = ANY(p_student_ids)) THEN
      RAISE EXCEPTION 'REJET : L’élève % présent dans les métadonnées ne correspond pas à la liste.', v_meta_student_id USING ERRCODE = '22023';
    END IF;

    v_rel := v_elem->>'relationship';
    IF v_rel IS NULL OR v_rel NOT IN ('father', 'mother', 'guardian', 'parent', 'legal_guardian', 'other') THEN
      RAISE EXCEPTION 'REJET : Relation invalide pour l’élève %.', v_meta_student_id USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_typeof(v_elem->'is_primary') <> 'boolean' OR
       pg_catalog.jsonb_typeof(v_elem->'can_view_academic') <> 'boolean' OR
       pg_catalog.jsonb_typeof(v_elem->'can_view_attendance') <> 'boolean' OR
       pg_catalog.jsonb_typeof(v_elem->'can_view_homework') <> 'boolean' OR
       pg_catalog.jsonb_typeof(v_elem->'can_view_finances') <> 'boolean' OR
       pg_catalog.jsonb_typeof(v_elem->'can_pickup_student') <> 'boolean' OR
       pg_catalog.jsonb_typeof(v_elem->'can_receive_notifications') <> 'boolean' THEN
      RAISE EXCEPTION 'REJET : Les permissions doivent être des booléens JSON (true/false).' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 6. Expiration (max 72h)
  IF p_expires_at IS NULL THEN
    v_expires_at := pg_catalog.now() + INTERVAL '72 hours';
  ELSE
    IF p_expires_at > (pg_catalog.now() + INTERVAL '72 hours') THEN
      v_expires_at := pg_catalog.now() + INTERVAL '72 hours';
    ELSE
      v_expires_at := p_expires_at;
    END IF;
  END IF;

  -- 7. Lock & transition expired pending invitations for this school, email, role
  UPDATE public.school_membership_invitations smi
  SET status = 'expired', updated_at = pg_catalog.now()
  WHERE smi.school_id = v_school_id
    AND smi.email_normalized = v_email_norm
    AND smi.intended_role = 'parent'
    AND smi.status = 'pending'
    AND smi.expires_at <= pg_catalog.now();

  -- Check duplicate pending invitation in same school & role
  IF EXISTS (
    SELECT 1 FROM public.school_membership_invitations smi
    WHERE smi.school_id = v_school_id
      AND smi.email_normalized = v_email_norm
      AND smi.intended_role = 'parent'
      AND smi.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'INVITATION_ALREADY_PENDING: Une invitation parent en attente existe déjà pour cet email dans cet établissement.' USING ERRCODE = '23505';
  END IF;

  -- 8. Insert invitation
  INSERT INTO public.school_membership_invitations (
    school_id,
    email_normalized,
    auth_user_id,
    intended_role,
    token_hash,
    status,
    expires_at,
    invited_by,
    created_at,
    updated_at
  ) VALUES (
    v_school_id,
    v_email_norm,
    p_auth_user_id,
    'parent',
    v_token_hash_clean,
    'pending',
    v_expires_at,
    p_invited_by,
    pg_catalog.now(),
    pg_catalog.now()
  ) RETURNING id INTO v_invitation_id;

  -- 9. Insert invited students
  FOREACH v_student_id IN ARRAY p_student_ids
  LOOP
    SELECT
      elem->>'relationship',
      (elem->'is_primary')::boolean,
      (elem->'can_view_academic')::boolean,
      (elem->'can_view_attendance')::boolean,
      (elem->'can_view_homework')::boolean,
      (elem->'can_view_finances')::boolean,
      (elem->'can_pickup_student')::boolean,
      (elem->'can_receive_notifications')::boolean
    INTO v_rel, v_is_pri, v_academic, v_attendance, v_homework, v_finances, v_pickup, v_notif
    FROM pg_catalog.jsonb_array_elements(p_students_metadata) elem
    WHERE (elem->>'student_id')::uuid = v_student_id
    LIMIT 1;

    INSERT INTO public.school_membership_invitation_students (
      invitation_id,
      student_id,
      school_id,
      relationship,
      is_primary,
      can_view_academic,
      can_view_attendance,
      can_view_homework,
      can_view_finances,
      can_pickup_student,
      can_receive_notifications,
      created_at
    ) VALUES (
      v_invitation_id,
      v_student_id,
      v_school_id,
      v_rel,
      v_is_pri,
      v_academic,
      v_attendance,
      v_homework,
      v_finances,
      v_pickup,
      v_notif,
      pg_catalog.now()
    );
  END LOOP;

  RETURN QUERY SELECT v_invitation_id, v_school_id;
END;
$$;

ALTER FUNCTION public.create_parent_membership_invitation(UUID, TEXT, UUID, TEXT, UUID[], JSONB, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_parent_membership_invitation(UUID, TEXT, UUID, TEXT, UUID[], JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_parent_membership_invitation(UUID, TEXT, UUID, TEXT, UUID[], JSONB, TIMESTAMPTZ) TO service_role;

-- 4. PUBLIC RPC: accept_parent_school_invitation
CREATE OR REPLACE FUNCTION public.accept_parent_school_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_email TEXT;
  v_caller_norm_email TEXT;
  v_computed_hash TEXT;
  v_inv RECORD;
  v_inv_student RECORD;
  v_school_status TEXT;
  v_caller_email_confirmed_at TIMESTAMPTZ;
  v_school_name TEXT;
  v_profile_exists BOOLEAN;
  v_profile_role TEXT;
  v_existing_membership_status TEXT;
  v_parent_account_status TEXT;
  v_existing_link RECORD;
  v_st_exists BOOLEAN;
  v_accepted_count INT := 0;
BEGIN
  -- 1. Resolve caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise pour accepter l’invitation.' USING ERRCODE = '42501';
  END IF;

  -- 2. Resolve caller's email and email_confirmed_at
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

  -- 4. Find & lock pending invitation
  SELECT smi.* INTO v_inv
  FROM public.school_membership_invitations smi
  WHERE smi.token_hash = v_computed_hash
    AND smi.intended_role = 'parent'
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Jeton d’invitation invalide ou inconnu.' USING ERRCODE = '22023';
  END IF;

  -- 5. Status & expiration check
  IF v_inv.status <> 'pending' THEN
    IF v_inv.status = 'accepted' THEN
      RAISE EXCEPTION 'REJET : Cette invitation a déjà été acceptée.' USING ERRCODE = '22023';
    ELSIF v_inv.status = 'revoked' THEN
      RAISE EXCEPTION 'REJET : Cette invitation a été révoquée.' USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'REJET : L’invitation n’est plus valide.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_inv.expires_at <= pg_catalog.now() THEN
    UPDATE public.school_membership_invitations
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = v_inv.id;
    RAISE EXCEPTION 'REJET : L’invitation a expiré.' USING ERRCODE = '22023';
  END IF;

  IF v_inv.email_normalized <> v_caller_norm_email THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’adresse email du compte connecté ne correspond pas à l’invitation.' USING ERRCODE = '42501';
  END IF;

  IF v_inv.auth_user_id IS NOT NULL AND v_inv.auth_user_id <> v_caller_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : Ce jeton d’invitation est réservé à un autre compte d’authentification.' USING ERRCODE = '42501';
  END IF;

  -- 6. Verify school active
  SELECT s.status, s.name INTO v_school_status, v_school_name
  FROM public.schools s
  WHERE s.id = v_inv.school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'REJET : L’établissement scolaire est inactif ou suspendu.' USING ERRCODE = '42501';
  END IF;

  -- 7. Profile & parent_account compatibility check
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

  -- 8. School membership handling
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

  -- 9. Parent-student links handling
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

  -- 9b. Activate Parent profile if inactive (authorized via app.parent_activation_uid)
  PERFORM pg_catalog.set_config('app.parent_activation_uid', v_caller_id::text, true);

  UPDATE public.profiles
  SET is_active = true, updated_at = pg_catalog.now()
  WHERE id = v_caller_id AND is_active = false;

  -- 10. Mark accepted
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
