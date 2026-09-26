// Fichier : src/components/parent/portal/ParentChildSwitcher.tsx
import React from 'react';
import { User, Building2, GraduationCap } from 'lucide-react';

export interface LinkedChild {
  link_id?: string;
  student_id: string;
  student_number?: string;
  display_name: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  student_full_name?: string;
  relationship?: string;
  can_view_academic: boolean;
  can_view_attendance?: boolean;
  can_view_homework?: boolean;
  can_view_finances?: boolean;
  can_pickup_student?: boolean;
  can_receive_notifications?: boolean;
  enrollment_status?: string;
  class_id?: string;
  class_name?: string;
  academic_year_id?: string;
  academic_year_name?: string;
  school_id?: string;
  school_name?: string;
}

export interface ParentChildSwitcherProps {
  childrenList: LinkedChild[];
  selectedChildId: string;
  onSelectChild: (id: string) => void;
  activeChild?: LinkedChild;
  overallPercentage?: number | null;
}

export const ParentChildSwitcher: React.FC<ParentChildSwitcherProps> = ({
  childrenList,
  selectedChildId,
  onSelectChild,
  activeChild,
  overallPercentage
}) => {
  if (!activeChild || childrenList.length === 0) return null;

  const displayName = activeChild.display_name || activeChild.student_full_name || 'Élève';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .map(n => n.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'EL';

  const activeClassName = activeChild.class_name || 'Classe non attribuée';
  const activeSchoolName = activeChild.school_name || 'Établissement non disponible';
  const studentNumber = activeChild.student_number || 'Non renseigné';
  const relationshipLabel = activeChild.relationship || 'Lien non renseigné';

  return (
    <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 rounded-3xl p-6 text-white shadow-lg border border-slate-700/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
      {/* Active Child Profile Card */}
      <div className="flex items-center gap-4 max-w-full overflow-hidden">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-black text-xl flex items-center justify-center border-2 border-amber-300 shadow-md shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap max-w-full">
            <h2 className="text-2xl font-extrabold tracking-tight truncate max-w-full">
              {displayName}
            </h2>
            <span
              className="px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 font-extrabold text-[10px] uppercase shrink-0 flex items-center gap-1"
              title={activeClassName}
            >
              <GraduationCap className="w-3 h-3 inline" />
              {activeClassName}
            </span>
            <span
              className="px-2.5 py-0.5 rounded-full bg-indigo-600/90 text-white font-extrabold text-[10px] truncate max-w-[180px] sm:max-w-[260px] md:max-w-xs flex items-center gap-1"
              title={activeSchoolName}
              aria-label={activeSchoolName}
            >
              <Building2 className="w-3 h-3 inline shrink-0" />
              <span className="truncate">{activeSchoolName}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-300 mt-1 flex-wrap">
            <span>
              Matricule : <strong className="font-mono text-amber-400">{studentNumber}</strong>
            </span>
            <span>•</span>
            <span>
              Lien : <strong className="text-slate-200">{relationshipLabel}</strong>
            </span>
            {overallPercentage !== undefined && overallPercentage !== null && (
              <>
                <span>•</span>
                <span>
                  Moyenne :{' '}
                  <strong className="text-emerald-400 font-extrabold">
                    {overallPercentage} %
                  </strong>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Child Switcher Pills */}
      {childrenList.length > 1 && (
        <div className="bg-slate-950/80 p-1.5 rounded-2xl border border-slate-700/80 flex items-center gap-2 flex-wrap max-w-full">
          <span className="text-xs font-bold text-slate-400 px-2 hidden sm:inline">
            Mes Enfants :
          </span>
          {childrenList.map(ch => {
            const isSelected = ch.student_id === selectedChildId;
            const chClassName = ch.class_name || 'Classe non attribuée';
            const chSchoolName = ch.school_name || 'Établissement non disponible';
            const chDisplayName = ch.display_name || ch.student_full_name || 'Élève';
            const pillTooltip = `${chDisplayName} — ${chClassName} — ${chSchoolName}`;
            const pillLabel = ch.first_name || chDisplayName;

            return (
              <button
                key={ch.student_id}
                type="button"
                onClick={() => onSelectChild(ch.student_id)}
                title={pillTooltip}
                aria-label={pillTooltip}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 max-w-full ${
                  isSelected
                    ? 'bg-amber-500 text-slate-950 shadow-md scale-105'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <User className="w-3.5 h-3.5 shrink-0" />
                <span className="font-extrabold whitespace-nowrap">{pillLabel}</span>
                <span className="text-[10px] opacity-90 px-1.5 py-0.5 rounded bg-slate-900/60 font-mono font-bold shrink-0">
                  {chClassName}
                </span>
                <span
                  title={chSchoolName}
                  aria-label={chSchoolName}
                  className="text-[10px] opacity-75 truncate max-w-[90px] sm:max-w-[130px] md:max-w-[180px]"
                >
                  — {chSchoolName}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
