import React, { useState, useEffect, useRef, useCallback } from 'react';
import { previewCollectionCampaign, createCollectionCampaign } from '../../../services/financeService';
import type {
  CampaignChannel,
  Currency,
  CampaignPreviewResponse,
  CreateCampaignResponse,
  PreviewCampaignInput,
  CreateCampaignInput
} from '../../../types/finance';

interface CollectionCampaignWizardProps {
  onClose: () => void;
  onCampaignCreated: (campaignId: string) => void;
}

type WizardStep = 1 | 2 | 3;

export const CollectionCampaignWizard: React.FC<CollectionCampaignWizardProps> = ({
  onClose,
  onCampaignCreated
}) => {
  const [step, setStep] = useState<WizardStep>(1);

  // Form State
  const [name, setName] = useState<string>('');
  const [channel, setChannel] = useState<CampaignChannel>('sms');
  const [template, setTemplate] = useState<string>(
    'Bonjour {{parent_name}}, nous vous rappelons que la facture {{invoice_number}} d un montant restant dû de {{remaining_balance}} {{currency}} pour {{student_name}} est échue. Merci de procéder au paiement.'
  );
  const [currency, setCurrency] = useState<Currency | ''>('');
  const [priority, setPriority] = useState<string>('');
  const [minDaysOverdue, setMinDaysOverdue] = useState<string>('');
  const [maxDaysOverdue, setMaxDaysOverdue] = useState<string>('');

  // Execution State
  const [previewData, setPreviewData] = useState<CampaignPreviewResponse | null>(null);
  const [createdResult, setCreatedResult] = useState<CreateCampaignResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Idempotency Key (Generated ONCE per wizard session, preserved across retries)
  const idempotencyKeyRef = useRef<string>('');
  if (!idempotencyKeyRef.current) {
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  const isMountedRef = useRef<boolean>(true);
  const isSubmittingLockRef = useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting && !isLoadingPreview) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSubmitting, isLoadingPreview]);

  // Step 1 -> Step 2 (Preview)
  const handlePreview = useCallback(async () => {
    setError(null);
    if (!name.trim() || name.trim().length < 3) {
      setError('Le nom de la campagne doit contenir au moins 3 caractères.');
      return;
    }
    if (!template.trim() || template.trim().length < 10) {
      setError('Le modèle de message doit contenir au moins 10 caractères.');
      return;
    }

    const minDays = minDaysOverdue ? parseInt(minDaysOverdue, 10) : null;
    const maxDays = maxDaysOverdue ? parseInt(maxDaysOverdue, 10) : null;

    if (minDays !== null && (isNaN(minDays) || minDays < 1)) {
      setError('Le retard minimum doit être un entier >= 1.');
      return;
    }
    if (maxDays !== null && (isNaN(maxDays) || maxDays < 1)) {
      setError('Le retard maximum doit être un entier >= 1.');
      return;
    }
    if (minDays !== null && maxDays !== null && minDays > maxDays) {
      setError('Le retard minimum ne peut pas être supérieur au retard maximum.');
      return;
    }

    setIsLoadingPreview(true);
    try {
      const input: PreviewCampaignInput = {
        p_channel: channel,
        p_template: template.trim(),
        p_currency: currency ? currency : null,
        p_priority: priority ? priority : null,
        p_min_days_overdue: minDays,
        p_max_days_overdue: maxDays
      };

      const res = await previewCollectionCampaign(input);
      if (!isMountedRef.current) return;
      setPreviewData(res);
      setStep(2);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Erreur lors de la prévisualisation.');
    } finally {
      if (isMountedRef.current) {
        setIsLoadingPreview(false);
      }
    }
  }, [name, channel, template, currency, priority, minDaysOverdue, maxDaysOverdue]);

  // Step 2 -> Step 3 (Creation)
  const handleCreateCampaign = useCallback(async () => {
    if (isSubmittingLockRef.current) return;
    isSubmittingLockRef.current = true;
    setIsSubmitting(true);
    setError(null);

    const minDays = minDaysOverdue ? parseInt(minDaysOverdue, 10) : null;
    const maxDays = maxDaysOverdue ? parseInt(maxDaysOverdue, 10) : null;

    try {
      const input: CreateCampaignInput = {
        p_name: name.trim(),
        p_channel: channel,
        p_template: template.trim(),
        p_idempotency_key: idempotencyKeyRef.current,
        p_currency: currency ? currency : null,
        p_priority: priority ? priority : null,
        p_min_days_overdue: minDays,
        p_max_days_overdue: maxDays
      };

      const res = await createCollectionCampaign(input);
      if (!isMountedRef.current) return;

      setCreatedResult(res);
      setStep(3);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Erreur lors de la création de la campagne.');
    } finally {
      isSubmittingLockRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [name, channel, template, currency, priority, minDaysOverdue, maxDaysOverdue]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-blue-50">
          <div>
            <h2 id="wizard-modal-title" className="text-xl font-bold text-blue-900">
              Nouvelle campagne de relance (Mode MOCK)
            </h2>
            <p className="text-xs text-blue-700 mt-0.5">
              Étape {step} sur 3 — {step === 1 ? 'Paramètres' : step === 2 ? 'Prévisualisation' : 'Confirmation'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isLoadingPreview}
            className="text-gray-400 hover:text-gray-600 text-2xl font-semibold leading-none disabled:opacity-50"
            aria-label="Fermer"
          >
            &times;
          </button>
        </div>

        {/* Banner Mock Simulation */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-800 font-medium flex items-center gap-2">
          <span>⚠️</span>
          <span>
            Mode simulation déterministe MOCK — Aucun message SMS, E-mail ou WhatsApp réel ne sera transmis.
          </span>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-700" role="alert">
              {error}
            </div>
          )}

          {/* STEP 1 : PARAMÈTRES */}
          {step === 1 && (
            <div className="space-y-4 text-sm">
              <div>
                <label htmlFor="campaign-name" className="block font-semibold text-gray-700 mb-1">
                  Nom de la campagne *
                </label>
                <input
                  id="campaign-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex: Relance Impayés Mars 2026 - SMS"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="campaign-channel" className="block font-semibold text-gray-700 mb-1">
                  Canal de diffusion *
                </label>
                <select
                  id="campaign-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as CampaignChannel)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="sms">SMS (Simulé MOCK)</option>
                  <option value="email">E-mail (Simulé MOCK)</option>
                  <option value="whatsapp">WhatsApp (Simulé MOCK)</option>
                </select>
              </div>

              <div>
                <label htmlFor="campaign-template" className="block font-semibold text-gray-700 mb-1">
                  Modèle de message * (min 10 caractères)
                </label>
                <textarea
                  id="campaign-template"
                  rows={4}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Variables disponibles : {'{{parent_name}}'}, {'{{student_name}}'}, {'{{invoice_number}}'}, {'{{remaining_balance}}'}, {'{{currency}}'}.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="campaign-currency" className="block font-semibold text-gray-700 mb-1">
                    Devise (optionnel)
                  </label>
                  <select
                    id="campaign-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency | '')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Toutes les devises</option>
                    <option value="USD">USD</option>
                    <option value="CDF">CDF</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="campaign-priority" className="block font-semibold text-gray-700 mb-1">
                    Niveau de priorité (optionnel)
                  </label>
                  <select
                    id="campaign-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Tous les niveaux</option>
                    <option value="critical">Critique (&gt; 90 jours)</option>
                    <option value="high">Élevé (&gt; 60 jours)</option>
                    <option value="normal">Normal (&lt; 60 jours)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="min-days" className="block font-semibold text-gray-700 mb-1">
                    Retard min (jours)
                  </label>
                  <input
                    id="min-days"
                    type="number"
                    min={1}
                    value={minDaysOverdue}
                    onChange={(e) => setMinDaysOverdue(e.target.value)}
                    placeholder="ex: 15"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="max-days" className="block font-semibold text-gray-700 mb-1">
                    Retard max (jours)
                  </label>
                  <input
                    id="max-days"
                    type="number"
                    min={1}
                    value={maxDaysOverdue}
                    onChange={(e) => setMaxDaysOverdue(e.target.value)}
                    placeholder="ex: 90"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 : PRÉVISUALISATION */}
          {step === 2 && previewData && (
            <div className="space-y-4 text-sm">
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div>
                  <span className="text-xs text-blue-600 block">Factures ciblées</span>
                  <span className="text-lg font-bold text-blue-900">{previewData.target_invoices_count}</span>
                </div>
                <div>
                  <span className="text-xs text-green-600 block">Destinataires éligibles</span>
                  <span className="text-lg font-bold text-green-900">{previewData.total_eligible_recipients}</span>
                </div>
                <div>
                  <span className="text-xs text-purple-600 block">Destinataires ignorés</span>
                  <span className="text-lg font-bold text-purple-900">{previewData.total_skipped_recipients}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-600 block">Total Dû</span>
                  <span className="text-lg font-bold text-gray-900">
                    {previewData.total_overdue_amount.toLocaleString('fr-FR')} {previewData.currency || ''}
                  </span>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-800 mb-2">Aperçu des destinataires candidats</h3>
                <div className="border border-gray-200 rounded-lg max-h-60 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500">Facture</th>
                        <th className="px-3 py-2 text-left text-gray-500">Élève</th>
                        <th className="px-3 py-2 text-left text-gray-500">Parent</th>
                        <th className="px-3 py-2 text-left text-gray-500">Éligibilité</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {previewData.preview_recipients.map((rec, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-1.5 font-mono">{rec.invoice_number}</td>
                          <td className="px-3 py-1.5">{rec.student_name}</td>
                          <td className="px-3 py-1.5">{rec.parent_name}</td>
                          <td className="px-3 py-1.5">
                            {rec.is_eligible ? (
                              <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded font-medium">Éligible</span>
                            ) : (
                              <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded font-medium">
                                Ignoré ({rec.skip_reason || 'Raison inconnue'})
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 : CONFIRMATION */}
          {step === 3 && createdResult && (
            <div className="space-y-4 text-sm text-center py-4">
              <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
                ✓
              </div>
              <h3 className="text-lg font-bold text-gray-900">
                Brouillon de campagne créé avec succès !
              </h3>
              <p className="text-gray-600 max-w-md mx-auto">
                La campagne <span className="font-semibold">{createdResult.campaign.name}</span> a été enregistrée en statut <span className="font-semibold text-gray-800">brouillon</span>.
              </p>
              <div className="bg-gray-50 p-4 rounded-md border border-gray-200 text-xs text-left max-w-md mx-auto space-y-1">
                <div><span className="font-semibold text-gray-700">ID Campagne :</span> {createdResult.campaign.id}</div>
                <div><span className="font-semibold text-gray-700">Destinataires :</span> {createdResult.campaign.recipient_count}</div>
                <div><span className="font-semibold text-gray-700">Mode :</span> Simulation Mock (Aucun envoi réel)</div>
                <div><span className="font-semibold text-gray-700">Rejeu Idempotent :</span> {createdResult.is_idempotent_replay ? 'Oui' : 'Non'}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isLoadingPreview}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded-md disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={isLoadingPreview}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md shadow-sm disabled:opacity-50"
              >
                {isLoadingPreview ? 'Prévisualisation en cours...' : 'Prévisualiser la campagne'}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded-md disabled:opacity-50"
              >
                Retour aux paramètres
              </button>
              <button
                type="button"
                onClick={handleCreateCampaign}
                disabled={isSubmitting}
                className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-md shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? 'Création en cours...' : 'Créer le brouillon de campagne'}
              </button>
            </>
          )}

          {step === 3 && createdResult && (
            <div className="w-full flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold rounded-md"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => {
                  onCampaignCreated(createdResult.campaign.id);
                  onClose();
                }}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md shadow-sm"
              >
                Voir le détail de la campagne
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
