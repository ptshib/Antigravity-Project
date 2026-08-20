// Fichier : src/components/admin/finance/SchoolFeesCatalogModule.tsx
// Module complet d'administration sécurisée de la grille tarifaire / catalogue des frais scolaires (Phase Finance 3)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import { useNotifications } from '../../../context/NotificationContext';
import type { SchoolFee, Currency } from '../../../types/finance';
import {
  createSchoolFeeCatalogItem,
  updateSchoolFeeCatalogItem,
  setSchoolFeeCatalogItemStatus,
  fetchSchoolFeesCatalog
} from '../../../services/financeService';
import { FormattedAmount } from '../../common/CurrencyBadge';
import { getFeeTypeLabel } from '../../../utils/formatters';
import { Modal } from '../../common/Modal';
import {
  Plus,
  Search,
  Layers,
  Edit2,
  Power,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';

interface SchoolFeesCatalogModuleProps {
  schoolId: string;
}

interface AcademicYearOption {
  id: string;
  name: string;
  is_current: boolean;
}

interface ClassOption {
  id: string;
  name: string;
  academic_year_id: string;
}

export const SchoolFeesCatalogModule: React.FC<SchoolFeesCatalogModuleProps> = ({ schoolId }) => {
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState<boolean>(true);
  const [fees, setFees] = useState<SchoolFee[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);

  // Filtres
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('active');

  // Modales
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [editingFee, setEditingFee] = useState<SchoolFee | null>(null);
  const [statusTargetFee, setStatusTargetFee] = useState<SchoolFee | null>(null);

  // Formulaire de Création
  const [createYearId, setCreateYearId] = useState<string>('');
  const [createFeeType, setCreateFeeType] = useState<string>('minerval');
  const [createName, setCreateName] = useState<string>('');
  const [createAmount, setCreateAmount] = useState<string>('');
  const [createCurrency, setCreateCurrency] = useState<Currency>('CDF');
  const [createDueDate, setCreateDueDate] = useState<string>('2026-10-15');
  const [createClassId, setCreateClassId] = useState<string>('');
  const [createDescription, setCreateDescription] = useState<string>('');
  const [createIsMandatory, setCreateIsMandatory] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const isCreatingRef = useRef<boolean>(false);

  // Formulaire de Modification
  const [editName, setEditName] = useState<string>('');
  const [editAmount, setEditAmount] = useState<string>('');
  const [editDueDate, setEditDueDate] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');
  const [editIsMandatory, setEditIsMandatory] = useState<boolean>(true);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const isUpdatingRef = useRef<boolean>(false);

  // Formulaire de Désactivation / Statut
  const [isTogglingStatus, setIsTogglingStatus] = useState<boolean>(false);
  const isTogglingStatusRef = useRef<boolean>(false);

  // Chargement des données d'appui (Années & Classes)
  const fetchSupportData = useCallback(async () => {
    try {
      const { data: yearsData } = await supabase
        .from('academic_years')
        .select('id, name, is_current')
        .eq('school_id', schoolId)
        .order('name', { ascending: false });

      if (yearsData && yearsData.length > 0) {
        setAcademicYears(yearsData as AcademicYearOption[]);
        const current = yearsData.find((y: any) => y.is_current);
        const defaultYear = current ? current.id : yearsData[0].id;
        setCreateYearId(defaultYear);
      }

      const { data: classesData } = await supabase
        .from('classes')
        .select('id, name, academic_year_id')
        .eq('school_id', schoolId)
        .order('name', { ascending: true });

      if (classesData) {
        setClasses(classesData as ClassOption[]);
      }
    } catch (err: unknown) {
      console.error('Erreur chargement métadonnées grille tarifaire:', err);
    }
  }, [schoolId]);

  // Chargement des tarifs
  const fetchFees = useCallback(async () => {
    setLoading(true);
    try {
      const selectedYear = yearFilter !== 'all' ? yearFilter : null;
      const { fees: data, error } = await fetchSchoolFeesCatalog(schoolId, selectedYear);

      if (error) {
        showToast(`Erreur chargement catalogue : ${error.message}`, 'urgent');
      } else {
        setFees(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
    } finally {
      setLoading(false);
    }
  }, [schoolId, yearFilter, showToast]);

  useEffect(() => {
    if (schoolId) {
      fetchSupportData();
    }
  }, [schoolId, fetchSupportData]);

  useEffect(() => {
    if (schoolId) {
      fetchFees();
    }
  }, [schoolId, fetchFees]);

  // Réinitialisation du formulaire de création
  const handleOpenCreateModal = () => {
    setCreateName('');
    setCreateAmount('');
    setCreateCurrency('CDF');
    setCreateDescription('');
    setCreateClassId('');
    setCreateDueDate('2026-10-15');
    setCreateIsMandatory(true);
    setIsCreateModalOpen(true);
  };

  // Soumission Création Tarif
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingRef.current) return;

    const numAmount = parseFloat(createAmount);
    if (!createName.trim()) {
      showToast('Le nom du tarif est obligatoire.', 'warning');
      return;
    }
    if (isNaN(numAmount) || numAmount <= 0) {
      showToast('Le montant doit être un nombre strictement positif.', 'warning');
      return;
    }
    if (!createYearId) {
      showToast('Veuillez sélectionner une année académique.', 'warning');
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);

    try {
      const { result, error } = await createSchoolFeeCatalogItem({
        p_academic_year_id: createYearId,
        p_fee_type: createFeeType,
        p_name: createName.trim(),
        p_amount: numAmount,
        p_currency: createCurrency,
        p_due_date: createDueDate,
        p_class_id: createClassId || null,
        p_description: createDescription.trim() || null,
        p_is_mandatory: createIsMandatory
      });

      if (error) {
        showToast(`Erreur création tarif : ${error.message}`, 'urgent');
      } else if (result?.success) {
        showToast(`Tarif "${createName.trim()}" créé avec succès dans le catalogue !`, 'success');
        setIsCreateModalOpen(false);
        fetchFees();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
    } finally {
      setIsCreating(false);
      isCreatingRef.current = false;
    }
  };

  // Ouverture Modification Tarif
  const handleOpenEditModal = (fee: SchoolFee) => {
    setEditingFee(fee);
    setEditName(fee.name);
    setEditAmount(String(fee.amount));
    setEditDueDate(fee.due_date || '2026-10-15');
    setEditDescription(fee.description || '');
    setEditIsMandatory(fee.is_mandatory);
  };

  // Soumission Modification Tarif
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFee || isUpdatingRef.current) return;

    const numAmount = parseFloat(editAmount);
    if (!editName.trim()) {
      showToast('Le nom du tarif est obligatoire.', 'warning');
      return;
    }
    if (isNaN(numAmount) || numAmount <= 0) {
      showToast('Le montant doit être un nombre strictement positif.', 'warning');
      return;
    }

    isUpdatingRef.current = true;
    setIsUpdating(true);

    try {
      const { result, error } = await updateSchoolFeeCatalogItem({
        p_fee_id: editingFee.id,
        p_name: editName.trim(),
        p_amount: numAmount,
        p_due_date: editDueDate,
        p_description: editDescription.trim() || null,
        p_is_mandatory: editIsMandatory
      });

      if (error) {
        showToast(`Erreur modification tarif : ${error.message}`, 'urgent');
      } else if (result?.success) {
        showToast(`Tarif "${editName.trim()}" mis à jour avec succès !`, 'success');
        setEditingFee(null);
        fetchFees();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
    } finally {
      setIsUpdating(false);
      isUpdatingRef.current = false;
    }
  };

  // Soumission Changement Statut (Activer / Archiver)
  const handleConfirmToggleStatus = async () => {
    if (!statusTargetFee || isTogglingStatusRef.current) return;

    isTogglingStatusRef.current = true;
    setIsTogglingStatus(true);
    const newStatus = !statusTargetFee.is_active;

    try {
      const { result, error } = await setSchoolFeeCatalogItemStatus(statusTargetFee.id, newStatus);

      if (error) {
        showToast(`Erreur modification statut : ${error.message}`, 'urgent');
      } else if (result?.success) {
        const actionLabel = newStatus ? 'réactivé' : 'archivé';
        showToast(`Le tarif "${statusTargetFee.name}" a été ${actionLabel} avec succès.`, 'success');
        setStatusTargetFee(null);
        fetchFees();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inattendue';
      showToast(`Erreur inattendue : ${msg}`, 'urgent');
    } finally {
      setIsTogglingStatus(false);
      isTogglingStatusRef.current = false;
    }
  };

  // Filtrage local réactif
  const filteredFees = fees.filter((fee) => {
    const matchesSearch =
      fee.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (fee.description && fee.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCurrency = currencyFilter === 'all' || fee.currency === currencyFilter;
    const matchesType = typeFilter === 'all' || fee.fee_type === typeFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && fee.is_active) ||
      (statusFilter === 'archived' && !fee.is_active);

    return matchesSearch && matchesCurrency && matchesType && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-600" />
            Grille Tarifaire & Catalogue des Frais
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Gestion sécurisée des tarifs scolaires applicables à la facturation
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreateModal}
          className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Créer un tarif
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-3 w-full">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher par nom ou description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>

          {/* Année filtre */}
          {academicYears.length > 0 && (
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
            >
              <option value="all">Toutes les années académiques</option>
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  Année : {y.name} {y.is_current ? '(En cours)' : ''}
                </option>
              ))}
            </select>
          )}

          {/* Devise Filtre */}
          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
          >
            <option value="all">Toutes devises (CDF & USD)</option>
            <option value="CDF">CDF</option>
            <option value="USD">USD ($)</option>
          </select>

          {/* Type Filtre */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
          >
            <option value="all">Tous types de frais</option>
            <option value="minerval">Minerval / Scolarité</option>
            <option value="inscription">Inscription</option>
            <option value="frais_examen">Frais d'examen</option>
            <option value="uniforme">Uniforme</option>
            <option value="transport">Transport</option>
            <option value="cantine">Cantine</option>
            <option value="activites">Activités</option>
            <option value="frais_etat">Frais d'État</option>
            <option value="autre">Autre</option>
          </select>

          {/* Statut Filtre */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
          >
            <option value="active">Tarifs Actifs uniquement</option>
            <option value="archived">Tarifs Archivés / Inactifs</option>
            <option value="all">Tous les statuts</option>
          </select>
        </div>
      </div>

      {/* Catalog Cards Grid */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 text-sm">
          Chargement sécurisé de la grille tarifaire...
        </div>
      ) : filteredFees.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-500 space-y-2">
          <Layers className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold">Aucun tarif trouvé pour les filtres choisis.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFees.map((fee) => (
            <div
              key={fee.id}
              className={`bg-white p-5 rounded-2xl border transition space-y-3 relative overflow-hidden shadow-xs hover:shadow-md ${
                !fee.is_active ? 'border-rose-200 bg-rose-50/20' : 'border-slate-200'
              }`}
            >
              {/* Header Card */}
              <div className="flex justify-between items-start gap-2">
                <div>
                  <span className="text-[10px] font-extrabold text-amber-600 uppercase tracking-wider bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                    {getFeeTypeLabel(fee.fee_type)}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-1.5 line-clamp-1">{fee.name}</h3>
                  {fee.class_name ? (
                    <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md inline-block mt-1">
                      Classe : {fee.class_name}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-slate-400 inline-block mt-1">
                      Portée : Toute l'école
                    </span>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-base font-black text-slate-900 block">
                    <FormattedAmount amount={fee.amount} currency={fee.currency} />
                  </span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase mt-1 ${
                      fee.is_active
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {fee.is_active ? 'Actif' : 'Archivé'}
                  </span>
                </div>
              </div>

              {fee.description && (
                <p className="text-xs text-slate-600 line-clamp-2">{fee.description}</p>
              )}

              {/* Card Meta Footer */}
              <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${fee.is_mandatory ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                  {fee.is_mandatory ? 'Obligatoire' : 'Optionnel'}
                </span>

                {fee.due_date && (
                  <span className="text-[11px] font-mono text-slate-500">
                    Échéance : {fee.due_date}
                  </span>
                )}
              </div>

              {/* Action Toolbar */}
              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => handleOpenEditModal(fee)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Modifier
                </button>

                <button
                  type="button"
                  onClick={() => setStatusTargetFee(fee)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                    fee.is_active
                      ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  {fee.is_active ? 'Archiver' : 'Activer'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODALE DE CRÉATION DE TARIF */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Créer un Nouveau Tarif Scolaire"
        maxWidth="md"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Année Académique *</label>
            <select
              value={createYearId}
              onChange={(e) => setCreateYearId(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
            >
              <option value="">Sélectionner une année...</option>
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name} {y.is_current ? '(En cours)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Type de Frais *</label>
              <select
                value={createFeeType}
                onChange={(e) => setCreateFeeType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
              >
                <option value="minerval">Minerval / Scolarité</option>
                <option value="inscription">Inscription</option>
                <option value="frais_examen">Frais d'examen</option>
                <option value="uniforme">Uniforme & Équipement</option>
                <option value="transport">Transport scolaire</option>
                <option value="cantine">Cantine</option>
                <option value="activites">Activités</option>
                <option value="frais_etat">Frais d'État</option>
                <option value="autre">Autre</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Classe ciblée (Optionnel)</label>
              <select
                value={createClassId}
                onChange={(e) => setCreateClassId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
              >
                <option value="">Toute l'école (Toutes les classes)</option>
                {classes
                  .filter((c) => !createYearId || c.academic_year_id === createYearId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Libellé du Tarif *</label>
            <input
              type="text"
              placeholder="Ex: Minerval Trimestre 1 2026-2027"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              required
              maxLength={150}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Montant *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Ex: 50000"
                value={createAmount}
                onChange={(e) => setCreateAmount(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Devise *</label>
              <select
                value={createCurrency}
                onChange={(e) => setCreateCurrency(e.target.value as Currency)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900"
              >
                <option value="CDF">CDF (Francs Congolais)</option>
                <option value="USD">USD ($ Dollars)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Date d'Échéance *</label>
              <input
                type="date"
                value={createDueDate}
                onChange={(e) => setCreateDueDate(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
              />
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={createIsMandatory}
                  onChange={(e) => setCreateIsMandatory(e.target.checked)}
                  className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-4 h-4"
                />
                Tarif obligatoire pour l'élève
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Description / Notes</label>
            <textarea
              rows={2}
              placeholder="Précisions sur les modalités de règlement..."
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Annuler
            </button>

            <button
              type="submit"
              disabled={isCreating}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4" />
              {isCreating ? 'Création en cours...' : 'Enregistrer le Tarif'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODALE DE MODIFICATION DE TARIF */}
      <Modal
        isOpen={!!editingFee}
        onClose={() => setEditingFee(null)}
        title="Modifier le Tarif Scolaire"
        maxWidth="md"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Libellé du Tarif *</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              maxLength={150}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Montant *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Date d'Échéance *</label>
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Description / Notes</label>
            <textarea
              rows={2}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900"
            />
          </div>

          <div className="flex items-center">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={editIsMandatory}
                onChange={(e) => setEditIsMandatory(e.target.checked)}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-4 h-4"
              />
              Tarif obligatoire pour l'élève
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setEditingFee(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Annuler
            </button>

            <button
              type="submit"
              disabled={isUpdating}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4" />
              {isUpdating ? 'Mise à jour...' : 'Sauvegarder les modifications'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODALE APPLICATIVE DE DÉSACTIVATION / ARCHIVAGE (Sans window.confirm) */}
      <Modal
        isOpen={!!statusTargetFee}
        onClose={() => setStatusTargetFee(null)}
        title={statusTargetFee?.is_active ? "Archiver le Tarif Scolaire" : "Réactiver le Tarif Scolaire"}
        maxWidth="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold block">Conséquence sur la facturation :</strong>
              {statusTargetFee?.is_active
                ? 'Un tarif archivé ne pourra plus être sélectionné lors de l\'émission de nouvelles factures. Toutes les factures passées liées à ce tarif restent inchangées.'
                : 'La réactivation rendra de nouveau ce tarif disponible pour la création de factures.'}
            </div>
          </div>

          <p className="text-xs text-slate-700">
            Voulez-vous vraiment {statusTargetFee?.is_active ? 'archiver' : 'réactiver'} le tarif :{' '}
            <strong className="text-slate-900 font-bold">"{statusTargetFee?.name}"</strong> ?
          </p>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setStatusTargetFee(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Annuler
            </button>

            <button
              type="button"
              onClick={handleConfirmToggleStatus}
              disabled={isTogglingStatus}
              className={`px-5 py-2 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-1.5 ${
                statusTargetFee?.is_active
                  ? 'bg-rose-600 hover:bg-rose-700 disabled:opacity-50'
                  : 'bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50'
              }`}
            >
              <Power className="w-4 h-4" />
              {isTogglingStatus
                ? 'Traitement en cours...'
                : statusTargetFee?.is_active
                ? 'Confirmer l\'archivage'
                : 'Confirmer la réactivation'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
