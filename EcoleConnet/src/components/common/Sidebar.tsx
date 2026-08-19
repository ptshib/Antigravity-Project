import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Logo } from './Logo';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  GraduationCap,
  School,
  Megaphone,
  CalendarCheck,
  Award,
  Clock,
  CreditCard,
  Calendar,
  FileText,
  Settings,
  BookOpen,
  MessageSquare,
  Globe,
  RefreshCw,
  X
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onGoToLanding: () => void;
  onOpenSelector: () => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onGoToLanding,
  onOpenSelector,
  isOpenMobile,
  onCloseMobile
}) => {
  const { role } = useAuth();

  // Define menus for each role strictly according to requirements
  const adminMenu = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'eleves', label: 'Élèves', icon: GraduationCap },
    { id: 'parents', label: 'Parents', icon: Users },
    { id: 'enseignants', label: 'Enseignants', icon: UserCheck },
    { id: 'classes', label: 'Classes', icon: School },
    { id: 'communications', label: 'Communications', icon: Megaphone },
    { id: 'presences', label: 'Présences', icon: CalendarCheck },
    { id: 'resultats', label: 'Résultats', icon: Award },
    { id: 'emplois_du_temps', label: 'Emplois du temps', icon: Clock },
    { id: 'frais_scolaires', label: 'Frais scolaires', icon: CreditCard },
    { id: 'calendrier', label: 'Calendrier', icon: Calendar },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'parametres', label: 'Paramètres', icon: Settings },
  ];

  const teacherMenu = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'mes_classes', label: 'Mes classes', icon: School },
    { id: 'presences', label: 'Présences', icon: CalendarCheck },
    { id: 'devoirs', label: 'Devoirs', icon: BookOpen },
    { id: 'resultats', label: 'Résultats', icon: Award },
    { id: 'emploi_du_temps', label: 'Emploi du temps', icon: Clock },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'calendrier', label: 'Calendrier', icon: Calendar },
    { id: 'documents', label: 'Documents', icon: FileText },
  ];

  const parentMenu = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'mes_enfants', label: 'Mes enfants', icon: Users },
    { id: 'presences', label: 'Présences', icon: CalendarCheck },
    { id: 'resultats', label: 'Résultats', icon: Award },
    { id: 'devoirs', label: 'Devoirs', icon: BookOpen },
    { id: 'emploi_du_temps', label: 'Emploi du temps', icon: Clock },
    { id: 'paiements', label: 'Paiements', icon: CreditCard },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'calendrier', label: 'Calendrier', icon: Calendar },
    { id: 'documents', label: 'Documents', icon: FileText },
  ];

  const studentMenu = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'mes_cours', label: 'Mes cours', icon: BookOpen },
    { id: 'devoirs', label: 'Devoirs', icon: BookOpen },
    { id: 'resultats', label: 'Résultats', icon: Award },
    { id: 'emploi_du_temps', label: 'Emploi du temps', icon: Clock },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'calendrier', label: 'Calendrier', icon: Calendar },
    { id: 'documents', label: 'Documents', icon: FileText },
  ];

  const getMenuForRole = () => {
    switch (role) {
      case 'admin':
        return adminMenu;
      case 'teacher':
        return teacherMenu;
      case 'parent':
        return parentMenu;
      case 'student':
        return studentMenu;
      default:
        return parentMenu;
    }
  };

  const menuItems = getMenuForRole();

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
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs lg:hidden"
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
                onClick={onCloseMobile}
                className="lg:hidden text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto">
            {menuItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
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

        {/* Bottom Actions */}
        <div className="p-3 border-t border-slate-800/80 space-y-2 bg-slate-950/40">
          <button
            onClick={onOpenSelector}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-xs font-bold transition-colors border border-amber-500/20 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Changer de rôle démo</span>
          </button>

          <button
            onClick={onGoToLanding}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <Globe className="w-4 h-4" />
            <span>Site public</span>
          </button>
        </div>
      </aside>
    </>
  );
};
