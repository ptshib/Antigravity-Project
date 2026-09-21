-- Migration: 20260921140000_finance_4f1_secure_scheduler_and_observability.sql
-- Description: Scheduler sécurisé pour process-real-email-campaigns, Vault secret integration, observabilité et rétention

-- 1. Activation conditionnelle des extensions (dans le schéma extensions)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Table d'observabilité des exécutions du scheduler/worker
CREATE TABLE IF NOT EXISTS public.school_delivery_scheduler_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cron_job_name VARCHAR(60) NOT NULL DEFAULT 'process-real-email-campaigns-cron',
    execution_mode VARCHAR(20) NOT NULL DEFAULT 'disabled',
    status_code INT NULL,
    campaigns_claimed INT NOT NULL DEFAULT 0,
    jobs_claimed INT NOT NULL DEFAULT 0,
    submitted INT NOT NULL DEFAULT 0,
    retry_wait INT NOT NULL DEFAULT 0,
    network_unknown INT NOT NULL DEFAULT 0,
    terminal_failed INT NOT NULL DEFAULT 0,
    errors_count INT NOT NULL DEFAULT 0,
    error_summary JSONB NULL,
    duration_ms INT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_executed_at
ON public.school_delivery_scheduler_runs (executed_at DESC);

ALTER TABLE public.school_delivery_scheduler_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_delivery_scheduler_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_delivery_scheduler_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.school_delivery_scheduler_runs TO service_role;
ALTER TABLE public.school_delivery_scheduler_runs OWNER TO postgres;

-- 3. Rétention et nettoyage automatique (default 30 jours)
CREATE OR REPLACE FUNCTION public._cleanup_old_scheduler_runs(p_retention_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted_count INT;
    v_cutoff TIMESTAMPTZ;
BEGIN
    v_cutoff := pg_catalog.clock_timestamp() - (p_retention_days || ' days')::INTERVAL;
    
    DELETE FROM public.school_delivery_scheduler_runs
    WHERE executed_at < v_cutoff;
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public._cleanup_old_scheduler_runs FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._cleanup_old_scheduler_runs TO service_role;
ALTER FUNCTION public._cleanup_old_scheduler_runs OWNER TO postgres;

-- 4. Helper de résolution sécurisée du secret Worker depuis Vault ou App Settings (zéro secret en clair)
CREATE OR REPLACE FUNCTION public._get_worker_secret()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret TEXT;
BEGIN
    -- 1. Recherche dans Supabase Vault (vault.decrypted_secrets)
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'vault'
    ) AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vault' AND c.relname = 'decrypted_secrets'
    ) THEN
        EXECUTE 'SELECT secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
        INTO v_secret
        USING 'FINANCE_EMAIL_WORKER_SECRET';

        IF v_secret IS NOT NULL AND pg_catalog.btrim(v_secret) <> '' THEN
            RETURN v_secret;
        END IF;
    END IF;

    -- 2. Fallback via configuration de session dynamiquement injectée (app.settings.worker_secret)
    v_secret := pg_catalog.current_setting('app.settings.worker_secret', true);
    IF v_secret IS NOT NULL AND pg_catalog.btrim(v_secret) <> '' THEN
        RETURN v_secret;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._get_worker_secret FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._get_worker_secret TO service_role;
ALTER FUNCTION public._get_worker_secret OWNER TO postgres;

-- 5. RPC de journalisation sécurisée du résumé d'exécution (Option A: invoqué par le worker ou trigger)
CREATE OR REPLACE FUNCTION public._record_worker_run_summary(
    p_cron_job_name TEXT DEFAULT 'process-real-email-campaigns-cron',
    p_execution_mode TEXT DEFAULT 'disabled',
    p_status_code INT DEFAULT 200,
    p_campaigns_claimed INT DEFAULT 0,
    p_jobs_claimed INT DEFAULT 0,
    p_submitted INT DEFAULT 0,
    p_retry_wait INT DEFAULT 0,
    p_network_unknown INT DEFAULT 0,
    p_terminal_failed INT DEFAULT 0,
    p_errors_count INT DEFAULT 0,
    p_error_summary JSONB DEFAULT NULL,
    p_duration_ms INT DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run_id UUID;
BEGIN
    INSERT INTO public.school_delivery_scheduler_runs (
        cron_job_name, execution_mode, status_code,
        campaigns_claimed, jobs_claimed, submitted, retry_wait,
        network_unknown, terminal_failed, errors_count,
        error_summary, duration_ms, executed_at
    ) VALUES (
        COALESCE(p_cron_job_name, 'process-real-email-campaigns-cron'),
        COALESCE(p_execution_mode, 'disabled'),
        p_status_code,
        p_campaigns_claimed, p_jobs_claimed, p_submitted, p_retry_wait,
        p_network_unknown, p_terminal_failed, p_errors_count,
        p_error_summary, p_duration_ms, pg_catalog.clock_timestamp()
    ) RETURNING id INTO v_run_id;

    RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public._record_worker_run_summary FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._record_worker_run_summary TO service_role;
ALTER FUNCTION public._record_worker_run_summary OWNER TO postgres;

-- 6. Trigger et fonction d'invocation sécurisée du worker
CREATE OR REPLACE FUNCTION public.trigger_real_email_worker_cron()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_global_config public.school_delivery_global_config%ROWTYPE;
    v_worker_secret TEXT;
    v_project_url TEXT;
    v_worker_url TEXT;
    v_net_request_id BIGINT;
    v_start_time TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_run_id UUID;
BEGIN
    -- Contrôle de la readiness globale
    SELECT * INTO v_global_config FROM public.school_delivery_global_config WHERE id = 1;
    IF v_global_config.id IS NULL
       OR v_global_config.real_email_enabled IS NOT TRUE
       OR v_global_config.sender_identity_verified IS NOT TRUE
       OR v_global_config.verified_from_email IS NULL
       OR pg_catalog.btrim(v_global_config.verified_from_email) = '' THEN
        -- Mode désactivé : Enregistrer l'audit inoffensif sans appel HTTP
        v_run_id := public._record_worker_run_summary(
            p_cron_job_name => 'process-real-email-campaigns-cron',
            p_execution_mode => 'disabled',
            p_status_code => 200,
            p_duration_ms => 0
        );
        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'disabled_global_switches', 'run_id', v_run_id);
    END IF;

    -- Récupération sécurisée du secret
    v_worker_secret := public._get_worker_secret();
    IF v_worker_secret IS NULL OR pg_catalog.btrim(v_worker_secret) = '' THEN
        v_run_id := public._record_worker_run_summary(
            p_cron_job_name => 'process-real-email-campaigns-cron',
            p_execution_mode => 'disabled',
            p_status_code => 401,
            p_errors_count => 1,
            p_error_summary => pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('message', 'WORKER_SECRET_MISSING_IN_VAULT')),
            p_duration_ms => 0
        );
        RETURN pg_catalog.jsonb_build_object('success', false, 'status', 'worker_secret_missing', 'run_id', v_run_id);
    END IF;

    -- Résolution de l'URL du projet Supabase
    v_project_url := pg_catalog.current_setting('app.settings.supabase_url', true);
    IF v_project_url IS NULL OR pg_catalog.btrim(v_project_url) = '' THEN
        v_project_url := 'http://localhost:54321';
    END IF;
    v_worker_url := v_project_url || '/functions/v1/process-real-email-campaigns';

    -- Si pg_net est disponible, effectuer l'appel HTTP sécurisé (asynchrone)
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'net'
    ) AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'net' AND p.proname = 'http_post'
    ) THEN
        EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3)'
        INTO v_net_request_id
        USING v_worker_url,
              pg_catalog.jsonb_build_object(
                  'Content-Type', 'application/json',
                  'Authorization', 'Bearer ' || v_worker_secret
              ),
              pg_catalog.jsonb_build_object('limit', 10);

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'http_triggered', 'net_request_id', v_net_request_id);
    ELSE
        v_run_id := public._record_worker_run_summary(
            p_cron_job_name => 'process-real-email-campaigns-cron',
            p_execution_mode => 'disabled',
            p_status_code => 200,
            p_duration_ms => 0
        );
        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'pg_net_not_loaded', 'run_id', v_run_id);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_real_email_worker_cron FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_real_email_worker_cron TO service_role;
ALTER FUNCTION public.trigger_real_email_worker_cron OWNER TO postgres;

-- 7. Fonctions d'administration du Cron Job (Idempotentes et sécurisées)
CREATE OR REPLACE FUNCTION public.schedule_real_email_worker_cron()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
    ) AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'cron' AND p.proname = 'unschedule'
    ) THEN
        BEGIN
            EXECUTE 'SELECT cron.unschedule($1)' USING 'process-real-email-campaigns-cron';
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;

        EXECUTE 'SELECT cron.schedule($1, $2, $3)'
        USING 'process-real-email-campaigns-cron',
              '*/5 * * * *',
              'SELECT public.trigger_real_email_worker_cron();';

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'cron_scheduled', 'schedule', '*/5 * * * *');
    END IF;

    RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'pg_cron_not_installed');
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_real_email_worker_cron FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_real_email_worker_cron TO service_role;
ALTER FUNCTION public.schedule_real_email_worker_cron OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.disable_real_email_worker_cron()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
    ) AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'cron' AND p.proname = 'unschedule'
    ) THEN
        BEGIN
            EXECUTE 'SELECT cron.unschedule($1)' USING 'process-real-email-campaigns-cron';
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'cron_unscheduled');
    END IF;

    RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'pg_cron_not_installed');
END;
$$;

REVOKE ALL ON FUNCTION public.disable_real_email_worker_cron FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disable_real_email_worker_cron TO service_role;
ALTER FUNCTION public.disable_real_email_worker_cron OWNER TO postgres;
