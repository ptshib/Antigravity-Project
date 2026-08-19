/// <reference lib="dom" />
// Service Frontend & Utilitaires pour le Calendrier Scolaire Officiel (Phase 2F.3C / 2F.1)
// Fichier : src/services/calendarService.ts

import { isValidUUID } from './reportCardPdfService.ts';

export interface CalendarPeriodItem {
  id: string;
  name: string;
  position: number;
  position_within_parent?: number;
  education_cycle: string;
  starts_on?: string | null;
  ends_on?: string | null;
  is_active?: boolean;
  is_closed?: boolean;
  term_id: string;
  term_name: string;
  term_position: number;
}

export interface GetSchoolCalendarParams {
  p_school_id: string;
  p_academic_year_id: string;
  p_education_cycle: string;
}

/**
 * Valide et construit de manière stricte les paramètres requis pour la RPC get_school_calendar.
 * Retourne null si l'un des paramètres obligatoires est manquant ou invalide.
 */
export function buildGetSchoolCalendarParams(
  schoolId?: string | null,
  academicYearId?: string | null,
  educationCycle?: string | null
): GetSchoolCalendarParams | null {
  if (!isValidUUID(schoolId)) return null;
  if (!isValidUUID(academicYearId)) return null;
  if (!educationCycle || (educationCycle !== 'primary' && educationCycle !== 'secondary')) {
    return null;
  }

  return {
    p_school_id: schoolId!.trim(),
    p_academic_year_id: academicYearId!.trim(),
    p_education_cycle: educationCycle.trim()
  };
}

/**
 * Extrait la liste plate des périodes depuis la structure hiérarchique terms[].periods[].
 * - Attache `term_name`, `term_id`, `term_position` à chaque période ;
 * - Conserve les périodes closes (is_closed = true) pour permettre la consultation historique des bulletins ;
 * - Applique un tri stable :
 *   1. Ordre du terme (term_position)
 *   2. Position au sein du terme (position_within_parent ou position)
 *   3. Identifiant unique (id) en dernier recours pour garantir un déterminisme absolu.
 */
export function extractAndSortCalendarPeriods(calendarData?: any): CalendarPeriodItem[] {
  if (!calendarData || !Array.isArray(calendarData.terms)) {
    return [];
  }

  const periods: CalendarPeriodItem[] = [];

  calendarData.terms.forEach((term: any, termIdx: number) => {
    if (!term || !Array.isArray(term.periods)) return;

    const termPos = typeof term.position === 'number' ? term.position : termIdx + 1;
    const termName = term.name || `Terme ${termPos}`;
    const termId = term.id || `term-${termPos}`;

    term.periods.forEach((p: any, periodIdx: number) => {
      if (!p || !p.id) return;

      const pPos = typeof p.position === 'number'
        ? p.position
        : (typeof p.position_within_parent === 'number' ? p.position_within_parent : periodIdx + 1);

      periods.push({
        id: p.id,
        name: p.name || `Période ${pPos}`,
        position: pPos,
        position_within_parent: p.position_within_parent ?? pPos,
        education_cycle: p.education_cycle || calendarData.education_cycle || 'primary',
        starts_on: p.starts_on ?? null,
        ends_on: p.ends_on ?? null,
        is_active: p.is_active !== false,
        is_closed: Boolean(p.is_closed),
        term_id: termId,
        term_name: termName,
        term_position: termPos
      });
    });
  });

  // Tri stable et déterministe
  return periods.sort((a, b) => {
    if (a.term_position !== b.term_position) {
      return a.term_position - b.term_position;
    }
    const posA = a.position_within_parent ?? a.position;
    const posB = b.position_within_parent ?? b.position;
    if (posA !== posB) {
      return posA - posB;
    }
    return a.id.localeCompare(b.id);
  });
}
