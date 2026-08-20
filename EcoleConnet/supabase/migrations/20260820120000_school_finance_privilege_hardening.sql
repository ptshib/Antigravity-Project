-- ============================================================================
-- Migration : Durcissement des Privilèges PostgreSQL (Finance 1)
-- Fichier   : supabase/migrations/20260820120000_school_finance_privilege_hardening.sql
-- ============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. REVOKE TOTAL DES PRIVILÈGES SUR LES 6 TABLES FINANCIÈRES
--------------------------------------------------------------------------------

REVOKE ALL ON TABLE 
  public.school_finance_counters,
  public.school_fees,
  public.student_invoices,
  public.student_invoice_items,
  public.student_payments,
  public.payment_receipts
FROM PUBLIC, anon, authenticated;


--------------------------------------------------------------------------------
-- 2. ACCORD STRICT DU PRIVILÈGE SELECT À AUTHENTICATED
-- Justification : Nécessaire pour permettre au modèle RLS ('FinanceStaff read ...')
-- de filtrer les lectures directes pour les rôles autorisés (school_admin, finance_agent).
-- Sans GRANT SELECT, toute requête SELECT par authenticated échoue avec SQLSTATE 42501.
-- Aucun privilège INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ou TRIGGER n'est accordé.
--------------------------------------------------------------------------------

GRANT SELECT ON TABLE 
  public.school_finance_counters,
  public.school_fees,
  public.student_invoices,
  public.student_invoice_items,
  public.student_payments,
  public.payment_receipts
TO authenticated;


--------------------------------------------------------------------------------
-- 3. AUDIT DES FONCTIONS RPC ET MAINTIEN DES PRIVILÈGES SÉCURISÉS
--------------------------------------------------------------------------------

-- get_next_finance_counter est une fonction interne accessible uniquement au rôle superuser/postgres
REVOKE ALL ON FUNCTION public.get_next_finance_counter(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Révocation explicite des accès anonymes sur toutes les RPCs Finance
REVOKE ALL ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_student_invoice(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_student_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_student_payment(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_parent_student_finances(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_teacher_class_finance_overview(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_student_finance_dossier_admin(UUID, UUID) FROM PUBLIC, anon;

-- Maintien de l'exécution pour authenticated (la sécurité est assurée par SECURITY DEFINER + checks internes)
GRANT EXECUTE ON FUNCTION public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_student_invoice(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_student_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_student_payment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_parent_student_finances(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_class_finance_overview(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_finance_dossier_admin(UUID, UUID) TO authenticated;


--------------------------------------------------------------------------------
-- 4. CONTRÔLE FAIL-FAST DE SÉCURITÉ ET AUDIT DES PRIVILÈGES FINAUX
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_table TEXT;
  v_priv TEXT;
  v_tables TEXT[] := ARRAY[
    'school_finance_counters',
    'school_fees',
    'student_invoices',
    'student_invoice_items',
    'student_payments',
    'payment_receipts'
  ];
  v_forbidden_privs TEXT[] := ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_all_privs TEXT[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    -- 4.1 Contrôle d'étanchéité totale pour le rôle 'anon'
    FOREACH v_priv IN ARRAY v_all_privs LOOP
      IF has_table_privilege('anon', 'public.' || quote_ident(v_table), v_priv) THEN
        RAISE EXCEPTION 'VIOLATION SÉCURITÉ FAIL-FAST : Le rôle "anon" possède le privilège % sur la table public.%.', v_priv, v_table
          USING ERRCODE = '42501';
      END IF;
    END LOOP;

    -- 4.2 Interdiction stricte des privilèges de mutation et structurels pour 'authenticated'
    FOREACH v_priv IN ARRAY v_forbidden_privs LOOP
      IF has_table_privilege('authenticated', 'public.' || quote_ident(v_table), v_priv) THEN
        RAISE EXCEPTION 'VIOLATION SÉCURITÉ FAIL-FAST : Le rôle "authenticated" possède le privilège interdit % sur la table public.%.', v_priv, v_table
          USING ERRCODE = '42501';
      END IF;
    END LOOP;

    -- 4.3 Validation que 'authenticated' possède bien le privilège SELECT (requis pour la RLS)
    IF NOT has_table_privilege('authenticated', 'public.' || quote_ident(v_table), 'SELECT') THEN
      RAISE EXCEPTION 'ÉCHEC FAIL-FAST ARCHITECTURE : Le rôle "authenticated" doit posséder le privilège SELECT sur public.% pour que le modèle RLS fonctionne.', v_table
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- 4.4 Contrôle fail-fast des privilèges EXECUTE sur les fonctions RPC (has_function_privilege)
  -- A. Le rôle "anon" ne doit pouvoir exécuter AUCUNE des 8 fonctions RPC Finance
  IF has_function_privilege('anon', 'public.get_next_finance_counter(UUID, UUID, TEXT)', 'EXECUTE') OR
     has_function_privilege('anon', 'public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE)', 'EXECUTE') OR
     has_function_privilege('anon', 'public.issue_student_invoice(UUID)', 'EXECUTE') OR
     has_function_privilege('anon', 'public.record_student_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, TEXT)', 'EXECUTE') OR
     has_function_privilege('anon', 'public.cancel_student_payment(UUID, TEXT)', 'EXECUTE') OR
     has_function_privilege('anon', 'public.get_parent_student_finances(UUID)', 'EXECUTE') OR
     has_function_privilege('anon', 'public.get_teacher_class_finance_overview(UUID)', 'EXECUTE') OR
     has_function_privilege('anon', 'public.get_student_finance_dossier_admin(UUID, UUID)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VIOLATION SÉCURITÉ FAIL-FAST : Le rôle "anon" possède le privilège EXECUTE sur au moins une RPC Finance.'
      USING ERRCODE = '42501';
  END IF;

  -- B. Le rôle "authenticated" ne doit pas pouvoir exécuter la fonction interne get_next_finance_counter
  IF has_function_privilege('authenticated', 'public.get_next_finance_counter(UUID, UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VIOLATION SÉCURITÉ FAIL-FAST : Le rôle "authenticated" possède le privilège EXECUTE sur le compteur interne get_next_finance_counter.'
      USING ERRCODE = '42501';
  END IF;

  -- C. Le rôle "authenticated" doit pouvoir exécuter exactement les 7 RPCs publiques
  IF NOT (
    has_function_privilege('authenticated', 'public.create_draft_student_invoice(UUID, UUID, DATE, TEXT, JSONB, DATE)', 'EXECUTE') AND
    has_function_privilege('authenticated', 'public.issue_student_invoice(UUID)', 'EXECUTE') AND
    has_function_privilege('authenticated', 'public.record_student_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, TEXT)', 'EXECUTE') AND
    has_function_privilege('authenticated', 'public.cancel_student_payment(UUID, TEXT)', 'EXECUTE') AND
    has_function_privilege('authenticated', 'public.get_parent_student_finances(UUID)', 'EXECUTE') AND
    has_function_privilege('authenticated', 'public.get_teacher_class_finance_overview(UUID)', 'EXECUTE') AND
    has_function_privilege('authenticated', 'public.get_student_finance_dossier_admin(UUID, UUID)', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'ÉCHEC FAIL-FAST ARCHITECTURE : Le rôle "authenticated" doit posséder le privilège EXECUTE sur toutes les RPCs publiques Finance.'
      USING ERRCODE = '42501';
  END IF;

  RAISE NOTICE 'Succès fail-fast : Les privilèges sur les tables et RPCs financières sont parfaitement sécurisés et durcis.';
END $$;

COMMIT;
