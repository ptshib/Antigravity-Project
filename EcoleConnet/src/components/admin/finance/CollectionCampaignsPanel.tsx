import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getCollectionCampaigns,
  scheduleCollectionCampaign,
  cancelCollectionCampaign
} from '../../../services/financeService';
import type {
  CollectionCampaignSummary,
  CampaignStatus,
  CampaignChannel,
  CampaignFilters,
  CampaignCursor
} from '../../../types/finance';
import { CollectionCampaignWizard } from './CollectionCampaignWizard';
import { CollectionCampaignDetailModal } from './CollectionCampaignDetailModal';

function renderStatusBadge(status: CampaignStatus): React.ReactElement {
  const styles: Record<CampaignStatus, string> = {
    draft: 'bg-gray-100 text-gray-800 border-gray-300',
    scheduled: 'bg-blue-100 text-blue-800 border-blue-300',
    processing: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    completed: 'bg-green-100 text-green-800 border-green-300',
    partially_failed: 'bg-orange-100 text-orange-800 border-orange-300',
    failed: 'bg-red-100 text-red-800 border-red-300',
    cancelled: 'bg-gray-200 text-gray-600 border-gray-300'
  };

  const labels: Record<CampaignStatus, string> = {
    draft: 'Brouillon',
    scheduled: 'Planifiée',
    processing: 'En cours',
    completed: 'Terminée',
    partially_failed: 'Partiellement échouée',
    failed: 'Échouée',
    cancelled: 'Annulée'
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] || styles.draft}`}>
      {labels[status] || status}
    </span>
  );
}

export const CollectionCampaignsPanel: React.FC = () => {
  const [campaigns, setCampaigns] = useState<CollectionCampaignSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'ALL'>('ALL');
  const [channelFilter, setChannelFilter] = useState<CampaignChannel | 'ALL'>('ALL');

  const [hasMore, setHasMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<CampaignCursor | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  const [selectedDetailCampaignId, setSelectedDetailCampaignId] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const reqIdRef = useRef<number>(0);
  const isMutatingLockRef = useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadCampaigns = useCallback(
    async (cursor?: CampaignCursor | null, append = false) => {
      const currentReqId = ++reqIdRef.current;
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      try {
        const filters: CampaignFilters = {
          p_status: statusFilter,
          p_channel: channelFilter,
          p_limit: 20
        };

        const res = await getCollectionCampaigns(filters, cursor);
        if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;

        if (append) {
          setCampaigns((prev) => [...prev, ...res.campaigns]);
        } else {
          setCampaigns(res.campaigns);
        }

        setHasMore(res.has_more);
        if (res.has_more && res.next_cursor_created_at && res.next_cursor_id) {
          setNextCursor({
            created_at: res.next_cursor_created_at,
            id: res.next_cursor_id
          });
        } else {
          setNextCursor(null);
        }
      } catch (err: unknown) {
        if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;
        const msg = err instanceof Error ? err.message : 'Erreur lors du chargement des campagnes.';
        setError(msg);
      } finally {
        if (isMountedRef.current && currentReqId === reqIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [statusFilter, channelFilter]
  );

  // Filter change resets list and cursor
  useEffect(() => {
    loadCampaigns(null, false);
  }, [loadCampaigns]);

  // Action: Schedule
  const handleSchedule = async (campaignId: string) => {
    if (isMutatingLockRef.current) return;
    isMutatingLockRef.current = true;
    setActionLoadingId(campaignId);
    setError(null);

    try {
      await scheduleCollectionCampaign(campaignId);
      if (!isMountedRef.current) return;
      // Refresh campaign list
      await loadCampaigns(null, false);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Erreur lors de la planification.';
      setError(msg);
    } finally {
      isMutatingLockRef.current = false;
      if (isMountedRef.current) {
        setActionLoadingId(null);
      }
    }
  };

  // Action: Cancel
  const handleCancel = async (campaignId: string) => {
    if (isMutatingLockRef.current) return;
    isMutatingLockRef.current = true;
    setActionLoadingId(campaignId);
    setError(null);

    try {
      await cancelCollectionCampaign(campaignId, 'Annulée par l administrateur');
      if (!isMountedRef.current) return;
      await loadCampaigns(null, false);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Erreur lors de l annulation.';
      setError(msg);
    } finally {
      isMutatingLockRef.current = false;
      if (isMountedRef.current) {
        setActionLoadingId(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Simulation Banner */}
      <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-md text-amber-800 text-sm font-medium flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xl">⚙️</span>
          <div>
            <span className="font-bold">Mode simulation MOCK actif :</span> Aucun véritable message SMS, E-mail ou WhatsApp ne sera envoyé.
            Toutes les tentatives de livraison sont exécutées en simulation déterministe locale.
          </div>
        </div>
      </div>

      {/* Control Bar: Filters & New Campaign Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="filter-status" className="block text-xs font-semibold text-gray-600 mb-1">
              Statut
            </label>
            <select
              id="filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CampaignStatus | 'ALL')}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL" className="text-slate-900 bg-white">Tous les statuts</option>
              <option value="draft" className="text-slate-900 bg-white">Brouillon</option>
              <option value="scheduled" className="text-slate-900 bg-white">Planifiée</option>
              <option value="processing" className="text-slate-900 bg-white">En cours</option>
              <option value="completed" className="text-slate-900 bg-white">Terminée</option>
              <option value="partially_failed" className="text-slate-900 bg-white">Partiellement échouée</option>
              <option value="failed" className="text-slate-900 bg-white">Échouée</option>
              <option value="cancelled" className="text-slate-900 bg-white">Annulée</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-channel" className="block text-xs font-semibold text-gray-600 mb-1">
              Canal
            </label>
            <select
              id="filter-channel"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as CampaignChannel | 'ALL')}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL" className="text-slate-900 bg-white">Tous les canaux</option>
              <option value="sms" className="text-slate-900 bg-white">SMS</option>
              <option value="email" className="text-slate-900 bg-white">E-mail</option>
              <option value="whatsapp" className="text-slate-900 bg-white">WhatsApp</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsWizardOpen(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md shadow-sm flex items-center justify-center gap-2"
        >
          <span>+</span> Nouvelle campagne
        </button>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-center justify-between" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => loadCampaigns(null, false)}
            className="ml-4 px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Campaign List */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-gray-500 text-sm" aria-busy="true">
            Chargement des campagnes de relance...
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-sm">
            Aucune campagne enregistrée pour les filtres sélectionnés.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {campaigns.map((c) => {
              const isActionBusy = actionLoadingId === c.id;

              return (
                <div key={c.id} className="p-5 hover:bg-gray-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-base font-bold text-gray-900">{c.name}</h3>
                      {renderStatusBadge(c.status)}
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs font-mono uppercase rounded">
                        {c.channel}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                      <span>Créée le : {new Date(c.created_at).toLocaleDateString('fr-FR')}</span>
                      {c.scheduled_at && (
                        <span>Planifiée : {new Date(c.scheduled_at).toLocaleString('fr-FR')}</span>
                      )}
                      {c.completed_at && (
                        <span>Terminée : {new Date(c.completed_at).toLocaleString('fr-FR')}</span>
                      )}
                    </div>

                    {/* Counter badges */}
                    <div className="flex items-center gap-2 text-xs flex-wrap pt-1">
                      <span className="font-semibold text-gray-700">Destinataires : {c.recipient_count}</span>
                      <span className="text-gray-400">|</span>
                      <span className="text-blue-700">En attente : {c.pending_count}</span>
                      <span className="text-gray-400">|</span>
                      <span className="text-green-700">Succès : {c.success_count}</span>
                      <span className="text-gray-400">|</span>
                      <span className="text-red-700">Échecs : {c.failed_count}</span>
                      <span className="text-gray-400">|</span>
                      <span className="text-purple-700">Ignorés : {c.skipped_count}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap md:flex-nowrap shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedDetailCampaignId(c.id)}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-medium rounded border border-gray-300"
                    >
                      Voir le détail
                    </button>

                    {c.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => handleSchedule(c.id)}
                        disabled={isActionBusy}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded shadow-sm disabled:opacity-50"
                      >
                        {isActionBusy ? 'En cours...' : 'Planifier'}
                      </button>
                    )}

                    {(c.status === 'draft' || c.status === 'scheduled') && (
                      <button
                        type="button"
                        onClick={() => handleCancel(c.id)}
                        disabled={isActionBusy}
                        className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-medium rounded disabled:opacity-50"
                      >
                        {isActionBusy ? 'En cours...' : 'Annuler'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className="p-4 border-t border-gray-200 text-center bg-gray-50">
            <button
              type="button"
              onClick={() => loadCampaigns(nextCursor, true)}
              disabled={isLoadingMore}
              className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded text-xs font-semibold shadow-sm disabled:opacity-50"
            >
              {isLoadingMore ? 'Chargement...' : 'Charger davantage de campagnes'}
            </button>
          </div>
        )}
      </div>

      {/* Wizard Modal */}
      {isWizardOpen && (
        <CollectionCampaignWizard
          onClose={() => setIsWizardOpen(false)}
          onCampaignCreated={(newId) => {
            setSelectedDetailCampaignId(newId);
            loadCampaigns(null, false);
          }}
        />
      )}

      {/* Detail Modal */}
      {selectedDetailCampaignId && (
        <CollectionCampaignDetailModal
          campaignId={selectedDetailCampaignId}
          onClose={() => setSelectedDetailCampaignId(null)}
        />
      )}
    </div>
  );
};
