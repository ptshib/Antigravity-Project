// Supabase Edge Function : Invitation d'un Élève
// Fichier : supabase/functions/invite-school-student/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

serve(async (req) => {
  // 1. Validation de la méthode HTTP
  if (req.method !== 'POST' && req.method !== 'OPTIONS') {
    return new Response(
      JSON.stringify({ error: 'Méthode HTTP non autorisée. Seules POST et OPTIONS sont acceptées.' }),
      { status: 405, headers: { 'Content-Type': 'application/json', 'Allow': 'POST, OPTIONS' } }
    );
  }

  // 2. Configuration Fail-Closed des variables d'environnement
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const ecoleconnectAppUrl = Deno.env.get('ECOLECONNECT_APP_URL');

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey || !ecoleconnectAppUrl) {
    console.error('Configuration serveur manquante : Variables d’environnement non définies.');
    return new Response(
      JSON.stringify({ error: 'Erreur de configuration serveur. Le service d’invitation élève est indisponible.' }),
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

  // 3. Gestion des en-têtes CORS stricts
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

  const { student_id, email, action = 'invite' } = body;

  if (!student_id || typeof student_id !== 'string' || !UUID_REGEX.test(student_id)) {
    return new Response(
      JSON.stringify({ error: 'L’identifiant student_id doit être un UUID valide.' }),
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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier que l'appelant est un School Admin actif ou Super Admin
    const { data: callerProfile, error: callerProfileError } = await supabaseClient
      .from('profiles')
      .select('role, is_active, school_id')
      .eq('id', callerUser.id)
      .single();

    if (
      callerProfileError ||
      !callerProfile ||
      !callerProfile.is_active ||
      (callerProfile.role !== 'school_admin' && callerProfile.role !== 'super_admin')
    ) {
      return new Response(
        JSON.stringify({ error: 'Accès refusé : Seul un administrateur d’établissement peut inviter un élève.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    // 7. Charger le dossier élève
    const { data: studentRecord, error: stErr } = await supabaseAdmin
      .from('students')
      .select('id, school_id, profile_id, student_number, first_name, last_name, email, account_status')
      .eq('id', student_id)
      .single();

    if (stErr || !studentRecord) {
      return new Response(
        JSON.stringify({ error: 'Dossier élève introuvable.' }),
        { status: 404, headers: corsHeaders }
      );
    }

    if (callerProfile.role === 'school_admin' && studentRecord.school_id !== callerProfile.school_id) {
      return new Response(
        JSON.stringify({ error: 'Accès refusé : Cet élève n’appartient pas à votre établissement.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    // Vérifier l'état de l'école
    const { data: targetSchool, error: schoolErr } = await supabaseAdmin
      .from('schools')
      .select('id, status, name')
      .eq('id', studentRecord.school_id)
      .single();

    if (schoolErr || !targetSchool || targetSchool.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Accès refusé : L’établissement scolaire est suspendu ou inactif.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    const effectiveEmail = email ? String(email).trim().toLowerCase() : (studentRecord.email ? studentRecord.email.trim().toLowerCase() : null);

    if (!effectiveEmail || !EMAIL_REGEX.test(effectiveEmail)) {
      return new Response(
        JSON.stringify({ error: 'Une adresse email personnelle valide est requise pour inviter l’élève.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // 8. TRAITEMENT RENVOI D'INVITATION (`action = 'reinvite'`)
    if (action === 'reinvite') {
      const { error: auditErr } = await supabaseAdmin.from('school_audit_logs').insert({
        school_id: studentRecord.school_id,
        actor_id: callerUser.id,
        action: 'student_reinvite_unavailable',
        details: {
          entity_type: 'student',
          student_id: student_id,
          email: effectiveEmail,
          requested_at: new Date().toISOString()
        }
      });

      if (auditErr) {
        console.error('Erreur audit student_reinvite_unavailable :', auditErr.message);
      }

      return new Response(
        JSON.stringify({ error: 'Le renvoi d’invitation est temporairement indisponible jusqu’à la configuration du service sécurisé d’envoi d’emails.' }),
        { status: 503, headers: corsHeaders }
      );
    }

    // 9. TRAITEMENT PREMIÈRE INVITATION (`action = 'invite'`)
    if (studentRecord.account_status !== 'not_invited' || studentRecord.profile_id !== null) {
      return new Response(
        JSON.stringify({ error: `Première invitation refusée : Le dossier élève doit avoir le statut exact "not_invited" et aucun profil déjà associé (statut actuel: "${studentRecord.account_status}").` }),
        { status: 400, headers: corsHeaders }
      );
    }

    const cleanFirstName = studentRecord.first_name ? studentRecord.first_name.trim() : 'Élève';
    const cleanLastName = studentRecord.last_name ? studentRecord.last_name.trim() : studentRecord.student_number;
    const fullName = `${cleanFirstName} ${cleanLastName}`;
    const redirectUrl = `${allowedOrigin}/auth/set-password`;

    // Contrôle de collision d'email dans Auth
    let page = 1;
    let emailExists = false;
    while (true) {
      const { data: usersPage, error: pageError } = await supabaseAdmin.auth.admin.listUsers({
        page: page,
        perPage: 100
      });

      if (pageError) {
        console.error('Erreur lors du contrôle de collision d’email élève :', pageError.message);
        return new Response(
          JSON.stringify({ error: 'Erreur lors du contrôle de l’existence du compte.' }),
          { status: 500, headers: corsHeaders }
        );
      }

      if (!usersPage?.users || usersPage.users.length === 0) {
        break;
      }

      const match = usersPage.users.find((u: any) => u.email?.trim().toLowerCase() === effectiveEmail);
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

    // 10. Créer l'invitation Auth par email
    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      effectiveEmail,
      {
        redirectTo: redirectUrl,
        data: {
          first_name: cleanFirstName,
          last_name: cleanLastName,
          full_name: fullName,
          role: 'student',
          school_id: studentRecord.school_id,
          student_id: student_id
        }
      }
    );

    if (inviteErr || !inviteData?.user) {
      console.error('[invite-school-student] Erreur inviteUserByEmail :', {
        code: (inviteErr as any)?.code,
        status: (inviteErr as any)?.status,
        message: inviteErr?.message
      });
      const msg = (inviteErr?.message || '').toLowerCase();
      let userMsg = 'Échec de l’envoi de l’email d’invitation à l’élève.';
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

    // 11. Créer le jeton d'invitation serveur à usage unique
    const invitationToken = crypto.randomUUID();
    const { error: tokenInsertErr } = await supabaseAdmin
      .from('school_portal_invitations')
      .insert({
        school_id: studentRecord.school_id,
        role: 'student',
        email: effectiveEmail,
        auth_user_id: newAuthUserId,
        invitation_token: invitationToken,
        entity_id: student_id,
        payload: {
          student_id: student_id,
          email: effectiveEmail
        },
        created_by: callerUser.id
      });

    if (tokenInsertErr) {
      console.error('Erreur insertion school_portal_invitations élève :', tokenInsertErr.message);
      await supabaseAdmin.auth.admin.deleteUser(newAuthUserId);
      return new Response(
        JSON.stringify({ error: 'Échec de la génération du jeton sécurisé d’invitation.' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // 12. Exécuter la RPC transactionnelle d'association élève via service_role
    const { data: rpcSuccess, error: rpcErr } = await supabaseAdmin.rpc('process_student_invitation', {
      p_invitation_token: invitationToken,
      p_user_id: newAuthUserId,
      p_school_id: studentRecord.school_id,
      p_student_id: student_id,
      p_email: effectiveEmail
    });

    if (rpcErr || !rpcSuccess) {
      console.error('Échec RPC process_student_invitation :', rpcErr?.message);

      // Compensation
      try {
        await supabaseAdmin.from('school_portal_invitations').delete().eq('invitation_token', invitationToken);
        await supabaseAdmin.from('students').update({ profile_id: null, account_status: 'not_invited' }).eq('id', student_id);
        await supabaseAdmin.from('profiles').delete().eq('id', newAuthUserId);
        await supabaseAdmin.auth.admin.deleteUser(newAuthUserId);
        console.log('Compensation élève réussie :', newAuthUserId);
      } catch (compErr: any) {
        console.error('Erreur compensation élève :', compErr.message);
      }

      return new Response(
        JSON.stringify({ error: rpcErr?.message || 'Échec de l’association du profil élève. L’opération a été annulée.' }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        student_id: student_id,
        account_status: 'invited',
        message: `Invitation envoyée avec succès à l’élève ${fullName} (${effectiveEmail}).`
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err: any) {
    console.error('Erreur inattendue serveur élève :', err.message);
    return new Response(
      JSON.stringify({ error: 'Une erreur inattendue est survenue lors du traitement de l’invitation élève.' }),
      { status: 500, headers: corsHeaders }
    );
  }
});
