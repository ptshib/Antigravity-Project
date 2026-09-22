// Service Frontend : Gestion des documents scolaires du Portail Parent (Lot 2F-C)
// Fichier : src/services/parentDocumentService.ts

import { supabase } from '../lib/supabase';

export interface ParentDocumentItem {
  id: string;
  title: string;
  description: string;
  category: 'administrative' | 'academic' | 'rules' | 'course_material' | 'certificate' | 'other';
  target_scope: 'school' | 'class' | 'student';
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  published_at: string;
  created_at: string;
}

export interface ParentStudentDocumentsResult {
  student_id: string;
  student_number: string;
  student_name: string;
  summary: {
    total_documents: number;
  };
  documents: ParentDocumentItem[];
}

export interface ParentDocumentDownloadResult {
  success: boolean;
  download_url: string;
  expires_in_seconds: number;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  checksum_sha256?: string;
}

/**
 * Récupère la liste des documents scolaires réels publiés accessibles pour l'enfant sélectionné.
 * Transmet exclusivement p_student_id à la RPC Gateway.
 */
export async function fetchParentStudentDocuments(
  studentId: string
): Promise<ParentStudentDocumentsResult> {
  if (!studentId || typeof studentId !== 'string') {
    throw new Error('Identifiant élève invalide.');
  }

  const { data, error } = await supabase.rpc('get_parent_student_documents', {
    p_student_id: studentId
  });

  if (error) {
    throw new Error(error.message || 'Impossible de récupérer la liste des documents scolaires.');
  }

  if (!data) {
    return {
      student_id: studentId,
      student_number: '',
      student_name: '',
      summary: { total_documents: 0 },
      documents: []
    };
  }

  return data as ParentStudentDocumentsResult;
}

/**
 * Invoque l'Edge Function sécurisée pour demander une autorisation et obtenir une signed URL temporaire.
 * Transmet exclusivement student_id et document_id.
 */
export async function downloadParentDocument(
  studentId: string,
  documentId: string
): Promise<ParentDocumentDownloadResult> {
  if (!studentId || !documentId) {
    throw new Error('Paramètres d’identification incomplets.');
  }

  const { data, error } = await supabase.functions.invoke('parent-school-document-download', {
    body: {
      student_id: studentId,
      document_id: documentId
    }
  });

  if (error) {
    throw new Error(error.message || 'Autorisation de téléchargement refusée ou document non disponible.');
  }

  if (!data || !data.download_url) {
    throw new Error('Aucune URL de téléchargement sécurisée n’a été générée.');
  }

  const urlString = String(data.download_url);
  
  // Validation stricte de l'URL HTTPS avant toute tentative de téléchargement
  const isHttps = urlString.startsWith('https://');
  const isLocalhostDev = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) && (urlString.startsWith('http://localhost') || urlString.startsWith('http://127.0.0.1'));

  if (!isHttps && !isLocalhostDev) {
    throw new Error('L’URL de téléchargement retournée n’est pas sécurisée (HTTPS requis).');
  }

  return {
    success: true,
    download_url: urlString,
    expires_in_seconds: Number(data.expires_in_seconds || 120),
    file_name: String(data.file_name || 'document.pdf'),
    file_size_bytes: Number(data.file_size_bytes || 0),
    mime_type: String(data.mime_type || 'application/pdf'),
    checksum_sha256: data.checksum_sha256 ? String(data.checksum_sha256) : undefined
  };
}
