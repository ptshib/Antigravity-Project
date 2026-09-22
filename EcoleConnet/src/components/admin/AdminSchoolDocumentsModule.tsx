// Composant Admin : Module complet de gestion des documents scolaires (Lot 2F-D)
// Fichier : src/components/admin/AdminSchoolDocumentsModule.tsx

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Search,
  Plus,
  AlertCircle,
  CheckCircle2,
  Building2,
  Users,
  UserCheck,
  RefreshCw,
  FileSpreadsheet,
  Image as ImageIcon,
  Send,
  Archive,
  Clock,
  FileCheck
} from 'lucide-react';
import {
  fetchAdminSchoolDocuments,
  publishSchoolDocument,
  archiveSchoolDocument,
  type AdminDocumentItem,
  type AdminSchoolDocumentsResult
} from '../../services/adminDocumentService';
import { AdminSchoolDocumentUploadModal } from './AdminSchoolDocumentUploadModal';

interface ClassOption {
  id: string;
  name: string;
}

interface StudentOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  class_id: string | null;
  student_number?: string;
}

interface AdminSchoolDocumentsModuleProps {
  classes?: ClassOption[];
  students?: StudentOption[];
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const AdminSchoolDocumentsModule: React.FC<AdminSchoolDocumentsModuleProps> = ({
  classes = [],
  students = [],
  onShowToast
}) => {
  const [data, setData] = useState<AdminSchoolDocumentsResult>({
    school_id: '',
    kpi: {
      total_documents: 0,
      draft_count: 0,
      published_count: 0,
      archived_count: 0
    },
    documents: []
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filtres et recherche
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Modales
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [confirmPublishDoc, setConfirmPublishDoc] = useState<AdminDocumentItem | null>(null);
  const [confirmArchiveDoc, setConfirmArchiveDoc] = useState<AdminDocumentItem | null>(null);

  // États d'action
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localToast, setLocalToast] = useState<string | null>(null);

  // Fonction de chargement avec protection contre les réponses obsolètes
  const loadDocuments = useCallback(async (isCancelledCheck?: () => boolean) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetchAdminSchoolDocuments({
        status: statusFilter,
        category: categoryFilter
      });

      if (!isCancelledCheck || !isCancelledCheck()) {
        setData(res);
        setError(null);
      }
    } catch (err: any) {
      if (!isCancelledCheck || !isCancelledCheck()) {
        setError(err.message || 'Impossible de charger la liste des documents.');
      }
    } finally {
      if (!isCancelledCheck || !isCancelledCheck()) {
        setLoading(false);
      }
    }
  }, [statusFilter, categoryFilter]);

  useEffect(() => {
    let isCancelled = false;
    loadDocuments(() => isCancelled);

    return () => {
      isCancelled = true;
    };
  }, [loadDocuments]);

  // Helper Toast
  const notify = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    if (onShowToast) {
      onShowToast(msg, type);
    } else {
      setLocalToast(msg);
      setTimeout(() => setLocalToast(null), 4000);
    }
  };

  // Filtrage local par titre / recherche
  const filteredDocuments = useMemo(() => {
    return data.documents.filter(doc => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        doc.title.toLowerCase().includes(q) ||
        (doc.description && doc.description.toLowerCase().includes(q)) ||
        doc.file_name.toLowerCase().includes(q) ||
        (doc.class_name && doc.class_name.toLowerCase().includes(q)) ||
        (doc.student_name && doc.student_name.toLowerCase().includes(q))
      );
    });
  }, [data.documents, searchQuery]);

  // Exécution de la publication
  const handlePublish = async () => {
    if (!confirmPublishDoc || actionInProgress) return;
    setActionInProgress(true);
    setActionError(null);

    try {
      const res = await publishSchoolDocument(confirmPublishDoc.id);
      if (res.success) {
        notify('Le document a été publié avec succès.');
        setConfirmPublishDoc(null);
        await loadDocuments();
      }
    } catch (err: any) {
      setActionError(err.message || 'Erreur lors de la publication du document.');
    } fontally: {
      setActionInProgress(false);
    }
  };

  // Exécution de l'archivage
  const handleArchive = async () => {
    if (!confirmArchiveDoc || actionInProgress) return;
    setActionInProgress(true);
    setActionError(null);

    try {
      const res = await archiveSchoolDocument(confirmArchiveDoc.id);
      if (res.success) {
        notify('Le document a été archivé avec succès.');
        setConfirmArchiveDoc(null);
        await loadDocuments();
      }
    } catch (err: any) {
      setActionError(err.message || 'Erreur lors de l’archivage du document.');
    } finally {
      setActionInProgress(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getCategoryLabel = (cat: string): string => {
    switch (cat) {
      case 'rules': return 'Règlement Intérieur';
      case 'administrative': return 'Administratif';
      case 'academic': return 'Académique';
      case 'course_material': return 'Support de Cours';
      case 'certificate': return 'Certificat / Attestation';
      default: return 'Général';
    }
  };

  const getScopeBadge = (doc: AdminDocumentItem) => {
    switch (doc.target_scope) {
      case 'school':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 text-blue-700 border border-blue-200">
            <Building2 className="w-3 h-3" />
            Toute l'école
          </span>
        );
      case 'class':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-50 text-purple-700 border border-purple-200">
            <Users className="w-3 h-3" />
            Classe : {doc.class_name || 'Non spécifiée'}
          </span>
        );
      case 'student':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200">
            <UserCheck className="w-3 h-3" />
            Élève : {doc.student_name || 'Individuel'}
          </span>
        );
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            Brouillon
          </span>
        );
      case 'published':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Publié
          </span>
        );
      case 'archived':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
            <Archive className="w-3 h-3 text-slate-500" />
            Archivé
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Toast local si pas de toast global */}
      {localToast && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs font-extrabold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{localToast}</span>
        </div>
      )}

      {/* Header Banner Admin */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            Gestion des Documents Scolaires
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Téléversez, publiez et observez l’archivage des documents scolaires officiels de votre établissement.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowUploadModal(true)}
          className="px-4 py-2.5 bg-slate-900 hover:bg-blue-600 text-white font-extrabold text-xs rounded-xl flex items-center gap-2 cursor-pointer shadow-xs transition-colors shrink-0"
        >
          <Plus className="w-4 h-4 text-amber-400" />
          <span>Nouveau Document</span>
        </button>
      </div>

      {/* Cartes KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-1">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Documents</p>
          <p className="text-2xl font-black text-slate-900">{data.kpi.total_documents}</p>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-amber-200 bg-amber-50/30 shadow-xs space-y-1">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Brouillons (Draft)</p>
          <p className="text-2xl font-black text-amber-900">{data.kpi.draft_count}</p>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-emerald-200 bg-emerald-50/30 shadow-xs space-y-1">
          <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Publiés</p>
          <p className="text-2xl font-black text-emerald-900">{data.kpi.published_count}</p>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-slate-200 bg-slate-50/50 shadow-xs space-y-1">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Archivés</p>
          <p className="text-2xl font-black text-slate-800">{data.kpi.archived_count}</p>
        </div>
      </div>

      {/* Barre de Recherche et Filtres */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Rechercher par titre, fichier..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-medium"
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          {/* Filtre Statut */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full sm:w-40 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-bold"
          >
            <option value="all">Tous les statuts</option>
            <option value="draft">Brouillons</option>
            <option value="published">Publiés</option>
            <option value="archived">Archivés</option>
          </select>

          {/* Filtre Catégorie */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="w-full sm:w-48 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-bold"
          >
            <option value="all">Toutes les catégories</option>
            <option value="administrative">Administratif</option>
            <option value="rules">Règlement Intérieur</option>
            <option value="academic">Académique</option>
            <option value="course_material">Supports de cours</option>
            <option value="certificate">Certificats / Attestations</option>
            <option value="other">Autre</option>
          </select>
        </div>
      </div>

      {/* Banner Erreur globale */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => loadDocuments()}
            className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-900 rounded-xl font-bold flex items-center gap-1 cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Réessayer
          </button>
        </div>
      )}

      {/* Skeletons ou Liste des Documents */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(idx => (
            <div key={idx} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4 animate-pulse">
              <div className="flex justify-between items-start">
                <div className="h-4 bg-slate-200 rounded-full w-2/3"></div>
                <div className="h-4 bg-slate-200 rounded-full w-1/4"></div>
              </div>
              <div className="h-3 bg-slate-100 rounded-full w-5/6"></div>
              <div className="pt-4 flex justify-between items-center">
                <div className="h-6 bg-slate-100 rounded-xl w-24"></div>
                <div className="h-8 bg-slate-200 rounded-xl w-28"></div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-3xl border border-slate-200 space-y-3 shadow-xs">
          <FileCheck className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-extrabold text-slate-900">
            Aucun document scolaire n'a été trouvé.
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            {searchQuery || statusFilter !== 'all' || categoryFilter !== 'all'
              ? 'Aucun document ne correspond à vos critères de recherche ou de filtre.'
              : 'Votre établissement n’a créé aucun document scolaire pour le moment. Cliquez sur "Nouveau Document" pour commencer.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredDocuments.map(doc => {
            const isPdf = doc.mime_type === 'application/pdf';

            return (
              <div
                key={doc.id}
                className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  {/* Badges d'entête */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700">
                        {getCategoryLabel(doc.category)}
                      </span>
                      {getScopeBadge(doc)}
                    </div>
                    {getStatusBadge(doc.status)}
                  </div>

                  {/* Titre & Description */}
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                      {doc.title}
                    </h3>
                    {doc.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                        {doc.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Pied de Carte et Métadonnées */}
                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-mono text-slate-500 truncate max-w-[160px]" title={doc.file_name}>
                      {doc.file_name}
                    </span>
                    <span>{formatFileSize(doc.file_size_bytes)}</span>
                    <span className="flex items-center gap-1">
                      {isPdf ? <FileSpreadsheet className="w-3.5 h-3.5 text-rose-500" /> : <ImageIcon className="w-3.5 h-3.5 text-blue-500" />}
                      {isPdf ? 'PDF' : 'Image'}
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-400 space-y-0.5">
                    <p>Créé le : {new Date(doc.created_at).toLocaleDateString('fr-FR')}</p>
                    {doc.published_at && (
                      <p className="text-emerald-600 font-semibold">Publié le : {new Date(doc.published_at).toLocaleDateString('fr-FR')}</p>
                    )}
                    {doc.archived_at && (
                      <p className="text-slate-500 italic">Archivé le : {new Date(doc.archived_at).toLocaleDateString('fr-FR')}</p>
                    )}
                  </div>

                  {/* Actions conditionnelles selon le statut */}
                  <div className="pt-2 flex items-center justify-end gap-2">
                    {doc.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionError(null);
                          setConfirmPublishDoc(doc);
                        }}
                        className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Publier ce Document</span>
                      </button>
                    )}

                    {doc.status === 'published' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionError(null);
                          setConfirmArchiveDoc(doc);
                        }}
                        className="w-full py-2 px-3 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 hover:border-rose-200 font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archiver ce Document</span>
                      </button>
                    )}

                    {doc.status === 'archived' && (
                      <div className="w-full py-2 text-center text-xs font-bold text-slate-400 bg-slate-50 rounded-xl border border-slate-100 italic">
                        Document archivé (Consultation uniquement)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modale Téléversement */}
      <AdminSchoolDocumentUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSuccess={msg => {
          notify(msg);
          loadDocuments();
        }}
        classes={classes}
        students={students}
      />

      {/* Modale Confirmation Publication */}
      {confirmPublishDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full border border-slate-200 p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                <Send className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Publier le Document</h3>
                <p className="text-xs text-slate-500 truncate max-w-xs">{confirmPublishDoc.title}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed font-medium bg-emerald-50/50 border border-emerald-100 p-3.5 rounded-2xl">
              Publier ce document le rendra accessible aux parents concernés.
            </p>

            {actionError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={actionInProgress}
                onClick={() => setConfirmPublishDoc(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={actionInProgress}
                onClick={handlePublish}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors disabled:opacity-50"
              >
                {actionInProgress ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>Confirmer la Publication</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Confirmation Archivage */}
      {confirmArchiveDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full border border-slate-200 p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
                <Archive className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Archiver le Document</h3>
                <p className="text-xs text-slate-500 truncate max-w-xs">{confirmArchiveDoc.title}</p>
              </div>
            </div>

            <p className="text-xs text-rose-800 leading-relaxed font-medium bg-rose-50 border border-rose-100 p-3.5 rounded-2xl">
              Archiver ce document empêchera immédiatement tout nouveau téléchargement par les parents.
            </p>

            {actionError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={actionInProgress}
                onClick={() => setConfirmArchiveDoc(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={actionInProgress}
                onClick={handleArchive}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors disabled:opacity-50"
              >
                {actionInProgress ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
                <span>Confirmer l'Archivage</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminSchoolDocumentsModule;
