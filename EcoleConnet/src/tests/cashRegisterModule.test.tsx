// Fichier : src/tests/cashRegisterModule.test.tsx
// Suite de tests dédiée pour LOT 2K-FIN-CASH-F-V2 — CLASSES, CAISSIERS, REÇUS ET DATE LOCALE

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseAndValidateCashJournalResponse,
  getSchoolCashRegisterJournal,
  fetchSchoolClasses,
  fetchSchoolAuthorizedCashiers
} from '../services/financeService';
import { SchoolCashRegisterModule } from '../components/admin/finance/SchoolCashRegisterModule';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => {
  return {
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(() => {
        throw new Error('DIRECT_SELECT_FORBIDDEN: Direct select on financial tables is forbidden.');
      })
    }
  };
});

describe('LOT 2K-FIN-CASH-F-V2 — Module Caisse, Classes, Caissiers, Reçus et Date Locale', () => {
  const validMockResponse = {
    school_id: '11111111-1111-4111-a111-111111111111',
    period: {
      start_date: '2026-10-04',
      end_date: '2026-10-04',
      max_period_days: 366
    },
    summary: {
      USD: {
        currency: 'USD',
        gross_collected: 500,
        cancellations_amount: 100,
        net_event_amount: 400,
        cash_collected: 300,
        cash_cancelled: 50,
        cash_net_event: 250,
        collections_count: 5,
        cancellations_count: 1,
        by_payment_method: {
          cash: { gross: 300, cancelled: 50, net: 250, collections_count: 3, cancellations_count: 1 },
          bank_transfer: { gross: 200, cancelled: 50, net: 150, collections_count: 2, cancellations_count: 0 }
        },
        by_category: [
          { fee_type: 'minerval', gross_collected: 300, cancellations_amount: 60, net_event_amount: 240, confirmed_current_total: 240 },
          { fee_type: 'inscription', gross_collected: 200, cancellations_amount: 40, net_event_amount: 160, confirmed_current_total: 160 }
        ],
        by_class: [
          { class_name: 'Classe A', gross_collected: 300, cancellations_amount: 60, net_event_amount: 240, confirmed_current_total: 240, collections_count: 3, cancellations_count: 1 },
          { class_name: 'Classe B', gross_collected: 200, cancellations_amount: 40, net_event_amount: 160, confirmed_current_total: 160, collections_count: 2, cancellations_count: 0 }
        ]
      },
      CDF: {
        currency: 'CDF',
        gross_collected: 100000,
        cancellations_amount: 0,
        net_event_amount: 100000,
        cash_collected: 100000,
        cash_cancelled: 0,
        cash_net_event: 100000,
        collections_count: 2,
        cancellations_count: 0,
        by_payment_method: {
          cash: { gross: 100000, cancelled: 0, net: 100000, collections_count: 2, cancellations_count: 0 }
        },
        by_category: [
          { fee_type: 'minerval', gross_collected: 100000, cancellations_amount: 0, net_event_amount: 100000, confirmed_current_total: 100000 }
        ],
        by_class: [
          { class_name: 'Classe A', gross_collected: 100000, cancellations_amount: 0, net_event_amount: 100000, confirmed_current_total: 100000, collections_count: 2, cancellations_count: 0 }
        ]
      }
    },
    disclaimer: "Le net cash représente uniquement les encaissements scolaires en espèces après annulations comptables. Il ne constitue pas le solde physique complet du coffre.",
    pagination: {
      page: 1,
      page_size: 20,
      total_records: 6,
      total_pages: 1,
      has_previous: false,
      has_next: false
    },
    journal_entries: [
      {
        event_date: '2026-10-04',
        event_type: 'collection',
        payment_number: 'PAY-20261004-001',
        receipt_number: 'REC-20261004-001',
        payment_status: 'confirmed',
        receipt_is_cancelled: false,
        invoice_number: 'FACT-2026-001',
        student_name: 'Jean Kabanga',
        student_matricule: 'MAT-1001',
        class_name: 'Classe A',
        payment_method: 'cash',
        cashier_name: 'Marie Mwamba',
        currency: 'USD',
        amount: 100,
        cancellation_reason: null,
        category_allocations: [
          { fee_type: 'minerval', amount: 100 }
        ]
      },
      {
        event_date: '2026-10-04',
        event_type: 'cancellation',
        payment_number: 'PAY-20261004-002',
        receipt_number: 'REC-20261004-002',
        payment_status: 'cancelled',
        receipt_is_cancelled: true,
        invoice_number: 'FACT-2026-002',
        student_name: 'Pauline Tshilombo',
        student_matricule: 'MAT-1002',
        class_name: 'Classe B',
        payment_method: 'cash',
        cashier_name: 'Marie Mwamba',
        currency: 'USD',
        amount: -50,
        cancellation_reason: 'Erreur de saisie caisse',
        category_allocations: [
          { fee_type: 'minerval', amount: -50 }
        ]
      },
      {
        event_date: '2026-10-04',
        event_type: 'collection',
        payment_number: 'PAY-20261004-003',
        receipt_number: null,
        payment_status: 'confirmed',
        receipt_is_cancelled: false,
        invoice_number: 'FACT-2026-003',
        student_name: 'Alain Mukendi',
        student_matricule: 'MAT-1003',
        class_name: 'Classe A',
        payment_method: 'cash',
        cashier_name: 'Marie Mwamba',
        currency: 'CDF',
        amount: 50000,
        cancellation_reason: null,
        category_allocations: [
          { fee_type: 'minerval', amount: 50000 }
        ]
      }
    ]
  };

  const mockClasses = [
    { id: '22222222-2222-4222-a222-222222222222', name: 'Classe A' },
    { id: '33333333-3333-4333-a333-333333333333', name: 'Classe B' }
  ];

  const mockCashiers = [
    { id: '44444444-4444-4444-a444-444444444444', first_name: 'Marie', last_name: 'Mwamba', email: 'marie@ecole.cd' }
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'classes') {
        const queryChain: any = {
          select: () => queryChain,
          eq: () => queryChain,
          order: () => Promise.resolve({ data: mockClasses, error: null })
        };
        return queryChain;
      }
      if (table === 'profiles') {
        const queryChain: any = {
          select: () => queryChain,
          eq: () => queryChain,
          in: () => queryChain,
          order: () => Promise.resolve({ data: mockCashiers, error: null })
        };
        return queryChain;
      }
      throw new Error(`DIRECT_SELECT_FORBIDDEN: Direct select on table ${table} is forbidden.`);
    });

    (supabase.rpc as any).mockImplementation(async (rpcName: string) => {
      if (rpcName === 'get_school_cash_register_journal') {
        return { data: validMockResponse, error: null };
      }
      if (rpcName === 'get_school_cash_register_filter_options') {
        return {
          data: {
            classes: mockClasses,
            cashiers: [
              { id: '44444444-4444-4444-a444-444444444444', full_name: 'Marie Mwamba' }
            ]
          },
          error: null
        };
      }
      return { data: null, error: new Error(`Unknown RPC: ${rpcName}`) };
    });
  });

  describe('1. Invariants et Validation des Agrégats par Classe (by_class)', () => {
    it('parse et valide by_class pour USD et CDF avec réconciliation exacte', () => {
      const parsed = parseAndValidateCashJournalResponse(validMockResponse);
      expect(parsed.summary.USD.by_class).toHaveLength(2);
      expect(parsed.summary.USD.by_class[0].class_name).toBe('Classe A');
      expect(parsed.summary.USD.by_class[1].class_name).toBe('Classe B');

      // Check sum of by_class equals gross_collected (300 + 200 = 500)
      const usdGrossClassSum = parsed.summary.USD.by_class.reduce((sum, c) => sum + c.gross_collected, 0);
      expect(usdGrossClassSum).toBe(parsed.summary.USD.gross_collected);

      // Check sum of by_class cancellations equals cancellations_amount (60 + 40 = 100)
      const usdCancelClassSum = parsed.summary.USD.by_class.reduce((sum, c) => sum + c.cancellations_amount, 0);
      expect(usdCancelClassSum).toBe(parsed.summary.USD.cancellations_amount);
    });

    it('rejette les réponses où la somme by_class violerait gross_collected', () => {
      const invalidResponse = JSON.parse(JSON.stringify(validMockResponse));
      invalidResponse.summary.USD.by_class[0].gross_collected = 999; // Violation
      expect(() => parseAndValidateCashJournalResponse(invalidResponse)).toThrow(
        /MONETARY_INVARIANT_VIOLATION/
      );
    });
  });

  describe('2. Gestion des Reçus (Actif, Annulé et Sans Reçu)', () => {
    it('traite correctement payment_status, receipt_is_cancelled et receipt_number null', () => {
      const parsed = parseAndValidateCashJournalResponse(validMockResponse);
      expect(parsed.journal_entries[0].receipt_number).toBe('REC-20261004-001');
      expect(parsed.journal_entries[0].receipt_is_cancelled).toBe(false);
      expect(parsed.journal_entries[0].payment_status).toBe('confirmed');

      expect(parsed.journal_entries[1].receipt_number).toBe('REC-20261004-002');
      expect(parsed.journal_entries[1].receipt_is_cancelled).toBe(true);
      expect(parsed.journal_entries[1].payment_status).toBe('cancelled');

      expect(parsed.journal_entries[2].receipt_number).toBeNull();
      expect(parsed.journal_entries[2].receipt_is_cancelled).toBe(false);
    });
  });

  describe('3. Période par Défaut et Fuseau Horaires Locaux (Kinshasa & Lubumbashi)', () => {
    it('transmet NULL pour p_start_date et p_end_date si non fournis pour calcul local RPC', async () => {
      await getSchoolCashRegisterJournal({
        startDate: '',
        endDate: ''
      });

      expect(supabase.rpc).toHaveBeenCalledWith(
        'get_school_cash_register_journal',
        expect.objectContaining({
          p_start_date: null,
          p_end_date: null
        })
      );
    });
  });

  describe('4. Sécurisation RLS pour Classes et Caissiers', () => {
    it('charge les classes actives de l’établissement sous RLS via fetchSchoolClasses', async () => {
      const classes = await fetchSchoolClasses('11111111-1111-4111-a111-111111111111');
      expect(classes).toHaveLength(2);
      expect(classes[0].name).toBe('Classe A');
      expect(classes[1].name).toBe('Classe B');
    });

    it('charge les caissiers autorisés de l’établissement sous RLS via fetchSchoolAuthorizedCashiers', async () => {
      const cashiers = await fetchSchoolAuthorizedCashiers('11111111-1111-4111-a111-111111111111');
      expect(cashiers).toHaveLength(1);
      expect(cashiers[0].full_name).toBe('Marie Mwamba');
    });
  });

  describe('5. UI: Vue Par Classe et Interdiction Absolue d’UUID dans le DOM', () => {
    it('rend la vue Par Classe avec Classe A et Classe B', async () => {
      render(
        <SchoolCashRegisterModule
          schoolId="sch-123"
          activeSubTab="caisse_classes"
          onSelectSubTab={() => {}}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Analyse des Encaissements par Classe (USD)")).toBeInTheDocument();
        expect(screen.getByText("Analyse des Encaissements par Classe (CDF)")).toBeInTheDocument();
        expect(screen.getAllByText("Classe A").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Classe B").length).toBeGreaterThan(0);
      });
    });

    it('garantit qu’aucun UUID brut n’est présent dans container.innerHTML', async () => {
      const subTabs: Array<'caisse_overview' | 'caisse_journal' | 'caisse_categories' | 'caisse_classes' | 'caisse_cancellations'> = [
        'caisse_overview',
        'caisse_journal',
        'caisse_categories',
        'caisse_classes',
        'caisse_cancellations'
      ];

      for (const subTab of subTabs) {
        const { container, unmount } = render(
          <SchoolCashRegisterModule
            schoolId="11111111-1111-4111-a111-111111111111"
            activeSubTab={subTab}
            onSelectSubTab={() => {}}
          />
        );

        await waitFor(() => {
          expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
        });

        const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
        const matches = container.innerHTML.match(uuidRegex);
        expect(matches).toBeNull();
        unmount();
      }
    });

    it('utilise des index UI non sensibles (cls_0, csh_0) dans les sélecteurs', async () => {
      render(
        <SchoolCashRegisterModule
          schoolId="11111111-1111-4111-a111-111111111111"
          activeSubTab="caisse_journal"
          onSelectSubTab={() => {}}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText("Sélectionner la classe")).toBeInTheDocument();
      });

      const classSelect = screen.getByLabelText("Sélectionner la classe") as HTMLSelectElement;
      expect(classSelect.children[1]).toHaveValue('cls_0');
      expect(classSelect.children[2]).toHaveValue('cls_1');

      const cashierSelect = screen.getByLabelText("Sélectionner l'agent caissier") as HTMLSelectElement;
      expect(cashierSelect.children[1]).toHaveValue('csh_0');
    });
  });

  describe('6. Reçus dans la Modal (Actif vs Annulé vs Sans Reçu)', () => {
    it('ouvre la modale pour un reçu actif ("Reçu de Paiement Officiel")', async () => {
      render(
        <SchoolCashRegisterModule
          schoolId="11111111-1111-4111-a111-111111111111"
          activeSubTab="caisse_journal"
          onSelectSubTab={() => {}}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("REC-20261004-001")).toBeInTheDocument();
      });

      const activeBtn = screen.getByText("REC-20261004-001");
      fireEvent.click(activeBtn);

      await waitFor(() => {
        expect(screen.getByText("Reçu de Paiement Officiel")).toBeInTheDocument();
        expect(screen.getByText("REÇU DE CAISSE SCOLAIRE OFFICIEL")).toBeInTheDocument();
      });
    });

    it('ouvre la modale pour un reçu annulé ("Reçu de Paiement Annulé (Archivé)")', async () => {
      render(
        <SchoolCashRegisterModule
          schoolId="11111111-1111-4111-a111-111111111111"
          activeSubTab="caisse_journal"
          onSelectSubTab={() => {}}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("REC-20261004-002 (Annulé)")).toBeInTheDocument();
      });

      const cancelledBtn = screen.getByText("REC-20261004-002 (Annulé)");
      fireEvent.click(cancelledBtn);

      await waitFor(() => {
        expect(screen.getByText("Reçu de Paiement Annulé (Archivé)")).toBeInTheDocument();
      });
    });

    it('n’affiche aucun bouton pour un événement sans reçu (receipt_number null)', async () => {
      render(
        <SchoolCashRegisterModule
          schoolId="11111111-1111-4111-a111-111111111111"
          activeSubTab="caisse_journal"
          onSelectSubTab={() => {}}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Alain Mukendi")).toBeInTheDocument();
      });

      // Alain Mukendi row has '-' in receipt column
      const alainRow = screen.getByText("Alain Mukendi").closest('tr');
      expect(alainRow).not.toBeNull();
      expect(alainRow?.querySelector('button')).toBeNull();
    });
  });

  describe('7. États UI : Chargement, Vide, Erreur et Réessayer', () => {
    it('affiche un message d’erreur avec le bouton Réessayer en cas de failure RPC', async () => {
      (supabase.rpc as any).mockImplementation(async (rpcName: string) => {
        if (rpcName === 'get_school_cash_register_filter_options') {
          return {
            data: { classes: mockClasses, cashiers: [{ id: '44444444-4444-4444-a444-444444444444', full_name: 'Marie Mwamba' }] },
            error: null
          };
        }
        if (rpcName === 'get_school_cash_register_journal') {
          return { data: null, error: new Error('Erreur de connexion RPC') };
        }
        return { data: null, error: new Error(`Unknown RPC: ${rpcName}`) };
      });

      render(
        <SchoolCashRegisterModule
          schoolId="11111111-1111-4111-a111-111111111111"
          activeSubTab="caisse_overview"
          onSelectSubTab={() => {}}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Erreur lors de la récupération des données/i)).toBeInTheDocument();
        expect(screen.getByText("Réessayer")).toBeInTheDocument();
      });
    });

    it('affiche l’état vide lorsque journal_entries est vide', async () => {
      const emptyResponse = JSON.parse(JSON.stringify(validMockResponse));
      emptyResponse.journal_entries = [];
      emptyResponse.pagination.total_records = 0;

      (supabase.rpc as any).mockImplementation(async (rpcName: string) => {
        if (rpcName === 'get_school_cash_register_filter_options') {
          return {
            data: { classes: mockClasses, cashiers: [{ id: '44444444-4444-4444-a444-444444444444', full_name: 'Marie Mwamba' }] },
            error: null
          };
        }
        if (rpcName === 'get_school_cash_register_journal') {
          return { data: emptyResponse, error: null };
        }
        return { data: null, error: new Error(`Unknown RPC: ${rpcName}`) };
      });

      render(
        <SchoolCashRegisterModule
          schoolId="11111111-1111-4111-a111-111111111111"
          activeSubTab="caisse_journal"
          onSelectSubTab={() => {}}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Aucun événement trouvé pour la période et les filtres sélectionnés.")).toBeInTheDocument();
      });
    });
  });
});
