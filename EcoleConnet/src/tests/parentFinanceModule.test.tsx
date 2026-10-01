import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParentFinanceModule } from '../components/parent/ParentFinanceModule';
import { PaymentReceiptModal, type PaymentReceiptData } from '../components/admin/finance/PaymentReceiptModal';
import * as financeService from '../services/financeService';
import type { ParentStudentFinancesResult } from '../types/finance';

vi.mock(import('../services/financeService'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getParentStudentFinances: vi.fn(),
  };
});

describe('Module Finance Parent — Validation Adversariale & Sécurité', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockFinancesData: ParentStudentFinancesResult = {
    student_id: '28af7451-c3a3-4e84-bf03-6058d76cceb7',
    student_number: 'ELV-26-Q8A6',
    student_name: 'Daniel Kabeya Banza',
    class_name: '2A',
    school_name: 'Complexe Scolaire Pilote EcoleConnect',
    total_invoiced: 150,
    total_paid: 150,
    total_remaining: 0,
    currency: 'USD',
    invoices: [
      {
        id: 'inv-12345',
        invoice_number: 'INV-2026-000001',
        issue_date: '2026-09-29',
        due_date: '2026-10-09',
        total_amount: 150,
        paid_amount: 150,
        remaining_balance: 0,
        status: 'paid',
        currency: 'USD',
        items_summary: 'Minerval – Octobre 2026',
      },
    ],
    receipts: [
      {
        receipt_number: 'REC-2026-000001',
        receipt_date: '2026-09-29',
        amount: 50,
        currency: 'USD',
        payment_method: 'cash',
        invoice_number: 'INV-2026-000001',
        balance_after_payment: 100,
        is_cancelled: false,
      },
      {
        receipt_number: 'REC-2026-000002',
        receipt_date: '2026-09-29',
        amount: 50,
        currency: 'USD',
        payment_method: 'bank_transfer',
        invoice_number: 'INV-2026-000001',
        balance_after_payment: 50,
        is_cancelled: false,
      },
      {
        receipt_number: 'REC-2026-000003',
        receipt_date: '2026-09-29',
        amount: 50,
        currency: 'USD',
        payment_method: 'cash',
        invoice_number: 'INV-2026-000001',
        balance_after_payment: 0,
        is_cancelled: false,
      },
    ],
  };

  it('1. parsing d’un tableau receipts valide dans financeService', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 100, total_remaining: 0 } },
      invoices: [{ id: 'i-1', invoice_number: 'INV-1', issue_date: '2026-09-01', total_amount: 100, paid_amount: 100, remaining_balance: 0, status: 'paid' }],
      receipts: [
        { receipt_number: 'REC-001', receipt_date: '2026-09-01', amount: 100, currency: 'USD', payment_method: 'cash', invoice_number: 'INV-1', balance_after_payment: 0, is_cancelled: false }
      ]
    };
    const parsed = financeService.validateParentStudentFinances(rawRpc);
    expect(parsed.receipts).toHaveLength(1);
    expect(parsed.receipts[0].receipt_number).toBe('REC-001');
  });

  it('2. compatibilité lorsque receipts est absent', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [{ id: 'i-1', invoice_number: 'INV-1', issue_date: '2026-09-01', total_amount: 100, paid_amount: 0, remaining_balance: 100, status: 'issued' }]
    };
    const parsed = financeService.validateParentStudentFinances(rawRpc);
    expect(parsed.receipts).toEqual([]);
  });

  it('3. receipts non tableau provoque une erreur FinanceServiceError', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [],
      receipts: 'invalid_string'
    };
    expect(() => financeService.validateParentStudentFinances(rawRpc)).toThrow(financeService.FinanceServiceError);
  });

  it('4. liste mixte valide/invalide rejetée globalement', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [],
      receipts: [
        { receipt_number: 'REC-001', receipt_date: '2026-09-01', amount: 50, currency: 'USD', payment_method: 'cash', invoice_number: 'INV-1', balance_after_payment: 50, is_cancelled: false },
        { receipt_number: null }
      ]
    };
    expect(() => financeService.validateParentStudentFinances(rawRpc)).toThrow(financeService.FinanceServiceError);
  });

  it('5. is_cancelled = "false" (chaîne au lieu de booléen) rejeté', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [],
      receipts: [{ receipt_number: 'REC-01', receipt_date: '2026-09-01', amount: 50, currency: 'USD', payment_method: 'cash', invoice_number: 'INV-1', balance_after_payment: 0, is_cancelled: 'false' }]
    };
    expect(() => financeService.validateParentStudentFinances(rawRpc)).toThrow(financeService.FinanceServiceError);
  });

  it('6. amount = "50" (chaîne au lieu de number) rejeté', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [],
      receipts: [{ receipt_number: 'REC-01', receipt_date: '2026-09-01', amount: '50', currency: 'USD', payment_method: 'cash', invoice_number: 'INV-1', balance_after_payment: 0, is_cancelled: false }]
    };
    expect(() => financeService.validateParentStudentFinances(rawRpc)).toThrow(financeService.FinanceServiceError);
  });

  it('7. amount = Infinity rejeté', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [],
      receipts: [{ receipt_number: 'REC-01', receipt_date: '2026-09-01', amount: Infinity, currency: 'USD', payment_method: 'cash', invoice_number: 'INV-1', balance_after_payment: 0, is_cancelled: false }]
    };
    expect(() => financeService.validateParentStudentFinances(rawRpc)).toThrow(financeService.FinanceServiceError);
  });

  it('8. balance_after_payment = NaN rejeté', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [],
      receipts: [{ receipt_number: 'REC-01', receipt_date: '2026-09-01', amount: 50, currency: 'USD', payment_method: 'cash', invoice_number: 'INV-1', balance_after_payment: NaN, is_cancelled: false }]
    };
    expect(() => financeService.validateParentStudentFinances(rawRpc)).toThrow(financeService.FinanceServiceError);
  });

  it('9. date impossible ou invalide rejetée', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [],
      receipts: [{ receipt_number: 'REC-01', receipt_date: 'Invalid Date', amount: 50, currency: 'USD', payment_method: 'cash', invoice_number: 'INV-1', balance_after_payment: 0, is_cancelled: false }]
    };
    expect(() => financeService.validateParentStudentFinances(rawRpc)).toThrow(financeService.FinanceServiceError);
  });

  it('10. suppression des UUIDs supplémentaires pendant le mapping', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [],
      receipts: [
        {
          receipt_number: 'REC-01',
          receipt_date: '2026-09-01',
          amount: 50,
          currency: 'USD',
          payment_method: 'cash',
          invoice_number: 'INV-1',
          balance_after_payment: 0,
          is_cancelled: false,
          id: '550e8400-e29b-41d4-a716-446655440000',
          payment_id: 'secret-payment-id'
        }
      ]
    };
    const parsed = financeService.validateParentStudentFinances(rawRpc);
    expect((parsed.receipts[0] as any).id).toBeUndefined();
    expect((parsed.receipts[0] as any).payment_id).toBeUndefined();
  });

  it('11. affichage de trois reçus pour Daniel Kabeya Banza', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      expect(screen.getByText('REC-2026-000001')).toBeInTheDocument();
      expect(screen.getByText('REC-2026-000002')).toBeInTheDocument();
      expect(screen.getByText('REC-2026-000003')).toBeInTheDocument();
    });
  });

  it('12. compteur "Paiements & Reçus (3)"', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      expect(screen.getByText('Paiements & Reçus (3)')).toBeInTheDocument();
    });
  });

  it('13. traduction Espèces et Virement bancaire', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      expect(screen.getAllByText('Espèces').length).toBeGreaterThan(0);
      expect(screen.getByText('Virement bancaire')).toBeInTheDocument();
    });
  });

  it('14. tri déterministe par numéro de reçu décroissant', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      const receiptElements = screen.getAllByText(/REC-2026-00000/);
      expect(receiptElements[0].textContent).toBe('REC-2026-000003');
      expect(receiptElements[1].textContent).toBe('REC-2026-000002');
      expect(receiptElements[2].textContent).toBe('REC-2026-000001');
    });
  });

  it('15. affichage du solde après paiement', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    const { container } = render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      expect(container.textContent).toContain('Solde après paiement :');
      expect(container.textContent).toContain('100');
      expect(container.textContent).toContain('50');
      expect(container.textContent).toContain('0');
    });
  });

  it('16. ouverture de la modale sans numéro de paiement inventé', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      const viewButtons = screen.getAllByText('Voir le reçu');
      fireEvent.click(viewButtons[0]);
    });

    expect(screen.getByText('Reçu de Paiement Officiel')).toBeInTheDocument();
    expect(screen.getByText('N° REÇU : REC-2026-000003')).toBeInTheDocument();
    expect(screen.queryByText('N° Paiement')).not.toBeInTheDocument();
  });

  it('17. affichage visuel d’un reçu annulé', async () => {
    const mockWithCancelled: ParentStudentFinancesResult = {
      ...mockFinancesData,
      receipts: [
        {
          receipt_number: 'REC-2026-000099',
          receipt_date: '2026-09-28',
          amount: 50,
          currency: 'USD',
          payment_method: 'cash',
          invoice_number: 'INV-2026-000001',
          balance_after_payment: 150,
          is_cancelled: true,
        },
      ],
    };

    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockWithCancelled,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      expect(screen.getByText('Annulé')).toBeInTheDocument();
    });
  });

  it('18. état vide contrôlé', async () => {
    const mockEmpty: ParentStudentFinancesResult = {
      ...mockFinancesData,
      receipts: [],
    };

    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockEmpty,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      expect(screen.getByText('Aucun paiement ou reçu enregistré pour cet élève.')).toBeInTheDocument();
    });
  });

  it('19. changement d’enfant ferme la modale si ouverte', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    const { rerender } = render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      const viewButtons = screen.getAllByText('Voir le reçu');
      fireEvent.click(viewButtons[0]);
    });

    expect(screen.getByText('Reçu de Paiement Officiel')).toBeInTheDocument();

    const mockChild2: ParentStudentFinancesResult = {
      ...mockFinancesData,
      student_id: 'stu-222',
      student_name: 'Esther Banza',
      receipts: [],
    };

    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockChild2,
      error: null,
    });

    rerender(<ParentFinanceModule studentId="stu-222" />);

    await waitFor(() => {
      expect(screen.queryByText('Reçu de Paiement Officiel')).not.toBeInTheDocument();
    });
  });

  it('20. erreur RPC efface les anciennes données visibles', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    const { rerender } = render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      expect(screen.getByText('REC-2026-000001')).toBeInTheDocument();
    });

    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: null,
      error: { message: 'REJET ACCÈS : Accès refusé', code: '42501' } as any,
    });

    rerender(<ParentFinanceModule studentId="stu-333" />);

    await waitFor(() => {
      expect(screen.queryByText('REC-2026-000001')).not.toBeInTheDocument();
      expect(screen.getByText('Accès restreint à la consultation financière')).toBeInTheDocument();
    });
  });

  it('21. absence d’UUID dans innerHTML et les attributs DOM', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    const { container } = render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      expect(screen.getByText('REC-2026-000001')).toBeInTheDocument();
    });

    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(uuidRegex.test(container.innerHTML)).toBe(false);
  });

  it('22. usage Administration de PaymentReceiptModal non régressé avec payment_number', () => {
    const adminData: PaymentReceiptData = {
      receipt_number: 'REC-2026-000001',
      payment_number: 'PAY-2026-000001',
      invoice_number: 'INV-2026-000001',
      student_name: 'Daniel Kabeya Banza',
      student_number: 'ELV-26-Q8A6',
      amount: 50,
      currency: 'USD',
      payment_date: '2026-09-29',
      payment_method: 'cash',
    };

    render(
      <PaymentReceiptModal
        isOpen={true}
        onClose={() => {}}
        receipt={adminData}
        schoolName="Complexe Scolaire Pilote"
      />
    );

    expect(screen.getByText('PAY-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('N° Paiement')).toBeInTheDocument();
  });

  it('23. receipts = null est traité comme tableau vide (compatibilité rétroactive)', () => {
    const rawRpc = {
      student: { id: '28af7451-c3a3-4e84-bf03-6058d76cceb7', student_number: 'ELV-1', student_full_name: 'Test Child', class_name: '1A' },
      summary_by_currency: { USD: { currency: 'USD', total_invoiced: 100, total_paid: 0, total_remaining: 100 } },
      invoices: [{ id: 'i-1', invoice_number: 'INV-1', issue_date: '2026-09-01', total_amount: 100, paid_amount: 0, remaining_balance: 100, status: 'issued' }],
      receipts: null
    };
    const parsed = financeService.validateParentStudentFinances(rawRpc);
    expect(parsed.receipts).toEqual([]);
  });

  it('24. bouton impression libellé honnête : \"Imprimer le reçu\" sans promise PDF automatique', () => {
    const data: PaymentReceiptData = {
      receipt_number: 'REC-2026-000001',
      invoice_number: 'INV-2026-000001',
      student_name: 'Daniel Kabeya Banza',
      student_number: 'ELV-26-Q8A6',
      amount: 50,
      currency: 'USD',
      payment_date: '2026-09-29',
      payment_method: 'cash',
    };

    render(
      <PaymentReceiptModal
        isOpen={true}
        onClose={() => {}}
        receipt={data}
        schoolName="Complexe Scolaire Pilote"
      />
    );

    // Le bouton doit indiquer "Imprimer le reçu" — pas de "(PDF)" promettant un téléchargement automatique
    expect(screen.getByText('Imprimer le reçu')).toBeInTheDocument();
    expect(screen.queryByText(/PDF/i)).not.toBeInTheDocument();
  });

  it('25. modale reçu annulé : titre distinct, watermark ANNULÉ, aucune action de réactivation', () => {
    const cancelledData: PaymentReceiptData = {
      receipt_number: 'REC-2026-000099',
      invoice_number: 'INV-2026-000001',
      student_name: 'Daniel Kabeya Banza',
      student_number: 'ELV-26-Q8A6',
      amount: 50,
      currency: 'USD',
      payment_date: '2026-09-28',
      payment_method: 'cash',
      is_cancelled: true,
    };

    render(
      <PaymentReceiptModal
        isOpen={true}
        onClose={() => {}}
        receipt={cancelledData}
        schoolName="Complexe Scolaire Pilote"
      />
    );

    // Titre de la modale distingue explicitement le reçu annulé
    expect(screen.getByText('Reçu de Paiement Annulé (Archivé)')).toBeInTheDocument();
    // Watermark textuel ANNULÉ
    expect(screen.getByText('ANNULÉ')).toBeInTheDocument();
    // Badge "Paiement Annulé" dans la zone montant
    expect(screen.getByText('Paiement Annulé')).toBeInTheDocument();
    // Libellé "Montant Annulé" — pas "Montant Reçu"
    expect(screen.getByText('Montant Annulé :')).toBeInTheDocument();
    // Aucune action de réactivation proposée
    expect(screen.queryByText(/réactiv/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/modifier/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/annuler/i, { selector: 'button' })).not.toBeInTheDocument();
  });

  it('26. aucune action administrative exposée dans la vue Parent (ni bouton annuler ni bouton modifier)', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      expect(screen.getByText('REC-2026-000001')).toBeInTheDocument();
    });

    // Le portail Parent ne doit exposer aucun bouton d'action administrative
    expect(screen.queryByRole('button', { name: /annuler/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /modifier/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /supprimer/i })).not.toBeInTheDocument();
  });

  it('27. modale affiche "Solde après ce paiement" pour REC-2026-000003 (balance=0)', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    // Tri décroissant → viewButtons[0] = REC-000003 (balance_after_payment=0)
    await waitFor(() => {
      const viewButtons = screen.getAllByText('Voir le reçu');
      fireEvent.click(viewButtons[0]);
    });

    await waitFor(() => {
      expect(screen.getByText('Solde après ce paiement :')).toBeInTheDocument();
    });
  });

  it('28. modale affiche "Solde après ce paiement" pour REC-2026-000002 (balance=50)', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      const viewButtons = screen.getAllByText('Voir le reçu');
      fireEvent.click(viewButtons[1]); // REC-000002 (balance=50)
    });

    await waitFor(() => {
      expect(screen.getByText('Solde après ce paiement :')).toBeInTheDocument();
    });
  });

  it('29. modale affiche "Solde après ce paiement" pour REC-2026-000001 (balance=100)', async () => {
    vi.mocked(financeService.getParentStudentFinances).mockResolvedValue({
      finances: mockFinancesData,
      error: null,
    });

    render(<ParentFinanceModule studentId="28af7451-c3a3-4e84-bf03-6058d76cceb7" />);

    await waitFor(() => {
      const viewButtons = screen.getAllByText('Voir le reçu');
      fireEvent.click(viewButtons[2]); // REC-000001 (balance=100)
    });

    await waitFor(() => {
      expect(screen.getByText('Solde après ce paiement :')).toBeInTheDocument();
    });
  });

  it('30. absence de balance_after_payment masque la ligne dans la modale', () => {
    const dataWithoutBalance: PaymentReceiptData = {
      receipt_number: 'REC-2026-999999',
      invoice_number: 'INV-2026-000001',
      student_name: 'Test Élève',
      student_number: 'ELV-99',
      amount: 75,
      currency: 'USD',
      payment_date: '2026-09-30',
      payment_method: 'cash',
      // balance_after_payment intentionnellement absent
    };

    render(
      <PaymentReceiptModal
        isOpen={true}
        onClose={() => {}}
        receipt={dataWithoutBalance}
        schoolName="École Test"
      />
    );

    expect(screen.queryByText('Solde après ce paiement :')).not.toBeInTheDocument();
    expect(screen.getByText('Montant Reçu :')).toBeInTheDocument();
  });

  it('31. non-régression Administration : payment_number ET balance_after_payment simultanément', () => {
    const adminData: PaymentReceiptData = {
      receipt_number: 'REC-2026-000001',
      payment_number: 'PAY-2026-000001',
      invoice_number: 'INV-2026-000001',
      student_name: 'Daniel Kabeya Banza',
      student_number: 'ELV-26-Q8A6',
      amount: 50,
      currency: 'USD',
      payment_date: '2026-09-29',
      payment_method: 'cash',
      balance_after_payment: 100,
    };

    render(
      <PaymentReceiptModal
        isOpen={true}
        onClose={() => {}}
        receipt={adminData}
        schoolName="Complexe Scolaire Pilote"
      />
    );

    expect(screen.getByText('PAY-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('N° Paiement')).toBeInTheDocument();
    expect(screen.getByText('Solde après ce paiement :')).toBeInTheDocument();
  });
});
