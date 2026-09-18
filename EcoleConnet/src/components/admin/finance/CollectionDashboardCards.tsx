// Fichier : src/components/admin/finance/CollectionDashboardCards.tsx
import React from 'react';
import type { CollectionDashboardResponse, CollectionDashboardCurrency } from '../../../types/finance';
import { AlertTriangle, RefreshCw, ShieldAlert, Clock, CheckCircle2, TrendingUp, Calendar, Activity } from 'lucide-react';

interface CollectionDashboardCardsProps {
  data: CollectionDashboardResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function formatCurrencyAmount(amount: number, currency: 'USD' | 'CDF'): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('fr-CD', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }
  // CDF : sans décimales visuelles
  return new Intl.NumberFormat('fr-CD', {
    style: 'currency',
    currency: 'CDF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

const CurrencyMetricsSection: React.FC<{
  title: string;
  data: CollectionDashboardCurrency;
}> = ({ title, data }) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-bold text-lg text-slate-800">{title}</span>
          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
            {data.currency}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {data.critical_priority_count > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-50 text-rose-700 border border-rose-200">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
              <span>{data.critical_priority_count} critique{data.critical_priority_count > 1 ? 's' : ''}</span>
            </span>
          )}
          {data.high_priority_count > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
              <span>{data.high_priority_count} élevée{data.high_priority_count > 1 ? 's' : ''}</span>
            </span>
          )}
        </div>
      </div>

      {/* KPI Principal : Total échu */}
      <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total échu non réglé</span>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">
            {formatCurrencyAmount(data.total_overdue_amount, data.currency)}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <div>
            <span className="font-semibold text-slate-900">{data.total_overdue_count}</span> facture{data.total_overdue_count > 1 ? 's' : ''} échue{data.total_overdue_count > 1 ? 's' : ''}
          </div>
          <div className="h-4 w-px bg-slate-300" />
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <span>Retard moyen : <strong className="text-slate-900">{data.average_overdue_days} j</strong></span>
          </div>
        </div>
      </div>

      {/* Grille des statuts de recouvrement mutuellement exclusifs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Jamais relancé */}
        <div className="bg-slate-50/70 p-3.5 rounded-lg border border-slate-200/80">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-1">
            <span>Jamais relancé</span>
            <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-200 text-slate-700">
              {data.never_contacted_count}
            </span>
          </div>
          <div className="text-base font-bold text-slate-800">
            {formatCurrencyAmount(data.never_contacted_amount, data.currency)}
          </div>
        </div>

        {/* Relances dues */}
        <div className="bg-amber-50/50 p-3.5 rounded-lg border border-amber-200/60">
          <div className="flex items-center justify-between text-xs font-medium text-amber-800 mb-1">
            <span>Relances dues</span>
            <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-200 text-amber-800">
              {data.followup_due_count}
            </span>
          </div>
          <div className="text-xs text-amber-700 font-medium">
            Action requise aujourd'hui
          </div>
        </div>

        {/* Promesses en cours */}
        <div className="bg-blue-50/50 p-3.5 rounded-lg border border-blue-200/60">
          <div className="flex items-center justify-between text-xs font-medium text-blue-800 mb-1">
            <span>Promesses en cours</span>
            <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-blue-200 text-blue-800">
              {data.promise_pending_count}
            </span>
          </div>
          <div className="text-base font-bold text-blue-900">
            {formatCurrencyAmount(data.promise_pending_amount, data.currency)}
          </div>
        </div>

        {/* Promesses dépassées */}
        <div className="bg-rose-50/50 p-3.5 rounded-lg border border-rose-200/60">
          <div className="flex items-center justify-between text-xs font-medium text-rose-800 mb-1">
            <span>Promesses dépassées</span>
            <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-rose-200 text-rose-800">
              {data.promise_overdue_count}
            </span>
          </div>
          <div className="text-base font-bold text-rose-900">
            {formatCurrencyAmount(data.promise_overdue_amount, data.currency)}
          </div>
        </div>
      </div>

      {/* Activité & Taux de couverture */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50/40 border border-emerald-200/50">
          <div className="p-2 bg-emerald-100 rounded-md text-emerald-700">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Couverture recouvrement</div>
            <div className="text-base font-bold text-emerald-800">{data.collection_coverage_rate} %</div>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-indigo-50/40 border border-indigo-200/50">
          <div className="p-2 bg-indigo-100 rounded-md text-indigo-700">
            <Activity className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Actions 7 derniers jours</div>
            <div className="text-base font-bold text-indigo-800">{data.actions_last_7_days_count} action{data.actions_last_7_days_count > 1 ? 's' : ''}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-indigo-50/40 border border-indigo-200/50">
          <div className="p-2 bg-indigo-100 rounded-md text-indigo-700">
            <TrendingUp className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Actions 30 derniers jours</div>
            <div className="text-base font-bold text-indigo-800">{data.actions_last_30_days_count} action{data.actions_last_30_days_count > 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const CollectionDashboardCards: React.FC<CollectionDashboardCardsProps> = ({
  data,
  loading,
  error,
  onRetry
}) => {
  if (loading) {
    return (
      <div role="status" className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-sm">
        <div className="flex items-center gap-3 text-slate-600">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" aria-hidden="true" />
          <span className="font-medium text-sm">Chargement du tableau de bord de recouvrement...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <h4 className="font-semibold text-rose-900 text-sm">Erreur de chargement du tableau de bord</h4>
            <p className="text-sm text-rose-700 mt-1">{error}</p>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-rose-700 bg-white border border-rose-300 rounded-lg hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-rose-500 transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>Réessayer</span>
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Bannière de fallback timezone si applicable */}
      {data.meta.timezone_fallback_applied && (
        <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 flex items-start gap-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <strong className="font-semibold">Fuseau horaire non configuré :</strong> Le fuseau horaire de l'établissement n'a pas été défini. Le fuseau horaire par défaut <code>{data.meta.school_timezone}</code> est appliqué pour l'évaluation de la date métier (<code>{data.meta.business_date}</code>).
          </div>
        </div>
      )}

      {/* Header date métier & timezone */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <span>Date métier : <strong className="text-slate-700">{data.meta.business_date}</strong></span>
          <span className="text-slate-300">•</span>
          <span>Fuseau : <strong className="text-slate-700">{data.meta.school_timezone}</strong></span>
        </div>
        <div>
          Synthèse au <strong>{new Date(data.meta.evaluated_at_utc).toLocaleTimeString('fr-CD', { timeZone: 'UTC' })} UTC</strong>
        </div>
      </div>

      {/* Cartes USD et CDF séparées */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <CurrencyMetricsSection title="Synthèse Recouvrement USD" data={data.currencies.USD} />
        <CurrencyMetricsSection title="Synthèse Recouvrement CDF" data={data.currencies.CDF} />
      </div>
    </div>
  );
};
