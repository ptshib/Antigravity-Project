// Module Administrateur : Gestion, Génération PDF & Validation des Bulletins Périodiques (Phase 2F.3C)
// Fichier : src/components/admin/AdminReportCardsModule.tsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../common/Modal';
import {
  GraduationCap,
  Filter,
  Search,
  MessageSquare,
  Award,
  RotateCcw,
  Eye,
  FileCheck,
  HelpCircle,
  FileText,
  Download,
  CheckCircle2,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import type {
  ReportCardBatchManagement,
  PeriodReportCardItem,
  SchoolOfficialPrerequisites,
  ReportCardPdfGenerationStatus
} from '../../types/reportCard';
import { getReportCardBatchStatusLabel } from '../../types/reportCard';
import {
  getPdfGenerationStatus,
  generateBatchPdfs,
  publishBatch,
  downloadReportCardPdfBlob
} from '../../services/reportCardPdfService';

interface AdminReportCardsModuleProps {
  classes: any[];
  schoolPeriods: any[];
  schoolTerms: any[];
  teachers: any[];
}

interface BatchSummaryItem {
  id: string;
  class_id: string;
  class_name: string;
  period_id: string;
  period_name: string;
  revision_number: number;
  status: 'draft' | 'submitted_by_homeroom' | 'validated_by_admin' | 'published' | 'superseded';
  total_students_count: number;
  complete_students_count: number;
  incomplete_students_count: number;
  submitted_at: string | null;
  validated_at: string | null;
  published_at: string | null;
  updated_at: string;
}

export const AdminReportCardsModule: React.FC<AdminReportCardsModuleProps> = ({
  classes,
  schoolPeriods,
  schoolTerms: _schoolTerms,
  teachers
}) => {
  const { showToast } = useNotifications();

  // Filters
  const [classFilter, setClassFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Data
  const [loading, setLoading] = useState<boolean>(true);
  const [batchesList, setBatchesList] = useState<BatchSummaryItem[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchDetail, setBatchDetail] = useState<ReportCardBatchManagement | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  // PDF Generation & Publication States (Phase 2F.3C)
  const [pdfGenerationStatus, setPdfGenerationStatus] = useState<ReportCardPdfGenerationStatus | null>(null);
  const [loadingPdfStatus, setLoadingPdfStatus] = useState<boolean>(false);
  const [generatingPdfs, setGeneratingPdfs] = useState<boolean>(false);
  const [showPublishModal, setShowPublishModal] = useState<boolean>(false);
  const [publishingBatch, setPublishingBatch] = useState<boolean>(false);
  const [downloadingCardId, setDownloadingCardId] = useState<string | null>(null);

  // Prerequisites check state
  const [schoolOfficialData, setSchoolOfficialData] = useState<any>(null);

  // Modals
  const [showPrincipalRemarkModal, setShowPrincipalRemarkModal] = useState<boolean>(false);
  const [selectedCardForRemark, setSelectedCardForRemark] = useState<PeriodReportCardItem | null>(null);
  const [principalRemarkText, setPrincipalRemarkText] = useState<string>('');
  const [savingPrincipalRemark, setSavingPrincipalRemark] = useState<boolean>(false);

  const [showValidateModal, setShowValidateModal] = useState<boolean>(false);
  const [validatingBatch, setValidatingBatch] = useState<boolean>(false);

  const [showReturnModal, setShowReturnModal] = useState<boolean>(false);
  const [returnReason, setReturnReason] = useState<string>('');
  const [returningBatch, setReturningBatch] = useState<boolean>(false);

  // Load School Official Data to check prerequisites
  const loadSchoolData = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name, principal_name, director_signature_url, stamp_url')
        .single();

      if (error) throw error;
      if (data) setSchoolOfficialData(data);
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur chargement école:', err);
    }
  }, []);

  // Load Batches List
  const loadBatchesList = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('report_card_batches')
        .select(`
          id, class_id, period_id, revision_number, status,
          total_students_count, complete_students_count, incomplete_students_count,
          submitted_at, validated_at, published_at, updated_at,
          classes:class_id(name),
          school_periods:period_id(name)
        `)
        .order('updated_at', { ascending: false });

      if (classFilter !== 'all') {
        query = query.eq('class_id', classFilter);
      }
      if (periodFilter !== 'all') {
        query = query.eq('period_id', periodFilter);
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const formatted: BatchSummaryItem[] = (data || []).map((b: any) => ({
        id: b.id,
        class_id: b.class_id,
        class_name: b.classes?.name || 'Classe',
        period_id: b.period_id,
        period_name: b.school_periods?.name || 'Période',
        revision_number: b.revision_number,
        status: b.status,
        total_students_count: b.total_students_count || 0,
        complete_students_count: b.complete_students_count || 0,
        incomplete_students_count: b.incomplete_students_count || 0,
        submitted_at: b.submitted_at,
        validated_at: b.validated_at,
        published_at: b.published_at,
        updated_at: b.updated_at
      }));

      setBatchesList(formatted);
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur chargement lots:', err);
      showToast(err.message || 'Erreur lors du chargement des lots de bulletins.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [classFilter, periodFilter, statusFilter, showToast]);

  useEffect(() => {
    loadSchoolData();
    loadBatchesList();
  }, [loadSchoolData, loadBatchesList]);

  // Load PDF Generation Status via service
  const loadPdfStatus = useCallback(async (batchId: string) => {
    setLoadingPdfStatus(true);
    try {
      const status = await getPdfGenerationStatus(batchId);
      setPdfGenerationStatus(status);
    } catch (err: any) {
      console.warn('[AdminReportCardsModule] Information statut PDF:', err.message);
      setPdfGenerationStatus(null);
    } finally {
      setLoadingPdfStatus(false);
    }
  }, []);

  // Load Full Batch Details via RPC get_report_card_for_management
  const handleOpenBatchDetail = useCallback(async (batchId: string) => {
    setSelectedBatchId(batchId);
    setLoadingDetail(true);
    setBatchDetail(null);
    setPdfGenerationStatus(null);

    try {
      const { data, error } = await supabase.rpc('get_report_card_for_management', {
        p_batch_id: batchId
      });

      if (error) throw error;

      if (data) {
        const batch = data as ReportCardBatchManagement;
        setBatchDetail(batch);

        if (batch.status === 'validated_by_admin' || batch.status === 'published') {
          await loadPdfStatus(batchId);
        }
      }
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur détails lot:', err);
      showToast(err.message || 'Échec du chargement des détails du lot.', 'warning');
    } finally {
      setLoadingDetail(false);
    }
  }, [loadPdfStatus, showToast]);

  // Check Prerequisites for the Selected Batch
  const batchPrerequisites: SchoolOfficialPrerequisites = useMemo(() => {
    if (!batchDetail) {
      return {
        hasPrincipalName: false,
        hasDirectorSignature: false,
        hasStamp: false,
        hasHomeroomTeacher: false,
        hasHomeroomSignature: false,
        isReadyForValidation: false
      };
    }

    const currentClass = classes.find(c => c.id === batchDetail.class_id);
    const homeroomTeacher = teachers.find(
      t => t.profile_id === currentClass?.homeroom_teacher_id
    );

    const hasPrincipalName = Boolean(schoolOfficialData?.principal_name?.trim());
    const hasDirectorSignature = Boolean(schoolOfficialData?.director_signature_url);
    const hasStamp = Boolean(schoolOfficialData?.stamp_url);
    const hasHomeroomTeacher = Boolean(currentClass?.homeroom_teacher_id && homeroomTeacher);
    const hasHomeroomSignature = Boolean(homeroomTeacher?.signature_url);

    const isReadyForValidation =
      hasPrincipalName &&
      hasDirectorSignature &&
      hasStamp &&
      hasHomeroomTeacher &&
      hasHomeroomSignature;

    return {
      hasPrincipalName,
      hasDirectorSignature,
      hasStamp,
      hasHomeroomTeacher,
      hasHomeroomSignature,
      isReadyForValidation
    };
  }, [batchDetail, classes, teachers, schoolOfficialData]);

  // Open Remark Modal
  const handleOpenRemarkModal = (card: PeriodReportCardItem) => {
    setSelectedCardForRemark(card);
    setPrincipalRemarkText(card.principal_remarks || '');
    setShowPrincipalRemarkModal(true);
  };

  // Save Principal Remark via RPC save_report_card_remarks
  const handleSavePrincipalRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCardForRemark || !selectedBatchId) return;

    setSavingPrincipalRemark(true);
    try {
      const { error } = await supabase.rpc('save_report_card_remarks', {
        p_report_card_id: selectedCardForRemark.report_card_id,
        p_homeroom_remarks: null,
        p_conduct_grade: null,
        p_principal_remarks: principalRemarkText.trim() || null,
        p_subject_remarks: null
      });

      if (error) throw error;

      showToast('Appréciation de direction enregistrée avec succès.', 'success');
      setShowPrincipalRemarkModal(false);
      await handleOpenBatchDetail(selectedBatchId);
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur remark direction:', err);
      showToast(err.message || 'Erreur lors de l’enregistrement de l’appréciation.', 'warning');
    } finally {
      setSavingPrincipalRemark(false);
    }
  };

  // Validate Batch via RPC validate_report_card_batch
  const handleValidateBatch = async () => {
    if (!selectedBatchId) return;

    setValidatingBatch(true);
    try {
      const { error } = await supabase.rpc('validate_report_card_batch', {
        p_batch_id: selectedBatchId
      });

      if (error) throw error;

      showToast('Lot de bulletins validé administrativement avec succès.', 'success');
      setShowValidateModal(false);
      await loadBatchesList();
      await handleOpenBatchDetail(selectedBatchId);
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur validation lot:', err);
      showToast(err.message || 'Échec de la validation administrative.', 'warning');
    } finally {
      setValidatingBatch(false);
    }
  };

  // Return to Draft via RPC return_report_card_batch_to_draft
  const handleReturnToDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatchId) return;

    if (returnReason.trim().length < 5) {
      showToast('Le motif de renvoi en brouillon doit comporter au moins 5 caractères.', 'warning');
      return;
    }

    setReturningBatch(true);
    try {
      const { error } = await supabase.rpc('return_report_card_batch_to_draft', {
        p_batch_id: selectedBatchId,
        p_reason: returnReason.trim()
      });

      if (error) throw error;

      showToast('Lot de bulletins renvoyé en statut Brouillon pour correction par le titulaire.', 'success');
      setShowReturnModal(false);
      setReturnReason('');
      await loadBatchesList();
      await handleOpenBatchDetail(selectedBatchId);
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur renvoi draft:', err);
      showToast(err.message || 'Échec du renvoi en brouillon.', 'warning');
    } finally {
      setReturningBatch(false);
    }
  };

  // Trigger PDF Generation via Edge Function (Phase 2F.3C)
  const handleGeneratePdfs = async () => {
    if (!selectedBatchId || generatingPdfs || publishingBatch) return;

    if (batchDetail?.status !== 'validated_by_admin') {
      showToast('Seul un lot validé par la direction permet la génération des PDF.', 'warning');
      return;
    }

    setGeneratingPdfs(true);
    try {
      const response = await generateBatchPdfs(selectedBatchId);

      if (response.partial_success) {
        showToast(
          `Génération partielle : ${response.generated_count} générés, ${response.failed_count} en échec.`,
          'warning'
        );
      } else {
        showToast(
          `Succès : ${response.generated_count} bulletins PDF générés (${response.skipped_count} conservés conformes).`,
          'success'
        );
      }

      await handleOpenBatchDetail(selectedBatchId);
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur génération PDF:', err);
      showToast(err.message || 'Erreur lors de la génération des PDF du lot.', 'warning');
      if (selectedBatchId) {
        await loadPdfStatus(selectedBatchId);
      }
    } finally {
      setGeneratingPdfs(false);
    }
  };

  // Trigger Batch Publication via RPC (Phase 2F.3C)
  const handlePublishBatch = async () => {
    if (!selectedBatchId || publishingBatch || generatingPdfs) return;

    if (batchDetail?.status !== 'validated_by_admin') {
      showToast('Seul un lot validé par la direction peut être publié.', 'warning');
      return;
    }

    if (!pdfGenerationStatus?.can_publish) {
      showToast('Impossible de publier : la génération de tous les PDF conformes est requise.', 'warning');
      return;
    }

    setPublishingBatch(true);
    try {
      // Re-vérification stricte du statut PDF juste avant l'appel RPC (Fail-closed)
      const freshStatus = await getPdfGenerationStatus(selectedBatchId);
      setPdfGenerationStatus(freshStatus);

      if (!freshStatus.can_publish) {
        showToast(
          `Publication annulée : ${freshStatus.missing_pdfs + freshStatus.invalid_pdfs + freshStatus.outdated_pdfs} bulletin(s) non prêts.`,
          'warning'
        );
        setShowPublishModal(false);
        return;
      }

      await publishBatch(selectedBatchId);

      showToast(
        'Lot de bulletins publié officiellement avec succès ! Les élèves et parents ont maintenant accès à leurs bulletins signés.',
        'success'
      );
      setShowPublishModal(false);
      await loadBatchesList();
      await handleOpenBatchDetail(selectedBatchId);
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur publication lot:', err);
      showToast(err.message || 'Échec de la publication officielle.', 'warning');
    } finally {
      setPublishingBatch(false);
    }
  };

  // Trigger Single PDF Download for Admin Inspection
  const handleDownloadPdf = async (card: PeriodReportCardItem) => {
    if (!card.pdf_storage_path || downloadingCardId) return;

    setDownloadingCardId(card.report_card_id);
    try {
      const cleanStudentName = card.student_name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Bulletin_${cleanStudentName}_v${card.pdf_version || 1}.pdf`;
      await downloadReportCardPdfBlob(card.pdf_storage_path, filename);
      showToast(`Téléchargement lancé : ${filename}`, 'success');
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur téléchargement PDF:', err);
      showToast(err.message || 'Impossible de télécharger ce bulletin PDF.', 'warning');
    } finally {
      setDownloadingCardId(null);
    }
  };

  // Filtered Cards inside detail view
  const filteredDetailCards = useMemo(() => {
    if (!batchDetail?.report_cards) return [];
    if (!searchQuery.trim()) return batchDetail.report_cards;
    const q = searchQuery.toLowerCase();
    return batchDetail.report_cards.filter(
      c =>
        c.student_name.toLowerCase().includes(q) ||
        c.student_number.toLowerCase().includes(q)
    );
  }, [batchDetail?.report_cards, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-amber-500" />
            <span>Gestion & Validation des Bulletins Périodiques</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Supervision académique, génération sécurisée des PDF officiels et publication aux élèves et parents.
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-slate-900 p-4 rounded-3xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-bold pl-1">
            <Filter className="w-3.5 h-3.5" />
            <span>Filtres :</span>
          </div>

          {/* Class Filter */}
          <select
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
            className="bg-slate-950 text-white text-xs px-3 py-2 rounded-xl border border-slate-800 focus:outline-none focus:border-amber-500 font-medium"
          >
            <option value="all">Toutes les classes</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Period Filter */}
          <select
            value={periodFilter}
            onChange={e => setPeriodFilter(e.target.value)}
            className="bg-slate-950 text-white text-xs px-3 py-2 rounded-xl border border-slate-800 focus:outline-none focus:border-amber-500 font-medium"
          >
            <option value="all">Toutes les périodes</option>
            {schoolPeriods.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-slate-950 text-white text-xs px-3 py-2 rounded-xl border border-slate-800 focus:outline-none focus:border-amber-500 font-medium"
          >
            <option value="all">Tous les statuts</option>
            <option value="draft">Brouillon</option>
            <option value="submitted_by_homeroom">Soumis par le titulaire</option>
            <option value="validated_by_admin">Validé par la direction</option>
            <option value="published">Publié</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => {
            loadBatchesList();
            if (selectedBatchId) handleOpenBatchDetail(selectedBatchId);
          }}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Actualiser</span>
        </button>
      </div>

      {/* Main Grid: Batches List (Left) & Batch Detail (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Batches List */}
        <div className={selectedBatchId ? 'lg:col-span-4 space-y-3' : 'lg:col-span-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'}>
          {loading ? (
            <div className="col-span-full p-8 text-center bg-slate-900 rounded-3xl border border-slate-800 text-slate-400 text-xs">
              Chargement des lots de bulletins...
            </div>
          ) : batchesList.length === 0 ? (
            <div className="col-span-full p-8 text-center bg-slate-900 rounded-3xl border border-slate-800 text-slate-400 text-xs">
              Aucun lot de bulletins ne correspond aux filtres sélectionnés.
            </div>
          ) : (
            batchesList.map(batch => {
              const isSelected = selectedBatchId === batch.id;
              return (
                <div
                  key={batch.id}
                  onClick={() => handleOpenBatchDetail(batch.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer space-y-3 ${
                    isSelected
                      ? 'bg-slate-900 border-amber-500/80 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/50'
                      : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-extrabold text-white text-sm">{batch.class_name}</h4>
                      <p className="text-xs text-slate-400">{batch.period_name} • Rév. #{batch.revision_number}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black border uppercase tracking-wider ${
                        batch.status === 'published'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : batch.status === 'validated_by_admin'
                          ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                          : batch.status === 'submitted_by_homeroom'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {getReportCardBatchStatusLabel(batch.status)}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs py-1 bg-slate-950/60 rounded-xl border border-slate-800/50">
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-bold">Total</span>
                      <strong className="text-white font-mono">{batch.total_students_count}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-emerald-500/80 block uppercase font-bold">Complets</span>
                      <strong className="text-emerald-400 font-mono">{batch.complete_students_count}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-amber-500/80 block uppercase font-bold">Incomplets</span>
                      <strong className="text-amber-400 font-mono">{batch.incomplete_students_count}</strong>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Detailed Management Panel */}
        {selectedBatchId && (
          <div className="lg:col-span-8 space-y-6">
            {loadingDetail ? (
              <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
                <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-bold text-slate-400">Chargement des bulletins détaillés...</p>
              </div>
            ) : !batchDetail ? (
              <div className="p-8 text-center bg-slate-900 rounded-3xl border border-slate-800 text-slate-400">
                Sélectionnez un lot pour examiner les bulletins.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Detail Header & Action Panel */}
                <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-black text-white">
                          {batchDetail.class_name} — Révision #{batchDetail.revision_number}
                        </h3>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                          batchDetail.status === 'published'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-slate-800 text-amber-400 border-amber-500/30'
                        }`}>
                          {getReportCardBatchStatusLabel(batchDetail.status)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Effectif : <strong className="text-white">{batchDetail.total_students_count} élèves</strong> • Complets : <strong className="text-emerald-400">{batchDetail.complete_students_count}</strong> • Incomplets : <strong className="text-amber-400">{batchDetail.incomplete_students_count}</strong>
                      </p>
                    </div>

                    {/* Workflow Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Return to draft */}
                      {(batchDetail.status === 'submitted_by_homeroom' || batchDetail.status === 'validated_by_admin') && (
                        <button
                          type="button"
                          onClick={() => {
                            setReturnReason('');
                            setShowReturnModal(true);
                          }}
                          className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Renvoyer en Brouillon</span>
                        </button>
                      )}

                      {/* Validate batch */}
                      {batchDetail.status === 'submitted_by_homeroom' && (
                        <button
                          type="button"
                          disabled={!batchPrerequisites.isReadyForValidation}
                          onClick={() => setShowValidateModal(true)}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-colors disabled:opacity-40"
                          title={!batchPrerequisites.isReadyForValidation ? "Prérequis officiels manquants" : "Valider le lot"}
                        >
                          <FileCheck className="w-4 h-4" />
                          <span>Valider le Lot</span>
                        </button>
                      )}

                      {/* Generate PDFs button (Phase 2F.3C) */}
                      {batchDetail.status === 'validated_by_admin' && (
                        <button
                          type="button"
                          disabled={generatingPdfs || publishingBatch}
                          onClick={handleGeneratePdfs}
                          className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-black rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-colors disabled:opacity-50"
                        >
                          <Sparkles className={`w-4 h-4 ${generatingPdfs ? 'animate-spin' : ''}`} />
                          <span>{generatingPdfs ? 'Génération en cours...' : 'Générer les PDF Officiels'}</span>
                        </button>
                      )}

                      {/* Publish button (Phase 2F.3C) */}
                      {batchDetail.status === 'validated_by_admin' && (
                        <button
                          type="button"
                          disabled={!pdfGenerationStatus?.can_publish || publishingBatch || generatingPdfs}
                          onClick={() => setShowPublishModal(true)}
                          className={`px-4 py-2 font-black rounded-xl text-xs flex items-center gap-1.5 shadow-md transition-colors ${
                            pdfGenerationStatus?.can_publish
                              ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 cursor-pointer'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                          }`}
                          title={
                            pdfGenerationStatus?.can_publish
                              ? 'Publier officiellement les bulletins'
                              : 'La génération complète des PDF est requise avant publication'
                          }
                        >
                          <Award className="w-4 h-4" />
                          <span>{publishingBatch ? 'Publication...' : 'Publier les Bulletins'}</span>
                        </button>
                      )}

                      {/* Published State Banner */}
                      {batchDetail.status === 'published' && (
                        <div className="px-3.5 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-bold flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>Lot Officiellement Publié</span>
                          {batchDetail.published_at && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({new Date(batchDetail.published_at).toLocaleDateString('fr-FR')})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Prerequisites Checklist Banner (for draft/submitted) */}
                  {batchDetail.status !== 'published' && (
                    <div className={`p-4 rounded-2xl border ${batchPrerequisites.isReadyForValidation ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-amber-950/20 border-amber-800/40'} text-xs space-y-2`}>
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-slate-300 flex items-center gap-1.5">
                          <HelpCircle className="w-4 h-4 text-amber-400" />
                          <span>Contrôle de conformité officielle pour validation :</span>
                        </span>
                        <span className={`font-black text-[11px] ${batchPrerequisites.isReadyForValidation ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {batchPrerequisites.isReadyForValidation ? 'Conforme pour validation' : 'Éléments bloquants'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
                        <span className={`px-2 py-1 rounded-lg border ${batchPrerequisites.hasPrincipalName ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>
                          {batchPrerequisites.hasPrincipalName ? '✓' : '✗'} Chef d'Établissement
                        </span>
                        <span className={`px-2 py-1 rounded-lg border ${batchPrerequisites.hasDirectorSignature ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>
                          {batchPrerequisites.hasDirectorSignature ? '✓' : '✗'} Signature Direction
                        </span>
                        <span className={`px-2 py-1 rounded-lg border ${batchPrerequisites.hasStamp ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>
                          {batchPrerequisites.hasStamp ? '✓' : '✗'} Cachet Officiel
                        </span>
                        <span className={`px-2 py-1 rounded-lg border ${batchPrerequisites.hasHomeroomTeacher ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>
                          {batchPrerequisites.hasHomeroomTeacher ? '✓' : '✗'} Titulaire Assigné
                        </span>
                        <span className={`px-2 py-1 rounded-lg border ${batchPrerequisites.hasHomeroomSignature ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>
                          {batchPrerequisites.hasHomeroomSignature ? '✓' : '✗'} Signature Titulaire
                        </span>
                      </div>
                    </div>
                  )}

                  {/* PDF Generation Status Card (Phase 2F.3C) */}
                  {(batchDetail.status === 'validated_by_admin' || batchDetail.status === 'published') && (
                    <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-cyan-400" />
                          <span className="font-bold text-white">Statut des Fichiers PDF Officiels</span>
                        </div>
                        {loadingPdfStatus ? (
                          <span className="text-[10px] text-slate-400">Actualisation...</span>
                        ) : pdfGenerationStatus ? (
                          (() => {
                            if (batchDetail.status === 'published') {
                              const isFullyReady =
                                pdfGenerationStatus.ready_pdfs === pdfGenerationStatus.total_report_cards &&
                                pdfGenerationStatus.missing_pdfs === 0 &&
                                pdfGenerationStatus.invalid_pdfs === 0 &&
                                pdfGenerationStatus.outdated_pdfs === 0;

                              if (isFullyReady) {
                                return (
                                  <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                    ✓ PDF officiels disponibles
                                  </span>
                                );
                              } else {
                                return (
                                  <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/30">
                                    ⚠ Anomalie documentaire
                                  </span>
                                );
                              }
                            } else {
                              return (
                                <span className={`text-[11px] font-black px-2 py-0.5 rounded-md ${
                                  pdfGenerationStatus.can_publish
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                }`}>
                                  {pdfGenerationStatus.can_publish ? '✓ Prêt pour publication' : 'Génération requise'}
                                </span>
                              );
                            }
                          })()
                        ) : null}
                      </div>

                      {pdfGenerationStatus && (
                        <div className="space-y-2 text-xs">
                          {/* Progress bar */}
                          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-emerald-500 h-full transition-all duration-300"
                              style={{
                                width: `${
                                  pdfGenerationStatus.total_report_cards > 0
                                    ? (pdfGenerationStatus.ready_pdfs / pdfGenerationStatus.total_report_cards) * 100
                                    : 0
                                }%`
                              }}
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-between text-[11px] gap-2 pt-1 text-slate-400">
                            <span>
                              Bulletins conformes : <strong className="text-emerald-400">{pdfGenerationStatus.ready_pdfs} / {pdfGenerationStatus.total_report_cards}</strong>
                            </span>
                            {pdfGenerationStatus.missing_pdfs > 0 && (
                              <span className="text-amber-400 font-medium">
                                • {pdfGenerationStatus.missing_pdfs} manquant(s)
                              </span>
                            )}
                            {pdfGenerationStatus.outdated_pdfs > 0 && (
                              <span className="text-cyan-400 font-medium">
                                • {pdfGenerationStatus.outdated_pdfs} obsolète(s)
                              </span>
                            )}
                            {pdfGenerationStatus.invalid_pdfs > 0 && (
                              <span className="text-rose-400 font-medium">
                                • {pdfGenerationStatus.invalid_pdfs} invalide(s)
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Search & Student Cards Table */}
                <div className="bg-slate-900 rounded-3xl border border-slate-800 p-6 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Rechercher un élève..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <span className="text-xs text-slate-400 font-bold">
                      {filteredDetailCards.length} élèves
                    </span>
                  </div>

                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-800">
                    <table className="w-full text-left text-xs table-auto border-collapse">
                      <thead>
                        <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-extrabold text-[10px]">
                          <th className="p-3 text-center w-16">Rang</th>
                          <th className="p-3 min-w-[160px]">Élève & Matricule</th>
                          <th className="p-3 text-center w-24">Moyenne</th>
                          <th className="p-3 min-w-[180px] max-w-[280px]">Appréciation Direction</th>
                          <th className="p-3 text-center w-36">Document PDF</th>
                          <th className="p-3 text-right w-24">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 font-medium bg-slate-950/40">
                        {filteredDetailCards.map(card => {
                          const hasPdf = Boolean(card.pdf_storage_path && card.pdf_version);
                          const isDownloading = downloadingCardId === card.report_card_id;

                          return (
                            <tr key={card.report_card_id} className="hover:bg-slate-800/40 transition-colors">
                              <td className="p-3 text-center">
                                {card.rank ? (
                                  <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 font-mono font-black rounded-lg text-xs inline-block">
                                    #{card.rank}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>

                              <td className="p-3">
                                <p className="font-extrabold text-white text-xs leading-snug">{card.student_name}</p>
                                <span className="font-mono text-slate-500 text-[10px] block">{card.student_number}</span>
                              </td>

                              <td className="p-3 text-center">
                                {card.overall_percentage !== null ? (
                                  <span className={`font-black text-xs ${card.overall_percentage >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {Number(card.overall_percentage).toFixed(1)} %
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>

                              <td className="p-3 min-w-[180px] max-w-[280px]">
                                {card.principal_remarks ? (
                                  <p className="text-amber-300 text-xs break-words whitespace-pre-wrap leading-relaxed font-medium">
                                    {card.principal_remarks}
                                  </p>
                                ) : (
                                  <span className="text-slate-600 italic text-[11px]">En attente de direction</span>
                                )}
                              </td>

                              <td className="p-3 text-center">
                                {hasPdf ? (
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 rounded text-[10px] font-mono font-bold">
                                      v{card.pdf_version}
                                    </span>
                                    <button
                                      type="button"
                                      disabled={isDownloading}
                                      onClick={() => handleDownloadPdf(card)}
                                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                                      title="Télécharger le document PDF officiel"
                                    >
                                      <Download className={`w-3 h-3 ${isDownloading ? 'animate-bounce' : ''}`} />
                                      <span>{isDownloading ? '...' : 'PDF'}</span>
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-500 italic">Non généré</span>
                                )}
                              </td>

                              <td className="p-3 text-right">
                                {batchDetail.status === 'submitted_by_homeroom' ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenRemarkModal(card)}
                                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 ml-auto cursor-pointer transition-colors"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                                    <span>{card.principal_remarks ? 'Modifier' : 'Apprécier'}</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenRemarkModal(card)}
                                    className="px-3 py-1.5 bg-slate-800/60 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 ml-auto transition-colors cursor-pointer"
                                  >
                                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Voir</span>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View */}
                  <div className="md:hidden space-y-3">
                    {filteredDetailCards.map(card => {
                      const hasPdf = Boolean(card.pdf_storage_path && card.pdf_version);
                      const isDownloading = downloadingCardId === card.report_card_id;

                      return (
                        <div key={card.report_card_id} className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-extrabold text-white text-sm">{card.student_name}</p>
                              <span className="font-mono text-slate-500 text-xs">{card.student_number}</span>
                            </div>
                            {card.rank && (
                              <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 font-mono font-bold rounded-lg text-xs">
                                #{card.rank}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-900">
                            <span className="text-slate-400 font-bold uppercase text-[10px]">Moyenne</span>
                            {card.overall_percentage !== null ? (
                              <span className={`font-black text-sm ${card.overall_percentage >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {Number(card.overall_percentage).toFixed(1)} %
                              </span>
                            ) : (
                              <span className="text-slate-500">Non noté</span>
                            )}
                          </div>

                          <div className="space-y-2 pt-1 border-t border-slate-900">
                            <div>
                              <span className="text-amber-400 block text-[10px] uppercase font-bold mb-0.5">Appréciation Direction</span>
                              {card.principal_remarks ? (
                                <p className="text-amber-300 text-xs break-words whitespace-pre-wrap leading-relaxed font-medium bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                                  {card.principal_remarks}
                                </p>
                              ) : (
                                <span className="text-slate-600 italic text-[11px]">En attente de direction</span>
                              )}
                            </div>
                          </div>

                          <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-900">
                            {hasPdf && (
                              <button
                                type="button"
                                disabled={isDownloading}
                                onClick={() => handleDownloadPdf(card)}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>PDF (v{card.pdf_version})</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenRemarkModal(card)}
                              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 ml-auto"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Détails</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: Saisie de l'Appréciation Direction */}
      {showPrincipalRemarkModal && selectedCardForRemark && (
        <Modal
          isOpen={showPrincipalRemarkModal}
          onClose={() => setShowPrincipalRemarkModal(false)}
          title={`Décision & Appréciation de Direction — ${selectedCardForRemark.student_name}`}
          darkMode={true}
        >
          <form onSubmit={handleSavePrincipalRemark} className="space-y-4 text-xs">
            <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Élève : <strong className="text-white">{selectedCardForRemark.student_name}</strong></span>
                <span className="font-mono text-amber-400 font-bold">{selectedCardForRemark.overall_percentage ? `${Number(selectedCardForRemark.overall_percentage).toFixed(2)} %` : 'N/A'}</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Appréciation du Titulaire : <span className="text-slate-200">{selectedCardForRemark.homeroom_teacher_remarks || 'Aucune'}</span> (Conduite : {selectedCardForRemark.conduct_grade || '—'})
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-300">Appréciation / Décision du Chef d'Établissement</label>
                <span className="text-[10px] text-slate-500">{principalRemarkText.length} / 1000</span>
              </div>
              <textarea
                rows={4}
                maxLength={1000}
                disabled={batchDetail?.status !== 'submitted_by_homeroom'}
                placeholder="Ex: Résultats satisfaisants. Encouragements de la direction pour maintenir ce niveau."
                value={principalRemarkText}
                onChange={e => setPrincipalRemarkText(e.target.value)}
                className="w-full p-3 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs font-medium focus:outline-none focus:border-amber-500 disabled:opacity-50"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowPrincipalRemarkModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Fermer
              </button>

              {batchDetail?.status === 'submitted_by_homeroom' && (
                <button
                  type="submit"
                  disabled={savingPrincipalRemark}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl cursor-pointer disabled:opacity-50"
                >
                  {savingPrincipalRemark ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Confirmation de Validation Administrative */}
      {showValidateModal && batchDetail && (
        <Modal
          isOpen={showValidateModal}
          onClose={() => !validatingBatch && setShowValidateModal(false)}
          title="Validation Administrative du Lot de Bulletins"
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-start gap-3">
              <FileCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-emerald-200">
                <p className="font-black text-sm text-emerald-300">
                  Confirmer la validation du lot de {batchDetail.class_name} ?
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Cette action fige définitivement l'identité officielle de l'école, les signatures numériques de la direction et du professeur titulaire ainsi que le cachet de l'établissement dans chaque bulletin.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 text-slate-400">
              <p>• Chef d'établissement : <strong className="text-white">{schoolOfficialData?.principal_name}</strong></p>
              <p>• Signature et cachet officiels vérifiés</p>
              <p>• Bulletins traités : <strong className="text-white">{batchDetail.total_students_count} élèves</strong></p>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={validatingBatch}
                onClick={() => setShowValidateModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={validatingBatch}
                onClick={handleValidateBatch}
                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black rounded-xl cursor-pointer shadow-lg transition-colors disabled:opacity-50"
              >
                {validatingBatch ? 'Validation en cours...' : 'Confirmer la Validation'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Confirmation de Publication Officielle (Phase 2F.3C) */}
      {showPublishModal && batchDetail && (
        <Modal
          isOpen={showPublishModal}
          onClose={() => !publishingBatch && setShowPublishModal(false)}
          title="Publication Officielle des Bulletins Périodiques"
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-start gap-3">
              <Award className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-emerald-200">
                <p className="font-black text-sm text-emerald-300">
                  Confirmer la publication officielle pour {batchDetail.class_name} ?
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Cette action rendra immédiatement accessibles et téléchargeables les bulletins officiels certifiés (PDF signés) sur les portails sécurisés de tous les élèves et parents rattachés.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 text-slate-400">
              <p>• Classe : <strong className="text-white">{batchDetail.class_name}</strong></p>
              <p>• Effectif concerné : <strong className="text-white">{batchDetail.total_students_count} élèves</strong></p>
              <p>• Documents PDF prêts : <strong className="text-emerald-400 font-mono">{pdfGenerationStatus?.ready_pdfs} / {batchDetail.total_students_count}</strong></p>
              <p>• Intégrité des signatures : <strong className="text-emerald-400 font-bold">100% Conforme</strong></p>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={publishingBatch}
                onClick={() => setShowPublishModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={publishingBatch || !pdfGenerationStatus?.can_publish}
                onClick={handlePublishBatch}
                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black rounded-xl cursor-pointer shadow-lg transition-colors disabled:opacity-50"
              >
                {publishingBatch ? 'Publication en cours...' : 'Confirmer la Publication'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Renvoyer en Brouillon avec Motif */}
      {showReturnModal && batchDetail && (
        <Modal
          isOpen={showReturnModal}
          onClose={() => !returningBatch && setShowReturnModal(false)}
          title="Renvoi du Lot en Statut Brouillon (Correction)"
          darkMode={true}
        >
          <form onSubmit={handleReturnToDraft} className="space-y-4 text-xs">
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-start gap-3">
              <RotateCcw className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-rose-200">
                <p className="font-black text-sm text-rose-300">
                  Renvoyer les bulletins au professeur titulaire ?
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Le lot repassera en statut <strong>Brouillon (draft)</strong> et le professeur titulaire pourra corriger les appréciations ou recalculer les moyennes avant une nouvelle soumission.
                </p>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Motif obligatoire du renvoi (min. 5 caractères) *</label>
              <textarea
                required
                rows={3}
                minLength={5}
                placeholder="Ex: Des appréciations manquent pour 3 élèves / Les notes de conduite doivent être harmonisées..."
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                className="w-full p-3 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs font-medium focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={returningBatch}
                onClick={() => setShowReturnModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={returningBatch || returnReason.trim().length < 5}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-xl cursor-pointer shadow-lg transition-colors disabled:opacity-50"
              >
                {returningBatch ? 'Renvoi en cours...' : 'Confirmer le Renvoi en Brouillon'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
