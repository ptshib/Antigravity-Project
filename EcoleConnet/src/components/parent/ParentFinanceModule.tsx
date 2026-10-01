import React, { useState, useEffect, useCallback } from 'react';
import { getParentStudentFinances } from '../../services/financeService';
import type { ParentStudentFinancesResult, ParentFinanceReceipt } from '../../types/finance';
import { FormattedAmount, InvoiceStatusBadge } from '../common/CurrencyBadge';
import { ShieldAlert, FileText, AlertTriangle, RefreshCw, Receipt, Eye, CheckCircle2, XCircle } from 'lucide-react';
import { PaymentReceiptModal, type PaymentReceiptData } from '../admin/finance/PaymentReceiptModal';

interface ParentFinanceModuleProps {
  studentId: string;
}

const translatePaymentMethod = (method: string): string => {
  switch (method) {
    case 'cash':
      return 'Espèces';
    case 'bank_transfer':
      return 'Virement bancaire';
    case 'mobile_money':
      return 'Mobile Money';
    case 'card':
      return 'Carte';
    default:
      return method || 'Espèces';
  }
};

export const ParentFinanceModule: React.FC<ParentFinanceModuleProps> = ({ studentId }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [finances, setFinances] = useState<ParentStudentFinancesResult | null>(null);
  const [errorState, setErrorState] = useState<{ message: string; isPermissionDenied: boolean } | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<PaymentReceiptData | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState<boolean>(false);

  const fetchFinances = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setErrorState(null);
    setFinances(null);
    setSelectedReceipt(null);
    setIsReceiptModalOpen(false);

    try {
      const { finances: data, error } = await getParentStudentFinances(studentId);
      if (error) {
        const msg = error.message || 'Erreur lors de la récupération du dossier financier.';
        const code = (error as any).code || '';
        const isPerm =
          code === '42501' ||
          msg.toLowerCase().includes('42501') ||
          msg.toLowerCase().includes('pas autorisée') ||
          msg.toLowerCase().includes('non autorisée') ||
          msg.toLowerCase().includes('rejet accès');

        setErrorState({ message: msg, isPermissionDenied: isPerm });
      } else {
        setFinances(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur technique lors de la récupération des finances.';
      setErrorState({ message: msg, isPermissionDenied: false });
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchFinances();
  }, [fetchFinances]);

  const handleViewReceipt = (rec: ParentFinanceReceipt) => {
    if (!finances) return;
    setSelectedReceipt({
      receipt_number: rec.receipt_number,
      invoice_number: rec.invoice_number,
      student_name: finances.student_name,
      student_number: finances.student_number,
      class_name: finances.class_name,
      amount: rec.amount,
      currency: rec.currency,
      payment_date: rec.receipt_date,
      payment_method: rec.payment_method,
      balance_after_payment: rec.balance_after_payment,
      is_cancelled: rec.is_cancelled
    });
    setIsReceiptModalOpen(true);
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-400 text-xs space-y-3 bg-slate-900 rounded-3xl border border-slate-800">
        <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="font-bold text-slate-300">Chargement sécurisé du dossier financier de l'élève...</p>
      </div>
    );
  }

  // 1. Erreur de permission / accès refusé (ex: can_view_finances = false ou lien non approuvé)
  if (errorState?.isPermissionDenied) {
    return (
      <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-3xl space-y-3 text-amber-200 animate-fade-in">
        <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>Accès restreint à la consultation financière</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          {errorState.message}
        </p>
        <p className="text-[11px] text-slate-400">
          Si vous estimez qu'il s'agit d'une erreur, veuillez contacter l'administration de l'établissement pour faire activer la permission de consultation financière sur votre compte responsable.
        </p>
      </div>
    );
  }

  // 2. Erreur technique SQL ou réseau
  if (errorState && !errorState.isPermissionDenied) {
    return (
      <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-3xl space-y-4 text-rose-200 animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>Erreur lors de la récupération des données financières</span>
          </div>
          <button
            type="button"
            onClick={fetchFinances}
            className="px-3 py-1.5 bg-rose-900/60 hover:bg-rose-900 text-rose-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Réessayer</span>
          </button>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          {errorState.message}
        </p>
      </div>
    );
  }

  if (!finances) return null;

  const sortedReceipts = [...(finances.receipts || [])].sort((a, b) => {
    const dateComp = (b.receipt_date || '').localeCompare(a.receipt_date || '');
    if (dateComp !== 0) return dateComp;
    return (b.receipt_number || '').localeCompare(a.receipt_number || '');
  });

  return (
    <div className="space-y-6 animate-fade-in">
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
            <span className="text-[10px] text-slate-400 block uppercase font-bold">Solde Restant à Régler</span>
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

      {/* Receipts & Payments List for Parent */}
      <div className="space-y-3">
        <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
          <Receipt className="w-4 h-4 text-emerald-400" />
          Paiements & Reçus ({sortedReceipts.length})
        </h4>

        {sortedReceipts.length === 0 ? (
          <div className="p-8 text-center bg-slate-900 rounded-3xl border border-slate-800 text-xs text-slate-400">
            Aucun paiement ou reçu enregistré pour cet élève.
          </div>
        ) : (
          <div className="space-y-3">
            {sortedReceipts.map((rec) => (
              <div
                key={rec.receipt_number}
                className={`p-4 bg-slate-900 border rounded-2xl space-y-3 transition ${
                  rec.is_cancelled ? 'border-rose-900/50 bg-rose-950/10' : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong className="text-sm font-mono font-bold text-amber-400">{rec.receipt_number}</strong>
                      {rec.is_cancelled ? (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                          <XCircle className="w-3 h-3 text-rose-400" />
                          Annulé
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          Actif
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300">
                      Facture : <strong className="font-mono text-slate-200">{rec.invoice_number}</strong> • Mode : <strong className="text-slate-200">{translatePaymentMethod(rec.payment_method)}</strong>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Date de paiement : {rec.receipt_date}
                    </p>
                  </div>

                  <div className="flex flex-col sm:items-end justify-between w-full sm:w-auto gap-2">
                    <div className="text-left sm:text-right">
                      <span className={`text-base font-black block ${rec.is_cancelled ? 'line-through text-slate-500' : 'text-emerald-400'}`}>
                        <FormattedAmount amount={rec.amount} currency={rec.currency} />
                      </span>
                      <span className="text-[11px] text-slate-400 block font-mono">
                        Solde après paiement : <FormattedAmount amount={rec.balance_after_payment} currency={rec.currency} />
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleViewReceipt(rec)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 self-start sm:self-auto border border-slate-700"
                    >
                      <Eye className="w-3.5 h-3.5 text-amber-400" />
                      <span>Voir le reçu</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de Reçu Officiel pour le Portail Parent */}
      <PaymentReceiptModal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        receipt={selectedReceipt}
        schoolName={finances.school_name || 'ÉTABLISSEMENT SCOLAIRE'}
      />
    </div>
  );
};
