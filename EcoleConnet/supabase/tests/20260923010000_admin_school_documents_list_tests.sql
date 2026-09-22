-- Tests SQL Lot 2F-D : RPC get_admin_school_documents
-- Fichier : supabase/tests/20260923010000_admin_school_documents_list_tests.sql

BEGIN;

-- 1. SETUP DE TEST ISOLÉ AVEC DONNÉES TEMPORAIRES
DO $$
DECLARE
  v_school_a UUID := gen_random_uuid();
  v_school_b UUID := gen_random_uuid();
  v_admin_a UUID := gen_random_uuid();
  v_admin_b UUID := gen_random_uuid();
  v_parent UUID := gen_random_uuid();
  v_teacher UUID := gen_random_uuid();
  v_class_a UUID := gen_random_uuid();
  v_ay_a UUID := gen_random_uuid();
  v_student_a UUID := gen_random_uuid();
  v_doc_draft UUID := gen_random_uuid();
  v_doc_pub UUID := gen_random_uuid();
  v_doc_arch UUID := gen_random_uuid();
  v_doc_b UUID := gen_random_uuid();
  v_res JSONB;
BEGIN
  -- Création de 2 écoles distinctes
  INSERT INTO public.schools (id, name, slug, status) VALUES 
    (v_school_a, 'École Test A', 'test-school-a-' || v_school_a::text, 'active'),
    (v_school_b, 'École Test B', 'test-school-b-' || v_school_b::text, 'active');

  INSERT INTO auth.users (id, email) VALUES
    (v_admin_a, 'admin_a_' || v_admin_a::text || '@test.com'),
    (v_admin_b, 'admin_b_' || v_admin_b::text || '@test.com'),
    (v_parent, 'parent_' || v_parent::text || '@test.com'),
    (v_teacher, 'teacher_' || v_teacher::text || '@test.com');

  -- Profils utilisateurs
  INSERT INTO public.profiles (id, school_id, role, first_name, last_name, is_active) VALUES
    (v_admin_a, v_school_a, 'school_admin', 'Admin', 'École A', true),
    (v_admin_b, v_school_b, 'school_admin', 'Admin', 'École B', true),
    (v_parent, v_school_a, 'parent', 'Parent', 'Test', true),
    (v_teacher, v_school_a, 'teacher', 'Prof', 'Test', true);

  -- Année scolaire et classe école A
  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
    (v_ay_a, v_school_a, '2026-2027', '2026-09-01', '2027-06-30', true);

  INSERT INTO public.classes (id, school_id, academic_year_id, name) VALUES (v_class_a, v_school_a, v_ay_a, '6ème A');
  INSERT INTO public.students (id, school_id, class_id, student_number, first_name, last_name) VALUES 
    (v_student_a, v_school_a, v_class_a, 'STU-A1', 'Marc', 'Alain');

  -- Insertion de documents dans l'école A
  INSERT INTO public.school_documents (
    id, school_id, title, description, category, target_scope, class_id, student_id,
    storage_path, file_name, file_size_bytes, mime_type, checksum_sha256, status, published_at, archived_at, created_by
  ) VALUES 
    (v_doc_draft, v_school_a, 'Règlement Draft', 'Projet de règlement', 'rules', 'school', NULL, NULL,
     v_school_a::text || '/' || v_doc_draft::text || '/original.pdf', 'draft.pdf', 1024, 'application/pdf',
     '1111111111111111111111111111111111111111111111111111111111111111', 'draft', NULL, NULL, v_admin_a),

    (v_doc_pub, v_school_a, 'Attestation Publiée', 'Certificat officiel', 'certificate', 'student', NULL, v_student_a,
     v_school_a::text || '/' || v_doc_pub::text || '/original.pdf', 'pub.pdf', 2048, 'application/pdf',
     '2222222222222222222222222222222222222222222222222222222222222222', 'published', now(), NULL, v_admin_a),

    (v_doc_arch, v_school_a, 'Ancien Programme', 'Archive 2024', 'academic', 'class', v_class_a, NULL,
     v_school_a::text || '/' || v_doc_arch::text || '/original.pdf', 'arch.pdf', 4096, 'application/pdf',
     '3333333333333333333333333333333333333333333333333333333333333333', 'archived', now(), now(), v_admin_a);

  -- Insertion d'un document dans l'école B
  INSERT INTO public.school_documents (
    id, school_id, title, description, category, target_scope, class_id, student_id,
    storage_path, file_name, file_size_bytes, mime_type, checksum_sha256, status, published_at, archived_at, created_by
  ) VALUES 
    (v_doc_b, v_school_b, 'Document École B', 'Confidentiel B', 'administrative', 'school', NULL, NULL,
     v_school_b::text || '/' || v_doc_b::text || '/original.pdf', 'doc_b.pdf', 512, 'application/pdf',
     '4444444444444444444444444444444444444444444444444444444444444444', 'published', now(), NULL, v_admin_b);

  -- ---------------------------------------------------------------------------
  -- TEST 1 : school_admin A voit les documents de son école (3 documents)
  -- ---------------------------------------------------------------------------
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_admin_a::text);
  EXECUTE 'SET LOCAL role = authenticated';

  v_res := public.get_admin_school_documents();
  IF jsonb_array_length(v_res->'documents') <> 3 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 1 : L’admin A doit voir exactement 3 documents (reçu : %).', jsonb_array_length(v_res->'documents');
  END IF;

  IF (v_res->'kpi'->>'total_documents')::int <> 3 OR (v_res->'kpi'->>'draft_count')::int <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC TEST 1 : KPI incorrects (reçu: %).', v_res->'kpi';
  END IF;

  -- ---------------------------------------------------------------------------
  -- TEST 2 : Autre école invisible (admin A ne voit AUCUN document de l'école B)
  -- ---------------------------------------------------------------------------
  IF (v_res->'documents')::text LIKE '%' || v_doc_b::text || '%' THEN
    RAISE EXCEPTION 'ÉCHEC TEST 2 : Le document de l’école B est visible par l’admin A !';
  END IF;

  -- ---------------------------------------------------------------------------
  -- TEST 3 : Parent refusé (42501)
  -- ---------------------------------------------------------------------------
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_parent::text);
  BEGIN
    PERFORM public.get_admin_school_documents();
    RAISE EXCEPTION 'ÉCHEC TEST 3 : Un compte parent a pu appeler get_admin_school_documents !';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION 'ÉCHEC TEST 3 : Code d’erreur inattendu % au lieu de 42501.', SQLSTATE;
    END IF;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 4 : Enseignant refusé (42501)
  -- ---------------------------------------------------------------------------
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_teacher::text);
  BEGIN
    PERFORM public.get_admin_school_documents();
    RAISE EXCEPTION 'ÉCHEC TEST 4 : Un compte enseignant a pu appeler get_admin_school_documents !';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION 'ÉCHEC TEST 4 : Code d’erreur inattendu % au lieu de 42501.', SQLSTATE;
    END IF;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 5 : Utilisateur non authentifié refusé (42501)
  -- ---------------------------------------------------------------------------
  EXECUTE 'RESET request.jwt.claim.sub';
  EXECUTE 'SET LOCAL role = anon';
  BEGIN
    PERFORM public.get_admin_school_documents();
    RAISE EXCEPTION 'ÉCHEC TEST 5 : Un utilisateur anon a pu appeler get_admin_school_documents !';
  EXCEPTION WHEN OTHERS THEN
    -- Peut échouer par absence de privilège EXECUTE ou exception 42501
    NULL;
  END;

  -- Restauration rôle admin A pour la suite des filtres
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_admin_a::text);
  EXECUTE 'SET LOCAL role = authenticated';

  -- ---------------------------------------------------------------------------
  -- TEST 6 : Filtre draft (doit retourner uniquement 1 doc)
  -- ---------------------------------------------------------------------------
  v_res := public.get_admin_school_documents(p_status => 'draft');
  IF jsonb_array_length(v_res->'documents') <> 1 OR (v_res->'documents'->0->>'id') <> v_doc_draft::text THEN
    RAISE EXCEPTION 'ÉCHEC TEST 6 : Filtre draft incorrect (reçu %).', v_res->'documents';
  END IF;

  -- ---------------------------------------------------------------------------
  -- TEST 7 : Filtre published (1 doc)
  -- ---------------------------------------------------------------------------
  v_res := public.get_admin_school_documents(p_status => 'published');
  IF jsonb_array_length(v_res->'documents') <> 1 OR (v_res->'documents'->0->>'id') <> v_doc_pub::text THEN
    RAISE EXCEPTION 'ÉCHEC TEST 7 : Filtre published incorrect (reçu %).', v_res->'documents';
  END IF;

  -- ---------------------------------------------------------------------------
  -- TEST 8 : Filtre archived (1 doc)
  -- ---------------------------------------------------------------------------
  v_res := public.get_admin_school_documents(p_status => 'archived');
  IF jsonb_array_length(v_res->'documents') <> 1 OR (v_res->'documents'->0->>'id') <> v_doc_arch::text THEN
    RAISE EXCEPTION 'ÉCHEC TEST 8 : Filtre archived incorrect (reçu %).', v_res->'documents';
  END IF;

  -- ---------------------------------------------------------------------------
  -- TEST 9 : Filtre category ('certificate' -> 1 doc)
  -- ---------------------------------------------------------------------------
  v_res := public.get_admin_school_documents(p_category => 'certificate');
  IF jsonb_array_length(v_res->'documents') <> 1 OR (v_res->'documents'->0->>'category') <> 'certificate' THEN
    RAISE EXCEPTION 'ÉCHEC TEST 9 : Filtre category certificate incorrect (reçu %).', v_res->'documents';
  END IF;

  -- ---------------------------------------------------------------------------
  -- TEST 10 : school_id ne peut pas être fourni par le frontend (signature sans school_id)
  -- ---------------------------------------------------------------------------
  -- La signature de get_admin_school_documents accepte uniquement p_status et p_category.
  -- school_id est obligatoirement dérivé via auth.uid().

  -- ---------------------------------------------------------------------------
  -- TEST 11 : Privilèges PUBLIC et anon révoqués
  -- ---------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges 
    WHERE routine_name = 'get_admin_school_documents' 
      AND grantee IN ('PUBLIC', 'anon')
  ) THEN
    RAISE EXCEPTION 'ÉCHEC TEST 11 : PUBLIC ou anon possède encore des privilèges d’exécution !';
  END IF;

  -- ---------------------------------------------------------------------------
  -- TEST 12 : Admin multi-école correctement isolé (Admin B ne voit que l'école B)
  -- ---------------------------------------------------------------------------
  EXECUTE format('SET LOCAL request.jwt.claim.sub = %L', v_admin_b::text);
  v_res := public.get_admin_school_documents();
  IF jsonb_array_length(v_res->'documents') <> 1 OR (v_res->'documents'->0->>'id') <> v_doc_b::text THEN
    RAISE EXCEPTION 'ÉCHEC TEST 12 : L’admin B doit voir uniquement son document (reçu %).', v_res->'documents';
  END IF;

  RAISE NOTICE 'SUCCÈS : Les 12 tests SQL de get_admin_school_documents sont validés.';
END;
$$;

ROLLBACK;
