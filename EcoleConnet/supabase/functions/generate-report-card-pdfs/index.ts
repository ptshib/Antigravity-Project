// Supabase Edge Function : Génération Sécurisée des PDF Officiels des Bulletins
// Fichier : supabase/functions/generate-report-card-pdfs/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  CallerProfile,
  ReportCardBatchRecord,
  PeriodReportCardRecord,
  ReportCardSubjectResultRecord,
  SinglePdfGenerationResult,
  LoadedImages
} from './types.ts';
import { SafeImageFetcher } from './imageFetcher.ts';
import { ReportCardPdfGenerator } from './pdfGenerator.ts';
import { JobManager } from './jobManager.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

function generateCorrelationId(): string {
  return crypto.randomUUID();
}

function buildErrorResponse(
  status: number,
  errorCode: string,
  publicMessage: string,
  correlationId: string
): Response {
  return new Response(
    JSON.stringify({
      error: publicMessage,
      error_code: errorCode,
      correlation_id: correlationId
    }),
    { status, headers: corsHeaders }
  );
}

serve(async (req) => {
  // 1. Gestion des requêtes OPTIONS (CORS Pre-flight)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const correlationId = generateCorrelationId();

  // 2. Validation stricte de la méthode POST
  if (req.method !== 'POST') {
    return buildErrorResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'Méthode HTTP non autorisée. Seule la méthode POST est acceptée.',
      correlationId
    );
  }

  // 3. Récupération et vérification des variables d'environnement (Fail-Closed)
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    console.error(`[${correlationId}] Configuration serveur manquante : Variables d'environnement non définies.`);
    return buildErrorResponse(
      500,
      'SERVER_CONFIGURATION_ERROR',
      'Erreur de configuration du serveur. Le service de génération est indisponible.',
      correlationId
    );
  }

  let activeJobId: string | null = null;
  let serviceClientInstance: any = null;

  const finishActiveJob = async (
    status: 'completed' | 'failed',
    errorCode: string | null,
    processed: number,
    failed: number
  ) => {
    if (!activeJobId || !serviceClientInstance) return { success: false, error_code: 'NO_ACTIVE_JOB' };
    return await JobManager.finishJob(serviceClientInstance, activeJobId, status, errorCode, processed, failed);
  };

  try {
    // 4. Extraction et validation du Bearer JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return buildErrorResponse(
        401,
        'UNAUTHORIZED_MISSING_TOKEN',
        'Jeton d’authentification manquant ou format invalide.',
        correlationId
      );
    }

    // Client utilisateur lié au JWT appelant
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: callerUser }, error: userAuthError } = await userClient.auth.getUser();
    if (userAuthError || !callerUser) {
      return buildErrorResponse(
        401,
        'UNAUTHORIZED_INVALID_TOKEN',
        'Session utilisateur invalide ou expirée.',
        correlationId
      );
    }

    // Client service_role pour opérations internes
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });
    serviceClientInstance = serviceClient;

    // 5. Vérification du profil et des rôles autorisés (school_admin ou super_admin)
    const { data: callerProfile, error: profileError } = await serviceClient
      .from('profiles')
      .select('id, role, is_active, school_id')
      .eq('id', callerUser.id)
      .single<CallerProfile>();

    if (profileError || !callerProfile || !callerProfile.is_active) {
      return buildErrorResponse(
        403,
        'FORBIDDEN_INACTIVE_PROFILE',
        'Accès refusé : Profil utilisateur inactif ou introuvable.',
        correlationId
      );
    }

    if (!['school_admin', 'super_admin'].includes(callerProfile.role)) {
      return buildErrorResponse(
        403,
        'FORBIDDEN_INSUFFICIENT_ROLE',
        'Accès refusé : Seule l’administration de l’établissement est habilitée à générer les PDF officiels.',
        correlationId
      );
    }

    // 6. Validation stricte du corps JSON (rejet absolu de toute clé étrangère)
    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return buildErrorResponse(
        400,
        'INVALID_JSON_BODY',
        'Corps de requête JSON invalide ou mal formaté.',
        correlationId
      );
    }

    if (!body || typeof body !== 'object') {
      return buildErrorResponse(
        400,
        'INVALID_PAYLOAD_TYPE',
        'Objet JSON attendu dans le corps de la requête.',
        correlationId
      );
    }

    const payloadKeys = Object.keys(body);
    if (payloadKeys.length !== 1 || payloadKeys[0] !== 'batch_id') {
      return buildErrorResponse(
        400,
        'INVALID_PAYLOAD_EXTRA_KEYS',
        'Format de requête invalide : Seul le champ "batch_id" est accepté.',
        correlationId
      );
    }

    const { batch_id } = body;
    if (!batch_id || typeof batch_id !== 'string' || !UUID_REGEX.test(batch_id)) {
      return buildErrorResponse(
        400,
        'INVALID_BATCH_ID',
        'Identifiant de lot (batch_id) manquant ou format UUID non conforme.',
        correlationId
      );
    }

    // 7. Lecture et vérification du lot de bulletins
    const { data: batch, error: batchError } = await serviceClient
      .from('report_card_batches')
      .select('id, school_id, academic_year_id, class_id, period_id, revision_number, status, validated_at, validated_by')
      .eq('id', batch_id)
      .single<ReportCardBatchRecord>();

    if (batchError || !batch) {
      return buildErrorResponse(
        404,
        'BATCH_NOT_FOUND',
        'Lot de bulletins introuvable.',
        correlationId
      );
    }

    // Contrôle d'appartenance à l'établissement
    if (callerProfile.role === 'school_admin' && callerProfile.school_id !== batch.school_id) {
      return buildErrorResponse(
        403,
        'FORBIDDEN_SCHOOL_MISMATCH',
        'Accès refusé : Vous n’êtes pas autorisé à administrer cet établissement.',
        correlationId
      );
    }

    // Contrôle strict du statut : validated_by_admin uniquement
    if (batch.status !== 'validated_by_admin') {
      return buildErrorResponse(
        400,
        'INVALID_BATCH_STATUS',
        `Génération impossible : Le lot doit être au statut "validated_by_admin" (statut actuel: "${batch.status}").`,
        correlationId
      );
    }

    if (!batch.validated_at) {
      return buildErrorResponse(
        400,
        'MISSING_VALIDATION_TIMESTAMP',
        'Génération bloquée : La date de validation administrative (validated_at) est manquante sur ce lot.',
        correlationId
      );
    }

    // 8. Revendication obligatoire du Job distribué (Strictement Fail-Closed)
    const claimRes = await JobManager.claimJob(
      serviceClient,
      batch.id,
      callerProfile.id,
      correlationId,
      120
    );

    if (!claimRes.success || !claimRes.job_id) {
      const claimErrCode = claimRes.error_code || 'JOB_CLAIM_FAILED';
      const claimMsg = claimErrCode === 'JOB_ALREADY_RUNNING'
        ? 'Une génération de PDF est déjà en cours d’exécution pour ce lot de bulletins.'
        : 'La revendication du job de génération a échoué.';

      return buildErrorResponse(
        claimErrCode === 'JOB_ALREADY_RUNNING' ? 409 : (claimErrCode === 'JOB_CLAIM_RPC_ERROR' ? 500 : 400),
        claimErrCode,
        claimMsg,
        correlationId
      );
    }

    activeJobId = claimRes.job_id;

    // 9. Récupération de tous les bulletins du lot
    const { data: reportCards, error: cardsError } = await serviceClient
      .from('period_report_cards')
      .select('*')
      .eq('batch_id', batch_id)
      .order('rank', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .returns<PeriodReportCardRecord[]>();

    if (cardsError || !reportCards || reportCards.length === 0) {
      await finishActiveJob('failed', 'NO_REPORT_CARDS_IN_BATCH', 0, 0);
      return buildErrorResponse(
        400,
        'NO_REPORT_CARDS_IN_BATCH',
        'Validation impossible : Aucun bulletin n’a été trouvé dans ce lot.',
        correlationId
      );
    }

    // 10. Récupération de l'ensemble des résultats de matières
    const cardIds = reportCards.map((rc) => rc.id);
    const { data: allSubjects, error: subjectsError } = await serviceClient
      .from('report_card_subject_results')
      .select('*')
      .in('report_card_id', cardIds)
      .order('report_card_id', { ascending: true })
      .order('display_position', { ascending: true })
      .order('subject_id', { ascending: true })
      .order('id', { ascending: true })
      .returns<ReportCardSubjectResultRecord[]>();

    if (subjectsError || !allSubjects) {
      await finishActiveJob('failed', 'SUBJECTS_FETCH_ERROR', 0, 0);
      return buildErrorResponse(
        500,
        'SUBJECTS_FETCH_ERROR',
        'Erreur lors de la récupération des résultats par matière du lot.',
        correlationId
      );
    }

    // Regroupement par bulletin
    const subjectsByCardId = new Map<string, ReportCardSubjectResultRecord[]>();
    for (const subj of allSubjects) {
      const list = subjectsByCardId.get(subj.report_card_id) || [];
      list.push(subj);
      subjectsByCardId.set(subj.report_card_id, list);
    }

    // 11. Initialisation du gestionnaire de ressources sécurisé (Allowlist stricte)
    const imageFetcher = new SafeImageFetcher(serviceClient, supabaseUrl);

    const results: SinglePdfGenerationResult[] = [];
    const errors: Array<{ report_card_id: string; student_id: string; error_code: string }> = [];

    let generatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // 12. Traitement individuel avec Heartbeat avant chaque bulletin
    for (const rc of reportCards) {
      const studentName = rc.identity_snapshot?.student_name || `Élève #${rc.student_id.slice(0, 8)}`;
      const cardSubjects = subjectsByCardId.get(rc.id) || [];
      const cardIdentity = rc.identity_snapshot || {};
      const cardSignatures = rc.signature_snapshot || {};

      // A. Heartbeat avant chaque bulletin pour s'assurer que le bail est valide
      const hbRes = await JobManager.heartbeatJob(
        serviceClient,
        activeJobId,
        generatedCount + skippedCount,
        failedCount,
        120
      );

      if (!hbRes.success) {
        console.error(`[${correlationId}] Bail perdu avant bulletin ${rc.id} : arrêt immédiat.`);
        return buildErrorResponse(
          409,
          'JOB_LEASE_LOST',
          'Le bail d’exécution distribué a expiré. Le traitement a été interrompu.',
          correlationId
        );
      }

      let newlyUploadedPath: string | null = null;

      try {
        // B. Résolution des ressources visuelles propres à CE bulletin
        const [logoBytes, dirSigBytes, stampBytes, hrSigBytes] = await Promise.all([
          imageFetcher.fetchImage(cardIdentity.logo_url),
          imageFetcher.fetchImage(cardSignatures.director_signature_url),
          imageFetcher.fetchImage(cardSignatures.stamp_url),
          imageFetcher.fetchImage(cardSignatures.homeroom_teacher_signature_url)
        ]);

        // C. Contrôle des 3 ressources officielles obligatoires
        if (!dirSigBytes || !stampBytes || !hrSigBytes) {
          throw { code: 'MANDATORY_ASSET_MISSING' };
        }

        const loadedImages: LoadedImages = {
          logo: logoBytes,
          directorSignature: dirSigBytes,
          stamp: stampBytes,
          homeroomSignature: hrSigBytes
        };

        // D. Génération du document PDF
        const pdfBytes = await ReportCardPdfGenerator.generate(
          batch,
          rc,
          cardSubjects,
          loadedImages
        );

        if (!pdfBytes || pdfBytes.byteLength === 0) {
          throw { code: 'EMPTY_PDF_GENERATED' };
        }

        // E. Calcul cryptographique SHA-256
        const digestBuffer = await crypto.subtle.digest('SHA-256', pdfBytes.slice().buffer);
        const checksum = Array.from(new Uint8Array(digestBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        // F. Détermination stricte de la version et du besoin d'upload
        const versionInfo = JobManager.determinePdfTargetVersion(
          batch.school_id,
          batch.id,
          rc.student_id,
          rc,
          checksum
        );

        const targetVersion = versionInfo.targetVersion;
        const needUpload = versionInfo.needUpload;
        const canonicalStoragePath = versionInfo.canonicalStoragePath;

        // G. Téléversement Storage immuable (upsert: false)
        if (needUpload) {
          const uploadRes = await JobManager.uploadPdf(serviceClient, canonicalStoragePath, pdfBytes);
          if (!uploadRes.success) {
            throw { code: 'STORAGE_UPLOAD_ERROR' };
          }
          newlyUploadedPath = canonicalStoragePath;
        }

        // H. Enregistrement des métadonnées via la RPC clôturée (fenced) set_report_card_pdf_metadata_for_job
        const metaRes = await JobManager.saveReportCardPdfMetadataForJob(
          serviceClient,
          activeJobId,
          rc.id,
          canonicalStoragePath,
          checksum,
          targetVersion
        );

        if (!metaRes.success) {
          if (newlyUploadedPath) {
            await JobManager.cleanupUploadedFile(serviceClient, newlyUploadedPath);
          }
          if (metaRes.error_code === 'JOB_LEASE_LOST') {
            console.error(`[${correlationId}] Rejet RPC fenced par perte de bail.`);
            return buildErrorResponse(
              409,
              'JOB_LEASE_LOST',
              'Le bail de génération a expiré lors de l’écriture des métadonnées.',
              correlationId
            );
          }
          throw { code: metaRes.error_code || 'METADATA_RPC_ERROR' };
        }

        if (needUpload) {
          generatedCount++;
        } else {
          skippedCount++;
        }

        results.push({
          report_card_id: rc.id,
          student_id: rc.student_id,
          student_name: studentName,
          status: needUpload ? 'generated' : 'skipped',
          storage_path: canonicalStoragePath,
          checksum,
          version: targetVersion
        });
      } catch (itemErr: any) {
        failedCount++;
        const errorCode = itemErr?.code || 'PDF_GENERATION_FAILED';

        if (newlyUploadedPath) {
          await JobManager.cleanupUploadedFile(serviceClient, newlyUploadedPath);
        }

        errors.push({
          report_card_id: rc.id,
          student_id: rc.student_id,
          error_code: errorCode
        });
        results.push({
          report_card_id: rc.id,
          student_id: rc.student_id,
          student_name: studentName,
          status: 'failed',
          error_code: errorCode
        });
        console.error(`[${correlationId}] Échec bulletin ${rc.id} : code ${errorCode}`);
      }
    }

    // 13. Consultation finale avec userClient portant le JWT de l'utilisateur
    const { data: generationStatus } = await userClient.rpc(
      'get_report_card_pdf_generation_status',
      { p_batch_id: batch_id }
    );

    const isAllProcessed = failedCount === 0 && (generationStatus?.can_publish === true);

    // 14. Clôture finale du job distribué via finishActiveJob
    const finishRes = await finishActiveJob(
      isAllProcessed ? 'completed' : 'failed',
      isAllProcessed ? null : 'PARTIAL_OR_FULL_FAILURE',
      generatedCount + skippedCount,
      failedCount
    );

    const isOverallSuccess = isAllProcessed && finishRes.success === true;

    const responsePayload = {
      success: isOverallSuccess,
      partial_success: !isOverallSuccess && (generatedCount + skippedCount) > 0,
      batch_id: batch.id,
      revision_number: batch.revision_number,
      total_report_cards: reportCards.length,
      generated_count: generatedCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      results,
      ...(errors.length > 0 ? { errors } : {}),
      generation_status: generationStatus || { can_publish: false, error_code: 'STATUS_CHECK_FAILED' },
      correlation_id: correlationId
    };

    return new Response(JSON.stringify(responsePayload), {
      status: isOverallSuccess ? 200 : (generatedCount > 0 ? 207 : 400),
      headers: corsHeaders
    });
  } catch (err: any) {
    console.error(`[${correlationId}] Erreur non interceptée :`, err);
    await finishActiveJob('failed', 'UNHANDLED_EXCEPTION', 0, 0);

    return buildErrorResponse(
      500,
      'INTERNAL_SERVER_ERROR',
      'Une erreur inattendue est survenue lors de la génération des PDF.',
      correlationId
    );
  }
});
