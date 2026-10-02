// Fichier : src/components/admin/finance/CreateBulkInvoiceModal.tsx
// Wizard de facturation groupée sécurisé (Lot 2K-FIN-BULK-F)

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Modal } from '../../common/Modal';
import { useNotifications } from '../../../context/NotificationContext';
import { supabase } from '../../../lib/supabase';
import {
  previewBulkStudentInvoiceDrafts,
  createBulkStudentInvoiceDrafts
} from '../../../services/financeService';
import type {
  Currency,
  FeeType,
  BulkInvoiceScope,
  BulkInvoicePreviewResult,
  BulkInvoiceCreationResult
} from '../../../types/finance';
import { FormattedAmount } from '../../common/CurrencyBadge';
import {
  CheckCircle2,
  AlertTriangle,
  Search,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Building2,
  School,
  HelpCircle
} from 'lucide-react';

interface FeeOption {
  id: string;
  name: string;
  fee_type: FeeType | string;
  amount: number;
  currency: Currency;
  due_date: string;
  academic_year_id: string;
  academic_year_name?: string;
  class_id?: string | null;
  class_name?: string | null;
  is_active: boolean;
}

interface ClassOption {
  id: string;
  name: string;
}

interface StudentOption {
  id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  class_id?: string | null;
  class_name?: string | null;
}

export interface CreateBulkInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  schoolId: string;
  onSuccess: () => void;
  // Optional test & harness props
  fees?: FeeOption[];
  classes?: ClassOption[];
  studentsSource?: StudentOption[];
  initialStep?: number;
  initialFee?: any;
  initialScopeType?: 'fee_target' | 'classes' | 'students';
  initialPreview?: BulkInvoicePreviewResult | null;
  initialCreation?: BulkInvoiceCreationResult | null;
}

export type BulkWizardStep = 'fee' | 'scope' | 'preview' | 'confirm' | 'result';

export const CreateBulkInvoiceModal: React.FC<CreateBulkInvoiceModalProps> = ({
  isOpen,
  onClose,
  schoolId,
  onSuccess,
  fees: propFees,
  classes: propClasses,
  studentsSource: propStudentsSource,
  initialStep: propInitialStep,
  initialFee: propInitialFee,
  initialScopeType: propInitialScopeType,
  initialPreview: propInitialPreview,
  initialCreation: propInitialCreation
}) => {
  const { showToast } = useNotifications();

  const stepMap: Record<number, BulkWizardStep> = {
    1: 'fee',
    2: 'scope',
    3: 'preview',
    4: 'confirm',
    5: 'result'
  };

  // Wizard state
  const [currentStep, setCurrentStep] = useState<BulkWizardStep>(
    propInitialStep ? (stepMap[propInitialStep] || 'fee') : 'fee'
  );

  // Master options from DB
  const [fees, setFees] = useState<FeeOption[]>(propFees || []);
  const [classes, setClasses] = useState<ClassOption[]>(propClasses || []);
  const [students, setStudents] = useState<StudentOption[]>(propStudentsSource || []);
  const [loadingMasterData, setLoadingMasterData] = useState<boolean>(false);

  // Step 1: Selected Fee
  const [selectedFeeId, setSelectedFeeId] = useState<string>(propInitialFee ? propInitialFee.id : '');

  // Step 2: Recipient Scope Selection
  const [scope, setScope] = useState<BulkInvoiceScope>(propInitialScopeType || 'fee_target');
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  // Filtering controls for Step 2 (Students search & class filter)
  const [studentSearch, setStudentSearch] = useState<string>('');
  const [studentClassFilter, setStudentClassFilter] = useState<string>('all');

  // Step 3: Preview Result
  const [previewResult, setPreviewResult] = useState<BulkInvoicePreviewResult | null>(propInitialPreview || null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'eligible' | 'excluded'>('eligible');
  const [previewPage, setPreviewPage] = useState<number>(1);

  // Step 4: Confirmation Checkbox & Creation
  const [isConfirmed, setIsConfirmed] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [creationResult, setCreationResult] = useState<BulkInvoiceCreationResult | null>(propInitialCreation || null);
  const [creationError, setCreationError] = useState<string | null>(null);

  // Refs for double-click lock and batch idempotency key preservation
  const isSubmittingRef = useRef<boolean>(false);
  const batchKeyRef = useRef<string | null>(null);

  // Load master fees, classes, and students when modal opens
  useEffect(() => {
    if (!isOpen || !schoolId) return;

    if (propFees !== undefined || propClasses !== undefined || propStudentsSource !== undefined) {
      if (propFees !== undefined) setFees(propFees);
      if (propClasses !== undefined) setClasses(propClasses);
      if (propStudentsSource !== undefined) setStudents(propStudentsSource);
      setLoadingMasterData(false);
      return;
    }

    const loadMasterData = async () => {
      setLoadingMasterData(true);
      try {
        // 1. Fetch fees
        const { data: feesData } = await supabase
          .from('school_fees')
          .select(`
            id, name, fee_type, amount, currency, due_date, academic_year_id, class_id, is_active,
            academic_year:academic_years(name),
            class:classes(name)
          `)
          .eq('school_id', schoolId)
          .eq('is_active', true)
          .order('name', { ascending: true });

        if (feesData) {
          const parsedFees: FeeOption[] = feesData.map((f) => {
            const fObj = f as Record<string, unknown>;
            const ayObj = fObj.academic_year as Record<string, unknown> | undefined;
            const clsObj = fObj.class as Record<string, unknown> | undefined;
            return {
              id: String(fObj.id),
              name: String(fObj.name || ''),
              fee_type: String(fObj.fee_type || 'autre'),
              amount: Number(fObj.amount) || 0,
              currency: (fObj.currency === 'CDF' ? 'CDF' : 'USD') as Currency,
              due_date: String(fObj.due_date || ''),
              academic_year_id: String(fObj.academic_year_id || ''),
              academic_year_name: String(ayObj?.name || ''),
              class_id: (fObj.class_id as string) || null,
              class_name: String(clsObj?.name || ''),
              is_active: Boolean(fObj.is_active)
            };
          });
          setFees(parsedFees);
        }

        // 2. Fetch classes
        const { data: classesData } = await supabase
          .from('classes')
          .select('id, name')
          .eq('school_id', schoolId)
          .order('name', { ascending: true });

        if (classesData) {
          setClasses(classesData as ClassOption[]);
        }

        // 3. Fetch active students from administration records
        const { data: studentsData } = await supabase
          .from('students')
          .select(`
            id, student_number,
            profile:profiles!fk_students_profile(first_name, last_name),
            enrollments:student_enrollments(class:classes(id, name), status)
          `)
          .eq('school_id', schoolId);

        if (studentsData) {
          const parsedStudents: StudentOption[] = studentsData.map((st) => {
            const stObj = st as Record<string, unknown>;
            const profObj = stObj.profile as Record<string, unknown> | undefined;
            const enrList = (stObj.enrollments as Array<Record<string, unknown>>) || [];
            const activeEnr = enrList.find((e) => e.status === 'active') || enrList[0];
            const clsObj = activeEnr?.class as Record<string, unknown> | undefined;

            return {
              id: String(stObj.id),
              student_number: String(stObj.student_number || ''),
              first_name: String(profObj?.first_name || 'Élève'),
              last_name: String(profObj?.last_name || 'Sans Nom'),
              class_id: (clsObj?.id as string) || null,
              class_name: String(clsObj?.name || '')
            };
          });
          setStudents(parsedStudents);
        }
      } catch (err) {
        console.error('Erreur chargement données de facturation groupée:', err);
      } finally {
        setLoadingMasterData(false);
      }
    };

    loadMasterData();
  }, [isOpen, schoolId]);

  // Active fee record
  const selectedFee = useMemo(() => {
    return fees.find((f) => f.id === selectedFeeId) || null;
  }, [fees, selectedFeeId]);

  // Invalidate preview and reset unsent batch key whenever fee, scope, or selections change
  const handleScopeOrSelectionChange = () => {
    setPreviewResult(null);
    setPreviewError(null);
    setIsConfirmed(false);
    batchKeyRef.current = null;
  };

  // Handle modal close with batch key reset
  const handleModalClose = () => {
    batchKeyRef.current = null;
    onClose();
  };

  // Filtered students for Step 2
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      // If fee is restricted to a class, filter only students of that class
      if (selectedFee?.class_id && s.class_id !== selectedFee.class_id) {
        return false;
      }
      const matchesSearch =
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(studentSearch.toLowerCase()) ||
        s.student_number.toLowerCase().includes(studentSearch.toLowerCase());
      const matchesClass = studentClassFilter === 'all' || s.class_id === studentClassFilter;
      return matchesSearch && matchesClass;
    });
  }, [students, selectedFee, studentSearch, studentClassFilter]);

  // Handle select all visible students
  const handleSelectAllVisibleStudents = () => {
    const visibleIds = filteredStudents.map((s) => s.id);
    const newSelected = Array.from(new Set([...selectedStudentIds, ...visibleIds]));
    setSelectedStudentIds(newSelected);
    handleScopeOrSelectionChange();
  };

  // Handle deselect all
  const handleDeselectAllStudents = () => {
    setSelectedStudentIds([]);
    handleScopeOrSelectionChange();
  };

  // Handle preview calculation (Step 3 trigger)
  const handleRunPreview = async () => {
    if (!selectedFeeId) {
      showToast('Veuillez sélectionner un tarif scolaire.', 'urgent');
      return;
    }

    setLoadingPreview(true);
    setPreviewError(null);
    setPreviewResult(null);

    try {
      const { result, error } = await previewBulkStudentInvoiceDrafts({
        p_fee_id: selectedFeeId,
        p_scope: scope,
        p_class_ids: scope === 'classes' ? selectedClassIds : null,
        p_student_ids: scope === 'students' ? selectedStudentIds : null
      });

      if (error) {
        setPreviewError(error.message);
        showToast(`Erreur prévisualisation : ${error.message}`, 'urgent');
      } else if (result) {
        setPreviewResult(result);
        setCurrentStep('preview');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      setPreviewError(msg);
      showToast(`Erreur : ${msg}`, 'urgent');
    } finally {
      setLoadingPreview(false);
    }
  };

  // Handle final bulk creation (Step 4 trigger)
  const handleExecuteBulkCreation = async () => {
    if (!selectedFeeId || !previewResult || !isConfirmed || isSubmittingRef.current) {
      return;
    }

    if (previewResult.summary.eligible <= 0) {
      showToast('Aucun élève éligible à facturer.', 'urgent');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setCreationError(null);

    try {
      // Generate key on first creation attempt if not already set; retain on network/RPC retries
      if (!batchKeyRef.current) {
        const randomStr = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        batchKeyRef.current = `bulk-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${randomStr}`;
      }
      const currentBatchKey = batchKeyRef.current;

      const { result, error } = await createBulkStudentInvoiceDrafts({
        p_fee_id: selectedFeeId,
        p_scope: scope,
        p_class_ids: scope === 'classes' ? selectedClassIds : null,
        p_student_ids: scope === 'students' ? selectedStudentIds : null,
        p_batch_idempotency_key: currentBatchKey
      });

      if (error) {
        setCreationError(error.message);
        showToast(`Erreur création groupée : ${error.message}`, 'urgent');
      } else if (result) {
        setCreationResult(result);
        setCurrentStep('result');
        showToast(`${result.summary.created} factures brouillons créées avec succès !`, 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      setCreationError(msg);
      showToast(`Erreur : ${msg}`, 'urgent');
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      title="Facturation groupée des élèves"
      maxWidth="3xl"
    >
      <div className="space-y-6">
        {/* Wizard Step Indicator Bar */}
        <div className="grid grid-cols-5 gap-2 bg-slate-100 p-2 rounded-xl text-center text-xs font-bold">
          <div className={`py-2 px-1 rounded-lg ${currentStep === 'fee' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500'}`}>
            1. Tarif
          </div>
          <div className={`py-2 px-1 rounded-lg ${currentStep === 'scope' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500'}`}>
            2. Cible
          </div>
          <div className={`py-2 px-1 rounded-lg ${currentStep === 'preview' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500'}`}>
            3. Aperçu
          </div>
          <div className={`py-2 px-1 rounded-lg ${currentStep === 'confirm' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500'}`}>
            4. Validation
          </div>
          <div className={`py-2 px-1 rounded-lg ${currentStep === 'result' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500'}`}>
            5. Résultat
          </div>
        </div>

        {/* STEP 1: Fee Selection */}
        {currentStep === 'fee' && (
          <div className="space-y-4">
            <div className="bg-indigo-50 border border-indigo-200 p-3.5 rounded-xl text-xs text-indigo-900 flex items-start gap-2.5">
              <HelpCircle className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                Sélectionnez le tarif scolaire de référence. Le montant, la devise, l’échéance et l’année scolaire sont automatiquement dérivés du tarif.
              </div>
            </div>

            {loadingMasterData ? (
              <div className="py-8 text-center text-slate-500 text-xs flex justify-center items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                <span>Chargement des tarifs scolaires...</span>
              </div>
            ) : fees.length === 0 ? (
              <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
                Aucun tarif scolaire actif trouvé dans cet établissement.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                {fees.map((fee) => {
                  const isSelected = selectedFeeId === fee.id;
                  return (
                    <div
                      key={fee.id}
                      onClick={() => {
                        setSelectedFeeId(fee.id);
                        // If fee is restricted to a class, reset scope to fee_target
                        if (fee.class_id) {
                          setScope('fee_target');
                          setSelectedClassIds([]);
                        }
                        handleScopeOrSelectionChange();
                      }}
                      className={`p-4 rounded-xl border-2 transition cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-200'
                          : 'border-slate-200 hover:border-indigo-300 bg-white'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <h4 className="font-bold text-xs text-slate-900">{fee.name}</h4>
                          <span className="inline-block mt-1 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-semibold uppercase">
                            {fee.fee_type}
                          </span>
                        </div>
                        <div className="text-right">
                          <FormattedAmount amount={fee.amount} currency={fee.currency} className="font-extrabold text-sm text-indigo-900" />
                          <div className="text-[10px] text-slate-500 font-medium">Échéance : {fee.due_date}</div>
                        </div>
                      </div>

                      <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between items-center text-[11px] text-slate-600">
                        <span className="flex items-center gap-1 font-medium">
                          {fee.class_id ? (
                            <>
                              <School className="w-3.5 h-3.5 text-amber-600" />
                              <span>Classe : {fee.class_name || 'Spécifique'}</span>
                            </>
                          ) : (
                            <>
                              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Toute l'école</span>
                            </>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-400">{fee.academic_year_name}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end pt-4 border-t border-slate-200">
              <button
                type="button"
                disabled={!selectedFeeId}
                onClick={() => setCurrentStep('scope')}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <span>Continuer vers les destinataires</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Target Scope Selection */}
        {currentStep === 'scope' && (
          <div className="space-y-4">
            {previewError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold">
                {previewError}
              </div>
            )}
            <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs text-slate-700">
              Tarif sélectionné : <strong className="text-indigo-900">{selectedFee?.name}</strong> (
              <FormattedAmount amount={selectedFee?.amount || 0} currency={selectedFee?.currency || 'USD'} />)
            </div>

            {/* Scope Choices */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-800">Mode de ciblage des destinataires</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Option A: fee_target */}
                <div
                  onClick={() => {
                    setScope('fee_target');
                    handleScopeOrSelectionChange();
                  }}
                  className={`p-3.5 rounded-xl border-2 transition cursor-pointer ${
                    scope === 'fee_target'
                      ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-200'
                      : 'border-slate-200 hover:border-indigo-200 bg-white'
                  }`}
                >
                  <div className="font-bold text-xs text-slate-900">Population du tarif</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {selectedFee?.class_id
                      ? `Toute la classe ${selectedFee.class_name}`
                      : "Tous les élèves inscrits de l'établissement"}
                  </div>
                </div>

                {/* Option B: classes */}
                <div
                  onClick={() => {
                    if (selectedFee?.class_id) return; // Disabled if fee is restricted to a specific class
                    setScope('classes');
                    handleScopeOrSelectionChange();
                  }}
                  className={`p-3.5 rounded-xl border-2 transition ${
                    selectedFee?.class_id
                      ? 'opacity-40 cursor-not-allowed bg-slate-100 border-slate-200'
                      : scope === 'classes'
                      ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-200 cursor-pointer'
                      : 'border-slate-200 hover:border-indigo-200 bg-white cursor-pointer'
                  }`}
                >
                  <div className="font-bold text-xs text-slate-900">Classes sélectionnées</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {selectedFee?.class_id
                      ? "Indisponible (tarif restreint à une classe)"
                      : "Choisir une ou plusieurs classes"}
                  </div>
                </div>

                {/* Option C: students */}
                <div
                  onClick={() => {
                    setScope('students');
                    handleScopeOrSelectionChange();
                  }}
                  className={`p-3.5 rounded-xl border-2 transition cursor-pointer ${
                    scope === 'students'
                      ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-200'
                      : 'border-slate-200 hover:border-indigo-200 bg-white'
                  }`}
                >
                  <div className="font-bold text-xs text-slate-900">Sélection sur mesure</div>
                  <div className="text-[11px] text-slate-500 mt-1">Choisir des élèves spécifiques</div>
                </div>
              </div>
            </div>

            {/* Scope Details B: Class Selection */}
            {scope === 'classes' && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-800">
                  Sélectionnez les classes à facturer ({selectedClassIds.length} sélectionnée(s))
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200">
                  {classes.map((cls) => {
                    const isChecked = selectedClassIds.includes(cls.id);
                    return (
                      <label
                        key={cls.id}
                        className={`flex items-center gap-2 p-2 rounded-lg text-xs font-semibold cursor-pointer transition ${
                          isChecked ? 'bg-indigo-100 text-indigo-900' : 'hover:bg-white text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedClassIds([...selectedClassIds, cls.id]);
                            } else {
                              setSelectedClassIds(selectedClassIds.filter((id) => id !== cls.id));
                            }
                            handleScopeOrSelectionChange();
                          }}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>{cls.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Scope Details C: Student Custom Selection */}
            {scope === 'students' && (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    Sélectionnez les élèves ({selectedStudentIds.length} sélectionné(s))
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAllVisibleStudents}
                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[11px] font-semibold transition"
                    >
                      Tout sélectionner ({filteredStudents.length})
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAllStudents}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition"
                    >
                      Tout désélectionner
                    </button>
                  </div>
                </div>

                {/* Filters for Students */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Nom, prénom ou matricule..."
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  {!selectedFee?.class_id && (
                    <select
                      value={studentClassFilter}
                      onChange={(e) => setStudentClassFilter(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700"
                    >
                      <option value="all">Toutes les classes</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Student Selection Table / List */}
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl bg-white divide-y divide-slate-100">
                  {filteredStudents.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">Aucun élève correspondant trouvé.</div>
                  ) : (
                    filteredStudents.map((st) => {
                      const isChecked = selectedStudentIds.includes(st.id);
                      return (
                        <label
                          key={st.id}
                          className={`flex items-center justify-between p-2.5 text-xs cursor-pointer transition ${
                            isChecked ? 'bg-indigo-50/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedStudentIds([...selectedStudentIds, st.id]);
                                } else {
                                  setSelectedStudentIds(selectedStudentIds.filter((id) => id !== st.id));
                                }
                                handleScopeOrSelectionChange();
                              }}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <div>
                              <span className="font-bold text-slate-900">
                                {st.first_name} {st.last_name}
                              </span>
                              <span className="ml-2 text-[10px] font-mono text-slate-500">({st.student_number})</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md">
                            {st.class_name || 'Sans classe'}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Navigation buttons */}
            <div className="flex justify-between items-center pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCurrentStep('fee')}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Précédent</span>
              </button>
              <button
                type="button"
                disabled={
                  (scope === 'classes' && selectedClassIds.length === 0) ||
                  (scope === 'students' && selectedStudentIds.length === 0) ||
                  loadingPreview
                }
                onClick={handleRunPreview}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm cursor-pointer"
              >
                {loadingPreview ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Calcul en cours...</span>
                  </>
                ) : (
                  <>
                    <span>Prévisualiser l'impact</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Preview Result */}
        {currentStep === 'preview' && (
          <div className="space-y-4">
            {previewResult && (
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs text-slate-700">
                Tarif : <strong className="text-indigo-900">{previewResult.fee.title}</strong> (
                <FormattedAmount amount={previewResult.fee.amount} currency={previewResult.fee.currency} />)
              </div>
            )}
            {previewError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold">
                {previewError}
              </div>
            )}
            {previewResult && (
              <>
                {/* Warning Box */}
                <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong>Information importante :</strong> Cette opération créera une facture brouillon individuelle pour chaque élève éligible. Les parents ne verraient aucune facture tant qu’elles ne seront pas émises.
              </div>
            </div>

            {/* Preview Summary Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sélectionnés</div>
                <div className="text-base font-extrabold text-slate-900 mt-0.5">{previewResult.summary.selected}</div>
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Éligibles (À créer)</div>
                <div className="text-base font-extrabold text-emerald-900 mt-0.5">{previewResult.summary.eligible}</div>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Déjà facturés</div>
                <div className="text-base font-extrabold text-amber-900 mt-0.5">{previewResult.summary.already_invoiced}</div>
              </div>
              <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
                <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Montant Estimé</div>
                <div className="text-sm font-extrabold text-indigo-900 mt-0.5">
                  <FormattedAmount amount={previewResult.summary.estimated_total} currency={previewResult.summary.currency} />
                </div>
              </div>
            </div>

            {/* Zero Eligible Warning */}
            {previewResult.summary.eligible === 0 && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 text-center font-semibold">
                Aucun élève n'est éligible pour cette sélection. Tous les élèves sélectionnés sont déjà facturés ou inactifs.
              </div>
            )}

            {/* Detailed Eligible / Excluded Students List */}
            <div className="space-y-2">
              <div className="flex border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setPreviewTab('eligible');
                    setPreviewPage(1);
                  }}
                  className={`py-2 px-4 text-xs font-bold border-b-2 transition ${
                    previewTab === 'eligible'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Élèves éligibles ({previewResult.eligible_students.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewTab('excluded');
                    setPreviewPage(1);
                  }}
                  className={`py-2 px-4 text-xs font-bold border-b-2 transition ${
                    previewTab === 'excluded'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Élèves exclus ({previewResult.excluded_students.length})
                </button>
              </div>

              {/* Paginated Table View */}
              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl bg-white">
                {previewTab === 'eligible' ? (
                  previewResult.eligible_students.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">Aucun élève éligible.</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {previewResult.eligible_students.slice((previewPage - 1) * 50, previewPage * 50).map((st, idx) => (
                        <div key={idx} className="p-2.5 text-xs flex justify-between items-center">
                          <span className="font-semibold text-slate-900">
                            {st.first_name} {st.last_name}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-medium">
                            {st.class_name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                ) : previewResult.excluded_students.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">Aucun élève exclu.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {previewResult.excluded_students.slice((previewPage - 1) * 50, previewPage * 50).map((st, idx) => (
                      <div key={idx} className="p-2.5 text-xs flex justify-between items-center">
                        <span className="font-semibold text-slate-900">
                          {st.first_name} {st.last_name}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md font-medium">
                          {st.reason_label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagination controls for long lists */}
              {((previewTab === 'eligible' && previewResult.eligible_students.length > 50) ||
                (previewTab === 'excluded' && previewResult.excluded_students.length > 50)) && (
                <div className="flex justify-between items-center text-xs text-slate-500 pt-1">
                  <span>Page {previewPage}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={previewPage === 1}
                      onClick={() => setPreviewPage(previewPage - 1)}
                      className="px-2 py-1 bg-slate-100 disabled:opacity-40 rounded-md font-medium"
                    >
                      Précédent
                    </button>
                    <button
                      type="button"
                      disabled={
                        previewPage * 50 >=
                        (previewTab === 'eligible'
                          ? previewResult.eligible_students.length
                          : previewResult.excluded_students.length)
                      }
                      onClick={() => setPreviewPage(previewPage + 1)}
                      className="px-2 py-1 bg-slate-100 disabled:opacity-40 rounded-md font-medium"
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation buttons */}
            <div className="flex justify-between items-center pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCurrentStep('scope')}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Modifier la cible</span>
              </button>
              <button
                type="button"
                disabled={previewResult.summary.eligible === 0}
                onClick={() => setCurrentStep('confirm')}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <span>Confirmer les données</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    )}

        {/* STEP 4: Confirmation */}
        {currentStep === 'confirm' && previewResult && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <h4 className="font-bold text-xs text-slate-900 uppercase tracking-wider">Résumé final du traitement</h4>
              <div className="space-y-1 text-xs text-slate-700">
                <div>
                  Tarif : <strong className="text-slate-900">{previewResult.fee.title}</strong>
                </div>
                <div>
                  Nombre de factures brouillon à créer :{' '}
                  <strong className="text-emerald-700 font-extrabold text-sm">{previewResult.summary.eligible}</strong>
                </div>
                <div>
                  Montant total estimé :{' '}
                  <strong className="text-indigo-900 font-extrabold">
                    <FormattedAmount amount={previewResult.summary.estimated_total} currency={previewResult.summary.currency} />
                  </strong>
                </div>
                <div>Élèves déjà facturés / exclus : {previewResult.summary.already_invoiced + previewResult.summary.inactive_or_unenrolled}</div>
              </div>
            </div>

            {/* Required confirmation checkbox */}
            <label className="flex items-start gap-2.5 p-3.5 bg-indigo-50/60 border border-indigo-200 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={isConfirmed}
                onChange={(e) => setIsConfirmed(e.target.checked)}
                className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-indigo-950 font-medium">
                Je confirme la création de <strong>{previewResult.summary.eligible}</strong> factures brouillon individuelles. Je comprends que ces factures restent invisibles aux parents tant qu'elles ne sont pas émises.
              </span>
            </label>

            {creationError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold">
                {creationError}
              </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t border-slate-200">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setCurrentStep('preview')}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Retour à l'aperçu</span>
              </button>
              <button
                type="button"
                disabled={!isConfirmed || isSubmitting || previewResult.summary.eligible === 0}
                onClick={handleExecuteBulkCreation}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Création des brouillons en cours...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Créer {previewResult.summary.eligible} brouillons</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: Result Summary */}
        {currentStep === 'result' && creationResult && (
          <div className="space-y-5 text-center py-2">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-extrabold text-slate-900">Traitement groupé terminé avec succès !</h3>
              <p className="text-xs text-slate-600 mt-1">
                Les factures brouillon ont été générées. Elles restent au statut <strong className="text-amber-700">brouillon</strong> et totalement invisibles pour les parents.
              </p>
            </div>

            {/* Creation summary badges */}
            <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="text-[10px] font-bold text-emerald-700 uppercase">Créées</div>
                <div className="text-lg font-extrabold text-emerald-900 mt-0.5">{creationResult.summary.created}</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Rejouées (Existe)</div>
                <div className="text-lg font-extrabold text-slate-900 mt-0.5">{creationResult.summary.existing}</div>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="text-[10px] font-bold text-amber-700 uppercase">Ignorées</div>
                <div className="text-lg font-extrabold text-amber-900 mt-0.5">{creationResult.summary.skipped}</div>
              </div>
            </div>

            {/* Detailed list for existing and skipped items */}
            {(creationResult.existing_invoices.length > 0 || creationResult.skipped_students.length > 0) && (
              <div className="text-left mt-3 max-h-36 overflow-y-auto border border-slate-200 rounded-xl bg-white p-3 space-y-2 text-xs max-w-md mx-auto">
                <div className="font-bold text-[11px] text-slate-700 uppercase tracking-wider mb-1">Détail des réutilisations & exclusions</div>
                {creationResult.existing_invoices.map((ex, idx) => (
                  <div key={`ex-${idx}`} className="flex justify-between items-center text-slate-700 py-1 border-b border-slate-100 last:border-0">
                    <span className="font-semibold">{ex.student_full_name} <span className="text-slate-400 font-normal">({ex.student_number})</span></span>
                    <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-medium">Existante par rejeu</span>
                  </div>
                ))}
                {creationResult.skipped_students.map((sk, idx) => (
                  <div key={`sk-${idx}`} className="flex justify-between items-center text-slate-700 py-1 border-b border-slate-100 last:border-0">
                    <span className="font-semibold">{sk.student_full_name || 'Élève'} <span className="text-slate-400 font-normal">({sk.student_number || 'N/A'})</span></span>
                    <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md font-medium">{sk.reason_label || sk.reason_description}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-slate-500 font-medium">
              Traitement groupé terminé.
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-center gap-3">
              <button
                type="button"
                onClick={handleModalClose}
                className="px-5 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => {
                  batchKeyRef.current = null;
                  onSuccess();
                  onClose();
                }}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
              >
                Voir les factures
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
