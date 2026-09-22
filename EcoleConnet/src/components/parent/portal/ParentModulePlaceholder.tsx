// Fichier : src/components/parent/portal/ParentModulePlaceholder.tsx
import React from 'react';
import { ShieldCheck, Info } from 'lucide-react';

export interface ParentModulePlaceholderProps {
  title: string;
  description: string;
  icon: React.ElementType;
  childName?: string;
}

export const ParentModulePlaceholder: React.FC<ParentModulePlaceholderProps> = ({
  title,
  description,
  icon: Icon,
  childName
}) => {
  return (
    <div className="bg-white rounded-3xl p-8 sm:p-12 border border-slate-200 shadow-xs text-center max-w-2xl mx-auto my-8 space-y-6 animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center mx-auto shadow-xs">
        <Icon className="w-8 h-8" />
      </div>

      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
          <Info className="w-3.5 h-3.5 text-amber-600" />
          <span>Module en cours de connexion aux données de l'établissement</span>
        </div>
        <h2 className="text-xl font-extrabold text-slate-900">{title}</h2>
        {childName && (
          <p className="text-xs font-bold text-blue-700">Dossier de {childName}</p>
        )}
        <p className="text-xs text-slate-500 leading-relaxed max-w-lg mx-auto">
          {description}
        </p>
      </div>

      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-left text-xs text-slate-600 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-slate-800">Sécurité & Isolation Multi-Établissement</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Ce module s'affichera automatiquement dès que les données réelles Supabase correspondantes seront publiées par la direction de votre établissement.
          </p>
        </div>
      </div>
    </div>
  );
};
