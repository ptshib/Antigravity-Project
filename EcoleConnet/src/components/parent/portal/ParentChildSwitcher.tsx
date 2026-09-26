// Fichier : src/components/parent/portal/ParentChildSwitcher.tsx
import React from 'react';
import { User } from 'lucide-react';

export interface LinkedChild {
  link_id: string;
  student_id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  relationship: string;
  can_view_academic: boolean;
  enrollment_status: string;
  class_id?: string;
  class_name?: string;
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

  const initials = `${activeChild.first_name.charAt(0)}${activeChild.last_name.charAt(0)}`.toUpperCase();

  return (
    <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 rounded-3xl p-6 text-white shadow-lg border border-slate-700/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
      {/* Active Child Profile Card */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-black text-xl flex items-center justify-center border-2 border-amber-300 shadow-md shrink-0">
          {initials}
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-extrabold tracking-tight">
              {activeChild.first_name} {activeChild.last_name}
            </h2>
            {activeChild.class_name ? (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 font-extrabold text-[10px] uppercase">
                {activeChild.class_name}
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full bg-slate-700 text-slate-300 font-bold text-[10px]">
                Inscrit
              </span>
            )}
            {activeChild.school_name && (
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-600/90 text-white font-extrabold text-[10px]">
                {activeChild.school_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-300 mt-1 flex-wrap">
            <span>
              Matricule : <strong className="font-mono text-amber-400">{activeChild.student_number || 'N/A'}</strong>
            </span>
            <span>•</span>
            <span>
              Lien : <strong className="text-slate-200">{activeChild.relationship}</strong>
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
        <div className="bg-slate-950/80 p-1.5 rounded-2xl border border-slate-700/80 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-400 px-2 hidden sm:inline">
            Mes Enfants :
          </span>
          {childrenList.map(ch => {
            const isSelected = ch.student_id === selectedChildId;
            return (
              <button
                key={ch.student_id}
                type="button"
                onClick={() => onSelectChild(ch.student_id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  isSelected
                    ? 'bg-amber-500 text-slate-950 shadow-md scale-105'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>{ch.first_name}</span>
                {ch.class_name && (
                  <span className="text-[10px] opacity-80">({ch.class_name.split(' ')[0]})</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
