export type RealRole = 'super_admin' | 'school_admin' | 'finance_agent' | 'teacher' | 'parent' | 'student';

export interface RealProfile {
  id: string;
  school_id: string | null;
  role: RealRole;
  first_name: string;
  last_name: string;
  display_name?: string;
  phone?: string;
  avatar_url?: string;
  is_active: boolean;
  last_seen_at?: string;
  created_at?: string;
}

export interface RealSchool {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  education_cycles?: string[];
  phone?: string;
  whatsapp?: string;
  email?: string;
  country?: string;
  timezone?: string;
  status: 'active' | 'suspended' | 'archived';
}
