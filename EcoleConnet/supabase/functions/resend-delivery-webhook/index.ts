// supabase/functions/resend-delivery-webhook/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let dummy = 0;
    for (let i = 0; i < a.length; i++) {
      dummy |= a.charCodeAt(i);
    }
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function verifySvixSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): Promise<boolean> {
  try {
    if (!svixId || !svixTimestamp || !svixSignature || !secret) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const tsInt = parseInt(svixTimestamp, 10);
    if (isNaN(tsInt) || Math.abs(now - tsInt) > 300) {
      return false;
    }

    const cleanedSecret = secret.startsWith('whsec_') ? secret.substring(6) : secret;
    let keyBytes: Uint8Array;
    try {
      keyBytes = base64ToUint8Array(cleanedSecret);
      if (keyBytes.length === 0) return false;
    } catch {
      return false;
    }

    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const encoder = new TextEncoder();

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      encoder.encode(signedContent).buffer as ArrayBuffer
    );
    const computedBase64 = uint8ArrayToBase64(new Uint8Array(signatureBuffer));
    const expectedSig = `v1,${computedBase64}`;

    const sigTokens = svixSignature.trim().split(/\s+/);
    const v1Tokens = sigTokens.filter((token) => token.startsWith('v1,'));

    if (v1Tokens.length === 0) {
      return false;
    }

    for (const token of v1Tokens) {
      if (constantTimeCompare(token, expectedSig)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function resendDeliveryWebhookHandler(
  req: Request,
  customSupabaseClient?: any
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!webhookSecret || webhookSecret.trim() === '') {
    return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response(JSON.stringify({ error: 'Missing Svix signature headers' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let rawBodyText = '';
  try {
    rawBodyText = await req.text();
    if (!rawBodyText || rawBodyText.length > 65536) {
      return new Response(JSON.stringify({ error: 'Invalid or oversized body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to read request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isValidSig = await verifySvixSignature(
    rawBodyText,
    svixId,
    svixTimestamp,
    svixSignature,
    webhookSecret
  );

  if (!isValidSig) {
    return new Response(JSON.stringify({ error: 'Invalid Svix signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let bodyObj: Record<string, unknown>;
  try {
    bodyObj = JSON.parse(rawBodyText);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawEventType = typeof bodyObj.type === 'string' ? bodyObj.type : '';

  // Mapping exact Resend Webhook -> SQL Event Type:
  // email.delivered -> delivered
  // email.bounced   -> bounced
  // email.complained -> complained
  // email.failed    -> delivery_failed
  // NOTE: email.delivery_failed is NOT in typeMap and will return { ignored: true } without RPC call.
  const typeMap: Record<string, 'delivered' | 'bounced' | 'complained' | 'delivery_failed'> = {
    'email.delivered': 'delivered',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.failed': 'delivery_failed',
    'delivered': 'delivered',
    'bounced': 'bounced',
    'complained': 'complained',
    'failed': 'delivery_failed',
  };

  const mappedEventType = typeMap[rawEventType];

  if (!mappedEventType) {
    return new Response(JSON.stringify({ ignored: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dataObj = (typeof bodyObj.data === 'object' && bodyObj.data !== null ? bodyObj.data : {}) as Record<string, unknown>;

  const providerEventId =
    (typeof dataObj.id === 'string' && dataObj.id) ||
    (typeof bodyObj.id === 'string' && bodyObj.id) ||
    svixId;

  const providerMessageId =
    (typeof dataObj.email_id === 'string' && dataObj.email_id) ||
    (typeof dataObj.message_id === 'string' && dataObj.message_id) ||
    (typeof dataObj.id === 'string' && dataObj.id);

  if (!providerMessageId) {
    return new Response(JSON.stringify({ error: 'Missing provider_message_id in webhook payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const occurredAt =
    (typeof dataObj.created_at === 'string' && dataObj.created_at) ||
    (typeof bodyObj.created_at === 'string' && bodyObj.created_at) ||
    new Date().toISOString();

  const filteredPayload = {
    type: rawEventType,
    created_at: occurredAt,
    svix_id: svixId,
  };

  let supabase = customSupabaseClient;

  if (!supabase) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  const { data: ingestRes, error: ingestErr } = await supabase.rpc('_ingest_delivery_event', {
    p_provider: 'resend',
    p_provider_event_id: providerEventId,
    p_provider_message_id: providerMessageId,
    p_event_type: mappedEventType,
    p_event_occurred_at: occurredAt,
    p_payload: filteredPayload,
  });

  if (ingestErr) {
    return new Response(JSON.stringify({ error: ingestErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, result: ingestRes }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) {
  Deno.serve((req) => resendDeliveryWebhookHandler(req));
}
