-- ============================================================================
-- Migration : Verrou et Système de Jobs Distribués pour la Génération des PDF (Phase 2F.3B)
-- Fichier : supabase/migrations/20260819230000_report_card_pdf_generation_jobs.sql
-- ============================================================================
--
-- Note d'architecture & Hiérarchie des verrous :
-- ----------------------------------------------------------------------------
-- Cette migration implémente un système distribué de génération de bulletins avec
-- une stricte prévention des deadlocks.
-- L'ORDRE UNIVERSEL D'ACQUISITION DES VERROUS EST :
-- 1. public.report_card_batches (FOR UPDATE)
-- 2. public.report_card_pdf_jobs (FOR UPDATE)
-- 3. public.period_report_cards (FOR UPDATE)
--
-- Aucune fonction ne doit déroger à cette séquence.
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. TABLE DES JOBS DE GÉNÉRATION PDF AVEC CONTRAINTES STRICTES
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.report_card_pdf_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.report_card_batches(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'timeout')),
  started_by UUID NOT NULL REFERENCES public.profiles(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  total_items INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  processed_items INTEGER NOT NULL DEFAULT 0 CHECK (processed_items >= 0),
  failed_items INTEGER NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
  correlation_id TEXT NOT NULL CHECK (length(trim(correlation_id)) > 0 AND length(correlation_id) <= 100),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_rc_pdf_job_counters CHECK (processed_items + failed_items <= total_items)
);

-- Index d'unicité partielle : Un seul job 'running' actif par lot
CREATE UNIQUE INDEX IF NOT EXISTS idx_rc_pdf_active_job_per_batch
ON public.report_card_pdf_jobs(batch_id)
WHERE status = 'running';

-- Index de recherche et ordonnancement
CREATE INDEX IF NOT EXISTS idx_rc_pdf_jobs_batch_status
ON public.report_card_pdf_jobs(batch_id, status, lease_expires_at);

-- Activation RLS
ALTER TABLE public.report_card_pdf_jobs ENABLE ROW LEVEL SECURITY;

-- Politique RLS : Lecture réservée aux administrateurs de l'école
DROP POLICY IF EXISTS "school_admin_read_pdf_jobs" ON public.report_card_pdf_jobs;
CREATE POLICY "school_admin_read_pdf_jobs"
ON public.report_card_pdf_jobs FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND (p.role = 'super_admin' OR (p.role = 'school_admin' AND p.school_id = report_card_pdf_jobs.school_id))
  )
);

--------------------------------------------------------------------------------
-- 2. RPC 1 : claim_report_card_pdf_job (ACQUISITION DU BAIL DISTRIBUÉ)
-- ORDRE DES VERROUS : BATCH -> JOB
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.claim_report_card_pdf_job(UUID, UUID, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.claim_report_card_pdf_job(
  p_batch_id UUID,
  p_caller_id UUID,
  p_correlation_id TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_caller RECORD;
  v_existing_job RECORD;
  v_safe_lease INTEGER;
  v_clean_correlation_id TEXT;
  v_new_job_id UUID;
  v_total_cards INTEGER;
BEGIN
  -- 1. Vérification stricte que l'appel émane exclusivement du service_role
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès refusé : Seul le service serveur est habilité à revendiquer un job de génération.';
  END IF;

  -- 2. Validation et assainissement des paramètres
  v_clean_correlation_id := TRIM(COALESCE(p_correlation_id, ''));
  IF LENGTH(v_clean_correlation_id) = 0 OR LENGTH(v_clean_correlation_id) > 100 THEN
    RAISE EXCEPTION 'correlation_id invalide : Doit comporter entre 1 et 100 caractères.';
  END IF;

  -- Borner le bail strictement entre 30 et 300 secondes
  v_safe_lease := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 300);

  -- 3. Vérification du profil appelant
  SELECT id, role, is_active, school_id INTO v_caller
  FROM public.profiles
  WHERE id = p_caller_id;

  IF v_caller.id IS NULL OR v_caller.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur appelant inactif ou introuvable.';
  END IF;

  IF v_caller.role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seul un administrateur peut déclencher la génération.';
  END IF;

  -- 4. VERROU 1 : Verrouillage prioritaire du lot (BATCH)
  SELECT id, school_id, status, validated_at INTO v_batch
  FROM public.report_card_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_caller.role = 'school_admin' AND v_caller.school_id IS DISTINCT FROM v_batch.school_id THEN
    RAISE EXCEPTION 'Accès refusé : L’administrateur n’appartient pas à cet établissement.';
  END IF;

  IF v_batch.status <> 'validated_by_admin' THEN
    RAISE EXCEPTION 'Revendication impossible : Le lot doit être au statut "validated_by_admin" (statut actuel: "%").', v_batch.status;
  END IF;

  IF v_batch.validated_at IS NULL THEN
    RAISE EXCEPTION 'Revendication bloquée : La date de validation administrative (validated_at) est manquante sur ce lot.';
  END IF;

  -- 5. VERROU 2 : Verrouillage du job existant pour ce lot (JOB)
  SELECT * INTO v_existing_job
  FROM public.report_card_pdf_jobs
  WHERE batch_id = p_batch_id AND status = 'running'
  FOR UPDATE;

  IF v_existing_job.id IS NOT NULL THEN
    IF v_existing_job.lease_expires_at > now() THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'JOB_ALREADY_RUNNING',
        'active_job_id', v_existing_job.id,
        'lease_expires_at', v_existing_job.lease_expires_at,
        'correlation_id', v_existing_job.correlation_id
      );
    ELSE
      -- Bail expiré : Basculer l'ancien job en 'timeout' pour libérer l'index partiel
      UPDATE public.report_card_pdf_jobs
      SET
        status = 'timeout',
        error_code = 'LEASE_EXPIRED',
        completed_at = now(),
        updated_at = now()
      WHERE id = v_existing_job.id;
    END IF;
  END IF;

  -- 6. Compter le nombre de bulletins
  SELECT COUNT(*) INTO v_total_cards
  FROM public.period_report_cards
  WHERE batch_id = p_batch_id;

  IF v_total_cards = 0 THEN
    RAISE EXCEPTION 'Revendication impossible : Aucun bulletin dans ce lot.';
  END IF;

  -- 7. Création du nouveau job de génération
  INSERT INTO public.report_card_pdf_jobs (
    batch_id,
    school_id,
    status,
    started_by,
    started_at,
    lease_expires_at,
    total_items,
    processed_items,
    failed_items,
    correlation_id
  ) VALUES (
    p_batch_id,
    v_batch.school_id,
    'running',
    p_caller_id,
    now(),
    now() + (v_safe_lease || ' seconds')::interval,
    v_total_cards,
    0,
    0,
    v_clean_correlation_id
  )
  RETURNING id INTO v_new_job_id;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', v_new_job_id,
    'batch_id', p_batch_id,
    'school_id', v_batch.school_id,
    'total_items', v_total_cards,
    'lease_expires_at', now() + (v_safe_lease || ' seconds')::interval,
    'correlation_id', v_clean_correlation_id
  );
END;
$$;

--------------------------------------------------------------------------------
-- 3. RPC 2 : heartbeat_report_card_pdf_job (RENOUVELLEMENT STRICT DU BAIL)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.heartbeat_report_card_pdf_job(UUID, INTEGER, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.heartbeat_report_card_pdf_job(
  p_job_id UUID,
  p_lease_seconds INTEGER DEFAULT 120,
  p_processed_items INTEGER DEFAULT NULL,
  p_failed_items INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_safe_lease INTEGER;
  v_job RECORD;
  v_new_processed INTEGER;
  v_new_failed INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès refusé : Seul le service serveur peut envoyer un heartbeat.';
  END IF;

  v_safe_lease := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 300);

  SELECT * INTO v_job
  FROM public.report_card_pdf_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_NOT_FOUND');
  END IF;

  -- Refuser si le statut n'est plus running
  IF v_job.status <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_NOT_RUNNING', 'current_status', v_job.status);
  END IF;

  -- Refuser impérativement si le bail a déjà expiré (Interdiction de ressusciter un bail expiré)
  IF v_job.lease_expires_at <= now() THEN
    UPDATE public.report_card_pdf_jobs
    SET status = 'timeout', error_code = 'LEASE_EXPIRED_DURING_EXECUTION', completed_at = now(), updated_at = now()
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_LEASE_EXPIRED');
  END IF;

  -- Validation des compteurs
  v_new_processed := COALESCE(p_processed_items, v_job.processed_items);
  v_new_failed := COALESCE(p_failed_items, v_job.failed_items);

  IF v_new_processed < 0 OR v_new_failed < 0 OR (v_new_processed + v_new_failed > v_job.total_items) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_COUNTERS');
  END IF;

  UPDATE public.report_card_pdf_jobs
  SET
    lease_expires_at = now() + (v_safe_lease || ' seconds')::interval,
    processed_items = v_new_processed,
    failed_items = v_new_failed,
    updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', p_job_id,
    'lease_expires_at', now() + (v_safe_lease || ' seconds')::interval,
    'processed_items', v_new_processed,
    'failed_items', v_new_failed
  );
END;
$$;

--------------------------------------------------------------------------------
-- 4. RPC 3 : finish_report_card_pdf_job (CLÔTURE CONTRÔLÉE DU JOB)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.finish_report_card_pdf_job(UUID, TEXT, TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.finish_report_card_pdf_job(
  p_job_id UUID,
  p_status TEXT,
  p_error_code TEXT DEFAULT NULL,
  p_processed_items INTEGER DEFAULT 0,
  p_failed_items INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_clean_error_code TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès refusé : Seul le service serveur peut clôturer un job.';
  END IF;

  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Statut final invalide : "completed" ou "failed" requis.';
  END IF;

  SELECT * INTO v_job
  FROM public.report_card_pdf_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_NOT_FOUND');
  END IF;

  -- Refuser si le job n'est plus running
  IF v_job.status <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_NOT_RUNNING', 'current_status', v_job.status);
  END IF;

  -- Exiger lease_expires_at > now()
  IF v_job.lease_expires_at <= now() THEN
    UPDATE public.report_card_pdf_jobs
    SET status = 'timeout', error_code = 'LEASE_EXPIRED_BEFORE_FINISH', completed_at = now(), updated_at = now()
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_LEASE_EXPIRED');
  END IF;

  -- Validation stricte des compteurs (Rejet sans correction silencieuse)
  IF p_processed_items < 0 OR p_failed_items < 0 OR (p_processed_items + p_failed_items > v_job.total_items) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_COUNTERS');
  END IF;

  v_clean_error_code := SUBSTRING(TRIM(COALESCE(p_error_code, '')), 1, 100);
  IF v_clean_error_code = '' THEN
    v_clean_error_code := NULL;
  END IF;

  UPDATE public.report_card_pdf_jobs
  SET
    status = p_status,
    completed_at = now(),
    error_code = v_clean_error_code,
    processed_items = p_processed_items,
    failed_items = p_failed_items,
    updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', p_job_id,
    'status', p_status,
    'processed_items', p_processed_items,
    'failed_items', p_failed_items,
    'completed_at', now()
  );
END;
$$;

--------------------------------------------------------------------------------
-- 5. RPC 4 : set_report_card_pdf_metadata_for_job (RPC CLÔTURÉE / FENCED)
-- ORDRE STRICT DES VERROUS : BATCH -> JOB -> BULLETIN
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.set_report_card_pdf_metadata_for_job(UUID, UUID, TEXT, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.set_report_card_pdf_metadata_for_job(
  p_job_id UUID,
  p_report_card_id UUID,
  p_storage_path TEXT,
  p_checksum TEXT,
  p_version INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pre_job RECORD;
  v_batch RECORD;
  v_job RECORD;
  v_rc RECORD;
  v_metadata_res JSONB;
BEGIN
  -- 1. Vérification stricte que l'appel émane exclusivement du service_role
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès refusé : Seul le service serveur peut enregistrer les métadonnées de job.';
  END IF;

  -- 2. Lecture initiale du job sans verrou pour obtenir batch_id
  SELECT id, batch_id INTO v_pre_job
  FROM public.report_card_pdf_jobs
  WHERE id = p_job_id;

  IF v_pre_job.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_NOT_FOUND');
  END IF;

  -- 3. VERROU 1 : Verrouillage du report_card_batch FOR UPDATE (BATCH)
  SELECT id, school_id, status, validated_at INTO v_batch
  FROM public.report_card_batches
  WHERE id = v_pre_job.batch_id
  FOR UPDATE;

  IF v_batch.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'BATCH_NOT_FOUND');
  END IF;

  -- 4. VERROU 2 : Verrouillage du job FOR UPDATE (JOB)
  SELECT * INTO v_job
  FROM public.report_card_pdf_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_NOT_FOUND');
  END IF;

  -- Revérification du rattachement job.batch_id
  IF v_job.batch_id <> v_batch.id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'BATCH_MISMATCH');
  END IF;

  -- Contrôles status = 'running' et lease_expires_at > now()
  IF v_job.status <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_NOT_RUNNING', 'current_status', v_job.status);
  END IF;

  IF v_job.lease_expires_at <= now() THEN
    UPDATE public.report_card_pdf_jobs
    SET status = 'timeout', error_code = 'LEASE_EXPIRED_DURING_EXECUTION', completed_at = now(), updated_at = now()
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', false, 'error_code', 'JOB_LEASE_LOST');
  END IF;

  -- Contrôle validated_by_admin sur le lot
  IF v_batch.status <> 'validated_by_admin' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_BATCH_STATUS');
  END IF;

  -- 5. Contrôle d'existence et de rattachement du bulletin
  SELECT id, batch_id INTO v_rc
  FROM public.period_report_cards
  WHERE id = p_report_card_id;

  IF v_rc.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'REPORT_CARD_NOT_FOUND');
  END IF;

  IF v_rc.batch_id <> v_batch.id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'BATCH_MISMATCH');
  END IF;

  -- 6. VERROU 3 : Délégation à set_report_card_pdf_metadata (qui verrouille batch puis bulletin)
  v_metadata_res := public.set_report_card_pdf_metadata(
    p_report_card_id,
    p_storage_path,
    p_checksum,
    p_version
  );

  RETURN v_metadata_res;
END;
$$;

--------------------------------------------------------------------------------
-- 6. MATRICE DES PRIVILÈGES SÉCURISÉS
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.claim_report_card_pdf_job(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_report_card_pdf_job(UUID, UUID, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.heartbeat_report_card_pdf_job(UUID, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_report_card_pdf_job(UUID, INTEGER, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.finish_report_card_pdf_job(UUID, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_report_card_pdf_job(UUID, TEXT, TEXT, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.set_report_card_pdf_metadata_for_job(UUID, UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_report_card_pdf_metadata_for_job(UUID, UUID, TEXT, TEXT, INTEGER) TO service_role;

COMMIT;
