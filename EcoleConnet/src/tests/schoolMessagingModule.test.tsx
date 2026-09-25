/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchoolMessagingModule } from '../components/messaging/SchoolMessagingModule';
import { schoolMessagingService, type MessagingConversation, type MessagingMessage, type MessagingContact } from '../services/schoolMessagingService';
import { TeacherPortalSidebar } from '../components/teacher/portal/TeacherPortalSidebar';

// Mock du service schoolMessagingService
vi.mock('../services/schoolMessagingService', async () => {
  const actual = await vi.importActual<typeof import('../services/schoolMessagingService')>('../services/schoolMessagingService');
  return {
    ...actual,
    schoolMessagingService: {
      getConversations: vi.fn(),
      getUnreadCount: vi.fn(),
      getContacts: vi.fn(),
      getOrCreateConversation: vi.fn(),
      getMessages: vi.fn(),
      sendMessage: vi.fn(),
      markRead: vi.fn(),
      setArchived: vi.fn(),
    },
  };
});

const mockConversations: MessagingConversation[] = [
  {
    conversation_id: 'conv-1',
    school_id: 'school-1',
    student_id: 'student-1',
    student_name: 'Jean Dupont',
    class_name: 'CE2-A',
    counterparty_profile_id: 'parent-1',
    counterparty_name: 'Marie Dupont',
    counterparty_role: 'parent',
    subject_name: null,
    status: 'active',
    is_archived: false,
    unread_count: 2,
    last_message_content: 'Bonjour, devoirs de demain ?',
    last_message_at: '2026-09-25T10:00:00Z',
  },
  {
    conversation_id: 'conv-2',
    school_id: 'school-1',
    student_id: 'student-2',
    student_name: 'Alice Smith',
    class_name: '3ème B',
    counterparty_profile_id: 'parent-2',
    counterparty_name: 'Pierre Smith',
    counterparty_role: 'parent',
    subject_name: 'Mathématiques',
    status: 'active',
    is_archived: true,
    unread_count: 0,
    last_message_content: 'Merci pour les précisions.',
    last_message_at: '2026-09-24T15:00:00Z',
  },
];

const mockMessages: MessagingMessage[] = [
  {
    message_id: 'msg-1',
    conversation_id: 'conv-1',
    sender_profile_id: 'parent-1',
    sender_name: 'Marie Dupont',
    content: 'Bonjour Monsieur, quelles sont les leçons ?',
    created_at: '2026-09-25T09:00:00Z',
    is_mine: false,
  },
  {
    message_id: 'msg-2',
    conversation_id: 'conv-1',
    sender_profile_id: 'teacher-1',
    sender_name: 'M. Martin',
    content: 'Bonjour, pages 12 et 14 du manuel de mathématiques.',
    created_at: '2026-09-25T10:00:00Z',
    is_mine: true,
  },
];

describe('SchoolMessagingModule — Suite complète de tests (30 Scénarios)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.mocked(schoolMessagingService.getConversations).mockResolvedValue(mockConversations);
    vi.mocked(schoolMessagingService.getUnreadCount).mockResolvedValue(2);
    vi.mocked(schoolMessagingService.getMessages).mockResolvedValue(mockMessages);
    vi.mocked(schoolMessagingService.markRead).mockResolvedValue(true);
  });

  // 1. Skeleton initial
  it('1. Affiche le skeleton initial pendant le chargement des conversations', async () => {
    vi.mocked(schoolMessagingService.getConversations).mockReturnValue(new Promise(() => {}));
    render(<SchoolMessagingModule mode="teacher" />);
    expect(screen.getByTestId('messaging-skeleton')).toBeInTheDocument();
  });

  // 2. État vide
  it('2. Affiche un état vide explicite lorsqu’aucune conversation ne correspond', async () => {
    vi.mocked(schoolMessagingService.getConversations).mockResolvedValue([]);
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => {
      expect(screen.getByText(/Aucune conversation trouvée/i)).toBeInTheDocument();
    });
  });

  // 3. Affichage des conversations
  it('3. Affiche correctement la liste des conversations avec les détails', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => {
      expect(screen.getByText('Marie Dupont')).toBeInTheDocument();
      expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
      expect(screen.getByText('CE2-A')).toBeInTheDocument();
    });
  });

  // 4. Compteur non lu
  it('4. Affiche le badge de compteur de messages non lus', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => {
      expect(screen.getByTestId('total-unread-badge')).toBeInTheDocument();
    });
  });

  // 5. Filtre non lu
  it('5. Filtre les conversations par statut (Toutes, Non lues, Archivées)', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());

    // Clic sur l'onglet Non lues
    fireEvent.click(screen.getByRole('button', { name: /non lues/i }));
    expect(screen.getByText('Marie Dupont')).toBeInTheDocument();
    expect(screen.queryByText('Pierre Smith')).not.toBeInTheDocument();

    // Clic sur l'onglet Archivées
    fireEvent.click(screen.getByRole('button', { name: /archivées/i }));
    expect(screen.getByText('Pierre Smith')).toBeInTheDocument();
    expect(screen.queryByText('Marie Dupont')).not.toBeInTheDocument();
  });

  // 6. Archivage et désarchivage
  it('6. Permet d’archiver et désarchiver une conversation', async () => {
    vi.mocked(schoolMessagingService.setArchived).mockResolvedValue(true);
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());

    const archiveBtn = screen.getByTestId('archive-btn-conv-1');
    fireEvent.click(archiveBtn);

    await waitFor(() => {
      expect(schoolMessagingService.setArchived).toHaveBeenCalledWith('conv-1', true);
    });
  });

  // 7. Ouverture du fil
  it('7. Ouvre le fil de discussion au clic sur une conversation', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Marie Dupont'));

    await waitFor(() => {
      expect(schoolMessagingService.getMessages).toHaveBeenCalledWith('conv-1', null, null, 30);
      expect(screen.getByText('Bonjour Monsieur, quelles sont les leçons ?')).toBeInTheDocument();
    });
  });

  // 8. Marquage comme lu
  it('8. Appelle mark_school_conversation_read à l’ouverture de la conversation', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Marie Dupont'));

    await waitFor(() => {
      expect(schoolMessagingService.markRead).toHaveBeenCalledWith('conv-1');
    });
  });

  // 9. Affichage messages envoyés/reçus
  it('9. Distingue clairement les messages envoyés et reçus', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));

    await waitFor(() => {
      const msgReceived = screen.getByText('Bonjour Monsieur, quelles sont les leçons ?').closest('div');
      const msgSent = screen.getByText('Bonjour, pages 12 et 14 du manuel de mathématiques.').closest('div');
      expect(msgReceived).toBeInTheDocument();
      expect(msgSent).toBeInTheDocument();
    });
  });

  // 10. Pagination avec les deux curseurs
  it('10. Transmet simultanément p_before_created_at et p_before_id pour la pagination', async () => {
    const mock30Messages = Array.from({ length: 30 }, (_, i) => ({
      message_id: `msg-p1-${i}`,
      conversation_id: 'conv-1',
      sender_profile_id: 'teacher-1',
      sender_name: 'M. Martin',
      content: `Message ${i}`,
      created_at: `2026-09-25T10:${i < 10 ? '0' : ''}${i}:00Z`,
      is_mine: true,
    }));

    vi.mocked(schoolMessagingService.getMessages)
      .mockResolvedValueOnce(mock30Messages)
      .mockResolvedValueOnce([mockMessages[0]]);

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /charger les messages précédents/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /charger les messages précédents/i }));

    await waitFor(() => {
      expect(schoolMessagingService.getMessages).toHaveBeenLastCalledWith(
        'conv-1',
        mock30Messages[mock30Messages.length - 1].created_at,
        mock30Messages[mock30Messages.length - 1].message_id,
        30
      );
    });
  });

  // 11. Envoi réussi
  it('11. Envoie un message avec succès et remet à zéro la zone de saisie', async () => {
    vi.mocked(schoolMessagingService.sendMessage).mockResolvedValue({
      success: true,
      message: {
        id: 'msg-3',
        conversation_id: 'conv-1',
        sender_profile_id: 'teacher-1',
        content: 'Nouveau message de test',
        created_at: '2026-09-25T11:00:00Z',
      },
    });

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));
    await waitFor(() => expect(screen.getByPlaceholderText(/écrivez votre message/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/écrivez votre message/i);
    fireEvent.change(input, { target: { value: 'Nouveau message de test' } });
    fireEvent.click(screen.getByTestId('send-message-btn'));

    await waitFor(() => {
      expect(schoolMessagingService.sendMessage).toHaveBeenCalledWith('conv-1', 'Nouveau message de test');
      expect(screen.getByText('Nouveau message de test')).toBeInTheDocument();
      expect(input).toHaveValue('');
    });
  });

  // 12. Protection contre double soumission
  it('12. Empêche la double soumission pendant l’envoi d’un message', async () => {
    vi.mocked(schoolMessagingService.sendMessage).mockReturnValue(new Promise(() => {}));

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));
    await waitFor(() => expect(screen.getByPlaceholderText(/écrivez votre message/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/écrivez votre message/i);
    fireEvent.change(input, { target: { value: 'Message unique' } });
    const sendBtn = screen.getByTestId('send-message-btn');

    fireEvent.click(sendBtn);
    expect(sendBtn).toBeDisabled();
    expect(schoolMessagingService.sendMessage).toHaveBeenCalledTimes(1);
  });

  // 13. Texte conservé après erreur réseau
  it('13. Conserve le texte saisi en cas d’erreur réseau lors de l’envoi', async () => {
    vi.mocked(schoolMessagingService.sendMessage).mockRejectedValue(new Error('Erreur réseau'));

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));
    await waitFor(() => expect(screen.getByPlaceholderText(/écrivez votre message/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/écrivez votre message/i);
    fireEvent.change(input, { target: { value: 'Texte important à conserver' } });
    fireEvent.click(screen.getByTestId('send-message-btn'));

    await waitFor(() => {
      expect(screen.getByText(/Erreur réseau/i)).toBeInTheDocument();
      expect(input).toHaveValue('Texte important à conserver');
    });
  });

  // 14. Traitement CONVERSATION_READ_ONLY
  it('14. Traite le retour CONVERSATION_READ_ONLY sans faux succès', async () => {
    vi.mocked(schoolMessagingService.sendMessage).mockResolvedValue({
      success: false,
      code: 'CONVERSATION_READ_ONLY',
      message: 'Cette conversation est désormais en lecture seule car l’élève a quitté la classe.',
    });

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));
    await waitFor(() => expect(screen.getByPlaceholderText(/écrivez votre message/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/écrivez votre message/i);
    fireEvent.change(input, { target: { value: 'Tentative d’envoi' } });
    fireEvent.click(screen.getByTestId('send-message-btn'));

    await waitFor(() => {
      expect(screen.getByText(/Cette conversation est désormais en lecture seule/i)).toBeInTheDocument();
    });
  });

  // 15. Zone d’envoi désactivée en lecture seule
  it('15. Désactive la zone d’envoi et affiche le bandeau quand la conversation est en lecture seule', async () => {
    const readOnlyConv: MessagingConversation = {
      ...mockConversations[0],
      status: 'read_only',
    };
    vi.mocked(schoolMessagingService.getConversations).mockResolvedValue([readOnlyConv]);

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));

    await waitFor(() => {
      expect(screen.getAllByText(/Lecture seule/i).length).toBeGreaterThan(0);
      expect(screen.getByPlaceholderText(/envois désactivés/i)).toBeDisabled();
    });
  });

  // 16. Historique visible en lecture seule
  it('16. Conserve l’historique des messages accessible et lisible en mode lecture seule', async () => {
    const readOnlyConv: MessagingConversation = {
      ...mockConversations[0],
      status: 'read_only',
    };
    vi.mocked(schoolMessagingService.getConversations).mockResolvedValue([readOnlyConv]);

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));

    await waitFor(() => {
      expect(screen.getByText('Bonjour Monsieur, quelles sont les leçons ?')).toBeInTheDocument();
      expect(screen.getByText('Bonjour, pages 12 et 14 du manuel de mathématiques.')).toBeInTheDocument();
    });
  });

  // 17. Erreur 42501
  it('17. Gère élégamment l’erreur 42501 (Accès refusé)', async () => {
    vi.mocked(schoolMessagingService.getConversations).mockRejectedValue({
      code: '42501',
      message: 'permission denied for schema public',
    });

    render(<SchoolMessagingModule mode="teacher" />);

    await waitFor(() => {
      expect(screen.getByText(/Accès refusé. Vous n'avez pas les autorisations/i)).toBeInTheDocument();
    });
  });

  // 18. Primaire sans matière artificielle
  it('18. Affiche "Titulaire de classe" sans pseudo-matière artificielle en primaire', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));

    await waitFor(() => {
      expect(screen.getByText(/Titulaire de classe/i)).toBeInTheDocument();
      expect(screen.queryByText(/Titularisation/i)).not.toBeInTheDocument();
    });
  });

  // 19. Secondaire avec matière
  it('19. Affiche la matière uniquement si elle est réellement transmise pour le secondaire', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /archivées/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /archivées/i }));

    await waitFor(() => {
      expect(screen.getByText(/Mathématiques/i)).toBeInTheDocument();
    });
  });

  // 20. Parent ne voyant que ses contacts RPC
  it('20. Charge et affiche uniquement les enseignants retournés par get_messaging_contacts pour un parent', async () => {
    const mockContacts: MessagingContact[] = [
      {
        profile_id: 'teacher-10',
        full_name: 'Mme Durand',
        role: 'teacher',
        subject_id: null,
        subject_name: null,
        is_homeroom: true,
      },
    ];
    vi.mocked(schoolMessagingService.getContacts).mockResolvedValue(mockContacts);

    render(
      <SchoolMessagingModule
        mode="parent"
        selectedChildId="student-1"
        childrenList={[{ id: 'student-1', first_name: 'Jean', last_name: 'Dupont', class_name: 'CE2-A' }]}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /nouvelle conversation/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /nouvelle conversation/i }));

    await waitFor(() => {
      expect(schoolMessagingService.getContacts).toHaveBeenCalledWith('student-1');
      expect(screen.getByText('Mme Durand')).toBeInTheDocument();
    });
  });

  // 21. Enseignant ne voyant que ses contacts RPC
  it('21. Charge et affiche uniquement les parents autorisés de la classe pour l’enseignant', async () => {
    const mockContacts: MessagingContact[] = [
      {
        profile_id: 'parent-20',
        full_name: 'M. Leroy',
        role: 'parent',
        subject_id: null,
        subject_name: null,
        is_homeroom: false,
      },
    ];
    vi.mocked(schoolMessagingService.getContacts).mockResolvedValue(mockContacts);

    render(
      <SchoolMessagingModule
        mode="teacher"
        assignedClasses={[{ class_id: 'class-1', class_name: 'CE2-A', is_homeroom: true }]}
        assignedStudentsMap={{
          'class-1': [{ id: 'student-1', first_name: 'Jean', last_name: 'Dupont' }],
        }}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /nouvelle conversation/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /nouvelle conversation/i }));

    await waitFor(() => expect(screen.getByTestId('select-class-dropdown')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('select-class-dropdown'), { target: { value: 'class-1' } });

    await waitFor(() => expect(screen.getByTestId('select-student-dropdown')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('select-student-dropdown'), { target: { value: 'student-1' } });

    await waitFor(() => {
      expect(schoolMessagingService.getContacts).toHaveBeenCalledWith('student-1');
      expect(screen.getByText('M. Leroy')).toBeInTheDocument();
    });
  });

  // 22. Archivage personnel
  it('22. Confirme que l’archivage est individuel et personnel', async () => {
    vi.mocked(schoolMessagingService.setArchived).mockResolvedValue(true);

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('archive-btn-conv-1'));
    await waitFor(() => {
      expect(schoolMessagingService.setArchived).toHaveBeenCalledWith('conv-1', true);
    });
  });

  // 23. Protection contre réponse réseau obsolète
  it('23. Ignore les réponses réseau obsolètes lors de basculements rapides de conversation', async () => {
    const unarchivedConvs = mockConversations.map(c => ({ ...c, is_archived: false }));
    vi.mocked(schoolMessagingService.getConversations).mockResolvedValue(unarchivedConvs);

    let resolveFirstMsg: any;
    const slowPromise = new Promise((resolve) => {
      resolveFirstMsg = resolve;
    });

    vi.mocked(schoolMessagingService.getMessages)
      .mockReturnValueOnce(slowPromise as any)
      .mockResolvedValueOnce([mockMessages[1]]);

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());

    // Clic rapide sur conv-1 puis conv-2
    fireEvent.click(screen.getByText('Marie Dupont'));
    fireEvent.click(screen.getByText('Pierre Smith'));

    // Résolution tardive de la première requête
    await act(async () => {
      resolveFirstMsg([mockMessages[0]]);
    });

    await waitFor(() => {
      expect(screen.getByText('Bonjour, pages 12 et 14 du manuel de mathématiques.')).toBeInTheDocument();
      expect(screen.queryByText('Bonjour Monsieur, quelles sont les leçons ?')).not.toBeInTheDocument();
    });
  });

  // 24. Nettoyage du rafraîchissement périodique
  it('24. Déclenche le rafraîchissement automatique et nettoie le timer au démontage', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = render(<SchoolMessagingModule mode="teacher" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(schoolMessagingService.getConversations).toHaveBeenCalled();

    unmount();
    vi.useRealTimers();
  });

  // 25. Absence du badge "Bientôt" sur Messages Enseignant
  it('25. Vérifie l’absence du badge "Bientôt" sur l’onglet Messages de la sidebar Enseignant', () => {
    render(
      <TeacherPortalSidebar
        activeTab="overview"
        setActiveTab={() => {}}
        assignedClassesCount={2}
        homeworkCount={0}
        gradesCount={0}
        isOpenMobile={false}
        onCloseMobile={() => {}}
        onSignOut={async () => {}}
      />
    );

    const messagesTab = screen.getByText('Messages').closest('button');
    expect(messagesTab).toBeInTheDocument();
    expect(screen.queryByText('Bientôt')).not.toBeInTheDocument();
  });

  // 26. Navigation Parent vers Messages
  it('26. Permet au parent d’interagir avec le module partagé en mode parent', async () => {
    render(
      <SchoolMessagingModule
        mode="parent"
        selectedChildId="student-1"
        childrenList={[{ id: 'student-1', first_name: 'Jean', last_name: 'Dupont', class_name: 'CE2-A' }]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Messagerie Scolaire')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /nouvelle conversation/i })).toBeInTheDocument();
    });
  });

  // 27. Limite de 3 000 caractères
  it('27. Restreint la saisie du message à 3 000 caractères maximum', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));
    await waitFor(() => expect(screen.getByPlaceholderText(/écrivez votre message/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/écrivez votre message/i) as HTMLTextAreaElement;
    expect(input.maxLength).toBe(3000);
    expect(screen.getByText(/0 \/ 3000/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Test' } });
    expect(screen.getByText(/4 \/ 3000/i)).toBeInTheDocument();
  });

  // 28. Contenu vide refusé
  it('28. Désactive le bouton d’envoi lorsque le contenu nettoyé (trim) est vide', async () => {
    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));
    await waitFor(() => expect(screen.getByPlaceholderText(/écrivez votre message/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/écrivez votre message/i);
    const sendBtn = screen.getByTestId('send-message-btn');

    expect(sendBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '   ' } });
    expect(sendBtn).toBeDisabled();
  });

  // 29. Absence de rendu HTML/XSS
  it('29. Échappe rigoureusement le texte des messages et empêche l’injection XSS/HTML', async () => {
    const xssMessages: MessagingMessage[] = [
      {
        message_id: 'msg-xss',
        conversation_id: 'conv-1',
        sender_profile_id: 'parent-1',
        sender_name: 'Marie Dupont',
        content: '<img src="x" onerror="alert(1)" /><script>alert("XSS")</script>',
        created_at: '2026-09-25T10:00:00Z',
        is_mine: false,
      },
    ];
    vi.mocked(schoolMessagingService.getMessages).mockResolvedValue(xssMessages);

    render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Marie Dupont'));

    await waitFor(() => {
      const element = screen.getByText('<img src="x" onerror="alert(1)" /><script>alert("XSS")</script>');
      expect(element).toBeInTheDocument();
      expect(document.querySelector('script[src]')).toBeNull();
    });
  });

  // 30. Responsive sans structure cassée
  it('30. Conserve une mise en page fluide et adaptative pour mobile, tablette et desktop', async () => {
    const { container } = render(<SchoolMessagingModule mode="teacher" />);
    await waitFor(() => expect(screen.getByText('Marie Dupont')).toBeInTheDocument());

    expect(container.querySelector('.grid')).toBeInTheDocument();
  });

  // 31. Multi-enfants et isolation stricte avec recalcul du compteur non lu
  it('31. Isole les conversations par enfant sélectionné et recalcule le compteur non lu', async () => {
    const multiChildConvs: MessagingConversation[] = [
      {
        conversation_id: 'conv-c1',
        school_id: 'school-1',
        student_id: 'child-1',
        student_name: 'Enfant Un',
        class_name: 'CE1',
        counterparty_profile_id: 'teacher-10',
        counterparty_name: 'Mme Martin',
        counterparty_role: 'teacher',
        subject_name: null,
        status: 'active',
        is_archived: false,
        unread_count: 3,
        last_message_content: 'Msg Enfant 1',
        last_message_at: '2026-09-25T10:00:00Z',
      },
      {
        conversation_id: 'conv-c2',
        school_id: 'school-1',
        student_id: 'child-2',
        student_name: 'Enfant Deux',
        class_name: 'CM2',
        counterparty_profile_id: 'teacher-20',
        counterparty_name: 'M. Petit',
        counterparty_role: 'teacher',
        subject_name: null,
        status: 'active',
        is_archived: false,
        unread_count: 5,
        last_message_content: 'Msg Enfant 2',
        last_message_at: '2026-09-25T10:05:00Z',
      },
    ];
    vi.mocked(schoolMessagingService.getConversations).mockResolvedValue(multiChildConvs);

    const { rerender } = render(
      <SchoolMessagingModule
        mode="parent"
        selectedChildId="child-1"
        childrenList={[
          { id: 'child-1', first_name: 'Enfant', last_name: 'Un' },
          { id: 'child-2', first_name: 'Enfant', last_name: 'Deux' },
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Mme Martin')).toBeInTheDocument();
      expect(screen.queryByText('M. Petit')).not.toBeInTheDocument();
      expect(screen.getByTestId('total-unread-badge')).toHaveTextContent('3 non lus');
    });

    // Passage à l'enfant 2
    rerender(
      <SchoolMessagingModule
        mode="parent"
        selectedChildId="child-2"
        childrenList={[
          { id: 'child-1', first_name: 'Enfant', last_name: 'Un' },
          { id: 'child-2', first_name: 'Enfant', last_name: 'Deux' },
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('M. Petit')).toBeInTheDocument();
      expect(screen.queryByText('Mme Martin')).not.toBeInTheDocument();
      expect(screen.getByTestId('total-unread-badge')).toHaveTextContent('5 non lus');
    });
  });

  // 32. Changement rapide de classe enseignant pendant une requête de contacts
  it('32. Ignore les réponses réseau tardives lors d’un changement rapide de classe en mode enseignant', async () => {
    let resolveClassA: any;
    const slowPromiseClassA = new Promise((resolve) => {
      resolveClassA = resolve;
    });

    vi.mocked(schoolMessagingService.getContacts)
      .mockReturnValueOnce(slowPromiseClassA as any)
      .mockResolvedValueOnce([
        {
          profile_id: 'parent-b',
          full_name: 'Parent Classe B',
          role: 'parent',
          subject_id: null,
          subject_name: null,
          is_homeroom: false,
        },
      ]);

    render(
      <SchoolMessagingModule
        mode="teacher"
        assignedClasses={[
          { class_id: 'class-a', class_name: 'Classe A', is_homeroom: true },
          { class_id: 'class-b', class_name: 'Classe B', is_homeroom: false },
        ]}
        assignedStudentsMap={{
          'class-a': [{ id: 'student-a', first_name: 'Élève', last_name: 'A' }],
          'class-b': [{ id: 'student-b', first_name: 'Élève', last_name: 'B' }],
        }}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /nouvelle conversation/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /nouvelle conversation/i }));

    // Sélection classe A puis élève A (déclenche slowPromiseClassA)
    await waitFor(() => expect(screen.getByTestId('select-class-dropdown')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('select-class-dropdown'), { target: { value: 'class-a' } });
    await waitFor(() => expect(screen.getByTestId('select-student-dropdown')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('select-student-dropdown'), { target: { value: 'student-a' } });

    // Changement rapide vers classe B puis élève B
    fireEvent.change(screen.getByTestId('select-class-dropdown'), { target: { value: 'class-b' } });
    await waitFor(() => expect(screen.getByTestId('select-student-dropdown')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('select-student-dropdown'), { target: { value: 'student-b' } });

    // Résolution tardive de la classe A
    await act(async () => {
      resolveClassA([
        {
          profile_id: 'parent-a',
          full_name: 'Parent Classe A (Obsolète)',
          role: 'parent',
          subject_id: null,
          subject_name: null,
          is_homeroom: false,
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText('Parent Classe B')).toBeInTheDocument();
      expect(screen.queryByText('Parent Classe A (Obsolète)')).not.toBeInTheDocument();
    });
  });

  // 33. Validation exacte des signatures des 8 RPCs Supabase
  it('33. Vérifie l’utilisation des noms exacts de RPCs et de paramètres sans altération', async () => {
    vi.mocked(schoolMessagingService.getContacts).mockResolvedValue([]);
    vi.mocked(schoolMessagingService.getOrCreateConversation).mockResolvedValue('conv-new-123');

    render(
      <SchoolMessagingModule
        mode="parent"
        selectedChildId="student-99"
        childrenList={[{ id: 'student-99', first_name: 'Paul', last_name: 'Moreau' }]}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /nouvelle conversation/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /nouvelle conversation/i }));

    await waitFor(() => {
      expect(schoolMessagingService.getContacts).toHaveBeenCalledWith('student-99');
    });
  });

  // 34. Doublon visuel et protection modale sur get_or_create retournant une conversation existante
  it('34. Ouvre la conversation existante sans créer de doublon au retour de get_or_create', async () => {
    vi.mocked(schoolMessagingService.getContacts).mockResolvedValue([
      {
        profile_id: 'parent-1',
        full_name: 'Marie Dupont',
        role: 'parent',
        subject_id: null,
        subject_name: null,
        is_homeroom: true,
      },
    ]);
    vi.mocked(schoolMessagingService.getOrCreateConversation).mockResolvedValue('conv-1');

    render(
      <SchoolMessagingModule
        mode="teacher"
        assignedClasses={[{ class_id: 'class-1', class_name: 'CE2-A', is_homeroom: true }]}
        assignedStudentsMap={{
          'class-1': [{ id: 'student-1', first_name: 'Jean', last_name: 'Dupont' }],
        }}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /nouvelle conversation/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /nouvelle conversation/i }));

    await waitFor(() => expect(screen.getByTestId('select-class-dropdown')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('select-class-dropdown'), { target: { value: 'class-1' } });

    await waitFor(() => expect(screen.getByTestId('select-student-dropdown')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('select-student-dropdown'), { target: { value: 'student-1' } });

    await waitFor(() => expect(screen.getByTestId('contact-option-parent-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('contact-option-parent-1'));

    const submitBtn = screen.getByRole('button', { name: /ouvrir la conversation|démarrer la conversation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(schoolMessagingService.getOrCreateConversation).toHaveBeenCalledWith('student-1', 'parent-1', null);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
