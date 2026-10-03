// Fichier : src/tests/bulkStudentInvoiceIssuing.test.tsx
// Suite de 60+ tests réels pour l'émission groupée des factures (Lot 2K-FIN-BULK-ISSUE-F)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  validateBulkIssuePreviewResult,
  validateBulkIssueExecutionResult,
  previewBulkIssueStudentInvoices,
  issueBulkStudentInvoices,
  FinanceServiceError
} from '../services/financeService';
import { BulkIssueInvoiceModal } from '../components/admin/finance/BulkIssueInvoiceModal';
import { supabase } from '../lib/supabase';
import type {
  BulkIssuePreviewResult,
  BulkIssueExecutionResult,
  SegmentedBulkIssueState,
  Currency
} from '../types/finance';

// Mock context de notifications
vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    showToast: vi.fn()
  })
}));

// Mock Supabase RPC & Queries
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn()
  }
}));

// Données fictives valides pour les contrats
const samplePreviewPayload: BulkIssuePreviewResult = {
  selector: {
    type: 'source_batch_key',
    label: 'Brouillons du traitement groupé'
  },
  summary: {
    selected: 500,
    eligible: 496,
    already_issued: 2,
    invalid: 2,
    estimated_total: 74400.00,
    currency: 'USD'
  },
  eligible_invoices: [
    {
      invoice_id: 'a9000000-0000-4000-a000-000000000001',
      student_number: 'ELV-2026-001',
      student_name: 'Élève Un',
      class_name: 'Classe 1A',
      amount: 150.00,
      currency: 'USD',
      due_date: '2026-10-31'
    },
    {
      invoice_id: 'a9000000-0000-4000-a000-000000000002',
      student_number: 'ELV-2026-002',
      student_name: 'Élève Deux',
      class_name: 'Classe 1A',
      amount: 150.00,
      currency: 'USD',
      due_date: '2026-10-31'
    }
  ],
  excluded_invoices: [
    {
      invoice_id: 'd1000000-0000-4000-a000-000000000004',
      student_number: 'ELV-2026-004',
      student_name: 'Élève Quatre',
      reason_code: 'already_issued',
      reason_label: 'Facture déjà émise ou non-brouillon'
    }
  ]
};

const sampleExecutionPayload: BulkIssueExecutionResult = {
  success: true,
  is_idempotent_replay: false,
  summary: {
    selected: 2,
    issued: 2,
    existing: 0,
    skipped: 0
  },
  issued_invoices: [
    {
      invoice_id: 'a9000000-0000-4000-a000-000000000001',
      invoice_number: 'INV-2026-000001',
      student_number: 'ELV-2026-001',
      student_name: 'Élève Un',
      amount: 150.00,
      currency: 'USD',
      status: 'issued'
    },
    {
      invoice_id: 'a9000000-0000-4000-a000-000000000002',
      invoice_number: 'INV-2026-000002',
      student_number: 'ELV-2026-002',
      student_name: 'Élève Deux',
      amount: 150.00,
      currency: 'USD',
      status: 'issued'
    }
  ],
  existing_invoices: [],
  skipped_invoices: []
};

describe('LOT 2K-FIN-BULK-ISSUE-F — Suite de 60 Tests Ciblés Émission Groupée', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // SECTION 1 : CONTRATS & PARSEURS DÉFENSIFS (15 TESTS)
  // =========================================================================
  describe('1. Contrats TypeScript et Parseurs Défensifs', () => {
    it('1. Valide un payload de prévisualisation conforme', () => {
      const parsed = validateBulkIssuePreviewResult(samplePreviewPayload);
      expect(parsed.summary.selected).toBe(500);
      expect(parsed.summary.eligible).toBe(496);
      expect(parsed.eligible_invoices.length).toBe(2);
    });

    it('2. Rejette une réponse de prévisualisation non-objet', () => {
      expect(() => validateBulkIssuePreviewResult('invalid')).toThrow(FinanceServiceError);
      expect(() => validateBulkIssuePreviewResult(null)).toThrow(FinanceServiceError);
    });

    it('3. Rejette un sélecteur manquant ou invalide dans la prévisualisation', () => {
      const bad = { ...samplePreviewPayload, selector: { type: 'unknown', label: 'X' } };
      expect(() => validateBulkIssuePreviewResult(bad)).toThrow(FinanceServiceError);
    });

    it('4. Rejette si summary est manquant dans la prévisualisation', () => {
      const bad = { ...samplePreviewPayload, summary: undefined };
      expect(() => validateBulkIssuePreviewResult(bad)).toThrow(FinanceServiceError);
    });

    it('5. Rejette des montants non numériques ou non finis (NaN / Infinity)', () => {
      const bad = {
        ...samplePreviewPayload,
        summary: { ...samplePreviewPayload.summary, estimated_total: NaN }
      };
      expect(() => validateBulkIssuePreviewResult(bad)).toThrow(FinanceServiceError);
    });

    it('6. Rejette une devise inconnue dans la prévisualisation', () => {
      const bad = {
        ...samplePreviewPayload,
        summary: { ...samplePreviewPayload.summary, currency: 'EUR' }
      };
      expect(() => validateBulkIssuePreviewResult(bad)).toThrow(FinanceServiceError);
    });

    it('7. Rejette si l’invariant selected = eligible + already_issued + invalid est rompu', () => {
      const bad = {
        ...samplePreviewPayload,
        summary: { ...samplePreviewPayload.summary, selected: 999 }
      };
      expect(() => validateBulkIssuePreviewResult(bad)).toThrow(FinanceServiceError);
    });

    it('8. Rejette un UUID invalide dans eligible_invoices', () => {
      const bad = {
        ...samplePreviewPayload,
        eligible_invoices: [{ ...samplePreviewPayload.eligible_invoices[0], invoice_id: 'bad-uuid' }]
      };
      expect(() => validateBulkIssuePreviewResult(bad)).toThrow(FinanceServiceError);
    });

    it('9. Valide un payload d’exécution d’émission conforme', () => {
      const parsed = validateBulkIssueExecutionResult(sampleExecutionPayload);
      expect(parsed.success).toBe(true);
      expect(parsed.summary.issued).toBe(2);
      expect(parsed.issued_invoices.length).toBe(2);
    });

    it('10. Rejette une réponse d’exécution non-objet', () => {
      expect(() => validateBulkIssueExecutionResult(123)).toThrow(FinanceServiceError);
    });

    it('11. Rejette si success = false dans le résultat d’émission', () => {
      const bad = { ...sampleExecutionPayload, success: false };
      expect(() => validateBulkIssueExecutionResult(bad)).toThrow(FinanceServiceError);
    });

    it('12. Rejette un invariant d’exécution rompu (selected != issued + existing + skipped)', () => {
      const bad = {
        ...sampleExecutionPayload,
        summary: { selected: 10, issued: 1, existing: 0, skipped: 0 }
      };
      expect(() => validateBulkIssueExecutionResult(bad)).toThrow(FinanceServiceError);
    });

    it('13. Rejette un UUID invalide dans issued_invoices', () => {
      const bad = {
        ...sampleExecutionPayload,
        issued_invoices: [{ ...sampleExecutionPayload.issued_invoices[0], invoice_id: 'invalid-id' }]
      };
      expect(() => validateBulkIssueExecutionResult(bad)).toThrow(FinanceServiceError);
    });

    it('14. Extrait correctement les réémissions idempotentes (is_idempotent_replay)', () => {
      const replayPayload = { ...sampleExecutionPayload, is_idempotent_replay: true };
      const parsed = validateBulkIssueExecutionResult(replayPayload);
      expect(parsed.is_idempotent_replay).toBe(true);
    });

    it('15. Tolère les tableaux optionnels d’exclusions vides ou absents', () => {
      const minimal = {
        ...sampleExecutionPayload,
        existing_invoices: undefined,
        skipped_invoices: undefined
      };
      const parsed = validateBulkIssueExecutionResult(minimal);
      expect(parsed.existing_invoices).toEqual([]);
      expect(parsed.skipped_invoices).toEqual([]);
    });
  });

  // =========================================================================
  // SECTION 2 : PARAMÈTRES RPC & SÉLECTEURS EXCLUSIFS (10 TESTS)
  // =========================================================================
  describe('2. Paramètres RPC et Sélecteurs Exclusifs', () => {
    it('16. Appelle exactement la RPC "preview_bulk_issue_student_invoices" avec source_batch_key', async () => {
      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: samplePreviewPayload, error: null } as any);

      await previewBulkIssueStudentInvoices({ p_source_batch_key: 'BATCH-2026-001' });

      expect(spy).toHaveBeenCalledWith('preview_bulk_issue_student_invoices', {
        p_source_batch_key: 'BATCH-2026-001',
        p_fee_id: null,
        p_invoice_ids: null
      });
    });

    it('17. Appelle la RPC avec fee_id lorsque sélectionné', async () => {
      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: samplePreviewPayload, error: null } as any);

      await previewBulkIssueStudentInvoices({ p_fee_id: 'f1000000-0000-4000-a000-000000000001' });

      expect(spy).toHaveBeenCalledWith('preview_bulk_issue_student_invoices', {
        p_source_batch_key: null,
        p_fee_id: 'f1000000-0000-4000-a000-000000000001',
        p_invoice_ids: null
      });
    });

    it('18. Appelle la RPC avec p_invoice_ids pour une sélection explicite', async () => {
      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: samplePreviewPayload, error: null } as any);

      await previewBulkIssueStudentInvoices({ p_invoice_ids: ['a9000000-0000-4000-a000-000000000001'] });

      expect(spy).toHaveBeenCalledWith('preview_bulk_issue_student_invoices', {
        p_source_batch_key: null,
        p_fee_id: null,
        p_invoice_ids: ['a9000000-0000-4000-a000-000000000001']
      });
    });

    it('19. Rejette localement si aucun sélecteur n’est fourni (code 22023)', async () => {
      const { result, error } = await previewBulkIssueStudentInvoices({});
      expect(result).toBeNull();
      expect(error).not.toBeNull();
      expect((error as FinanceServiceError).code).toBe('22023');
    });

    it('20. Rejette localement si plusieurs sélecteurs sont fournis à la fois', async () => {
      const { result, error } = await previewBulkIssueStudentInvoices({
        p_source_batch_key: 'KEY-1',
        p_fee_id: 'f1000000-0000-4000-a000-000000000001'
      });
      expect(result).toBeNull();
      expect(error).not.toBeNull();
    });

    it('21. Appelle exactement la RPC "issue_bulk_student_invoices"', async () => {
      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: sampleExecutionPayload, error: null } as any);

      await issueBulkStudentInvoices({
        p_invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
        p_batch_issue_idempotency_key: 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000001'
      });

      expect(spy).toHaveBeenCalledWith('issue_bulk_student_invoices', {
        p_invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
        p_batch_issue_idempotency_key: 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000001'
      });
    });

    it('22. Ne déclenche AUCUN appel à la RPC individuelle "issue_student_invoice"', async () => {
      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: sampleExecutionPayload, error: null } as any);

      await issueBulkStudentInvoices({
        p_invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
        p_batch_issue_idempotency_key: 'bulk-issue-20261002-a1000000-0000-4000-a000-000000000001'
      });

      expect(spy).not.toHaveBeenCalledWith('issue_student_invoice', expect.anything());
    });

    it('23. Rejette un tableau p_invoice_ids vide pour l’émission', async () => {
      const { result, error } = await issueBulkStudentInvoices({
        p_invoice_ids: [],
        p_batch_issue_idempotency_key: 'bulk-issue-20261002-key'
      });
      expect(result).toBeNull();
      expect(error).not.toBeNull();
    });

    it('24. Rejette plus de 500 factures dans un seul appel d’émission (limite à 500)', async () => {
      const oversized = new Array(501).fill('a9000000-0000-4000-a000-000000000001');
      const { result, error } = await issueBulkStudentInvoices({
        p_invoice_ids: oversized,
        p_batch_issue_idempotency_key: 'bulk-issue-20261002-key'
      });
      expect(result).toBeNull();
      expect((error as FinanceServiceError).code).toBe('22023');
    });

    it('25. Rejette une clé d’idempotence vide', async () => {
      const { result, error } = await issueBulkStudentInvoices({
        p_invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
        p_batch_issue_idempotency_key: '   '
      });
      expect(result).toBeNull();
      expect(error).not.toBeNull();
    });
  });

  // =========================================================================
  // SECTION 3 : PARCOURS WIZARD ET UX (15 TESTS)
  // =========================================================================
  describe('3. Parcours Wizard & UX', () => {
    it('26. Rend l’étape 1 (Sélection) au montage', () => {
      render(<BulkIssueInvoiceModal isOpen={true} onClose={vi.fn()} />);
      expect(screen.getByText(/Sélection des Brouillons à Émettre/i)).toBeInTheDocument();
    });

    it('27. Passe directement à l’étape 2 si la prévisualisation est déjà chargée', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={2}
          initialPreview={samplePreviewPayload}
        />
      );
      expect(screen.getByText(/Éligibles à l’émission/i)).toBeInTheDocument();
      expect(screen.getByText('496')).toBeInTheDocument();
    });

    it('28. Bloque le bouton de continuation si 0 facture n’est éligible', () => {
      const zeroPreview = {
        ...samplePreviewPayload,
        summary: { ...samplePreviewPayload.summary, eligible: 0 },
        eligible_invoices: []
      };

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={2}
          initialPreview={zeroPreview}
        />
      );

      const btn = screen.getByRole('button', { name: /Continuer vers la confirmation/i });
      expect(btn).toBeDisabled();
      expect(screen.getByText(/Aucune facture éligible à l’émission/i)).toBeInTheDocument();
    });

    it('29. Affiche l’avertissement officiel à l’étape 3 (Confirmation irréversible)', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      expect(screen.getByText(/Confirmation Officielle et Irréversible/i)).toBeInTheDocument();
      expect(screen.getByText(/INV-YYYY-XXXXXX/i)).toBeInTheDocument();
      expect(screen.getByText(/deviendront immédiatement visibles par les parents/i)).toBeInTheDocument();
    });

    it('30. Précise que l’opération ne transmet aucun email ou SMS', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      expect(screen.getByText(/Cette opération ne transmet pas automatiquement un email/i)).toBeInTheDocument();
    });

    it('31. Le bouton d’émission reste désactivé tant que la case n’est pas cochée', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      const submitBtn = screen.getByRole('button', { name: /Émettre officiellement/i });
      expect(submitBtn).toBeDisabled();

      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      expect(submitBtn).not.toBeDisabled();
    });

    it('32. Rend le résumé des résultats à l’étape 5', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={5}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'completed',
            total_invoices: 2,
            total_segments: 1,
            completed_segments_count: 1,
            issued_count_total: 2,
            segments: [
              {
                segment_index: 1,
                total_segments: 1,
                invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
                idempotency_key: 'bulk-issue-20261002-test-key-1',
                status: 'completed',
                result: sampleExecutionPayload
              }
            ]
          }}
        />
      );

      expect(screen.getByText(/Émission Groupée Terminée avec Succès/i)).toBeInTheDocument();
      expect(screen.getByText('INV-2026-000001')).toBeInTheDocument();
      expect(screen.getByText(/visibles dans le portail des parents autorisés/i)).toBeInTheDocument();
    });

    it('33. N’affirme jamais dans le message final qu’un email a été envoyé', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={5}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'completed',
            total_invoices: 2,
            total_segments: 1,
            completed_segments_count: 1,
            issued_count_total: 2,
            segments: []
          }}
        />
      );

      const html = document.body.innerHTML;
      expect(html).not.toMatch(/email envoyé/i);
      expect(html).not.toMatch(/courriel transmis/i);
    });

    it('34. Permet de naviguer entre l’onglet des factures éligibles et exclues à l’étape 2', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={2}
          initialPreview={samplePreviewPayload}
        />
      );

      expect(screen.getByText('Élève Un')).toBeInTheDocument();

      const excludedTab = screen.getByRole('button', { name: /Exclusions & Ignorées/i });
      fireEvent.click(excludedTab);

      expect(screen.getByText('Facture déjà émise ou non-brouillon')).toBeInTheDocument();
    });

    it('35. Déclenche onSuccess et onClose lors du clic sur Terminer', () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          onSuccess={onSuccess}
          initialStep={5}
          initialPreview={samplePreviewPayload}
        />
      );

      const endBtn = screen.getByRole('button', { name: /Terminer/i });
      fireEvent.click(endBtn);

      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('36. Affiche la liste des numéros officiels générés à l’étape 5', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={5}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'completed',
            total_invoices: 2,
            total_segments: 1,
            completed_segments_count: 1,
            issued_count_total: 2,
            segments: [
              {
                segment_index: 1,
                total_segments: 1,
                invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
                idempotency_key: 'bulk-issue-20261002-test-key-1',
                status: 'completed',
                result: sampleExecutionPayload
              }
            ]
          }}
        />
      );

      expect(screen.getByText('INV-2026-000001')).toBeInTheDocument();
      expect(screen.getByText('INV-2026-000002')).toBeInTheDocument();
    });

    it('37. Gère l’affichage responsive des 5 étapes', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={2}
          initialPreview={samplePreviewPayload}
        />
      );

      expect(screen.getByText('Sélection')).toBeInTheDocument();
      expect(screen.getByText('Prévisualisation')).toBeInTheDocument();
      expect(screen.getByText('Confirmation')).toBeInTheDocument();
    });

    it('38. Supporte l’ouverture directe par tarif', async () => {
      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: samplePreviewPayload, error: null } as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          feeId="f1000000-0000-4000-a000-000000000001"
        />
      );

      await waitFor(() => {
        expect(spy).toHaveBeenCalledWith('preview_bulk_issue_student_invoices', expect.objectContaining({
          p_fee_id: 'f1000000-0000-4000-a000-000000000001'
        }));
      });
    });

    it('39. Affiche une alerte si la prévisualisation échoue', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: { message: 'Erreur réseau Supabase', code: 'P0001' } } as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          feeId="f1000000-0000-4000-a000-000000000001"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Erreur réseau Supabase/i)).toBeInTheDocument();
      });
    });

    it('40. Efface les résultats et réinitialise l’état lors du changement de sélection', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          fees={[{ id: 'f1', name: 'Frais 1', amount: 100, currency: 'USD' }]}
        />
      );

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'f1' } });

      expect((select as HTMLSelectElement).value).toBe('f1');
    });
  });

  // =========================================================================
  // SECTION 4 : SEGMENTATION SÉQUENTIELLE DE 500 (10 TESTS)
  // =========================================================================
  describe('4. Segmentation Séquentielle (1, 500, 501, 2 000)', () => {

    it('41. Découpe 2 000 factures en exactement 4 segments de 500 maximum', async () => {
      // Générer 2000 factures éligibles
      const invoices2000 = new Array(2000).fill(null).map((_, i) => ({
        invoice_id: `a9000000-0000-4000-a000-${(i + 1).toString(16).padStart(12, '0')}`,
        student_number: `ELV-${i + 1}`,
        student_name: `Élève ${i + 1}`,
        class_name: '1A',
        amount: 100,
        currency: 'USD' as Currency,
        due_date: '2026-10-31'
      }));

      const preview2000: BulkIssuePreviewResult = {
        selector: { type: 'source_batch_key', label: 'Brouillons' },
        summary: { selected: 2000, eligible: 2000, already_issued: 0, invalid: 0, estimated_total: 200000, currency: 'USD' },
        eligible_invoices: invoices2000,
        excluded_invoices: []
      };

      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: {
          success: true,
          is_idempotent_replay: false,
          summary: { selected: 500, issued: 500, existing: 0, skipped: 0 },
          issued_invoices: [],
          existing_invoices: [],
          skipped_invoices: []
        },
        error: null
      } as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={preview2000}
        />
      );

      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      const submitBtn = screen.getByRole('button', { name: /Émettre officiellement/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(4); // 4 segments de 500
      });
    });

    it('42. Conserve l’ordre déterministe reçu de la prévisualisation', async () => {
      const invoices1000 = new Array(1000).fill(null).map((_, i) => ({
        invoice_id: `a9000000-0000-4000-a000-${(i + 1).toString(16).padStart(12, '0')}`,
        student_number: `ELV-${i + 1}`,
        student_name: `Élève ${i + 1}`,
        class_name: '1A',
        amount: 100,
        currency: 'USD' as Currency,
        due_date: '2026-10-31'
      }));

      const preview1000: BulkIssuePreviewResult = {
        selector: { type: 'source_batch_key', label: 'Brouillons' },
        summary: { selected: 1000, eligible: 1000, already_issued: 0, invalid: 0, estimated_total: 100000, currency: 'USD' },
        eligible_invoices: invoices1000,
        excluded_invoices: []
      };

      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: {
          success: true,
          is_idempotent_replay: false,
          summary: { selected: 500, issued: 500, existing: 0, skipped: 0 },
          issued_invoices: [],
          existing_invoices: [],
          skipped_invoices: []
        },
        error: null
      } as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={preview1000}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Émettre officiellement/i }));

      await waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(2);
        // Vérifier que le 1er segment contient bien les UUIDs 0-499
        const firstCallIds = spy.mock.calls[0][1].p_invoice_ids;
        expect(firstCallIds[0]).toBe(invoices1000[0].invoice_id);
        expect(firstCallIds[499]).toBe(invoices1000[499].invoice_id);
      });
    });

    it('43. N’exécute JAMAIS les segments en parallèle', async () => {
      let callCount = 0;
      const spy = vi.spyOn(supabase, 'rpc').mockImplementation((async () => {
        callCount++;
        await new Promise(r => setTimeout(r, 20));
        return {
          data: {
            success: true,
            is_idempotent_replay: false,
            summary: { selected: 500, issued: 500, existing: 0, skipped: 0 },
            issued_invoices: [],
            existing_invoices: [],
            skipped_invoices: []
          },
          error: null
        };
      }) as any);

      const invoices1000 = new Array(1000).fill(null).map((_, i) => ({
        invoice_id: `a9000000-0000-4000-a000-${(i + 1).toString(16).padStart(12, '0')}`,
        student_number: `ELV-${i + 1}`,
        student_name: `Élève ${i + 1}`,
        class_name: '1A',
        amount: 100,
        currency: 'USD' as Currency,
        due_date: '2026-10-31'
      }));

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={{
            selector: { type: 'source_batch_key', label: 'Brouillons' },
            summary: { selected: 1000, eligible: 1000, already_issued: 0, invalid: 0, estimated_total: 100000, currency: 'USD' },
            eligible_invoices: invoices1000,
            excluded_invoices: []
          }}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Émettre officiellement/i }));

      await waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(2);
      });
    });

    it('44. Affiche la progression métier sans clés techniques (Lot 1 sur 4)', async () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={4}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'executing',
            total_invoices: 2000,
            total_segments: 4,
            completed_segments_count: 1,
            issued_count_total: 500,
            segments: [
              {
                segment_index: 1,
                total_segments: 4,
                invoice_ids: [],
                idempotency_key: 'bulk-issue-20261002-key-1',
                status: 'completed'
              },
              {
                segment_index: 2,
                total_segments: 4,
                invoice_ids: [],
                idempotency_key: 'bulk-issue-20261002-key-2',
                status: 'in_progress'
              }
            ]
          }}
        />
      );

      expect(screen.getByText(/Lot 2 sur 4/i)).toBeInTheDocument();
      expect(screen.getByText(/500 factures émises sur 2000/i)).toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain('bulk-issue-20261002-key-1');
    });

    it('45. Interrompt la boucle de segmentation si un lot échoue', async () => {
      const invoices1000 = new Array(1000).fill(null).map((_, i) => ({
        invoice_id: `a9000000-0000-4000-a000-${(i + 1).toString(16).padStart(12, '0')}`,
        student_number: `ELV-${i + 1}`,
        student_name: `Élève ${i + 1}`,
        class_name: '1A',
        amount: 100,
        currency: 'USD' as Currency,
        due_date: '2026-10-31'
      }));

      let callIndex = 0;
      const spy = vi.spyOn(supabase, 'rpc').mockImplementation((async () => {
        callIndex++;
        if (callIndex === 1) {
          return { error: { message: 'Délai réseau dépassé (504)', code: '504' } };
        }
        return { data: sampleExecutionPayload, error: null };
      }) as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={{
            selector: { type: 'source_batch_key', label: 'Brouillons' },
            summary: { selected: 1000, eligible: 1000, already_issued: 0, invalid: 0, estimated_total: 100000, currency: 'USD' },
            eligible_invoices: invoices1000,
            excluded_invoices: []
          }}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Émettre officiellement/i }));

      await waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/Délai réseau dépassé/i)).toBeInTheDocument();
      });
    });

    it('46. Permet de réétendre uniquement le lot en erreur avec la même clé', async () => {
      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: sampleExecutionPayload,
        error: null
      } as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={4}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 2,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: [
              {
                segment_index: 1,
                total_segments: 1,
                invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
                idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000001',
                status: 'failed_ambiguous',
                error_message: 'Erreur réseau temporaire',
                error_type: 'ambiguous'
              }
            ]
          }}
        />
      );

      const retryBtn = screen.getByRole('button', { name: /Réessayer ce lot/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(spy).toHaveBeenCalledWith('issue_bulk_student_invoices', {
          p_invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
          p_batch_issue_idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000001'
        });
      });
    });

    it('47. Conserve les segments déjà terminés sans les réexécuter lors de la reprise', async () => {
      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: sampleExecutionPayload,
        error: null
      } as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={4}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 1000,
            total_segments: 2,
            completed_segments_count: 1,
            issued_count_total: 500,
            segments: [
              {
                segment_index: 1,
                total_segments: 2,
                invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
                idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000001',
                status: 'completed',
                result: sampleExecutionPayload
              },
              {
                segment_index: 2,
                total_segments: 2,
                invoice_ids: ['a9000000-0000-4000-a000-000000000002'],
                idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000002',
                status: 'failed_ambiguous',
                error_message: 'Erreur lot 2',
                error_type: 'ambiguous'
              }
            ]
          }}
        />
      );

      const retryBtn = screen.getByRole('button', { name: /Réessayer ce lot/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('issue_bulk_student_invoices', expect.objectContaining({
          p_batch_issue_idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000002'
        }));
      });
    });

    it('48. Génère le format strict bulk-issue-YYYYMMDD-<uuid> pour chaque clé', async () => {
      let sentKey = '';
      vi.spyOn(supabase, 'rpc').mockImplementation((async (fn: any, args: any) => {
        if (fn === 'issue_bulk_student_invoices') {
          sentKey = args.p_batch_issue_idempotency_key;
        }
        return { data: sampleExecutionPayload, error: null };
      }) as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Émettre officiellement/i }));

      await waitFor(() => {
        expect(sentKey).toMatch(/^bulk-issue-\d{8}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
      });
    });

    it('49. Bloque les soumissions multiples sur double-clic rapide', async () => {
      let callCount = 0;
      vi.spyOn(supabase, 'rpc').mockImplementation((async () => {
        callCount++;
        await new Promise(r => setTimeout(r, 100));
        return { data: sampleExecutionPayload, error: null };
      }) as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      const submitBtn = screen.getByRole('button', { name: /Émettre officiellement/i });

      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(callCount).toBe(1);
      });
    });

    it('50. 1 seule facture éligible -> 1 seul segment d’émission', async () => {
      const singlePreview: BulkIssuePreviewResult = {
        ...samplePreviewPayload,
        summary: { ...samplePreviewPayload.summary, selected: 1, eligible: 1 },
        eligible_invoices: [samplePreviewPayload.eligible_invoices[0]]
      };

      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: sampleExecutionPayload,
        error: null
      } as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={singlePreview}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Émettre officiellement/i }));

      await waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(1);
      });
    });
  });

  // =========================================================================
  // SECTION 5 : SÉCURITÉ DOM & ABSENCE D'UUID / CLÉS TECHNIQUES (10 TESTS)
  // =========================================================================
  describe('5. Sécurité DOM et Absence de Clés Techniques', () => {
    it('51. Aucun UUID (format 8-4-4-4-12) n’apparaît dans le DOM de prévisualisation', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={2}
          initialPreview={samplePreviewPayload}
        />
      );

      const html = document.body.innerHTML;
      const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
      expect(html).not.toMatch(uuidRegex);
    });

    it('52. Aucun préfixe technique "bulk-issue-" ni "bulk-YYYYMMDD-" dans le DOM', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      const html = document.body.innerHTML;
      expect(html).not.toContain('bulk-issue-');
      expect(html).not.toContain('bulk-20261002-');
    });

    it('53. Aucune chaîne "null", "undefined" ou "NaN" visible dans l’interface', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={2}
          initialPreview={samplePreviewPayload}
        />
      );

      const html = document.body.innerHTML;
      expect(html).not.toContain('>null<');
      expect(html).not.toContain('>undefined<');
      expect(html).not.toContain('>NaN<');
      expect(html).not.toContain('>Invalid Date<');
    });

    it('54. N’expose aucun UUID dans les attributs HTML (data-*, id, title, name)', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={2}
          initialPreview={samplePreviewPayload}
        />
      );

      const allElements = document.querySelectorAll('*');
      const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

      allElements.forEach(el => {
        Array.from(el.attributes).forEach(attr => {
          expect(attr.value).not.toMatch(uuidRegex);
          expect(attr.value).not.toContain('bulk-issue-');
        });
      });
    });

    it('55. Affiche uniquement les numéros officiels formatés INV-YYYY-XXXXXX dans les résultats', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={5}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'completed',
            total_invoices: 2,
            total_segments: 1,
            completed_segments_count: 1,
            issued_count_total: 2,
            segments: [
              {
                segment_index: 1,
                total_segments: 1,
                invoice_ids: [],
                idempotency_key: 'bulk-issue-20261002-key',
                status: 'completed',
                result: sampleExecutionPayload
              }
            ]
          }}
        />
      );

      expect(screen.getByText('INV-2026-000001')).toBeInTheDocument();
      expect(screen.getByText('INV-2026-000002')).toBeInTheDocument();
    });

    it('56. Absorbe la clé source lors du transfert et ne l’affiche pas', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          sourceBatchKey="SECRET-SOURCE-KEY-999"
          initialStep={2}
          initialPreview={samplePreviewPayload}
        />
      );

      expect(document.body.innerHTML).not.toContain('SECRET-SOURCE-KEY-999');
    });

    it('57. N’injecte aucune clé d’idempotence dans l’attribut aria-label ou title', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      const titles = Array.from(document.querySelectorAll('[title]')).map(el => el.getAttribute('title'));
      titles.forEach(title => {
        expect(title).not.toContain('bulk-issue-');
      });
    });

    it('58. Préserve le style responsive de la modale sans débordement horizontal', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={2}
          initialPreview={samplePreviewPayload}
        />
      );

      const modalContainer = document.querySelector('.max-w-4xl');
      expect(modalContainer).toBeInTheDocument();
    });

    it('59. Fermeture sécurisée bloquée pendant une exécution active', () => {
      const onClose = vi.fn();

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={4}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'executing',
            total_invoices: 2,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: []
          }}
        />
      );

      const closeBtn = screen.getByRole('button', { name: /Fermer/i });
      fireEvent.click(closeBtn);

      expect(onClose).not.toHaveBeenCalled();
    });

    it('60. Bloque la fermeture et affiche un toast lors d’une tentative de fermeture pendant l’exécution', () => {
      const onClose = vi.fn();

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={4}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'executing',
            total_invoices: 2,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: []
          }}
        />
      );

      const closeBtn = screen.getByRole('button', { name: /Fermer/i });
      fireEvent.click(closeBtn);

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText(/L’émission est en cours/i)).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // 7. DURCISSEMENT ET V2 — SÉCURISATION ET REPRISE (CAS 61 À 78)
  // ---------------------------------------------------------------------------
  describe('7. Durcissement V2 — Sécurisation et Reprise', () => {
    it('61. Inventaire des reason_code aligné avec la migration SQL', () => {
      const rawPayload = {
        ...samplePreviewPayload,
        excluded_invoices: [
          {
            invoice_id: 'd1000000-0000-4000-a000-000000000001',
            student_number: 'ELV-001',
            student_name: 'Test 1',
            reason_code: 'already_issued',
            reason_label: 'Facture déjà émise ou non-brouillon'
          },
          {
            invoice_id: 'd1000000-0000-4000-a000-000000000002',
            student_number: 'ELV-002',
            student_name: 'Test 2',
            reason_code: 'invalid_total',
            reason_label: 'Montant de facture invalide ou sans ligne de frais'
          }
        ]
      };

      const parsed = validateBulkIssuePreviewResult(rawPayload);
      expect(parsed.excluded_invoices[0].reason_code).toBe('already_issued');
      expect(parsed.excluded_invoices[1].reason_code).toBe('invalid_total');
    });

    it('62. Supporte due_date = null selon le contrat SQL réel', () => {
      const rawPayload = {
        ...samplePreviewPayload,
        eligible_invoices: [
          {
            invoice_id: 'a9000000-0000-4000-a000-000000000001',
            student_number: 'ELV-001',
            student_name: 'Pierre Tshilombo',
            class_name: 'Classe 1A',
            amount: 150.00,
            currency: 'USD',
            due_date: null
          }
        ]
      };

      const parsed = validateBulkIssuePreviewResult(rawPayload);
      expect(parsed.eligible_invoices[0].due_date).toBeNull();
    });

    it('63. Rejette une date d’échéance invalide (non-date) dans le parseur', () => {
      const rawPayload = {
        ...samplePreviewPayload,
        eligible_invoices: [
          {
            invoice_id: 'a9000000-0000-4000-a000-000000000001',
            student_number: 'ELV-001',
            student_name: 'Pierre Tshilombo',
            class_name: 'Classe 1A',
            amount: 150.00,
            currency: 'USD',
            due_date: 'date-invalide-99'
          }
        ]
      };

      expect(() => validateBulkIssuePreviewResult(rawPayload)).toThrow(/Date d’échéance due_date invalide/);
    });

    it('64. Classe les erreurs de timeout / 504 en failed_ambiguous', async () => {
      vi.spyOn(supabase, 'rpc').mockImplementation((async () => {
        return { error: { message: '504 Gateway Timeout lors de l’émission', code: '504' } };
      }) as any);

      const res = await issueBulkStudentInvoices({
        p_invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
        p_batch_issue_idempotency_key: 'bulk-issue-20261002-a0000000-0000-4000-a000-000000000001'
      });

      expect(res.result).toBeNull();
      expect(res.error).not.toBeNull();
      expect(res.error?.error_type).toBe('ambiguous');
    });

    it('65. Classe les erreurs SQLSTATE 22023 / validation en failed_definitive', async () => {
      vi.spyOn(supabase, 'rpc').mockImplementation((async () => {
        return { error: { message: 'REJET : Clé invalide', code: '22023' } };
      }) as any);

      const res = await issueBulkStudentInvoices({
        p_invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
        p_batch_issue_idempotency_key: 'bulk-issue-20261002-a0000000-0000-4000-a000-000000000001'
      });

      expect(res.result).toBeNull();
      expect(res.error).not.toBeNull();
      expect(res.error?.error_type).toBe('definitive');
    });

    it('66. Bloque la fermeture via le bouton X pendant l’exécution', () => {
      const onClose = vi.fn();
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={4}
          initialExecutionState={{
            overall_status: 'executing',
            total_invoices: 10,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: []
          }}
        />
      );

      const xBtn = screen.getByRole('button', { name: /Fermer/i });
      fireEvent.click(xBtn);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('67. Bloque la touche Escape pendant l’exécution', () => {
      const onClose = vi.fn();
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={4}
          initialExecutionState={{
            overall_status: 'executing',
            total_invoices: 10,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: []
          }}
        />
      );

      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('68. Bloque le clic sur l’overlay pendant l’exécution', () => {
      const onClose = vi.fn();
      const { container } = render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={4}
          initialExecutionState={{
            overall_status: 'executing',
            total_invoices: 10,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: []
          }}
        />
      );

      const overlay = container.querySelector('.bg-slate-900\\/50') || container.firstElementChild;
      if (overlay) {
        fireEvent.click(overlay);
      }
      expect(onClose).not.toHaveBeenCalled();
    });

    it('69. Installe puis retire le gestionnaire beforeunload pendant l’exécution', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={4}
          initialExecutionState={{
            overall_status: 'executing',
            total_invoices: 10,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: []
          }}
        />
      );

      expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
      unmount();
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('70. Bloque la fermeture simple après un timeout ambigu tant que l’utilisateur n’a pas choisi', () => {
      const onClose = vi.fn();
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={4}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 1000,
            total_segments: 2,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: [
              {
                segment_index: 1,
                total_segments: 2,
                invoice_ids: ['a1'],
                idempotency_key: 'bulk-issue-20261002-key-1',
                status: 'failed_ambiguous',
                error_message: '504 Gateway Timeout',
                error_type: 'ambiguous'
              }
            ]
          }}
        />
      );

      const closeBtn = screen.getByRole('button', { name: /Fermer/i });
      fireEvent.click(closeBtn);

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText(/Abandon du suivi de l’émission groupée/i)).toBeInTheDocument();
    });

    it('71. Réutilise exactement la même clé d’idempotence lors d’un rejeu de segment', async () => {
      let sentKeys: string[] = [];
      vi.spyOn(supabase, 'rpc').mockImplementation((async (fn: any, args: any) => {
        if (fn === 'issue_bulk_student_invoices') {
          sentKeys.push(args.p_batch_issue_idempotency_key);
        }
        return { data: sampleExecutionPayload, error: null };
      }) as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Émettre officiellement/i }));

      await waitFor(() => {
        expect(sentKeys.length).toBe(1);
      });
      const firstKey = sentKeys[0];

      // Rejeu simulé du segment
      expect(firstKey).toMatch(/^bulk-issue-\d{8}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
    });

    it('72. Traitement d’abandon explicite sans nouvel appel API', () => {
      const rpcSpy = vi.spyOn(supabase, 'rpc');
      const onClose = vi.fn();

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={4}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 1000,
            total_segments: 2,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: [
              {
                segment_index: 1,
                total_segments: 2,
                invoice_ids: ['a1'],
                idempotency_key: 'bulk-issue-20261002-key-1',
                status: 'failed_ambiguous',
                error_message: '504 Gateway Timeout'
              }
            ]
          }}
        />
      );

      // Cliquer sur "Abandonner le suivi"
      const abandonBtn = screen.getByRole('button', { name: /Abandonner le suivi/i });
      fireEvent.click(abandonBtn);

      // Dans la vue de confirmation d'abandon, cliquer sur "Abandonner le suivi et rapprocher plus tard"
      const confirmAbandonBtn = screen.getByRole('button', { name: /Abandonner le suivi et rapprocher plus tard/i });
      fireEvent.click(confirmAbandonBtn);

      expect(onClose).toHaveBeenCalled();
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it('73. Exige une nouvelle prévisualisation après un abandon explicite', async () => {
      const onClose = vi.fn();

      const { rerender } = render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={4}
          initialPreview={samplePreviewPayload}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 1000,
            total_segments: 2,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: [
              {
                segment_index: 1,
                total_segments: 2,
                invoice_ids: ['a1'],
                idempotency_key: 'bulk-issue-20261002-key-1',
                status: 'failed_ambiguous',
                error_message: '504 Gateway Timeout'
              }
            ]
          }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Abandonner le suivi/i }));
      fireEvent.click(screen.getByRole('button', { name: /Abandonner le suivi et rapprocher plus tard/i }));

      // Remontage du composant
      rerender(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={1}
          initialPreview={null}
        />
      );

      expect(screen.getByText(/Sélection des Brouillons à Émettre/i)).toBeInTheDocument();
    });

    it('74. Empêche les setState après le démontage du composant', async () => {
      let resolveRpc: any;
      vi.spyOn(supabase, 'rpc').mockImplementation((() => {
        return new Promise((resolve) => {
          resolveRpc = resolve;
        });
      }) as any);

      const { unmount } = render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Émettre officiellement/i }));

      unmount();
      expect(() => {
        resolveRpc({ data: sampleExecutionPayload, error: null });
      }).not.toThrow();
    });

    it('75. N’exécute aucun segment suivant après un échec ou un abandon', async () => {
      let callCount = 0;
      vi.spyOn(supabase, 'rpc').mockImplementation((async () => {
        callCount++;
        return { error: { message: '504 Gateway Timeout', code: '504' } };
      }) as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={{
            ...samplePreviewPayload,
            eligible_invoices: new Array(1000).fill(null).map((_, i) => ({
              invoice_id: `a9000000-0000-4000-a000-${(i + 1).toString(16).padStart(12, '0')}`,
              student_number: `ELV-${i + 1}`,
              student_name: `Élève ${i + 1}`,
              class_name: 'Classe 1A',
              amount: 150.00,
              currency: 'USD',
              due_date: '2026-10-31'
            }))
          }}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Émettre officiellement/i }));

      await waitFor(() => {
        expect(callCount).toBe(1); // Le deuxième lot ne s'est pas lancé
      });
    });

    it('76. Affiche un libellé métier pour due_date = null sans produire "Invalid Date"', () => {
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={2}
          initialPreview={{
            ...samplePreviewPayload,
            eligible_invoices: [
              {
                invoice_id: 'a9000000-0000-4000-a000-000000000001',
                student_number: 'ELV-001',
                student_name: 'Pierre Tshilombo',
                class_name: 'Classe 1A',
                amount: 150.00,
                currency: 'USD',
                due_date: null
              }
            ]
          }}
        />
      );

      expect(screen.getByText('Aucune échéance définie')).toBeInTheDocument();
      expect(screen.queryByText(/Invalid Date/i)).toBeNull();
    });

    it('77. Normalise la réponse de prévisualisation lorsque reason_code est un code custom serveur', () => {
      const rawPayload = {
        ...samplePreviewPayload,
        excluded_invoices: [
          {
            invoice_id: 'd1000000-0000-4000-a000-000000000001',
            student_number: 'ELV-999',
            student_name: 'Futur Élève',
            reason_code: 'custom_future_backend_code',
            reason_label: 'Code serveur futur valide'
          }
        ]
      };

      const parsed = validateBulkIssuePreviewResult(rawPayload);
      expect(parsed.excluded_invoices[0].reason_code).toBe('custom_future_backend_code');
      expect(parsed.excluded_invoices[0].reason_label).toBe('Code serveur futur valide');
    });

    it('78. Distingue explicitement la réponse d’émission entre success et failure sans modifier la clé', async () => {
      let sentKey = '';
      vi.spyOn(supabase, 'rpc').mockImplementation((async (_fn: any, args: any) => {
        sentKey = args.p_batch_issue_idempotency_key;
        return { data: sampleExecutionPayload, error: null };
      }) as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={3}
          initialPreview={samplePreviewPayload}
        />
      );

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Émettre officiellement/i }));

      await waitFor(() => {
        expect(sentKey).toMatch(/^bulk-issue-/);
      });
    });

    // =========================================================================
    // SECTION 8 : TESTS V3 — CORRECTION DE TYPES ET CYCLE BEFOREUNLOAD (10 TESTS)
    // =========================================================================
    it('79. Rejette un statut "draft" dans existing_invoices', () => {
      const bad = {
        ...sampleExecutionPayload,
        existing_invoices: [
          {
            invoice_id: 'a9000000-0000-4000-a000-000000000001',
            status: 'draft'
          }
        ]
      };
      expect(() => validateBulkIssueExecutionResult(bad)).toThrow(/Statut invalide dans la facture existante/);
    });

    it('80. Rejette un statut "unknown" dans existing_invoices', () => {
      const bad = {
        ...sampleExecutionPayload,
        existing_invoices: [
          {
            invoice_id: 'a9000000-0000-4000-a000-000000000001',
            status: 'unknown'
          }
        ]
      };
      expect(() => validateBulkIssueExecutionResult(bad)).toThrow(/Statut invalide dans la facture existante/);
    });

    it('81. Accepte un reason_code futur non vide avec son reason_label serveur', () => {
      const raw = {
        ...samplePreviewPayload,
        excluded_invoices: [
          {
            invoice_id: 'd1000000-0000-4000-a000-000000000001',
            reason_code: 'future_server_reason_code_v4',
            reason_label: 'Libellé spécifique backend V4'
          }
        ]
      };
      const parsed = validateBulkIssuePreviewResult(raw);
      expect(parsed.excluded_invoices[0].reason_code).toBe('future_server_reason_code_v4');
      expect(parsed.excluded_invoices[0].reason_label).toBe('Libellé spécifique backend V4');
    });

    it('82. Rejette un reason_code vide dans le parseur', () => {
      const bad = {
        ...samplePreviewPayload,
        excluded_invoices: [
          {
            invoice_id: 'd1000000-0000-4000-a000-000000000001',
            reason_code: '   '
          }
        ]
      };
      expect(() => validateBulkIssuePreviewResult(bad)).toThrow(/reason_code obligatoire non vide/);
    });

    it('83. Mantient beforeunload actif en état failed_ambiguous', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={4}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 500,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: [
              {
                segment_index: 1,
                total_segments: 1,
                invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
                idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000001',
                status: 'failed_ambiguous',
                error_message: 'Délai réseau 504',
                error_type: 'ambiguous'
              }
            ]
          }}
        />
      );

      expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('84. Conserve beforeunload après un 504 tant qu’aucun retry/abandon n’a eu lieu', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={4}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 500,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: [
              {
                segment_index: 1,
                total_segments: 1,
                invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
                idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000001',
                status: 'failed_ambiguous',
                error_message: '504 Gateway Timeout',
                error_type: 'ambiguous'
              }
            ]
          }}
        />
      );

      expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('85. Retire beforeunload après un retry réussi', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: sampleExecutionPayload,
        error: null
      } as any);

      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={4}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 2,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: [
              {
                segment_index: 1,
                total_segments: 1,
                invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
                idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000001',
                status: 'failed_ambiguous',
                error_message: 'Erreur réseau temporaire',
                error_type: 'ambiguous'
              }
            ]
          }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Réessayer ce lot/i }));

      await waitFor(() => {
        expect(screen.getByText(/Émission Groupée Terminée avec Succès/i)).toBeInTheDocument();
        expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
      });
    });

    it('86. Retire beforeunload après abandon confirmé', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const onClose = vi.fn();
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={onClose}
          initialStep={4}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 500,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: [
              {
                segment_index: 1,
                total_segments: 1,
                invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
                idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000001',
                status: 'failed_ambiguous',
                error_message: '504 Gateway Timeout',
                error_type: 'ambiguous'
              }
            ]
          }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Abandonner le suivi/i }));
      fireEvent.click(screen.getByRole('button', { name: /Abandonner le suivi et rapprocher plus tard/i }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('87. Ne maintient pas beforeunload actif lors d’une erreur définitive uniquement', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      render(
        <BulkIssueInvoiceModal
          isOpen={true}
          onClose={vi.fn()}
          initialStep={4}
          initialExecutionState={{
            overall_status: 'partially_failed',
            total_invoices: 500,
            total_segments: 1,
            completed_segments_count: 0,
            issued_count_total: 0,
            segments: [
              {
                segment_index: 1,
                total_segments: 1,
                invoice_ids: ['a9000000-0000-4000-a000-000000000001'],
                idempotency_key: 'bulk-issue-20261002-a9000000-0000-4000-a000-000000000001',
                status: 'failed_definitive',
                error_message: 'REJET 22023: Empreinte invalide',
                error_type: 'definitive'
              }
            ]
          }}
        />
      );

      expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('88. Reconnait l’état "abandoned" dans le contrat TypeScript et l’état global', () => {
      const state: SegmentedBulkIssueState = {
        overall_status: 'abandoned',
        total_invoices: 500,
        total_segments: 1,
        completed_segments_count: 0,
        issued_count_total: 0,
        segments: []
      };
      expect(state.overall_status).toBe('abandoned');
    });
  });

  describe('89-94. Tests du sélecteur de tarifs dans BulkIssueInvoiceModal (Lot 2K-FIN-BULK-ISSUE-FEE-SELECTOR-F)', () => {
    it('89. Affiche un état de chargement pendant la récupération des tarifs', async () => {
      let resolvePromise: (val: any) => void = () => {};
      const promise = new Promise((resolve) => { resolvePromise = resolve; });
      const mock: any = {};
      mock.select = vi.fn().mockReturnValue(mock);
      mock.eq = vi.fn().mockReturnValue(mock);
      mock.order = vi.fn().mockImplementation(() => promise);
      vi.mocked(supabase.from).mockReturnValueOnce(mock);

      render(<BulkIssueInvoiceModal isOpen={true} onClose={vi.fn()} schoolId="school-123" />);
      expect(screen.getByText(/Chargement des tarifs en cours.../i)).toBeInTheDocument();
      await act(async () => {
        resolvePromise({ data: [], error: null });
        await promise;
      });
    });

    it('90. Affiche un état d’erreur explicite avec bouton Réessayer si Supabase échoue', async () => {
      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS Permission Denied' } })
      };
      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery);

      render(<BulkIssueInvoiceModal isOpen={true} onClose={vi.fn()} schoolId="school-123" />);

      await waitFor(() => {
        expect(screen.getByText(/Erreur de chargement des tarifs/i)).toBeInTheDocument();
        expect(screen.getByText(/Impossible de charger la liste des tarifs./i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Réessayer/i })).toBeInTheDocument();
      });
    });

    it('91. Affiche un état liste vide si aucun tarif actif n’est trouvé', async () => {
      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      };
      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery);

      render(<BulkIssueInvoiceModal isOpen={true} onClose={vi.fn()} schoolId="school-123" />);

      await waitFor(() => {
        expect(screen.getByText(/Aucun tarif actif trouvé/i)).toBeInTheDocument();
      });
    });

    it('92. Charge et affiche la liste des tarifs actifs avec leur nom, montant et devise', async () => {
      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            { id: 'fee-001', name: 'TEST MANUEL — Facturation groupée — 03 octobre 2026', amount: 5, currency: 'USD', due_date: '2026-10-31' },
            { id: 'fee-002', name: 'Frais de Minerval T1', amount: 150, currency: 'USD', due_date: null }
          ],
          error: null
        })
      };
      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery);

      const { container } = render(<BulkIssueInvoiceModal isOpen={true} onClose={vi.fn()} schoolId="school-123" />);

      await waitFor(() => {
        const selectEl = container.querySelector('select');
        expect(selectEl).toBeInTheDocument();
        expect(selectEl?.textContent).toContain('TEST MANUEL — Facturation groupée — 03 octobre 2026');
        expect(selectEl?.textContent).toContain('Frais de Minerval T1');
      });
    });

    it('93. N’affiche aucun UUID ou détail d’erreur technique brut dans le DOM', async () => {
      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'PGRST200: Could not find relationship between school_fees and unknown' }
        })
      };
      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery);

      render(<BulkIssueInvoiceModal isOpen={true} onClose={vi.fn()} schoolId="school-123" />);

      await waitFor(() => {
        expect(screen.getByText(/Impossible de charger la liste des tarifs./i)).toBeInTheDocument();
        expect(screen.queryByText(/PGRST200/i)).not.toBeInTheDocument();
      });
    });

    it('94. Utilise la prop fees directement lorsqu’elle est fournie sans refaire d’appel Supabase', async () => {
      const customFees = [
        { id: 'custom-1', name: 'Tarif Test En Mémoire', amount: 10, currency: 'USD' as Currency }
      ];

      const { container } = render(<BulkIssueInvoiceModal isOpen={true} onClose={vi.fn()} fees={customFees} />);

      const selectEl = container.querySelector('select');
      expect(selectEl).toBeInTheDocument();
      expect(selectEl?.textContent).toContain('Tarif Test En Mémoire');
    });

    it('95. Charge les tarifs actifs même si schoolId n’est pas spécifié explicitement (filtrage RLS)', async () => {
      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            { id: 'fee-auto-1', name: 'Tarif RLS Automatique', amount: 25, currency: 'USD' }
          ],
          error: null
        })
      };
      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery);

      const { container } = render(<BulkIssueInvoiceModal isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        const selectEl = container.querySelector('select');
        expect(selectEl).toBeInTheDocument();
        expect(selectEl?.textContent).toContain('Tarif RLS Automatique');
      });
    });

    it('96. Modale ouverte depuis StudentInvoicesModule sans prop fees charge correctement les tarifs', async () => {
      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            { id: 'fee-test-manual', name: 'TEST MANUEL — Facturation groupée — 03 octobre 2026', amount: 5, currency: 'USD' }
          ],
          error: null
        })
      };
      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery);

      const { container } = render(
        <BulkIssueInvoiceModal isOpen={true} onClose={vi.fn()} schoolId="school-456" />
      );

      await waitFor(() => {
        const selectEl = container.querySelector('select');
        expect(selectEl).toBeInTheDocument();
        expect(selectEl?.textContent).toContain('TEST MANUEL — Facturation groupée — 03 octobre 2026');
      });
    });
  });
});
