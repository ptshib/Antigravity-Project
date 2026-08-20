import { createClient } from '@supabase/supabase-js';

const metaEnv = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
const supabaseUrl = (metaEnv.VITE_SUPABASE_URL || '').trim();
const supabaseKey = (metaEnv.VITE_SUPABASE_PUBLISHABLE_KEY || metaEnv.VITE_SUPABASE_ANON_KEY || '').trim();

function validateSupabaseConfig(rawUrl: string, rawKey: string): boolean {
  if (!rawUrl || !rawKey) return false;

  // Rejeter les clés fictives ou exemples
  if (
    rawKey === 'placeholder-anon-key' ||
    rawKey === 'your-anon-key' ||
    rawKey === 'your-publishable-key' ||
    rawKey.includes('placeholder')
  ) {
    return false;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return false;
  }

  const { protocol, hostname, port } = parsedUrl;

  // Rejeter les placeholders d'URL connus
  if (
    hostname.includes('placeholder-unconfigured') ||
    hostname.includes('your-project-id')
  ) {
    return false;
  }

  // 1. Validation Environnement Local
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    if (protocol !== 'http:') return false;
    if (port !== '54321') return false;

    const isValidLocalKey =
      rawKey.startsWith('sb_publishable_') ||
      rawKey.startsWith('eyJ') ||
      (rawKey.length > 20 && !rawKey.includes('placeholder'));

    return isValidLocalKey;
  }

  // 2. Validation Environnement Distant
  if (protocol === 'https:') {
    if (!hostname.includes('.')) return false;
    return rawKey.length > 20;
  }

  return false;
}

export const isSupabaseConfigured = validateSupabaseConfig(supabaseUrl, supabaseKey);

if (!isSupabaseConfigured) {
  console.warn(
    '[ÉcoleConnect] Supabase n’est pas configuré. ' +
    'Le mode Démonstration et le site public restent entièrement fonctionnels.'
  );
}

// Single Supabase Client instance (uses dummy values if unconfigured so Vite won't throw at init)
export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://placeholder-unconfigured.supabase.co',
  isSupabaseConfigured ? supabaseKey : 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
