// supabase/functions/_shared/document-utils.ts

export async function calculateSha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface MagicValidationResult {
  isValid: boolean;
  detectedMime: string | null;
  normalizedExt: string | null;
  error?: string;
}

export function validateMagicBytes(bytes: Uint8Array, fileName: string, declaredMime: string): MagicValidationResult {
  if (!bytes || bytes.length === 0) {
    return { isValid: false, detectedMime: null, normalizedExt: null, error: 'Fichier vide ou corrompu.' };
  }

  const lowerName = fileName.toLowerCase().trim();
  const parts = lowerName.split('.').filter(Boolean);
  if (parts.length < 2) {
    return { isValid: false, detectedMime: null, normalizedExt: null, error: 'Nom de fichier sans extension.' };
  }

  const ext = parts[parts.length - 1];
  const secondExt = parts.length > 2 ? parts[parts.length - 2] : null;
  const dangerousExts = ['html', 'htm', 'svg', 'js', 'exe', 'bat', 'cmd', 'sh', 'php', 'py', 'pl', 'cgi', 'dll', 'vbs', 'jar'];

  if (dangerousExts.includes(ext) || (secondExt && dangerousExts.includes(secondExt))) {
    return { isValid: false, detectedMime: null, normalizedExt: null, error: 'Extension de fichier dangereuse ou double extension interdite.' };
  }

  // 1. PDF : Signature %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2D) {
    if (ext !== 'pdf' || declaredMime !== 'application/pdf') {
      return { isValid: false, detectedMime: 'application/pdf', normalizedExt: 'pdf', error: 'Incohérence entre signature PDF et extension/MIME déclaré.' };
    }
    return { isValid: true, detectedMime: 'application/pdf', normalizedExt: 'pdf' };
  }

  // 2. PNG : Signature 89 50 4E 47 0D 0A 1A 0A
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
    if (ext !== 'png' || declaredMime !== 'image/png') {
      return { isValid: false, detectedMime: 'image/png', normalizedExt: 'png', error: 'Incohérence entre signature PNG et extension/MIME déclaré.' };
    }
    return { isValid: true, detectedMime: 'image/png', normalizedExt: 'png' };
  }

  // 3. JPEG : Signature FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    if ((ext !== 'jpg' && ext !== 'jpeg') || declaredMime !== 'image/jpeg') {
      return { isValid: false, detectedMime: 'image/jpeg', normalizedExt: 'jpg', error: 'Incohérence entre signature JPEG et extension/MIME déclaré.' };
    }
    return { isValid: true, detectedMime: 'image/jpeg', normalizedExt: ext === 'jpeg' ? 'jpeg' : 'jpg' };
  }

  return { isValid: false, detectedMime: null, normalizedExt: null, error: 'Signature magique de fichier non reconnue ou format interdit (seuls PDF, PNG, JPEG sont acceptés).' };
}

export function checkForForbiddenTextContent(bytes: Uint8Array): boolean {
  const snippetLength = Math.min(bytes.length, 512);
  const snippet = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, snippetLength)).toLowerCase();
  if (snippet.includes('<svg') || snippet.includes('<html') || snippet.includes('<!doctype') || snippet.includes('<script') || snippet.includes('javascript:')) {
    return true;
  }
  return false;
}
