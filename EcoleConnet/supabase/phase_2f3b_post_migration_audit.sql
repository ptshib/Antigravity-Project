-- ============================================================================
-- Script de Contrôle Post-Migration en Lecture Seule (Phase 2F.3B)
-- Fichier : supabase/phase_2f3b_post_migration_audit.sql
-- ============================================================================
--
-- VÉRIFICATIONS :
-- 1. Existence de la table public.report_card_pdf_jobs
-- 2. Activation de RLS sur report_card_pdf_jobs
-- 3. Existence et définition de l'index partiel idx_rc_pdf_active_job_per_batch
-- 4. Existence des 4 RPCs et signatures exactes
-- 5. Permissions d'exécution : UNIQUEMENT service_role (rejet PUBLIC, anon, authenticated)
-- 6. Présence de la politique RLS school_admin_read_pdf_jobs
-- 7. État inchangé du lot test 1A / 1re Période / Révision 1
-- 8. Absence de job créé automatiquement (COUNT = 0)
-- 9. Absence de modification des métadonnées PDF des bulletins
-- 10. Absence de publication automatique
-- ============================================================================

-- 1. EXISTENCE DE LA TABLE
SELECT 
  table_schema,
  table_name,
  'EXISTS' AS status
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'report_card_pdf_jobs';

-- 2. ACTIVATION DE LA ROW LEVEL SECURITY (RLS)
SELECT 
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'report_card_pdf_jobs';

-- 3. INDEX UNIQUE PARTIEL
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename = 'report_card_pdf_jobs' 
  AND indexname = 'idx_rc_pdf_active_job_per_batch';

-- 4 & 5. EXISTENCE DES 4 RPCS, SIGNATURES & RETOURS
SELECT 
  p.proname AS function_name,
  pg_catalog.pg_get_function_arguments(p.oid) AS argument_signature,
  pg_catalog.pg_get_function_result(p.oid) AS return_type,
  p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' 
  AND p.proname IN (
    'claim_report_card_pdf_job',
    'heartbeat_report_card_pdf_job',
    'finish_report_card_pdf_job',
    'set_report_card_pdf_metadata_for_job'
  )
ORDER BY p.proname;

-- 6 & 7. MATRICE DES PRIVILÈGES D'EXÉCUTION SUR LES 4 RPCS
SELECT 
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'claim_report_card_pdf_job',
    'heartbeat_report_card_pdf_job',
    'finish_report_card_pdf_job',
    'set_report_card_pdf_metadata_for_job'
  )
ORDER BY routine_name, grantee;

-- 8. POLITIQUE RLS
SELECT 
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'report_card_pdf_jobs';

-- 9. VÉRIFICATION DU LOT TEST (1A / 1re Période / Révision 1)
SELECT 
  b.id AS batch_id,
  s.name AS school_name,
  c.name AS class_name,
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
ORDER BY b.created_at DESC
LIMIT 5;

-- 10. CONTRÔLE DE LA TABLE DES JOBS (DOIT ÊTRE VIDE)
SELECT 
  COUNT(*) AS total_jobs_count
FROM public.report_card_pdf_jobs;

-- 11 & 12. CONTRÔLE DES BULLETINS ET MÉDONNÉES PDF
SELECT 
  rc.batch_id,
  COUNT(*) AS total_report_cards,
  COUNT(rc.pdf_storage_path) AS count_with_pdf_path,
  COUNT(rc.pdf_generated_at) AS count_with_pdf_generated_at,
  COUNT(rc.pdf_checksum) AS count_with_pdf_checksum,
  COUNT(rc.pdf_version) AS count_with_pdf_version,
  COUNT(*) FILTER (WHERE rc.rank_type = 'official') AS count_official_rank,
  COUNT(*) FILTER (WHERE rc.is_incomplete = false) AS count_complete
FROM public.period_report_cards rc
GROUP BY rc.batch_id;
