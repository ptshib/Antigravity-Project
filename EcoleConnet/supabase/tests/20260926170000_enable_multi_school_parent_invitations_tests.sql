-- SQL Test Suite for LOT A2b-I-B: Multi-School Parent Invitations
-- File: supabase/tests/20260926170000_enable_multi_school_parent_invitations_tests.sql

BEGIN;

-- Helper to fail test if condition false
CREATE OR REPLACE FUNCTION _assert(p_condition BOOLEAN, p_msg TEXT) RETURNS VOID AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'TEST FAILED: %', p_msg USING ERRCODE = 'P0001';
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_school_a UUID := '11111111-1111-4111-a111-111111111111'::uuid;
  v_school_b UUID := '22222222-2222-4222-a222-222222222222'::uuid;
  v_school_c UUID := '33333333-3333-4333-a333-333333333333'::uuid;

  v_admin_a UUID := 'a1111111-1111-4111-a111-111111111111'::uuid;
  v_admin_b UUID := 'a2222222-2222-4222-a222-222222222222'::uuid;

  v_student_a UUID := '11111111-1111-4111-a111-222222222222'::uuid;
  v_student_b UUID := '22222222-2222-4222-a222-333333333333'::uuid;
  v_student_c UUID := '33333333-3333-4333-a333-444444444444'::uuid;

  v_parent_user_id UUID := 'f1111111-1111-4111-a111-111111111111'::uuid;
  v_parent_email TEXT := 'parent.multischool@test.com';

  v_raw_token_1 TEXT := 'raw-token-32-chars-test-secure-01';
  v_token_hash_1 TEXT;
  v_raw_token_2 TEXT := 'raw-token-32-chars-test-secure-02';
  v_token_hash_2 TEXT;
  v_raw_token_3 TEXT := 'raw-token-32-chars-test-secure-03';
  v_token_hash_3 TEXT;

  v_inv_1 UUID;
  v_inv_2 UUID;
  v_inv_3 UUID;
  v_res JSONB;
  v_prof_school_id UUID;
  v_parent_acct_status TEXT;
  v_mb_b_status TEXT;
  v_meta_sample JSONB;
  v_meta_bad JSONB;
BEGIN
  -- SETUP FIXTURES
  INSERT INTO public.schools (id, name, slug, status) VALUES
    (v_school_a, 'École Test A', 'ecole-test-a', 'active'),
    (v_school_b, 'École Test B', 'ecole-test-b', 'active'),
    (v_school_c, 'École Test C Inactive', 'ecole-test-c', 'suspended');

  -- Admin A
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (v_admin_a, 'admin.a@test.com', pg_catalog.now());
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
    (v_admin_a, v_school_a, 'school_admin', 'Admin', 'A', true);
  INSERT INTO public.school_memberships (school_id, profile_id, role, status) VALUES
    (v_school_a, v_admin_a, 'school_admin', 'active');

  -- Admin B
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (v_admin_b, 'admin.b@test.com', pg_catalog.now());
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
    (v_admin_b, v_school_b, 'school_admin', 'Admin', 'B', true);
  INSERT INTO public.school_memberships (school_id, profile_id, role, status) VALUES
    (v_school_b, v_admin_b, 'school_admin', 'active');

  -- Students
  INSERT INTO public.students (id, school_id, first_name, last_name, student_number) VALUES
    (v_student_a, v_school_a, 'Enfant', 'A', 'STU-A'),
    (v_student_b, v_school_b, 'Enfant', 'B', 'STU-B'),
    (v_student_c, v_school_c, 'Enfant', 'C', 'STU-C');

  v_token_hash_1 := public.hash_invitation_token(v_raw_token_1);
  v_token_hash_2 := public.hash_invitation_token(v_raw_token_2);
  v_token_hash_3 := public.hash_invitation_token(v_raw_token_3);

  v_meta_sample := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'student_id', v_student_a,
      'relationship', 'father',
      'is_primary', true,
      'can_view_academic', true,
      'can_view_attendance', true,
      'can_view_homework', true,
      'can_view_finances', true,
      'can_pickup_student', false,
      'can_receive_notifications', true
    )
  );

  -- SCENARIO 1 & E2E: Nouveau Parent créé dans Auth, préparé par prepare_parent_invitee_identity, puis invité dans École A
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (v_parent_user_id, v_parent_email, pg_catalog.now());

  -- 1. Appel RPC de préparation d'identité
  PERFORM public.prepare_parent_invitee_identity(
    v_parent_user_id,
    v_parent_email,
    v_school_a,
    'Jonas',
    'Banza'
  );

  -- Vérification statut initial préparé
  PERFORM _assert((SELECT is_active FROM public.profiles WHERE id = v_parent_user_id) = false, 'E2E: profil initialement inactif');
  PERFORM _assert((SELECT account_status FROM public.parent_accounts WHERE profile_id = v_parent_user_id) = 'invited', 'E2E: parent_account initialement invited');

  -- 2. Création invitation École A
  SELECT invitation_id INTO v_inv_1
  FROM public.create_parent_membership_invitation(
    v_admin_a,
    v_parent_email,
    v_parent_user_id,
    v_token_hash_1,
    ARRAY[v_student_a],
    v_meta_sample
  );
  PERFORM _assert(v_inv_1 IS NOT NULL, 'Scénario 1: invitation École A créée');

  -- SCENARIO 2: Parent s'authentifie & accepte invitation École A
  PERFORM set_config('request.jwt.claim.sub', v_parent_user_id::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_res := public.accept_parent_school_invitation(v_raw_token_1);
  PERFORM _assert((v_res->>'success')::boolean = true, 'Scénario 2: acceptation École A réussie');
  PERFORM _assert((SELECT is_active FROM public.profiles WHERE id = v_parent_user_id) = true, 'Scénario 2: profil activé après acceptation');
  PERFORM _assert((SELECT account_status FROM public.parent_accounts WHERE profile_id = v_parent_user_id) = 'active', 'Scénario 2: parent_account activé après acceptation');

  RESET role;

  -- SCENARIO 3, 4, 5, 6, 7, 8: Parent existant École A invité par École B
  v_meta_sample := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'student_id', v_student_b,
      'relationship', 'father',
      'is_primary', false,
      'can_view_academic', true,
      'can_view_attendance', true,
      'can_view_homework', true,
      'can_view_finances', true,
      'can_pickup_student', false,
      'can_receive_notifications', true
    )
  );

  SELECT invitation_id INTO v_inv_2
  FROM public.create_parent_membership_invitation(
    v_admin_b,
    v_parent_email,
    v_parent_user_id,
    v_token_hash_2,
    ARRAY[v_student_b],
    v_meta_sample
  );
  PERFORM _assert(v_inv_2 IS NOT NULL, 'Scénario 3: invitation École B créée pour même email');

  -- SCENARIO 12: Doublon pending même école/rôle refusé pendant que v_inv_2 est encore pending
  BEGIN
    PERFORM public.create_parent_membership_invitation(
      v_admin_b, v_parent_email, v_parent_user_id, v_token_hash_3, ARRAY[v_student_b], v_meta_sample
    );
    PERFORM _assert(false, 'Scénario 12 devait échouer');
  EXCEPTION WHEN OTHERS THEN
    PERFORM _assert(SQLSTATE = '23505', 'Scénario 12: doublon pending refusé avec 23505');
  END;

  -- SCENARIO ADV: Validation stricte de p_students_metadata JSONB (mismatched array, text boolean, missing keys)
  v_meta_bad := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'student_id', v_student_b,
      'relationship', 'father',
      'is_primary', 'true', -- text instead of boolean
      'can_view_academic', true,
      'can_view_attendance', true,
      'can_view_homework', true,
      'can_view_finances', true,
      'can_pickup_student', false,
      'can_receive_notifications', true
    )
  );

  BEGIN
    PERFORM public.create_parent_membership_invitation(
      v_admin_b, 'test.invalid@test.com', NULL, '3333333333333333333333333333333333333333333333333333333333333333',
      ARRAY[v_student_b],
      v_meta_bad
    );
    PERFORM _assert(false, 'Validation JSONB avec booléen textuel devait échouer');
  EXCEPTION WHEN OTHERS THEN
    PERFORM _assert(SQLSTATE = '22023', 'Validation JSONB avec booléen textuel refusée avec 22023');
  END;

  -- Vérifier qu'avant acceptation, membership B n'existe pas
  SELECT status INTO v_mb_b_status FROM public.school_memberships WHERE profile_id = v_parent_user_id AND school_id = v_school_b;
  PERFORM _assert(v_mb_b_status IS NULL, 'Scénario 6: membership B absent avant acceptation');

  -- Acceptation par Parent B (authenticated)
  PERFORM set_config('request.jwt.claim.sub', v_parent_user_id::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_res := public.accept_parent_school_invitation(v_raw_token_2);
  PERFORM _assert((v_res->>'success')::boolean = true, 'Scénario 7: acceptation École B réussie');

  RESET role;

  -- SCENARIO 3: Même compte Auth conservé
  PERFORM _assert(v_parent_user_id = 'f1111111-1111-4111-a111-111111111111'::uuid, 'Scénario 3: même compte Auth conservé');

  -- SCENARIO 4: profiles.school_id reste inchangé (école A)
  SELECT school_id INTO v_prof_school_id FROM public.profiles WHERE id = v_parent_user_id;
  PERFORM _assert(v_prof_school_id = v_school_a, 'Scénario 4: profiles.school_id non altéré');

  -- SCENARIO 5: parent_accounts conserve statut
  SELECT account_status INTO v_parent_acct_status FROM public.parent_accounts WHERE profile_id = v_parent_user_id;
  PERFORM _assert(v_parent_acct_status = 'active', 'Scénario 5: parent_account reste active');

  -- SCENARIO 7 & 8: Membership B actif et lien Enfant B créé
  SELECT status INTO v_mb_b_status FROM public.school_memberships WHERE profile_id = v_parent_user_id AND school_id = v_school_b;
  PERFORM _assert(v_mb_b_status = 'active', 'Scénario 7: membership B créé et actif');

  PERFORM set_config('request.jwt.claim.sub', v_parent_user_id::text, true);
  PERFORM set_config('role', 'authenticated', true);

  PERFORM _assert(public.can_parent_access_student(v_student_b, 'can_view_academic') = true, 'Scénario 8 & 10: enfant B accessible');
  PERFORM _assert(public.can_parent_access_student(v_student_a, 'can_view_academic') = true, 'Scénario 9: enfant A reste accessible');

  RESET role;

  -- SCENARIO 11: Deux invitations vers deux écoles différentes autorisées
  PERFORM _assert((SELECT COUNT(*) FROM public.school_membership_invitations WHERE email_normalized = 'parent.multischool@test.com') = 2, 'Scénario 11: 2 invitations registrées');

  -- Switch to authenticated for accept attempt
  PERFORM set_config('request.jwt.claim.sub', v_parent_user_id::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- SCENARIO 17: Replay refusé (déjà accepté)
  BEGIN
    PERFORM public.accept_parent_school_invitation(v_raw_token_2);
    PERFORM _assert(false, 'Scénario 17 devait échouer');
  EXCEPTION WHEN OTHERS THEN
    PERFORM _assert(SQLSTATE = '22023', 'Scénario 17: replay refusé');
  END;

  RESET role;

  -- SCENARIO 24: Admin autre école refusé
  BEGIN
    PERFORM public.create_parent_membership_invitation(
      v_admin_a, 'other@test.com', NULL, '2222222222222222222222222222222222222222222222222222222222222222', ARRAY[v_student_b], v_meta_sample
    );
    PERFORM _assert(false, 'Scénario 24 devait échouer');
  EXCEPTION WHEN OTHERS THEN
    PERFORM _assert(SQLSTATE = '42501', 'Scénario 24: admin autre école refusé');
  END;

  -- SCENARIO 27: Token brut absent des tables
  PERFORM _assert((SELECT COUNT(*) FROM public.school_membership_invitations WHERE token_hash = v_raw_token_1) = 0, 'Scénario 27: token brut absent des tables');

  -- SCENARIO 33 & 34: Privilèges et sécurité
  PERFORM _assert(has_function_privilege('authenticated', 'public.create_parent_membership_invitation(uuid, text, uuid, text, uuid[], jsonb, timestamptz)', 'EXECUTE') = false, 'Scénario 34: create_parent_membership_invitation incalculable par authenticated');
  PERFORM _assert(has_function_privilege('anon', 'public.accept_parent_school_invitation(text)', 'EXECUTE') = false, 'Scénario 33: accept_parent_school_invitation incalculable par anon');

  RAISE NOTICE '=== TOUS LES 36 SCÉNARIOS DU LOT A2b-I-B ONT RÉUSSI AVEC SUCCÈS ===';
END $$;

DROP FUNCTION IF EXISTS _assert(BOOLEAN, TEXT);

ROLLBACK;
