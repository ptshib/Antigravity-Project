// Fichier : src/components/admin/finance/BulkIssueInvoiceModal.tsx
// Composant Modal d'émission groupée sécurisée et segmentée des factures (Lot 2K-FIN-BULK-ISSUE-F-V2)

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Modal } from '../../common/Modal';
import { useNotifications } from '../../../context/NotificationContext';
import {
  previewBulkIssueStudentInvoices,
  issueBulkStudentInvoices
} from '../../../services/financeService';
import type {
  Currency,
  BulkIssuePreviewResult,
  BulkIssuedInvoice,
  BulkIssueSkippedInvoice,
  BulkIssueSegmentProgress,
  SegmentedBulkIssueState,
  SegmentStatus
} from '../../../types/finance';
import { FormattedAmount } from '../../common/CurrencyBadge';
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Lock,
  RefreshCw,
  Eye,
  FileText,
  AlertCircle,
  HelpCircle,
  XCircle,
  OctagonAlert
} from 'lucide-react';

export interface BulkIssueFeeOption {
  id: string;
  name: string;
  amount: number;
  currency: Currency;
  due_date?: string;
}

export interface BulkIssueInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  // Options d'entrée en mémoire
  sourceBatchKey?: string | null;
  feeId?: string | null;
  invoiceIds?: string[] | null;
  fees?: BulkIssueFeeOption[];
  // Props optionnelles d'override pour les tests & harness visuel
  initialStep?: number;
  initialPreview?: BulkIssuePreviewResult | null;
  initialExecutionState?: SegmentedBulkIssueState | null;
}

export type BulkIssueStep = 1 | 2 | 3 | 4 | 5;

// Helper interne de génération de clé d'idempotence au format strict: bulk-issue-YYYYMMDD-<uuid>
function generateBulkIssueIdempotencyKey(): string {
  const now = new Date();
  const dateStr = now.toISOString().substring(0, 10).replace(/-/g, '');
  const uuidStr = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return `bulk-issue-${dateStr}-${uuidStr}`;
}

// Formatage défensif de la date d'échéance sans jamais produire "Invalid Date"
function formatDueDateDisplay(dueDate: string | null | undefined): string {
  if (!dueDate || typeof dueDate !== 'string' || dueDate.trim() === '') {
    return 'Aucune échéance définie';
  }
  const parsed = Date.parse(dueDate);
  if (isNaN(parsed)) return 'Aucune échéance définie';
  const d = new Date(dueDate);
  if (isNaN(d.getTime())) return 'Aucune échéance définie';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const BulkIssueInvoiceModal: React.FC<BulkIssueInvoiceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  sourceBatchKey: propSourceBatchKey,
  feeId: propFeeId,
  invoiceIds: propInvoiceIds,
  fees: propFees = [],
  initialStep = 1,
  initialPreview = null,
  initialExecutionState = null
}) => {
  const { showToast } = useNotifications();

  // Étape courante (1: Sélection, 2: Prévisualisation, 3: Confirmation, 4: Progression, 5: Résultat)
  const [step, setStep] = useState<BulkIssueStep>(initialStep as BulkIssueStep);

  // État de sélection
  const [selectedFeeId, setSelectedFeeId] = useState<string>(propFeeId || '');
  const [manualInvoiceIds, setManualInvoiceIds] = useState<string[]>(propInvoiceIds || []);
  const [inMemoryBatchKey, setInMemoryBatchKey] = useState<string | null>(propSourceBatchKey || null);

  // Chargement et prévisualisation
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<BulkIssuePreviewResult | null>(initialPreview);
  const [activeTab, setActiveTab] = useState<'eligible' | 'excluded'>('eligible');

  // Étape 3 - Confirmation
  const [isConfirmedCheckbox, setIsConfirmedCheckbox] = useState<boolean>(false);

  // Vue de confirmation d'abandon explicite après erreur ambiguë
  const [isAbandonConfirming, setIsAbandonConfirming] = useState<boolean>(false);

  // Verrous et références de montage
  const isSubmittingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const abandonRequestedRef = useRef<boolean>(false);

  // État d'exécution segmentée (Étape 4 & 5)
  const [segmentedState, setSegmentedState] = useState<SegmentedBulkIssueState>(
    initialExecutionState || {
      overall_status: 'idle',
      total_invoices: 0,
      total_segments: 0,
      completed_segments_count: 0,
      issued_count_total: 0,
      segments: []
    }
  );

  // Clés d'idempotence conservées en mémoire uniquement
  const segmentKeysRef = useRef<Map<number, string>>(new Map());

  // Suivi du montage et de beforeunload
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const hasAmbiguousError = segmentedState.segments.some(s => s.status === 'failed_ambiguous');
    const isExecuting = segmentedState.overall_status === 'executing';
    const isAmbiguousPending = hasAmbiguousError && segmentedState.overall_status !== 'abandoned' && segmentedState.overall_status !== 'completed';

    if (isExecuting || isAmbiguousPending) {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        const msg = isExecuting
          ? 'L’émission est en cours. Veuillez attendre la fin du lot actif.'
          : 'Un lot possède un résultat réseau incertain. Réessayez avec la même clé ou confirmez explicitement l’abandon avant de fermer ou recharger cette page.';
        e.returnValue = msg;
        return msg;
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  }, [segmentedState.overall_status, segmentedState.segments]);

  // Réinitialisation lors de l'ouverture
  useEffect(() => {
    if (isOpen) {
      setStep(initialStep as BulkIssueStep);
      setSelectedFeeId(propFeeId || '');
      setManualInvoiceIds(propInvoiceIds || []);
      setInMemoryBatchKey(propSourceBatchKey || null);
      setIsLoadingPreview(false);
      setPreviewError(null);
      setPreviewData(initialPreview);
      setIsConfirmedCheckbox(false);
      setIsAbandonConfirming(false);
      isSubmittingRef.current = false;
      abandonRequestedRef.current = false;
      segmentKeysRef.current.clear();

      if (initialExecutionState) {
        setSegmentedState(initialExecutionState);
      } else {
        setSegmentedState({
          overall_status: 'idle',
          total_invoices: 0,
          total_segments: 0,
          completed_segments_count: 0,
          issued_count_total: 0,
          segments: []
        });
      }

      if ((propSourceBatchKey || propFeeId || (propInvoiceIds && propInvoiceIds.length > 0)) && !initialPreview && initialStep === 1) {
        handleLoadPreview(propSourceBatchKey, propFeeId, propInvoiceIds);
      }
    }
  }, [isOpen, propSourceBatchKey, propFeeId, propInvoiceIds, initialPreview, initialStep, initialExecutionState]);

  // Lancement de la prévisualisation RPC
  const handleLoadPreview = async (
    bKey?: string | null,
    fId?: string | null,
    invIds?: string[] | null
  ) => {
    const keyToUse = bKey !== undefined ? bKey : inMemoryBatchKey;
    const feeToUse = fId !== undefined ? fId : selectedFeeId;
    const idsToUse = invIds !== undefined ? invIds : manualInvoiceIds;

    setIsLoadingPreview(true);
    setPreviewError(null);

    try {
      const { result, error } = await previewBulkIssueStudentInvoices({
        p_source_batch_key: keyToUse,
        p_fee_id: feeToUse || null,
        p_invoice_ids: idsToUse && idsToUse.length > 0 ? idsToUse : null
      });

      if (!isMountedRef.current) return;

      if (error) {
        setPreviewError(error.message);
        showToast(error.message, 'urgent');
      } else if (result) {
        setPreviewData(result);
        setStep(2);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Erreur lors de la prévisualisation de l’émission.';
      setPreviewError(msg);
      showToast(msg, 'urgent');
    } finally {
      if (isMountedRef.current) {
        setIsLoadingPreview(false);
      }
    }
  };

  // Réinitialisation de la prévisualisation si la sélection change à l'étape 1
  const handleFeeSelectionChange = (feeId: string) => {
    setSelectedFeeId(feeId);
    setInMemoryBatchKey(null);
    setManualInvoiceIds([]);
    setPreviewData(null);
  };

  // Lancement effectif de l'émission segmentée à l'étape 3
  const handleConfirmAndStartIssuance = async () => {
    if (!previewData || previewData.summary.eligible === 0 || !isConfirmedCheckbox) {
      return;
    }

    if (isSubmittingRef.current) {
      return; // Bloquer double-clic synchrone
    }

    isSubmittingRef.current = true;
    abandonRequestedRef.current = false;
    setStep(4);

    const eligibleInvoices = previewData.eligible_invoices;
    const totalEligible = eligibleInvoices.length;
    const chunkSize = 500;
    const numSegments = Math.ceil(totalEligible / chunkSize);

    // Préparation des segments
    const initialSegments: BulkIssueSegmentProgress[] = [];
    for (let i = 0; i < numSegments; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalEligible);
      const segmentInvoiceIds = eligibleInvoices.slice(start, end).map(inv => inv.invoice_id);

      if (!segmentKeysRef.current.has(i)) {
        segmentKeysRef.current.set(i, generateBulkIssueIdempotencyKey());
      }
      const key = segmentKeysRef.current.get(i)!;

      initialSegments.push({
        segment_index: i + 1,
        total_segments: numSegments,
        invoice_ids: segmentInvoiceIds,
        idempotency_key: key,
        status: 'pending',
        error_message: null,
        error_type: null,
        result: null
      });
    }

    setSegmentedState({
      overall_status: 'executing',
      total_invoices: totalEligible,
      total_segments: numSegments,
      completed_segments_count: 0,
      issued_count_total: 0,
      segments: initialSegments
    });

    await runSegmentsSequentially(initialSegments, 0);
  };

  // Exécution séquentielle boucle contrôlée avec protection contre le démontage et abandon
  const runSegmentsSequentially = async (
    currentSegments: BulkIssueSegmentProgress[],
    startIndex: number
  ) => {
    let completedCount = currentSegments.filter(s => s.status === 'completed').length;
    let issuedTotal = currentSegments.reduce((acc, s) => acc + (s.result?.summary.issued || 0), 0);

    const segmentsState = [...currentSegments];

    for (let i = startIndex; i < segmentsState.length; i++) {
      if (!isMountedRef.current || abandonRequestedRef.current) return;

      const seg = segmentsState[i];
      if (seg.status === 'completed') {
        continue;
      }

      // Marquer segment en cours
      segmentsState[i] = { ...seg, status: 'in_progress', error_message: null, error_type: null };
      if (isMountedRef.current && !abandonRequestedRef.current) {
        setSegmentedState({
          overall_status: 'executing',
          total_invoices: previewData?.summary.eligible || 0,
          total_segments: segmentsState.length,
          completed_segments_count: completedCount,
          issued_count_total: issuedTotal,
          segments: [...segmentsState]
        });
      }

      try {
        const { result, error } = await issueBulkStudentInvoices({
          p_invoice_ids: seg.invoice_ids,
          p_batch_issue_idempotency_key: seg.idempotency_key
        });

        if (!isMountedRef.current || abandonRequestedRef.current) return;

        if (error) {
          const errType = error.error_type || (error.message.toLowerCase().includes('504') || error.message.toLowerCase().includes('timeout') ? 'ambiguous' : 'definitive');
          const segStatus: SegmentStatus = errType === 'ambiguous' ? 'failed_ambiguous' : 'failed_definitive';

          segmentsState[i] = {
            ...seg,
            status: segStatus,
            error_message: error.message,
            error_type: errType
          };
          setSegmentedState({
            overall_status: 'partially_failed',
            total_invoices: previewData?.summary.eligible || 0,
            total_segments: segmentsState.length,
            completed_segments_count: completedCount,
            issued_count_total: issuedTotal,
            segments: [...segmentsState]
          });
          isSubmittingRef.current = false;
          showToast(`Erreur lors du lot ${i + 1}/${segmentsState.length} : ${error.message}`, 'urgent');
          return; // Arrêter les segments suivants en cas d'échec
        }

        if (result) {
          const newlyIssued = result.summary.issued;
          completedCount += 1;
          issuedTotal += newlyIssued;

          segmentsState[i] = {
            ...seg,
            status: 'completed',
            result
          };

          if (isMountedRef.current && !abandonRequestedRef.current) {
            setSegmentedState({
              overall_status: 'executing',
              total_invoices: previewData?.summary.eligible || 0,
              total_segments: segmentsState.length,
              completed_segments_count: completedCount,
              issued_count_total: issuedTotal,
              segments: [...segmentsState]
            });
          }
        }
      } catch (err: unknown) {
        if (!isMountedRef.current || abandonRequestedRef.current) return;

        const msg = err instanceof Error ? err.message : 'Erreur réseau ou délai d’attente dépassé.';
        const errType = msg.toLowerCase().includes('504') || msg.toLowerCase().includes('timeout') ? 'ambiguous' : 'definitive';
        const segStatus: SegmentStatus = errType === 'ambiguous' ? 'failed_ambiguous' : 'failed_definitive';

        segmentsState[i] = {
          ...seg,
          status: segStatus,
          error_message: msg,
          error_type: errType
        };
        setSegmentedState({
          overall_status: 'partially_failed',
          total_invoices: previewData?.summary.eligible || 0,
          total_segments: segmentsState.length,
          completed_segments_count: completedCount,
          issued_count_total: issuedTotal,
          segments: [...segmentsState]
        });
        isSubmittingRef.current = false;
        showToast(`Erreur au lot ${i + 1} : ${msg}`, 'urgent');
        return;
      }
    }

    if (isMountedRef.current && !abandonRequestedRef.current) {
      setSegmentedState({
        overall_status: 'completed',
        total_invoices: previewData?.summary.eligible || 0,
        total_segments: segmentsState.length,
        completed_segments_count: completedCount,
        issued_count_total: issuedTotal,
        segments: [...segmentsState]
      });
      isSubmittingRef.current = false;
      setStep(5);
    }
  };

  // Reprise du segment en erreur
  const handleRetryFailedSegment = async () => {
    const failedIndex = segmentedState.segments.findIndex(
      s => s.status === 'failed_ambiguous' || s.status === 'failed_definitive' || (s.status as string) === 'failed'
    );
    if (failedIndex === -1) return;

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    abandonRequestedRef.current = false;

    setStep(4);
    await runSegmentsSequentially(segmentedState.segments, failedIndex);
  };

  // Traitement d'abandon explicite du suivi
  const handleConfirmExplicitAbandon = () => {
    abandonRequestedRef.current = true;
    isSubmittingRef.current = false;
    segmentKeysRef.current.clear();
    setSegmentedState(prev => ({ ...prev, overall_status: 'abandoned' }));
    setIsAbandonConfirming(false);
    onClose();
  };

  // Fermeture sécurisée de la modale
  const handleSafeClose = () => {
    // 1. Bloquer strictement pendant l'exécution active
    if (segmentedState.overall_status === 'executing' || isSubmittingRef.current) {
      showToast('L’émission est en cours. Veuillez attendre la fin du lot actif.', 'warning');
      return;
    }

    // 2. Bloquer après une erreur ambiguë tant que l'utilisateur n'a pas choisi d'abandonner explicitement
    const hasAmbiguousSegment = segmentedState.segments.some(s => s.status === 'failed_ambiguous');
    if (hasAmbiguousSegment && segmentedState.overall_status !== 'abandoned' && segmentedState.overall_status !== 'completed') {
      showToast('Un lot possède un résultat réseau incertain. Réessayez avec la même clé ou confirmez explicitement l’abandon avant de fermer ou recharger cette page.', 'warning');
      setIsAbandonConfirming(true);
      return;
    }

    // 3. Fermeture normale autorisée (erreur définitive, abandon confirmé ou fin complète)
    onClose();
  };

  // Calcul du résumé agrégé pour l'étape 5
  const finalAggregatedSummary = useMemo(() => {
    let totalSelected = previewData?.summary.selected || 0;
    let totalIssued = 0;
    let totalExisting = 0;
    let totalSkipped = previewData?.summary.already_issued || 0;
    let allIssuedInvoices: BulkIssuedInvoice[] = [];
    let allSkippedInvoices: BulkIssueSkippedInvoice[] = [];

    segmentedState.segments.forEach(seg => {
      if (seg.result) {
        totalIssued += seg.result.summary.issued;
        totalExisting += seg.result.summary.existing;
        totalSkipped += seg.result.summary.skipped;
        allIssuedInvoices = allIssuedInvoices.concat(seg.result.issued_invoices);
        allSkippedInvoices = allSkippedInvoices.concat(seg.result.skipped_invoices);
      }
    });

    if (previewData?.excluded_invoices) {
      previewData.excluded_invoices.forEach(exc => {
        allSkippedInvoices.push({
          invoice_id: exc.invoice_id,
          student_number: exc.student_number,
          student_name: exc.student_name,
          reason_code: exc.reason_code,
          reason_label: exc.reason_label
        });
      });
    }

    return {
      totalSelected,
      totalIssued,
      totalExisting,
      totalSkipped,
      allIssuedInvoices,
      allSkippedInvoices
    };
  }, [previewData, segmentedState]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleSafeClose}
      title="Émission Groupée Officielle de Factures"
      maxWidth="4xl"
    >
      <div className="space-y-6 text-slate-800">
        {/* Banner d'avertissement fermeture bloquée pendant exécution */}
        {segmentedState.overall_status === 'executing' && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 font-semibold flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span>L’émission est en cours. Veuillez attendre la fin du lot actif.</span>
          </div>
        )}

        {/* Vue de confirmation d'abandon explicite */}
        {isAbandonConfirming && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <OctagonAlert className="h-6 w-6 text-rose-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-base font-bold text-rose-950">Abandon du suivi de l’émission groupée</h4>
                <p className="mt-2 text-sm text-rose-900 leading-relaxed">
                  Le serveur a peut-être terminé ce lot malgré l’erreur réseau.
                  En abandonnant le suivi, aucune nouvelle émission ne sera lancée.
                  Lors de la prochaine ouverture, une nouvelle prévisualisation
                  permettra d’identifier les factures déjà émises et les brouillons restants.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsAbandonConfirming(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Revenir au lot interrompu
              </button>
              <button
                type="button"
                onClick={handleConfirmExplicitAbandon}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 transition-colors"
              >
                Abandonner le suivi et rapprocher plus tard
              </button>
            </div>
          </div>
        )}

        {/* Barre d'étapes (Wizard Step Progress Bar) */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center space-x-2">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              1
            </span>
            <span className={`text-sm font-medium ${step === 1 ? 'text-indigo-600 font-semibold' : 'text-slate-600'}`}>Sélection</span>
          </div>
          <div className="h-0.5 w-6 bg-slate-200" />
          <div className="flex items-center space-x-2">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              2
            </span>
            <span className={`text-sm font-medium ${step === 2 ? 'text-indigo-600 font-semibold' : 'text-slate-600'}`}>Prévisualisation</span>
          </div>
          <div className="h-0.5 w-6 bg-slate-200" />

          <div className="flex items-center space-x-2">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${step >= 3 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              3
            </span>
            <span className={`text-sm font-medium ${step === 3 ? 'text-indigo-600 font-semibold' : 'text-slate-600'}`}>Confirmation</span>
          </div>
          <div className="h-0.5 w-6 bg-slate-200" />

          <div className="flex items-center space-x-2">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${step >= 4 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              4
            </span>
            <span className={`text-sm font-medium ${step === 4 ? 'text-indigo-600 font-semibold' : 'text-slate-600'}`}>Progression</span>
          </div>
          <div className="h-0.5 w-6 bg-slate-200" />

          <div className="flex items-center space-x-2">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${step === 5 ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              5
            </span>
            <span className={`text-sm font-medium ${step === 5 ? 'text-emerald-600 font-semibold' : 'text-slate-600'}`}>Résultat</span>
          </div>
        </div>

        {/* ÉTAPE 1 — SÉLECTION */}
        {step === 1 && !isAbandonConfirming && (
          <div className="space-y-6">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
              <h3 className="text-base font-semibold text-indigo-950 flex items-center gap-2">
                <FileText className="h-5 w-5 text-indigo-600" />
                Sélection des Brouillons à Émettre
              </h3>
              <p className="mt-1 text-sm text-indigo-900/80">
                Choisissez le groupe de brouillons de factures que vous souhaitez analyser et émettre officiellement.
              </p>
            </div>

            {/* Notification entrée depuis création groupée */}
            {inMemoryBatchKey && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-900">
                      Brouillons du traitement groupé prêts pour prévisualisation
                    </p>
                    <p className="text-xs text-emerald-700">
                      Vous allez analyser et émettre l’ensemble des factures brouillons fraîchement générées.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleLoadPreview(inMemoryBatchKey, null, null)}
                  disabled={isLoadingPreview}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {isLoadingPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  Examiner et émettre
                </button>
              </div>
            )}

            {/* Sélection par Tarif */}
            {!inMemoryBatchKey && (
              <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
                <label className="block text-sm font-semibold text-slate-800">
                  Sélectionner un tarif de référence
                </label>
                <select
                  value={selectedFeeId}
                  onChange={(e) => handleFeeSelectionChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">-- Choisir un tarif --</option>
                  {propFees.map(fee => (
                    <option key={fee.id} value={fee.id}>
                      {fee.name} — {fee.amount} {fee.currency}
                    </option>
                  ))}
                </select>

                <div className="flex justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => handleLoadPreview(null, selectedFeeId, null)}
                    disabled={!selectedFeeId || isLoadingPreview}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors disabled:opacity-50"
                  >
                    {isLoadingPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    Prévisualiser l’émission
                  </button>
                </div>
              </div>
            )}

            {previewError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
                <span>{previewError}</span>
              </div>
            )}
          </div>
        )}

        {/* ÉTAPE 2 — PRÉVISUALISATION */}
        {step === 2 && previewData && !isAbandonConfirming && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-500">Sélectionnées</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{previewData.summary.selected}</p>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <p className="text-xs font-medium text-emerald-700">Éligibles à l’émission</p>
                <p className="mt-1 text-2xl font-bold text-emerald-900">{previewData.summary.eligible}</p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <p className="text-xs font-medium text-amber-700">Déjà Émises</p>
                <p className="mt-1 text-2xl font-bold text-amber-900">{previewData.summary.already_issued}</p>
              </div>

              <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
                <p className="text-xs font-medium text-rose-700">Invalides / Sans ligne</p>
                <p className="mt-1 text-2xl font-bold text-rose-900">{previewData.summary.invalid}</p>
              </div>
            </div>

            {/* Total Financier Estimé */}
            <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 p-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Montant Total Estimé à l’Émission</span>
                <p className="text-xs text-slate-600">Calculé uniquement sur les {previewData.summary.eligible} factures éligibles</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-extrabold text-indigo-950">
                  <FormattedAmount amount={previewData.summary.estimated_total} currency={previewData.summary.currency} />
                </span>
              </div>
            </div>

            {/* Avertissement 0 Éligible */}
            {previewData.summary.eligible === 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold">Aucune facture éligible à l’émission</p>
                  <p className="text-xs text-amber-800">
                    Toutes les factures sélectionnées ont déjà été émises ou possèdent un montant invalide. Vous ne pouvez pas continuer vers l’émission.
                  </p>
                </div>
              </div>
            )}

            {/* Tabs & Listes de Factures (Eligible vs Excluded) */}
            <div className="space-y-3">
              <div className="flex border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setActiveTab('eligible')}
                  className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'eligible' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  Factures Éligibles ({previewData.eligible_invoices.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('excluded')}
                  className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'excluded' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  Exclusions & Ignorées ({previewData.excluded_invoices.length})
                </button>
              </div>

              {activeTab === 'eligible' && (
                <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-medium">N° Élève</th>
                        <th className="px-3 py-2 font-medium">Nom Élève</th>
                        <th className="px-3 py-2 font-medium">Classe</th>
                        <th className="px-3 py-2 font-medium">Montant</th>
                        <th className="px-3 py-2 font-medium">Échéance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewData.eligible_invoices.map((inv, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80">
                          <td className="px-3 py-2 font-mono font-medium text-slate-900">{inv.student_number}</td>
                          <td className="px-3 py-2 font-medium">{inv.student_name}</td>
                          <td className="px-3 py-2 text-slate-600">{inv.class_name}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            <FormattedAmount amount={inv.amount} currency={inv.currency} />
                          </td>
                          <td className="px-3 py-2 text-slate-500">{formatDueDateDisplay(inv.due_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'excluded' && (
                <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-medium">N° Élève</th>
                        <th className="px-3 py-2 font-medium">Nom Élève</th>
                        <th className="px-3 py-2 font-medium">Raison d’exclusion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewData.excluded_invoices.map((exc, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80">
                          <td className="px-3 py-2 font-mono text-slate-600">{exc.student_number || 'N/A'}</td>
                          <td className="px-3 py-2 font-medium text-slate-800">{exc.student_name || 'Élève'}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                              {exc.reason_label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Navigation Étape 2 -> 3 */}
            <div className="flex justify-between border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Retour
              </button>

              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={previewData.summary.eligible === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                Continuer vers la confirmation
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ÉTAPE 3 — CONFIRMATION IRRÉVERSIBLE */}
        {step === 3 && previewData && !isAbandonConfirming && (
          <div className="space-y-6">
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-5 space-y-3">
              <div className="flex items-center space-x-3 text-amber-950">
                <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0" />
                <h3 className="text-base font-bold">Confirmation Officielle et Irréversible</h3>
              </div>

              <p className="text-sm text-amber-900 leading-relaxed font-medium">
                Je confirme l’émission officielle et irréversible de{' '}
                <span className="font-bold underline">{previewData.summary.eligible} facture(s)</span>.
                Après émission, ces factures recevront un numéro officiel formaté{' '}
                <span className="font-mono font-bold">INV-YYYY-XXXXXX</span> et deviendront immédiatement visibles par les parents autorisés dans leur portail ÉcoleLink.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-start space-x-3">
              <HelpCircle className="h-5 w-5 text-slate-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-slate-600 leading-relaxed">
                <p className="font-semibold text-slate-800">Information sur les notifications :</p>
                <p>
                  Cette opération ne transmet pas automatiquement un email, un SMS ou une notification push. L’envoi des rappels de paiement et relances s’effectue séparément depuis le module des campagnes de recouvrement.
                </p>
              </div>
            </div>

            {/* Résumé avant clic final */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Nombre de factures à émettre :</span>
                <span className="font-bold text-slate-900">{previewData.summary.eligible}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Découpage automatique en lots :</span>
                <span className="font-bold text-slate-900">
                  {Math.ceil(previewData.summary.eligible / 500)} lot(s) séquentiel(s) de 500 max
                </span>
              </div>
              <div className="flex justify-between text-slate-600 pt-2 border-t border-slate-100">
                <span className="font-semibold text-slate-900">Montant total engagé :</span>
                <span className="font-extrabold text-indigo-900">
                  <FormattedAmount amount={previewData.summary.estimated_total} currency={previewData.summary.currency} />
                </span>
              </div>
            </div>

            {/* Checkbox d'attestation obligatoire */}
            <label className="flex items-start space-x-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={isConfirmedCheckbox}
                onChange={(e) => setIsConfirmedCheckbox(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 mt-0.5"
              />
              <span className="text-sm font-semibold text-indigo-950 leading-tight">
                J’atteste avoir vérifié les brouillons et je confirme leur émission officielle irréversible.
              </span>
            </label>

            {/* Navigation Étape 3 -> 4 */}
            <div className="flex justify-between border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={isSubmittingRef.current}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Retour à la prévisualisation
              </button>

              <button
                type="button"
                onClick={handleConfirmAndStartIssuance}
                disabled={!isConfirmedCheckbox || previewData.summary.eligible === 0 || isSubmittingRef.current}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {isSubmittingRef.current ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Lancement des lots...
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    Émettre officiellement {previewData.summary.eligible} factures
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ÉTAPE 4 — PROGRESSION SÉQUENTIELLE */}
        {step === 4 && !isAbandonConfirming && (
          <div className="space-y-6 py-4">
            <div className="text-center space-y-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 mb-2">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Émission Officielle en Cours...</h3>
              <p className="text-sm text-slate-600">
                Veuillez patienter pendant l’attribution séquentielle des numéros officiels et la mise à jour des comptes.
              </p>
            </div>

            {/* Barres de progression métier */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="font-semibold text-slate-800">
                  Lot {segmentedState.completed_segments_count + (segmentedState.overall_status === 'executing' ? 1 : 0)} sur {segmentedState.total_segments}
                </span>
                <span className="font-bold text-indigo-900">
                  {segmentedState.issued_count_total} factures émises sur {segmentedState.total_invoices}
                </span>
              </div>

              <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-300 ease-out"
                  style={{
                    width: `${segmentedState.total_invoices > 0 ? (segmentedState.issued_count_total / segmentedState.total_invoices) * 100 : 0}%`
                  }}
                />
              </div>

              <p className="text-xs text-slate-500 text-center italic">
                Ne fermez pas cette fenêtre pendant l’émission du lot actif.
              </p>
            </div>

            {/* En cas d'erreur de segment */}
            {segmentedState.overall_status === 'partially_failed' && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 space-y-3">
                <div className="flex items-center space-x-2 text-rose-900 font-semibold text-sm">
                  <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0" />
                  <span>Arrêt du traitement suite à un problème réseau ou serveur</span>
                </div>

                <p className="text-xs text-rose-800 font-mono bg-rose-100/50 p-2 rounded">
                  {segmentedState.segments.find(s => s.status === 'failed_ambiguous' || s.status === 'failed_definitive' || (s.status as string) === 'failed')?.error_message || 'Une erreur est survenue lors de l’émission d’un lot.'}
                </p>
                <p className="text-xs text-slate-600">
                  Les lots précédemment terminés ({segmentedState.completed_segments_count} lot(s)) sont sécurisés. Vous pouvez relancer uniquement le lot interrompu ou abandonner explicitement.
                </p>

                <div className="flex justify-between items-center pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAbandonConfirming(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <XCircle className="h-4 w-4 text-slate-500" />
                    Abandonner le suivi
                  </button>

                  <button
                    type="button"
                    onClick={handleRetryFailedSegment}
                    className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Réessayer ce lot
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ÉTAPE 5 — RÉSULTAT FINAL */}
        {step === 5 && !isAbandonConfirming && (
          <div className="space-y-6">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 flex items-start space-x-4">
              <CheckCircle2 className="h-7 w-7 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-emerald-950">Émission Groupée Terminée avec Succès</h3>
                <p className="mt-1 text-sm text-emerald-900 leading-relaxed font-medium">
                  Les factures émises sont maintenant officielles et visibles dans le portail des parents autorisés.
                </p>
              </div>
            </div>

            {/* KPI Résultat Agrégé */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-500">Demande Totale</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{finalAggregatedSummary.totalSelected}</p>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <p className="text-xs font-medium text-emerald-700">Factures Émises</p>
                <p className="mt-1 text-2xl font-bold text-emerald-900">{finalAggregatedSummary.totalIssued}</p>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                <p className="text-xs font-medium text-blue-700">Traitées via Rejeu</p>
                <p className="mt-1 text-2xl font-bold text-blue-900">{finalAggregatedSummary.totalExisting}</p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <p className="text-xs font-medium text-amber-700">Ignorées / Exclues</p>
                <p className="mt-1 text-2xl font-bold text-amber-900">{finalAggregatedSummary.totalSkipped}</p>
              </div>
            </div>

            {/* Liste des Factures Émises avec Numéros Officiels */}
            {finalAggregatedSummary.allIssuedInvoices.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Extrait des Factures Émises et Numéros Officiels Attribués
                </h4>
                <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-medium">N° Officiel</th>
                        <th className="px-3 py-2 font-medium">N° Élève</th>
                        <th className="px-3 py-2 font-medium">Nom Élève</th>
                        <th className="px-3 py-2 font-medium">Montant</th>
                        <th className="px-3 py-2 font-medium">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {finalAggregatedSummary.allIssuedInvoices.map((inv, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80">
                          <td className="px-3 py-2 font-mono font-bold text-emerald-700">{inv.invoice_number}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{inv.student_number}</td>
                          <td className="px-3 py-2 font-medium text-slate-900">{inv.student_name}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            <FormattedAmount amount={inv.amount} currency={inv.currency} />
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                              Émise (issued)
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Bouton de Fermeture Final */}
            <div className="flex justify-end border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => {
                  if (onSuccess) onSuccess();
                  onClose();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors"
              >
                Terminer
              </button>
            </div>
          </div>
        )}

      </div>
    </Modal>
  );
};
