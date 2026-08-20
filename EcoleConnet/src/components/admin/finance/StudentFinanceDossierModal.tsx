// Fichier : src/components/admin/finance/StudentFinanceDossierModal.tsx
// Modal de consultation du dossier financier élève et annulation contrôlée de paiement

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '../../common/Modal';
import { useNotifications } from '../../../context/NotificationContext';
import { getStudentFinanceDossierAdmin, cancelStudentPayment } from '../../../services/financeService';
import type { StudentFinanceDossierAdminResult, Currency } from '../../../types/finance';
import { FormattedAmount, InvoiceStatusBadge } from '../../common/CurrencyBadge';
import { getPaymentMethodLabel } from '../../../utils/formatters';
import { PaymentReceiptModal, type PaymentReceiptData } from './PaymentReceiptModal';
import { User, ShieldAlert, XCircle, ChevronRight, FileCheck, Eye } from 'lucide-react';

interface StudentFinanceDossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string | null;
  studentName?: string;
  academicYearId?: string | null;
  onRefreshParent?: () => void;
  onViewReceipt?: (receipt: PaymentReceiptData) => void;
}

interface CancelTarget {
  id: string;
  number: string;
  receiptNumber: string;
  amount: number;
  currency: Currency;
  invoiceNumber: string;
}

export const StudentFinanceDossierModal: React.FC<StudentFinanceDossierModalProps> = ({
  isOpen,
  onClose,
  studentId,
  studentName,
  academicYearId,
  onRefreshParent,
  onViewReceipt
}) => {
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState<boolean>(true);
  const [dossier, setDossier] = useState<StudentFinanceDossierAdminResult | null>(null);

  // Receipt Modal State (Embedded)
  const [viewingReceipt, setViewingReceipt] = useState<PaymentReceiptData | null>(null);

  // Cancellation Modal State
  const [selectedPaymentForCancel, setSelectedPaymentForCancel] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const isCancellingRef = useRef<boolean>(false);

  const fetchDossier = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const { dossier: data, error } = await getStudentFinanceDossierAdmin(studentId, academicYearId);
      if (error) {
        showToast(`Erreur dossier financier : ${error.message}`, 'urgent');
      } else {
        setDossier(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
    } finally {
      setLoading(false);
    }
  }, [studentId, academicYearId, showToast]);

  useEffect(() => {
    if (isOpen && studentId) {
      fetchDossier();
    }
  }, [isOpen, studentId, fetchDossier]);

  // Reconstruct receipt data from payment record
  const buildReceiptData = (pay: NonNullable<typeof dossier>['payments'][0]): PaymentReceiptData => {
    const inv = dossier?.invoices.find((i) => i.id === pay.invoice_id);
    return {
      receipt_number: pay.receipt_number || `REC-${pay.payment_number}`,
      payment_number: pay.payment_number,
      invoice_number: pay.invoice_number || inv?.invoice_number || '',
      student_name: dossier?.student.name || studentName || 'Élève',
      student_number: dossier?.student.student_number || '',
      class_name: dossier?.student.class_name,
      amount: pay.amount,
      currency: pay.currency,
      payment_date: pay.payment_date,
      payment_method: pay.payment_method,
      recorded_by_name: pay.recorded_by_name || undefined,
      is_idempotent_replay: false,
      is_cancelled: pay.status === 'cancelled',
      cancel_reason: pay.cancel_reason || undefined,
      cancelled_at: pay.cancelled_at || undefined
    };
  };

  const handleViewReceipt = (pay: NonNullable<typeof dossier>['payments'][0]) => {
    const receiptData = buildReceiptData(pay);
    setViewingReceipt(receiptData);
    if (onViewReceipt) onViewReceipt(receiptData);
  };

  // Handle Payment Cancellation Submit with Double-Click Protection
  const handleConfirmCancelPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPaymentForCancel || isCancellingRef.current) return;

    const trimmedReason = cancelReason.trim();
    if (!trimmedReason || trimmedReason.length < 10) {
      showToast('Le motif d’annulation est obligatoire et doit comporter au moins 10 caractères.', 'urgent');
      return;
    }

    isCancellingRef.current = true;
    setIsCancelling(true);

    try {
      const { error } = await cancelStudentPayment(selectedPaymentForCancel.id, trimmedReason);
      if (error) {
        showToast(`Erreur annulation : ${error.message}`, 'urgent');
      } else {
        showToast(`Paiement N° ${selectedPaymentForCancel.number} annulé avec succès.`, 'success');
        setSelectedPaymentForCancel(null);
        setCancelReason('');

        // Rafraîchissement sécurisé des factures et du dossier sans transformer un succès RPC en échec
        try {
          await fetchDossier();
          if (onRefreshParent) onRefreshParent();
        } catch {
          // L'erreur de rafraîchissement secondaire ne masque pas le succès de l'annulation
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur lors de l'annulation : ${msg}`, 'urgent');
    } finally {
      isCancellingRef.current = false;
      setIsCancelling(false);
    }
  };

  // Compute Multi-Currency Summaries directly from real invoice & payment records
  const currencySummaries = React.useMemo(() => {
    if (!dossier) return [];

    const currenciesSet = new Set<Currency>();
    dossier.invoices.forEach((inv) => currenciesSet.add(inv.currency));
    dossier.payments.forEach((pay) => currenciesSet.add(pay.currency));

    if (currenciesSet.size === 0) return [];

    const sortedCurrencies = Array.from(currenciesSet).sort((a, b) => {
      if (a === 'CDF') return -1;
      if (b === 'CDF') return 1;
      return a.localeCompare(b);
    });

    return sortedCurrencies.map((currency) => {
      const currInvoices = dossier.invoices.filter((inv) => inv.currency === currency);
      const currPayments = dossier.payments.filter((pay) => pay.currency === currency);

      const total_invoiced = currInvoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

      // Total réglé actif (Exclut strictement les paiements annulés)
      const activePayments = currPayments.filter((pay) => pay.status !== 'cancelled');
      const total_paid = activePayments.reduce((sum, pay) => sum + Number(pay.amount || 0), 0);

      const total_remaining = Math.max(0, total_invoiced - total_paid);

      const invoices_count = currInvoices.length;
      const active_payments_count = activePayments.length;
      const total_payments_count = currPayments.length;
      const cancelled_payments_count = currPayments.filter((pay) => pay.status === 'cancelled').length;

      return {
        currency,
        total_invoiced,
        total_paid,
        total_remaining,
        invoices_count,
        active_payments_count,
        total_payments_count,
        cancelled_payments_count
      };
    });
  }, [dossier]);

  if (!isOpen) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Dossier Financier : ${dossier?.student.name || studentName || 'Élève'}`}
        maxWidth="xl"
      >
        <div className="space-y-6">
          <p className="text-xs text-slate-500 font-medium -mt-2">
            Consultation consolidée des factures et historique des encaissements (RPC SECURITY DEFINER)
          </p>

          {loading ? (
            <div className="py-12 text-center text-slate-500 text-xs font-medium">
              Chargement du dossier financier...
            </div>
          ) : !dossier ? (
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
              Impossible de charger le dossier financier de l'élève.
            </div>
          ) : (
            <>
              {/* Student Header */}
              <div className="p-4 bg-slate-900 text-white rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black">{dossier.student.name}</h3>
                    <p className="text-xs text-slate-400">
                      Matricule: <strong className="text-amber-400 font-mono">{dossier.student.student_number}</strong> • Classe: {dossier.student.class_name}
                    </p>
                  </div>
                </div>

                <div className="text-right font-mono space-y-0.5">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Solde Global Dû</span>
                  {currencySummaries.map((summary) => (
                    <div key={summary.currency} className="text-lg font-black text-rose-400">
                      <FormattedAmount amount={summary.total_remaining} currency={summary.currency} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary KPIs (Separated by Currency) */}
              <div className="space-y-3">
                {currencySummaries.map((summary) => (
                  <div key={summary.currency} className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
                    <div className="flex justify-between items-center pb-1.5 border-b border-slate-200 text-xs font-bold text-slate-800">
                      <span className="flex items-center gap-1.5 uppercase font-extrabold text-slate-900">
                        Synthèse Financière en {summary.currency}
                      </span>
                      <span className="text-[11px] text-slate-600 font-medium">
                        {summary.invoices_count} {summary.invoices_count > 1 ? 'factures' : 'facture'} • {summary.active_payments_count} {summary.active_payments_count > 1 ? 'paiements actifs' : 'paiement actif'}
                        {summary.cancelled_payments_count > 0 && ` (${summary.total_payments_count} historiques, dont ${summary.cancelled_payments_count} annulé)`}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div className="p-3 bg-white border border-slate-200 rounded-xl text-center shadow-2xs">
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">Total Facturé</span>
                        <span className="text-sm font-extrabold text-slate-900 mt-0.5 block">
                          <FormattedAmount amount={summary.total_invoiced} currency={summary.currency} />
                        </span>
                      </div>

                      <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl text-center shadow-2xs">
                        <span className="text-[10px] text-emerald-700 font-bold uppercase block">Total Réglé Actif</span>
                        <span className="text-sm font-extrabold text-emerald-700 mt-0.5 block">
                          <FormattedAmount amount={summary.total_paid} currency={summary.currency} />
                        </span>
                      </div>

                      <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-center shadow-2xs">
                        <span className="text-[10px] text-amber-800 font-bold uppercase block">Solde Dû ({summary.currency})</span>
                        <span className="text-sm font-extrabold text-amber-900 mt-0.5 block">
                          <FormattedAmount amount={summary.total_remaining} currency={summary.currency} />
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Invoices List */}
              <div className="space-y-3">
                <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <FileCheck className="w-4 h-4 text-indigo-600" />
                  Historique des Factures Émises ({dossier.invoices.length})
                </h4>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {dossier.invoices.map((inv) => (
                    <div key={inv.id} className="p-3 bg-white border border-slate-200 rounded-xl text-xs space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <strong className="font-mono font-bold text-slate-900">{inv.invoice_number}</strong>
                            <InvoiceStatusBadge status={inv.status} />
                          </div>
                          <span className="text-[11px] text-slate-500">Émise le {inv.issue_date}</span>
                        </div>

                        <div className="text-right">
                          <span className="font-extrabold text-slate-900 block">
                            <FormattedAmount amount={inv.total_amount} currency={inv.currency} />
                          </span>
                          <span className="text-[10px] text-emerald-600 font-bold">
                            Payé: {inv.paid_amount} {inv.currency}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payments List */}
              <div className="space-y-3">
                <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <ChevronRight className="w-4 h-4 text-emerald-600" />
                  Historique des Encaissements et Reçus ({dossier.payments.length})
                </h4>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {dossier.payments.map((pay) => {
                    const isCancelled = pay.status === 'cancelled';
                    return (
                      <div
                        key={pay.id}
                        className={`p-3 border rounded-xl text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 ${
                          isCancelled ? 'bg-rose-50/40 border-rose-200' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <strong className="font-mono font-bold text-slate-900">{pay.payment_number}</strong>
                            {pay.receipt_number && (
                              <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-md text-[10px] font-mono font-bold">
                                Reçu: {pay.receipt_number}
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isCancelled ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}
                            >
                              {isCancelled ? 'Annulé' : 'Validé'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Le {pay.payment_date} via {getPaymentMethodLabel(pay.payment_method)} • Par {pay.recorded_by_name || 'Agent'}
                          </p>
                          {isCancelled && pay.cancel_reason && (
                            <p className="text-[11px] text-rose-700 font-medium italic bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200/60 mt-1">
                              Motif d'annulation : "{pay.cancel_reason}" {pay.cancelled_at && `(le ${pay.cancelled_at.split('T')[0]})`}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <span className={`font-extrabold ${isCancelled ? 'line-through text-slate-400' : 'text-emerald-700'}`}>
                            <FormattedAmount amount={pay.amount} currency={pay.currency} />
                          </span>

                          {/* Voir Reçu */}
                          <button
                            type="button"
                            onClick={() => handleViewReceipt(pay)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition cursor-pointer flex items-center gap-1 text-[11px] font-bold"
                            title="Consulter et imprimer le reçu"
                          >
                            <Eye className="w-3.5 h-3.5 text-amber-600" />
                            <span>Reçu</span>
                          </button>

                          {/* Annuler paiement (Si non annulé) */}
                          {!isCancelled && (
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedPaymentForCancel({
                                  id: pay.id,
                                  number: pay.payment_number,
                                  receiptNumber: pay.receipt_number || `REC-${pay.payment_number}`,
                                  amount: pay.amount,
                                  currency: pay.currency,
                                  invoiceNumber: pay.invoice_number || dossier?.invoices.find((i) => i.id === pay.invoice_id)?.invoice_number || 'N/A'
                                })
                              }
                              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition cursor-pointer flex items-center gap-1 text-[11px] font-bold"
                              title="Annuler ce paiement avec enregistrement du motif"
                            >
                              <XCircle className="w-3.5 h-3.5 text-rose-600" />
                              <span>Annuler</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Embedded Payment Receipt Modal */}
      {viewingReceipt && (
        <PaymentReceiptModal
          isOpen={!!viewingReceipt}
          onClose={() => setViewingReceipt(null)}
          receipt={viewingReceipt}
          schoolName={dossier?.student.school_name}
        />
      )}

      {/* Cancellation Dialog Modal */}
      {selectedPaymentForCancel && (
        <Modal
          isOpen={!!selectedPaymentForCancel}
          onClose={() => {
            if (!isCancelling) {
              setSelectedPaymentForCancel(null);
              setCancelReason('');
            }
          }}
          title={`Annuler le Paiement N° ${selectedPaymentForCancel.number}`}
          maxWidth="md"
        >
          <form onSubmit={handleConfirmCancelPayment} className="space-y-4">
            <p className="text-xs text-slate-500 font-medium -mt-2">
              Annulation contrôlée et auditable via RPC SECURITY DEFINER cancel_student_payment
            </p>

            {/* Target Payment Details */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs text-slate-700 font-mono">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 uppercase text-[10px] font-bold">Paiement :</span>
                <strong className="text-slate-900">{selectedPaymentForCancel.number}</strong>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 uppercase text-[10px] font-bold">Reçu Officiel :</span>
                <strong className="text-amber-700">{selectedPaymentForCancel.receiptNumber}</strong>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 uppercase text-[10px] font-bold">Facture Concernée :</span>
                <strong className="text-slate-800">{selectedPaymentForCancel.invoiceNumber}</strong>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm">
                <span className="text-slate-500 uppercase text-[10px] font-bold">Montant à Annuler :</span>
                <strong className="text-rose-600 font-extrabold">
                  <FormattedAmount amount={selectedPaymentForCancel.amount} currency={selectedPaymentForCancel.currency} />
                </strong>
              </div>
            </div>

            {/* Warning Box */}
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-rose-800">
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                <span>Action administrative irréversible</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                L'annulation désactivera ce reçu et réaugmentera le solde restant dû de la facture concernée d'un montant de <strong>{selectedPaymentForCancel.amount} {selectedPaymentForCancel.currency}</strong>.
              </p>
            </div>

            {/* Reason Input */}
            <div>
              <label htmlFor="cancel_reason" className="block text-xs font-bold text-slate-700 mb-1">
                Motif d'annulation obligatoire (au moins 10 caractères) <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="cancel_reason"
                name="cancel_reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                autoComplete="off"
                placeholder="ex: Paiement de test créé accidentellement par le bouton d’impression"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                required
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Longueur actuelle : {cancelReason.trim().length} / 10 caractères minimum.
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  if (!isCancelling) {
                    setSelectedPaymentForCancel(null);
                    setCancelReason('');
                  }
                }}
                disabled={isCancelling}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Annuler
              </button>

              <button
                type="submit"
                disabled={isCancelling || cancelReason.trim().length < 10}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-1.5"
              >
                {isCancelling ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Annulation en cours...
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" />
                    Confirmer l'annulation
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
};
