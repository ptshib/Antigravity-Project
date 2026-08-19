-- Migration Corrective Phase 2D.2 : Correction du Workflow Évaluation (Brouillon -> Saisie Notes -> Contrôle -> Publication)
-- Fichier : supabase/migrations/20260817210000_fix_assessment_grading_workflow.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. CORRECTION DE CREATE_TEACHER_ASSESSMENT (CRÉATION STRICTE EN STATUT DRAFT)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_teacher_assessment(
  p_class_id UUID,
  p_subject_id UUID,
  p_term_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_assessment_type TEXT,
  p_assessment_date DATE,
  p_max_score NUMERIC,
  p_coefficient NUMERIC DEFAULT 1,
  p_publish_now BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_is_active BOOLEAN;
  v_school_status TEXT;
  v_teacher_id UUID;
  v_teacher_acc TEXT;
  v_teacher_emp TEXT;
  v_year_id UUID;
  v_year_starts DATE;
  v_year_ends DATE;
  v_term_starts DATE;
  v_term_ends DATE;
  v_has_assign BOOLEAN;
  v_subject_active BOOLEAN;
  v_assessment_id UUID;
  v_status TEXT := 'draft';
  v_published_at TIMESTAMPTZ := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_role, v_school_id, v_is_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  -- Création réservée exclusivement au rôle teacher
  IF v_role <> 'teacher' THEN
    RAISE EXCEPTION 'Accès refusé : Seul un enseignant actif peut initier une évaluation pédagogique.';
  END IF;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil enseignant.';
  END IF;

  SELECT sc.status INTO v_school_status
  FROM public.schools sc
  WHERE sc.id = v_school_id;

  IF v_school_status IS NULL OR v_school_status <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
  END IF;

  -- Vérification stricte du dossier enseignant
  SELECT t.id, t.account_status, t.employment_status
  INTO v_teacher_id, v_teacher_acc, v_teacher_emp
  FROM public.teachers t
  WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

  IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
    RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
  END IF;

  -- Interdiction formelle de publier directement à la création
  IF p_publish_now IS TRUE THEN
    RAISE EXCEPTION 'Création directe en statut publié interdite : Une évaluation doit obligatoirement être créée en brouillon et ses notes saisies avant publication.';
  END IF;

  -- Validation des paramètres
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le titre ne peut pas être vide.';
  END IF;

  IF p_max_score IS NULL OR p_max_score <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le barème maximal doit être supérieur à zéro.';
  END IF;

  IF p_coefficient IS NOT NULL AND p_coefficient <= 0 THEN
    RAISE EXCEPTION 'Paramètre invalide : Le coefficient doit être supérieur à zéro.';
  END IF;

  IF p_assessment_type NOT IN ('quiz', 'test', 'exam', 'homework', 'project', 'oral', 'practical', 'other') THEN
    RAISE EXCEPTION 'Paramètre invalide : Type d’évaluation non reconnu.';
  END IF;

  -- Validation de la classe et de l'année scolaire
  SELECT c.academic_year_id INTO v_year_id
  FROM public.classes c
  WHERE c.id = p_class_id AND c.school_id = v_school_id;

  IF v_year_id IS NULL THEN
    RAISE EXCEPTION 'Classe introuvable dans votre établissement.';
  END IF;

  -- Validation de la matière
  SELECT sb.is_active INTO v_subject_active
  FROM public.subjects sb
  WHERE sb.id = p_subject_id AND sb.school_id = v_school_id;

  IF v_subject_active IS NULL THEN
    RAISE EXCEPTION 'Matière introuvable dans votre établissement.';
  END IF;

  IF v_subject_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Matière inactive : Impossible de créer une évaluation pour une matière désactivée.';
  END IF;

  -- Validation des dates avec l'année scolaire
  SELECT ay.starts_on, ay.ends_on INTO v_year_starts, v_year_ends
  FROM public.academic_years ay
  WHERE ay.id = v_year_id AND ay.school_id = v_school_id;

  IF v_year_starts IS NOT NULL AND v_year_ends IS NOT NULL THEN
    IF p_assessment_date < v_year_starts OR p_assessment_date > v_year_ends THEN
      RAISE EXCEPTION 'Date d’évaluation hors de l’année scolaire en cours (% à %).', v_year_starts, v_year_ends;
    END IF;
  END IF;

  -- Validation du trimestre / période si spécifié
  IF p_term_id IS NOT NULL THEN
    SELECT st.starts_on, st.ends_on INTO v_term_starts, v_term_ends
    FROM public.school_terms st
    WHERE st.id = p_term_id AND st.school_id = v_school_id AND st.academic_year_id = v_year_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Période/Trimestre invalide pour cette année scolaire.';
    END IF;

    IF v_term_starts IS NOT NULL AND p_assessment_date < v_term_starts THEN
      RAISE EXCEPTION 'Date d’évaluation antérieure au début de la période/trimestre sélectionné (%).', v_term_starts;
    END IF;

    IF v_term_ends IS NOT NULL AND p_assessment_date > v_term_ends THEN
      RAISE EXCEPTION 'Date d’évaluation postérieure à la fin de la période/trimestre sélectionné (%).', v_term_ends;
    END IF;
  END IF;

  -- Vérification stricte de l'affectation active de l'enseignant
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_class_assignments tca
    WHERE tca.school_id = v_school_id
      AND tca.teacher_id = v_teacher_id
      AND tca.class_id = p_class_id
      AND tca.subject_id = p_subject_id
      AND tca.academic_year_id = v_year_id
      AND tca.is_active = true
  ) INTO v_has_assign;

  IF NOT v_has_assign THEN
    RAISE EXCEPTION 'Affectation non autorisée : Vous n’êtes pas affecté à cette classe et matière pour l’année active.';
  END IF;

  -- Insertion garantie en statut 'draft'
  v_status := 'draft';
  v_published_at := NULL;

  INSERT INTO public.school_assessments (
    school_id,
    academic_year_id,
    term_id,
    class_id,
    subject_id,
    teacher_id,
    title,
    description,
    assessment_type,
    assessment_date,
    max_score,
    coefficient,
    status,
    published_at,
    created_by
  ) VALUES (
    v_school_id,
    v_year_id,
    p_term_id,
    p_class_id,
    p_subject_id,
    v_teacher_id,
    trim(p_title),
    p_description,
    p_assessment_type,
    p_assessment_date,
    p_max_score,
    COALESCE(p_coefficient, 1),
    v_status,
    v_published_at,
    v_uid
  ) RETURNING id INTO v_assessment_id;

  -- Journalisation d'audit
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_school_id,
    v_uid,
    'assessment_created',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', v_assessment_id,
      'assessment_id', v_assessment_id,
      'title', trim(p_title),
      'class_id', p_class_id,
      'subject_id', p_subject_id,
      'teacher_id', v_teacher_id,
      'status', v_status,
      'max_score', p_max_score,
      'coefficient', COALESCE(p_coefficient, 1)
    )
  );

  RETURN v_assessment_id;
END;
$$;

--------------------------------------------------------------------------------
-- 2. CORRECTION DE PUBLISH_TEACHER_ASSESSMENT (CONTRÔLE TOTAL DES NOTES)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.publish_teacher_assessment(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_school_id UUID;
  v_is_active BOOLEAN;
  v_school_status TEXT;
  v_teacher_id UUID;
  v_teacher_acc TEXT;
  v_teacher_emp TEXT;
  v_asmt RECORD;
  v_active_students_count INTEGER := 0;
  v_unprocessed_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : Utilisateur non authentifié.';
  END IF;

  SELECT p.role, p.school_id, p.is_active
  INTO v_role, v_school_id, v_is_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS NULL OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Accès refusé : Profil utilisateur inactif ou introuvable.';
  END IF;

  IF v_role NOT IN ('teacher', 'school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Accès refusé : Rôle non autorisé.';
  END IF;

  -- Vérification établissement pour teacher et school_admin
  IF v_role IN ('teacher', 'school_admin') THEN
    IF v_school_id IS NULL THEN
      RAISE EXCEPTION 'Accès refusé : Aucun établissement rattaché à votre profil.';
    END IF;

    SELECT sc.status INTO v_school_status
    FROM public.schools sc
    WHERE sc.id = v_school_id;

    IF v_school_status IS NULL OR v_school_status <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : L’établissement est inactif ou suspendu.';
    END IF;
  END IF;

  SELECT * INTO v_asmt
  FROM public.school_assessments sa
  WHERE sa.id = p_assessment_id
  FOR UPDATE;

  IF v_asmt.id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  IF v_role IN ('teacher', 'school_admin') AND v_asmt.school_id <> v_school_id THEN
    RAISE EXCEPTION 'Accès refusé : Évaluation d’un autre établissement.';
  END IF;

  -- Machine d'états stricte : Seuls draft et reopened peuvent être publiés
  IF v_asmt.status = 'published' THEN
    RAISE EXCEPTION 'Transition invalide : L’évaluation est déjà publiée.';
  END IF;
  IF v_asmt.status = 'closed' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation clôturée ne peut pas être publiée directement. Réouverture requise.';
  END IF;
  IF v_asmt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Transition invalide : Une évaluation annulée ne peut pas être publiée.';
  END IF;
  IF v_asmt.status NOT IN ('draft', 'reopened') THEN
    RAISE EXCEPTION 'Transition invalide : Statut actuel incompatible avec la publication.';
  END IF;

  -- Contrôle des droits enseignant
  IF v_role = 'teacher' THEN
    SELECT t.id, t.account_status, t.employment_status
    INTO v_teacher_id, v_teacher_acc, v_teacher_emp
    FROM public.teachers t
    WHERE t.profile_id = v_uid AND t.school_id = v_school_id;

    IF v_teacher_id IS NULL OR v_teacher_acc <> 'active' OR v_teacher_emp <> 'active' THEN
      RAISE EXCEPTION 'Accès refusé : Votre compte ou contrat enseignant n’est pas actif.';
    END IF;

    IF v_asmt.teacher_id <> v_teacher_id THEN
      RAISE EXCEPTION 'Accès refusé : Seul l’enseignant titulaire actif peut publier cette évaluation.';
    END IF;
  END IF;

  -- 1. Contrôle : Au moins une inscription active doit exister dans la classe
  SELECT COUNT(*) INTO v_active_students_count
  FROM public.student_enrollments se
  WHERE se.school_id = v_asmt.school_id
    AND se.class_id = v_asmt.class_id
    AND se.academic_year_id = v_asmt.academic_year_id
    AND se.status = 'active';

  IF v_active_students_count = 0 THEN
    RAISE EXCEPTION 'Publication impossible : Aucun élève activement inscrit dans cette classe pour cette année scolaire.';
  END IF;

  -- 2. Contrôle d'exhaustivité : chaque élève actif doit avoir une note saisie ou être marqué absent
  SELECT COUNT(*) INTO v_unprocessed_count
  FROM public.student_enrollments se
  LEFT JOIN public.student_grades sg 
    ON sg.enrollment_id = se.id 
   AND sg.assessment_id = p_assessment_id
   AND sg.student_id = se.student_id
   AND sg.school_id = v_asmt.school_id
  WHERE se.school_id = v_asmt.school_id
    AND se.class_id = v_asmt.class_id
    AND se.academic_year_id = v_asmt.academic_year_id
    AND se.status = 'active'
    AND (
      sg.id IS NULL
      OR (
        (sg.is_absent IS NOT TRUE AND (sg.score IS NULL OR sg.score < 0 OR sg.score > v_asmt.max_score))
        OR (sg.is_absent IS TRUE AND sg.score IS NOT NULL)
      )
    );

  IF v_unprocessed_count > 0 THEN
    RAISE EXCEPTION 'Publication impossible : Il reste % élève(s) non noté(s) ou dont la saisie est incomplète avant publication.', v_unprocessed_count;
  END IF;

  -- Mise à jour du statut vers 'published'
  UPDATE public.school_assessments sa
  SET
    status = 'published',
    published_at = COALESCE(v_asmt.published_at, now())
  WHERE sa.id = p_assessment_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_asmt.school_id,
    v_uid,
    'assessment_published',
    jsonb_build_object(
      'entity_type', 'school_assessment',
      'entity_id', p_assessment_id,
      'assessment_id', p_assessment_id,
      'old_status', v_asmt.status,
      'new_status', 'published'
    )
  );

  RETURN true;
END;
$$;

--------------------------------------------------------------------------------
-- 3. PERMISSIONS ET PRIVILÈGES
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_teacher_assessment(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_teacher_assessment(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.publish_teacher_assessment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_teacher_assessment(UUID) TO authenticated;

COMMIT;
