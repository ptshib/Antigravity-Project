import React, { useState, useEffect, useRef } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { schoolInvitationService, InvitationError } from '../../services/schoolInvitationService';
import { ShieldCheck, CheckCircle2, AlertCircle, LogIn, ArrowRight, RefreshCw, KeyRound, LogOut, Building2, Users } from 'lucide-react';

interface AcceptSchoolInvitationPageProps {
  onNavigate?: (path: string) => void;
}

export type AcceptanceUIState =
  | 'INITIALIZING'
  | 'LOGIN_REQUIRED'
  | 'SET_PASSWORD_REQUIRED'
  | 'CONFIRM_ACCEPTANCE'
  | 'SUBMITTING'
  | 'SUCCESS'
  | 'EXPIRED'
  | 'ALREADY_ACCEPTED'
  | 'REVOKED'
  | 'WRONG_ACCOUNT'
  | 'MEMBERSHIP_SUSPENDED'
  | 'MEMBERSHIP_LEFT'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export const AcceptSchoolInvitationPage: React.FC<AcceptSchoolInvitationPageProps> = ({ onNavigate }) => {
  const { user, loading: authLoading, signOutReal } = useRealAuth();

  const [uiState, setUiState] = useState<AcceptanceUIState>('INITIALIZING');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successDetails, setSuccessDetails] = useState<{
    schoolName: string;
    studentsLinked: number;
  } | null>(null);

  const hasProcessedUrlTokenRef = useRef(false);

  const navigate = (path: string) => {
    const safePath = schoolInvitationService.sanitizeReturnTo(path);
    if (onNavigate) {
      onNavigate(safePath);
    } else {
      window.location.href = safePath;
    }
  };

  // 1. Audit & Extraction du jeton depuis l'URL une seule fois au chargement
  useEffect(() => {
    if (hasProcessedUrlTokenRef.current) return;
    hasProcessedUrlTokenRef.current = true;

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const rawToken = urlParams.get('token');

      if (rawToken && typeof rawToken === 'string' && rawToken.trim() !== '') {
        const cleanToken = rawToken.trim();
        if (cleanToken.length >= 10 && cleanToken.length <= 500) {
          schoolInvitationService.saveInvitationToken(cleanToken);
        }

        // Retirer uniquement le paramètre token de l'URL pour préserver d'éventuels paramètres PKCE Auth (code/type)
        urlParams.delete('token');
        const remainingQuery = urlParams.toString();
        const newUrl = window.location.pathname + (remainingQuery ? `?${remainingQuery}` : '');
        window.history.replaceState({}, document.title, newUrl);
      }
    } catch (_err) {
      // Ignorer silencieusement
    }
  }, []);

  // 2. Évaluation de l'état UI en fonction de Auth et de l'enveloppe d'invitation
  useEffect(() => {
    if (authLoading) return;

    const token = schoolInvitationService.getValidInvitationToken();

    if (!token) {
      setUiState('EXPIRED');
      setErrorMessage("Aucun jeton d’invitation valide n'a été trouvé. Veuillez réutiliser le lien reçu par e-mail.");
      return;
    }

    if (!user) {
      setUiState('LOGIN_REQUIRED');
      return;
    }

    // L'utilisateur est connecté et le token est valide
    if (uiState === 'INITIALIZING' || uiState === 'LOGIN_REQUIRED') {
      setUiState('CONFIRM_ACCEPTANCE');
    }
  }, [user, authLoading, uiState]);

  // 3. Action : Accepter l'invitation via la RPC sécurisée
  const handleAcceptInvitation = async () => {
    if (uiState === 'SUBMITTING') return;

    const token = schoolInvitationService.getValidInvitationToken();
    if (!token) {
      setUiState('EXPIRED');
      setErrorMessage("Le jeton d’invitation a expiré ou n'est plus présent.");
      return;
    }

    setUiState('SUBMITTING');
    setErrorMessage(null);

    try {
      const result = await schoolInvitationService.acceptParentSchoolInvitation(token);

      // Succès : Supprimer définitivement l'enveloppe de sessionStorage
      schoolInvitationService.clearInvitationEnvelope();

      setSuccessDetails({
        schoolName: result.school_name || 'Établissement scolaire',
        studentsLinked: result.students_linked || 0
      });
      setUiState('SUCCESS');

    } catch (err: any) {
      if (err instanceof InvitationError) {
        switch (err.code) {
          case 'WRONG_ACCOUNT':
            setUiState('WRONG_ACCOUNT');
            setErrorMessage(err.message);
            // On conserve l'enveloppe pour permettre le switch vers le bon compte
            break;

          case 'INVITATION_EXPIRED':
            schoolInvitationService.clearInvitationEnvelope();
            setUiState('EXPIRED');
            setErrorMessage(err.message);
            break;

          case 'INVITATION_ALREADY_ACCEPTED':
            schoolInvitationService.clearInvitationEnvelope();
            setUiState('ALREADY_ACCEPTED');
            setErrorMessage(err.message);
            break;

          case 'INVITATION_REVOKED':
            schoolInvitationService.clearInvitationEnvelope();
            setUiState('REVOKED');
            setErrorMessage(err.message);
            break;

          case 'MEMBERSHIP_SUSPENDED':
            setUiState('MEMBERSHIP_SUSPENDED');
            setErrorMessage(err.message);
            break;

          case 'MEMBERSHIP_LEFT':
            setUiState('MEMBERSHIP_LEFT');
            setErrorMessage(err.message);
            break;

          case 'NOT_AUTHENTICATED':
            setUiState('LOGIN_REQUIRED');
            setErrorMessage(err.message);
            break;

          case 'NETWORK_ERROR':
            setUiState('NETWORK_ERROR');
            setErrorMessage(err.message);
            break;

          default:
            setUiState('UNKNOWN_ERROR');
            setErrorMessage(err.message);
            break;
        }
      } else {
        setUiState('UNKNOWN_ERROR');
        setErrorMessage(err?.message || "Une erreur inattendue s'est produite lors de l'acceptation.");
      }
    }
  };

  // 4. Action : Se déconnecter pour switcher vers le bon compte
  const handleSwitchAccount = async () => {
    // Activer le marqueur de changement de compte sans purger le jeton
    schoolInvitationService.markAccountSwitchPending();
    await signOutReal();
    setUiState('LOGIN_REQUIRED');
  };

  if (authLoading || uiState === 'INITIALIZING') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4" aria-live="polite">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Vérification de l'invitation ÉcoleConnect...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-amber-500 selection:text-slate-950">
      {/* Visual Background Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-amber-600/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 -right-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-tr from-amber-500 to-amber-600 shadow-xl shadow-amber-950/50 mb-2">
            <ShieldCheck className="w-8 h-8 text-slate-950" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            École<span className="text-amber-500">Connect</span>
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            Portail d'Établissement Scolaire — Invitation Responsable
          </p>
        </div>

        {/* Card Main Container */}
        <div className="p-6 sm:p-8 bg-slate-900/90 border border-slate-800 rounded-3xl backdrop-blur-xl shadow-2xl space-y-6" aria-live="polite">

          {/* STATE: SUCCESS */}
          {uiState === 'SUCCESS' && (
            <div className="space-y-6 text-center">
              <div className="w-16 h-16 bg-emerald-500/10 border-2 border-emerald-500/40 rounded-full flex items-center justify-center mx-auto text-emerald-400">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div className="space-y-2">
                <h2 className="text-lg font-black text-white">Invitation acceptée avec succès !</h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Invitation acceptée. Vous pouvez maintenant accéder aux informations de votre enfant dans cet établissement.
                </p>
              </div>

              {successDetails && (
                <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl text-left space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-300">
                    <Building2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Établissement : <strong className="text-white font-bold">{successDetails.schoolName}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <Users className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Enfant(s) rattaché(s) : <strong className="text-emerald-400 font-bold">{successDetails.studentsLinked}</strong></span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => navigate('/app/parent')}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-950/50 cursor-pointer flex items-center justify-center gap-2 transition-all"
              >
                <span>Accéder à mon Espace Parent</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* STATE: CONFIRM_ACCEPTANCE & SUBMITTING */}
          {(uiState === 'CONFIRM_ACCEPTANCE' || uiState === 'SUBMITTING') && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-base font-extrabold text-white">Rejoindre l'Établissement Scolaire</h2>
                <p className="text-xs text-slate-400">
                  Vous avez été invité(e) à associer votre compte Parent à un nouvel établissement.
                </p>
              </div>

              {user?.email && (
                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-xs flex items-center justify-between">
                  <span className="text-slate-400">Compte connecté :</span>
                  <code className="text-amber-400 font-bold">{user.email}</code>
                </div>
              )}

              <button
                type="button"
                onClick={handleAcceptInvitation}
                disabled={uiState === 'SUBMITTING'}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-950/50 cursor-pointer flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {uiState === 'SUBMITTING' ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                    <span>Traitement en cours...</span>
                  </span>
                ) : (
                  <>
                    <span>Rejoindre l'établissement</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          )}

          {/* STATE: LOGIN_REQUIRED */}
          {uiState === 'LOGIN_REQUIRED' && (
            <div className="space-y-6 text-center">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center mx-auto text-amber-400">
                <LogIn className="w-6 h-6" />
              </div>

              <div className="space-y-1">
                <h3 className="font-extrabold text-white text-sm">Authentification requise</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Vous devez vous connecter à votre compte ÉcoleConnect pour accepter cette invitation.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/connexion?returnTo=/auth/accept-school-invitation')}
                  className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Se connecter à mon compte</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/auth/set-password')}
                  className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <KeyRound className="w-4 h-4 text-amber-400" />
                  <span>Nouveau parent ? Définir mon mot de passe</span>
                </button>
              </div>
            </div>
          )}

          {/* STATE: WRONG_ACCOUNT */}
          {uiState === 'WRONG_ACCOUNT' && (
            <div className="space-y-6 text-center">
              <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
                <AlertCircle className="w-6 h-6" />
              </div>

              <div className="space-y-2">
                <h3 className="font-extrabold text-white text-sm">Compte incorrect</h3>
                <p className="text-xs text-rose-300 leading-relaxed">
                  {errorMessage || "Cette invitation est destinée à un autre compte. Déconnectez-vous puis connectez-vous avec l’adresse ayant reçu l’invitation."}
                </p>
              </div>

              <button
                type="button"
                onClick={handleSwitchAccount}
                className="w-full py-3.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Se déconnecter et changer de compte</span>
              </button>
            </div>
          )}

          {/* STATES: EXPIRED, ALREADY_ACCEPTED, REVOKED, MEMBERSHIP_SUSPENDED, MEMBERSHIP_LEFT, UNKNOWN_ERROR */}
          {['EXPIRED', 'ALREADY_ACCEPTED', 'REVOKED', 'MEMBERSHIP_SUSPENDED', 'MEMBERSHIP_LEFT', 'UNKNOWN_ERROR'].includes(uiState) && (
            <div className="space-y-6 text-center">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center mx-auto text-amber-400">
                <AlertCircle className="w-6 h-6" />
              </div>

              <div className="space-y-2">
                <h3 className="font-extrabold text-white text-sm">
                  {uiState === 'EXPIRED' && "Invitation expirée"}
                  {uiState === 'ALREADY_ACCEPTED' && "Invitation déjà acceptée"}
                  {uiState === 'REVOKED' && "Invitation révoquée"}
                  {uiState === 'MEMBERSHIP_SUSPENDED' && "Accès suspendu"}
                  {uiState === 'MEMBERSHIP_LEFT' && "Établissement quitté"}
                  {uiState === 'UNKNOWN_ERROR' && "Erreur d'invitation"}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {errorMessage || "Impossible d'accéder à cette invitation."}
                </p>
              </div>

              <button
                type="button"
                onClick={() => navigate('/connexion')}
                className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                <span>Retour à la connexion</span>
              </button>
            </div>
          )}

          {/* STATE: NETWORK_ERROR */}
          {uiState === 'NETWORK_ERROR' && (
            <div className="space-y-6 text-center">
              <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
                <AlertCircle className="w-6 h-6" />
              </div>

              <div className="space-y-2">
                <h3 className="font-extrabold text-white text-sm">Erreur Réseau</h3>
                <p className="text-xs text-rose-300 leading-relaxed">
                  {errorMessage || "Une erreur de connexion est survenue. Veuillez vérifier votre réseau."}
                </p>
              </div>

              <button
                type="button"
                onClick={handleAcceptInvitation}
                className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Réessayer l'acceptation</span>
              </button>
            </div>
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
