-- Script de Réparation Historique de Données (Data Repair / Production Patch)
-- Fichier : supabase/migration_backups/data_repairs/20260818080000_realign_secondary_class_assessment_terms.sql
-- Note d'archivage : Ce script effectue une correction ciblée de données spécifiques à l'établissement 'complexe-scolaire-les-petits-anges'.
-- Il a été exécuté historiquement en production et ne doit pas faire partie de la chaîne de migrations DDL reproductibles sur une base vide.

BEGIN;

DO $$
DECLARE
  v_school_id UUID;
  v_school_name TEXT;
  v_academic_year_id UUID;
  v_class_1a_id UUID;
  v_class_1a_cycle TEXT;
  v_new_term_id UUID;
  v_new_term_name TEXT;
  v_asmt_record RECORD;
  v_asmt_count INT;
  v_updated_count INT := 0;
BEGIN
  -- 1. CONTRÔLES FAIL-FAST : Résolution de l'établissement ciblé
  SELECT id, name INTO v_school_id, v_school_name
  FROM public.schools
  WHERE slug = 'complexe-scolaire-les-petits-anges';

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Fail-fast : Établissement avec le slug "complexe-scolaire-les-petits-anges" introuvable.';
  END IF;

  -- 2. CONTRÔLES FAIL-FAST : Résolution de l'année scolaire active/courante
  SELECT id INTO v_academic_year_id
  FROM public.academic_years
  WHERE school_id = v_school_id
  ORDER BY is_current DESC, starts_on DESC
  LIMIT 1;

  IF v_academic_year_id IS NULL THEN
    RAISE EXCEPTION 'Fail-fast : Aucune année scolaire trouvée pour l’établissement %.', v_school_name;
  END IF;

  -- 3. CONTRÔLES FAIL-FAST : Résolution de la classe 1A et vérification de son cycle actuel
  SELECT id, education_cycle INTO v_class_1a_id, v_class_1a_cycle
  FROM public.classes
  WHERE school_id = v_school_id
    AND academic_year_id = v_academic_year_id
    AND name = '1A';

  IF v_class_1a_id IS NULL THEN
    RAISE EXCEPTION 'Fail-fast : Classe 1A introuvable pour l’année scolaire courante dans %.', v_school_name;
  END IF;

  IF v_class_1a_cycle IS NOT NULL THEN
    RAISE EXCEPTION 'Fail-fast : La classe 1A possède déjà education_cycle = "%". La migration attend education_cycle IS NULL.', v_class_1a_cycle;
  END IF;

  -- 4. CONTRÔLES FAIL-FAST : Résolution du 1er Semestre secondaire
  SELECT id, name INTO v_new_term_id, v_new_term_name
  FROM public.school_terms
  WHERE school_id = v_school_id
    AND academic_year_id = v_academic_year_id
    AND position = 1
    AND education_cycle = 'secondary'
    AND division_type = 'semester';

  IF v_new_term_id IS NULL THEN
    RAISE EXCEPTION 'Fail-fast : Le 1er Semestre secondaire (position 1, secondary, semester) est introuvable pour %.', v_school_name;
  END IF;

  -- 5. CONTRÔLES FAIL-FAST : Vérification du nombre exact d'évaluations incompatibles
  SELECT COUNT(*) INTO v_asmt_count
  FROM public.school_assessments sa
  JOIN public.school_terms st ON st.id = sa.term_id
  WHERE sa.school_id = v_school_id
    AND sa.academic_year_id = v_academic_year_id
    AND sa.class_id = v_class_1a_id
    AND st.education_cycle = 'primary'
    AND st.division_type = 'trimester';

  IF v_asmt_count <> 2 THEN
    RAISE EXCEPTION 'Fail-fast : Attendu exactement 2 évaluations pour la classe 1A liées à un trimestre primaire, trouvé : %.', v_asmt_count;
  END IF;

  -- 6. VERROUILLAGE, RÉALIGNEMENT CIBLÉ ET AUDIT TRANSACTIONNEL
  FOR v_asmt_record IN (
    SELECT sa.id AS asmt_id, sa.title AS asmt_title, sa.status AS asmt_status, sa.term_id AS old_term_id, st.name AS old_term_name
    FROM public.school_assessments sa
    JOIN public.school_terms st ON st.id = sa.term_id
    WHERE sa.school_id = v_school_id
      AND sa.academic_year_id = v_academic_year_id
      AND sa.class_id = v_class_1a_id
      AND st.education_cycle = 'primary'
      AND st.division_type = 'trimester'
    FOR UPDATE OF sa
  ) LOOP
    -- Mise à jour stricte du term_id
    UPDATE public.school_assessments
    SET term_id = v_new_term_id,
        updated_at = now()
    WHERE id = v_asmt_record.asmt_id
      AND school_id = v_school_id
      AND academic_year_id = v_academic_year_id
      AND class_id = v_class_1a_id
      AND term_id = v_asmt_record.old_term_id;

    v_updated_count := v_updated_count + 1;

    -- Enregistrement d'audit pour chaque évaluation réalignée
    INSERT INTO public.school_audit_logs (
      school_id,
      actor_id,
      action,
      details
    ) VALUES (
      v_school_id,
      NULL,
      'assessment_term_reclassified_for_secondary_cycle',
      jsonb_build_object(
        'system_migration', true,
        'migration', '20260818080000_realign_secondary_class_assessment_terms',
        'entity_type', 'school_assessment',
        'entity_id', v_asmt_record.asmt_id,
        'assessment_id', v_asmt_record.asmt_id,
        'assessment_title', v_asmt_record.asmt_title,
        'assessment_status', v_asmt_record.asmt_status,
        'class_id', v_class_1a_id,
        'class_name', '1A',
        'old_term_id', v_asmt_record.old_term_id,
        'old_term_name', v_asmt_record.old_term_name,
        'old_cycle', 'primary',
        'new_term_id', v_new_term_id,
        'new_term_name', v_new_term_name,
        'new_cycle', 'secondary',
        'reason', 'Correction du rattachement académique avant affectation de la classe 1A au cycle secondaire'
      )
    );
  END LOOP;

  -- 7. CONTRÔLE FINAL D'EXÉCUTION
  IF v_updated_count <> 2 THEN
    RAISE EXCEPTION 'Erreur d’intégrité : L’UPDATE devait affecter exactement 2 évaluations, mais % lignes ont été modifiées.', v_updated_count;
  END IF;

  RAISE NOTICE 'Succès : Les 2 évaluations de la classe 1A ont été réalignées vers le 1er Semestre secondaire (% -> %).', v_school_name, v_new_term_name;
END $$;

COMMIT;
