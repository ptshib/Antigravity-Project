// Fichier : src/services/financeService.ts
// Service API Supabase pour la Phase Finance d'ÉcoleConnect (Passage exclusif par RPCs SECURITY DEFINER)

import { supabase } from '../lib/supabase';
import type {
  CreateDraftInvoiceParams,
  CreateDraftInvoiceResult,
  VoidDraftInvoiceParams,
  RecordPaymentParams,
  RecordPaymentResult,
  ParentStudentFinancesResult,
  TeacherClassFinanceOverviewResult,
  StudentFinanceDossierAdminResult,
  InvoiceStatus,
  Currency,
  PaymentMethod,
  PaymentStatus,
  AgingSummaryResponse,
  OverdueInvoicesResponse,
  OverdueInvoicesFilters,
  OverdueInvoicesCursor,
  AgingBucketKey,
  CurrencyAgingSummary,
  AgingBucketSummary
} from '../types/finance';

/**
 * Classe d'erreur personnalisée pour le service financier.
 */
export class FinanceServiceError extends Error {
  public readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'FinanceServiceError';
    this.code = code;
  }
}

// Helpers de vérification sûre sans cast direct
function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

function getStringProperty(obj: Record<string, unknown>, key: string): string | null {
  if (key in obj) {
    const val = obj[key];
    if (typeof val === 'string') return val;
  }
  return null;
}

function getNumberProperty(obj: Record<string, unknown>, key: string): number | null {
  if (key in obj) {
    const val = obj[key];
    if (typeof val === 'number') return val;
  }
  return null;
}

/**
 * Mappe les erreurs PostgreSQL vers des messages métier propres sans fuite d'implémentation (CONTEXT, HINT, contrainte, table).
 */
function mapPostgresError(error: unknown): Error {
  if (!isObject(error)) {
    return new FinanceServiceError('Une erreur est survenue lors du traitement financier. Veuillez réessayer.');
  }

  const code = getStringProperty(error, 'code') || '';
  const msg = getStringProperty(error, 'message') || '';

  // 1. Accès non autorisé (SQLSTATE 42501)
  if (code === '42501' || msg.includes('42501') || msg.includes('non autorisée') || msg.includes('VIOLATION SÉCURITÉ')) {
    return new FinanceServiceError(
      'Accès non autorisé : Vous ne disposez pas des privilèges nécessaires pour exécuter cette opération financière.',
      '42501'
    );
  }

  // 2. Surpaiement / Invalide (SQLSTATE 22023)
  if (code === '22023' || msg.includes('22023') || msg.includes('dépasse le solde') || msg.includes('Surpaiement')) {
    return new FinanceServiceError(
      'Surpaiement non autorisé : Le montant saisi dépasse le solde restant dû de la facture.',
      '22023'
    );
  }

  // 3. Conflits / Idempotence connus
  if (msg.includes('idempotent') || msg.includes('déjà enregistré')) {
    return new FinanceServiceError(
      'Un paiement avec cette référence ou clé d’idempotence a déjà été enregistré.',
      '409'
    );
  }

  // 4. Erreur inconnue / technique -> Message générique sécurisé (sans fuite CONTEXT, HINT, nom de fonction, table ou contrainte)
  return new FinanceServiceError('Une erreur est survenue lors du traitement financier. Veuillez réessayer.');
}

// ---------------------------------------------------------------------------
// VALIDATEURS ET TYPE GUARDS EXPLICITES POUR LES 7 RPCs (VALIDE CHAQUE RÉPONSE)
// ---------------------------------------------------------------------------

export function validateCreateDraftInvoiceResult(data: unknown): CreateDraftInvoiceResult {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour create_draft_student_invoice (non-objet).');
  }

  if (data['success'] !== true) {
    const errorMsg = typeof data['error'] === 'string' ? data['error'] : 'La création de la facture a échoué côté serveur.';
    throw new FinanceServiceError(errorMsg);
  }

  const invoice_id = getStringProperty(data, 'invoice_id');
  if (!invoice_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice_id)) {
    throw new FinanceServiceError('Propriété obligatoire "invoice_id" manquante ou format UUID invalide.');
  }

  const invoice_number = getStringProperty(data, 'invoice_number');
  if (!invoice_number || invoice_number.trim() === '') {
    throw new FinanceServiceError('Propriété obligatoire "invoice_number" manquante ou vide.');
  }

  const sequence_number = getNumberProperty(data, 'sequence_number');
  if (sequence_number === null || sequence_number <= 0) {
    throw new FinanceServiceError('Propriété obligatoire "sequence_number" manquante ou non strictement positive.');
  }

  const status = getStringProperty(data, 'status');
  if (status !== 'draft') {
    throw new FinanceServiceError(`Statut invalide pour un brouillon créé : attendu "draft", reçu "${status}".`);
  }

  const currency = getStringProperty(data, 'currency');
  if (currency !== 'USD' && currency !== 'CDF') {
    throw new FinanceServiceError(`Devise invalide dans le retour RPC : attendu "USD" ou "CDF", reçu "${currency}".`);
  }

  const total_amount = getNumberProperty(data, 'total_amount');
  if (total_amount === null || total_amount <= 0) {
    throw new FinanceServiceError('Propriété obligatoire "total_amount" manquante ou non strictement positive.');
  }

  const created_at = getStringProperty(data, 'created_at');
  if (!created_at || isNaN(Date.parse(created_at))) {
    throw new FinanceServiceError('Propriété obligatoire "created_at" manquante ou horodatage ISO invalide.');
  }

  if (typeof data['is_idempotent_replay'] !== 'boolean') {
    throw new FinanceServiceError('Propriété obligatoire "is_idempotent_replay" manquante ou non booléenne.');
  }

  const due_date = data['due_date'] !== null && data['due_date'] !== undefined
    ? String(data['due_date'])
    : null;

  return {
    success: true,
    is_idempotent_replay: Boolean(data['is_idempotent_replay']),
    invoice_id,
    invoice_number,
    sequence_number,
    status: 'draft',
    currency: currency as Currency,
    total_amount,
    due_date,
    created_at
  };
}

function validateIssueInvoiceResponse(data: unknown): unknown {
  if (data === null || data === undefined || typeof data === 'boolean' || isObject(data)) {
    return data;
  }
  throw new FinanceServiceError('La RPC issue_student_invoice a renvoyé une réponse invalide.');
}

export function validateRecordPaymentResult(data: unknown): RecordPaymentResult {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour record_student_payment.');
  }

  const success = data['success'] === true;
  const payment_id = getStringProperty(data, 'payment_id');
  const receipt_id = getStringProperty(data, 'receipt_id');
  const invoice_id = getStringProperty(data, 'invoice_id');
  const payment_number = getStringProperty(data, 'payment_number');
  const receipt_number = getStringProperty(data, 'receipt_number');
  const amount = getNumberProperty(data, 'amount');
  const currency = getStringProperty(data, 'currency') || 'CDF';
  const payment_method = (getStringProperty(data, 'payment_method') as PaymentMethod) || 'cash';
  const invoice_status = getStringProperty(data, 'invoice_status');
  const total_paid = getNumberProperty(data, 'total_paid') ?? getNumberProperty(data, 'new_paid_amount');
  const balance_after_payment = getNumberProperty(data, 'balance_after_payment') ?? getNumberProperty(data, 'new_remaining_balance');
  const recorded_at = getStringProperty(data, 'recorded_at') || new Date().toISOString();
  const is_idempotent_replay = Boolean(data['is_idempotent_replay']);

  if (
    !success ||
    !payment_id ||
    !receipt_id ||
    !invoice_id ||
    !payment_number ||
    !receipt_number ||
    amount === null ||
    total_paid === null ||
    balance_after_payment === null ||
    !invoice_status
  ) {
    throw new FinanceServiceError('Champs obligatoires manquants ou invalides dans la réponse de record_student_payment.');
  }

  return {
    payment_id,
    receipt_id,
    invoice_id,
    payment_number,
    receipt_number,
    amount,
    currency: currency as Currency,
    payment_method,
    invoice_status: invoice_status as InvoiceStatus,
    total_paid,
    balance_after_payment,
    recorded_at,
    is_idempotent_replay
  };
}

function validateCancelPaymentResponse(data: unknown): unknown {
  if (data === null || data === undefined || typeof data === 'boolean' || isObject(data)) {
    return data;
  }
  throw new FinanceServiceError('La RPC cancel_student_payment a renvoyé une réponse invalide.');
}

function validateParentStudentFinances(data: unknown): ParentStudentFinancesResult {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour get_parent_student_finances.');
  }

  const student_id = getStringProperty(data, 'student_id');
  const student_number = getStringProperty(data, 'student_number');
  const student_name = getStringProperty(data, 'student_name');
  const class_name = getStringProperty(data, 'class_name') || '';
  const total_invoiced = getNumberProperty(data, 'total_invoiced');
  const total_paid = getNumberProperty(data, 'total_paid');
  const total_remaining = getNumberProperty(data, 'total_remaining');
  const currency = getStringProperty(data, 'currency') || 'USD';
  const rawInvoices = data['invoices'];

  if (
    !student_id ||
    !student_number ||
    !student_name ||
    total_invoiced === null ||
    total_paid === null ||
    total_remaining === null ||
    !Array.isArray(rawInvoices)
  ) {
    throw new FinanceServiceError('Champs obligatoires manquants dans la réponse de get_parent_student_finances.');
  }

  const validatedInvoices = rawInvoices.map((inv: unknown) => {
    if (!isObject(inv)) throw new FinanceServiceError('Élément de facture invalide dans get_parent_student_finances.');
    return {
      id: getStringProperty(inv, 'id') || '',
      invoice_number: getStringProperty(inv, 'invoice_number') || '',
      issue_date: getStringProperty(inv, 'issue_date') || '',
      due_date: getStringProperty(inv, 'due_date'),
      total_amount: getNumberProperty(inv, 'total_amount') || 0,
      paid_amount: getNumberProperty(inv, 'paid_amount') || 0,
      remaining_balance: getNumberProperty(inv, 'remaining_balance') || 0,
      status: (getStringProperty(inv, 'status') as InvoiceStatus) || 'draft',
      currency: (getStringProperty(inv, 'currency') as Currency) || 'USD',
      items_summary: getStringProperty(inv, 'items_summary') || ''
    };
  });

  return {
    student_id,
    student_number,
    student_name,
    class_name,
    total_invoiced,
    total_paid,
    total_remaining,
    currency: currency as Currency,
    invoices: validatedInvoices
  };
}

function validateTeacherClassFinanceOverview(data: unknown): TeacherClassFinanceOverviewResult {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour get_teacher_class_finance_overview.');
  }

  const class_id = getStringProperty(data, 'class_id');
  const class_name = getStringProperty(data, 'class_name') || '';
  const total_students = getNumberProperty(data, 'total_students');
  const students_up_to_date = getNumberProperty(data, 'students_up_to_date') || 0;
  const students_with_balance = getNumberProperty(data, 'students_with_balance') || 0;
  const students_no_invoice = getNumberProperty(data, 'students_no_invoice') || 0;
  const compliance_percentage = getNumberProperty(data, 'compliance_percentage');
  const rawStudents = data['students'];

  if (
    !class_id ||
    total_students === null ||
    compliance_percentage === null ||
    !Array.isArray(rawStudents)
  ) {
    throw new FinanceServiceError('Champs obligatoires manquants dans la réponse de get_teacher_class_finance_overview.');
  }

  const validatedStudents = rawStudents.map((st: unknown) => {
    if (!isObject(st)) throw new FinanceServiceError('Structure élève invalide dans get_teacher_class_finance_overview.');
    return {
      student_id: getStringProperty(st, 'student_id') || '',
      student_number: getStringProperty(st, 'student_number') || '',
      student_name: getStringProperty(st, 'student_name') || '',
      financial_status: (getStringProperty(st, 'financial_status') as 'up_to_date' | 'partial' | 'unpaid' | 'no_invoice') || 'no_invoice',
      has_overdue_invoice: Boolean(st['has_overdue_invoice'])
    };
  });

  return {
    class_id,
    class_name,
    total_students,
    students_up_to_date,
    students_with_balance,
    students_no_invoice,
    compliance_percentage,
    students: validatedStudents
  };
}

function validateStudentFinanceDossierAdmin(data: unknown): StudentFinanceDossierAdminResult {
  if (!isObject(data) || !isObject(data['student']) || !isObject(data['summary'])) {
    throw new FinanceServiceError('Format de réponse invalide pour get_student_finance_dossier_admin.');
  }

  const st = data['student'] as Record<string, unknown>;
  const sm = data['summary'] as Record<string, unknown>;
  const invs = Array.isArray(data['invoices']) ? data['invoices'] : [];
  const pays = Array.isArray(data['payments']) ? data['payments'] : [];

  return {
    student: {
      id: getStringProperty(st, 'id') || '',
      student_number: getStringProperty(st, 'student_number') || '',
      name: getStringProperty(st, 'name') || '',
      class_name: getStringProperty(st, 'class_name') || '',
      school_name: getStringProperty(st, 'school_name') || ''
    },
    summary: {
      total_invoiced: getNumberProperty(sm, 'total_invoiced') || 0,
      total_paid: getNumberProperty(sm, 'total_paid') || 0,
      total_remaining: getNumberProperty(sm, 'total_remaining') || 0,
      invoices_count: getNumberProperty(sm, 'invoices_count') || 0,
      payments_count: getNumberProperty(sm, 'payments_count') || 0,
      currency: (getStringProperty(sm, 'currency') as Currency) || 'USD'
    },
    invoices: invs.map((inv: unknown) => {
      const invObj = isObject(inv) ? inv : {};
      return {
        id: getStringProperty(invObj, 'id') || '',
        invoice_number: getStringProperty(invObj, 'invoice_number') || '',
        issue_date: getStringProperty(invObj, 'issue_date') || '',
        due_date: getStringProperty(invObj, 'due_date'),
        total_amount: getNumberProperty(invObj, 'total_amount') || 0,
        paid_amount: getNumberProperty(invObj, 'paid_amount') || 0,
        remaining_balance: getNumberProperty(invObj, 'remaining_balance') || 0,
        status: (getStringProperty(invObj, 'status') as InvoiceStatus) || 'draft',
        currency: (getStringProperty(invObj, 'currency') as Currency) || 'USD',
        created_at: getStringProperty(invObj, 'created_at') || '',
        items: Array.isArray(invObj['items']) ? invObj['items'] : []
      };
    }),
    payments: pays.map((pay: unknown) => {
      const payObj = isObject(pay) ? pay : {};
      return {
        id: getStringProperty(payObj, 'id') || '',
        payment_number: getStringProperty(payObj, 'payment_number') || '',
        receipt_number: getStringProperty(payObj, 'receipt_number'),
        invoice_id: getStringProperty(payObj, 'invoice_id') || '',
        invoice_number: getStringProperty(payObj, 'invoice_number') || '',
        amount: getNumberProperty(payObj, 'amount') || 0,
        currency: (getStringProperty(payObj, 'currency') as Currency) || 'USD',
        payment_date: getStringProperty(payObj, 'payment_date') || '',
        payment_method: (getStringProperty(payObj, 'payment_method') as PaymentMethod) || 'cash',
        external_reference: getStringProperty(payObj, 'external_reference'),
        status: (getStringProperty(payObj, 'status') as PaymentStatus) || 'confirmed',
        recorded_by_name: getStringProperty(payObj, 'recorded_by_name'),
        cancelled_at: getStringProperty(payObj, 'cancelled_at'),
        cancelled_by: getStringProperty(payObj, 'cancelled_by'),
        cancel_reason: getStringProperty(payObj, 'cancel_reason'),
        created_at: getStringProperty(payObj, 'created_at') || ''
      };
    })
  };
}

// ---------------------------------------------------------------------------
// LES 7 FONCTIONS DU SERVICE FINANCIER (PASSE EXCLUSIVEMENT PAR VALIDATEURS)
// ---------------------------------------------------------------------------

/**
 * 1. RPC create_draft_student_invoice
 */
export async function createDraftStudentInvoice(params: CreateDraftInvoiceParams): Promise<{ result: CreateDraftInvoiceResult | null; invoiceId: string | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('create_draft_student_invoice', {
      p_student_id: params.p_student_id,
      p_academic_year_id: params.p_academic_year_id,
      p_due_date: params.p_due_date || null,
      p_currency: params.p_currency,
      p_items: params.p_items,
      p_idempotency_key: params.p_idempotency_key,
      p_issue_date: params.p_issue_date || new Date().toISOString().split('T')[0],
      p_notes: params.p_notes || null
    });

    if (error) return { result: null, invoiceId: null, error: mapPostgresError(error) };
    const result = validateCreateDraftInvoiceResult(data);
    return { result, invoiceId: result.invoice_id, error: null };
  } catch (err: unknown) {
    return { result: null, invoiceId: null, error: mapPostgresError(err) };
  }
}

/**
 * RPC void_draft_student_invoice (Annulation auditable d'un brouillon)
 */
export async function voidDraftStudentInvoice(params: VoidDraftInvoiceParams): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('void_draft_student_invoice', {
      p_invoice_id: params.p_invoice_id,
      p_cancel_reason: params.p_cancel_reason
    });

    if (error) return { success: false, error: mapPostgresError(error) };
    const isSuccess = isObject(data) && data['success'] === true;
    if (!isSuccess) {
      return { success: false, error: new FinanceServiceError('La RPC void_draft_student_invoice n’a pas confirmé l’annulation.') };
    }
    return { success: true, error: null };
  } catch (err: unknown) {
    return { success: false, error: mapPostgresError(err) };
  }
}

/**
 * 2. RPC issue_student_invoice
 */
export async function issueStudentInvoice(invoiceId: string): Promise<{ data: unknown | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('issue_student_invoice', {
      p_invoice_id: invoiceId
    });

    if (error) return { data: null, error: mapPostgresError(error) };
    const validated = validateIssueInvoiceResponse(data);
    return { data: validated, error: null };
  } catch (err: unknown) {
    return { data: null, error: mapPostgresError(err) };
  }
}

/**
 * 3. RPC record_student_payment
 */
export async function recordStudentPayment(params: RecordPaymentParams): Promise<{ result: RecordPaymentResult | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('record_student_payment', {
      p_invoice_id: params.p_invoice_id,
      p_amount: params.p_amount,
      p_payment_method: params.p_payment_method || 'cash',
      p_idempotency_key: params.p_idempotency_key || null,
      p_payment_date: params.p_payment_date || null,
      p_payment_reference: params.p_payment_reference || null,
      p_payer_name: params.p_payer_name || null,
      p_internal_note: params.p_internal_note || null
    });

    if (error) return { result: null, error: mapPostgresError(error) };
    const result = validateRecordPaymentResult(data);
    return { result, error: null };
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) {
      return { result: null, error: err };
    }
    return { result: null, error: mapPostgresError(err) };
  }
}

/**
 * 4. RPC cancel_student_payment
 */
export async function cancelStudentPayment(paymentId: string, reason: string): Promise<{ data: unknown | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('cancel_student_payment', {
      p_payment_id: paymentId,
      p_cancel_reason: reason
    });

    if (error) return { data: null, error: mapPostgresError(error) };
    const validated = validateCancelPaymentResponse(data);
    return { data: validated, error: null };
  } catch (err: unknown) {
    return { data: null, error: mapPostgresError(err) };
  }
}

/**
 * 5. RPC get_parent_student_finances
 */
export async function getParentStudentFinances(studentId: string): Promise<{ finances: ParentStudentFinancesResult | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('get_parent_student_finances', {
      p_student_id: studentId
    });

    if (error) return { finances: null, error: mapPostgresError(error) };
    const finances = validateParentStudentFinances(data);
    return { finances, error: null };
  } catch (err: unknown) {
    return { finances: null, error: mapPostgresError(err) };
  }
}

/**
 * 6. RPC get_teacher_class_finance_overview
 */
export async function getTeacherClassFinanceOverview(classId: string): Promise<{ overview: TeacherClassFinanceOverviewResult | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('get_teacher_class_finance_overview', {
      p_class_id: classId
    });

    if (error) return { overview: null, error: mapPostgresError(error) };
    const overview = validateTeacherClassFinanceOverview(data);
    return { overview, error: null };
  } catch (err: unknown) {
    return { overview: null, error: mapPostgresError(err) };
  }
}

/**
 * 7. RPC get_student_finance_dossier_admin
 */
export async function getStudentFinanceDossierAdmin(
  studentId: string,
  academicYearId?: string | null
): Promise<{ dossier: StudentFinanceDossierAdminResult | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('get_student_finance_dossier_admin', {
      p_student_id: studentId,
      p_academic_year_id: academicYearId || null
    });

    if (error) return { dossier: null, error: mapPostgresError(error) };
    const dossier = validateStudentFinanceDossierAdmin(data);
    return { dossier, error: null };
  } catch (err: unknown) {
    return { dossier: null, error: mapPostgresError(err) };
  }
}

/**
 * 8. RPC create_school_fee_catalog_item
 */
export async function createSchoolFeeCatalogItem(
  params: import('../types/finance').CreateSchoolFeeCatalogItemParams
): Promise<{ result: { success: boolean; fee_id: string } | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('create_school_fee_catalog_item', {
      p_academic_year_id: params.p_academic_year_id,
      p_fee_type: params.p_fee_type,
      p_name: params.p_name,
      p_amount: params.p_amount,
      p_currency: params.p_currency,
      p_due_date: params.p_due_date,
      p_class_id: params.p_class_id || null,
      p_description: params.p_description || null,
      p_is_mandatory: params.p_is_mandatory !== false
    });

    if (error) return { result: null, error: mapPostgresError(error) };
    return { result: data as { success: boolean; fee_id: string }, error: null };
  } catch (err: unknown) {
    return { result: null, error: mapPostgresError(err) };
  }
}

/**
 * 9. RPC update_school_fee_catalog_item
 */
export async function updateSchoolFeeCatalogItem(
  params: import('../types/finance').UpdateSchoolFeeCatalogItemParams
): Promise<{ result: { success: boolean; fee_id: string } | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('update_school_fee_catalog_item', {
      p_fee_id: params.p_fee_id,
      p_name: params.p_name,
      p_amount: params.p_amount,
      p_due_date: params.p_due_date,
      p_description: params.p_description || null,
      p_is_mandatory: params.p_is_mandatory !== false
    });

    if (error) return { result: null, error: mapPostgresError(error) };
    return { result: data as { success: boolean; fee_id: string }, error: null };
  } catch (err: unknown) {
    return { result: null, error: mapPostgresError(err) };
  }
}

/**
 * 10. RPC set_school_fee_catalog_item_status
 */
export async function setSchoolFeeCatalogItemStatus(
  feeId: string,
  isActive: boolean
): Promise<{ result: { success: boolean; fee_id: string; is_active: boolean } | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('set_school_fee_catalog_item_status', {
      p_fee_id: feeId,
      p_is_active: isActive
    });

    if (error) return { result: null, error: mapPostgresError(error) };
    return { result: data as { success: boolean; fee_id: string; is_active: boolean }, error: null };
  } catch (err: unknown) {
    return { result: null, error: mapPostgresError(err) };
  }
}

/**
 * 11. Consultation du catalogue public.school_fees
 */
export async function fetchSchoolFeesCatalog(
  schoolId: string,
  academicYearId?: string | null
): Promise<{ fees: import('../types/finance').SchoolFee[]; error: Error | null }> {
  try {
    let query = supabase
      .from('school_fees')
      .select('*, class:classes(id, name)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    if (academicYearId) {
      query = query.eq('academic_year_id', academicYearId);
    }

    const { data, error } = await query;
    if (error) return { fees: [], error: mapPostgresError(error) };

    const formatted: import('../types/finance').SchoolFee[] = (data || []).map((row: any) => ({
      id: row.id,
      school_id: row.school_id,
      academic_year_id: row.academic_year_id,
      class_id: row.class_id,
      class_name: row.class?.name || null,
      name: row.name,
      description: row.description,
      fee_type: row.fee_type,
      amount: Number(row.amount) || 0,
      currency: row.currency,
      due_date: row.due_date,
      is_mandatory: row.is_mandatory,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    return { fees: formatted, error: null };
  } catch (err: unknown) {
    return { fees: [], error: mapPostgresError(err) };
  }
}

// ---------------------------------------------------------------------------
// CALCUL CANONIQUE DES KPIS DU TABLEAU DE BORD FINANCIER
// ---------------------------------------------------------------------------

export interface DashboardInvoiceRecord {
  id?: string;
  total_amount?: number | string | null;
  paid_amount?: number | string | null;
  remaining_balance?: number | string | null;
  currency?: string;
  status?: string;
}

export interface CurrencyKpiSummary {
  totalIssued: number;
  totalPaid: number;
  totalRemaining: number;
  issuedCount: number;
  paidCount: number;
  partialCount: number;
  draftCount: number;
  voidedCount: number;
}

export interface FinanceDashboardKpisResult {
  USD: CurrencyKpiSummary;
  CDF: CurrencyKpiSummary;
}

/**
 * Récupération exhaustive et paginée de toutes les factures d'un établissement.
 * - Pagination déterministe par paquets de 1 000 lignes
 * - Tri stable par id (`.order('id', { ascending: true })`)
 * - Arrêt automatique sur la dernière page (< 1000 lignes)
 * - Déduplication par ID pour éviter tout doublon
 * - Erreur explicite sur page intermédiaire sans retourner de totaux partiels trompeurs
 */
export async function fetchAllSchoolInvoices(
  schoolId: string,
  customPageSize: number = 1000,
  customMaxPages: number = 500
): Promise<{ data: DashboardInvoiceRecord[]; error: Error | null }> {
  const allInvoices: DashboardInvoiceRecord[] = [];
  const seenIds = new Set<string>();
  const pageSize = customPageSize;
  let pageIndex = 0;
  const maxPages = customMaxPages;
  let lastPageLength = 0;

  try {
    while (pageIndex < maxPages) {
      const from = pageIndex * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('student_invoices')
        .select('id, total_amount, paid_amount, remaining_balance, currency, status')
        .eq('school_id', schoolId)
        .order('id', { ascending: true })
        .range(from, to);

      if (error) {
        return { data: [], error: mapPostgresError(error) };
      }

      if (!data || data.length === 0) {
        lastPageLength = 0;
        break;
      }

      lastPageLength = data.length;

      for (const inv of data) {
        const invId = inv.id ? String(inv.id) : null;
        if (invId) {
          if (seenIds.has(invId)) {
            continue;
          }
          seenIds.add(invId);
        }
        allInvoices.push(inv);
      }

      if (data.length < pageSize) {
        break;
      }

      pageIndex++;
    }

    if (pageIndex >= maxPages && lastPageLength === pageSize) {
      return {
        data: [],
        error: new FinanceServiceError(
          `Limite de sécurité de pagination atteinte (${maxPages} pages / ${maxPages * pageSize} factures). Chargement annulé pour éviter un résultat partiel.`
        )
      };
    }

    return { data: allInvoices, error: null };
  } catch (err: unknown) {
    return { data: [], error: mapPostgresError(err) };
  }
}

/**
 * Valide et convertit un montant financier de manière stricte.
 * - null / undefined / chaîne vide -> 0 (conforme au schéma SQL)
 * - NaN / non-numérique -> Levée d'erreur explicite
 * - Montant négatif -> Levée d'erreur explicite
 */
function parseAndValidateAmount(val: unknown, fieldName: string): number {
  if (val === null || val === undefined || val === '') return 0;
  const num = Number(val);
  if (isNaN(num)) {
    throw new FinanceServiceError(`Champ financier invalide (${fieldName}) : valeur non-numérique '${val}'.`);
  }
  if (num < 0) {
    throw new FinanceServiceError(`Champ financier invalide (${fieldName}) : montant négatif '${val}' non autorisé.`);
  }
  return num;
}

/**
 * Calcul canonique des KPIs du tableau de bord financier.
 * RÈGLES STRICTES :
 * - Total émis & Nombre de factures émises : incluent UNIQUEMENT 'issued', 'partially_paid', et 'paid'.
 * - Brouillons ('draft') et Annulées ('voided') : STRICTEMENT EXCLUS du total émis et du nombre d'émises.
 * - Reste à recouvrer : solde restant dû ('remaining_balance') des factures 'issued' et 'partially_paid'.
 * - Total encaissé : total réglé ('paid_amount') des factures 'issued', 'partially_paid', et 'paid'.
 * - Statut inconnu ou non-autorisé : Levée immédiate d'une exception FinanceServiceError.
 * - Validation stricte des montants (rejet immédiat des NaN et montants négatifs).
 * - Isolation stricte des devises USD et CDF.
 */
export function computeFinanceDashboardKPIs(invoices: DashboardInvoiceRecord[]): FinanceDashboardKpisResult {
  const result: FinanceDashboardKpisResult = {
    USD: { totalIssued: 0, totalPaid: 0, totalRemaining: 0, issuedCount: 0, paidCount: 0, partialCount: 0, draftCount: 0, voidedCount: 0 },
    CDF: { totalIssued: 0, totalPaid: 0, totalRemaining: 0, issuedCount: 0, paidCount: 0, partialCount: 0, draftCount: 0, voidedCount: 0 }
  };

  if (!Array.isArray(invoices)) return result;

  invoices.forEach((inv) => {
    if (!inv) return;
    const status = String(inv.status || '').toLowerCase().trim();
    const currency = (inv.currency === 'CDF' ? 'CDF' : 'USD') as 'USD' | 'CDF';

    const totalAmt = parseAndValidateAmount(inv.total_amount, 'total_amount');
    const paidAmt = parseAndValidateAmount(inv.paid_amount, 'paid_amount');
    const remAmt = parseAndValidateAmount(inv.remaining_balance, 'remaining_balance');

    const target = result[currency];

    if (status === 'draft') {
      target.draftCount += 1;
    } else if (status === 'voided') {
      target.voidedCount += 1;
    } else if (status === 'issued' || status === 'partially_paid' || status === 'paid') {
      target.totalIssued += totalAmt;
      target.totalPaid += paidAmt;
      target.issuedCount += 1;

      if (status === 'issued' || status === 'partially_paid') {
        target.totalRemaining += remAmt;
      }

      if (status === 'paid') target.paidCount += 1;
      if (status === 'partially_paid') target.partialCount += 1;
    } else {
      throw new FinanceServiceError(`Statut de facture inconnu ou non autorisé dans les KPIs : '${status}'.`);
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// VALIDATEURS RUNTIME DE SÉCURITÉ POUR FINANCE 4A (BALANCE ÂGÉE & CRÉANCES)
// ---------------------------------------------------------------------------

function validateAgingBucketSummary(bucketData: unknown, bucketName: string): AgingBucketSummary {
  if (!isObject(bucketData)) {
    throw new FinanceServiceError(`Structure invalide pour la tranche de retard '${bucketName}' (non-objet).`);
  }
  const amount = getNumberProperty(bucketData, 'amount');
  if (amount === null || !isFinite(amount) || amount < 0) {
    throw new FinanceServiceError(`Montant invalide ou négatif pour la tranche de retard '${bucketName}'.`);
  }
  const count = getNumberProperty(bucketData, 'count');
  if (count === null || !isFinite(count) || count < 0 || !Number.isInteger(count)) {
    throw new FinanceServiceError(`Nombre de factures invalide pour la tranche de retard '${bucketName}'.`);
  }
  return { amount, count };
}

function validateCurrencyAgingSummary(currData: unknown, expectedCurrency: 'USD' | 'CDF'): CurrencyAgingSummary {
  if (!isObject(currData)) {
    throw new FinanceServiceError(`Structure de synthèse manquante ou invalide pour la devise ${expectedCurrency}.`);
  }
  const currency = getStringProperty(currData, 'currency');
  if (currency !== expectedCurrency) {
    throw new FinanceServiceError(`Devise incohérente dans la synthèse : attendu '${expectedCurrency}', reçu '${currency}'.`);
  }

  const total_overdue_amount = getNumberProperty(currData, 'total_overdue_amount');
  if (total_overdue_amount === null || !isFinite(total_overdue_amount) || total_overdue_amount < 0) {
    throw new FinanceServiceError(`total_overdue_amount invalide pour ${expectedCurrency}.`);
  }
  const total_overdue_count = getNumberProperty(currData, 'total_overdue_count');
  if (total_overdue_count === null || !isFinite(total_overdue_count) || total_overdue_count < 0 || !Number.isInteger(total_overdue_count)) {
    throw new FinanceServiceError(`total_overdue_count invalide pour ${expectedCurrency}.`);
  }

  const due_today_amount = getNumberProperty(currData, 'due_today_amount');
  if (due_today_amount === null || !isFinite(due_today_amount) || due_today_amount < 0) {
    throw new FinanceServiceError(`due_today_amount invalide pour ${expectedCurrency}.`);
  }
  const due_today_count = getNumberProperty(currData, 'due_today_count');
  if (due_today_count === null || !isFinite(due_today_count) || due_today_count < 0 || !Number.isInteger(due_today_count)) {
    throw new FinanceServiceError(`due_today_count invalide pour ${expectedCurrency}.`);
  }

  const upcoming_amount = getNumberProperty(currData, 'upcoming_amount');
  if (upcoming_amount === null || !isFinite(upcoming_amount) || upcoming_amount < 0) {
    throw new FinanceServiceError(`upcoming_amount invalide pour ${expectedCurrency}.`);
  }
  const upcoming_count = getNumberProperty(currData, 'upcoming_count');
  if (upcoming_count === null || !isFinite(upcoming_count) || upcoming_count < 0 || !Number.isInteger(upcoming_count)) {
    throw new FinanceServiceError(`upcoming_count invalide pour ${expectedCurrency}.`);
  }

  const bucketsRaw = currData['aging_buckets'];
  if (!isObject(bucketsRaw)) {
    throw new FinanceServiceError(`Propriété 'aging_buckets' manquante ou invalide pour ${expectedCurrency}.`);
  }

  const buckets: Record<AgingBucketKey, AgingBucketSummary> = {
    '1_30_days': validateAgingBucketSummary(bucketsRaw['1_30_days'], '1_30_days'),
    '31_60_days': validateAgingBucketSummary(bucketsRaw['31_60_days'], '31_60_days'),
    '61_90_days': validateAgingBucketSummary(bucketsRaw['61_90_days'], '61_90_days'),
    'over_90_days': validateAgingBucketSummary(bucketsRaw['over_90_days'], 'over_90_days')
  };

  return {
    currency: expectedCurrency,
    total_overdue_amount,
    total_overdue_count,
    due_today_amount,
    due_today_count,
    upcoming_amount,
    upcoming_count,
    aging_buckets: buckets
  };
}

export function validateAgingSummaryResponse(data: unknown): AgingSummaryResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour get_school_aging_summary (non-objet).');
  }

  const metaRaw = data['meta'];
  if (!isObject(metaRaw)) {
    throw new FinanceServiceError("Propriété 'meta' manquante ou invalide dans la synthèse de balance âgée.");
  }

  const school_id = getStringProperty(metaRaw, 'school_id');
  if (!school_id) {
    throw new FinanceServiceError("Propriété 'school_id' manquante dans meta.");
  }

  const school_timezone = getStringProperty(metaRaw, 'school_timezone');
  if (!school_timezone) {
    throw new FinanceServiceError("Propriété 'school_timezone' manquante dans meta.");
  }

  if (typeof metaRaw['timezone_fallback_applied'] !== 'boolean') {
    throw new FinanceServiceError("Propriété 'timezone_fallback_applied' manquante ou non booléenne dans meta.");
  }

  const evaluated_at_utc = getStringProperty(metaRaw, 'evaluated_at_utc');
  if (!evaluated_at_utc || isNaN(Date.parse(evaluated_at_utc))) {
    throw new FinanceServiceError("Propriété 'evaluated_at_utc' invalide ou non parseable.");
  }

  const business_date = getStringProperty(metaRaw, 'business_date');
  if (!business_date || !/^\d{4}-\d{2}-\d{2}$/.test(business_date) || isNaN(Date.parse(business_date))) {
    throw new FinanceServiceError("Propriété 'business_date' invalide ou format YYYY-MM-DD non respecté.");
  }

  const currenciesRaw = data['currencies'];
  if (!isObject(currenciesRaw)) {
    throw new FinanceServiceError("Propriété 'currencies' manquante ou invalide dans la synthèse.");
  }

  const usd = validateCurrencyAgingSummary(currenciesRaw['USD'], 'USD');
  const cdf = validateCurrencyAgingSummary(currenciesRaw['CDF'], 'CDF');

  return {
    meta: {
      school_id,
      school_timezone,
      timezone_fallback_applied: Boolean(metaRaw['timezone_fallback_applied']),
      evaluated_at_utc,
      business_date
    },
    currencies: {
      USD: usd,
      CDF: cdf
    }
  };
}

export function validateOverdueInvoicesResponse(data: unknown): OverdueInvoicesResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour get_school_overdue_invoices_admin (non-objet).');
  }

  const business_date = getStringProperty(data, 'business_date');
  if (!business_date || !/^\d{4}-\d{2}-\d{2}$/.test(business_date) || isNaN(Date.parse(business_date))) {
    throw new FinanceServiceError("Propriété 'business_date' invalide ou format YYYY-MM-DD non respecté dans la liste des créances.");
  }

  if (typeof data['has_more'] !== 'boolean') {
    throw new FinanceServiceError("Propriété 'has_more' manquante ou non booléenne.");
  }

  const itemsRaw = data['items'];
  if (!Array.isArray(itemsRaw)) {
    throw new FinanceServiceError("Propriété 'items' manquante ou non tableau.");
  }

  const validBuckets: AgingBucketKey[] = ['1_30_days', '31_60_days', '61_90_days', 'over_90_days'];

  const items = itemsRaw.map((item, index) => {
    if (!isObject(item)) {
      throw new FinanceServiceError(`Élément #${index} invalide dans la liste des créances (non-objet).`);
    }

    const invoice_id = getStringProperty(item, 'invoice_id');
    if (!invoice_id) throw new FinanceServiceError(`Élément #${index} : 'invoice_id' manquant.`);

    const invoice_number = getStringProperty(item, 'invoice_number');
    if (!invoice_number) throw new FinanceServiceError(`Élément #${index} : 'invoice_number' manquant.`);

    const student_id = getStringProperty(item, 'student_id');
    if (!student_id) throw new FinanceServiceError(`Élément #${index} : 'student_id' manquant.`);

    const student_name = getStringProperty(item, 'student_name') ?? '';
    const class_name = getStringProperty(item, 'class_name') ?? '';

    const due_date = getStringProperty(item, 'due_date');
    if (!due_date || !/^\d{4}-\d{2}-\d{2}$/.test(due_date) || isNaN(Date.parse(due_date)) || new Date(due_date).toISOString().substring(0, 10) !== due_date) {
      throw new FinanceServiceError(`Élément #${index} : 'due_date' invalide ou date calendrier impossible ('${due_date}').`);
    }

    const days_overdue = getNumberProperty(item, 'days_overdue');
    if (days_overdue === null || !isFinite(days_overdue) || days_overdue < 1 || !Number.isInteger(days_overdue)) {
      throw new FinanceServiceError(`Élément #${index} : 'days_overdue' invalide (doit être un entier >= 1).`);
    }

    const aging_bucket = getStringProperty(item, 'aging_bucket') as AgingBucketKey;
    if (!validBuckets.includes(aging_bucket)) {
      throw new FinanceServiceError(`Élément #${index} : 'aging_bucket' invalide ('${aging_bucket}').`);
    }

    const currency = getStringProperty(item, 'currency') as Currency;
    if (currency !== 'USD' && currency !== 'CDF') {
      throw new FinanceServiceError(`Élément #${index} : 'currency' invalide ('${currency}').`);
    }

    const total_amount = getNumberProperty(item, 'total_amount');
    if (total_amount === null || !isFinite(total_amount) || total_amount <= 0) {
      throw new FinanceServiceError(`Élément #${index} : 'total_amount' invalide ou non strictement positif.`);
    }

    const paid_amount = getNumberProperty(item, 'paid_amount');
    if (paid_amount === null || !isFinite(paid_amount) || paid_amount < 0 || paid_amount > total_amount) {
      throw new FinanceServiceError(`Élément #${index} : 'paid_amount' incohérent ou supérieur au total.`);
    }

    const remaining_balance = getNumberProperty(item, 'remaining_balance');
    if (remaining_balance === null || !isFinite(remaining_balance) || remaining_balance <= 0 || remaining_balance > total_amount) {
      throw new FinanceServiceError(`Élément #${index} : 'remaining_balance' incohérent ou supérieur au total.`);
    }

    const status = getStringProperty(item, 'status') as 'issued' | 'partially_paid';
    if (status !== 'issued' && status !== 'partially_paid') {
      throw new FinanceServiceError(`Élément #${index} : 'status' invalide pour une créance ('${status}').`);
    }

    return {
      invoice_id,
      invoice_number,
      student_id,
      student_name,
      class_name,
      due_date,
      days_overdue,
      aging_bucket,
      currency,
      total_amount,
      paid_amount,
      remaining_balance,
      status
    };
  });

  // Validation du curseur
  const nextCursorRaw = data['next_cursor'];
  let next_cursor: OverdueInvoicesCursor | null = null;

  if (nextCursorRaw !== null && nextCursorRaw !== undefined) {
    if (!isObject(nextCursorRaw)) {
      throw new FinanceServiceError("Propriété 'next_cursor' invalide (ni null ni objet).");
    }
    const cursorDueDate = getStringProperty(nextCursorRaw, 'due_date');
    const cursorId = getStringProperty(nextCursorRaw, 'id');

    if (!cursorDueDate || !cursorId) {
      throw new FinanceServiceError("Curseur partiel non autorisé : 'due_date' et 'id' doivent être tous les deux présents dans next_cursor.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cursorDueDate) || isNaN(Date.parse(cursorDueDate))) {
      throw new FinanceServiceError("Format YYYY-MM-DD invalide pour 'due_date' dans next_cursor.");
    }
    next_cursor = {
      due_date: cursorDueDate,
      id: cursorId
    };
  }

  if (data['has_more'] === true && !next_cursor) {
    throw new FinanceServiceError("Propriété next_cursor obligatoire lorsque has_more est vrai.");
  }

  if (data['has_more'] === false && next_cursor !== null) {
    throw new FinanceServiceError("next_cursor doit être null lorsque has_more est faux.");
  }

  return {
    business_date,
    items,
    has_more: Boolean(data['has_more']),
    next_cursor
  };
}

// ---------------------------------------------------------------------------
// METHODES APIS SUPABASE RPC POUR FINANCE 4A
// ---------------------------------------------------------------------------

export async function getSchoolAgingSummary(): Promise<AgingSummaryResponse> {
  try {
    const { data, error } = await supabase.rpc('get_school_aging_summary');
    if (error) {
      throw mapPostgresError(error);
    }
    return validateAgingSummaryResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function getSchoolOverdueInvoicesAdmin(
  filters?: OverdueInvoicesFilters,
  cursor?: OverdueInvoicesCursor | null
): Promise<OverdueInvoicesResponse> {
  const searchTrimmed = filters?.p_search ? filters.p_search.trim() : null;
  if (searchTrimmed && searchTrimmed.length > 100) {
    throw new FinanceServiceError('Le terme de recherche ne peut pas dépasser 100 caractères.', '22023');
  }

  const rpcParams = {
    p_currency: filters?.p_currency || null,
    p_aging_bucket: filters?.p_aging_bucket || null,
    p_search: searchTrimmed || null,
    p_limit: filters?.p_limit ?? 20,
    p_cursor_due_date: cursor?.due_date || null,
    p_cursor_id: cursor?.id || null
  };

  try {
    const { data, error } = await supabase.rpc('get_school_overdue_invoices_admin', rpcParams);
    if (error) {
      throw mapPostgresError(error);
    }
    return validateOverdueInvoicesResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}
