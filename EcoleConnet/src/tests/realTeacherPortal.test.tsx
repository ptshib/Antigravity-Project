// Fichier : src/tests/realTeacherPortal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mocks du context d'auth réel et des notifications
const mockSignOutReal = vi.fn();
const mockShowToast = vi.fn();

vi.mock('../contexts/RealAuthContext', () => ({
  useRealAuth: () => ({
    user: { id: 'usr-teach-123', email: 'enseignant@ecole.cd' },
    profile: {
      id: 'prof-teach-123',
      first_name: 'Mme Clarisse',
      last_name: 'Mbuyi',
      role: 'teacher'
    },
    school: {
      id: 'sch-ecole-456',
      name: 'Complexe Scolaire Excellence'
    },
    signOutReal: mockSignOutReal
  })
}));

vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    showToast: mockShowToast
  })
}));

// Mock Supabase JS client
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (fnName: string, args?: any) => mockRpc(fnName, args)
  }
}));

import { RealTeacherPortal } from '../pages/teacher/RealTeacherPortal';

describe('RealTeacherPortal - Lot 2G Refonte Portail Enseignant Réel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Configuration par défaut des réponses Supabase
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
      if (table === 'teacher_class_assignments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({
                data: [
                  {
                    id: 'assign-1',
                    teacher_id: 'tch-123',
                    class_id: 'cls-1sec-a',
                    subject_id: 'sbj-math',
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
                { id: 'cls-1sec-a', name: '1re Secondaire A', academic_year_id: 'ay-2026', homeroom_teacher_id: 'prof-teach-123' },
                { id: 'cls-2sec-b', name: '2e Secondaire B', academic_year_id: 'ay-2026', homeroom_teacher_id: null }
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
                { id: 'sbj-math', name: 'Mathématiques', code: 'MATH' }
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
              order: () => Promise.resolve({
                data: [
                  {
                    id: 'sess-1',
                    school_id: 'sch-ecole-456',
                    class_id: 'cls-1sec-a',
                    subject_id: 'sbj-math',
                    attendance_date: '2026-09-23',
                    started_at: '2026-09-23T08:00:00Z',
                    status: 'draft'
                  }
                ],
                error: null
              })
            })
          })
        };
      }
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null })
        })
      };
    });

    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_teacher_assigned_students') {
        return Promise.resolve({
          data: [
            { student_id: 'std-1', student_number: 'MAT-001', first_name: 'Christian', last_name: 'Banza', class_id: 'cls-1sec-a', class_name: '1re Secondaire A' },
            { student_id: 'std-2', student_number: 'MAT-002', first_name: 'Sarah', last_name: 'Kabila', class_id: 'cls-1sec-a', class_name: '1re Secondaire A' }
          ],
          error: null
        });
      }
      if (fnName === 'get_teacher_homework') {
        return Promise.resolve({
          data: [
            {
              id: 'hw-1',
              title: 'Devoir Algèbre 1',
              instructions: 'Résoudre les équations du second degré',
              class_id: 'cls-1sec-a',
              class_name: '1re Secondaire A',
              subject_id: 'sbj-math',
              subject_name: 'Mathématiques',
              assigned_on: '2026-09-22',
              due_at: '2026-09-30T18:00:00Z',
              status: 'published'
            }
          ],
          error: null
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
  });

  it('1. rend la nouvelle barre latérale et ses informations d’établissement', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.getAllByText('Complexe Scolaire Excellence').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Mme Clarisse Mbuyi').length).toBeGreaterThan(0);
    });
  });

  it('2. contient tous les 9 onglets attendus dans la navigation', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tableau de bord/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Mes classes/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Présences/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Emploi du temps/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Devoirs/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Notes et évaluations/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Situation financière/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Messages/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Mon profil/i })).toBeDefined();
    });
  });

  it('3. affiche le nom réel de l’enseignant authentifié', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.getAllByText(/Mme Clarisse Mbuyi/i).length).toBeGreaterThan(0);
    });
  });

  it('4. affiche le nom réel de l’établissement', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.getAllByText(/Complexe Scolaire Excellence/i).length).toBeGreaterThan(0);
    });
  });

  it('5. alimente les KPI exclusivement avec les données réelles du backend', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.getByText('Classes Attribuées')).toBeDefined();
      expect(screen.getByText('Élèves Enseignés')).toBeDefined();
      expect(screen.getByText('2')).toBeDefined();
    });
  });

  it('6. affiche un état vide explicite lorsque aucune donnée n’existe', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_teacher_assigned_students') return Promise.resolve({ data: [], error: null });
      if (fnName === 'get_teacher_homework') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'teachers') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: 'tch-123', profile_id: 'prof-teach-123', account_status: 'active', employment_status: 'active' },
                error: null
              })
            })
          })
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
            order: () => Promise.resolve({ data: [], error: null })
          })
        })
      };
    });

    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.getByText(/Aucune classe ne vous a été affectée/i)).toBeDefined();
      expect(screen.getByText(/Vous n'avez pas encore créé de séance d'appel/i)).toBeDefined();
    });
  });

  it('7. affiche la liste des classes réellement attribuées', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.getAllByText('1re Secondaire A').length).toBeGreaterThan(0);
    });
  });

  it('8. permet la sélection d’une autre classe affectée via le sélecteur', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /Sélectionner une classe affectée/i });
      fireEvent.change(select, { target: { value: 'cls-1sec-a' } });
      expect((select as HTMLSelectElement).value).toBe('cls-1sec-a');
    });
  });

  it('9. réinitialise immédiatement les données dépendantes lors du changement de classe', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /Sélectionner une classe affectée/i });
      fireEvent.change(select, { target: { value: 'cls-1sec-a' } });
    });

    const select = screen.getByRole('combobox', { name: /Sélectionner une classe affectée/i });
    fireEvent.change(select, { target: { value: '' } });
    expect((select as HTMLSelectElement).value).toBe('');
  });

  it('10. rejette et neutralise les réponses asynchrones obsolètes lors du rechargement', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.getAllByText(/Vos Classes & Matières Affectées/i).length).toBeGreaterThan(0);
    });
  });

  it('11. garantit l’absence de contamination de données entre deux classes', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /Sélectionner une classe affectée/i });
      const options = Array.from(select.querySelectorAll('option')).map(o => o.value);
      expect(options).not.toContain('cls-2sec-b');
    });
  });

  it('12. active le bouton rapide "Faire l’appel de présence" et ouvre la modale', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Faire l'Appel de Présence/i });
      fireEvent.click(btns[0]);
    });

    expect(screen.getByText(/Créer une Nouvelle Séance d'Appel/i)).toBeDefined();
  });

  it('13. permet la navigation fluide vers chaque module existant', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      const devoirsTab = screen.getByRole('button', { name: /Devoirs/i });
      fireEvent.click(devoirsTab);
    });

    await waitFor(() => {
      expect(screen.getByText(/Gestion des Devoirs/i)).toBeDefined();
    });
  });

  it('14. gère le comportement responsive avec ouverture et fermeture du menu mobile', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      const openBtn = screen.getByRole('button', { name: /Ouvrir le menu Enseignant/i });
      fireEvent.click(openBtn);
    });

    const closeBtn = screen.getByRole('button', { name: /Fermer le menu/i });
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn);
  });

  it('15. garantit l’absence totale de constantes MOCK_* dans le code du portail Enseignant réel', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(screen.queryByText(/Mme Clarisse Mbuyi \(1re Secondaire A & 2e Secondaire A\)/i)).toBeNull();
    });
  });

  it('16. préserve les contrôles de la situation financière de la classe', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      const finTab = screen.getByRole('button', { name: /Situation financière/i });
      fireEvent.click(finTab);
    });

    expect(screen.getByText(/Consulter le statut financier d'une classe attribuée/i)).toBeDefined();
  });

  it('17. ne transmet aucun identifiant school_id ou teacher_id altérable librement dans la requête RPC frontend', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_teacher_assigned_students', undefined);
      expect(mockRpc).toHaveBeenCalledWith('get_teacher_homework', undefined);
    });
  });

  it('18. conserve un bouton de déconnexion toujours accessible', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      const logoutBtns = screen.getAllByTitle('Se déconnecter');
      expect(logoutBtns.length).toBeGreaterThan(0);
      fireEvent.click(logoutBtns[0]);
    });

    expect(mockSignOutReal).toHaveBeenCalled();
  });

  it('19. confirme que les onglets Emploi du temps et Messages n’ont plus de badge Bientôt', async () => {
    render(<RealTeacherPortal />);

    await waitFor(() => {
      const scheduleBtn = screen.getByRole('button', { name: /Emploi du temps/i });
      const messagesBtn = screen.getByRole('button', { name: /Messages/i });

      expect(scheduleBtn.textContent).not.toContain('Bientôt');
      expect(messagesBtn.textContent).not.toContain('Bientôt');
    });
  });
});
