-- ============================================================================
-- Migration : RPCs Transactionnelles Sécurisées Finance 1 (Version Corrigée)
-- Fichier   : supabase/migrations/20260820110000_school_finance_rpcs.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. FONCTION INTERNE : COMPTEUR SÉQUENTIEL ATOMIQUE SÉCURISÉ
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_next_finance_counter(
  p_school_id UUID,
  p_academic_year_id UUID,
  p_counter_type TEXT
)
RETURNS TABLE (
  sequence_number INTEGER,
  formatted_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seq INTEGER;
  v_prefix TEXT;
  v_year_str TEXT;
BEGIN
  IF p_counter_type NOT IN ('invoice', 'payment', 'receipt') THEN
    RAISE EXCEPTION 'REJET COMPTEUR : Type de compteur financier invalide (%).', p_counter_type
      USING ERRCODE = '22023';
  END IF;

  v_prefix := CASE p_counter_type
    WHEN 'invoice' THEN 'INV'
    WHEN 'payment' THEN 'PAY'
    WHEN 'receipt' THEN 'REC'
  END;

  -- Extraction déterministe de l'année scolaire de rattachement
  SELECT pg_catalog.to_char(starts_on, 'YYYY')
  INTO v_year_str
  FROM public.academic_years
  WHERE id = p_academic_year_id
    AND school_id = p_school_id;

  IF v_year_str IS NULL OR pg_catalog.length(pg_catalog.btrim(v_year_str)) = 0 THEN
    v_year_str := pg_catalog.to_char(CURRENT_DATE, 'YYYY');
  END IF;

  -- Incrémentation atomique sûre en concurrence avec UPSERT et verrou de ligne
  INSERT INTO public.school_finance_counters (
    school_id,
    academic_year_id,
    counter_type,
    last_value,
    updated_at
  )
  VALUES (
    p_school_id,
    p_academic_year_id,
    p_counter_type,
    1,
    pg_catalog.now()
  )
  ON CONFLICT (school_id, academic_year_id, counter_type)
  DO UPDATE SET
    last_value = public.school_finance_counters.last_value + 1,
    updated_at = pg_catalog.now()
  RETURNING public.school_finance_counters.last_value INTO v_seq;

  sequence_number := v_seq;
  formatted_number := v_prefix || '-' || v_year_str || '-' || pg_catalog.lpad(v_seq::text, 6, '0');
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.get_next_finance_counter(UUID, UUID, TEXT) OWNER TO postgres;


--------------------------------------------------------------------------------
-- 2. RPC : CRÉATION D'UNE FACTURE ÉLÈVE EN BROUILLON (create_draft_student_invoice)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_draft_student_invoice(
  p_student_id UUID,
  p_academic_year_id UUID,
  p_due_date DATE,
  p_currency TEXT,
  p_items JSONB,
  p_issue_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_caller_role TEXT;
  
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
  
  -- Tampon en mémoire des lignes validées pour insertion directe sans relecture
  v_validated_items JSONB := '[]'::jsonb;
  v_val_item RECORD;
BEGIN
  -- A. Authentification & Contrôle d'Accès Staff Financier
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

  -- B. Validation de l'Année Scolaire
  IF NOT EXISTS (
    SELECT 1 FROM public.academic_years
    WHERE id = p_academic_year_id AND school_id = v_caller_school_id
  ) THEN
    RAISE EXCEPTION 'REJET : L’année scolaire spécifiée est introuvable ou n’appartient pas à votre établissement.'
      USING ERRCODE = '22023';
  END IF;

  -- C. Validation de l'Inscription Active via public.student_enrollments (Jointure Scolaire Réelle)
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

  -- D. Validation de la Devise et des Dates
  IF p_currency NOT IN ('USD', 'CDF') THEN
    RAISE EXCEPTION 'REJET : Devise non supportée (%). Seules les devises USD et CDF sont autorisées.', p_currency
      USING ERRCODE = '22023';
  END IF;

  v_actual_issue_date := COALESCE(p_issue_date, CURRENT_DATE);

  IF v_actual_issue_date < '2000-01-01'::DATE OR v_actual_issue_date > (CURRENT_DATE + INTERVAL '30 days') THEN
    RAISE EXCEPTION 'REJET : Date d’émission hors plage autorisée (%).', v_actual_issue_date
      USING ERRCODE = '22023';
  END IF;

  IF p_due_date < v_actual_issue_date THEN
    RAISE EXCEPTION 'REJET : La date d’échéance (%) ne peut être antérieure à la date d’émission (%).',
      p_due_date, v_actual_issue_date
      USING ERRCODE = '22023';
  END IF;

  IF p_due_date > (CURRENT_DATE + INTERVAL '5 years') THEN
    RAISE EXCEPTION 'REJET : Date d’échéance excessivement lointaine (%).', p_due_date
      USING ERRCODE = '22023';
  END IF;

  -- E. Validation Stricte des Lignes de Facture (JSONB)
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'REJET : Une facture doit comporter au moins une ligne de frais valide.'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'REJET : Le nombre maximum de lignes par facture est limité à 50.'
      USING ERRCODE = '22023';
  END IF;

  -- Validation et mémorisation en mémoire des lignes validées côté serveur
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

    -- SI fee_id est fourni : verrouillage et utilisation EXCLUSIVE des données catalogue côté serveur
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

      -- Assignation stricte depuis le catalogue serveur
      v_item_unit_price := v_catalog_fee.amount;
      v_item_fee_name := v_catalog_fee.name;
      v_item_fee_type := v_catalog_fee.fee_type;
    ELSE
      -- Frais personnalisé hors catalogue
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

    -- Mémorisation dans le tampon des lignes validées
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

  -- F. Génération du Numéro Séquentiel Atomique
  SELECT sequence_number, formatted_number
  INTO v_inv_seq, v_inv_num
  FROM public.get_next_finance_counter(v_caller_school_id, p_academic_year_id, 'invoice');

  -- G. Insertion de l'En-tête de Facture (Draft)
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
    created_by
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
    v_caller_id
  )
  RETURNING id INTO v_invoice_id;

  -- H. Insertion Directe des Lignes depuis le Tampon Validé (Sans Relecture du Catalogue)
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

ALTER FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE) OWNER TO postgres;


--------------------------------------------------------------------------------
-- 3. RPC : ÉMISSION D'UNE FACTURE (issue_student_invoice)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_student_invoice(
  p_invoice_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_invoice RECORD;
  v_item_count INTEGER;
  v_sum_items NUMERIC(14, 2);
BEGIN
  -- A. Authentification & Contrôle d'Accès Staff Financier
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
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif peut émettre une facture.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Verrouillage de la Facture sous SELECT FOR UPDATE
  SELECT *
  INTO v_invoice
  FROM public.student_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Facture introuvable.' USING ERRCODE = '22023';
  END IF;

  IF v_invoice.school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : Cette facture n’appartient pas à votre établissement.' USING ERRCODE = '42501';
  END IF;

  IF v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'REJET : Seule une facture au statut draft peut être émise (statut actuel : %).', v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  -- C. Recalcul et Vérification Comptable de la Somme des Lignes
  SELECT COUNT(*), COALESCE(SUM(total_price), 0.00)
  INTO v_item_count, v_sum_items
  FROM public.student_invoice_items
  WHERE invoice_id = p_invoice_id;

  IF v_item_count < 1 THEN
    RAISE EXCEPTION 'REJET COMPTABLE : Impossible d’émettre une facture sans aucune ligne de frais (0 ligne trouvée).'
      USING ERRCODE = '22023';
  END IF;

  IF v_sum_items <= 0.00 THEN
    RAISE EXCEPTION 'REJET COMPTABLE : Le montant total de la facture doit être strictement supérieur à 0 (somme: %).', v_sum_items
      USING ERRCODE = '22023';
  END IF;

  -- D. Transition de Statut vers 'issued'
  UPDATE public.student_invoices
  SET status = 'issued',
      total_amount = v_sum_items,
      updated_at = pg_catalog.now()
  WHERE id = p_invoice_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'invoice_number', v_invoice.invoice_number,
    'status', 'issued',
    'total_amount', v_sum_items,
    'currency', v_invoice.currency,
    'issue_date', v_invoice.issue_date,
    'due_date', v_invoice.due_date,
    'updated_at', pg_catalog.now()
  );
END;
$$;

ALTER FUNCTION public.issue_student_invoice(UUID) OWNER TO postgres;


--------------------------------------------------------------------------------
-- 4. RPC : ENREGISTREMENT SÉCURISÉ D'UN PAIEMENT (record_student_payment)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_student_payment(
  p_invoice_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_idempotency_key TEXT,
  p_payment_date DATE DEFAULT CURRENT_DATE,
  p_payment_reference TEXT DEFAULT NULL,
  p_payer_name TEXT DEFAULT NULL,
  p_internal_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_cashier_name TEXT;
  
  v_existing_pay RECORD;
  v_inv RECORD;
  
  v_remaining_balance NUMERIC(14, 2);
  v_new_paid NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
  v_new_status TEXT;
  
  v_pay_seq INTEGER;
  v_pay_num TEXT;
  v_rec_seq INTEGER;
  v_rec_num TEXT;
  
  v_payment_id UUID;
  v_receipt_id UUID;
  
  v_actual_pay_date DATE;
BEGIN
  -- A. Validation Stricte des Paramètres, Longueurs et Types
  IF p_idempotency_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) = 0 OR pg_catalog.length(p_idempotency_key) > 100 THEN
    RAISE EXCEPTION 'REJET : La clé d’idempotence (idempotency_key) est requise et doit comporter entre 1 et 100 caractères.'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000000.00 THEN
    RAISE EXCEPTION 'REJET : Le montant du paiement doit être strictement supérieur à 0 et valide (reçu: %).', p_amount
      USING ERRCODE = '22023';
  END IF;

  IF p_payment_method NOT IN ('cash', 'bank_transfer', 'bank_deposit', 'check', 'mobile_money_manual', 'other') THEN
    RAISE EXCEPTION 'REJET : Moyen de paiement non reconnu (%).', p_payment_method
      USING ERRCODE = '22023';
  END IF;

  IF p_payment_reference IS NOT NULL AND pg_catalog.length(p_payment_reference) > 150 THEN
    RAISE EXCEPTION 'REJET : La référence de paiement ne peut dépasser 150 caractères.'
      USING ERRCODE = '22023';
  END IF;

  IF p_payer_name IS NOT NULL AND pg_catalog.length(p_payer_name) > 150 THEN
    RAISE EXCEPTION 'REJET : Le nom du payeur ne peut dépasser 150 caractères.'
      USING ERRCODE = '22023';
  END IF;

  IF p_internal_note IS NOT NULL AND pg_catalog.length(p_internal_note) > 500 THEN
    RAISE EXCEPTION 'REJET : La note interne ne peut dépasser 500 caractères.'
      USING ERRCODE = '22023';
  END IF;

  v_actual_pay_date := COALESCE(p_payment_date, CURRENT_DATE);
  IF v_actual_pay_date < '2000-01-01'::DATE OR v_actual_pay_date > (CURRENT_DATE + INTERVAL '7 days') THEN
    RAISE EXCEPTION 'REJET : Date de règlement hors plage autorisée (%).', v_actual_pay_date
      USING ERRCODE = '22023';
  END IF;

  -- B. Authentification & Contrôle d'Accès Staff Financier
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, pg_catalog.btrim(p.first_name || ' ' || p.last_name)
  INTO v_caller_school_id, v_cashier_name
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif peut enregistrer un paiement.'
      USING ERRCODE = '42501';
  END IF;

  IF v_cashier_name IS NULL OR pg_catalog.length(pg_catalog.btrim(v_cashier_name)) = 0 THEN
    v_cashier_name := 'Agent Financier';
  END IF;

  -- C. Sérialisation Transactionnelle par École + Clé d'Idempotence (Advisory Lock Transactionnel)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('school_pay_idemp:' || v_caller_school_id::text || ':' || pg_catalog.btrim(p_idempotency_key))
  );

  -- D. Vérification de l'Idempotence sous Verrou Exclusif avec Comparaison Exhaustive IS DISTINCT FROM
  SELECT p.*, r.id AS receipt_id, r.receipt_number, r.balance_after_payment, r.is_cancelled AS receipt_is_cancelled
  INTO v_existing_pay
  FROM public.student_payments p
  LEFT JOIN public.payment_receipts r ON r.payment_id = p.id
  WHERE p.school_id = v_caller_school_id
    AND p.idempotency_key = pg_catalog.btrim(p_idempotency_key);

  IF v_existing_pay.id IS NOT NULL THEN
    -- Vérification de la stricte concordance opérationnelle de l'ensemble des paramètres
    IF v_existing_pay.invoice_id IS DISTINCT FROM p_invoice_id OR
       v_existing_pay.amount IS DISTINCT FROM p_amount OR
       v_existing_pay.payment_method IS DISTINCT FROM p_payment_method OR
       v_existing_pay.payment_date IS DISTINCT FROM v_actual_pay_date OR
       v_existing_pay.payment_reference IS DISTINCT FROM p_payment_reference OR
       v_existing_pay.payer_name IS DISTINCT FROM p_payer_name OR
       v_existing_pay.internal_note IS DISTINCT FROM p_internal_note THEN
      RAISE EXCEPTION 'REJET IDEMPOTENCE : La clé d’idempotence % a déjà été utilisée avec des paramètres opérationnels différents.', p_idempotency_key
        USING ERRCODE = '23505';
    END IF;

    -- Rejeu transparent et précis (statut cancelled clairement explicité si paiement annulé)
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'is_idempotent_replay', true,
      'payment_id', v_existing_pay.id,
      'payment_number', v_existing_pay.payment_number,
      'receipt_id', v_existing_pay.receipt_id,
      'receipt_number', v_existing_pay.receipt_number,
      'amount', v_existing_pay.amount,
      'currency', v_existing_pay.currency,
      'status', v_existing_pay.status,
      'is_cancelled', (v_existing_pay.status = 'cancelled'),
      'cancelled_at', v_existing_pay.cancelled_at,
      'cancel_reason', v_existing_pay.cancel_reason,
      'balance_after_payment', v_existing_pay.balance_after_payment,
      'invoice_id', v_existing_pay.invoice_id,
      'payment_date', v_existing_pay.payment_date
    );
  END IF;

  -- E. Verrouillage de la Facture sous SELECT FOR UPDATE avec Données Élève & Classe
  SELECT 
    inv.*,
    c.name AS class_name,
    st.student_number AS student_matricule,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name
  INTO v_inv
  FROM public.student_invoices inv
  JOIN public.classes c ON c.id = inv.class_id AND c.school_id = inv.school_id
  JOIN public.students st ON st.id = inv.student_id AND st.school_id = inv.school_id
  WHERE inv.id = p_invoice_id
  FOR UPDATE OF inv;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Facture introuvable.' USING ERRCODE = '22023';
  END IF;

  IF v_inv.school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : Cette facture n’appartient pas à votre établissement.' USING ERRCODE = '42501';
  END IF;

  -- F. Contrôle de la Machine d'État et des Soldes
  IF v_inv.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'REJET : Impossible d’enregistrer un paiement sur une facture au statut % (seuls issued et partially_paid sont autorisés).', v_inv.status
      USING ERRCODE = '22023';
  END IF;

  v_remaining_balance := v_inv.total_amount - v_inv.paid_amount;
  IF p_amount > v_remaining_balance THEN
    RAISE EXCEPTION 'REJET SURPAIEMENT : Le montant du paiement (%) dépasse le solde restant dû (%).', p_amount, v_remaining_balance
      USING ERRCODE = '22023';
  END IF;

  v_new_paid := v_inv.paid_amount + p_amount;
  v_new_balance := v_inv.total_amount - v_new_paid;
  v_new_status := CASE WHEN v_new_paid = v_inv.total_amount THEN 'paid' ELSE 'partially_paid' END;

  -- G. Génération des Compteurs Séquentiels Atomiques (Paiement & Reçu)
  SELECT sequence_number, formatted_number
  INTO v_pay_seq, v_pay_num
  FROM public.get_next_finance_counter(v_caller_school_id, v_inv.academic_year_id, 'payment');

  SELECT sequence_number, formatted_number
  INTO v_rec_seq, v_rec_num
  FROM public.get_next_finance_counter(v_caller_school_id, v_inv.academic_year_id, 'receipt');

  -- H. Insertion du Paiement (Confirmed) avec Gestion Robuste de unique_violation
  BEGIN
    INSERT INTO public.student_payments (
      school_id,
      academic_year_id,
      invoice_id,
      student_id,
      currency,
      payment_number,
      sequence_number,
      idempotency_key,
      amount,
      payment_method,
      payment_date,
      payment_reference,
      payer_name,
      internal_note,
      recorded_by,
      status
    ) VALUES (
      v_caller_school_id,
      v_inv.academic_year_id,
      p_invoice_id,
      v_inv.student_id,
      v_inv.currency,
      v_pay_num,
      v_pay_seq,
      pg_catalog.btrim(p_idempotency_key),
      p_amount,
      p_payment_method,
      v_actual_pay_date,
      p_payment_reference,
      p_payer_name,
      p_internal_note,
      v_caller_id,
      'confirmed'
    )
    RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    -- Relire et valider l'opération concurrente déjà insérée
    SELECT p.*, r.id AS receipt_id, r.receipt_number, r.balance_after_payment, r.is_cancelled AS receipt_is_cancelled
    INTO v_existing_pay
    FROM public.student_payments p
    LEFT JOIN public.payment_receipts r ON r.payment_id = p.id
    WHERE p.school_id = v_caller_school_id
      AND p.idempotency_key = pg_catalog.btrim(p_idempotency_key);

    IF v_existing_pay.id IS NOT NULL THEN
      IF v_existing_pay.invoice_id IS DISTINCT FROM p_invoice_id OR
         v_existing_pay.amount IS DISTINCT FROM p_amount OR
         v_existing_pay.payment_method IS DISTINCT FROM p_payment_method OR
         v_existing_pay.payment_date IS DISTINCT FROM v_actual_pay_date OR
         v_existing_pay.payment_reference IS DISTINCT FROM p_payment_reference OR
         v_existing_pay.payer_name IS DISTINCT FROM p_payer_name OR
         v_existing_pay.internal_note IS DISTINCT FROM p_internal_note THEN
        RAISE EXCEPTION 'REJET IDEMPOTENCE : Conflit de clé d’idempotence avec des paramètres différents.'
          USING ERRCODE = '23505';
      END IF;

      RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'is_idempotent_replay', true,
        'payment_id', v_existing_pay.id,
        'payment_number', v_existing_pay.payment_number,
        'receipt_id', v_existing_pay.receipt_id,
        'receipt_number', v_existing_pay.receipt_number,
        'amount', v_existing_pay.amount,
        'currency', v_existing_pay.currency,
        'status', v_existing_pay.status,
        'is_cancelled', (v_existing_pay.status = 'cancelled'),
        'cancelled_at', v_existing_pay.cancelled_at,
        'cancel_reason', v_existing_pay.cancel_reason,
        'balance_after_payment', v_existing_pay.balance_after_payment,
        'invoice_id', v_existing_pay.invoice_id,
        'payment_date', v_existing_pay.payment_date
      );
    ELSE
      RAISE;
    END IF;
  END;

  -- I. Insertion du Reçu Officiel Immuable
  INSERT INTO public.payment_receipts (
    school_id,
    academic_year_id,
    payment_id,
    invoice_id,
    student_id,
    currency,
    receipt_number,
    sequence_number,
    receipt_date,
    amount,
    payment_method,
    payment_reference,
    payer_name,
    student_matricule,
    student_full_name,
    class_name,
    invoice_number,
    balance_after_payment,
    cashier_name,
    is_cancelled
  ) VALUES (
    v_caller_school_id,
    v_inv.academic_year_id,
    v_payment_id,
    p_invoice_id,
    v_inv.student_id,
    v_inv.currency,
    v_rec_num,
    v_rec_seq,
    v_actual_pay_date,
    p_amount,
    p_payment_method,
    p_payment_reference,
    p_payer_name,
    v_inv.student_matricule,
    CASE 
      WHEN pg_catalog.length(v_inv.student_full_name) > 0 THEN v_inv.student_full_name 
      ELSE 'Élève ' || v_inv.student_matricule 
    END,
    v_inv.class_name,
    v_inv.invoice_number,
    v_new_balance,
    v_cashier_name,
    false
  )
  RETURNING id INTO v_receipt_id;

  -- J. Mise à Jour de la Facture
  UPDATE public.student_invoices
  SET paid_amount = v_new_paid,
      status = v_new_status,
      updated_at = pg_catalog.now()
  WHERE id = p_invoice_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'is_idempotent_replay', false,
    'payment_id', v_payment_id,
    'payment_number', v_pay_num,
    'receipt_id', v_receipt_id,
    'receipt_number', v_rec_num,
    'amount', p_amount,
    'currency', v_inv.currency,
    'payment_method', p_payment_method,
    'invoice_id', p_invoice_id,
    'invoice_status', v_new_status,
    'total_paid', v_new_paid,
    'balance_after_payment', v_new_balance,
    'recorded_at', pg_catalog.now()
  );
END;
$$;

ALTER FUNCTION public.record_student_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) OWNER TO postgres;


--------------------------------------------------------------------------------
-- 5. RPC : ANNULATION ATOMIQUE D'UN PAIEMENT (cancel_student_payment)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_student_payment(
  p_payment_id UUID,
  p_cancel_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  
  v_target_invoice_id UUID;
  v_pay_school_id UUID;
  v_pay_status TEXT;
  
  v_invoice RECORD;
  v_payment RECORD;
  v_receipt RECORD;
  
  v_recalculated_paid NUMERIC(14, 2);
  v_new_invoice_status TEXT;
  v_new_remaining NUMERIC(14, 2);
  v_cancel_time TIMESTAMPTZ := pg_catalog.now();
BEGIN
  -- A. Validation Stricte du Motif
  IF p_cancel_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_cancel_reason)) < 3 OR pg_catalog.length(p_cancel_reason) > 500 THEN
    RAISE EXCEPTION 'REJET : L’annulation d’un paiement exige un motif explicite comportant entre 3 et 500 caractères.'
      USING ERRCODE = '22023';
  END IF;

  -- B. Authentification & Contrôle d'Accès Staff Financier
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
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif peut annuler un paiement.'
      USING ERRCODE = '42501';
  END IF;

  -- C. Pré-vérification d'Existence et d'Établissement
  SELECT invoice_id, school_id, status
  INTO v_target_invoice_id, v_pay_school_id, v_pay_status
  FROM public.student_payments
  WHERE id = p_payment_id;

  IF v_target_invoice_id IS NULL THEN
    RAISE EXCEPTION 'REJET : Paiement introuvable.' USING ERRCODE = '22023';
  END IF;

  IF v_pay_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : Ce paiement n’appartient pas à votre établissement.' USING ERRCODE = '42501';
  END IF;

  IF v_pay_status = 'cancelled' THEN
    RAISE EXCEPTION 'REJET : Ce paiement est déjà annulé (l’opération d’annulation est irréversible).'
      USING ERRCODE = '22023';
  END IF;

  -- D. Verrouillage Déterministe Hiérarchique (Facture -> Paiement -> Reçu)
  -- 1. Verrou Facture
  SELECT *
  INTO v_invoice
  FROM public.student_invoices
  WHERE id = v_target_invoice_id
  FOR UPDATE;

  -- 2. Verrou Paiement
  SELECT *
  INTO v_payment
  FROM public.student_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  -- 3. Verrou Reçu
  SELECT *
  INTO v_receipt
  FROM public.payment_receipts
  WHERE payment_id = p_payment_id
  FOR UPDATE;

  -- E. Revalidations Complètes Après Verrouillage
  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Paiement introuvable.' USING ERRCODE = '22023';
  END IF;

  IF v_payment.status = 'cancelled' THEN
    RAISE EXCEPTION 'REJET : Ce paiement est déjà annulé.' USING ERRCODE = '22023';
  END IF;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Facture associée introuvable.' USING ERRCODE = '22023';
  END IF;

  IF v_receipt.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Le reçu officiel associé à ce paiement est introuvable. Annulation refusée.'
      USING ERRCODE = '22023';
  END IF;

  IF v_receipt.is_cancelled = true THEN
    RAISE EXCEPTION 'REJET : Le reçu associé est déjà marqué comme annulé.' USING ERRCODE = '22023';
  END IF;

  -- F. Annulation du Paiement
  -- Le trigger trg_payment_immutability synchronise automatiquement l'annulation du reçu associé
  UPDATE public.student_payments
  SET status = 'cancelled',
      cancelled_at = v_cancel_time,
      cancelled_by = v_caller_id,
      cancel_reason = pg_catalog.btrim(p_cancel_reason)
  WHERE id = p_payment_id;

  -- G. Recalcul Intégral du Montant Payé depuis les Paiements 'confirmed' Restants
  SELECT COALESCE(SUM(amount), 0.00)
  INTO v_recalculated_paid
  FROM public.student_payments
  WHERE invoice_id = v_target_invoice_id
    AND status = 'confirmed';

  v_new_remaining := v_invoice.total_amount - v_recalculated_paid;

  v_new_invoice_status := CASE
    WHEN v_recalculated_paid = 0.00 THEN 'issued'
    WHEN v_recalculated_paid = v_invoice.total_amount THEN 'paid'
    ELSE 'partially_paid'
  END;

  -- H. Mise à Jour de la Facture
  UPDATE public.student_invoices
  SET paid_amount = v_recalculated_paid,
      status = v_new_invoice_status,
      updated_at = v_cancel_time
  WHERE id = v_target_invoice_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'payment_number', v_payment.payment_number,
    'invoice_id', v_target_invoice_id,
    'invoice_number', v_invoice.invoice_number,
    'cancelled_amount', v_payment.amount,
    'recalculated_paid_amount', v_recalculated_paid,
    'remaining_balance', v_new_remaining,
    'new_invoice_status', v_new_invoice_status,
    'cancelled_at', v_cancel_time,
    'cancelled_by', v_caller_id,
    'cancel_reason', pg_catalog.btrim(p_cancel_reason)
  );
END;
$$;

ALTER FUNCTION public.cancel_student_payment(UUID, TEXT) OWNER TO postgres;


--------------------------------------------------------------------------------
-- 6. RPC : CONSULTATION PARENT SÉCURISÉE MULTIDEVISE (get_parent_student_finances)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_parent_student_finances(
  p_student_id UUID
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
  v_student RECORD;
  v_invoices JSONB;
  v_receipts JSONB;
  v_summary_by_currency JSONB;
BEGIN
  -- A. Authentification & Contrôle de Rôle Parent Actif sur Établissement Actif
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id
  INTO v_caller_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role = 'parent'
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un compte parent actif d’un établissement actif peut consulter ce dossier.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Contrôle de la Relation Parent Validée et Flag can_view_finances
  IF NOT EXISTS (
    SELECT 1
    FROM public.parent_student_links psl
    JOIN public.students st ON st.id = psl.student_id
    WHERE psl.parent_profile_id = v_caller_id
      AND psl.student_id = p_student_id
      AND psl.status = 'approved'
      AND psl.can_view_finances = true
      AND psl.school_id = v_caller_school_id
      AND st.school_id = v_caller_school_id
  ) THEN
    RAISE EXCEPTION 'REJET ACCÈS : La consultation financière pour cet élève n’est pas autorisée sur votre compte parent.'
      USING ERRCODE = '42501';
  END IF;

  -- C. Données Sommaires de l'Élève avec Classe Déterminée via student_enrollments
  SELECT 
    st.id,
    st.student_number,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name,
    c.name AS class_name,
    s.name AS school_name
  INTO v_student
  FROM public.students st
  JOIN public.schools s ON s.id = st.school_id
  LEFT JOIN LATERAL (
    SELECT c2.name
    FROM public.student_enrollments se2
    JOIN public.classes c2 ON c2.id = se2.class_id
    WHERE se2.student_id = st.id
      AND se2.school_id = st.school_id
    ORDER BY (se2.status = 'active') DESC, se2.enrolled_on DESC, se2.created_at DESC
    LIMIT 1
  ) c ON true
  WHERE st.id = p_student_id
    AND st.school_id = v_caller_school_id;

  -- D. Synthèse Multidevise : STRICTEMENT REGROUPÉE PAR DEVISE (JAMAIS D'ADDITION USD + CDF)
  SELECT COALESCE(
    pg_catalog.jsonb_object_agg(
      s.currency,
      pg_catalog.jsonb_build_object(
        'currency', s.currency,
        'total_invoiced', s.total_invoiced,
        'total_paid', s.total_paid,
        'total_remaining', s.total_remaining
      )
    ),
    '{}'::jsonb
  )
  INTO v_summary_by_currency
  FROM (
    SELECT 
      inv.currency,
      COALESCE(SUM(inv.total_amount), 0.00) AS total_invoiced,
      COALESCE(SUM(inv.paid_amount), 0.00) AS total_paid,
      COALESCE(SUM(inv.remaining_balance), 0.00) AS total_remaining
    FROM public.student_invoices inv
    WHERE inv.student_id = p_student_id
      AND inv.school_id = v_caller_school_id
      AND inv.status IN ('issued', 'partially_paid', 'paid')
    GROUP BY inv.currency
  ) s;

  -- E. Liste des Factures et leurs Lignes (Strictement sans internal_note)
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', inv.id,
      'invoice_number', inv.invoice_number,
      'issue_date', inv.issue_date,
      'due_date', inv.due_date,
      'currency', inv.currency,
      'total_amount', inv.total_amount,
      'paid_amount', inv.paid_amount,
      'remaining_balance', inv.remaining_balance,
      'status', inv.status,
      'items', (
        SELECT COALESCE(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'fee_name', itm.fee_name,
            'fee_type', itm.fee_type,
            'unit_price', itm.unit_price,
            'quantity', itm.quantity,
            'total_price', itm.total_price
          ) ORDER BY itm.created_at
        ), '[]'::jsonb)
        FROM public.student_invoice_items itm
        WHERE itm.invoice_id = inv.id
      )
    ) ORDER BY inv.issue_date DESC, inv.sequence_number DESC
  ), '[]'::jsonb)
  INTO v_invoices
  FROM public.student_invoices inv
  WHERE inv.student_id = p_student_id
    AND inv.school_id = v_caller_school_id
    AND inv.status IN ('issued', 'partially_paid', 'paid');

  -- F. Reçus Officiels du Parent (Strictement sans internal_note ni données de caisse interne)
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'receipt_number', rec.receipt_number,
      'receipt_date', rec.receipt_date,
      'amount', rec.amount,
      'currency', rec.currency,
      'payment_method', rec.payment_method,
      'payment_reference', rec.payment_reference,
      'payer_name', rec.payer_name,
      'invoice_number', rec.invoice_number,
      'balance_after_payment', rec.balance_after_payment,
      'is_cancelled', rec.is_cancelled,
      'cancelled_at', rec.cancelled_at,
      'cancel_reason', rec.cancel_reason
    ) ORDER BY rec.receipt_date DESC, rec.sequence_number DESC
  ), '[]'::jsonb)
  INTO v_receipts
  FROM public.payment_receipts rec
  WHERE rec.student_id = p_student_id
    AND rec.school_id = v_caller_school_id;

  RETURN pg_catalog.jsonb_build_object(
    'student', pg_catalog.jsonb_build_object(
      'id', v_student.id,
      'student_number', v_student.student_number,
      'student_full_name', v_student.student_full_name,
      'class_name', v_student.class_name,
      'school_name', v_student.school_name
    ),
    'summary_by_currency', v_summary_by_currency,
    'summary', v_summary_by_currency,
    'invoices', v_invoices,
    'receipts', v_receipts
  );
END;
$$;

ALTER FUNCTION public.get_parent_student_finances(UUID) OWNER TO postgres;


--------------------------------------------------------------------------------
-- 7. RPC : CONSULTATION ENSEIGNANT SYNTHÉTIQUE MULTIDEVISE (get_teacher_class_finance_overview)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_teacher_class_finance_overview(
  p_class_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_teacher_school_id UUID;
  
  v_allow_view BOOLEAN := false;
  v_allow_amounts BOOLEAN := false;
  
  v_class_name TEXT;
  v_class_academic_year_id UUID;
  v_students_data JSONB;
BEGIN
  -- A. Authentification & Rôle Enseignant
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id
  INTO v_teacher_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role = 'teacher'
    AND p.is_active = true
    AND s.status = 'active';

  IF v_teacher_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un enseignant actif d’un établissement actif peut exécuter cette consultation.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Récupération de la Classe et de l'Année Scolaire Associée
  SELECT c.name, c.academic_year_id
  INTO v_class_name, v_class_academic_year_id
  FROM public.classes c
  WHERE c.id = p_class_id AND c.school_id = v_teacher_school_id;

  IF v_class_name IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Classe introuvable ou n’appartenant pas à votre établissement.'
      USING ERRCODE = '42501';
  END IF;

  -- C. Vérification de l'Affectation de l'Enseignant à la Classe
  IF NOT (
    public.is_teacher_of_class(p_class_id)
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = p_class_id
        AND c.school_id = v_teacher_school_id
        AND c.homeroom_teacher_id = v_caller_id
    )
  ) THEN
    RAISE EXCEPTION 'REJET ACCÈS : Vous n’êtes pas affecté à cette classe.' USING ERRCODE = '42501';
  END IF;

  -- D. Contrôle des Drapeaux de Paramétrage Financier de l'Établissement
  SELECT allow_teacher_finance_view, allow_teacher_finance_amounts
  INTO v_allow_view, v_allow_amounts
  FROM public.schools
  WHERE id = v_teacher_school_id;

  IF NOT v_allow_view THEN
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'La consultation financière par les enseignants est désactivée par la direction de l’établissement.',
      'students', '[]'::jsonb
    );
  END IF;

  -- E. Construction des Données Synthétiques par Élève Inscrit (Limité strictement à school_id, class_id et academic_year_id)
  IF NOT v_allow_amounts THEN
    -- MODE 1 : Statut Synthétique Purement Qualitatif (Sans Montants, Sans Devises, Sans Reçus)
    SELECT COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'student_id', st.id,
        'student_number', st.student_number,
        'first_name', COALESCE(st.first_name, ''),
        'last_name', COALESCE(st.last_name, ''),
        'financial_status', (
          CASE 
            WHEN fin.invoice_count = 0 OR fin.invoice_count IS NULL THEN 'no_invoice'
            WHEN fin.unpaid_count = 0 THEN 'up_to_date'
            WHEN fin.has_partial > 0 OR fin.paid_count > 0 THEN 'partial'
            ELSE 'unpaid'
          END
        )
      ) ORDER BY st.last_name, st.first_name
    ), '[]'::jsonb)
    INTO v_students_data
    FROM public.student_enrollments se
    JOIN public.students st ON st.id = se.student_id AND st.school_id = se.school_id
    LEFT JOIN LATERAL (
      SELECT 
        COUNT(*) AS invoice_count,
        COUNT(*) FILTER (WHERE inv.status = 'paid') AS paid_count,
        COUNT(*) FILTER (WHERE inv.status = 'partially_paid') AS has_partial,
        COUNT(*) FILTER (WHERE inv.status IN ('issued', 'partially_paid')) AS unpaid_count
      FROM public.student_invoices inv
      WHERE inv.student_id = st.id
        AND inv.school_id = v_teacher_school_id
        AND inv.class_id = p_class_id
        AND inv.academic_year_id = v_class_academic_year_id
        AND inv.status IN ('issued', 'partially_paid', 'paid')
    ) fin ON true
    WHERE se.class_id = p_class_id
      AND se.academic_year_id = v_class_academic_year_id
      AND se.school_id = v_teacher_school_id
      AND se.status = 'active';

  ELSE
    -- MODE 2 : Statut Synthétique avec Ventilation Multidevise (Jamais de somme interdevises)
    SELECT COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'student_id', st.id,
        'student_number', st.student_number,
        'first_name', COALESCE(st.first_name, ''),
        'last_name', COALESCE(st.last_name, ''),
        'financial_status', (
          CASE 
            WHEN fin.invoice_count = 0 OR fin.invoice_count IS NULL THEN 'no_invoice'
            WHEN fin.unpaid_count = 0 THEN 'up_to_date'
            WHEN fin.has_partial > 0 OR fin.paid_count > 0 THEN 'partial'
            ELSE 'unpaid'
          END
        ),
        'currencies', COALESCE(fin_cur.currencies_breakdown, '[]'::jsonb)
      ) ORDER BY st.last_name, st.first_name
    ), '[]'::jsonb)
    INTO v_students_data
    FROM public.student_enrollments se
    JOIN public.students st ON st.id = se.student_id AND st.school_id = se.school_id
    LEFT JOIN LATERAL (
      SELECT 
        COUNT(*) AS invoice_count,
        COUNT(*) FILTER (WHERE inv.status = 'paid') AS paid_count,
        COUNT(*) FILTER (WHERE inv.status = 'partially_paid') AS has_partial,
        COUNT(*) FILTER (WHERE inv.status IN ('issued', 'partially_paid')) AS unpaid_count
      FROM public.student_invoices inv
      WHERE inv.student_id = st.id
        AND inv.school_id = v_teacher_school_id
        AND inv.class_id = p_class_id
        AND inv.academic_year_id = v_class_academic_year_id
        AND inv.status IN ('issued', 'partially_paid', 'paid')
    ) fin ON true
    LEFT JOIN LATERAL (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'currency', cur_inv.currency,
          'total_invoiced', cur_inv.total_inv,
          'total_paid', cur_inv.total_paid,
          'remaining_balance', cur_inv.total_rem
        )
      ) AS currencies_breakdown
      FROM (
        SELECT 
          inv2.currency,
          COALESCE(SUM(inv2.total_amount), 0.00) AS total_inv,
          COALESCE(SUM(inv2.paid_amount), 0.00) AS total_paid,
          COALESCE(SUM(inv2.remaining_balance), 0.00) AS total_rem
        FROM public.student_invoices inv2
        WHERE inv2.student_id = st.id
          AND inv2.school_id = v_teacher_school_id
          AND inv2.class_id = p_class_id
          AND inv2.academic_year_id = v_class_academic_year_id
          AND inv2.status IN ('issued', 'partially_paid', 'paid')
        GROUP BY inv2.currency
      ) cur_inv
    ) fin_cur ON true
    WHERE se.class_id = p_class_id
      AND se.academic_year_id = v_class_academic_year_id
      AND se.school_id = v_teacher_school_id
      AND se.status = 'active';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', true,
    'class_id', p_class_id,
    'class_name', v_class_name,
    'academic_year_id', v_class_academic_year_id,
    'amounts_included', v_allow_amounts,
    'students', v_students_data
  );
END;
$$;

ALTER FUNCTION public.get_teacher_class_finance_overview(UUID) OWNER TO postgres;


--------------------------------------------------------------------------------
-- 8. RPC ADMINISTRATIVE : DOSSIER FINANCIER COMPLET ÉLÈVE MULTIDEVISE (Staff Financier)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_student_finance_dossier_admin(
  p_student_id UUID,
  p_academic_year_id UUID DEFAULT NULL
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
  
  v_student RECORD;
  v_summary_by_currency JSONB;
  v_invoices JSONB;
  v_payments JSONB;
  v_receipts JSONB;
BEGIN
  -- A. Authentification & Contrôle d'Accès Staff Financier
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
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif peut consulter le dossier financier complet.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Vérification de l'Élève et Classe Déterminée via student_enrollments
  SELECT 
    st.id,
    st.student_number,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_full_name,
    c.name AS class_name
  INTO v_student
  FROM public.students st
  LEFT JOIN LATERAL (
    SELECT c2.name
    FROM public.student_enrollments se2
    JOIN public.classes c2 ON c2.id = se2.class_id
    WHERE se2.student_id = st.id
      AND se2.school_id = st.school_id
      AND (p_academic_year_id IS NULL OR se2.academic_year_id = p_academic_year_id)
    ORDER BY (se2.status = 'active') DESC, se2.enrolled_on DESC, se2.created_at DESC
    LIMIT 1
  ) c ON true
  WHERE st.id = p_student_id
    AND st.school_id = v_caller_school_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Élève introuvable ou n’appartenant pas à votre établissement.'
      USING ERRCODE = '22023';
  END IF;

  -- C. Synthèse Multidevise : STRICTEMENT REGROUPÉE PAR DEVISE (JAMAIS D'ADDITION USD + CDF)
  SELECT COALESCE(
    pg_catalog.jsonb_object_agg(
      s.currency,
      pg_catalog.jsonb_build_object(
        'currency', s.currency,
        'total_invoiced', s.total_invoiced,
        'total_paid', s.total_paid,
        'total_remaining', s.total_remaining
      )
    ),
    '{}'::jsonb
  )
  INTO v_summary_by_currency
  FROM (
    SELECT 
      inv.currency,
      COALESCE(SUM(inv.total_amount), 0.00) AS total_invoiced,
      COALESCE(SUM(inv.paid_amount), 0.00) AS total_paid,
      COALESCE(SUM(inv.remaining_balance), 0.00) AS total_remaining
    FROM public.student_invoices inv
    WHERE inv.student_id = p_student_id
      AND inv.school_id = v_caller_school_id
      AND (p_academic_year_id IS NULL OR inv.academic_year_id = p_academic_year_id)
      AND inv.status IN ('issued', 'partially_paid', 'paid')
    GROUP BY inv.currency
  ) s;

  -- D. Factures & Lignes
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', inv.id,
      'invoice_number', inv.invoice_number,
      'sequence_number', inv.sequence_number,
      'issue_date', inv.issue_date,
      'due_date', inv.due_date,
      'currency', inv.currency,
      'total_amount', inv.total_amount,
      'paid_amount', inv.paid_amount,
      'remaining_balance', inv.remaining_balance,
      'status', inv.status,
      'created_at', inv.created_at,
      'items', (
        SELECT COALESCE(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', itm.id,
            'fee_name', itm.fee_name,
            'fee_type', itm.fee_type,
            'unit_price', itm.unit_price,
            'quantity', itm.quantity,
            'total_price', itm.total_price
          ) ORDER BY itm.created_at
        ), '[]'::jsonb)
        FROM public.student_invoice_items itm
        WHERE itm.invoice_id = inv.id
      )
    ) ORDER BY inv.issue_date DESC, inv.sequence_number DESC
  ), '[]'::jsonb)
  INTO v_invoices
  FROM public.student_invoices inv
  WHERE inv.student_id = p_student_id
    AND inv.school_id = v_caller_school_id
    AND (p_academic_year_id IS NULL OR inv.academic_year_id = p_academic_year_id);

  -- E. Règlements Détaillés (Staff Financier Autorisé avec Métadonnées et Notes)
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', pay.id,
      'payment_number', pay.payment_number,
      'sequence_number', pay.sequence_number,
      'payment_date', pay.payment_date,
      'amount', pay.amount,
      'currency', pay.currency,
      'payment_method', pay.payment_method,
      'payment_reference', pay.payment_reference,
      'payer_name', pay.payer_name,
      'internal_note', pay.internal_note,
      'status', pay.status,
      'cancelled_at', pay.cancelled_at,
      'cancelled_by', pay.cancelled_by,
      'cancel_reason', pay.cancel_reason,
      'created_at', pay.created_at
    ) ORDER BY pay.payment_date DESC, pay.sequence_number DESC
  ), '[]'::jsonb)
  INTO v_payments
  FROM public.student_payments pay
  WHERE pay.student_id = p_student_id
    AND pay.school_id = v_caller_school_id
    AND (p_academic_year_id IS NULL OR pay.academic_year_id = p_academic_year_id);

  -- F. Reçus
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', rec.id,
      'receipt_number', rec.receipt_number,
      'sequence_number', rec.sequence_number,
      'receipt_date', rec.receipt_date,
      'amount', rec.amount,
      'currency', rec.currency,
      'payment_method', rec.payment_method,
      'payment_reference', rec.payment_reference,
      'payer_name', rec.payer_name,
      'student_matricule', rec.student_matricule,
      'student_full_name', rec.student_full_name,
      'class_name', rec.class_name,
      'invoice_number', rec.invoice_number,
      'balance_after_payment', rec.balance_after_payment,
      'cashier_name', rec.cashier_name,
      'is_cancelled', rec.is_cancelled,
      'cancelled_at', rec.cancelled_at,
      'cancel_reason', rec.cancel_reason
    ) ORDER BY rec.receipt_date DESC, rec.sequence_number DESC
  ), '[]'::jsonb)
  INTO v_receipts
  FROM public.payment_receipts rec
  WHERE rec.student_id = p_student_id
    AND rec.school_id = v_caller_school_id
    AND (p_academic_year_id IS NULL OR rec.academic_year_id = p_academic_year_id);

  RETURN pg_catalog.jsonb_build_object(
    'student', pg_catalog.jsonb_build_object(
      'id', v_student.id,
      'student_number', v_student.student_number,
      'student_full_name', v_student.student_full_name,
      'class_name', v_student.class_name
    ),
    'summary_by_currency', v_summary_by_currency,
    'summary', v_summary_by_currency,
    'invoices', v_invoices,
    'payments', v_payments,
    'receipts', v_receipts
  );
END;
$$;

ALTER FUNCTION public.get_student_finance_dossier_admin(UUID, UUID) OWNER TO postgres;


--------------------------------------------------------------------------------
-- 9. GESTION DES PRIVILÈGES (Sécurité par Défaut, Pas d'accès Anon/Public)
--------------------------------------------------------------------------------

-- 1. Compteur interne (Réservé exclusivement aux fonctions internes postgres)
REVOKE ALL ON FUNCTION public.get_next_finance_counter(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_next_finance_counter(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_next_finance_counter(UUID, UUID, TEXT) FROM authenticated;

-- 2. Création de facture
REVOKE ALL ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE) TO authenticated;

-- 3. Émission de facture
REVOKE ALL ON FUNCTION public.issue_student_invoice(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_student_invoice(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_student_invoice(UUID) TO authenticated;

-- 4. Règlement de facture
REVOKE ALL ON FUNCTION public.record_student_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_student_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_student_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) TO authenticated;

-- 5. Annulation de règlement
REVOKE ALL ON FUNCTION public.cancel_student_payment(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_student_payment(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_student_payment(UUID, TEXT) TO authenticated;

-- 6. Consultation parent
REVOKE ALL ON FUNCTION public.get_parent_student_finances(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_parent_student_finances(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_finances(UUID) TO authenticated;

-- 7. Consultation enseignant
REVOKE ALL ON FUNCTION public.get_teacher_class_finance_overview(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_teacher_class_finance_overview(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_class_finance_overview(UUID) TO authenticated;

-- 8. Dossier financier administratif
REVOKE ALL ON FUNCTION public.get_student_finance_dossier_admin(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_finance_dossier_admin(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_finance_dossier_admin(UUID, UUID) TO authenticated;

COMMIT;
