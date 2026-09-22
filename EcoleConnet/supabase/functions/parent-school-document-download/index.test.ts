// Deno Tests : Tests réels des handlers HTTP pour parent-school-document-download Edge Function
// Fichier : supabase/functions/parent-school-document-download/index.test.ts

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handleParentDownloadRequest } from './index.ts';

const mockEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-secret',
  ECOLECONNECT_APP_URL: 'http://localhost:5173'
};

const getMockEnv = (key: string) => (mockEnv as any)[key];

Deno.test('10. Parent Download Handler - JWT absent -> 401', async () => {
  const req = new Request('http://localhost/parent-school-document-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: 'stu-1', document_id: 'doc-1' })
  });

  const res = await handleParentDownloadRequest(req, { getEnv: getMockEnv });
  assertEquals(res.status, 401);
  const json = await res.json();
  assertStringIncludes(json.error, 'Authorization manquant');
});

Deno.test('11. Parent Download Handler - JWT invalide -> 401', async () => {
  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: { message: 'Invalid token' } })
    }
  });

  const req = new Request('http://localhost/parent-school-document-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer invalid-jwt'
    },
    body: JSON.stringify({ student_id: 'stu-1', document_id: 'doc-1' })
  });

  const res = await handleParentDownloadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 401);
  const json = await res.json();
  assertStringIncludes(json.error, 'non authentifié');
});

Deno.test('12. Parent Download Handler - RPC d’autorisation refusée -> 403 (Aucune signed URL créée)', async () => {
  let createSignedUrlCalled = false;

  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'parent-id' } }, error: null })
    },
    rpc: async (fnName: string) => {
      if (fnName === 'authorize_parent_document_download') {
        return { data: null, error: { message: 'REJET ACCÈS : Vous n’avez pas le lien parental approuvé.' } };
      }
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          createSignedUrlCalled = true;
          return { data: { signedUrl: 'https://test/signed' }, error: null };
        }
      })
    }
  });

  const req = new Request('http://localhost/parent-school-document-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer parent-jwt'
    },
    body: JSON.stringify({ student_id: 'stu-unauthorized', document_id: 'doc-1' })
  });

  const res = await handleParentDownloadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 403);
  const json = await res.json();
  assertStringIncludes(json.error, 'REJET ACCÈS');
  assertEquals(createSignedUrlCalled, false);
});

Deno.test('13. Parent Download Handler - Document autorisé -> createSignedUrl appelé avec TTL 120 (200 OK)', async () => {
  let pathPassed = '';
  let ttlPassed = 0;

  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'parent-id' } }, error: null })
    },
    rpc: async (fnName: string) => {
      if (fnName === 'authorize_parent_document_download') {
        return {
          data: {
            document_id: 'doc-123',
            school_id: 'sch-1',
            student_id: 'stu-1',
            file_name: 'bulletin_info.pdf',
            file_size_bytes: 2048,
            mime_type: 'application/pdf',
            storage_path: 'sch-1/doc-123/original.pdf',
            checksum_sha256: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890'
          },
          error: null
        };
      }
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => {
          pathPassed = path;
          ttlPassed = ttl;
          return { data: { signedUrl: `https://test.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=secret-token` }, error: null };
        }
      })
    }
  });

  const req = new Request('http://localhost/parent-school-document-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer parent-jwt'
    },
    body: JSON.stringify({ student_id: 'stu-1', document_id: 'doc-123' })
  });

  const res = await handleParentDownloadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.success, true);
  assertEquals(json.expires_in_seconds, 120);
  assertStringIncludes(json.download_url, 'secret-token');
  assertEquals(pathPassed, 'sch-1/doc-123/original.pdf');
  assertEquals(ttlPassed, 120);
});

Deno.test('14. Parent Download Handler - Erreur createSignedUrl -> Réponse 500 sans fuite de storage_path', async () => {
  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'parent-id' } }, error: null })
    },
    rpc: async () => ({
      data: {
        document_id: 'doc-123',
        storage_path: 'sch-1/doc-123/original.pdf',
        file_name: 'test.pdf'
      },
      error: null
    }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: null, error: { message: 'Storage connection failure' } })
      })
    }
  });

  const req = new Request('http://localhost/parent-school-document-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer parent-jwt'
    },
    body: JSON.stringify({ student_id: 'stu-1', document_id: 'doc-123' })
  });

  const res = await handleParentDownloadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 500);
  const json = await res.json();
  assertStringIncludes(json.error, 'génération de l’URL');
  assertEquals(json.storage_path, undefined);
});

Deno.test('15. Parent Download Handler - Réponse 200 OK ne contient NI service_role key NI storage_path', async () => {
  const mockCreateClientFn = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'parent-id' } }, error: null })
    },
    rpc: async () => ({
      data: {
        document_id: 'doc-789',
        file_name: 'doc.pdf',
        file_size_bytes: 1024,
        mime_type: 'application/pdf',
        storage_path: 'sch-1/doc-789/original.pdf',
        checksum_sha256: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890'
      },
      error: null
    }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://test/signed-url-token' }, error: null })
      })
    }
  });

  const req = new Request('http://localhost/parent-school-document-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer parent-jwt'
    },
    body: JSON.stringify({ student_id: 'stu-1', document_id: 'doc-789' })
  });

  const res = await handleParentDownloadRequest(req, { getEnv: getMockEnv, createClientFn: mockCreateClientFn as any });
  assertEquals(res.status, 200);
  const json = await res.json();

  assertEquals(json.storage_path, undefined);
  assertEquals(json.service_role, undefined);
  assertEquals(json.service_role_key, undefined);
  assertEquals(json.serviceKey, undefined);
  assertEquals(json.success, true);
  assertStringIncludes(json.download_url, 'https://test/signed-url-token');
});
