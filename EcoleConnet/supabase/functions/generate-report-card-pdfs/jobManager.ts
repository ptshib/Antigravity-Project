// Module d'orchestration des jobs distribués et des opérations Storage
// Fichier : supabase/functions/generate-report-card-pdfs/jobManager.ts

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PeriodReportCardRecord } from './types.ts';

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;

export interface JobClaimResponse {
  success: boolean;
  job_id?: string;
  batch_id?: string;
  school_id?: string;
  total_items?: number;
  lease_expires_at?: string;
  error_code?: string;
}

export interface JobHeartbeatResponse {
  success: boolean;
  job_id?: string;
  lease_expires_at?: string;
  processed_items?: number;
  failed_items?: number;
  error_code?: string;
}

export interface JobFinishResponse {
  success: boolean;
  job_id?: string;
  status?: string;
  processed_items?: number;
  failed_items?: number;
  completed_at?: string;
  error_code?: string;
}

export interface VersionDeterminationResult {
  targetVersion: number;
  needUpload: boolean;
  canonicalStoragePath: string;
}

export class JobManager {
  /**
   * Détermine strictement la version cible et le besoin de téléversement d'un bulletin
   * Une version existante n'est considérée valide que si TOUTES ses métadonnées sont complètes et cohérentes.
   */
  static determinePdfTargetVersion(
    schoolId: string,
    batchId: string,
    studentId: string,
    rc: Partial<PeriodReportCardRecord>,
    newChecksum: string
  ): VersionDeterminationResult {
    const hasValidVersion = typeof rc.pdf_version === 'number' && rc.pdf_version >= 1;
    const hasValidPath = typeof rc.pdf_storage_path === 'string' && rc.pdf_storage_path.trim().length > 0;
    const hasValidChecksum = typeof rc.pdf_checksum === 'string' && SHA256_HEX_REGEX.test(rc.pdf_checksum.trim());
    const hasValidGeneratedAt = rc.pdf_generated_at !== null && rc.pdf_generated_at !== undefined && String(rc.pdf_generated_at).trim().length > 0;

    const expectedCanonicalPathForCurrentVersion = hasValidVersion
      ? `${schoolId}/${batchId}/${studentId}/report-card-v${rc.pdf_version}.pdf`
      : '';

    const pathMatchesVersion = hasValidPath && rc.pdf_storage_path === expectedCanonicalPathForCurrentVersion;

    const isFullyValidExistingPdf = hasValidVersion && hasValidPath && hasValidChecksum && hasValidGeneratedAt && pathMatchesVersion;

    if (!isFullyValidExistingPdf) {
      // Aucun PDF réel valide n'existe : forcer la version 1
      const targetVersion = 1;
      return {
        targetVersion,
        needUpload: true,
        canonicalStoragePath: `${schoolId}/${batchId}/${studentId}/report-card-v${targetVersion}.pdf`
      };
    }

    // Le PDF existant est complet et certifié conforme
    const existingChecksum = rc.pdf_checksum!.trim().toLowerCase();
    const computedChecksum = newChecksum.trim().toLowerCase();

    if (existingChecksum === computedChecksum) {
      // Idempotence : contenu identique et déjà téléversé
      return {
        targetVersion: rc.pdf_version!,
        needUpload: false,
        canonicalStoragePath: expectedCanonicalPathForCurrentVersion
      };
    } else {
      // Contenu modifié : incrémenter strictement la version
      const targetVersion = rc.pdf_version! + 1;
      return {
        targetVersion,
        needUpload: true,
        canonicalStoragePath: `${schoolId}/${batchId}/${studentId}/report-card-v${targetVersion}.pdf`
      };
    }
  }

  /**
   * Revendique atomiquement le bail de génération pour un lot (Fail-Closed)
   * Ordre des verrous : BATCH -> JOB
   */
  static async claimJob(
    serviceClient: SupabaseClient,
    batchId: string,
    callerId: string,
    correlationId: string,
    leaseSeconds: number = 120
  ): Promise<JobClaimResponse> {
    const { data, error } = await serviceClient.rpc('claim_report_card_pdf_job', {
      p_batch_id: batchId,
      p_caller_id: callerId,
      p_correlation_id: correlationId,
      p_lease_seconds: leaseSeconds
    });

    if (error) {
      return { success: false, error_code: 'JOB_CLAIM_RPC_ERROR' };
    }

    if (!data || data.success !== true || !data.job_id) {
      return {
        success: false,
        error_code: data?.error_code || 'JOB_CLAIM_REJECTED'
      };
    }

    return data as JobClaimResponse;
  }

  /**
   * Prolonge le bail d'un job en cours d'exécution
   */
  static async heartbeatJob(
    serviceClient: SupabaseClient,
    jobId: string,
    processedItems: number,
    failedItems: number,
    leaseSeconds: number = 120
  ): Promise<JobHeartbeatResponse> {
    const { data, error } = await serviceClient.rpc('heartbeat_report_card_pdf_job', {
      p_job_id: jobId,
      p_lease_seconds: leaseSeconds,
      p_processed_items: processedItems,
      p_failed_items: failedItems
    });

    if (error || !data || data.success !== true) {
      return {
        success: false,
        error_code: data?.error_code || 'JOB_LEASE_LOST'
      };
    }

    return data as JobHeartbeatResponse;
  }

  /**
   * Clôture formellement un job avec son statut final et ses compteurs exacts
   */
  static async finishJob(
    serviceClient: SupabaseClient,
    jobId: string,
    status: 'completed' | 'failed',
    errorCode: string | null,
    processedItems: number,
    failedItems: number
  ): Promise<JobFinishResponse> {
    const { data, error } = await serviceClient.rpc('finish_report_card_pdf_job', {
      p_job_id: jobId,
      p_status: status,
      p_error_code: errorCode,
      p_processed_items: processedItems,
      p_failed_items: failedItems
    });

    if (error || !data || data.success !== true) {
      return {
        success: false,
        error_code: data?.error_code || 'JOB_FINISH_RPC_ERROR'
      };
    }

    return data as JobFinishResponse;
  }

  /**
   * Enregistre les métadonnées via la RPC clôturée (fenced) liée au job actif
   * Ordre des verrous : BATCH -> JOB -> BULLETIN
   */
  static async saveReportCardPdfMetadataForJob(
    serviceClient: SupabaseClient,
    jobId: string,
    reportCardId: string,
    storagePath: string,
    checksum: string,
    version: number
  ): Promise<{ success: boolean; error_code?: string }> {
    const { data, error } = await serviceClient.rpc('set_report_card_pdf_metadata_for_job', {
      p_job_id: jobId,
      p_report_card_id: reportCardId,
      p_storage_path: storagePath,
      p_checksum: checksum,
      p_version: version
    });

    if (error || !data || data.success !== true) {
      return {
        success: false,
        error_code: data?.error_code || 'METADATA_SAVE_REJECTED'
      };
    }

    return { success: true };
  }

  /**
   * Téléversement Storage immuable (upsert: false)
   */
  static async uploadPdf(
    serviceClient: SupabaseClient,
    storagePath: string,
    pdfBytes: Uint8Array
  ): Promise<{ success: boolean; error?: any }> {
    const { error } = await serviceClient.storage
      .from('report-card-pdfs')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      return { success: false, error };
    }

    return { success: true };
  }

  /**
   * Nettoyage ciblé d'un fichier nouvellement téléversé lors d'un échec
   */
  static async cleanupUploadedFile(
    serviceClient: SupabaseClient,
    storagePath: string
  ): Promise<void> {
    try {
      await serviceClient.storage.from('report-card-pdfs').remove([storagePath]);
    } catch (_) {
      // Nettoyage au mieux (best-effort)
    }
  }
}
