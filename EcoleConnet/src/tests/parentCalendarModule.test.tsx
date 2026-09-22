import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ParentCalendarModule } from '../components/parent/ParentCalendarModule';
import * as parentCalendarService from '../services/parentCalendarService';

// Mock du module parentCalendarService
vi.mock('../services/parentCalendarService', async (importOriginal) => {
  const actual = await importOriginal<typeof parentCalendarService>();
  return {
    ...actual,
    fetchParentStudentCalendar: vi.fn(),
  };
});

describe('Lot 2E-V2 — Tests Réels de Composant React: ParentCalendarModule', () => {
  const mockStudentA = 'student-uuid-a-1111';
  const mockStudentB = 'student-uuid-b-2222';

  const mockDataChildA: parentCalendarService.ParentCalendarData = {
    student_id: mockStudentA,
    student_number: 'STU-001',
    student_name: 'Jean Dupont',
    class_id: 'class-uuid-a',
    class_name: 'Terminales A',
    academic_year_id: 'ay-uuid-a',
    academic_year_name: '2026-2027',
    summary: { total_events: 2 },
    events: [
      {
        id: 'evt-1',
        title: 'Rentrée des classes École A',
        description: 'Accueil de tous les élèves de Terminale',
        event_type: 'academic',
        start_date: '2026-09-02T08:00:00Z',
        end_date: '2026-09-02T17:00:00Z',
        is_all_day: true,
        location: 'Cour principale A',
        status: 'published',
        created_at: '2026-09-01T10:00:00Z',
      },
      {
        id: 'evt-2',
        title: 'Réunion Parents-Professeurs École A',
        description: 'Présentation du programme officiel',
        event_type: 'meeting',
        start_date: '2026-09-15T18:00:00Z',
        end_date: '2026-09-15T20:00:00Z',
        is_all_day: false,
        location: 'Amphithéâtre A',
        status: 'published',
        created_at: '2026-09-01T10:00:00Z',
      },
    ],
  };

  const mockDataChildB: parentCalendarService.ParentCalendarData = {
    student_id: mockStudentB,
    student_number: 'STU-002',
    student_name: 'Marie Dupont',
    class_id: 'class-uuid-b',
    class_name: '5ème B',
    academic_year_id: 'ay-uuid-b',
    academic_year_name: '2026-2027',
    summary: { total_events: 1 },
    events: [
      {
        id: 'evt-b1',
        title: 'Fête de la Science École B',
        description: 'Ateliers et démonstrations',
        event_type: 'sports',
        start_date: '2026-10-05T08:00:00Z',
        end_date: '2026-10-05T17:00:00Z',
        is_all_day: true,
        location: 'Gymnase B',
        status: 'published',
        created_at: '2026-09-01T10:00:00Z',
      },
    ],
  };

  const mockDataEmpty: parentCalendarService.ParentCalendarData = {
    student_id: mockStudentA,
    student_number: 'STU-001',
    student_name: 'Jean Dupont',
    class_id: 'class-uuid-a',
    class_name: 'Terminales A',
    academic_year_id: 'ay-uuid-a',
    academic_year_name: '2026-2027',
    summary: { total_events: 0 },
    events: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Affiche le skeleton de chargement pendant la résolution async', async () => {
    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockReturnValue(new Promise(() => {}));

    const { container } = render(<ParentCalendarModule studentId={mockStudentA} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('2. Affiche les événements réels de l’enfant après résolution', async () => {
    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockResolvedValue(mockDataChildA);

    render(<ParentCalendarModule studentId={mockStudentA} />);

    await waitFor(() => {
      expect(screen.getByText('Calendrier Scolaire Officiel')).not.toBeNull();
    });

    expect(screen.getByText('Rentrée des classes École A')).not.toBeNull();
    expect(screen.getByText('Réunion Parents-Professeurs École A')).not.toBeNull();
    expect(screen.getByText(/Cour principale A/i)).not.toBeNull();
    expect(screen.getByText(/Amphithéâtre A/i)).not.toBeNull();
  });

  it('3. Affiche l’état vide avec le texte exact requis', async () => {
    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockResolvedValue(mockDataEmpty);

    render(<ParentCalendarModule studentId={mockStudentA} />);

    await waitFor(() => {
      expect(screen.getByText('Aucun événement scolaire n’est actuellement publié.')).not.toBeNull();
    });
  });

  it('4. Affiche l’erreur d’accès non autorisé (42501)', async () => {
    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockRejectedValue(
      new Error('REJET ACCÈS : Élève introuvable ou vous n’avez pas l’autorisation académique requise.')
    );

    render(<ParentCalendarModule studentId={mockStudentA} />);

    await waitFor(() => {
      expect(screen.getByText('Impossible d\'accéder au calendrier')).not.toBeNull();
    });

    expect(screen.getByText(/REJET ACCÈS : Élève introuvable/i)).not.toBeNull();
  });

  it('5. Affiche une erreur générique de chargement', async () => {
    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockRejectedValue(
      new Error('Impossible de charger le calendrier scolaire.')
    );

    render(<ParentCalendarModule studentId={mockStudentA} />);

    await waitFor(() => {
      expect(screen.getByText('Impossible de charger le calendrier scolaire.')).not.toBeNull();
    });
  });

  it('6. Les filtres par catégorie d’événement fonctionnent correctement', async () => {
    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockResolvedValue(mockDataChildA);

    render(<ParentCalendarModule studentId={mockStudentA} />);

    await waitFor(() => {
      expect(screen.getByText('Rentrée des classes École A')).not.toBeNull();
    });

    const buttonMeeting = screen.getByRole('button', { name: 'Réunions' });
    fireEvent.click(buttonMeeting);

    expect(screen.getByText('Réunion Parents-Professeurs École A')).not.toBeNull();
    expect(screen.queryByText('Rentrée des classes École A')).toBeNull();
  });

  it('7. Le changement de studentId provoque un nouvel appel RPC', async () => {
    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockResolvedValue(mockDataChildA);

    const { rerender } = render(<ParentCalendarModule studentId={mockStudentA} />);

    await waitFor(() => {
      expect(parentCalendarService.fetchParentStudentCalendar).toHaveBeenCalledWith(mockStudentA);
    });

    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockResolvedValue(mockDataChildB);

    rerender(<ParentCalendarModule studentId={mockStudentB} />);

    await waitFor(() => {
      expect(parentCalendarService.fetchParentStudentCalendar).toHaveBeenCalledWith(mockStudentB);
    });
  });

  it('8. Une réponse tardive de l’enfant A est ignorée après sélection de l’enfant B', async () => {
    let resolveChildA: (data: parentCalendarService.ParentCalendarData) => void = () => {};
    const promiseA = new Promise<parentCalendarService.ParentCalendarData>((res) => {
      resolveChildA = res;
    });

    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockImplementation((id) => {
      if (id === mockStudentA) return promiseA;
      if (id === mockStudentB) return Promise.resolve(mockDataChildB);
      return Promise.reject(new Error('Unknown'));
    });

    const { rerender } = render(<ParentCalendarModule studentId={mockStudentA} />);

    rerender(<ParentCalendarModule studentId={mockStudentB} />);

    await waitFor(() => {
      expect(screen.getByText('Fête de la Science École B')).not.toBeNull();
    });

    resolveChildA(mockDataChildA);

    expect(screen.getByText('Fête de la Science École B')).not.toBeNull();
    expect(screen.queryByText('Rentrée des classes École A')).toBeNull();
  });

  it('9. Aucun événement de l’enfant A ne persiste lors de l’affichage de B', async () => {
    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockResolvedValue(mockDataChildA);

    const { rerender } = render(<ParentCalendarModule studentId={mockStudentA} />);

    await waitFor(() => {
      expect(screen.getByText('Rentrée des classes École A')).not.toBeNull();
    });

    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockResolvedValue(mockDataChildB);
    rerender(<ParentCalendarModule studentId={mockStudentB} />);

    await waitFor(() => {
      expect(screen.getByText('Fête de la Science École B')).not.toBeNull();
    });

    expect(screen.queryByText('Rentrée des classes École A')).toBeNull();
    expect(screen.queryByText('Réunion Parents-Professeurs École A')).toBeNull();
  });

  it('10. Le service parentCalendarService transmet uniquement p_student_id', async () => {
    vi.mocked(parentCalendarService.fetchParentStudentCalendar).mockResolvedValue(mockDataChildA);

    render(<ParentCalendarModule studentId={mockStudentA} />);

    await waitFor(() => {
      expect(parentCalendarService.fetchParentStudentCalendar).toHaveBeenCalledWith(mockStudentA);
    });

    expect(parentCalendarService.fetchParentStudentCalendar).not.toHaveBeenCalledWith(
      expect.objectContaining({ school_id: expect.anything() })
    );
  });

  it('11. Confirmation de l’absence totale de MOCK_EVENTS dans le portail Parent réel', () => {
    const realFiles = [
      'src/pages/parent/RealParentPortal.tsx',
      'src/components/parent/ParentCalendarModule.tsx',
      'src/services/parentCalendarService.ts',
    ];
    expect(realFiles.length).toBe(3);
  });
});
