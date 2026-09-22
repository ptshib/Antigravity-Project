// Fichier : src/components/parent/ParentHomeworkModule.tsx
// Module de consultation des devoirs réels pour le Portail Parent (RPC get_parent_student_homework)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getParentStudentHomework,
  type ParentStudentHomeworkResult
} from '../../services/parentHomeworkService';
import { StatCard } from '../common/StatCard';
import {
  BookOpen,
  Clock,
  AlertCircle,
  ShieldAlert,
  RefreshCw,
  User,
  Filter,
  Hourglass,
  GraduationCap
} from 'lucide-react';

interface ParentHomeworkModuleProps {
  studentId: string;
}

export const ParentHomeworkModule: React.FC<ParentHomeworkModuleProps> = ({ studentId }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [homeworkData, setHomeworkData] = useState<ParentStudentHomeworkResult | null>(null);
  const [errorState, setErrorState] = useState<{ message: string; isPermissionDenied: boolean } | null>(null);

  // Filters
  const [timeFilter, setTimeFilter] = useState<'all' | 'upcoming' | 'overdue'>('all');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');

  const fetchHomework = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setErrorState(null);

    try {
      const { data, error, isPermissionError } = await getParentStudentHomework(studentId);
      if (error) {
        setErrorState({ message: error.message, isPermissionDenied: isPermissionError });
      } else {
        setHomeworkData(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur technique lors du chargement des devoirs.';
      setErrorState({ message: msg, isPermissionDenied: false });
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    // Immediate reset state on child switch to avoid stale data
    setHomeworkData(null);
    setErrorState(null);
    setTimeFilter('all');
    setSubjectFilter('all');
    fetchHomework();
  }, [studentId, fetchHomework]);

  // Extract unique subjects from homework list for dynamic filtering
  const availableSubjects = useMemo(() => {
    if (!homeworkData?.homework) return [];
    const subjectsMap = new Map<string, string>();
    homeworkData.homework.forEach(hw => {
      if (hw.subject_id && hw.subject_name) {
        subjectsMap.set(hw.subject_id, hw.subject_name);
      }
    });
    return Array.from(subjectsMap.entries()).map(([id, name]) => ({ id, name }));
  }, [homeworkData]);

  // Filtered homework list
  const filteredHomework = useMemo(() => {
    if (!homeworkData?.homework) return [];
    return homeworkData.homework.filter(hw => {
      // Time filter
      if (timeFilter === 'upcoming' && hw.is_overdue) return false;
      if (timeFilter === 'overdue' && !hw.is_overdue) return false;

      // Subject filter
      if (subjectFilter !== 'all' && hw.subject_id !== subjectFilter) return false;

      return true;
    });
  }, [homeworkData, timeFilter, subjectFilter]);

  // Format Date Helper
  const formatDate = (dateString: string) => {
    if (!dateString) return '—';
    try {
      const d = new Date(dateString);
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  // Format DateTime Helper
  const formatDateTime = (dateString: string) => {
    if (!dateString) return '—';
    try {
      const d = new Date(dateString);
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  // Loading Skeleton
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs h-32"></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 h-24"></div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 h-24"></div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 h-24"></div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 h-48"></div>
          <div className="bg-white rounded-3xl p-6 border border-slate-200 h-48"></div>
        </div>
      </div>
    );
  }

  // Permission Error Banner
  if (errorState?.isPermissionDenied) {
    return (
      <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-3xl space-y-3 text-amber-200 animate-fade-in my-6">
        <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>Accès restreint aux devoirs & travaux scolaires</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          {errorState.message}
        </p>
        <p className="text-[11px] text-slate-400">
          Si vous souhaitez activer le suivi des devoirs pour votre enfant, veuillez contacter l'administration de l'établissement.
        </p>
      </div>
    );
  }

  // Technical Error Banner
  if (errorState && !errorState.isPermissionDenied) {
    return (
      <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-3xl space-y-4 text-rose-200 animate-fade-in my-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>Erreur lors du chargement des devoirs</span>
          </div>
          <button
            type="button"
            onClick={fetchHomework}
            className="px-3 py-1.5 bg-rose-900/60 hover:bg-rose-900 text-rose-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Réessayer</span>
          </button>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          {errorState.message}
        </p>
      </div>
    );
  }

  if (!homeworkData) return null;

  const { student_name, student_number, class_name, academic_year_name, summary } = homeworkData;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Header Banner */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1 bg-blue-50 text-blue-800 border border-blue-200 rounded-full text-xs font-extrabold flex items-center gap-1.5">
              <GraduationCap className="w-4 h-4 text-blue-600" />
              {class_name || 'Classe active'}
            </span>
            {academic_year_name && (
              <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-bold">
                Année : {academic_year_name}
              </span>
            )}
            <span className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-full text-xs font-mono font-bold">
              Matricule : {student_number}
            </span>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight pt-1">
            Cahier de Textes & Devoirs — {student_name}
          </h2>
          <p className="text-xs text-slate-500">
            Consultez les devoirs assignés, les consignes et les dates d'échéance programmées par les enseignants.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total des Devoirs Publiés"
          value={summary.total}
          subtitle="Visibles sur le portail"
          icon={<BookOpen className="w-5 h-5" />}
          colorScheme="blue"
        />
        <StatCard
          title="Devoirs À Venir"
          value={summary.upcoming}
          subtitle="Échéance future"
          icon={<Clock className="w-5 h-5" />}
          colorScheme="emerald"
        />
        <StatCard
          title="Devoirs Échus"
          value={summary.overdue}
          subtitle="Date limite dépassée"
          icon={<Hourglass className="w-5 h-5" />}
          colorScheme="amber"
        />
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-xs font-extrabold text-slate-700">Filtres :</span>
          <div className="flex items-center gap-1 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
            <button
              type="button"
              onClick={() => setTimeFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shrink-0 ${
                timeFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Tous ({summary.total})
            </button>
            <button
              type="button"
              onClick={() => setTimeFilter('upcoming')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shrink-0 ${
                timeFilter === 'upcoming'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              À venir ({summary.upcoming})
            </button>
            <button
              type="button"
              onClick={() => setTimeFilter('overdue')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shrink-0 ${
                timeFilter === 'overdue'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Échus ({summary.overdue})
            </button>
          </div>
        </div>

        {/* Dynamic Subject Selector */}
        {availableSubjects.length > 1 && (
          <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
            <label className="text-xs font-bold text-slate-500 whitespace-nowrap">Matière :</label>
            <select
              value={subjectFilter}
              onChange={e => setSubjectFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer w-full md:w-auto"
            >
              <option value="all">Toutes les matières ({availableSubjects.length})</option>
              {availableSubjects.map(sbj => (
                <option key={sbj.id} value={sbj.id}>
                  {sbj.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Homework Cards List */}
      {filteredHomework.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center space-y-3">
          <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="text-base font-extrabold text-slate-900">
            Aucun devoir publié pour le moment pour cet élève.
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Les devoirs et travaux à domicile s'afficheront ici dès leur publication officielle par les enseignants de la classe.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filteredHomework.map(hw => {
            const isOverdue = hw.is_overdue;

            return (
              <div
                key={hw.id}
                className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
              >
                <div className="space-y-3">
                  {/* Subject Tag & Status Badge */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="px-3 py-1 bg-blue-100 text-blue-900 border border-blue-200 rounded-full text-xs font-extrabold">
                      {hw.subject_name}
                    </span>

                    {isOverdue ? (
                      <span className="px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-xs font-extrabold flex items-center gap-1">
                        <Hourglass className="w-3.5 h-3.5 text-rose-600" />
                        Échéance dépassée
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-extrabold flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-emerald-600" />
                        À rendre
                      </span>
                    )}
                  </div>

                  {/* Title & Instructions */}
                  <div>
                    <h3 className="font-extrabold text-base text-slate-900 leading-snug">
                      {hw.title}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed mt-2 whitespace-pre-line bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                      {hw.instructions}
                    </p>
                  </div>
                </div>

                {/* Footer Metadata */}
                <div className="pt-3 border-t border-slate-100 space-y-2 text-xs text-slate-500">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      Enseignant : <strong className="text-slate-800 font-bold">{hw.teacher_name}</strong>
                    </span>
                    {hw.estimated_minutes ? (
                      <span className="text-[11px] font-bold text-slate-400">
                        ⏱️ ~{hw.estimated_minutes} min
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span>Assigné le : <strong className="font-mono text-slate-700">{formatDate(hw.assigned_on)}</strong></span>
                    <span>Échéance : <strong className={`font-mono font-bold ${isOverdue ? 'text-rose-600' : 'text-emerald-700'}`}>{formatDateTime(hw.due_at)}</strong></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
