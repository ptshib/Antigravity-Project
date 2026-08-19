// Fichier : src/pages/parent/RealParentPortal.tsx
// Portail Parent Réel : Consultation officielle des résultats scolaires périodiques (Phase 2F.2)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../../components/common/Modal';
import { Logo } from '../../components/common/Logo';
import {
  Users,
  Award,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Clock,
  LogOut,
  Eye,
  User,
  GraduationCap
} from 'lucide-react';

interface LinkedChild {
  link_id: string;
  student_id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  relationship: string;
  can_view_academic: boolean;
  enrollment_status: string;
  class_id?: string;
  class_name?: string;
}

interface PeriodResultSubject {
  subject_id: string;
  subject_name: string;
  subject_coefficient: number;
  subject_percentage: number | null;
  is_complete: boolean;
  assessment_count: number;
  completed_assessment_count: number;
  pending_assessment_count: number;
}

interface ChildPeriodResult {
  student_id: string;
  student_number: string;
  student_name: string;
  class_name: string;
  period_name: string;
  term_name: string;
  subjects_count: number;
  completed_subjects_count: number;
  pending_subjects_count: number;
  total_subject_coefficients: number;
  overall_percentage: number | null;
  is_complete: boolean;
  subjects: PeriodResultSubject[];
}

export const RealParentPortal: React.FC = () => {
  const { profile, school, signOutReal } = useRealAuth();
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState<boolean>(true);
  const [childrenList, setChildrenList] = useState<LinkedChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  // Calendar
  const [calendarPeriods, setCalendarPeriods] = useState<any[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');

  // Academic Results
  const [loadingResults, setLoadingResults] = useState<boolean>(false);
  const [periodResult, setPeriodResult] = useState<ChildPeriodResult | null>(null);

  // Subject Assessments Detail Modal
  const [selectedSubjectDetail, setSelectedSubjectDetail] = useState<{
    subject: PeriodResultSubject;
    assessments: any[];
    loading: boolean;
  } | null>(null);

  // 1. Fetch Approved Linked Children
  const loadLinkedChildren = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('parent_student_links')
        .select(`
          id,
          relationship,
          can_view_academic,
          status,
          student_id,
          student:students (
            id,
            student_number,
            first_name,
            last_name,
            enrollment_status
          )
        `)
        .eq('parent_profile_id', profile.id)
        .eq('status', 'approved');

      if (error) throw error;

      const list: LinkedChild[] = (data || [])
        .filter((row: any) => row.student && row.can_view_academic)
        .map((row: any) => ({
          link_id: row.id,
          student_id: row.student.id,
          student_number: row.student.student_number || '',
          first_name: row.student.first_name || '',
          last_name: row.student.last_name || '',
          relationship: row.relationship || 'Parent',
          can_view_academic: !!row.can_view_academic,
          enrollment_status: row.student.enrollment_status
        }));

      setChildrenList(list);

      if (list.length > 0) {
        setSelectedChildId(prev => (prev && list.some(c => c.student_id === prev) ? prev : list[0].student_id));
      }
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du chargement de vos enfants rattachés.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, showToast]);

  useEffect(() => {
    loadLinkedChildren();
  }, [loadLinkedChildren]);

  // Selected Child object
  const activeChild = useMemo(() => {
    return childrenList.find(c => c.student_id === selectedChildId);
  }, [childrenList, selectedChildId]);

  // 2. Fetch School Calendar for Child
  const loadCalendar = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_school_calendar');
      if (error) throw error;

      if (data && data.terms) {
        const allPeriods: any[] = [];
        (data.terms || []).forEach((t: any) => {
          (t.periods || []).forEach((p: any) => {
            allPeriods.push({
              ...p,
              parent_term_name: t.name,
              parent_term_id: t.id
            });
          });
        });
        setCalendarPeriods(allPeriods);

        if (allPeriods.length > 0) {
          setSelectedPeriodId(prev => (prev && allPeriods.some(p => p.id === prev) ? prev : allPeriods[0].id));
        }
      }
    } catch (err: any) {
      console.warn('Calendar error:', err.message);
    }
  }, []);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  // 3. Fetch Official Period Result via RPC get_student_period_result
  const loadChildPeriodResults = useCallback(async () => {
    if (!selectedChildId || !selectedPeriodId) {
      setPeriodResult(null);
      return;
    }

    setLoadingResults(true);
    try {
      const { data, error } = await supabase.rpc('get_student_period_result', {
        p_student_id: selectedChildId,
        p_period_id: selectedPeriodId
      });

      if (error) throw error;

      if (data) {
        setPeriodResult(data as ChildPeriodResult);
      }
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la récupération des résultats.', 'warning');
      setPeriodResult(null);
    } finally {
      setLoadingResults(false);
    }
  }, [selectedChildId, selectedPeriodId, showToast]);

  useEffect(() => {
    loadChildPeriodResults();
  }, [loadChildPeriodResults]);

  // 4. Open Subject Assessments Details via RPC get_student_subject_period_result
  const handleOpenSubjectDetail = async (subject: PeriodResultSubject) => {
    if (!selectedChildId || !selectedPeriodId) return;

    setSelectedSubjectDetail({
      subject,
      assessments: [],
      loading: true
    });

    try {
      const { data, error } = await supabase.rpc('get_student_subject_period_result', {
        p_student_id: selectedChildId,
        p_subject_id: subject.subject_id,
        p_period_id: selectedPeriodId
      });

      if (error) throw error;

      setSelectedSubjectDetail({
        subject,
        assessments: data?.assessments || [],
        loading: false
      });
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la récupération du détail des notes.', 'warning');
      setSelectedSubjectDetail(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Chargement de votre Espace Parent...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* Header Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-indigo-400 uppercase tracking-wider">{school?.name || 'ÉcoleConnect'}</span>
              <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-[10px] font-bold">
                Espace Famille Sécurisé
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Parent : {profile?.first_name} {profile?.last_name}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={signOutReal}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-colors cursor-pointer"
            title="Se déconnecter"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {childrenList.length === 0 ? (
          <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
            <Users className="w-12 h-12 text-slate-600 mx-auto" />
            <h3 className="text-base font-bold text-white">Aucun élève rattaché</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Votre compte parent n’a pas encore d’élève approuvé pour la consultation académique. Veuillez contacter la direction de l’établissement.
            </p>
          </div>
        ) : (
          <>
            {/* Top Selector Bar (Child Switcher & Period Selector) */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-4">
              {/* Children Tabs / Switcher */}
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-2 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-indigo-400" />
                  Enfant :
                </span>
                {childrenList.map(ch => {
                  const isSelected = ch.student_id === selectedChildId;
                  return (
                    <button
                      key={ch.student_id}
                      onClick={() => setSelectedChildId(ch.student_id)}
                      className={`px-4 py-2 rounded-2xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-2 ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/60'
                          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <GraduationCap className="w-3.5 h-3.5" />
                      <span>{ch.first_name} {ch.last_name}</span>
                      <span className="text-[10px] font-mono opacity-70">({ch.student_number})</span>
                    </button>
                  );
                })}
              </div>

              {/* Period Selector */}
              <div className="w-full md:w-80">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Période Scolaire
                </label>
                <select
                  value={selectedPeriodId}
                  onChange={e => setSelectedPeriodId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold"
                >
                  {calendarPeriods.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.parent_term_name} {p.starts_on && p.ends_on ? `(${p.starts_on} au ${p.ends_on})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Results Section */}
            {loadingResults ? (
              <div className="p-16 text-center text-slate-400 space-y-3">
                <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-xs font-bold">Récupération des résultats scolaires officiels...</p>
              </div>
            ) : !periodResult ? (
              <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
                <Award className="w-12 h-12 text-slate-600 mx-auto" />
                <h3 className="text-sm font-bold text-white">Résultats non disponibles</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Aucun résultat scolaire ou évaluation publiée n'est disponible pour cette période.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* General Percentage Summary Card */}
                <div className="p-6 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 rounded-3xl border border-indigo-500/30 shadow-2xl space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                          {periodResult.student_number}
                        </span>
                        <h2 className="text-xl font-black text-white">{periodResult.student_name}</h2>
                      </div>
                      <p className="text-xs text-slate-400">
                        Classe : <strong className="text-slate-200">{periodResult.class_name}</strong> • {periodResult.period_name} ({periodResult.term_name})
                      </p>
                    </div>

                    <div className="bg-slate-950/90 px-6 py-4 rounded-3xl border border-slate-800 text-right space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Pourcentage Général Périodique
                      </span>
                      <p className="text-3xl font-black text-amber-400">
                        {periodResult.overall_percentage !== null ? `${periodResult.overall_percentage} %` : 'En attente'}
                      </p>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        periodResult.is_complete
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {periodResult.is_complete ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Bulletin Complet
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3" />
                            Notes en attente
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Warning banner if incomplete */}
                  {!periodResult.is_complete && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>
                        Certaines notes sont encore en cours de saisie par les enseignants. La moyenne générale sera mise à jour dès la publication complète des évaluations.
                      </span>
                    </div>
                  )}
                </div>

                {/* Subjects Table */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
                  <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-400" />
                      Matières & Moyennes Périodiques ({periodResult.subjects.length})
                    </h3>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-bold border-b border-slate-800">
                        <tr>
                          <th className="px-6 py-4">Matière</th>
                          <th className="px-6 py-4 text-center">Coefficient</th>
                          <th className="px-6 py-4 text-center">Évaluations</th>
                          <th className="px-6 py-4 text-center">Moyenne Matière</th>
                          <th className="px-6 py-4 text-center">État</th>
                          <th className="px-6 py-4 text-right">Détail des Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {periodResult.subjects.map(sbj => (
                          <tr key={sbj.subject_id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="px-6 py-4 font-bold text-white flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs">
                                {sbj.subject_name.charAt(0).toUpperCase()}
                              </div>
                              <span>{sbj.subject_name}</span>
                            </td>
                            <td className="px-6 py-4 text-center font-bold text-amber-300">
                              {sbj.subject_coefficient}
                            </td>
                            <td className="px-6 py-4 text-center text-slate-300">
                              {sbj.completed_assessment_count} / {sbj.assessment_count}
                            </td>
                            <td className="px-6 py-4 text-center">
                              {sbj.subject_percentage !== null ? (
                                <span
                                  className={`inline-flex items-center px-3 py-1 rounded-xl font-black text-sm ${
                                    sbj.subject_percentage >= 70
                                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                                      : sbj.subject_percentage >= 50
                                      ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                                      : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                                  }`}
                                >
                                  {sbj.subject_percentage} %
                                </span>
                              ) : (
                                <span className="text-slate-500 italic">En attente</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-center">
                              {sbj.is_complete ? (
                                <span className="text-emerald-400 font-bold text-[11px]">Complet</span>
                              ) : (
                                <span className="text-amber-400 font-bold text-[11px]">En cours</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => handleOpenSubjectDetail(sbj)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Consulter
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Subject Assessments Detail Modal */}
      {selectedSubjectDetail && (
        <Modal
          isOpen={!!selectedSubjectDetail}
          onClose={() => setSelectedSubjectDetail(null)}
          title={`Détail des Évaluations : ${selectedSubjectDetail.subject.subject_name}`}
        >
          {selectedSubjectDetail.loading ? (
            <div className="p-12 text-center text-slate-400 space-y-3">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-bold">Chargement des évaluations...</p>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex justify-between items-center">
                <div>
                  <p className="text-slate-400">Élève : <strong className="text-white">{activeChild?.first_name} {activeChild?.last_name}</strong></p>
                  <p className="text-slate-400 mt-0.5">Matière : <strong className="text-indigo-400">{selectedSubjectDetail.subject.subject_name}</strong> (Coeff {selectedSubjectDetail.subject.subject_coefficient})</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Moyenne Matière</span>
                  <span className="text-xl font-black text-amber-400">
                    {selectedSubjectDetail.subject.subject_percentage !== null ? `${selectedSubjectDetail.subject.subject_percentage} %` : 'En attente'}
                  </span>
                </div>
              </div>

              {/* Assessment list */}
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {selectedSubjectDetail.assessments.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 bg-slate-950 rounded-xl border border-slate-800">
                    Aucune évaluation publiée pour cette matière.
                  </div>
                ) : (
                  selectedSubjectDetail.assessments.map((asmt: any, idx: number) => (
                    <div key={asmt.assessment_id || idx} className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-extrabold text-white text-xs">{asmt.title}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Date : {asmt.assessment_date} • Coeff évaluation : {asmt.coefficient}
                          </p>
                        </div>

                        {/* Result Score / Absence */}
                        <div className="text-right">
                          {asmt.is_absent ? (
                            asmt.is_excused ? (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 block">
                                Absence Excusée
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/10 border border-rose-500/30 text-rose-400 block">
                                Absence non justifiée (0 %)
                              </span>
                            )
                          ) : asmt.score !== null && asmt.score !== undefined ? (
                            <div>
                              <span className="text-base font-black text-white">
                                {asmt.score} <span className="text-xs text-slate-400">/ {asmt.max_score}</span>
                              </span>
                              <span className="text-xs font-bold text-amber-400 block">
                                ({asmt.normalized_percentage} %)
                              </span>
                            </div>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300 block">
                              En attente
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Comment */}
                      {asmt.teacher_comment && (
                        <p className="text-[11px] text-slate-400 italic bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                          « {asmt.teacher_comment} »
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedSubjectDetail(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Footer */}
      <footer className="p-4 sm:p-6 border-t border-slate-900 text-center text-xs text-slate-500">
        ÉcoleConnect — Espace Parents Sécurisé
      </footer>
    </div>
  );
};
