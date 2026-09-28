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
      <div className="p-5 border-b border-slate-800/80 flex items-center justify-between shrink-0">
        <Logo variant="white" size="md" showSubtitle />
        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Fermer le menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* School & Student Identity Block */}
      <div className="px-5 py-3.5 bg-slate-950/60 border-b border-slate-800/60 shrink-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p
            className="text-xs font-bold text-amber-400 uppercase tracking-wider line-clamp-2 leading-tight min-w-0"
            title={schoolName || 'ÉcoleLink'}
          >
            {schoolName || 'ÉcoleLink'}
          </p>
          <span className="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shrink-0">
            Espace Élève
          </span>
        </div>

        <div className="pt-1.5 border-t border-slate-800/50 space-y-1">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-xs font-bold text-slate-100 truncate">
              {studentName || 'Élève'}
            </p>
          </div>
          {studentNumber && (
            <p className="text-[11px] text-slate-400 font-mono pl-6 truncate">
              Matricule : <span className="text-amber-300 font-bold">{studentNumber}</span>
            </p>
          )}
          {className && (
            <p className="text-[11px] text-slate-400 pl-6 truncate">
              Classe : <strong className="text-slate-200">{className}</strong>
            </p>
          )}
          {academicYearName && (
            <p className="text-[10px] text-slate-500 pl-6 font-medium truncate">
              Année : {academicYearName}
            </p>
          )}
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
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
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-xs transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md font-extrabold'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Footer Controls */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 shrink-0 space-y-2">
        {onRefresh && (
          <button
            type="button"
            onClick={() => {
              onRefresh();
              onCloseMobile();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Actualiser les données</span>
          </button>
        )}
        <button
          type="button"
          onClick={onSignOut}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-300 text-xs font-bold transition-colors border border-slate-700/80 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          <span>Déconnexion</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (Fixed Left Column) */}
      <aside className="hidden lg:flex w-64 flex-col shrink-0 min-h-screen sticky top-0 z-20 shadow-xl border-r border-slate-800">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop & Modal Container */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Overlay Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs transition-opacity"
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
