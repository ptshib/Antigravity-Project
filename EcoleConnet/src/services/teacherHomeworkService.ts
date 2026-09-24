import { supabase } from '../lib/supabase';

export interface TeacherHomework {
  id: string;
  school_id: string;
  academic_year_id: string;
  term_id: string | null;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string;
  teacher_name: string;
  title: string;
  instructions: string;
  assigned_on: string;
  due_at: string;
  estimated_minutes: number | null;
  status: 'draft' | 'published' | 'closed' | 'cancelled';
  published_at: string | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTeacherHomeworkPayload {
  class_id: string;
  subject_id: string;
  title: string;
  instructions: string;
  assigned_on: string;
  due_at: string;
  estimated_minutes?: number | null;
  publish_now?: boolean;
  term_id?: string | null;
}

export interface UpdateTeacherHomeworkPayload {
  homework_id: string;
  title: string;
  instructions: string;
  assigned_on: string;
  due_at: string;
  estimated_minutes?: number | null;
  term_id?: string | null;
  reason?: string | null;
}

export class TeacherHomeworkError extends Error {
  public code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'TeacherHomeworkError';
    this.code = code;
  }
}

/**
 * Récupère la liste des devoirs de l'enseignant authentifié.
 * Sécurité : Aucun school_id, teacher_id ni profile_id n'est envoyé par le client.
 */
export async function fetchTeacherHomework(): Promise<TeacherHomework[]> {
  try {
    const { data, error } = await supabase.rpc('get_teacher_homework');

    if (error) {
      if (error.code === '42501') {
        throw new TeacherHomeworkError(error.message || 'Accès non autorisé aux devoirs enseignant.', '42501');
      }
      throw new TeacherHomeworkError(`Erreur RPC get_teacher_homework : ${error.message}`, error.code);
    }

    if (!data || !Array.isArray(data)) {
      return [];
    }

    return data.map((item: any) => ({
      id: String(item.id || ''),
      school_id: String(item.school_id || ''),
      academic_year_id: String(item.academic_year_id || ''),
      term_id: item.term_id ? String(item.term_id) : null,
      class_id: String(item.class_id || ''),
      class_name: String(item.class_name || 'Classe'),
      subject_id: String(item.subject_id || ''),
      subject_name: String(item.subject_name || 'Matière'),
      teacher_id: String(item.teacher_id || ''),
      teacher_name: String(item.teacher_name || 'Enseignant'),
      title: String(item.title || ''),
      instructions: String(item.instructions || ''),
      assigned_on: String(item.assigned_on || ''),
      due_at: String(item.due_at || ''),
      estimated_minutes: item.estimated_minutes != null ? Number(item.estimated_minutes) : null,
      status: item.status as TeacherHomework['status'],
      published_at: item.published_at ? String(item.published_at) : null,
      closed_at: item.closed_at ? String(item.closed_at) : null,
      created_by: String(item.created_by || ''),
      created_at: String(item.created_at || ''),
      updated_at: String(item.updated_at || ''),
    }));
  } catch (err: any) {
    if (err instanceof TeacherHomeworkError) throw err;
    throw new TeacherHomeworkError(`Impossible de charger la liste des devoirs : ${err?.message || 'Erreur inconnue'}`);
  }
}

/**
 * Crée un nouveau devoir pour un enseignant authentifié.
 */
export async function createTeacherHomework(
  payload: CreateTeacherHomeworkPayload
): Promise<string> {
  try {
    if (!payload.class_id || !payload.subject_id || !payload.title.trim() || !payload.instructions.trim()) {
      throw new TeacherHomeworkError('Veuillez remplir tous les champs obligatoires (classe, matière, titre, consignes).');
    }

    const { data, error } = await supabase.rpc('create_teacher_homework', {
      p_class_id: payload.class_id,
      p_subject_id: payload.subject_id,
      p_title: payload.title.trim(),
      p_instructions: payload.instructions.trim(),
      p_assigned_on: payload.assigned_on,
      p_due_at: payload.due_at,
      p_estimated_minutes: payload.estimated_minutes || null,
      p_publish_now: !!payload.publish_now,
      p_term_id: payload.term_id || null,
    });

    if (error) {
      if (error.code === '42501') {
        throw new TeacherHomeworkError(error.message || 'Accès non autorisé : Affectation ou statut invalide.', '42501');
      }
      throw new TeacherHomeworkError(error.message || 'Erreur lors de la création du devoir.', error.code);
    }

    return String(data || '');
  } catch (err: any) {
    if (err instanceof TeacherHomeworkError) throw err;
    throw new TeacherHomeworkError(`Erreur lors de la création du devoir : ${err?.message || 'Erreur inconnue'}`);
  }
}

/**
 * Modifie un devoir existant (uniquement au statut draft, ou avec motif si publié).
 */
export async function updateTeacherHomework(
  payload: UpdateTeacherHomeworkPayload
): Promise<boolean> {
  try {
    if (!payload.homework_id || !payload.title.trim() || !payload.instructions.trim()) {
      throw new TeacherHomeworkError('Veuillez remplir tous les champs obligatoires (titre, consignes).');
    }

    const { data, error } = await supabase.rpc('update_teacher_homework', {
      p_homework_id: payload.homework_id,
      p_title: payload.title.trim(),
      p_instructions: payload.instructions.trim(),
      p_assigned_on: payload.assigned_on,
      p_due_at: payload.due_at,
      p_estimated_minutes: payload.estimated_minutes || null,
      p_term_id: payload.term_id || null,
      p_reason: payload.reason ? payload.reason.trim() : null,
    });

    if (error) {
      if (error.code === '42501') {
        throw new TeacherHomeworkError(error.message || 'Accès non autorisé.', '42501');
      }
      throw new TeacherHomeworkError(error.message || 'Erreur lors de la modification du devoir.', error.code);
    }

    return !!data;
  } catch (err: any) {
    if (err instanceof TeacherHomeworkError) throw err;
    throw new TeacherHomeworkError(`Erreur lors de la modification du devoir : ${err?.message || 'Erreur inconnue'}`);
  }
}

/**
 * Publie un devoir au statut draft.
 */
export async function publishTeacherHomework(homeworkId: string): Promise<boolean> {
  try {
    if (!homeworkId) throw new TeacherHomeworkError('Identifiant du devoir manquant.');

    const { data, error } = await supabase.rpc('publish_teacher_homework', {
      p_homework_id: homeworkId,
    });

    if (error) {
      if (error.code === '42501') {
        throw new TeacherHomeworkError(error.message || 'Accès non autorisé pour publier ce devoir.', '42501');
      }
      throw new TeacherHomeworkError(error.message || 'Erreur lors de la publication du devoir.', error.code);
    }

    return !!data;
  } catch (err: any) {
    if (err instanceof TeacherHomeworkError) throw err;
    throw new TeacherHomeworkError(`Erreur lors de la publication du devoir : ${err?.message || 'Erreur inconnue'}`);
  }
}

/**
 * Annule un devoir avec un motif obligatoire.
 */
export async function cancelTeacherHomework(
  homeworkId: string,
  reason: string
): Promise<boolean> {
  try {
    if (!homeworkId) throw new TeacherHomeworkError('Identifiant du devoir manquant.');
    if (!reason || !reason.trim()) {
      throw new TeacherHomeworkError('Un motif explicite est obligatoire pour annuler un devoir.');
    }

    const { data, error } = await supabase.rpc('cancel_teacher_homework', {
      p_homework_id: homeworkId,
      p_reason: reason.trim(),
    });

    if (error) {
      if (error.code === '42501') {
        throw new TeacherHomeworkError(error.message || 'Accès non autorisé pour annuler ce devoir.', '42501');
      }
      throw new TeacherHomeworkError(error.message || 'Erreur lors de l’annulation du devoir.', error.code);
    }

    return !!data;
  } catch (err: any) {
    if (err instanceof TeacherHomeworkError) throw err;
    throw new TeacherHomeworkError(`Erreur lors de l’annulation du devoir : ${err?.message || 'Erreur inconnue'}`);
  }
}

/**
 * Clôture un devoir au statut published.
 */
export async function closeTeacherHomework(homeworkId: string): Promise<boolean> {
  try {
    if (!homeworkId) throw new TeacherHomeworkError('Identifiant du devoir manquant.');

    const { data, error } = await supabase.rpc('close_teacher_homework', {
      p_homework_id: homeworkId,
    });

    if (error) {
      if (error.code === '42501') {
        throw new TeacherHomeworkError(error.message || 'Accès non autorisé pour clôturer ce devoir.', '42501');
      }
      throw new TeacherHomeworkError(error.message || 'Erreur lors de la clôture du devoir.', error.code);
    }

    return !!data;
  } catch (err: any) {
    if (err instanceof TeacherHomeworkError) throw err;
    throw new TeacherHomeworkError(`Erreur lors de la clôture du devoir : ${err?.message || 'Erreur inconnue'}`);
  }
}

export interface AuthorizedSubject {
  subject_id: string;
  subject_name: string;
  subject_code: string | null;
  pedagogical_mode: 'primary_homeroom' | 'secondary_subjects';
}

/**
 * Récupère les matières autorisées pour une classe donnée selon le mode pédagogique (Primaire ou Secondaire).
 */
export async function fetchTeacherAuthorizedSubjects(classId: string): Promise<AuthorizedSubject[]> {
  try {
    if (!classId) return [];

    const { data, error } = await supabase.rpc('get_teacher_authorized_subjects', {
      p_class_id: classId,
    });

    if (error) {
      if (error.code === '42501') {
        throw new TeacherHomeworkError(error.message || 'Accès non autorisé aux matières de cette classe.', '42501');
      }
      throw new TeacherHomeworkError(`Erreur RPC get_teacher_authorized_subjects : ${error.message}`, error.code);
    }

    if (!data || !Array.isArray(data)) {
      return [];
    }

    return data.map((item: any) => ({
      subject_id: String(item.subject_id || ''),
      subject_name: String(item.subject_name || ''),
      subject_code: item.subject_code ? String(item.subject_code) : null,
      pedagogical_mode: (item.pedagogical_mode as AuthorizedSubject['pedagogical_mode']) || 'secondary_subjects',
    }));
  } catch (err: any) {
    if (err instanceof TeacherHomeworkError) throw err;
    throw new TeacherHomeworkError(`Impossible de charger les matières autorisées : ${err?.message || 'Erreur inconnue'}`);
  }
}
