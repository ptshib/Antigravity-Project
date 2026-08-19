import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { Eye, EyeOff, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck, Mail } from 'lucide-react';

interface SetPasswordPageProps {
  onSuccessNavigate?: (path: string) => void;
}

function translateAuthError(errorMessage: string): string {
  const msg = (errorMessage || '').toLowerCase();
  if (msg.includes('new password should be different')) {
    return 'Le nouveau mot de passe doit être différent de l’ancien.';
  }
  if (msg.includes('password should be at least')) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }
  if (msg.includes('token') && (msg.includes('expired') || msg.includes('invalid') || msg.includes('pkce'))) {
    return 'Le lien d’invitation a expiré ou est invalide. Veuillez demander une nouvelle invitation.';
  }
  if (msg.includes('session') && (msg.includes('missing') || msg.includes('not found') || msg.includes('expired'))) {
    return 'Votre session a expiré. Veuillez réutiliser le lien reçu par e-mail.';
  }
  if (msg.includes('user not found') || msg.includes('profil utilisateur introuvable')) {
    return 'Profil utilisateur introuvable dans la base de données de l’établissement.';
  }
  if (msg.includes('already active') || msg.includes('déjà actif')) {
    return 'Ce compte est déjà actif. Vous pouvez vous connecter directement.';
  }
  if (msg.includes('suspended') || msg.includes('suspendu')) {
    return 'Ce compte est suspendu administrativement. Activation impossible.';
  }
  if (msg.includes('aucune inscription scolaire active')) {
    return 'Aucune inscription scolaire active pour cet élève. Veuillez contacter l’administration.';
  }
  if (msg.includes('accès refusé') || msg.includes('access denied')) {
    return 'Accès refusé. Veuillez contacter l’administrateur de l’établissement.';
  }
  return errorMessage || "Une erreur est survenue lors de l'activation.";
}

export const SetPasswordPage: React.FC<SetPasswordPageProps> = ({ onSuccessNavigate }) => {
  const { refreshProfile } = useRealAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activationStatusText, setActivationStatusText] = useState('');

  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [detectedRole, setDetectedRole] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    // 1. Détecter le jeton d'invitation/recovery dans le hash URL ou la session active
    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error || !session) {
          // Écouter les événements d'authentification (ex: confirmation lien magique/invitation)
          const { data: authListener } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
            if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || currentSession) {
              setSessionValid(true);
              setUserEmail(currentSession?.user?.email || null);
              setErrorMsg(null);

              const metaRole = currentSession?.user?.user_metadata?.role || currentSession?.user?.app_metadata?.role;
              if (metaRole) {
                setDetectedRole(metaRole);
              } else if (currentSession?.user?.id) {
                const { data: prof } = await supabase
                  .from('profiles')
                  .select('role')
                  .eq('id', currentSession.user.id)
                  .maybeSingle();
                if (prof?.role) setDetectedRole(prof.role);
              }
            }
          });

          // Timeout de sécurité si aucun jeton valide n'est extrait au bout de 2.5s
          setTimeout(async () => {
            const { data: { session: recheckSession } } = await supabase.auth.getSession();
            if (!recheckSession) {
              setSessionValid(false);
              setErrorMsg("Le lien d’invitation a expiré ou est invalide. Veuillez demander un nouveau lien à votre administrateur.");
            } else {
              setSessionValid(true);
              setUserEmail(recheckSession.user?.email || null);
              const metaRole = recheckSession.user?.user_metadata?.role || recheckSession.user?.app_metadata?.role;
              if (metaRole) {
                setDetectedRole(metaRole);
              } else {
                const { data: prof } = await supabase
                  .from('profiles')
                  .select('role')
                  .eq('id', recheckSession.user.id)
                  .maybeSingle();
                if (prof?.role) setDetectedRole(prof.role);
              }
            }
          }, 2500);

          return () => {
            authListener.subscription.unsubscribe();
          };
        } else {
          setSessionValid(true);
          setUserEmail(session.user?.email || null);
          const metaRole = session.user?.user_metadata?.role || session.user?.app_metadata?.role;
          if (metaRole) {
            setDetectedRole(metaRole);
          } else {
            const { data: prof } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', session.user.id)
              .maybeSingle();
            if (prof?.role) setDetectedRole(prof.role);
          }
        }
      } catch (_err: any) {
        setSessionValid(false);
        setErrorMsg("Erreur lors de la validation du lien d'invitation.");
      }
    };

    checkSession();
  }, []);

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (password.length < 8) {
      setErrorMsg("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("Les mots de passe ne correspondent pas.");
      return;
    }

    setSubmitting(true);
    setActivationStatusText("Mise à jour du mot de passe...");

    try {
      const authUser = (await supabase.auth.getUser()).data.user;

      // 1. Mettre à jour le mot de passe dans Supabase Auth
      const { data: updateData, error: updateErr } = await supabase.auth.updateUser({
        password: password
      });

      // Gestion de la reprise d'une activation partiellement terminée
      const isSamePasswordError =
        updateErr?.message?.toLowerCase().includes('different from the old') ||
        (updateErr as any)?.code === 'same_password';

      if (updateErr && !isSamePasswordError) {
        throw new Error(translateAuthError(updateErr.message));
      }

      // 2. Récupérer l'ID utilisateur authentifié
      const authUid = updateData?.user?.id || authUser?.id || (await supabase.auth.getUser()).data.user?.id;
      if (!authUid) {
        throw new Error("Impossible de vérifier la session authentifiée. Veuillez réutiliser votre lien d'invitation.");
      }

      // 3. Déterminer le rôle du profil SANS exiger is_active = true
      setActivationStatusText("Vérification du compte utilisateur...");
      let userRole: string | null =
        detectedRole ||
        updateData?.user?.user_metadata?.role ||
        updateData?.user?.app_metadata?.role ||
        authUser?.user_metadata?.role ||
        authUser?.app_metadata?.role ||
        null;

      // Recherche dans profiles uniquement avec profiles.id = authUid (sans filtre is_active)
      if (!userRole) {
        const { data: profData } = await supabase
          .from('profiles')
          .select('id, role, is_active, school_id')
          .eq('id', authUid)
          .maybeSingle();

        if (profData?.role) {
          userRole = profData.role;
        }
      }

      let targetPath = '/app/ecole';

      // 4. Appel exclusif de la RPC correspondant au rôle
      if (userRole === 'student') {
        targetPath = '/app/eleve';
        setActivationStatusText("Activation sécurisée de votre compte élève...");
        const { data: actData, error: actErr } = await supabase.rpc('activate_student_on_password_set');
        if (actErr) throw new Error(translateAuthError(actErr.message));
        if (actData !== true) throw new Error("L'activation du compte élève a renvoyé un résultat inattendu.");
      } else if (userRole === 'parent') {
        targetPath = '/app/parent';
        setActivationStatusText("Activation sécurisée de votre espace parent...");
        const { data: actData, error: actErr } = await supabase.rpc('activate_parent_on_password_set');
        if (actErr) throw new Error(translateAuthError(actErr.message));
        if (actData !== true) throw new Error("L'activation du compte parent a renvoyé un résultat inattendu.");
      } else if (userRole === 'teacher') {
        targetPath = '/app/enseignant';
        setActivationStatusText("Activation sécurisée de votre dossier enseignant...");
        const { data: actData, error: actErr } = await supabase.rpc('activate_teacher_on_password_set');
        if (actErr) throw new Error(translateAuthError(actErr.message));
        if (actData !== true) throw new Error("L'activation du compte enseignant a renvoyé un résultat inattendu.");
      } else if (userRole === 'school_admin') {
        targetPath = '/app/ecole';
      } else if (userRole === 'super_admin') {
        targetPath = '/app/superadmin';
      } else {
        // Fallback sécurisé : si le rôle n'était pas déductible au préalable, tester les RPC d'activation
        setActivationStatusText("Finalisation de l'activation de votre compte...");
        let activated = false;

        const { data: stData, error: stErr } = await supabase.rpc('activate_student_on_password_set');
        if (!stErr && stData === true) {
          userRole = 'student';
          targetPath = '/app/eleve';
          activated = true;
        }

        if (!activated) {
          const { data: paData, error: paErr } = await supabase.rpc('activate_parent_on_password_set');
          if (!paErr && paData === true) {
            userRole = 'parent';
            targetPath = '/app/parent';
            activated = true;
          }
        }

        if (!activated) {
          const { data: tchData, error: tchErr } = await supabase.rpc('activate_teacher_on_password_set');
          if (!tchErr && tchData === true) {
            userRole = 'teacher';
            targetPath = '/app/enseignant';
            activated = true;
          }
        }

        if (!activated) {
          // Vérification si le compte est déjà actif
          const { data: checkActive } = await supabase
            .from('profiles')
            .select('id, role, is_active')
            .eq('id', authUid)
            .maybeSingle();

          if (checkActive?.is_active) {
            userRole = checkActive.role;
            if (userRole === 'student') targetPath = '/app/eleve';
            else if (userRole === 'parent') targetPath = '/app/parent';
            else if (userRole === 'teacher') targetPath = '/app/enseignant';
            else if (userRole === 'super_admin') targetPath = '/app/superadmin';
            else targetPath = '/app/ecole';
          } else {
            throw new Error("Impossible d'activer votre compte. Veuillez contacter l'administration de l'établissement.");
          }
        }
      }

      // 5. Rafraîchir la session et le profil
      setActivationStatusText("Mise à jour de la session de connexion...");
      await supabase.auth.refreshSession();
      await refreshProfile();

      // 6. Vérifier profiles.is_active = true
      const { data: updatedProfile, error: recheckErr } = await supabase
        .from('profiles')
        .select('id, role, is_active')
        .eq('id', authUid)
        .maybeSingle();

      if (recheckErr || (updatedProfile && !updatedProfile.is_active)) {
        throw new Error("Votre compte n'a pas pu être activé. Veuillez contacter l'administration de l'établissement.");
      }

      setSuccessMsg("Votre mot de passe a été configuré et votre compte activé avec succès ! Redirection vers votre espace...");

      setTimeout(() => {
        if (onSuccessNavigate) {
          onSuccessNavigate(targetPath);
        } else {
          window.location.replace(targetPath);
        }
      }, 1500);

    } catch (err: any) {
      const msg = translateAuthError(err.message);
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
      setActivationStatusText('');
    }
  };

  const getRoleHeading = () => {
    switch (detectedRole) {
      case 'student':
        return 'Activation du compte Élève';
      case 'parent':
        return 'Activation du compte Parent';
      case 'teacher':
        return 'Activation du compte Enseignant';
      case 'school_admin':
        return 'Activation du compte Administrateur';
      case 'super_admin':
        return 'Activation du compte Super-Admin';
      default:
        return 'Activation de votre compte';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-rose-500 selection:text-white">
      {/* Dynamic Background Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-rose-600/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 -right-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Header Branding ÉcoleConnect */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-tr from-rose-600 to-indigo-600 shadow-xl shadow-rose-950/50 mb-2">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            École<span className="text-rose-500">Connect</span>
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            Plateforme d'Établissement Scolaire Privé — {getRoleHeading()}
          </p>
        </div>

        {/* Card Main Container */}
        <div className="p-6 sm:p-8 bg-slate-900/90 border border-slate-800 rounded-3xl backdrop-blur-xl shadow-2xl space-y-6">
          {sessionValid === null && (
            <div className="text-center py-8 space-y-3">
              <div className="w-8 h-8 border-4 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-bold text-slate-400">Vérification de votre lien d’invitation...</p>
            </div>
          )}

          {sessionValid === false && (
            <div className="space-y-4 text-center py-4">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center mx-auto text-amber-400">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-extrabold text-white text-sm">Lien d’invitation expiré ou invalide</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Ce lien d'activation ne peut plus être utilisé. Veuillez demander à votre administrateur de vous renvoyer une nouvelle invitation.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800">
                <a
                  href="/connexion"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-extrabold rounded-xl transition-colors w-full"
                >
                  <Mail className="w-4 h-4 text-rose-400" />
                  <span>Retour à la page de connexion</span>
                </a>
              </div>
            </div>
          )}

          {sessionValid === true && (
            <>
              <div>
                <h2 className="text-base font-extrabold text-white">Définir votre mot de passe</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {userEmail ? (
                    <span>Compte associé : <code className="text-rose-400 font-bold">{userEmail}</code></span>
                  ) : (
                    "Choisissez un mot de passe sécurisé pour finaliser votre activation."
                  )}
                </p>
              </div>

              {errorMsg && (
                <div className="p-3.5 bg-rose-950/40 border-2 border-rose-500/50 rounded-2xl flex items-start gap-2.5 text-xs text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg ? (
                <div className="p-4 bg-emerald-950/40 border-2 border-emerald-500/50 rounded-2xl flex items-center gap-3 text-xs text-emerald-300">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                  <span className="font-bold">{successMsg}</span>
                </div>
              ) : (
                <form onSubmit={handleSubmitPassword} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                      Nouveau Mot de Passe *
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        placeholder="Au moins 8 caractères"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-950 border-2 border-slate-700 rounded-xl text-sm font-medium text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20 transition-all pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                      Confirmer le Mot de Passe *
                    </label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      placeholder="Répétez votre mot de passe"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-950 border-2 border-slate-700 rounded-xl text-sm font-medium text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20 transition-all"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3.5 px-4 bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-rose-950/50 cursor-pointer flex items-center justify-center gap-2 transition-all disabled:opacity-50 mt-2"
                  >
                    {submitting ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>{activationStatusText || "Validation en cours..."}</span>
                      </span>
                    ) : (
                      <>
                        <span>Activer mon Compte & Accéder au Portail</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-slate-500">
          ÉcoleConnect — PaTShi-Digital System Security
        </p>
      </div>
    </div>
  );
};
