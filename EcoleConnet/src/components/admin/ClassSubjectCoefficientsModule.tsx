// Fichier : src/components/admin/ClassSubjectCoefficientsModule.tsx
// Module de gestion des coefficients des matières par classe (Phase 2F.2)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../common/Modal';
import {
  Sliders,
  BookOpen,
  Edit3,
  CheckCircle2,
  AlertCircle,
  Calculator,
  Search,
  Save,
  Layers,
  GraduationCap
} from 'lucide-react';

interface ClassSubjectCoefficientsModuleProps {
  classes: any[];
  subjects: any[];
  academicYears: any[];
}

interface ClassSubjectItem {
  subject_id: string;
  subject_name: string;
  subject_code: string | null;
  coefficient: number;
  setting_id?: string;
  is_active: boolean;
  is_custom: boolean;
}

export const ClassSubjectCoefficientsModule: React.FC<ClassSubjectCoefficientsModuleProps> = ({
  classes,
  subjects,
  academicYears
}) => {
  const { showToast } = useNotifications();

  // Selection states
  const currentYear = useMemo(() => academicYears.find(y => y.is_current) || academicYears[0], [academicYears]);
  const [selectedYearId, setSelectedYearId] = useState<string>('');
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Data states
  const [loading, setLoading] = useState<boolean>(false);
  const [items, setItems] = useState<ClassSubjectItem[]>([]);

  // Edit Modal
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<ClassSubjectItem | null>(null);
  const [formCoefficient, setFormCoefficient] = useState<string>('1');
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Initialize selected year
  useEffect(() => {
    if (currentYear && !selectedYearId) {
      setSelectedYearId(currentYear.id);
    }
  }, [currentYear, selectedYearId]);

  // Classes filtered by selected year
  const filteredClasses = useMemo(() => {
    if (!selectedYearId) return classes;
    return classes.filter(c => c.academic_year_id === selectedYearId);
  }, [classes, selectedYearId]);

  // Auto-select first class when class list changes
  useEffect(() => {
    if (filteredClasses.length > 0) {
      if (!selectedClassId || !filteredClasses.some(c => c.id === selectedClassId)) {
        setSelectedClassId(filteredClasses[0].id);
      }
    } else {
      setSelectedClassId('');
    }
  }, [filteredClasses, selectedClassId]);

  // Selected Class details
  const selectedClass = useMemo(() => {
    return classes.find(c => c.id === selectedClassId);
  }, [classes, selectedClassId]);

  // Load Coefficients for selected Class and Year
  const loadCoefficients = useCallback(async () => {
    if (!selectedClassId || !selectedYearId) {
      setItems([]);
      return;
    }

    setLoading(true);
    try {
      // 1. Fetch class_subject_settings for this class
      const { data: settingsData, error: settingsError } = await supabase
        .from('class_subject_settings')
        .select('id, subject_id, coefficient, is_active')
        .eq('class_id', selectedClassId)
        .eq('academic_year_id', selectedYearId);

      if (settingsError) throw settingsError;

      const settingsMap = new Map<string, { id: string; coefficient: number; is_active: boolean }>();
      (settingsData || []).forEach((s: any) => {
        settingsMap.set(s.subject_id, {
          id: s.id,
          coefficient: Number(s.coefficient),
          is_active: s.is_active
        });
      });

      // 2. Fetch active subjects in school
      const activeSubjects = subjects.filter(s => s.is_active !== false);

      // 3. Merge subjects with settings
      const mergedList: ClassSubjectItem[] = activeSubjects.map(sbj => {
        const setting = settingsMap.get(sbj.id);
        return {
          subject_id: sbj.id,
          subject_name: sbj.name,
          subject_code: sbj.code,
          coefficient: setting ? setting.coefficient : 1.0,
          setting_id: setting?.id,
          is_active: setting ? setting.is_active : true,
          is_custom: !!setting
        };
      });

      // Sort alphabetically by subject name
      mergedList.sort((a, b) => a.subject_name.localeCompare(b.subject_name));
      setItems(mergedList);
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du chargement des coefficients.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [selectedClassId, selectedYearId, subjects, showToast]);

  useEffect(() => {
    loadCoefficients();
  }, [loadCoefficients]);

  // Open Edit Modal
  const handleOpenEdit = (item: ClassSubjectItem) => {
    setEditingItem(item);
    setFormCoefficient(item.coefficient.toString());
    setShowEditModal(true);
  };

  // Submit Coefficient Update via official RPC
  const handleSubmitCoefficient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !selectedClassId) return;

    const coefNum = parseFloat(formCoefficient);
    if (isNaN(coefNum) || coefNum <= 0) {
      showToast('Le coefficient doit être un nombre strictement supérieur à zéro (ex: 1, 2.5, 4).', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('upsert_class_subject_coefficient', {
        p_class_id: selectedClassId,
        p_subject_id: editingItem.subject_id,
        p_coefficient: coefNum
      });

      if (error) throw error;

      showToast(`Coefficient de "${editingItem.subject_name}" mis à jour : ${coefNum}`, 'success');
      setShowEditModal(false);
      await loadCoefficients();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la mise à jour du coefficient.', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered items by search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      it =>
        it.subject_name.toLowerCase().includes(q) ||
        (it.subject_code && it.subject_code.toLowerCase().includes(q))
    );
  }, [items, searchQuery]);

  // Total coefficient weight
  const totalCoefficients = useMemo(() => {
    return items.reduce((acc, it) => acc + (it.is_active ? it.coefficient : 0), 0);
  }, [items]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Sliders className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
              Coefficients des Matières
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Configuration académique officielle des pondérations par classe pour le calcul des pourcentages périodiques.
            </p>
          </div>
        </div>

        {/* Global Summary Badge */}
        <div className="flex items-center gap-3 bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800">
          <Calculator className="w-5 h-5 text-amber-400" />
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400">Poids Total de la Classe</p>
            <p className="text-sm font-black text-white">
              {totalCoefficients.toFixed(1)} <span className="text-xs text-slate-400 font-medium">pts coeff</span>
            </p>
          </div>
        </div>
      </div>

      {/* Selector Filters Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col md:flex-row items-center gap-4">
        {/* Academic Year Selector */}
        <div className="w-full md:w-64">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Année Scolaire
          </label>
          <select
            value={selectedYearId}
            onChange={e => setSelectedYearId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
          >
            {academicYears.map(y => (
              <option key={y.id} value={y.id}>
                {y.name} {y.is_current ? '(En cours)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Class Selector */}
        <div className="w-full md:w-72">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Classe
          </label>
          <select
            value={selectedClassId}
            onChange={e => setSelectedClassId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
          >
            {filteredClasses.length === 0 ? (
              <option value="">Aucune classe pour cette année</option>
            ) : (
              filteredClasses.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.education_cycle ? `(${c.education_cycle === 'primary' ? 'Primaire' : 'Secondaire'})` : ''}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Search Field */}
        <div className="w-full md:flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Recherche par matière
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Filtrer une matière..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Class Meta Indicator */}
      {selectedClass && (
        <div className="flex flex-wrap items-center gap-3 px-2 text-xs text-slate-400">
          <span className="flex items-center gap-1.5 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
            <GraduationCap className="w-4 h-4 text-indigo-400" />
            Classe : <strong className="text-white">{selectedClass.name}</strong>
          </span>
          <span className="flex items-center gap-1.5 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
            <Layers className="w-4 h-4 text-purple-400" />
            Cycle : <strong className="text-white">{selectedClass.education_cycle === 'primary' ? 'Primaire (Trimestriel)' : 'Secondaire (Semestriel)'}</strong>
          </span>
          <span className="flex items-center gap-1.5 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
            <BookOpen className="w-4 h-4 text-emerald-400" />
            Matières configurées : <strong className="text-white">{items.length}</strong>
          </span>
        </div>
      )}

      {/* Table of Subjects & Coefficients */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
        {loading ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-bold">Chargement des coefficients officiels...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-500">
              <BookOpen className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-white">Aucune matière trouvée</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Veuillez sélectionner une classe active ou vérifier que des matières ont été créées dans l’établissement.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-bold border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4">Matière</th>
                  <th className="px-6 py-4">Code</th>
                  <th className="px-6 py-4 text-center">Coefficient Actuel</th>
                  <th className="px-6 py-4 text-center">État</th>
                  <th className="px-6 py-4 text-center">Configuration</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredItems.map(item => (
                  <tr key={item.subject_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-bold text-white flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs">
                        {item.subject_name.charAt(0).toUpperCase()}
                      </div>
                      <span>{item.subject_name}</span>
                    </td>
                    <td className="px-6 py-4 font-mono text-slate-400">
                      {item.subject_code || '—'}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-black text-sm">
                        {item.coefficient}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {item.is_active ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Actif
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-400">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Inactif
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {item.is_custom ? (
                        <span className="text-[11px] text-indigo-300 font-medium bg-indigo-500/10 px-2 py-0.5 rounded-lg border border-indigo-500/20">
                          Spécifique à la classe
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium">
                          Par défaut (1.0)
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleOpenEdit(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-200 font-bold transition-all text-xs cursor-pointer shadow-sm"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Modifier
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Coefficient Modal */}
      {showEditModal && editingItem && (
        <Modal
          isOpen={showEditModal}
          onClose={() => !submitting && setShowEditModal(false)}
          title={`Modifier le coefficient : ${editingItem.subject_name}`}
        >
          <form onSubmit={handleSubmitCoefficient} className="space-y-4">
            <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-1 text-xs">
              <p className="text-slate-400">
                Classe : <strong className="text-white">{selectedClass?.name}</strong>
              </p>
              <p className="text-slate-400">
                Matière : <strong className="text-white">{editingItem.subject_name}</strong>
              </p>
              <p className="text-slate-400">
                Coefficient actuel : <strong className="text-amber-400">{editingItem.coefficient}</strong>
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Nouveau Coefficient <span className="text-amber-400">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                required
                value={formCoefficient}
                onChange={e => setFormCoefficient(e.target.value)}
                placeholder="Ex: 1, 2, 4"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white font-bold text-sm focus:outline-none focus:border-amber-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Le coefficient doit être un nombre strictement supérieur à zéro. Il sera utilisé comme multiplicateur pondéré lors du calcul du pourcentage général de la période.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl cursor-pointer transition-colors disabled:opacity-50"
              >
                {submitting ? (
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Enregistrer
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
