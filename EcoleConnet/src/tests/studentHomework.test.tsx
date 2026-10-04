// Fichier : src/tests/studentHomework.test.tsx
// Suite de tests frontend dédiée pour les Devoirs Élève (Phase 2K-T7-F)

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealStudentPortal } from '../pages/student/RealStudentPortal';
import { parseStudentHomeworkData, computeHomeworkStatus, formatHomeworkAssignedDate, formatHomeworkDueDate } from '../types/studentHomework';
import type { StudentHomeworkItem } from '../types/studentHomework';

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

let mockHomeworkDataResponse: any = null;
let mockHomeworkRpcError: any = null;

vi.mock('../lib/supabase', () => {
  return {
    supabase: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'student-profile-uid-1' } } })
      },
      from: (tableName: string) => {
        if (tableName === 'school_homework') {
          throw new Error('INTERDICTION : Requête directe sur school_homework détectée.');
        }
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
              name: '2026–2027'
            }
          });
        }
        return makeChain(null);
      },
      rpc: (rpcName: string, params?: any) => {
        if (rpcName === 'get_homework_for_student') {
          throw new Error('INTERDICTION : Appel à RPC legacy get_homework_for_student détecté.');
        }
        mockRpcCalls.push({ rpcName, params });

        if (rpcName === 'get_authenticated_student_homework') {
          if (mockHomeworkRpcError) {
            return Promise.resolve({ data: null, error: mockHomeworkRpcError });
          }
          return Promise.resolve({ data: mockHomeworkDataResponse, error: null });
        }
        if (rpcName === 'get_school_calendar') {
          return Promise.resolve({ data: [], error: null });
        }
        if (rpcName === 'get_student_period_result') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }
    }
  };
});

describe('StudentHomework Frontend Suite — Lot 2K-T7-F', () => {
  const futureIso = '2099-12-31T10:00:00Z';
  const pastIso = '2020-01-01T10:00:00Z';
  const now = new Date();
  const todayTimeIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0).toISOString();

  beforeEach(() => {
    window.history.pushState({}, '', '/app/eleve/resultats');
    vi.clearAllMocks();
    mockRpcCalls.length = 0;
    mockHomeworkRpcError = null;

    mockHomeworkDataResponse = {
      student_name: 'Jean-Luc Mbuyi',
      student_number: 'MAT-2026-001',
      class_name: '7ème EB A',
      academic_year_name: '2026–2027',
      summary: {
        total: 4,
        open: 3,
        closed: 1
      },
      homework: [
        {
          title: 'Exercices d Algèbre',
          instructions: 'Faire les ex 1 à 5 p. 42',
          subject_name: 'Mathématiques',
          teacher_name: 'Kabangu Mwamba',
          assigned_on: '2026-09-25',
          due_at: futureIso,
          estimated_minutes: 30,
          is_closed: false
        },
        {
          title: 'Devoir du Jour',
          instructions: 'Rédiger une synthèse rapide',
          subject_name: 'Français',
          teacher_name: 'Claire Dubois',
          assigned_on: '2026-09-26',
          due_at: todayTimeIso,
          estimated_minutes: null,
          is_closed: false
        },
        {
          title: 'Devoir en Retard',
          instructions: 'Problème de géométrie spatiale',
          subject_name: 'Mathématiques',
          teacher_name: 'Enseignant non renseigné',
          assigned_on: '2026-09-01',
          due_at: pastIso,
          estimated_minutes: 45,
          is_closed: false
        },
        {
          title: 'Devoir Clôturé Ancien',
          instructions: 'Lecture du chapitre 3',
          subject_name: 'Histoire',
          teacher_name: 'Marc Lumumba',
          assigned_on: '2026-09-10',
          due_at: pastIso,
          estimated_minutes: 15,
          is_closed: true
        }
      ]
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Affiche la rubrique Devoirs dans le menu latéral', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    expect(screen.getByText('Devoirs & Cahier de texte')).toBeInTheDocument();
  });

  it('2. Navigation vers la rubrique devoirs', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Devoirs & Cahier de texte/i })).toBeInTheDocument();
    });
  });

  it('3. Exécute l’appel RPC get_authenticated_student_homework SANS AUCUN ARGUMENT', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Devoirs & Cahier de texte/i })).toBeInTheDocument();
    });

    const hwRpcCall = mockRpcCalls.find(c => c.rpcName === 'get_authenticated_student_homework');
    expect(hwRpcCall).toBeDefined();
    expect(hwRpcCall?.params).toBeUndefined();
  });

  it('4. Absence totale de requête directe vers school_homework ou RPC legacy', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Devoirs & Cahier de texte/i })).toBeInTheDocument();
    });

    const legacyCall = mockRpcCalls.find(c => c.rpcName === 'get_homework_for_student');
    expect(legacyCall).toBeUndefined();
  });

  it('5. Rendu d’un devoir à venir (badge À venir)', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Exercices d Algèbre')).toBeInTheDocument();
    });

    expect(screen.getAllByText('À venir').length).toBeGreaterThan(0);
    expect(screen.getByText('Faire les ex 1 à 5 p. 42')).toBeInTheDocument();
  });

  it('6. Rendu d’un devoir à rendre aujourd’hui (badge Aujourd’hui)', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Devoir du Jour')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Aujourd’hui').length).toBeGreaterThan(0);
  });

  it('7. Rendu d’un devoir en retard (badge En retard)', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Devoir en Retard')).toBeInTheDocument();
    });

    expect(screen.getAllByText('En retard').length).toBeGreaterThan(0);
  });

  it('8. Rendu d’un devoir clôturé (badge Clôturé)', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Devoir Clôturé Ancien')).toBeInTheDocument();
    });

    expect(screen.getByText('Clôturé')).toBeInTheDocument();
  });

  it('9. Priorité absolue de is_closed = true sur la date', () => {
    const itemClosed: StudentHomeworkItem = {
      title: 'Test Closed',
      instructions: '',
      subject_name: 'Maths',
      teacher_name: 'Prof',
      assigned_on: '2026-09-01',
      due_at: futureIso,
      estimated_minutes: 20,
      is_closed: true
    };

    const status = computeHomeworkStatus(itemClosed);
    expect(status).toBe('closed');
  });

  it('10. Fonctionnement de chaque filtre (Tous, À venir, Aujourd’hui, En retard, Clôturés)', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Exercices d Algèbre')).toBeInTheDocument();
    });

    // Filtre À venir
    fireEvent.click(screen.getByRole('button', { name: /^À venir/i }));
    await waitFor(() => {
      expect(screen.getByText('Exercices d Algèbre')).toBeInTheDocument();
      expect(screen.queryByText('Devoir Clôturé Ancien')).toBeNull();
    });

    // Filtre Aujourd'hui
    fireEvent.click(screen.getByRole('button', { name: /^Aujourd’hui/i }));
    await waitFor(() => {
      expect(screen.getByText('Devoir du Jour')).toBeInTheDocument();
      expect(screen.queryByText('Exercices d Algèbre')).toBeNull();
    });

    // Filtre En retard
    fireEvent.click(screen.getByRole('button', { name: /^En retard/i }));
    await waitFor(() => {
      expect(screen.getByText('Devoir en Retard')).toBeInTheDocument();
      expect(screen.queryByText('Exercices d Algèbre')).toBeNull();
    });

    // Filtre Clôturés
    fireEvent.click(screen.getByRole('button', { name: /^Clôturés/i }));
    await waitFor(() => {
      expect(screen.getByText('Devoir Clôturé Ancien')).toBeInTheDocument();
      expect(screen.queryByText('Exercices d Algèbre')).toBeNull();
    });

    // Filtre Tous
    fireEvent.click(screen.getByRole('button', { name: /^Tous/i }));
    await waitFor(() => {
      expect(screen.getByText('Exercices d Algèbre')).toBeInTheDocument();
      expect(screen.getByText('Devoir Clôturé Ancien')).toBeInTheDocument();
    });
  });

  it('11. estimated_minutes = null rendu sans texte parasite', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Devoir du Jour')).toBeInTheDocument();
    });

    expect(screen.getByText('Durée estimée : 30 min')).toBeInTheDocument();
    expect(screen.queryByText('Durée estimée : null')).toBeNull();
    expect(screen.queryByText('Durée estimée : undefined')).toBeNull();
  });

  it('12. Nom enseignant fallback propre (Enseignant non renseigné)', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Devoir en Retard')).toBeInTheDocument();
    });

    expect(screen.getByText('Enseignant non renseigné')).toBeInTheDocument();
  });

  it('13. État vide valide (Aucun devoir publié pour le moment)', async () => {
    mockHomeworkDataResponse = {
      student_name: 'Jean-Luc Mbuyi',
      student_number: 'MAT-2026-001',
      class_name: '7ème EB A',
      academic_year_name: '2026–2027',
      summary: { total: 0, open: 0, closed: 0 },
      homework: []
    };

    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Aucun devoir publié pour le moment')).toBeInTheDocument();
    });
  });

  it('14. Erreur 42501 d’accès refusé affichée avec bouton Réessayer', async () => {
    mockHomeworkRpcError = {
      code: '42501',
      message: 'REJET ACCÈS : Inscription active introuvable ou multiple.'
    };

    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('REJET ACCÈS : Inscription active introuvable ou multiple.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Réessayer/i })).toBeInTheDocument();
    });
  });

  it('15. Erreur réseau avec bouton Réessayer qui relance la RPC', async () => {
    mockHomeworkRpcError = {
      code: '500',
      message: 'Network connection failure.'
    };

    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText("Impossible de charger les devoirs. Veuillez réessayer.")).toBeInTheDocument();
    });

    // Rétablir la réponse valide et cliquer Réessayer
    mockHomeworkRpcError = null;
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/i }));

    await waitFor(() => {
      expect(screen.getByText('Exercices d Algèbre')).toBeInTheDocument();
    });
  });

  it('16. Réponse malformée traitée comme une erreur contrôlée', () => {
    expect(() => parseStudentHomeworkData('invalid string')).toThrow();
    expect(() => parseStudentHomeworkData({ homework: 'not-array' })).toThrow();
  });

  it('17. Absence totale d’UUID, null ou undefined textuel dans le DOM', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Exercices d Algèbre')).toBeInTheDocument();
    });

    const bodyText = document.body.textContent || '';
    expect(bodyText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(bodyText).not.toContain('null');
    expect(bodyText).not.toContain('undefined');
  });

  it('18. Consignes rendues comme texte React sans HTML interprété (sécurité XSS)', async () => {
    mockHomeworkDataResponse.homework[0].instructions = '<script>alert("xss")</script><b id="xss-test">Invasion HTML</b>';

    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('<script>alert("xss")</script><b id="xss-test">Invasion HTML</b>')).toBeInTheDocument();
    });

    expect(document.getElementById('xss-test')).toBeNull();
  });

  it('19. Bouton Actualiser recharge uniquement les devoirs sans réinitialiser la rubrique', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

    await waitFor(() => {
      expect(screen.getByText('Exercices d Algèbre')).toBeInTheDocument();
    });

    const callsBefore = [...mockRpcCalls];
    const refreshBtns = screen.getAllByRole('button', { name: /Actualiser/i });
    fireEvent.click(refreshBtns[0]);

    await waitFor(() => {
      const hwCalls = mockRpcCalls.filter(c => c.rpcName === 'get_authenticated_student_homework');
      expect(hwCalls.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('heading', { name: /Devoirs & Cahier de texte/i })).toBeInTheDocument();
    });

    const newCalls = mockRpcCalls.slice(callsBefore.length);
    const rpcNames = newCalls.map(c => c.rpcName);
    expect(rpcNames).toContain('get_authenticated_student_homework');
    expect(rpcNames).not.toContain('get_authenticated_student_timetable');
    expect(rpcNames).not.toContain('get_student_period_result');
  });

  it('20. Referme automatiquement le drawer mobile lors de la sélection de Devoirs', async () => {
    render(<RealStudentPortal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ouvrir le menu/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Ouvrir le menu/i }));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Fermer le menu/i }).length).toBeGreaterThan(0);
    });

    const devoirsNavBtns = screen.getAllByText('Devoirs & Cahier de texte');
    fireEvent.click(devoirsNavBtns[devoirsNavBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Fermer le menu/i }).length).toBe(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* ADVERSARIAL & BOUNDARY TESTS — LOT 2K-T7-F-V                                */
  /* -------------------------------------------------------------------------- */

  describe('Adversarial Parser Audits (parseStudentHomeworkData)', () => {
    it('21. Rejette les racines non objets (string, array, null, undefined, number)', () => {
      expect(() => parseStudentHomeworkData('chaine')).toThrow('Format de réponse invalide pour les devoirs.');
      expect(() => parseStudentHomeworkData(12345)).toThrow('Format de réponse invalide pour les devoirs.');
      expect(() => parseStudentHomeworkData(null)).toThrow('Format de réponse invalide pour les devoirs.');
      expect(() => parseStudentHomeworkData(undefined)).toThrow('Format de réponse invalide pour les devoirs.');
      expect(() => parseStudentHomeworkData([1, 2, 3])).toThrow('Format de réponse invalide pour les devoirs.');
    });

    it('22. Rejette si homework n’est pas un tableau', () => {
      expect(() => parseStudentHomeworkData({ homework: 'not-an-array' })).toThrow('Format de liste de devoirs invalide.');
      expect(() => parseStudentHomeworkData({ homework: { title: 'Devoir' } })).toThrow('Format de liste de devoirs invalide.');
      expect(() => parseStudentHomeworkData({ homework: null })).toThrow('Format de liste de devoirs invalide.');
    });

    it('23. Rejette un devoir individuel malformé (title absent ou non string)', () => {
      const badTitle1 = { homework: [{ title: 123, instructions: 'I', subject_name: 'S', teacher_name: 'T', assigned_on: '2026-09-01', due_at: '2026-09-10T10:00:00Z', is_closed: false, estimated_minutes: 10 }] };
      expect(() => parseStudentHomeworkData(badTitle1)).toThrow(/Titre de devoir invalide/);

      const badTitle2 = { homework: [{ instructions: 'I', subject_name: 'S', teacher_name: 'T', assigned_on: '2026-09-01', due_at: '2026-09-10T10:00:00Z', is_closed: false, estimated_minutes: 10 }] };
      expect(() => parseStudentHomeworkData(badTitle2)).toThrow(/Titre de devoir invalide/);
    });

    it('24. Rejette si instructions, subject_name ou teacher_name sont invalides', () => {
      const validBase = { title: 'T', instructions: 'I', subject_name: 'S', teacher_name: 'P', assigned_on: '2026-09-01', due_at: '2026-09-10T10:00:00Z', is_closed: false, estimated_minutes: 10 };

      expect(() => parseStudentHomeworkData({ homework: [{ ...validBase, instructions: 999 }] })).toThrow(/Consignes de devoir invalides/);
      expect(() => parseStudentHomeworkData({ homework: [{ ...validBase, subject_name: '' }] })).toThrow(/Matière de devoir invalide/);
      expect(() => parseStudentHomeworkData({ homework: [{ ...validBase, teacher_name: 42 }] })).toThrow(/Enseignant de devoir invalide/);
    });

    it('25. Rejette si assigned_on ou due_at sont des dates invalides', () => {
      const validBase = { title: 'T', instructions: 'I', subject_name: 'S', teacher_name: 'P', assigned_on: '2026-09-01', due_at: '2026-09-10T10:00:00Z', is_closed: false, estimated_minutes: 10 };

      expect(() => parseStudentHomeworkData({ homework: [{ ...validBase, assigned_on: 'INVALID-DATE' }] })).toThrow(/Date d'assignation invalide/);
      expect(() => parseStudentHomeworkData({ homework: [{ ...validBase, due_at: 'PAS-UNE-DATE' }] })).toThrow(/Date d'échéance invalide/);
    });

    it('26. Rejette si is_closed n’est pas un booléen strict', () => {
      const validBase = { title: 'T', instructions: 'I', subject_name: 'S', teacher_name: 'P', assigned_on: '2026-09-01', due_at: '2026-09-10T10:00:00Z', is_closed: false, estimated_minutes: 10 };

      expect(() => parseStudentHomeworkData({ homework: [{ ...validBase, is_closed: 'true' }] })).toThrow(/Statut de clôture non booléen/);
      expect(() => parseStudentHomeworkData({ homework: [{ ...validBase, is_closed: 1 }] })).toThrow(/Statut de clôture non booléen/);
    });

    it('27. Rejette si estimated_minutes est d’un type autre que number ou null', () => {
      const validBase = { title: 'T', instructions: 'I', subject_name: 'S', teacher_name: 'P', assigned_on: '2026-09-01', due_at: '2026-09-10T10:00:00Z', is_closed: false, estimated_minutes: 10 };

      expect(() => parseStudentHomeworkData({ homework: [{ ...validBase, estimated_minutes: '45' }] })).toThrow(/Durée estimée invalide/);
      expect(() => parseStudentHomeworkData({ homework: [{ ...validBase, estimated_minutes: { val: 45 } }] })).toThrow(/Durée estimée invalide/);
    });

    it('28. Ignorer les champs UUID ou supplémentaires inattendus sans fuite dans le retour', () => {
      const rawWithUuid = {
        student_name: 'Élève Test',
        homework: [
          {
            id: 'uuid-homework-12345-secret',
            school_id: 'uuid-school-67890',
            title: 'Titre Valide',
            instructions: 'Consigne',
            subject_name: 'Maths',
            teacher_name: 'Prof',
            assigned_on: '2026-09-01',
            due_at: '2026-09-10T10:00:00Z',
            estimated_minutes: 15,
            is_closed: false,
            extra_field: 'leak_prevention'
          }
        ]
      };

      const parsed = parseStudentHomeworkData(rawWithUuid);
      expect(parsed.homework.length).toBe(1);
      const item = parsed.homework[0] as any;

      expect(item.id).toBeUndefined();
      expect(item.school_id).toBeUndefined();
      expect(item.extra_field).toBeUndefined();
      expect(Object.keys(item).sort()).toEqual([
        'assigned_on',
        'due_at',
        'estimated_minutes',
        'instructions',
        'is_closed',
        'subject_name',
        'teacher_name',
        'title'
      ]);
    });

    it('29. Rejet complet si le tableau mélange un devoir valide et un devoir invalide (pas de liste partielle)', () => {
      const mixedPayload = {
        homework: [
          {
            title: 'Devoir Valide 1',
            instructions: 'Consigne 1',
            subject_name: 'Maths',
            teacher_name: 'Prof A',
            assigned_on: '2026-09-01',
            due_at: '2026-09-10T10:00:00Z',
            estimated_minutes: 20,
            is_closed: false
          },
          {
            title: '', // INVALID !
            instructions: 'Consigne 2',
            subject_name: 'Physique',
            teacher_name: 'Prof B',
            assigned_on: '2026-09-01',
            due_at: '2026-09-10T10:00:00Z',
            estimated_minutes: 30,
            is_closed: false
          }
        ]
      };

      expect(() => parseStudentHomeworkData(mixedPayload)).toThrow(/Titre de devoir invalide/);
    });
  });

  describe('Fixed Reference Date Temporal Status Tests (computeHomeworkStatus)', () => {
    const refDate = new Date('2026-09-27T12:00:00Z');

    const makeItem = (due_at: string, is_closed = false): StudentHomeworkItem => ({
      title: 'Test',
      instructions: 'Consigne',
      subject_name: 'Matière',
      teacher_name: 'Prof',
      assigned_on: '2026-09-20',
      due_at,
      estimated_minutes: 30,
      is_closed
    });

    it('30. is_closed=true → closed dans TOUS les cas (passé, présent, futur)', () => {
      expect(computeHomeworkStatus(makeItem('2020-01-01T10:00:00Z', true), refDate)).toBe('closed');
      expect(computeHomeworkStatus(makeItem('2026-09-27T08:00:00Z', true), refDate)).toBe('closed');
      expect(computeHomeworkStatus(makeItem('2026-09-27T18:00:00Z', true), refDate)).toBe('closed');
      expect(computeHomeworkStatus(makeItem('2099-12-31T10:00:00Z', true), refDate)).toBe('closed');
    });

    it('31. Échéance plus tôt le même jour → overdue', () => {
      // refDate = 2026-09-27T12:00:00Z, due_at = 2026-09-27T08:00:00Z (passé le jour même)
      expect(computeHomeworkStatus(makeItem('2026-09-27T08:00:00Z', false), refDate)).toBe('overdue');
    });

    it('32. Échéance plus tard le même jour → due_today', () => {
      // refDate = 2026-09-27T12:00:00Z, due_at = 2026-09-27T18:00:00Z (à venir aujourd'hui)
      expect(computeHomeworkStatus(makeItem('2026-09-27T18:00:00Z', false), refDate)).toBe('due_today');
    });

    it('33. Échéance future après aujourd’hui → upcoming', () => {
      expect(computeHomeworkStatus(makeItem('2026-09-28T10:00:00Z', false), refDate)).toBe('upcoming');
    });

    it('34. Échéance passée avant aujourd’hui → overdue', () => {
      expect(computeHomeworkStatus(makeItem('2026-09-26T23:59:59Z', false), refDate)).toBe('overdue');
    });

    it('35. Timestamp avec offset horaire correctement interprété', () => {
      // 2026-09-27T15:00:00+03:00 = 2026-09-27T12:00:00Z (exactement la même heure que refDate) -> due_today
      expect(computeHomeworkStatus(makeItem('2026-09-27T15:00:00+03:00', false), refDate)).toBe('due_today');
      // 2026-09-27T10:00:00+03:00 = 2026-09-27T07:00:00Z (plus tôt que 12:00:00Z) -> overdue
      expect(computeHomeworkStatus(makeItem('2026-09-27T10:00:00+03:00', false), refDate)).toBe('overdue');
    });
  });

  describe('Isolated Refresh & Advanced XSS Protection', () => {
    it('36. Bouton Actualiser dans Résultats ne recharge QUE les résultats', async () => {
      render(<RealStudentPortal />);
      await waitFor(() => {
        expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
      });

      const callsBefore = [...mockRpcCalls];
      const refreshBtns = screen.getAllByRole('button', { name: /Actualiser/i });
      fireEvent.click(refreshBtns[0]);

      await waitFor(() => {
        const newCalls = mockRpcCalls.slice(callsBefore.length).map(c => c.rpcName);
        expect(newCalls).toContain('get_student_period_result');
        expect(newCalls).not.toContain('get_authenticated_student_homework');
        expect(newCalls).not.toContain('get_authenticated_student_timetable');
      });
    });

    it('37. Protection XSS avancée : <script> et <img> avec onerror ne sont JAMAIS interprétés ni exécutés dans le DOM', async () => {
      mockHomeworkDataResponse.homework[0].instructions = '<script>alert("xss")</script><img src=x onerror=alert(1) id="xss-img-tag" />';

      render(<RealStudentPortal />);
      await waitFor(() => {
        expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

      await waitFor(() => {
        expect(screen.getByText('<script>alert("xss")</script><img src=x onerror=alert(1) id="xss-img-tag" />')).toBeInTheDocument();
      });

      expect(document.getElementById('xss-img-tag')).toBeNull();
      expect(document.querySelector('script')).toBeNull();
    });
  });

  describe('French Date Formatting Audit — Lot 2K-T7-F-V3', () => {
    it('38. Formate correctement un assigned_on au format YYYY-MM-DD en français (sans décalage UTC)', () => {
      expect(formatHomeworkAssignedDate('2026-09-25')).toBe('25 sept. 2026');
      expect(formatHomeworkAssignedDate('2026-01-01')).toBe('1 janv. 2026');
      expect(formatHomeworkAssignedDate('2026-12-31')).toBe('31 déc. 2026');
    });

    it('39. Formate correctement un assigned_on au format ISO complet en français', () => {
      expect(formatHomeworkAssignedDate('2026-09-25T08:00:00Z')).toBe('25 sept. 2026');
      expect(formatHomeworkAssignedDate('2026-09-25T08:00:00+02:00')).toBe('25 sept. 2026');
    });

    it('40. Formate due_at avec date ET heure en français', () => {
      expect(formatHomeworkDueDate('2026-09-28T10:00:00Z')).toBe('28 sept. 2026 à 10:00');
      expect(formatHomeworkDueDate('2026-09-30T14:30:00Z')).toBe('30 sept. 2026 à 14:30');
    });

    it('41. Gère correctement les offsets ISO de fuseau horaire (+02:00, +03:00)', () => {
      expect(formatHomeworkDueDate('2026-09-28T10:00:00+02:00')).toBe('28 sept. 2026 à 10:00');
      expect(formatHomeworkDueDate('2026-09-28T15:45:00+03:00')).toBe('28 sept. 2026 à 15:45');
    });

    it('42. Confirme l’absence totale de dates ISO brutes (T, Z) dans le DOM des cartes', async () => {
      render(<RealStudentPortal />);
      await waitFor(() => {
        expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

      await waitFor(() => {
        expect(screen.getByText('Exercices d Algèbre')).toBeInTheDocument();
      });

      const bodyText = document.body.textContent || '';
      expect(bodyText).not.toMatch(/Donné le : \d{4}-\d{2}-\d{2}T/);
      expect(bodyText).not.toMatch(/À rendre le : \d{4}-\d{2}-\d{2}T/);
      expect(bodyText).not.toContain('2099-12-31T10:00:00Z');
      expect(bodyText).toContain('Donné le : 25 sept. 2026');
      expect(bodyText).toContain('À rendre le : 31 déc. 2099 à 10:00');
    });

    it('43. Confirme l’absence de Invalid Date, null ou undefined dans le DOM rendu', async () => {
      render(<RealStudentPortal />);
      await waitFor(() => {
        expect(screen.getByText('Résultats & Bulletins')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Devoirs & Cahier de texte'));

      await waitFor(() => {
        expect(screen.getByText('Exercices d Algèbre')).toBeInTheDocument();
      });

      const bodyText = document.body.textContent || '';
      expect(bodyText).not.toContain('Invalid Date');
      expect(bodyText).not.toContain('null');
      expect(bodyText).not.toContain('undefined');
    });

    it('44. Conserve la stricte intégrité du calcul des statuts temporels (upcoming, due_today, overdue, closed)', () => {
      const ref = new Date('2026-09-27T12:00:00Z');
      const itemBase = {
        title: 'T', instructions: 'I', subject_name: 'S', teacher_name: 'P',
        assigned_on: '2026-09-20', due_at: '2026-09-30T10:00:00Z', estimated_minutes: 30, is_closed: false
      };

      expect(computeHomeworkStatus({ ...itemBase, due_at: '2026-09-30T10:00:00Z' }, ref)).toBe('upcoming');
      expect(computeHomeworkStatus({ ...itemBase, due_at: '2026-09-27T18:00:00Z' }, ref)).toBe('due_today');
      expect(computeHomeworkStatus({ ...itemBase, due_at: '2026-09-26T10:00:00Z' }, ref)).toBe('overdue');
      expect(computeHomeworkStatus({ ...itemBase, is_closed: true }, ref)).toBe('closed');
    });
  });
});
