// Supabase Edge Function : Invitation d'un Parent / Responsable Légal
// Fichier : supabase/functions/invite-school-parent/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

type InvitationErrorCode =
  | 'rate_limit_exceeded'
  | 'email_exists'
  | 'smtp_error'
  | 'invitation_processing_failed'
  | 'validation_error'
  | 'unauthorized'
  | 'internal_error';

function classifyAuthInviteError(err: any): { errorCode: InvitationErrorCode; userMessage: string; httpStatus: number } {
  const message = (err?.message || '').toLowerCase();
  const code = (err?.code || '').toLowerCase();
  const status = Number(err?.status || 0);

  // 1. Rate limiting
  if (
    status === 429 ||
    code.includes('rate_limit') ||
    code.includes('over_email_send_rate_limit') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('over_email_send_rate_limit')
  ) {
    return {
      errorCode: 'rate_limit_exceeded',
      userMessage: 'Limite temporaire d’envoi d’emails atteinte par le service de messagerie. Veuillez patienter quelques instants avant de réessayer.',
      httpStatus: 429
    };
  }

  // 2. Email collision
  if (
    status === 409 ||
    status === 422 ||
    code.includes('email_exists') ||
    code.includes('user_already_exists') ||
    message.includes('already registered') ||
    message.includes('already exists') ||
    message.includes('email_exists')
  ) {
    return {
      errorCode: 'email_exists',
      userMessage: 'Cette adresse email est déjà associée à un compte existant. Vérifiez l’identité du responsable.',
      httpStatus: 409
    };
  }

  // 3. SMTP / Mail server error
  if (
    message.includes('smtp') ||
    message.includes('mail') ||
    message.includes('mailer') ||
    message.includes('connection refused') ||
    message.includes('failed to send email') ||
    message.includes('error sending invite') ||
    code.includes('smtp_error')
  ) {
    return {
      errorCode: 'smtp_error',
      userMessage: 'Le serveur de messagerie n’a pas pu acheminer l’email d’invitation. Veuillez vérifier la configuration SMTP ou l’adresse email saisie.',
      httpStatus: 502
    };
  }

  // 4. Default processing failure
  return {
    errorCode: 'invitation_processing_failed',
    userMessage: 'Échec de l’envoi de l’email d’invitation au responsable. L’opération a été interrompue.',
    httpStatus: 500
  };
}

serve(async (req) => {
  // 1. Validation de la méthode HTTP
  if (req.method !== 'POST' && req.method !== 'OPTIONS') {
    return new Response(
      JSON.stringify({
        error: 'Méthode HTTP non autorisée. Seules POST et OPTIONS sont acceptées.',
        error_code: 'unauthorized'
      }),
      { status: 405, headers: { 'Content-Type': 'application/json', 'Allow': 'POST, OPTIONS' } }
    );
  }

  // 2. Configuration Fail-Closed des variables d'environnement
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const ecoleconnectAppUrl = Deno.env.get('ECOLECONNECT_APP_URL');

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey || !ecoleconnectAppUrl) {
    console.error('[invite-school-parent] Variables d’environnement manquantes sur le serveur.');
    return new Response(
      JSON.stringify({
        error: 'Erreur de configuration serveur. Le service d’invitation parent est indisponible.',
        error_code: 'internal_error'
      }),
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
    console.error('[invite-school-parent] ECOLECONNECT_APP_URL invalide :', err.message);
    return new Response(
      JSON.stringify({
        error: 'Erreur de configuration de l’URL d’application.',
        error_code: 'internal_error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 3. Gestion des en-têtes CORS stricts
  const reqOrigin = req.headers.get('Origin');
  if (reqOrigin && reqOrigin !== allowedOrigin) {
    return new Response(
      JSON.stringify({
        error: 'Origine CORS non autorisée.',
        error_code: 'unauthorized'
      }),
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
      JSON.stringify({
        error: 'Content-Type doit être application/json.',
        error_code: 'validation_error'
      }),
      { status: 400, headers: corsHeaders }
    );
  }

  // 5. Lecture et vérification de la taille UTF-8 réelle du corps (< 10 KB)
  const rawText = await req.text();
  const byteLength = new TextEncoder().encode(rawText).length;
  if (byteLength > 10240) {
    return new Response(
      JSON.stringify({
        error: 'Taille du corps de requête supérieure à 10 KB refusée.',
        error_code: 'validation_error'
      }),
      { status: 413, headers: corsHeaders }
    );
  }

  let body: any;
  try {
    body = JSON.parse(rawText);
  } catch {
    return new Response(
      JSON.stringify({
        error: 'Corps de requête JSON invalide.',
        error_code: 'validation_error'
      }),
      { status: 400, headers: corsHeaders }
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return new Response(
      JSON.stringify({
        error: 'Le corps de requête doit être un objet JSON simple.',
        error_code: 'validation_error'
      }),
      { status: 400, headers: corsHeaders }
    );
  }

  const {
    first_name,
    last_name,
    email,
    phone = null,
    relationship = 'Parent',
    student_ids,
    permissions = null,
    action = 'invite',
    parent_profile_id = null
  } = body;

  if (action !== 'invite' && action !== 'reinvite') {
    return new Response(
      JSON.stringify({
        error: 'Action non reconnue. Seules "invite" et "reinvite" sont autorisées.',
        error_code: 'validation_error'
      }),
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    // 6. Vérification du jeton JWT de l'appelant
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: 'Jeton Authorization manquant.',
          error_code: 'unauthorized'
        }),
        { status: 401, headers: corsHeaders }
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: callerUser }, error: callerAuthError } = await supabaseClient.auth.getUser();
    if (callerAuthError || !callerUser) {
      return new Response(
        JSON.stringify({
          error: 'Utilisateur non authentifié ou jeton expiré.',
          error_code: 'unauthorized'
        }),
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
        JSON.stringify({
          error: 'Accès refusé : Seul un administrateur peut inviter un parent.',
          error_code: 'unauthorized'
        }),
        { status: 403, headers: corsHeaders }
      );
    }

    let targetSchoolId = callerProfile.school_id;
    if (callerProfile.role === 'super_admin' && body.school_id) {
      targetSchoolId = body.school_id;
    }

    if (!targetSchoolId) {
      return new Response(
        JSON.stringify({
          error: 'Établissement scolaire non spécifié ou introuvable.',
          error_code: 'validation_error'
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Vérifier l'état de l'école
    const { data: targetSchool, error: schoolErr } = await supabaseAdmin
      .from('schools')
      .select('id, status, name')
      .eq('id', targetSchoolId)
      .single();

    if (schoolErr || !targetSchool || targetSchool.status !== 'active') {
      return new Response(
        JSON.stringify({
          error: 'Accès refusé : L’établissement scolaire est inactif ou suspendu.',
          error_code: 'unauthorized'
        }),
        { status: 403, headers: corsHeaders }
      );
    }

    // 7. TRAITEMENT DU RENVOI D'INVITATION (`action = 'reinvite'`)
    if (action === 'reinvite') {
      const { error: auditErr } = await supabaseAdmin.from('school_audit_logs').insert({
        school_id: targetSchoolId,
        actor_id: callerUser.id,
        action: 'parent_reinvite_unavailable',
        details: {
          entity_type: 'parent',
          parent_profile_id: parent_profile_id,
          requested_at: new Date().toISOString()
        }
      });

      if (auditErr) {
        console.error('[invite-school-parent] Erreur audit parent_reinvite_unavailable :', auditErr.message);
      }

      return new Response(
        JSON.stringify({
          error: 'Le renvoi d’invitation est temporairement indisponible jusqu’à la configuration du service sécurisé d’envoi d’emails.',
          error_code: 'smtp_error'
        }),
        { status: 503, headers: corsHeaders }
      );
    }

    // 8. TRAITEMENT DE LA PREMIÈRE INVITATION (`action = 'invite'`)
    if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Le prénom du responsable est obligatoire.',
          error_code: 'validation_error'
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!last_name || typeof last_name !== 'string' || last_name.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Le nom du responsable est obligatoire.',
          error_code: 'validation_error'
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return new Response(
        JSON.stringify({
          error: 'Une adresse email valide est obligatoire pour inviter le responsable.',
          error_code: 'validation_error'
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Au moins un élève doit être sélectionné pour rattacher le responsable.',
          error_code: 'validation_error'
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    for (const sId of student_ids) {
      if (typeof sId !== 'string' || !UUID_REGEX.test(sId)) {
        return new Response(
          JSON.stringify({
            error: `Identifiant élève invalide : "${sId}".`,
            error_code: 'validation_error'
          }),
          { status: 400, headers: corsHeaders }
        );
      }
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanFirstName = first_name.trim();
    const cleanLastName = last_name.trim();
    const fullName = `${cleanFirstName} ${cleanLastName}`;
    const redirectUrl = `${allowedOrigin}/auth/set-password`;

    // 9. Vérifier les collisions d'email dans Auth et détecter les comptes orphelins
    let existingAuthUser: any = null;
    let page = 1;
    while (true) {
      const { data: usersPage, error: pageError } = await supabaseAdmin.auth.admin.listUsers({
        page: page,
        perPage: 100
      });

      if (pageError) {
        console.error('[invite-school-parent] Erreur contrôle collision email :', {
          code: pageError.code,
          message: pageError.message
        });
        return new Response(
          JSON.stringify({
            error: 'Erreur lors du contrôle de l’existence du compte.',
            error_code: 'internal_error'
          }),
          { status: 500, headers: corsHeaders }
        );
      }

      if (!usersPage?.users || usersPage.users.length === 0) {
        break;
      }

      const match = usersPage.users.find((u: any) => u.email?.trim().toLowerCase() === cleanEmail);
      if (match) {
        existingAuthUser = match;
        break;
      }

      if (usersPage.users.length < 100) {
        break;
      }
      page++;
    }

    if (existingAuthUser) {
      const { data: existingProf } = await supabaseAdmin
        .from('profiles')
        .select('id, role, is_active, school_id')
        .eq('id', existingAuthUser.id)
        .maybeSingle();

      if (!existingProf) {
        return new Response(
          JSON.stringify({
            error: `Cette adresse email (${cleanEmail}) est déjà enregistrée dans le système d’authentification sans profil associé. Veuillez contacter l'administration technique pour régulariser ce compte.`,
            error_code: 'email_exists'
          }),
          { status: 409, headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({
          error: `Cette adresse email (${cleanEmail}) est déjà associée à un compte existant (${existingProf.role}).`,
          error_code: 'email_exists'
        }),
        { status: 409, headers: corsHeaders }
      );
    }

    // 10. Exécution Atomique du workflow d'invitation parent
    let createdAuthUserId: string | null = null;
    let invitationToken: string | null = null;

    try {
      // 10.1 Créer l'utilisateur Auth invité par email via Supabase Auth Admin
      const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        cleanEmail,
        {
          redirectTo: redirectUrl,
          data: {
            first_name: cleanFirstName,
            last_name: cleanLastName,
            full_name: fullName,
            role: 'parent',
            school_id: targetSchoolId
          }
        }
      );

      if (inviteErr || !inviteData?.user?.id) {
        // Journalisation serveur stricte sans données sensibles
        console.error('[invite-school-parent] Échec inviteUserByEmail :', {
          code: (inviteErr as any)?.code || 'unknown_auth_error',
          status: (inviteErr as any)?.status || 500,
          message: inviteErr?.message
        });

        const classified = classifyAuthInviteError(inviteErr);
        return new Response(
          JSON.stringify({
            error: classified.userMessage,
            error_code: classified.errorCode
          }),
          { status: classified.httpStatus, headers: corsHeaders }
        );
      }

      createdAuthUserId = inviteData.user.id;

      // 10.2 Génération du jeton d'invitation serveur et création de school_portal_invitations
      invitationToken = crypto.randomUUID();

      const canonicalRelationship = typeof relationship === 'string' && (relationship.trim() === 'Mère' || relationship.trim() === 'mother')
        ? 'mother'
        : typeof relationship === 'string' && (relationship.trim() === 'Tuteur' || relationship.trim() === 'Tutrice' || relationship.trim() === 'guardian')
        ? 'guardian'
        : typeof relationship === 'string' && (relationship.trim() === 'Responsable légal' || relationship.trim() === 'legal_guardian')
        ? 'legal_guardian'
        : typeof relationship === 'string' && (relationship.trim() === 'Personne autorisée à récupérer' || relationship.trim() === 'pickup_authorized')
        ? 'pickup_authorized'
        : typeof relationship === 'string' && (relationship.trim() === 'Autre' || relationship.trim() === 'other')
        ? 'other'
        : 'father';

      const { error: tokenInsertErr } = await supabaseAdmin
        .from('school_portal_invitations')
        .insert({
          school_id: targetSchoolId,
          role: 'parent',
          email: cleanEmail,
          auth_user_id: createdAuthUserId,
          invitation_token: invitationToken,
          payload: {
            student_ids: student_ids,
            relationship: canonicalRelationship,
            permissions: permissions && typeof permissions === 'object' ? permissions : null
          },
          created_by: callerUser.id
        });

      if (tokenInsertErr) {
        console.error('[invite-school-parent] Erreur insertion school_portal_invitations :', {
          code: tokenInsertErr.code,
          message: tokenInsertErr.message
        });
        throw new Error('Échec de la génération du jeton sécurisé d’invitation.');
      }

      // 10.3 Exécuter la RPC transactionnelle d'association parent via service_role
      const { data: rpcSuccess, error: rpcErr } = await supabaseAdmin.rpc('process_parent_invitation', {
        p_invitation_token: invitationToken,
        p_user_id: createdAuthUserId,
        p_school_id: targetSchoolId,
        p_first_name: cleanFirstName,
        p_last_name: cleanLastName,
        p_email: cleanEmail,
        p_phone: phone ? String(phone).trim() : null,
        p_relationship: canonicalRelationship,
        p_student_ids: student_ids,
        p_permissions: permissions && typeof permissions === 'object' ? permissions : null
      });

      if (rpcErr || rpcSuccess !== true) {
        console.error('[invite-school-parent] Échec RPC process_parent_invitation :', {
          code: rpcErr?.code,
          message: rpcErr?.message
        });
        throw new Error(rpcErr?.message || 'Échec de l’association du profil parent dans la base de données.');
      }

      // 10.4 Vérification post-création obligatoire (Garantie de non-orphelinat)
      const { data: verifyProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role, is_active')
        .eq('id', createdAuthUserId)
        .maybeSingle();

      const { data: verifyAccount } = await supabaseAdmin
        .from('parent_accounts')
        .select('profile_id, account_status')
        .eq('profile_id', createdAuthUserId)
        .maybeSingle();

      const { data: verifyLinks } = await supabaseAdmin
        .from('parent_student_links')
        .select('id, status')
        .eq('parent_profile_id', createdAuthUserId)
        .eq('status', 'approved');

      const { data: verifyInvitation } = await supabaseAdmin
        .from('school_portal_invitations')
        .select('id, consumed_at')
        .eq('invitation_token', invitationToken)
        .maybeSingle();

      if (
        !verifyProfile ||
        verifyProfile.role !== 'parent' ||
        verifyProfile.is_active !== false ||
        !verifyAccount ||
        verifyAccount.account_status !== 'invited' ||
        !verifyLinks ||
        verifyLinks.length === 0 ||
        !verifyInvitation ||
        !verifyInvitation.consumed_at
      ) {
        console.error('[invite-school-parent] Échec validation intégrité post-création parent :', {
          verifyProfile,
          verifyAccount,
          verifyLinksCount: verifyLinks?.length,
          verifyInvitation
        });
        throw new Error('Incohérence des données après création du compte parent. Rollback appliqué.');
      }

      // Succès complet et validé (ne jamais exposer de token ou secret)
      return new Response(
        JSON.stringify({
          success: true,
          message: `Invitation envoyée avec succès au responsable ${fullName} (${cleanEmail}).`
        }),
        { status: 200, headers: corsHeaders }
      );

    } catch (atomicErr: any) {
      console.error('[invite-school-parent] Erreur atomique lors du traitement, déclenchement du rollback :', {
        message: atomicErr.message
      });

      // Rollback / Nettoyage de compensation immédiat
      if (invitationToken) {
        try {
          await supabaseAdmin.from('school_portal_invitations').delete().eq('invitation_token', invitationToken);
        } catch (e: any) {
          console.warn('[invite-school-parent] Rollback school_portal_invitations :', e.message);
        }
      }

      if (createdAuthUserId) {
        try {
          await supabaseAdmin.from('parent_student_links').delete().eq('parent_profile_id', createdAuthUserId);
          await supabaseAdmin.from('parent_accounts').delete().eq('profile_id', createdAuthUserId);
          await supabaseAdmin.from('profiles').delete().eq('id', createdAuthUserId);
          await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
          console.log('[invite-school-parent] Rollback complet utilisateur Auth orphelin :', createdAuthUserId);
        } catch (e: any) {
          console.warn('[invite-school-parent] Rollback auth.users / tables applicatives :', e.message);
        }
      }

      return new Response(
        JSON.stringify({
          error: atomicErr.message || 'Une erreur est survenue lors de la création du compte parent. L’opération a été annulée.',
          error_code: 'invitation_processing_failed'
        }),
        { status: 500, headers: corsHeaders }
      );
    }

  } catch (err: any) {
    console.error('[invite-school-parent] Erreur inattendue serveur :', { message: err.message });
    return new Response(
      JSON.stringify({
        error: 'Une erreur inattendue est survenue lors du traitement de l’invitation parent.',
        error_code: 'internal_error'
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
