import { supabase } from '../lib/supabase';

export interface AcceptInvitationResult {
  success: boolean;
  school_id: string;
  school_name: string;
  students_linked: number;
}

export type InvitationErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'INVALID_TOKEN'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_ALREADY_ACCEPTED'
  | 'INVITATION_REVOKED'
  | 'WRONG_ACCOUNT'
  | 'SCHOOL_INACTIVE'
  | 'MEMBERSHIP_SUSPENDED'
  | 'MEMBERSHIP_LEFT'
  | 'STUDENT_NOT_IN_SCHOOL'
  | 'ACCOUNT_NOT_PARENT_COMPATIBLE'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export class InvitationError extends Error {
  code: InvitationErrorCode;
  constructor(code: InvitationErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'InvitationError';
  }
}

export interface InvitationEnvelope {
  version: 1;
  flow: 'parent_multi_school_invitation';
  token: string;
  captured_at: string; // ISO String
  account_switch_pending?: boolean;
}

export const INVITATION_ENVELOPE_KEY = 'parent_invitation_envelope_v1';
export const LEGACY_TOKEN_KEY = 'parent_invitation_token';
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const schoolInvitationService = {
  /**
   * Sauvegarde de manière sécurisée et typée l'enveloppe d'invitation dans sessionStorage.
   * Nettoie toute ancienne clé legacy ou malformée.
   */
  saveInvitationToken(token: string, isAccountSwitch = false): boolean {
    if (!token || typeof token !== 'string') return false;
    const cleanToken = token.trim();
    if (cleanToken.length < 10 || cleanToken.length > 500) return false;

    // Purge de l'ancienne clé string directe si présente
    try {
      sessionStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(INVITATION_ENVELOPE_KEY);
    } catch (_e) {
      // Ignorer
    }

    const envelope: InvitationEnvelope = {
      version: 1,
      flow: 'parent_multi_school_invitation',
      token: cleanToken,
      captured_at: new Date().toISOString(),
      account_switch_pending: isAccountSwitch
    };

    try {
      sessionStorage.setItem(INVITATION_ENVELOPE_KEY, JSON.stringify(envelope));
      return true;
    } catch (_e) {
      return false;
    }
  },

  /**
   * Récupère l'enveloppe d'invitation si elle est valide, versionnée et non expirée (TTL).
   */
  getValidInvitationEnvelope(maxAgeMs: number = DEFAULT_TTL_MS): InvitationEnvelope | null {
    try {
      // Supprimer systématiquement tout token présent dans localStorage
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(INVITATION_ENVELOPE_KEY);

      const rawData = sessionStorage.getItem(INVITATION_ENVELOPE_KEY);
      if (!rawData) return null;

      const envelope: InvitationEnvelope = JSON.parse(rawData);

      // Contrôle de version et de flow
      if (
        !envelope ||
        envelope.version !== 1 ||
        envelope.flow !== 'parent_multi_school_invitation' ||
        !envelope.token ||
        typeof envelope.token !== 'string' ||
        !envelope.captured_at
      ) {
        this.clearInvitationEnvelope();
        return null;
      }

      // Contrôle de longueur du jeton
      if (envelope.token.trim().length < 10 || envelope.token.trim().length > 500) {
        this.clearInvitationEnvelope();
        return null;
      }

      // Contrôle de la durée de vie (TTL)
      const capturedTime = new Date(envelope.captured_at).getTime();
      const now = Date.now();
      if (isNaN(capturedTime) || now - capturedTime > maxAgeMs) {
        this.clearInvitationEnvelope();
        return null;
      }

      return envelope;
    } catch (_e) {
      this.clearInvitationEnvelope();
      return null;
    }
  },

  /**
   * Extrait le jeton valide depuis l'enveloppe (ou retourne null si invalide/expiré).
   */
  getValidInvitationToken(maxAgeMs: number = DEFAULT_TTL_MS): string | null {
    const envelope = this.getValidInvitationEnvelope(maxAgeMs);
    return envelope ? envelope.token : null;
  },

  /**
   * Active le marqueur temporaire de changement de compte (ex: suite à WRONG_ACCOUNT).
   */
  markAccountSwitchPending(): void {
    const envelope = this.getValidInvitationEnvelope();
    if (envelope) {
      envelope.account_switch_pending = true;
      try {
        sessionStorage.setItem(INVITATION_ENVELOPE_KEY, JSON.stringify(envelope));
      } catch (_e) {
        // Ignorer
      }
    }
  },

  /**
   * Purge complète et propre de l'invitation dans sessionStorage et localStorage.
   */
  clearInvitationEnvelope(): void {
    try {
      sessionStorage.removeItem(INVITATION_ENVELOPE_KEY);
      sessionStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(INVITATION_ENVELOPE_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch (_e) {
      // Ignorer
    }
  },

  /**
   * Nettoie et valide les URLs returnTo pour éviter toute redirection ouverte (Open Redirect).
   * Applique une liste strictement fermée de routes autorisées et normalise le chemin.
   */
  sanitizeReturnTo(targetUrl: string | null | undefined): string {
    const DEFAULT_PATH = '/auth/accept-school-invitation';
    const AUTHORIZED_ROUTES = new Set([
      '/auth/accept-school-invitation',
      '/auth/set-password',
      '/connexion',
      '/app/parent'
    ]);

    if (!targetUrl || typeof targetUrl !== 'string') return DEFAULT_PATH;

    const trimmed = targetUrl.trim();
    if (!trimmed) return DEFAULT_PATH;

    // Décodage du composant pour détecter les encodages malveillants (%2F%2F, %5C)
    let decoded = trimmed;
    try {
      decoded = decodeURIComponent(trimmed);
    } catch (_e) {
      return DEFAULT_PATH;
    }

    const lowerDecoded = decoded.toLowerCase();

    // Refuser les URLs absolues, slashes doubles //, backslashes \, et schémas dangereux
    if (
      lowerDecoded.includes('://') ||
      lowerDecoded.includes('//') ||
      lowerDecoded.includes('\\') ||
      lowerDecoded.includes('javascript:') ||
      lowerDecoded.includes('data:') ||
      lowerDecoded.includes('vbscript:')
    ) {
      return DEFAULT_PATH;
    }

    // Extraction du chemin pur (sans querystring ni fragment hash)
    const rawPath = decoded.split('?')[0].split('#')[0];

    // Normalisation des répertoires relatifs (ex: /connexion/../../evil -> /evil)
    const segments = rawPath.split('/').filter(Boolean);
    const resolvedSegments: string[] = [];
    for (const seg of segments) {
      if (seg === '..') {
        resolvedSegments.pop();
      } else if (seg !== '.') {
        resolvedSegments.push(seg);
      }
    }
    const normalizedPathname = '/' + resolvedSegments.join('/');

    // Vérification stricte du pathname par rapport à la liste fermée de routes autorisées
    if (!AUTHORIZED_ROUTES.has(normalizedPathname)) {
      return DEFAULT_PATH;
    }

    // Filtrage et sanitisation de la querystring pour éliminer tout jeton sensible
    let safeQuery = '';
    if (trimmed.includes('?')) {
      const rawQuery = trimmed.slice(trimmed.indexOf('?')).split('#')[0];
      const searchParams = new URLSearchParams(rawQuery);
      searchParams.delete('token');
      searchParams.delete('access_token');
      searchParams.delete('refresh_token');
      searchParams.delete('code');
      searchParams.delete('hash');
      searchParams.delete('p_token');

      // Si returnTo est présent dans les query params, le sanitiser récursivement
      const innerReturnTo = searchParams.get('returnTo');
      if (innerReturnTo) {
        searchParams.set('returnTo', this.sanitizeReturnTo(innerReturnTo));
      }

      const queryString = searchParams.toString();
      if (queryString) {
        safeQuery = '?' + queryString;
      }
    }

    return normalizedPathname + safeQuery;
  },

  /**
   * Transmet le jeton d'invitation brut à la RPC PostgreSQL sécurisée accept_parent_school_invitation.
   * Ne journalise jamais le jeton brut. Ne transmet aucun identifiant sensible supplémentaire.
   */
  async acceptParentSchoolInvitation(token: string): Promise<AcceptInvitationResult> {
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new InvitationError('INVALID_TOKEN', 'Le jeton d’invitation est invalide ou manquant.');
    }

    const cleanToken = token.trim();
    if (cleanToken.length < 10 || cleanToken.length > 500) {
      throw new InvitationError('INVALID_TOKEN', 'Le jeton d’invitation possède un format invalide.');
    }

    const { data, error } = await supabase.rpc('accept_parent_school_invitation', {
      p_token: cleanToken
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('authentification requise')) {
        throw new InvitationError('NOT_AUTHENTICATED', 'Vous devez être connecté pour accepter l’invitation.');
      }
      if (msg.includes('ne correspond pas') || msg.includes('réservé à un autre compte')) {
        throw new InvitationError('WRONG_ACCOUNT', 'Cette invitation est destinée à un autre compte. Déconnectez-vous puis connectez-vous avec l’adresse ayant reçu l’invitation.');
      }
      if (msg.includes('déjà été acceptée')) {
        throw new InvitationError('INVITATION_ALREADY_ACCEPTED', 'Cette invitation a déjà été acceptée.');
      }
      if (msg.includes('révoquée')) {
        throw new InvitationError('INVITATION_REVOKED', 'Cette invitation a été révoquée par l’établissement.');
      }
      if (msg.includes('expiré')) {
        throw new InvitationError('INVITATION_EXPIRED', 'L’invitation a expiré. Veuillez contacter l’établissement pour en obtenir une nouvelle.');
      }
      if (msg.includes('inactif ou suspendu')) {
        throw new InvitationError('SCHOOL_INACTIVE', 'L’établissement scolaire est inactif ou suspendu.');
      }
      if (msg.includes('appartenance parent') && msg.includes('suspended')) {
        throw new InvitationError('MEMBERSHIP_SUSPENDED', 'Votre appartenance parent dans cet établissement a été suspendue.');
      }
      if (msg.includes('appartenance parent') && msg.includes('left')) {
        throw new InvitationError('MEMBERSHIP_LEFT', 'Vous avez quitté cet établissement.');
      }
      if (msg.includes('n’appartient plus à cet établissement')) {
        throw new InvitationError('STUDENT_NOT_IN_SCHOOL', 'L’élève rattaché n’appartient plus à cet établissement.');
      }
      if (msg.includes('existing_account_not_parent_compatible')) {
        throw new InvitationError('ACCOUNT_NOT_PARENT_COMPATIBLE', 'Ce compte ne peut pas recevoir un accès Parent direct.');
      }
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('connection') || msg.includes('failed to fetch')) {
        throw new InvitationError('NETWORK_ERROR', 'Erreur de connexion réseau. Veuillez vérifier votre connexion et réessayer.');
      }
      throw new InvitationError('UNKNOWN_ERROR', error.message || 'Une erreur est survenue lors de l’acceptation de l’invitation.');
    }

    if (!data) {
      throw new InvitationError('UNKNOWN_ERROR', 'Le serveur a renvoyé une réponse vide.');
    }

    return data as AcceptInvitationResult;
  }
};
