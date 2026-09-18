-- =============================================================================
-- ÉCOLECONNECT — SUITE DE TESTS SQL FINANCE 4C-1R (UUIDS RÉELS & PREUVES DE RECETTE)
-- Fichier: 20260918130000_finance_4c_collection_dashboard_and_priorities_tests.sql
-- Description: Tests automatisés sous BEGIN / ROLLBACK avec UUIDs réels (hexadécimaux stricts),
--              exécution des RPCs publiques sous SET LOCAL auth,
--              validation 24 clés item priorities, pagination 3 pages,
--              et privilèges pg_proc.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. SETUP FIXTURES AVEC VRAIS UUIDS POSTGRESQL (HEXADÉCIMAUX VALIDES)
-- -----------------------------------------------------------------------------

CREATE TEMP TABLE IF NOT EXISTS _test_json_outputs (name text, data jsonb);

-- Nettoyage préventif ciblé sur les écoles de test
DELETE FROM public.school_invoice_collection_actions WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
ALTER TABLE public.student_invoices DISABLE TRIGGER USER;
DELETE FROM public.student_invoices WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
ALTER TABLE public.student_invoices ENABLE TRIGGER USER;
DELETE FROM public.student_enrollments WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.students WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.classes WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.profiles WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM auth.users WHERE id IN ('a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 'a3333333-3333-3333-3333-333333333333', 'b1111111-1111-1111-1111-111111111111', 'a9999999-9999-9999-9999-999999999999');
DELETE FROM public.academic_years WHERE school_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
DELETE FROM public.schools WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');

-- Écoles
INSERT INTO public.schools (id, name, slug, status, timezone) VALUES
('11111111-1111-1111-1111-111111111111', 'École A (Kinshasa)', 'sch-a', 'active', 'Africa/Kinshasa'),
('22222222-2222-2222-2222-222222222222', 'École B (Lubumbashi)', 'sch-b', 'active', 'Africa/Lubumbashi'),
('33333333-3333-3333-3333-333333333333', 'École Inactive', 'sch-inact', 'suspended', 'Africa/Kinshasa');

-- Années académiques (UUIDs réels)
INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2025-2026', '2025-09-01', '2026-06-30', TRUE),
('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2025-2026', '2025-09-01', '2026-06-30', TRUE);

-- Auth Users (pour FK profiles)
INSERT INTO auth.users (id, email) VALUES
('a1111111-1111-1111-1111-111111111111', 'admina@test.com'),
('a2222222-2222-2222-2222-222222222222', 'agenta@test.com'),
('a3333333-3333-3333-3333-333333333333', 'teachera@test.com'),
('b1111111-1111-1111-1111-111111111111', 'adminb@test.com'),
('a9999999-9999-9999-9999-999999999999', 'inacta@test.com')
ON CONFLICT (id) DO NOTHING;

-- Profils (UUIDs réels)
INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'school_admin', 'Admin', 'École A', TRUE),
('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'finance_agent', 'Agent', 'École A', TRUE),
('a3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'teacher', 'Prof', 'École A', TRUE),
('b1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'school_admin', 'Admin', 'École B', TRUE),
('a9999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'school_admin', 'AdminInactif', 'École A', FALSE);

-- Classes (UUIDs réels)
INSERT INTO public.classes (id, school_id, academic_year_id, name, level) VALUES
('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', '6ème A', '6ème'),
('c2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000001', '5ème B', '5ème');

-- Élèves (UUIDs réels)
INSERT INTO public.students (id, school_id, first_name, last_name, student_number) VALUES
('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Marc', 'Kabongo', 'MAT-A1'),
('d2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Sophie', 'Tshilombo', 'MAT-A2'),
('d3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'David', 'Ilunga', 'MAT-B1');

-- Inscriptions (UUIDs réels pour FK enrollment_id)
INSERT INTO public.student_enrollments (id, school_id, student_id, academic_year_id, class_id, status) VALUES
('e1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'active'),
('e2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'active'),
('e3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'd3333333-3333-3333-3333-333333333333', 'b0000000-0000-0000-0000-000000000001', 'c2222222-2222-2222-2222-222222222222', 'active');

-- Simulation d'exécution sous l'administrateur actif d'École A
SET LOCAL "request.jwt.claim.sub" = 'a1111111-1111-1111-1111-111111111111';

DO $$
DECLARE
    v_dash JSONB;
    v_prio JSONB;
    v_item JSONB;
    v_key TEXT;
    v_business_date DATE;
    v_assert_count INTEGER := 0;
    v_key_count INTEGER;

    v_p1_res JSONB;
    v_p2_res JSONB;
    v_p3_res JSONB;

    v_sec_def BOOLEAN;
    v_owner TEXT;
    v_has_priv_anon BOOLEAN;
    v_has_priv_auth BOOLEAN;
    v_has_priv_pub BOOLEAN;
    v_proconfig TEXT[];
BEGIN
    v_business_date := (pg_catalog.now() AT TIME ZONE 'Africa/Kinshasa')::DATE;

    -- =========================================================================
    -- 1. STRUCTURE ET ZERO DATA
    -- =========================================================================
    v_dash := public.get_school_collection_dashboard();
    v_assert_count := v_assert_count + 1;
    ASSERT (v_dash->'currencies'->'USD'->>'total_overdue_amount')::NUMERIC = 0.00, 'TEST 1.1 : USD zero total_overdue_amount';
    ASSERT (v_dash->'currencies'->'USD'->>'total_overdue_count')::INTEGER = 0, 'TEST 1.2 : USD zero total_overdue_count';
    ASSERT (v_dash->'currencies'->'CDF'->>'total_overdue_amount')::NUMERIC = 0.00, 'TEST 1.3 : CDF zero total_overdue_amount';
    ASSERT (v_dash->'currencies'->'CDF'->>'actions_last_7_days_count')::INTEGER = 0, 'TEST 1.4 : CDF zero actions_last_7_days_count';

    v_prio := public.get_school_collection_priorities(NULL, NULL, 20, NULL, NULL, NULL);
    v_assert_count := v_assert_count + 1;
    ASSERT pg_catalog.jsonb_array_length(v_prio->'items') = 0, 'TEST 1.5 : Priorities items vide si zero donnee';
    ASSERT (v_prio->>'has_more')::BOOLEAN = FALSE, 'TEST 1.6 : Priorities has_more = false';
    ASSERT (v_prio->>'next_cursor') IS NULL, 'TEST 1.7 : Priorities next_cursor = null';

    -- =========================================================================
    -- 2. POPULATION ÉCHUE CANONIQUE (DUE_DATE < BUSINESS_DATE)
    -- =========================================================================
    -- Due hier (Retenue)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-E01', 1, v_business_date - 30, v_business_date - 1, 'USD', 100, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- Due aujourd'hui (Exclue)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-E02', 2, v_business_date - 30, v_business_date, 'USD', 100, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- Due demain (Exclue)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-E03', 3, v_business_date - 30, v_business_date + 1, 'USD', 100, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- Payée / Solde = 0 (Exclue)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('e0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-E04', 4, v_business_date - 30, v_business_date - 10, 'USD', 100, 100, 'paid', 'a1111111-1111-1111-1111-111111111111');

    -- Brouillon (Exclue)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('e0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-E05', 5, v_business_date - 30, v_business_date - 10, 'USD', 100, 0, 'draft', 'a1111111-1111-1111-1111-111111111111');

    v_dash := public.get_school_collection_dashboard();
    v_assert_count := v_assert_count + 1;
    ASSERT (v_dash->'currencies'->'USD'->>'total_overdue_count')::INTEGER = 1, 'TEST 2.1 : Une seule facture retenue (due hier)';
    ASSERT (v_dash->'currencies'->'USD'->>'total_overdue_amount')::NUMERIC = 100.00, 'TEST 2.2 : Montant echu = 100.00';

    -- Nettoyage des factures de test 2
    ALTER TABLE public.student_invoices DISABLE TRIGGER USER;
    DELETE FROM public.student_invoices WHERE school_id = '11111111-1111-1111-1111-111111111111';
    ALTER TABLE public.student_invoices ENABLE TRIGGER USER;

    -- =========================================================================
    -- 3. FIXTURE DÉTERMINISTE DASHBOARD & EXCLUSIVITÉ DES STATUTS KPI
    -- =========================================================================
    -- Inv 1: never_contacted (100 USD)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-D01', 10, v_business_date - 40, v_business_date - 20, 'USD', 100, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- Inv 2: promise_overdue (200 USD, promesse dépassée il y a 3 jours)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-D02', 11, v_business_date - 40, v_business_date - 20, 'USD', 200, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');
    INSERT INTO public.school_invoice_collection_actions (id, invoice_id, school_id, action_type, note, idempotency_key, contacted_at, promise_to_pay_date, created_by) VALUES
    ('ac000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'phone', 'Action promesse dépassée', 'ab000000-0000-0000-0000-000000000002', pg_catalog.now() - INTERVAL '4 days', v_business_date - 3, 'a1111111-1111-1111-1111-111111111111');

    -- Inv 3: followup_due (150 USD, relance due hier, aucune promesse)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'e2222222-2222-2222-2222-222222222222', 'c1111111-1111-1111-1111-111111111111', 'FAC-D03', 12, v_business_date - 40, v_business_date - 20, 'USD', 150, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');
    INSERT INTO public.school_invoice_collection_actions (id, invoice_id, school_id, action_type, note, idempotency_key, contacted_at, next_follow_up_date, created_by) VALUES
    ('ac000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'email', 'Action relance due hier', 'ab000000-0000-0000-0000-000000000003', pg_catalog.now() - INTERVAL '2 days', v_business_date - 1, 'a1111111-1111-1111-1111-111111111111');

    -- Inv 4: promise_pending (300 USD, promesse dans 5 jours)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('f0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'e2222222-2222-2222-2222-222222222222', 'c1111111-1111-1111-1111-111111111111', 'FAC-D04', 13, v_business_date - 40, v_business_date - 20, 'USD', 300, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');
    INSERT INTO public.school_invoice_collection_actions (id, invoice_id, school_id, action_type, note, idempotency_key, contacted_at, promise_to_pay_date, created_by) VALUES
    ('ac000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'meeting', 'Action promesse future', 'ab000000-0000-0000-0000-000000000004', pg_catalog.now() - INTERVAL '1 day', v_business_date + 5, 'a1111111-1111-1111-1111-111111111111');

    -- Inv 5: contacted simple (250 USD, ni promesse ni relance proche)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('f0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-D05', 14, v_business_date - 40, v_business_date - 20, 'USD', 250, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');
    INSERT INTO public.school_invoice_collection_actions (id, invoice_id, school_id, action_type, note, idempotency_key, contacted_at, next_follow_up_date, created_by) VALUES
    ('ac000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sms', 'Action simple sans promesse', 'ab000000-0000-0000-0000-000000000005', pg_catalog.now() - INTERVAL '1 day', v_business_date + 10, 'a1111111-1111-1111-1111-111111111111');

    -- Inv 6: Promesse ET Relance SIMULTANÉMENT DÉPASSÉES (400 USD) -> Classée PROMISE_OVERDUE uniquement!
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('f0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-D06', 15, v_business_date - 100, v_business_date - 100, 'USD', 1000, 600, 'partially_paid', 'a1111111-1111-1111-1111-111111111111');
    INSERT INTO public.school_invoice_collection_actions (id, invoice_id, school_id, action_type, note, idempotency_key, contacted_at, promise_to_pay_date, next_follow_up_date, created_by) VALUES
    ('ac000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'phone', 'Promesse et relance simultanément dépassées', 'ab000000-0000-0000-0000-000000000006', pg_catalog.now() - INTERVAL '5 days', v_business_date - 2, v_business_date - 2, 'a1111111-1111-1111-1111-111111111111');

    -- Inv CDF 1: never_contacted CDF (1 000 000 CDF)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('f0000000-0000-0000-0000-0000000000cd', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'e2222222-2222-2222-2222-222222222222', 'c1111111-1111-1111-1111-111111111111', 'FAC-CDF1', 16, v_business_date - 50, v_business_date - 30, 'CDF', 1000000, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- Exécution RPC Publique Dashboard
    v_dash := public.get_school_collection_dashboard();
    v_assert_count := v_assert_count + 1;

    -- Vérifications exactes
    ASSERT (v_dash->'currencies'->'USD'->>'total_overdue_count')::INTEGER = 6, 'TEST 3.1 : Total 6 factures USD echues';
    ASSERT (v_dash->'currencies'->'USD'->>'total_overdue_amount')::NUMERIC = 1400.00, 'TEST 3.2 : Somme restante USD = 1400.00';

    ASSERT (v_dash->'currencies'->'USD'->>'never_contacted_count')::INTEGER = 1, 'TEST 3.3 : never_contacted_count = 1';
    ASSERT (v_dash->'currencies'->'USD'->>'never_contacted_amount')::NUMERIC = 100.00, 'TEST 3.4 : never_contacted_amount = 100.00';

    ASSERT (v_dash->'currencies'->'USD'->>'promise_overdue_count')::INTEGER = 2, 'TEST 3.5 : promise_overdue_count = 2 (Inv 2 + Inv 6)';
    ASSERT (v_dash->'currencies'->'USD'->>'promise_overdue_amount')::NUMERIC = 600.00, 'TEST 3.6 : promise_overdue_amount = 600.00 (200 + 400)';

    ASSERT (v_dash->'currencies'->'USD'->>'followup_due_count')::INTEGER = 1, 'TEST 3.7 : followup_due_count = 1 (Inv 3 uniquement; Inv 6 est promise_overdue !)';

    ASSERT (v_dash->'currencies'->'USD'->>'promise_pending_count')::INTEGER = 1, 'TEST 3.8 : promise_pending_count = 1';
    ASSERT (v_dash->'currencies'->'USD'->>'promise_pending_amount')::NUMERIC = 300.00, 'TEST 3.9 : promise_pending_amount = 300.00';

    ASSERT (v_dash->'currencies'->'CDF'->>'total_overdue_count')::INTEGER = 1, 'TEST 3.10 : Total 1 facture CDF';
    ASSERT (v_dash->'currencies'->'CDF'->>'never_contacted_amount')::NUMERIC = 1000000.00, 'TEST 3.11 : CDF never_contacted = 1000000.00';

    RAISE NOTICE 'OUTPUT_DASHBOARD_JSON:%', v_dash::TEXT;
    INSERT INTO _test_json_outputs VALUES ('dashboard', v_dash);

    -- =========================================================================
    -- 4. CONTRAT PRIORITIES RÉEL (24 CLÉS ITEM & VALIDATION DES TYPES)
    -- =========================================================================
    v_prio := public.get_school_collection_priorities(NULL, NULL, 20, NULL, NULL, NULL);
    v_assert_count := v_assert_count + 1;

    ASSERT (v_prio->>'business_date') IS NOT NULL, 'TEST 4.1 : business_date presente';
    ASSERT (v_prio->>'has_more')::BOOLEAN = FALSE, 'TEST 4.2 : has_more = false';
    ASSERT pg_catalog.jsonb_array_length(v_prio->'items') = 7, 'TEST 4.3 : 7 items retournes au total';

    -- Vérification exhaustive des 24 clés sur le premier item
    v_item := (v_prio->'items')->0;
    SELECT COUNT(*) INTO v_key_count FROM pg_catalog.jsonb_object_keys(v_item);
    ASSERT v_key_count = 24, 'TEST 4.4 : Exactement 24 clés dans chaque item priority';

    ASSERT (v_item->>'invoice_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'TEST 4.5 : invoice_id est un UUID valide';
    ASSERT (v_item->>'student_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'TEST 4.6 : student_id est un UUID valide';

    RAISE NOTICE 'OUTPUT_PRIORITIES_JSON:%', v_prio::TEXT;
    INSERT INTO _test_json_outputs VALUES ('priorities', v_prio);

    -- =========================================================================
    -- 5. PAGINATION KEYSET SUR 3 PAGES AVEC 7 FACTURES (P_LIMIT = 3)
    -- =========================================================================
    -- Nettoyage pour fixture de pagination
    DELETE FROM public.school_invoice_collection_actions WHERE school_id = '11111111-1111-1111-1111-111111111111';
    ALTER TABLE public.student_invoices DISABLE TRIGGER USER;
    DELETE FROM public.student_invoices WHERE school_id = '11111111-1111-1111-1111-111111111111';
    ALTER TABLE public.student_invoices ENABLE TRIGGER USER;

    -- Insertion de 7 factures avec scores déterministes (UUIDs hexadécimaux stricts)
    -- P1: score 100
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('fa000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-P01', 101, v_business_date - 30, v_business_date - 10, 'USD', 200, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');
    INSERT INTO public.school_invoice_collection_actions (id, invoice_id, school_id, action_type, note, idempotency_key, contacted_at, promise_to_pay_date, created_by) VALUES
    ('ac000000-0000-0000-0000-000000000011', 'fa000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'phone', 'Note pagination 1', 'ab000000-0000-0000-0000-000000000011', pg_catalog.now() - INTERVAL '2 days', v_business_date - 5, 'a1111111-1111-1111-1111-111111111111');

    -- P2: score 100 (effective date plus tardive -> vient après P1)
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('fa000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-P02', 102, v_business_date - 30, v_business_date - 5, 'USD', 200, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');
    INSERT INTO public.school_invoice_collection_actions (id, invoice_id, school_id, action_type, note, idempotency_key, contacted_at, promise_to_pay_date, created_by) VALUES
    ('ac000000-0000-0000-0000-000000000012', 'fa000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'phone', 'Note pagination 2', 'ab000000-0000-0000-0000-000000000012', pg_catalog.now() - INTERVAL '2 days', v_business_date - 2, 'a1111111-1111-1111-1111-111111111111');

    -- P3: score 80
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('fa000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-P03', 103, v_business_date - 70, v_business_date - 70, 'USD', 200, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- P4: score 80
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('fa000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-P04', 104, v_business_date - 65, v_business_date - 65, 'USD', 200, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- P5: score 20
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('fa000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-P05', 105, v_business_date - 40, v_business_date - 40, 'USD', 200, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- P6: score 20
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('fa000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-P06', 106, v_business_date - 35, v_business_date - 35, 'USD', 200, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- P7: score 0
    INSERT INTO public.student_invoices (id, school_id, academic_year_id, student_id, enrollment_id, class_id, invoice_number, sequence_number, issue_date, due_date, currency, total_amount, paid_amount, status, created_by) VALUES
    ('fa000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'FAC-P07', 107, v_business_date - 10, v_business_date - 10, 'USD', 100, 0, 'issued', 'a1111111-1111-1111-1111-111111111111');

    -- Page 1 (limit 3)
    v_p1_res := public.get_school_collection_priorities(NULL, NULL, 3, NULL, NULL, NULL);
    v_assert_count := v_assert_count + 1;
    ASSERT pg_catalog.jsonb_array_length(v_p1_res->'items') = 3, 'TEST 5.1 : Page 1 contient 3 items';
    ASSERT (v_p1_res->>'has_more')::BOOLEAN = TRUE, 'TEST 5.2 : Page 1 has_more = true';
    ASSERT (v_p1_res->'next_cursor'->>'invoice_id') = 'fa000000-0000-0000-0000-000000000003', 'TEST 5.3 : Next cursor Page 1 pointe sur le 3eme item (p3)';

    -- Page 2 (limit 3) avec curseur de Page 1
    v_p2_res := public.get_school_collection_priorities(
        NULL, NULL, 3,
        (v_p1_res->'next_cursor'->>'priority_score')::INTEGER,
        (v_p1_res->'next_cursor'->>'effective_date')::DATE,
        (v_p1_res->'next_cursor'->>'invoice_id')::UUID
    );
    v_assert_count := v_assert_count + 1;
    ASSERT pg_catalog.jsonb_array_length(v_p2_res->'items') = 3, 'TEST 5.4 : Page 2 contient 3 items';
    ASSERT ((v_p2_res->'items')->0->>'invoice_id') = 'fa000000-0000-0000-0000-000000000004', 'TEST 5.5 : Tete de Page 2 est N+1 (p4) sans doublon';
    ASSERT (v_p2_res->>'has_more')::BOOLEAN = TRUE, 'TEST 5.6 : Page 2 has_more = true';
    ASSERT (v_p2_res->'next_cursor'->>'invoice_id') = 'fa000000-0000-0000-0000-000000000006', 'TEST 5.7 : Next cursor Page 2 pointe sur le 6eme item (p6)';

    -- Page 3 (limit 3) avec curseur de Page 2
    v_p3_res := public.get_school_collection_priorities(
        NULL, NULL, 3,
        (v_p2_res->'next_cursor'->>'priority_score')::INTEGER,
        (v_p2_res->'next_cursor'->>'effective_date')::DATE,
        (v_p2_res->'next_cursor'->>'invoice_id')::UUID
    );
    v_assert_count := v_assert_count + 1;
    ASSERT pg_catalog.jsonb_array_length(v_p3_res->'items') = 1, 'TEST 5.8 : Page 3 contient 1 item (p7)';
    ASSERT ((v_p3_res->'items')->0->>'invoice_id') = 'fa000000-0000-0000-0000-000000000007', 'TEST 5.9 : p7 correctement recupere';
    ASSERT (v_p3_res->>'has_more')::BOOLEAN = FALSE, 'TEST 5.10 : Derniere page has_more = false';
    ASSERT (v_p3_res->>'next_cursor') IS NULL, 'TEST 5.11 : Derniere page next_cursor = null';

    -- =========================================================================
    -- 6. VALIDATION DES ARGUMENTS ET REJETS 22023
    -- =========================================================================
    -- p_limit NULL -> 20
    v_prio := public.get_school_collection_priorities(NULL, NULL, NULL, NULL, NULL, NULL);
    v_assert_count := v_assert_count + 1;
    ASSERT pg_catalog.jsonb_array_length(v_prio->'items') = 7, 'TEST 6.1 : p_limit NULL utilise la valeur par defaut 20';

    -- p_limit 0 -> Rejet 22023
    BEGIN
        PERFORM public.get_school_collection_priorities(NULL, NULL, 0, NULL, NULL, NULL);
        RAISE EXCEPTION 'ERREUR: p_limit 0 n''a pas ete rejete';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'TEST 6.2 : p_limit 0 rejete avec 22023';
    END;

    -- p_limit 101 -> Rejet 22023
    BEGIN
        PERFORM public.get_school_collection_priorities(NULL, NULL, 101, NULL, NULL, NULL);
        RAISE EXCEPTION 'ERREUR: p_limit 101 n''a pas ete rejete';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'TEST 6.3 : p_limit 101 rejete avec 22023';
    END;

    -- Devise invalide -> Rejet 22023
    BEGIN
        PERFORM public.get_school_collection_priorities('EUR', NULL, 20, NULL, NULL, NULL);
        RAISE EXCEPTION 'ERREUR: Devise EUR n''a pas ete rejetee';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'TEST 6.4 : Devise invalide rejetee avec 22023';
    END;

    -- Filtre priorite invalide -> Rejet 22023
    BEGIN
        PERFORM public.get_school_collection_priorities(NULL, 'super', 20, NULL, NULL, NULL);
        RAISE EXCEPTION 'ERREUR: Priority filter invalide n''a pas ete rejete';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'TEST 6.5 : Priority filter invalide rejete avec 22023';
    END;

    -- Curseur partiel -> Rejet 22023
    BEGIN
        PERFORM public.get_school_collection_priorities(NULL, NULL, 20, 100, v_business_date, NULL);
        RAISE EXCEPTION 'ERREUR: Curseur partiel n''a pas ete rejete';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'TEST 6.6 : Curseur partiel rejete avec 22023';
    END;

    -- Score curseur negatif -> Rejet 22023
    BEGIN
        PERFORM public.get_school_collection_priorities(NULL, NULL, 20, -5, v_business_date, 'fa000000-0000-0000-0000-000000000001'::UUID);
        RAISE EXCEPTION 'ERREUR: Score curseur negatif n''a pas ete rejete';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLSTATE = '22023', 'TEST 6.7 : Score curseur negatif rejete avec 22023';
    END;

    -- =========================================================================
    -- 7. AUDIT DES PRIVILÈGES ET PG_PROC
    -- =========================================================================
    -- Helper interne private
    SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner)
    INTO v_sec_def, v_owner
    FROM pg_catalog.pg_proc p
    WHERE p.proname = '_evaluate_school_collection_invoices';

    v_assert_count := v_assert_count + 1;
    ASSERT v_sec_def = TRUE, 'TEST 7.1 : Helper interne est SECURITY DEFINER';
    ASSERT v_owner = 'postgres', 'TEST 7.2 : Helper interne a pour owner postgres';

    ASSERT has_function_privilege('authenticated', 'public._evaluate_school_collection_invoices(uuid, date)', 'EXECUTE') = FALSE, 'TEST 7.3 : authenticated n''a pas EXECUTE sur helper';
    ASSERT has_function_privilege('anon', 'public._evaluate_school_collection_invoices(uuid, date)', 'EXECUTE') = FALSE, 'TEST 7.4 : anon n''a pas EXECUTE sur helper';
    ASSERT has_function_privilege('public', 'public._evaluate_school_collection_invoices(uuid, date)', 'EXECUTE') = FALSE, 'TEST 7.5 : public n''a pas EXECUTE sur helper';

    -- RPC Publique Dashboard
    SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner), p.proconfig
    INTO v_sec_def, v_owner, v_proconfig
    FROM pg_catalog.pg_proc p
    WHERE p.proname = 'get_school_collection_dashboard';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE 'PROCONFIG_LOG: %', v_proconfig::TEXT;
    ASSERT v_sec_def = TRUE, 'TEST 7.6 : Dashboard RPC est SECURITY DEFINER';
    ASSERT v_owner = 'postgres', 'TEST 7.7 : Dashboard RPC a pour owner postgres';
    ASSERT 'search_path=' = ANY(v_proconfig) OR 'search_path=""' = ANY(v_proconfig), 'TEST 7.8 : Dashboard RPC a search_path vide dans proconfig';

    ASSERT has_function_privilege('authenticated', 'public.get_school_collection_dashboard()', 'EXECUTE') = TRUE, 'TEST 7.9 : authenticated a EXECUTE sur dashboard RPC';
    ASSERT has_function_privilege('anon', 'public.get_school_collection_dashboard()', 'EXECUTE') = FALSE, 'TEST 7.10 : anon n''a pas EXECUTE sur dashboard RPC';

    RAISE NOTICE 'SUCCESS_SUMMARY: Tous les tests SQL Finance 4C-1R ont réussi (% assertions réelles).', v_assert_count;
END;
$$;

SELECT name, jsonb_pretty(data) AS json_output FROM _test_json_outputs;

ROLLBACK;
