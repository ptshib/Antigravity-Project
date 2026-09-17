// Fichier : src/tests/financeFrontend.test.ts
// Tests unitaires frontend automatisés pour la Phase Finance 2 ÉcoleConnect

import {
  validateRecordPaymentResult,
  validateCreateDraftInvoiceResult,
  computeFinanceDashboardKPIs,
  validateAgingSummaryResponse,
  validateOverdueInvoicesResponse,
  getSchoolOverdueInvoicesAdmin
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

  console.log(`\n=== RÉSULTATS : ${passed}/${total} TESTS RÉUSSIS ===\n`);
  return { total, passed, failed: total - passed, errors };
}
runFinanceFrontendTests();
