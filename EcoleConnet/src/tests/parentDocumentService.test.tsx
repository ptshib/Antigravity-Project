/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchParentStudentDocuments, downloadParentDocument } from '../services/parentDocumentService';
import { supabase } from '../lib/supabase';

// Mock supabase module
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  },
}));

const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const mockInvoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

describe('parentDocumentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchParentStudentDocuments', () => {
    it('transmet uniquement p_student_id à la RPC get_parent_student_documents', async () => {
      mockRpc.mockResolvedValue({
        data: {
          student_id: 'student-123',
          student_number: 'STU-001',
          student_name: 'Jean Dupont',
          summary: { total_documents: 1 },
          documents: [
            {
              id: 'doc-1',
              title: 'Règlement Intérieur',
              description: 'Règlement de l’école',
              category: 'rules',
              target_scope: 'school',
              file_name: 'reglement.pdf',
              file_size_bytes: 1024,
              mime_type: 'application/pdf',
              published_at: '2026-09-01T00:00:00Z',
              created_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
        error: null,
      });

      const res = await fetchParentStudentDocuments('student-123');

      expect(mockRpc).toHaveBeenCalledWith('get_parent_student_documents', {
        p_student_id: 'student-123',
      });
      const rpcArgs = mockRpc.mock.calls[0][1];
      expect(Object.keys(rpcArgs)).toEqual(['p_student_id']);
      expect(res.documents.length).toBe(1);
    });

    it('lève une erreur si la RPC échoue', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Accès interdit à cet élève' },
      });

      await expect(fetchParentStudentDocuments('student-999')).rejects.toThrow(
        'Accès interdit à cet élève'
      );
    });

    it('lève une erreur si studentId est invalide', async () => {
      await expect(fetchParentStudentDocuments('')).rejects.toThrow(
        'Identifiant élève invalide.'
      );
    });
  });

  describe('downloadParentDocument', () => {
    it('invoque uniquement parent-school-document-download avec student_id et document_id', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          download_url: 'https://storage.supabase.co/v1/object/sign/bucket/doc.pdf?token=abc',
          expires_in_seconds: 120,
          file_name: 'doc.pdf',
          file_size_bytes: 5000,
          mime_type: 'application/pdf',
        },
        error: null,
      });

      const res = await downloadParentDocument('student-123', 'doc-456');

      expect(mockInvoke).toHaveBeenCalledWith('parent-school-document-download', {
        body: {
          student_id: 'student-123',
          document_id: 'doc-456',
        },
      });

      const bodyArgs = mockInvoke.mock.calls[0][1].body;
      expect(Object.keys(bodyArgs).sort()).toEqual(['document_id', 'student_id']);
      expect(res.download_url).toBe('https://storage.supabase.co/v1/object/sign/bucket/doc.pdf?token=abc');
    });

    it('refuse une URL non HTTPS', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          download_url: 'http://insecure-http-server.com/doc.pdf',
          expires_in_seconds: 120,
        },
        error: null,
      });

      await expect(downloadParentDocument('student-123', 'doc-456')).rejects.toThrow(
        'L’URL de téléchargement retournée n’est pas sécurisée (HTTPS requis).'
      );
    });

    it('lève une erreur si la fonction retourne une erreur HTTP/RPC', async () => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: { message: 'Document non trouvé ou non disponible.' },
      });

      await expect(downloadParentDocument('student-123', 'doc-456')).rejects.toThrow(
        'Document non trouvé ou non disponible.'
      );
    });
  });
});
