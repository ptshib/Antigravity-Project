// Fichier : src/utils/formatters.ts
// Fonctions utilitaires de formatage des montants, devises et statuts financiers

import type { Currency, InvoiceStatus, PaymentMethod, FeeType } from '../types/finance';

/**
 * Formate un montant numérique selon la devise spécifiée (USD ou CDF).
 */
export function formatCurrency(amount: number | null | undefined, currency: Currency = 'USD'): string {
  const val = Number(amount) || 0;
  if (currency === 'CDF') {
    return new Intl.NumberFormat('fr-CD', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val) + ' CDF';
  }

  // Par défaut USD
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
}

/**
 * Retourne la configuration d'affichage visuel (libellé, couleurs Tailwind) pour un statut de facture.
 */
export function getInvoiceStatusConfig(status: InvoiceStatus): {
  label: string;
  badgeClass: string;
  dotClass: string;
} {
  switch (status) {
    case 'draft':
      return {
        label: 'Brouillon',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
        dotClass: 'bg-slate-400'
      };
    case 'issued':
      return {
        label: 'Émise',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
        dotClass: 'bg-blue-500'
      };
    case 'partially_paid':
      return {
        label: 'Partiellement payée',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
        dotClass: 'bg-amber-500'
      };
    case 'paid':
      return {
        label: 'Payée',
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        dotClass: 'bg-emerald-500'
      };
    case 'cancelled':
      return {
        label: 'Annulée',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        dotClass: 'bg-rose-500'
      };
    default:
      return {
        label: status,
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
        dotClass: 'bg-slate-400'
      };
  }
}

/**
 * Libellé lisible en français pour un mode de paiement.
 */
export function getPaymentMethodLabel(method: PaymentMethod | string): string {
  switch (method) {
    case 'cash':
      return 'Espèces (Caisse)';
    case 'bank_transfer':
      return 'Virement Bancaire';
    case 'mobile_money':
      return 'Mobile Money';
    case 'card':
      return 'Carte Bancaire';
    case 'check':
      return 'Chèque';
    case 'other':
      return 'Autre';
    default:
      return method;
  }
}

/**
 * Libellé lisible en français pour un type de frais scolaire.
 */
export function getFeeTypeLabel(feeType: FeeType | string): string {
  switch (feeType) {
    case 'inscription':
      return 'Frais d\'inscription';
    case 'minerval':
      return 'Minerval / Scolarité';
    case 'frais_examen':
      return 'Frais d\'examen';
    case 'uniforme':
      return 'Uniforme & Équipement';
    case 'transport':
      return 'Transport scolaire';
    case 'cantine':
      return 'Cantine / Restauration';
    case 'activite':
      return 'Activités / Sorties';
    case 'autre':
      return 'Autres frais';
    default:
      return feeType;
  }
}
