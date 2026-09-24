import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  Plus,
  Filter,
  Search,
  Send,
  AlertCircle,
  RefreshCw,
  X,
  XCircle,
  Eye,
  Edit3
} from 'lucide-react';
import {
  fetchTeacherHomework,
  createTeacherHomework,
  updateTeacherHomework,
  publishTeacherHomework,
  cancelTeacherHomework,
  fetchTeacherAuthorizedSubjects
} from '../../services/teacherHomeworkService';
import type { TeacherHomework } from '../../services/teacherHomeworkService';

export interface AssignedClass {
  id: string;
  name: string;
}

export interface AssignedSubject {
  id: string;
  name: string;
  class_id?: string;
}

interface TeacherHomeworkModuleProps {
  assignedClasses?: AssignedClass[];
  assignedSubjects?: AssignedSubject[];
  showToast?: (message: string, type?: 'urgent' | 'info' | 'success' | 'warning' | 'error') => void;
}

export const TeacherHomeworkModule: React.FC<TeacherHomeworkModuleProps> = ({
  assignedClasses = [],
  assignedSubjects = [],
  showToast
}) => {
  const [homeworks, setHomeworks] = useState<TeacherHomework[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Dynamic server-authorized subjects per class
  const [serverAuthorizedSubjects, setServerAuthorizedSubjects] = useState<AssignedSubject[] | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [showPublishConfirmModal, setShowPublishConfirmModal] = useState<boolean>(false);
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState<boolean>(false);

  // Form State
  const [selectedHomework, setSelectedHomework] = useState<TeacherHomework | null>(null);
  const [formClassId, setFormClassId] = useState<string>('');
  const [formSubjectId, setFormSubjectId] = useState<string>('');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formInstructions, setFormInstructions] = useState<string>('');
  const [formAssignedOn, setFormAssignedOn] = useState<string>(new Date().toISOString().split('T')[0]);
  const [formDueDate, setFormDueDate] = useState<string>('');
  const [formDueTime, setFormDueTime] = useState<string>('18:00');
  const [formEstimatedMinutes, setFormEstimatedMinutes] = useState<string>('');
  const [cancelReason, setCancelReason] = useState<string>('');

  const [submitting, setSubmitting] = useState<boolean>(false);

  // Race condition ref
  const requestIdRef = useRef<number>(0);

  const loadHomeworkData = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchTeacherHomework();
      if (currentRequestId === requestIdRef.current) {
        setHomeworks(data);
      }
    } catch (err: any) {
      if (currentRequestId === requestIdRef.current) {
        setError(err.message || 'Impossible de charger la liste des devoirs.');
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadHomeworkData();
  }, [loadHomeworkData]);

  // Fetch server authorized subjects when formClassId changes
  useEffect(() => {
    let isMounted = true;
    if (!formClassId) {
      setServerAuthorizedSubjects(null);
      return;
    }

    fetchTeacherAuthorizedSubjects(formClassId)
      .then(subjects => {
        if (!isMounted) return;
        if (subjects && Array.isArray(subjects) && subjects.length > 0) {
          const mapped = subjects.map(s => ({
            id: s.subject_id,
            name: s.subject_name + (s.subject_code ? ` (${s.subject_code})` : ''),
            class_id: formClassId
          }));
          setServerAuthorizedSubjects(mapped);
          setFormSubjectId(prev => {
            if (mapped.some(m => m.id === prev)) return prev;
            return mapped[0]?.id || '';
          });
        } else {
          setServerAuthorizedSubjects([]);
          setFormSubjectId('');
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setServerAuthorizedSubjects(null);
      });

    return () => {
      isMounted = false;
    };
  }, [formClassId]);

  // Available subjects filtered by selected class in creation form
  const availableFormSubjects = React.useMemo(() => {
    if (serverAuthorizedSubjects !== null) {
      return serverAuthorizedSubjects;
    }
    const validSubjects = assignedSubjects.filter(s => s && typeof s.id === 'string' && s.id.trim() !== '');
    if (!formClassId) return validSubjects;
    return validSubjects.filter(s => !s.class_id || s.class_id === formClassId);
  }, [formClassId, assignedSubjects, serverAuthorizedSubjects]);


  const resetForm = () => {
    setSelectedHomework(null);
    setFormClassId(assignedClasses.length > 0 ? assignedClasses[0].id : '');
    setFormSubjectId('');
    setFormTitle('');
    setFormInstructions('');
    setFormAssignedOn(new Date().toISOString().split('T')[0]);
    setFormDueDate('');
    setFormDueTime('18:00');
    setFormEstimatedMinutes('');
    setCancelReason('');
  };

  const handleOpenCreateModal = () => {
    resetForm();
    if (assignedClasses.length > 0) {
      const defaultClassId = assignedClasses[0].id;
      setFormClassId(defaultClassId);
      const matchedSubjects = assignedSubjects.filter(
        s => s && typeof s.id === 'string' && s.id.trim() !== '' && (!s.class_id || s.class_id === defaultClassId)
      );
      if (matchedSubjects.length > 0) {
        setFormSubjectId(matchedSubjects[0].id);
      } else {
        setFormSubjectId('');
      }
    }
    setShowCreateModal(true);
  };

  const handleOpenEditModal = (hw: TeacherHomework) => {
    setSelectedHomework(hw);
    setFormClassId(hw.class_id);
    setFormSubjectId(hw.subject_id);
    setFormTitle(hw.title);
    setFormInstructions(hw.instructions);
    setFormAssignedOn(hw.assigned_on);
    
    if (hw.due_at) {
      const dueObj = new Date(hw.due_at);
      setFormDueDate(dueObj.toISOString().split('T')[0]);
      setFormDueTime(dueObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    } else {
      setFormDueDate('');
      setFormDueTime('18:00');
    }

    setFormEstimatedMinutes(hw.estimated_minutes ? String(hw.estimated_minutes) : '');
    setShowEditModal(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClassId || !formSubjectId || !formTitle.trim() || !formInstructions.trim()) {
      showToast?.('Veuillez remplir tous les champs obligatoires (classe, matière, titre, consignes).', 'warning');
      return;
    }

    if (!formDueDate || !formDueTime) {
      showToast?.('Veuillez spécifier la date et l’heure d’échéance du devoir.', 'warning');
      return;
    }

    const dueIsoString = `${formDueDate}T${formDueTime}:00Z`;

    setSubmitting(true);
    try {
      await createTeacherHomework({
        class_id: formClassId,
        subject_id: formSubjectId,
        title: formTitle.trim(),
        instructions: formInstructions.trim(),
        assigned_on: formAssignedOn,
        due_at: dueIsoString,
        estimated_minutes: formEstimatedMinutes ? parseInt(formEstimatedMinutes, 10) : null,
        publish_now: false
      });

      showToast?.('Devoir créé en brouillon avec succès !', 'success');
      setShowCreateModal(false);
      resetForm();
      await loadHomeworkData();
    } catch (err: any) {
      showToast?.(err.message || 'Erreur lors de la création du devoir.', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHomework) return;

    if (!formTitle.trim() || !formInstructions.trim()) {
      showToast?.('Veuillez remplir tous les champs obligatoires (titre, consignes).', 'warning');
      return;
    }

    if (!formDueDate || !formDueTime) {
      showToast?.('Veuillez spécifier la date et l’heure d’échéance du devoir.', 'warning');
      return;
    }

    const dueIsoString = `${formDueDate}T${formDueTime}:00Z`;

    setSubmitting(true);
    try {
      await updateTeacherHomework({
        homework_id: selectedHomework.id,
        title: formTitle.trim(),
        instructions: formInstructions.trim(),
        assigned_on: formAssignedOn,
        due_at: dueIsoString,
        estimated_minutes: formEstimatedMinutes ? parseInt(formEstimatedMinutes, 10) : null,
      });

      showToast?.('Devoir modifié avec succès !', 'success');
      setShowEditModal(false);
      resetForm();
      await loadHomeworkData();
    } catch (err: any) {
      showToast?.(err.message || 'Erreur lors de la modification du devoir.', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublishSubmit = async () => {
    if (!selectedHomework) return;
    setSubmitting(true);
    try {
      await publishTeacherHomework(selectedHomework.id);
      showToast?.('Devoir publié avec succès ! Il est maintenant visible par les parents et élèves.', 'success');
      setShowPublishConfirmModal(false);
      if (showDetailModal) setShowDetailModal(false);
      resetForm();
      await loadHomeworkData();
    } catch (err: any) {
      const msg = err.message || 'Erreur lors de la publication du devoir.';
      setActionError(msg);
      setShowPublishConfirmModal(false);
      showToast?.(msg, 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHomework) return;
    if (!cancelReason.trim()) {
      showToast?.('Un motif d’annulation explicite est obligatoire.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      await cancelTeacherHomework(selectedHomework.id, cancelReason.trim());
      showToast?.('Devoir annulé avec succès.', 'success');
      setShowCancelConfirmModal(false);
      if (showDetailModal) setShowDetailModal(false);
      resetForm();
      await loadHomeworkData();
    } catch (err: any) {
      showToast?.(err.message || 'Erreur lors de l’annulation du devoir.', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered Homework List
  const filteredHomeworks = React.useMemo(() => {
    return homeworks.filter(hw => {
      if (classFilter !== 'all' && hw.class_id !== classFilter) return false;
      if (subjectFilter !== 'all' && hw.subject_id !== subjectFilter) return false;
      if (statusFilter !== 'all' && hw.status !== statusFilter) return false;
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase().trim();
        const titleMatch = hw.title.toLowerCase().includes(query);
        const instrMatch = hw.instructions.toLowerCase().includes(query);
        if (!titleMatch && !instrMatch) return false;
      }
      return true;
    });
  }, [homeworks, classFilter, subjectFilter, statusFilter, searchQuery]);

  // KPI Calculations
  const kpiTotal = homeworks.length;
  const kpiDrafts = homeworks.filter(h => h.status === 'draft').length;
  const kpiPublished = homeworks.filter(h => h.status === 'published').length;
  const kpiCancelled = homeworks.filter(h => h.status === 'cancelled').length;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" data-testid="teacher-homework-skeleton">
        {/* Header Skeleton */}
        <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-xs flex justify-between items-center">
          <div className="space-y-2">
            <div className="h-6 w-48 bg-slate-200 rounded-lg"></div>
            <div className="h-4 w-64 bg-slate-100 rounded-lg"></div>
          </div>
          <div className="h-10 w-36 bg-amber-200 rounded-xl"></div>
        </div>

        {/* KPI Skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="p-5 bg-white rounded-3xl border border-slate-200 space-y-2">
              <div className="h-3 w-20 bg-slate-200 rounded"></div>
              <div className="h-8 w-12 bg-slate-300 rounded-lg"></div>
            </div>
          ))}
        </div>

        {/* Cards Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="p-6 bg-white rounded-3xl border border-slate-200 space-y-4">
              <div className="h-4 w-3/4 bg-slate-200 rounded"></div>
              <div className="h-12 w-full bg-slate-100 rounded-xl"></div>
              <div className="h-4 w-1/2 bg-slate-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-white rounded-3xl border border-slate-200 shadow-xs text-center space-y-4">
        <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-2xl flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="font-extrabold text-slate-900 text-sm">Erreur de chargement</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">{error}</p>
        </div>
        <button
          onClick={loadHomeworkData}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Réessayer</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner Header */}
      <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-600" />
            <span>Gestion des Devoirs & Travaux</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Créez, modifiez, publiez et gérez les devoirs pour vos classes attribuées
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreateModal}
          className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Nouveau devoir</span>
        </button>
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Devoirs</span>
          <p className="text-2xl font-black text-slate-900">{kpiTotal}</p>
        </div>
        <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider block">Brouillons</span>
          <p className="text-2xl font-black text-amber-600">{kpiDrafts}</p>
        </div>
        <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">Publiés</span>
          <p className="text-2xl font-black text-emerald-600">{kpiPublished}</p>
        </div>
        <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Annulés</span>
          <p className="text-2xl font-black text-slate-600">{kpiCancelled}</p>
        </div>
      </div>

      {/* Action Error Banner */}
      {actionError && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search & Filters */}
      <div className="p-4 bg-white rounded-3xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Rechercher par titre ou consignes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Filter className="w-4 h-4 text-amber-600" />
          <span>Filtres :</span>
        </div>

        {/* Class Filter */}
        <select
          aria-label="Filtre Classe"
          value={classFilter}
          onChange={e => setClassFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
        >
          <option value="all">Toutes mes classes</option>
          {assignedClasses.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Subject Filter */}
        <select
          aria-label="Filtre Matière"
          value={subjectFilter}
          onChange={e => setSubjectFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
        >
          <option value="all">Toutes mes matières</option>
          {assignedSubjects.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          aria-label="Filtre Statut"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
        >
          <option value="all">Tous les statuts</option>
          <option value="draft">Brouillons</option>
          <option value="published">Publiés</option>
          <option value="closed">Clôturés</option>
          <option value="cancelled">Annulés</option>
        </select>
      </div>

      {/* Homework Cards / Empty List */}
      {filteredHomeworks.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 shadow-xs space-y-3">
          <FileText className="w-12 h-12 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-800">Aucun devoir n’a encore été créé.</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Aucun devoir ne correspond à vos critères de recherche ou vous n'avez pas encore créé de devoir pour vos classes affectées.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredHomeworks.map(hw => {
            return (
              <div
                key={hw.id}
                className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4 hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div className="space-y-3">
                  {/* Badges Header */}
                  <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] font-bold">
                    <div className="flex items-center gap-1.5">
                      <span className="px-2.5 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded-lg">
                        {hw.class_name}
                      </span>
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg border border-slate-200">
                        {hw.subject_name}
                      </span>
                    </div>

                    <div>
                      {hw.status === 'draft' && (
                        <span className="px-2.5 py-1 bg-amber-100 text-amber-900 border border-amber-200 rounded-lg">
                          Brouillon
                        </span>
                      )}
                      {hw.status === 'published' && (
                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg">
                          Publié
                        </span>
                      )}
                      {hw.status === 'closed' && (
                        <span className="px-2.5 py-1 bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-lg">
                          Clôturé
                        </span>
                      )}
                      {hw.status === 'cancelled' && (
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg">
                          Annulé
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title & Instructions */}
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 line-clamp-1">{hw.title}</h3>
                    <p className="text-xs text-slate-600 line-clamp-2 mt-1 leading-relaxed">
                      {hw.instructions}
                    </p>
                  </div>

                  {/* Metadata */}
                  <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-400 block">Créé / Assigné</span>
                      <span className="text-slate-700 font-medium">
                        {hw.assigned_on ? new Date(hw.assigned_on).toLocaleDateString('fr-FR') : '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Échéance</span>
                      <span className="font-bold text-amber-700">
                        {hw.due_at ? `${new Date(hw.due_at).toLocaleDateString('fr-FR')} ${new Date(hw.due_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    onClick={() => {
                      setSelectedHomework(hw);
                      setShowDetailModal(true);
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Détails</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    {hw.status === 'draft' && (
                      <>
                        <button
                          onClick={() => handleOpenEditModal(hw)}
                          className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                          title="Modifier"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => {
                            setSelectedHomework(hw);
                            setShowPublishConfirmModal(true);
                          }}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                          title="Publier"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Publier</span>
                        </button>
                      </>
                    )}

                    {(hw.status === 'draft' || hw.status === 'published') && (
                      <button
                        onClick={() => {
                          setSelectedHomework(hw);
                          setCancelReason('');
                          setShowCancelConfirmModal(true);
                        }}
                        className="px-2.5 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                        title="Annuler"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Plus className="w-5 h-5 text-amber-600" />
                <span>Créer un nouveau devoir</span>
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="form-create-class" className="block text-xs font-bold text-slate-700 mb-1">Classe *</label>
                  <select
                    id="form-create-class"
                    aria-label="Sélectionner une classe"
                    value={formClassId}
                    onChange={e => {
                      const newCls = e.target.value;
                      setFormClassId(newCls);
                      const matched = assignedSubjects.filter(
                        s => s && typeof s.id === 'string' && s.id.trim() !== '' && (!s.class_id || s.class_id === newCls)
                      );
                      if (matched.length > 0) setFormSubjectId(matched[0].id);
                      else setFormSubjectId('');
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                    required
                  >
                    {assignedClasses.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="form-create-subject" className="block text-xs font-bold text-slate-700 mb-1">Matière *</label>
                  <select
                    id="form-create-subject"
                    aria-label="Sélectionner une matière"
                    value={formSubjectId}
                    onChange={e => setFormSubjectId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                    disabled={availableFormSubjects.length === 0}
                  >
                    {availableFormSubjects.length === 0 ? (
                      <option value="">-- Aucune matière affectée --</option>
                    ) : (
                      availableFormSubjects.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))
                    )}
                  </select>
                  {availableFormSubjects.length === 0 && (
                    <p className="text-xs text-rose-600 font-bold mt-1.5 p-2 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                      <span>Aucune matière ne vous est affectée pour cette classe. Contactez l’administration de l’établissement.</span>
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="form-create-title" className="block text-xs font-bold text-slate-700 mb-1">Titre du devoir *</label>
                <input
                  id="form-create-title"
                  type="text"
                  placeholder="Ex: Devoir de Mathématiques n°1"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="form-create-instructions" className="block text-xs font-bold text-slate-700 mb-1">Consignes *</label>
                <textarea
                  id="form-create-instructions"
                  rows={3}
                  placeholder="Saisissez les instructions détaillées pour les élèves et parents..."
                  value={formInstructions}
                  onChange={e => setFormInstructions(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="form-create-assignedon" className="block text-xs font-bold text-slate-700 mb-1">Date d'assignation</label>
                  <input
                    id="form-create-assignedon"
                    type="date"
                    value={formAssignedOn}
                    onChange={e => setFormAssignedOn(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label htmlFor="form-create-duedate" className="block text-xs font-bold text-slate-700 mb-1">Date limite *</label>
                  <input
                    id="form-create-duedate"
                    type="date"
                    value={formDueDate}
                    onChange={e => setFormDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="form-create-duetime" className="block text-xs font-bold text-slate-700 mb-1">Heure limite *</label>
                  <input
                    id="form-create-duetime"
                    type="time"
                    value={formDueTime}
                    onChange={e => setFormDueTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="form-create-minutes" className="block text-xs font-bold text-slate-700 mb-1">Durée estimée (minutes)</label>
                  <input
                    id="form-create-minutes"
                    type="number"
                    min="5"
                    max="300"
                    placeholder="Ex: 45"
                    value={formEstimatedMinutes}
                    onChange={e => setFormEstimatedMinutes(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Annuler
                </button>

                <button
                  type="submit"
                  disabled={submitting || !formSubjectId || formSubjectId.trim() === '' || availableFormSubjects.length === 0}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-black rounded-xl shadow-xs cursor-pointer transition-all"
                >
                  {submitting ? 'Création en cours...' : 'Enregistrer en brouillon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {showEditModal && selectedHomework && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-amber-600" />
                <span>Modifier le devoir</span>
              </h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label htmlFor="form-edit-title" className="block text-xs font-bold text-slate-700 mb-1">Titre du devoir *</label>
                <input
                  id="form-edit-title"
                  type="text"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="form-edit-instructions" className="block text-xs font-bold text-slate-700 mb-1">Consignes *</label>
                <textarea
                  id="form-edit-instructions"
                  rows={3}
                  value={formInstructions}
                  onChange={e => setFormInstructions(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="form-edit-assignedon" className="block text-xs font-bold text-slate-700 mb-1">Date d'assignation</label>
                  <input
                    id="form-edit-assignedon"
                    type="date"
                    value={formAssignedOn}
                    onChange={e => setFormAssignedOn(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label htmlFor="form-edit-duedate" className="block text-xs font-bold text-slate-700 mb-1">Date limite *</label>
                  <input
                    id="form-edit-duedate"
                    type="date"
                    value={formDueDate}
                    onChange={e => setFormDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="form-edit-duetime" className="block text-xs font-bold text-slate-700 mb-1">Heure limite *</label>
                  <input
                    id="form-edit-duetime"
                    type="time"
                    value={formDueTime}
                    onChange={e => setFormDueTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="form-edit-minutes" className="block text-xs font-bold text-slate-700 mb-1">Durée estimée (minutes)</label>
                  <input
                    id="form-edit-minutes"
                    type="number"
                    min="5"
                    max="300"
                    value={formEstimatedMinutes}
                    onChange={e => setFormEstimatedMinutes(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Annuler
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-black rounded-xl shadow-xs cursor-pointer transition-all"
                >
                  {submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PUBLISH CONFIRM MODAL */}
      {showPublishConfirmModal && selectedHomework && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="w-12 h-12 bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto">
              <Send className="w-6 h-6" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-base font-extrabold text-slate-900">Confirmer la publication</h3>
              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                Publier ce devoir le rendra visible aux parents et aux élèves concernés.
              </p>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-bold">
                "{selectedHomework.title}" ({selectedHomework.class_name} • {selectedHomework.subject_name})
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPublishConfirmModal(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Annuler
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={handlePublishSubmit}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-extrabold rounded-xl shadow-xs cursor-pointer transition-all flex items-center justify-center gap-1.5"
              >
                {submitting ? 'Publication...' : 'Confirmer la publication'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL CONFIRM MODAL */}
      {showCancelConfirmModal && selectedHomework && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="w-12 h-12 bg-rose-100 border border-rose-200 text-rose-700 rounded-2xl flex items-center justify-center mx-auto">
              <XCircle className="w-6 h-6" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-base font-extrabold text-slate-900">Annuler le devoir</h3>
              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                Annuler ce devoir le retirera de la liste des devoirs actifs visibles par les parents et les élèves concernés.
              </p>
            </div>

            <form onSubmit={handleCancelSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Motif de l'annulation *</label>
                <textarea
                  rows={2}
                  placeholder="Expliquez la raison de l'annulation..."
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCancelConfirmModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Fermer
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-extrabold rounded-xl shadow-xs cursor-pointer transition-all flex items-center justify-center gap-1.5"
                >
                  {submitting ? 'Annulation...' : 'Annuler le devoir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAIL MODAL */}
      {showDetailModal && selectedHomework && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-600" />
                <span>Détails du Devoir</span>
              </h3>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="px-2.5 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded-lg font-bold">
                    {selectedHomework.class_name}
                  </span>
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-bold">
                    {selectedHomework.subject_name}
                  </span>
                </div>

                <div>
                  {selectedHomework.status === 'draft' && (
                    <span className="px-2.5 py-1 bg-amber-100 text-amber-900 border border-amber-200 rounded-lg font-bold">
                      Brouillon
                    </span>
                  )}
                  {selectedHomework.status === 'published' && (
                    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg font-bold">
                      Publié
                    </span>
                  )}
                  {selectedHomework.status === 'closed' && (
                    <span className="px-2.5 py-1 bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-lg font-bold">
                      Clôturé
                    </span>
                  )}
                  {selectedHomework.status === 'cancelled' && (
                    <span className="px-2.5 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-bold">
                      Annulé
                    </span>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-base font-extrabold text-slate-900">{selectedHomework.title}</h4>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Consignes & Description</span>
                <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{selectedHomework.instructions}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50/50 border border-slate-100 rounded-xl text-[11px]">
                <div>
                  <span className="text-slate-400 block">Date d'assignation</span>
                  <span className="font-bold text-slate-700">
                    {selectedHomework.assigned_on ? new Date(selectedHomework.assigned_on).toLocaleDateString('fr-FR') : '-'}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block">Date limite de remise</span>
                  <span className="font-bold text-amber-700">
                    {selectedHomework.due_at ? `${new Date(selectedHomework.due_at).toLocaleDateString('fr-FR')} à ${new Date(selectedHomework.due_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '-'}
                  </span>
                </div>

                {selectedHomework.estimated_minutes && (
                  <div className="col-span-2">
                    <span className="text-slate-400 block">Durée estimée</span>
                    <span className="font-bold text-slate-800">{selectedHomework.estimated_minutes} minutes</span>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Fermer
              </button>

              {selectedHomework.status === 'draft' && (
                <button
                  type="button"
                  onClick={() => {
                    setShowDetailModal(false);
                    setShowPublishConfirmModal(true);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold rounded-xl shadow-xs cursor-pointer transition-all flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Publier</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherHomeworkModule;
