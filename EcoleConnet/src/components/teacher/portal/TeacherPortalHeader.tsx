// Fichier : src/components/teacher/portal/TeacherPortalHeader.tsx
import React from 'react';
import { Menu, LogOut, UserCheck, ShieldCheck, School } from 'lucide-react';

export interface TeacherPortalHeaderProps {
  schoolName?: string;
  teacherName?: string;
  employeeNumber?: string;
  specialty?: string;
  employmentStatus?: string;
  groupedClasses?: Array<{
    class_id: string;
    class_name: string;
    subject_name?: string;
  }>;
  selectedClassId?: string;
  onSelectClass?: (classId: string) => void;
  onOpenMobileMenu: () => void;
  onSignOut: () => void;
}

export const TeacherPortalHeader: React.FC<TeacherPortalHeaderProps> = ({
  schoolName,
  teacherName,
  employeeNumber,
  specialty,
  employmentStatus,
  groupedClasses = [],
  selectedClassId,
  onSelectClass,
  onOpenMobileMenu,
  onSignOut
}) => {
  return (
    <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between shadow-xs sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile Hamburger Toggle */}
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 cursor-pointer shrink-0"
          aria-label="Ouvrir le menu Enseignant"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* School Name & Role Badges */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-extrabold text-slate-900 truncate">
              {schoolName || 'ÉcoleConnect'}
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold shrink-0">
              <ShieldCheck className="w-3 h-3 text-amber-600" />
              Espace Enseignant Officiel
            </span>
            {employmentStatus === 'active' && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold shrink-0">
                <UserCheck className="w-3 h-3 text-emerald-600" />
                Compte Actif
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 font-medium truncate">
            {teacherName ? `${teacherName}` : 'Corps Enseignant'}
            {employeeNumber && <span className="font-mono ml-1 text-slate-400">({employeeNumber})</span>}
            {specialty && <span className="ml-1 text-amber-700">• {specialty}</span>}
          </p>
        </div>
      </div>

      {/* Right Selector & Logout */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Class Selector dropdown if multiple classes */}
        {groupedClasses.length > 0 && onSelectClass && (
          <div className="hidden sm:flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold">
            <School className="w-4 h-4 text-amber-600 shrink-0" />
            <select
              value={selectedClassId || ''}
              onChange={e => onSelectClass(e.target.value)}
              className="bg-transparent border-none text-xs font-bold text-slate-800 focus:outline-none cursor-pointer max-w-[160px] truncate"
              aria-label="Sélectionner une classe affectée"
            >
              <option value="">Toutes mes classes</option>
              {groupedClasses.map(c => (
                <option key={c.class_id} value={c.class_id}>
                  {c.class_name}
                </option>
              ))}
            </select>
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
