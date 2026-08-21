-- ============================================================================
-- Migration : Idempotence Strict Par Empreinte & Annulation Auditable des Brouillons
-- Fichier   : supabase/migrations/20260820160000_invoice_draft_idempotency_and_safe_cleanup.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. COLONNES DE TRAÇABILITÉ ET INDEX D'IDEMPOTENCE
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'student_invoices' AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE public.student_invoices ADD COLUMN idempotency_key TEXT DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'student_invoices' AND column_name = 'request_fingerprint'
  ) THEN
    ALTER TABLE public.student_invoices ADD COLUMN request_fingerprint TEXT DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'student_invoices' AND column_name = 'notes'
  ) THEN
    ALTER TABLE public.student_invoices ADD COLUMN notes TEXT DEFAULT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS student_invoices_school_idempotency_key_idx
ON public.student_invoices (school_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';


--------------------------------------------------------------------------------
-- 2. SUPPRESSION DES ANCIENNES SURCHARGES (ÉLIMINATION DE TOUTE AMBIGUÏTÉ POSTGREST)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE);
DROP FUNCTION IF EXISTS public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE, TEXT);


--------------------------------------------------------------------------------
-- 3. RPC CANONIQUE UNIQUE : CREATE_DRAFT_STUDENT_INVOICE
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_draft_student_invoice(
  p_student_id UUID,
  p_academic_year_id UUID,
  p_due_date DATE,
  p_currency TEXT,
  p_items JSONB,
  p_idempotency_key TEXT,
  p_issue_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_caller_role TEXT;
  
  v_clean_idempotency_key TEXT;
  v_clean_notes TEXT;
  v_fingerprint TEXT;
  v_canonical_str TEXT;
  
  v_existing_inv RECORD;
  v_enrollment_id UUID;
  v_class_id UUID;
  
  v_item RECORD;
  v_item_fee_id UUID;
  v_item_fee_name TEXT;
  v_item_fee_type TEXT;
  v_item_unit_price NUMERIC(14, 2);
  v_item_quantity INTEGER;
  v_item_total_price NUMERIC(14, 2);
  
  v_catalog_fee RECORD;
  v_calculated_total NUMERIC(14, 2) := 0.00;
  v_item_count INTEGER := 0;
  
  v_inv_seq INTEGER;
  v_inv_num TEXT;
  v_invoice_id UUID;
  
  v_fee_ids_seen UUID[] := ARRAY[]::UUID[];
  v_actual_issue_date DATE;
  
  v_validated_items JSONB := '[]'::jsonb;
  v_val_item RECORD;
BEGIN
  -- A. Authentification & Droits Staff Financier
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role
  INTO v_caller_school_id, v_caller_role
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif d’un établissement actif peut créer une facture.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Validation Stricte de la Clé d'Idempotence (Obligatoire)
  v_clean_idempotency_key := pg_catalog.btrim(COALESCE(p_idempotency_key, ''));
  IF v_clean_idempotency_key = '' OR pg_catalog.length(v_clean_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : La clé d''idempotence est obligatoire (non vide, max 128 caractères).'
      USING ERRCODE = '22023';
  END IF;

  -- C. Validation des Notes Optionnelles
  v_clean_notes := pg_catalog.btrim(COALESCE(p_notes, ''));
  IF v_clean_notes = '' THEN
    v_clean_notes := NULL;
  ELSIF pg_catalog.length(v_clean_notes) > 500 THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Les notes complémentaires ne peuvent dépasser 500 caractères.'
      USING ERRCODE = '22023';
  END IF;

  -- D. Validation de l'Année Scolaire
  IF NOT EXISTS (
    SELECT 1 FROM public.academic_years
    WHERE id = p_academic_year_id AND school_id = v_caller_school_id
  ) THEN
    RAISE EXCEPTION 'REJET : L’année scolaire spécifiée est introuvable ou n’appartient pas à votre établissement.'
      USING ERRCODE = '22023';
  END IF;

  -- E. Validation de l'Inscription Active
  SELECT se.id, se.class_id
  INTO v_enrollment_id, v_class_id
  FROM public.student_enrollments se
  JOIN public.students st ON st.id = se.student_id AND st.school_id = se.school_id
  WHERE se.student_id = p_student_id
    AND se.academic_year_id = p_academic_year_id
    AND se.school_id = v_caller_school_id
    AND se.status = 'active';

  IF v_enrollment_id IS NULL THEN
    RAISE EXCEPTION 'REJET : L’élève spécifié ne possède aucune inscription active pour cette année scolaire dans votre établissement.'
      USING ERRCODE = '22023';
  END IF;

  -- F. Validation de la Devise et des Dates
  IF p_currency NOT IN ('USD', 'CDF') THEN
    RAISE EXCEPTION 'REJET : Devise non supportée (%). Seules les devises USD et CDF sont autorisées.', p_currency
      USING ERRCODE = '22023';
  END IF;

  v_actual_issue_date := COALESCE(p_issue_date, CURRENT_DATE);

  IF v_actual_issue_date < '2000-01-01'::DATE OR v_actual_issue_date > (CURRENT_DATE + INTERVAL '30 days') THEN
    RAISE EXCEPTION 'REJET : Date d’émission hors plage autorisée (%).', v_actual_issue_date
      USING ERRCODE = '22023';
  END IF;

  IF p_due_date IS NOT NULL AND p_due_date < v_actual_issue_date THEN
    RAISE EXCEPTION 'REJET : La date d’échéance (%) ne peut être antérieure à la date d’émission (%).',
      p_due_date, v_actual_issue_date
      USING ERRCODE = '22023';
  END IF;

  IF p_due_date IS NOT NULL AND p_due_date > (CURRENT_DATE + INTERVAL '5 years') THEN
    RAISE EXCEPTION 'REJET : Date d’échéance excessivement lointaine (%).', p_due_date
      USING ERRCODE = '22023';
  END IF;

  -- G. Validation Stricte des Lignes de Facture (JSONB)
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'REJET : Une facture doit comporter au moins une ligne de frais valide.'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'REJET : Le nombre maximum de lignes par facture est limité à 50.'
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_items) AS (
    fee_id UUID,
    fee_name TEXT,
    fee_type TEXT,
    unit_price NUMERIC,
    quantity INTEGER
  ) LOOP
    v_item_count := v_item_count + 1;
    v_item_fee_id := v_item.fee_id;
    v_item_quantity := COALESCE(v_item.quantity, 1);

    IF v_item_quantity <= 0 OR v_item_quantity > 1000 THEN
      RAISE EXCEPTION 'REJET : Ligne % : La quantité doit être comprise entre 1 et 1000 (reçu: %).', v_item_count, v_item_quantity
        USING ERRCODE = '22023';
    END IF;

    IF v_item_fee_id IS NOT NULL THEN
      IF v_item_fee_id = ANY(v_fee_ids_seen) THEN
        RAISE EXCEPTION 'REJET : Le frais de scolarité catalogue (%) est présent en double dans la même facture.', v_item_fee_id
          USING ERRCODE = '23505';
      END IF;
      v_fee_ids_seen := pg_catalog.array_append(v_fee_ids_seen, v_item_fee_id);

      SELECT id, name, fee_type, amount, currency, class_id, is_active
      INTO v_catalog_fee
      FROM public.school_fees
      WHERE id = v_item_fee_id
        AND school_id = v_caller_school_id
        AND academic_year_id = p_academic_year_id
      FOR SHARE;

      IF v_catalog_fee.id IS NULL THEN
        RAISE EXCEPTION 'REJET : Ligne % : Le frais catalogue (%) est introuvable ou n’appartient pas à cette année scolaire.', v_item_count, v_item_fee_id
          USING ERRCODE = '22023';
      END IF;

      IF NOT v_catalog_fee.is_active THEN
        RAISE EXCEPTION 'REJET : Ligne % : Le frais catalogue "%" est inactif.', v_item_count, v_catalog_fee.name
          USING ERRCODE = '22023';
      END IF;

      IF v_catalog_fee.currency <> p_currency THEN
        RAISE EXCEPTION 'REJET : Ligne % : La devise du frais catalogue (%) ne correspond pas à la devise de la facture (%).',
          v_item_count, v_catalog_fee.currency, p_currency
          USING ERRCODE = '22023';
      END IF;

      IF v_catalog_fee.class_id IS NOT NULL AND v_catalog_fee.class_id <> v_class_id THEN
        RAISE EXCEPTION 'REJET : Ligne % : Le frais catalogue "%" est restreint à une autre classe.', v_item_count, v_catalog_fee.name
          USING ERRCODE = '22023';
      END IF;

      v_item_unit_price := v_catalog_fee.amount;
      v_item_fee_name := v_catalog_fee.name;
      v_item_fee_type := v_catalog_fee.fee_type;
    ELSE
      v_item_fee_name := pg_catalog.btrim(COALESCE(v_item.fee_name, ''));
      v_item_fee_type := pg_catalog.btrim(COALESCE(v_item.fee_type, ''));
      v_item_unit_price := v_item.unit_price;

      IF pg_catalog.length(v_item_fee_name) < 1 OR pg_catalog.length(v_item_fee_name) > 150 THEN
        RAISE EXCEPTION 'REJET : Ligne % : L’intitulé du frais personnalisé doit comporter entre 1 et 150 caractères.', v_item_count
          USING ERRCODE = '22023';
      END IF;

      IF v_item_fee_type NOT IN ('inscription', 'minerval', 'transport', 'cantine', 'uniforme', 'activites', 'frais_etat', 'autre') THEN
        RAISE EXCEPTION 'REJET : Ligne % : Type de frais personnalisé invalide (%).', v_item_count, v_item_fee_type
          USING ERRCODE = '22023';
      END IF;

      IF v_item_unit_price IS NULL OR v_item_unit_price <= 0 OR v_item_unit_price > 100000000.00 THEN
        RAISE EXCEPTION 'REJET : Ligne % : Le prix unitaire personnalisé doit être strictement positif et valide.', v_item_count
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_item_total_price := v_item_unit_price * v_item_quantity;
    v_calculated_total := v_calculated_total + v_item_total_price;

    v_validated_items := v_validated_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'fee_id', v_item_fee_id,
        'fee_name', v_item_fee_name,
        'fee_type', v_item_fee_type,
        'unit_price', v_item_unit_price,
        'quantity', v_item_quantity,
        'total_price', v_item_total_price
      )
    );
  END LOOP;

  IF v_calculated_total <= 0 THEN
    RAISE EXCEPTION 'REJET : Le montant total calculé de la facture doit être strictement supérieur à 0.'
      USING ERRCODE = '22023';
  END IF;

  -- H. Calcul de l'Empreinte Canonique Opérationnelle (SHA-256 / MD5)
  v_canonical_str := pg_catalog.concat_ws('|',
    p_student_id::text,
    p_academic_year_id::text,
    v_actual_issue_date::text,
    COALESCE(p_due_date::text, 'NULL'),
    p_currency,
    v_calculated_total::text,
    v_validated_items::text,
    COALESCE(v_clean_notes, 'NULL')
  );
  v_fingerprint := pg_catalog.md5(v_canonical_str);

  -- I. Verrou Transactionnel Advisory Déterministe pour Concurrence Haute
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_caller_school_id::text),
    pg_catalog.hashtext(v_clean_idempotency_key)
  );

  -- J. Recherche de Facture Existante Après Acquisition du Verrou
  SELECT id, invoice_number, sequence_number, status, currency, total_amount, due_date, created_at, request_fingerprint
  INTO v_existing_inv
  FROM public.student_invoices
  WHERE school_id = v_caller_school_id
    AND idempotency_key = v_clean_idempotency_key;

  IF v_existing_inv.id IS NOT NULL THEN
    IF v_existing_inv.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'REJET IDEMPOTENCE : La clé d''idempotence "%" a déjà été utilisée avec des paramètres opérationnels différents.', v_clean_idempotency_key
        USING ERRCODE = '23505';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'is_idempotent_replay', true,
      'invoice_id', v_existing_inv.id,
      'invoice_number', v_existing_inv.invoice_number,
      'sequence_number', v_existing_inv.sequence_number,
      'status', v_existing_inv.status,
      'currency', v_existing_inv.currency,
      'total_amount', v_existing_inv.total_amount,
      'due_date', v_existing_inv.due_date,
      'created_at', v_existing_inv.created_at
    );
  END IF;

  -- K. Génération du Numéro Séquentiel Atomique
  SELECT sequence_number, formatted_number
  INTO v_inv_seq, v_inv_num
  FROM public.get_next_finance_counter(v_caller_school_id, p_academic_year_id, 'invoice');

  -- L. Insertion de l'En-tête de Facture (Draft)
  INSERT INTO public.student_invoices (
    school_id,
    academic_year_id,
    student_id,
    enrollment_id,
    class_id,
    invoice_number,
    sequence_number,
    issue_date,
    due_date,
    currency,
    total_amount,
    paid_amount,
    status,
    created_by,
    idempotency_key,
    request_fingerprint,
    notes
  ) VALUES (
    v_caller_school_id,
    p_academic_year_id,
    p_student_id,
    v_enrollment_id,
    v_class_id,
    v_inv_num,
    v_inv_seq,
    v_actual_issue_date,
    p_due_date,
    p_currency,
    v_calculated_total,
    0.00,
    'draft',
    v_caller_id,
    v_clean_idempotency_key,
    v_fingerprint,
    v_clean_notes
  )
  RETURNING id INTO v_invoice_id;

  -- M. Insertion des Lignes Validées
  FOR v_val_item IN SELECT * FROM pg_catalog.jsonb_to_recordset(v_validated_items) AS (
    fee_id UUID,
    fee_name TEXT,
    fee_type TEXT,
    unit_price NUMERIC(14, 2),
    quantity INTEGER,
    total_price NUMERIC(14, 2)
  ) LOOP
    INSERT INTO public.student_invoice_items (
      invoice_id,
      school_id,
      academic_year_id,
      student_id,
      currency,
      fee_id,
      fee_name,
      fee_type,
      unit_price,
      quantity,
      total_price
    ) VALUES (
      v_invoice_id,
      v_caller_school_id,
      p_academic_year_id,
      p_student_id,
      p_currency,
      v_val_item.fee_id,
      v_val_item.fee_name,
      v_val_item.fee_type,
      v_val_item.unit_price,
      v_val_item.quantity,
      v_val_item.total_price
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'is_idempotent_replay', false,
    'invoice_id', v_invoice_id,
    'invoice_number', v_inv_num,
    'sequence_number', v_inv_seq,
    'status', 'draft',
    'currency', p_currency,
    'total_amount', v_calculated_total,
    'due_date', p_due_date,
    'created_at', pg_catalog.now()
  );
END;
$$;


--------------------------------------------------------------------------------
-- 4. RPC VOID_DRAFT_STUDENT_INVOICE (ANNULATION AUDITABLE DES BROUILLONS)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.void_draft_student_invoice(
  p_invoice_id UUID,
  p_cancel_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_clean_reason TEXT;
  v_inv RECORD;
  v_payment_count INTEGER := 0;
BEGIN
  -- A. Authentification & Droits Staff
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id INTO v_caller_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Opération réservée exclusivement au personnel financier actif de cet établissement.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Validation du Motif d'Annulation
  v_clean_reason := pg_catalog.btrim(COALESCE(p_cancel_reason, ''));
  IF pg_catalog.length(v_clean_reason) < 10 THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Le motif d''annulation du brouillon doit comporter au moins 10 caractères.'
      USING ERRCODE = '22023';
  END IF;

  -- C. Verrouillage et Contrôle de la Facture
  SELECT id, invoice_number, status, paid_amount, school_id
  INTO v_inv
  FROM public.student_invoices
  WHERE id = p_invoice_id
    AND school_id = v_caller_school_id
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : La facture spécifiée (%) est introuvable ou n''appartient pas à votre établissement.', p_invoice_id
      USING ERRCODE = '22023';
  END IF;

  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'REJET MÉTIER : Seule une facture au statut brouillon ("draft") peut être annulée par cette RPC (statut actuel: %).', v_inv.status
      USING ERRCODE = '22023';
  END IF;

  IF v_inv.paid_amount > 0 THEN
    RAISE EXCEPTION 'REJET MÉTIER : Impossible d''annuler une facture possédant déjà des encaissements enregistrés (montant réglé: %).', v_inv.paid_amount
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_payment_count
  FROM public.student_payments
  WHERE invoice_id = p_invoice_id;

  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'REJET MÉTIER : Impossible d''annuler une facture possédant % encaissement(s) lié(s).', v_payment_count
      USING ERRCODE = '22023';
  END IF;

  -- D. Mise à jour du Statut vers 'voided' avec Traçabilité Complète (Respect de chk_invoice_void_state)
  UPDATE public.student_invoices
  SET status = 'voided',
      voided_at = pg_catalog.now(),
      voided_by = v_caller_id,
      void_reason = v_clean_reason,
      updated_at = pg_catalog.now()
  WHERE id = p_invoice_id
    AND school_id = v_caller_school_id;

  -- E. Journalisation d'Audit Réglementaire
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_caller_school_id,
    v_caller_id,
    'draft_invoice_voided',
    pg_catalog.jsonb_build_object(
      'invoice_id', p_invoice_id,
      'invoice_number', v_inv.invoice_number,
      'cancel_reason', v_clean_reason,
      'voided_at', pg_catalog.now()
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'invoice_number', v_inv.invoice_number,
    'status', 'voided',
    'voided_at', pg_catalog.now()
  );
END;
$$;


--------------------------------------------------------------------------------
-- 5. PRIVILÈGES D'EXÉCUTION STRICTS
--------------------------------------------------------------------------------

ALTER FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) TO service_role;

ALTER FUNCTION public.void_draft_student_invoice(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.void_draft_student_invoice(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_draft_student_invoice(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.void_draft_student_invoice(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_draft_student_invoice(UUID, TEXT) TO service_role;

COMMIT;
