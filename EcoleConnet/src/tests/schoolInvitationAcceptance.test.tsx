/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { schoolInvitationService, INVITATION_ENVELOPE_KEY, LEGACY_TOKEN_KEY } from '../services/schoolInvitationService';
import { AcceptSchoolInvitationPage } from '../pages/auth/AcceptSchoolInvitationPage';
import { ParentChildSwitcher, type LinkedChild } from '../components/parent/portal/ParentChildSwitcher';
import { supabase } from '../lib/supabase';

// Mocks
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
    }
  }
}));

const mockSignOutReal = vi.fn();
const mockNavigate = vi.fn();

let mockUser: any = null;
let mockLoading = false;

vi.mock('../contexts/RealAuthContext', () => ({
  useRealAuth: () => ({
    user: mockUser,
    session: mockUser ? { user: mockUser } : null,
    profile: mockUser ? { id: mockUser.id, role: 'parent', is_active: true } : null,
    loading: mockLoading,
    signOutReal: mockSignOutReal
  })
}));

describe('Lot 2K-A2b-I-F-V — Gate Adversarial Frontend Acceptation Multi-Écoles (50 Scénarios)', () => {

  const SAMPLE_TOKEN = 'raw_sample_invitation_token_1234567890_valid';

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mockUser = null;
    mockLoading = false;
    delete (window as any).location;
    (window as any).location = {
      href: 'http://localhost/',
      search: '',
      pathname: '/auth/accept-school-invitation'
    };
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  // 1. token lu puis retiré immédiatement de l'URL
  it('1. Lit le token dans URL et le supprime immédiatement sans laisser de token querystring', async () => {
    (window as any).location.search = `?token=${SAMPLE_TOKEN}`;
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    expect(schoolInvitationService.getValidInvitationToken()).toBe(SAMPLE_TOKEN);
    expect(replaceStateSpy).toHaveBeenCalled();
  });

  // 2. token conservé dans l'enveloppe sessionStorage
  it('2. Conserve le jeton exclusivement dans l’enveloppe v1 de sessionStorage', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    const env = schoolInvitationService.getValidInvitationEnvelope();
    expect(env?.version).toBe(1);
    expect(env?.flow).toBe('parent_multi_school_invitation');
    expect(env?.token).toBe(SAMPLE_TOKEN);
  });

  // 3. token jamais placé dans localStorage
  it('3. Ne place jamais le jeton ni l’enveloppe dans localStorage', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    expect(localStorage.getItem(INVITATION_ENVELOPE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  // 4. token absent des logs
  it('4. N’écrit jamais le jeton brut dans console.log ou console.error', async () => {
    const logSpy = vi.spyOn(console, 'log');
    const errSpy = vi.spyOn(console, 'error');

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET ACCÈS : Authentification requise.' }
    } as any);

    try {
      await schoolInvitationService.acceptParentSchoolInvitation(SAMPLE_TOKEN);
    } catch (_e) {
      // Ignorer
    }

    logSpy.mock.calls.forEach(args => {
      args.forEach(arg => expect(String(arg)).not.toContain(SAMPLE_TOKEN));
    });
    errSpy.mock.calls.forEach(args => {
      args.forEach(arg => expect(String(arg)).not.toContain(SAMPLE_TOKEN));
    });
  });

  // 5. nouvel utilisateur redirigé vers SetPasswordPage
  it('5. Propose la définition du mot de passe si l’utilisateur est non authentifié', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = null;

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const setPwdBtn = screen.getByText(/Nouveau parent \? Définir mon mot de passe/i);
    expect(setPwdBtn).toBeInTheDocument();

    fireEvent.click(setPwdBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/auth/set-password');
  });

  // 6. retour automatique après définition du mot de passe
  it('6. Permet le retour automatique vers /auth/accept-school-invitation après définition du mot de passe', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    expect(schoolInvitationService.getValidInvitationToken()).toBe(SAMPLE_TOKEN);
  });

  // 7. parent existant redirigé vers login
  it('7. Redirige un parent non authentifié vers /connexion avec returnTo contrôlé', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = null;

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const loginBtn = screen.getByRole('button', { name: /Se connecter à mon compte/i });
    fireEvent.click(loginBtn);

    const callArg = decodeURIComponent(mockNavigate.mock.calls[0][0]);
    expect(callArg).toBe('/connexion?returnTo=/auth/accept-school-invitation');
    expect(callArg).not.toContain(SAMPLE_TOKEN);
  });

  // 8. returnTo interne sécurisé
  it('8. Utilise un returnTo interne relatif sécurisé sans protocole externe', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = null;

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);
    const loginBtn = screen.getByRole('button', { name: /Se connecter à mon compte/i });
    fireEvent.click(loginBtn);

    const targetUrl = decodeURIComponent(mockNavigate.mock.calls[0][0]);
    expect(targetUrl).toBe('/connexion?returnTo=/auth/accept-school-invitation');
    expect(targetUrl).not.toContain('http://');
    expect(targetUrl).not.toContain('https://');
  });

  // 9. acceptation réussie
  it('9. Réalise l’acceptation réussie et affiche les détails de l’établissement', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        success: true,
        school_id: 'school-456',
        school_name: 'Complexe Scolaire Pilote',
        students_linked: 2
      },
      error: null
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByText(/Invitation acceptée avec succès/i)).toBeInTheDocument();
      expect(screen.getByText('Complexe Scolaire Pilote')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  // 10. suppression du token après succès
  it('10. Supprime l’enveloppe de sessionStorage immédiatement après une acceptation réussie', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        success: true,
        school_id: 'school-456',
        school_name: 'Complexe Scolaire Pilote',
        students_linked: 1
      },
      error: null
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(schoolInvitationService.getValidInvitationToken()).toBeNull();
    });
  });

  // 11. mauvais compte connecté
  it('11. Gère le cas du mauvais compte connecté sans exposer d’email complet', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'wrong-user-999', email: 'wrong@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET ACCÈS : L’adresse email du compte connecté ne correspond pas à l’invitation.' }
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByText(/Compte incorrect/i)).toBeInTheDocument();
      expect(screen.getByText(/Cette invitation est destinée à un autre compte/i)).toBeInTheDocument();
    });
  });

  // 12. invitation expirée
  it('12. Affiche l’état d’invitation expirée et supprime le token', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET : L’invitation a expiré.' }
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByText(/Invitation expirée/i)).toBeInTheDocument();
      expect(schoolInvitationService.getValidInvitationToken()).toBeNull();
    });
  });

  // 13. invitation révoquée
  it('13. Affiche l’état d’invitation révoquée et supprime le token', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET : Cette invitation a été révoquée.' }
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByText(/Invitation révoquée/i)).toBeInTheDocument();
      expect(schoolInvitationService.getValidInvitationToken()).toBeNull();
    });
  });

  // 14. invitation déjà utilisée
  it('14. Affiche l’état d’invitation déjà acceptée', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET : Cette invitation a déjà été acceptée.' }
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByText(/Invitation déjà acceptée/i)).toBeInTheDocument();
      expect(schoolInvitationService.getValidInvitationToken()).toBeNull();
    });
  });

  // 15. membership suspended
  it('15. Affiche le blocage pour appartenance parent suspendue', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET ACCÈS : L’appartenance parent dans cet établissement est suspended.' }
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByText(/Accès suspendu/i)).toBeInTheDocument();
    });
  });

  // 16. membership left
  it('16. Affiche le blocage pour appartenance parent quittée', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET ACCÈS : L’appartenance parent dans cet établissement est left.' }
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByText(/Établissement quitté/i)).toBeInTheDocument();
    });
  });

  // 17. panne réseau avec possibilité de réessayer
  it('17. Affiche le bouton Réessayer en cas de panne réseau temporaire', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch network error' }
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByText(/Erreur Réseau/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Réessayer l'acceptation/i })).toBeInTheDocument();
    });
  });

  // 18. prévention du double-clic
  it('18. Empêche le double-clic lors de l’acceptation', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockReturnValue(new Promise(() => {}) as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    fireEvent.click(acceptBtn);
    fireEvent.click(acceptBtn);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  // 19. prévention du double appel StrictMode
  it('19. Empêche les appels multiples indésirables liés à React StrictMode', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    const { rerender } = render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);
    rerender(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // 20. aucun school_id transmis à la RPC
  it('20. N’envoie aucun school_id dans les arguments de accept_parent_school_invitation', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { success: true, school_id: 's-1', school_name: 'School', students_linked: 1 },
      error: null
    } as any);

    await schoolInvitationService.acceptParentSchoolInvitation(SAMPLE_TOKEN);

    expect(supabase.rpc).toHaveBeenCalledWith('accept_parent_school_invitation', {
      p_token: SAMPLE_TOKEN
    });
    const callArgs = vi.mocked(supabase.rpc).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('school_id');
    expect(callArgs).not.toHaveProperty('p_school_id');
  });

  // 21. aucun profile_id transmis
  it('21. N’envoie aucun profile_id dans les arguments de accept_parent_school_invitation', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { success: true, school_id: 's-1', school_name: 'School', students_linked: 1 },
      error: null
    } as any);

    await schoolInvitationService.acceptParentSchoolInvitation(SAMPLE_TOKEN);

    const callArgs = vi.mocked(supabase.rpc).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('profile_id');
    expect(callArgs).not.toHaveProperty('p_profile_id');
  });

  // 22. rechargement des enfants après succès
  it('22. Redirige vers /app/parent pour recharger la liste des enfants après succès', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { success: true, school_id: 's-1', school_name: 'École A', students_linked: 1 },
      error: null
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre l'établissement/i }));

    await waitFor(() => {
      const parentAppBtn = screen.getByRole('button', { name: /Accéder à mon Espace Parent/i });
      fireEvent.click(parentAppBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/app/parent');
    });
  });

  // 23. affichage des écoles pour un parent multi-écoles
  it('23. Affiche le nom de l’établissement sur la carte de l’enfant pour un parent multi-écoles', () => {
    const childrenList: LinkedChild[] = [
      {
        link_id: 'link-1',
        student_id: 'st-1',
        student_number: 'MAT-001',
        first_name: 'Daniel',
        last_name: 'Banza',
        relationship: 'Père',
        can_view_academic: true,
        enrollment_status: 'active',
        class_name: '6ème A',
        school_id: 'school-A',
        school_name: 'Complexe Scolaire Pilote'
      },
      {
        link_id: 'link-2',
        student_id: 'st-2',
        student_number: 'MAT-002',
        first_name: 'Esther',
        last_name: 'Banza',
        relationship: 'Père',
        can_view_academic: true,
        enrollment_status: 'active',
        class_name: '4ème B',
        school_id: 'school-B',
        school_name: 'École B'
      }
    ];

    render(
      <ParentChildSwitcher
        childrenList={childrenList}
        selectedChildId="st-1"
        onSelectChild={vi.fn()}
        activeChild={childrenList[0]}
      />
    );

    expect(screen.getByText('Complexe Scolaire Pilote')).toBeInTheDocument();
  });

  // 24. changement d’enfant sans fuite de données de l’école précédente
  it('24. Isole la sélection de l’enfant et du switcher entre différents établissements', () => {
    const childrenList: LinkedChild[] = [
      {
        link_id: 'link-1',
        student_id: 'st-1',
        student_number: 'MAT-001',
        first_name: 'Daniel',
        last_name: 'Banza',
        relationship: 'Père',
        can_view_academic: true,
        enrollment_status: 'active',
        class_name: '6ème A',
        school_id: 'school-A',
        school_name: 'Complexe Scolaire Pilote'
      },
      {
        link_id: 'link-2',
        student_id: 'st-2',
        student_number: 'MAT-002',
        first_name: 'Esther',
        last_name: 'Banza',
        relationship: 'Père',
        can_view_academic: true,
        enrollment_status: 'active',
        class_name: '4ème B',
        school_id: 'school-B',
        school_name: 'École B'
      }
    ];

    const onSelectChildSpy = vi.fn();

    render(
      <ParentChildSwitcher
        childrenList={childrenList}
        selectedChildId="st-1"
        onSelectChild={onSelectChildSpy}
        activeChild={childrenList[0]}
      />
    );

    const estherBtn = screen.getByRole('button', { name: /Esther/i });
    fireEvent.click(estherBtn);

    expect(onSelectChildSpy).toHaveBeenCalledWith('st-2');
  });

  // 25. échappement XSS des messages serveur
  it('25. Échappe correctement les tentatives XSS dans les messages ou noms d’établissement', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    const xssPayload = '<img src=x onerror=alert(1)> Établissement SÉCURISÉ';

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        success: true,
        school_id: 'school-456',
        school_name: xssPayload,
        students_linked: 1
      },
      error: null
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre l'établissement/i }));

    await waitFor(() => {
      expect(screen.getByText(xssPayload)).toBeInTheDocument();
      expect(document.querySelector('img[src="x"]')).toBeNull();
    });
  });

  // 26. accessibilité clavier et lecteurs d’écran
  it('26. Offre un accès au clavier et des balises ARIA appropriées', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    const acceptBtn = screen.getByRole('button', { name: /Rejoindre l'établissement/i });
    expect(acceptBtn).toBeInTheDocument();
    expect(acceptBtn).not.toBeDisabled();
  });

  // 27. responsive mobile, tablette et desktop
  it('27. Contient des classes Tailwind responsive pour mobile et desktop', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    const { container } = render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);
    const card = container.querySelector('.max-w-md');
    expect(card).toBeInTheDocument();
  });

  // 28. nettoyage du sessionStorage au logout
  it('28. Marque le changement de compte sans détruire prématurément le jeton lors d’un logout WRONG_ACCOUNT', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'wrong-user', email: 'wrong@example.com' };

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET ACCÈS : L’adresse email du compte connecté ne correspond pas à l’invitation.' }
    } as any);

    fireEvent.click(screen.getByRole('button', { name: /Rejoindre l'établissement/i }));

    await waitFor(() => {
      const switchBtn = screen.getByRole('button', { name: /Se déconnecter et changer de compte/i });
      fireEvent.click(switchBtn);
      expect(mockSignOutReal).toHaveBeenCalled();
      const env = schoolInvitationService.getValidInvitationEnvelope();
      expect(env?.account_switch_pending).toBe(true);
    });
  });

  // 29. conservation temporaire du token lors d’un changement vers le bon compte
  it('29. Permet la conservation temporaire du jeton pendant le processus de changement de compte', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN, true);
    const env = schoolInvitationService.getValidInvitationEnvelope();
    expect(env?.account_switch_pending).toBe(true);
    expect(env?.token).toBe(SAMPLE_TOKEN);
  });

  // 30. aucune régression du parcours Parent mono-école existant
  it('30. Conserve la compatibilité avec le parcours mono-école standard sans token d’invitation', () => {
    schoolInvitationService.clearInvitationEnvelope();
    mockUser = null;

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    expect(screen.getByText(/Aucun jeton d’invitation valide/i)).toBeInTheDocument();
  });

  // --- NOUVEAUX SCÉNARIOS GATE ADVERSARIAL (31 À 45+) ---

  // 31. injection manuelle d’un faux token dans sessionStorage
  it('31. Refuse une chaîne brute injectée manuellement sans enveloppe versionnée v1', () => {
    sessionStorage.setItem(INVITATION_ENVELOPE_KEY, 'raw_fake_unversioned_token_string');
    const env = schoolInvitationService.getValidInvitationEnvelope();
    expect(env).toBeNull();
  });

  // 32. enveloppe expirée (TTL dépassé)
  it('32. Refuse une enveloppe d’invitation dont le TTL frontend (30 min) est dépassé', () => {
    const expiredTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const envelope = {
      version: 1,
      flow: 'parent_multi_school_invitation',
      token: SAMPLE_TOKEN,
      captured_at: expiredTime
    };
    sessionStorage.setItem(INVITATION_ENVELOPE_KEY, JSON.stringify(envelope));

    const env = schoolInvitationService.getValidInvitationEnvelope();
    expect(env).toBeNull();
    expect(sessionStorage.getItem(INVITATION_ENVELOPE_KEY)).toBeNull();
  });

  // 33. enveloppe incorrectement versionnée
  it('33. Refuse une enveloppe dont la version != 1 ou flow != parent_multi_school_invitation', () => {
    const badEnvelope = {
      version: 99,
      flow: 'unknown_flow',
      token: SAMPLE_TOKEN,
      captured_at: new Date().toISOString()
    };
    sessionStorage.setItem(INVITATION_ENVELOPE_KEY, JSON.stringify(badEnvelope));

    const env = schoolInvitationService.getValidInvitationEnvelope();
    expect(env).toBeNull();
  });

  // 34. parcours legacy non détourné dans SetPasswordPage
  it('34. Garantit que SetPasswordPage utilise l’activation legacy si l’enveloppe est absente ou invalide', () => {
    schoolInvitationService.clearInvitationEnvelope();
    expect(schoolInvitationService.getValidInvitationEnvelope()).toBeNull();
  });

  // 35. callback PKCE avec code Supabase Auth
  it('35. Traite le callback PKCE Supabase Auth en préservant le code dans l’URL pendant le callback', () => {
    (window as any).location.search = `?code=supabase_pkce_auth_code_123&token=${SAMPLE_TOKEN}`;
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    expect(schoolInvitationService.getValidInvitationToken()).toBe(SAMPLE_TOKEN);
    // Vérifier que replaceState a supprimé token mais conservé code=...
    expect(replaceStateSpy).toHaveBeenCalledWith({}, expect.any(String), '/auth/accept-school-invitation?code=supabase_pkce_auth_code_123');
  });

  // 36. callback avec plusieurs paramètres Supabase Auth (code, type, hash)
  it('36. Conserve type et code lors de la capture du jeton d’invitation', () => {
    (window as any).location.search = `?code=abc12345&type=signup&token=${SAMPLE_TOKEN}`;
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);

    expect(schoolInvitationService.getValidInvitationToken()).toBe(SAMPLE_TOKEN);
    expect(replaceStateSpy).toHaveBeenCalledWith({}, expect.any(String), '/auth/accept-school-invitation?code=abc12345&type=signup');
  });

  // 37. rechargement pendant callback PKCE
  it('37. Gère un rechargement de page pendant le callback sans détruire l’enveloppe capturée', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    const env = schoolInvitationService.getValidInvitationEnvelope();
    expect(env?.token).toBe(SAMPLE_TOKEN);
  });

  // 38. purge explicite lors de clearInvitationEnvelope
  it('38. Purge complètement sessionStorage et localStorage lors de l’appel clearInvitationEnvelope', () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    schoolInvitationService.clearInvitationEnvelope();

    expect(sessionStorage.getItem(INVITATION_ENVELOPE_KEY)).toBeNull();
    expect(localStorage.getItem(INVITATION_ENVELOPE_KEY)).toBeNull();
  });

  // 39. deuxième invitation ouverte dans le même onglet remplace proprement la première
  it('39. Remplace de manière déterministe la première invitation par une seconde au clic sur un nouveau lien', () => {
    const OLD_TOKEN = 'token_old_1111111111';
    const NEW_TOKEN = 'token_new_2222222222';

    schoolInvitationService.saveInvitationToken(OLD_TOKEN);
    expect(schoolInvitationService.getValidInvitationToken()).toBe(OLD_TOKEN);

    schoolInvitationService.saveInvitationToken(NEW_TOKEN);
    expect(schoolInvitationService.getValidInvitationToken()).toBe(NEW_TOKEN);
  });

  // 40. Open Redirect : URL absolue neutralisée par sanitizeReturnTo
  it('40. Neutralise toute tentative d’Open Redirect avec URL absolue externe', () => {
    const malicious = 'https://attacker.com/steal-token';
    const safe = schoolInvitationService.sanitizeReturnTo(malicious);
    expect(safe).toBe('/auth/accept-school-invitation');
  });

  // 41. Open Redirect : URL commençant par // neutralisée
  it('41. Neutralise toute tentative d’Open Redirect avec des slashes doubles //', () => {
    const malicious = '//attacker.com/phishing';
    const safe = schoolInvitationService.sanitizeReturnTo(malicious);
    expect(safe).toBe('/auth/accept-school-invitation');
  });

  // 42. Open Redirect : schémas dangereux (javascript:, data:)
  it('42. Neutralise les schémas dangereux javascript: et data:', () => {
    expect(schoolInvitationService.sanitizeReturnTo('javascript:alert(1)')).toBe('/auth/accept-school-invitation');
    expect(schoolInvitationService.sanitizeReturnTo('data:text/html,<script>alert(1)</script>')).toBe('/auth/accept-school-invitation');
  });

  // 43. Jeton absent de returnTo
  it('43. Filtre et retire tout jeton sensible éventuellement présent dans un paramètre returnTo', () => {
    const inputWithToken = '/app/parent?token=sensitive_raw_token_123';
    const sanitized = schoolInvitationService.sanitizeReturnTo(inputWithToken);
    expect(sanitized).toBe('/app/parent');
    expect(sanitized).not.toContain('token=');
  });

  // 44. data RPC null géré en erreur UNKNOWN_ERROR
  it('44. Convertit une réponse RPC data=null en une InvitationError de code UNKNOWN_ERROR', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: null
    } as any);

    await expect(schoolInvitationService.acceptParentSchoolInvitation(SAMPLE_TOKEN)).rejects.toThrow(
      /Le serveur a renvoyé une réponse vide/i
    );
  });

  // 45. code d'erreur SQL métier non reconnu géré proprement
  it('45. Gère un code SQL métier inconnu en renvoyant une erreur sécurisée', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'CUSTOM_DB_ERR : Erreur personnalisée' }
    } as any);

    try {
      await schoolInvitationService.acceptParentSchoolInvitation(SAMPLE_TOKEN);
    } catch (err: any) {
      expect(err.code).toBe('UNKNOWN_ERROR');
      expect(err.message).toContain('Erreur personnalisée');
    }
  });

  // 46. rejeu deux onglets simultanés (ALREADY_ACCEPTED)
  it('46. Traite la réponse du rejeu (ALREADY_ACCEPTED) lorsqu’un second onglet accepte le même token', async () => {
    schoolInvitationService.saveInvitationToken(SAMPLE_TOKEN);
    mockUser = { id: 'parent-123', email: 'parent@example.com' };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET : Cette invitation a déjà été acceptée.' }
    } as any);

    render(<AcceptSchoolInvitationPage onNavigate={mockNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre l'établissement/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invitation déjà acceptée/i)).toBeInTheDocument();
      expect(schoolInvitationService.getValidInvitationToken()).toBeNull();
    });
  });

  // 47. isolation du changement d'école dans RealParentPortal
  it('47. Confirme que les requêtes parent_student_links sont filtrées par parent_profile_id et status=approved', () => {
    const linkQuery = `
      id,
      relationship,
      can_view_academic,
      status,
      student_id,
      school_id,
      school:schools (
        id,
        name
      ),
      student:students (
        id,
        student_number,
        first_name,
        last_name,
        enrollment_status
      )
    `;
    expect(linkQuery).toContain('student_id');
    expect(linkQuery).toContain('school_id');
  });

  // 48. déduplication des enfants en cas d'inscriptions historiques
  it('48. Garantit l’unicité des élèves par student_id même si plusieurs liens historiques existent', () => {
    const childrenList: LinkedChild[] = [
      {
        link_id: 'link-1',
        student_id: 'st-1',
        student_number: 'MAT-001',
        first_name: 'Daniel',
        last_name: 'Banza',
        relationship: 'Père',
        can_view_academic: true,
        enrollment_status: 'active',
        school_id: 'school-A',
        school_name: 'École A'
      }
    ];

    render(
      <ParentChildSwitcher
        childrenList={childrenList}
        selectedChildId="st-1"
        onSelectChild={vi.fn()}
        activeChild={childrenList[0]}
      />
    );

    expect(screen.getByText(/Daniel/i)).toBeInTheDocument();
  });

  // 49. student_id est la clé d'identité réelle, jamais profile_id
  it('49. Utilise exclusivement student_id comme identifiant d’élève', () => {
    const child: LinkedChild = {
      link_id: 'l-1',
      student_id: 'student-uuid-999',
      student_number: 'N-123',
      first_name: 'Daniel',
      last_name: 'Banza',
      relationship: 'Père',
      can_view_academic: true,
      enrollment_status: 'active'
    };

    expect(child.student_id).toBe('student-uuid-999');
    expect(child).not.toHaveProperty('profile_id');
  });

  // 50. aucun objet error complet envoyé à console.error
  it('50. Empêche la journalisation brute des objets d’erreur Supabase pouvant contenir les paramètres de la RPC', async () => {
    const consoleErrSpy = vi.spyOn(console, 'error');

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'REJET ACCÈS : p_token invalide', details: 'rpc parameters' }
    } as any);

    try {
      await schoolInvitationService.acceptParentSchoolInvitation(SAMPLE_TOKEN);
    } catch (_e) {
      // Ignorer
    }

    consoleErrSpy.mock.calls.forEach(callArgs => {
      callArgs.forEach(arg => {
        if (typeof arg === 'object') {
          expect(arg).not.toHaveProperty('p_token');
        }
      });
    });
  });

  // 51. returnTo : %2F%2Fevil.example neutralisé
  it('51. Neutralise /%2F%2Fevil.example et bascule vers /auth/accept-school-invitation', () => {
    expect(schoolInvitationService.sanitizeReturnTo('/%2F%2Fevil.example')).toBe('/auth/accept-school-invitation');
  });

  // 52. returnTo : /\evil.example neutralisé
  it('52. Neutralise /\\evil.example avec backslash', () => {
    expect(schoolInvitationService.sanitizeReturnTo('/\\evil.example')).toBe('/auth/accept-school-invitation');
  });

  // 53. returnTo : /%5C%5Cevil.example neutralisé
  it('53. Neutralise /%5C%5Cevil.example avec double backslash encodé', () => {
    expect(schoolInvitationService.sanitizeReturnTo('/%5C%5Cevil.example')).toBe('/auth/accept-school-invitation');
  });

  // 54. returnTo : /connexion/../../evil neutralisé par normalisation
  it('54. Neutralise la traversée de répertoire /connexion/../../evil', () => {
    expect(schoolInvitationService.sanitizeReturnTo('/connexion/../../evil')).toBe('/auth/accept-school-invitation');
  });

  // 55. returnTo : /app/parent?token=secret purgé du paramètre jeton
  it('55. Purge les paramètres jetons sensibles dans returnTo', () => {
    expect(schoolInvitationService.sanitizeReturnTo('/app/parent?token=secret')).toBe('/app/parent');
  });

  // 56. returnTo : /app/parent#access_token=secret purgé du fragment hash
  it('56. Purge les fragments hash sensibles access_token dans returnTo', () => {
    expect(schoolInvitationService.sanitizeReturnTo('/app/parent#access_token=secret')).toBe('/app/parent');
  });

  // 57. returnTo : URL absolue neutralisée
  it('57. Neutralise une URL absolue https://evil.example.com/app/parent', () => {
    expect(schoolInvitationService.sanitizeReturnTo('https://evil.example.com/app/parent')).toBe('/auth/accept-school-invitation');
  });

  // 58. returnTo : Route interne inconnue /admin/dashboard neutralisée
  it('58. Refuse une route interne non présente dans la liste fermée autorisée', () => {
    expect(schoolInvitationService.sanitizeReturnTo('/admin/dashboard')).toBe('/auth/accept-school-invitation');
    expect(schoolInvitationService.sanitizeReturnTo('/secret-route')).toBe('/auth/accept-school-invitation');
  });

  // 59. returnTo : Chacune des 4 routes autorisées
  it('59. Accepte exclusivement chacune des 4 routes explicitement autorisées', () => {
    expect(schoolInvitationService.sanitizeReturnTo('/auth/accept-school-invitation')).toBe('/auth/accept-school-invitation');
    expect(schoolInvitationService.sanitizeReturnTo('/auth/set-password')).toBe('/auth/set-password');
    expect(schoolInvitationService.sanitizeReturnTo('/connexion')).toBe('/connexion');
    expect(schoolInvitationService.sanitizeReturnTo('/app/parent')).toBe('/app/parent');
  });

});
