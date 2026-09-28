// Fichier : src/components/student/portal/StudentPortalSidebar.tsx
import React, { useEffect } from 'react';
import { Logo } from '../../common/Logo';
import {
  Award,
  Calendar,
  ClipboardCheck,
  GraduationCap,
  RefreshCw,
  LogOut,
  X
} from 'lucide-react';

export type StudentPortalTab = 'resultats' | 'emploi_du_temps' | 'devoirs';

export interface StudentPortalSidebarProps {
  activeTab: StudentPortalTab;
  setActiveTab: (tab: StudentPortalTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  schoolName?: string;
  studentName?: string;
  studentNumber?: string;
  className?: string;
  academicYearName?: string;
  onSignOut: () => void;
  onRefresh?: () => void;
}

export const StudentPortalSidebar: React.FC<StudentPortalSidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpenMobile,
  onCloseMobile,
  schoolName,
  studentName,
  studentNumber,
  className,
  academicYearName,
  onSignOut,
  onRefresh
}) => {
  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isOpenMobile) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpenMobile]);

  // Handle Escape key to close mobile drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpenMobile) {
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpenMobile, onCloseMobile]);

  const navItems: Array<{
    id: StudentPortalTab;
    label: string;
    icon: React.ElementType;
  }> = [
    { id: 'resultats', label: 'Résultats & Bulletins', icon: Award },
    { id: 'emploi_du_temps', label: 'Emploi du temps', icon: Calendar },
    { id: 'devoirs', label: 'Devoirs & Cahier de texte', icon: ClipboardCheck }
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <span className="text-xs font-black text-amber-400 uppercase tracking-wider block">
              {schoolName || 'ÉcoleConnect'}
            </span>
            <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-[10px] font-extrabold inline-block mt-0.5">
              Espace Élève
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Fermer le menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Student Badge Card */}
      <div className="px-4 py-4 border-b border-slate-800 bg-slate-950/50 shrink-0">
        <div className="p-3 bg-slate-800/60 rounded-2xl border border-slate-700/60 space-y-1">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-xs font-bold text-white truncate">{studentName || 'Élève'}</p>
          </div>
          {studentNumber && (
            <p className="text-[11px] text-slate-400 font-mono">
              Matricule : <span className="text-amber-300 font-bold">{studentNumber}</span>
            </p>
          )}
          {className && (
            <p className="text-[11px] text-slate-400">
              Classe : <strong className="text-slate-200">{className}</strong>
            </p>
          )}
          {academicYearName && (
            <p className="text-[10px] text-slate-500 font-medium">
              Année : {academicYearName}
            </p>
          )}
        </div>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <div className="px-3 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
          Navigation Scolaire
        </div>
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl text-xs font-extrabold transition-all cursor-pointer ${
                isActive
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer Controls */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/60 space-y-2 shrink-0">
        {onRefresh && (
          <button
            type="button"
            onClick={() => {
              onRefresh();
              onCloseMobile();
            }}
            className="w-full py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-amber-400" />
            <span>Actualiser les données</span>
          </button>
        )}
        <button
          type="button"
          onClick={onSignOut}
          className="w-full py-2.5 px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded-xl text-xs font-bold border border-rose-500/30 transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Déconnexion</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (Fixed Left Column) */}
      <aside className="hidden lg:flex w-72 flex-col shrink-0 min-h-screen sticky top-0 z-20 shadow-xl border-r border-slate-800">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop & Modal Container */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Overlay Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />

          {/* Sliding Panel */}
          <div className="relative w-80 max-w-[85vw] h-full shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
