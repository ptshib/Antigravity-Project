// Deno Tests : Tests réels des handlers HTTP pour admin-school-document-upload Edge Function
// Fichier : supabase/functions/admin-school-document-upload/index.test.ts

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handleAdminUploadRequest } from './index.ts';
import { validateMagicBytes, checkForForbiddenTextContent, calculateSha256 } from '../_shared/document-utils.ts';

const mockEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-secret',
  ECOLECONNECT_APP_URL: 'http://localhost:5173'
};

const getMockEnv = (key: string) => (mockEnv as any)[key];

// PDF valide minimal (%PDF-1.5 ...)
const validPdfBase64 = 'JVBERi0xLjUKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDAKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDAKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKMDAwMDAwMDEzMCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDQKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjIxMQolJUVPRg==';

Deno.test('1. Admin Upload Handler - JWT absent -> 401', async () => {
  const req = new Request('http://localhost/admin-school-document-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test' })
  });

  const res = await handleAdminUploadRequest(req, { getEnv: getMockEnv });
  assertEquals(res.status, 401);
  const json = await res.json();
  assertStringIncludes(json.error, 'Authorization manquant');
});

Deno.test('2. Admin Upload Handler - JWT invalide -> 401', async () => {
  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: { message: 'Invalid token' } })
    }
  });

  const req = new Request('http://localhost/admin-school-document-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer invalid-jwt'
    },
    body: JSON.stringify({ title: 'Test' })
  });

  const res = await handleAdminUploadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 401);
  const json = await res.json();
  assertStringIncludes(json.error, 'non authentifié');
});

Deno.test('3. Admin Upload Handler - Rôle Parent ou Enseignant -> 403', async () => {
  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-parent-id' } }, error: null })
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'parent', is_active: true, school_id: 'sch-1' }, error: null })
        })
      })
    })
  });

  const req = new Request('http://localhost/admin-school-document-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer parent-jwt'
    },
    body: JSON.stringify({ title: 'Test' })
  });

  const res = await handleAdminUploadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 403);
  const json = await res.json();
  assertStringIncludes(json.error, 'Seul un administrateur scolaire actif');
});

Deno.test('4. Admin Upload Handler - school_admin valide -> Autorisé (200 OK)', async () => {
  let rpcDraftCalled = false;
  let rpcFinalizeCalled = false;
  let uploadOptionsPassed: any = null;
  let storagePathPassed = '';

  const mockCreateClientFn = (url: string, key: string) => {
    const isServiceRole = key === 'service-role-test-secret';
    return {
      auth: {
        getUser: async () => ({ data: { user: { id: 'admin-id' } }, error: null })
      },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { role: 'school_admin', is_active: true, school_id: 'sch-uuid-123' }, error: null })
          })
        })
      }),
      rpc: async (fnName: string, args: any) => {
        if (fnName === 'admin_create_school_document') {
          rpcDraftCalled = true;
          return {
            data: {
              document_id: 'doc-uuid-456',
              school_id: 'sch-uuid-123',
              storage_path: `sch-uuid-123/doc-uuid-456/original.${args.p_file_extension}`,
              status: 'draft'
            },
            error: null
          };
        }
        if (fnName === 'admin_finalize_school_document_upload') {
          rpcFinalizeCalled = true;
          return { data: { document_id: 'doc-uuid-456', status: 'draft' }, error: null };
        }
        return { data: null, error: null };
      },
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, bytes: Uint8Array, options: any) => {
            storagePathPassed = path;
            uploadOptionsPassed = options;
            return { data: { path }, error: null };
          }
        })
      }
    };
  };

  const req = new Request('http://localhost/admin-school-document-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer admin-jwt'
    },
    body: JSON.stringify({
      title: 'Règlement Intérieur 2026',
      category: 'rules',
      target_scope: 'school',
      file_name: 'reglement.pdf',
      mime_type: 'application/pdf',
      file_base64: validPdfBase64
    })
  });

  const res = await handleAdminUploadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.success, true);
  assertEquals(json.document_id, 'doc-uuid-456');
  assertEquals(rpcDraftCalled, true);
  assertEquals(rpcFinalizeCalled, true);
  // Vérification exigence 6 : upsert = false
  assertEquals(uploadOptionsPassed?.upsert, false);
  // Vérification exigence 7 : chemin canonique généré côté serveur
  assertEquals(storagePathPassed, 'sch-uuid-123/doc-uuid-456/original.pdf');
});

Deno.test('5. Admin Upload Handler - Fichier supérieur à 15 MiB -> 413', async () => {
  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'admin-id' } }, error: null })
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'school_admin', is_active: true, school_id: 'sch-1' }, error: null })
        })
      })
    })
  });

  // Créer un buffer artificiel > 15MB base64
  const hugeBytes = new Uint8Array(16 * 1024 * 1024); // 16 MB
  hugeBytes[0] = 0x25; hugeBytes[1] = 0x50; hugeBytes[2] = 0x44; hugeBytes[3] = 0x46; hugeBytes[4] = 0x2D; // %PDF-
  let binary = '';
  for (let i = 0; i < 1000; i++) binary += String.fromCharCode(hugeBytes[i]);
  // Simuler le décodage qui dépasse 15MB via string répété
  const mockHugeBase64 = btoa(new Array(16 * 1024 * 1024).fill('A').join(''));

  const req = new Request('http://localhost/admin-school-document-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer admin-jwt'
    },
    body: JSON.stringify({
      title: 'Huge File',
      category: 'rules',
      target_scope: 'school',
      file_name: 'huge.pdf',
      mime_type: 'application/pdf',
      file_base64: mockHugeBase64
    })
  });

  const res = await handleAdminUploadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 413);
  const json = await res.json();
  assertStringIncludes(json.error, 'taille maximale');
});

Deno.test('8. Admin Upload Handler - Échec upload Storage -> Brouillon nettoyé (admin_cleanup_failed_draft)', async () => {
  let cleanupDraftCalled = false;

  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'admin-id' } }, error: null })
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'school_admin', is_active: true, school_id: 'sch-1' }, error: null })
        })
      })
    }),
    rpc: async (fnName: string, args: any) => {
      if (fnName === 'admin_create_school_document') {
        return { data: { document_id: 'doc-failed-upload', storage_path: 'sch-1/doc-failed-upload/original.pdf' }, error: null };
      }
      if (fnName === 'admin_cleanup_failed_draft') {
        cleanupDraftCalled = true;
        assertEquals(args.p_document_id, 'doc-failed-upload');
        return { data: { cleaned_up: true }, error: null };
      }
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        upload: async () => {
          return { data: null, error: { message: 'Storage quota exceeded' } };
        }
      })
    }
  });

  const req = new Request('http://localhost/admin-school-document-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer admin-jwt'
    },
    body: JSON.stringify({
      title: 'Failed Upload Doc',
      category: 'rules',
      target_scope: 'school',
      file_name: 'reglement.pdf',
      mime_type: 'application/pdf',
      file_base64: validPdfBase64
    })
  });

  const res = await handleAdminUploadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 500);
  assertEquals(cleanupDraftCalled, true);
});

Deno.test('9. Admin Upload Handler - Échec finalisation -> Objet Storage supprimé ET brouillon nettoyé', async () => {
  let storageRemoveCalled = false;
  let cleanupDraftCalled = false;

  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'admin-id' } }, error: null })
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'school_admin', is_active: true, school_id: 'sch-1' }, error: null })
        })
      })
    }),
    rpc: async (fnName: string, args: any) => {
      if (fnName === 'admin_create_school_document') {
        return { data: { document_id: 'doc-failed-finalize', storage_path: 'sch-1/doc-failed-finalize/original.pdf' }, error: null };
      }
      if (fnName === 'admin_finalize_school_document_upload') {
        return { data: null, error: { message: 'DB Constraint Failure' } };
      }
      if (fnName === 'admin_cleanup_failed_draft') {
        cleanupDraftCalled = true;
        assertEquals(args.p_document_id, 'doc-failed-finalize');
        return { data: { cleaned_up: true }, error: null };
      }
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'sch-1/doc-failed-finalize/original.pdf' }, error: null }),
        remove: async (paths: string[]) => {
          storageRemoveCalled = true;
          assertEquals(paths[0], 'sch-1/doc-failed-finalize/original.pdf');
          return { data: paths, error: null };
        }
      })
    }
  });

  const req = new Request('http://localhost/admin-school-document-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer admin-jwt'
    },
    body: JSON.stringify({
      title: 'Failed Finalize Doc',
      category: 'rules',
      target_scope: 'school',
      file_name: 'reglement.pdf',
      mime_type: 'application/pdf',
      file_base64: validPdfBase64
    })
  });

  const res = await handleAdminUploadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 500);
  assertEquals(storageRemoveCalled, true);
  assertEquals(cleanupDraftCalled, true);
});

// Utility functions testing
Deno.test('Magic Bytes - PDF/PNG/JPEG Validation & Fake Detection', () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]);
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF]);
  const fakeBytes = new TextEncoder().encode('Hello World Fake');

  assertEquals(validateMagicBytes(pdfBytes, 'doc.pdf', 'application/pdf').isValid, true);
  assertEquals(validateMagicBytes(pngBytes, 'img.png', 'image/png').isValid, true);
  assertEquals(validateMagicBytes(jpegBytes, 'pic.jpg', 'image/jpeg').isValid, true);
  assertEquals(validateMagicBytes(fakeBytes, 'fake.pdf', 'application/pdf').isValid, false);
});
