// Fichier : src/components/teacher/TeacherClassPeriodSummaryView.tsx
// Vue Enseignant Titulaire & Administration : Synthèse Générale & Bulletins Périodiques (Phase 2F.3)

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../common/Modal';
import {
  GraduationCap,
  CheckCircle2,
  Clock,
  Search,
  Eye,
  Users,
  FileSpreadsheet,
  Calendar,
  Layers,
  Filter
} from 'lucide-react';
import { TeacherReportCardBatchView } from './TeacherReportCardBatchView';

interface TeacherClassPeriodSummaryViewProps {
  classes: any[];
  schoolPeriods: any[];
  schoolTerms?: any[];
  assignments?: any[];
  teacherRecord?: any;
  isSchoolAdmin?: boolean;
}

interface ClassStudentSummary {
  student_id: string;
  student_number: string;
  student_name: string;
  enrollment_id: string;
  overall_percentage: number | null;
  completed_subjects_count: number;
  pending_subjects_count: number;
  is_complete: boolean;
}

interface StudentFullPeriodDetail {
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
  subjects: Array<{
    subject_id: string;
    subject_name: string;
    subject_coefficient: number;
    subject_percentage: number | null;
    is_complete: boolean;
    assessment_count: number;
    completed_assessment_count: number;
    pending_assessment_count: number;
  }>;
}

export const TeacherClassPeriodSummaryView: React.FC<TeacherClassPeriodSummaryViewProps> = ({
  classes = [],
  schoolPeriods = [],
  schoolTerms = [],
  assignments = [],
  teacherRecord = null,
  isSchoolAdmin = false
}) => {
  const { showToast } = useNotifications();

  // Sub Tab Switcher : "summary" (Résultats de la période) vs "report_cards" (Bulletins périodiques)
  const [subTab, setSubTab] = useState<'summary' | 'report_cards'>('summary');

  // Filter Classes to active assigned classes or homeroom classes for this teacher
  const filteredTeacherClasses = useMemo(() => {
    if (isSchoolAdmin || classes.length <= 1) return classes;
    const assignedClassIds = new Set(assignments.map(a => a.class_id));
    const matched = classes.filter(c =>
      assignedClassIds.has(c.id) ||
      (Boolean(teacherRecord?.profile_id) && Boolean(c.homeroom_teacher_id) && c.homeroom_teacher_id === teacherRecord.profile_id)
    );
    return matched.length > 0 ? matched : classes;
  }, [classes, assignments, teacherRecord?.profile_id, isSchoolAdmin]);

  // Filters State
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedTermId, setSelectedTermId] = useState<string>('all');
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Data State
  const [loading, setLoading] = useState<boolean>(false);
  const [studentsList, setStudentsList] = useState<ClassStudentSummary[]>([]);

  // Student Detail Modal
  const [showStudentModal, setShowStudentModal] = useState<boolean>(false);
  const [loadingStudentDetail, setLoadingStudentDetail] = useState<boolean>(false);
  const [studentDetail, setStudentDetail] = useState<StudentFullPeriodDetail | null>(null);

  // Anti-spam notifications ref
  const lastToastErrorRef = useRef<string | null>(null);

  const notifyErrorOnce = useCallback((message: string) => {
    if (lastToastErrorRef.current !== message) {
      lastToastErrorRef.current = message;
      showToast(message, 'warning');
    }
  }, [showToast]);

  // Initialize selected class (default to first assigned class, e.g. 1A)
  useEffect(() => {
    if (filteredTeacherClasses.length > 0) {
      if (!selectedClassId || !filteredTeacherClasses.some(c => c.id === selectedClassId)) {
        setSelectedClassId(filteredTeacherClasses[0].id);
      }
    }
  }, [filteredTeacherClasses, selectedClassId]);

  // Selected Class details
  const selectedClass = useMemo(() => {
    return filteredTeacherClasses.find(c => c.id === selectedClassId) || classes.find(c => c.id === selectedClassId);
  }, [filteredTeacherClasses, classes, selectedClassId]);

  // Check if current user is homeroom teacher of selected class (Règle canonique : teacherRecord.profile_id)
  const isHomeroomTeacher = useMemo(() => {
    if (isSchoolAdmin) return true;
    return Boolean(teacherRecord?.profile_id) && Boolean(selectedClass?.homeroom_teacher_id) && selectedClass?.homeroom_teacher_id === teacherRecord.profile_id;
  }, [selectedClass, teacherRecord?.profile_id, isSchoolAdmin]);

  // Assigned subject IDs for this class
  const assignedSubjectIds = useMemo(() => {
    return assignments
      .filter(a => a.class_id === selectedClassId && a.subject_id)
      .map(a => a.subject_id as string);
  }, [assignments, selectedClassId]);

  // Available periods for this class's cycle and selected term
  const availablePeriods = useMemo(() => {
    if (!selectedClass) return schoolPeriods;
    const cycle = selectedClass.education_cycle;
    return (schoolPeriods || []).filter(p => {
      const matchCycle = !cycle || !p.education_cycle || p.education_cycle === cycle;
      const matchTerm = selectedTermId === 'all' || p.term_id === selectedTermId;
      return matchCycle && matchTerm;
    });
  }, [selectedClass, schoolPeriods, selectedTermId]);

  // Initialize selected period
  useEffect(() => {
    if (availablePeriods.length > 0) {
      if (!selectedPeriodId || !availablePeriods.some(p => p.id === selectedPeriodId)) {
        setSelectedPeriodId(availablePeriods[0].id);
      }
    } else {
      setSelectedPeriodId('');
    }
  }, [availablePeriods, selectedPeriodId]);

  // Load Class Results via RPC get_class_period_results
  const loadClassPeriodResults = useCallback(async () => {
    if (!selectedClassId || !selectedPeriodId) {
      setStudentsList([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_class_period_results', {
        p_class_id: selectedClassId,
        p_period_id: selectedPeriodId
      });

      if (error) throw error;

      if (data) {
        const list: ClassStudentSummary[] = (data.students || []).map((s: any) => ({
          student_id: s.student_id,
          student_number: s.student_number || '',
          student_name: s.student_name || 'Élève',
          enrollment_id: s.enrollment_id,
          overall_percentage: s.overall_percentage !== undefined ? s.overall_percentage : null,
          completed_subjects_count: s.completed_subjects_count || 0,
          pending_subjects_count: s.pending_subjects_count || 0,
          is_complete: !!s.is_complete
        }));

        setStudentsList(list);
      }
    } catch (err: any) {
      console.error('[TeacherClassPeriodSummaryView] Erreur get_class_period_results:', err);
      const isAccessError = (err.message || '').includes('titulaire') || (err.message || '').includes('Accès non autorisé');
      const msg = isAccessError
        ? 'Accès réservé au professeur titulaire de cette classe ou à l’administration.'
        : (err.message || 'Erreur lors du chargement de la synthèse de classe.');
      notifyErrorOnce(msg);
      setStudentsList([]);
    } finally {
      setLoading(false);
    }
  }, [selectedClassId, selectedPeriodId, notifyErrorOnce]);

  useEffect(() => {
    loadClassPeriodResults();
  }, [selectedClassId, selectedPeriodId, loadClassPeriodResults]);

  // Open Student Detail Modal via RPC get_student_period_result
  const handleOpenStudentDetail = async (studentId: string) => {
    if (!selectedPeriodId) return;

    setShowStudentModal(true);
    setLoadingStudentDetail(true);
    setStudentDetail(null);

    try {
      const { data, error } = await supabase.rpc('get_student_period_result', {
        p_student_id: studentId,
        p_period_id: selectedPeriodId
      });

      if (error) throw error;

      if (data) {
        setStudentDetail(data as StudentFullPeriodDetail);
      }
    } catch (err: any) {
      console.error('[TeacherClassPeriodSummaryView] Erreur get_student_period_result:', err);
      notifyErrorOnce(err.message || 'Erreur lors du chargement des détails de l’élève.');
    } finally {
      setLoadingStudentDetail(false);
    }
  };

  // Search Filter
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return studentsList;
    const q = searchQuery.toLowerCase();
    return studentsList.filter(
      st =>
        st.student_name.toLowerCase().includes(q) ||
        st.student_number.toLowerCase().includes(q)
    );
  }, [studentsList, searchQuery]);

  // Class Stats Overview
  const classStats = useMemo(() => {
    const total = studentsList.length;
    const complete = studentsList.filter(s => s.is_complete).length;
    const validScores = studentsList.filter(s => s.overall_percentage !== null).map(s => Number(s.overall_percentage));
    const avgScore = validScores.length > 0 ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2) : '—';
    const passedCount = validScores.filter(sc => sc >= 50).length;

    return {
      total,
      complete,
      pending: total - complete,
      avgScore,
      passedCount
    };
  }, [studentsList]);

  const selectedPeriodName = useMemo(() => {
    return availablePeriods.find(p => p.id === selectedPeriodId)?.name || 'Période';
  }, [availablePeriods, selectedPeriodId]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <GraduationCap className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              Résultats & Bulletins Périodiques de Classe
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Consultez les moyennes générales consolidées, préparez les appréciations officielles et générez les bulletins de classe.
            </p>
          </div>
        </div>

        {/* Overview Stats Badges */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Effectif Actif</p>
            <p className="text-sm font-black text-white">{classStats.total} élèves</p>
          </div>
          <div className="bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Moyenne Générale</p>
            <p className="text-sm font-black text-amber-400">
              {classStats.avgScore !== '—' ? `${classStats.avgScore} %` : '—'}
            </p>
          </div>
          <div className="bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800 text-center">
            <p className="text-[10px] uppercase font-bold text-slate-400">Résultats Complets</p>
            <p className="text-sm font-black text-emerald-400">
              {classStats.complete} / {classStats.total}
            </p>
          </div>
        </div>
      </div>

      {/* Selectors Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
        <div className="flex items-center gap-2 text-xs font-extrabold text-amber-400">
          <Filter className="w-4 h-4" />
          <span className="uppercase tracking-wider">Sélection de la Classe et de la Période Scolaire</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Class Selector */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Classe Attribuée *</span>
            </label>
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-bold focus:outline-none focus:border-amber-500 cursor-pointer"
            >
              {filteredTeacherClasses.map(c => {
                const isHr = isSchoolAdmin || (Boolean(teacherRecord?.profile_id) && Boolean(c.homeroom_teacher_id) && c.homeroom_teacher_id === teacherRecord.profile_id);
                return (
                  <option key={c.id} value={c.id}>
                    {c.name} {isHr ? '★ (Titulaire)' : ''} {c.education_cycle ? `[${c.education_cycle === 'primary' ? 'Primaire' : 'Secondaire'}]` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Term / Semester Selector */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span>Trimestre / Semestre</span>
            </label>
            <select
              value={selectedTermId}
              onChange={e => setSelectedTermId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
            >
              <option value="all">Tous les semestres / trimestres</option>
              {schoolTerms.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Period Selector */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Période Scolaire *</span>
            </label>
            <select
              value={selectedPeriodId}
              onChange={e => setSelectedPeriodId(e.target.value)}
              disabled={availablePeriods.length === 0}
              className="w-full bg-slate-950 border border-amber-500/60 rounded-xl px-3.5 py-2.5 text-xs text-white font-extrabold focus:outline-none focus:border-amber-400 cursor-pointer disabled:opacity-50"
            >
              {availablePeriods.length === 0 ? (
                <option value="">Aucune période disponible pour ce cycle</option>
              ) : (
                availablePeriods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} (Position #{p.position})
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Sub-Tabs Switcher */}
        <div className="pt-3 border-t border-slate-800 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSubTab('summary')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 cursor-pointer transition-all ${
              subTab === 'summary'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Résultats de la période (Synthèse)</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('report_cards')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 cursor-pointer transition-all ${
              subTab === 'report_cards'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <GraduationCap className="w-4 h-4" />
            <span>Bulletins Périodiques (Préparation & Soumission)</span>
          </button>
        </div>
      </div>

      {/* SUB-VIEW 1: Bulletins Périodiques */}
      {subTab === 'report_cards' && (
        <TeacherReportCardBatchView
          selectedClassId={selectedClassId}
          selectedPeriodId={selectedPeriodId}
          className={selectedClass?.name || 'Classe'}
          periodName={selectedPeriodName}
          isHomeroomTeacher={isHomeroomTeacher}
          assignedSubjectIds={assignedSubjectIds}
          onBatchUpdated={loadClassPeriodResults}
        />
      )}

      {/* SUB-VIEW 2: Synthèse Générale Table */}
      {subTab === 'summary' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Filtrer un élève par nom ou matricule..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="text-xs text-slate-400 font-bold">
              Affichage de {filteredStudents.length} élève{filteredStudents.length > 1 ? 's' : ''}
            </div>
          </div>

          {/* Results Table */}
          {loading ? (
            <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
              <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-400">Calcul des résultats de la période...</p>
            </div>
          ) : studentsList.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
              <Users className="w-12 h-12 text-slate-600 mx-auto" />
              <p className="text-sm font-bold text-slate-300">Aucun résultat disponible pour cette classe</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Vérifiez que des inscriptions sont actives et que des évaluations publiées existent pour cette période.
              </p>
            </div>
          ) : (
            <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-extrabold text-[10px]">
                      <th className="p-4">Matricule & Nom de l'Élève</th>
                      <th className="p-4 text-center">Moyenne Générale (%)</th>
                      <th className="p-4 text-center">Matières Complétées</th>
                      <th className="p-4 text-center">Statut Global</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {filteredStudents.map(st => {
                      const percentage = st.overall_percentage !== null ? Number(st.overall_percentage).toFixed(1) : null;
                      const isPassing = percentage !== null && Number(percentage) >= 50;

                      return (
                        <tr key={st.student_id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="p-4">
                            <span className="font-extrabold text-white block text-sm">{st.student_name}</span>
                            <span className="font-mono text-slate-400 text-[11px]">{st.student_number}</span>
                          </td>

                          <td className="p-4 text-center">
                            {percentage !== null ? (
                              <span className={`text-base font-black ${isPassing ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {percentage} %
                              </span>
                            ) : (
                              <span className="text-slate-500 font-bold">—</span>
                            )}
                          </td>

                          <td className="p-4 text-center">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-xl font-mono text-[11px]">
                              <span className="text-emerald-400 font-bold">{st.completed_subjects_count}</span>
                              <span className="text-slate-600">/</span>
                              <span className="text-slate-400">{st.completed_subjects_count + st.pending_subjects_count}</span>
                            </div>
                          </td>

                          <td className="p-4 text-center">
                            {st.is_complete ? (
                              <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-xl font-bold text-[10px] inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>Complet</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-xl font-bold text-[10px] inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 text-amber-400" />
                                <span>{st.pending_subjects_count} en attente</span>
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleOpenStudentDetail(st.student_id)}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5 text-amber-400" />
                              <span>Détail</span>
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
      )}

      {/* Student Period Breakdown Modal */}
      {showStudentModal && (
        <Modal
          isOpen={showStudentModal}
          onClose={() => setShowStudentModal(false)}
          title={`Résultats Détaillés : ${studentDetail?.student_name || 'Élève'}`}
          darkMode={true}
        >
          {loadingStudentDetail ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-400">Chargement des matières et évaluations...</p>
            </div>
          ) : !studentDetail ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              Aucun détail disponible pour cet élève.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* Header Info */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
                <div>
                  <p className="font-mono text-slate-400 text-[11px]">{studentDetail.student_number}</p>
                  <h3 className="font-extrabold text-white text-base">{studentDetail.student_name}</h3>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    {studentDetail.class_name} • {studentDetail.period_name} ({studentDetail.term_name})
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Moyenne Générale</span>
                  <span className={`text-xl font-black ${Number(studentDetail.overall_percentage || 0) >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {studentDetail.overall_percentage !== null ? `${Number(studentDetail.overall_percentage).toFixed(1)} %` : '—'}
                  </span>
                </div>
              </div>

              {/* Subjects Breakdown List */}
              <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                {studentDetail.subjects.map(sbj => {
                  const pct = sbj.subject_percentage !== null ? Number(sbj.subject_percentage).toFixed(1) : null;
                  const isPassing = pct !== null && Number(pct) >= 50;

                  return (
                    <div
                      key={sbj.subject_id}
                      className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 flex items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <p className="font-bold text-white text-xs">{sbj.subject_name}</p>
                        <p className="text-[11px] text-slate-400">
                          Coeff: <strong className="text-slate-200">{sbj.subject_coefficient}</strong> • Évaluations: {sbj.completed_assessment_count}/{sbj.assessment_count}
                        </p>
                      </div>

                      <div className="text-right">
                        {pct !== null ? (
                          <span className={`font-black text-sm ${isPassing ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {pct} %
                          </span>
                        ) : (
                          <span className="text-slate-500 font-bold text-xs">En attente</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowStudentModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};
