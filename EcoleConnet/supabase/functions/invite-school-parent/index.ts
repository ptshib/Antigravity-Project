import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { ResendClient } from '../_shared/resend-client.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

type InvitationErrorCode =
  | 'rate_limit_exceeded'
  | 'email_exists'
  | 'EXISTING_ACCOUNT_NOT_PARENT_COMPATIBLE'
  | 'INVITATION_ALREADY_PENDING'
  | 'smtp_error'
  | 'EMAIL_DELIVERY_FAILED'
  | 'invitation_processing_failed'
  | 'validation_error'
  | 'unauthorized'
  | 'internal_error';

function buildErrorResponse(
  status: number,
  code: InvitationErrorCode,
  message: string,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code,
      message,
      error: message,
      error_code: code
    }),
    { status, headers: corsHeaders }
  );
}

function buildSuccessResponse(
  message: string,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({
      success: true,
      code: 'INVITATION_SENT',
      message
    }),
    { status: 200, headers: corsHeaders }
  );
}

function classifyAuthInviteError(err: any): { errorCode: InvitationErrorCode; userMessage: string; httpStatus: number } {
  const message = (err?.message || '').toLowerCase();
  const code = (err?.code || '').toLowerCase();
  const status = Number(err?.status || 0);

  if (
    status === 429 ||
    code.includes('rate_limit') ||
    code.includes('over_email_send_rate_limit') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  ) {
    return {
      errorCode: 'rate_limit_exceeded',
      userMessage: 'Limite temporaire d’envoi d’emails atteinte par le service de messagerie. Veuillez patienter quelques instants.',
      httpStatus: 429
    };
  }

  if (
    status === 409 ||
    status === 422 ||
    code.includes('email_exists') ||
    code.includes('user_already_exists') ||
    message.includes('already registered') ||
    message.includes('already exists')
  ) {
    return {
      errorCode: 'email_exists',
      userMessage: 'Cette adresse email est déjà associée à un compte existant.',
      httpStatus: 409
    };
  }

  if (
    message.includes('smtp') ||
    message.includes('mail') ||
    message.includes('failed to send email') ||
    code.includes('smtp_error')
  ) {
    return {
      errorCode: 'smtp_error',
      userMessage: 'Le serveur de messagerie n’a pas pu acheminer l’email d’invitation. Veuillez vérifier la configuration d’envoi.',
      httpStatus: 502
    };
  }

  return {
    errorCode: 'invitation_processing_failed',
    userMessage: 'Échec de l’envoi de l’email d’invitation au responsable. L’opération a été interrompue.',
    httpStatus: 500
  };
}

async function generateSecureToken(): Promise<{ rawToken: string; tokenHashHex: string }> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  let binary = '';
  for (let i = 0; i < randomBytes.length; i++) {
    binary += String.fromCharCode(randomBytes[i]);
  }
  const rawToken = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawToken));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const tokenHashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return { rawToken, tokenHashHex };
}

export async function inviteSchoolParentHandler(req: Request): Promise<Response> {
  const ecoleconnectAppUrl = Deno.env.get('ECOLECONNECT_APP_URL');
  const { isAllowed, headers: corsHeaders } = buildCorsHeaders(req, ecoleconnectAppUrl);

  if (req.method === 'OPTIONS') {
    if (!isAllowed) {
      return buildErrorResponse(403, 'unauthorized', 'Origine CORS non autorisée.', corsHeaders);
    }
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (!isAllowed) {
    return buildErrorResponse(403, 'unauthorized', 'Origine CORS non autorisée.', corsHeaders);
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, code: 'unauthorized', message: 'Méthode HTTP non autorisée. Seules POST et OPTIONS sont acceptées.', error: 'Méthode HTTP non autorisée.', error_code: 'unauthorized' }),
      { status: 405, headers: { ...corsHeaders, 'Allow': 'POST, OPTIONS' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    console.error('[invite-school-parent] Variables d’environnement manquantes.');
    return buildErrorResponse(500, 'internal_error', 'Erreur de configuration serveur.', corsHeaders);
  }

  const contentType = req.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return buildErrorResponse(400, 'validation_error', 'Content-Type doit être application/json.', corsHeaders);
  }

  const rawText = await req.text();
  const byteLength = new TextEncoder().encode(rawText).length;
  if (byteLength > 10240) {
    return buildErrorResponse(413, 'validation_error', 'Taille du corps de requête supérieure à 10 KB refusée.', corsHeaders);
  }

  let body: any;
  try {
    body = JSON.parse(rawText);
  } catch {
    return buildErrorResponse(400, 'validation_error', 'Corps de requête JSON invalide.', corsHeaders);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return buildErrorResponse(400, 'validation_error', 'Le corps de requête doit être un objet JSON simple.', corsHeaders);
  }

  const {
    first_name,
    last_name,
    email,
    relationship = 'parent',
    student_ids,
    permissions = null,
    action = 'invite'
  } = body;

  if (action !== 'invite' && action !== 'reinvite') {
    return buildErrorResponse(400, 'validation_error', 'Action non reconnue.', corsHeaders);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return buildErrorResponse(401, 'unauthorized', 'Jeton Authorization manquant.', corsHeaders);
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: callerUser }, error: callerAuthError } = await supabaseClient.auth.getUser();
    if (callerAuthError || !callerUser) {
      return buildErrorResponse(401, 'unauthorized', 'Utilisateur non authentifié ou jeton expiré.', corsHeaders);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
      return buildErrorResponse(403, 'unauthorized', 'Accès refusé : Seul un administrateur peut inviter un parent.', corsHeaders);
    }

    let targetSchoolId = callerProfile.school_id;
    if (callerProfile.role === 'super_admin' && body.school_id) {
      targetSchoolId = body.school_id;
    }

    if (!targetSchoolId) {
      return buildErrorResponse(400, 'validation_error', 'Établissement scolaire non spécifié.', corsHeaders);
    }

    const { data: targetSchool, error: schoolErr } = await supabaseAdmin
      .from('schools')
      .select('id, status, name')
      .eq('id', targetSchoolId)
      .single();

    if (schoolErr || !targetSchool || targetSchool.status !== 'active') {
      return buildErrorResponse(403, 'unauthorized', 'Accès refusé : L’établissement scolaire est inactif ou suspendu.', corsHeaders);
    }

    if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0) {
      return buildErrorResponse(400, 'validation_error', 'Le prénom du responsable est obligatoire.', corsHeaders);
    }

    if (!last_name || typeof last_name !== 'string' || last_name.trim().length === 0) {
      return buildErrorResponse(400, 'validation_error', 'Le nom du responsable est obligatoire.', corsHeaders);
    }

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return buildErrorResponse(400, 'validation_error', 'Une adresse email valide est obligatoire.', corsHeaders);
    }

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return buildErrorResponse(400, 'validation_error', 'Au moins un élève doit être sélectionné.', corsHeaders);
    }

    for (const sId of student_ids) {
      if (typeof sId !== 'string' || !UUID_REGEX.test(sId)) {
        return buildErrorResponse(400, 'validation_error', `Identifiant élève invalide : "${sId}".`, corsHeaders);
      }
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanFirstName = first_name.trim();
    const cleanLastName = last_name.trim();
    const fullName = `${cleanFirstName} ${cleanLastName}`;
    const targetOrigin = corsHeaders['Access-Control-Allow-Origin'] || 'https://ecolelink.com';

    const canonicalRelationship = typeof relationship === 'string' && (relationship.trim() === 'Mère' || relationship.trim() === 'mother')
      ? 'mother'
      : typeof relationship === 'string' && (relationship.trim() === 'Tuteur' || relationship.trim() === 'guardian')
      ? 'guardian'
      : typeof relationship === 'string' && (relationship.trim() === 'Responsable légal' || relationship.trim() === 'legal_guardian')
      ? 'legal_guardian'
      : 'father';

    const studentsMetadata = student_ids.map((sId: string) => ({
      student_id: sId,
      relationship: canonicalRelationship,
      is_primary: false,
      can_view_academic: permissions?.can_view_academic ?? true,
      can_view_attendance: permissions?.can_view_attendance ?? true,
      can_view_homework: permissions?.can_view_homework ?? true,
      can_view_finances: permissions?.can_view_finances ?? true,
      can_pickup_student: permissions?.can_pickup_student ?? false,
      can_receive_notifications: permissions?.can_receive_notifications ?? true
    }));

    // SEARCH FOR EXISTING AUTH USER BY EMAIL
    let existingAuthUserId: string | null = null;
    const { data: findAuthRes, error: findAuthErr } = await supabaseAdmin.rpc('find_auth_user_by_email', {
      p_email: cleanEmail
    });

    if (!findAuthErr && findAuthRes && findAuthRes.length > 0) {
      existingAuthUserId = findAuthRes[0].user_id;
    } else {
      let page = 1;
      while (true) {
        const { data: usersPage, error: pageError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
        if (pageError || !usersPage?.users || usersPage.users.length === 0) break;
        const match = usersPage.users.find((u: any) => u.email?.trim().toLowerCase() === cleanEmail);
        if (match) {
          existingAuthUserId = match.id;
          break;
        }
        if (usersPage.users.length < 100) break;
        page++;
      }
    }

    // CASE 1: EXISTING AUTH USER
    if (existingAuthUserId) {
      const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role, is_active, school_id')
        .eq('id', existingAuthUserId)
        .maybeSingle();

      const { data: existingParentAcct } = await supabaseAdmin
        .from('parent_accounts')
        .select('profile_id, account_status')
        .eq('profile_id', existingAuthUserId)
        .maybeSingle();

      const isParentCompatible = (existingProfile && existingProfile.role === 'parent') || !!existingParentAcct;

      if (!isParentCompatible) {
        const roleStr = existingProfile?.role || 'personnel';
        return buildErrorResponse(
          409,
          'EXISTING_ACCOUNT_NOT_PARENT_COMPATIBLE',
          `Cette adresse email (${cleanEmail}) est associée à un compte existant (${roleStr}) non compatible avec un profil Parent.`,
          corsHeaders
        );
      }

      // Prepare/verify identity idempotently (leaves profiles.school_id untouched)
      const { error: prepErr } = await supabaseAdmin.rpc('prepare_parent_invitee_identity', {
        p_auth_user_id: existingAuthUserId,
        p_email: cleanEmail,
        p_school_id: targetSchoolId,
        p_first_name: cleanFirstName,
        p_last_name: cleanLastName
      });

      if (prepErr) {
        console.error('[invite-school-parent] Échec prepare_parent_invitee_identity (compte existant) :', prepErr?.message);
      }

      const { rawToken, tokenHashHex } = await generateSecureToken();

      const { data: invRes, error: rpcErr } = await supabaseAdmin.rpc('create_parent_membership_invitation', {
        p_invited_by: callerUser.id,
        p_email: cleanEmail,
        p_auth_user_id: existingAuthUserId,
        p_token_hash: tokenHashHex,
        p_student_ids: student_ids,
        p_students_metadata: studentsMetadata
      });

      if (rpcErr || !invRes || invRes.length === 0) {
        console.error('[invite-school-parent] Échec create_parent_membership_invitation (compte existant) :', rpcErr?.message);
        const isPending = (rpcErr?.message || '').includes('INVITATION_ALREADY_PENDING') || rpcErr?.code === '23505';
        if (isPending) {
          return buildErrorResponse(409, 'INVITATION_ALREADY_PENDING', 'Une invitation est déjà active pour cette adresse.', corsHeaders);
        }
        return buildErrorResponse(400, 'invitation_processing_failed', 'Échec de la création de l’invitation parent pour ce compte.', corsHeaders);
      }

      const createdInvId = invRes[0].invitation_id;

      // SEND EMAIL VIA RESEND FOR EXISTING USER
      const resendApiKey = Deno.env.get('RESEND_API_KEY');
      const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'notifications@mail.ecolelink.com';

      if (!resendApiKey || resendApiKey.trim() === '') {
        try {
          await supabaseAdmin
            .from('school_membership_invitations')
            .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', createdInvId);
        } catch (revErr: any) {
          console.error('[invite-school-parent] Échec révocation invitation après absence RESEND_API_KEY:', revErr?.message);
        }
        return buildErrorResponse(502, 'EMAIL_DELIVERY_FAILED', 'Le service de messagerie (Resend) n’est pas configuré sur le serveur. L’invitation a été révoquée.', corsHeaders);
      }

      const resendClient = new ResendClient({ apiKey: resendApiKey });
      const acceptLink = `${targetOrigin}/auth/accept-school-invitation?token=${rawToken}`;

      const resendResult = await resendClient.sendEmail(`inv-${createdInvId}`, {
        from: resendFromEmail,
        to: [cleanEmail],
        subject: `Invitation à rejoindre ${targetSchool.name} sur ÉcoleConnect`,
        html: `<p>Bonjour ${cleanFirstName},</p><p>Vous avez été invité(e) à rejoindre <strong>${targetSchool.name}</strong> pour vos enfants.</p><p><a href="${acceptLink}">Accepter l'invitation</a></p>`
      });

      if (!resendResult.ok) {
        console.error(`[invite-school-parent] Échec Resend (invitation ${createdInvId}):`, resendResult.errorCode);
        try {
          await supabaseAdmin
            .from('school_membership_invitations')
            .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', createdInvId);
        } catch (revErr: any) {
          console.error('[invite-school-parent] Échec révocation compensatoire invitation:', revErr?.message);
        }
        return buildErrorResponse(502, 'EMAIL_DELIVERY_FAILED', 'Le serveur de messagerie n’a pas pu acheminer l’email d’invitation. L’invitation a été révoquée.', corsHeaders);
      }

      return buildSuccessResponse(
        'Invitation transmise avec succès au responsable.',
        corsHeaders
      );
    }

    // CASE 2: NEW AUTH USER
    const { rawToken, tokenHashHex } = await generateSecureToken();

    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      cleanEmail,
      {
        redirectTo: `${targetOrigin}/auth/accept-school-invitation?token=${rawToken}`,
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
      console.error('[invite-school-parent] Échec inviteUserByEmail :', inviteErr?.message);
      const classified = classifyAuthInviteError(inviteErr);
      return buildErrorResponse(classified.httpStatus, classified.errorCode, classified.userMessage, corsHeaders);
    }

    const createdAuthUserId = inviteData.user.id;
    let createdInvId: string | null = null;
    let profileCreated = false;
    let parentAccountCreated = false;

    try {
      // PREPARE PARENT INVITEE IDENTITY IN DB
      const { data: prepData, error: prepErr } = await supabaseAdmin.rpc('prepare_parent_invitee_identity', {
        p_auth_user_id: createdAuthUserId,
        p_email: cleanEmail,
        p_school_id: targetSchoolId,
        p_first_name: cleanFirstName,
        p_last_name: cleanLastName
      });

      if (prepErr) {
        throw new Error(`Échec de la préparation du profil Parent: ${prepErr.message}`);
      }

      if (prepData && prepData.length > 0) {
        profileCreated = prepData[0].profile_created ?? false;
        parentAccountCreated = prepData[0].parent_account_created ?? false;
      }

      const { data: invRes, error: rpcErr } = await supabaseAdmin.rpc('create_parent_membership_invitation', {
        p_invited_by: callerUser.id,
        p_email: cleanEmail,
        p_auth_user_id: createdAuthUserId,
        p_token_hash: tokenHashHex,
        p_student_ids: student_ids,
        p_students_metadata: studentsMetadata
      });

      if (rpcErr || !invRes || invRes.length === 0) {
        throw rpcErr || new Error('Échec de la création de l’invitation parent.');
      }

      createdInvId = invRes[0].invitation_id;

      return buildSuccessResponse(
        'Invitation transmise avec succès au responsable.',
        corsHeaders
      );

    } catch (atomicErr: any) {
      // ATOMIC COMPENSATION FOR NEW USER
      try {
        await supabaseAdmin.rpc('cleanup_prepared_parent_identity', {
          p_auth_user_id: createdAuthUserId,
          p_invitation_id: createdInvId,
          p_profile_created: profileCreated,
          p_parent_account_created: parentAccountCreated
        });
      } catch (cleanErr: any) {
        console.warn('[invite-school-parent] Échec cleanup_prepared_parent_identity :', cleanErr?.message);
      }

      try {
        await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
        console.log('[invite-school-parent] Rollback Auth user orphelin :', createdAuthUserId);
      } catch (delErr: any) {
        console.warn('[invite-school-parent] Échec rollback Auth user :', delErr?.message);
      }

      const isPending = (atomicErr?.message || '').includes('INVITATION_ALREADY_PENDING') || atomicErr?.code === '23505';
      const errCode = isPending ? 'INVITATION_ALREADY_PENDING' : 'invitation_processing_failed';
      const errMsg = isPending
        ? 'Une invitation est déjà active pour cette adresse.'
        : 'Échec de l’enregistrement de l’invitation. L’opération a été annulée.';

      return buildErrorResponse(isPending ? 409 : 500, errCode, errMsg, corsHeaders);
    }
  } catch (err: any) {
    console.error('[invite-school-parent] Erreur serveur :', err?.message);
    return buildErrorResponse(500, 'internal_error', 'Une erreur inattendue est survenue.', corsHeaders);
  }
}

if (import.meta.main) {
  serve(inviteSchoolParentHandler);
}
