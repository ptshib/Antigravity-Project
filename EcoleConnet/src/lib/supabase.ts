import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseKey &&
  supabaseUrl.startsWith('https://') &&
  !supabaseUrl.includes('your-project-id')
);

if (!isSupabaseConfigured) {
  console.warn(
    '[ÉcoleConnect] Supabase n’est pas configuré dans .env.local. ' +
    'Le mode Démonstration et le site public restent entièrement fonctionnels. ' +
    'Pour activer l’authentification réelle, créez le fichier .env.local avec VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY.'
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
