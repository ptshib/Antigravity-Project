// Fichier : src/components/teacher/portal/TeacherPortalSidebar.tsx
import React from 'react';
import { Logo } from '../../common/Logo';
import {
  LayoutDashboard,
  School,
  CalendarCheck,
  Clock,
  BookOpen,
  Award,
  CreditCard,
  MessageSquare,
  User,
  LogOut,
  X
} from 'lucide-react';
import type { TeacherTab } from '../../../pages/teacher/RealTeacherPortal';

export interface TeacherPortalSidebarProps {
  activeTab: TeacherTab;
  setActiveTab: (tab: TeacherTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  teacherName?: string;
  schoolName?: string;
  specialty?: string;
  assignedClassesCount?: number;
  homeworkCount?: number;
  gradesCount?: number;
  onSignOut: () => void;
}

export const TeacherPortalSidebar: React.FC<TeacherPortalSidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpenMobile,
  onCloseMobile,
  teacherName,
  schoolName,
  specialty,
  assignedClassesCount = 0,
  homeworkCount = 0,
  gradesCount = 0,
  onSignOut
}) => {
  const menuItems: Array<{
    id: TeacherTab;
    label: string;
    icon: React.ElementType;
    badge?: string;
    count?: number;
  }> = [
    { id: 'overview', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'classes', label: 'Mes classes', icon: School, count: assignedClassesCount },
    { id: 'presences', label: 'Présences', icon: CalendarCheck },
    { id: 'schedule', label: 'Emploi du temps', icon: Clock },
    { id: 'homework', label: 'Devoirs', icon: BookOpen, count: homeworkCount },
    { id: 'grades', label: 'Notes et évaluations', icon: Award, count: gradesCount },
    { id: 'finance', label: 'Situation financière', icon: CreditCard },
    { id: 'messages', label: 'Messages', icon: MessageSquare, badge: 'Bientôt' },
    { id: 'profile', label: 'Mon profil', icon: User }
  ];

  const handleSelectTab = (tab: TeacherTab) => {
    setActiveTab(tab);
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

          {/* School & Teacher Context Header */}
          <div className="px-5 py-3 bg-slate-950/60 border-b border-slate-800/60">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider truncate">
                {schoolName || 'ÉcoleConnect'}
              </p>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Enseignant
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-200 truncate mt-0.5">
              {teacherName || 'Espace Enseignant'}
            </p>
            {specialty && (
              <p className="text-[10px] text-slate-400 truncate mt-0.5">
                Spécialité : {specialty}
              </p>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1 max-h-[calc(100vh-250px)] overflow-y-auto">
            {menuItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTab(item.id)}
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
                  {item.count !== undefined && item.count > 0 && (
                    <span
                      className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isActive
                          ? 'bg-slate-950 text-amber-400'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                  {item.badge && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400 border border-slate-700/60">
                      {item.badge}
                    </span>
                  )}
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
