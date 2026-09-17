-- =============================================================================
-- ÉCOLECONNECT — MIGRATION FORWARD-ONLY FINANCE 4A HOTFIX
-- Fichier: 20260918110000_fix_finance_4a_profile_status_column_bug.sql
-- Description: Correction de la référence de colonne (v_profile.is_active IS DISTINCT FROM TRUE)
--              dans get_school_aging_summary() et get_school_overdue_invoices_admin()
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CORRECTION RPC PUBLIQUE: get_school_aging_summary()
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_aging_summary()
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
BEGIN
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

    RETURN public._get_school_aging_summary_internal(v_profile.school_id, v_business_date);
END;
$$;

REVOKE ALL ON FUNCTION public.get_school_aging_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_aging_summary() TO authenticated;
ALTER FUNCTION public.get_school_aging_summary() OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 2. CORRECTION RPC PUBLIQUE: get_school_overdue_invoices_admin(...)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_overdue_invoices_admin(
    p_currency TEXT DEFAULT NULL,
    p_aging_bucket TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_cursor_due_date DATE DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL
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
    v_search TEXT;
    v_search_pattern TEXT := NULL;
    
    v_has_more BOOLEAN := FALSE;
    v_next_cursor JSONB := NULL;
    v_items JSONB := '[]'::jsonb;
    
    v_rec RECORD;
    v_row_count INTEGER := 0;
    v_last_due_date DATE := NULL;
    v_last_id UUID := NULL;
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

    -- 3. Validation des paramètres
    -- p_limit
    IF p_limit IS NULL THEN
        v_limit := 20;
    ELSIF p_limit <= 0 OR p_limit > 100 THEN
        RAISE EXCEPTION 'REJET : Le paramètre p_limit doit être compris entre 1 et 100 (reçu: %).', p_limit
            USING ERRCODE = '22023';
    ELSE
        v_limit := p_limit;
    END IF;

    -- p_currency
    IF p_currency IS NOT NULL AND p_currency NOT IN ('USD', 'CDF') THEN
        RAISE EXCEPTION 'REJET : Le paramètre p_currency doit être NULL, USD ou CDF (reçu: %).', p_currency
            USING ERRCODE = '22023';
    END IF;

    -- p_aging_bucket
    IF p_aging_bucket IS NOT NULL AND p_aging_bucket NOT IN ('1_30_days', '31_60_days', '61_90_days', 'over_90_days') THEN
        RAISE EXCEPTION 'REJET : Le paramètre p_aging_bucket est invalide (reçu: %).', p_aging_bucket
            USING ERRCODE = '22023';
    END IF;

    -- Curseur Keyset
    IF (p_cursor_due_date IS NULL AND p_cursor_id IS NOT NULL) OR (p_cursor_due_date IS NOT NULL AND p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'REJET : Les paramètres de curseur (p_cursor_due_date, p_cursor_id) doivent être tous les deux fournis ou tous les deux NULL.'
            USING ERRCODE = '22023';
    END IF;

    IF p_cursor_due_date IS NOT NULL AND p_cursor_due_date > v_business_date THEN
        RAISE EXCEPTION 'REJET : Le curseur p_cursor_due_date ne peut pas être supérieur à la date métier (reçu: %).', p_cursor_due_date
            USING ERRCODE = '22023';
    END IF;

    -- Recherche texte
    v_search := pg_catalog.btrim(p_search);
    IF v_search = '' THEN
        v_search := NULL;
    END IF;

    IF v_search IS NOT NULL THEN
        IF pg_catalog.length(v_search) > 100 THEN
            RAISE EXCEPTION 'REJET : Le terme de recherche dépasse la longueur maximale de 100 caractères.'
                USING ERRCODE = '22023';
        END IF;

        -- Échappement explicite : d'abord '\', puis '%' et '_'
        v_search_pattern := pg_catalog.replace(v_search, '\', '\\');
        v_search_pattern := pg_catalog.replace(v_search_pattern, '%', '\%');
        v_search_pattern := pg_catalog.replace(v_search_pattern, '_', '\_');
        v_search_pattern := '%' || v_search_pattern || '%';
    END IF;

    -- 4. Exécution de la requête Keyset avec N+1 rows
    FOR v_rec IN
        SELECT
            inv.id AS invoice_id,
            inv.invoice_number,
            inv.student_id,
            pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_name,
            c.name AS class_name,
            inv.due_date,
            (v_business_date - inv.due_date) AS days_overdue,
            CASE
                WHEN (v_business_date - inv.due_date) BETWEEN 1 AND 30 THEN '1_30_days'
                WHEN (v_business_date - inv.due_date) BETWEEN 31 AND 60 THEN '31_60_days'
                WHEN (v_business_date - inv.due_date) BETWEEN 61 AND 90 THEN '61_90_days'
                ELSE 'over_90_days'
            END AS aging_bucket,
            inv.currency,
            inv.total_amount,
            inv.paid_amount,
            inv.remaining_balance,
            inv.status
        FROM public.student_invoices inv
        JOIN public.students st ON st.id = inv.student_id AND st.school_id = inv.school_id
        JOIN public.classes c ON c.id = inv.class_id AND c.school_id = inv.school_id
        WHERE inv.school_id = v_profile.school_id
          AND inv.status IN ('issued', 'partially_paid')
          AND inv.remaining_balance > 0
          AND inv.due_date < v_business_date
          AND (p_currency IS NULL OR inv.currency = p_currency)
          AND (
              p_aging_bucket IS NULL OR (
                  (p_aging_bucket = '1_30_days' AND (v_business_date - inv.due_date) BETWEEN 1 AND 30) OR
                  (p_aging_bucket = '31_60_days' AND (v_business_date - inv.due_date) BETWEEN 31 AND 60) OR
                  (p_aging_bucket = '61_90_days' AND (v_business_date - inv.due_date) BETWEEN 61 AND 90) OR
                  (p_aging_bucket = 'over_90_days' AND (v_business_date - inv.due_date) >= 91)
              )
          )
          AND (
              v_search_pattern IS NULL OR (
                  inv.invoice_number ILIKE v_search_pattern ESCAPE '\'
                  OR st.student_number ILIKE v_search_pattern ESCAPE '\'
                  OR pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name) ILIKE v_search_pattern ESCAPE '\'
                  OR c.name ILIKE v_search_pattern ESCAPE '\'
              )
          )
          AND (
              p_cursor_due_date IS NULL OR
              (inv.due_date, inv.id) > (p_cursor_due_date, p_cursor_id)
          )
        ORDER BY inv.due_date ASC, inv.id ASC
        LIMIT (v_limit + 1)
    LOOP
        v_row_count := v_row_count + 1;

        IF v_row_count <= v_limit THEN
            v_items := v_items || pg_catalog.jsonb_build_object(
                'invoice_id', v_rec.invoice_id,
                'invoice_number', v_rec.invoice_number,
                'student_id', v_rec.student_id,
                'student_name', v_rec.student_name,
                'class_name', v_rec.class_name,
                'due_date', v_rec.due_date,
                'days_overdue', v_rec.days_overdue,
                'aging_bucket', v_rec.aging_bucket,
                'currency', v_rec.currency,
                'total_amount', v_rec.total_amount,
                'paid_amount', v_rec.paid_amount,
                'remaining_balance', v_rec.remaining_balance,
                'status', v_rec.status
            );
            v_last_due_date := v_rec.due_date;
            v_last_id := v_rec.invoice_id;
        ELSE
            v_has_more := TRUE;
        END IF;
    END LOOP;

    IF v_has_more THEN
        v_next_cursor := pg_catalog.jsonb_build_object(
            'due_date', v_last_due_date,
            'id', v_last_id
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

REVOKE ALL ON FUNCTION public.get_school_overdue_invoices_admin(TEXT, TEXT, TEXT, INTEGER, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_overdue_invoices_admin(TEXT, TEXT, TEXT, INTEGER, DATE, UUID) TO authenticated;
ALTER FUNCTION public.get_school_overdue_invoices_admin(TEXT, TEXT, TEXT, INTEGER, DATE, UUID) OWNER TO postgres;
