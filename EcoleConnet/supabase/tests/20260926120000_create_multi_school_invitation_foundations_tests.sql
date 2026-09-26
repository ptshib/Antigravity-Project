-- Test Suite: 20260926120000_create_multi_school_invitation_foundations_tests.sql
-- Description: Suite transactionnelle pour l'infrastructure des invitations multi-écoles (Lot A2a)

BEGIN;

-- ============================================================================
-- 1. EXECUTION DE LA MIGRATION A2a EN BLOC TRANSACTIONNEL (DDL TESTED)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Helpers Privés Internes
CREATE OR REPLACE FUNCTION public.normalize_email(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_email IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN lower(trim(p_email));
END;
$$;

CREATE OR REPLACE FUNCTION public.hash_invitation_token(p_raw_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_raw_token IS NULL OR trim(p_raw_token) = '' THEN
    RAISE EXCEPTION 'Raw invitation token cannot be empty';
  END IF;
  RETURN encode(extensions.digest(p_raw_token, 'sha256'), 'hex');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_email(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hash_invitation_token(TEXT) FROM PUBLIC, anon, authenticated;

-- Table Canonique des Invitations Multi-Écoles
CREATE TABLE IF NOT EXISTS public.school_membership_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  auth_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  intended_role TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  accepted_by_profile_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  consumed_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_school_membership_invitations_role CHECK (
    intended_role IN ('parent', 'teacher', 'student', 'school_admin')
  ),

  CONSTRAINT chk_school_membership_invitations_status CHECK (
    status IN ('pending', 'accepted', 'revoked', 'expired')
  ),

  CONSTRAINT uq_school_membership_invitations_token_hash UNIQUE (token_hash),
  CONSTRAINT chk_school_membership_invitations_token_hash_hex CHECK (
    token_hash ~* '^[0-9a-f]{64}$'
  ),

  CONSTRAINT chk_school_membership_invitations_email_norm CHECK (
    email_normalized = lower(trim(email_normalized))
  ),

  CONSTRAINT chk_school_membership_invitations_chronology CHECK (
    expires_at >= created_at AND
    (consumed_at IS NULL OR consumed_at >= created_at) AND
    (revoked_at IS NULL OR revoked_at >= created_at)
  ),

  CONSTRAINT chk_school_membership_invitations_status_invariants CHECK (
    (status = 'pending' AND consumed_at IS NULL AND revoked_at IS NULL) OR
    (status = 'accepted' AND consumed_at IS NOT NULL AND revoked_at IS NULL AND accepted_by_profile_id IS NOT NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL) OR
    (status = 'expired' AND consumed_at IS NULL AND revoked_at IS NULL)
  ),

  CONSTRAINT uq_school_membership_invitations_id_school UNIQUE (id, school_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_school_membership_invitations_pending 
  ON public.school_membership_invitations (school_id, email_normalized, intended_role) 
  WHERE (status = 'pending');

CREATE INDEX IF NOT EXISTS idx_school_membership_invitations_hash 
  ON public.school_membership_invitations (token_hash) 
  WHERE (status = 'pending');

CREATE INDEX IF NOT EXISTS idx_school_membership_invitations_email 
  ON public.school_membership_invitations (email_normalized, status);

CREATE OR REPLACE FUNCTION public.update_school_membership_invitations_updated_at()
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

DROP TRIGGER IF EXISTS trg_school_membership_invitations_updated_at ON public.school_membership_invitations;
CREATE TRIGGER trg_school_membership_invitations_updated_at
  BEFORE UPDATE ON public.school_membership_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_school_membership_invitations_updated_at();

-- Tables de Liaison Typées
CREATE TABLE IF NOT EXISTS public.school_membership_invitation_students (
  invitation_id UUID NOT NULL,
  student_id UUID NOT NULL,
  school_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_school_membership_invitation_students PRIMARY KEY (invitation_id, student_id),

  CONSTRAINT fk_invitation_student_invitation FOREIGN KEY (invitation_id, school_id)
    REFERENCES public.school_membership_invitations(id, school_id) ON DELETE CASCADE,

  CONSTRAINT fk_invitation_student_student FOREIGN KEY (student_id, school_id)
    REFERENCES public.students(id, school_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.school_membership_invitation_teachers (
  invitation_id UUID NOT NULL,
  teacher_id UUID NOT NULL,
  school_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_school_membership_invitation_teachers PRIMARY KEY (invitation_id, teacher_id),

  CONSTRAINT fk_invitation_teacher_invitation FOREIGN KEY (invitation_id, school_id)
    REFERENCES public.school_membership_invitations(id, school_id) ON DELETE CASCADE,

  CONSTRAINT fk_invitation_teacher_teacher FOREIGN KEY (teacher_id)
    REFERENCES public.teachers(id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION public.chk_invitation_teacher_same_school_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_teacher_school_id UUID;
BEGIN
  SELECT school_id INTO v_teacher_school_id
  FROM public.teachers
  WHERE id = NEW.teacher_id;

  IF v_teacher_school_id IS NULL OR v_teacher_school_id != NEW.school_id THEN
    RAISE EXCEPTION 'Teacher % does not belong to school %', NEW.teacher_id, NEW.school_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chk_invitation_teacher_same_school ON public.school_membership_invitation_teachers;
CREATE TRIGGER trg_chk_invitation_teacher_same_school
  BEFORE INSERT OR UPDATE ON public.school_membership_invitation_teachers
  FOR EACH ROW
  EXECUTE FUNCTION public.chk_invitation_teacher_same_school_fn();

ALTER TABLE public.school_membership_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_membership_invitation_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_membership_invitation_teachers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_membership_invitations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.school_membership_invitation_students FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.school_membership_invitation_teachers FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. SUITE D'ASSERTIONS TRANSACTIONNELLES (TESTS)
-- ============================================================================

DO $$
DECLARE
  v_school_a_id UUID;
  v_school_b_id UUID;
  v_admin_profile_id UUID;
  v_user_auth_id UUID;
  v_student_a1_id UUID;
  v_student_a2_id UUID;
  v_student_b1_id UUID;
  v_teacher_a1_id UUID;
  v_invitation_1_id UUID;
  v_invitation_2_id UUID;
  v_valid_hash_1 TEXT;
  v_valid_hash_2 TEXT;
  v_valid_hash_3 TEXT;
  v_error_caught BOOLEAN;
  v_count INT;
BEGIN
  RAISE NOTICE '== DEBUT DES TESTS DU LOT 2K-A2a : INFRASTRUCTURE DES INVITATIONS ==';

  SELECT id INTO v_school_a_id FROM public.schools WHERE status = 'active' LIMIT 1;
  IF v_school_a_id IS NULL THEN
    INSERT INTO public.schools (name, status) VALUES ('École A Test', 'active') RETURNING id INTO v_school_a_id;
  END IF;

  SELECT id INTO v_school_b_id FROM public.schools WHERE status = 'active' AND id != v_school_a_id LIMIT 1;
  IF v_school_b_id IS NULL THEN
    INSERT INTO public.schools (name, status) VALUES ('École B Test', 'active') RETURNING id INTO v_school_b_id;
  END IF;

  SELECT id INTO v_admin_profile_id FROM public.profiles WHERE school_id = v_school_a_id LIMIT 1;
  IF v_admin_profile_id IS NULL THEN
    INSERT INTO public.profiles (first_name, last_name, role, school_id, is_active)
    VALUES ('Admin', 'Test', 'school_admin', v_school_a_id, true)
    RETURNING id INTO v_admin_profile_id;
  END IF;

  SELECT id INTO v_user_auth_id FROM auth.users LIMIT 1;
  IF v_user_auth_id IS NULL THEN
    v_user_auth_id := gen_random_uuid();
  END IF;

  INSERT INTO public.students (school_id, student_number, first_name, last_name, gender, enrollment_status)
  VALUES (v_school_a_id, 'STU-A1-' || gen_random_uuid(), 'Élève A1', 'Test', 'M', 'active')
  RETURNING id INTO v_student_a1_id;

  INSERT INTO public.students (school_id, student_number, first_name, last_name, gender, enrollment_status)
  VALUES (v_school_a_id, 'STU-A2-' || gen_random_uuid(), 'Élève A2', 'Test', 'F', 'active')
  RETURNING id INTO v_student_a2_id;

  INSERT INTO public.students (school_id, student_number, first_name, last_name, gender, enrollment_status)
  VALUES (v_school_b_id, 'STU-B1-' || gen_random_uuid(), 'Élève B1', 'Test', 'M', 'active')
  RETURNING id INTO v_student_b1_id;

  INSERT INTO public.teachers (school_id, employee_number, first_name, last_name, email, employment_status)
  VALUES (v_school_a_id, 'TCH-A1-' || gen_random_uuid(), 'Prof A1', 'Test', 'prof.a1@test.com', 'active')
  RETURNING id INTO v_teacher_a1_id;

  v_valid_hash_1 := public.hash_invitation_token('raw_secret_token_1_abcdef1234567890');
  v_valid_hash_2 := public.hash_invitation_token('raw_secret_token_2_abcdef1234567890');
  v_valid_hash_3 := public.hash_invitation_token('raw_secret_token_3_abcdef1234567890');

  -- 1. CRÉATION INVITATION VALIDE AVEC HASH SHA-256
  INSERT INTO public.school_membership_invitations (
    school_id, email_normalized, intended_role, token_hash, invited_by, auth_user_id
  ) VALUES (
    v_school_a_id, 'parent.a@test.com', 'parent', v_valid_hash_1, v_admin_profile_id, v_user_auth_id
  ) RETURNING id INTO v_invitation_1_id;

  ASSERT v_invitation_1_id IS NOT NULL, 'Échec création invitation valide';

  -- 2. REJET TOKEN BRUT AU LIEU DU HASH (36 CHARS UUID)
  v_error_caught := false;
  BEGIN
    INSERT INTO public.school_membership_invitations (
      school_id, email_normalized, intended_role, token_hash, invited_by
    ) VALUES (
      v_school_a_id, 'parent.raw@test.com', 'parent', gen_random_uuid()::text, v_admin_profile_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;
  ASSERT v_error_caught = true, 'Le token brut (UUID 36 chars) aurait dû être rejeté';

  -- 3. REJET HASH NON HEXADÉCIMAL OU DE MAUVAISE LONGUEUR
  v_error_caught := false;
  BEGIN
    INSERT INTO public.school_membership_invitations (
      school_id, email_normalized, intended_role, token_hash, invited_by
    ) VALUES (
      v_school_a_id, 'parent.badhash@test.com', 'parent', '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde', v_admin_profile_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;
  ASSERT v_error_caught = true, 'Un hash de 63 caractères aurait dû être rejeté';

  -- 4. REJET EMAIL NON NORMALISÉ
  v_error_caught := false;
  BEGIN
    INSERT INTO public.school_membership_invitations (
      school_id, email_normalized, intended_role, token_hash, invited_by
    ) VALUES (
      v_school_a_id, 'Parent.Unnormalized@Test.Com ', 'parent', v_valid_hash_2, v_admin_profile_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;
  ASSERT v_error_caught = true, 'Un email non normalisé aurait dû être rejeté';

  -- 5. AUTORISER PLUSIEURS INVITATIONS POUR LE MÊME AUTH_USER_ID VERS 2 ÉCOLES
  INSERT INTO public.school_membership_invitations (
    school_id, email_normalized, intended_role, token_hash, invited_by, auth_user_id
  ) VALUES (
    v_school_b_id, 'parent.a@test.com', 'parent', v_valid_hash_2, v_admin_profile_id, v_user_auth_id
  ) RETURNING id INTO v_invitation_2_id;

  ASSERT v_invitation_2_id IS NOT NULL, 'L’invitation vers l’école B aurait dû réussir';

  -- 6. REJET DOUBLON PENDING DANS LA MÊME ÉCOLE
  v_error_caught := false;
  BEGIN
    INSERT INTO public.school_membership_invitations (
      school_id, email_normalized, intended_role, token_hash, invited_by
    ) VALUES (
      v_school_a_id, 'parent.a@test.com', 'parent', v_valid_hash_3, v_admin_profile_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;
  ASSERT v_error_caught = true, 'Le doublon pending dans la même école aurait dû être rejeté';

  -- 7. AUTORISER INVITATION PARENT VISANT PLUSIEURS ÉLÈVES DE LA MÊME ÉCOLE
  INSERT INTO public.school_membership_invitation_students (invitation_id, student_id, school_id)
  VALUES (v_invitation_1_id, v_student_a1_id, v_school_a_id);

  INSERT INTO public.school_membership_invitation_students (invitation_id, student_id, school_id)
  VALUES (v_invitation_1_id, v_student_a2_id, v_school_a_id);

  SELECT COUNT(*) INTO v_count FROM public.school_membership_invitation_students WHERE invitation_id = v_invitation_1_id;
  ASSERT v_count = 2, 'L’invitation parent devrait être liée aux 2 élèves';

  -- 8. REJET ÉLÈVE D'UNE AUTRE ÉCOLE
  v_error_caught := false;
  BEGIN
    INSERT INTO public.school_membership_invitation_students (invitation_id, student_id, school_id)
    VALUES (v_invitation_1_id, v_student_b1_id, v_school_a_id);
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;
  ASSERT v_error_caught = true, 'L’élève de l’école B aurait dû être rejeté par la FK composite';

  -- 9. REJET MÉLANGE DE DEUX ÉCOLES DANS LA TABLE DE LIAISON
  v_error_caught := false;
  BEGIN
    INSERT INTO public.school_membership_invitation_students (invitation_id, student_id, school_id)
    VALUES (v_invitation_1_id, v_student_b1_id, v_school_b_id);
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;
  ASSERT v_error_caught = true, 'Le mélange des IDs d’école aurait dû être rejeté par la FK composite';

  -- 10. REJET CIBLE INEXISTANTE
  v_error_caught := false;
  BEGIN
    INSERT INTO public.school_membership_invitation_students (invitation_id, student_id, school_id)
    VALUES (v_invitation_1_id, gen_random_uuid(), v_school_a_id);
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;
  ASSERT v_error_caught = true, 'La cible inexistante aurait dû être rejetée';

  -- 11. INVARIANTS STRICTS STATUT ET HORODATAGES
  v_error_caught := false;
  BEGIN
    INSERT INTO public.school_membership_invitations (
      school_id, email_normalized, intended_role, token_hash, invited_by, status, consumed_at
    ) VALUES (
      v_school_a_id, 'invalid.pending@test.com', 'parent', v_valid_hash_3, v_admin_profile_id, 'pending', now()
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
  END;
  ASSERT v_error_caught = true, 'La combinaison status=pending et consumed_at non nul aurait dû être rejetée';

  -- 12. TRANSITION STATUT ACCEPTED VALIDE
  UPDATE public.school_membership_invitations
  SET status = 'accepted',
      consumed_at = now(),
      accepted_by_profile_id = v_admin_profile_id
  WHERE id = v_invitation_1_id;

  -- 13. PRIVILÈGES & RLS (ISOLATION RESTRICTIVE)
  SELECT COUNT(*) INTO v_count 
  FROM information_schema.role_table_grants 
  WHERE table_schema = 'public' 
    AND table_name IN ('school_membership_invitations', 'school_membership_invitation_students', 'school_membership_invitation_teachers')
    AND grantee IN ('PUBLIC', 'anon', 'authenticated');

  ASSERT v_count = 0, 'PUBLIC, anon et authenticated ne doivent avoir AUCUN privilège direct';

  -- 14. TABLE LEGACY UNCHANGED
  SELECT COUNT(*) INTO v_count FROM information_schema.tables WHERE table_name = 'school_portal_invitations';
  ASSERT v_count = 1, 'La table legacy school_portal_invitations doit rester intacte';

  RAISE NOTICE '== TOUS LES TESTS DU LOT 2K-A2a ONT RÉUSSI AVEC SUCCÈS ==';
END;
$$;

ROLLBACK;
