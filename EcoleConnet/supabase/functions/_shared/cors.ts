// supabase/functions/_shared/cors.ts

const DEFAULT_ALLOWED_ORIGINS = [
  'https://ecolelink.com',
  'https://www.ecolelink.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

/**
 * Resolves the application URL and origin with strict brand priority:
 * 1. ECOLELINK_APP_URL (environment variable - highest priority)
 * 2. ecoleconnectAppUrl (optional historical argument passed by caller)
 * 3. ECOLECONNECT_APP_URL (temporary environment fallback)
 * 4. SITE_URL (global Supabase environment variable)
 * 5. https://ecolelink.com (final production fallback)
 */
export function resolveAppUrl(ecoleconnectAppUrl?: string | null): string {
  const getEnv = (key: string): string | undefined => {
    try {
      if (typeof Deno !== 'undefined' && Deno.env && typeof Deno.env.get === 'function') {
        return Deno.env.get(key);
      }
    } catch {
      // Ignore environment lookup failures
    }
    return undefined;
  };

  const candidates: Array<string | undefined | null> = [
    getEnv('ECOLELINK_APP_URL'),
    ecoleconnectAppUrl,
    getEnv('ECOLECONNECT_APP_URL'),
    getEnv('SITE_URL'),
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Invalid URL syntax, proceed safely to next fallback
    }
  }

  return 'https://ecolelink.com';
}

export function getAllowedOrigins(ecoleconnectAppUrl?: string | null): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  const resolvedOrigin = resolveAppUrl(ecoleconnectAppUrl);
  if (resolvedOrigin) {
    allowed.add(resolvedOrigin);
  }
  return allowed;
}

export interface CorsResult {
  isAllowed: boolean;
  headers: Record<string, string>;
  origin: string | null;
}

export function buildCorsHeaders(req: Request, ecoleconnectAppUrl?: string | null): CorsResult {
  const origin = req.headers.get('Origin') || req.headers.get('origin');
  const allowedSet = getAllowedOrigins(ecoleconnectAppUrl);

  let allowOriginHeader: string;
  let isAllowed = true;

  if (origin) {
    if (allowedSet.has(origin)) {
      allowOriginHeader = origin;
      isAllowed = true;
    } else {
      allowOriginHeader = resolveAppUrl(ecoleconnectAppUrl);
      isAllowed = false;
    }
  } else {
    allowOriginHeader = resolveAppUrl(ecoleconnectAppUrl);
    isAllowed = true;
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOriginHeader,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };

  return { isAllowed, headers, origin };
}
