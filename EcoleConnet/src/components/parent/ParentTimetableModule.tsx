// Fichier : src/components/parent/ParentTimetableModule.tsx
// Module de consultation de l'emploi du temps réel pour le Portail Parent (RPC get_parent_student_timetable)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getParentStudentTimetable,
  type ParentStudentTimetableResult,
  type ParentTimetableSlot
} from '../../services/parentTimetableService';
import { StatCard } from '../common/StatCard';
import {
  Calendar,
  Clock,
  AlertCircle,
  ShieldAlert,
  RefreshCw,
  User,
  Filter,
  MapPin,
  GraduationCap,
  CalendarDays,
  Sparkles,
  Coffee
} from 'lucide-react';

interface ParentTimetableModuleProps {
  studentId: string;
}

const DAYS_MAP: Record<number, string> = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  7: 'Dimanche'
};

export const ParentTimetableModule: React.FC<ParentTimetableModuleProps> = ({ studentId }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [timetableData, setTimetableData] = useState<ParentStudentTimetableResult | null>(null);
  const [errorState, setErrorState] = useState<{ message: string; isPermissionDenied: boolean } | null>(null);

  // Day Filter (0 = Tous les jours, 1 = Lundi, ..., 7 = Dimanche)
  const [selectedDay, setSelectedDay] = useState<number>(0);

  // Compute Current Day of Week (ISO-8601: Monday=1, Sunday=7)
  const currentIsoDay = useMemo(() => {
    const jsDay = new Date().getDay();
    return jsDay === 0 ? 7 : jsDay;
  }, []);

  const fetchTimetable = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setErrorState(null);

    try {
      const { data, error, isPermissionError } = await getParentStudentTimetable(studentId);
      if (error) {
        setErrorState({ message: error.message, isPermissionDenied: isPermissionError });
      } else {
        setTimetableData(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur technique lors du chargement de l’emploi du temps.';
      setErrorState({ message: msg, isPermissionDenied: false });
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    // Immediate reset state on child switch to prevent stale data
    setTimetableData(null);
    setErrorState(null);
    setSelectedDay(0);
    fetchTimetable();
  }, [studentId, fetchTimetable]);

  // Group slots by day_of_week
  const groupedSlotsByDay = useMemo(() => {
    if (!timetableData?.slots) return [];
    
    // Filter slots if a specific day is selected
    const filtered = timetableData.slots.filter(s => {
      if (selectedDay === 0) return true;
      return s.day_of_week === selectedDay;
    });

    // Grouping
    const map = new Map<number, { day_of_week: number; day_name: string; slots: ParentTimetableSlot[] }>();
    
    filtered.forEach(slot => {
      if (!map.has(slot.day_of_week)) {
        map.set(slot.day_of_week, {
          day_of_week: slot.day_of_week,
          day_name: slot.day_name || DAYS_MAP[slot.day_of_week] || `Jour ${slot.day_of_week}`,
          slots: []
        });
      }
      map.get(slot.day_of_week)!.slots.push(slot);
    });

    // Sort days 1 -> 7 and sort slots by start_time
    const result = Array.from(map.values()).sort((a, b) => a.day_of_week - b.day_of_week);
    result.forEach(d => {
      d.slots.sort((a, b) => a.start_time.localeCompare(b.start_time));
    });

    return result;
  }, [timetableData, selectedDay]);

  // Breakdown of course vs break slots
  const slotCounts = useMemo(() => {
    if (!timetableData?.slots) return { courses: 0, breaks: 0, total: 0 };
    let courses = 0;
    let breaks = 0;
    timetableData.slots.forEach(s => {
      if (s.slot_type === 'break') breaks++;
      else courses++;
    });
    return { courses, breaks, total: timetableData.slots.length };
  }, [timetableData]);

  // Available days present in data
  const availableDays = useMemo(() => {
    if (!timetableData?.slots) return [];
    const daysSet = new Set<number>();
    timetableData.slots.forEach(s => daysSet.add(s.day_of_week));
    return Array.from(daysSet).sort((a, b) => a - b);
  }, [timetableData]);

  // Loading Skeleton
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs h-32"></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 h-24"></div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 h-24"></div>
        </div>
        <div className="bg-white rounded-3xl p-6 border border-slate-200 h-64"></div>
      </div>
    );
  }

  // Permission Error Banner
  if (errorState?.isPermissionDenied) {
    return (
      <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-3xl space-y-3 text-amber-200 animate-fade-in my-6">
        <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>Accès restreint à l'emploi du temps</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          {errorState.message}
        </p>
        <p className="text-[11px] text-slate-400">
          Si vous estimez qu'il s'agit d'une erreur, veuillez contacter l'administration de l'établissement pour faire activer le suivi académique de votre compte parent.
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
            <span>Erreur lors du chargement de l'emploi du temps</span>
          </div>
          <button
            type="button"
            onClick={fetchTimetable}
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

  if (!timetableData) return null;

  const { student_name, student_number, class_name, academic_year_name, summary } = timetableData;

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
            Emploi du Temps Hebdomadaire — {student_name}
          </h2>
          <p className="text-xs text-slate-500">
            Horaires officiels de cours et pauses de {student_name}.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          title="Jours d'Enseignement"
          value={summary.total_days}
          subtitle="Jours configurés cette semaine"
          icon={<CalendarDays className="w-5 h-5" />}
          colorScheme="blue"
        />
        <StatCard
          title="Volume Hebdomadaire"
          value={`${slotCounts.courses} cours${slotCounts.breaks > 0 ? ` • ${slotCounts.breaks} pause(s)` : ''}`}
          subtitle={`Total : ${slotCounts.total} créneau(x)`}
          icon={<Clock className="w-5 h-5" />}
          colorScheme="emerald"
        />
      </div>

      {/* Day Filter Bar */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-xs flex items-center gap-3 overflow-x-auto">
        <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700 shrink-0">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <span>Jour :</span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          <button
            type="button"
            onClick={() => setSelectedDay(0)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shrink-0 ${
              selectedDay === 0
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Toute la semaine ({summary.total_slots})
          </button>

          {availableDays.map(dayNum => {
            const isToday = currentIsoDay === dayNum;
            const isSelected = selectedDay === dayNum;
            const dayLabel = DAYS_MAP[dayNum] || `Jour ${dayNum}`;

            return (
              <button
                key={dayNum}
                type="button"
                onClick={() => setSelectedDay(dayNum)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-xs'
                    : isToday
                    ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{dayLabel}</span>
                {isToday && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping shrink-0" title="Aujourd'hui" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grouped Timetable Slots */}
      {groupedSlotsByDay.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center space-y-3">
          <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="text-base font-extrabold text-slate-900">
            Aucun emploi du temps n’a encore été publié pour cet élève.
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Les créneaux de cours hebdomadaires s'afficheront automatiquement dès leur validation officielle par la direction.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedSlotsByDay.map(dayGroup => {
            const isToday = currentIsoDay === dayGroup.day_of_week;
            const dayCourseCount = dayGroup.slots.filter(s => s.slot_type !== 'break').length;
            const dayBreakCount = dayGroup.slots.filter(s => s.slot_type === 'break').length;

            return (
              <div
                key={dayGroup.day_of_week}
                className={`bg-white rounded-3xl border shadow-xs overflow-hidden ${
                  isToday ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-slate-200'
                }`}
              >
                {/* Day Header */}
                <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${
                      isToday ? 'bg-amber-400 text-slate-950' : 'bg-slate-900 text-white'
                    }`}>
                      {dayGroup.day_name.charAt(0)}
                    </div>
                    <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                      <span>{dayGroup.day_name}</span>
                      {isToday && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black uppercase flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-amber-600" />
                          Aujourd'hui
                        </span>
                      )}
                    </h3>
                  </div>
                  <span className="text-xs font-bold text-slate-400">
                    {dayCourseCount} cours{dayBreakCount > 0 ? ` • ${dayBreakCount} pause` : ''}
                  </span>
                </div>

                {/* Slots List */}
                <div className="p-4 divide-y divide-slate-100">
                  {dayGroup.slots.map(slot => {
                    const isBreak = slot.slot_type === 'break';

                    return (
                      <div
                        key={slot.id}
                        className={`py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl px-3 transition-colors ${
                          isBreak ? 'bg-purple-50/60 hover:bg-purple-50 border border-purple-100/60' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <div className="flex items-start sm:items-center gap-4">
                          {/* Time Slot Badge */}
                          <div className={`p-3 border font-extrabold rounded-2xl text-xs text-center shrink-0 min-w-28 ${
                            isBreak
                              ? 'bg-purple-100 text-purple-900 border-purple-200'
                              : 'bg-blue-50 text-blue-800 border-blue-100'
                          }`}>
                            <span className={`block text-sm ${isBreak ? 'text-purple-950' : 'text-blue-900'}`}>{slot.start_time}</span>
                            <span className={`block text-[10px] font-medium ${isBreak ? 'text-purple-600' : 'text-blue-500'}`}>à {slot.end_time}</span>
                          </div>

                          {/* Subject & Teacher Details */}
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <h4 className={`font-black text-sm ${isBreak ? 'text-purple-950' : 'text-slate-900'}`}>
                                {isBreak ? (slot.label || slot.subject_name || 'Pause') : slot.subject_name}
                              </h4>
                              {isBreak && (
                                <span className="px-2 py-0.5 bg-purple-200 text-purple-900 font-extrabold text-[10px] rounded-full inline-flex items-center gap-1">
                                  <Coffee className="w-3 h-3 text-purple-700" />
                                  Pause / Récréation
                                </span>
                              )}
                            </div>

                            {!isBreak && (
                              <p className="text-xs text-slate-500 flex items-center gap-1">
                                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span>{slot.teacher_name}</span>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Room Badge (if specified) */}
                        {slot.room && slot.room.trim() !== '' && (
                          <div className="w-full sm:w-auto text-left sm:text-right">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 border border-slate-200 rounded-xl text-xs font-bold shadow-2xs">
                              <MapPin className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <span>{slot.room}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
