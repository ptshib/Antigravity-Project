// Fichier : src/components/parent/portal/ParentPortalSidebar.tsx
import React from 'react';
import { Logo } from '../../common/Logo';
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  Award,
  BookOpen,
  Clock,
  CreditCard,
  MessageSquare,
  Calendar,
  FileText,
  LogOut,
  X
} from 'lucide-react';

export interface ParentPortalSidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  parentName?: string;
  schoolName?: string;
  onSignOut: () => void;
}

export const ParentPortalSidebar: React.FC<ParentPortalSidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpenMobile,
  onCloseMobile,
  parentName,
  schoolName,
  onSignOut
}) => {
  const menuItems = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'mes_enfants', label: 'Mes enfants', icon: Users },
    { id: 'presences', label: 'Présences', icon: CalendarCheck },
    { id: 'resultats', label: 'Résultats & Bulletins', icon: Award },
    { id: 'devoirs', label: 'Devoirs', icon: BookOpen },
    { id: 'emploi_du_temps', label: 'Emploi du temps', icon: Clock },
    { id: 'paiements', label: 'Paiements & Finance', icon: CreditCard },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'calendrier', label: 'Calendrier', icon: Calendar },
    { id: 'documents', label: 'Documents', icon: FileText }
  ];

  const handleSelectTab = (id: string) => {
    setActiveTab(id);
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs lg:hidden"
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col justify-between border-r border-slate-800 transition-transform duration-300 ease-in-out ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top Header & Logo */}
        <div>
          <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
            <Logo variant="white" size="md" showSubtitle />
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="lg:hidden text-slate-400 hover:text-white p-1 cursor-pointer"
                aria-label="Fermer le menu"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* School & Parent Context Header */}
          <div className="px-5 py-3 bg-slate-950/50 border-b border-slate-800/60">
            <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider truncate">
              {schoolName || 'ÉcoleConnect'}
            </p>
            <p className="text-xs font-semibold text-slate-200 truncate mt-0.5">
              {parentName || 'Espace Parent'}
            </p>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1 max-h-[calc(100vh-240px)] overflow-y-auto">
            {menuItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md font-bold'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Signout Button */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/60">
          <button
            type="button"
            onClick={onSignOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-300 text-xs font-bold transition-colors border border-slate-700/80 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Se déconnecter</span>
          </button>
        </div>
      </aside>
    </>
  );
};
