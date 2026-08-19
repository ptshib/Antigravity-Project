// Module Enseignant : Gestion Réelle des Notes et Évaluations
// Fichier : src/components/teacher/TeacherGradesModule.tsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../common/Modal';
import {
  Award,
  Plus,
  Filter,
  CheckCircle2,
  AlertCircle,
  Edit3,
  XCircle,
  RotateCcw,
  Calculator,
  Send,
  Lock,
  Search,
  UserCheck,
  FileSpreadsheet,
  Calendar,
  GraduationCap
} from 'lucide-react';
import { TeacherClassPeriodSummaryView } from './TeacherClassPeriodSummaryView';

function formatDateFr(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
}

export interface AssessmentRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  term_id: string | null;
  term_name: string | null;
  period_id?: string | null;
  period_name?: string | null;
  period_position?: number | null;
  position_within_parent?: number | null;
  division_type?: string | null;
  education_cycle?: string | null;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string;
  teacher_name: string;
  title: string;
  description: string | null;
  assessment_type: 'quiz' | 'test' | 'exam' | 'homework' | 'project' | 'oral' | 'practical' | 'other';
  assessment_date: string;
  max_score: number;
  coefficient: number;
  status: 'draft' | 'published' | 'closed' | 'cancelled' | 'reopened';
  published_at: string | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  grades_count: number;
  average_score: number | null;
}

export interface GradebookItem {
  assessment_id: string;
  student_id: string;
  enrollment_id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  score: number | null;
  is_absent: boolean;
  is_excused: boolean;
  teacher_comment: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AssessmentMetrics {
  total: number;
  totalStudents: number;
  gradedCount: number;
  absentCount: number;
  excusedCount: number;
  unexcusedCount: number;
  pendingCount: number;
  processedCount: number;
  includedCount: number;
  isComplete: boolean;
  averagePercentage: number | null;
  averageScore: number | null;
  averagePercentageDisplay: string;
  averageScoreDisplay: string;
}

/**
 * Calcul centralisé des métriques d'évaluation selon les règles métier officielles :
 * 1. Élève présent avec note : normalized = (score / max_score) * 100 -> inclus dans la moyenne
 * 2. Élève absent non excusé : normalized = 0 % -> inclus dans la moyenne (numérateur + 0, dénominateur + 1)
 * 3. Élève absent excusé : totalement exclu du numérateur et du dénominateur
 * 4. Élève sans note et non absent : pending, non compté comme zéro, saisie incomplète
 */
export function computeAssessmentMetrics(
  grades: Array<{
    score: number | null | string;
    is_absent?: boolean | null;
    is_excused?: boolean | null;
  }>,
  maxScore: number = 20,
  totalClassStudents?: number
): AssessmentMetrics {
  const max = maxScore > 0 ? maxScore : 20;

  let gradedCount = 0;
  let excusedCount = 0;
  let unexcusedCount = 0;
  let pendingCount = 0;

  let sumNormalizedPercentages = 0;
  let includedCount = 0;

  grades.forEach(item => {
    if (item.is_absent) {
      if (item.is_excused) {
        // Règle 3 : Absent excusé -> exclu totalement
        excusedCount++;
      } else {
        // Règle 2 : Absent non excusé -> normalized = 0 %, inclus dans la moyenne
        unexcusedCount++;
        includedCount++;
        sumNormalizedPercentages += 0;
      }
    } else {
      const hasScore = item.score !== null && item.score !== undefined && (item.score as any) !== '';
      if (hasScore) {
        // Règle 1 : Présent avec note -> normalized = (score / max_score) * 100
        gradedCount++;
        includedCount++;
        const numericScore = Number(item.score);
        const normalized = max > 0 ? (numericScore / max) * 100 : 0;
        sumNormalizedPercentages += normalized;
      } else {
        // Règle 4 : Sans note et non absent -> en attente
        pendingCount++;
      }
    }
  });

  const total = totalClassStudents !== undefined && totalClassStudents >= grades.length
    ? totalClassStudents
    : grades.length;

  if (totalClassStudents !== undefined && totalClassStudents > grades.length) {
    pendingCount += (totalClassStudents - grades.length);
  }

  const processedCount = gradedCount + excusedCount + unexcusedCount;
  const averagePercentage = includedCount > 0 ? sumNormalizedPercentages / includedCount : null;
  const averageScore = averagePercentage !== null && max > 0 ? (averagePercentage / 100) * max : null;

  return {
    total,
    totalStudents: total,
    gradedCount,
    absentCount: excusedCount + unexcusedCount,
    excusedCount,
    unexcusedCount,
    pendingCount,
    processedCount,
    includedCount,
    isComplete: pendingCount === 0 && total > 0,
    averagePercentage: averagePercentage !== null ? Number(averagePercentage.toFixed(2)) : null,
    averageScore: averageScore !== null ? Number(averageScore.toFixed(2)) : null,
    averagePercentageDisplay: averagePercentage !== null ? `${averagePercentage.toFixed(1)} %` : '—',
    averageScoreDisplay: averageScore !== null ? `${Number(averageScore.toFixed(2))}/${max}` : '—'
  };
}

interface TeacherGradesModuleProps {
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
  schoolPeriods?: any[];
  teacherRecord?: any;
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

export const TeacherGradesModule: React.FC<TeacherGradesModuleProps> = ({
  assignments,
  classesList,
  subjectsList,
  schoolTerms,
  schoolPeriods = [],
  teacherRecord,
  onStatsChange
}) => {
  const { showToast } = useNotifications();

  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [assessmentMetricsMap, setAssessmentMetricsMap] = useState<Record<string, AssessmentMetrics>>({});
  const [loading, setLoading] = useState<boolean>(true);

  // View Switcher (Phase 2F.2 & 2F.3) : 'evaluations' (Évaluations & Carnets de notes) vs 'class_summary' (Résultats & Bulletins périodiques)
  const [teacherViewTab, setTeacherViewTab] = useState<'evaluations' | 'class_summary'>('evaluations');

  // Filters
  const [classFilter, setClassFilter] = useState<string>('all');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [termFilter, setTermFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showGradebookModal, setShowGradebookModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [showReopenModal, setShowReopenModal] = useState<boolean>(false);
  const [showAssignPeriodModal, setShowAssignPeriodModal] = useState<boolean>(false);

  const [selectedAsmt, setSelectedAsmt] = useState<AssessmentRow | null>(null);
  const [selectedAsmtForPeriod, setSelectedAsmtForPeriod] = useState<AssessmentRow | null>(null);
  const [assignPeriodId, setAssignPeriodId] = useState<string>('');
  const [assignPeriodReason, setAssignPeriodReason] = useState<string>('');
  const [submittingAssignPeriod, setSubmittingAssignPeriod] = useState<boolean>(false);

  // Form Fields - Create / Edit
  const [formClassId, setFormClassId] = useState<string>('');
  const [formSubjectId, setFormSubjectId] = useState<string>('');
  const [formPeriodId, setFormPeriodId] = useState<string>('');
  const [formTermId, setFormTermId] = useState<string>('');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formType, setFormType] = useState<string>('test');
  const [formDate, setFormDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [formMaxScore, setFormMaxScore] = useState<string>('20');
  const [formCoefficient, setFormCoefficient] = useState<string>('1');
  const [formReason, setFormReason] = useState<string>('');
  const [submittingAsmt, setSubmittingAsmt] = useState<boolean>(false);

  // Gradebook State
  const [gradebookItems, setGradebookItems] = useState<GradebookItem[]>([]);
  const [initialGradebookSnapshot, setInitialGradebookSnapshot] = useState<string>('');
  const [loadingGradebook, setLoadingGradebook] = useState<boolean>(false);
  const [savingGradebook, setSavingGradebook] = useState<boolean>(false);
  const [gradebookReason, setGradebookReason] = useState<string>('');
  const [showGradebookReasonInput, setShowGradebookReasonInput] = useState<boolean>(false);

  const hasUnsavedChanges = useMemo(() => {
    return initialGradebookSnapshot !== '' && JSON.stringify(gradebookItems) !== initialGradebookSnapshot;
  }, [gradebookItems, initialGradebookSnapshot]);

  // Classes uniques issues des affectations réelles de l'enseignant
  const uniqueAssignedClasses = useMemo(() => {
    const map = new Map<string, { class_id: string; class_name: string }>();
    assignments.forEach(a => {
      if (a.class_id && !map.has(a.class_id)) {
        map.set(a.class_id, {
          class_id: a.class_id,
          class_name: a.class_name || 'Classe'
        });
      }
    });
    return Array.from(map.values());
  }, [assignments]);

  // Matières notées réelles de l'enseignant pour la classe sélectionnée (subject_id non null)
  const availableClassSubjects = useMemo(() => {
    if (!formClassId) return [];
    return assignments
      .filter(a => a.class_id === formClassId && a.subject_id)
      .map(a => {
        const sbj = subjectsList.find(s => s.id === a.subject_id);
        return {
          subject_id: a.subject_id!,
          subject_name: sbj ? sbj.name : (a.subject_name || 'Matière')
        };
      });
  }, [assignments, formClassId, subjectsList]);

  // Matières uniques affectées à l'enseignant (pour le filtre global)
  const teacherUniqueSubjects = useMemo(() => {
    const map = new Map<string, string>();
    assignments.forEach(a => {
      if (a.subject_id) {
        const sbj = subjectsList.find(s => s.id === a.subject_id);
        map.set(a.subject_id, sbj ? sbj.name : (a.subject_name || 'Matière'));
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [assignments, subjectsList]);

  // Load Assessments via RPC + Load all grades to compute accurate metrics
  const loadAssessments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_teacher_assessments');
      if (error) throw error;
      const list = (data || []) as AssessmentRow[];
      setAssessments(list);

      // Récupération des notes individuelles de l'ensemble des évaluations de l'enseignant
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
      showToast(err.message || 'Erreur lors du chargement des évaluations.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [onStatsChange, showToast]);

  useEffect(() => {
    loadAssessments();
  }, [loadAssessments]);

  // Périodes compatibles pour la classe sélectionnée dans le formulaire de création
  const availablePeriodsForClass = useMemo(() => {
    if (!formClassId) return [];
    const cls = classesList.find(c => c.id === formClassId);
    const cycle = cls?.education_cycle;
    if (!cycle) return schoolPeriods || [];
    return (schoolPeriods || []).filter(p => !p.education_cycle || p.education_cycle === cycle);
  }, [formClassId, classesList, schoolPeriods]);

  // Périodes groupées par trimestre/semestre parent
  const periodsByTerm = useMemo(() => {
    const map = new Map<string, { termName: string; periods: any[] }>();
    availablePeriodsForClass.forEach(p => {
      const parentTerm = schoolTerms.find(t => t.id === p.parent_term_id);
      const termId = p.parent_term_id || 'no_term';
      const termName = parentTerm ? parentTerm.name : 'Trimestre / Semestre';
      if (!map.has(termId)) {
        map.set(termId, { termName, periods: [] });
      }
      map.get(termId)!.periods.push(p);
    });
    return Array.from(map.entries());
  }, [availablePeriodsForClass, schoolTerms]);

  // Selected period object for create modal
  const currentSelectedPeriod = useMemo(() => {
    return (schoolPeriods || []).find(p => p.id === formPeriodId);
  }, [schoolPeriods, formPeriodId]);

  // Date validation against current selected period
  const isDateInvalid = useMemo(() => {
    if (!formDate) return true;
    if (currentSelectedPeriod?.starts_on && formDate < currentSelectedPeriod.starts_on) return true;
    if (currentSelectedPeriod?.ends_on && formDate > currentSelectedPeriod.ends_on) return true;
    return false;
  }, [formDate, currentSelectedPeriod]);

  // Form validity for submit button
  const isFormValid = useMemo(() => {
    if (!formClassId) return false;
    if (!formSubjectId) return false;
    if (!formPeriodId) return false;
    if (!formTitle.trim()) return false;
    if (!formDate) return false;
    if (isDateInvalid) return false;
    const maxScoreNum = Number(formMaxScore);
    if (isNaN(maxScoreNum) || maxScoreNum <= 0) return false;
    const coefNum = Number(formCoefficient);
    if (isNaN(coefNum) || coefNum <= 0) return false;
    return true;
  }, [formClassId, formSubjectId, formPeriodId, formTitle, formDate, isDateInvalid, formMaxScore, formCoefficient]);

  // Handler for changing period
  const handlePeriodChange = (newPeriodId: string) => {
    setFormPeriodId(newPeriodId);
    if (!newPeriodId) {
      return;
    }
    const newPeriod = (schoolPeriods || []).find(p => p.id === newPeriodId);
    if (newPeriod?.parent_term_id) {
      setFormTermId(newPeriod.parent_term_id);
    }
    if (newPeriod?.starts_on && newPeriod?.ends_on) {
      // Conserver la date uniquement si elle reste comprise dans la nouvelle période
      if (!formDate || formDate < newPeriod.starts_on || formDate > newPeriod.ends_on) {
        setFormDate(newPeriod.starts_on);
      }
    } else if (newPeriod?.starts_on) {
      if (!formDate || formDate < newPeriod.starts_on) {
        setFormDate(newPeriod.starts_on);
      }
    }
  };

  // Handler for changing class
  const handleClassChange = (newClassId: string) => {
    setFormClassId(newClassId);
    if (!newClassId) {
      setFormSubjectId('');
      setFormPeriodId('');
      setFormTermId('');
      return;
    }
    const realSubjects = assignments.filter(a => a.class_id === newClassId && a.subject_id);
    if (realSubjects.length === 1 && realSubjects[0].subject_id) {
      setFormSubjectId(realSubjects[0].subject_id);
    } else {
      setFormSubjectId('');
    }
    const cls = classesList.find(c => c.id === newClassId);
    const cycle = cls?.education_cycle;
    const compatible = (schoolPeriods || []).filter(p => !cycle || !p.education_cycle || p.education_cycle === cycle);
    if (compatible.length > 0) {
      const p = compatible[0];
      setFormPeriodId(p.id);
      setFormTermId(p.parent_term_id || '');
      if (p.starts_on && p.ends_on) {
        if (!formDate || formDate < p.starts_on || formDate > p.ends_on) {
          setFormDate(p.starts_on);
        }
      } else if (p.starts_on) {
        setFormDate(p.starts_on);
      }
    } else {
      setFormPeriodId('');
      setFormTermId('');
    }
  };

  // Reset Create Form
  const resetForm = () => {
    const initialClassId = uniqueAssignedClasses.length > 0 ? uniqueAssignedClasses[0].class_id : '';
    setFormClassId(initialClassId);
    if (initialClassId) {
      const realSubjects = assignments.filter(a => a.class_id === initialClassId && a.subject_id);
      setFormSubjectId(realSubjects.length === 1 && realSubjects[0].subject_id ? realSubjects[0].subject_id : '');
      const cls = classesList.find(c => c.id === initialClassId);
      const cycle = cls?.education_cycle;
      const compatible = (schoolPeriods || []).filter(p => !cycle || !p.education_cycle || p.education_cycle === cycle);
      if (compatible.length > 0) {
        const p = compatible[0];
        setFormPeriodId(p.id);
        setFormTermId(p.parent_term_id || '');
        setFormDate(p.starts_on || new Date().toISOString().split('T')[0]);
      } else {
        setFormPeriodId('');
        setFormTermId('');
        setFormDate(new Date().toISOString().split('T')[0]);
      }
    } else {
      setFormSubjectId('');
      setFormPeriodId('');
      setFormTermId('');
      setFormDate(new Date().toISOString().split('T')[0]);
    }
    setFormTitle('');
    setFormDescription('');
    setFormType('test');
    setFormMaxScore('20');
    setFormCoefficient('1');
    setFormReason('');
  };

  // Open Create Modal
  const openCreateModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  // Open Assign Period Modal
  const openAssignPeriodModal = (asmt: AssessmentRow) => {
    setSelectedAsmtForPeriod(asmt);
    const cls = classesList.find(c => c.id === asmt.class_id);
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
      showToast('Un motif explicatif d’au moins 5 caractères est obligatoire.', 'warning');
      return;
    }
    setSubmittingAssignPeriod(true);
    try {
      const { error } = await supabase.rpc('assign_assessment_to_period', {
        p_assessment_id: selectedAsmtForPeriod.id,
        p_period_id: assignPeriodId,
        p_reason: assignPeriodReason.trim()
      });
      if (error) throw error;
      showToast('Période assignée avec succès à l’évaluation !', 'success');
      setShowAssignPeriodModal(false);
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du rattachement de la période.', 'warning');
    } finally {
      setSubmittingAssignPeriod(false);
    }
  };

  // Open Gradebook Modal
  const openGradebook = async (asmt: AssessmentRow) => {
    setSelectedAsmt(asmt);
    setGradebookReason('');
    setShowGradebookReasonInput(false);
    setShowGradebookModal(true);
    setLoadingGradebook(true);

    try {
      const { data, error } = await supabase.rpc('get_assessment_gradebook', {
        p_assessment_id: asmt.id
      });
      if (error) throw error;
      const items = (data || []) as GradebookItem[];
      setGradebookItems(items);
      setInitialGradebookSnapshot(JSON.stringify(items));
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du chargement du carnet de notes.', 'warning');
    } finally {
      setLoadingGradebook(false);
    }
  };

  // Handle Grade Change in table
  const handleGradeItemChange = (studentId: string, field: keyof GradebookItem, value: any) => {
    setGradebookItems(prev =>
      prev.map(item => {
        if (item.student_id !== studentId) return item;
        const updated = { ...item, [field]: value };
        if (field === 'is_absent' && value === true) {
          updated.score = null;
        } else if (field === 'is_absent' && value === false) {
          updated.is_excused = false;
        }
        return updated;
      })
    );
  };

  // Real-time calculation of gradebook statistics & class average in the gradebook modal
  const gradebookStats = useMemo(() => {
    return computeAssessmentMetrics(gradebookItems, selectedAsmt?.max_score || 20);
  }, [gradebookItems, selectedAsmt]);

  // Handle Save Gradebook (with save before publish guarantee)
  const handleSaveGradebook = async (publishAfter: boolean = false) => {
    if (!selectedAsmt) return;

    if (publishAfter && gradebookStats.pendingCount > 0) {
      showToast(
        `Publication impossible : Il reste ${gradebookStats.pendingCount} élève(s) sans note et non marqué(s) absent(s). La saisie doit être complète avant publication.`,
        'warning'
      );
      return;
    }

    // Validation des notes
    for (const item of gradebookItems) {
      if (!item.is_absent && item.score !== null && item.score !== undefined && (item.score as any) !== '') {
        const numericScore = Number(item.score);
        if (isNaN(numericScore) || numericScore < 0 || numericScore > selectedAsmt.max_score) {
          showToast(`La note de ${item.first_name} ${item.last_name} (${item.score}) dépasse le barème (0-${selectedAsmt.max_score}).`, 'warning');
          return;
        }
      }
    }

    if (selectedAsmt.status === 'published' && !gradebookReason.trim()) {
      setShowGradebookReasonInput(true);
      showToast('Un motif d’audit est obligatoire pour enregistrer des modifications sur une évaluation déjà publiée.', 'warning');
      return;
    }

    setSavingGradebook(true);
    try {
      const formattedGrades = gradebookItems.map(item => ({
        student_id: item.student_id,
        enrollment_id: item.enrollment_id,
        score: item.is_absent ? null : (item.score !== null && item.score !== undefined && (item.score as any) !== '' ? Number(item.score) : null),
        is_absent: !!item.is_absent,
        is_excused: !!item.is_excused,
        teacher_comment: item.teacher_comment || null
      }));

      // 1. Sauvegarde systématique des notes via RPC officielle
      const { data, error } = await supabase.rpc('save_student_grades', {
        p_assessment_id: selectedAsmt.id,
        p_grades: formattedGrades,
        p_reason: gradebookReason.trim() || null
      });

      if (error) throw error;

      // 2. Si publication demandée, publication après la sauvegarde confirmée
      if (publishAfter && (selectedAsmt.status === 'draft' || selectedAsmt.status === 'reopened')) {
        const { error: pubErr } = await supabase.rpc('publish_teacher_assessment', {
          p_assessment_id: selectedAsmt.id
        });
        if (pubErr) throw pubErr;
        showToast('Notes enregistrées et évaluation officiellement publiée aux élèves et parents !', 'success');
      } else {
        showToast(`Notes enregistrées avec succès (${data?.saved_count || 0} traitées).`, 'success');
      }

      await loadAssessments();
      // Reload gradebook
      const { data: refreshed } = await supabase.rpc('get_assessment_gradebook', {
        p_assessment_id: selectedAsmt.id
      });
      const refreshedItems = (refreshed || []) as GradebookItem[];
      setGradebookItems(refreshedItems);
      setInitialGradebookSnapshot(JSON.stringify(refreshedItems));
      setShowGradebookReasonInput(false);
      setGradebookReason('');
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’enregistrement des notes.', 'warning');
    } finally {
      setSavingGradebook(false);
    }
  };

  // Create Assessment Submit
  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClassId || !formSubjectId || !formPeriodId || !formTitle.trim() || !formDate || !formMaxScore) {
      showToast('Veuillez renseigner tous les champs obligatoires (*) incluant la période.', 'warning');
      return;
    }

    // Vérification de la correspondance exacte avec une affectation active chargée
    const isValidAssignment = assignments.some(
      a => a.class_id === formClassId && a.subject_id === formSubjectId
    );
    if (!isValidAssignment) {
      showToast('Cette matière ne correspond à aucune affectation active pour votre compte dans cette classe.', 'warning');
      return;
    }

    const maxVal = parseFloat(formMaxScore);
    const coefVal = parseFloat(formCoefficient) || 1;

    if (isNaN(maxVal) || maxVal <= 0) {
      showToast('Le barème maximal doit être un nombre supérieur à 0.', 'warning');
      return;
    }

    if (isNaN(coefVal) || coefVal <= 0) {
      showToast('Le coefficient doit être un nombre strictement supérieur à 0.', 'warning');
      return;
    }

    if (isDateInvalid) {
      if (currentSelectedPeriod?.starts_on && currentSelectedPeriod?.ends_on) {
        showToast(
          `La date de l’évaluation doit être comprise entre le ${formatDateFr(currentSelectedPeriod.starts_on)} et le ${formatDateFr(currentSelectedPeriod.ends_on)}.`,
          'warning'
        );
      } else {
        showToast('La date de l’évaluation est invalide ou hors période.', 'warning');
      }
      return;
    }

    setSubmittingAsmt(true);
    try {
      const { error } = await supabase.rpc('create_teacher_assessment', {
        p_class_id: formClassId,
        p_subject_id: formSubjectId,
        p_period_id: formPeriodId,
        p_title: formTitle.trim(),
        p_description: formDescription.trim() || null,
        p_assessment_type: formType,
        p_assessment_date: formDate,
        p_max_score: maxVal,
        p_coefficient: coefVal,
        p_publish_now: false,
        p_term_id: formTermId || null
      });

      if (error) throw error;

      showToast('Évaluation créée en brouillon. Saisissez maintenant les notes avant publication.', 'success');
      setShowCreateModal(false);
      resetForm();
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création de l’évaluation.', 'warning');
    } finally {
      setSubmittingAsmt(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (asmt: AssessmentRow) => {
    setSelectedAsmt(asmt);
    setFormTitle(asmt.title);
    setFormDescription(asmt.description || '');
    setFormType(asmt.assessment_type);
    setFormDate(asmt.assessment_date);
    setFormMaxScore(asmt.max_score.toString());
    setFormCoefficient(asmt.coefficient.toString());
    setFormTermId(asmt.term_id || '');
    setFormReason('');
    setShowEditModal(true);
  };

  // Update Assessment Submit
  const handleUpdateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsmt) return;

    const maxVal = parseFloat(formMaxScore);
    const coefVal = parseFloat(formCoefficient) || 1;

    if (isNaN(maxVal) || maxVal <= 0) {
      showToast('Le barème maximal doit être un nombre supérieur à 0.', 'warning');
      return;
    }

    if (selectedAsmt.status === 'published' && (!formReason.trim() || formReason.trim().length < 5)) {
      showToast('Un motif explicite (au moins 5 caractères) est obligatoire.', 'warning');
      return;
    }

    setSubmittingAsmt(true);
    try {
      const { error } = await supabase.rpc('update_teacher_assessment', {
        p_assessment_id: selectedAsmt.id,
        p_term_id: formTermId || null,
        p_title: formTitle.trim(),
        p_description: formDescription.trim() || null,
        p_assessment_type: formType,
        p_assessment_date: formDate,
        p_max_score: maxVal,
        p_coefficient: coefVal,
        p_reason: selectedAsmt.status === 'published' ? formReason.trim() : null
      });

      if (error) throw error;

      showToast('Évaluation mise à jour avec succès.', 'success');
      setShowEditModal(false);
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la modification de l’évaluation.', 'warning');
    } finally {
      setSubmittingAsmt(false);
    }
  };

  // Publish Assessment Action
  const handlePublishAssessment = async (asmt: AssessmentRow) => {
    try {
      const { error } = await supabase.rpc('publish_teacher_assessment', {
        p_assessment_id: asmt.id
      });
      if (error) throw error;
      showToast('Évaluation publiée avec succès ! Notes visibles par les élèves et parents.', 'success');
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la publication de l’évaluation.', 'warning');
    }
  };

  // Close Assessment Action
  const handleCloseAssessment = async (asmt: AssessmentRow) => {
    try {
      const { error } = await supabase.rpc('close_teacher_assessment', {
        p_assessment_id: asmt.id
      });
      if (error) throw error;
      showToast('Évaluation clôturée avec succès.', 'success');
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la clôture de l’évaluation.', 'warning');
    }
  };

  // Cancel Assessment Submit
  const handleCancelAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsmt) return;
    if (!formReason.trim() || formReason.trim().length < 5) {
      showToast('Un motif explicite (au moins 5 caractères) est obligatoire pour annuler.', 'warning');
      return;
    }

    setSubmittingAsmt(true);
    try {
      const { error } = await supabase.rpc('cancel_teacher_assessment', {
        p_assessment_id: selectedAsmt.id,
        p_reason: formReason.trim()
      });
      if (error) throw error;
      showToast('Évaluation annulée.', 'info');
      setShowCancelModal(false);
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’annulation.', 'warning');
    } finally {
      setSubmittingAsmt(false);
    }
  };

  // Reopen Assessment Submit
  const handleReopenAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsmt) return;
    if (!formReason.trim() || formReason.trim().length < 5) {
      showToast('Un motif explicite est obligatoire pour réouvrir une évaluation.', 'warning');
      return;
    }

    setSubmittingAsmt(true);
    try {
      const { error } = await supabase.rpc('reopen_teacher_assessment', {
        p_assessment_id: selectedAsmt.id,
        p_reason: formReason.trim()
      });
      if (error) throw error;
      showToast('Évaluation réouverte avec succès pour corrections.', 'success');
      setShowReopenModal(false);
      await loadAssessments();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la réouverture.', 'warning');
    } finally {
      setSubmittingAsmt(false);
    }
  };

  // Filtered List
  const filteredAssessments = useMemo(() => {
    return assessments.filter(a => {
      if (classFilter !== 'all' && a.class_id !== classFilter) return false;
      if (subjectFilter !== 'all' && a.subject_id !== subjectFilter) return false;
      if (termFilter !== 'all' && a.term_id !== termFilter) return false;
      if (periodFilter !== 'all') {
        if (periodFilter === 'none' && a.period_id) return false;
        if (periodFilter !== 'none' && a.period_id !== periodFilter) return false;
      }
      if (typeFilter !== 'all' && a.assessment_type !== typeFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = a.title.toLowerCase().includes(q);
        const matchClass = a.class_name.toLowerCase().includes(q);
        const matchSubject = a.subject_name.toLowerCase().includes(q);
        if (!matchTitle && !matchClass && !matchSubject) return false;
      }
      return true;
    });
  }, [assessments, classFilter, subjectFilter, termFilter, periodFilter, typeFilter, statusFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Primary Spaces View Switcher (Phase 2F.2 & 2F.3) */}
      <div className="flex flex-wrap items-center gap-3 p-1.5 bg-slate-900/90 rounded-2xl border border-slate-800 w-fit text-xs font-bold shadow-lg">
        <button
          type="button"
          onClick={() => setTeacherViewTab('evaluations')}
          className={`px-5 py-2.5 rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            teacherViewTab === 'evaluations'
              ? 'bg-amber-500 text-slate-950 font-black shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Award className="w-4 h-4" />
          <span>Évaluations & Carnets de notes</span>
        </button>

        <button
          type="button"
          onClick={() => setTeacherViewTab('class_summary')}
          className={`px-5 py-2.5 rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            teacherViewTab === 'class_summary'
              ? 'bg-amber-500 text-slate-950 font-black shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <GraduationCap className="w-4 h-4" />
          <span>Résultats & Bulletins périodiques</span>
        </button>
      </div>

      {teacherViewTab === 'class_summary' && (
        <TeacherClassPeriodSummaryView
          classes={classesList}
          schoolPeriods={schoolPeriods}
          schoolTerms={schoolTerms}
          assignments={assignments}
          teacherRecord={teacherRecord}
        />
      )}

      {teacherViewTab === 'evaluations' && (
        <>
          {/* Header Actions & Quick Metrics */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                <span>Gestion des Notes & Évaluations</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Créez des contrôles continus, saisissez les notes par classe et publiez les résultats officiels.
              </p>
            </div>

            <button
              onClick={openCreateModal}
              disabled={assignments.length === 0}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg shadow-amber-500/20 cursor-pointer transition-all hover:scale-105"
            >
              <Plus className="w-4 h-4" />
              <span>Nouvelle Évaluation</span>
            </button>
          </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Évaluations</span>
          <p className="text-2xl font-black text-white">{assessments.length}</p>
          <span className="text-[10px] text-slate-500">Toutes vos classes</span>
        </div>
        <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Publiées</span>
          <p className="text-2xl font-black text-emerald-400">
            {assessments.filter(a => a.status === 'published').length}
          </p>
          <span className="text-[10px] text-emerald-400 font-bold">Visibles élèves / parents</span>
        </div>
        <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">En Brouillon</span>
          <p className="text-2xl font-black text-amber-400">
            {assessments.filter(a => a.status === 'draft').length}
          </p>
          <span className="text-[10px] text-amber-400/80">Notes à finaliser</span>
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
          <span>Filtrer les évaluations :</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 text-xs">
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs placeholder:text-slate-500"
            />
          </div>

          <select
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs"
          >
            <option value="all">Toutes vos classes</option>
            {uniqueAssignedClasses.map(c => (
              <option key={c.class_id} value={c.class_id}>{c.class_name}</option>
            ))}
          </select>

          <select
            value={subjectFilter}
            onChange={e => setSubjectFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs"
          >
            <option value="all">Toutes vos matières</option>
            {teacherUniqueSubjects.map(s => (
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
            <option value="all">Tous les statuts</option>
            <option value="draft">Brouillon</option>
            <option value="published">Publié</option>
            <option value="closed">Clôturé</option>
            <option value="reopened">Réouvert</option>
            <option value="cancelled">Annulé</option>
          </select>
        </div>
      </div>

      {/* Assessments List */}
      {loading ? (
        <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs font-bold text-slate-400">Chargement des évaluations...</p>
        </div>
      ) : filteredAssessments.length === 0 ? (
        <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
          <Award className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-sm font-extrabold text-white">Aucune évaluation trouvée</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {assessments.length === 0
              ? "Vous n'avez pas encore créé d'évaluation. Cliquez sur \"Nouvelle Évaluation\" pour débuter."
              : 'Aucun enregistrement ne correspond aux filtres sélectionnés.'}
          </p>
          {assessments.length === 0 && (
            <button
              onClick={openCreateModal}
              disabled={assignments.length === 0}
              className="px-4 py-2 bg-amber-500 text-slate-950 font-black rounded-xl text-xs cursor-pointer inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Créer une première évaluation</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAssessments.map(asmt => {
            const typeInfo = ASSESSMENT_TYPE_LABELS[asmt.assessment_type] || ASSESSMENT_TYPE_LABELS.other;
            const metrics = assessmentMetricsMap[asmt.id] || computeAssessmentMetrics([], asmt.max_score);
            return (
              <div
                key={asmt.id}
                className={`p-5 bg-slate-900 rounded-3xl border transition-all flex flex-col justify-between space-y-4 shadow-lg ${
                  asmt.status === 'published'
                    ? 'border-emerald-500/40 hover:border-emerald-500/60'
                    : asmt.status === 'draft'
                    ? 'border-amber-500/40 hover:border-amber-500/60'
                    : asmt.status === 'closed'
                    ? 'border-indigo-500/30'
                    : 'border-slate-800 opacity-75'
                }`}
              >
                <div className="space-y-3">
                  {/* Top badges */}
                  <div className="flex items-start justify-between gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${typeInfo.bg} ${typeInfo.text}`}>
                      {typeInfo.label}
                    </span>

                    <div className="flex items-center gap-1">
                      {asmt.status === 'draft' && (
                        <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-[10px] font-black uppercase">
                          Brouillon
                        </span>
                      )}
                      {asmt.status === 'published' && (
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full text-[10px] font-black uppercase flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Publié</span>
                        </span>
                      )}
                      {asmt.status === 'closed' && (
                        <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-full text-[10px] font-black uppercase flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          <span>Clôturé</span>
                        </span>
                      )}
                      {asmt.status === 'reopened' && (
                        <span className="px-2 py-0.5 bg-sky-500/20 text-sky-300 border border-sky-500/40 rounded-full text-[10px] font-black uppercase flex items-center gap-1">
                          <RotateCcw className="w-3 h-3" />
                          <span>Réouvert</span>
                        </span>
                      )}
                      {asmt.status === 'cancelled' && (
                        <span className="px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-full text-[10px] font-black uppercase">
                          Annulé
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-sm font-black text-white line-clamp-1">{asmt.title}</h3>
                    <p className="text-xs text-slate-400 line-clamp-2 mt-0.5 leading-relaxed">
                      {asmt.description || 'Aucune consigne spécifique.'}
                    </p>
                  </div>

                  {/* Metadata Class / Subject / Date & Period */}
                  <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80 space-y-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">Classe :</span>
                      <strong className="text-white">{asmt.class_name}</strong>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">Matière :</span>
                      <strong className="text-amber-400">{asmt.subject_name}</strong>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">Période :</span>
                      {asmt.period_id ? (
                        <span className="text-amber-300 font-bold flex items-center gap-1">
                          <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-md text-[10px]">
                            {asmt.period_name || `Période #${asmt.period_position}`}
                          </span>
                          <span className="text-slate-400 text-[10px]">({asmt.term_name})</span>
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-full font-bold text-[10px] flex items-center gap-1">
                            <AlertCircle className="w-2.5 h-2.5" /> Période non définie
                          </span>
                          <button
                            onClick={() => openAssignPeriodModal(asmt)}
                            className="px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-lg text-[10px] cursor-pointer"
                          >
                            Définir
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">Date d'évaluation :</span>
                      <span className="text-slate-300">
                        {new Date(asmt.assessment_date).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                      <span className="text-slate-400 font-medium">Barème & Coef :</span>
                      <span className="text-slate-200 font-mono font-bold">
                        /{asmt.max_score} (Coef: {asmt.coefficient})
                      </span>
                    </div>
                  </div>

                  {/* Grade Statistics Preview (calculé selon les mêmes règles officielles que le carnet) */}
                  <div className="flex items-center justify-between text-xs px-1">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        Traités :{' '}
                        <strong className="text-white">
                          {metrics.processedCount}/{metrics.totalStudents}
                        </strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-slate-400">
                      <Calculator className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        Moyenne :{' '}
                        <strong className="text-amber-400 font-mono font-bold">
                          {metrics.averageScore !== null
                            ? `${metrics.averageScoreDisplay} (${metrics.averagePercentageDisplay})`
                            : '—'}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-1.5 text-xs">
                  <button
                    onClick={() => openGradebook(asmt)}
                    className="flex-1 px-3 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-transform active:scale-95"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Carnet de Notes</span>
                  </button>

                  <div className="flex items-center gap-1">
                    {asmt.status === 'draft' && (
                      <button
                        onClick={() => handlePublishAssessment(asmt)}
                        className="p-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 cursor-pointer"
                        title="Publier"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {asmt.status === 'published' && (
                      <button
                        onClick={() => handleCloseAssessment(asmt)}
                        className="p-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 cursor-pointer"
                        title="Clôturer"
                      >
                        <Lock className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {asmt.status !== 'cancelled' && asmt.status !== 'closed' && (
                      <button
                        onClick={() => openEditModal(asmt)}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                        title="Modifier paramètres"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {asmt.status === 'closed' && (
                      <button
                        onClick={() => {
                          setSelectedAsmt(asmt);
                          setFormReason('');
                          setShowReopenModal(true);
                        }}
                        className="p-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 cursor-pointer"
                        title="Demander réouverture"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {asmt.status !== 'cancelled' && (
                      <button
                        onClick={() => {
                          setSelectedAsmt(asmt);
                          setFormReason('');
                          setShowCancelModal(true);
                        }}
                        className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 cursor-pointer"
                        title="Annuler évaluation"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* MODAL 1: CRÉER UNE ÉVALUATION */}
      {showCreateModal && (
        <Modal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Créer une Nouvelle Évaluation"
          darkMode={true}
        >
          <form onSubmit={handleCreateAssessment} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Classe Attribuée *</label>
              <select
                required
                value={formClassId}
                onChange={e => handleClassChange(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="">-- Sélectionnez une classe --</option>
                {uniqueAssignedClasses.map(c => (
                  <option key={c.class_id} value={c.class_id}>
                    {c.class_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Matière *</label>
                {availableClassSubjects.length === 0 ? (
                  <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-rose-400 text-[11px] font-bold">
                    {formClassId 
                      ? 'Aucune matière notée ne vous est affectée dans cette classe.' 
                      : 'Veuillez d’abord sélectionner une classe.'}
                  </div>
                ) : (
                  <select
                    required
                    value={formSubjectId}
                    onChange={e => setFormSubjectId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="">-- Sélectionner une matière --</option>
                    {availableClassSubjects.map(s => (
                      <option key={s.subject_id} value={s.subject_id}>
                        {s.subject_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Période Scolaire *</label>
                {availablePeriodsForClass.length === 0 ? (
                  <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-amber-400 text-[11px]">
                    {formClassId 
                      ? 'Aucune période configurée pour le cycle de cette classe.' 
                      : 'Sélectionnez d’abord une classe.'}
                  </div>
                ) : (
                  <select
                    required
                    value={formPeriodId}
                    onChange={e => handlePeriodChange(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-amber-500/60 rounded-xl text-white font-bold focus:outline-none focus:border-amber-400 cursor-pointer"
                  >
                    <option value="">-- Choisir la période --</option>
                    {periodsByTerm.map(([termId, group]) => (
                      <optgroup key={termId} label={`── ${group.termName} ──`}>
                        {group.periods.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} (Position #{p.position})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Parent term automatic reminder */}
            {formPeriodId && (
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-[11px] text-amber-300">
                <span>Trimestre/Semestre rattaché :</span>
                <strong>{schoolTerms.find(t => t.id === formTermId)?.name || 'Terme parent automatique'}</strong>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-300 mb-1">Titre de l'évaluation *</label>
              <input
                type="text"
                required
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="Ex: Interrogation N°2 sur les Équations différentielles"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Instructions / Description</label>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                rows={2}
                placeholder="Consignes facultatives pour les élèves et correcteurs..."
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Row: Type and Date with ample spacing */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Type d'évaluation *</label>
                <select
                  required
                  value={formType}
                  onChange={e => setFormType(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-medium focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="test">Devoir Surveillé</option>
                  <option value="quiz">Interrogation</option>
                  <option value="exam">Examen</option>
                  <option value="homework">Devoir Maison</option>
                  <option value="project">Projet / TP</option>
                  <option value="oral">Oral</option>
                  <option value="practical">Pratique</option>
                  <option value="other">Autre</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Date de l'évaluation *</label>
                <input
                  type="date"
                  required
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  min={currentSelectedPeriod?.starts_on || undefined}
                  max={currentSelectedPeriod?.ends_on || undefined}
                  className={`w-full px-3.5 py-2.5 bg-slate-950 border rounded-xl text-white font-mono text-sm tracking-wide focus:outline-none transition-colors ${
                    isDateInvalid
                      ? 'border-rose-500/80 focus:border-rose-400 bg-rose-950/20'
                      : 'border-slate-700 focus:border-amber-500'
                  }`}
                />
              </div>
            </div>

            {/* Clear internal message for date bounds */}
            {currentSelectedPeriod?.starts_on && currentSelectedPeriod?.ends_on && (
              <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 transition-colors ${
                isDateInvalid
                  ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}>
                <Calendar className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-medium">
                    La date de l’évaluation doit être comprise entre le{' '}
                    <strong className="underline underline-offset-2">{formatDateFr(currentSelectedPeriod.starts_on)}</strong> et le{' '}
                    <strong className="underline underline-offset-2">{formatDateFr(currentSelectedPeriod.ends_on)}</strong>.
                  </p>
                  {isDateInvalid && formDate && (
                    <p className="font-bold text-rose-400 text-[11px] flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Date saisie ({formatDateFr(formDate)}) non comprise dans les bornes autorisées.</span>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Row: Max Score and Coefficient */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Barème Max *</label>
                <input
                  type="number"
                  min={1}
                  step="any"
                  required
                  value={formMaxScore}
                  onChange={e => setFormMaxScore(e.target.value)}
                  placeholder="Ex: 20"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono font-bold focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Coefficient *</label>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  required
                  value={formCoefficient}
                  onChange={e => setFormCoefficient(e.target.value)}
                  placeholder="Ex: 1"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono font-bold focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer transition-colors text-xs"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingAsmt || !isFormValid}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl cursor-pointer transition-all shadow-lg shadow-amber-500/20 text-xs"
              >
                {submittingAsmt ? 'Création...' : 'Créer l’Évaluation (Brouillon)'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 2: CARNET DE NOTES (GRADEBOOK) */}
      {showGradebookModal && selectedAsmt && (
        <Modal
          isOpen={showGradebookModal}
          onClose={() => setShowGradebookModal(false)}
          title={`Carnet de Notes : ${selectedAsmt.title}`}
          darkMode={true}
          maxWidth="5xl"
        >
          <div className="space-y-4 text-xs max-h-[80vh] flex flex-col">
            {/* Assessment Header Info & Detailed Stats */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 grid grid-cols-2 lg:grid-cols-5 gap-3 shrink-0">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Classe & Matière</span>
                <span className="font-bold text-white text-xs">{selectedAsmt.class_name} • {selectedAsmt.subject_name}</span>
                <span className="font-mono text-[11px] text-amber-400 block mt-0.5">Barème /{selectedAsmt.max_score} (Coef {selectedAsmt.coefficient})</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Notes Saisies</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-base font-extrabold text-white font-mono">{gradebookStats.gradedCount}</span>
                  <span className="text-[11px] text-slate-400">/ {gradebookStats.total}</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-bold">Présents notés</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Absents</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-base font-extrabold text-white font-mono">{gradebookStats.absentCount}</span>
                  <span className="text-[11px] text-slate-400">élève(s)</span>
                </div>
                <span className="text-[10px] text-slate-400 block">
                  <span className="text-rose-400 font-bold">{gradebookStats.unexcusedCount} non excusé(s)</span>
                  {gradebookStats.excusedCount > 0 && <span> • <span className="text-emerald-400 font-bold">{gradebookStats.excusedCount} excusé(s)</span></span>}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">En Attente</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className={`text-base font-extrabold font-mono ${gradebookStats.pendingCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                    {gradebookStats.pendingCount}
                  </span>
                  <span className="text-[11px] text-slate-400">élève(s)</span>
                </div>
                <span className={`text-[10px] font-bold ${gradebookStats.pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {gradebookStats.pendingCount > 0 ? 'Saisie incomplète' : '✓ Saisie complète'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Moyenne de Classe</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="font-mono font-extrabold text-emerald-400 text-base">
                    {gradebookStats.averageScoreDisplay}
                  </span>
                  <span className="font-mono text-xs text-emerald-300 font-bold">
                    ({gradebookStats.averagePercentageDisplay})
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block">
                  {gradebookStats.includedCount > 0
                    ? `Sur ${gradebookStats.includedCount} élève(s) comptabilisé(s)`
                    : 'Aucun élève évalué'}
                </span>
              </div>
            </div>

            {/* Incomplete / Unsaved changes warnings */}
            {gradebookStats.pendingCount > 0 && (selectedAsmt.status === 'draft' || selectedAsmt.status === 'reopened') && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-[11px] flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>Saisie incomplète :</strong> Il reste {gradebookStats.pendingCount} élève(s) sans note et non marqué(s) absent(s). La publication des résultats est désactivée tant que la saisie n'est pas finalisée.
                  </span>
                </div>
              </div>
            )}

            {hasUnsavedChanges && (
              <div className="p-2.5 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sky-300 text-[11px] flex items-center justify-between gap-2 shrink-0">
                <span className="font-medium">
                  ✏️ Vous avez des modifications de notes non enregistrées. Pensez à cliquer sur <strong>« Enregistrer les notes »</strong>.
                </span>
              </div>
            )}

            {/* Bannières informatives selon le statut */}
            {selectedAsmt.status === 'published' && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-[11px] flex items-center gap-2 shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-medium">Résultats publiés — lecture seule. Contactez l’administration pour toute correction.</span>
              </div>
            )}

            {selectedAsmt.status === 'closed' && (
              <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-300 text-[11px] flex items-center gap-2 shrink-0">
                <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="font-medium">Évaluation clôturée — lecture seule. Contactez l’administration pour toute correction.</span>
              </div>
            )}

            {selectedAsmt.status === 'cancelled' && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-[11px] flex items-center gap-2 shrink-0">
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="font-medium">Évaluation annulée — lecture seule.</span>
              </div>
            )}

            {/* Mandatory Reason Input if modifying published */}
            {showGradebookReasonInput && selectedAsmt.status === 'published' && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1 shrink-0">
                <label className="block font-bold text-amber-400">Motif obligatoire des modifications apportées aux notes *</label>
                <textarea
                  value={gradebookReason}
                  onChange={e => setGradebookReason(e.target.value)}
                  rows={2}
                  placeholder="Ex: Correction de barème après révision de la copie..."
                  className="w-full px-3 py-1.5 bg-slate-950 border border-amber-500/40 text-white rounded-xl text-xs"
                />
              </div>
            )}

            {/* Desktop Table View (visible on sm and up) */}
            <div className="hidden sm:block overflow-x-auto border border-slate-800 rounded-2xl flex-1 max-h-[55vh]">
              {loadingGradebook ? (
                <div className="p-8 text-center text-slate-400">Chargement des élèves de la classe...</div>
              ) : gradebookItems.length === 0 ? (
                <div className="p-8 text-center text-slate-400">Aucun élève inscrit dans cette classe.</div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-950 text-slate-400 uppercase font-bold border-b border-slate-800 z-10">
                    <tr>
                      <th className="p-3 w-[120px] min-w-[120px]">Matricule</th>
                      <th className="p-3 min-w-[150px]">Élève</th>
                      <th className="p-3 w-[110px] min-w-[110px]">Note (/{selectedAsmt.max_score})</th>
                      <th className="p-3 w-[80px] min-w-[80px] text-center">Absent ?</th>
                      <th className="p-3 w-[80px] min-w-[80px] text-center">Excusé ?</th>
                      <th className="p-3 w-[150px] min-w-[140px] text-center">Statut Calcul</th>
                      <th className="p-3 min-w-[200px]">Commentaire Enseignant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {gradebookItems.map(item => {
                      const isReadOnly = selectedAsmt.status === 'published' || selectedAsmt.status === 'closed' || selectedAsmt.status === 'cancelled';
                      const hasScore = !item.is_absent && item.score !== null && item.score !== undefined && (item.score as any) !== '';
                      return (
                        <tr key={item.student_id} className="hover:bg-slate-950/60 transition-colors">
                          <td className="p-3 font-mono text-amber-400 font-bold whitespace-nowrap">{item.student_number}</td>
                          <td className="p-3 font-extrabold text-white">
                            {item.last_name} {item.first_name}
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              min={0}
                              max={selectedAsmt.max_score}
                              step="0.01"
                              disabled={item.is_absent || isReadOnly}
                              value={item.score !== null && item.score !== undefined && item.score !== ('' as any) ? item.score : ''}
                              onChange={e => {
                                const val = e.target.value;
                                handleGradeItemChange(item.student_id, 'score', val === '' ? null : val);
                              }}
                              placeholder="0"
                              className="w-24 min-w-[90px] px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono font-bold text-center focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all disabled:opacity-40 disabled:bg-slate-900"
                            />
                          </td>
                          <td className="p-3 text-center">
                            <label className="inline-flex items-center justify-center cursor-pointer" title="Marquer comme absent (vide la note)">
                              <input
                                type="checkbox"
                                disabled={isReadOnly}
                                checked={item.is_absent}
                                onChange={e => handleGradeItemChange(item.student_id, 'is_absent', e.target.checked)}
                                className="w-4 h-4 accent-rose-500 rounded cursor-pointer disabled:cursor-not-allowed"
                              />
                            </label>
                          </td>
                          <td className="p-3 text-center">
                            <label className="inline-flex items-center justify-center cursor-pointer" title={item.is_absent ? "Absence justifiée / excusée" : "Cochez d'abord Absent pour excuser"}>
                              <input
                                type="checkbox"
                                disabled={!item.is_absent || isReadOnly}
                                checked={item.is_excused}
                                onChange={e => handleGradeItemChange(item.student_id, 'is_excused', e.target.checked)}
                                className="w-4 h-4 accent-indigo-500 rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                              />
                            </label>
                          </td>
                          <td className="p-3 text-center">
                            {item.is_absent ? (
                              item.is_excused ? (
                                <span className="inline-block px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                                  Exclue de la moyenne
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                                  Comptera comme 0 %
                                </span>
                              )
                            ) : hasScore ? (
                              <span className="inline-block px-2 py-0.5 rounded-lg bg-slate-800 text-amber-300 border border-slate-700 text-[10px] font-mono font-bold">
                                {((Number(item.score) / selectedAsmt.max_score) * 100).toFixed(1)} %
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                                En attente
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              disabled={isReadOnly}
                              value={item.teacher_comment || ''}
                              onChange={e => handleGradeItemChange(item.student_id, 'teacher_comment', e.target.value)}
                              placeholder="Observation facultative..."
                              className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-300 text-xs focus:border-slate-600 outline-none transition-all disabled:opacity-40"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Mobile Card List View (visible on mobile, hidden on sm and up) */}
            <div className="block sm:hidden overflow-y-auto space-y-3 flex-1 max-h-[55vh] pr-1">
              {loadingGradebook ? (
                <div className="p-6 text-center text-slate-400">Chargement des élèves...</div>
              ) : gradebookItems.length === 0 ? (
                <div className="p-6 text-center text-slate-400">Aucun élève inscrit dans cette classe.</div>
              ) : (
                gradebookItems.map(item => {
                  const isReadOnly = selectedAsmt.status === 'published' || selectedAsmt.status === 'closed' || selectedAsmt.status === 'cancelled';
                  const hasScore = !item.is_absent && item.score !== null && item.score !== undefined && (item.score as any) !== '';
                  return (
                    <div key={item.student_id} className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                        <span className="font-extrabold text-white text-sm">{item.last_name} {item.first_name}</span>
                        <span className="font-mono text-[11px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                          {item.student_number}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-xs font-bold text-slate-300">
                            Note (/{selectedAsmt.max_score}) :
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={selectedAsmt.max_score}
                            step="0.01"
                            disabled={item.is_absent || isReadOnly}
                            value={item.score !== null && item.score !== undefined && item.score !== ('' as any) ? item.score : ''}
                            onChange={e => {
                              const val = e.target.value;
                              handleGradeItemChange(item.student_id, 'score', val === '' ? null : val);
                            }}
                            placeholder="0"
                            className="w-28 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono font-bold text-center focus:border-amber-500 outline-none disabled:opacity-40"
                          />
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <label className="flex items-center gap-2 p-2 bg-slate-900 rounded-xl border border-slate-800 cursor-pointer flex-1 justify-center">
                            <input
                              type="checkbox"
                              disabled={isReadOnly}
                              checked={item.is_absent}
                              onChange={e => handleGradeItemChange(item.student_id, 'is_absent', e.target.checked)}
                              className="w-4 h-4 accent-rose-500 rounded"
                            />
                            <span className="text-xs font-bold text-slate-200">Absent</span>
                          </label>

                          <label className="flex items-center gap-2 p-2 bg-slate-900 rounded-xl border border-slate-800 cursor-pointer flex-1 justify-center">
                            <input
                              type="checkbox"
                              disabled={!item.is_absent || isReadOnly}
                              checked={item.is_excused}
                              onChange={e => handleGradeItemChange(item.student_id, 'is_excused', e.target.checked)}
                              className="w-4 h-4 accent-indigo-500 rounded disabled:opacity-40"
                            />
                            <span className="text-xs font-bold text-slate-200">Excusé</span>
                          </label>
                        </div>

                        {/* Status calculation pill */}
                        <div className="text-center py-1">
                          {item.is_absent ? (
                            item.is_excused ? (
                              <span className="inline-block px-2.5 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                                Exclue de la moyenne
                              </span>
                            ) : (
                              <span className="inline-block px-2.5 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                                Comptera comme 0 %
                              </span>
                            )
                          ) : hasScore ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-lg bg-slate-900 text-amber-300 border border-slate-700 text-[10px] font-mono font-bold">
                              Pourcentage : {((Number(item.score) / selectedAsmt.max_score) * 100).toFixed(1)} %
                            </span>
                          ) : (
                            <span className="inline-block px-2.5 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                              En attente
                            </span>
                          )}
                        </div>

                        <div>
                          <input
                            type="text"
                            disabled={isReadOnly}
                            value={item.teacher_comment || ''}
                            onChange={e => handleGradeItemChange(item.student_id, 'teacher_comment', e.target.value)}
                            placeholder="Commentaire / Observation..."
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-300 text-xs focus:border-slate-700 outline-none disabled:opacity-40"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowGradebookModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer transition-colors text-xs"
                >
                  Fermer
                </button>
                {hasUnsavedChanges && (
                  <span className="text-[11px] font-bold text-amber-400">
                    ● Modifications non enregistrées
                  </span>
                )}
              </div>

              {(selectedAsmt.status === 'draft' || selectedAsmt.status === 'reopened') && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={savingGradebook}
                    onClick={() => handleSaveGradebook(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl cursor-pointer transition-colors text-xs"
                  >
                    {savingGradebook ? 'Enregistrement...' : 'Enregistrer les notes'}
                  </button>

                  <button
                    type="button"
                    disabled={savingGradebook || gradebookStats.pendingCount > 0}
                    onClick={() => handleSaveGradebook(true)}
                    title={
                      gradebookStats.pendingCount > 0
                        ? `Publication impossible : ${gradebookStats.pendingCount} note(s) en attente.`
                        : 'Enregistrer et publier officiellement les résultats'
                    }
                    className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl cursor-pointer flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all text-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{hasUnsavedChanges ? 'Enregistrer & Publier' : 'Publier les résultats'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 3: MODIFIER LES PARAMÈTRES D'UNE ÉVALUATION */}
      {showEditModal && selectedAsmt && (
        <Modal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          title={`Paramètres : ${selectedAsmt.title}`}
          darkMode={true}
        >
          <form onSubmit={handleUpdateAssessment} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Titre de l'évaluation *</label>
              <input
                type="text"
                required
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Instructions</label>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Type *</label>
                <select
                  value={formType}
                  onChange={e => setFormType(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                >
                  <option value="test">Devoir Surveillé</option>
                  <option value="quiz">Interrogation</option>
                  <option value="exam">Examen</option>
                  <option value="homework">Devoir Maison</option>
                  <option value="project">Projet / TP</option>
                  <option value="oral">Oral</option>
                  <option value="practical">Pratique</option>
                  <option value="other">Autre</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Date *</label>
                <input
                  type="date"
                  required
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Barème Max *</label>
                <input
                  type="number"
                  min={1}
                  step="any"
                  required
                  value={formMaxScore}
                  onChange={e => setFormMaxScore(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Coefficient *</label>
                <input
                  type="number"
                  min={0.1}
                  step="any"
                  required
                  value={formCoefficient}
                  onChange={e => setFormCoefficient(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                />
              </div>
            </div>

            {selectedAsmt.status === 'published' && (
              <div>
                <label className="block font-bold text-amber-400 mb-1">Motif de modification de l'évaluation publiée *</label>
                <textarea
                  required
                  value={formReason}
                  onChange={e => setFormReason(e.target.value)}
                  rows={2}
                  placeholder="Ex: Rectification de la date et ajustement du coefficient..."
                  className="w-full px-3 py-2 bg-slate-950 border border-amber-500/40 text-white rounded-xl text-xs"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingAsmt}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl cursor-pointer"
              >
                {submittingAsmt ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 5: ANNULER UNE ÉVALUATION */}
      {showCancelModal && selectedAsmt && (
        <Modal
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title={`Annuler l'Évaluation : ${selectedAsmt.title}`}
          darkMode={true}
        >
          <form onSubmit={handleCancelAssessment} className="space-y-4 text-xs">
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>L'annulation est une action définitive. L'évaluation sera marquée comme annulée et les notes ne seront pas comptabilisées dans la moyenne.</span>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Motif explicite d'annulation *</label>
              <textarea
                required
                value={formReason}
                onChange={e => setFormReason(e.target.value)}
                rows={3}
                placeholder="Ex: Évaluation annulée pour report à une date ultérieure suite à un jour férié..."
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
                disabled={submittingAsmt}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-xl cursor-pointer"
              >
                {submittingAsmt ? 'Annulation...' : 'Confirmer l’Annulation'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 6: RÉOUVRIR UNE ÉVALUATION CLÔTURÉE */}
      {showReopenModal && selectedAsmt && (
        <Modal
          isOpen={showReopenModal}
          onClose={() => setShowReopenModal(false)}
          title={`Réouvrir l'Évaluation : ${selectedAsmt.title}`}
          darkMode={true}
        >
          <form onSubmit={handleReopenAssessment} className="space-y-4 text-xs">
            <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sky-300 text-xs flex items-center gap-2">
              <RotateCcw className="w-5 h-5 flex-shrink-0" />
              <span>La réouverture permet de reprendre la saisie ou de corriger des notes d'une évaluation précédemment clôturée.</span>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Motif explicite de réouverture *</label>
              <textarea
                required
                value={formReason}
                onChange={e => setFormReason(e.target.value)}
                rows={3}
                placeholder="Ex: Réouverture demandée pour intégrer la note de rattrapage d'un élève excusé..."
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
                disabled={submittingAsmt}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-black rounded-xl cursor-pointer"
              >
                {submittingAsmt ? 'Réouverture...' : 'Confirmer la Réouverture'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 7: RATTACHER / DÉFINIR LA PÉRIODE */}
      {showAssignPeriodModal && selectedAsmtForPeriod && (
        <Modal
          isOpen={showAssignPeriodModal}
          onClose={() => setShowAssignPeriodModal(false)}
          title={`Définir la Période : ${selectedAsmtForPeriod.title}`}
          darkMode={true}
        >
          <form onSubmit={handleAssignPeriod} className="space-y-4 text-xs">
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-2 text-amber-200">
              <h4 className="font-extrabold text-white text-sm flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span>Rattachement Périodique Officiel</span>
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 pt-1">
                <div>
                  <span className="text-slate-400 font-bold">Classe :</span>
                  <p className="font-extrabold text-white">{selectedAsmtForPeriod.class_name}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-bold">Matière :</span>
                  <p className="font-extrabold text-amber-400">{selectedAsmtForPeriod.subject_name}</p>
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
                    const cls = classesList.find(c => c.id === selectedAsmtForPeriod.class_id);
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
                placeholder="Ex: Rattachement officiel de l'évaluation legacy à la 1re Période du 1er Semestre..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 text-white rounded-xl text-xs focus:outline-none focus:border-amber-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Cette action est auditée et réaligne automatiquement le trimestre/semestre parent sans altérer les notes saisies.
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
