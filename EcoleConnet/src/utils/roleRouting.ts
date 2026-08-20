import type { RealRole } from '../types/auth';

export const VALID_ROLES: RealRole[] = [
  'super_admin',
  'school_admin',
  'finance_agent',
  'teacher',
  'parent',
  'student'
];

export const ROLE_PATH_MAP: Record<RealRole, string> = {
  super_admin: '/app/superadmin',
  school_admin: '/app/ecole',
  finance_agent: '/app/ecole',
  teacher: '/app/enseignant',
  parent: '/app/parent',
  student: '/app/eleve'
};

export function isValidRole(role: string | null | undefined): role is RealRole {
  if (!role) return false;
  return VALID_ROLES.includes(role as RealRole);
}

export function getRoleRedirectPath(role: string | null | undefined): string {
  if (!role || !isValidRole(role)) {
    return '/connexion';
  }
  return ROLE_PATH_MAP[role];
}

export function isSchoolPortalRole(role: string | null | undefined): boolean {
  return role === 'school_admin' || role === 'finance_agent';
}
