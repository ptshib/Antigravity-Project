-- Tests automatisés du Lot 2F-BR : Infrastructure documentaire sécurisée (public.school_documents, RPC Gateway & Edge Functions)
-- Fichier : supabase/tests/20260922230000_secure_school_documents_tests.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. APPLIQUER LA MIGRATION EN MÉMOIRE DE TRANSACTION
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

  CONSTRAINT chk_school_docs_scope_school CHECK (
    target_scope <> 'school' OR (class_id IS NULL AND student_id IS NULL)
  ),
  CONSTRAINT chk_school_docs_scope_class CHECK (
    target_scope <> 'class' OR (class_id IS NOT NULL AND student_id IS NULL)
  ),
  CONSTRAINT chk_school_docs_scope_student CHECK (
    target_scope <> 'student' OR (student_id IS NOT NULL AND class_id IS NULL)
  ),
  CONSTRAINT chk_school_docs_published_dates CHECK (
    status <> 'published' OR published_at IS NOT NULL
  ),
  CONSTRAINT chk_school_docs_archived_dates CHECK (
    status <> 'archived' OR archived_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_school_documents_lookup
  ON public.school_documents (school_id, target_scope, status, category);

CREATE INDEX IF NOT EXISTS idx_school_documents_class
  ON public.school_documents (class_id) WHERE class_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_school_documents_student
  ON public.school_documents (student_id) WHERE student_id IS NOT NULL;

ALTER TABLE public.school_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_documents FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_documents FROM PUBLIC;
REVOKE ALL ON TABLE public.school_documents FROM anon;
REVOKE ALL ON TABLE public.school_documents FROM authenticated;

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
  IF NEW.academic_year_id IS NOT NULL THEN
    SELECT school_id INTO v_school_check FROM public.academic_years WHERE id = NEW.academic_year_id;
    IF v_school_check IS NULL OR v_school_check <> NEW.school_id THEN
      RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.class_id IS NOT NULL THEN
    SELECT school_id INTO v_school_check FROM public.classes WHERE id = NEW.class_id;
    IF v_school_check IS NULL OR v_school_check <> NEW.school_id THEN
      RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : La classe (%) n’appartient pas à l’établissement (%).', NEW.class_id, NEW.school_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.student_id IS NOT NULL THEN
    SELECT school_id INTO v_school_check FROM public.students WHERE id = NEW.student_id;
    IF v_school_check IS NULL OR v_school_check <> NEW.school_id THEN
      RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : L’élève (%) n’appartient pas à l’établissement (%).', NEW.student_id, NEW.school_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'school-documents',
  'school-documents',
  false,
  15728640,
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg'];

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

  IF v_doc.status <> 'draft' THEN
    RAISE EXCEPTION 'TRANSITION INVALIDE : Seul un document draft peut être publié (statut actuel: %).', v_doc.status
      USING ERRCODE = '42501';
  END IF;

  IF v_doc.checksum_sha256 = '0000000000000000000000000000000000000000000000000000000000000000' THEN
    RAISE EXCEPTION 'MÉTADONNÉES INCOMPLÈTES : Le fichier n’a pas été finalisé par le serveur d’upload.'
      USING ERRCODE = '42501';
  END IF;

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

--------------------------------------------------------------------------------
-- 2. DÉROULEMENT DES 32 SCÉNARIOS DE TEST
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_school_a UUID := gen_random_uuid();
  v_school_b UUID := gen_random_uuid();

  v_year_a UUID := gen_random_uuid();
  v_year_b UUID := gen_random_uuid();

  v_class_a1 UUID := gen_random_uuid();
  v_class_a2 UUID := gen_random_uuid();
  v_class_b1 UUID := gen_random_uuid();

  v_admin_a UUID := gen_random_uuid();
  v_admin_b UUID := gen_random_uuid();
  v_teacher_a UUID := gen_random_uuid();
  v_parent_1 UUID := gen_random_uuid();
  v_parent_no_acad UUID := gen_random_uuid();
  v_parent_no_link UUID := gen_random_uuid();
  v_parent_multi UUID := gen_random_uuid();

  v_student_a1 UUID := gen_random_uuid();
  v_student_a2 UUID := gen_random_uuid();
  v_student_b1 UUID := gen_random_uuid();
  v_student_pending UUID := gen_random_uuid();
  v_student_rejected UUID := gen_random_uuid();

  v_doc_school_pub UUID := gen_random_uuid();
  v_doc_school_acad_pub UUID := gen_random_uuid();
  v_doc_school_draft UUID := gen_random_uuid();
  v_doc_school_arch UUID := gen_random_uuid();

  v_doc_class_a1_pub UUID := gen_random_uuid();
  v_doc_class_a2_pub UUID := gen_random_uuid();

  v_doc_student_a1_pub UUID := gen_random_uuid();
  v_doc_student_a2_pub UUID := gen_random_uuid();

  v_doc_school_b_pub UUID := gen_random_uuid();

  v_dummy_sha TEXT := 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
  v_res JSONB;
  v_tmp_id UUID;
BEGIN
  -- SETUP FIXTURES DE TEST
  INSERT INTO public.schools (id, name, slug, status)
  VALUES 
    (v_school_a, 'École A - Tests Doc', 'sch-doc-a', 'active'),
    (v_school_b, 'École B - Tests Doc', 'sch-doc-b', 'active');

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES 
    (v_year_a, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true),
    (v_year_b, v_school_b, '2026-2027', '2026-09-01', '2027-06-30', true);

  INSERT INTO public.classes (id, school_id, academic_year_id, name, level)
  VALUES 
    (v_class_a1, v_school_a, v_year_a, '6ème A', '6eme'),
    (v_class_a2, v_school_a, v_year_a, '6ème B', '6eme'),
    (v_class_b1, v_school_b, v_year_b, '3ème A', '3eme');

  INSERT INTO auth.users (id, email)
  VALUES 
    (v_admin_a, 'admin.a@test.com'),
    (v_admin_b, 'admin.b@test.com'),
    (v_teacher_a, 'teacher.a@test.com'),
    (v_parent_1, 'parent.1@test.com'),
    (v_parent_no_acad, 'parent.noacad@test.com'),
    (v_parent_no_link, 'parent.nolink@test.com'),
    (v_parent_multi, 'parent.multi@test.com');

  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active)
  VALUES 
    (v_admin_a, v_school_a, 'school_admin', 'Admin', 'A', true),
    (v_admin_b, v_school_b, 'school_admin', 'Admin', 'B', true),
    (v_teacher_a, v_school_a, 'teacher', 'Enseignant', 'A', true),
    (v_parent_1, v_school_a, 'parent', 'Parent', 'Un', true),
    (v_parent_no_acad, v_school_a, 'parent', 'Parent', 'NoAcad', true),
    (v_parent_no_link, v_school_a, 'parent', 'Parent', 'NoLink', true),
    (v_parent_multi, v_school_a, 'parent', 'Parent', 'Multi', true);

  INSERT INTO public.students (id, school_id, class_id, first_name, last_name, student_number)
  VALUES 
    (v_student_a1, v_school_a, v_class_a1, 'Élève', 'A1', 'STU-A1'),
    (v_student_a2, v_school_a, v_class_a2, 'Élève', 'A2', 'STU-A2'),
    (v_student_b1, v_school_b, v_class_b1, 'Élève', 'B1', 'STU-B1'),
    (v_student_pending, v_school_a, v_class_a1, 'Élève', 'Pending', 'STU-P'),
    (v_student_rejected, v_school_a, v_class_a1, 'Élève', 'Rejected', 'STU-R');

  INSERT INTO public.parent_student_links (id, school_id, parent_profile_id, student_id, status, can_view_academic)
  VALUES 
    (gen_random_uuid(), v_school_a, v_parent_1, v_student_a1, 'approved', true),
    (gen_random_uuid(), v_school_a, v_parent_1, v_student_a2, 'approved', true),
    (gen_random_uuid(), v_school_a, v_parent_1, v_student_pending, 'pending', true),
    (gen_random_uuid(), v_school_a, v_parent_1, v_student_rejected, 'rejected', true),
    (gen_random_uuid(), v_school_a, v_parent_no_acad, v_student_a1, 'approved', false),
    (gen_random_uuid(), v_school_a, v_parent_multi, v_student_a1, 'approved', true),
    (gen_random_uuid(), v_school_b, v_parent_multi, v_student_b1, 'approved', true);

  -- Objets dans storage.objects
  INSERT INTO storage.objects (id, bucket_id, name)
  VALUES 
    (gen_random_uuid(), 'school-documents', v_school_a::text || '/' || v_doc_school_pub::text || '/original.pdf'),
    (gen_random_uuid(), 'school-documents', v_school_a::text || '/' || v_doc_school_acad_pub::text || '/original.pdf'),
    (gen_random_uuid(), 'school-documents', v_school_a::text || '/' || v_doc_class_a1_pub::text || '/original.pdf'),
    (gen_random_uuid(), 'school-documents', v_school_a::text || '/' || v_doc_class_a2_pub::text || '/original.pdf'),
    (gen_random_uuid(), 'school-documents', v_school_a::text || '/' || v_doc_student_a1_pub::text || '/original.pdf'),
    (gen_random_uuid(), 'school-documents', v_school_a::text || '/' || v_doc_student_a2_pub::text || '/original.pdf'),
    (gen_random_uuid(), 'school-documents', v_school_b::text || '/' || v_doc_school_b_pub::text || '/original.pdf');

  -- Métadonnées de documents
  INSERT INTO public.school_documents (
    id, school_id, academic_year_id, title, description, category, target_scope,
    class_id, student_id, storage_path, file_name, file_size_bytes, mime_type,
    checksum_sha256, status, published_at, archived_at, created_by
  ) VALUES 
    (v_doc_school_pub, v_school_a, v_year_a, 'Règlement Intérieur A', 'Desc', 'rules', 'school', NULL, NULL, v_school_a::text || '/' || v_doc_school_pub::text || '/original.pdf', 'reglement.pdf', 1024, 'application/pdf', v_dummy_sha, 'published', now(), NULL, v_admin_a),
    (v_doc_school_acad_pub, v_school_a, v_year_a, 'Programme Académique A', 'Desc', 'academic', 'school', NULL, NULL, v_school_a::text || '/' || v_doc_school_acad_pub::text || '/original.pdf', 'programme.pdf', 2048, 'application/pdf', v_dummy_sha, 'published', now(), NULL, v_admin_a),
    (v_doc_school_draft, v_school_a, v_year_a, 'Projet Brouillon', 'Desc', 'administrative', 'school', NULL, NULL, v_school_a::text || '/' || v_doc_school_draft::text || '/original.pdf', 'brouillon.pdf', 512, 'application/pdf', v_dummy_sha, 'draft', NULL, NULL, v_admin_a),
    (v_doc_school_arch, v_school_a, v_year_a, 'Ancien Règlement Archivé', 'Desc', 'rules', 'school', NULL, NULL, v_school_a::text || '/' || v_doc_school_arch::text || '/original.pdf', 'ancien.pdf', 1024, 'application/pdf', v_dummy_sha, 'archived', now(), now(), v_admin_a),
    (v_doc_class_a1_pub, v_school_a, v_year_a, 'Planning 6ème A', 'Desc', 'administrative', 'class', v_class_a1, NULL, v_school_a::text || '/' || v_doc_class_a1_pub::text || '/original.pdf', 'planning_a1.pdf', 1024, 'application/pdf', v_dummy_sha, 'published', now(), NULL, v_admin_a),
    (v_doc_class_a2_pub, v_school_a, v_year_a, 'Planning 6ème B', 'Desc', 'administrative', 'class', v_class_a2, NULL, v_school_a::text || '/' || v_doc_class_a2_pub::text || '/original.pdf', 'planning_a2.pdf', 1024, 'application/pdf', v_dummy_sha, 'published', now(), NULL, v_admin_a),
    (v_doc_student_a1_pub, v_school_a, v_year_a, 'Certificat Élève A1', 'Desc', 'certificate', 'student', NULL, v_student_a1, v_school_a::text || '/' || v_doc_student_a1_pub::text || '/original.pdf', 'cert_a1.pdf', 1024, 'application/pdf', v_dummy_sha, 'published', now(), NULL, v_admin_a),
    (v_doc_student_a2_pub, v_school_a, v_year_a, 'Certificat Élève A2', 'Desc', 'certificate', 'student', NULL, v_student_a2, v_school_a::text || '/' || v_doc_student_a2_pub::text || '/original.pdf', 'cert_a2.pdf', 1024, 'application/pdf', v_dummy_sha, 'published', now(), NULL, v_admin_a),
    (v_doc_school_b_pub, v_school_b, v_year_b, 'Règlement Intérieur B', 'Desc', 'rules', 'school', NULL, NULL, v_school_b::text || '/' || v_doc_school_b_pub::text || '/original.pdf', 'reglement_b.pdf', 1024, 'application/pdf', v_dummy_sha, 'published', now(), NULL, v_admin_a);

  ------------------------------------------------------------------------------
  -- TEST 1 : PARENT APPROUVÉ : DOCUMENT ÉCOLE VISIBLE
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_1, 'role', 'authenticated')::text);
  v_res := public.get_parent_student_documents(v_student_a1);
  IF v_res::text NOT LIKE '%Règlement Intérieur A%' THEN RAISE EXCEPTION 'TEST 1 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 2 : DOCUMENT CLASSE CORRECTE VISIBLE
  ------------------------------------------------------------------------------
  IF v_res::text NOT LIKE '%Planning 6ème A%' THEN RAISE EXCEPTION 'TEST 2 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 3 : DOCUMENT AUTRE CLASSE INVISIBLE
  ------------------------------------------------------------------------------
  IF v_res::text LIKE '%Planning 6ème B%' THEN RAISE EXCEPTION 'TEST 3 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 4 : DOCUMENT ÉLÈVE CORRECT VISIBLE
  ------------------------------------------------------------------------------
  IF v_res::text NOT LIKE '%Certificat Élève A1%' THEN RAISE EXCEPTION 'TEST 4 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 5 : DOCUMENT AUTRE ÉLÈVE INVISIBLE
  ------------------------------------------------------------------------------
  IF v_res::text LIKE '%Certificat Élève A2%' THEN RAISE EXCEPTION 'TEST 5 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 6 : AUTRE ÉCOLE INVISIBLE
  ------------------------------------------------------------------------------
  IF v_res::text LIKE '%Règlement Intérieur B%' THEN RAISE EXCEPTION 'TEST 6 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 7 : LIEN PENDING REFUSÉ (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_res := public.get_parent_student_documents(v_student_pending);
    RAISE EXCEPTION 'TEST 7 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 7 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 8 : LIEN REJECTED REFUSÉ (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_res := public.get_parent_student_documents(v_student_rejected);
    RAISE EXCEPTION 'TEST 8 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 8 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 9 : DOCUMENT ACADÉMIQUE REFUSÉ SANS CAN_VIEW_ACADEMIC
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_no_acad, 'role', 'authenticated')::text);
  v_res := public.get_parent_student_documents(v_student_a1);
  IF v_res::text LIKE '%Programme Académique A%' THEN RAISE EXCEPTION 'TEST 9 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 10 : DOCUMENT ADMINISTRATIF AUTORISÉ AVEC LIEN APPROVED
  ------------------------------------------------------------------------------
  IF v_res::text NOT LIKE '%Règlement Intérieur A%' THEN RAISE EXCEPTION 'TEST 10 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 11 : DRAFT INVISIBLE
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_1, 'role', 'authenticated')::text);
  v_res := public.get_parent_student_documents(v_student_a1);
  IF v_res::text LIKE '%Projet Brouillon%' THEN RAISE EXCEPTION 'TEST 11 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 12 : ARCHIVED INVISIBLE
  ------------------------------------------------------------------------------
  IF v_res::text LIKE '%Ancien Règlement Archivé%' THEN RAISE EXCEPTION 'TEST 12 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 13 : PUBLISHED VISIBLE
  ------------------------------------------------------------------------------
  IF v_res::text NOT LIKE '%Règlement Intérieur A%' THEN RAISE EXCEPTION 'TEST 13 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 14 : AUTORISATION DE TÉLÉCHARGEMENT IDOR REFUSÉE
  ------------------------------------------------------------------------------
  BEGIN
    v_res := public.authorize_parent_document_download(v_student_a1, v_doc_student_a2_pub);
    RAISE EXCEPTION 'TEST 14 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 14 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 15 : INCOHÉRENCE ACADEMIC_YEAR / SCHOOL BLOQUÉE PAR TRIGGER (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_tmp_id := gen_random_uuid();
    INSERT INTO public.school_documents (
      id, school_id, academic_year_id, title, category, target_scope,
      storage_path, file_name, file_size_bytes, mime_type, checksum_sha256, status, created_by
    ) VALUES (
      v_tmp_id, v_school_a, v_year_b, 'Année incohérente', 'rules', 'school',
      v_school_a::text || '/' || v_tmp_id::text || '/original.pdf', 't.pdf', 1024, 'application/pdf', v_dummy_sha, 'draft', v_admin_a
    );
    RAISE EXCEPTION 'TEST 15 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 15 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 16 : INCOHÉRENCE CLASS / SCHOOL BLOQUÉE PAR TRIGGER (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_tmp_id := gen_random_uuid();
    INSERT INTO public.school_documents (
      id, school_id, class_id, title, category, target_scope,
      storage_path, file_name, file_size_bytes, mime_type, checksum_sha256, status, created_by
    ) VALUES (
      v_tmp_id, v_school_a, v_class_b1, 'Classe incohérente', 'administrative', 'class',
      v_school_a::text || '/' || v_tmp_id::text || '/original.pdf', 't.pdf', 1024, 'application/pdf', v_dummy_sha, 'draft', v_admin_a
    );
    RAISE EXCEPTION 'TEST 16 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 16 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 17 : INCOHÉRENCE STUDENT / SCHOOL BLOQUÉE PAR TRIGGER (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_tmp_id := gen_random_uuid();
    INSERT INTO public.school_documents (
      id, school_id, student_id, title, category, target_scope,
      storage_path, file_name, file_size_bytes, mime_type, checksum_sha256, status, created_by
    ) VALUES (
      v_tmp_id, v_school_a, v_student_b1, 'Élève incohérent', 'certificate', 'student',
      v_school_a::text || '/' || v_tmp_id::text || '/original.pdf', 't.pdf', 1024, 'application/pdf', v_dummy_sha, 'draft', v_admin_a
    );
    RAISE EXCEPTION 'TEST 17 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 17 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 18 : PORTÉE AMBIGUË BLOQUÉE PAR CONTRAINTE CHECK (23514)
  ------------------------------------------------------------------------------
  BEGIN
    v_tmp_id := gen_random_uuid();
    INSERT INTO public.school_documents (
      id, school_id, class_id, title, category, target_scope,
      storage_path, file_name, file_size_bytes, mime_type, checksum_sha256, status, created_by
    ) VALUES (
      v_tmp_id, v_school_a, v_class_a1, 'Portée ambiguë', 'rules', 'school',
      v_school_a::text || '/' || v_tmp_id::text || '/original.pdf', 't.pdf', 1024, 'application/pdf', v_dummy_sha, 'draft', v_admin_a
    );
    RAISE EXCEPTION 'TEST 18 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '23514' THEN RAISE EXCEPTION 'TEST 18 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 19 : CHEMIN STORAGE INCORRECT BLOQUÉ PAR TRIGGER (42501)
  ------------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.school_documents (
      id, school_id, title, category, target_scope,
      storage_path, file_name, file_size_bytes, mime_type, checksum_sha256, status, created_by
    ) VALUES (
      gen_random_uuid(), v_school_a, 'Mauvais chemin', 'rules', 'school',
      'invalid/path/file.pdf', 't.pdf', 1024, 'application/pdf', v_dummy_sha, 'draft', v_admin_a
    );
    RAISE EXCEPTION 'TEST 19 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 19 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 20 : UTILISATEUR NON AUTHENTIFIÉ REFUSÉ (42501)
  ------------------------------------------------------------------------------
  EXECUTE 'RESET "request.jwt.claims"';
  BEGIN
    v_res := public.get_parent_student_documents(v_student_a1);
    RAISE EXCEPTION 'TEST 20 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 20 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 21 : PRIVILÈGES PUBLIC/ANON REFUSÉS SUR LA TABLE
  ------------------------------------------------------------------------------
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_res FROM public.school_documents;
    IF (v_res::text)::int > 0 THEN RAISE EXCEPTION 'TEST 21 ÉCHEC'; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RESET ROLE;

  ------------------------------------------------------------------------------
  -- TEST 22 : PARENT MULTI-ÉCOLE ISOLÉ CORRECTEMENT
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_multi, 'role', 'authenticated')::text);
  v_res := public.get_parent_student_documents(v_student_a1);
  IF v_res::text LIKE '%Règlement Intérieur B%' THEN RAISE EXCEPTION 'TEST 22 ÉCHEC'; END IF;

  v_res := public.get_parent_student_documents(v_student_b1);
  IF v_res::text LIKE '%Règlement Intérieur A%' THEN RAISE EXCEPTION 'TEST 22 ÉCHEC'; END IF;
  IF v_res::text NOT LIKE '%Règlement Intérieur B%' THEN RAISE EXCEPTION 'TEST 22 ÉCHEC'; END IF;

  ------------------------------------------------------------------------------
  -- TEST 23 : PARENT NE PEUT PAS LIRE DIRECTEMENT STORAGE.OBJECTS
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_1, 'role', 'authenticated')::text);
  BEGIN
    SELECT count(*) INTO v_res FROM storage.objects WHERE bucket_id = 'school-documents';
    IF (v_res::text)::int > 0 THEN RAISE EXCEPTION 'TEST 23 ÉCHEC'; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ------------------------------------------------------------------------------
  -- TEST 24 : AUTHENTICATED NE PEUT PAS UPLOADER DIRECTEMENT DANS SCHOOL-DOCUMENTS
  ------------------------------------------------------------------------------
  BEGIN
    INSERT INTO storage.objects (id, bucket_id, name) VALUES (gen_random_uuid(), 'school-documents', 'direct_hack.pdf');
    RAISE EXCEPTION 'TEST 24 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RESET ROLE;

  ------------------------------------------------------------------------------
  -- TEST 25 : ENSEIGNANT NE PEUT PAS CRÉER UN DOCUMENT (42501)
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_teacher_a, 'role', 'authenticated')::text);
  BEGIN
    v_res := public.admin_create_school_document('Test Teacher', 'Desc', 'rules', 'school', NULL, NULL, 'test.pdf', 'pdf');
    RAISE EXCEPTION 'TEST 25 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 25 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 26 : PARENT NE PEUT PAS CRÉER UN DOCUMENT (42501)
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_1, 'role', 'authenticated')::text);
  BEGIN
    v_res := public.admin_create_school_document('Test Parent', 'Desc', 'rules', 'school', NULL, NULL, 'test.pdf', 'pdf');
    RAISE EXCEPTION 'TEST 26 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 26 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 27 : SCHOOL_ADMIN D'UNE AUTRE ÉCOLE NE PEUT PAS PUBLIER (42501)
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);
  BEGIN
    v_res := public.admin_publish_school_document(v_doc_school_draft);
    RAISE EXCEPTION 'TEST 27 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 27 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 28 : PUBLICATION REFUSÉE SI OBJET STORAGE ABSENT (42501)
  ------------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  BEGIN
    v_res := public.admin_publish_school_document(v_doc_school_draft);
    RAISE EXCEPTION 'TEST 28 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 28 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 29 : TRANSITION PUBLISHED -> DRAFT REFUSÉE (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_res := public.admin_finalize_school_document_upload(v_doc_school_pub, 2048, 'application/pdf', v_dummy_sha);
    RAISE EXCEPTION 'TEST 29 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 29 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 30 : TRANSITION DRAFT -> ARCHIVED REFUSÉE (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_res := public.admin_archive_school_document(v_doc_school_draft);
    RAISE EXCEPTION 'TEST 30 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 30 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 31 : ARCHIVAGE REND L'AUTORISATION DE TÉLÉCHARGEMENT IMPOSSIBLE (42501)
  ------------------------------------------------------------------------------
  -- Archiver le document v_doc_school_pub
  v_res := public.admin_archive_school_document(v_doc_school_pub);
  IF (v_res->>'status') <> 'archived' THEN RAISE EXCEPTION 'TEST 31 ÉCHEC archivage'; END IF;

  -- Essayer de demander l'autorisation parent sur le document désormais archivé
  EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object('sub', v_parent_1, 'role', 'authenticated')::text);
  BEGIN
    v_res := public.authorize_parent_document_download(v_student_a1, v_doc_school_pub);
    RAISE EXCEPTION 'TEST 31 ÉCHEC autorisation archivée';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 31 ÉCHEC'; END IF;
  END;

  ------------------------------------------------------------------------------
  -- TEST 32 : FONCTION D'ARCHIVAGE REFUSE UN UTILISATEUR NON ADMIN (42501)
  ------------------------------------------------------------------------------
  BEGIN
    v_res := public.admin_archive_school_document(v_doc_class_a1_pub);
    RAISE EXCEPTION 'TEST 32 ÉCHEC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'TEST 32 ÉCHEC'; END IF;
  END;

  RAISE NOTICE 'SUCCÈS COMPLET : LES 32 TESTS DE SÉCURITÉ DOCUMENTAIRE DU LOT 2F-BR SONT PASSÉS !';
END;
$$;

SELECT 'TOUS LES 32 TESTS DU LOT 2F-BR SONT VALIDÉS AVEC SUCCÈS' AS test_status;

ROLLBACK;
