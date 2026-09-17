// Fichier : src/components/admin/finance/OverdueInvoicesTable.tsx
// Tableau de gestion administrative des créances échues avec pagination Keyset (Finance 4A)

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  Filter,
  RefreshCw,
  Clock,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  ChevronDown,
  AlertOctagon
} from 'lucide-react';
import { getSchoolOverdueInvoicesAdmin } from '../../../services/financeService';
import type {
  OverdueInvoiceItem,
  OverdueInvoicesCursor,
  OverdueInvoicesFilters,
  Currency,
  AgingBucketKey
} from '../../../types/finance';

export const OverdueInvoicesTable: React.FC = () => {
  // Filtres
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | ''>('');
  const [selectedBucket, setSelectedBucket] = useState<AgingBucketKey | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Données et pagination Keyset
  const [items, setItems] = useState<OverdueInvoiceItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<OverdueInvoicesCursor | null>(null);

  // États UI
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);

  // Ref pour requêtes concurrentes / obsolètes et verrou synchrone
  const reqIdRef = useRef(0);
  const loadMoreLockRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Debounce de la recherche (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = searchInput.trim();
      if (trimmed.length <= 100) {
        setDebouncedSearch(trimmed);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Chargement de la Première Page (Réinitialisation lors d'un changement de filtre)
  const fetchFirstPage = useCallback(async () => {
    const currentReqId = ++reqIdRef.current;
    setInitialLoading(true);
    setInitialError(null);
    setMoreError(null);

    const filters: OverdueInvoicesFilters = {
      p_currency: selectedCurrency || null,
      p_aging_bucket: selectedBucket || null,
      p_search: debouncedSearch || null,
      p_limit: 20
    };

    try {
      const response = await getSchoolOverdueInvoicesAdmin(filters, null);

      // Si le composant a été démonté ou qu'un filtre a changé, ignorer la réponse obsolète
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;

      setItems(response.items);
      setHasMore(response.has_more);
      setNextCursor(response.next_cursor);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;
      const msg = err instanceof Error ? err.message : 'Erreur lors du chargement des créances.';
      setInitialError(msg);
      setItems([]);
      setHasMore(false);
      setNextCursor(null);
    } finally {
      if (isMountedRef.current && currentReqId === reqIdRef.current) {
        setInitialLoading(false);
      }
    }
  }, [selectedCurrency, selectedBucket, debouncedSearch]);

  useEffect(() => {
    fetchFirstPage();
  }, [fetchFirstPage]);

  // Chargement des Pages Suivantes via Keyset Cursor (avec Verrou Synchrone useRef)
  const handleLoadMore = async () => {
    // Verrou synchrone immédiat avant le premier await
    if (loadMoreLockRef.current || !hasMore || !nextCursor) return;
    loadMoreLockRef.current = true;

    setLoadingMore(true);
    setMoreError(null);

    const filters: OverdueInvoicesFilters = {
      p_currency: selectedCurrency || null,
      p_aging_bucket: selectedBucket || null,
      p_search: debouncedSearch || null,
      p_limit: 20
    };

    const currentReqId = reqIdRef.current;

    try {
      const response = await getSchoolOverdueInvoicesAdmin(filters, nextCursor);

      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;

      // Fusion sans doublons sur invoice_id
      setItems((prevItems) => {
        const existingIds = new Set(prevItems.map((i) => i.invoice_id));
        const newItems = response.items.filter((i) => !existingIds.has(i.invoice_id));
        return [...prevItems, ...newItems];
      });

      setHasMore(response.has_more);
      setNextCursor(response.next_cursor);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;
      const msg = err instanceof Error ? err.message : 'Impossible de charger la suite des créances.';
      setMoreError(msg);
    } finally {
      loadMoreLockRef.current = false;
      if (isMountedRef.current && currentReqId === reqIdRef.current) {
        setLoadingMore(false);
      }
    }
  };

  const formatMoney = (amount: number, curr: Currency) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: curr,
      maximumFractionDigits: curr === 'USD' ? 2 : 0
    }).format(amount);
  };

  const getBucketBadge = (bucket: AgingBucketKey) => {
    switch (bucket) {
      case '1_30_days':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
            <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
            1–30j (Léger)
          </span>
        );
      case '31_60_days':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-900 border border-orange-300">
            <AlertCircle className="w-3 h-3 mr-1" aria-hidden="true" />
            31–60j (Modéré)
          </span>
        );
      case '61_90_days':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-900 border border-red-300">
            <AlertTriangle className="w-3 h-3 mr-1" aria-hidden="true" />
            61–90j (Important)
          </span>
        );
      case 'over_90_days':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-900 border border-purple-300">
            <ShieldAlert className="w-3 h-3 mr-1" aria-hidden="true" />
            &gt;90j (Critique)
          </span>
        );
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden space-y-4 p-6">
      {/* En-tête et Filtres Multi-critères */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-base font-extrabold text-slate-900 flex items-center">
            <AlertOctagon className="w-5 h-5 text-indigo-600 mr-2" aria-hidden="true" />
            Liste Administrative des Créances Échues
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Suivi nominatif des factures en retard avec pagination Keyset fluide
          </p>
        </div>

        {/* Barre de Filtres */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Recherche */}
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => {
                if (e.target.value.length <= 100) setSearchInput(e.target.value);
              }}
              placeholder="Recherche élève, classe..."
              maxLength={100}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
              aria-label="Rechercher par élève ou classe"
            />
          </div>

          {/* Devise */}
          <div className="relative">
            <select
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value as Currency | '')}
              className="appearance-none pl-3 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700"
              aria-label="Filtrer par devise"
            >
              <option value="">Toutes devises</option>
              <option value="USD">USD ($)</option>
              <option value="CDF">CDF (FC)</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          </div>

          {/* Tranche de Retard */}
          <div className="relative">
            <select
              value={selectedBucket}
              onChange={(e) => setSelectedBucket(e.target.value as AgingBucketKey | '')}
              className="appearance-none pl-3 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700"
              aria-label="Filtrer par tranche de retard"
            >
              <option value="">Toutes tranches</option>
              <option value="1_30_days">1–30 jours</option>
              <option value="31_60_days">31–60 jours</option>
              <option value="61_90_days">61–90 jours</option>
              <option value="over_90_days">&gt; 90 jours</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Contenu principal : État de chargement initial, Erreur ou Tableau */}
      {initialLoading ? (
        <div className="py-12 flex flex-col items-center justify-center text-slate-500">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-3" aria-hidden="true" />
          <p className="text-xs font-medium">Chargement de la liste des créances...</p>
        </div>
      ) : initialError ? (
        <div className="p-6 bg-red-50 rounded-xl border border-red-200 text-slate-800">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h4 className="font-semibold text-red-900 text-sm">Erreur de chargement</h4>
              <p className="text-xs text-red-700 mt-1">{initialError}</p>
              <button
                onClick={fetchFirstPage}
                className="mt-3 inline-flex items-center px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-md shadow-2xs transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                Réessayer
              </button>
            </div>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-slate-500">
          <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-700">Aucune créance en retard trouvée</p>
          <p className="text-xs text-slate-400 mt-1">Modifiez vos filtres de recherche ou la devise sélectionnée.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 border-collapse">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200/80 font-bold text-slate-600 uppercase tracking-wider text-[11px]">
                <th className="py-3 px-3">N° Facture</th>
                <th className="py-3 px-3">Élève</th>
                <th className="py-3 px-3">Classe</th>
                <th className="py-3 px-3">Échéance</th>
                <th className="py-3 px-3 text-center">Retard</th>
                <th className="py-3 px-3">Tranche</th>
                <th className="py-3 px-3 text-right">Total</th>
                <th className="py-3 px-3 text-right">Payé</th>
                <th className="py-3 px-3 text-right font-extrabold text-slate-900">Reste dû</th>
                <th className="py-3 px-3 text-center">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.invoice_id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-3 font-mono font-semibold text-slate-900">
                    {item.invoice_number}
                  </td>
                  <td className="py-3 px-3 font-medium text-slate-900">
                    {item.student_name || 'Élève non renseigné'}
                  </td>
                  <td className="py-3 px-3 text-slate-600">
                    {item.class_name || '-'}
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-600">
                    {item.due_date}
                  </td>
                  <td className="py-3 px-3 text-center font-extrabold text-red-600">
                    +{item.days_overdue}j
                  </td>
                  <td className="py-3 px-3">
                    {getBucketBadge(item.aging_bucket)}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-slate-600">
                    {formatMoney(item.total_amount, item.currency)}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-emerald-700">
                    {formatMoney(item.paid_amount, item.currency)}
                  </td>
                  <td className="py-3 px-3 text-right font-extrabold text-red-700 text-sm">
                    {formatMoney(item.remaining_balance, item.currency)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.status === 'partially_paid'
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-red-100 text-red-900 border border-red-300'
                      }`}
                    >
                      {item.status === 'partially_paid' ? 'Partiel' : 'Émise'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Erreur de chargement de la suite (Inline Banner sans effacer les items déjà chargés) */}
      {moreError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
            <span>{moreError}</span>
          </div>
          <button
            onClick={handleLoadMore}
            className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-semibold rounded text-[11px] transition-colors"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Pied de tableau / Bouton Charger la suite (Pagination Keyset Cursor) */}
      {hasMore && !initialLoading && (
        <div className="pt-2 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-bold rounded-xl transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            aria-label="Charger les créances suivantes"
          >
            {loadingMore ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Chargement de la suite...
              </>
            ) : (
              <>
                Charger la suite ({items.length} affichées)
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
