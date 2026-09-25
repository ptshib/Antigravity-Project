-- Migration : 20260925143000_fix_messaging_rpc_column_ambiguity.sql
-- Description : Qualification explicite de toutes les colonnes dans les RPCs de messagerie pour éliminer l'ambiguïté (Error 42702)

BEGIN;

--------------------------------------------------------------------------------
-- 1. get_messaging_contacts
--------------------------------------------------------------------------------
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

  SELECT st.school_id INTO v_school_id 
  FROM public.students st 
  WHERE st.id = p_student_id AND st.enrollment_status = 'active';

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Élève inexistant ou non actif' USING ERRCODE = '42501';
  END IF;

  SELECT ay.id INTO v_academic_year_id 
  FROM public.academic_years ay 
  WHERE ay.school_id = v_school_id AND ay.is_current = true;

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
    SELECT cls.pedagogical_mode INTO v_class_mode FROM public.classes cls WHERE cls.id = v_class_id;

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
    SELECT cls.pedagogical_mode INTO v_class_mode FROM public.classes cls WHERE cls.id = v_class_id;

    IF (v_class_mode = 'primary_homeroom' AND EXISTS (
          SELECT 1 FROM public.classes cls WHERE cls.id = v_class_id AND cls.homeroom_teacher_id = v_caller_id
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
      RETURN;
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé : Aucun privilège de contact pour cet élève' USING ERRCODE = '42501';
  END IF;
END;
$$;

--------------------------------------------------------------------------------
-- 2. get_or_create_school_conversation
--------------------------------------------------------------------------------
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

  SELECT st.school_id INTO v_school_id FROM public.students st WHERE st.id = p_student_id AND st.enrollment_status = 'active';
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Élève inexistant ou non actif' USING ERRCODE = '42501';
  END IF;

  SELECT ay.id INTO v_academic_year_id FROM public.academic_years ay WHERE ay.school_id = v_school_id AND ay.is_current = true;
  IF v_academic_year_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Aucune année scolaire courante trouvée' USING ERRCODE = '42501';
  END IF;

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
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_profile_id = v_caller_id AND psl.student_id = p_student_id AND psl.status = 'approved'
  ) THEN
    v_parent_id := v_caller_id;
    v_teacher_id := p_counterparty_profile_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.teachers t WHERE t.profile_id = v_caller_id AND t.school_id = v_school_id AND t.employment_status = 'active' AND t.account_status = 'active'
  ) THEN
    v_teacher_id := v_caller_id;
    v_parent_id := p_counterparty_profile_id;
  ELSE
    RAISE EXCEPTION 'L appelant n est ni un parent ni un enseignant autorisé pour cet élève'
      USING ERRCODE = '42501';
  END IF;

  IF p_subject_id IS NULL THEN
    SELECT sc.id, sc.status INTO v_conv_id, v_existing_status FROM public.school_conversations sc
    WHERE sc.school_id = v_school_id AND sc.academic_year_id = v_academic_year_id
      AND sc.class_id = v_class_id AND sc.student_id = p_student_id
      AND sc.parent_profile_id = v_parent_id AND sc.teacher_profile_id = v_teacher_id
      AND sc.subject_id IS NULL;
  ELSE
    SELECT sc.id, sc.status INTO v_conv_id, v_existing_status FROM public.school_conversations sc
    WHERE sc.school_id = v_school_id AND sc.academic_year_id = v_academic_year_id
      AND sc.class_id = v_class_id AND sc.student_id = p_student_id
      AND sc.parent_profile_id = v_parent_id AND sc.teacher_profile_id = v_teacher_id
      AND sc.subject_id = p_subject_id;
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
          SELECT sc.id, sc.status INTO v_conv_id, v_existing_status FROM public.school_conversations sc
          WHERE sc.school_id = v_school_id AND sc.academic_year_id = v_academic_year_id
            AND sc.class_id = v_class_id AND sc.student_id = p_student_id
            AND sc.parent_profile_id = v_parent_id AND sc.teacher_profile_id = v_teacher_id
            AND sc.subject_id IS NULL;
        ELSE
          SELECT sc.id, sc.status INTO v_conv_id, v_existing_status FROM public.school_conversations sc
          WHERE sc.school_id = v_school_id AND sc.academic_year_id = v_academic_year_id
            AND sc.class_id = v_class_id AND sc.student_id = p_student_id
            AND sc.parent_profile_id = v_parent_id AND sc.teacher_profile_id = v_teacher_id
            AND sc.subject_id = p_subject_id;
        END IF;
    END;
  END IF;

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

  SELECT COUNT(*) INTO v_part_count
  FROM public.school_conversation_participants scp
  WHERE scp.conversation_id = v_conv_id;

  IF v_part_count <> 2 THEN
    RAISE EXCEPTION 'Échec d intégrité : La conversation doit contenir exactement 2 participants au total'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.school_conversation_participants scp WHERE scp.conversation_id = v_conv_id AND scp.profile_id = v_parent_id AND scp.role = 'parent'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.school_conversation_participants scp WHERE scp.conversation_id = v_conv_id AND scp.profile_id = v_teacher_id AND scp.role = 'teacher'
  ) THEN
    RAISE EXCEPTION 'Échec d intégrité : Les participants ne correspondent pas aux rôles déclarés' USING ERRCODE = '42501';
  END IF;

  RETURN v_conv_id;
END;
$$;

--------------------------------------------------------------------------------
-- 3. get_school_conversation_unread_count
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- 4. get_school_conversations
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- 5. get_school_conversation_messages
--------------------------------------------------------------------------------
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
    SELECT 1 FROM public.school_conversation_participants scp
    WHERE scp.conversation_id = p_conversation_id AND scp.profile_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Accès refusé : L appelant n est pas participant' USING ERRCODE = '42501';
  END IF;

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

--------------------------------------------------------------------------------
-- 6. send_school_message
--------------------------------------------------------------------------------
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
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Session non authentifiée' USING ERRCODE = '42501';
  END IF;

  SELECT sc.* INTO v_conv FROM public.school_conversations sc WHERE sc.id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation inexistante' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.school_conversation_participants scp
    WHERE scp.conversation_id = p_conversation_id AND scp.profile_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Accès refusé : L appelant n est pas participant' USING ERRCODE = '42501';
  END IF;

  IF v_conv.status = 'read_only' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'CONVERSATION_READ_ONLY',
      'message', 'Cette conversation est désormais en lecture seule car la relation scolaire n est plus active.'
    );
  END IF;

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

  IF NOT v_is_valid THEN
    UPDATE public.school_conversations SET status = 'read_only', updated_at = now() WHERE id = p_conversation_id;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'CONVERSATION_READ_ONLY',
      'message', 'Cette conversation est désormais en lecture seule car la relation scolaire n est plus active.'
    );
  END IF;

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

--------------------------------------------------------------------------------
-- 7. mark_school_conversation_read
--------------------------------------------------------------------------------
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
    SELECT 1 FROM public.school_conversation_participants scp
    WHERE scp.conversation_id = p_conversation_id AND scp.profile_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Accès refusé : L appelant n est pas participant' USING ERRCODE = '42501';
  END IF;

  SELECT m.id, m.created_at INTO v_last_msg_id, v_last_msg_at
  FROM public.school_messages m
  WHERE m.conversation_id = p_conversation_id
  ORDER BY m.created_at DESC, m.id DESC
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

--------------------------------------------------------------------------------
-- 8. set_school_conversation_archived
--------------------------------------------------------------------------------
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
-- GESTION DES PRIVILÈGES (PERSISTANTE ET STRICTE)
--------------------------------------------------------------------------------
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
