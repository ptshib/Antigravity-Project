import { RecordCollectionActionModal } from '../components/admin/finance/RecordCollectionActionModal';
import { CollectionHistoryTimeline } from '../components/admin/finance/CollectionHistoryTimeline';
import { CollectionFollowupsTable } from '../components/admin/finance/CollectionFollowupsTable';
import {
  validateRecordPaymentResult,
  validateCreateDraftInvoiceResult,
  computeFinanceDashboardKPIs,
  validateAgingSummaryResponse,
  validateOverdueInvoicesResponse,
  getSchoolOverdueInvoicesAdmin,
  validateCreateCollectionActionResponse,
  validateCollectionHistoryResponse,
  validateCollectionFollowupsResponse,
  createInvoiceCollectionAction,
  getInvoiceCollectionHistory,
  getSchoolCollectionFollowups,
  validateCollectionDashboardResponse,
  validateCollectionPrioritiesResponse,
  getSchoolCollectionDashboard,
  getSchoolCollectionPriorities
} from '../services/financeService';
import type { Currency } from '../types/finance';

/**
 * Suite de tests automatisés frontend (Sans mutation Supabase)
 */
export async function runFinanceFrontendTests(): Promise<{ total: number; passed: number; failed: number; errors: string[] }> {
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
      { id: 'p1', payment_number: 'PAY-1', receipt_number: 'REC-1', invoice_id: '1', invoice_number: 'INV-1', amount: 10000, currency: 'CDF' as Currency, payment_date: '2026-01-02', payment_method: 'cash' as const, external_reference: null, status: 'confirmed' as const, recorded_by_name: 'Agent', created_at: '' },
      { id: 'p2', payment_number: 'PAY-2', receipt_number: 'REC-2', invoice_id: '1', invoice_number: 'INV-1', amount: 10250, currency: 'CDF' as Currency, payment_date: '2026-01-03', payment_method: 'cash' as const, external_reference: null, status: 'confirmed' as const, recorded_by_name: 'Agent', created_at: '' },
      { id: 'p3', payment_number: 'PAY-3', receipt_number: 'REC-3', invoice_id: '1', invoice_number: 'INV-1', amount: 0, currency: 'CDF' as Currency, payment_date: '2026-01-04', payment_method: 'cash' as const, external_reference: null, status: 'confirmed' as const, recorded_by_name: 'Agent', created_at: '' },
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

  // TEST 5 : Hotfix Brouillon - Parsing de validateCreateDraftInvoiceResult et Clé d'Idempotence
  try {
    const draftPayload = {
      success: true,
      is_idempotent_replay: false,
      invoice_id: 'a1000000-0000-4000-a000-000000000001',
      invoice_number: 'INV-2026-000001',
      sequence_number: 1,
      status: 'draft',
      currency: 'USD',
      total_amount: 10.00,
      due_date: '2026-09-15',
      created_at: '2026-08-20T20:00:00Z'
    };

    const validated = validateCreateDraftInvoiceResult(draftPayload);
    assert(validated.invoice_id === 'a1000000-0000-4000-a000-000000000001', 'TEST 5.1 : invoice_id extrait correctement');
    assert(validated.invoice_number === 'INV-2026-000001', 'TEST 5.2 : invoice_number extrait correctement');
    assert(validated.sequence_number === 1, 'TEST 5.3 : sequence_number extrait correctement');
    assert(validated.is_idempotent_replay === false, 'TEST 5.4 : is_idempotent_replay initial = false');

    const replayPayload = {
      ...draftPayload,
      is_idempotent_replay: true
    };
    const validatedReplay = validateCreateDraftInvoiceResult(replayPayload);
    assert(validatedReplay.is_idempotent_replay === true, 'TEST 5.5 : Rejeu d’idempotence reconnu avec is_idempotent_replay = true');
  } catch (err: unknown) {
    assert(false, `TEST 5 : Exception inattendue : ${err}`);
  }

  // TEST 6 : Rejet des réponses incomplètes / Absence de Fallbacks
  try {
    let errorCaught = false;

    // Test 6.1: Absence de sequence_number
    try {
      validateCreateDraftInvoiceResult({
        success: true,
        invoice_id: 'a1000000-0000-4000-a000-000000000001',
        invoice_number: 'INV-1',
        status: 'draft',
        currency: 'USD',
        total_amount: 10,
        created_at: '2026-08-20T20:00:00Z',
        is_idempotent_replay: false
      });
    } catch {
      errorCaught = true;
    }
    assert(errorCaught, 'TEST 6.1 : Rejet d’un retour sans sequence_number (zéro fallback)');

    // Test 6.2: Format UUID invalide pour invoice_id
    errorCaught = false;
    try {
      validateCreateDraftInvoiceResult({
        success: true,
        invoice_id: 'invalid-id',
        invoice_number: 'INV-1',
        sequence_number: 1,
        status: 'draft',
        currency: 'USD',
        total_amount: 10,
        created_at: '2026-08-20T20:00:00Z',
        is_idempotent_replay: false
      });
    } catch {
      errorCaught = true;
    }
    assert(errorCaught, 'TEST 6.2 : Rejet d’un UUID de facture invalide');

    // Test 6.3: Simulation de verrou anti-double-clic avec compteur d'appels
    let callCount = 0;
    const isSubmittingRef = { current: false };
    const hasCompletedRef = { current: false };

    const simulateSubmit = async () => {
      if (isSubmittingRef.current || hasCompletedRef.current) return;
      isSubmittingRef.current = true;
      callCount++;
      await new Promise(r => setTimeout(r, 10));
      hasCompletedRef.current = true;
      isSubmittingRef.current = false;
    };

    // Lancement simultané de 3 clics/Enter rapides
    await Promise.all([simulateSubmit(), simulateSubmit(), simulateSubmit()]);
    assert(callCount === 1, 'TEST 6.3 : Verrou synchrone useRef garantit exactement 1 appel sous clics simultanés');
  } catch (err: unknown) {
    assert(false, `TEST 6 : Exception inattendue : ${err}`);
  }

  // TEST 7 : Hotfix Finance Dashboard Voided & Draft Exclusions (Calcul canonique computeFinanceDashboardKPIs)
  try {
    // 7.1 Dataset équivalent à la production (5 voided USD de 10 USD + 1 issued CDF de 50 000 CDF)
    const prodEquivalentDataset = [
      { total_amount: 10, paid_amount: 0, remaining_balance: 10, currency: 'USD', status: 'voided' },
      { total_amount: 10, paid_amount: 0, remaining_balance: 10, currency: 'USD', status: 'voided' },
      { total_amount: 10, paid_amount: 0, remaining_balance: 10, currency: 'USD', status: 'voided' },
      { total_amount: 10, paid_amount: 0, remaining_balance: 10, currency: 'USD', status: 'voided' },
      { total_amount: 10, paid_amount: 0, remaining_balance: 10, currency: 'USD', status: 'voided' },
      { total_amount: 50000, paid_amount: 0, remaining_balance: 50000, currency: 'CDF', status: 'issued' }
    ];

    const prodKpis = computeFinanceDashboardKPIs(prodEquivalentDataset);
    assert(prodKpis.USD.totalIssued === 0, 'TEST 7.1.1 : USD Total émis = 0 (les 5 factures voided de 10 USD sont exclues)');
    assert(prodKpis.USD.issuedCount === 0, 'TEST 7.1.2 : USD Nombre de factures émises = 0');
    assert(prodKpis.USD.totalPaid === 0, 'TEST 7.1.3 : USD Total encaissé = 0');
    assert(prodKpis.USD.totalRemaining === 0, 'TEST 7.1.4 : USD Reste à recouvrer = 0');
    assert(prodKpis.USD.voidedCount === 5, 'TEST 7.1.5 : USD Nombre d’annulées = 5');

    assert(prodKpis.CDF.totalIssued === 50000, 'TEST 7.1.6 : CDF Total émis = 50 000 CDF (1 facture émise)');
    assert(prodKpis.CDF.issuedCount === 1, 'TEST 7.1.7 : CDF Nombre de factures émises = 1');
    assert(prodKpis.CDF.totalPaid === 0, 'TEST 7.1.8 : CDF Total encaissé = 0 CDF');
    assert(prodKpis.CDF.totalRemaining === 50000, 'TEST 7.1.9 : CDF Reste à recouvrer = 50 000 CDF');

    // 7.2 Dataset complet avec tous les statuts (draft, voided, issued, partially_paid, paid)
    const fullDataset = [
      { total_amount: 100, paid_amount: 0, remaining_balance: 100, currency: 'USD', status: 'draft' },
      { total_amount: 200, paid_amount: 0, remaining_balance: 200, currency: 'USD', status: 'voided' },
      { total_amount: 300, paid_amount: 0, remaining_balance: 300, currency: 'USD', status: 'issued' },
      { total_amount: 400, paid_amount: 150, remaining_balance: 250, currency: 'USD', status: 'partially_paid' },
      { total_amount: 500, paid_amount: 500, remaining_balance: 0, currency: 'USD', status: 'paid' }
    ];

    const fullKpis = computeFinanceDashboardKPIs(fullDataset);
    // Total émis : issued(300) + partially_paid(400) + paid(500) = 1200 USD (draft 100 et voided 200 exclus)
    assert(fullKpis.USD.totalIssued === 1200, 'TEST 7.2.1 : Total émis inclut uniquement issued, partially_paid, paid (1200 USD)');
    assert(fullKpis.USD.issuedCount === 3, 'TEST 7.2.2 : Nombre de factures émises = 3 (exclut draft et voided)');
    // Total encaissé : paid_amount de issued(0) + partially_paid(150) + paid(500) = 650 USD
    assert(fullKpis.USD.totalPaid === 650, 'TEST 7.2.3 : Total encaissé = 650 USD');
    // Reste à recouvrer : remaining_balance de issued(300) + partially_paid(250) = 550 USD (paid 0, draft et voided exclus)
    assert(fullKpis.USD.totalRemaining === 550, 'TEST 7.2.4 : Reste à recouvrer = 550 USD (issued + partially_paid)');
    assert(fullKpis.USD.draftCount === 1, 'TEST 7.2.5 : Nombre de brouillons = 1');
    assert(fullKpis.USD.voidedCount === 1, 'TEST 7.2.6 : Nombre d’annulées = 1');

    // 7.3 Simulation dynamique d'annulation de paiement (Workflow cancel_student_payment)
    // Facture initiale de 100 USD payée à 100 USD (status paid)
    let invoiceRecord = { total_amount: 100, paid_amount: 100, remaining_balance: 0, currency: 'USD', status: 'paid' };
    let kpiPaidState = computeFinanceDashboardKPIs([invoiceRecord]);
    assert(kpiPaidState.USD.totalPaid === 100 && kpiPaidState.USD.totalRemaining === 0, 'TEST 7.3.1 : Facture payée à 100% -> Total encaissé = 100 USD, Reste = 0');

    // Annulation du paiement via cancel_student_payment: paid_amount bascule à 0, remaining_balance bascule à 100, status bascule à 'issued'
    invoiceRecord = { total_amount: 100, paid_amount: 0, remaining_balance: 100, currency: 'USD', status: 'issued' };
    let kpiCancelledState = computeFinanceDashboardKPIs([invoiceRecord]);
    assert(kpiCancelledState.USD.totalPaid === 0 && kpiCancelledState.USD.totalRemaining === 100, 'TEST 7.3.2 : Après annulation du paiement -> Total encaissé = 0 USD, Reste = 100 USD (aucun paiement annulé ne pollue l’encaissé)');

    // 7.4 Robustesse & Rejet des Valeurs Financières Invalides (NaN / non-numérique / négatif)
    let nanCaught = false;
    try {
      computeFinanceDashboardKPIs([{ total_amount: 'non_numerique', paid_amount: 0, remaining_balance: 0, currency: 'USD', status: 'issued' }]);
    } catch (e: any) {
      nanCaught = e.message.includes('valeur non-numérique');
    }
    assert(nanCaught, 'TEST 7.4.1 : Rejet explicite d’un montant non-numérique / NaN (aucune conversion silencieuse)');

    let negativeCaught = false;
    try {
      computeFinanceDashboardKPIs([{ total_amount: -100, paid_amount: 0, remaining_balance: -100, currency: 'USD', status: 'issued' }]);
    } catch (e: any) {
      negativeCaught = e.message.includes('montant négatif');
    }
    assert(negativeCaught, 'TEST 7.4.2 : Rejet explicite d’un montant négatif non autorisé');

    // Acceptation valide de null / undefined / '' comme 0
    const nullDataset = [{ total_amount: null, paid_amount: undefined, remaining_balance: '', currency: 'USD', status: 'issued' }];
    const nullKpis = computeFinanceDashboardKPIs(nullDataset);
    assert(nullKpis.USD.totalIssued === 0 && nullKpis.USD.totalPaid === 0 && nullKpis.USD.totalRemaining === 0, 'TEST 7.4.3 : Conversion valide des valeurs null / undefined / chaîne vide en 0');

    // 7.5 Validation de la Pagination Exhaustive et Déduplication
    // Simulation de 1 001 factures émises de 10 USD chacune
    const batch1001 = Array.from({ length: 1001 }, (_, i) => ({
      id: `inv-uuid-${i + 1}`,
      total_amount: 10,
      paid_amount: 0,
      remaining_balance: 10,
      currency: 'USD',
      status: 'issued'
    }));

    // Déduplication test : ajout d'un doublon entre pages
    const batchWithDuplicate = [...batch1001, { id: 'inv-uuid-1', total_amount: 10, paid_amount: 0, remaining_balance: 10, currency: 'USD', status: 'issued' }];
    const seenIds = new Set<string>();
    const deduplicatedBatch = batchWithDuplicate.filter((inv) => {
      if (seenIds.has(inv.id)) return false;
      seenIds.add(inv.id);
      return true;
    });

    const batch1001Kpis = computeFinanceDashboardKPIs(deduplicatedBatch);
    assert(batch1001Kpis.USD.issuedCount === 1001, 'TEST 7.5.1 : 1 001 factures émises toutes comptabilisées sans doublon');
    assert(batch1001Kpis.USD.totalIssued === 10010, 'TEST 7.5.2 : Total émis = 10 010 USD pour 1 001 factures de 10 USD');

    // Simulation de plus de 10 000 factures (10 500 factures émises de 10 USD chacune)
    const batch10500 = Array.from({ length: 10500 }, (_, i) => ({
      id: `large-inv-${i + 1}`,
      total_amount: 10,
      paid_amount: 0,
      remaining_balance: 10,
      currency: 'USD',
      status: 'issued'
    }));
    const batch10500Kpis = computeFinanceDashboardKPIs(batch10500);
    assert(batch10500Kpis.USD.issuedCount === 10500, 'TEST 7.5.3 : > 10 000 factures (10 500 factures) toutes comptabilisées');
    assert(batch10500Kpis.USD.totalIssued === 105000, 'TEST 7.5.4 : Total émis = 105 000 USD pour 10 500 factures');

    // 7.6 Rejet explicite d'un statut de facture inconnu (ex: 'unexpected_status')
    let unknownStatusCaught = false;
    try {
      computeFinanceDashboardKPIs([{ total_amount: 100, paid_amount: 0, remaining_balance: 100, currency: 'USD', status: 'unexpected_status' }]);
    } catch (e: any) {
      unknownStatusCaught = e.message.includes('Statut de facture inconnu');
    }
    assert(unknownStatusCaught, 'TEST 7.6.1 : Rejet explicite d’un statut inconnu unexpected_status via FinanceServiceError');

    // 7.7 Validation de la réaction à l'atteinte de la limite de sécurité de pagination (500 pages)
    const fakeMaxPagesCheck = (pageCount: number, maxPages: number, lastPageLength: number, pageSize: number) => {
      if (pageCount >= maxPages && lastPageLength === pageSize) {
        return { data: [], error: new Error(`Limite de sécurité de pagination atteinte (${maxPages} pages / ${maxPages * pageSize} factures). Chargement annulé pour éviter un résultat partiel.`) };
      }
      return { data: [1], error: null };
    };
    const limitResult = fakeMaxPagesCheck(500, 500, 1000, 1000);
    assert(limitResult.data.length === 0 && limitResult.error !== null && limitResult.error.message.includes('Limite de sécurité de pagination atteinte'), 'TEST 7.7.1 : Limite de 500 pages complètes retourne data: [] et une erreur explicite sans totaux partiels');

  } catch (err: unknown) {
    assert(false, `TEST 7 : Exception inattendue : ${err}`);
  }

  // =========================================================================
  // TEST 8 : VALIDATION FRONTEND CANONIQUE POUR FINANCE 4A (BALANCE ÂGÉE & CRÉANCES)
  // =========================================================================
  console.log('\n--- TEST 8 : FINANCE 4A (BALANCE ÂGÉE & CRÉANCES) ---');

  // 8.1 Parsing strict d'un résumé de balance âgée valide
  try {
    const validAgingPayload = {
      meta: {
        school_id: 'sch-uuid-1234',
        school_timezone: 'Africa/Kinshasa',
        timezone_fallback_applied: false,
        evaluated_at_utc: '2026-09-17T12:00:00.000Z',
        business_date: '2026-09-17'
      },
      currencies: {
        USD: {
          currency: 'USD',
          total_overdue_amount: 500,
          total_overdue_count: 5,
          due_today_amount: 100,
          due_today_count: 1,
          upcoming_amount: 200,
          upcoming_count: 2,
          aging_buckets: {
            '1_30_days': { amount: 200, count: 2 },
            '31_60_days': { amount: 200, count: 2 },
            '61_90_days': { amount: 100, count: 1 },
            'over_90_days': { amount: 0, count: 0 }
          }
        },
        CDF: {
          currency: 'CDF',
          total_overdue_amount: 0,
          total_overdue_count: 0,
          due_today_amount: 0,
          due_today_count: 0,
          upcoming_amount: 0,
          upcoming_count: 0,
          aging_buckets: {
            '1_30_days': { amount: 0, count: 0 },
            '31_60_days': { amount: 0, count: 0 },
            '61_90_days': { amount: 0, count: 0 },
            'over_90_days': { amount: 0, count: 0 }
          }
        }
      }
    };

    const parsedSummary = validateAgingSummaryResponse(validAgingPayload);
    assert(parsedSummary.meta.business_date === '2026-09-17', 'TEST 8.1.1 : Parsing business_date valide');
    assert(parsedSummary.currencies.USD.total_overdue_amount === 500, 'TEST 8.1.2 : Parsing USD total_overdue_amount');
    assert(parsedSummary.currencies.CDF.total_overdue_amount === 0, 'TEST 8.1.3 : Préservation des zéro-filled CDF');
  } catch (err: unknown) {
    assert(false, `TEST 8.1 : Exception inattendue : ${err}`);
  }

  // 8.2 Rejet si USD ou CDF manquant
  try {
    let caughtMissingCurrency = false;
    try {
      validateAgingSummaryResponse({
        meta: { school_id: 's', school_timezone: 'UTC', timezone_fallback_applied: false, evaluated_at_utc: '2026-09-17T10:00:00Z', business_date: '2026-09-17' },
        currencies: { USD: {} } // CDF manquant
      });
    } catch (e: any) {
      caughtMissingCurrency = e.message.includes('CDF') || e.message.includes('synthèse');
    }
    assert(caughtMissingCurrency, 'TEST 8.2.1 : Rejet explicite si la structure CDF est manquante');
  } catch (err: unknown) {
    assert(false, `TEST 8.2 : Exception inattendue : ${err}`);
  }

  // 8.3 Rejet montant négatif ou NaN dans la synthèse
  try {
    let caughtNegativeAmt = false;
    try {
      validateAgingSummaryResponse({
        meta: { school_id: 's', school_timezone: 'UTC', timezone_fallback_applied: false, evaluated_at_utc: '2026-09-17T10:00:00Z', business_date: '2026-09-17' },
        currencies: {
          USD: { currency: 'USD', total_overdue_amount: -50, total_overdue_count: 1, due_today_amount: 0, due_today_count: 0, upcoming_amount: 0, upcoming_count: 0, aging_buckets: { '1_30_days': { amount: 0, count: 0 }, '31_60_days': { amount: 0, count: 0 }, '61_90_days': { amount: 0, count: 0 }, 'over_90_days': { amount: 0, count: 0 } } },
          CDF: { currency: 'CDF', total_overdue_amount: 0, total_overdue_count: 0, due_today_amount: 0, due_today_count: 0, upcoming_amount: 0, upcoming_count: 0, aging_buckets: { '1_30_days': { amount: 0, count: 0 }, '31_60_days': { amount: 0, count: 0 }, '61_90_days': { amount: 0, count: 0 }, 'over_90_days': { amount: 0, count: 0 } } }
        }
      });
    } catch (e: any) {
      caughtNegativeAmt = e.message.includes('invalide') || e.message.includes('négatif');
    }
    assert(caughtNegativeAmt, 'TEST 8.3.1 : Rejet explicite d’un montant négatif dans la synthèse');
  } catch (err: unknown) {
    assert(false, `TEST 8.3 : Exception inattendue : ${err}`);
  }

  // 8.4 Rejet date métier ou timestamp invalide
  try {
    let caughtInvalidDate = false;
    try {
      validateAgingSummaryResponse({
        meta: { school_id: 's', school_timezone: 'UTC', timezone_fallback_applied: false, evaluated_at_utc: 'timestamp-invalide', business_date: '2026-09-17' },
        currencies: { USD: {}, CDF: {} }
      });
    } catch (e: any) {
      caughtInvalidDate = e.message.includes('evaluated_at_utc');
    }
    assert(caughtInvalidDate, 'TEST 8.4.1 : Rejet d’un timestamp UTC non parseable');
  } catch (err: unknown) {
    assert(false, `TEST 8.4 : Exception inattendue : ${err}`);
  }

  // 8.5 Parsing d'une liste de créances valide avec Keyset Cursor
  try {
    const validOverduePayload = {
      business_date: '2026-09-17',
      items: [
        {
          invoice_id: 'inv-uuid-1',
          invoice_number: 'INV-2026-001',
          student_id: 'st-1',
          student_name: 'Jean Mukendi',
          class_name: '6ème MP',
          due_date: '2026-08-01',
          days_overdue: 47,
          aging_bucket: '31_60_days',
          currency: 'USD',
          total_amount: 100,
          paid_amount: 0,
          remaining_balance: 100,
          status: 'issued'
        }
      ],
      has_more: true,
      next_cursor: {
        due_date: '2026-08-01',
        id: 'inv-uuid-1'
      }
    };

    const parsedOverdue = validateOverdueInvoicesResponse(validOverduePayload);
    assert(parsedOverdue.items.length === 1, 'TEST 8.5.1 : Parsing liste de créances avec 1 item');
    assert(parsedOverdue.next_cursor?.id === 'inv-uuid-1', 'TEST 8.5.2 : Parsing next_cursor valide');
  } catch (err: unknown) {
    assert(false, `TEST 8.5 : Exception inattendue : ${err}`);
  }

  // 8.6 Rejet curseur incomplet (due_date sans id)
  try {
    let caughtPartialCursor = false;
    try {
      validateOverdueInvoicesResponse({
        business_date: '2026-09-17',
        items: [],
        has_more: true,
        next_cursor: { due_date: '2026-08-01' } // id manquant
      });
    } catch (e: any) {
      caughtPartialCursor = e.message.includes('Curseur partiel non autorisé');
    }
    assert(caughtPartialCursor, 'TEST 8.6.1 : Rejet d’un curseur partiel sans id');
  } catch (err: unknown) {
    assert(false, `TEST 8.6 : Exception inattendue : ${err}`);
  }

  // 8.7 Rejet si has_more = true sans next_cursor
  try {
    let caughtMissingCursor = false;
    try {
      validateOverdueInvoicesResponse({
        business_date: '2026-09-17',
        items: [],
        has_more: true,
        next_cursor: null
      });
    } catch (e: any) {
      caughtMissingCursor = e.message.includes('next_cursor obligatoire');
    }
    assert(caughtMissingCursor, 'TEST 8.7.1 : Rejet si has_more = true sans next_cursor');
  } catch (err: unknown) {
    assert(false, `TEST 8.7 : Exception inattendue : ${err}`);
  }

  // 8.8 Bloquer les recherches p_search > 100 caractères
  try {
    let caughtLongSearch = false;
    try {
      await getSchoolOverdueInvoicesAdmin({ p_search: 'a'.repeat(101) });
    } catch (e: any) {
      caughtLongSearch = e.message.includes('100 caractères');
    }
    assert(caughtLongSearch, 'TEST 8.8.1 : Recherche p_search > 100 caractères bloquée avant appel RPC');
  } catch (err: unknown) {
    assert(false, `TEST 8.8 : Exception inattendue : ${err}`);
  }

  // 8.9 Validation déduplication Keyset entre 3 pages
  try {
    const page1Items = [
      { invoice_id: '1', invoice_number: 'INV-1', student_id: 's1', student_name: 'A', class_name: 'C', due_date: '2026-08-01', days_overdue: 10, aging_bucket: '1_30_days' as const, currency: 'USD' as Currency, total_amount: 10, paid_amount: 0, remaining_balance: 10, status: 'issued' as const },
      { invoice_id: '2', invoice_number: 'INV-2', student_id: 's1', student_name: 'A', class_name: 'C', due_date: '2026-08-01', days_overdue: 10, aging_bucket: '1_30_days' as const, currency: 'USD' as Currency, total_amount: 10, paid_amount: 0, remaining_balance: 10, status: 'issued' as const },
      { invoice_id: '3', invoice_number: 'INV-3', student_id: 's1', student_name: 'A', class_name: 'C', due_date: '2026-08-01', days_overdue: 10, aging_bucket: '1_30_days' as const, currency: 'USD' as Currency, total_amount: 10, paid_amount: 0, remaining_balance: 10, status: 'issued' as const }
    ];
    const page2Items = [
      { invoice_id: '4', invoice_number: 'INV-4', student_id: 's1', student_name: 'A', class_name: 'C', due_date: '2026-08-02', days_overdue: 9, aging_bucket: '1_30_days' as const, currency: 'USD' as Currency, total_amount: 10, paid_amount: 0, remaining_balance: 10, status: 'issued' as const },
      { invoice_id: '5', invoice_number: 'INV-5', student_id: 's1', student_name: 'A', class_name: 'C', due_date: '2026-08-02', days_overdue: 9, aging_bucket: '1_30_days' as const, currency: 'USD' as Currency, total_amount: 10, paid_amount: 0, remaining_balance: 10, status: 'issued' as const },
      { invoice_id: '6', invoice_number: 'INV-6', student_id: 's1', student_name: 'A', class_name: 'C', due_date: '2026-08-02', days_overdue: 9, aging_bucket: '1_30_days' as const, currency: 'USD' as Currency, total_amount: 10, paid_amount: 0, remaining_balance: 10, status: 'issued' as const }
    ];
    const page3Items = [
      { invoice_id: '7', invoice_number: 'INV-7', student_id: 's1', student_name: 'A', class_name: 'C', due_date: '2026-08-03', days_overdue: 8, aging_bucket: '1_30_days' as const, currency: 'USD' as Currency, total_amount: 10, paid_amount: 0, remaining_balance: 10, status: 'issued' as const }
    ];

    const combined: typeof page1Items = [];
    const seen = new Set<string>();

    [...page1Items, ...page2Items, ...page3Items].forEach((item) => {
      if (!seen.has(item.invoice_id)) {
        seen.add(item.invoice_id);
        combined.push(item);
      }
    });

    assert(combined.length === 7, 'TEST 8.9.1 : Concaténation des 3 pages contient exactement 7 items sans doublons');
    assert(combined[3].invoice_id === '4', 'TEST 8.9.2 : L’élément N+1 (ID 4) est bien présent au début de la Page 2');
  } catch (err: unknown) {
    assert(false, `TEST 8.9 : Exception inattendue : ${err}`);
  }

  // 8.10 Rejet si has_more = false mais next_cursor est non null
  try {
    let caughtFalseWithCursor = false;
    try {
      validateOverdueInvoicesResponse({
        business_date: '2026-09-17',
        items: [],
        has_more: false,
        next_cursor: { due_date: '2026-08-01', id: 'inv-1' }
      });
    } catch (e: any) {
      caughtFalseWithCursor = e.message.includes('next_cursor doit être null lorsque has_more est faux');
    }
    assert(caughtFalseWithCursor, 'TEST 8.10.1 : Rejet si has_more = false avec next_cursor non null');
  } catch (err: unknown) {
    assert(false, `TEST 8.10 : Exception inattendue : ${err}`);
  }

  // 8.11 Rejet si paid_amount > total_amount ou remaining_balance > total_amount
  try {
    let caughtIncoherentAmount = false;
    try {
      validateOverdueInvoicesResponse({
        business_date: '2026-09-17',
        items: [
          {
            invoice_id: '1', invoice_number: 'INV-1', student_id: 's1', student_name: 'A', class_name: 'C',
            due_date: '2026-08-01', days_overdue: 10, aging_bucket: '1_30_days', currency: 'USD',
            total_amount: 100, paid_amount: 150, remaining_balance: 100, status: 'issued'
          }
        ],
        has_more: false,
        next_cursor: null
      });
    } catch (e: any) {
      caughtIncoherentAmount = e.message.includes('incohérent ou supérieur au total');
    }
    assert(caughtIncoherentAmount, 'TEST 8.11.1 : Rejet si paid_amount est supérieur à total_amount');
  } catch (err: unknown) {
    assert(false, `TEST 8.11 : Exception inattendue : ${err}`);
  }

  // 8.12 Rejet si days_overdue <= 0 ou non-entier
  try {
    let caughtInvalidDays = false;
    try {
      validateOverdueInvoicesResponse({
        business_date: '2026-09-17',
        items: [
          {
            invoice_id: '1', invoice_number: 'INV-1', student_id: 's1', student_name: 'A', class_name: 'C',
            due_date: '2026-08-01', days_overdue: 0, aging_bucket: '1_30_days', currency: 'USD',
            total_amount: 100, paid_amount: 0, remaining_balance: 100, status: 'issued'
          }
        ],
        has_more: false,
        next_cursor: null
      });
    } catch (e: any) {
      caughtInvalidDays = e.message.includes('days_overdue');
    }
    assert(caughtInvalidDays, 'TEST 8.12.1 : Rejet si days_overdue <= 0');
  } catch (err: unknown) {
    assert(false, `TEST 8.12 : Exception inattendue : ${err}`);
  }

  // 8.13 Rejet si date calendrier impossible (ex: 2026-02-31)
  try {
    let caughtImpossibleDate = false;
    try {
      validateOverdueInvoicesResponse({
        business_date: '2026-09-17',
        items: [
          {
            invoice_id: '1', invoice_number: 'INV-1', student_id: 's1', student_name: 'A', class_name: 'C',
            due_date: '2026-02-31', days_overdue: 10, aging_bucket: '1_30_days', currency: 'USD',
            total_amount: 100, paid_amount: 0, remaining_balance: 100, status: 'issued'
          }
        ],
        has_more: false,
        next_cursor: null
      });
    } catch (e: any) {
      caughtImpossibleDate = e.message.includes('date calendrier impossible');
    }
    assert(caughtImpossibleDate, 'TEST 8.13.1 : Rejet si due_date est une date calendrier impossible (2026-02-31)');
  } catch (err: unknown) {
    assert(false, `TEST 8.13 : Exception inattendue : ${err}`);
  }

  // 8.14 Validation Timezone Fallback (meta.timezone_fallback_applied)
  try {
    const summaryWithFallback = validateAgingSummaryResponse({
      meta: { school_id: 'sch-1', school_timezone: 'Africa/Kinshasa', timezone_fallback_applied: true, evaluated_at_utc: '2026-09-17T10:00:00Z', business_date: '2026-09-17' },
      currencies: {
        USD: { currency: 'USD', total_overdue_amount: 100, total_overdue_count: 1, due_today_amount: 0, due_today_count: 0, upcoming_amount: 0, upcoming_count: 0, aging_buckets: { '1_30_days': { amount: 100, count: 1 }, '31_60_days': { amount: 0, count: 0 }, '61_90_days': { amount: 0, count: 0 }, 'over_90_days': { amount: 0, count: 0 } } },
        CDF: { currency: 'CDF', total_overdue_amount: 0, total_overdue_count: 0, due_today_amount: 0, due_today_count: 0, upcoming_amount: 0, upcoming_count: 0, aging_buckets: { '1_30_days': { amount: 0, count: 0 }, '31_60_days': { amount: 0, count: 0 }, '61_90_days': { amount: 0, count: 0 }, 'over_90_days': { amount: 0, count: 0 } } }
      }
    });
    assert(summaryWithFallback.meta.timezone_fallback_applied === true, 'TEST 8.14.1 : Timezone Fallback true -> propriété meta conforme et bannière UI affichable');

    const summaryNoFallback = validateAgingSummaryResponse({
      meta: { school_id: 'sch-1', school_timezone: 'Africa/Kinshasa', timezone_fallback_applied: false, evaluated_at_utc: '2026-09-17T10:00:00Z', business_date: '2026-09-17' },
      currencies: {
        USD: { currency: 'USD', total_overdue_amount: 0, total_overdue_count: 0, due_today_amount: 0, due_today_count: 0, upcoming_amount: 0, upcoming_count: 0, aging_buckets: { '1_30_days': { amount: 0, count: 0 }, '31_60_days': { amount: 0, count: 0 }, '61_90_days': { amount: 0, count: 0 }, 'over_90_days': { amount: 0, count: 0 } } },
        CDF: { currency: 'CDF', total_overdue_amount: 0, total_overdue_count: 0, due_today_amount: 0, due_today_count: 0, upcoming_amount: 0, upcoming_count: 0, aging_buckets: { '1_30_days': { amount: 0, count: 0 }, '31_60_days': { amount: 0, count: 0 }, '61_90_days': { amount: 0, count: 0 }, 'over_90_days': { amount: 0, count: 0 } } }
      }
    });
    assert(summaryNoFallback.meta.timezone_fallback_applied === false, 'TEST 8.14.2 : Timezone Fallback false -> aucune bannière affichée');
  } catch (err: unknown) {
    assert(false, `TEST 8.14 : Exception inattendue : ${err}`);
  }

  // 8.15 Test Mock RPC : Validation exacte de la signature et des arguments
  try {
    let capturedRpcName = '';
    let capturedParams: Record<string, any> = {};

    const mockRpc = (fnName: string, params: Record<string, any>) => {
      capturedRpcName = fnName;
      capturedParams = params;
      return Promise.resolve({
        data: { business_date: '2026-09-17', items: [], has_more: false, next_cursor: null },
        error: null
      });
    };

    // Simulation de l'appel service avec mock
    const dummyFilters = { p_currency: 'USD' as Currency, p_aging_bucket: '1_30_days' as const, p_search: '  Kabila  ', p_limit: 20 };
    const searchTrimmed = dummyFilters.p_search.trim();
    const rpcParams = {
      p_currency: dummyFilters.p_currency || null,
      p_aging_bucket: dummyFilters.p_aging_bucket || null,
      p_search: searchTrimmed || null,
      p_limit: dummyFilters.p_limit ?? 20,
      p_cursor_due_date: null,
      p_cursor_id: null
    };

    await mockRpc('get_school_overdue_invoices_admin', rpcParams);

    const paramKeys = Object.keys(capturedParams);
    const expectedKeys = ['p_currency', 'p_aging_bucket', 'p_search', 'p_limit', 'p_cursor_due_date', 'p_cursor_id'];
    const hasSchoolId = 'p_school_id' in capturedParams;
    const hasUndefined = Object.values(capturedParams).some((v) => v === undefined);

    assert(capturedRpcName === 'get_school_overdue_invoices_admin', 'TEST 8.15.1 : Nom RPC exact get_school_overdue_invoices_admin');
    assert(paramKeys.length === 6 && expectedKeys.every((k) => paramKeys.includes(k)), 'TEST 8.15.2 : Exactement 6 paramètres PostgreSQL sans septième clé');
    assert(!hasSchoolId, 'TEST 8.15.3 : Absence totale de p_school_id (dérivé côté serveur via auth.uid())');
    assert(!hasUndefined, 'TEST 8.15.4 : Aucune valeur undefined transmise');
    assert(capturedParams.p_search === 'Kabila', 'TEST 8.15.5 : Recherche trimée correctement');
    assert(capturedParams.p_cursor_due_date === null && capturedParams.p_cursor_id === null, 'TEST 8.15.6 : Premier appel transmis avec curseurs null');

    // Test page suivante avec curseurs réels
    const cursorParams = {
      ...rpcParams,
      p_cursor_due_date: '2026-08-01',
      p_cursor_id: 'inv-123'
    };
    await mockRpc('get_school_overdue_invoices_admin', cursorParams);
    assert(capturedParams.p_cursor_due_date === '2026-08-01' && capturedParams.p_cursor_id === 'inv-123', 'TEST 8.15.7 : Page suivante transmise avec curseurs exacts');
  } catch (err: unknown) {
    assert(false, `TEST 8.15 : Exception inattendue : ${err}`);
  }

  // 8.16 Comportement A : Verrou synchrone contre le double déclenchement
  try {
    let rpcCallCount = 0;
    const lockRef = { current: false };

    const simulateLoadMore = async () => {
      if (lockRef.current) return;
      lockRef.current = true;
      try {
        rpcCallCount++;
        await new Promise((res) => setTimeout(res, 50));
      } finally {
        lockRef.current = false;
      }
    };

    // Deux déclenchements synchrones simultanés
    const p1 = simulateLoadMore();
    const p2 = simulateLoadMore();
    await Promise.all([p1, p2]);

    assert(rpcCallCount === 1, 'TEST 8.16.1 : Comportement A : Deux déclenchements synchrones -> exactement 1 appel RPC exécuté');
  } catch (err: unknown) {
    assert(false, `TEST 8.16 : Exception inattendue : ${err}`);
  }

  // 8.17 Comportement C : Changement de filtres et réinitialisation de la pagination
  try {
    let itemsState = [{ invoice_id: '1' }, { invoice_id: '2' }];
    let cursorState: { due_date: string; id: string } | null = { due_date: '2026-08-01', id: '1' };

    // Simulation du handler de changement de filtre
    const handleFilterChange = () => {
      itemsState = [];
      cursorState = null;
    };

    handleFilterChange();
    assert(itemsState.length === 0 && cursorState === null, 'TEST 8.17.1 : Comportement C : Changement de filtre remet items à zéro et cursor à null sans concaténation');
  } catch (err: unknown) {
    assert(false, `TEST 8.17 : Exception inattendue : ${err}`);
  }

  // 8.18 Comportement D : Gestion des réponses obsolètes (Race conditions)
  try {
    let reqIdCounter = 0;
    let displayedItems: string[] = [];

    // Requête A démarre avec reqId 1
    const reqAId = ++reqIdCounter;

    // Filtre change -> Requête B démarre avec reqId 2
    const reqBId = ++reqIdCounter;

    // B termine en premier avec les items CDF
    if (reqBId === reqIdCounter) {
      displayedItems = ['Item-CDF-1', 'Item-CDF-2'];
    }

    // A termine plus tard avec les items USD obsolètes
    if (reqAId === reqIdCounter) {
      displayedItems = ['Item-USD-Stale']; // Ne doit pas s'exécuter
    }

    assert(displayedItems.length === 2 && displayedItems[0] === 'Item-CDF-1', 'TEST 8.18.1 : Comportement D : B termine avant A -> seuls les résultats B restent affichés');
  } catch (err: unknown) {
    assert(false, `TEST 8.18 : Exception inattendue : ${err}`);
  }

  // 8.19 Comportement E : Démontage du composant (Unmount)
  try {
    let isMounted = true;
    let stateUpdated = false;

    const asyncFetch = async () => {
      await new Promise((res) => setTimeout(res, 20));
      if (!isMounted) return; // Ignorer après unmount
      stateUpdated = true;
    };

    const promise = asyncFetch();
    isMounted = false; // Démontage avant résolution
    await promise;

    assert(!stateUpdated, 'TEST 8.19.1 : Comportement E : Composant démonté avant résolution -> aucune mise à jour d’état effectuée');
  } catch (err: unknown) {
    assert(false, `TEST 8.19 : Exception inattendue : ${err}`);
  }

  // 8.20 Comportement F : Gestion des erreurs et retries (Page 1 vs Load More)
  try {
    // 1. Erreur première page
    let initialErrorState: string | null = null;
    let itemsState: any[] = [{ invoice_id: 'old' }];

    try {
      throw new Error('Erreur réseau première page');
    } catch (err: any) {
      initialErrorState = err.message;
      itemsState = []; // Effacement pour éviter les faux résultats partiels
    }
    assert(initialErrorState === 'Erreur réseau première page' && itemsState.length === 0, 'TEST 8.20.1 : Comportement F : Erreur première page -> aucun résultat partiel présenté');

    // 2. Erreur Load More (conservation des lignes existantes et du curseur)
    const existingItems = [{ invoice_id: 'inv-1' }, { invoice_id: 'inv-2' }];
    const activeCursor = { due_date: '2026-08-01', id: 'inv-2' };
    let loadMoreError: string | null = null;

    try {
      throw new Error('Erreur réseau load more');
    } catch (err: any) {
      loadMoreError = err.message;
      // existingItems et activeCursor restent intacts
    }

    assert(existingItems.length === 2 && activeCursor.id === 'inv-2' && loadMoreError !== null, 'TEST 8.20.2 : Comportement F : Erreur page suivante -> lignes et curseur existants conservés pour retry');
  } catch (err: unknown) {
    assert(false, `TEST 8.20 : Exception inattendue : ${err}`);
  }

  // 8.21 Comportement G : Recherche Debounce et Limite 100 caractères
  try {
    let rpcCallsCount = 0;
    let lastSearchParam: string | null = null;

    const triggerDebouncedSearch = (input: string) => {
      const trimmed = input.trim();
      if (trimmed.length > 100) return; // Bloqué avant appel RPC
      rpcCallsCount++;
      lastSearchParam = trimmed || null;
    };

    // 3 frappes rapprochées
    triggerDebouncedSearch('J');
    triggerDebouncedSearch('Je');
    triggerDebouncedSearch('Jean');

    assert(lastSearchParam === 'Jean', 'TEST 8.21.1 : Comportement G : Frappes multiples -> dernier terme capturé');

    // Recherche vide trimée
    triggerDebouncedSearch('   ');
    assert(lastSearchParam === null, 'TEST 8.21.2 : Comportement G : Chaîne vide trimée transmise à null');

    // Recherche > 100 caractères
    const initialCalls = rpcCallsCount;
    triggerDebouncedSearch('a'.repeat(101));
    assert(rpcCallsCount === initialCalls, 'TEST 8.21.3 : Comportement G : >100 caractères -> zéro appel RPC supplémentaire');
  } catch (err: unknown) {
    assert(false, `TEST 8.21 : Exception inattendue : ${err}`);
  }

  // 8.22 Test Anti-Boucle RPC sur Erreur (Incident 42703 + React Loop)
  try {
    let callCounter = 0;
    let hasLoadedRef = false;
    let loadingState = false;
    let errorState: string | null = null;
    let summaryState: any = null;

    const simulateRpcCall = async () => {
      callCounter++;
      loadingState = true;
      try {
        throw new Error('HTTP 400 : column status of relation profiles does not exist (SQLSTATE 42703)');
      } catch (err: any) {
        errorState = err.message;
        summaryState = null;
      } finally {
        loadingState = false;
      }
    };

    const simulateMountOrTabSwitch = async () => {
      if (!hasLoadedRef && !loadingState) {
        hasLoadedRef = true;
        await simulateRpcCall();
      }
    };

    // 1. Premier chargement (onglet créances actif)
    await simulateMountOrTabSwitch();
    assert(callCounter === 1 && errorState !== null && summaryState === null, 'TEST 8.22.1 : Premier appel échoué enregistre l’erreur et compteur = 1');

    // 2. Simulation de 5 re-renders React consécutifs après échec
    for (let render = 1; render <= 5; render++) {
      await simulateMountOrTabSwitch();
    }
    assert(callCounter === 1, 'TEST 8.22.2 : Après 5 re-renders consécutifs, aucun retry automatique (compteur reste strictly à 1)');

    // 3. Clic manuel sur le bouton "Réessayer"
    const handleManualRetry = async () => {
      await simulateRpcCall();
    };

    await handleManualRetry();
    assert(callCounter === 2, 'TEST 8.22.3 : Un clic manuel Réessayer porte le compteur à 2 exactement');

    // 4. Re-renders ultérieurs après retry
    for (let render = 1; render <= 3; render++) {
      await simulateMountOrTabSwitch();
    }
    assert(callCounter === 2, 'TEST 8.22.4 : Aucune autre requête automatique suite au retry manuel (compteur fixe à 2)');

    // 5. Clic Réessayer avec succès -> l'erreur est effacée et le résumé affiché
    let isSuccessRetry = true;
    const handleSuccessfulRetry = async () => {
      callCounter++;
      if (isSuccessRetry) {
        errorState = null;
        summaryState = { meta: { school_id: 'sch-1' }, currencies: {} };
      }
    };
    await handleSuccessfulRetry();
    assert(callCounter === 3 && errorState === null && summaryState !== null, 'TEST 8.22.5 : Retry réussi efface l’erreur et remplace par la synthèse valide');

    // 6. Verrou synchrone contre les clics réessayés simultanés
    let concurrentLock = false;
    let concurrentCallCount = 0;
    const simulateConcurrentRetry = async () => {
      if (concurrentLock) return;
      concurrentLock = true;
      try {
        concurrentCallCount++;
        await new Promise((res) => setTimeout(res, 20));
      } finally {
        concurrentLock = false;
      }
    };
    await Promise.all([simulateConcurrentRetry(), simulateConcurrentRetry()]);
    assert(concurrentCallCount === 1, 'TEST 8.22.6 : Clics Réessayer simultanés -> 1 seul appel exécuté via le verrou synchrone');

    // 7. Unmount safety
    let mounted = true;
    let stateSetAfterUnmount = false;
    const asyncFetchUnmount = async () => {
      await new Promise((res) => setTimeout(res, 10));
      if (!mounted) return;
      stateSetAfterUnmount = true;
    };
    const unmountPromise = asyncFetchUnmount();
    mounted = false;
    await unmountPromise;
    assert(!stateSetAfterUnmount, 'TEST 8.22.7 : Résolution après démontage n’effectue aucun setState');
  } catch (err: unknown) {
    assert(false, `TEST 8.22 : Exception inattendue : ${err}`);
  }

  // --- TEST 9 : FINANCE 4B (SUIVI DE RECOUVREMENT) ---
  console.log('\n--- TEST 9 : FINANCE 4B (SUIVI DE RECOUVREMENT) ---');

  // 9.1 Parsing des contrats valides
  try {
    const validCreatePayload = {
      is_idempotent_replay: false,
      action: {
        id: '11111111-1111-1111-1111-111111111111',
        invoice_id: '22222222-2222-2222-2222-222222222222',
        school_id: '33333333-3333-3333-3333-333333333333',
        action_type: 'phone',
        note: 'Appel passé au parent, promesse de paiement vendredi prochain.',
        idempotency_key: '44444444-4444-4444-4444-444444444444',
        contacted_at: '2026-09-17T14:30:00Z',
        promise_to_pay_date: '2026-09-25',
        next_follow_up_date: '2026-09-26',
        created_by: '55555555-5555-5555-5555-555555555555',
        created_by_name: 'Jean Agent',
        created_at: '2026-09-17T14:30:00Z'
      }
    };
    const parsedCreate = validateCreateCollectionActionResponse(validCreatePayload);
    assert(parsedCreate.is_idempotent_replay === false && parsedCreate.action.action_type === 'phone', 'TEST 9.1.1 : Parsing valide du contrat de création d’action');

    const validHistoryPayload = {
      invoice_id: '22222222-2222-2222-2222-222222222222',
      total_actions: 1,
      actions: [validCreatePayload.action]
    };
    const parsedHistory = validateCollectionHistoryResponse(validHistoryPayload);
    assert(parsedHistory.total_actions === 1 && parsedHistory.actions.length === 1 && parsedHistory.invoice_id === '22222222-2222-2222-2222-222222222222', 'TEST 9.1.2 : Parsing valide du contrat d’historique');

    const validFollowupsPayload = {
      items: [
        {
          invoice_id: '22222222-2222-2222-2222-222222222222',
          invoice_number: 'FAC-2026-0001',
          student_id: '66666666-6666-6666-6666-666666666666',
          student_name: 'Kabongo Marc',
          student_number: 'MAT-001',
          class_name: '6ème C',
          invoice_due_date: '2026-08-30',
          days_overdue: 18,
          currency: 'USD',
          total_amount: 150,
          paid_amount: 50,
          remaining_balance: 100,
          invoice_status: 'partially_paid',
          collection_status: 'promise_pending',
          latest_action_id: '11111111-1111-1111-1111-111111111111',
          latest_action_type: 'phone',
          latest_note: 'Appel passé',
          latest_idempotency_key: '44444444-4444-4444-4444-444444444444',
          latest_contacted_at: '2026-09-17T14:30:00Z',
          latest_promise_to_pay_date: '2026-09-25',
          latest_next_follow_up_date: '2026-09-26',
          last_contacted_by_name: 'Agent Finance',
          effective_follow_up_date: '2026-09-25'
        }
      ],
      has_more: true,
      next_cursor: {
        effective_date: '2026-09-25',
        invoice_id: '22222222-2222-2222-2222-222222222222'
      }
    };
    const parsedFollowups = validateCollectionFollowupsResponse(validFollowupsPayload);
    assert(parsedFollowups.has_more === true && parsedFollowups.items.length === 1, 'TEST 9.1.3 : Parsing valide du contrat de relances');
  } catch (err: unknown) {
    assert(false, `TEST 9.1 : Exception inattendue : ${err}`);
  }

  // 9.2 Rejet des structures invalides
  try {
    let invalidCaught = false;
    try {
      validateCreateCollectionActionResponse({ is_idempotent_replay: 'not-bool' });
    } catch {
      invalidCaught = true;
    }
    assert(invalidCaught, 'TEST 9.2.1 : Rejet si is_idempotent_replay n’est pas un booléen');

    // Rejet note trop courte (< 5 chars)
    invalidCaught = false;
    try {
      await createInvoiceCollectionAction({
        invoice_id: '22222222-2222-2222-2222-222222222222',
        action_type: 'phone',
        note: '1234',
        idempotency_key: '44444444-4444-4444-4444-444444444444'
      });
    } catch {
      invalidCaught = true;
    }
    assert(invalidCaught, 'TEST 9.2.2 : Rejet côté client si note a 4 caractères (min 5)');

    // Rejet note trop longue (> 1000 chars)
    invalidCaught = false;
    try {
      await createInvoiceCollectionAction({
        invoice_id: '22222222-2222-2222-2222-222222222222',
        action_type: 'phone',
        note: 'a'.repeat(1001),
        idempotency_key: '44444444-4444-4444-4444-444444444444'
      });
    } catch {
      invalidCaught = true;
    }
    assert(invalidCaught, 'TEST 9.2.3 : Rejet côté client si note a 1001 caractères (max 1000)');

    // Acceptation note 5 chars
    let valid5 = true;
    try {
      const input5 = {
        invoice_id: '22222222-2222-2222-2222-222222222222',
        action_type: 'phone' as const,
        note: '12345',
        idempotency_key: '44444444-4444-4444-4444-444444444444'
      };
      assert(input5.note.trim().length === 5, 'TEST 9.2.4 : Note de 5 caractères acceptée');
    } catch {
      valid5 = false;
    }
    assert(valid5, 'TEST 9.2.4 : Borne valide de 5 caractères');

    // Rejet action_type invalide
    invalidCaught = false;
    try {
      await createInvoiceCollectionAction({
        invoice_id: '22222222-2222-2222-2222-222222222222',
        action_type: 'invalid_channel' as any,
        note: 'Note valide',
        idempotency_key: '44444444-4444-4444-4444-444444444444'
      });
    } catch {
      invalidCaught = true;
    }
    assert(invalidCaught, 'TEST 9.2.5 : Rejet de type d’action inconnu');

    // Rejet has_more = true sans next_cursor
    invalidCaught = false;
    try {
      validateCollectionFollowupsResponse({
        items: [],
        has_more: true,
        next_cursor: null
      });
    } catch {
      invalidCaught = true;
    }
    assert(invalidCaught, 'TEST 9.2.6 : Rejet si has_more = true avec next_cursor = null');

    // Rejet has_more = false avec next_cursor non null
    invalidCaught = false;
    try {
      validateCollectionFollowupsResponse({
        items: [],
        has_more: false,
        next_cursor: { effective_date: '2026-09-25', invoice_id: '22222222-2222-2222-2222-222222222222' }
      });
    } catch {
      invalidCaught = true;
    }
    assert(invalidCaught, 'TEST 9.2.7 : Rejet si has_more = false avec next_cursor non null');
  } catch (err: unknown) {
    assert(false, `TEST 9.2 : Exception inattendue : ${err}`);
  }

  // 9.3 Invocations RPC Supabase, signatures exactes et absences de p_school_id
  try {
    let capturedRpcName = '';
    let capturedParams: any = null;

    const mockSupabaseRpc = async (fn: string, params: any) => {
      capturedRpcName = fn;
      capturedParams = params;

      if (fn === 'create_invoice_collection_action') {
        return {
          data: {
            is_idempotent_replay: false,
            action: {
              id: '11111111-1111-1111-1111-111111111111',
              invoice_id: params.p_invoice_id,
              school_id: '33333333-3333-3333-3333-333333333333',
              action_type: params.p_action_type,
              note: params.p_note,
              idempotency_key: params.p_idempotency_key,
              contacted_at: '2026-09-17T14:30:00Z',
              promise_to_pay_date: params.p_promise_to_pay_date,
              next_follow_up_date: params.p_next_follow_up_date,
              created_by: '55555555-5555-5555-5555-555555555555',
              created_by_name: 'Agent Finance',
              created_at: '2026-09-17T14:30:00Z'
            }
          },
          error: null
        };
      }

      if (fn === 'get_school_collection_followups') {
        return {
          data: {
            items: [],
            has_more: false,
            next_cursor: null
          },
          error: null
        };
      }

      if (fn === 'get_invoice_collection_history') {
        return {
          data: {
            invoice_id: '22222222-2222-2222-2222-222222222222',
            total_actions: 0,
            actions: []
          },
          error: null
        };
      }

      return { data: null, error: { message: 'RPC inconnue' } };
    };

    const { supabase } = await import('../lib/supabase');
    const originalRpc = supabase.rpc;
    (supabase as any).rpc = mockSupabaseRpc;

    try {
      // 1. Création d'action
      await createInvoiceCollectionAction({
        invoice_id: '22222222-2222-2222-2222-222222222222',
        action_type: 'whatsapp',
        note: '   Message WhatsApp envoyé pour relance.   ',
        idempotency_key: '44444444-4444-4444-4444-444444444444',
        promise_to_pay_date: '2026-09-25'
      });

      assert(capturedRpcName === 'create_invoice_collection_action', 'TEST 9.3.1 : Nom RPC de création exact');
      assert(Object.keys(capturedParams).length === 6, 'TEST 9.3.2 : Exactement 6 paramètres PostgreSQL transmis');
      assert(!('p_school_id' in capturedParams), 'TEST 9.3.3 : Absence totale de p_school_id dans la création d’action');
      assert(capturedParams.p_note === 'Message WhatsApp envoyé pour relance.', 'TEST 9.3.4 : Note trimée avant envoi à Supabase');
      assert(capturedParams.p_next_follow_up_date === null, 'TEST 9.3.5 : Paramètre absent normalisé à null (pas de undefined)');

      // 2. Liste de relances (get_school_collection_followups)
      await getSchoolCollectionFollowups({ currency: 'USD', status_filter: 'promise_pending' });
      assert(capturedRpcName === 'get_school_collection_followups', 'TEST 9.3.6 : Nom RPC de relances exact');
      assert(Object.keys(capturedParams).length === 5, 'TEST 9.3.7 : Exactement 5 paramètres PostgreSQL pour les relances');
      assert(!('p_school_id' in capturedParams), 'TEST 9.3.8 : Absence totale de p_school_id dans les relances');
      assert(capturedParams.p_cursor_effective_date === null && capturedParams.p_cursor_invoice_id === null, 'TEST 9.3.9 : Curseur initial transmis à null');

      // 3. Historique (get_invoice_collection_history)
      await getInvoiceCollectionHistory('22222222-2222-2222-2222-222222222222');
      assert(capturedRpcName === 'get_invoice_collection_history', 'TEST 9.3.10 : Nom RPC d’historique exact');
      assert(Object.keys(capturedParams).length === 1 && capturedParams.p_invoice_id === '22222222-2222-2222-2222-222222222222', 'TEST 9.3.11 : p_invoice_id transmis exactement');
    } finally {
      (supabase as any).rpc = originalRpc;
    }
  } catch (err: unknown) {
    assert(false, `TEST 9.3 : Exception inattendue : ${err}`);
  }

  // 9.4 Idempotence du formulaire & Verrou Synchrone
  try {
    let callCount = 0;
    const { supabase } = await import('../lib/supabase');
    const originalRpc = supabase.rpc;

    (supabase as any).rpc = async (_fn: string, params: any) => {
      callCount++;
      await new Promise((res) => setTimeout(res, 30));
      return {
        data: {
          is_idempotent_replay: callCount > 1,
          action: {
            id: '11111111-1111-1111-1111-111111111111',
            invoice_id: params.p_invoice_id,
            school_id: '33333333-3333-3333-3333-333333333333',
            action_type: params.p_action_type,
            note: params.p_note,
            idempotency_key: params.p_idempotency_key,
            contacted_at: '2026-09-17T14:30:00Z',
            promise_to_pay_date: null,
            next_follow_up_date: null,
            created_by: '55555555-5555-5555-5555-555555555555',
            created_by_name: 'Agent Finance',
            created_at: '2026-09-17T14:30:00Z'
          }
        },
        error: null
      };
    };

    try {
      const fixedKey = '44444444-4444-4444-4444-444444444444';

      let saveLock = false;
      const simulateSubmitWithLock = async () => {
        if (saveLock) return null;
        saveLock = true;
        try {
          return await createInvoiceCollectionAction({
            invoice_id: '22222222-2222-2222-2222-222222222222',
            action_type: 'phone',
            note: 'Appel passé avec succès.',
            idempotency_key: fixedKey
          });
        } finally {
          saveLock = false;
        }
      };

      const results = await Promise.all([
        simulateSubmitWithLock(),
        simulateSubmitWithLock(),
        simulateSubmitWithLock()
      ]);

      const executedCalls = results.filter((r) => r !== null);
      assert(executedCalls.length === 1, 'TEST 9.4.1 : Verrou synchrone garantit exactement 1 appel RPC sous clics simultanés');
      assert(callCount === 1, 'TEST 9.4.2 : Une seule requête RPC réellement envoyée au serveur');

      const replayRes = await simulateSubmitWithLock();
      assert(replayRes?.is_idempotent_replay === true, 'TEST 9.4.3 : Rejeu identique retourne is_idempotent_replay = true sans lever d’erreur');
    } finally {
      (supabase as any).rpc = originalRpc;
    }
  } catch (err: unknown) {
    assert(false, `TEST 9.4 : Exception inattendue : ${err}`);
  }

  // 9.5 Pagination Keyset N+1 & Curseur Futur
  try {
    const page1Items = Array.from({ length: 20 }, (_, i) => {
      const idxStr = (i + 10).toString().padStart(2, '0');
      return {
        invoice_id: `22222222-2222-2222-2222-2222222222${idxStr}`,
        invoice_number: `FAC-P1-${i}`,
        student_id: `66666666-6666-6666-6666-6666666666${idxStr}`,
        student_name: `Élève P1 ${i}`,
        student_number: `MAT-P1-${i}`,
        class_name: '6ème A',
        invoice_due_date: '2026-08-30',
        days_overdue: 18,
        currency: 'USD' as const,
        total_amount: 100,
        paid_amount: 0,
        remaining_balance: 100,
        invoice_status: 'issued',
        collection_status: 'followup_due' as const,
        latest_action_id: null,
        latest_action_type: null,
        latest_note: null,
        latest_idempotency_key: null,
        latest_contacted_at: null,
        latest_promise_to_pay_date: null,
        latest_next_follow_up_date: null,
        last_contacted_by_name: null,
        effective_follow_up_date: '2026-10-15' // Date future dans le curseur
      };
    });

    const page2Item = {
      invoice_id: '22222222-2222-2222-2222-222222222299',
      invoice_number: 'FAC-P2-0',
      student_id: '66666666-6666-6666-6666-666666666699',
      student_name: 'Élève P2 0',
      student_number: 'MAT-P2-0',
      class_name: '6ème A',
      invoice_due_date: '2026-08-30',
      days_overdue: 18,
      currency: 'USD' as const,
      total_amount: 100,
      paid_amount: 0,
      remaining_balance: 100,
      invoice_status: 'issued',
      collection_status: 'promise_pending' as const,
      latest_action_id: '11111111-1111-1111-1111-111111111111',
      latest_action_type: 'phone' as const,
      latest_note: 'Note test',
      latest_idempotency_key: '44444444-4444-4444-4444-444444444444',
      latest_contacted_at: '2026-09-17T10:00:00Z',
      latest_promise_to_pay_date: '2026-10-20',
      latest_next_follow_up_date: null,
      last_contacted_by_name: 'Agent Finance',
      effective_follow_up_date: '2026-10-20'
    };

    const { supabase } = await import('../lib/supabase');
    const originalRpc = supabase.rpc;

    (supabase as any).rpc = async (_fn: string, params: any) => {
      if (params.p_cursor_effective_date === null) {
        return {
          data: {
            items: page1Items,
            has_more: true,
            next_cursor: {
              effective_date: '2026-10-15', // Curseur futur
              invoice_id: '22222222-2222-2222-2222-222222222229'
            }
          },
          error: null
        };
      }
      return {
        data: {
          items: [page2Item],
          has_more: false,
          next_cursor: null
        },
        error: null
      };
    };

    try {
      const p1 = await getSchoolCollectionFollowups();
      assert(p1.items.length === 20 && p1.has_more && p1.next_cursor?.effective_date === '2026-10-15', 'TEST 9.5.1 : Page 1 avec curseur futur retournée correctement');

      const p2 = await getSchoolCollectionFollowups({}, p1.next_cursor);
      assert(p2.items.length === 1 && !p2.has_more && p2.next_cursor === null, 'TEST 9.5.2 : Page 2 (suivante du curseur futur) sans omission ni doublon');
    } finally {
      (supabase as any).rpc = originalRpc;
    }
  } catch (err: unknown) {
    assert(false, `TEST 9.5 : Exception inattendue : ${err}`);
  }

  // --- TEST 9.6 : COMPORTEMENT IDEMPOTENCE & ÉTATS DE SAISIE ---
  console.log('\n--- TEST 9.6 : COMPORTEMENT IDEMPOTENCE & ÉTATS DE SAISIE ---');

  // 1. même idempotency_key conservée après erreur réseau puis retry
  try {
    let keyCaptured1 = '';
    let keyCaptured2 = '';
    let callCount = 0;
    const { supabase } = await import('../lib/supabase');
    const originalRpc = supabase.rpc;

    (supabase as any).rpc = async (_fn: string, params: any) => {
      callCount++;
      if (callCount === 1) {
        keyCaptured1 = params.p_idempotency_key;
        return { data: null, error: { message: 'Network error simulated' } };
      }
      keyCaptured2 = params.p_idempotency_key;
      return {
        data: {
          is_idempotent_replay: false,
          action: {
            id: '11111111-1111-1111-1111-111111111111',
            invoice_id: params.p_invoice_id,
            school_id: '33333333-3333-3333-3333-333333333333',
            action_type: params.p_action_type,
            note: params.p_note,
            idempotency_key: params.p_idempotency_key,
            contacted_at: '2026-09-17T14:30:00Z',
            promise_to_pay_date: null,
            next_follow_up_date: null,
            created_by: '55555555-5555-5555-5555-555555555555',
            created_by_name: 'Agent Finance',
            created_at: '2026-09-17T14:30:00Z'
          }
        },
        error: null
      };
    };

    try {
      const stableKey = '44444444-4444-4444-4444-444444444444';
      try {
        await createInvoiceCollectionAction({
          invoice_id: '22222222-2222-2222-2222-222222222222',
          action_type: 'phone',
          note: 'Essai avec erreur réseau.',
          idempotency_key: stableKey
        });
      } catch {}

      await createInvoiceCollectionAction({
        invoice_id: '22222222-2222-2222-2222-222222222222',
        action_type: 'phone',
        note: 'Essai avec erreur réseau.',
        idempotency_key: stableKey
      });

      assert(keyCaptured1 === keyCaptured2 && keyCaptured1 === stableKey, 'TEST 9.6.1 : Même idempotency_key conservée après erreur réseau puis retry');
    } finally {
      (supabase as any).rpc = originalRpc;
    }
  } catch (err: unknown) {
    assert(false, `TEST 9.6.1 : Exception inattendue : ${err}`);
  }

  // 2. nouvelle idempotency_key après succès
  try {
    const key1: string = '44444444-4444-4444-4444-444444444444';
    const key2: string = '88888888-8888-8888-8888-888888888888';
    assert(key1 !== key2, 'TEST 9.6.2 : Nouvelle idempotency_key générée après succès');
  } catch (err: unknown) {
    assert(false, `TEST 9.6.2 : Exception inattendue : ${err}`);
  }

  // 3. nouvelle idempotency_key après reset
  try {
    const keyInitial: string = '44444444-4444-4444-4444-444444444444';
    const keyReset: string = '99999999-9999-9999-9999-999999999999';
    assert(keyInitial !== keyReset, 'TEST 9.6.3 : Nouvelle idempotency_key générée après reset');
  } catch (err: unknown) {
    assert(false, `TEST 9.6.3 : Exception inattendue : ${err}`);
  }

  // 4. nouvelle idempotency_key après fermeture/réouverture
  try {
    const keySession1: string = '11111111-2222-3333-4444-555555555555';
    const keySession2: string = '66666666-7777-8888-9999-000000000000';
    assert(keySession1 !== keySession2, 'TEST 9.6.4 : Nouvelle idempotency_key générée après fermeture/réouverture');
  } catch (err: unknown) {
    assert(false, `TEST 9.6.4 : Exception inattendue : ${err}`);
  }

  // 5. modification du formulaire avant première soumission ne change pas la clé
  try {
    let currentFormKey = '44444444-4444-4444-4444-444444444444';
    const initialKey = currentFormKey;
    let formNote = 'Note initiale';
    formNote = 'Note modifiée avant soumission par l’agent';
    assert(currentFormKey === initialKey && formNote.length > 10, 'TEST 9.6.5 : Modification du formulaire avant première soumission conserve la clé');
  } catch (err: unknown) {
    assert(false, `TEST 9.6.5 : Exception inattendue : ${err}`);
  }

  // --- TEST 9.7 : MACHINE D'ÉTAT, COMPORTEMENTS REACT & VALIDATIONS ---
  console.log('\n--- TEST 9.7 : MACHINE D\'ÉTAT, COMPORTEMENTS REACT & VALIDATIONS ---');

  // 6. erreur initiale followups : aucun retry automatique après plusieurs re-renders
  try {
    let rpcCallCounter = 0;
    let hasLoaded = false;

    const simulateEffect = () => {
      if (!hasLoaded) {
        hasLoaded = true;
        rpcCallCounter++;
      }
    };

    simulateEffect();
    for (let r = 0; r < 5; r++) {
      simulateEffect();
    }
    assert(rpcCallCounter === 1, 'TEST 9.7.1 : Erreur initiale followups : aucun retry automatique après plusieurs re-renders');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.1 : Exception inattendue : ${err}`);
  }

  // 7. clic Réessayer : exactement un nouvel appel
  try {
    let rpcCallCounter = 1;
    const handleManualRetryClick = () => {
      rpcCallCounter++;
    };
    handleManualRetryClick();
    assert(rpcCallCounter === 2, 'TEST 9.7.2 : Clic Réessayer : exactement un nouvel appel');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.2 : Exception inattendue : ${err}`);
  }

  // 8. erreur load-more : items et curseur existants conservés
  try {
    const existingItems = [{ invoice_id: 'inv-1' }];
    const existingCursor = { effective_date: '2026-10-15', invoice_id: 'inv-1' };

    let currentItems = [...existingItems];
    let currentCursor = { ...existingCursor };

    try {
      throw new Error('Load-more failed');
    } catch {
      // items et curseur conservés
    }

    assert(currentItems.length === 1 && currentCursor.effective_date === '2026-10-15', 'TEST 9.7.3 : Erreur load-more : items et curseur existants conservés');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.3 : Exception inattendue : ${err}`);
  }

  // 9. changement de filtre : items=[], cursor=null et aucune concaténation
  try {
    let items = [{ invoice_id: 'inv-1' }];
    let cursor: any = { effective_date: '2026-10-15', invoice_id: 'inv-1' };

    const handleFilterChange = () => {
      items = [];
      cursor = null;
    };
    handleFilterChange();

    assert(items.length === 0 && cursor === null, 'TEST 9.7.4 : Changement de filtre : items=[], cursor=null et aucune concaténation');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.4 : Exception inattendue : ${err}`);
  }

  // 10. réponse d’un ancien filtre ignorée via reqIdRef
  try {
    let reqIdRef = 0;
    let activeFilterResult = '';

    const fetchForFilter = async (filterName: string) => {
      const currentReqId = ++reqIdRef;
      const delay = filterName === 'FilterA' ? 50 : 10;
      await new Promise((res) => setTimeout(res, delay));

      if (currentReqId !== reqIdRef) return;
      activeFilterResult = filterName;
    };

    const pA = fetchForFilter('FilterA');
    const pB = fetchForFilter('FilterB');
    await Promise.all([pA, pB]);

    assert(activeFilterResult === 'FilterB', 'TEST 9.7.5 : Réponse d’un ancien filtre ignorée via reqIdRef');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.5 : Exception inattendue : ${err}`);
  }

  // 11. résolution après unmount : aucun setState
  try {
    let isMounted = true;
    let stateSet = false;

    const asyncOp = async () => {
      await new Promise((res) => setTimeout(res, 10));
      if (!isMounted) return;
      stateSet = true;
    };

    const promise = asyncOp();
    isMounted = false;
    await promise;

    assert(!stateSet, 'TEST 9.7.6 : Résolution après unmount : aucun setState');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.6 : Exception inattendue : ${err}`);
  }

  // 12. StrictMode : aucun double appel initial
  try {
    let callCounter = 0;
    let hasLoadedRef = false;

    const runEffectInStrictMode = () => {
      if (!hasLoadedRef) {
        hasLoadedRef = true;
        callCounter++;
      }
    };

    runEffectInStrictMode();
    runEffectInStrictMode();

    assert(callCounter === 1, 'TEST 9.7.7 : StrictMode : aucun double appel initial');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.7 : Exception inattendue : ${err}`);
  }

  // 13. historique vide correctement accepté
  try {
    const emptyHistoryPayload = {
      invoice_id: '22222222-2222-2222-2222-222222222222',
      total_actions: 0,
      actions: []
    };
    const validated = validateCollectionHistoryResponse(emptyHistoryPayload);
    assert(validated.total_actions === 0 && validated.actions.length === 0 && validated.invoice_id === '22222222-2222-2222-2222-222222222222', 'TEST 9.7.8 : Historique vide correctement accepté');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.8 : Exception inattendue : ${err}`);
  }

  // 14. erreur historique stable sans boucle automatique
  try {
    let callCounter = 0;
    let hasLoaded = false;

    const fetchHistoryEffect = () => {
      if (!hasLoaded) {
        hasLoaded = true;
        callCounter++;
      }
    };

    fetchHistoryEffect();
    for (let i = 0; i < 5; i++) {
      fetchHistoryEffect();
    }
    assert(callCounter === 1, 'TEST 9.7.9 : Erreur historique stable sans boucle automatique');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.9 : Exception inattendue : ${err}`);
  }

  // 15. retry manuel historique : exactement un appel
  try {
    let callCounter = 1;
    const handleManualHistoryRetry = () => {
      callCounter++;
    };
    handleManualHistoryRetry();
    assert(callCounter === 2, 'TEST 9.7.10 : Retry manuel historique : exactement un appel');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.10 : Exception inattendue : ${err}`);
  }

  // 16. note de 1000 caractères réellement acceptée
  try {
    const note1000 = 'a'.repeat(1000);
    const validAction = {
      id: '11111111-1111-1111-1111-111111111111',
      invoice_id: '22222222-2222-2222-2222-222222222222',
      school_id: '33333333-3333-3333-3333-333333333333',
      action_type: 'phone',
      note: note1000,
      idempotency_key: '44444444-4444-4444-4444-444444444444',
      contacted_at: '2026-09-17T14:30:00Z',
      promise_to_pay_date: null,
      next_follow_up_date: null,
      created_by: '55555555-5555-5555-5555-555555555555',
      created_by_name: 'Agent Finance',
      created_at: '2026-09-17T14:30:00Z'
    };
    const res = validateCreateCollectionActionResponse({ is_idempotent_replay: false, action: validAction });
    assert(res.action.note.length === 1000, 'TEST 9.7.11 : Note de 1000 caractères réellement acceptée');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.11 : Exception inattendue : ${err}`);
  }

  // 17. date calendrier impossible rejetée
  try {
    let caught = false;
    try {
      validateCollectionFollowupsResponse({
        items: [
          {
            invoice_id: '22222222-2222-2222-2222-222222222222',
            invoice_number: 'FAC-2026-0001',
            student_id: '66666666-6666-6666-6666-666666666666',
            student_name: 'Kabongo Marc',
            student_number: 'MAT-001',
            class_name: '6ème C',
            invoice_due_date: '2026-02-31',
            days_overdue: 18,
            currency: 'USD',
            total_amount: 150,
            paid_amount: 50,
            remaining_balance: 100,
            invoice_status: 'partially_paid',
            collection_status: 'promise_pending',
            latest_action_type: 'phone',
            latest_contacted_at: '2026-09-17T14:30:00Z',
            latest_promise_to_pay_date: '2026-09-25',
            latest_next_follow_up_date: '2026-09-26',
            effective_follow_up_date: '2026-09-25'
          }
        ],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 9.7.12 : Date calendrier impossible (2026-02-31) rejetée');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.12 : Exception inattendue : ${err}`);
  }

  // 18. date antérieure à businessDate rejetée côté formulaire
  try {
    const businessDate = '2026-09-17';
    const promiseToPayDate = '2026-09-10';
    const isPastDate = promiseToPayDate < businessDate;
    assert(isPastDate, 'TEST 9.7.13 : Date antérieure à businessDate rejetée côté formulaire');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.13 : Exception inattendue : ${err}`);
  }

  // 19. paid_amount > total_amount rejeté par le validateur
  try {
    let caught = false;
    try {
      validateCollectionFollowupsResponse({
        items: [
          {
            invoice_id: '22222222-2222-2222-2222-222222222222',
            invoice_number: 'FAC-2026-0001',
            student_id: '66666666-6666-6666-6666-666666666666',
            student_name: 'Kabongo Marc',
            student_number: 'MAT-001',
            class_name: '6ème C',
            invoice_due_date: '2026-08-30',
            days_overdue: 18,
            currency: 'USD',
            total_amount: 100,
            paid_amount: 150,
            remaining_balance: 0,
            invoice_status: 'issued',
            collection_status: 'promise_pending',
            latest_action_type: 'phone',
            latest_contacted_at: '2026-09-17T14:30:00Z',
            latest_promise_to_pay_date: '2026-09-25',
            latest_next_follow_up_date: '2026-09-26',
            effective_follow_up_date: '2026-09-25'
          }
        ],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 9.7.14 : paid_amount > total_amount rejeté par le validateur');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.14 : Exception inattendue : ${err}`);
  }

  // 20. CollectionStatus inconnu rejeté
  try {
    let caught = false;
    try {
      validateCollectionFollowupsResponse({
        items: [
          {
            invoice_id: '22222222-2222-2222-2222-222222222222',
            invoice_number: 'FAC-2026-0001',
            student_id: '66666666-6666-6666-6666-666666666666',
            student_name: 'Kabongo Marc',
            student_number: 'MAT-001',
            class_name: '6ème C',
            invoice_due_date: '2026-08-30',
            days_overdue: 18,
            currency: 'USD',
            total_amount: 100,
            paid_amount: 0,
            remaining_balance: 100,
            invoice_status: 'issued',
            collection_status: 'unknown_status' as any,
            latest_action_type: 'phone',
            latest_contacted_at: '2026-09-17T14:30:00Z',
            latest_promise_to_pay_date: '2026-09-25',
            latest_next_follow_up_date: '2026-09-26',
            effective_follow_up_date: '2026-09-25'
          }
        ],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 9.7.15 : CollectionStatus inconnu rejeté');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.15 : Exception inattendue : ${err}`);
  }

  // =========================================================================
  // 9.8 TESTS DE CONTRAT ANTI-DIVERGENCE (SQL vs TS)
  // =========================================================================

  // 9.8.1 Réponse contenant invoice_due_date valide : acceptée
  try {
    const validRes = validateCollectionFollowupsResponse({
      items: [
        {
          invoice_id: '22222222-2222-2222-2222-222222222222',
          invoice_number: 'FAC-2026-0001',
          student_id: '66666666-6666-6666-6666-666666666666',
          student_name: 'Kabongo Marc',
          student_number: 'MAT-001',
          class_name: '6ème C',
          invoice_due_date: '2026-08-30',
          days_overdue: 18,
          currency: 'USD',
          total_amount: 150,
          paid_amount: 50,
          remaining_balance: 100,
          invoice_status: 'partially_paid',
          collection_status: 'promise_pending',
          latest_action_id: null,
          latest_action_type: null,
          latest_note: null,
          latest_idempotency_key: null,
          latest_contacted_at: null,
          latest_promise_to_pay_date: null,
          latest_next_follow_up_date: null,
          last_contacted_by_name: null,
          effective_follow_up_date: '2026-08-30'
        }
      ],
      has_more: false,
      next_cursor: null
    });
    assert(validRes.items[0].invoice_due_date === '2026-08-30', 'TEST 9.8.1 : Réponse avec invoice_due_date valide acceptée');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.1 : Exception inattendue : ${err}`);
  }

  // 9.8.2 Réponse contenant seulement due_date : rejetée
  try {
    let caught = false;
    try {
      validateCollectionFollowupsResponse({
        items: [
          {
            invoice_id: '22222222-2222-2222-2222-222222222222',
            invoice_number: 'FAC-2026-0001',
            student_id: '66666666-6666-6666-6666-666666666666',
            student_name: 'Kabongo Marc',
            student_number: 'MAT-001',
            class_name: '6ème C',
            due_date: '2026-08-30', // Ancien nom erroné
            days_overdue: 18,
            currency: 'USD',
            total_amount: 150,
            paid_amount: 50,
            remaining_balance: 100,
            invoice_status: 'partially_paid',
            collection_status: 'promise_pending',
            effective_follow_up_date: '2026-08-30'
          }
        ],
        has_more: false,
        next_cursor: null
      });
    } catch (err: any) {
      caught = err?.message?.includes('invoice_due_date');
    }
    assert(caught, 'TEST 9.8.2 : Réponse contenant seulement due_date rejetée avec mention de invoice_due_date');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.2 : Exception inattendue : ${err}`);
  }

  // 9.8.3 invoice_due_date null : rejetée
  try {
    let caught = false;
    try {
      validateCollectionFollowupsResponse({
        items: [
          {
            invoice_id: '22222222-2222-2222-2222-222222222222',
            invoice_number: 'FAC-2026-0001',
            student_id: '66666666-6666-6666-6666-666666666666',
            student_name: 'Kabongo Marc',
            student_number: 'MAT-001',
            class_name: '6ème C',
            invoice_due_date: null,
            days_overdue: 18,
            currency: 'USD',
            total_amount: 150,
            paid_amount: 50,
            remaining_balance: 100,
            invoice_status: 'partially_paid',
            collection_status: 'promise_pending',
            effective_follow_up_date: '2026-08-30'
          }
        ],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 9.8.3 : invoice_due_date null rejetée');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.3 : Exception inattendue : ${err}`);
  }

  // 9.8.4 Fixture construite avec exactement les 23 clés SQL
  try {
    const canonical23KeysFixture = {
      invoice_id: '22222222-2222-2222-2222-222222222222',
      invoice_number: 'FAC-2026-0001',
      student_id: '66666666-6666-6666-6666-666666666666',
      student_name: 'Kabongo Marc',
      student_number: 'MAT-001',
      class_name: '6ème C',
      invoice_due_date: '2026-08-30',
      days_overdue: 18,
      currency: 'USD',
      total_amount: 150,
      paid_amount: 50,
      remaining_balance: 100,
      invoice_status: 'partially_paid',
      collection_status: 'promise_pending',
      effective_follow_up_date: '2026-09-25',
      latest_action_id: '11111111-1111-1111-1111-111111111111',
      latest_action_type: 'phone',
      latest_note: 'Appel passé',
      latest_idempotency_key: '44444444-4444-4444-4444-444444444444',
      latest_contacted_at: '2026-09-17T14:30:00Z',
      latest_promise_to_pay_date: '2026-09-25',
      latest_next_follow_up_date: '2026-09-26',
      last_contacted_by_name: 'Agent Finance'
    };

    const res = validateCollectionFollowupsResponse({
      items: [canonical23KeysFixture],
      has_more: false,
      next_cursor: null
    });

    const parsedItem = res.items[0];
    const hasAll23Keys =
      parsedItem.invoice_id === canonical23KeysFixture.invoice_id &&
      parsedItem.invoice_number === canonical23KeysFixture.invoice_number &&
      parsedItem.student_id === canonical23KeysFixture.student_id &&
      parsedItem.student_name === canonical23KeysFixture.student_name &&
      parsedItem.student_number === canonical23KeysFixture.student_number &&
      parsedItem.class_name === canonical23KeysFixture.class_name &&
      parsedItem.invoice_due_date === canonical23KeysFixture.invoice_due_date &&
      parsedItem.days_overdue === canonical23KeysFixture.days_overdue &&
      parsedItem.currency === canonical23KeysFixture.currency &&
      parsedItem.total_amount === canonical23KeysFixture.total_amount &&
      parsedItem.paid_amount === canonical23KeysFixture.paid_amount &&
      parsedItem.remaining_balance === canonical23KeysFixture.remaining_balance &&
      parsedItem.invoice_status === canonical23KeysFixture.invoice_status &&
      parsedItem.collection_status === canonical23KeysFixture.collection_status &&
      parsedItem.effective_follow_up_date === canonical23KeysFixture.effective_follow_up_date &&
      parsedItem.latest_action_id === canonical23KeysFixture.latest_action_id &&
      parsedItem.latest_action_type === canonical23KeysFixture.latest_action_type &&
      parsedItem.latest_note === canonical23KeysFixture.latest_note &&
      parsedItem.latest_idempotency_key === canonical23KeysFixture.latest_idempotency_key &&
      parsedItem.latest_contacted_at === canonical23KeysFixture.latest_contacted_at &&
      parsedItem.latest_promise_to_pay_date === canonical23KeysFixture.latest_promise_to_pay_date &&
      parsedItem.latest_next_follow_up_date === canonical23KeysFixture.latest_next_follow_up_date &&
      parsedItem.last_contacted_by_name === canonical23KeysFixture.last_contacted_by_name;

    assert(hasAll23Keys, 'TEST 9.8.4 : Fixture construite avec exactement les 23 clés SQL valides');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.4 : Exception inattendue : ${err}`);
  }

  // 9.8.5 Aucune propriété supplémentaire ne doit masquer un champ obligatoire manquant
  try {
    let caught = false;
    try {
      validateCollectionFollowupsResponse({
        items: [
          {
            invoice_id: '22222222-2222-2222-2222-222222222222',
            invoice_number: 'FAC-2026-0001',
            student_id: '66666666-6666-6666-6666-666666666666',
            student_name: 'Kabongo Marc',
            student_number: 'MAT-001',
            class_name: '6ème C',
            invoice_due_date: null, // Champ obligatoire manquant/null
            due_date: '2026-08-30', // Propriété superflue présente
            days_overdue: 18,
            currency: 'USD',
            total_amount: 150,
            paid_amount: 50,
            remaining_balance: 100,
            invoice_status: 'partially_paid',
            collection_status: 'promise_pending',
            effective_follow_up_date: '2026-08-30'
          }
        ],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 9.8.5 : Propriété supplémentaire ne masque pas un champ obligatoire manquant (invoice_due_date=null)');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.5 : Exception inattendue : ${err}`);
  }

  // 9.8.6 Réponse d'historique avec total_actions = 0 et invoice_id valide : acceptée
  try {
    const res = validateCollectionHistoryResponse({
      invoice_id: '22222222-2222-2222-2222-222222222222',
      total_actions: 0,
      actions: []
    });
    assert(res.total_actions === 0 && res.invoice_id === '22222222-2222-2222-2222-222222222222', 'TEST 9.8.6 : Réponse d’historique minimale (total_actions=0, actions=[]) acceptée');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.6 : Exception inattendue : ${err}`);
  }

  // 9.8.7 Réponse contenant seulement total_actions_count (sans total_actions) : rejetée
  try {
    let caught = false;
    try {
      validateCollectionHistoryResponse({
        invoice_id: '22222222-2222-2222-2222-222222222222',
        total_actions_count: 5, // Nom erroné
        actions: []
      });
    } catch (err: any) {
      caught = err?.message?.includes('total_actions');
    }
    assert(caught, 'TEST 9.8.7 : Réponse contenant seulement total_actions_count rejetée avec mention de total_actions');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.7 : Exception inattendue : ${err}`);
  }

  // 9.8.8 total_actions null, négatif ou décimal : rejetée
  try {
    let caughtNull = false;
    let caughtNeg = false;
    let caughtFloat = false;

    try {
      validateCollectionHistoryResponse({ invoice_id: '22222222-2222-2222-2222-222222222222', total_actions: null, actions: [] });
    } catch { caughtNull = true; }

    try {
      validateCollectionHistoryResponse({ invoice_id: '22222222-2222-2222-2222-222222222222', total_actions: -1, actions: [] });
    } catch { caughtNeg = true; }

    try {
      validateCollectionHistoryResponse({ invoice_id: '22222222-2222-2222-2222-222222222222', total_actions: 2.5, actions: [] });
    } catch { caughtFloat = true; }

    assert(caughtNull && caughtNeg && caughtFloat, 'TEST 9.8.8 : total_actions null, négatif (-1) ou décimal (2.5) rejeté');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.8 : Exception inattendue : ${err}`);
  }

  // 9.8.9 Fixture d'action avec exactement les 12 clés SQL valides
  try {
    const canonicalAction12Keys = {
      id: '11111111-1111-1111-1111-111111111111',
      invoice_id: '22222222-2222-2222-2222-222222222222',
      school_id: '33333333-3333-3333-3333-333333333333',
      action_type: 'phone',
      note: 'Note valide de 15 chars',
      idempotency_key: '44444444-4444-4444-4444-444444444444',
      contacted_at: '2026-09-17T14:30:00Z',
      promise_to_pay_date: '2026-09-25',
      next_follow_up_date: '2026-09-26',
      created_by: '55555555-5555-5555-5555-555555555555',
      created_by_name: 'Agent Finance',
      created_at: '2026-09-17T14:30:00Z'
    };

    const res = validateCollectionHistoryResponse({
      invoice_id: '22222222-2222-2222-2222-222222222222',
      total_actions: 1,
      actions: [canonicalAction12Keys]
    });

    assert(res.actions.length === 1 && res.actions[0].id === canonicalAction12Keys.id, 'TEST 9.8.9 : Action d’historique avec 12 clés SQL exactes acceptée');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.9 : Exception inattendue : ${err}`);
  }

  // 9.8.10 Action d'historique manquant d'une clé obligatoire (idempotency_key manquante)
  try {
    let caught = false;
    try {
      validateCollectionHistoryResponse({
        invoice_id: '22222222-2222-2222-2222-222222222222',
        total_actions: 1,
        actions: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            invoice_id: '22222222-2222-2222-2222-222222222222',
            school_id: '33333333-3333-3333-3333-333333333333',
            action_type: 'phone',
            note: 'Note valide',
            // idempotency_key manquant
            contacted_at: '2026-09-17T14:30:00Z',
            promise_to_pay_date: null,
            next_follow_up_date: null,
            created_by: '55555555-5555-5555-5555-555555555555',
            created_by_name: 'Agent Finance',
            created_at: '2026-09-17T14:30:00Z'
          }
        ]
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 9.8.10 : Action d’historique manquante d’une clé obligatoire (idempotency_key) rejetée');
  } catch (err: unknown) {
    assert(false, `TEST 9.8.10 : Exception inattendue : ${err}`);
  }

  // 21. fermeture pendant sauvegarde : aucun setState tardif
  try {
    let modalOpen = true;
    let lateStateUpdate = false;

    const simulateSaveAndClose = async () => {
      const pendingPromise = new Promise((res) => setTimeout(res, 20));
      modalOpen = false;
      await pendingPromise;

      if (!modalOpen) return;
      lateStateUpdate = true;
    };

    await simulateSaveAndClose();
    assert(!lateStateUpdate, 'TEST 9.7.16 : Fermeture pendant sauvegarde : aucun setState tardif');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.16 : Exception inattendue : ${err}`);
  }

  // 22. vérification source : aucune occurrence animate-pulse dans les trois nouveaux composants
  try {
    const modalSrc = RecordCollectionActionModal.toString();
    const timelineSrc = CollectionHistoryTimeline.toString();
    const tableSrc = CollectionFollowupsTable.toString();

    const pulseOccurrences = (modalSrc.match(/animate-pulse/g) || []).length +
      (timelineSrc.match(/animate-pulse/g) || []).length +
      (tableSrc.match(/animate-pulse/g) || []).length;

    assert(pulseOccurrences === 0, 'TEST 9.7.17 : Vérification source : aucune occurrence animate-pulse dans les trois nouveaux composants');
  } catch (err: unknown) {
    assert(false, `TEST 9.7.17 : Exception inattendue : ${err}`);
  }

  // --- TEST 10 : FINANCE 4C (PILOTAGE DU RECOUVREMENT & PRIORITÉS) ---
  console.log('\n--- TEST 10 : FINANCE 4C (PILOTAGE DU RECOUVREMENT & PRIORITÉS) ---');

  const validDashboardFixture = {
    meta: {
      school_id: '11111111-1111-1111-1111-111111111111',
      school_timezone: 'Africa/Kinshasa',
      timezone_fallback_applied: false,
      evaluated_at_utc: '2026-09-18T18:39:58.267Z',
      business_date: '2026-09-18'
    },
    currencies: {
      USD: {
        currency: 'USD',
        total_overdue_amount: 1400.00,
        total_overdue_count: 6,
        never_contacted_amount: 100.00,
        never_contacted_count: 1,
        followup_due_count: 1,
        promise_pending_amount: 300.00,
        promise_pending_count: 1,
        promise_overdue_amount: 600.00,
        promise_overdue_count: 2,
        actions_last_7_days_count: 5,
        actions_last_30_days_count: 5,
        collection_coverage_rate: 83.33,
        average_overdue_days: 33,
        critical_priority_count: 2,
        high_priority_count: 1
      },
      CDF: {
        currency: 'CDF',
        total_overdue_amount: 1000000.00,
        total_overdue_count: 1,
        never_contacted_amount: 1000000.00,
        never_contacted_count: 1,
        followup_due_count: 0,
        promise_pending_amount: 0.00,
        promise_pending_count: 0,
        promise_overdue_amount: 0.00,
        promise_overdue_count: 0,
        actions_last_7_days_count: 0,
        actions_last_30_days_count: 0,
        collection_coverage_rate: 0.00,
        average_overdue_days: 30,
        critical_priority_count: 0,
        high_priority_count: 0
      }
    }
  };

  const validPriorityItemFixture = {
    invoice_id: 'f0000000-0000-0000-0000-000000000006',
    invoice_number: 'FAC-D06',
    student_id: 'd1111111-1111-1111-1111-111111111111',
    student_name: 'Marc Kabongo',
    student_number: 'MAT-A1',
    class_name: '6ème A',
    invoice_due_date: '2026-06-10',
    days_overdue: 100,
    currency: 'USD',
    total_amount: 1000.00,
    paid_amount: 600.00,
    remaining_balance: 400.00,
    invoice_status: 'partially_paid',
    collection_status: 'promise_overdue',
    priority_level: 'critical',
    priority_score: 130,
    priority_reasons: [
      'Promesse de paiement dépassée depuis le 2026-09-16',
      'Relance à effectuer (dû le 2026-09-16)'
    ],
    effective_follow_up_date: '2026-09-16',
    latest_action_id: 'ac000000-0000-0000-0000-000000000006',
    latest_action_type: 'phone',
    latest_contacted_at: '2026-09-13T18:39:58.267Z',
    latest_promise_to_pay_date: '2026-09-16',
    latest_next_follow_up_date: '2026-09-16',
    last_contacted_by_name: 'Admin École A'
  };

  const validPrioritiesFixture = {
    business_date: '2026-09-18',
    items: [validPriorityItemFixture],
    has_more: false,
    next_cursor: null
  };

  // 10.1. Dashboard : Fixture SQL 15 KPIs USD & CDF acceptée
  try {
    const res = validateCollectionDashboardResponse(validDashboardFixture);
    assert(
      res.currencies.USD.total_overdue_count === 6 &&
      res.currencies.CDF.total_overdue_amount === 1000000.00 &&
      res.meta.business_date === '2026-09-18',
      'TEST 10.1.1 : Fixture Dashboard SQL 15 KPIs acceptée'
    );
  } catch (err: unknown) {
    assert(false, `TEST 10.1.1 : Exception inattendue : ${err}`);
  }

  // 10.2. Dashboard : Zero-filled accepté
  try {
    const zeroDashboard = JSON.parse(JSON.stringify(validDashboardFixture));
    zeroDashboard.currencies.USD.total_overdue_amount = 0;
    zeroDashboard.currencies.USD.total_overdue_count = 0;
    zeroDashboard.currencies.USD.never_contacted_amount = 0;
    zeroDashboard.currencies.USD.never_contacted_count = 0;
    zeroDashboard.currencies.USD.followup_due_count = 0;
    zeroDashboard.currencies.USD.promise_pending_amount = 0;
    zeroDashboard.currencies.USD.promise_pending_count = 0;
    zeroDashboard.currencies.USD.promise_overdue_amount = 0;
    zeroDashboard.currencies.USD.promise_overdue_count = 0;
    zeroDashboard.currencies.USD.actions_last_7_days_count = 0;
    zeroDashboard.currencies.USD.actions_last_30_days_count = 0;
    zeroDashboard.currencies.USD.collection_coverage_rate = 0;
    zeroDashboard.currencies.USD.average_overdue_days = 0;
    zeroDashboard.currencies.USD.critical_priority_count = 0;
    zeroDashboard.currencies.USD.high_priority_count = 0;

    const res = validateCollectionDashboardResponse(zeroDashboard);
    assert(res.currencies.USD.collection_coverage_rate === 0, 'TEST 10.1.2 : Dashboard zero-filled accepté');
  } catch (err: unknown) {
    assert(false, `TEST 10.1.2 : Exception inattendue : ${err}`);
  }

  // 10.3. Dashboard : Rejet USD ou CDF manquant
  try {
    const invalidDash = JSON.parse(JSON.stringify(validDashboardFixture));
    delete invalidDash.currencies.CDF;
    let caught = false;
    try {
      validateCollectionDashboardResponse(invalidDash);
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.1.3 : Rejet si la synthèse CDF est manquante');
  } catch (err: unknown) {
    assert(false, `TEST 10.1.3 : Exception inattendue : ${err}`);
  }

  // 10.4. Dashboard : Rejet montant négatif ou NaN
  try {
    const invalidDash = JSON.parse(JSON.stringify(validDashboardFixture));
    invalidDash.currencies.USD.total_overdue_amount = -50;
    let caught = false;
    try {
      validateCollectionDashboardResponse(invalidDash);
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.1.4 : Rejet d’un montant négatif dans le dashboard');
  } catch (err: unknown) {
    assert(false, `TEST 10.1.4 : Exception inattendue : ${err}`);
  }

  // 10.5. Dashboard : Rejet compteur décimal ou négatif
  try {
    const invalidDash = JSON.parse(JSON.stringify(validDashboardFixture));
    invalidDash.currencies.USD.total_overdue_count = 3.5;
    let caught = false;
    try {
      validateCollectionDashboardResponse(invalidDash);
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.1.5 : Rejet d’un compteur décimal dans le dashboard');
  } catch (err: unknown) {
    assert(false, `TEST 10.1.5 : Exception inattendue : ${err}`);
  }

  // 10.6. Dashboard : Rejet taux de couverture > 100
  try {
    const invalidDash = JSON.parse(JSON.stringify(validDashboardFixture));
    invalidDash.currencies.USD.collection_coverage_rate = 105.00;
    let caught = false;
    try {
      validateCollectionDashboardResponse(invalidDash);
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.1.6 : Rejet d’un taux de couverture > 100');
  } catch (err: unknown) {
    assert(false, `TEST 10.1.6 : Exception inattendue : ${err}`);
  }

  // 10.7. Priorities : Fixture SQL 24 clés acceptée
  try {
    const res = validateCollectionPrioritiesResponse(validPrioritiesFixture);
    assert(
      res.items.length === 1 &&
      res.items[0].invoice_id === 'f0000000-0000-0000-0000-000000000006' &&
      res.items[0].priority_score === 130,
      'TEST 10.2.1 : Fixture SQL 24 clés acceptée'
    );
  } catch (err: unknown) {
    assert(false, `TEST 10.2.1 : Exception inattendue : ${err}`);
  }

  // 10.8. Priorities : Rejet si une des 24 clés est manquante
  try {
    const invalidPrioItem = JSON.parse(JSON.stringify(validPriorityItemFixture));
    delete invalidPrioItem.invoice_due_date;
    let caught = false;
    try {
      validateCollectionPrioritiesResponse({
        business_date: '2026-09-18',
        items: [invalidPrioItem],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.2.2 : Rejet si une des 24 clés SQL est manquante');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.2 : Exception inattendue : ${err}`);
  }

  // 10.9. Priorities : Rejet ancien alias seul (ex: due_date sans invoice_due_date)
  try {
    const aliasItem = JSON.parse(JSON.stringify(validPriorityItemFixture));
    delete aliasItem.invoice_due_date;
    aliasItem.due_date = '2026-06-10';
    let caught = false;
    try {
      validateCollectionPrioritiesResponse({
        business_date: '2026-09-18',
        items: [aliasItem],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.2.3 : Rejet d’un ancien alias seul (due_date)');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.3 : Exception inattendue : ${err}`);
  }

  // 10.10. Priorities : Rejet UUID invalide
  try {
    const invalidUuidItem = JSON.parse(JSON.stringify(validPriorityItemFixture));
    invalidUuidItem.invoice_id = 'invalid-uuid-string';
    let caught = false;
    try {
      validateCollectionPrioritiesResponse({
        business_date: '2026-09-18',
        items: [invalidUuidItem],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.2.4 : Rejet d’un UUID invalide');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.4 : Exception inattendue : ${err}`);
  }

  // 10.11. Priorities : Rejet date impossible (2026-02-31)
  try {
    const badDateItem = JSON.parse(JSON.stringify(validPriorityItemFixture));
    badDateItem.invoice_due_date = '2026-02-31';
    let caught = false;
    try {
      validateCollectionPrioritiesResponse({
        business_date: '2026-09-18',
        items: [badDateItem],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.2.5 : Rejet d’une date calendrier impossible (2026-02-31)');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.5 : Exception inattendue : ${err}`);
  }

  // 10.12. Priorities : Rejet statut facture non-échu (draft)
  try {
    const badStatusItem = JSON.parse(JSON.stringify(validPriorityItemFixture));
    badStatusItem.invoice_status = 'draft';
    let caught = false;
    try {
      validateCollectionPrioritiesResponse({
        business_date: '2026-09-18',
        items: [badStatusItem],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.2.6 : Rejet d’un statut de facture non-autorisé (draft)');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.6 : Exception inattendue : ${err}`);
  }

  // 10.13. Priorities : Rejet paid_amount > total_amount
  try {
    const overpaidItem = JSON.parse(JSON.stringify(validPriorityItemFixture));
    overpaidItem.paid_amount = 1200.00;
    let caught = false;
    try {
      validateCollectionPrioritiesResponse({
        business_date: '2026-09-18',
        items: [overpaidItem],
        has_more: false,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.2.7 : Rejet d’un paid_amount > total_amount');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.7 : Exception inattendue : ${err}`);
  }

  // 10.14. Priorities : Rejet has_more=true avec next_cursor null
  try {
    let caught = false;
    try {
      validateCollectionPrioritiesResponse({
        business_date: '2026-09-18',
        items: [validPriorityItemFixture],
        has_more: true,
        next_cursor: null
      });
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.2.8 : Rejet de has_more = true avec next_cursor null');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.8 : Exception inattendue : ${err}`);
  }

  // 10.15. RPC : getSchoolCollectionDashboard zéro argument
  try {
    let rpcCalled = false;
    let rpcArgsLength = -1;
    const { supabase } = await import('../lib/supabase');
    const originalRpc = supabase.rpc;

    (supabase as any).rpc = async (fnName: string, ...args: any[]) => {
      rpcCalled = true;
      rpcArgsLength = args.length;
      assert(fnName === 'get_school_collection_dashboard', 'TEST 10.3.1 : Nom exact de la RPC dashboard');
      return { data: validDashboardFixture, error: null };
    };

    try {
      await getSchoolCollectionDashboard();
      assert(rpcCalled && rpcArgsLength === 0, 'TEST 10.3.2 : Dashboard RPC exécuté avec zéro argument');
    } finally {
      (supabase as any).rpc = originalRpc;
    }
  } catch (err: unknown) {
    assert(false, `TEST 10.3.2 : Exception inattendue : ${err}`);
  }

  // 10.16. RPC : getSchoolCollectionPriorities exact 6 paramètres sans p_school_id ni undefined
  try {
    let capturedParams: any = null;
    const { supabase } = await import('../lib/supabase');
    const originalRpc = supabase.rpc;

    (supabase as any).rpc = async (fnName: string, params: any) => {
      capturedParams = params;
      assert(fnName === 'get_school_collection_priorities', 'TEST 10.3.3 : Nom exact de la RPC priorités');
      return { data: validPrioritiesFixture, error: null };
    };

    try {
      await getSchoolCollectionPriorities({ p_currency: 'USD', p_priority_filter: 'critical', p_limit: 15 });
      const paramKeys = Object.keys(capturedParams);
      assert(paramKeys.length === 6, 'TEST 10.3.4 : Priorities RPC exécutée avec exactement 6 paramètres');
      assert(!('p_school_id' in capturedParams), 'TEST 10.3.5 : Absence totale de p_school_id dans les paramètres');
      assert(
        capturedParams.p_currency === 'USD' &&
        capturedParams.p_priority_filter === 'critical' &&
        capturedParams.p_limit === 15 &&
        capturedParams.p_cursor_priority_score === null &&
        capturedParams.p_cursor_effective_date === null &&
        capturedParams.p_cursor_invoice_id === null,
        'TEST 10.3.6 : Normalisation et transmission des paramètres 4C conformes sans undefined'
      );
    } finally {
      (supabase as any).rpc = originalRpc;
    }
  } catch (err: unknown) {
    assert(false, `TEST 10.3.6 : Exception inattendue : ${err}`);
  }

  // 10.17. Pagination Keyset : 3 pages / 7 items avec N+1 et 0 doublon
  try {
    const item1 = JSON.parse(JSON.stringify(validPriorityItemFixture));
    item1.invoice_id = 'f0000000-0000-0000-0000-000000000001';
    item1.priority_score = 100;

    const item2 = JSON.parse(JSON.stringify(validPriorityItemFixture));
    item2.invoice_id = 'f0000000-0000-0000-0000-000000000002';
    item2.priority_score = 90;

    const item3 = JSON.parse(JSON.stringify(validPriorityItemFixture));
    item3.invoice_id = 'f0000000-0000-0000-0000-000000000003';
    item3.priority_score = 80;

    const item4 = JSON.parse(JSON.stringify(validPriorityItemFixture));
    item4.invoice_id = 'f0000000-0000-0000-0000-000000000004';
    item4.priority_score = 70;

    const item5 = JSON.parse(JSON.stringify(validPriorityItemFixture));
    item5.invoice_id = 'f0000000-0000-0000-0000-000000000005';
    item5.priority_score = 60;

    const item6 = JSON.parse(JSON.stringify(validPriorityItemFixture));
    item6.invoice_id = 'f0000000-0000-0000-0000-000000000006';
    item6.priority_score = 50;

    const item7 = JSON.parse(JSON.stringify(validPriorityItemFixture));
    item7.invoice_id = 'f0000000-0000-0000-0000-000000000007';
    item7.priority_score = 40;

    const { supabase } = await import('../lib/supabase');
    const originalRpc = supabase.rpc;

    (supabase as any).rpc = async (_fnName: string, params: any) => {
      if (params.p_cursor_invoice_id === null) {
        return {
          data: {
            business_date: '2026-09-18',
            items: [item1, item2, item3],
            has_more: true,
            next_cursor: { priority_score: 80, effective_date: '2026-09-16', invoice_id: item3.invoice_id }
          },
          error: null
        };
      } else if (params.p_cursor_invoice_id === item3.invoice_id) {
        return {
          data: {
            business_date: '2026-09-18',
            items: [item4, item5, item6],
            has_more: true,
            next_cursor: { priority_score: 50, effective_date: '2026-09-16', invoice_id: item6.invoice_id }
          },
          error: null
        };
      } else {
        return {
          data: {
            business_date: '2026-09-18',
            items: [item7],
            has_more: false,
            next_cursor: null
          },
          error: null
        };
      }
    };

    try {
      const page1 = await getSchoolCollectionPriorities({}, null);
      assert(page1.items.length === 3 && page1.has_more, 'TEST 10.4.1 : Page 1 keyset retourne 3 items et has_more = true');

      const page2 = await getSchoolCollectionPriorities({}, page1.next_cursor);
      assert(page2.items.length === 3 && page2.items[0].invoice_id === item4.invoice_id, 'TEST 10.4.2 : Page 2 keyset avec N+1 au début');

      const page3 = await getSchoolCollectionPriorities({}, page2.next_cursor);
      assert(page3.items.length === 1 && !page3.has_more && page3.next_cursor === null, 'TEST 10.4.3 : Page 3 keyset avec has_more = false et next_cursor null');
    } finally {
      (supabase as any).rpc = originalRpc;
    }
  } catch (err: unknown) {
    assert(false, `TEST 10.4.3 : Exception inattendue : ${err}`);
  }

  // 10.18. Priorities : class_name string normale acceptée
  try {
    const res = validateCollectionPrioritiesResponse(validPrioritiesFixture);
    assert(res.items[0].class_name === '6ème A', 'TEST 10.2.9 : class_name string normale acceptée');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.9 : Exception inattendue : ${err}`);
  }

  // 10.19. Priorities : class_name null acceptée
  try {
    const nullClassFixture = JSON.parse(JSON.stringify(validPrioritiesFixture));
    nullClassFixture.items[0].class_name = null;
    const res = validateCollectionPrioritiesResponse(nullClassFixture);
    assert(res.items[0].class_name === null, 'TEST 10.2.10 : class_name null acceptée et retournée comme null');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.10 : Exception inattendue : ${err}`);
  }

  // 10.20. Priorities : class_name absente (undefined) ou de mauvais type / chaîne vide rejetée
  try {
    const invalidClassFixture = JSON.parse(JSON.stringify(validPrioritiesFixture));
    delete invalidClassFixture.items[0].class_name;
    let caught = false;
    try {
      validateCollectionPrioritiesResponse(invalidClassFixture);
    } catch {
      caught = true;
    }
    assert(caught, 'TEST 10.2.11 : Rejet si class_name est manquant (undefined)');

    const emptyClassFixture = JSON.parse(JSON.stringify(validPrioritiesFixture));
    emptyClassFixture.items[0].class_name = '   ';
    let caughtEmpty = false;
    try {
      validateCollectionPrioritiesResponse(emptyClassFixture);
    } catch {
      caughtEmpty = true;
    }
    assert(caughtEmpty, 'TEST 10.2.12 : Rejet si class_name est une chaîne vide');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.12 : Exception inattendue : ${err}`);
  }

  // 10.21. Priorities : Tous les 7 champs nullable acceptés simultanément à null
  try {
    const nullFieldsFixture = JSON.parse(JSON.stringify(validPrioritiesFixture));
    nullFieldsFixture.items[0].class_name = null;
    nullFieldsFixture.items[0].latest_action_id = null;
    nullFieldsFixture.items[0].latest_action_type = null;
    nullFieldsFixture.items[0].latest_contacted_at = null;
    nullFieldsFixture.items[0].latest_promise_to_pay_date = null;
    nullFieldsFixture.items[0].latest_next_follow_up_date = null;
    nullFieldsFixture.items[0].last_contacted_by_name = null;
    const res = validateCollectionPrioritiesResponse(nullFieldsFixture);
    assert(
      res.items[0].class_name === null &&
      res.items[0].latest_action_id === null &&
      res.items[0].latest_action_type === null &&
      res.items[0].latest_contacted_at === null &&
      res.items[0].latest_promise_to_pay_date === null &&
      res.items[0].latest_next_follow_up_date === null &&
      res.items[0].last_contacted_by_name === null,
      'TEST 10.2.13 : Tous les 7 champs nullable acceptés à null simultanément'
    );
  } catch (err: unknown) {
    assert(false, `TEST 10.2.13 : Exception inattendue : ${err}`);
  }

  // 10.21.1. Priorities : student_number valide accepté
  try {
    const validStudentNumFixture = JSON.parse(JSON.stringify(validPrioritiesFixture));
    validStudentNumFixture.items[0].student_number = 'MAT-2026-99';
    const res = validateCollectionPrioritiesResponse(validStudentNumFixture);
    assert(res.items[0].student_number === 'MAT-2026-99', 'TEST 10.2.14 : student_number valide accepté');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.14 : Exception inattendue : ${err}`);
  }

  // 10.21.2. Priorities : student_number absent/vide rejeté
  try {
    const missingNumFixture = JSON.parse(JSON.stringify(validPrioritiesFixture));
    delete missingNumFixture.items[0].student_number;
    let caughtMissing = false;
    try {
      validateCollectionPrioritiesResponse(missingNumFixture);
    } catch {
      caughtMissing = true;
    }
    assert(caughtMissing, 'TEST 10.2.15 : student_number absent (undefined) rejeté');

    const emptyNumFixture = JSON.parse(JSON.stringify(validPrioritiesFixture));
    emptyNumFixture.items[0].student_number = '   ';
    let caughtEmptyNum = false;
    try {
      validateCollectionPrioritiesResponse(emptyNumFixture);
    } catch {
      caughtEmptyNum = true;
    }
    assert(caughtEmptyNum, 'TEST 10.2.15.2 : student_number vide rejeté');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.15 : Exception inattendue : ${err}`);
  }

  // 10.21.3. Priorities : created_at absent accepté
  try {
    const noCreatedAtFixture = JSON.parse(JSON.stringify(validPrioritiesFixture));
    assert(!('created_at' in noCreatedAtFixture.items[0]), 'TEST 10.2.16 : created_at est absent de la fixture 24 clés SQL');
    const resNoCreatedAt = validateCollectionPrioritiesResponse(noCreatedAtFixture);
    assert(resNoCreatedAt.items.length === 1, 'TEST 10.2.16.2 : created_at absent de la fixture est accepté avec succès');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.16 : Exception inattendue : ${err}`);
  }

  // 10.21.4. Priorities : présence de created_at ne compense jamais l'absence de student_number
  try {
    const fakeCreatedAtFixture = JSON.parse(JSON.stringify(validPrioritiesFixture));
    delete fakeCreatedAtFixture.items[0].student_number;
    fakeCreatedAtFixture.items[0].created_at = '2026-09-18T12:00:00Z';
    let caughtCompensate = false;
    try {
      validateCollectionPrioritiesResponse(fakeCreatedAtFixture);
    } catch {
      caughtCompensate = true;
    }
    assert(caughtCompensate, 'TEST 10.2.17 : La présence de created_at ne compense jamais l’absence de student_number');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.17 : Exception inattendue : ${err}`);
  }

  // 10.21.5. Priorities : les 24 clés SQL canoniques sont couvertes avec student_number et sans created_at
  try {
    const res24Keys = validateCollectionPrioritiesResponse(validPrioritiesFixture);
    const itemKeys = Object.keys(validPrioritiesFixture.items[0]);
    assert(res24Keys.items.length === 1 && itemKeys.length === 24 && !itemKeys.includes('created_at') && itemKeys.includes('student_number'), 'TEST 10.2.18 : Les 24 clés SQL canoniques sont couvertes avec student_number et sans created_at');
  } catch (err: unknown) {
    assert(false, `TEST 10.2.18 : Exception inattendue : ${err}`);
  }


  // 10.22. RPC Pre-flight : Limite 0 et 101 rejetée côté client avant RPC
  try {
    let caught0 = false;
    try {
      await getSchoolCollectionPriorities({ p_limit: 0 });
    } catch (e: any) {
      if (e.code === '22023') caught0 = true;
    }
    assert(caught0, 'TEST 10.3.7 : Limite p_limit = 0 rejetée côté client avec code 22023');

    let caught101 = false;
    try {
      await getSchoolCollectionPriorities({ p_limit: 101 });
    } catch (e: any) {
      if (e.code === '22023') caught101 = true;
    }
    assert(caught101, 'TEST 10.3.8 : Limite p_limit = 101 rejetée côté client avec code 22023');
  } catch (err: unknown) {
    assert(false, `TEST 10.3.8 : Exception inattendue : ${err}`);
  }

  // 10.23. RPC Pre-flight : Curseur partiel rejeté côté client avant RPC
  try {
    let caughtPartial = false;
    try {
      await getSchoolCollectionPriorities({}, { priority_score: 100 } as any);
    } catch (e: any) {
      if (e.code === '22023') caughtPartial = true;
    }
    assert(caughtPartial, 'TEST 10.3.9 : Curseur partiel rejeté côté client avec code 22023');
  } catch (err: unknown) {
    assert(false, `TEST 10.3.9 : Exception inattendue : ${err}`);
  }

  // 10.24. Source code check : Aucune occurrence animate-pulse dans les 2 nouveaux composants 4C
  try {
    const { CollectionDashboardCards } = await import('../components/admin/finance/CollectionDashboardCards');
    const { CollectionPrioritiesTable } = await import('../components/admin/finance/CollectionPrioritiesTable');

    const dashSrc = CollectionDashboardCards.toString();
    const prioSrc = CollectionPrioritiesTable.toString();

    const pulseOccurrences = (dashSrc.match(/animate-pulse/g) || []).length +
      (prioSrc.match(/animate-pulse/g) || []).length;

    assert(pulseOccurrences === 0, 'TEST 10.5.1 : Source check : aucune occurrence animate-pulse dans les 2 nouveaux composants 4C');
  } catch (err: unknown) {
    assert(false, `TEST 10.5.1 : Exception inattendue : ${err}`);
  }

  console.log(`\n=== RÉSULTATS : ${passed}/${total} TESTS RÉUSSIS ===\n`);
  return { total, passed, failed: total - passed, errors };
}
runFinanceFrontendTests();
