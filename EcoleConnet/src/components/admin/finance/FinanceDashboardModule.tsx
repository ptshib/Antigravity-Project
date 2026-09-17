// Fichier : src/components/admin/finance/FinanceDashboardModule.tsx
// Tableau de bord financier principal pour le Portail Administrateur & Agent Financier

import React, { useState, useEffect, useCallback } from 'react';
import { computeFinanceDashboardKPIs, fetchAllSchoolInvoices, getSchoolAgingSummary } from '../../../services/financeService';
import type { AgingSummaryResponse } from '../../../types/finance';
import { FormattedAmount } from '../../common/CurrencyBadge';
import { SchoolFeesCatalogModule } from './SchoolFeesCatalogModule';
import { StudentInvoicesModule } from './StudentInvoicesModule';
import { StudentFinanceDossierModal } from './StudentFinanceDossierModal';
import { AgingSummaryCard } from './AgingSummaryCard';
import { OverdueInvoicesTable } from './OverdueInvoicesTable';
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Layers,
  BarChart3,
  Clock
} from 'lucide-react';

interface FinanceDashboardModuleProps {
  schoolId: string;
}

type FinanceSubTab = 'vue_densemble' | 'creances' | 'factures' | 'catalogue';

export const FinanceDashboardModule: React.FC<FinanceDashboardModuleProps> = ({ schoolId }) => {
  const [activeSubTab, setActiveSubTab] = useState<FinanceSubTab>('vue_densemble');

  // USD Financial KPIs
  const [totalIssuedUSD, setTotalIssuedUSD] = useState<number>(0);
  const [totalPaidUSD, setTotalPaidUSD] = useState<number>(0);
  const [totalRemainingUSD, setTotalRemainingUSD] = useState<number>(0);
  const [issuedCountUSD, setIssuedCountUSD] = useState<number>(0);
  const [paidCountUSD, setPaidCountUSD] = useState<number>(0);
  const [partialCountUSD, setPartialCountUSD] = useState<number>(0);
  const [draftCountUSD, setDraftCountUSD] = useState<number>(0);

  // CDF Financial KPIs
  const [totalIssuedCDF, setTotalIssuedCDF] = useState<number>(0);
  const [totalPaidCDF, setTotalPaidCDF] = useState<number>(0);
  const [totalRemainingCDF, setTotalRemainingCDF] = useState<number>(0);
  const [issuedCountCDF, setIssuedCountCDF] = useState<number>(0);
  const [paidCountCDF, setPaidCountCDF] = useState<number>(0);
  const [partialCountCDF, setPartialCountCDF] = useState<number>(0);
  const [draftCountCDF, setDraftCountCDF] = useState<number>(0);

  // Dossier Modal State
  const [selectedDossierStudentId, setSelectedDossierStudentId] = useState<string | null>(null);

  // Finance 4A State (Aging Summary)
  const [agingSummary, setAgingSummary] = useState<AgingSummaryResponse | null>(null);
  const [agingLoading, setAgingLoading] = useState<boolean>(false);
  const [agingError, setAgingError] = useState<string | null>(null);

  const fetchAgingData = useCallback(async () => {
    setAgingLoading(true);
    setAgingError(null);
    try {
      const summaryRes = await getSchoolAgingSummary();
      setAgingSummary(summaryRes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors du chargement de la balance âgée.';
      setAgingError(msg);
    } finally {
      setAgingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSubTab === 'creances' && !agingSummary && !agingLoading) {
      fetchAgingData();
    }
  }, [activeSubTab, agingSummary, agingLoading, fetchAgingData]);

  const fetchKpis = useCallback(async () => {
    try {
      const { data: invData, error: invErr } = await fetchAllSchoolInvoices(schoolId);

      if (invErr) {
        console.error('Erreur chargement factures paginées:', invErr);
        return;
      }

      if (invData) {
        const kpis = computeFinanceDashboardKPIs(invData);

        setTotalIssuedUSD(kpis.USD.totalIssued);
        setTotalPaidUSD(kpis.USD.totalPaid);
        setTotalRemainingUSD(kpis.USD.totalRemaining);
        setIssuedCountUSD(kpis.USD.issuedCount);
        setPaidCountUSD(kpis.USD.paidCount);
        setPartialCountUSD(kpis.USD.partialCount);
        setDraftCountUSD(kpis.USD.draftCount);

        setTotalIssuedCDF(kpis.CDF.totalIssued);
        setTotalPaidCDF(kpis.CDF.totalPaid);
        setTotalRemainingCDF(kpis.CDF.totalRemaining);
        setIssuedCountCDF(kpis.CDF.issuedCount);
        setPaidCountCDF(kpis.CDF.paidCount);
        setPartialCountCDF(kpis.CDF.partialCount);
        setDraftCountCDF(kpis.CDF.draftCount);
      }
    } catch (err: unknown) {
      console.error('Erreur KPIs finance:', err);
    }
  }, [schoolId]);

  useEffect(() => {
    if (schoolId) {
      fetchKpis();
    }
  }, [schoolId, fetchKpis]);

  const recoveryRateUSD = totalIssuedUSD > 0 ? Math.round((totalPaidUSD / totalIssuedUSD) * 100) : 0;
  const recoveryRateCDF = totalIssuedCDF > 0 ? Math.round((totalPaidCDF / totalIssuedCDF) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header & Sub Navigation */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-sm">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Gestion Financière & Recouvrement</h2>
            <p className="text-xs text-slate-500">
              Module certifié Supabase Phase Finance (Toutes écritures sécurisées via RPCs)
            </p>
          </div>
        </div>

        {/* Sub Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
          <button
            onClick={() => setActiveSubTab('vue_densemble')}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${activeSubTab === 'vue_densemble' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Vue d'ensemble
          </button>
          <button
            onClick={() => setActiveSubTab('creances')}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${activeSubTab === 'creances' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <Clock className="w-3.5 h-3.5" />
            Balance Âgée & Créances
          </button>
          <button
            onClick={() => setActiveSubTab('factures')}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${activeSubTab === 'factures' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <FileText className="w-3.5 h-3.5" />
            Factures & Encaissements
          </button>
          <button
            onClick={() => setActiveSubTab('catalogue')}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${activeSubTab === 'catalogue' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <Layers className="w-3.5 h-3.5" />
            Grille Tarifaire
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeSubTab === 'vue_densemble' && (
        <div className="space-y-6">
          {/* KPI Cards (USD) */}
          <div className="space-y-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Devise Principale (USD) — Taux de Recouvrement : {recoveryRateUSD}%
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                <div className="flex justify-between items-center text-xs text-slate-500 font-bold">
                  <span>Total Émis (USD)</span>
                  <FileText className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-xl font-extrabold text-slate-900">
                  <FormattedAmount amount={totalIssuedUSD} currency="USD" />
                </div>
                <p className="text-[11px] text-slate-400">
                  {issuedCountUSD} factures émises {draftCountUSD > 0 ? `(${draftCountUSD} brouillons exclus)` : ''}
                </p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                <div className="flex justify-between items-center text-xs text-slate-500 font-bold">
                  <span>Total Encaissé (USD)</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-xl font-extrabold text-emerald-700">
                  <FormattedAmount amount={totalPaidUSD} currency="USD" />
                </div>
                <p className="text-[11px] text-emerald-600 font-semibold">{paidCountUSD} factures entièrement payées</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                <div className="flex justify-between items-center text-xs text-slate-500 font-bold">
                  <span>Reste à Recouvrer (USD)</span>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-xl font-extrabold text-amber-700">
                  <FormattedAmount amount={totalRemainingUSD} currency="USD" />
                </div>
                <p className="text-[11px] text-amber-600 font-semibold">{partialCountUSD} factures en paiement partiel</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                <div className="flex justify-between items-center text-xs text-slate-500 font-bold">
                  <span>Recouvrement USD</span>
                  <TrendingUp className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-xl font-extrabold text-slate-900">
                  {recoveryRateUSD}%
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(recoveryRateUSD, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* KPI Cards (CDF) */}
          {(totalIssuedCDF > 0 || totalPaidCDF > 0 || draftCountCDF > 0) && (
            <div className="p-5 bg-slate-900 text-white rounded-2xl space-y-4 shadow-xl border border-slate-800">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800 pb-3">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                  Synthèse en Francs Congolais (CDF) — Taux de Recouvrement CDF : {recoveryRateCDF}%
                </h4>
                {draftCountCDF > 0 && (
                  <span className="text-[11px] text-slate-400 font-mono">
                    {draftCountCDF} facture(s) brouillon CDF non comptabilisée(s) dans le total émis
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80">
                  <span className="text-slate-400 block font-semibold mb-1">Total Émis CDF</span>
                  <span className="text-lg font-extrabold text-white block">
                    <FormattedAmount amount={totalIssuedCDF} currency="CDF" />
                  </span>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    {issuedCountCDF} facture(s) émises
                  </span>
                </div>

                <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80">
                  <span className="text-slate-400 block font-semibold mb-1">Total Encaissé CDF</span>
                  <span className="text-lg font-extrabold text-emerald-400 block">
                    <FormattedAmount amount={totalPaidCDF} currency="CDF" />
                  </span>
                  <span className="text-[10px] text-emerald-400 font-semibold mt-1 block">
                    {paidCountCDF} facture(s) payée(s)
                  </span>
                </div>

                <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80">
                  <span className="text-slate-400 block font-semibold mb-1">Reste à Recouvrer CDF</span>
                  <span className="text-lg font-extrabold text-amber-400 block">
                    <FormattedAmount amount={totalRemainingCDF} currency="CDF" />
                  </span>
                  <span className="text-[10px] text-amber-400 font-semibold mt-1 block">
                    {partialCountCDF} facture(s) partielle(s)
                  </span>
                </div>

                <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80">
                  <span className="text-slate-400 block font-semibold mb-1">Taux Recouvrement</span>
                  <span className="text-lg font-extrabold text-white block">
                    {recoveryRateCDF}%
                  </span>
                  <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden mt-2">
                    <div
                      className="bg-emerald-400 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(recoveryRateCDF, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shortcut Card to Invoices */}
          <div className="p-6 bg-amber-500 text-white rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-base font-extrabold">Gestion Rapide des Encaissements</h3>
              <p className="text-xs text-amber-100 mt-1">
                Accédez directement aux factures pour émettre, encaisser ou consulter les reçus officiels.
              </p>
            </div>
            <button
              onClick={() => setActiveSubTab('factures')}
              className="px-5 py-2.5 bg-white text-slate-900 hover:bg-slate-100 rounded-xl text-xs font-bold shadow-md transition cursor-pointer"
            >
              Ouvrir le Module de Facturation
            </button>
          </div>
        </div>
      )}

      {activeSubTab === 'creances' && (
        <div className="space-y-6">
          <AgingSummaryCard
            summary={agingSummary}
            loading={agingLoading}
            error={agingError}
            onRetry={fetchAgingData}
          />
          <OverdueInvoicesTable />
        </div>
      )}

      {activeSubTab === 'factures' && (
        <StudentInvoicesModule
          schoolId={schoolId}
          onOpenDossier={(studentId) => setSelectedDossierStudentId(studentId)}
        />
      )}

      {activeSubTab === 'catalogue' && (
        <SchoolFeesCatalogModule schoolId={schoolId} />
      )}

      {/* Dossier Financier Modal */}
      <StudentFinanceDossierModal
        isOpen={!!selectedDossierStudentId}
        onClose={() => setSelectedDossierStudentId(null)}
        studentId={selectedDossierStudentId}
      />
    </div>
  );
};
