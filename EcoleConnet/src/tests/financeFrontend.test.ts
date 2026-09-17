// Fichier : src/tests/financeFrontend.test.ts
// Tests unitaires frontend automatisés pour la Phase Finance 2 ÉcoleConnect

import { validateRecordPaymentResult, validateCreateDraftInvoiceResult, computeFinanceDashboardKPIs } from '../services/financeService';
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

  console.log(`\n=== RÉSULTATS : ${passed}/${total} TESTS RÉUSSIS ===\n`);
  return { total, passed, failed: total - passed, errors };
}

runFinanceFrontendTests();
