// Fichier : src/types/finance.ts
// Interfaces TypeScript pour la Phase Finance d'ÉcoleConnect

export type Currency = 'USD' | 'CDF';

export type FeeType =
  | 'inscription'
  | 'minerval'
  | 'frais_examen'
  | 'uniforme'
  | 'transport'
  | 'cantine'
  | 'activite'
  | 'autre';

export type FeePeriodicity = 'unique' | 'mensuel' | 'trimestriel' | 'annuel';

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled';

export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_money' | 'card' | 'check' | 'other';

export type PaymentStatus = 'completed' | 'cancelled';

export interface SchoolFee {
  id: string;
  school_id: string;
  name: string;
  code: string | null;
  description: string | null;
  fee_type: FeeType;
  periodicity: FeePeriodicity;
  currency: Currency;
  amount: number;
  education_cycle: 'primary' | 'secondary' | null;
  level: string | null;
  is_mandatory: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StudentInvoiceItem {
  id: string;
  invoice_id: string;
  school_id: string;
  academic_year_id: string;
  student_id: string;
  school_fee_id: string | null;
  currency: Currency;
  fee_name: string;
  fee_type: FeeType;
  unit_price: number;
  quantity: number;
  total_price: number;
  created_at: string;
}

export interface StudentInvoice {
  id: string;
  school_id: string;
  academic_year_id: string;
  student_id: string;
  enrollment_id?: string | null;
  class_id?: string | null;
  invoice_number: string;
  sequence_number?: number;
  issue_date: string;
  due_date?: string | null;
  currency: Currency;
  total_amount: number;
  paid_amount: number;
  remaining_balance?: number;
  status: InvoiceStatus;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string;
  student_name?: string;
  student_number?: string;
  class_name?: string;
  items?: StudentInvoiceItem[];
  payments?: StudentPayment[];
}

export interface StudentPayment {
  id: string;
  school_id: string;
  invoice_id: string;
  receipt_id?: string | null;
  payment_number: string;
  sequence_number: number;
  amount: number;
  currency: Currency;
  payment_date: string;
  payment_method: PaymentMethod;
  external_reference: string | null;
  idempotency_key: string | null;
  status: PaymentStatus;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  recorded_by: string | null;
  created_at: string;
  receipt?: PaymentReceipt | null;
}

export interface PaymentReceipt {
  id: string;
  school_id: string;
  payment_id: string;
  invoice_id: string;
  receipt_number: string;
  sequence_number: number;
  issue_date: string;
  currency: Currency;
  amount: number;
  pdf_path: string | null;
  pdf_checksum: string | null;
  issued_by: string | null;
  created_at: string;
}

// Paramètres de création de facture brouillon
export interface CreateDraftInvoiceItemInput {
  fee_name: string;
  fee_type?: FeeType;
  unit_price: number;
  quantity: number;
  school_fee_id?: string | null;
}

export interface CreateDraftInvoiceParams {
  p_student_id: string;
  p_academic_year_id: string;
  p_due_date?: string | null;
  p_currency?: Currency;
  p_items: CreateDraftInvoiceItemInput[];
  p_notes?: string | null;
}

// Paramètres d'encaissement de paiement
export interface RecordPaymentParams {
  p_invoice_id: string;
  p_amount: number;
  p_payment_method?: PaymentMethod;
  p_idempotency_key?: string | null;
  p_payment_date?: string | null;
  p_payment_reference?: string | null;
  p_payer_name?: string | null;
  p_internal_note?: string | null;
}

export interface RecordPaymentResult {
  payment_id: string;
  receipt_id: string;
  invoice_id: string;
  payment_number: string;
  receipt_number: string;
  amount: number;
  currency: Currency;
  payment_method: PaymentMethod;
  invoice_status: InvoiceStatus;
  total_paid: number;
  balance_after_payment: number;
  recorded_at: string;
  is_idempotent_replay: boolean;
}

// Résultats RPC parent, enseignant et dossier admin
export interface ParentStudentFinancesResult {
  student_id: string;
  student_number: string;
  student_name: string;
  class_name: string;
  total_invoiced: number;
  total_paid: number;
  total_remaining: number;
  currency: Currency;
  invoices: Array<{
    id: string;
    invoice_number: string;
    issue_date: string;
    due_date: string | null;
    total_amount: number;
    paid_amount: number;
    remaining_balance: number;
    status: InvoiceStatus;
    currency: Currency;
    items_summary: string;
  }>;
}

export interface TeacherClassFinanceOverviewResult {
  class_id: string;
  class_name: string;
  total_students: number;
  students_up_to_date: number;
  students_with_balance: number;
  students_no_invoice: number;
  compliance_percentage: number;
  students: Array<{
    student_id: string;
    student_number: string;
    student_name: string;
    financial_status: 'up_to_date' | 'partial' | 'unpaid' | 'no_invoice';
    has_overdue_invoice: boolean;
  }>;
}

export interface StudentFinanceDossierAdminResult {
  student: {
    id: string;
    student_number: string;
    name: string;
    class_name: string;
    school_name: string;
  };
  summary: {
    total_invoiced: number;
    total_paid: number;
    total_remaining: number;
    invoices_count: number;
    payments_count: number;
    currency: Currency;
  };
  invoices: Array<{
    id: string;
    invoice_number: string;
    issue_date: string;
    due_date: string | null;
    total_amount: number;
    paid_amount: number;
    remaining_balance: number;
    status: InvoiceStatus;
    currency: Currency;
    created_at: string;
    items: StudentInvoiceItem[];
  }>;
  payments: Array<{
    id: string;
    payment_number: string;
    receipt_number: string | null;
    invoice_id: string;
    invoice_number: string;
    amount: number;
    currency: Currency;
    payment_date: string;
    payment_method: PaymentMethod;
    external_reference: string | null;
    status: PaymentStatus;
    recorded_by_name: string | null;
    cancelled_at?: string | null;
    cancelled_by?: string | null;
    cancel_reason?: string | null;
    created_at: string;
  }>;
}
