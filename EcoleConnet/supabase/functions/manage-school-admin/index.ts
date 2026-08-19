// Supabase Edge Function : Gestion des Administrateurs d'Établissement (Modification & Suppression Sécurisées)
// Fichier : supabase/functions/manage-school-admin/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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

    // 1. Vérification du jeton Authorization JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Jeton de sécurité Authorization manquant.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // 2. Vérification du rôle Super-Admin actif
    const { data: callerProfile, error: profileCheckError } = await supabaseClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', callerUser.id)
      .single();

    if (
      profileCheckError ||
      !callerProfile ||
      callerProfile.role !== 'super_admin' ||
      !callerProfile.is_active
    ) {
      return new Response(
        JSON.stringify({ error: 'Accès refusé. Seul un Super-Administrateur actif peut gérer les administrateurs.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload = await req.json();
    const { action, school_id, admin_id } = payload;

    if (!action || !school_id || !admin_id) {
      return new Response(
        JSON.stringify({ error: 'Les paramètres action, school_id et admin_id sont requis.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier l'administrateur cible dans public.profiles
    const { data: targetAdmin, error: targetErr } = await supabaseAdmin
      .from('profiles')
      .select('id, school_id, role, first_name, last_name, is_active')
      .eq('id', admin_id)
      .single();

    if (targetErr || !targetAdmin || targetAdmin.role !== 'school_admin' || targetAdmin.school_id !== school_id) {
      return new Response(
        JSON.stringify({ error: 'Administrateur d’établissement introuvable pour cette école.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ACTION 1 : UPDATE_ADMIN
    if (action === 'update_admin') {
      const { email, first_name, last_name, phone } = payload;
      const cleanFirstName = first_name?.trim() || targetAdmin.first_name;
      const cleanLastName = last_name?.trim() || targetAdmin.last_name;
      const cleanPhone = phone !== undefined ? (phone ? phone.trim() : null) : null;
      const cleanEmail = email?.trim().toLowerCase();

      if (cleanEmail) {
        // Mettre à jour Auth.users via API Admin
        const { error: authUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(admin_id, {
          email: cleanEmail,
          email_confirm: true
        });

        if (authUpdateErr) {
          return new Response(
            JSON.stringify({ error: `Échec de la mise à jour de l'adresse email dans Auth : ${authUpdateErr.message}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Mettre à jour public.profiles
      const { error: profileUpdateErr } = await supabaseAdmin
        .from('profiles')
        .update({
          first_name: cleanFirstName,
          last_name: cleanLastName,
          phone: cleanPhone,
          updated_at: new Date().toISOString()
        })
        .eq('id', admin_id);

      if (profileUpdateErr) {
        return new Response(
          JSON.stringify({ error: `Erreur profil : ${profileUpdateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Traçabilité Audit
      await supabaseAdmin.from('school_audit_logs').insert({
        school_id,
        actor_id: callerUser.id,
        action: 'school_admin_updated',
        details: { admin_id, new_name: `${cleanFirstName} ${cleanLastName}`, new_email: cleanEmail }
      });

      return new Response(
        JSON.stringify({ success: true, message: 'Compte administrateur mis à jour avec succès.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ACTION 2 : DELETE_ADMIN
    if (action === 'delete_admin') {
      // SÉCURITÉ CLEF : Empêcher la suppression du dernier administrateur actif de l'école
      const { data: activeAdmins } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('school_id', school_id)
        .eq('role', 'school_admin')
        .eq('is_active', true);

      const activeCount = activeAdmins?.length || 0;
      if (targetAdmin.is_active && activeCount <= 1) {
        return new Response(
          JSON.stringify({ error: "Impossible de supprimer le seul administrateur actif d'une école. Veuillez d'abord ajouter ou activer un autre administrateur." }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 1. Supprimer le profil public
      await supabaseAdmin.from('profiles').delete().eq('id', admin_id);

      // 2. Supprimer l'utilisateur Auth.users
      const { error: deleteAuthErr } = await supabaseAdmin.auth.admin.deleteUser(admin_id);
      if (deleteAuthErr) {
        return new Response(
          JSON.stringify({ error: `Avertissement Auth : Le profil a été supprimé mais Auth a retourné : ${deleteAuthErr.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 3. Traçabilité Audit (les journaux d'audit restent conservés)
      await supabaseAdmin.from('school_audit_logs').insert({
        school_id,
        actor_id: callerUser.id,
        action: 'school_admin_deleted',
        details: {
          deleted_admin_id: admin_id,
          deleted_admin_name: `${targetAdmin.first_name} ${targetAdmin.last_name}`
        }
      });

      return new Response(
        JSON.stringify({ success: true, message: `Administrateur ${targetAdmin.first_name} ${targetAdmin.last_name} supprimé définitivement avec succès.` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ACTION 3 : RESEND_INVITATION
    if (action === 'resend_invitation') {
      const { data: authUser, error: getUserErr } = await supabaseAdmin.auth.admin.getUserById(admin_id);
      const targetEmail = authUser?.user?.email;

      if (getUserErr || !targetEmail) {
        return new Response(
          JSON.stringify({ error: "Impossible de récupérer l'adresse email Auth de cet administrateur." }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const appUrl = Deno.env.get('ECOLECONNECT_APP_URL') ?? Deno.env.get('SITE_URL') ?? 'http://localhost:5178';
      const redirectTo = `${appUrl.replace(/\/$/, '')}/auth/set-password`;

      const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(targetEmail, {
        redirectTo,
        data: {
          first_name: targetAdmin.first_name,
          last_name: targetAdmin.last_name,
          school_id,
          role: 'school_admin'
        }
      });

      if (inviteErr) {
        return new Response(
          JSON.stringify({ error: `Échec du renvoi de l'invitation : ${inviteErr.message}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabaseAdmin.from('school_audit_logs').insert({
        school_id,
        actor_id: callerUser.id,
        action: 'school_admin_invitation_resent',
        details: { admin_id, email: targetEmail }
      });

      return new Response(
        JSON.stringify({ success: true, message: `L’invitation a été renvoyée avec succès à ${targetEmail}.` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Action non reconnue.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Une erreur serveur inattendue est survenue.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
