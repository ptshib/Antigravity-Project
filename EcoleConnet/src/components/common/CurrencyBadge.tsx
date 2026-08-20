// Fichier : src/components/common/CurrencyBadge.tsx
// Composant réutilisable pour le badge de statut de facture et d'affichage des montants

import React from 'react';
import type { Currency, InvoiceStatus } from '../../types/finance';
import { formatCurrency, getInvoiceStatusConfig } from '../../utils/formatters';

interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
  size?: 'sm' | 'md';
}

export const InvoiceStatusBadge: React.FC<InvoiceStatusBadgeProps> = ({ status, size = 'md' }) => {
  const config = getInvoiceStatusConfig(status);
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1.5 font-bold rounded-full border ${config.badgeClass} ${sizeClasses}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </span>
  );
};

interface FormattedAmountProps {
  amount: number | null | undefined;
  currency?: Currency;
  className?: string;
}

export const FormattedAmount: React.FC<FormattedAmountProps> = ({ amount, currency = 'USD', className = '' }) => {
  return (
    <span className={`font-mono ${className}`}>
      {formatCurrency(amount, currency)}
    </span>
  );
};
