import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdminSchoolDocumentsModule } from '../components/admin/AdminSchoolDocumentsModule';
import * as adminDocumentService from '../services/adminDocumentService';

vi.mock('../services/adminDocumentService', () => ({
  fetchAdminSchoolDocuments: vi.fn(),
  publishSchoolDocument: vi.fn(),
  archiveSchoolDocument: vi.fn(),
}));

const mockFetch = adminDocumentService.fetchAdminSchoolDocuments as unknown as ReturnType<typeof vi.fn>;
const mockPublish = adminDocumentService.publishSchoolDocument as unknown as ReturnType<typeof vi.fn>;
const mockArchive = adminDocumentService.archiveSchoolDocument as unknown as ReturnType<typeof vi.fn>;

const sampleDocuments: adminDocumentService.AdminDocumentItem[] = [
  {
    id: 'doc-1',
    school_id: 'school-101',
    title: 'Projet de Règlement 2026',
    description: 'Version préliminaire',
    category: 'rules',
    target_scope: 'school',
    file_name: 'reglement_draft.pdf',
    file_size_bytes: 1048576,
    mime_type: 'application/pdf',
    checksum_sha256: '1111111111111111111111111111111111111111111111111111111111111111',
    status: 'draft',
    created_by: 'admin-1',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
  },
  {
    id: 'doc-2',
    school_id: 'school-101',
    title: 'Autorisation Sortie Musée',
    description: 'Formulaire officiel pour classe 6A',
    category: 'administrative',
    target_scope: 'class',
    class_id: 'class-6a',
    class_name: '6ème A',
    file_name: 'sortie_musee.png',
    file_size_bytes: 524288,
    mime_type: 'image/png',
    checksum_sha256: '2222222222222222222222222222222222222222222222222222222222222222',
    status: 'published',
    published_at: '2026-09-05T09:00:00Z',
    created_by: 'admin-1',
    created_at: '2026-09-02T10:00:00Z',
    updated_at: '2026-09-05T09:00:00Z',
  },
  {
    id: 'doc-3',
    school_id: 'school-101',
    title: 'Ancienne Circulaire 2024',
    description: 'Document archivé',
    category: 'academic',
    target_scope: 'school',
    file_name: 'circulaire_2024.pdf',
    file_size_bytes: 2048576,
    mime_type: 'application/pdf',
    checksum_sha256: '3333333333333333333333333333333333333333333333333333333333333333',
    status: 'archived',
    published_at: '2024-09-01T00:00:00Z',
    archived_at: '2025-09-01T00:00:00Z',
    created_by: 'admin-1',
    created_at: '2024-09-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  }
];

describe('AdminSchoolDocumentsModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('6. affiche le skeleton pendant le chargement initial', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AdminSchoolDocumentsModule />);
    
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('7 & 12. affiche la liste réelle et les KPI corrects après résolution', async () => {
    mockFetch.mockResolvedValue({
      school_id: 'school-101',
      kpi: { total_documents: 3, draft_count: 1, published_count: 1, archived_count: 1 },
      documents: sampleDocuments,
    });

    render(<AdminSchoolDocumentsModule />);

    await waitFor(() => {
      expect(screen.getByText('Projet de Règlement 2026')).toBeTruthy();
      expect(screen.getByText('Autorisation Sortie Musée')).toBeTruthy();
      expect(screen.getByText('Ancienne Circulaire 2024')).toBeTruthy();
    });

    expect(screen.getByText('3')).toBeTruthy(); // Total KPI
  });

  it('8. affiche l’état vide si aucun document n’est retourné', async () => {
    mockFetch.mockResolvedValue({
      school_id: 'school-101',
      kpi: { total_documents: 0, draft_count: 0, published_count: 0, archived_count: 0 },
      documents: [],
    });

    render(<AdminSchoolDocumentsModule />);

    await waitFor(() => {
      expect(screen.getByText("Aucun document scolaire n'a été trouvé.")).toBeTruthy();
    });
  });

  it('9. gère une erreur et propose un bouton de réessai', async () => {
    mockFetch.mockRejectedValue(new Error('Erreur de connexion RPC'));

    render(<AdminSchoolDocumentsModule />);

    await waitFor(() => {
      expect(screen.getByText('Erreur de connexion RPC')).toBeTruthy();
    });

    mockFetch.mockResolvedValue({
      school_id: 'school-101',
      kpi: { total_documents: 1, draft_count: 1, published_count: 0, archived_count: 0 },
      documents: [sampleDocuments[0]],
    });

    fireEvent.click(screen.getByRole('button', { name: /Réessayer/i }));

    await waitFor(() => {
      expect(screen.getByText('Projet de Règlement 2026')).toBeTruthy();
    });
  });

  it('10. effectue la recherche locale par titre', async () => {
    mockFetch.mockResolvedValue({
      school_id: 'school-101',
      kpi: { total_documents: 3, draft_count: 1, published_count: 1, archived_count: 1 },
      documents: sampleDocuments,
    });

    render(<AdminSchoolDocumentsModule />);

    await waitFor(() => {
      expect(screen.getByText('Projet de Règlement 2026')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/Rechercher par titre/i);
    fireEvent.change(searchInput, { target: { value: 'Musée' } });

    expect(screen.queryByText('Projet de Règlement 2026')).toBeNull();
    expect(screen.getByText('Autorisation Sortie Musée')).toBeTruthy();
  });

  it('11. filtre par statut et catégorie via le service', async () => {
    mockFetch.mockResolvedValue({
      school_id: 'school-101',
      kpi: { total_documents: 3, draft_count: 1, published_count: 1, archived_count: 1 },
      documents: sampleDocuments,
    });

    render(<AdminSchoolDocumentsModule />);

    await waitFor(() => {
      expect(screen.getByText('Projet de Règlement 2026')).toBeTruthy();
    });

    const selects = screen.getAllByRole('combobox');
    const statusSelect = selects[0];
    fireEvent.change(statusSelect, { target: { value: 'draft' } });

    expect(mockFetch).toHaveBeenCalledWith({ status: 'draft', category: 'all' });
  });

  it('13. affiche les actions autorisées strictement selon le statut', async () => {
    mockFetch.mockResolvedValue({
      school_id: 'school-101',
      kpi: { total_documents: 3, draft_count: 1, published_count: 1, archived_count: 1 },
      documents: sampleDocuments,
    });

    render(<AdminSchoolDocumentsModule />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Publier ce Document/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Archiver ce Document/i })).toBeTruthy();
      expect(screen.getByText(/Document archivé \(Consultation uniquement\)/i)).toBeTruthy();
    });
  });

  it('15 & 17. demande confirmation puis publie le document draft', async () => {
    mockFetch.mockResolvedValue({
      school_id: 'school-101',
      kpi: { total_documents: 1, draft_count: 1, published_count: 0, archived_count: 0 },
      documents: [sampleDocuments[0]],
    });
    mockPublish.mockResolvedValue({ success: true, document_id: 'doc-1', status: 'published' });

    render(<AdminSchoolDocumentsModule />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Publier ce Document/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Publier ce Document/i }));

    // Vérifier l'apparition de la modale de confirmation
    await waitFor(() => {
      expect(screen.getByText('Publier ce document le rendra accessible aux parents concernés.')).toBeTruthy();
    });

    // Clic sur confirmation
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la Publication/i }));

    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith('doc-1');
    });
  });

  it('16 & 17. demande confirmation puis archive le document publié', async () => {
    mockFetch.mockResolvedValue({
      school_id: 'school-101',
      kpi: { total_documents: 1, draft_count: 0, published_count: 1, archived_count: 0 },
      documents: [sampleDocuments[1]],
    });
    mockArchive.mockResolvedValue({ success: true, document_id: 'doc-2', status: 'archived' });

    render(<AdminSchoolDocumentsModule />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Archiver ce Document/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Archiver ce Document/i }));

    await waitFor(() => {
      expect(screen.getByText('Archiver ce document empêchera immédiatement tout nouveau téléchargement par les parents.')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Confirmer l'Archivage/i }));

    await waitFor(() => {
      expect(mockArchive).toHaveBeenCalledWith('doc-2');
    });
  });

  it('18. ignore la réponse d’un appel obsolète si les filtres changent', async () => {
    let resolveFirstCall: (val: any) => void;
    const firstPromise = new Promise((resolve) => { resolveFirstCall = resolve; });

    mockFetch.mockImplementation((filters: any) => {
      if (filters?.status === 'draft') return firstPromise;
      if (filters?.status === 'published') return Promise.resolve({
        school_id: 'school-101',
        kpi: { total_documents: 1, draft_count: 0, published_count: 1, archived_count: 0 },
        documents: [sampleDocuments[1]],
      });
      return Promise.resolve({ documents: [] });
    });

    render(<AdminSchoolDocumentsModule />);

    // Changement de filtre immédiat pendant le premier chargement
    const statusSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(statusSelect, { target: { value: 'published' } });

    await waitFor(() => {
      expect(screen.getByText('Autorisation Sortie Musée')).toBeTruthy();
    });

    // Résolution tardive du premier appel (draft)
    resolveFirstCall!({
      school_id: 'school-101',
      kpi: { total_documents: 1, draft_count: 1, published_count: 0, archived_count: 0 },
      documents: [sampleDocuments[0]],
    });

    // Le document draft ne doit PAS remplacer le résultat le plus récent
    expect(screen.queryByText('Projet de Règlement 2026')).toBeNull();
  });
});
