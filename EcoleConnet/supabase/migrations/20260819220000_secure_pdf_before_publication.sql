-- ============================================================================
-- Migration : Sécurisation de la Préparation PDF et Publication Stricte des Bulletins (Phase 2F.3B)
-- Fichier : supabase/migrations/20260819220000_secure_pdf_before_publication.sql
-- ============================================================================
--
-- Note d'architecture Edge Function / Sécurité Cryptographique :
-- ----------------------------------------------------------------------------
-- L'empreinte numérique SHA-256 (pdf_checksum) DOIT IMPÉRATIVEMENT être calculée
-- directement par l'Edge Function Deno à partir du tampon d'octets exacts (Uint8Array)
-- du document PDF officiel avant et lors de son téléversement dans le bucket privé.
-- Formule : crypto.subtle.digest('SHA-256', pdfBytes) -> chaîne hexadécimale de 64 caractères.
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. TRIGGER D'IMMUTABILITÉ ET DE MACHINE D'ÉTATS RENFORCÉ
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_report_card_state_machine()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_target_batch_id UUID;
  v_transition_ctx TEXT := current_setting('app.report_card_transition_ctx', true);
  v_pdf_service_ctx TEXT := current_setting('app.report_card_pdf_service_ctx', true);
  v_target_report_card_id UUID;
BEGIN
  -- 1. Table report_card_batches
  IF TG_TABLE_NAME = 'report_card_batches' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.status IN ('submitted_by_homeroom', 'validated_by_admin', 'published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Un lot en statut "%" ne peut être supprimé.', OLD.status;
      END IF;
      RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF OLD.school_id IS DISTINCT FROM NEW.school_id OR
         OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id OR
         OLD.class_id IS DISTINCT FROM NEW.class_id OR
         OLD.period_id IS DISTINCT FROM NEW.period_id OR
         OLD.revision_number IS DISTINCT FROM NEW.revision_number THEN
        RAISE EXCEPTION 'Intégrité : Les identifiants structurels d’un lot de bulletins sont immuables.';
      END IF;

      -- Validation des transitions d'états
      IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- draft -> submitted_by_homeroom
        IF OLD.status = 'draft' AND NEW.status = 'submitted_by_homeroom' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_submit_transition' THEN
            RAISE EXCEPTION 'Transition interdite : La soumission doit s’effectuer via la RPC officielle submit_report_card_batch.';
          END IF;
        -- submitted_by_homeroom -> validated_by_admin
        ELSIF OLD.status = 'submitted_by_homeroom' AND NEW.status = 'validated_by_admin' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_validate_transition' THEN
            RAISE EXCEPTION 'Transition interdite : La validation doit s’effectuer via la RPC officielle validate_report_card_batch.';
          END IF;
        -- validated_by_admin -> published
        ELSIF OLD.status = 'validated_by_admin' AND NEW.status = 'published' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_publish_transition' THEN
            RAISE EXCEPTION 'Transition interdite : La publication doit s’effectuer via la RPC officielle publish_report_card_batch.';
          END IF;
        -- published -> superseded
        ELSIF OLD.status = 'published' AND NEW.status = 'superseded' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_publish_transition' THEN
            RAISE EXCEPTION 'Transition interdite : Le passage en statut archivé est réservé à la publication d’une révision ultérieure.';
          END IF;
        -- (submitted_by_homeroom | validated_by_admin) -> draft
        ELSIF OLD.status IN ('submitted_by_homeroom', 'validated_by_admin') AND NEW.status = 'draft' THEN
          IF v_transition_ctx IS DISTINCT FROM 'authorized_return_to_draft_transition' THEN
            RAISE EXCEPTION 'Transition interdite : Le renvoi en brouillon doit s’effectuer via la RPC officielle return_report_card_batch_to_draft.';
          END IF;
        ELSE
          RAISE EXCEPTION 'Transition d’état illégale : Impossible de passer de "%" à "%".', OLD.status, NEW.status;
        END IF;
      END IF;

      -- Immutabilité des métadonnées du lot après publication
      IF OLD.status IN ('published', 'superseded') AND NEW.status IN ('published', 'superseded') THEN
        IF (OLD.total_students_count IS DISTINCT FROM NEW.total_students_count OR
            OLD.complete_students_count IS DISTINCT FROM NEW.complete_students_count OR
            OLD.incomplete_students_count IS DISTINCT FROM NEW.incomplete_students_count OR
            OLD.published_at IS DISTINCT FROM NEW.published_at OR
            OLD.published_by IS DISTINCT FROM NEW.published_by) THEN
          RAISE EXCEPTION 'Immutabilité : Les données d’un lot publié ou archivé sont strictement non modifiables.';
        END IF;
      END IF;

      RETURN NEW;
    END IF;
  END IF;

  -- 2. Table period_report_cards
  IF TG_TABLE_NAME = 'period_report_cards' THEN
    IF TG_OP = 'INSERT' THEN
      v_target_batch_id := NEW.batch_id;
    ELSE
      v_target_batch_id := OLD.batch_id;
    END IF;

    SELECT status INTO v_batch FROM public.report_card_batches WHERE id = v_target_batch_id;

    IF TG_OP = 'INSERT' THEN
      IF v_batch.status IN ('submitted_by_homeroom', 'validated_by_admin', 'published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Impossible d’insérer un nouveau bulletin dans un lot en statut "%".', v_batch.status;
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      IF v_batch.status IN ('submitted_by_homeroom', 'validated_by_admin', 'published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Impossible de supprimer un bulletin d’un lot en statut "%".', v_batch.status;
      END IF;
      RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF OLD.batch_id IS DISTINCT FROM NEW.batch_id THEN
        RAISE EXCEPTION 'Sécurité : Le rattachement au lot (batch_id) d’un bulletin ne peut être modifié.';
      END IF;

      -- Phase A : Lot Publié ou Archivé (Immutabilité absolue de TOUS les champs, y compris PDF)
      IF v_batch.status IN ('published', 'superseded') THEN
        IF (OLD.pdf_storage_path IS DISTINCT FROM NEW.pdf_storage_path OR
            OLD.pdf_generated_at IS DISTINCT FROM NEW.pdf_generated_at OR
            OLD.pdf_checksum IS DISTINCT FROM NEW.pdf_checksum OR
            OLD.pdf_version IS DISTINCT FROM NEW.pdf_version) THEN
          RAISE EXCEPTION 'Immutabilité : Le document PDF d’un bulletin publié est strictement figé. Créez une nouvelle révision pour toute modification.';
        END IF;

        IF (OLD.school_id IS DISTINCT FROM NEW.school_id OR
            OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id OR
            OLD.class_id IS DISTINCT FROM NEW.class_id OR
            OLD.period_id IS DISTINCT FROM NEW.period_id OR
            OLD.student_id IS DISTINCT FROM NEW.student_id OR
            OLD.enrollment_id IS DISTINCT FROM NEW.enrollment_id OR
            OLD.overall_percentage IS DISTINCT FROM NEW.overall_percentage OR
            OLD.rank IS DISTINCT FROM NEW.rank OR
            OLD.total_students_ranked IS DISTINCT FROM NEW.total_students_ranked OR
            OLD.rank_type IS DISTINCT FROM NEW.rank_type OR
            OLD.is_incomplete IS DISTINCT FROM NEW.is_incomplete OR
            OLD.completed_subjects_count IS DISTINCT FROM NEW.completed_subjects_count OR
            OLD.pending_subjects_count IS DISTINCT FROM NEW.pending_subjects_count OR
            OLD.total_subject_coefficients IS DISTINCT FROM NEW.total_subject_coefficients OR
            OLD.calculation_snapshot IS DISTINCT FROM NEW.calculation_snapshot OR
            OLD.identity_snapshot IS DISTINCT FROM NEW.identity_snapshot OR
            OLD.signature_snapshot IS DISTINCT FROM NEW.signature_snapshot OR
            OLD.homeroom_teacher_remarks IS DISTINCT FROM NEW.homeroom_teacher_remarks OR
            OLD.conduct_grade IS DISTINCT FROM NEW.conduct_grade OR
            OLD.principal_remarks IS DISTINCT FROM NEW.principal_remarks) THEN
          RAISE EXCEPTION 'Immutabilité : Les résultats, rangs et appréciations d’un bulletin publié sont figés.';
        END IF;
      END IF;

      -- Phase B : Lot Validé par la Direction ou Renvoi en Brouillon (Données figées dès validated_by_admin)
      IF v_batch.status = 'validated_by_admin' OR v_pdf_service_ctx = 'authorized_pdf_invalidation' THEN
        -- Modification des métadonnées PDF autorisée uniquement via contexte habilité
        IF (OLD.pdf_storage_path IS DISTINCT FROM NEW.pdf_storage_path OR
            OLD.pdf_generated_at IS DISTINCT FROM NEW.pdf_generated_at OR
            OLD.pdf_checksum IS DISTINCT FROM NEW.pdf_checksum OR
            OLD.pdf_version IS DISTINCT FROM NEW.pdf_version) THEN
          IF v_pdf_service_ctx NOT IN ('authorized_pdf_update', 'authorized_pdf_invalidation') THEN
            RAISE EXCEPTION 'Sécurité : L’enregistrement ou l’invalidation des métadonnées PDF requiert l’exécution du service serveur habilité.';
          END IF;
        END IF;

        -- Interdiction absolue de modifier les données académiques et snapshots dès validated_by_admin
        IF v_pdf_service_ctx IS DISTINCT FROM 'authorized_pdf_invalidation' AND v_batch.status = 'validated_by_admin' THEN
          IF (OLD.school_id IS DISTINCT FROM NEW.school_id OR
              OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id OR
              OLD.class_id IS DISTINCT FROM NEW.class_id OR
              OLD.period_id IS DISTINCT FROM NEW.period_id OR
              OLD.student_id IS DISTINCT FROM NEW.student_id OR
              OLD.enrollment_id IS DISTINCT FROM NEW.enrollment_id OR
              OLD.overall_percentage IS DISTINCT FROM NEW.overall_percentage OR
              OLD.rank IS DISTINCT FROM NEW.rank OR
              OLD.total_students_ranked IS DISTINCT FROM NEW.total_students_ranked OR
              OLD.rank_type IS DISTINCT FROM NEW.rank_type OR
              OLD.is_incomplete IS DISTINCT FROM NEW.is_incomplete OR
              OLD.completed_subjects_count IS DISTINCT FROM NEW.completed_subjects_count OR
              OLD.pending_subjects_count IS DISTINCT FROM NEW.pending_subjects_count OR
              OLD.total_subject_coefficients IS DISTINCT FROM NEW.total_subject_coefficients OR
              OLD.calculation_snapshot IS DISTINCT FROM NEW.calculation_snapshot OR
              OLD.identity_snapshot IS DISTINCT FROM NEW.identity_snapshot OR
              OLD.signature_snapshot IS DISTINCT FROM NEW.signature_snapshot OR
              OLD.homeroom_teacher_remarks IS DISTINCT FROM NEW.homeroom_teacher_remarks OR
              OLD.conduct_grade IS DISTINCT FROM NEW.conduct_grade OR
              OLD.principal_remarks IS DISTINCT FROM NEW.principal_remarks) THEN
            RAISE EXCEPTION 'Immutabilité : Les résultats, calculs, rangs et appréciations d’un lot validé par la direction sont figés. Un renvoi en brouillon est requis pour toute modification.';
          END IF;
        END IF;
      END IF;

      RETURN NEW;
    END IF;
  END IF;

  -- 3. Table report_card_subject_results
  IF TG_TABLE_NAME = 'report_card_subject_results' THEN
    IF TG_OP = 'INSERT' THEN
      v_target_report_card_id := NEW.report_card_id;
    ELSE
      v_target_report_card_id := OLD.report_card_id;
    END IF;

    SELECT b.status INTO v_batch
    FROM public.period_report_cards rc
    JOIN public.report_card_batches b ON b.id = rc.batch_id
    WHERE rc.id = v_target_report_card_id;

    IF TG_OP = 'INSERT' THEN
      IF v_batch.status IN ('submitted_by_homeroom', 'validated_by_admin', 'published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Impossible d’insérer un résultat de matière dans un bulletin en statut "%".', v_batch.status;
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      IF v_batch.status IN ('submitted_by_homeroom', 'validated_by_admin', 'published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Impossible de supprimer les résultats de matière d’un bulletin en statut "%".', v_batch.status;
      END IF;
      RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF OLD.report_card_id IS DISTINCT FROM NEW.report_card_id THEN
        RAISE EXCEPTION 'Sécurité : Le rattachement au bulletin (report_card_id) ne peut être modifié.';
      END IF;

      IF v_batch.status IN ('validated_by_admin', 'published', 'superseded') THEN
        RAISE EXCEPTION 'Immutabilité : Les résultats par matière d’un bulletin validé ou publié sont figés.';
      END IF;

      RETURN NEW;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- 2. VALIDATION ADMINISTRATIVE : FIXATION DÉFINITIVE DE RANK_TYPE & SNAPSHOTS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_report_card_batch(
  p_batch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_active BOOLEAN;
  v_batch RECORD;
  v_school RECORD;
  v_class RECORD;
  v_period RECORD;
  v_term RECORD;
  v_year RECORD;
  v_homeroom_teacher RECORD;
  v_cards_count INTEGER;
  v_subjects_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seul l’administrateur de l’établissement peut valider un lot de bulletins.';
  END IF;

  -- 1. Lecture préliminaire
  SELECT id, class_id, period_id, school_id, academic_year_id, status INTO v_batch
  FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_role = 'school_admin' AND v_school_id IS DISTINCT FROM v_batch.school_id THEN
    RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
  END IF;

  -- 2. Acquisition uniforme du verrou exclusif
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || v_batch.class_id::text || '_' || v_batch.period_id::text));

  -- 3. Verrouillage FOR UPDATE du lot et revérification du statut
  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_batch.status <> 'submitted_by_homeroom' THEN
    RAISE EXCEPTION 'Ce lot ne peut être validé que s’il est soumis par le titulaire (statut actuel: %).', v_batch.status;
  END IF;

  -- Vérification des métadonnées de l'école
  SELECT name, logo_url, principal_name, director_signature_url, stamp_url, motto, address, phone, email, official_registration_number
  INTO v_school
  FROM public.schools WHERE id = v_batch.school_id;

  IF v_school.principal_name IS NULL OR LENGTH(TRIM(v_school.principal_name)) = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Le nom du chef d’établissement n’est pas configuré dans les paramètres de l’école.';
  END IF;

  IF v_school.director_signature_url IS NULL OR LENGTH(TRIM(v_school.director_signature_url)) = 0 THEN
    RAISE EXCEPTION 'Validation impossible : La signature numérique de la direction n’est pas enregistrée.';
  END IF;

  IF v_school.stamp_url IS NULL OR LENGTH(TRIM(v_school.stamp_url)) = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Le cachet officiel de l’établissement n’est pas enregistré.';
  END IF;

  -- Vérification du titulaire actif (jointure stricte sur profiles.id)
  SELECT id, name, education_cycle, homeroom_teacher_id INTO v_class FROM public.classes WHERE id = v_batch.class_id;

  IF v_class.homeroom_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Validation impossible : Aucun professeur titulaire n’est affecté à cette classe.';
  END IF;

  SELECT t.id, t.profile_id, t.signature_url, p.first_name, p.last_name
  INTO v_homeroom_teacher
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.profile_id = v_class.homeroom_teacher_id
    AND t.school_id = v_batch.school_id
    AND p.school_id = v_batch.school_id
    AND t.account_status = 'active'
    AND t.employment_status = 'active'
    AND p.is_active = true;

  IF v_homeroom_teacher.id IS NULL THEN
    RAISE EXCEPTION 'Validation impossible : Le titulaire de la classe est inactif ou n’appartient pas à cet établissement.';
  END IF;

  IF v_homeroom_teacher.signature_url IS NULL OR LENGTH(TRIM(v_homeroom_teacher.signature_url)) = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Le professeur titulaire (%) n’a pas encore téléversé sa signature numérique.',
      TRIM(COALESCE(v_homeroom_teacher.first_name, '') || ' ' || COALESCE(v_homeroom_teacher.last_name, ''));
  END IF;

  -- Vérifier la présence des bulletins et matières
  SELECT COUNT(*) INTO v_cards_count FROM public.period_report_cards WHERE batch_id = p_batch_id;
  IF v_cards_count = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Le lot ne contient aucun bulletin.';
  END IF;

  SELECT COUNT(*) INTO v_subjects_count
  FROM public.report_card_subject_results s
  JOIN public.period_report_cards rc ON rc.id = s.report_card_id
  WHERE rc.batch_id = p_batch_id;

  IF v_subjects_count = 0 THEN
    RAISE EXCEPTION 'Validation impossible : Aucun résultat de matière n’est rattaché aux bulletins de ce lot.';
  END IF;

  -- Rafraîchir et figer l'identité, les signatures et le rank_type définitif pour chaque bulletin
  SELECT name, starts_on, ends_on, parent_term_id INTO v_period FROM public.school_periods WHERE id = v_batch.period_id;
  SELECT name INTO v_term FROM public.school_terms WHERE id = v_period.parent_term_id;
  SELECT name INTO v_year FROM public.academic_years WHERE id = v_batch.academic_year_id;

  UPDATE public.period_report_cards rc
  SET
    rank_type = CASE WHEN rc.is_incomplete THEN 'provisional' ELSE 'official' END,
    identity_snapshot = jsonb_build_object(
      'student_id', s.id,
      'student_number', s.student_number,
      'student_name', TRIM(COALESCE(p.first_name, s.first_name, '') || ' ' || COALESCE(p.last_name, s.last_name, '')),
      'student_first_name', COALESCE(p.first_name, s.first_name, ''),
      'student_last_name', COALESCE(p.last_name, s.last_name, ''),
      'gender', s.gender,
      'date_of_birth', s.date_of_birth,
      'class_id', v_class.id,
      'class_name', v_class.name,
      'education_cycle', v_class.education_cycle,
      'academic_year_id', v_batch.academic_year_id,
      'academic_year_name', v_year.name,
      'period_id', v_batch.period_id,
      'period_name', v_period.name,
      'period_starts_on', v_period.starts_on,
      'period_ends_on', v_period.ends_on,
      'term_name', v_term.name,
      'school_name', v_school.name,
      'school_address', v_school.address,
      'school_phone', v_school.phone,
      'school_email', v_school.email,
      'logo_url', v_school.logo_url,
      'official_registration_number', v_school.official_registration_number,
      'motto', v_school.motto
    ),
    signature_snapshot = jsonb_build_object(
      'principal_name', v_school.principal_name,
      'director_signature_url', v_school.director_signature_url,
      'stamp_url', v_school.stamp_url,
      'homeroom_teacher_name', TRIM(COALESCE(v_homeroom_teacher.first_name, '') || ' ' || COALESCE(v_homeroom_teacher.last_name, '')),
      'homeroom_teacher_signature_url', v_homeroom_teacher.signature_url,
      'validated_at', now()
    ),
    updated_at = now()
  FROM public.students s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE rc.student_id = s.id AND rc.batch_id = p_batch_id;

  -- Définir le contexte sécurisé de transition
  PERFORM set_config('app.report_card_transition_ctx', 'authorized_validate_transition', true);

  UPDATE public.report_card_batches
  SET
    status = 'validated_by_admin',
    validated_by = v_uid,
    validated_at = now(),
    updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_batch.school_id, v_uid, 'validate_report_card_batch',
    jsonb_build_object('batch_id', p_batch_id, 'class_id', v_batch.class_id, 'period_id', v_batch.period_id)
  );

  RETURN jsonb_build_object('success', true, 'batch_id', p_batch_id, 'status', 'validated_by_admin');
END;
$$;

--------------------------------------------------------------------------------
-- 3. RENVOI EN BROUILLON AVEC INVALIDATION TOTALE DES PDF PRÉPARÉS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.return_report_card_batch_to_draft(
  p_batch_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_active BOOLEAN;
  v_batch RECORD;
  v_clean_reason TEXT;
  v_invalidated_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seule la direction de l’établissement peut renvoyer un lot en brouillon.';
  END IF;

  v_clean_reason := TRIM(COALESCE(p_reason, ''));
  IF LENGTH(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'Le motif de renvoi en brouillon est obligatoire et doit comporter au moins 5 caractères.';
  END IF;

  -- 1. Lecture préliminaire
  SELECT id, class_id, period_id, school_id, status INTO v_batch
  FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_role = 'school_admin' AND v_school_id IS DISTINCT FROM v_batch.school_id THEN
    RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
  END IF;

  -- 2. Acquisition uniforme du verrou exclusif
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || v_batch.class_id::text || '_' || v_batch.period_id::text));

  -- 3. Verrouillage FOR UPDATE du lot et revérification du statut
  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_batch.status NOT IN ('submitted_by_homeroom', 'validated_by_admin') THEN
    RAISE EXCEPTION 'Seul un lot soumis ou validé peut être renvoyé en brouillon (statut actuel: %).', v_batch.status;
  END IF;

  -- Définir les contextes sécurisés pour la transition et l'invalidation PDF
  PERFORM set_config('app.report_card_transition_ctx', 'authorized_return_to_draft_transition', true);
  PERFORM set_config('app.report_card_pdf_service_ctx', 'authorized_pdf_invalidation', true);

  -- 4. Invalidation atomique obligatoire de toutes les métadonnées PDF du lot
  UPDATE public.period_report_cards
  SET
    pdf_storage_path = NULL,
    pdf_checksum = NULL,
    pdf_version = NULL,
    pdf_generated_at = NULL,
    updated_at = now()
  WHERE batch_id = p_batch_id;

  GET DIAGNOSTICS v_invalidated_count = ROW_COUNT;

  -- 5. Basculer le statut du lot en draft
  UPDATE public.report_card_batches
  SET
    status = 'draft',
    returned_to_draft_by = v_uid,
    returned_to_draft_at = now(),
    return_reason = v_clean_reason,
    updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_batch.school_id, v_uid, 'return_report_card_batch_to_draft',
    jsonb_build_object(
      'batch_id', p_batch_id,
      'class_id', v_batch.class_id,
      'period_id', v_batch.period_id,
      'reason', v_clean_reason,
      'invalidated_pdfs_count', v_invalidated_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'status', 'draft',
    'invalidated_pdfs_count', v_invalidated_count
  );
END;
$$;

--------------------------------------------------------------------------------
-- 4. RPC 1 : set_report_card_pdf_metadata (ORDRE STRICT DES VERROUS : BATCH PUIS RC)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.set_report_card_pdf_metadata(UUID, TEXT, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.set_report_card_pdf_metadata(
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
  v_pre_rc RECORD;
  v_rc RECORD;
  v_batch RECORD;
  v_expected_path_prefix TEXT;
  v_expected_full_path TEXT;
  v_storage_obj_exists BOOLEAN;
BEGIN
  -- 1. Vérification stricte que l'appel émane exclusivement du service_role
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès refusé : Seul le service serveur (service_role) est habilité à enregistrer les métadonnées PDF.';
  END IF;

  -- 2. Rejet explicite de toute version nulle ou inférieure à 1
  IF p_version IS NULL OR p_version < 1 THEN
    RAISE EXCEPTION 'Version PDF invalide : Entier supérieur ou égal à 1 requis (reçu: %).', p_version;
  END IF;

  -- 3. Lecture initiale sans verrou pour identifier le batch_id cible
  SELECT id, batch_id
  INTO v_pre_rc
  FROM public.period_report_cards
  WHERE id = p_report_card_id;

  IF v_pre_rc.id IS NULL THEN
    RAISE EXCEPTION 'Bulletin introuvable.';
  END IF;

  -- 4. Verrouillage prioritaire FOR UPDATE du lot (ordonnancement strict anti-deadlock)
  SELECT id, status, validated_at
  INTO v_batch
  FROM public.report_card_batches
  WHERE id = v_pre_rc.batch_id
  FOR UPDATE;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_batch.status <> 'validated_by_admin' THEN
    RAISE EXCEPTION 'Action refusée : Les métadonnées PDF ne peuvent être enregistrées que sur un lot validé par la direction (statut actuel: "%").', v_batch.status;
  END IF;

  -- 5. Verrouillage FOR UPDATE du bulletin et revérification du rattachement
  SELECT id, batch_id, school_id, student_id, pdf_storage_path, pdf_checksum, pdf_version
  INTO v_rc
  FROM public.period_report_cards
  WHERE id = p_report_card_id
  FOR UPDATE;

  IF v_rc.id IS NULL OR v_rc.batch_id IS DISTINCT FROM v_batch.id THEN
    RAISE EXCEPTION 'Incohérence structurelle du rattachement au lot lors de l’acquisition du verrou.';
  END IF;

  -- 6. Validation du format du chemin canonique
  v_expected_path_prefix := v_rc.school_id::text || '/' || v_rc.batch_id::text || '/' || v_rc.student_id::text || '/';
  v_expected_full_path := v_expected_path_prefix || 'report-card-v' || p_version::text || '.pdf';

  IF p_storage_path IS NULL OR
     p_storage_path <> v_expected_full_path OR
     p_storage_path LIKE '%..%' OR
     p_storage_path LIKE '%//%' THEN
    RAISE EXCEPTION 'Chemin de stockage invalide ou non canonique (attendu: "%", reçu: "%").', v_expected_full_path, p_storage_path;
  END IF;

  -- 7. Validation du checksum SHA-256 (exactement 64 caractères hexadécimaux)
  IF p_checksum IS NULL OR p_checksum !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Checksum SHA-256 invalide : Exactement 64 caractères hexadécimaux requis.';
  END IF;

  -- 8. Règle de gestion des versions et d'idempotence
  IF v_rc.pdf_version IS NOT NULL THEN
    IF p_version < v_rc.pdf_version THEN
      RAISE EXCEPTION 'Rétrogradation de version interdite (version existante: %, version reçue: %).', v_rc.pdf_version, p_version;
    ELSIF p_version = v_rc.pdf_version THEN
      IF v_rc.pdf_checksum IS NOT NULL AND LOWER(v_rc.pdf_checksum) <> LOWER(p_checksum) THEN
        RAISE EXCEPTION 'Le contenu du PDF a été modifié pour la même version #%. Une version incrémentée est requise.', p_version;
      END IF;
    END IF;
  END IF;

  -- 9. Contrôle Storage strict : MIME application/pdf et taille non nulle sans cast direct dangereux
  SELECT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'report-card-pdfs'
      AND name = p_storage_path
      AND metadata IS NOT NULL
      AND metadata->>'mimetype' = 'application/pdf'
      AND (metadata->>'size') ~ '^[1-9][0-9]*$'
  ) INTO v_storage_obj_exists;

  IF NOT v_storage_obj_exists THEN
    RAISE EXCEPTION 'Fichier introuvable ou invalide : Le fichier PDF ("%") doit exister dans le bucket "report-card-pdfs" avec un format "application/pdf" et une taille d’octets strictement positive.', p_storage_path;
  END IF;

  -- 10. Définir le contexte sécurisé pour autoriser la mise à jour PDF sur le trigger d'immutabilité
  PERFORM set_config('app.report_card_pdf_service_ctx', 'authorized_pdf_update', true);

  -- 11. Revérification finale du statut du lot avant l'écriture
  IF (SELECT status FROM public.report_card_batches WHERE id = v_rc.batch_id) <> 'validated_by_admin' THEN
    RAISE EXCEPTION 'Action refusée : Le statut du lot a changé pendant le traitement.';
  END IF;

  UPDATE public.period_report_cards
  SET
    pdf_storage_path = p_storage_path,
    pdf_checksum = LOWER(p_checksum),
    pdf_version = p_version,
    pdf_generated_at = now(),
    updated_at = now()
  WHERE id = p_report_card_id;

  RETURN jsonb_build_object(
    'success', true,
    'report_card_id', p_report_card_id,
    'storage_path', p_storage_path,
    'checksum', LOWER(p_checksum),
    'version', p_version,
    'generated_at', now()
  );
END;
$$;

--------------------------------------------------------------------------------
-- 5. RPC 2 : publish_report_card_batch (PUBLICATION STRICTE & VALIDATION TEMPORELLE)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.publish_report_card_batch(UUID);
CREATE OR REPLACE FUNCTION public.publish_report_card_batch(
  p_batch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_active BOOLEAN;
  v_batch RECORD;
  v_old_batch_id UUID;
  v_active_enrollments_count INTEGER := 0;
  v_report_cards_count INTEGER := 0;
  v_unmatched_enrollments_count INTEGER := 0;
  v_unmatched_cards_count INTEGER := 0;
  v_structural_mismatches_count INTEGER := 0;
  v_missing_pdf_count INTEGER := 0;
  v_outdated_pdf_count INTEGER := 0;
  v_invalid_checksum_count INTEGER := 0;
  v_missing_storage_count INTEGER := 0;
  v_duplicate_paths_count INTEGER := 0;
  v_non_canonical_paths_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seul l’administrateur de l’établissement peut publier les bulletins.';
  END IF;

  -- 1. Lecture préliminaire du lot
  SELECT id, class_id, period_id, school_id, academic_year_id, status, revision_number, validated_at
  INTO v_batch
  FROM public.report_card_batches
  WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_role = 'school_admin' AND v_school_id IS DISTINCT FROM v_batch.school_id THEN
    RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
  END IF;

  -- 2. Acquisition uniforme du verrou exclusif sur la classe et la période
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || v_batch.class_id::text || '_' || v_batch.period_id::text));

  -- 3. Verrouillage FOR UPDATE du lot et contrôle strict du statut et horodatage de validation
  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_batch.status <> 'validated_by_admin' THEN
    RAISE EXCEPTION 'Le lot doit impérativement être validé administrativement (validated_by_admin) avant publication (statut actuel: "%").', v_batch.status;
  END IF;

  IF v_batch.validated_at IS NULL THEN
    RAISE EXCEPTION 'Publication bloquée : La date de validation administrative (validated_at) est manquante sur ce lot.';
  END IF;

  -- 4. Vérification de la correspondance EXACTE et bijective (student_id, enrollment_id, school_id, class_id, academic_year_id, period_id)
  SELECT COUNT(*) INTO v_active_enrollments_count
  FROM public.student_enrollments se
  JOIN public.students s ON s.id = se.student_id
  WHERE se.class_id = v_batch.class_id
    AND se.academic_year_id = v_batch.academic_year_id
    AND se.school_id = v_batch.school_id
    AND se.status = 'active'
    AND s.enrollment_status = 'active';

  IF v_active_enrollments_count = 0 THEN
    RAISE EXCEPTION 'Publication impossible : Aucun élève actif n’est inscrit dans cette classe pour l’année scolaire en cours.';
  END IF;

  SELECT COUNT(*) INTO v_report_cards_count
  FROM public.period_report_cards
  WHERE batch_id = p_batch_id;

  -- Inscriptions actives sans bulletin dans ce lot
  SELECT COUNT(*) INTO v_unmatched_enrollments_count
  FROM public.student_enrollments se
  JOIN public.students s ON s.id = se.student_id
  WHERE se.class_id = v_batch.class_id
    AND se.academic_year_id = v_batch.academic_year_id
    AND se.school_id = v_batch.school_id
    AND se.status = 'active'
    AND s.enrollment_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.period_report_cards rc
      WHERE rc.batch_id = p_batch_id
        AND rc.student_id = se.student_id
        AND rc.enrollment_id = se.id
        AND rc.school_id = v_batch.school_id
        AND rc.class_id = v_batch.class_id
        AND rc.academic_year_id = v_batch.academic_year_id
        AND rc.period_id = v_batch.period_id
    );

  -- Bulletins du lot ne correspondant pas exactement à une inscription active
  SELECT COUNT(*) INTO v_unmatched_cards_count
  FROM public.period_report_cards rc
  WHERE rc.batch_id = p_batch_id
    AND NOT EXISTS (
      SELECT 1 FROM public.student_enrollments se
      JOIN public.students s ON s.id = se.student_id
      WHERE se.class_id = v_batch.class_id
        AND se.academic_year_id = v_batch.academic_year_id
        AND se.school_id = v_batch.school_id
        AND se.status = 'active'
        AND s.enrollment_status = 'active'
        AND se.student_id = rc.student_id
        AND se.id = rc.enrollment_id
    );

  -- Incohérences structurelles internes sur les clés étrangères des bulletins du lot
  SELECT COUNT(*) INTO v_structural_mismatches_count
  FROM public.period_report_cards rc
  WHERE rc.batch_id = p_batch_id
    AND (rc.school_id IS DISTINCT FROM v_batch.school_id OR
         rc.class_id IS DISTINCT FROM v_batch.class_id OR
         rc.academic_year_id IS DISTINCT FROM v_batch.academic_year_id OR
         rc.period_id IS DISTINCT FROM v_batch.period_id OR
         rc.rank_type IS NULL OR
         rc.rank_type NOT IN ('official', 'provisional'));

  IF v_unmatched_enrollments_count > 0 OR v_unmatched_cards_count > 0 OR v_structural_mismatches_count > 0 OR v_report_cards_count <> v_active_enrollments_count THEN
    RAISE EXCEPTION 'Publication bloquée : Discordance structurelle ou d’effectif. Inscriptions actives: %, Bulletins: %, Inscriptions sans bulletin: %, Bulletins orphelins: %, Incohérences clés: %. Veuillez régénérer le brouillon.',
      v_active_enrollments_count, v_report_cards_count, v_unmatched_enrollments_count, v_unmatched_cards_count, v_structural_mismatches_count;
  END IF;

  -- 5. Contrôle d'intégrité strict de CHAQUE bulletin : Présence, Validité, Antériorité temporelle et Nomenclature
  SELECT
    COUNT(*) FILTER (WHERE rc.pdf_storage_path IS NULL OR rc.pdf_version IS NULL OR rc.pdf_version < 1),
    COUNT(*) FILTER (WHERE rc.pdf_generated_at IS NULL OR rc.pdf_generated_at < v_batch.validated_at),
    COUNT(*) FILTER (WHERE rc.pdf_checksum IS NULL OR rc.pdf_checksum !~ '^[0-9a-fA-F]{64}$'),
    COUNT(*) FILTER (WHERE rc.pdf_storage_path IS NOT NULL AND rc.pdf_storage_path <> (v_batch.school_id::text || '/' || v_batch.id::text || '/' || rc.student_id::text || '/report-card-v' || COALESCE(rc.pdf_version, 0)::text || '.pdf'))
  INTO
    v_missing_pdf_count,
    v_outdated_pdf_count,
    v_invalid_checksum_count,
    v_non_canonical_paths_count
  FROM public.period_report_cards rc
  WHERE rc.batch_id = p_batch_id;

  IF v_missing_pdf_count > 0 THEN
    RAISE EXCEPTION 'Publication bloquée : % bulletin(s) n’ont pas de métadonnées PDF enregistrées.', v_missing_pdf_count;
  END IF;

  IF v_outdated_pdf_count > 0 THEN
    RAISE EXCEPTION 'Publication bloquée : % bulletin(s) possèdent un fichier PDF généré avant la dernière validation administrative. Régénérez les PDF.', v_outdated_pdf_count;
  END IF;

  IF v_invalid_checksum_count > 0 THEN
    RAISE EXCEPTION 'Publication bloquée : % bulletin(s) possèdent une empreinte SHA-256 invalide.', v_invalid_checksum_count;
  END IF;

  IF v_non_canonical_paths_count > 0 THEN
    RAISE EXCEPTION 'Publication bloquée : % chemin(s) de stockage PDF ne respectent pas la nomenclature canonique de l’établissement et de l’élève.', v_non_canonical_paths_count;
  END IF;

  -- Unicité stricte des chemins de stockage au sein du lot
  SELECT COUNT(*) - COUNT(DISTINCT rc.pdf_storage_path) INTO v_duplicate_paths_count
  FROM public.period_report_cards rc
  WHERE rc.batch_id = p_batch_id;

  IF v_duplicate_paths_count > 0 THEN
    RAISE EXCEPTION 'Publication bloquée : Détection de % chemin(s) PDF dupliqués entre plusieurs élèves du même lot.', v_duplicate_paths_count;
  END IF;

  -- 6. Contrôle d'existence physique réelle dans storage.objects (MIME application/pdf et taille > 0 sans cast dangereux)
  SELECT COUNT(*) INTO v_missing_storage_count
  FROM public.period_report_cards rc
  LEFT JOIN storage.objects so ON so.bucket_id = 'report-card-pdfs'
    AND so.name = rc.pdf_storage_path
    AND so.metadata IS NOT NULL
    AND so.metadata->>'mimetype' = 'application/pdf'
    AND (so.metadata->>'size') ~ '^[1-9][0-9]*$'
  WHERE rc.batch_id = p_batch_id
    AND so.name IS NULL;

  IF v_missing_storage_count > 0 THEN
    RAISE EXCEPTION 'Publication bloquée : % fichier(s) PDF sont introuvables ou invalides dans le stockage sécurisé (bucket "report-card-pdfs").', v_missing_storage_count;
  END IF;

  -- 7. Définir le contexte sécurisé de transition
  PERFORM set_config('app.report_card_transition_ctx', 'authorized_publish_transition', true);

  -- 8. Verrouiller et basculer l'ancienne révision publiée en 'superseded'
  SELECT id INTO v_old_batch_id
  FROM public.report_card_batches
  WHERE school_id = v_batch.school_id
    AND academic_year_id = v_batch.academic_year_id
    AND class_id = v_batch.class_id
    AND period_id = v_batch.period_id
    AND id <> p_batch_id
    AND status = 'published'
  FOR UPDATE;

  IF v_old_batch_id IS NOT NULL THEN
    UPDATE public.report_card_batches
    SET status = 'superseded', updated_at = now()
    WHERE id = v_old_batch_id;
  END IF;

  -- 9. Publication officielle du lot (rank_type reste figé et inchangé depuis validate_report_card_batch)
  UPDATE public.report_card_batches
  SET
    status = 'published',
    published_by = v_uid,
    published_at = now(),
    updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_batch.school_id, v_uid, 'publish_report_card_batch',
    jsonb_build_object(
      'batch_id', p_batch_id,
      'class_id', v_batch.class_id,
      'period_id', v_batch.period_id,
      'revision_number', v_batch.revision_number,
      'total_students_published', v_report_cards_count,
      'superseded_previous_batch_id', v_old_batch_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'status', 'published',
    'total_students_published', v_report_cards_count,
    'superseded_previous_batch_id', v_old_batch_id
  );
END;
$$;

--------------------------------------------------------------------------------
-- 6. RPC 3 : get_report_card_pdf_generation_status (ALIGNEMENT STRICT & CONTRÔLE TEMPOREL)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_report_card_pdf_generation_status(UUID);
CREATE OR REPLACE FUNCTION public.get_report_card_pdf_generation_status(
  p_batch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_active BOOLEAN;
  v_batch RECORD;
  v_total_cards INTEGER := 0;
  v_active_enrollments_count INTEGER := 0;
  v_unmatched_enrollments_count INTEGER := 0;
  v_unmatched_cards_count INTEGER := 0;
  v_structural_mismatches_count INTEGER := 0;
  v_ready_pdfs INTEGER := 0;
  v_missing_pdfs INTEGER := 0;
  v_outdated_pdfs INTEGER := 0;
  v_invalid_pdfs INTEGER := 0;
  v_duplicate_paths INTEGER := 0;
  v_can_publish BOOLEAN := false;
  v_missing_cards JSONB := '[]'::jsonb;
  v_card RECORD;
  v_expected_path TEXT;
  v_obj_exists BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  SELECT id, school_id, class_id, period_id, academic_year_id, status, revision_number, validated_at
  INTO v_batch
  FROM public.report_card_batches
  WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  IF v_role = 'school_admin' AND v_school_id IS DISTINCT FROM v_batch.school_id THEN
    RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
  ELSIF v_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Seule l’administration peut consulter l’état de préparation des PDF.';
  END IF;

  -- 1. Contrôle des inscriptions actives
  SELECT COUNT(*) INTO v_active_enrollments_count
  FROM public.student_enrollments se
  JOIN public.students s ON s.id = se.student_id
  WHERE se.class_id = v_batch.class_id
    AND se.academic_year_id = v_batch.academic_year_id
    AND se.school_id = v_batch.school_id
    AND se.status = 'active'
    AND s.enrollment_status = 'active';

  -- Inscriptions actives sans bulletin dans ce lot
  SELECT COUNT(*) INTO v_unmatched_enrollments_count
  FROM public.student_enrollments se
  JOIN public.students s ON s.id = se.student_id
  WHERE se.class_id = v_batch.class_id
    AND se.academic_year_id = v_batch.academic_year_id
    AND se.school_id = v_batch.school_id
    AND se.status = 'active'
    AND s.enrollment_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.period_report_cards rc
      WHERE rc.batch_id = p_batch_id
        AND rc.student_id = se.student_id
        AND rc.enrollment_id = se.id
        AND rc.school_id = v_batch.school_id
        AND rc.class_id = v_batch.class_id
        AND rc.academic_year_id = v_batch.academic_year_id
        AND rc.period_id = v_batch.period_id
    );

  -- Bulletins orphelins
  SELECT COUNT(*) INTO v_unmatched_cards_count
  FROM public.period_report_cards rc
  WHERE rc.batch_id = p_batch_id
    AND NOT EXISTS (
      SELECT 1 FROM public.student_enrollments se
      JOIN public.students s ON s.id = se.student_id
      WHERE se.class_id = v_batch.class_id
        AND se.academic_year_id = v_batch.academic_year_id
        AND se.school_id = v_batch.school_id
        AND se.status = 'active'
        AND s.enrollment_status = 'active'
        AND se.student_id = rc.student_id
        AND se.id = rc.enrollment_id
    );

  -- Incohérences structurelles de clés étrangères
  SELECT COUNT(*) INTO v_structural_mismatches_count
  FROM public.period_report_cards rc
  WHERE rc.batch_id = p_batch_id
    AND (rc.school_id IS DISTINCT FROM v_batch.school_id OR
         rc.class_id IS DISTINCT FROM v_batch.class_id OR
         rc.academic_year_id IS DISTINCT FROM v_batch.academic_year_id OR
         rc.period_id IS DISTINCT FROM v_batch.period_id OR
         rc.rank_type IS NULL OR
         rc.rank_type NOT IN ('official', 'provisional'));

  -- 2. Analyse détaillée de chaque bulletin
  FOR v_card IN (
    SELECT
      rc.id AS report_card_id,
      rc.student_id,
      COALESCE(rc.identity_snapshot->>'student_name', '') AS student_name,
      rc.pdf_storage_path,
      rc.pdf_checksum,
      rc.pdf_version,
      rc.pdf_generated_at
    FROM public.period_report_cards rc
    WHERE rc.batch_id = p_batch_id
    ORDER BY rc.rank ASC NULLS LAST, rc.identity_snapshot->>'student_name' ASC
  ) LOOP
    v_total_cards := v_total_cards + 1;
    v_expected_path := v_batch.school_id::text || '/' || v_batch.id::text || '/' || v_card.student_id::text || '/report-card-v' || COALESCE(v_card.pdf_version, 0)::text || '.pdf';

    IF v_card.pdf_storage_path IS NULL OR v_card.pdf_version IS NULL OR v_card.pdf_version < 1 THEN
      v_missing_pdfs := v_missing_pdfs + 1;
      v_missing_cards := v_missing_cards || jsonb_build_object(
        'report_card_id', v_card.report_card_id,
        'student_id', v_card.student_id,
        'student_name', v_card.student_name,
        'issue', 'missing_pdf'
      );
    ELSIF v_card.pdf_generated_at IS NULL OR v_batch.validated_at IS NULL OR v_card.pdf_generated_at < v_batch.validated_at THEN
      v_outdated_pdfs := v_outdated_pdfs + 1;
      v_missing_cards := v_missing_cards || jsonb_build_object(
        'report_card_id', v_card.report_card_id,
        'student_id', v_card.student_id,
        'student_name', v_card.student_name,
        'issue', 'pdf_generated_before_last_validation'
      );
    ELSIF v_card.pdf_checksum IS NULL OR v_card.pdf_checksum !~ '^[0-9a-fA-F]{64}$' OR v_card.pdf_storage_path <> v_expected_path THEN
      v_invalid_pdfs := v_invalid_pdfs + 1;
      v_missing_cards := v_missing_cards || jsonb_build_object(
        'report_card_id', v_card.report_card_id,
        'student_id', v_card.student_id,
        'student_name', v_card.student_name,
        'issue', 'invalid_checksum_or_path'
      );
    ELSE
      -- Vérifier l'existence réelle dans storage.objects avec MIME application/pdf et taille > 0
      SELECT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'report-card-pdfs'
          AND name = v_card.pdf_storage_path
          AND metadata IS NOT NULL
          AND metadata->>'mimetype' = 'application/pdf'
          AND (metadata->>'size') ~ '^[1-9][0-9]*$'
      ) INTO v_obj_exists;

      IF NOT v_obj_exists THEN
        v_invalid_pdfs := v_invalid_pdfs + 1;
        v_missing_cards := v_missing_cards || jsonb_build_object(
          'report_card_id', v_card.report_card_id,
          'student_id', v_card.student_id,
          'student_name', v_card.student_name,
          'issue', 'storage_file_missing_or_invalid'
        );
      ELSE
        v_ready_pdfs := v_ready_pdfs + 1;
      END IF;
    END IF;
  END LOOP;

  -- 3. Détection de chemins dupliqués
  SELECT COUNT(*) - COUNT(DISTINCT rc.pdf_storage_path) INTO v_duplicate_paths
  FROM public.period_report_cards rc
  WHERE rc.batch_id = p_batch_id AND rc.pdf_storage_path IS NOT NULL;

  -- 4. Évaluation stricte de la possibilité de publication (identique à publish_report_card_batch)
  IF v_total_cards > 0
     AND v_total_cards = v_active_enrollments_count
     AND v_unmatched_enrollments_count = 0
     AND v_unmatched_cards_count = 0
     AND v_structural_mismatches_count = 0
     AND v_missing_pdfs = 0
     AND v_outdated_pdfs = 0
     AND v_invalid_pdfs = 0
     AND v_duplicate_paths = 0
     AND v_batch.status = 'validated_by_admin'
     AND v_batch.validated_at IS NOT NULL THEN
    v_can_publish := true;
  ELSE
    v_can_publish := false;
  END IF;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'batch_status', v_batch.status,
    'revision_number', v_batch.revision_number,
    'validated_at', v_batch.validated_at,
    'total_active_enrollments', v_active_enrollments_count,
    'total_report_cards', v_total_cards,
    'unmatched_enrollments_count', v_unmatched_enrollments_count,
    'unmatched_cards_count', v_unmatched_cards_count,
    'structural_mismatches_count', v_structural_mismatches_count,
    'ready_pdfs', v_ready_pdfs,
    'missing_pdfs', v_missing_pdfs,
    'outdated_pdfs', v_outdated_pdfs,
    'invalid_pdfs', v_invalid_pdfs,
    'duplicate_paths_count', v_duplicate_paths,
    'can_publish', v_can_publish,
    'unready_cards', v_missing_cards
  );
END;
$$;

--------------------------------------------------------------------------------
-- 7. MATRICE DES PRIVILÈGES SÉCURISÉS
--------------------------------------------------------------------------------

-- set_report_card_pdf_metadata : service_role UNIQUEMENT
REVOKE ALL ON FUNCTION public.set_report_card_pdf_metadata(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_report_card_pdf_metadata(UUID, TEXT, TEXT, INTEGER) TO service_role;

-- validate_report_card_batch : authenticated (avec contrôle school_admin / super_admin)
REVOKE ALL ON FUNCTION public.validate_report_card_batch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_report_card_batch(UUID) TO authenticated, service_role;

-- return_report_card_batch_to_draft : authenticated (avec contrôle school_admin / super_admin)
REVOKE ALL ON FUNCTION public.return_report_card_batch_to_draft(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_report_card_batch_to_draft(UUID, TEXT) TO authenticated, service_role;

-- publish_report_card_batch : authenticated (avec contrôle de rôle school_admin / super_admin)
REVOKE ALL ON FUNCTION public.publish_report_card_batch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_report_card_batch(UUID) TO authenticated, service_role;

-- get_report_card_pdf_generation_status : authenticated (avec contrôle school_admin / super_admin)
REVOKE ALL ON FUNCTION public.get_report_card_pdf_generation_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_card_pdf_generation_status(UUID) TO authenticated, service_role;

COMMIT;
