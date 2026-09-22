// Composant Parent : Module de consultation et téléchargement des documents scolaires réels (Lot 2F-C)
// Fichier : src/components/parent/ParentDocumentsModule.tsx

import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Search,
  Download,
  AlertCircle,
  FileCheck,
  Building2,
  Users,
  UserCheck,
  RefreshCw,
  FileSpreadsheet,
  Image as ImageIcon,
  CheckCircle2
} from 'lucide-react';
import {
  fetchParentStudentDocuments,
  downloadParentDocument,
  type ParentDocumentItem
} from '../../services/parentDocumentService';

interface ParentDocumentsModuleProps {
  studentId: string;
  studentName?: string;
}

export const ParentDocumentsModule: React.FC<ParentDocumentsModuleProps> = ({
  studentId,
  studentName
}) => {
  const [documents, setDocuments] = useState<ParentDocumentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filtres et Recherche
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Téléchargement individuel
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<{ id: string; message: string } | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<{ id: string; message: string } | null>(null);

  // Effet de chargement avec annulation des réponses obsolètes lors du changement d'enfant
  useEffect(() => {
    let isCancelled = false;

    // Réinitialisation synchrone immédiate pour éviter tout mélange entre enfants / écoles
    setDocuments([]);
    setError(null);
    setLoading(true);
    setDownloadingDocId(null);
    setDownloadError(null);
    setDownloadSuccess(null);

    if (!studentId) {
      setLoading(false);
      return;
    }

    fetchParentStudentDocuments(studentId)
      .then(res => {
        if (!isCancelled) {
          setDocuments(res.documents || []);
          setError(null);
        }
      })
      .catch(err => {
        if (!isCancelled) {
          setDocuments([]);
          setError(err.message || 'Impossible de charger la liste des documents scolaires.');
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [studentId]);

  // Filtrage combiné par catégorie et recherche par titre
  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      const matchesSearch =
        !searchQuery.trim() ||
        doc.title.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        (doc.description && doc.description.toLowerCase().includes(searchQuery.toLowerCase().trim())) ||
        doc.file_name.toLowerCase().includes(searchQuery.toLowerCase().trim());

      const matchesCategory =
        selectedCategory === 'all' || doc.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [documents, searchQuery, selectedCategory]);

  // Déclencheur du téléchargement sécurisé
  const handleDownload = async (doc: ParentDocumentItem) => {
    if (downloadingDocId || !studentId) return;

    setDownloadingDocId(doc.id);
    setDownloadError(null);
    setDownloadSuccess(null);

    try {
      const result = await downloadParentDocument(studentId, doc.id);

      if (!result.success || !result.download_url) {
        throw new Error('Aucune autorisation de téléchargement valide n’a été reçue.');
      }

      // Vérification stricte HTTPS
      const url = result.download_url;
      const isHttps = url.startsWith('https://');
      const isLocalhost = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) && url.startsWith('http://');

      if (!isHttps && !isLocalhost) {
        throw new Error('URL de téléchargement non sécurisée (HTTPS obligatoire).');
      }

      // Lancement du téléchargement sans conserver d'URL dans localStorage/sessionStorage
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.download = result.file_name || doc.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setDownloadSuccess({
        id: doc.id,
        message: `Téléchargement de "${doc.file_name}" démarré (Autorisation 120s).`
      });

      // Effacer la notification de succès après 5 secondes
      setTimeout(() => {
        setDownloadSuccess(prev => (prev?.id === doc.id ? null : prev));
      }, 5000);

    } catch (err: any) {
      setDownloadError({
        id: doc.id,
        message: err.message || 'Ce document n’est plus disponible ou l’accès a été refusé.'
      });
    } finally {
      setDownloadingDocId(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getCategoryLabel = (category: string): string => {
    switch (category) {
      case 'rules':
        return 'Règlement Intérieur';
      case 'administrative':
        return 'Administratif';
      case 'academic':
        return 'Académique';
      case 'course_material':
        return 'Support de Cours';
      case 'certificate':
        return 'Certificat / Attestation';
      default:
        return 'Général';
    }
  };

  const getScopeBadge = (scope: string) => {
    switch (scope) {
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
            Toute la classe
          </span>
        );
      case 'student':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200">
            <UserCheck className="w-3 h-3" />
            Individuel
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            Documents & Attestations Scolaires
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Consultez et téléchargez les règlements, attestations et documents administratifs publiés pour {studentName || 'votre enfant'}.
          </p>
        </div>

        {/* Barre de Recherche et Filtres */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher par titre..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-medium"
            />
          </div>

          <div className="relative w-full sm:w-48">
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-bold"
            >
              <option value="all">Toutes les catégories</option>
              <option value="rules">Règlement Intérieur</option>
              <option value="administrative">Administratif</option>
              <option value="academic">Académique</option>
              <option value="course_material">Supports de cours</option>
              <option value="certificate">Certificats / Attestations</option>
              <option value="other">Autre</option>
            </select>
          </div>
        </div>
      </div>

      {/* État d'erreur contrôlé */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchParentStudentDocuments(studentId)
                .then(res => { setDocuments(res.documents || []); setError(null); })
                .catch(err => setError(err.message))
                .finally(() => setLoading(false));
            }}
            className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-900 rounded-xl font-bold flex items-center gap-1 cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Réessayer
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(idx => (
            <div key={idx} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4 animate-pulse">
              <div className="flex justify-between items-start">
                <div className="h-4 bg-slate-200 rounded-full w-2/3"></div>
                <div className="h-4 bg-slate-200 rounded-full w-1/4"></div>
              </div>
              <div className="h-3 bg-slate-100 rounded-full w-5/6"></div>
              <div className="h-3 bg-slate-100 rounded-full w-1/2"></div>
              <div className="pt-4 flex justify-between items-center">
                <div className="h-6 bg-slate-100 rounded-xl w-24"></div>
                <div className="h-8 bg-slate-200 rounded-xl w-28"></div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredDocuments.length === 0 ? (
        /* État vide contrôlé */
        <div className="p-16 text-center bg-white rounded-3xl border border-slate-200 space-y-3 shadow-xs">
          <FileCheck className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-extrabold text-slate-900">
            Aucun document scolaire n’est actuellement disponible.
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            {searchQuery || selectedCategory !== 'all'
              ? 'Aucun document ne correspond à vos critères de recherche ou de filtre.'
              : 'L’établissement de votre enfant n’a publié aucun document général ou individuel pour le moment.'}
          </p>
        </div>
      ) : (
        /* Liste des documents réels */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredDocuments.map(doc => {
            const isPdf = doc.mime_type === 'application/pdf';
            const isDownloading = downloadingDocId === doc.id;
            const docErr = downloadError?.id === doc.id ? downloadError.message : null;
            const docSuccess = downloadSuccess?.id === doc.id ? downloadSuccess.message : null;

            return (
              <div
                key={doc.id}
                className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  {/* Top Badges Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700">
                        {getCategoryLabel(doc.category)}
                      </span>
                      {getScopeBadge(doc.target_scope)}
                    </div>

                    <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 shrink-0">
                      {isPdf ? (
                        <FileSpreadsheet className="w-4 h-4 text-rose-500" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-blue-500" />
                      )}
                      <span>{doc.mime_type === 'application/pdf' ? 'PDF' : 'Image'}</span>
                    </div>
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

                {/* Bottom File Metadata & Download Action */}
                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-mono text-slate-500 truncate max-w-[160px]" title={doc.file_name}>
                      {doc.file_name}
                    </span>
                    <span>{formatFileSize(doc.file_size_bytes)}</span>
                    <span>Publié le {new Date(doc.published_at).toLocaleDateString('fr-FR')}</span>
                  </div>

                  {docErr && (
                    <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-[11px] font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                      <span>{docErr}</span>
                    </div>
                  )}

                  {docSuccess && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-[11px] font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                      <span>{docSuccess}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={isDownloading || !!downloadingDocId}
                    onClick={() => handleDownload(doc)}
                    className="w-full py-2.5 px-4 bg-slate-900 hover:bg-blue-600 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className={`w-4 h-4 text-amber-400 ${isDownloading ? 'animate-bounce' : ''}`} />
                    <span>{isDownloading ? 'Génération du lien sécurisé...' : 'Télécharger le Document'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ParentDocumentsModule;
