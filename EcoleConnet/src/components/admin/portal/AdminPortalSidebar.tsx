// Fichier : src/components/admin/portal/AdminPortalSidebar.tsx
import React, { useEffect } from 'react';
import { Logo } from '../../common/Logo';
import {
  Activity,
  DollarSign,
  Calendar,
  Clock,
  BookMarked,
  Sliders,
  BookOpen,
  UserCheck,
  Users,
  GraduationCap,
  CalendarCheck,
  FileText,
  CalendarDays,
  Award,
  Layers,
  Upload,
  FileCheck,
  Settings,
  LogOut,
  X
} from 'lucide-react';

export type SchoolAdminTab =
  | 'vue_densemble'
  | 'finance'
  | 'annees_scolaires'
  | 'trimestres'
  | 'matieres'
  | 'coefficients'
  | 'classes'
  | 'enseignants'
  | 'parents'
  | 'eleves'
  | 'presences'
  | 'devoirs'
  | 'emploi_du_temps'
  | 'notes'
  | 'affectations'
  | 'importations'
  | 'documents'
  | 'parametres';

export interface AdminPortalSidebarProps {
  activeTab: SchoolAdminTab;
  setActiveTab: (tab: SchoolAdminTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  isFinanceAgent?: boolean;
  schoolName?: string;
  schoolStatus?: string;
  schoolSlug?: string;
  adminName?: string;
  adminRole?: string;
  onSignOut: () => void;
  counts?: {
    academicYears?: number;
    schoolTerms?: number;
    subjects?: number;
    classes?: number;
    teachers?: number;
    parents?: number;
    students?: number;
    attendanceSessions?: number;
    homework?: number;
    assessments?: number;
    assignments?: number;
    importJobs?: number;
  };
}

interface NavItemDef {
  id: SchoolAdminTab;
  label: string;
  icon: React.ElementType;
  countKey?: keyof NonNullable<AdminPortalSidebarProps['counts']>;
}

interface NavSection {
  title?: string;
  items: NavItemDef[];
}

export const AdminPortalSidebar: React.FC<AdminPortalSidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpenMobile,
  onCloseMobile,
  isFinanceAgent = false,
  schoolName,
  schoolStatus,
  schoolSlug,
  adminName,
  adminRole,
  onSignOut,
  counts = {}
}) => {
  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpenMobile) {
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpenMobile, onCloseMobile]);

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

  const navSections: NavSection[] = isFinanceAgent
    ? [
        {
          items: [
            { id: 'finance', label: 'Finance & Frais', icon: DollarSign }
          ]
        }
      ]
    : [
        {
          title: 'GESTION',
          items: [
            { id: 'vue_densemble', label: 'Vue d’ensemble', icon: Activity },
            { id: 'eleves', label: 'Élèves', icon: GraduationCap, countKey: 'students' },
            { id: 'parents', label: 'Parents', icon: Users, countKey: 'parents' },
            { id: 'enseignants', label: 'Enseignants', icon: UserCheck, countKey: 'teachers' },
            { id: 'classes', label: 'Classes', icon: BookOpen, countKey: 'classes' },
            { id: 'affectations', label: 'Affectations', icon: Layers, countKey: 'assignments' }
          ]
        },
        {
          title: 'PÉDAGOGIE',
          items: [
            { id: 'annees_scolaires', label: 'Années', icon: Calendar, countKey: 'academicYears' },
            { id: 'trimestres', label: 'Calendrier scolaire', icon: Clock, countKey: 'schoolTerms' },
            { id: 'matieres', label: 'Matières', icon: BookMarked, countKey: 'subjects' },
            { id: 'coefficients', label: 'Coefficients', icon: Sliders },
            { id: 'presences', label: 'Présences', icon: CalendarCheck, countKey: 'attendanceSessions' },
            { id: 'devoirs', label: 'Devoirs', icon: FileText, countKey: 'homework' },
            { id: 'emploi_du_temps', label: 'Emploi du temps', icon: CalendarDays },
            { id: 'notes', label: 'Notes', icon: Award, countKey: 'assessments' }
          ]
        },
        {
          title: 'ADMINISTRATION',
          items: [
            { id: 'finance', label: 'Finance & Frais', icon: DollarSign },
            { id: 'importations', label: 'Importations', icon: Upload, countKey: 'importJobs' },
            { id: 'documents', label: 'Documents scolaires', icon: FileCheck },
            { id: 'parametres', label: 'Paramètres', icon: Settings }
          ]
        }
      ];

  const handleSelectTab = (tab: SchoolAdminTab) => {
    setActiveTab(tab);
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs lg:hidden cursor-pointer"
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar Shell */}
      <aside
        id="admin-sidebar"
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 sm:w-70 bg-slate-900 text-slate-300 flex flex-col justify-between border-r border-slate-800 transition-transform duration-300 ease-in-out shrink-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex flex-col h-full overflow-hidden">
          {/* Top Branding Header */}
          <div className="p-4 sm:p-5 border-b border-slate-800/80 flex items-center justify-between shrink-0">
            <Logo variant="white" size="md" showSubtitle />
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="lg:hidden text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Fermer le menu de navigation"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* School Identity Card (Navy Demo style) */}
          <div className="px-4 py-3 bg-slate-950/60 border-b border-slate-800/60 shrink-0">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-extrabold text-amber-400 uppercase tracking-wider truncate" title={schoolName || 'Établissement'}>
                {schoolName || 'Établissement'}
              </p>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {schoolStatus === 'active' ? 'Opérationnel' : 'Archivé'}
              </span>
            </div>
            {schoolSlug && (
              <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                ID : {schoolSlug}
              </p>
            )}
          </div>

          {/* Nav Links Container */}
          <nav
            className="flex-1 p-3 space-y-4 overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-slate-800"
            aria-label="Navigation principale administrateur"
          >
            {navSections.map((section, sIdx) => (
              <div key={sIdx} className="space-y-1">
                {section.title && (
                  <div className="px-3 pt-2 pb-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {section.title}
                    </span>
                  </div>
                )}
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  const countVal = item.countKey ? counts[item.countKey] : undefined;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => handleSelectTab(item.id)}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-semibold text-xs sm:text-xs transition-all duration-200 cursor-pointer text-left flex-shrink-0 ${
                        isActive
                          ? 'bg-gradient-to-r from-blue-600 to-blue-700 bg-amber-500 text-white shadow-md font-bold'
                          : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {countVal !== undefined && (
                        <span
                          className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                            isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {countVal}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* User Profile & Sign Out Footer */}
          <div className="p-3.5 border-t border-slate-800/80 bg-slate-950/60 shrink-0 space-y-2">
            <div className="px-2 py-1">
              <p className="text-xs font-bold text-white truncate" title={adminName || 'Administrateur'}>{adminName || 'Administrateur'}</p>
              <p className="text-[10px] text-slate-400 truncate">{adminRole || 'Console Admin'}</p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-300 text-xs font-bold transition-colors border border-slate-700/80 cursor-pointer"
              title="Se déconnecter"
            >
              <LogOut className="w-4 h-4" />
              <span>Se déconnecter</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
