-- ============================================================================
-- Migration : Correction Canonique de la FK profiles.id dans les RPC et Policies de Bulletins
-- Fichier : supabase/migrations/20260819210000_fix_report_card_homeroom_profile_fk.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. RPC 1 : generate_class_report_card_draft
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_class_report_card_draft(
  p_class_id UUID,
  p_period_id UUID
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
  v_class RECORD;
  v_period RECORD;
  v_term RECORD;
  v_year RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_batch_id UUID;
  v_next_revision INTEGER := 1;
  v_existing_batch RECORD;
  v_active_enrollments_count INTEGER := 0;
  v_student_cur RECORD;
  v_student_period_res JSONB;
  v_report_card_id UUID;
  v_subj_elem JSONB;
  v_pos INTEGER := 1;
  v_complete_count INTEGER := 0;
  v_incomplete_count INTEGER := 0;
  v_total_ranked INTEGER := 0;
  v_school_record RECORD;
  v_homeroom_teacher_name TEXT := '';
  v_homeroom_teacher_signature TEXT := NULL;
  v_active_student_ids UUID[] := ARRAY[]::UUID[];
  v_active_subject_ids UUID[] := ARRAY[]::UUID[];
  v_subject_row RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  -- 1. Acquisition uniforme du verrou exclusif sur la classe et la période
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || p_class_id::text || '_' || p_period_id::text));

  -- 2. Validation de la classe
  SELECT id, school_id, academic_year_id, name, education_cycle, homeroom_teacher_id
  INTO v_class
  FROM public.classes WHERE id = p_class_id;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable.';
  END IF;

  -- 3. Validation de la période
  SELECT id, school_id, academic_year_id, parent_term_id, name, education_cycle, starts_on, ends_on, is_active
  INTO v_period
  FROM public.school_periods WHERE id = p_period_id;

  IF v_period.id IS NULL OR v_period.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Période scolaire inactive ou introuvable.';
  END IF;

  IF v_period.school_id IS DISTINCT FROM v_class.school_id OR v_period.academic_year_id IS DISTINCT FROM v_class.academic_year_id OR v_period.education_cycle IS DISTINCT FROM v_class.education_cycle THEN
    RAISE EXCEPTION 'Incohérence structurelle entre la période et la classe.';
  END IF;

  -- Validation du terme parent et de l'année
  SELECT id, name INTO v_term FROM public.school_terms WHERE id = v_period.parent_term_id;
  SELECT id, name INTO v_year FROM public.academic_years WHERE id = v_class.academic_year_id;

  -- Validation des droits d'accès : school_admin ou professeur titulaire actif (comparaison stricte avec profiles.id)
  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'school_admin' THEN
    IF v_school_id IS DISTINCT FROM v_class.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF v_school_id IS DISTINCT FROM v_class.school_id THEN
      RAISE EXCEPTION 'Accès refusé.';
    END IF;

    SELECT id, profile_id, employment_status, account_status
    INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid
      AND school_id = v_class.school_id
      AND account_status = 'active'
      AND employment_status = 'active';

    IF v_teacher.id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Dossier enseignant inactif ou introuvable.';
    END IF;

    IF v_class.homeroom_teacher_id = v_uid THEN
      v_is_homeroom := true;
    END IF;

    IF NOT v_is_homeroom THEN
      RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire de cette classe ou l’administrateur peut générer les bulletins.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  -- Récupération de l'identité de l'établissement
  SELECT id, name, logo_url, principal_name, director_signature_url, stamp_url, motto, address, phone, email, official_registration_number
  INTO v_school_record
  FROM public.schools WHERE id = v_class.school_id;

  -- Récupération du nom et de la signature du titulaire (jointure stricte sur profiles.id)
  IF v_class.homeroom_teacher_id IS NOT NULL THEN
    SELECT
      TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')),
      t.signature_url
    INTO v_homeroom_teacher_name, v_homeroom_teacher_signature
    FROM public.teachers t
    JOIN public.profiles p ON p.id = t.profile_id
    WHERE t.profile_id = v_class.homeroom_teacher_id
      AND t.school_id = v_class.school_id
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND p.is_active = true;
  END IF;

  -- 4. Lecture du lot le plus récent avec verrouillage FOR UPDATE
  SELECT id, revision_number, status INTO v_existing_batch
  FROM public.report_card_batches
  WHERE school_id = v_class.school_id
    AND academic_year_id = v_class.academic_year_id
    AND class_id = p_class_id
    AND period_id = p_period_id
  ORDER BY revision_number DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_batch.id IS NOT NULL THEN
    IF v_existing_batch.status = 'published' THEN
      RAISE EXCEPTION 'Un lot de bulletins a déjà été publié pour cette classe et période (Révision #%). Utilisez la réouverture administrative.', v_existing_batch.revision_number;
    ELSIF v_existing_batch.status = 'submitted_by_homeroom' THEN
      RAISE EXCEPTION 'Le lot actuel (Révision #%) a déjà été soumis par le titulaire. Il doit être validé ou renvoyé en brouillon par la direction.', v_existing_batch.revision_number;
    ELSIF v_existing_batch.status = 'validated_by_admin' THEN
      RAISE EXCEPTION 'Le lot actuel (Révision #%) est validé par la direction en attente de publication.', v_existing_batch.revision_number;
    ELSIF v_existing_batch.status = 'draft' THEN
      v_batch_id := v_existing_batch.id;
      v_next_revision := v_existing_batch.revision_number;
    END IF;
  END IF;

  IF v_batch_id IS NULL THEN
    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_revision
    FROM public.report_card_batches
    WHERE school_id = v_class.school_id
      AND academic_year_id = v_class.academic_year_id
      AND class_id = p_class_id
      AND period_id = p_period_id;

    INSERT INTO public.report_card_batches (
      school_id, academic_year_id, class_id, period_id, revision_number,
      status, created_by
    ) VALUES (
      v_class.school_id, v_class.academic_year_id, p_class_id, p_period_id, v_next_revision,
      'draft', v_uid
    )
    RETURNING id INTO v_batch_id;
  END IF;

  -- 5. Parcours de tous les élèves inscrits actifs
  FOR v_student_cur IN (
    SELECT
      s.id AS student_id,
      se.id AS enrollment_id,
      s.student_number,
      COALESCE(p.first_name, s.first_name, '') AS first_name,
      COALESCE(p.last_name, s.last_name, '') AS last_name,
      s.gender,
      s.date_of_birth
    FROM public.student_enrollments se
    JOIN public.students s ON s.id = se.student_id
    LEFT JOIN public.profiles p ON p.id = s.profile_id
    WHERE se.class_id = p_class_id
      AND se.academic_year_id = v_class.academic_year_id
      AND se.school_id = v_class.school_id
      AND se.status = 'active'
      AND s.enrollment_status = 'active'
    ORDER BY COALESCE(p.last_name, s.last_name, '') ASC, COALESCE(p.first_name, s.first_name, '') ASC
  ) LOOP
    v_active_enrollments_count := v_active_enrollments_count + 1;
    v_active_student_ids := array_append(v_active_student_ids, v_student_cur.student_id);

    -- Calcul officiel de la période pour cet élève
    v_student_period_res := public.get_student_period_result(v_student_cur.student_id, p_period_id);

    IF (v_student_period_res->>'is_complete')::boolean IS TRUE THEN
      v_complete_count := v_complete_count + 1;
    ELSE
      v_incomplete_count := v_incomplete_count + 1;
    END IF;

    -- Création ou mise à jour du bulletin individuel (préserve les remarques existantes)
    INSERT INTO public.period_report_cards (
      batch_id, school_id, academic_year_id, class_id, period_id,
      student_id, enrollment_id,
      overall_percentage,
      rank, total_students_ranked, rank_type,
      is_incomplete,
      completed_subjects_count, pending_subjects_count,
      total_subject_coefficients,
      calculation_snapshot,
      identity_snapshot,
      signature_snapshot
    ) VALUES (
      v_batch_id, v_class.school_id, v_class.academic_year_id, p_class_id, p_period_id,
      v_student_cur.student_id, v_student_cur.enrollment_id,
      (v_student_period_res->>'overall_percentage')::numeric,
      NULL, 0, 'provisional',
      NOT ((v_student_period_res->>'is_complete')::boolean),
      COALESCE((v_student_period_res->>'completed_subjects_count')::int, 0),
      COALESCE((v_student_period_res->>'pending_subjects_count')::int, 0),
      COALESCE((v_student_period_res->>'total_subject_coefficients')::numeric, 0),
      v_student_period_res,
      jsonb_build_object(
        'student_id', v_student_cur.student_id,
        'student_number', v_student_cur.student_number,
        'student_name', TRIM(v_student_cur.first_name || ' ' || v_student_cur.last_name),
        'student_first_name', v_student_cur.first_name,
        'student_last_name', v_student_cur.last_name,
        'gender', v_student_cur.gender,
        'date_of_birth', v_student_cur.date_of_birth,
        'class_id', v_class.id,
        'class_name', v_class.name,
        'education_cycle', v_class.education_cycle,
        'academic_year_id', v_year.id,
        'academic_year_name', v_year.name,
        'period_id', v_period.id,
        'period_name', v_period.name,
        'period_starts_on', v_period.starts_on,
        'period_ends_on', v_period.ends_on,
        'term_name', v_term.name,
        'school_name', v_school_record.name,
        'school_address', v_school_record.address,
        'school_phone', v_school_record.phone,
        'school_email', v_school_record.email,
        'logo_url', v_school_record.logo_url,
        'official_registration_number', v_school_record.official_registration_number,
        'motto', v_school_record.motto
      ),
      jsonb_build_object(
        'principal_name', v_school_record.principal_name,
        'director_signature_url', v_school_record.director_signature_url,
        'stamp_url', v_school_record.stamp_url,
        'homeroom_teacher_name', v_homeroom_teacher_name,
        'homeroom_teacher_signature_url', v_homeroom_teacher_signature
      )
    )
    ON CONFLICT (batch_id, student_id) DO UPDATE SET
      overall_percentage = EXCLUDED.overall_percentage,
      is_incomplete = EXCLUDED.is_incomplete,
      completed_subjects_count = EXCLUDED.completed_subjects_count,
      pending_subjects_count = EXCLUDED.pending_subjects_count,
      total_subject_coefficients = EXCLUDED.total_subject_coefficients,
      calculation_snapshot = EXCLUDED.calculation_snapshot,
      identity_snapshot = EXCLUDED.identity_snapshot,
      signature_snapshot = EXCLUDED.signature_snapshot,
      updated_at = now()
    RETURNING id INTO v_report_card_id;

    -- Insertion / Mise à jour des lignes de matières détaillées
    v_pos := 1;
    v_active_subject_ids := ARRAY[]::UUID[];

    FOR v_subj_elem IN SELECT * FROM jsonb_array_elements(COALESCE(v_student_period_res->'subjects', '[]'::jsonb))
    LOOP
      v_active_subject_ids := array_append(v_active_subject_ids, (v_subj_elem->>'subject_id')::uuid);

      -- Récupération du code officiel de la matière
      SELECT code INTO v_subject_row FROM public.subjects WHERE id = (v_subj_elem->>'subject_id')::uuid;

      INSERT INTO public.report_card_subject_results (
        report_card_id, subject_id,
        subject_name_snapshot, subject_code_snapshot,
        coefficient, subject_percentage,
        assessment_count, completed_assessment_count, pending_assessment_count,
        is_complete, display_position
      ) VALUES (
        v_report_card_id,
        (v_subj_elem->>'subject_id')::uuid,
        v_subj_elem->>'subject_name',
        v_subject_row.code,
        COALESCE((v_subj_elem->>'subject_coefficient')::numeric, 1.0),
        (v_subj_elem->>'subject_percentage')::numeric,
        COALESCE((v_subj_elem->>'assessment_count')::int, 0),
        COALESCE((v_subj_elem->>'completed_assessment_count')::int, 0),
        COALESCE((v_subj_elem->>'pending_assessment_count')::int, 0),
        COALESCE((v_subj_elem->>'is_complete')::boolean, false),
        v_pos
      )
      ON CONFLICT (report_card_id, subject_id) DO UPDATE SET
        subject_name_snapshot = EXCLUDED.subject_name_snapshot,
        subject_code_snapshot = EXCLUDED.subject_code_snapshot,
        coefficient = EXCLUDED.coefficient,
        subject_percentage = EXCLUDED.subject_percentage,
        assessment_count = EXCLUDED.assessment_count,
        completed_assessment_count = EXCLUDED.completed_assessment_count,
        pending_assessment_count = EXCLUDED.pending_assessment_count,
        is_complete = EXCLUDED.is_complete,
        display_position = EXCLUDED.display_position,
        updated_at = now();

      v_pos := v_pos + 1;
    END LOOP;

    -- Nettoyer les matières devenues inactives
    DELETE FROM public.report_card_subject_results
    WHERE report_card_id = v_report_card_id
      AND NOT (subject_id = ANY(v_active_subject_ids));
  END LOOP;

  -- Supprimer du lot les élèves qui ne sont plus activement inscrits
  DELETE FROM public.period_report_cards
  WHERE batch_id = v_batch_id
    AND NOT (student_id = ANY(v_active_student_ids));

  -- Calcul officiel du classement standard de compétition (1, 2, 2, 4) parmi les élèves notés
  SELECT COUNT(*) INTO v_total_ranked
  FROM public.period_report_cards
  WHERE batch_id = v_batch_id AND overall_percentage IS NOT NULL;

  WITH ranked AS (
    SELECT
      id,
      RANK() OVER (ORDER BY overall_percentage DESC) as calculated_rank
    FROM public.period_report_cards
    WHERE batch_id = v_batch_id AND overall_percentage IS NOT NULL
  )
  UPDATE public.period_report_cards rc
  SET
    rank = ranked.calculated_rank,
    total_students_ranked = v_total_ranked,
    rank_type = 'provisional',
    updated_at = now()
  FROM ranked
  WHERE rc.id = ranked.id;

  -- Mise à jour du récapitulatif du lot
  UPDATE public.report_card_batches
  SET
    total_students_count = v_active_enrollments_count,
    complete_students_count = v_complete_count,
    incomplete_students_count = v_incomplete_count,
    updated_at = now()
  WHERE id = v_batch_id;

  -- Audit log
  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_class.school_id, v_uid, 'generate_class_report_card_draft',
    jsonb_build_object(
      'batch_id', v_batch_id,
      'class_id', p_class_id,
      'period_id', p_period_id,
      'revision_number', v_next_revision,
      'total_students', v_active_enrollments_count,
      'complete_students', v_complete_count,
      'incomplete_students', v_incomplete_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'revision_number', v_next_revision,
    'status', 'draft',
    'total_students_count', v_active_enrollments_count,
    'complete_students_count', v_complete_count,
    'incomplete_students_count', v_incomplete_count,
    'total_students_ranked', v_total_ranked
  );
END;
$$;

--------------------------------------------------------------------------------
-- 2. RPC 2 : save_report_card_remarks
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_report_card_remarks(
  p_report_card_id UUID,
  p_homeroom_remarks TEXT DEFAULT NULL,
  p_conduct_grade TEXT DEFAULT NULL,
  p_principal_remarks TEXT DEFAULT NULL,
  p_subject_remarks JSONB DEFAULT NULL
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
  v_rc RECORD;
  v_batch RECORD;
  v_class RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_subj_elem JSONB;
  v_target_subject_id UUID;
  v_target_remark TEXT;
  v_updated_rows INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  SELECT rc.id, rc.batch_id, rc.class_id, rc.school_id, rc.student_id
  INTO v_rc
  FROM public.period_report_cards rc WHERE rc.id = p_report_card_id;

  IF v_rc.id IS NULL THEN
    RAISE EXCEPTION 'Bulletin introuvable.';
  END IF;

  SELECT id, status, academic_year_id INTO v_batch FROM public.report_card_batches WHERE id = v_rc.batch_id;

  IF v_batch.status IN ('validated_by_admin', 'published', 'superseded') THEN
    RAISE EXCEPTION 'Action refusée : Impossible de modifier les remarques d’un bulletin validé ou publié (statut actuel: %).', v_batch.status;
  END IF;

  SELECT id, homeroom_teacher_id INTO v_class FROM public.classes WHERE id = v_rc.class_id;

  IF v_role = 'super_admin' THEN
    INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
    VALUES (
      v_rc.school_id, v_uid, 'super_admin_override_report_card_remarks',
      jsonb_build_object('report_card_id', p_report_card_id, 'batch_id', v_rc.batch_id)
    );
  ELSIF v_role = 'school_admin' THEN
    IF v_school_id IS DISTINCT FROM v_rc.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF v_school_id IS DISTINCT FROM v_rc.school_id THEN
      RAISE EXCEPTION 'Accès refusé.';
    END IF;

    SELECT id, profile_id, employment_status, account_status
    INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid
      AND school_id = v_rc.school_id
      AND account_status = 'active'
      AND employment_status = 'active';

    IF v_teacher.id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Enseignant inactif ou non habilité.';
    END IF;

    -- Comparaison stricte avec profiles.id
    IF v_class.homeroom_teacher_id = v_uid THEN
      v_is_homeroom := true;
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  -- 1. Appréciations du Titulaire (uniquement homeroom_teacher_remarks et conduct_grade, batch en statut draft)
  IF p_homeroom_remarks IS NOT NULL OR p_conduct_grade IS NOT NULL THEN
    IF v_role <> 'super_admin' AND NOT v_is_homeroom THEN
      RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire de cette classe peut modifier l’appréciation générale et la note de conduite.';
    END IF;

    IF v_batch.status <> 'draft' AND v_role <> 'super_admin' THEN
      RAISE EXCEPTION 'Les appréciations du titulaire ne peuvent être saisies qu’en statut Brouillon (draft).';
    END IF;

    IF LENGTH(COALESCE(p_homeroom_remarks, '')) > 1000 THEN
      RAISE EXCEPTION 'L’appréciation générale du titulaire ne doit pas dépasser 1000 caractères.';
    END IF;

    IF LENGTH(COALESCE(p_conduct_grade, '')) > 50 THEN
      RAISE EXCEPTION 'La mention de conduite ne doit pas dépasser 50 caractères.';
    END IF;

    UPDATE public.period_report_cards
    SET
      homeroom_teacher_remarks = NULLIF(TRIM(p_homeroom_remarks), ''),
      conduct_grade = NULLIF(TRIM(p_conduct_grade), ''),
      updated_at = now()
    WHERE id = p_report_card_id;
  END IF;

  -- 2. Appréciation de la Direction (uniquement principal_remarks, batch en statut submitted_by_homeroom)
  IF p_principal_remarks IS NOT NULL THEN
    IF v_role NOT IN ('school_admin', 'super_admin') THEN
      RAISE EXCEPTION 'Accès refusé : Seule la direction de l’établissement peut renseigner l’appréciation de direction.';
    END IF;

    IF v_batch.status <> 'submitted_by_homeroom' AND v_role <> 'super_admin' THEN
      RAISE EXCEPTION 'L’appréciation de direction ne peut être saisie que sur un lot soumis par le titulaire (statut actuel: %).', v_batch.status;
    END IF;

    IF LENGTH(COALESCE(p_principal_remarks, '')) > 1000 THEN
      RAISE EXCEPTION 'L’appréciation de direction ne doit pas dépasser 1000 caractères.';
    END IF;

    UPDATE public.period_report_cards
    SET
      principal_remarks = NULLIF(TRIM(p_principal_remarks), ''),
      updated_at = now()
    WHERE id = p_report_card_id;
  END IF;

  -- 3. Remarques par matière (vérification stricte de l'affectation active, batch en statut draft)
  IF p_subject_remarks IS NOT NULL AND jsonb_typeof(p_subject_remarks) = 'array' THEN
    IF v_batch.status <> 'draft' AND v_role <> 'super_admin' THEN
      RAISE EXCEPTION 'Les remarques par matière ne peuvent être modifiées qu’en statut Brouillon.';
    END IF;

    FOR v_subj_elem IN SELECT * FROM jsonb_array_elements(p_subject_remarks)
    LOOP
      v_target_subject_id := (v_subj_elem->>'subject_id')::uuid;
      v_target_remark := NULLIF(TRIM(v_subj_elem->>'remark'), '');

      IF LENGTH(COALESCE(v_target_remark, '')) > 500 THEN
        RAISE EXCEPTION 'La remarque par matière ne doit pas dépasser 500 caractères.';
      END IF;

      -- L'enseignant (même s'il est titulaire) doit impérativement être affecté à la matière
      IF v_role = 'teacher' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.teacher_class_assignments tca
          WHERE (tca.teacher_profile_id = v_uid OR tca.teacher_id = v_teacher.id)
            AND tca.class_id = v_rc.class_id
            AND tca.subject_id = v_target_subject_id
            AND tca.academic_year_id = v_batch.academic_year_id
            AND tca.school_id = v_rc.school_id
            AND tca.is_active = true
        ) THEN
          RAISE EXCEPTION 'Accès refusé : Vous n’êtes pas affecté à la matière (%) dans cette classe.', v_target_subject_id;
        END IF;
      ELSIF v_role = 'school_admin' THEN
        RAISE EXCEPTION 'Accès refusé : La direction ne modifie pas les remarques individuelles des matières.';
      END IF;

      UPDATE public.report_card_subject_results
      SET
        subject_remark = v_target_remark,
        updated_at = now()
      WHERE report_card_id = p_report_card_id
        AND subject_id = v_target_subject_id;

      GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
      IF v_updated_rows <> 1 THEN
        RAISE EXCEPTION 'Erreur de mise à jour : La matière (%) n’existe pas dans ce bulletin.', v_target_subject_id;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'report_card_id', p_report_card_id);
END;
$$;

--------------------------------------------------------------------------------
-- 3. RPC 3 : submit_report_card_batch
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_report_card_batch(
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
  v_class RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_active_enrollments_count INTEGER := 0;
  v_report_cards_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  -- 1. Lecture préliminaire de la classe et période
  SELECT id, class_id, period_id, school_id, status INTO v_batch
  FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  -- 2. Acquisition uniforme du verrou exclusif
  PERFORM pg_advisory_xact_lock(hashtext('rc_batch_lock_' || v_batch.class_id::text || '_' || v_batch.period_id::text));

  -- 3. Verrouillage FOR UPDATE du lot et revérification du statut
  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_batch.status <> 'draft' THEN
    RAISE EXCEPTION 'Seul un lot en statut Brouillon peut être soumis (statut actuel: %).', v_batch.status;
  END IF;

  SELECT id, homeroom_teacher_id INTO v_class FROM public.classes WHERE id = v_batch.class_id;

  IF v_class.homeroom_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Opération bloquée : Aucun professeur titulaire n’est affecté à cette classe.';
  END IF;

  -- Vérification stricte du titulaire actif (comparaison stricte avec profiles.id)
  IF v_role = 'teacher' THEN
    SELECT id INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid
      AND school_id = v_batch.school_id
      AND account_status = 'active'
      AND employment_status = 'active';

    IF v_teacher.id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Dossier enseignant inactif ou introuvable.';
    END IF;

    IF v_class.homeroom_teacher_id = v_uid THEN
      v_is_homeroom := true;
    END IF;
  ELSIF v_role = 'super_admin' THEN
    v_is_homeroom := true;
  END IF;

  IF NOT v_is_homeroom THEN
    RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire actif de cette classe peut soumettre les bulletins à la direction.';
  END IF;

  -- Vérifier que le nombre de bulletins correspond aux inscriptions actives
  SELECT COUNT(*) INTO v_active_enrollments_count
  FROM public.student_enrollments se
  JOIN public.students s ON s.id = se.student_id
  WHERE se.class_id = v_batch.class_id
    AND se.academic_year_id = v_batch.academic_year_id
    AND se.school_id = v_batch.school_id
    AND se.status = 'active'
    AND s.enrollment_status = 'active';

  SELECT COUNT(*) INTO v_report_cards_count
  FROM public.period_report_cards WHERE batch_id = p_batch_id;

  IF v_report_cards_count <> v_active_enrollments_count THEN
    RAISE EXCEPTION 'Incohérence d’effectif : Le lot contient % bulletins pour % élèves actifs. Veuillez régénérer le brouillon.',
      v_report_cards_count, v_active_enrollments_count;
  END IF;

  -- Définir le contexte sécurisé de transition
  PERFORM set_config('app.report_card_transition_ctx', 'authorized_submit_transition', true);

  UPDATE public.report_card_batches
  SET
    status = 'submitted_by_homeroom',
    submitted_by = v_uid,
    submitted_at = now(),
    updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_batch.school_id, v_uid, 'submit_report_card_batch',
    jsonb_build_object('batch_id', p_batch_id, 'class_id', v_batch.class_id, 'period_id', v_batch.period_id)
  );

  RETURN jsonb_build_object('success', true, 'batch_id', p_batch_id, 'status', 'submitted_by_homeroom');
END;
$$;

--------------------------------------------------------------------------------
-- 4. RPC 4 : validate_report_card_batch
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

  -- Rafraîchir et figer l'identité et les signatures pour chaque bulletin
  SELECT name, starts_on, ends_on, parent_term_id INTO v_period FROM public.school_periods WHERE id = v_batch.period_id;
  SELECT name INTO v_term FROM public.school_terms WHERE id = v_period.parent_term_id;
  SELECT name INTO v_year FROM public.academic_years WHERE id = v_batch.academic_year_id;

  UPDATE public.period_report_cards rc
  SET
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
-- 5. RPC 5 : get_report_card_for_management
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_report_card_for_management(
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
  v_class RECORD;
  v_teacher RECORD;
  v_is_homeroom BOOLEAN := false;
  v_cards_json JSONB := '[]'::jsonb;
  v_card_cur RECORD;
  v_subj_json JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT role, school_id, is_active INTO v_role, v_school_id, v_active
  FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Profil utilisateur inactif ou introuvable.';
  END IF;

  SELECT * INTO v_batch FROM public.report_card_batches WHERE id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lot de bulletins introuvable.';
  END IF;

  SELECT id, name, education_cycle, homeroom_teacher_id INTO v_class
  FROM public.classes WHERE id = v_batch.class_id;

  IF v_role = 'super_admin' THEN
    v_is_homeroom := true;
  ELSIF v_role = 'school_admin' THEN
    IF v_school_id IS DISTINCT FROM v_batch.school_id THEN
      RAISE EXCEPTION 'Accès refusé : Établissement non autorisé.';
    END IF;
    v_is_homeroom := true;
  ELSIF v_role = 'teacher' THEN
    IF v_school_id IS DISTINCT FROM v_batch.school_id THEN
      RAISE EXCEPTION 'Accès refusé.';
    END IF;

    SELECT id INTO v_teacher
    FROM public.teachers
    WHERE profile_id = v_uid
      AND school_id = v_batch.school_id
      AND account_status = 'active'
      AND employment_status = 'active';

    IF v_teacher.id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Dossier enseignant inactif ou introuvable.';
    END IF;

    -- Comparaison stricte avec profiles.id
    IF v_class.homeroom_teacher_id = v_uid THEN
      v_is_homeroom := true;
    END IF;

    IF NOT v_is_homeroom THEN
      RAISE EXCEPTION 'Accès refusé : Seul le professeur titulaire de cette classe ou l’administrateur peut gérer ce lot.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  -- Construction des bulletins
  FOR v_card_cur IN (
    SELECT rc.*
    FROM public.period_report_cards rc
    WHERE rc.batch_id = p_batch_id
    ORDER BY rc.rank ASC NULLS LAST, (rc.identity_snapshot->>'student_name') ASC
  ) LOOP
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'subject_id', s.subject_id,
          'subject_name', s.subject_name_snapshot,
          'subject_code', s.subject_code_snapshot,
          'coefficient', s.coefficient,
          'subject_percentage', s.subject_percentage,
          'assessment_count', s.assessment_count,
          'completed_assessment_count', s.completed_assessment_count,
          'pending_assessment_count', s.pending_assessment_count,
          'is_complete', s.is_complete,
          'subject_remark', s.subject_remark,
          'display_position', s.display_position
        ) ORDER BY s.display_position ASC
      ), '[]'::jsonb
    ) INTO v_subj_json
    FROM public.report_card_subject_results s
    WHERE s.report_card_id = v_card_cur.id;

    v_cards_json := v_cards_json || jsonb_build_object(
      'report_card_id', v_card_cur.id,
      'student_id', v_card_cur.student_id,
      'student_number', v_card_cur.identity_snapshot->>'student_number',
      'student_name', v_card_cur.identity_snapshot->>'student_name',
      'overall_percentage', v_card_cur.overall_percentage,
      'rank', v_card_cur.rank,
      'total_students_ranked', v_card_cur.total_students_ranked,
      'rank_type', v_card_cur.rank_type,
      'is_incomplete', v_card_cur.is_incomplete,
      'completed_subjects_count', v_card_cur.completed_subjects_count,
      'pending_subjects_count', v_card_cur.pending_subjects_count,
      'total_subject_coefficients', v_card_cur.total_subject_coefficients,
      'homeroom_teacher_remarks', v_card_cur.homeroom_teacher_remarks,
      'conduct_grade', v_card_cur.conduct_grade,
      'principal_remarks', v_card_cur.principal_remarks,
      'pdf_storage_path', v_card_cur.pdf_storage_path,
      'pdf_generated_at', v_card_cur.pdf_generated_at,
      'pdf_checksum', v_card_cur.pdf_checksum,
      'pdf_version', v_card_cur.pdf_version,
      'identity', v_card_cur.identity_snapshot,
      'signatures', v_card_cur.signature_snapshot,
      'subjects', v_subj_json
    );
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', v_batch.id,
    'school_id', v_batch.school_id,
    'academic_year_id', v_batch.academic_year_id,
    'class_id', v_batch.class_id,
    'class_name', v_class.name,
    'period_id', v_batch.period_id,
    'revision_number', v_batch.revision_number,
    'status', v_batch.status,
    'total_students_count', v_batch.total_students_count,
    'complete_students_count', v_batch.complete_students_count,
    'incomplete_students_count', v_batch.incomplete_students_count,
    'submitted_at', v_batch.submitted_at,
    'validated_at', v_batch.validated_at,
    'published_at', v_batch.published_at,
    'returned_to_draft_at', v_batch.returned_to_draft_at,
    'return_reason', v_batch.return_reason,
    'report_cards', v_cards_json
  );
END;
$$;

--------------------------------------------------------------------------------
-- 6. POLICIES RLS SELECT : report_card_batches, period_report_cards, report_card_subject_results
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS "teacher_select_rc_batches" ON public.report_card_batches;
CREATE POLICY "teacher_select_rc_batches"
ON public.report_card_batches FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    JOIN public.classes c ON c.id = report_card_batches.class_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.school_id = report_card_batches.school_id
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND c.homeroom_teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "teacher_select_period_rc" ON public.period_report_cards;
CREATE POLICY "teacher_select_period_rc"
ON public.period_report_cards FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    JOIN public.classes c ON c.id = period_report_cards.class_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.school_id = period_report_cards.school_id
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND c.homeroom_teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "teacher_select_rc_subjects" ON public.report_card_subject_results;
CREATE POLICY "teacher_select_rc_subjects"
ON public.report_card_subject_results FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.period_report_cards rc
    JOIN public.classes c ON c.id = rc.class_id
    JOIN public.profiles p ON p.id = auth.uid()
    JOIN public.teachers t ON t.profile_id = p.id AND t.school_id = p.school_id
    WHERE rc.id = report_card_subject_results.report_card_id
      AND p.is_active = true
      AND p.school_id = rc.school_id
      AND t.account_status = 'active'
      AND t.employment_status = 'active'
      AND c.homeroom_teacher_id = auth.uid()
  )
);

--------------------------------------------------------------------------------
-- 7. MATRICE DES PRIVILÈGES (SÉCURITÉ STRICTE)
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.generate_class_report_card_draft(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_class_report_card_draft(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.save_report_card_remarks(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_card_remarks(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_report_card_batch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_report_card_batch(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.validate_report_card_batch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_report_card_batch(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_report_card_for_management(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_card_for_management(UUID) TO authenticated;

COMMIT;
