-- Migration SQL : Correction du nom de colonne financier (si.remaining_balance) dans get_student_full_dossier
-- Fichier : supabase/migrations/20260922120000_fix_student_dossier_balance_column.sql

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

    -- Historique des inscriptions et changements de classe
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

    -- Résumé financier (Correction de la colonne : si.remaining_balance au lieu de si.balance_amount)
    SELECT pg_catalog.jsonb_build_object(
        'total_invoiced', COALESCE(SUM(si.total_amount), 0),
        'total_paid', COALESCE(SUM(si.paid_amount), 0),
        'balance_due', COALESCE(SUM(si.remaining_balance), 0),
        'invoice_count', pg_catalog.count(si.id)
    ) INTO v_financial
    FROM public.student_invoices si
    WHERE si.student_id = v_student.id AND si.status <> 'voided';

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
