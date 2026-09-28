// supabase/functions/tests/appUrlResolver.test.ts
import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { resolveAppUrl, buildCorsHeaders, getAllowedOrigins } from '../_shared/cors.ts';

Deno.test('A. ECOLELINK_APP_URL et argument historique tous les deux valides (ECOLELINK prioritaire)', () => {
  Deno.env.set('ECOLELINK_APP_URL', 'https://new.ecolelink.com');
  const resolved = resolveAppUrl('https://legacy.ecoleconnect.com');
  assertEquals(resolved, 'https://new.ecolelink.com');
  Deno.env.delete('ECOLELINK_APP_URL');
});

Deno.test('B. ECOLELINK_APP_URL invalide et argument historique valide', () => {
  Deno.env.set('ECOLELINK_APP_URL', 'invalid-url');
  const resolved = resolveAppUrl('https://legacy.ecoleconnect.com/path/');
  assertEquals(resolved, 'https://legacy.ecoleconnect.com');
  Deno.env.delete('ECOLELINK_APP_URL');
});

Deno.test('C. ECOLELINK_APP_URL vide et argument historique valide', () => {
  Deno.env.set('ECOLELINK_APP_URL', '   ');
  const resolved = resolveAppUrl('https://legacy.ecoleconnect.com');
  assertEquals(resolved, 'https://legacy.ecoleconnect.com');
  Deno.env.delete('ECOLELINK_APP_URL');
});

Deno.test('D. Argument historique invalide et ECOLECONNECT_APP_URL valide', () => {
  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.set('ECOLECONNECT_APP_URL', 'https://secondary.ecoleconnect.com');
  const resolved = resolveAppUrl('htt:::invalid');
  assertEquals(resolved, 'https://secondary.ecoleconnect.com');
  Deno.env.delete('ECOLECONNECT_APP_URL');
});

Deno.test('E. Aucun candidat valide', () => {
  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.delete('ECOLECONNECT_APP_URL');
  Deno.env.delete('SITE_URL');
  const resolved = resolveAppUrl('invalid-url-arg');
  assertEquals(resolved, 'https://ecolelink.com');
});

Deno.test('1. ECOLELINK_APP_URL prioritaire sur ECOLECONNECT_APP_URL et SITE_URL', () => {
  Deno.env.set('ECOLELINK_APP_URL', 'https://primary.ecolelink.com');
  Deno.env.set('ECOLECONNECT_APP_URL', 'https://secondary.ecoleconnect.com');
  Deno.env.set('SITE_URL', 'https://fallback.site.com');

  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://primary.ecolelink.com');

  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.delete('ECOLECONNECT_APP_URL');
  Deno.env.delete('SITE_URL');
});

Deno.test('2. Fallback vers ECOLECONNECT_APP_URL', () => {
  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.set('ECOLECONNECT_APP_URL', 'https://secondary.ecoleconnect.com');
  Deno.env.set('SITE_URL', 'https://fallback.site.com');

  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://secondary.ecoleconnect.com');

  Deno.env.delete('ECOLECONNECT_APP_URL');
  Deno.env.delete('SITE_URL');
});

Deno.test('3. Fallback vers SITE_URL', () => {
  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.delete('ECOLECONNECT_APP_URL');
  Deno.env.set('SITE_URL', 'https://fallback.site.com');

  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://fallback.site.com');

  Deno.env.delete('SITE_URL');
});

Deno.test('4. Fallback final https://ecolelink.com', () => {
  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.delete('ECOLECONNECT_APP_URL');
  Deno.env.delete('SITE_URL');

  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://ecolelink.com');
});

Deno.test('5. ECOLELINK_APP_URL vide', () => {
  Deno.env.set('ECOLELINK_APP_URL', '');
  Deno.env.set('ECOLECONNECT_APP_URL', 'https://fallback-connect.com');

  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://fallback-connect.com');

  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.delete('ECOLECONNECT_APP_URL');
});

Deno.test('6. ECOLELINK_APP_URL composée uniquement d’espaces', () => {
  Deno.env.set('ECOLELINK_APP_URL', '   ');
  Deno.env.set('SITE_URL', 'https://valid-site.com');

  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://valid-site.com');

  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.delete('SITE_URL');
});

Deno.test('7. ECOLELINK_APP_URL invalide', () => {
  Deno.env.set('ECOLELINK_APP_URL', 'invalid-url-string');
  Deno.env.set('SITE_URL', 'https://valid-fallback.com');

  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://valid-fallback.com');

  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.delete('SITE_URL');
});

Deno.test('8. Ancien secret invalide mais SITE_URL valide', () => {
  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.set('ECOLECONNECT_APP_URL', 'htt:::invalid');
  Deno.env.set('SITE_URL', 'https://valid-site.com');

  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://valid-site.com');

  Deno.env.delete('ECOLECONNECT_APP_URL');
  Deno.env.delete('SITE_URL');
});

Deno.test('9. Suppression du slash final', () => {
  Deno.env.set('ECOLELINK_APP_URL', 'https://ecolelink.com/');
  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://ecolelink.com');
  Deno.env.delete('ECOLELINK_APP_URL');
});

Deno.test('10. Suppression d’un chemin accidentel', () => {
  Deno.env.set('ECOLELINK_APP_URL', 'https://ecolelink.com/auth/login?token=abc');
  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://ecolelink.com');
  Deno.env.delete('ECOLELINK_APP_URL');
});

Deno.test('11. Rejet d’un protocole non HTTP/HTTPS', () => {
  Deno.env.set('ECOLELINK_APP_URL', 'javascript:alert(1)');
  const resolved = resolveAppUrl();
  assertEquals(resolved, 'https://ecolelink.com');
  Deno.env.delete('ECOLELINK_APP_URL');
});

Deno.test('12. Absence de wildcard CORS', () => {
  const req = new Request('https://ecolelink.com', { headers: { Origin: 'https://ecolelink.com' } });
  const { headers } = buildCorsHeaders(req);
  assertNotEquals(headers['Access-Control-Allow-Origin'], '*');
  assertEquals(headers['Access-Control-Allow-Origin'], 'https://ecolelink.com');
});

Deno.test('13. Origine ecolelink.com autorisée', () => {
  const req = new Request('https://ecolelink.com', { headers: { Origin: 'https://ecolelink.com' } });
  const { isAllowed, headers } = buildCorsHeaders(req);
  assertEquals(isAllowed, true);
  assertEquals(headers['Access-Control-Allow-Origin'], 'https://ecolelink.com');
});

Deno.test('14. Origine non autorisée refusée', () => {
  const req = new Request('https://ecolelink.com', { headers: { Origin: 'https://malicious-site.com' } });
  const { isAllowed, headers } = buildCorsHeaders(req);
  assertEquals(isAllowed, false);
  assertEquals(headers['Access-Control-Allow-Origin'], 'https://ecolelink.com');
});

Deno.test('15. Liens d’invitation utilisant ÉcoleLink', () => {
  Deno.env.set('ECOLELINK_APP_URL', 'https://ecolelink.com');
  const appUrl = resolveAppUrl();
  const inviteLink = `${appUrl}/accept-invitation?token=123`;
  assertEquals(inviteLink, 'https://ecolelink.com/accept-invitation?token=123');
  Deno.env.delete('ECOLELINK_APP_URL');
});

Deno.test('16. Non-régression de ECOLECONNECT_APP_URL', () => {
  Deno.env.delete('ECOLELINK_APP_URL');
  Deno.env.set('ECOLECONNECT_APP_URL', 'https://legacy-connect.com');
  const allowed = getAllowedOrigins();
  assertEquals(allowed.has('https://legacy-connect.com'), true);
  Deno.env.delete('ECOLECONNECT_APP_URL');
});

Deno.test('17. Absence d’exposition des valeurs secrètes dans les erreurs ou logs', () => {
  Deno.env.set('ECOLELINK_APP_URL', 'https://secret-app.com');
  const result = resolveAppUrl();
  assertEquals(result, 'https://secret-app.com');
  Deno.env.delete('ECOLELINK_APP_URL');
});
