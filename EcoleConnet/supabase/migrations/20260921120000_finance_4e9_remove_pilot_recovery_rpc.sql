-- Migration: 20260921120000_finance_4e9_remove_pilot_recovery_rpc.sql
-- Description: Suppression de la RPC temporaire de récupération du pilote (recover_pilot_real_email_job) sans CASCADE

DROP FUNCTION IF EXISTS public.recover_pilot_real_email_job();
