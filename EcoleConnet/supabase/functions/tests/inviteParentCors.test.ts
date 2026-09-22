// supabase/functions/tests/inviteParentCors.test.ts

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { inviteSchoolParentHandler } from '../invite-school-parent/index.ts';

Deno.test('Edge Function Handler (Parent): preflight OPTIONS from https://ecolelink.com returns 200 OK with CORS headers', async () => {
  const req = new Request('https://edge.example.com/invite-school-parent', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });

  const res = await inviteSchoolParentHandler(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assertEquals(res.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type');
});

Deno.test('Edge Function Handler (Parent): preflight OPTIONS from https://www.ecolelink.com', async () => {
  const req = new Request('https://edge.example.com/invite-school-parent', {
    method: 'OPTIONS',
    headers: { 'Origin': 'https://www.ecolelink.com' },
  });

  const res = await inviteSchoolParentHandler(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://www.ecolelink.com');
});

Deno.test('Edge Function Handler (Parent): unauthorized origin is rejected with 403 Forbidden and CORS headers', async () => {
  const req = new Request('https://edge.example.com/invite-school-parent', {
    method: 'POST',
    headers: {
      'Origin': 'https://forbidden-malicious-domain.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      first_name: 'Jean',
      last_name: 'Dupont',
      email: 'parent@example.com',
      student_ids: ['11111111-1111-4111-8111-111111111111'],
    }),
  });

  const res = await inviteSchoolParentHandler(req);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error, 'Origine CORS non autorisée.');
  assertNotEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://forbidden-malicious-domain.com');
});

Deno.test('Edge Function Handler (Parent): error response (e.g. missing auth/env) contains CORS headers for authorized origin', async () => {
  const req = new Request('https://edge.example.com/invite-school-parent', {
    method: 'POST',
    headers: {
      'Origin': 'https://ecolelink.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      first_name: 'Jean',
      last_name: 'Dupont',
      email: 'parent@example.com',
      student_ids: ['11111111-1111-4111-8111-111111111111'],
    }),
  });

  const res = await inviteSchoolParentHandler(req);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  assertEquals(res.headers.get('Vary'), 'Origin');
});
