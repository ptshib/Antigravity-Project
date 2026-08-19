-- Migration SQL : Extension de la table Schools (Suspension) & Audit Logs
-- Fichier : supabase/migrations/20260812230000_school_suspension_audit_schema.sql

-- 1. COLONNES DE SUSPENSION SUR SCHOOLS
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. TABLE D'AUDIT MULTI-ÉCOLES (School Audit Logs)
CREATE TABLE IF NOT EXISTS public.school_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index d'audit
CREATE INDEX IF NOT EXISTS idx_audit_school_id ON public.school_audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.school_audit_logs(created_at DESC);

-- 3. POLITIQUES RLS SUR SCHOOL_AUDIT_LOGS
ALTER TABLE public.school_audit_logs ENABLE ROW LEVEL SECURITY;

-- Supprimer les anciennes politiques pour éviter les doublons
DROP POLICY IF EXISTS "SuperAdmin full access audit logs" ON public.school_audit_logs;
DROP POLICY IF EXISTS "SchoolAdmin read own audit logs" ON public.school_audit_logs;

CREATE POLICY "SuperAdmin full access audit logs"
  ON public.school_audit_logs FOR ALL
  USING (public.is_super_admin());

CREATE POLICY "SchoolAdmin read own audit logs"
  ON public.school_audit_logs FOR SELECT
  USING (public.is_school_admin(school_id));

-- SÉCURITÉ : La fonction RPC create_school_admin_profile a été entièrement SUPPRIMÉE
-- pour interdire toute création privilégiée depuis le frontend ou la base sans passer
-- par la verification de jeton JWT et le controle cote serveur de l'Edge Function.
DROP FUNCTION IF EXISTS public.create_school_admin_profile(UUID, UUID, TEXT, TEXT, TEXT);
