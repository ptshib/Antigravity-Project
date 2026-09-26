-- ============================================================================
-- MIGRATION: 20260926143000_enable_multi_school_parent_authorization.sql
-- DESCRIPTION: Migration des autorisations Parent vers le modèle multi-écoles (A2b-P-V)
--              Accès multi-établissements via parent_student_links + school_memberships
--              Indépendance vis-à-vis de profiles.school_id pour l'accès Parent
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HELPER CANONIQUE PARENT MULTI-ÉCOLES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_parent_access_student(
  p_student_id UUID,
  p_required_permission TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_required_permission IS NOT NULL AND pg_catalog.btrim(p_required_permission) = '' THEN
    RAISE EXCEPTION 'Permission requise invalide : ne peut être vide' USING ERRCODE = '22023';
  END IF;

  IF p_required_permission IS NOT NULL AND p_required_permission NOT IN (
    'can_view_academic',
    'can_view_attendance',
    'can_view_homework',
    'can_view_finances',
    'can_pickup_student',
    'can_receive_notifications'
  ) THEN
    RAISE EXCEPTION 'Permission requise invalide : %', p_required_permission USING ERRCODE = '22023';
  END IF;

  IF p_student_id IS NULL OR auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id
    JOIN public.students st ON st.id = p_student_id
    JOIN public.schools s ON s.id = st.school_id
    JOIN public.parent_student_links psl 
      ON psl.parent_profile_id = p.id 
     AND psl.student_id = st.id 
     AND psl.school_id = st.school_id
    JOIN public.school_memberships sm 
      ON sm.profile_id = p.id 
     AND sm.school_id = st.school_id 
     AND sm.role = 'parent'
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND pa.account_status = 'active'
      AND s.status = 'active'
      AND psl.status = 'approved'
      AND sm.status = 'active'
      AND (
        p_required_permission IS NULL
        OR (p_required_permission = 'can_view_academic' AND (psl.can_view_academic IS TRUE OR psl.can_view_academic IS NULL))
        OR (p_required_permission = 'can_view_attendance' AND (psl.can_view_attendance IS TRUE OR psl.can_view_attendance IS NULL))
        OR (p_required_permission = 'can_view_homework' AND (psl.can_view_homework IS TRUE OR psl.can_view_homework IS NULL))
        OR (p_required_permission = 'can_view_finances' AND (psl.can_view_finances IS TRUE OR psl.can_view_finances IS NULL))
        OR (p_required_permission = 'can_pickup_student' AND (psl.can_pickup_student IS TRUE OR psl.can_pickup_student IS NULL))
        OR (p_required_permission = 'can_receive_notifications' AND (psl.can_receive_notifications IS TRUE OR psl.can_receive_notifications IS NULL))
      )
  );
END;
$$;

ALTER FUNCTION public.can_parent_access_student(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_parent_access_student(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_parent_access_student(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. MISE À JOUR DES HELPERS PARENT LEGACY VIA LE HELPER CANONIQUE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_parent_of_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_parent_access_student(target_student_id, NULL);
$$;

ALTER FUNCTION public.is_parent_of_student(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_parent_of_student(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_parent_of_student(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_parent_view_academic(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_parent_access_student(p_student_id, 'can_view_academic');
$$;

ALTER FUNCTION public.can_parent_view_academic(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_parent_view_academic(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_parent_view_academic(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_parent_view_attendance(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_parent_access_student(p_student_id, 'can_view_attendance');
$$;

ALTER FUNCTION public.can_parent_view_attendance(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_parent_view_attendance(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_parent_view_attendance(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_parent_view_finances(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_parent_access_student(p_student_id, 'can_view_finances');
$$;

ALTER FUNCTION public.can_parent_view_finances(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_parent_view_finances(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_parent_view_finances(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_parent_view_homework(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_parent_access_student(p_student_id, 'can_view_homework');
$$;

ALTER FUNCTION public.can_parent_view_homework(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_parent_view_homework(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_parent_view_homework(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_parent_pickup_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_parent_access_student(p_student_id, 'can_pickup_student');
$$;

ALTER FUNCTION public.can_parent_pickup_student(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_parent_pickup_student(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_parent_pickup_student(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_parent_receive_notifications(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_parent_access_student(p_student_id, 'can_receive_notifications');
$$;

ALTER FUNCTION public.can_parent_receive_notifications(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_parent_receive_notifications(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_parent_receive_notifications(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. MISE À JOUR DES RPCS ET FONCTIONS PARENT MÉTIER
-- ----------------------------------------------------------------------------

-- A. get_parent_student_attendance
CREATE OR REPLACE FUNCTION public.get_parent_student_attendance(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_student RECORD;
  v_school_id UUID;
  v_today_status TEXT := 'not_recorded';
  v_records JSONB;
  v_total_sessions INT := 0;
  v_present_count INT := 0;
  v_absent_count INT := 0;
  v_late_count INT := 0;
  v_excused_count INT := 0;
  v_left_early_count INT := 0;
  v_present_effective INT := 0;
  v_evaluated_sessions INT := 0;
  v_attendance_rate NUMERIC := NULL;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_parent_access_student(p_student_id, 'can_view_attendance') THEN
    RAISE EXCEPTION 'REJET ACCÈS : La consultation des présences pour cet élève n’est pas autorisée sur votre compte parent.'
      USING ERRCODE = '42501';
  END IF;

  SELECT st.school_id INTO v_school_id FROM public.students st WHERE st.id = p_student_id;

  SELECT 
    st.id,
    st.student_number,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name,
    c.name AS class_name
  INTO v_student
  FROM public.students st
  LEFT JOIN LATERAL (
    SELECT c2.name
    FROM public.student_enrollments se2
    JOIN public.classes c2 ON c2.id = se2.class_id
    WHERE se2.student_id = st.id
      AND se2.school_id = st.school_id
    ORDER BY (se2.status = 'active') DESC, se2.enrolled_on DESC, se2.created_at DESC
    LIMIT 1
  ) c ON true
  WHERE st.id = p_student_id
    AND st.school_id = v_school_id;

  SELECT sa.status
  INTO v_today_status
  FROM public.student_attendance sa
  JOIN public.attendance_sessions ses ON ses.id = sa.attendance_session_id
  WHERE sa.student_id = p_student_id
    AND sa.school_id = v_school_id
    AND ses.attendance_date = CURRENT_DATE
    AND ses.status = 'completed'
  ORDER BY ses.started_at DESC
  LIMIT 1;

  IF v_today_status IS NULL THEN
    v_today_status := 'not_recorded';
  END IF;

  SELECT 
    pg_catalog.count(sa.id),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'present'),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'absent'),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'late'),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'excused'),
    pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'left_early')
  INTO 
    v_total_sessions,
    v_present_count,
    v_absent_count,
    v_late_count,
    v_excused_count,
    v_left_early_count
  FROM public.student_attendance sa
  JOIN public.attendance_sessions ses ON ses.id = sa.attendance_session_id
  WHERE sa.student_id = p_student_id
    AND sa.school_id = v_school_id
    AND ses.status = 'completed';

  v_present_effective := v_present_count + v_late_count + v_left_early_count;
  v_evaluated_sessions := v_total_sessions - v_excused_count;

  IF v_evaluated_sessions > 0 THEN
    v_attendance_rate := ROUND(
      (v_present_effective::numeric / v_evaluated_sessions::numeric) * 100.0,
      1
    );
  ELSE
    v_attendance_rate := NULL;
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', sa.id,
      'attendance_date', ses.attendance_date,
      'status', sa.status,
      'arrival_time', sa.arrival_time,
      'justification', sa.justification,
      'justified', sa.justified,
      'subject_name', sbj.name,
      'teacher_name', pg_catalog.btrim(pg_catalog.concat_ws(' ', t_prof.first_name, t_prof.last_name))
    ) ORDER BY ses.attendance_date DESC, ses.started_at DESC
  ), '[]'::jsonb)
  INTO v_records
  FROM public.student_attendance sa
  JOIN public.attendance_sessions ses ON ses.id = sa.attendance_session_id
  LEFT JOIN public.subjects sbj ON sbj.id = ses.subject_id
  LEFT JOIN public.teachers t ON t.id = ses.teacher_id
  LEFT JOIN public.profiles t_prof ON t_prof.id = t.profile_id
  WHERE sa.student_id = p_student_id
    AND sa.school_id = v_school_id
    AND ses.status = 'completed';

  RETURN pg_catalog.jsonb_build_object(
    'student', pg_catalog.jsonb_build_object(
      'id', v_student.id,
      'student_number', v_student.student_number,
      'student_full_name', v_student.student_full_name,
      'class_name', v_student.class_name
    ),
    'today_status', v_today_status,
    'stats', pg_catalog.jsonb_build_object(
      'total_sessions', v_total_sessions,
      'evaluated_sessions', v_evaluated_sessions,
      'present_effective', v_present_effective,
      'present_count', v_present_count,
      'absent_count', v_absent_count,
      'late_count', v_late_count,
      'excused_count', v_excused_count,
      'left_early_count', v_left_early_count,
      'attendance_rate', v_attendance_rate
    ),
    'records', v_records
  );
END;
$$;

ALTER FUNCTION public.get_parent_student_attendance(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_parent_student_attendance(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_attendance(UUID) TO authenticated;

-- B. get_parent_student_calendar
CREATE OR REPLACE FUNCTION public.get_parent_student_calendar(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_student RECORD;
  v_academic_year_id UUID;
  v_academic_year_name TEXT := 'Non spécifiée';
  v_events JSONB;
  v_total_events INT := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_parent_access_student(p_student_id, 'can_view_academic') THEN
    RAISE EXCEPTION 'REJET ACCÈS : Élève introuvable ou vous n’avez pas l’autorisation académique requise.'
      USING ERRCODE = '42501';
  END IF;

  SELECT 
    st.id,
    st.school_id,
    st.student_number,
    st.first_name,
    st.last_name,
    st.class_id,
    c.name AS class_name,
    c.academic_year_id AS class_academic_year_id,
    ay.name AS class_academic_year_name,
    s.status AS school_status
  INTO v_student
  FROM public.students st
  JOIN public.schools s ON s.id = st.school_id
  LEFT JOIN public.classes c ON c.id = st.class_id
  LEFT JOIN public.academic_years ay ON ay.id = c.academic_year_id
  WHERE st.id = p_student_id;

  IF v_student.school_status <> 'active' THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’établissement de cet élève n’est pas actif.'
      USING ERRCODE = '42501';
  END IF;

  v_academic_year_id := v_student.class_academic_year_id;
  v_academic_year_name := COALESCE(v_student.class_academic_year_name, 'Non spécifiée');

  IF v_academic_year_id IS NULL THEN
    SELECT ay.id, ay.name
    INTO v_academic_year_id, v_academic_year_name
    FROM public.academic_years ay
    WHERE ay.school_id = v_student.school_id
      AND ay.is_current = true
    LIMIT 1;
  END IF;

  SELECT pg_catalog.count(e.id)
  INTO v_total_events
  FROM public.school_events e
  WHERE e.school_id = v_student.school_id
    AND (v_academic_year_id IS NULL OR e.academic_year_id = v_academic_year_id)
    AND e.status = 'published';

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'description', COALESCE(e.description, ''),
      'event_type', e.event_type,
      'start_date', e.start_date,
      'end_date', e.end_date,
      'is_all_day', e.is_all_day,
      'location', COALESCE(e.location, ''),
      'status', e.status,
      'created_at', e.created_at
    ) ORDER BY e.start_date ASC
  ), '[]'::jsonb)
  INTO v_events
  FROM public.school_events e
  WHERE e.school_id = v_student.school_id
    AND (v_academic_year_id IS NULL OR e.academic_year_id = v_academic_year_id)
    AND e.status = 'published';

  RETURN pg_catalog.jsonb_build_object(
    'student_id', v_student.id,
    'student_number', v_student.student_number,
    'student_name', TRIM(v_student.first_name || ' ' || v_student.last_name),
    'class_id', COALESCE(v_student.class_id::text, ''),
    'class_name', COALESCE(v_student.class_name, 'Non assignée'),
    'academic_year_id', COALESCE(v_academic_year_id::text, ''),
    'academic_year_name', COALESCE(v_academic_year_name, 'Non spécifiée'),
    'summary', pg_catalog.jsonb_build_object(
      'total_events', v_total_events
    ),
    'events', v_events
  );
END;
$$;

ALTER FUNCTION public.get_parent_student_calendar(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_parent_student_calendar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_calendar(UUID) TO authenticated;

-- C. get_parent_student_documents
CREATE OR REPLACE FUNCTION public.get_parent_student_documents(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_student RECORD;
  v_documents JSONB;
  v_total_docs INT := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_parent_access_student(p_student_id, NULL) THEN
    RAISE EXCEPTION 'REJET ACCÈS : Élève introuvable ou vous n’avez pas le lien parental approuvé.'
      USING ERRCODE = '42501';
  END IF;

  SELECT 
    st.id,
    st.school_id,
    st.class_id,
    st.student_number,
    st.first_name,
    st.last_name,
    psl.can_view_academic,
    s.status AS school_status
  INTO v_student
  FROM public.students st
  JOIN public.parent_student_links psl ON psl.student_id = st.id AND psl.parent_profile_id = v_caller_id
  JOIN public.schools s ON s.id = st.school_id
  WHERE st.id = p_student_id;

  IF v_student.school_status <> 'active' THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’établissement de cet élève n’est pas actif.'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(d.id)
  INTO v_total_docs
  FROM public.school_documents d
  WHERE d.school_id = v_student.school_id
    AND d.status = 'published'
    AND (
      d.category NOT IN ('academic', 'course_material') OR v_student.can_view_academic = true
    )
    AND (
      d.target_scope = 'school'
      OR (d.target_scope = 'class' AND d.class_id = v_student.class_id)
      OR (d.target_scope = 'student' AND d.student_id = v_student.id)
    );

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', d.id,
      'title', d.title,
      'description', COALESCE(d.description, ''),
      'category', d.category,
      'target_scope', d.target_scope,
      'file_name', d.file_name,
      'file_size_bytes', d.file_size_bytes,
      'mime_type', d.mime_type,
      'published_at', d.published_at,
      'created_at', d.created_at
    ) ORDER BY d.published_at DESC
  ), '[]'::jsonb)
  INTO v_documents
  FROM public.school_documents d
  WHERE d.school_id = v_student.school_id
    AND d.status = 'published'
    AND (
      d.category NOT IN ('academic', 'course_material') OR v_student.can_view_academic = true
    )
    AND (
      d.target_scope = 'school'
      OR (d.target_scope = 'class' AND d.class_id = v_student.class_id)
      OR (d.target_scope = 'student' AND d.student_id = v_student.id)
    );

  RETURN pg_catalog.jsonb_build_object(
    'student_id', v_student.id,
    'student_number', v_student.student_number,
    'student_name', TRIM(v_student.first_name || ' ' || v_student.last_name),
    'summary', pg_catalog.jsonb_build_object(
      'total_documents', v_total_docs
    ),
    'documents', v_documents
  );
END;
$$;

ALTER FUNCTION public.get_parent_student_documents(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_parent_student_documents(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_documents(UUID) TO authenticated;

-- D. get_parent_student_finances
CREATE OR REPLACE FUNCTION public.get_parent_student_finances(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_student_school_id UUID;
  v_student RECORD;
  v_invoices JSONB;
  v_receipts JSONB;
  v_summary_by_currency JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_parent_access_student(p_student_id, 'can_view_finances') THEN
    RAISE EXCEPTION 'REJET ACCÈS : La consultation financière pour cet élève n’est pas autorisée sur votre compte parent.'
      USING ERRCODE = '42501';
  END IF;

  SELECT st.school_id INTO v_student_school_id FROM public.students st WHERE st.id = p_student_id;

  SELECT 
    st.id,
    st.student_number,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name,
    c.name AS class_name,
    s.name AS school_name
  INTO v_student
  FROM public.students st
  JOIN public.schools s ON s.id = st.school_id
  LEFT JOIN LATERAL (
    SELECT c2.name
    FROM public.student_enrollments se2
    JOIN public.classes c2 ON c2.id = se2.class_id
    WHERE se2.student_id = st.id
      AND se2.school_id = st.school_id
    ORDER BY (se2.status = 'active') DESC, se2.enrolled_on DESC, se2.created_at DESC
    LIMIT 1
  ) c ON true
  WHERE st.id = p_student_id
    AND st.school_id = v_student_school_id;

  SELECT COALESCE(
    pg_catalog.jsonb_object_agg(
      s.currency,
      pg_catalog.jsonb_build_object(
        'currency', s.currency,
        'total_invoiced', s.total_invoiced,
        'total_paid', s.total_paid,
        'total_remaining', s.total_remaining
      )
    ),
    '{}'::jsonb
  )
  INTO v_summary_by_currency
  FROM (
    SELECT 
      inv.currency,
      COALESCE(SUM(inv.total_amount), 0.00) AS total_invoiced,
      COALESCE(SUM(inv.paid_amount), 0.00) AS total_paid,
      COALESCE(SUM(inv.remaining_balance), 0.00) AS total_remaining
    FROM public.student_invoices inv
    WHERE inv.student_id = p_student_id
      AND inv.school_id = v_student_school_id
      AND inv.status IN ('issued', 'partially_paid', 'paid')
    GROUP BY inv.currency
  ) s;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', inv.id,
      'invoice_number', inv.invoice_number,
      'issue_date', inv.issue_date,
      'due_date', inv.due_date,
      'currency', inv.currency,
      'total_amount', inv.total_amount,
      'paid_amount', inv.paid_amount,
      'remaining_balance', inv.remaining_balance,
      'status', inv.status,
      'items', (
        SELECT COALESCE(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'fee_name', itm.fee_name,
            'fee_type', itm.fee_type,
            'unit_price', itm.unit_price,
            'quantity', itm.quantity,
            'total_price', itm.total_price
          ) ORDER BY itm.created_at
        ), '[]'::jsonb)
        FROM public.student_invoice_items itm
        WHERE itm.invoice_id = inv.id
      )
    ) ORDER BY inv.issue_date DESC, inv.sequence_number DESC
  ), '[]'::jsonb)
  INTO v_invoices
  FROM public.student_invoices inv
  WHERE inv.student_id = p_student_id
    AND inv.school_id = v_student_school_id
    AND inv.status IN ('issued', 'partially_paid', 'paid');

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'receipt_number', rec.receipt_number,
      'receipt_date', rec.receipt_date,
      'amount', rec.amount,
      'currency', rec.currency,
      'payment_method', rec.payment_method,
      'payment_reference', rec.payment_reference,
      'payer_name', rec.payer_name,
      'invoice_number', rec.invoice_number,
      'balance_after_payment', rec.balance_after_payment,
      'is_cancelled', rec.is_cancelled,
      'cancelled_at', rec.cancelled_at,
      'cancel_reason', rec.cancel_reason
    ) ORDER BY rec.receipt_date DESC, rec.sequence_number DESC
  ), '[]'::jsonb)
  INTO v_receipts
  FROM public.payment_receipts rec
  WHERE rec.student_id = p_student_id
    AND rec.school_id = v_student_school_id;

  RETURN pg_catalog.jsonb_build_object(
    'student', pg_catalog.jsonb_build_object(
      'id', v_student.id,
      'student_number', v_student.student_number,
      'student_full_name', v_student.student_full_name,
      'class_name', v_student.class_name,
      'school_name', v_student.school_name
    ),
    'summary_by_currency', v_summary_by_currency,
    'summary', v_summary_by_currency,
    'invoices', v_invoices,
    'receipts', v_receipts
  );
END;
$$;

ALTER FUNCTION public.get_parent_student_finances(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_parent_student_finances(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_finances(UUID) TO authenticated;

-- E. get_parent_student_homework
CREATE OR REPLACE FUNCTION public.get_parent_student_homework(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_school_id UUID;
  v_student RECORD;
  v_homework_list JSONB;
  v_total_count INT := 0;
  v_upcoming_count INT := 0;
  v_overdue_count INT := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_parent_access_student(p_student_id, 'can_view_homework') THEN
    RAISE EXCEPTION 'REJET ACCÈS : La consultation des devoirs pour cet élève n’est pas autorisée sur votre compte parent.'
      USING ERRCODE = '42501';
  END IF;

  SELECT st.school_id INTO v_school_id FROM public.students st WHERE st.id = p_student_id;

  SELECT 
    st.id,
    st.student_number,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name,
    se.class_id,
    c.name AS class_name,
    se.academic_year_id,
    ay.name AS academic_year_name
  INTO v_student
  FROM public.students st
  JOIN public.student_enrollments se ON se.student_id = st.id
    AND se.school_id = st.school_id
    AND se.status = 'active'
  JOIN public.classes c ON c.id = se.class_id AND c.school_id = st.school_id
  LEFT JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = st.school_id
  WHERE st.id = p_student_id
    AND st.school_id = v_school_id
  ORDER BY se.enrolled_on DESC, se.created_at DESC
  LIMIT 1;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’élève sélectionné ne possède aucune inscription active dans cet établissement.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT 
    pg_catalog.count(h.id),
    pg_catalog.count(h.id) FILTER (WHERE h.due_at >= CURRENT_TIMESTAMP),
    pg_catalog.count(h.id) FILTER (WHERE h.due_at < CURRENT_TIMESTAMP)
  INTO 
    v_total_count,
    v_upcoming_count,
    v_overdue_count
  FROM public.school_homework h
  WHERE h.school_id = v_school_id
    AND h.class_id = v_student.class_id
    AND h.status IN ('published', 'closed')
    AND (h.academic_year_id IS NULL OR h.academic_year_id = v_student.academic_year_id);

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', h.id,
      'title', h.title,
      'instructions', h.instructions,
      'subject_id', h.subject_id,
      'subject_name', s.name,
      'teacher_id', h.teacher_id,
      'teacher_name', pg_catalog.btrim(pg_catalog.concat_ws(' ', t.first_name, t.last_name)),
      'assigned_on', h.assigned_on,
      'published_at', h.published_at,
      'due_at', h.due_at,
      'estimated_minutes', h.estimated_minutes,
      'status', h.status,
      'is_overdue', (h.due_at < CURRENT_TIMESTAMP)
    )
  ), pg_catalog.jsonb_build_array())
  INTO v_homework_list
  FROM (
    SELECT h2.*
    FROM public.school_homework h2
    WHERE h2.school_id = v_school_id
      AND h2.class_id = v_student.class_id
      AND h2.status IN ('published', 'closed')
      AND (h2.academic_year_id IS NULL OR h2.academic_year_id = v_student.academic_year_id)
    ORDER BY 
      CASE WHEN h2.due_at >= CURRENT_TIMESTAMP THEN 0 ELSE 1 END ASC,
      CASE WHEN h2.due_at >= CURRENT_TIMESTAMP THEN h2.due_at END ASC,
      CASE WHEN h2.due_at < CURRENT_TIMESTAMP THEN h2.due_at END DESC,
      h2.created_at DESC
  ) h
  JOIN public.subjects s ON s.id = h.subject_id AND s.school_id = v_school_id
  JOIN public.teachers t ON t.id = h.teacher_id AND t.school_id = v_school_id;

  RETURN pg_catalog.jsonb_build_object(
    'student_id', v_student.id,
    'student_number', v_student.student_number,
    'student_name', v_student.student_full_name,
    'class_id', v_student.class_id,
    'class_name', v_student.class_name,
    'academic_year_id', v_student.academic_year_id,
    'academic_year_name', COALESCE(v_student.academic_year_name, ''),
    'summary', pg_catalog.jsonb_build_object(
      'total', v_total_count,
      'upcoming', v_upcoming_count,
      'overdue', v_overdue_count
    ),
    'homework', COALESCE(v_homework_list, pg_catalog.jsonb_build_array())
  );
END;
$$;

ALTER FUNCTION public.get_parent_student_homework(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_parent_student_homework(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_homework(UUID) TO authenticated;

-- F. get_parent_student_timetable
CREATE OR REPLACE FUNCTION public.get_parent_student_timetable(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_school_id UUID;
  v_student RECORD;
  v_slots JSONB;
  v_total_slots INT := 0;
  v_total_days INT := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_parent_access_student(p_student_id, 'can_view_academic') THEN
    RAISE EXCEPTION 'REJET ACCÈS : Élève introuvable ou vous n’avez pas l’autorisation académique.'
      USING ERRCODE = '42501';
  END IF;

  SELECT st.school_id INTO v_school_id FROM public.students st WHERE st.id = p_student_id;

  SELECT 
    st.id,
    st.school_id,
    st.student_number,
    st.first_name,
    st.last_name,
    st.class_id,
    c.name AS class_name,
    c.academic_year_id,
    ay.name AS academic_year_name
  INTO v_student
  FROM public.students st
  JOIN public.classes c ON c.id = st.class_id
  LEFT JOIN public.academic_years ay ON ay.id = c.academic_year_id
  WHERE st.id = p_student_id
    AND st.school_id = v_school_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Élève introuvable ou classe non définie.'
      USING ERRCODE = '42501';
  END IF;

  SELECT 
    pg_catalog.count(t.id),
    pg_catalog.count(DISTINCT t.day_of_week)
  INTO 
    v_total_slots,
    v_total_days
  FROM public.school_timetables t
  WHERE t.school_id = v_school_id
    AND t.class_id = v_student.class_id
    AND (v_student.academic_year_id IS NULL OR t.academic_year_id = v_student.academic_year_id)
    AND t.status = 'active';

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', t.id,
      'slot_type', COALESCE(t.slot_type, 'course'),
      'label', t.label,
      'day_of_week', t.day_of_week,
      'day_name', CASE t.day_of_week
        WHEN 1 THEN 'Lundi'
        WHEN 2 THEN 'Mardi'
        WHEN 3 THEN 'Mercredi'
        WHEN 4 THEN 'Jeudi'
        WHEN 5 THEN 'Vendredi'
        WHEN 6 THEN 'Samedi'
        WHEN 7 THEN 'Dimanche'
        ELSE 'Inconnu'
      END,
      'subject_id', t.subject_id,
      'subject_name', CASE
        WHEN t.slot_type = 'break' THEN COALESCE(t.label, 'Pause')
        ELSE COALESCE(s.name, 'Matière')
      END,
      'teacher_id', t.teacher_id,
      'teacher_name', CASE
        WHEN t.slot_type = 'break' THEN ''
        WHEN tp.id IS NOT NULL THEN (tp.first_name || ' ' || tp.last_name)
        ELSE 'Enseignant non assigné'
      END,
      'room', COALESCE(t.room, ''),
      'start_time', pg_catalog.to_char(t.start_time, 'HH24:MI'),
      'end_time', pg_catalog.to_char(t.end_time, 'HH24:MI'),
      'status', t.status
    ) ORDER BY t.day_of_week ASC, t.start_time ASC
  ), '[]'::jsonb)
  INTO v_slots
  FROM public.school_timetables t
  LEFT JOIN public.subjects s ON s.id = t.subject_id
  LEFT JOIN public.teachers te ON te.id = t.teacher_id
  LEFT JOIN public.profiles tp ON tp.id = te.profile_id
  WHERE t.school_id = v_school_id
    AND t.class_id = v_student.class_id
    AND (v_student.academic_year_id IS NULL OR t.academic_year_id = v_student.academic_year_id)
    AND t.status = 'active';

  RETURN pg_catalog.jsonb_build_object(
    'student_id', v_student.id,
    'student_number', v_student.student_number,
    'student_name', TRIM(v_student.first_name || ' ' || v_student.last_name),
    'class_id', v_student.class_id,
    'class_name', v_student.class_name,
    'academic_year_id', v_student.academic_year_id,
    'academic_year_name', COALESCE(v_student.academic_year_name, 'Non spécifiée'),
    'summary', pg_catalog.jsonb_build_object(
      'total_slots', v_total_slots,
      'total_days', v_total_days
    ),
    'slots', v_slots
  );
END;
$$;

ALTER FUNCTION public.get_parent_student_timetable(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_parent_student_timetable(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_timetable(UUID) TO authenticated;

-- G. get_parent_pickup_students
CREATE OR REPLACE FUNCTION public.get_parent_pickup_students()
RETURNS TABLE(student_id UUID, student_number TEXT, first_name TEXT, last_name TEXT, class_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
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
  JOIN public.parent_accounts pa ON pa.profile_id = auth.uid()
  JOIN public.profiles p ON p.id = auth.uid()
  JOIN public.school_memberships sm ON sm.profile_id = auth.uid() AND sm.school_id = st.school_id AND sm.role = 'parent' AND sm.status = 'active'
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
  WHERE p.is_active = true
    AND pa.account_status = 'active'
    AND s.status = 'active'
    AND psl.status = 'approved'
    AND psl.can_pickup_student = true;
END;
$$;

ALTER FUNCTION public.get_parent_pickup_students() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_parent_pickup_students() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_pickup_students() TO authenticated;

-- H. can_parent_read_school_periods
CREATE OR REPLACE FUNCTION public.can_parent_read_school_periods(
  target_school_id UUID, 
  target_academic_year_id UUID, 
  target_education_cycle TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id
    JOIN public.school_memberships sm ON sm.profile_id = p.id AND sm.school_id = target_school_id AND sm.role = 'parent' AND sm.status = 'active'
    JOIN public.schools s ON s.id = target_school_id
    JOIN public.parent_student_links psl ON psl.parent_profile_id = p.id AND psl.school_id = target_school_id
    JOIN public.students st ON st.id = psl.student_id AND st.school_id = target_school_id
    JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = target_school_id
    JOIN public.classes c ON c.id = se.class_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND pa.account_status = 'active'
      AND s.status = 'active'
      AND psl.status = 'approved'
      AND se.academic_year_id = target_academic_year_id
      AND se.status = 'active'
      AND c.school_id = target_school_id
      AND c.academic_year_id = target_academic_year_id
      AND c.education_cycle = target_education_cycle
  );
$$;

ALTER FUNCTION public.can_parent_read_school_periods(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_parent_read_school_periods(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_parent_read_school_periods(UUID, UUID, TEXT) TO authenticated;

-- I. get_my_published_report_card
CREATE OR REPLACE FUNCTION public.get_my_published_report_card(p_student_id UUID, p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_active BOOLEAN;
  v_student RECORD;
  v_rc RECORD;
  v_subjects_json JSONB := '[]'::jsonb;
  v_subj_cur RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, is_active INTO v_role, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  SELECT id, school_id, profile_id, account_status, enrollment_status, student_number
  INTO v_student
  FROM public.students WHERE id = p_student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Dossier élève introuvable.';
  END IF;

  IF v_role = 'student' THEN
    IF v_student.profile_id IS DISTINCT FROM v_uid OR v_student.account_status <> 'active' OR v_student.enrollment_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que votre propre bulletin.';
    END IF;
  ELSIF v_role = 'parent' THEN
    IF NOT public.can_parent_access_student(p_student_id, 'can_view_academic') THEN
      RAISE EXCEPTION 'Accès refusé : Consultation académique désactivée ou lien parental non approuvé.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  SELECT rc.*, b.revision_number, b.published_at
  INTO v_rc
  FROM public.period_report_cards rc
  JOIN public.report_card_batches b ON b.id = rc.batch_id
  WHERE rc.student_id = p_student_id
    AND rc.period_id = p_period_id
    AND b.status = 'published'
  ORDER BY b.revision_number DESC
  LIMIT 1;

  IF v_rc.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'is_published', false,
      'message', 'Le bulletin officiel pour cette période n’a pas encore été publié par l’établissement.'
    );
  END IF;

  FOR v_subj_cur IN (
    SELECT * FROM public.report_card_subject_results
    WHERE report_card_id = v_rc.id
    ORDER BY display_position ASC
  ) LOOP
    v_subjects_json := v_subjects_json || pg_catalog.jsonb_build_object(
      'subject_id', v_subj_cur.subject_id,
      'subject_name', v_subj_cur.subject_name_snapshot,
      'subject_code', v_subj_cur.subject_code_snapshot,
      'coefficient', v_subj_cur.coefficient,
      'subject_percentage', v_subj_cur.subject_percentage,
      'assessment_count', v_subj_cur.assessment_count,
      'completed_assessment_count', v_subj_cur.completed_assessment_count,
      'pending_assessment_count', v_subj_cur.pending_assessment_count,
      'is_complete', v_subj_cur.is_complete,
      'subject_remark', v_subj_cur.subject_remark
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'is_published', true,
    'report_card_id', v_rc.id,
    'batch_id', v_rc.batch_id,
    'revision_number', v_rc.revision_number,
    'published_at', v_rc.published_at,
    'student_id', v_rc.student_id,
    'overall_percentage', v_rc.overall_percentage,
    'my_rank', v_rc.rank,
    'class_size', v_rc.total_students_ranked,
    'rank_type', v_rc.rank_type,
    'is_incomplete', v_rc.is_incomplete,
    'completed_subjects_count', v_rc.completed_subjects_count,
    'pending_subjects_count', v_rc.pending_subjects_count,
    'total_subject_coefficients', v_rc.total_subject_coefficients,
    'homeroom_teacher_remarks', v_rc.homeroom_teacher_remarks,
    'conduct_grade', v_rc.conduct_grade,
    'principal_remarks', v_rc.principal_remarks,
    'identity', v_rc.identity_snapshot,
    'pdf_storage_path', v_rc.pdf_storage_path,
    'pdf_version', v_rc.pdf_version,
    'subjects', v_subjects_json
  );
END;
$$;

ALTER FUNCTION public.get_my_published_report_card(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_published_report_card(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_published_report_card(UUID, UUID) TO authenticated;

-- J. get_student_period_result
CREATE OR REPLACE FUNCTION public.get_student_period_result(p_student_id UUID, p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_student RECORD;
  v_period RECORD;
  v_term RECORD;
  v_enrollment RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_assigned_subject_count INT := 0;
  v_total_class_subject_count INT := 0;
  v_subject_cur RECORD;
  v_subject_result JSONB;
  v_subjects_json JSONB := '[]'::jsonb;
  v_total_weighted_subjects NUMERIC := 0;
  v_total_subject_coefficients NUMERIC := 0;
  v_subjects_count INT := 0;
  v_completed_subjects_count INT := 0;
  v_pending_subjects_count INT := 0;
  v_overall_percentage NUMERIC := NULL;
  v_is_period_complete BOOLEAN := true;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  SELECT s.id, s.school_id, s.profile_id, s.enrollment_status, s.account_status,
         s.student_number,
         COALESCE(p.first_name, s.first_name, '') AS first_name,
         COALESCE(p.last_name, s.last_name, '') AS last_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.id = p_student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Élève introuvable';
  END IF;

  SELECT sp.id, sp.school_id, sp.academic_year_id, sp.parent_term_id, sp.name, sp.education_cycle, sp.is_active
  INTO v_period
  FROM public.school_periods sp
  WHERE sp.id = p_period_id;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Période scolaire introuvable';
  END IF;

  IF v_period.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'La période scolaire demandée est inactive.';
  END IF;

  IF v_period.school_id IS DISTINCT FROM v_student.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La période appartient à un autre établissement.';
  END IF;

  SELECT st.id, st.school_id, st.academic_year_id, st.education_cycle, st.name, st.is_active
  INTO v_term
  FROM public.school_terms st WHERE st.id = v_period.parent_term_id;

  IF v_term.id IS NULL OR v_term.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Le terme parent de la période est inactif ou introuvable.';
  END IF;

  IF v_term.school_id IS DISTINCT FROM v_period.school_id OR v_term.academic_year_id IS DISTINCT FROM v_period.academic_year_id OR v_term.education_cycle IS DISTINCT FROM v_period.education_cycle THEN
    RAISE EXCEPTION 'Incohérence structurelle entre le terme et la période scolaire.';
  END IF;

  SELECT se.id, se.class_id, se.school_id, se.academic_year_id, se.status,
         c.name AS class_name, c.education_cycle, c.homeroom_teacher_id
  INTO v_enrollment
  FROM public.student_enrollments se
  JOIN public.classes c ON c.id = se.class_id
  WHERE se.student_id = p_student_id
    AND se.school_id = v_student.school_id
    AND se.academic_year_id = v_period.academic_year_id
    AND se.status = 'active';

  IF v_enrollment.id IS NULL THEN
    RAISE EXCEPTION 'Inscription active introuvable pour cet élève.';
  END IF;

  IF v_period.education_cycle IS DISTINCT FROM v_enrollment.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle entre la période et la classe de l’élève.';
  END IF;

  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM v_student.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF v_caller_school_id IS DISTINCT FROM v_student.school_id THEN
      RAISE EXCEPTION 'Accès refusé';
    END IF;

    SELECT id, profile_id, employment_status, account_status
    INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid AND school_id = v_student.school_id;

    IF v_teacher.id IS NULL OR v_teacher.employment_status <> 'active' OR v_teacher.account_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Enseignant inactif ou introuvable.';
    END IF;

    IF v_enrollment.homeroom_teacher_id = v_uid OR v_enrollment.homeroom_teacher_id = v_teacher.id THEN
      v_is_homeroom := true;
    END IF;

    IF NOT v_is_homeroom THEN
      SELECT COUNT(DISTINCT subject_id) INTO v_total_class_subject_count
      FROM (
        SELECT DISTINCT subject_id
        FROM public.teacher_class_assignments
        WHERE class_id = v_enrollment.class_id
          AND academic_year_id = v_period.academic_year_id
          AND school_id = v_student.school_id
          AND is_active = true
          AND subject_id IS NOT NULL
        UNION
        SELECT subject_id
        FROM public.class_subject_settings
        WHERE class_id = v_enrollment.class_id
          AND academic_year_id = v_period.academic_year_id
          AND school_id = v_student.school_id
          AND is_active = true
          AND subject_id IS NOT NULL
      ) active_sbj;

      SELECT COUNT(DISTINCT subject_id) INTO v_assigned_subject_count
      FROM public.teacher_class_assignments
      WHERE (teacher_profile_id = v_uid OR teacher_id = v_teacher.id)
        AND class_id = v_enrollment.class_id
        AND academic_year_id = v_period.academic_year_id
        AND school_id = v_student.school_id
        AND is_active = true
        AND subject_id IS NOT NULL;

      IF v_total_class_subject_count = 0 OR v_assigned_subject_count < v_total_class_subject_count THEN
        RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire de la classe ou un enseignant affecté à toutes les matières peut consulter le résultat général. Veuillez utiliser le résultat par matière (get_student_subject_period_result).';
      END IF;
    END IF;

  ELSIF v_role = 'student' THEN
    IF v_student.profile_id IS DISTINCT FROM v_uid OR v_student.account_status <> 'active' OR v_student.enrollment_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres résultats scolaires.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.school_calendars
      WHERE school_id = v_period.school_id
        AND academic_year_id = v_period.academic_year_id
        AND education_cycle = v_period.education_cycle
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Le Calendrier Scolaire pour ce cycle n’est pas encore publié ou actif.';
    END IF;

  ELSIF v_role = 'parent' THEN
    IF NOT public.can_parent_access_student(p_student_id, 'can_view_academic') THEN
      RAISE EXCEPTION 'Accès refusé : Lien parental non approuvé ou consultation académique désactivée.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.school_calendars
      WHERE school_id = v_period.school_id
        AND academic_year_id = v_period.academic_year_id
        AND education_cycle = v_period.education_cycle
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Le Calendrier Scolaire pour ce cycle n’est pas encore publié ou actif.';
    END IF;

  ELSE
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  FOR v_subject_cur IN (
    SELECT
      s.id AS subject_id,
      s.name AS subject_name,
      COALESCE(css.coefficient, 1.0) AS subject_coefficient
    FROM (
      SELECT DISTINCT subject_id
      FROM public.teacher_class_assignments
      WHERE class_id = v_enrollment.class_id
        AND academic_year_id = v_period.academic_year_id
        AND school_id = v_student.school_id
        AND is_active = true
        AND subject_id IS NOT NULL
      UNION
      SELECT subject_id
      FROM public.class_subject_settings
      WHERE class_id = v_enrollment.class_id
        AND academic_year_id = v_period.academic_year_id
        AND school_id = v_student.school_id
        AND is_active = true
        AND subject_id IS NOT NULL
    ) sub_list
    JOIN public.subjects s ON s.id = sub_list.subject_id
    LEFT JOIN public.class_subject_settings css
      ON css.class_id = v_enrollment.class_id
      AND css.subject_id = s.id
      AND css.academic_year_id = v_period.academic_year_id
      AND css.is_active = true
    WHERE s.is_active = true
    ORDER BY s.name ASC
  ) LOOP
    v_subjects_count := v_subjects_count + 1;

    v_subject_result := public.get_student_subject_period_result(
      p_student_id,
      v_subject_cur.subject_id,
      p_period_id
    );

    IF (v_subject_result->>'is_complete')::boolean IS TRUE AND (v_subject_result->>'subject_percentage') IS NOT NULL THEN
      v_completed_subjects_count := v_completed_subjects_count + 1;
      v_total_weighted_subjects := v_total_weighted_subjects + ((v_subject_result->>'subject_percentage')::numeric * v_subject_cur.subject_coefficient);
      v_total_subject_coefficients := v_total_subject_coefficients + v_subject_cur.subject_coefficient;
    ELSE
      v_pending_subjects_count := v_pending_subjects_count + 1;
      v_is_period_complete := false;
    END IF;

    v_subjects_json := v_subjects_json || pg_catalog.jsonb_build_object(
      'subject_id', v_subject_cur.subject_id,
      'subject_name', v_subject_cur.subject_name,
      'subject_coefficient', v_subject_cur.subject_coefficient,
      'subject_percentage', (v_subject_result->>'subject_percentage')::numeric,
      'is_complete', (v_subject_result->>'is_complete')::boolean,
      'assessment_count', (v_subject_result->>'assessment_count')::int,
      'completed_assessment_count', (v_subject_result->>'completed_assessment_count')::int,
      'pending_assessment_count', (v_subject_result->>'pending_assessment_count')::int
    );
  END LOOP;

  IF v_total_subject_coefficients > 0 THEN
    v_overall_percentage := ROUND(v_total_weighted_subjects / v_total_subject_coefficients, 2);
  ELSE
    v_overall_percentage := NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'school_id', v_student.school_id,
    'academic_year_id', v_period.academic_year_id,
    'student_id', p_student_id,
    'enrollment_id', v_enrollment.id,
    'student_number', COALESCE(v_student.student_number, ''),
    'student_name', TRIM(v_student.first_name || ' ' || v_student.last_name),
    'class_id', v_enrollment.class_id,
    'class_name', v_enrollment.class_name,
    'period_id', p_period_id,
    'period_name', v_period.name,
    'term_id', v_term.id,
    'term_name', v_term.name,
    'subjects_count', v_subjects_count,
    'completed_subjects_count', v_completed_subjects_count,
    'pending_subjects_count', v_pending_subjects_count,
    'total_subject_coefficients', v_total_subject_coefficients,
    'overall_percentage', v_overall_percentage,
    'is_complete', (v_subjects_count > 0 AND v_is_period_complete),
    'subjects', v_subjects_json
  );
END;
$$;

ALTER FUNCTION public.get_student_period_result(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_student_period_result(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_period_result(UUID, UUID) TO authenticated;

-- K. get_student_subject_period_result
CREATE OR REPLACE FUNCTION public.get_student_subject_period_result(p_student_id UUID, p_subject_id UUID, p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_student RECORD;
  v_period RECORD;
  v_term RECORD;
  v_subject RECORD;
  v_class RECORD;
  v_enrollment RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_assessment_cur RECORD;
  v_assessments_json JSONB := '[]'::jsonb;
  v_total_weighted_points NUMERIC := 0;
  v_total_effective_coefficient NUMERIC := 0;
  v_assessment_count INT := 0;
  v_completed_assessment_count INT := 0;
  v_pending_assessment_count INT := 0;
  v_excused_absence_count INT := 0;
  v_unexcused_absence_count INT := 0;
  v_final_percentage NUMERIC := NULL;
  v_is_complete BOOLEAN := true;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_caller_school_id, v_caller_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable';
  END IF;

  SELECT s.id, s.school_id, s.profile_id, s.enrollment_status, s.account_status,
         s.student_number,
         COALESCE(p.first_name, s.first_name, '') AS first_name,
         COALESCE(p.last_name, s.last_name, '') AS last_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.id = p_student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Élève introuvable';
  END IF;

  SELECT sp.id, sp.school_id, sp.academic_year_id, sp.parent_term_id, sp.name, sp.education_cycle, sp.is_active
  INTO v_period
  FROM public.school_periods sp
  WHERE sp.id = p_period_id;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Période scolaire introuvable';
  END IF;

  IF v_period.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'La période scolaire demandée est inactive.';
  END IF;

  IF v_period.school_id IS DISTINCT FROM v_student.school_id THEN
    RAISE EXCEPTION 'Incohérence multi-écoles : La période appartient à un autre établissement.';
  END IF;

  SELECT st.id, st.school_id, st.academic_year_id, st.education_cycle, st.name, st.division_type, st.is_active
  INTO v_term
  FROM public.school_terms st WHERE st.id = v_period.parent_term_id;

  IF v_term.id IS NULL OR v_term.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Le terme parent de la période est inactif ou introuvable.';
  END IF;

  IF v_term.school_id IS DISTINCT FROM v_period.school_id OR v_term.academic_year_id IS DISTINCT FROM v_period.academic_year_id OR v_term.education_cycle IS DISTINCT FROM v_period.education_cycle THEN
    RAISE EXCEPTION 'Incohérence structurelle entre le terme et la période scolaire.';
  END IF;

  SELECT id, school_id, name, code INTO v_subject
  FROM public.subjects WHERE id = p_subject_id;

  IF v_subject.id IS NULL OR v_subject.school_id IS DISTINCT FROM v_student.school_id THEN
    RAISE EXCEPTION 'Matière introuvable dans cet établissement';
  END IF;

  SELECT se.id, se.class_id, se.school_id, se.academic_year_id, se.status,
         c.name AS class_name, c.education_cycle, c.school_id AS class_school_id,
         c.homeroom_teacher_id
  INTO v_enrollment
  FROM public.student_enrollments se
  JOIN public.classes c ON c.id = se.class_id
  WHERE se.student_id = p_student_id
    AND se.school_id = v_student.school_id
    AND se.academic_year_id = v_period.academic_year_id
    AND se.status = 'active';

  IF v_enrollment.id IS NULL THEN
    RAISE EXCEPTION 'Inscription active introuvable pour cet élève sur cette période et année scolaire.';
  END IF;

  IF v_period.education_cycle IS DISTINCT FROM v_enrollment.education_cycle THEN
    RAISE EXCEPTION 'Incohérence de cycle entre la période et la classe de l’élève.';
  END IF;

  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'school_admin' THEN
    IF v_caller_school_id IS DISTINCT FROM v_student.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF v_caller_school_id IS DISTINCT FROM v_student.school_id THEN
      RAISE EXCEPTION 'Accès refusé';
    END IF;

    SELECT id, profile_id, employment_status, account_status
    INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid AND school_id = v_student.school_id;

    IF v_teacher.id IS NULL OR v_teacher.employment_status <> 'active' OR v_teacher.account_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Enseignant inactif ou introuvable.';
    END IF;

    IF v_enrollment.homeroom_teacher_id = v_uid OR v_enrollment.homeroom_teacher_id = v_teacher.id THEN
      v_is_homeroom := true;
    END IF;

    IF NOT v_is_homeroom THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.teacher_class_assignments tca
        WHERE (tca.teacher_profile_id = v_uid OR tca.teacher_id = v_teacher.id)
          AND tca.class_id = v_enrollment.class_id
          AND tca.subject_id = p_subject_id
          AND tca.academic_year_id = v_period.academic_year_id
          AND tca.school_id = v_student.school_id
          AND tca.is_active = true
      ) THEN
        RAISE EXCEPTION 'Accès refusé : Vous n’êtes ni le professeur titulaire de cette classe ni affecté à cette matière.';
      END IF;
    END IF;

  ELSIF v_role = 'student' THEN
    IF v_student.profile_id IS DISTINCT FROM v_uid OR v_student.account_status <> 'active' OR v_student.enrollment_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Vous ne pouvez consulter que vos propres résultats scolaires.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.school_calendars
      WHERE school_id = v_period.school_id
        AND academic_year_id = v_period.academic_year_id
        AND education_cycle = v_period.education_cycle
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Le Calendrier Scolaire pour ce cycle n’est pas encore publié ou actif.';
    END IF;

  ELSIF v_role = 'parent' THEN
    IF NOT public.can_parent_access_student(p_student_id, 'can_view_academic') THEN
      RAISE EXCEPTION 'Accès refusé : Lien parental non approuvé ou consultation académique désactivée.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.school_calendars
      WHERE school_id = v_period.school_id
        AND academic_year_id = v_period.academic_year_id
        AND education_cycle = v_period.education_cycle
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Le Calendrier Scolaire pour ce cycle n’est pas encore publié ou actif.';
    END IF;

  ELSE
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  FOR v_assessment_cur IN (
    SELECT
      a.id AS assessment_id,
      a.title,
      a.assessment_type,
      a.assessment_date,
      a.max_score,
      a.coefficient,
      a.status,
      g.score,
      g.is_absent,
      g.is_excused,
      g.teacher_comment
    FROM public.school_assessments a
    LEFT JOIN public.student_grades g
      ON g.assessment_id = a.id
      AND g.student_id = p_student_id
    WHERE a.school_id = v_student.school_id
      AND a.academic_year_id = v_period.academic_year_id
      AND a.period_id = p_period_id
      AND a.class_id = v_enrollment.class_id
      AND a.subject_id = p_subject_id
      AND a.status IN ('published', 'closed')
    ORDER BY a.assessment_date ASC, a.created_at ASC
  ) LOOP
    v_assessment_count := v_assessment_count + 1;

    IF (v_assessment_cur.is_absent IS FALSE OR v_assessment_cur.is_absent IS NULL) AND v_assessment_cur.score IS NOT NULL THEN
      v_completed_assessment_count := v_completed_assessment_count + 1;
      v_total_weighted_points := v_total_weighted_points + ((v_assessment_cur.score / v_assessment_cur.max_score) * 100.0 * v_assessment_cur.coefficient);
      v_total_effective_coefficient := v_total_effective_coefficient + v_assessment_cur.coefficient;

      v_assessments_json := v_assessments_json || pg_catalog.jsonb_build_object(
        'assessment_id', v_assessment_cur.assessment_id,
        'title', v_assessment_cur.title,
        'assessment_type', v_assessment_cur.assessment_type,
        'assessment_date', v_assessment_cur.assessment_date,
        'max_score', v_assessment_cur.max_score,
        'coefficient', v_assessment_cur.coefficient,
        'status', v_assessment_cur.status,
        'score', v_assessment_cur.score,
        'normalized_percentage', ROUND((v_assessment_cur.score / v_assessment_cur.max_score) * 100.0, 2),
        'is_absent', false,
        'is_excused', false,
        'pending_grade', false,
        'is_included_in_average', true,
        'teacher_comment', v_assessment_cur.teacher_comment
      );

    ELSIF v_assessment_cur.is_absent IS TRUE AND v_assessment_cur.is_excused IS NOT TRUE THEN
      v_unexcused_absence_count := v_unexcused_absence_count + 1;
      v_completed_assessment_count := v_completed_assessment_count + 1;
      v_total_effective_coefficient := v_total_effective_coefficient + v_assessment_cur.coefficient;

      v_assessments_json := v_assessments_json || pg_catalog.jsonb_build_object(
        'assessment_id', v_assessment_cur.assessment_id,
        'title', v_assessment_cur.title,
        'assessment_type', v_assessment_cur.assessment_type,
        'assessment_date', v_assessment_cur.assessment_date,
        'max_score', v_assessment_cur.max_score,
        'coefficient', v_assessment_cur.coefficient,
        'status', v_assessment_cur.status,
        'score', NULL,
        'normalized_percentage', 0.0,
        'is_absent', true,
        'is_excused', false,
        'pending_grade', false,
        'is_included_in_average', true,
        'teacher_comment', v_assessment_cur.teacher_comment
      );

    ELSIF v_assessment_cur.is_absent IS TRUE AND v_assessment_cur.is_excused IS TRUE THEN
      v_excused_absence_count := v_excused_absence_count + 1;

      v_assessments_json := v_assessments_json || pg_catalog.jsonb_build_object(
        'assessment_id', v_assessment_cur.assessment_id,
        'title', v_assessment_cur.title,
        'assessment_type', v_assessment_cur.assessment_type,
        'assessment_date', v_assessment_cur.assessment_date,
        'max_score', v_assessment_cur.max_score,
        'coefficient', v_assessment_cur.coefficient,
        'status', v_assessment_cur.status,
        'score', NULL,
        'normalized_percentage', NULL,
        'is_absent', true,
        'is_excused', true,
        'pending_grade', false,
        'is_included_in_average', false,
        'teacher_comment', v_assessment_cur.teacher_comment
      );

    ELSE
      v_pending_assessment_count := v_pending_assessment_count + 1;
      v_is_complete := false;

      v_assessments_json := v_assessments_json || pg_catalog.jsonb_build_object(
        'assessment_id', v_assessment_cur.assessment_id,
        'title', v_assessment_cur.title,
        'assessment_type', v_assessment_cur.assessment_type,
        'assessment_date', v_assessment_cur.assessment_date,
        'max_score', v_assessment_cur.max_score,
        'coefficient', v_assessment_cur.coefficient,
        'status', v_assessment_cur.status,
        'score', NULL,
        'normalized_percentage', NULL,
        'is_absent', false,
        'is_excused', false,
        'pending_grade', true,
        'is_included_in_average', false,
        'teacher_comment', v_assessment_cur.teacher_comment
      );
    END IF;
  END LOOP;

  IF v_total_effective_coefficient > 0 THEN
    v_final_percentage := ROUND(v_total_weighted_points / v_total_effective_coefficient, 2);
  ELSE
    v_final_percentage := NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'school_id', v_student.school_id,
    'academic_year_id', v_period.academic_year_id,
    'student_id', p_student_id,
    'enrollment_id', v_enrollment.id,
    'class_id', v_enrollment.class_id,
    'class_name', v_enrollment.class_name,
    'subject_id', p_subject_id,
    'subject_name', v_subject.name,
    'period_id', p_period_id,
    'period_name', v_period.name,
    'term_id', v_term.id,
    'term_name', v_term.name,
    'assessment_count', v_assessment_count,
    'completed_assessment_count', v_completed_assessment_count,
    'pending_assessment_count', v_pending_assessment_count,
    'excused_absence_count', v_excused_absence_count,
    'unexcused_absence_count', v_unexcused_absence_count,
    'total_assessment_coefficient', v_total_effective_coefficient,
    'subject_percentage', v_final_percentage,
    'is_complete', (v_assessment_count > 0 AND v_pending_assessment_count = 0),
    'assessments', v_assessments_json
  );
END;
$$;

ALTER FUNCTION public.get_student_subject_period_result(UUID, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_student_subject_period_result(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_subject_period_result(UUID, UUID, UUID) TO authenticated;

-- L. get_messaging_contacts
CREATE OR REPLACE FUNCTION public.get_messaging_contacts(p_student_id UUID)
RETURNS TABLE(profile_id UUID, full_name TEXT, role TEXT, subject_id UUID, subject_name TEXT, is_homeroom BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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

  SELECT COUNT(*), (ARRAY_AGG(se.class_id))[1]
  INTO v_enrollment_count, v_class_id
  FROM public.student_enrollments se
  WHERE se.student_id = p_student_id
    AND se.school_id = v_school_id
    AND se.academic_year_id = v_academic_year_id
    AND se.status = 'active';

  IF v_enrollment_count = 0 THEN
    RAISE EXCEPTION 'Accès refusé : L’élève n’a aucune inscription active pour l’année scolaire courante' USING ERRCODE = '42501';
  ELSIF v_enrollment_count > 1 THEN
    RAISE EXCEPTION 'Conflit de données : Plusieurs inscriptions actives trouvées pour l’élève' USING ERRCODE = '22023';
  END IF;

  IF public.can_parent_access_student(p_student_id, NULL) THEN
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
      JOIN public.parent_accounts pa ON pa.profile_id = prof.id
      JOIN public.school_memberships sm ON sm.profile_id = prof.id AND sm.school_id = v_school_id AND sm.role = 'parent' AND sm.status = 'active'
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

ALTER FUNCTION public.get_messaging_contacts(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_messaging_contacts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_messaging_contacts(UUID) TO authenticated;

-- M. can_user_read_school_calendar
CREATE OR REPLACE FUNCTION public.can_user_read_school_calendar(p_school_id UUID, p_education_cycle TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_caller_school_id UUID;
  v_caller_active BOOLEAN;
  v_school_status TEXT;
  v_teacher_active BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.role, p.school_id, p.is_active, s.status
  INTO v_role, v_caller_school_id, v_caller_active, v_school_status
  FROM public.profiles p
  LEFT JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_caller_active IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF v_role = 'super_admin' THEN
    RETURN true;
  END IF;

  IF v_role = 'school_admin' THEN
    IF v_caller_school_id = p_school_id AND v_school_status = 'active' THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF v_school_status <> 'active' THEN
    RETURN false;
  END IF;

  IF v_role = 'teacher' THEN
    IF v_caller_school_id IS DISTINCT FROM p_school_id THEN
      RETURN false;
    END IF;

    SELECT (t.employment_status = 'active' AND t.account_status = 'active')
    INTO v_teacher_active
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = p_school_id;

    IF v_teacher_active IS NOT TRUE THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.teacher_class_assignments tca
      JOIN public.classes c ON c.id = tca.class_id AND c.school_id = tca.school_id
      JOIN public.academic_years ay ON ay.id = tca.academic_year_id AND ay.school_id = tca.school_id
      WHERE (tca.teacher_profile_id = v_uid OR tca.teacher_id IN (SELECT id FROM public.teachers WHERE profile_id = v_uid))
        AND tca.school_id = p_school_id
        AND tca.is_active = true
        AND ay.is_current = true
        AND c.education_cycle = p_education_cycle
    );
  END IF;

  IF v_role = 'student' THEN
    IF v_caller_school_id IS DISTINCT FROM p_school_id THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.student_enrollments se
      JOIN public.classes c ON c.id = se.class_id AND c.school_id = se.school_id
      JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
      JOIN public.students st ON st.id = se.student_id AND st.school_id = se.school_id
      WHERE st.profile_id = v_uid
        AND se.school_id = p_school_id
        AND se.status = 'active'
        AND ay.is_current = true
        AND c.education_cycle = p_education_cycle
    );
  END IF;

  IF v_role = 'parent' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.school_memberships sm
      JOIN public.parent_student_links psl ON psl.parent_profile_id = v_uid AND psl.school_id = p_school_id
      JOIN public.students st ON st.id = psl.student_id AND st.school_id = p_school_id
      JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = p_school_id
      JOIN public.classes c ON c.id = se.class_id AND c.school_id = p_school_id
      JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = p_school_id
      WHERE sm.profile_id = v_uid
        AND sm.school_id = p_school_id
        AND sm.role = 'parent'
        AND sm.status = 'active'
        AND psl.status = 'approved'
        AND st.enrollment_status = 'active'
        AND se.status = 'active'
        AND ay.is_current = true
        AND c.education_cycle = p_education_cycle
    );
  END IF;

  RETURN false;
END;
$$;

ALTER FUNCTION public.can_user_read_school_calendar(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_user_read_school_calendar(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_user_read_school_calendar(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC ADDITIVE DE CONTEXTE PARENT MULTI-ÉCOLES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_parent_children_and_schools()
RETURNS TABLE (
  student_id UUID,
  student_full_name TEXT,
  school_id UUID,
  school_name TEXT,
  class_id UUID,
  class_name TEXT,
  academic_year_id UUID,
  academic_year_name TEXT,
  link_status TEXT,
  permissions JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_incompatible_student_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.parent_accounts pa ON pa.profile_id = p.id
    WHERE p.id = v_caller_id
      AND p.is_active = true
      AND pa.account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'REJET ACCÈS : Compte parent inactif ou introuvable.' USING ERRCODE = '42501';
  END IF;

  SELECT se.student_id INTO v_incompatible_student_id
  FROM public.parent_student_links psl
  JOIN public.school_memberships sm 
    ON sm.profile_id = psl.parent_profile_id 
   AND sm.school_id = psl.school_id 
   AND sm.role = 'parent' 
   AND sm.status = 'active'
  JOIN public.students st ON st.id = psl.student_id AND st.school_id = psl.school_id
  JOIN public.student_enrollments se ON se.student_id = st.id AND se.school_id = st.school_id AND se.status = 'active'
  JOIN public.academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id AND ay.is_current = true
  WHERE psl.parent_profile_id = v_caller_id
    AND psl.status = 'approved'
  GROUP BY se.student_id
  HAVING COUNT(DISTINCT se.class_id) > 1;

  IF v_incompatible_student_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflit de données : Plusieurs inscriptions actives incompatibles trouvées pour l’élève %', v_incompatible_student_id
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT 
    st.id AS student_id,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name,
    s.id AS school_id,
    s.name AS school_name,
    c.id AS class_id,
    c.name AS class_name,
    ay.id AS academic_year_id,
    ay.name AS academic_year_name,
    psl.status AS link_status,
    pg_catalog.jsonb_build_object(
      'can_view_academic', psl.can_view_academic,
      'can_view_attendance', psl.can_view_attendance,
      'can_view_homework', psl.can_view_homework,
      'can_view_finances', psl.can_view_finances,
      'can_pickup_student', psl.can_pickup_student,
      'can_receive_notifications', psl.can_receive_notifications
    ) AS permissions
  FROM public.parent_student_links psl
  JOIN public.school_memberships sm 
    ON sm.profile_id = psl.parent_profile_id 
   AND sm.school_id = psl.school_id 
   AND sm.role = 'parent' 
   AND sm.status = 'active'
  JOIN public.students st ON st.id = psl.student_id AND st.school_id = psl.school_id
  JOIN public.schools s ON s.id = st.school_id AND s.status = 'active'
  LEFT JOIN public.student_enrollments se 
    ON se.student_id = st.id 
   AND se.school_id = st.school_id 
   AND se.status = 'active'
  LEFT JOIN public.academic_years ay 
    ON ay.id = se.academic_year_id 
   AND ay.school_id = st.school_id 
   AND ay.is_current = true
  LEFT JOIN public.classes c 
    ON c.id = se.class_id 
   AND c.school_id = st.school_id
  WHERE psl.parent_profile_id = v_caller_id
    AND psl.status = 'approved'
  ORDER BY s.name ASC, st.last_name ASC, st.first_name ASC;
END;
$$;

ALTER FUNCTION public.get_parent_children_and_schools() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_parent_children_and_schools() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_children_and_schools() TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. MISE À JOUR DES POLITIQUES RLS PARENT
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Parent read linked enrollments" ON public.student_enrollments;
CREATE POLICY "Parent read linked enrollments"
ON public.student_enrollments
FOR SELECT
TO public
USING (public.is_parent_of_student(student_id));

DROP POLICY IF EXISTS "students_parent_select_policy" ON public.students;
CREATE POLICY "students_parent_select_policy"
ON public.students
FOR SELECT
TO authenticated
USING (
  (profile_id = auth.uid()) OR
  (public.is_parent_of_student(id)) OR
  (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = students.school_id
      AND p.is_active = true
      AND p.role = 'school_admin'
  )) OR
  public.is_super_admin()
);
