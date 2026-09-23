import { supabase } from '../lib/supabase';

export interface TeacherTimetableSlot {
  id: string;
  slot_type: 'course' | 'break';
  label: string | null;
  day_of_week: number; // 1 (Lundi) .. 7 (Dimanche)
  day_name: string;
  subject_id: string | null;
  subject_name: string;
  class_id: string;
  class_name: string;
  teacher_id: string | null;
  teacher_name: string;
  room: string;
  start_time: string; // 'HH:MM'
  end_time: string;   // 'HH:MM'
  status: string;
  academic_year_id: string | null;
  academic_year_name: string;
}

export interface TeacherTimetableData {
  teacher_id: string;
  teacher_name: string;
  school_id: string;
  academic_year_id: string | null;
  academic_year_name: string;
  selected_class_id: string | null;
  slots: TeacherTimetableSlot[];
  total_slots: number;
  total_courses: number;
  total_breaks: number;
  total_classes: number;
  total_duration_minutes: number;
}

export class TeacherTimetableError extends Error {
  public code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'TeacherTimetableError';
    this.code = code;
  }
}

/**
 * Récupère l'emploi du temps de l'enseignant authentifié.
 * Sécurité : Aucun teacher_id ni school_id n'est transmis par le client.
 * L'identité de l'enseignant et l'établissement sont résolus côté serveur via auth.uid().
 */
export async function fetchAuthenticatedTeacherTimetable(
  classId?: string
): Promise<TeacherTimetableData> {
  try {
    const params: { p_class_id?: string } = {};
    if (classId && classId.trim() !== '') {
      params.p_class_id = classId.trim();
    }

    const { data, error } = await supabase.rpc(
      'get_authenticated_teacher_timetable',
      params
    );

    if (error) {
      if (error.code === '42501') {
        throw new TeacherTimetableError(
          error.message || 'Accès non autorisé à l’emploi du temps enseignant.',
          '42501'
        );
      }
      throw new TeacherTimetableError(
        `Erreur réseau ou RPC : ${error.message}`,
        error.code
      );
    }

    if (!data) {
      return {
        teacher_id: '',
        teacher_name: '',
        school_id: '',
        academic_year_id: null,
        academic_year_name: 'Non spécifiée',
        selected_class_id: classId || null,
        slots: [],
        total_slots: 0,
        total_courses: 0,
        total_breaks: 0,
        total_classes: 0,
        total_duration_minutes: 0,
      };
    }

    const rawData = data as Partial<TeacherTimetableData>;
    const slots: TeacherTimetableSlot[] = Array.isArray(rawData.slots)
      ? rawData.slots.map((s: any) => ({
          id: String(s.id || ''),
          slot_type: s.slot_type === 'break' ? 'break' : 'course',
          label: s.label ? String(s.label) : null,
          day_of_week: Number(s.day_of_week || 1),
          day_name: String(s.day_name || 'Jour'),
          subject_id: s.subject_id ? String(s.subject_id) : null,
          subject_name: String(s.subject_name || (s.slot_type === 'break' ? 'Pause' : 'Matière')),
          class_id: String(s.class_id || ''),
          class_name: String(s.class_name || 'Classe'),
          teacher_id: s.teacher_id ? String(s.teacher_id) : null,
          teacher_name: String(s.teacher_name || ''),
          room: String(s.room || ''),
          start_time: String(s.start_time || '00:00'),
          end_time: String(s.end_time || '00:00'),
          status: String(s.status || 'active'),
          academic_year_id: s.academic_year_id ? String(s.academic_year_id) : null,
          academic_year_name: String(s.academic_year_name || 'Non spécifiée'),
        }))
      : [];

    return {
      teacher_id: String(rawData.teacher_id || ''),
      teacher_name: String(rawData.teacher_name || 'Enseignant'),
      school_id: String(rawData.school_id || ''),
      academic_year_id: rawData.academic_year_id ? String(rawData.academic_year_id) : null,
      academic_year_name: String(rawData.academic_year_name || 'Non spécifiée'),
      selected_class_id: rawData.selected_class_id ? String(rawData.selected_class_id) : (classId || null),
      slots,
      total_slots: Number(rawData.total_slots || slots.length),
      total_courses: Number(rawData.total_courses || slots.filter(s => s.slot_type === 'course').length),
      total_breaks: Number(rawData.total_breaks || slots.filter(s => s.slot_type === 'break').length),
      total_classes: Number(rawData.total_classes || new Set(slots.map(s => s.class_id)).size),
      total_duration_minutes: Number(rawData.total_duration_minutes || 0),
    };
  } catch (err: any) {
    if (err instanceof TeacherTimetableError) {
      throw err;
    }
    throw new TeacherTimetableError(
      `Impossible de charger l'emploi du temps : ${err?.message || 'Erreur inconnue'}`
    );
  }
}
