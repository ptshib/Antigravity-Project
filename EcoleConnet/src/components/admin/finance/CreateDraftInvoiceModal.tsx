// Fichier : src/components/admin/finance/CreateDraftInvoiceModal.tsx
// Modal de création de facture brouillon via RPC SECURITY DEFINER create_draft_student_invoice

import React, { useState, useEffect } from 'react';
import { Modal } from '../../common/Modal';
import { useNotifications } from '../../../context/NotificationContext';
import { supabase } from '../../../lib/supabase';
import { createDraftStudentInvoice } from '../../../services/financeService';
import type { Currency, FeeType, CreateDraftInvoiceItemInput } from '../../../types/finance';
import { Plus, Trash2, FilePlus, DollarSign } from 'lucide-react';
import { FormattedAmount } from '../../common/CurrencyBadge';

interface StudentSelectOption {
  id: string;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
  class_name?: string;
}

interface AcademicYearSelectOption {
  id: string;
  name: string;
  is_current: boolean;
}

interface SchoolFeeOption {
  id: string;
  name: string;
  fee_type: FeeType;
  currency: Currency;
  amount: number;
}

interface CreateDraftInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  schoolId: string;
  onSuccess: (invoiceId: string) => void;
}

export const CreateDraftInvoiceModal: React.FC<CreateDraftInvoiceModalProps> = ({
  isOpen,
  onClose,
  schoolId,
  onSuccess
}) => {
  const { showToast } = useNotifications();

  // Loading & Selection States
  const [loadingOptions, setLoadingOptions] = useState<boolean>(false);
  const [students, setStudents] = useState<StudentSelectOption[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearSelectOption[]>([]);
  const [catalogFees, setCatalogFees] = useState<SchoolFeeOption[]>([]);

  // Form Fields
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [notes, setNotes] = useState<string>('');
  const [items, setItems] = useState<CreateDraftInvoiceItemInput[]>([]);

  // Submitting State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Fetch student and catalog options on modal open
  useEffect(() => {
    if (!isOpen || !schoolId) return;

    const fetchOptions = async () => {
      setLoadingOptions(true);
      try {
        // Fetch Students
        const { data: stData } = await supabase
          .from('students')
          .select('id, student_number, first_name, middle_name, last_name')
          .eq('school_id', schoolId)
          .order('last_name', { ascending: true });

        if (stData) {
          setStudents(stData as StudentSelectOption[]);
        }

        // Fetch Academic Years
        const { data: ayData } = await supabase
          .from('academic_years')
          .select('id, name, is_current')
          .eq('school_id', schoolId)
          .order('starts_on', { ascending: false });

        if (ayData) {
          setAcademicYears(ayData as AcademicYearSelectOption[]);
          const currentYr = ayData.find((y) => y.is_current) || ayData[0];
          if (currentYr) {
            setSelectedAcademicYearId(currentYr.id);
          }
        }

        // Fetch Catalog Fees
        const { data: feeData } = await supabase
          .from('school_fees')
          .select('id, name, fee_type, currency, amount')
          .eq('school_id', schoolId)
          .eq('is_active', true);

        if (feeData) {
          setCatalogFees(feeData as SchoolFeeOption[]);
        }
      } catch (err) {
        console.error('Erreur chargement options facture:', err);
      } finally {
        setLoadingOptions(false);
      }
    };

    fetchOptions();
  }, [isOpen, schoolId]);

  // Handle adding an item from catalog fee
  const handleAddFeeFromCatalog = (feeId: string) => {
    const fee = catalogFees.find((f) => f.id === feeId);
    if (!fee) return;

    setItems((prev) => [
      ...prev,
      {
        fee_name: fee.name,
        fee_type: fee.fee_type,
        unit_price: Number(fee.amount),
        quantity: 1,
        school_fee_id: fee.id
      }
    ]);
  };

  // Handle adding a custom item
  const handleAddCustomItem = () => {
    setItems((prev) => [
      ...prev,
      {
        fee_name: '',
        fee_type: 'autre',
        unit_price: 0,
        quantity: 1,
        school_fee_id: null
      }
    ]);
  };

  // Handle item change
  const handleItemChange = (index: number, field: keyof CreateDraftInvoiceItemInput, value: unknown) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // Handle item deletion
  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Calculate Total
  const calculatedTotal = items.reduce((sum, item) => sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 1), 0);

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedStudentId) {
      showToast('Veuillez sélectionner un élève.', 'urgent');
      return;
    }
    if (!selectedAcademicYearId) {
      showToast('Veuillez sélectionner une année scolaire.', 'urgent');
      return;
    }
    if (items.length === 0) {
      showToast('Veuillez ajouter au moins une ligne de frais.', 'urgent');
      return;
    }

    for (let i = 0; i < items.length; i++) {
      if (!items[i].fee_name.trim()) {
        showToast(`La ligne ${i + 1} n'a pas d'intitulé.`, 'urgent');
        return;
      }
      if (items[i].unit_price < 0) {
        showToast(`La ligne ${i + 1} a un prix unitaire négatif.`, 'urgent');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const { invoiceId, error } = await createDraftStudentInvoice({
        p_student_id: selectedStudentId,
        p_academic_year_id: selectedAcademicYearId,
        p_due_date: dueDate || null,
        p_currency: currency,
        p_items: items,
        p_notes: notes || null
      });

      if (error) {
        showToast(`Erreur création facture : ${error.message}`, 'urgent');
      } else if (invoiceId) {
        showToast('Facture brouillon créée avec succès !', 'success');
        onSuccess(invoiceId);
        onClose();
        // Reset form
        setSelectedStudentId('');
        setItems([]);
        setNotes('');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Créer une Facture Brouillon"
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <p className="text-xs text-slate-500 font-medium -mt-2">
          Création sécurisée via RPC SECURITY DEFINER (Étape Brouillon)
        </p>

        {loadingOptions ? (
          <div className="py-8 text-center text-slate-500 text-sm">
            Chargement des données élèves et catalogue...
          </div>
        ) : (
          <>
            {/* Élève & Année Scolaire */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Élève à facturer <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  required
                >
                  <option value="">-- Sélectionner un élève --</option>
                  {students.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.last_name?.toUpperCase()} {st.first_name} ({st.student_number})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Année Scolaire <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedAcademicYearId}
                  onChange={(e) => setSelectedAcademicYearId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  required
                >
                  {academicYears.map((ay) => (
                    <option key={ay.id} value={ay.id}>
                      {ay.name} {ay.is_current ? '(En cours)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Date d'échéance & Devise */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Date d'échéance (optionnelle)
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Devise de la facture <span className="text-rose-500">*</span>
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="USD">USD ($)</option>
                  <option value="CDF">CDF (FC)</option>
                </select>
              </div>
            </div>

            {/* Lignes de Frais */}
            <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <FilePlus className="w-4 h-4 text-amber-600" />
                  Lignes de la Facture ({items.length})
                </h4>

                <div className="flex items-center gap-2">
                  {catalogFees.length > 0 && (
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          handleAddFeeFromCatalog(e.target.value);
                          e.target.value = '';
                        }
                      }}
                      className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      <option value="">+ Ajouter du catalogue...</option>
                      {catalogFees
                        .filter((f) => f.currency === currency)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} ({f.amount} {f.currency})
                          </option>
                        ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={handleAddCustomItem}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Ligne personnalisée
                  </button>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 italic bg-white rounded-xl border border-dashed border-slate-300">
                  Aucune ligne ajoutée. Veuillez sélectionner un frais du catalogue ou ajouter une ligne personnalisée.
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item, index) => (
                    <div key={index} className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <div className="sm:col-span-5">
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Intitulé du frais</label>
                          <input
                            type="text"
                            value={item.fee_name}
                            onChange={(e) => handleItemChange(index, 'fee_name', e.target.value)}
                            placeholder="ex: Minerval 1er Trimestre"
                            className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                            required
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Prix Unit. ({currency})</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.unit_price}
                            onChange={(e) => handleItemChange(index, 'unit_price', parseFloat(e.target.value) || 0)}
                            className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                            required
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Qté</label>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleItemChange(index, 'quantity', parseInt(e.target.value) || 1)}
                            className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                            required
                          />
                        </div>

                        <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2 pt-3 sm:pt-0">
                          <div className="text-right">
                            <span className="block text-[10px] text-slate-400">Total</span>
                            <span className="text-xs font-bold text-slate-900">
                              <FormattedAmount amount={(item.unit_price || 0) * (item.quantity || 1)} currency={currency} />
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(index)}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title="Supprimer la ligne"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Total Général */}
                  <div className="flex justify-between items-center p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <span className="text-xs font-extrabold text-amber-900 uppercase">Montant Total de la Facture :</span>
                    <span className="text-sm font-extrabold text-amber-900">
                      <FormattedAmount amount={calculatedTotal} currency={currency} />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Remarques / Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Remarques / Modalités de paiement (Optionnel)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="ex: À payer avant le 15 du mois par virement ou espèces à la caisse."
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isSubmitting || items.length === 0}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Création en cours...
                  </>
                ) : (
                  <>
                    <DollarSign className="w-4 h-4" />
                    Créer la facture brouillon
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
};
