import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealSchoolAdminPortal } from '../pages/admin/RealSchoolAdminPortal';

let mockUserRole = 'school_admin';
const mockSignOutReal = vi.fn();

vi.mock('../contexts/RealAuthContext', () => ({
  useRealAuth: () => ({
    profile: {
      id: 'admin-prof-1',
      first_name: 'Jean-Paul',
      last_name: 'Kabongo',
      role: mockUserRole,
    },
    school: {
      id: 'school-uuid-2026',
      name: 'Complexe Scolaire Moderne de Kinshasa',
      slug: 'CSM-KIN-2026',
      status: 'active',
    },
    signOutReal: mockSignOutReal,
  }),
}));

vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('../lib/supabase', () => {
  const createMockQuery = () => {
    const mock: any = {
      select: () => mock,
      eq: () => mock,
      order: () => mock,
      limit: () => mock,
      single: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    return mock;
  };

  return {
    supabase: {
      from: () => createMockQuery(),
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

vi.mock('../services/adminDocumentService', () => ({
  fetchAdminSchoolDocuments: vi.fn().mockResolvedValue({
    school_id: 'school-uuid-2026',
    kpi: { total_documents: 0, draft_count: 0, published_count: 0, archived_count: 0 },
    documents: [],
  }),
  publishSchoolDocument: vi.fn(),
  archiveSchoolDocument: vi.fn(),
}));

describe('LOT 2K-T4 — Shell Admin Production & Alignement Visuel Démo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRole = 'school_admin';
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Affiche l’identité réelle de l’établissement et de l’administrateur sans aucune donnée Démo fictive', async () => {
    render(<RealSchoolAdminPortal />);

    // Header & Sidebar render correct real school name and profile
    await waitFor(() => {
      const schoolNameElements = screen.getAllByText('Complexe Scolaire Moderne de Kinshasa');
      expect(schoolNameElements.length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Jean-Paul Kabongo/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/ID : CSM-KIN-2026/i)).toBeTruthy();
    });

    // Zero fake demo portal text
    expect(screen.queryByText(/Complexe Scolaire Les Horizons/i)).toBeNull();
    expect(screen.queryByText(/Mode Démonstration/i)).toBeNull();
    expect(screen.queryByText(/Changer de rôle démo/i)).toBeNull();
  });

  it('2. Préserves TOUTES les 18 rubriques Production avec navigation clavier et marquage aria-current', async () => {
    render(<RealSchoolAdminPortal />);

    const nav = await screen.findByRole('navigation', { name: /Navigation principale administrateur/i });
    expect(nav).toBeTruthy();

    const expectedTabs = [
      'Vue d’ensemble',
      'Finance & Frais',
      'Années',
      'Calendrier scolaire',
      'Matières',
      'Coefficients',
      'Classes',
      'Enseignants',
      'Parents',
      'Élèves',
      'Présences',
      'Devoirs',
      'Emploi du temps',
      'Notes',
      'Affectations',
      'Importations',
      'Documents scolaires',
      'Paramètres',
    ];

    for (const tabLabel of expectedTabs) {
      const btn = screen.getByRole('button', { name: new RegExp(tabLabel, 'i') });
      expect(btn).toBeTruthy();
    }

    // Vue d'ensemble is active by default
    const vueDensembleBtn = screen.getByRole('button', { name: /Vue d’ensemble/i });
    expect(vueDensembleBtn.getAttribute('aria-current')).toBe('page');

    // Click on Élèves tab switches active state
    const elevesBtn = screen.getByRole('button', { name: /Élèves/i });
    fireEvent.click(elevesBtn);

    await waitFor(() => {
      expect(elevesBtn.getAttribute('aria-current')).toBe('page');
      expect(vueDensembleBtn.getAttribute('aria-current')).toBeNull();
    });
  });

  it('3. Contrôle l’ouverture/fermeture du drawer mobile et la touche Escape', async () => {
    render(<RealSchoolAdminPortal />);

    const openMenuBtn = await screen.findByRole('button', { name: /Ouvrir le menu/i });
    expect(openMenuBtn).toBeTruthy();

    // Drawer is closed initially on mobile
    const sidebar = document.getElementById('admin-sidebar');
    expect(sidebar?.className).toContain('-translate-x-full');

    // Click hamburger button to open drawer
    fireEvent.click(openMenuBtn);

    await waitFor(() => {
      expect(sidebar?.className).toContain('translate-x-0');
    });

    // Press Escape key closes drawer
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(sidebar?.className).toContain('-translate-x-full');
    });
  });

  it('4. Gère les permissions du rôle finance_agent (accès restreint à Finance uniquement)', async () => {
    mockUserRole = 'finance_agent';
    render(<RealSchoolAdminPortal />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Finance & Frais/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Vue d’ensemble/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Élèves/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Documents scolaires/i })).toBeNull();
    });
  });

  it('5. Exécute la déconnexion lors du clic sur le bouton de déconnexion', async () => {
    render(<RealSchoolAdminPortal />);

    const signOutBtns = await screen.findAllByRole('button', { name: /Déconnexion|Se déconnecter/i });
    expect(signOutBtns.length).toBeGreaterThan(0);

    fireEvent.click(signOutBtns[0]);
    expect(mockSignOutReal).toHaveBeenCalledTimes(1);
  });

  it('6. Vérifie l’absence du mot "(Mock)" dans les sous-rubriques Finance et la présence de tous les sous-onglets sans coupure', async () => {
    mockUserRole = 'finance_agent';
    render(<RealSchoolAdminPortal />);

    await waitFor(() => {
      // Retrait du mot Mock
      expect(screen.queryByText(/Campagnes \(Mock\)/i)).toBeNull();
      expect(screen.getByRole('tab', { name: /^Campagnes$/i })).toBeTruthy();
    });

    const subTabList = screen.getByRole('tablist', { name: /Navigation des sous-rubriques financières/i });
    expect(subTabList).toBeTruthy();

    const expectedSubTabs = [
      "Vue d'ensemble",
      'Balance Âgée & Créances',
      'Factures & Encaissements',
      'Grille Tarifaire',
      'Campagnes',
      'Livraisons E-mail',
    ];

    for (const label of expectedSubTabs) {
      const tabBtn = screen.getByRole('tab', { name: new RegExp(label, 'i') });
      expect(tabBtn).toBeTruthy();
    }

    // Le texte utilisateur simplifié est bien présent
    expect(screen.getByText(/Gérez les frais scolaires, les factures, les encaissements/i)).toBeTruthy();
  });
});
