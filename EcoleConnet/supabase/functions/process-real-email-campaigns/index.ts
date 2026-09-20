// supabase/functions/process-real-email-campaigns/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  validateCampaignClaim,
  validateRealEmailJobClaim,
  computeCanonicalPayloadHash,
} from '../_shared/finance-real-email-contracts.ts';
import { ResendClient, FetchTransport } from '../_shared/resend-client.ts';

function constantTimeCompare(a: string, b: string): boolean {
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

export async function processRealEmailCampaignsHandler(
  req: Request,
  customFetchFn?: FetchTransport,
  customSupabaseClient?: any
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify internal worker authentication header
  const authHeader = req.headers.get('Authorization') || '';
  const expectedSecret = Deno.env.get('FINANCE_EMAIL_WORKER_SECRET');

  if (!expectedSecret || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.substring(7).trim();
  if (!constantTimeCompare(token, expectedSecret)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check execution mode
  const rawMode = (Deno.env.get('REAL_EMAIL_TRANSPORT_MODE') || 'disabled').toLowerCase().trim();
  const allowedModes = new Set(['disabled', 'test', 'live']);
  const mode = allowedModes.has(rawMode) ? rawMode : 'disabled';

  if (mode === 'disabled') {
    return new Response(
      JSON.stringify({
        campaigns_claimed: 0,
        jobs_claimed: 0,
        submitted: 0,
        retry_wait: 0,
        network_unknown: 0,
        terminal_failed: 0,
        errors_count: 0,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Deno.env.get('RESEND_API_KEY');

  if (mode === 'live' && (!supabaseUrl || !serviceRoleKey || !resendApiKey)) {
    return new Response(
      JSON.stringify({ error: 'Server misconfiguration: missing required env vars' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Read body safely if any (must not contain school_id / campaign_id selection)
  try {
    const text = await req.text();
    if (text && text.trim()) {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        if ('school_id' in parsed || 'campaign_id' in parsed || 'recipient_id' in parsed || 'payload' in parsed) {
          return new Response(JSON.stringify({ error: 'Caller payload parameters forbidden' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let supabase = customSupabaseClient;

  if (!supabase) {
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration: missing Supabase credentials' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  const fetchFn = customFetchFn || globalThis.fetch;
  const resendClient = new ResendClient({
    apiKey: resendApiKey || 'mock-key',
    fetchFn,
  });

  let campaignsClaimedCount = 0;
  let jobsClaimedCount = 0;
  let submittedCount = 0;
  let retryWaitCount = 0;
  let networkUnknownCount = 0;
  let terminalFailedCount = 0;
  let errorsCount = 0;

  try {
    // 1. Claim scheduled campaigns
    const { data: campaignsData, error: campaignsErr } = await supabase.rpc(
      '_claim_scheduled_real_email_campaigns',
      {
        p_batch_size: 5,
        p_worker_id: 'real-email-worker-1',
      }
    );

    if (campaignsErr) {
      errorsCount++;
      return new Response(
        JSON.stringify({
          campaigns_claimed: 0,
          jobs_claimed: 0,
          submitted: 0,
          retry_wait: 0,
          network_unknown: 0,
          terminal_failed: 0,
          errors_count: errorsCount,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const campaignsList = Array.isArray(campaignsData) ? campaignsData : [];

    for (const rawCamp of campaignsList) {
      let validatedCampaign;
      try {
        validatedCampaign = validateCampaignClaim(rawCamp);
        campaignsClaimedCount++;
      } catch {
        errorsCount++;
        continue;
      }

      // Create outbox jobs for campaign
      const { error: createJobsErr } = await supabase.rpc(
        '_create_real_email_jobs_for_campaign',
        {
          p_campaign_id: validatedCampaign.campaign_id,
        }
      );

      if (createJobsErr) {
        errorsCount++;
        continue;
      }

      // Claim outbox jobs for execution
      const { data: jobsData, error: claimJobsErr } = await supabase.rpc(
        '_claim_real_email_jobs',
        {
          p_school_id: validatedCampaign.school_id,
          p_campaign_id: validatedCampaign.campaign_id,
          p_batch_size: 10,
          p_lease_duration_seconds: 300,
          p_worker_id: 'real-email-worker-1',
        }
      );

      if (claimJobsErr) {
        errorsCount++;
        continue;
      }

      const jobsList = Array.isArray(jobsData) ? jobsData : [];

      for (const rawJob of jobsList) {
        let validatedJob;
        try {
          validatedJob = validateRealEmailJobClaim(rawJob);
          jobsClaimedCount++;
        } catch {
          errorsCount++;
          continue;
        }

        // Verify SHA-256 hash
        const computedHash = await computeCanonicalPayloadHash(validatedJob.provider_request_payload);
        if (computedHash.toLowerCase() !== validatedJob.canonical_payload_hash.toLowerCase()) {
          terminalFailedCount++;
          await supabase.rpc('_record_real_email_submission_result', {
            p_job_id: validatedJob.job_id,
            p_status: 'terminal_failed',
            p_provider_message_id: null,
            p_error_code: 'CANONICAL_HASH_MISMATCH',
            p_error_message: 'Payload hash verification failed before submission',
            p_request_payload: validatedJob.provider_request_payload,
            p_response_payload: { error: 'Hash mismatch' },
          });
          continue;
        }

        // Execute email sending via Resend client
        const resendRes = await resendClient.sendEmail(
          validatedJob.provider_idempotency_key,
          validatedJob.provider_request_payload
        );

        let mappedStatus: 'submitted' | 'retry_wait' | 'terminal_failed' | 'network_unknown' = 'terminal_failed';

        if (resendRes.ok && resendRes.providerMessageId) {
          mappedStatus = 'submitted';
        } else if (resendRes.status === 409) {
          const errStr = (resendRes.errorCode || '') + ' ' + (resendRes.errorMessage || '');
          if (errStr.includes('concurrent_idempotent_requests')) {
            mappedStatus = 'retry_wait';
          } else if (errStr.includes('invalid_idempotent_request')) {
            mappedStatus = 'terminal_failed';
          } else {
            mappedStatus = 'terminal_failed';
          }
        } else if (resendRes.status === 429) {
          mappedStatus = 'retry_wait';
        } else if (resendRes.status >= 500 && resendRes.status <= 599) {
          mappedStatus = 'retry_wait';
        } else if (resendRes.status >= 400 && resendRes.status <= 499) {
          mappedStatus = 'terminal_failed';
        } else if (resendRes.isAbortError || resendRes.isNetworkError) {
          mappedStatus = 'network_unknown';
        } else {
          mappedStatus = 'network_unknown';
        }

        if (mappedStatus === 'submitted') submittedCount++;
        else if (mappedStatus === 'retry_wait') retryWaitCount++;
        else if (mappedStatus === 'network_unknown') networkUnknownCount++;
        else if (mappedStatus === 'terminal_failed') terminalFailedCount++;

        await supabase.rpc('_record_real_email_submission_result', {
          p_job_id: validatedJob.job_id,
          p_status: mappedStatus,
          p_provider_message_id: resendRes.providerMessageId || null,
          p_error_code: resendRes.errorCode || null,
          p_error_message: resendRes.errorMessage || null,
          p_request_payload: validatedJob.provider_request_payload,
          p_response_payload: resendRes.rawResponseJson || {},
        });
      }
    }
  } catch {
    errorsCount++;
  }

  return new Response(
    JSON.stringify({
      campaigns_claimed: campaignsClaimedCount,
      jobs_claimed: jobsClaimedCount,
      submitted: submittedCount,
      retry_wait: retryWaitCount,
      network_unknown: networkUnknownCount,
      terminal_failed: terminalFailedCount,
      errors_count: errorsCount,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

if (import.meta.main) {
  Deno.serve((req) => processRealEmailCampaignsHandler(req));
}
