// supabase/functions/tests/financeRealEmailFunctions.test.ts

import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  validateCampaignClaim,
  validateRealEmailJobClaim,
  validateProviderRequestPayload,
  computeCanonicalPayloadHash,
} from '../_shared/finance-real-email-contracts.ts';
import { ResendClient, FetchTransport } from '../_shared/resend-client.ts';
import { processRealEmailCampaignsHandler } from '../process-real-email-campaigns/index.ts';
import {
  resendDeliveryWebhookHandler,
  verifySvixSignature,
  constantTimeCompare,
} from '../resend-delivery-webhook/index.ts';

// Helper for test Svix signature generation
async function generateTestSvixSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  secret: string
): Promise<string> {
  const cleanedSecret = secret.startsWith('whsec_') ? secret.substring(6) : secret;
  const binaryString = atob(cleanedSecret);
  const keyBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    keyBytes[i] = binaryString.charCodeAt(i);
  }
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(signedContent).buffer as ArrayBuffer
  );
  let binary = '';
  const bytes = new Uint8Array(sigBuffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `v1,${btoa(binary)}`;
}

const TEST_WEBHOOK_SECRET = 'whsec_dGVzdF9zZWNyZXRfMTIzNDU2Nzg5MDEyMzQ1Ng==';
const WORKER_SECRET = 'test-worker-secret-12345';

// Strict fake transport: throws if URL is not expected
const createFakeTransport = (
  expectedStatus = 200,
  responseObj: Record<string, unknown> = { id: 'msg_test_123' },
  options: { delayMs?: number; throwNetworkErr?: boolean } = {}
): FetchTransport => {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== 'https://api.resend.com/emails') {
      throw new Error(`UNEXPECTED NETWORK CALL to ${url}`);
    }
    if (options.throwNetworkErr) {
      throw new Error('Simulated network failure');
    }
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (init?.signal?.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    return new Response(JSON.stringify(responseObj), {
      status: expectedStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  };
};

// --- CATEGORY A: WORKER & AUTHENTICATION (8 TESTS) ---

Deno.test('A1: Worker rejects non-POST HTTP methods with 405', async () => {
  const req = new Request('http://localhost/process-real-email-campaigns', { method: 'GET' });
  const res = await processRealEmailCampaignsHandler(req);
  assertEquals(res.status, 405);
});

Deno.test('A2: Worker rejects request without Authorization header with 401', async () => {
  Deno.env.set('FINANCE_EMAIL_WORKER_SECRET', WORKER_SECRET);
  const req = new Request('http://localhost/process-real-email-campaigns', { method: 'POST' });
  const res = await processRealEmailCampaignsHandler(req);
  assertEquals(res.status, 401);
});

Deno.test('A3: Worker rejects request with incorrect secret with 401', async () => {
  Deno.env.set('FINANCE_EMAIL_WORKER_SECRET', WORKER_SECRET);
  const req = new Request('http://localhost/process-real-email-campaigns', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer wrong-secret' },
  });
  const res = await processRealEmailCampaignsHandler(req);
  assertEquals(res.status, 401);
});

Deno.test('A4: Worker mode missing defaults to disabled and returns 200 zero summary', async () => {
  Deno.env.set('FINANCE_EMAIL_WORKER_SECRET', WORKER_SECRET);
  Deno.env.delete('REAL_EMAIL_TRANSPORT_MODE');
  const req = new Request('http://localhost/process-real-email-campaigns', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WORKER_SECRET}` },
  });
  const res = await processRealEmailCampaignsHandler(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.campaigns_claimed, 0);
  assertEquals(json.jobs_claimed, 0);
  assertEquals(json.submitted, 0);
});

Deno.test('A5: Worker mode invalid defaults to disabled', async () => {
  Deno.env.set('FINANCE_EMAIL_WORKER_SECRET', WORKER_SECRET);
  Deno.env.set('REAL_EMAIL_TRANSPORT_MODE', 'unrecognized_mode');
  const req = new Request('http://localhost/process-real-email-campaigns', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WORKER_SECRET}` },
  });
  const res = await processRealEmailCampaignsHandler(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.campaigns_claimed, 0);
});

Deno.test('A6: Worker mode disabled performs zero RPCs and zero fetches', async () => {
  Deno.env.set('FINANCE_EMAIL_WORKER_SECRET', WORKER_SECRET);
  Deno.env.set('REAL_EMAIL_TRANSPORT_MODE', 'disabled');
  let fetchCalled = false;
  const transport: FetchTransport = async () => {
    fetchCalled = true;
    return new Response();
  };
  const req = new Request('http://localhost/process-real-email-campaigns', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WORKER_SECRET}` },
  });
  const res = await processRealEmailCampaignsHandler(req, transport);
  assertEquals(res.status, 200);
  assertEquals(fetchCalled, false);
});

Deno.test('A7: Worker rejects body specifying school_id or campaign_id with 400', async () => {
  Deno.env.set('FINANCE_EMAIL_WORKER_SECRET', WORKER_SECRET);
  Deno.env.set('REAL_EMAIL_TRANSPORT_MODE', 'test');
  Deno.env.set('SUPABASE_URL', 'https://mock.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'mock-service-role-key');
  Deno.env.set('RESEND_API_KEY', 'mock-resend-key');

  const req = new Request('http://localhost/process-real-email-campaigns', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WORKER_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ school_id: 'a0000000-0000-0000-0000-000000000001' }),
  });
  const res = await processRealEmailCampaignsHandler(req);
  assertEquals(res.status, 400);
});

Deno.test('A8: Worker mode live fails closed if required env vars missing', async () => {
  Deno.env.set('FINANCE_EMAIL_WORKER_SECRET', WORKER_SECRET);
  Deno.env.set('REAL_EMAIL_TRANSPORT_MODE', 'live');
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');

  const req = new Request('http://localhost/process-real-email-campaigns', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WORKER_SECRET}` },
  });
  const res = await processRealEmailCampaignsHandler(req);
  assertEquals(res.status, 500);
});

// --- CATEGORY B: PAYLOAD & HASH CONTRACTS (8 TESTS) ---

Deno.test('B1: Valid campaign claim accepted by validator', () => {
  const valid = {
    campaign_id: 'a0000000-0000-0000-0000-000000000001',
    school_id: 'b0000000-0000-0000-0000-000000000002',
    channel: 'email',
    recipient_count: 10,
    from_name: 'Test School',
    reply_to_email: 'reply@test.org',
    daily_quota: 50,
  };
  const res = validateCampaignClaim(valid);
  assertEquals(res.campaign_id, valid.campaign_id);
  assertEquals(res.daily_quota, 50);
});

Deno.test('B2: Campaign claim with invalid daily_quota rejected', () => {
  const invalid = {
    campaign_id: 'a0000000-0000-0000-0000-000000000001',
    school_id: 'b0000000-0000-0000-0000-000000000002',
    channel: 'email',
    recipient_count: 10,
    from_name: null,
    reply_to_email: null,
    daily_quota: 200, // max is 100
  };
  assertThrows(() => validateCampaignClaim(invalid));
});

Deno.test('B3: Provider payload with unknown key rejected', () => {
  const invalid = {
    from: 'sender@test.org',
    to: ['parent@test.org'],
    subject: 'Rappel',
    html: '<p>Body</p>',
    unknown_field: 'forbidden',
  };
  assertThrows(() => validateProviderRequestPayload(invalid));
});

Deno.test('B4: Provider payload with secret substring rejected', () => {
  const invalid = {
    from: 'sender@test.org',
    to: ['parent@test.org'],
    subject: 'Rappel api_key contained',
    html: '<p>Body</p>',
  };
  assertThrows(() => validateProviderRequestPayload(invalid));
});

Deno.test('B5: Provider payload with multiple recipients rejected', () => {
  const invalid = {
    from: 'sender@test.org',
    to: ['p1@test.org', 'p2@test.org'],
    subject: 'Rappel',
    html: '<p>Body</p>',
  };
  assertThrows(() => validateProviderRequestPayload(invalid));
});

Deno.test('B6: SHA-256 hash calculation matches expected hex format', async () => {
  const payload = {
    from: 'System <no-reply@test.org>',
    to: ['parent@domain.org'],
    subject: 'Facture N100',
    html: '<p>Solde dû: 50 USD</p>',
  };
  const hash = await computeCanonicalPayloadHash(payload);
  assertEquals(hash.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(hash), true);
});

Deno.test('B7: Real email job claim validated successfully with matching hash', async () => {
  const payload = {
    from: 'System <no-reply@test.org>',
    to: ['parent@domain.org'],
    subject: 'Facture N100',
    html: '<p>Solde dû</p>',
  };
  const hash = await computeCanonicalPayloadHash(payload);
  const job = {
    job_id: 'c0000000-0000-0000-0000-000000000003',
    recipient_id: 'd0000000-0000-0000-0000-000000000004',
    provider_idempotency_key: 'e0000000-0000-0000-0000-000000000005',
    provider_request_payload: payload,
    canonical_payload_hash: hash,
    first_provider_attempt_at: null,
    attempt_count: 0,
  };
  const res = validateRealEmailJobClaim(job);
  assertEquals(res.job_id, job.job_id);
  assertEquals(res.canonical_payload_hash, hash);
});

Deno.test('B8: Real email job claim with invalid UUID rejected', () => {
  const invalidJob = {
    job_id: 'invalid-uuid-string',
    recipient_id: 'd0000000-0000-0000-0000-000000000004',
    provider_idempotency_key: 'e0000000-0000-0000-0000-000000000005',
    provider_request_payload: {
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'sub',
      html: 'html',
    },
    canonical_payload_hash: 'a'.repeat(64),
    first_provider_attempt_at: null,
    attempt_count: 0,
  };
  assertThrows(() => validateRealEmailJobClaim(invalidJob));
});

// --- CATEGORY C: RESEND CLIENT & STATUS MAPPING (11 TESTS) ---

Deno.test('C1: ResendClient sends correct headers and body', async () => {
  let authHeader = '';
  let idempotencyHeader = '';
  let capturedBody: string | null = null;

  const mockTransport: FetchTransport = async (input, init) => {
    const headers = new Headers(init?.headers);
    authHeader = headers.get('Authorization') || '';
    idempotencyHeader = headers.get('Idempotency-Key') || '';
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ id: 'msg_999' }), { status: 200 });
  };

  const client = new ResendClient({
    apiKey: 'mock-key-123',
    fetchFn: mockTransport,
  });

  const payload = { from: 'a@b.com', to: ['c@d.com'], subject: 'test', html: 'text' };
  const res = await client.sendEmail('idem-key-456', payload);

  assertEquals(res.ok, true);
  assertEquals(res.providerMessageId, 'msg_999');
  assertEquals(authHeader, 'Bearer mock-key-123');
  assertEquals(idempotencyHeader, 'idem-key-456');
  assertEquals(capturedBody, JSON.stringify(payload));
});

Deno.test('C2: Resend HTTP 200 returns submitted', async () => {
  const client = new ResendClient({
    apiKey: 'mock-key',
    fetchFn: createFakeTransport(200, { id: 'msg_ok' }),
  });
  const res = await client.sendEmail('key-1', { from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h' });
  assertEquals(res.ok, true);
  assertEquals(res.providerMessageId, 'msg_ok');
});

Deno.test('C3: Resend HTTP 409 concurrent_idempotent_requests parsed', async () => {
  const client = new ResendClient({
    apiKey: 'mock-key',
    fetchFn: createFakeTransport(409, { name: 'concurrent_idempotent_requests', message: 'In progress' }),
  });
  const res = await client.sendEmail('key-1', { from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h' });
  assertEquals(res.ok, false);
  assertEquals(res.status, 409);
  assertEquals(res.errorCode, 'concurrent_idempotent_requests');
});

Deno.test('C4: Resend HTTP 409 invalid_idempotent_request parsed', async () => {
  const client = new ResendClient({
    apiKey: 'mock-key',
    fetchFn: createFakeTransport(409, { name: 'invalid_idempotent_request', message: 'Mismatch' }),
  });
  const res = await client.sendEmail('key-1', { from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h' });
  assertEquals(res.ok, false);
  assertEquals(res.status, 409);
  assertEquals(res.errorCode, 'invalid_idempotent_request');
});

Deno.test('C5: Resend HTTP 429 rate limit parsed', async () => {
  const client = new ResendClient({
    apiKey: 'mock-key',
    fetchFn: createFakeTransport(429, { name: 'rate_limit_exceeded', message: 'Too many requests' }),
  });
  const res = await client.sendEmail('key-1', { from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h' });
  assertEquals(res.status, 429);
  assertEquals(res.ok, false);
});

Deno.test('C6: Resend HTTP 500 server error parsed', async () => {
  const client = new ResendClient({
    apiKey: 'mock-key',
    fetchFn: createFakeTransport(500, { name: 'internal_server_error', message: 'Resend down' }),
  });
  const res = await client.sendEmail('key-1', { from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h' });
  assertEquals(res.status, 500);
  assertEquals(res.ok, false);
});

Deno.test('C7: Resend HTTP 400 deterministic client error parsed', async () => {
  const client = new ResendClient({
    apiKey: 'mock-key',
    fetchFn: createFakeTransport(400, { name: 'invalid_from_address', message: 'Domain unverified' }),
  });
  const res = await client.sendEmail('key-1', { from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h' });
  assertEquals(res.status, 400);
  assertEquals(res.ok, false);
  assertEquals(res.errorCode, 'invalid_from_address');
});

Deno.test('C8: Resend timeout / abort returns isAbortError', async () => {
  const client = new ResendClient({
    apiKey: 'mock-key',
    fetchFn: createFakeTransport(200, {}, { delayMs: 100 }),
    timeoutMs: 10,
  });
  const res = await client.sendEmail('key-1', { from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h' });
  assertEquals(res.isAbortError, true);
  assertEquals(res.ok, false);
});

Deno.test('C9: Resend network failure returns isNetworkError', async () => {
  const client = new ResendClient({
    apiKey: 'mock-key',
    fetchFn: createFakeTransport(200, {}, { throwNetworkErr: true }),
  });
  const res = await client.sendEmail('key-1', { from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h' });
  assertEquals(res.isNetworkError, true);
  assertEquals(res.ok, false);
});

Deno.test('C10: Fake transport fails immediately if calling non-Resend URL', async () => {
  const transport = createFakeTransport();
  await assertRejects(async () => {
    await transport('https://malicious-external-site.com/api');
  });
});

Deno.test('C11: Resend HTTP 503 service unavailable parsed', async () => {
  const client = new ResendClient({
    apiKey: 'mock-key',
    fetchFn: createFakeTransport(503, { name: 'service_unavailable', message: 'Service Unavailable' }),
  });
  const res = await client.sendEmail('key-1', { from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h' });
  assertEquals(res.status, 503);
  assertEquals(res.ok, false);
});

// --- CATEGORY D: CONFIDENTIALITY & LOGGING RULES (2 TESTS) ---

Deno.test('D1: ResendClient contains no logging of API key or email', async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const client = new ResendClient({
      apiKey: 'mock_dummy_key_9999',
      fetchFn: createFakeTransport(200, { id: 'msg_1' }),
    });
    await client.sendEmail('key-1', { from: 'secret@parent.org', to: ['target@domain.org'], subject: 'sub', html: 'html' });
  } finally {
    console.log = originalLog;
  }

  assertEquals(logs.length, 0);
});

Deno.test('D2: Worker HTTP response contains no sensitive fields', async () => {
  Deno.env.set('FINANCE_EMAIL_WORKER_SECRET', WORKER_SECRET);
  Deno.env.set('REAL_EMAIL_TRANSPORT_MODE', 'disabled');

  const req = new Request('http://localhost/process-real-email-campaigns', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WORKER_SECRET}` },
  });
  const res = await processRealEmailCampaignsHandler(req);
  const json = await res.json();

  const keys = Object.keys(json).sort();
  const expectedKeys = [
    'campaigns_claimed',
    'errors_count',
    'jobs_claimed',
    'network_unknown',
    'retry_wait',
    'submitted',
    'terminal_failed',
  ].sort();

  assertEquals(keys, expectedKeys);
});

// --- CATEGORY E: WEBHOOK SVIX VERIFICATION & EVENT MAPPINGS (19 TESTS) ---

Deno.test('E1: Webhook rejects non-POST methods with 405', async () => {
  const req = new Request('http://localhost/resend-delivery-webhook', { method: 'GET' });
  const res = await resendDeliveryWebhookHandler(req);
  assertEquals(res.status, 405);
});

Deno.test('E2: Webhook rejects missing secret with 401', async () => {
  Deno.env.delete('RESEND_WEBHOOK_SECRET');
  const req = new Request('http://localhost/resend-delivery-webhook', { method: 'POST' });
  const res = await resendDeliveryWebhookHandler(req);
  assertEquals(res.status, 401);
});

Deno.test('E3: Webhook rejects missing Svix headers with 401', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    body: JSON.stringify({ type: 'email.delivered' }),
  });
  const res = await resendDeliveryWebhookHandler(req);
  assertEquals(res.status, 401);
});

Deno.test('E4: Webhook rejects invalid signature with 401', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  const body = JSON.stringify({ type: 'email.delivered' });
  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': 'msg_test_id',
      'svix-timestamp': `${Math.floor(Date.now() / 1000)}`,
      'svix-signature': 'v1,invalid_base64_signature',
    },
    body,
  });
  const res = await resendDeliveryWebhookHandler(req);
  assertEquals(res.status, 401);
});

Deno.test('E5: Webhook rejects tampered body with 401', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  const svixId = 'msg_test_id_100';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const originalBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'msg_1' } });
  const sig = await generateTestSvixSignature(originalBody, svixId, timestamp, TEST_WEBHOOK_SECRET);

  const tamperedBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'msg_TAMPERED' } });

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    },
    body: tamperedBody,
  });

  const res = await resendDeliveryWebhookHandler(req);
  assertEquals(res.status, 401);
});

Deno.test('E6: Webhook accepts valid signature for email.delivered -> delivered', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  let passedEventType = '';
  const mockSupabase = {
    rpc: async (fnName: string, params: any) => {
      if (fnName === '_ingest_delivery_event') {
        passedEventType = params.p_event_type;
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    },
  };

  const svixId = 'msg_deliv_001';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const rawBody = JSON.stringify({
    type: 'email.delivered',
    created_at: '2026-09-20T10:00:00Z',
    data: { email_id: 'msg_deliv_123', id: 'evt_deliv_001' },
  });
  const sig = await generateTestSvixSignature(rawBody, svixId, timestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  const res = await resendDeliveryWebhookHandler(req, mockSupabase);
  assertEquals(res.status, 200);
  assertEquals(passedEventType, 'delivered');
});

Deno.test('E7: Webhook accepts valid signature for email.bounced -> bounced', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  let passedEventType = '';
  const mockSupabase = {
    rpc: async (fnName: string, params: any) => {
      if (fnName === '_ingest_delivery_event') {
        passedEventType = params.p_event_type;
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    },
  };

  const svixId = 'msg_bounce_001';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const rawBody = JSON.stringify({
    type: 'email.bounced',
    created_at: '2026-09-20T10:00:00Z',
    data: { email_id: 'msg_bounce_123', id: 'evt_bounce_001' },
  });
  const sig = await generateTestSvixSignature(rawBody, svixId, timestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  const res = await resendDeliveryWebhookHandler(req, mockSupabase);
  assertEquals(res.status, 200);
  assertEquals(passedEventType, 'bounced');
});

Deno.test('E8: Webhook accepts valid signature for email.complained -> complained', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  let passedEventType = '';
  const mockSupabase = {
    rpc: async (fnName: string, params: any) => {
      if (fnName === '_ingest_delivery_event') {
        passedEventType = params.p_event_type;
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    },
  };

  const svixId = 'msg_comp_001';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const rawBody = JSON.stringify({
    type: 'email.complained',
    created_at: '2026-09-20T10:00:00Z',
    data: { email_id: 'msg_comp_123', id: 'evt_comp_001' },
  });
  const sig = await generateTestSvixSignature(rawBody, svixId, timestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  const res = await resendDeliveryWebhookHandler(req, mockSupabase);
  assertEquals(res.status, 200);
  assertEquals(passedEventType, 'complained');
});

Deno.test('E9: Webhook accepts valid signature for email.failed -> delivery_failed', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  let passedEventType = '';
  const mockSupabase = {
    rpc: async (fnName: string, params: any) => {
      if (fnName === '_ingest_delivery_event') {
        passedEventType = params.p_event_type;
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    },
  };

  const svixId = 'msg_fail_001';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const rawBody = JSON.stringify({
    type: 'email.failed',
    created_at: '2026-09-20T10:00:00Z',
    data: { email_id: 'msg_fail_123', id: 'evt_fail_001' },
  });
  const sig = await generateTestSvixSignature(rawBody, svixId, timestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  const res = await resendDeliveryWebhookHandler(req, mockSupabase);
  assertEquals(res.status, 200);
  assertEquals(passedEventType, 'delivery_failed');
});

Deno.test('E10: Webhook email.failed calls _ingest_delivery_event exactly once with delivery_failed', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  let rpcCallCount = 0;
  let receivedEventType = '';

  const mockSupabase = {
    rpc: async (fnName: string, params: any) => {
      if (fnName === '_ingest_delivery_event') {
        rpcCallCount++;
        receivedEventType = params.p_event_type;
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    },
  };

  const svixId = 'msg_fail_exact_001';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const rawBody = JSON.stringify({
    type: 'email.failed',
    created_at: '2026-09-20T10:00:00Z',
    data: { email_id: 'msg_fail_exact_123', id: 'evt_fail_exact_001' },
  });
  const sig = await generateTestSvixSignature(rawBody, svixId, timestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  const res = await resendDeliveryWebhookHandler(req, mockSupabase);
  assertEquals(res.status, 200);
  assertEquals(rpcCallCount, 1);
  assertEquals(receivedEventType, 'delivery_failed');
});

Deno.test('E11: Webhook email.delivery_failed treated as unknown signed event returning 200 ignored: true', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  let rpcCallCount = 0;

  const mockSupabase = {
    rpc: async () => {
      rpcCallCount++;
      return { data: null, error: null };
    },
  };

  const svixId = 'msg_obsolete_name';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const rawBody = JSON.stringify({
    type: 'email.delivery_failed', // Obsolete name, should be ignored!
    data: { email_id: 'msg_123' },
  });
  const sig = await generateTestSvixSignature(rawBody, svixId, timestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  const res = await resendDeliveryWebhookHandler(req, mockSupabase);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.ignored, true);
  assertEquals(rpcCallCount, 0);
});

Deno.test('E12: Webhook email.delivery_failed causes zero RPC calls', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  let rpcCalled = false;

  const mockSupabase = {
    rpc: async () => {
      rpcCalled = true;
      return { data: null, error: null };
    },
  };

  const svixId = 'msg_zero_rpc';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const rawBody = JSON.stringify({
    type: 'email.delivery_failed',
    data: { email_id: 'msg_zero' },
  });
  const sig = await generateTestSvixSignature(rawBody, svixId, timestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  await resendDeliveryWebhookHandler(req, mockSupabase);
  assertEquals(rpcCalled, false);
});

Deno.test('E13: Webhook secret with whsec_ prefix handled correctly', async () => {
  const secretWithPrefix = 'whsec_dGVzdF9zZWNyZXRfMTIzNDU2Nzg5MDEyMzQ1Ng==';
  const rawBody = JSON.stringify({ type: 'email.failed', data: { email_id: 'msg_1' } });
  const svixId = 'msg_prefix_test';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const sig = await generateTestSvixSignature(rawBody, svixId, timestamp, secretWithPrefix);

  const isValid = await verifySvixSignature(rawBody, svixId, timestamp, sig, secretWithPrefix);
  assertEquals(isValid, true);
});

Deno.test('E14: Webhook multiple space-separated signatures supported and v1 selected', async () => {
  const secret = TEST_WEBHOOK_SECRET;
  const rawBody = JSON.stringify({ type: 'email.failed', data: { email_id: 'msg_1' } });
  const svixId = 'msg_multi_sig';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const validSig = await generateTestSvixSignature(rawBody, svixId, timestamp, secret);
  const multiSigHeader = `v2,dummy_sig_2 ${validSig} v1,other_dummy`;

  const isValid = await verifySvixSignature(rawBody, svixId, timestamp, multiSigHeader, secret);
  assertEquals(isValid, true);
});

Deno.test('E15: Webhook rejects expired timestamp (>300s past)', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  const svixId = 'msg_old_timestamp';
  const expiredTimestamp = `${Math.floor(Date.now() / 1000) - 400}`;
  const rawBody = JSON.stringify({ type: 'email.failed', data: { email_id: 'msg_1' } });

  const sig = await generateTestSvixSignature(rawBody, svixId, expiredTimestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': expiredTimestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  const res = await resendDeliveryWebhookHandler(req);
  assertEquals(res.status, 401);
});

Deno.test('E16: Webhook rejects future timestamp outside tolerance (>300s future)', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  const svixId = 'msg_forward_timestamp';
  const forwardTimestamp = `${Math.floor(Date.now() / 1000) + 400}`;
  const rawBody = JSON.stringify({ type: 'email.failed', data: { email_id: 'msg_1' } });

  const sig = await generateTestSvixSignature(rawBody, svixId, forwardTimestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': forwardTimestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  const res = await resendDeliveryWebhookHandler(req);
  assertEquals(res.status, 401);
});

Deno.test('E17: Webhook rejects malformed secret gracefully without throwing exception', async () => {
  const malformedSecret = 'whsec_!!!invalid_base64!!!';
  const rawBody = JSON.stringify({ type: 'email.failed', data: { email_id: 'msg_1' } });
  const svixId = 'msg_malformed_secret';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;

  const isValid = await verifySvixSignature(rawBody, svixId, timestamp, 'v1,some_sig', malformedSecret);
  assertEquals(isValid, false);
});

Deno.test('E18: Webhook constantTimeCompare handles different lengths safely without exception', () => {
  const match = constantTimeCompare('abcdef', 'abcdef');
  const mismatchDiffLength = constantTimeCompare('abc', 'abcdef');
  const mismatchSameLength = constantTimeCompare('abcdef', 'abcdeg');

  assertEquals(match, true);
  assertEquals(mismatchDiffLength, false);
  assertEquals(mismatchSameLength, false);
});

Deno.test('E19: Webhook rejects oversized body (>64KB) with 400', async () => {
  Deno.env.set('RESEND_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
  const svixId = 'msg_oversized';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const oversizedData = 'x'.repeat(70000);
  const rawBody = JSON.stringify({ type: 'email.failed', data: { extra: oversizedData } });

  const sig = await generateTestSvixSignature(rawBody, svixId, timestamp, TEST_WEBHOOK_SECRET);

  const req = new Request('http://localhost/resend-delivery-webhook', {
    method: 'POST',
    headers: {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    },
    body: rawBody,
  });

  const res = await resendDeliveryWebhookHandler(req);
  assertEquals(res.status, 400);
});
