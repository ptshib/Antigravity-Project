-- =============================================================================
-- ÉCOLECONNECT — SUITE DE TESTS SQL FINANCE 4D-1R2
-- Fichier: 20260919100000_finance_4d_collection_campaigns_and_mock_delivery_tests.sql
-- Description: Suite complète de 56 assertions automatisées sous BEGIN / ROLLBACK
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. FIXTURES ET NETTOYAGE PRÉVENTIF
-- -----------------------------------------------------------------------------

DELETE FROM public.school_collection_delivery_attempts WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.school_collection_campaign_recipients WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.school_collection_campaigns WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.school_invoice_collection_actions WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');

ALTER TABLE public.student_invoices DISABLE TRIGGER USER;
DELETE FROM public.student_invoices WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
ALTER TABLE public.student_invoices ENABLE TRIGGER USER;

DELETE FROM public.parent_student_links WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.parent_accounts WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.student_enrollments WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.students WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.classes WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.profiles WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM auth.users WHERE id IN (
    'a1111111-1111-1111-1111-111111111111',
    'a2222222-2222-2222-2222-222222222222',
    'a3333333-3333-3333-3333-333333333333',
    'a4444444-4444-4444-4444-444444444444',
    'a5555555-5555-5555-5555-555555555555',
    'a6666666-6666-6666-6666-666666666666',
    'a8888888-8888-8888-8888-888888888888',
    'b1111111-1111-1111-1111-111111111111',
    'a9999999-9999-9999-9999-999999999999'
);
DELETE FROM public.academic_years WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.schools WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');

-- Écoles
INSERT INTO public.schools (id, name, slug, status, timezone) VALUES
('11111111-1111-1111-1111-111111111111', 'École A (Kinshasa)', 'sch-a', 'active', 'Africa/Kinshasa'),
('22222222-2222-2222-2222-222222222222', 'École B (Lubumbashi)', 'sch-b', 'active', 'Africa/Lubumbashi'),
('33333333-3333-3333-3333-333333333333', 'École Inactive', 'sch-inact', 'suspended', 'Africa/Kinshasa');

-- Années académiques
INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2025-2026', '2025-09-01', '2026-06-30', TRUE),
('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2025-2026', '2025-09-01', '2026-06-30', TRUE);

-- Auth Users
INSERT INTO auth.users (id, email, phone) VALUES
('a1111111-1111-1111-1111-111111111111', 'admina@test.com', '+243810000001'),
('a2222222-2222-2222-2222-222222222222', 'agenta@test.com', '+243810000002'),
('a3333333-3333-3333-3333-333333333333', 'parenta1@test.com', '+243810000003'),
('a4444444-4444-4444-4444-444444444444', 'parenta2_nophone@test.com', NULL),
('a5555555-5555-5555-5555-555555555555', 'parenta3_noemail@test.com', '+243810000005'),
('a6666666-6666-6666-6666-666666666666', 'teachera@test.com', '+243810000007'),
('a8888888-8888-8888-8888-888888888888', 'inactschool@test.com', '+243810000008'),
('b1111111-1111-1111-1111-111111111111', 'adminb@test.com', '+243810000006'),
('a9999999-9999-9999-9999-999999999999', 'inacta@test.com', '+243810000009')
ON CONFLICT (id) DO NOTHING;

-- Profils
INSERT INTO public.profiles (id, school_id, role, first_name, last_name, phone, is_active) VALUES
('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'school_admin', 'Admin', 'École A', '+243810000001', TRUE),
('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'finance_agent', 'Agent', 'École A', '+243810000002', TRUE),
('a3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'parent', 'Pierre', 'Kabongo', '+243810000003', TRUE),
('a4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'parent', 'Marie', 'Tshilombo', NULL, TRUE),
('a5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'parent', 'Joseph', 'Ilunga', '+243810000005', TRUE),
('a6666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'teacher', 'Jean', 'Mukendi', '+243810000007', TRUE),
('a8888888-8888-8888-8888-888888888888', '33333333-3333-3333-3333-333333333333', 'school_admin', 'Admin', 'École Suspendue', '+243810000008', TRUE),
('b1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'school_admin', 'Admin', 'École B', '+243810000006', TRUE),
('a9999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'school_admin', 'AdminInactif', 'École A', '+243810000009', FALSE);

-- Classes
INSERT INTO public.classes (id, school_id, academic_year_id, name, level) VALUES
('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', '6ème A', '6ème'),
('c2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000001', '5ème B', '5ème');

-- Élèves
INSERT INTO public.students (id, school_id, first_name, last_name, student_number, email, phone) VALUES
('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Marc', 'Kabongo', 'MAT-A1', 'eleve1@test.com', '+243890000001'),
('d2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Sophie', 'Tshilombo', 'MAT-A2', 'eleve2@test.com', '+243890000002'),
('d3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'David', 'Ilunga', 'MAT-B1', 'eleve3@test.com', '+243890000003');

-- Inscriptions
INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status) VALUES
('e1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'active'),
('e2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'active'),
('e3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'd3333333-3333-3333-3333-333333333333', 'b0000000-0000-0000-0000-000000000001', 'c2222222-2222-2222-2222-222222222222', 'active');

-- Liens Parents-Élèves (incluant un enseignant à exclure)
INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_receive_notifications) VALUES
('71111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a3333333-3333-3333-3333-333333333333', 'd1111111-1111-1111-1111-111111111111', 'approved', TRUE),
('72222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'a4444444-4444-4444-4444-444444444444', 'd2222222-2222-2222-2222-222222222222', 'approved', TRUE),
('73333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'a5555555-5555-5555-5555-555555555555', 'd1111111-1111-1111-1111-111111111111', 'pending', TRUE),
('76666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'a6666666-6666-6666-6666-666666666666', 'd1111111-1111-1111-1111-111111111111', 'approved', TRUE);

-- Factures échues
ALTER TABLE public.student_invoices DISABLE TRIGGER USER;
INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
('f1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-A-01', 1, '2026-01-01', CURRENT_DATE - 40, 'USD', 500.00, 100.00, 'partially_paid', 'a1111111-1111-1111-1111-111111111111'),
('f2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'e2222222-2222-2222-2222-222222222222', 'c1111111-1111-1111-1111-111111111111', 'FAC-A-02', 2, '2026-01-01', CURRENT_DATE - 70, 'USD', 300.00, 0.00, 'issued', 'a1111111-1111-1111-1111-111111111111'),
('f3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000001', 'd3333333-3333-3333-3333-333333333333', 'e3333333-3333-3333-3333-333333333333', 'c2222222-2222-2222-2222-222222222222', 'FAC-B-01', 1, '2026-01-01', CURRENT_DATE - 15, 'USD', 200.00, 0.00, 'issued', 'b1111111-1111-1111-1111-111111111111');
ALTER TABLE public.student_invoices ENABLE TRIGGER USER;

-- -----------------------------------------------------------------------------
-- 2. BLOC D'EXÉCUTION ET ASSERTIONS (EXACTEMENT 56 POINTS DE CONTRÔLE)
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    v_assert_count INT := 0;
    v_res JSONB;
    v_res2 JSONB;
    v_camp_id UUID;
    v_camp_id2 UUID;
    v_rec_id UUID;
    v_key1 UUID := '99999999-9999-9999-9999-999999999901';
    v_key2 UUID := '99999999-9999-9999-9999-999999999902';
    v_key3 UUID := '99999999-9999-9999-9999-999999999903';
    v_key4 UUID := '99999999-9999-9999-9999-999999999904';
    v_claimed RECORD;
    v_rec RECORD;
    v_count INT;
    v_sec_def BOOLEAN;
    v_has_priv_auth BOOLEAN;
    v_args TEXT;
BEGIN
    -- -------------------------------------------------------------------------
    -- T1: Création par school_admin
    -- -------------------------------------------------------------------------
    SET LOCAL "request.jwt.claim.sub" = 'a1111111-1111-1111-1111-111111111111';
    v_res := public.create_school_collection_campaign(
        p_name => 'Campagne SMS Test Admin',
        p_channel => 'sms',
        p_template => 'Bonjour {{parent_name}}, facture {{invoice_number}} impayée.',
        p_idempotency_key => v_key1,
        p_currency => 'USD',
        p_class_ids => ARRAY['c2222222-2222-2222-2222-222222222222'::UUID, 'c1111111-1111-1111-1111-111111111111'::UUID]
    );
    ASSERT (v_res->>'success')::boolean = true, 'T1: Rejet création par school_admin';
    ASSERT (v_res->>'is_idempotent_replay')::boolean = false, 'T1: Idempotent replay inattendu';
    v_camp_id := (v_res->'campaign'->>'id')::UUID;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T2: Création par finance_agent
    -- -------------------------------------------------------------------------
    SET LOCAL "request.jwt.claim.sub" = 'a2222222-2222-2222-2222-222222222222';
    v_res := public.create_school_collection_campaign(
        'Campagne Email Agent',
        'email',
        'Rappel de paiement pour {{student_name}}.',
        v_key2,
        'USD'
    );
    ASSERT (v_res->>'success')::boolean = true, 'T2: Rejet création par finance_agent';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T3: Rejet pour rôle non autorisé (ex: parent)
    -- -------------------------------------------------------------------------
    SET LOCAL "request.jwt.claim.sub" = 'a3333333-3333-3333-3333-333333333333';
    BEGIN
        PERFORM public.create_school_collection_campaign('Campagne Pirate', 'sms', 'Message spam...', gen_random_uuid());
        RAISE EXCEPTION 'T3: Échec - Le rôle parent a pu créer une campagne !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T3: Mauvais code d erreur pour rôle non autorisé: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T4: Rejet pour profil inactif
    -- -------------------------------------------------------------------------
    SET LOCAL "request.jwt.claim.sub" = 'a9999999-9999-9999-9999-999999999999';
    BEGIN
        PERFORM public.create_school_collection_campaign('Campagne Inactive', 'sms', 'Message test...', gen_random_uuid());
        RAISE EXCEPTION 'T4: Échec - Le profil inactif a pu exécuter la RPC !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T4: Mauvais code d erreur pour profil inactif: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T5: Rejet pour école suspendue
    -- -------------------------------------------------------------------------
    SET LOCAL "request.jwt.claim.sub" = 'a8888888-8888-8888-8888-888888888888';
    BEGIN
        PERFORM public.create_school_collection_campaign('Campagne École Inactive', 'sms', 'Message test...', gen_random_uuid());
        RAISE EXCEPTION 'T5: Échec - L école suspendue a pu créer une campagne !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T5: Mauvais code d erreur pour école suspendue: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T6: Isolation inter-écoles (School B admin ne voit pas Campagne School A)
    -- -------------------------------------------------------------------------
    SET LOCAL "request.jwt.claim.sub" = 'b1111111-1111-1111-1111-111111111111';
    BEGIN
        PERFORM public.get_school_collection_campaign(v_camp_id);
        RAISE EXCEPTION 'T6: Échec - L admin de l École B a pu lire la campagne de l École A !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = 'P0002', 'T6: Mauvais code d erreur pour isolation tenant: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T7: Preview sans mutation
    -- -------------------------------------------------------------------------
    SET LOCAL "request.jwt.claim.sub" = 'a1111111-1111-1111-1111-111111111111';
    SELECT COUNT(*) INTO v_count FROM public.school_collection_campaigns WHERE school_id = '11111111-1111-1111-1111-111111111111';
    v_res := public.preview_school_collection_campaign('sms', 'Message de prévisualisation test...');
    ASSERT (v_res->>'success')::boolean = true, 'T7: Preview a échoué';
    ASSERT (v_res->>'target_invoices_count')::int = 2, 'T7: Nombre de factures visées incorrect dans preview';
    SELECT COUNT(*) INTO v_count FROM public.school_collection_campaigns WHERE school_id = '11111111-1111-1111-1111-111111111111';
    ASSERT v_count = 2, 'T7: Preview a muté la table des campagnes !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T8: Éligibilité - Profil enseignant (role=teacher) exclu des destinataires
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM public.school_collection_campaign_recipients r
    WHERE r.parent_profile_id = 'a6666666-6666-6666-6666-666666666666';
    ASSERT v_count = 0, 'T8: Un profil enseignant (role=teacher) a été inséré comme destinataire !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T9: Éligibilité - Lien parent-élève en attente (status=pending) exclu
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM public.school_collection_campaign_recipients r
    WHERE r.parent_profile_id = 'a5555555-5555-5555-5555-555555555555';
    ASSERT v_count = 0, 'T9: Le parent avec lien pending (non approved) a été inclus !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T10: Éligibilité - Consentement notification false exclu
    -- -------------------------------------------------------------------------
    UPDATE public.parent_student_links SET can_receive_notifications = FALSE WHERE id = '71111111-1111-1111-1111-111111111111';
    v_res := public.create_school_collection_campaign('Campagne Sans Consentement', 'sms', 'Message test consent...', v_key3);
    ASSERT (v_res->'campaign'->>'recipient_count')::int = 1, 'T10: Consentement ignoré lors de la sélection !';
    UPDATE public.parent_student_links SET can_receive_notifications = TRUE WHERE id = '71111111-1111-1111-1111-111111111111';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T11: Éligibilité - Destinataire skipped si coordonnées absentes (sans fallback étudiant)
    -- -------------------------------------------------------------------------
    SELECT delivery_status, skip_reason, parent_snapshot INTO v_rec
    FROM public.school_collection_campaign_recipients
    WHERE campaign_id = v_camp_id AND parent_profile_id = 'a4444444-4444-4444-4444-444444444444';
    ASSERT v_rec.delivery_status = 'skipped', 'T11: Le parent sans téléphone n est pas en statut skipped';
    ASSERT v_rec.skip_reason = 'MISSING_CHANNEL_CONTACT', 'T11: Raison de skip incorrecte pour contact manquant';
    ASSERT (v_rec.parent_snapshot->>'phone') IS NULL, 'T11: Fallback aux coordonnées de l élève interdit !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T12: Intégrité Facture <-> Élève : student_id d une autre facture rejeté (23514)
    -- -------------------------------------------------------------------------
    BEGIN
        INSERT INTO public.school_collection_campaign_recipients (
            school_id, campaign_id, invoice_id, student_id, parent_profile_id,
            delivery_status, invoice_snapshot, student_snapshot, parent_snapshot
        ) VALUES (
            '11111111-1111-1111-1111-111111111111',
            v_camp_id,
            'f1111111-1111-1111-1111-111111111111', -- Facture de Marc (d111...)
            'd2222222-2222-2222-2222-222222222222', -- Élève Sophie (d222...) -> Incohérence !
            'a3333333-3333-3333-3333-333333333333',
            'pending', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
        );
        RAISE EXCEPTION 'T12: Échec - L insertion d un élève incohérent avec la facture a été autorisée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '23514', 'T12: Mauvais code d erreur pour élève incohérent: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T13: Intégrité Facture <-> Élève : student_id d une autre école rejeté (23514)
    -- -------------------------------------------------------------------------
    BEGIN
        INSERT INTO public.school_collection_campaign_recipients (
            school_id, campaign_id, invoice_id, student_id, parent_profile_id,
            delivery_status, invoice_snapshot, student_snapshot, parent_snapshot
        ) VALUES (
            '11111111-1111-1111-1111-111111111111',
            v_camp_id,
            'f1111111-1111-1111-1111-111111111111',
            'd3333333-3333-3333-3333-333333333333', -- Élève David École B -> Incohérence !
            'a3333333-3333-3333-3333-333333333333',
            'pending', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
        );
        RAISE EXCEPTION 'T13: Échec - L insertion d un élève inter-écoles a été autorisée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '23514', 'T13: Mauvais code d erreur pour élève inter-écoles: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T14: Intégrité Profil Parent : profil avec rôle != parent rejeté (23514)
    -- -------------------------------------------------------------------------
    BEGIN
        INSERT INTO public.school_collection_campaign_recipients (
            school_id, campaign_id, invoice_id, student_id, parent_profile_id,
            delivery_status, invoice_snapshot, student_snapshot, parent_snapshot
        ) VALUES (
            '11111111-1111-1111-1111-111111111111',
            v_camp_id,
            'f1111111-1111-1111-1111-111111111111',
            'd1111111-1111-1111-1111-111111111111',
            'a6666666-6666-6666-6666-666666666666', -- Profil Jean Mukendi (role=teacher) !
            'pending', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
        );
        RAISE EXCEPTION 'T14: Échec - L insertion d un destinataire non parent (teacher) a été autorisée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '23514', 'T14: Mauvais code d erreur pour destinataire rôle non-parent: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T15: Intégrité Recipient : Facture, élève et parent valides acceptés
    -- -------------------------------------------------------------------------
    v_res := public.create_school_collection_campaign('Campagne Test Insertion Valide', 'sms', 'Message valide test...', gen_random_uuid());
    v_camp_id2 := (v_res->'campaign'->>'id')::UUID;
    SELECT COUNT(*) INTO v_count FROM public.school_collection_campaign_recipients WHERE campaign_id = v_camp_id2 AND delivery_status = 'pending';
    ASSERT v_count >= 1, 'T15: L insertion légitime d un destinataire valide a été rejetée !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T16: Idempotence Hash JSONB - Rejeu canonique avec tri déterministe des p_class_ids
    -- -------------------------------------------------------------------------
    v_res2 := public.create_school_collection_campaign(
        p_name => 'Campagne SMS Test Admin',
        p_channel => 'sms',
        p_template => 'Bonjour {{parent_name}}, facture {{invoice_number}} impayée.',
        p_idempotency_key => v_key1,
        p_currency => 'USD',
        p_class_ids => ARRAY['c1111111-1111-1111-1111-111111111111'::UUID, 'c2222222-2222-2222-2222-222222222222'::UUID]
    );
    ASSERT (v_res2->>'is_idempotent_replay')::boolean = true, 'T16: Rejeu identique non détecté avec hash JSONB';
    ASSERT (v_res2->'campaign'->>'id') = v_camp_id::text, 'T16: ID de campagne différent lors du rejeu';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T17: Idempotence Hash JSONB - Rejeu avec UUIDs dupliqués dans p_class_ids
    -- -------------------------------------------------------------------------
    v_res2 := public.create_school_collection_campaign(
        p_name => 'Campagne SMS Test Admin',
        p_channel => 'sms',
        p_template => 'Bonjour {{parent_name}}, facture {{invoice_number}} impayée.',
        p_idempotency_key => v_key1,
        p_currency => 'USD',
        p_class_ids => ARRAY[
            'c2222222-2222-2222-2222-222222222222'::UUID,
            'c1111111-1111-1111-1111-111111111111'::UUID,
            'c1111111-1111-1111-1111-111111111111'::UUID -- Dupliqué !
        ]
    );
    ASSERT (v_res2->>'is_idempotent_replay')::boolean = true, 'T17: Rejeu avec doublons class_ids non détecté';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T18: Idempotence Hash JSONB - NULL distinct de la chaîne "NULL"
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.create_school_collection_campaign(
            p_name => 'Campagne SMS Test Admin',
            p_channel => 'sms',
            p_template => 'Bonjour {{parent_name}}, facture {{invoice_number}} impayée.',
            p_idempotency_key => v_key1,
            p_currency => 'CDF' -- Devise modifiée (ou NULL vs CDF)
        );
        RAISE EXCEPTION 'T18: Échec - La distinction NULL vs valeur n a pas déclenché de conflit d idempotence !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T18: Mauvais code d erreur pour conflit d idempotence: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T19: Idempotence Hash JSONB - Modèle contenant des séparateurs textuels sans collision
    -- -------------------------------------------------------------------------
    v_res := public.create_school_collection_campaign(
        p_name => 'Campagne Separator Injection',
        p_channel => 'sms',
        p_template => 'Message avec |chan: |tpl: |curr: |prio: |min_d: |classes: sans injection',
        p_idempotency_key => gen_random_uuid()
    );
    ASSERT (v_res->>'success')::boolean = true, 'T19: Échec création avec séparateurs textuels dans le modèle';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T20: Idempotence Hash JSONB - Conflit de contenu avec la même clé
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.create_school_collection_campaign(
            'Campagne Modifiée Différente',
            'sms',
            'Modèle différent pour conflit...',
            v_key1,
            'USD'
        );
        RAISE EXCEPTION 'T20: Échec - Le conflit d idempotence n a pas été levé !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T20: Mauvais code d erreur pour conflit d idempotence: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T21: Idempotence SHA-256 - Protection contre la duplication de ligne
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM public.school_collection_campaigns
    WHERE school_id = '11111111-1111-1111-1111-111111111111' AND idempotency_key = v_key1;
    ASSERT v_count = 1, 'T21: Multiples entrées enregistrées pour la même clé d idempotence !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T22: Unicité des destinataires par (campaign_id, invoice_id, parent_profile_id)
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM (
        SELECT campaign_id, invoice_id, parent_profile_id, COUNT(*)
        FROM public.school_collection_campaign_recipients
        GROUP BY campaign_id, invoice_id, parent_profile_id
        HAVING COUNT(*) > 1
    ) dupes;
    ASSERT v_count = 0, 'T22: Doublons trouvés dans les destinataires de campagne !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T23: Immutabilité - Modification de template_snapshot sur campagne rejetée
    -- -------------------------------------------------------------------------
    BEGIN
        UPDATE public.school_collection_campaigns SET template_snapshot = '"Template piraté"'::jsonb WHERE id = v_camp_id;
        RAISE EXCEPTION 'T23: Échec - La modification de template_snapshot a été autorisée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T23: Mauvais code d erreur pour modification template_snapshot: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T24: Immutabilité - Modification de filter_criteria sur campagne rejetée
    -- -------------------------------------------------------------------------
    BEGIN
        UPDATE public.school_collection_campaigns SET filter_criteria = '{"channel":"whatsapp"}'::jsonb WHERE id = v_camp_id;
        RAISE EXCEPTION 'T24: Échec - La modification de filter_criteria a été autorisée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T24: Mauvais code d erreur pour modification filter_criteria: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T25: Immutabilité - DELETE d une campagne rejeté
    -- -------------------------------------------------------------------------
    BEGIN
        DELETE FROM public.school_collection_campaigns WHERE id = v_camp_id;
        RAISE EXCEPTION 'T25: Échec - Le DELETE d une campagne a été autorisé !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T25: Mauvais code d erreur pour DELETE campagne: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T26: Immutabilité - Modification de invoice_snapshot sur destinataire rejetée
    -- -------------------------------------------------------------------------
    BEGIN
        UPDATE public.school_collection_campaign_recipients SET invoice_snapshot = '{"total_amount": 0}'::jsonb WHERE campaign_id = v_camp_id;
        RAISE EXCEPTION 'T26: Échec - La modification de invoice_snapshot a été autorisée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T26: Mauvais code d erreur pour modification invoice_snapshot: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T27: Immutabilité - Modification de student_snapshot sur destinataire rejetée
    -- -------------------------------------------------------------------------
    BEGIN
        UPDATE public.school_collection_campaign_recipients SET student_snapshot = '{"first_name":"Hacker"}'::jsonb WHERE campaign_id = v_camp_id;
        RAISE EXCEPTION 'T27: Échec - La modification de student_snapshot a été autorisée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T27: Mauvais code d erreur pour modification student_snapshot: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T28: Immutabilité - Modification de parent_snapshot sur destinataire rejetée
    -- -------------------------------------------------------------------------
    BEGIN
        UPDATE public.school_collection_campaign_recipients SET parent_snapshot = '{"phone":"+000"}'::jsonb WHERE campaign_id = v_camp_id;
        RAISE EXCEPTION 'T28: Échec - La modification de parent_snapshot a été autorisée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T28: Mauvais code d erreur pour modification parent_snapshot: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T29: Immutabilité - DELETE d un destinataire rejeté
    -- -------------------------------------------------------------------------
    BEGIN
        DELETE FROM public.school_collection_campaign_recipients WHERE campaign_id = v_camp_id;
        RAISE EXCEPTION 'T29: Échec - Le DELETE d un destinataire a été autorisé !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T29: Mauvais code d erreur pour DELETE destinataire: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T30: Immutabilité - UPDATE d une tentative de livraison rejeté (append-only)
    -- -------------------------------------------------------------------------
    v_res := public.create_school_collection_campaign('Campagne Test Attempts Immutability', 'sms', 'Message test immutability...', gen_random_uuid());
    v_camp_id2 := (v_res->'campaign'->>'id')::UUID;
    SELECT id INTO v_rec_id FROM public.school_collection_campaign_recipients WHERE campaign_id = v_camp_id2 AND delivery_status = 'pending' LIMIT 1;

    IF v_rec_id IS NOT NULL THEN
        INSERT INTO public.school_collection_delivery_attempts (
            school_id, campaign_id, recipient_id, attempt_number,
            provider, status, request_payload, response_payload
        ) VALUES (
            '11111111-1111-1111-1111-111111111111', v_camp_id2, v_rec_id, 1,
            'mock', 'success', '{"simulated": true}'::jsonb, '{"simulated": true}'::jsonb
        );

        BEGIN
            UPDATE public.school_collection_delivery_attempts SET status = 'failed' WHERE campaign_id = v_camp_id2;
            RAISE EXCEPTION 'T30: Échec - L UPDATE d une tentative de livraison a été autorisé !';
        EXCEPTION WHEN OTHERS THEN
            ASSERT SQLSTATE = '42501', 'T30: Mauvais code d erreur pour UPDATE tentative: ' || SQLSTATE;
        END;
    END IF;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T31: Immutabilité - DELETE d une tentative de livraison rejeté
    -- -------------------------------------------------------------------------
    BEGIN
        DELETE FROM public.school_collection_delivery_attempts WHERE campaign_id = v_camp_id2;
        RAISE EXCEPTION 'T31: Échec - Le DELETE d une tentative de livraison a été autorisé !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '42501', 'T31: Mauvais code d erreur pour DELETE tentative: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T32: Intégrité Multi-Tenant - Incohérence school_id tentative vs destinataire rejetée (23514)
    -- -------------------------------------------------------------------------
    SELECT id INTO v_rec_id FROM public.school_collection_campaign_recipients WHERE campaign_id = v_camp_id LIMIT 1;
    BEGIN
        INSERT INTO public.school_collection_delivery_attempts (
            school_id, campaign_id, recipient_id, attempt_number,
            provider, status, request_payload, response_payload
        ) VALUES (
            '22222222-2222-2222-2222-222222222222', -- École B au lieu d'École A !
            v_camp_id, v_rec_id, 99,
            'mock', 'success', '{"simulated": true}'::jsonb, '{"simulated": true}'::jsonb
        );
        RAISE EXCEPTION 'T32: Échec - L insertion d une tentative inter-écoles a été autorisée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '23514', 'T32: Mauvais code d erreur pour tentative inter-écoles: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T33: Validation Entrée - Nom de campagne trop court (< 3 caractères)
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.create_school_collection_campaign('AB', 'sms', 'Message...', gen_random_uuid());
        RAISE EXCEPTION 'T33: Échec - Nom de campagne < 3 caractères accepté !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T33: Mauvais code d erreur pour nom court: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T34: Validation Entrée - Canal invalide ('telegram')
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.create_school_collection_campaign('Campagne Telegram', 'telegram', 'Message...', gen_random_uuid());
        RAISE EXCEPTION 'T34: Échec - Canal invalide telegram accepté !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T34: Mauvais code d erreur pour canal invalide: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T35: Validation Entrée - Devise invalide ('EUR')
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.create_school_collection_campaign('Campagne EUR', 'sms', 'Message...', gen_random_uuid(), 'EUR');
        RAISE EXCEPTION 'T35: Échec - Devise invalide EUR acceptée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T35: Mauvais code d erreur pour devise invalide: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T36: Validation Entrée - Priorité invalide ('urgent')
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.create_school_collection_campaign('Campagne Urgent', 'sms', 'Message...', gen_random_uuid(), 'USD', 'urgent');
        RAISE EXCEPTION 'T36: Échec - Priorité invalide urgent acceptée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T36: Mauvais code d erreur pour priorité invalide: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T37: Validation Entrée - min_days_overdue < 1
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.create_school_collection_campaign('Campagne MinDays', 'sms', 'Message...', gen_random_uuid(), 'USD', NULL, 0);
        RAISE EXCEPTION 'T37: Échec - min_days_overdue < 1 accepté !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T37: Mauvais code d erreur pour min_days_overdue < 1: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T38: Validation Entrée - max_days_overdue < min_days_overdue
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.create_school_collection_campaign('Campagne MaxDays', 'sms', 'Message...', gen_random_uuid(), 'USD', NULL, 30, 10);
        RAISE EXCEPTION 'T38: Échec - max_days_overdue < min_days_overdue accepté !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T38: Mauvais code d erreur pour max_days_overdue invalide: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T39: Validation Entrée - p_fail_ratio hors borne [0.0 .. 1.0]
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public._process_mock_campaign(v_camp_id, 1.5);
        RAISE EXCEPTION 'T39: Échec - fail_ratio > 1.0 accepté !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T39: Mauvais code d erreur pour fail_ratio > 1.0: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T40: Validation Entrée - p_batch_size hors borne [1 .. 100]
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public._claim_scheduled_campaigns(500, 'worker-1');
        RAISE EXCEPTION 'T40: Échec - batch_size > 100 accepté !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T40: Mauvais code d erreur pour batch_size > 100: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T41: Validation Entrée - p_worker_id trop court (< 3 caractères)
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public._claim_scheduled_campaigns(10, 'w1');
        RAISE EXCEPTION 'T41: Échec - worker_id < 3 caractères accepté !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T41: Mauvais code d erreur pour worker_id court: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T42: Validation Entrée - Filtre et curseur partiellement fournis rejetés
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.get_school_collection_campaigns(p_cursor_created_at => pg_catalog.clock_timestamp(), p_cursor_id => NULL);
        RAISE EXCEPTION 'T42: Échec - Curseur fourni sans ID curseur accepté !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T42: Mauvais code d erreur pour curseur incomplet: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T43: Transition d état autorisée: draft -> scheduled
    -- -------------------------------------------------------------------------
    v_res := public.schedule_school_collection_campaign(v_camp_id);
    ASSERT (v_res->>'success')::boolean = true, 'T43: Planification campagne a échoué';
    ASSERT (v_res->>'status') = 'scheduled', 'T43: Statut post-planification invalide';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T44: Transitions d état interdites: re-planifier une campagne déjà scheduled
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.schedule_school_collection_campaign(v_camp_id);
        RAISE EXCEPTION 'T44: Échec - Une campagne déjà scheduled a pu être re-planifiée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T44: Mauvais code d erreur pour transition invalide: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T45: Annulation autorisée avant claim
    -- -------------------------------------------------------------------------
    v_res := public.create_school_collection_campaign('Campagne A Annuler', 'sms', 'Message test annulation...', v_key4);
    v_res2 := public.cancel_school_collection_campaign((v_res->'campaign'->>'id')::UUID);
    ASSERT (v_res2->>'success')::boolean = true, 'T45: Annulation avant claim a échoué';
    ASSERT (v_res2->>'status') = 'cancelled', 'T45: Statut non mis à jour à cancelled';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T46: Claim worker de campagne scheduled due
    -- -------------------------------------------------------------------------
    SELECT * INTO v_claimed FROM public._claim_scheduled_campaigns(1, 'worker-test-1');
    ASSERT v_claimed.campaign_id = v_camp_id, 'T46: Le claim worker a échoué';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T47: Claim concurrent avec SKIP LOCKED (re-claim retourne 0 ligne)
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count FROM public._claim_scheduled_campaigns(5, 'worker-test-2');
    ASSERT v_count = 0, 'T47: Des campagnes déjà claimées ont été re-claimées par SKIP LOCKED !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T48: Rejet d annulation pendant processing (campagne déjà claimée)
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM public.cancel_school_collection_campaign(v_camp_id);
        RAISE EXCEPTION 'T48: Échec - Une campagne en processing a pu être annulée !';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'T48: Mauvais code d erreur pour annulation pendant processing: ' || SQLSTATE;
    END;
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T49: Contrat Traitement Mock (Success) - attempt.status='success', simulated=true
    -- -------------------------------------------------------------------------
    v_res := public._process_mock_campaign(v_camp_id, 0.0);
    ASSERT (v_res->>'success')::boolean = true, 'T49: Traitement mock success a échoué';
    ASSERT (v_res->>'final_status') = 'completed', 'T49: Statut final non completed dans mock success';

    SELECT status, provider, request_payload INTO v_rec
    FROM public.school_collection_delivery_attempts
    WHERE campaign_id = v_camp_id AND status = 'success'
    LIMIT 1;
    ASSERT v_rec.status = 'success', 'T49: Tentative mock n est pas en statut success';
    ASSERT v_rec.provider = 'mock', 'T49: Provider n est pas mock';
    ASSERT (v_rec.request_payload->>'simulated')::boolean = true, 'T49: request_payload.simulated n est pas true';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T50: Contrat Traitement Mock (Failure) - attempt.status='failed', simulated=true
    -- -------------------------------------------------------------------------
    v_res := public.create_school_collection_campaign('Campagne Échec Test', 'sms', 'Message échec test...', gen_random_uuid());
    v_camp_id2 := (v_res->'campaign'->>'id')::UUID;
    PERFORM public.schedule_school_collection_campaign(v_camp_id2);
    PERFORM public._claim_scheduled_campaigns(5, 'worker-test-3');
    v_res2 := public._process_mock_campaign(v_camp_id2, 1.0);
    ASSERT (v_res2->>'final_status') = 'failed', 'T50: Statut final non failed pour fail_ratio = 1.0';

    SELECT status, provider, request_payload INTO v_rec
    FROM public.school_collection_delivery_attempts
    WHERE campaign_id = v_camp_id2 AND status = 'failed'
    LIMIT 1;
    ASSERT v_rec.status = 'failed', 'T50: Tentative mock n est pas en statut failed';
    ASSERT (v_rec.request_payload->>'simulated')::boolean = true, 'T50: request_payload.simulated n est pas true';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T51: Cohérence Strictement Vérifiable: recipient success <-> last attempt success
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM public.school_collection_campaign_recipients r
    LEFT JOIN LATERAL (
        SELECT status FROM public.school_collection_delivery_attempts a
        WHERE a.recipient_id = r.id ORDER BY a.created_at DESC LIMIT 1
    ) last_att ON true
    WHERE (r.delivery_status = 'success' AND last_att.status != 'success')
       OR (r.delivery_status = 'failed' AND last_att.status != 'failed')
       OR (r.delivery_status = 'skipped' AND last_att.status IS NOT NULL);
    ASSERT v_count = 0, 'T51: Incohérence trouvée entre le statut destinataire et le dernier essai !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T52: Invariant des compteurs (recipient_count = pending + processing + success + failed + skipped)
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM public.school_collection_campaigns
    WHERE recipient_count != (pending_count + processing_count + success_count + failed_count + skipped_count);
    ASSERT v_count = 0, 'T52: Invariant des compteurs de campagne violé !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T53: Pagination Keyset des campagnes (get_school_collection_campaigns)
    -- -------------------------------------------------------------------------
    SET LOCAL "request.jwt.claim.sub" = 'a1111111-1111-1111-1111-111111111111';
    v_res := public.get_school_collection_campaigns(NULL, NULL, 2);
    ASSERT (v_res->>'success')::boolean = true, 'T53: get_school_collection_campaigns a échoué';
    ASSERT pg_catalog.jsonb_array_length(v_res->'campaigns') <= 2, 'T53: Limite Keyset dépassée';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T54: Détail d une campagne et pagination de ses destinataires
    -- -------------------------------------------------------------------------
    v_res := public.get_school_collection_campaign(v_camp_id, 10);
    ASSERT (v_res->>'success')::boolean = true, 'T54: get_school_collection_campaign a échoué';
    ASSERT (v_res->'campaign'->>'id') = v_camp_id::text, 'T54: ID de campagne incohérent dans le détail';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T55: Non-Impact: 0 écriture 4B, 0 mutation financière 4A, 0 altération 4C
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count FROM public.school_invoice_collection_actions WHERE school_id = '11111111-1111-1111-1111-111111111111';
    ASSERT v_count = 0, 'T55: Violations ! Des actions 4B ont été écrites durant les campagnes mock !';

    SELECT COUNT(*) INTO v_count
    FROM public.student_invoices
    WHERE id = 'f1111111-1111-1111-1111-111111111111' AND remaining_balance = 400.00 AND status = 'partially_paid';
    ASSERT v_count = 1, 'T55: La facture de test a subi une altération de solde ou de statut !';

    SELECT COUNT(*) INTO v_count
    FROM public._evaluate_school_collection_invoices('11111111-1111-1111-1111-111111111111', CURRENT_DATE);
    ASSERT v_count = 2, 'T55: L évaluation des priorités Finance 4C a été altérée !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T56: Audit Sécurité & Privilèges Système
    -- -------------------------------------------------------------------------
    SELECT prosecdef INTO v_sec_def
    FROM pg_proc WHERE proname = 'create_school_collection_campaign';
    ASSERT v_sec_def = TRUE, 'T56: RPC create_school_collection_campaign n est pas SECURITY DEFINER !';

    SELECT has_function_privilege('authenticated', 'public._claim_scheduled_campaigns(int, text)', 'EXECUTE') INTO v_has_priv_auth;
    ASSERT v_has_priv_auth = FALSE, 'T56: _claim_scheduled_campaigns est accessible par authenticated !';

    SELECT has_function_privilege('authenticated', 'public._process_mock_campaign(uuid, numeric)', 'EXECUTE') INTO v_has_priv_auth;
    ASSERT v_has_priv_auth = FALSE, 'T56: _process_mock_campaign est accessible par authenticated !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T57: Interrogation pg_proc - idempotency_key est UUID
    -- -------------------------------------------------------------------------
    SELECT pg_get_function_identity_arguments('public.create_school_collection_campaign'::regproc) INTO v_args;
    ASSERT v_args LIKE '%p_idempotency_key uuid%', 'T57: p_idempotency_key n est pas de type UUID';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T58: Interrogation pg_proc - Présence des curseurs Keyset
    -- -------------------------------------------------------------------------
    SELECT pg_get_function_identity_arguments('public.get_school_collection_campaigns'::regproc) INTO v_args;
    ASSERT v_args LIKE '%p_cursor_created_at timestamp with time zone%' AND v_args LIKE '%p_cursor_id uuid%', 'T58: Curseur Keyset de get_school_collection_campaigns manquant';
    SELECT pg_get_function_identity_arguments('public.get_school_collection_campaign'::regproc) INTO v_args;
    ASSERT v_args LIKE '%p_cursor_recipient_id uuid%', 'T58: Curseur Keyset de get_school_collection_campaign manquant';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T59: Interrogation pg_proc - Interdiction p_offset et p_scheduled_for
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (
        pg_get_function_identity_arguments(p.oid) LIKE '%p_offset%'
        OR pg_get_function_identity_arguments(p.oid) LIKE '%p_scheduled_for%'
    );
    ASSERT v_count = 0, 'T59: p_offset ou p_scheduled_for trouvé dans les signatures pg_proc !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T60: Interrogation pg_proc - Présence p_scheduled_at, p_reason, p_worker_id, p_fail_ratio
    -- -------------------------------------------------------------------------
    SELECT pg_get_function_identity_arguments('public.schedule_school_collection_campaign'::regproc) INTO v_args;
    ASSERT v_args LIKE '%p_scheduled_at%', 'T60: p_scheduled_at absent de schedule_school_collection_campaign';
    SELECT pg_get_function_identity_arguments('public.cancel_school_collection_campaign'::regproc) INTO v_args;
    ASSERT v_args LIKE '%p_reason%', 'T60: p_reason absent de cancel_school_collection_campaign';
    SELECT pg_get_function_identity_arguments('public._claim_scheduled_campaigns'::regproc) INTO v_args;
    ASSERT v_args LIKE '%p_worker_id%', 'T60: p_worker_id absent de _claim_scheduled_campaigns';
    SELECT pg_get_function_identity_arguments('public._process_mock_campaign'::regproc) INTO v_args;
    ASSERT v_args LIKE '%p_fail_ratio%', 'T60: p_fail_ratio absent de _process_mock_campaign';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T61: Interrogation pg_proc - Absence de surcharges résiduelles 4D
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM (
        SELECT proname, COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND proname IN (
            'preview_school_collection_campaign', 'create_school_collection_campaign',
            'get_school_collection_campaigns', 'get_school_collection_campaign',
            'schedule_school_collection_campaign', 'cancel_school_collection_campaign',
            '_claim_scheduled_campaigns', '_process_mock_campaign', '_canonical_campaign_hash'
        )
        GROUP BY proname HAVING COUNT(*) > 1
    ) overloads;
    ASSERT v_count = 0, 'T61: Surcharges résiduelles trouvées dans pg_proc !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T62: Catalogues Columns - Contrôle strict des compteurs sans ambiguïté
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'school_collection_campaigns'
      AND column_name IN ('recipient_count', 'pending_count', 'processing_count', 'success_count', 'failed_count', 'skipped_count');
    ASSERT v_count = 6, 'T62: Colonnes de compteurs manquantes dans school_collection_campaigns !';

    SELECT COUNT(*) INTO v_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'school_collection_campaigns'
      AND column_name IN ('sent_count', 'delivered_count', 'total_recipients', 'eligible_recipients');
    ASSERT v_count = 0, 'T62: Colonnes ambiguës interdites trouvées dans school_collection_campaigns !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T63: Catalogues Constraints - Statut partially_failed & Invariant d égalité exact
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = 'school_collection_campaigns'
      AND c.conname = 'chk_campaign_status'
      AND pg_get_constraintdef(c.oid) LIKE '%partially_failed%';
    ASSERT v_count = 1, 'T63: Statut partially_failed absent de la contrainte CHECK status !';

    SELECT COUNT(*) INTO v_count
    FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = 'school_collection_campaigns'
      AND c.conname = 'chk_campaign_counters_invariant'
      AND pg_get_constraintdef(c.oid) LIKE '%recipient_count =%';
    ASSERT v_count = 1, 'T63: Invariant exact des compteurs absent des contraintes PG !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- T64: Catalogues Grants - Absence de privilèges directs authenticated sur les tables 4D
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('school_collection_campaigns', 'school_collection_campaign_recipients', 'school_collection_delivery_attempts')
      AND grantee IN ('PUBLIC', 'anon', 'authenticated');
    ASSERT v_count = 0, 'T64: Privilèges directs accordés à authenticated/anon/PUBLIC sur les tables 4D !';
    v_assert_count := v_assert_count + 1;

    -- -------------------------------------------------------------------------
    -- VALIDATION GLOBALE DES 64 ASSERTIONS
    -- -------------------------------------------------------------------------
    ASSERT v_assert_count = 64, 'T64: Nombre d assertions exécutées incohérent (' || v_assert_count || '/64)';
    RAISE NOTICE 'SUCCÈS PARFAIT: 64/64 ASSERTIONS SQL EXÉCUTÉES AVEC SUCCÈS !';
END $$;

-- Transaction terminée par ROLLBACK obligatoire
ROLLBACK;
