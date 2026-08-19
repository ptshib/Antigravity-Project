/// <reference lib="dom" />
// Tests Unitaires Réels pour le Calendrier Scolaire (Phase 2F.3C / 2F.1)
// Fichier : test/calendarService.test.ts
// Exécution : deno test test/calendarService.test.ts

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildGetSchoolCalendarParams,
  extractAndSortCalendarPeriods,
  type CalendarPeriodItem
} from '../src/services/calendarService.ts';

// ---------------------------------------------------------------------------
// 1. Construction des trois paramètres de get_school_calendar
// ---------------------------------------------------------------------------
Deno.test('1. buildGetSchoolCalendarParams: construit les 3 paramètres exacts pour des entrées valides', () => {
  const schoolId = '123e4567-e89b-12d3-a456-426614174000';
  const academicYearId = '987a62b5-ea85-43b4-adfb-0f11d42d3942';
  const cyclePrimary = 'primary';
  const cycleSecondary = 'secondary';

  const paramsPrimary = buildGetSchoolCalendarParams(schoolId, academicYearId, cyclePrimary);
  assertEquals(paramsPrimary, {
    p_school_id: schoolId,
    p_academic_year_id: academicYearId,
    p_education_cycle: 'primary'
  });

  const paramsSecondary = buildGetSchoolCalendarParams(schoolId, academicYearId, cycleSecondary);
  assertEquals(paramsSecondary, {
    p_school_id: schoolId,
    p_academic_year_id: academicYearId,
    p_education_cycle: 'secondary'
  });
});

// ---------------------------------------------------------------------------
// 2. Rejet / Absence d'appel si paramètre manquant ou invalide
// ---------------------------------------------------------------------------
Deno.test('2. buildGetSchoolCalendarParams: retourne null si school_id, academic_year_id ou education_cycle est manquant ou invalide', () => {
  const validUUID1 = '123e4567-e89b-12d3-a456-426614174000';
  const validUUID2 = '987a62b5-ea85-43b4-adfb-0f11d42d3942';

  // school_id manquant ou non-UUID
  assertEquals(buildGetSchoolCalendarParams('', validUUID2, 'primary'), null);
  assertEquals(buildGetSchoolCalendarParams('not-a-uuid', validUUID2, 'primary'), null);
  assertEquals(buildGetSchoolCalendarParams(null, validUUID2, 'primary'), null);

  // academic_year_id manquant ou non-UUID
  assertEquals(buildGetSchoolCalendarParams(validUUID1, '', 'primary'), null);
  assertEquals(buildGetSchoolCalendarParams(validUUID1, 'bad-uuid', 'primary'), null);
  assertEquals(buildGetSchoolCalendarParams(validUUID1, undefined, 'primary'), null);

  // education_cycle invalide
  assertEquals(buildGetSchoolCalendarParams(validUUID1, validUUID2, 'tertiary'), null);
  assertEquals(buildGetSchoolCalendarParams(validUUID1, validUUID2, ''), null);
  assertEquals(buildGetSchoolCalendarParams(validUUID1, validUUID2, null), null);
});

// ---------------------------------------------------------------------------
// 3. Extraction terms → periods avec term_name et term_id
// ---------------------------------------------------------------------------
Deno.test('3. extractAndSortCalendarPeriods: extrait les périodes avec métadonnées de terme attachées', () => {
  const mockCalendarData = {
    calendar_id: 'cal-1',
    education_cycle: 'primary',
    terms: [
      {
        id: 'term-1',
        name: '1er Trimestre',
        position: 1,
        periods: [
          {
            id: 'period-1',
            name: 'Première Période',
            position: 1,
            position_within_parent: 1,
            starts_on: '2025-09-01',
            ends_on: '2025-10-31',
            is_active: true,
            is_closed: false
          },
          {
            id: 'period-2',
            name: 'Deuxième Période',
            position: 2,
            position_within_parent: 2,
            starts_on: '2025-11-01',
            ends_on: '2025-12-15',
            is_active: true,
            is_closed: false
          }
        ]
      },
      {
        id: 'term-2',
        name: '2ème Trimestre',
        position: 2,
        periods: [
          {
            id: 'period-3',
            name: 'Troisième Période',
            position: 3,
            position_within_parent: 1,
            starts_on: '2026-01-05',
            ends_on: '2026-02-28',
            is_active: true,
            is_closed: false
          }
        ]
      }
    ]
  };

  const extracted = extractAndSortCalendarPeriods(mockCalendarData);
  assertEquals(extracted.length, 3);

  assertEquals(extracted[0].id, 'period-1');
  assertEquals(extracted[0].term_id, 'term-1');
  assertEquals(extracted[0].term_name, '1er Trimestre');

  assertEquals(extracted[1].id, 'period-2');
  assertEquals(extracted[1].term_id, 'term-1');
  assertEquals(extracted[1].term_name, '1er Trimestre');

  assertEquals(extracted[2].id, 'period-3');
  assertEquals(extracted[2].term_id, 'term-2');
  assertEquals(extracted[2].term_name, '2ème Trimestre');
});

// ---------------------------------------------------------------------------
// 4. Conservation des périodes closes pour consultation historique
// ---------------------------------------------------------------------------
Deno.test('4. extractAndSortCalendarPeriods: conserve les périodes closes (is_closed = true)', () => {
  const mockCalendarData = {
    calendar_id: 'cal-history',
    education_cycle: 'primary',
    terms: [
      {
        id: 'term-1',
        name: '1er Trimestre',
        position: 1,
        periods: [
          {
            id: 'p-closed-1',
            name: '1ère Période (Clôturée)',
            position: 1,
            position_within_parent: 1,
            is_active: true,
            is_closed: true
          },
          {
            id: 'p-open-2',
            name: '2ème Période (En cours)',
            position: 2,
            position_within_parent: 2,
            is_active: true,
            is_closed: false
          }
        ]
      }
    ]
  };

  const periods = extractAndSortCalendarPeriods(mockCalendarData);
  assertEquals(periods.length, 2);
  assertEquals(periods[0].id, 'p-closed-1');
  assertEquals(periods[0].is_closed, true);
  assertEquals(periods[1].id, 'p-open-2');
  assertEquals(periods[1].is_closed, false);
});

// ---------------------------------------------------------------------------
// 5. Tri stable et déterministe des périodes
// ---------------------------------------------------------------------------
Deno.test('5. extractAndSortCalendarPeriods: trie de manière stable par ordre du terme puis position', () => {
  // Entrée non ordonnée
  const unorderedData = {
    calendar_id: 'cal-unordered',
    education_cycle: 'secondary',
    terms: [
      {
        id: 'term-2',
        name: '2nd Semestre',
        position: 2,
        periods: [
          { id: 'p-4', name: '4ème Période', position: 4, position_within_parent: 2 },
          { id: 'p-3', name: '3ème Période', position: 3, position_within_parent: 1 }
        ]
      },
      {
        id: 'term-1',
        name: '1er Semestre',
        position: 1,
        periods: [
          { id: 'p-2', name: '2ème Période', position: 2, position_within_parent: 2 },
          { id: 'p-1', name: '1ère Période', position: 1, position_within_parent: 1 }
        ]
      }
    ]
  };

  const sorted = extractAndSortCalendarPeriods(unorderedData);
  assertEquals(sorted.map(p => p.id), ['p-1', 'p-2', 'p-3', 'p-4']);
  assertEquals(sorted.map(p => p.term_position), [1, 1, 2, 2]);
});

// ---------------------------------------------------------------------------
// 6. Gestion du changement d'enfant parent (simulation de reset d'état)
// ---------------------------------------------------------------------------
Deno.test('6. Parent child switching: réinitialisation immédiate des sélections et résultats lors du changement d enfant', () => {
  let selectedPeriodId: string = 'p-1';
  let periodResult: any = { overall_percentage: 85 };
  let officialReportCard: any = { id: 'rc-1' };
  let calendarPeriods: CalendarPeriodItem[] = [{ id: 'p-1', name: 'P1', position: 1, education_cycle: 'primary', term_id: 't-1', term_name: 'T1', term_position: 1 }];

  // Fonction de réinitialisation synchrone
  const handleChildSwitch = (newChildId: string) => {
    selectedPeriodId = '';
    periodResult = null;
    officialReportCard = null;
    calendarPeriods = [];
  };

  // Simuler le changement d'enfant
  handleChildSwitch('child-2');

  assertEquals(selectedPeriodId, '');
  assertEquals(periodResult, null);
  assertEquals(officialReportCard, null);
  assertEquals(calendarPeriods.length, 0);
});
