// Composant Modale Admin : Téléversement d'un nouveau document scolaire (Lot 2F-D)
// Fichier : src/components/admin/AdminSchoolDocumentUploadModal.tsx

import React, { useState, useMemo } from 'react';
import {
  FileText,
  Upload,
  AlertCircle,
  X,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import {
  uploadSchoolDocument,
  type UploadSchoolDocumentPayload
} from '../../services/adminDocumentService';

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

interface AdminSchoolDocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  classes: ClassOption[];
  students: StudentOption[];
}

export const AdminSchoolDocumentUploadModal: React.FC<AdminSchoolDocumentUploadModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  classes,
  students
}) => {
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [category, setCategory] = useState<UploadSchoolDocumentPayload['category']>('administrative');
  const [targetScope, setTargetScope] = useState<'school' | 'class' | 'student'>('school');
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filtrage dynamique des élèves si une classe est sélectionnée comme filtre
  const filteredStudents = useMemo(() => {
    if (!selectedClassId) return students;
    return students.filter(s => s.class_id === selectedClassId);
  }, [students, selectedClassId]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = e.target.files;
    if (!files || files.length === 0) {
      setSelectedFile(null);
      return;
    }

    const file = files[0];
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];
    if (!allowedTypes.includes(file.type)) {
      setError('Type de fichier non autorisé. Seuls les fichiers PDF, PNG et JPEG sont acceptés.');
      setSelectedFile(null);
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setError('La taille du fichier excède la limite maximale autorisée de 15 Mo.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Le titre du document est obligatoire.');
      return;
    }

    if (!selectedFile) {
      setError('Veuillez sélectionner un fichier à téléverser.');
      return;
    }

    if (targetScope === 'class' && !selectedClassId) {
      setError('Veuillez sélectionner une classe pour la portée "Toute la classe".');
      return;
    }

    if (targetScope === 'student' && !selectedStudentId) {
      setError('Veuillez sélectionner un élève pour la portée "Individuel".');
      return;
    }

    setSubmitting(true);

    try {
      const result = await uploadSchoolDocument({
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        target_scope: targetScope,
        class_id: targetScope === 'class' ? selectedClassId : undefined,
        student_id: targetScope === 'student' ? selectedStudentId : undefined,
        file: selectedFile
      });

      if (result.success) {
        onSuccess('Document téléversé avec succès. Vous pouvez maintenant le publier.');
        onClose();
        // Reset form
        setTitle('');
        setDescription('');
        setCategory('administrative');
        setTargetScope('school');
        setSelectedClassId('');
        setSelectedStudentId('');
        setSelectedFile(null);
      }
    } catch (err: any) {
      setError(err.message || 'Échec du téléversement du document.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col my-8 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header Modale */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-2xl">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Téléverser un Nouveau Document Scolaire
              </h3>
              <p className="text-xs text-slate-500">
                Le document sera créé au statut brouillon et pourra être publié ensuite.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Banner Erreur */}
        {error && (
          <div className="mx-6 mt-4 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Formulaire Modale */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          
          {/* Titre */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Titre du document <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="ex: Règlement Intérieur 2026-2027"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-medium"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Description (facultative)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brève note explicative pour les parents ou l'élève..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-medium"
            />
          </div>

          {/* Catégorie & Portée */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Catégorie <span className="text-rose-500">*</span>
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as any)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-bold"
              >
                <option value="administrative">Administratif</option>
                <option value="rules">Règlement Intérieur</option>
                <option value="academic">Académique</option>
                <option value="course_material">Support de Cours</option>
                <option value="certificate">Certificat / Attestation</option>
                <option value="other">Autre</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Portée du document <span className="text-rose-500">*</span>
              </label>
              <select
                value={targetScope}
                onChange={e => {
                  const scope = e.target.value as any;
                  setTargetScope(scope);
                  if (scope === 'school') {
                    setSelectedClassId('');
                    setSelectedStudentId('');
                  }
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-bold"
              >
                <option value="school">Toute l'école</option>
                <option value="class">Toute la classe</option>
                <option value="student">Individuel (Un élève)</option>
              </select>
            </div>
          </div>

          {/* Sélection Classe si Scope == 'class' ou 'student' */}
          {(targetScope === 'class' || targetScope === 'student') && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {targetScope === 'class' ? (
                  <>Sélectionner la classe <span className="text-rose-500">*</span></>
                ) : (
                  'Filtrer les élèves par classe (facultatif)'
                )}
              </label>
              <select
                value={selectedClassId}
                onChange={e => {
                  setSelectedClassId(e.target.value);
                  setSelectedStudentId('');
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="">-- Choisir une classe --</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sélection Élève si Scope == 'student' */}
          {targetScope === 'student' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Sélectionner l'élève <span className="text-rose-500">*</span>
              </label>
              <select
                value={selectedStudentId}
                onChange={e => setSelectedStudentId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="">-- Choisir un élève --</option>
                {filteredStudents.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.first_name || ''} {s.last_name || ''} ({s.student_number || s.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Fichier Obligatoire */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Fichier (PDF, PNG, JPEG - Max 15 Mo) <span className="text-rose-500">*</span>
            </label>
            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-200 border-dashed rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className="space-y-1 text-center">
                <FileText className="mx-auto h-8 w-8 text-slate-400" />
                <div className="flex text-xs text-slate-600 font-medium">
                  <label htmlFor="file-upload" className="relative cursor-pointer bg-white rounded-md font-bold text-blue-600 hover:text-blue-500 focus-within:outline-none">
                    <span>Parcourir un fichier</span>
                    <input
                      id="file-upload"
                      name="file-upload"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                      onChange={handleFileChange}
                      className="sr-only"
                    />
                  </label>
                  <p className="pl-1">ou glisser-déposer ici</p>
                </div>
                {selectedFile ? (
                  <p className="text-xs font-extrabold text-emerald-600 mt-2 flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-4 h-4" />
                    {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} Mo)
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400">PDF, PNG, JPG jusqu'à 15 Mo</p>
                )}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedFile || !title.trim()}
              className="px-5 py-2.5 bg-slate-900 hover:bg-blue-600 text-white font-extrabold text-xs rounded-xl flex items-center gap-2 cursor-pointer shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Téléversement...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>Créer le Brouillon</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminSchoolDocumentUploadModal;
