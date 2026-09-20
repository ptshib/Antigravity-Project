-- Migration : 20260920170000_finance_4e5_real_campaign_creation.sql
-- Description : Création et planification sécurisées des campagnes e-mail REAL (Finance 4E-5AR)
-- Invariants : Hash REAL JSONB canonique, rééligibilité 4D, idempotence étanche, contrat 23 clés, garde GUC transactionnelle.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. HELPER PRIVÉ ET TRIGGERS DE PROTECTION STRUCTURELLE
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._guard_collection_campaign_delivery_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Sur INSERT
  IF TG_OP = 'INSERT' THEN
    IF NEW.delivery_mode IS NULL THEN
      NEW.delivery_mode := 'mock';
    ELSIF NEW.delivery_mode = 'real' THEN
      IF pg_catalog.current_setting('app.internal_allow_real_campaign_creation', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'La création directe de campagne REAL hors parcours sécurisé est interdite.'
          USING ERRCODE = '22023';
      END IF;
    ELSIF NEW.delivery_mode NOT IN ('mock', 'real') THEN
      RAISE EXCEPTION 'delivery_mode invalide : %', NEW.delivery_mode
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Sur UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- RÈGLE 1 : UPDATE real -> mock TOUJOURS REFUSÉ
    IF OLD.delivery_mode = 'real' AND NEW.delivery_mode = 'mock' THEN
      RAISE EXCEPTION 'La conversion d’une campagne REAL en mode MOCK est strictement interdite.'
        USING ERRCODE = '22023';
    END IF;

    -- RÈGLE 2 : UPDATE mock -> real REFUSÉ SAUF AUTORISATION TRANSACTIONNELLE INTERNE
    IF OLD.delivery_mode = 'mock' AND NEW.delivery_mode = 'real' THEN
      IF pg_catalog.current_setting('app.internal_allow_real_campaign_conversion', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'La conversion directe du mode d’expédition MOCK vers REAL n’est pas autorisée.'
          USING ERRCODE = '22023';
      END IF;

      -- Invariants structurels obligatoires
      IF OLD.status <> 'draft' OR NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'Seule une campagne en statut draft peut être convertie en mode REAL.'
          USING ERRCODE = '22023';
      END IF;

      IF OLD.channel <> 'email' OR NEW.channel <> 'email' THEN
        RAISE EXCEPTION 'Seule une campagne e-mail peut être convertie en mode REAL.'
          USING ERRCODE = '22023';
      END IF;

      IF OLD.processing_started_at IS NOT NULL OR OLD.completed_at IS NOT NULL OR OLD.claimed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Une campagne ayant déjà un historique d’exécution ne peut pas être convertie.'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.school_collection_real_email_jobs
        WHERE campaign_id = OLD.id
      ) THEN
        RAISE EXCEPTION 'Une campagne associée à des jobs ne peut pas être convertie.'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    -- RÈGLE 3 : EMPÊCHER LA PLANIFICATION REAL VIA LA RPC MOCK HISTORIQUE / NON AUTORISÉE
    IF OLD.status = 'draft' AND NEW.status = 'scheduled' AND NEW.delivery_mode = 'real' THEN
      IF pg_catalog.current_setting('app.internal_allow_real_campaign_scheduling', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Une campagne REAL ne peut pas être planifiée sans autorisation transactionnelle.'
          USING ERRCODE = '22023';
      END IF;

      IF NEW.channel <> 'email' THEN
        RAISE EXCEPTION 'Seule une campagne e-mail REAL peut être planifiée.'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- Révocation des droits sur le helper privé
REVOKE EXECUTE ON FUNCTION public._guard_collection_campaign_delivery_mode() FROM PUBLIC, anon, authenticated;

-- Attachement du trigger de garde sur public.school_collection_campaigns
DROP TRIGGER IF EXISTS trg_guard_collection_campaign_delivery_mode ON public.school_collection_campaigns;
CREATE TRIGGER trg_guard_collection_campaign_delivery_mode
  BEFORE INSERT OR UPDATE ON public.school_collection_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public._guard_collection_campaign_delivery_mode();

-- Mise à jour du trigger d'immutabilité 4D pour autoriser la mise à jour de payload_hash lors de la conversion REAL transactionnelle
CREATE OR REPLACE FUNCTION public._prevent_campaign_immutable_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'REJET : La suppression directe d une campagne est interdite.'
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.school_id IS DISTINCT FROM NEW.school_id OR
           OLD.created_by IS DISTINCT FROM NEW.created_by OR
           OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR
           OLD.channel IS DISTINCT FROM NEW.channel OR
           OLD.filter_criteria IS DISTINCT FROM NEW.filter_criteria OR
           OLD.template_snapshot IS DISTINCT FROM NEW.template_snapshot THEN
            RAISE EXCEPTION 'REJET : Modification interdite des champs immuables de la campagne.'
                USING ERRCODE = '42501';
        END IF;

        IF OLD.payload_hash IS DISTINCT FROM NEW.payload_hash THEN
            IF NOT (
                OLD.delivery_mode = 'mock' AND NEW.delivery_mode = 'real' AND
                pg_catalog.current_setting('app.internal_allow_real_campaign_conversion', true) = 'true'
            ) THEN
                RAISE EXCEPTION 'REJET : Modification interdite des champs immuables de la campagne.'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._prevent_campaign_immutable_mutation() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public._prevent_campaign_immutable_mutation() OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 2. RPC PUBLIQUE : CRÉATION DE CAMPAGNE E-MAIL REAL (STATUS DRAFT)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_school_real_email_campaign(
  p_name TEXT,
  p_template TEXT,
  p_idempotency_key UUID,
  p_currency TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT NULL,
  p_min_days_overdue INTEGER DEFAULT NULL,
  p_max_days_overdue INTEGER DEFAULT NULL,
  p_class_ids UUID[] DEFAULT NULL,
  p_confirm_real_delivery BOOLEAN DEFAULT false,
  p_confirmation_text TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_school_id UUID;
  v_role TEXT;
  v_global_enabled BOOLEAN;
  v_sender_verified BOOLEAN;
  v_verified_from TEXT;
  v_school_email_enabled BOOLEAN;
  v_daily_quota INT;
  v_existing_camp RECORD;
  v_mock_res JSONB;
  v_campaign_id UUID;
  v_real_payload_hash TEXT;
  v_campaign_record RECORD;
  v_base_res JSONB;
  v_camp_obj JSONB;
  v_norm_name TEXT;
  v_norm_template TEXT;
  v_norm_currency TEXT;
  v_norm_priority TEXT;
  v_sorted_class_ids UUID[] := NULL;
  v_canonical_jsonb JSONB;
BEGIN
  -- 1. Authentification et identification de l'utilisateur
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '28000';
  END IF;

  SELECT school_id, role INTO v_school_id, v_role
  FROM public.profiles
  WHERE id = v_user_id AND is_active = true;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur actif non trouvé.' USING ERRCODE = '42501';
  END IF;

  -- Contrôle strict du rôle : SEUL school_admin peut créer une campagne REAL
  IF v_role <> 'school_admin' THEN
    RAISE EXCEPTION 'Seul un administrateur d’établissement (school_admin) peut créer une campagne e-mail REAL.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Contrôle strict de confirmation explicite du client
  IF p_confirm_real_delivery IS NOT TRUE OR pg_catalog.btrim(COALESCE(p_confirmation_text, '')) <> 'ENVOI EMAIL REEL' THEN
    RAISE EXCEPTION 'La confirmation explicite ''ENVOI EMAIL REEL'' avec p_confirm_real_delivery = true est obligatoire pour créer une campagne REAL.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Contrôle des préconditions opérationnelles (Readiness effective dans la même transaction)
  SELECT real_email_enabled, sender_identity_verified, verified_from_email
  INTO v_global_enabled, v_sender_verified, v_verified_from
  FROM public.school_delivery_global_config
  WHERE id = 1
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Les préconditions opérationnelles pour l’envoi réel d’e-mails ne sont pas satisfaites.'
      USING ERRCODE = '55000';
  END IF;

  SELECT email_real_enabled, daily_email_quota
  INTO v_school_email_enabled, v_daily_quota
  FROM public.school_delivery_settings
  WHERE school_id = v_school_id AND email_provider = 'resend'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Les préconditions opérationnelles pour l’envoi réel d’e-mails ne sont pas satisfaites.'
      USING ERRCODE = '55000';
  END IF;

  IF COALESCE(v_global_enabled, false) IS NOT TRUE OR
     COALESCE(v_sender_verified, false) IS NOT TRUE OR
     v_verified_from IS NULL OR pg_catalog.btrim(v_verified_from) = '' OR
     v_school_email_enabled IS NULL OR v_school_email_enabled IS NOT TRUE OR
     COALESCE(v_daily_quota, 0) <= 0 THEN
    RAISE EXCEPTION 'Les préconditions opérationnelles pour l’envoi réel d’e-mails ne sont pas satisfaites.'
      USING ERRCODE = '55000';
  END IF;

  -- 4. Normalisation et calcul du HASH REAL JSONB CANONIQUE
  v_norm_name := pg_catalog.lower(pg_catalog.btrim(p_name));
  v_norm_template := pg_catalog.btrim(p_template);

  IF p_currency IS NOT NULL AND pg_catalog.btrim(p_currency) <> '' THEN
    v_norm_currency := pg_catalog.upper(pg_catalog.btrim(p_currency));
  ELSE
    v_norm_currency := NULL;
  END IF;

  IF p_priority IS NOT NULL AND pg_catalog.btrim(p_priority) <> '' THEN
    v_norm_priority := pg_catalog.lower(pg_catalog.btrim(p_priority));
  ELSE
    v_norm_priority := NULL;
  END IF;

  IF p_class_ids IS NOT NULL AND pg_catalog.array_length(p_class_ids, 1) > 0 THEN
    SELECT pg_catalog.array_agg(elem ORDER BY elem)
    INTO v_sorted_class_ids
    FROM (
      SELECT DISTINCT unnest(p_class_ids) AS elem
    ) s;
  ELSE
    v_sorted_class_ids := NULL;
  END IF;

  v_canonical_jsonb := pg_catalog.jsonb_build_object(
    'delivery_mode', 'real',
    'name', v_norm_name,
    'channel', 'email',
    'template', v_norm_template,
    'currency', v_norm_currency,
    'priority', v_norm_priority,
    'min_days_overdue', p_min_days_overdue,
    'max_days_overdue', p_max_days_overdue,
    'class_ids', pg_catalog.to_jsonb(v_sorted_class_ids)
  );

  v_real_payload_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_canonical_jsonb::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  -- 5. Vérification du rejeu et des collisions AVANT tout appel à la RPC MOCK
  SELECT id, delivery_mode, payload_hash
  INTO v_existing_camp
  FROM public.school_collection_campaigns
  WHERE idempotency_key = p_idempotency_key AND school_id = v_school_id;

  IF FOUND THEN
    -- Collision avec une campagne MOCK existante : REJET STRICT 22023 (Zéro modification de la campagne MOCK)
    IF v_existing_camp.delivery_mode = 'mock' THEN
      RAISE EXCEPTION 'La clé d’idempotence est déjà utilisée par une campagne MOCK.'
        USING ERRCODE = '22023';
    END IF;

    -- Campagne REAL existante : vérifier la conformité du payload pour le rejeu
    IF v_existing_camp.delivery_mode = 'real' THEN
      IF v_existing_camp.payload_hash <> v_real_payload_hash THEN
        RAISE EXCEPTION 'Rejeu d’idempotence avec un payload de campagne REAL différent.'
          USING ERRCODE = '22023';
      END IF;

      -- Récupérer le contrat canonique complet via get_school_collection_campaign
      v_base_res := public.get_school_collection_campaign(v_existing_camp.id);
      v_camp_obj := (v_base_res->'campaign') || pg_catalog.jsonb_build_object('delivery_mode', 'real');

      RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'campaign', v_camp_obj,
        'recipients', COALESCE(v_base_res->'recipients', '[]'::jsonb),
        'recipients_has_more', COALESCE((v_base_res->>'recipients_has_more')::boolean, false),
        'next_cursor_recipient_id', v_base_res->>'next_cursor_recipient_id',
        'is_idempotent_replay', true,
        'safety', pg_catalog.jsonb_build_object(
          'channel', 'email',
          'delivery_mode', 'real',
          'status', (v_camp_obj->>'status'),
          'no_message_sent', true
        )
      );
    END IF;
  END IF;

  -- 6. Première création : Réutilisation atomique de create_school_collection_campaign (Moteur 4D)
  v_mock_res := public.create_school_collection_campaign(
    p_name := p_name,
    p_channel := 'email',
    p_template := p_template,
    p_idempotency_key := p_idempotency_key,
    p_currency := p_currency,
    p_priority := p_priority,
    p_min_days_overdue := p_min_days_overdue,
    p_max_days_overdue := p_max_days_overdue,
    p_class_ids := p_class_ids
  );

  v_campaign_id := (v_mock_res->'campaign'->>'id')::UUID;

  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Échec de la création initiale de la campagne via le moteur d’éligibilité.'
      USING ERRCODE = '42P01';
  END IF;

  -- Verrouiller la campagne créée pour conversion atomique MOCK -> REAL
  SELECT * INTO v_campaign_record
  FROM public.school_collection_campaigns
  WHERE id = v_campaign_id AND school_id = v_school_id
  FOR UPDATE;

  IF v_campaign_record.status <> 'draft' OR v_campaign_record.channel <> 'email' THEN
    RAISE EXCEPTION 'Incohérence d’état lors de la conversion REAL de la campagne.'
      USING ERRCODE = '22023';
  END IF;

  -- Autoriser transactionnellement la conversion mock -> real
  PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_conversion', 'true', true);

  UPDATE public.school_collection_campaigns
  SET delivery_mode = 'real',
      payload_hash = v_real_payload_hash,
      updated_at = pg_catalog.now()
  WHERE id = v_campaign_id;

  -- Récupérer la réponse canonique complète à jour
  v_base_res := public.get_school_collection_campaign(v_campaign_id);
  v_camp_obj := (v_base_res->'campaign') || pg_catalog.jsonb_build_object('delivery_mode', 'real');

  -- 7. Construction de la réponse JSON conforme au contrat 4E-5AR
  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'campaign', v_camp_obj,
    'recipients', COALESCE(v_base_res->'recipients', '[]'::jsonb),
    'recipients_has_more', COALESCE((v_base_res->>'recipients_has_more')::boolean, false),
    'next_cursor_recipient_id', v_base_res->>'next_cursor_recipient_id',
    'is_idempotent_replay', false,
    'safety', pg_catalog.jsonb_build_object(
      'channel', 'email',
      'delivery_mode', 'real',
      'status', 'draft',
      'no_message_sent', true
    )
  );
END;
$$;

-- Droits RPC de création REAL
REVOKE EXECUTE ON FUNCTION public.create_school_real_email_campaign FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_school_real_email_campaign TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. RPC PUBLIQUE : PLANIFICATION D'UNE CAMPAGNE E-MAIL REAL
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.schedule_school_real_email_campaign(
  p_campaign_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_confirm_real_delivery BOOLEAN DEFAULT false,
  p_confirmation_text TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_school_id UUID;
  v_role TEXT;
  v_global_enabled BOOLEAN;
  v_sender_verified BOOLEAN;
  v_verified_from TEXT;
  v_school_email_enabled BOOLEAN;
  v_email_provider TEXT;
  v_campaign RECORD;
BEGIN
  -- 1. Authentification
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '28000';
  END IF;

  SELECT school_id, role INTO v_school_id, v_role
  FROM public.profiles
  WHERE id = v_user_id AND is_active = true;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur actif non trouvé.' USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'school_admin' THEN
    RAISE EXCEPTION 'Seul un administrateur d’établissement (school_admin) peut planifier une campagne e-mail REAL.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Confirmation explicite obligatoire
  IF p_confirm_real_delivery IS NOT TRUE OR pg_catalog.btrim(COALESCE(p_confirmation_text, '')) <> 'ENVOI EMAIL REEL' THEN
    RAISE EXCEPTION 'La confirmation explicite ''ENVOI EMAIL REEL'' avec p_confirm_real_delivery = true est obligatoire pour planifier une campagne REAL.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Validation de la date de planification
  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'La date de planification est obligatoire.' USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at < pg_catalog.now() THEN
    RAISE EXCEPTION 'La date de planification ne peut pas être dans le passé.' USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at > (pg_catalog.now() + INTERVAL '30 days') THEN
    RAISE EXCEPTION 'La date de planification ne peut pas dépasser 30 jours dans le futur.' USING ERRCODE = '22023';
  END IF;

  -- 4. Verrouillage SELECT ... FOR UPDATE de la campagne tenant-scoped
  SELECT * INTO v_campaign
  FROM public.school_collection_campaigns
  WHERE id = p_campaign_id AND school_id = v_school_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campagne introuvable ou non autorisée pour cet établissement.' USING ERRCODE = '42501';
  END IF;

  IF v_campaign.delivery_mode <> 'real' THEN
    RAISE EXCEPTION 'Seule une campagne en mode REAL peut être planifiée via cette fonction.'
      USING ERRCODE = '22023';
  END IF;

  IF v_campaign.channel <> 'email' THEN
    RAISE EXCEPTION 'Seule une campagne e-mail peut être planifiée via cette fonction.'
      USING ERRCODE = '22023';
  END IF;

  IF v_campaign.status <> 'draft' THEN
    RAISE EXCEPTION 'Seule une campagne en statut draft peut être planifiée (statut actuel : %).', v_campaign.status
      USING ERRCODE = '22023';
  END IF;

  IF v_campaign.recipient_count <= 0 OR v_campaign.pending_count <= 0 THEN
    RAISE EXCEPTION 'La campagne ne contient aucun destinataire admissible en attente.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.school_collection_real_email_jobs
    WHERE campaign_id = p_campaign_id
  ) THEN
    RAISE EXCEPTION 'Des jobs existent déjà pour cette campagne.' USING ERRCODE = '22023';
  END IF;

  -- 5. Revérification atomique de la readiness REAL sous verrous FOR SHARE
  SELECT real_email_enabled, sender_identity_verified, verified_from_email
  INTO v_global_enabled, v_sender_verified, v_verified_from
  FROM public.school_delivery_global_config
  WHERE id = 1
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La configuration globale de livraison est absente.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_global_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Le kill switch global e-mail réel est désactivé.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_sender_verified, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'L’identité expéditeur globale n’est pas vérifiée.' USING ERRCODE = '22023';
  END IF;

  IF v_verified_from IS NULL OR pg_catalog.btrim(v_verified_from) = '' THEN
    RAISE EXCEPTION 'L’e-mail expéditeur vérifié est manquant ou vide.' USING ERRCODE = '22023';
  END IF;

  SELECT email_real_enabled, email_provider
  INTO v_school_email_enabled, v_email_provider
  FROM public.school_delivery_settings
  WHERE school_id = v_campaign.school_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La configuration de livraison pour l’établissement est absente.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_school_email_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'L’envoi réel d’e-mails est désactivé pour cet établissement.' USING ERRCODE = '22023';
  END IF;

  IF v_email_provider IS NULL OR v_email_provider <> 'resend' THEN
    RAISE EXCEPTION 'Le fournisseur d’e-mail n’est pas configuré sur resend.' USING ERRCODE = '22023';
  END IF;

  -- 6. GUC transaction-local positionné seulement après toutes les validations
  PERFORM pg_catalog.set_config('app.internal_allow_real_campaign_scheduling', 'true', true);

  -- 7. Transition atomique draft -> scheduled
  UPDATE public.school_collection_campaigns
  SET status = 'scheduled',
      scheduled_at = p_scheduled_at,
      updated_at = pg_catalog.now()
  WHERE id = p_campaign_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'campaign_id', p_campaign_id,
    'delivery_mode', 'real',
    'channel', 'email',
    'status', 'scheduled',
    'scheduled_at', p_scheduled_at,
    'no_message_sent', true
  );
END;
$$;

-- Droits RPC de planification REAL
REVOKE EXECUTE ON FUNCTION public.schedule_school_real_email_campaign FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_school_real_email_campaign TO authenticated;

COMMIT;
