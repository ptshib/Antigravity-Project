-- Migration Lot 2D Extension : Prise en charge des créneaux de Pause / Récréation
-- Fichier : supabase/migrations/20260922172000_timetable_break_slots.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION DU SCHÉMA DE PUBLIC.SCHOOL_TIMETABLES
--------------------------------------------------------------------------------

-- Ajout des colonnes slot_type et label
ALTER TABLE public.school_timetables
  ADD COLUMN IF NOT EXISTS slot_type TEXT NOT NULL DEFAULT 'course',
  ADD COLUMN IF NOT EXISTS label TEXT NULL;

-- Rendre subject_id nullable pour permettre les pauses sans matière
ALTER TABLE public.school_timetables 
  ALTER COLUMN subject_id DROP NOT NULL;

-- Contrainte d'énumération des types de créneau autorisés
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_school_timetables_slot_type'
  ) THEN
    ALTER TABLE public.school_timetables
      ADD CONSTRAINT check_school_timetables_slot_type CHECK (slot_type IN ('course', 'break'));
  END IF;
END $$;

-- Contrainte de cohérence selon le type de créneau (cours vs pause)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_school_timetables_slot_type_rules'
  ) THEN
    ALTER TABLE public.school_timetables
      ADD CONSTRAINT check_school_timetables_slot_type_rules CHECK (
        (slot_type = 'course' AND subject_id IS NOT NULL)
        OR
        (slot_type = 'break' AND subject_id IS NULL AND teacher_id IS NULL AND label IS NOT NULL AND length(trim(label)) > 0)
      );
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 2. MISE À JOUR DU TRIGGER D'INTÉGRITÉ MULTI-ÉCOLES
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_school_timetable_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_year_school_id UUID;
  v_cls_school_id UUID;
  v_cls_year_id UUID;
  v_sbj_school_id UUID;
  v_tch_school_id UUID;
BEGIN
  -- A. Vérifier que l'année scolaire appartient à l'école
  SELECT school_id INTO v_year_school_id
  FROM public.academic_years
  WHERE id = NEW.academic_year_id;

  IF v_year_school_id IS NULL OR v_year_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : L’année scolaire (%) n’appartient pas à l’établissement (%).', NEW.academic_year_id, NEW.school_id
      USING ERRCODE = '42501';
  END IF;

  -- B. Vérifier que la classe appartient à l'école et à la même année scolaire
  SELECT school_id, academic_year_id INTO v_cls_school_id, v_cls_year_id
  FROM public.classes
  WHERE id = NEW.class_id;

  IF v_cls_school_id IS NULL OR v_cls_school_id <> NEW.school_id OR v_cls_year_id <> NEW.academic_year_id THEN
    RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : La classe (%) n’appartient pas à la même école ou année scolaire.', NEW.class_id
      USING ERRCODE = '42501';
  END IF;

  -- C. Si la matière est renseignée (cours), vérifier qu'elle appartient à l'école
  IF NEW.subject_id IS NOT NULL THEN
    SELECT school_id INTO v_sbj_school_id
    FROM public.subjects
    WHERE id = NEW.subject_id;

    IF v_sbj_school_id IS NULL OR v_sbj_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : La matière (%) n’appartient pas à l’établissement.', NEW.subject_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- D. Si un enseignant est spécifié, vérifier qu'il appartient à l'école
  IF NEW.teacher_id IS NOT NULL THEN
    SELECT school_id INTO v_tch_school_id
    FROM public.teachers
    WHERE id = NEW.teacher_id;

    IF v_tch_school_id IS NULL OR v_tch_school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'INCOHÉRENCE MULTI-ÉCOLES : L’enseignant (%) n’appartient pas à l’établissement.', NEW.teacher_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- 3. RPC ADMINISTRATIVE : GET_ADMIN_CLASS_TIMETABLE (AVEC PAUSES)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_class_timetable(
  p_class_id UUID,
  p_academic_year_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_class RECORD;
  v_slots JSONB;
  v_total_slots INT := 0;
  v_active_slots INT := 0;
  v_inactive_slots INT := 0;
  v_cancelled_slots INT := 0;
  v_total_days INT := 0;
  v_target_year_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role
  INTO v_caller_school_id, v_caller_role
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL OR v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur d’établissement actif peut accéder à cette vue.'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.name, c.academic_year_id, c.school_id, ay.name AS academic_year_name
  INTO v_class
  FROM public.classes c
  LEFT JOIN public.academic_years ay ON ay.id = c.academic_year_id
  WHERE c.id = p_class_id
    AND c.school_id = v_caller_school_id;

  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Classe introuvable ou non rattachée à votre établissement.'
      USING ERRCODE = '42501';
  END IF;

  v_target_year_id := COALESCE(p_academic_year_id, v_class.academic_year_id);

  SELECT 
    pg_catalog.count(t.id),
    pg_catalog.count(t.id) FILTER (WHERE t.status = 'active'),
    pg_catalog.count(t.id) FILTER (WHERE t.status = 'inactive'),
    pg_catalog.count(t.id) FILTER (WHERE t.status = 'cancelled'),
    pg_catalog.count(DISTINCT t.day_of_week) FILTER (WHERE t.status = 'active')
  INTO 
    v_total_slots,
    v_active_slots,
    v_inactive_slots,
    v_cancelled_slots,
    v_total_days
  FROM public.school_timetables t
  WHERE t.school_id = v_caller_school_id
    AND t.class_id = p_class_id
    AND (v_target_year_id IS NULL OR t.academic_year_id = v_target_year_id);

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', t.id,
      'slot_type', COALESCE(t.slot_type, 'course'),
      'label', t.label,
      'day_of_week', t.day_of_week,
      'day_name', CASE t.day_of_week
        WHEN 1 THEN 'Lundi'
        WHEN 2 THEN 'Mardi'
        WHEN 3 THEN 'Mercredi'
        WHEN 4 THEN 'Jeudi'
        WHEN 5 THEN 'Vendredi'
        WHEN 6 THEN 'Samedi'
        WHEN 7 THEN 'Dimanche'
        ELSE 'Inconnu'
      END,
      'subject_id', t.subject_id,
      'subject_name', CASE 
        WHEN t.slot_type = 'break' THEN COALESCE(t.label, 'Pause')
        ELSE COALESCE(s.name, 'Matière supprimée')
      END,
      'subject_code', s.code,
      'teacher_id', t.teacher_id,
      'teacher_name', CASE
        WHEN t.slot_type = 'break' THEN NULL
        WHEN tp.id IS NOT NULL THEN (tp.first_name || ' ' || tp.last_name)
        ELSE NULL
      END,
      'room', t.room,
      'start_time', pg_catalog.to_char(t.start_time, 'HH24:MI'),
      'end_time', pg_catalog.to_char(t.end_time, 'HH24:MI'),
      'status', t.status,
      'created_at', t.created_at,
      'updated_at', t.updated_at
    ) ORDER BY t.day_of_week ASC, t.start_time ASC
  ), '[]'::jsonb)
  INTO v_slots
  FROM public.school_timetables t
  LEFT JOIN public.subjects s ON s.id = t.subject_id
  LEFT JOIN public.teachers te ON te.id = t.teacher_id
  LEFT JOIN public.profiles tp ON tp.id = te.profile_id
  WHERE t.school_id = v_caller_school_id
    AND t.class_id = p_class_id
    AND (v_target_year_id IS NULL OR t.academic_year_id = v_target_year_id);

  RETURN pg_catalog.jsonb_build_object(
    'school_id', v_caller_school_id,
    'academic_year', pg_catalog.jsonb_build_object(
      'id', v_target_year_id,
      'name', v_class.academic_year_name
    ),
    'class', pg_catalog.jsonb_build_object(
      'id', v_class.id,
      'name', v_class.name
    ),
    'summary', pg_catalog.jsonb_build_object(
      'total_slots', v_total_slots,
      'active_slots', v_active_slots,
      'inactive_slots', v_inactive_slots,
      'cancelled_slots', v_cancelled_slots,
      'total_days', v_total_days
    ),
    'slots', v_slots
  );
END;
$$;

--------------------------------------------------------------------------------
-- 4. PURGE DYNAMIQUE SÉCURISÉE DES ANCIENNES SURCHARGES RPC (SANS CASCADE)
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_function_signature TEXT;
BEGIN
  FOR v_function_signature IN
    SELECT pg_catalog.format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_catalog.oidvectortypes(p.proargtypes)
    )
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_school_timetable_slot',
        'update_school_timetable_slot'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function_signature
    );

    EXECUTE pg_catalog.format(
      'DROP FUNCTION %s',
      v_function_signature
    );
  END LOOP;
END;
$$;

--------------------------------------------------------------------------------
-- 5. RPC ADMINISTRATIVE : CREATE_SCHOOL_TIMETABLE_SLOT (AVEC PAUSES)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_school_timetable_slot(
  p_class_id UUID,
  p_academic_year_id UUID,
  p_day_of_week INT,
  p_start_time TIME,
  p_end_time TIME,
  p_subject_id UUID DEFAULT NULL,
  p_teacher_id UUID DEFAULT NULL,
  p_room TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'inactive',
  p_slot_type TEXT DEFAULT 'course',
  p_label TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_room TEXT;
  v_status TEXT;
  v_slot_type TEXT;
  v_label TEXT;
  v_subject_id UUID;
  v_teacher_id UUID;
  v_inserted_id UUID;
  v_inserted_record JSONB;
  v_conflict_count INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role
  INTO v_caller_school_id, v_caller_role
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL OR v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur d’établissement actif peut créer un créneau.'
      USING ERRCODE = '42501';
  END IF;

  -- Normalisation & validation basique
  v_slot_type := LOWER(TRIM(COALESCE(p_slot_type, 'course')));
  IF v_slot_type NOT IN ('course', 'break') THEN
    RAISE EXCEPTION 'VALEUR INVALIDE : Le type de créneau doit être course ou break.' USING ERRCODE = '22023';
  END IF;

  v_status := LOWER(TRIM(COALESCE(p_status, 'inactive')));
  IF v_status NOT IN ('inactive', 'active') THEN
    RAISE EXCEPTION 'STATUT INVALIDE : Un nouveau créneau ne peut être que inactif ou actif.' USING ERRCODE = '22023';
  END IF;

  IF p_day_of_week NOT BETWEEN 1 AND 7 THEN
    RAISE EXCEPTION 'JOUR INVALIDE : Le jour doit être compris entre 1 (Lundi) et 7 (Dimanche).' USING ERRCODE = '22023';
  END IF;

  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'HORAIRES INVALIDES : L’heure de début (%) doit être antérieure à l’heure de fin (%).', p_start_time, p_end_time
      USING ERRCODE = '22023';
  END IF;

  v_room := NULLIF(TRIM(p_room), '');

  -- Validation spécifique selon slot_type
  IF v_slot_type = 'break' THEN
    v_subject_id := NULL;
    v_teacher_id := NULL;
    v_label := NULLIF(TRIM(p_label), '');
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'LIBELLÉ OBLIGATOIRE : Un libellé est requis pour un créneau de pause/récréation.' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- slot_type = 'course'
    v_subject_id := p_subject_id;
    v_teacher_id := p_teacher_id;
    v_label := NULLIF(TRIM(p_label), '');
    IF v_subject_id IS NULL THEN
      RAISE EXCEPTION 'MATIÈRE OBLIGATOIRE : Une matière est requise pour un cours.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Verrou transactionnel advisory pour prévenir les courses concurrentes
  PERFORM pg_advisory_xact_lock(hashtext(v_caller_school_id::text || p_academic_year_id::text || p_day_of_week::text));

  -- Détection atomique des conflits (si statut actif)
  IF v_status = 'active' THEN
    -- 1. Conflit de classe (chevauchement avec tout cours ou pause actif dans la même classe)
    SELECT COUNT(*) INTO v_conflict_count
    FROM public.school_timetables t
    WHERE t.school_id = v_caller_school_id
      AND t.academic_year_id = p_academic_year_id
      AND t.class_id = p_class_id
      AND t.day_of_week = p_day_of_week
      AND t.status = 'active'
      AND (t.start_time < p_end_time AND t.end_time > p_start_time);

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'TIMETABLE_CLASS_CONFLICT : La classe a déjà un créneau actif en chevauchement horaire.'
        USING ERRCODE = '23505';
    END IF;

    -- 2. Conflit d'enseignant (seulement pour un cours avec enseignant)
    IF v_slot_type = 'course' AND v_teacher_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.school_timetables t
      WHERE t.school_id = v_caller_school_id
        AND t.day_of_week = p_day_of_week
        AND t.teacher_id = v_teacher_id
        AND t.status = 'active'
        AND (t.start_time < p_end_time AND t.end_time > p_start_time);

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'TIMETABLE_TEACHER_CONFLICT : L’enseignant est déjà assigné à un autre créneau actif en chevauchement.'
          USING ERRCODE = '23505';
      END IF;
    END IF;

    -- 3. Conflit de salle (si renseignée)
    IF v_room IS NOT NULL THEN
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.school_timetables t
      WHERE t.school_id = v_caller_school_id
        AND t.day_of_week = p_day_of_week
        AND t.status = 'active'
        AND LOWER(TRIM(t.room)) = LOWER(TRIM(v_room))
        AND (t.start_time < p_end_time AND t.end_time > p_start_time);

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'TIMETABLE_ROOM_CONFLICT : La salle "%" est déjà occupée sur ce créneau horaire.', v_room
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- Insertion du créneau
  INSERT INTO public.school_timetables (
    school_id,
    academic_year_id,
    class_id,
    subject_id,
    teacher_id,
    room,
    day_of_week,
    start_time,
    end_time,
    status,
    slot_type,
    label,
    created_by
  ) VALUES (
    v_caller_school_id,
    p_academic_year_id,
    p_class_id,
    v_subject_id,
    v_teacher_id,
    v_room,
    p_day_of_week,
    p_start_time,
    p_end_time,
    v_status,
    v_slot_type,
    v_label,
    v_caller_id
  ) RETURNING id INTO v_inserted_id;

  -- Traçabilité audit
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_caller_school_id,
    v_caller_id,
    'TIMETABLE_SLOT_CREATED',
    pg_catalog.jsonb_build_object(
      'slot_id', v_inserted_id,
      'class_id', p_class_id,
      'academic_year_id', p_academic_year_id,
      'slot_type', v_slot_type,
      'label', v_label,
      'day_of_week', p_day_of_week,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'subject_id', v_subject_id,
      'teacher_id', v_teacher_id,
      'room', v_room,
      'status', v_status
    )
  );

  SELECT public.get_admin_class_timetable(p_class_id, p_academic_year_id) INTO v_inserted_record;
  RETURN v_inserted_record;
END;
$$;

--------------------------------------------------------------------------------
-- 6. RPC ADMINISTRATIVE : UPDATE_SCHOOL_TIMETABLE_SLOT (AVEC PAUSES)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_school_timetable_slot(
  p_slot_id UUID,
  p_day_of_week INT,
  p_start_time TIME,
  p_end_time TIME,
  p_subject_id UUID DEFAULT NULL,
  p_teacher_id UUID DEFAULT NULL,
  p_room TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'inactive',
  p_slot_type TEXT DEFAULT 'course',
  p_label TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_existing RECORD;
  v_room TEXT;
  v_status TEXT;
  v_slot_type TEXT;
  v_label TEXT;
  v_subject_id UUID;
  v_teacher_id UUID;
  v_conflict_count INT;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role
  INTO v_caller_school_id, v_caller_role
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL OR v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur d’établissement actif peut modifier un créneau.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.school_timetables
  WHERE id = p_slot_id AND school_id = v_caller_school_id;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Créneau introuvable ou non rattaché à votre établissement.'
      USING ERRCODE = '42501';
  END IF;

  v_slot_type := LOWER(TRIM(COALESCE(p_slot_type, v_existing.slot_type, 'course')));
  IF v_slot_type NOT IN ('course', 'break') THEN
    RAISE EXCEPTION 'VALEUR INVALIDE : Le type de créneau doit être course ou break.' USING ERRCODE = '22023';
  END IF;

  v_status := LOWER(TRIM(COALESCE(p_status, v_existing.status)));
  IF v_status NOT IN ('inactive', 'active', 'cancelled') THEN
    RAISE EXCEPTION 'STATUT INVALIDE : Le statut doit être inactive, active ou cancelled.' USING ERRCODE = '22023';
  END IF;

  IF p_day_of_week NOT BETWEEN 1 AND 7 THEN
    RAISE EXCEPTION 'JOUR INVALIDE : Le jour doit être compris entre 1 et 7.' USING ERRCODE = '22023';
  END IF;

  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'HORAIRES INVALIDES : L’heure de début doit être antérieure à l’heure de fin.' USING ERRCODE = '22023';
  END IF;

  v_room := NULLIF(TRIM(p_room), '');

  IF v_slot_type = 'break' THEN
    v_subject_id := NULL;
    v_teacher_id := NULL;
    v_label := NULLIF(TRIM(p_label), '');
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'LIBELLÉ OBLIGATOIRE : Un libellé est requis pour un créneau de pause/récréation.' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- slot_type = 'course'
    v_subject_id := p_subject_id;
    v_teacher_id := p_teacher_id;
    v_label := NULLIF(TRIM(p_label), '');
    IF v_subject_id IS NULL THEN
      RAISE EXCEPTION 'MATIÈRE OBLIGATOIRE : Une matière est requise pour un cours.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Verrou transactionnel advisory
  PERFORM pg_advisory_xact_lock(hashtext(v_caller_school_id::text || v_existing.academic_year_id::text || p_day_of_week::text));

  -- Contrôle des conflits pour statut actif (excluant son propre ID)
  IF v_status = 'active' THEN
    -- 1. Classe
    SELECT COUNT(*) INTO v_conflict_count
    FROM public.school_timetables t
    WHERE t.school_id = v_caller_school_id
      AND t.academic_year_id = v_existing.academic_year_id
      AND t.class_id = v_existing.class_id
      AND t.day_of_week = p_day_of_week
      AND t.status = 'active'
      AND t.id <> p_slot_id
      AND (t.start_time < p_end_time AND t.end_time > p_start_time);

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'TIMETABLE_CLASS_CONFLICT : La classe a déjà un créneau actif en chevauchement horaire.'
        USING ERRCODE = '23505';
    END IF;

    -- 2. Enseignant (si cours et enseignant présent)
    IF v_slot_type = 'course' AND v_teacher_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.school_timetables t
      WHERE t.school_id = v_caller_school_id
        AND t.day_of_week = p_day_of_week
        AND t.teacher_id = v_teacher_id
        AND t.status = 'active'
        AND t.id <> p_slot_id
        AND (t.start_time < p_end_time AND t.end_time > p_start_time);

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'TIMETABLE_TEACHER_CONFLICT : L’enseignant est déjà assigné à un autre créneau actif en chevauchement.'
          USING ERRCODE = '23505';
      END IF;
    END IF;

    -- 3. Salle
    IF v_room IS NOT NULL THEN
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.school_timetables t
      WHERE t.school_id = v_caller_school_id
        AND t.day_of_week = p_day_of_week
        AND t.status = 'active'
        AND t.id <> p_slot_id
        AND LOWER(TRIM(t.room)) = LOWER(TRIM(v_room))
        AND (t.start_time < p_end_time AND t.end_time > p_start_time);

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'TIMETABLE_ROOM_CONFLICT : La salle "%" est déjà occupée sur ce créneau horaire.', v_room
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- Mise à jour
  UPDATE public.school_timetables
  SET
    day_of_week = p_day_of_week,
    start_time = p_start_time,
    end_time = p_end_time,
    subject_id = v_subject_id,
    teacher_id = v_teacher_id,
    room = v_room,
    status = v_status,
    slot_type = v_slot_type,
    label = v_label,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_slot_id AND school_id = v_caller_school_id;

  -- Traçabilité audit
  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_caller_school_id,
    v_caller_id,
    'TIMETABLE_SLOT_UPDATED',
    pg_catalog.jsonb_build_object(
      'slot_id', p_slot_id,
      'old_state', pg_catalog.jsonb_build_object(
        'slot_type', v_existing.slot_type,
        'label', v_existing.label,
        'status', v_existing.status,
        'day_of_week', v_existing.day_of_week,
        'start_time', v_existing.start_time,
        'end_time', v_existing.end_time,
        'subject_id', v_existing.subject_id,
        'teacher_id', v_existing.teacher_id,
        'room', v_existing.room
      ),
      'new_state', pg_catalog.jsonb_build_object(
        'slot_type', v_slot_type,
        'label', v_label,
        'status', v_status,
        'day_of_week', p_day_of_week,
        'start_time', p_start_time,
        'end_time', p_end_time,
        'subject_id', v_subject_id,
        'teacher_id', v_teacher_id,
        'room', v_room
      )
    )
  );

  SELECT public.get_admin_class_timetable(v_existing.class_id, v_existing.academic_year_id) INTO v_result;
  RETURN v_result;
END;
$$;

--------------------------------------------------------------------------------
-- 6. RPC ADMINISTRATIVE : SET_SCHOOL_TIMETABLE_SLOT_STATUS (AVEC CONFLITS)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_school_timetable_slot_status(
  p_slot_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_school_id UUID;
  v_existing RECORD;
  v_status TEXT;
  v_conflict_count INT;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT p.school_id, p.role
  INTO v_caller_school_id, v_caller_role
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL OR v_caller_role NOT IN ('school_admin', 'super_admin') THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur d’établissement actif peut modifier le statut.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.school_timetables
  WHERE id = p_slot_id AND school_id = v_caller_school_id;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Créneau introuvable ou non rattaché à votre établissement.'
      USING ERRCODE = '42501';
  END IF;

  v_status := LOWER(TRIM(p_status));
  IF v_status NOT IN ('inactive', 'active', 'cancelled') THEN
    RAISE EXCEPTION 'STATUT INVALIDE : Le statut doit être inactive, active ou cancelled.' USING ERRCODE = '22023';
  END IF;

  -- Si on passe en actif, vérifier l'absence de conflits
  IF v_status = 'active' THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_school_id::text || v_existing.academic_year_id::text || v_existing.day_of_week::text));

    -- 1. Classe
    SELECT COUNT(*) INTO v_conflict_count
    FROM public.school_timetables t
    WHERE t.school_id = v_caller_school_id
      AND t.academic_year_id = v_existing.academic_year_id
      AND t.class_id = v_existing.class_id
      AND t.day_of_week = v_existing.day_of_week
      AND t.status = 'active'
      AND t.id <> p_slot_id
      AND (t.start_time < v_existing.end_time AND t.end_time > v_existing.start_time);

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'TIMETABLE_CLASS_CONFLICT : La classe a déjà un créneau actif en chevauchement horaire.'
        USING ERRCODE = '23505';
    END IF;

    -- 2. Enseignant
    IF v_existing.slot_type = 'course' AND v_existing.teacher_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.school_timetables t
      WHERE t.school_id = v_caller_school_id
        AND t.day_of_week = v_existing.day_of_week
        AND t.teacher_id = v_existing.teacher_id
        AND t.status = 'active'
        AND t.id <> p_slot_id
        AND (t.start_time < v_existing.end_time AND t.end_time > v_existing.start_time);

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'TIMETABLE_TEACHER_CONFLICT : L’enseignant est déjà assigné à un autre créneau actif en chevauchement.'
          USING ERRCODE = '23505';
      END IF;
    END IF;

    -- 3. Salle
    IF v_existing.room IS NOT NULL THEN
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.school_timetables t
      WHERE t.school_id = v_caller_school_id
        AND t.day_of_week = v_existing.day_of_week
        AND t.status = 'active'
        AND t.id <> p_slot_id
        AND LOWER(TRIM(t.room)) = LOWER(TRIM(v_existing.room))
        AND (t.start_time < v_existing.end_time AND t.end_time > v_existing.start_time);

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'TIMETABLE_ROOM_CONFLICT : La salle "%" est déjà occupée sur ce créneau horaire.', v_existing.room
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  UPDATE public.school_timetables
  SET 
    status = v_status,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_slot_id AND school_id = v_caller_school_id;

  INSERT INTO public.school_audit_logs (
    school_id,
    actor_id,
    action,
    details
  ) VALUES (
    v_caller_school_id,
    v_caller_id,
    'TIMETABLE_SLOT_STATUS_CHANGED',
    pg_catalog.jsonb_build_object(
      'slot_id', p_slot_id,
      'old_status', v_existing.status,
      'new_status', v_status,
      'slot_type', v_existing.slot_type,
      'label', v_existing.label
    )
  );

  SELECT public.get_admin_class_timetable(v_existing.class_id, v_existing.academic_year_id) INTO v_result;
  RETURN v_result;
END;
$$;

--------------------------------------------------------------------------------
-- 7. RPC PARENT : GET_PARENT_STUDENT_TIMETABLE (AVEC PAUSES/RÉCRÉATIONS)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_parent_student_timetable(
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
  v_caller_school_id UUID;
  v_student RECORD;
  v_slots JSONB;
  v_total_slots INT := 0;
  v_total_days INT := 0;
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
    AND p.role = 'parent'
    AND p.is_active = true
    AND s.status = 'active';

  IF v_caller_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Seul un compte parent actif peut consulter l’emploi du temps.'
      USING ERRCODE = '42501';
  END IF;

  SELECT 
    st.id,
    st.school_id,
    st.student_number,
    st.first_name,
    st.last_name,
    st.class_id,
    c.name AS class_name,
    c.academic_year_id,
    ay.name AS academic_year_name
  INTO v_student
  FROM public.students st
  JOIN public.parent_student_links psl ON psl.student_id = st.id
  JOIN public.classes c ON c.id = st.class_id
  LEFT JOIN public.academic_years ay ON ay.id = c.academic_year_id
  WHERE st.id = p_student_id
    AND psl.parent_profile_id = v_caller_id
    AND psl.status = 'approved'
    AND psl.can_view_academic = true
    AND st.school_id = v_caller_school_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Élève introuvable ou vous n’avez pas l’autorisation académique.'
      USING ERRCODE = '42501';
  END IF;

  SELECT 
    pg_catalog.count(t.id),
    pg_catalog.count(DISTINCT t.day_of_week)
  INTO 
    v_total_slots,
    v_total_days
  FROM public.school_timetables t
  WHERE t.school_id = v_caller_school_id
    AND t.class_id = v_student.class_id
    AND (v_student.academic_year_id IS NULL OR t.academic_year_id = v_student.academic_year_id)
    AND t.status = 'active';

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', t.id,
      'slot_type', COALESCE(t.slot_type, 'course'),
      'label', t.label,
      'day_of_week', t.day_of_week,
      'day_name', CASE t.day_of_week
        WHEN 1 THEN 'Lundi'
        WHEN 2 THEN 'Mardi'
        WHEN 3 THEN 'Mercredi'
        WHEN 4 THEN 'Jeudi'
        WHEN 5 THEN 'Vendredi'
        WHEN 6 THEN 'Samedi'
        WHEN 7 THEN 'Dimanche'
        ELSE 'Inconnu'
      END,
      'subject_id', t.subject_id,
      'subject_name', CASE
        WHEN t.slot_type = 'break' THEN COALESCE(t.label, 'Pause')
        ELSE COALESCE(s.name, 'Matière')
      END,
      'teacher_id', t.teacher_id,
      'teacher_name', CASE
        WHEN t.slot_type = 'break' THEN ''
        WHEN tp.id IS NOT NULL THEN (tp.first_name || ' ' || tp.last_name)
        ELSE 'Enseignant non assigné'
      END,
      'room', COALESCE(t.room, ''),
      'start_time', pg_catalog.to_char(t.start_time, 'HH24:MI'),
      'end_time', pg_catalog.to_char(t.end_time, 'HH24:MI'),
      'status', t.status
    ) ORDER BY t.day_of_week ASC, t.start_time ASC
  ), '[]'::jsonb)
  INTO v_slots
  FROM public.school_timetables t
  LEFT JOIN public.subjects s ON s.id = t.subject_id
  LEFT JOIN public.teachers te ON te.id = t.teacher_id
  LEFT JOIN public.profiles tp ON tp.id = te.profile_id
  WHERE t.school_id = v_caller_school_id
    AND t.class_id = v_student.class_id
    AND (v_student.academic_year_id IS NULL OR t.academic_year_id = v_student.academic_year_id)
    AND t.status = 'active';

  RETURN pg_catalog.jsonb_build_object(
    'student_id', v_student.id,
    'student_number', v_student.student_number,
    'student_name', TRIM(v_student.first_name || ' ' || v_student.last_name),
    'class_id', v_student.class_id,
    'class_name', v_student.class_name,
    'academic_year_id', v_student.academic_year_id,
    'academic_year_name', COALESCE(v_student.academic_year_name, 'Non spécifiée'),
    'summary', pg_catalog.jsonb_build_object(
      'total_slots', v_total_slots,
      'total_days', v_total_days
    ),
    'slots', v_slots
  );
END;
$$;

--------------------------------------------------------------------------------
-- 8. OCTROI DES PRIVILÈGES AUX FONCTIONS
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_admin_class_timetable(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_class_timetable(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.create_school_timetable_slot(UUID, UUID, INT, TIME, TIME, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_school_timetable_slot(UUID, UUID, INT, TIME, TIME, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.update_school_timetable_slot(UUID, INT, TIME, TIME, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_school_timetable_slot(UUID, INT, TIME, TIME, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.set_school_timetable_slot_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_school_timetable_slot_status(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_parent_student_timetable(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_student_timetable(UUID) TO authenticated;

COMMIT;
