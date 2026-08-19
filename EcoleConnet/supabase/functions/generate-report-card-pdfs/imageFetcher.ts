// Module de téléchargement des ressources visuelles officielles avec allowlist stricte
// Fichier : supabase/functions/generate-report-card-pdfs/imageFetcher.ts

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 Mo maximum par image
const ALLOWED_STORAGE_BUCKET = 'school-official-assets';

export class SafeImageFetcher {
  private cache = new Map<string, Uint8Array | null>();
  private serviceClient: SupabaseClient;
  private allowedHost: string;

  constructor(serviceClient: SupabaseClient, supabaseUrl: string) {
    this.serviceClient = serviceClient;
    try {
      this.allowedHost = new URL(supabaseUrl).hostname.toLowerCase();
    } catch (_) {
      this.allowedHost = '';
    }
  }

  /**
   * Télécharge et valide une image officielle (Allowlist stricte du domaine Supabase et du bucket officiel)
   */
  async fetchImage(rawUrlOrPath: string | null | undefined): Promise<Uint8Array | null> {
    if (!rawUrlOrPath || typeof rawUrlOrPath !== 'string') {
      return null;
    }

    const trimmed = rawUrlOrPath.trim();
    if (trimmed.length === 0) {
      return null;
    }

    if (this.cache.has(trimmed)) {
      return this.cache.get(trimmed) ?? null;
    }

    try {
      let imageBuffer: Uint8Array | null = null;

      // 1. Cas d'un chemin interne Storage Supabase
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        imageBuffer = await this.fetchFromInternalStorage(trimmed);
      } else {
        // 2. Cas d'une URL HTTPS (Vérification de l'allowlist exacte du domaine Supabase)
        imageBuffer = await this.fetchFromAllowedHttpsUrl(trimmed);
      }

      if (imageBuffer && this.isValidImage(imageBuffer)) {
        this.cache.set(trimmed, imageBuffer);
        return imageBuffer;
      } else {
        this.cache.set(trimmed, null);
        return null;
      }
    } catch (_err) {
      this.cache.set(trimmed, null);
      return null;
    }
  }

  /**
   * Télécharge directement depuis le bucket privé 'school-official-assets' via service_role
   */
  private async fetchFromInternalStorage(path: string): Promise<Uint8Array | null> {
    let cleanPath = path;
    if (path.startsWith(`${ALLOWED_STORAGE_BUCKET}/`)) {
      cleanPath = path.slice(ALLOWED_STORAGE_BUCKET.length + 1);
    }

    // Protection anti-traversée de répertoire
    if (cleanPath.includes('..') || cleanPath.startsWith('/') || cleanPath.includes('//')) {
      return null;
    }

    const { data, error } = await this.serviceClient.storage
      .from(ALLOWED_STORAGE_BUCKET)
      .download(cleanPath);

    if (error || !data) {
      return null;
    }

    const arrayBuffer = await data.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_SIZE_BYTES || arrayBuffer.byteLength === 0) {
      return null;
    }

    return new Uint8Array(arrayBuffer);
  }

  /**
   * Valide que l'URL provient EXCLUSIVEMENT du hostname officiel SUPABASE_URL et du bucket autorisé
   */
  private async fetchFromAllowedHttpsUrl(rawUrl: string): Promise<Uint8Array | null> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch (_) {
      return null;
    }

    // A. Rejet absolu de tout protocole non-HTTPS
    if (parsedUrl.protocol !== 'https:') {
      return null;
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // B. Rejet absolu de tout domaine tiers externe : Seul le hostname exact de SUPABASE_URL est autorisé
    if (!this.allowedHost || hostname !== this.allowedHost) {
      return null;
    }

    // C. Extraction et validation stricte du chemin Storage et du bucket
    const match = parsedUrl.pathname.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/?#]+)\/([^?#]+)/);
    if (!match || match[1] !== ALLOWED_STORAGE_BUCKET || !match[2]) {
      return null;
    }

    const objectPath = decodeURIComponent(match[2]);
    return await this.fetchFromInternalStorage(objectPath);
  }

  /**
   * Vérifie la signature binaire (Magic Bytes) pour PNG et JPEG exclusivement
   */
  private isValidImage(bytes: Uint8Array): boolean {
    if (bytes.length < 8) return false;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const isPng =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4E &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0D &&
      bytes[5] === 0x0A &&
      bytes[6] === 0x1A &&
      bytes[7] === 0x0A;

    // JPEG: FF D8 FF
    const isJpg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;

    return isPng || isJpg;
  }
}
