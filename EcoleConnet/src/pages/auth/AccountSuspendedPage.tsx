import React from 'react';
import { ShieldAlert, Phone, ArrowLeft } from 'lucide-react';
import { SCHOOL_INFO } from '../../data/mockData';

interface AccountSuspendedPageProps {
  reason?: string;
  onGoToLogin: () => void;
}

export const AccountSuspendedPage: React.FC<AccountSuspendedPageProps> = ({
  reason = "Accès restreint par l'administration de l'établissement ou par PaTShi-Digital.",
  onGoToLogin
}) => {
  const whatsappUrl = `https://wa.me/${SCHOOL_INFO.whatsapp.replace(/[^0-9]/g, '')}?text=Bonjour%20PaTShi-Digital,%20mon%20compte%20ÉcoleConnect%20est%20temporairement%20suspendu.`;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 text-white">
      <div className="max-w-7xl w-full mx-auto">
        <button
          onClick={onGoToLogin}
          className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Déconnexion / Retour</span>
        </button>
      </div>

      <div className="max-w-md w-full mx-auto my-8 bg-slate-800/90 border border-rose-500/40 rounded-3xl p-8 shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/30">
          <ShieldAlert className="w-9 h-9" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-extrabold text-white">Accès Suspendu ou Restreint</h2>
          <p className="text-xs text-rose-300 font-semibold">{reason}</p>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Votre profil ou votre établissement scolaire est actuellement en cours de vérification administrative. Veuillez contacter directement l'équipe de support.
        </p>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 block"
        >
          <Phone className="w-4 h-4" />
          <span>Contacter PaTShi-Digital sur WhatsApp</span>
        </a>
      </div>

      <div className="text-center text-xs text-slate-500">
        ÉcoleConnect — Support PaTShi-Digital : {SCHOOL_INFO.whatsapp}
      </div>
    </div>
  );
};
