import React, { useState } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { Logo } from '../../components/common/Logo';
import { Mail, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';

interface ForgotPasswordPageProps {
  onGoToLogin: () => void;
}

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({ onGoToLogin }) => {
  const { sendPasswordReset, isConfigured } = useRealAuth();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    if (!isConfigured) {
      setErrorMsg("La configuration Supabase n'est pas active dans .env.local.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    const { error } = await sendPasswordReset(email);
    setLoading(false);

    if (error) {
      setErrorMsg(error.message || "Erreur lors de l'envoi des instructions.");
    } else {
      setSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 text-white">
      <div className="max-w-7xl w-full mx-auto">
        <button
          onClick={onGoToLogin}
          className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Retour à la connexion</span>
        </button>
      </div>

      <div className="max-w-md w-full mx-auto my-8 bg-slate-800/90 border border-slate-700 rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <Logo />
          <h2 className="text-xl font-extrabold mt-4">Mot de passe oublié</h2>
          <p className="text-xs text-slate-400">Entrez votre adresse email pour recevoir un lien de réinitialisation.</p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-500/10 border-2 border-rose-500/40 rounded-xl flex items-center gap-2 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {submitted ? (
          <div className="p-6 text-center bg-emerald-500/10 border-2 border-emerald-500/40 rounded-2xl space-y-3 text-xs">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <h3 className="font-bold text-sm text-emerald-200">Email transmis avec succès</h3>
            <p className="text-slate-300">
              Si un compte existe pour <strong>{email}</strong>, un lien de réinitialisation vous a été envoyé.
            </p>
            <button
              onClick={onGoToLogin}
              className="mt-3 px-4 py-2 bg-emerald-500 text-slate-950 font-bold rounded-xl cursor-pointer"
            >
              Retourner à la connexion
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Adresse Email *</label>
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 font-extrabold text-slate-950 text-sm rounded-xl transition-colors cursor-pointer"
            >
              {loading ? 'Envoi en cours...' : 'Envoyer le lien de réinitialisation'}
            </button>
          </form>
        )}
      </div>

      <div className="text-center text-xs text-slate-500">
        ÉcoleConnect — PaTShi-Digital
      </div>
    </div>
  );
};
