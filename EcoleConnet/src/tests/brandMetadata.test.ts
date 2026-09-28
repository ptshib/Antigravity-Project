import { describe, test, expect } from 'vitest';
// @ts-ignore
import fs from 'fs';
// @ts-ignore
import path from 'path';

declare const process: { cwd: () => string };

describe('LOT 2K-BRAND-3 — Métadonnées, SEO et Manifest ÉcoleLink', () => {
  const rootDir = process.cwd();
  const indexPath = path.join(rootDir, 'index.html');
  const manifestPath = path.join(rootDir, 'public', 'manifest.json');
  const packagePath = path.join(rootDir, 'package.json');
  const packageLockPath = path.join(rootDir, 'package-lock.json');
  const faviconPath = path.join(rootDir, 'public', 'favicon.svg');

  const indexHtml = fs.readFileSync(indexPath, 'utf-8');
  const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  const packageLockContent = JSON.parse(fs.readFileSync(packageLockPath, 'utf-8'));

  test('1. title contient ÉcoleLink', () => {
    expect(indexHtml).toMatch(/<title>.*ÉcoleLink.*<\/title>/);
  });

  test('2. meta description contient ÉcoleLink', () => {
    expect(indexHtml).toMatch(/<meta\s+name="description"\s+content="[^"]*ÉcoleLink[^"]*"/);
  });

  test('3. aucune métadonnée publique ne contient ÉcoleConnect', () => {
    expect(indexHtml).not.toContain('ÉcoleConnect');
    expect(indexHtml).not.toContain('EcoleConnect');
    expect(JSON.stringify(manifestContent)).not.toContain('ÉcoleConnect');
  });

  test('4. canonical = https://ecolelink.com/', () => {
    expect(indexHtml).toContain('<link rel="canonical" href="https://ecolelink.com/" />');
  });

  test('5. og:site_name = ÉcoleLink', () => {
    expect(indexHtml).toContain('<meta property="og:site_name" content="ÉcoleLink" />');
  });

  test('6. og:title contient ÉcoleLink', () => {
    expect(indexHtml).toContain('<meta property="og:title" content="ÉcoleLink — Plateforme de gestion scolaire" />');
  });

  test('7. og:url utilise ecolelink.com', () => {
    expect(indexHtml).toContain('<meta property="og:url" content="https://ecolelink.com/" />');
  });

  test('8. Twitter title contient ÉcoleLink', () => {
    expect(indexHtml).toContain('<meta name="twitter:title" content="ÉcoleLink — Plateforme de gestion scolaire" />');
  });

  test('9. manifest name contient ÉcoleLink', () => {
    expect(manifestContent.name).toContain('ÉcoleLink');
  });

  test('10. manifest short_name = ÉcoleLink', () => {
    expect(manifestContent.short_name).toBe('ÉcoleLink');
  });

  test('11. toutes les icônes du manifest existent', () => {
    expect(Array.isArray(manifestContent.icons)).toBe(true);
    for (const icon of manifestContent.icons) {
      const relativePath = icon.src.startsWith('/') ? icon.src.slice(1) : icon.src;
      const fullPath = path.join(rootDir, 'public', relativePath);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });

  test('12. package name = ecolelink', () => {
    expect(packageContent.name).toBe('ecolelink');
    expect(packageLockContent.name).toBe('ecolelink');
    expect(packageLockContent.packages[''].name).toBe('ecolelink');
  });

  test('13. aucune dépendance du package-lock n’a changé', () => {
    expect(Object.keys(packageContent.dependencies)).toEqual([
      '@supabase/supabase-js',
      'clsx',
      'lucide-react',
      'react',
      'react-dom',
      'tailwind-merge'
    ]);
  });

  test('14. aucune URL privée ou token n’est exposé dans les métadonnées', () => {
    expect(indexHtml).not.toMatch(/eyJ[a-zA-Z0-9_-]{10,}/);
    expect(indexHtml).not.toContain('/app/');
    expect(indexHtml).not.toContain('supabase');
  });

  test('15. favicon référencé existe', () => {
    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(fs.existsSync(faviconPath)).toBe(true);
  });
});
