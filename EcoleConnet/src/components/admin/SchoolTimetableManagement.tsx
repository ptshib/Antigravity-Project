// Fichier : src/components/admin/SchoolTimetableManagement.tsx
// Composant de gestion administrative sécurisée de l'emploi du temps (avec cours et pauses)
// Aucune donnée fictive. Utilise exclusivement adminTimetableService (RPCs Supabase).

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CalendarDays,
  Plus,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  MapPin,
  RefreshCw,
  Eye,
  AlertCircle,
  Ban,
  Archive,
  Coffee,
  BookOpen
} from 'lucide-react';
import { Modal } from '../common/Modal';
import {
  getAdminClassTimetable,
  createSchoolTimetableSlot,
  updateSchoolTimetableSlot,
  setSchoolTimetableSlotStatus,
  type AdminClassTimetableResult,
  type AdminTimetableSlot,
  type CreateSlotParams,
  type UpdateSlotParams,
  type ConflictType,
  type TimetableSlotType
} from '../../services/adminTimetableService';

interface AcademicYearOption {
  id: string;
  name: string;
  is_current?: boolean;
}

interface ClassOption {
  id: string;
  name: string;
}

interface SubjectOption {
  id: string;
  name: string;
  code?: string | null;
}

interface TeacherOption {
  id: string;
  first_name: string;
  last_name: string;
  speciality?: string | null;
}

interface SchoolTimetableManagementProps {
  schoolId: string;
  academicYears: AcademicYearOption[];
  classes: ClassOption[];
  subjects: SubjectOption[];
  teachers: TeacherOption[];
}

const DAYS_OF_WEEK = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 7, label: 'Dimanche' }
];

export const SchoolTimetableManagement: React.FC<SchoolTimetableManagementProps> = ({
  schoolId: _schoolId,
  academicYears,
  classes,
  subjects,
  teachers
}) => {
  // Selection states
  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState<string>(() => {
    const current = academicYears.find(ay => ay.is_current);
    return current ? current.id : academicYears[0]?.id || '';
  });

  const [selectedClassId, setSelectedClassId] = useState<string>(() => classes[0]?.id || '');

  // View state: 'management' or 'parent_preview'
  const [viewMode, setViewMode] = useState<'management' | 'parent_preview'>('management');

  // Timetable data & UI state
  const [timetableResult, setTimetableResult] = useState<AdminClassTimetableResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isPermissionError, setIsPermissionError] = useState<boolean>(false);

  // Filter state inside week view
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'cancelled'>('all');

  // Slot modal state
  const [isSlotModalOpen, setIsSlotModalOpen] = useState<boolean>(false);
  const [editingSlot, setEditingSlot] = useState<AdminTimetableSlot | null>(null);

  // Form state
  const [formSlotType, setFormSlotType] = useState<TimetableSlotType>('course');
  const [formLabel, setFormLabel] = useState<string>('');
  const [formDayOfWeek, setFormDayOfWeek] = useState<number>(1);
  const [formStartTime, setFormStartTime] = useState<string>('08:00');
  const [formEndTime, setFormEndTime] = useState<string>('09:30');
  const [formSubjectId, setFormSubjectId] = useState<string>('');
  const [formTeacherId, setFormTeacherId] = useState<string>('');
  const [formRoom, setFormRoom] = useState<string>('');
  const [formStatus, setFormStatus] = useState<'inactive' | 'active'>('inactive');

  // Modal error / submitting state
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formConflictType, setFormConflictType] = useState<ConflictType>(null);

  // Action confirmation modal (e.g. cancellation)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    slot: AdminTimetableSlot | null;
    targetStatus: 'cancelled' | 'inactive' | 'active';
    title: string;
    description: string;
  }>({
    isOpen: false,
    slot: null,
    targetStatus: 'cancelled',
    title: '',
    description: ''
  });
  const [confirmSubmitting, setConfirmSubmitting] = useState<boolean>(false);

  // Sync selection if options change
  useEffect(() => {
    if (!selectedAcademicYearId && academicYears.length > 0) {
      const current = academicYears.find(ay => ay.is_current);
      setSelectedAcademicYearId(current ? current.id : academicYears[0].id);
    }
  }, [academicYears, selectedAcademicYearId]);

  useEffect(() => {
    if (!selectedClassId && classes.length > 0) {
      setSelectedClassId(classes[0].id);
    }
  }, [classes, selectedClassId]);

  // Fetch timetable data
  const fetchTimetable = useCallback(async () => {
    if (!selectedClassId || !selectedAcademicYearId) {
      setTimetableResult(null);
      return;
    }

    setLoading(true);
    setError(null);
    setIsPermissionError(false);

    const res = await getAdminClassTimetable(selectedClassId, selectedAcademicYearId);

    if (res.error) {
      setError(res.error.message);
      setIsPermissionError(res.isPermissionError);
      setTimetableResult(null);
    } else {
      setTimetableResult(res.data);
    }

    setLoading(false);
  }, [selectedClassId, selectedAcademicYearId]);

  useEffect(() => {
    fetchTimetable();
  }, [fetchTimetable]);

  // Reset form
  const resetForm = useCallback((day: number = 1, defaultSlot: AdminTimetableSlot | null = null) => {
    setEditingSlot(defaultSlot);
    setFormError(null);
    setFormConflictType(null);

    if (defaultSlot) {
      const type = defaultSlot.slot_type || 'course';
      setFormSlotType(type);
      setFormLabel(defaultSlot.label || '');
      setFormDayOfWeek(defaultSlot.day_of_week);
      setFormStartTime(defaultSlot.start_time);
      setFormEndTime(defaultSlot.end_time);
      setFormSubjectId(defaultSlot.subject_id || '');
      setFormTeacherId(defaultSlot.teacher_id || '');
      setFormRoom(defaultSlot.room || '');
      setFormStatus(defaultSlot.status === 'cancelled' ? 'inactive' : defaultSlot.status);
    } else {
      setFormSlotType('course');
      setFormLabel('');
      setFormDayOfWeek(day);
      setFormStartTime('08:00');
      setFormEndTime('09:30');
      setFormSubjectId(subjects[0]?.id || '');
      setFormTeacherId('');
      setFormRoom('');
      setFormStatus('inactive');
    }
  }, [subjects]);

  const handleOpenAddModal = (day: number = 1) => {
    resetForm(day, null);
    setIsSlotModalOpen(true);
  };

  const handleOpenEditModal = (slot: AdminTimetableSlot) => {
    resetForm(slot.day_of_week, slot);
    setIsSlotModalOpen(true);
  };

  const handleSlotTypeChange = (newType: TimetableSlotType) => {
    setFormSlotType(newType);
    setFormError(null);
    if (newType === 'break') {
      setFormSubjectId('');
      setFormTeacherId('');
      if (!formLabel.trim()) {
        setFormLabel('Récréation');
      }
    } else {
      setFormLabel('');
      if (!formSubjectId && subjects.length > 0) {
        setFormSubjectId(subjects[0].id);
      }
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormConflictType(null);

    if (formSlotType === 'course' && !formSubjectId) {
      setFormError('Veuillez sélectionner une matière pour ce cours.');
      return;
    }

    if (formSlotType === 'break' && !formLabel.trim()) {
      setFormError('Veuillez saisir un libellé pour la pause (ex: Récréation du matin).');
      return;
    }

    if (!formStartTime || !formEndTime) {
      setFormError('Veuillez spécifier les heures de début et de fin.');
      return;
    }

    if (formStartTime >= formEndTime) {
      setFormError('L’heure de début doit être strictement antérieure à l’heure de fin.');
      return;
    }

    setFormSubmitting(true);

    if (editingSlot) {
      const updateParams: UpdateSlotParams = {
        slot_id: editingSlot.id,
        slot_type: formSlotType,
        label: formSlotType === 'break' ? formLabel.trim() : null,
        day_of_week: formDayOfWeek,
        start_time: formStartTime,
        end_time: formEndTime,
        subject_id: formSlotType === 'course' ? formSubjectId : null,
        teacher_id: formSlotType === 'course' ? (formTeacherId || null) : null,
        room: formRoom || null,
        status: formStatus
      };

      const res = await updateSchoolTimetableSlot(updateParams);

      if (!res.success) {
        setFormError(res.error?.message || 'Erreur lors de la mise à jour du créneau.');
        setFormConflictType(res.conflictType);
      } else {
        setIsSlotModalOpen(false);
        fetchTimetable();
      }
    } else {
      const createParams: CreateSlotParams = {
        class_id: selectedClassId,
        academic_year_id: selectedAcademicYearId,
        slot_type: formSlotType,
        label: formSlotType === 'break' ? formLabel.trim() : null,
        day_of_week: formDayOfWeek,
        start_time: formStartTime,
        end_time: formEndTime,
        subject_id: formSlotType === 'course' ? formSubjectId : null,
        teacher_id: formSlotType === 'course' ? (formTeacherId || null) : null,
        room: formRoom || null,
        status: formStatus
      };

      const res = await createSchoolTimetableSlot(createParams);

      if (!res.success) {
        setFormError(res.error?.message || 'Erreur lors de la création du créneau.');
        setFormConflictType(res.conflictType);
      } else {
        setIsSlotModalOpen(false);
        fetchTimetable();
      }
    }

    setFormSubmitting(false);
  };

  // Status Change Handlers
  const handleRequestStatusChange = (
    slot: AdminTimetableSlot,
    targetStatus: 'cancelled' | 'inactive' | 'active'
  ) => {
    if (targetStatus === 'cancelled') {
      const slotTitle = slot.slot_type === 'break' ? (slot.label || 'Pause') : slot.subject_name;
      setConfirmModal({
        isOpen: true,
        slot,
        targetStatus: 'cancelled',
        title: 'Annuler ce créneau d’emploi du temps ?',
        description: `Êtes-vous sûr de vouloir annuler "${slotTitle}" (${slot.day_name} ${slot.start_time} - ${slot.end_time}) ? Le créneau sera retiré du portail Parent mais restera archivé.`
      });
    } else if (targetStatus === 'active') {
      executeStatusChange(slot.id, 'active');
    } else {
      executeStatusChange(slot.id, 'inactive');
    }
  };

  const executeStatusChange = async (slotId: string, status: 'cancelled' | 'inactive' | 'active') => {
    setConfirmSubmitting(true);
    const res = await setSchoolTimetableSlotStatus(slotId, status);

    if (!res.success) {
      alert(res.error?.message || 'Impossible de modifier le statut du créneau.');
    } else {
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
      fetchTimetable();
    }
    setConfirmSubmitting(false);
  };

  // Filter slots by status
  const filteredSlots = useMemo(() => {
    if (!timetableResult?.slots) return [];
    if (statusFilter === 'all') return timetableResult.slots;
    return timetableResult.slots.filter(s => s.status === statusFilter);
  }, [timetableResult, statusFilter]);

  // Slots grouped by day
  const slotsByDay = useMemo(() => {
    const map: Record<number, AdminTimetableSlot[]> = {
      1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: []
    };

    const slotsToGroup = viewMode === 'parent_preview'
      ? (timetableResult?.slots || []).filter(s => s.status === 'active')
      : filteredSlots;

    slotsToGroup.forEach(s => {
      if (map[s.day_of_week]) {
        map[s.day_of_week].push(s);
      }
    });

    Object.keys(map).forEach(dayKey => {
      map[Number(dayKey)].sort((a, b) => a.start_time.localeCompare(b.start_time));
    });

    return map;
  }, [timetableResult, filteredSlots, viewMode]);

  return (
    <div className="space-y-6">
      {/* Top Header & Selectors Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
              <CalendarDays className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Emploi du Temps Administratif
              </h2>
              <p className="text-xs text-slate-400">
                Préparation, publication et gestion sécurisée des cours et pauses par classe
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* View Mode Switcher */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
              <button
                type="button"
                onClick={() => setViewMode('management')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                  viewMode === 'management'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                Gestion Admin
              </button>
              <button
                type="button"
                onClick={() => setViewMode('parent_preview')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                  viewMode === 'parent_preview'
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Aperçu Parent
              </button>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={fetchTimetable}
              disabled={loading}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-colors"
              title="Rafraîchir"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Add Slot Button */}
            {viewMode === 'management' && (
              <button
                type="button"
                onClick={() => handleOpenAddModal(1)}
                disabled={!selectedClassId || !selectedAcademicYearId}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 text-sm disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                Ajouter un créneau
              </button>
            )}
          </div>
        </div>

        {/* Selection Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">
              Année Scolaire
            </label>
            <select
              value={selectedAcademicYearId}
              onChange={e => setSelectedAcademicYearId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
            >
              {academicYears.length === 0 ? (
                <option value="">Aucune année scolaire trouvée</option>
              ) : (
                academicYears.map(ay => (
                  <option key={ay.id} value={ay.id}>
                    {ay.name} {ay.is_current ? '(En cours)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">
              Classe
            </label>
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
            >
              {classes.length === 0 ? (
                <option value="">Aucune classe trouvée</option>
              ) : (
                classes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {viewMode === 'management' && timetableResult && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Filtrer par Statut
              </label>
              <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1">
                {(['all', 'active', 'inactive', 'cancelled'] as const).map(st => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`flex-1 py-1 text-xs rounded-lg font-medium transition-all ${
                      statusFilter === st
                        ? 'bg-slate-800 text-white font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st === 'all' && 'Tous'}
                    {st === 'active' && 'Actifs'}
                    {st === 'inactive' && 'Brouillons'}
                    {st === 'cancelled' && 'Annulés'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Summary Badges */}
        {timetableResult && viewMode === 'management' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
            <span className="px-3 py-1 bg-slate-800 text-slate-300 rounded-full font-medium border border-slate-700">
              Total : <strong className="text-white">{timetableResult.summary.total_slots}</strong> créneaux
            </span>
            <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full font-medium border border-emerald-500/20">
              Publiés : <strong>{timetableResult.summary.active_slots}</strong>
            </span>
            <span className="px-3 py-1 bg-amber-500/10 text-amber-400 rounded-full font-medium border border-amber-500/20">
              Brouillons : <strong>{timetableResult.summary.inactive_slots}</strong>
            </span>
            {timetableResult.summary.cancelled_slots > 0 && (
              <span className="px-3 py-1 bg-rose-500/10 text-rose-400 rounded-full font-medium border border-rose-500/20">
                Annulés : <strong>{timetableResult.summary.cancelled_slots}</strong>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Permission or General Error Banner */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-3 text-rose-300">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <h4 className="font-bold">
              {isPermissionError ? 'Accès Refusé' : 'Erreur de Chargement'}
            </h4>
            <p className="mt-1 opacity-90">{error}</p>
            <button
              onClick={fetchTimetable}
              className="mt-3 px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium rounded-lg text-xs transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Réessayer
            </button>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3 animate-pulse">
              <div className="h-5 bg-slate-800 rounded w-1/2"></div>
              <div className="h-20 bg-slate-800/60 rounded-xl"></div>
              <div className="h-20 bg-slate-800/60 rounded-xl"></div>
            </div>
          ))}
        </div>
      )}

      {/* Main Weekly Schedule Grid */}
      {!loading && !error && (
        <>
          {/* Empty State */}
          {(!timetableResult || timetableResult.slots.length === 0) ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
              <div className="w-16 h-16 bg-slate-800 text-slate-500 rounded-full flex items-center justify-center mx-auto">
                <CalendarDays className="w-8 h-8" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h3 className="text-lg font-bold text-white">
                  Aucun créneau d’emploi du temps
                </h3>
                <p className="text-sm text-slate-400">
                  {viewMode === 'parent_preview'
                    ? 'Aucun créneau actif n’est encore publié pour cette classe.'
                    : 'Commencez à préparer l’emploi du temps de cette classe en ajoutant des cours ou pauses.'}
                </p>
              </div>
              {viewMode === 'management' && (
                <button
                  type="button"
                  onClick={() => handleOpenAddModal(1)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow transition-all inline-flex items-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Créer un premier créneau
                </button>
              )}
            </div>
          ) : (
            /* Schedule Grid by Day */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {DAYS_OF_WEEK.slice(0, 6).map(day => {
                const daySlots = slotsByDay[day.value] || [];

                return (
                  <div
                    key={day.value}
                    className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-lg"
                  >
                    {/* Day Header */}
                    <div className="bg-slate-950/80 border-b border-slate-800 p-3.5 flex items-center justify-between">
                      <span className="font-bold text-white text-sm">
                        {day.label}
                      </span>
                      <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-medium">
                        {daySlots.length} créneaux
                      </span>
                    </div>

                    {/* Day Slots List */}
                    <div className="p-3 flex-1 space-y-3 min-h-[220px]">
                      {daySlots.length === 0 ? (
                        <div className="h-full flex items-center justify-center p-6 text-center text-xs text-slate-500 italic">
                          Pas de créneau
                        </div>
                      ) : (
                        daySlots.map(slot => {
                          const isBreak = slot.slot_type === 'break';

                          return (
                            <div
                              key={slot.id}
                              className={`p-3.5 rounded-xl border transition-all space-y-2 relative group ${
                                isBreak
                                  ? slot.status === 'active'
                                    ? 'bg-purple-950/40 border-purple-500/40 hover:border-purple-400'
                                    : slot.status === 'inactive'
                                    ? 'bg-purple-950/20 border-purple-500/20 hover:border-purple-500/40'
                                    : 'bg-slate-950/20 border-rose-500/20 opacity-60'
                                  : slot.status === 'active'
                                  ? 'bg-slate-950/80 border-emerald-500/30 hover:border-emerald-500/50'
                                  : slot.status === 'inactive'
                                  ? 'bg-slate-950/40 border-amber-500/30 hover:border-amber-500/50'
                                  : 'bg-slate-950/20 border-rose-500/20 opacity-60'
                              }`}
                            >
                              {/* Time & Status Badge */}
                              <div className="flex items-center justify-between text-xs">
                                <span className={`font-semibold flex items-center gap-1 ${isBreak ? 'text-purple-300' : 'text-amber-400'}`}>
                                  <Clock className="w-3.5 h-3.5" />
                                  {slot.start_time} - {slot.end_time}
                                </span>

                                {viewMode === 'management' && (
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                      slot.status === 'active'
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                        : slot.status === 'inactive'
                                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                    }`}
                                  >
                                    {slot.status === 'active' && 'Publié'}
                                    {slot.status === 'inactive' && 'Brouillon'}
                                    {slot.status === 'cancelled' && 'Annulé'}
                                  </span>
                                )}
                              </div>

                              {/* Title / Subject / Label */}
                              <div className="font-bold text-white text-sm leading-snug flex items-center gap-1.5">
                                {isBreak ? (
                                  <>
                                    <Coffee className="w-4 h-4 text-purple-400 shrink-0" />
                                    <span>{slot.label || 'Pause / Récréation'}</span>
                                  </>
                                ) : (
                                  <span>{slot.subject_name}</span>
                                )}
                              </div>

                              {/* Details: Teacher (if course) & Room (if present) */}
                              <div className="space-y-1 text-xs text-slate-400">
                                {!isBreak && (
                                  <div className="flex items-center gap-1.5 truncate">
                                    <User className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                                    <span className="truncate">
                                      {slot.teacher_name || 'Enseignant non spécifié'}
                                    </span>
                                  </div>
                                )}
                                {slot.room && (
                                  <div className="flex items-center gap-1.5 truncate">
                                    <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                                    <span className="truncate font-mono">
                                      Salle : {slot.room}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Management Actions */}
                              {viewMode === 'management' && (
                                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-end gap-1.5">
                                  {/* Edit Button */}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(slot)}
                                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                                    title="Modifier"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Publish / Deactivate Button */}
                                  {slot.status === 'inactive' && (
                                    <button
                                      type="button"
                                      onClick={() => handleRequestStatusChange(slot, 'active')}
                                      className="p-1.5 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors"
                                      title="Publier (Activer)"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}

                                  {slot.status === 'active' && (
                                    <button
                                      type="button"
                                      onClick={() => handleRequestStatusChange(slot, 'inactive')}
                                      className="p-1.5 text-amber-400 hover:bg-amber-500/20 rounded-lg transition-colors"
                                      title="Remettre en brouillon"
                                    >
                                      <Archive className="w-3.5 h-3.5" />
                                    </button>
                                  )}

                                  {/* Cancel Button */}
                                  {slot.status !== 'cancelled' && (
                                    <button
                                      type="button"
                                      onClick={() => handleRequestStatusChange(slot, 'cancelled')}
                                      className="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg transition-colors"
                                      title="Annuler le créneau"
                                    >
                                      <Ban className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}

                      {/* Quick Add at bottom of day */}
                      {viewMode === 'management' && (
                        <button
                          type="button"
                          onClick={() => handleOpenAddModal(day.value)}
                          className="w-full py-2 border border-dashed border-slate-800 hover:border-amber-500/40 hover:bg-slate-800/30 text-slate-500 hover:text-amber-400 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Ajouter ({day.label})
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Modal: Create or Edit Timetable Slot */}
      {isSlotModalOpen && (
        <Modal
          isOpen={isSlotModalOpen}
          onClose={() => setIsSlotModalOpen(false)}
          title={editingSlot ? 'Modifier le créneau d’emploi du temps' : 'Nouveau créneau d’emploi du temps'}
        >
          <form onSubmit={handleFormSubmit} className="space-y-4">
            {/* Conflict Banner */}
            {formError && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  formConflictType
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">
                    {formConflictType ? 'Conflit Détecté' : 'Erreur de Validation'}
                  </strong>
                  <span className="opacity-90">{formError}</span>
                </div>
              </div>
            )}

            {/* Slot Type Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Type de Créneau *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleSlotTypeChange('course')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    formSlotType === 'course'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-400 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  Cours avec matière
                </button>
                <button
                  type="button"
                  onClick={() => handleSlotTypeChange('break')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    formSlotType === 'break'
                      ? 'bg-purple-500/20 border-purple-500 text-purple-300 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Coffee className="w-4 h-4" />
                  Pause / Récréation
                </button>
              </div>
            </div>

            {/* Day of week */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Jour de la semaine *
              </label>
              <select
                value={formDayOfWeek}
                onChange={e => setFormDayOfWeek(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
              >
                {DAYS_OF_WEEK.map(d => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Hours: start & end */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Heure Début *
                </label>
                <input
                  type="time"
                  value={formStartTime}
                  onChange={e => setFormStartTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Heure Fin *
                </label>
                <input
                  type="time"
                  value={formEndTime}
                  onChange={e => setFormEndTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
            </div>

            {/* Subject (for Course type) */}
            {formSlotType === 'course' && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Matière *
                </label>
                <select
                  value={formSubjectId}
                  onChange={e => setFormSubjectId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  required
                >
                  <option value="">Sélectionner une matière...</option>
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.code ? `(${s.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Label (for Break type) */}
            {formSlotType === 'break' && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Libellé de la pause *
                </label>
                <input
                  type="text"
                  value={formLabel}
                  onChange={e => setFormLabel(e.target.value)}
                  placeholder="Ex: Récréation du matin, Pause déjeuner"
                  className="w-full bg-slate-950 border border-purple-500/50 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-400"
                  required
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Saisissez un libellé clair pour les élèves et les parents.
                </p>
              </div>
            )}

            {/* Teacher (Optional, only for Course type) */}
            {formSlotType === 'course' && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Enseignant (Facultatif)
                </label>
                <select
                  value={formTeacherId}
                  onChange={e => setFormTeacherId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="">Aucun (Non attribué)</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.first_name} {t.last_name} {t.speciality ? `(${t.speciality})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Room (Optional for both) */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Salle (Facultatif)
              </label>
              <input
                type="text"
                value={formRoom}
                onChange={e => setFormRoom(e.target.value)}
                placeholder="Ex: Cour de récréation, Refectoire, Labo 1"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Initial Status */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Statut Initial
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFormStatus('inactive')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    formStatus === 'inactive'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Archive className="w-3.5 h-3.5" />
                  Brouillon (Inactif)
                </button>
                <button
                  type="button"
                  onClick={() => setFormStatus('active')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    formStatus === 'active'
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Publié (Actif)
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsSlotModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-sm"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={formSubmitting}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-sm shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {formSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                {editingSlot ? 'Sauvegarder' : 'Créer le créneau'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirmation Modal for Cancellation */}
      {confirmModal.isOpen && (
        <Modal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
          title={confirmModal.title}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {confirmModal.description}
            </p>
            <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-sm"
              >
                Conserver
              </button>
              <button
                type="button"
                disabled={confirmSubmitting}
                onClick={() => confirmModal.slot && executeStatusChange(confirmModal.slot.id, confirmModal.targetStatus)}
                className="px-5 py-2 bg-rose-500 hover:bg-rose-400 text-white font-bold rounded-xl text-sm shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {confirmSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                Confirmer l’annulation
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
