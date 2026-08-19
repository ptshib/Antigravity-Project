import React, { useState } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { Logo } from '../../components/common/Logo';
import { Lock, Mail, Eye, EyeOff, Sparkles, AlertCircle, ArrowLeft, ShieldCheck } from 'lucide-react';
import { SCHOOL_INFO } from '../../data/mockData';

interface LoginPageProps {
  onGoToDemo: () => void;
  onGoToLanding: () => void;
  onGoToForgotPassword: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onGoToDemo,
  onGoToLanding,
  onGoToForgotPassword
}) => {
  const { signInWithEmail, isConfigured, authError, loading: authLoading } = useRealAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Veuillez remplir votre adresse email et votre mot de passe.');
      return;
    }

    if (!isConfigured) {
      setErrorMsg('Les identifiants réels Supabase ne sont pas configurés dans l’environnement. Veuillez utiliser le mode démonstration.');
      return;
    }

    setIsSubmitting(true);
    const { error } = await signInWithEmail(email, password);
    setIsSubmitting(false);

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        setErrorMsg('Adresse email ou mot de passe incorrect.');
      } else {
        setErrorMsg(error.message || 'Impossible de se connecter. Vérifiez vos identifiants.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 text-white selection:bg-amber-500 selection:text-slate-950">
      {/* Top Bar Navigation */}
      <div className="max-w-7xl w-full mx-auto flex items-center justify-between">
        <button
          onClick={onGoToLanding}
          className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Retour à l'accueil</span>
        </button>

        <button
          onClick={onGoToDemo}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md transition-colors flex items-center gap-2 cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          <span>Accéder au Mode Démonstration</span>
        </button>
      </div>

      {/* Main Login Box */}
      <div className="max-w-md w-full mx-auto my-8 bg-slate-800/90 border border-slate-700/80 rounded-3xl p-8 shadow-2xl space-y-6 backdrop-blur-xl">
        <div className="text-center space-y-2">
          <div className="inline-block p-3 bg-slate-900/80 rounded-2xl border border-slate-700 shadow-inner mb-2">
            <Logo />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight">Espace de Connexion</h2>
          <p className="text-xs text-slate-400">Accès sécurisé à votre établissement scolaire</p>
        </div>

        {/* Global Error Banner */}
        {(errorMsg || authError) && (
          <div className="p-4 bg-rose-500/10 border-2 border-rose-500/40 rounded-2xl flex items-start gap-3 text-rose-300 text-xs leading-relaxed animate-shake">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-rose-200">Échec de connexion</p>
              <p className="mt-0.5">{errorMsg || authError}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
              Adresse Email *
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-300 absolute left-3.5 top-3.5" />
              <input
                type="email"
                required
                placeholder="votre.email@ecole.cd"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-500 transition-all"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider">
                Mot de passe *
              </label>
              <button
                type="button"
                onClick={onGoToForgotPassword}
                className="text-[11px] font-bold text-amber-400 hover:underline cursor-pointer"
              >
                Mot de passe oublié ?
              </button>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-300 absolute left-3.5 top-3.5" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-3 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-3.5 text-slate-300 hover:text-white cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-slate-200 font-medium">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 bg-slate-950 border-2 border-slate-600"
              />
              <span>Se souvenir de moi</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || authLoading}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-extrabold text-sm rounded-xl shadow-lg transition-colors cursor-pointer flex items-center justify-center gap-2 mt-2"
          >
            {isSubmitting || authLoading ? (
              <span className="inline-block w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5" />
                <span>Se connecter</span>
              </>
            )}
          </button>
        </form>

        {/* Notice Info */}
        <div className="p-4 bg-slate-950/70 rounded-2xl border border-slate-700/80 text-center space-y-1">
          <p className="text-[11px] font-semibold text-slate-200">
            Les comptes ÉcoleConnect sont fournis par votre établissement scolaire.
          </p>
          <p className="text-[10px] text-slate-400">
            Contactez votre administrateur pour obtenir vos identifiants réels.
          </p>
        </div>
      </div>

      {/* Footer info */}
      <div className="text-center text-xs text-slate-500 space-y-1">
        <p>ÉcoleConnect — Une solution développée par <strong>PaTShi-Digital</strong></p>
        <p>WhatsApp Support : {SCHOOL_INFO.whatsapp}</p>
      </div>
    </div>
  );
};
