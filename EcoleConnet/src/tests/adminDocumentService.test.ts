import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchAdminSchoolDocuments,
  uploadSchoolDocument,
  publishSchoolDocument,
  archiveSchoolDocument
} from '../services/adminDocumentService';
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

describe('adminDocumentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. fetchAdminSchoolDocuments', () => {
    it('appele get_admin_school_documents sans transmettre de school_id depuis le client', async () => {
      mockRpc.mockResolvedValue({
        data: {
          school_id: 'school-123',
          kpi: { total_documents: 1, draft_count: 1, published_count: 0, archived_count: 0 },
          documents: [
            {
              id: 'doc-1',
              title: 'Règlement Intérieur',
              category: 'rules',
              target_scope: 'school',
              status: 'draft',
              file_name: 'reglement.pdf',
              file_size_bytes: 1024,
              mime_type: 'application/pdf',
              created_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
        error: null,
      });

      const res = await fetchAdminSchoolDocuments({ status: 'draft', category: 'rules' });

      expect(mockRpc).toHaveBeenCalledWith('get_admin_school_documents', {
        p_status: 'draft',
        p_category: 'rules',
      });
      const args = mockRpc.mock.calls[0][1];
      expect(args).not.toHaveProperty('school_id');
      expect(args).not.toHaveProperty('p_school_id');
      expect(res.documents.length).toBe(1);
    });
  });

  describe('2. uploadSchoolDocument', () => {
    it('invoque admin-school-document-upload avec un payload JSON sécurisé sans envoyer school_id, user_id ni storage_path', async () => {
      mockInvoke.mockResolvedValue({
        data: { document_id: 'doc-xyz', status: 'draft' },
        error: null,
      });

      const fakeFile = new File(['dummy content'], 'document.pdf', { type: 'application/pdf' });
      const res = await uploadSchoolDocument({
        title: 'Note de Service',
        description: 'Description globale',
        category: 'administrative',
        target_scope: 'school',
        file: fakeFile,
      });

      expect(mockInvoke).toHaveBeenCalledWith('admin-school-document-upload', expect.objectContaining({
        body: expect.objectContaining({
          title: 'Note de Service',
          description: 'Description globale',
          category: 'administrative',
          target_scope: 'school',
          file_name: 'document.pdf',
          mime_type: 'application/pdf',
          file_base64: expect.any(String),
        }),
      }));

      const body = mockInvoke.mock.calls[0][1].body;
      expect(body).not.toHaveProperty('school_id');
      expect(body).not.toHaveProperty('user_id');
      expect(body).not.toHaveProperty('storage_path');

      expect(res.success).toBe(true);
      expect(res.status).toBe('draft');
    });
  });

  describe('3. publishSchoolDocument', () => {
    it('exécute la RPC admin_publish_school_document', async () => {
      mockRpc.mockResolvedValue({
        data: { document_id: 'doc-1', status: 'published' },
        error: null,
      });

      const res = await publishSchoolDocument('doc-1');

      expect(mockRpc).toHaveBeenCalledWith('admin_publish_school_document', {
        p_document_id: 'doc-1',
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe('published');
    });
  });

  describe('4. archiveSchoolDocument', () => {
    it('exécute la RPC admin_archive_school_document', async () => {
      mockRpc.mockResolvedValue({
        data: { document_id: 'doc-1', status: 'archived' },
        error: null,
      });

      const res = await archiveSchoolDocument('doc-1');

      expect(mockRpc).toHaveBeenCalledWith('admin_archive_school_document', {
        p_document_id: 'doc-1',
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe('archived');
    });
  });

  describe('5. Propagation des erreurs', () => {
    it('propage l’erreur RPC lors de l’échec de liste et l’erreur Edge Function lors du téléversement', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Rejet d’accès 42501' },
      });

      await expect(fetchAdminSchoolDocuments()).rejects.toThrow('Rejet d’accès 42501');

      mockInvoke.mockResolvedValue({
        data: null,
        error: { message: 'Taille maximale dépassée' },
      });

      const fakeFile = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
      await expect(
        uploadSchoolDocument({
          title: 'Document',
          category: 'rules',
          target_scope: 'school',
          file: fakeFile,
        })
      ).rejects.toThrow('Taille maximale dépassée');
    });
  });
});
