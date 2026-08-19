-- Migration SQL initiale : Architecture Multi-Écoles, Auth, Rôles & Sécurité RLS
-- Fichier : supabase/migrations/20260812220000_initial_school_auth_schema.sql

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLE SCHOOLS (Établissements)
CREATE TABLE IF NOT EXISTS public.schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  country TEXT DEFAULT 'RD Congo',
  timezone TEXT NOT NULL DEFAULT 'Africa/Kinshasa',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. TABLE PROFILES (Utilisateurs rattachés à Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'school_admin', 'teacher', 'parent', 'student')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  display_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_school_role_integrity CHECK (
    (role = 'super_admin' AND school_id IS NULL) OR
    (role <> 'super_admin' AND school_id IS NOT NULL)
  )
);

-- 4. TABLE ACADEMIC_YEARS (Années Scolaires)
CREATE TABLE IF NOT EXISTS public.academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  is_current BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_current_academic_year 
ON public.academic_years (school_id) WHERE (is_current = true);

-- 5. TABLE SCHOOL_TERMS (Trimestres / Périodes)
CREATE TABLE IF NOT EXISTS public.school_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  starts_on DATE,
  ends_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. TABLE CLASSES (Classes & Salles)
CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level TEXT,
  section TEXT,
  room TEXT,
  homeroom_teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. TABLE STUDENTS (Dossiers Élèves)
CREATE TABLE IF NOT EXISTS public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_number TEXT NOT NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  date_of_birth DATE,
  gender TEXT CHECK (gender IN ('M', 'F')),
  enrollment_status TEXT DEFAULT 'active' CHECK (enrollment_status IN ('active', 'transferred', 'graduated', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_student_number UNIQUE (school_id, student_number)
);

-- 8. TABLE PARENT_STUDENT_LINKS (Liens Parents-Élèves)
CREATE TABLE IF NOT EXISTS public.parent_student_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  parent_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  relationship TEXT DEFAULT 'Parent',
  is_primary BOOLEAN DEFAULT false,
  can_receive_notifications BOOLEAN DEFAULT true,
  can_view_finances BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_parent_student_link UNIQUE (parent_profile_id, student_id)
);

-- 9. TABLE TEACHER_CLASS_ASSIGNMENTS (Affectations Enseignants)
CREATE TABLE IF NOT EXISTS public.teacher_class_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_name TEXT NOT NULL,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_teacher_class_subject UNIQUE (teacher_profile_id, class_id, subject_name, academic_year_id)
);

-- 10. INDEXES DE PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_profiles_school_id ON public.profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_classes_school_year ON public.classes(school_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_students_school_class ON public.students(school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_parent_links_parent ON public.parent_student_links(parent_profile_id);
CREATE INDEX IF NOT EXISTS idx_parent_links_student ON public.parent_student_links(student_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assign_teacher ON public.teacher_class_assignments(teacher_profile_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assign_class ON public.teacher_class_assignments(class_id);

-- 11. FONCTIONS DE SÉCURITÉ & DE CONTRÔLE D'ACCÈS
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_auth_school_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM public.profiles WHERE id = auth.uid();
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

CREATE OR REPLACE FUNCTION public.is_teacher_of_class(target_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_class_assignments
    WHERE teacher_profile_id = auth.uid() AND class_id = target_class_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_parent_of_student(target_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_student_links
    WHERE parent_profile_id = auth.uid() AND student_id = target_student_id
  );
$$;

-- 12. TRIGGERS DE SÉCURITÉ & D'INTEGRITÉ MULTI-ÉCOLES
CREATE OR REPLACE FUNCTION public.prevent_sensitive_profile_updates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Permet au super_admin de tout modifier
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- Empêche la modification de role, school_id, is_active par un utilisateur standard
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Modification non autorisée du rôle utilisateur';
  END IF;

  IF OLD.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Modification non autorisée de l’établissement scolaire';
  END IF;

  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    RAISE EXCEPTION 'Modification non autorisée du statut de compte';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sensitive_profile_updates ON public.profiles;
CREATE TRIGGER trg_prevent_sensitive_profile_updates
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_sensitive_profile_updates();

-- Trigger d'intégrité Parent-Élève (Même École)
CREATE OR REPLACE FUNCTION public.check_parent_student_school_match()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent_school UUID;
  student_school UUID;
BEGIN
  SELECT school_id INTO parent_school FROM public.profiles WHERE id = NEW.parent_profile_id;
  SELECT school_id INTO student_school FROM public.students WHERE id = NEW.student_id;

  IF parent_school IS DISTINCT FROM student_school THEN
    RAISE EXCEPTION 'Le parent et l’élève doivent appartenir au même établissement scolaire';
  END IF;

  NEW.school_id := parent_school;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_parent_student_school_match ON public.parent_student_links;
CREATE TRIGGER trg_check_parent_student_school_match
  BEFORE INSERT OR UPDATE ON public.parent_student_links
  FOR EACH ROW EXECUTE FUNCTION public.check_parent_student_school_match();

-- 13. ACTIVATION & POLITIQUES ROW LEVEL SECURITY (RLS)

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_class_assignments ENABLE ROW LEVEL SECURITY;

-- POLITIQUES SCHOOLS
CREATE POLICY "SuperAdmin full access schools" ON public.schools FOR ALL USING (public.is_super_admin());
CREATE POLICY "Users read own school" ON public.schools FOR SELECT USING (id = public.get_auth_school_id());

-- POLITIQUES PROFILES
CREATE POLICY "SuperAdmin full access profiles" ON public.profiles FOR ALL USING (public.is_super_admin());
CREATE POLICY "SchoolAdmin view and manage school profiles" ON public.profiles FOR ALL USING (public.is_school_admin(school_id));
CREATE POLICY "Users view profile in same school" ON public.profiles FOR SELECT USING (school_id = public.get_auth_school_id());
CREATE POLICY "Users update own non-sensitive profile" ON public.profiles FOR UPDATE USING (id = auth.uid());

-- POLITIQUES CLASSES & ANNEES
CREATE POLICY "SuperAdmin full access classes" ON public.classes FOR ALL USING (public.is_super_admin());
CREATE POLICY "SchoolAdmin manage school classes" ON public.classes FOR ALL USING (public.is_school_admin(school_id));
CREATE POLICY "School members view classes" ON public.classes FOR SELECT USING (school_id = public.get_auth_school_id());

CREATE POLICY "SuperAdmin full access academic_years" ON public.academic_years FOR ALL USING (public.is_super_admin());
CREATE POLICY "SchoolAdmin manage academic_years" ON public.academic_years FOR ALL USING (public.is_school_admin(school_id));
CREATE POLICY "School members view academic_years" ON public.academic_years FOR SELECT USING (school_id = public.get_auth_school_id());

CREATE POLICY "SuperAdmin full access school_terms" ON public.school_terms FOR ALL USING (public.is_super_admin());
CREATE POLICY "SchoolAdmin manage school_terms" ON public.school_terms FOR ALL USING (public.is_school_admin(school_id));
CREATE POLICY "School members view school_terms" ON public.school_terms FOR SELECT USING (school_id = public.get_auth_school_id());

-- POLITIQUES STUDENTS
CREATE POLICY "SuperAdmin full access students" ON public.students FOR ALL USING (public.is_super_admin());
CREATE POLICY "SchoolAdmin manage students" ON public.students FOR ALL USING (public.is_school_admin(school_id));
CREATE POLICY "Teacher view students in assigned classes" ON public.students FOR SELECT USING (
  public.get_auth_role() = 'teacher' AND (
    school_id = public.get_auth_school_id() AND public.is_teacher_of_class(class_id)
  )
);
CREATE POLICY "Parent view linked children" ON public.students FOR SELECT USING (
  public.get_auth_role() = 'parent' AND public.is_parent_of_student(id)
);
CREATE POLICY "Student view own record" ON public.students FOR SELECT USING (profile_id = auth.uid());

-- POLITIQUES PARENT_STUDENT_LINKS
CREATE POLICY "SuperAdmin full access parent_student_links" ON public.parent_student_links FOR ALL USING (public.is_super_admin());
CREATE POLICY "SchoolAdmin manage parent_student_links" ON public.parent_student_links FOR ALL USING (public.is_school_admin(school_id));
CREATE POLICY "Parent view own links" ON public.parent_student_links FOR SELECT USING (parent_profile_id = auth.uid());

-- POLITIQUES TEACHER_CLASS_ASSIGNMENTS
CREATE POLICY "SuperAdmin full access teacher_class_assignments" ON public.teacher_class_assignments FOR ALL USING (public.is_super_admin());
CREATE POLICY "SchoolAdmin manage teacher_class_assignments" ON public.teacher_class_assignments FOR ALL USING (public.is_school_admin(school_id));
CREATE POLICY "Teacher view own assignments" ON public.teacher_class_assignments FOR SELECT USING (teacher_profile_id = auth.uid());
