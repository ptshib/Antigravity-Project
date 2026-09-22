-- Migration Lot 2D : RPCs Administratives de Gestion Sécurisée de l'Emploi du Temps
-- Fichier : supabase/migrations/20260922171000_admin_timetable_management.sql

BEGIN;

--------------------------------------------------------------------------------
-- 1. EXTENSION DE PUBLIC.SCHOOL_TIMETABLES (Champ created_by pour traçabilité)
--------------------------------------------------------------------------------
ALTER TABLE public.school_timetables
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

--------------------------------------------------------------------------------
-- 2. RPC : GET_ADMIN_CLASS_TIMETABLE (Consultation Administrateur)
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

  -- Métadonnées de la classe
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

  -- Comptage des métriques
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

  -- Liste de tous les créneaux (active, inactive, cancelled)
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', t.id,
      'day_of_week', t.day_of_week,
      'day_name', CASE t.day_of_week
        WHEN 1 THEN 'Lundi'
        WHEN 2 THEN 'Mardi'
        WHEN 3 THEN 'Mercredi'
        WHEN 4 THEN 'Jeudi'
        WHEN 5 THEN 'Vendredi'
        WHEN 6 THEN 'Samedi'
        WHEN 7 THEN 'Dimanche'
        ELSE 'Jour'
      END,
      'subject_id', t.subject_id,
      'subject_name', s.name,
      'teacher_id', t.teacher_id,
      'teacher_name', COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', tech.first_name, tech.last_name)), ''), 'Enseignant non assigné'),
      'room', COALESCE(NULLIF(pg_catalog.btrim(t.room), ''), 'Salle non spécifiée'),
      'start_time', pg_catalog.to_char(t.start_time, 'HH24:MI'),
      'end_time', pg_catalog.to_char(t.end_time, 'HH24:MI'),
      'status', t.status,
      'created_at', t.created_at,
      'updated_at', t.updated_at
    )
  ), pg_catalog.jsonb_build_array())
  INTO v_slots
  FROM (
    SELECT t2.*
    FROM public.school_timetables t2
    WHERE t2.school_id = v_caller_school_id
      AND t2.class_id = p_class_id
      AND (v_target_year_id IS NULL OR t2.academic_year_id = v_target_year_id)
    ORDER BY t2.day_of_week ASC, t2.start_time ASC, t2.created_at ASC
  ) t
  JOIN public.subjects s ON s.id = t.subject_id AND s.school_id = v_caller_school_id
  LEFT JOIN public.teachers tech ON tech.id = t.teacher_id AND tech.school_id = v_caller_school_id;

  RETURN pg_catalog.jsonb_build_object(
    'class_id', v_class.id,
    'class_name', v_class.name,
    'academic_year_id', v_target_year_id,
    'academic_year_name', COALESCE(v_class.academic_year_name, ''),
    'summary', pg_catalog.jsonb_build_object(
      'total_slots', v_total_slots,
      'active_slots', v_active_slots,
      'inactive_slots', v_inactive_slots,
      'cancelled_slots', v_cancelled_slots,
      'total_days', v_total_days
    ),
    'slots', COALESCE(v_slots, pg_catalog.jsonb_build_array())
  );
END;
$$;

--------------------------------------------------------------------------------
-- 3. RPC : CREATE_SCHOOL_TIMETABLE_SLOT (Création de créneau)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_school_timetable_slot(
  p_class_id UUID,
  p_subject_id UUID,
  p_teacher_id UUID DEFAULT NULL,
  p_room TEXT DEFAULT NULL,
  p_day_of_week INT DEFAULT 1,
  p_start_time TIME DEFAULT '08:00:00'::time,
  p_end_time TIME DEFAULT '09:00:00'::time,
  p_status TEXT DEFAULT 'inactive',
  p_academic_year_id UUID DEFAULT NULL
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
  v_year_id UUID;
  v_cls_school_id UUID;
  v_cls_year_id UUID;
  v_sbj_school_id UUID;
  v_tch_school_id UUID;
  v_tch_status TEXT;
  v_room_norm TEXT;
  v_new_slot_id UUID;
  v_conflict_slot RECORD;
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

  -- Validations de base
  IF p_day_of_week IS NULL OR p_day_of_week < 1 OR p_day_of_week > 7 THEN
    RAISE EXCEPTION 'VALEUR INVALIDE : Le jour de la semaine doit être compris entre 1 (Lundi) et 7 (Dimanche).'
      USING ERRCODE = '22023';
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'VALEUR INVALIDE : L’heure de début doit être strictement inférieure à l’heure de fin.'
      USING ERRCODE = '22023';
  END IF;

  IF p_status NOT IN ('inactive', 'active', 'cancelled') THEN
    RAISE EXCEPTION 'VALEUR INVALIDE : Le statut doit être inactive, active ou cancelled.'
      USING ERRCODE = '22023';
  END IF;

  v_room_norm := NULLIF(pg_catalog.btrim(p_room), '');

  -- Classe & Année scolaire
  SELECT school_id, academic_year_id
  INTO v_cls_school_id, v_cls_year_id
  FROM public.classes
  WHERE id = p_class_id;

  IF v_cls_school_id IS NULL OR v_cls_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : La classe n’appartient pas à votre établissement.'
      USING ERRCODE = '42501';
  END IF;

  v_year_id := COALESCE(p_academic_year_id, v_cls_year_id);

  IF v_year_id <> v_cls_year_id THEN
    RAISE EXCEPTION 'INCOHÉRENCE : L’année scolaire spécifiée ne correspond pas à l’année scolaire de la classe.'
      USING ERRCODE = '42501';
  END IF;

  -- Matière
  SELECT school_id INTO v_sbj_school_id
  FROM public.subjects
  WHERE id = p_subject_id;

  IF v_sbj_school_id IS NULL OR v_sbj_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : La matière n’appartient pas à votre établissement.'
      USING ERRCODE = '42501';
  END IF;

  -- Enseignant (facultatif)
  IF p_teacher_id IS NOT NULL THEN
    SELECT school_id, employment_status
    INTO v_tch_school_id, v_tch_status
    FROM public.teachers
    WHERE id = p_teacher_id;

    IF v_tch_school_id IS NULL OR v_tch_school_id <> v_caller_school_id THEN
      RAISE EXCEPTION 'REJET ACCÈS : L’enseignant n’appartient pas à votre établissement.'
        USING ERRCODE = '42501';
    END IF;

    IF v_tch_status <> 'active' THEN
      RAISE EXCEPTION 'VALEUR INVALIDE : L’enseignant sélectionné n’est pas en statut d’emploi actif.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Verrou Transactionnel Déterministe Anti-Course (par école & jour)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('timetable_' || v_caller_school_id::text || '_' || p_day_of_week::text)
  );

  -- DÉTECTION DES CONFLITS (Si statut active)
  IF p_status = 'active' THEN
    -- 1. Conflit de classe
    SELECT t.start_time, t.end_time, s.name AS subject_name
    INTO v_conflict_slot
    FROM public.school_timetables t
    JOIN public.subjects s ON s.id = t.subject_id
    WHERE t.school_id = v_caller_school_id
      AND t.academic_year_id = v_year_id
      AND t.class_id = p_class_id
      AND t.day_of_week = p_day_of_week
      AND t.status = 'active'
      AND (t.start_time < p_end_time AND t.end_time > p_start_time)
    LIMIT 1;

    IF v_conflict_slot.start_time IS NOT NULL THEN
      RAISE EXCEPTION 'TIMETABLE_CLASS_CONFLICT : La classe a déjà un cours actif (%) de % à % ce jour-là.',
        v_conflict_slot.subject_name,
        pg_catalog.to_char(v_conflict_slot.start_time, 'HH24:MI'),
        pg_catalog.to_char(v_conflict_slot.end_time, 'HH24:MI')
        USING ERRCODE = '23505';
    END IF;

    -- 2. Conflit d'enseignant
    IF p_teacher_id IS NOT NULL THEN
      SELECT t.start_time, t.end_time, c.name AS class_name
      INTO v_conflict_slot
      FROM public.school_timetables t
      JOIN public.classes c ON c.id = t.class_id
      WHERE t.school_id = v_caller_school_id
        AND t.academic_year_id = v_year_id
        AND t.teacher_id = p_teacher_id
        AND t.day_of_week = p_day_of_week
        AND t.status = 'active'
        AND (t.start_time < p_end_time AND t.end_time > p_start_time)
      LIMIT 1;

      IF v_conflict_slot.start_time IS NOT NULL THEN
        RAISE EXCEPTION 'TIMETABLE_TEACHER_CONFLICT : L’enseignant a déjà un cours actif programmé en % de % à % ce jour-là.',
          v_conflict_slot.class_name,
          pg_catalog.to_char(v_conflict_slot.start_time, 'HH24:MI'),
          pg_catalog.to_char(v_conflict_slot.end_time, 'HH24:MI')
          USING ERRCODE = '23505';
      END IF;
    END IF;

    -- 3. Conflit de salle
    IF v_room_norm IS NOT NULL THEN
      SELECT t.start_time, t.end_time, c.name AS class_name
      INTO v_conflict_slot
      FROM public.school_timetables t
      JOIN public.classes c ON c.id = t.class_id
      WHERE t.school_id = v_caller_school_id
        AND t.academic_year_id = v_year_id
        AND t.room IS NOT NULL
        AND pg_catalog.btrim(t.room) = v_room_norm
        AND t.day_of_week = p_day_of_week
        AND t.status = 'active'
        AND (t.start_time < p_end_time AND t.end_time > p_start_time)
      LIMIT 1;

      IF v_conflict_slot.start_time IS NOT NULL THEN
        RAISE EXCEPTION 'TIMETABLE_ROOM_CONFLICT : La salle "%" est déjà occupée par la classe % de % à % ce jour-là.',
          v_room_norm,
          v_conflict_slot.class_name,
          pg_catalog.to_char(v_conflict_slot.start_time, 'HH24:MI'),
          pg_catalog.to_char(v_conflict_slot.end_time, 'HH24:MI')
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- Insertion du créneau
  v_new_slot_id := gen_random_uuid();

  INSERT INTO public.school_timetables (
    id, school_id, academic_year_id, class_id, subject_id, teacher_id, room, day_of_week, start_time, end_time, status, created_by
  ) VALUES (
    v_new_slot_id, v_caller_school_id, v_year_id, p_class_id, p_subject_id, p_teacher_id, v_room_norm, p_day_of_week, p_start_time, p_end_time, p_status, v_caller_id
  );

  -- Journal d'audit
  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_caller_school_id,
    v_caller_id,
    'CREATE_TIMETABLE_SLOT',
    pg_catalog.jsonb_build_object(
      'slot_id', v_new_slot_id,
      'class_id', p_class_id,
      'subject_id', p_subject_id,
      'teacher_id', p_teacher_id,
      'room', v_room_norm,
      'day_of_week', p_day_of_week,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'status', p_status
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'message', 'Créneau d’emploi du temps créé avec succès.',
    'slot_id', v_new_slot_id,
    'status', p_status
  );
END;
$$;

--------------------------------------------------------------------------------
-- 4. RPC : UPDATE_SCHOOL_TIMETABLE_SLOT (Modification de créneau)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_school_timetable_slot(
  p_slot_id UUID,
  p_subject_id UUID DEFAULT NULL,
  p_teacher_id UUID DEFAULT NULL,
  p_room TEXT DEFAULT NULL,
  p_day_of_week INT DEFAULT NULL,
  p_start_time TIME DEFAULT NULL,
  p_end_time TIME DEFAULT NULL,
  p_status TEXT DEFAULT NULL
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
  v_target RECORD;
  v_day_of_week INT;
  v_start_time TIME;
  v_end_time TIME;
  v_subject_id UUID;
  v_teacher_id UUID;
  v_room_norm TEXT;
  v_status TEXT;
  v_sbj_school_id UUID;
  v_tch_school_id UUID;
  v_tch_status TEXT;
  v_conflict_slot RECORD;
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

  -- Récupérer le créneau cible
  SELECT * INTO v_target
  FROM public.school_timetables
  WHERE id = p_slot_id
    AND school_id = v_caller_school_id;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Créneau introuvable ou non rattaché à votre établissement.'
      USING ERRCODE = '42501';
  END IF;

  -- Résolution des nouvelles valeurs
  v_day_of_week := COALESCE(p_day_of_week, v_target.day_of_week);
  v_start_time  := COALESCE(p_start_time, v_target.start_time);
  v_end_time    := COALESCE(p_end_time, v_target.end_time);
  v_subject_id  := COALESCE(p_subject_id, v_target.subject_id);
  v_teacher_id  := CASE WHEN p_teacher_id IS NULL AND p_subject_id IS NULL AND p_room IS NULL THEN v_target.teacher_id ELSE p_teacher_id END;
  v_room_norm   := CASE WHEN p_room IS NULL THEN v_target.room ELSE NULLIF(pg_catalog.btrim(p_room), '') END;
  v_status      := COALESCE(p_status, v_target.status);

  -- Validations de cohérence
  IF v_day_of_week < 1 OR v_day_of_week > 7 THEN
    RAISE EXCEPTION 'VALEUR INVALIDE : Le jour de la semaine doit être compris entre 1 et 7.' USING ERRCODE = '22023';
  END IF;

  IF v_start_time >= v_end_time THEN
    RAISE EXCEPTION 'VALEUR INVALIDE : L’heure de début doit être strictement inférieure à l’heure de fin.' USING ERRCODE = '22023';
  END IF;

  IF v_status NOT IN ('inactive', 'active', 'cancelled') THEN
    RAISE EXCEPTION 'VALEUR INVALIDE : Statut non reconnu.' USING ERRCODE = '22023';
  END IF;

  -- Matière
  SELECT school_id INTO v_sbj_school_id FROM public.subjects WHERE id = v_subject_id;
  IF v_sbj_school_id IS NULL OR v_sbj_school_id <> v_caller_school_id THEN
    RAISE EXCEPTION 'REJET ACCÈS : La matière n’appartient pas à votre établissement.' USING ERRCODE = '42501';
  END IF;

  -- Enseignant
  IF v_teacher_id IS NOT NULL THEN
    SELECT school_id, employment_status INTO v_tch_school_id, v_tch_status FROM public.teachers WHERE id = v_teacher_id;
    IF v_tch_school_id IS NULL OR v_tch_school_id <> v_caller_school_id OR v_tch_status <> 'active' THEN
      RAISE EXCEPTION 'REJET ACCÈS : Enseignant invalide ou inactif.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Verrou Transactionnel
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('timetable_' || v_caller_school_id::text || '_' || v_day_of_week::text)
  );

  -- CONFLITS (Si status = active)
  IF v_status = 'active' THEN
    -- 1. Classe
    SELECT t.start_time, t.end_time, s.name AS subject_name
    INTO v_conflict_slot
    FROM public.school_timetables t
    JOIN public.subjects s ON s.id = t.subject_id
    WHERE t.school_id = v_caller_school_id
      AND t.academic_year_id = v_target.academic_year_id
      AND t.class_id = v_target.class_id
      AND t.day_of_week = v_day_of_week
      AND t.status = 'active'
      AND t.id <> p_slot_id
      AND (t.start_time < v_end_time AND t.end_time > v_start_time)
    LIMIT 1;

    IF v_conflict_slot.start_time IS NOT NULL THEN
      RAISE EXCEPTION 'TIMETABLE_CLASS_CONFLICT : La classe a déjà un cours actif (%) de % à % ce jour-là.',
        v_conflict_slot.subject_name,
        pg_catalog.to_char(v_conflict_slot.start_time, 'HH24:MI'),
        pg_catalog.to_char(v_conflict_slot.end_time, 'HH24:MI')
        USING ERRCODE = '23505';
    END IF;

    -- 2. Enseignant
    IF v_teacher_id IS NOT NULL THEN
      SELECT t.start_time, t.end_time, c.name AS class_name
      INTO v_conflict_slot
      FROM public.school_timetables t
      JOIN public.classes c ON c.id = t.class_id
      WHERE t.school_id = v_caller_school_id
        AND t.academic_year_id = v_target.academic_year_id
        AND t.teacher_id = v_teacher_id
        AND t.day_of_week = v_day_of_week
        AND t.status = 'active'
        AND t.id <> p_slot_id
        AND (t.start_time < v_end_time AND t.end_time > v_start_time)
      LIMIT 1;

      IF v_conflict_slot.start_time IS NOT NULL THEN
        RAISE EXCEPTION 'TIMETABLE_TEACHER_CONFLICT : L’enseignant a déjà un cours actif programmé en % de % à % ce jour-là.',
          v_conflict_slot.class_name,
          pg_catalog.to_char(v_conflict_slot.start_time, 'HH24:MI'),
          pg_catalog.to_char(v_conflict_slot.end_time, 'HH24:MI')
          USING ERRCODE = '23505';
      END IF;
    END IF;

    -- 3. Salle
    IF v_room_norm IS NOT NULL THEN
      SELECT t.start_time, t.end_time, c.name AS class_name
      INTO v_conflict_slot
      FROM public.school_timetables t
      JOIN public.classes c ON c.id = t.class_id
      WHERE t.school_id = v_caller_school_id
        AND t.academic_year_id = v_target.academic_year_id
        AND t.room IS NOT NULL
        AND pg_catalog.btrim(t.room) = v_room_norm
        AND t.day_of_week = v_day_of_week
        AND t.status = 'active'
        AND t.id <> p_slot_id
        AND (t.start_time < v_end_time AND t.end_time > v_start_time)
      LIMIT 1;

      IF v_conflict_slot.start_time IS NOT NULL THEN
        RAISE EXCEPTION 'TIMETABLE_ROOM_CONFLICT : La salle "%" est déjà occupée par la classe % de % à % ce jour-là.',
          v_room_norm,
          v_conflict_slot.class_name,
          pg_catalog.to_char(v_conflict_slot.start_time, 'HH24:MI'),
          pg_catalog.to_char(v_conflict_slot.end_time, 'HH24:MI')
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- Application de la mise à jour
  UPDATE public.school_timetables
  SET subject_id  = v_subject_id,
      teacher_id  = v_teacher_id,
      room        = v_room_norm,
      day_of_week = v_day_of_week,
      start_time  = v_start_time,
      end_time    = v_end_time,
      status      = v_status
  WHERE id = p_slot_id
    AND school_id = v_caller_school_id;

  -- Journal d'audit
  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_caller_school_id,
    v_caller_id,
    'UPDATE_TIMETABLE_SLOT',
    pg_catalog.jsonb_build_object(
      'slot_id', p_slot_id,
      'old_status', v_target.status,
      'new_status', v_status,
      'day_of_week', v_day_of_week,
      'start_time', v_start_time,
      'end_time', v_end_time
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'message', 'Créneau mis à jour avec succès.',
    'slot_id', p_slot_id,
    'status', v_status
  );
END;
$$;

--------------------------------------------------------------------------------
-- 5. RPC : SET_SCHOOL_TIMETABLE_SLOT_STATUS (Changement contrôlé de statut)
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
  v_target RECORD;
  v_conflict_slot RECORD;
  v_room_norm TEXT;
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
    RAISE EXCEPTION 'REJET ACCÈS : Seul un administrateur d’établissement actif peut modifier le statut d’un créneau.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('inactive', 'active', 'cancelled') THEN
    RAISE EXCEPTION 'VALEUR INVALIDE : Statut non reconnu.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target
  FROM public.school_timetables
  WHERE id = p_slot_id
    AND school_id = v_caller_school_id;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'REJET ACCÈS : Créneau introuvable ou non rattaché à votre établissement.'
      USING ERRCODE = '42501';
  END IF;

  -- Si activation, vérifier l'absence de conflits
  IF p_status = 'active' AND v_target.status <> 'active' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('timetable_' || v_caller_school_id::text || '_' || v_target.day_of_week::text)
    );

    v_room_norm := NULLIF(pg_catalog.btrim(v_target.room), '');

    -- 1. Classe
    SELECT t.start_time, t.end_time, s.name AS subject_name
    INTO v_conflict_slot
    FROM public.school_timetables t
    JOIN public.subjects s ON s.id = t.subject_id
    WHERE t.school_id = v_caller_school_id
      AND t.academic_year_id = v_target.academic_year_id
      AND t.class_id = v_target.class_id
      AND t.day_of_week = v_target.day_of_week
      AND t.status = 'active'
      AND t.id <> p_slot_id
      AND (t.start_time < v_target.end_time AND t.end_time > v_target.start_time)
    LIMIT 1;

    IF v_conflict_slot.start_time IS NOT NULL THEN
      RAISE EXCEPTION 'TIMETABLE_CLASS_CONFLICT : La classe a déjà un cours actif (%) de % à % ce jour-là.',
        v_conflict_slot.subject_name,
        pg_catalog.to_char(v_conflict_slot.start_time, 'HH24:MI'),
        pg_catalog.to_char(v_conflict_slot.end_time, 'HH24:MI')
        USING ERRCODE = '23505';
    END IF;

    -- 2. Enseignant
    IF v_target.teacher_id IS NOT NULL THEN
      SELECT t.start_time, t.end_time, c.name AS class_name
      INTO v_conflict_slot
      FROM public.school_timetables t
      JOIN public.classes c ON c.id = t.class_id
      WHERE t.school_id = v_caller_school_id
        AND t.academic_year_id = v_target.academic_year_id
        AND t.teacher_id = v_target.teacher_id
        AND t.day_of_week = v_target.day_of_week
        AND t.status = 'active'
        AND t.id <> p_slot_id
        AND (t.start_time < v_target.end_time AND t.end_time > v_target.start_time)
      LIMIT 1;

      IF v_conflict_slot.start_time IS NOT NULL THEN
        RAISE EXCEPTION 'TIMETABLE_TEACHER_CONFLICT : L’enseignant a déjà un cours actif programmé en % de % à % ce jour-là.',
          v_conflict_slot.class_name,
          pg_catalog.to_char(v_conflict_slot.start_time, 'HH24:MI'),
          pg_catalog.to_char(v_conflict_slot.end_time, 'HH24:MI')
          USING ERRCODE = '23505';
      END IF;
    END IF;

    -- 3. Salle
    IF v_room_norm IS NOT NULL THEN
      SELECT t.start_time, t.end_time, c.name AS class_name
      INTO v_conflict_slot
      FROM public.school_timetables t
      JOIN public.classes c ON c.id = t.class_id
      WHERE t.school_id = v_caller_school_id
        AND t.academic_year_id = v_target.academic_year_id
        AND t.room IS NOT NULL
        AND pg_catalog.btrim(t.room) = v_room_norm
        AND t.day_of_week = v_target.day_of_week
        AND t.status = 'active'
        AND t.id <> p_slot_id
        AND (t.start_time < v_target.end_time AND t.end_time > v_target.start_time)
      LIMIT 1;

      IF v_conflict_slot.start_time IS NOT NULL THEN
        RAISE EXCEPTION 'TIMETABLE_ROOM_CONFLICT : La salle "%" est déjà occupée par la classe % de % à % ce jour-là.',
          v_room_norm,
          v_conflict_slot.class_name,
          pg_catalog.to_char(v_conflict_slot.start_time, 'HH24:MI'),
          pg_catalog.to_char(v_conflict_slot.end_time, 'HH24:MI')
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  UPDATE public.school_timetables
  SET status = p_status
  WHERE id = p_slot_id
    AND school_id = v_caller_school_id;

  INSERT INTO public.school_audit_logs (school_id, actor_id, action, details)
  VALUES (
    v_caller_school_id,
    v_caller_id,
    'SET_TIMETABLE_SLOT_STATUS',
    pg_catalog.jsonb_build_object(
      'slot_id', p_slot_id,
      'old_status', v_target.status,
      'new_status', p_status
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'message', 'Statut du créneau modifié avec succès.',
    'slot_id', p_slot_id,
    'status', p_status
  );
END;
$$;

-- Révocation et attribution des privilèges RPC
REVOKE ALL ON FUNCTION public.get_admin_class_timetable(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_class_timetable(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.create_school_timetable_slot(UUID, UUID, UUID, TEXT, INT, TIME, TIME, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_school_timetable_slot(UUID, UUID, UUID, TEXT, INT, TIME, TIME, TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.update_school_timetable_slot(UUID, UUID, UUID, TEXT, INT, TIME, TIME, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_school_timetable_slot(UUID, UUID, UUID, TEXT, INT, TIME, TIME, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.set_school_timetable_slot_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_school_timetable_slot_status(UUID, TEXT) TO authenticated;

COMMIT;
