// Service Frontend : Gestion des documents scolaires pour l'administration (Lot 2F-D)
// Fichier : src/services/adminDocumentService.ts

import { supabase } from '../lib/supabase';

export interface AdminDocumentItem {
  id: string;
  school_id: string;
  title: string;
  description: string;
  category: 'administrative' | 'academic' | 'rules' | 'course_material' | 'certificate' | 'other';
  target_scope: 'school' | 'class' | 'student';
  class_id?: string | null;
  class_name?: string;
  student_id?: string | null;
  student_name?: string;
  academic_year_id?: string | null;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  checksum_sha256: string;
  status: 'draft' | 'published' | 'archived';
  published_at?: string | null;
  archived_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AdminSchoolDocumentsResult {
  school_id: string;
  kpi: {
    total_documents: number;
    draft_count: number;
    published_count: number;
    archived_count: number;
  };
  documents: AdminDocumentItem[];
}

export interface AdminDocumentFilterOptions {
  status?: string;
  category?: string;
}

export interface UploadSchoolDocumentPayload {
  title: string;
  description?: string;
  category: 'administrative' | 'academic' | 'rules' | 'course_material' | 'certificate' | 'other';
  target_scope: 'school' | 'class' | 'student';
  class_id?: string | null;
  student_id?: string | null;
  academic_year_id?: string | null;
  file: File;
}

export interface AdminDocumentOperationResult {
  success: boolean;
  document_id: string;
  status: 'draft' | 'published' | 'archived';
  message?: string;
}

/**
 * Récupère la liste sécurisée des documents scolaires de l'établissement de l'administrateur connecté.
 * Transmet exclusivement les filtres optionnels p_status et p_category.
 */
export async function fetchAdminSchoolDocuments(
  filters?: AdminDocumentFilterOptions
): Promise<AdminSchoolDocumentsResult> {
  const p_status = filters?.status && filters.status !== 'all' ? filters.status : null;
  const p_category = filters?.category && filters.category !== 'all' ? filters.category : null;

  const { data, error } = await supabase.rpc('get_admin_school_documents', {
    p_status,
    p_category
  });

  if (error) {
    throw new Error(error.message || 'Impossible de charger les documents de l’établissement.');
  }

  if (!data) {
    return {
      school_id: '',
      kpi: {
        total_documents: 0,
        draft_count: 0,
        published_count: 0,
        archived_count: 0
      },
      documents: []
    };
  }

  return data as AdminSchoolDocumentsResult;
}

/**
 * Convertit un fichier en chaîne base64 pure (sans préfixe data URL).
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Téléverse un nouveau document scolaire via l'Edge Function sécurisée admin-school-document-upload.
 * Ne transmet ni user_id ni school_id (résolus côté serveur via JWT).
 */
export async function uploadSchoolDocument(
  payload: UploadSchoolDocumentPayload
): Promise<AdminDocumentOperationResult> {
  const { title, description, category, target_scope, class_id, student_id, file } = payload;

  if (!title || !title.trim()) {
    throw new Error('Le titre du document est obligatoire.');
  }

  if (!file) {
    throw new Error('Un fichier doit être sélectionné.');
  }

  if (file.size > 15 * 1024 * 1024) {
    throw new Error('La taille du fichier excède la limite maximale autorisée de 15 Mo.');
  }

  const allowedMimeTypes = ['application/pdf', 'image/png', 'image/jpeg'];
  if (!allowedMimeTypes.includes(file.type)) {
    throw new Error('Format de fichier non autorisé. Seuls les fichiers PDF, PNG et JPEG sont acceptés.');
  }

  if (target_scope === 'class' && !class_id) {
    throw new Error('Une classe doit être sélectionnée pour la portée "Classe".');
  }

  if (target_scope === 'student' && !student_id) {
    throw new Error('Un élève doit être sélectionné pour la portée "Individuel".');
  }

  const fileBase64 = await fileToBase64(file);

  const payloadData = {
    title: title.trim(),
    description: description ? description.trim() : null,
    category,
    target_scope,
    class_id: class_id || null,
    student_id: student_id || null,
    file_name: file.name,
    mime_type: file.type || 'application/pdf',
    file_base64: fileBase64
  };

  const { data, error } = await supabase.functions.invoke('admin-school-document-upload', {
    body: payloadData
  });

  if (error) {
    let detailMsg = error.message;
    try {
      if ('context' in error && error.context && typeof (error.context as Response).json === 'function') {
        const errJson = await (error.context as Response).json();
        if (errJson && errJson.error) {
          detailMsg = errJson.error;
        }
      }
    } catch {
      // Conserver le detailMsg initial en cas d'erreur de lecture du contexte
    }
    throw new Error(detailMsg || 'Échec du téléversement du document.');
  }

  if (!data || !data.document_id) {
    throw new Error('Le serveur n’a pas retourné de confirmation de téléversement valide.');
  }

  return {
    success: true,
    document_id: data.document_id,
    status: 'draft',
    message: 'Document téléversé avec succès. Vous pouvez maintenant le publier.'
  };
}

/**
 * Publie un document scolaire au statut draft via la RPC sécurisée admin_publish_school_document.
 */
export async function publishSchoolDocument(
  documentId: string
): Promise<AdminDocumentOperationResult> {
  if (!documentId) {
    throw new Error('Identifiant de document invalide.');
  }

  const { error } = await supabase.rpc('admin_publish_school_document', {
    p_document_id: documentId
  });

  if (error) {
    throw new Error(error.message || 'Erreur lors de la publication du document.');
  }

  return {
    success: true,
    document_id: documentId,
    status: 'published',
    message: 'Le document a été publié avec succès.'
  };
}

/**
 * Archive un document scolaire au statut published via la RPC sécurisée admin_archive_school_document.
 */
export async function archiveSchoolDocument(
  documentId: string
): Promise<AdminDocumentOperationResult> {
  if (!documentId) {
    throw new Error('Identifiant de document invalide.');
  }

  const { error } = await supabase.rpc('admin_archive_school_document', {
    p_document_id: documentId
  });

  if (error) {
    throw new Error(error.message || 'Erreur lors de l’archivage du document.');
  }

  return {
    success: true,
    document_id: documentId,
    status: 'archived',
    message: 'Le document a été archivé avec succès.'
  };
}
