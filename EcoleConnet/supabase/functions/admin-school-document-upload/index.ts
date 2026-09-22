// Supabase Edge Function : Upload sécurisé d'un document scolaire par l'Administrateur
// Fichier : supabase/functions/admin-school-document-upload/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { calculateSha256, validateMagicBytes, checkForForbiddenTextContent } from '../_shared/document-utils.ts';

export interface AdminUploadDeps {
  getEnv?: (key: string) => string | undefined;
  createClientFn?: typeof createClient;
}

export async function handleAdminUploadRequest(req: Request, deps: AdminUploadDeps = {}): Promise<Response> {
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
      JSON.stringify({ error: 'Méthode HTTP non autorisée. Seul POST est accepté.' }),
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

    // Client de l'utilisateur pour vérifier son identité & rôle
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

    // Vérification du rôle admin scolaire actif
    const { data: profile, error: profileErr } = await userClient
      .from('profiles')
      .select('role, is_active, school_id')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile || profile.role !== 'school_admin' || !profile.is_active || !profile.school_id) {
      return new Response(
        JSON.stringify({ error: 'Accès refusé. Seul un administrateur scolaire actif peut uploader un document.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    // Extraction des données du payload
    const bodyText = await req.text();
    if (bodyText.length > 22000000) {
      return new Response(
        JSON.stringify({ error: 'Le corps de la requête dépasse la taille maximale autorisée.' }),
        { status: 413, headers: corsHeaders }
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Format JSON invalide.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const {
      title,
      description,
      category,
      target_scope,
      class_id,
      student_id,
      file_name,
      mime_type,
      file_base64
    } = payload;

    if (!title || !category || !target_scope || !file_name || !mime_type || !file_base64) {
      return new Response(
        JSON.stringify({ error: 'Tous les champs requis (titre, catégorie, portée, nom de fichier, type MIME, contenu) doivent être fournis.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Décodage base64 des octets réels du fichier
    let rawBytes: Uint8Array;
    try {
      const binaryString = atob(file_base64.replace(/^data:[^;]+;base64,/, ''));
      rawBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        rawBytes[i] = binaryString.charCodeAt(i);
      }
    } catch {
      return new Response(
        JSON.stringify({ error: 'Encodage base64 invalide.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Validation 1 : Taille maximale 15 MiB
    const MAX_BYTES = 15 * 1024 * 1024; // 15728640 bytes
    if (rawBytes.length === 0 || rawBytes.length > MAX_BYTES) {
      return new Response(
        JSON.stringify({ error: `La taille du fichier (${rawBytes.length} octets) excède la limite maximale de 15 MiB.` }),
        { status: 413, headers: corsHeaders }
      );
    }

    // Validation 2 : Détection des contenus textuels dangereux (HTML, SVG, JS)
    if (checkForForbiddenTextContent(rawBytes)) {
      return new Response(
        JSON.stringify({ error: 'Contenu interdit détecté (HTML, SVG ou JavaScript est strictly prohibé).' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Validation 3 : Signature magique & extension
    const magicCheck = validateMagicBytes(rawBytes, file_name, mime_type);
    if (!magicCheck.isValid || !magicCheck.normalizedExt) {
      return new Response(
        JSON.stringify({ error: magicCheck.error || 'Fichier ou signature magique non valide.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Calcul du SHA-256 réel côté serveur
    const sha256Checksum = await calculateSha256(rawBytes);

    // ÉTAPE 1 : Créer le draft via la RPC utilisateur
    const { data: draftData, error: draftErr } = await userClient.rpc('admin_create_school_document', {
      p_title: title.trim(),
      p_description: description ? description.trim() : null,
      p_category: category,
      p_target_scope: target_scope,
      p_class_id: class_id || null,
      p_student_id: student_id || null,
      p_file_name: file_name.trim(),
      p_file_extension: magicCheck.normalizedExt
    });

    if (draftErr || !draftData || !draftData.document_id || !draftData.storage_path) {
      return new Response(
        JSON.stringify({ error: draftErr?.message || 'Impossible de créer le brouillon de document.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const documentId = draftData.document_id;
    const storagePath = draftData.storage_path;

    // Client Admin privilégié (Service Role) uniquement pour l'écriture dans Storage
    const adminStorageClient = createClientFn(supabaseUrl, supabaseServiceKey);

    // ÉTAPE 2 : Téléversement physique dans le bucket Storage privé avec upsert = false
    const { error: uploadErr } = await adminStorageClient.storage
      .from('school-documents')
      .upload(storagePath, rawBytes, {
        contentType: magicCheck.detectedMime!,
        upsert: false
      });

    if (uploadErr) {
      // Compensation 1 : Supprimer le draft en cas d'échec d'upload
      await userClient.rpc('admin_cleanup_failed_draft', { p_document_id: documentId });
      return new Response(
        JSON.stringify({ error: `Échec du stockage du fichier : ${uploadErr.message}. Le brouillon a été annulé.` }),
        { status: 500, headers: corsHeaders }
      );
    }

    // ÉTAPE 3 : Finalisation des métadonnées (taille réelle, mime, sha256)
    const { error: finalizeErr } = await userClient.rpc('admin_finalize_school_document_upload', {
      p_document_id: documentId,
      p_file_size_bytes: rawBytes.length,
      p_mime_type: magicCheck.detectedMime,
      p_checksum_sha256: sha256Checksum
    });

    if (finalizeErr) {
      // Compensation 2 : En cas d'échec de finalisation des métadonnées, supprimer l'objet Storage ET le draft
      await adminStorageClient.storage.from('school-documents').remove([storagePath]);
      await userClient.rpc('admin_cleanup_failed_draft', { p_document_id: documentId });
      return new Response(
        JSON.stringify({ error: `Échec de finalisation des métadonnées : ${finalizeErr.message}. L’upload a été annulé.` }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        document_id: documentId,
        status: 'draft',
        file_size_bytes: rawBytes.length,
        mime_type: magicCheck.detectedMime,
        checksum_sha256: sha256Checksum
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
  serve((req) => handleAdminUploadRequest(req));
}
