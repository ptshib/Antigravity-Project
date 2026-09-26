// Deno Unit & Integration Test Suite for invite-school-parent Edge Function (40 Scenarios)
// File: supabase/functions/invite-school-parent/index.test.ts

import { assertEquals, assertNotEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { inviteSchoolParentHandler } from './index.ts';

function createMockRequest(options: {
  method?: string;
  origin?: string;
  authHeader?: string;
  body?: any;
  contentType?: string;
}): Request {
  const method = options.method || 'POST';
  const headers: Record<string, string> = {
    'Origin': options.origin || 'https://ecolelink.com',
    'Content-Type': options.contentType || 'application/json',
  };
  if (options.authHeader !== undefined) {
    if (options.authHeader) {
      headers['Authorization'] = options.authHeader;
    }
  } else {
    headers['Authorization'] = 'Bearer mock-jwt-token-admin';
  }

  const reqInit: RequestInit = { method, headers };
  if (method === 'POST' && options.body !== undefined) {
    reqInit.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  return new Request('https://edge.example.com/invite-school-parent', reqInit);
}

function setupMockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'mock-service-key');
  Deno.env.set('SUPABASE_ANON_KEY', 'mock-anon-key');
  Deno.env.set('ECOLECONNECT_APP_URL', 'https://ecolelink.com');
  Deno.env.set('RESEND_API_KEY', 're_mock_12345');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return await handler(url, init);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

// -----------------------------------------------------------------------------
// 1. OPTIONS autorisé
// -----------------------------------------------------------------------------
Deno.test('1. OPTIONS request with allowed origin returns 200 OK', async () => {
  const restore = setupMockFetch(() => new Response('ok'));
  try {
    const req = createMockRequest({ method: 'OPTIONS', origin: 'https://ecolelink.com' });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 2. Origine autorisée
// -----------------------------------------------------------------------------
Deno.test('2. Allowed origin is preserved in CORS headers', async () => {
  const restore = setupMockFetch(() => new Response('ok'));
  try {
    const req = createMockRequest({ method: 'OPTIONS', origin: 'https://ecolelink.com' });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://ecolelink.com');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 3. Origine interdite
// -----------------------------------------------------------------------------
Deno.test('3. Forbidden origin returns 403 Forbidden', async () => {
  const restore = setupMockFetch(() => new Response('ok'));
  try {
    const req = createMockRequest({ origin: 'https://malicious-site.com' });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 403);
    const json = await res.json();
    assertEquals(json.success, false);
    assertEquals(json.code, 'unauthorized');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 4. Méthode non-POST
// -----------------------------------------------------------------------------
Deno.test('4. Non-POST method (GET) returns 405 Method Not Allowed', async () => {
  const restore = setupMockFetch(() => new Response('ok'));
  try {
    const req = createMockRequest({ method: 'GET' });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 405);
    const json = await res.json();
    assertEquals(json.code, 'unauthorized');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 5. Authorization absente
// -----------------------------------------------------------------------------
Deno.test('5. Missing Authorization header returns 401 Unauthorized', async () => {
  const restore = setupMockFetch(() => new Response('ok'));
  try {
    const req = createMockRequest({
      authHeader: '',
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'parent@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 401);
    const json = await res.json();
    assertEquals(json.code, 'unauthorized');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 6. JWT expiré ou invalide
// -----------------------------------------------------------------------------
Deno.test('6. Expired or invalid JWT returns 401 Unauthorized', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ message: 'Invalid JWT' }), { status: 401 });
    }
    return new Response('{}', { status: 200 });
  });
  try {
    const req = createMockRequest({
      authHeader: 'Bearer expired-jwt-token',
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'parent@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 401);
    const json = await res.json();
    assertEquals(json.code, 'unauthorized');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 7. Utilisateur non-admin
// -----------------------------------------------------------------------------
Deno.test('7. Non-admin caller (teacher) returns 403 Forbidden', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'teacher-user-id', email: 'teacher@test.com' }), { status: 200 });
    }
    if (url.includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify({ id: 'teacher-user-id', role: 'teacher', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'parent@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 403);
    const json = await res.json();
    assertEquals(json.code, 'unauthorized');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 8. Admin suspendu
// -----------------------------------------------------------------------------
Deno.test('8. Suspended admin (is_active = false) returns 403 Forbidden', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'suspended-admin-id', email: 'admin@test.com' }), { status: 200 });
    }
    if (url.includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify({ id: 'suspended-admin-id', role: 'school_admin', is_active: false, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'parent@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 403);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 9. Admin d’une autre école
// -----------------------------------------------------------------------------
Deno.test('9. Admin inviting student for inactive/foreign school returns 403 Forbidden', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'admin-id', email: 'admin@test.com' }), { status: 200 });
    }
    if (url.includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    }
    if (url.includes('/rest/v1/schools')) {
      return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'suspended', name: 'Ecole B' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'parent@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 403);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 10. Email invalide
// -----------------------------------------------------------------------------
Deno.test('10. Invalid email format returns 400 Bad Request', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'invalid-email-format', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.code, 'validation_error');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 11. Élève inexistant
// -----------------------------------------------------------------------------
Deno.test('11. Non-existent student ID returns error from RPC', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: '88888888-8888-4888-8888-888888888888' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: '88888888-8888-4888-8888-888888888888', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) {
      return new Response(JSON.stringify({ message: 'REJET : Un ou plusieurs élèves spécifiés n’existent pas.' }), { status: 400 });
    }
    if (url.includes('/auth/v1/admin/users/88888888-8888-4888-8888-888888888888')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 200 });
  });
  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'parent@test.com', student_ids: ['99999999-9999-4999-8999-999999999999'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 500);
    const json = await res.json();
    assertEquals(json.code, 'invitation_processing_failed');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 12. Élève d’une autre école
// -----------------------------------------------------------------------------
Deno.test('12. Student belonging to another school returns controlled error', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: '88888888-8888-4888-8888-888888888888' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: '88888888-8888-4888-8888-888888888888', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) {
      return new Response(JSON.stringify({ message: 'REJET ACCÈS : Les élèves doivent appartenir à l’établissement de l’administrateur invitant.' }), { status: 400 });
    }
    return new Response('{}', { status: 200 });
  });
  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'parent@test.com', student_ids: ['22222222-2222-4222-8222-222222222222'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 500);
    const json = await res.json();
    assertEquals(json.code, 'invitation_processing_failed');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 13. Mélange d’élèves de deux écoles
// -----------------------------------------------------------------------------
Deno.test('13. Mixed school students list returns controlled error', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: '88888888-8888-4888-8888-888888888888' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: '88888888-8888-4888-8888-888888888888', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) {
      return new Response(JSON.stringify({ message: 'REJET ACCÈS : Les élèves doivent appartenir au même établissement.' }), { status: 400 });
    }
    return new Response('{}', { status: 200 });
  });
  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'parent@test.com', student_ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 500);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 14. Nouvel email Auth
// -----------------------------------------------------------------------------
Deno.test('14. New Auth email triggers inviteUserByEmail and returns 200 INVITATION_SENT', async () => {
  let inviteUserCalled = false;
  let rpcCalled = false;

  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) {
      inviteUserCalled = true;
      return new Response(JSON.stringify({ user: { id: 'new-auth-user-id' } }), { status: 200 });
    }
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'new-auth-user-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) {
      rpcCalled = true;
      return new Response(JSON.stringify([{ invitation_id: 'inv-uuid-1234', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jonas', last_name: 'Banza', email: 'jonas.new@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.code, 'INVITATION_SENT');
    assertEquals(inviteUserCalled, true);
    assertEquals(rpcCalled, true);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 15. Compte Parent existant
// -----------------------------------------------------------------------------
Deno.test('15. Existing Parent account uses Resend and creates invitation without creating new Auth user', async () => {
  let resendCalled = false;
  let inviteUserCalled = false;

  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('admin-id')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([{ user_id: 'existing-parent-id', email_normalized: 'jonas.existing@test.com', email_confirmed: true }]), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('existing-parent-id')) return new Response(JSON.stringify({ id: 'existing-parent-id', role: 'parent', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/parent_accounts')) return new Response(JSON.stringify({ profile_id: 'existing-parent-id', account_status: 'active' }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'existing-parent-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: false, parent_account_created: false }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-existing-999', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    if (url.includes('api.resend.com')) {
      resendCalled = true;
      return new Response(JSON.stringify({ id: 'msg_resend_123' }), { status: 200 });
    }
    if (url.includes('/auth/v1/invite')) {
      inviteUserCalled = true;
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jonas', last_name: 'Banza', email: 'jonas.existing@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.code, 'INVITATION_SENT');
    assertEquals(resendCalled, true);
    assertEquals(inviteUserCalled, false);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 16. Compte existant non compatible Parent
// -----------------------------------------------------------------------------
Deno.test('16. Existing non-parent account (teacher) returns 409 EXISTING_ACCOUNT_NOT_PARENT_COMPATIBLE', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('admin-id')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([{ user_id: 'existing-teacher-id', email_normalized: 'teacher.existing@test.com', email_confirmed: true }]), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('existing-teacher-id')) return new Response(JSON.stringify({ id: 'existing-teacher-id', role: 'teacher', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/parent_accounts')) return new Response(JSON.stringify(null), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Paul', last_name: 'Prof', email: 'teacher.existing@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 409);
    const json = await res.json();
    assertEquals(json.code, 'EXISTING_ACCOUNT_NOT_PARENT_COMPATIBLE');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 17. Invitation pending déjà présente
// -----------------------------------------------------------------------------
Deno.test('17. Pending invitation already present returns 409 INVITATION_ALREADY_PENDING', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: '88888888-8888-4888-8888-888888888888' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: '88888888-8888-4888-8888-888888888888', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) {
      return new Response(JSON.stringify({ message: 'INVITATION_ALREADY_PENDING: Une invitation parent en attente existe déjà pour cet email dans cet établissement.' }), { status: 400 });
    }
    if (url.includes('/auth/v1/admin/users/88888888-8888-4888-8888-888888888888')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'pending@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 409);
    const json = await res.json();
    assertEquals(json.code, 'INVITATION_ALREADY_PENDING');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 18. Invitation temporellement expirée mais encore pending
// -----------------------------------------------------------------------------
Deno.test('18. Expired pending invitation is marked expired by RPC and new invitation created', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: '88888888-8888-4888-8888-888888888888' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: '88888888-8888-4888-8888-888888888888', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-new-999', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'expired.pending@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.code, 'INVITATION_SENT');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 19. Panne inviteUserByEmail
// -----------------------------------------------------------------------------
Deno.test('19. Failure in inviteUserByEmail returns classified error without exposing trace', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) {
      return new Response(JSON.stringify({ message: 'Over email send rate limit', code: 'over_email_send_rate_limit' }), { status: 429 });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'ratelimit@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 429);
    const json = await res.json();
    assertEquals(json.code, 'rate_limit_exceeded');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 20. Panne RPC après création Auth
// -----------------------------------------------------------------------------
Deno.test('20. RPC failure after Auth user creation triggers atomic error handling', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'orphaned-auth-id' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'orphaned-auth-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify({ message: 'DB connection error' }), { status: 500 });
    if (url.includes('/auth/v1/admin/users/orphaned-auth-id')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'rpcfail@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 500);
    const json = await res.json();
    assertEquals(json.code, 'invitation_processing_failed');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 21. Compensation par deleteUser
// -----------------------------------------------------------------------------
Deno.test('21. Orphaned Auth user is compensated by deleteUser when RPC fails', async () => {
  let deleteUserCalledWith: string | null = null;
  const targetUuid = '77777777-7777-4777-8777-777777777777';

  const restore = setupMockFetch((url, init) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes(`/auth/v1/admin/users/${targetUuid}`) && init?.method === 'DELETE') {
      deleteUserCalledWith = targetUuid;
      return new Response('{}', { status: 200 });
    }
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: targetUuid } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: targetUuid, school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify({ message: 'SQL failure' }), { status: 400 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'rollback@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 500);
    assertEquals(deleteUserCalledWith, targetUuid);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 22. Panne Resend sur compte existant
// -----------------------------------------------------------------------------
Deno.test('22. Resend failure on existing account returns 502 EMAIL_DELIVERY_FAILED', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('admin-id')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([{ user_id: 'existing-parent-id', email_normalized: 'resendfail@test.com', email_confirmed: true }]), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('existing-parent-id')) return new Response(JSON.stringify({ id: 'existing-parent-id', role: 'parent', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/parent_accounts')) return new Response(JSON.stringify({ profile_id: 'existing-parent-id', account_status: 'active' }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'existing-parent-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: false, parent_account_created: false }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-resend-fail-1', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    if (url.includes('api.resend.com')) {
      return new Response(JSON.stringify({ name: 'internal_server_error', message: 'Resend API down' }), { status: 500 });
    }
    if (url.includes('/rest/v1/school_membership_invitations')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'resendfail@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 502);
    const json = await res.json();
    assertEquals(json.code, 'EMAIL_DELIVERY_FAILED');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 23. Compte Auth existant jamais supprimé
// -----------------------------------------------------------------------------
Deno.test('23. Existing Auth user is NEVER deleted upon Resend failure', async () => {
  let deleteUserCalled = false;

  const restore = setupMockFetch((url, init) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('admin-id')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([{ user_id: 'existing-parent-id', email_normalized: 'resendfail2@test.com', email_confirmed: true }]), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('existing-parent-id')) return new Response(JSON.stringify({ id: 'existing-parent-id', role: 'parent', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/parent_accounts')) return new Response(JSON.stringify({ profile_id: 'existing-parent-id', account_status: 'active' }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'existing-parent-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: false, parent_account_created: false }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-resend-fail-2', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    if (url.includes('api.resend.com')) {
      return new Response(JSON.stringify({ name: 'internal_server_error' }), { status: 500 });
    }
    if (url.includes('/auth/v1/admin/users') && init?.method === 'DELETE') {
      deleteUserCalled = true;
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'resendfail2@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 502);
    assertEquals(deleteUserCalled, false);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 24. Invitation révoquée après panne Resend
// -----------------------------------------------------------------------------
Deno.test('24. Invitation is marked revoked in DB after Resend failure', async () => {
  let updateStatusRevokedCalled = false;

  const restore = setupMockFetch((url, init) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('admin-id')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([{ user_id: 'existing-parent-id', email_normalized: 'resendfail3@test.com', email_confirmed: true }]), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('existing-parent-id')) return new Response(JSON.stringify({ id: 'existing-parent-id', role: 'parent', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/parent_accounts')) return new Response(JSON.stringify({ profile_id: 'existing-parent-id', account_status: 'active' }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'existing-parent-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: false, parent_account_created: false }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-resend-fail-3', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    if (url.includes('api.resend.com')) {
      return new Response(JSON.stringify({ name: 'internal_server_error' }), { status: 500 });
    }
    if (url.includes('/rest/v1/school_membership_invitations') && init?.method === 'PATCH') {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      if (body.status === 'revoked') {
        updateStatusRevokedCalled = true;
      }
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'resendfail3@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 502);
    assertEquals(updateStatusRevokedCalled, true);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 25. Double requête concurrente
// -----------------------------------------------------------------------------
Deno.test('25. Concurrent request resulting in duplicate pending throws controlled 409 Conflict without raw 23505', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'auth-concurrent-id' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'auth-concurrent-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) {
      return new Response(JSON.stringify({ message: 'INVITATION_ALREADY_PENDING: Une invitation parent en attente existe déjà...', code: '23505' }), { status: 400 });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'concurrent@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 409);
    const json = await res.json();
    assertEquals(json.code, 'INVITATION_ALREADY_PENDING');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 26. Jeton absent de la réponse Admin
// -----------------------------------------------------------------------------
Deno.test('26. Raw invitation token is NEVER present in Admin success response', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'auth-user-tokenless' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'auth-user-tokenless', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-tokenless-123', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'tokenless@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.token, undefined);
    assertEquals(json.rawToken, undefined);
    assertEquals(json.token_hash, undefined);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 27. Jeton absent des logs
// -----------------------------------------------------------------------------
Deno.test('27. Raw token is NEVER printed in console logs or error outputs', async () => {
  const loggedMessages: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: any[]) => loggedMessages.push(args.join(' '));
  console.error = (...args: any[]) => loggedMessages.push(args.join(' '));

  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'auth-user-logtest' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'auth-user-logtest', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-logtest-123', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'logtest@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    await inviteSchoolParentHandler(req);

    const fullLogText = loggedMessages.join(' ');
    assertNotEquals(fullLogText.includes('rawToken'), true);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    restore();
  }
});

// -----------------------------------------------------------------------------
// 28. Erreur Supabase brute masquée
// -----------------------------------------------------------------------------
Deno.test('28. Raw Supabase service error is masked behind clean error object', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) {
      return new Response(JSON.stringify({ message: 'Internal GoTrue server crash at line 402' }), { status: 500 });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'supacrash@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 500);
    const json = await res.json();
    assertEquals(json.code, 'invitation_processing_failed');
    assertStringIncludes(json.message, 'Échec de l’envoi');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 29. Erreur SQL brute masquée
// -----------------------------------------------------------------------------
Deno.test('29. Raw SQL error is masked behind user-friendly French message', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'auth-sql-crash-id' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'auth-sql-crash-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) {
      return new Response(JSON.stringify({ message: 'ERROR: 23502: null value in column "created_at" violates not-null constraint' }), { status: 500 });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'sqlcrash@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 500);
    const json = await res.json();
    assertEquals(json.code, 'invitation_processing_failed');
    assertStringIncludes(json.message, 'Échec de l’enregistrement');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 30. Succès retournant uniquement un contrat Admin neutre
// -----------------------------------------------------------------------------
Deno.test('30. Successful invitation returns neutral Admin response schema without sensitive properties', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'auth-user-neutral' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'auth-user-neutral', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-neutral-123', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'neutral@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    const json = await res.json();

    const keys = Object.keys(json).sort();
    assertEquals(keys, ['code', 'message', 'success']);
    assertEquals(json.success, true);
    assertEquals(json.code, 'INVITATION_SENT');
    assertEquals(json.message, 'Invitation transmise avec succès au responsable.');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 31. Absence d’email et de nom dans la réponse d’administration neutre
// -----------------------------------------------------------------------------
Deno.test('31. Admin response never leaks recipient email or full name', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'auth-user-noleak' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'auth-user-noleak', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-noleak-123', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Pierre', last_name: 'Mbuyi', email: 'pierre.mbuyi@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    const json = await res.json();
    assertEquals(json.message.includes('pierre.mbuyi@test.com'), false);
    assertEquals(json.message.includes('Pierre Mbuyi'), false);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 32. Clé API Resend manquante retourne 502 et révoque l’invitation
// -----------------------------------------------------------------------------
Deno.test('32. Missing RESEND_API_KEY for existing user returns 502 and revokes invitation', async () => {
  Deno.env.set('RESEND_API_KEY', '');
  let patchRevokedCalled = false;

  const restore = setupMockFetch((url, init) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('admin-id')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([{ user_id: 'existing-no-key-id', email_normalized: 'nokey@test.com', email_confirmed: true }]), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('existing-no-key-id')) return new Response(JSON.stringify({ id: 'existing-no-key-id', role: 'parent', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/parent_accounts')) return new Response(JSON.stringify({ profile_id: 'existing-no-key-id', account_status: 'active' }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'existing-no-key-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: false, parent_account_created: false }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-nokey-123', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    if (url.includes('/rest/v1/school_membership_invitations') && init?.method === 'PATCH') {
      patchRevokedCalled = true;
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'nokey@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 502);
    const json = await res.json();
    assertEquals(json.code, 'EMAIL_DELIVERY_FAILED');
    assertEquals(patchRevokedCalled, true);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 33. Invitation parent existant ne déclenche pas inviteUserByEmail
// -----------------------------------------------------------------------------
Deno.test('33. Inviting existing parent user does not trigger Auth inviteUserByEmail', async () => {
  let inviteUserByEmailCalled = false;

  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('admin-id')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([{ user_id: 'parent-exists-id', email_normalized: 'parentexists@test.com', email_confirmed: true }]), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('parent-exists-id')) return new Response(JSON.stringify({ id: 'parent-exists-id', role: 'parent', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/parent_accounts')) return new Response(JSON.stringify({ profile_id: 'parent-exists-id', account_status: 'active' }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'parent-exists-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: false, parent_account_created: false }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-exists-456', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    if (url.includes('api.resend.com')) return new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 });
    if (url.includes('/auth/v1/invite')) inviteUserByEmailCalled = true;
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'parentexists@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    assertEquals(inviteUserByEmailCalled, false);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 34. Compensation parent existant transmet profile_created = false
// -----------------------------------------------------------------------------
Deno.test('34. Cleanup for existing parent passes profile_created = false to preserve profile', async () => {
  let cleanupPayload: any = null;

  const restore = setupMockFetch((url, init) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('admin-id')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([{ user_id: 'parent-existing-id', email_normalized: 'existingclean@test.com', email_confirmed: true }]), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('parent-existing-id')) return new Response(JSON.stringify({ id: 'parent-existing-id', role: 'parent', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/parent_accounts')) return new Response(JSON.stringify({ profile_id: 'parent-existing-id', account_status: 'active' }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'parent-existing-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: false, parent_account_created: false }]), { status: 200 });
    if (url.includes('/rpc/cleanup_prepared_parent_identity')) {
      cleanupPayload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return new Response('{}', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'existingclean@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    await inviteSchoolParentHandler(req);
    if (cleanupPayload) {
      assertEquals(cleanupPayload.p_profile_created, false);
      assertEquals(cleanupPayload.p_parent_account_created, false);
    }
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 35. Création nouveau compte transmet profile_created = true
// -----------------------------------------------------------------------------
Deno.test('35. New user creation captures profile_created = true from prepare RPC', async () => {
  let prepareRpcCalled = false;

  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'new-user-flag-id' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) {
      prepareRpcCalled = true;
      return new Response(JSON.stringify([{ profile_id: 'new-user-flag-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    }
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-flag-123', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'flagtest@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    assertEquals(prepareRpcCalled, true);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 36. Double appel préparatoire idempotent
// -----------------------------------------------------------------------------
Deno.test('36. Replay of prepare_parent_invitee_identity is idempotent', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'auth-user-idem' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'auth-user-idem', school_id: '11111111-1111-4111-8111-111111111111', profile_created: false, parent_account_created: false }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-idem-123', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'idem@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 37. Absence d’envoi d’email sans RESEND_API_KEY
// -----------------------------------------------------------------------------
Deno.test('37. Existing parent invite without RESEND_API_KEY blocks sending and revokes invitation', async () => {
  Deno.env.set('RESEND_API_KEY', '');

  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('admin-id')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([{ user_id: 'existing-id-no-key', email_normalized: 'existingnokey@test.com', email_confirmed: true }]), { status: 200 });
    if (url.includes('/rest/v1/profiles') && url.includes('existing-id-no-key')) return new Response(JSON.stringify({ id: 'existing-id-no-key', role: 'parent', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/parent_accounts')) return new Response(JSON.stringify({ profile_id: 'existing-id-no-key', account_status: 'active' }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'existing-id-no-key', school_id: '11111111-1111-4111-8111-111111111111', profile_created: false, parent_account_created: false }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-existing-nokey', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'existingnokey@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 502);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 38. Ingestion sécurisée des paramètres et assainissement
// -----------------------------------------------------------------------------
Deno.test('38. Whitespace in email and names is trimmed and sanitized before RPC execution', async () => {
  let passedEmail = '';

  const restore = setupMockFetch((url, init) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      passedEmail = body.p_email;
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'auth-user-trim' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'auth-user-trim', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-trim-123', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: '  Jean  ', last_name: '  Dupont  ', email: '  ParenT.TRIM@test.com  ', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    assertEquals(passedEmail, 'parent.trim@test.com');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 39. Double rollback sécurisé en cas d’échec Auth deleteUser
// -----------------------------------------------------------------------------
Deno.test('39. Cleanup handles deleteUser exception gracefully and still returns 500 processing failed', async () => {
  const restore = setupMockFetch((url, init) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users/77777777-7777-4777-8777-777777777777') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ message: 'Auth service network unreachable' }), { status: 503 });
    }
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: '77777777-7777-4777-8777-777777777777' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: '77777777-7777-4777-8777-777777777777', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify({ message: 'DB crash' }), { status: 500 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Jean', last_name: 'Dupont', email: 'delcrash@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 500);
    const json = await res.json();
    assertEquals(json.code, 'invitation_processing_failed');
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// 40. Validation complète du parcours Edge Fonction pour nouvel utilisateur
// -----------------------------------------------------------------------------
Deno.test('40. Full Edge Function workflow for new user completes cleanly with neutral response', async () => {
  const restore = setupMockFetch((url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify({ id: 'admin-id', role: 'school_admin', is_active: true, school_id: '11111111-1111-4111-8111-111111111111' }), { status: 200 });
    if (url.includes('/rest/v1/schools')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', status: 'active', name: 'Ecole A' }), { status: 200 });
    if (url.includes('/rpc/find_auth_user_by_email')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }), { status: 200 });
    if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ user: { id: 'full-e2e-user-id' } }), { status: 200 });
    if (url.includes('/rpc/prepare_parent_invitee_identity')) return new Response(JSON.stringify([{ profile_id: 'full-e2e-user-id', school_id: '11111111-1111-4111-8111-111111111111', profile_created: true, parent_account_created: true }]), { status: 200 });
    if (url.includes('/rpc/create_parent_membership_invitation')) return new Response(JSON.stringify([{ invitation_id: 'inv-full-e2e-123', school_id: '11111111-1111-4111-8111-111111111111' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  try {
    const req = createMockRequest({
      body: { first_name: 'Daniel', last_name: 'Kabila', email: 'daniel.kabila@test.com', student_ids: ['11111111-1111-4111-8111-111111111111'] }
    });
    const res = await inviteSchoolParentHandler(req);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.code, 'INVITATION_SENT');
    assertEquals(json.message, 'Invitation transmise avec succès au responsable.');
  } finally {
    restore();
  }
});
