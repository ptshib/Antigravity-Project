import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Logo } from '../../components/common/Logo';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';

interface ResetPasswordPageProps {
  onGoToLogin: () => void;
}

export const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({ onGoToLogin }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password.length < 6) {
      setErrorMsg('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setErrorMsg(error.message || 'Erreur lors de la mise à jour du mot de passe.');
    } else {
      setSuccess(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 text-white selection:bg-amber-500 selection:text-slate-950">
      <div className="max-w-md w-full mx-auto my-auto bg-slate-800/90 border border-slate-700 rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <Logo />
          <h2 className="text-xl font-extrabold mt-4">Nouveau Mot de Passe</h2>
          <p className="text-xs text-slate-400">Saisissez votre nouveau mot de passe sécurisé.</p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-500/10 border-2 border-rose-500/40 rounded-xl flex items-center gap-2 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {success ? (
          <div className="p-6 text-center bg-emerald-500/10 border-2 border-emerald-500/40 rounded-2xl space-y-3 text-xs">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <h3 className="font-bold text-sm text-emerald-200">Mot de passe réinitialisé !</h3>
            <p className="text-slate-300">
              Votre mot de passe a été mis à jour avec succès. Vous pouvez maintenant vous connecter.
            </p>
            <button
              onClick={onGoToLogin}
              className="mt-3 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 font-extrabold text-slate-950 rounded-xl cursor-pointer"
            >
              Se connecter
            </button>
          </div>
        ) : (
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Nouveau mot de passe *</label>
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

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Confirmer le mot de passe *</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-300 absolute left-3.5 top-3.5" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-3 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-500 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 font-extrabold text-slate-950 text-sm rounded-xl transition-colors cursor-pointer"
            >
              {loading ? 'Mise à jour...' : 'Enregistrer le nouveau mot de passe'}
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
