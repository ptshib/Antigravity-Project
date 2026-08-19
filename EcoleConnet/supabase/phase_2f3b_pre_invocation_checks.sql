-- ============================================================================
-- Contrôles Pré-Invocation en Lecture Seule pour generate-report-card-pdfs
-- Fichier : supabase/phase_2f3b_pre_invocation_checks.sql
-- ============================================================================

-- 1. Récupération du lot test 1A / 1re Période / Révision 1
SELECT 
  b.id AS batch_id,
  b.school_id,
  s.name AS school_name,
  c.id AS class_id,
  c.name AS class_name,
  p.id AS period_id,
  p.name AS period_name,
  b.revision_number,
  b.status,
  b.validated_at,
  b.validated_by,
  b.published_at,
  b.published_by
FROM public.report_card_batches b
JOIN public.schools s ON s.id = b.school_id
JOIN public.classes c ON c.id = b.class_id
JOIN public.academic_periods p ON p.id = b.period_id
WHERE c.name ILIKE '%1%A%' OR c.name ILIKE '%1ère%'
ORDER BY b.created_at DESC
LIMIT 5;

-- 2. Détail des bulletins et métadonnées PDF actuelles
SELECT 
  rc.id AS report_card_id,
  rc.student_id,
  rc.identity_snapshot->>'student_name' AS student_name,
  rc.pdf_version,
  rc.pdf_storage_path,
  rc.pdf_checksum,
  rc.pdf_generated_at,
  rc.rank,
  rc.rank_type,
  rc.is_incomplete
FROM public.period_report_cards rc
JOIN public.report_card_batches b ON b.id = rc.batch_id
WHERE b.status = 'validated_by_admin'
ORDER BY rc.rank ASC NULLS LAST;

-- 3. Contrôle des 3 ressources officielles obligatoires dans les snapshots
SELECT 
  rc.id AS report_card_id,
  rc.identity_snapshot->>'student_name' AS student_name,
  rc.signature_snapshot->>'director_signature_url' AS director_signature_url,
  rc.signature_snapshot->>'stamp_url' AS stamp_url,
  rc.signature_snapshot->>'homeroom_teacher_signature_url' AS homeroom_teacher_signature_url,
  rc.identity_snapshot->>'logo_url' AS logo_url
FROM public.period_report_cards rc
JOIN public.report_card_batches b ON b.id = rc.batch_id
WHERE b.status = 'validated_by_admin';

-- 4. Vérification de l'existence physique des ressources dans storage.objects
SELECT 
  so.bucket_id,
  so.name AS storage_object_path,
  so.created_at,
  so.metadata->>'mimetype' AS mimetype,
  so.metadata->>'size' AS size_bytes
FROM storage.objects so
WHERE so.bucket_id = 'school-official-assets';

-- 5. Profils school_admin actifs de l'établissement du lot
SELECT 
  p.id AS user_id,
  p.role,
  p.is_active,
  p.school_id,
  s.name AS school_name,
  au.email
FROM public.profiles p
JOIN public.schools s ON s.id = p.school_id
LEFT JOIN auth.users au ON au.id = p.id
WHERE p.role = 'school_admin' AND p.is_active = true;
