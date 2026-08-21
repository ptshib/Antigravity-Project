// Fichier : src/components/admin/finance/CancelDraftInvoiceModal.tsx
// Modal d'annulation auditable d'une facture brouillon via RPC void_draft_student_invoice

import React, { useState, useRef, useEffect } from 'react';
import { Modal } from '../../common/Modal';
import { useNotifications } from '../../../context/NotificationContext';
import { voidDraftStudentInvoice } from '../../../services/financeService';
import type { StudentInvoice } from '../../../types/finance';
import { AlertTriangle, Ban } from 'lucide-react';

interface CancelDraftInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: StudentInvoice | null;
  onSuccess: () => void;
}

export const CancelDraftInvoiceModal: React.FC<CancelDraftInvoiceModalProps> = ({
  isOpen,
  onClose,
  invoice,
  onSuccess
}) => {
  const { showToast } = useNotifications();
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  
  const isSubmittingRef = useRef<boolean>(false);
  const hasCompletedRef = useRef<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setIsSubmitting(false);
      isSubmittingRef.current = false;
      hasCompletedRef.current = false;
    }
  }, [isOpen]);

  if (!invoice) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmittingRef.current || hasCompletedRef.current) {
      return;
    }

    const cleanReason = reason.trim();
    if (cleanReason.length < 10) {
      showToast('Le motif d’annulation doit comporter au moins 10 caractères.', 'urgent');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const { success, error } = await voidDraftStudentInvoice({
        p_invoice_id: invoice.id,
        p_cancel_reason: cleanReason
      });

      if (error) {
        showToast(`Erreur d’annulation : ${error.message}`, 'urgent');
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      } else if (success) {
        hasCompletedRef.current = true;
        showToast(`Facture brouillon ${invoice.invoice_number} annulée avec succès.`, 'success');

        try {
          onSuccess();
        } catch (refetchErr) {
          console.error('[CancelDraftInvoiceModal] Erreur rafraîchissement secondaire (non bloquante):', refetchErr);
        }

        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Annuler le Brouillon de Facture"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Confirmation d'Annulation Auditable</p>
            <p className="mt-0.5">
              La facture brouillon <strong className="font-mono">{invoice.invoice_number}</strong> ({invoice.student_name}) sera marquée comme <strong>Annulée</strong>. Cette action sera enregistrée dans le journal d'audit.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Motif obligatoire d'annulation <span className="text-rose-500">*</span> (min. 10 caractères)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="ex: Brouillon créé en double par erreur / Changement d'option élève..."
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500"
            required
            minLength={10}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Fermer
          </button>

          <button
            type="submit"
            disabled={isSubmitting || reason.trim().length < 10}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Annulation...
              </>
            ) : (
              <>
                <Ban className="w-4 h-4" />
                Confirmer l'annulation
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
