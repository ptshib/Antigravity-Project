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
  AgingBucketSummary,
  CollectionActionType,
  CollectionStatus,
  CollectionHistoryAction,
  CreateCollectionActionResponse,
  CollectionHistoryResponse,
  CollectionFollowupsCursor,
  CollectionFollowupsResponse,
  CollectionFollowupsFilters,
  CreateCollectionActionInput,
  CollectionPriorityLevel,
  CollectionDashboardCurrency,
  CollectionDashboardResponse,
  CollectionPriorityItem,
  CollectionPrioritiesCursor,
  CollectionPrioritiesResponse,
  CollectionPrioritiesFilters,
  CampaignChannel,
  CampaignStatus,
  CampaignRecipientStatus,
  CampaignDeliveryAttemptStatus,
  CampaignFilters,
  CampaignCursor,
  CampaignPreviewRecipient,
  PreviewCampaignInput,
  CampaignPreviewResponse,
  CreateCampaignInput,
  CollectionCampaignSummary,
  CollectionDeliveryAttempt,
  CollectionCampaignRecipient,
  CreateCampaignResponse,
  CollectionCampaignListResponse,
  CollectionCampaignDetailResponse,
  ScheduleCampaignResponse,
  CancelCampaignResponse,
  RealEmailReadinessBlocker,
  RealEmailReadinessResponse,
  RealEmailDeliveryDashboardResponse,
  RealEmailJobStatus,
  RealEmailDeliveryJobsCursor,
  RealEmailDeliveryJobsResponse,
  RealEmailCampaignSummary,
  CreateRealEmailCampaignRequest,
  CreateRealEmailCampaignResponse,
  ScheduleRealEmailCampaignRequest,
  ScheduleRealEmailCampaignResponse,
  CampaignPriority
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

function isValidCalendarDate(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  if (isNaN(Date.parse(dateStr))) return false;
  return new Date(dateStr).toISOString().substring(0, 10) === dateStr;
}

/**
 * Mappe les erreurs PostgreSQL vers des messages métier propres sans fuite d'implémentation (CONTEXT, HINT, contrainte, table).
 */
function mapPostgresError(error: unknown): Error {
  if (error instanceof FinanceServiceError) {
    return error;
  }
  if (!isObject(error)) {
    return new FinanceServiceError('Une erreur est survenue lors du traitement financier. Veuillez réessayer.');
  }

  const code = getStringProperty(error, 'code') || '';
  const msg = getStringProperty(error, 'message') || '';

  // 1. Accès non autorisé (SQLSTATE 42501)
  if (code === '42501' || msg.includes('42501') || msg.includes('non autorisée') || msg.includes('VIOLATION SÉCURITÉ') || msg.includes('REJET ACCÈS')) {
    return new FinanceServiceError(
      msg || 'Accès non autorisé : Vous ne disposez pas des privilèges nécessaires pour exécuter cette opération financière.',
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

  // Support both nested object format (RPC standard) and flat object format
  const studentObj = isObject(data['student']) ? data['student'] : null;
  const student_id = (studentObj ? getStringProperty(studentObj, 'id') : null) || getStringProperty(data, 'student_id');
  const student_number = (studentObj ? getStringProperty(studentObj, 'student_number') : null) || getStringProperty(data, 'student_number');
  const student_name = (studentObj ? (getStringProperty(studentObj, 'student_full_name') || getStringProperty(studentObj, 'student_name')) : null) || getStringProperty(data, 'student_name');
  const class_name = (studentObj ? getStringProperty(studentObj, 'class_name') : null) || getStringProperty(data, 'class_name') || '';

  // Extract totals from summary_by_currency, summary or flat properties
  const summaryObj = isObject(data['summary_by_currency'])
    ? data['summary_by_currency']
    : (isObject(data['summary']) ? data['summary'] : null);

  let currency: Currency = 'USD';
  let total_invoiced = 0;
  let total_paid = 0;
  let total_remaining = 0;

  if (summaryObj) {
    const currencies = Object.keys(summaryObj);
    if (currencies.length > 0) {
      const mainCurrency = currencies[0];
      const currSummary = summaryObj[mainCurrency];
      if (isObject(currSummary)) {
        currency = (getStringProperty(currSummary, 'currency') as Currency) || (mainCurrency as Currency) || 'USD';
        total_invoiced = getNumberProperty(currSummary, 'total_invoiced') ?? 0;
        total_paid = getNumberProperty(currSummary, 'total_paid') ?? 0;
        total_remaining = getNumberProperty(currSummary, 'total_remaining') ?? 0;
      }
    }
  } else {
    total_invoiced = getNumberProperty(data, 'total_invoiced') ?? 0;
    total_paid = getNumberProperty(data, 'total_paid') ?? 0;
    total_remaining = getNumberProperty(data, 'total_remaining') ?? 0;
    currency = (getStringProperty(data, 'currency') as Currency) || 'USD';
  }

  const rawInvoices = data['invoices'];

  if (
    !student_id ||
    !student_number ||
    !student_name ||
    !Array.isArray(rawInvoices)
  ) {
    throw new FinanceServiceError('Champs obligatoires manquants dans la réponse de get_parent_student_finances.');
  }

  const validatedInvoices = rawInvoices.map((inv: unknown) => {
    if (!isObject(inv)) throw new FinanceServiceError('Élément de facture invalide dans get_parent_student_finances.');

    let itemsSummary = getStringProperty(inv, 'items_summary') || '';
    if (!itemsSummary && Array.isArray(inv['items'])) {
      itemsSummary = (inv['items'] as any[])
        .map((item: any) => (isObject(item) ? getStringProperty(item, 'fee_name') : ''))
        .filter(Boolean)
        .join(', ');
    }

    return {
      id: getStringProperty(inv, 'id') || '',
      invoice_number: getStringProperty(inv, 'invoice_number') || '',
      issue_date: getStringProperty(inv, 'issue_date') || '',
      due_date: getStringProperty(inv, 'due_date'),
      total_amount: getNumberProperty(inv, 'total_amount') ?? 0,
      paid_amount: getNumberProperty(inv, 'paid_amount') ?? 0,
      remaining_balance: getNumberProperty(inv, 'remaining_balance') ?? 0,
      status: (getStringProperty(inv, 'status') as InvoiceStatus) || 'draft',
      currency: (getStringProperty(inv, 'currency') as Currency) || currency,
      items_summary: itemsSummary || 'Frais de scolarité'
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
    currency,
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

// ---------------------------------------------------------------------------
// VALIDATEURS ET SERVICES POUR FINANCE 4B (SUIVI DE RECOUVREMENT)
// ---------------------------------------------------------------------------

const VALID_ACTION_TYPES: CollectionActionType[] = ['phone', 'email', 'sms', 'whatsapp', 'meeting', 'note'];
const VALID_COLLECTION_STATUSES: CollectionStatus[] = [
  'never_contacted',
  'contacted',
  'promise_pending',
  'promise_overdue',
  'followup_due'
];

function validateCollectionActionItem(item: unknown, indexLabel: string): CollectionHistoryAction {
  if (!isObject(item)) {
    throw new FinanceServiceError(`Action ${indexLabel} invalide (non-objet).`);
  }

  const id = getStringProperty(item, 'id');
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new FinanceServiceError(`Action ${indexLabel} : 'id' manquant ou format UUID invalide.`);
  }

  const invoice_id = getStringProperty(item, 'invoice_id');
  if (!invoice_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice_id)) {
    throw new FinanceServiceError(`Action ${indexLabel} : 'invoice_id' manquant ou format UUID invalide.`);
  }

  const school_id = getStringProperty(item, 'school_id');
  if (!school_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(school_id)) {
    throw new FinanceServiceError(`Action ${indexLabel} : 'school_id' manquant ou format UUID invalide.`);
  }

  const action_type = getStringProperty(item, 'action_type') as CollectionActionType;
  if (!action_type || !VALID_ACTION_TYPES.includes(action_type)) {
    throw new FinanceServiceError(`Action ${indexLabel} : 'action_type' invalide ('${action_type}').`);
  }

  const note = getStringProperty(item, 'note');
  if (note === null || typeof note !== 'string') {
    throw new FinanceServiceError(`Action ${indexLabel} : 'note' manquante ou non-chaîne.`);
  }
  const noteTrimmed = note.trim();
  if (noteTrimmed.length < 5 || noteTrimmed.length > 1000) {
    throw new FinanceServiceError(`Action ${indexLabel} : 'note' doit contenir entre 5 et 1000 caractères après trim.`);
  }

  const idempotency_key = getStringProperty(item, 'idempotency_key');
  if (!idempotency_key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotency_key)) {
    throw new FinanceServiceError(`Action ${indexLabel} : 'idempotency_key' manquante ou format UUID invalide.`);
  }

  const contacted_at = getStringProperty(item, 'contacted_at');
  if (!contacted_at || isNaN(Date.parse(contacted_at))) {
    throw new FinanceServiceError(`Action ${indexLabel} : 'contacted_at' invalide ou non parseable.`);
  }

  const promise_to_pay_date = getStringProperty(item, 'promise_to_pay_date');
  if (promise_to_pay_date !== null && promise_to_pay_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(promise_to_pay_date) || isNaN(Date.parse(promise_to_pay_date))) {
      throw new FinanceServiceError(`Action ${indexLabel} : 'promise_to_pay_date' invalide (attendu YYYY-MM-DD).`);
    }
  }

  const next_follow_up_date = getStringProperty(item, 'next_follow_up_date');
  if (next_follow_up_date !== null && next_follow_up_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next_follow_up_date) || isNaN(Date.parse(next_follow_up_date))) {
      throw new FinanceServiceError(`Action ${indexLabel} : 'next_follow_up_date' invalide (attendu YYYY-MM-DD).`);
    }
  }

  const created_by = getStringProperty(item, 'created_by');
  if (!created_by) {
    throw new FinanceServiceError(`Action ${indexLabel} : 'created_by' manquant.`);
  }

  const created_by_name = getStringProperty(item, 'created_by_name') ?? '';

  const created_at = getStringProperty(item, 'created_at');
  if (!created_at || isNaN(Date.parse(created_at))) {
    throw new FinanceServiceError(`Action ${indexLabel} : 'created_at' invalide ou non parseable.`);
  }

  return {
    id,
    invoice_id,
    school_id,
    action_type,
    note: noteTrimmed,
    idempotency_key,
    contacted_at,
    promise_to_pay_date: promise_to_pay_date || null,
    next_follow_up_date: next_follow_up_date || null,
    created_by,
    created_by_name,
    created_at
  };
}

export function validateCreateCollectionActionResponse(data: unknown): CreateCollectionActionResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour create_invoice_collection_action (non-objet).');
  }

  if (typeof data['is_idempotent_replay'] !== 'boolean') {
    throw new FinanceServiceError("Propriété 'is_idempotent_replay' manquante ou non booléenne.");
  }

  const actionRaw = data['action'];
  const action = validateCollectionActionItem(actionRaw, 'action');

  return {
    is_idempotent_replay: Boolean(data['is_idempotent_replay']),
    action
  };
}

export function validateCollectionHistoryResponse(data: unknown): CollectionHistoryResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour get_invoice_collection_history (non-objet).');
  }

  const invoice_id = getStringProperty(data, 'invoice_id');
  if (!invoice_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice_id)) {
    throw new FinanceServiceError("Propriété 'invoice_id' manquante ou format UUID invalide.");
  }

  const total_actions = getNumberProperty(data, 'total_actions');
  if (total_actions === null || !isFinite(total_actions) || total_actions < 0 || !Number.isInteger(total_actions)) {
    throw new FinanceServiceError("Propriété 'total_actions' invalide (doit être un entier >= 0).");
  }

  const actionsRaw = data['actions'];
  if (!Array.isArray(actionsRaw)) {
    throw new FinanceServiceError("Propriété 'actions' manquante ou non tableau.");
  }

  const actions = actionsRaw.map((act, idx) => validateCollectionActionItem(act, `#${idx}`));

  return {
    invoice_id,
    total_actions,
    actions
  };
}

export function validateCollectionFollowupsResponse(data: unknown): CollectionFollowupsResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour get_school_collection_followups (non-objet).');
  }

  if (typeof data['has_more'] !== 'boolean') {
    throw new FinanceServiceError("Propriété 'has_more' manquante ou non booléenne.");
  }

  const itemsRaw = data['items'];
  if (!Array.isArray(itemsRaw)) {
    throw new FinanceServiceError("Propriété 'items' manquante ou non tableau.");
  }

  const items = itemsRaw.map((item, index) => {
    if (!isObject(item)) {
      throw new FinanceServiceError(`Élément #${index} invalide dans la liste des relances (non-objet).`);
    }

    const invoice_id = getStringProperty(item, 'invoice_id');
    if (!invoice_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice_id)) {
      throw new FinanceServiceError(`Élément #${index} : 'invoice_id' manquant ou UUID invalide.`);
    }

    const invoice_number = getStringProperty(item, 'invoice_number');
    if (!invoice_number) throw new FinanceServiceError(`Élément #${index} : 'invoice_number' manquant.`);

    const student_id = getStringProperty(item, 'student_id');
    if (!student_id) throw new FinanceServiceError(`Élément #${index} : 'student_id' manquant.`);

    const student_name = getStringProperty(item, 'student_name') ?? '';
    const student_number = getStringProperty(item, 'student_number') ?? '';
    const class_name = getStringProperty(item, 'class_name');

    const invoice_due_date = getStringProperty(item, 'invoice_due_date');
    if (!invoice_due_date || !/^\d{4}-\d{2}-\d{2}$/.test(invoice_due_date) || isNaN(Date.parse(invoice_due_date)) || new Date(invoice_due_date).toISOString().substring(0, 10) !== invoice_due_date) {
      throw new FinanceServiceError(`Élément #${index} : 'invoice_due_date' invalide ou date calendrier impossible ('${invoice_due_date}').`);
    }

    const days_overdue = getNumberProperty(item, 'days_overdue');
    if (days_overdue === null || !isFinite(days_overdue) || days_overdue < 0 || !Number.isInteger(days_overdue)) {
      throw new FinanceServiceError(`Élément #${index} : 'days_overdue' invalide (doit être un entier >= 0).`);
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
    if (remaining_balance === null || !isFinite(remaining_balance) || remaining_balance < 0 || remaining_balance > total_amount) {
      throw new FinanceServiceError(`Élément #${index} : 'remaining_balance' incohérent ou supérieur au total.`);
    }

    const invoice_status = getStringProperty(item, 'invoice_status') || '';

    const collection_status = getStringProperty(item, 'collection_status') as CollectionStatus;
    if (!collection_status || !VALID_COLLECTION_STATUSES.includes(collection_status)) {
      throw new FinanceServiceError(`Élément #${index} : 'collection_status' invalide ('${collection_status}').`);
    }

    const latest_action_id = getStringProperty(item, 'latest_action_id');
    const latest_action_type = getStringProperty(item, 'latest_action_type') as CollectionActionType | null;
    if (latest_action_type !== null && latest_action_type !== undefined && !VALID_ACTION_TYPES.includes(latest_action_type)) {
      throw new FinanceServiceError(`Élément #${index} : 'latest_action_type' invalide ('${latest_action_type}').`);
    }

    const latest_note = getStringProperty(item, 'latest_note');
    const latest_idempotency_key = getStringProperty(item, 'latest_idempotency_key');

    const latest_contacted_at = getStringProperty(item, 'latest_contacted_at');
    if (latest_contacted_at !== null && latest_contacted_at !== undefined && isNaN(Date.parse(latest_contacted_at))) {
      throw new FinanceServiceError(`Élément #${index} : 'latest_contacted_at' invalide.`);
    }

    const latest_promise_to_pay_date = getStringProperty(item, 'latest_promise_to_pay_date');
    if (latest_promise_to_pay_date !== null && latest_promise_to_pay_date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(latest_promise_to_pay_date) || isNaN(Date.parse(latest_promise_to_pay_date)))) {
      throw new FinanceServiceError(`Élément #${index} : 'latest_promise_to_pay_date' invalide.`);
    }

    const latest_next_follow_up_date = getStringProperty(item, 'latest_next_follow_up_date');
    if (latest_next_follow_up_date !== null && latest_next_follow_up_date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(latest_next_follow_up_date) || isNaN(Date.parse(latest_next_follow_up_date)))) {
      throw new FinanceServiceError(`Élément #${index} : 'latest_next_follow_up_date' invalide.`);
    }

    const last_contacted_by_name = getStringProperty(item, 'last_contacted_by_name');

    const effective_follow_up_date = getStringProperty(item, 'effective_follow_up_date');
    if (!effective_follow_up_date || !/^\d{4}-\d{2}-\d{2}$/.test(effective_follow_up_date) || isNaN(Date.parse(effective_follow_up_date))) {
      throw new FinanceServiceError(`Élément #${index} : 'effective_follow_up_date' invalide.`);
    }

    return {
      invoice_id,
      invoice_number,
      student_id,
      student_name,
      student_number,
      class_name: class_name || null,
      invoice_due_date,
      days_overdue,
      currency,
      total_amount,
      paid_amount,
      remaining_balance,
      invoice_status,
      collection_status,
      effective_follow_up_date,
      latest_action_id: latest_action_id || null,
      latest_action_type: latest_action_type || null,
      latest_note: latest_note || null,
      latest_idempotency_key: latest_idempotency_key || null,
      latest_contacted_at: latest_contacted_at || null,
      latest_promise_to_pay_date: latest_promise_to_pay_date || null,
      latest_next_follow_up_date: latest_next_follow_up_date || null,
      last_contacted_by_name: last_contacted_by_name || null
    };
  });

  const nextCursorRaw = data['next_cursor'];
  let next_cursor: CollectionFollowupsCursor | null = null;

  if (nextCursorRaw !== null && nextCursorRaw !== undefined) {
    if (!isObject(nextCursorRaw)) {
      throw new FinanceServiceError("Propriété 'next_cursor' invalide (ni null ni objet).");
    }
    const cursorEffectiveDate = getStringProperty(nextCursorRaw, 'effective_date');
    const cursorInvoiceId = getStringProperty(nextCursorRaw, 'invoice_id');

    if (!cursorEffectiveDate || !cursorInvoiceId) {
      throw new FinanceServiceError("Curseur partiel non autorisé : 'effective_date' et 'invoice_id' doivent être tous les deux présents dans next_cursor.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cursorEffectiveDate) || isNaN(Date.parse(cursorEffectiveDate))) {
      throw new FinanceServiceError("Format YYYY-MM-DD invalide pour 'effective_date' dans next_cursor.");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursorInvoiceId)) {
      throw new FinanceServiceError("Format UUID invalide pour 'invoice_id' dans next_cursor.");
    }

    next_cursor = {
      effective_date: cursorEffectiveDate,
      invoice_id: cursorInvoiceId
    };
  }

  if (data['has_more'] === true && !next_cursor) {
    throw new FinanceServiceError("Propriété next_cursor obligatoire lorsque has_more est vrai.");
  }

  if (data['has_more'] === false && next_cursor !== null) {
    throw new FinanceServiceError("next_cursor doit être null lorsque has_more est faux.");
  }

  return {
    items,
    has_more: Boolean(data['has_more']),
    next_cursor
  };
}

export async function createInvoiceCollectionAction(
  input: CreateCollectionActionInput
): Promise<CreateCollectionActionResponse> {
  if (!input.invoice_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.invoice_id)) {
    throw new FinanceServiceError('L’ID de la facture est obligatoire et doit être un UUID valide.', '22023');
  }

  if (!input.action_type || !VALID_ACTION_TYPES.includes(input.action_type)) {
    throw new FinanceServiceError(`Type d’action invalide : '${input.action_type}'.`, '22023');
  }

  const trimmedNote = (input.note || '').trim();
  if (trimmedNote.length < 5 || trimmedNote.length > 1000) {
    throw new FinanceServiceError('La note doit contenir entre 5 et 1000 caractères.', '22023');
  }

  if (!input.idempotency_key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.idempotency_key)) {
    throw new FinanceServiceError('La clé d’idempotence est obligatoire et doit être un UUID valide.', '22023');
  }

  if (input.promise_to_pay_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.promise_to_pay_date) || isNaN(Date.parse(input.promise_to_pay_date))) {
      throw new FinanceServiceError('La date de promesse doit être au format YYYY-MM-DD.', '22023');
    }
  }

  if (input.next_follow_up_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.next_follow_up_date) || isNaN(Date.parse(input.next_follow_up_date))) {
      throw new FinanceServiceError('La date de prochaine relance doit être au format YYYY-MM-DD.', '22023');
    }
  }

  const rpcParams = {
    p_invoice_id: input.invoice_id,
    p_action_type: input.action_type,
    p_note: trimmedNote,
    p_idempotency_key: input.idempotency_key,
    p_promise_to_pay_date: input.promise_to_pay_date || null,
    p_next_follow_up_date: input.next_follow_up_date || null
  };

  try {
    const { data, error } = await supabase.rpc('create_invoice_collection_action', rpcParams);
    if (error) {
      throw mapPostgresError(error);
    }
    return validateCreateCollectionActionResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function getInvoiceCollectionHistory(
  invoiceId: string
): Promise<CollectionHistoryResponse> {
  if (!invoiceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) {
    throw new FinanceServiceError('L’ID de la facture est obligatoire et doit être un UUID valide.', '22023');
  }

  try {
    const { data, error } = await supabase.rpc('get_invoice_collection_history', {
      p_invoice_id: invoiceId
    });
    if (error) {
      throw mapPostgresError(error);
    }
    return validateCollectionHistoryResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function getSchoolCollectionFollowups(
  filters?: CollectionFollowupsFilters,
  cursor?: CollectionFollowupsCursor | null
): Promise<CollectionFollowupsResponse> {
  let p_currency: 'USD' | 'CDF' | null = null;
  if (filters?.currency === 'USD' || filters?.currency === 'CDF') {
    p_currency = filters.currency;
  }

  let p_status_filter: CollectionStatus | null = null;
  if (filters?.status_filter && filters.status_filter !== 'ALL' && VALID_COLLECTION_STATUSES.includes(filters.status_filter as CollectionStatus)) {
    p_status_filter = filters.status_filter as CollectionStatus;
  }

  let p_limit = filters?.limit ?? 20;
  if (p_limit < 1 || p_limit > 100) {
    throw new FinanceServiceError('La limite de pagination p_limit doit être comprise entre 1 et 100.', '22023');
  }

  if (cursor) {
    if (!cursor.effective_date || !cursor.invoice_id) {
      throw new FinanceServiceError('Le curseur de relances doit contenir effective_date et invoice_id.', '22023');
    }
  }

  const rpcParams = {
    p_currency,
    p_status_filter,
    p_limit,
    p_cursor_effective_date: cursor?.effective_date || null,
    p_cursor_invoice_id: cursor?.invoice_id || null
  };

  try {
    const { data, error } = await supabase.rpc('get_school_collection_followups', rpcParams);
    if (error) {
      throw mapPostgresError(error);
    }
    return validateCollectionFollowupsResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

// ---------------------------------------------------------------------------
// VALIDATEURS ET MÉTHODES RPC POUR FINANCE 4C (PILOTAGE DU RECOUVREMENT)
// ---------------------------------------------------------------------------

const VALID_COLLECTION_PRIORITY_LEVELS: CollectionPriorityLevel[] = ['critical', 'high', 'normal'];

export function validateCollectionDashboardResponse(data: unknown): CollectionDashboardResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Réponse du tableau de bord de recouvrement invalide (non-objet).', '22023');
  }

  const metaObj = data.meta;
  if (!isObject(metaObj)) {
    throw new FinanceServiceError("Propriété 'meta' invalide ou manquante dans le tableau de bord.", '22023');
  }

  const school_id = metaObj.school_id;
  if (typeof school_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(school_id)) {
    throw new FinanceServiceError("Propriété 'meta.school_id' invalide (doit être un UUID valide).", '22023');
  }

  const school_timezone = metaObj.school_timezone;
  if (typeof school_timezone !== 'string' || !school_timezone.trim()) {
    throw new FinanceServiceError("Propriété 'meta.school_timezone' invalide (chaîne non vide requise).", '22023');
  }

  const timezone_fallback_applied = metaObj.timezone_fallback_applied;
  if (typeof timezone_fallback_applied !== 'boolean') {
    throw new FinanceServiceError("Propriété 'meta.timezone_fallback_applied' invalide (booléen requis).", '22023');
  }

  const evaluated_at_utc = metaObj.evaluated_at_utc;
  if (typeof evaluated_at_utc !== 'string' || isNaN(Date.parse(evaluated_at_utc))) {
    throw new FinanceServiceError("Propriété 'meta.evaluated_at_utc' invalide (horodatage UTC ISO valide requis).", '22023');
  }

  const business_date = metaObj.business_date;
  if (typeof business_date !== 'string' || !isValidCalendarDate(business_date)) {
    throw new FinanceServiceError("Propriété 'meta.business_date' invalide (date calendrier 'YYYY-MM-DD' requise).", '22023');
  }

  const currenciesObj = data.currencies;
  if (!isObject(currenciesObj)) {
    throw new FinanceServiceError("Propriété 'currencies' invalide ou manquante dans le tableau de bord.", '22023');
  }

  const validateCurrencyObj = (cObj: unknown, currName: 'USD' | 'CDF'): CollectionDashboardCurrency => {
    if (!isObject(cObj)) {
      throw new FinanceServiceError(`Données de synthèse ${currName} manquantes ou invalides.`, '22023');
    }

    if (cObj.currency !== currName) {
      throw new FinanceServiceError(`Propriété 'currency' incohérente pour ${currName} (reçu: '${cObj.currency}').`, '22023');
    }

    const validateNumber = (key: string, min = 0, integerOnly = false): number => {
      const val = cObj[key];
      if (typeof val !== 'number' || !Number.isFinite(val) || val < min || (integerOnly && !Number.isInteger(val))) {
        throw new FinanceServiceError(`Propriété '${key}' invalide pour la devise ${currName}.`, '22023');
      }
      return val;
    };

    const total_overdue_amount = validateNumber('total_overdue_amount', 0);
    const total_overdue_count = validateNumber('total_overdue_count', 0, true);
    const never_contacted_amount = validateNumber('never_contacted_amount', 0);
    const never_contacted_count = validateNumber('never_contacted_count', 0, true);
    const followup_due_count = validateNumber('followup_due_count', 0, true);
    const promise_pending_amount = validateNumber('promise_pending_amount', 0);
    const promise_pending_count = validateNumber('promise_pending_count', 0, true);
    const promise_overdue_amount = validateNumber('promise_overdue_amount', 0);
    const promise_overdue_count = validateNumber('promise_overdue_count', 0, true);
    const actions_last_7_days_count = validateNumber('actions_last_7_days_count', 0, true);
    const actions_last_30_days_count = validateNumber('actions_last_30_days_count', 0, true);
    const collection_coverage_rate = validateNumber('collection_coverage_rate', 0);
    if (collection_coverage_rate > 100) {
      throw new FinanceServiceError(`Propriété 'collection_coverage_rate' invalide pour ${currName} (doit être <= 100).`, '22023');
    }
    const average_overdue_days = validateNumber('average_overdue_days', 0, true);
    const critical_priority_count = validateNumber('critical_priority_count', 0, true);
    const high_priority_count = validateNumber('high_priority_count', 0, true);

    return {
      currency: currName,
      total_overdue_amount,
      total_overdue_count,
      never_contacted_amount,
      never_contacted_count,
      followup_due_count,
      promise_pending_amount,
      promise_pending_count,
      promise_overdue_amount,
      promise_overdue_count,
      actions_last_7_days_count,
      actions_last_30_days_count,
      collection_coverage_rate,
      average_overdue_days,
      critical_priority_count,
      high_priority_count
    };
  };

  const usdCurrency = validateCurrencyObj(currenciesObj.USD, 'USD');
  const cdfCurrency = validateCurrencyObj(currenciesObj.CDF, 'CDF');

  return {
    meta: {
      school_id,
      school_timezone,
      timezone_fallback_applied,
      evaluated_at_utc,
      business_date
    },
    currencies: {
      USD: usdCurrency,
      CDF: cdfCurrency
    }
  };
}

export function validateCollectionPrioritiesResponse(data: unknown): CollectionPrioritiesResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Réponse des priorités de recouvrement invalide (non-objet).', '22023');
  }

  const business_date = data.business_date;
  if (typeof business_date !== 'string' || !isValidCalendarDate(business_date)) {
    throw new FinanceServiceError("Propriété 'business_date' invalide ou manquante dans la liste des priorités.", '22023');
  }

  if (!Array.isArray(data.items)) {
    throw new FinanceServiceError("Propriété 'items' invalide dans la liste des priorités (tableau requis).", '22023');
  }

  const items: CollectionPriorityItem[] = data.items.map((item, idx) => {
    if (!isObject(item)) {
      throw new FinanceServiceError(`Élément #${idx} de la liste des priorités non-objet.`, '22023');
    }

    const keys = Object.keys(item);
    if (keys.length !== 24) {
      throw new FinanceServiceError(`Élément #${idx} de la liste des priorités contient ${keys.length} clés au lieu des 24 clés SQL exactes.`, '22023');
    }

    const invoice_id = item.invoice_id;
    if (typeof invoice_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice_id)) {
      throw new FinanceServiceError(`Élément #${idx} : invoice_id invalide ou manquant.`, '22023');
    }

    const invoice_number = item.invoice_number;
    if (typeof invoice_number !== 'string' || !invoice_number.trim()) {
      throw new FinanceServiceError(`Élément #${idx} : invoice_number invalide.`, '22023');
    }

    const student_id = item.student_id;
    if (typeof student_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(student_id)) {
      throw new FinanceServiceError(`Élément #${idx} : student_id invalide.`, '22023');
    }

    const student_name = item.student_name;
    if (typeof student_name !== 'string' || !student_name.trim()) {
      throw new FinanceServiceError(`Élément #${idx} : student_name invalide.`, '22023');
    }

    const student_number = item.student_number;
    if (typeof student_number !== 'string' || !student_number.trim()) {
      throw new FinanceServiceError(`Élément #${idx} : student_number invalide.`, '22023');
    }

    const class_name = item.class_name;
    if (class_name !== null && (typeof class_name !== 'string' || !class_name.trim())) {
      throw new FinanceServiceError(`Élément #${idx} : class_name invalide.`, '22023');
    }

    const invoice_due_date = item.invoice_due_date;
    if (typeof invoice_due_date !== 'string' || !isValidCalendarDate(invoice_due_date)) {
      throw new FinanceServiceError(`Élément #${idx} : invoice_due_date invalide ou date calendrier impossible.`, '22023');
    }

    const days_overdue = item.days_overdue;
    if (typeof days_overdue !== 'number' || !Number.isInteger(days_overdue) || days_overdue < 1) {
      throw new FinanceServiceError(`Élément #${idx} : days_overdue invalide (doit être un entier >= 1).`, '22023');
    }

    const currency = item.currency;
    if (currency !== 'USD' && currency !== 'CDF') {
      throw new FinanceServiceError(`Élément #${idx} : currency invalide (reçu: ${currency}).`, '22023');
    }

    const total_amount = item.total_amount;
    if (typeof total_amount !== 'number' || !Number.isFinite(total_amount) || total_amount <= 0) {
      throw new FinanceServiceError(`Élément #${idx} : total_amount invalide (doit être > 0).`, '22023');
    }

    const paid_amount = item.paid_amount;
    if (typeof paid_amount !== 'number' || !Number.isFinite(paid_amount) || paid_amount < 0 || paid_amount > total_amount) {
      throw new FinanceServiceError(`Élément #${idx} : paid_amount invalide (doit être >= 0 et <= total_amount).`, '22023');
    }

    const remaining_balance = item.remaining_balance;
    if (typeof remaining_balance !== 'number' || !Number.isFinite(remaining_balance) || remaining_balance <= 0) {
      throw new FinanceServiceError(`Élément #${idx} : remaining_balance invalide (doit être > 0).`, '22023');
    }

    const invoice_status = item.invoice_status;
    if (invoice_status !== 'issued' && invoice_status !== 'partially_paid') {
      throw new FinanceServiceError(`Élément #${idx} : invoice_status invalide (doit être 'issued' ou 'partially_paid').`, '22023');
    }

    const collection_status = item.collection_status;
    if (typeof collection_status !== 'string' || !VALID_COLLECTION_STATUSES.includes(collection_status as CollectionStatus)) {
      throw new FinanceServiceError(`Élément #${idx} : collection_status invalide (reçu: ${collection_status}).`, '22023');
    }

    const priority_level = item.priority_level;
    if (typeof priority_level !== 'string' || !VALID_COLLECTION_PRIORITY_LEVELS.includes(priority_level as CollectionPriorityLevel)) {
      throw new FinanceServiceError(`Élément #${idx} : priority_level invalide (reçu: ${priority_level}).`, '22023');
    }

    const priority_score = item.priority_score;
    if (typeof priority_score !== 'number' || !Number.isInteger(priority_score) || priority_score < 0) {
      throw new FinanceServiceError(`Élément #${idx} : priority_score invalide (doit être un entier >= 0).`, '22023');
    }

    const priority_reasons = item.priority_reasons;
    if (!Array.isArray(priority_reasons) || !priority_reasons.every(r => typeof r === 'string' && r.length > 0)) {
      throw new FinanceServiceError(`Élément #${idx} : priority_reasons invalide (tableau de chaînes non vides requis).`, '22023');
    }

    const effective_follow_up_date = item.effective_follow_up_date;
    if (typeof effective_follow_up_date !== 'string' || !isValidCalendarDate(effective_follow_up_date)) {
      throw new FinanceServiceError(`Élément #${idx} : effective_follow_up_date invalide.`, '22023');
    }

    const latest_action_id = item.latest_action_id;
    if (latest_action_id !== null && (typeof latest_action_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(latest_action_id))) {
      throw new FinanceServiceError(`Élément #${idx} : latest_action_id invalide.`, '22023');
    }

    const latest_action_type = item.latest_action_type;
    if (latest_action_type !== null && (typeof latest_action_type !== 'string' || !VALID_ACTION_TYPES.includes(latest_action_type as CollectionActionType))) {
      throw new FinanceServiceError(`Élément #${idx} : latest_action_type invalide.`, '22023');
    }

    const latest_contacted_at = item.latest_contacted_at;
    if (latest_contacted_at !== null && (typeof latest_contacted_at !== 'string' || isNaN(Date.parse(latest_contacted_at)))) {
      throw new FinanceServiceError(`Élément #${idx} : latest_contacted_at invalide.`, '22023');
    }

    const latest_promise_to_pay_date = item.latest_promise_to_pay_date;
    if (latest_promise_to_pay_date !== null && (typeof latest_promise_to_pay_date !== 'string' || !isValidCalendarDate(latest_promise_to_pay_date))) {
      throw new FinanceServiceError(`Élément #${idx} : latest_promise_to_pay_date invalide.`, '22023');
    }

    const latest_next_follow_up_date = item.latest_next_follow_up_date;
    if (latest_next_follow_up_date !== null && (typeof latest_next_follow_up_date !== 'string' || !isValidCalendarDate(latest_next_follow_up_date))) {
      throw new FinanceServiceError(`Élément #${idx} : latest_next_follow_up_date invalide.`, '22023');
    }

    const last_contacted_by_name = item.last_contacted_by_name;
    if (last_contacted_by_name !== null && typeof last_contacted_by_name !== 'string') {
      throw new FinanceServiceError(`Élément #${idx} : last_contacted_by_name invalide.`, '22023');
    }

    return {
      invoice_id,
      invoice_number,
      student_id,
      student_name,
      student_number,
      class_name,
      invoice_due_date,
      days_overdue,
      currency: currency as Currency,
      total_amount,
      paid_amount,
      remaining_balance,
      invoice_status: invoice_status as 'issued' | 'partially_paid',
      collection_status: collection_status as CollectionStatus,
      priority_level: priority_level as CollectionPriorityLevel,
      priority_score,
      priority_reasons: priority_reasons as string[],
      effective_follow_up_date,
      latest_action_id,
      latest_action_type: latest_action_type as CollectionActionType | null,
      latest_contacted_at,
      latest_promise_to_pay_date,
      latest_next_follow_up_date,
      last_contacted_by_name
    };
  });

  const has_more = data.has_more;
  if (typeof has_more !== 'boolean') {
    throw new FinanceServiceError("Propriété 'has_more' invalide dans la liste des priorités (booléen requis).", '22023');
  }

  let next_cursor: CollectionPrioritiesCursor | null = null;
  if (has_more) {
    if (!isObject(data.next_cursor)) {
      throw new FinanceServiceError("Curseur de pagination 'next_cursor' manquant alors que has_more = true.", '22023');
    }

    const priority_score = data.next_cursor.priority_score;
    if (typeof priority_score !== 'number' || !Number.isInteger(priority_score) || priority_score < 0) {
      throw new FinanceServiceError("Curseur invalide : 'priority_score' doit être un entier >= 0.", '22023');
    }

    const effective_date = data.next_cursor.effective_date;
    if (typeof effective_date !== 'string' || !isValidCalendarDate(effective_date)) {
      throw new FinanceServiceError("Curseur invalide : 'effective_date' doit être une date calendrier valide.", '22023');
    }

    const invoice_id = data.next_cursor.invoice_id;
    if (typeof invoice_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice_id)) {
      throw new FinanceServiceError("Curseur invalide : 'invoice_id' doit être un UUID valide.", '22023');
    }

    next_cursor = { priority_score, effective_date, invoice_id };
  } else {
    if (data.next_cursor !== null) {
      throw new FinanceServiceError("Curseur 'next_cursor' doit être null lorsque has_more = false.", '22023');
    }
  }

  return {
    business_date,
    items,
    has_more,
    next_cursor
  };
}

export async function getSchoolCollectionDashboard(): Promise<CollectionDashboardResponse> {
  try {
    const { data, error } = await supabase.rpc('get_school_collection_dashboard');
    if (error) {
      throw mapPostgresError(error);
    }
    return validateCollectionDashboardResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function getSchoolCollectionPriorities(
  filters?: CollectionPrioritiesFilters,
  cursor?: CollectionPrioritiesCursor | null
): Promise<CollectionPrioritiesResponse> {
  let p_currency: 'USD' | 'CDF' | null = null;
  if (filters?.p_currency === 'USD' || filters?.p_currency === 'CDF') {
    p_currency = filters.p_currency;
  }

  let p_priority_filter: CollectionPriorityLevel | 'all' | null = null;
  if (filters?.p_priority_filter && filters.p_priority_filter !== 'all' && VALID_COLLECTION_PRIORITY_LEVELS.includes(filters.p_priority_filter as CollectionPriorityLevel)) {
    p_priority_filter = filters.p_priority_filter as CollectionPriorityLevel;
  } else if (filters?.p_priority_filter === 'all') {
    p_priority_filter = 'all';
  }

  let p_limit = filters?.p_limit ?? 20;
  if (p_limit < 1 || p_limit > 100) {
    throw new FinanceServiceError('La limite de pagination p_limit doit être comprise entre 1 et 100.', '22023');
  }

  if (cursor) {
    if (cursor.priority_score === undefined || cursor.priority_score === null || !cursor.effective_date || !cursor.invoice_id) {
      throw new FinanceServiceError('Le curseur de priorités doit contenir priority_score, effective_date et invoice_id tous les trois.', '22023');
    }
    if (typeof cursor.priority_score !== 'number' || cursor.priority_score < 0) {
      throw new FinanceServiceError('Le score du curseur doit être un entier >= 0.', '22023');
    }
  }

  const rpcParams = {
    p_currency,
    p_priority_filter,
    p_limit,
    p_cursor_priority_score: cursor ? cursor.priority_score : null,
    p_cursor_effective_date: cursor ? cursor.effective_date : null,
    p_cursor_invoice_id: cursor ? cursor.invoice_id : null
  };

  try {
    const { data, error } = await supabase.rpc('get_school_collection_priorities', rpcParams);
    if (error) {
      throw mapPostgresError(error);
    }
    return validateCollectionPrioritiesResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

// ---------------------------------------------------------------------------
// VALIDATEURS ET FONCTIONS SERVICE STRICTES POUR FINANCE 4D (CAMPAGNES MOCK)
// ---------------------------------------------------------------------------

const VALID_CAMPAIGN_CHANNELS: CampaignChannel[] = ['sms', 'email', 'whatsapp'];
const VALID_CAMPAIGN_STATUSES: CampaignStatus[] = [
  'draft',
  'scheduled',
  'processing',
  'completed',
  'partially_failed',
  'failed',
  'cancelled'
];
const VALID_RECIPIENT_STATUSES: CampaignRecipientStatus[] = [
  'pending',
  'processing',
  'success',
  'failed',
  'skipped'
];
const VALID_ATTEMPT_STATUSES: CampaignDeliveryAttemptStatus[] = ['success', 'failed'];

export function validateCollectionCampaignSummary(data: unknown): CollectionCampaignSummary {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour la campagne (non-objet).');
  }

  const id = getStringProperty(data, 'id');
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new FinanceServiceError('Propriété "id" invalide ou absente (UUID attendu).');
  }

  const school_id = getStringProperty(data, 'school_id');
  if (!school_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(school_id)) {
    throw new FinanceServiceError('Propriété "school_id" invalide ou absente.');
  }

  const name = getStringProperty(data, 'name');
  if (!name || name.trim() === '') {
    throw new FinanceServiceError('Propriété "name" invalide ou vide.');
  }

  const channel = getStringProperty(data, 'channel') as CampaignChannel;
  if (!channel || !VALID_CAMPAIGN_CHANNELS.includes(channel)) {
    throw new FinanceServiceError('Propriété "channel" invalide (sms, email, whatsapp attendu).');
  }

  const status = getStringProperty(data, 'status') as CampaignStatus;
  if (!status || !VALID_CAMPAIGN_STATUSES.includes(status)) {
    throw new FinanceServiceError('Propriété "status" invalide pour la campagne.');
  }

  const recipient_count = getNumberProperty(data, 'recipient_count') ?? 0;
  const pending_count = getNumberProperty(data, 'pending_count') ?? 0;
  const processing_count = getNumberProperty(data, 'processing_count') ?? 0;
  const success_count = getNumberProperty(data, 'success_count') ?? 0;
  const failed_count = getNumberProperty(data, 'failed_count') ?? 0;
  const skipped_count = getNumberProperty(data, 'skipped_count') ?? 0;

  if (
    recipient_count < 0 ||
    pending_count < 0 ||
    processing_count < 0 ||
    success_count < 0 ||
    failed_count < 0 ||
    skipped_count < 0
  ) {
    throw new FinanceServiceError('Les compteurs de destinataires doivent être des entiers >= 0.');
  }

  if (recipient_count !== pending_count + processing_count + success_count + failed_count + skipped_count) {
    throw new FinanceServiceError('Invariant des compteurs de campagne violé.');
  }

  const created_by = getStringProperty(data, 'created_by') || '';
  const idempotency_key = getStringProperty(data, 'idempotency_key') || '';
  const created_at = getStringProperty(data, 'created_at') || '';
  const updated_at = getStringProperty(data, 'updated_at') || '';

  return {
    id,
    school_id,
    name,
    channel,
    status,
    scheduled_at: getStringProperty(data, 'scheduled_at'),
    claimed_at: getStringProperty(data, 'claimed_at'),
    claimed_by: getStringProperty(data, 'claimed_by'),
    processing_started_at: getStringProperty(data, 'processing_started_at'),
    completed_at: getStringProperty(data, 'completed_at'),
    created_by,
    idempotency_key,
    filter_criteria: isObject(data['filter_criteria']) ? data['filter_criteria'] : {},
    template_snapshot: isObject(data['template_snapshot']) ? data['template_snapshot'] : {},
    recipient_count,
    pending_count,
    processing_count,
    success_count,
    failed_count,
    skipped_count,
    created_at,
    updated_at
  };
}

export function validateCollectionDeliveryAttempt(data: unknown): CollectionDeliveryAttempt {
  if (!isObject(data)) {
    throw new FinanceServiceError('Tentative de livraison invalide (non-objet).');
  }

  const id = getStringProperty(data, 'id') || '';
  const attempt_number = getNumberProperty(data, 'attempt_number') ?? 1;
  const provider = getStringProperty(data, 'provider') || 'mock';
  const status = getStringProperty(data, 'status') as CampaignDeliveryAttemptStatus;
  if (!status || !VALID_ATTEMPT_STATUSES.includes(status)) {
    throw new FinanceServiceError('Statut de tentative de livraison invalide.');
  }

  return {
    id,
    attempt_number,
    provider,
    provider_message_id: getStringProperty(data, 'provider_message_id'),
    status,
    error_code: getStringProperty(data, 'error_code'),
    error_message: getStringProperty(data, 'error_message'),
    attempted_at: getStringProperty(data, 'attempted_at') || new Date().toISOString()
  };
}

export function validateCollectionCampaignRecipient(data: unknown): CollectionCampaignRecipient {
  if (!isObject(data)) {
    throw new FinanceServiceError('Destinataire invalide (non-objet).');
  }

  const id = getStringProperty(data, 'id') || '';
  const campaign_id = getStringProperty(data, 'campaign_id') || '';
  const invoice_id = getStringProperty(data, 'invoice_id') || '';
  const student_id = getStringProperty(data, 'student_id') || '';
  const parent_profile_id = getStringProperty(data, 'parent_profile_id') || '';
  const delivery_status = getStringProperty(data, 'delivery_status') as CampaignRecipientStatus;

  if (!delivery_status || !VALID_RECIPIENT_STATUSES.includes(delivery_status)) {
    throw new FinanceServiceError('Statut de livraison du destinataire invalide.');
  }

  const latest_attempt_raw = data['latest_attempt'];
  const latest_attempt = isObject(latest_attempt_raw) ? validateCollectionDeliveryAttempt(latest_attempt_raw) : null;

  return {
    id,
    campaign_id,
    invoice_id,
    student_id,
    parent_profile_id,
    delivery_status,
    skip_reason: getStringProperty(data, 'skip_reason'),
    invoice_snapshot: isObject(data['invoice_snapshot']) ? data['invoice_snapshot'] : {},
    student_snapshot: isObject(data['student_snapshot']) ? data['student_snapshot'] : {},
    parent_snapshot: isObject(data['parent_snapshot']) ? data['parent_snapshot'] : {},
    attempt_count: getNumberProperty(data, 'attempt_count') ?? 0,
    last_attempt_at: getStringProperty(data, 'last_attempt_at'),
    delivered_at: getStringProperty(data, 'delivered_at'),
    failed_at: getStringProperty(data, 'failed_at'),
    latest_attempt
  };
}

export function validateCampaignPreviewResponse(data: unknown): CampaignPreviewResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour preview_school_collection_campaign.');
  }

  if (data['success'] !== true) {
    throw new FinanceServiceError('La prévisualisation de la campagne a échoué côté serveur.');
  }

  if ('targeted_invoices' in data || 'sample_recipients' in data || 'eligible_recipients' in data || 'skipped_recipients' in data) {
    throw new FinanceServiceError('Propriété obsolète ou incorrecte détectée dans la réponse de prévisualisation (target_invoices_count, preview_recipients, total_eligible_recipients, total_skipped_recipients attendus).');
  }

  const channel = getStringProperty(data, 'channel') as CampaignChannel;
  if (!channel || !VALID_CAMPAIGN_CHANNELS.includes(channel)) {
    throw new FinanceServiceError('Canal invalide dans la prévisualisation.');
  }

  const currency_raw = getStringProperty(data, 'currency');
  const currency = (currency_raw === 'USD' || currency_raw === 'CDF') ? currency_raw : null;

  const target_invoices_count = getNumberProperty(data, 'target_invoices_count') ?? 0;
  const total_eligible_recipients = getNumberProperty(data, 'total_eligible_recipients') ?? 0;
  const total_skipped_recipients = getNumberProperty(data, 'total_skipped_recipients') ?? 0;
  const total_overdue_amount = getNumberProperty(data, 'total_overdue_amount') ?? 0;

  const rawRecipients = Array.isArray(data['preview_recipients']) ? data['preview_recipients'] : [];
  const preview_recipients: CampaignPreviewRecipient[] = rawRecipients.map((rec) => {
    if (!isObject(rec)) throw new FinanceServiceError('Destinataire de prévisualisation invalide.');
    const is_eligible = Boolean(rec['is_eligible']);
    const rawContact = getStringProperty(rec, 'channel_contact');
    const channel_contact = (rawContact && rawContact.trim() !== '') ? rawContact.trim() : null;
    const skip_reason = getStringProperty(rec, 'skip_reason');

    if (is_eligible) {
      if (!channel_contact) {
        throw new FinanceServiceError('Rejet : Destinataire admissible sans channel_contact.');
      }
      if (skip_reason !== null) {
        throw new FinanceServiceError('Rejet : Destinataire admissible avec skip_reason non-null.');
      }
    } else {
      if (channel_contact !== null) {
        throw new FinanceServiceError('Rejet : Destinataire skipped avec channel_contact non-null.');
      }
      if (!skip_reason) {
        throw new FinanceServiceError('Rejet : Destinataire skipped avec skip_reason null.');
      }
    }

    return {
      invoice_id: getStringProperty(rec, 'invoice_id') || '',
      invoice_number: getStringProperty(rec, 'invoice_number') || '',
      student_id: getStringProperty(rec, 'student_id') || '',
      student_name: getStringProperty(rec, 'student_name') || '',
      parent_profile_id: getStringProperty(rec, 'parent_profile_id') || '',
      parent_name: getStringProperty(rec, 'parent_name') || '',
      channel_contact,
      remaining_balance: getNumberProperty(rec, 'remaining_balance') ?? 0,
      currency: (getStringProperty(rec, 'currency') as Currency) || 'USD',
      days_overdue: getNumberProperty(rec, 'days_overdue') ?? 0,
      is_eligible,
      skip_reason
    };
  });

  return {
    success: true,
    channel,
    currency,
    target_invoices_count,
    total_eligible_recipients,
    total_skipped_recipients,
    total_overdue_amount,
    preview_recipients
  };
}

export function validateCreateCampaignResponse(data: unknown): CreateCampaignResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour create_school_collection_campaign.');
  }

  if (data['success'] !== true) {
    throw new FinanceServiceError('La création de la campagne a échoué côté serveur.');
  }

  if ('campaign_id' in data && !('campaign' in data)) {
    throw new FinanceServiceError('Propriété obsolète "campaign_id" à la racine de la réponse de création (objet "campaign" attendu).');
  }

  const campaign = validateCollectionCampaignSummary(data['campaign']);
  const rawRecipients = Array.isArray(data['recipients']) ? data['recipients'] : [];
  const recipients = rawRecipients.map(validateCollectionCampaignRecipient);
  const recipients_has_more = Boolean(data['recipients_has_more']);
  const next_cursor_recipient_id = getStringProperty(data, 'next_cursor_recipient_id');

  if (recipients_has_more && !next_cursor_recipient_id) {
    throw new FinanceServiceError('Incohérence curseur : recipients_has_more = true mais next_cursor_recipient_id est null.');
  }
  if (!recipients_has_more && next_cursor_recipient_id) {
    throw new FinanceServiceError('Incohérence curseur : recipients_has_more = false mais next_cursor_recipient_id est défini.');
  }

  return {
    success: true,
    campaign,
    recipients,
    recipients_has_more,
    next_cursor_recipient_id,
    is_idempotent_replay: Boolean(data['is_idempotent_replay'])
  };
}

export function validateCollectionCampaignListResponse(data: unknown): CollectionCampaignListResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour get_school_collection_campaigns.');
  }

  if (data['success'] !== true) {
    throw new FinanceServiceError('La récupération des campagnes a échoué.');
  }

  if ('items' in data || 'next_cursor' in data) {
    throw new FinanceServiceError('Propriété obsolète ou incorrecte ("items" ou "next_cursor") détectée dans la liste des campagnes.');
  }

  if (!Array.isArray(data['campaigns'])) {
    throw new FinanceServiceError('Propriété "campaigns" invalide ou absente (tableau attendu).');
  }

  const rawCampaigns = data['campaigns'];
  const campaigns = rawCampaigns.map(validateCollectionCampaignSummary);
  const has_more = Boolean(data['has_more']);
  const next_cursor_created_at = getStringProperty(data, 'next_cursor_created_at');
  const next_cursor_id = getStringProperty(data, 'next_cursor_id');

  if (has_more && (!next_cursor_created_at || !next_cursor_id)) {
    throw new FinanceServiceError('Incohérence curseur : has_more = true mais le curseur est incomplet.');
  }
  if (!has_more && (next_cursor_created_at || next_cursor_id)) {
    throw new FinanceServiceError('Incohérence curseur : has_more = false mais le curseur est non-null.');
  }

  return {
    success: true,
    campaigns,
    has_more,
    next_cursor_created_at,
    next_cursor_id
  };
}

export function validateCollectionCampaignDetailResponse(data: unknown): CollectionCampaignDetailResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour get_school_collection_campaign.');
  }

  if (data['success'] !== true) {
    throw new FinanceServiceError('La récupération du détail de la campagne a échoué.');
  }

  if (!('campaign' in data) && 'campaign_id' in data) {
    throw new FinanceServiceError('Propriété obsolète "campaign_id" à la racine de la réponse détaillée (objet "campaign" attendu).');
  }

  if (!Array.isArray(data['recipients'])) {
    throw new FinanceServiceError('Propriété "recipients" invalide ou absente (tableau attendu).');
  }

  const campaign = validateCollectionCampaignSummary(data['campaign']);
  const rawRecipients = Array.isArray(data['recipients']) ? data['recipients'] : [];
  const recipients = rawRecipients.map(validateCollectionCampaignRecipient);
  const recipients_has_more = Boolean(data['recipients_has_more']);
  const next_cursor_recipient_id = getStringProperty(data, 'next_cursor_recipient_id');

  if (recipients_has_more && !next_cursor_recipient_id) {
    throw new FinanceServiceError('Incohérence curseur destinataires : recipients_has_more = true sans next_cursor_recipient_id.');
  }
  if (!recipients_has_more && next_cursor_recipient_id) {
    throw new FinanceServiceError('Incohérence curseur destinataires : recipients_has_more = false avec next_cursor_recipient_id.');
  }

  return {
    success: true,
    campaign,
    recipients,
    recipients_has_more,
    next_cursor_recipient_id
  };
}

export function validateScheduleCampaignResponse(data: unknown): ScheduleCampaignResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour schedule_school_collection_campaign.');
  }

  if (data['success'] !== true) {
    throw new FinanceServiceError('La planification de la campagne a échoué.');
  }

  if ('campaign' in data && !('campaign_id' in data)) {
    throw new FinanceServiceError('Propriété obsolète "campaign" à la racine de la réponse de planification ("campaign_id" string attendu).');
  }

  const campaign_id = getStringProperty(data, 'campaign_id') || '';
  const scheduled_at = getStringProperty(data, 'scheduled_at') || '';

  return {
    success: true,
    campaign_id,
    status: 'scheduled',
    scheduled_at
  };
}

export function validateCancelCampaignResponse(data: unknown): CancelCampaignResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour cancel_school_collection_campaign.');
  }

  if (data['success'] !== true) {
    throw new FinanceServiceError('L annulation de la campagne a échoué.');
  }

  if ('cancelled_at' in data && !('cancelled_pending_count' in data)) {
    throw new FinanceServiceError('Propriété obsolète "cancelled_at" détectée dans la réponse d annulation ("cancelled_pending_count" attendu).');
  }

  const campaign_id = getStringProperty(data, 'campaign_id') || '';
  const cancelled_pending_count = getNumberProperty(data, 'cancelled_pending_count') ?? 0;

  return {
    success: true,
    campaign_id,
    status: 'cancelled',
    cancelled_pending_count
  };
}

// ---------------------------------------------------------------------------
// FONCTIONS SERVICE RPC POUR FINANCE 4D
// ---------------------------------------------------------------------------

export async function previewCollectionCampaign(
  input: PreviewCampaignInput
): Promise<CampaignPreviewResponse> {
  if (!input.p_channel || !VALID_CAMPAIGN_CHANNELS.includes(input.p_channel)) {
    throw new FinanceServiceError('Canal de campagne invalide.', '22023');
  }

  if (!input.p_template || input.p_template.trim().length < 10) {
    throw new FinanceServiceError('Le modèle de message doit contenir au moins 10 caractères.', '22023');
  }

  const rpcParams = {
    p_channel: input.p_channel,
    p_template: input.p_template.trim(),
    p_currency: input.p_currency ?? null,
    p_priority: input.p_priority ?? null,
    p_min_days_overdue: input.p_min_days_overdue ?? null,
    p_max_days_overdue: input.p_max_days_overdue ?? null,
    p_class_ids: input.p_class_ids ?? null
  };

  try {
    const { data, error } = await supabase.rpc('preview_school_collection_campaign', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateCampaignPreviewResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function createCollectionCampaign(
  input: CreateCampaignInput
): Promise<CreateCampaignResponse> {
  if (!input.p_name || input.p_name.trim().length < 3) {
    throw new FinanceServiceError('Le nom de la campagne doit contenir au moins 3 caractères.', '22023');
  }

  if (!input.p_channel || !VALID_CAMPAIGN_CHANNELS.includes(input.p_channel)) {
    throw new FinanceServiceError('Canal de campagne invalide.', '22023');
  }

  if (!input.p_template || input.p_template.trim().length < 10) {
    throw new FinanceServiceError('Le modèle de message doit contenir au moins 10 caractères.', '22023');
  }

  if (!input.p_idempotency_key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.p_idempotency_key)) {
    throw new FinanceServiceError('Clé d idempotence invalide (UUID v4 requis).', '22023');
  }

  const rpcParams = {
    p_name: input.p_name.trim(),
    p_channel: input.p_channel,
    p_template: input.p_template.trim(),
    p_idempotency_key: input.p_idempotency_key,
    p_currency: input.p_currency ?? null,
    p_priority: input.p_priority ?? null,
    p_min_days_overdue: input.p_min_days_overdue ?? null,
    p_max_days_overdue: input.p_max_days_overdue ?? null,
    p_class_ids: input.p_class_ids ?? null
  };

  try {
    const { data, error } = await supabase.rpc('create_school_collection_campaign', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateCreateCampaignResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function getCollectionCampaigns(
  filters?: CampaignFilters,
  cursor?: CampaignCursor | null
): Promise<CollectionCampaignListResponse> {
  const p_status = (filters?.p_status && filters.p_status !== 'ALL') ? filters.p_status : null;
  const p_channel = (filters?.p_channel && filters.p_channel !== 'ALL') ? filters.p_channel : null;
  const p_limit = filters?.p_limit ?? 20;

  if (p_limit < 1 || p_limit > 100) {
    throw new FinanceServiceError('La limite de pagination p_limit doit être comprise entre 1 et 100.', '22023');
  }

  if (cursor) {
    if (!cursor.created_at || !cursor.id) {
      throw new FinanceServiceError('Le curseur de campagnes doit contenir created_at et id tous les deux.', '22023');
    }
  }

  const rpcParams = {
    p_status,
    p_channel,
    p_limit,
    p_cursor_created_at: cursor ? cursor.created_at : null,
    p_cursor_id: cursor ? cursor.id : null
  };

  try {
    const { data, error } = await supabase.rpc('get_school_collection_campaigns', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateCollectionCampaignListResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function getCollectionCampaignDetail(
  campaignId: string,
  recipientsLimit = 50,
  cursorRecipientId?: string | null
): Promise<CollectionCampaignDetailResponse> {
  if (!campaignId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignId)) {
    throw new FinanceServiceError('ID de campagne invalide.', '22023');
  }

  if (recipientsLimit < 1 || recipientsLimit > 200) {
    throw new FinanceServiceError('La limite destinataires doit être comprise entre 1 et 200.', '22023');
  }

  const rpcParams = {
    p_campaign_id: campaignId,
    p_recipients_limit: recipientsLimit,
    p_cursor_recipient_id: cursorRecipientId ?? null
  };

  try {
    const { data, error } = await supabase.rpc('get_school_collection_campaign', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateCollectionCampaignDetailResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function scheduleCollectionCampaign(
  campaignId: string,
  scheduledAt?: string | null
): Promise<ScheduleCampaignResponse> {
  if (!campaignId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignId)) {
    throw new FinanceServiceError('ID de campagne invalide.', '22023');
  }

  const rpcParams = {
    p_campaign_id: campaignId,
    p_scheduled_at: scheduledAt ?? null
  };

  try {
    const { data, error } = await supabase.rpc('schedule_school_collection_campaign', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateScheduleCampaignResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function cancelCollectionCampaign(
  campaignId: string,
  reason?: string | null
): Promise<CancelCampaignResponse> {
  if (!campaignId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignId)) {
    throw new FinanceServiceError('ID de campagne invalide.', '22023');
  }

  const rpcParams = {
    p_campaign_id: campaignId,
    p_reason: reason ?? null
  };

  try {
    const { data, error } = await supabase.rpc('cancel_school_collection_campaign', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateCancelCampaignResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

// =============================================================================
// FINANCE 4E-3B : VALIDATEURS RUNTIME & RPCs D'OBSERVABILITÉ E-MAILS RÉELS
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_BLOCKERS: Set<RealEmailReadinessBlocker> = new Set([
  'GLOBAL_KILL_SWITCH_DISABLED',
  'SENDER_IDENTITY_NOT_VERIFIED',
  'SENDER_IDENTITY_NOT_CONFIGURED',
  'SCHOOL_SETTINGS_NOT_CONFIGURED',
  'SCHOOL_EMAIL_DISABLED'
]);

const VALID_JOB_STATUSES: Set<RealEmailJobStatus> = new Set([
  'pending',
  'claimed',
  'submitted',
  'network_unknown',
  'retry_wait',
  'terminal_failed',
  'delivery_confirmed',
  'bounced',
  'complained'
]);

export function validateRealEmailReadinessResponse(data: unknown): RealEmailReadinessResponse {
  if (typeof data !== 'object' || data === null) {
    throw new FinanceServiceError('Réponse readiness invalide (non-objet).', '22023');
  }

  const d = data as Record<string, unknown>;

  if (typeof d.school_id !== 'string' || !UUID_REGEX.test(d.school_id)) {
    throw new FinanceServiceError('school_id invalide dans readiness.', '22023');
  }

  if (d.provider !== 'resend') {
    throw new FinanceServiceError('provider doit être résolument "resend".', '22023');
  }

  if (typeof d.global_real_email_enabled !== 'boolean') {
    throw new FinanceServiceError('global_real_email_enabled boolean requis.', '22023');
  }

  if (typeof d.sender_identity_verified !== 'boolean') {
    throw new FinanceServiceError('sender_identity_verified boolean requis.', '22023');
  }

  if (typeof d.sender_identity_configured !== 'boolean') {
    throw new FinanceServiceError('sender_identity_configured boolean requis.', '22023');
  }

  if (typeof d.school_email_enabled !== 'boolean') {
    throw new FinanceServiceError('school_email_enabled boolean requis.', '22023');
  }

  if (typeof d.effective_real_email_enabled !== 'boolean') {
    throw new FinanceServiceError('effective_real_email_enabled boolean requis.', '22023');
  }

  if (
    typeof d.daily_email_quota !== 'number' ||
    !Number.isInteger(d.daily_email_quota) ||
    d.daily_email_quota < 0
  ) {
    throw new FinanceServiceError('daily_email_quota doit être un entier >= 0.', '22023');
  }

  if (d.from_name !== null && typeof d.from_name !== 'string') {
    throw new FinanceServiceError('from_name doit être string ou null.', '22023');
  }

  if (d.reply_to_email !== null && typeof d.reply_to_email !== 'string') {
    throw new FinanceServiceError('reply_to_email doit être string ou null.', '22023');
  }

  if (!Array.isArray(d.blockers)) {
    throw new FinanceServiceError('blockers doit être un tableau.', '22023');
  }

  for (const b of d.blockers) {
    if (!VALID_BLOCKERS.has(b as RealEmailReadinessBlocker)) {
      throw new FinanceServiceError(`Code blocker inconnu : ${b}`, '22023');
    }
  }

  return d as unknown as RealEmailReadinessResponse;
}

export function validateRealEmailDeliveryDashboardResponse(data: unknown): RealEmailDeliveryDashboardResponse {
  if (typeof data !== 'object' || data === null) {
    throw new FinanceServiceError('Réponse dashboard invalide (non-objet).', '22023');
  }

  const d = data as Record<string, unknown>;

  if (typeof d.business_date !== 'string' || !DATE_YYYY_MM_DD_REGEX.test(d.business_date)) {
    throw new FinanceServiceError('business_date invalide (YYYY-MM-DD attendu).', '22023');
  }

  if (typeof d.timezone !== 'string' || d.timezone.length === 0) {
    throw new FinanceServiceError('timezone valide requise.', '22023');
  }

  if (typeof d.timezone_fallback_applied !== 'boolean') {
    throw new FinanceServiceError('timezone_fallback_applied boolean requis.', '22023');
  }

  // Quota
  if (typeof d.quota !== 'object' || d.quota === null) {
    throw new FinanceServiceError('Section quota manquante ou invalide.', '22023');
  }
  const q = d.quota as Record<string, unknown>;
  const daily_limit = q.daily_limit;
  const reserved_count = q.reserved_count;
  const submitted_count = q.submitted_count;
  const remaining_count = q.remaining_count;

  if (
    typeof daily_limit !== 'number' || !Number.isInteger(daily_limit) || daily_limit < 0 ||
    typeof reserved_count !== 'number' || !Number.isInteger(reserved_count) || reserved_count < 0 ||
    typeof submitted_count !== 'number' || !Number.isInteger(submitted_count) || submitted_count < 0 ||
    typeof remaining_count !== 'number' || !Number.isInteger(remaining_count) || remaining_count < 0
  ) {
    throw new FinanceServiceError('Les compteurs de quota doivent être des entiers >= 0.', '22023');
  }

  const expectedRemaining = Math.max(daily_limit - reserved_count - submitted_count, 0);
  if (remaining_count !== expectedRemaining) {
    throw new FinanceServiceError('Invariant du quota restant violé.', '22023');
  }

  // Campaigns
  if (typeof d.campaigns !== 'object' || d.campaigns === null) {
    throw new FinanceServiceError('Section campaigns manquante ou invalide.', '22023');
  }
  const c = d.campaigns as Record<string, unknown>;
  const real_total_count = c.real_total_count;
  const draft_count = c.draft_count;
  const scheduled_count = c.scheduled_count;
  const processing_count = c.processing_count;
  const completed_count = c.completed_count;
  const partially_failed_count = c.partially_failed_count;
  const failed_count = c.failed_count;
  const cancelled_count = c.cancelled_count;

  const campCounts = [
    real_total_count, draft_count, scheduled_count, processing_count,
    completed_count, partially_failed_count, failed_count, cancelled_count
  ];
  for (const cnt of campCounts) {
    if (typeof cnt !== 'number' || !Number.isInteger(cnt) || cnt < 0) {
      throw new FinanceServiceError('Tous les compteurs de campagnes doivent être des entiers >= 0.', '22023');
    }
  }

  const expectedCampSum = (draft_count as number) + (scheduled_count as number) +
    (processing_count as number) + (completed_count as number) +
    (partially_failed_count as number) + (failed_count as number) + (cancelled_count as number);

  if ((real_total_count as number) !== expectedCampSum) {
    throw new FinanceServiceError('Invariant de somme des campagnes violé.', '22023');
  }

  // Jobs
  if (typeof d.jobs !== 'object' || d.jobs === null) {
    throw new FinanceServiceError('Section jobs manquante ou invalide.', '22023');
  }
  const j = d.jobs as Record<string, unknown>;
  const total_count = j.total_count;
  const pending_count = j.pending_count;
  const claimed_count = j.claimed_count;
  const submitted_job_count = j.submitted_count;
  const network_unknown_count = j.network_unknown_count;
  const retry_wait_count = j.retry_wait_count;
  const terminal_failed_count = j.terminal_failed_count;
  const delivery_confirmed_count = j.delivery_confirmed_count;
  const bounced_count = j.bounced_count;
  const complained_count = j.complained_count;

  const jobCounts = [
    total_count, pending_count, claimed_count, submitted_job_count,
    network_unknown_count, retry_wait_count, terminal_failed_count,
    delivery_confirmed_count, bounced_count, complained_count
  ];
  for (const cnt of jobCounts) {
    if (typeof cnt !== 'number' || !Number.isInteger(cnt) || cnt < 0) {
      throw new FinanceServiceError('Tous les compteurs de jobs doivent être des entiers >= 0.', '22023');
    }
  }

  const expectedJobSum = (pending_count as number) + (claimed_count as number) +
    (submitted_job_count as number) + (network_unknown_count as number) +
    (retry_wait_count as number) + (terminal_failed_count as number) +
    (delivery_confirmed_count as number) + (bounced_count as number) + (complained_count as number);

  if ((total_count as number) !== expectedJobSum) {
    throw new FinanceServiceError('Invariant de somme des jobs violé.', '22023');
  }

  return d as unknown as RealEmailDeliveryDashboardResponse;
}

export function validateRealEmailDeliveryJobsResponse(data: unknown): RealEmailDeliveryJobsResponse {
  if (typeof data !== 'object' || data === null) {
    throw new FinanceServiceError('Réponse jobs invalide (non-objet).', '22023');
  }

  const d = data as Record<string, unknown>;

  if (!Array.isArray(d.items)) {
    throw new FinanceServiceError('items doit être un tableau.', '22023');
  }

  if (typeof d.has_more !== 'boolean') {
    throw new FinanceServiceError('has_more boolean requis.', '22023');
  }

  if (d.has_more === false && d.next_cursor !== null) {
    throw new FinanceServiceError('next_cursor doit être null quand has_more = false.', '22023');
  }

  if (d.has_more === true && (d.next_cursor === null || d.next_cursor === undefined)) {
    throw new FinanceServiceError('next_cursor doit être présent et complet quand has_more = true.', '22023');
  }

  if (d.next_cursor !== null) {
    if (typeof d.next_cursor !== 'object' || d.next_cursor === null) {
      throw new FinanceServiceError('next_cursor invalide.', '22023');
    }
    const nc = d.next_cursor as Record<string, unknown>;
    if (
      typeof nc.created_at !== 'string' ||
      nc.created_at.length === 0 ||
      isNaN(Date.parse(nc.created_at)) ||
      typeof nc.job_id !== 'string' ||
      !UUID_REGEX.test(nc.job_id)
    ) {
      throw new FinanceServiceError('next_cursor incomplet ou invalide.', '22023');
    }
  }

  for (const rawItem of d.items) {
    if (typeof rawItem !== 'object' || rawItem === null) {
      throw new FinanceServiceError('Item job invalide.', '22023');
    }
    const item = rawItem as Record<string, unknown>;

    if (typeof item.job_id !== 'string' || !UUID_REGEX.test(item.job_id)) {
      throw new FinanceServiceError('job_id invalide dans item.', '22023');
    }
    if (typeof item.campaign_id !== 'string' || !UUID_REGEX.test(item.campaign_id)) {
      throw new FinanceServiceError('campaign_id invalide dans item.', '22023');
    }
    if (typeof item.campaign_name !== 'string') {
      throw new FinanceServiceError('campaign_name string requis.', '22023');
    }
    if (typeof item.invoice_id !== 'string' || !UUID_REGEX.test(item.invoice_id)) {
      throw new FinanceServiceError('invoice_id invalide dans item.', '22023');
    }
    if (typeof item.invoice_number !== 'string') {
      throw new FinanceServiceError('invoice_number string requis.', '22023');
    }
    if (typeof item.student_id !== 'string' || !UUID_REGEX.test(item.student_id)) {
      throw new FinanceServiceError('student_id invalide dans item.', '22023');
    }
    if (typeof item.student_name !== 'string') {
      throw new FinanceServiceError('student_name string requis.', '22023');
    }
    if (!VALID_JOB_STATUSES.has(item.status as RealEmailJobStatus)) {
      throw new FinanceServiceError(`Statut job invalide : ${item.status}`, '22023');
    }
    if (typeof item.attempt_count !== 'number' || !Number.isInteger(item.attempt_count) || item.attempt_count < 0) {
      throw new FinanceServiceError('attempt_count doit être un entier >= 0.', '22023');
    }
    if (typeof item.provider_message_recorded !== 'boolean') {
      throw new FinanceServiceError('provider_message_recorded boolean requis.', '22023');
    }
    if (typeof item.created_at !== 'string' || typeof item.updated_at !== 'string') {
      throw new FinanceServiceError('created_at et updated_at doivent être des strings.', '22023');
    }
  }

  return d as unknown as RealEmailDeliveryJobsResponse;
}

export async function getSchoolRealEmailReadiness(): Promise<RealEmailReadinessResponse> {
  try {
    const { data, error } = await supabase.rpc('get_school_real_email_readiness');
    if (error) throw mapPostgresError(error);
    return validateRealEmailReadinessResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function getSchoolRealEmailDeliveryDashboard(
  p_business_date?: string | null
): Promise<RealEmailDeliveryDashboardResponse> {
  let normalizedDateOrNull: string | null = null;
  if (p_business_date !== undefined && p_business_date !== null) {
    if (typeof p_business_date !== 'string' || !DATE_YYYY_MM_DD_REGEX.test(p_business_date)) {
      throw new FinanceServiceError('Format de date métier invalide (YYYY-MM-DD attendu).', '22023');
    }
    normalizedDateOrNull = p_business_date;
  }

  const rpcParams = {
    p_business_date: normalizedDateOrNull
  };

  try {
    const { data, error } = await supabase.rpc('get_school_real_email_delivery_dashboard', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateRealEmailDeliveryDashboardResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function getSchoolRealEmailDeliveryJobs(
  filters?: {
    p_status?: RealEmailJobStatus | null;
    p_limit?: number;
  },
  cursor?: RealEmailDeliveryJobsCursor | null
): Promise<RealEmailDeliveryJobsResponse> {
  let p_status: string | null = null;
  if (filters?.p_status !== undefined && filters.p_status !== null) {
    if (!VALID_JOB_STATUSES.has(filters.p_status)) {
      throw new FinanceServiceError(`Statut de filtre invalide : ${filters.p_status}`, '22023');
    }
    p_status = filters.p_status;
  }

  let p_limit = 20;
  if (filters?.p_limit !== undefined) {
    if (typeof filters.p_limit !== 'number' || !Number.isInteger(filters.p_limit) || filters.p_limit < 1 || filters.p_limit > 100) {
      throw new FinanceServiceError('Limite p_limit invalide (doit être un entier entre 1 et 100).', '22023');
    }
    p_limit = filters.p_limit;
  }

  let p_cursor_created_at: string | null = null;
  let p_cursor_job_id: string | null = null;

  if (cursor !== undefined && cursor !== null) {
    const created_at_valid = typeof cursor.created_at === 'string' && cursor.created_at.length > 0;
    const job_id_valid = typeof cursor.job_id === 'string' && UUID_REGEX.test(cursor.job_id);

    if ((created_at_valid && !job_id_valid) || (!created_at_valid && job_id_valid)) {
      throw new FinanceServiceError('Paire de curseurs incomplète (created_at et job_id doivent être fournis ensemble).', '22023');
    }

    if (created_at_valid && job_id_valid) {
      p_cursor_created_at = cursor.created_at;
      p_cursor_job_id = cursor.job_id;
    }
  }

  // PAYLOAD EXPLICITE AVEC EXACTEMENT LES QUATRE CLÉS SQL REQUISES
  const rpcParams = {
    p_status,
    p_limit,
    p_cursor_created_at,
    p_cursor_job_id
  };

  try {
    const { data, error } = await supabase.rpc('get_school_real_email_delivery_jobs', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateRealEmailDeliveryJobsResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

// ---------------------------------------------------------------------------
// VALIDATEURS ET RPCs POUR FINANCE 4E-5B (CRÉATION ET PLANIFICATION REAL)
// ---------------------------------------------------------------------------

const VALID_CAMPAIGN_PRIORITIES: CampaignPriority[] = ['P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW'];

const EXPECTED_CAMPAIGN_KEYS = new Set([
  'id', 'school_id', 'name', 'channel', 'status', 'delivery_mode',
  'scheduled_at', 'claimed_at', 'claimed_by', 'processing_started_at',
  'completed_at', 'created_by', 'idempotency_key', 'filter_criteria',
  'template_snapshot', 'recipient_count', 'pending_count', 'processing_count',
  'success_count', 'failed_count', 'skipped_count', 'created_at', 'updated_at'
]);

const EXPECTED_FILTER_KEYS = new Set([
  'currency', 'min_days_overdue', 'max_days_overdue', 'priority', 'class_ids'
]);

export function validateRealEmailCampaignSummary(data: unknown): RealEmailCampaignSummary {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour RealEmailCampaignSummary (non-objet).', '22023');
  }

  const keys = Object.keys(data as Record<string, unknown>);
  if (keys.length !== 23 || !keys.every((k) => EXPECTED_CAMPAIGN_KEYS.has(k))) {
    throw new FinanceServiceError('RealEmailCampaignSummary doit contenir exactement les 23 clés prévues sans clé supplémentaire.', '22023');
  }

  const id = getStringProperty(data, 'id');
  if (!id || !UUID_REGEX.test(id)) {
    throw new FinanceServiceError('Propriété "id" invalide ou non UUID dans RealEmailCampaignSummary.', '22023');
  }

  const school_id = getStringProperty(data, 'school_id');
  if (!school_id || !UUID_REGEX.test(school_id)) {
    throw new FinanceServiceError('Propriété "school_id" invalide ou non UUID dans RealEmailCampaignSummary.', '22023');
  }

  const name = getStringProperty(data, 'name');
  if (!name || name.trim() === '') {
    throw new FinanceServiceError('Propriété "name" manquante ou vide dans RealEmailCampaignSummary.', '22023');
  }

  const channel = getStringProperty(data, 'channel');
  if (channel !== 'email') {
    throw new FinanceServiceError(`Canal invalide dans RealEmailCampaignSummary ("email" attendu, reçu "${channel}").`, '22023');
  }

  const delivery_mode = getStringProperty(data, 'delivery_mode');
  if (delivery_mode !== 'real') {
    throw new FinanceServiceError(`Mode de livraison invalide dans RealEmailCampaignSummary ("real" attendu, reçu "${delivery_mode}").`, '22023');
  }

  const status = getStringProperty(data, 'status') as CampaignStatus;
  if (!status || !VALID_CAMPAIGN_STATUSES.includes(status)) {
    throw new FinanceServiceError(`Statut de campagne invalide dans RealEmailCampaignSummary: "${status}".`, '22023');
  }

  const created_by = getStringProperty(data, 'created_by');
  if (!created_by || !UUID_REGEX.test(created_by)) {
    throw new FinanceServiceError('Propriété "created_by" obligatoire (UUID v4 non-null attendu) dans RealEmailCampaignSummary.', '22023');
  }

  const idempotency_key = getStringProperty(data, 'idempotency_key');
  if (!idempotency_key || !UUID_REGEX.test(idempotency_key)) {
    throw new FinanceServiceError('Propriété "idempotency_key" invalide ou non UUID dans RealEmailCampaignSummary.', '22023');
  }

  const filter_criteria_raw = data['filter_criteria'];
  if (!isObject(filter_criteria_raw)) {
    throw new FinanceServiceError('Propriété "filter_criteria" manquante ou non-objet dans RealEmailCampaignSummary.', '22023');
  }
  const fc = filter_criteria_raw as Record<string, unknown>;
  const fcKeys = Object.keys(fc);
  if (fcKeys.length !== 5 || !fcKeys.every((k) => EXPECTED_FILTER_KEYS.has(k))) {
    throw new FinanceServiceError('filter_criteria doit contenir exactement les 5 clés canoniques sans clé supplémentaire.', '22023');
  }

  if (fc['priority'] !== null && fc['priority'] !== undefined) {
    if (typeof fc['priority'] !== 'string' || !VALID_CAMPAIGN_PRIORITIES.includes(fc['priority'] as CampaignPriority)) {
      throw new FinanceServiceError(`Priorité invalide "${fc['priority']}" dans filter_criteria (P1_CRITICAL, P2_HIGH, P3_MEDIUM, P4_LOW ou null attendu).`, '22023');
    }
  }

  const template_snapshot_raw = data['template_snapshot'];
  if (!isObject(template_snapshot_raw)) {
    throw new FinanceServiceError('Propriété "template_snapshot" manquante ou non-objet dans RealEmailCampaignSummary.', '22023');
  }
  const tsKeys = Object.keys(template_snapshot_raw as Record<string, unknown>);
  if (
    tsKeys.length !== 1 ||
    tsKeys[0] !== 'raw' ||
    typeof template_snapshot_raw['raw'] !== 'string' ||
    template_snapshot_raw['raw'].trim() === ''
  ) {
    throw new FinanceServiceError('template_snapshot doit contenir exactement { raw: string } sans clé supplémentaire.', '22023');
  }

  const recipient_count = getNumberProperty(data, 'recipient_count');
  const pending_count = getNumberProperty(data, 'pending_count');
  const processing_count = getNumberProperty(data, 'processing_count');
  const success_count = getNumberProperty(data, 'success_count');
  const failed_count = getNumberProperty(data, 'failed_count');
  const skipped_count = getNumberProperty(data, 'skipped_count');

  if (
    recipient_count === null || !Number.isInteger(recipient_count) || recipient_count < 0 ||
    pending_count === null || !Number.isInteger(pending_count) || pending_count < 0 ||
    processing_count === null || !Number.isInteger(processing_count) || processing_count < 0 ||
    success_count === null || !Number.isInteger(success_count) || success_count < 0 ||
    failed_count === null || !Number.isInteger(failed_count) || failed_count < 0 ||
    skipped_count === null || !Number.isInteger(skipped_count) || skipped_count < 0
  ) {
    throw new FinanceServiceError('Les compteurs de destinataires doivent être des entiers >= 0 dans RealEmailCampaignSummary.', '22023');
  }

  if (recipient_count !== pending_count + processing_count + success_count + failed_count + skipped_count) {
    throw new FinanceServiceError('Invariant des compteurs destinataires violé dans RealEmailCampaignSummary.', '22023');
  }

  const created_at = getStringProperty(data, 'created_at');
  if (!created_at || isNaN(Date.parse(created_at))) {
    throw new FinanceServiceError('created_at invalide dans RealEmailCampaignSummary.', '22023');
  }

  const updated_at = getStringProperty(data, 'updated_at');
  if (!updated_at || isNaN(Date.parse(updated_at))) {
    throw new FinanceServiceError('updated_at invalide dans RealEmailCampaignSummary.', '22023');
  }

  return {
    id,
    school_id,
    name,
    channel: 'email',
    status,
    delivery_mode: 'real',
    scheduled_at: getStringProperty(data, 'scheduled_at'),
    claimed_at: getStringProperty(data, 'claimed_at'),
    claimed_by: getStringProperty(data, 'claimed_by'),
    processing_started_at: getStringProperty(data, 'processing_started_at'),
    completed_at: getStringProperty(data, 'completed_at'),
    created_by,
    idempotency_key,
    filter_criteria: {
      currency: fc['currency'] as Currency | null ?? null,
      min_days_overdue: fc['min_days_overdue'] as number | null ?? null,
      max_days_overdue: fc['max_days_overdue'] as number | null ?? null,
      priority: fc['priority'] as CampaignPriority | null ?? null,
      class_ids: fc['class_ids'] as string[] | null ?? null,
    },
    template_snapshot: { raw: template_snapshot_raw['raw'] as string },
    recipient_count,
    pending_count,
    processing_count,
    success_count,
    failed_count,
    skipped_count,
    created_at,
    updated_at
  };
}

export function validateCreateRealEmailCampaignResponse(data: unknown): CreateRealEmailCampaignResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour create_school_real_email_campaign (non-objet).', '22023');
  }

  if (data['success'] !== true) {
    throw new FinanceServiceError('La création de la campagne e-mail REAL a échoué.', '22023');
  }

  const campaign = validateRealEmailCampaignSummary(data['campaign']);
  if (campaign.status !== 'draft') {
    throw new FinanceServiceError(`La campagne REAL créée doit être au statut 'draft' (reçu '${campaign.status}').`, '22023');
  }

  if (typeof data['is_idempotent_replay'] !== 'boolean') {
    throw new FinanceServiceError('is_idempotent_replay boolean requis dans la réponse de création REAL.', '22023');
  }

  if (typeof data['recipients_has_more'] !== 'boolean') {
    throw new FinanceServiceError('recipients_has_more boolean requis dans la réponse de création REAL.', '22023');
  }

  const next_cursor_recipient_id = getStringProperty(data, 'next_cursor_recipient_id');
  if (data['recipients_has_more'] && !next_cursor_recipient_id) {
    throw new FinanceServiceError('Incohérence curseur : recipients_has_more = true sans next_cursor_recipient_id.', '22023');
  }
  if (!data['recipients_has_more'] && next_cursor_recipient_id) {
    throw new FinanceServiceError('Incohérence curseur : recipients_has_more = false avec next_cursor_recipient_id.', '22023');
  }

  const rawRecipients = Array.isArray(data['recipients']) ? data['recipients'] : [];
  const recipients = rawRecipients.map(validateCollectionCampaignRecipient);

  const safety = data['safety'];
  if (!isObject(safety)) {
    throw new FinanceServiceError('Safety payload manquant ou non-objet dans la réponse de création REAL.', '22023');
  }

  if (
    safety['channel'] !== 'email' ||
    safety['delivery_mode'] !== 'real' ||
    safety['status'] !== 'draft' ||
    safety['no_message_sent'] !== true
  ) {
    throw new FinanceServiceError('Contrat de sécurité "safety" invalide dans la réponse de création REAL.', '22023');
  }

  return {
    success: true,
    campaign,
    recipients,
    recipients_has_more: Boolean(data['recipients_has_more']),
    next_cursor_recipient_id,
    is_idempotent_replay: Boolean(data['is_idempotent_replay']),
    safety: {
      channel: 'email',
      delivery_mode: 'real',
      status: 'draft',
      no_message_sent: true
    }
  };
}

export function validateScheduleRealEmailCampaignResponse(data: unknown): ScheduleRealEmailCampaignResponse {
  if (!isObject(data)) {
    throw new FinanceServiceError('Format de réponse invalide pour schedule_school_real_email_campaign (non-objet).', '22023');
  }

  if (data['success'] !== true) {
    throw new FinanceServiceError('La planification de la campagne e-mail REAL a échoué.', '22023');
  }

  const campaign_id = getStringProperty(data, 'campaign_id');
  if (!campaign_id || !UUID_REGEX.test(campaign_id)) {
    throw new FinanceServiceError('campaign_id invalide ou non UUID dans la réponse de planification REAL.', '22023');
  }

  if (data['delivery_mode'] !== 'real') {
    throw new FinanceServiceError('delivery_mode doit être "real" dans la réponse de planification REAL.', '22023');
  }

  if (data['channel'] !== 'email') {
    throw new FinanceServiceError('channel doit être "email" dans la réponse de planification REAL.', '22023');
  }

  if (data['status'] !== 'scheduled') {
    throw new FinanceServiceError('status doit être "scheduled" dans la réponse de planification REAL.', '22023');
  }

  const scheduled_at = getStringProperty(data, 'scheduled_at');
  if (!scheduled_at || isNaN(Date.parse(scheduled_at))) {
    throw new FinanceServiceError('scheduled_at invalide dans la réponse de planification REAL.', '22023');
  }

  if (data['no_message_sent'] !== true) {
    throw new FinanceServiceError('no_message_sent doit être strictement true dans la réponse de planification REAL.', '22023');
  }

  return {
    success: true,
    campaign_id,
    delivery_mode: 'real',
    channel: 'email',
    status: 'scheduled',
    scheduled_at,
    no_message_sent: true
  };
}

export async function createSchoolRealEmailCampaign(
  request: CreateRealEmailCampaignRequest
): Promise<CreateRealEmailCampaignResponse> {
  if (!request.p_name || request.p_name.trim().length < 3) {
    throw new FinanceServiceError('Le nom de la campagne doit contenir au moins 3 caractères.', '22023');
  }

  if (!request.p_template || request.p_template.trim().length < 10) {
    throw new FinanceServiceError('Le modèle de message doit contenir au moins 10 caractères.', '22023');
  }

  if (!request.p_idempotency_key || !UUID_REGEX.test(request.p_idempotency_key)) {
    throw new FinanceServiceError('Clé d idempotence invalide (UUID v4 requis).', '22023');
  }

  if (request.p_confirm_real_delivery !== true || request.p_confirmation_text !== 'ENVOI EMAIL REEL') {
    throw new FinanceServiceError('La confirmation explicite "ENVOI EMAIL REEL" avec p_confirm_real_delivery = true est obligatoire.', '22023');
  }

  if (request.p_priority !== undefined && request.p_priority !== null) {
    if (!VALID_CAMPAIGN_PRIORITIES.includes(request.p_priority)) {
      throw new FinanceServiceError(`Priorité invalide "${request.p_priority}".`, '22023');
    }
  }

  const rpcParams = {
    p_name: request.p_name.trim(),
    p_template: request.p_template.trim(),
    p_idempotency_key: request.p_idempotency_key,
    p_currency: (request.p_currency !== undefined && request.p_currency !== null) ? request.p_currency : null,
    p_priority: (request.p_priority !== undefined && request.p_priority !== null) ? request.p_priority : null,
    p_min_days_overdue: (request.p_min_days_overdue !== undefined && request.p_min_days_overdue !== null) ? request.p_min_days_overdue : null,
    p_max_days_overdue: (request.p_max_days_overdue !== undefined && request.p_max_days_overdue !== null) ? request.p_max_days_overdue : null,
    p_class_ids: (request.p_class_ids !== undefined && request.p_class_ids !== null) ? request.p_class_ids : null,
    p_confirm_real_delivery: true,
    p_confirmation_text: 'ENVOI EMAIL REEL'
  };

  try {
    const { data, error } = await supabase.rpc('create_school_real_email_campaign', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateCreateRealEmailCampaignResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}

export async function scheduleSchoolRealEmailCampaign(
  request: ScheduleRealEmailCampaignRequest
): Promise<ScheduleRealEmailCampaignResponse> {
  if (!request.p_campaign_id || !UUID_REGEX.test(request.p_campaign_id)) {
    throw new FinanceServiceError('Identifiant de campagne (p_campaign_id) invalide (UUID v4 requis).', '22023');
  }

  if (!request.p_scheduled_at || isNaN(Date.parse(request.p_scheduled_at))) {
    throw new FinanceServiceError('Date de planification (p_scheduled_at) invalide.', '22023');
  }

  const scheduledTime = new Date(request.p_scheduled_at).getTime();
  const now = Date.now();
  if (scheduledTime < now) {
    throw new FinanceServiceError('La date de planification ne peut pas être dans le passé.', '22023');
  }

  const maxFuture = now + 30 * 24 * 60 * 60 * 1000;
  if (scheduledTime > maxFuture) {
    throw new FinanceServiceError('La date de planification ne peut pas dépasser 30 jours dans le futur.', '22023');
  }

  if (request.p_confirm_real_delivery !== true || request.p_confirmation_text !== 'ENVOI EMAIL REEL') {
    throw new FinanceServiceError('La confirmation explicite "ENVOI EMAIL REEL" avec p_confirm_real_delivery = true est obligatoire.', '22023');
  }

  const rpcParams = {
    p_campaign_id: request.p_campaign_id,
    p_scheduled_at: request.p_scheduled_at,
    p_confirm_real_delivery: true,
    p_confirmation_text: 'ENVOI EMAIL REEL'
  };

  try {
    const { data, error } = await supabase.rpc('schedule_school_real_email_campaign', rpcParams);
    if (error) throw mapPostgresError(error);
    return validateScheduleRealEmailCampaignResponse(data);
  } catch (err: unknown) {
    if (err instanceof FinanceServiceError) throw err;
    throw mapPostgresError(err);
  }
}
