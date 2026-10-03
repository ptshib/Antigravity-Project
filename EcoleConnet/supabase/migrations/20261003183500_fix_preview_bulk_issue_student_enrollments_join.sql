-- Migration PostgreSQL : 20261003183500_fix_preview_bulk_issue_student_enrollments_join.sql
-- Description : Correction de la jointure student_enrollments sur se.status = 'active' dans preview_bulk_issue_student_invoices (Lot 2K-FIN-BULK-ISSUE-ENROLLMENT-HOTFIX)

BEGIN;

CREATE OR REPLACE FUNCTION public.preview_bulk_issue_student_invoices(
  p_source_batch_key TEXT DEFAULT NULL,
  p_fee_id UUID DEFAULT NULL,
  p_invoice_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_selector_count INTEGER := 0;
  v_selector_type TEXT;
  v_selector_label TEXT;
  
  v_candidate_ids UUID[] := ARRAY[]::UUID[];
  v_inv RECORD;
  
  v_selected INTEGER := 0;
  v_eligible INTEGER := 0;
  v_already_issued INTEGER := 0;
  v_invalid INTEGER := 0;
  v_estimated_total NUMERIC(14, 2) := 0.00;
  v_currency TEXT := NULL;
  
  v_eligible_list JSONB := '[]'::JSONB;
  v_excluded_list JSONB := '[]'::JSONB;
  v_item_count INTEGER;
  v_sum_items NUMERIC(14, 2);
  
  v_clean_invoice_ids UUID[];
BEGIN
  -- 1. Contrôle d'authentification
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id
  INTO v_caller_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif peut prévisualiser l’émission groupée.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validation stricte du sélecteur unique
  IF p_source_batch_key IS NOT NULL AND trim(p_source_batch_key) <> '' THEN
    v_selector_count := v_selector_count + 1;
    v_selector_type := 'source_batch_key';
    v_selector_label := 'Brouillons du traitement groupé';
  END IF;

  IF p_fee_id IS NOT NULL THEN
    v_selector_count := v_selector_count + 1;
    v_selector_type := 'fee_id';
    v_selector_label := 'Brouillons du tarif sélectionné';
  END IF;

  IF p_invoice_ids IS NOT NULL AND ARRAY_LENGTH(p_invoice_ids, 1) > 0 THEN
    v_selector_count := v_selector_count + 1;
    v_selector_type := 'invoice_ids';
    v_selector_label := 'Sélection explicite de factures';
  END IF;

  IF v_selector_count <> 1 THEN
    RAISE EXCEPTION 'REJET : Vous devez fournir exactement un seul sélecteur (p_source_batch_key, p_fee_id ou p_invoice_ids).'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Récupération des factures candidates (max 2 000 pour la prévisualisation)
  IF v_selector_type = 'source_batch_key' THEN
    SELECT ARRAY_AGG(id ORDER BY created_at ASC)
    INTO v_candidate_ids
    FROM (
      SELECT id, created_at
      FROM public.student_invoices
      WHERE school_id = v_caller_school_id
        AND idempotency_key LIKE 'bulk:' || trim(p_source_batch_key) || ':%'
      LIMIT 2000
    ) sub;

  ELSIF v_selector_type = 'fee_id' THEN
    SELECT ARRAY_AGG(id ORDER BY created_at ASC)
    INTO v_candidate_ids
    FROM (
      SELECT DISTINCT inv.id, inv.created_at
      FROM public.student_invoices inv
      JOIN public.student_invoice_items itm ON itm.invoice_id = inv.id
      WHERE inv.school_id = v_caller_school_id
        AND itm.fee_id = p_fee_id
      LIMIT 2000
    ) sub;

  ELSIF v_selector_type = 'invoice_ids' THEN
    SELECT ARRAY_AGG(DISTINCT elem)
    INTO v_clean_invoice_ids
    FROM UNNEST(p_invoice_ids) elem
    WHERE elem IS NOT NULL;

    IF v_clean_invoice_ids IS NULL OR ARRAY_LENGTH(v_clean_invoice_ids, 1) = 0 THEN
      RAISE EXCEPTION 'REJET : Le tableau d’identifiants de factures ne peut être vide.' USING ERRCODE = '22023';
    END IF;

    IF ARRAY_LENGTH(v_clean_invoice_ids, 1) > 2000 THEN
      RAISE EXCEPTION 'REJET : La prévisualisation d’émission est limitée à 2 000 factures maximum.' USING ERRCODE = '22023';
    END IF;

    v_candidate_ids := v_clean_invoice_ids;
  END IF;

  v_candidate_ids := COALESCE(v_candidate_ids, ARRAY[]::UUID[]);
  v_selected := ARRAY_LENGTH(v_candidate_ids, 1);
  IF v_selected IS NULL THEN v_selected := 0; END IF;

  -- 4. Évaluation détaillée de chaque facture candidate
  IF v_selected > 0 THEN
    FOR v_inv IN
      SELECT DISTINCT ON (inv.id)
        inv.id,
        inv.created_at,
        inv.school_id,
        inv.status,
        inv.currency,
        inv.due_date,
        inv.total_amount,
        st.student_number,
        st.first_name || ' ' || st.last_name AS student_name,
        COALESCE(c.name, 'Non assigné') AS class_name
      FROM public.student_invoices inv
      JOIN public.students st ON st.id = inv.student_id
      LEFT JOIN public.student_enrollments se
        ON se.student_id = st.id
       AND se.school_id = inv.school_id
       AND se.academic_year_id = inv.academic_year_id
       AND se.status = 'active'
      LEFT JOIN public.classes c
        ON c.id = se.class_id
      WHERE inv.id = ANY(v_candidate_ids)
        AND inv.school_id = v_caller_school_id
      ORDER BY inv.id, inv.created_at ASC
    LOOP
      IF v_currency IS NULL THEN
        v_currency := v_inv.currency;
      END IF;

      -- Vérification des lignes
      SELECT COUNT(*), COALESCE(SUM(total_price), 0.00)
      INTO v_item_count, v_sum_items
      FROM public.student_invoice_items
      WHERE invoice_id = v_inv.id;

      IF v_inv.status <> 'draft' THEN
        v_already_issued := v_already_issued + 1;
        v_excluded_list := v_excluded_list || pg_catalog.jsonb_build_object(
          'invoice_id', v_inv.id,
          'student_number', COALESCE(v_inv.student_number, 'N/A'),
          'student_name', v_inv.student_name,
          'reason_code', 'already_issued',
          'reason_label', 'Facture déjà émise ou non-brouillon'
        );
      ELSIF v_item_count < 1 OR v_sum_items <= 0.00 THEN
        v_invalid := v_invalid + 1;
        v_excluded_list := v_excluded_list || pg_catalog.jsonb_build_object(
          'invoice_id', v_inv.id,
          'student_number', COALESCE(v_inv.student_number, 'N/A'),
          'student_name', v_inv.student_name,
          'reason_code', 'invalid_total',
          'reason_label', 'Montant de facture invalide ou sans ligne de frais'
        );
      ELSE
        v_eligible := v_eligible + 1;
        v_estimated_total := v_estimated_total + v_sum_items;
        v_eligible_list := v_eligible_list || pg_catalog.jsonb_build_object(
          'invoice_id', v_inv.id,
          'student_number', COALESCE(v_inv.student_number, 'N/A'),
          'student_name', v_inv.student_name,
          'class_name', v_inv.class_name,
          'amount', v_sum_items,
          'currency', v_inv.currency,
          'due_date', v_inv.due_date
        );
      END IF;
    END LOOP;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'selector', pg_catalog.jsonb_build_object(
      'type', v_selector_type,
      'label', v_selector_label
    ),
    'summary', pg_catalog.jsonb_build_object(
      'selected', v_selected,
      'eligible', v_eligible,
      'already_issued', v_already_issued,
      'invalid', v_invalid,
      'estimated_total', v_estimated_total,
      'currency', COALESCE(v_currency, 'USD')
    ),
    'eligible_invoices', v_eligible_list,
    'excluded_invoices', v_excluded_list
  );
END;
$$;

ALTER FUNCTION public.preview_bulk_issue_student_invoices(TEXT, UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_bulk_issue_student_invoices(TEXT, UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_bulk_issue_student_invoices(TEXT, UUID, UUID[]) TO authenticated;

COMMIT;
