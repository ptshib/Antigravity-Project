// Fichier : src/components/teacher/portal/TeacherModulePlaceholder.tsx
import React from 'react';
import { ShieldCheck, Info } from 'lucide-react';

export interface TeacherModulePlaceholderProps {
  title: string;
  description: string;
  icon: React.ElementType;
}

export const TeacherModulePlaceholder: React.FC<TeacherModulePlaceholderProps> = ({
  title,
  description,
  icon: Icon
}) => {
  return (
    <div className="bg-white rounded-3xl p-8 sm:p-12 border border-slate-200 shadow-xs text-center max-w-2xl mx-auto my-8 space-y-6 animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto shadow-xs">
        <Icon className="w-8 h-8" />
      </div>

      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
          <Info className="w-3.5 h-3.5 text-amber-600" />
          <span>Module en cours de finalisation par la direction</span>
        </div>
        <h2 className="text-xl font-extrabold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 leading-relaxed max-w-lg mx-auto">
          {description}
        </p>
      </div>

      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-left text-xs text-slate-600 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-slate-800">Sécurité & Isolation Multi-Établissement</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Ce module sera alimenté en temps réel dès sa publication par le Secrétariat de votre établissement. Aucune donnée fictive n'est affichée.
          </p>
        </div>
      </div>
    </div>
  );
};
