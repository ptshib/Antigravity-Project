-- =============================================================================
-- ÉCOLECONNECT — MIGRATION FINANCE 4C-1 (REVUE ET DURCIE AVEC EXCLUSIVITÉ DE STATUT)
-- Fichier: 20260918130000_finance_4c_collection_dashboard_and_priorities.sql
-- Description: Dashboard de suivi du recouvrement (15 KPIs / devise)
--              et Liste priorisée avec Keyset Pagination N+1 déterministe
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. NOUVEL INDEX OPTIMISÉ POUR ACTIVITÉ 7 ET 30 JOURS
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_collection_actions_school_contacted
ON public.school_invoice_collection_actions (school_id, contacted_at DESC);

-- -----------------------------------------------------------------------------
-- 2. HELPER INTERNE PRIVÉ: _evaluate_school_collection_invoices(...)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._evaluate_school_collection_invoices(
    p_school_id UUID,
    p_business_date DATE
)
RETURNS TABLE (
    invoice_id UUID,
    invoice_number TEXT,
    student_id UUID,
    student_name TEXT,
    student_number TEXT,
    class_name TEXT,
    invoice_due_date DATE,
    days_overdue INTEGER,
    currency TEXT,
    total_amount NUMERIC,
    paid_amount NUMERIC,
    remaining_balance NUMERIC,
    invoice_status TEXT,
    collection_status TEXT,
    priority_level TEXT,
    priority_score INTEGER,
    priority_reasons JSONB,
    effective_follow_up_date DATE,
    latest_action_id UUID,
    latest_action_type TEXT,
    latest_contacted_at TIMESTAMPTZ,
    latest_promise_to_pay_date DATE,
    latest_next_follow_up_date DATE,
    last_contacted_by_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    WITH invoice_base AS (
        SELECT
            inv.id AS b_invoice_id,
            inv.invoice_number AS b_invoice_number,
            inv.student_id AS b_student_id,
            pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS b_student_name,
            st.student_number AS b_student_number,
            c.name AS b_class_name,
            inv.due_date AS b_invoice_due_date,
            (p_business_date - inv.due_date)::INTEGER AS b_days_overdue,
            inv.currency AS b_currency,
            inv.total_amount AS b_total_amount,
            inv.paid_amount AS b_paid_amount,
            inv.remaining_balance AS b_remaining_balance,
            inv.status AS b_invoice_status,
            act.id AS b_latest_action_id,
            act.action_type AS b_latest_action_type,
            act.note AS b_latest_note,
            act.idempotency_key AS b_latest_idempotency_key,
            act.contacted_at AS b_latest_contacted_at,
            act.promise_to_pay_date AS b_latest_promise_to_pay_date,
            act.next_follow_up_date AS b_latest_next_follow_up_date,
            pg_catalog.btrim(pg_catalog.concat_ws(' ', pr.first_name, pr.last_name)) AS b_last_contacted_by_name
        FROM public.student_invoices inv
        JOIN public.students st ON st.id = inv.student_id AND st.school_id = inv.school_id
        JOIN public.classes c ON c.id = inv.class_id AND c.school_id = inv.school_id
        LEFT JOIN LATERAL (
            SELECT a.*
            FROM public.school_invoice_collection_actions a
            WHERE a.invoice_id = inv.id AND a.school_id = inv.school_id
            ORDER BY a.contacted_at DESC, a.created_at DESC, a.id DESC
            LIMIT 1
        ) act ON TRUE
        LEFT JOIN public.profiles pr ON pr.id = act.created_by
        WHERE inv.school_id = p_school_id
          AND inv.status IN ('issued', 'partially_paid')
          AND inv.remaining_balance > 0
          AND inv.due_date < p_business_date
    ),
    evaluated AS (
        SELECT
            ib.*,
            -- collection_status canonique (précédence stricte Finance 4B)
            CASE
                WHEN ib.b_latest_action_id IS NULL THEN 'never_contacted'
                WHEN ib.b_latest_promise_to_pay_date IS NOT NULL AND ib.b_latest_promise_to_pay_date < p_business_date THEN 'promise_overdue'
                WHEN ib.b_latest_next_follow_up_date IS NOT NULL AND ib.b_latest_next_follow_up_date <= p_business_date THEN 'followup_due'
                WHEN ib.b_latest_promise_to_pay_date IS NOT NULL AND ib.b_latest_promise_to_pay_date >= p_business_date THEN 'promise_pending'
                ELSE 'contacted'
            END AS e_collection_status,

            -- effective_follow_up_date
            COALESCE(ib.b_latest_next_follow_up_date, ib.b_latest_promise_to_pay_date, ib.b_invoice_due_date) AS e_effective_follow_up_date,

            -- Calcul cumulatif des scores R1 -> R7
            (
                -- R1 (+100) : Promesse dépassée
                (CASE WHEN ib.b_latest_promise_to_pay_date IS NOT NULL AND ib.b_latest_promise_to_pay_date < p_business_date THEN 100 ELSE 0 END) +

                -- R2 (+80) : Jamais relancée et retard > 60 jours
                (CASE WHEN ib.b_latest_action_id IS NULL AND ib.b_days_overdue > 60 THEN 80 ELSE 0 END) +

                -- R3 (+60) : Relance dépassée de plus de 7 jours (next_follow_up_date < p_business_date - 7)
                (CASE WHEN ib.b_latest_next_follow_up_date IS NOT NULL AND ib.b_latest_next_follow_up_date < (p_business_date - 7) THEN 60 ELSE 0 END) +

                -- R4 (+40) : Retard > 90 jours ET AUCUNE PROMESSE (b_latest_promise_to_pay_date IS NULL)
                (CASE WHEN ib.b_days_overdue > 90 AND ib.b_latest_promise_to_pay_date IS NULL THEN 40 ELSE 0 END) +

                -- R5 (+30) : Relance due entre (business_date - 7) et business_date
                (CASE WHEN ib.b_latest_next_follow_up_date IS NOT NULL AND ib.b_latest_next_follow_up_date BETWEEN (p_business_date - 7) AND p_business_date THEN 30 ELSE 0 END) +

                -- R6 (+20) : Jamais relancée et retard entre 31 et 60 jours
                (CASE WHEN ib.b_latest_action_id IS NULL AND ib.b_days_overdue BETWEEN 31 AND 60 THEN 20 ELSE 0 END) +

                -- R7 (+10) : Solde restant dû important (USD >= 500 ou CDF >= 1000000)
                (CASE WHEN (ib.b_currency = 'USD' AND ib.b_remaining_balance >= 500) OR (ib.b_currency = 'CDF' AND ib.b_remaining_balance >= 1000000) THEN 10 ELSE 0 END)
            )::INTEGER AS e_score,

            -- Génération ordonnée du tableau JSONB priority_reasons (R1 -> R7)
            (
                SELECT COALESCE(pg_catalog.jsonb_agg(r.reason), '[]'::jsonb)
                FROM (
                    SELECT 1 AS ord, pg_catalog.concat('Promesse de paiement dépassée depuis le ', ib.b_latest_promise_to_pay_date::TEXT) AS reason
                    WHERE ib.b_latest_promise_to_pay_date IS NOT NULL AND ib.b_latest_promise_to_pay_date < p_business_date

                    UNION ALL
                    SELECT 2 AS ord, 'Créance de plus de 60 jours sans aucun contact' AS reason
                    WHERE ib.b_latest_action_id IS NULL AND ib.b_days_overdue > 60

                    UNION ALL
                    SELECT 3 AS ord, pg_catalog.concat('Date de relance dépassée de plus de 7 jours (dû le ', ib.b_latest_next_follow_up_date::TEXT, ')') AS reason
                    WHERE ib.b_latest_next_follow_up_date IS NOT NULL AND ib.b_latest_next_follow_up_date < (p_business_date - 7)

                    UNION ALL
                    SELECT 4 AS ord, 'Créance très ancienne (> 90 jours) sans promesse de paiement' AS reason
                    WHERE ib.b_days_overdue > 90 AND ib.b_latest_promise_to_pay_date IS NULL

                    UNION ALL
                    SELECT 5 AS ord, pg_catalog.concat('Relance à effectuer (dû le ', ib.b_latest_next_follow_up_date::TEXT, ')') AS reason
                    WHERE ib.b_latest_next_follow_up_date IS NOT NULL AND ib.b_latest_next_follow_up_date BETWEEN (p_business_date - 7) AND p_business_date

                    UNION ALL
                    SELECT 6 AS ord, 'Créance entre 31 et 60 jours sans aucun contact' AS reason
                    WHERE ib.b_latest_action_id IS NULL AND ib.b_days_overdue BETWEEN 31 AND 60

                    UNION ALL
                    SELECT 7 AS ord, 'Solde restant dû important' AS reason
                    WHERE (ib.b_currency = 'USD' AND ib.b_remaining_balance >= 500) OR (ib.b_currency = 'CDF' AND ib.b_remaining_balance >= 1000000)

                    ORDER BY ord ASC
                ) r
            ) AS e_reasons
        FROM invoice_base ib
    )
    SELECT
        e.b_invoice_id AS invoice_id,
        e.b_invoice_number AS invoice_number,
        e.b_student_id AS student_id,
        e.b_student_name AS student_name,
        e.b_student_number AS student_number,
        e.b_class_name AS class_name,
        e.b_invoice_due_date AS invoice_due_date,
        e.b_days_overdue AS days_overdue,
        e.b_currency AS currency,
        e.b_total_amount AS total_amount,
        e.b_paid_amount AS paid_amount,
        e.b_remaining_balance AS remaining_balance,
        e.b_invoice_status AS invoice_status,
        e.e_collection_status AS collection_status,
        (CASE WHEN e.e_score >= 80 THEN 'critical' WHEN e.e_score BETWEEN 30 AND 79 THEN 'high' ELSE 'normal' END) AS priority_level,
        e.e_score AS priority_score,
        e.e_reasons AS priority_reasons,
        e.e_effective_follow_up_date AS effective_follow_up_date,
        e.b_latest_action_id AS latest_action_id,
        e.b_latest_action_type AS latest_action_type,
        e.b_latest_contacted_at AS latest_contacted_at,
        e.b_latest_promise_to_pay_date AS latest_promise_to_pay_date,
        e.b_latest_next_follow_up_date AS latest_next_follow_up_date,
        e.b_last_contacted_by_name AS last_contacted_by_name
    FROM evaluated e;
END;
$$;

REVOKE ALL ON FUNCTION public._evaluate_school_collection_invoices(UUID, DATE) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public._evaluate_school_collection_invoices(UUID, DATE) OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 3. RPC PUBLIQUE: get_school_collection_dashboard()
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_collection_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_profile public.profiles%ROWTYPE;
    v_school public.schools%ROWTYPE;
    v_valid_tz TEXT;
    v_business_date DATE;
    v_evaluated_at_utc TIMESTAMPTZ;
    v_tz_fallback BOOLEAN := FALSE;

    v_7_start_utc TIMESTAMPTZ;
    v_30_start_utc TIMESTAMPTZ;
    v_next_day_utc TIMESTAMPTZ;

    v_result JSONB;
BEGIN
    -- 1. Auth & Profil
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated access' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id;
    IF v_profile.id IS NULL OR v_profile.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('school_admin', 'finance_agent') THEN
        RAISE EXCEPTION 'Forbidden: insufficient finance privileges' USING ERRCODE = '42501';
    END IF;

    -- 2. École & Timezone
    SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
    IF v_school.id IS NULL OR v_school.status != 'active' THEN
        RAISE EXCEPTION 'Active school required' USING ERRCODE = '42501';
    END IF;

    IF v_school.timezone IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_school.timezone
    ) THEN
        v_valid_tz := v_school.timezone;
        v_tz_fallback := FALSE;
    ELSE
        v_valid_tz := 'Africa/Kinshasa';
        v_tz_fallback := TRUE;
    END IF;

    v_evaluated_at_utc := pg_catalog.now();
    v_business_date := (v_evaluated_at_utc AT TIME ZONE v_valid_tz)::DATE;

    -- Bornes UTC indexables pour l'activité 7j et 30j
    v_7_start_utc := ((v_business_date - 6)::TIMESTAMP AT TIME ZONE v_valid_tz);
    v_30_start_utc := ((v_business_date - 29)::TIMESTAMP AT TIME ZONE v_valid_tz);
    v_next_day_utc := ((v_business_date + 1)::TIMESTAMP AT TIME ZONE v_valid_tz);

    -- 3. Calcul des 15 KPIs par devise (USD et CDF) avec mutuelle exclusivité stricte des statuts
    WITH evaluated_data AS (
        SELECT *
        FROM public._evaluate_school_collection_invoices(v_school.id, v_business_date)
    ),
    activity_7_30 AS (
        SELECT
            inv.currency,
            COALESCE(COUNT(*) FILTER (WHERE act.contacted_at >= v_7_start_utc AND act.contacted_at < v_next_day_utc), 0)::INTEGER AS act_7_cnt,
            COALESCE(COUNT(*) FILTER (WHERE act.contacted_at >= v_30_start_utc AND act.contacted_at < v_next_day_utc), 0)::INTEGER AS act_30_cnt
        FROM public.school_invoice_collection_actions act
        JOIN public.student_invoices inv ON inv.id = act.invoice_id AND inv.school_id = act.school_id
        WHERE act.school_id = v_school.id
          AND inv.currency IN ('USD', 'CDF')
        GROUP BY inv.currency
    ),
    currency_kpis AS (
        SELECT
            c.curr AS currency,

            -- 1 & 2. Total overdue amount & count
            COALESCE(ROUND(SUM(ed.remaining_balance), 2), 0.00) AS total_overdue_amount,
            COALESCE(COUNT(ed.invoice_id), 0)::INTEGER AS total_overdue_count,

            -- 3 & 4. Never contacted amount & count (collection_status = 'never_contacted')
            COALESCE(ROUND(SUM(ed.remaining_balance) FILTER (WHERE ed.collection_status = 'never_contacted'), 2), 0.00) AS never_contacted_amount,
            COALESCE(COUNT(ed.invoice_id) FILTER (WHERE ed.collection_status = 'never_contacted'), 0)::INTEGER AS never_contacted_count,

            -- 5. Followup due count (collection_status = 'followup_due')
            COALESCE(COUNT(ed.invoice_id) FILTER (WHERE ed.collection_status = 'followup_due'), 0)::INTEGER AS followup_due_count,

            -- 6 & 7. Promise pending amount & count (collection_status = 'promise_pending')
            COALESCE(ROUND(SUM(ed.remaining_balance) FILTER (WHERE ed.collection_status = 'promise_pending'), 2), 0.00) AS promise_pending_amount,
            COALESCE(COUNT(ed.invoice_id) FILTER (WHERE ed.collection_status = 'promise_pending'), 0)::INTEGER AS promise_pending_count,

            -- 8 & 9. Promise overdue amount & count (collection_status = 'promise_overdue')
            COALESCE(ROUND(SUM(ed.remaining_balance) FILTER (WHERE ed.collection_status = 'promise_overdue'), 2), 0.00) AS promise_overdue_amount,
            COALESCE(COUNT(ed.invoice_id) FILTER (WHERE ed.collection_status = 'promise_overdue'), 0)::INTEGER AS promise_overdue_count,

            -- 10 & 11. Actions 7 & 30 days count
            COALESCE(act.act_7_cnt, 0)::INTEGER AS actions_last_7_days_count,
            COALESCE(act.act_30_cnt, 0)::INTEGER AS actions_last_30_days_count,

            -- 12. Collection coverage rate (% d'échues ayant au moins 1 action)
            CASE
                WHEN COUNT(ed.invoice_id) > 0 THEN
                    ROUND((COUNT(ed.invoice_id) FILTER (WHERE ed.latest_action_id IS NOT NULL)::NUMERIC / COUNT(ed.invoice_id)::NUMERIC) * 100.0, 2)
                ELSE 0.00
            END AS collection_coverage_rate,

            -- 13. Average overdue days (entier arrondi non-pondéré)
            CASE
                WHEN COUNT(ed.invoice_id) > 0 THEN
                    ROUND(AVG(ed.days_overdue), 0)::INTEGER
                ELSE 0
            END AS average_overdue_days,

            -- 14 & 15. Critical & High priority counts
            COALESCE(COUNT(ed.invoice_id) FILTER (WHERE ed.priority_level = 'critical'), 0)::INTEGER AS critical_priority_count,
            COALESCE(COUNT(ed.invoice_id) FILTER (WHERE ed.priority_level = 'high'), 0)::INTEGER AS high_priority_count

        FROM (VALUES ('USD'), ('CDF')) AS c(curr)
        LEFT JOIN evaluated_data ed ON ed.currency = c.curr
        LEFT JOIN activity_7_30 act ON act.currency = c.curr
        GROUP BY c.curr, act.act_7_cnt, act.act_30_cnt
    )
    SELECT pg_catalog.jsonb_build_object(
        'meta', pg_catalog.jsonb_build_object(
            'school_id', v_school.id,
            'school_timezone', v_valid_tz,
            'timezone_fallback_applied', v_tz_fallback,
            'evaluated_at_utc', pg_catalog.to_char(v_evaluated_at_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'business_date', v_business_date
        ),
        'currencies', pg_catalog.jsonb_build_object(
            'USD', (
                SELECT pg_catalog.jsonb_build_object(
                    'currency', 'USD',
                    'total_overdue_amount', k.total_overdue_amount,
                    'total_overdue_count', k.total_overdue_count,
                    'never_contacted_amount', k.never_contacted_amount,
                    'never_contacted_count', k.never_contacted_count,
                    'followup_due_count', k.followup_due_count,
                    'promise_pending_amount', k.promise_pending_amount,
                    'promise_pending_count', k.promise_pending_count,
                    'promise_overdue_amount', k.promise_overdue_amount,
                    'promise_overdue_count', k.promise_overdue_count,
                    'actions_last_7_days_count', k.actions_last_7_days_count,
                    'actions_last_30_days_count', k.actions_last_30_days_count,
                    'collection_coverage_rate', k.collection_coverage_rate,
                    'average_overdue_days', k.average_overdue_days,
                    'critical_priority_count', k.critical_priority_count,
                    'high_priority_count', k.high_priority_count
                ) FROM currency_kpis k WHERE k.currency = 'USD'
            ),
            'CDF', (
                SELECT pg_catalog.jsonb_build_object(
                    'currency', 'CDF',
                    'total_overdue_amount', k.total_overdue_amount,
                    'total_overdue_count', k.total_overdue_count,
                    'never_contacted_amount', k.never_contacted_amount,
                    'never_contacted_count', k.never_contacted_count,
                    'followup_due_count', k.followup_due_count,
                    'promise_pending_amount', k.promise_pending_amount,
                    'promise_pending_count', k.promise_pending_count,
                    'promise_overdue_amount', k.promise_overdue_amount,
                    'promise_overdue_count', k.promise_overdue_count,
                    'actions_last_7_days_count', k.actions_last_7_days_count,
                    'actions_last_30_days_count', k.actions_last_30_days_count,
                    'collection_coverage_rate', k.collection_coverage_rate,
                    'average_overdue_days', k.average_overdue_days,
                    'critical_priority_count', k.critical_priority_count,
                    'high_priority_count', k.high_priority_count
                ) FROM currency_kpis k WHERE k.currency = 'CDF'
            )
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_school_collection_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_collection_dashboard() TO authenticated;
ALTER FUNCTION public.get_school_collection_dashboard() OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 4. RPC PUBLIQUE: get_school_collection_priorities(...)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_collection_priorities(
    p_currency TEXT DEFAULT NULL,
    p_priority_filter TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_cursor_priority_score INTEGER DEFAULT NULL,
    p_cursor_effective_date DATE DEFAULT NULL,
    p_cursor_invoice_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_profile public.profiles%ROWTYPE;
    v_school public.schools%ROWTYPE;
    v_valid_tz TEXT;
    v_business_date DATE;
    v_limit INTEGER;

    v_has_more BOOLEAN := FALSE;
    v_next_cursor JSONB := NULL;
    v_items JSONB := '[]'::jsonb;

    v_rec RECORD;
    v_row_count INTEGER := 0;
    v_last_priority_score INTEGER := NULL;
    v_last_effective_date DATE := NULL;
    v_last_invoice_id UUID := NULL;
BEGIN
    -- 1. Auth & Profil
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated access' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id;
    IF v_profile.id IS NULL OR v_profile.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('school_admin', 'finance_agent') THEN
        RAISE EXCEPTION 'Forbidden: insufficient finance privileges' USING ERRCODE = '42501';
    END IF;

    -- 2. École & Timezone
    SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
    IF v_school.id IS NULL OR v_school.status != 'active' THEN
        RAISE EXCEPTION 'Active school required' USING ERRCODE = '42501';
    END IF;

    IF v_school.timezone IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_school.timezone
    ) THEN
        v_valid_tz := v_school.timezone;
    ELSE
        v_valid_tz := 'Africa/Kinshasa';
    END IF;

    v_business_date := (pg_catalog.now() AT TIME ZONE v_valid_tz)::DATE;

    -- 3. Validations 22023
    IF p_limit IS NULL THEN
        v_limit := 20;
    ELSIF p_limit <= 0 OR p_limit > 100 THEN
        RAISE EXCEPTION 'REJET : Le paramètre p_limit doit être compris entre 1 et 100.' USING ERRCODE = '22023';
    ELSE
        v_limit := p_limit;
    END IF;

    IF p_currency IS NOT NULL AND p_currency NOT IN ('USD', 'CDF') THEN
        RAISE EXCEPTION 'REJET : Le paramètre p_currency doit être NULL, USD ou CDF.' USING ERRCODE = '22023';
    END IF;

    IF p_priority_filter IS NOT NULL AND p_priority_filter NOT IN ('all', 'critical', 'high', 'normal') THEN
        RAISE EXCEPTION 'REJET : Le paramètre p_priority_filter doit être NULL, all, critical, high ou normal.' USING ERRCODE = '22023';
    END IF;

    -- Validation stricte du curseur (3 valeurs NULL ou 3 valeurs renseignées)
    IF (p_cursor_priority_score IS NULL OR p_cursor_effective_date IS NULL OR p_cursor_invoice_id IS NULL) AND
       NOT (p_cursor_priority_score IS NULL AND p_cursor_effective_date IS NULL AND p_cursor_invoice_id IS NULL) THEN
        RAISE EXCEPTION 'REJET : Le curseur doit contenir priority_score, effective_date et invoice_id tous les trois ou tous NULL.' USING ERRCODE = '22023';
    END IF;

    IF p_cursor_priority_score IS NOT NULL AND p_cursor_priority_score < 0 THEN
        RAISE EXCEPTION 'REJET : Le paramètre p_cursor_priority_score doit être un entier >= 0.' USING ERRCODE = '22023';
    END IF;

    -- 4. Requête Keyset N+1 sur les priorités
    FOR v_rec IN
        SELECT *
        FROM public._evaluate_school_collection_invoices(v_school.id, v_business_date) eb
        WHERE (p_currency IS NULL OR eb.currency = p_currency)
          AND (
              p_priority_filter IS NULL OR p_priority_filter = 'all' OR
              (p_priority_filter = 'critical' AND eb.priority_level = 'critical') OR
              (p_priority_filter = 'high' AND eb.priority_level = 'high') OR
              (p_priority_filter = 'normal' AND eb.priority_level = 'normal')
          )
          AND (
              p_cursor_priority_score IS NULL
              OR eb.priority_score < p_cursor_priority_score
              OR (
                  eb.priority_score = p_cursor_priority_score
                  AND eb.effective_follow_up_date > p_cursor_effective_date
              )
              OR (
                  eb.priority_score = p_cursor_priority_score
                  AND eb.effective_follow_up_date = p_cursor_effective_date
                  AND eb.invoice_id > p_cursor_invoice_id
              )
          )
        ORDER BY eb.priority_score DESC, eb.effective_follow_up_date ASC, eb.invoice_id ASC
        LIMIT (v_limit + 1)
    LOOP
        v_row_count := v_row_count + 1;

        IF v_row_count <= v_limit THEN
            v_items := v_items || pg_catalog.jsonb_build_object(
                'invoice_id', v_rec.invoice_id,
                'invoice_number', v_rec.invoice_number,
                'student_id', v_rec.student_id,
                'student_name', v_rec.student_name,
                'student_number', v_rec.student_number,
                'class_name', v_rec.class_name,
                'invoice_due_date', v_rec.invoice_due_date,
                'days_overdue', v_rec.days_overdue,
                'currency', v_rec.currency,
                'total_amount', v_rec.total_amount,
                'paid_amount', v_rec.paid_amount,
                'remaining_balance', v_rec.remaining_balance,
                'invoice_status', v_rec.invoice_status,
                'collection_status', v_rec.collection_status,
                'priority_level', v_rec.priority_level,
                'priority_score', v_rec.priority_score,
                'priority_reasons', v_rec.priority_reasons,
                'effective_follow_up_date', v_rec.effective_follow_up_date,
                'latest_action_id', v_rec.latest_action_id,
                'latest_action_type', v_rec.latest_action_type,
                'latest_contacted_at', CASE WHEN v_rec.latest_contacted_at IS NOT NULL THEN pg_catalog.to_char(v_rec.latest_contacted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
                'latest_promise_to_pay_date', v_rec.latest_promise_to_pay_date,
                'latest_next_follow_up_date', v_rec.latest_next_follow_up_date,
                'last_contacted_by_name', v_rec.last_contacted_by_name
            );
            v_last_priority_score := v_rec.priority_score;
            v_last_effective_date := v_rec.effective_follow_up_date;
            v_last_invoice_id := v_rec.invoice_id;
        ELSE
            v_has_more := TRUE;
        END IF;
    END LOOP;

    IF v_has_more THEN
        v_next_cursor := pg_catalog.jsonb_build_object(
            'priority_score', v_last_priority_score,
            'effective_date', v_last_effective_date,
            'invoice_id', v_last_invoice_id
        );
    ELSE
        v_next_cursor := NULL;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'business_date', v_business_date,
        'items', v_items,
        'has_more', v_has_more,
        'next_cursor', v_next_cursor
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_school_collection_priorities(TEXT, TEXT, INTEGER, INTEGER, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_collection_priorities(TEXT, TEXT, INTEGER, INTEGER, DATE, UUID) TO authenticated;
ALTER FUNCTION public.get_school_collection_priorities(TEXT, TEXT, INTEGER, INTEGER, DATE, UUID) OWNER TO postgres;
