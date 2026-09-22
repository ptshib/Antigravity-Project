// Fichier : src/services/parentHomeworkService.ts
// Service sécurisé de consultation des devoirs réels par le parent via RPC get_parent_student_homework

import { supabase } from '../lib/supabase';

export type ParentHomeworkStatus = 'published' | 'closed';

export interface ParentHomeworkItem {
  id: string;
  title: string;
  instructions: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string;
  teacher_name: string;
  assigned_on: string;
  published_at: string | null;
  due_at: string;
  estimated_minutes: number | null;
  status: ParentHomeworkStatus;
  is_overdue: boolean;
}

export interface ParentHomeworkSummary {
  total: number;
  upcoming: number;
  overdue: number;
}

export interface ParentStudentHomeworkResult {
  student_id: string;
  student_number: string;
  student_name: string;
  class_id: string;
  class_name: string;
  academic_year_id: string | null;
  academic_year_name: string;
  summary: ParentHomeworkSummary;
  homework: ParentHomeworkItem[];
}

export async function getParentStudentHomework(studentId: string): Promise<{
  data: ParentStudentHomeworkResult | null;
  error: Error | null;
  isPermissionError: boolean;
}> {
  try {
    if (!studentId) {
      return { data: null, error: new Error('Identifiant d’élève non spécifié.'), isPermissionError: false };
    }

    const { data, error } = await supabase.rpc('get_parent_student_homework', {
      p_student_id: studentId
    });

    if (error) {
      const isPermErr = error.code === '42501' || error.message.includes('REJET ACCÈS');
      return { data: null, error: new Error(error.message), isPermissionError: isPermErr };
    }

    if (!data || typeof data !== 'object') {
      return {
        data: null,
        error: new Error('Format de réponse invalide pour get_parent_student_homework.'),
        isPermissionError: false
      };
    }

    return { data: data as ParentStudentHomeworkResult, error: null, isPermissionError: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la récupération des devoirs de l’élève.';
    return { data: null, error: new Error(msg), isPermissionError: false };
  }
}
