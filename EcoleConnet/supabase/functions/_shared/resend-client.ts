// supabase/functions/_shared/resend-client.ts

export type FetchTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ResendClientOptions {
  apiKey: string;
  fetchFn?: FetchTransport;
  timeoutMs?: number;
}

export interface ResendSendResult {
  status: number;
  ok: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponseJson?: Record<string, unknown>;
  isAbortError?: boolean;
  isNetworkError?: boolean;
}

export class ResendClient {
  private apiKey: string;
  private fetchFn: FetchTransport;
  private timeoutMs: number;

  constructor(options: ResendClientOptions) {
    if (!options.apiKey || options.apiKey.trim() === '') {
      throw new Error('ResendClient: apiKey is required');
    }
    this.apiKey = options.apiKey.trim();
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  public async sendEmail(
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<ResendSendResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    const bodyString = JSON.stringify(payload);

    try {
      const response = await this.fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: bodyString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const status = response.status;
      const ok = response.ok;
      let jsonBody: Record<string, unknown> | null = null;
      let textBody = '';

      try {
        textBody = await response.text();
        if (textBody) {
          jsonBody = JSON.parse(textBody);
        }
      } catch {
        // Body was not valid JSON
      }

      if (ok && jsonBody && (typeof jsonBody.id === 'string' || typeof jsonBody.message_id === 'string')) {
        const messageId = (jsonBody.id || jsonBody.message_id) as string;
        return {
          status,
          ok: true,
          providerMessageId: messageId,
          rawResponseJson: jsonBody,
        };
      }

      const errCode = jsonBody?.name ? String(jsonBody.name) : `HTTP_${status}`;
      const errMessage = jsonBody?.message ? String(jsonBody.message) : (textBody.substring(0, 200) || `HTTP Error ${status}`);

      return {
        status,
        ok: false,
        errorCode: errCode,
        errorMessage: errMessage,
        rawResponseJson: jsonBody || { raw: textBody.substring(0, 200) },
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        controller.signal.aborted;

      if (isAbort) {
        return {
          status: 0,
          ok: false,
          errorCode: 'TIMEOUT_ABORT',
          errorMessage: 'Request timed out or was aborted',
          isAbortError: true,
        };
      }

      return {
        status: 0,
        ok: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Network error occurred',
        isNetworkError: true,
      };
    }
  }
}
