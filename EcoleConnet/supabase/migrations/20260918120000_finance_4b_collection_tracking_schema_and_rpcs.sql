-- =============================================================================
-- ÉCOLECONNECT — MIGRATION FINANCE 4B (DURCIE AVEC CURSEUR FUTUR VALIDE)
-- Fichier: 20260918120000_finance_4b_collection_tracking_schema_and_rpcs.sql
-- Description: Table append-only public.school_invoice_collection_actions
--              et RPCs create_invoice_collection_action, get_invoice_collection_history
--              & get_school_collection_followups (Curseurs futurs autorisés)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLE APPEND-ONLY: public.school_invoice_collection_actions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_invoice_collection_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES public.student_invoices(id) ON DELETE RESTRICT,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    action_type TEXT NOT NULL CHECK (action_type IN ('phone', 'email', 'sms', 'whatsapp', 'meeting', 'note')),
    note TEXT NOT NULL,
    idempotency_key UUID NOT NULL,
    contacted_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    promise_to_pay_date DATE NULL,
    next_follow_up_date DATE NULL,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT uq_collection_action_idempotency UNIQUE (school_id, idempotency_key),
    CONSTRAINT chk_collection_action_note_length CHECK (
        pg_catalog.length(pg_catalog.btrim(note)) >= 5 AND pg_catalog.length(note) <= 1000
    )
);

-- Indexation optimisée
CREATE INDEX IF NOT EXISTS idx_collection_actions_invoice_lookup
ON public.school_invoice_collection_actions (school_id, invoice_id, contacted_at DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_collection_actions_promise_date
ON public.school_invoice_collection_actions (school_id, promise_to_pay_date)
WHERE promise_to_pay_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collection_actions_followup_date
ON public.school_invoice_collection_actions (school_id, next_follow_up_date)
WHERE next_follow_up_date IS NOT NULL;

-- Sécurité RLS et révocation complète des mutations directes
ALTER TABLE public.school_invoice_collection_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_invoice_collection_actions FROM PUBLIC, anon, authenticated;
ALTER TABLE public.school_invoice_collection_actions OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 2. RPC PUBLIQUE: create_invoice_collection_action(...)
-- -----------------------------------------------------------------------------

-- Nettoyage explicite de tout ancien overload à 5 paramètres
DROP FUNCTION IF EXISTS public.create_invoice_collection_action(UUID, TEXT, TEXT, DATE, DATE);

CREATE OR REPLACE FUNCTION public.create_invoice_collection_action(
    p_invoice_id UUID,
    p_action_type TEXT,
    p_note TEXT,
    p_idempotency_key UUID,
    p_promise_to_pay_date DATE DEFAULT NULL,
    p_next_follow_up_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_profile public.profiles%ROWTYPE;
    v_school public.schools%ROWTYPE;
    v_invoice public.student_invoices%ROWTYPE;
    v_existing_action public.school_invoice_collection_actions%ROWTYPE;
    v_valid_tz TEXT;
    v_business_date DATE;
    v_note TEXT;
    v_creator_name TEXT;
    v_action_id UUID;
    v_contacted_at TIMESTAMPTZ;
    v_created_at TIMESTAMPTZ;
BEGIN
    -- 1. Authentification & profil
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated access' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id;
    IF v_profile.id IS NULL OR v_profile.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('school_admin', 'finance_agent') THEN
        RAISE EXCEPTION 'Forbidden: insufficient finance privileges' USING ERRCODE = '42501';
    END IF;

    -- 2. Clé d'idempotence obligatoire
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'REJET : La clé d idempotence p_idempotency_key est obligatoire.' USING ERRCODE = '22023';
    END IF;

    -- 3. École & Timezone
    SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
    IF v_school.id IS NULL OR v_school.status != 'active' THEN
        RAISE EXCEPTION 'Active school required' USING ERRCODE = '42501';
    END IF;

    IF v_school.timezone IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_school.timezone
    ) THEN
        v_valid_tz := v_school.timezone;
    ELSE
        v_valid_tz := 'Africa/Kinshasa';
    END IF;

    v_business_date := (pg_catalog.now() AT TIME ZONE v_valid_tz)::DATE;

    -- 4. Normalisation de la note avant tout contrôle
    IF p_note IS NULL THEN
        RAISE EXCEPTION 'REJET : La note de relance ne peut pas être NULL.' USING ERRCODE = '22023';
    END IF;

    v_note := pg_catalog.btrim(p_note);
    IF pg_catalog.length(v_note) < 5 OR pg_catalog.length(p_note) > 1000 THEN
        RAISE EXCEPTION 'REJET : La note de relance doit contenir entre 5 et 1000 caractères.'
            USING ERRCODE = '22023';
    END IF;

    -- 5. Contrôle d'Idempotence (Détection de rejeu)
    SELECT * INTO v_existing_action
    FROM public.school_invoice_collection_actions
    WHERE school_id = v_profile.school_id AND idempotency_key = p_idempotency_key;

    IF v_existing_action.id IS NOT NULL THEN
        -- Vérification du contenu canonique de la demande idempotente
        IF v_existing_action.invoice_id = p_invoice_id
           AND v_existing_action.action_type = p_action_type
           AND pg_catalog.btrim(v_existing_action.note) = v_note
           AND v_existing_action.promise_to_pay_date IS NOT DISTINCT FROM p_promise_to_pay_date
           AND v_existing_action.next_follow_up_date IS NOT DISTINCT FROM p_next_follow_up_date THEN

            SELECT pg_catalog.btrim(pg_catalog.concat_ws(' ', pr.first_name, pr.last_name)) INTO v_creator_name
            FROM public.profiles pr WHERE pr.id = v_existing_action.created_by;

            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'is_idempotent_replay', true,
                'action_id', v_existing_action.id,
                'invoice_id', v_existing_action.invoice_id,
                'school_id', v_existing_action.school_id,
                'action_type', v_existing_action.action_type,
                'note', v_existing_action.note,
                'idempotency_key', v_existing_action.idempotency_key,
                'contacted_at', pg_catalog.to_char(v_existing_action.contacted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'promise_to_pay_date', v_existing_action.promise_to_pay_date,
                'next_follow_up_date', v_existing_action.next_follow_up_date,
                'created_by', v_existing_action.created_by,
                'created_by_name', v_creator_name,
                'created_at', pg_catalog.to_char(v_existing_action.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            );
        ELSE
            RAISE EXCEPTION 'REJET : Conflit d idempotence. La clé % a déjà été utilisée avec un contenu différent.', p_idempotency_key
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 6. Chargement verrouillé de la facture (FOR UPDATE)
    IF p_invoice_id IS NULL THEN
        RAISE EXCEPTION 'REJET : L identifiant de la facture p_invoice_id est obligatoire.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_invoice FROM public.student_invoices WHERE id = p_invoice_id FOR UPDATE;

    IF v_invoice.id IS NULL OR v_invoice.school_id != v_profile.school_id THEN
        RAISE EXCEPTION 'Forbidden: facture introuvable ou hors établissement.' USING ERRCODE = '42501';
    END IF;

    -- Statut éligible uniquement (issued, partially_paid avec solde > 0)
    IF v_invoice.status NOT IN ('issued', 'partially_paid') OR v_invoice.remaining_balance <= 0 THEN
        RAISE EXCEPTION 'REJET : Seules les factures émises ou partiellement payées avec un solde strictly positif peuvent recevoir une relance (statut actuel: %, solde: %).', v_invoice.status, v_invoice.remaining_balance
            USING ERRCODE = '22023';
    END IF;

    -- 7. Validation type d'action
    IF p_action_type IS NULL OR p_action_type NOT IN ('phone', 'email', 'sms', 'whatsapp', 'meeting', 'note') THEN
        RAISE EXCEPTION 'REJET : Type d action de relance invalide (reçu: %).', p_action_type
            USING ERRCODE = '22023';
    END IF;

    -- 8. Validation des dates (promises et prochains suivis ne peuvent être antérieures à business_date)
    IF p_promise_to_pay_date IS NOT NULL AND p_promise_to_pay_date < v_business_date THEN
        RAISE EXCEPTION 'REJET : La date de promesse de paiement ne peut pas être antérieure à la date métier courante (%).', v_business_date
            USING ERRCODE = '22023';
    END IF;

    IF p_next_follow_up_date IS NOT NULL AND p_next_follow_up_date < v_business_date THEN
        RAISE EXCEPTION 'REJET : La date du prochain suivi ne peut pas être antérieure à la date métier courante (%).', v_business_date
            USING ERRCODE = '22023';
    END IF;

    -- 9. Insertion immuable de l'action avec protection contre la violation d'unicité concurrente
    v_creator_name := pg_catalog.btrim(pg_catalog.concat_ws(' ', v_profile.first_name, v_profile.last_name));
    v_contacted_at := pg_catalog.clock_timestamp();
    v_created_at := v_contacted_at;

    BEGIN
        INSERT INTO public.school_invoice_collection_actions (
            invoice_id,
            school_id,
            action_type,
            note,
            idempotency_key,
            contacted_at,
            promise_to_pay_date,
            next_follow_up_date,
            created_by,
            created_at
        ) VALUES (
            v_invoice.id,
            v_profile.school_id,
            p_action_type,
            v_note,
            p_idempotency_key,
            v_contacted_at,
            p_promise_to_pay_date,
            p_next_follow_up_date,
            v_caller_id,
            v_created_at
        )
        RETURNING id INTO v_action_id;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT * INTO v_existing_action
            FROM public.school_invoice_collection_actions
            WHERE school_id = v_profile.school_id AND idempotency_key = p_idempotency_key;

            IF v_existing_action.id IS NOT NULL
               AND v_existing_action.invoice_id = p_invoice_id
               AND v_existing_action.action_type = p_action_type
               AND pg_catalog.btrim(v_existing_action.note) = v_note
               AND v_existing_action.promise_to_pay_date IS NOT DISTINCT FROM p_promise_to_pay_date
               AND v_existing_action.next_follow_up_date IS NOT DISTINCT FROM p_next_follow_up_date THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', true,
                    'is_idempotent_replay', true,
                    'action_id', v_existing_action.id,
                    'invoice_id', v_existing_action.invoice_id,
                    'school_id', v_existing_action.school_id,
                    'action_type', v_existing_action.action_type,
                    'note', v_existing_action.note,
                    'idempotency_key', v_existing_action.idempotency_key,
                    'contacted_at', pg_catalog.to_char(v_existing_action.contacted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'promise_to_pay_date', v_existing_action.promise_to_pay_date,
                    'next_follow_up_date', v_existing_action.next_follow_up_date,
                    'created_by', v_existing_action.created_by,
                    'created_by_name', v_creator_name,
                    'created_at', pg_catalog.to_char(v_existing_action.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                );
            ELSE
                RAISE EXCEPTION 'REJET : Conflit d idempotence concurrentiel sur la clé %.', p_idempotency_key USING ERRCODE = '22023';
            END IF;
    END;

    -- 10. Retour JSONB première création (is_idempotent_replay = false)
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'is_idempotent_replay', false,
        'action_id', v_action_id,
        'invoice_id', v_invoice.id,
        'school_id', v_profile.school_id,
        'action_type', p_action_type,
        'note', v_note,
        'idempotency_key', p_idempotency_key,
        'contacted_at', pg_catalog.to_char(v_contacted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'promise_to_pay_date', p_promise_to_pay_date,
        'next_follow_up_date', p_next_follow_up_date,
        'created_by', v_caller_id,
        'created_by_name', v_creator_name,
        'created_at', pg_catalog.to_char(v_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_collection_action(UUID, TEXT, TEXT, UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_collection_action(UUID, TEXT, TEXT, UUID, DATE, DATE) TO authenticated;
ALTER FUNCTION public.create_invoice_collection_action(UUID, TEXT, TEXT, UUID, DATE, DATE) OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 3. RPC PUBLIQUE: get_invoice_collection_history(...)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_invoice_collection_history(
    p_invoice_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_profile public.profiles%ROWTYPE;
    v_invoice public.student_invoices%ROWTYPE;
    v_actions JSONB := '[]'::jsonb;
    v_rec RECORD;
    v_count INTEGER := 0;
BEGIN
    -- 1. Auth & Profil
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated access' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id;
    IF v_profile.id IS NULL OR v_profile.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('school_admin', 'finance_agent') THEN
        RAISE EXCEPTION 'Forbidden: insufficient finance privileges' USING ERRCODE = '42501';
    END IF;

    -- 2. Facture & Isolation
    IF p_invoice_id IS NULL THEN
        RAISE EXCEPTION 'REJET : p_invoice_id est obligatoire.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_invoice FROM public.student_invoices WHERE id = p_invoice_id;
    IF v_invoice.id IS NULL OR v_invoice.school_id != v_profile.school_id THEN
        RAISE EXCEPTION 'Forbidden: facture introuvable ou hors établissement.' USING ERRCODE = '42501';
    END IF;

    -- 3. Récupération chronologique décroissante
    FOR v_rec IN
        SELECT
            act.id,
            act.invoice_id,
            act.school_id,
            act.action_type,
            act.note,
            act.idempotency_key,
            act.contacted_at,
            act.promise_to_pay_date,
            act.next_follow_up_date,
            act.created_by,
            pg_catalog.btrim(pg_catalog.concat_ws(' ', pr.first_name, pr.last_name)) AS created_by_name,
            act.created_at
        FROM public.school_invoice_collection_actions act
        JOIN public.profiles pr ON pr.id = act.created_by
        WHERE act.invoice_id = p_invoice_id AND act.school_id = v_profile.school_id
        ORDER BY act.contacted_at DESC, act.created_at DESC, act.id DESC
    LOOP
        v_count := v_count + 1;
        v_actions := v_actions || pg_catalog.jsonb_build_object(
            'id', v_rec.id,
            'invoice_id', v_rec.invoice_id,
            'school_id', v_rec.school_id,
            'action_type', v_rec.action_type,
            'note', v_rec.note,
            'idempotency_key', v_rec.idempotency_key,
            'contacted_at', pg_catalog.to_char(v_rec.contacted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'promise_to_pay_date', v_rec.promise_to_pay_date,
            'next_follow_up_date', v_rec.next_follow_up_date,
            'created_by', v_rec.created_by,
            'created_by_name', v_rec.created_by_name,
            'created_at', pg_catalog.to_char(v_rec.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        );
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'invoice_id', p_invoice_id,
        'total_actions', v_count,
        'actions', v_actions
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_invoice_collection_history(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_collection_history(UUID) TO authenticated;
ALTER FUNCTION public.get_invoice_collection_history(UUID) OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 4. RPC PUBLIQUE: get_school_collection_followups(...)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_school_collection_followups(
    p_currency TEXT DEFAULT NULL,
    p_status_filter TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_cursor_effective_date DATE DEFAULT NULL,
    p_cursor_invoice_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_profile public.profiles%ROWTYPE;
    v_school public.schools%ROWTYPE;
    v_valid_tz TEXT;
    v_business_date DATE;
    v_limit INTEGER;

    v_has_more BOOLEAN := FALSE;
    v_next_cursor JSONB := NULL;
    v_items JSONB := '[]'::jsonb;

    v_rec RECORD;
    v_row_count INTEGER := 0;
    v_last_effective_date DATE := NULL;
    v_last_invoice_id UUID := NULL;
BEGIN
    -- 1. Auth & Profil
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated access' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id;
    IF v_profile.id IS NULL OR v_profile.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active user profile required' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('school_admin', 'finance_agent') THEN
        RAISE EXCEPTION 'Forbidden: insufficient finance privileges' USING ERRCODE = '42501';
    END IF;

    -- 2. École & Timezone
    SELECT * INTO v_school FROM public.schools WHERE id = v_profile.school_id;
    IF v_school.id IS NULL OR v_school.status != 'active' THEN
        RAISE EXCEPTION 'Active school required' USING ERRCODE = '42501';
    END IF;

    IF v_school.timezone IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_school.timezone
    ) THEN
        v_valid_tz := v_school.timezone;
    ELSE
        v_valid_tz := 'Africa/Kinshasa';
    END IF;

    v_business_date := (pg_catalog.now() AT TIME ZONE v_valid_tz)::DATE;

    -- 3. Validation des filtres
    IF p_limit IS NULL THEN
        v_limit := 20;
    ELSIF p_limit <= 0 OR p_limit > 100 THEN
        RAISE EXCEPTION 'REJET : Le paramètre p_limit doit être compris entre 1 et 100.' USING ERRCODE = '22023';
    ELSE
        v_limit := p_limit;
    END IF;

    IF p_currency IS NOT NULL AND p_currency NOT IN ('USD', 'CDF') THEN
        RAISE EXCEPTION 'REJET : Le paramètre p_currency doit être NULL, USD ou CDF.' USING ERRCODE = '22023';
    END IF;

    IF p_status_filter IS NOT NULL AND p_status_filter NOT IN ('all', 'promise_overdue', 'followup_due', 'never_contacted') THEN
        RAISE EXCEPTION 'REJET : p_status_filter invalide (reçu: %).', p_status_filter USING ERRCODE = '22023';
    END IF;

    -- Validation du curseur : les deux paramètres doivent être tous deux NULL ou tous deux fournis
    IF (p_cursor_effective_date IS NULL AND p_cursor_invoice_id IS NOT NULL) OR (p_cursor_effective_date IS NOT NULL AND p_cursor_invoice_id IS NULL) THEN
        RAISE EXCEPTION 'REJET : Les paramètres de curseur p_cursor_effective_date et p_cursor_invoice_id doivent être tous les deux NULL ou tous les deux fournis.' USING ERRCODE = '22023';
    END IF;

    -- REMARQUE : Tout rejet sur p_cursor_effective_date > v_business_date a été SUPPRIMÉ.
    -- Les curseurs futurs sont 100% légitimes car effective_follow_up_date peut désigner une promesse ou un suivi futur.

    -- 4. Requête Keyset N+1 basée strictement sur la dernière action déterministe
    FOR v_rec IN
        WITH invoice_base AS (
            SELECT
                inv.id AS invoice_id,
                inv.invoice_number,
                inv.student_id,
                pg_catalog.btrim(pg_catalog.concat_ws(' ', st.first_name, st.middle_name, st.last_name)) AS student_name,
                st.student_number,
                c.name AS class_name,
                inv.due_date AS invoice_due_date,
                (v_business_date - inv.due_date) AS days_overdue,
                inv.currency,
                inv.total_amount,
                inv.paid_amount,
                inv.remaining_balance,
                inv.status AS invoice_status,
                act.id AS latest_action_id,
                act.action_type AS latest_action_type,
                act.note AS latest_note,
                act.idempotency_key AS latest_idempotency_key,
                act.contacted_at AS latest_contacted_at,
                act.promise_to_pay_date AS latest_promise_to_pay_date,
                act.next_follow_up_date AS latest_next_follow_up_date,
                pg_catalog.btrim(pg_catalog.concat_ws(' ', pr.first_name, pr.last_name)) AS last_contacted_by_name
            FROM public.student_invoices inv
            JOIN public.students st ON st.id = inv.student_id AND st.school_id = inv.school_id
            JOIN public.classes c ON c.id = inv.class_id AND c.school_id = inv.school_id
            LEFT JOIN LATERAL (
                SELECT a.*
                FROM public.school_invoice_collection_actions a
                WHERE a.invoice_id = inv.id AND a.school_id = inv.school_id
                ORDER BY a.contacted_at DESC, a.created_at DESC, a.id DESC
                LIMIT 1
            ) act ON TRUE
            LEFT JOIN public.profiles pr ON pr.id = act.created_by
            WHERE inv.school_id = v_profile.school_id
              AND inv.status IN ('issued', 'partially_paid')
              AND inv.remaining_balance > 0
              AND (p_currency IS NULL OR inv.currency = p_currency)
        ),
        evaluated_base AS (
            SELECT
                ib.*,
                CASE
                    WHEN ib.latest_action_id IS NULL THEN 'never_contacted'
                    WHEN ib.latest_promise_to_pay_date IS NOT NULL AND ib.latest_promise_to_pay_date < v_business_date THEN 'promise_overdue'
                    WHEN ib.latest_next_follow_up_date IS NOT NULL AND ib.latest_next_follow_up_date <= v_business_date THEN 'followup_due'
                    WHEN ib.latest_promise_to_pay_date IS NOT NULL AND ib.latest_promise_to_pay_date >= v_business_date THEN 'promise_pending'
                    ELSE 'contacted'
                END AS collection_status,
                COALESCE(ib.latest_next_follow_up_date, ib.latest_promise_to_pay_date, ib.invoice_due_date) AS effective_follow_up_date
            FROM invoice_base ib
        )
        SELECT *
        FROM evaluated_base eb
        WHERE (
            p_status_filter IS NULL OR p_status_filter = 'all' OR
            (p_status_filter = 'promise_overdue' AND eb.collection_status = 'promise_overdue') OR
            (p_status_filter = 'followup_due' AND eb.collection_status = 'followup_due') OR
            (p_status_filter = 'never_contacted' AND eb.collection_status = 'never_contacted')
        )
        AND (
            p_cursor_effective_date IS NULL OR
            (eb.effective_follow_up_date, eb.invoice_id) > (p_cursor_effective_date, p_cursor_invoice_id)
        )
        ORDER BY eb.effective_follow_up_date ASC, eb.invoice_id ASC
        LIMIT (v_limit + 1)
    LOOP
        v_row_count := v_row_count + 1;

        IF v_row_count <= v_limit THEN
            v_items := v_items || pg_catalog.jsonb_build_object(
                'invoice_id', v_rec.invoice_id,
                'invoice_number', v_rec.invoice_number,
                'student_id', v_rec.student_id,
                'student_name', v_rec.student_name,
                'student_number', v_rec.student_number,
                'class_name', v_rec.class_name,
                'invoice_due_date', v_rec.invoice_due_date,
                'days_overdue', v_rec.days_overdue,
                'currency', v_rec.currency,
                'total_amount', v_rec.total_amount,
                'paid_amount', v_rec.paid_amount,
                'remaining_balance', v_rec.remaining_balance,
                'invoice_status', v_rec.invoice_status,
                'collection_status', v_rec.collection_status,
                'effective_follow_up_date', v_rec.effective_follow_up_date,
                'latest_action_id', v_rec.latest_action_id,
                'latest_action_type', v_rec.latest_action_type,
                'latest_note', v_rec.latest_note,
                'latest_idempotency_key', v_rec.latest_idempotency_key,
                'latest_contacted_at', CASE WHEN v_rec.latest_contacted_at IS NOT NULL THEN pg_catalog.to_char(v_rec.latest_contacted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
                'latest_promise_to_pay_date', v_rec.latest_promise_to_pay_date,
                'latest_next_follow_up_date', v_rec.latest_next_follow_up_date,
                'last_contacted_by_name', v_rec.last_contacted_by_name
            );
            v_last_effective_date := v_rec.effective_follow_up_date;
            v_last_invoice_id := v_rec.invoice_id;
        ELSE
            v_has_more := TRUE;
        END IF;
    END LOOP;

    IF v_has_more THEN
        v_next_cursor := pg_catalog.jsonb_build_object(
            'effective_date', v_last_effective_date,
            'invoice_id', v_last_invoice_id
        );
    ELSE
        v_next_cursor := NULL;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'business_date', v_business_date,
        'items', v_items,
        'has_more', v_has_more,
        'next_cursor', v_next_cursor
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_school_collection_followups(TEXT, TEXT, INTEGER, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_collection_followups(TEXT, TEXT, INTEGER, DATE, UUID) TO authenticated;
ALTER FUNCTION public.get_school_collection_followups(TEXT, TEXT, INTEGER, DATE, UUID) OWNER TO postgres;
