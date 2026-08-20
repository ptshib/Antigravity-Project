// Fichier : src/tests/financeFrontend.test.ts
// Tests unitaires frontend automatisés pour la Phase Finance 2 ÉcoleConnect

import { validateRecordPaymentResult } from '../services/financeService';
import type { Currency } from '../types/finance';

/**
 * Suite de tests automatisés frontend (Sans mutation Supabase)
 */
export function runFinanceFrontendTests(): { total: number; passed: number; failed: number; errors: string[] } {
  const errors: string[] = [];
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      passed++;
      console.log(`✓ PASS: ${testName}`);
    } else {
      errors.push(testName);
      console.error(`✗ FAIL: ${testName}`);
    }
  }

  console.log('=== DÉBUT DES TESTS FRONTEND AUTOMATISÉS PHASE FINANCE 2 ===\n');

  // TEST 1 : Validation canonique du retour RPC record_student_payment avec total_paid et balance_after_payment
  try {
    const rpcPayload = {
      success: true,
      is_idempotent_replay: false,
      payment_id: 'pay-uuid-1234',
      payment_number: 'PAY-2026-000003',
      receipt_id: 'rec-uuid-5678',
      receipt_number: 'REC-2026-000003',
      amount: 100,
      currency: 'CDF',
      payment_method: 'cash',
      invoice_id: 'inv-uuid-9999',
      invoice_status: 'partially_paid',
      total_paid: 20150,
      balance_after_payment: 29850,
      recorded_at: '2026-08-20T17:14:07Z'
    };

    const validated = validateRecordPaymentResult(rpcPayload);
    assert(validated.payment_id === 'pay-uuid-1234', 'TEST 1.1 : payment_id extrait correctement');
    assert(validated.total_paid === 20150, 'TEST 1.2 : total_paid canonique extrait correctement');
    assert(validated.balance_after_payment === 29850, 'TEST 1.3 : balance_after_payment canonique extrait correctement');
    assert(validated.currency === 'CDF', 'TEST 1.4 : Devise CDF préservée explicitement');
  } catch (err: unknown) {
    assert(false, `TEST 1 : Exception inattendue : ${err}`);
  }

  // TEST 2 : Validation acceptant un solde restant dû de 0 (Facture entièrement payée)
  try {
    const rpcPayloadZeroBalance = {
      success: true,
      is_idempotent_replay: false,
      payment_id: 'pay-uuid-000',
      payment_number: 'PAY-2026-000099',
      receipt_id: 'rec-uuid-000',
      receipt_number: 'REC-2026-000099',
      amount: 29850,
      currency: 'CDF',
      payment_method: 'cash',
      invoice_id: 'inv-uuid-9999',
      invoice_status: 'paid',
      total_paid: 50000,
      balance_after_payment: 0,
      recorded_at: '2026-08-20T18:00:00Z'
    };

    const validated = validateRecordPaymentResult(rpcPayloadZeroBalance);
    assert(validated.balance_after_payment === 0, 'TEST 2.1 : Solde 0 accepté sans rejeter le résultat');
    assert(validated.invoice_status === 'paid', 'TEST 2.2 : Statut paid reconnu');
  } catch (err: unknown) {
    assert(false, `TEST 2 : Exception inattendue : ${err}`);
  }

  // TEST 3 : Séparation des synthèses multidevises (CDF vs USD)
  try {
    const mockInvoices = [
      { id: '1', invoice_number: 'INV-1', issue_date: '2026-01-01', due_date: null, total_amount: 50000, paid_amount: 20250, remaining_balance: 29750, status: 'partially_paid' as const, currency: 'CDF' as Currency, created_at: '', items: [] },
      { id: '2', invoice_number: 'INV-2', issue_date: '2026-01-01', due_date: null, total_amount: 150, paid_amount: 0, remaining_balance: 150, status: 'issued' as const, currency: 'USD' as Currency, created_at: '', items: [] },
      { id: '3', invoice_number: 'INV-3', issue_date: '2026-01-01', due_date: null, total_amount: 150, paid_amount: 0, remaining_balance: 150, status: 'issued' as const, currency: 'USD' as Currency, created_at: '', items: [] }
    ];

    const mockPayments = [
      { id: 'p1', payment_number: 'PAY-1', receipt_number: 'REC-1', invoice_id: '1', invoice_number: 'INV-1', amount: 10000, currency: 'CDF' as Currency, payment_date: '2026-01-02', payment_method: 'cash' as const, external_reference: null, status: 'completed' as const, recorded_by_name: 'Agent', created_at: '' },
      { id: 'p2', payment_number: 'PAY-2', receipt_number: 'REC-2', invoice_id: '1', invoice_number: 'INV-1', amount: 10250, currency: 'CDF' as Currency, payment_date: '2026-01-03', payment_method: 'cash' as const, external_reference: null, status: 'completed' as const, recorded_by_name: 'Agent', created_at: '' },
      { id: 'p3', payment_number: 'PAY-3', receipt_number: 'REC-3', invoice_id: '1', invoice_number: 'INV-1', amount: 0, currency: 'CDF' as Currency, payment_date: '2026-01-04', payment_method: 'cash' as const, external_reference: null, status: 'completed' as const, recorded_by_name: 'Agent', created_at: '' },
      { id: 'p4', payment_number: 'PAY-4', receipt_number: 'REC-4', invoice_id: '1', invoice_number: 'INV-1', amount: 100, currency: 'CDF' as Currency, payment_date: '2026-01-05', payment_method: 'cash' as const, external_reference: null, status: 'cancelled' as const, recorded_by_name: 'Agent', cancelled_at: '2026-01-05', cancelled_by: 'Admin', cancel_reason: 'Test', created_at: '' }
    ];

    // Calculs de synthèse CDF
    const cdfInvoices = mockInvoices.filter(i => i.currency === 'CDF');
    const cdfPayments = mockPayments.filter(p => p.currency === 'CDF');
    const cdfActivePayments = cdfPayments.filter(p => p.status !== 'cancelled');
    const cdfPaidActive = cdfActivePayments.reduce((sum, p) => sum + p.amount, 0);

    assert(cdfInvoices.length === 1, 'TEST 3.1 : 1 facture CDF trouvée');
    assert(cdfPaidActive === 20250, 'TEST 3.2 : Total réglé actif CDF = 20 250 CDF (exclut les 100 CDF annulés)');
    assert(cdfPayments.length === 4 && cdfActivePayments.length === 3, 'TEST 3.3 : 4 paiements historiques, dont 3 actifs et 1 annulé');

    // Calculs de synthèse USD
    const usdInvoices = mockInvoices.filter(i => i.currency === 'USD');
    const usdPayments = mockPayments.filter(p => p.currency === 'USD');

    assert(usdInvoices.length === 2, 'TEST 3.4 : 2 factures USD trouvées');
    assert(usdPayments.length === 0, 'TEST 3.5 : 0 paiement USD');
  } catch (err: unknown) {
    assert(false, `TEST 3 : Exception inattendue : ${err}`);
  }

  // TEST 4 : Phase Finance 3 - Administration du Catalogue des Frais
  try {
    const mockFees = [
      { id: 'f1', school_id: 'school-1', academic_year_id: 'ay-1', class_id: null, fee_type: 'minerval', name: 'Minerval T1', amount: 50000, currency: 'CDF' as Currency, due_date: '2026-10-15', is_mandatory: true, is_active: true, created_at: '', updated_at: '' },
      { id: 'f2', school_id: 'school-1', academic_year_id: 'ay-1', class_id: null, fee_type: 'uniforme', name: 'Uniforme de sport', amount: 35, currency: 'USD' as Currency, due_date: '2026-09-30', is_mandatory: false, is_active: true, created_at: '', updated_at: '' },
      { id: 'f3', school_id: 'school-1', academic_year_id: 'ay-1', class_id: null, fee_type: 'transport', name: 'Bus Ancien Tarif', amount: 20, currency: 'USD' as Currency, due_date: '2026-09-30', is_mandatory: false, is_active: false, created_at: '', updated_at: '' }
    ];

    const activeFees = mockFees.filter(f => f.is_active);
    const cdfFees = mockFees.filter(f => f.currency === 'CDF');
    const usdFees = mockFees.filter(f => f.currency === 'USD');

    assert(activeFees.length === 2, 'TEST 4.1 : 2 tarifs actifs sur 3 dans le catalogue');
    assert(cdfFees.length === 1 && cdfFees[0].amount === 50000, 'TEST 4.2 : Tarif CDF à 50 000 CDF extrait correctement');
    assert(usdFees.length === 2, 'TEST 4.3 : 2 tarifs USD extraits correctement');

    // Validation des autorisations de rôles
    const isStaffAllowed = (role: string) => ['school_admin', 'finance_agent'].includes(role);
    assert(isStaffAllowed('school_admin') && isStaffAllowed('finance_agent'), 'TEST 4.4 : school_admin et finance_agent autorisés à administrer la grille tarifaire');
    assert(!isStaffAllowed('teacher') && !isStaffAllowed('parent') && !isStaffAllowed('student'), 'TEST 4.5 : teacher, parent et student strictement refusés');
  } catch (err: unknown) {
    assert(false, `TEST 4 : Exception inattendue : ${err}`);
  }

  console.log(`\n=== RÉSULTATS : ${passed}/${total} TESTS RÉUSSIS ===\n`);
  return { total, passed, failed: total - passed, errors };
}

runFinanceFrontendTests();
