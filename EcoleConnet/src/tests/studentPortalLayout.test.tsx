import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealStudentPortal } from '../pages/student/RealStudentPortal';

const mockSignOutReal = vi.fn();
const mockShowToast = vi.fn();
const mockDownloadReportCardPdfBlob = vi.fn().mockResolvedValue(true);

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
    },
    {
      id: 'period-p2-id',
      name: '2ème Trimestre',
      parent_term_name: '1er Semestre',
      starts_on: '2026-11-16',
      ends_on: '2027-01-31'
    }
  ])
}));

vi.mock('../lib/supabase', () => {
  return {
    supabase: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'student-profile-uid-1' } } })
      },
      from: (tableName: string) => {
        if (tableName === 'students') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: {
                    id: 'std-real-id-123',
                    school_id: 'school-uuid-2026',
                    student_number: 'MAT-2026-001',
                    first_name: 'Jean-Luc',
                    last_name: 'Mbuyi',
                    enrollment_status: 'active'
                  },
                  error: null
                })
              })
            })
          };
        }
        if (tableName === 'student_enrollments') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({
                    data: {
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
                        name: '2026–2027'
                      }
                    },
                    error: null
                  })
                })
              })
            })
          };
        }
        if (tableName === 'period_report_cards') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({
                      data: {
                        id: 'rc-1',
                        rank: 1,
                        overall_percentage: 82.5,
                        pdf_storage_path: 'report_cards/2026/rc_1.pdf',
                        pdf_version: 1,
                        pdf_generated_at: '2026-09-20',
                        pdf_checksum: 'abc123sha'
                      },
                      error: null
                    })
                  })
                })
              })
            })
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null })
            })
          })
        };
      },
      rpc: (rpcName: string) => {
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
              subjects_count: 2,
              completed_subjects_count: 2,
              pending_subjects_count: 0,
              total_subject_coefficients: 5,
              overall_percentage: 82.5,
              is_complete: true,
              subjects: [
                {
                  subject_id: 'sub-math-1',
                  subject_name: 'Mathématiques',
                  subject_coefficient: 3,
                  subject_percentage: 85,
                  is_complete: true,
                  assessment_count: 2,
                  completed_assessment_count: 2,
                  pending_assessment_count: 0
                },
                {
                  subject_id: 'sub-fr-1',
                  subject_name: 'Français',
                  subject_coefficient: 2,
                  subject_percentage: 78,
                  is_complete: true,
                  assessment_count: 2,
                  completed_assessment_count: 2,
                  pending_assessment_count: 0
                }
              ]
            }],
            error: null
          });
        }
        if (rpcName === 'get_student_subject_period_result') {
          return Promise.resolve({
            data: [{
              assessments: [
                {
                  assessment_id: 'asmt-1',
                  title: 'Interrogation N°1',
                  assessment_date: '2026-09-10',
                  coefficient: 1,
                  score: 18,
                  max_score: 20,
                  normalized_percentage: 90,
                  is_absent: false
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

describe('RealStudentPortal — Lot 2K-T5 (Validation Visuelle & Sécurité Élève)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Affiche l’identité réelle de l’élève, le matricule et la classe', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Notes scolaires')).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Jean-Luc/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MAT-2026-001/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/7ème EB A/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Complexe Scolaire Excellence/i).length).toBeGreaterThan(0);
  });

  it('2. Absence totale de la mention (Mock) ou de données démo', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Notes scolaires')).toBeInTheDocument();
    });

    expect(screen.queryByText(/\(Mock\)/i)).toBeNull();
    expect(screen.queryByText(/Démo/i)).toBeNull();
  });

  it('3. Charge et permet le changement de période scolaire', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Période Scolaire/i)).toBeInTheDocument();
    });

    const periodSelect = screen.getByLabelText(/Période Scolaire/i) as HTMLSelectElement;
    expect(periodSelect.value).toBe('period-p1-id');

    fireEvent.change(periodSelect, { target: { value: 'period-p2-id' } });
    expect(periodSelect.value).toBe('period-p2-id');
  });

  it('4. Affiche le pourcentage général réel et les matières avec coefficients', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('82.5 %')).toBeInTheDocument();
    });

    expect(screen.getByText('Mathématiques')).toBeInTheDocument();
    expect(screen.getByText('Français')).toBeInTheDocument();
    expect(screen.getByText('85 %')).toBeInTheDocument();
    expect(screen.getByText('78 %')).toBeInTheDocument();
    expect(screen.getByText('Résultats Complets')).toBeInTheDocument();
  });

  it('5. Affiche le bandeau de bulletin certifié et déclenche le téléchargement PDF', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText(/Bulletin Officiel Certifié Disponible/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Signé & Scellé')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();

    const pdfBtn = screen.getByRole('button', { name: /Télécharger le Bulletin \(PDF\)/i });
    fireEvent.click(pdfBtn);

    await waitFor(() => {
      expect(mockDownloadReportCardPdfBlob).toHaveBeenCalled();
    });
  });

  it('6. Ouvre la modale de détail des notes au clic sur "Voir Notes"', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Mathématiques')).toBeInTheDocument();
    });

    const voirNotesBtns = screen.getAllByRole('button', { name: /Voir Notes/i });
    fireEvent.click(voirNotesBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Vos Évaluations : Mathématiques/i)).toBeInTheDocument();
      expect(screen.getByText('Interrogation N°1')).toBeInTheDocument();
      expect(screen.getByText(/18/i)).toBeInTheDocument();
    });
  });

  it('7. Fonctionnement du drawer mobile et touche Escape', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ouvrir le menu/i })).toBeInTheDocument();
    });

    const menuBtn = screen.getByRole('button', { name: /Ouvrir le menu/i });
    fireEvent.click(menuBtn);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Fermer le menu/i }).length).toBeGreaterThan(0);
    });

    // Test Escape key close
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Fermer le menu/i }).length).toBe(1);
    });
  });

  it('8. Déclenche la déconnexion au clic sur le bouton Déconnexion', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Notes scolaires')).toBeInTheDocument();
    });

    const signOutBtns = screen.getAllByRole('button', { name: /Déconnexion/i });
    fireEvent.click(signOutBtns[0]);

    expect(mockSignOutReal).toHaveBeenCalled();
  });

  it('9. Formate correctement la période selon la présence ou l’absence du semestre (undefined, null, vide, valide)', async () => {
    const { extractAndSortCalendarPeriods } = await import('../services/calendarService');
    const mockExtract = vi.mocked(extractAndSortCalendarPeriods);

    // Scenario A: parent_term_name est une valeur valide
    mockExtract.mockReturnValueOnce([
      { id: 'p-valide', name: '1re Période', parent_term_name: '1er Semestre' } as any
    ]);
    const { unmount: unmountA } = render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText(/Période active : 1re Période \(1er Semestre\)/i)).toBeInTheDocument();
    });
    unmountA();

    // Scenario B: parent_term_name est undefined
    mockExtract.mockReturnValueOnce([
      { id: 'p-undef', name: '1re Période', parent_term_name: undefined } as any
    ]);
    const { unmount: unmountB } = render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText(/Période active : 1re Période/i)).toBeInTheDocument();
      expect(screen.queryByText(/Période active : 1re Période \(/i)).toBeNull();
    });
    unmountB();

    // Scenario C: parent_term_name est null
    mockExtract.mockReturnValueOnce([
      { id: 'p-null', name: '1re Période', parent_term_name: null } as any
    ]);
    const { unmount: unmountC } = render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText(/Période active : 1re Période/i)).toBeInTheDocument();
      expect(screen.queryByText(/Période active : 1re Période \(/i)).toBeNull();
    });
    unmountC();

    // Scenario D: parent_term_name est une chaîne vide ou d’espaces
    mockExtract.mockReturnValueOnce([
      { id: 'p-empty', name: '1re Période', parent_term_name: '   ' } as any
    ]);
    const { unmount: unmountD } = render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText(/Période active : 1re Période/i)).toBeInTheDocument();
      expect(screen.queryByText(/Période active : 1re Période \(/i)).toBeNull();
    });
    unmountD();
  });

  it('10. Affiche et permet la navigation vers la troisième rubrique Devoirs & Cahier de texte', async () => {
    render(<RealStudentPortal />);

    await waitFor(() => {
      expect(screen.getByText('Résultats & Notes scolaires')).toBeInTheDocument();
    });

    const devoirsBtn = screen.getByRole('button', { name: /Devoirs & Cahier de texte/i });
    expect(devoirsBtn).toBeInTheDocument();

    fireEvent.click(devoirsBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Devoirs & Cahier de texte/i })).toBeInTheDocument();
    });
  });
});
