-- Migration SQL : Réparation Idempotente des Inscriptions Élèves Manquantes (Phase 2B Fix)
-- Fichier : supabase/migrations/20260813100000_repair_missing_student_enrollments.sql

BEGIN;

-- Backfill des inscriptions manquantes pour les élèves ayant un class_id valide
DO $$
DECLARE
  v_inserted_count INTEGER := 0;
BEGIN
  WITH new_enrollments AS (
    INSERT INTO public.student_enrollments (
      school_id,
      student_id,
      academic_year_id,
      class_id,
      status,
      enrolled_on,
      created_at,
      updated_at
    )
    SELECT
      s.school_id,
      s.id AS student_id,
      c.academic_year_id,
      c.id AS class_id,
      'active' AS status,
      COALESCE(s.admission_date, CURRENT_DATE) AS enrolled_on,
      now() AS created_at,
      now() AS updated_at
    FROM public.students s
    JOIN public.classes c ON c.id = s.class_id AND c.school_id = s.school_id
    WHERE s.class_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 
        FROM public.student_enrollments se 
        WHERE se.student_id = s.id 
          AND se.academic_year_id = c.academic_year_id
          AND se.status = 'active'
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted_count FROM new_enrollments;

  RAISE NOTICE 'Migration Réparation 2B : % inscription(s) élève(s) créée(s) dans student_enrollments.', v_inserted_count;
END $$;

COMMIT;
