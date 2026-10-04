// Fichier : src/components/admin/finance/SchoolCashRegisterModule.tsx
// Module de gestion du Journal de Caisse & Encaissements V2 (Lot 2K-FIN-CASH-F-V2)

import React, { useState, useEffect, useCallback } from 'react';
import {
  getSchoolCashRegisterJournal,
  fetchSchoolClasses,
  fetchSchoolAuthorizedCashiers
} from '../../../services/financeService';
import type {
  CashRegisterJournalResponse,
  CashRegisterJournalFilters,
  CashJournalEntry,
  SchoolClassOption,
  AuthorizedCashierOption
} from '../../../types/cashRegister';
import { FormattedAmount } from '../../common/CurrencyBadge';
import { PaymentReceiptModal } from './PaymentReceiptModal';
import type { PaymentReceiptData } from './PaymentReceiptModal';
import {
  Wallet,
  Calendar,
  Search,
  RefreshCw,
  XCircle,
  DollarSign,
  Info,
  ChevronLeft,
  ChevronRight,
  Layers,
  Users,
  Receipt,
  ArrowDownRight,
  ArrowUpRight
} from 'lucide-react';
import type { FinanceSubTab } from '../../../utils/portalRouting';

interface SchoolCashRegisterModuleProps {
  schoolId: string;
  activeSubTab: FinanceSubTab;
  onSelectSubTab: (subTab: FinanceSubTab) => void;
}

type TimePreset = 'today' | 'week' | 'month' | 'custom';

export const SchoolCashRegisterModule: React.FC<SchoolCashRegisterModuleProps> = ({
  schoolId,
  activeSubTab,
  onSelectSubTab
}) => {
  // Preset time ranges
  const [timePreset, setTimePreset] = useState<TimePreset>('today');
  const [customStartDate, setCustomStartDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [customEndDate, setCustomEndDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Filter dropdown data loaded under RLS
  const [classList, setClassList] = useState<SchoolClassOption[]>([]);
  const [cashierList, setCashierList] = useState<AuthorizedCashierOption[]>([]);

  // Filters state (stored as non-sensitive UI indices/keys to guarantee 0 UUIDs in DOM)
  const [selectedFeeType, setSelectedFeeType] = useState<string>('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [selectedClassIndex, setSelectedClassIndex] = useState<string>('');
  const [selectedCashierIndex, setSelectedCashierIndex] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  // Data & UI states
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CashRegisterJournalResponse | null>(null);

  // Receipt Modal
  const [activeReceipt, setActiveReceipt] = useState<PaymentReceiptData | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState<boolean>(false);

  // Load active classes and authorized cashiers under RLS
  useEffect(() => {
    let isMounted = true;
    if (schoolId) {
      fetchSchoolClasses(schoolId).then((res) => {
        if (isMounted) setClassList(res);
      });
      fetchSchoolAuthorizedCashiers(schoolId).then((res) => {
        if (isMounted) setCashierList(res);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [schoolId]);

  // Calculate dates based on time preset
  const getDateRange = useCallback((): { start: string; end: string } => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (timePreset === 'today') {
      return { start: todayStr, end: todayStr };
    }
    if (timePreset === 'week') {
      const firstDay = new Date(today);
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Monday
      firstDay.setDate(diff);
      return { start: firstDay.toISOString().split('T')[0], end: todayStr };
    }
    if (timePreset === 'month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: firstDay.toISOString().split('T')[0], end: todayStr };
    }
    return { start: customStartDate, end: customEndDate };
  }, [timePreset, customStartDate, customEndDate]);

  // Main data fetch
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { start, end } = getDateRange();

    let effectiveEventType: string | null = selectedEventType || null;
    if (activeSubTab === 'caisse_cancellations') {
      effectiveEventType = 'cancellation';
    }

    // Translate UI indices to UUID in memory before calling RPC
    let effectiveClassId: string | null = null;
    if (selectedClassIndex.startsWith('cls_')) {
      const idx = parseInt(selectedClassIndex.replace('cls_', ''), 10);
      effectiveClassId = classList[idx]?.id || null;
    }

    let effectiveRecordedBy: string | null = null;
    if (selectedCashierIndex.startsWith('csh_')) {
      const idx = parseInt(selectedCashierIndex.replace('csh_', ''), 10);
      effectiveRecordedBy = cashierList[idx]?.id || null;
    }

    const filters: CashRegisterJournalFilters = {
      startDate: start,
      endDate: end,
      page: currentPage,
      pageSize,
      feeType: selectedFeeType || null,
      paymentMethod: selectedPaymentMethod || null,
      eventType: effectiveEventType,
      recordedBy: effectiveRecordedBy,
      classId: effectiveClassId,
      searchQuery: searchQuery ? searchQuery.trim() : null
    };

    try {
      const response = await getSchoolCashRegisterJournal(filters);
      setData(response);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Impossible de charger le journal de caisse.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [
    getDateRange,
    currentPage,
    pageSize,
    selectedFeeType,
    selectedPaymentMethod,
    selectedEventType,
    selectedClassIndex,
    selectedCashierIndex,
    classList,
    cashierList,
    searchQuery,
    activeSubTab
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset pagination to page 1 whenever any filter changes
  const handleFilterChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    setCurrentPage(1);
  };

  const handlePresetChange = (preset: TimePreset) => {
    setTimePreset(preset);
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setTimePreset('today');
    const todayStr = new Date().toISOString().split('T')[0];
    setCustomStartDate(todayStr);
    setCustomEndDate(todayStr);
    setSelectedFeeType('');
    setSelectedPaymentMethod('');
    setSelectedEventType('');
    setSelectedClassIndex('');
    setSelectedCashierIndex('');
    setSearchQuery('');
    setCurrentPage(1);
  };

  // Open receipt modal if receipt number exists
  const handleOpenReceipt = (entry: CashJournalEntry) => {
    if (!entry.receipt_number) return;

    setActiveReceipt({
      receipt_number: entry.receipt_number,
      payment_number: entry.payment_number,
      invoice_number: entry.invoice_number,
      student_name: entry.student_name,
      student_number: entry.student_matricule,
      class_name: entry.class_name,
      amount: Math.abs(entry.amount),
      currency: entry.currency,
      payment_date: entry.event_date,
      payment_method: entry.payment_method as any,
      recorded_by_name: entry.cashier_name,
      is_cancelled: entry.receipt_is_cancelled,
      cancelled_at: entry.receipt_is_cancelled ? entry.event_date : undefined,
      cancel_reason: entry.cancellation_reason || undefined
    });
    setShowReceiptModal(true);
  };

  const usdSummary = data?.summary.USD;
  const cdfSummary = data?.summary.CDF;

  return (
    <div className="space-y-6" data-testid="school-cash-register-module">
      {/* Module Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Journal de Caisse & Encaissements</h2>
              <p className="text-xs text-slate-500">
                Suivi événementiel et réconciliation au prorata (USD & CDF)
              </p>
            </div>
          </div>

          {/* Sub-Tabs Nav */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => onSelectSubTab('caisse_overview')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                activeSubTab === 'caisse_overview'
                  ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Vue d'ensemble
            </button>
            <button
              type="button"
              onClick={() => onSelectSubTab('caisse_journal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                activeSubTab === 'caisse_journal'
                  ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Encaissements
            </button>
            <button
              type="button"
              onClick={() => onSelectSubTab('caisse_categories')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                activeSubTab === 'caisse_categories'
                  ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Catégories
            </button>
            <button
              type="button"
              onClick={() => onSelectSubTab('caisse_classes')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                activeSubTab === 'caisse_classes'
                  ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Classes
            </button>
            <button
              type="button"
              onClick={() => onSelectSubTab('caisse_cancellations')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                activeSubTab === 'caisse_cancellations'
                  ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Annulations
            </button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          {/* Time Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1 mr-2">
              <Calendar className="w-3.5 h-3.5" /> Période :
            </span>
            {(['today', 'week', 'month', 'custom'] as TimePreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handlePresetChange(preset)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  timePreset === preset
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {preset === 'today' && "Aujourd'hui"}
                {preset === 'week' && 'Cette semaine'}
                {preset === 'month' && 'Ce mois'}
                {preset === 'custom' && 'Personnalisé'}
              </button>
            ))}

            {timePreset === 'custom' && (
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => {
                    setCustomStartDate(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
                <span className="text-xs text-slate-400">à</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => {
                    setCustomEndDate(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}
          </div>

          {/* Secondary Dropdown Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 pt-2">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Recherche élève, PAY, REC..."
                value={searchQuery}
                onChange={(e) => handleFilterChange(setSearchQuery, e.target.value)}
                maxLength={100}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Class Filter (non-sensitive indices, 0 UUID in DOM) */}
            <select
              aria-label="Sélectionner la classe"
              value={selectedClassIndex}
              onChange={(e) => handleFilterChange(setSelectedClassIndex, e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Toutes les classes</option>
              {classList.map((cls, idx) => (
                <option key={`cls_${idx}`} value={`cls_${idx}`}>
                  {cls.name}
                </option>
              ))}
            </select>

            {/* Cashier Filter (non-sensitive indices, 0 UUID in DOM) */}
            <select
              aria-label="Sélectionner l'agent caissier"
              value={selectedCashierIndex}
              onChange={(e) => handleFilterChange(setSelectedCashierIndex, e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Tous les caissiers</option>
              {cashierList.map((cashier, idx) => (
                <option key={`csh_${idx}`} value={`csh_${idx}`}>
                  {cashier.first_name} {cashier.last_name}
                </option>
              ))}
            </select>

            {/* Fee Type */}
            <select
              value={selectedFeeType}
              onChange={(e) => handleFilterChange(setSelectedFeeType, e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Toutes les catégories</option>
              <option value="minerval">Minerval</option>
              <option value="inscription">Inscription</option>
              <option value="transport">Transport</option>
              <option value="cantine">Cantine</option>
              <option value="uniforme">Uniforme</option>
              <option value="activites">Activités</option>
              <option value="frais_etat">Frais d'État</option>
              <option value="autre">Autre</option>
            </select>

            {/* Payment Method */}
            <select
              value={selectedPaymentMethod}
              onChange={(e) => handleFilterChange(setSelectedPaymentMethod, e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Tous les modes</option>
              <option value="cash">Espèces (Cash)</option>
              <option value="bank_transfer">Virement bancaire</option>
              <option value="bank_deposit">Dépôt bancaire</option>
              <option value="check">Chèque</option>
              <option value="mobile_money_manual">Mobile Money</option>
              <option value="other">Autre</option>
            </select>

            {/* Event Type (disabled in Annulations tab) */}
            <select
              value={activeSubTab === 'caisse_cancellations' ? 'cancellation' : selectedEventType}
              disabled={activeSubTab === 'caisse_cancellations'}
              onChange={(e) => handleFilterChange(setSelectedEventType, e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100"
            >
              <option value="">Tous les événements</option>
              <option value="collection">Perception (Encaissement)</option>
              <option value="cancellation">Annulation comptable</option>
            </select>
          </div>

          {/* Reset Row */}
          <div className="flex justify-end items-center pt-1">
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Réinitialiser
            </button>
          </div>
        </div>
      </div>

      {/* Prominent Notice Card */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-amber-900 text-xs">
        <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-extrabold block mb-0.5">Note d'Information de Caisse :</span>
          Le net cash représente uniquement les encaissements scolaires en espèces après annulations comptables. Il ne constitue pas le solde physique complet du coffre.
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3 shadow-xs">
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-sm font-bold text-slate-600">Chargement du journal de caisse...</p>
        </div>
      )}

      {/* Error State with Sanitized Error */}
      {error && !loading && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center space-y-3">
          <XCircle className="w-10 h-10 text-rose-600 mx-auto" />
          <h3 className="text-sm font-extrabold text-rose-900">Erreur lors de la récupération des données</h3>
          <p className="text-xs text-rose-700">{error}</p>
          <button
            type="button"
            onClick={fetchData}
            className="px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Loaded Content */}
      {!loading && !error && data && (
        <>
          {/* TAB 1: VUE D'ENSEMBLE */}
          {activeSubTab === 'caisse_overview' && (
            <div className="space-y-6">
              {/* USD Summary Section */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                    Synthèse des Encaissements en Dollars Américains (USD)
                  </h3>
                  <span className="text-xs font-mono bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-bold">
                    {usdSummary?.collections_count || 0} perception(s) · {usdSummary?.cancellations_count || 0} annulation(s)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-1">
                    <span className="text-xs text-slate-500 font-bold block">Encaissements Bruts</span>
                    <span className="text-lg font-extrabold text-slate-900 block">
                      <FormattedAmount amount={usdSummary?.gross_collected || 0} currency="USD" />
                    </span>
                    <span className="text-[11px] text-slate-500">Toutes perceptions en période</span>
                  </div>

                  <div className="bg-rose-50/60 p-4 rounded-xl border border-rose-100 space-y-1">
                    <span className="text-xs text-rose-700 font-bold block">Annulations Comptables</span>
                    <span className="text-lg font-extrabold text-rose-700 block">
                      <FormattedAmount amount={usdSummary?.cancellations_amount || 0} currency="USD" />
                    </span>
                    <span className="text-[11px] text-rose-600 font-semibold">
                      {usdSummary?.cancellations_count || 0} annulation(s)
                    </span>
                  </div>

                  <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-100 space-y-1">
                    <span className="text-xs text-emerald-800 font-bold block">Encaissements Nets</span>
                    <span className="text-lg font-extrabold text-emerald-700 block">
                      <FormattedAmount amount={usdSummary?.net_event_amount || 0} currency="USD" />
                    </span>
                    <span className="text-[11px] text-emerald-600 font-semibold">Bruts - Annulations</span>
                  </div>

                  <div className="bg-blue-50/60 p-4 rounded-xl border border-blue-100 space-y-1">
                    <span className="text-xs text-blue-800 font-bold block">Net Cash Espèces</span>
                    <span className="text-lg font-extrabold text-blue-700 block">
                      <FormattedAmount amount={usdSummary?.cash_net_event || 0} currency="USD" />
                    </span>
                    <span className="text-[11px] text-blue-600 font-semibold">Espèces après annulations</span>
                  </div>
                </div>

                {/* USD Breakdown by Payment Method */}
                <div className="pt-2">
                  <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                    Ventilation par mode de paiement (USD)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                    {Object.entries(usdSummary?.by_payment_method || {}).map(([method, mData]) => (
                      <div key={method} className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                        <span className="font-bold text-slate-700 capitalize block truncate">
                          {method.replace(/_/g, ' ')}
                        </span>
                        <span className="font-extrabold text-slate-900 block mt-1">
                          <FormattedAmount amount={mData.net} currency="USD" />
                        </span>
                        <span className="text-[10px] text-slate-500 mt-0.5 block">
                          {mData.collections_count} col. / {mData.cancellations_count} can.
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* CDF Summary Section */}
              <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-xl space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-extrabold text-amber-400 flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-amber-400" />
                    Synthèse des Encaissements en Francs Congolais (CDF)
                  </h3>
                  <span className="text-xs font-mono bg-slate-800 text-amber-400 px-2.5 py-1 rounded-full font-bold">
                    {cdfSummary?.collections_count || 0} perception(s) · {cdfSummary?.cancellations_count || 0} annulation(s)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-slate-200">
                  <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                    <span className="text-xs text-slate-400 font-bold block">Encaissements Bruts CDF</span>
                    <span className="text-lg font-extrabold text-white block">
                      <FormattedAmount amount={cdfSummary?.gross_collected || 0} currency="CDF" />
                    </span>
                  </div>

                  <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                    <span className="text-xs text-slate-400 font-bold block">Annulations Comptables CDF</span>
                    <span className="text-lg font-extrabold text-rose-400 block">
                      <FormattedAmount amount={cdfSummary?.cancellations_amount || 0} currency="CDF" />
                    </span>
                  </div>

                  <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                    <span className="text-xs text-slate-400 font-bold block">Encaissements Nets CDF</span>
                    <span className="text-lg font-extrabold text-emerald-400 block">
                      <FormattedAmount amount={cdfSummary?.net_event_amount || 0} currency="CDF" />
                    </span>
                  </div>

                  <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                    <span className="text-xs text-slate-400 font-bold block">Net Cash Espèces CDF</span>
                    <span className="text-lg font-extrabold text-amber-400 block">
                      <FormattedAmount amount={cdfSummary?.cash_net_event || 0} currency="CDF" />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2 & TAB 5: ENCAISSEMENTS & ANNULATIONS (JOURNAL TABLE) */}
          {(activeSubTab === 'caisse_journal' || activeSubTab === 'caisse_cancellations') && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-sm font-extrabold text-slate-900">
                  {activeSubTab === 'caisse_cancellations' ? 'Journal des Annulations Comptables' : 'Journal Événementiel des Encaissements'}
                </h3>
                <span className="text-xs text-slate-500 font-bold font-mono">
                  {data.pagination.total_records} événement(s)
                </span>
              </div>

              {data.journal_entries.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Receipt className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="text-sm font-bold text-slate-600">Aucun événement trouvé pour la période et les filtres sélectionnés.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-extrabold border-b border-slate-200">
                      <tr>
                        <th className="p-3">Date</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Numéro PAY</th>
                        <th className="p-3">Numéro REC</th>
                        <th className="p-3">Facture</th>
                        <th className="p-3">Élève / Classe</th>
                        <th className="p-3">Mode</th>
                        <th className="p-3">Caissier</th>
                        <th className="p-3 text-right">Montant Événement</th>
                        <th className="p-3">Ventilation Prorata</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {data.journal_entries.map((entry, idx) => {
                        const isCancel = entry.event_type === 'cancellation';
                        return (
                          <tr key={`${entry.payment_number}_${entry.event_type}_${idx}`} className="hover:bg-slate-50/80 transition">
                            <td className="p-3 font-mono whitespace-nowrap">{entry.event_date}</td>
                            <td className="p-3 whitespace-nowrap">
                              {isCancel ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                                  <ArrowDownRight className="w-3 h-3" /> Annulation comptable
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                  <ArrowUpRight className="w-3 h-3" /> Perception
                                </span>
                              )}
                            </td>
                            <td className="p-3 font-mono font-bold text-slate-900 whitespace-nowrap">{entry.payment_number}</td>
                            <td className="p-3 font-mono whitespace-nowrap">
                              {entry.receipt_number ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenReceipt(entry)}
                                  className={`font-bold hover:underline cursor-pointer ${
                                    entry.receipt_is_cancelled ? 'text-rose-600 line-through' : 'text-emerald-700'
                                  }`}
                                >
                                  {entry.receipt_number} {entry.receipt_is_cancelled ? '(Annulé)' : ''}
                                </button>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="p-3 font-mono whitespace-nowrap">{entry.invoice_number}</td>
                            <td className="p-3 whitespace-nowrap">
                              <div className="font-bold text-slate-900">{entry.student_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{entry.student_matricule} · {entry.class_name}</div>
                            </td>
                            <td className="p-3 whitespace-nowrap capitalize font-bold text-slate-600">
                              {entry.payment_method.replace(/_/g, ' ')}
                            </td>
                            <td className="p-3 whitespace-nowrap">{entry.cashier_name}</td>
                            <td className={`p-3 text-right font-extrabold whitespace-nowrap font-mono ${isCancel ? 'text-rose-600' : 'text-slate-900'}`}>
                              <FormattedAmount amount={entry.amount} currency={entry.currency} />
                            </td>
                            <td className="p-3">
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {entry.category_allocations.map((alloc, aIdx) => (
                                  <span
                                    key={aIdx}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                      isCancel ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {alloc.fee_type}: {alloc.amount > 0 ? `+${alloc.amount}` : alloc.amount}
                                  </span>
                                ))}
                              </div>
                              {isCancel && entry.cancellation_reason && (
                                <div className="text-[10px] text-rose-600 italic mt-1">
                                  Motif : {entry.cancellation_reason}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination Bar */}
              {data.pagination.total_pages > 1 && (
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">
                    Page {data.pagination.page} sur {data.pagination.total_pages} ({data.pagination.total_records} événements)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!data.pagination.has_previous}
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition cursor-pointer flex items-center gap-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Précédent
                    </button>
                    <button
                      type="button"
                      disabled={!data.pagination.has_next}
                      onClick={() => setCurrentPage((prev) => prev + 1)}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition cursor-pointer flex items-center gap-1"
                    >
                      Suivant <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CATÉGORIES */}
          {activeSubTab === 'caisse_categories' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-600" />
                    Analyse des Encaissements par Catégorie (USD)
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-extrabold border-b border-slate-200">
                      <tr>
                        <th className="p-3">Catégorie de Frais</th>
                        <th className="p-3 text-right">Encaissements Bruts</th>
                        <th className="p-3 text-right">Annulations</th>
                        <th className="p-3 text-right">Net Événementiel</th>
                        <th className="p-3 text-right">Actuellement Confirmé</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {(usdSummary?.by_category || []).map((cat) => (
                        <tr key={cat.fee_type} className="hover:bg-slate-50/80 transition">
                          <td className="p-3 font-bold text-slate-900 capitalize">{cat.fee_type.replace(/_/g, ' ')}</td>
                          <td className="p-3 text-right font-mono font-bold text-slate-900">
                            <FormattedAmount amount={cat.gross_collected} currency="USD" />
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-rose-600">
                            <FormattedAmount amount={cat.cancellations_amount} currency="USD" />
                          </td>
                          <td className="p-3 text-right font-mono font-extrabold text-emerald-700">
                            <FormattedAmount amount={cat.net_event_amount} currency="USD" />
                          </td>
                          <td className="p-3 text-right font-mono text-slate-600">
                            <FormattedAmount amount={cat.confirmed_current_total} currency="USD" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-400 italic pt-2">
                  * {data.disclaimer}
                </p>
              </div>
            </div>
          )}

          {/* TAB 4: CLASSES (VUE PAR CLASSE COMPLÈTE) */}
          {activeSubTab === 'caisse_classes' && (
            <div className="space-y-6">
              {/* USD By Class Table */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-600" />
                    Analyse des Encaissements par Classe (USD)
                  </h3>
                </div>
                {(usdSummary?.by_class || []).length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Aucune donnée par classe pour la période en USD.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-extrabold border-b border-slate-200">
                        <tr>
                          <th className="p-3">Classe</th>
                          <th className="p-3 text-right">Encaissements Bruts</th>
                          <th className="p-3 text-right">Annulations</th>
                          <th className="p-3 text-right">Net Événementiel</th>
                          <th className="p-3 text-right">Actuellement Confirmé</th>
                          <th className="p-3 text-center">Événements</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {(usdSummary?.by_class || []).map((cls) => (
                          <tr key={cls.class_name} className="hover:bg-slate-50/80 transition">
                            <td className="p-3 font-bold text-slate-900">{cls.class_name}</td>
                            <td className="p-3 text-right font-mono font-bold text-slate-900">
                              <FormattedAmount amount={cls.gross_collected} currency="USD" />
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-rose-600">
                              <FormattedAmount amount={cls.cancellations_amount} currency="USD" />
                            </td>
                            <td className="p-3 text-right font-mono font-extrabold text-emerald-700">
                              <FormattedAmount amount={cls.net_event_amount} currency="USD" />
                            </td>
                            <td className="p-3 text-right font-mono text-slate-600">
                              <FormattedAmount amount={cls.confirmed_current_total} currency="USD" />
                            </td>
                            <td className="p-3 text-center font-mono text-slate-500">
                              {cls.collections_count} col. / {cls.cancellations_count} can.
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 italic pt-2">
                  * Agrégats consolidés au niveau de l'établissement par classe sur la période sélectionnée.
                </p>
              </div>

              {/* CDF By Class Table */}
              <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-xl space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-extrabold text-amber-400 flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" />
                    Analyse des Encaissements par Classe (CDF)
                  </h3>
                </div>
                {(cdfSummary?.by_class || []).length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Aucune donnée par classe pour la période en CDF.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-200">
                      <thead className="bg-slate-800 text-slate-400 uppercase tracking-wider font-extrabold border-b border-slate-700">
                        <tr>
                          <th className="p-3">Classe</th>
                          <th className="p-3 text-right">Encaissements Bruts</th>
                          <th className="p-3 text-right">Annulations</th>
                          <th className="p-3 text-right">Net Événementiel</th>
                          <th className="p-3 text-right">Actuellement Confirmé</th>
                          <th className="p-3 text-center">Événements</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 font-medium">
                        {(cdfSummary?.by_class || []).map((cls) => (
                          <tr key={cls.class_name} className="hover:bg-slate-800/80 transition">
                            <td className="p-3 font-bold text-white">{cls.class_name}</td>
                            <td className="p-3 text-right font-mono font-bold text-white">
                              <FormattedAmount amount={cls.gross_collected} currency="CDF" />
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-rose-400">
                              <FormattedAmount amount={cls.cancellations_amount} currency="CDF" />
                            </td>
                            <td className="p-3 text-right font-mono font-extrabold text-emerald-400">
                              <FormattedAmount amount={cls.net_event_amount} currency="CDF" />
                            </td>
                            <td className="p-3 text-right font-mono text-slate-300">
                              <FormattedAmount amount={cls.confirmed_current_total} currency="CDF" />
                            </td>
                            <td className="p-3 text-center font-mono text-slate-400">
                              {cls.collections_count} col. / {cls.cancellations_count} can.
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Receipt Modal Integration */}
      <PaymentReceiptModal
        isOpen={showReceiptModal}
        onClose={() => {
          setShowReceiptModal(false);
          setActiveReceipt(null);
        }}
        receipt={activeReceipt}
      />
    </div>
  );
};
