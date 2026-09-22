// supabase/functions/_shared/cors.ts

const DEFAULT_ALLOWED_ORIGINS = [
  'https://ecolelink.com',
  'https://www.ecolelink.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

export function getAllowedOrigins(ecoleconnectAppUrl?: string | null): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  if (ecoleconnectAppUrl) {
    try {
      const parsed = new URL(ecoleconnectAppUrl);
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (isLocal || parsed.protocol === 'https:') {
        allowed.add(parsed.origin);
      }
    } catch {
      // Ignore invalid app URL
    }
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
      allowOriginHeader = Array.from(allowedSet)[0]; // fallback domain https://ecolelink.com
      isAllowed = false;
    }
  } else {
    allowOriginHeader = Array.from(allowedSet)[0];
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
