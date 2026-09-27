-- SUITE DE TESTS SQL TRANSACTIONNELS POUR HOTFIX LOT 2K-T3-V2
-- Fichier : supabase/tests/20260927043000_fix_parent_invitation_replay_ux_tests.sql

BEGIN;

-- 1. Inspection des privilèges et déclarations pg_proc
DO $$
DECLARE
  v_proc RECORD;
BEGIN
  -- get_parent_school_invitation_preview
  SELECT p.prosecdef, p.proconfig INTO v_proc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_parent_school_invitation_preview';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: public.get_parent_school_invitation_preview introuvable dans pg_proc.';
  END IF;

  IF NOT v_proc.prosecdef THEN
    RAISE EXCEPTION 'TEST FAILED: public.get_parent_school_invitation_preview doit être SECURITY DEFINER.';
  END IF;

  IF NOT ('search_path=""' = ANY(v_proc.proconfig) OR 'search_path=' = ANY(v_proc.proconfig)) THEN
    RAISE EXCEPTION 'TEST FAILED: public.get_parent_school_invitation_preview doit avoir SET search_path = ''''.';
  END IF;

  -- accept_parent_school_invitation
  SELECT p.prosecdef, p.proconfig INTO v_proc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'accept_parent_school_invitation';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: public.accept_parent_school_invitation introuvable dans pg_proc.';
  END IF;

  IF NOT v_proc.prosecdef THEN
    RAISE EXCEPTION 'TEST FAILED: public.accept_parent_school_invitation doit être SECURITY DEFINER.';
  END IF;

  IF NOT ('search_path=""' = ANY(v_proc.proconfig) OR 'search_path=' = ANY(v_proc.proconfig)) THEN
    RAISE EXCEPTION 'TEST FAILED: public.accept_parent_school_invitation doit avoir SET search_path = ''''.';
  END IF;

  RAISE NOTICE 'SUCCESS TEST 1: Privilèges pg_proc et isolation search_path vérifiés.';
END;
$$;


-- 2. Mise en place d'un environnement de test isolé dans la transaction
DO $$
DECLARE
  v_school_id UUID := '00000000-0000-4000-a000-000000000111'::UUID;
  v_student_id UUID := '00000000-0000-4000-a000-000000000222'::UUID;
  v_user_pending UUID := '00000000-0000-4000-a000-000000000333'::UUID;
  v_user_wrong UUID := '00000000-0000-4000-a000-000000000444'::UUID;
  v_inv_pending_id UUID := '00000000-0000-4000-a000-000000000555'::UUID;
  v_inv_accepted_id UUID := '00000000-0000-4000-a000-000000000666'::UUID;
  v_inv_expired_id UUID := '00000000-0000-4000-a000-000000000777'::UUID;
  v_inv_revoked_id UUID := '00000000-0000-4000-a000-000000000888'::UUID;

  v_token_pending TEXT := 'token_test_pending_1234567890';
  v_token_accepted TEXT := 'token_test_accepted_1234567890';
  v_token_expired TEXT := 'token_test_expired_1234567890';
  v_token_revoked TEXT := 'token_test_revoked_1234567890';

  v_hash_pending TEXT;
  v_hash_accepted TEXT;
  v_hash_expired TEXT;
  v_hash_revoked TEXT;

  v_res JSONB;
  v_mem_count INT;
  v_link_count INT;
BEGIN
  v_hash_pending := public.hash_invitation_token(v_token_pending);
  v_hash_accepted := public.hash_invitation_token(v_token_accepted);
  v_hash_expired := public.hash_invitation_token(v_token_expired);
  v_hash_revoked := public.hash_invitation_token(v_token_revoked);

  -- Création École
  INSERT INTO public.schools (id, name, slug, status, created_at, updated_at)
  VALUES (v_school_id, 'École Test T3', 'ecole-test-t3', 'active', pg_catalog.now(), pg_catalog.now());

  -- Création Élève
  INSERT INTO public.students (id, school_id, student_number, first_name, last_name, created_at, updated_at)
  VALUES (v_student_id, v_school_id, 'STU-001', 'Jean', 'Dupont', pg_catalog.now(), pg_catalog.now());

  -- Création Utilisateurs Auth & Profils
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES
    (v_user_pending, 'parent.pending@test.org', pg_catalog.now(), '{}'::jsonb),
    (v_user_wrong, 'parent.wrong@test.org', pg_catalog.now(), '{}'::jsonb);

  INSERT INTO public.profiles (id, school_id, first_name, last_name, role, is_active, created_at, updated_at)
  VALUES
    (v_user_pending, v_school_id, 'Parent', 'Pending', 'parent', true, pg_catalog.now(), pg_catalog.now()),
    (v_user_wrong, v_school_id, 'Parent', 'Wrong', 'parent', true, pg_catalog.now(), pg_catalog.now());

  INSERT INTO public.parent_accounts (profile_id, school_id, account_status, created_at, updated_at)
  VALUES
    (v_user_pending, v_school_id, 'active', pg_catalog.now(), pg_catalog.now()),
    (v_user_wrong, v_school_id, 'active', pg_catalog.now(), pg_catalog.now());

  -- Insertions des invitations
  -- 1. PENDING
  INSERT INTO public.school_membership_invitations (
    id, school_id, email_normalized, intended_role, token_hash, status, expires_at, invited_by, created_at, updated_at
  ) VALUES (
    v_inv_pending_id, v_school_id, 'parent.pending@test.org', 'parent', v_hash_pending, 'pending', pg_catalog.now() + interval '1 day', v_user_pending, pg_catalog.now(), pg_catalog.now()
  );

  INSERT INTO public.school_membership_invitation_students (invitation_id, school_id, student_id, relationship)
  VALUES (v_inv_pending_id, v_school_id, v_student_id, 'father');

  -- 2. ACCEPTED
  INSERT INTO public.school_membership_invitations (
    id, school_id, email_normalized, intended_role, token_hash, status, expires_at, invited_by, created_at, updated_at, consumed_at, accepted_by_profile_id
  ) VALUES (
    v_inv_accepted_id, v_school_id, 'parent.pending@test.org', 'parent', v_hash_accepted, 'accepted', pg_catalog.now() + interval '1 day', v_user_pending, pg_catalog.now() - interval '1 hour', pg_catalog.now(), pg_catalog.now(), v_user_pending
  );

  -- 3. EXPIRED
  INSERT INTO public.school_membership_invitations (
    id, school_id, email_normalized, intended_role, token_hash, status, expires_at, invited_by, created_at, updated_at
  ) VALUES (
    v_inv_expired_id, v_school_id, 'parent.pending@test.org', 'parent', v_hash_expired, 'expired', pg_catalog.now() - interval '1 hour', v_user_pending, pg_catalog.now() - interval '2 hours', pg_catalog.now()
  );

  -- 4. REVOKED
  INSERT INTO public.school_membership_invitations (
    id, school_id, email_normalized, intended_role, token_hash, status, expires_at, invited_by, revoked_at, created_at, updated_at
  ) VALUES (
    v_inv_revoked_id, v_school_id, 'parent.pending@test.org', 'parent', v_hash_revoked, 'revoked', pg_catalog.now() + interval '1 day', v_user_pending, pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  );


  -- --- SCÉNARIOS DE TEST PREVIEW ---

  -- Test Preview Non-authentifié / Utilisateur Null
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_res := public.get_parent_school_invitation_preview(v_token_pending);
  IF v_res->>'status' <> 'INVALID' THEN
    RAISE EXCEPTION 'TEST FAILED: Preview non authentifiée doit retourner INVALID.';
  END IF;

  -- Test Preview PENDING (avec session correcte)
  PERFORM set_config('request.jwt.claim.sub', v_user_pending::text, true);
  v_res := public.get_parent_school_invitation_preview(v_token_pending);
  IF v_res->>'status' <> 'PENDING' OR v_res->>'school_name' <> 'École Test T3' OR (v_res->>'student_count')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Preview PENDING incorrect. Reçu: %', v_res;
  END IF;

  -- Sécurité : Aucune fuite d'identifiant dans les clés du JSONB
  IF v_res ? 'email' OR v_res ? 'token_hash' OR v_res ? 'auth_user_id' OR v_res ? 'profile_id' OR v_res ? 'student_id' THEN
    RAISE EXCEPTION 'TEST FAILED: Fuite d’identifiants confidentiels dans get_parent_school_invitation_preview!';
  END IF;

  -- Test Preview ALREADY_ACCEPTED
  v_res := public.get_parent_school_invitation_preview(v_token_accepted);
  IF v_res->>'status' <> 'ALREADY_ACCEPTED' THEN
    RAISE EXCEPTION 'TEST FAILED: Preview ALREADY_ACCEPTED attendue, reçu: %', v_res;
  END IF;

  -- Test Preview EXPIRED
  v_res := public.get_parent_school_invitation_preview(v_token_expired);
  IF v_res->>'status' <> 'EXPIRED' THEN
    RAISE EXCEPTION 'TEST FAILED: Preview EXPIRED attendue, reçu: %', v_res;
  END IF;

  -- Test Preview REVOKED
  v_res := public.get_parent_school_invitation_preview(v_token_revoked);
  IF v_res->>'status' <> 'REVOKED' THEN
    RAISE EXCEPTION 'TEST FAILED: Preview REVOKED attendue, reçu: %', v_res;
  END IF;

  -- Test Preview WRONG_ACCOUNT
  PERFORM set_config('request.jwt.claim.sub', v_user_wrong::text, true);
  v_res := public.get_parent_school_invitation_preview(v_token_pending);
  IF v_res->>'status' <> 'WRONG_ACCOUNT' THEN
    RAISE EXCEPTION 'TEST FAILED: Preview WRONG_ACCOUNT attendue, reçu: %', v_res;
  END IF;

  -- Test Preview INVALID Token
  v_res := public.get_parent_school_invitation_preview('token_inconnu_totalement_invalid_999');
  IF v_res->>'status' <> 'INVALID' THEN
    RAISE EXCEPTION 'TEST FAILED: Preview INVALID attendue pour jeton inconnu, reçu: %', v_res;
  END IF;


  -- --- SCÉNARIOS DE TEST ACCEPTATION MUTANTE & ANTI-REJEU ---

  -- Test Acceptation PENDING réussie
  PERFORM set_config('request.jwt.claim.sub', v_user_pending::text, true);
  v_res := public.accept_parent_school_invitation(v_token_pending);
  IF (v_res->>'success')::BOOLEAN IS NOT TRUE OR (v_res->>'students_linked')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Acceptation PENDING échouée, reçu: %', v_res;
  END IF;

  -- Vérification de la mutation du statut vers 'accepted'
  IF NOT EXISTS (SELECT 1 FROM public.school_membership_invitations WHERE id = v_inv_pending_id AND status = 'accepted') THEN
    RAISE EXCEPTION 'TEST FAILED: L’invitation aurait dû passer au statut accepted.';
  END IF;

  -- Test REJEU (seconde tentative d'acceptation du même jeton désormais accepted)
  BEGIN
    PERFORM public.accept_parent_school_invitation(v_token_pending);
    RAISE EXCEPTION 'TEST FAILED: La tentative de rejeu aurait dû lever une exception!';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%déjà été acceptée%' THEN
        RAISE EXCEPTION 'TEST FAILED: Message de rejet du rejeu incorrect: %', SQLERRM;
      END IF;
  END;

  -- Vérification d'idempotence : Absence de doublon de school_membership
  SELECT COUNT(*) INTO v_mem_count
  FROM public.school_memberships
  WHERE profile_id = v_user_pending AND school_id = v_school_id AND role = 'parent';

  IF v_mem_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Nombre de memberships incorrect après rejeu (% au lieu de 1).', v_mem_count;
  END IF;

  -- Vérification d'idempotence : Absence de doublon de parent_student_link
  SELECT COUNT(*) INTO v_link_count
  FROM public.parent_student_links
  WHERE parent_profile_id = v_user_pending AND student_id = v_student_id;

  IF v_link_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Nombre de parent_student_links incorrect après rejeu (% au lieu de 1).', v_link_count;
  END IF;

  RAISE NOTICE 'SUCCESS TEST 2: Tous les scénarios SQL T3 v2 validés sans résidu!';
END;
$$;

ROLLBACK;
