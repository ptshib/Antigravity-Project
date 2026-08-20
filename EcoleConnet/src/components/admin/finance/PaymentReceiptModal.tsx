// Fichier : src/components/admin/finance/PaymentReceiptModal.tsx
// Modal de consultation et d'impression du reçu d'encaissement officiel

import React from 'react';
import { Modal } from '../../common/Modal';
import { FormattedAmount } from '../../common/CurrencyBadge';
import { getPaymentMethodLabel } from '../../../utils/formatters';
import type { Currency, PaymentMethod } from '../../../types/finance';
import { Printer, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';

export interface PaymentReceiptData {
  receipt_number: string;
  payment_number: string;
  invoice_number: string;
  student_name: string;
  student_number: string;
  class_name?: string;
  amount: number;
  currency: Currency;
  payment_date: string;
  payment_method: PaymentMethod;
  recorded_by_name?: string;
  is_idempotent_replay?: boolean;
  is_cancelled?: boolean;
  cancel_reason?: string;
  cancelled_at?: string;
}

interface PaymentReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: PaymentReceiptData | null;
  schoolName?: string;
}

export const PaymentReceiptModal: React.FC<PaymentReceiptModalProps> = ({
  isOpen,
  onClose,
  receipt,
  schoolName = 'ÉTABLISSEMENT SCOLAIRE'
}) => {
  if (!receipt) return null;

  const handlePrint = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    window.print();
  };

  const isCancelled = !!receipt.is_cancelled;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCancelled ? "Reçu de Paiement Annulé (Archivé)" : "Reçu de Paiement Officiel"}
      maxWidth="lg"
    >
      <div className="space-y-6">
        <p className="text-xs text-slate-500 font-medium -mt-2">
          Reçu officiel généré par le système bancaire / caisse d'ÉcoleConnect
        </p>

        {isCancelled && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between font-bold">
            <span className="flex items-center gap-1.5 text-rose-700">
              <XCircle className="w-4 h-4" />
              Ce reçu a été ANNULÉ le {receipt.cancelled_at?.split('T')[0] || 'N/A'}.
            </span>
            <span className="text-[11px] font-medium italic">Motif : "{receipt.cancel_reason || 'Annulation administrative'}"</span>
          </div>
        )}

        {receipt.is_idempotent_replay && !isCancelled && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center justify-between">
            <span className="font-bold">Information de réémission :</span>
            <span>Ce reçu a été réémis à la suite d'un rejeu idempotent sécurisé.</span>
          </div>
        )}

        {/* Printable Ticket Area */}
        <div id="printable-receipt" className={`p-6 bg-white border-2 rounded-2xl space-y-4 shadow-sm font-sans relative overflow-hidden ${isCancelled ? 'border-rose-300 bg-rose-50/20 text-slate-800' : 'border-slate-300 text-slate-900'}`}>
          
          {/* Cancelled Watermark Stamp */}
          {isCancelled && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-25deg] pointer-events-none opacity-20 border-4 border-rose-600 text-rose-600 font-black text-4xl px-8 py-2 rounded-2xl uppercase tracking-widest">
              ANNULÉ
            </div>
          )}

          {/* Header Ticket */}
          <div className="text-center border-b border-slate-200 pb-4 space-y-1">
            <h2 className="text-base font-black uppercase tracking-wider text-slate-900">{schoolName}</h2>
            <p className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold">
              {isCancelled ? 'REÇU DE CAISSE SCOLAIRE (ANNULÉ)' : 'REÇU DE CAISSE SCOLAIRE OFFICIEL'}
            </p>
            <div className="pt-2 flex justify-center items-center gap-2">
              <span className={`text-xs font-mono font-extrabold px-3 py-1 rounded-md border ${isCancelled ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-amber-600 bg-amber-50 border-amber-200'}`}>
                N° REÇU : {receipt.receipt_number}
              </span>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs py-2">
            <div>
              <span className="block text-[10px] text-slate-400 font-bold uppercase">N° Paiement</span>
              <strong className="font-mono text-slate-800">{receipt.payment_number}</strong>
            </div>

            <div>
              <span className="block text-[10px] text-slate-400 font-bold uppercase">N° Facture liée</span>
              <strong className="font-mono text-slate-800">{receipt.invoice_number}</strong>
            </div>

            <div>
              <span className="block text-[10px] text-slate-400 font-bold uppercase">Nom de l'Élève</span>
              <strong className="text-slate-900">{receipt.student_name}</strong>
            </div>

            <div>
              <span className="block text-[10px] text-slate-400 font-bold uppercase">Matricule Élève</span>
              <strong className="font-mono text-slate-800">{receipt.student_number}</strong>
            </div>

            {receipt.class_name && (
              <div>
                <span className="block text-[10px] text-slate-400 font-bold uppercase">Classe</span>
                <strong className="text-slate-800">{receipt.class_name}</strong>
              </div>
            )}

            <div>
              <span className="block text-[10px] text-slate-400 font-bold uppercase">Date de paiement</span>
              <strong className="text-slate-800">{receipt.payment_date}</strong>
            </div>

            <div>
              <span className="block text-[10px] text-slate-400 font-bold uppercase">Mode de Règlement</span>
              <strong className="text-slate-800">{getPaymentMethodLabel(receipt.payment_method)}</strong>
            </div>

            {receipt.recorded_by_name && (
              <div>
                <span className="block text-[10px] text-slate-400 font-bold uppercase">Agent Caissier</span>
                <strong className="text-slate-800">{receipt.recorded_by_name}</strong>
              </div>
            )}
          </div>

          {/* Amount Box */}
          <div className={`p-4 rounded-xl flex justify-between items-center ${isCancelled ? 'bg-rose-100/60 border border-rose-300 text-rose-950' : 'bg-emerald-50 border border-emerald-200 text-emerald-950'}`}>
            <div>
              <span className={`block text-[10px] font-extrabold uppercase ${isCancelled ? 'text-rose-700' : 'text-emerald-700'}`}>
                {isCancelled ? 'Montant Annulé :' : 'Montant Reçu :'}
              </span>
              <span className={`text-xl font-black ${isCancelled ? 'line-through text-rose-700' : ''}`}>
                <FormattedAmount amount={receipt.amount} currency={receipt.currency} />
              </span>
            </div>
            <div className={`flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full ${isCancelled ? 'bg-rose-200 text-rose-800' : 'bg-emerald-100 text-emerald-700'}`}>
              {isCancelled ? (
                <>
                  <XCircle className="w-4 h-4 text-rose-700" />
                  Paiement Annulé
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  Paiement Validé
                </>
              )}
            </div>
          </div>

          {/* Ticket Footer Stamp */}
          <div className="pt-4 border-t border-slate-200 flex justify-between items-end text-[10px] text-slate-400">
            <div className={`flex items-center gap-1 font-bold ${isCancelled ? 'text-rose-700' : 'text-emerald-700'}`}>
              <ShieldCheck className="w-4 h-4" />
              Document numérique certifié ÉcoleConnect
            </div>
            <div className="text-right">
              Cachet et Signature de l'Établissement
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Fermer
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            Imprimer le reçu (PDF)
          </button>
        </div>
      </div>
    </Modal>
  );
};
