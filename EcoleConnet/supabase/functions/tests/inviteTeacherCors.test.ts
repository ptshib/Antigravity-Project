// supabase/functions/tests/inviteTeacherCors.test.ts

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildCorsHeaders, getAllowedOrigins } from '../_shared/cors.ts';
import { inviteSchoolTeacherHandler } from '../invite-school-teacher/index.ts';

Deno.test('CORS Utility: includes production and local origins', () => {
  const allowed = getAllowedOrigins('https://custom-domain.com');
  assertEquals(allowed.has('https://ecolelink.com'), true);
  assertEquals(allowed.has('https://www.ecolelink.com'), true);
  assertEquals(allowed.has('http://localhost:5173'), true);
  assertEquals(allowed.has('http://localhost:3000'), true);
  assertEquals(allowed.has('https://custom-domain.com'), true);
});

Deno.test('CORS Utility: preflight OPTIONS for https://ecolelink.com returns allowed CORS headers', () => {
  const req = new Request('https://edge.example.com/invite-school-teacher', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });

  const { isAllowed, headers } = buildCorsHeaders(req);
  assertEquals(isAllowed, true);
  assertEquals(headers['Access-Control-Allow-Origin'], 'https://ecolelink.com');
  assertEquals(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assertEquals(headers['Access-Control-Allow-Headers'], 'authorization, x-client-info, apikey, content-type');
});

Deno.test('CORS Utility: preflight OPTIONS for https://www.ecolelink.com', () => {
  const req = new Request('https://edge.example.com/invite-school-teacher', {
    method: 'OPTIONS',
    headers: { 'Origin': 'https://www.ecolelink.com' },
  });

  const { isAllowed, headers } = buildCorsHeaders(req);
  assertEquals(isAllowed, true);
  assertEquals(headers['Access-Control-Allow-Origin'], 'https://www.ecolelink.com');
});

Deno.test('CORS Utility: unauthorized origin is rejected (isAllowed = false)', () => {
  const req = new Request('https://edge.example.com/invite-school-teacher', {
    method: 'OPTIONS',
    headers: { 'Origin': 'https://unauthorized-malicious-domain.com' },
  });

  const { isAllowed, headers } = buildCorsHeaders(req);
  assertEquals(isAllowed, false);
  // Fallback origin header returned, but isAllowed is false
  assertNotEquals(headers['Access-Control-Allow-Origin'], 'https://unauthorized-malicious-domain.com');
});

Deno.test('Edge Function Handler: preflight OPTIONS from https://ecolelink.com returns 200 OK with CORS headers', async () => {
  const req = new Request('https://edge.example.com/invite-school-teacher', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Access-Control-Request-Method': 'POST',
    },
  });

  const res = await inviteSchoolTeacherHandler(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assertEquals(res.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type');
});

Deno.test('Edge Function Handler: unauthorized origin is rejected with 403 Forbidden and CORS headers', async () => {
  const req = new Request('https://edge.example.com/invite-school-teacher', {
    method: 'POST',
    headers: {
      'Origin': 'https://forbidden-domain.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ teacher_id: '11111111-1111-4111-8111-111111111111' }),
  });

  const res = await inviteSchoolTeacherHandler(req);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error, 'Origine CORS non autorisée.');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://forbidden-domain.com');
});

Deno.test('Edge Function Handler: error response (e.g. missing auth/env) contains CORS headers for authorized origin', async () => {
  const req = new Request('https://edge.example.com/invite-school-teacher', {
    method: 'POST',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ teacher_id: '11111111-1111-4111-8111-111111111111' }),
  });

  const res = await inviteSchoolTeacherHandler(req);
  // Status will be 500 (missing server env) or 401 (missing auth), but CORS headers MUST be present
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertEquals(res.headers.get('Vary'), 'Origin');
});
