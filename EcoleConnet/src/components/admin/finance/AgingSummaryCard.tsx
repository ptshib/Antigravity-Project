// Fichier : src/components/admin/finance/AgingSummaryCard.tsx
// Composant d'affichage accessible de la Balance Âgée (Finance 4A)

import React from 'react';
import {
  Clock,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  Calendar,
  RefreshCw,
  Info,
  TrendingUp,
  CreditCard
} from 'lucide-react';
import type { AgingSummaryResponse, CurrencyAgingSummary, AgingBucketKey } from '../../../types/finance';

interface AgingSummaryCardProps {
  summary: AgingSummaryResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export const AgingSummaryCard: React.FC<AgingSummaryCardProps> = ({
  summary,
  loading,
  error,
  onRetry
}) => {
  if (loading) {
    return (
      <div
        className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 min-h-[300px] flex flex-col items-center justify-center"
        role="status"
        aria-label="Chargement de la balance âgée en cours"
      >
        <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-3" aria-hidden="true" />
        <p className="text-sm text-slate-500 font-medium">Chargement de la balance âgée et des échéances...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="bg-red-50 rounded-2xl p-6 border border-red-200 text-slate-800"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-start space-x-3">
          <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <h3 className="font-semibold text-red-900 text-base">Impossible de charger la balance âgée</h3>
            <p className="text-sm text-red-700 mt-1">{error}</p>
            <button
              onClick={onRetry}
              className="mt-4 inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              aria-label="Réessayer de charger la balance âgée"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const { meta, currencies } = summary;

  const formatMoney = (amount: number, curr: 'USD' | 'CDF') => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: curr,
      maximumFractionDigits: curr === 'USD' ? 2 : 0
    }).format(amount);
  };

  const renderCurrencySection = (data: CurrencyAgingSummary, curr: 'USD' | 'CDF') => {
    const bucketsConfig: Array<{
      key: AgingBucketKey;
      title: string;
      subtitle: string;
      colorClass: string;
      badgeClass: string;
      icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
    }> = [
      {
        key: '1_30_days',
        title: '1 à 30 jours',
        subtitle: 'Retard léger',
        colorClass: 'border-l-4 border-amber-500 bg-amber-50/50',
        badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
        icon: Clock
      },
      {
        key: '31_60_days',
        title: '31 à 60 jours',
        subtitle: 'Retard modéré',
        colorClass: 'border-l-4 border-orange-500 bg-orange-50/50',
        badgeClass: 'bg-orange-100 text-orange-900 border-orange-300',
        icon: AlertCircle
      },
      {
        key: '61_90_days',
        title: '61 à 90 jours',
        subtitle: 'Retard important',
        colorClass: 'border-l-4 border-red-500 bg-red-50/50',
        badgeClass: 'bg-red-100 text-red-900 border-red-300',
        icon: AlertTriangle
      },
      {
        key: 'over_90_days',
        title: '> 90 jours',
        subtitle: 'Retard critique (>90j)',
        colorClass: 'border-l-4 border-purple-600 bg-purple-50/50',
        badgeClass: 'bg-purple-100 text-purple-900 border-purple-300',
        icon: ShieldAlert
      }
    ];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center font-bold text-xs text-indigo-700">
              {curr}
            </div>
            <h4 className="font-bold text-slate-800 text-base">Portefeuille en {curr}</h4>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            {data.total_overdue_count} facture(s) en retard
          </span>
        </div>

        {/* 3 Cartes d'En-tête Synthèse (Total en retard, Due aujourd'hui, À venir) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Total En Retard */}
          <div className="p-4 rounded-xl bg-red-50/80 border border-red-100 flex flex-col justify-between">
            <div className="flex items-center justify-between text-red-700 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Échu Impayé</span>
              <AlertTriangle className="w-4 h-4 text-red-600" aria-hidden="true" />
            </div>
            <div>
              <div className="text-xl font-extrabold text-red-900">
                {formatMoney(data.total_overdue_amount, curr)}
              </div>
              <p className="text-xs text-red-700 mt-1 font-medium">
                {data.total_overdue_count} facture(s) échue(s)
              </p>
            </div>
          </div>

          {/* Dues Aujourd'hui */}
          <div className="p-4 rounded-xl bg-blue-50/80 border border-blue-100 flex flex-col justify-between">
            <div className="flex items-center justify-between text-blue-700 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Échéance Aujourd’hui</span>
              <Calendar className="w-4 h-4 text-blue-600" aria-hidden="true" />
            </div>
            <div>
              <div className="text-xl font-extrabold text-blue-900">
                {formatMoney(data.due_today_amount, curr)}
              </div>
              <p className="text-xs text-blue-700 mt-1 font-medium">
                {data.due_today_count} facture(s) à régler ce jour
              </p>
            </div>
          </div>

          {/* À Venir */}
          <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-100 flex flex-col justify-between">
            <div className="flex items-center justify-between text-emerald-700 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">À Venir (Non Échues)</span>
              <TrendingUp className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div>
              <div className="text-xl font-extrabold text-emerald-900">
                {formatMoney(data.upcoming_amount, curr)}
              </div>
              <p className="text-xs text-emerald-700 mt-1 font-medium">
                {data.upcoming_count} facture(s) dans les délais
              </p>
            </div>
          </div>
        </div>

        {/* Tranches de retard (Aging Buckets) */}
        <div>
          <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Répartition par Tranches de Retard
          </h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {bucketsConfig.map((cfg) => {
              const bData = data.aging_buckets[cfg.key] || { amount: 0, count: 0 };
              const Icon = cfg.icon;
              return (
                <div
                  key={cfg.key}
                  className={`p-3.5 rounded-xl border border-slate-200/80 ${cfg.colorClass} flex flex-col justify-between transition-all`}
                  role="region"
                  aria-label={`Tranche de retard ${cfg.title}: ${formatMoney(bData.amount, curr)}, ${bData.count} factures`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-700">{cfg.title}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.badgeClass}`}>
                      <Icon className="w-3 h-3 mr-1" aria-hidden="true" />
                      {cfg.subtitle}
                    </span>
                  </div>
                  <div>
                    <div className="text-base font-extrabold text-slate-900">
                      {formatMoney(bData.amount, curr)}
                    </div>
                    <div className="text-[11px] text-slate-600 font-medium mt-0.5">
                      {bData.count} facture(s)
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-6">
      {/* En-tête Métier et Timezone */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/60">
        <div>
          <h3 className="text-base font-extrabold text-slate-900 flex items-center">
            <CreditCard className="w-5 h-5 text-indigo-600 mr-2" aria-hidden="true" />
            Balance Âgée des Créances
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Situation opérationnelle calculée au niveau du serveur d'établissement
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
          <div className="inline-flex items-center px-2.5 py-1 rounded-md bg-white border border-slate-200 shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400 mr-1.5" aria-hidden="true" />
            <span>Date métier : <strong className="text-slate-800">{meta.business_date}</strong></span>
          </div>

          <div className="inline-flex items-center px-2.5 py-1 rounded-md bg-white border border-slate-200 shadow-2xs">
            <Clock className="w-3.5 h-3.5 text-slate-400 mr-1.5" aria-hidden="true" />
            <span>Timezone : <strong className="text-slate-800">{meta.school_timezone}</strong></span>
          </div>
        </div>
      </div>

      {/* Avertissement discret si Fallback Timezone appliqué */}
      {meta.timezone_fallback_applied && (
        <div
          className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center space-x-2"
          role="status"
          aria-live="polite"
        >
          <Info className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
          <span>
            <strong>Remarque :</strong> Le fuseau horaire configuré pour l'école n'a pas été reconnu par le serveur. L'horloge métier a été ajustée sur le fuseau par défaut (<code>Africa/Kinshasa</code>).
          </span>
        </div>
      )}

      {/* Section USD */}
      {renderCurrencySection(currencies.USD, 'USD')}

      {/* Séparateur */}
      <hr className="border-slate-100" />

      {/* Section CDF */}
      {renderCurrencySection(currencies.CDF, 'CDF')}
    </div>
  );
};
