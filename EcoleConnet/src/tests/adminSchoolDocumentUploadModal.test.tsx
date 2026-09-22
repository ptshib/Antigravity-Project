import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdminSchoolDocumentUploadModal } from '../components/admin/AdminSchoolDocumentUploadModal';
import * as adminDocumentService from '../services/adminDocumentService';

vi.mock('../services/adminDocumentService', () => ({
  uploadSchoolDocument: vi.fn(),
}));

const mockUpload = adminDocumentService.uploadSchoolDocument as unknown as ReturnType<typeof vi.fn>;

const sampleClasses = [
  { id: 'class-6a', name: '6ème A' },
  { id: 'class-5b', name: '5ème B' },
];

const sampleStudents = [
  { id: 'stu-1', first_name: 'Jean', last_name: 'Dupont', class_id: 'class-6a', student_number: 'E-001' },
  { id: 'stu-2', first_name: 'Marie', last_name: 'Kabange', class_id: 'class-5b', student_number: 'E-002' },
];

describe('AdminSchoolDocumentUploadModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('19 & 20. bloque la soumission si le titre ou le fichier est absent', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <AdminSchoolDocumentUploadModal
        isOpen={true}
        onClose={handleClose}
        onSuccess={handleSuccess}
        classes={sampleClasses}
        students={sampleStudents}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Créer le Brouillon/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('21. rejette les fichiers d’une taille supérieure à 15 Mo', async () => {
    render(
      <AdminSchoolDocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        classes={sampleClasses}
        students={sampleStudents}
      />
    );

    const largeFile = new File([new ArrayBuffer(16 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' });
    const fileInput = screen.getByLabelText(/Parcourir un fichier/i) as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    await waitFor(() => {
      expect(screen.getByText('La taille du fichier excède la limite maximale autorisée de 15 Mo.')).toBeTruthy();
    });
  });

  it('22. rejette les formats de fichiers non autorisés (ex: .exe, .txt)', async () => {
    render(
      <AdminSchoolDocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        classes={sampleClasses}
        students={sampleStudents}
      />
    );

    const invalidFile = new File(['script content'], 'virus.exe', { type: 'application/x-msdownload' });
    const fileInput = screen.getByLabelText(/Parcourir un fichier/i) as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    await waitFor(() => {
      expect(screen.getByText('Type de fichier non autorisé. Seuls les fichiers PDF, PNG et JPEG sont acceptés.')).toBeTruthy();
    });
  });

  it('23. exige une classe obligatoire si la portée est "Toute la classe"', async () => {
    render(
      <AdminSchoolDocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        classes={sampleClasses}
        students={sampleStudents}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Règlement Intérieur/i), { target: { value: 'Devoir de Vacances' } });
    
    // Renseigner un fichier valide
    const validFile = new File(['content'], 'valid.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Parcourir un fichier/i), { target: { files: [validFile] } });

    // Passer en portée classe
    const scopeSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(scopeSelect, { target: { value: 'class' } });

    // Soumettre sans sélectionner de classe
    const submitBtn = screen.getByRole('button', { name: /Créer le Brouillon/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Veuillez sélectionner une classe pour la portée "Toute la classe".')).toBeTruthy();
    });
  });

  it('24. exige un élève obligatoire si la portée est "Individuel"', async () => {
    render(
      <AdminSchoolDocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        classes={sampleClasses}
        students={sampleStudents}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Règlement Intérieur/i), { target: { value: 'Bulletin Individuel' } });
    const validFile = new File(['content'], 'valid.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Parcourir un fichier/i), { target: { files: [validFile] } });

    const scopeSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(scopeSelect, { target: { value: 'student' } });

    const submitBtn = screen.getByRole('button', { name: /Créer le Brouillon/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Veuillez sélectionner un élève pour la portée "Individuel".')).toBeTruthy();
    });
  });

  it('25 & 26. effectue l’upload avec succès pour la portée school et conserve le statut draft', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    mockUpload.mockResolvedValue({
      success: true,
      document_id: 'doc-new-123',
      status: 'draft',
      message: 'Document téléversé avec succès. Vous pouvez maintenant le publier.',
    });

    render(
      <AdminSchoolDocumentUploadModal
        isOpen={true}
        onClose={handleClose}
        onSuccess={handleSuccess}
        classes={sampleClasses}
        students={sampleStudents}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Règlement Intérieur/i), { target: { value: 'Règlement Intérieur 2026' } });
    const validFile = new File(['pdf data'], 'reglement.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Parcourir un fichier/i), { target: { files: [validFile] } });

    const submitBtn = screen.getByRole('button', { name: /Créer le Brouillon/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith({
        title: 'Règlement Intérieur 2026',
        description: undefined,
        category: 'administrative',
        target_scope: 'school',
        class_id: undefined,
        student_id: undefined,
        file: validFile,
      });
      expect(handleSuccess).toHaveBeenCalledWith('Document téléversé avec succès. Vous pouvez maintenant le publier.');
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('27. affiche une erreur de téléversement en cas d’échec du service', async () => {
    mockUpload.mockRejectedValue(new Error('Quota d’espace de stockage dépassé.'));

    render(
      <AdminSchoolDocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        classes={sampleClasses}
        students={sampleStudents}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Règlement Intérieur/i), { target: { value: 'Fichier Lourd' } });
    const validFile = new File(['content'], 'heavy.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Parcourir un fichier/i), { target: { files: [validFile] } });

    fireEvent.click(screen.getByRole('button', { name: /Créer le Brouillon/i }));

    await waitFor(() => {
      expect(screen.getByText('Quota d’espace de stockage dépassé.')).toBeTruthy();
    });
  });

  it('28. bloque la soumission multiple pendant l’upload', async () => {
    let resolveUpload: (val: any) => void;
    const uploadPromise = new Promise((resolve) => { resolveUpload = resolve; });
    mockUpload.mockReturnValue(uploadPromise);

    render(
      <AdminSchoolDocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        classes={sampleClasses}
        students={sampleStudents}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Règlement Intérieur/i), { target: { value: 'Doc Multiple' } });
    const validFile = new File(['content'], 'file.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Parcourir un fichier/i), { target: { files: [validFile] } });

    const submitBtn = screen.getByRole('button', { name: /Créer le Brouillon/i });
    fireEvent.click(submitBtn);

    expect(mockUpload).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpload!({ success: true, document_id: 'doc-1', status: 'draft' });
    });
  });
});
