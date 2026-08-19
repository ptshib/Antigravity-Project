// Supabase Edge Function : Invitation d'un Enseignant (School Teacher)
// Fichier : supabase/functions/invite-school-teacher/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req) => {
  // 1. Validation de la méthode HTTP (Point 7)
  if (req.method !== 'POST' && req.method !== 'OPTIONS') {
    return new Response(
      JSON.stringify({ error: 'Méthode HTTP non autorisée. Seules POST et OPTIONS sont acceptées.' }),
      { status: 405, headers: { 'Content-Type': 'application/json', 'Allow': 'POST, OPTIONS' } }
    );
  }

  // 2. Configuration Fail-Closed des variables d'environnement (Point 8)
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const ecoleconnectAppUrl = Deno.env.get('ECOLECONNECT_APP_URL');

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey || !ecoleconnectAppUrl) {
    console.error('Configuration serveur manquante : Variables d’environnement non définies.');
    return new Response(
      JSON.stringify({ error: 'Erreur de configuration serveur. Le service d’invitation est indisponible.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Validation HTTPS obligatoire hors localhost/127.0.0.1
  let allowedOrigin: string;
  try {
    const parsedAppUrl = new URL(ecoleconnectAppUrl);
    const isLocal = parsedAppUrl.hostname === 'localhost' || parsedAppUrl.hostname === '127.0.0.1';
    if (!isLocal && parsedAppUrl.protocol !== 'https:') {
      throw new Error('L’URL d’application doit impérativement utiliser le protocole HTTPS en dehors de l’environnement local.');
    }
    allowedOrigin = parsedAppUrl.origin;
  } catch (err: any) {
    console.error('ECOLECONNECT_APP_URL invalide :', err.message);
    return new Response(
      JSON.stringify({ error: 'Erreur de configuration de l’URL d’application.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 3. Gestion des en-têtes CORS stricts sans localhost:3000
  const reqOrigin = req.headers.get('Origin');
  if (reqOrigin && reqOrigin !== allowedOrigin) {
    return new Response(
      JSON.stringify({ error: 'Origine CORS non autorisée.' }),
      { status: 403, headers: { 'Content-Type': 'application/json', 'Vary': 'Origin' } }
    );
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 4. Validation du Content-Type
  const contentType = req.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return new Response(
      JSON.stringify({ error: 'Content-Type doit être application/json.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  // 5. Lecture et vérification de la taille UTF-8 réelle du corps (< 10 KB)
  const rawText = await req.text();
  const byteLength = new TextEncoder().encode(rawText).length;
  if (byteLength > 10240) {
    return new Response(
      JSON.stringify({ error: 'Taille du corps de requête supérieure à 10 KB refusée.' }),
      { status: 413, headers: corsHeaders }
    );
  }

  let body: any;
  try {
    body = JSON.parse(rawText);
  } catch {
    return new Response(
      JSON.stringify({ error: 'Corps de requête JSON invalide.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return new Response(
      JSON.stringify({ error: 'Le corps de requête doit être un objet JSON simple.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const allowedKeys = new Set(['teacher_id', 'action']);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return new Response(
        JSON.stringify({ error: `Clé non autorisée "${key}" dans le corps de requête.` }),
        { status: 400, headers: corsHeaders }
      );
    }
  }

  const { teacher_id, action = 'invite' } = body;

  if (!teacher_id || typeof teacher_id !== 'string' || !UUID_REGEX.test(teacher_id)) {
    return new Response(
      JSON.stringify({ error: 'L’identifiant teacher_id doit être un UUID valide.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  if (action !== 'invite' && action !== 'reinvite') {
    return new Response(
      JSON.stringify({ error: 'Action non reconnue. Seules "invite" et "reinvite" sont autorisées.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    // 6. Vérification du jeton JWT de l'appelant
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Jeton Authorization manquant.' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: callerUser }, error: callerAuthError } = await supabaseClient.auth.getUser();
    if (callerAuthError || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'Utilisateur non authentifié ou jeton expiré.' }),
        { status: 401, headers: corsHeaders }
      );
    }

    // Client Admin Privilégié côté serveur
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier que l'appelant est un School Admin actif
    const { data: callerProfile, error: callerProfileError } = await supabaseClient
      .from('profiles')
      .select('role, is_active, school_id')
      .eq('id', callerUser.id)
      .single();

    if (
      callerProfileError ||
      !callerProfile ||
      callerProfile.role !== 'school_admin' ||
      !callerProfile.is_active ||
      !callerProfile.school_id
    ) {
      return new Response(
        JSON.stringify({ error: 'Accès refusé : Seul un administrateur d’établissement actif peut inviter un enseignant.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    // Vérifier l'état de l'école
    const { data: targetSchool, error: schoolErr } = await supabaseAdmin
      .from('schools')
      .select('id, status, name')
      .eq('id', callerProfile.school_id)
      .single();

    if (schoolErr || !targetSchool || targetSchool.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Accès refusé : Votre établissement scolaire est suspendu ou inactif.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    // 7. Charger le dossier enseignant (Sélection ciblée)
    const { data: teacherRecord, error: tchErr } = await supabaseAdmin
      .from('teachers')
      .select('id, school_id, profile_id, employee_number, first_name, last_name, email, phone, employment_status, account_status')
      .eq('id', teacher_id)
      .single();

    if (tchErr || !teacherRecord) {
      return new Response(
        JSON.stringify({ error: 'Dossier enseignant introuvable.' }),
        { status: 404, headers: corsHeaders }
      );
    }

    if (teacherRecord.school_id !== callerProfile.school_id) {
      return new Response(
        JSON.stringify({ error: 'Accès refusé : Cet enseignant n’appartient pas à votre établissement.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    if (!teacherRecord.email || !teacherRecord.email.includes('@')) {
      return new Response(
        JSON.stringify({ error: 'Cet enseignant ne possède pas une adresse email valide dans son dossier.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const cleanEmail = teacherRecord.email.trim().toLowerCase();
    const cleanFirstName = teacherRecord.first_name.trim();
    const cleanLastName = teacherRecord.last_name.trim();
    const fullName = `${cleanFirstName} ${cleanLastName}`;
    const redirectUrl = `${allowedOrigin}/auth/set-password`;

    // 8. TRAITEMENT PREMIÈRE INVITATION (`action = 'invite'`) (Point 1)
    if (action === 'invite') {
      // Vérification stricte de la valeur réelle 'not_invited' (NE JAMAIS assimiler NULL à not_invited) (Point 1)
      if (
        teacherRecord.account_status !== 'not_invited' ||
        teacherRecord.profile_id !== null ||
        teacherRecord.employment_status !== 'active'
      ) {
        return new Response(
          JSON.stringify({ error: `Première invitation refusée : Le dossier doit avoir le statut exact "not_invited", un contrat actif et aucun profil déjà lié (statut actuel: "${teacherRecord.account_status}").` }),
          { status: 400, headers: corsHeaders }
        );
      }

      // 1. Détecter l'existence préalable d'un compte Auth avec cet email
      let page = 1;
      let emailExists = false;
      while (true) {
        const { data: usersPage, error: pageError } = await supabaseAdmin.auth.admin.listUsers({
          page: page,
          perPage: 100
        });

        if (pageError) {
          console.error('Erreur lors du contrôle de collision d’email :', pageError.message);
          return new Response(
            JSON.stringify({ error: 'Erreur lors du contrôle de l’existence du compte.' }),
            { status: 500, headers: corsHeaders }
          );
        }

        if (!usersPage?.users || usersPage.users.length === 0) {
          break;
        }

        const match = usersPage.users.find((u: any) => u.email?.trim().toLowerCase() === cleanEmail);
        if (match) {
          emailExists = true;
          break;
        }

        if (usersPage.users.length < 100) {
          break;
        }
        page++;
      }

      if (emailExists) {
        return new Response(
          JSON.stringify({ error: 'Cette adresse email est déjà associée à un compte ÉcoleConnect. Vérifiez son identité avant toute association.' }),
          { status: 409, headers: corsHeaders }
        );
      }

      // 2. Créer l'invitation Auth par email (UNIQUEMENT dans action === 'invite') (Point 1)
      const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        cleanEmail,
        {
          redirectTo: redirectUrl,
          data: {
            first_name: cleanFirstName,
            last_name: cleanLastName,
            full_name: fullName,
            role: 'teacher',
            school_id: callerProfile.school_id,
            teacher_id: teacher_id
          }
        }
      );

      if (inviteErr || !inviteData?.user) {
        console.error('[invite-school-teacher] Erreur inviteUserByEmail :', {
          code: (inviteErr as any)?.code,
          status: (inviteErr as any)?.status,
          message: inviteErr?.message
        });
        const msg = (inviteErr?.message || '').toLowerCase();
        let userMsg = 'Échec de l’envoi de l’email d’invitation.';
        let httpCode = 500;
        if (msg.includes('rate limit') || msg.includes('over_email_send_rate_limit') || (inviteErr as any)?.status === 429) {
          userMsg = 'Limite temporaire d’envoi d’e-mails atteinte. Veuillez patienter avant de réessayer.';
          httpCode = 429;
        } else if (msg.includes('smtp') || msg.includes('mail')) {
          userMsg = 'Le serveur de messagerie n’a pas pu acheminer l’email d’invitation.';
          httpCode = 502;
        }
        return new Response(
          JSON.stringify({ error: userMsg }),
          { status: httpCode, headers: corsHeaders }
        );
      }

      const newAuthUserId = inviteData.user.id;

      // 3. Exécuter la RPC transactionnelle d'invitation sécurisée (p_teacher_id, p_user_id) (Point 5)
      const { data: rpcSuccess, error: rpcErr } = await supabaseClient.rpc('process_teacher_invitation', {
        p_teacher_id: teacher_id,
        p_user_id: newAuthUserId
      });

      if (rpcErr || !rpcSuccess) {
        console.error('Échec RPC process_teacher_invitation :', rpcErr?.message);

        let hasCompErr = false;
        try {
          const { error: resetTchErr } = await supabaseAdmin
            .from('teachers')
            .update({ profile_id: null, account_status: 'not_invited' })
            .eq('id', teacher_id)
            .eq('profile_id', newAuthUserId);

          if (resetTchErr) {
            hasCompErr = true;
            console.error('Erreur compensation reset teachers :', resetTchErr.message);
          }

          const { error: delProfErr } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', newAuthUserId);

          if (delProfErr) {
            hasCompErr = true;
            console.error('Erreur compensation delete profiles :', delProfErr.message);
          }

          const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(newAuthUserId);
          if (delAuthErr) {
            hasCompErr = true;
            console.error('Erreur compensation delete Auth user :', delAuthErr.message);
          }

          if (hasCompErr) {
            console.error('compensation_partial', { newAuthUserId, teacher_id });
          } else {
            console.log('compensation_complete', { newAuthUserId, teacher_id });
          }
        } catch (compErr: any) {
          console.error('compensation_partial (exception)', { newAuthUserId, teacher_id, error: compErr.message });
        }

        return new Response(
          JSON.stringify({ error: 'Échec de l’association du profil enseignant. L’opération a été annulée.' }),
          { status: 500, headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          teacher_id: teacher_id,
          account_status: 'invited',
          message: `Invitation envoyée avec succès à l’enseignant ${fullName}.`
        }),
        { status: 200, headers: corsHeaders }
      );

    // 9. TRAITEMENT RENVOYER L'INVITATION (`action = 'reinvite'`) (Point 2 & Point 3)
    } else if (action === 'reinvite') {
      // Audit obligatoire de la tentative de ré-invitation indisponible (Point 3)
      const { error: auditErr } = await supabaseAdmin.from('school_audit_logs').insert({
        school_id: callerProfile.school_id,
        actor_id: callerUser.id,
        action: 'teacher_reinvite_unavailable',
        details: {
          entity_type: 'teacher',
          entity_id: teacher_id,
          email: cleanEmail,
          requested_at: new Date().toISOString()
        }
      });

      if (auditErr) {
        console.error('Erreur audit teacher_reinvite_unavailable :', auditErr.message);
        return new Response(
          JSON.stringify({ error: 'Échec de la consignation d’audit pour la tentative de ré-invitation.' }),
          { status: 500, headers: corsHeaders }
        );
      }

      // Réponse 503 Service Unavailable explicite (Point 2) - Ne jamais retourner success
      return new Response(
        JSON.stringify({ error: 'Le renvoi d’invitation est temporairement indisponible jusqu’à la configuration du service sécurisé d’envoi d’emails.' }),
        { status: 503, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Action non traitée.' }),
      { status: 400, headers: corsHeaders }
    );

  } catch (err: any) {
    console.error('Erreur inattendue serveur :', err.message);
    return new Response(
      JSON.stringify({ error: 'Une erreur inattendue est survenue lors du traitement de l’invitation.' }),
      { status: 500, headers: corsHeaders }
    );
  }
});
