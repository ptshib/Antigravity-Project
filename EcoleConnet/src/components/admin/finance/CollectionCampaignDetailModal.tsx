import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getCollectionCampaignDetail } from '../../../services/financeService';
import type {
  CollectionCampaignSummary,
  CollectionCampaignRecipient,
  CampaignStatus
} from '../../../types/finance';

interface CollectionCampaignDetailModalProps {
  campaignId: string;
  onClose: () => void;
}

function maskContact(contact: string): string {
  if (!contact) return 'Contact non disponible';
  const trimmed = contact.trim();
  if (trimmed.includes('@')) {
    const [local, domain] = trimmed.split('@');
    if (local.length <= 2) return `${local}***@${domain}`;
    return `${local.substring(0, 2)}***@${domain}`;
  }
  if (trimmed.length > 6) {
    return `${trimmed.substring(0, 4)}****${trimmed.substring(trimmed.length - 2)}`;
  }
  return '****';
}

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

function renderRecipientStatusBadge(status: string): React.ReactElement {
  const styles: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700 border-gray-200',
    processing: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    success: 'bg-green-100 text-green-800 border-green-300',
    failed: 'bg-red-100 text-red-800 border-red-300',
    skipped: 'bg-purple-100 text-purple-800 border-purple-300'
  };

  const labels: Record<string, string> = {
    pending: 'En attente',
    processing: 'En cours',
    success: 'Distribué (Mock)',
    failed: 'Échec (Mock)',
    skipped: 'Ignoré'
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styles[status] || styles.pending}`}>
      {labels[status] || status}
    </span>
  );
}

export const CollectionCampaignDetailModal: React.FC<CollectionCampaignDetailModalProps> = ({
  campaignId,
  onClose
}) => {
  const [campaign, setCampaign] = useState<CollectionCampaignSummary | null>(null);
  const [recipients, setRecipients] = useState<CollectionCampaignRecipient[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [nextCursorRecipientId, setNextCursorRecipientId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const reqIdRef = useRef<number>(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadDetail = useCallback(
    async (cursorRecipientId?: string | null, append = false) => {
      const currentReqId = ++reqIdRef.current;
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      try {
        const res = await getCollectionCampaignDetail(campaignId, 50, cursorRecipientId);
        if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;

        setCampaign(res.campaign);
        if (append) {
          setRecipients((prev) => [...prev, ...res.recipients]);
        } else {
          setRecipients(res.recipients);
        }
        setHasMore(res.recipients_has_more);
        setNextCursorRecipientId(res.next_cursor_recipient_id);
      } catch (err: unknown) {
        if (!isMountedRef.current || currentReqId !== reqIdRef.current) return;
        const msg = err instanceof Error ? err.message : 'Erreur lors du chargement de la campagne.';
        setError(msg);
      } finally {
        if (isMountedRef.current && currentReqId === reqIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [campaignId]
  );

  useEffect(() => {
    loadDetail(null, false);
  }, [loadDetail]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-detail-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div>
            <h2 id="campaign-detail-modal-title" className="text-xl font-bold text-gray-900">
              {campaign ? campaign.name : 'Détail de la campagne'}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Mode simulation MOCK — Aucune notification externe réelle
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none text-2xl font-semibold leading-none"
            aria-label="Fermer"
          >
            &times;
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-center justify-between" role="alert">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => loadDetail(null, false)}
                className="ml-4 px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
              >
                Réessayer
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="py-12 text-center text-gray-500" aria-busy="true">
              Chargement des détails de la campagne...
            </div>
          ) : campaign ? (
            <>
              {/* Info grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm">
                <div>
                  <span className="text-gray-500 block text-xs">Statut :</span>
                  <div className="mt-1">{renderStatusBadge(campaign.status)}</div>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Canal :</span>
                  <span className="font-semibold uppercase text-gray-800 mt-1 block">{campaign.channel}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Clé Idempotence :</span>
                  <span className="font-mono text-xs text-gray-700 mt-1 block truncate" title={campaign.idempotency_key}>
                    {campaign.idempotency_key}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Créée le :</span>
                  <span className="text-gray-800">{new Date(campaign.created_at).toLocaleString('fr-FR')}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Planifiée pour :</span>
                  <span className="text-gray-800">
                    {campaign.scheduled_at ? new Date(campaign.scheduled_at).toLocaleString('fr-FR') : 'Immédiat / Non planifiée'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Terminée le :</span>
                  <span className="text-gray-800">
                    {campaign.completed_at ? new Date(campaign.completed_at).toLocaleString('fr-FR') : 'En cours / Non terminée'}
                  </span>
                </div>
              </div>

              {/* Counter breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Compteurs des destinataires</h3>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
                  <div className="bg-gray-100 p-2 rounded">
                    <span className="text-xs text-gray-500 block">Total</span>
                    <span className="text-base font-bold text-gray-800">{campaign.recipient_count}</span>
                  </div>
                  <div className="bg-blue-50 p-2 rounded border border-blue-100">
                    <span className="text-xs text-blue-600 block">En attente</span>
                    <span className="text-base font-bold text-blue-800">{campaign.pending_count}</span>
                  </div>
                  <div className="bg-yellow-50 p-2 rounded border border-yellow-100">
                    <span className="text-xs text-yellow-600 block">En cours</span>
                    <span className="text-base font-bold text-yellow-800">{campaign.processing_count}</span>
                  </div>
                  <div className="bg-green-50 p-2 rounded border border-green-100">
                    <span className="text-xs text-green-600 block">Succès</span>
                    <span className="text-base font-bold text-green-800">{campaign.success_count}</span>
                  </div>
                  <div className="bg-red-50 p-2 rounded border border-red-100">
                    <span className="text-xs text-red-600 block">Échecs</span>
                    <span className="text-base font-bold text-red-800">{campaign.failed_count}</span>
                  </div>
                  <div className="bg-purple-50 p-2 rounded border border-purple-100">
                    <span className="text-xs text-purple-600 block">Ignorés</span>
                    <span className="text-base font-bold text-purple-800">{campaign.skipped_count}</span>
                  </div>
                </div>
              </div>

              {/* Template Raw Snapshot */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Modèle de message</h3>
                <div className="bg-gray-900 text-gray-100 p-3 rounded text-xs font-mono whitespace-pre-wrap">
                  {typeof campaign.template_snapshot?.raw === 'string'
                    ? campaign.template_snapshot.raw
                    : JSON.stringify(campaign.template_snapshot, null, 2)}
                </div>
              </div>

              {/* Recipients Table */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">
                  Destinataires ({recipients.length} / {campaign.recipient_count})
                </h3>
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">Élève</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">Parent</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">Contact</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">Statut</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">Motif skip</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">Tentatives</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {recipients.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-4 text-center text-gray-500">
                            Aucun destinataire enregistré.
                          </td>
                        </tr>
                      ) : (
                        recipients.map((r) => {
                          const studentName = typeof r.student_snapshot?.first_name === 'string'
                            ? `${r.student_snapshot.first_name} ${r.student_snapshot.last_name || ''}`
                            : 'Élève';
                          const parentName = typeof r.parent_snapshot?.first_name === 'string'
                            ? `${r.parent_snapshot.first_name} ${r.parent_snapshot.last_name || ''}`
                            : 'Parent';
                          const contact = typeof r.parent_snapshot?.channel_contact === 'string'
                            ? r.parent_snapshot.channel_contact
                            : (typeof r.parent_snapshot?.phone === 'string' ? r.parent_snapshot.phone : '');

                          return (
                            <tr key={r.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-900 font-medium">{studentName}</td>
                              <td className="px-3 py-2 text-gray-700">{parentName}</td>
                              <td className="px-3 py-2 font-mono text-gray-600">{maskContact(contact)}</td>
                              <td className="px-3 py-2">{renderRecipientStatusBadge(r.delivery_status)}</td>
                              <td className="px-3 py-2 text-gray-500">{r.skip_reason || '-'}</td>
                              <td className="px-3 py-2 text-gray-700">
                                {r.attempt_count}
                                {r.latest_attempt && (
                                  <span className="text-[10px] text-gray-400 block">
                                    {r.latest_attempt.status === 'success' ? '✓ Success' : '✗ Failed'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {hasMore && (
                  <div className="mt-3 text-center">
                    <button
                      type="button"
                      onClick={() => loadDetail(nextCursorRecipientId, true)}
                      disabled={isLoadingMore}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-md border border-gray-300 disabled:opacity-50"
                    >
                      {isLoadingMore ? 'Chargement...' : 'Charger d’autres destinataires'}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold rounded-md"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
