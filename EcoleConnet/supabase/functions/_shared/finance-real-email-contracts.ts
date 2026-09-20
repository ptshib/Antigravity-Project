// supabase/functions/_shared/finance-real-email-contracts.ts

export interface CampaignClaim {
  campaign_id: string;
  school_id: string;
  channel: 'email';
  recipient_count: number;
  from_name: string | null;
  reply_to_email: string | null;
  daily_quota: number;
}

export interface RealEmailJobClaim {
  job_id: string;
  recipient_id: string;
  provider_idempotency_key: string;
  provider_request_payload: Record<string, unknown>;
  canonical_payload_hash: string;
  first_provider_attempt_at: string | null;
  attempt_count: number;
}

export interface ProviderRequestPayload {
  from: string;
  to: [string];
  subject: string;
  html: string;
  reply_to?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_REGEX = /^[0-9a-f]{64}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_REGEX.test(val);
}

export function isValidHash(val: unknown): val is string {
  return typeof val === 'string' && HASH_REGEX.test(val);
}

export function validateCampaignClaim(item: unknown): CampaignClaim {
  if (!item || typeof item !== 'object') {
    throw new Error('REJET CONTRACT: Campaign claim must be an object');
  }
  const obj = item as Record<string, unknown>;

  if (!isValidUuid(obj.campaign_id)) {
    throw new Error('REJET CONTRACT: campaign_id invalid UUID');
  }
  if (!isValidUuid(obj.school_id)) {
    throw new Error('REJET CONTRACT: school_id invalid UUID');
  }
  if (obj.channel !== 'email') {
    throw new Error('REJET CONTRACT: channel must be strictly "email"');
  }
  if (typeof obj.recipient_count !== 'number' || !Number.isInteger(obj.recipient_count) || obj.recipient_count < 0) {
    throw new Error('REJET CONTRACT: recipient_count must be integer >= 0');
  }
  if (obj.from_name !== null && typeof obj.from_name !== 'string') {
    throw new Error('REJET CONTRACT: from_name must be string or null');
  }
  if (obj.reply_to_email !== null && typeof obj.reply_to_email !== 'string') {
    throw new Error('REJET CONTRACT: reply_to_email must be string or null');
  }
  if (
    typeof obj.daily_quota !== 'number' ||
    !Number.isInteger(obj.daily_quota) ||
    obj.daily_quota < 1 ||
    obj.daily_quota > 100
  ) {
    throw new Error('REJET CONTRACT: daily_quota must be integer between 1 and 100');
  }

  return {
    campaign_id: obj.campaign_id as string,
    school_id: obj.school_id as string,
    channel: 'email',
    recipient_count: obj.recipient_count as number,
    from_name: obj.from_name as string | null,
    reply_to_email: obj.reply_to_email as string | null,
    daily_quota: obj.daily_quota as number,
  };
}

export function validateProviderRequestPayload(payload: unknown): ProviderRequestPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('REJET CONTRACT: provider_request_payload must be an object');
  }
  const obj = payload as Record<string, unknown>;
  const keys = Object.keys(obj);
  const allowedKeys = new Set(['from', 'to', 'subject', 'html', 'reply_to']);

  for (const k of keys) {
    if (!allowedKeys.has(k)) {
      throw new Error(`REJET CONTRACT: Unknown key "${k}" in payload`);
    }
    const lowerK = k.toLowerCase();
    if (lowerK.includes('api_key') || lowerK.includes('token') || lowerK.includes('bearer') || lowerK.includes('secret')) {
      throw new Error(`REJET CONTRACT: Sensitive key "${k}" forbidden in payload`);
    }
  }

  const payloadStr = JSON.stringify(obj).toLowerCase();
  if (
    payloadStr.includes('api_key') ||
    payloadStr.includes('bearer ') ||
    payloadStr.includes('secret')
  ) {
    throw new Error('REJET CONTRACT: Payload contains forbidden sensitive string');
  }

  if (typeof obj.from !== 'string' || obj.from.trim() === '') {
    throw new Error('REJET CONTRACT: "from" must be non-empty string');
  }

  if (!Array.isArray(obj.to) || obj.to.length !== 1) {
    throw new Error('REJET CONTRACT: "to" must be array containing exactly 1 email');
  }
  const recipient = obj.to[0];
  if (typeof recipient !== 'string' || recipient.trim() === '' || !EMAIL_REGEX.test(recipient.trim())) {
    throw new Error('REJET CONTRACT: "to[0]" must be valid non-empty email string');
  }

  if (typeof obj.subject !== 'string' || obj.subject.trim() === '' || obj.subject.length > 1000) {
    throw new Error('REJET CONTRACT: "subject" must be non-empty string <= 1000 chars');
  }

  if (typeof obj.html !== 'string' || obj.html.trim() === '') {
    throw new Error('REJET CONTRACT: "html" must be non-empty string');
  }

  if (obj.reply_to !== undefined && obj.reply_to !== null) {
    if (typeof obj.reply_to !== 'string' || obj.reply_to.trim() === '') {
      throw new Error('REJET CONTRACT: "reply_to" if provided must be non-empty string');
    }
  }

  return {
    from: obj.from as string,
    to: [recipient] as [string],
    subject: obj.subject as string,
    html: obj.html as string,
    reply_to: obj.reply_to ? (obj.reply_to as string) : undefined,
  };
}

export function validateRealEmailJobClaim(item: unknown): RealEmailJobClaim {
  if (!item || typeof item !== 'object') {
    throw new Error('REJET CONTRACT: Real email job claim must be an object');
  }
  const obj = item as Record<string, unknown>;

  if (!isValidUuid(obj.job_id)) {
    throw new Error('REJET CONTRACT: job_id invalid UUID');
  }
  if (!isValidUuid(obj.recipient_id)) {
    throw new Error('REJET CONTRACT: recipient_id invalid UUID');
  }
  if (!isValidUuid(obj.provider_idempotency_key)) {
    throw new Error('REJET CONTRACT: provider_idempotency_key invalid UUID');
  }

  const validPayload = validateProviderRequestPayload(obj.provider_request_payload);

  if (!isValidHash(obj.canonical_payload_hash)) {
    throw new Error('REJET CONTRACT: canonical_payload_hash must be 64-char hex string');
  }

  if (obj.first_provider_attempt_at !== null && typeof obj.first_provider_attempt_at !== 'string') {
    throw new Error('REJET CONTRACT: first_provider_attempt_at must be ISO string or null');
  }

  if (typeof obj.attempt_count !== 'number' || !Number.isInteger(obj.attempt_count) || obj.attempt_count < 0) {
    throw new Error('REJET CONTRACT: attempt_count must be integer >= 0');
  }

  return {
    job_id: obj.job_id as string,
    recipient_id: obj.recipient_id as string,
    provider_idempotency_key: obj.provider_idempotency_key as string,
    provider_request_payload: validPayload as unknown as Record<string, unknown>,
    canonical_payload_hash: (obj.canonical_payload_hash as string).toLowerCase(),
    first_provider_attempt_at: obj.first_provider_attempt_at as string | null,
    attempt_count: obj.attempt_count as number,
  };
}

export async function computeCanonicalPayloadHash(payload: Record<string, unknown>): Promise<string> {
  const jsonStr = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
