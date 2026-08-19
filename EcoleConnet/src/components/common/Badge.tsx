import React from 'react';

interface BadgeProps {
  status: 'present' | 'absent' | 'late' | 'paid' | 'pending' | 'overdue' | 'urgent' | 'important' | 'normal' | string;
  label?: string;
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({ status, label, size = 'sm' }) => {
  const sizeClasses = size === 'sm' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs';

  const getStyle = () => {
    switch (status) {
      case 'present':
      case 'paid':
      case 'success':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'late':
      case 'pending':
      case 'warning':
      case 'important':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'absent':
      case 'overdue':
      case 'urgent':
      case 'danger':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'normal':
      case 'info':
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getLabel = () => {
    if (label) return label;
    switch (status) {
      case 'present': return 'Présent(e)';
      case 'absent': return 'Absent(e)';
      case 'late': return 'En retard';
      case 'paid': return 'Payé';
      case 'pending': return 'En attente';
      case 'overdue': return 'En retard de paiement';
      case 'urgent': return 'Urgent';
      case 'important': return 'Important';
      case 'normal': return 'Information';
      default: return status;
    }
  };

  return (
    <span
      className={`inline-flex items-center font-bold rounded-full border ${sizeClasses} ${getStyle()}`}
    >
      {getLabel()}
    </span>
  );
};
