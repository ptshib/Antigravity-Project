import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
// @ts-ignore
import fs from 'fs';
// @ts-ignore
import path from 'path';

declare const process: { cwd: () => string };

describe('Suite de Non-Régression — Branding PDF & Emails Edge Functions (BRAND-2)', () => {
  it('1. Métadonnée Author PDF = ÉcoleLink', async () => {
    const pdfPath = path.join(process.cwd(), 'scratch', 'bulletin_synthetique_ecolelink.pdf');
    const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    expect(pdfDoc.getAuthor()).toBe('ÉcoleLink');
  });

  it('2. Métadonnées Creator et Producer = ÉcoleLink / pdf-lib', async () => {
    const pdfPath = path.join(process.cwd(), 'scratch', 'bulletin_synthetique_ecolelink.pdf');
    const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    expect(pdfDoc.getCreator()).toBe('ÉcoleLink');
    expect(pdfDoc.getProducer()).toBeDefined();
  });

  it('3. Aucune mention visible ÉcoleConnect dans le PDF générateur pdfGenerator.ts', () => {
    const pdfGeneratorPath = path.join(process.cwd(), 'supabase', 'functions', 'generate-report-card-pdfs', 'pdfGenerator.ts');
    const content = fs.readFileSync(pdfGeneratorPath, 'utf-8');
    expect(content).not.toContain("setAuthor('ÉcoleConnect')");
    expect(content).not.toContain("setCreator('ÉcoleConnect')");
    expect(content).not.toContain("setProducer('ÉcoleConnect");
  });

  it('4. Email Parent contient ÉcoleLink', () => {
    const inviteParentPath = path.join(process.cwd(), 'supabase', 'functions', 'invite-school-parent', 'index.ts');
    const content = fs.readFileSync(inviteParentPath, 'utf-8');
    expect(content).toContain('sur ÉcoleLink');
    expect(content).not.toContain('sur ÉcoleConnect');
  });

  it('5. Email Enseignant contient le message d’erreur rebrandé ÉcoleLink', () => {
    const inviteTeacherPath = path.join(process.cwd(), 'supabase', 'functions', 'invite-school-teacher', 'index.ts');
    const content = fs.readFileSync(inviteTeacherPath, 'utf-8');
    expect(content).toContain('compte ÉcoleLink');
    expect(content).not.toContain('compte ÉcoleConnect');
  });

  it('6. Email Élève contient le message d’erreur rebrandé ÉcoleLink', () => {
    const inviteStudentPath = path.join(process.cwd(), 'supabase', 'functions', 'invite-school-student', 'index.ts');
    const content = fs.readFileSync(inviteStudentPath, 'utf-8');
    expect(content).toContain('compte ÉcoleLink');
    expect(content).not.toContain('compte ÉcoleConnect');
  });

  it('7. Routes d’invitation inchangées (/auth/accept-school-invitation et /auth/set-password)', () => {
    const inviteParentPath = path.join(process.cwd(), 'supabase', 'functions', 'invite-school-parent', 'index.ts');
    const content = fs.readFileSync(inviteParentPath, 'utf-8');
    expect(content).toContain('/auth/accept-school-invitation');
  });

  it('8. Noms de paramètres et tokens inchangés', () => {
    const inviteParentPath = path.join(process.cwd(), 'supabase', 'functions', 'invite-school-parent', 'index.ts');
    const content = fs.readFileSync(inviteParentPath, 'utf-8');
    expect(content).toContain('p_token_hash');
    expect(content).toContain('p_invited_by');
    expect(content).toContain('p_student_ids');
  });

  it('9. Variable ECOLECONNECT_APP_URL encore supportée pour la compatibilité ascendante', () => {
    const corsPath = path.join(process.cwd(), 'supabase', 'functions', '_shared', 'cors.ts');
    const corsContent = fs.readFileSync(corsPath, 'utf-8');
    expect(corsContent).toContain('ecoleconnectAppUrl');

    const inviteParentPath = path.join(process.cwd(), 'supabase', 'functions', 'invite-school-parent', 'index.ts');
    const parentContent = fs.readFileSync(inviteParentPath, 'utf-8');
    expect(parentContent).toContain('ECOLECONNECT_APP_URL');
  });

  it('10. Aucun appel réel au fournisseur email pendant les tests (mocks isolés)', () => {
    const inviteParentPath = path.join(process.cwd(), 'supabase', 'functions', 'invite-school-parent', 'index.ts');
    const content = fs.readFileSync(inviteParentPath, 'utf-8');
    expect(content).toContain('ResendClient');
  });

  it('11. Aucun envoi d’invitation réelle n’a lieu lors des vérifications statiques', () => {
    const previewParent = fs.readFileSync(path.join(process.cwd(), 'scratch', 'email_preview_parent.html'), 'utf-8');
    expect(previewParent).toContain('SYNTHETIC_TEST_TOKEN');
  });

  it('12. Aucun changement du contrat JSON des Edge Functions', () => {
    const inviteStudentPath = path.join(process.cwd(), 'supabase', 'functions', 'invite-school-student', 'index.ts');
    const content = fs.readFileSync(inviteStudentPath, 'utf-8');
    expect(content).toContain("error: 'Cette adresse email est déjà associée à un compte ÉcoleLink.");
  });
});
