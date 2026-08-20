// Fichier : src/components/teacher/TeacherClassFinanceOverview.tsx
// Module d'aperçu qualitatif de situation financière par classe pour les Enseignants (RPC get_teacher_class_finance_overview)

import React, { useState, useEffect, useCallback } from 'react';
import { getTeacherClassFinanceOverview } from '../../services/financeService';
import type { TeacherClassFinanceOverviewResult } from '../../types/finance';
import { CheckCircle2, AlertTriangle, ShieldAlert, Users, HelpCircle, Clock } from 'lucide-react';

interface TeacherClassFinanceOverviewProps {
  classId: string;
  className?: string;
}

export const TeacherClassFinanceOverview: React.FC<TeacherClassFinanceOverviewProps> = ({
  classId,
  className
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [overview, setOverview] = useState<TeacherClassFinanceOverviewResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const { overview: data, error } = await getTeacherClassFinanceOverview(classId);
      if (error) {
        setErrorMsg(error.message);
      } else {
        setOverview(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors du chargement de l\'aperçu financier de la classe.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading) {
    return (
      <div className="py-6 text-center text-slate-400 text-xs">
        Chargement du statut financier de la classe...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-1 text-xs text-amber-300">
        <div className="flex items-center gap-2 font-bold text-amber-400">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>Information sur la classe</span>
        </div>
        <p>{errorMsg}</p>
      </div>
    );
  }

  if (!overview) return null;

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <span className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-wider block">
              Synthèse Qualitative Établissement
            </span>
            <h3 className="text-base font-black text-white">
              Classe : {overview.class_name || className || 'Classe'}
            </h3>
            <p className="text-xs text-slate-400">
              Informations d'assiduité financière destinées à l'organisation scolaire (Aucune donnée chiffrée affichée).
            </p>
          </div>

          <div className="text-right font-mono">
            <span className="text-[10px] text-slate-400 block uppercase">Taux de Régularité</span>
            <span className="text-2xl font-black text-emerald-400 block">
              {overview.compliance_percentage} %
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
          <div
            className="bg-emerald-500 h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(overview.compliance_percentage, 100)}%` }}
          />
        </div>

        {/* Summary Badges */}
        <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-center">
            <span className="text-[10px] font-bold text-emerald-300 uppercase block">À jour</span>
            <span className="text-base font-black text-emerald-400 block mt-0.5">
              {overview.students_up_to_date} élève(s)
            </span>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-center">
            <span className="text-[10px] font-bold text-amber-300 uppercase block">En attente</span>
            <span className="text-base font-black text-amber-400 block mt-0.5">
              {overview.students_with_balance} élève(s)
            </span>
          </div>

          <div className="p-3 bg-slate-800 border border-slate-700 rounded-2xl text-center">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">Total Classe</span>
            <span className="text-base font-black text-white block mt-0.5">
              {overview.total_students} élève(s)
            </span>
          </div>
        </div>
      </div>

      {/* Students Qualitative Status List */}
      <div className="space-y-3">
        <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-400" />
          Statut par Élève ({overview.students.length})
        </h4>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 border-b border-slate-800 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Matricule</th>
                  <th className="px-4 py-3">Élève</th>
                  <th className="px-4 py-3 text-center">Situation de Scolarité</th>
                  <th className="px-4 py-3 text-right">Alerte Échéance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-medium">
                {overview.students.map((st) => (
                  <tr key={st.student_id} className="hover:bg-slate-800/50 transition">
                    <td className="px-4 py-3 font-mono font-bold text-amber-400">
                      {st.student_number}
                    </td>

                    <td className="px-4 py-3 font-bold text-white">
                      {st.student_name}
                    </td>

                    <td className="px-4 py-3 text-center">
                      {st.financial_status === 'up_to_date' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-bold rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Scolarité à jour
                        </span>
                      ) : st.financial_status === 'no_invoice' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 text-slate-400 border border-slate-700 text-[11px] font-bold rounded-full">
                          <HelpCircle className="w-3.5 h-3.5" />
                          Non facturé
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[11px] font-bold rounded-full">
                          <Clock className="w-3.5 h-3.5" />
                          Règlement en attente
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {st.has_overdue_invoice ? (
                        <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold rounded-full inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Échéance dépassée
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">Normal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
