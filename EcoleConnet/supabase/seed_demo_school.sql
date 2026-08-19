-- ==============================================================================
-- Données fictives réservées aux environnements de test — ne pas exécuter en production.
-- Fichier : supabase/seed_demo_school.sql
-- ==============================================================================

-- 1. Établissement fictif de démonstration
INSERT INTO public.schools (id, name, slug, phone, whatsapp, email, address, country, status)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Complexe Scolaire Les Horizons',
  'les-horizons',
  '+243 819 883 084',
  '+420 776 308 018',
  'contact@leshorizons-ecole.cd',
  'Quartier Ma Campagne, Ngaliema',
  'RD Congo',
  'active'
) ON CONFLICT (slug) DO NOTHING;

-- 2. Année Scolaire de démonstration
INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  '2026–2027',
  '2026-09-01',
  '2027-07-02',
  true
) ON CONFLICT DO NOTHING;

-- 3. Trimestres de démonstration
INSERT INTO public.school_terms (school_id, academic_year_id, name, position, starts_on, ends_on)
VALUES 
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '1er Trimestre', 1, '2026-09-01', '2026-12-18'),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '2ème Trimestre', 2, '2027-01-05', '2027-04-02'),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '3ème Trimestre', 3, '2027-04-19', '2027-07-02')
ON CONFLICT DO NOTHING;
