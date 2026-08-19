// Composant Enseignant Titulaire : Préparation, Appréciations & Soumission des Bulletins (Phase 2F.3)
// Fichier : src/components/teacher/TeacherReportCardBatchView.tsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../common/Modal';
import {
  GraduationCap,
  Sparkles,
  Send,
  CheckCircle2,
  Clock,
  Search,
  MessageSquare,
  Award,
  BookOpen,
  Lock,
  Save,
  RotateCw
} from 'lucide-react';
import type { ReportCardBatchManagement, PeriodReportCardItem } from '../../types/reportCard';
import { getReportCardBatchStatusLabel } from '../../types/reportCard';

interface TeacherReportCardBatchViewProps {
  selectedClassId: string;
  selectedPeriodId: string;
  className: string;
  periodName: string;
  isHomeroomTeacher: boolean;
  assignedSubjectIds?: string[];
  onBatchUpdated?: () => void;
}

export const TeacherReportCardBatchView: React.FC<TeacherReportCardBatchViewProps> = ({
  selectedClassId,
  selectedPeriodId,
  className,
  periodName,
  isHomeroomTeacher,
  assignedSubjectIds = [],
  onBatchUpdated
}) => {
  const { showToast } = useNotifications();

  // Main Data States
  const [loading, setLoading] = useState<boolean>(true);
  const [batchData, setBatchData] = useState<ReportCardBatchManagement | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState<boolean>(false);
  const [submittingBatch, setSubmittingBatch] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Remarks Modal State
  const [showRemarksModal, setShowRemarksModal] = useState<boolean>(false);
  const [selectedCard, setSelectedCard] = useState<PeriodReportCardItem | null>(null);
  const [homeroomRemarks, setHomeroomRemarks] = useState<string>('');
  const [conductGrade, setConductGrade] = useState<string>('');
  const [subjectRemarksMap, setSubjectRemarksMap] = useState<Record<string, string>>({});
  const [savingRemarks, setSavingRemarks] = useState<boolean>(false);

  // Submit to Admin Modal
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  // Load existing batch for class and period
  const loadBatchData = useCallback(async () => {
    if (!selectedClassId || !selectedPeriodId) {
      setBatchData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Find latest batch for class and period
      const { data: batches, error: batchError } = await supabase
        .from('report_card_batches')
        .select('id, revision_number, status')
        .eq('class_id', selectedClassId)
        .eq('period_id', selectedPeriodId)
        .order('revision_number', { ascending: false })
        .limit(1);

      if (batchError) throw batchError;

      if (!batches || batches.length === 0) {
        setBatchData(null);
        return;
      }

      const latestBatch = batches[0];

      // Fetch management details via RPC
      const { data: managementData, error: mgmtError } = await supabase.rpc(
        'get_report_card_for_management',
        { p_batch_id: latestBatch.id }
      );

      if (mgmtError) throw mgmtError;

      if (managementData) {
        setBatchData(managementData as ReportCardBatchManagement);
      }
    } catch (err: any) {
      console.error('[TeacherReportCardBatchView] Erreur chargement lot:', err);
      if ((err.message || '').includes('Accès refusé')) {
        showToast('Accès restreint au professeur titulaire de la classe.', 'warning');
      } else {
        showToast(err.message || 'Erreur lors du chargement des bulletins.', 'warning');
      }
      setBatchData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedClassId, selectedPeriodId, showToast]);

  useEffect(() => {
    loadBatchData();
  }, [loadBatchData]);

  // Generate Class Report Card Draft via RPC
  const handleGenerateDraft = async () => {
    if (!selectedClassId || !selectedPeriodId) return;

    setGeneratingDraft(true);
    try {
      const { data, error } = await supabase.rpc('generate_class_report_card_draft', {
        p_class_id: selectedClassId,
        p_period_id: selectedPeriodId
      });

      if (error) throw error;

      showToast(`Brouillon des bulletins généré avec succès (Révision #${data?.revision_number || 1}).`, 'success');
      await loadBatchData();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      console.error('[TeacherReportCardBatchView] Erreur génération draft:', err);
      showToast(err.message || 'Échec de la génération des bulletins.', 'warning');
    } finally {
      setGeneratingDraft(false);
    }
  };

  // Open Edit Remarks Modal for a Student Card
  const handleOpenRemarksModal = (card: PeriodReportCardItem) => {
    setSelectedCard(card);
    setHomeroomRemarks(card.homeroom_teacher_remarks || '');
    setConductGrade(card.conduct_grade || '');

    // Populate subject remarks map
    const remarks: Record<string, string> = {};
    (card.subjects || []).forEach(s => {
      remarks[s.subject_id] = s.subject_remark || '';
    });
    setSubjectRemarksMap(remarks);

    setShowRemarksModal(true);
  };

  // Save Remarks via RPC save_report_card_remarks
  const handleSaveRemarks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) return;

    setSavingRemarks(true);
    try {
      // Build subject remarks payload for authorized subjects only
      const subjectRemarksPayload = (selectedCard.subjects || [])
        .filter(s => assignedSubjectIds.includes(s.subject_id))
        .map(s => ({
          subject_id: s.subject_id,
          remark: subjectRemarksMap[s.subject_id] || ''
        }));

      const { error } = await supabase.rpc('save_report_card_remarks', {
        p_report_card_id: selectedCard.report_card_id,
        p_homeroom_remarks: isHomeroomTeacher ? homeroomRemarks : null,
        p_conduct_grade: isHomeroomTeacher ? conductGrade : null,
        p_principal_remarks: null,
        p_subject_remarks: subjectRemarksPayload.length > 0 ? subjectRemarksPayload : null
      });

      if (error) throw error;

      showToast('Appréciations enregistrées avec succès.', 'success');
      setShowRemarksModal(false);
      await loadBatchData();
    } catch (err: any) {
      console.error('[TeacherReportCardBatchView] Erreur sauvegarde remarques:', err);
      showToast(err.message || 'Erreur lors de l’enregistrement des appréciations.', 'warning');
    } finally {
      setSavingRemarks(false);
    }
  };

  // Submit Report Card Batch to Administration via RPC
  const handleSubmitBatch = async () => {
    if (!batchData?.batch_id) return;

    setSubmittingBatch(true);
    try {
      const { error } = await supabase.rpc('submit_report_card_batch', {
        p_batch_id: batchData.batch_id
      });

      if (error) throw error;

      showToast('Lot de bulletins soumis à la Direction pour validation officielle.', 'success');
      setShowSubmitModal(false);
      await loadBatchData();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      console.error('[TeacherReportCardBatchView] Erreur soumission lot:', err);
      showToast(err.message || 'Échec de la soumission du lot à la direction.', 'warning');
    } finally {
      setSubmittingBatch(false);
    }
  };

  // Filtered Cards
  const filteredCards = useMemo(() => {
    if (!batchData?.report_cards) return [];
    if (!searchQuery.trim()) return batchData.report_cards;
    const q = searchQuery.toLowerCase();
    return batchData.report_cards.filter(
      c =>
        c.student_name.toLowerCase().includes(q) ||
        c.student_number.toLowerCase().includes(q)
    );
  }, [batchData, searchQuery]);

  if (!isHomeroomTeacher) {
    return (
      <div className="p-8 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
        <Lock className="w-10 h-10 text-amber-500 mx-auto" />
        <h3 className="font-extrabold text-white text-base">Actions réservées au professeur titulaire</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
          La génération des brouillons, l'attribution des mentions globales de conduite et la soumission des bulletins officiels de cette classe sont strictement réservées à son professeur titulaire.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
        <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs font-bold text-slate-400">Chargement des bulletins de la classe...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Empty State: No Batch Yet */}
      {!batchData && (
        <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
          <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-3xl flex items-center justify-center mx-auto">
            <GraduationCap className="w-8 h-8" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-black text-white">Aucun Lot de Bulletins pour cette Période</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Vous êtes le titulaire de la classe <strong>{className}</strong>. Générez le premier brouillon de bulletins pour calculer le classement officiel et saisir les appréciations.
            </p>
          </div>

          <button
            onClick={handleGenerateDraft}
            disabled={generatingDraft}
            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-2xl text-xs flex items-center gap-2 mx-auto cursor-pointer shadow-lg transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>{generatingDraft ? 'Génération en cours...' : 'Générer les Brouillons de Bulletins'}</span>
          </button>
        </div>
      )}

      {/* 2. Existing Batch View */}
      {batchData && (
        <div className="space-y-6">
          {/* Header Summary Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="text-lg font-black text-white">
                  Bulletins : {batchData.class_name} ({periodName})
                </h3>
                <span className="px-2.5 py-0.5 bg-slate-800 text-amber-400 border border-amber-500/30 rounded-full font-mono text-xs font-bold">
                  Révision #{batchData.revision_number}
                </span>

                {/* Status Badges */}
                {batchData.status === 'draft' && (
                  <span className="px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-xs font-extrabold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Brouillon</span>
                  </span>
                )}
                {batchData.status === 'submitted_by_homeroom' && (
                  <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-full text-xs font-extrabold flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5" />
                    <span>Soumis par le titulaire</span>
                  </span>
                )}
                {batchData.status === 'validated_by_admin' && (
                  <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full text-xs font-extrabold flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Validé par la direction</span>
                  </span>
                )}
                {batchData.status === 'published' && (
                  <span className="px-3 py-1 bg-emerald-500 text-slate-950 rounded-full text-xs font-black flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5" />
                    <span>Publié</span>
                  </span>
                )}
                {batchData.status === 'superseded' && (
                  <span className="px-3 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-full text-xs font-extrabold flex items-center gap-1.5">
                    <span>Remplacé par une nouvelle révision</span>
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-400">
                Effectif total : <strong className="text-white">{batchData.total_students_count} élèves</strong> • Bulletins complets : <strong className="text-emerald-400">{batchData.complete_students_count}</strong> • Incomplets : <strong className="text-amber-400">{batchData.incomplete_students_count}</strong>
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {batchData.status === 'draft' && (
                <>
                  <button
                    type="button"
                    onClick={handleGenerateDraft}
                    disabled={generatingDraft}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer transition-colors"
                    title="Recalculer les moyennes et mettre à jour l'effectif"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${generatingDraft ? 'animate-spin' : ''}`} />
                    <span>Recalculer</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowSubmitModal(true)}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 cursor-pointer shadow-lg transition-colors"
                  >
                    <Send className="w-4 h-4" />
                    <span>Soumettre à la Direction</span>
                  </button>
                </>
              )}

              {batchData.status !== 'draft' && (
                <span className="text-xs text-slate-400 font-medium italic">
                  Lot verrouillé en lecture seule (Statut : <strong className="text-amber-400">{getReportCardBatchStatusLabel(batchData.status)}</strong>).
                </span>
              )}
            </div>
          </div>

          {/* Roster & Search Table */}
          <div className="bg-slate-900 rounded-3xl border border-slate-800 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Rechercher un élève par nom ou matricule..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <span className="text-xs text-slate-400 font-bold">
                {filteredCards.length} élève{filteredCards.length > 1 ? 's' : ''} affiché{filteredCards.length > 1 ? 's' : ''}
              </span>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-800">
              <table className="w-full text-left text-xs table-auto border-collapse">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-extrabold text-[10px]">
                    <th className="p-3 text-center w-16">Rang</th>
                    <th className="p-3 min-w-[160px]">Matricule & Élève</th>
                    <th className="p-3 text-center w-24">Moyenne</th>
                    <th className="p-3 text-center w-36">Statut Matières</th>
                    <th className="p-3 min-w-[200px] max-w-[320px]">Appréciation Titulaire</th>
                    <th className="p-3 w-24">Conduite</th>
                    <th className="p-3 text-right w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-medium bg-slate-950/40">
                  {filteredCards.map(card => {
                    const hasHomeroomRemark = Boolean(card.homeroom_teacher_remarks?.trim());
                    return (
                      <tr key={card.report_card_id} className="hover:bg-slate-800/40 transition-colors">
                        {/* Rang */}
                        <td className="p-3 text-center">
                          {card.rank ? (
                            <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg font-mono font-black text-xs inline-block">
                              #{card.rank}
                            </span>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>

                        {/* Élève */}
                        <td className="p-3">
                          <p className="font-extrabold text-white text-xs leading-snug">{card.student_name}</p>
                          <span className="font-mono text-slate-500 text-[10px] block">{card.student_number}</span>
                        </td>

                        {/* Moyenne */}
                        <td className="p-3 text-center">
                          {card.overall_percentage !== null ? (
                            <span className={`font-black text-xs ${card.overall_percentage >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {Number(card.overall_percentage).toFixed(1)} %
                            </span>
                          ) : (
                            <span className="text-slate-500 text-xs">Non noté</span>
                          )}
                        </td>

                        {/* Statut Matières */}
                        <td className="p-3 text-center">
                          {card.is_incomplete ? (
                            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg text-[10px] font-extrabold inline-block">
                              Incomplet ({card.completed_subjects_count}/{card.completed_subjects_count + card.pending_subjects_count})
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg text-[10px] font-extrabold inline-block">
                              Complet ({card.completed_subjects_count} mat.)
                            </span>
                          )}
                        </td>

                        {/* Appréciation */}
                        <td className="p-3 min-w-[200px] max-w-[320px]">
                          {hasHomeroomRemark ? (
                            <p className="text-slate-200 text-xs break-words whitespace-pre-wrap leading-relaxed">
                              {card.homeroom_teacher_remarks}
                            </p>
                          ) : (
                            <span className="text-slate-500 italic text-[11px]">En attente de saisie...</span>
                          )}
                        </td>

                        {/* Conduite */}
                        <td className="p-3">
                          {card.conduct_grade ? (
                            <span className="px-2 py-0.5 bg-slate-800 text-slate-200 rounded-lg text-[11px] font-bold inline-block">
                              {card.conduct_grade}
                            </span>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenRemarksModal(card)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 ml-auto cursor-pointer transition-colors"
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                            <span>{batchData.status === 'draft' ? 'Saisir / Modifier' : 'Consulter'}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="md:hidden space-y-3">
              {filteredCards.map(card => {
                const hasHomeroomRemark = Boolean(card.homeroom_teacher_remarks?.trim());
                return (
                  <div key={card.report_card_id} className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-extrabold text-white text-sm">{card.student_name}</p>
                        <span className="font-mono text-slate-500 text-xs">{card.student_number}</span>
                      </div>
                      <div className="text-right">
                        {card.rank ? (
                          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg font-mono font-bold text-xs">
                            #{card.rank}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-900">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Moyenne</span>
                        {card.overall_percentage !== null ? (
                          <span className={`font-black text-sm ${card.overall_percentage >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {Number(card.overall_percentage).toFixed(1)} %
                          </span>
                        ) : (
                          <span className="text-slate-500">Non noté</span>
                        )}
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Conduite</span>
                        <span className="font-bold text-slate-200">{card.conduct_grade || '—'}</span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Matières</span>
                        {card.is_incomplete ? (
                          <span className="text-amber-400 font-bold text-[11px]">Incomplet</span>
                        ) : (
                          <span className="text-emerald-400 font-bold text-[11px]">Complet</span>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-900">
                      <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1">Appréciation</span>
                      {hasHomeroomRemark ? (
                        <p className="text-slate-300 text-xs break-words whitespace-pre-wrap leading-relaxed bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                          {card.homeroom_teacher_remarks}
                        </p>
                      ) : (
                        <span className="text-slate-500 italic text-[11px]">En attente de saisie...</span>
                      )}
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleOpenRemarksModal(card)}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                        <span>{batchData.status === 'draft' ? 'Saisir / Modifier Appréciation' : 'Consulter'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal: Saisie des Appréciations & Conduite */}
      {showRemarksModal && selectedCard && (
        <Modal
          isOpen={showRemarksModal}
          onClose={() => setShowRemarksModal(false)}
          title={`Appréciations & Conduite — ${selectedCard.student_name} (${selectedCard.student_number})`}
          darkMode={true}
        >
          <form onSubmit={handleSaveRemarks} className="space-y-5 text-xs">
            {/* Student Info Card */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between text-xs">
              <div>
                <p className="text-slate-400">Pourcentage Général :</p>
                <p className="text-base font-black text-amber-400">
                  {selectedCard.overall_percentage !== null ? `${Number(selectedCard.overall_percentage).toFixed(2)} %` : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Rang Actuel :</p>
                <p className="text-base font-black text-white">
                  {selectedCard.rank ? `#${selectedCard.rank} (Provisoire)` : 'Non classé'}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Statut Dossier :</p>
                <p className={`font-bold ${selectedCard.is_incomplete ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {selectedCard.is_incomplete ? 'Bulletin Incomplet' : 'Bulletin Complet'}
                </p>
              </div>
            </div>

            {/* Titulaire Fields */}
            {isHomeroomTeacher && (
              <div className="space-y-4 p-4 bg-slate-900/60 rounded-2xl border border-slate-800">
                <h4 className="font-extrabold text-white text-xs flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-amber-400" />
                  <span>Appréciation Générale & Conduite (Professeur Titulaire)</span>
                </h4>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-slate-300">Appréciation Générale du Titulaire</label>
                    <span className="text-[10px] text-slate-500">{homeroomRemarks.length} / 1000</span>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    disabled={batchData?.status !== 'draft'}
                    placeholder="Ex: Élève très consciencieux et régulier dans son travail. Poursuivez dans cette dynamique d'excellence."
                    value={homeroomRemarks}
                    onChange={e => setHomeroomRemarks(e.target.value)}
                    className="w-full p-3 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs font-medium focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">Note / Mention de Conduite (max 50 car.)</label>
                  <input
                    type="text"
                    maxLength={50}
                    disabled={batchData?.status !== 'draft'}
                    placeholder="Ex: Très Bonne, Bonne, Exemplaire, Passable..."
                    value={conductGrade}
                    onChange={e => setConductGrade(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs font-medium focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  />
                </div>
              </div>
            )}

            {/* Subject Remarks List */}
            <div className="space-y-3 p-4 bg-slate-900/60 rounded-2xl border border-slate-800">
              <h4 className="font-extrabold text-white text-xs flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-amber-400" />
                <span>Remarques Particulières par Matière</span>
              </h4>

              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {(selectedCard.subjects || []).map(subj => {
                  const isAssigned = assignedSubjectIds.includes(subj.subject_id);
                  return (
                    <div key={subj.subject_id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-extrabold text-white">{subj.subject_name} (Coeff {subj.coefficient})</span>
                        <span className="font-mono text-amber-400 font-bold">
                          {subj.subject_percentage !== null ? `${Number(subj.subject_percentage).toFixed(1)} %` : 'Pas de note'}
                        </span>
                      </div>

                      <input
                        type="text"
                        maxLength={500}
                        disabled={!isAssigned || batchData?.status !== 'draft'}
                        placeholder={isAssigned ? "Saisir la remarque de matière..." : "Non affecté à cette matière (Lecture seule)"}
                        value={subjectRemarksMap[subj.subject_id] || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setSubjectRemarksMap(prev => ({ ...prev, [subj.subject_id]: val }));
                        }}
                        className="w-full px-3 py-1.5 bg-slate-900 text-white rounded-lg border border-slate-800 text-xs font-medium focus:outline-none focus:border-amber-500 disabled:opacity-40"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowRemarksModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Fermer
              </button>

              {batchData?.status === 'draft' && (
                <button
                  type="submit"
                  disabled={savingRemarks}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingRemarks ? 'Enregistrement...' : 'Enregistrer'}</span>
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {/* 4. Modal: Confirmation Forte de Soumission à la Direction */}
      {showSubmitModal && batchData && (
        <Modal
          isOpen={showSubmitModal}
          onClose={() => !submittingBatch && setShowSubmitModal(false)}
          title="Soumission du Lot de Bulletins à la Direction"
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl flex items-start gap-3">
              <Send className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-indigo-200">
                <p className="font-black text-sm text-indigo-300">
                  Transmettre les bulletins de {batchData.class_name} pour validation administrative ?
                </p>
                <p className="text-slate-300 leading-relaxed">
                  En soumettant ce lot, vous confirmez l'exactitude des appréciations saisies et des notes calculées. Le lot passera en statut <strong>Soumis</strong> et sera transmis au chef d'établissement pour validation finale.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 text-slate-400">
              <p>• Effectif total vérifié : <strong className="text-white">{batchData.total_students_count} élèves</strong></p>
              <p>• Bulletins complets : <strong className="text-emerald-400">{batchData.complete_students_count}</strong></p>
              <p>• Bulletins incomplets avec mention : <strong className="text-amber-400">{batchData.incomplete_students_count}</strong></p>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={submittingBatch}
                onClick={() => setShowSubmitModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={submittingBatch}
                onClick={handleSubmitBatch}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-xl cursor-pointer shadow-lg transition-colors disabled:opacity-50"
              >
                {submittingBatch ? 'Soumission en cours...' : 'Confirmer la Soumission'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
