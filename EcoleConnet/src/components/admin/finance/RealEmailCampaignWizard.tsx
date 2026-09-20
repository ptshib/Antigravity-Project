import React, { useState, useEffect, useRef } from 'react';
import type {
  RealEmailCampaignSummary,
  RealEmailReadinessResponse,
  CreateRealEmailCampaignRequest,
  ScheduleRealEmailCampaignRequest,
  ScheduleRealEmailCampaignResponse,
  RealEmailCampaignWizardStep,
  Currency,
  CampaignPreviewResponse,
  CampaignPriority
} from '../../../types/finance';
import {
  previewCollectionCampaign,
  createSchoolRealEmailCampaign,
  scheduleSchoolRealEmailCampaign,
  FinanceServiceError
} from '../../../services/financeService';

export interface RealEmailCampaignWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (campaign: RealEmailCampaignSummary, scheduled?: ScheduleRealEmailCampaignResponse) => void;
  readiness?: RealEmailReadinessResponse | null;
  classes?: Array<{ id: string; name: string }>;
}

const BLOCKER_TRANSLATIONS: Record<string, string> = {
  GLOBAL_KILL_SWITCH_DISABLED: 'Le switch global d’envoi d’e-mails réels est désactivé au niveau de la plateforme.',
  SENDER_IDENTITY_NOT_VERIFIED: 'L’adresse expéditeur globale (Resend) n’est pas encore vérifiée.',
  SENDER_IDENTITY_NOT_CONFIGURED: 'Aucune adresse expéditeur globale n’est configurée.',
  SCHOOL_SETTINGS_NOT_CONFIGURED: 'Les paramètres d’envoi d’e-mails de l’établissement n’ont pas été configurés.',
  SCHOOL_EMAIL_DISABLED: 'L’envoi d’e-mails réels est désactivé pour cet établissement.'
};

export function maskContact(contact: string | null | undefined): string {
  if (!contact || contact.trim() === '') return 'N/A';
  const trimmed = contact.trim();
  if (trimmed.includes('@')) {
    const parts = trimmed.split('@');
    const user = parts[0];
    const domain = parts.slice(1).join('@');
    if (user.length <= 2) {
      return `${user.charAt(0)}***@${domain}`;
    }
    return `${user.charAt(0)}***${user.charAt(user.length - 1)}@${domain}`;
  }
  if (trimmed.length > 5) {
    return `${trimmed.slice(0, 4)}*****${trimmed.slice(-3)}`;
  }
  return '*****';
}

export const RealEmailCampaignWizard: React.FC<RealEmailCampaignWizardProps> = ({
  isOpen,
  onClose,
  onSuccess,
  readiness,
  classes = []
}) => {
  const [step, setStep] = useState<RealEmailCampaignWizardStep>('parameters');

  // Parameters state
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [currency, setCurrency] = useState<Currency | ''>('');
  const [priority, setPriority] = useState<string>('');
  const [minDaysOverdue, setMinDaysOverdue] = useState<number | ''>('');
  const [maxDaysOverdue, setMaxDaysOverdue] = useState<number | ''>('');
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);

  // Preview state
  const [preview, setPreview] = useState<CampaignPreviewResponse | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Creation state
  const [createUnderstandChecked, setCreateUnderstandChecked] = useState(false);
  const [createConfirmationText, setCreateConfirmationText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdCampaign, setCreatedCampaign] = useState<RealEmailCampaignSummary | null>(null);
  const [isIdempotentReplay, setIsIdempotentReplay] = useState(false);

  // Scheduling state
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduleConfirmChecked, setScheduleConfirmChecked] = useState(false);
  const [scheduleConfirmationText, setScheduleConfirmationText] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<ScheduleRealEmailCampaignResponse | null>(null);

  // Error handling
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Async & Idempotency refs
  const idempotencyKeyRef = useRef<string>('');
  const isMountedRef = useRef(true);
  const previewReqIdRef = useRef(0);
  const previewLockRef = useRef(false);
  const createLockRef = useRef(false);
  const scheduleLockRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset or initialize idempotency key when wizard opens
  useEffect(() => {
    if (isOpen) {
      idempotencyKeyRef.current = crypto.randomUUID();
      setStep('parameters');
      setName('');
      setTemplate('Bonjour [parent_name], sauf erreur de notre part, la facture [invoice_number] de [student_name] présente un solde impayé. Merci de régulariser.');
      setCurrency('');
      setPriority('');
      setMinDaysOverdue('');
      setMaxDaysOverdue('');
      setSelectedClassIds([]);
      setPreview(null);
      setCreateUnderstandChecked(false);
      setCreateConfirmationText('');
      setCreatedCampaign(null);
      setIsIdempotentReplay(false);
      setScheduledAt('');
      setScheduleConfirmChecked(false);
      setScheduleConfirmationText('');
      setScheduleResult(null);
      setErrorMessage(null);
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard Escape handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPreviewing || isCreating || isScheduling) {
          return; // Ignore Escape during active mutation
        }
        if (createdCampaign && !scheduleResult) {
          if (window.confirm('Un brouillon REAL a été créé. Voulez-vous vraiment fermer ?')) {
            onClose();
          }
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPreviewing, isCreating, isScheduling, createdCampaign, scheduleResult, onClose]);

  if (!isOpen) return null;

  // STEP 1 -> STEP 2 (Preview)
  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (name.trim().length < 3) {
      setErrorMessage('Le nom de la campagne doit comporter au moins 3 caractères.');
      return;
    }
    if (template.trim().length < 10) {
      setErrorMessage('Le modèle de message doit comporter au moins 10 caractères.');
      return;
    }

    if (previewLockRef.current) return;
    previewLockRef.current = true;
    setIsPreviewing(true);

    const reqId = ++previewReqIdRef.current;

    try {
      const res = await previewCollectionCampaign({
        p_channel: 'email',
        p_template: template.trim(),
        p_currency: currency || null,
        p_priority: priority ? (priority as CampaignPriority) : null,
        p_min_days_overdue: minDaysOverdue !== '' ? Number(minDaysOverdue) : null,
        p_max_days_overdue: maxDaysOverdue !== '' ? Number(maxDaysOverdue) : null,
        p_class_ids: selectedClassIds.length > 0 ? selectedClassIds : null
      });

      if (!isMountedRef.current || reqId !== previewReqIdRef.current) return;

      setPreview(res);
      setStep('preview');
    } catch (err: any) {
      if (!isMountedRef.current || reqId !== previewReqIdRef.current) return;
      if (err instanceof FinanceServiceError && err.code === '42501') {
        setErrorMessage('Seul un administrateur d’établissement (school_admin) est autorisé à exécuter cette opération.');
      } else {
        setErrorMessage(err.message || 'Échec de la prévisualisation.');
      }
    } finally {
      previewLockRef.current = false;
      if (isMountedRef.current) setIsPreviewing(false);
    }
  };

  // STEP 3 (Creation REAL)
  const handleCreateDraft = async () => {
    setErrorMessage(null);

    if (!createUnderstandChecked) {
      setErrorMessage('Vous devez cocher la case de confirmation.');
      return;
    }
    if (createConfirmationText.trim() !== 'ENVOI EMAIL REEL') {
      setErrorMessage('Vous devez saisir exactement "ENVOI EMAIL REEL".');
      return;
    }
    if (!preview || preview.total_eligible_recipients <= 0) {
      setErrorMessage('Aucun destinataire éligible dans la prévisualisation.');
      return;
    }

    if (createLockRef.current) return;
    createLockRef.current = true;
    setIsCreating(true);

    const request: CreateRealEmailCampaignRequest = {
      p_name: name.trim(),
      p_template: template.trim(),
      p_idempotency_key: idempotencyKeyRef.current,
      p_currency: currency || null,
      p_priority: priority ? (priority as CampaignPriority) : null,
      p_min_days_overdue: minDaysOverdue !== '' ? Number(minDaysOverdue) : null,
      p_max_days_overdue: maxDaysOverdue !== '' ? Number(maxDaysOverdue) : null,
      p_class_ids: selectedClassIds.length > 0 ? selectedClassIds : null,
      p_confirm_real_delivery: true,
      p_confirmation_text: 'ENVOI EMAIL REEL'
    };

    try {
      const res = await createSchoolRealEmailCampaign(request);
      if (!isMountedRef.current) return;

      setCreatedCampaign(res.campaign);
      setIsIdempotentReplay(res.is_idempotent_replay);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      if (err instanceof FinanceServiceError && err.code === '42501') {
        setErrorMessage('Seul un administrateur d’établissement (school_admin) est autorisé à exécuter cette opération.');
      } else {
        setErrorMessage(err.message || 'Échec de la création de la campagne REAL.');
      }
    } finally {
      createLockRef.current = false;
      if (isMountedRef.current) setIsCreating(false);
    }
  };

  // STEP 4 (Scheduling REAL)
  const handleSchedule = async () => {
    setErrorMessage(null);

    if (!createdCampaign) {
      setErrorMessage('Aucune campagne créée à planifier.');
      return;
    }
    if (!scheduledAt) {
      setErrorMessage('Veuillez sélectionner une date et heure de planification.');
      return;
    }

    const scheduledDateMs = new Date(scheduledAt).getTime();
    const nowMs = Date.now();
    if (isNaN(scheduledDateMs) || scheduledDateMs < nowMs) {
      setErrorMessage('La date de planification ne peut pas être dans le passé.');
      return;
    }

    const maxFutureMs = nowMs + 30 * 24 * 60 * 60 * 1000;
    if (scheduledDateMs > maxFutureMs) {
      setErrorMessage('La date de planification ne peut pas dépasser 30 jours dans le futur.');
      return;
    }

    if (!scheduleConfirmChecked) {
      setErrorMessage('Vous devez cocher la case de confirmation de planification.');
      return;
    }

    if (scheduleConfirmationText.trim() !== 'ENVOI EMAIL REEL') {
      setErrorMessage('Vous devez saisir exactement "ENVOI EMAIL REEL".');
      return;
    }

    if (readiness && !readiness.effective_real_email_enabled) {
      setErrorMessage('La planification est bloquée par l’état de disponibilité du service.');
      return;
    }

    if (scheduleLockRef.current) return;
    scheduleLockRef.current = true;
    setIsScheduling(true);

    const isoDateString = new Date(scheduledAt).toISOString();

    const request: ScheduleRealEmailCampaignRequest = {
      p_campaign_id: createdCampaign.id,
      p_scheduled_at: isoDateString,
      p_confirm_real_delivery: true,
      p_confirmation_text: 'ENVOI EMAIL REEL'
    };

    try {
      const res = await scheduleSchoolRealEmailCampaign(request);
      if (!isMountedRef.current) return;

      setScheduleResult(res);
      if (onSuccess) {
        onSuccess({ ...createdCampaign, status: 'scheduled', scheduled_at: res.scheduled_at }, res);
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      if (err instanceof FinanceServiceError && err.code === '42501') {
        setErrorMessage('Seul un administrateur d’établissement (school_admin) est autorisé à exécuter cette opération.');
      } else if (err instanceof FinanceServiceError && err.code === '22023' && err.message.includes('readiness')) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(err.message || 'Échec de la planification de la campagne REAL.');
      }
    } finally {
      scheduleLockRef.current = false;
      if (isMountedRef.current) setIsScheduling(false);
    }
  };

  const handleCloseModal = () => {
    if (createdCampaign && !scheduleResult) {
      if (!window.confirm('Un brouillon REAL a été créé mais n’est pas planifié. Voulez-vous quitter ?')) {
        return;
      }
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="real-campaign-wizard-title"
      aria-busy={isPreviewing || isCreating || isScheduling}
    >
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <span className="inline-block px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 rounded border border-amber-500/30 mb-1">
              Mode E-mail REAL
            </span>
            <h2
              id="real-campaign-wizard-title"
              ref={titleRef}
              tabIndex={-1}
              className="text-xl font-bold text-white outline-none"
            >
              Création et Planification de Campagne REAL
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            disabled={isPreviewing || isCreating || isScheduling}
            className="text-slate-400 hover:text-white p-2 rounded-lg transition-colors focus:ring-2 focus:ring-amber-500 focus:outline-none"
            aria-label="Fermer le wizard"
          >
            ✕
          </button>
        </div>

        {/* Global Permanent Warning Banner */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-start gap-3">
          <span className="text-amber-600 text-lg font-bold">⚠️</span>
          <p className="text-xs font-medium text-amber-900 leading-relaxed">
            <strong>Mode E-MAIL RÉEL</strong> — après planification et activation du service, de véritables e-mails pourront être envoyés aux parents éligibles. Aucune action directe d’envoi n’est déclenchée lors de la création du brouillon.
          </p>
        </div>

        {/* Wizard Stepper Header */}
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center justify-between text-xs font-medium text-slate-500">
          <div className={`flex items-center gap-1.5 ${step === 'parameters' ? 'text-amber-600 font-bold' : ''}`}>
            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">1</span>
            <span>Paramètres</span>
          </div>
          <span>→</span>
          <div className={`flex items-center gap-1.5 ${step === 'preview' ? 'text-amber-600 font-bold' : ''}`}>
            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">2</span>
            <span>Prévisualisation</span>
          </div>
          <span>→</span>
          <div className={`flex items-center gap-1.5 ${step === 'confirmation' ? 'text-amber-600 font-bold' : ''}`}>
            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">3</span>
            <span>Création Brouillon</span>
          </div>
          <span>→</span>
          <div className={`flex items-center gap-1.5 ${step === 'scheduling' ? 'text-amber-600 font-bold' : ''}`}>
            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">4</span>
            <span>Planification</span>
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm font-medium flex items-center justify-between" role="alert">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-500 hover:text-red-700 font-bold text-xs ml-2"
            >
              Effacer
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6">
          {/* ÉTAPE 1 : PARAMÈTRES */}
          {step === 'parameters' && (
            <form onSubmit={handlePreview} className="space-y-4">
              <div>
                <label htmlFor="wizard-channel" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Canal de diffusion (Lecture seule)
                </label>
                <input
                  id="wizard-channel"
                  type="text"
                  readOnly
                  value="E-mail REAL"
                  className="w-full px-3 py-2 text-slate-900 bg-slate-100 border border-slate-300 rounded-lg text-sm font-semibold cursor-not-allowed"
                />
              </div>

              <div>
                <label htmlFor="wizard-name" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Nom de la campagne *
                </label>
                <input
                  id="wizard-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex: Relance Frais SdT1 2026 - REAL"
                  className="w-full px-3 py-2 text-slate-900 bg-white placeholder-slate-400 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="wizard-template" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Modèle de message e-mail *
                </label>
                <textarea
                  id="wizard-template"
                  required
                  rows={4}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  placeholder="Rédigez le texte avec variables [parent_name], [student_name], [invoice_number]..."
                  className="w-full px-3 py-2 text-slate-900 bg-white placeholder-slate-400 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="wizard-currency" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Devise ciblée (Optionnel)
                  </label>
                  <select
                    id="wizard-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency | '')}
                    className="w-full px-3 py-2 text-slate-900 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  >
                    <option value="">Toutes les devises</option>
                    <option value="USD">USD ($)</option>
                    <option value="CDF">CDF (FC)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="wizard-priority" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Priorité (Optionnel)
                  </label>
                  <select
                    id="wizard-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full px-3 py-2 text-slate-900 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  >
                    <option value="">Toutes priorités</option>
                    <option value="P1_CRITICAL">P1 — Critiques</option>
                    <option value="P2_HIGH">P2 — Haute</option>
                    <option value="P3_MEDIUM">P3 — Moyenne</option>
                    <option value="P4_LOW">P4 — Basse</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="wizard-min-days" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Retard min. (jours)
                  </label>
                  <input
                    id="wizard-min-days"
                    type="number"
                    min={0}
                    value={minDaysOverdue}
                    onChange={(e) => setMinDaysOverdue(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="ex: 7"
                    className="w-full px-3 py-2 text-slate-900 bg-white placeholder-slate-400 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="wizard-max-days" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Retard max. (jours)
                  </label>
                  <input
                    id="wizard-max-days"
                    type="number"
                    min={0}
                    value={maxDaysOverdue}
                    onChange={(e) => setMaxDaysOverdue(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="ex: 60"
                    className="w-full px-3 py-2 text-slate-900 bg-white placeholder-slate-400 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {classes.length > 0 && (
                <div>
                  <label htmlFor="wizard-classes" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Filtrer par classes (Optionnel)
                  </label>
                  <select
                    id="wizard-classes"
                    multiple
                    value={selectedClassIds}
                    onChange={(e) => {
                      const opts = Array.from(e.target.selectedOptions, (o) => o.value);
                      setSelectedClassIds(opts);
                    }}
                    className="w-full px-3 py-2 text-slate-900 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none h-24"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-semibold transition-colors focus:ring-2 focus:ring-slate-400 focus:outline-none"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isPreviewing}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold shadow transition-all focus:ring-2 focus:ring-amber-500 focus:outline-none"
                >
                  {isPreviewing ? 'Prévisualisation...' : 'Prévisualiser les destinataires →'}
                </button>
              </div>
            </form>
          )}

          {/* ÉTAPE 2 : PRÉVISUALISATION */}
          {step === 'preview' && preview && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                  <span className="text-xs text-slate-500 font-medium">Factures ciblées</span>
                  <p className="text-xl font-bold text-slate-900">{preview.target_invoices_count}</p>
                </div>
                <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 text-center">
                  <span className="text-xs text-emerald-700 font-medium">Éligibles</span>
                  <p className="text-xl font-bold text-emerald-900">{preview.total_eligible_recipients}</p>
                </div>
                <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-center">
                  <span className="text-xs text-amber-700 font-medium">Ignorés</span>
                  <p className="text-xl font-bold text-amber-900">{preview.total_skipped_recipients}</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                  <span className="text-xs text-slate-500 font-medium">Montant dû</span>
                  <p className="text-xl font-bold text-slate-900">
                    {preview.total_overdue_amount.toLocaleString()} {preview.currency || 'USD'}
                  </p>
                </div>
              </div>

              {preview.total_eligible_recipients === 0 ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-900 text-sm font-semibold text-center">
                  🚫 Aucun destinataire éligible trouvé avec ces filtres. Modifiez les paramètres pour continuer.
                </div>
              ) : (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Aperçu masqué des destinataires ({preview.preview_recipients.length})
                  </h3>
                  <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {preview.preview_recipients.map((rec, idx) => (
                      <div key={idx} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50">
                        <div>
                          <p className="font-semibold text-slate-900">{rec.student_name} ({rec.invoice_number})</p>
                          <p className="text-slate-500">Parent: {rec.parent_name}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-slate-700 font-medium">
                            {rec.is_eligible ? maskContact(rec.channel_contact) : <span className="text-amber-600 font-sans">Ignoré: {rec.skip_reason}</span>}
                          </p>
                          <p className="text-slate-500 font-bold">
                            {rec.remaining_balance} {rec.currency} ({rec.days_overdue}j)
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 flex justify-between gap-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setStep('parameters')}
                  className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-semibold transition-colors focus:ring-2 focus:ring-slate-400 focus:outline-none"
                >
                  ← Modifier les paramètres
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateUnderstandChecked(false);
                    setCreateConfirmationText('');
                    setStep('confirmation');
                  }}
                  disabled={preview.total_eligible_recipients === 0}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold shadow transition-all focus:ring-2 focus:ring-amber-500 focus:outline-none"
                >
                  Continuer vers la confirmation →
                </button>
              </div>
            </div>
          )}

          {/* ÉTAPE 3 : CONFIRMATION DE CRÉATION REAL */}
          {step === 'confirmation' && (
            <div className="space-y-6">
              {!createdCampaign ? (
                <>
                  {readiness && !readiness.effective_real_email_enabled && (
                    <div className="p-4 bg-red-50 border border-red-300 rounded-xl space-y-2">
                      <h3 className="text-sm font-bold text-red-900 flex items-center gap-2">
                        <span>⛔</span>
                        <span>Création de brouillon désactivée par la disponibilité du service</span>
                      </h3>
                      <p className="text-xs text-red-800 font-medium leading-relaxed">
                        La création est désactivée car aucun parcours de reprise des brouillons n’est disponible pour le moment.
                      </p>
                      <ul className="text-xs text-red-800 list-disc list-inside space-y-1 font-medium">
                        {readiness.blockers.map((b) => (
                          <li key={b}>{BLOCKER_TRANSLATIONS[b] || b}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2">
                    <h3 className="text-sm font-bold text-amber-900">Confirmation de création de brouillon REAL</h3>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      La création générera un brouillon officiel au mode de livraison REAL. Aucun message ne sera envoyé tant que la campagne ne sera pas planifiée et que le service ne sera pas activé.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <input
                        id="wizard-create-check"
                        type="checkbox"
                        checked={createUnderstandChecked}
                        onChange={(e) => setCreateUnderstandChecked(e.target.checked)}
                        className="mt-1 w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500"
                      />
                      <label htmlFor="wizard-create-check" className="text-sm text-slate-800 font-medium cursor-pointer">
                        Je comprends que cette campagne est une campagne e-mail REAL.
                      </label>
                    </div>

                    <div>
                      <label htmlFor="wizard-create-confirm-text" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                        Saisie de confirmation manuelle (Tapez exactement : <span className="font-mono text-red-600 font-bold">ENVOI EMAIL REEL</span>) *
                      </label>
                      <input
                        id="wizard-create-confirm-text"
                        type="text"
                        value={createConfirmationText}
                        onChange={(e) => setCreateConfirmationText(e.target.value)}
                        placeholder="ENVOI EMAIL REEL"
                        className="w-full px-3 py-2 text-slate-900 bg-white placeholder-slate-400 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-4 flex justify-between gap-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => setStep('preview')}
                      disabled={isCreating}
                      className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-semibold transition-colors focus:ring-2 focus:ring-slate-400 focus:outline-none"
                    >
                      ← Revenir à la prévisualisation
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateDraft}
                      disabled={
                        !createUnderstandChecked ||
                        createConfirmationText.trim() !== 'ENVOI EMAIL REEL' ||
                        !preview ||
                        preview.total_eligible_recipients === 0 ||
                        isCreating ||
                        Boolean(readiness && !readiness.effective_real_email_enabled)
                      }
                      className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold shadow-md transition-all focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    >
                      {isCreating ? 'Création en cours...' : 'Créer le brouillon REAL'}
                    </button>
                  </div>
                </>
              ) : (
                /* Post-creation success state */
                <div className="space-y-6">
                  <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl space-y-2">
                    <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                      <span>✅</span>
                      <span>Brouillon REAL créé avec succès !</span>
                    </h3>
                    <div className="text-xs text-emerald-800 space-y-1 font-mono">
                      <p>Identifiant : <strong>{createdCampaign.id}</strong></p>
                      <p>Statut : <strong>{createdCampaign.status}</strong></p>
                      <p>Mode : <strong>{createdCampaign.delivery_mode}</strong></p>
                      {isIdempotentReplay && (
                        <p className="text-amber-700 font-sans font-bold">ℹ️ Résultat d’un rejeu idempotent.</p>
                      )}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed">
                    Aucune planification n’a été déclenchée automatiquement. Vous pouvez maintenant passer à la dernière étape pour planifier l’envoi.
                  </div>

                  <div className="pt-4 flex justify-end gap-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleConfirmChecked(false);
                        setScheduleConfirmationText('');
                        setStep('scheduling');
                      }}
                      className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-bold shadow-md transition-all focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    >
                      Passer à la planification →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ÉTAPE 4 : PLANIFICATION */}
          {step === 'scheduling' && createdCampaign && (
            <div className="space-y-6">
              {readiness && !readiness.effective_real_email_enabled && (
                <div className="p-4 bg-red-50 border border-red-300 rounded-xl space-y-2">
                  <h3 className="text-sm font-bold text-red-900 flex items-center gap-2">
                    <span>⛔</span>
                    <span>La planification est actuellement bloquée</span>
                  </h3>
                  <ul className="text-xs text-red-800 list-disc list-inside space-y-1 font-medium">
                    {readiness.blockers.map((b) => (
                      <li key={b}>{BLOCKER_TRANSLATIONS[b] || b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!scheduleResult ? (
                <>
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-xs text-amber-900 leading-relaxed">
                      <strong>Avertissement</strong> : Cette action planifie une campagne REAL. Elle ne déclenche pas immédiatement le worker depuis votre navigateur. Le brouillon passera au statut <span className="font-bold font-mono">scheduled</span>.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="wizard-scheduled-at" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                        Date et heure de planification *
                      </label>
                      <input
                        id="wizard-scheduled-at"
                        type="datetime-local"
                        required
                        disabled={readiness ? !readiness.effective_real_email_enabled : false}
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="w-full px-3 py-2 text-slate-900 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        La date doit être comprise entre maintenant et 30 jours au plus tard.
                      </p>
                    </div>

                    <div className="flex items-start gap-3">
                      <input
                        id="wizard-schedule-check"
                        type="checkbox"
                        disabled={readiness ? !readiness.effective_real_email_enabled : false}
                        checked={scheduleConfirmChecked}
                        onChange={(e) => setScheduleConfirmChecked(e.target.checked)}
                        className="mt-1 w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500"
                      />
                      <label htmlFor="wizard-schedule-check" className="text-sm text-slate-800 font-medium cursor-pointer">
                        Je confirme la planification de cette campagne e-mail REAL.
                      </label>
                    </div>

                    <div>
                      <label htmlFor="wizard-schedule-confirm-text" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                        Saisie de confirmation manuelle (Tapez exactement : <span className="font-mono text-red-600 font-bold">ENVOI EMAIL REEL</span>) *
                      </label>
                      <input
                        id="wizard-schedule-confirm-text"
                        type="text"
                        disabled={readiness ? !readiness.effective_real_email_enabled : false}
                        value={scheduleConfirmationText}
                        onChange={(e) => setScheduleConfirmationText(e.target.value)}
                        placeholder="ENVOI EMAIL REEL"
                        className="w-full px-3 py-2 text-slate-900 bg-white placeholder-slate-400 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-4 flex justify-between gap-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => setStep('confirmation')}
                      disabled={isScheduling}
                      className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-semibold transition-colors focus:ring-2 focus:ring-slate-400 focus:outline-none"
                    >
                      ← Revenir au brouillon
                    </button>
                    <button
                      type="button"
                      onClick={handleSchedule}
                      disabled={
                        !scheduledAt ||
                        !scheduleConfirmChecked ||
                        scheduleConfirmationText.trim() !== 'ENVOI EMAIL REEL' ||
                        isScheduling ||
                        Boolean(readiness && !readiness.effective_real_email_enabled)
                      }
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold shadow-md transition-all focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    >
                      {isScheduling ? 'Planification en cours...' : 'Planifier l’envoi REAL'}
                    </button>
                  </div>
                </>
              ) : (
                /* Scheduling Success State */
                <div className="space-y-6">
                  <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl space-y-3">
                    <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                      <span>🎉</span>
                      <span>Campagne REAL planifiée avec succès !</span>
                    </h3>
                    <div className="text-xs text-emerald-800 space-y-1 font-mono">
                      <p>Statut : <strong>{scheduleResult.status}</strong></p>
                      <p>Date planifiée : <strong>{new Date(scheduleResult.scheduled_at).toLocaleString()}</strong></p>
                    </div>
                    <div className="p-3 bg-white rounded-lg border border-emerald-200 text-xs font-semibold text-emerald-900">
                      Aucun message n’a été envoyé par cette action de planification.
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end gap-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold shadow transition-all focus:ring-2 focus:ring-slate-400 focus:outline-none"
                    >
                      Fermer le wizard
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
