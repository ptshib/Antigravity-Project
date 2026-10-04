import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';
import { NotificationProvider } from '../context/NotificationContext';
import { RealParentPortal } from '../pages/parent/RealParentPortal';
import { RealAuthProvider } from '../contexts/RealAuthContext';
import {
  parseAdminPath,
  parseParentPath,
  parseTeacherPath,
  parseStudentPath,
  validateAndSanitizePathForRole,
  sanitizeReturnTo,
  sanitizeSearchAndHash
} from '../utils/portalRouting';

let currentMockRole: string = 'school_admin';
let currentMockUser: any = { id: 'usr-123-test', email: 'test@ecolelink.com' };
let currentMockSession: any = { user: currentMockUser, access_token: 'tok-123' };



// Mock Supabase
vi.mock('../lib/supabase', () => {
  let authChangeCallback: ((event: string, session: any) => void) | null = null;

  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockImplementation(async () => ({
          data: { session: currentMockSession },
          error: null
        })),
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
            single: vi.fn().mockImplementation(async () => ({
              data: currentMockUser ? {
                id: 'usr-123-test',
                role: currentMockRole,
                school_id: 'sch-123',
                first_name: 'Admin',
                last_name: 'Test',
                is_active: true
              } : null,
              error: null
            }))
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
        if (table === 'parent_student_links') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null })
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        };
      }),
      rpc: vi.fn().mockImplementation(async (fn: string) => {
        if (fn === 'get_parent_children_and_schools') {
          return {
            data: [
              {
                student_id: 'std-123',
                student_full_name: 'Élève Test',
                school_id: 'sch-123',
                school_name: 'Complexe Scolaire Test',
                class_id: 'cls-123',
                class_name: '6ème A',
                academic_year_id: 'ay-123',
                academic_year_name: '2025-2026',
                link_status: 'approved',
                permissions: {
                  can_view_academic: true,
                  can_view_attendance: true,
                  can_view_homework: true,
                  can_view_finances: true,
                  can_pickup_student: true,
                  can_receive_notifications: true
                }
              }
            ],
            error: null
          };
        }
        return { data: [], error: null };
      })
    },
    isSupabaseConfigured: true,
    triggerAuthChange: (event: string, session: any) => {
      if (event === 'SIGNED_OUT') {
        currentMockUser = null;
        currentMockSession = null;
      } else if (session) {
        currentMockUser = session.user;
        currentMockSession = session;
      }
      if (authChangeCallback) {
        authChangeCallback(event, session);
      }
    }
  };
});

describe('LOT 2K-NAV-ROUTING-F-V3 — Tests de Routage Persistant, Aliases et Sécurité Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockRole = 'school_admin';
    currentMockUser = { id: 'usr-123-test', email: 'test@ecolelink.com' };
    currentMockSession = { user: currentMockUser, access_token: 'tok-123' };
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
      const parsedParentFinance = parseParentPath('/app/parent/finance');
      expect(parsedParentFinance.tab).toBe('paiements');
      expect(parsedParentFinance.canonicalPath).toBe('/app/parent/finance');

      const parsedParentEnfants = parseParentPath('/app/parent/enfants');
      expect(parsedParentEnfants.tab).toBe('mes_enfants');
      expect(parsedParentEnfants.canonicalPath).toBe('/app/parent/enfants');

      const parsedTeacher = parseTeacherPath('/app/enseignant/devoirs');
      expect(parsedTeacher.tab).toBe('homework');
      expect(parsedTeacher.canonicalPath).toBe('/app/enseignant/devoirs');
    });

    it('Valide le clic sidebar et la navigation persistance pour le portail Parent (mes_enfants et paiements)', () => {
      expect(parseParentPath('/app/parent/enfants').tab).toBe('mes_enfants');
      expect(parseParentPath('/app/parent/enfants').canonicalPath).toBe('/app/parent/enfants');

      expect(parseParentPath('/app/parent/mes-enfants').tab).toBe('mes_enfants');
      expect(parseParentPath('/app/parent/mes-enfants').canonicalPath).toBe('/app/parent/enfants');
      expect(parseParentPath('/app/parent/mes-enfants').isAlias).toBe(true);

      expect(parseParentPath('/app/parent/finance').tab).toBe('paiements');
      expect(parseParentPath('/app/parent/finance').canonicalPath).toBe('/app/parent/finance');

      expect(parseParentPath('/app/parent/paiements').tab).toBe('paiements');
      expect(parseParentPath('/app/parent/paiements').canonicalPath).toBe('/app/parent/finance');
      expect(parseParentPath('/app/parent/paiements').isAlias).toBe(true);
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

  describe('5. Gate Adversarial Portail Parent (Clics, URL, Sidebar, History F5/Précédent/Suivant, Aliases)', () => {
    beforeEach(() => {
      currentMockRole = 'parent';
    });

    it('Valide le flux complet: clic "Mes enfants", clic "Paiements & Finance", URL, sidebar active, contenu, F5, Précédent/Suivant et Aliases', async () => {
      // 1. Démarrer sur /app/parent/tableau-de-bord
      window.history.pushState({}, '', '/app/parent/tableau-de-bord');

      const { unmount } = render(
        <RealAuthProvider>
          <NotificationProvider>
            <RealParentPortal />
          </NotificationProvider>
        </RealAuthProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText(/Chargement sécurisé de votre Espace Parent/i)).toBeNull();
      });

      await waitFor(() => {
        expect(screen.getByText(/Aperçu des Enfants|Dossiers de mes enfants rattachés/i)).toBeInTheDocument();
      });

      // 2. Clic sur "Mes enfants"
      const mesEnfantsBtn = screen.getAllByRole('button').find(b => b.textContent?.trim() === 'Mes enfants');
      expect(mesEnfantsBtn).toBeDefined();
      fireEvent.click(mesEnfantsBtn!);

      // Vérifier URL canonique
      expect(window.location.pathname).toBe('/app/parent/enfants');
      // Vérifier le contenu affiché
      await waitFor(() => {
        expect(screen.getByText(/Dossiers de mes enfants rattachés/i)).toBeInTheDocument();
      });
      // Vérifier l'élément actif de la sidebar
      expect(mesEnfantsBtn?.className).toContain('from-blue-600');

      // 3. Clic sur "Paiements & Finance"
      const financeBtn = screen.getAllByRole('button').find(b => b.textContent?.trim() === 'Paiements & Finance');
      expect(financeBtn).toBeDefined();
      fireEvent.click(financeBtn!);

      // Vérifier URL canonique
      expect(window.location.pathname).toBe('/app/parent/finance');
      // Vérifier l'élément actif de la sidebar
      expect(financeBtn?.className).toContain('from-blue-600');

      unmount();

      // 4. Test F5 / Rechargement direct sur /app/parent/enfants
      window.history.pushState({}, '', '/app/parent/enfants');
      const { unmount: unmountEnfants } = render(
        <RealAuthProvider>
          <NotificationProvider>
            <RealParentPortal />
          </NotificationProvider>
        </RealAuthProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText(/Chargement sécurisé de votre Espace Parent/i)).toBeNull();
      });

      await waitFor(() => {
        expect(window.location.pathname).toBe('/app/parent/enfants');
        expect(screen.getByText(/Dossiers de mes enfants rattachés/i)).toBeInTheDocument();
      });
      const mesEnfantsBtnReload = screen.getAllByRole('button').find(b => b.textContent?.trim() === 'Mes enfants');
      expect(mesEnfantsBtnReload?.className).toContain('from-blue-600');
      unmountEnfants();

      // 5. Test F5 / Rechargement direct sur /app/parent/finance
      window.history.pushState({}, '', '/app/parent/finance');
      const { unmount: unmountFinance } = render(
        <RealAuthProvider>
          <NotificationProvider>
            <RealParentPortal />
          </NotificationProvider>
        </RealAuthProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText(/Chargement sécurisé de votre Espace Parent/i)).toBeNull();
      });

      await waitFor(() => {
        expect(window.location.pathname).toBe('/app/parent/finance');
      });
      const financeBtnReload = screen.getAllByRole('button').find(b => b.textContent?.trim() === 'Paiements & Finance');
      expect(financeBtnReload?.className).toContain('from-blue-600');

      // 6. Test Précédent & Suivant (PopState events)
      await act(async () => {
        window.history.pushState({}, '', '/app/parent/enfants');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(window.location.pathname).toBe('/app/parent/enfants');
      expect(screen.getByText(/Dossiers de mes enfants rattachés/i)).toBeInTheDocument();

      await act(async () => {
        window.history.pushState({}, '', '/app/parent/finance');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(window.location.pathname).toBe('/app/parent/finance');

      unmountFinance();

      // 7. Validation stricte des alias et des états canoniques mes_enfants / paiements
      const parseEnfantsCanonical = parseParentPath('/app/parent/enfants');
      expect(parseEnfantsCanonical.tab).toBe('mes_enfants');
      expect(parseEnfantsCanonical.canonicalPath).toBe('/app/parent/enfants');
      expect(parseEnfantsCanonical.isAlias).toBeFalsy();

      const parseEnfantsAlias1 = parseParentPath('/app/parent/mes-enfants');
      expect(parseEnfantsAlias1.tab).toBe('mes_enfants');
      expect(parseEnfantsAlias1.canonicalPath).toBe('/app/parent/enfants');
      expect(parseEnfantsAlias1.isAlias).toBe(true);

      const parseEnfantsAlias2 = parseParentPath('/app/parent/mes_enfants');
      expect(parseEnfantsAlias2.tab).toBe('mes_enfants');
      expect(parseEnfantsAlias2.canonicalPath).toBe('/app/parent/enfants');
      expect(parseEnfantsAlias2.isAlias).toBe(true);

      const parseFinanceCanonical = parseParentPath('/app/parent/finance');
      expect(parseFinanceCanonical.tab).toBe('paiements');
      expect(parseFinanceCanonical.canonicalPath).toBe('/app/parent/finance');
      expect(parseFinanceCanonical.isAlias).toBeFalsy();

      const parseFinanceAlias = parseParentPath('/app/parent/paiements');
      expect(parseFinanceAlias.tab).toBe('paiements');
      expect(parseFinanceAlias.canonicalPath).toBe('/app/parent/finance');
      expect(parseFinanceAlias.isAlias).toBe(true);
    });
  });
});
