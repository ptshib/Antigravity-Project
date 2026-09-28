// supabase/functions/tests/hotfixCorsWildcards.test.ts

import { assertEquals, assertNotEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createSchoolAdminHandler } from '../create-school-admin/index.ts';
import { manageSchoolAdminHandler } from '../manage-school-admin/index.ts';
import { generateReportCardPdfsHandler } from '../generate-report-card-pdfs/index.ts';

// 1. Static check: Zero wildcards in the 3 functions
Deno.test('Static Audit: No wildcard Access-Control-Allow-Origin: * in the 3 Edge Functions', async () => {
  const filePaths = [
    'supabase/functions/create-school-admin/index.ts',
    'supabase/functions/manage-school-admin/index.ts',
    'supabase/functions/generate-report-card-pdfs/index.ts',
  ];

  for (const path of filePaths) {
    const content = await Deno.readTextFile(path);
    assertNotEquals(
      content.includes("'Access-Control-Allow-Origin': '*'"),
      true,
      `File ${path} still contains single-quoted wildcard`
    );
    assertNotEquals(
      content.includes('"Access-Control-Allow-Origin": "*"'),
      true,
      `File ${path} still contains double-quoted wildcard`
    );
    assertNotEquals(
      content.includes('Access-Control-Allow-Origin: *'),
      true,
      `File ${path} still contains wildcard string`
    );
  }
});

// 2. create-school-admin CORS Tests
Deno.test('create-school-admin: OPTIONS from https://ecolelink.com returns 200 with dynamic origin', async () => {
  const req = new Request('https://edge.example.com/create-school-admin', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
  const res = await createSchoolAdminHandler(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertEquals(res.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type');
  assertEquals(res.headers.get('Vary'), 'Origin');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('create-school-admin: OPTIONS from https://malicious.example is rejected with 403 without wildcard', async () => {
  const req = new Request('https://edge.example.com/create-school-admin', {
    method: 'OPTIONS',
    headers: { 'Origin': 'https://malicious.example' },
  });
  const res = await createSchoolAdminHandler(req);
  assertEquals(res.status, 403);
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://malicious.example');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('create-school-admin: POST without auth returns 401 with CORS headers and preserves auth controls', async () => {
  const req = new Request('https://edge.example.com/create-school-admin', {
    method: 'POST',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ school_id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com' }),
  });
  const res = await createSchoolAdminHandler(req);
  assertEquals(res.status, 401);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('create-school-admin: request without Origin header succeeds without error', async () => {
  const req = new Request('https://edge.example.com/create-school-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const res = await createSchoolAdminHandler(req);
  assertEquals(res.status, 401);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
});

// 3. manage-school-admin CORS Tests
Deno.test('manage-school-admin: OPTIONS from https://ecolelink.com returns 200 with dynamic origin', async () => {
  const req = new Request('https://edge.example.com/manage-school-admin', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
  const res = await manageSchoolAdminHandler(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertEquals(res.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type');
  assertEquals(res.headers.get('Vary'), 'Origin');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('manage-school-admin: OPTIONS from https://malicious.example is rejected with 403 without wildcard', async () => {
  const req = new Request('https://edge.example.com/manage-school-admin', {
    method: 'OPTIONS',
    headers: { 'Origin': 'https://malicious.example' },
  });
  const res = await manageSchoolAdminHandler(req);
  assertEquals(res.status, 403);
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://malicious.example');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('manage-school-admin: POST without auth returns 401 with CORS headers and preserves auth controls', async () => {
  const req = new Request('https://edge.example.com/manage-school-admin', {
    method: 'POST',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'delete_admin' }),
  });
  const res = await manageSchoolAdminHandler(req);
  assertEquals(res.status, 401);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

// 4. generate-report-card-pdfs CORS Tests
Deno.test('generate-report-card-pdfs: OPTIONS from https://ecolelink.com returns 200 without executing business logic', async () => {
  const req = new Request('https://edge.example.com/generate-report-card-pdfs', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
  const res = await generateReportCardPdfsHandler(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertEquals(res.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type');
  assertEquals(res.headers.get('Vary'), 'Origin');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('generate-report-card-pdfs: OPTIONS from https://malicious.example is rejected with 403 without wildcard', async () => {
  const req = new Request('https://edge.example.com/generate-report-card-pdfs', {
    method: 'OPTIONS',
    headers: { 'Origin': 'https://malicious.example' },
  });
  const res = await generateReportCardPdfsHandler(req);
  assertEquals(res.status, 403);
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://malicious.example');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('generate-report-card-pdfs: error response (missing token) returns 401 with CORS headers', async () => {
  const req = new Request('https://edge.example.com/generate-report-card-pdfs', {
    method: 'POST',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ batch_id: '11111111-1111-4111-8111-111111111111' }),
  });
  const res = await generateReportCardPdfsHandler(req);
  assertEquals(res.status, 401);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

// 5. Environmental Resolution & Priority Tests
Deno.test('CORS System: ECOLELINK_APP_URL environment variable has highest priority', async () => {
  Deno.env.set('ECOLELINK_APP_URL', 'https://custom-app.ecolelink.com');
  Deno.env.set('ECOLECONNECT_APP_URL', 'https://old-app.ecoleconnect.app');
  try {
    const req = new Request('https://edge.example.com/create-school-admin', {
      method: 'OPTIONS',
      headers: { 'Origin': 'https://custom-app.ecolelink.com' },
    });
    const res = await createSchoolAdminHandler(req);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://custom-app.ecolelink.com');
  } finally {
    Deno.env.delete('ECOLELINK_APP_URL');
    Deno.env.delete('ECOLECONNECT_APP_URL');
  }
});

Deno.test('CORS System: ECOLECONNECT_APP_URL fallback is functional when ECOLELINK_APP_URL is absent', async () => {
  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.set('ECOLECONNECT_APP_URL', 'https://legacy.ecoleconnect.app');
  try {
    const req = new Request('https://edge.example.com/manage-school-admin', {
      method: 'OPTIONS',
      headers: { 'Origin': 'https://legacy.ecoleconnect.app' },
    });
    const res = await manageSchoolAdminHandler(req);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://legacy.ecoleconnect.app');
  } finally {
    Deno.env.delete('ECOLECONNECT_APP_URL');
  }
});
