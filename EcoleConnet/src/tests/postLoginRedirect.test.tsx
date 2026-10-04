// Fichier : src/tests/postLoginRedirect.test.tsx
// P1-AUTH-HOTFIX — Non-régression de la redirection post-authentification (App.tsx)
// Incident : après une connexion réussie depuis /connexion ou /, l'utilisateur restait sur place.

import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';
import { schoolInvitationService } from '../services/schoolInvitationService';

type MockState = {
  role: string;
  isActive: boolean;
  schoolStatus: string;
  session: any;
};

const USER = { id: 'usr-p1-test', email: 'p1@ecolelink.test' };
const SESSION = { user: USER, access_token: 'tok-p1' };

const mockState: MockState = {
  role: 'school_admin',
  isActive: true,
  schoolStatus: 'active',
  session: null
};

vi.mock('../lib/supabase', () => {
  let authChangeCallback: ((event: string, session: any) => void) | null = null;

  const singleQuery = (resolver: () => any) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(async () => resolver()),
    maybeSingle: vi.fn().mockImplementation(async () => resolver())
  });

  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockImplementation(async () => ({ data: { session: mockState.session }, error: null })),
        onAuthStateChange: vi.fn((cb) => {
          authChangeCallback = cb;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
        signOut: vi.fn().mockResolvedValue({ error: null })
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return singleQuery(() => ({
            data: {
              id: USER.id,
              role: mockState.role,
              school_id: mockState.role === 'super_admin' ? null : 'sch-p1',
              first_name: 'Test',
              last_name: 'P1',
              is_active: mockState.isActive
            },
            error: null
          }));
        }
        if (table === 'schools') {
          return singleQuery(() => ({
            data: { id: 'sch-p1', name: 'École Test P1', status: mockState.schoolStatus },
            error: null
          }));
        }
        return singleQuery(() => ({ data: null, error: null }));
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null })
    },
    isSupabaseConfigured: true,
    triggerAuthChange: (event: string, session: any) => {
      mockState.session = session;
      if (authChangeCallback) authChangeCallback(event, session);
    }
  };
});

// Les portails réels sont remplacés par des marqueurs : seule la logique de routage d'App est testée ici.
vi.mock('../pages/admin/RealSchoolAdminPortal', () => ({ RealSchoolAdminPortal: () => <div data-testid="portal-school" /> }));
vi.mock('../pages/teacher/RealTeacherPortal', () => ({ RealTeacherPortal: () => <div data-testid="portal-teacher" /> }));
vi.mock('../pages/parent/RealParentPortal', () => ({ RealParentPortal: () => <div data-testid="portal-parent" /> }));
vi.mock('../pages/student/RealStudentPortal', () => ({ RealStudentPortal: () => <div data-testid="portal-student" /> }));
vi.mock('../pages/superadmin/SuperAdminDashboard', () => ({ SuperAdminDashboard: () => <div data-testid="portal-superadmin" /> }));
vi.mock('../pages/superadmin/SchoolSupervisionPage', () => ({ SchoolSupervisionPage: () => <div data-testid="portal-superadmin-school" /> }));
vi.mock('../pages/auth/LoginPage', () => ({ LoginPage: () => <div data-testid="login-page" /> }));
vi.mock('../pages/LandingPage', () => ({ LandingPage: () => <div data-testid="landing-page" /> }));

const ROLE_CASES: Array<{ role: string; defaultPath: string; portal: string }> = [
  { role: 'super_admin', defaultPath: '/app/superadmin', portal: 'portal-superadmin' },
  { role: 'school_admin', defaultPath: '/app/ecole/vue-densemble', portal: 'portal-school' },
  { role: 'finance_agent', defaultPath: '/app/ecole/finance/vue-densemble', portal: 'portal-school' },
  { role: 'teacher', defaultPath: '/app/enseignant/tableau-de-bord', portal: 'portal-teacher' },
  { role: 'parent', defaultPath: '/app/parent/tableau-de-bord', portal: 'portal-parent' },
  { role: 'student', defaultPath: '/app/eleve/resultats', portal: 'portal-student' }
];

async function signInFrom(path: string) {
  window.history.pushState({}, '', path);
  render(<App />);
  const { triggerAuthChange } = await import('../lib/supabase') as any;
  await act(async () => {
    triggerAuthChange('SIGNED_IN', SESSION);
  });
}

describe('P1-AUTH-HOTFIX — Redirection post-authentification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.role = 'school_admin';
    mockState.isActive = true;
    mockState.schoolStatus = 'active';
    mockState.session = null;
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  describe('1. Connexion depuis /connexion', () => {
    it.each(ROLE_CASES)('$role → $defaultPath', async ({ role, defaultPath, portal }) => {
      mockState.role = role;
      await signInFrom('/connexion');

      await waitFor(() => expect(window.location.pathname).toBe(defaultPath));
      expect(await screen.findByTestId(portal)).toBeInTheDocument();
      expect(screen.queryByTestId('login-page')).toBeNull();
    });
  });

  describe('2. Connexion depuis /', () => {
    it.each(ROLE_CASES)('$role → $defaultPath', async ({ role, defaultPath, portal }) => {
      mockState.role = role;
      await signInFrom('/');

      await waitFor(() => expect(window.location.pathname).toBe(defaultPath));
      expect(await screen.findByTestId(portal)).toBeInTheDocument();
      expect(screen.queryByTestId('landing-page')).toBeNull();
    });

    it('Session déjà active au chargement sur /connexion → portail du rôle', async () => {
      mockState.role = 'parent';
      mockState.session = SESSION;
      window.history.pushState({}, '', '/connexion');
      render(<App />);

      await waitFor(() => expect(window.location.pathname).toBe('/app/parent/tableau-de-bord'));
      expect(await screen.findByTestId('portal-parent')).toBeInTheDocument();
    });
  });

  describe('3. Conservation des routes profondes autorisées (rechargement avec session)', () => {
    it.each([
      { role: 'super_admin', path: '/app/superadmin/ecoles/sch-999', portal: 'portal-superadmin-school' },
      { role: 'school_admin', path: '/app/ecole/finance/factures', portal: 'portal-school' },
      { role: 'finance_agent', path: '/app/ecole/finance/balance-creances', portal: 'portal-school' },
      { role: 'teacher', path: '/app/enseignant/emploi-du-temps', portal: 'portal-teacher' },
      { role: 'parent', path: '/app/parent/calendrier', portal: 'portal-parent' },
      { role: 'student', path: '/app/eleve/devoirs', portal: 'portal-student' }
    ])('$role conserve $path', async ({ role, path, portal }) => {
      mockState.role = role;
      mockState.session = SESSION;
      window.history.pushState({}, '', path);
      render(<App />);

      expect(await screen.findByTestId(portal)).toBeInTheDocument();
      expect(window.location.pathname).toBe(path);
    });
  });

  describe('4. Correction des routes non autorisées', () => {
    it.each([
      { role: 'parent', path: '/app/ecole/finance/factures', expected: '/app/parent/tableau-de-bord' },
      { role: 'student', path: '/app/enseignant/notes', expected: '/app/eleve/resultats' },
      { role: 'teacher', path: '/app/superadmin', expected: '/app/enseignant/tableau-de-bord' },
      { role: 'finance_agent', path: '/app/ecole/eleves', expected: '/app/ecole/finance/vue-densemble' },
      { role: 'school_admin', path: '/app/parent/finance', expected: '/app/ecole/vue-densemble' }
    ])('$role sur $path → $expected', async ({ role, path, expected }) => {
      mockState.role = role;
      mockState.session = SESSION;
      window.history.pushState({}, '', path);
      render(<App />);

      await waitFor(() => expect(window.location.pathname).toBe(expected));
    });
  });

  describe('5. returnTo', () => {
    it('Respecte un returnTo autorisé', async () => {
      mockState.role = 'parent';
      await signInFrom('/connexion?returnTo=%2Fapp%2Fparent');

      await waitFor(() => expect(window.location.pathname).toBe('/app/parent'));
    });

    it.each(['//evil.example', 'https://evil.example/app/parent', '/%2F%2Fevil.example'])(
      'Ne suit jamais un returnTo dangereux (%s)',
      async (malicious) => {
        mockState.role = 'parent';
        const origin = window.location.origin;
        await signInFrom(`/connexion?returnTo=${encodeURIComponent(malicious)}`);

        const expected = schoolInvitationService.sanitizeReturnTo(malicious);
        await waitFor(() => expect(window.location.pathname).toBe(expected));
        expect(window.location.origin).toBe(origin);
        expect(window.location.href).not.toContain('evil.example');
      }
    );
  });

  describe('6. Comptes suspendus', () => {
    it('Profil inactif → /acces-suspendu', async () => {
      mockState.role = 'teacher';
      mockState.isActive = false;
      await signInFrom('/connexion');

      await waitFor(() => expect(window.location.pathname).toBe('/acces-suspendu'));
    });

    it.each(['suspended', 'archived'])('École %s → /acces-suspendu', async (status) => {
      mockState.role = 'school_admin';
      mockState.schoolStatus = status;
      await signInFrom('/connexion');

      await waitFor(() => expect(window.location.pathname).toBe('/acces-suspendu'));
    });
  });

  describe('7. Absence de boucle de redirection', () => {
    it('La redirection post-login se stabilise après une seule écriture d’historique', async () => {
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      const pushSpy = vi.spyOn(window.history, 'pushState');
      mockState.role = 'school_admin';
      await signInFrom('/connexion');

      await waitFor(() => expect(window.location.pathname).toBe('/app/ecole/vue-densemble'));
      const writes = replaceSpy.mock.calls.length + pushSpy.mock.calls.length;
      await act(async () => { await new Promise(r => setTimeout(r, 200)); });

      expect(replaceSpy.mock.calls.length + pushSpy.mock.calls.length).toBe(writes);
      expect(writes).toBeLessThanOrEqual(2);
      replaceSpy.mockRestore();
      pushSpy.mockRestore();
    });
  });
});
