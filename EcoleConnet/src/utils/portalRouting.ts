import type { RealRole } from '../types/auth';

export type SchoolAdminTab =
  | 'vue_densemble'
  | 'finance'
  | 'annees_scolaires'
  | 'trimestres'
  | 'matieres'
  | 'coefficients'
  | 'classes'
  | 'enseignants'
  | 'parents'
  | 'eleves'
  | 'presences'
  | 'devoirs'
  | 'emploi_du_temps'
  | 'notes'
  | 'affectations'
  | 'importations'
  | 'documents'
  | 'parametres';

export type FinanceSubTab =
  | 'vue_densemble'
  | 'creances'
  | 'factures'
  | 'catalogue'
  | 'campagnes'
  | 'email_delivery';

export type ParentTab =
  | 'dashboard'
  | 'mes_enfants'
  | 'enfants'
  | 'presences'
  | 'resultats'
  | 'devoirs'
  | 'emploi_du_temps'
  | 'paiements'
  | 'finance'
  | 'messages'
  | 'calendrier'
  | 'documents';

export type TeacherTab =
  | 'overview'
  | 'classes'
  | 'presences'
  | 'schedule'
  | 'homework'
  | 'grades'
  | 'finance'
  | 'messages'
  | 'profile';

export type StudentTab =
  | 'resultats'
  | 'devoirs'
  | 'emploi_du_temps';

// Mappings: Tab -> Canonical Path
export const ADMIN_TAB_TO_PATH: Record<SchoolAdminTab, string> = {
  vue_densemble: '/app/ecole/vue-densemble',
  eleves: '/app/ecole/eleves',
  parents: '/app/ecole/parents',
  enseignants: '/app/ecole/enseignants',
  classes: '/app/ecole/classes',
  affectations: '/app/ecole/affectations',
  annees_scolaires: '/app/ecole/annees',
  trimestres: '/app/ecole/calendrier',
  matieres: '/app/ecole/matieres',
  coefficients: '/app/ecole/coefficients',
  presences: '/app/ecole/presences',
  devoirs: '/app/ecole/devoirs',
  emploi_du_temps: '/app/ecole/emploi-du-temps',
  notes: '/app/ecole/notes',
  finance: '/app/ecole/finance/vue-densemble',
  importations: '/app/ecole/importations',
  documents: '/app/ecole/documents',
  parametres: '/app/ecole/parametres'
};

export const FINANCE_SUBTAB_TO_PATH: Record<FinanceSubTab, string> = {
  vue_densemble: '/app/ecole/finance/vue-densemble',
  creances: '/app/ecole/finance/balance-creances',
  factures: '/app/ecole/finance/factures',
  catalogue: '/app/ecole/finance/grille-tarifaire',
  campagnes: '/app/ecole/finance/campagnes',
  email_delivery: '/app/ecole/finance/livraisons-email'
};

export const PARENT_TAB_TO_PATH: Record<ParentTab, string> = {
  dashboard: '/app/parent/tableau-de-bord',
  mes_enfants: '/app/parent/enfants',
  enfants: '/app/parent/enfants',
  presences: '/app/parent/presences',
  resultats: '/app/parent/resultats',
  devoirs: '/app/parent/devoirs',
  emploi_du_temps: '/app/parent/emploi-du-temps',
  paiements: '/app/parent/finance',
  finance: '/app/parent/finance',
  messages: '/app/parent/messages',
  calendrier: '/app/parent/calendrier',
  documents: '/app/parent/documents'
};

export const TEACHER_TAB_TO_PATH: Record<TeacherTab, string> = {
  overview: '/app/enseignant/tableau-de-bord',
  classes: '/app/enseignant/classes',
  presences: '/app/enseignant/presences',
  schedule: '/app/enseignant/emploi-du-temps',
  homework: '/app/enseignant/devoirs',
  grades: '/app/enseignant/notes',
  finance: '/app/enseignant/finance',
  messages: '/app/enseignant/messages',
  profile: '/app/enseignant/profil'
};

export const STUDENT_TAB_TO_PATH: Record<StudentTab, string> = {
  resultats: '/app/eleve/resultats',
  devoirs: '/app/eleve/devoirs',
  emploi_du_temps: '/app/eleve/emploi-du-temps'
};

// Sensitive Auth query parameters to strip automatically from URLs
export const SENSITIVE_AUTH_PARAMS = new Set([
  'code',
  'token',
  'access_token',
  'refresh_token',
  'provider_token',
  'error',
  'error_code',
  'error_description',
  'type'
]);

// Sanitize returnTo parameter
export function sanitizeReturnTo(
  returnTo: string | null | undefined,
  role?: RealRole | string | null
): string | null {
  if (!returnTo) return null;
  const trimmed = returnTo.trim();
  // Must start with '/' and NOT with '//' or contain scheme colon ':' (prevents http:, javascript:, data:)
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes(':')) {
    return null;
  }
  if (role) {
    const roleValidation = validateAndSanitizePathForRole(trimmed, role);
    if (!roleValidation.isValid) {
      return null;
    }
  }
  return trimmed;
}

// Sanitize URL search params and hash
export function sanitizeSearchAndHash(
  search: string,
  hash: string,
  role?: RealRole | string | null
): { sanitizedSearch: string; sanitizedHash: string } {
  if (!search || search === '?') {
    return { sanitizedSearch: '', sanitizedHash: hash || '' };
  }

  const rawParams = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(rawParams);
  const keysToRemove: string[] = [];

  params.forEach((val, key) => {
    if (SENSITIVE_AUTH_PARAMS.has(key)) {
      keysToRemove.push(key);
    } else if (key === 'returnTo') {
      const safe = sanitizeReturnTo(val, role);
      if (!safe) {
        keysToRemove.push(key);
      } else if (safe !== val) {
        params.set(key, safe);
      }
    }
  });

  keysToRemove.forEach(k => params.delete(k));

  const newSearchStr = params.toString();
  return {
    sanitizedSearch: newSearchStr ? `?${newSearchStr}` : '',
    sanitizedHash: hash || ''
  };
}

// Build URL with preserved & sanitized search and hash
export function buildPathWithPreservedQueryAndHash(
  newPath: string,
  currentSearch = typeof window !== 'undefined' ? window.location.search : '',
  currentHash = typeof window !== 'undefined' ? window.location.hash : '',
  role?: RealRole | string | null
): string {
  const { sanitizedSearch, sanitizedHash } = sanitizeSearchAndHash(currentSearch, currentHash, role);
  return `${newPath}${sanitizedSearch}${sanitizedHash}`;
}

// Default paths for roles
export function getDefaultRolePath(role: RealRole | string | null | undefined): string {
  switch (role) {
    case 'super_admin':
      return '/app/superadmin';
    case 'finance_agent':
      return '/app/ecole/finance/vue-densemble';
    case 'school_admin':
      return '/app/ecole/vue-densemble';
    case 'teacher':
      return '/app/enseignant/tableau-de-bord';
    case 'parent':
      return '/app/parent/tableau-de-bord';
    case 'student':
      return '/app/eleve/resultats';
    default:
      return '/connexion';
  }
}

// Check role path security
export function validateAndSanitizePathForRole(pathname: string, role: RealRole | string | null | undefined): {
  isValid: boolean;
  sanitizedPath: string;
} {
  const cleanPath = pathname.split('?')[0].replace(/\/$/, '') || '/';
  const defaultPath = getDefaultRolePath(role);

  if (!role) {
    return { isValid: false, sanitizedPath: '/connexion' };
  }

  if (cleanPath.startsWith('/app/superadmin')) {
    if (role !== 'super_admin') {
      return { isValid: false, sanitizedPath: defaultPath };
    }
    return { isValid: true, sanitizedPath: cleanPath };
  }

  if (cleanPath.startsWith('/app/ecole')) {
    if (role !== 'school_admin' && role !== 'finance_agent') {
      return { isValid: false, sanitizedPath: defaultPath };
    }
    if (role === 'finance_agent' && !cleanPath.startsWith('/app/ecole/finance')) {
      return { isValid: false, sanitizedPath: '/app/ecole/finance/vue-densemble' };
    }
    return { isValid: true, sanitizedPath: cleanPath };
  }

  if (cleanPath.startsWith('/app/parent')) {
    if (role !== 'parent') {
      return { isValid: false, sanitizedPath: defaultPath };
    }
    return { isValid: true, sanitizedPath: cleanPath };
  }

  if (cleanPath.startsWith('/app/enseignant')) {
    if (role !== 'teacher') {
      return { isValid: false, sanitizedPath: defaultPath };
    }
    return { isValid: true, sanitizedPath: cleanPath };
  }

  if (cleanPath.startsWith('/app/eleve')) {
    if (role !== 'student') {
      return { isValid: false, sanitizedPath: defaultPath };
    }
    return { isValid: true, sanitizedPath: cleanPath };
  }

  return { isValid: true, sanitizedPath: cleanPath };
}

// Parsers: Path -> Tab
export function parseAdminPath(pathname: string): { tab: SchoolAdminTab; subTab?: FinanceSubTab; canonicalPath: string; isAlias?: boolean } {
  const cleanPath = pathname.split('?')[0].replace(/\/$/, '');

  if (cleanPath === '/app/ecole' || cleanPath === '/app/ecole/') {
    return { tab: 'vue_densemble', canonicalPath: '/app/ecole/vue-densemble', isAlias: true };
  }

  if (cleanPath.startsWith('/app/ecole/finance')) {
    const financeSub = cleanPath.replace('/app/ecole/finance', '').replace(/^\//, '');
    let subTab: FinanceSubTab = 'vue_densemble';
    let isAlias = false;

    if (financeSub === 'balance-creances' || financeSub === 'creances') {
      subTab = 'creances';
      if (financeSub === 'creances') isAlias = true;
    } else if (financeSub === 'factures') {
      subTab = 'factures';
    } else if (financeSub === 'grille-tarifaire' || financeSub === 'catalogue') {
      subTab = 'catalogue';
      if (financeSub === 'catalogue') isAlias = true;
    } else if (financeSub === 'campagnes') {
      subTab = 'campagnes';
    } else if (financeSub === 'livraisons-email' || financeSub === 'email_delivery') {
      subTab = 'email_delivery';
      if (financeSub === 'email_delivery') isAlias = true;
    } else if (financeSub === 'vue-densemble' || financeSub === 'vue_densemble' || financeSub === '') {
      subTab = 'vue_densemble';
      if (financeSub === 'vue_densemble' || financeSub === '') isAlias = true;
    }

    return {
      tab: 'finance',
      subTab,
      canonicalPath: FINANCE_SUBTAB_TO_PATH[subTab],
      isAlias
    };
  }

  const sub = cleanPath.replace('/app/ecole/', '');
  let tab: SchoolAdminTab = 'vue_densemble';
  let isAlias = false;

  switch (sub) {
    case 'eleves': tab = 'eleves'; break;
    case 'parents': tab = 'parents'; break;
    case 'enseignants': tab = 'enseignants'; break;
    case 'classes': tab = 'classes'; break;
    case 'affectations': tab = 'affectations'; break;
    case 'annees':
      tab = 'annees_scolaires';
      break;
    case 'annees_scolaires':
      tab = 'annees_scolaires';
      isAlias = true;
      break;
    case 'calendrier':
      tab = 'trimestres';
      break;
    case 'trimestres':
      tab = 'trimestres';
      isAlias = true;
      break;
    case 'matieres': tab = 'matieres'; break;
    case 'coefficients': tab = 'coefficients'; break;
    case 'presences': tab = 'presences'; break;
    case 'devoirs': tab = 'devoirs'; break;
    case 'emploi-du-temps':
      tab = 'emploi_du_temps';
      break;
    case 'emploi_du_temps':
      tab = 'emploi_du_temps';
      isAlias = true;
      break;
    case 'notes': tab = 'notes'; break;
    case 'importations': tab = 'importations'; break;
    case 'documents': tab = 'documents'; break;
    case 'parametres': tab = 'parametres'; break;
    case 'vue-densemble':
      tab = 'vue_densemble';
      break;
    case 'vue_densemble':
      tab = 'vue_densemble';
      isAlias = true;
      break;
    default:
      tab = 'vue_densemble';
      isAlias = true;
      break;
  }

  return { tab, canonicalPath: ADMIN_TAB_TO_PATH[tab], isAlias };
}

export function parseParentPath(pathname: string): { tab: ParentTab; canonicalPath: string; isAlias?: boolean } {
  const cleanPath = pathname.split('?')[0].replace(/\/$/, '');

  if (cleanPath === '/app/parent' || cleanPath === '/app/parent/') {
    return { tab: 'dashboard', canonicalPath: '/app/parent/tableau-de-bord', isAlias: true };
  }

  const sub = cleanPath.replace('/app/parent/', '');
  let tab: ParentTab = 'dashboard';
  let isAlias = false;

  switch (sub) {
    case 'tableau-de-bord':
      tab = 'dashboard';
      break;
    case 'dashboard':
      tab = 'dashboard';
      isAlias = true;
      break;
    case 'enfants':
      tab = 'mes_enfants';
      break;
    case 'mes-enfants':
      tab = 'mes_enfants';
      isAlias = true;
      break;
    case 'mes_enfants':
      tab = 'mes_enfants';
      isAlias = true;
      break;
    case 'presences': tab = 'presences'; break;
    case 'resultats': tab = 'resultats'; break;
    case 'devoirs': tab = 'devoirs'; break;
    case 'emploi-du-temps':
      tab = 'emploi_du_temps';
      break;
    case 'emploi_du_temps':
      tab = 'emploi_du_temps';
      isAlias = true;
      break;
    case 'finance':
      tab = 'paiements';
      break;
    case 'paiements':
      tab = 'paiements';
      isAlias = true;
      break;
    case 'messages': tab = 'messages'; break;
    case 'calendrier': tab = 'calendrier'; break;
    case 'documents': tab = 'documents'; break;
    default:
      tab = 'dashboard';
      isAlias = true;
      break;
  }

  return { tab, canonicalPath: PARENT_TAB_TO_PATH[tab], isAlias };
}

export function parseTeacherPath(pathname: string): { tab: TeacherTab; canonicalPath: string; isAlias?: boolean } {
  const cleanPath = pathname.split('?')[0].replace(/\/$/, '');

  if (cleanPath === '/app/enseignant' || cleanPath === '/app/enseignant/') {
    return { tab: 'overview', canonicalPath: '/app/enseignant/tableau-de-bord', isAlias: true };
  }

  const sub = cleanPath.replace('/app/enseignant/', '');
  let tab: TeacherTab = 'overview';
  let isAlias = false;

  switch (sub) {
    case 'tableau-de-bord':
      tab = 'overview';
      break;
    case 'overview':
      tab = 'overview';
      isAlias = true;
      break;
    case 'classes': tab = 'classes'; break;
    case 'presences': tab = 'presences'; break;
    case 'emploi-du-temps':
      tab = 'schedule';
      break;
    case 'schedule':
      tab = 'schedule';
      isAlias = true;
      break;
    case 'devoirs':
      tab = 'homework';
      break;
    case 'homework':
      tab = 'homework';
      isAlias = true;
      break;
    case 'notes':
      tab = 'grades';
      break;
    case 'grades':
      tab = 'grades';
      isAlias = true;
      break;
    case 'finance': tab = 'finance'; break;
    case 'messages': tab = 'messages'; break;
    case 'profil':
      tab = 'profile';
      break;
    case 'profile':
      tab = 'profile';
      isAlias = true;
      break;
    default:
      tab = 'overview';
      isAlias = true;
      break;
  }

  return { tab, canonicalPath: TEACHER_TAB_TO_PATH[tab], isAlias };
}

export function parseStudentPath(pathname: string): { tab: StudentTab; canonicalPath: string; isAlias?: boolean } {
  const cleanPath = pathname.split('?')[0].replace(/\/$/, '');

  if (cleanPath === '/app/eleve' || cleanPath === '/app/eleve/') {
    return { tab: 'resultats', canonicalPath: '/app/eleve/resultats', isAlias: true };
  }

  const sub = cleanPath.replace('/app/eleve/', '');
  let tab: StudentTab = 'resultats';
  let isAlias = false;

  switch (sub) {
    case 'resultats':
      tab = 'resultats';
      break;
    case 'devoirs':
      tab = 'devoirs';
      break;
    case 'emploi-du-temps':
      tab = 'emploi_du_temps';
      break;
    case 'emploi_du_temps':
      tab = 'emploi_du_temps';
      isAlias = true;
      break;
    default:
      // Fallback for non-existent student routes (calendrier, presences, profil, unknown)
      tab = 'resultats';
      isAlias = true;
      break;
  }

  return { tab, canonicalPath: STUDENT_TAB_TO_PATH[tab], isAlias };
}
