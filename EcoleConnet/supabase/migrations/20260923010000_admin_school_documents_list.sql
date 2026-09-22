-- Migration Lot 2F-D : RPC de liste pour l'administration scolaire (get_admin_school_documents)
-- Fichier : supabase/migrations/20260923010000_admin_school_documents_list.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. RPC ADMIN : GET_ADMIN_SCHOOL_DOCUMENTS
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_school_documents(
  p_status TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_admin_school_id UUID;
  v_documents JSONB;
  v_kpi_total INT := 0;
  v_kpi_draft INT := 0;
  v_kpi_published INT := 0;
  v_kpi_archived INT := 0;
BEGIN
  -- A. Vérification de l'authentification
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  -- B. Résolution stricte de l'école de l'administrateur scolaire
  SELECT school_id INTO v_admin_school_id
  FROM public.profiles
  WHERE id = v_caller_id 
    AND role = 'school_admin' 
    AND is_active = true;

  IF v_admin_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur scolaire actif peut consulter la liste des documents de l’établissement.'
      USING ERRCODE = '42501';
  END IF;

  -- C. Validation des filtres optionnels s'ils sont fournis
  IF p_status IS NOT NULL AND p_status NOT IN ('draft', 'published', 'archived') THEN
    RAISE EXCEPTION 'FILTRE INVALIDE : Le statut (%) n’est pas valide.', p_status USING ERRCODE = '42501';
  END IF;

  IF p_category IS NOT NULL AND p_category NOT IN ('administrative', 'academic', 'rules', 'course_material', 'certificate', 'other') THEN
    RAISE EXCEPTION 'FILTRE INVALIDE : La catégorie (%) n’est pas valide.', p_category USING ERRCODE = '42501';
  END IF;

  -- D. Calcul des indicateurs KPI globaux pour l'école
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'draft'),
    COUNT(*) FILTER (WHERE status = 'published'),
    COUNT(*) FILTER (WHERE status = 'archived')
  INTO 
    v_kpi_total,
    v_kpi_draft,
    v_kpi_published,
    v_kpi_archived
  FROM public.school_documents
  WHERE school_id = v_admin_school_id;

  -- E. Sélection de la liste enrichie des documents selon filtres
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'school_id', d.school_id,
      'title', d.title,
      'description', COALESCE(d.description, ''),
      'category', d.category,
      'target_scope', d.target_scope,
      'class_id', d.class_id,
      'class_name', COALESCE(c.name, ''),
      'student_id', d.student_id,
      'student_name', CASE 
        WHEN st.id IS NOT NULL THEN TRIM(COALESCE(st.first_name, '') || ' ' || COALESCE(st.last_name, ''))
        ELSE ''
      END,
      'academic_year_id', d.academic_year_id,
      'file_name', d.file_name,
      'file_size_bytes', d.file_size_bytes,
      'mime_type', d.mime_type,
      'checksum_sha256', d.checksum_sha256,
      'status', d.status,
      'published_at', d.published_at,
      'archived_at', d.archived_at,
      'created_by', d.created_by,
      'created_at', d.created_at,
      'updated_at', d.updated_at
    ) ORDER BY d.created_at DESC
  ), '[]'::jsonb)
  INTO v_documents
  FROM public.school_documents d
  LEFT JOIN public.classes c ON c.id = d.class_id
  LEFT JOIN public.students st ON st.id = d.student_id
  WHERE d.school_id = v_admin_school_id
    AND (p_status IS NULL OR d.status = p_status)
    AND (p_category IS NULL OR d.category = p_category);

  -- F. Retour du résultat enveloppé
  RETURN jsonb_build_object(
    'school_id', v_admin_school_id,
    'kpi', jsonb_build_object(
      'total_documents', v_kpi_total,
      'draft_count', v_kpi_draft,
      'published_count', v_kpi_published,
      'archived_count', v_kpi_archived
    ),
    'documents', v_documents
  );
END;
$$;

--------------------------------------------------------------------------------
-- 2. PRIVILÈGES DE LA RPC DE LISTE ADMIN
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_admin_school_documents(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_school_documents(TEXT, TEXT) TO authenticated;

COMMIT;
