import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Calendar,
  Clock,
  BookOpen,
  School,
  MapPin,
  Coffee,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Filter,
  Users
} from 'lucide-react';
import {
  fetchAuthenticatedTeacherTimetable
} from '../../services/teacherTimetableService';
import type {
  TeacherTimetableData,
  TeacherTimetableSlot
} from '../../services/teacherTimetableService';

interface AssignedClassOption {
  id: string;
  name: string;
}

interface TeacherTimetableModuleProps {
  selectedClassId?: string;
  onSelectClassId?: (classId: string) => void;
  assignedClasses?: AssignedClassOption[];
}

const DAYS_MAP: { [key: number]: string } = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi'
};

const SHORT_DAYS_MAP: { [key: number]: string } = {
  1: 'LUN',
  2: 'MAR',
  3: 'MER',
  4: 'JEU',
  5: 'VEN',
  6: 'SAM'
};

export const TeacherTimetableModule: React.FC<TeacherTimetableModuleProps> = ({
  selectedClassId = '',
  onSelectClassId,
  assignedClasses = []
}) => {
  const [data, setData] = useState<TeacherTimetableData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMobileDay, setActiveMobileDay] = useState<number>(1);
  const [classFilter, setClassFilter] = useState<string>(selectedClassId);

  const fetchRequestIdRef = useRef<number>(0);

  useEffect(() => {
    setClassFilter(selectedClassId);
  }, [selectedClassId]);

  const loadTimetable = async (targetClassId: string) => {
    const requestId = ++fetchRequestIdRef.current;
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const result = await fetchAuthenticatedTeacherTimetable(targetClassId);
      if (requestId === fetchRequestIdRef.current) {
        setData(result);
        setLoading(false);
      }
    } catch (err: any) {
      if (requestId === fetchRequestIdRef.current) {
        setError(err?.message || "Impossible de charger l'emploi du temps.");
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadTimetable(classFilter);
  }, [classFilter]);

  const handleFilterChange = (newClassId: string) => {
    setClassFilter(newClassId);
    if (onSelectClassId) {
      onSelectClassId(newClassId);
    }
  };

  const slotsByDay = useMemo(() => {
    const map: { [day: number]: TeacherTimetableSlot[] } = {
      1: [], 2: [], 3: [], 4: [], 5: [], 6: []
    };
    if (data?.slots) {
      data.slots.forEach(slot => {
        if (slot.day_of_week >= 1 && slot.day_of_week <= 6) {
          if (!map[slot.day_of_week]) map[slot.day_of_week] = [];
          map[slot.day_of_week].push(slot);
        }
      });
      Object.keys(map).forEach(dayKey => {
        const dayNum = Number(dayKey);
        map[dayNum].sort((a, b) => a.start_time.localeCompare(b.start_time));
      });
    }
    return map;
  }, [data]);

  const formatDuration = (totalMinutes: number): string => {
    if (!totalMinutes || totalMinutes <= 0) return '0h 00';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (minutes === 0) return `${hours}h 00`;
    return `${hours}h ${minutes < 10 ? '0' : ''}${minutes}`;
  };

  const currentOrNextCourseInfo = useMemo(() => {
    if (!data?.slots || data.slots.length === 0) return null;
    const now = new Date();
    const currentDay = now.getDay() === 0 ? 7 : now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const todaysSlots = data.slots.filter(s => s.day_of_week === currentDay && s.slot_type === 'course');
    if (todaysSlots.length === 0) return null;

    for (const slot of todaysSlots) {
      const [startH, startM] = slot.start_time.split(':').map(Number);
      const [endH, endM] = slot.end_time.split(':').map(Number);
      const startMin = startH * 60 + startM;
      const endMin = endH * 60 + endM;

      if (currentMinutes >= startMin && currentMinutes <= endMin) {
        return { type: 'current' as const, slot };
      }
      if (currentMinutes < startMin) {
        return { type: 'next' as const, slot };
      }
    }
    return null;
  }, [data]);

  return (
    <div className="space-y-6 animate-fade-in" data-testid="teacher-timetable-module">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-black text-slate-900">Emploi du Temps Hebdomadaire</h2>
            {data?.academic_year_name && (
              <span className="text-xs bg-indigo-50 text-indigo-700 font-bold px-2.5 py-0.5 rounded-full border border-indigo-100">
                {data.academic_year_name}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Consultez votre grille de cours et vos temps de pause en temps réel.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-2 rounded-2xl">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={classFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
              data-testid="timetable-class-filter-select"
            >
              <option value="">Toutes mes classes</option>
              {assignedClasses.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => loadTimetable(classFilter)}
            disabled={loading}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl transition-colors disabled:opacity-50"
            title="Rafraîchir l'emploi du temps"
            data-testid="timetable-reload-button"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="timetable-skeleton-kpi">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-3 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-1/2"></div>
              <div className="h-7 bg-slate-200 rounded w-1/3"></div>
              <div className="h-3 bg-slate-200 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      ) : error ? null : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cours Hebdomadaires</span>
              <BookOpen className="w-5 h-5 text-indigo-600" />
            </div>
            <p className="text-2xl font-black text-slate-900" data-testid="kpi-total-courses">
              {data?.total_courses || 0}
            </p>
            <span className="text-[10px] text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded-full inline-block">
              Créneaux dispensés
            </span>
          </div>

          <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Volume Horaire</span>
              <Clock className="w-5 h-5 text-emerald-600" />
            </div>
            <p className="text-2xl font-black text-emerald-900" data-testid="kpi-total-duration">
              {formatDuration(data?.total_duration_minutes || 0)}
            </p>
            <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full inline-block">
              Heures de cours réelles
            </span>
          </div>

          <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Classes Enseignées</span>
              <School className="w-5 h-5 text-amber-600" />
            </div>
            <p className="text-2xl font-black text-amber-900" data-testid="kpi-total-classes">
              {data?.total_classes || 0}
            </p>
            <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full inline-block">
              Groupes distincts
            </span>
          </div>

          <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Temps de Pause</span>
              <Coffee className="w-5 h-5 text-purple-600" />
            </div>
            <p className="text-2xl font-black text-purple-900" data-testid="kpi-total-breaks">
              {data?.total_breaks || 0}
            </p>
            <span className="text-[10px] text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-full inline-block">
              Récréations & inter-cours
            </span>
          </div>
        </div>
      )}

      {currentOrNextCourseInfo && (
        <div className={`p-4 rounded-3xl border flex items-center justify-between gap-4 ${
          currentOrNextCourseInfo.type === 'current'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-indigo-50 border-indigo-200 text-indigo-900'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl ${
              currentOrNextCourseInfo.type === 'current' ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white'
            }`}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider block">
                {currentOrNextCourseInfo.type === 'current' ? 'En cours actuellement' : 'Prochain cours de la journée'}
              </span>
              <p className="text-sm font-black mt-0.5">
                {currentOrNextCourseInfo.slot.subject_name} ({currentOrNextCourseInfo.slot.class_name})
                {currentOrNextCourseInfo.slot.room && ` — Salle ${currentOrNextCourseInfo.slot.room}`}
              </p>
            </div>
          </div>
          <div className="text-right flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span className="text-xs font-bold">
              {currentOrNextCourseInfo.slot.start_time} - {currentOrNextCourseInfo.slot.end_time}
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-4 animate-pulse" data-testid="timetable-skeleton-grid">
          <div className="h-6 bg-slate-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map((day) => (
              <div key={day} className="space-y-3">
                <div className="h-5 bg-slate-200 rounded w-full"></div>
                <div className="h-24 bg-slate-100 rounded-2xl"></div>
                <div className="h-24 bg-slate-100 rounded-2xl"></div>
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="p-8 bg-white rounded-3xl border border-rose-200 text-center space-y-4" data-testid="timetable-error-box">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-black text-rose-900">Erreur de Chargement</h3>
            <p className="text-xs text-rose-700 max-w-md mx-auto mt-1">{error}</p>
          </div>
          <button
            onClick={() => loadTimetable(classFilter)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-2xl transition-colors"
            data-testid="timetable-retry-button"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Réessayer
          </button>
        </div>
      ) : !data || data.total_slots === 0 ? (
        <div className="p-12 bg-white rounded-3xl border border-slate-200 text-center space-y-4" data-testid="timetable-empty-box">
          <div className="w-14 h-14 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center mx-auto">
            <Calendar className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900">Aucun emploi du temps n’est actuellement publié.</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              {classFilter
                ? 'Aucun cours n’est disponible pour la classe sélectionnée dans l’année scolaire courante.'
                : 'Aucun cours ne vous est attribué pour le moment dans l’année scolaire courante.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex md:hidden items-center justify-between bg-white p-2 rounded-2xl border border-slate-200 gap-1 overflow-x-auto">
            {[1, 2, 3, 4, 5, 6].map((dayNum) => {
              const daySlotCount = slotsByDay[dayNum]?.length || 0;
              return (
                <button
                  key={dayNum}
                  onClick={() => setActiveMobileDay(dayNum)}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all text-center whitespace-nowrap ${
                    activeMobileDay === dayNum
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  data-testid={`mobile-day-tab-${dayNum}`}
                >
                  {SHORT_DAYS_MAP[dayNum]}
                  {daySlotCount > 0 && (
                    <span className={`ml-1 text-[10px] px-1.5 py-0.2 rounded-full ${
                      activeMobileDay === dayNum ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {daySlotCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="hidden md:grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map((dayNum) => (
              <DayColumn
                key={dayNum}
                dayName={DAYS_MAP[dayNum]}
                slots={slotsByDay[dayNum] || []}
              />
            ))}
          </div>

          <div className="block md:hidden">
            <DayColumn
              dayName={DAYS_MAP[activeMobileDay]}
              slots={slotsByDay[activeMobileDay] || []}
            />
          </div>
        </div>
      )}
    </div>
  );
};

interface DayColumnProps {
  dayName: string;
  slots: TeacherTimetableSlot[];
}

const DayColumn: React.FC<DayColumnProps> = ({ dayName, slots }) => {
  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-3 flex flex-col h-full shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{dayName}</span>
        <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
          {slots.length} {slots.length > 1 ? 'créneaux' : 'créneau'}
        </span>
      </div>

      {slots.length === 0 ? (
        <div className="py-8 text-center text-slate-400 space-y-1">
          <Clock className="w-5 h-5 mx-auto opacity-40" />
          <p className="text-[11px] font-medium">Aucun cours</p>
        </div>
      ) : (
        <div className="space-y-3 flex-1">
          {slots.map((slot) => (
            <SlotCard key={slot.id} slot={slot} />
          ))}
        </div>
      )}
    </div>
  );
};

const SlotCard: React.FC<{ slot: TeacherTimetableSlot }> = ({ slot }) => {
  if (slot.slot_type === 'break') {
    return (
      <div
        className="p-3 bg-amber-50/60 border border-dashed border-amber-300 rounded-2xl space-y-1.5 transition-all"
        data-testid="timetable-break-card"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-amber-800 font-black text-xs">
            <Coffee className="w-3.5 h-3.5 text-amber-600" />
            <span>{slot.label || 'Pause / Récréation'}</span>
          </div>
          <span className="text-[10px] font-bold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-md">
            {slot.start_time} - {slot.end_time}
          </span>
        </div>
        {slot.class_name && (
          <p className="text-[10px] text-amber-700/80 font-medium">
            {slot.class_name}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="p-3.5 bg-white border border-slate-200 hover:border-indigo-300 rounded-2xl space-y-2 shadow-xs transition-all hover:shadow-md group"
      data-testid="timetable-course-card"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-black text-indigo-900 group-hover:text-indigo-600 transition-colors">
          {slot.subject_name}
        </span>
        <span className="text-[10px] font-extrabold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1">
          <Clock className="w-3 h-3 text-slate-400" />
          {slot.start_time} - {slot.end_time}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
        <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-100 flex items-center gap-1">
          <Users className="w-3 h-3" />
          {slot.class_name}
        </span>

        {slot.room && (
          <span className="bg-slate-50 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200 flex items-center gap-1">
            <MapPin className="w-3 h-3 text-slate-400" />
            Salle {slot.room}
          </span>
        )}
      </div>
    </div>
  );
};
