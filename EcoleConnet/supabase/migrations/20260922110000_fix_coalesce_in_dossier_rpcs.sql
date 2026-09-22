-- Migration SQL : Correction de syntaxe COALESCE dans les RPCs de dossiers individuels Élèves & Enseignants
-- Fichier : supabase/migrations/20260922110000_fix_coalesce_in_dossier_rpcs.sql

-- 1. RPC: GET_STUDENT_FULL_DOSSIER
CREATE OR REPLACE FUNCTION public.get_student_full_dossier(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_uid UUID;
    v_caller_role TEXT;
    v_caller_school_id UUID;
    v_student public.students%ROWTYPE;
    v_class_name TEXT;
    v_enrollments JSONB;
    v_attendance JSONB;
    v_academic JSONB;
    v_financial JSONB;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    -- Récupération du profil de l'utilisateur connecté
    SELECT role, school_id INTO v_caller_role, v_caller_school_id
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'USER_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- Récupération de l'élève
    SELECT * INTO v_student
    FROM public.students
    WHERE id = p_student_id;

    IF v_student.id IS NULL THEN
        RAISE EXCEPTION 'STUDENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- Vérification de l'isolation multi-école (sauf super_admin)
    IF v_caller_role <> 'super_admin' AND (v_caller_school_id IS NULL OR v_caller_school_id <> v_student.school_id) THEN
        RAISE EXCEPTION 'CROSS_SCHOOL_ACCESS_DENIED' USING ERRCODE = '42501';
    END IF;

    -- Classe actuelle
    SELECT name INTO v_class_name
    FROM public.classes
    WHERE id = v_student.class_id;

    -- Historique des inscriptions et changements de classe (COALESCE correct)
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'id', se.id,
                'class_id', se.class_id,
                'class_name', c.name,
                'status', se.status,
                'enrolled_at', se.created_at
            ) ORDER BY se.created_at DESC
        ),
        '[]'::jsonb
    ) INTO v_enrollments
    FROM public.student_enrollments se
    LEFT JOIN public.classes c ON c.id = se.class_id
    WHERE se.student_id = v_student.id;

    -- Résumé des présences
    SELECT pg_catalog.jsonb_build_object(
        'total_sessions', pg_catalog.count(sa.id),
        'present_count', pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'present'),
        'absent_count', pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'absent'),
        'late_count', pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'late'),
        'excused_count', pg_catalog.count(sa.id) FILTER (WHERE sa.status = 'excused')
    ) INTO v_attendance
    FROM public.student_attendance sa
    WHERE sa.student_id = v_student.id;

    -- Résumé académique
    SELECT pg_catalog.jsonb_build_object(
        'total_assessments', (
            SELECT pg_catalog.count(sg.id)
            FROM public.student_grades sg
            WHERE sg.student_id = v_student.id
        ),
        'report_cards_count', (
            SELECT pg_catalog.count(prc.id)
            FROM public.period_report_cards prc
            WHERE prc.student_id = v_student.id
        )
    ) INTO v_academic;

    -- Résumé financier (COALESCE correct)
    SELECT pg_catalog.jsonb_build_object(
        'total_invoiced', COALESCE(SUM(si.total_amount), 0),
        'total_paid', COALESCE(SUM(si.paid_amount), 0),
        'balance_due', COALESCE(SUM(si.balance_amount), 0),
        'invoice_count', pg_catalog.count(si.id)
    ) INTO v_financial
    FROM public.student_invoices si
    WHERE si.student_id = v_student.id AND si.status <> 'cancelled';

    RETURN pg_catalog.jsonb_build_object(
        'student', pg_catalog.jsonb_build_object(
            'id', v_student.id,
            'school_id', v_student.school_id,
            'profile_id', v_student.profile_id,
            'student_number', v_student.student_number,
            'first_name', v_student.first_name,
            'last_name', v_student.last_name,
            'middle_name', v_student.middle_name,
            'gender', v_student.gender,
            'date_of_birth', v_student.date_of_birth,
            'birth_place', v_student.birth_place,
            'guardian_reference', v_student.guardian_reference,
            'enrollment_status', v_student.enrollment_status,
            'account_status', v_student.account_status,
            'admission_date', v_student.admission_date,
            'created_at', v_student.created_at,
            'class_id', v_student.class_id,
            'current_class_name', v_class_name
        ),
        'enrollment_history', v_enrollments,
        'attendance_summary', v_attendance,
        'academic_summary', v_academic,
        'financial_summary', v_financial
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_full_dossier FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_full_dossier TO authenticated, service_role;
ALTER FUNCTION public.get_student_full_dossier OWNER TO postgres;

-- 2. RPC: UPDATE_STUDENT_PERSONAL_INFO
CREATE OR REPLACE FUNCTION public.update_student_personal_info(
    p_student_id UUID,
    p_first_name TEXT,
    p_last_name TEXT,
    p_middle_name TEXT DEFAULT NULL,
    p_gender TEXT DEFAULT NULL,
    p_date_of_birth DATE DEFAULT NULL,
    p_birth_place TEXT DEFAULT NULL,
    p_guardian_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_uid UUID;
    v_caller_role TEXT;
    v_caller_school_id UUID;
    v_student public.students%ROWTYPE;
    v_clean_first_name TEXT;
    v_clean_last_name TEXT;
    v_clean_middle_name TEXT;
    v_clean_birth_place TEXT;
    v_clean_guardian TEXT;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    -- Récupération du profil administrateur
    SELECT role, school_id INTO v_caller_role, v_caller_school_id
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'school_admin') THEN
        RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = '42501';
    END IF;

    -- Récupération de l'élève
    SELECT * INTO v_student
    FROM public.students
    WHERE id = p_student_id;

    IF v_student.id IS NULL THEN
        RAISE EXCEPTION 'STUDENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- Isolation multi-école
    IF v_caller_role <> 'super_admin' AND (v_caller_school_id IS NULL OR v_caller_school_id <> v_student.school_id) THEN
        RAISE EXCEPTION 'CROSS_SCHOOL_ACCESS_DENIED' USING ERRCODE = '42501';
    END IF;

    -- Nettoyage des chaînes de caractères
    v_clean_first_name := pg_catalog.btrim(p_first_name);
    v_clean_last_name := pg_catalog.btrim(p_last_name);
    v_clean_middle_name := NULLIF(pg_catalog.btrim(p_middle_name), '');
    v_clean_birth_place := NULLIF(pg_catalog.btrim(p_birth_place), '');
    v_clean_guardian := NULLIF(pg_catalog.btrim(p_guardian_reference), '');

    IF v_clean_first_name IS NULL OR v_clean_first_name = '' THEN
        RAISE EXCEPTION 'FIRST_NAME_REQUIRED' USING ERRCODE = '22023';
    END IF;

    IF v_clean_last_name IS NULL OR v_clean_last_name = '' THEN
        RAISE EXCEPTION 'LAST_NAME_REQUIRED' USING ERRCODE = '22023';
    END IF;

    IF p_gender IS NOT NULL AND p_gender NOT IN ('M', 'F') THEN
        RAISE EXCEPTION 'INVALID_GENDER' USING ERRCODE = '22023';
    END IF;

    -- Mise à jour dans public.students (sans toucher student_number ni class_id)
    UPDATE public.students
    SET first_name = v_clean_first_name,
        last_name = v_clean_last_name,
        middle_name = v_clean_middle_name,
        gender = COALESCE(p_gender, gender),
        date_of_birth = COALESCE(p_date_of_birth, date_of_birth),
        birth_place = v_clean_birth_place,
        guardian_reference = v_clean_guardian,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_student.id;

    -- Synchronisation du profil si rattaché
    IF v_student.profile_id IS NOT NULL THEN
        UPDATE public.profiles
        SET first_name = v_clean_first_name,
            last_name = v_clean_last_name,
            display_name = v_clean_first_name || ' ' || v_clean_last_name,
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_student.profile_id;
    END IF;

    -- Journalisation d'audit
    INSERT INTO public.school_audit_logs (
        school_id, actor_id, action, details, created_at
    ) VALUES (
        v_student.school_id,
        v_caller_uid,
        'update_student_personal_info',
        pg_catalog.jsonb_build_object(
            'student_id', v_student.id,
            'student_number', v_student.student_number,
            'first_name', v_clean_first_name,
            'last_name', v_clean_last_name
        ),
        pg_catalog.clock_timestamp()
    );

    RETURN pg_catalog.jsonb_build_object('success', true, 'student_id', v_student.id);
END;
$$;

REVOKE ALL ON FUNCTION public.update_student_personal_info FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_student_personal_info TO authenticated, service_role;
ALTER FUNCTION public.update_student_personal_info OWNER TO postgres;

-- 3. RPC: GET_TEACHER_FULL_DOSSIER
CREATE OR REPLACE FUNCTION public.get_teacher_full_dossier(p_teacher_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_uid UUID;
    v_caller_role TEXT;
    v_caller_school_id UUID;
    v_teacher public.teachers%ROWTYPE;
    v_assignments JSONB;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    SELECT role, school_id INTO v_caller_role, v_caller_school_id
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'USER_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_teacher
    FROM public.teachers
    WHERE id = p_teacher_id;

    IF v_teacher.id IS NULL THEN
        RAISE EXCEPTION 'TEACHER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF v_caller_role <> 'super_admin' AND (v_caller_school_id IS NULL OR v_caller_school_id <> v_teacher.school_id) THEN
        RAISE EXCEPTION 'CROSS_SCHOOL_ACCESS_DENIED' USING ERRCODE = '42501';
    END IF;

    -- Récupération des affectations aux classes et matières (COALESCE correct)
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'assignment_id', tca.id,
                'class_id', tca.class_id,
                'class_name', c.name,
                'subject_id', tca.subject_id,
                'subject_name', s.name,
                'term_id', tca.term_id,
                'term_name', st.name,
                'is_active', tca.is_active,
                'created_at', tca.created_at
            ) ORDER BY tca.created_at DESC
        ),
        '[]'::jsonb
    ) INTO v_assignments
    FROM public.teacher_class_assignments tca
    LEFT JOIN public.classes c ON c.id = tca.class_id
    LEFT JOIN public.subjects s ON s.id = tca.subject_id
    LEFT JOIN public.school_terms st ON st.id = tca.term_id
    WHERE tca.teacher_id = v_teacher.id OR (v_teacher.profile_id IS NOT NULL AND tca.teacher_profile_id = v_teacher.profile_id);

    RETURN pg_catalog.jsonb_build_object(
        'teacher', pg_catalog.jsonb_build_object(
            'id', v_teacher.id,
            'school_id', v_teacher.school_id,
            'profile_id', v_teacher.profile_id,
            'employee_number', v_teacher.employee_number,
            'first_name', v_teacher.first_name,
            'last_name', v_teacher.last_name,
            'gender', v_teacher.gender,
            'email', v_teacher.email,
            'phone', v_teacher.phone,
            'speciality', v_teacher.speciality,
            'employment_status', v_teacher.employment_status,
            'account_status', v_teacher.account_status,
            'created_at', v_teacher.created_at
        ),
        'assignments', v_assignments
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_full_dossier FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_full_dossier TO authenticated, service_role;
ALTER FUNCTION public.get_teacher_full_dossier OWNER TO postgres;

-- 4. RPC: UPDATE_TEACHER_PERSONAL_INFO
CREATE OR REPLACE FUNCTION public.update_teacher_personal_info(
    p_teacher_id UUID,
    p_first_name TEXT,
    p_last_name TEXT,
    p_gender TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_speciality TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_uid UUID;
    v_caller_role TEXT;
    v_caller_school_id UUID;
    v_teacher public.teachers%ROWTYPE;
    v_clean_first_name TEXT;
    v_clean_last_name TEXT;
    v_clean_email TEXT;
    v_clean_phone TEXT;
    v_clean_speciality TEXT;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    SELECT role, school_id INTO v_caller_role, v_caller_school_id
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'school_admin') THEN
        RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_teacher
    FROM public.teachers
    WHERE id = p_teacher_id;

    IF v_teacher.id IS NULL THEN
        RAISE EXCEPTION 'TEACHER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF v_caller_role <> 'super_admin' AND (v_caller_school_id IS NULL OR v_caller_school_id <> v_teacher.school_id) THEN
        RAISE EXCEPTION 'CROSS_SCHOOL_ACCESS_DENIED' USING ERRCODE = '42501';
    END IF;

    v_clean_first_name := pg_catalog.btrim(p_first_name);
    v_clean_last_name := pg_catalog.btrim(p_last_name);
    v_clean_email := NULLIF(pg_catalog.btrim(p_email), '');
    v_clean_phone := NULLIF(pg_catalog.btrim(p_phone), '');
    v_clean_speciality := NULLIF(pg_catalog.btrim(p_speciality), '');

    IF v_clean_first_name IS NULL OR v_clean_first_name = '' THEN
        RAISE EXCEPTION 'FIRST_NAME_REQUIRED' USING ERRCODE = '22023';
    END IF;

    IF v_clean_last_name IS NULL OR v_clean_last_name = '' THEN
        RAISE EXCEPTION 'LAST_NAME_REQUIRED' USING ERRCODE = '22023';
    END IF;

    -- Vérification de l'unicité de l'email si renseigné
    IF v_clean_email IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.teachers
        WHERE school_id = v_teacher.school_id AND LOWER(TRIM(email)) = LOWER(v_clean_email) AND id <> v_teacher.id
    ) THEN
        RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS_IN_SCHOOL' USING ERRCODE = '23505';
    END IF;

    -- Update teachers
    UPDATE public.teachers
    SET first_name = v_clean_first_name,
        last_name = v_clean_last_name,
        gender = COALESCE(p_gender, gender),
        email = v_clean_email,
        phone = v_clean_phone,
        speciality = v_clean_speciality,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_teacher.id;

    -- Update profiles if linked
    IF v_teacher.profile_id IS NOT NULL THEN
        UPDATE public.profiles
        SET first_name = v_clean_first_name,
            last_name = v_clean_last_name,
            display_name = v_clean_first_name || ' ' || v_clean_last_name,
            phone = COALESCE(v_clean_phone, phone),
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_teacher.profile_id;
    END IF;

    -- Journalisation d'audit
    INSERT INTO public.school_audit_logs (
        school_id, actor_id, action, details, created_at
    ) VALUES (
        v_teacher.school_id,
        v_caller_uid,
        'update_teacher_personal_info',
        pg_catalog.jsonb_build_object(
            'teacher_id', v_teacher.id,
            'employee_number', v_teacher.employee_number,
            'first_name', v_clean_first_name,
            'last_name', v_clean_last_name,
            'email', v_clean_email
        ),
        pg_catalog.clock_timestamp()
    );

    RETURN pg_catalog.jsonb_build_object('success', true, 'teacher_id', v_teacher.id);
END;
$$;

REVOKE ALL ON FUNCTION public.update_teacher_personal_info FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_teacher_personal_info TO authenticated, service_role;
ALTER FUNCTION public.update_teacher_personal_info OWNER TO postgres;
