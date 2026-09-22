import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealSchoolAdminPortal } from '../pages/admin/RealSchoolAdminPortal';

let mockUserRole = 'school_admin';

vi.mock('../contexts/RealAuthContext', () => ({
  useRealAuth: () => ({
    profile: { id: 'admin-1', role: mockUserRole },
    school: { id: 'school-101', name: 'École Test' },
    signOutReal: vi.fn(),
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
    school_id: 'school-101',
    kpi: { total_documents: 0, draft_count: 0, published_count: 0, archived_count: 0 },
    documents: [],
  }),
  publishSchoolDocument: vi.fn(),
  archiveSchoolDocument: vi.fn(),
}));

describe('RealSchoolAdminPortal — Navigation et Visibilité des Onglets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRole = 'school_admin';
  });

  afterEach(() => {
    cleanup();
  });

  it('1. school_admin voit l’onglet Documents scolaires juste avant Paramètres, le clic affiche le module', async () => {
    mockUserRole = 'school_admin';
    render(<RealSchoolAdminPortal />);

    // Attend la fin du chargement initial du portail admin
    const navElement = await screen.findByRole('navigation', { name: /Navigation principale administrateur/i });
    expect(navElement).toBeTruthy();
    expect(navElement.className).toContain('overflow-x-auto');

    // Récupération des boutons d'onglets
    const buttons = screen.getAllByRole('button');
    const docButtonIndex = buttons.findIndex((btn) => btn.textContent?.includes('Documents scolaires'));
    const paramButtonIndex = buttons.findIndex((btn) => btn.textContent?.includes('Paramètres'));

    expect(docButtonIndex).toBeGreaterThan(-1);
    expect(paramButtonIndex).toBeGreaterThan(-1);

    // Vérifie que Documents scolaires est placé juste avant Paramètres
    expect(docButtonIndex).toBe(paramButtonIndex - 1);

    const docTabButton = buttons[docButtonIndex];
    expect(docTabButton.className).toContain('flex-shrink-0');

    // Clic sur l'onglet Documents scolaires et vérification de l'activation
    fireEvent.click(docTabButton);

    await waitFor(() => {
      expect(docTabButton.className).toContain('bg-amber-500');
    });

    // Vérifie le rendu effectif du module AdminSchoolDocumentsModule
    await waitFor(() => {
      expect(screen.getByText('Gestion des Documents Scolaires')).toBeTruthy();
    });
  });

  it('2. finance_agent ne voit pas l’onglet Documents scolaires', async () => {
    mockUserRole = 'finance_agent';
    render(<RealSchoolAdminPortal />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Documents scolaires/i })).toBeNull();
    });
  });

  it('3. l’onglet Paramètres reste accessible et activable pour school_admin', async () => {
    mockUserRole = 'school_admin';
    render(<RealSchoolAdminPortal />);

    const paramButton = await screen.findByRole('button', { name: /Paramètres/i });
    expect(paramButton).toBeTruthy();

    fireEvent.click(paramButton);

    await waitFor(() => {
      expect(paramButton.className).toContain('bg-amber-500');
    });
  });
});
