-- ============================================================================
-- Contrôles Post-Invocation en Lecture Seule pour generate-report-card-pdfs
-- Fichier : supabase/phase_2f3b_post_invocation_audit.sql
-- ============================================================================

-- 1. Job PDF créé et son statut final
SELECT 
  id AS job_id,
  batch_id,
  school_id,
  status,
  started_by,
  total_items,
  processed_items,
  failed_items,
  error_code,
  correlation_id,
  started_at,
  completed_at,
  lease_expires_at
FROM public.report_card_pdf_jobs
ORDER BY created_at DESC
LIMIT 5;

-- 2. Métadonnées PDF enregistrées dans les 3 bulletins
SELECT 
  rc.id AS report_card_id,
  rc.student_id,
  rc.identity_snapshot->>'student_name' AS student_name,
  rc.pdf_version,
  rc.pdf_storage_path,
  rc.pdf_checksum,
  rc.pdf_generated_at,
  rc.pdf_generated_at >= b.validated_at AS is_generated_after_validation,
  rc.rank,
  rc.rank_type,
  rc.is_incomplete
FROM public.period_report_cards rc
JOIN public.report_card_batches b ON b.id = rc.batch_id
WHERE rc.batch_id = '51e4b60a-da47-4bd7-9c58-aa3238ad1540'
ORDER BY rc.rank ASC NULLS LAST;

-- 3. Objets créés dans le bucket privé 'report-card-pdfs'
SELECT 
  so.bucket_id,
  so.name AS storage_path,
  so.metadata->>'size' AS size_bytes,
  so.metadata->>'mimetype' AS mimetype,
  so.created_at,
  so.updated_at
FROM storage.objects so
WHERE so.bucket_id = 'report-card-pdfs'
ORDER BY so.name ASC;

-- 4. Confirmation de l'état du lot de bulletins (Non publié)
SELECT 
  b.id AS batch_id,
  b.status,
  b.revision_number,
  b.validated_at,
  b.validated_by,
  b.published_at,
  b.published_by,
  b.total_students_count,
  b.complete_students_count,
  b.incomplete_students_count
FROM public.report_card_batches b
WHERE b.id = '51e4b60a-da47-4bd7-9c58-aa3238ad1540';
