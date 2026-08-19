// Supabase Edge Function : Création d'un Administrateur d'Établissement (School Admin)
// Fichier : supabase/functions/create-school-admin/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Gérer le pré-vol CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Le service sécurisé n’est pas configuré avec la clé service_role sur le serveur.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Vérification stricte du jeton Authorization JWT de l'appelant
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Jeton de sécurité Authorization manquant.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Client normal pour vérifier le profil de l'utilisateur authentifié
    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: callerUser }, error: callerError } = await supabaseClient.auth.getUser();
    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'Utilisateur non authentifié ou jeton expiré.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Vérification stricte du rôle Super-Admin dans la table profiles
    const { data: callerProfile, error: profileCheckError } = await supabaseClient
      .from('profiles')
      .select('role, is_active, school_id')
      .eq('id', callerUser.id)
      .single();

    if (
      profileCheckError ||
      !callerProfile ||
      callerProfile.role !== 'super_admin' ||
      !callerProfile.is_active ||
      callerProfile.school_id !== null
    ) {
      return new Response(
        JSON.stringify({ error: 'Accès refusé. Seul un Super-Administrateur PaTShi-Digital actif peut créer un administrateur d’école.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Extraction et validation des paramètres de requête
    const payload = await req.json();
    const { school_id, email, first_name, last_name, phone } = payload;

    if (!school_id || !email || !first_name || !last_name) {
      return new Response(
        JSON.stringify({ error: 'Tous les champs obligatoires (école, email, prénom, nom) doivent être renseignés.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanFirstName = first_name.trim();
    const cleanLastName = last_name.trim();
    const cleanPhone = phone ? phone.trim() : null;

    // Client Admin privilégié (Service Role) exécuté STRICTEMENT côté serveur
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Vérifier que l'école cible existe bien dans public.schools
    const { data: targetSchool, error: schoolErr } = await supabaseAdmin
      .from('schools')
      .select('id, name')
      .eq('id', school_id)
      .single();

    if (schoolErr || !targetSchool) {
      return new Response(
        JSON.stringify({ error: 'L’école spécifiée n’existe pas dans la base de données.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Vérifier si un profil existe déjà avec cet email ou ID
    const { data: existingProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, school_id, role');

    const appUrl = Deno.env.get('ECOLECONNECT_APP_URL') ?? Deno.env.get('SITE_URL') ?? 'http://localhost:5178';
    const redirectTo = `${appUrl.replace(/\/$/, '')}/auth/set-password`;

    // 6. Inviter l'utilisateur Auth via Supabase Admin API
    // Le rôle est STRICTEMENT forcé à 'school_admin' serveur side et redirigé vers ÉcoleConnect /auth/set-password
    const { data: authUserData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(cleanEmail, {
      redirectTo,
      data: {
        first_name: cleanFirstName,
        last_name: cleanLastName,
        school_id,
        role: 'school_admin'
      }
    });

    let createdUserId: string | null = null;

    if (inviteError) {
      // Si l'utilisateur Auth existe déjà, vérifier s'il a déjà un profil
      const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
      const existingAuthUser = usersList?.users?.find(u => u.email === cleanEmail);

      if (existingAuthUser) {
        createdUserId = existingAuthUser.id;
        // Vérifier si un profil existe déjà pour cet utilisateur
        const { data: existingProf } = await supabaseAdmin
          .from('profiles')
          .select('id, school_id, role')
          .eq('id', createdUserId)
          .maybeSingle();

        if (existingProf) {
          return new Response(
            JSON.stringify({ error: `L’adresse email "${cleanEmail}" est déjà associée à un compte existant.` }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        return new Response(
          JSON.stringify({ error: `Impossible de créer le compte Auth : ${inviteError.message}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (authUserData?.user) {
      createdUserId = authUserData.user.id;
    }

    if (!createdUserId) {
      return new Response(
        JSON.stringify({ error: 'Échec de l’attribution de l’identifiant Auth.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Insérer le profil dans public.profiles avec rôle FORCÉ = 'school_admin'
    const { error: profileInsertError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: createdUserId,
        school_id,
        role: 'school_admin', // STRICTEMENT FORCÉ CÔTÉ SERVEUR
        first_name: cleanFirstName,
        last_name: cleanLastName,
        phone: cleanPhone,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (profileInsertError) {
      // Stratégie compensatoire : si l'insertion du profil échoue, supprimer le compte Auth pour ne pas laisser de données orphelines
      await supabaseAdmin.auth.admin.deleteUser(createdUserId);
      return new Response(
        JSON.stringify({ error: `Erreur lors de la création du profil : ${profileInsertError.message}. Le compte Auth a été annulé.` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 8. Traçabilité dans le journal d'audit de l'établissement
    await supabaseAdmin
      .from('school_audit_logs')
      .insert({
        school_id,
        actor_id: callerUser.id,
        action: 'school_admin_created',
        details: {
          admin_user_id: createdUserId,
          admin_email: cleanEmail,
          admin_name: `${cleanFirstName} ${cleanLastName}`
        }
      });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Administrateur d’établissement ${cleanFirstName} ${cleanLastName} créé avec succès.`,
        user_id: createdUserId
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Une erreur serveur inattendue est survenue.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
