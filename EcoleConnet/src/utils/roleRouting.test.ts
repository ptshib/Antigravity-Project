/**
 * Suite de tests unitaires pour la validation et le routage des rôles ÉcoleConnect.
 */
import { isValidRole, getRoleRedirectPath, isSchoolPortalRole } from './roleRouting';

// Execution-time assertion helper
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ROLE ROUTING TEST FAIL] ${message}`);
  }
}

export function runRoleRoutingTests() {
  // 1. Reconstitution du rôle finance_agent
  assert(isValidRole('finance_agent') === true, "finance_agent doit être reconnu comme un rôle valide");
  assert(getRoleRedirectPath('finance_agent') === '/app/ecole', "finance_agent doit être routé vers /app/ecole");
  assert(isSchoolPortalRole('finance_agent') === true, "finance_agent doit donner accès à RealSchoolAdminPortal");

  // 2. Rejet des rôles inconnus ou invalides
  assert(isValidRole('unknown') === false, "Un rôle inconnu 'unknown' doit être rejeté");
  assert(isValidRole('') === false, "Un rôle vide doit être rejeté");
  assert(isValidRole(null) === false, "Un rôle null doit être rejeté");
  assert(isValidRole(undefined) === false, "Un rôle undefined doit être rejeté");
  assert(getRoleRedirectPath('hacker_role') === '/connexion', "Un rôle inconnu doit rediriger vers /connexion");

  // 3. Maintien strict du routage des rôles existants
  assert(getRoleRedirectPath('super_admin') === '/app/superadmin', "super_admin doit être routé vers /app/superadmin");
  assert(getRoleRedirectPath('school_admin') === '/app/ecole', "school_admin doit être routé vers /app/ecole");
  assert(getRoleRedirectPath('teacher') === '/app/enseignant', "teacher doit être routé vers /app/enseignant");
  assert(getRoleRedirectPath('parent') === '/app/parent', "parent doit être routé vers /app/parent");
  assert(getRoleRedirectPath('student') === '/app/eleve', "student doit être routé vers /app/eleve");

  // 4. Seuls school_admin et finance_agent sont autorisés sur le portail d'établissement
  assert(isSchoolPortalRole('school_admin') === true, "school_admin doit être autorisé sur le portail établissement");
  assert(isSchoolPortalRole('teacher') === false, "teacher ne doit pas accéder directement au portail administration école");
  assert(isSchoolPortalRole('parent') === false, "parent ne doit pas accéder au portail administration école");
  assert(isSchoolPortalRole('student') === false, "student ne doit pas accéder au portail administration école");

  return true;
}

// Auto-exécution lors de l'import de build/compilation
runRoleRoutingTests();
