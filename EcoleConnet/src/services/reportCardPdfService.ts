/// <reference lib="dom" />
// Service Frontend Centralisé : Gestion Sécurisée des Bulletins Scolaires PDF (Phase 2F.3C)
// Fichier : src/services/reportCardPdfService.ts

import { supabase } from '../lib/supabase.ts';
import type {
  ReportCardPdfGenerationStatus,
  GenerateReportCardPdfsResponse,
  PublishReportCardBatchResponse
} from '../types/reportCard.ts';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CHECKSUM_REGEX = /^[0-9a-f]{64}$/i;
export const STORAGE_BUCKET = 'report-card-pdfs';
export const PDF_MAGIC_BYTES = '%PDF-';

/**
 * Exception spécifique pour les erreurs de service PDF de bulletins scolaires.
 */
export class ReportCardPdfServiceException extends Error {
  error_code: string;
  http_status?: number;
  correlation_id?: string;
  details?: unknown;

  constructor(
    message: string,
    errorCode: string,
    httpStatus?: number,
    details?: unknown,
    correlationId?: string
  ) {
    super(message);
    this.name = 'ReportCardPdfServiceException';
    this.error_code = errorCode;
    this.http_status = httpStatus;
    this.details = details;
    this.correlation_id = correlationId;
    Object.setPrototypeOf(this, ReportCardPdfServiceException.prototype);
  }
}

/**
 * Valide un UUID de manière stricte.
 */
export function isValidUUID(uuid?: string | null): boolean {
  if (!uuid || typeof uuid !== 'string') return false;
  return UUID_REGEX.test(uuid.trim());
}

/**
 * Valide qu'un bulletin publié dispose de métadonnées PDF officielles complètes et conformes.
 * Exigences strictes :
 * - statut du lot = published ;
 * - pdf_storage_path non vide ;
 * - pdf_version entier >= 1 ;
 * - pdf_generated_at non vide et date valide ;
 * - pdf_checksum conforme à /^[0-9a-f]{64}$/i.
 */
export function isPublishedPdfMetadataComplete(card?: {
  batch_status?: string | null;
  batch?: { status?: string | null } | { status?: string | null }[] | null;
  pdf_storage_path?: string | null;
  pdf_version?: number | null;
  pdf_generated_at?: string | null;
  pdf_checksum?: string | null;
} | null): boolean {
  if (!card) return false;

  const batchStatus = Array.isArray(card.batch)
    ? card.batch[0]?.status
    : card.batch?.status;
  const status = card.batch_status || batchStatus;
  if (status !== 'published') return false;

  if (!card.pdf_storage_path || typeof card.pdf_storage_path !== 'string' || !card.pdf_storage_path.trim()) {
    return false;
  }

  if (
    typeof card.pdf_version !== 'number' ||
    !Number.isInteger(card.pdf_version) ||
    card.pdf_version < 1
  ) {
    return false;
  }

  if (
    !card.pdf_generated_at ||
    typeof card.pdf_generated_at !== 'string' ||
    !card.pdf_generated_at.trim() ||
    isNaN(Date.parse(card.pdf_generated_at))
  ) {
    return false;
  }

  if (
    !card.pdf_checksum ||
    typeof card.pdf_checksum !== 'string' ||
    !CHECKSUM_REGEX.test(card.pdf_checksum.trim())
  ) {
    return false;
  }

  return true;
}

/**
 * Nettoie et sécurise un nom de fichier PDF.
 */
export function sanitizePdfFilename(preferredFilename?: string | null, fallback: string = 'bulletin_scolaire.pdf'): string {
  if (!preferredFilename || typeof preferredFilename !== 'string' || !preferredFilename.trim()) {
    return fallback;
  }
  const clean = preferredFilename.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`;
}

/**
 * Valide le contenu binaire d'un Blob PDF (taille, type MIME et magic bytes %PDF-).
 */
export async function validatePdfBlob(blob: Blob): Promise<{ isValid: boolean; error?: string }> {
  if (!blob || !(blob instanceof Blob)) {
    return { isValid: false, error: 'Document binaire invalide ou non fourni.' };
  }

  if (blob.size === 0) {
    return { isValid: false, error: 'Le document PDF téléchargé est vide (0 octet).' };
  }

  if (blob.type !== 'application/pdf') {
    return { isValid: false, error: `Type MIME non conforme : attendu 'application/pdf', reçu '${blob.type}'.` };
  }

  try {
    const headerBuffer = await blob.slice(0, 5).arrayBuffer();
    const headerBytes = new Uint8Array(headerBuffer);
    const headerStr = String.fromCharCode(...headerBytes);

    if (headerStr !== PDF_MAGIC_BYTES) {
      return { isValid: false, error: "Signature binaire invalide : l'en-tête du fichier ne correspond pas au format PDF (%PDF-)." };
    }
  } catch (err: any) {
    return { isValid: false, error: `Échec de lecture de l'en-tête binaire : ${err.message}` };
  }

  return { isValid: true };
}

/**
 * Normalise et formate les erreurs de manière structurée pour l'UI sous forme d'une vraie classe d'erreur.
 */
export function createServiceError(
  message: string,
  errorCode: string,
  httpStatus?: number,
  details?: unknown,
  correlationId?: string
): ReportCardPdfServiceException {
  return new ReportCardPdfServiceException(
    message,
    errorCode,
    httpStatus,
    details,
    correlationId
  );
}

/**
 * Mappe un code HTTP et un corps d'erreur vers une exception de service normalisée avec codes de repli précis.
 */
export function mapHttpErrorToServiceError(
  status: number,
  body?: any,
  correlationId?: string,
  fallbackMessage?: string
): ReportCardPdfServiceException {
  const userMessage = body?.error || fallbackMessage || 'Échec du service de gestion des bulletins.';
  const resolvedCorrId = body?.correlation_id || correlationId;

  if (status === 409) {
    return createServiceError(
      userMessage || 'Une génération de PDF est déjà en cours pour ce lot.',
      body?.error_code || 'CONCURRENT_GENERATION_RUNNING',
      409,
      body,
      resolvedCorrId
    );
  }

  if (status === 401 || status === 403) {
    return createServiceError(
      'Accès refusé : Seul un administrateur scolaire peut effectuer cette opération.',
      body?.error_code || 'UNAUTHORIZED',
      status,
      body,
      resolvedCorrId
    );
  }

  if (status === 400) {
    return createServiceError(
      userMessage || 'Requête de bulletins invalide.',
      body?.error_code || 'VALIDATION_ERROR',
      400,
      body,
      resolvedCorrId
    );
  }

  if (status === 500) {
    return createServiceError(
      userMessage || 'Erreur interne du serveur lors du traitement des bulletins.',
      body?.error_code || 'INTERNAL_SERVER_ERROR',
      500,
      body,
      resolvedCorrId
    );
  }

  return createServiceError(
    userMessage,
    body?.error_code || 'SERVICE_ERROR',
    status,
    body,
    resolvedCorrId
  );
}

/**
 * Interface pour l'injection DOM lors des téléchargements client (support des tests et environnement navigateur).
 */
export interface DomDownloadAdapter {
  createAnchor: () => HTMLAnchorElement;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  appendAnchorToBody: (link: HTMLAnchorElement) => void;
  removeAnchorFromBody: (link: HTMLAnchorElement) => void;
  clickAnchor: (link: HTMLAnchorElement) => void;
}

const defaultDomAdapter: DomDownloadAdapter = {
  createAnchor: () => document.createElement('a'),
  createObjectURL: (blob: Blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url: string) => URL.revokeObjectURL(url),
  appendAnchorToBody: (link: HTMLAnchorElement) => {
    document.body.appendChild(link);
  },
  removeAnchorFromBody: (link: HTMLAnchorElement) => {
    if (link?.parentNode) {
      link.parentNode.removeChild(link);
    }
  },
  clickAnchor: (link: HTMLAnchorElement) => link.click()
};

/**
 * Exécute le cycle complet de téléchargement avec garantie de nettoyage DOM et révocation de l'URL Blob.
 */
export async function executePdfDownload(
  blob: Blob,
  filename: string,
  domAdapter: DomDownloadAdapter = defaultDomAdapter
): Promise<void> {
  // 1. Validation binaire préalable
  const validation = await validatePdfBlob(blob);
  if (!validation.isValid) {
    throw createServiceError(
      validation.error || 'Le document PDF est invalide.',
      'INVALID_PDF_BLOB',
      500
    );
  }

  const cleanFilename = sanitizePdfFilename(filename);
  let objectUrl: string | null = null;
  let linkElement: HTMLAnchorElement | null = null;

  try {
    objectUrl = domAdapter.createObjectURL(blob);
    linkElement = domAdapter.createAnchor();
    linkElement.href = objectUrl;
    linkElement.download = cleanFilename;
    linkElement.rel = 'noopener noreferrer';
    
    domAdapter.appendAnchorToBody(linkElement);
    domAdapter.clickAnchor(linkElement);
  } catch (err: any) {
    if (err instanceof ReportCardPdfServiceException) throw err;
    throw createServiceError(
      err?.message || 'Erreur lors du déclenchement du téléchargement.',
      'DOM_DOWNLOAD_ERROR',
      500
    );
  } finally {
    // 2. Nettoyage garanti du DOM
    if (linkElement) {
      domAdapter.removeAnchorFromBody(linkElement);
    }
    // 3. Révocation programmée de l'Object URL
    if (objectUrl) {
      setTimeout(() => {
        domAdapter.revokeObjectURL(objectUrl!);
      }, 1000);
    }
  }
}

/**
 * Récupère le statut de préparation PDF officiel d'un lot via RPC officielle.
 */
export async function getPdfGenerationStatus(
  batchId: string
): Promise<ReportCardPdfGenerationStatus> {
  if (!isValidUUID(batchId)) {
    throw createServiceError(
      'Identifiant de lot invalide.',
      'INVALID_BATCH_ID',
      400
    );
  }

  try {
    const { data, error } = await supabase.rpc('get_report_card_pdf_generation_status', {
      p_batch_id: batchId
    });

    if (error) {
      throw createServiceError(
        error.message || 'Impossible de vérifier le statut de génération des PDF.',
        error.code || 'RPC_STATUS_ERROR',
        500,
        error.details
      );
    }

    if (!data) {
      throw createServiceError(
        'Aucune donnée de statut retournée par le serveur pour ce lot.',
        'STATUS_NOT_FOUND',
        404
      );
    }

    return data as ReportCardPdfGenerationStatus;
  } catch (err: any) {
    if (err instanceof ReportCardPdfServiceException) throw err;
    throw createServiceError(
      err?.message || 'Erreur lors de la récupération du statut PDF.',
      'UNKNOWN_STATUS_ERROR',
      500
    );
  }
}

/**
 * Invoque l'Edge Function officielle generate-report-card-pdfs pour générer les PDF du lot.
 */
export async function generateBatchPdfs(
  batchId: string
): Promise<GenerateReportCardPdfsResponse> {
  if (!isValidUUID(batchId)) {
    throw createServiceError(
      'Identifiant de lot invalide pour la génération PDF.',
      'INVALID_BATCH_ID',
      400
    );
  }

  try {
    const { data, error } = await supabase.functions.invoke('generate-report-card-pdfs', {
      body: { batch_id: batchId }
    });

    if (error) {
      const status = error.context?.status || (error as any).status || 500;
      let errorBody: any = null;
      try {
        if (typeof error.context?.json === 'function') {
          errorBody = await error.context.json();
        }
      } catch {
        // Corps non-JSON ignoré
      }

      throw mapHttpErrorToServiceError(
        status,
        errorBody,
        errorBody?.correlation_id,
        error.message || 'Échec de la génération des PDF du lot.'
      );
    }

    if (!data) {
      throw createServiceError(
        'Réponse vide reçue du service de génération PDF.',
        'EMPTY_RESPONSE',
        500
      );
    }

    if (data.partial_success || data.failed_count > 0) {
      return {
        ...data,
        partial_success: true
      } as GenerateReportCardPdfsResponse;
    }

    return data as GenerateReportCardPdfsResponse;
  } catch (err: any) {
    if (err instanceof ReportCardPdfServiceException) throw err;
    throw createServiceError(
      err?.message || 'Erreur inattendue lors de la génération des PDF.',
      'GENERATE_PDFS_EXCEPTION',
      500
    );
  }
}

/**
 * Invoque la RPC officielle publish_report_card_batch pour publier le lot.
 */
export async function publishBatch(
  batchId: string
): Promise<PublishReportCardBatchResponse> {
  if (!isValidUUID(batchId)) {
    throw createServiceError(
      'Identifiant de lot invalide pour la publication.',
      'INVALID_BATCH_ID',
      400
    );
  }

  try {
    const { data, error } = await supabase.rpc('publish_report_card_batch', {
      p_batch_id: batchId
    });

    if (error) {
      throw createServiceError(
        error.message || 'Échec de la publication officielle du lot de bulletins.',
        error.code || 'RPC_PUBLISH_ERROR',
        500,
        error.details
      );
    }

    return data as PublishReportCardBatchResponse;
  } catch (err: any) {
    if (err instanceof ReportCardPdfServiceException) throw err;
    throw createServiceError(
      err?.message || 'Erreur lors de la publication du lot.',
      'PUBLISH_BATCH_EXCEPTION',
      500
    );
  }
}

/**
 * Télécharge de manière sécurisée un fichier PDF officiel depuis le Storage privé et déclenche le téléchargement client.
 */
export async function downloadReportCardPdfBlob(
  storagePath: string,
  preferredFilename?: string
): Promise<void> {
  if (!storagePath || typeof storagePath !== 'string' || !storagePath.trim()) {
    throw createServiceError(
      'Chemin de stockage du bulletin PDF non spécifié.',
      'INVALID_STORAGE_PATH',
      400
    );
  }

  const cleanPath = storagePath.trim();

  try {
    const { data: blob, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(cleanPath);

    if (error || !blob) {
      throw createServiceError(
        error?.message || 'Impossible de télécharger le bulletin PDF officiel.',
        'STORAGE_DOWNLOAD_ERROR',
        404
      );
    }

    const fallbackFilename = cleanPath.split('/').pop() || 'bulletin_scolaire.pdf';
    const finalFilename = sanitizePdfFilename(preferredFilename, fallbackFilename);

    await executePdfDownload(blob, finalFilename);
  } catch (err: any) {
    if (err instanceof ReportCardPdfServiceException) throw err;
    throw createServiceError(
      err?.message || 'Erreur lors du téléchargement du fichier PDF.',
      'DOWNLOAD_BLOB_EXCEPTION',
      500
    );
  }
}
