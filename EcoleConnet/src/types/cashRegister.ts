// Fichier : src/types/cashRegister.ts
// Interfaces TypeScript et contrats stricts pour le Module Caisse & Encaissements (Lot 2K-FIN-CASH-F-V2)

export type CashJournalEventType = 'collection' | 'cancellation';

export type CashJournalPaymentMethod =
  | 'cash'
  | 'bank_transfer'
  | 'bank_deposit'
  | 'check'
  | 'mobile_money_manual'
  | 'other';

export type CashJournalFeeType =
  | 'inscription'
  | 'minerval'
  | 'transport'
  | 'cantine'
  | 'uniforme'
  | 'activites'
  | 'frais_etat'
  | 'autre';

export interface CategoryAllocation {
  fee_type: string;
  amount: number;
  allocated_percentage: number;
}

export interface CashJournalEntry {
  event_type: CashJournalEventType;
  event_date: string;
  payment_number: string;
  receipt_number: string | null;
  receipt_is_cancelled: boolean;
  payment_status: string;
  invoice_number: string;
  student_matricule: string;
  student_name: string;
  class_name: string;
  cashier_name: string;
  amount: number;
  currency: 'USD' | 'CDF';
  payment_method: CashJournalPaymentMethod;
  payment_reference: string | null;
  payer_name: string | null;
  cancellation_reason: string | null;
  category_allocations: CategoryAllocation[];
}

export interface PaymentMethodAggregate {
  gross: number;
  cancelled: number;
  net: number;
  collections_count: number;
  cancellations_count: number;
}

export interface CategoryAggregate {
  fee_type: string;
  gross_collected: number;
  cancellations_amount: number;
  net_event_amount: number;
  confirmed_current_total: number;
}

export interface ClassAggregate {
  class_name: string;
  gross_collected: number;
  cancellations_amount: number;
  net_event_amount: number;
  confirmed_current_total: number;
  collections_count: number;
  cancellations_count: number;
}

export interface CurrencyCashSummary {
  gross_collected: number;
  cancellations_amount: number;
  net_event_amount: number;
  confirmed_current_total: number;
  cash_collected: number;
  cash_cancellations: number;
  cash_net_event: number;
  collections_count: number;
  cancellations_count: number;
  by_payment_method: Record<CashJournalPaymentMethod, PaymentMethodAggregate>;
  by_category: CategoryAggregate[];
  by_class: ClassAggregate[];
}

export interface CashRegisterJournalResponse {
  period: {
    start_date: string;
    end_date: string;
    school_timezone: string;
  };
  pagination: {
    page: number;
    page_size: number;
    total_records: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
  summary: {
    USD: CurrencyCashSummary;
    CDF: CurrencyCashSummary;
  };
  journal_entries: CashJournalEntry[];
  disclaimer: string;
}

export interface CashRegisterJournalFilters {
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  classId?: string | null;
  feeType?: string | null;
  paymentMethod?: string | null;
  eventType?: string | null;
  recordedBy?: string | null;
  searchQuery?: string | null;
}

export interface SchoolClassOption {
  id: string;
  name: string;
}

export interface AuthorizedCashierOption {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  full_name: string;
}
