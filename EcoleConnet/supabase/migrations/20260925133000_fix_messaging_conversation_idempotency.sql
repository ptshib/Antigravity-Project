-- Migration : 20260925133000_fix_messaging_conversation_idempotency.sql
-- Description : Fix idempotency of get_or_create_school_conversation and remove BEFORE INSERT count check in check_school_conversation_participant_integrity

-- 1. Update check_school_conversation_participant_integrity()
CREATE OR REPLACE FUNCTION public.check_school_conversation_participant_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_conv_parent UUID;
  v_conv_teacher UUID;
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

  IF TG_OP = 'UPDATE' THEN
    IF OLD.conversation_id <> NEW.conversation_id OR
       OLD.profile_id <> NEW.profile_id OR
       OLD.role <> NEW.role THEN
      RAISE EXCEPTION 'Accès refusé : conversation_id, profile_id et role sont immuables'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.last_read_at IS NOT NULL AND NEW.last_read_at IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : last_read_at ne peut pas être réinitialisé à NULL'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.last_read_at < OLD.last_read_at THEN
      RAISE EXCEPTION 'Accès refusé : last_read_at ne peut pas reculer dans le temps'
        USING ERRCODE = '22023';
    END IF;

    IF OLD.last_read_message_id IS NOT NULL AND NEW.last_read_message_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : last_read_message_id ne peut pas repasser à NULL'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.last_read_message_id IS NOT NULL THEN
      SELECT created_at, id INTO v_new_created_at, v_new_id
      FROM public.school_messages
      WHERE id = NEW.last_read_message_id AND conversation_id = NEW.conversation_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Accès refusé : last_read_message_id introuvable dans cette conversation'
          USING ERRCODE = '42501';
      END IF;

      IF OLD.last_read_message_id IS NOT NULL THEN
        SELECT created_at, id INTO v_old_created_at, v_old_id
        FROM public.school_messages
        WHERE id = OLD.last_read_message_id AND conversation_id = NEW.conversation_id;

        IF v_new_created_at < v_old_created_at OR
           (v_new_created_at = v_old_created_at AND v_new_id < v_old_id) THEN
          RAISE EXCEPTION 'Accès refusé : Le dernier message lu ne peut pas reculer dans l ordre chronologique'
            USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Update get_or_create_school_conversation()
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

  -- Insertion idempotente des participants manquants uniquement
  INSERT INTO public.school_conversation_participants (conversation_id, profile_id, role)
  SELECT v_conv_id, p.profile_id, p.role
  FROM (
    VALUES
      (v_parent_id, 'parent'::TEXT),
      (v_teacher_id, 'teacher'::TEXT)
  ) AS p(profile_id, role)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.school_conversation_participants sp
    WHERE sp.conversation_id = v_conv_id AND sp.profile_id = p.profile_id
  );

  -- Vérification finale d'intégrité : exactement 2 participants au total dans la table
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
