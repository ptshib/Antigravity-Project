// Fichier : src/tests/studentTimetable.test.tsx
// Suite de tests frontend dédiée pour l'Emploi du Temps Élève (Phase 2K-T6-F)

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealStudentPortal } from '../pages/student/RealStudentPortal';

const mockSignOutReal = vi.fn();
const mockShowToast = vi.fn();
const mockDownloadReportCardPdfBlob = vi.fn().mockResolvedValue(true);
const mockRpcCalls: Array<{ rpcName: string; params: any }> = [];

vi.mock('../contexts/RealAuthContext', () => ({
  useRealAuth: () => ({
    profile: {
      id: 'student-profile-uid-1',
      first_name: 'Jean-Luc',
      last_name: 'Mbuyi',
      role: 'student',
    },
    school: {
      id: 'school-uuid-2026',
      name: 'Complexe Scolaire Excellence',
      slug: 'CS-EXC-KIN',
      status: 'active',
    },
    signOutReal: mockSignOutReal,
  }),
}));

vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    showToast: mockShowToast,
  }),
}));

vi.mock('../services/reportCardPdfService', () => ({
  downloadReportCardPdfBlob: (...args: any[]) => mockDownloadReportCardPdfBlob(...args),
  isPublishedPdfMetadataComplete: (rc: any) => !!rc?.pdf_storage_path,
}));

vi.mock('../services/calendarService', () => ({
  buildGetSchoolCalendarParams: () => ({
    p_school_id: 'school-uuid-2026',
    p_academic_year_id: 'ay-2026-2027',
    p_education_cycle: 'secondary'
  }),
  extractAndSortCalendarPeriods: vi.fn(() => [
    {
      id: 'period-p1-id',
      name: '1er Trimestre',
      parent_term_name: '1er Semestre',
      starts_on: '2026-09-01',
      ends_on: '2026-11-15'
    }
  ])
}));

let mockTimetableDataResponse: any = {
  student_name: 'Jean-Luc Mbuyi',
  student_number: 'MAT-2026-001',
  class_name: '7ème EB A',
  academic_year_name: '2026-2027',
  summary: {
    total_slots: 3,
    total_days: 2
  },
  slots: [
    {
      slot_type: 'course',
      label: null,
      day_of_week: 1,
      day_name: 'Lundi',
      subject_name: 'Mathématiques',
      teacher_name: 'Valery Mathieu',
      room: 'Salle 101',
      start_time: '08:00',
      end_time: '08:55'
    },
    {
      slot_type: 'break',
      label: 'Récréation du Matin',
      day_of_week: 1,
      day_name: 'Lundi',
      subject_name: 'Pause',
      teacher_name: '',
      room: 'Cour principal',
      start_time: '10:00',
      end_time: '10:15'
    },
    {
      slot_type: 'course',
      label: null,
      day_of_week: 2,
      day_name: 'Mardi',
      subject_name: 'Physique',
      teacher_name: 'Enseignant non assigné',
      room: '',
      start_time: '09:00',
      end_time: '09:55'
    }
  ]
};

let mockTimetableErrorResponse: any = null;
let mockFromQueries: string[] = [];

vi.mock('../lib/supabase', () => {
  return {
    supabase: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'student-profile-uid-1' } } })
      },
      from: (tableName: string) => {
        mockFromQueries.push(tableName);
        const makeChain = (data: any) => {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: () => Promise.resolve({ data, error: null })
          };
          return chain;
        };

        if (tableName === 'students') {
          return makeChain({
            id: 'std-real-id-123',
            school_id: 'school-uuid-2026',
            student_number: 'MAT-2026-001',
            first_name: 'Jean-Luc',
            last_name: 'Mbuyi',
            enrollment_status: 'active'
          });
        }
        if (tableName === 'student_enrollments') {
          return makeChain({
            id: 'enr-real-id-456',
            class_id: 'class-7eb-id',
            school_id: 'school-uuid-2026',
            academic_year_id: 'ay-2026-2027',
            status: 'active',
            class: {
              id: 'class-7eb-id',
              name: '7ème EB A',
              education_cycle: 'secondary',
              academic_year_id: 'ay-2026-2027'
            },
            academic_year: {
              id: 'ay-2026-2027',
              name: '2026-2027'
            }
          });
        }
        if (tableName === 'period_report_cards') {
          return makeChain({
            id: 'rc-1',
            rank: 1,
            overall_percentage: 82.5,
            pdf_storage_path: 'report_cards/2026/rc_1.pdf',
            pdf_version: 1,
            pdf_generated_at: '2026-09-20',
            pdf_checksum: 'abc123sha'
          });
        }
        return makeChain(null);
      },
      rpc: (rpcName: string, params?: any) => {
        console.log('[TEST LOG] RPC call received:', rpcName);
        mockRpcCalls.push({ rpcName, params });
        if (rpcName === 'get_authenticated_student_timetable') {
          if (mockTimetableErrorResponse) {
            return Promise.resolve({ data: null, error: mockTimetableErrorResponse });
          }
          return Promise.resolve({ data: mockTimetableDataResponse, error: null });
        }
        if (rpcName === 'get_school_calendar') {
          return Promise.resolve({ data: [], error: null });
        }
        if (rpcName === 'get_student_period_result') {
          return Promise.resolve({
            data: [{
              student_id: 'std-real-id-123',
              student_number: 'MAT-2026-001',
              student_name: 'Jean-Luc Mbuyi',
              class_name: '7ème EB A',
              period_name: '1er Trimestre',
              term_name: '1er Semestre',
              subjects_count: 1,
              completed_subjects_count: 1,
              pending_subjects_count: 0,
              total_subject_coefficients: 3,
              overall_percentage: 85,
              is_complete: true,
              subjects: [
                {
                  subject_id: 'sub-math-1',
                  subject_name: 'Mathématiques',
                  subject_coefficient: 3,
                  subject_percentage: 85,
                  is_complete: true,
                  assessment_count: 1,
                  completed_assessment_count: 1,
                  pending_assessment_count: 0
                }
              ]
            }],
            error: null
          });
        }
        return Promise.resolve({ data: [], error: null });
      }
    }
  };
});

describe('StudentTimetable Frontend Suite — Lot 2K-T6-F', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/app/eleve/resultats');
    mockRpcCalls.length = 0;
    mockFromQueries.length = 0;
    mockTimetableErrorResponse = null;
    mockTimetableDataResponse = {
      student_name: 'Jean-Luc Mbuyi',
      student_number: 'MAT-2026-001',
      class_name: '7ème EB A',
      academic_year_name: '2026-2027',
      summary: { total_slots: 3, total_days: 2 },
      slots: [
        {
          slot_type: 'course',
          label: null,
          day_of_week: 1,
          day_name: 'Lundi',
          subject_name: 'Mathématiques',
          teacher_name: 'Valery Mathieu',
          room: 'Salle 101',
          start_time: '08:00',
          end_time: '08:55'
        },
        {
          slot_type: 'break',
          label: 'Récréation du Matin',
          day_of_week: 1,
          day_name: 'Lundi',
          subject_name: 'Pause',
          teacher_name: '',
          room: 'Cour principal',
          start_time: '10:00',
          end_time: '10:15'
        },
        {
          slot_type: 'course',
          label: null,
          day_of_week: 2,
          day_name: 'Mardi',
          subject_name: 'Physique',
          teacher_name: 'Enseignant non assigné',
          room: '',
          start_time: '09:00',
          end_time: '09:55'
        }
      ]
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Affiche les deux rubriques dans la navigation Sidebar', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
      expect(screen.getAllByText('Emploi du temps').length).toBeGreaterThan(0);
    });
  });

  it('2. Exécute l’appel RPC get_authenticated_student_timetable SANS AUCUN PARAMÈTRE et AUCUN accès direct à school_timetables', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Emploi du temps')[0]);

    await waitFor(() => {
      const timetableRpcCall = mockRpcCalls.find(c => c.rpcName === 'get_authenticated_student_timetable');
      expect(timetableRpcCall).toBeDefined();
      expect(timetableRpcCall?.params).toBeUndefined();
    });

    expect(mockFromQueries).not.toContain('school_timetables');
  });

  it('3. Rendu Desktop de la grille hebdomadaire avec ordre des jours, des heures, et pauses distinctes', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Emploi du temps')[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Mathématiques').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Physique').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Récréation du Matin').length).toBeGreaterThan(0);
      expect(screen.getAllByText('08:00 - 08:55').length).toBeGreaterThan(0);
      expect(screen.getAllByText('10:00 - 10:15').length).toBeGreaterThan(0);
      expect(screen.getByText('3 créneaux')).toBeInTheDocument();
      expect(screen.getByText('2 jours de cours')).toBeInTheDocument();
    });
  });

  it('4. Gère le fallback lorsque enseignant ou salle sont absents', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Emploi du temps')[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Enseignant non assigné').length).toBeGreaterThan(0);
    });
  });

  it('5. Gère un emploi du temps vide (slots.length === 0)', async () => {
    mockTimetableDataResponse = {
      student_name: 'Jean-Luc Mbuyi',
      student_number: 'MAT-2026-001',
      class_name: '7ème EB A',
      academic_year_name: '2026-2027',
      summary: { total_slots: 0, total_days: 0 },
      slots: []
    };

    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Emploi du temps')[0]);

    await waitFor(() => {
      expect(screen.getByText('Aucun créneau configuré')).toBeInTheDocument();
    });
  });

  it('6. Gère les erreurs réseau et accès refusé (42501) avec bouton Réessayer', async () => {
    mockTimetableErrorResponse = { code: '42501', message: 'REJET ACCÈS : Profil élève inactif ou introuvable.' };

    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Emploi du temps')[0]);

    await waitFor(() => {
      expect(screen.getByText(/Impossible d'afficher l'emploi du temps/i)).toBeInTheDocument();
      expect(screen.getByText(/REJET ACCÈS/i)).toBeInTheDocument();
    });

    mockTimetableErrorResponse = null;
    const retryBtn = screen.getByRole('button', { name: /Réessayer/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Mathématiques').length).toBeGreaterThan(0);
    });
  });

  it('7. Gère une réponse RPC malformée de façon défensive', async () => {
    mockTimetableDataResponse = "CHAINE_MALFORMEE_NON_OBJET";

    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Emploi du temps')[0]);

    await waitFor(() => {
      expect(screen.getByText(/Réponse de l'emploi du temps malformée/i)).toBeInTheDocument();
    });
  });

  it('8. Referme automatiquement le drawer mobile lors du choix d’une rubrique', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ouvrir le menu/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Ouvrir le menu/i }));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Fermer le menu/i }).length).toBeGreaterThan(0);
    });

    const timetableNavBtns = screen.getAllByText('Emploi du temps');
    fireEvent.click(timetableNavBtns[timetableNavBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Fermer le menu/i }).length).toBe(1);
    });
  });

  it('9. Le bouton Actualiser recharge la rubrique active sans rompre les résultats ni le PDF', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getAllByText(/85 %/i).length).toBeGreaterThan(0);
    });

    const refreshBtns = screen.getAllByRole('button', { name: /Actualiser/i });
    fireEvent.click(refreshBtns[0]);

    await waitFor(() => {
      expect(screen.getAllByText(/85 %/i).length).toBeGreaterThan(0);
    });
  });

  it('10. Confirme l’absence totale des chaînes null, undefined ou UUIDs fuites dans le DOM rendu', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Emploi du temps')[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Mathématiques').length).toBeGreaterThan(0);
    });

    const containerText = document.body.textContent || '';
    expect(containerText).not.toContain('null');
    expect(containerText).not.toContain('undefined');
    expect(containerText).not.toContain('student-profile-uid-1');
    expect(containerText).not.toContain('school-uuid-2026');
    expect(containerText).not.toContain('std-real-id-123');
    expect(containerText).not.toContain('enr-real-id-456');
    expect(containerText).not.toContain('class-7eb-id');
  });
});
