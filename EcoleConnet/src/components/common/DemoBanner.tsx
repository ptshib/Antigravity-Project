import React from 'react';
import { useAuth } from '../../context/AuthContext';
import type { UserRole } from '../../types';
import { RefreshCw, Sparkles } from 'lucide-react';

interface DemoBannerProps {
  onOpenSelector: () => void;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({ onOpenSelector }) => {
  const { role, user } = useAuth();

  const roleLabels: Record<UserRole, { label: string; color: string }> = {
    admin: { label: 'Admin', color: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
    teacher: { label: 'Enseignant', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    parent: { label: 'Parent', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
    student: { label: 'Élève', color: 'bg-sky-500/20 text-sky-300 border-sky-500/30' }
  };

  const currentRole = role ? roleLabels[role] : { label: 'Invité', color: 'bg-slate-500/20 text-slate-300' };

  return (
    <div className="bg-slate-900 text-white text-xs py-1.5 px-3 sm:px-4 border-b border-slate-800 flex items-center justify-between shadow-md max-w-full overflow-hidden">
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-amber-400 text-[11px] sm:text-xs">
          <Sparkles className="w-3.5 h-3.5 animate-pulse shrink-0" />
          <span>Demo</span>
          <span className="hidden sm:inline">Mode Démonstration</span>
        </div>
        <span className="hidden md:inline text-slate-600">|</span>
        <span className="hidden md:inline text-slate-300 font-medium text-[11px]">
          Les Horizons (2026–2027)
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="hidden lg:inline text-slate-400">Connecté:</span>
          <span className="hidden md:inline font-semibold text-white truncate max-w-[100px]">
            {user?.name}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${currentRole.color}`}>
            {currentRole.label}
          </span>
        </div>

        <button
          onClick={onOpenSelector}
          className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-2 py-1 rounded-lg transition-colors shadow-xs cursor-pointer text-[11px] shrink-0"
          title="Changer le rôle de démonstration"
        >
          <RefreshCw className="w-3 h-3 shrink-0" />
          <span className="hidden sm:inline">Changer de profil</span>
          <span className="sm:hidden">Changer</span>
        </button>
      </div>
    </div>
  );
};
