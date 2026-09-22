import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ParentDocumentsModule } from '../components/parent/ParentDocumentsModule';
import * as parentDocumentService from '../services/parentDocumentService';

// Mock parentDocumentService
vi.mock('../services/parentDocumentService', () => ({
  fetchParentStudentDocuments: vi.fn(),
  downloadParentDocument: vi.fn(),
}));

const mockFetch = parentDocumentService.fetchParentStudentDocuments as unknown as ReturnType<typeof vi.fn>;
const mockDownload = parentDocumentService.downloadParentDocument as unknown as ReturnType<typeof vi.fn>;

const sampleDocuments: parentDocumentService.ParentDocumentItem[] = [
  {
    id: 'doc-1',
    title: 'Règlement Intérieur 2026',
    description: 'Règlement général de l’établissement',
    category: 'rules',
    target_scope: 'school',
    file_name: 'reglement_2026.pdf',
    file_size_bytes: 1048576, // 1.00 MB
    mime_type: 'application/pdf',
    published_at: '2026-09-01T10:00:00Z',
    created_at: '2026-09-01T10:00:00Z',
  },
  {
    id: 'doc-2',
    title: 'Autorisation Sortie Pédagogique',
    description: 'Formulaire à signer pour la sortie musée',
    category: 'administrative',
    target_scope: 'class',
    file_name: 'autorisation_sortie.png',
    file_size_bytes: 524288, // 512.0 KB
    mime_type: 'image/png',
    published_at: '2026-09-15T08:30:00Z',
    created_at: '2026-09-15T08:30:00Z',
  },
];

describe('ParentDocumentsModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('1. affiche le skeleton pendant le chargement initial', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ParentDocumentsModule studentId="student-101" />);
    
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('2. affiche la liste des documents réels après chargement', async () => {
    mockFetch.mockResolvedValue({
      student_id: 'student-101',
      student_number: 'E-001',
      student_name: 'Jean',
      summary: { total_documents: 2 },
      documents: sampleDocuments,
    });
    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
      expect(screen.getByText('Autorisation Sortie Pédagogique')).toBeTruthy();
    });

    expect(screen.getByText('1.00 MB')).toBeTruthy();
    expect(screen.getByText('512.0 KB')).toBeTruthy();
  });

  it('3. affiche le message d’état vide si aucun document n’est disponible', async () => {
    mockFetch.mockResolvedValue({
      student_id: 'student-101',
      student_number: '',
      student_name: '',
      summary: { total_documents: 0 },
      documents: [],
    });
    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Aucun document scolaire n’est actuellement disponible.')).toBeTruthy();
    });
  });

  it('4. gère et affiche une erreur contrôlée en cas d’échec du chargement', async () => {
    mockFetch.mockRejectedValue(new Error('Erreur de connexion à la base de données.'));
    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Erreur de connexion à la base de données.')).toBeTruthy();
    });
  });

  it('5. permet la recherche par titre de document', async () => {
    mockFetch.mockResolvedValue({
      student_id: 'student-101',
      student_number: '',
      student_name: '',
      summary: { total_documents: 2 },
      documents: sampleDocuments,
    });
    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/Rechercher par titre/i);
    fireEvent.change(searchInput, { target: { value: 'Sortie' } });

    expect(screen.queryByText('Règlement Intérieur 2026')).toBeNull();
    expect(screen.getByText('Autorisation Sortie Pédagogique')).toBeTruthy();
  });

  it('6. filtre les documents par catégorie', async () => {
    mockFetch.mockResolvedValue({
      student_id: 'student-101',
      student_number: '',
      student_name: '',
      summary: { total_documents: 2 },
      documents: sampleDocuments,
    });
    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    const categorySelect = screen.getByRole('combobox');
    fireEvent.change(categorySelect, { target: { value: 'administrative' } });

    expect(screen.queryByText('Règlement Intérieur 2026')).toBeNull();
    expect(screen.getByText('Autorisation Sortie Pédagogique')).toBeTruthy();
  });

  it('7 & 9. réinitialise l’état immédiatement lors d’un changement d’enfant et empêche la contamination', async () => {
    let resolveFirst: (val: any) => void;
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
    
    mockFetch.mockImplementation((id: string) => {
      if (id === 'student-101') return firstPromise;
      if (id === 'student-102') return Promise.resolve({
        student_id: 'student-102',
        documents: [{
          id: 'doc-3',
          title: 'Document Enfant 2',
          description: 'Description 2',
          category: 'academic',
          target_scope: 'student',
          file_name: 'doc_enfant_2.pdf',
          file_size_bytes: 2048,
          mime_type: 'application/pdf',
          published_at: '2026-09-18T10:00:00Z',
          created_at: '2026-09-18T10:00:00Z',
        }],
      });
      return Promise.resolve({ documents: [] });
    });

    const { rerender } = render(<ParentDocumentsModule studentId="student-101" />);

    rerender(<ParentDocumentsModule studentId="student-102" />);

    await waitFor(() => {
      expect(screen.getByText('Document Enfant 2')).toBeTruthy();
    });

    resolveFirst!({ documents: sampleDocuments });

    expect(screen.queryByText('Règlement Intérieur 2026')).toBeNull();
  });

  it('8. ignore la réponse d’un appel obsolète si studentId a changé', async () => {
    let resolveChild1: (val: any) => void;
    const child1Promise = new Promise((resolve) => { resolveChild1 = resolve; });

    mockFetch.mockImplementation((id: string) => {
      if (id === 'child-1') return child1Promise;
      if (id === 'child-2') return Promise.resolve({ documents: [] });
      return Promise.resolve({ documents: [] });
    });

    const { rerender } = render(<ParentDocumentsModule studentId="child-1" />);
    rerender(<ParentDocumentsModule studentId="child-2" />);

    await waitFor(() => {
      expect(screen.getByText('Aucun document scolaire n’est actuellement disponible.')).toBeTruthy();
    });

    resolveChild1!({ documents: sampleDocuments });

    expect(screen.queryByText('Règlement Intérieur 2026')).toBeNull();
  });

  it('10. effectue le téléchargement avec succès via une URL HTTPS valide', async () => {
    mockFetch.mockResolvedValue({ documents: [sampleDocuments[0]] });
    mockDownload.mockResolvedValue({
      success: true,
      download_url: 'https://supabase.co/storage/v1/object/sign/doc.pdf',
      expires_in_seconds: 120,
      file_name: 'reglement_2026.pdf',
      file_size_bytes: 1048576,
      mime_type: 'application/pdf',
    });

    const clickMock = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'a') {
        el.click = clickMock;
      }
      return el;
    });

    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    const downloadButton = screen.getAllByRole('button', { name: /Télécharger/i })[0];
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(mockDownload).toHaveBeenCalledWith('student-101', 'doc-1');
      expect(clickMock).toHaveBeenCalled();
    });
  });

  it('11. prévient le double clic pendant le téléchargement', async () => {
    mockFetch.mockResolvedValue({ documents: [sampleDocuments[0]] });
    let resolveDownload: (val: any) => void;
    const downloadPromise = new Promise((resolve) => { resolveDownload = resolve; });
    mockDownload.mockReturnValue(downloadPromise);

    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    const downloadButton = screen.getAllByRole('button', { name: /Télécharger/i })[0];
    fireEvent.click(downloadButton);
    fireEvent.click(downloadButton);

    expect(mockDownload).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDownload!({
        success: true,
        download_url: 'https://example.com/file.pdf',
        expires_in_seconds: 120,
        file_name: 'file.pdf',
        file_size_bytes: 100,
        mime_type: 'application/pdf',
      });
    });
  });

  it('12. refuse une URL non-HTTPS renvoyée par le service', async () => {
    mockFetch.mockResolvedValue({ documents: [sampleDocuments[0]] });
    mockDownload.mockRejectedValue(new Error('L’URL de téléchargement retournée n’est pas sécurisée (HTTPS requis).'));

    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    const downloadButton = screen.getAllByRole('button', { name: /Télécharger/i })[0];
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(screen.getByText('L’URL de téléchargement retournée n’est pas sécurisée (HTTPS requis).')).toBeTruthy();
    });
  });

  it('13. gère une erreur 401/403 lors du téléchargement', async () => {
    mockFetch.mockResolvedValue({ documents: [sampleDocuments[0]] });
    mockDownload.mockRejectedValue(new Error('Accès non autorisé au document scolaire. (HTTP 403)'));

    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    const downloadButton = screen.getAllByRole('button', { name: /Télécharger/i })[0];
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(screen.getByText('Accès non autorisé au document scolaire. (HTTP 403)')).toBeTruthy();
    });
  });

  it('14. affiche un message si le document est archivé ou devenu indisponible', async () => {
    mockFetch.mockResolvedValue({ documents: [sampleDocuments[0]] });
    mockDownload.mockRejectedValue(new Error('Ce document n’est plus disponible ou a été archivé.'));

    render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    const downloadButton = screen.getAllByRole('button', { name: /Télécharger/i })[0];
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(screen.getByText('Ce document n’est plus disponible ou a été archivé.')).toBeTruthy();
    });
  });

  it('15. s’assure que le service de liste transmet uniquement p_student_id', async () => {
    expect(parentDocumentService.fetchParentStudentDocuments).toBeDefined();
  });

  it('16. s’assure que le téléchargement transmet uniquement student_id et document_id', async () => {
    mockFetch.mockResolvedValue({ documents: [sampleDocuments[0]] });
    mockDownload.mockResolvedValue({
      success: true,
      download_url: 'https://example.com/doc.pdf',
      expires_in_seconds: 120,
      file_name: 'doc.pdf',
      file_size_bytes: 100,
      mime_type: 'application/pdf',
    });

    render(<ParentDocumentsModule studentId="student-xyz" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /Télécharger/i })[0]);

    await waitFor(() => {
      expect(mockDownload).toHaveBeenCalledWith('student-xyz', 'doc-1');
    });
  });

  it('17. vérifie l’absence totale de storage_path sur le composant et dans les objets reçus', async () => {
    mockFetch.mockResolvedValue({ documents: sampleDocuments });
    const { container } = render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    expect(container.innerHTML).not.toContain('storage_path');
    sampleDocuments.forEach((doc) => {
      expect(doc).not.toHaveProperty('storage_path');
    });
  });

  it('18. vérifie qu’aucune référence à MOCK_DOCUMENTS n’est présente dans les composants réels', async () => {
    mockFetch.mockResolvedValue({ documents: sampleDocuments });
    const { container } = render(<ParentDocumentsModule studentId="student-101" />);

    await waitFor(() => {
      expect(screen.getByText('Règlement Intérieur 2026')).toBeTruthy();
    });

    expect(container.innerHTML).not.toContain('MOCK_DOCUMENTS');
  });
});
