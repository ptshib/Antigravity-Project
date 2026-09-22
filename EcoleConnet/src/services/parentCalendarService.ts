import { supabase } from '../lib/supabase';

export type SchoolEventType = 'academic' | 'sports' | 'meeting' | 'holiday' | 'event';

export interface ParentSchoolEvent {
  id: string;
  title: string;
  description: string;
  event_type: SchoolEventType;
  start_date: string;
  end_date: string;
  is_all_day: boolean;
  location: string;
  status: string;
  created_at: string;
}

export interface ParentCalendarSummary {
  total_events: number;
}

export interface ParentCalendarData {
  student_id: string;
  student_number: string;
  student_name: string;
  class_id: string;
  class_name: string;
  academic_year_id: string | null;
  academic_year_name: string;
  summary: ParentCalendarSummary;
  events: ParentSchoolEvent[];
}

/**
 * Service sécurisé de consultation du calendrier scolaire pour le portail Parent.
 * Fait appel à la RPC SECURITY DEFINER `get_parent_student_calendar`.
 * Ne fait jamais confiance au frontend pour la résolution de l'école.
 */
export async function fetchParentStudentCalendar(studentId: string): Promise<ParentCalendarData> {
  if (!studentId) {
    throw new Error('Identifiant élève requis pour consulter le calendrier scolaire.');
  }

  const { data, error } = await supabase.rpc('get_parent_student_calendar', {
    p_student_id: studentId,
  });

  if (error) {
    console.error('[parentCalendarService] Erreur lors de la récupération du calendrier:', error);
    throw new Error(error.message || 'Impossible de charger le calendrier scolaire.');
  }

  if (!data) {
    throw new Error('Aucune donnée de calendrier retournée par le serveur.');
  }

  return data as ParentCalendarData;
}
