// Module Administrateur Établissement : Supervision des Notes et Évaluations
// Fichier : src/components/admin/AdminGradesModule.tsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../common/Modal';
import {
  Award,
  Filter,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RotateCcw,
  FileSpreadsheet,
  Lock,
  Search,
  Calculator,
  GraduationCap
} from 'lucide-react';
import type { AssessmentRow, GradebookItem, AssessmentMetrics } from '../teacher/TeacherGradesModule';
import { computeAssessmentMetrics } from '../teacher/TeacherGradesModule';
import { TeacherClassPeriodSummaryView } from '../teacher/TeacherClassPeriodSummaryView';
import { AdminReportCardsModule } from './AdminReportCardsModule';

interface AdminGradesModuleProps {
  teachers: any[];
  classes: any[];
  subjects: any[];
  schoolTerms: any[];
  schoolPeriods?: any[];
  onStatsChange?: (count: number) => void;
}

const ASSESSMENT_TYPE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  test: { label: 'Devoir Surveillé', bg: 'bg-indigo-500/20 border-indigo-500/40', text: 'text-indigo-300' },
  quiz: { label: 'Interrogation', bg: 'bg-sky-500/20 border-sky-500/40', text: 'text-sky-300' },
  exam: { label: 'Examen Trimestriel', bg: 'bg-purple-500/20 border-purple-500/40', text: 'text-purple-300' },
  homework: { label: 'Devoir Maison', bg: 'bg-emerald-500/20 border-emerald-500/40', text: 'text-emerald-300' },
  project: { label: 'Projet / TP', bg: 'bg-amber-500/20 border-amber-500/40', text: 'text-amber-300' },
  oral: { label: 'Évaluation Orale', bg: 'bg-pink-500/20 border-pink-500/40', text: 'text-pink-300' },
  practical: { label: 'Travaux Pratiques', bg: 'bg-cyan-500/20 border-cyan-500/40', text: 'text-cyan-300' },
  other: { label: 'Autre', bg: 'bg-slate-800 border-slate-700', text: 'text-slate-300' }
};

export const AdminGradesModule: React.FC<AdminGradesModuleProps> = ({
  teachers,
  classes,
  subjects,
  schoolTerms,
  schoolPeriods = [],
  onStatsChange
}) => {
  const { showToast } = useNotifications();

  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [assessmentMetricsMap, setAssessmentMetricsMap] = useState<Record<string, AssessmentMetrics>>({});
  const [loading, setLoading] = useState<boolean>(true);

  // View Switcher
  const [adminTab, setAdminTab] = useState<'supervision' | 'class_summary' | 'report_cards'>('supervision');

  // Filters
  const [teacherFilter, setTeacherFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [termFilter, setTermFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [cycleFilter, setCycleFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [showGradebookModal, setShowGradebookModal] = useState<boolean>(false);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [showReopenModal, setShowReopenModal] = useState<boolean>(false);
  const [showCorrectModal, setShowCorrectModal] = useState<boolean>(false);
  const [showAssignPeriodModal, setShowAssignPeriodModal] = useState<boolean>(false);

  const [selectedAsmt, setSelectedAsmt] = useState<AssessmentRow | null>(null);
  const [selectedAsmtForPeriod, setSelectedAsmtForPeriod] = useState<AssessmentRow | null>(null);
  const [assignPeriodId, setAssignPeriodId] = useState<string>('');
  const [assignPeriodReason, setAssignPeriodReason] = useState<string>('');
  const [submittingAssignPeriod, setSubmittingAssignPeriod] = useState<boolean>(false);

  // Gradebook State
  const [gradebookItems, setGradebookItems] = useState<GradebookItem[]>([]);
  const [loadingGradebook, setLoadingGradebook] = useState<boolean>(false);

  // Correction State
  const [selectedStudentGrade, setSelectedStudentGrade] = useState<GradebookItem | null>(null);
  const [correctScore, setCorrectScore] = useState<string>('');
  const [correctIsAbsent, setCorrectIsAbsent] = useState<boolean>(false);
  const [correctIsExcused, setCorrectIsExcused] = useState<boolean>(false);
  const [correctComment, setCorrectComment] = useState<string>('');
  const [adminActionReason, setAdminActionReason] = useState<string>('');
  const [submittingAction, setSubmittingAction] = useState<boolean>(false);

  // Load All School Assessments via RPC + Load all grades to compute accurate metrics
  const loadAssessments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_teacher_assessments');
      if (error) throw error;
      const list = (data || []) as AssessmentRow[];
      setAssessments(list);

      // Récupération des notes individuelles pour calcul unifié
      const { data: allGradesData } = await supabase
        .from('student_grades')
        .select('assessment_id, student_id, score, is_absent, is_excused');

      // Récupération des effectifs actifs par classe
      const { data: enrollmentsData } = await supabase
        .from('student_enrollments')
        .select('class_id, student_id')
        .eq('status', 'active');

      const gradesByAsmt = new Map<string, any[]>();
      (allGradesData || []).forEach((g: any) => {
        if (!gradesByAsmt.has(g.assessment_id)) {
          gradesByAsmt.set(g.assessment_id, []);
        }
        gradesByAsmt.get(g.assessment_id)!.push(g);
      });

      const enrollmentsByClass = new Map<string, number>();
      (enrollmentsData || []).forEach((e: any) => {
        enrollmentsByClass.set(e.class_id, (enrollmentsByClass.get(e.class_id) || 0) + 1);
      });

      const metricsMap: Record<string, AssessmentMetrics> = {};
      list.forEach(asmt => {
        const asmtGrades = gradesByAsmt.get(asmt.id) || [];
        const classTotal = enrollmentsByClass.get(asmt.class_id) || asmtGrades.length;
        metricsMap[asmt.id] = computeAssessmentMetrics(asmtGrades, asmt.max_score, classTotal);
      });
      setAssessmentMetricsMap(metricsMap);

      if (onStatsChange) onStatsChange(list.length);
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du chargement des évaluations de l’établissement.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [onStatsChange, showToast]);

  useEffect(() => {
    loadAssessments();
  }, [loadAssessments]);

  // Open Gradebook
  const openGradebook = async (asmt: AssessmentRow) => {
    setSelectedAsmt(asmt);
    setShowGradebookModal(true);
    setLoadingGradebook(true);

    try {
      const { data, error } = await supabase.rpc('get_assessment_gradebook', {
        p_assessment_id: asmt.id
      });
      if (error) throw error;
      setGradebookItems((data || []) as GradebookItem[]);
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la récupération des notes.', 'warning');
    } finally {
      setLoadingGradebook(false);
    }
  };

  // Open Correction
  const openCorrectionModal = (item: GradebookItem) => {
    setSelectedStudentGrade(item);
    setCorrectScore(item.score !== null ? item.score.toString() : '');
    setCorrectIsAbsent(item.is_absent);
    setCorrectIsExcused(item.is_excused);
    setCorrectComment(item.teacher_comment || '');
    setAdminActionReason('');
    setShowCorrectModal(true);
  };

  // Submit Admin Correction
  const handleAdminCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsmt || !selectedStudentGrade) return;

    if (!adminActionReason.trim() || adminActionReason.trim().length < 5) {
      showToast('Un motif administratif explicite (au moins 5 caractères) est obligatoire.', 'warning');
      return;
    }

    const numScore = correctScore !== '' && !correctIsAbsent ? parseFloat(correctScore) : null;
    if (!correctIsAbsent && numScore !== null && (numScore < 0 || numScore > selectedAsmt.max_score)) {
      showToast(`La note doit être comprise entre 0 et ${selectedAsmt.max_score}.`, 'warning');
      return;
    }

    setSubmittingAction(true);
    try {
      const payload = [{
        student_id: selectedStudentGrade.student_id,
        enrollment_id: selectedStudentGrade.enrollment_id,
        score: correctIsAbsent ? null : numScore,
        is_absent: correctIsAbsent,
        is_excused: correctIsExcused,
        teacher_comment: correctComment.trim() || null
      }];

      const { error } = await supabase.rpc('save_student_grades', {
        p_assessment_id: selectedAsmt.id,
        p_grades: payload,
        p_reason: `[ADMIN] ${adminActionReason.trim()}`
      });

      if (error) throw error;

      showToast(`Note rectifiée administrativement pour ${selectedStudentGrade.first_name} ${selectedStudentGrade.last_name}.`, 'success');
      setShowCorrectModal(false);
      await loadAssessments();
      const { data: refreshed } = await supabase.rpc('get_assessment_gradebook', {
        p_assessment_id: selectedAsmt.id
      });
      setGradebookItems((refreshed || []) as GradebookItem[]);
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la rectification administrative.', 'warning');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Submit Admin Cancel
  const handleAdminCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsmt) return;
    if (!adminActionReason.trim() || adminActionReason.trim().length < 5) {
      showToast('Un motif d’annulation explicite est obligatoire.', 'warning');
      return;
    }

    setSubmittingAction(true);
    try {
      const { error } = await supabase.rpc('cancel_teacher_assessment', {
        p_assessment_id: selectedAsmt.id,
        p_reason: `[ADMIN] ${adminActionReason.trim()}`
      });
      if (error) throw error;
      showToast('Évaluation annulée par la direction.', 'info');
      setShowCancelModal(false);
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’annulation.', 'warning');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Submit Admin Reopen
  const handleAdminReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsmt) return;
    if (!adminActionReason.trim() || adminActionReason.trim().length < 5) {
      showToast('Un motif de réouverture explicite est obligatoire.', 'warning');
      return;
    }

    setSubmittingAction(true);
    try {
      const { error } = await supabase.rpc('reopen_teacher_assessment', {
        p_assessment_id: selectedAsmt.id,
        p_reason: `[ADMIN] ${adminActionReason.trim()}`
      });
      if (error) throw error;
      showToast('Évaluation réouverte avec succès.', 'success');
      setShowReopenModal(false);
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la réouverture.', 'warning');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Open Assign Period Modal
  const openAssignPeriodModal = (asmt: AssessmentRow) => {
    setSelectedAsmtForPeriod(asmt);
    const cls = classes.find(c => c.id === asmt.class_id);
    const cycle = asmt.education_cycle || cls?.education_cycle;
    const compatible = (schoolPeriods || []).filter(p => !cycle || !p.education_cycle || p.education_cycle === cycle);
    setAssignPeriodId(compatible.length > 0 ? compatible[0].id : '');
    setAssignPeriodReason('');
    setShowAssignPeriodModal(true);
  };

  // Submit Assign Period
  const handleAssignPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsmtForPeriod || !assignPeriodId) return;
    if (!assignPeriodReason.trim() || assignPeriodReason.trim().length < 5) {
      showToast('Un motif d’au moins 5 caractères est obligatoire pour tracer le rattachement.', 'warning');
      return;
    }
    setSubmittingAssignPeriod(true);
    try {
      const { error } = await supabase.rpc('assign_assessment_to_period', {
        p_assessment_id: selectedAsmtForPeriod.id,
        p_period_id: assignPeriodId,
        p_reason: `[ADMIN] ${assignPeriodReason.trim()}`
      });
      if (error) throw error;
      showToast('Période assignée avec succès !', 'success');
      setShowAssignPeriodModal(false);
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du rattachement de la période.', 'warning');
    } finally {
      setSubmittingAssignPeriod(false);
    }
  };

  // Filtered List
  const filteredAssessments = useMemo(() => {
    return assessments.filter(a => {
      if (teacherFilter !== 'all' && a.teacher_id !== teacherFilter) return false;
      if (classFilter !== 'all' && a.class_id !== classFilter) return false;
      if (subjectFilter !== 'all' && a.subject_id !== subjectFilter) return false;
      if (termFilter !== 'all' && a.term_id !== termFilter) return false;
      if (periodFilter !== 'all') {
        if (periodFilter === 'none' && a.period_id) return false;
        if (periodFilter !== 'none' && a.period_id !== periodFilter) return false;
      }
      if (cycleFilter !== 'all') {
        const cls = classes.find(c => c.id === a.class_id);
        const cycle = a.education_cycle || cls?.education_cycle;
        if (cycle !== cycleFilter) return false;
      }
      if (typeFilter !== 'all' && a.assessment_type !== typeFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = a.title.toLowerCase().includes(q);
        const matchClass = a.class_name.toLowerCase().includes(q);
        const matchSubject = a.subject_name.toLowerCase().includes(q);
        const matchTeacher = a.teacher_name.toLowerCase().includes(q);
        if (!matchTitle && !matchClass && !matchSubject && !matchTeacher) return false;
      }
      return true;
    });
  }, [assessments, teacherFilter, classFilter, subjectFilter, termFilter, periodFilter, cycleFilter, typeFilter, statusFilter, searchQuery, classes]);

  return (
    <div className="space-y-6">
      {/* Sub-Tabs View Switcher */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-900/90 rounded-2xl border border-slate-800 w-fit text-xs font-bold shadow-lg">
        <button
          onClick={() => setAdminTab('supervision')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            adminTab === 'supervision'
              ? 'bg-amber-500 text-slate-950 font-black shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Award className="w-4 h-4" />
          <span>Supervision des Évaluations</span>
        </button>

        <button
          onClick={() => setAdminTab('class_summary')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            adminTab === 'class_summary'
              ? 'bg-amber-500 text-slate-950 font-black shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Calculator className="w-4 h-4" />
          <span>Synthèse Générale par Classe</span>
        </button>

        <button
          onClick={() => setAdminTab('report_cards')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            adminTab === 'report_cards'
              ? 'bg-amber-500 text-slate-950 font-black shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <GraduationCap className="w-4 h-4" />
          <span>Bulletins Périodiques</span>
        </button>
      </div>

      {adminTab === 'report_cards' && (
        <AdminReportCardsModule
          classes={classes}
          schoolPeriods={schoolPeriods}
          schoolTerms={schoolTerms}
          teachers={teachers}
        />
      )}

      {adminTab === 'class_summary' && (
        <TeacherClassPeriodSummaryView
          classes={classes}
          schoolPeriods={schoolPeriods}
          isSchoolAdmin={true}
        />
      )}

      {adminTab === 'supervision' && (
        <>
          {/* Header Info */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                <span>Supervision Pédagogique des Notes & Évaluations</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Consultez les carnets de notes de tous les enseignants, contrôlez les moyennes et tracez les corrections administratives.
              </p>
            </div>
          </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Évaluations</span>
          <p className="text-2xl font-black text-white">{assessments.length}</p>
          <span className="text-[10px] text-slate-500">Toutes classes & matières</span>
        </div>

        <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Publiées Officielles</span>
          <p className="text-2xl font-black text-emerald-400">
            {assessments.filter(a => a.status === 'published').length}
          </p>
          <span className="text-[10px] text-emerald-400 font-bold">Visibles aux familles</span>
        </div>

        <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Brouillons Enseignants</span>
          <p className="text-2xl font-black text-amber-400">
            {assessments.filter(a => a.status === 'draft').length}
          </p>
          <span className="text-[10px] text-amber-400/80">En cours de saisie</span>
        </div>

        <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Clôturées</span>
          <p className="text-2xl font-black text-indigo-400">
            {assessments.filter(a => a.status === 'closed').length}
          </p>
          <span className="text-[10px] text-indigo-400/80">Archivées</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
          <Filter className="w-4 h-4 text-amber-400" />
          <span>Filtres de supervision :</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-8 gap-2 text-xs">
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Rechercher titre, prof, classe, matière..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs placeholder:text-slate-500"
            />
          </div>

          <select
            value={cycleFilter}
            onChange={e => setCycleFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs"
          >
            <option value="all">Tous cycles</option>
            <option value="primary">Primaire</option>
            <option value="secondary">Secondaire</option>
          </select>

          <select
            value={teacherFilter}
            onChange={e => setTeacherFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs"
          >
            <option value="all">Tous enseignants</option>
            {teachers.map(t => (
              <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
            ))}
          </select>

          <select
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs"
          >
            <option value="all">Toutes classes</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            value={subjectFilter}
            onChange={e => setSubjectFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs"
          >
            <option value="all">Toutes matières</option>
            {subjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <select
            value={termFilter}
            onChange={e => setTermFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs"
          >
            <option value="all">Tous trimestres/semestres</option>
            {schoolTerms.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          <select
            value={periodFilter}
            onChange={e => setPeriodFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-bold text-amber-300"
          >
            <option value="all">Toutes périodes</option>
            <option value="none">⚠️ Période non définie</option>
            {(schoolPeriods || []).map(p => (
              <option key={p.id} value={p.id}>{p.name} (P{p.position})</option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs"
          >
            <option value="all">Tous types</option>
            <option value="test">Devoir Surveillé</option>
            <option value="quiz">Interrogation</option>
            <option value="exam">Examen</option>
            <option value="homework">Devoir Maison</option>
            <option value="project">Projet / TP</option>
            <option value="oral">Oral</option>
            <option value="practical">Pratique</option>
            <option value="other">Autre</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs"
          >
            <option value="all">Tous statuts</option>
            <option value="draft">Brouillon</option>
            <option value="published">Publié</option>
            <option value="closed">Clôturé</option>
            <option value="reopened">Réouvert</option>
            <option value="cancelled">Annulé</option>
          </select>
        </div>
      </div>

      {/* Supervision Table */}
      {loading ? (
        <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs font-bold text-slate-400">Chargement des évaluations de l’école...</p>
        </div>
      ) : filteredAssessments.length === 0 ? (
        <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
          <Award className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-sm font-extrabold text-white">Aucune évaluation enregistrée</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Les enseignants n'ont pas encore soumis d'évaluation dans les critères sélectionnés.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-slate-900 rounded-3xl border border-slate-800 shadow-xl">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                <th className="p-3.5">Évaluation & Titre</th>
                <th className="p-3.5">Enseignant Responsable</th>
                <th className="p-3.5">Classe & Matière</th>
                <th className="p-3.5">Date & Trimestre</th>
                <th className="p-3.5">Barème & Moyenne</th>
                <th className="p-3.5">Statut</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredAssessments.map(asmt => {
                const typeInfo = ASSESSMENT_TYPE_LABELS[asmt.assessment_type] || ASSESSMENT_TYPE_LABELS.other;
                const metrics = assessmentMetricsMap[asmt.id] || computeAssessmentMetrics([], asmt.max_score);
                return (
                  <tr key={asmt.id} className="hover:bg-slate-950/40 transition-colors">
                    <td className="p-3.5">
                      <div className="space-y-0.5">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-[9px] font-bold border ${typeInfo.bg} ${typeInfo.text}`}>
                          {typeInfo.label}
                        </span>
                        <p className="font-extrabold text-white text-xs">{asmt.title}</p>
                      </div>
                    </td>
                    <td className="p-3.5">
                      <p className="font-bold text-slate-200">{asmt.teacher_name}</p>
                    </td>
                    <td className="p-3.5">
                      <p className="font-extrabold text-white">{asmt.class_name}</p>
                      <p className="text-[11px] text-amber-400">{asmt.subject_name}</p>
                    </td>
                    <td className="p-3.5 text-slate-300">
                      <p className="font-medium">{new Date(asmt.assessment_date).toLocaleDateString('fr-FR')}</p>
                      {asmt.period_id ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded text-[10px] font-bold">
                            {asmt.period_name || `Période #${asmt.period_position}`}
                          </span>
                          <span className="text-[10px] text-slate-500">({asmt.term_name})</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="px-1.5 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded text-[10px] font-bold">
                            Période non définie
                          </span>
                          <button
                            onClick={() => openAssignPeriodModal(asmt)}
                            className="px-1.5 py-0.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-[9px] cursor-pointer"
                          >
                            Rattacher
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="p-3.5">
                      <p className="font-mono font-bold text-slate-200">Barème : /{asmt.max_score} (Coef {asmt.coefficient})</p>
                      <p className="text-[11px] text-emerald-400 font-bold">
                        Moy : {metrics.averageScore !== null ? `${metrics.averageScoreDisplay} (${metrics.averagePercentageDisplay})` : '—'} ({metrics.processedCount}/{metrics.totalStudents} traités)
                      </p>
                    </td>
                    <td className="p-3.5">
                      {asmt.status === 'draft' && (
                        <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-[10px] font-black uppercase">
                          Brouillon
                        </span>
                      )}
                      {asmt.status === 'published' && (
                        <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Publié</span>
                        </span>
                      )}
                      {asmt.status === 'closed' && (
                        <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit">
                          <Lock className="w-3 h-3" />
                          <span>Clôturé</span>
                        </span>
                      )}
                      {asmt.status === 'reopened' && (
                        <span className="px-2.5 py-1 bg-sky-500/20 text-sky-300 border border-sky-500/40 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit">
                          <RotateCcw className="w-3 h-3" />
                          <span>Réouvert</span>
                        </span>
                      )}
                      {asmt.status === 'cancelled' && (
                        <span className="px-2.5 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-full text-[10px] font-black uppercase">
                          Annulé
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openGradebook(asmt)}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-[11px] cursor-pointer flex items-center gap-1"
                        >
                          <FileSpreadsheet className="w-3 h-3" />
                          <span>Carnet</span>
                        </button>

                        {asmt.status === 'closed' && (
                          <button
                            onClick={() => {
                              setSelectedAsmt(asmt);
                              setAdminActionReason('');
                              setShowReopenModal(true);
                            }}
                            className="p-1.5 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 rounded-xl cursor-pointer"
                            title="Réouvrir l'évaluation"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {asmt.status !== 'cancelled' && (
                          <button
                            onClick={() => {
                              setSelectedAsmt(asmt);
                              setAdminActionReason('');
                              setShowCancelModal(true);
                            }}
                            className="p-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl cursor-pointer"
                            title="Annuler l'évaluation"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}

      {/* MODAL 1: CARNET DE NOTES COMPLET */}
      {showGradebookModal && selectedAsmt && (
        <Modal
          isOpen={showGradebookModal}
          onClose={() => setShowGradebookModal(false)}
          title={`Supervision Carnet : ${selectedAsmt.title}`}
          darkMode={true}
          maxWidth="5xl"
        >
          <div className="space-y-4 text-xs max-h-[80vh] flex flex-col">
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Enseignant</span>
                <span className="font-bold text-white">{selectedAsmt.teacher_name}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Classe & Matière</span>
                <span className="font-bold text-amber-400">{selectedAsmt.class_name} • {selectedAsmt.subject_name}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Barème & Coef</span>
                <span className="font-mono font-bold text-slate-200">/{selectedAsmt.max_score} (Coef {selectedAsmt.coefficient})</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Moyenne de classe</span>
                <span className="font-mono font-black text-emerald-400">
                  {computeAssessmentMetrics(gradebookItems, selectedAsmt.max_score).averageScore !== null
                    ? `${computeAssessmentMetrics(gradebookItems, selectedAsmt.max_score).averageScoreDisplay} (${computeAssessmentMetrics(gradebookItems, selectedAsmt.max_score).averagePercentageDisplay})`
                    : '—'}
                </span>
              </div>
            </div>

            <div className="overflow-y-auto border border-slate-800 rounded-2xl flex-1 max-h-[50vh]">
              {loadingGradebook ? (
                <div className="p-8 text-center text-slate-400">Chargement des notes des élèves...</div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-950 text-slate-400 uppercase font-bold border-b border-slate-800 z-10">
                    <tr>
                      <th className="p-2.5">Matricule</th>
                      <th className="p-2.5">Élève</th>
                      <th className="p-2.5">Note (/{selectedAsmt.max_score})</th>
                      <th className="p-2.5">Présence</th>
                      <th className="p-2.5">Commentaire</th>
                      <th className="p-2.5 text-right">Action Admin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {gradebookItems.map(item => (
                      <tr key={item.student_id} className="hover:bg-slate-950/60 transition-colors">
                        <td className="p-2.5 font-mono text-amber-400 font-bold">{item.student_number}</td>
                        <td className="p-2.5 font-extrabold text-white">
                          {item.last_name} {item.first_name}
                        </td>
                        <td className="p-2.5">
                          {item.is_absent ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40">
                              ABSENT {item.is_excused ? '(Excusé)' : ''}
                            </span>
                          ) : item.score !== null ? (
                            <span className="font-mono font-bold text-white text-sm">
                              {item.score} <span className="text-slate-500 text-xs">/{selectedAsmt.max_score}</span>
                            </span>
                          ) : (
                            <span className="text-slate-500 font-italic">Non noté</span>
                          )}
                        </td>
                        <td className="p-2.5">
                          {item.is_absent ? (
                            <span className="text-rose-400 font-bold">Absent</span>
                          ) : (
                            <span className="text-emerald-400 font-bold">Présent</span>
                          )}
                        </td>
                        <td className="p-2.5 text-slate-400 text-[11px]">
                          {item.teacher_comment || '—'}
                        </td>
                        <td className="p-2.5 text-right">
                          <button
                            onClick={() => openCorrectionModal(item)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-200 rounded-lg font-bold text-[10px] cursor-pointer transition-colors"
                          >
                            Rectifier
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => setShowGradebookModal(false)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl font-bold cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: RECTIFICATION ADMINISTRATIVE */}
      {showCorrectModal && selectedStudentGrade && selectedAsmt && (
        <Modal
          isOpen={showCorrectModal}
          onClose={() => setShowCorrectModal(false)}
          title={`Rectification Administrative : ${selectedStudentGrade.last_name} ${selectedStudentGrade.first_name}`}
          darkMode={true}
        >
          <form onSubmit={handleAdminCorrection} className="space-y-4 text-xs">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-[11px]">
              Toute intervention de la direction est formellement consignée dans le journal d'audit de l'établissement avec l'auteur et le motif.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Nouvelle Note (/{selectedAsmt.max_score})</label>
                <input
                  type="number"
                  min={0}
                  max={selectedAsmt.max_score}
                  step="any"
                  disabled={correctIsAbsent}
                  value={correctScore}
                  onChange={e => setCorrectScore(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono font-bold"
                />
              </div>

              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 p-2 bg-slate-950 rounded-xl border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={correctIsAbsent}
                    onChange={e => {
                      setCorrectIsAbsent(e.target.checked);
                      if (e.target.checked) setCorrectScore('');
                    }}
                    className="w-4 h-4 accent-rose-500"
                  />
                  <span className="font-bold text-slate-200">Élève Absent</span>
                </label>
              </div>

              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 p-2 bg-slate-950 rounded-xl border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!correctIsAbsent}
                    checked={correctIsExcused}
                    onChange={e => setCorrectIsExcused(e.target.checked)}
                    className="w-4 h-4 accent-indigo-500 disabled:opacity-40"
                  />
                  <span className="font-bold text-slate-200">Absence Excusée</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Commentaire Administratif</label>
              <input
                type="text"
                value={correctComment}
                onChange={e => setCorrectComment(e.target.value)}
                placeholder="Mention de décision..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
              />
            </div>

            <div>
              <label className="block font-bold text-amber-400 mb-1">Motif explicite de la rectification administrative *</label>
              <textarea
                required
                value={adminActionReason}
                onChange={e => setAdminActionReason(e.target.value)}
                rows={2}
                placeholder="Ex: Décision du conseil de discipline / rectification après délibération officielle..."
                className="w-full px-3 py-2 bg-slate-950 border border-amber-500/40 text-white rounded-xl text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCorrectModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingAction}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl cursor-pointer"
              >
                {submittingAction ? 'Enregistrement...' : 'Valider la Rectification'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: ANNULER UNE ÉVALUATION (ADMIN) */}
      {showCancelModal && selectedAsmt && (
        <Modal
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title={`Annulation Administrative : ${selectedAsmt.title}`}
          darkMode={true}
        >
          <form onSubmit={handleAdminCancel} className="space-y-4 text-xs">
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>Attention : L'annulation administrative neutralise l'évaluation et invalide ses notes dans le calcul des moyennes.</span>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Motif administratif d'annulation *</label>
              <textarea
                required
                value={adminActionReason}
                onChange={e => setAdminActionReason(e.target.value)}
                rows={3}
                placeholder="Ex: Annulation ordonnée par la direction suite à une non-conformité de barème..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-white rounded-xl text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Retour
              </button>
              <button
                type="submit"
                disabled={submittingAction}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-xl cursor-pointer"
              >
                {submittingAction ? 'Annulation...' : 'Confirmer l’Annulation Administrative'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: RÉOUVRIR UNE ÉVALUATION (ADMIN) */}
      {showReopenModal && selectedAsmt && (
        <Modal
          isOpen={showReopenModal}
          onClose={() => setShowReopenModal(false)}
          title={`Réouverture Administrative : ${selectedAsmt.title}`}
          darkMode={true}
        >
          <form onSubmit={handleAdminReopen} className="space-y-4 text-xs">
            <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sky-300 text-xs flex items-center gap-2">
              <RotateCcw className="w-5 h-5 flex-shrink-0" />
              <span>La réouverture administrative autorise l'enseignant ou la direction à modifier les notes d'une évaluation précédemment clôturée.</span>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Motif administratif de réouverture *</label>
              <textarea
                required
                value={adminActionReason}
                onChange={e => setAdminActionReason(e.target.value)}
                rows={3}
                placeholder="Ex: Réouverture autorisée par la direction pour rattrapage..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-white rounded-xl text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowReopenModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingAction}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-black rounded-xl cursor-pointer"
              >
                {submittingAction ? 'Réouverture...' : 'Confirmer la Réouverture'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: RATTACHEMENT ADMINISTRATIF À UNE PÉRIODE */}
      {showAssignPeriodModal && selectedAsmtForPeriod && (
        <Modal
          isOpen={showAssignPeriodModal}
          onClose={() => setShowAssignPeriodModal(false)}
          title={`Rattachement Périodique : ${selectedAsmtForPeriod.title}`}
          darkMode={true}
        >
          <form onSubmit={handleAssignPeriod} className="space-y-4 text-xs">
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-2 text-amber-200">
              <h4 className="font-extrabold text-white text-sm flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span>Rattachement Administratif Officiel</span>
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 pt-1">
                <div>
                  <span className="text-slate-400 font-bold">Classe & Enseignant :</span>
                  <p className="font-extrabold text-white">{selectedAsmtForPeriod.class_name}</p>
                  <p className="text-slate-400 text-[10px]">{selectedAsmtForPeriod.teacher_name}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-bold">Matière & Statut :</span>
                  <p className="font-extrabold text-amber-400">{selectedAsmtForPeriod.subject_name}</p>
                  <p className="text-slate-400 text-[10px] uppercase font-mono">{selectedAsmtForPeriod.status}</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Période Scolaire Compatible *</label>
              <select
                required
                value={assignPeriodId}
                onChange={e => setAssignPeriodId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-amber-500/60 rounded-xl text-white font-bold text-xs focus:outline-none focus:border-amber-400 cursor-pointer"
              >
                <option value="">-- Sélectionnez la période --</option>
                {(schoolPeriods || [])
                  .filter(p => {
                    const cls = classes.find(c => c.id === selectedAsmtForPeriod.class_id);
                    const cycle = selectedAsmtForPeriod.education_cycle || cls?.education_cycle;
                    return !cycle || !p.education_cycle || p.education_cycle === cycle;
                  })
                  .map(p => {
                    const parentTerm = schoolTerms.find(t => t.id === p.parent_term_id);
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} (Position #{p.position}) — {parentTerm?.name || 'Terme'}
                      </option>
                    );
                  })}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Motif administratif de rattachement *</label>
              <textarea
                required
                rows={3}
                value={assignPeriodReason}
                onChange={e => setAssignPeriodReason(e.target.value)}
                placeholder="Ex: Rattachement officiel ordonné par la direction pour l'évaluation du 1er Semestre..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 text-white rounded-xl text-xs focus:outline-none focus:border-amber-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Le rattachement réaligne automatiquement le trimestre/semestre parent et est consigné dans le journal d'audit de l'école.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAssignPeriodModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingAssignPeriod || !assignPeriodId}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl cursor-pointer disabled:opacity-50"
              >
                {submittingAssignPeriod ? 'Rattachement...' : 'Confirmer le Rattachement'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
