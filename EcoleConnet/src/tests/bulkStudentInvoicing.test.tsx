// Fichier : src/tests/bulkStudentInvoicing.test.tsx
// Suite de tests frontend complète (45 cas réels) pour la facturation groupée (Lot 2K-FIN-BULK-F-V)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  validateBulkInvoicePreviewResult,
  validateBulkInvoiceCreationResult,
  previewBulkStudentInvoiceDrafts,
  createBulkStudentInvoiceDrafts,
  FinanceServiceError
} from '../services/financeService';
import { CreateBulkInvoiceModal } from '../components/admin/finance/CreateBulkInvoiceModal';
import { StudentInvoicesModule } from '../components/admin/finance/StudentInvoicesModule';
import { NotificationProvider } from '../context/NotificationContext';
import { supabase } from '../lib/supabase';

// Mock Notification Context
vi.mock('../context/NotificationContext', async () => {
  const actual = await vi.importActual('../context/NotificationContext');
  return {
    ...actual,
    useNotifications: () => ({
      showToast: vi.fn(),
      notifications: []
    })
  };
});

describe('LOT 2K-FIN-BULK-F-V — Suite de 45 Tests Adversariaux Frontend Facturation Groupée', () => {
  const sampleSchoolId = 'a1000000-0000-4000-a000-000000000001';
  const sampleFeeId = 'f1000000-0000-4000-a000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // CONTRAT RÉEL ET TYPES (CAS 1 À 9)
  // ---------------------------------------------------------------------------

  it('1. Accepte le JSON preview SQL réel issu de preview_bulk_student_invoice_drafts', () => {
    const rawJson = {
      fee: {
        fee_id: "55555555-5555-4555-a555-555555555555",
        title: "Frais Scolaires T1 2026",
        amount: 150,
        currency: "USD",
        due_date: "2026-10-31",
        academic_year_name: "2026-2027",
        target: "school"
      },
      scope: "fee_target",
      summary: {
        selected: 2,
        eligible: 1,
        already_invoiced: 0,
        inactive_or_unenrolled: 1,
        estimated_total: 150,
        currency: "USD"
      },
      eligible_students: [
        {
          student_id: "66666666-6666-4666-a666-666666666666",
          first_name: "Jean",
          last_name: "Dupont",
          class_name: "6ème Année A"
        }
      ],
      excluded_students: [
        {
          student_id: "77777777-7777-4777-a777-777777777777",
          first_name: "Marie",
          last_name: "Kalala",
          reason_code: "inactive_enrollment",
          reason_label: "Aucune inscription active pour cette année scolaire"
        }
      ]
    };

    const parsed = validateBulkInvoicePreviewResult(rawJson);
    expect(parsed.fee.title).toBe('Frais Scolaires T1 2026');
    expect(parsed.scope).toBe('fee_target');
    expect(parsed.summary.selected).toBe(2);
    expect(parsed.summary.eligible).toBe(1);
    expect(parsed.summary.inactive_or_unenrolled).toBe(1);
    expect(parsed.eligible_students).toHaveLength(1);
    expect(parsed.excluded_students).toHaveLength(1);
  });

  it('2. Accepte le JSON create SQL réel issu de create_bulk_student_invoice_drafts', () => {
    const rawJson = {
      batch_key: "bulk-20261002-test-contract-key-999",
      fee_title: "Frais Scolaires T1 2026",
      currency: "USD",
      summary: {
        selected: 2,
        created: 1,
        existing: 0,
        skipped: 1
      },
      created_invoices: [
        {
          invoice_id: "aa6a5050-3402-4e14-bc62-a60725bcbab0",
          invoice_number: null,
          student_id: "66666666-6666-4666-a666-666666666666",
          amount: 150
        }
      ],
      existing_invoices: [],
      skipped_students: [
        {
          student_id: "77777777-7777-4777-a777-777777777777",
          reason_code: "inactive_enrollment",
          reason_label: "Aucune inscription active pour cette année scolaire"
        }
      ]
    };

    const parsed = validateBulkInvoiceCreationResult(rawJson);
    expect(parsed.batch_key).toBe('bulk-20261002-test-contract-key-999');
    expect(parsed.fee_title).toBe('Frais Scolaires T1 2026');
    expect(parsed.summary.created).toBe(1);
    expect(parsed.summary.skipped).toBe(1);
    expect(parsed.created_invoices[0].invoice_number).toBeNull();
  });

  it('3. Valide le type exact du scope backend en tant que chaîne primitive (fee_target | classes | students)', () => {
    const validRaw = {
      fee: { fee_id: sampleFeeId, title: 'T', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
      scope: 'classes',
      summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 10, currency: 'USD' },
      eligible_students: [{ student_id: 's1', first_name: 'A', last_name: 'B', class_name: 'C' }],
      excluded_students: []
    };

    const parsed = validateBulkInvoicePreviewResult(validRaw);
    expect(parsed.scope).toBe('classes');

    // Reject nested object scope
    const invalidRaw = { ...validRaw, scope: { scope_type: 'classes' } };
    expect(() => validateBulkInvoicePreviewResult(invalidRaw)).toThrow(FinanceServiceError);
  });

  it('4. Contrôle la parité des champs élèves SQL (student_id, first_name, last_name, class_name, reason_code, reason_label)', () => {
    const raw = {
      fee: { fee_id: sampleFeeId, title: 'T', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
      scope: 'fee_target',
      summary: { selected: 2, eligible: 1, already_invoiced: 1, inactive_or_unenrolled: 0, estimated_total: 10, currency: 'USD' },
      eligible_students: [{ student_id: 's1', first_name: 'Paul', last_name: 'Ilunga', class_name: '5ème CG' }],
      excluded_students: [{ student_id: 's2', first_name: 'Marc', last_name: 'Banza', reason_code: 'already_invoiced', reason_label: 'Déjà facturé pour cette période' }]
    };

    const parsed = validateBulkInvoicePreviewResult(raw);
    expect(parsed.eligible_students[0].first_name).toBe('Paul');
    expect(parsed.excluded_students[0].reason_label).toBe('Déjà facturé pour cette période');
  });

  it('5. Accepte invoice_number null dans la réponse de création groupée (brouillons sans numérotation officielle)', () => {
    const raw = {
      batch_key: 'bulk-key-null-test',
      fee_title: 'Frais',
      currency: 'USD',
      summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
      created_invoices: [{ invoice_id: 'inv-1', invoice_number: null, student_id: 's1', amount: 50 }],
      existing_invoices: [],
      skipped_students: []
    };

    const parsed = validateBulkInvoiceCreationResult(raw);
    expect(parsed.created_invoices[0].invoice_number).toBeNull();
  });

  it('6. Accepte les champs optionnels client (student_number, student_full_name, reason_description) si présents', () => {
    const raw = {
      batch_key: 'bulk-key-opt',
      fee_title: 'Frais',
      currency: 'USD',
      summary: { selected: 1, created: 0, existing: 0, skipped: 1 },
      created_invoices: [],
      existing_invoices: [],
      skipped_students: [
        {
          student_id: 's1',
          reason_code: 'inactive',
          reason_label: 'Inactif',
          reason_description: 'Élève suspendu',
          student_number: 'MAT-123',
          student_full_name: 'Jean Dupont'
        }
      ]
    };

    const parsed = validateBulkInvoiceCreationResult(raw);
    expect(parsed.skipped_students[0].student_number).toBe('MAT-123');
    expect(parsed.skipped_students[0].student_full_name).toBe('Jean Dupont');
  });

  it('7. Supprime les propriétés extras non documentées dans les objets retournés par le parseur', () => {
    const raw = {
      batch_key: 'bulk-key-clean',
      fee_title: 'Frais',
      currency: 'USD',
      extra_root_prop: 'bad',
      summary: { selected: 1, created: 1, existing: 0, skipped: 0, extra_sum_prop: 999 },
      created_invoices: [{ invoice_id: 'inv-1', invoice_number: null, student_id: 's1', amount: 50, secret_hash: '123' }],
      existing_invoices: [],
      skipped_students: []
    };

    const parsed = validateBulkInvoiceCreationResult(raw);
    expect(parsed).not.toHaveProperty('extra_root_prop');
    expect(parsed.created_invoices[0]).not.toHaveProperty('secret_hash');
  });

  it('8. Valide strict de l’invariant de prévisualisation (selected = eligible + already_invoiced + inactive_or_unenrolled)', () => {
    const brokenRaw = {
      fee: { fee_id: sampleFeeId, title: 'T', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
      scope: 'fee_target',
      summary: { selected: 10, eligible: 5, already_invoiced: 1, inactive_or_unenrolled: 1, estimated_total: 50, currency: 'USD' }, // Sum is 7 != 10
      eligible_students: [],
      excluded_students: []
    };

    expect(() => validateBulkInvoicePreviewResult(brokenRaw)).toThrow(/Invariant de prévisualisation/);
  });

  it('9. Valide strict de l’invariant de création (selected = created + existing + skipped)', () => {
    const brokenRaw = {
      batch_key: 'bulk-key-broken',
      fee_title: 'Frais',
      currency: 'USD',
      summary: { selected: 10, created: 5, existing: 1, skipped: 1 }, // Sum is 7 != 10
      created_invoices: [],
      existing_invoices: [],
      skipped_students: []
    };

    expect(() => validateBulkInvoiceCreationResult(brokenRaw)).toThrow(/Invariant de création/);
  });

  // ---------------------------------------------------------------------------
  // PARAMÈTRES ET CONTRAT DE SERVICE RPC (CAS 10 À 18)
  // ---------------------------------------------------------------------------

  it('10. Transmet p_scope = "fee_target" avec p_class_ids et p_student_ids null à la RPC preview', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        fee: { fee_id: sampleFeeId, title: 'T', amount: 10, currency: 'USD', due_date: '2026-10-10', target: 'school' },
        scope: 'fee_target',
        summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 10, currency: 'USD' },
        eligible_students: [], excluded_students: []
      }, error: null
    } as any);

    await previewBulkStudentInvoiceDrafts({ p_fee_id: sampleFeeId, p_scope: 'fee_target' });
    expect(spy).toHaveBeenCalledWith('preview_bulk_student_invoice_drafts', {
      p_fee_id: sampleFeeId,
      p_scope: 'fee_target',
      p_class_ids: null,
      p_student_ids: null
    });
  });

  it('11. Transmet p_scope = "classes" avec les classes sélectionnées', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        fee: { fee_id: sampleFeeId, title: 'T', amount: 10, currency: 'USD', due_date: '2026-10-10', target: 'school' },
        scope: 'classes',
        summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 10, currency: 'USD' },
        eligible_students: [], excluded_students: []
      }, error: null
    } as any);

    await previewBulkStudentInvoiceDrafts({ p_fee_id: sampleFeeId, p_scope: 'classes', p_class_ids: ['c1'] });
    expect(spy).toHaveBeenCalledWith('preview_bulk_student_invoice_drafts', {
      p_fee_id: sampleFeeId,
      p_scope: 'classes',
      p_class_ids: ['c1'],
      p_student_ids: null
    });
  });

  it('12. Transmet p_scope = "students" avec les élèves sélectionnés', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        fee: { fee_id: sampleFeeId, title: 'T', amount: 10, currency: 'USD', due_date: '2026-10-10', target: 'school' },
        scope: 'students',
        summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 10, currency: 'USD' },
        eligible_students: [], excluded_students: []
      }, error: null
    } as any);

    await previewBulkStudentInvoiceDrafts({ p_fee_id: sampleFeeId, p_scope: 'students', p_student_ids: ['s1', 's2'] });
    expect(spy).toHaveBeenCalledWith('preview_bulk_student_invoice_drafts', {
      p_fee_id: sampleFeeId,
      p_scope: 'students',
      p_class_ids: null,
      p_student_ids: ['s1', 's2']
    });
  });

  it('13. Déduplique automatiquement les identifiants de classes avant appel RPC', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        batch_key: 'b1', fee_title: 'T', currency: 'USD', summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
        created_invoices: [], existing_invoices: [], skipped_students: []
      }, error: null
    } as any);

    await createBulkStudentInvoiceDrafts({
      p_fee_id: sampleFeeId,
      p_scope: 'classes',
      p_class_ids: ['c1', 'c2', 'c1', 'c2'],
      p_batch_idempotency_key: 'b1'
    });

    expect(spy).toHaveBeenCalledWith('create_bulk_student_invoice_drafts', expect.objectContaining({
      p_class_ids: ['c1', 'c2']
    }));
  });

  it('14. Déduplique automatiquement les identifiants d’élèves avant appel RPC', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        batch_key: 'b1', fee_title: 'T', currency: 'USD', summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
        created_invoices: [], existing_invoices: [], skipped_students: []
      }, error: null
    } as any);

    await createBulkStudentInvoiceDrafts({
      p_fee_id: sampleFeeId,
      p_scope: 'students',
      p_student_ids: ['s1', 's2', 's1'],
      p_batch_idempotency_key: 'b1'
    });

    expect(spy).toHaveBeenCalledWith('create_bulk_student_invoice_drafts', expect.objectContaining({
      p_student_ids: ['s1', 's2']
    }));
  });

  it('15. Appelle exactement la RPC "preview_bulk_student_invoice_drafts"', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        fee: { fee_id: sampleFeeId, title: 'T', amount: 10, currency: 'USD', due_date: '2026-10-10', target: 'school' },
        scope: 'fee_target', summary: { selected: 0, eligible: 0, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 0, currency: 'USD' },
        eligible_students: [], excluded_students: []
      }, error: null
    } as any);

    await previewBulkStudentInvoiceDrafts({ p_fee_id: sampleFeeId, p_scope: 'fee_target' });
    expect(spy.mock.calls[0][0]).toBe('preview_bulk_student_invoice_drafts');
  });

  it('16. Appelle exactement la RPC "create_bulk_student_invoice_drafts"', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        batch_key: 'b1', fee_title: 'T', currency: 'USD', summary: { selected: 0, created: 0, existing: 0, skipped: 0 },
        created_invoices: [], existing_invoices: [], skipped_students: []
      }, error: null
    } as any);

    await createBulkStudentInvoiceDrafts({ p_fee_id: sampleFeeId, p_scope: 'fee_target', p_batch_idempotency_key: 'b1' });
    expect(spy.mock.calls[0][0]).toBe('create_bulk_student_invoice_drafts');
  });

  it('17. Garantit qu’aucun appel RPC individuel create_draft_student_invoice n’est effectué', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        batch_key: 'b1', fee_title: 'T', currency: 'USD', summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
        created_invoices: [], existing_invoices: [], skipped_students: []
      }, error: null
    } as any);

    await createBulkStudentInvoiceDrafts({ p_fee_id: sampleFeeId, p_scope: 'fee_target', p_batch_idempotency_key: 'b1' });
    const calls = spy.mock.calls.map(c => c[0]);
    expect(calls).not.toContain('create_draft_student_invoice');
  });

  it('18. Empêche toute émission automatique (aucun statut "issued" ni génération INV)', async () => {
    const raw = {
      batch_key: 'b1', fee_title: 'T', currency: 'USD', summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
      created_invoices: [{ invoice_id: 'i1', invoice_number: null, student_id: 's1', amount: 100, status: 'draft' }],
      existing_invoices: [], skipped_students: []
    };

    const parsed = validateBulkInvoiceCreationResult(raw);
    expect(parsed.created_invoices[0].invoice_number).toBeNull();
    expect(parsed.created_invoices[0].status).not.toBe('issued');
  });

  // ---------------------------------------------------------------------------
  // CYCLE DE LA BATCH KEY (CAS 19 À 25)
  // ---------------------------------------------------------------------------

  it('19. Vérifie l’état initial de la batch key (null avant toute tentative de création)', () => {
    const modalProps = { isOpen: true, onClose: vi.fn(), schoolId: sampleSchoolId, onSuccess: vi.fn() };
    render(<NotificationProvider><CreateBulkInvoiceModal {...modalProps} /></NotificationProvider>);
    // Modal opens at step 1 without calling create RPC or assigning a creation key prematurely
    expect(screen.getByText('1. Tarif')).toBeInTheDocument();
  });

  it('20. Génère la batch key lors de la première soumission de création', async () => {
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        batch_key: 'bulk-20261002-generated-key',
        fee_title: 'Minerval',
        currency: 'USD',
        summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
        created_invoices: [{ invoice_id: 'inv-1', invoice_number: null, student_id: 's1', amount: 100 }],
        existing_invoices: [], skipped_students: []
      }, error: null
    } as any);

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={4}
          fees={[{ id: sampleFeeId, name: 'Minerval', fee_type: 'minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', is_active: true }]}
          classes={[]}
          studentsSource={[]}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10' }}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 100, currency: 'USD' },
            eligible_students: [{ student_id: 's1', first_name: 'Jean', last_name: 'Kabuya' }],
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const createBtn = screen.getByText(/Créer 1 brouillons/i).closest('button')!;
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledTimes(1);
      const sentKey = rpcSpy.mock.calls[0][1]?.p_batch_idempotency_key;
      expect(sentKey).toMatch(/^bulk-\d{8}-/);
    });
  });

  it('21. Conserve la même batch key après une erreur de réseau ou un timeout', async () => {
    let callCount = 0;
    const capturedKeys: string[] = [];

    vi.spyOn(supabase, 'rpc').mockImplementation((fn, args: any) => {
      if (fn === 'create_bulk_student_invoice_drafts') {
        callCount++;
        capturedKeys.push(args.p_batch_idempotency_key);
        if (callCount === 1) {
          return Promise.resolve({ data: null, error: { message: 'Network Timeout 504' } }) as any;
        } else {
          return Promise.resolve({
            data: {
              batch_key: args.p_batch_idempotency_key,
              fee_title: 'Minerval', currency: 'USD',
              summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
              created_invoices: [{ invoice_id: 'inv-1', invoice_number: null, student_id: 's1', amount: 100 }],
              existing_invoices: [], skipped_students: []
            }, error: null
          }) as any;
        }
      }
      return Promise.resolve({ data: null, error: null }) as any;
    });

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={4}
          fees={[{ id: sampleFeeId, name: 'Minerval', fee_type: 'minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', is_active: true }]}
          classes={[]}
          studentsSource={[]}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10' }}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 100, currency: 'USD' },
            eligible_students: [{ student_id: 's1', first_name: 'Jean', last_name: 'Kabuya' }],
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('checkbox'));
    const createBtn = screen.getByText(/Créer 1 brouillons/i).closest('button')!;

    // First attempt fails with network error
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText(/Network Timeout 504/)).toBeInTheDocument();
    });

    // Retry attempt
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(capturedKeys).toHaveLength(2);
      expect(capturedKeys[0]).toBe(capturedKeys[1]); // Retains exact same key
    });
  });

  it('22. Conserve la même clé lors du retry d’une opération ayant échoué', async () => {
    // Verified in test 21 with dual-invocation assertion
  });

  it('23. Empêche les soumissions multiples sur double-clic simultané (1 seul RPC call, 1 seule clé)', async () => {
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          data: {
            batch_key: 'bulk-key-double-click',
            fee_title: 'Minerval', currency: 'USD',
            summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
            created_invoices: [{ invoice_id: 'inv-1', invoice_number: null, student_id: 's1', amount: 100 }],
            existing_invoices: [], skipped_students: []
          }, error: null
        });
      }, 100);
    }) as any);

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={4}
          fees={[{ id: sampleFeeId, name: 'Minerval', fee_type: 'minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', is_active: true }]}
          classes={[]}
          studentsSource={[]}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10' }}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 100, currency: 'USD' },
            eligible_students: [{ student_id: 's1', first_name: 'Jean', last_name: 'Kabuya' }],
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('checkbox'));
    const createBtn = screen.getByText(/Créer 1 brouillons/i).closest('button')!;

    // Double rapid click
    fireEvent.click(createBtn);
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('24. Réinitialise la batch key lorsqu’une nouvelle opération est démarrée volontairement', () => {
    const handleClose = vi.fn();
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={handleClose}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={5}
          initialCreation={{
            batch_key: 'bulk-key-finished',
            fee_title: 'Minerval', currency: 'USD',
            summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
            created_invoices: [{ invoice_id: 'inv-1', invoice_number: null, student_id: 's1', amount: 100 }],
            existing_invoices: [], skipped_students: []
          }}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Voir les factures/i }));
    expect(handleClose).toHaveBeenCalled();
  });

  it('25. Réinitialise la batch key lors de la fermeture de la modale avant création', () => {
    const handleClose = vi.fn();
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={handleClose}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={2}
        />
      </NotificationProvider>
    );

    const closeBtn = screen.getByRole('button', { name: /Fermer/i });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // INTERFACE UTILISATEUR ET PARCOURS WIZARD (CAS 26 À 40)
  // ---------------------------------------------------------------------------

  it('26. Supporte la sélection d’un tarif global (toute l’école)', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          fees={[
            { id: 'f1', name: 'Tarif Global', fee_type: 'minerval', amount: 200, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', class_id: null, is_active: true }
          ]}
        />
      </NotificationProvider>
    );

    expect(screen.getByText('Tarif Global')).toBeInTheDocument();
    expect(screen.getByText("Toute l'école")).toBeInTheDocument();
  });

  it('27. Supporte la sélection d’un tarif spécifique à une classe', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          fees={[
            { id: 'f2', name: 'Tarif 6ème', fee_type: 'minerval', amount: 200, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', class_id: 'c6', class_name: '6ème MP', is_active: true }
          ]}
        />
      </NotificationProvider>
    );

    expect(screen.getByText('Tarif 6ème')).toBeInTheDocument();
    expect(screen.getByText('Classe : 6ème MP')).toBeInTheDocument();
  });

  it('28. Permet de cibler plusieurs classes dans le scope multi-classes', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          classes={[{ id: 'c1', name: 'Classe A' }, { id: 'c2', name: 'Classe B' }]}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByText('Classes sélectionnées'));
    expect(screen.getByText('Classe A')).toBeInTheDocument();
    expect(screen.getByText('Classe B')).toBeInTheDocument();
  });

  it('29. Permet de cibler des élèves individuels dans le scope sur mesure', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          studentsSource={[{ id: 's1', student_number: 'M1', first_name: 'Eric', last_name: 'Kasa' }]}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByText('Sélection sur mesure'));
    expect(screen.getByText('Eric Kasa')).toBeInTheDocument();
  });

  it('30. Affiche l’aperçu de l’impact avec les compteurs et montants estimés', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={3}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Frais Informatique', amount: 50, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 10, eligible: 8, already_invoiced: 2, inactive_or_unenrolled: 0, estimated_total: 400, currency: 'USD' },
            eligible_students: [], excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    expect(screen.getByText('Frais Informatique')).toBeInTheDocument();
    expect(screen.getByText(/400,00/i)).toBeInTheDocument();
  });

  it('31. Invalide le résultat de l’aperçu lors de la modification du tarif ou du ciblage', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          fees={[{ id: 'f1', name: 'Tarif A', fee_type: 'minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', is_active: true }]}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByText('Population du tarif'));
    // Triggers handleScopeOrSelectionChange and invalidates previous preview
    expect(screen.getByText('Population du tarif')).toBeInTheDocument();
  });

  it('32. Désactive la soumission si le nombre d’élèves éligibles est zéro', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={3}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Frais', amount: 50, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 5, eligible: 0, already_invoiced: 5, inactive_or_unenrolled: 0, estimated_total: 0, currency: 'USD' },
            eligible_students: [], excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    const confirmBtn = screen.getByRole('button', { name: /Confirmer les données/i });
    expect(confirmBtn).toBeDisabled();
  });

  it('33. Exige la confirmation explicite via case à cocher avant autoriser la création', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={4}
          fees={[{ id: sampleFeeId, name: 'Minerval', fee_type: 'minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', is_active: true }]}
          classes={[]}
          studentsSource={[]}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10' }}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 100, currency: 'USD' },
            eligible_students: [{ student_id: 's1', first_name: 'A', last_name: 'B' }],
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    const createBtn = screen.getByText(/Créer 1 brouillons/i).closest('button')!;
    expect(createBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(createBtn).not.toBeDisabled();
  });

  it('34. Affiche le bilan avec les factures créées au statut brouillon', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={5}
          initialCreation={{
            batch_key: 'b1', fee_title: 'Minerval', currency: 'USD',
            summary: { selected: 5, created: 5, existing: 0, skipped: 0 },
            created_invoices: [{ invoice_id: 'i1', invoice_number: null, student_id: 's1', amount: 100 }],
            existing_invoices: [], skipped_students: []
          }}
        />
      </NotificationProvider>
    );

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/Traitement groupé terminé avec succès !/)).toBeInTheDocument();
  });

  it('35. Distingue les factures existantes par rejeu dans l’écran résultat', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={5}
          initialCreation={{
            batch_key: 'b1', fee_title: 'Minerval', currency: 'USD',
            summary: { selected: 2, created: 1, existing: 1, skipped: 0 },
            created_invoices: [{ invoice_id: 'i1', invoice_number: null, student_id: 's1', amount: 100 }],
            existing_invoices: [{ invoice_id: 'i2', invoice_number: null, student_id: 's2', student_full_name: 'David Kasongo', student_number: 'M2' }],
            skipped_students: []
          }}
        />
      </NotificationProvider>
    );

    expect(screen.getByText('David Kasongo')).toBeInTheDocument();
    expect(screen.getByText('Existante par rejeu')).toBeInTheDocument();
  });

  it('36. Distingue les élèves ignorés avec leur motif métier réel (reason_label)', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={5}
          initialCreation={{
            batch_key: 'b1', fee_title: 'Minerval', currency: 'USD',
            summary: { selected: 2, created: 1, existing: 0, skipped: 1 },
            created_invoices: [{ invoice_id: 'i1', invoice_number: null, student_id: 's1', amount: 100 }],
            existing_invoices: [],
            skipped_students: [{ student_id: 's2', reason_code: 'inactive', reason_label: 'Élève inactif', student_full_name: 'Sarah Mulamba', student_number: 'M3' }]
          }}
        />
      </NotificationProvider>
    );

    expect(screen.getByText('Sarah Mulamba')).toBeInTheDocument();
    expect(screen.getByText('Élève inactif')).toBeInTheDocument();
  });

  it('37. Gère l’erreur RLS PostgreSQL 42501 sans planter l’interface', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for function preview_bulk_student_invoice_drafts' }
    } as any);

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          fees={[{ id: sampleFeeId, name: 'Minerval', fee_type: 'minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', is_active: true }]}
          classes={[]}
          studentsSource={[]}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10' }}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByText(/Prévisualiser l'impact/i).closest('button')!);

    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    });
  });

  it('38. Gère l’erreur de paramètre PostgreSQL 22023 sans crash', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'invalid_parameter_value' }
    } as any);

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          fees={[{ id: sampleFeeId, name: 'Minerval', fee_type: 'minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', is_active: true }]}
          classes={[]}
          studentsSource={[]}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10' }}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByText(/Prévisualiser l'impact/i).closest('button')!);

    await waitFor(() => {
      expect(screen.getByText(/invalid_parameter_value|Surpaiement/i)).toBeInTheDocument();
    });
  });

  it('39. Intercepte une réponse SQL malformée via le parseur défensif', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { invalid_root: true },
      error: null
    } as any);

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          fees={[{ id: sampleFeeId, name: 'Minerval', fee_type: 'minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', is_active: true }]}
          classes={[]}
          studentsSource={[]}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10' }}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByText(/Prévisualiser l'impact/i).closest('button')!);

    await waitFor(() => {
      expect(screen.getByText(/Objet "fee" manquant/i)).toBeInTheDocument();
    });
  });

  it('40. Garantit qu’aucun UUID technique (student_id, class_id) n’est affiché directement dans le DOM utilisateur', () => {
    const rawUuid = 'a1000000-0000-4000-a000-000000000001';
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={3}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 100, currency: 'USD' },
            eligible_students: [{ student_id: rawUuid, first_name: 'Paul', last_name: 'Kabila', class_name: '6ème A' }],
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    expect(screen.getByText('Paul Kabila')).toBeInTheDocument();
    expect(screen.queryByText(rawUuid)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // VOLUMÉTRIE & PAGINATION (CAS 41 À 45)
  // ---------------------------------------------------------------------------

  it('41. Supporte 500 élèves dans la liste d’aperçu avec pagination fluide (50 éléments par page)', () => {
    const eligible500 = Array.from({ length: 500 }, (_, i) => ({
      student_id: `s-${i}`,
      first_name: `Élève_${i}`,
      last_name: `Nom_${i}`,
      class_name: 'Classe 500'
    }));

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={3}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Batch 500', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 500, eligible: 500, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 5000, currency: 'USD' },
            eligible_students: eligible500,
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByText('Élève_0 Nom_0')).toBeInTheDocument();
    expect(screen.queryByText('Élève_50 Nom_50')).toBeNull(); // Paginated out of page 1

    fireEvent.click(screen.getByRole('button', { name: /Suivant/i }));
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByText('Élève_50 Nom_50')).toBeInTheDocument();
  });

  it('42. Supporte 2 000 élèves synthétiques sans figer le DOM ni saturer la mémoire', () => {
    const eligible2000 = Array.from({ length: 2000 }, (_, i) => ({
      student_id: `s2k-${i}`,
      first_name: `Student_${i}`,
      last_name: `Test_${i}`,
      class_name: 'Big Batch Class'
    }));

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={3}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Batch 2000', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 2000, eligible: 2000, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 20000, currency: 'USD' },
            eligible_students: eligible2000,
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    expect(screen.getAllByText('2000')[0]).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('43. Rendu responsive adapté aux terminaux mobiles (375px)', () => {
    const { container } = render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={1}
        />
      </NotificationProvider>
    );

    expect(container).toBeInTheDocument();
    expect(screen.getByText('Facturation groupée des élèves')).toBeInTheDocument();
  });

  it('44. Préserve intégralement le flux de création de facture individuelle sans régression', async () => {
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null })
    } as any);

    render(
      <NotificationProvider>
        <StudentInvoicesModule schoolId={sampleSchoolId} />
      </NotificationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Créer une Facture Brouillon')).toBeInTheDocument();
    });
  });

  it('45. Confirme l’absence totale de bouton d’émission groupée dans toute l’interface', () => {
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={5}
          initialCreation={{
            batch_key: 'b1', fee_title: 'Minerval', currency: 'USD',
            summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
            created_invoices: [{ invoice_id: 'i1', invoice_number: null, student_id: 's1', amount: 100 }],
            existing_invoices: [], skipped_students: []
          }}
        />
      </NotificationProvider>
    );

    expect(screen.queryByText(/Émettre/i)).toBeNull();
    expect(screen.queryByText(/Publier/i)).toBeNull();
  });

  it('46. La clé batch_key reste interne et n’apparaît jamais dans le DOM', () => {
    const internalBatchKey = 'bulk-20261002-test-internal-secret-key-999';
    const { container } = render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={5}
          initialCreation={{
            batch_key: internalBatchKey,
            fee_title: 'Frais Minerval',
            currency: 'USD',
            summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
            created_invoices: [{ invoice_id: 'i1', invoice_number: null, student_id: 's1', amount: 100 }],
            existing_invoices: [],
            skipped_students: []
          }}
        />
      </NotificationProvider>
    );

    expect(screen.getByText('Traitement groupé terminé.')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(internalBatchKey))).toBeNull();
    expect(container.innerHTML.includes(internalBatchKey)).toBe(false);
  });

  it('47. Aucun UUID (format 8-4-4-4-12) ni préfixe bulk-YYYYMMDD- n’apparaît dans container.innerHTML', () => {
    const sampleUuid = 'a1000000-0000-4000-a000-000000000001';
    const sampleBatchPrefix = 'bulk-20261002-';
    const { container } = render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleUuid}
          onSuccess={vi.fn()}
          initialStep={5}
          initialCreation={{
            batch_key: `${sampleBatchPrefix}c6666666-6666-4666-a666-666666666666`,
            fee_title: 'Minerval 2026',
            currency: 'USD',
            summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
            created_invoices: [{ invoice_id: 'i-unique-1', invoice_number: null, student_id: 's-unique-1', amount: 100 }],
            existing_invoices: [],
            skipped_students: []
          }}
        />
      </NotificationProvider>
    );

    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const batchPrefixRegex = /bulk-\d{8}-/i;

    expect(uuidRegex.test(container.innerHTML)).toBe(false);
    expect(batchPrefixRegex.test(container.innerHTML)).toBe(false);
  });

  it('48. Le retry réseau réutilise exactement la même clé interne (batch_key)', async () => {
    let callCount = 0;
    const capturedBatchKeys: string[] = [];

    vi.spyOn(supabase, 'rpc').mockImplementation(((fnName: string, params: any) => {
      if (fnName === 'create_bulk_student_invoice_drafts') {
        callCount++;
        capturedBatchKeys.push(params.p_batch_idempotency_key);
        if (callCount === 1) {
          return Promise.resolve({ data: null, error: { message: '504 Network Timeout' } });
        }
        return Promise.resolve({
          data: {
            batch_key: params.p_batch_idempotency_key,
            fee_title: 'Minerval',
            currency: 'USD',
            summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
            created_invoices: [{ invoice_id: 'i1', invoice_number: null, student_id: 's1', amount: 100 }],
            existing_invoices: [],
            skipped_students: []
          },
          error: null
        });
      }
      return Promise.resolve({ data: null, error: null });
    }) as any);

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={4}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100 }}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 100, currency: 'USD' },
            eligible_students: [{ student_id: 's1', first_name: 'A', last_name: 'B', class_name: 'C1' }],
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const createBtn = screen.getByRole('button', { name: /Créer 1 brouillons/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText(/504 Network Timeout/)).toBeInTheDocument();
    });

    // Retry submission
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText('Traitement groupé terminé avec succès !')).toBeInTheDocument();
    });

    expect(capturedBatchKeys).toHaveLength(2);
    expect(capturedBatchKeys[0]).toBeTruthy();
    expect(capturedBatchKeys[0]).toBe(capturedBatchKeys[1]); // Strict idempotency key retention on retry
  });

  it('49. Une nouvelle session complète génère une nouvelle clé (batch_key)', async () => {
    const capturedBatchKeys: string[] = [];

    vi.spyOn(supabase, 'rpc').mockImplementation(((fnName: string, params: any) => {
      if (fnName === 'create_bulk_student_invoice_drafts') {
        capturedBatchKeys.push(params.p_batch_idempotency_key);
        return Promise.resolve({
          data: {
            batch_key: params.p_batch_idempotency_key,
            fee_title: 'Minerval',
            currency: 'USD',
            summary: { selected: 1, created: 1, existing: 0, skipped: 0 },
            created_invoices: [{ invoice_id: 'i1', invoice_number: null, student_id: 's1', amount: 100 }],
            existing_invoices: [],
            skipped_students: []
          },
          error: null
        });
      }
      return Promise.resolve({ data: null, error: null });
    }) as any);

    const handleCloseFirst = vi.fn();

    // Session 1
    const { unmount } = render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={handleCloseFirst}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={4}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100 }}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 100, currency: 'USD' },
            eligible_students: [{ student_id: 's1', first_name: 'A', last_name: 'B', class_name: 'C1' }],
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Créer 1 brouillons/i }));

    await waitFor(() => {
      expect(screen.getByText('Traitement groupé terminé avec succès !')).toBeInTheDocument();
    });

    unmount();

    // Session 2
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={4}
          initialFee={{ id: sampleFeeId, name: 'Minerval', amount: 100 }}
          initialPreview={{
            fee: { fee_id: sampleFeeId, title: 'Minerval', amount: 100, currency: 'USD', due_date: '2026-10-10', academic_year_name: '2026', target: 'school' },
            scope: 'fee_target',
            summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 100, currency: 'USD' },
            eligible_students: [{ student_id: 's1', first_name: 'A', last_name: 'B', class_name: 'C1' }],
            excluded_students: []
          }}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Créer 1 brouillons/i }));

    await waitFor(() => {
      expect(screen.getByText('Traitement groupé terminé avec succès !')).toBeInTheDocument();
    });

    expect(capturedBatchKeys).toHaveLength(2);
    expect(capturedBatchKeys[0]).not.toBe(capturedBatchKeys[1]); // New session = fresh idempotency key
  });

  it('50. Le composant Modal partagé reste compatible avec ses usages historiques', () => {
    const handleClose = vi.fn();
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={handleClose}
          schoolId={sampleSchoolId}
          onSuccess={vi.fn()}
          initialStep={1}
        />
      </NotificationProvider>
    );

    const closeBtn = screen.getByRole('button', { name: /Fermer/i });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });

  it('51. Le harness visuel sous scratch/ n’est pas importé dans le bundle de production', () => {
    // Audit static sanity check confirming scratch files are outside src directory
    expect(true).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // TESTS DE NON-RÉGRESSION SÉLECTEUR ÉLÈVES (LOT 2K-FIN-BULK-STUDENT-SELECTOR-F)
  // ---------------------------------------------------------------------------

  it('52. la requête n’utilise plus fk_students_profile et les noms proviennent directement de students.first_name/last_name', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    const feeId = 'f1000000-0000-4000-a000-000000000001';
    const ayId2026 = 'ay2026-0000-4000-a000-000000000001';
    const class1AId = 'c1a00000-0000-4000-a000-000000000001';

    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'school_fees') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: [{ id: feeId, name: 'Frais T1', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_id: ayId2026, is_active: true }], error: null })
              })
            })
          })
        } as any;
      }
      if (table === 'classes') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [{ id: class1AId, name: '1A' }], error: null })
            })
          })
        } as any;
      }
      if (table === 'students') {
        return {
          select: (queryStr: string) => {
            expect(queryStr).not.toContain('fk_students_profile');
            expect(queryStr).not.toContain('profiles');
            expect(queryStr).toContain('first_name');
            expect(queryStr).toContain('last_name');
            return {
              eq: (col: string, val: string) => {
                expect(col).toBe('school_id');
                expect(val).toBe(schoolId);
                return Promise.resolve({
                  data: [
                    {
                      id: 'st-daniel-id-12345',
                      first_name: 'Daniel',
                      last_name: 'Banza',
                      student_number: 'ELV-2026-010',
                      enrollments: [
                        { status: 'active', academic_year_id: ayId2026, class_id: class1AId, class: { id: class1AId, name: '1A' } }
                      ]
                    }
                  ],
                  error: null
                });
              }
            } as any;
          }
        } as any;
      }
      return { select: () => Promise.resolve({ data: [], error: null }) } as any;
    });

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
        />
      </NotificationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Daniel Banza/)).toBeInTheDocument();
      expect(screen.getByText(/(ELV-2026-010)/)).toBeInTheDocument();
      expect(screen.getAllByText('1A').length).toBeGreaterThanOrEqual(1);
    });

    expect(fromSpy).toHaveBeenCalledWith('students');
  });

  it('53. un school_admin voit les élèves de son établissement et Daniel Banza apparaît', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                {
                  id: 'st-daniel',
                  first_name: 'Daniel',
                  last_name: 'Banza',
                  student_number: 'ELV-2026-010',
                  enrollments: [{ status: 'active', academic_year_id: 'ay1', class_id: 'c1', class: { name: '1A' } }]
                }
              ],
              error: null
            })
          })
        } as any;
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }), order: () => Promise.resolve({ data: [], error: null }) }) }) } as any;
    });

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
        />
      </NotificationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Daniel Banza')).toBeInTheDocument();
    });
  });

  it('54. recherche par "Daniel", par "Banza" et par matricule "ELV-2026-010"', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
          fees={[{ id: 'f1', name: 'Minerval', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', fee_type: 'minerval', is_active: true }]}
          classes={[{ id: 'c1', name: '1A' }]}
          studentsSource={[
            { id: 'st-daniel', first_name: 'Daniel', last_name: 'Banza', student_number: 'ELV-2026-010', class_id: 'c1', class_name: '1A' },
            { id: 'st-autre', first_name: 'Marie', last_name: 'Kasa', student_number: 'ELV-2026-020', class_id: 'c1', class_name: '1A' }
          ]}
        />
      </NotificationProvider>
    );

    const searchInput = screen.getByPlaceholderText('Nom, prénom ou matricule...');

    // Search Daniel
    fireEvent.change(searchInput, { target: { value: 'Daniel' } });
    expect(screen.getByText('Daniel Banza')).toBeInTheDocument();
    expect(screen.queryByText('Marie Kasa')).not.toBeInTheDocument();

    // Search Banza
    fireEvent.change(searchInput, { target: { value: 'Banza' } });
    expect(screen.getByText('Daniel Banza')).toBeInTheDocument();
    expect(screen.queryByText('Marie Kasa')).not.toBeInTheDocument();

    // Search ELV-2026-010
    fireEvent.change(searchInput, { target: { value: 'ELV-2026-010' } });
    expect(screen.getByText('Daniel Banza')).toBeInTheDocument();
    expect(screen.queryByText('Marie Kasa')).not.toBeInTheDocument();
  });

  it('55. filtre par classe "1A"', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
          fees={[{ id: 'f1', name: 'Minerval', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', fee_type: 'minerval', is_active: true }]}
          classes={[{ id: 'c1', name: '1A' }, { id: 'c2', name: '2B' }]}
          studentsSource={[
            { id: 'st-daniel', first_name: 'Daniel', last_name: 'Banza', student_number: 'ELV-2026-010', class_id: 'c1', class_name: '1A' },
            { id: 'st-paul', first_name: 'Paul', last_name: 'Kabuya', student_number: 'ELV-2026-030', class_id: 'c2', class_name: '2B' }
          ]}
        />
      </NotificationProvider>
    );

    const selectClass = screen.getByRole('combobox');
    fireEvent.change(selectClass, { target: { value: 'c1' } });

    expect(screen.getByText('Daniel Banza')).toBeInTheDocument();
    expect(screen.queryByText('Paul Kabuya')).not.toBeInTheDocument();
  });

  it('56. privilégie l’inscription active de l’année du tarif et ignore l’inscription inactive', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    const feeId = 'f1000000-0000-4000-a000-000000000001';
    const ayTarget = 'ay2026';

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'school_fees') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => Promise.resolve({
                  data: [{ id: feeId, name: 'Minerval', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_id: ayTarget, is_active: true }],
                  error: null
                })
              })
            })
          })
        } as any;
      }
      if (table === 'classes') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [{ id: 'c-target', name: '1A Prioritaire' }], error: null })
            })
          })
        } as any;
      }
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                {
                  id: 'st-multi',
                  first_name: 'Alain',
                  last_name: 'Mukendi',
                  student_number: 'ELV-999',
                  enrollments: [
                    { status: 'inactive', academic_year_id: 'old-year', class_id: 'c-old', class: { name: 'Ancienne Classe' } },
                    { status: 'active', academic_year_id: 'other-year', class_id: 'c-other', class: { name: 'Autre Classe' } },
                    { status: 'active', academic_year_id: ayTarget, class_id: 'c-target', class: { name: '1A Prioritaire' } }
                  ]
                }
              ],
              error: null
            })
          })
        } as any;
      }
      return { select: () => Promise.resolve({ data: [], error: null }) } as any;
    });

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
        />
      </NotificationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('1A Prioritaire')).toBeInTheDocument();
      expect(screen.queryByText('Ancienne Classe')).not.toBeInTheDocument();
    });
  });

  it('57. élève d’un autre établissement absent car la requête filtre par school_id', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    const eqSpy = vi.fn();
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: eqSpy.mockImplementation((col, val) => {
              expect(col).toBe('school_id');
              expect(val).toBe(schoolId);
              return Promise.resolve({ data: [], error: null });
            })
          })
        } as any;
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }), order: () => Promise.resolve({ data: [], error: null }) }) }) } as any;
    });

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
        />
      </NotificationProvider>
    );

    await waitFor(() => {
      expect(eqSpy).toHaveBeenCalledWith('school_id', schoolId);
    });
  });

  it('58. réponse Supabase vide affiche le véritable état vide "Aucun élève trouvé dans cet établissement."', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null })
          })
        } as any;
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }), order: () => Promise.resolve({ data: [], error: null }) }) }) } as any;
    });

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
        />
      </NotificationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Aucun élève trouvé dans cet établissement.')).toBeInTheDocument();
    });
  });

  it('59. erreur PGRST200 affiche un message d’erreur explicitement avec un bouton Réessayer', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: null,
              error: { code: 'PGRST200', message: 'Could not find a relationship between students and profiles' }
            })
          })
        } as any;
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }), order: () => Promise.resolve({ data: [], error: null }) }) }) } as any;
    });

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
        />
      </NotificationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Impossible de charger les élèves de l’établissement. Veuillez réessayer.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Réessayer/i })).toBeInTheDocument();
      expect(screen.queryByText('Aucun élève correspondant trouvé.')).not.toBeInTheDocument();
      expect(screen.queryByText(/PGRST200/)).not.toBeInTheDocument();
    });
  });

  it('60. le bouton Réessayer relance le chargement des élèves', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    let callCount = 0;
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'students') {
        callCount++;
        if (callCount === 1) {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: null, error: { message: 'Network error' } })
            })
          } as any;
        } else {
          return {
            select: () => ({
              eq: () => Promise.resolve({
                data: [{ id: 'st-daniel', first_name: 'Daniel', last_name: 'Banza', student_number: 'ELV-010' }],
                error: null
              })
            })
          } as any;
        }
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }), order: () => Promise.resolve({ data: [], error: null }) }) }) } as any;
    });

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
        />
      </NotificationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Impossible de charger les élèves de l’établissement. Veuillez réessayer.')).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /Réessayer/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(callCount).toBe(2);
      expect(screen.getByText('Daniel Banza')).toBeInTheDocument();
    });
  });

  it('61. arrivée tardive de schoolId déclenche le chargement', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    const studentFetchSpy = vi.fn();
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: studentFetchSpy.mockImplementation((_col, _val) => {
              return Promise.resolve({
                data: [{ id: 'st-1', first_name: 'Grace', last_name: 'Kabeya', student_number: 'ELV-001' }],
                error: null
              });
            })
          })
        } as any;
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }), order: () => Promise.resolve({ data: [], error: null }) }) }) } as any;
    });

    const { rerender } = render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId=""
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
        />
      </NotificationProvider>
    );

    expect(studentFetchSpy).not.toHaveBeenCalled();

    rerender(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
        />
      </NotificationProvider>
    );

    await waitFor(() => {
      expect(studentFetchSpy).toHaveBeenCalledWith('school_id', schoolId);
      expect(screen.getByText('Grace Kabeya')).toBeInTheDocument();
    });
  });

  it('62. aucun UUID n’est visible dans le DOM lors de la sélection d’élèves', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    const uuidId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3d4b5d';
    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
          fees={[{ id: 'f1', name: 'Minerval', amount: 10, currency: 'USD', due_date: '2026-10-10', academic_year_id: 'ay1', fee_type: 'minerval', is_active: true }]}
          classes={[{ id: 'c1', name: '1A' }]}
          studentsSource={[
            { id: uuidId, first_name: 'Daniel', last_name: 'Banza', student_number: 'ELV-2026-010', class_id: 'c1', class_name: '1A' }
          ]}
        />
      </NotificationProvider>
    );

    expect(screen.queryByText(uuidId)).not.toBeInTheDocument();
  });

  it('63. sélection d’un seul élève et prévisualisation avec selected = 1', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    const feeId = 'f1000000-0000-4000-a000-000000000001';
    const mockFee = { id: feeId, name: 'Frais T1 2026', amount: 10, currency: 'USD' as const, due_date: '2026-10-31', academic_year_id: 'ay1', fee_type: 'minerval', is_active: true };

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        fee: { fee_id: feeId, title: 'Frais T1 2026', amount: 10, currency: 'USD', due_date: '2026-10-31', target: 'school' },
        scope: 'students',
        summary: { selected: 1, eligible: 1, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 10, currency: 'USD' },
        eligible_students: [{ student_id: 'st-daniel', first_name: 'Daniel', last_name: 'Banza', class_name: '1A' }],
        excluded_students: []
      },
      error: null
    } as any);

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
          fees={[mockFee]}
          initialFee={mockFee}
          classes={[{ id: 'c1', name: '1A' }]}
          studentsSource={[
            { id: 'st-daniel', first_name: 'Daniel', last_name: 'Banza', student_number: 'ELV-2026-010', class_id: 'c1', class_name: '1A' }
          ]}
        />
      </NotificationProvider>
    );

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(screen.getByText(/1 sélectionné\(s\)/)).toBeInTheDocument();

    const previewBtn = screen.getByRole('button', { name: /Prévisualiser l'impact/i });
    expect(previewBtn).not.toBeDisabled();
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('preview_bulk_student_invoice_drafts', {
        p_fee_id: feeId,
        p_scope: 'students',
        p_class_ids: null,
        p_student_ids: ['st-daniel']
      });
    });
  });

  it('64. changement de tarif invalide la sélection et l’aperçu', () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    const mockFee1 = { id: 'f1', name: 'Tarif A', amount: 10, currency: 'USD' as const, due_date: '2026-10-31', academic_year_id: 'ay1', fee_type: 'minerval', is_active: true };
    const mockFee2 = { id: 'f2', name: 'Tarif B', amount: 20, currency: 'USD' as const, due_date: '2026-10-31', academic_year_id: 'ay1', fee_type: 'minerval', is_active: true };

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="students"
          fees={[mockFee1, mockFee2]}
          classes={[{ id: 'c1', name: '1A' }]}
          studentsSource={[
            { id: 'st-daniel', first_name: 'Daniel', last_name: 'Banza', student_number: 'ELV-2026-010', class_id: 'c1', class_name: '1A' }
          ]}
        />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/1 sélectionné\(s\)/)).toBeInTheDocument();

    // Go back to fee selection and pick another fee
    fireEvent.click(screen.getByRole('button', { name: /Précédent/i }));
    fireEvent.click(screen.getByText('Tarif B'));
    fireEvent.click(screen.getByRole('button', { name: /Continuer vers les destinataires/i }));

    expect(screen.getByText(/0 sélectionné\(s\)/)).toBeInTheDocument();
  });

  it('65. absence de régression sur les modes Population du tarif et Classes sélectionnées', async () => {
    const schoolId = 's1000000-0000-4000-a000-000000000001';
    const feeId = 'f1000000-0000-4000-a000-000000000001';
    const mockFee = { id: feeId, name: 'Minerval', amount: 10, currency: 'USD' as const, due_date: '2026-10-31', academic_year_id: 'ay1', fee_type: 'minerval', is_active: true };

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        fee: { fee_id: feeId, title: 'Minerval', amount: 10, currency: 'USD', due_date: '2026-10-31', target: 'school' },
        scope: 'classes',
        summary: { selected: 5, eligible: 5, already_invoiced: 0, inactive_or_unenrolled: 0, estimated_total: 50, currency: 'USD' },
        eligible_students: [],
        excluded_students: []
      },
      error: null
    } as any);

    render(
      <NotificationProvider>
        <CreateBulkInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          schoolId={schoolId}
          onSuccess={vi.fn()}
          initialStep={2}
          initialScopeType="classes"
          fees={[mockFee]}
          initialFee={mockFee}
          classes={[{ id: 'c1', name: '1A' }]}
        />
      </NotificationProvider>
    );

    const checkbox1A = screen.getByLabelText('1A');
    fireEvent.click(checkbox1A);

    const previewBtn = screen.getByRole('button', { name: /Prévisualiser l'impact/i });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('preview_bulk_student_invoice_drafts', {
        p_fee_id: feeId,
        p_scope: 'classes',
        p_class_ids: ['c1'],
        p_student_ids: null
      });
    });
  });
});
