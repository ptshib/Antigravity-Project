// Fichier : src/components/parent/portal/ParentPortalHeader.tsx
import React from 'react';
import { Menu, LogOut, User, ShieldCheck } from 'lucide-react';

export interface ParentPortalHeaderProps {
  schoolName?: string;
  parentName?: string;
  onOpenMobileMenu: () => void;
  onSignOut: () => void;
}

export const ParentPortalHeader: React.FC<ParentPortalHeaderProps> = ({
  schoolName,
  parentName,
  onOpenMobileMenu,
  onSignOut
}) => {
  return (
    <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between shadow-xs sticky top-0 z-30">
      <div className="flex items-center gap-3">
        {/* Mobile Hamburger Toggle */}
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 cursor-pointer"
          aria-label="Ouvrir le menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* School Name & Badge */}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-extrabold text-slate-900 truncate">
              {schoolName || 'ÉcoleConnect'}
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
              <ShieldCheck className="w-3 h-3" />
              Espace Responsable Légal
            </span>
          </div>
          <p className="text-[11px] text-slate-500 font-medium">
            Portail Officiel des Parents d'Élèves
          </p>
        </div>
      </div>

      {/* Right User Info & Logout */}
      <div className="flex items-center gap-3">
        {parentName && (
          <div className="hidden md:flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 text-xs">
            <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-[10px]">
              <User className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-slate-800">{parentName}</span>
          </div>
        )}

        <button
          type="button"
          onClick={onSignOut}
          className="p-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors cursor-pointer"
          title="Se déconnecter"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
