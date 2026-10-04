-- ============================================================================
-- Migration : 20261004150000_cash_register_journal_rpc.sql
-- Description : Backend du journal de caisse événementiel V4 (Lot 2K-FIN-CASH-F-V2)
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. INDEX OPTIMISÉ POUR LES ANNULLATIONS ÉVÉNEMENTIELLES DE PAIEMENTS
--------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_student_payments_school_cancelled_at
  ON public.student_payments(school_id, cancelled_at)
  WHERE status = 'cancelled';


--------------------------------------------------------------------------------
-- 2. FONCTION RPC STABLE SECURITY DEFINER : get_school_cash_register_journal
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_cash_register_journal(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20,
  p_class_id UUID DEFAULT NULL,
  p_fee_type TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_event_type TEXT DEFAULT NULL,
  p_recorded_by UUID DEFAULT NULL,
  p_search_query TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_uid UUID;
  v_school_id UUID;
  v_user_role TEXT;
  v_user_active BOOLEAN;
  v_school_status TEXT;
  v_school_tz TEXT;

  v_fee_type TEXT;
  v_payment_method TEXT;
  v_event_type TEXT;
  v_search_query TEXT;

  v_offset INTEGER;
  v_total_records INTEGER := 0;
  v_total_pages INTEGER := 1;
  v_has_next BOOLEAN := false;
  v_has_previous BOOLEAN := false;

  v_summary_usd JSONB;
  v_summary_cdf JSONB;
  v_journal_entries JSONB;
  v_result JSONB;
BEGIN
  ------------------------------------------------------------------------------
  -- SECURITY & AUTHENTICATION GUARD
  ------------------------------------------------------------------------------
  v_auth_uid := (SELECT auth.uid());
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role, p.is_active, s.status
  INTO v_school_id, v_user_role, v_user_active, v_school_status
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_auth_uid;

  IF v_school_id IS NULL OR v_user_role NOT IN ('school_admin', 'finance_agent') OR NOT v_user_active OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : privilèges insuffisants ou établissement inactif' USING ERRCODE = '42501';
  END IF;

  ------------------------------------------------------------------------------
  -- TIMEZONE RESOLUTION & DEFAULT DATES
  ------------------------------------------------------------------------------
  SELECT COALESCE(NULLIF(TRIM(timezone), ''), 'Africa/Kinshasa')
  INTO v_school_tz
  FROM public.schools
  WHERE id = v_school_id;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_school_tz) THEN
    v_school_tz := 'Africa/Kinshasa';
  END IF;

  IF p_start_date IS NULL THEN
    p_start_date := (now() AT TIME ZONE v_school_tz)::DATE;
  END IF;

  IF p_end_date IS NULL THEN
    p_end_date := (now() AT TIME ZONE v_school_tz)::DATE;
  END IF;

  ------------------------------------------------------------------------------
  -- PARAMETER VALIDATION (SQLSTATE 22023)
  ------------------------------------------------------------------------------
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'La date de début doit être antérieure ou égale à la date de fin' USING ERRCODE = '22023';
  END IF;

  IF (p_end_date - p_start_date) > 366 THEN
    RAISE EXCEPTION 'La période ne peut pas dépasser 366 jours' USING ERRCODE = '22023';
  END IF;

  IF p_page IS NULL OR p_page < 1 THEN
    RAISE EXCEPTION 'Le numéro de page doit être supérieur ou égal à 1' USING ERRCODE = '22023';
  END IF;

  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'La taille de page doit être comprise entre 1 et 100' USING ERRCODE = '22023';
  END IF;

  v_event_type := NULLIF(LOWER(TRIM(COALESCE(p_event_type, ''))), '');
  IF v_event_type IS NOT NULL AND v_event_type NOT IN ('collection', 'cancellation') THEN
    RAISE EXCEPTION 'Type d''événement invalide' USING ERRCODE = '22023';
  END IF;

  v_payment_method := NULLIF(LOWER(TRIM(COALESCE(p_payment_method, ''))), '');
  IF v_payment_method IS NOT NULL AND v_payment_method NOT IN ('cash', 'bank_transfer', 'bank_deposit', 'check', 'mobile_money_manual', 'other') THEN
    RAISE EXCEPTION 'Mode de paiement invalide' USING ERRCODE = '22023';
  END IF;

  v_fee_type := NULLIF(LOWER(TRIM(COALESCE(p_fee_type, ''))), '');
  IF v_fee_type IS NOT NULL AND v_fee_type NOT IN ('inscription', 'minerval', 'transport', 'cantine', 'uniforme', 'activites', 'frais_etat', 'autre') THEN
    RAISE EXCEPTION 'Type de frais invalide' USING ERRCODE = '22023';
  END IF;

  v_search_query := NULLIF(TRIM(COALESCE(p_search_query, '')), '');
  IF v_search_query IS NOT NULL AND LENGTH(v_search_query) > 100 THEN
    RAISE EXCEPTION 'La recherche ne peut pas dépasser 100 caractères' USING ERRCODE = '22023';
  END IF;

  v_offset := (p_page - 1) * p_page_size;


  ------------------------------------------------------------------------------
  -- 1. PRE-COMPUTE TOTAL MATCHING RECORDS & PAGINATION
  ------------------------------------------------------------------------------
  WITH _events AS (
    SELECT p.id
    FROM public.student_payments p
    JOIN public.student_invoices inv ON inv.id = p.invoice_id
    JOIN public.students st ON st.id = p.student_id
    JOIN public.classes cl ON cl.id = inv.class_id
    JOIN public.profiles rec ON rec.id = p.recorded_by
    LEFT JOIN public.payment_receipts pr ON pr.payment_id = p.id
    WHERE p.school_id = v_school_id
      AND p.payment_date BETWEEN p_start_date AND p_end_date
      AND (p_class_id IS NULL OR inv.class_id = p_class_id)
      AND (v_event_type IS NULL OR v_event_type = 'collection')
      AND (v_payment_method IS NULL OR p.payment_method = v_payment_method)
      AND (p_recorded_by IS NULL OR p.recorded_by = p_recorded_by)
      AND (v_fee_type IS NULL OR EXISTS (
            SELECT 1 FROM public.student_invoice_items sii
            WHERE sii.invoice_id = p.invoice_id AND sii.fee_type = v_fee_type
          ))
      AND (v_search_query IS NULL OR (
            p.payment_number ILIKE '%' || v_search_query || '%' OR
            (pr.receipt_number IS NOT NULL AND pr.receipt_number ILIKE '%' || v_search_query || '%') OR
            inv.invoice_number ILIKE '%' || v_search_query || '%' OR
            st.student_number ILIKE '%' || v_search_query || '%' OR
            st.first_name ILIKE '%' || v_search_query || '%' OR
            st.last_name ILIKE '%' || v_search_query || '%' OR
            (st.first_name || ' ' || st.last_name) ILIKE '%' || v_search_query || '%'
          ))

    UNION ALL

    SELECT p.id
    FROM public.student_payments p
    JOIN public.student_invoices inv ON inv.id = p.invoice_id
    JOIN public.students st ON st.id = p.student_id
    JOIN public.classes cl ON cl.id = inv.class_id
    JOIN public.profiles rec ON rec.id = p.recorded_by
    LEFT JOIN public.payment_receipts pr ON pr.payment_id = p.id
    WHERE p.school_id = v_school_id
      AND p.status = 'cancelled'
      AND p.cancelled_at IS NOT NULL
      AND (p.cancelled_at AT TIME ZONE v_school_tz)::DATE BETWEEN p_start_date AND p_end_date
      AND (p_class_id IS NULL OR inv.class_id = p_class_id)
      AND (v_event_type IS NULL OR v_event_type = 'cancellation')
      AND (v_payment_method IS NULL OR p.payment_method = v_payment_method)
      AND (p_recorded_by IS NULL OR p.recorded_by = p_recorded_by)
      AND (v_fee_type IS NULL OR EXISTS (
            SELECT 1 FROM public.student_invoice_items sii
            WHERE sii.invoice_id = p.invoice_id AND sii.fee_type = v_fee_type
          ))
      AND (v_search_query IS NULL OR (
            p.payment_number ILIKE '%' || v_search_query || '%' OR
            (pr.receipt_number IS NOT NULL AND pr.receipt_number ILIKE '%' || v_search_query || '%') OR
            inv.invoice_number ILIKE '%' || v_search_query || '%' OR
            st.student_number ILIKE '%' || v_search_query || '%' OR
            st.first_name ILIKE '%' || v_search_query || '%' OR
            st.last_name ILIKE '%' || v_search_query || '%' OR
            (st.first_name || ' ' || st.last_name) ILIKE '%' || v_search_query || '%'
          ))
  )
  SELECT COUNT(*)::INTEGER INTO v_total_records FROM _events;

  IF v_total_records = 0 THEN
    v_total_pages := 1;
  ELSE
    v_total_pages := CEIL(v_total_records::NUMERIC / p_page_size)::INTEGER;
  END IF;

  v_has_next := (p_page < v_total_pages);
  v_has_previous := (p_page > 1);

  ------------------------------------------------------------------------------
  -- 2. SINGLE-QUERY CTE EXECUTION FOR STABLE COMPLIANCE (ZERO DDL / ZERO TEMP TABLE)
  ------------------------------------------------------------------------------
  WITH _cash_journal_events AS (
    SELECT
      'col_' || p.id::text AS event_id,
      'collection' AS event_type,
      p.payment_date AS event_date,
      p.created_at AS technical_timestamp,
      p.id AS payment_id,
      p.invoice_id,
      p.student_id,
      inv.class_id,
      p.recorded_by,
      p.payment_number,
      pr.receipt_number AS receipt_number,
      COALESCE(pr.is_cancelled, false) AS receipt_is_cancelled,
      inv.invoice_number,
      st.student_number AS student_matricule,
      TRIM(st.first_name || ' ' || st.last_name) AS student_name,
      cl.name AS class_name,
      TRIM(rec.first_name || ' ' || rec.last_name) AS cashier_name,
      p.amount AS amount,
      p.amount AS raw_payment_amount,
      p.currency,
      p.payment_method,
      p.payment_reference,
      p.payer_name,
      NULL AS cancellation_reason,
      p.status AS payment_status
    FROM public.student_payments p
    JOIN public.student_invoices inv ON inv.id = p.invoice_id
    JOIN public.students st ON st.id = p.student_id
    JOIN public.classes cl ON cl.id = inv.class_id
    JOIN public.profiles rec ON rec.id = p.recorded_by
    LEFT JOIN public.payment_receipts pr ON pr.payment_id = p.id
    WHERE p.school_id = v_school_id
      AND p.payment_date BETWEEN p_start_date AND p_end_date
      AND (p_class_id IS NULL OR inv.class_id = p_class_id)
      AND (v_event_type IS NULL OR v_event_type = 'collection')
      AND (v_payment_method IS NULL OR p.payment_method = v_payment_method)
      AND (p_recorded_by IS NULL OR p.recorded_by = p_recorded_by)
      AND (v_fee_type IS NULL OR EXISTS (
            SELECT 1 FROM public.student_invoice_items sii
            WHERE sii.invoice_id = p.invoice_id AND sii.fee_type = v_fee_type
          ))
      AND (v_search_query IS NULL OR (
            p.payment_number ILIKE '%' || v_search_query || '%' OR
            (pr.receipt_number IS NOT NULL AND pr.receipt_number ILIKE '%' || v_search_query || '%') OR
            inv.invoice_number ILIKE '%' || v_search_query || '%' OR
            st.student_number ILIKE '%' || v_search_query || '%' OR
            st.first_name ILIKE '%' || v_search_query || '%' OR
            st.last_name ILIKE '%' || v_search_query || '%' OR
            (st.first_name || ' ' || st.last_name) ILIKE '%' || v_search_query || '%'
          ))

    UNION ALL

    SELECT
      'can_' || p.id::text AS event_id,
      'cancellation' AS event_type,
      (p.cancelled_at AT TIME ZONE v_school_tz)::DATE AS event_date,
      p.cancelled_at AS technical_timestamp,
      p.id AS payment_id,
      p.invoice_id,
      p.student_id,
      inv.class_id,
      p.recorded_by,
      p.payment_number,
      pr.receipt_number AS receipt_number,
      COALESCE(pr.is_cancelled, true) AS receipt_is_cancelled,
      inv.invoice_number,
      st.student_number AS student_matricule,
      TRIM(st.first_name || ' ' || st.last_name) AS student_name,
      cl.name AS class_name,
      TRIM(rec.first_name || ' ' || rec.last_name) AS cashier_name,
      -p.amount AS amount,
      p.amount AS raw_payment_amount,
      p.currency,
      p.payment_method,
      p.payment_reference,
      p.payer_name,
      p.cancel_reason AS cancellation_reason,
      p.status AS payment_status
    FROM public.student_payments p
    JOIN public.student_invoices inv ON inv.id = p.invoice_id
    JOIN public.students st ON st.id = p.student_id
    JOIN public.classes cl ON cl.id = inv.class_id
    JOIN public.profiles rec ON rec.id = p.recorded_by
    LEFT JOIN public.payment_receipts pr ON pr.payment_id = p.id
    WHERE p.school_id = v_school_id
      AND p.status = 'cancelled'
      AND p.cancelled_at IS NOT NULL
      AND (p.cancelled_at AT TIME ZONE v_school_tz)::DATE BETWEEN p_start_date AND p_end_date
      AND (p_class_id IS NULL OR inv.class_id = p_class_id)
      AND (v_event_type IS NULL OR v_event_type = 'cancellation')
      AND (v_payment_method IS NULL OR p.payment_method = v_payment_method)
      AND (p_recorded_by IS NULL OR p.recorded_by = p_recorded_by)
      AND (v_fee_type IS NULL OR EXISTS (
            SELECT 1 FROM public.student_invoice_items sii
            WHERE sii.invoice_id = p.invoice_id AND sii.fee_type = v_fee_type
          ))
      AND (v_search_query IS NULL OR (
            p.payment_number ILIKE '%' || v_search_query || '%' OR
            (pr.receipt_number IS NOT NULL AND pr.receipt_number ILIKE '%' || v_search_query || '%') OR
            inv.invoice_number ILIKE '%' || v_search_query || '%' OR
            st.student_number ILIKE '%' || v_search_query || '%' OR
            st.first_name ILIKE '%' || v_search_query || '%' OR
            st.last_name ILIKE '%' || v_search_query || '%' OR
            (st.first_name || ' ' || st.last_name) ILIKE '%' || v_search_query || '%'
          ))
  ),
  invoice_item_sums AS (
    SELECT
      invoice_id,
      fee_type,
      SUM(total_price) AS fee_type_sum
    FROM public.student_invoice_items
    WHERE invoice_id IN (SELECT DISTINCT invoice_id FROM _cash_journal_events)
    GROUP BY invoice_id, fee_type
  ),
  invoice_totals AS (
    SELECT
      invoice_id,
      SUM(fee_type_sum) AS invoice_items_total
    FROM invoice_item_sums
    GROUP BY invoice_id
  ),
  event_fee_shares AS (
    SELECT
      e.event_id,
      e.event_type,
      e.amount AS event_amount,
      e.raw_payment_amount,
      e.currency,
      e.payment_status,
      COALESCE(iis.fee_type, 'autre') AS fee_type,
      COALESCE(iis.fee_type_sum, 1.0) AS fee_type_sum,
      COALESCE(it.invoice_items_total, 1.0) AS invoice_items_total,
      e.raw_payment_amount * (COALESCE(iis.fee_type_sum, 1.0) / GREATEST(COALESCE(it.invoice_items_total, 1.0), 0.01)) AS exact_quota
    FROM _cash_journal_events e
    LEFT JOIN invoice_totals it ON it.invoice_id = e.invoice_id
    LEFT JOIN invoice_item_sums iis ON iis.invoice_id = e.invoice_id
  ),
  event_floors AS (
    SELECT
      fs.*,
      TRUNC(fs.exact_quota, 2) AS floor_amount,
      (fs.exact_quota - TRUNC(fs.exact_quota, 2)) AS remainder,
      SUM(TRUNC(fs.exact_quota, 2)) OVER (PARTITION BY fs.event_id) AS sum_floors,
      ROUND((fs.raw_payment_amount - SUM(TRUNC(fs.exact_quota, 2)) OVER (PARTITION BY fs.event_id)) * 100)::INTEGER AS remainder_cents,
      ROW_NUMBER() OVER (PARTITION BY fs.event_id ORDER BY (fs.exact_quota - TRUNC(fs.exact_quota, 2)) DESC, fs.fee_type ASC) AS remainder_rank
    FROM event_fee_shares fs
  ),
  allocated_categories AS (
    SELECT
      ef.event_id,
      ef.event_type,
      ef.currency,
      ef.payment_status,
      ef.fee_type,
      (ef.floor_amount + CASE WHEN ef.remainder_rank <= ef.remainder_cents THEN 0.01 ELSE 0.00 END) AS mag_allocated,
      CASE
        WHEN ef.event_type = 'cancellation' THEN -(ef.floor_amount + CASE WHEN ef.remainder_rank <= ef.remainder_cents THEN 0.01 ELSE 0.00 END)
        ELSE (ef.floor_amount + CASE WHEN ef.remainder_rank <= ef.remainder_cents THEN 0.01 ELSE 0.00 END)
      END AS signed_allocated,
      ROUND(((ef.floor_amount + CASE WHEN ef.remainder_rank <= ef.remainder_cents THEN 0.01 ELSE 0.00 END) / GREATEST(ef.raw_payment_amount, 0.01)) * 100, 2) AS allocated_pct
    FROM event_floors ef
  ),
  category_aggregates AS (
    SELECT
      currency,
      fee_type,
      COALESCE(SUM(CASE WHEN event_type = 'collection' THEN mag_allocated ELSE 0 END), 0.00) AS gross_collected,
      COALESCE(SUM(CASE WHEN event_type = 'cancellation' THEN mag_allocated ELSE 0 END), 0.00) AS cancellations_amount,
      COALESCE(SUM(CASE WHEN event_type = 'collection' THEN mag_allocated ELSE 0 END), 0.00) -
      COALESCE(SUM(CASE WHEN event_type = 'cancellation' THEN mag_allocated ELSE 0 END), 0.00) AS net_event_amount,
      COALESCE(SUM(CASE WHEN event_type = 'collection' AND payment_status = 'confirmed' THEN mag_allocated ELSE 0 END), 0.00) AS confirmed_current_total
    FROM allocated_categories
    GROUP BY currency, fee_type
  ),
  class_aggregates AS (
    SELECT
      currency,
      class_name,
      COALESCE(SUM(CASE WHEN event_type = 'collection' THEN amount ELSE 0 END), 0.00) AS gross_collected,
      COALESCE(SUM(CASE WHEN event_type = 'cancellation' THEN ABS(amount) ELSE 0 END), 0.00) AS cancellations_amount,
      COALESCE(SUM(CASE WHEN event_type = 'collection' THEN amount ELSE 0 END), 0.00) -
      COALESCE(SUM(CASE WHEN event_type = 'cancellation' THEN ABS(amount) ELSE 0 END), 0.00) AS net_event_amount,
      COALESCE(SUM(CASE WHEN event_type = 'collection' AND payment_status = 'confirmed' THEN amount ELSE 0 END), 0.00) AS confirmed_current_total,
      COUNT(CASE WHEN event_type = 'collection' THEN 1 END) AS collections_count,
      COUNT(CASE WHEN event_type = 'cancellation' THEN 1 END) AS cancellations_count
    FROM _cash_journal_events
    GROUP BY currency, class_name
  ),
  currency_summary_totals AS (
    SELECT
      c.currency,
      COALESCE(SUM(CASE WHEN e.event_type = 'collection' THEN e.amount ELSE 0 END), 0.00) AS gross_collected,
      COALESCE(SUM(CASE WHEN e.event_type = 'cancellation' THEN ABS(e.amount) ELSE 0 END), 0.00) AS cancellations_amount,
      COALESCE(SUM(CASE WHEN e.event_type = 'collection' THEN e.amount ELSE 0 END), 0.00) -
      COALESCE(SUM(CASE WHEN e.event_type = 'cancellation' THEN ABS(e.amount) ELSE 0 END), 0.00) AS net_event_amount,
      COALESCE(SUM(CASE WHEN e.event_type = 'collection' AND e.payment_status = 'confirmed' THEN e.amount ELSE 0 END), 0.00) AS confirmed_current_total,
      COALESCE(SUM(CASE WHEN e.event_type = 'collection' AND e.payment_method = 'cash' THEN e.amount ELSE 0 END), 0.00) AS cash_collected,
      COALESCE(SUM(CASE WHEN e.event_type = 'cancellation' AND e.payment_method = 'cash' THEN ABS(e.amount) ELSE 0 END), 0.00) AS cash_cancellations,
      COALESCE(SUM(CASE WHEN e.event_type = 'collection' AND e.payment_method = 'cash' THEN e.amount ELSE 0 END), 0.00) -
      COALESCE(SUM(CASE WHEN e.event_type = 'cancellation' AND e.payment_method = 'cash' THEN ABS(e.amount) ELSE 0 END), 0.00) AS cash_net_event,
      COUNT(CASE WHEN e.event_type = 'collection' THEN 1 END) AS collections_count,
      COUNT(CASE WHEN e.event_type = 'cancellation' THEN 1 END) AS cancellations_count
    FROM (SELECT DISTINCT currency FROM _cash_journal_events UNION SELECT 'USD' UNION SELECT 'CDF') c
    LEFT JOIN _cash_journal_events e ON e.currency = c.currency
    GROUP BY c.currency
  ),
  payment_method_aggregates AS (
    SELECT
      c.currency,
      m.method,
      COALESCE(SUM(CASE WHEN e.event_type = 'collection' THEN e.amount ELSE 0 END), 0.00) AS gross,
      COALESCE(SUM(CASE WHEN e.event_type = 'cancellation' THEN ABS(e.amount) ELSE 0 END), 0.00) AS cancelled,
      COALESCE(SUM(CASE WHEN e.event_type = 'collection' THEN e.amount ELSE 0 END), 0.00) -
      COALESCE(SUM(CASE WHEN e.event_type = 'cancellation' THEN ABS(e.amount) ELSE 0 END), 0.00) AS net,
      COUNT(CASE WHEN e.event_type = 'collection' THEN 1 END) AS collections_count,
      COUNT(CASE WHEN e.event_type = 'cancellation' THEN 1 END) AS cancellations_count
    FROM (SELECT 'USD' AS currency UNION SELECT 'CDF') c
    CROSS JOIN (
      SELECT 'cash' AS method UNION SELECT 'bank_transfer' UNION SELECT 'bank_deposit'
      UNION SELECT 'check' UNION SELECT 'mobile_money_manual' UNION SELECT 'other'
    ) m
    LEFT JOIN _cash_journal_events e ON e.currency = c.currency AND e.payment_method = m.method
    GROUP BY c.currency, m.method
  ),
  usd_summary AS (
    SELECT jsonb_build_object(
      'gross_collected', COALESCE(st.gross_collected, 0.00),
      'cancellations_amount', COALESCE(st.cancellations_amount, 0.00),
      'net_event_amount', COALESCE(st.net_event_amount, 0.00),
      'confirmed_current_total', COALESCE(st.confirmed_current_total, 0.00),
      'cash_collected', COALESCE(st.cash_collected, 0.00),
      'cash_cancellations', COALESCE(st.cash_cancellations, 0.00),
      'cash_net_event', COALESCE(st.cash_net_event, 0.00),
      'collections_count', COALESCE(st.collections_count, 0),
      'cancellations_count', COALESCE(st.cancellations_count, 0),
      'by_payment_method', (
        SELECT jsonb_object_agg(
          pma.method,
          jsonb_build_object(
            'gross', pma.gross,
            'cancelled', pma.cancelled,
            'net', pma.net,
            'collections_count', pma.collections_count,
            'cancellations_count', pma.cancellations_count
          )
        )
        FROM payment_method_aggregates pma
        WHERE pma.currency = 'USD'
      ),
      'by_category', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'fee_type', ca.fee_type,
            'gross_collected', ca.gross_collected,
            'cancellations_amount', ca.cancellations_amount,
            'net_event_amount', ca.net_event_amount,
            'confirmed_current_total', ca.confirmed_current_total
          ) ORDER BY ca.fee_type ASC
        )
        FROM category_aggregates ca
        WHERE ca.currency = 'USD'
      ), '[]'::jsonb),
      'by_class', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'class_name', cla.class_name,
            'gross_collected', cla.gross_collected,
            'cancellations_amount', cla.cancellations_amount,
            'net_event_amount', cla.net_event_amount,
            'confirmed_current_total', cla.confirmed_current_total,
            'collections_count', cla.collections_count,
            'cancellations_count', cla.cancellations_count
          ) ORDER BY cla.class_name ASC
        )
        FROM class_aggregates cla
        WHERE cla.currency = 'USD'
      ), '[]'::jsonb)
    ) AS val
    FROM currency_summary_totals st
    WHERE st.currency = 'USD'
  ),
  cdf_summary AS (
    SELECT jsonb_build_object(
      'gross_collected', COALESCE(st.gross_collected, 0.00),
      'cancellations_amount', COALESCE(st.cancellations_amount, 0.00),
      'net_event_amount', COALESCE(st.net_event_amount, 0.00),
      'confirmed_current_total', COALESCE(st.confirmed_current_total, 0.00),
      'cash_collected', COALESCE(st.cash_collected, 0.00),
      'cash_cancellations', COALESCE(st.cash_cancellations, 0.00),
      'cash_net_event', COALESCE(st.cash_net_event, 0.00),
      'collections_count', COALESCE(st.collections_count, 0),
      'cancellations_count', COALESCE(st.cancellations_count, 0),
      'by_payment_method', (
        SELECT jsonb_object_agg(
          pma.method,
          jsonb_build_object(
            'gross', pma.gross,
            'cancelled', pma.cancelled,
            'net', pma.net,
            'collections_count', pma.collections_count,
            'cancellations_count', pma.cancellations_count
          )
        )
        FROM payment_method_aggregates pma
        WHERE pma.currency = 'CDF'
      ),
      'by_category', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'fee_type', ca.fee_type,
            'gross_collected', ca.gross_collected,
            'cancellations_amount', ca.cancellations_amount,
            'net_event_amount', ca.net_event_amount,
            'confirmed_current_total', ca.confirmed_current_total
          ) ORDER BY ca.fee_type ASC
        )
        FROM category_aggregates ca
        WHERE ca.currency = 'CDF'
      ), '[]'::jsonb),
      'by_class', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'class_name', cla.class_name,
            'gross_collected', cla.gross_collected,
            'cancellations_amount', cla.cancellations_amount,
            'net_event_amount', cla.net_event_amount,
            'confirmed_current_total', cla.confirmed_current_total,
            'collections_count', cla.collections_count,
            'cancellations_count', cla.cancellations_count
          ) ORDER BY cla.class_name ASC
        )
        FROM class_aggregates cla
        WHERE cla.currency = 'CDF'
      ), '[]'::jsonb)
    ) AS val
    FROM currency_summary_totals st
    WHERE st.currency = 'CDF'
  ),
  page_events AS (
    SELECT *
    FROM _cash_journal_events
    ORDER BY event_date DESC, technical_timestamp DESC, payment_number DESC, event_type ASC
    LIMIT p_page_size OFFSET v_offset
  ),
  invoice_item_sums_pg AS (
    SELECT
      invoice_id,
      fee_type,
      SUM(total_price) AS fee_type_sum
    FROM public.student_invoice_items
    WHERE invoice_id IN (SELECT DISTINCT invoice_id FROM page_events)
    GROUP BY invoice_id, fee_type
  ),
  invoice_totals_pg AS (
    SELECT
      invoice_id,
      SUM(fee_type_sum) AS invoice_items_total
    FROM invoice_item_sums_pg
    GROUP BY invoice_id
  ),
  event_fee_shares_pg AS (
    SELECT
      pe.event_id,
      pe.event_type,
      pe.raw_payment_amount,
      COALESCE(iis.fee_type, 'autre') AS fee_type,
      COALESCE(iis.fee_type_sum, 1.0) AS fee_type_sum,
      COALESCE(it.invoice_items_total, 1.0) AS invoice_items_total,
      pe.raw_payment_amount * (COALESCE(iis.fee_type_sum, 1.0) / GREATEST(COALESCE(it.invoice_items_total, 1.0), 0.01)) AS exact_quota
    FROM page_events pe
    LEFT JOIN invoice_totals_pg it ON it.invoice_id = pe.invoice_id
    LEFT JOIN invoice_item_sums_pg iis ON iis.invoice_id = pe.invoice_id
  ),
  event_floors_pg AS (
    SELECT
      efs.*,
      TRUNC(efs.exact_quota, 2) AS floor_amount,
      SUM(TRUNC(efs.exact_quota, 2)) OVER (PARTITION BY efs.event_id) AS sum_floors,
      ROUND((efs.raw_payment_amount - SUM(TRUNC(efs.exact_quota, 2)) OVER (PARTITION BY efs.event_id)) * 100)::INTEGER AS remainder_cents,
      ROW_NUMBER() OVER (PARTITION BY efs.event_id ORDER BY (efs.exact_quota - TRUNC(efs.exact_quota, 2)) DESC, efs.fee_type ASC) AS remainder_rank
    FROM event_fee_shares_pg efs
  ),
  allocated_categories_pg AS (
    SELECT
      efp.event_id,
      efp.fee_type,
      CASE
        WHEN efp.event_type = 'cancellation' THEN -(efp.floor_amount + CASE WHEN efp.remainder_rank <= efp.remainder_cents THEN 0.01 ELSE 0.00 END)
        ELSE (efp.floor_amount + CASE WHEN efp.remainder_rank <= efp.remainder_cents THEN 0.01 ELSE 0.00 END)
      END AS signed_allocated,
      ROUND(((efp.floor_amount + CASE WHEN efp.remainder_rank <= efp.remainder_cents THEN 0.01 ELSE 0.00 END) / GREATEST(efp.raw_payment_amount, 0.01)) * 100, 2) AS allocated_pct
    FROM event_floors_pg efp
  ),
  journal_entries_agg AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'event_type', pe.event_type,
        'event_date', to_char(pe.event_date, 'YYYY-MM-DD'),
        'payment_number', pe.payment_number,
        'receipt_number', pe.receipt_number,
        'receipt_is_cancelled', pe.receipt_is_cancelled,
        'payment_status', pe.payment_status,
        'invoice_number', pe.invoice_number,
        'student_matricule', pe.student_matricule,
        'student_name', pe.student_name,
        'class_name', pe.class_name,
        'cashier_name', pe.cashier_name,
        'amount', pe.amount,
        'currency', pe.currency,
        'payment_method', pe.payment_method,
        'payment_reference', pe.payment_reference,
        'payer_name', pe.payer_name,
        'cancellation_reason', pe.cancellation_reason,
        'category_allocations', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'fee_type', ac.fee_type,
              'amount', ac.signed_allocated,
              'allocated_percentage', ac.allocated_pct
            ) ORDER BY ac.fee_type ASC
          )
          FROM allocated_categories_pg ac
          WHERE ac.event_id = pe.event_id
        ), '[]'::jsonb)
      ) ORDER BY pe.event_date DESC, pe.technical_timestamp DESC, pe.payment_number DESC, pe.event_type ASC
    ), '[]'::jsonb) AS entries
    FROM page_events pe
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', to_char(p_start_date, 'YYYY-MM-DD'),
      'end_date', to_char(p_end_date, 'YYYY-MM-DD'),
      'school_timezone', v_school_tz
    ),
    'pagination', jsonb_build_object(
      'page', p_page,
      'page_size', p_page_size,
      'total_records', v_total_records,
      'total_pages', v_total_pages,
      'has_next', v_has_next,
      'has_previous', v_has_previous
    ),
    'summary', jsonb_build_object(
      'USD', COALESCE((SELECT val FROM usd_summary), '{}'::jsonb),
      'CDF', COALESCE((SELECT val FROM cdf_summary), '{}'::jsonb)
    ),
    'journal_entries', COALESCE((SELECT entries FROM journal_entries_agg), '[]'::jsonb),
    'disclaimer', 'Les ventilations par catégorie sont à titre analytique et calculées au prorata selon la méthode des plus grands restes.'
  ) INTO v_result;


  RETURN v_result;
END;
$$;

--------------------------------------------------------------------------------
-- 3. RPC MINIMALE SÉCURISÉE : get_school_cash_register_filter_options
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_cash_register_filter_options()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_uid UUID;
  v_school_id UUID;
  v_user_role TEXT;
  v_user_active BOOLEAN;
  v_school_status TEXT;

  v_classes JSONB;
  v_cashiers JSONB;
BEGIN
  ------------------------------------------------------------------------------
  -- SECURITY & AUTHENTICATION GUARD
  ------------------------------------------------------------------------------
  v_auth_uid := (SELECT auth.uid());
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role, p.is_active, s.status
  INTO v_school_id, v_user_role, v_user_active, v_school_status
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_auth_uid;

  IF v_school_id IS NULL OR v_user_role NOT IN ('school_admin', 'finance_agent') OR NOT v_user_active OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : privilèges insuffisants ou établissement inactif' USING ERRCODE = '42501';
  END IF;

  ------------------------------------------------------------------------------
  -- 1. ACTIVE CLASSES FOR SCHOOL
  ------------------------------------------------------------------------------
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name
      ) ORDER BY c.name ASC
    ),
    '[]'::jsonb
  ) INTO v_classes
  FROM public.classes c
  WHERE c.school_id = v_school_id
    AND c.is_active = true;

  ------------------------------------------------------------------------------
  -- 2. AUTHORIZED CASHIERS FOR SCHOOL (school_admin & finance_agent)
  ------------------------------------------------------------------------------
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'full_name', TRIM(p.first_name || ' ' || p.last_name)
      ) ORDER BY p.last_name ASC, p.first_name ASC
    ),
    '[]'::jsonb
  ) INTO v_cashiers
  FROM public.profiles p
  WHERE p.school_id = v_school_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true;

  RETURN jsonb_build_object(
    'classes', v_classes,
    'cashiers', v_cashiers
  );
END;
$$;


--------------------------------------------------------------------------------
-- 4. PERMISSIONS & SÉCURISATION HIERARCHIQUE
--------------------------------------------------------------------------------

ALTER FUNCTION public.get_school_cash_register_journal(
  DATE, DATE, INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_school_cash_register_journal(
  DATE, DATE, INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_school_cash_register_journal(
  DATE, DATE, INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) TO authenticated;

ALTER FUNCTION public.get_school_cash_register_filter_options() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_school_cash_register_filter_options() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_school_cash_register_filter_options() TO authenticated;

COMMIT;
