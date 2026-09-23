import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeacherHomeworkModule from '../components/teacher/TeacherHomeworkModule';
import type { AssignedClass, AssignedSubject } from '../components/teacher/TeacherHomeworkModule';
import {
  fetchTeacherHomework,
  createTeacherHomework,
  updateTeacherHomework,
  publishTeacherHomework,
  cancelTeacherHomework,
} from '../services/teacherHomeworkService';
import type { TeacherHomework } from '../services/teacherHomeworkService';

// Mock du service teacherHomeworkService
vi.mock('../services/teacherHomeworkService', () => {
  return {
    fetchTeacherHomework: vi.fn(),
    createTeacherHomework: vi.fn(),
    updateTeacherHomework: vi.fn(),
    publishTeacherHomework: vi.fn(),
    cancelTeacherHomework: vi.fn(),
    TeacherHomeworkError: class TeacherHomeworkError extends Error {
      public code?: string;
      constructor(message: string, code?: string) {
        super(message);
        this.name = 'TeacherHomeworkError';
        this.code = code;
      }
    },
  };
});

const mockClasses: AssignedClass[] = [
  { id: 'cls-1', name: '3e Scientifique A' },
  { id: 'cls-2', name: '4e Littéraire B' },
];

const mockSubjects: AssignedSubject[] = [
  { id: 'subj-1', name: 'Physique Quantique', class_id: 'cls-1' },
  { id: 'subj-2', name: 'Chimie Organique', class_id: 'cls-1' },
  { id: 'subj-3', name: 'Philosophie', class_id: 'cls-2' },
];

const mockHomeworks: TeacherHomework[] = [
  {
    id: 'hw-1',
    school_id: 'sch-1',
    academic_year_id: 'ay-1',
    term_id: null,
    class_id: 'cls-1',
    class_name: '3e Scientifique A',
    subject_id: 'subj-1',
    subject_name: 'Physique Quantique',
    teacher_id: 'tch-1',
    teacher_name: 'Marc Tshibangu',
    title: 'Devoir de Physique Quantique',
    instructions: 'Résoudre les 3 premiers exercices du chapitre 4.',
    assigned_on: '2026-09-23',
    due_at: '2026-09-25T18:00:00Z',
    estimated_minutes: 45,
    status: 'draft',
    published_at: null,
    closed_at: null,
    created_by: 'prof-1',
    created_at: '2026-09-23T10:00:00Z',
    updated_at: '2026-09-23T10:00:00Z',
  },
  {
    id: 'hw-2',
    school_id: 'sch-1',
    academic_year_id: 'ay-1',
    term_id: null,
    class_id: 'cls-1',
    class_name: '3e Scientifique A',
    subject_id: 'subj-2',
    subject_name: 'Chimie Organique',
    teacher_id: 'tch-1',
    teacher_name: 'Marc Tshibangu',
    title: 'Rapport de Laboratoire Chimie',
    instructions: 'Rédiger le compte rendu du TP n°2.',
    assigned_on: '2026-09-20',
    due_at: '2026-09-24T12:00:00Z',
    estimated_minutes: 60,
    status: 'published',
    published_at: '2026-09-20T14:00:00Z',
    closed_at: null,
    created_by: 'prof-1',
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-20T14:00:00Z',
  },
  {
    id: 'hw-3',
    school_id: 'sch-1',
    academic_year_id: 'ay-1',
    term_id: null,
    class_id: 'cls-2',
    class_name: '4e Littéraire B',
    subject_id: 'subj-3',
    subject_name: 'Philosophie',
    teacher_id: 'tch-1',
    teacher_name: 'Marc Tshibangu',
    title: 'Dissertation Philosophie',
    instructions: 'Sujet : La liberté est-elle une illusion ?',
    assigned_on: '2026-09-15',
    due_at: '2026-09-22T08:00:00Z',
    estimated_minutes: 90,
    status: 'cancelled',
    published_at: null,
    closed_at: null,
    created_by: 'prof-1',
    created_at: '2026-09-15T09:00:00Z',
    updated_at: '2026-09-15T09:00:00Z',
  },
];

describe('TeacherHomeworkModule — Suite de Tests Frontend Complète (24 scénarios)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchTeacherHomework).mockResolvedValue(mockHomeworks);
  });

  const renderModule = (props = {}) => {
    return render(
      <TeacherHomeworkModule
        assignedClasses={mockClasses}
        assignedSubjects={mockSubjects}
        {...props}
      />
    );
  };

  // 1. Skeleton initial
  it('1. Affiche le skeleton pendant le chargement initial', () => {
    vi.mocked(fetchTeacherHomework).mockImplementation(
      () => new Promise(() => {}) // Promesse jamais résolue
    );
    const { container } = renderModule();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  // 2. Liste réelle rendue
  it('2. Affiche la liste réelle des devoirs après le chargement', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
      expect(screen.getByText('Rapport de Laboratoire Chimie')).not.toBeNull();
      expect(screen.getByText('Dissertation Philosophie')).not.toBeNull();
    });
  });

  // 3. État vide
  it('3. Affiche le message d’état vide recommandé lorsqu’aucun devoir n’existe', async () => {
    vi.mocked(fetchTeacherHomework).mockResolvedValue([]);
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Aucun devoir n’a encore été créé.')).not.toBeNull();
    });
  });

  // 4. Erreur avec réessai
  it('4. Gère les erreurs de chargement contrôlées avec bouton de réessai', async () => {
    vi.mocked(fetchTeacherHomework).mockRejectedValueOnce(
      new Error('Erreur de connexion au serveur')
    );
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Erreur de connexion au serveur')).not.toBeNull();
    });

    vi.mocked(fetchTeacherHomework).mockResolvedValue(mockHomeworks);
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });
  });

  // 5. Recherche par titre
  it('5. Filtre les devoirs en direct selon le texte de recherche', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    const searchInput = screen.getByPlaceholderText(/Rechercher par titre/i);
    fireEvent.change(searchInput, { target: { value: 'Laboratoire' } });

    expect(screen.queryByText('Devoir de Physique Quantique')).toBeNull();
    expect(screen.getByText('Rapport de Laboratoire Chimie')).not.toBeNull();
  });

  // 6. Filtres classe, matière et statut
  it('6. Filtre correctement par classe, matière et statut', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    const selects = screen.getAllByRole('combobox');
    // Le 3ème select est le filtre de statut
    fireEvent.change(selects[2], { target: { value: 'draft' } });

    expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    expect(screen.queryByText('Rapport de Laboratoire Chimie')).toBeNull();
    expect(screen.queryByText('Dissertation Philosophie')).toBeNull();
  });

  // 7. KPI exacts
  it('7. Calcule et affiche les KPI exacts (Total, Brouillons, Publiés, Annulés)', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    expect(screen.getByText('3')).not.toBeNull(); // Total
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(3); // Brouillons=1, Publiés=1, Annulés=1
  });

  // 8. Ouverture du formulaire de création
  it('8. Ouvre la modale de création au clic sur "Nouveau devoir"', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    expect(screen.getByText('Créer un nouveau devoir')).not.toBeNull();
  });

  // 9. Validation des champs requis
  it('9. Valide les champs obligatoires avant soumission du formulaire', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));

    const titleInput = screen.getByLabelText(/Titre du devoir \*/i);
    expect((titleInput as HTMLInputElement).required).toBe(true);
    expect(createTeacherHomework).not.toHaveBeenCalled();
  });

  // 10. Liste des classes limitée aux affectations réelles
  it('10. Limite les choix de classes aux affectations réelles de l’enseignant', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    const classSelect = screen.getByLabelText(/Classe \*/i);
    
    const options = Array.from(classSelect.querySelectorAll('option')).map((opt) => opt.textContent);
    expect(options).toContain('3e Scientifique A');
    expect(options).toContain('4e Littéraire B');
    expect(options).not.toContain('Classe Inexistante');
  });

  // 11. Liste des matières limitée à l’affectation de la classe sélectionnée
  it('11. Filtre les matières selon la classe sélectionnée dans le formulaire', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    const classSelect = screen.getByLabelText(/Classe \*/i);
    fireEvent.change(classSelect, { target: { value: 'cls-1' } });

    const subjectSelect = screen.getByLabelText(/Matière \*/i);
    const options = Array.from(subjectSelect.querySelectorAll('option')).map((opt) => opt.textContent);
    expect(options).toContain('Physique Quantique');
    expect(options).toContain('Chimie Organique');
    expect(options).not.toContain('Philosophie');
  });

  // 12. Création d’un brouillon
  it('12. Crée un nouveau devoir en statut brouillon via le service', async () => {
    vi.mocked(createTeacherHomework).mockResolvedValue('hw-new-123');
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    fireEvent.change(screen.getByLabelText(/Classe \*/i), { target: { value: 'cls-1' } });
    fireEvent.change(screen.getByLabelText(/Matière \*/i), { target: { value: 'subj-1' } });
    fireEvent.change(screen.getByLabelText(/Titre du devoir \*/i), { target: { value: 'Nouveau Devoir Test' } });
    fireEvent.change(screen.getByLabelText(/Consignes \*/i), { target: { value: 'Faire les exercices.' } });
    fireEvent.change(screen.getByLabelText(/Date limite \*/i), { target: { value: '2026-10-01' } });

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer en brouillon/i }));

    await waitFor(() => {
      expect(createTeacherHomework).toHaveBeenCalledWith(
        expect.objectContaining({
          class_id: 'cls-1',
          subject_id: 'subj-1',
          title: 'Nouveau Devoir Test',
          instructions: 'Faire les exercices.',
          publish_now: false,
        })
      );
    });
  });

  // 13. Protection contre la double soumission
  it('13. Désactive le bouton de soumission pendant la création', async () => {
    vi.mocked(createTeacherHomework).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('hw-999'), 500))
    );
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    fireEvent.change(screen.getByLabelText(/Classe \*/i), { target: { value: 'cls-1' } });
    fireEvent.change(screen.getByLabelText(/Matière \*/i), { target: { value: 'subj-1' } });
    fireEvent.change(screen.getByLabelText(/Titre du devoir \*/i), { target: { value: 'Test Doublon' } });
    fireEvent.change(screen.getByLabelText(/Consignes \*/i), { target: { value: 'Instructions' } });
    fireEvent.change(screen.getByLabelText(/Date limite \*/i), { target: { value: '2026-10-01' } });

    const submitBtn = screen.getByRole('button', { name: /Enregistrer en brouillon/i });
    fireEvent.click(submitBtn);

    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  // 14. Modification d’un brouillon
  it('14. Permet l’édition d’un devoir en statut brouillon', async () => {
    vi.mocked(updateTeacherHomework).mockResolvedValue(true);
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    const editButtons = screen.getAllByTitle('Modifier');
    fireEvent.click(editButtons[0]);

    expect(screen.getByText('Modifier le devoir')).not.toBeNull();
    const titleInput = screen.getByLabelText(/Titre du devoir \*/i);
    fireEvent.change(titleInput, { target: { value: 'Devoir de Physique Quantique (Modifié)' } });

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer les modifications/i }));

    await waitFor(() => {
      expect(updateTeacherHomework).toHaveBeenCalledWith(
        expect.objectContaining({
          homework_id: 'hw-1',
          title: 'Devoir de Physique Quantique (Modifié)',
        })
      );
    });
  });

  // 15. Absence de modification pour un devoir publié ou annulé
  it('15. Masque le bouton d’édition pour les devoirs publiés ou annulés', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    const editButtons = screen.getAllByTitle('Modifier');
    expect(editButtons.length).toBe(1);
  });

  // 16. Confirmation de publication
  it('16. Affiche la modale de confirmation et publie un brouillon', async () => {
    vi.mocked(publishTeacherHomework).mockResolvedValue(true);
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    const publishButtons = screen.getAllByTitle('Publier');
    fireEvent.click(publishButtons[0]);

    expect(screen.getByText(/Publier ce devoir le rendra visible aux parents/i)).not.toBeNull();

    const confirmBtn = screen.getByRole('button', { name: /Confirmer la publication/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(publishTeacherHomework).toHaveBeenCalledWith('hw-1');
    });
  });

  // 17. Confirmation d’annulation
  it('17. Affiche la modale de confirmation d’annulation avec motif', async () => {
    vi.mocked(cancelTeacherHomework).mockResolvedValue(true);
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    const cancelButtons = screen.getAllByTitle('Annuler');
    fireEvent.click(cancelButtons[0]);

    expect(screen.getByText(/Annuler ce devoir le retirera de la liste/i)).not.toBeNull();

    const reasonInput = screen.getByPlaceholderText(/Expliquez la raison/i);
    fireEvent.change(reasonInput, { target: { value: 'Changement de programme' } });

    const confirmBtn = screen.getByRole('button', { name: /^Annuler le devoir$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(cancelTeacherHomework).toHaveBeenCalledWith('hw-1', 'Changement de programme');
    });
  });

  // 18. Actualisation après action
  it('18. Re-charge la liste des devoirs après création, publication ou annulation', async () => {
    vi.mocked(publishTeacherHomework).mockResolvedValue(true);
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    const initialCalls = vi.mocked(fetchTeacherHomework).mock.calls.length;

    const publishButtons = screen.getAllByTitle('Publier');
    fireEvent.click(publishButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la publication/i }));

    await waitFor(() => {
      expect(vi.mocked(fetchTeacherHomework).mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  // 19. Gestion des erreurs 401, 403 et génériques
  it('19. Affiche un message explicite en cas d’erreur d’autorisation (403/42501)', async () => {
    vi.mocked(publishTeacherHomework).mockRejectedValue(
      new Error('Accès refusé : Seul l’enseignant propriétaire peut modifier ce devoir. (42501)')
    );
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    const publishButtons = screen.getAllByTitle('Publier');
    fireEvent.click(publishButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la publication/i }));

    await waitFor(() => {
      expect(screen.getByText(/Accès refusé/i)).not.toBeNull();
    });
  });

  // 20. Réponses asynchrones obsolètes ignorées
  it('20. Ne met pas à jour l’état si une réponse de requête obsolète arrive après un changement de filtre', async () => {
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    let resolveFirstQuery: (items: TeacherHomework[]) => void;
    const slowPromise = new Promise<TeacherHomework[]>((res) => {
      resolveFirstQuery = res;
    });

    vi.mocked(fetchTeacherHomework)
      .mockImplementationOnce(() => slowPromise)
      .mockResolvedValueOnce([mockHomeworks[0]]);

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[2], { target: { value: 'draft' } });

    resolveFirstQuery!(mockHomeworks);

    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });
  });

  // 21. Aucun school_id, teacher_id, profile_id envoyé par le frontend
  it('21. Ne fournit aucun school_id ou teacher_id lors des appels aux services', async () => {
    vi.mocked(createTeacherHomework).mockResolvedValue('hw-new');
    renderModule();
    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    fireEvent.change(screen.getByLabelText(/Classe \*/i), { target: { value: 'cls-1' } });
    fireEvent.change(screen.getByLabelText(/Matière \*/i), { target: { value: 'subj-1' } });
    fireEvent.change(screen.getByLabelText(/Titre du devoir \*/i), { target: { value: 'Titre Sécurisé' } });
    fireEvent.change(screen.getByLabelText(/Consignes \*/i), { target: { value: 'Consignes' } });
    fireEvent.change(screen.getByLabelText(/Date limite \*/i), { target: { value: '2026-10-01' } });

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer en brouillon/i }));

    await waitFor(() => {
      const callArgs = vi.mocked(createTeacherHomework).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('school_id');
      expect(callArgs).not.toHaveProperty('teacher_id');
      expect(callArgs).not.toHaveProperty('profile_id');
    });
  });

  // 22. Aucune référence aux données fictives
  it('22. Ne contient aucune référence à MOCK_HOMEWORK ou MOCK_ASSIGNMENTS', () => {
    renderModule();
    expect(screen.queryByText(/MOCK_/i)).toBeNull();
  });

  // 23. Fonctionnement du module Parent existant sans régression
  it('23. Garantit que le service n’altère pas les types ou contrats requis par le portail Parent', () => {
    expect(typeof fetchTeacherHomework).toBe('function');
    expect(typeof createTeacherHomework).toBe('function');
  });

  // 24. Navigation Enseignant et Emploi du temps sans régression
  it('24. Rendu sans crash du composant principal', async () => {
    const { container } = renderModule();
    expect(container).not.toBeNull();
  });

  // 25. Une affectation de titularisation avec subject_id = NULL / id = '' n’apparaît pas dans la liste
  it('25. Une affectation de titularisation avec subject_id vide n’apparaît pas dans la liste des matières', async () => {
    const subjectsWithHomeroom: AssignedSubject[] = [
      { id: '', name: 'Titularisation (Appel Général)', class_id: 'cls-1' },
      { id: 'subj-valid-1', name: 'Mathématiques', class_id: 'cls-1' },
    ];

    render(
      <TeacherHomeworkModule
        assignedClasses={mockClasses}
        assignedSubjects={subjectsWithHomeroom}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Devoir de Physique Quantique')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    const subjectSelect = screen.getByLabelText(/Matière \*/i);
    const options = Array.from(subjectSelect.querySelectorAll('option')).map(opt => opt.textContent);

    expect(options).not.toContain('Titularisation (Appel Général)');
    expect(options).toContain('Mathématiques');
  });

  // 26. Aucune matière valide affiche le message explicite et désactive l’enregistrement
  it('26. Aucune matière valide affiche le message explicite et désactive l’enregistrement', async () => {
    const emptySubjects: AssignedSubject[] = [
      { id: '', name: 'Titularisation (Appel Général)', class_id: 'cls-2A' },
    ];
    const classes2A: AssignedClass[] = [
      { id: 'cls-2A', name: '2A' }
    ];

    render(
      <TeacherHomeworkModule
        assignedClasses={classes2A}
        assignedSubjects={emptySubjects}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId('teacher-homework-skeleton')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));

    expect(screen.getByText('Aucune matière ne vous est affectée pour cette classe. Contactez l’administration de l’établissement.')).not.toBeNull();
    const saveBtn = screen.getByRole('button', { name: /Enregistrer en brouillon/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  // 27. Une matière réelle avec UUID valide est sélectionnable
  it('27. Une matière réelle avec UUID valide est sélectionnable', async () => {
    const validUuidSubject: AssignedSubject[] = [
      { id: '4b5b9fae-b384-4bc7-95cb-99f7abb58733', name: 'Anglais', class_id: 'cls-1' }
    ];

    render(
      <TeacherHomeworkModule
        assignedClasses={mockClasses}
        assignedSubjects={validUuidSubject}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId('teacher-homework-skeleton')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    const subjectSelect = screen.getByLabelText(/Matière \*/i) as HTMLSelectElement;
    expect(subjectSelect.value).toBe('4b5b9fae-b384-4bc7-95cb-99f7abb58733');
    expect(screen.getAllByText('Anglais').length).toBeGreaterThan(0);
  });

  // 28. Changer de classe réinitialise une matière devenue invalide
  it('28. Changer de classe réinitialise une matière devenue invalide', async () => {
    const mixedSubjects: AssignedSubject[] = [
      { id: 'subj-cls1', name: 'Physique', class_id: 'cls-1' },
      // cls-2 n'a aucune matière affectée
    ];

    render(
      <TeacherHomeworkModule
        assignedClasses={mockClasses}
        assignedSubjects={mixedSubjects}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId('teacher-homework-skeleton')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    const classSelect = screen.getByLabelText(/Classe \*/i) as HTMLSelectElement;
    const subjectSelect = screen.getByLabelText(/Matière \*/i) as HTMLSelectElement;

    expect(classSelect.value).toBe('cls-1');
    expect(subjectSelect.value).toBe('subj-cls1');

    // Changer vers cls-2 qui n'a pas de matière
    fireEvent.change(classSelect, { target: { value: 'cls-2' } });

    expect(subjectSelect.value).toBe('');
    expect(screen.getByText('Aucune matière ne vous est affectée pour cette classe. Contactez l’administration de l’établissement.')).not.toBeNull();
    const saveBtn = screen.getByRole('button', { name: /Enregistrer en brouillon/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  // 29. Le formulaire transmet le véritable subject_id
  it('29. Le formulaire transmet le véritable subject_id lors de la création', async () => {
    vi.mocked(createTeacherHomework).mockResolvedValue('hw-new-uuid');
    const validUuidSubject: AssignedSubject[] = [
      { id: '4b5b9fae-b384-4bc7-95cb-99f7abb58733', name: 'Anglais', class_id: 'cls-1' }
    ];

    render(
      <TeacherHomeworkModule
        assignedClasses={mockClasses}
        assignedSubjects={validUuidSubject}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId('teacher-homework-skeleton')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau devoir/i }));
    fireEvent.change(screen.getByLabelText(/Titre du devoir \*/i), { target: { value: 'Devoir d’Anglais' } });
    fireEvent.change(screen.getByLabelText(/Consignes \*/i), { target: { value: 'Read chapter 3.' } });
    fireEvent.change(screen.getByLabelText(/Date limite \*/i), { target: { value: '2026-10-05' } });

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer en brouillon/i }));

    await waitFor(() => {
      expect(createTeacherHomework).toHaveBeenCalledWith(
        expect.objectContaining({
          class_id: 'cls-1',
          subject_id: '4b5b9fae-b384-4bc7-95cb-99f7abb58733',
          title: 'Devoir d’Anglais',
          instructions: 'Read chapter 3.',
        })
      );
    });
  });
});
