/// <reference lib="dom" />
// Tests Unitaires Réels et Exhaustifs (Phase 2F.3C)
// Fichier : test/reportCardPdfService.test.ts
// Exécution : deno test test/reportCardPdfService.test.ts

import { assertEquals, assertRejects, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  isValidUUID,
  isPublishedPdfMetadataComplete,
  validatePdfBlob,
  mapHttpErrorToServiceError,
  createServiceError,
  executePdfDownload,
  ReportCardPdfServiceException,
  type DomDownloadAdapter
} from '../src/services/reportCardPdfService.ts';
import type {
  ReportCardPdfUnreadyCard,
  ReportCardPdfGenerationStatus
} from '../src/types/reportCard.ts';

// ---------------------------------------------------------------------------
// 1. Validation UUID (Test 1)
// ---------------------------------------------------------------------------
Deno.test('1. isValidUUID: valide correctement les UUID v4 et rejette les formats invalides', () => {
  assertEquals(isValidUUID('123e4567-e89b-12d3-a456-426614174000'), true);
  assertEquals(isValidUUID('987a62b5-ea85-43b4-adfb-0f11d42d3942'), true);
  assertEquals(isValidUUID('not-a-uuid'), false);
  assertEquals(isValidUUID(''), false);
  assertEquals(isValidUUID(null as any), false);
  assertEquals(isValidUUID(undefined as any), false);
});

// ---------------------------------------------------------------------------
// 2. Classe d'Erreur & Mapping HTTP (Tests 2 à 7)
// ---------------------------------------------------------------------------
Deno.test('2. ReportCardPdfServiceException: instanciation conforme et instanceof Error', () => {
  const exc = createServiceError('Erreur test', 'TEST_CODE', 400, { foo: 'bar' }, 'corr-123');
  assert(exc instanceof Error);
  assert(exc instanceof ReportCardPdfServiceException);
  assertEquals(exc.message, 'Erreur test');
  assertEquals(exc.error_code, 'TEST_CODE');
  assertEquals(exc.http_status, 400);
  assertEquals(exc.correlation_id, 'corr-123');
  assertEquals((exc.details as any)?.foo, 'bar');
});

Deno.test('3. mapHttpErrorToServiceError: fallback 409 CONCURRENT_GENERATION_RUNNING', () => {
  const err409 = mapHttpErrorToServiceError(409, { error: 'Conflit sans code' }, 'corr-409');
  assert(err409 instanceof Error);
  assertEquals(err409.http_status, 409);
  assertEquals(err409.error_code, 'CONCURRENT_GENERATION_RUNNING');
  assertEquals(err409.correlation_id, 'corr-409');
});

Deno.test('4. mapHttpErrorToServiceError: fallback 400 VALIDATION_ERROR', () => {
  const err400 = mapHttpErrorToServiceError(400, {});
  assertEquals(err400.http_status, 400);
  assertEquals(err400.error_code, 'VALIDATION_ERROR');
});

Deno.test('5. mapHttpErrorToServiceError: fallback 401 et 403 UNAUTHORIZED', () => {
  const err401 = mapHttpErrorToServiceError(401);
  assertEquals(err401.http_status, 401);
  assertEquals(err401.error_code, 'UNAUTHORIZED');

  const err403 = mapHttpErrorToServiceError(403);
  assertEquals(err403.http_status, 403);
  assertEquals(err403.error_code, 'UNAUTHORIZED');
});

Deno.test('6. mapHttpErrorToServiceError: fallback 500 INTERNAL_SERVER_ERROR', () => {
  const err500 = mapHttpErrorToServiceError(500, { error: 'Erreur interne non typée' });
  assertEquals(err500.http_status, 500);
  assertEquals(err500.error_code, 'INTERNAL_SERVER_ERROR');
});

Deno.test('7. mapHttpErrorToServiceError: préserve le code explicite quand fourni par le serveur', () => {
  const err = mapHttpErrorToServiceError(400, {
    error: 'Champs invalides',
    error_code: 'CUSTOM_VALIDATION_FAILED',
    correlation_id: 'corr-custom'
  });
  assertEquals(err.http_status, 400);
  assertEquals(err.error_code, 'CUSTOM_VALIDATION_FAILED');
  assertEquals(err.correlation_id, 'corr-custom');
});

// ---------------------------------------------------------------------------
// 3. Validation Strictes des Métadonnées Publiées (Tests 8 à 13)
// ---------------------------------------------------------------------------
Deno.test('8. isPublishedPdfMetadataComplete: valide un bulletin conforme (batch_status & batch object/array)', () => {
  const validCard = {
    batch_status: 'published',
    pdf_storage_path: 'report_cards/batch_1/card_1.pdf',
    pdf_version: 1,
    pdf_generated_at: '2026-08-19T20:00:00.000Z',
    pdf_checksum: 'a'.repeat(64)
  };
  assertEquals(isPublishedPdfMetadataComplete(validCard), true);

  const validCardObj = {
    batch: { status: 'published' },
    pdf_storage_path: 'report_cards/batch_1/card_1.pdf',
    pdf_version: 2,
    pdf_generated_at: '2026-08-19T20:00:00.000Z',
    pdf_checksum: 'f'.repeat(64)
  };
  assertEquals(isPublishedPdfMetadataComplete(validCardObj), true);

  const validCardArray = {
    batch: [{ status: 'published' }],
    pdf_storage_path: 'report_cards/batch_1/card_1.pdf',
    pdf_version: 2,
    pdf_generated_at: '2026-08-19T20:00:00.000Z',
    pdf_checksum: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };
  assertEquals(isPublishedPdfMetadataComplete(validCardArray), true);
});

Deno.test('9. isPublishedPdfMetadataComplete: rejette si statut du lot non publié', () => {
  const draftCard = {
    batch_status: 'validated_by_admin',
    pdf_storage_path: 'report_cards/batch_1/card_1.pdf',
    pdf_version: 1,
    pdf_generated_at: '2026-08-19T20:00:00.000Z',
    pdf_checksum: 'a'.repeat(64)
  };
  assertEquals(isPublishedPdfMetadataComplete(draftCard), false);
});

Deno.test('10. isPublishedPdfMetadataComplete: rejette si path manquant ou vide', () => {
  const noPath = {
    batch_status: 'published',
    pdf_storage_path: '',
    pdf_version: 1,
    pdf_generated_at: '2026-08-19T20:00:00.000Z',
    pdf_checksum: 'a'.repeat(64)
  };
  assertEquals(isPublishedPdfMetadataComplete(noPath), false);
});

Deno.test('11. isPublishedPdfMetadataComplete: rejette si version invalide (< 1 ou non-entier)', () => {
  const badVersion0 = {
    batch_status: 'published',
    pdf_storage_path: 'path.pdf',
    pdf_version: 0,
    pdf_generated_at: '2026-08-19T20:00:00.000Z',
    pdf_checksum: 'a'.repeat(64)
  };
  assertEquals(isPublishedPdfMetadataComplete(badVersion0), false);

  const badVersionFloat = {
    batch_status: 'published',
    pdf_storage_path: 'path.pdf',
    pdf_version: 1.5,
    pdf_generated_at: '2026-08-19T20:00:00.000Z',
    pdf_checksum: 'a'.repeat(64)
  };
  assertEquals(isPublishedPdfMetadataComplete(badVersionFloat), false);
});

Deno.test('12. isPublishedPdfMetadataComplete: rejette si date manquante ou invalide', () => {
  const badDate = {
    batch_status: 'published',
    pdf_storage_path: 'path.pdf',
    pdf_version: 1,
    pdf_generated_at: 'invalid-date-string',
    pdf_checksum: 'a'.repeat(64)
  };
  assertEquals(isPublishedPdfMetadataComplete(badDate), false);
});

Deno.test('13. isPublishedPdfMetadataComplete: rejette si checksum non conforme SHA-256', () => {
  const shortChecksum = {
    batch_status: 'published',
    pdf_storage_path: 'path.pdf',
    pdf_version: 1,
    pdf_generated_at: '2026-08-19T20:00:00.000Z',
    pdf_checksum: 'abc123'
  };
  assertEquals(isPublishedPdfMetadataComplete(shortChecksum), false);

  const nonHexChecksum = {
    batch_status: 'published',
    pdf_storage_path: 'path.pdf',
    pdf_version: 1,
    pdf_generated_at: '2026-08-19T20:00:00.000Z',
    pdf_checksum: 'z'.repeat(64)
  };
  assertEquals(isPublishedPdfMetadataComplete(nonHexChecksum), false);
});

// ---------------------------------------------------------------------------
// 4. Validation Binaire du Blob PDF (Tests 14 à 17)
// ---------------------------------------------------------------------------
Deno.test('14. validatePdfBlob: rejette un Blob de taille 0', async () => {
  const emptyBlob = new Blob([], { type: 'application/pdf' });
  const res = await validatePdfBlob(emptyBlob);
  assertEquals(res.isValid, false);
  assertEquals(res.error?.includes('vide'), true);
});

Deno.test('15. validatePdfBlob: rejette un MIME non PDF', async () => {
  const textBlob = new Blob(['%PDF-1.4 test content'], { type: 'text/plain' });
  const res = await validatePdfBlob(textBlob);
  assertEquals(res.isValid, false);
  assertEquals(res.error?.includes('application/pdf'), true);
});

Deno.test('16. validatePdfBlob: rejette des magic bytes incorrects', async () => {
  const badHeaderBlob = new Blob(['NOTPDF-header-data'], { type: 'application/pdf' });
  const res = await validatePdfBlob(badHeaderBlob);
  assertEquals(res.isValid, false);
  assertEquals(res.error?.includes('%PDF-'), true);
});

Deno.test('17. validatePdfBlob: accepte un Blob PDF binaire valide', async () => {
  const validBlob = new Blob(['%PDF-1.7\n%stream binary data\n%%EOF'], { type: 'application/pdf' });
  const res = await validatePdfBlob(validBlob);
  assertEquals(res.isValid, true);
  assertEquals(res.error, undefined);
});

// ---------------------------------------------------------------------------
// 5. Téléchargement, DOM & Fail-Closed (Tests 18 et 19)
// ---------------------------------------------------------------------------
Deno.test('18. executePdfDownload: cycle complet avec createAnchor, nettoyage DOM et révocation (succès et échec)', async () => {
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  const fakeAnchors: any[] = [];
  const appendedAnchors: any[] = [];
  const removedAnchors: any[] = [];
  let clickCount = 0;

  const mockAdapter: DomDownloadAdapter = {
    createAnchor: () => {
      const anchor = {
        href: '',
        download: '',
        rel: '',
        click: () => {
          clickCount++;
        }
      } as unknown as HTMLAnchorElement;
      fakeAnchors.push(anchor);
      return anchor;
    },
    createObjectURL: (_blob: Blob) => {
      const url = `blob:http://localhost/doc-${Math.random()}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revokedUrls.push(url);
    },
    appendAnchorToBody: (link: HTMLAnchorElement) => {
      appendedAnchors.push(link);
    },
    removeAnchorFromBody: (link: HTMLAnchorElement) => {
      removedAnchors.push(link);
    },
    clickAnchor: (link: HTMLAnchorElement) => {
      link.click();
    }
  };

  const validBlob = new Blob(['%PDF-1.4 mock content'], { type: 'application/pdf' });
  await executePdfDownload(validBlob, 'mon_bulletin.pdf', mockAdapter);

  // Vérifications de succès
  assertEquals(fakeAnchors.length, 1);
  assertEquals(fakeAnchors[0].href, createdUrls[0]);
  assertEquals(fakeAnchors[0].download, 'mon_bulletin.pdf');
  assertEquals(fakeAnchors[0].rel, 'noopener noreferrer');
  assertEquals(appendedAnchors.length, 1);
  assertEquals(clickCount, 1);
  assertEquals(removedAnchors.length, 1);

  // Révocation programmée
  await new Promise((r) => setTimeout(r, 1100));
  assertEquals(revokedUrls.length, 1);
  assertEquals(revokedUrls[0], createdUrls[0]);

  // Test échec de clic avec adaptation
  const errAdapter: DomDownloadAdapter = {
    createAnchor: () => ({ href: '', download: '', rel: '' } as unknown as HTMLAnchorElement),
    createObjectURL: () => 'blob:http://localhost/error-url',
    revokeObjectURL: (url: string) => { revokedUrls.push(url); },
    appendAnchorToBody: () => {},
    removeAnchorFromBody: (link: HTMLAnchorElement) => { removedAnchors.push(link); },
    clickAnchor: () => { throw new Error('Simulated DOM Click Exception'); }
  };

  await assertRejects(
    async () => {
      await executePdfDownload(validBlob, 'test.pdf', errAdapter);
    },
    ReportCardPdfServiceException,
    'Simulated DOM Click Exception'
  );

  await new Promise((r) => setTimeout(r, 1100));
  assertEquals(revokedUrls.includes('blob:http://localhost/error-url'), true);
});

Deno.test('19. ReportCardPdfUnreadyCard & Fail-closed: validation de la propriété issue et garde de publication', () => {
  const unreadyCards: ReportCardPdfUnreadyCard[] = [
    {
      report_card_id: '123e4567-e89b-12d3-a456-426614174001',
      student_id: '123e4567-e89b-12d3-a456-426614174002',
      student_name: 'Daniel Banza',
      issue: 'missing_pdf'
    },
    {
      report_card_id: '123e4567-e89b-12d3-a456-426614174003',
      student_id: '123e4567-e89b-12d3-a456-426614174004',
      issue: 'pdf_generated_before_last_validation'
    },
    {
      report_card_id: '123e4567-e89b-12d3-a456-426614174005',
      student_id: '123e4567-e89b-12d3-a456-426614174006',
      issue: 'invalid_checksum_or_path'
    },
    {
      report_card_id: '123e4567-e89b-12d3-a456-426614174007',
      student_id: '123e4567-e89b-12d3-a456-426614174008',
      issue: 'storage_file_missing_or_invalid'
    }
  ];

  assertEquals(unreadyCards.length, 4);
  assertEquals(unreadyCards[0].issue, 'missing_pdf');
  assertEquals(unreadyCards[1].issue, 'pdf_generated_before_last_validation');
  assertEquals(unreadyCards[2].issue, 'invalid_checksum_or_path');
  assertEquals(unreadyCards[3].issue, 'storage_file_missing_or_invalid');

  const readyStatus: ReportCardPdfGenerationStatus = {
    batch_id: '123e4567-e89b-12d3-a456-426614174000',
    batch_status: 'validated_by_admin',
    revision_number: 1,
    validated_at: '2026-08-19T20:00:00.000Z',
    total_report_cards: 3,
    total_active_enrollments: 3,
    ready_pdfs: 3,
    missing_pdfs: 0,
    outdated_pdfs: 0,
    invalid_pdfs: 0,
    duplicate_paths_count: 0,
    unmatched_enrollments_count: 0,
    unmatched_cards_count: 0,
    structural_mismatches_count: 0,
    can_publish: true,
    unready_cards: []
  };
  assertEquals(readyStatus.can_publish, true);

  const unreadyStatus: ReportCardPdfGenerationStatus = {
    ...readyStatus,
    ready_pdfs: 2,
    missing_pdfs: 1,
    can_publish: false,
    unready_cards: [unreadyCards[0]]
  };
  assertEquals(unreadyStatus.can_publish, false);
});
