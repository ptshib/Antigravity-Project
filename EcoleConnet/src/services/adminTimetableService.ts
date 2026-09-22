// Fichier : src/services/adminTimetableService.ts
// Service d'administration sécurisée de l'emploi du temps via RPC Supabase
// Aucun accès direct à la table public.school_timetables.

import { supabase } from '../lib/supabase';

export type TimetableSlotType = 'course' | 'break';

export interface AdminTimetableSlot {
  id: string;
  slot_type: TimetableSlotType;
  label?: string | null;
  day_of_week: number; // 1 = Lundi, ..., 7 = Dimanche
  day_name: string;
  start_time: string; // '08:00'
  end_time: string; // '09:30'
  subject_id: string | null;
  subject_name: string;
  subject_code?: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  room: string | null;
  status: 'inactive' | 'active' | 'cancelled';
  created_at?: string;
  updated_at?: string;
}

export interface AdminTimetableClassInfo {
  id: string;
  name: string;
}

export interface AdminTimetableAcademicYearInfo {
  id: string;
  name: string;
}

export interface AdminClassTimetableResult {
  school_id: string;
  academic_year: AdminTimetableAcademicYearInfo;
  class: AdminTimetableClassInfo;
  slots: AdminTimetableSlot[];
  summary: {
    total_slots: number;
    active_slots: number;
    inactive_slots: number;
    cancelled_slots: number;
    total_days?: number;
  };
}

export interface CreateSlotParams {
  class_id: string;
  academic_year_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  subject_id?: string | null;
  teacher_id?: string | null;
  room?: string | null;
  status?: 'inactive' | 'active';
  slot_type?: TimetableSlotType;
  label?: string | null;
}

export interface UpdateSlotParams {
  slot_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  subject_id?: string | null;
  teacher_id?: string | null;
  room?: string | null;
  status?: 'inactive' | 'active' | 'cancelled';
  slot_type?: TimetableSlotType;
  label?: string | null;
}

export type ConflictType = 'class' | 'teacher' | 'room' | null;

export interface TimetableMutationResult {
  success: boolean;
  data: AdminTimetableSlot | null;
  error: Error | null;
  isPermissionError: boolean;
  isConflictError: boolean;
  conflictType: ConflictType;
  conflictMessage: string | null;
}

function parseTimetableError(error: any): {
  errorObj: Error;
  isPermissionError: boolean;
  isConflictError: boolean;
  conflictType: ConflictType;
  conflictMessage: string | null;
} {
  const msg = error?.message || 'Erreur lors de l’opération sur l’emploi du temps.';
  const isPerm = error?.code === '42501' || msg.includes('REJET ACCÈS') || msg.includes('Non autorisé');

  let isConflict = false;
  let conflictType: ConflictType = null;
  let conflictMsg: string | null = null;

  if (msg.includes('TIMETABLE_CLASS_CONFLICT')) {
    isConflict = true;
    conflictType = 'class';
    conflictMsg = 'Conflit horaire : la classe a déjà un cours ou une pause actif en chevauchement.';
  } else if (msg.includes('TIMETABLE_TEACHER_CONFLICT')) {
    isConflict = true;
    conflictType = 'teacher';
    conflictMsg = 'Conflit d’enseignant : l’enseignant sélectionné est déjà affecté à un autre cours sur ce créneau.';
  } else if (msg.includes('TIMETABLE_ROOM_CONFLICT')) {
    isConflict = true;
    conflictType = 'room';
    conflictMsg = 'Conflit de salle : la salle spécifiée est déjà occupée par un autre créneau.';
  }

  return {
    errorObj: new Error(conflictMsg || msg),
    isPermissionError: isPerm,
    isConflictError: isConflict,
    conflictType,
    conflictMessage: conflictMsg
  };
}

export async function getAdminClassTimetable(
  classId: string,
  academicYearId: string
): Promise<{
  data: AdminClassTimetableResult | null;
  error: Error | null;
  isPermissionError: boolean;
}> {
  try {
    if (!classId || !academicYearId) {
      return {
        data: null,
        error: new Error('La classe et l’année scolaire sont obligatoires.'),
        isPermissionError: false
      };
    }

    const { data, error } = await supabase.rpc('get_admin_class_timetable', {
      p_class_id: classId,
      p_academic_year_id: academicYearId
    });

    if (error) {
      const parsed = parseTimetableError(error);
      return { data: null, error: parsed.errorObj, isPermissionError: parsed.isPermissionError };
    }

    if (!data || typeof data !== 'object') {
      return {
        data: null,
        error: new Error('Réponse invalide du serveur pour get_admin_class_timetable.'),
        isPermissionError: false
      };
    }

    return { data: data as AdminClassTimetableResult, error: null, isPermissionError: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la récupération de l’emploi du temps.';
    return { data: null, error: new Error(msg), isPermissionError: false };
  }
}

export async function createSchoolTimetableSlot(
  params: CreateSlotParams
): Promise<TimetableMutationResult> {
  try {
    const { data, error } = await supabase.rpc('create_school_timetable_slot', {
      p_class_id: params.class_id,
      p_academic_year_id: params.academic_year_id,
      p_day_of_week: params.day_of_week,
      p_start_time: params.start_time,
      p_end_time: params.end_time,
      p_subject_id: params.subject_id || null,
      p_teacher_id: params.teacher_id || null,
      p_room: params.room || null,
      p_status: params.status || 'inactive',
      p_slot_type: params.slot_type || 'course',
      p_label: params.label || null
    });

    if (error) {
      const parsed = parseTimetableError(error);
      return {
        success: false,
        data: null,
        error: parsed.errorObj,
        isPermissionError: parsed.isPermissionError,
        isConflictError: parsed.isConflictError,
        conflictType: parsed.conflictType,
        conflictMessage: parsed.conflictMessage
      };
    }

    return {
      success: true,
      data: data as AdminTimetableSlot,
      error: null,
      isPermissionError: false,
      isConflictError: false,
      conflictType: null,
      conflictMessage: null
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur imprévue lors de la création du créneau.';
    return {
      success: false,
      data: null,
      error: new Error(msg),
      isPermissionError: false,
      isConflictError: false,
      conflictType: null,
      conflictMessage: null
    };
  }
}

export async function updateSchoolTimetableSlot(
  params: UpdateSlotParams
): Promise<TimetableMutationResult> {
  try {
    const { data, error } = await supabase.rpc('update_school_timetable_slot', {
      p_slot_id: params.slot_id,
      p_day_of_week: params.day_of_week,
      p_start_time: params.start_time,
      p_end_time: params.end_time,
      p_subject_id: params.subject_id || null,
      p_teacher_id: params.teacher_id || null,
      p_room: params.room || null,
      p_status: params.status || 'inactive',
      p_slot_type: params.slot_type || 'course',
      p_label: params.label || null
    });

    if (error) {
      const parsed = parseTimetableError(error);
      return {
        success: false,
        data: null,
        error: parsed.errorObj,
        isPermissionError: parsed.isPermissionError,
        isConflictError: parsed.isConflictError,
        conflictType: parsed.conflictType,
        conflictMessage: parsed.conflictMessage
      };
    }

    return {
      success: true,
      data: data as AdminTimetableSlot,
      error: null,
      isPermissionError: false,
      isConflictError: false,
      conflictType: null,
      conflictMessage: null
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur imprévue lors de la modification du créneau.';
    return {
      success: false,
      data: null,
      error: new Error(msg),
      isPermissionError: false,
      isConflictError: false,
      conflictType: null,
      conflictMessage: null
    };
  }
}

export async function setSchoolTimetableSlotStatus(
  slotId: string,
  status: 'inactive' | 'active' | 'cancelled'
): Promise<TimetableMutationResult> {
  try {
    const { data, error } = await supabase.rpc('set_school_timetable_slot_status', {
      p_slot_id: slotId,
      p_status: status
    });

    if (error) {
      const parsed = parseTimetableError(error);
      return {
        success: false,
        data: null,
        error: parsed.errorObj,
        isPermissionError: parsed.isPermissionError,
        isConflictError: parsed.isConflictError,
        conflictType: parsed.conflictType,
        conflictMessage: parsed.conflictMessage
      };
    }

    return {
      success: true,
      data: data as AdminTimetableSlot,
      error: null,
      isPermissionError: false,
      isConflictError: false,
      conflictType: null,
      conflictMessage: null
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur imprévue lors du changement de statut.';
    return {
      success: false,
      data: null,
      error: new Error(msg),
      isPermissionError: false,
      isConflictError: false,
      conflictType: null,
      conflictMessage: null
    };
  }
}
