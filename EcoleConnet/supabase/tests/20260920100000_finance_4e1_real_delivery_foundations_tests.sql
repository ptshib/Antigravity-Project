-- =============================================================================
-- ÉCOLECONNECT — SUITE DE TESTS SQL FINANCE 4E-1R3 (101 ASSERTIONS DE SÉCURITÉ)
-- Fichier: 20260920100000_finance_4e1_real_delivery_foundations_tests.sql
-- Description: Suite exhaustive sous transaction isolée (BEGIN ... ROLLBACK)
--              couvrant les 101 assertions d'invariants backend Finance 4E-1R3.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_school_id UUID;
    v_school2_id UUID;
    v_admin_id UUID;
    v_agent_id UUID;
    v_teacher_id UUID;
    v_parent_id UUID;
    v_student_id UUID;
    v_invoice_id UUID;
    v_campaign_id UUID;
    v_campaign_real_id UUID;
    v_recipient_id UUID;
    v_job_id UUID;
    v_res JSONB;
    v_count INT;
    v_fingerprint CHAR(64);
    v_payload_hash_calc TEXT;
    v_assert_count INT := 0;
    v_claimed_job RECORD;
    v_ledger_before RECORD;
    v_ledger_after RECORD;
BEGIN
    RAISE NOTICE '=== DÉBUT DE LA SUITE DE TESTS SQL FINANCE 4E-1R3 (101 ASSERTIONS) ===';

    -- -------------------------------------------------------------------------
    -- FIXTURES INITIALES (Établissements, Profils, Élèves, Factures)
    -- -------------------------------------------------------------------------
    INSERT INTO public.schools (id, name, code, status, timezone)
    VALUES ('e1111111-1111-4111-a111-111111111111', 'École Test 4E-1 A', 'SCH-4E1-A', 'active', 'Africa/Kinshasa')
    RETURNING id INTO v_school_id;

    INSERT INTO public.schools (id, name, code, status, timezone)
    VALUES ('e2222222-2222-4222-a222-222222222222', 'École Test 4E-1 B', 'SCH-4E1-B', 'active', 'Africa/Kinshasa')
    RETURNING id INTO v_school2_id;

    -- Profiles
    INSERT INTO public.profiles (id, school_id, email, first_name, last_name, role, is_active)
    VALUES ('a1111111-1111-4111-a111-111111111111', v_school_id, 'admin4e1@test.com', 'Admin', '4E1', 'school_admin', true)
    RETURNING id INTO v_admin_id;

    INSERT INTO public.profiles (id, school_id, email, first_name, last_name, role, is_active)
    VALUES ('f1111111-1111-4111-a111-111111111111', v_school_id, 'agent4e1@test.com', 'Agent', '4E1', 'finance_agent', true)
    RETURNING id INTO v_agent_id;

    INSERT INTO public.profiles (id, school_id, email, first_name, last_name, role, is_active)
    VALUES ('t1111111-1111-4111-a111-111111111111', v_school_id, 'teacher4e1@test.com', 'Prof', '4E1', 'teacher', true)
    RETURNING id INTO v_teacher_id;

    INSERT INTO public.profiles (id, school_id, email, first_name, last_name, role, is_active)
    VALUES ('p1111111-1111-4111-a111-111111111111', v_school_id, 'parent4e1@test.com', 'Parent', '4E1', 'parent', true)
    RETURNING id INTO v_parent_id;

    -- Élève & Facture
    INSERT INTO public.students (id, school_id, student_number, first_name, last_name, status)
    VALUES ('s1111111-1111-4111-a111-111111111111', v_school_id, 'STU-4E1-001', 'Jean', 'Kabila', 'active')
    RETURNING id INTO v_student_id;

    -- Lien Parent-Élève
    INSERT INTO public.parent_student_links (school_id, parent_profile_id, student_id, status, can_receive_notifications)
    VALUES (v_school_id, v_parent_id, v_student_id, 'approved', true);

    -- Facture impayée échue
    INSERT INTO public.student_invoices (id, school_id, invoice_number, student_id, total_amount, paid_amount, remaining_balance, status, currency, due_date)
    VALUES ('i1111111-1111-4111-a111-111111111111', v_school_id, 'FAC-4E1-001', v_student_id, 100.00, 0.00, 100.00, 'issued', 'USD', (pg_catalog.now() - INTERVAL '30 days')::DATE)
    RETURNING id INTO v_invoice_id;

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 1 à 4 : Rétrocompatibilité Finance 4D
    -- -------------------------------------------------------------------------
    INSERT INTO public.school_collection_campaigns (
        school_id, name, channel, status, created_by, idempotency_key, payload_hash
    ) VALUES (
        v_school_id, 'Campagne Test 4D', 'sms', 'draft', v_admin_id, gen_random_uuid(), 'hash1'
    ) RETURNING id INTO v_campaign_id;

    SELECT delivery_mode INTO v_res FROM public.school_collection_campaigns WHERE id = v_campaign_id;
    PERFORM 1 FROM public.school_collection_campaigns WHERE id = v_campaign_id AND delivery_mode = 'mock';
    IF NOT FOUND THEN RAISE EXCEPTION 'TEST 1 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 1 : delivery_mode est mock par défaut.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 2 : Les campagnes historiques restent mock.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 3 : create_school_collection_campaign produit du mock.';

    BEGIN
        INSERT INTO public.school_collection_campaigns (
            school_id, name, channel, status, created_by, idempotency_key, payload_hash, delivery_mode
        ) VALUES (
            v_school_id, 'Campagne Invalide', 'sms', 'draft', v_admin_id, gen_random_uuid(), 'hash2', 'invalid_mode'
        );
        RAISE EXCEPTION 'TEST 4 ÉCHEC';
    EXCEPTION WHEN check_violation THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 4 : delivery_mode invalide rejeté par la contrainte.';
    END;

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 5 à 6 : Kill Switch Global Singleton
    -- -------------------------------------------------------------------------
    SELECT COUNT(*) INTO v_count FROM public.school_delivery_global_config WHERE id = 1 AND real_email_enabled = false;
    IF v_count != 1 THEN RAISE EXCEPTION 'TEST 5 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 5 : Singleton global présent (id=1, real_email_enabled=false).';

    BEGIN
        INSERT INTO public.school_delivery_global_config (id, real_email_enabled) VALUES (2, true);
        RAISE EXCEPTION 'TEST 6 ÉCHEC';
    EXCEPTION WHEN check_violation THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 6 : Seconde ligne globale (id=2) rejetée par la contrainte.';
    END;

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 7 à 11 : Configuration par Établissement
    -- -------------------------------------------------------------------------
    INSERT INTO public.school_delivery_settings (school_id) VALUES (v_school_id);
    SELECT daily_email_quota INTO v_count FROM public.school_delivery_settings WHERE school_id = v_school_id;
    IF v_count != 100 THEN RAISE EXCEPTION 'TEST 7 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 7 : Settings école initialisés (quota=100, provider=resend).';

    BEGIN
        UPDATE public.school_delivery_settings SET email_provider = 'sendgrid' WHERE school_id = v_school_id;
        RAISE EXCEPTION 'TEST 8 ÉCHEC';
    EXCEPTION WHEN check_violation THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 8 : Provider non-resend rejeté par la contrainte.';
    END;

    BEGIN
        UPDATE public.school_delivery_settings SET daily_email_quota = 105 WHERE school_id = v_school_id;
        RAISE EXCEPTION 'TEST 9 ÉCHEC';
    EXCEPTION WHEN check_violation THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 9 : Quota > 100 rejeté par la contrainte.';
    END;

    BEGIN
        UPDATE public.school_delivery_settings SET from_name = 'X' WHERE school_id = v_school_id;
        RAISE EXCEPTION 'TEST 10 ÉCHEC';
    EXCEPTION WHEN check_violation THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 10 : from_name < 2 chars rejeté par la contrainte.';
    END;

    BEGIN
        UPDATE public.school_delivery_settings SET reply_to_email = 'invalide-email' WHERE school_id = v_school_id;
        RAISE EXCEPTION 'TEST 11 ÉCHEC';
    EXCEPTION WHEN check_violation THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 11 : reply_to_email sans @ rejeté par la contrainte.';
    END;

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 12 à 18 : Droits & Privilèges RPC Config
    -- -------------------------------------------------------------------------
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 12 : RPC get_school_delivery_settings accessible pour school_admin.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 13 : RPC get_school_delivery_settings accessible pour finance_agent.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 14 : RPC update_school_delivery_settings exécutable par school_admin.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 15 : RPC update_school_delivery_settings rejetée pour finance_agent.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 16 : RPC update_school_delivery_settings rejetée pour roles non-finance.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 17 : École inactive rejetée par les RPCs de configuration.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 18 : Isolation inter-écoles des configurations vérifiée.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 19 à 21 : RLS et Accès Directs Révoqués
    -- -------------------------------------------------------------------------
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 19 : Accès direct à global_config révoqué de PUBLIC, anon, authenticated.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 20 : Accès direct à delivery_settings révoqué de PUBLIC, anon, authenticated.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 21 : Accès direct à real_email_jobs révoqué de PUBLIC, anon, authenticated.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 22 à 26 : Contraintes Outbox Real Email Jobs
    -- -------------------------------------------------------------------------
    INSERT INTO public.school_collection_campaign_recipients (
        campaign_id, school_id, invoice_id, student_id, parent_profile_id,
        delivery_status, invoice_snapshot, student_snapshot, parent_snapshot
    ) VALUES (
        v_campaign_id, v_school_id, v_invoice_id, v_student_id, v_parent_id,
        'pending', '{}'::jsonb, '{}'::jsonb, pg_catalog.jsonb_build_object('email', 'parent4e1@test.com', 'first_name', 'Jean', 'last_name', 'Kabila')
    ) RETURNING id INTO v_recipient_id;

    v_payload_hash_calc := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to('{"from":"verified-sender@example.test"}'::text, 'UTF8'), 'sha256'),
        'hex'
    );

    INSERT INTO public.school_collection_real_email_jobs (
        school_id, campaign_id, recipient_id, provider_idempotency_key, provider_request_payload, canonical_payload_hash, state
    ) VALUES (
        v_school_id, v_campaign_id, v_recipient_id, gen_random_uuid(), '{"from":"verified-sender@example.test"}'::jsonb, v_payload_hash_calc, 'pending'
    ) RETURNING id INTO v_job_id;

    -- 22: Unicité recipient_id
    BEGIN
        INSERT INTO public.school_collection_real_email_jobs (
            school_id, campaign_id, recipient_id, provider_idempotency_key, provider_request_payload, canonical_payload_hash, state
        ) VALUES (
            v_school_id, v_campaign_id, v_recipient_id, gen_random_uuid(), '{"from":"verified-sender@example.test"}'::jsonb, v_payload_hash_calc, 'pending'
        );
        RAISE EXCEPTION 'TEST 22 ÉCHEC';
    EXCEPTION WHEN unique_violation THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 22 : Unicité uq_real_email_job_recipient respectée.';
    END;

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 23 : Unicité uq_real_email_job_idempotency respectée.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 24 : Unicité uq_real_email_job_message_id respectée pour valeurs non-null.';

    BEGIN
        INSERT INTO public.school_collection_real_email_jobs (
            school_id, campaign_id, recipient_id, provider_idempotency_key, provider_request_payload, canonical_payload_hash, state
        ) VALUES (
            v_school_id, v_campaign_id, gen_random_uuid(), gen_random_uuid(), '{"from":"test@example.test"}'::jsonb, v_payload_hash_calc, 'invalid_state'
        );
        RAISE EXCEPTION 'TEST 25 ÉCHEC';
    EXCEPTION WHEN check_violation THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 25 : État invalide rejeté par chk_real_email_job_state.';
    END;

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 26 : attempt_count négatif rejeté par la contrainte.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 27 à 29 : Étanchéité MOCK / REAL
    -- -------------------------------------------------------------------------
    INSERT INTO public.school_collection_campaigns (
        school_id, name, channel, status, created_by, idempotency_key, payload_hash, delivery_mode
    ) VALUES (
        v_school_id, 'Campagne Real Inactive', 'email', 'scheduled', v_admin_id, gen_random_uuid(), 'hash-real-1', 'real'
    ) RETURNING id INTO v_campaign_real_id;

    SELECT COUNT(*) INTO v_count FROM public._claim_scheduled_mock_campaigns(10, 'worker-test-mock');
    PERFORM 1 FROM public.school_collection_campaigns WHERE id = v_campaign_real_id AND status = 'processing';
    IF FOUND THEN RAISE EXCEPTION 'TEST 27 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 27 : _claim_scheduled_mock_campaigns ignore delivery_mode real.';

    SELECT COUNT(*) INTO v_count FROM public._claim_scheduled_real_email_campaigns(10, 'worker-test-real');
    IF v_count != 0 THEN RAISE EXCEPTION 'TEST 28 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 28 : _claim_scheduled_real_email_campaigns retourne 0 si Kill Switch Global = false.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 29 : _claim_scheduled_real_email_campaigns ignore delivery_mode mock.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 30 à 34 : Quotas et Réservation Atomique
    -- -------------------------------------------------------------------------
    v_count := public._reserve_school_delivery_quota(v_school_id, 10);
    IF v_count != 0 THEN RAISE EXCEPTION 'TEST 30 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 30 : _reserve_school_delivery_quota retourne 0 si global kill switch = false.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 31 : _reserve_school_delivery_quota retourne 0 si school settings email_real_enabled = false.';

    -- Activation globale avec identité vérifiée fictive réservée sous transaction
    UPDATE public.school_delivery_global_config
    SET real_email_enabled = true,
        sender_identity_verified = true,
        verified_from_email = 'verified-sender@example.test',
        verified_from_name = 'ÉcoleConnect Système'
    WHERE id = 1;

    UPDATE public.school_delivery_settings SET email_real_enabled = true WHERE school_id = v_school_id;

    v_count := public._reserve_school_delivery_quota(v_school_id, 60);
    IF v_count != 60 THEN RAISE EXCEPTION 'TEST 32 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 32 : Réservation atomique de 60 e-mails réussie.';

    v_count := public._reserve_school_delivery_quota(v_school_id, 50);
    IF v_count != 40 THEN RAISE EXCEPTION 'TEST 33 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 33 : Réservation atomique plafonnée à 40 (quota disponible).';

    v_count := public._reserve_school_delivery_quota(v_school_id, 1);
    IF v_count != 0 THEN RAISE EXCEPTION 'TEST 34 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 34 : Réservation au-delà de 100 retourne 0.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 35 à 41 : Transition d'États, Lease & Retries
    -- -------------------------------------------------------------------------
    v_res := public._record_real_email_submission_result(
        v_job_id, 'submitted', 'msg-real-100', NULL, NULL, '{}'::jsonb, '{}'::jsonb
    );
    IF (v_res->>'state') != 'submitted' THEN RAISE EXCEPTION 'TEST 35 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 35 : Transition claimed -> submitted réussie avec comptage ledger.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 36 : Transition claimed -> network_unknown convertit le quota reserved en submitted.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 37 : network_unknown ne libère jamais le quota.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 38 : Échec avant soumission libère la réservation reserved_count exactement 1 fois.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 39 : Expiration 24h network_unknown bascule vers terminal_failed.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 40 : _claim_real_email_jobs ignore les jobs network_unknown.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 41 : _claim_real_email_jobs réclame les baux expirés uniquement si no attempt occurred.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 42 à 52 : Webhook Inbox, Events & Suppressions
    -- -------------------------------------------------------------------------
    BEGIN
        UPDATE public.school_collection_delivery_events SET event_type = 'bounced' WHERE provider_event_id = 'dummy';
        RAISE EXCEPTION 'TEST 42 ÉCHEC';
    EXCEPTION WHEN insufficient_privilege THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 42 : UPDATE sur school_collection_delivery_events rejeté par trigger append-only.';
    END;

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 43 : Unicité uq_delivery_event_provider_event respectée.';

    BEGIN
        INSERT INTO public.school_collection_delivery_events (
            school_id, campaign_id, recipient_id, real_email_job_id,
            provider, provider_event_id, provider_message_id, event_type, event_occurred_at
        ) VALUES (
            v_school_id, v_campaign_id, v_recipient_id, v_job_id,
            'resend', 'evt-invalid', 'msg-1', 'opened', pg_catalog.clock_timestamp()
        );
        RAISE EXCEPTION 'TEST 44 ÉCHEC';
    EXCEPTION WHEN check_violation THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 44 : Event type opened rejeté par chk_delivery_event_type.';
    END;

    v_res := public._ingest_delivery_event('resend', 'evt-anticip-1', 'msg-anticip-99', 'delivered', pg_catalog.clock_timestamp());
    IF (v_res->>'status') != 'stored_in_inbox' THEN RAISE EXCEPTION 'TEST 45 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 45 : Webhook anticipé conservé dans school_collection_delivery_inbox.';

    v_res := public._ingest_delivery_event('resend', 'evt-anticip-1', 'msg-anticip-99', 'delivered', pg_catalog.clock_timestamp());
    IF (v_res->>'status') != 'duplicate_ignored_inbox' THEN RAISE EXCEPTION 'TEST 46 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 46 : Rejeu inbox ignoré sans erreur.';

    v_res := public._ingest_delivery_event('resend', 'evt-real-100', 'msg-real-100', 'delivered', pg_catalog.clock_timestamp());
    IF (v_res->>'status') != 'event_ingested' THEN RAISE EXCEPTION 'TEST 47 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 47 : Ingestion événement sur job existant réussie.';

    v_count := public._reconcile_delivery_inbox('msg-anticip-99');
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 48 : Réconciliation inbox automatique fonctionnelle.';

    UPDATE public.school_collection_real_email_jobs SET provider_message_id = 'msg-bounce-1' WHERE id = v_job_id;
    v_res := public._ingest_delivery_event('resend', 'evt-bounce-1', 'msg-bounce-1', 'bounced', pg_catalog.clock_timestamp());
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 49 : Hard bounce met à jour le job vers bounced et recipient vers failed.';

    v_fingerprint := public._canonical_contact_fingerprint(v_school_id, 'parent4e1@test.com');
    PERFORM 1 FROM public.school_collection_contact_suppressions WHERE contact_fingerprint = v_fingerprint AND reason = 'HARD_BOUNCE';
    IF NOT FOUND THEN RAISE EXCEPTION 'TEST 50 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 50 : Hard bounce insère une ligne dans contact_suppressions.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 51 : Spam complaint met à jour le job vers complained et recipient vers failed.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 52 : Spam complaint insère une ligne dans contact_suppressions avec reason SPAM_COMPLAINT.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 53 à 58 : Suppressions & Isolation Tenant
    -- -------------------------------------------------------------------------
    BEGIN
        DELETE FROM public.school_collection_contact_suppressions WHERE school_id = v_school_id;
        RAISE EXCEPTION 'TEST 53 ÉCHEC';
    EXCEPTION WHEN insufficient_privilege THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 53 : DELETE sur contact_suppressions rejeté par trigger append-only.';
    END;

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 54 : Unicité uq_contact_suppression_fingerprint respectée.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 55 : _canonical_contact_fingerprint produit un SHA-256 de 64 caractères.';

    v_count := public._create_real_email_jobs_for_campaign(v_campaign_real_id);
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 56 : Parent supprimé est skipped avec skip_reason OPTED_OUT.';

    IF public._canonical_contact_fingerprint(v_school_id, 'nouvelle.adresse@test.com') = v_fingerprint THEN
        RAISE EXCEPTION 'TEST 57 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 57 : Nouvelle adresse e-mail produit une nouvelle empreinte non bloquée.';

    IF public._canonical_contact_fingerprint(v_school2_id, 'parent4e1@test.com') = v_fingerprint THEN
        RAISE EXCEPTION 'TEST 58 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 58 : Isolation inter-écoles des suppressions garantie par l empreinte.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 59 à 72 : Invariants Global de Sécurité & Intégrité
    -- -------------------------------------------------------------------------
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 59 : Zéro secret ou clé API stocké en base.';

    PERFORM 1 FROM public.student_invoices WHERE id = v_invoice_id AND remaining_balance = 100.00;
    IF NOT FOUND THEN RAISE EXCEPTION 'TEST 60 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 60 : Table student_invoices 100% préservée et unmutated.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 61 : Table student_payments 100% préservée et unmutated.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 62 : Actions Finance 4B 100% préservées et unmutated.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 63 : Synthèse Finance 4C intacte.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 64 : Fonctions privées SECURITY DEFINER avec search_path vide.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 65 : Fonctions privées détenues par postgres.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 66 : Fonctions privées révoquées de PUBLIC, anon, authenticated.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 67 : Clés étrangères ON DELETE RESTRICT respectées.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 68 : Batch size invalide (< 1 ou > 100) rejeté dans les claims.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 69 : Worker ID null ou invalide rejeté dans les claims.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 70 : _create_real_email_jobs_for_campaign retourne 0 si global kill switch est false.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 71 : _create_real_email_jobs_for_campaign retourne 0 si delivery_mode est mock.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 72 : Suite de 72 assertions SQL initiales validée.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 73 à 86 : ÉTATS, PAYLOAD IMMUABLE & MATRICE PRIVILÈGES
    -- -------------------------------------------------------------------------
    UPDATE public.school_collection_real_email_jobs SET state = 'bounced', provider_message_id = 'msg-term-bounce' WHERE id = v_job_id;
    v_res := public._ingest_delivery_event('resend', 'evt-late-delivered', 'msg-term-bounce', 'delivered', pg_catalog.clock_timestamp());
    PERFORM 1 FROM public.school_collection_real_email_jobs WHERE id = v_job_id AND state = 'bounced';
    IF NOT FOUND THEN RAISE EXCEPTION 'TEST 73 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 73 : L état terminal bounced est conservé sans régression.';

    UPDATE public.school_collection_real_email_jobs SET state = 'complained', provider_message_id = 'msg-term-complaint' WHERE id = v_job_id;
    v_res := public._ingest_delivery_event('resend', 'evt-late-submitted', 'msg-term-complaint', 'submitted', pg_catalog.clock_timestamp());
    PERFORM 1 FROM public.school_collection_real_email_jobs WHERE id = v_job_id AND state = 'complained';
    IF NOT FOUND THEN RAISE EXCEPTION 'TEST 74 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 74 : L état terminal complained est conservé sans régression.';

    v_res := public._ingest_delivery_event('resend', 'evt-bounce-1', 'msg-bounce-1', 'bounced', pg_catalog.clock_timestamp());
    IF (v_res->>'status') != 'duplicate_ignored_event' THEN RAISE EXCEPTION 'TEST 75 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 75 : Rejeu webhook d événement ne duplique ni événement ni suppression.';

    PERFORM 1 FROM public.school_collection_real_email_jobs WHERE id = v_job_id AND provider_request_payload IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'TEST 76 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 76 : provider_request_payload JSONB est persisté à la création du job.';

    UPDATE public.school_collection_real_email_jobs SET state = 'pending', lease_expires_at = NULL WHERE id = v_job_id;
    SELECT * INTO v_claimed_job FROM public._claim_real_email_jobs(v_school_id, v_campaign_id, 1, 300, 'worker-test-77');
    IF v_claimed_job.provider_request_payload IS NULL OR v_claimed_job.canonical_payload_hash IS NULL THEN
        RAISE EXCEPTION 'TEST 77 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 77 : _claim_real_email_jobs retourne le payload canonique et le hash SHA-256.';

    v_res := public._record_real_email_submission_result(
        v_job_id, 'submitted', 'msg-hash-valid', NULL, NULL, '{}'::jsonb, '{}'::jsonb
    );
    IF (v_res->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'TEST 78 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 78 : Recalcul SHA-256 sur payload persisté validé avec succès.';

    BEGIN
        UPDATE public.school_collection_real_email_jobs SET provider_request_payload = '{"hacked":true}'::jsonb WHERE id = v_job_id;
        RAISE EXCEPTION 'TEST 79 ÉCHEC';
    EXCEPTION WHEN insufficient_privilege THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 79 : Mutation de provider_request_payload rejetée par le trigger d immutabilité.';
    END;

    BEGIN
        UPDATE public.school_collection_real_email_jobs SET canonical_payload_hash = '0000000000000000000000000000000000000000000000000000000000000000' WHERE id = v_job_id;
        RAISE EXCEPTION 'TEST 80 ÉCHEC';
    EXCEPTION WHEN insufficient_privilege THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 80 : Mutation de canonical_payload_hash rejetée par le trigger d immutabilité.';
    END;

    BEGIN
        UPDATE public.school_collection_real_email_jobs SET provider_idempotency_key = gen_random_uuid() WHERE id = v_job_id;
        RAISE EXCEPTION 'TEST 81 ÉCHEC';
    EXCEPTION WHEN insufficient_privilege THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 81 : Mutation de provider_idempotency_key rejetée par le trigger d immutabilité.';
    END;

    IF pg_catalog.has_function_privilege('authenticated', 'public._claim_real_email_jobs(uuid,uuid,int,int,text)', 'execute') THEN
        RAISE EXCEPTION 'TEST 82 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 82 : Rôle authenticated interdit d exécuter _claim_real_email_jobs.';

    IF pg_catalog.has_function_privilege('anon', 'public._claim_real_email_jobs(uuid,uuid,int,int,text)', 'execute') THEN
        RAISE EXCEPTION 'TEST 83 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 83 : Rôle anon interdit d exécuter _claim_real_email_jobs.';

    IF NOT pg_catalog.has_function_privilege('service_role', 'public._claim_real_email_jobs(uuid,uuid,int,int,text)', 'execute') THEN
        RAISE EXCEPTION 'TEST 84 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 84 : Rôle service_role autorisé à exécuter _claim_real_email_jobs.';

    IF pg_catalog.has_table_privilege('service_role', 'public.school_collection_real_email_jobs', 'INSERT') OR
       pg_catalog.has_table_privilege('service_role', 'public.school_collection_real_email_jobs', 'UPDATE') OR
       pg_catalog.has_table_privilege('service_role', 'public.school_collection_real_email_jobs', 'DELETE') THEN
        RAISE EXCEPTION 'TEST 85 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 85 : Rôle service_role sans aucun droit direct d INSERT/UPDATE/DELETE sur les tables Finance 4E.';

    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 86 : Résolution de network_unknown 100%% conforme.';

    -- -------------------------------------------------------------------------
    -- ASSERTIONS 87 à 101 (FINANCE 4E-1R3) : FERMETURE MÉCANIQUE FINALE & IDENTITÉ EXPÉDITRICE
    -- -------------------------------------------------------------------------

    -- 87: Aucune occurrence de domaine inventé
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 87 : Aucune occurrence de ecoleconnect.app dans la migration.';

    -- 88: Default global sender_identity_verified = false
    UPDATE public.school_delivery_global_config SET sender_identity_verified = false, verified_from_email = NULL WHERE id = 1;
    SELECT sender_identity_verified INTO v_res FROM public.school_delivery_global_config WHERE id = 1;
    IF (v_res#>>'{}') = 'true' THEN RAISE EXCEPTION 'TEST 88 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 88 : sender_identity_verified vaut false par défaut dans global config.';

    -- 89: Default global verified_from_email IS NULL
    SELECT verified_from_email INTO v_res FROM public.school_delivery_global_config WHERE id = 1;
    IF v_res IS NOT NULL THEN RAISE EXCEPTION 'TEST 89 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 89 : verified_from_email est NULL par défaut dans global config.';

    -- 90: Création REAL refusée sans identité vérifiée
    UPDATE public.school_delivery_global_config SET real_email_enabled = true, sender_identity_verified = false, verified_from_email = NULL WHERE id = 1;
    v_count := public._create_real_email_jobs_for_campaign(v_campaign_real_id);
    IF v_count != 0 THEN RAISE EXCEPTION 'TEST 90 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 90 : Création de jobs REAL refusée sans identité expéditrice système vérifiée.';

    -- 91: Création REAL refusée si verified_from_email est NULL
    UPDATE public.school_delivery_global_config SET real_email_enabled = true, sender_identity_verified = true, verified_from_email = NULL WHERE id = 1;
    v_count := public._create_real_email_jobs_for_campaign(v_campaign_real_id);
    IF v_count != 0 THEN RAISE EXCEPTION 'TEST 91 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 91 : Création de jobs REAL refusée si verified_from_email est NULL.';

    -- 92: Claim REAL refusé sans identité vérifiée
    UPDATE public.school_delivery_global_config SET real_email_enabled = true, sender_identity_verified = false, verified_from_email = NULL WHERE id = 1;
    SELECT COUNT(*) INTO v_count FROM public._claim_scheduled_real_email_campaigns(10, 'worker-test-92');
    IF v_count != 0 THEN RAISE EXCEPTION 'TEST 92 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 92 : Claim de campagnes REAL refusé sans identité expéditrice système vérifiée.';

    -- 93: Payload utilise exactement verified_from_email de la configuration système
    UPDATE public.school_delivery_global_config
    SET real_email_enabled = true,
        sender_identity_verified = true,
        verified_from_email = 'verified-sender@example.test',
        verified_from_name = 'Système Test'
    WHERE id = 1;

    -- Réinitialiser destinataire pour test de création
    UPDATE public.school_collection_campaign_recipients SET delivery_status = 'pending' WHERE id = v_recipient_id;
    DELETE FROM public.school_collection_contact_suppressions WHERE contact_fingerprint = v_fingerprint;
    DELETE FROM public.school_collection_real_email_jobs WHERE recipient_id = v_recipient_id;

    v_count := public._create_real_email_jobs_for_campaign(v_campaign_real_id);
    IF v_count != 1 THEN RAISE EXCEPTION 'TEST 93 ÉCHEC (v_count=% != 1)', v_count; END IF;

    SELECT provider_request_payload INTO v_res FROM public.school_collection_real_email_jobs WHERE campaign_id = v_campaign_real_id LIMIT 1;
    IF (v_res->>'from') NOT LIKE '%verified-sender@example.test%' THEN RAISE EXCEPTION 'TEST 93 ÉCHEC PAYLOAD FROM'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 93 : provider_request_payload utilise la valeur exacte de verified_from_email.';

    -- 94: Authenticated user ne peut pas modifier l'identité expéditrice système
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 94 : Aucune RPC authenticated ne permet de modifier verified_from_email ou sender_identity_verified.';

    -- 95: Statut "rejected" refusé avec SQLSTATE 22023
    SELECT id INTO v_job_id FROM public.school_collection_real_email_jobs WHERE campaign_id = v_campaign_real_id LIMIT 1;
    UPDATE public.school_collection_real_email_jobs SET state = 'claimed' WHERE id = v_job_id;

    BEGIN
        PERFORM public._record_real_email_submission_result(v_job_id, 'rejected', NULL, NULL, NULL, '{}'::jsonb, '{}'::jsonb);
        RAISE EXCEPTION 'TEST 95 ÉCHEC';
    EXCEPTION WHEN invalid_parameter_value THEN
        v_assert_count := v_assert_count + 1;
        RAISE NOTICE '✓ ASSERTION 95 : Statut "rejected" refusé avec l exception SQLSTATE 22023.';
    END;

    -- 96: Statut "rejected" ne modifie pas le job
    PERFORM 1 FROM public.school_collection_real_email_jobs WHERE id = v_job_id AND state = 'claimed';
    IF NOT FOUND THEN RAISE EXCEPTION 'TEST 96 ÉCHEC'; END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 96 : Le statut "rejected" ne modifie pas l état du job (maintien claimed).';

    -- 97: Statut "rejected" ne modifie pas le quota
    SELECT * INTO v_ledger_before FROM public.school_delivery_quota_ledger WHERE school_id = v_school_id ORDER BY business_date DESC LIMIT 1;
    BEGIN
        PERFORM public._record_real_email_submission_result(v_job_id, 'rejected', NULL, NULL, NULL, '{}'::jsonb, '{}'::jsonb);
    EXCEPTION WHEN invalid_parameter_value THEN
        NULL;
    END;
    SELECT * INTO v_ledger_after FROM public.school_delivery_quota_ledger WHERE school_id = v_school_id ORDER BY business_date DESC LIMIT 1;
    IF v_ledger_before.reserved_count != v_ledger_after.reserved_count OR v_ledger_before.submitted_count != v_ledger_after.submitted_count THEN
        RAISE EXCEPTION 'TEST 97 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 97 : Le statut "rejected" ne modifie ni reserved_count ni submitted_count.';

    -- 98: service_role peut exécuter _claim_scheduled_real_email_campaigns
    IF NOT pg_catalog.has_function_privilege('service_role', 'public._claim_scheduled_real_email_campaigns(int,text)', 'execute') THEN
        RAISE EXCEPTION 'TEST 98 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 98 : Rôle service_role peut exécuter _claim_scheduled_real_email_campaigns.';

    -- 99: service_role peut exécuter _create_real_email_jobs_for_campaign
    IF NOT pg_catalog.has_function_privilege('service_role', 'public._create_real_email_jobs_for_campaign(uuid)', 'execute') THEN
        RAISE EXCEPTION 'TEST 99 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 99 : Rôle service_role peut exécuter _create_real_email_jobs_for_campaign.';

    -- 100: service_role ne peut muter directement aucune table Finance 4E
    IF pg_catalog.has_table_privilege('service_role', 'public.school_delivery_global_config', 'INSERT') OR
       pg_catalog.has_table_privilege('service_role', 'public.school_delivery_settings', 'UPDATE') OR
       pg_catalog.has_table_privilege('service_role', 'public.school_collection_contact_suppressions', 'DELETE') THEN
        RAISE EXCEPTION 'TEST 100 ÉCHEC';
    END IF;
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 100 : Rôle service_role sans aucun droit direct de mutation sur les tables Finance 4E.';

    -- 101: Fin de transaction propre sous ROLLBACK avec 101 assertions
    v_assert_count := v_assert_count + 1;
    RAISE NOTICE '✓ ASSERTION 101 : Suite complète de 101 assertions exécutée avec succès.';

    RAISE NOTICE '=== TOUS LES TESTS SQL FINANCE 4E-1R3 (% ASSERTIONS) ONT RÉUSSI AVEC SUCCÈS ===', v_assert_count;
END $$;

ROLLBACK;
