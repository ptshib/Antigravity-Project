-- Phase 2F.3 Database Audit Query (Strictly Read-Only)
-- Output format: audit_category TEXT, details JSONB

WITH
cat_table_columns AS (
  SELECT
    'table_columns'::text AS audit_category,
    jsonb_agg(
      jsonb_build_object(
        'table_name', c.table_name,
        'column_name', c.column_name,
        'data_type', c.data_type,
        'is_nullable', c.is_nullable,
        'column_default', c.column_default,
        'ordinal_position', c.ordinal_position
      ) ORDER BY c.table_name, c.ordinal_position
    ) AS details
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name IN (
      'schools',
      'profiles',
      'academic_years',
      'school_calendars',
      'school_terms',
      'school_periods',
      'classes',
      'students',
      'student_enrollments',
      'subjects',
      'class_subject_settings',
      'school_assessments',
      'student_grades',
      'teachers',
      'teacher_class_assignments',
      'parent_accounts',
      'parent_student_links',
      'school_portal_invitations',
      'school_audit_logs'
    )
),

cat_related_tables AS (
  SELECT
    'related_tables'::text AS audit_category,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'table_schema', t.table_schema,
          'table_name', t.table_name,
          'table_type', t.table_type
        ) ORDER BY t.table_name
      ),
      '[]'::jsonb
    ) AS details
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND (
      t.table_name ILIKE '%report%'
      OR t.table_name ILIKE '%bulletin%'
      OR t.table_name ILIKE '%appreciation%'
      OR t.table_name ILIKE '%remark%'
      OR t.table_name ILIKE '%signature%'
      OR t.table_name ILIKE '%stamp%'
      OR t.table_name ILIKE '%cachet%'
      OR t.table_name ILIKE '%publish%'
      OR t.table_name ILIKE '%document%'
    )
),

cat_constraints AS (
  SELECT
    'constraints'::text AS audit_category,
    jsonb_agg(
      jsonb_build_object(
        'table_name', conrelid::regclass::text,
        'constraint_name', conname,
        'constraint_type', CASE contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'c' THEN 'CHECK'
          WHEN 't' THEN 'TRIGGER'
          WHEN 'x' THEN 'EXCLUSION'
          ELSE contype::text
        END,
        'definition', pg_get_constraintdef(c.oid, true)
      ) ORDER BY conrelid::regclass::text, conname
    ) AS details
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public'
    AND conrelid::regclass::text IN (
      'schools', 'profiles', 'academic_years', 'school_calendars',
      'school_terms', 'school_periods', 'classes', 'students',
      'student_enrollments', 'subjects', 'class_subject_settings',
      'school_assessments', 'student_grades', 'teachers',
      'teacher_class_assignments', 'parent_accounts',
      'parent_student_links', 'school_portal_invitations', 'school_audit_logs'
    )
),

cat_indexes AS (
  SELECT
    'indexes'::text AS audit_category,
    jsonb_agg(
      jsonb_build_object(
        'table_name', tablename,
        'index_name', indexname,
        'index_definition', indexdef
      ) ORDER BY tablename, indexname
    ) AS details
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN (
      'schools', 'profiles', 'academic_years', 'school_calendars',
      'school_terms', 'school_periods', 'classes', 'students',
      'student_enrollments', 'subjects', 'class_subject_settings',
      'school_assessments', 'student_grades', 'teachers',
      'teacher_class_assignments', 'parent_accounts',
      'parent_student_links', 'school_portal_invitations', 'school_audit_logs'
    )
),

cat_functions AS (
  SELECT
    'functions'::text AS audit_category,
    jsonb_agg(
      jsonb_build_object(
        'function_name', p.proname,
        'arguments', pg_get_function_identity_arguments(p.oid),
        'return_type', pg_get_function_result(p.oid),
        'is_security_definer', p.prosecdef,
        'search_path', p.proconfig,
        'definition', pg_get_functiondef(p.oid)
      ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
    ) AS details
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname ILIKE '%result%'
      OR p.proname ILIKE '%period%'
      OR p.proname ILIKE '%grade%'
      OR p.proname ILIKE '%assessment%'
      OR p.proname ILIKE '%bulletin%'
      OR p.proname ILIKE '%report%'
      OR p.proname ILIKE '%homeroom%'
      OR p.proname ILIKE '%calendar%'
      OR p.proname ILIKE '%subject%'
      OR p.proname ILIKE '%coefficient%'
      OR p.proname ILIKE '%publish%'
      OR p.proname ILIKE '%validate%'
      OR p.proname ILIKE '%rank%'
    )
),

cat_function_execute_privileges AS (
  SELECT
    'function_execute_privileges'::text AS audit_category,
    jsonb_agg(
      jsonb_build_object(
        'function_name', p.proname,
        'arguments', pg_get_function_identity_arguments(p.oid),
        'has_privilege_public', has_function_privilege('public', p.oid, 'EXECUTE'),
        'has_privilege_anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'has_privilege_authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'has_privilege_service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')
      ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
    ) AS details
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname ILIKE '%result%'
      OR p.proname ILIKE '%period%'
      OR p.proname ILIKE '%grade%'
      OR p.proname ILIKE '%assessment%'
      OR p.proname ILIKE '%bulletin%'
      OR p.proname ILIKE '%report%'
      OR p.proname ILIKE '%homeroom%'
      OR p.proname ILIKE '%calendar%'
      OR p.proname ILIKE '%coefficient%'
      OR p.proname ILIKE '%publish%'
      OR p.proname ILIKE '%activate%'
    )
),

cat_rls_policies AS (
  SELECT
    'rls_policies'::text AS audit_category,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'schema_name', schemaname,
          'table_name', tablename,
          'policy_name', policyname,
          'permissive', permissive,
          'roles', roles,
          'command', cmd,
          'qual', qual,
          'with_check', with_check
        ) ORDER BY tablename, policyname
      ),
      '[]'::jsonb
    ) AS details
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'schools', 'profiles', 'academic_years', 'school_calendars',
      'school_terms', 'school_periods', 'classes', 'students',
      'student_enrollments', 'subjects', 'class_subject_settings',
      'school_assessments', 'student_grades', 'teachers',
      'teacher_class_assignments', 'parent_accounts',
      'parent_student_links', 'school_portal_invitations', 'school_audit_logs'
    )
),

cat_rls_status AS (
  SELECT
    'rls_status'::text AS audit_category,
    jsonb_agg(
      jsonb_build_object(
        'table_name', c.relname,
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity
      ) ORDER BY c.relname
    ) AS details
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'schools', 'profiles', 'academic_years', 'school_calendars',
      'school_terms', 'school_periods', 'classes', 'students',
      'student_enrollments', 'subjects', 'class_subject_settings',
      'school_assessments', 'student_grades', 'teachers',
      'teacher_class_assignments', 'parent_accounts',
      'parent_student_links', 'school_portal_invitations', 'school_audit_logs'
    )
),

cat_school_identity_columns AS (
  SELECT
    'school_identity_columns'::text AS audit_category,
    jsonb_agg(
      jsonb_build_object(
        'column_name', c.column_name,
        'data_type', c.data_type,
        'is_nullable', c.is_nullable,
        'column_default', c.column_default
      ) ORDER BY c.ordinal_position
    ) AS details
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'schools'
),

cat_teacher_signature_columns AS (
  SELECT
    'teacher_signature_columns'::text AS audit_category,
    jsonb_agg(
      jsonb_build_object(
        'table_name', c.table_name,
        'column_name', c.column_name,
        'data_type', c.data_type,
        'is_nullable', c.is_nullable,
        'column_default', c.column_default
      ) ORDER BY c.table_name, c.ordinal_position
    ) AS details
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name IN ('teachers', 'profiles')
    AND c.column_name IN (
      'id', 'school_id', 'profile_id', 'employee_number',
      'first_name', 'last_name', 'full_name', 'display_name',
      'signature_url', 'signature', 'avatar_url',
      'employment_status', 'account_status', 'role', 'is_active'
    )
),

cat_storage_buckets AS (
  SELECT
    'storage_buckets'::text AS audit_category,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', b.id,
            'name', b.name,
            'public', b.public,
            'file_size_limit', b.file_size_limit,
            'allowed_mime_types', b.allowed_mime_types
          ) ORDER BY b.name
        )
        FROM storage.buckets b
      ),
      '[]'::jsonb
    ) AS details
),

cat_storage_policies AS (
  SELECT
    'storage_policies'::text AS audit_category,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'table_name', tablename,
          'policy_name', policyname,
          'roles', roles,
          'command', cmd,
          'qual', qual,
          'with_check', with_check
        ) ORDER BY tablename, policyname
      ),
      '[]'::jsonb
    ) AS details
  FROM pg_policies
  WHERE schemaname = 'storage'
)

SELECT audit_category, details FROM cat_table_columns
UNION ALL
SELECT audit_category, details FROM cat_related_tables
UNION ALL
SELECT audit_category, details FROM cat_constraints
UNION ALL
SELECT audit_category, details FROM cat_indexes
UNION ALL
SELECT audit_category, details FROM cat_functions
UNION ALL
SELECT audit_category, details FROM cat_function_execute_privileges
UNION ALL
SELECT audit_category, details FROM cat_rls_policies
UNION ALL
SELECT audit_category, details FROM cat_rls_status
UNION ALL
SELECT audit_category, details FROM cat_school_identity_columns
UNION ALL
SELECT audit_category, details FROM cat_teacher_signature_columns
UNION ALL
SELECT audit_category, details FROM cat_storage_buckets
UNION ALL
SELECT audit_category, details FROM cat_storage_policies;
