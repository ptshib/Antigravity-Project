// Fichier : src/components/teacher/TeacherSubjectPeriodResultsView.tsx
// Vue Enseignant : Résultats par période et par matière (Phase 2F.2)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../common/Modal';
import {
  CheckCircle2,
  Clock,
  Search,
  Eye,
  Users,
  Percent
} from 'lucide-react';

interface TeacherSubjectPeriodResultsViewProps {
  assignments: Array<{
    id: string;
    class_id: string;
    class_name?: string;
    subject_id: string | null;
    subject_name?: string;
    academic_year_id: string;
  }>;
  classesList: any[];
  subjectsList: any[];
  schoolTerms: any[];
  schoolPeriods: any[];
}

interface StudentPeriodSubjectSummary {
  student_id: string;
  student_number: string;
  student_name: string;
  enrollment_id: string;
  assessment_count: number;
  completed_assessment_count: number;
  pending_assessment_count: number;
  excused_absence_count: number;
  unexcused_absence_count: number;
  total_assessment_coefficient: number;
  subject_percentage: number | null;
  is_complete: boolean;
  assessments: any[];
  error_message?: string;
}

export const TeacherSubjectPeriodResultsView: React.FC<TeacherSubjectPeriodResultsViewProps> = ({
  assignments,
  classesList,
  subjectsList,
  schoolTerms: _schoolTerms,
  schoolPeriods
}) => {
  const { showToast } = useNotifications();

  // Filters
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Data
  const [loading, setLoading] = useState<boolean>(false);
  const [studentResults, setStudentResults] = useState<StudentPeriodSubjectSummary[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Detail Modal
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<StudentPeriodSubjectSummary | null>(null);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);

  // Available classes for teacher
  const uniqueClasses = useMemo(() => {
    const map = new Map<string, { id: string; name: string; cycle: string | null }>();
    assignments.forEach(a => {
      if (a.class_id && !map.has(a.class_id)) {
        const cls = classesList.find(c => c.id === a.class_id);
        map.set(a.class_id, {
          id: a.class_id,
          name: a.class_name || cls?.name || 'Classe',
          cycle: cls?.education_cycle || null
        });
      }
    });
    return Array.from(map.values());
  }, [assignments, classesList]);

  // Initialize selected class
  useEffect(() => {
    if (uniqueClasses.length > 0 && !selectedClassId) {
      setSelectedClassId(uniqueClasses[0].id);
    }
  }, [uniqueClasses, selectedClassId]);

  // Available subjects for selected class
  const availableSubjects = useMemo(() => {
    if (!selectedClassId) return [];
    return assignments
      .filter(a => a.class_id === selectedClassId && a.subject_id)
      .map(a => {
        const sbj = subjectsList.find(s => s.id === a.subject_id);
        return {
          id: a.subject_id!,
          name: sbj ? sbj.name : (a.subject_name || 'Matière')
        };
      });
  }, [assignments, selectedClassId, subjectsList]);

  // Auto-select first subject
  useEffect(() => {
    if (availableSubjects.length > 0) {
      if (!selectedSubjectId || !availableSubjects.some(s => s.id === selectedSubjectId)) {
        setSelectedSubjectId(availableSubjects[0].id);
      }
    } else {
      setSelectedSubjectId('');
    }
  }, [availableSubjects, selectedSubjectId]);

  // Available periods for selected class's cycle
  const availablePeriods = useMemo(() => {
    if (!selectedClassId) return [];
    const cls = classesList.find(c => c.id === selectedClassId);
    const cycle = cls?.education_cycle;
    return (schoolPeriods || []).filter(p => !cycle || !p.education_cycle || p.education_cycle === cycle);
  }, [selectedClassId, classesList, schoolPeriods]);

  // Auto-select first period
  useEffect(() => {
    if (availablePeriods.length > 0) {
      if (!selectedPeriodId || !availablePeriods.some(p => p.id === selectedPeriodId)) {
        setSelectedPeriodId(availablePeriods[0].id);
      }
    } else {
      setSelectedPeriodId('');
    }
  }, [availablePeriods, selectedPeriodId]);

  // Selected entities objects
  const currentClass = useMemo(() => classesList.find(c => c.id === selectedClassId), [classesList, selectedClassId]);
  const currentSubject = useMemo(() => subjectsList.find(s => s.id === selectedSubjectId), [subjectsList, selectedSubjectId]);
  const currentPeriod = useMemo(() => schoolPeriods.find(p => p.id === selectedPeriodId), [schoolPeriods, selectedPeriodId]);

  // Load results for all enrolled students via official RPC
  const loadPeriodSubjectResults = useCallback(async () => {
    if (!selectedClassId || !selectedSubjectId || !selectedPeriodId) {
      setStudentResults([]);
      setFetchError(null);
      return;
    }

    setLoading(true);
    setFetchError(null);
    try {
      // 1. Récupération des inscriptions actives de la classe sélectionnée
      const { data: enrollmentsData, error: enrError } = await supabase
        .from('student_enrollments')
        .select('id, student_id, status')
        .eq('class_id', selectedClassId)
        .eq('status', 'active');

      if (enrError) {
        console.error('[TeacherSubjectPeriodResultsView] Erreur student_enrollments:', enrError, {
          selectedClassId,
          selectedSubjectId,
          selectedPeriodId
        });
        throw enrError;
      }

      // 2. Récupération des noms et matricules via la RPC dédiée get_teacher_assigned_students
      const { data: assignedStudentsData, error: assignedError } = await supabase
        .rpc('get_teacher_assigned_students');

      if (assignedError) {
        console.warn('[TeacherSubjectPeriodResultsView] Avertissement get_teacher_assigned_students:', assignedError);
      }

      const studentInfoMap = new Map<string, { student_number: string; first_name: string; last_name: string; name: string }>();
      (assignedStudentsData || []).forEach((s: any) => {
        studentInfoMap.set(s.student_id, {
          student_number: s.student_number || '',
          first_name: s.first_name || '',
          last_name: s.last_name || '',
          name: `${s.first_name || ''} ${s.last_name || ''}`.trim() || 'Élève'
        });
      });

      // 3. Appel de la RPC officielle get_student_subject_period_result pour chaque élève inscrit
      const results: StudentPeriodSubjectSummary[] = [];

      for (const enr of enrollmentsData || []) {
        const studentId = enr.student_id;
        const enrollmentId = enr.id;
        const info = studentInfoMap.get(studentId) || {
          student_number: '',
          first_name: 'Élève',
          last_name: '',
          name: 'Élève'
        };

        const { data: rawData, error: rpcError } = await supabase.rpc('get_student_subject_period_result', {
          p_student_id: studentId,
          p_subject_id: selectedSubjectId,
          p_period_id: selectedPeriodId
        });

        if (rpcError) {
          console.error('[TeacherSubjectPeriodResultsView] Erreur RPC get_student_subject_period_result:', rpcError, {
            p_student_id: studentId,
            p_subject_id: selectedSubjectId,
            p_period_id: selectedPeriodId
          });
          results.push({
            student_id: studentId,
            student_number: info.student_number,
            student_name: info.name,
            enrollment_id: enrollmentId,
            assessment_count: 0,
            completed_assessment_count: 0,
            pending_assessment_count: 0,
            excused_absence_count: 0,
            unexcused_absence_count: 0,
            total_assessment_coefficient: 0,
            subject_percentage: null,
            is_complete: false,
            assessments: [],
            error_message: rpcError.message
          });
          continue;
        }

        // Normalisation de la réponse (objet JSON ou tableau mono-ligne)
        const resData = Array.isArray(rawData) ? rawData[0] : rawData;

        if (resData) {
          results.push({
            student_id: studentId,
            student_number: info.student_number,
            student_name: info.name,
            enrollment_id: enrollmentId,
            assessment_count: Number(resData.assessment_count) || 0,
            completed_assessment_count: Number(resData.completed_assessment_count) || 0,
            pending_assessment_count: Number(resData.pending_assessment_count) || 0,
            excused_absence_count: Number(resData.excused_absence_count) || 0,
            unexcused_absence_count: Number(resData.unexcused_absence_count) || 0,
            total_assessment_coefficient: Number(resData.total_assessment_coefficient) || 0,
            subject_percentage: resData.subject_percentage !== undefined && resData.subject_percentage !== null
              ? Number(resData.subject_percentage)
              : null,
            is_complete: !!resData.is_complete,
            assessments: resData.assessments || []
          });
        }
      }

      // Tri alphabétique par nom d'élève
      results.sort((a, b) => a.student_name.localeCompare(b.student_name));
      setStudentResults(results);
    } catch (err: any) {
      console.error('[TeacherSubjectPeriodResultsView] Échec global chargement:', err);
      setFetchError(err.message || 'Erreur lors du calcul des résultats périodiques.');
      showToast(err.message || 'Erreur lors du calcul des résultats périodiques.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [selectedClassId, selectedSubjectId, selectedPeriodId, showToast]);

  useEffect(() => {
    loadPeriodSubjectResults();
  }, [loadPeriodSubjectResults]);

  // Filtered by Search
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return studentResults;
    const q = searchQuery.toLowerCase();
    return studentResults.filter(
      st =>
        st.student_name.toLowerCase().includes(q) ||
        st.student_number.toLowerCase().includes(q)
    );
  }, [studentResults, searchQuery]);

  // Stats on current view
  const summaryStats = useMemo(() => {
    const total = studentResults.length;
    // Élèves évalués : ayant au moins une évaluation publiée comptabilisée ou un score calculé
    const evaluatedCount = studentResults.filter(s => s.subject_percentage !== null).length;
    const completeCount = studentResults.filter(s => s.is_complete).length;
    const pendingCount = total - completeCount;
    const validScores = studentResults.filter(s => s.subject_percentage !== null).map(s => Number(s.subject_percentage));
    const classAvg = validScores.length > 0 ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1) : '—';

    return { total, evaluatedCount, completeCount, pendingCount, classAvg };
  }, [studentResults]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Percent className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              Résultats Périodiques par Matière
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Moyennes officielles calculées en temps réel par les RPC Supabase avec gestion des absences et pondérations.
            </p>
          </div>
        </div>

        {/* Overview Stats Badges */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Élèves Évalués</p>
            <p className="text-sm font-black text-white">
              {summaryStats.evaluatedCount} <span className="text-xs text-slate-400 font-medium">/ {summaryStats.total}</span>
            </p>
          </div>
          <div className="bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Moyenne Classe</p>
            <p className="text-sm font-black text-amber-400">
              {summaryStats.classAvg !== '—' ? `${summaryStats.classAvg} %` : '—'}
            </p>
          </div>
          <div className="bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Complets</p>
            <p className="text-sm font-black text-emerald-400">
              {summaryStats.completeCount} / {summaryStats.total}
            </p>
          </div>
        </div>
      </div>

      {/* Explicit Error Banner if any */}
      {fetchError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-rose-400">⚠️ Erreur :</span>
            <span>{fetchError}</span>
          </div>
          <button
            onClick={() => loadPeriodSubjectResults()}
            className="px-3 py-1 bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold rounded-lg text-xs cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Filter Selector Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col md:flex-row items-center gap-4">
        {/* Class Selector */}
        <div className="w-full md:w-56">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Classe
          </label>
          <select
            value={selectedClassId}
            onChange={e => setSelectedClassId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            {uniqueClasses.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Subject Selector */}
        <div className="w-full md:w-64">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Matière
          </label>
          <select
            value={selectedSubjectId}
            onChange={e => setSelectedSubjectId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            {availableSubjects.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Period Selector */}
        <div className="w-full md:w-64">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Période Scolaire
          </label>
          <select
            value={selectedPeriodId}
            onChange={e => setSelectedPeriodId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            {availablePeriods.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.starts_on && p.ends_on ? `(${p.starts_on} au ${p.ends_on})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="w-full md:flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Recherche élève
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Filtrer par nom ou matricule..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
        {loading ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-bold">Calcul officiel des moyennes périodiques...</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-500">
              <Users className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-white">Aucun résultat à afficher</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Vérifiez vos filtres ou assurez-vous que des évaluations publiées existent pour cette matière et cette période.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-bold border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4">Matricule</th>
                  <th className="px-6 py-4">Nom de l’Élève</th>
                  <th className="px-6 py-4 text-center">Évaluations</th>
                  <th className="px-6 py-4 text-center">En Attente</th>
                  <th className="px-6 py-4 text-center">Absences</th>
                  <th className="px-6 py-4 text-center">Moyenne Matière</th>
                  <th className="px-6 py-4 text-center">Statut</th>
                  <th className="px-6 py-4 text-right">Détail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredStudents.map(st => (
                  <tr key={st.student_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-slate-300">
                      {st.student_number || '—'}
                    </td>
                    <td className="px-6 py-4 font-bold text-white">
                      {st.student_name}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center gap-1 font-bold text-slate-200">
                        {st.completed_assessment_count} / {st.assessment_count}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {st.pending_assessment_count > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-[11px]">
                          {st.pending_assessment_count} en attente
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px]">0</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-[11px]">
                        {st.excused_absence_count > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold" title="Absences justifiées">
                            {st.excused_absence_count} just.
                          </span>
                        )}
                        {st.unexcused_absence_count > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 font-bold" title="Absences non justifiées (0%)">
                            {st.unexcused_absence_count} non-just.
                          </span>
                        )}
                        {st.excused_absence_count === 0 && st.unexcused_absence_count === 0 && (
                          <span className="text-slate-500">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {st.subject_percentage !== null ? (
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-xl font-black text-sm ${
                            st.subject_percentage >= 70
                              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                              : st.subject_percentage >= 50
                              ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                              : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                          }`}
                        >
                          {st.subject_percentage} %
                        </span>
                      ) : (
                        <span className="text-slate-500 font-medium italic">Non calculé</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {st.error_message ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 border border-rose-500/30 text-rose-400" title={st.error_message}>
                          Erreur RPC
                        </span>
                      ) : st.is_complete ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Complet
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300">
                          <Clock className="w-3.5 h-3.5" />
                          Incomplet
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedStudentDetail(st);
                          setShowDetailModal(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Détail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Student Assessments Detail Modal */}
      {showDetailModal && selectedStudentDetail && (
        <Modal
          isOpen={showDetailModal}
          onClose={() => setShowDetailModal(false)}
          title={`Évaluations de ${selectedStudentDetail.student_name} (${currentSubject?.name})`}
        >
          <div className="space-y-4">
            {/* Student Meta Card */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div>
                <p className="text-slate-400 font-mono">Matricule : <strong className="text-amber-400">{selectedStudentDetail.student_number}</strong></p>
                <p className="text-white font-bold text-sm mt-0.5">{selectedStudentDetail.student_name}</p>
                <p className="text-slate-400 mt-0.5">{currentClass?.name} • {currentPeriod?.name}</p>
              </div>

              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Moyenne de la Période</p>
                <p className="text-2xl font-black text-amber-400">
                  {selectedStudentDetail.subject_percentage !== null ? `${selectedStudentDetail.subject_percentage} %` : 'En attente'}
                </p>
                <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 ${
                  selectedStudentDetail.is_complete ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                }`}>
                  {selectedStudentDetail.is_complete ? 'Résultat Complet' : 'Notes Manquantes'}
                </span>
              </div>
            </div>

            {/* List of Assessments */}
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {selectedStudentDetail.assessments.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs bg-slate-950 rounded-xl border border-slate-800">
                  Aucune évaluation enregistrée pour cette période.
                </div>
              ) : (
                selectedStudentDetail.assessments.map((asmt: any, idx: number) => (
                  <div key={asmt.assessment_id || idx} className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-extrabold text-white text-xs">{asmt.title}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Date : {asmt.assessment_date} • Barème : {asmt.max_score} pts • Coeff : {asmt.coefficient}
                        </p>
                      </div>

                      {/* Score or Absence status */}
                      <div className="text-right">
                        {asmt.is_absent ? (
                          asmt.is_excused ? (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 block">
                              Excusé (Exclu)
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/10 border border-rose-500/30 text-rose-400 block">
                              Absent non justifié (0 %)
                            </span>
                          )
                        ) : asmt.score !== null && asmt.score !== undefined ? (
                          <div className="text-right">
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

                    {/* Teacher Comment */}
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
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
