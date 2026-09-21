-- Test Suite: 20260921140000_finance_4f1_secure_scheduler_and_observability_tests.sql
-- Validation du scheduler sécurisé, de l'observabilité et des gardes-fous de sécurité

BEGIN;

DO $$
DECLARE
    v_res JSONB;
    v_run_rec RECORD;
    v_secret TEXT;
    v_deleted INT;
BEGIN
    SET LOCAL session_replication_role = 'replica';

    -- 1. Configuration globale désactivée (Readiness = false)
    INSERT INTO public.school_delivery_global_config (id, real_email_enabled, sender_identity_verified, verified_from_email)
    VALUES (1, false, false, NULL)
    ON CONFLICT (id) DO UPDATE
    SET real_email_enabled = false, sender_identity_verified = false, verified_from_email = NULL;

    SET LOCAL session_replication_role = 'origin';

    -- 2. Test: Invocateur de worker quand les switches globaux sont désactivés
    v_res := public.trigger_real_email_worker_cron();
    IF v_res->>'status' <> 'disabled_global_switches' THEN
        RAISE EXCEPTION 'TEST 4F1-1 ECHEC : Statut inattendu quand désactivé (%)', v_res->>'status';
    END IF;

    -- Vérification de l'entrée dans la table d'observabilité
    SELECT * INTO v_run_rec FROM public.school_delivery_scheduler_runs ORDER BY executed_at DESC LIMIT 1;
    IF v_run_rec.id IS NULL OR v_run_rec.execution_mode <> 'disabled' THEN
        RAISE EXCEPTION 'TEST 4F1-2 ECHEC : Enregistrement d''observabilité inattendu';
    END IF;

    -- 3. Test: Helper de résolution sécurisée du secret via App Settings (session)
    PERFORM pg_catalog.set_config('app.settings.worker_secret', 'test-secret-vault-dummy', true);
    v_secret := public._get_worker_secret();
    IF v_secret <> 'test-secret-vault-dummy' THEN
        RAISE EXCEPTION 'TEST 4F1-3 ECHEC : Le secret n''a pas été résolu correctement (obtenu: %)', v_secret;
    END IF;

    -- 4. Test: Idempotence et absence de crash des helpers de scheduling cron
    v_res := public.schedule_real_email_worker_cron();
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST 4F1-4 ECHEC : schedule_real_email_worker_cron a échoué';
    END IF;

    v_res := public.disable_real_email_worker_cron();
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST 4F1-5 ECHEC : disable_real_email_worker_cron a échoué';
    END IF;

    -- 5. Test: Nettoyage et rétention de l'observabilité
    INSERT INTO public.school_delivery_scheduler_runs (
        cron_job_name, execution_mode, executed_at
    ) VALUES (
        'process-real-email-campaigns-cron', 'disabled', NOW() - INTERVAL '40 days'
    );

    v_deleted := public._cleanup_old_scheduler_runs(30);
    IF v_deleted < 1 THEN
        RAISE EXCEPTION 'TEST 4F1-6 ECHEC : _cleanup_old_scheduler_runs doit avoir supprimé au moins 1 enregistrement obsolète';
    END IF;

    -- 6. Test: RPC _record_worker_run_summary (Option A) écriture directe du résumé par le worker
    PERFORM public._record_worker_run_summary(
        p_cron_job_name => 'process-real-email-campaigns-cron',
        p_execution_mode => 'test',
        p_status_code => 200,
        p_campaigns_claimed => 2,
        p_jobs_claimed => 5,
        p_submitted => 4,
        p_retry_wait => 1,
        p_network_unknown => 0,
        p_terminal_failed => 0,
        p_errors_count => 0,
        p_duration_ms => 245
    );

    SELECT * INTO v_run_rec FROM public.school_delivery_scheduler_runs ORDER BY executed_at DESC LIMIT 1;
    IF v_run_rec.execution_mode <> 'test' OR v_run_rec.submitted <> 4 OR v_run_rec.duration_ms <> 245 THEN
        RAISE EXCEPTION 'TEST 4F1-7 ECHEC : _record_worker_run_summary n''a pas enregistré les métriques exactes';
    END IF;

    -- 7. Test: Permissions de sécurité strictes (REVOKE ALL FROM PUBLIC, anon, authenticated)
    IF pg_catalog.has_function_privilege('authenticated', 'public.trigger_real_email_worker_cron()', 'EXECUTE') THEN
        RAISE EXCEPTION 'TEST 4F1-8 ECHEC : trigger_real_email_worker_cron ne doit PAS être exécutable par authenticated';
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', 'public.schedule_real_email_worker_cron()', 'EXECUTE') THEN
        RAISE EXCEPTION 'TEST 4F1-9 ECHEC : schedule_real_email_worker_cron ne doit PAS être exécutable par authenticated';
    END IF;
    IF pg_catalog.has_function_privilege('anon', 'public._record_worker_run_summary(text,text,int,int,int,int,int,int,int,int,jsonb,int)', 'EXECUTE') THEN
        RAISE EXCEPTION 'TEST 4F1-10 ECHEC : _record_worker_run_summary ne doit PAS être exécutable par anon';
    END IF;
    IF pg_catalog.has_table_privilege('authenticated', 'public.school_delivery_scheduler_runs', 'SELECT') THEN
        RAISE EXCEPTION 'TEST 4F1-11 ECHEC : school_delivery_scheduler_runs ne doit PAS être lisible par authenticated';
    END IF;

    RAISE NOTICE '✓ SUITE SQL 4F-1 : Scheduler sécurisé, observabilité Option A, permissions et secret validés avec succès';
END;
$$;

ROLLBACK;
