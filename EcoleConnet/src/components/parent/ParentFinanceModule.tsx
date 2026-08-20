// Fichier : src/components/parent/ParentFinanceModule.tsx
// Module de consultation financière des enfants rattachés pour le Portail Parent (RPC get_parent_student_finances)

import React, { useState, useEffect, useCallback } from 'react';
import { getParentStudentFinances } from '../../services/financeService';
import type { ParentStudentFinancesResult } from '../../types/finance';
import { FormattedAmount, InvoiceStatusBadge } from '../common/CurrencyBadge';
import { ShieldAlert, FileText } from 'lucide-react';

interface ParentFinanceModuleProps {
  studentId: string;
}

export const ParentFinanceModule: React.FC<ParentFinanceModuleProps> = ({ studentId }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [finances, setFinances] = useState<ParentStudentFinancesResult | null>(null);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);

  const fetchFinances = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setAccessDeniedMessage(null);
    try {
      const { finances: data, error } = await getParentStudentFinances(studentId);
      if (error) {
        setAccessDeniedMessage(error.message);
      } else {
        setFinances(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la récupération des finances de l\'enfant.';
      setAccessDeniedMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchFinances();
  }, [fetchFinances]);

  if (loading) {
    return (
      <div className="py-8 text-center text-slate-400 text-xs">
        Chargement du dossier financier de l'élève...
      </div>
    );
  }

  // Handle RLS error (can_view_finances = false or unapproved link)
  if (accessDeniedMessage) {
    return (
      <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-3xl space-y-3 text-amber-200">
        <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>Accès restreint à la consultation financière</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          {accessDeniedMessage}
        </p>
        <p className="text-[11px] text-slate-400">
          Si vous estimez qu'il s'agit d'une erreur, veuillez contacter l'administration de l'établissement pour activer la permission de consultation financière.
        </p>
      </div>
    );
  }

  if (!finances) return null;

  return (
    <div className="space-y-6">
      {/* Student Financial Summary Header */}
      <div className="p-6 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/60 rounded-3xl border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold">
                {finances.student_number}
              </span>
              <h3 className="text-lg font-black text-white">{finances.student_name}</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Classe : <strong className="text-slate-200">{finances.class_name || 'N/A'}</strong> • Situation financière globale
            </p>
          </div>

          <div className="text-right font-mono">
            <span className="text-[10px] text-slate-400 block uppercase">Solde Restant à Régler</span>
            <span className={`text-2xl font-black ${finances.total_remaining > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              <FormattedAmount amount={finances.total_remaining} currency={finances.currency} />
            </span>
          </div>
        </div>

        {/* Summary Numbers */}
        <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">Total Factures Émises</span>
            <span className="text-base font-black text-white mt-0.5 block">
              <FormattedAmount amount={finances.total_invoiced} currency={finances.currency} />
            </span>
          </div>

          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
            <span className="text-[10px] font-bold text-emerald-300 uppercase block">Total Déjà Payé</span>
            <span className="text-base font-black text-emerald-400 mt-0.5 block">
              <FormattedAmount amount={finances.total_paid} currency={finances.currency} />
            </span>
          </div>
        </div>
      </div>

      {/* Invoices List for Parent */}
      <div className="space-y-3">
        <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-400" />
          Factures & Scolarités ({finances.invoices.length})
        </h4>

        {finances.invoices.length === 0 ? (
          <div className="p-8 text-center bg-slate-900 rounded-3xl border border-slate-800 text-xs text-slate-400">
            Aucune facture émise pour le moment pour cet élève.
          </div>
        ) : (
          <div className="space-y-3">
            {finances.invoices.map((inv) => (
              <div key={inv.id} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3 hover:border-slate-700 transition">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-sm font-mono font-bold text-white">{inv.invoice_number}</strong>
                      <InvoiceStatusBadge status={inv.status} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {inv.items_summary || 'Frais de scolarité'}
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="text-base font-black text-white block">
                      <FormattedAmount amount={inv.total_amount} currency={inv.currency} />
                    </span>
                    {inv.remaining_balance > 0 ? (
                      <span className="text-xs font-bold text-amber-400">
                        Reste dû : <FormattedAmount amount={inv.remaining_balance} currency={inv.currency} />
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-emerald-400">Totalement réglée</span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex justify-between items-center text-[11px] text-slate-500">
                  <span>Émise le : {inv.issue_date}</span>
                  {inv.due_date && <span>Échéance : {inv.due_date}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
