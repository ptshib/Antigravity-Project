-- Migration PostgreSQL : 20261002125259_secure_bulk_issue_student_invoices.sql
-- Description : Émission groupée sécurisée et idempotente des factures brouillons (Lot 2K-FIN-BULK-ISSUE-B-V2)
-- Horodatage UTC : 2026-10-02 12:52:59 UTC

BEGIN;

--------------------------------------------------------------------------------
-- 1. TABLE D'AUDIT ET D'IDEMPOTENCE DE L'ÉMISSION GROUPÉE
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_finance_bulk_issue_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  requested_count INTEGER NOT NULL CHECK (requested_count > 0 AND requested_count <= 500),
  response_payload JSONB NOT NULL,
  initiated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_bulk_issue_ops_school_key UNIQUE (school_id, idempotency_key),
  CONSTRAINT chk_bulk_issue_ops_key_format CHECK (
    idempotency_key ~ '^bulk-issue-[0-9]{8}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ),
  CONSTRAINT chk_bulk_issue_ops_hash_format CHECK (
    request_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_bulk_issue_ops_school_key 
  ON public.school_finance_bulk_issue_operations(school_id, idempotency_key);

ALTER TABLE public.school_finance_bulk_issue_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_finance_bulk_issue_operations FORCE ROW LEVEL SECURITY;

-- Interdiction totale des accès directs pour PUBLIC, anon et authenticated (Accès exclusif via RPC SECURITY DEFINER)
REVOKE ALL ON TABLE public.school_finance_bulk_issue_operations FROM PUBLIC, anon, authenticated;

-- Triggers d'immutabilité stricte : Interdiction de UPDATE et DELETE
CREATE OR REPLACE FUNCTION public.prevent_bulk_issue_ops_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'REJET COMPTABLE : Immutabilité stricte. Les enregistrements d’opérations d’émission groupée ne peuvent être ni modifiés ni supprimés.'
    USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.prevent_bulk_issue_ops_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_bulk_issue_ops_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_bulk_issue_ops_update ON public.school_finance_bulk_issue_operations;
CREATE TRIGGER trg_prevent_bulk_issue_ops_update
  BEFORE UPDATE ON public.school_finance_bulk_issue_operations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_bulk_issue_ops_mutation();

DROP TRIGGER IF EXISTS trg_prevent_bulk_issue_ops_delete ON public.school_finance_bulk_issue_operations;
CREATE TRIGGER trg_prevent_bulk_issue_ops_delete
  BEFORE DELETE ON public.school_finance_bulk_issue_operations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_bulk_issue_ops_mutation();


--------------------------------------------------------------------------------
-- 2. RPC DE PRÉVISUALISATION : preview_bulk_issue_student_invoices
--------------------------------------------------------------------------------

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
      SELECT 
        inv.id,
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
      LEFT JOIN public.student_enrollments se ON se.student_id = st.id AND se.is_active = true AND se.school_id = inv.school_id
      LEFT JOIN public.classes c ON c.id = se.class_id
      WHERE inv.id = ANY(v_candidate_ids)
        AND inv.school_id = v_caller_school_id
      ORDER BY inv.created_at ASC
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


--------------------------------------------------------------------------------
-- 3. RPC D'ÉMISSION GROUPÉE : issue_bulk_student_invoices
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_bulk_student_invoices(
  p_invoice_ids UUID[],
  p_batch_issue_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  
  v_clean_ids UUID[];
  v_sorted_ids UUID[];
  v_count INTEGER;
  v_key_clean TEXT;
  v_request_hash TEXT;
  
  v_existing_op RECORD;
  v_inv RECORD;
  
  v_issued_count INTEGER := 0;
  v_existing_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_currency TEXT := NULL;
  
  v_issued_list JSONB := '[]'::JSONB;
  v_existing_list JSONB := '[]'::JSONB;
  v_skipped_list JSONB := '[]'::JSONB;
  
  v_item_count INTEGER;
  v_sum_items NUMERIC(14, 2);
  v_official_seq INTEGER;
  v_official_num TEXT;
  
  v_final_payload JSONB;
  v_inv_id UUID;
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
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif peut émettre des factures en masse.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validation stricte de la clé d'idempotency (Format : bulk-issue-YYYYMMDD-<uuid>)
  v_key_clean := trim(COALESCE(p_batch_issue_idempotency_key, ''));
  IF v_key_clean !~ '^bulk-issue-[0-9]{8}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'REJET : La clé d’idempotence d’émission est invalide. Format attendu : bulk-issue-YYYYMMDD-<uuid>.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Validation et normalisation du tableau des identifiants
  IF p_invoice_ids IS NULL OR ARRAY_LENGTH(p_invoice_ids, 1) = 0 THEN
    RAISE EXCEPTION 'REJET : Le tableau d’identifiants de factures à émettre ne peut être vide.'
      USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY_AGG(DISTINCT elem)
  INTO v_clean_ids
  FROM UNNEST(p_invoice_ids) elem
  WHERE elem IS NOT NULL;

  v_count := ARRAY_LENGTH(v_clean_ids, 1);
  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'REJET : Aucun identifiant de facture valide n’a été transmis.' USING ERRCODE = '22023';
  END IF;

  IF v_count > 500 THEN
    RAISE EXCEPTION 'REJET VOLUME : Impossible d’émettre plus de 500 factures par transaction (reçu : %). Veuillez segmenter votre demande.', v_count
      USING ERRCODE = '22023';
  END IF;

  -- 4. Trier le tableau d'UUID pour garantir un ordre de verrouillage déterministe et éviter les deadlocks
  SELECT ARRAY_AGG(elem ORDER BY elem ASC)
  INTO v_sorted_ids
  FROM UNNEST(v_clean_ids) elem;

  -- 5. Calcul d'une empreinte cryptographique SHA-256 déterministe de la requête
  v_request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        v_caller_school_id::text || ':' || v_count::text || ':' || pg_catalog.array_to_string(v_sorted_ids, ','),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- 6. Advisory Lock par établissement et par clé d'idempotence
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_caller_school_id::text),
    pg_catalog.hashtext(v_key_clean)
  );

  -- 7. Contrôle du rejeu idempotent dans la table d'opérations
  SELECT *
  INTO v_existing_op
  FROM public.school_finance_bulk_issue_operations
  WHERE school_id = v_caller_school_id
    AND idempotency_key = v_key_clean;

  IF v_existing_op.id IS NOT NULL THEN
    IF v_existing_op.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'REJET CONFLIT IDEMPOTENCE : La clé d’idempotence % a déjà été utilisée pour une liste de factures différente.', v_key_clean
        USING ERRCODE = '22023';
    END IF;

    -- Rejeu idempotent exact : Retourne le payload initiallement généré en modifiant dynamiquement is_idempotent_replay = true en mémoire
    v_final_payload := v_existing_op.response_payload;
    v_final_payload := pg_catalog.jsonb_set(v_final_payload, '{is_idempotent_replay}', 'true'::JSONB);
    RETURN v_final_payload;
  END IF;

  -- 8. Boucle d'émission atomique sur les factures triées
  FOREACH v_inv_id IN ARRAY v_sorted_ids LOOP
    SELECT 
      inv.id,
      inv.school_id,
      inv.academic_year_id,
      inv.invoice_number,
      inv.status,
      inv.currency,
      inv.due_date,
      inv.total_amount,
      st.student_number,
      st.first_name || ' ' || st.last_name AS student_name
    INTO v_inv
    FROM public.student_invoices inv
    JOIN public.students st ON st.id = inv.student_id
    WHERE inv.id = v_inv_id
    FOR UPDATE OF inv;

    IF v_inv.id IS NULL OR v_inv.school_id <> v_caller_school_id THEN
      RAISE EXCEPTION 'REJET ACCÈS : La facture % n’existe pas ou n’appartient pas à votre établissement.', v_inv_id
        USING ERRCODE = '42501';
    END IF;

    IF v_currency IS NULL THEN
      v_currency := v_inv.currency;
    END IF;

    -- Vérification des lignes et montants
    SELECT COUNT(*), COALESCE(SUM(total_price), 0.00)
    INTO v_item_count, v_sum_items
    FROM public.student_invoice_items
    WHERE invoice_id = v_inv_id;

    IF v_inv.status <> 'draft' THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_list := v_skipped_list || pg_catalog.jsonb_build_object(
        'invoice_id', v_inv.id,
        'student_number', COALESCE(v_inv.student_number, 'N/A'),
        'student_name', v_inv.student_name,
        'reason_code', 'already_issued',
        'reason_label', 'Facture déjà émise ou non-brouillon'
      );
    ELSIF v_item_count < 1 OR v_sum_items <= 0.00 THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_list := v_skipped_list || pg_catalog.jsonb_build_object(
        'invoice_id', v_inv.id,
        'student_number', COALESCE(v_inv.student_number, 'N/A'),
        'student_name', v_inv.student_name,
        'reason_code', 'invalid_total',
        'reason_label', 'Montant de facture invalide ou sans ligne de frais'
      );
    ELSE
      -- Attribution séquentielle du numéro officiel INV-YYYY-XXXXXX
      SELECT sequence_number, formatted_number
      INTO v_official_seq, v_official_num
      FROM public.get_next_finance_counter(v_caller_school_id, v_inv.academic_year_id, 'invoice');

      UPDATE public.student_invoices
      SET status = 'issued',
          invoice_number = v_official_num,
          total_amount = v_sum_items,
          updated_at = pg_catalog.now()
      WHERE id = v_inv_id;

      v_issued_count := v_issued_count + 1;
      v_issued_list := v_issued_list || pg_catalog.jsonb_build_object(
        'invoice_id', v_inv.id,
        'invoice_number', v_official_num,
        'student_number', COALESCE(v_inv.student_number, 'N/A'),
        'student_name', v_inv.student_name,
        'amount', v_sum_items,
        'currency', v_inv.currency,
        'status', 'issued'
      );
    END IF;
  END LOOP;

  -- 9. Construction du contrat JSON final (avec is_idempotent_replay = false pour le stockage initial)
  v_final_payload := pg_catalog.jsonb_build_object(
    'success', true,
    'is_idempotent_replay', false,
    'summary', pg_catalog.jsonb_build_object(
      'selected', v_count,
      'issued', v_issued_count,
      'existing', v_existing_count,
      'skipped', v_skipped_count
    ),
    'issued_invoices', v_issued_list,
    'existing_invoices', v_existing_list,
    'skipped_invoices', v_skipped_list
  );

  -- 10. Enregistrement de l'opération d'idempotency
  INSERT INTO public.school_finance_bulk_issue_operations (
    school_id,
    idempotency_key,
    request_hash,
    requested_count,
    response_payload,
    initiated_by
  ) VALUES (
    v_caller_school_id,
    v_key_clean,
    v_request_hash,
    v_count,
    v_final_payload,
    v_caller_id
  );

  RETURN v_final_payload;
END;
$$;

ALTER FUNCTION public.issue_bulk_student_invoices(UUID[], TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_bulk_student_invoices(UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_bulk_student_invoices(UUID[], TEXT) TO authenticated;

COMMIT;
