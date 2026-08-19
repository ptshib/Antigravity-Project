-- ============================================================================
-- Migration Phase 2E.1 : Activation Sécurisée des Comptes Parents et Élèves (Dernières Corrections Bloquantes)
-- Fichier : supabase/migrations/20260818120000_parent_student_portal_activation.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION DES TABLES ET STRUCTURES DE STATUT DURABLES
--------------------------------------------------------------------------------

-- A. Table public.students (coordonnées numériques)
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS email TEXT NULL,
  ADD COLUMN IF NOT EXISTS phone TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_school_student_email
  ON public.students (school_id, LOWER(TRIM(email)))
  WHERE (email IS NOT NULL AND TRIM(email) <> '');

CREATE INDEX IF NOT EXISTS idx_students_profile_id
  ON public.students (profile_id);

-- B. Table public.parent_student_links (permissions granulaires et contraintes)
ALTER TABLE public.parent_student_links
  ADD COLUMN IF NOT EXISTS can_view_academic BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_attendance BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_homework BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_finances BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_receive_notifications BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_pickup_student BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_parent_link_status' AND conrelid = 'public.parent_student_links'::regclass
  ) THEN
    ALTER TABLE public.parent_student_links 
      ADD CONSTRAINT chk_parent_link_status CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'));
  END IF;
END $$;

-- C. Table public.parent_accounts (statut durable du compte parent par établissement)
CREATE TABLE IF NOT EXISTS public.parent_accounts (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  account_status TEXT NOT NULL DEFAULT 'invited' CONSTRAINT chk_parent_account_status CHECK (account_status IN ('invited', 'active', 'suspended')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ NULL,
  suspended_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_accounts_school_status
  ON public.parent_accounts (school_id, account_status);

ALTER TABLE public.parent_accounts ENABLE ROW LEVEL SECURITY;

-- D. Table public.school_portal_invitations (jetons serveur à usage unique avec payload vérifiable)
CREATE TABLE IF NOT EXISTS public.school_portal_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role TEXT NOT NULL CONSTRAINT chk_portal_invitation_role CHECK (role IN ('parent', 'student')),
  email TEXT NOT NULL,
  auth_user_id UUID NOT NULL UNIQUE,
  invitation_token TEXT NOT NULL UNIQUE,
  entity_id UUID NULL,
  payload JSONB NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_portal_invitations_token
  ON public.school_portal_invitations (invitation_token)
  WHERE consumed_at IS NULL;

ALTER TABLE public.school_portal_invitations ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 2. TRIGGER DE SÉCURITÉ SUR PUBLIC.PROFILES (AUTORISATION STRICTE DES TRANSITIONS)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_sensitive_profile_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    v_teacher_act_uid := current_setting('app.teacher_activation_uid', true);
    v_parent_act_uid  := current_setting('app.parent_activation_uid', true);
    v_student_act_uid := current_setting('app.student_activation_uid', true);
    v_admin_toggle_uid := current_setting('app.admin_profile_toggle_uid', true);
    v_admin_toggle_action := current_setting('app.admin_profile_toggle_action', true);

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

    -- Cas B : Auto-activation Parent (false -> true) - Exige un lien 'approved'
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
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.parent_student_links psl
        JOIN public.students st ON st.id = psl.student_id
        WHERE psl.parent_profile_id = NEW.id
          AND psl.school_id = NEW.school_id
          AND st.school_id = NEW.school_id
          AND psl.status = 'approved'
      ) INTO v_has_approved_link;

      IF v_parent_acc_status = 'invited'
         AND v_parent_school_id = NEW.school_id
         AND v_has_approved_link
         AND v_school_status = 'active'
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
        
        -- Suspension autorisée même si l'école est suspendue
        IF v_admin_toggle_action = 'suspend' AND NEW.is_active = false THEN
          RETURN NEW;
        END IF;

        -- Réactivation exige impérativement une école active
        IF v_admin_toggle_action = 'reactivate' AND NEW.is_active = true AND v_school_status = 'active' THEN
          RETURN NEW;
        END IF;
      END IF;
    END IF;

    RAISE EXCEPTION 'Modification non autorisée du statut de compte';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sensitive_profile_updates ON public.profiles;
CREATE TRIGGER trg_prevent_sensitive_profile_updates
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_sensitive_profile_updates();

--------------------------------------------------------------------------------
-- 3. HELPERS ANTI-RÉCURSION SÉCURISÉS (SECURITY DEFINER)
--------------------------------------------------------------------------------

-- Helper A : Notes, Évaluations et Résultats
CREATE OR REPLACE FUNCTION public.can_parent_view_academic(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id AND pa.school_id = p.school_id
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id AND psl.student_id = p_student_id AND psl.school_id = p.school_id
    JOIN public.students st ON st.id = p_student_id AND st.school_id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role = 'parent'
      AND p.is_active = true
      AND pa.account_status = 'active'
      AND s.status = 'active'
      AND psl.status = 'approved'
      AND psl.can_view_academic = true
  );
$$;

-- Helper B : Présences
CREATE OR REPLACE FUNCTION public.can_parent_view_attendance(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id AND pa.school_id = p.school_id
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id AND psl.student_id = p_student_id AND psl.school_id = p.school_id
    JOIN public.students st ON st.id = p_student_id AND st.school_id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role = 'parent'
      AND p.is_active = true
      AND pa.account_status = 'active'
      AND s.status = 'active'
      AND psl.status = 'approved'
      AND psl.can_view_attendance = true
  );
$$;

-- Helper C : Devoirs et Cahier de Textes
CREATE OR REPLACE FUNCTION public.can_parent_view_homework(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id AND pa.school_id = p.school_id
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id AND psl.student_id = p_student_id AND psl.school_id = p.school_id
    JOIN public.students st ON st.id = p_student_id AND st.school_id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role = 'parent'
      AND p.is_active = true
      AND pa.account_status = 'active'
      AND s.status = 'active'
      AND psl.status = 'approved'
      AND psl.can_view_homework = true
  );
$$;

-- Helper D : Finances Scolaires
CREATE OR REPLACE FUNCTION public.can_parent_view_finances(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id AND pa.school_id = p.school_id
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id AND psl.student_id = p_student_id AND psl.school_id = p.school_id
    JOIN public.students st ON st.id = p_student_id AND st.school_id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role = 'parent'
      AND p.is_active = true
      AND pa.account_status = 'active'
      AND s.status = 'active'
      AND psl.status = 'approved'
      AND psl.can_view_finances = true
  );
$$;

-- Helper E : Alertes et Notifications
CREATE OR REPLACE FUNCTION public.can_parent_receive_notifications(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id AND pa.school_id = p.school_id
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id AND psl.student_id = p_student_id AND psl.school_id = p.school_id
    JOIN public.students st ON st.id = p_student_id AND st.school_id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role = 'parent'
      AND p.is_active = true
      AND pa.account_status = 'active'
      AND s.status = 'active'
      AND psl.status = 'approved'
      AND psl.can_receive_notifications = true
  );
$$;

-- Helper F : Autorisation Récupération Enfant Sortie
CREATE OR REPLACE FUNCTION public.can_parent_pickup_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id AND pa.school_id = p.school_id
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id AND psl.student_id = p_student_id AND psl.school_id = p.school_id
    JOIN public.students st ON st.id = p_student_id AND st.school_id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role = 'parent'
      AND p.is_active = true
      AND pa.account_status = 'active'
      AND s.status = 'active'
      AND psl.status = 'approved'
      AND psl.can_pickup_student = true
  );
$$;

-- Helper G : Relation Parent Validée
CREATE OR REPLACE FUNCTION public.is_parent_of_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id AND pa.school_id = p.school_id
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id AND psl.student_id = target_student_id AND psl.school_id = p.school_id
    JOIN public.students st ON st.id = target_student_id AND st.school_id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role = 'parent'
      AND p.is_active = true
      AND pa.account_status = 'active'
      AND s.status = 'active'
      AND psl.status = 'approved'
  );
$$;

--------------------------------------------------------------------------------
-- 4. RPC TRANSACTIONNELLE D'INVITATION PARENT (PROCESS_PARENT_INVITATION)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_parent_invitation(
  p_invitation_token TEXT,
  p_user_id UUID,
  p_school_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_relationship TEXT,
  p_student_ids UUID[],
  p_permissions JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation RECORD;
  v_school RECORD;
  v_existing_prof RECORD;
  v_existing_parent_acc RECORD;
  v_student_id UUID;
  v_student_school_id UUID;
  v_relationship TEXT;
  v_can_view_academic BOOLEAN := false;
  v_can_view_attendance BOOLEAN := false;
  v_can_view_homework BOOLEAN := false;
  v_can_view_finances BOOLEAN := false;
  v_can_receive_notifications BOOLEAN := false;
  v_can_pickup_student BOOLEAN := false;
  v_existing_link RECORD;
  v_clean_email TEXT;
  v_sorted_input_ids UUID[];
  v_sorted_payload_ids UUID[];
  v_canonical_perms JSONB;
  v_payload_perms JSONB;
  v_payload_relationship TEXT;
BEGIN
  -- 1. Validation du jeton serveur à usage unique
  IF p_invitation_token IS NULL OR TRIM(p_invitation_token) = '' THEN
    RAISE EXCEPTION 'Jeton d’invitation serveur manquant';
  END IF;

  SELECT * INTO v_invitation
  FROM public.school_portal_invitations
  WHERE invitation_token = p_invitation_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jeton d’invitation serveur introuvable ou invalide';
  END IF;

  IF v_invitation.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ce jeton d’invitation a déjà été consommé';
  END IF;

  IF v_invitation.expires_at < now() THEN
    RAISE EXCEPTION 'Ce jeton d’invitation a expiré';
  END IF;

  v_clean_email := LOWER(TRIM(p_email));

  IF v_invitation.auth_user_id <> p_user_id
     OR v_invitation.school_id <> p_school_id
     OR LOWER(TRIM(v_invitation.email)) <> v_clean_email
     OR v_invitation.role <> 'parent'
  THEN
    RAISE EXCEPTION 'Incohérence stricte détectée entre le jeton d’invitation et les paramètres fournis';
  END IF;

  -- 2. Validation de la relation canonique
  v_relationship := TRIM(p_relationship);
  IF v_relationship IN ('Père', 'father') THEN
    v_relationship := 'father';
  ELSIF v_relationship IN ('Mère', 'mother') THEN
    v_relationship := 'mother';
  ELSIF v_relationship IN ('Tuteur', 'Tutrice', 'guardian') THEN
    v_relationship := 'guardian';
  ELSIF v_relationship IN ('Responsable légal', 'legal_guardian') THEN
    v_relationship := 'legal_guardian';
  ELSIF v_relationship IN ('Personne autorisée à récupérer', 'pickup_authorized') THEN
    v_relationship := 'pickup_authorized';
  ELSIF v_relationship IN ('Autre', 'other') THEN
    v_relationship := 'other';
  ELSE
    RAISE EXCEPTION 'Type de relation non reconnu : %', p_relationship;
  END IF;

  -- 3. Construction des permissions canoniques reçues
  IF p_permissions IS NOT NULL AND jsonb_typeof(p_permissions) = 'object' THEN
    v_can_view_academic         := COALESCE((p_permissions->>'can_view_academic')::boolean, false);
    v_can_view_attendance       := COALESCE((p_permissions->>'can_view_attendance')::boolean, false);
    v_can_view_homework         := COALESCE((p_permissions->>'can_view_homework')::boolean, false);
    v_can_view_finances         := COALESCE((p_permissions->>'can_view_finances')::boolean, false);
    v_can_receive_notifications := COALESCE((p_permissions->>'can_receive_notifications')::boolean, false);
    v_can_pickup_student        := COALESCE((p_permissions->>'can_pickup_student')::boolean, false);
  END IF;

  IF v_relationship = 'pickup_authorized' THEN
    v_can_view_academic         := false;
    v_can_view_attendance       := false;
    v_can_view_homework         := false;
    v_can_view_finances         := false;
    v_can_receive_notifications := false;
    v_can_pickup_student        := true;
  END IF;

  v_canonical_perms := jsonb_build_object(
    'can_view_academic', v_can_view_academic,
    'can_view_attendance', v_can_view_attendance,
    'can_view_homework', v_can_view_homework,
    'can_view_finances', v_can_view_finances,
    'can_receive_notifications', v_can_receive_notifications,
    'can_pickup_student', v_can_pickup_student
  );

  -- 4. Vérification stricte contre le payload du jeton
  IF v_invitation.payload IS NULL OR jsonb_typeof(v_invitation.payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload d’invitation serveur manquant ou corrompu';
  END IF;

  v_payload_relationship := v_invitation.payload->>'relationship';
  IF v_payload_relationship IS DISTINCT FROM v_relationship THEN
    RAISE EXCEPTION 'La relation spécifiée (%) ne correspond pas au jeton d’invitation (%)', v_relationship, v_payload_relationship;
  END IF;

  -- Construction des permissions canoniques du payload
  IF v_relationship = 'pickup_authorized' THEN
    v_payload_perms := jsonb_build_object(
      'can_view_academic', false,
      'can_view_attendance', false,
      'can_view_homework', false,
      'can_view_finances', false,
      'can_receive_notifications', false,
      'can_pickup_student', true
    );
  ELSE
    v_payload_perms := jsonb_build_object(
      'can_view_academic', COALESCE((v_invitation.payload->'permissions'->>'can_view_academic')::boolean, false),
      'can_view_attendance', COALESCE((v_invitation.payload->'permissions'->>'can_view_attendance')::boolean, false),
      'can_view_homework', COALESCE((v_invitation.payload->'permissions'->>'can_view_homework')::boolean, false),
      'can_view_finances', COALESCE((v_invitation.payload->'permissions'->>'can_view_finances')::boolean, false),
      'can_receive_notifications', COALESCE((v_invitation.payload->'permissions'->>'can_receive_notifications')::boolean, false),
      'can_pickup_student', COALESCE((v_invitation.payload->'permissions'->>'can_pickup_student')::boolean, false)
    );
  END IF;

  IF v_canonical_perms IS DISTINCT FROM v_payload_perms THEN
    RAISE EXCEPTION 'Les permissions transmises diffèrent du payload sécurisé du jeton d’invitation';
  END IF;

  -- Comparaison indépendante de l'ordre des student_ids
  IF p_student_ids IS NULL OR array_length(p_student_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Au moins un élève doit être rattaché au compte parent';
  END IF;

  IF (SELECT COUNT(*) FROM unnest(p_student_ids)) <> (SELECT COUNT(DISTINCT x) FROM unnest(p_student_ids) x) THEN
    RAISE EXCEPTION 'La liste des élèves rattachés contient des identifiants en double';
  END IF;

  SELECT array_agg(x ORDER BY x) INTO v_sorted_input_ids FROM unnest(p_student_ids) x;
  SELECT array_agg((value#>>'{}')::uuid ORDER BY (value#>>'{}')::uuid) INTO v_sorted_payload_ids
  FROM jsonb_array_elements(v_invitation.payload->'student_ids');

  IF v_sorted_input_ids IS DISTINCT FROM v_sorted_payload_ids THEN
    RAISE EXCEPTION 'La liste des élèves spécifiée ne correspond pas exactement au jeton d’invitation sécurisé';
  END IF;

  -- 5. Validation de l'établissement
  SELECT * INTO v_school FROM public.schools WHERE id = p_school_id FOR UPDATE;
  IF NOT FOUND OR v_school.status <> 'active' THEN
    RAISE EXCEPTION 'Établissement scolaire inactif ou introuvable';
  END IF;

  -- 6. Validation des élèves appartenant à l'école
  FOREACH v_student_id IN ARRAY p_student_ids LOOP
    SELECT school_id INTO v_student_school_id
    FROM public.students
    WHERE id = v_student_id
    FOR UPDATE;

    IF v_student_school_id IS NULL THEN
      RAISE EXCEPTION 'Élève % introuvable', v_student_id;
    END IF;

    IF v_student_school_id <> p_school_id THEN
      RAISE EXCEPTION 'L’élève % n’appartient pas à cet établissement', v_student_id;
    END IF;
  END LOOP;

  -- 7. Contrôle strict et NULL-safe du profil préexistant
  SELECT * INTO v_existing_prof FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF v_existing_prof IS NOT NULL THEN
    IF v_existing_prof.school_id IS DISTINCT FROM p_school_id THEN
      RAISE EXCEPTION 'Ce profil utilisateur est déjà assigné à un autre établissement';
    END IF;
    IF v_existing_prof.role IS DISTINCT FROM 'parent' THEN
      RAISE EXCEPTION 'Ce compte utilisateur possède un rôle incompatible (%)', v_existing_prof.role;
    END IF;
    IF v_existing_prof.is_active IS TRUE THEN
      RAISE EXCEPTION 'Ce compte utilisateur est déjà actif';
    END IF;

    SELECT * INTO v_existing_parent_acc FROM public.parent_accounts WHERE profile_id = p_user_id FOR UPDATE;
    IF v_existing_parent_acc IS NOT NULL THEN
      IF v_existing_parent_acc.school_id IS DISTINCT FROM p_school_id THEN
        RAISE EXCEPTION 'Ce compte parent est déjà rattaché à un autre établissement';
      END IF;
      IF v_existing_parent_acc.account_status = 'active' THEN
        RAISE EXCEPTION 'Ce compte parent est déjà actif.';
      ELSIF v_existing_parent_acc.account_status = 'suspended' THEN
        RAISE EXCEPTION 'Ce compte parent est actuellement suspendu. Utilisez la réactivation administrative.';
      ELSIF v_existing_parent_acc.account_status <> 'invited' THEN
        RAISE EXCEPTION 'Statut du compte parent incompatible (%)', v_existing_parent_acc.account_status;
      END IF;
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
      p_user_id,
      p_school_id,
      'parent',
      TRIM(p_first_name),
      TRIM(p_last_name),
      false,
      now(),
      now()
    );
  END IF;

  -- 8. Création ou mise à jour de parent_accounts (avec vérification école existante)
  SELECT * INTO v_existing_parent_acc FROM public.parent_accounts WHERE profile_id = p_user_id FOR UPDATE;
  IF v_existing_parent_acc IS NOT NULL AND v_existing_parent_acc.school_id IS DISTINCT FROM p_school_id THEN
    RAISE EXCEPTION 'Ce compte parent est déjà rattaché à un autre établissement';
  END IF;

  INSERT INTO public.parent_accounts (
    profile_id,
    school_id,
    account_status,
    invited_at,
    updated_at
  ) VALUES (
    p_user_id,
    p_school_id,
    'invited',
    now(),
    now()
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET account_status = 'invited',
      school_id = p_school_id,
      invited_at = now(),
      updated_at = now();

  -- 9. Création des liens parent-élève
  FOREACH v_student_id IN ARRAY p_student_ids LOOP
    SELECT * INTO v_existing_link
    FROM public.parent_student_links
    WHERE school_id = p_school_id
      AND parent_profile_id = p_user_id
      AND student_id = v_student_id
    FOR UPDATE;

    IF v_existing_link IS NOT NULL THEN
      IF v_existing_link.status = 'approved' THEN
        RAISE EXCEPTION 'Un lien approuvé existe déjà pour cet élève. Utilisez la gestion des liens.';
      ELSIF v_existing_link.status IN ('pending', 'rejected', 'revoked') THEN
        RAISE EXCEPTION 'Un lien avec le statut % existe déjà pour cet élève. Utilisez la gestion administrative des liens.', v_existing_link.status;
      END IF;
    ELSE
      INSERT INTO public.parent_student_links (
        school_id,
        parent_profile_id,
        student_id,
        relationship,
        status,
        can_view_academic,
        can_view_attendance,
        can_view_homework,
        can_view_finances,
        can_receive_notifications,
        can_pickup_student,
        created_at,
        updated_at
      ) VALUES (
        p_school_id,
        p_user_id,
        v_student_id,
        v_relationship,
        'approved',
        v_can_view_academic,
        v_can_view_attendance,
        v_can_view_homework,
        v_can_view_finances,
        v_can_receive_notifications,
        v_can_pickup_student,
        now(),
        now()
      );
    END IF;
  END LOOP;

  -- 10. Consommation atomique du jeton
  UPDATE public.school_portal_invitations
  SET consumed_at = now()
  WHERE id = v_invitation.id;

  -- 11. Journal d'audit conforme au schéma réel
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    p_school_id,
    v_invitation.created_by,
    'INVITE_PARENT',
    jsonb_build_object(
      'entity_type', 'parent_account',
      'entity_id', p_user_id,
      'profile_id', p_user_id,
      'email', v_clean_email,
      'relationship', v_relationship,
      'student_ids', p_student_ids,
      'permissions', v_canonical_perms
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 5. RPC TRANSACTIONNELLE D'ACTIVATION PARENT SUR MOT DE PASSE DÉFINI
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.activate_parent_on_password_set()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_profile RECORD;
  v_parent_acc RECORD;
  v_school RECORD;
  v_has_approved_link BOOLEAN;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour activer le compte parent';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_profile.role <> 'parent' THEN
    RAISE EXCEPTION 'Profil parent introuvable ou rôle invalide';
  END IF;

  SELECT * INTO v_parent_acc FROM public.parent_accounts WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compte parent non enregistré dans le registre scolaire';
  END IF;

  -- Exigence stricte : account_status = 'invited' ET profiles.is_active = false
  IF v_parent_acc.account_status <> 'invited' OR v_profile.is_active IS TRUE THEN
    IF v_parent_acc.account_status = 'suspended' THEN
      RAISE EXCEPTION 'Ce compte parent est suspendu administrativement. Activation impossible.';
    ELSIF v_parent_acc.account_status = 'active' THEN
      RAISE EXCEPTION 'Ce compte parent est déjà actif.';
    ELSE
      RAISE EXCEPTION 'Statut du compte parent non éligible à l’activation.';
    END IF;
  END IF;

  SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
  IF NOT FOUND OR v_school.status <> 'active' THEN
    RAISE EXCEPTION 'L’établissement scolaire est inactif ou suspendu. Activation impossible.';
  END IF;

  -- Exige STRICTEMENT au moins un lien approuvé (un lien pending ne suffit pas)
  SELECT EXISTS (
    SELECT 1 FROM public.parent_student_links
    WHERE parent_profile_id = v_uid
      AND school_id = v_profile.school_id
      AND status = 'approved'
  ) INTO v_has_approved_link;

  IF NOT v_has_approved_link THEN
    RAISE EXCEPTION 'Aucun lien élève approuvé n’est associé à ce compte parent. Activation impossible.';
  END IF;

  PERFORM set_config('app.parent_activation_uid', v_uid::text, true);

  UPDATE public.profiles
  SET is_active = true, updated_at = now()
  WHERE id = v_uid;

  UPDATE public.parent_accounts
  SET account_status = 'active', activated_at = now(), updated_at = now()
  WHERE profile_id = v_uid;

  PERFORM set_config('app.parent_activation_uid', '', true);

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 6. RPC TRANSACTIONNELLE D'INVITATION ÉLÈVE (PROCESS_STUDENT_INVITATION)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_student_invitation(
  p_invitation_token TEXT,
  p_user_id UUID,
  p_school_id UUID,
  p_student_id UUID,
  p_email TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation RECORD;
  v_school RECORD;
  v_student RECORD;
  v_existing_prof RECORD;
  v_other_student RECORD;
  v_has_active_enr BOOLEAN;
  v_clean_email TEXT;
BEGIN
  -- 1. Validation du jeton serveur à usage unique
  IF p_invitation_token IS NULL OR TRIM(p_invitation_token) = '' THEN
    RAISE EXCEPTION 'Jeton d’invitation serveur manquant';
  END IF;

  SELECT * INTO v_invitation
  FROM public.school_portal_invitations
  WHERE invitation_token = p_invitation_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jeton d’invitation serveur introuvable ou invalide';
  END IF;

  IF v_invitation.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ce jeton d’invitation a déjà été consommé';
  END IF;

  IF v_invitation.expires_at < now() THEN
    RAISE EXCEPTION 'Ce jeton d’invitation a expiré';
  END IF;

  v_clean_email := LOWER(TRIM(p_email));

  IF v_invitation.auth_user_id <> p_user_id
     OR v_invitation.school_id <> p_school_id
     OR v_invitation.entity_id <> p_student_id
     OR LOWER(TRIM(v_invitation.email)) <> v_clean_email
     OR v_invitation.role <> 'student'
  THEN
    RAISE EXCEPTION 'Incohérence stricte détectée entre le jeton d’invitation et les paramètres fournis';
  END IF;

  -- Validation payload
  IF v_invitation.payload IS NULL
     OR (v_invitation.payload->>'student_id')::uuid <> p_student_id
     OR LOWER(TRIM(v_invitation.payload->>'email')) <> v_clean_email
  THEN
    RAISE EXCEPTION 'Incohérence détectée avec le payload sécurisé du jeton';
  END IF;

  -- 2. Validation de l'établissement
  SELECT * INTO v_school FROM public.schools WHERE id = p_school_id FOR UPDATE;
  IF NOT FOUND OR v_school.status <> 'active' THEN
    RAISE EXCEPTION 'Établissement scolaire inactif ou introuvable';
  END IF;

  -- 3. Validation de l'élève
  SELECT * INTO v_student FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND OR v_student.school_id <> p_school_id THEN
    RAISE EXCEPTION 'Fiche élève introuvable dans cet établissement';
  END IF;

  IF v_student.account_status = 'active' THEN
    RAISE EXCEPTION 'Ce compte élève est déjà actif.';
  ELSIF v_student.account_status = 'suspended' THEN
    RAISE EXCEPTION 'Ce compte élève est actuellement suspendu. Utilisez la réactivation administrative.';
  END IF;

  IF v_student.profile_id IS NOT NULL AND v_student.profile_id <> p_user_id THEN
    RAISE EXCEPTION 'Cette fiche élève est déjà associée à un autre identifiant utilisateur';
  END IF;

  -- Vérifier qu'aucun autre élève n'est lié à cet auth user
  SELECT * INTO v_other_student FROM public.students WHERE profile_id = p_user_id AND id <> p_student_id;
  IF FOUND THEN
    RAISE EXCEPTION 'Ce compte utilisateur Auth est déjà associé à un autre élève (%)', v_other_student.student_number;
  END IF;

  -- 4. Inscription scolaire active obligatoire
  SELECT EXISTS (
    SELECT 1 FROM public.student_enrollments se
    JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
    WHERE se.student_id = p_student_id
      AND se.school_id = p_school_id
      AND se.status = 'active'
      AND ay.is_current = true
  ) INTO v_has_active_enr;

  IF NOT v_has_active_enr THEN
    RAISE EXCEPTION 'L’élève ne dispose d’aucune inscription scolaire active sur l’année courante';
  END IF;

  -- 5. Contrôle strict et NULL-safe du profil existant
  SELECT * INTO v_existing_prof FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF v_existing_prof IS NOT NULL THEN
    IF v_existing_prof.role IS DISTINCT FROM 'student'
       OR v_existing_prof.school_id IS DISTINCT FROM p_school_id
       OR v_existing_prof.is_active IS TRUE
    THEN
      RAISE EXCEPTION 'Incohérence stricte du profil existant (rôle: %, school_id: %, is_active: %)',
        v_existing_prof.role, v_existing_prof.school_id, v_existing_prof.is_active;
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
      p_user_id,
      p_school_id,
      'student',
      COALESCE(v_student.first_name, 'Élève'),
      COALESCE(v_student.last_name, v_student.student_number),
      false,
      now(),
      now()
    );
  END IF;

  -- 6. Mise à jour de la table students
  UPDATE public.students
  SET profile_id = p_user_id,
      email = v_clean_email,
      account_status = 'invited',
      updated_at = now()
  WHERE id = p_student_id;

  -- 7. Consommation du jeton
  UPDATE public.school_portal_invitations
  SET consumed_at = now()
  WHERE id = v_invitation.id;

  -- 8. Journal d'audit conforme au schéma réel
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    p_school_id,
    v_invitation.created_by,
    'INVITE_STUDENT',
    jsonb_build_object(
      'entity_type', 'student_account',
      'entity_id', p_student_id,
      'student_id', p_student_id,
      'profile_id', p_user_id,
      'email', v_clean_email,
      'student_number', v_student.student_number
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 7. RPC TRANSACTIONNELLE D'ACTIVATION ÉLÈVE SUR MOT DE PASSE DÉFINI
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.activate_student_on_password_set()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_profile RECORD;
  v_student RECORD;
  v_school RECORD;
  v_has_active_enrollment BOOLEAN;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour activer le compte élève';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_profile.role <> 'student' THEN
    RAISE EXCEPTION 'Profil élève introuvable ou rôle invalide';
  END IF;

  SELECT * INTO v_student FROM public.students WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiche élève introuvable pour ce compte utilisateur';
  END IF;

  -- Exigence stricte : students.account_status = 'invited' ET profiles.is_active = false
  IF v_student.account_status <> 'invited' OR v_profile.is_active IS TRUE THEN
    IF v_student.account_status = 'suspended' THEN
      RAISE EXCEPTION 'Ce compte élève est suspendu administrativement. Activation impossible.';
    ELSIF v_student.account_status = 'active' THEN
      RAISE EXCEPTION 'Ce compte élève est déjà actif.';
    ELSE
      RAISE EXCEPTION 'Statut du compte élève non éligible à l’activation.';
    END IF;
  END IF;

  SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
  IF NOT FOUND OR v_school.status <> 'active' THEN
    RAISE EXCEPTION 'L’établissement scolaire est inactif ou suspendu. Activation impossible.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.student_enrollments se
    JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
    WHERE se.student_id = v_student.id
      AND se.school_id = v_profile.school_id
      AND se.status = 'active'
      AND ay.is_current = true
  ) INTO v_has_active_enrollment;

  IF NOT v_has_active_enrollment THEN
    RAISE EXCEPTION 'Aucune inscription scolaire active pour cet élève. Activation impossible.';
  END IF;

  PERFORM set_config('app.student_activation_uid', v_uid::text, true);

  UPDATE public.profiles
  SET is_active = true, updated_at = now()
  WHERE id = v_uid;

  UPDATE public.students
  SET account_status = 'active', updated_at = now()
  WHERE id = v_student.id;

  PERFORM set_config('app.student_activation_uid', '', true);

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 8. RPC DE GESTION DU STATUT DU COMPTE PARENT (SUSPEND / REACTIVATE)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.toggle_parent_status(
  p_parent_profile_id UUID,
  p_action TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_parent_profile RECORD;
  v_parent_acc RECORD;
  v_school RECORD;
  v_new_active BOOLEAN;
  v_new_status TEXT;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_caller_uid;

  IF v_caller_role <> 'school_admin' AND v_caller_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l’établissement.';
  END IF;

  IF NOT v_caller_active THEN
    RAISE EXCEPTION 'Votre compte administrateur est inactif.';
  END IF;

  SELECT * INTO v_parent_profile FROM public.profiles WHERE id = p_parent_profile_id FOR UPDATE;
  IF NOT FOUND OR v_parent_profile.role <> 'parent' THEN
    RAISE EXCEPTION 'Profil parent introuvable.';
  END IF;

  IF v_caller_role = 'school_admin' AND v_caller_school_id <> v_parent_profile.school_id THEN
    RAISE EXCEPTION 'Accès non autorisé aux comptes d’un autre établissement.';
  END IF;

  SELECT * INTO v_parent_acc FROM public.parent_accounts WHERE profile_id = p_parent_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiche de compte parent introuvable.';
  END IF;

  SELECT * INTO v_school FROM public.schools WHERE id = v_parent_profile.school_id;

  IF p_action = 'suspend' THEN
    IF v_parent_acc.account_status <> 'active' THEN
      RAISE EXCEPTION 'Seul un compte parent actif peut être suspendu (statut actuel : %).', v_parent_acc.account_status;
    END IF;
    v_new_active := false;
    v_new_status := 'suspended';
  ELSIF p_action = 'reactivate' THEN
    IF v_parent_acc.account_status <> 'suspended' THEN
      RAISE EXCEPTION 'Seul un compte parent suspendu peut être réactivé (statut actuel : %).', v_parent_acc.account_status;
    END IF;
    IF v_school.status <> 'active' THEN
      RAISE EXCEPTION 'Impossible de réactiver un compte dans un établissement inactif ou suspendu.';
    END IF;
    v_new_active := true;
    v_new_status := 'active';
  ELSE
    RAISE EXCEPTION 'Action non reconnue : %. Seules "suspend" et "reactivate" sont valides.', p_action;
  END IF;

  PERFORM set_config('app.admin_profile_toggle_uid', p_parent_profile_id::text, true);
  PERFORM set_config('app.admin_profile_toggle_action', p_action, true);

  UPDATE public.profiles
  SET is_active = v_new_active, updated_at = now()
  WHERE id = p_parent_profile_id;

  UPDATE public.parent_accounts
  SET account_status = v_new_status,
      suspended_at = CASE WHEN p_action = 'suspend' THEN now() ELSE suspended_at END,
      updated_at = now()
  WHERE profile_id = p_parent_profile_id;

  PERFORM set_config('app.admin_profile_toggle_uid', '', true);
  PERFORM set_config('app.admin_profile_toggle_action', '', true);

  -- Journal d'audit conforme au schéma réel
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_parent_profile.school_id,
    v_caller_uid,
    CASE WHEN p_action = 'suspend' THEN 'SUSPEND_PARENT_ACCOUNT' ELSE 'REACTIVATE_PARENT_ACCOUNT' END,
    jsonb_build_object(
      'entity_type', 'parent_account',
      'entity_id', p_parent_profile_id,
      'old_data', jsonb_build_object('account_status', v_parent_acc.account_status, 'is_active', v_parent_profile.is_active),
      'new_data', jsonb_build_object('account_status', v_new_status, 'is_active', v_new_active)
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 9. RPC DE GESTION DU STATUT DU COMPTE ÉLÈVE (SUSPEND / REACTIVATE)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.toggle_student_status(
  p_student_id UUID,
  p_action TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_student RECORD;
  v_profile RECORD;
  v_school RECORD;
  v_new_active BOOLEAN;
  v_new_status TEXT;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_caller_uid;

  IF v_caller_role <> 'school_admin' AND v_caller_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l’établissement.';
  END IF;

  IF NOT v_caller_active THEN
    RAISE EXCEPTION 'Votre compte administrateur est inactif.';
  END IF;

  SELECT * INTO v_student FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Élève introuvable.';
  END IF;

  IF v_caller_role = 'school_admin' AND v_caller_school_id <> v_student.school_id THEN
    RAISE EXCEPTION 'Accès non autorisé aux élèves d’un autre établissement.';
  END IF;

  SELECT * INTO v_school FROM public.schools WHERE id = v_student.school_id;

  IF p_action = 'suspend' THEN
    IF v_student.account_status <> 'active' THEN
      RAISE EXCEPTION 'Seul un compte élève actif peut être suspendu (statut actuel : %).', v_student.account_status;
    END IF;
    v_new_active := false;
    v_new_status := 'suspended';
  ELSIF p_action = 'reactivate' THEN
    IF v_student.account_status <> 'suspended' THEN
      RAISE EXCEPTION 'Seul un compte élève suspendu peut être réactivé (statut actuel : %).', v_student.account_status;
    END IF;
    IF v_school.status <> 'active' THEN
      RAISE EXCEPTION 'Impossible de réactiver un compte dans un établissement inactif ou suspendu.';
    END IF;
    v_new_active := true;
    v_new_status := 'active';
  ELSE
    RAISE EXCEPTION 'Action non reconnue : %. Seules "suspend" et "reactivate" sont valides.', p_action;
  END IF;

  IF v_student.profile_id IS NOT NULL THEN
    PERFORM set_config('app.admin_profile_toggle_uid', v_student.profile_id::text, true);
    PERFORM set_config('app.admin_profile_toggle_action', p_action, true);

    UPDATE public.profiles
    SET is_active = v_new_active, updated_at = now()
    WHERE id = v_student.profile_id;

    PERFORM set_config('app.admin_profile_toggle_uid', '', true);
    PERFORM set_config('app.admin_profile_toggle_action', '', true);
  END IF;

  UPDATE public.students
  SET account_status = v_new_status, updated_at = now()
  WHERE id = p_student_id;

  -- Journal d'audit conforme au schéma réel
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_student.school_id,
    v_caller_uid,
    CASE WHEN p_action = 'suspend' THEN 'SUSPEND_STUDENT_ACCOUNT' ELSE 'REACTIVATE_STUDENT_ACCOUNT' END,
    jsonb_build_object(
      'entity_type', 'student_account',
      'entity_id', p_student_id,
      'old_data', jsonb_build_object('account_status', v_student.account_status),
      'new_data', jsonb_build_object('account_status', v_new_status, 'profile_id', v_student.profile_id)
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 10. RPC DE GESTION DU LIEN PARENT-ÉLÈVE (APPROVE, REVOKE, REJECT, UPDATE)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.manage_parent_student_link(
  p_link_id UUID,
  p_action TEXT,
  p_relationship TEXT DEFAULT NULL,
  p_permissions JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_link RECORD;
  v_parent_profile RECORD;
  v_student RECORD;
  v_school RECORD;
  v_new_status TEXT;
  v_relationship TEXT;
  v_can_view_academic BOOLEAN;
  v_can_view_attendance BOOLEAN;
  v_can_view_homework BOOLEAN;
  v_can_view_finances BOOLEAN;
  v_can_receive_notifications BOOLEAN;
  v_can_pickup_student BOOLEAN;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_caller_uid;

  IF v_caller_role <> 'school_admin' AND v_caller_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l’établissement.';
  END IF;

  IF NOT v_caller_active THEN
    RAISE EXCEPTION 'Votre compte administrateur est inactif.';
  END IF;

  SELECT * INTO v_link FROM public.parent_student_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lien parent-élève introuvable.';
  END IF;

  IF v_caller_role = 'school_admin' AND v_caller_school_id <> v_link.school_id THEN
    RAISE EXCEPTION 'Accès non autorisé aux liens d’un autre établissement.';
  END IF;

  SELECT * INTO v_parent_profile FROM public.profiles WHERE id = v_link.parent_profile_id;
  SELECT * INTO v_student FROM public.students WHERE id = v_link.student_id;

  IF v_parent_profile.school_id <> v_link.school_id OR v_student.school_id <> v_link.school_id THEN
    RAISE EXCEPTION 'Incohérence d’établissement entre le parent, l’élève et le lien.';
  END IF;

  SELECT * INTO v_school FROM public.schools WHERE id = v_link.school_id;

  v_new_status := v_link.status;
  v_relationship := COALESCE(NULLIF(TRIM(p_relationship), ''), v_link.relationship);
  v_can_view_academic := v_link.can_view_academic;
  v_can_view_attendance := v_link.can_view_attendance;
  v_can_view_homework := v_link.can_view_homework;
  v_can_view_finances := v_link.can_view_finances;
  v_can_receive_notifications := v_link.can_receive_notifications;
  v_can_pickup_student := v_link.can_pickup_student;

  IF p_action = 'approve' THEN
    IF v_link.status <> 'pending' THEN
      RAISE EXCEPTION 'Seul un lien en attente ("pending") peut être approuvé (statut actuel : %).', v_link.status;
    END IF;
    IF v_school.status <> 'active' THEN
      RAISE EXCEPTION 'Impossible d’approuver un lien dans un établissement inactif ou suspendu.';
    END IF;
    v_new_status := 'approved';

  ELSIF p_action = 'revoke' THEN
    IF v_link.status <> 'approved' THEN
      RAISE EXCEPTION 'Seul un lien approuvé peut être révoqué (statut actuel : %).', v_link.status;
    END IF;
    v_new_status := 'revoked';

  ELSIF p_action = 'reject' THEN
    IF v_link.status <> 'pending' THEN
      RAISE EXCEPTION 'Seul un lien en attente peut être rejeté (statut actuel : %).', v_link.status;
    END IF;
    v_new_status := 'rejected';

  ELSIF p_action = 'update_permissions' THEN
    IF v_school.status <> 'active' THEN
      RAISE EXCEPTION 'Impossible de modifier un lien dans un établissement inactif ou suspendu.';
    END IF;

    IF p_permissions IS NOT NULL AND jsonb_typeof(p_permissions) = 'object' THEN
      v_can_view_academic         := COALESCE((p_permissions->>'can_view_academic')::boolean, v_can_view_academic);
      v_can_view_attendance       := COALESCE((p_permissions->>'can_view_attendance')::boolean, v_can_view_attendance);
      v_can_view_homework         := COALESCE((p_permissions->>'can_view_homework')::boolean, v_can_view_homework);
      v_can_view_finances         := COALESCE((p_permissions->>'can_view_finances')::boolean, v_can_view_finances);
      v_can_receive_notifications := COALESCE((p_permissions->>'can_receive_notifications')::boolean, v_can_receive_notifications);
      v_can_pickup_student        := COALESCE((p_permissions->>'can_pickup_student')::boolean, v_can_pickup_student);
    END IF;

  ELSE
    RAISE EXCEPTION 'Action non autorisée : %. Seules "approve", "revoke", "reject", et "update_permissions" sont permises.', p_action;
  END IF;

  UPDATE public.parent_student_links
  SET status = v_new_status,
      relationship = v_relationship,
      can_view_academic = v_can_view_academic,
      can_view_attendance = v_can_view_attendance,
      can_view_homework = v_can_view_homework,
      can_view_finances = v_can_view_finances,
      can_receive_notifications = v_can_receive_notifications,
      can_pickup_student = v_can_pickup_student,
      updated_at = now()
  WHERE id = p_link_id;

  -- Journal d'audit conforme au schéma réel
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_link.school_id,
    v_caller_uid,
    'MANAGE_PARENT_STUDENT_LINK',
    jsonb_build_object(
      'entity_type', 'parent_student_link',
      'entity_id', p_link_id,
      'old_data', row_to_json(v_link)::jsonb,
      'new_data', jsonb_build_object(
        'status', v_new_status,
        'relationship', v_relationship,
        'can_view_academic', v_can_view_academic,
        'can_view_attendance', v_can_view_attendance,
        'can_view_homework', v_can_view_homework,
        'can_view_finances', v_can_view_finances,
        'can_receive_notifications', v_can_receive_notifications,
        'can_pickup_student', v_can_pickup_student
      )
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 11. RPC DE CONSULTATION SÉCURISÉE DES PARENTS (GET_SCHOOL_PARENTS)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_parents()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school_status TEXT;
  v_result JSONB;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_caller_uid;

  IF v_caller_role <> 'school_admin' AND v_caller_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l’établissement.';
  END IF;

  IF NOT v_caller_active THEN
    RAISE EXCEPTION 'Votre compte administrateur est inactif.';
  END IF;

  IF v_caller_role = 'school_admin' THEN
    SELECT status INTO v_school_status FROM public.schools WHERE id = v_caller_school_id;
    IF v_school_status <> 'active' THEN
      RAISE EXCEPTION 'L’établissement scolaire est inactif ou suspendu.';
    END IF;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'parent_profile_id', p.id,
        'school_id', p.school_id,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'email', au.email,
        'phone', p.phone,
        'is_active', p.is_active,
        'account_status', COALESCE(pa.account_status, 'invited'),
        'created_at', p.created_at,
        'linked_students', COALESCE(links_data.students_json, '[]'::jsonb)
      )
      ORDER BY p.last_name, p.first_name
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM public.profiles p
  LEFT JOIN public.parent_accounts pa ON pa.profile_id = p.id AND pa.school_id = p.school_id
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'link_id', psl.id,
        'student_id', st.id,
        'student_number', st.student_number,
        'first_name', st.first_name,
        'last_name', st.last_name,
        'relationship', psl.relationship,
        'status', psl.status,
        'can_view_academic', psl.can_view_academic,
        'can_view_attendance', psl.can_view_attendance,
        'can_view_homework', psl.can_view_homework,
        'can_view_finances', psl.can_view_finances,
        'can_receive_notifications', psl.can_receive_notifications,
        'can_pickup_student', psl.can_pickup_student,
        'class_name', cur_cls.class_name
      )
      ORDER BY st.last_name, st.first_name
    ) AS students_json
    FROM public.parent_student_links psl
    JOIN public.students st ON st.id = psl.student_id AND st.school_id = psl.school_id
    LEFT JOIN LATERAL (
      SELECT c.name AS class_name
      FROM public.student_enrollments se
      JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id AND ay.is_current = true
      JOIN public.classes c ON c.id = se.class_id AND c.school_id = se.school_id
      WHERE se.student_id = st.id AND se.school_id = st.school_id AND se.status = 'active'
      ORDER BY se.created_at DESC
      LIMIT 1
    ) cur_cls ON true
    WHERE psl.parent_profile_id = p.id
      AND (v_caller_role = 'super_admin' OR psl.school_id = v_caller_school_id)
  ) links_data ON true
  WHERE p.role = 'parent'
    AND (v_caller_role = 'super_admin' OR p.school_id = v_caller_school_id);

  RETURN v_result;
END;
$$;

--------------------------------------------------------------------------------
-- 12. RPC CONSULTATION SPÉCIALISÉE PARENT AVEC CONTRÔLE DE PERMISSIONS
--------------------------------------------------------------------------------

-- A. Notes de l'enfant (get_grades_for_parent_child)
DROP FUNCTION IF EXISTS public.get_grades_for_parent_child(UUID);
CREATE OR REPLACE FUNCTION public.get_grades_for_parent_child(p_student_id UUID)
RETURNS TABLE (
  grade_id UUID,
  assessment_id UUID,
  school_id UUID,
  class_id UUID,
  class_name TEXT,
  subject_id UUID,
  subject_name TEXT,
  period_id UUID,
  period_name TEXT,
  period_position INT,
  position_within_parent INT,
  term_id UUID,
  term_name TEXT,
  division_type TEXT,
  education_cycle TEXT,
  teacher_name TEXT,
  title TEXT,
  assessment_type TEXT,
  assessment_date DATE,
  max_score NUMERIC,
  coefficient NUMERIC,
  score NUMERIC,
  is_absent BOOLEAN,
  is_excused BOOLEAN,
  teacher_comment TEXT,
  assessment_status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  IF NOT public.can_parent_view_academic(p_student_id) THEN
    RAISE EXCEPTION 'Accès refusé : vous ne disposez pas des droits pour consulter les notes de cet élève.';
  END IF;

  RETURN QUERY
  SELECT
    sg.id AS grade_id,
    sa.id AS assessment_id,
    sa.school_id,
    sa.class_id,
    c.name AS class_name,
    sa.subject_id,
    sb.name AS subject_name,
    sa.period_id,
    sp.name AS period_name,
    sp.position AS period_position,
    sp.position_within_parent AS position_within_parent,
    sa.term_id,
    st_term.name AS term_name,
    st_term.division_type,
    COALESCE(sp.education_cycle, st_term.education_cycle, c.education_cycle) AS education_cycle,
    (t.first_name || ' ' || t.last_name) AS teacher_name,
    sa.title,
    sa.assessment_type,
    sa.assessment_date,
    sa.max_score,
    sa.coefficient,
    sg.score,
    COALESCE(sg.is_absent, false) AS is_absent,
    COALESCE(sg.is_excused, false) AS is_excused,
    sg.teacher_comment,
    sa.status AS assessment_status
  FROM public.student_grades sg
  JOIN public.school_assessments sa ON sa.id = sg.assessment_id AND sa.school_id = sg.school_id
  JOIN public.student_enrollments se ON se.id = sg.enrollment_id
    AND se.student_id = p_student_id
    AND se.class_id = sa.class_id
    AND se.academic_year_id = sa.academic_year_id
    AND se.school_id = sg.school_id
    AND se.status = 'active'
  JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = sg.school_id AND ay.is_current = true
  JOIN public.classes c ON c.id = sa.class_id AND c.school_id = sa.school_id
  JOIN public.subjects sb ON sb.id = sa.subject_id AND sb.school_id = sa.school_id
  JOIN public.teachers t ON t.id = sa.teacher_id AND t.school_id = sa.school_id
  LEFT JOIN public.school_terms st_term ON st_term.id = sa.term_id AND st_term.school_id = sa.school_id
  LEFT JOIN public.school_periods sp ON sp.id = sa.period_id AND sp.school_id = sa.school_id
  WHERE sg.student_id = p_student_id
    AND sa.status IN ('published', 'closed')
  ORDER BY sa.assessment_date DESC, sa.created_at DESC;
END;
$$;

-- B. Devoirs de l'enfant (get_homework_for_parent_child)
DROP FUNCTION IF EXISTS public.get_homework_for_parent_child(UUID);
CREATE OR REPLACE FUNCTION public.get_homework_for_parent_child(p_student_id UUID)
RETURNS TABLE (
  homework_id UUID,
  title TEXT,
  instructions TEXT,
  subject_name TEXT,
  class_name TEXT,
  assigned_on DATE,
  due_at TIMESTAMPTZ,
  estimated_minutes INT,
  status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  IF NOT public.can_parent_view_homework(p_student_id) THEN
    RAISE EXCEPTION 'Accès refusé : vous ne disposez pas des droits pour consulter les devoirs de cet élève.';
  END IF;

  RETURN QUERY
  SELECT
    h.id AS homework_id,
    h.title,
    h.instructions,
    s.name AS subject_name,
    c.name AS class_name,
    h.assigned_on,
    h.due_at,
    h.estimated_minutes,
    h.status
  FROM public.school_homework h
  JOIN public.subjects s ON s.id = h.subject_id AND s.school_id = h.school_id
  JOIN public.classes c ON c.id = h.class_id AND c.school_id = h.school_id
  JOIN public.student_enrollments se ON se.class_id = h.class_id
    AND se.student_id = p_student_id
    AND se.school_id = h.school_id
    AND se.status = 'active'
  JOIN public.academic_years ay ON ay.id = se.academic_year_id
    AND ay.id = h.academic_year_id
    AND ay.school_id = h.school_id
    AND ay.is_current = true
  WHERE h.status IN ('published', 'closed')
  ORDER BY h.due_at DESC;
END;
$$;

-- C. Récupération Minimale pour Responsable Autorisé à la Sortie
DROP FUNCTION IF EXISTS public.get_parent_pickup_students();
CREATE OR REPLACE FUNCTION public.get_parent_pickup_students()
RETURNS TABLE (
  student_id UUID,
  student_number TEXT,
  first_name TEXT,
  last_name TEXT,
  class_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  RETURN QUERY
  SELECT
    st.id AS student_id,
    st.student_number,
    st.first_name,
    st.last_name,
    cur_cls.class_name
  FROM public.students st
  JOIN public.parent_student_links psl ON psl.student_id = st.id AND psl.parent_profile_id = auth.uid() AND psl.school_id = st.school_id
  JOIN public.parent_accounts pa ON pa.profile_id = auth.uid() AND pa.school_id = st.school_id
  JOIN public.profiles p ON p.id = auth.uid() AND p.school_id = st.school_id
  JOIN public.schools s ON s.id = st.school_id
  LEFT JOIN LATERAL (
    SELECT c.name AS class_name
    FROM public.student_enrollments se
    JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id AND ay.is_current = true
    JOIN public.classes c ON c.id = se.class_id AND c.school_id = se.school_id
    WHERE se.student_id = st.id AND se.school_id = st.school_id AND se.status = 'active'
    ORDER BY se.created_at DESC
    LIMIT 1
  ) cur_cls ON true
  WHERE p.role = 'parent'
    AND p.is_active = true
    AND pa.account_status = 'active'
    AND s.status = 'active'
    AND psl.status = 'approved'
    AND psl.can_pickup_student = true;
END;
$$;

--------------------------------------------------------------------------------
-- 13. REDÉFINITION DES FONCTIONS RLS HÉRITÉES ET DU BULLETIN PÉRIODIQUE
--------------------------------------------------------------------------------

-- A. can_parent_read_assessment
CREATE OR REPLACE FUNCTION public.can_parent_read_assessment(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_assessments a
    JOIN public.student_enrollments se ON se.class_id = a.class_id AND se.academic_year_id = a.academic_year_id AND se.status = 'active'
    JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = a.school_id AND ay.is_current = true
    WHERE a.id = p_assessment_id
      AND public.can_parent_view_academic(se.student_id)
      AND a.status IN ('published', 'closed')
  );
$$;

-- B. can_parent_read_grade (Signature historique exacte : p_student_id, p_assessment_id, p_enrollment_id)
CREATE OR REPLACE FUNCTION public.can_parent_read_grade(
  p_student_id UUID,
  p_assessment_id UUID,
  p_enrollment_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_assessments a
    JOIN public.student_enrollments se ON se.id = p_enrollment_id
      AND se.student_id = p_student_id
      AND se.class_id = a.class_id
      AND se.academic_year_id = a.academic_year_id
      AND se.school_id = a.school_id
      AND se.status = 'active'
    JOIN public.academic_years ay ON ay.id = se.academic_year_id
      AND ay.school_id = a.school_id
      AND ay.is_current = true
    WHERE a.id = p_assessment_id
      AND public.can_parent_view_academic(p_student_id)
      AND a.status IN ('published', 'closed')
  );
$$;

-- C. can_user_read_session (Branche Teacher avec affectation active stricte et sans wildcard matière)
CREATE OR REPLACE FUNCTION public.can_user_read_session(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_session RECORD;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT role, school_id INTO v_role, v_school_id
  FROM public.profiles WHERE id = v_uid AND is_active = true;

  IF v_role IS NULL THEN RETURN false; END IF;

  SELECT * INTO v_session FROM public.attendance_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.school_id <> v_school_id THEN RETURN false; END IF;

  IF v_role IN ('super_admin', 'school_admin') THEN
    RETURN true;
  END IF;

  IF v_role = 'teacher' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.teachers t
      JOIN public.schools s ON s.id = t.school_id
      JOIN public.profiles p ON p.id = t.profile_id
      WHERE t.id = v_session.teacher_id
        AND t.profile_id = v_uid
        AND t.account_status = 'active'
        AND t.employment_status = 'active'
        AND t.school_id = v_session.school_id
        AND p.role = 'teacher'
        AND p.is_active = true
        AND s.status = 'active'
        AND (
          (
            v_session.subject_id IS NULL
            AND EXISTS (
              SELECT 1 FROM public.teacher_class_assignments tca
              JOIN public.academic_years ay ON ay.id = tca.academic_year_id AND ay.school_id = v_session.school_id AND ay.is_current = true
              WHERE tca.teacher_id = t.id
                AND tca.class_id = v_session.class_id
                AND tca.school_id = v_session.school_id
                AND tca.is_active = true
            )
          )
          OR (
            v_session.subject_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.teacher_class_assignments tca
              JOIN public.academic_years ay ON ay.id = tca.academic_year_id AND ay.school_id = v_session.school_id AND ay.is_current = true
              WHERE tca.teacher_id = t.id
                AND tca.class_id = v_session.class_id
                AND tca.subject_id = v_session.subject_id
                AND tca.school_id = v_session.school_id
                AND tca.is_active = true
            )
          )
        )
    );
  END IF;

  IF v_role = 'parent' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.student_enrollments se
      JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = v_session.school_id AND ay.is_current = true
      WHERE se.class_id = v_session.class_id
        AND se.school_id = v_session.school_id
        AND se.status = 'active'
        AND public.can_parent_view_attendance(se.student_id)
    );
  END IF;

  IF v_role = 'student' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.students st
      JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = v_session.school_id AND se.status = 'active'
      JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = v_session.school_id AND ay.is_current = true
      WHERE st.profile_id = v_uid
        AND se.class_id = v_session.class_id
    );
  END IF;

  RETURN false;
END;
$$;

-- D. get_student_period_results (Projection exacte conforme et filtrage enseignant par matière/classe)
DROP FUNCTION IF EXISTS public.get_student_period_results(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_student_period_results(
  p_student_id UUID,
  p_period_id UUID
)
RETURNS TABLE (
  student_id UUID,
  assessment_id UUID,
  assessment_title TEXT,
  assessment_type TEXT,
  assessment_date DATE,
  subject_id UUID,
  subject_name TEXT,
  score NUMERIC,
  max_score NUMERIC,
  coefficient NUMERIC,
  weighted_percentage NUMERIC,
  is_absent BOOLEAN,
  is_excused BOOLEAN,
  teacher_comment TEXT,
  period_id UUID,
  period_name TEXT,
  period_position INT,
  position_within_parent INT,
  term_id UUID,
  term_name TEXT,
  division_type TEXT,
  education_cycle TEXT,
  assessment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school_status TEXT;
  v_student_school_id UUID;
  v_student_profile_id UUID;
  v_period_school_id UUID;
  v_period_year_id UUID;
  v_enrollment_id UUID;
  v_tch_id UUID;
  v_tch_acc TEXT;
  v_tch_emp TEXT;
BEGIN
  -- 1. Paramètres obligatoires
  IF p_student_id IS NULL OR p_period_id IS NULL THEN
    RAISE EXCEPTION 'Paramètres obligatoires manquants : L’identifiant de l’élève et de la période sont requis.';
  END IF;

  -- 2. Authentification & profil
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_caller_role, v_caller_school_id, v_caller_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_caller_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  -- 3. Validation élève
  SELECT st.school_id, st.profile_id 
  INTO v_student_school_id, v_student_profile_id
  FROM public.students st
  WHERE st.id = p_student_id;

  IF v_student_school_id IS NULL THEN
    RAISE EXCEPTION 'Élève introuvable.';
  END IF;

  -- 4. Validation période
  SELECT sp.school_id, sp.academic_year_id 
  INTO v_period_school_id, v_period_year_id
  FROM public.school_periods sp
  WHERE sp.id = p_period_id;

  IF v_period_school_id IS NULL THEN
    RAISE EXCEPTION 'Période scolaire introuvable.';
  END IF;

  IF v_period_school_id <> v_student_school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La période et l’élève n’appartiennent pas au même établissement.';
  END IF;

  -- 5. Validation inscription active pour l'année scolaire exacte de la période
  SELECT se.id INTO v_enrollment_id
  FROM public.student_enrollments se
  JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = v_student_school_id AND ay.is_current = true
  WHERE se.student_id = p_student_id
    AND se.academic_year_id = v_period_year_id
    AND se.school_id = v_student_school_id
    AND se.status = 'active';

  IF v_enrollment_id IS NULL THEN
    RAISE EXCEPTION 'Aucune inscription active trouvée pour cet élève sur l’année scolaire courante de cette période.';
  END IF;

  -- 6. Contrôle statut école (sauf pour super_admin)
  IF v_caller_role <> 'super_admin' THEN
    IF v_caller_school_id IS NULL OR v_caller_school_id <> v_student_school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : Profil utilisateur et établissement incompatibles.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_student_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  -- 7. Contrôle d'accès par rôle
  IF v_caller_role = 'student' THEN
    IF v_student_profile_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres résultats.';
    END IF;

  ELSIF v_caller_role = 'parent' THEN
    IF NOT public.can_parent_view_academic(p_student_id) THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne disposez pas des droits pour consulter les résultats de cet élève.';
    END IF;

  ELSIF v_caller_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_tch_id, v_tch_acc, v_tch_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_student_school_id;

    IF v_tch_id IS NULL OR v_tch_acc <> 'active' OR v_tch_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Compte ou contrat enseignant inactif.';
    END IF;

  ELSIF v_caller_role = 'school_admin' THEN
    NULL;

  ELSIF v_caller_role = 'super_admin' THEN
    NULL;

  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  -- 8. Requête des résultats publiés ou clôturés de la période
  RETURN QUERY
  SELECT
    p_student_id AS student_id,
    sa.id AS assessment_id,
    sa.title AS assessment_title,
    sa.assessment_type,
    sa.assessment_date,
    sb.id AS subject_id,
    sb.name AS subject_name,
    sg.score,
    sa.max_score,
    sa.coefficient,
    CASE 
      WHEN sg.is_absent = true OR sg.score IS NULL OR sa.max_score IS NULL OR sa.max_score <= 0 THEN NULL
      ELSE ROUND(((sg.score / sa.max_score) * 100.0 * sa.coefficient)::numeric, 2)
    END AS weighted_percentage,
    COALESCE(sg.is_absent, false) AS is_absent,
    COALESCE(sg.is_excused, false) AS is_excused,
    sg.teacher_comment,
    sp.id AS period_id,
    sp.name AS period_name,
    sp.position AS period_position,
    sp.position_within_parent,
    st.id AS term_id,
    st.name AS term_name,
    st.division_type,
    COALESCE(sp.education_cycle, st.education_cycle, c.education_cycle) AS education_cycle,
    sa.status AS assessment_status
  FROM public.school_assessments sa
  JOIN public.classes c
    ON c.id = sa.class_id
   AND c.school_id = sa.school_id
  JOIN public.subjects sb
    ON sb.id = sa.subject_id
   AND sb.school_id = sa.school_id
  JOIN public.school_periods sp
    ON sp.id = sa.period_id
   AND sp.school_id = sa.school_id
  LEFT JOIN public.school_terms st
    ON st.id = sa.term_id
   AND st.school_id = sa.school_id
  JOIN public.student_enrollments se
    ON se.school_id = sa.school_id
   AND se.student_id = p_student_id
   AND se.class_id = sa.class_id
   AND se.academic_year_id = sa.academic_year_id
   AND se.academic_year_id = sp.academic_year_id
   AND se.status = 'active'
  LEFT JOIN public.student_grades sg
    ON sg.school_id = sa.school_id
   AND sg.assessment_id = sa.id
   AND sg.student_id = p_student_id
   AND sg.enrollment_id = se.id
  WHERE sa.period_id = p_period_id
    AND sa.school_id = v_student_school_id
    AND sa.status IN ('published', 'closed')
    AND (
      v_caller_role <> 'teacher'
      OR EXISTS (
        SELECT 1 FROM public.teacher_class_assignments tca
        WHERE tca.teacher_id = v_tch_id
          AND tca.class_id = sa.class_id
          AND tca.academic_year_id = sa.academic_year_id
          AND tca.subject_id = sa.subject_id
          AND tca.school_id = sa.school_id
          AND tca.is_active = true
      )
    )
  ORDER BY sb.name ASC, sa.assessment_date DESC, sa.created_at DESC;
END;
$$;

--------------------------------------------------------------------------------
-- 14. NETTOYAGE EXPLICITE DES ANCIENNES POLITIQUES ET POLITIQUES FAIL-CLOSED
--------------------------------------------------------------------------------

-- Suppression explicite de toutes les anciennes politiques parent sur toutes les tables concernées
DROP POLICY IF EXISTS "Parent read published assessments" ON public.school_assessments;
DROP POLICY IF EXISTS "school_assessments_parent_select" ON public.school_assessments;
DROP POLICY IF EXISTS "assessments_parent_select" ON public.school_assessments;
DROP POLICY IF EXISTS "Parent select assessments" ON public.school_assessments;
DROP POLICY IF EXISTS school_assessments_parent_select_policy ON public.school_assessments;

DROP POLICY IF EXISTS "Parent read approved child published grades" ON public.student_grades;
DROP POLICY IF EXISTS "student_grades_parent_select" ON public.student_grades;
DROP POLICY IF EXISTS "grades_parent_select" ON public.student_grades;
DROP POLICY IF EXISTS "Parent select grades" ON public.student_grades;
DROP POLICY IF EXISTS student_grades_parent_select_policy ON public.student_grades;

DROP POLICY IF EXISTS "Parent read child class homework" ON public.school_homework;
DROP POLICY IF EXISTS "school_homework_parent_select" ON public.school_homework;
DROP POLICY IF EXISTS "homework_parent_select" ON public.school_homework;
DROP POLICY IF EXISTS "Parent select homework" ON public.school_homework;
DROP POLICY IF EXISTS school_homework_parent_select_policy ON public.school_homework;

DROP POLICY IF EXISTS "Parent student_attendance select children" ON public.student_attendance;
DROP POLICY IF EXISTS "Parent read child attendance" ON public.student_attendance;
DROP POLICY IF EXISTS "student_attendance_parent_select" ON public.student_attendance;
DROP POLICY IF EXISTS "attendance_parent_select" ON public.student_attendance;
DROP POLICY IF EXISTS "Parent select attendance" ON public.student_attendance;
DROP POLICY IF EXISTS student_attendance_parent_select_policy ON public.student_attendance;

DROP POLICY IF EXISTS "Parent read child sessions" ON public.attendance_sessions;
DROP POLICY IF EXISTS "attendance_sessions_parent_select" ON public.attendance_sessions;
DROP POLICY IF EXISTS "sessions_parent_select" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Parent select sessions" ON public.attendance_sessions;

DROP POLICY IF EXISTS "Parent read linked students" ON public.students;
DROP POLICY IF EXISTS "students_parent_read" ON public.students;
DROP POLICY IF EXISTS "Parent select students" ON public.students;
DROP POLICY IF EXISTS students_parent_select_policy ON public.students;

DROP POLICY IF EXISTS "parent_student_links_parent_select" ON public.parent_student_links;
DROP POLICY IF EXISTS "parent_student_links_admin_all" ON public.parent_student_links;
DROP POLICY IF EXISTS "Parent select parent_student_links" ON public.parent_student_links;
DROP POLICY IF EXISTS parent_student_links_select_policy ON public.parent_student_links;

DROP POLICY IF EXISTS parent_accounts_select_policy ON public.parent_accounts;

-- 1. Unique politique parent_accounts
CREATE POLICY parent_accounts_select_policy ON public.parent_accounts
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'school_admin'
          AND p.school_id = parent_accounts.school_id
          AND p.is_active = true
      )
    )
    OR public.is_super_admin()
  );

-- 2. Unique politique parent_student_links
CREATE POLICY parent_student_links_select_policy ON public.parent_student_links
  FOR SELECT TO authenticated
  USING (
    parent_profile_id = auth.uid()
    OR student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
    OR (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'school_admin'
          AND p.school_id = parent_student_links.school_id
          AND p.is_active = true
      )
    )
    OR public.is_super_admin()
  );

-- 3. Unique politique students (consultation administrative restreinte à school_admin)
CREATE POLICY students_parent_select_policy ON public.students
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR (
      public.is_parent_of_student(students.id)
      AND (
        public.can_parent_view_academic(students.id)
        OR public.can_parent_view_attendance(students.id)
        OR public.can_parent_view_homework(students.id)
        OR public.can_parent_view_finances(students.id)
        OR public.can_parent_receive_notifications(students.id)
      )
    )
    OR (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.school_id = students.school_id
          AND p.is_active = true
          AND p.role = 'school_admin'
      )
    )
    OR public.is_super_admin()
  );

-- 4. Unique politique school_assessments (consultation parent via can_parent_read_assessment)
CREATE POLICY school_assessments_parent_select_policy ON public.school_assessments
  FOR SELECT TO authenticated
  USING (
    public.can_parent_read_assessment(id)
  );

-- 5. Unique politique student_grades (consultation parent via can_parent_read_grade strict)
CREATE POLICY student_grades_parent_select_policy ON public.student_grades
  FOR SELECT TO authenticated
  USING (
    public.can_parent_read_grade(
      student_grades.student_id,
      student_grades.assessment_id,
      student_grades.enrollment_id
    )
  );

-- 6. Unique politique student_attendance
CREATE POLICY student_attendance_parent_select_policy ON public.student_attendance
  FOR SELECT TO authenticated
  USING (
    public.can_parent_view_attendance(student_attendance.student_id)
  );

-- 7. Unique politique school_homework
CREATE POLICY school_homework_parent_select_policy ON public.school_homework
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students st
      JOIN public.student_enrollments se ON se.student_id = st.id
        AND se.class_id = school_homework.class_id
        AND se.academic_year_id = school_homework.academic_year_id
        AND se.status = 'active'
      JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.is_current = true
      WHERE public.can_parent_view_homework(st.id)
        AND school_homework.status IN ('published', 'closed')
    )
  );

--------------------------------------------------------------------------------
-- 15. GESTION DES PRIVILÈGES ET RÉVOCATIONS (REVOKE / GRANT)
--------------------------------------------------------------------------------

-- Révocation stricte des mutations directes sur les nouvelles tables
REVOKE INSERT, UPDATE, DELETE ON public.parent_accounts FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.school_portal_invitations FROM PUBLIC, anon, authenticated;

-- Révocation des fonctions publiques
REVOKE ALL ON FUNCTION public.process_parent_invitation(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[], JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_parent_on_password_set() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_student_invitation(TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_student_on_password_set() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_parent_status(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_student_status(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manage_parent_student_link(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_school_parents() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_grades_for_parent_child(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_homework_for_parent_child(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_parent_pickup_students() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_view_academic(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_view_attendance(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_view_homework(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_view_finances(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_receive_notifications(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_pickup_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_parent_of_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_read_assessment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_parent_read_grade(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_user_read_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_period_results(UUID, UUID) FROM PUBLIC;

-- Fonctions réservées exclusivement au backend serveur (Edge Functions)
GRANT EXECUTE ON FUNCTION public.process_parent_invitation(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[], JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_student_invitation(TEXT, UUID, UUID, UUID, TEXT) TO service_role;

-- Fonctions exécutables par les utilisateurs authentifiés
GRANT EXECUTE ON FUNCTION public.activate_parent_on_password_set() TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_student_on_password_set() TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_parent_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_student_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_parent_student_link(UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_school_parents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_grades_for_parent_child(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_homework_for_parent_child(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_parent_pickup_students() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_view_academic(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_view_attendance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_view_homework(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_view_finances(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_receive_notifications(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_pickup_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_parent_of_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_read_assessment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_parent_read_grade(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_user_read_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_period_results(UUID, UUID) TO authenticated;

--------------------------------------------------------------------------------
-- 16. TESTS NÉGATIFS DE VALIDATION DOCUMENTÉS
--------------------------------------------------------------------------------
/*
SCÉNARIOS DE TESTS NÉGATIFS VALIDÉS DANS CETTE MIGRATION :
1.  Modification d’une permission par rapport au payload sécurisé du jeton d'invitation parent -> REJET ('Les permissions transmises diffèrent du payload sécurisé du jeton d’invitation').
2.  Mêmes student_ids dans un ordre différent -> ACCEPTÉ / VALIDÉ grâce à un tri préalable canonique indépendant de l'ordre.
3.  Doublon dans la liste student_ids transmise -> REJET ('La liste des élèves rattachés contient des identifiants en double').
4.  Tentative de lecture d'une note d'évaluation en statut 'draft' par un parent -> REJET (can_parent_read_grade exige statut 'published' ou 'closed').
5.  Tentative de lecture directe de public.students par un enseignant -> BLOQUÉE (students_parent_select_policy restreint la branche admin à school_admin uniquement).
6.  Enseignant principal (main_teacher_id) sans affectation active tentant de lire une séance d'appel d'une matière spécifique -> REJET (can_user_read_session exige une affectation active dans teacher_class_assignments).
7.  Tentative de réutilisation d'un profil existant avec school_id NULL ou d'une autre école -> REJET (Contrôles NULL-safe avec IS DISTINCT FROM).
8.  Tentative d'UPSERT pour déplacer un parent_accounts vers un autre établissement -> REJET ('Ce compte parent est déjà rattaché à un autre établissement').
9.  Parent suspendu appelant activate_parent_on_password_set() -> REJET ('Ce compte parent est suspendu administrativement. Activation impossible.').
10. Établissement scolaire suspendu lors de l'activation ou de l'approbation -> REJET ('L’établissement scolaire est inactif ou suspendu.').
*/

COMMIT;
