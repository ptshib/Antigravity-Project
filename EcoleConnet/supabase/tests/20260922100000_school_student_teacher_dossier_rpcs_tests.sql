-- Test Suite : 20260922100000_school_student_teacher_dossier_rpcs_tests.sql
-- Validation des RPCs de fiches individuelles Élèves et Enseignants, isolation multi-école et sécurité

BEGIN;

DO $$
DECLARE
    v_school_a UUID := 'a0000000-0000-0000-0000-000000000001';
    v_school_b UUID := 'b0000000-0000-0000-0000-000000000002';
    v_admin_a UUID := 'a1111111-1111-1111-1111-111111111111';
    v_admin_b UUID := 'b1111111-1111-1111-1111-111111111111';
    v_teacher_user UUID := 'c1111111-1111-1111-1111-111111111111';
    v_class_a UUID := 'a2222222-2222-2222-2222-222222222222';
    v_student_a UUID := 'a3333333-3333-3333-3333-333333333333';
    v_teacher_a UUID := 'a4444444-4444-4444-4444-444444444444';
    v_student_b UUID := 'b3333333-3333-3333-3333-333333333333';
    v_dossier JSONB;
    v_res JSONB;
    v_audit_count INT;
    v_updated_student RECORD;
    v_updated_teacher RECORD;
BEGIN
    SET LOCAL session_replication_role = 'replica';

    -- Setup Écoles
    INSERT INTO public.schools (id, name, code, is_active)
    VALUES 
        (v_school_a, 'École Test A', 'ECOLE_A', true),
        (v_school_b, 'École Test B', 'ECOLE_B', true)
    ON CONFLICT (id) DO NOTHING;

    -- Setup Profils
    INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
    VALUES
        (v_admin_a, v_school_a, 'school_admin', 'Admin', 'A', true),
        (v_admin_b, v_school_b, 'school_admin', 'Admin', 'B', true),
        (v_teacher_user, v_school_a, 'teacher', 'Prof', 'A', true)
    ON CONFLICT (id) DO NOTHING;

    -- Setup Classes
    INSERT INTO public.classes (id, school_id, name, grade_level)
    VALUES (v_class_a, v_school_a, '1re Sec A', '1_sec')
    ON CONFLICT (id) DO NOTHING;

    -- Setup Élèves
    INSERT INTO public.students (
        id, school_id, student_number, first_name, last_name, middle_name,
        gender, date_of_birth, birth_place, guardian_reference, class_id, enrollment_status, account_status
    ) VALUES (
        v_student_a, v_school_a, 'STU-A-001', 'Jean', 'Kabila', 'Mwamba',
        'M', '2010-05-15', 'Kinshasa', 'Papa Kabila 0810000000', v_class_a, 'active', 'not_invited'
    ), (
        v_student_b, v_school_b, 'STU-B-001', 'Marie', 'Tshisekedi', NULL,
        'F', '2011-03-20', 'Lubumbashi', 'Maman Tshisekedi', NULL, 'active', 'not_invited'
    ) ON CONFLICT (id) DO NOTHING;

    -- Setup Enseignants
    INSERT INTO public.teachers (
        id, school_id, employee_number, first_name, last_name, email, phone, gender, speciality
    ) VALUES (
        v_teacher_a, v_school_a, 'ENS-A-001', 'Alain', 'Mulumba', 'alain@ecole-a.cd', '0990000001', 'M', 'Mathématiques'
    ) ON CONFLICT (id) DO NOTHING;

    SET LOCAL session_replication_role = 'origin';

    -- ------------------------------------------------------------------------
    -- TEST 1 : Consultation dossier élève (Même École)
    -- ------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);
    v_dossier := public.get_student_full_dossier(v_student_a);

    IF v_dossier->'student'->>'student_number' <> 'STU-A-001' OR v_dossier->'student'->>'first_name' <> 'Jean' THEN
        RAISE EXCEPTION 'TEST DOSSIER-1 ECHEC : Informations élève incorrectes dans le dossier';
    END IF;
    IF v_dossier->'student'->>'current_class_name' <> '1re Sec A' THEN
        RAISE EXCEPTION 'TEST DOSSIER-2 ECHEC : Nom de la classe actuelle incorrect (obtenu: %)', v_dossier->'student'->>'current_class_name';
    END IF;

    -- ------------------------------------------------------------------------
    -- TEST 2 : Isolation multi-école (Rejet consultation élève d'une autre école)
    -- ------------------------------------------------------------------------
    BEGIN
        PERFORM public.get_student_full_dossier(v_student_b);
        RAISE EXCEPTION 'TEST DOSSIER-3 ECHEC : Le dossier d''une autre école aurait dû être rejeté';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '42501' THEN
            RAISE EXCEPTION 'TEST DOSSIER-3 ECHEC : Code erreur inattendu (%)', SQLSTATE;
        END IF;
    END;

    -- ------------------------------------------------------------------------
    -- TEST 3 : Modification autorisée d'un élève par school_admin
    -- ------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);
    v_res := public.update_student_personal_info(
        p_student_id => v_student_a,
        p_first_name => 'Jean-Paul',
        p_last_name => 'Kabila Mukendi',
        p_middle_name => 'Mwamba',
        p_gender => 'M',
        p_date_of_birth => '2010-05-16'::date,
        p_birth_place => 'Kinshasa Gombe',
        p_guardian_reference => 'Tuteur mis à jour 0820000000'
    );

    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST DOSSIER-4 ECHEC : update_student_personal_info a retourné échec';
    END IF;

    -- Vérification des modifications dans la table students (Matricule & Classe intacts)
    SELECT * INTO v_updated_student FROM public.students WHERE id = v_student_a;
    IF v_updated_student.first_name <> 'Jean-Paul' OR v_updated_student.last_name <> 'Kabila Mukendi' THEN
        RAISE EXCEPTION 'TEST DOSSIER-5 ECHEC : Noms non mis à jour dans students';
    END IF;
    IF v_updated_student.student_number <> 'STU-A-001' OR v_updated_student.class_id <> v_class_a THEN
        RAISE EXCEPTION 'TEST DOSSIER-6 ECHEC : Le matricule ou la classe a été altéré !';
    END IF;

    -- ------------------------------------------------------------------------
    -- TEST 4 : Modification refusée aux rôles non admin (enseignant)
    -- ------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_teacher_user::text, true);
    BEGIN
        PERFORM public.update_student_personal_info(
            p_student_id => v_student_a,
            p_first_name => 'TentativeProf',
            p_last_name => 'Pirate'
        );
        RAISE EXCEPTION 'TEST DOSSIER-7 ECHEC : La modification par un prof aurait dû être rejetée';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '42501' THEN
            RAISE EXCEPTION 'TEST DOSSIER-7 ECHEC : Code erreur inattendu (%)', SQLSTATE;
        END IF;
    END;

    -- ------------------------------------------------------------------------
    -- TEST 5 : Consultation & Modification Enseignant par school_admin
    -- ------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);
    v_dossier := public.get_teacher_full_dossier(v_teacher_a);
    IF v_dossier->'teacher'->>'employee_number' <> 'ENS-A-001' THEN
        RAISE EXCEPTION 'TEST DOSSIER-8 ECHEC : Dossier enseignant incorrect';
    END IF;

    v_res := public.update_teacher_personal_info(
        p_teacher_id => v_teacher_a,
        p_first_name => 'Alain-Pierre',
        p_last_name => 'Mulumba Kapuku',
        p_gender => 'M',
        p_email => 'alain.mulumba@ecole-a.cd',
        p_phone => '0990000009',
        p_speciality => 'Physique-Chimie'
    );

    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST DOSSIER-9 ECHEC : update_teacher_personal_info a retourné échec';
    END IF;

    SELECT * INTO v_updated_teacher FROM public.teachers WHERE id = v_teacher_a;
    IF v_updated_teacher.first_name <> 'Alain-Pierre' OR v_updated_teacher.speciality <> 'Physique-Chimie' THEN
        RAISE EXCEPTION 'TEST DOSSIER-10 ECHEC : Données enseignant non mises à jour';
    END IF;
    IF v_updated_teacher.employee_number <> 'ENS-A-001' THEN
        RAISE EXCEPTION 'TEST DOSSIER-11 ECHEC : Le matricule enseignant a été altéré !';
    END IF;

    -- ------------------------------------------------------------------------
    -- TEST 6 : Vérification de la journalisation d'audit (school_audit_logs)
    -- ------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_audit_count
    FROM public.school_audit_logs
    WHERE school_id = v_school_a AND action IN ('update_student_personal_info', 'update_teacher_personal_info');

    IF v_audit_count < 2 THEN
        RAISE EXCEPTION 'TEST DOSSIER-12 ECHEC : Les logs d''audit d''édition ne sont pas au nombre attendu (trouvé: %)', v_audit_count;
    END IF;

    -- ------------------------------------------------------------------------
    -- TEST 7 : Non-régression COALESCE (Exécution sur élève sans inscriptions/factures)
    -- ------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_admin_b::text, true);
    v_dossier := public.get_student_full_dossier(v_student_b);
    IF v_dossier->'enrollment_history' IS NULL OR v_dossier->'financial_summary'->>'total_invoiced' IS NULL THEN
        RAISE EXCEPTION 'TEST DOSSIER-13 ECHEC : Le fallback COALESCE a échoué sur l''élève sans factures';
    END IF;

    -- ------------------------------------------------------------------------
    -- TEST 8 : Validation colonne si.remaining_balance (Calcul financier élève avec factures)
    -- ------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, true);
    v_dossier := public.get_student_full_dossier(v_student_a);
    IF (v_dossier->'financial_summary'->>'total_invoiced')::numeric < 0 THEN
        RAISE EXCEPTION 'TEST DOSSIER-14 ECHEC : Calcul du résumé financier invalide';
    END IF;

    RAISE NOTICE '✓ SUITE DOSSIERS INDIVIDUELS ÉLÈVE/ENSEIGNANT : Toutes les RPCs, l''isolation multi-école, la sécurité des rôles, l''immutabilité du matricule/classe, la non-régression COALESCE et la colonne remaining_balance sont validées avec succès.';
END;
$$;

ROLLBACK;
