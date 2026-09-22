// Fichier : src/components/parent/ParentAttendanceModule.tsx
// Module de consultation des présences réelles pour le Portail Parent (RPC get_parent_student_attendance)

import React, { useState, useEffect, useCallback } from 'react';
import {
  getParentStudentAttendance,
  type ParentStudentAttendanceResult,
  type AttendanceStatusType
} from '../../services/parentAttendanceService';
import { StatCard } from '../common/StatCard';
import {
  CalendarCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
  Filter,
  RefreshCw,
  ShieldAlert,
  Info,
  Calendar
} from 'lucide-react';

interface ParentAttendanceModuleProps {
  studentId: string;
}

export const ParentAttendanceModule: React.FC<ParentAttendanceModuleProps> = ({ studentId }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [attendanceData, setAttendanceData] = useState<ParentStudentAttendanceResult | null>(null);
  const [errorState, setErrorState] = useState<{ message: string; isPermissionDenied: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchAttendance = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setErrorState(null);
    try {
      const { data, error } = await getParentStudentAttendance(studentId);
      if (error) {
        const msg = error.message || 'Erreur lors du chargement des présences.';
        const isPerm =
          msg.toLowerCase().includes('42501') ||
          msg.toLowerCase().includes('pas autorisée') ||
          msg.toLowerCase().includes('non autorisée') ||
          msg.toLowerCase().includes('rejet accès');

        setErrorState({ message: msg, isPermissionDenied: isPerm });
      } else {
        setAttendanceData(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur technique lors du chargement des présences.';
      setErrorState({ message: msg, isPermissionDenied: false });
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    // Réinitialiser les états immédiatement au changement d'enfant pour éviter les données obsolètes
    setAttendanceData(null);
    setErrorState(null);
    setStatusFilter('all');
    fetchAttendance();
  }, [studentId, fetchAttendance]);

  // Handle Loading Skeleton State
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs h-32"></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 h-24"></div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 h-24"></div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 h-24"></div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 h-24"></div>
        </div>
        <div className="bg-white rounded-3xl p-6 border border-slate-200 h-64"></div>
      </div>
    );
  }

  // Handle Permission Error
  if (errorState?.isPermissionDenied) {
    return (
      <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-3xl space-y-3 text-amber-200 animate-fade-in my-6">
        <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>Accès restreint à la consultation des présences</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          {errorState.message}
        </p>
        <p className="text-[11px] text-slate-400">
          Si vous estimez qu'il s'agit d'une erreur, veuillez contacter l'administration de l'établissement pour faire activer la permission de suivi des présences sur votre compte parent.
        </p>
      </div>
    );
  }

  // Handle Technical Error
  if (errorState && !errorState.isPermissionDenied) {
    return (
      <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-3xl space-y-4 text-rose-200 animate-fade-in my-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>Erreur lors du chargement du registre de présence</span>
          </div>
          <button
            type="button"
            onClick={fetchAttendance}
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

  if (!attendanceData) return null;

  const { stats, records, today_status, student } = attendanceData;

  // Filter records based on selected status
  const filteredRecords = records.filter(r => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  // Badge helper for attendance status
  const renderStatusBadge = (st: AttendanceStatusType) => {
    switch (st) {
      case 'present':
        return (
          <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-extrabold flex items-center gap-1 w-fit">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Présent(e)
          </span>
        );
      case 'late':
        return (
          <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-xs font-extrabold flex items-center gap-1 w-fit">
            <Clock className="w-3.5 h-3.5" />
            En retard
          </span>
        );
      case 'absent':
        return (
          <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-200 text-xs font-extrabold flex items-center gap-1 w-fit">
            <AlertCircle className="w-3.5 h-3.5" />
            Absent(e)
          </span>
        );
      case 'excused':
        return (
          <span className="px-2.5 py-1 rounded-full bg-purple-100 text-purple-800 border border-purple-200 text-xs font-extrabold flex items-center gap-1 w-fit">
            <ShieldCheck className="w-3.5 h-3.5" />
            Absence excusée
          </span>
        );
      case 'left_early':
        return (
          <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-200 text-xs font-extrabold flex items-center gap-1 w-fit">
            <Clock className="w-3.5 h-3.5" />
            Départ anticipé
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold">
            Non renseigné
          </span>
        );
    }
  };

  const getTodayBadge = () => {
    switch (today_status) {
      case 'present':
        return (
          <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Présent(e) aujourd'hui
          </span>
        );
      case 'late':
        return (
          <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-1">
            <Clock className="w-4 h-4 text-amber-400" />
            En retard aujourd'hui
          </span>
        );
      case 'absent':
        return (
          <span className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold flex items-center gap-1">
            <AlertCircle className="w-4 h-4 text-rose-400" />
            Absent(e) aujourd'hui
          </span>
        );
      case 'excused':
        return (
          <span className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 text-xs font-bold flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-purple-400" />
            Absence excusée aujourd'hui
          </span>
        );
      default:
        return (
          <span className="px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            Aucune séance clôturée aujourd'hui
          </span>
        );
    }
  };

  // Compute attendance rate string and subtitle
  const rateValue = stats.attendance_rate !== null ? `${stats.attendance_rate}%` : '—';
  const rateSubtitle =
    stats.attendance_rate !== null
      ? `${stats.present_effective} présence(s) sur ${stats.evaluated_sessions} séance(s) évaluée(s)`
      : stats.total_sessions === 0
      ? 'Aucune séance comptabilisée'
      : 'Uniquement absences excusées';

  const rateColorScheme =
    stats.attendance_rate === null
      ? 'purple'
      : stats.attendance_rate >= 90
      ? 'emerald'
      : stats.attendance_rate >= 75
      ? 'amber'
      : 'rose';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Banner */}
      <div className="p-6 bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950 text-white rounded-3xl border border-slate-800 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-black">{student.student_full_name}</h2>
            <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold">
              {student.student_number}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Classe : <strong className="text-slate-200">{student.class_name || 'N/A'}</strong> • Suivi officiel des présences et de l'assiduité
          </p>
        </div>

        <div>{getTodayBadge()}</div>
      </div>

      {/* 4 KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Taux de Présence"
          value={rateValue}
          subtitle={rateSubtitle}
          icon={<CalendarCheck className="w-5 h-5" />}
          colorScheme={rateColorScheme}
        />

        <StatCard
          title="Séances Comptabilisées"
          value={stats.total_sessions}
          subtitle={stats.excused_count > 0 ? `${stats.evaluated_sessions} évaluée(s) • ${stats.excused_count} excusée(s)` : 'Séances clôturées'}
          icon={<CheckCircle2 className="w-5 h-5" />}
          colorScheme="blue"
        />

        <StatCard
          title="Absences Non Excusées"
          value={stats.absent_count}
          subtitle={stats.late_count > 0 ? `${stats.late_count} retard(s) enregistré(s)` : 'Aucun retard'}
          icon={<AlertCircle className="w-5 h-5" />}
          colorScheme={stats.absent_count > 0 ? 'rose' : stats.late_count > 0 ? 'amber' : 'emerald'}
        />

        <StatCard
          title="Absences Excusées"
          value={stats.excused_count}
          subtitle="Exclues du calcul du taux"
          icon={<ShieldCheck className="w-5 h-5" />}
          colorScheme="purple"
        />
      </div>

      {/* History Table Container */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs space-y-4">
        {/* Filter & Action Header */}
        <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Historique des Présences ({filteredRecords.length})
              </h3>
              <p className="text-xs text-slate-500">
                Ordre chronologique inversé (séances clôturées)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Filter Dropdown */}
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs w-full sm:w-auto">
              <Filter className="w-4 h-4 text-slate-400 shrink-0" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-transparent text-slate-800 font-bold focus:outline-none cursor-pointer w-full"
              >
                <option value="all">Tous les statuts</option>
                <option value="present">Présent(e)</option>
                <option value="late">En retard</option>
                <option value="absent">Absent(e)</option>
                <option value="excused">Absence excusée</option>
                <option value="left_early">Départ anticipé</option>
              </select>
            </div>

            {/* Discrete Justification Button (Disabled - Feature coming soon per spec #11) */}
            <button
              type="button"
              disabled
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-400 border border-slate-200 rounded-xl text-xs font-bold cursor-not-allowed opacity-75"
              title="Fonction de transmission de justificatif en ligne disponible prochainement."
            >
              <Info className="w-3.5 h-3.5 text-slate-400" />
              <span>Transmettre un justificatif (Prochainement)</span>
            </button>
          </div>
        </div>

        {/* Attendance Records Table */}
        {records.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-2">
            <CalendarCheck className="w-12 h-12 text-slate-300 mx-auto" />
            <h4 className="text-sm font-bold text-slate-800">Aucun relevé de présence</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Aucune séance d'appel n'a encore été enregistrée et clôturée par l'établissement pour {student.student_full_name}.
            </p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-2">
            <Filter className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs font-bold text-slate-700">Aucune séance ne correspond au filtre sélectionné.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider font-extrabold border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Matière & Enseignant</th>
                  <th className="px-6 py-4 text-center">Statut du Jour</th>
                  <th className="px-6 py-4">Détails / Motif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900 font-mono">
                      {rec.attendance_date}
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-900">
                        {rec.subject_name || 'Séance de classe générale'}
                      </p>
                      {rec.teacher_name && (
                        <p className="text-[11px] text-slate-500">
                          Prof. {rec.teacher_name}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 flex justify-center">
                      {renderStatusBadge(rec.status)}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {rec.arrival_time && (
                        <span className="text-[11px] font-mono font-semibold text-amber-700 block">
                          Heure d'arrivée : {rec.arrival_time}
                        </span>
                      )}
                      {rec.justification ? (
                        <span className="italic text-[11px] text-slate-700 bg-slate-100 px-2 py-1 rounded-md block mt-0.5 border border-slate-200/80">
                          « {rec.justification} »
                        </span>
                      ) : rec.status === 'absent' ? (
                        <span className="text-[11px] text-rose-600 italic">Non justifiée</span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
