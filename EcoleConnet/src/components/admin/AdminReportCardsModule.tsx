// Module Administrateur : Gestion & Validation des Bulletins Périodiques (Phase 2F.3)
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
  HelpCircle
} from 'lucide-react';
import type { ReportCardBatchManagement, PeriodReportCardItem, SchoolOfficialPrerequisites } from '../../types/reportCard';

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

  // Load Full Batch Details via RPC get_report_card_for_management
  const handleOpenBatchDetail = async (batchId: string) => {
    setSelectedBatchId(batchId);
    setLoadingDetail(true);
    setBatchDetail(null);

    try {
      const { data, error } = await supabase.rpc('get_report_card_for_management', {
        p_batch_id: batchId
      });

      if (error) throw error;

      if (data) {
        setBatchDetail(data as ReportCardBatchManagement);
      }
    } catch (err: any) {
      console.error('[AdminReportCardsModule] Erreur détails lot:', err);
      showToast(err.message || 'Échec du chargement des détails du lot.', 'warning');
    } finally {
      setLoadingDetail(false);
    }
  };

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
      t => t.id === currentClass?.homeroom_teacher_id || t.profile_id === currentClass?.homeroom_teacher_id
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
  }, [batchDetail, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <GraduationCap className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              Supervision & Validation Administrative des Bulletins
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Contrôlez les moyennes officielles, saisissez les appréciations de direction et validez les lots de bulletins pour publication.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3.5 py-1.5 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-bold">
            Total Lots : {batchesList.length}
          </span>
          <span className="px-3.5 py-1.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-bold">
            À Valider : {batchesList.filter(b => b.status === 'submitted_by_homeroom').length}
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-800 text-xs">
        <div className="flex items-center gap-1.5 text-slate-400 font-bold mr-2">
          <Filter className="w-4 h-4 text-amber-400" />
          <span>Filtres :</span>
        </div>

        {/* Classe */}
        <select
          value={classFilter}
          onChange={e => setClassFilter(e.target.value)}
          className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
        >
          <option value="all">Toutes les classes ({classes.length})</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Période */}
        <select
          value={periodFilter}
          onChange={e => setPeriodFilter(e.target.value)}
          className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
        >
          <option value="all">Toutes les périodes ({schoolPeriods.length})</option>
          {schoolPeriods.map(p => (
            <option key={p.id} value={p.id}>{p.name} ({p.education_cycle})</option>
          ))}
        </select>

        {/* Statut */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
        >
          <option value="all">Tous les statuts</option>
          <option value="draft">Brouillon (draft)</option>
          <option value="submitted_by_homeroom">Soumis par le titulaire</option>
          <option value="validated_by_admin">Validé par la direction</option>
          <option value="published">Publié</option>
        </select>
      </div>

      {/* Main Layout: List & Detail Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Batches Table */}
        <div className={selectedBatchId ? 'lg:col-span-4 space-y-4' : 'lg:col-span-12 space-y-4'}>
          {loading ? (
            <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
              <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-400">Chargement des lots de bulletins...</p>
            </div>
          ) : batchesList.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
              <GraduationCap className="w-12 h-12 text-slate-600 mx-auto" />
              <p className="text-sm font-bold text-slate-300">Aucun lot de bulletins trouvé</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Les professeurs titulaires génèrent les brouillons de bulletins depuis leur portail de classe.
              </p>
            </div>
          ) : (
            <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-extrabold text-[10px]">
                      <th className="p-3">Classe & Période</th>
                      <th className="p-3 text-center">Rév.</th>
                      <th className="p-3 text-center">Statut</th>
                      {!selectedBatchId && <th className="p-3 text-center">Effectif</th>}
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-medium">
                    {batchesList.map(b => {
                      const isSelected = selectedBatchId === b.id;
                      return (
                        <tr
                          key={b.id}
                          className={`transition-colors cursor-pointer ${
                            isSelected ? 'bg-amber-500/10 border-l-4 border-l-amber-500' : 'hover:bg-slate-800/40'
                          }`}
                          onClick={() => handleOpenBatchDetail(b.id)}
                        >
                          <td className="p-3">
                            <span className="font-extrabold text-white block">{b.class_name}</span>
                            <span className="text-[10px] text-amber-400 font-bold block">{b.period_name}</span>
                          </td>
                          <td className="p-3 text-center font-mono font-bold text-slate-300">
                            #{b.revision_number}
                          </td>
                          <td className="p-3 text-center">
                            {b.status === 'draft' && (
                              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded-md text-[10px] font-bold">
                                Brouillon
                              </span>
                            )}
                            {b.status === 'submitted_by_homeroom' && (
                              <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-md text-[10px] font-bold animate-pulse">
                                À Valider
                              </span>
                            )}
                            {b.status === 'validated_by_admin' && (
                              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-md text-[10px] font-bold">
                                Validé
                              </span>
                            )}
                            {b.status === 'published' && (
                              <span className="px-2 py-0.5 bg-emerald-500 text-slate-950 rounded-md text-[10px] font-black">
                                Publié
                              </span>
                            )}
                            {b.status === 'superseded' && (
                              <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md text-[10px] font-bold">
                                Archivé
                              </span>
                            )}
                          </td>
                          {!selectedBatchId && (
                            <td className="p-3 text-center">
                              <span className="font-bold text-white">{b.total_students_count}</span>
                              <span className="text-[10px] text-slate-500 block">
                                ({b.complete_students_count} C / {b.incomplete_students_count} I)
                              </span>
                            </td>
                          )}
                          <td className="p-3 text-right">
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                handleOpenBatchDetail(b.id);
                              }}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold"
                            >
                              Ouvrir
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
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
                        <span className="px-2.5 py-0.5 bg-slate-800 text-amber-400 border border-amber-500/30 rounded-full font-mono text-xs font-bold">
                          {batchDetail.status}
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

                      {/* Publish button - Disabled for Phase 2F.3A */}
                      {batchDetail.status === 'validated_by_admin' && (
                        <button
                          type="button"
                          disabled={true}
                          className="px-4 py-2 bg-slate-800 text-slate-500 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-not-allowed opacity-60"
                          title="La génération sécurisée des PDF sera installée à l’étape suivante."
                        >
                          <Award className="w-4 h-4" />
                          <span>Publier (Étape PDF suivante)</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Prerequisites Checklist Banner */}
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

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-extrabold text-[10px]">
                          <th className="p-3 text-center">Rang</th>
                          <th className="p-3">Élève & Matricule</th>
                          <th className="p-3 text-center">Moyenne</th>
                          <th className="p-3">Appréciation Titulaire</th>
                          <th className="p-3">Appréciation Direction</th>
                          <th className="p-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 font-medium">
                        {filteredDetailCards.map(card => (
                          <tr key={card.report_card_id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="p-3 text-center">
                              {card.rank ? (
                                <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 font-mono font-black rounded-lg text-xs">
                                  #{card.rank}
                                </span>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>

                            <td className="p-3">
                              <p className="font-extrabold text-white text-xs">{card.student_name}</p>
                              <span className="font-mono text-slate-500 text-[10px]">{card.student_number}</span>
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

                            <td className="p-3 max-w-xs">
                              {card.homeroom_teacher_remarks ? (
                                <p className="text-slate-300 text-xs truncate">{card.homeroom_teacher_remarks}</p>
                              ) : (
                                <span className="text-slate-600 italic text-[11px]">Non renseignée</span>
                              )}
                            </td>

                            <td className="p-3 max-w-xs">
                              {card.principal_remarks ? (
                                <p className="text-amber-300 text-xs truncate font-medium">{card.principal_remarks}</p>
                              ) : (
                                <span className="text-slate-600 italic text-[11px]">En attente de direction</span>
                              )}
                            </td>

                            <td className="p-3 text-right">
                              {batchDetail.status === 'submitted_by_homeroom' ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenRemarkModal(card)}
                                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 ml-auto cursor-pointer"
                                >
                                  <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                                  <span>{card.principal_remarks ? 'Modifier' : 'Apprécier'}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOpenRemarkModal(card)}
                                  className="px-3 py-1.5 bg-slate-800/60 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 ml-auto"
                                >
                                  <Eye className="w-3.5 h-3.5 text-slate-400" />
                                  <span>Voir</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
