// Fichier : src/components/admin/finance/CollectionFollowupsTable.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, AlertCircle, PhoneCall, History, ChevronRight } from 'lucide-react';
import { getSchoolCollectionFollowups, FinanceServiceError } from '../../../services/financeService';
import type {
  CollectionFollowupItem,
  CollectionFollowupsCursor,
  CollectionStatus,
  Currency,
  CollectionActionType
} from '../../../types/finance';
import { FormattedAmount } from '../../common/CurrencyBadge';

export interface CollectionFollowupsTableProps {
  onRecordAction: (item: CollectionFollowupItem) => void;
  onViewHistory: (item: CollectionFollowupItem) => void;
  refreshTrigger?: number;
}

const STATUS_CONFIG: Record<CollectionStatus, { label: string; badgeClass: string }> = {
  never_contacted: { label: 'Jamais relancée', badgeClass: 'bg-slate-100 text-slate-700 border-slate-300' },
  contacted: { label: 'Relancée', badgeClass: 'bg-blue-50 text-blue-800 border-blue-200' },
  promise_pending: { label: 'Promesse en cours', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  promise_overdue: { label: 'Promesse dépassée', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200 font-bold' },
  followup_due: { label: 'À relancer', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' }
};

const ACTION_TYPE_LABELS: Record<CollectionActionType, string> = {
  phone: 'Téléphone',
  email: 'E-mail',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  meeting: 'Entretien',
  note: 'Note'
};

export const CollectionFollowupsTable: React.FC<CollectionFollowupsTableProps> = ({
  onRecordAction,
  onViewHistory,
  refreshTrigger = 0
}) => {
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | Currency>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CollectionStatus>('ALL');

  const [items, setItems] = useState<CollectionFollowupItem[]>([]);
  const [cursor, setCursor] = useState<CollectionFollowupsCursor | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const loadLockRef = useRef(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Chargement initial ou changement de filtres
  const fetchInitialData = useCallback(async () => {
    const currentReqId = ++reqIdRef.current;
    loadLockRef.current = true;

    setLoadingInitial(true);
    setError(null);

    try {
      const res = await getSchoolCollectionFollowups(
        {
          currency: currencyFilter,
          status_filter: statusFilter,
          limit: 20
        },
        null
      );

      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;

      setItems(res.items);
      setHasMore(res.has_more);
      setCursor(res.next_cursor);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;
      if (err instanceof FinanceServiceError) {
        setError(err.message);
      } else {
        setError('Impossible de charger le tableau de suivi du recouvrement.');
      }
      setItems([]);
      setHasMore(false);
      setCursor(null);
    } finally {
      if (isMountedRef.current && currentReqId === reqIdRef.current) {
        setLoadingInitial(false);
        loadLockRef.current = false;
      }
    }
  }, [currencyFilter, statusFilter]);

  // Déclenchement au chargement, filtre ou rafraîchissement
  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData, refreshTrigger]);

  // Chargement de la page suivante
  const handleLoadMore = async () => {
    if (loadLockRef.current || !hasMore || !cursor || loadingMore) return;
    loadLockRef.current = true;

    const currentReqId = ++reqIdRef.current;
    setLoadingMore(true);

    try {
      const res = await getSchoolCollectionFollowups(
        {
          currency: currencyFilter,
          status_filter: statusFilter,
          limit: 20
        },
        cursor
      );

      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;

      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.invoice_id));
        const newItems = res.items.filter((i) => !existingIds.has(i.invoice_id));
        return [...prev, ...newItems];
      });

      setHasMore(res.has_more);
      setCursor(res.next_cursor);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;
      if (err instanceof FinanceServiceError) {
        setError(err.message);
      }
      // On conserve les items et le curseur existants pour permettre un retry
    } finally {
      if (isMountedRef.current && currentReqId === reqIdRef.current) {
        setLoadingMore(false);
        loadLockRef.current = false;
      }
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Barre de titre et filtres */}
      <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-50/50">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <PhoneCall className="w-5 h-5 text-indigo-600" />
            <span>Suivi du recouvrement</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Gestion des relances administratives, promesses de paiement et agendas de suivi
          </p>
        </div>

        {/* Filtres */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Filtre Devise */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-medium">Devise :</span>
            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value as 'ALL' | Currency)}
              disabled={loadingInitial}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              <option value="ALL">Toutes</option>
              <option value="USD">USD ($)</option>
              <option value="CDF">CDF (FC)</option>
            </select>
          </div>

          {/* Filtre État de relance */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-medium">Statut :</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | CollectionStatus)}
              disabled={loadingInitial}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              <option value="ALL">Tous les états</option>
              <option value="never_contacted">Jamais relancée</option>
              <option value="contacted">Relancée</option>
              <option value="promise_pending">Promesse en cours</option>
              <option value="promise_overdue">Promesse dépassée</option>
              <option value="followup_due">À relancer</option>
            </select>
          </div>

          {/* Bouton Rafraîchir */}
          <button
            type="button"
            onClick={fetchInitialData}
            disabled={loadingInitial}
            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-white border border-transparent hover:border-slate-300 rounded-xl transition-all disabled:opacity-50"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${loadingInitial ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Message d'erreur */}
      {error && (
        <div role="alert" className="m-4 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-xs text-rose-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchInitialData}
            className="px-3 py-1 font-semibold text-rose-700 bg-rose-100 hover:bg-rose-200 rounded-lg transition-colors"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Tableau des relances */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-100/70 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
              <th className="py-3 px-4">Facture</th>
              <th className="py-3 px-4">Élève & Matricule</th>
              <th className="py-3 px-4">Classe</th>
              <th className="py-3 px-4">Échéance</th>
              <th className="py-3 px-4 text-right">Retard</th>
              <th className="py-3 px-4 text-right">Reste dû</th>
              <th className="py-3 px-4">Statut Relance</th>
              <th className="py-3 px-4">Dernière action</th>
              <th className="py-3 px-4">Promesse / Suivi</th>
              <th className="py-3 px-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {loadingInitial ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-slate-500">
                  <div className="w-6 h-6 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin mx-auto mb-2" />
                  <span>Chargement du suivi de recouvrement...</span>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-slate-500">
                  <p className="font-medium text-slate-700">Aucune facture en suivi de recouvrement</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Toutes les factures sont à jour ou aucun résultat ne correspond aux filtres appliqués.
                  </p>
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const statusConf = STATUS_CONFIG[item.collection_status] || STATUS_CONFIG.never_contacted;
                return (
                  <tr key={item.invoice_id} className="hover:bg-slate-50/80 transition-colors">
                    {/* N° Facture */}
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {item.invoice_number}
                    </td>

                    {/* Élève */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{item.student_name}</div>
                      {item.student_number && (
                        <div className="text-[10px] font-mono text-slate-500">{item.student_number}</div>
                      )}
                    </td>

                    {/* Classe */}
                    <td className="py-3 px-4 text-slate-700 font-medium">
                      {item.class_name || '—'}
                    </td>

                    {/* Échéance */}
                    <td className="py-3 px-4 text-slate-600">
                      {item.invoice_due_date}
                    </td>

                    {/* Retard */}
                    <td className="py-3 px-4 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                        item.days_overdue > 60
                          ? 'bg-rose-100 text-rose-800'
                          : item.days_overdue > 30
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        +{item.days_overdue} j
                      </span>
                    </td>

                    {/* Reste dû */}
                    <td className="py-3 px-4 text-right font-bold text-slate-900">
                      <FormattedAmount amount={item.remaining_balance} currency={item.currency} />
                    </td>

                    {/* Statut de relance */}
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] border ${statusConf.badgeClass}`}>
                        {statusConf.label}
                      </span>
                    </td>

                    {/* Dernière action */}
                    <td className="py-3 px-4 text-slate-600">
                      {item.latest_action_type ? (
                        <div>
                          <span className="font-semibold text-slate-800">
                            {ACTION_TYPE_LABELS[item.latest_action_type] || item.latest_action_type}
                          </span>
                          {item.latest_contacted_at && (
                            <span className="text-[10px] text-slate-400 block">
                              {new Date(item.latest_contacted_at).toLocaleDateString('fr-FR')}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Aucune</span>
                      )}
                    </td>

                    {/* Promesse / Prochaine relance */}
                    <td className="py-3 px-4">
                      {item.latest_promise_to_pay_date ? (
                        <div className="text-emerald-700 font-semibold text-[11px]">
                          Promesse : {item.latest_promise_to_pay_date}
                        </div>
                      ) : item.latest_next_follow_up_date ? (
                        <div className="text-indigo-700 font-medium text-[11px]">
                          Suivi : {item.latest_next_follow_up_date}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">—</span>
                      )}
                    </td>

                    {/* Boutons d'actions */}
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onRecordAction(item)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors flex items-center gap-1 border border-indigo-200"
                          title="Relancer / Enregistrer une action"
                        >
                          <PhoneCall className="w-3 h-3" />
                          <span>Relancer</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onViewHistory(item)}
                          className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1 border border-slate-200"
                          title="Voir l'historique"
                        >
                          <History className="w-3 h-3" />
                          <span>Historique</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Keyset */}
      {hasMore && (
        <div className="p-4 bg-slate-50/50 border-t border-slate-200 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="px-5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {loadingMore ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
                <span>Chargement de la suite...</span>
              </>
            ) : (
              <>
                <span>Charger la suite</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
