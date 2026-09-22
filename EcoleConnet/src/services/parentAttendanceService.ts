// Fichier : src/services/parentAttendanceService.ts
// Service sécurisé de consultation des présences parent via RPC get_parent_student_attendance

import { supabase } from '../lib/supabase';

export type AttendanceStatusType = 'present' | 'absent' | 'late' | 'excused' | 'left_early' | 'not_recorded';

export interface ParentAttendanceRecord {
  id: string;
  attendance_date: string;
  status: AttendanceStatusType;
  arrival_time: string | null;
  justification: string | null;
  justified: boolean;
  subject_name: string | null;
  teacher_name: string | null;
}

export interface ParentAttendanceStats {
  total_sessions: number;
  evaluated_sessions: number;
  present_effective: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  left_early_count: number;
  attendance_rate: number | null;
}

export interface ParentStudentAttendanceResult {
  student: {
    id: string;
    student_number: string;
    student_full_name: string;
    class_name: string;
  };
  today_status: AttendanceStatusType;
  stats: ParentAttendanceStats;
  records: ParentAttendanceRecord[];
}

export async function getParentStudentAttendance(studentId: string): Promise<{
  data: ParentStudentAttendanceResult | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase.rpc('get_parent_student_attendance', {
      p_student_id: studentId
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    if (!data || typeof data !== 'object') {
      return { data: null, error: new Error('Format de réponse invalide pour get_parent_student_attendance.') };
    }

    return { data: data as ParentStudentAttendanceResult, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la récupération des présences de l’élève.';
    return { data: null, error: new Error(msg) };
  }
}
