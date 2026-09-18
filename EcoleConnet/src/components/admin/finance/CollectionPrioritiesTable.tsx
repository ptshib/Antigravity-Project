// Fichier : src/components/admin/finance/CollectionPrioritiesTable.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  CollectionPriorityItem,
  CollectionPrioritiesCursor,
  CollectionPrioritiesFilters,
  CollectionPriorityLevel,
  CollectionStatus,
  CollectionActionType,
  Currency
} from '../../../types/finance';
import { getSchoolCollectionPriorities, FinanceServiceError } from '../../../services/financeService';
import { RecordCollectionActionModal } from './RecordCollectionActionModal';
import { CollectionHistoryTimeline } from './CollectionHistoryTimeline';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  PhoneCall,
  History,
  ChevronRight,
  Filter,
  User,
  Calendar,
  Clock,
  Info
} from 'lucide-react';

interface CollectionPrioritiesTableProps {
  onActionSuccess?: () => void;
  refreshTrigger?: number;
}

const COLLECTION_STATUS_LABELS: Record<CollectionStatus, { label: string; style: string }> = {
  never_contacted: { label: 'Jamais relancé', style: 'bg-slate-100 text-slate-700 border-slate-200' },
  contacted: { label: 'Contacté', style: 'bg-blue-50 text-blue-700 border-blue-200' },
  promise_pending: { label: 'Promesse en cours', style: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  promise_overdue: { label: 'Promesse dépassée', style: 'bg-rose-100 text-rose-800 border-rose-200' },
  followup_due: { label: 'Relance due', style: 'bg-amber-100 text-amber-800 border-amber-200' }
};

const PRIORITY_LEVEL_BADGES: Record<CollectionPriorityLevel, { label: string; style: string; icon: React.ReactNode }> = {
  critical: {
    label: 'Critique',
    style: 'bg-rose-100 text-rose-800 border-rose-300 font-bold',
    icon: <ShieldAlert className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
  },
  high: {
    label: 'Élevée',
    style: 'bg-amber-100 text-amber-800 border-amber-300 font-semibold',
    icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
  },
  normal: {
    label: 'Normale',
    style: 'bg-slate-100 text-slate-700 border-slate-200 font-medium',
    icon: <Info className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
  }
};

const ACTION_TYPE_LABELS: Record<CollectionActionType, string> = {
  phone: 'Téléphone',
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  meeting: 'Rendez-vous',
  note: 'Note interne'
};

function formatAmount(amount: number, currency: Currency): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('fr-CD', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }
  return new Intl.NumberFormat('fr-CD', {
    style: 'currency',
    currency: 'CDF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

export const CollectionPrioritiesTable: React.FC<CollectionPrioritiesTableProps> = ({
  onActionSuccess,
  refreshTrigger = 0
}) => {
  // États de filtres
  const [currencyFilter, setCurrencyFilter] = useState<Currency | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<CollectionPriorityLevel | 'all'>('all');

  // États de données et pagination keyset
  const [items, setItems] = useState<CollectionPriorityItem[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [cursor, setCursor] = useState<CollectionPrioritiesCursor | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // États Modals (Relancer & Historique)
  const [selectedActionItem, setSelectedActionItem] = useState<CollectionPriorityItem | null>(null);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<CollectionPriorityItem | null>(null);

  // Verrous & Références synchrones (Concurrence React / StrictMode)
  const isMountedRef = useRef<boolean>(true);
  const fetchLockRef = useRef<boolean>(false);
  const loadMoreLockRef = useRef<boolean>(false);
  const reqIdRef = useRef<number>(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fonction de chargement de la première page (reset)
  const fetchFirstPage = useCallback(async () => {
    if (fetchLockRef.current) return;
    fetchLockRef.current = true;

    const currentReqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);

    const filters: CollectionPrioritiesFilters = {
      p_currency: currencyFilter === 'all' ? null : currencyFilter,
      p_priority_filter: priorityFilter === 'all' ? null : priorityFilter,
      p_limit: 20
    };

    try {
      const res = await getSchoolCollectionPriorities(filters, null);
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;

      setItems(res.items);
      setHasMore(res.has_more);
      setCursor(res.next_cursor);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;
      const msg = err instanceof FinanceServiceError ? err.message : 'Impossible de charger la liste des priorités de recouvrement.';
      setError(msg);
      setItems([]);
      setHasMore(false);
      setCursor(null);
    } finally {
      fetchLockRef.current = false;
      if (isMountedRef.current && currentReqId === reqIdRef.current) {
        setLoading(false);
      }
    }
  }, [currencyFilter, priorityFilter]);

  // Déclenchement sur changement de filtres ou trigger de rafraîchissement
  useEffect(() => {
    // Reset immédiat des items et curseur pour éviter d'afficher des éléments périmés
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setLoadMoreError(null);
    fetchFirstPage();
  }, [fetchFirstPage, refreshTrigger]);

  // Fonction Charger la suite (Page suivante keyset N+1)
  const handleLoadMore = async () => {
    if (loadMoreLockRef.current || !hasMore || !cursor || loadingMore) return;
    loadMoreLockRef.current = true;

    const currentReqId = reqIdRef.current;
    setLoadingMore(true);
    setLoadMoreError(null);

    const filters: CollectionPrioritiesFilters = {
      p_currency: currencyFilter === 'all' ? null : currencyFilter,
      p_priority_filter: priorityFilter === 'all' ? null : priorityFilter,
      p_limit: 20
    };

    try {
      const res = await getSchoolCollectionPriorities(filters, cursor);
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;

      // Déduplication stricte par invoice_id
      setItems((prevItems) => {
        const combined = [...prevItems, ...res.items];
        const uniqueMap = new Map<string, CollectionPriorityItem>();
        combined.forEach((item) => uniqueMap.set(item.invoice_id, item));
        return Array.from(uniqueMap.values());
      });

      setHasMore(res.has_more);
      setCursor(res.next_cursor);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;
      const msg = err instanceof FinanceServiceError ? err.message : 'Échec du chargement de la suite des priorités.';
      setLoadMoreError(msg);
      // Remarque : items et cursor existants sont conservés !
    } finally {
      loadMoreLockRef.current = false;
      if (isMountedRef.current && currentReqId === reqIdRef.current) {
        setLoadingMore(false);
      }
    }
  };

  const modalInvoiceForAction = selectedActionItem
    ? {
        invoice_id: selectedActionItem.invoice_id,
        invoice_number: selectedActionItem.invoice_number,
        student_name: selectedActionItem.student_name,
        remaining_balance: selectedActionItem.remaining_balance,
        currency: selectedActionItem.currency,
        due_date: selectedActionItem.invoice_due_date
      }
    : null;

  const handleActionCreatedSuccess = () => {
    setSelectedActionItem(null);
    if (onActionSuccess) {
      onActionSuccess();
    } else {
      fetchFirstPage();
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
      {/* Header & Filtres */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-indigo-600" aria-hidden="true" />
            <span>Priorités de Recouvrement</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Créances échues classées par score d'urgence dynamique (score R1 → R7).
          </p>
        </div>

        {/* Barre de filtres */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <span>Devise :</span>
            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value as Currency | 'all')}
              className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="all">Toutes</option>
              <option value="USD">USD</option>
              <option value="CDF">CDF</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <span>Priorité :</span>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as CollectionPriorityLevel | 'all')}
              className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="all">Toutes</option>
              <option value="critical">Critique</option>
              <option value="high">Élevée</option>
              <option value="normal">Normale</option>
            </select>
          </div>
        </div>
      </div>

      {/* État d'erreur initiale */}
      {error && (
        <div role="alert" className="mx-5 my-3 bg-rose-50 border border-rose-200 rounded-lg p-4 flex items-start justify-between gap-3 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong className="font-semibold text-rose-900">Erreur lors du chargement des priorités :</strong>
              <p className="text-rose-700 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchFirstPage}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white border border-rose-300 rounded-md hover:bg-rose-100 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Réessayer</span>
          </button>
        </div>
      )}

      {/* État de chargement initial */}
      {loading ? (
        <div role="status" className="p-8 text-center space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-600 mx-auto" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-600">Évaluation des priorités de recouvrement en cours...</p>
        </div>
      ) : items.length === 0 && !error ? (
        <div className="p-12 text-center text-slate-500 space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" aria-hidden="true" />
          <h4 className="font-bold text-slate-700 text-base">Aucune créance prioritaire</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Aucune facture échue ne correspond aux critères de priorité sélectionnés. Le portefeuille est à jour !
          </p>
        </div>
      ) : (
        /* Tableau principal */
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Facture</th>
                <th className="py-3 px-4">Élève & Matricule</th>
                <th className="py-3 px-4">Classe</th>
                <th className="py-3 px-4">Échéance & Retard</th>
                <th className="py-3 px-4 text-right">Reste Dû</th>
                <th className="py-3 px-4">État Recouvrement</th>
                <th className="py-3 px-4 text-center">Priorité & Score</th>
                <th className="py-3 px-4">Raisons</th>
                <th className="py-3 px-4">Dernière Action / Suivi</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {items.map((item) => {
                const priorityBadge = PRIORITY_LEVEL_BADGES[item.priority_level];
                const statusBadge = COLLECTION_STATUS_LABELS[item.collection_status];

                return (
                  <tr key={item.invoice_id} className="hover:bg-slate-50/80 transition-colors">
                    {/* Facture */}
                    <td className="py-3 px-4 font-bold text-indigo-900 whitespace-nowrap">
                      {item.invoice_number}
                      <span className="block text-[10px] font-medium text-slate-400 uppercase">
                        {item.invoice_status === 'partially_paid' ? 'Partiellement payée' : 'Émise'}
                      </span>
                    </td>

                    {/* Élève */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{item.student_name}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <User className="w-3 h-3 text-slate-400" aria-hidden="true" />
                        <span>{item.student_number}</span>
                      </div>
                    </td>

                    {/* Classe */}
                    <td className="py-3 px-4 font-medium text-slate-700 whitespace-nowrap">
                      {item.class_name || 'Non affectée'}
                    </td>

                    {/* Échéance & Retard */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1 text-slate-800 font-medium">
                        <Calendar className="w-3 h-3 text-slate-400" aria-hidden="true" />
                        <span>{item.invoice_due_date}</span>
                      </div>
                      <div className="text-[11px] font-semibold text-rose-600 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3 text-rose-500" aria-hidden="true" />
                        <span>+{item.days_overdue} jours</span>
                      </div>
                    </td>

                    {/* Reste dû */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="font-extrabold text-slate-900 text-sm">
                        {formatAmount(item.remaining_balance, item.currency)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        sur {formatAmount(item.total_amount, item.currency)}
                      </div>
                    </td>

                    {/* État Recouvrement */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${statusBadge.style}`}>
                        {statusBadge.label}
                      </span>
                    </td>

                    {/* Priorité & Score */}
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border mb-1" style={{ width: 'fit-content' }}>
                        {priorityBadge.icon}
                        <span className={priorityBadge.style.split(' ')[1]}>{priorityBadge.label}</span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 font-bold">
                        Score : {item.priority_score}
                      </div>
                    </td>

                    {/* Raisons */}
                    <td className="py-3 px-4 max-w-xs">
                      {item.priority_reasons && item.priority_reasons.length > 0 ? (
                        <div className="space-y-1">
                          {item.priority_reasons.map((reason, rIdx) => (
                            <div key={rIdx} className="text-[11px] text-slate-600 bg-slate-50 p-1 rounded border border-slate-100 flex items-start gap-1">
                              <span className="text-indigo-500 font-bold">•</span>
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">Aucune raison spécifique</span>
                      )}
                    </td>

                    {/* Dernière Action & Suivi */}
                    <td className="py-3 px-4 text-[11px]">
                      {item.latest_action_id ? (
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-800">
                            {ACTION_TYPE_LABELS[item.latest_action_type!] || item.latest_action_type}
                          </div>
                          {item.last_contacted_by_name && (
                            <div className="text-slate-500 text-[10px]">
                              Par : {item.last_contacted_by_name}
                            </div>
                          )}
                          {item.latest_promise_to_pay_date && (
                            <div className="text-blue-700 font-semibold text-[10px]">
                              Promesse : {item.latest_promise_to_pay_date}
                            </div>
                          )}
                          {item.latest_next_follow_up_date && (
                            <div className="text-amber-700 font-semibold text-[10px]">
                              Relance : {item.latest_next_follow_up_date}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Aucun contact enregistré</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedActionItem(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 transition-colors shadow-xs"
                          title="Enregistrer une relance"
                        >
                          <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Relancer</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedHistoryItem(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-400 transition-colors"
                          title="Voir l'historique de recouvrement"
                        >
                          <History className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                          <span>Historique</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Erreur sur Charger la suite */}
      {loadMoreError && (
        <div role="alert" className="mx-5 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-xs text-rose-800">
          <span>{loadMoreError}</span>
          <button
            type="button"
            onClick={handleLoadMore}
            className="font-semibold text-rose-700 hover:underline inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            <span>Réessayer</span>
          </button>
        </div>
      )}

      {/* Footer Keyset Pagination (Bouton Charger la suite) */}
      {hasMore && !loading && (
        <div className="p-4 border-t border-slate-100 text-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-500 disabled:opacity-50 transition-colors shadow-xs"
          >
            {loadingMore ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-slate-600" aria-hidden="true" />
                <span>Chargement de la suite...</span>
              </>
            ) : (
              <>
                <span>Charger la suite</span>
                <ChevronRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      )}

      {/* Modals : Enregistrer une relance (4B) & Historique (4B) */}
      <RecordCollectionActionModal
        isOpen={!!selectedActionItem}
        invoice={modalInvoiceForAction}
        onClose={() => setSelectedActionItem(null)}
        onSuccess={handleActionCreatedSuccess}
      />

      <CollectionHistoryTimeline
        isOpen={!!selectedHistoryItem}
        onClose={() => setSelectedHistoryItem(null)}
        invoiceId={selectedHistoryItem?.invoice_id || null}
        invoiceNumber={selectedHistoryItem?.invoice_number}
        studentName={selectedHistoryItem?.student_name}
      />
    </div>
  );
};
