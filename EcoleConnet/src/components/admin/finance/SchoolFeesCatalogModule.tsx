// Fichier : src/components/admin/finance/SchoolFeesCatalogModule.tsx
// Module de consultation de la grille tarifaire / catalogue des frais scolaires (Strictement en lecture seule)

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useNotifications } from '../../../context/NotificationContext';
import type { SchoolFee } from '../../../types/finance';
import { FormattedAmount } from '../../common/CurrencyBadge';
import { getFeeTypeLabel } from '../../../utils/formatters';
import { Search, Layers, Info } from 'lucide-react';

interface SchoolFeesCatalogModuleProps {
  schoolId: string;
}

export const SchoolFeesCatalogModule: React.FC<SchoolFeesCatalogModuleProps> = ({ schoolId }) => {
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState<boolean>(true);
  const [fees, setFees] = useState<SchoolFee[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const fetchFees = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('school_fees')
        .select('*')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false });

      if (error) {
        showToast(`Erreur chargement catalogue : ${error.message}`, 'urgent');
      } else if (data) {
        setFees(data as SchoolFee[]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
    } finally {
      setLoading(false);
    }
  }, [schoolId, showToast]);

  useEffect(() => {
    if (schoolId) {
      fetchFees();
    }
  }, [schoolId, fetchFees]);

  // Filtered fees
  const filteredFees = fees.filter((fee) => {
    const matchesSearch =
      fee.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (fee.code && fee.code.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCurrency = currencyFilter === 'all' || fee.currency === currencyFilter;
    const matchesType = typeFilter === 'all' || fee.fee_type === typeFilter;

    return matchesSearch && matchesCurrency && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Information Banner - Read-Only Catalog */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-900 flex items-center gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0" />
        <div>
          <strong className="font-bold block">Catalogue des frais scolaires (Mode Lecture Seule) :</strong>
          La création et la modification de la grille tarifaire seront activées après le déploiement des RPCs sécurisées d'administration du catalogue.
        </div>
      </div>

      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-3 w-full">
          {/* Search */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher un frais..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>

          {/* Devise Filter */}
          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
          >
            <option value="all">Toutes devises (USD & CDF)</option>
            <option value="USD">USD ($)</option>
            <option value="CDF">CDF (FC)</option>
          </select>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
          >
            <option value="all">Tous types de frais</option>
            <option value="minerval">Minerval / Scolarité</option>
            <option value="inscription">Inscription</option>
            <option value="frais_examen">Frais d'examen</option>
            <option value="uniforme">Uniforme</option>
            <option value="transport">Transport</option>
            <option value="cantine">Cantine</option>
            <option value="autre">Autre</option>
          </select>
        </div>
      </div>

      {/* Catalog Grid */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 text-sm">
          Chargement du catalogue des frais scolaires...
        </div>
      ) : filteredFees.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-500 space-y-2">
          <Layers className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold">Aucun frais scolaire trouvé dans le catalogue.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFees.map((fee) => (
            <div key={fee.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-extrabold text-amber-600 uppercase tracking-wider bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                    {getFeeTypeLabel(fee.fee_type)}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-1">{fee.name}</h3>
                  {fee.code && <span className="text-[11px] font-mono text-slate-400">Code: {fee.code}</span>}
                </div>

                <div className="text-right">
                  <span className="text-base font-extrabold text-slate-900 block">
                    <FormattedAmount amount={fee.amount} currency={fee.currency} />
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500 capitalize">{fee.periodicity}</span>
                </div>
              </div>

              {fee.description && (
                <p className="text-xs text-slate-600 line-clamp-2">{fee.description}</p>
              )}

              <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  Cycle: <strong className="text-slate-700 capitalize">{fee.education_cycle || 'Tous'}</strong>
                </span>

                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${fee.is_mandatory ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                  {fee.is_mandatory ? 'Obligatoire' : 'Optionnel'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
