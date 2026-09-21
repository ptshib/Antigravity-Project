-- Migration: 20260921000000_finance_4e6_fix_real_email_claim_rpc.sql
-- Description: Correct SQL UPDATE FROM clause in _claim_scheduled_real_email_campaigns (fix 42P01 alias reference error)

CREATE OR REPLACE FUNCTION public._claim_scheduled_real_email_campaigns(
    p_batch_size INT DEFAULT 5,
    p_worker_id TEXT DEFAULT 'real-email-worker-1'
)
RETURNS TABLE (
    campaign_id UUID,
    school_id UUID,
    channel TEXT,
    recipient_count INT,
    from_name TEXT,
    reply_to_email TEXT,
    daily_quota INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker_id TEXT;
    v_global_config public.school_delivery_global_config%ROWTYPE;
BEGIN
    SELECT * INTO v_global_config FROM public.school_delivery_global_config WHERE id = 1;
    IF v_global_config.id IS NULL
       OR v_global_config.real_email_enabled IS NOT TRUE
       OR v_global_config.sender_identity_verified IS NOT TRUE
       OR v_global_config.verified_from_email IS NULL
       OR pg_catalog.btrim(v_global_config.verified_from_email) = '' THEN
        RETURN;
    END IF;

    IF p_batch_size < 1 OR p_batch_size > 100 THEN
        RAISE EXCEPTION 'REJET : p_batch_size doit être compris entre 1 et 100.' USING ERRCODE = '22023';
    END IF;

    IF p_worker_id IS NULL THEN
        RAISE EXCEPTION 'REJET : p_worker_id ne peut pas être NULL.' USING ERRCODE = '22023';
    END IF;
    v_worker_id := pg_catalog.btrim(p_worker_id);

    RETURN QUERY
    WITH target_campaigns AS (
        SELECT c.id, c.school_id
        FROM public.school_collection_campaigns c
        JOIN public.school_delivery_settings s ON s.school_id = c.school_id
        WHERE c.status = 'scheduled'
          AND c.delivery_mode = 'real'
          AND c.channel = 'email'
          AND s.email_real_enabled = TRUE
          AND (c.scheduled_at IS NULL OR c.scheduled_at <= pg_catalog.clock_timestamp())
        ORDER BY c.scheduled_at ASC, c.created_at ASC, c.id ASC
        FOR UPDATE OF c SKIP LOCKED
        LIMIT p_batch_size
    )
    UPDATE public.school_collection_campaigns c
    SET status = 'processing',
        claimed_at = pg_catalog.clock_timestamp(),
        claimed_by = v_worker_id,
        processing_started_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    FROM target_campaigns tc
    JOIN public.school_delivery_settings s ON s.school_id = tc.school_id
    WHERE c.id = tc.id
    RETURNING
        c.id AS campaign_id,
        c.school_id,
        c.channel::text AS channel,
        c.recipient_count,
        s.from_name,
        s.reply_to_email,
        s.daily_email_quota AS daily_quota;
END;
$$;

REVOKE ALL ON FUNCTION public._claim_scheduled_real_email_campaigns FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._claim_scheduled_real_email_campaigns TO service_role;
ALTER FUNCTION public._claim_scheduled_real_email_campaigns OWNER TO postgres;
