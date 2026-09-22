// Supabase Edge Function : Téléchargement sécurisé d'un document scolaire par le Parent (Génération Signed URL Storage)
// Fichier : supabase/functions/parent-school-document-download/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';

export interface ParentDownloadDeps {
  getEnv?: (key: string) => string | undefined;
  createClientFn?: typeof createClient;
}

export async function handleParentDownloadRequest(req: Request, deps: ParentDownloadDeps = {}): Promise<Response> {
  const getEnv = deps.getEnv ?? ((key: string) => Deno.env.get(key));
  const createClientFn = deps.createClientFn ?? createClient;

  const ecoleconnectAppUrl = getEnv('ECOLECONNECT_APP_URL') ?? getEnv('SITE_URL') ?? null;
  const { isAllowed, headers: corsHeaders } = buildCorsHeaders(req, ecoleconnectAppUrl);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!isAllowed) {
    return new Response(
      JSON.stringify({ error: 'Origine non autorisée par la politique CORS.' }),
      { status: 403, headers: corsHeaders }
    );
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Méthode HTTP non autorisée. Seul POST est accepted.' }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
    const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: 'Configuration serveur incomplet sur Supabase Edge.' }),
        { status: 500, headers: corsHeaders }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Jeton de sécurité Authorization manquant ou invalide.' }),
        { status: 401, headers: corsHeaders }
      );
    }

    // Client utilisateur pour exécuter la RPC d'autorisation sous auth.uid()
    const userClient = createClientFn(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Utilisateur non authentifié ou jeton expiré.' }),
        { status: 401, headers: corsHeaders }
      );
    }

    // Parse du payload
    const bodyText = await req.text();
    let payload: any;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Format JSON invalide.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const { student_id, document_id } = payload;
    if (!student_id || !document_id) {
      return new Response(
        JSON.stringify({ error: 'Paramètres student_id et document_id requis.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // ÉTAPE 1 : Exécuter la RPC d'autorisation sous l'identité de l'utilisateur Parent
    const { data: authData, error: authErr } = await userClient.rpc('authorize_parent_document_download', {
      p_student_id: student_id,
      p_document_id: document_id
    });

    if (authErr || !authData || !authData.storage_path) {
      return new Response(
        JSON.stringify({ error: authErr?.message || 'Accès refusé au document demandé.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    const storagePath = authData.storage_path;

    // ÉTAPE 2 : Générer l'URL signée Storage via le client service-role avec un TTL strict de 120 secondes
    const adminStorageClient = createClientFn(supabaseUrl, supabaseServiceKey);
    const { data: signedUrlData, error: signedUrlErr } = await adminStorageClient.storage
      .from('school-documents')
      .createSignedUrl(storagePath, 120);

    if (signedUrlErr || !signedUrlData?.signedUrl) {
      return new Response(
        JSON.stringify({ error: 'Échec de la génération de l’URL sécurisée de téléchargement.' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Restituer uniquement l'URL signée à durée limitée et les métadonnées de fichier
    return new Response(
      JSON.stringify({
        success: true,
        download_url: signedUrlData.signedUrl,
        expires_in_seconds: 120,
        file_name: authData.file_name,
        file_size_bytes: authData.file_size_bytes,
        mime_type: authData.mime_type,
        checksum_sha256: authData.checksum_sha256
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Une erreur serveur inattendue est survenue.' }),
      { status: 500, headers: corsHeaders }
    );
  }
}

if (import.meta.main) {
  serve((req) => handleParentDownloadRequest(req));
}
