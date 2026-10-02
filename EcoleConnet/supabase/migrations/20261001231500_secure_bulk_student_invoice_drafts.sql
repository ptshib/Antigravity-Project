-- Migration : 20261001231500_secure_bulk_student_invoice_drafts.sql
-- Description : Backend sécurisé de facturation groupée, durcissement v2 (search_path='', verrous hashtextextended, gestion des numéros draft et émission)
-- Auteur : Antigravity (LOT 2K-FIN-BULK-B-V)

--------------------------------------------------------------------------------
-- 1. RPC DE PRÉVISUALISATION : PREVIEW_BULK_STUDENT_INVOICE_DRAFTS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_bulk_student_invoice_drafts(
  p_fee_id UUID,
  p_scope TEXT DEFAULT 'fee_target',
  p_class_ids UUID[] DEFAULT NULL,
  p_student_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_caller_role TEXT;

  v_fee RECORD;
  v_acad_year_name TEXT;
  v_clean_scope TEXT;

  v_cand RECORD;
  v_selected_count INTEGER := 0;
  v_eligible_count INTEGER := 0;
  v_already_invoiced_count INTEGER := 0;
  v_inactive_or_unenrolled_count INTEGER := 0;

  v_eligible_list JSONB := '[]'::jsonb;
  v_excluded_list JSONB := '[]'::jsonb;

  v_is_eligible BOOLEAN;
  v_reason_code TEXT;
  v_reason_label TEXT;
  v_target_desc TEXT;
  v_existing_inv_count INTEGER;

  v_class_ids_dedup UUID[] := ARRAY[]::UUID[];
  v_student_ids_dedup UUID[] := ARRAY[]::UUID[];
BEGIN
  -- A. Authentification & Contrôle du Rôle Staff Financier
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role
  INTO v_caller_school_id, v_caller_role
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif d’un établissement actif peut prévisualiser un lot.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Validation du Scope & Strictité des Paramètres Mutuellement Exclusifs
  v_clean_scope := pg_catalog.btrim(COALESCE(p_scope, 'fee_target'));
  IF v_clean_scope NOT IN ('fee_target', 'classes', 'students') THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Scope invalide (%). Valeurs autorisées : fee_target, classes, students.', v_clean_scope
      USING ERRCODE = '22023';
  END IF;

  IF v_clean_scope = 'fee_target' THEN
    IF p_class_ids IS NOT NULL AND pg_catalog.cardinality(p_class_ids) > 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "fee_target", p_class_ids doit être NULL ou vide.' USING ERRCODE = '22023';
    END IF;
    IF p_student_ids IS NOT NULL AND pg_catalog.cardinality(p_student_ids) > 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "fee_target", p_student_ids doit être NULL ou vide.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_clean_scope = 'classes' THEN
    IF p_class_ids IS NULL OR pg_catalog.cardinality(p_class_ids) = 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "classes", p_class_ids ne peut être vide.' USING ERRCODE = '22023';
    END IF;
    IF p_student_ids IS NOT NULL AND pg_catalog.cardinality(p_student_ids) > 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "classes", p_student_ids doit être NULL ou vide.' USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.array_agg(DISTINCT cid) INTO v_class_ids_dedup
    FROM pg_catalog.unnest(p_class_ids) AS cid;
  ELSIF v_clean_scope = 'students' THEN
    IF p_student_ids IS NULL OR pg_catalog.cardinality(p_student_ids) = 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "students", p_student_ids ne peut être vide.' USING ERRCODE = '22023';
    END IF;
    IF p_class_ids IS NOT NULL AND pg_catalog.cardinality(p_class_ids) > 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "students", p_class_ids doit être NULL ou vide.' USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.array_agg(DISTINCT sid) INTO v_student_ids_dedup
    FROM pg_catalog.unnest(p_student_ids) AS sid;
  END IF;

  -- C. Validation et Récupération du Tarif Scolaire
  SELECT sf.*
  INTO v_fee
  FROM public.school_fees sf
  WHERE sf.id = p_fee_id
    AND sf.school_id = v_caller_school_id;

  IF v_fee.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Tarif introuvable ou n’appartient pas à votre établissement.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_fee.is_active THEN
    RAISE EXCEPTION 'REJET : Le tarif "%" est inactif.', v_fee.name
      USING ERRCODE = '22023';
  END IF;

  SELECT name INTO v_acad_year_name
  FROM public.academic_years
  WHERE id = v_fee.academic_year_id AND school_id = v_caller_school_id;

  v_target_desc := CASE WHEN v_fee.class_id IS NULL THEN 'school' ELSE 'class' END;

  -- Validation supplémentaire si le tarif est ciblé classe et scope = classes
  IF v_clean_scope = 'classes' AND v_fee.class_id IS NOT NULL THEN
    IF NOT (v_class_ids_dedup = ARRAY[v_fee.class_id]) THEN
      RAISE EXCEPTION 'REJET : Ce tarif est restreint à une classe spécifique.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- D. Évaluation de la Population Candidate
  FOR v_cand IN
    SELECT
      st.id AS student_id,
      pr.first_name,
      pr.last_name,
      cl.name AS class_name,
      cl.id AS class_id,
      se.id AS enrollment_id,
      se.status AS enrollment_status,
      st.school_id AS student_school_id,
      pr.is_active AS profile_active
    FROM (
      SELECT DISTINCT s_id
      FROM (
        SELECT se_in.student_id AS s_id
        FROM public.student_enrollments se_in
        WHERE se_in.school_id = v_caller_school_id
          AND se_in.academic_year_id = v_fee.academic_year_id
          AND (
            (v_clean_scope = 'fee_target' AND (v_fee.class_id IS NULL OR se_in.class_id = v_fee.class_id)) OR
            (v_clean_scope = 'classes' AND (v_fee.class_id IS NULL OR se_in.class_id = v_fee.class_id) AND se_in.class_id = ANY(v_class_ids_dedup)) OR
            (v_clean_scope = 'students' AND se_in.student_id = ANY(v_student_ids_dedup))
          )
        UNION
        SELECT unnest(v_student_ids_dedup) AS s_id
        WHERE v_clean_scope = 'students' AND v_student_ids_dedup IS NOT NULL
      ) req
    ) c_list
    JOIN public.students st ON st.id = c_list.s_id
    LEFT JOIN public.profiles pr ON pr.id = st.profile_id
    LEFT JOIN public.student_enrollments se ON se.student_id = st.id
      AND se.school_id = v_caller_school_id
      AND se.academic_year_id = v_fee.academic_year_id
      AND se.status = 'active'
    LEFT JOIN public.classes cl ON cl.id = se.class_id
    ORDER BY pr.last_name ASC NULLS LAST, pr.first_name ASC NULLS LAST
  LOOP
    v_selected_count := v_selected_count + 1;
    v_is_eligible := TRUE;
    v_reason_code := NULL;
    v_reason_label := NULL;

    IF v_cand.student_school_id <> v_caller_school_id THEN
      v_is_eligible := FALSE;
      v_reason_code := 'cross_school';
      v_reason_label := 'Élève rattaché à un autre établissement';
      v_inactive_or_unenrolled_count := v_inactive_or_unenrolled_count + 1;
    ELSIF v_cand.enrollment_id IS NULL OR v_cand.enrollment_status <> 'active' THEN
      v_is_eligible := FALSE;
      v_reason_code := 'inactive_enrollment';
      v_reason_label := 'Aucune inscription active pour cette année scolaire';
      v_inactive_or_unenrolled_count := v_inactive_or_unenrolled_count + 1;
    ELSIF v_cand.profile_active IS NOT TRUE THEN
      v_is_eligible := FALSE;
      v_reason_code := 'inactive_profile';
      v_reason_label := 'Compte élève inactif';
      v_inactive_or_unenrolled_count := v_inactive_or_unenrolled_count + 1;
    ELSIF v_fee.class_id IS NOT NULL AND v_cand.class_id <> v_fee.class_id THEN
      v_is_eligible := FALSE;
      v_reason_code := 'wrong_class';
      v_reason_label := 'Élève appartenant à une autre classe non ciblée par ce tarif';
      v_inactive_or_unenrolled_count := v_inactive_or_unenrolled_count + 1;
    ELSE
      SELECT COUNT(*)
      INTO v_existing_inv_count
      FROM public.student_invoices inv
      JOIN public.student_invoice_items item ON item.invoice_id = inv.id
      WHERE inv.school_id = v_caller_school_id
        AND inv.academic_year_id = v_fee.academic_year_id
        AND inv.student_id = v_cand.student_id
        AND inv.status IN ('draft', 'issued', 'partially_paid', 'paid')
        AND item.fee_id = p_fee_id;

      IF v_existing_inv_count > 0 THEN
        v_is_eligible := FALSE;
        v_reason_code := 'already_invoiced';
        v_reason_label := 'Élève déjà facturé pour ce tarif';
        v_already_invoiced_count := v_already_invoiced_count + 1;
      END IF;
    END IF;

    IF v_is_eligible THEN
      v_eligible_count := v_eligible_count + 1;
      v_eligible_list := v_eligible_list || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'student_id', v_cand.student_id,
          'first_name', COALESCE(v_cand.first_name, 'Élève'),
          'last_name', COALESCE(v_cand.last_name, 'Sans Nom'),
          'class_name', COALESCE(v_cand.class_name, 'Non assignée')
        )
      );
    ELSE
      v_excluded_list := v_excluded_list || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'student_id', v_cand.student_id,
          'first_name', COALESCE(v_cand.first_name, 'Élève'),
          'last_name', COALESCE(v_cand.last_name, 'Sans Nom'),
          'reason_code', v_reason_code,
          'reason_label', v_reason_label
        )
      );
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'fee', pg_catalog.jsonb_build_object(
      'fee_id', v_fee.id,
      'title', v_fee.name,
      'amount', v_fee.amount,
      'currency', v_fee.currency,
      'due_date', v_fee.due_date,
      'academic_year_name', COALESCE(v_acad_year_name, ''),
      'target', v_target_desc
    ),
    'scope', v_clean_scope,
    'summary', pg_catalog.jsonb_build_object(
      'selected', v_selected_count,
      'eligible', v_eligible_count,
      'already_invoiced', v_already_invoiced_count,
      'inactive_or_unenrolled', v_inactive_or_unenrolled_count,
      'estimated_total', (v_eligible_count * v_fee.amount),
      'currency', v_fee.currency
    ),
    'eligible_students', v_eligible_list,
    'excluded_students', v_excluded_list
  );
END;
$$;

ALTER FUNCTION public.preview_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[]) TO authenticated;

--------------------------------------------------------------------------------
-- 2. RPC DE CRÉATION GROUPÉE : CREATE_BULK_STUDENT_INVOICE_DRAFTS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_bulk_student_invoice_drafts(
  p_fee_id UUID,
  p_scope TEXT DEFAULT 'fee_target',
  p_class_ids UUID[] DEFAULT NULL,
  p_student_ids UUID[] DEFAULT NULL,
  p_batch_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_caller_role TEXT;

  v_clean_batch_key TEXT;
  v_clean_scope TEXT;
  v_fee RECORD;

  v_cand RECORD;
  v_selected_count INTEGER := 0;
  v_created_count INTEGER := 0;
  v_existing_count INTEGER := 0;
  v_skipped_count INTEGER := 0;

  v_student_idempotency_key TEXT;
  v_fingerprint TEXT;
  v_canonical_str TEXT;

  v_existing_inv RECORD;
  v_inv_seq INTEGER;
  v_inv_num TEXT;
  v_new_invoice_id UUID;

  v_created_invoices JSONB := '[]'::jsonb;
  v_existing_invoices JSONB := '[]'::jsonb;
  v_skipped_students JSONB := '[]'::jsonb;

  v_is_eligible BOOLEAN;
  v_reason_code TEXT;
  v_reason_label TEXT;
  v_existing_fee_inv_count INTEGER;

  v_class_ids_dedup UUID[] := ARRAY[]::UUID[];
  v_student_ids_dedup UUID[] := ARRAY[]::UUID[];
BEGIN
  -- A. Authentification & Contrôle du Rôle Staff Financier
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role
  INTO v_caller_school_id, v_caller_role
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif d’un établissement actif peut exécuter un lot.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Validation Stricte de la Clé d'Idempotence du Batch (Regex ^[a-zA-Z0-9_\-\.:]{1,128}$)
  v_clean_batch_key := pg_catalog.btrim(COALESCE(p_batch_idempotency_key, ''));
  IF v_clean_batch_key = '' OR pg_catalog.length(v_clean_batch_key) > 128 OR NOT (v_clean_batch_key ~ '^[a-zA-Z0-9_\-\.:]{1,128}$') THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : La clé d''idempotence de batch (p_batch_idempotency_key) est obligatoire (1 à 128 caractères alphanumériques, tirets, points, deux-points ou underscores).'
      USING ERRCODE = '22023';
  END IF;

  -- C. Validation du Scope & Strictité des Paramètres Mutuellement Exclusifs
  v_clean_scope := pg_catalog.btrim(COALESCE(p_scope, 'fee_target'));
  IF v_clean_scope NOT IN ('fee_target', 'classes', 'students') THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Scope invalide (%). Valeurs autorisées : fee_target, classes, students.', v_clean_scope
      USING ERRCODE = '22023';
  END IF;

  IF v_clean_scope = 'fee_target' THEN
    IF p_class_ids IS NOT NULL AND pg_catalog.cardinality(p_class_ids) > 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "fee_target", p_class_ids doit être NULL ou vide.' USING ERRCODE = '22023';
    END IF;
    IF p_student_ids IS NOT NULL AND pg_catalog.cardinality(p_student_ids) > 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "fee_target", p_student_ids doit être NULL ou vide.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_clean_scope = 'classes' THEN
    IF p_class_ids IS NULL OR pg_catalog.cardinality(p_class_ids) = 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "classes", p_class_ids ne peut être vide.' USING ERRCODE = '22023';
    END IF;
    IF p_student_ids IS NOT NULL AND pg_catalog.cardinality(p_student_ids) > 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "classes", p_student_ids doit être NULL ou vide.' USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.array_agg(DISTINCT cid) INTO v_class_ids_dedup
    FROM pg_catalog.unnest(p_class_ids) AS cid;
  ELSIF v_clean_scope = 'students' THEN
    IF p_student_ids IS NULL OR pg_catalog.cardinality(p_student_ids) = 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "students", p_student_ids ne peut être vide.' USING ERRCODE = '22023';
    END IF;
    IF p_class_ids IS NOT NULL AND pg_catalog.cardinality(p_class_ids) > 0 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : En scope "students", p_class_ids doit être NULL ou vide.' USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.array_agg(DISTINCT sid) INTO v_student_ids_dedup
    FROM pg_catalog.unnest(p_student_ids) AS sid;
  END IF;

  -- D. Validation du Tarif Scolaire
  SELECT sf.*
  INTO v_fee
  FROM public.school_fees sf
  WHERE sf.id = p_fee_id
    AND sf.school_id = v_caller_school_id;

  IF v_fee.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Tarif introuvable ou n’appartient pas à votre établissement.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_fee.is_active THEN
    RAISE EXCEPTION 'REJET : Le tarif "%" est inactif.', v_fee.name
      USING ERRCODE = '22023';
  END IF;

  -- E. Verrou Transactionnel Extended 64-bit Déterministe pour Concurrence Haute
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'finance-fee:' || v_caller_school_id::text || ':' || p_fee_id::text,
      0
    )
  );

  -- Validation tarif classe vs p_class_ids
  IF v_clean_scope = 'classes' AND v_fee.class_id IS NOT NULL THEN
    IF NOT (v_class_ids_dedup = ARRAY[v_fee.class_id]) THEN
      RAISE EXCEPTION 'REJET : Ce tarif est restreint à une classe spécifique.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- F. Traitement des Candidats & Contrôle de Limite (Max 2 000 Élèves)
  FOR v_cand IN
    SELECT
      st.id AS student_id,
      pr.first_name,
      pr.last_name,
      cl.id AS class_id,
      se.id AS enrollment_id,
      se.status AS enrollment_status,
      st.school_id AS student_school_id,
      pr.is_active AS profile_active
    FROM (
      SELECT DISTINCT s_id
      FROM (
        SELECT se_in.student_id AS s_id
        FROM public.student_enrollments se_in
        WHERE se_in.school_id = v_caller_school_id
          AND se_in.academic_year_id = v_fee.academic_year_id
          AND (
            (v_clean_scope = 'fee_target' AND (v_fee.class_id IS NULL OR se_in.class_id = v_fee.class_id)) OR
            (v_clean_scope = 'classes' AND (v_fee.class_id IS NULL OR se_in.class_id = v_fee.class_id) AND se_in.class_id = ANY(v_class_ids_dedup)) OR
            (v_clean_scope = 'students' AND se_in.student_id = ANY(v_student_ids_dedup))
          )
        UNION
        SELECT unnest(v_student_ids_dedup) AS s_id
        WHERE v_clean_scope = 'students' AND v_student_ids_dedup IS NOT NULL
      ) req
    ) c_list
    JOIN public.students st ON st.id = c_list.s_id
    LEFT JOIN public.profiles pr ON pr.id = st.profile_id
    LEFT JOIN public.student_enrollments se ON se.student_id = st.id
      AND se.school_id = v_caller_school_id
      AND se.academic_year_id = v_fee.academic_year_id
      AND se.status = 'active'
    LEFT JOIN public.classes cl ON cl.id = se.class_id
    ORDER BY st.id ASC
  LOOP
    v_selected_count := v_selected_count + 1;

    IF v_selected_count > 2000 THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : La sélection dépasse la limite maximale autorisée de 2 000 élèves par traitement groupé.'
        USING ERRCODE = '22023';
    END IF;

    v_is_eligible := TRUE;
    v_reason_code := NULL;
    v_reason_label := NULL;

    IF v_cand.student_school_id <> v_caller_school_id THEN
      v_is_eligible := FALSE;
      v_reason_code := 'cross_school';
      v_reason_label := 'Élève rattaché à un autre établissement';
    ELSIF v_cand.enrollment_id IS NULL OR v_cand.enrollment_status <> 'active' THEN
      v_is_eligible := FALSE;
      v_reason_code := 'inactive_enrollment';
      v_reason_label := 'Aucune inscription active pour cette année scolaire';
    ELSIF v_cand.profile_active IS NOT TRUE THEN
      v_is_eligible := FALSE;
      v_reason_code := 'inactive_profile';
      v_reason_label := 'Compte élève inactif';
    ELSIF v_fee.class_id IS NOT NULL AND v_cand.class_id <> v_fee.class_id THEN
      v_is_eligible := FALSE;
      v_reason_code := 'wrong_class';
      v_reason_label := 'Élève d’une autre classe';
    END IF;

    IF NOT v_is_eligible THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_students := v_skipped_students || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'student_id', v_cand.student_id,
          'reason_code', v_reason_code,
          'reason_label', v_reason_label
        )
      );
      CONTINUE;
    END IF;

    v_student_idempotency_key := 'bulk:' || v_clean_batch_key || ':' || p_fee_id::text || ':' || v_cand.student_id::text;

    v_canonical_str := pg_catalog.concat_ws('|',
      v_cand.student_id::text,
      v_fee.academic_year_id::text,
      CURRENT_DATE::text,
      v_fee.due_date::text,
      v_fee.currency,
      v_fee.amount::text,
      p_fee_id::text,
      v_clean_batch_key
    );
    v_fingerprint := pg_catalog.md5(v_canonical_str);

    -- G. Rejeu Idempotent par Clé Dérivée
    SELECT id, status, total_amount
    INTO v_existing_inv
    FROM public.student_invoices
    WHERE school_id = v_caller_school_id
      AND idempotency_key = v_student_idempotency_key;

    IF v_existing_inv.id IS NOT NULL THEN
      v_existing_count := v_existing_count + 1;
      v_existing_invoices := v_existing_invoices || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'invoice_id', v_existing_inv.id,
          'invoice_number', NULL,
          'student_id', v_cand.student_id,
          'amount', v_existing_inv.total_amount
        )
      );
      CONTINUE;
    END IF;

    -- H. Contrôle Métier Anti-Doublon (Facture non voided existante avec ce tarif)
    SELECT COUNT(*)
    INTO v_existing_fee_inv_count
    FROM public.student_invoices inv
    JOIN public.student_invoice_items item ON item.invoice_id = inv.id
    WHERE inv.school_id = v_caller_school_id
      AND inv.academic_year_id = v_fee.academic_year_id
      AND inv.student_id = v_cand.student_id
      AND inv.status IN ('draft', 'issued', 'partially_paid', 'paid')
      AND item.fee_id = p_fee_id;

    IF v_existing_fee_inv_count > 0 THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_students := v_skipped_students || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'student_id', v_cand.student_id,
          'reason_code', 'already_invoiced',
          'reason_label', 'Élève déjà facturé pour ce tarif'
        )
      );
      CONTINUE;
    END IF;

    -- I. Attribution de Numéro Provisoire Draft (SANS incrémenter le compteur officiel INV)
    SELECT COALESCE(pg_catalog.max(sequence_number), 0) + 1
    INTO v_inv_seq
    FROM public.student_invoices
    WHERE school_id = v_caller_school_id
      AND academic_year_id = v_fee.academic_year_id;

    v_inv_num := 'DRAFT-' || v_inv_seq::text || '-' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 8);

    INSERT INTO public.student_invoices (
      school_id,
      academic_year_id,
      student_id,
      enrollment_id,
      class_id,
      invoice_number,
      sequence_number,
      issue_date,
      due_date,
      currency,
      total_amount,
      paid_amount,
      status,
      created_by,
      idempotency_key,
      request_fingerprint,
      notes
    ) VALUES (
      v_caller_school_id,
      v_fee.academic_year_id,
      v_cand.student_id,
      v_cand.enrollment_id,
      v_cand.class_id,
      v_inv_num,
      v_inv_seq,
      CURRENT_DATE,
      v_fee.due_date,
      v_fee.currency,
      v_fee.amount,
      0.00,
      'draft',
      v_caller_id,
      v_student_idempotency_key,
      v_fingerprint,
      'Facture brouillon groupée - ' || v_fee.name
    )
    RETURNING id INTO v_new_invoice_id;

    INSERT INTO public.student_invoice_items (
      invoice_id,
      school_id,
      academic_year_id,
      student_id,
      currency,
      fee_id,
      fee_name,
      fee_type,
      unit_price,
      quantity,
      total_price
    ) VALUES (
      v_new_invoice_id,
      v_caller_school_id,
      v_fee.academic_year_id,
      v_cand.student_id,
      v_fee.currency,
      p_fee_id,
      v_fee.name,
      v_fee.fee_type,
      v_fee.amount,
      1,
      v_fee.amount
    );

    v_created_count := v_created_count + 1;
    v_created_invoices := v_created_invoices || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'invoice_id', v_new_invoice_id,
        'invoice_number', NULL,
        'student_id', v_cand.student_id,
        'amount', v_fee.amount
      )
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'batch_key', v_clean_batch_key,
    'fee_title', v_fee.name,
    'currency', v_fee.currency,
    'summary', pg_catalog.jsonb_build_object(
      'selected', v_selected_count,
      'created', v_created_count,
      'existing', v_existing_count,
      'skipped', v_skipped_count
    ),
    'created_invoices', v_created_invoices,
    'existing_invoices', v_existing_invoices,
    'skipped_students', v_skipped_students
  );
END;
$$;

ALTER FUNCTION public.create_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[], TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[], TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_bulk_student_invoice_drafts(UUID, TEXT, UUID[], UUID[], TEXT) TO authenticated;

--------------------------------------------------------------------------------
-- 3. DURCISSEMENT DE LA RPC INDIVIDUELLE : CREATE_DRAFT_STUDENT_INVOICE
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_draft_student_invoice(
  p_student_id UUID,
  p_academic_year_id UUID,
  p_due_date DATE,
  p_currency TEXT,
  p_items JSONB,
  p_idempotency_key TEXT,
  p_issue_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_caller_role TEXT;

  v_clean_idempotency_key TEXT;
  v_clean_notes TEXT;
  v_fingerprint TEXT;
  v_canonical_str TEXT;

  v_existing_inv RECORD;
  v_enrollment_id UUID;
  v_class_id UUID;

  v_item RECORD;
  v_item_fee_id UUID;
  v_item_fee_name TEXT;
  v_item_fee_type TEXT;
  v_item_unit_price NUMERIC(14, 2);
  v_item_quantity INTEGER;
  v_item_total_price NUMERIC(14, 2);

  v_catalog_fee RECORD;
  v_calculated_total NUMERIC(14, 2) := 0.00;
  v_item_count INTEGER := 0;

  v_inv_seq INTEGER;
  v_inv_num TEXT;
  v_invoice_id UUID;

  v_fee_ids_seen UUID[] := ARRAY[]::UUID[];
  v_actual_issue_date DATE;

  v_validated_items JSONB := '[]'::jsonb;
  v_val_item RECORD;
  v_existing_fee_inv_count INTEGER;
  v_sorted_fee_ids UUID[];
  v_fid UUID;
BEGIN
  -- A. Authentification & Droits Staff Financier
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role
  INTO v_caller_school_id, v_caller_role
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif d’un établissement actif peut créer une facture.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Validation Stricte de la Clé d'Idempotence (Obligatoire)
  v_clean_idempotency_key := pg_catalog.btrim(COALESCE(p_idempotency_key, ''));
  IF v_clean_idempotency_key = '' OR pg_catalog.length(v_clean_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : La clé d''idempotence est obligatoire (non vide, max 128 caractères).'
      USING ERRCODE = '22023';
  END IF;

  -- C. Validation des Notes Optionnelles
  v_clean_notes := pg_catalog.btrim(COALESCE(p_notes, ''));
  IF v_clean_notes = '' THEN
    v_clean_notes := NULL;
  ELSIF pg_catalog.length(v_clean_notes) > 500 THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Les notes complémentaires ne peuvent dépasser 500 caractères.'
      USING ERRCODE = '22023';
  END IF;

  -- D. Validation de l'Année Scolaire
  IF NOT EXISTS (
    SELECT 1 FROM public.academic_years
    WHERE id = p_academic_year_id AND school_id = v_caller_school_id
  ) THEN
    RAISE EXCEPTION 'REJET : L’année scolaire spécifiée est introuvable ou n’appartient pas à votre établissement.'
      USING ERRCODE = '22023';
  END IF;

  -- E. Validation de l'Inscription Active
  SELECT se.id, se.class_id
  INTO v_enrollment_id, v_class_id
  FROM public.student_enrollments se
  JOIN public.students st ON st.id = se.student_id AND st.school_id = se.school_id
  WHERE se.student_id = p_student_id
    AND se.academic_year_id = p_academic_year_id
    AND se.school_id = v_caller_school_id
    AND se.status = 'active';

  IF v_enrollment_id IS NULL THEN
    RAISE EXCEPTION 'REJET : L’élève spécifié ne possède aucune inscription active pour cette année scolaire dans votre établissement.'
      USING ERRCODE = '22023';
  END IF;

  -- F. Validation de la Devise et des Dates
  IF p_currency NOT IN ('USD', 'CDF') THEN
    RAISE EXCEPTION 'REJET : Devise non supportée (%). Seules les devises USD et CDF sont autorisées.', p_currency
      USING ERRCODE = '22023';
  END IF;

  v_actual_issue_date := COALESCE(p_issue_date, CURRENT_DATE);

  IF v_actual_issue_date < '2000-01-01'::DATE OR v_actual_issue_date > (CURRENT_DATE + INTERVAL '30 days') THEN
    RAISE EXCEPTION 'REJET : Date d’émission hors plage autorisée (%).', v_actual_issue_date
      USING ERRCODE = '22023';
  END IF;

  IF p_due_date IS NOT NULL AND p_due_date < v_actual_issue_date THEN
    RAISE EXCEPTION 'REJET : La date d’échéance (%) ne peut être antérieure à la date d’émission (%).',
      p_due_date, v_actual_issue_date
      USING ERRCODE = '22023';
  END IF;

  IF p_due_date IS NOT NULL AND p_due_date > (CURRENT_DATE + INTERVAL '5 years') THEN
    RAISE EXCEPTION 'REJET : Date d’échéance excessivement lointaine (%).', p_due_date
      USING ERRCODE = '22023';
  END IF;

  -- G. Validation Stricte des Lignes de Facture (JSONB)
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'REJET : Une facture doit comporter au moins une ligne de frais valide.'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'REJET : Le nombre maximum de lignes par facture est limité à 50.'
      USING ERRCODE = '22023';
  END IF;

  -- Extraction et Tri Déterministe des fee_id pour Verrouillage Sans Deadlock
  SELECT pg_catalog.array_agg(DISTINCT fid ORDER BY fid ASC)
  INTO v_sorted_fee_ids
  FROM (
    SELECT (item_obj->>'fee_id')::UUID AS fid
    FROM pg_catalog.jsonb_array_elements(p_items) AS item_obj
    WHERE (item_obj->>'fee_id') IS NOT NULL AND (item_obj->>'fee_id') <> ''
  ) sub;

  IF v_sorted_fee_ids IS NOT NULL AND pg_catalog.cardinality(v_sorted_fee_ids) > 0 THEN
    FOREACH v_fid IN ARRAY v_sorted_fee_ids LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'finance-fee:' || v_caller_school_id::text || ':' || v_fid::text,
          0
        )
      );
    END LOOP;
  END IF;

  FOR v_item IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_items) AS (
    fee_id UUID,
    fee_name TEXT,
    fee_type TEXT,
    unit_price NUMERIC,
    quantity INTEGER
  ) LOOP
    v_item_count := v_item_count + 1;
    v_item_fee_id := v_item.fee_id;
    v_item_quantity := COALESCE(v_item.quantity, 1);

    IF v_item_quantity <= 0 OR v_item_quantity > 1000 THEN
      RAISE EXCEPTION 'REJET : Ligne % : La quantité doit être comprise entre 1 et 1000 (reçu: %).', v_item_count, v_item_quantity
        USING ERRCODE = '22023';
    END IF;

    IF v_item_fee_id IS NOT NULL THEN
      IF v_item_fee_id = ANY(v_fee_ids_seen) THEN
        RAISE EXCEPTION 'REJET : Le frais de scolarité catalogue (%) est présent en double dans la même facture.', v_item_fee_id
          USING ERRCODE = '23505';
      END IF;
      v_fee_ids_seen := pg_catalog.array_append(v_fee_ids_seen, v_item_fee_id);

      SELECT id, name, fee_type, amount, currency, class_id, is_active
      INTO v_catalog_fee
      FROM public.school_fees
      WHERE id = v_item_fee_id
        AND school_id = v_caller_school_id
        AND academic_year_id = p_academic_year_id
      FOR SHARE;

      IF v_catalog_fee.id IS NULL THEN
        RAISE EXCEPTION 'REJET : Ligne % : Le frais catalogue (%) est introuvable ou n’appartient pas à cette année scolaire.', v_item_count, v_item_fee_id
          USING ERRCODE = '22023';
      END IF;

      IF NOT v_catalog_fee.is_active THEN
        RAISE EXCEPTION 'REJET : Ligne % : Le frais catalogue "%" est inactif.', v_item_count, v_catalog_fee.name
          USING ERRCODE = '22023';
      END IF;

      IF v_catalog_fee.currency <> p_currency THEN
        RAISE EXCEPTION 'REJET : Ligne % : La devise du frais catalogue (%) ne correspond pas à la devise de la facture (%).',
          v_item_count, v_catalog_fee.currency, p_currency
          USING ERRCODE = '22023';
      END IF;

      IF v_catalog_fee.class_id IS NOT NULL AND v_catalog_fee.class_id <> v_class_id THEN
        RAISE EXCEPTION 'REJET : Ligne % : Le frais catalogue "%" est restreint à une autre classe.', v_item_count, v_catalog_fee.name
          USING ERRCODE = '22023';
      END IF;

      -- Contrôle Anti-Doublon
      SELECT COUNT(*)
      INTO v_existing_fee_inv_count
      FROM public.student_invoices inv
      JOIN public.student_invoice_items item ON item.invoice_id = inv.id
      WHERE inv.school_id = v_caller_school_id
        AND inv.academic_year_id = p_academic_year_id
        AND inv.student_id = p_student_id
        AND inv.status IN ('draft', 'issued', 'partially_paid', 'paid')
        AND item.fee_id = v_item_fee_id
        AND inv.idempotency_key <> v_clean_idempotency_key;

      IF v_existing_fee_inv_count > 0 THEN
        RAISE EXCEPTION 'REJET : Le tarif "%" a déjà été facturé à cet élève pour cette année scolaire (facture existante).', v_catalog_fee.name
          USING ERRCODE = '23505';
      END IF;

      v_item_unit_price := v_catalog_fee.amount;
      v_item_fee_name := v_catalog_fee.name;
      v_item_fee_type := v_catalog_fee.fee_type;
    ELSE
      v_item_fee_name := pg_catalog.btrim(COALESCE(v_item.fee_name, ''));
      v_item_fee_type := pg_catalog.btrim(COALESCE(v_item.fee_type, ''));
      v_item_unit_price := v_item.unit_price;

      IF pg_catalog.length(v_item_fee_name) < 1 OR pg_catalog.length(v_item_fee_name) > 150 THEN
        RAISE EXCEPTION 'REJET : Ligne % : L’intitulé du frais personnalisé doit comporter entre 1 et 150 caractères.', v_item_count
          USING ERRCODE = '22023';
      END IF;

      IF v_item_fee_type NOT IN ('inscription', 'minerval', 'transport', 'cantine', 'uniforme', 'activites', 'frais_etat', 'autre') THEN
        RAISE EXCEPTION 'REJET : Ligne % : Type de frais personnalisé invalide (%).', v_item_count, v_item_fee_type
          USING ERRCODE = '22023';
      END IF;

      IF v_item_unit_price IS NULL OR v_item_unit_price <= 0 OR v_item_unit_price > 100000000.00 THEN
        RAISE EXCEPTION 'REJET : Ligne % : Le prix unitaire personnalisé doit être strictement positif et valide.', v_item_count
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_item_total_price := v_item_unit_price * v_item_quantity;
    v_calculated_total := v_calculated_total + v_item_total_price;

    v_validated_items := v_validated_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'fee_id', v_item_fee_id,
        'fee_name', v_item_fee_name,
        'fee_type', v_item_fee_type,
        'unit_price', v_item_unit_price,
        'quantity', v_item_quantity,
        'total_price', v_item_total_price
      )
    );
  END LOOP;

  IF v_calculated_total <= 0 THEN
    RAISE EXCEPTION 'REJET : Le montant total calculé de la facture doit être strictement supérieur à 0.'
      USING ERRCODE = '22023';
  END IF;

  v_canonical_str := pg_catalog.concat_ws('|',
    p_student_id::text,
    p_academic_year_id::text,
    v_actual_issue_date::text,
    COALESCE(p_due_date::text, 'NULL'),
    p_currency,
    v_calculated_total::text,
    v_validated_items::text,
    COALESCE(v_clean_notes, 'NULL')
  );
  v_fingerprint := pg_catalog.md5(v_canonical_str);

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'finance-idemp:' || v_caller_school_id::text || ':' || v_clean_idempotency_key,
      0
    )
  );

  SELECT id, invoice_number, sequence_number, status, currency, total_amount, due_date, created_at, request_fingerprint
  INTO v_existing_inv
  FROM public.student_invoices
  WHERE school_id = v_caller_school_id
    AND idempotency_key = v_clean_idempotency_key;

  IF v_existing_inv.id IS NOT NULL THEN
    IF v_existing_inv.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'REJET IDEMPOTENCE : La clé d''idempotence "%" a déjà été utilisée avec des paramètres opérationnels différents.', v_clean_idempotency_key
        USING ERRCODE = '23505';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'is_idempotent_replay', true,
      'invoice_id', v_existing_inv.id,
      'invoice_number', NULL,
      'sequence_number', v_existing_inv.sequence_number,
      'status', v_existing_inv.status,
      'currency', v_existing_inv.currency,
      'total_amount', v_existing_inv.total_amount,
      'due_date', v_existing_inv.due_date,
      'created_at', v_existing_inv.created_at
    );
  END IF;

  -- Attribution de Numéro Provisoire Draft
  SELECT COALESCE(pg_catalog.max(sequence_number), 0) + 1
  INTO v_inv_seq
  FROM public.student_invoices
  WHERE school_id = v_caller_school_id
    AND academic_year_id = p_academic_year_id;

  v_inv_num := 'DRAFT-' || v_inv_seq::text || '-' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 8);

  INSERT INTO public.student_invoices (
    school_id,
    academic_year_id,
    student_id,
    enrollment_id,
    class_id,
    invoice_number,
    sequence_number,
    issue_date,
    due_date,
    currency,
    total_amount,
    paid_amount,
    status,
    created_by,
    idempotency_key,
    request_fingerprint,
    notes
  ) VALUES (
    v_caller_school_id,
    p_academic_year_id,
    p_student_id,
    v_enrollment_id,
    v_class_id,
    v_inv_num,
    v_inv_seq,
    v_actual_issue_date,
    p_due_date,
    p_currency,
    v_calculated_total,
    0.00,
    'draft',
    v_caller_id,
    v_clean_idempotency_key,
    v_fingerprint,
    v_clean_notes
  )
  RETURNING id INTO v_invoice_id;

  FOR v_val_item IN SELECT * FROM pg_catalog.jsonb_to_recordset(v_validated_items) AS (
    fee_id UUID,
    fee_name TEXT,
    fee_type TEXT,
    unit_price NUMERIC(14, 2),
    quantity INTEGER,
    total_price NUMERIC(14, 2)
  ) LOOP
    INSERT INTO public.student_invoice_items (
      invoice_id,
      school_id,
      academic_year_id,
      student_id,
      currency,
      fee_id,
      fee_name,
      fee_type,
      unit_price,
      quantity,
      total_price
    ) VALUES (
      v_invoice_id,
      v_caller_school_id,
      p_academic_year_id,
      p_student_id,
      p_currency,
      v_val_item.fee_id,
      v_val_item.fee_name,
      v_val_item.fee_type,
      v_val_item.unit_price,
      v_val_item.quantity,
      v_val_item.total_price
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'is_idempotent_replay', false,
    'invoice_id', v_invoice_id,
    'invoice_number', NULL,
    'sequence_number', v_inv_seq,
    'status', 'draft',
    'currency', p_currency,
    'total_amount', v_calculated_total,
    'due_date', p_due_date,
    'created_at', pg_catalog.now()
  );
END;
$$;

ALTER FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, TEXT, DATE, TEXT) TO service_role;

--------------------------------------------------------------------------------
-- 4. ALIGNEMENT DE L'ÉMISSION : ISSUE_STUDENT_INVOICE (Attribution du Numéro Officiel INV)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_student_invoice(
  p_invoice_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_school_id UUID;
  v_invoice RECORD;
  v_item_count INTEGER;
  v_sum_items NUMERIC(14, 2);
  v_official_seq INTEGER;
  v_official_num TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id
  INTO v_caller_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur ou agent financier actif peut émettre une facture.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.student_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'REJET : Facture introuvable.' USING ERRCODE = '22023';
  END IF;

  IF v_invoice.school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : Cette facture n’appartient pas à votre établissement.' USING ERRCODE = '42501';
  END IF;

  IF v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'REJET : Seule une facture au statut draft peut être émise (statut actuel : %).', v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(total_price), 0.00)
  INTO v_item_count, v_sum_items
  FROM public.student_invoice_items
  WHERE invoice_id = p_invoice_id;

  IF v_item_count < 1 THEN
    RAISE EXCEPTION 'REJET COMPTABLE : Impossible d’émettre une facture sans aucune ligne de frais.'
      USING ERRCODE = '22023';
  END IF;

  IF v_sum_items <= 0.00 THEN
    RAISE EXCEPTION 'REJET COMPTABLE : Le montant total de la facture doit être strictement supérieur à 0.'
      USING ERRCODE = '22023';
  END IF;

  -- Attribution exclusive du numéro officiel INV à l'émission
  IF v_invoice.invoice_number LIKE 'DRAFT-%' OR v_invoice.invoice_number IS NULL THEN
    SELECT sequence_number, formatted_number
    INTO v_official_seq, v_official_num
    FROM public.get_next_finance_counter(v_caller_school_id, v_invoice.academic_year_id, 'invoice');
  ELSE
    v_official_num := v_invoice.invoice_number;
  END IF;

  UPDATE public.student_invoices
  SET status = 'issued',
      invoice_number = v_official_num,
      total_amount = v_sum_items,
      updated_at = pg_catalog.now()
  WHERE id = p_invoice_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'invoice_number', v_official_num,
    'status', 'issued',
    'total_amount', v_sum_items,
    'currency', v_invoice.currency,
    'issue_date', v_invoice.issue_date,
    'due_date', v_invoice.due_date,
    'updated_at', pg_catalog.now()
  );
END;
$$;

ALTER FUNCTION public.issue_student_invoice(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_student_invoice(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_student_invoice(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_student_invoice(UUID) TO authenticated;
