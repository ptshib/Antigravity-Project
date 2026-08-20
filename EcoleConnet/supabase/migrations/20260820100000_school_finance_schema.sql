-- ============================================================================
-- Migration : Schéma de Données, Sécurité et Contrôle d'Accès Finance 1
-- Fichier   : supabase/migrations/20260820100000_school_finance_schema.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION SÉCURISÉE DU MODÈLE DE RÔLES AVEC finance_agent
--------------------------------------------------------------------------------

-- Remplacement déterministe de la contrainte inline initiale profiles_role_check
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check,
  ADD CONSTRAINT profiles_role_check 
  CHECK (role IN ('super_admin', 'school_admin', 'teacher', 'parent', 'student', 'finance_agent'));


--------------------------------------------------------------------------------
-- 2. PARAMÈTRES FINANCIERS DE L'ÉTABLISSEMENT SUR PUBLIC.SCHOOLS
--------------------------------------------------------------------------------

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS allow_teacher_finance_view BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_teacher_finance_amounts BOOLEAN NOT NULL DEFAULT false;


--------------------------------------------------------------------------------
-- 3. CLÉS UNIQUES COMPOSITES SUR LES TABLES DE BASE (Intégrité Multi-Tenant)
--------------------------------------------------------------------------------

ALTER TABLE public.academic_years
  DROP CONSTRAINT IF EXISTS uq_academic_years_school,
  ADD CONSTRAINT uq_academic_years_school UNIQUE (id, school_id);

ALTER TABLE public.classes
  DROP CONSTRAINT IF EXISTS uq_classes_school_year,
  ADD CONSTRAINT uq_classes_school_year UNIQUE (id, school_id, academic_year_id);

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS uq_students_school,
  ADD CONSTRAINT uq_students_school UNIQUE (id, school_id);

ALTER TABLE public.student_enrollments
  DROP CONSTRAINT IF EXISTS uq_student_enrollments_composite,
  ADD CONSTRAINT uq_student_enrollments_composite UNIQUE (id, school_id, academic_year_id, student_id, class_id);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS uq_profiles_school,
  ADD CONSTRAINT uq_profiles_school UNIQUE (id, school_id);


--------------------------------------------------------------------------------
-- 4. FONCTIONS HELPER D'AUTORISATION FINANCIÈRE (SECURITY DEFINER DURCIES)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_finance_agent(target_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.schools s ON s.id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role = 'finance_agent'
      AND p.school_id = target_school_id
      AND p.is_active = true
      AND s.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_finance_staff(target_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.schools s ON s.id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role IN ('school_admin', 'finance_agent')
      AND p.school_id = target_school_id
      AND p.is_active = true
      AND s.status = 'active'
  );
$$;

ALTER FUNCTION public.is_finance_agent(UUID) OWNER TO postgres;
ALTER FUNCTION public.is_finance_staff(UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_finance_agent(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_finance_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_finance_agent(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_finance_staff(UUID) TO authenticated;


--------------------------------------------------------------------------------
-- 5. COMPTEURS SÉQUENTIELS ATOMIQUES (Factures, Règlements, Reçus)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_finance_counters (
  school_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  counter_type TEXT NOT NULL CHECK (counter_type IN ('invoice', 'payment', 'receipt')),
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, academic_year_id, counter_type),
  CONSTRAINT fk_finance_counters_school FOREIGN KEY (school_id)
    REFERENCES public.schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_finance_counters_academic_year FOREIGN KEY (academic_year_id, school_id)
    REFERENCES public.academic_years(id, school_id) ON DELETE RESTRICT
);


--------------------------------------------------------------------------------
-- 6. CATALOGUE DES FRAIS SCOLAIRES (public.school_fees)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  class_id UUID,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('inscription', 'minerval', 'transport', 'cantine', 'uniforme', 'activites', 'frais_etat', 'autre')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 150),
  description TEXT,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'CDF')),
  due_date DATE NOT NULL,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_school_fees_school FOREIGN KEY (school_id)
    REFERENCES public.schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_school_fees_academic_year FOREIGN KEY (academic_year_id, school_id)
    REFERENCES public.academic_years(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT fk_school_fees_class FOREIGN KEY (class_id, school_id, academic_year_id)
    REFERENCES public.classes(id, school_id, academic_year_id) ON DELETE RESTRICT,
  CONSTRAINT fk_school_fees_creator FOREIGN KEY (created_by, school_id)
    REFERENCES public.profiles(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT uq_school_fees_composite UNIQUE (id, school_id, academic_year_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_school_fees_school_year ON public.school_fees(school_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_school_fees_class ON public.school_fees(class_id);
CREATE INDEX IF NOT EXISTS idx_school_fees_active ON public.school_fees(school_id, is_active);


--------------------------------------------------------------------------------
-- 7. FACTURES ÉLÈVES (public.student_invoices & public.student_invoice_items)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.student_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  student_id UUID NOT NULL,
  enrollment_id UUID NOT NULL,
  class_id UUID NOT NULL,
  invoice_number TEXT NOT NULL CHECK (length(trim(invoice_number)) > 0 AND length(invoice_number) <= 50),
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'CDF')),
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0 AND paid_amount <= total_amount),
  remaining_balance NUMERIC(14, 2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'voided')),
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  void_reason TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_invoice_dates CHECK (due_date >= issue_date),
  CONSTRAINT chk_invoice_void_state CHECK (
    (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(trim(COALESCE(void_reason, ''))) > 0 AND paid_amount = 0) OR
    (status <> 'voided' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
  ),
  CONSTRAINT chk_invoice_status_paid_coherence CHECK (
    (status = 'paid' AND paid_amount = total_amount AND total_amount > 0) OR
    (status = 'partially_paid' AND paid_amount > 0 AND paid_amount < total_amount) OR
    (status = 'issued' AND paid_amount = 0) OR
    (status = 'draft' AND paid_amount = 0) OR
    (status = 'voided' AND paid_amount = 0)
  ),
  CONSTRAINT fk_student_invoices_school FOREIGN KEY (school_id)
    REFERENCES public.schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_invoices_academic_year FOREIGN KEY (academic_year_id, school_id)
    REFERENCES public.academic_years(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_invoices_student FOREIGN KEY (student_id, school_id)
    REFERENCES public.students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_invoices_enrollment FOREIGN KEY (enrollment_id, school_id, academic_year_id, student_id, class_id)
    REFERENCES public.student_enrollments(id, school_id, academic_year_id, student_id, class_id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_invoices_creator FOREIGN KEY (created_by, school_id)
    REFERENCES public.profiles(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_invoices_voided_by FOREIGN KEY (voided_by, school_id)
    REFERENCES public.profiles(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT uq_student_invoice_school_num UNIQUE (school_id, invoice_number),
  CONSTRAINT uq_student_invoice_school_seq UNIQUE (school_id, academic_year_id, sequence_number),
  CONSTRAINT uq_student_invoices_composite UNIQUE (id, school_id, academic_year_id, student_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_student_invoices_school_year ON public.student_invoices(school_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_student_invoices_student ON public.student_invoices(student_id);
CREATE INDEX IF NOT EXISTS idx_student_invoices_enrollment ON public.student_invoices(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_student_invoices_class ON public.student_invoices(class_id);
CREATE INDEX IF NOT EXISTS idx_student_invoices_status ON public.student_invoices(school_id, status);
CREATE INDEX IF NOT EXISTS idx_student_invoices_due ON public.student_invoices(school_id, due_date);

CREATE TABLE IF NOT EXISTS public.student_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL,
  school_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  student_id UUID NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'CDF')),
  fee_id UUID,
  fee_name TEXT NOT NULL CHECK (length(trim(fee_name)) > 0 AND length(fee_name) <= 150),
  fee_type TEXT NOT NULL,
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_price NUMERIC(14, 2) NOT NULL CHECK (total_price > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_invoice_item_total CHECK (total_price = (unit_price * quantity)),
  CONSTRAINT uq_invoice_fee_item UNIQUE (invoice_id, fee_id),
  CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id, school_id, academic_year_id, student_id, currency)
    REFERENCES public.student_invoices(id, school_id, academic_year_id, student_id, currency) ON DELETE CASCADE,
  CONSTRAINT fk_invoice_items_fee FOREIGN KEY (fee_id, school_id, academic_year_id, currency)
    REFERENCES public.school_fees(id, school_id, academic_year_id, currency) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.student_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_fee ON public.student_invoice_items(fee_id);


--------------------------------------------------------------------------------
-- 8. PAIEMENTS ÉLÈVES (public.student_payments)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.student_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  student_id UUID NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'CDF')),
  payment_number TEXT NOT NULL CHECK (length(trim(payment_number)) > 0 AND length(payment_number) <= 50),
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  idempotency_key TEXT CHECK (idempotency_key IS NULL OR (length(trim(idempotency_key)) > 0 AND length(idempotency_key) <= 100)),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'bank_deposit', 'check', 'mobile_money_manual', 'other')),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_reference TEXT,
  payer_name TEXT,
  internal_note TEXT,
  recorded_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_payment_cancel_state CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND length(trim(COALESCE(cancel_reason, ''))) > 0) OR
    (status = 'confirmed' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
  ),
  CONSTRAINT fk_student_payments_invoice_composite FOREIGN KEY (invoice_id, school_id, academic_year_id, student_id, currency)
    REFERENCES public.student_invoices(id, school_id, academic_year_id, student_id, currency) ON DELETE RESTRICT,
  CONSTRAINT fk_student_payments_recorded_by FOREIGN KEY (recorded_by, school_id)
    REFERENCES public.profiles(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_payments_cancelled_by FOREIGN KEY (cancelled_by, school_id)
    REFERENCES public.profiles(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT uq_student_payments_num UNIQUE (school_id, payment_number),
  CONSTRAINT uq_student_payments_seq UNIQUE (school_id, academic_year_id, sequence_number),
  CONSTRAINT uq_student_payments_idemp UNIQUE (school_id, idempotency_key),
  CONSTRAINT uq_student_payments_composite UNIQUE (id, invoice_id, school_id, academic_year_id, student_id, currency),
  CONSTRAINT uq_student_payments_snapshot UNIQUE (id, invoice_id, school_id, academic_year_id, student_id, currency, amount, payment_method)
);

CREATE INDEX IF NOT EXISTS idx_student_payments_school_year ON public.student_payments(school_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_student_payments_invoice ON public.student_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_student_payments_student ON public.student_payments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_payments_date ON public.student_payments(school_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_student_payments_recorded_by ON public.student_payments(recorded_by);


--------------------------------------------------------------------------------
-- 9. REÇUS IMMUABLES (public.payment_receipts)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  payment_id UUID NOT NULL UNIQUE,
  invoice_id UUID NOT NULL,
  student_id UUID NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'CDF')),
  receipt_number TEXT NOT NULL CHECK (length(trim(receipt_number)) > 0 AND length(receipt_number) <= 50),
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  receipt_date DATE NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'bank_deposit', 'check', 'mobile_money_manual', 'other')),
  payment_reference TEXT,
  payer_name TEXT,
  student_matricule TEXT NOT NULL CHECK (length(trim(student_matricule)) > 0),
  student_full_name TEXT NOT NULL CHECK (length(trim(student_full_name)) > 0),
  class_name TEXT NOT NULL CHECK (length(trim(class_name)) > 0),
  invoice_number TEXT NOT NULL CHECK (length(trim(invoice_number)) > 0),
  balance_after_payment NUMERIC(14, 2) NOT NULL CHECK (balance_after_payment >= 0),
  cashier_name TEXT NOT NULL CHECK (length(trim(cashier_name)) > 0),
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_receipt_cancel_state CHECK (
    (is_cancelled = true AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND length(trim(COALESCE(cancel_reason, ''))) > 0) OR
    (is_cancelled = false AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
  ),
  CONSTRAINT fk_payment_receipts_payment_snapshot FOREIGN KEY (payment_id, invoice_id, school_id, academic_year_id, student_id, currency, amount, payment_method)
    REFERENCES public.student_payments(id, invoice_id, school_id, academic_year_id, student_id, currency, amount, payment_method) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_receipts_cancelled_by FOREIGN KEY (cancelled_by, school_id)
    REFERENCES public.profiles(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT uq_payment_receipts_num UNIQUE (school_id, receipt_number),
  CONSTRAINT uq_payment_receipts_seq UNIQUE (school_id, academic_year_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_school_year ON public.payment_receipts(school_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_student ON public.payment_receipts(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_invoice ON public.payment_receipts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_num ON public.payment_receipts(receipt_number);


--------------------------------------------------------------------------------
-- 10. TRIGGERS D'IMMUABILITÉ & CONTRÔLE DES MUTATIONS
--------------------------------------------------------------------------------

-- Trigger d'immuabilité et de verrouillage sous FOR UPDATE des lignes de facture non-draft
CREATE OR REPLACE FUNCTION public.trg_lock_invoice_items_on_issued()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_old_status
    FROM public.student_invoices
    WHERE id = OLD.invoice_id
    FOR UPDATE;

    IF v_old_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'REJET : Les lignes d’une facture émise, réglée ou annulée (statut source: %) sont strictement verrouillées.', v_old_status;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_new_status
    FROM public.student_invoices
    WHERE id = NEW.invoice_id
    FOR UPDATE;

    IF v_new_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'REJET : Impossible d’ajouter ou d’affecter une ligne à une facture non-brouillon (statut cible: %).', v_new_status;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

ALTER FUNCTION public.trg_lock_invoice_items_on_issued() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_invoice_items_lock ON public.student_invoice_items;
CREATE TRIGGER trg_invoice_items_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.student_invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_lock_invoice_items_on_issued();

-- Trigger d'immuabilité, contrôle de transition et cohérence comptable des factures
CREATE OR REPLACE FUNCTION public.trg_enforce_invoice_immutability_and_state_machine()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Verrouillage structurel absolu dès que la facture quitte le statut draft
  IF OLD.status <> 'draft' THEN
    IF (
      OLD.id IS DISTINCT FROM NEW.id OR
      OLD.school_id IS DISTINCT FROM NEW.school_id OR
      OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id OR
      OLD.student_id IS DISTINCT FROM NEW.student_id OR
      OLD.enrollment_id IS DISTINCT FROM NEW.enrollment_id OR
      OLD.class_id IS DISTINCT FROM NEW.class_id OR
      OLD.invoice_number IS DISTINCT FROM NEW.invoice_number OR
      OLD.sequence_number IS DISTINCT FROM NEW.sequence_number OR
      OLD.currency IS DISTINCT FROM NEW.currency OR
      OLD.issue_date IS DISTINCT FROM NEW.issue_date OR
      OLD.due_date IS DISTINCT FROM NEW.due_date OR
      OLD.total_amount IS DISTINCT FROM NEW.total_amount OR
      OLD.created_by IS DISTINCT FROM NEW.created_by OR
      OLD.created_at IS DISTINCT FROM NEW.created_at
    ) THEN
      RAISE EXCEPTION 'REJET : Les attributs contractuels et financiers d’une facture émise sont strictement immuables.';
    END IF;
  END IF;

  -- 2. Validation stricte de la transition draft -> issued (Exige au moins 1 ligne et cohérence totale)
  IF OLD.status = 'draft' AND NEW.status = 'issued' THEN
    DECLARE
      v_item_count INTEGER;
      v_sum_items NUMERIC(14, 2);
    BEGIN
      SELECT COUNT(*), COALESCE(SUM(total_price), 0.00)
      INTO v_item_count, v_sum_items
      FROM public.student_invoice_items
      WHERE invoice_id = NEW.id;

      IF v_item_count < 1 THEN
        RAISE EXCEPTION 'REJET COMPTABLE : Une facture ne peut être émise sans aucune ligne de frais (nombre de lignes: 0).';
      END IF;

      IF v_sum_items <= 0.00 THEN
        RAISE EXCEPTION 'REJET COMPTABLE : Le montant total d’une facture émise doit être strictement positif (somme calculée: %).', v_sum_items;
      END IF;

      IF NEW.total_amount IS DISTINCT FROM v_sum_items THEN
        RAISE EXCEPTION 'REJET COMPTABLE : Discordance entre le total de la facture (%) et la somme de ses lignes (%).', NEW.total_amount, v_sum_items;
      END IF;
    END;
  END IF;

  -- 3. Machine d'état stricte des factures
  IF OLD.status = 'voided' AND NEW.status IS DISTINCT FROM 'voided' THEN
    RAISE EXCEPTION 'REJET MACHINE D’ÉTAT : Une facture annulée (voided) ne peut plus être réactivée.';
  END IF;

  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'issued', 'voided') THEN
    RAISE EXCEPTION 'REJET MACHINE D’ÉTAT : Une facture en brouillon ne peut transiter que vers issued ou voided.';
  END IF;

  IF OLD.status = 'issued' AND NEW.status NOT IN ('issued', 'partially_paid', 'paid', 'voided') THEN
    RAISE EXCEPTION 'REJET MACHINE D’ÉTAT : Transition de statut invalide depuis issued.';
  END IF;

  IF OLD.status = 'partially_paid' AND NEW.status NOT IN ('partially_paid', 'paid', 'issued') THEN
    RAISE EXCEPTION 'REJET MACHINE D’ÉTAT : Transition de statut invalide depuis partially_paid.';
  END IF;

  IF OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'partially_paid', 'issued') THEN
    RAISE EXCEPTION 'REJET MACHINE D’ÉTAT : Transition de statut invalide depuis paid.';
  END IF;

  -- 4. Interdiction d'annuler une facture ayant un historique de paiement non soldé à zéro
  IF NEW.status = 'voided' AND NEW.paid_amount > 0 THEN
    RAISE EXCEPTION 'REJET : Impossible d’annuler une facture dont le montant payé est supérieur à 0 (paid_amount: %).', NEW.paid_amount;
  END IF;

  -- 5. Métadonnées d'annulation figées
  IF OLD.status = 'voided' AND NEW.status = 'voided' THEN
    IF (
      OLD.voided_at IS DISTINCT FROM NEW.voided_at OR
      OLD.voided_by IS DISTINCT FROM NEW.voided_by OR
      OLD.void_reason IS DISTINCT FROM NEW.void_reason
    ) THEN
      RAISE EXCEPTION 'REJET : Les métadonnées d’annulation d’une facture sont figées.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trg_enforce_invoice_immutability_and_state_machine() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_invoice_immutability_and_state ON public.student_invoices;
CREATE TRIGGER trg_invoice_immutability_and_state
  BEFORE UPDATE ON public.student_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_invoice_immutability_and_state_machine();

CREATE OR REPLACE FUNCTION public.trg_prevent_issued_invoice_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'REJET : La suppression physique d’une facture émise, réglée ou annulée (statut: %) est strictement interdite.', OLD.status;
  END IF;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.trg_prevent_issued_invoice_deletion() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_invoice_no_delete ON public.student_invoices;
CREATE TRIGGER trg_invoice_no_delete
  BEFORE DELETE ON public.student_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_issued_invoice_deletion();

-- Trigger d'immuabilité intégrale et d'annulation atomique sur les paiements
CREATE OR REPLACE FUNCTION public.trg_enforce_payment_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Interdiction absolue de modifier TOUS les attributs opérationnels d'un paiement
  IF (
    OLD.id IS DISTINCT FROM NEW.id OR
    OLD.school_id IS DISTINCT FROM NEW.school_id OR
    OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id OR
    OLD.invoice_id IS DISTINCT FROM NEW.invoice_id OR
    OLD.student_id IS DISTINCT FROM NEW.student_id OR
    OLD.payment_number IS DISTINCT FROM NEW.payment_number OR
    OLD.sequence_number IS DISTINCT FROM NEW.sequence_number OR
    OLD.amount IS DISTINCT FROM NEW.amount OR
    OLD.currency IS DISTINCT FROM NEW.currency OR
    OLD.payment_method IS DISTINCT FROM NEW.payment_method OR
    OLD.payment_date IS DISTINCT FROM NEW.payment_date OR
    OLD.payment_reference IS DISTINCT FROM NEW.payment_reference OR
    OLD.payer_name IS DISTINCT FROM NEW.payer_name OR
    OLD.internal_note IS DISTINCT FROM NEW.internal_note OR
    OLD.recorded_by IS DISTINCT FROM NEW.recorded_by OR
    OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR
    OLD.created_at IS DISTINCT FROM NEW.created_at
  ) THEN
    RAISE EXCEPTION 'REJET : L’intégralité des données d’un paiement enregistré est strictement immuable.';
  END IF;

  -- 2. Interdiction de réactiver un paiement déjà annulé
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'REJET : L’annulation d’un paiement est irréversible.';
  END IF;

  -- 3. Métadonnées d'annulation figées
  IF OLD.status = 'cancelled' AND NEW.status = 'cancelled' THEN
    IF (
      OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at OR
      OLD.cancelled_by IS DISTINCT FROM NEW.cancelled_by OR
      OLD.cancel_reason IS DISTINCT FROM NEW.cancel_reason
    ) THEN
      RAISE EXCEPTION 'REJET : Les métadonnées d’annulation d’un paiement sont figées et ne peuvent être altérées.';
    END IF;
  END IF;

  -- 4. Annulation atomique synchronisée avec le reçu associé
  IF OLD.status = 'confirmed' AND NEW.status = 'cancelled' THEN
    IF NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL OR length(trim(COALESCE(NEW.cancel_reason, ''))) = 0 THEN
      RAISE EXCEPTION 'REJET : L’annulation d’un paiement exige obligatoirement un motif explicite, un auteur et un horodatage.';
    END IF;

    UPDATE public.payment_receipts
    SET is_cancelled = true,
        cancelled_at = NEW.cancelled_at,
        cancelled_by = NEW.cancelled_by,
        cancel_reason = NEW.cancel_reason
    WHERE payment_id = NEW.id
      AND is_cancelled = false;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trg_enforce_payment_immutability() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_payment_immutability ON public.student_payments;
CREATE TRIGGER trg_payment_immutability
  BEFORE UPDATE ON public.student_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_payment_immutability();

CREATE OR REPLACE FUNCTION public.trg_prevent_payment_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'REJET : La suppression physique d’un enregistrement de paiement est strictement interdite.';
END;
$$;

ALTER FUNCTION public.trg_prevent_payment_deletion() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_payment_no_delete ON public.student_payments;
CREATE TRIGGER trg_payment_no_delete
  BEFORE DELETE ON public.student_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_payment_deletion();

-- Trigger d'immuabilité intégrale sur les reçus
CREATE OR REPLACE FUNCTION public.trg_enforce_receipt_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Interdiction absolue de modifier les données financières, d'identité ou le snapshot du reçu
  IF (
    OLD.id IS DISTINCT FROM NEW.id OR
    OLD.school_id IS DISTINCT FROM NEW.school_id OR
    OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id OR
    OLD.payment_id IS DISTINCT FROM NEW.payment_id OR
    OLD.invoice_id IS DISTINCT FROM NEW.invoice_id OR
    OLD.student_id IS DISTINCT FROM NEW.student_id OR
    OLD.receipt_number IS DISTINCT FROM NEW.receipt_number OR
    OLD.sequence_number IS DISTINCT FROM NEW.sequence_number OR
    OLD.receipt_date IS DISTINCT FROM NEW.receipt_date OR
    OLD.amount IS DISTINCT FROM NEW.amount OR
    OLD.currency IS DISTINCT FROM NEW.currency OR
    OLD.payment_method IS DISTINCT FROM NEW.payment_method OR
    OLD.payment_reference IS DISTINCT FROM NEW.payment_reference OR
    OLD.payer_name IS DISTINCT FROM NEW.payer_name OR
    OLD.student_matricule IS DISTINCT FROM NEW.student_matricule OR
    OLD.student_full_name IS DISTINCT FROM NEW.student_full_name OR
    OLD.class_name IS DISTINCT FROM NEW.class_name OR
    OLD.invoice_number IS DISTINCT FROM NEW.invoice_number OR
    OLD.balance_after_payment IS DISTINCT FROM NEW.balance_after_payment OR
    OLD.cashier_name IS DISTINCT FROM NEW.cashier_name OR
    OLD.created_at IS DISTINCT FROM NEW.created_at
  ) THEN
    RAISE EXCEPTION 'REJET : Les données historiques d’un reçu officiel sont strictement immuables.';
  END IF;

  -- 2. Interdiction de réactiver un reçu déjà annulé
  IF OLD.is_cancelled = true AND NEW.is_cancelled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'REJET : L’annulation d’un reçu est irréversible.';
  END IF;

  -- 3. Une fois annulé, les métadonnées d'annulation ne peuvent être modifiées
  IF OLD.is_cancelled = true AND NEW.is_cancelled = true THEN
    IF (
      OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at OR
      OLD.cancelled_by IS DISTINCT FROM NEW.cancelled_by OR
      OLD.cancel_reason IS DISTINCT FROM NEW.cancel_reason
    ) THEN
      RAISE EXCEPTION 'REJET : Les métadonnées d’annulation d’un reçu sont figées et ne peuvent être altérées.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trg_enforce_receipt_immutability() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_receipt_immutability ON public.payment_receipts;
CREATE TRIGGER trg_receipt_immutability
  BEFORE UPDATE ON public.payment_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_receipt_immutability();

CREATE OR REPLACE FUNCTION public.trg_prevent_receipt_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'REJET : La suppression physique d’un reçu officiel est strictement interdite.';
END;
$$;

ALTER FUNCTION public.trg_prevent_receipt_deletion() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_receipt_no_delete ON public.payment_receipts;
CREATE TRIGGER trg_receipt_no_delete
  BEFORE DELETE ON public.payment_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_receipt_deletion();


--------------------------------------------------------------------------------
-- 11. POLITIQUES RLS (Actives, Forcées, Fail-Closed)
--------------------------------------------------------------------------------

ALTER TABLE public.school_finance_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_finance_counters FORCE ROW LEVEL SECURITY;

ALTER TABLE public.school_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_fees FORCE ROW LEVEL SECURITY;

ALTER TABLE public.student_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_invoices FORCE ROW LEVEL SECURITY;

ALTER TABLE public.student_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_invoice_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.student_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_payments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts FORCE ROW LEVEL SECURITY;

-- Politiques SELECT réservées exclusivement au personnel financier actif de l'établissement
CREATE POLICY "FinanceStaff read counters"
  ON public.school_finance_counters FOR SELECT
  USING (public.is_finance_staff(school_id));

CREATE POLICY "FinanceStaff read school fees"
  ON public.school_fees FOR SELECT
  USING (public.is_finance_staff(school_id));

CREATE POLICY "FinanceStaff read invoices"
  ON public.student_invoices FOR SELECT
  USING (public.is_finance_staff(school_id));

CREATE POLICY "FinanceStaff read invoice items"
  ON public.student_invoice_items FOR SELECT
  USING (public.is_finance_staff(school_id));

CREATE POLICY "FinanceStaff read payments"
  ON public.student_payments FOR SELECT
  USING (public.is_finance_staff(school_id));

CREATE POLICY "FinanceStaff read receipts"
  ON public.payment_receipts FOR SELECT
  USING (public.is_finance_staff(school_id));

-- AUCUNE politique INSERT, UPDATE ou DELETE n'est accordée aux clients.
-- Toutes les mutations financières sont bloquées au niveau table pour tous les rôles frontend.

COMMIT;
