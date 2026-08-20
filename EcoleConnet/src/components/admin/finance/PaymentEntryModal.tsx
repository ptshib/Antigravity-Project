// Fichier : src/components/admin/finance/PaymentEntryModal.tsx
// Modal de saisie d'encaissement de paiement via RPC SECURITY DEFINER record_student_payment

import React, { useState, useEffect } from 'react';
import { Modal } from '../../common/Modal';
import { useNotifications } from '../../../context/NotificationContext';
import { recordStudentPayment } from '../../../services/financeService';
import type { StudentInvoice, PaymentMethod, RecordPaymentResult } from '../../../types/finance';
import { FormattedAmount } from '../../common/CurrencyBadge';
import { DollarSign, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface PaymentEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: StudentInvoice | null;
  onSuccess: (result: RecordPaymentResult) => void;
}

export const PaymentEntryModal: React.FC<PaymentEntryModalProps> = ({
  isOpen,
  onClose,
  invoice,
  onSuccess
}) => {
  const { showToast } = useNotifications();

  // Form Fields
  const [amount, setAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [externalReference, setExternalReference] = useState<string>('');
  const [payerName, setPayerName] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [hasCompleted, setHasCompleted] = useState<boolean>(false);

  /**
   * RÈGLE D'IDEMPOTENCE ET VERROUILLAGE STRICT :
   * - La clé UUID v4 est générée UNE SEULE FOIS lors de l'ouverture de l'intention d'encaissement (useEffect).
   * - Tous les champs de formulaire (externalReference, payerName, notes) sont réinitialisés à zéro.
   * - Une garde technique hasCompleted verrouille immédiatement toute tentative de soumission supplémentaire après un succès.
   */
  useEffect(() => {
    if (isOpen && invoice) {
      const remaining = Number(invoice.total_amount) - Number(invoice.paid_amount);
      setAmount(remaining > 0 ? remaining : 0);
      setPaymentMethod('cash');
      setPaymentDate(new Date().toISOString().split('T')[0]);
      setExternalReference('');
      setPayerName('');
      setNotes('');
      setIdempotencyKey(crypto.randomUUID());
      setHasCompleted(false);
    }
  }, [isOpen, invoice]);

  if (!invoice) return null;

  const remainingBalance = Number(invoice.total_amount) - Number(invoice.paid_amount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting || hasCompleted) {
      return;
    }

    if (amount <= 0) {
      showToast('Le montant du paiement doit être supérieur à zéro.', 'urgent');
      return;
    }

    if (amount > remainingBalance + 0.001) {
      showToast(
        `Le montant encaissé (${amount}) dépasse le solde restant dû (${remainingBalance}).`,
        'urgent'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const { result, error } = await recordStudentPayment({
        p_invoice_id: invoice.id,
        p_amount: amount,
        p_payment_method: paymentMethod,
        p_idempotency_key: idempotencyKey,
        p_payment_date: paymentDate,
        p_payment_reference: externalReference.trim() || null,
        p_payer_name: payerName.trim() || null,
        p_internal_note: notes.trim() || null
      });

      if (error) {
        showToast(error.message, 'urgent');
      } else if (result) {
        setHasCompleted(true);
        if (result.is_idempotent_replay) {
          showToast('Paiement déjà enregistré (rejeu idempotent). Reçu réémis.', 'info');
        } else {
          showToast('Paiement encaissé avec succès !', 'success');
        }
        onSuccess(result);
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur lors de l'encaissement : ${msg}`, 'urgent');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Encaisser un paiement : ${invoice.invoice_number}`}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <p className="text-xs text-slate-500 font-medium -mt-2">
          Encaissement sécurisé via RPC SECURITY DEFINER record_student_payment
        </p>

        {/* Facture Summary Box */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs text-slate-700">
          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-900">Élève :</span>
            <span className="font-semibold text-slate-800">{invoice.student_name} ({invoice.student_number})</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-900">Classe :</span>
            <span>{invoice.class_name || 'N/A'}</span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-slate-200">
            <span className="font-bold text-slate-900">Total Facturé :</span>
            <span className="font-bold text-slate-900">
              <FormattedAmount amount={invoice.total_amount} currency={invoice.currency} />
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-900">Déjà Payé :</span>
            <span className="font-bold text-emerald-600">
              <FormattedAmount amount={invoice.paid_amount} currency={invoice.currency} />
            </span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm">
            <span className="font-extrabold text-amber-900">Solde Restant Dû :</span>
            <span className="font-extrabold text-amber-900">
              <FormattedAmount amount={remainingBalance} currency={invoice.currency} />
            </span>
          </div>
        </div>

        {/* Form Inputs */}
        <div className="space-y-4">
          <div>
            <label htmlFor="payment_amount" className="block text-xs font-bold text-slate-700 mb-1">
              Montant à encaisser ({invoice.currency}) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                id="payment_amount"
                name="payment_amount"
                type="number"
                step="0.01"
                min="0.01"
                max={remainingBalance}
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                autoComplete="off"
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-extrabold text-slate-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                required
              />
              <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Peut être inférieur ou égal au solde restant dû ({remainingBalance} {invoice.currency}).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="payment_method" className="block text-xs font-bold text-slate-700 mb-1">
                Mode de règlement <span className="text-rose-500">*</span>
              </label>
              <select
                id="payment_method"
                name="payment_method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500"
              >
                <option value="cash">Espèces (Caisse)</option>
                <option value="bank_transfer">Virement bancaire</option>
                <option value="mobile_money">Mobile Money (M-Pesa / Orange / Airtel)</option>
                <option value="cheque">Chèque bancaire</option>
                <option value="other">Autre moyen</option>
              </select>
            </div>

            <div>
              <label htmlFor="payment_date" className="block text-xs font-bold text-slate-700 mb-1">
                Date d'encaissement <span className="text-rose-500">*</span>
              </label>
              <input
                id="payment_date"
                name="payment_date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="payment_external_reference" className="block text-xs font-bold text-slate-700 mb-1">
                Référence externe (N° bordereau / Transaction Mobile Money)
              </label>
              <input
                id="payment_external_reference"
                name="payment_external_reference"
                type="text"
                value={externalReference}
                onChange={(e) => setExternalReference(e.target.value)}
                autoComplete="off"
                placeholder="ex: TRX-884920492 ou BORD-2026-004"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label htmlFor="payment_payer_name" className="block text-xs font-bold text-slate-700 mb-1">
                Nom du payeur / Déposant (Optionnel)
              </label>
              <input
                id="payment_payer_name"
                name="payment_payer_name"
                type="text"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                autoComplete="off"
                placeholder="ex: Jean Dupont (Tuteur)"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="payment_internal_note" className="block text-xs font-bold text-slate-700 mb-1">
              Notes complémentaires (Optionnel)
            </label>
            <textarea
              id="payment_internal_note"
              name="payment_internal_note"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              autoComplete="off"
              placeholder="ex: Reçu par l'agent caissier principal."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* Technical Idempotency Badge */}
        <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Idempotency Key:
          </span>
          <span className="font-bold truncate max-w-[200px]" title={idempotencyKey}>
            {idempotencyKey}
          </span>
        </div>

        {/* Modal Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Annuler
          </button>

          <button
            type="submit"
            disabled={isSubmitting || hasCompleted || amount <= 0}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Encaissement en cours...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Valider l'encaissement ({amount} {invoice.currency})
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
