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

  const fileNameParts = file.name.split('.');
  const ext = fileNameParts.length > 1 ? fileNameParts.pop()?.toLowerCase() || 'pdf' : 'pdf';

  const formData = new FormData();
  formData.append('title', title.trim());
  if (description) formData.append('description', description.trim());
  formData.append('category', category);
  formData.append('target_scope', target_scope);
  if (class_id) formData.append('class_id', class_id);
  if (student_id) formData.append('student_id', student_id);
  formData.append('file_name', file.name);
  formData.append('file_extension', ext);
  formData.append('file', file);

  const { data, error } = await supabase.functions.invoke('admin-school-document-upload', {
    body: formData
  });

  if (error) {
    throw new Error(error.message || 'Échec du téléversement du document.');
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
