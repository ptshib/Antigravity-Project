-- Migration SQL : Fondation des Opérations Écoles, Enseignants, Élèves, Inscriptions & Imports (Phase 2B Ordre Dépendances Correct)
-- Fichier : supabase/migrations/20260813080000_school_operations_foundation.sql

BEGIN;

-- ============================================================================
-- A. FONCTIONS DE BASE INDÉPENDANTES (Dépendent uniquement de profiles et schools)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_school_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.school_id 
  FROM public.profiles p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = auth.uid() 
    AND p.is_active = true 
    AND s.status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_school_admin(target_school_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.schools s ON s.id = p.school_id
    WHERE p.id = auth.uid()
      AND p.role = 'school_admin'
      AND p.school_id = target_school_id
      AND p.is_active = true
      AND s.status = 'active'
  );
$$;

-- ============================================================================
-- B. CRÉATION / ENRICHISSEMENT DE PUBLIC.SUBJECTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_school_subject_name' AND conrelid = 'public.subjects'::regclass
  ) THEN
    ALTER TABLE public.subjects ADD CONSTRAINT uq_school_subject_name UNIQUE (school_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subjects_school_id ON public.subjects(school_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_school_subject_code 
ON public.subjects (school_id, UPPER(TRIM(code))) 
WHERE (code IS NOT NULL AND TRIM(code) <> '');

DROP TRIGGER IF EXISTS trg_subjects_updated_at ON public.subjects;
CREATE TRIGGER trg_subjects_updated_at
  BEFORE UPDATE ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ============================================================================
-- C. CRÉATION / ENRICHISSEMENT DE PUBLIC.TEACHERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  gender TEXT,
  speciality TEXT,
  employment_status TEXT NOT NULL DEFAULT 'active',
  account_status TEXT NOT NULL DEFAULT 'not_invited',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_number TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS speciality TEXT,
  ADD COLUMN IF NOT EXISTS employment_status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'not_invited',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_school_employee_number' AND conrelid = 'public.teachers'::regclass
  ) THEN
    ALTER TABLE public.teachers ADD CONSTRAINT uq_school_employee_number UNIQUE (school_id, employee_number);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_teachers_gender' AND conrelid = 'public.teachers'::regclass
  ) THEN
    ALTER TABLE public.teachers ADD CONSTRAINT chk_teachers_gender CHECK (gender IN ('M', 'F'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_teachers_employment_status' AND conrelid = 'public.teachers'::regclass
  ) THEN
    ALTER TABLE public.teachers ADD CONSTRAINT chk_teachers_employment_status CHECK (employment_status IN ('active', 'on_leave', 'terminated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_teachers_account_status' AND conrelid = 'public.teachers'::regclass
  ) THEN
    ALTER TABLE public.teachers ADD CONSTRAINT chk_teachers_account_status CHECK (account_status IN ('not_invited', 'invited', 'active', 'suspended'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_teachers_school_id ON public.teachers(school_id);
CREATE INDEX IF NOT EXISTS idx_teachers_profile_id ON public.teachers(profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_school_teacher_email 
ON public.teachers (school_id, LOWER(TRIM(email))) 
WHERE (email IS NOT NULL AND TRIM(email) <> '');

DROP TRIGGER IF EXISTS trg_teachers_updated_at ON public.teachers;
CREATE TRIGGER trg_teachers_updated_at
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ============================================================================
-- D. ENRICHISSEMENT DE PUBLIC.STUDENTS ET PUBLIC.PARENT_STUDENT_LINKS
-- ============================================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS birth_place TEXT,
  ADD COLUMN IF NOT EXISTS guardian_reference TEXT,
  ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'not_invited',
  ADD COLUMN IF NOT EXISTS admission_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_students_account_status' AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students 
      ADD CONSTRAINT chk_students_account_status CHECK (account_status IN ('not_invited', 'invited', 'active', 'suspended'));
  END IF;
END $$;

ALTER TABLE public.parent_student_links
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_parent_link_status' AND conrelid = 'public.parent_student_links'::regclass
  ) THEN
    ALTER TABLE public.parent_student_links 
      ADD CONSTRAINT chk_parent_link_status CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_students_updated_at ON public.students;
CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ============================================================================
-- E. ENRICHISSEMENT DE PUBLIC.TEACHER_CLASS_ASSIGNMENTS ET BACKFILL
-- ============================================================================

ALTER TABLE public.teacher_class_assignments
  ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES public.teachers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS term_id UUID REFERENCES public.school_terms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_teacher_assign_teacher_id ON public.teacher_class_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assign_subject_id ON public.teacher_class_assignments(subject_id);

DO $$
DECLARE
  v_migrated_count INTEGER := 0;
  v_unmigrated_count INTEGER := 0;
BEGIN
  WITH updated AS (
    UPDATE public.teacher_class_assignments tca
    SET teacher_id = t.id
    FROM public.teachers t
    WHERE tca.teacher_id IS NULL
      AND tca.teacher_profile_id IS NOT NULL
      AND t.profile_id = tca.teacher_profile_id
      AND t.school_id = tca.school_id
    RETURNING tca.id
  )
  SELECT COUNT(*) INTO v_migrated_count FROM updated;

  SELECT COUNT(*) INTO v_unmigrated_count
  FROM public.teacher_class_assignments
  WHERE teacher_id IS NULL;

  RAISE NOTICE 'Migration Phase 2B : % affectation(s) enseignant migrées vers teachers.id.', v_migrated_count;

  IF v_unmigrated_count > 0 THEN
    RAISE NOTICE 'ATTENTION : % affectation(s) conservent teacher_id = NULL (dossier enseignant non encore lié).', v_unmigrated_count;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_teacher_assign_updated_at ON public.teacher_class_assignments;
CREATE TRIGGER trg_teacher_assign_updated_at
  BEFORE UPDATE ON public.teacher_class_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ============================================================================
-- F. FONCTIONS DE SÉCURITÉ DÉPENDANT DES TABLES (CRÉÉES MAINTENANT CAR TABLES ET COLONNES EXISTENT)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_teacher_profile_school_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile_school_id UUID;
BEGIN
  IF NEW.profile_id IS NOT NULL THEN
    SELECT school_id INTO v_profile_school_id FROM public.profiles WHERE id = NEW.profile_id;
    IF v_profile_school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'Le profil d’enseignant appartient à un autre établissement.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teacher_profile_school_integrity ON public.teachers;
CREATE TRIGGER trg_teacher_profile_school_integrity
  BEFORE INSERT OR UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.check_teacher_profile_school_integrity();

-- Fonction is_teacher_of_class (Dépend de public.teachers et public.teacher_class_assignments)
CREATE OR REPLACE FUNCTION public.is_teacher_of_class(target_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.teacher_class_assignments tca
    JOIN public.profiles p ON p.id = auth.uid()
    JOIN public.schools s ON s.id = p.school_id
    LEFT JOIN public.teachers t ON t.id = tca.teacher_id
    WHERE tca.class_id = target_class_id
      AND tca.is_active = true
      AND tca.school_id = p.school_id
      AND p.role = 'teacher'
      AND p.is_active = true
      AND s.status = 'active'
      AND (
        tca.teacher_profile_id = auth.uid()
        OR (t.profile_id IS NOT NULL AND t.profile_id = auth.uid() AND t.employment_status = 'active')
      )
  );
$$;

-- Fonction is_parent_of_student (Dépend de public.parent_student_links.status)
CREATE OR REPLACE FUNCTION public.is_parent_of_student(target_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.parent_student_links psl
    JOIN public.profiles p ON p.id = psl.parent_profile_id
    JOIN public.schools s ON s.id = p.school_id
    JOIN public.students st ON st.id = psl.student_id
    WHERE psl.parent_profile_id = auth.uid()
      AND psl.student_id = target_student_id
      AND psl.status = 'approved'
      AND p.role = 'parent'
      AND p.is_active = true
      AND s.status = 'active'
      AND st.school_id = p.school_id
  );
$$;

-- Fonction is_student_self (Dépend de public.students)
CREATE OR REPLACE FUNCTION public.is_student_self(target_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.students st
    JOIN public.profiles p ON p.id = st.profile_id
    JOIN public.schools s ON s.id = p.school_id
    WHERE st.id = target_student_id
      AND st.profile_id = auth.uid()
      AND p.role = 'student'
      AND p.is_active = true
      AND s.status = 'active'
      AND st.school_id = p.school_id
  );
$$;

-- ============================================================================
-- G. TABLE STUDENT_ENROLLMENTS (Historique d'inscriptions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.student_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'transferred', 'graduated', 'withdrawn', 'suspended')),
  enrolled_on DATE NOT NULL DEFAULT CURRENT_DATE,
  ended_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.student_enrollments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_enrollments_school_year ON public.student_enrollments(school_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON public.student_enrollments(class_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_enrollment_per_year 
ON public.student_enrollments (student_id, academic_year_id) WHERE (status = 'active');

DROP TRIGGER IF EXISTS trg_student_enrollments_updated_at ON public.student_enrollments;
CREATE TRIGGER trg_student_enrollments_updated_at
  BEFORE UPDATE ON public.student_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ============================================================================
-- H. TABLES D'IMPORTATION (SCHOOL_IMPORT_JOBS ET SCHOOL_IMPORT_ROWS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.school_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  import_type TEXT NOT NULL CHECK (import_type IN ('teachers', 'students', 'classes')),
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('validating', 'ready', 'processing', 'completed', 'failed', 'cancelled')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  error_report JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.school_import_jobs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_import_job_totals' AND conrelid = 'public.school_import_jobs'::regclass
  ) THEN
    ALTER TABLE public.school_import_jobs
      ADD CONSTRAINT chk_import_job_totals CHECK (
        total_rows >= 0 AND
        valid_rows >= 0 AND
        invalid_rows >= 0 AND
        (valid_rows + invalid_rows <= total_rows)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_jobs_school ON public.school_import_jobs(school_id);

DROP TRIGGER IF EXISTS trg_import_jobs_updated_at ON public.school_import_jobs;
CREATE TRIGGER trg_import_jobs_updated_at
  BEFORE UPDATE ON public.school_import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

CREATE TABLE IF NOT EXISTS public.school_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id UUID NOT NULL REFERENCES public.school_import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  normalized_data JSONB,
  validation_errors JSONB DEFAULT '[]'::jsonb,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.school_import_rows
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_import_job_row_number' AND conrelid = 'public.school_import_rows'::regclass
  ) THEN
    ALTER TABLE public.school_import_rows
      ADD CONSTRAINT uq_import_job_row_number UNIQUE (import_job_id, row_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_rows_job ON public.school_import_rows(import_job_id);

DROP TRIGGER IF EXISTS trg_import_rows_updated_at ON public.school_import_rows;
CREATE TRIGGER trg_import_rows_updated_at
  BEFORE UPDATE ON public.school_import_rows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ============================================================================
-- I. CONTRÔLES D'INTEGRITÉ MULTI-ÉCOLES & DE CLASSE/ANNÉE SCHÉMA (Triggers)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_teacher_assignment_school_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class_school_id UUID;
  v_class_year_id UUID;
  v_teacher_school_id UUID;
  v_subject_school_id UUID;
  v_year_school_id UUID;
  v_term_school_id UUID;
  v_term_year_id UUID;
BEGIN
  -- 1. Classe (vérification école ET année académique)
  SELECT school_id, academic_year_id INTO v_class_school_id, v_class_year_id FROM public.classes WHERE id = NEW.class_id;
  IF v_class_school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'La classe spécifiée appartient à un autre établissement.';
  END IF;
  IF v_class_year_id IS DISTINCT FROM NEW.academic_year_id THEN
    RAISE EXCEPTION 'La classe spécifiée n’appartient pas à l’année scolaire sélectionnée.';
  END IF;

  -- 2. Enseignant dossier si présent
  IF NEW.teacher_id IS NOT NULL THEN
    SELECT school_id INTO v_teacher_school_id FROM public.teachers WHERE id = NEW.teacher_id;
    IF v_teacher_school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'L’enseignant spécifié appartient à un autre établissement.';
    END IF;
  END IF;

  -- 3. Matière si présente
  IF NEW.subject_id IS NOT NULL THEN
    SELECT school_id INTO v_subject_school_id FROM public.subjects WHERE id = NEW.subject_id;
    IF v_subject_school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'La matière spécifiée appartient à un autre établissement.';
    END IF;
  END IF;

  -- 4. Année scolaire
  SELECT school_id INTO v_year_school_id FROM public.academic_years WHERE id = NEW.academic_year_id;
  IF v_year_school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'L’année scolaire spécifiée appartient à un autre établissement.';
  END IF;

  -- 5. Trimestre si présent (vérification école ET année académique)
  IF NEW.term_id IS NOT NULL THEN
    SELECT school_id, academic_year_id INTO v_term_school_id, v_term_year_id FROM public.school_terms WHERE id = NEW.term_id;
    IF v_term_school_id IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'Le trimestre spécifié appartient à un autre établissement.';
    END IF;
    IF v_term_year_id IS DISTINCT FROM NEW.academic_year_id THEN
      RAISE EXCEPTION 'Le trimestre spécifié n’appartient pas à l’année scolaire sélectionnée.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teacher_assign_integrity ON public.teacher_class_assignments;
CREATE TRIGGER trg_teacher_assign_integrity
  BEFORE INSERT OR UPDATE ON public.teacher_class_assignments
  FOR EACH ROW EXECUTE FUNCTION public.check_teacher_assignment_school_integrity();

CREATE OR REPLACE FUNCTION public.check_student_enrollment_school_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_school_id UUID;
  v_class_school_id UUID;
  v_class_year_id UUID;
  v_year_school_id UUID;
BEGIN
  -- 1. Élève
  SELECT school_id INTO v_student_school_id FROM public.students WHERE id = NEW.student_id;
  IF v_student_school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'L’élève spécifié appartient à un autre établissement.';
  END IF;

  -- 2. Classe (vérification école ET année académique)
  SELECT school_id, academic_year_id INTO v_class_school_id, v_class_year_id FROM public.classes WHERE id = NEW.class_id;
  IF v_class_school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'La classe spécifiée appartient à un autre établissement.';
  END IF;
  IF v_class_year_id IS DISTINCT FROM NEW.academic_year_id THEN
    RAISE EXCEPTION 'La classe spécifiée n’appartient pas à l’année scolaire sélectionnée.';
  END IF;

  -- 3. Année scolaire
  SELECT school_id INTO v_year_school_id FROM public.academic_years WHERE id = NEW.academic_year_id;
  IF v_year_school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'L’année scolaire spécifiée appartient à un autre établissement.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_enrollment_integrity ON public.student_enrollments;
CREATE TRIGGER trg_student_enrollment_integrity
  BEFORE INSERT OR UPDATE ON public.student_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.check_student_enrollment_school_integrity();

-- ============================================================================
-- J. SÉCURITÉ ROW LEVEL SECURITY (Toutes les tables et fonctions existent !)
-- ============================================================================

-- A. SUBJECTS
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SuperAdmin full access subjects" ON public.subjects;
DROP POLICY IF EXISTS "SchoolAdmin manage subjects" ON public.subjects;
DROP POLICY IF EXISTS "Users read school subjects" ON public.subjects;

CREATE POLICY "SuperAdmin full access subjects" 
  ON public.subjects FOR ALL 
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "SchoolAdmin manage subjects" 
  ON public.subjects FOR ALL 
  USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));

CREATE POLICY "Users read school subjects" 
  ON public.subjects FOR SELECT 
  USING (school_id = public.get_auth_school_id());

-- B. TEACHERS
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SuperAdmin full access teachers" ON public.teachers;
DROP POLICY IF EXISTS "SchoolAdmin manage teachers" ON public.teachers;
DROP POLICY IF EXISTS "Teacher read self record" ON public.teachers;

CREATE POLICY "SuperAdmin full access teachers" 
  ON public.teachers FOR ALL 
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "SchoolAdmin manage teachers" 
  ON public.teachers FOR ALL 
  USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));

CREATE POLICY "Teacher read self record" 
  ON public.teachers FOR SELECT 
  USING (
    profile_id = auth.uid()
    AND public.get_auth_role() = 'teacher'
    AND school_id = public.get_auth_school_id()
    AND employment_status = 'active'
    AND account_status = 'active'
  );

-- C. STUDENTS
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SuperAdmin full access students" ON public.students;
DROP POLICY IF EXISTS "SchoolAdmin manage students" ON public.students;
DROP POLICY IF EXISTS "Teacher view students in assigned classes" ON public.students;
DROP POLICY IF EXISTS "Parent view linked children" ON public.students;
DROP POLICY IF EXISTS "Student view own record" ON public.students;
DROP POLICY IF EXISTS "Teacher read class students" ON public.students;
DROP POLICY IF EXISTS "Student read self record" ON public.students;
DROP POLICY IF EXISTS "Parent read linked students" ON public.students;

CREATE POLICY "SuperAdmin full access students" 
  ON public.students FOR ALL 
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "SchoolAdmin manage students" 
  ON public.students FOR ALL 
  USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));

CREATE POLICY "Teacher read class students" 
  ON public.students FOR SELECT 
  USING (
    school_id = public.get_auth_school_id() AND (
      public.is_teacher_of_class(class_id) OR
      id IN (
        SELECT student_id FROM public.student_enrollments 
        WHERE school_id = public.get_auth_school_id() AND public.is_teacher_of_class(class_id)
      )
    )
  );

CREATE POLICY "Student read self record" 
  ON public.students FOR SELECT 
  USING (public.is_student_self(id));

CREATE POLICY "Parent read linked students" 
  ON public.students FOR SELECT 
  USING (
    school_id = public.get_auth_school_id() AND 
    public.is_parent_of_student(id)
  );

-- D. STUDENT_ENROLLMENTS
ALTER TABLE public.student_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SuperAdmin full access enrollments" ON public.student_enrollments;
DROP POLICY IF EXISTS "SchoolAdmin manage enrollments" ON public.student_enrollments;
DROP POLICY IF EXISTS "Teacher read class enrollments" ON public.student_enrollments;
DROP POLICY IF EXISTS "Student read self enrollment" ON public.student_enrollments;
DROP POLICY IF EXISTS "Parent read linked enrollments" ON public.student_enrollments;

CREATE POLICY "SuperAdmin full access enrollments" 
  ON public.student_enrollments FOR ALL 
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "SchoolAdmin manage enrollments" 
  ON public.student_enrollments FOR ALL 
  USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));

CREATE POLICY "Teacher read class enrollments" 
  ON public.student_enrollments FOR SELECT 
  USING (
    school_id = public.get_auth_school_id() AND public.is_teacher_of_class(class_id)
  );

CREATE POLICY "Student read self enrollment" 
  ON public.student_enrollments FOR SELECT 
  USING (
    public.is_student_self(student_id)
  );

CREATE POLICY "Parent read linked enrollments" 
  ON public.student_enrollments FOR SELECT 
  USING (
    school_id = public.get_auth_school_id() AND public.is_parent_of_student(student_id)
  );

-- E. SCHOOL_IMPORT_JOBS & ROWS
ALTER TABLE public.school_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SuperAdmin full access import jobs" ON public.school_import_jobs;
DROP POLICY IF EXISTS "SchoolAdmin manage import jobs" ON public.school_import_jobs;
DROP POLICY IF EXISTS "SuperAdmin full access import rows" ON public.school_import_rows;
DROP POLICY IF EXISTS "SchoolAdmin manage import rows" ON public.school_import_rows;

CREATE POLICY "SuperAdmin full access import jobs" 
  ON public.school_import_jobs FOR ALL 
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "SchoolAdmin manage import jobs" 
  ON public.school_import_jobs FOR ALL 
  USING (public.is_school_admin(school_id))
  WITH CHECK (
    public.is_school_admin(school_id) AND
    (created_by IS NULL OR created_by = auth.uid())
  );

CREATE POLICY "SuperAdmin full access import rows" 
  ON public.school_import_rows FOR ALL 
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "SchoolAdmin manage import rows" 
  ON public.school_import_rows FOR ALL 
  USING (
    import_job_id IN (
      SELECT id FROM public.school_import_jobs 
      WHERE school_id = public.get_auth_school_id() AND public.is_school_admin(school_id)
    )
  )
  WITH CHECK (
    import_job_id IN (
      SELECT id FROM public.school_import_jobs 
      WHERE school_id = public.get_auth_school_id() AND public.is_school_admin(school_id)
    )
  );

COMMIT;
