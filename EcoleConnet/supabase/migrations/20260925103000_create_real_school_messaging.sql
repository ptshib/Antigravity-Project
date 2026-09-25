-- ============================================================================
-- Migration Phase 2J-B-V2 : Messagerie Réelle Enseignant–Parent (Correctif Transactionnel read_only)
-- Fichier : supabase/migrations/20260925103000_create_real_school_messaging.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 0. NETTOYAGE DES SURCHARGES HISTORIQUES POUR ÉVITER TOUTE AMBIGUÏTÉ
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_messaging_contacts(UUID);
DROP FUNCTION IF EXISTS public.get_or_create_school_conversation(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.get_school_conversation_unread_count(UUID);
DROP FUNCTION IF EXISTS public.get_school_conversations();
DROP FUNCTION IF EXISTS public.get_school_conversation_messages(UUID, TIMESTAMPTZ, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.send_school_message(UUID, TEXT);
DROP FUNCTION IF EXISTS public.mark_school_conversation_read(UUID);
DROP FUNCTION IF EXISTS public.set_school_conversation_archived(UUID, BOOLEAN);

--------------------------------------------------------------------------------
-- 1. CRÉATION DES TABLES
--------------------------------------------------------------------------------

-- A. Table public.school_conversations
CREATE TABLE IF NOT EXISTS public.school_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  parent_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  teacher_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  subject_id UUID NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CONSTRAINT chk_school_conv_status CHECK (status IN ('active', 'read_only')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index uniques partiels avec class_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_school_conv_primary
  ON public.school_conversations (school_id, academic_year_id, class_id, student_id, parent_profile_id, teacher_profile_id)
  WHERE (subject_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_school_conv_secondary
  ON public.school_conversations (school_id, academic_year_id, class_id, student_id, parent_profile_id, teacher_profile_id, subject_id)
  WHERE (subject_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_school_conv_parent ON public.school_conversations(parent_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_school_conv_teacher ON public.school_conversations(teacher_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_school_conv_student ON public.school_conversations(student_id);

-- B. Table public.school_messages
CREATE TABLE IF NOT EXISTS public.school_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.school_conversations(id) ON DELETE RESTRICT,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  sender_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  content TEXT NOT NULL CONSTRAINT chk_message_content_length CHECK (length(trim(content)) > 0 AND length(content) <= 3000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_messages_conv_id UNIQUE (conversation_id, id)
);

CREATE INDEX IF NOT EXISTS idx_school_messages_conv_created ON public.school_messages(conversation_id, created_at DESC, id DESC);

-- C. Table public.school_conversation_participants
CREATE TABLE IF NOT EXISTS public.school_conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.school_conversations(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CONSTRAINT chk_participant_role CHECK (role IN ('parent', 'teacher')),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_message_id UUID NULL,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversation_participant UNIQUE (conversation_id, profile_id),
  CONSTRAINT fk_participant_last_read_message_composite
    FOREIGN KEY (conversation_id, last_read_message_id)
    REFERENCES public.school_messages(conversation_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_profile ON public.school_conversation_participants(profile_id, is_archived);

--------------------------------------------------------------------------------
-- 2. TRIGGERS D'INTÉGRITÉ
--------------------------------------------------------------------------------

-- Trigger 1 : check_school_conversation_integrity()
CREATE OR REPLACE FUNCTION public.check_school_conversation_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.school_id <> NEW.school_id OR
       OLD.academic_year_id <> NEW.academic_year_id OR
       OLD.student_id <> NEW.student_id OR
       OLD.class_id <> NEW.class_id OR
       OLD.parent_profile_id <> NEW.parent_profile_id OR
       OLD.teacher_profile_id <> NEW.teacher_profile_id OR
       OLD.subject_id IS DISTINCT FROM NEW.subject_id OR
       OLD.created_by <> NEW.created_by THEN
      RAISE EXCEPTION 'Accès refusé : Les champs d identité d une conversation sont immuables'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_profile_id = NEW.teacher_profile_id THEN
    RAISE EXCEPTION 'Accès refusé : Le parent et l enseignant doivent être des profils distincts'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.created_by <> NEW.parent_profile_id AND NEW.created_by <> NEW.teacher_profile_id THEN
    RAISE EXCEPTION 'Accès refusé : created_by doit appartenir au parent ou à l enseignant'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = NEW.class_id
      AND c.school_id = NEW.school_id
      AND c.academic_year_id = NEW.academic_year_id
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Classe inexistante ou incohérente' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.students st
    JOIN public.student_enrollments se ON se.student_id = st.id
    WHERE st.id = NEW.student_id
      AND st.school_id = NEW.school_id
      AND st.enrollment_status = 'active'
      AND se.class_id = NEW.class_id
      AND se.academic_year_id = NEW.academic_year_id
      AND se.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Accès refusé : L élève n a pas d inscription active dans cette classe'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    JOIN public.parent_accounts pa ON pa.profile_id = psl.parent_profile_id AND pa.school_id = psl.school_id
    WHERE psl.parent_profile_id = NEW.parent_profile_id
      AND psl.student_id = NEW.student_id
      AND psl.school_id = NEW.school_id
      AND psl.status = 'approved'
      AND pa.account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Aucun lien parent-élève actif et approuvé trouvé'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.teachers t
    JOIN public.profiles prof ON prof.id = t.profile_id
    WHERE t.profile_id = NEW.teacher_profile_id
      AND t.school_id = NEW.school_id
      AND t.employment_status = 'active'
      AND t.account_status = 'active'
      AND prof.is_active = true
  ) THEN
    RAISE EXCEPTION 'Accès refusé : Enseignant inexistant, inactif ou d un autre établissement'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.classes
    WHERE id = NEW.class_id AND pedagogical_mode = 'primary_homeroom'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.classes
      WHERE id = NEW.class_id AND homeroom_teacher_id = NEW.teacher_profile_id
    ) THEN
      RAISE EXCEPTION 'Accès refusé : L enseignant n est pas le titulaire de cette classe primaire'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.subject_id IS NOT NULL THEN
      RAISE EXCEPTION 'Accès refusé : Les conversations primaires ne doivent pas spécifier de matière'
        USING ERRCODE = '22023';
    END IF;

  ELSIF EXISTS (
    SELECT 1 FROM public.classes
    WHERE id = NEW.class_id AND pedagogical_mode = 'secondary_subjects'
  ) THEN
    IF NEW.subject_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : La matière est obligatoire pour une conversation secondaire'
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.subjects sub
      WHERE sub.id = NEW.subject_id
        AND sub.school_id = NEW.school_id
        AND sub.is_active = true
    ) THEN
      RAISE EXCEPTION 'Accès refusé : Matière inexistante ou inactive'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.teacher_class_assignments tca
      WHERE tca.teacher_profile_id = NEW.teacher_profile_id
        AND tca.class_id = NEW.class_id
        AND tca.subject_id = NEW.subject_id
        AND tca.academic_year_id = NEW.academic_year_id
        AND tca.school_id = NEW.school_id
        AND tca.is_active = true
    ) THEN
      RAISE EXCEPTION 'Accès refusé : L enseignant n a pas d affectation active pour cette classe et cette matière'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Régime pédagogique de classe invalide' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_school_conversation_integrity ON public.school_conversations;
CREATE TRIGGER trg_check_school_conversation_integrity
  BEFORE INSERT OR UPDATE ON public.school_conversations
  FOR EACH ROW EXECUTE FUNCTION public.check_school_conversation_integrity();

-- Trigger 2 : check_school_conversation_participant_integrity()
CREATE OR REPLACE FUNCTION public.check_school_conversation_participant_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_conv_parent UUID;
  v_conv_teacher UUID;
  v_count INTEGER;
  v_old_created_at TIMESTAMPTZ;
  v_old_id UUID;
  v_new_created_at TIMESTAMPTZ;
  v_new_id UUID;
  v_msg_created_at TIMESTAMPTZ;
BEGIN
  SELECT parent_profile_id, teacher_profile_id
  INTO v_conv_parent, v_conv_teacher
  FROM public.school_conversations
  WHERE id = NEW.conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accès refusé : Conversation parente inexistante' USING ERRCODE = '42501';
  END IF;

  IF NEW.role = 'parent' THEN
    IF NEW.profile_id <> v_conv_parent THEN
      RAISE EXCEPTION 'Accès refusé : Le participant parent ne correspond pas à la conversation'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.role = 'teacher' THEN
    IF NEW.profile_id <> v_conv_teacher THEN
      RAISE EXCEPTION 'Accès refusé : Le participant teacher ne correspond pas à la conversation'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé : Rôle participant invalide' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COUNT(*) INTO v_count
    FROM public.school_conversation_participants
    WHERE conversation_id = NEW.conversation_id;

    IF v_count >= 2 THEN
      RAISE EXCEPTION 'Accès refusé : Une conversation ne peut contenir que exactement 2 participants'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.conversation_id <> NEW.conversation_id OR
       OLD.profile_id <> NEW.profile_id OR
       OLD.role <> NEW.role THEN
      RAISE EXCEPTION 'Accès refusé : conversation_id, profile_id et role sont immuables'
        USING ERRCODE = '42501';
    END IF;

    -- Passage de non-nul vers NULL interdit
    IF OLD.last_read_message_id IS NOT NULL AND NEW.last_read_message_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Le curseur de lecture ne peut pas être remis à NULL'
        USING ERRCODE = '22023';
    END IF;

    -- Contrôle du recul du curseur
    IF OLD.last_read_message_id IS NOT NULL AND NEW.last_read_message_id IS NOT NULL AND NEW.last_read_message_id IS DISTINCT FROM OLD.last_read_message_id THEN
      SELECT created_at INTO v_old_created_at
      FROM public.school_messages WHERE id = OLD.last_read_message_id;

      SELECT created_at INTO v_new_created_at
      FROM public.school_messages WHERE id = NEW.last_read_message_id;

      IF v_new_created_at < v_old_created_at THEN
        RAISE EXCEPTION 'Accès refusé : Le marqueur de lecture ne peut pas reculer dans le temps'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    -- Vérification de la cohérence de last_read_at avec le message référencé
    IF NEW.last_read_message_id IS NOT NULL AND NEW.last_read_message_id IS DISTINCT FROM OLD.last_read_message_id THEN
      SELECT created_at INTO v_msg_created_at
      FROM public.school_messages WHERE id = NEW.last_read_message_id;

      IF NEW.last_read_at <> v_msg_created_at THEN
        RAISE EXCEPTION 'Accès refusé : last_read_at doit être égal au created_at du message référencé'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_school_conversation_participant_integrity ON public.school_conversation_participants;
CREATE TRIGGER trg_check_school_conversation_participant_integrity
  BEFORE INSERT OR UPDATE ON public.school_conversation_participants
  FOR EACH ROW EXECUTE FUNCTION public.check_school_conversation_participant_integrity();

-- Trigger 3 : check_school_message_integrity()
CREATE OR REPLACE FUNCTION public.check_school_message_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_conv_school_id UUID;
  v_is_participant BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Accès refusé : La suppression de messages est strictement interdite'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Accès refusé : Les messages sont immuables et ne peuvent pas être modifiés'
      USING ERRCODE = '42501';
  END IF;

  SELECT school_id INTO v_conv_school_id
  FROM public.school_conversations
  WHERE id = NEW.conversation_id;

  IF v_conv_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Conversation inexistante' USING ERRCODE = '42501';
  END IF;

  IF NEW.school_id <> v_conv_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Le school_id du message ne correspond pas à celui de la conversation'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.school_conversation_participants
    WHERE conversation_id = NEW.conversation_id AND profile_id = NEW.sender_profile_id
  ) INTO v_is_participant;

  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'Accès refusé : L expéditeur doit être un participant enregistré de la conversation'
      USING ERRCODE = '42501';
  END IF;

  IF length(trim(NEW.content)) = 0 OR length(NEW.content) > 3000 THEN
    RAISE EXCEPTION 'Accès refusé : Le message doit contenir entre 1 et 3000 caractères'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_school_message_integrity ON public.school_messages;
CREATE TRIGGER trg_check_school_message_integrity
  BEFORE INSERT OR UPDATE OR DELETE ON public.school_messages
  FOR EACH ROW EXECUTE FUNCTION public.check_school_message_integrity();

--------------------------------------------------------------------------------
-- 3. POLITIQUES RLS ET PRIVILÈGES DIRECTS
--------------------------------------------------------------------------------

ALTER TABLE public.school_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.school_conversation_participants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.school_messages FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.school_conversations TO authenticated;
GRANT SELECT ON public.school_conversation_participants TO authenticated;
GRANT SELECT ON public.school_messages TO authenticated;

DROP POLICY IF EXISTS p_participants_select ON public.school_conversation_participants;
CREATE POLICY p_participants_select ON public.school_conversation_participants
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS p_conversations_select ON public.school_conversations;
CREATE POLICY p_conversations_select ON public.school_conversations
  FOR SELECT TO authenticated
  USING (parent_profile_id = auth.uid() OR teacher_profile_id = auth.uid());

DROP POLICY IF EXISTS p_messages_select ON public.school_messages;
CREATE POLICY p_messages_select ON public.school_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.school_conversations c
      WHERE c.id = school_messages.conversation_id
        AND (c.parent_profile_id = auth.uid() OR c.teacher_profile_id = auth.uid())
    )
  );

--------------------------------------------------------------------------------
-- 4. RPCS SÉCURISÉES D'APPLICATION
--------------------------------------------------------------------------------

-- RPC 1 : get_messaging_contacts
CREATE OR REPLACE FUNCTION public.get_messaging_contacts(
  p_student_id UUID
) RETURNS TABLE (
  profile_id UUID,
  full_name TEXT,
  role TEXT,
  subject_id UUID,
  subject_name TEXT,
  is_homeroom BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_school_id UUID;
  v_academic_year_id UUID;
  v_class_id UUID;
  v_class_mode TEXT;
  v_enrollment_count INTEGER;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Session non authentifiée' USING ERRCODE = '42501';
  END IF;

  SELECT school_id INTO v_school_id FROM public.students WHERE id = p_student_id AND enrollment_status = 'active';
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Élève inexistant ou non actif' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_academic_year_id FROM public.academic_years WHERE school_id = v_school_id AND is_current = true;
  IF v_academic_year_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Aucune année scolaire courante trouvée' USING ERRCODE = '42501';
  END IF;

  -- Résolution stricte de l'inscription sans LIMIT 1
  SELECT COUNT(*), (ARRAY_AGG(se.class_id))[1]
  INTO v_enrollment_count, v_class_id
  FROM public.student_enrollments se
  WHERE se.student_id = p_student_id
    AND se.school_id = v_school_id
    AND se.academic_year_id = v_academic_year_id
    AND se.status = 'active';

  IF v_enrollment_count = 0 THEN
    RAISE EXCEPTION 'Accès refusé : L élève n a aucune inscription active pour l année scolaire courante' USING ERRCODE = '42501';
  ELSIF v_enrollment_count > 1 THEN
    RAISE EXCEPTION 'Conflit de données : Plusieurs inscriptions actives trouvées pour l élève' USING ERRCODE = '22023';
  END IF;

  -- Si l'appelant est le parent lié
  IF EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    JOIN public.parent_accounts pa ON pa.profile_id = psl.parent_profile_id AND pa.school_id = psl.school_id
    WHERE psl.parent_profile_id = v_caller_id
      AND psl.student_id = p_student_id
      AND psl.school_id = v_school_id
      AND psl.status = 'approved'
      AND pa.account_status = 'active'
  ) THEN
    SELECT pedagogical_mode INTO v_class_mode FROM public.classes WHERE id = v_class_id;

    IF v_class_mode = 'primary_homeroom' THEN
      RETURN QUERY
      SELECT prof.id AS profile_id,
             (prof.first_name || ' ' || prof.last_name)::TEXT AS full_name,
             'teacher'::TEXT AS role,
             NULL::UUID AS subject_id,
             NULL::TEXT AS subject_name,
             true AS is_homeroom
      FROM public.classes c
      JOIN public.profiles prof ON prof.id = c.homeroom_teacher_id
      JOIN public.teachers t ON t.profile_id = prof.id
      WHERE c.id = v_class_id
        AND prof.is_active = true
        AND t.employment_status = 'active'
        AND t.account_status = 'active';
    ELSE
      RETURN QUERY
      SELECT DISTINCT prof.id AS profile_id,
             (prof.first_name || ' ' || prof.last_name)::TEXT AS full_name,
             'teacher'::TEXT AS role,
             sub.id AS subject_id,
             sub.name::TEXT AS subject_name,
             (c.homeroom_teacher_id = prof.id) AS is_homeroom
      FROM public.teacher_class_assignments tca
      JOIN public.profiles prof ON prof.id = tca.teacher_profile_id
      JOIN public.teachers t ON t.profile_id = prof.id
      JOIN public.subjects sub ON sub.id = tca.subject_id
      JOIN public.classes c ON c.id = tca.class_id
      WHERE tca.class_id = v_class_id
        AND tca.academic_year_id = v_academic_year_id
        AND tca.is_active = true
        AND prof.is_active = true
        AND t.employment_status = 'active'
        AND t.account_status = 'active'
        AND sub.is_active = true;
    END IF;

  -- Si l'appelant est un enseignant autorisé sur cette classe
  ELSIF EXISTS (
    SELECT 1 FROM public.teachers t
    JOIN public.profiles prof ON prof.id = t.profile_id
    WHERE t.profile_id = v_caller_id
      AND t.school_id = v_school_id
      AND t.employment_status = 'active'
      AND t.account_status = 'active'
      AND prof.is_active = true
  ) THEN
    SELECT pedagogical_mode INTO v_class_mode FROM public.classes WHERE id = v_class_id;

    IF (v_class_mode = 'primary_homeroom' AND EXISTS (
          SELECT 1 FROM public.classes WHERE id = v_class_id AND homeroom_teacher_id = v_caller_id
        )) OR
       (v_class_mode = 'secondary_subjects' AND EXISTS (
          SELECT 1 FROM public.teacher_class_assignments tca
          WHERE tca.teacher_profile_id = v_caller_id
            AND tca.class_id = v_class_id
            AND tca.academic_year_id = v_academic_year_id
            AND tca.school_id = v_school_id
            AND tca.is_active = true
        )) THEN
      RETURN QUERY
      SELECT prof.id AS profile_id,
             (prof.first_name || ' ' || prof.last_name)::TEXT AS full_name,
             'parent'::TEXT AS role,
             NULL::UUID AS subject_id,
             NULL::TEXT AS subject_name,
             false AS is_homeroom
      FROM public.parent_student_links psl
      JOIN public.profiles prof ON prof.id = psl.parent_profile_id
      JOIN public.parent_accounts pa ON pa.profile_id = prof.id AND pa.school_id = v_school_id
      WHERE psl.student_id = p_student_id
        AND psl.school_id = v_school_id
        AND psl.status = 'approved'
        AND pa.account_status = 'active'
        AND prof.is_active = true;
    ELSE
      -- Enseignant non affecté à la classe de cet élève -> 0 contact
      RETURN;
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé : Aucun privilège de contact pour cet élève' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- RPC 2 : get_or_create_school_conversation
CREATE OR REPLACE FUNCTION public.get_or_create_school_conversation(
  p_student_id UUID,
  p_counterparty_profile_id UUID,
  p_subject_id UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_school_id UUID;
  v_academic_year_id UUID;
  v_class_id UUID;
  v_enrollment_count INTEGER;
  v_parent_id UUID;
  v_teacher_id UUID;
  v_conv_id UUID;
  v_part_count INTEGER;
  v_existing_status TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Session non authentifiée' USING ERRCODE = '42501';
  END IF;

  SELECT school_id INTO v_school_id FROM public.students WHERE id = p_student_id AND enrollment_status = 'active';
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Élève inexistant ou non actif' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_academic_year_id FROM public.academic_years WHERE school_id = v_school_id AND is_current = true;
  IF v_academic_year_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Aucune année scolaire courante trouvée' USING ERRCODE = '42501';
  END IF;

  -- Résolution stricte de l'inscription active sans LIMIT 1
  SELECT COUNT(*), (ARRAY_AGG(se.class_id))[1]
  INTO v_enrollment_count, v_class_id
  FROM public.student_enrollments se
  WHERE se.student_id = p_student_id
    AND se.school_id = v_school_id
    AND se.academic_year_id = v_academic_year_id
    AND se.status = 'active';

  IF v_enrollment_count = 0 THEN
    RAISE EXCEPTION 'Accès refusé : L élève n a aucune inscription active pour l année scolaire courante' USING ERRCODE = '42501';
  ELSIF v_enrollment_count > 1 THEN
    RAISE EXCEPTION 'Conflit de données : Plusieurs inscriptions actives incompatibles trouvées' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.parent_student_links
    WHERE parent_profile_id = v_caller_id AND student_id = p_student_id AND status = 'approved'
  ) THEN
    v_parent_id := v_caller_id;
    v_teacher_id := p_counterparty_profile_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.teachers WHERE profile_id = v_caller_id AND school_id = v_school_id AND employment_status = 'active' AND account_status = 'active'
  ) THEN
    v_teacher_id := v_caller_id;
    v_parent_id := p_counterparty_profile_id;
  ELSE
    RAISE EXCEPTION 'L appelant n est ni un parent ni un enseignant autorisé pour cet élève'
      USING ERRCODE = '42501';
  END IF;

  IF p_subject_id IS NULL THEN
    SELECT id, status INTO v_conv_id, v_existing_status FROM public.school_conversations
    WHERE school_id = v_school_id AND academic_year_id = v_academic_year_id
      AND class_id = v_class_id AND student_id = p_student_id
      AND parent_profile_id = v_parent_id AND teacher_profile_id = v_teacher_id
      AND subject_id IS NULL;
  ELSE
    SELECT id, status INTO v_conv_id, v_existing_status FROM public.school_conversations
    WHERE school_id = v_school_id AND academic_year_id = v_academic_year_id
      AND class_id = v_class_id AND student_id = p_student_id
      AND parent_profile_id = v_parent_id AND teacher_profile_id = v_teacher_id
      AND subject_id = p_subject_id;
  END IF;

  IF v_conv_id IS NULL THEN
    BEGIN
      INSERT INTO public.school_conversations (
        school_id, academic_year_id, student_id, class_id,
        parent_profile_id, teacher_profile_id, subject_id, created_by, status
      ) VALUES (
        v_school_id, v_academic_year_id, p_student_id, v_class_id,
        v_parent_id, v_teacher_id, p_subject_id, v_caller_id, 'active'
      ) RETURNING id INTO v_conv_id;
    EXCEPTION
      WHEN unique_violation THEN
        IF p_subject_id IS NULL THEN
          SELECT id, status INTO v_conv_id, v_existing_status FROM public.school_conversations
          WHERE school_id = v_school_id AND academic_year_id = v_academic_year_id
            AND class_id = v_class_id AND student_id = p_student_id
            AND parent_profile_id = v_parent_id AND teacher_profile_id = v_teacher_id
            AND subject_id IS NULL;
        ELSE
          SELECT id, status INTO v_conv_id, v_existing_status FROM public.school_conversations
          WHERE school_id = v_school_id AND academic_year_id = v_academic_year_id
            AND class_id = v_class_id AND student_id = p_student_id
            AND parent_profile_id = v_parent_id AND teacher_profile_id = v_teacher_id
            AND subject_id = p_subject_id;
        END IF;
    END;
  END IF;

  -- Insérer atomiquement les 2 participants
  INSERT INTO public.school_conversation_participants (conversation_id, profile_id, role)
  VALUES
    (v_conv_id, v_parent_id, 'parent'),
    (v_conv_id, v_teacher_id, 'teacher')
  ON CONFLICT (conversation_id, profile_id) DO NOTHING;

  -- Vérifier exactement 2 participants au total
  SELECT COUNT(*) INTO v_part_count
  FROM public.school_conversation_participants
  WHERE conversation_id = v_conv_id;

  IF v_part_count <> 2 THEN
    RAISE EXCEPTION 'Échec d intégrité : La conversation doit contenir exactement 2 participants au total'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.school_conversation_participants WHERE conversation_id = v_conv_id AND profile_id = v_parent_id AND role = 'parent'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.school_conversation_participants WHERE conversation_id = v_conv_id AND profile_id = v_teacher_id AND role = 'teacher'
  ) THEN
    RAISE EXCEPTION 'Échec d intégrité : Les participants ne correspondent pas aux rôles déclarés' USING ERRCODE = '42501';
  END IF;

  RETURN v_conv_id;
END;
$$;

-- RPC 3 : get_school_conversation_unread_count
CREATE OR REPLACE FUNCTION public.get_school_conversation_unread_count(
  p_conversation_id UUID
) RETURNS BIGINT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_last_read_at TIMESTAMPTZ;
  v_last_read_id UUID;
  v_count BIGINT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Session non authentifiée' USING ERRCODE = '42501';
  END IF;

  SELECT p.last_read_at, p.last_read_message_id
  INTO v_last_read_at, v_last_read_id
  FROM public.school_conversation_participants p
  WHERE p.conversation_id = p_conversation_id AND p.profile_id = v_caller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accès refusé : L appelant n est pas participant' USING ERRCODE = '42501';
  END IF;

  IF v_last_read_id IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM public.school_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.sender_profile_id <> v_caller_id;
  ELSE
    SELECT COUNT(*) INTO v_count
    FROM public.school_messages m
    JOIN public.school_messages lm ON lm.id = v_last_read_id AND lm.conversation_id = p_conversation_id
    WHERE m.conversation_id = p_conversation_id
      AND m.sender_profile_id <> v_caller_id
      AND (
        m.created_at > lm.created_at
        OR (m.created_at = lm.created_at AND m.id > lm.id)
      );
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- RPC 4 : get_school_conversations
CREATE OR REPLACE FUNCTION public.get_school_conversations()
RETURNS TABLE (
  conversation_id UUID,
  school_id UUID,
  student_id UUID,
  student_name TEXT,
  class_name TEXT,
  counterparty_profile_id UUID,
  counterparty_name TEXT,
  counterparty_role TEXT,
  subject_name TEXT,
  status TEXT,
  is_archived BOOLEAN,
  last_message_content TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Session non authentifiée' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.id AS conversation_id,
         c.school_id,
         c.student_id,
         (st_prof.first_name || ' ' || st_prof.last_name)::TEXT AS student_name,
         cls.name::TEXT AS class_name,
         cp.profile_id AS counterparty_profile_id,
         (cp_prof.first_name || ' ' || cp_prof.last_name)::TEXT AS counterparty_name,
         cp.role AS counterparty_role,
         sub.name::TEXT AS subject_name,
         c.status,
         me.is_archived,
         lm.content AS last_message_content,
         lm.created_at AS last_message_at,
         public.get_school_conversation_unread_count(c.id) AS unread_count
  FROM public.school_conversations c
  JOIN public.school_conversation_participants me ON me.conversation_id = c.id AND me.profile_id = v_caller_id
  JOIN public.school_conversation_participants cp ON cp.conversation_id = c.id AND cp.profile_id <> v_caller_id
  JOIN public.profiles cp_prof ON cp_prof.id = cp.profile_id
  JOIN public.students st ON st.id = c.student_id
  LEFT JOIN public.profiles st_prof ON st_prof.id = st.profile_id
  JOIN public.classes cls ON cls.id = c.class_id
  LEFT JOIN public.subjects sub ON sub.id = c.subject_id
  LEFT JOIN LATERAL (
    SELECT m.content, m.created_at
    FROM public.school_messages m
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lm ON true
  ORDER BY COALESCE(lm.created_at, c.created_at) DESC;
END;
$$;

-- RPC 5 : get_school_conversation_messages (Pagination déterministe renforcée)
CREATE OR REPLACE FUNCTION public.get_school_conversation_messages(
  p_conversation_id UUID,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
) RETURNS TABLE (
  message_id UUID,
  conversation_id UUID,
  sender_profile_id UUID,
  sender_name TEXT,
  content TEXT,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_real_limit INTEGER;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Session non authentifiée' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.school_conversation_participants
    WHERE conversation_id = p_conversation_id AND profile_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Accès refusé : L appelant n est pas participant' USING ERRCODE = '42501';
  END IF;

  -- Validation du contrat de pagination
  IF (p_before_created_at IS NOT NULL AND p_before_id IS NULL) OR
     (p_before_created_at IS NULL AND p_before_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Paramètres de pagination invalides : p_before_created_at et p_before_id doivent être fournis ensemble'
      USING ERRCODE = '22023';
  END IF;

  v_real_limit := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);

  RETURN QUERY
  SELECT m.id AS message_id,
         m.conversation_id,
         m.sender_profile_id,
         (prof.first_name || ' ' || prof.last_name)::TEXT AS sender_name,
         m.content,
         m.created_at,
         (m.sender_profile_id = v_caller_id) AS is_mine
  FROM public.school_messages m
  JOIN public.profiles prof ON prof.id = m.sender_profile_id
  WHERE m.conversation_id = p_conversation_id
    AND (
      p_before_created_at IS NULL
      OR m.created_at < p_before_created_at
      OR (m.created_at = p_before_created_at AND m.id < p_before_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT v_real_limit;
END;
$$;

-- RPC 6 : send_school_message (Correction Transactionnelle read_only sans exception sur UPDATE)
CREATE OR REPLACE FUNCTION public.send_school_message(
  p_conversation_id UUID,
  p_content TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_conv RECORD;
  v_is_valid BOOLEAN := true;
  v_new_msg RECORD;
BEGIN
  -- 1. Contrôles de sécurité stricts (Lèvent des exceptions réelles sans UPDATE préalable)
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Session non authentifiée' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv FROM public.school_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation inexistante' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.school_conversation_participants
    WHERE conversation_id = p_conversation_id AND profile_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Accès refusé : L appelant n est pas participant' USING ERRCODE = '42501';
  END IF;

  -- 2. Si la conversation est DÉJÀ en read_only -> Retour métier sans exception ni insertion
  IF v_conv.status = 'read_only' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'CONVERSATION_READ_ONLY',
      'message', 'Cette conversation est désormais en lecture seule car la relation scolaire n est plus active.'
    );
  END IF;

  -- 3. Recalcul dynamique de la validité de la relation scolaire / parentale
  IF NOT EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    JOIN public.parent_accounts pa ON pa.profile_id = psl.parent_profile_id AND pa.school_id = psl.school_id
    WHERE psl.parent_profile_id = v_conv.parent_profile_id
      AND psl.student_id = v_conv.student_id
      AND psl.school_id = v_conv.school_id
      AND psl.status = 'approved'
      AND pa.account_status = 'active'
  ) THEN
    v_is_valid := false;
  END IF;

  IF v_is_valid AND NOT EXISTS (
    SELECT 1 FROM public.students st
    JOIN public.student_enrollments se ON se.student_id = st.id
    WHERE st.id = v_conv.student_id
      AND st.school_id = v_conv.school_id
      AND st.enrollment_status = 'active'
      AND se.class_id = v_conv.class_id
      AND se.academic_year_id = v_conv.academic_year_id
      AND se.status = 'active'
  ) THEN
    v_is_valid := false;
  END IF;

  IF v_is_valid AND NOT EXISTS (
    SELECT 1 FROM public.teachers t
    JOIN public.profiles prof ON prof.id = t.profile_id
    WHERE t.profile_id = v_conv.teacher_profile_id
      AND t.school_id = v_conv.school_id
      AND t.employment_status = 'active'
      AND t.account_status = 'active'
      AND prof.is_active = true
  ) THEN
    v_is_valid := false;
  END IF;

  -- 4. Si la relation est devenue invalide : passer en read_only ET retourner la réponse métier sans exception !
  IF NOT v_is_valid THEN
    UPDATE public.school_conversations SET status = 'read_only', updated_at = now() WHERE id = p_conversation_id;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'CONVERSATION_READ_ONLY',
      'message', 'Cette conversation est désormais en lecture seule car la relation scolaire n est plus active.'
    );
  END IF;

  -- 5. Relation valide : Insérer le message et mettre à jour le curseur de l'expéditeur
  INSERT INTO public.school_messages (conversation_id, school_id, sender_profile_id, content)
  VALUES (p_conversation_id, v_conv.school_id, v_caller_id, p_content)
  RETURNING * INTO v_new_msg;

  UPDATE public.school_conversation_participants
  SET last_read_at = v_new_msg.created_at,
      last_read_message_id = v_new_msg.id,
      updated_at = now()
  WHERE conversation_id = p_conversation_id AND profile_id = v_caller_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', jsonb_build_object(
      'id', v_new_msg.id,
      'conversation_id', v_new_msg.conversation_id,
      'sender_profile_id', v_new_msg.sender_profile_id,
      'content', v_new_msg.content,
      'created_at', v_new_msg.created_at
    )
  );
END;
$$;

-- RPC 7 : mark_school_conversation_read
CREATE OR REPLACE FUNCTION public.mark_school_conversation_read(
  p_conversation_id UUID
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_last_msg_id UUID;
  v_last_msg_at TIMESTAMPTZ;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Session non authentifiée' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.school_conversation_participants
    WHERE conversation_id = p_conversation_id AND profile_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Accès refusé : L appelant n est pas participant' USING ERRCODE = '42501';
  END IF;

  SELECT id, created_at INTO v_last_msg_id, v_last_msg_at
  FROM public.school_messages
  WHERE conversation_id = p_conversation_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_last_msg_id IS NOT NULL THEN
    UPDATE public.school_conversation_participants
    SET last_read_at = v_last_msg_at,
        last_read_message_id = v_last_msg_id,
        updated_at = now()
    WHERE conversation_id = p_conversation_id AND profile_id = v_caller_id;
  END IF;

  RETURN true;
END;
$$;

-- RPC 8 : set_school_conversation_archived
CREATE OR REPLACE FUNCTION public.set_school_conversation_archived(
  p_conversation_id UUID,
  p_archived BOOLEAN
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Session non authentifiée' USING ERRCODE = '42501';
  END IF;

  UPDATE public.school_conversation_participants
  SET is_archived = p_archived,
      updated_at = now()
  WHERE conversation_id = p_conversation_id AND profile_id = v_caller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accès refusé : L appelant n est pas participant' USING ERRCODE = '42501';
  END IF;

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 5. GESTION DES PRIVILÈGES ET PROPRIÉTAIRE DES FONCTIONS
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.check_school_conversation_integrity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_school_conversation_participant_integrity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_school_message_integrity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_school_conversation_unread_count(UUID) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_messaging_contacts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_messaging_contacts(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_or_create_school_conversation(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_school_conversation(UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_school_conversations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_conversations() TO authenticated;

REVOKE ALL ON FUNCTION public.get_school_conversation_messages(UUID, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_conversation_messages(UUID, TIMESTAMPTZ, UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.send_school_message(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_school_message(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_school_conversation_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_school_conversation_read(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.set_school_conversation_archived(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_school_conversation_archived(UUID, BOOLEAN) TO authenticated;

COMMIT;
