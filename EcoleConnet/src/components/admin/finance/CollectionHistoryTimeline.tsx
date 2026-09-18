// Fichier : src/components/admin/finance/CollectionHistoryTimeline.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, Mail, MessageSquare, Send, Users, FileText, Calendar, Clock, AlertCircle, RefreshCw, X, History } from 'lucide-react';
import { getInvoiceCollectionHistory, FinanceServiceError } from '../../../services/financeService';
import type { CollectionHistoryAction, CollectionActionType } from '../../../types/finance';

export interface CollectionHistoryTimelineProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string | null;
  invoiceNumber?: string;
  studentName?: string;
}

const ACTION_CONFIG: Record<CollectionActionType, { label: string; bgClass: string; textClass: string; icon: React.ComponentType<{ className?: string }> }> = {
  phone: { label: 'Appel téléphonique', bgClass: 'bg-blue-50 border-blue-200', textClass: 'text-blue-700', icon: Phone },
  email: { label: 'E-mail envoyé', bgClass: 'bg-indigo-50 border-indigo-200', textClass: 'text-indigo-700', icon: Mail },
  sms: { label: 'SMS envoyé', bgClass: 'bg-purple-50 border-purple-200', textClass: 'text-purple-700', icon: MessageSquare },
  whatsapp: { label: 'Message WhatsApp', bgClass: 'bg-emerald-50 border-emerald-200', textClass: 'text-emerald-700', icon: Send },
  meeting: { label: 'Entretien physique', bgClass: 'bg-amber-50 border-amber-200', textClass: 'text-amber-700', icon: Users },
  note: { label: 'Note interne', bgClass: 'bg-slate-100 border-slate-200', textClass: 'text-slate-700', icon: FileText }
};

export const CollectionHistoryTimeline: React.FC<CollectionHistoryTimelineProps> = ({
  isOpen,
  onClose,
  invoiceId,
  invoiceNumber,
  studentName
}) => {
  const [actions, setActions] = useState<CollectionHistoryAction[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const reqIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!invoiceId) return;

    const currentReqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const data = await getInvoiceCollectionHistory(invoiceId);
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;

      setActions(data.actions);
      setTotalCount(data.total_actions_count);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;
      if (err instanceof FinanceServiceError) {
        setError(err.message);
      } else {
        setError('Impossible de charger l’historique des relances.');
      }
    } finally {
      if (isMountedRef.current && currentReqId === reqIdRef.current) {
        setLoading(false);
      }
    }
  }, [invoiceId]);

  useEffect(() => {
    if (isOpen && invoiceId) {
      fetchHistory();
    } else {
      setActions([]);
      setTotalCount(0);
      setError(null);
    }
  }, [isOpen, invoiceId, fetchHistory]);

  // Fermeture Échap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !invoiceId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collection-history-title"
    >
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Entête */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-800 rounded-xl">
              <History className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 id="collection-history-title" className="text-base font-bold">
                Historique du recouvrement
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Facture n° <span className="font-semibold text-amber-300">{invoiceNumber || 'Inconnue'}</span>
                {studentName && ` — ${studentName}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps principal */}
        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-500 text-xs">
              <div className="w-8 h-8 border-3 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin mb-3" />
              <span>Chargement de l’historique...</span>
            </div>
          ) : error ? (
            <div role="alert" className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-center space-y-3">
              <AlertCircle className="w-6 h-6 text-rose-600 mx-auto" />
              <p className="text-xs font-medium text-rose-800">{error}</p>
              <button
                type="button"
                onClick={fetchHistory}
                className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-100 hover:bg-rose-200 rounded-lg transition-colors inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Réessayer</span>
              </button>
            </div>
          ) : actions.length === 0 ? (
            <div className="py-12 text-center text-slate-500 space-y-2">
              <FileText className="w-10 h-10 text-slate-300 mx-auto stroke-1" />
              <p className="text-sm font-medium text-slate-700">Aucune action enregistrée</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Aucune relance administrative ou note de suivi n’a encore été consignée pour cette facture.
              </p>
            </div>
          ) : (
            <div className="space-y-6 relative before:absolute before:inset-0 before:left-5 before:w-0.5 before:bg-slate-200">
              <div className="text-xs font-semibold text-slate-500 mb-2">
                {totalCount} action{totalCount > 1 ? 's' : ''} enregistrée{totalCount > 1 ? 's' : ''}
              </div>
              {actions.map((act) => {
                const config = ACTION_CONFIG[act.action_type] || ACTION_CONFIG.note;
                const IconComp = config.icon;
                const dateFormatted = new Date(act.contacted_at).toLocaleString('fr-FR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });

                return (
                  <div key={act.id} className="relative pl-10">
                    {/* Puce timeline */}
                    <div className={`absolute left-2.5 top-0 -translate-x-1/2 p-1.5 rounded-full border ${config.bgClass} shadow-sm z-10`}>
                      <IconComp className={`w-3.5 h-3.5 ${config.textClass}`} />
                    </div>

                    {/* Carte d'action */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold border ${config.bgClass} ${config.textClass}`}>
                          {config.label}
                        </span>
                        <span className="text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {dateFormatted}
                        </span>
                      </div>

                      <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed font-normal bg-white p-2.5 rounded-lg border border-slate-200/80">
                        {act.note}
                      </p>

                      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/60 gap-2">
                        <span className="font-medium text-slate-700">
                          Auteur : {act.created_by_name || 'Agent Finance'}
                        </span>

                        <div className="flex items-center gap-3">
                          {act.promise_to_pay_date && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium border border-emerald-200">
                              <Calendar className="w-3 h-3" />
                              Promesse : {act.promise_to_pay_date}
                            </span>
                          )}
                          {act.next_follow_up_date && (
                            <span className="inline-flex items-center gap-1 text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded font-medium border border-indigo-200">
                              <Calendar className="w-3 h-3" />
                              Prochain suivi : {act.next_follow_up_date}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pied */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
