-- Migration : 20260820150000_school_fee_catalog_administration.sql
-- Description : RPCs SECURITY DEFINER pour l'administration sécurisée du catalogue des frais scolaires (school_fees)
-- Rôles autorisés : school_admin et finance_agent uniquement

--------------------------------------------------------------------------------
-- 1. RPC : CREATE_SCHOOL_FEE_CATALOG_ITEM
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_school_fee_catalog_item(
  p_academic_year_id UUID,
  p_fee_type TEXT,
  p_name TEXT,
  p_amount NUMERIC(14, 2),
  p_currency TEXT,
  p_due_date DATE,
  p_class_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_is_mandatory BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_school_id UUID;
  v_clean_name TEXT;
  v_fee_id UUID;
BEGIN
  -- 1. Authentification obligatoire
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET DE SÉCURITÉ : Utilisateur non authentifié (auth.uid() IS NULL).';
  END IF;

  -- 2. Résolution stricte de l'école et privilège du personnel financier (school_admin / finance_agent)
  SELECT p.school_id INTO v_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET DE SÉCURITÉ : Opération réservée exclusivement au personnel financier actif (school_admin, finance_agent).';
  END IF;

  -- 3. Validation de l'année académique rattachée à l'école
  IF NOT EXISTS (
    SELECT 1 FROM public.academic_years
    WHERE id = p_academic_year_id AND school_id = v_school_id
  ) THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : L''année académique spécifiée (%) n''appartient pas à l''établissement authentifié.', p_academic_year_id;
  END IF;

  -- 4. Validation optionnelle de la classe rattachée à l'école et à l'année académique
  IF p_class_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.classes
      WHERE id = p_class_id AND school_id = v_school_id AND academic_year_id = p_academic_year_id
    ) THEN
      RAISE EXCEPTION 'REJET CONTRÔLE : La classe spécifiée (%) n''appartient pas à l''année académique de cet établissement.', p_class_id;
    END IF;
  END IF;

  -- 5. Validation du type de frais
  IF p_fee_type NOT IN ('inscription', 'minerval', 'transport', 'cantine', 'uniforme', 'activites', 'frais_etat', 'autre') THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Type de frais invalide (%). Types autorisés : inscription, minerval, transport, cantine, uniforme, activites, frais_etat, autre.', p_fee_type;
  END IF;

  -- 6. Validation du montant (strictement positif)
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Le montant du tarif doit être strictement supérieur à zéro (montant fourni: %).', p_amount;
  END IF;

  -- 7. Validation de la devise
  IF p_currency NOT IN ('USD', 'CDF') THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Devise non supportée (%). Seules les devises USD et CDF sont autorisées.', p_currency;
  END IF;

  -- 8. Normalisation et contrôle du libellé
  v_clean_name := trim(p_name);
  IF length(v_clean_name) = 0 OR length(v_clean_name) > 150 THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Le nom du tarif est obligatoire et ne doit pas dépasser 150 caractères.';
  END IF;

  -- 9. Validation de la date d'échéance
  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : La date d''échéance par défaut du tarif est obligatoire.';
  END IF;

  -- 10. Anti-doublon métier : Vérifier l'absence d'un tarif actif identique pour la même classe/école/année/type/nom/devise
  IF EXISTS (
    SELECT 1 FROM public.school_fees
    WHERE school_id = v_school_id
      AND academic_year_id = p_academic_year_id
      AND (class_id IS NOT DISTINCT FROM p_class_id)
      AND fee_type = p_fee_type
      AND LOWER(TRIM(name)) = LOWER(v_clean_name)
      AND currency = p_currency
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'REJET MÉTIER : Un tarif actif identique ("%") existe déjà pour ce niveau/classe et cette année scolaire.', v_clean_name;
  END IF;

  -- 11. Insertion atomique
  INSERT INTO public.school_fees (
    school_id,
    academic_year_id,
    class_id,
    fee_type,
    name,
    description,
    amount,
    currency,
    due_date,
    is_mandatory,
    is_active,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_school_id,
    p_academic_year_id,
    p_class_id,
    p_fee_type,
    v_clean_name,
    trim(p_description),
    p_amount,
    p_currency,
    p_due_date,
    COALESCE(p_is_mandatory, true),
    true,
    v_caller_id,
    now(),
    now()
  )
  RETURNING id INTO v_fee_id;

  RETURN jsonb_build_object(
    'success', true,
    'fee_id', v_fee_id,
    'name', v_clean_name,
    'amount', p_amount,
    'currency', p_currency,
    'is_active', true,
    'created_at', now()
  );
END;
$$;

ALTER FUNCTION public.create_school_fee_catalog_item(UUID, TEXT, TEXT, NUMERIC, TEXT, DATE, UUID, TEXT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_school_fee_catalog_item(UUID, TEXT, TEXT, NUMERIC, TEXT, DATE, UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_school_fee_catalog_item(UUID, TEXT, TEXT, NUMERIC, TEXT, DATE, UUID, TEXT, BOOLEAN) TO authenticated;


--------------------------------------------------------------------------------
-- 2. RPC : UPDATE_SCHOOL_FEE_CATALOG_ITEM
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_school_fee_catalog_item(
  p_fee_id UUID,
  p_name TEXT,
  p_amount NUMERIC(14, 2),
  p_due_date DATE,
  p_description TEXT DEFAULT NULL,
  p_is_mandatory BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_school_id UUID;
  v_clean_name TEXT;
  v_existing_fee RECORD;
BEGIN
  -- 1. Authentification obligatoire
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET DE SÉCURITÉ : Utilisateur non authentifié (auth.uid() IS NULL).';
  END IF;

  -- 2. Résolution de l'école de l'agent connecté
  SELECT p.school_id INTO v_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET DE SÉCURITÉ : Opération réservée exclusivement au personnel financier actif (school_admin, finance_agent).';
  END IF;

  -- 3. Vérification de l'existence et propriété du tarif
  SELECT * INTO v_existing_fee
  FROM public.school_fees
  WHERE id = p_fee_id AND school_id = v_school_id;

  IF v_existing_fee.id IS NULL THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Le tarif spécifié (%) est introuvable ou n''appartient pas à votre établissement.', p_fee_id;
  END IF;

  -- 4. Validation du montant (strictement positif)
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Le montant du tarif doit être strictement supérieur à zéro (montant fourni: %).', p_amount;
  END IF;

  -- 5. Normalisation et contrôle du libellé
  v_clean_name := trim(p_name);
  IF length(v_clean_name) = 0 OR length(v_clean_name) > 150 THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Le nom du tarif est obligatoire et ne doit pas dépasser 150 caractères.';
  END IF;

  -- 6. Date d'échéance obligatoire
  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : La date d''échéance par défaut du tarif est obligatoire.';
  END IF;

  -- 7. Contrôle d'unicité sur modification du nom
  IF LOWER(TRIM(v_existing_fee.name)) <> LOWER(v_clean_name) THEN
    IF EXISTS (
      SELECT 1 FROM public.school_fees
      WHERE school_id = v_school_id
        AND academic_year_id = v_existing_fee.academic_year_id
        AND (class_id IS NOT DISTINCT FROM v_existing_fee.class_id)
        AND fee_type = v_existing_fee.fee_type
        AND LOWER(TRIM(name)) = LOWER(v_clean_name)
        AND currency = v_existing_fee.currency
        AND id <> p_fee_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'REJET MÉTIER : Un autre tarif actif nommé "%" existe déjà pour cette catégorie et ce niveau.', v_clean_name;
    END IF;
  END IF;

  -- 8. Mise à jour
  UPDATE public.school_fees
  SET
    name = v_clean_name,
    amount = p_amount,
    due_date = p_due_date,
    description = trim(p_description),
    is_mandatory = COALESCE(p_is_mandatory, true),
    updated_at = now()
  WHERE id = p_fee_id AND school_id = v_school_id;

  RETURN jsonb_build_object(
    'success', true,
    'fee_id', p_fee_id,
    'name', v_clean_name,
    'amount', p_amount,
    'updated_at', now()
  );
END;
$$;

ALTER FUNCTION public.update_school_fee_catalog_item(UUID, TEXT, NUMERIC, DATE, TEXT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_school_fee_catalog_item(UUID, TEXT, NUMERIC, DATE, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_school_fee_catalog_item(UUID, TEXT, NUMERIC, DATE, TEXT, BOOLEAN) TO authenticated;


--------------------------------------------------------------------------------
-- 3. RPC : SET_SCHOOL_FEE_CATALOG_ITEM_STATUS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_school_fee_catalog_item_status(
  p_fee_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_school_id UUID;
  v_existing_fee RECORD;
BEGIN
  -- 1. Authentification obligatoire
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'REJET DE SÉCURITÉ : Utilisateur non authentifié (auth.uid() IS NULL).';
  END IF;

  -- 2. Résolution de l'école du personnel connecté
  SELECT p.school_id INTO v_school_id
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = v_caller_id
    AND p.role IN ('school_admin', 'finance_agent')
    AND p.is_active = true
    AND s.status = 'active';

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'REJET DE SÉCURITÉ : Opération réservée exclusivement au personnel financier actif (school_admin, finance_agent).';
  END IF;

  -- 3. Vérification propriété du tarif
  SELECT * INTO v_existing_fee
  FROM public.school_fees
  WHERE id = p_fee_id AND school_id = v_school_id;

  IF v_existing_fee.id IS NULL THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Le tarif spécifié (%) est introuvable ou n''appartient pas à votre établissement.', p_fee_id;
  END IF;

  -- 4. Statut non nul
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'REJET CONTRÔLE : Le statut d''activation (p_is_active) est obligatoire.';
  END IF;

  -- 5. Mise à jour de statut
  UPDATE public.school_fees
  SET
    is_active = p_is_active,
    updated_at = now()
  WHERE id = p_fee_id AND school_id = v_school_id;

  RETURN jsonb_build_object(
    'success', true,
    'fee_id', p_fee_id,
    'is_active', p_is_active,
    'updated_at', now()
  );
END;
$$;

ALTER FUNCTION public.set_school_fee_catalog_item_status(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_school_fee_catalog_item_status(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_school_fee_catalog_item_status(UUID, BOOLEAN) TO authenticated;
