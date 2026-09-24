-- Migration : 20260924223500_fix_school_homework_integrity_trigger_for_effective_subjects.sql
-- Description : Correction de check_school_homework_integrity pour s'aligner sur get_effective_class_subjects

CREATE OR REPLACE FUNCTION public.check_school_homework_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tch_school_id UUID;
  v_tch_emp_status TEXT;
  v_tch_acc_status TEXT;
  v_tch_profile_id UUID;
  v_cls_school_id UUID;
  v_cls_year_id UUID;
  v_cls_pedagogical_mode TEXT;
  v_cls_homeroom_teacher_id UUID;
  v_year_school_id UUID;
  v_sbj_school_id UUID;
  v_term_school_id UUID;
  v_term_year_id UUID;
  v_has_active_assignment BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT school_id INTO v_year_school_id
    FROM public.academic_years
    WHERE id = NEW.academic_year_id;

    IF v_year_school_id IS NULL OR v_year_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id;
    END IF;

    IF NEW.term_id IS NOT NULL THEN
      SELECT school_id, academic_year_id INTO v_term_school_id, v_term_year_id
      FROM public.school_terms
      WHERE id = NEW.term_id;

      IF v_term_school_id IS NULL OR v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : Le trimestre (%) n’appartient pas à la même école ou année scolaire.', NEW.term_id;
      END IF;
    END IF;

    SELECT school_id, academic_year_id, coalesce(pedagogical_mode, 'secondary_subjects'), homeroom_teacher_id
    INTO v_cls_school_id, v_cls_year_id, v_cls_pedagogical_mode, v_cls_homeroom_teacher_id
    FROM public.classes
    WHERE id = NEW.class_id;

    IF v_cls_school_id IS NULL OR v_cls_school_id <> NEW.school_id OR v_cls_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La classe (%) n’appartient pas à la même école ou année scolaire.', NEW.class_id;
    END IF;

    SELECT school_id INTO v_sbj_school_id
    FROM public.subjects
    WHERE id = NEW.subject_id;

    IF v_sbj_school_id IS NULL OR v_sbj_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : La matière (%) n’appartient pas à l’établissement.', NEW.subject_id;
    END IF;

    SELECT school_id, employment_status, account_status, profile_id
    INTO v_tch_school_id, v_tch_emp_status, v_tch_acc_status, v_tch_profile_id
    FROM public.teachers
    WHERE id = NEW.teacher_id;

    IF v_tch_school_id IS NULL OR v_tch_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'Incohérence multi-écoles : L’enseignant (%) n’appartient pas à cet établissement.', NEW.teacher_id;
    END IF;

    IF v_tch_emp_status <> 'active' OR v_tch_acc_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Le dossier de l’enseignant n’est pas actif.';
    END IF;

    -- Alignement direct sur get_effective_class_subjects
    IF NOT EXISTS (
      SELECT 1 FROM public.get_effective_class_subjects(NEW.class_id, NEW.academic_year_id) e
      WHERE e.subject_id = NEW.subject_id
    ) THEN
      RAISE EXCEPTION 'Accès refusé : Cette matière n’est pas configurée ou est désactivée pour cette classe.';
    END IF;

    IF v_cls_pedagogical_mode = 'primary_homeroom' THEN
      IF v_cls_homeroom_teacher_id IS NULL OR v_cls_homeroom_teacher_id <> v_tch_profile_id THEN
        RAISE EXCEPTION 'Accès refusé : L’enseignant n’est pas le titulaire de cette classe primaire.';
      END IF;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.teacher_class_assignments
        WHERE teacher_id = NEW.teacher_id
          AND class_id = NEW.class_id
          AND subject_id = NEW.subject_id
          AND academic_year_id = NEW.academic_year_id
          AND school_id = NEW.school_id
          AND is_active = true
      ) INTO v_has_active_assignment;

      IF NOT v_has_active_assignment THEN
        RAISE EXCEPTION 'Accès refusé : Aucune affectation active trouvée pour cet enseignant, cette classe et cette matière.';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ school_id est immuable.';
    END IF;
    IF OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ academic_year_id est immuable.';
    END IF;
    IF OLD.class_id IS DISTINCT FROM NEW.class_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ class_id est immuable.';
    END IF;
    IF OLD.subject_id IS DISTINCT FROM NEW.subject_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ subject_id est immuable.';
    END IF;
    IF OLD.teacher_id IS DISTINCT FROM NEW.teacher_id THEN
      RAISE EXCEPTION 'Modification interdite : Le champ teacher_id est immuable.';
    END IF;
    IF OLD.created_by IS DISTINCT FROM NEW.created_by THEN
      RAISE EXCEPTION 'Modification interdite : Le champ created_by est immuable.';
    END IF;

    IF NEW.term_id IS NOT NULL AND OLD.term_id IS DISTINCT FROM NEW.term_id THEN
      SELECT school_id, academic_year_id INTO v_term_school_id, v_term_year_id
      FROM public.school_terms
      WHERE id = NEW.term_id;

      IF v_term_school_id IS NULL OR v_term_school_id <> NEW.school_id OR v_term_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'Incohérence multi-écoles : Le trimestre (%) n’appartient pas à la même école ou année scolaire.', NEW.term_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_school_homework_integrity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_school_homework_integrity() TO authenticated;
ALTER FUNCTION public.check_school_homework_integrity() OWNER TO postgres;
