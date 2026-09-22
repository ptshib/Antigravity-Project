-- Migration Lot 2F-BR : Infrastructure documentaire sécurisée (public.school_documents & Edge Functions RPC Gateway)
-- Fichier : supabase/migrations/20260922230000_secure_school_documents.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. CRÉATION DE LA TABLE PUBLIC.SCHOOL_DOCUMENTS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NULL,
  category TEXT NOT NULL CHECK (category IN ('administrative', 'academic', 'rules', 'course_material', 'certificate', 'other')),
  target_scope TEXT NOT NULL CHECK (target_scope IN ('school', 'class', 'student')),
  class_id UUID NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  student_id UUID NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 15728640),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-fA-F]{64}$'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ NULL,
  archived_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Contraintes d'exclusivité stricte du scope
  CONSTRAINT chk_school_docs_scope_school CHECK (
    target_scope <> 'school' OR (class_id IS NULL AND student_id IS NULL)
  ),
  CONSTRAINT chk_school_docs_scope_class CHECK (
    target_scope <> 'class' OR (class_id IS NOT NULL AND student_id IS NULL)
  ),
  CONSTRAINT chk_school_docs_scope_student CHECK (
    target_scope <> 'student' OR (student_id IS NOT NULL AND class_id IS NULL)
  ),

  -- Sécurité sur les dates de publication/archivage
  CONSTRAINT chk_school_docs_published_dates CHECK (
    status <> 'published' OR published_at IS NOT NULL
  ),
  CONSTRAINT chk_school_docs_archived_dates CHECK (
    status <> 'archived' OR archived_at IS NOT NULL
  )
);

-- Index d'optimisation pour les recherches parentales et administratives
CREATE INDEX IF NOT EXISTS idx_school_documents_lookup
  ON public.school_documents (school_id, target_scope, status, category);

CREATE INDEX IF NOT EXISTS idx_school_documents_class
  ON public.school_documents (class_id) WHERE class_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_school_documents_student
  ON public.school_documents (student_id) WHERE student_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 2. RLS & PRIVILÈGES STRICTS SUR SCHOOL_DOCUMENTS
--------------------------------------------------------------------------------
ALTER TABLE public.school_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_documents FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_documents FROM PUBLIC;
REVOKE ALL ON TABLE public.school_documents FROM anon;
REVOKE ALL ON TABLE public.school_documents FROM authenticated;

--------------------------------------------------------------------------------
-- 3. TRIGGER D'INTÉGRITÉ MULTI-ÉCOLES ET CHEMIN CANONIQUE
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_school_document_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_school_check UUID;
  v_expected_prefix TEXT;
BEGIN
  -- A. Vérifier que l'année scolaire appartient à l'école
  IF NEW.academic_year_id IS NOT NULL THEN
    SELECT school_id INTO v_school_check FROM public.academic_years WHERE id = NEW.academic_year_id;
    IF v_school_check IS NULL OR v_school_check <> NEW.school_id THEN
      RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- B. Vérifier que la classe appartient à l'école
  IF NEW.class_id IS NOT NULL THEN
    SELECT school_id INTO v_school_check FROM public.classes WHERE id = NEW.class_id;
    IF v_school_check IS NULL OR v_school_check <> NEW.school_id THEN
      RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : La classe (%) n’appartient pas à l’établissement (%).', NEW.class_id, NEW.school_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- C. Vérifier que l'élève appartient à l'école
  IF NEW.student_id IS NOT NULL THEN
    SELECT school_id INTO v_school_check FROM public.students WHERE id = NEW.student_id;
    IF v_school_check IS NULL OR v_school_check <> NEW.school_id THEN
      RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : L’élève (%) n’appartient pas à l’établissement (%).', NEW.student_id, NEW.school_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- D. Vérifier le format canonique du storage_path : {school_id}/{document_id}/...
  v_expected_prefix := NEW.school_id::text || '/' || NEW.id::text || '/';
  IF NEW.storage_path NOT LIKE v_expected_prefix || '%' OR NEW.storage_path LIKE '%..%' OR NEW.storage_path LIKE '%//%' THEN
    RAISE EXCEPTION 'CHEMIN DE STOCKAGE INVALIDE : Le chemin (%) doit commencer par % et ne contenir aucun relatif.', NEW.storage_path, v_expected_prefix
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_school_document_integrity ON public.school_documents;
CREATE TRIGGER trg_check_school_document_integrity
  BEFORE INSERT OR UPDATE ON public.school_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.check_school_document_integrity();

ALTER TABLE public.school_documents ENABLE ALWAYS TRIGGER trg_check_school_document_integrity;

--------------------------------------------------------------------------------
-- 4. BUCKET PRIVÉ SCHOOL-DOCUMENTS (IDEMPOTENT)
--------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'school-documents',
  'school-documents',
  false,
  15728640, -- 15 MiB
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg'];

--------------------------------------------------------------------------------
-- 5. RPC PARENT : GET_PARENT_STUDENT_DOCUMENTS (MÉTADONNÉES UNIQUEMENT)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_parent_student_documents(
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_student RECORD;
  v_documents JSONB;
  v_total_docs INT := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_caller_id
      AND p.role = 'parent'
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un compte parent actif peut consulter les documents scolaires.'
      USING ERRCODE = '42501';
  END IF;

  SELECT 
    st.id,
    st.school_id,
    st.class_id,
    st.student_number,
    st.first_name,
    st.last_name,
    psl.can_view_academic,
    s.status AS school_status
  INTO v_student
  FROM public.students st
  JOIN public.parent_student_links psl ON psl.student_id = st.id
  JOIN public.schools s ON s.id = st.school_id
  WHERE st.id = p_student_id
    AND psl.parent_profile_id = v_caller_id
    AND psl.status = 'approved'
    AND (psl.school_id IS NULL OR psl.school_id = st.school_id);

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Élève introuvable ou vous n’avez pas le lien parental approuvé.'
      USING ERRCODE = '42501';
  END IF;

  IF v_student.school_status <> 'active' THEN
    RAISE EXCEPTION 'REJET ACCÈS : L’établissement de cet élève n’est pas actif.'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(d.id)
  INTO v_total_docs
  FROM public.school_documents d
  WHERE d.school_id = v_student.school_id
    AND d.status = 'published'
    AND (
      d.category NOT IN ('academic', 'course_material') OR v_student.can_view_academic = true
    )
    AND (
      d.target_scope = 'school'
      OR (d.target_scope = 'class' AND d.class_id = v_student.class_id)
      OR (d.target_scope = 'student' AND d.student_id = v_student.id)
    );

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', d.id,
      'title', d.title,
      'description', COALESCE(d.description, ''),
      'category', d.category,
      'target_scope', d.target_scope,
      'file_name', d.file_name,
      'file_size_bytes', d.file_size_bytes,
      'mime_type', d.mime_type,
      'published_at', d.published_at,
      'created_at', d.created_at
    ) ORDER BY d.published_at DESC
  ), '[]'::jsonb)
  INTO v_documents
  FROM public.school_documents d
  WHERE d.school_id = v_student.school_id
    AND d.status = 'published'
    AND (
      d.category NOT IN ('academic', 'course_material') OR v_student.can_view_academic = true
    )
    AND (
      d.target_scope = 'school'
      OR (d.target_scope = 'class' AND d.class_id = v_student.class_id)
      OR (d.target_scope = 'student' AND d.student_id = v_student.id)
    );

  RETURN pg_catalog.jsonb_build_object(
    'student_id', v_student.id,
    'student_number', v_student.student_number,
    'student_name', TRIM(v_student.first_name || ' ' || v_student.last_name),
    'summary', pg_catalog.jsonb_build_object(
      'total_documents', v_total_docs
    ),
    'documents', v_documents
  );
END;
$$;

--------------------------------------------------------------------------------
-- 6. RPC PARENT : AUTHORIZE_PARENT_DOCUMENT_DOWNLOAD (AUTORISATION EDGE FUNCTION)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_parent_document_download(
  p_student_id UUID,
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_student RECORD;
  v_doc RECORD;
  v_storage_obj_exists BOOLEAN := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_caller_id
      AND p.role = 'parent'
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un compte parent actif peut obtenir une autorisation de téléchargement.'
      USING ERRCODE = '42501';
  END IF;

  SELECT 
    st.id,
    st.school_id,
    st.class_id,
    psl.can_view_academic,
    s.status AS school_status
  INTO v_student
  FROM public.students st
  JOIN public.parent_student_links psl ON psl.student_id = st.id
  JOIN public.schools s ON s.id = st.school_id
  WHERE st.id = p_student_id
    AND psl.parent_profile_id = v_caller_id
    AND psl.status = 'approved'
    AND (psl.school_id IS NULL OR psl.school_id = st.school_id);

  IF v_student.id IS NULL OR v_student.school_status <> 'active' THEN
    RAISE EXCEPTION 'REJET ACCÈS : Élève introuvable ou établissement non actif.' USING ERRCODE = '42501';
  END IF;

  SELECT 
    id, school_id, target_scope, class_id, student_id, category,
    storage_path, file_name, file_size_bytes, mime_type, status, checksum_sha256
  INTO v_doc
  FROM public.school_documents
  WHERE id = p_document_id
    AND school_id = v_student.school_id
    AND status = 'published';

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Document introuvable, non publié ou d’un autre établissement.'
      USING ERRCODE = '42501';
  END IF;

  IF v_doc.category IN ('academic', 'course_material') AND NOT v_student.can_view_academic THEN
    RAISE EXCEPTION 'REJET ACCÈS : Vous n’avez pas la permission académique requise pour ce document.'
      USING ERRCODE = '42501';
  END IF;

  IF v_doc.target_scope = 'class' AND v_doc.class_id <> v_student.class_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : Ce document ne s’adresse pas à la classe de cet élève.' USING ERRCODE = '42501';
  ELSIF v_doc.target_scope = 'student' AND v_doc.student_id <> v_student.id THEN
    RAISE EXCEPTION 'REJET ACCÈS : Ce document individuel ne s’adresse pas à cet élève.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'school-documents'
      AND name = v_doc.storage_path
  ) INTO v_storage_obj_exists;

  IF NOT v_storage_obj_exists THEN
    RAISE EXCEPTION 'FICHIER INTROUVABLE : Le fichier physique n’existe pas dans le stockage sécurisé.'
      USING ERRCODE = '42501';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'document_id', v_doc.id,
    'school_id', v_doc.school_id,
    'student_id', v_student.id,
    'file_name', v_doc.file_name,
    'file_size_bytes', v_doc.file_size_bytes,
    'mime_type', v_doc.mime_type,
    'storage_path', v_doc.storage_path,
    'checksum_sha256', v_doc.checksum_sha256
  );
END;
$$;

--------------------------------------------------------------------------------
-- 7. RPC ADMIN : ADMIN_CREATE_SCHOOL_DOCUMENT (CRÉATION DRAFT INITIAL)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_school_document(
  p_title TEXT,
  p_description TEXT,
  p_category TEXT,
  p_target_scope TEXT,
  p_class_id UUID,
  p_student_id UUID,
  p_file_name TEXT,
  p_file_extension TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_admin_school_id UUID;
  v_doc_id UUID := gen_random_uuid();
  v_storage_path TEXT;
  v_ext TEXT;
  v_dummy_sha TEXT := '0000000000000000000000000000000000000000000000000000000000000000';
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT school_id INTO v_admin_school_id
  FROM public.profiles
  WHERE id = v_caller_id AND role = 'school_admin' AND is_active = true;

  IF v_admin_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur scolaire actif peut créer un document.' USING ERRCODE = '42501';
  END IF;

  v_ext := LOWER(TRIM(LEADING '.' FROM p_file_extension));
  IF v_ext NOT IN ('pdf', 'png', 'jpg', 'jpeg') THEN
    RAISE EXCEPTION 'EXTENSION INVALIDE : Seules les extensions pdf, png, jpg, jpeg sont autorisées.' USING ERRCODE = '42501';
  END IF;

  v_storage_path := v_admin_school_id::text || '/' || v_doc_id::text || '/original.' || v_ext;

  INSERT INTO public.school_documents (
    id, school_id, title, description, category, target_scope,
    class_id, student_id, storage_path, file_name, file_size_bytes,
    mime_type, checksum_sha256, status, created_by
  ) VALUES (
    v_doc_id, v_admin_school_id, p_title, p_description, p_category, p_target_scope,
    p_class_id, p_student_id, v_storage_path, p_file_name, 1,
    CASE WHEN v_ext = 'pdf' THEN 'application/pdf' WHEN v_ext = 'png' THEN 'image/png' ELSE 'image/jpeg' END,
    v_dummy_sha, 'draft', v_caller_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'document_id', v_doc_id,
    'school_id', v_admin_school_id,
    'storage_path', v_storage_path,
    'status', 'draft'
  );
END;
$$;

--------------------------------------------------------------------------------
-- 8. RPC ADMIN : ADMIN_FINALIZE_SCHOOL_DOCUMENT_UPLOAD
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_finalize_school_document_upload(
  p_document_id UUID,
  p_file_size_bytes BIGINT,
  p_mime_type TEXT,
  p_checksum_sha256 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_admin_school_id UUID;
  v_doc RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT school_id INTO v_admin_school_id
  FROM public.profiles
  WHERE id = v_caller_id AND role = 'school_admin' AND is_active = true;

  IF v_admin_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur scolaire actif peut finaliser les métadonnées.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc
  FROM public.school_documents
  WHERE id = p_document_id AND school_id = v_admin_school_id AND status = 'draft';

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'DOCUMENT INTROUVABLE : Le document draft n’existe pas dans votre établissement.' USING ERRCODE = '42501';
  END IF;

  IF p_file_size_bytes <= 0 OR p_file_size_bytes > 15728640 THEN
    RAISE EXCEPTION 'TAILLE INVALIDE : La taille du fichier (%) excède la limite autorisée.', p_file_size_bytes USING ERRCODE = '42501';
  END IF;

  IF p_mime_type NOT IN ('application/pdf', 'image/png', 'image/jpeg') THEN
    RAISE EXCEPTION 'MIME INVALIDE : Le type MIME (%) n’est pas autorisé.', p_mime_type USING ERRCODE = '42501';
  END IF;

  IF p_checksum_sha256 !~ '^[0-9a-fA-F]{64}$' OR p_checksum_sha256 = '0000000000000000000000000000000000000000000000000000000000000000' THEN
    RAISE EXCEPTION 'CHECKSUM INVALIDE : Le hash SHA-256 est invalide.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.school_documents
  SET file_size_bytes = p_file_size_bytes,
      mime_type = p_mime_type,
      checksum_sha256 = LOWER(p_checksum_sha256),
      updated_at = now()
  WHERE id = p_document_id;

  RETURN pg_catalog.jsonb_build_object(
    'document_id', p_document_id,
    'status', 'draft',
    'file_size_bytes', p_file_size_bytes,
    'mime_type', p_mime_type,
    'checksum_sha256', LOWER(p_checksum_sha256)
  );
END;
$$;

--------------------------------------------------------------------------------
-- 9. RPC ADMIN : ADMIN_CLEANUP_FAILED_DRAFT (COMPENSATION)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cleanup_failed_draft(
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_admin_school_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT school_id INTO v_admin_school_id
  FROM public.profiles
  WHERE id = v_caller_id AND role = 'school_admin' AND is_active = true;

  IF v_admin_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur scolaire actif peut nettoyer un brouillon.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.school_documents
  WHERE id = p_document_id AND school_id = v_admin_school_id AND status = 'draft';

  RETURN pg_catalog.jsonb_build_object(
    'document_id', p_document_id,
    'cleaned_up', true
  );
END;
$$;

--------------------------------------------------------------------------------
-- 10. RPC ADMIN : ADMIN_PUBLISH_SCHOOL_DOCUMENT (PASSAGE DRAFT -> PUBLISHED)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_publish_school_document(
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_admin_school_id UUID;
  v_doc RECORD;
  v_storage_exists BOOLEAN := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT school_id INTO v_admin_school_id
  FROM public.profiles
  WHERE id = v_caller_id AND role = 'school_admin' AND is_active = true;

  IF v_admin_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur scolaire actif peut publier un document.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc
  FROM public.school_documents
  WHERE id = p_document_id AND school_id = v_admin_school_id;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'DOCUMENT INTROUVABLE : Le document n’existe pas dans votre établissement.' USING ERRCODE = '42501';
  END IF;

  -- Refuser les transitions invalides
  IF v_doc.status <> 'draft' THEN
    RAISE EXCEPTION 'TRANSITION INVALIDE : Seul un document draft peut être publié (statut actuel: %).', v_doc.status
      USING ERRCODE = '42501';
  END IF;

  -- Vérifier que le document a de vraies métadonnées finales
  IF v_doc.checksum_sha256 = '0000000000000000000000000000000000000000000000000000000000000000' THEN
    RAISE EXCEPTION 'MÉTADONNÉES INCOMPLÈTES : Le fichier n’a pas été finalisé par le serveur d’upload.'
      USING ERRCODE = '42501';
  END IF;

  -- Vérifier la présence réelle dans storage.objects avant publication
  SELECT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'school-documents' AND name = v_doc.storage_path
  ) INTO v_storage_exists;

  IF NOT v_storage_exists THEN
    RAISE EXCEPTION 'FICHIER INTROUVABLE : Le fichier physique doit être téléversé dans Storage avant publication.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.school_documents
  SET status = 'published',
      published_at = now(),
      updated_at = now()
  WHERE id = p_document_id;

  RETURN pg_catalog.jsonb_build_object(
    'document_id', p_document_id,
    'status', 'published',
    'published_at', now()
  );
END;
$$;

--------------------------------------------------------------------------------
-- 11. RPC ADMIN : ADMIN_ARCHIVE_SCHOOL_DOCUMENT (PASSAGE PUBLISHED -> ARCHIVED)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_archive_school_document(
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_admin_school_id UUID;
  v_doc RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT school_id INTO v_admin_school_id
  FROM public.profiles
  WHERE id = v_caller_id AND role = 'school_admin' AND is_active = true;

  IF v_admin_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur scolaire actif peut archiver un document.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc
  FROM public.school_documents
  WHERE id = p_document_id AND school_id = v_admin_school_id;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'DOCUMENT INTROUVABLE : Le document n’existe pas dans votre établissement.' USING ERRCODE = '42501';
  END IF;

  -- Refuser les transitions invalides
  IF v_doc.status <> 'published' THEN
    RAISE EXCEPTION 'TRANSITION INVALIDE : Seul un document publié peut être archivé (statut actuel: %).', v_doc.status
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.school_documents
  SET status = 'archived',
      archived_at = now(),
      updated_at = now()
  WHERE id = p_document_id;

  RETURN pg_catalog.jsonb_build_object(
    'document_id', p_document_id,
    'status', 'archived',
    'archived_at', now()
  );
END;
$$;

--------------------------------------------------------------------------------
-- 12. PRIVILÈGES DE TOUTES LES RPCs
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_parent_student_documents(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_documents(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.authorize_parent_document_download(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_parent_document_download(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_create_school_document(TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_school_document(TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_finalize_school_document_upload(UUID, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_finalize_school_document_upload(UUID, BIGINT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_cleanup_failed_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_failed_draft(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_publish_school_document(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_school_document(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_archive_school_document(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_school_document(UUID) TO authenticated;

COMMIT;
