// Fichier : src/services/parentTimetableService.ts
// Service sécurisé de consultation de l'emploi du temps par le parent via RPC get_parent_student_timetable

import { supabase } from '../lib/supabase';

export interface ParentTimetableSlot {
  id: string;
  day_of_week: number; // 1 = Lundi, ..., 7 = Dimanche
  day_name: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string | null;
  teacher_name: string;
  room: string;
  start_time: string; // '08:00'
  end_time: string; // '09:30'
  status: string;
}

export interface ParentTimetableSummary {
  total_slots: number;
  total_days: number;
}

export interface ParentStudentTimetableResult {
  student_id: string;
  student_number: string;
  student_name: string;
  class_id: string;
  class_name: string;
  academic_year_id: string | null;
  academic_year_name: string;
  summary: ParentTimetableSummary;
  slots: ParentTimetableSlot[];
}

export async function getParentStudentTimetable(studentId: string): Promise<{
  data: ParentStudentTimetableResult | null;
  error: Error | null;
  isPermissionError: boolean;
}> {
  try {
    if (!studentId) {
      return { data: null, error: new Error('Identifiant d’élève non spécifié.'), isPermissionError: false };
    }

    const { data, error } = await supabase.rpc('get_parent_student_timetable', {
      p_student_id: studentId
    });

    if (error) {
      const isPermErr = error.code === '42501' || error.message.includes('REJET ACCÈS');
      return { data: null, error: new Error(error.message), isPermissionError: isPermErr };
    }

    if (!data || typeof data !== 'object') {
      return {
        data: null,
        error: new Error('Format de réponse invalide pour get_parent_student_timetable.'),
        isPermissionError: false
      };
    }

    return { data: data as ParentStudentTimetableResult, error: null, isPermissionError: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la récupération de l’emploi du temps de l’élève.';
    return { data: null, error: new Error(msg), isPermissionError: false };
  }
}
