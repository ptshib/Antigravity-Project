// Fichier : src/types/studentTimetable.ts
// Interfaces TypeScript strictes pour le contrat JSON RPC public.get_authenticated_student_timetable()

export interface TimetableSlot {
  slot_type: 'course' | 'break' | string;
  label?: string | null;
  day_of_week: number;
  day_name: string;
  subject_name: string;
  teacher_name: string;
  room: string;
  start_time: string;
  end_time: string;
}

export interface StudentTimetableSummary {
  total_slots: number;
  total_days: number;
}

export interface StudentTimetableData {
  student_name: string;
  student_number: string;
  class_name: string;
  academic_year_name: string;
  summary: StudentTimetableSummary;
  slots: TimetableSlot[];
}
