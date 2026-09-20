// Fichier : src/components/admin/finance/RealEmailDeliveryDashboard.tsx
// Interface frontend de supervision et observabilité des e-mails réels (Resend)
// 100% en lecture seule (Aucun déclenchement d'envoi, aucune mutation d'état)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getSchoolRealEmailReadiness,
  getSchoolRealEmailDeliveryDashboard,
  getSchoolRealEmailDeliveryJobs
} from '../../../services/financeService';
import type {
  RealEmailReadinessResponse,
  RealEmailDeliveryDashboardResponse,
  RealEmailDeliveryJob,
  RealEmailJobStatus,
  RealEmailDeliveryJobsCursor,
  RealEmailReadinessBlocker
} from '../../../types/finance';
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
  Mail,
  Filter,
  Info,
  CheckCircle2,
  Calendar
} from 'lucide-react';

import { RealEmailCampaignWizard } from './RealEmailCampaignWizard';

const BLOCKER_LABELS: Record<RealEmailReadinessBlocker, string> = {
  GLOBAL_KILL_SWITCH_DISABLED: 'L’envoi réel est désactivé au niveau de la plateforme.',
  SENDER_IDENTITY_NOT_VERIFIED: 'L’identité d’expédition n’est pas encore vérifiée.',
  SENDER_IDENTITY_NOT_CONFIGURED: 'Aucune identité d’expédition n’est configurée.',
  SCHOOL_SETTINGS_NOT_CONFIGURED: 'Les paramètres de livraison de l’établissement ne sont pas configurés.',
  SCHOOL_EMAIL_DISABLED: 'Les e-mails réels sont désactivés pour cet établissement.'
};

const JOB_STATUS_LABELS: Record<RealEmailJobStatus, string> = {
  pending: 'En attente',
  claimed: 'Réclamé',
  submitted: 'Soumis',
  network_unknown: 'Réseau incertain',
  retry_wait: 'Nouvel essai planifié',
  terminal_failed: 'Échec définitif',
  delivery_confirmed: 'Livré',
  bounced: 'Rebond',
  complained: 'Plainte'
};

const JOB_STATUS_BADGE_CLASSES: Record<RealEmailJobStatus, string> = {
  pending: 'bg-slate-100 text-slate-700 border-slate-300',
  claimed: 'bg-blue-50 text-blue-700 border-blue-200',
  submitted: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  network_unknown: 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold',
  retry_wait: 'bg-orange-50 text-orange-700 border-orange-200',
  terminal_failed: 'bg-rose-100 text-rose-900 border-rose-300 font-extrabold',
  delivery_confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  bounced: 'bg-red-100 text-red-900 border-red-300 font-extrabold',
  complained: 'bg-purple-100 text-purple-900 border-purple-300 font-extrabold'
};

export interface RealEmailDeliveryDashboardProps {
  userRole?: string;
  isSchoolAdmin?: boolean;
}

export const RealEmailDeliveryDashboard: React.FC<RealEmailDeliveryDashboardProps> = ({
  userRole = 'school_admin',
  isSchoolAdmin
}) => {
  const canCreateRealCampaign = isSchoolAdmin !== undefined ? isSchoolAdmin : userRole === 'school_admin';
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  // Readiness & Dashboard state
  const [readiness, setReadiness] = useState<RealEmailReadinessResponse | null>(null);
  const [dashboard, setDashboard] = useState<RealEmailDeliveryDashboardResponse | null>(null);
  const [selectedBusinessDate, setSelectedBusinessDate] = useState<string>('');

  // Jobs state
  const [jobs, setJobs] = useState<RealEmailDeliveryJob[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<RealEmailJobStatus | 'all'>('all');
  const [nextCursor, setNextCursor] = useState<RealEmailDeliveryJobsCursor | null>(null);
  const [hasMoreJobs, setHasMoreJobs] = useState<boolean>(false);

  // Loading & Error states
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [dateLoading, setDateLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dateErrorMsg, setDateErrorMsg] = useState<string | null>(null);

  // Async Safety & Locks
  const refreshLockRef = useRef<boolean>(false);
  const loadMoreLockRef = useRef<boolean>(false);
  const dashboardDateReqIdRef = useRef<number>(0);
  const jobsReqIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 1. Initial Load & Global Refresh
  const handleGlobalRefresh = useCallback(async (isRefresh = false) => {
    if (refreshLockRef.current) return;
    refreshLockRef.current = true;

    const currentDateReqId = ++dashboardDateReqIdRef.current;
    const currentJobsReqId = ++jobsReqIdRef.current;

    if (isMountedRef.current) {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setInitialLoading(true);
      }
      setErrorMsg(null);
      setDateErrorMsg(null);
    }

    try {
      const [readinessRes, dashboardRes, jobsRes] = await Promise.all([
        getSchoolRealEmailReadiness(),
        getSchoolRealEmailDeliveryDashboard(null),
        getSchoolRealEmailDeliveryJobs({ p_status: null, p_limit: 20 }, null)
      ]);

      if (!isMountedRef.current) return;

      if (currentDateReqId === dashboardDateReqIdRef.current) {
        setReadiness(readinessRes);
        setDashboard(dashboardRes);
        setSelectedBusinessDate(dashboardRes.business_date);
        setDateErrorMsg(null);
      }

      if (currentJobsReqId === jobsReqIdRef.current) {
        setJobs(jobsRes.items);
        setHasMoreJobs(jobsRes.has_more);
        setNextCursor(jobsRes.next_cursor);
        setSelectedStatus('all');
      }

      setErrorMsg(null);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Erreur lors de la récupération des données de supervision e-mail.';
      setErrorMsg(msg);
    } finally {
      refreshLockRef.current = false;
      if (isMountedRef.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Initial mount
  useEffect(() => {
    handleGlobalRefresh(false);
  }, [handleGlobalRefresh]);

  // 2. Business Date Change (reloads ONLY quota dashboard)
  const fetchDashboardForDate = async (dateStr: string | null) => {
    const currentDateReqId = ++dashboardDateReqIdRef.current;

    if (isMountedRef.current) {
      setDateLoading(true);
      setDateErrorMsg(null);
    }

    try {
      const dashboardRes = await getSchoolRealEmailDeliveryDashboard(dateStr);
      if (!isMountedRef.current || currentDateReqId !== dashboardDateReqIdRef.current) return;

      setDashboard(dashboardRes);
      setSelectedBusinessDate(dashboardRes.business_date);
      setDateErrorMsg(null);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentDateReqId !== dashboardDateReqIdRef.current) return;
      // Preserve previous dashboard data on failure!
      const msg = err instanceof Error ? err.message : 'Erreur lors du chargement de la date métier.';
      setDateErrorMsg(msg);
    } finally {
      if (isMountedRef.current && currentDateReqId === dashboardDateReqIdRef.current) {
        setDateLoading(false);
      }
    }
  };

  const handleBusinessDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSelectedBusinessDate(val);

    if (val === '') {
      fetchDashboardForDate(null);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      fetchDashboardForDate(val);
    }
    // Non-conforming YYYY-MM-DD is never sent
  };

  // 3. Filter Change
  const handleFilterStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatusStr = e.target.value;
    const newStatus = newStatusStr === 'all' ? 'all' : (newStatusStr as RealEmailJobStatus);
    setSelectedStatus(newStatus);

    const currentJobsReqId = ++jobsReqIdRef.current;

    if (isMountedRef.current) {
      setJobs([]);
      setNextCursor(null);
      setHasMoreJobs(false);
      setErrorMsg(null);
    }

    try {
      const targetStatus = newStatus === 'all' ? null : newStatus;
      const jobsRes = await getSchoolRealEmailDeliveryJobs({ p_status: targetStatus, p_limit: 20 }, null);

      if (!isMountedRef.current || currentJobsReqId !== jobsReqIdRef.current) return;

      setJobs(jobsRes.items);
      setHasMoreJobs(jobsRes.has_more);
      setNextCursor(jobsRes.next_cursor);
      setErrorMsg(null);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentJobsReqId !== jobsReqIdRef.current) return;
      const msg = err instanceof Error ? err.message : 'Erreur lors du filtrage des jobs.';
      setErrorMsg(msg);
    }
  };

  // 4. Load More
  const handleLoadMore = async () => {
    if (!hasMoreJobs || !nextCursor || loadMoreLockRef.current) return;
    loadMoreLockRef.current = true;

    const currentJobsReqId = jobsReqIdRef.current;

    if (isMountedRef.current) {
      setLoadingMore(true);
      setErrorMsg(null);
    }

    try {
      const targetStatus = selectedStatus === 'all' ? null : selectedStatus;
      const jobsRes = await getSchoolRealEmailDeliveryJobs(
        { p_status: targetStatus, p_limit: 20 },
        nextCursor
      );

      if (!isMountedRef.current || currentJobsReqId !== jobsReqIdRef.current) return;

      // Deduplicate items on append by job_id
      setJobs(prev => {
        const existingIds = new Set(prev.map(j => j.job_id));
        const newItems = jobsRes.items.filter(j => !existingIds.has(j.job_id));
        return [...prev, ...newItems];
      });

      setHasMoreJobs(jobsRes.has_more);
      setNextCursor(jobsRes.next_cursor);
      setErrorMsg(null);
    } catch (err: unknown) {
      if (!isMountedRef.current || currentJobsReqId !== jobsReqIdRef.current) return;
      // Preserve existing items, has_more, and next_cursor on load-more failure
      const msg = err instanceof Error ? err.message : 'Erreur lors du chargement de la page suivante.';
      setErrorMsg(msg);
    } finally {
      loadMoreLockRef.current = false;
      if (isMountedRef.current) {
        setLoadingMore(false);
      }
    }
  };

  if (initialLoading) {
    return (
      <div
        className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-4 shadow-xs"
        aria-busy="true"
      >
        <div className="flex justify-center">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
        <p className="text-sm font-bold text-slate-700">
          Chargement de l’observatoire de livraison des e-mails réels...
        </p>
      </div>
    );
  }

  const effectiveEnabled = readiness?.effective_real_email_enabled ?? false;
  const blockers = readiness?.blockers ?? [];

  // Quota percentage calculation
  const dailyLimit = dashboard?.quota.daily_limit ?? 100;
  const reservedCount = dashboard?.quota.reserved_count ?? 0;
  const submittedCount = dashboard?.quota.submitted_count ?? 0;
  const remainingCount = dashboard?.quota.remaining_count ?? 100;
  const usedCount = Math.min(reservedCount + submittedCount, dailyLimit);
  const usedPercentage = dailyLimit > 0 ? Math.min(Math.max(Math.round((usedCount / dailyLimit) * 100), 0), 100) : 0;

  return (
    <div className="space-y-6">
      {/* Banner & Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl shadow-xs ${effectiveEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-white'}`}>
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-extrabold text-slate-900">Supervision des e-mails réels</h2>
                <span
                  id="real-email-status-badge"
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border ${
                    effectiveEnabled
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-amber-50 text-amber-800 border-amber-300'
                  }`}
                >
                  {effectiveEnabled ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      Disponible
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                      Désactivé
                    </>
                  )}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Prestataire connecté : <span className="font-bold text-slate-700">Resend</span> — Quota journalier : {dailyLimit} e-mails
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
            {canCreateRealCampaign && (
              <button
                type="button"
                onClick={() => setIsWizardOpen(true)}
                className="w-full sm:w-auto px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Nouvelle campagne e-mail REAL</span>
              </button>
            )}
            <button
              onClick={() => handleGlobalRefresh(true)}
              disabled={refreshing}
              className="w-full sm:w-auto px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Actualiser</span>
            </button>
          </div>
        </div>

        {/* Permanent Read-only Warning Banner */}
        <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2.5 text-blue-900 text-xs font-bold">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <span>Cette page est en lecture seule. Elle ne déclenche aucun envoi.</span>
        </div>

        {/* Global Error Banner */}
        {errorMsg && (
          <div role="alert" className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-3 text-rose-900 text-xs font-bold">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => handleGlobalRefresh(true)}
              className="px-3 py-1 bg-rose-600 text-white rounded-lg text-[11px] font-extrabold hover:bg-rose-700 transition cursor-pointer"
            >
              Réessayer
            </button>
          </div>
        )}
      </div>

      {/* Blockers list when disabled */}
      {!effectiveEnabled && blockers.length > 0 && (
        <div className="bg-amber-50/80 border border-amber-200 p-6 rounded-2xl shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-amber-900 font-extrabold text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>Conditions d'activation non satisfaites ({blockers.length} obstacle{blockers.length > 1 ? 's' : ''})</span>
          </div>
          <ul className="space-y-2">
            {blockers.map((b, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-xs font-bold text-amber-950 bg-white/80 p-2.5 rounded-xl border border-amber-200/60 shadow-2xs">
                <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 flex items-center justify-center text-[10px] font-black shrink-0">
                  {idx + 1}
                </span>
                <span>{BLOCKER_LABELS[b] || b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quota & Timezone Section */}
      {dashboard && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quota Card */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Consommation du Quota Journalier</h3>
                <p className="text-xs text-slate-500">
                  Business Date : <span className="font-bold text-slate-800">{dashboard.business_date}</span>
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <label htmlFor="business-date-input" className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Date métier du quota :</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="business-date-input"
                    type="date"
                    value={selectedBusinessDate}
                    onChange={handleBusinessDateChange}
                    className="px-2.5 py-1 text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                  />
                  {dateLoading && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  )}
                </div>
              </div>
            </div>

            {/* Date Error Banner with Retry Button */}
            {dateErrorMsg && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-3 text-rose-900 text-xs font-bold">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{dateErrorMsg}</span>
                </div>
                <button
                  onClick={() => fetchDashboardForDate(selectedBusinessDate || null)}
                  className="px-3 py-1 bg-rose-600 text-white rounded-lg text-[11px] font-extrabold hover:bg-rose-700 transition cursor-pointer shrink-0"
                >
                  Réessayer
                </button>
              </div>
            )}

            {/* Quota Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-extrabold">
                <span className="text-slate-600">Quota Utilisé : {usedCount} / {dailyLimit} e-mails</span>
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-black ${usedPercentage >= 90 ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'}`}>
                  {usedPercentage}%
                </span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div
                  className={`h-full transition-all duration-300 ${usedPercentage >= 90 ? 'bg-rose-500' : 'bg-blue-600'}`}
                  style={{ width: `${usedPercentage}%` }}
                />
              </div>
            </div>

            {/* Quota Counters breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 block">Limite Totale</span>
                <span className="text-lg font-black text-slate-900">{dailyLimit}</span>
              </div>
              <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200">
                <span className="text-[11px] font-bold text-amber-800 block">Réservés</span>
                <span className="text-lg font-black text-amber-900">{reservedCount}</span>
              </div>
              <div className="bg-indigo-50/70 p-3 rounded-xl border border-indigo-200">
                <span className="text-[11px] font-bold text-indigo-800 block">Soumis</span>
                <span className="text-lg font-black text-indigo-900">{submittedCount}</span>
              </div>
              <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200">
                <span className="text-[11px] font-bold text-emerald-800 block">Disponibles</span>
                <span className="text-lg font-black text-emerald-900">{remainingCount}</span>
              </div>
            </div>
          </div>

          {/* Timezone Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-3">
                Fuseau Horaire de l'Établissement
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-500">Timezone active :</span>
                  <span className="font-black text-slate-900 px-2.5 py-1 bg-slate-100 rounded-lg border border-slate-200">
                    {dashboard.timezone}
                  </span>
                </div>
                {dashboard.timezone_fallback_applied && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs font-bold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>Attention : timezone école invalide, fallback Africa/Kinshasa appliqué.</span>
                  </div>
                )}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-500">
              <p>Le quota se réinitialise à minuit selon l'heure locale de l'établissement.</p>
            </div>
          </div>
        </div>
      )}

      {/* Campaigns Summary Section */}
      {dashboard && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-3">
            Synthèse des Campagnes REAL
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="bg-slate-900 text-white p-3 rounded-xl shadow-2xs">
              <span className="text-[11px] font-bold opacity-80 block">Total REAL</span>
              <span className="text-lg font-black">{dashboard.campaigns.real_total_count}</span>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 block">Brouillons</span>
              <span className="text-lg font-black text-slate-800">{dashboard.campaigns.draft_count}</span>
            </div>
            <div className="bg-blue-50 p-3 rounded-xl border border-blue-200">
              <span className="text-[11px] font-bold text-blue-700 block">Planifiées</span>
              <span className="text-lg font-black text-blue-900">{dashboard.campaigns.scheduled_count}</span>
            </div>
            <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
              <span className="text-[11px] font-bold text-amber-800 block">En cours</span>
              <span className="text-lg font-black text-amber-900">{dashboard.campaigns.processing_count}</span>
            </div>
            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
              <span className="text-[11px] font-bold text-emerald-700 block">Terminées</span>
              <span className="text-lg font-black text-emerald-900">{dashboard.campaigns.completed_count}</span>
            </div>
            <div className="bg-orange-50 p-3 rounded-xl border border-orange-200">
              <span className="text-[11px] font-bold text-orange-800 block">Partielles</span>
              <span className="text-lg font-black text-orange-900">{dashboard.campaigns.partially_failed_count}</span>
            </div>
            <div className="bg-rose-50 p-3 rounded-xl border border-rose-200">
              <span className="text-[11px] font-bold text-rose-700 block">Échouées</span>
              <span className="text-lg font-black text-rose-900">{dashboard.campaigns.failed_count}</span>
            </div>
            <div className="bg-slate-100 p-3 rounded-xl border border-slate-300">
              <span className="text-[11px] font-bold text-slate-600 block">Annulées</span>
              <span className="text-lg font-black text-slate-700">{dashboard.campaigns.cancelled_count}</span>
            </div>
          </div>
        </div>
      )}

      {/* Jobs Outbox Summary Section */}
      {dashboard && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-3">
            États des Jobs Outbox (10 Compteurs)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-slate-100 p-3.5 rounded-xl border border-slate-300">
              <span className="text-[11px] font-bold text-slate-600 block">Total Jobs</span>
              <span className="text-lg font-black text-slate-900">{dashboard.jobs.total_count}</span>
            </div>
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 block">En attente</span>
              <span className="text-lg font-black text-slate-800">{dashboard.jobs.pending_count}</span>
            </div>
            <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-200">
              <span className="text-[11px] font-bold text-blue-700 block">Réclamés</span>
              <span className="text-lg font-black text-blue-900">{dashboard.jobs.claimed_count}</span>
            </div>
            <div className="bg-indigo-50 p-3.5 rounded-xl border border-indigo-200">
              <span className="text-[11px] font-bold text-indigo-700 block">Soumis</span>
              <span className="text-lg font-black text-indigo-900">{dashboard.jobs.submitted_count}</span>
            </div>
            <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200">
              <span className="text-[11px] font-bold text-emerald-700 block">Livrés</span>
              <span className="text-lg font-black text-emerald-900">{dashboard.jobs.delivery_confirmed_count}</span>
            </div>

            {/* Highlighted alert counters */}
            <div className="bg-amber-100 border-2 border-amber-400 p-3.5 rounded-xl shadow-xs">
              <span className="text-[11px] font-black text-amber-950 uppercase tracking-wider block">Réseau incertain</span>
              <span className="text-xl font-black text-amber-950">{dashboard.jobs.network_unknown_count}</span>
            </div>
            <div className="bg-orange-50 p-3.5 rounded-xl border border-orange-200">
              <span className="text-[11px] font-bold text-orange-800 block">Nouvel essai</span>
              <span className="text-lg font-black text-orange-900">{dashboard.jobs.retry_wait_count}</span>
            </div>
            <div className="bg-rose-100 border-2 border-rose-400 p-3.5 rounded-xl shadow-xs">
              <span className="text-[11px] font-black text-rose-950 uppercase tracking-wider block">Échec définitif</span>
              <span className="text-xl font-black text-rose-950">{dashboard.jobs.terminal_failed_count}</span>
            </div>
            <div className="bg-red-100 border-2 border-red-400 p-3.5 rounded-xl shadow-xs">
              <span className="text-[11px] font-black text-red-950 uppercase tracking-wider block">Rebonds</span>
              <span className="text-xl font-black text-red-950">{dashboard.jobs.bounced_count}</span>
            </div>
            <div className="bg-purple-100 border-2 border-purple-400 p-3.5 rounded-xl shadow-xs">
              <span className="text-[11px] font-black text-purple-950 uppercase tracking-wider block">Plaintes</span>
              <span className="text-xl font-black text-purple-950">{dashboard.jobs.complained_count}</span>
            </div>
          </div>
        </div>
      )}

      {/* Paginated Jobs Table Section */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-3">
          <h3 className="text-sm font-extrabold text-slate-900">
            Journal Paginé des Jobs de Livraison ({jobs.length} affiché{jobs.length > 1 ? 's' : ''})
          </h3>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label htmlFor="job-status-filter" className="text-xs font-bold text-slate-600 flex items-center gap-1 shrink-0">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Filtrer par état :</span>
            </label>
            <select
              id="job-status-filter"
              value={selectedStatus}
              onChange={handleFilterStatusChange}
              className="w-full sm:w-auto px-3 py-1.5 text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden cursor-pointer"
            >
              <option value="all">Tous les états</option>
              <option value="pending">En attente (pending)</option>
              <option value="claimed">Réclamé (claimed)</option>
              <option value="submitted">Soumis (submitted)</option>
              <option value="network_unknown">Réseau incertain (network_unknown)</option>
              <option value="retry_wait">Nouvel essai planifié (retry_wait)</option>
              <option value="terminal_failed">Échec définitif (terminal_failed)</option>
              <option value="delivery_confirmed">Livré (delivery_confirmed)</option>
              <option value="bounced">Rebond (bounced)</option>
              <option value="complained">Plainte (complained)</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-extrabold uppercase tracking-wider">
              <tr>
                <th className="p-3">Campagne</th>
                <th className="p-3">Facture</th>
                <th className="p-3">Élève</th>
                <th className="p-3">État</th>
                <th className="p-3 text-center">Tentatives</th>
                <th className="p-3">Première tentative</th>
                <th className="p-3">Dernière tentative</th>
                <th className="p-3 text-center">Msg Enregistré</th>
                <th className="p-3">Prochain Essai</th>
                <th className="p-3">Code Erreur</th>
                <th className="p-3">Créé le</th>
                <th className="p-3">Mis à jour le</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-500 font-bold">
                    Aucun job de livraison e-mail correspondant au filtre sélectionné.
                  </td>
                </tr>
              ) : (
                jobs.map(job => (
                  <tr key={job.job_id} className="hover:bg-slate-50/80 transition">
                    <td className="p-3 font-bold text-slate-900">{job.campaign_name}</td>
                    <td className="p-3 font-mono font-bold text-blue-700">{job.invoice_number}</td>
                    <td className="p-3 font-medium text-slate-800">{job.student_name}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${JOB_STATUS_BADGE_CLASSES[job.status] || 'bg-slate-100 text-slate-700 border-slate-300'}`}>
                        {JOB_STATUS_LABELS[job.status] || job.status}
                      </span>
                    </td>
                    <td className="p-3 text-center font-extrabold text-slate-800">{job.attempt_count}</td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">
                      {job.first_provider_attempt_at ? new Date(job.first_provider_attempt_at).toLocaleString('fr-FR') : '—'}
                    </td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">
                      {job.last_provider_attempt_at ? new Date(job.last_provider_attempt_at).toLocaleString('fr-FR') : '—'}
                    </td>
                    <td className="p-3 text-center">
                      {job.provider_message_recorded ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Oui
                        </span>
                      ) : (
                        <span className="text-slate-400 font-medium">Non</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">
                      {job.next_attempt_at ? new Date(job.next_attempt_at).toLocaleString('fr-FR') : '—'}
                    </td>
                    <td className="p-3 font-mono text-[11px] text-rose-700 font-bold">
                      {job.last_error_code || '—'}
                    </td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">
                      {new Date(job.created_at).toLocaleString('fr-FR')}
                    </td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">
                      {new Date(job.updated_at).toLocaleString('fr-FR')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Load More Button */}
        {hasMoreJobs && (
          <div className="pt-2 flex justify-center">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300 rounded-xl text-xs font-extrabold transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-600" />
                  <span>Chargement de la page suivante...</span>
                </>
              ) : (
                <span>Charger davantage</span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* REAL Email Campaign Wizard Modal */}
      <RealEmailCampaignWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        readiness={readiness}
        onSuccess={() => handleGlobalRefresh(true)}
      />
    </div>
  );
};
