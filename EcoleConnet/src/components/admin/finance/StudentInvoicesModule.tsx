// Fichier : src/components/admin/finance/StudentInvoicesModule.tsx
// Module de gestion et consultation des factures élèves (Émission via RPC issue_student_invoice)

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useNotifications } from '../../../context/NotificationContext';
import { issueStudentInvoice } from '../../../services/financeService';
import type { StudentInvoice, RecordPaymentResult } from '../../../types/finance';
import { FormattedAmount, InvoiceStatusBadge } from '../../common/CurrencyBadge';
import { Search, Plus, Send, CreditCard, FolderOpen } from 'lucide-react';
import { CreateDraftInvoiceModal } from './CreateDraftInvoiceModal';
import { CancelDraftInvoiceModal } from './CancelDraftInvoiceModal';
import { PaymentEntryModal } from './PaymentEntryModal';
import { PaymentReceiptModal } from './PaymentReceiptModal';
import type { PaymentReceiptData } from './PaymentReceiptModal';
import { StudentFinanceDossierModal } from './StudentFinanceDossierModal';
import { Ban } from 'lucide-react';

interface StudentInvoicesModuleProps {
  schoolId: string;
  onOpenDossier?: (studentId: string) => void;
}

export const StudentInvoicesModule: React.FC<StudentInvoicesModuleProps> = ({ schoolId, onOpenDossier }) => {
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState<boolean>(true);
  const [invoices, setInvoices] = useState<StudentInvoice[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [cancelDraftInvoice, setCancelDraftInvoice] = useState<StudentInvoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<StudentInvoice | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<PaymentReceiptData | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState<boolean>(false);
  const [dossierStudentId, setDossierStudentId] = useState<string | null>(null);

  // Issuing state
  const [issuingInvoiceId, setIssuingInvoiceId] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('student_invoices')
        .select(`
          *,
          student:students!fk_student_invoices_student(id, student_number, first_name, middle_name, last_name),
          enrollment:student_enrollments!fk_student_invoices_enrollment(class:classes(id, name))
        `)
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false });

      if (error) {
        showToast(`Erreur chargement factures : ${error.message}`, 'urgent');
      } else if (data) {
        const formatted: StudentInvoice[] = data.map((inv) => {
          const invObj = inv as Record<string, unknown>;
          const stObj = (invObj.student || invObj.students) as Record<string, unknown> | undefined;
          const enrObj = invObj.enrollment as Record<string, unknown> | undefined;
          const clsObj = (enrObj?.class || invObj.classes) as Record<string, unknown> | undefined;

          const firstName = String(stObj?.first_name || '');
          const middleName = String(stObj?.middle_name || '');
          const lastName = String(stObj?.last_name || '');
          const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ').trim() || 'Élève';

          return {
            id: String(invObj.id || ''),
            invoice_number: String(invObj.invoice_number || ''),
            school_id: String(invObj.school_id || ''),
            student_id: String(invObj.student_id || ''),
            student_name: fullName,
            student_number: String(stObj?.student_number || ''),
            class_id: (invObj.class_id as string) || null,
            class_name: String(clsObj?.name || ''),
            academic_year_id: String(invObj.academic_year_id || ''),
            issue_date: String(invObj.issue_date || ''),
            due_date: (invObj.due_date as string) || null,
            status: invObj.status as StudentInvoice['status'],
            currency: invObj.currency as StudentInvoice['currency'],
            total_amount: Number(invObj.total_amount) || 0,
            paid_amount: Number(invObj.paid_amount) || 0,
            remaining_balance: Number(invObj.remaining_balance) || 0,
            created_at: String(invObj.created_at || '')
          };
        });
        setInvoices(formatted);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    if (schoolId) {
      fetchInvoices();
    }
  }, [schoolId, fetchInvoices]);

  // Issue Draft Invoice Handler
  const handleIssueInvoice = async (invoiceId: string) => {
    setIssuingInvoiceId(invoiceId);
    try {
      const { error } = await issueStudentInvoice(invoiceId);
      if (error) {
        showToast(`Erreur émission facture : ${error.message}`, 'urgent');
      } else {
        showToast('Facture émise officiellement avec succès !', 'success');
        fetchInvoices();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
    } finally {
      setIssuingInvoiceId(null);
    }
  };

  // Payment Success Handler
  const handlePaymentSuccess = (result: RecordPaymentResult) => {
    try {
      fetchInvoices();
    } catch {
      // Ignorer l'erreur de rafraîchissement secondaire pour ne pas impacter l'affichage du reçu
    }
    const invoice = invoices.find((inv) => inv.id === result.invoice_id);

    setActiveReceipt({
      receipt_number: result.receipt_number,
      payment_number: result.payment_number,
      invoice_number: invoice?.invoice_number || '',
      student_name: invoice?.student_name || 'Élève',
      student_number: invoice?.student_number || '',
      class_name: invoice?.class_name,
      amount: result.amount,
      currency: result.currency || invoice?.currency || 'CDF',
      payment_date: result.recorded_at ? result.recorded_at.split('T')[0] : new Date().toISOString().split('T')[0],
      payment_method: result.payment_method || 'cash',
      is_idempotent_replay: result.is_idempotent_replay
    });
    setShowReceiptModal(true);
  };

  // Filtered Invoices
  const filteredInvoices = invoices.filter((inv) => {
    const matchesSearch =
      inv.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (inv.student_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (inv.student_number || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
    const matchesCurrency = currencyFilter === 'all' || inv.currency === currencyFilter;

    return matchesSearch && matchesStatus && matchesCurrency;
  });

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-3 flex-1 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="N° facture, élève, matricule..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
          >
            <option value="all">Tous les statuts</option>
            <option value="draft">Brouillon</option>
            <option value="issued">Émise (À payer)</option>
            <option value="partially_paid">Partiellement payée</option>
            <option value="paid">Totalement réglée</option>
            <option value="cancelled">Annulée</option>
          </select>

          {/* Currency Filter */}
          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
          >
            <option value="all">Toutes devises</option>
            <option value="USD">USD ($)</option>
            <option value="CDF">CDF (FC)</option>
          </select>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Créer une Facture Brouillon</span>
        </button>
      </div>

      {/* Invoices Table */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 text-sm">
          Chargement de la liste des factures...
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-500">
          Aucune facture trouvée.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase tracking-wider font-extrabold text-[10px] border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">N° Facture</th>
                  <th className="px-4 py-3">Élève</th>
                  <th className="px-4 py-3">Date Émission</th>
                  <th className="px-4 py-3 text-center">Statut</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Payé</th>
                  <th className="px-4 py-3 text-right">Reste Dû</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      {inv.invoice_number}
                    </td>

                    <td className="px-4 py-3">
                      <strong className="text-slate-900 block">{inv.student_name}</strong>
                      <span className="text-[10px] text-slate-400 font-mono">{inv.student_number} • {inv.class_name}</span>
                    </td>

                    <td className="px-4 py-3 text-slate-500">
                      {inv.issue_date}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <InvoiceStatusBadge status={inv.status} />
                    </td>

                    <td className="px-4 py-3 text-right font-extrabold text-slate-900">
                      <FormattedAmount amount={inv.total_amount} currency={inv.currency} />
                    </td>

                    <td className="px-4 py-3 text-right font-bold text-emerald-600">
                      <FormattedAmount amount={inv.paid_amount} currency={inv.currency} />
                    </td>

                    <td className="px-4 py-3 text-right font-extrabold text-amber-900">
                      <FormattedAmount amount={inv.remaining_balance} currency={inv.currency} />
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Draft -> Issue & Cancel Buttons */}
                        {inv.status === 'draft' && (
                          <>
                            <button
                              onClick={() => handleIssueInvoice(inv.id)}
                              disabled={issuingInvoiceId === inv.id}
                              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Émettre officiellement cette facture"
                            >
                              <Send className="w-3 h-3" />
                              <span>Émettre</span>
                            </button>

                            <button
                              onClick={() => setCancelDraftInvoice(inv)}
                              className="p-1 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="Annuler ce brouillon de facture"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {/* Issued / Partially Paid -> Pay Button */}
                        {(inv.status === 'issued' || inv.status === 'partially_paid') && (
                          <button
                            onClick={() => setPaymentInvoice(inv)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1 cursor-pointer"
                            title="Encaisser un paiement"
                          >
                            <CreditCard className="w-3 h-3" />
                            <span>Encaisser</span>
                          </button>
                        )}

                        {/* Dossier button */}
                        <button
                          onClick={() => {
                            if (onOpenDossier) {
                              onOpenDossier(inv.student_id);
                            } else {
                              setDossierStudentId(inv.student_id);
                            }
                          }}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition cursor-pointer"
                          title="Consulter le dossier financier complet"
                        >
                          <FolderOpen className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <CreateDraftInvoiceModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        schoolId={schoolId}
        onSuccess={() => fetchInvoices()}
      />

      <CancelDraftInvoiceModal
        isOpen={!!cancelDraftInvoice}
        onClose={() => setCancelDraftInvoice(null)}
        invoice={cancelDraftInvoice}
        onSuccess={() => fetchInvoices()}
      />

      <PaymentEntryModal
        isOpen={!!paymentInvoice}
        onClose={() => setPaymentInvoice(null)}
        invoice={paymentInvoice}
        onSuccess={handlePaymentSuccess}
      />

      <PaymentReceiptModal
        isOpen={showReceiptModal}
        onClose={() => setShowReceiptModal(false)}
        receipt={activeReceipt}
      />

      <StudentFinanceDossierModal
        isOpen={!!dossierStudentId}
        onClose={() => setDossierStudentId(null)}
        studentId={dossierStudentId}
        onRefreshParent={fetchInvoices}
        onViewReceipt={(receipt) => {
          setActiveReceipt(receipt);
          setShowReceiptModal(true);
        }}
      />
    </div>
  );
};
