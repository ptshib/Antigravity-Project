-- Migration: 20260926120000_create_multi_school_invitation_foundations.sql
-- Description: Infrastructure Sécurisée des Invitations Multi-Écoles & Table Canonique Additive

-- ============================================================================
-- NOTE ARCHITECTURALE - ACCEPTATION MULTI-ÉCOLES (FUTUR LOT A2b)
-- ============================================================================
-- Lors de l'implémentation de la RPC 'accept_school_invitation(p_token TEXT)' dans A2b :
-- 1. L'acceptation devra vérifier l'identité de l'appelant via auth.uid().
-- 2. La RPC devra relire la ligne correspondante dans auth.users.
-- 3. Elle devra exiger 'email_confirmed_at IS NOT NULL'.
-- 4. Elle devra comparer strictement lower(trim(auth.users.email)) à email_normalized.
-- 5. Le JWT seul ne sera PAS accepté comme autorité finale pour valider l'adresse.
-- ============================================================================

-- Assurer la présence de l'extension pgcrypto pour digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================================
-- 1. Helpers Privés Internes (Propriétaire postgres, restreints)
-- ============================================================================

-- Helper de normalisation d'adresse email
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

-- Helper de calcul du hash SHA-256 d'un jeton brut (64 caractères hexadécimaux)
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

-- Révoquer explicitement le droit d'exécution pour les rôles clients
REVOKE EXECUTE ON FUNCTION public.normalize_email(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hash_invitation_token(TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. Table Canonique des Invitations Multi-Écoles (school_membership_invitations)
-- ============================================================================

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

  -- Validation des rôles d'établissement autorisés
  CONSTRAINT chk_school_membership_invitations_role CHECK (
    intended_role IN ('parent', 'teacher', 'student', 'school_admin')
  ),

  -- Validation des statuts d'invitation autorisés
  CONSTRAINT chk_school_membership_invitations_status CHECK (
    status IN ('pending', 'accepted', 'revoked', 'expired')
  ),

  -- Unicité du Hash et validation stricte du format SHA-256 (64 caractères hexadécimaux)
  CONSTRAINT uq_school_membership_invitations_token_hash UNIQUE (token_hash),
  CONSTRAINT chk_school_membership_invitations_token_hash_hex CHECK (
    token_hash ~* '^[0-9a-f]{64}$'
  ),

  -- Normalisation obligatoire de l'adresse email
  CONSTRAINT chk_school_membership_invitations_email_norm CHECK (
    email_normalized = lower(trim(email_normalized))
  ),

  -- Invariants chronologiques stricts
  CONSTRAINT chk_school_membership_invitations_chronology CHECK (
    expires_at >= created_at AND
    (consumed_at IS NULL OR consumed_at >= created_at) AND
    (revoked_at IS NULL OR revoked_at >= created_at)
  ),

  -- Invariants stricts entre le statut et les horodatages
  CONSTRAINT chk_school_membership_invitations_status_invariants CHECK (
    (status = 'pending' AND consumed_at IS NULL AND revoked_at IS NULL) OR
    (status = 'accepted' AND consumed_at IS NOT NULL AND revoked_at IS NULL AND accepted_by_profile_id IS NOT NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL) OR
    (status = 'expired' AND consumed_at IS NULL AND revoked_at IS NULL)
  ),

  -- Contrainte d'unicité composite nécessaire aux clés étrangères des tables cibles
  CONSTRAINT uq_school_membership_invitations_id_school UNIQUE (id, school_id)
);

-- Index d'unicité partielle : empêche plusieurs invitations 'pending' identiques dans le même établissement
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_school_membership_invitations_pending 
  ON public.school_membership_invitations (school_id, email_normalized, intended_role) 
  WHERE (status = 'pending');

-- Index de recherche rapide du hash et de l'email
CREATE INDEX IF NOT EXISTS idx_school_membership_invitations_hash 
  ON public.school_membership_invitations (token_hash) 
  WHERE (status = 'pending');

CREATE INDEX IF NOT EXISTS idx_school_membership_invitations_email 
  ON public.school_membership_invitations (email_normalized, status);

-- Trigger de mise à jour automatique d'updated_at
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

-- ============================================================================
-- 3. Tables de Liaison Typées vers les Cibles Métier (FKs Composites & Triggers)
-- ============================================================================

-- Table de liaison des élèves ciblés par une invitation
CREATE TABLE IF NOT EXISTS public.school_membership_invitation_students (
  invitation_id UUID NOT NULL,
  student_id UUID NOT NULL,
  school_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_school_membership_invitation_students PRIMARY KEY (invitation_id, student_id),

  -- FK Composite 1 : Garantit que la liaison correspond au school_id de l'invitation
  CONSTRAINT fk_invitation_student_invitation FOREIGN KEY (invitation_id, school_id)
    REFERENCES public.school_membership_invitations(id, school_id) ON DELETE CASCADE,

  -- FK Composite 2 : Garantit que l'élève appartient strictement à la MÊME école !
  CONSTRAINT fk_invitation_student_student FOREIGN KEY (student_id, school_id)
    REFERENCES public.students(id, school_id) ON DELETE CASCADE
);

-- Table de liaison des enseignants ciblés par une invitation (préparation Lot A4)
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

-- Trigger d'intégrité garantissant que l'enseignant appartient strictement à la même école
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

-- Index pour les recherches inverses de cibles
CREATE INDEX IF NOT EXISTS idx_invitation_students_student_id 
  ON public.school_membership_invitation_students(student_id);

CREATE INDEX IF NOT EXISTS idx_invitation_teachers_teacher_id 
  ON public.school_membership_invitation_teachers(teacher_id);

-- ============================================================================
-- 4. Isolation Strict RLS & Privilèges Réseau (Fail-Closed)
-- ============================================================================

ALTER TABLE public.school_membership_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_membership_invitation_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_membership_invitation_teachers ENABLE ROW LEVEL SECURITY;

-- Révocation de TOUS les accès directs pour les rôles client
REVOKE ALL ON public.school_membership_invitations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.school_membership_invitation_students FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.school_membership_invitation_teachers FROM PUBLIC, anon, authenticated;
