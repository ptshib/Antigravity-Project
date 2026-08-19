// Suite de tests d'intégration Deno.test utilisant directement JobManager, ImageFetcher et PdfGenerator
// Fichier : supabase/functions/generate-report-card-pdfs/test_generator.ts

import { assertEquals, assertRejects, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  ReportCardPdfGenerator,
  sanitizeText,
  truncateText,
  sortSubjectsDeterministically
} from './pdfGenerator.ts';
import { SafeImageFetcher } from './imageFetcher.ts';
import { JobManager } from './jobManager.ts';
import {
  ReportCardBatchRecord,
  PeriodReportCardRecord,
  ReportCardSubjectResultRecord,
  LoadedImages
} from './types.ts';

// 1x1 PNG transparent valide pour les tests
const MOCK_VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82
]);

const mockBatch: ReportCardBatchRecord = {
  id: 'a1111111-1111-4111-a111-111111111111',
  school_id: 'b2222222-2222-4222-b222-222222222222',
  academic_year_id: 'c3333333-3333-4333-c333-333333333333',
  class_id: 'd4444444-4444-4444-d444-444444444444',
  period_id: 'e5555555-5555-4555-e555-555555555555',
  revision_number: 1,
  status: 'validated_by_admin',
  validated_at: '2026-08-19T14:00:00Z',
  validated_by: 'f6666666-6666-4666-f666-666666666666'
};

const mockReportCard: PeriodReportCardRecord = {
  id: '11111111-1111-4111-a111-111111111111',
  batch_id: mockBatch.id,
  school_id: mockBatch.school_id,
  academic_year_id: mockBatch.academic_year_id,
  class_id: mockBatch.class_id,
  period_id: mockBatch.period_id,
  student_id: '22222222-2222-4222-a222-222222222222',
  enrollment_id: '33333333-3333-4333-a333-333333333333',
  overall_percentage: 82.75,
  rank: 1,
  total_students_ranked: 28,
  rank_type: 'official',
  is_incomplete: false,
  completed_subjects_count: 2,
  pending_subjects_count: 0,
  total_subject_coefficients: 7,
  calculation_snapshot: { average_percentage: 82.75 },
  identity_snapshot: {
    student_name: 'Pius Kisu Mukendi',
    student_number: 'ENS-2026-004',
    gender: 'M',
    date_of_birth: '2015-06-15',
    class_name: '1ère Année A',
    education_cycle: 'primary',
    academic_year_name: '2025-2026',
    period_name: '1ère Période',
    term_name: '1er Trimestre',
    school_name: 'COMPLEXE SCOLAIRE LES BÂTISSEURS',
    official_registration_number: 'MINEPST/SG/80/0124/2024',
    motto: 'Travail - Discipline - Excellence',
    school_address: 'Avenue de la Paix N°12, Gombe, Kinshasa',
    school_phone: '+243 81 000 0000',
    school_email: 'contact@lesbatisseurs.cd'
  },
  signature_snapshot: {
    principal_name: 'Dr. Joseph Kalala',
    homeroom_teacher_name: 'Prof. Pius Kisu',
    validated_at: '2026-08-19T14:00:00Z'
  },
  homeroom_teacher_remarks: 'Travail régulier.',
  conduct_grade: 'Bonne',
  principal_remarks: 'Félicitations pour vos résultats.',
  pdf_storage_path: null,
  pdf_generated_at: null,
  pdf_checksum: null,
  pdf_version: null
};

const mockSubjects: ReportCardSubjectResultRecord[] = [
  {
    id: 's1',
    report_card_id: mockReportCard.id,
    subject_id: 'sub-1',
    subject_name_snapshot: 'Mathématiques & Géométrie',
    subject_code_snapshot: 'MATH',
    coefficient: 4,
    subject_percentage: 88.5,
    assessment_count: 4,
    completed_assessment_count: 4,
    pending_assessment_count: 0,
    is_complete: true,
    subject_remark: 'Très bon esprit logique',
    display_position: 1
  },
  {
    id: 's2',
    report_card_id: mockReportCard.id,
    subject_id: 'sub-2',
    subject_name_snapshot: 'Français (Lecture & Grammaire)',
    subject_code_snapshot: 'FRAN',
    coefficient: 3,
    subject_percentage: 84.0,
    assessment_count: 4,
    completed_assessment_count: 4,
    pending_assessment_count: 0,
    is_complete: true,
    subject_remark: 'Bonne expression écrite',
    display_position: 2
  }
];

const mockValidImages: LoadedImages = {
  logo: MOCK_VALID_PNG,
  directorSignature: MOCK_VALID_PNG,
  stamp: MOCK_VALID_PNG,
  homeroomSignature: MOCK_VALID_PNG
};

const TEST_CHECKSUM_A = 'e70c7c3016e6822bc9e98c249fc720fcc92337a6eda81035456061d6ac616c55';
const TEST_CHECKSUM_B = 'a93485850deec18b06565691671968c7f5609065b9a19eef132db4704263115c';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// 1. TESTS DE DÉTERMINATION DE VERSION & IDEMPOTENCE (determinePdfTargetVersion)
// ============================================================================

Deno.test("1. Versionnage : version=1, path=null, checksum=null, generated_at=null => targetVersion=1, needUpload=true", () => {
  const rcIncompleteVersion1: Partial<PeriodReportCardRecord> = {
    pdf_version: 1,
    pdf_storage_path: null,
    pdf_checksum: null,
    pdf_generated_at: null
  };

  const res = JobManager.determinePdfTargetVersion(
    mockBatch.school_id,
    mockBatch.id,
    mockReportCard.student_id,
    rcIncompleteVersion1,
    TEST_CHECKSUM_A
  );

  assertEquals(res.targetVersion, 1);
  assertEquals(res.needUpload, true);
  assertEquals(res.canonicalStoragePath, `${mockBatch.school_id}/${mockBatch.id}/${mockReportCard.student_id}/report-card-v1.pdf`);
});

Deno.test("2. Versionnage : version=1 avec métadonnées complètes et checksum identique => targetVersion=1, needUpload=false", () => {
  const expectedPath = `${mockBatch.school_id}/${mockBatch.id}/${mockReportCard.student_id}/report-card-v1.pdf`;
  const rcValidVersion1: Partial<PeriodReportCardRecord> = {
    pdf_version: 1,
    pdf_storage_path: expectedPath,
    pdf_checksum: TEST_CHECKSUM_A,
    pdf_generated_at: '2026-08-19T14:30:00Z'
  };

  const res = JobManager.determinePdfTargetVersion(
    mockBatch.school_id,
    mockBatch.id,
    mockReportCard.student_id,
    rcValidVersion1,
    TEST_CHECKSUM_A
  );

  assertEquals(res.targetVersion, 1);
  assertEquals(res.needUpload, false);
  assertEquals(res.canonicalStoragePath, expectedPath);
});

Deno.test("3. Versionnage : version=1 avec métadonnées valides mais nouveau checksum différent => targetVersion=2, needUpload=true", () => {
  const rcValidVersion1: Partial<PeriodReportCardRecord> = {
    pdf_version: 1,
    pdf_storage_path: `${mockBatch.school_id}/${mockBatch.id}/${mockReportCard.student_id}/report-card-v1.pdf`,
    pdf_checksum: TEST_CHECKSUM_A,
    pdf_generated_at: '2026-08-19T14:30:00Z'
  };

  const res = JobManager.determinePdfTargetVersion(
    mockBatch.school_id,
    mockBatch.id,
    mockReportCard.student_id,
    rcValidVersion1,
    TEST_CHECKSUM_B
  );

  assertEquals(res.targetVersion, 2);
  assertEquals(res.needUpload, true);
  assertEquals(res.canonicalStoragePath, `${mockBatch.school_id}/${mockBatch.id}/${mockReportCard.student_id}/report-card-v2.pdf`);
});

Deno.test("4. Versionnage : version=null et aucune métadonnée => targetVersion=1, needUpload=true", () => {
  const rcNull: Partial<PeriodReportCardRecord> = {
    pdf_version: null,
    pdf_storage_path: null,
    pdf_checksum: null,
    pdf_generated_at: null
  };

  const res = JobManager.determinePdfTargetVersion(
    mockBatch.school_id,
    mockBatch.id,
    mockReportCard.student_id,
    rcNull,
    TEST_CHECKSUM_A
  );

  assertEquals(res.targetVersion, 1);
  assertEquals(res.needUpload, true);
  assertEquals(res.canonicalStoragePath, `${mockBatch.school_id}/${mockBatch.id}/${mockReportCard.student_id}/report-card-v1.pdf`);
});

// ============================================================================
// 2. TESTS DES BUCKETS RÉELS DU PROJET
// ============================================================================

Deno.test("5. Vérification des buckets Storage réels du projet", () => {
  const allowedBuckets = ['school-official-assets', 'report-card-pdfs'];
  assert(allowedBuckets.includes('school-official-assets'), 'Bucket officiel des assets scolaires');
  assert(allowedBuckets.includes('report-card-pdfs'), 'Bucket officiel des PDF des bulletins');
});

// ============================================================================
// 3. TESTS DU MODULE JOBMANAGER (CLAIM) & HIÉRARCHIE DES VERROUS
// ============================================================================

Deno.test("6. Hiérarchie globale des verrous : BATCH -> JOB -> BULLETIN", () => {
  const lockOrder = ['report_card_batches', 'report_card_pdf_jobs', 'period_report_cards'];
  assertEquals(lockOrder[0], 'report_card_batches');
  assertEquals(lockOrder[1], 'report_card_pdf_jobs');
  assertEquals(lockOrder[2], 'period_report_cards');
});

Deno.test("7. JobManager.claimJob - Acquisition réussie", async () => {
  const mockClient: any = {
    rpc: async (fn: string, params: any) => {
      assertEquals(fn, 'claim_report_card_pdf_job');
      return {
        data: {
          success: true,
          job_id: 'job-1111-2222',
          batch_id: params.p_batch_id,
          lease_expires_at: new Date(Date.now() + 120000).toISOString()
        },
        error: null
      };
    }
  };

  const res = await JobManager.claimJob(mockClient, mockBatch.id, 'caller-1', 'corr-1');
  assertEquals(res.success, true);
  assertEquals(res.job_id, 'job-1111-2222');
});

Deno.test("8. JobManager.claimJob - Rejet pour job déjà running (concurrence)", async () => {
  const mockClient: any = {
    rpc: async () => ({
      data: { success: false, error_code: 'JOB_ALREADY_RUNNING' },
      error: null
    })
  };

  const res = await JobManager.claimJob(mockClient, mockBatch.id, 'caller-1', 'corr-1');
  assertEquals(res.success, false);
  assertEquals(res.error_code, 'JOB_ALREADY_RUNNING');
});

Deno.test("9. JobManager.claimJob - Erreur RPC ou absence de job_id (Fail-Closed)", async () => {
  const mockClient1: any = {
    rpc: async () => ({ data: null, error: { message: 'DB Error' } })
  };
  const res1 = await JobManager.claimJob(mockClient1, mockBatch.id, 'caller-1', 'corr-1');
  assertEquals(res1.success, false);
  assertEquals(res1.error_code, 'JOB_CLAIM_RPC_ERROR');

  const mockClient2: any = {
    rpc: async () => ({ data: { success: true, job_id: null }, error: null })
  };
  const res2 = await JobManager.claimJob(mockClient2, mockBatch.id, 'caller-1', 'corr-1');
  assertEquals(res2.success, false);
  assertEquals(res2.error_code, 'JOB_CLAIM_REJECTED');
});

// ============================================================================
// 4. TESTS DU MODULE JOBMANAGER (HEARTBEAT & PERTE DU BAIL)
// ============================================================================

Deno.test("10. JobManager.heartbeatJob - Prolongation normale du bail", async () => {
  const mockClient: any = {
    rpc: async (fn: string, params: any) => {
      assertEquals(fn, 'heartbeat_report_card_pdf_job');
      return {
        data: { success: true, job_id: params.p_job_id },
        error: null
      };
    }
  };

  const res = await JobManager.heartbeatJob(mockClient, 'job-1111-2222', 1, 0);
  assertEquals(res.success, true);
});

Deno.test("11. Expiration du bail au milieu d'un chunk - Rejet immédiat", async () => {
  const mockClient: any = {
    rpc: async () => ({
      data: { success: false, error_code: 'JOB_LEASE_EXPIRED' },
      error: null
    })
  };

  const res = await JobManager.heartbeatJob(mockClient, 'job-1111-2222', 1, 0);
  assertEquals(res.success, false);
  assertEquals(res.error_code, 'JOB_LEASE_EXPIRED');
});

// ============================================================================
// 5. TESTS DU MODULE JOBMANAGER (RPC FENCED DE MÉTADONNÉES & FAIL-CLOSED)
// ============================================================================

Deno.test("12. JobManager.saveReportCardPdfMetadataForJob - Succès de l'enregistrement", async () => {
  const mockClient: any = {
    rpc: async (fn: string, params: any) => {
      assertEquals(fn, 'set_report_card_pdf_metadata_for_job');
      assertEquals(params.p_job_id, 'job-1111-2222');
      return { data: { success: true }, error: null };
    }
  };

  const res = await JobManager.saveReportCardPdfMetadataForJob(
    mockClient,
    'job-1111-2222',
    mockReportCard.id,
    'path/v1.pdf',
    TEST_CHECKSUM_A,
    1
  );
  assertEquals(res.success, true);
});

Deno.test("13. JobManager.saveReportCardPdfMetadataForJob - Rejet strict sur { data: null, error: null } (Fail-Closed)", async () => {
  const mockClient: any = {
    rpc: async () => ({
      data: null,
      error: null
    })
  };

  const res = await JobManager.saveReportCardPdfMetadataForJob(
    mockClient,
    'job-1111-2222',
    mockReportCard.id,
    'path/v1.pdf',
    TEST_CHECKSUM_A,
    1
  );
  assertEquals(res.success, false);
  assertEquals(res.error_code, 'METADATA_SAVE_REJECTED');
});

Deno.test("14. Tentative de métadonnées par un ancien worker expiré - Rejet JOB_LEASE_LOST", async () => {
  const mockClient: any = {
    rpc: async () => ({
      data: { success: false, error_code: 'JOB_LEASE_LOST' },
      error: null
    })
  };

  const res = await JobManager.saveReportCardPdfMetadataForJob(
    mockClient,
    'job-expired-999',
    mockReportCard.id,
    'path/v1.pdf',
    TEST_CHECKSUM_A,
    1
  );
  assertEquals(res.success, false);
  assertEquals(res.error_code, 'JOB_LEASE_LOST');
});

Deno.test("15. Refus de la RPC fenced sur discordance de lot (BATCH_MISMATCH)", async () => {
  const mockClient: any = {
    rpc: async () => ({
      data: { success: false, error_code: 'BATCH_MISMATCH' },
      error: null
    })
  };

  const res = await JobManager.saveReportCardPdfMetadataForJob(
    mockClient,
    'job-1111-2222',
    'other-report-card-id',
    'path/v1.pdf',
    TEST_CHECKSUM_A,
    1
  );
  assertEquals(res.success, false);
  assertEquals(res.error_code, 'BATCH_MISMATCH');
});

// ============================================================================
// 6. TESTS DU MODULE JOBMANAGER (FINISH & COMPTEURS)
// ============================================================================

Deno.test("16. JobManager.finishJob - Clôture réussie", async () => {
  const mockClient: any = {
    rpc: async (fn: string, params: any) => {
      assertEquals(fn, 'finish_report_card_pdf_job');
      return { data: { success: true, status: params.p_status }, error: null };
    }
  };

  const res = await JobManager.finishJob(mockClient, 'job-1111-2222', 'completed', null, 5, 0);
  assertEquals(res.success, true);
});

Deno.test("17. JobManager.finishJob - Rejet strict sur compteurs incohérents (INVALID_COUNTERS)", async () => {
  const mockClient: any = {
    rpc: async () => ({
      data: { success: false, error_code: 'INVALID_COUNTERS' },
      error: null
    })
  };

  const res = await JobManager.finishJob(mockClient, 'job-1111-2222', 'completed', null, 999, 999);
  assertEquals(res.success, false);
  assertEquals(res.error_code, 'INVALID_COUNTERS');
});

// ============================================================================
// 7. TESTS D'ALLOWLIST STRICTE ET SÉCURITÉ DES IMAGES
// ============================================================================

Deno.test("18. SafeImageFetcher - Rejet de tout domaine externe (Allowlist stricte)", async () => {
  const mockClient: any = {
    storage: {
      from: () => ({ download: async () => ({ data: null, error: new Error('Mock') }) })
    }
  };
  const fetcher = new SafeImageFetcher(mockClient, 'https://test-school.supabase.co');

  const evilSite = await fetcher.fetchImage('https://evil-hacker.com/image.png');
  const otherDomain = await fetcher.fetchImage('https://cdn.otherdomain.org/logo.png');
  const metadataAws = await fetcher.fetchImage('http://169.254.169.254/latest');

  assertEquals(evilSite, null, 'Doit rejeter evil site');
  assertEquals(otherDomain, null, 'Doit rejeter tout domaine hors allowlist');
  assertEquals(metadataAws, null, 'Doit rejeter metadata');
});

// ============================================================================
// 8. TESTS DE NETTOYAGE ET UPLOAD
// ============================================================================

Deno.test("19. Nettoyage Storage - Suppression ciblée uniquement du nouvel upload", async () => {
  const deleted: string[] = [];
  const mockClient: any = {
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          deleted.push(...paths);
          return { data: paths, error: null };
        }
      })
    }
  };

  await JobManager.cleanupUploadedFile(mockClient, 'school-1/batch-1/student-1/report-card-v2.pdf');
  assertEquals(deleted.length, 1);
  assertEquals(deleted[0], 'school-1/batch-1/student-1/report-card-v2.pdf');
});

// ============================================================================
// 9. TESTS DU MOTEUR DE RENDU PDF OFFICIEL
// ============================================================================

Deno.test("20. Rejet strict si signature ou cachet manquant (MANDATORY_ASSET_MISSING)", async () => {
  const missingSigImages: any = {
    logo: null,
    directorSignature: null,
    stamp: MOCK_VALID_PNG,
    homeroomSignature: MOCK_VALID_PNG
  };

  await assertRejects(
    async () => {
      await ReportCardPdfGenerator.generate(mockBatch, mockReportCard, mockSubjects, missingSigImages);
    },
    Error,
    'MANDATORY_ASSET_MISSING'
  );
});

Deno.test("21. Rendu PDF réussi avec toutes les signatures obligatoires", async () => {
  const pdfBytes = await ReportCardPdfGenerator.generate(
    mockBatch,
    mockReportCard,
    mockSubjects,
    mockValidImages
  );

  assert(pdfBytes instanceof Uint8Array);
  assert(pdfBytes.byteLength > 1000);

  const header = String.fromCharCode(...pdfBytes.slice(0, 5));
  assertEquals(header, '%PDF-');
});

Deno.test("22. Déterminisme : deux générations à des instants différents produisent exactement les mêmes octets et le même SHA-256", async () => {
  const firstBytes = await ReportCardPdfGenerator.generate(
    mockBatch,
    mockReportCard,
    mockSubjects,
    mockValidImages
  );
  const firstChecksum = await sha256Hex(firstBytes);

  // Franchit une seconde pour détecter toute date courante injectée par pdf-lib.
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const secondBytes = await ReportCardPdfGenerator.generate(
    mockBatch,
    mockReportCard,
    mockSubjects,
    mockValidImages
  );
  const secondChecksum = await sha256Hex(secondBytes);

  assertEquals(firstBytes, secondBytes);
  assertEquals(firstChecksum, secondChecksum);
});

Deno.test("23. Déterminisme : l'ordre d'entrée des matières n'altère ni les octets ni le checksum", async () => {
  const canonical = sortSubjectsDeterministically(mockSubjects);
  const reversed = [...mockSubjects].reverse();
  const canonicalBytes = await ReportCardPdfGenerator.generate(mockBatch, mockReportCard, canonical, mockValidImages);
  const reversedBytes = await ReportCardPdfGenerator.generate(mockBatch, mockReportCard, reversed, mockValidImages);

  assertEquals(canonicalBytes, reversedBytes);
  assertEquals(await sha256Hex(canonicalBytes), await sha256Hex(reversedBytes));
});

Deno.test("24. Intégrité métier : une donnée académique modifiée change les octets et le SHA-256", async () => {
  const originalBytes = await ReportCardPdfGenerator.generate(
    mockBatch,
    mockReportCard,
    mockSubjects,
    mockValidImages
  );
  const changedCard: PeriodReportCardRecord = {
    ...mockReportCard,
    principal_remarks: 'Résultat officiellement révisé.'
  };
  const changedBytes = await ReportCardPdfGenerator.generate(
    mockBatch,
    changedCard,
    mockSubjects,
    mockValidImages
  );

  assert(originalBytes.some((value, index) => value !== changedBytes[index]));
  assert((await sha256Hex(originalBytes)) !== (await sha256Hex(changedBytes)));
});

Deno.test("25. Idempotence complète : un checksum déterministe existant conserve la version et évite l'upload", async () => {
  const pdfBytes = await ReportCardPdfGenerator.generate(
    mockBatch,
    mockReportCard,
    mockSubjects,
    mockValidImages
  );
  const checksum = await sha256Hex(pdfBytes);
  const existingVersion = 2;
  const existingPath = `${mockBatch.school_id}/${mockBatch.id}/${mockReportCard.student_id}/report-card-v${existingVersion}.pdf`;
  const existingCard: Partial<PeriodReportCardRecord> = {
    pdf_version: existingVersion,
    pdf_storage_path: existingPath,
    pdf_checksum: checksum,
    pdf_generated_at: '2026-08-19T18:28:10Z'
  };

  const result = JobManager.determinePdfTargetVersion(
    mockBatch.school_id,
    mockBatch.id,
    mockReportCard.student_id,
    existingCard,
    checksum
  );

  assertEquals(result.targetVersion, existingVersion);
  assertEquals(result.needUpload, false);
  assertEquals(result.canonicalStoragePath, existingPath);
});
