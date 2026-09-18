// Fichier : src/components/admin/finance/RecordCollectionActionModal.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Phone, Mail, MessageSquare, Send, Users, FileText, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { createInvoiceCollectionAction, FinanceServiceError } from '../../../services/financeService';
import type { CollectionActionType, Currency } from '../../../types/finance';
import { FormattedAmount } from '../../common/CurrencyBadge';

export interface RecordCollectionActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: {
    invoice_id: string;
    invoice_number: string;
    student_name: string;
    remaining_balance: number;
    currency: Currency;
    due_date?: string;
  } | null;
  onSuccess: () => void;
  businessDate?: string;
}

const ACTION_OPTIONS: Array<{
  type: CollectionActionType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { type: 'phone', label: 'Téléphone', icon: Phone },
  { type: 'email', label: 'E-mail', icon: Mail },
  { type: 'sms', label: 'SMS', icon: MessageSquare },
  { type: 'whatsapp', label: 'WhatsApp', icon: Send },
  { type: 'meeting', label: 'Entretien', icon: Users },
  { type: 'note', label: 'Note interne', icon: FileText }
];

export const RecordCollectionActionModal: React.FC<RecordCollectionActionModalProps> = ({
  isOpen,
  onClose,
  invoice,
  onSuccess,
  businessDate
}) => {
  const [actionType, setActionType] = useState<CollectionActionType>('phone');
  const [note, setNote] = useState('');
  const [promiseToPayDate, setPromiseToPayDate] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReplay, setIsReplay] = useState(false);

  const saveLockRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Initialisation à l'ouverture du modal
  useEffect(() => {
    if (isOpen) {
      setActionType('phone');
      setNote('');
      setPromiseToPayDate('');
      setNextFollowUpDate('');
      setStatus('idle');
      setErrorMessage(null);
      setIsReplay(false);
      saveLockRef.current = false;

      // Générer une clé d'idempotence unique à l'ouverture du formulaire
      try {
        setIdempotencyKey(crypto.randomUUID());
      } catch {
        setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
      }
    }
  }, [isOpen]);

  // Fermeture par la touche Échap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && status !== 'saving') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, status, onClose]);

  if (!isOpen || !invoice) return null;

  const trimmedNote = note.trim();
  const noteLength = trimmedNote.length;
  const isNoteValid = noteLength >= 5 && noteLength <= 1000;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (saveLockRef.current || status === 'saving') return;
    saveLockRef.current = true;

    setErrorMessage(null);
    setStatus('saving');

    // Validation locale de la note
    if (!isNoteValid) {
      setErrorMessage('La note doit contenir entre 5 et 1000 caractères.');
      setStatus('error');
      saveLockRef.current = false;
      return;
    }

    // Validation des dates par rapport à businessDate (si fourni par le serveur)
    if (businessDate) {
      if (promiseToPayDate && promiseToPayDate < businessDate) {
        setErrorMessage(`La date de promesse (${promiseToPayDate}) ne peut pas être antérieure à la date de gestion de l'école (${businessDate}).`);
        setStatus('error');
        saveLockRef.current = false;
        return;
      }
      if (nextFollowUpDate && nextFollowUpDate < businessDate) {
        setErrorMessage(`La date de prochaine relance (${nextFollowUpDate}) ne peut pas être antérieure à la date de gestion de l'école (${businessDate}).`);
        setStatus('error');
        saveLockRef.current = false;
        return;
      }
    }

    try {
      const res = await createInvoiceCollectionAction({
        invoice_id: invoice.invoice_id,
        action_type: actionType,
        note: trimmedNote,
        idempotency_key: idempotencyKey,
        promise_to_pay_date: promiseToPayDate || null,
        next_follow_up_date: nextFollowUpDate || null
      });

      setIsReplay(res.is_idempotent_replay);
      setStatus('success');
      onSuccess();

      // Fermeture après un court délai ou bouton
      setTimeout(() => {
        onClose();
      }, 1200);

    } catch (err: unknown) {
      if (err instanceof FinanceServiceError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Une erreur est survenue lors de l’enregistrement de l’action de recouvrement.');
      }
      setStatus('error');
    } finally {
      saveLockRef.current = false;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-action-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Entête */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <h2 id="record-action-modal-title" className="text-lg font-bold">
              Enregistrer une action de relance
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Facture n° <span className="font-semibold text-amber-300">{invoice.invoice_number}</span> — {invoice.student_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status === 'saving'}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulaire / Contenu */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Résumé facture */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between text-sm">
            <div>
              <span className="text-xs text-slate-500 block">Reste à recouvrer</span>
              <span className="font-bold text-slate-900 text-base">
                <FormattedAmount amount={invoice.remaining_balance} currency={invoice.currency} />
              </span>
            </div>
            {invoice.due_date && (
              <div className="text-right">
                <span className="text-xs text-slate-500 block">Échéance initiale</span>
                <span className="font-medium text-slate-700">{invoice.due_date}</span>
              </div>
            )}
          </div>

          {/* Type d'action */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Canal de contact <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {ACTION_OPTIONS.map((opt) => {
                const IconComponent = opt.icon;
                const isSelected = actionType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => setActionType(opt.type)}
                    disabled={status === 'saving'}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <IconComponent className={`w-4 h-4 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Note de relance */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="collection-note-input" className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Note / Compte-rendu <span className="text-rose-500">*</span>
              </label>
              <span
                className={`text-xs font-mono ${
                  noteLength === 0
                    ? 'text-slate-400'
                    : isNoteValid
                    ? 'text-emerald-600 font-semibold'
                    : 'text-rose-600 font-semibold'
                }`}
              >
                {noteLength} / 1000 caractères
              </span>
            </div>
            <textarea
              id="collection-note-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={status === 'saving'}
              placeholder="Détails de l'échange avec le parent d'élève (ex: promesse de virement d'ici vendredi, demande de délai...)"
              rows={4}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 resize-none"
            />
            {noteLength > 0 && !isNoteValid && (
              <p className="text-xs text-rose-600 mt-1">
                La note doit comporter au moins 5 caractères (actuellement {noteLength}).
              </p>
            )}
          </div>

          {/* Dates optionnelles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <label htmlFor="promise-date-input" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Promesse de paiement (optionnelle)
              </label>
              <input
                id="promise-date-input"
                type="date"
                value={promiseToPayDate}
                onChange={(e) => setPromiseToPayDate(e.target.value)}
                disabled={status === 'saving'}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Date promise par le parent.</span>
            </div>
            <div>
              <label htmlFor="followup-date-input" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Prochaine relance (optionnelle)
              </label>
              <input
                id="followup-date-input"
                type="date"
                value={nextFollowUpDate}
                onChange={(e) => setNextFollowUpDate(e.target.value)}
                disabled={status === 'saving'}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Date prévue pour recontacter.</span>
            </div>
          </div>

          {/* Message d'erreur */}
          {errorMessage && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">Erreur d’enregistrement</span>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Message de succès */}
          {status === 'success' && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                {isReplay
                  ? 'Action déjà enregistrée précédemment (rejeu d’idempotence).'
                  : 'Action de relance enregistrée avec succès !'}
              </span>
            </div>
          )}

          {/* Actions du modal */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={status === 'saving'}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={status === 'saving' || !isNoteValid}
              aria-busy={status === 'saving'}
              className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {status === 'saving' ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Enregistrement...</span>
                </>
              ) : (
                <span>Enregistrer l’action</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
