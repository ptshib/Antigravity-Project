import React from 'react';
import { Logo } from '../../components/common/Logo';
import { Sparkles, Terminal, ArrowLeft } from 'lucide-react';

interface ConfigRequiredPageProps {
  onGoToDemo: () => void;
  onGoToLanding: () => void;
}

export const ConfigRequiredPage: React.FC<ConfigRequiredPageProps> = ({
  onGoToDemo,
  onGoToLanding
}) => {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 text-white">
      <div className="max-w-7xl w-full mx-auto flex items-center justify-between">
        <button
          onClick={onGoToLanding}
          className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Retour à l'accueil</span>
        </button>

        <button
          onClick={onGoToDemo}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          <span>Accéder au Mode Démonstration</span>
        </button>
      </div>

      <div className="max-w-lg w-full mx-auto my-8 bg-slate-800/90 border border-amber-500/40 rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <Logo />
          <h2 className="text-2xl font-extrabold mt-4 text-amber-400">Configuration Supabase En Attente</h2>
          <p className="text-xs text-slate-300">Le projet est actuellement exécuté en mode Démonstration locale.</p>
        </div>

        <div className="p-4 bg-slate-950 rounded-2xl border border-slate-700 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-mono text-amber-400 font-bold">
            <Terminal className="w-4 h-4" />
            <span>Instructions de configuration (.env.local)</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Pour activer la connexion réelle avec Supabase, créez le fichier <code>.env.local</code> à la racine du projet avec vos identifiants :
          </p>
          <pre className="p-3 bg-slate-900 rounded-xl text-[11px] font-mono text-emerald-400 overflow-x-auto">
{`VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=votre-cle-publique`}
          </pre>
        </div>

        <div className="text-center pt-2">
          <button
            onClick={onGoToDemo}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>Explorer le Mode Démonstration Immédiatement</span>
          </button>
        </div>
      </div>

      <div className="text-center text-xs text-slate-500">
        ÉcoleConnect — Solution développée par PaTShi-Digital
      </div>
    </div>
  );
};
