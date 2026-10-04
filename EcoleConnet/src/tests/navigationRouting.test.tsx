import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';
import {
  parseAdminPath,
  parseParentPath,
  parseTeacherPath,
  parseStudentPath,
  validateAndSanitizePathForRole,
  sanitizeReturnTo,
  sanitizeSearchAndHash
} from '../utils/portalRouting';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  let authChangeCallback: ((event: string, session: any) => void) | null = null;
  const mockUser = { id: 'usr-123-test', email: 'test@ecolelink.com' };
  const mockSession = { user: mockUser, access_token: 'tok-123' };

  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: mockSession },
          error: null
        }),
        onAuthStateChange: vi.fn((cb) => {
          authChangeCallback = cb;
          return {
            data: {
              subscription: {
                unsubscribe: vi.fn()
              }
            }
          };
        }),
        signOut: vi.fn().mockResolvedValue({ error: null })
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'usr-123-test',
                role: 'school_admin',
                school_id: 'sch-123',
                first_name: 'Admin',
                last_name: 'Test',
                is_active: true
              },
              error: null
            })
          };
        }
        if (table === 'schools') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'sch-123',
                name: 'Complexe Scolaire Test',
                status: 'active'
              },
              error: null
            })
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        };
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null })
    },
    isSupabaseConfigured: true,
    triggerAuthChange: (event: string, session: any) => {
      if (authChangeCallback) {
        authChangeCallback(event, session);
      }
    }
  };
});

describe('LOT 2K-NAV-ROUTING-F-V3 — Tests de Routage Persistant, Aliases et Sécurité Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  describe('1. Parsing et Mappage d\'URLs Canoniques & Aliases', () => {
    it('Mappe correctement /app/ecole/calendrier comme route canonique et /trimestres comme alias', () => {
      const parsedCalendrier = parseAdminPath('/app/ecole/calendrier');
      expect(parsedCalendrier.tab).toBe('trimestres');
      expect(parsedCalendrier.canonicalPath).toBe('/app/ecole/calendrier');
      expect(parsedCalendrier.isAlias).toBeFalsy();

      const parsedTrimestres = parseAdminPath('/app/ecole/trimestres');
      expect(parsedTrimestres.tab).toBe('trimestres');
      expect(parsedTrimestres.canonicalPath).toBe('/app/ecole/calendrier');
      expect(parsedTrimestres.isAlias).toBe(true);
    });

    it('Mappe uniquement les 3 routes Élève canoniques et redirige les routes inexistantes vers /resultats', () => {
      expect(parseStudentPath('/app/eleve/resultats').canonicalPath).toBe('/app/eleve/resultats');
      expect(parseStudentPath('/app/eleve/devoirs').canonicalPath).toBe('/app/eleve/devoirs');
      expect(parseStudentPath('/app/eleve/emploi-du-temps').canonicalPath).toBe('/app/eleve/emploi-du-temps');

      // Inexistent routes fallback to /app/eleve/resultats
      const parsedInexistent = parseStudentPath('/app/eleve/calendrier');
      expect(parsedInexistent.canonicalPath).toBe('/app/eleve/resultats');
      expect(parsedInexistent.isAlias).toBe(true);

      const parsedInexistentPresences = parseStudentPath('/app/eleve/presences');
      expect(parsedInexistentPresences.canonicalPath).toBe('/app/eleve/resultats');
      expect(parsedInexistentPresences.isAlias).toBe(true);
    });

    it('Mappe correctement les chemins Parent et Enseignant', () => {
      const parsedParent = parseParentPath('/app/parent/finance');
      expect(parsedParent.tab).toBe('finance');
      expect(parsedParent.canonicalPath).toBe('/app/parent/finance');

      const parsedTeacher = parseTeacherPath('/app/enseignant/devoirs');
      expect(parsedTeacher.tab).toBe('homework');
      expect(parsedTeacher.canonicalPath).toBe('/app/enseignant/devoirs');
    });
  });

  describe('2. Assainissement des Query Parameters & returnTo', () => {
    it('Filtre strictement les paramètres Auth sensibles (code, access_token, token, etc.)', () => {
      const search = '?code=secret-code&access_token=secret-token&refresh_token=rt-123&page=2';
      const { sanitizedSearch } = sanitizeSearchAndHash(search, '');
      expect(sanitizedSearch).not.toContain('code=');
      expect(sanitizedSearch).not.toContain('access_token=');
      expect(sanitizedSearch).not.toContain('refresh_token=');
      expect(sanitizedSearch).toBe('?page=2');
    });

    it('Valide strictement returnTo (relatif uniquement, pas d\'URL absolue ni de //)', () => {
      expect(sanitizeReturnTo('/app/parent/finance')).toBe('/app/parent/finance');
      expect(sanitizeReturnTo('https://evil.example')).toBeNull();
      expect(sanitizeReturnTo('//evil.example')).toBeNull();
      expect(sanitizeReturnTo('javascript:alert(1)')).toBeNull();
      expect(sanitizeReturnTo('data:text/html,abc')).toBeNull();
    });

    it('Valide returnTo selon le rôle destinataire courant (parent, élève, admin)', () => {
      // Parent + returnTo=/app/parent/finance -> conservé
      expect(sanitizeReturnTo('/app/parent/finance', 'parent')).toBe('/app/parent/finance');
      // Parent + returnTo=/app/ecole/finance/factures -> supprimé (non autorisé pour rôle parent)
      expect(sanitizeReturnTo('/app/ecole/finance/factures', 'parent')).toBeNull();
      // Élève + returnTo=/app/eleve/devoirs -> conservé
      expect(sanitizeReturnTo('/app/eleve/devoirs', 'student')).toBe('/app/eleve/devoirs');
      // Élève + returnTo=/app/parent/finance -> supprimé
      expect(sanitizeReturnTo('/app/parent/finance', 'student')).toBeNull();
      // URL absolue ou //evil.example -> toujours supprimée quel que soit le rôle
      expect(sanitizeReturnTo('https://evil.example', 'parent')).toBeNull();
      expect(sanitizeReturnTo('//evil.example', 'student')).toBeNull();
    });

    it('Nettoie searchParams lors du passage d\'une URL contenant returnTo malveillant ou code secret', () => {
      const search = '?code=secret-test&returnTo=https://evil.example&safeParam=ok';
      const { sanitizedSearch } = sanitizeSearchAndHash(search, '#top');
      expect(sanitizedSearch).toBe('?safeParam=ok');
    });
  });

  describe('3. Sécurité par Rôle', () => {
    it('Refuse à un parent d\'accéder aux sous-routes administration', () => {
      const res = validateAndSanitizePathForRole('/app/ecole/finance', 'parent');
      expect(res.isValid).toBe(false);
      expect(res.sanitizedPath).toBe('/app/parent/tableau-de-bord');
    });

    it('Refuse à un élève d\'accéder aux sous-routes enseignant', () => {
      const res = validateAndSanitizePathForRole('/app/enseignant/devoirs', 'student');
      expect(res.isValid).toBe(false);
      expect(res.sanitizedPath).toBe('/app/eleve/resultats');
    });

    it('Autorise school_admin sur les routes administration', () => {
      const res = validateAndSanitizePathForRole('/app/ecole/finance/factures', 'school_admin');
      expect(res.isValid).toBe(true);
      expect(res.sanitizedPath).toBe('/app/ecole/finance/factures');
    });
  });

  describe('4. Rendu React, Navigation et Stabilité Auth Monotone', () => {
    it('Restaure la rubrique Finance/Factures directement depuis l\'URL au rechargement', async () => {
      window.history.pushState({}, '', '/app/ecole/finance/factures');

      render(<App />);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/app/ecole/finance/factures');
      });
    });

    it('Conserve la rubrique lors des événements TOKEN_REFRESHED Supabase sans écran global', async () => {
      const { triggerAuthChange } = await import('../lib/supabase') as any;
      window.history.pushState({}, '', '/app/ecole/finance/factures');

      render(<App />);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/app/ecole/finance/factures');
      });

      // Trigger silent token refresh wrapped in act
      await act(async () => {
        triggerAuthChange('TOKEN_REFRESHED', {
          user: { id: 'usr-123-test', email: 'test@ecolelink.com' },
          access_token: 'new-tok-456'
        });
      });

      // Ensure full screen loading spinner is NOT shown and pathname stays intact
      expect(screen.queryByText(/Vérification de la session sécurisée/i)).toBeNull();
      expect(window.location.pathname).toBe('/app/ecole/finance/factures');
    });

    it('Redirige immédiatement vers /connexion lors d\'un SIGNED_OUT et ignore les réponses async périmées', async () => {
      const { triggerAuthChange } = await import('../lib/supabase') as any;
      window.history.pushState({}, '', '/app/ecole/finance/factures');

      render(<App />);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/app/ecole/finance/factures');
      });

      await act(async () => {
        triggerAuthChange('SIGNED_OUT', null);
      });

      await waitFor(() => {
        expect(window.location.pathname).toBe('/connexion');
      });
    });
  });
});
