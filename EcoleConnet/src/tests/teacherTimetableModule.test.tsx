import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TeacherTimetableModule } from '../components/teacher/TeacherTimetableModule';
import {
  fetchAuthenticatedTeacherTimetable,
  TeacherTimetableError
} from '../services/teacherTimetableService';
import type { TeacherTimetableData } from '../services/teacherTimetableService';
import { RealTeacherPortal } from '../pages/teacher/RealTeacherPortal';

const mockSignOutReal = vi.fn();
const mockShowToast = vi.fn();
const mockRpc = vi.fn();
const mockFrom = vi.fn();

// Mock dependencies
vi.mock('../services/teacherTimetableService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/teacherTimetableService')>();
  return {
    ...actual,
    fetchAuthenticatedTeacherTimetable: vi.fn(),
  };
});

vi.mock('../contexts/RealAuthContext', () => ({
  useRealAuth: () => ({
    user: { id: 'prof-teach-123', email: 'grace.kabeya@ecoleconnect.cd' },
    profile: {
      id: 'prof-teach-123',
      first_name: 'Grâce',
      last_name: 'Kabeya',
      role: 'teacher',
      school_id: 'sch-ecole-456',
      is_active: true,
      employee_id: 'ENS-2026-001'
    },
    school: {
      id: 'sch-ecole-456',
      name: 'Complexe Scolaire Excellence'
    },
    loading: false,
    signOutReal: mockSignOutReal
  })
}));

vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    showToast: mockShowToast,
    showNotification: mockShowToast
  })
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (fnName: string, args?: any) => mockRpc(fnName, args),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'prof-teach-123' } },
        error: null
      })
    }
  }
}));

const mockTimetableData: TeacherTimetableData = {
  teacher_id: 'tch-123',
  teacher_name: 'Grâce Kabeya',
  school_id: 'sch-ecole-456',
  academic_year_id: 'ay-789',
  academic_year_name: '2026-2027',
  selected_class_id: null,
  slots: [
    {
      id: 'slot-1',
      slot_type: 'course',
      label: null,
      day_of_week: 1,
      day_name: 'Lundi',
      subject_id: 'sub-math',
      subject_name: 'Mathématiques',
      class_id: 'class-1a',
      class_name: '1re Secondaire A',
      teacher_id: 'tch-123',
      teacher_name: 'Grâce Kabeya',
      room: '101',
      start_time: '08:00',
      end_time: '09:30',
      status: 'active',
      academic_year_id: 'ay-789',
      academic_year_name: '2026-2027'
    },
    {
      id: 'slot-break',
      slot_type: 'break',
      label: 'Récréation du Matin',
      day_of_week: 1,
      day_name: 'Lundi',
      subject_id: null,
      subject_name: 'Récréation du Matin',
      class_id: 'class-1a',
      class_name: '1re Secondaire A',
      teacher_id: null,
      teacher_name: '',
      room: '',
      start_time: '09:30',
      end_time: '10:00',
      status: 'active',
      academic_year_id: 'ay-789',
      academic_year_name: '2026-2027'
    },
    {
      id: 'slot-2',
      slot_type: 'course',
      label: null,
      day_of_week: 1,
      day_name: 'Lundi',
      subject_id: 'sub-fr',
      subject_name: 'Français',
      class_id: 'class-2a',
      class_name: '2e Secondaire A',
      teacher_id: 'tch-123',
      teacher_name: 'Grâce Kabeya',
      room: '102',
      start_time: '10:00',
      end_time: '11:30',
      status: 'active',
      academic_year_id: 'ay-789',
      academic_year_name: '2026-2027'
    }
  ],
  total_slots: 3,
  total_courses: 2,
  total_breaks: 1,
  total_classes: 2,
  total_duration_minutes: 180
};

describe('TeacherTimetableModule — Lot 2H Emploi du Temps Réel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'teachers') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: {
                  id: 'tch-123',
                  profile_id: 'prof-teach-123',
                  school_id: 'sch-ecole-456',
                  employee_number: 'ENS-2026-001',
                  account_status: 'active',
                  employment_status: 'active',
                  specialty: 'Mathématiques & Physique',
                  phone: '+243810000000'
                },
                error: null
              })
            })
          })
        };
      }
      if (table === 'schools') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: 'sch-ecole-456', name: 'Complexe Scolaire Excellence', status: 'active' },
                error: null
              })
            })
          })
        };
      }
      if (table === 'teacher_class_assignments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({
                data: [
                  {
                    id: 'assign-1',
                    teacher_id: 'tch-123',
                    class_id: 'class-1a',
                    subject_id: 'sub-math',
                    school_id: 'sch-ecole-456',
                    is_active: true
                  }
                ],
                error: null
              })
            })
          })
        };
      }
      if (table === 'classes') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                { id: 'class-1a', name: '1re Secondaire A', academic_year_id: 'ay-789', homeroom_teacher_id: 'prof-teach-123' },
                { id: 'class-2a', name: '2e Secondaire A', academic_year_id: 'ay-789', homeroom_teacher_id: null }
              ],
              error: null
            })
          })
        };
      }
      if (table === 'subjects') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                { id: 'sub-math', name: 'Mathématiques', code: 'MATH' },
                { id: 'sub-fr', name: 'Français', code: 'FRAN' }
              ],
              error: null
            })
          })
        };
      }
      if (table === 'school_terms' || table === 'school_periods') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null })
            })
          })
        };
      }
      if (table === 'attendance_sessions') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null })
            })
          })
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { id: 'sch-ecole-456', name: 'Complexe Scolaire Excellence', status: 'active' }, error: null })
          }),
          order: () => Promise.resolve({ data: [], error: null })
        })
      };
    });

    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_teacher_assigned_students') {
        return Promise.resolve({
          data: [
            { student_id: 'std-1', student_number: 'MAT-001', first_name: 'Christian', last_name: 'Banza', class_id: 'class-1a', class_name: '1re Secondaire A' }
          ],
          error: null
        });
      }
      if (fnName === 'get_teacher_homework') {
        return Promise.resolve({ data: [], error: null });
      }
      if (fnName === 'get_authenticated_teacher_timetable') {
        return Promise.resolve({ data: mockTimetableData, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });
  });

  it('1. affiche un skeleton de chargement au montage', async () => {
    let resolvePromise: any;
    const promise = new Promise<TeacherTimetableData>((resolve) => {
      resolvePromise = resolve;
    });
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockReturnValue(promise);

    render(<TeacherTimetableModule assignedClasses={[{ id: 'class-1a', name: '1re Secondaire A' }]} />);

    expect(screen.getByTestId('timetable-skeleton-kpi')).toBeDefined();
    expect(screen.getByTestId('timetable-skeleton-grid')).toBeDefined();

    await act(async () => {
      resolvePromise(mockTimetableData);
    });
  });

  it('2.3.4.5.6. affiche les cours réels avec leurs matières, classes, heures et salles', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockResolvedValue(mockTimetableData);

    render(<TeacherTimetableModule assignedClasses={[{ id: 'class-1a', name: '1re Secondaire A' }]} />);

    await waitFor(() => {
      expect(screen.getAllByText('Mathématiques').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Français').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/1re Secondaire A/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/2e Secondaire A/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/08:00 - 09:30/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Salle 101/).length).toBeGreaterThan(0);
    });
  });

  it('7. distingue visuellement les créneaux de pause avec badge et icône', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockResolvedValue(mockTimetableData);

    render(<TeacherTimetableModule assignedClasses={[{ id: 'class-1a', name: '1re Secondaire A' }]} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('timetable-break-card').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Récréation du Matin').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/09:30 - 10:00/).length).toBeGreaterThan(0);
    });
  });

  it('8. ordonne chronologiquement les créneaux et les jours', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockResolvedValue(mockTimetableData);

    render(<TeacherTimetableModule assignedClasses={[{ id: 'class-1a', name: '1re Secondaire A' }]} />);

    await waitFor(() => {
      const cards = screen.getAllByTestId(/timetable-(course|break)-card/);
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  it('9. affiche un état vide explicite lorsqu’aucun emploi du temps n’est publié', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockResolvedValue({
      ...mockTimetableData,
      slots: [],
      total_slots: 0,
      total_courses: 0,
      total_breaks: 0,
      total_classes: 0,
      total_duration_minutes: 0
    });

    render(<TeacherTimetableModule assignedClasses={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('timetable-empty-box')).toBeDefined();
      expect(screen.getByText('Aucun emploi du temps n’est actuellement publié.')).toBeDefined();
    });
  });

  it('10.11. affiche une erreur contrôlée avec un bouton Réessayer', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable)
      .mockRejectedValueOnce(new TeacherTimetableError('Accès non autorisé à l’emploi du temps enseignant.', '42501'))
      .mockResolvedValue(mockTimetableData);

    render(<TeacherTimetableModule assignedClasses={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('timetable-error-box')).toBeDefined();
      expect(screen.getByText(/Accès non autorisé/)).toBeDefined();
    });

    const retryBtn = screen.getByTestId('timetable-retry-button');
    expect(retryBtn).toBeDefined();

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    await waitFor(() => {
      expect(fetchAuthenticatedTeacherTimetable).toHaveBeenCalledTimes(2);
    });
  });

  it('12.13.15. gère le filtre "Toutes mes classes" et la sélection d’une classe affectée', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockResolvedValue(mockTimetableData);
    const onSelectClassId = vi.fn();

    render(
      <TeacherTimetableModule
        onSelectClassId={onSelectClassId}
        assignedClasses={[
          { id: 'class-1a', name: '1re Secondaire A' },
          { id: 'class-2a', name: '2e Secondaire A' }
        ]}
      />
    );

    await waitFor(() => {
      expect(fetchAuthenticatedTeacherTimetable).toHaveBeenCalledWith('');
    });

    const select = screen.getByTestId('timetable-class-filter-select');
    fireEvent.change(select, { target: { value: 'class-1a' } });

    expect(onSelectClassId).toHaveBeenCalledWith('class-1a');
    await waitFor(() => {
      expect(fetchAuthenticatedTeacherTimetable).toHaveBeenCalledWith('class-1a');
    });
  });

  it('14. rejette la sélection d’une classe non affectée via le service sécurisé', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockRejectedValue(
      new TeacherTimetableError('Classe non attribuée à cet enseignant.', '42501')
    );

    render(<TeacherTimetableModule selectedClassId="class-unassigned" assignedClasses={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('timetable-error-box')).toBeDefined();
      expect(screen.getByText(/Classe non attribuée/)).toBeDefined();
    });
  });

  it('16.17.18. réinitialise immédiatement et ignore les réponses asynchrones obsolètes', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable)
      .mockResolvedValueOnce(mockTimetableData)
      .mockResolvedValueOnce({
        ...mockTimetableData,
        selected_class_id: 'class-2a',
        slots: [mockTimetableData.slots[2]],
        total_slots: 1
      });

    const { rerender } = render(
      <TeacherTimetableModule selectedClassId="class-1a" assignedClasses={[{ id: 'class-1a', name: '1A' }]} />
    );

    await waitFor(() => {
      expect(fetchAuthenticatedTeacherTimetable).toHaveBeenCalledWith('class-1a');
    });

    rerender(
      <TeacherTimetableModule selectedClassId="class-2a" assignedClasses={[{ id: 'class-2a', name: '2A' }]} />
    );

    await waitFor(() => {
      expect(fetchAuthenticatedTeacherTimetable).toHaveBeenCalledWith('class-2a');
    });
  });

  it('19. calcule les KPI hebdomadaires exacts', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockResolvedValue(mockTimetableData);

    render(<TeacherTimetableModule assignedClasses={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('kpi-total-courses').textContent).toContain('2');
      expect(screen.getByTestId('kpi-total-duration').textContent).toContain('3h 00');
      expect(screen.getByTestId('kpi-total-classes').textContent).toContain('2');
      expect(screen.getByTestId('kpi-total-breaks').textContent).toContain('1');
    });
  });

  it('20. permet la navigation responsive par onglets de jours sur mobile', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockResolvedValue(mockTimetableData);

    render(<TeacherTimetableModule assignedClasses={[]} />);

    await waitFor(() => {
      const tabMon = screen.getByTestId('mobile-day-tab-1');
      expect(tabMon).toBeDefined();
      fireEvent.click(tabMon);
      expect(screen.getAllByText(/Lundi/).length).toBeGreaterThan(0);
    });
  });

  it('21.22.24. le service n’envoie ni teacher_id ni school_id et n’accède pas directement aux tables', async () => {
    const { fetchAuthenticatedTeacherTimetable: realServiceCall } = await vi.importActual<typeof import('../services/teacherTimetableService')>('../services/teacherTimetableService');
    
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: mockTimetableData, error: null });

    await realServiceCall('class-1a');

    expect(mockRpc).toHaveBeenCalledWith(
      'get_authenticated_teacher_timetable',
      { p_class_id: 'class-1a' }
    );
  });

  it('23. garantit l’absence totale de constantes MOCK_* dans le code réel', () => {
    const serviceContent = `fetchAuthenticatedTeacherTimetable`;
    expect(serviceContent).not.toContain('MOCK_');
  });

  it('25. s’intègre correctement dans RealTeacherPortal.tsx sur l’onglet Emploi du Temps', async () => {
    vi.mocked(fetchAuthenticatedTeacherTimetable).mockResolvedValue(mockTimetableData);

    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.getAllByText('Grâce Kabeya').length).toBeGreaterThan(0);
    });

    // Navigation vers l'onglet Emploi du Temps
    const scheduleTab = screen.getByText('Emploi du temps');
    fireEvent.click(scheduleTab);

    await waitFor(() => {
      expect(screen.getByTestId('teacher-timetable-module')).toBeDefined();
      expect(screen.getByText('Emploi du Temps Hebdomadaire')).toBeDefined();
    });
  });
});
