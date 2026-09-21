-- Test Suite: 20260921120000_finance_4e9_remove_pilot_recovery_rpc_tests.sql
-- Validation de la suppression définitive de recover_pilot_real_email_job()

BEGIN;

DO $$
DECLARE
    v_err_caught BOOLEAN := false;
    v_sqlstate TEXT;
BEGIN
    -- Execute DROP statement
    DROP FUNCTION IF EXISTS public.recover_pilot_real_email_job();

    -- Tentative d'appel de la fonction supprimée
    BEGIN
        PERFORM public.recover_pilot_real_email_job();
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        v_err_caught := true;
    END;

    IF NOT v_err_caught THEN
        RAISE EXCEPTION 'TEST 4E9 ECHEC : recover_pilot_real_email_job() aurait dû être indéfinie après le DROP';
    END IF;

    IF v_sqlstate <> '42883' THEN
        RAISE EXCEPTION 'TEST 4E9 ECHEC : Code erreur inattendu (obtenu: %, attendu: 42883 undefined_function)', v_sqlstate;
    END IF;

    RAISE NOTICE '✓ SUITE SQL 4E-9 : Suppression de recover_pilot_real_email_job() confirmée (SQLSTATE 42883)';
END;
$$;

ROLLBACK;
