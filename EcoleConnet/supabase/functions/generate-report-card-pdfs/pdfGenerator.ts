// Moteur de génération des bulletins scolaires PDF officiels (Format RDC)
// Fichier : supabase/functions/generate-report-card-pdfs/pdfGenerator.ts

import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, PDFImage } from 'https://esm.sh/pdf-lib@1.17.1';
import {
  PeriodReportCardRecord,
  ReportCardSubjectResultRecord,
  LoadedImages,
  ReportCardBatchRecord
} from './types.ts';

// Couleurs de la charte officielle
const COLOR_NAVY = rgb(0.08, 0.18, 0.36); // #142E5C
const COLOR_DARK = rgb(0.12, 0.14, 0.17); // #1F242B
const COLOR_MUTED = rgb(0.45, 0.50, 0.58); // #738094
const COLOR_BORDER = rgb(0.82, 0.85, 0.89); // #D1D9E3
const COLOR_BG_LIGHT = rgb(0.96, 0.97, 0.98); // #F5F7FA
const COLOR_WARN_BG = rgb(0.99, 0.95, 0.90); // #FDF2E6
const COLOR_WARN_TEXT = rgb(0.72, 0.35, 0.05); // #B8590D
const COLOR_SUCCESS = rgb(0.10, 0.55, 0.30); // #1A8C4D

/**
 * Normalise les chaînes de caractères pour compatibilité WinAnsi standard de pdf-lib
 */
export function sanitizeText(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, '');
}

/**
 * Tronque un texte selon la largeur réelle de la police pour éviter tout débordement
 */
export function truncateText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string {
  const sanitized = sanitizeText(text);
  if (font.widthOfTextAtSize(sanitized, fontSize) <= maxWidth) {
    return sanitized;
  }

  let low = 0;
  let high = sanitized.length;
  let result = sanitized;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = sanitized.slice(0, mid) + '...';
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      result = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

/**
 * Découpe un texte en plusieurs lignes selon la largeur réelle autorisée
 */
export function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const words = sanitizeText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${currentLine} ${words[i]}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }
  lines.push(currentLine);

  return lines;
}

/**
 * Convertit une date ISO validée en Date sans jamais consulter l'horloge système.
 * La validation administrative est l'ancre temporelle immuable du PDF officiel.
 */
export function getStableValidatedDate(batch: ReportCardBatchRecord): Date {
  if (!batch.validated_at) {
    throw new Error('MISSING_VALIDATED_AT: La date de validation administrative est obligatoire.');
  }

  const stableDate = new Date(batch.validated_at);
  if (Number.isNaN(stableDate.getTime())) {
    throw new Error('INVALID_VALIDATED_AT: La date de validation administrative est invalide.');
  }

  return stableDate;
}

/** Format français déterministe, indépendant de la locale et du fuseau du runtime. */
export function formatDateFrUtc(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

/** Ordre canonique total des matières, même en cas de positions identiques. */
export function sortSubjectsDeterministically(
  subjects: ReportCardSubjectResultRecord[]
): ReportCardSubjectResultRecord[] {
  const compareAscii = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  return [...subjects].sort((a, b) =>
    (a.display_position - b.display_position) ||
    compareAscii(a.subject_id, b.subject_id) ||
    compareAscii(a.id, b.id)
  );
}

export class ReportCardPdfGenerator {
  /**
   * Génère le fichier PDF officiel d'un bulletin scolaire
   */
  static async generate(
    batch: ReportCardBatchRecord,
    reportCard: PeriodReportCardRecord,
    subjects: ReportCardSubjectResultRecord[],
    images: LoadedImages
  ): Promise<Uint8Array> {
    // 1. Validation stricte des ressources obligatoires (Signatures & Cachet)
    if (!images.directorSignature || images.directorSignature.byteLength === 0) {
      throw new Error('MANDATORY_ASSET_MISSING: Signature de la direction manquante ou inaccessible.');
    }
    if (!images.stamp || images.stamp.byteLength === 0) {
      throw new Error('MANDATORY_ASSET_MISSING: Cachet officiel de l’établissement manquant ou inaccessible.');
    }
    if (!images.homeroomSignature || images.homeroomSignature.byteLength === 0) {
      throw new Error('MANDATORY_ASSET_MISSING: Signature du professeur titulaire manquante ou inaccessible.');
    }

    const stableValidatedDate = getStableValidatedDate(batch);
    const pdfDoc = await PDFDocument.create({ updateMetadata: false });

    // Métadonnées explicitement stables : pdf-lib ne doit jamais injecter l'heure courante.
    pdfDoc.setTitle(`Bulletin scolaire officiel - ${reportCard.id}`);
    pdfDoc.setAuthor('ÉcoleConnect');
    pdfDoc.setSubject(`Bulletin ${reportCard.id} - révision ${batch.revision_number}`);
    pdfDoc.setCreator('ÉcoleConnect');
    pdfDoc.setProducer('ÉcoleConnect PDF Generator');
    pdfDoc.setCreationDate(stableValidatedDate);
    pdfDoc.setModificationDate(stableValidatedDate);

    // Polices standard
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // 2. Embarquement des images vérifiées
    let logoImg: PDFImage | null = null;
    let dirSigImg: PDFImage | null = null;
    let stampImg: PDFImage | null = null;
    let hrSigImg: PDFImage | null = null;

    if (images.logo && images.logo.byteLength > 0) {
      try {
        logoImg = await this.embedImageSafely(pdfDoc, images.logo);
      } catch (_) {
        logoImg = null; // Logo facultatif
      }
    }

    try {
      dirSigImg = await this.embedImageSafely(pdfDoc, images.directorSignature);
      stampImg = await this.embedImageSafely(pdfDoc, images.stamp);
      hrSigImg = await this.embedImageSafely(pdfDoc, images.homeroomSignature);
    } catch (imgErr: any) {
      throw new Error(`MANDATORY_ASSET_CORRUPTED: Impossible d’embarquer une ressource visuelle obligatoire : ${imgErr?.message}`);
    }

    const identity = reportCard.identity_snapshot || {};
    const signatureSnap = reportCard.signature_snapshot || {};

    // Dimensions A4 : 595.28 x 841.89
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 28;
    const contentWidth = pageWidth - (margin * 2);

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let currentY = pageHeight - margin;

    // --- 1. EN-TÊTE OFFICIEL ---
    currentY = this.drawHeader(page, currentY, margin, contentWidth, identity, logoImg, fontRegular, fontBold);

    // --- 2. BANDEAU IDENTIFICATION ÉLÈVE & PÉRIODE ---
    currentY = this.drawStudentInfoCard(page, currentY, margin, contentWidth, identity, reportCard, fontRegular, fontBold);

    // --- 3. TABLEAU DES RÉSULTATS PAR MATIÈRE (Sans calculs arbitraires) ---
    currentY = this.drawSubjectsTable(
      pdfDoc,
      page,
      currentY,
      margin,
      contentWidth,
      sortSubjectsDeterministically(subjects),
      reportCard,
      fontRegular,
      fontBold,
      pageHeight
    );

    // Re-sélectionner la dernière page active
    const pages = pdfDoc.getPages();
    let lastPage = pages[pages.length - 1];

    // Vérifier l'espace restant pour le bilan et les signatures (~170 pt requis)
    if (currentY < 180) {
      lastPage = pdfDoc.addPage([pageWidth, pageHeight]);
      currentY = pageHeight - margin - 20;
    }

    // --- 4. BILAN GÉNÉRAL ET RANG ---
    currentY = this.drawPerformanceSummary(lastPage, currentY, margin, contentWidth, reportCard, fontRegular, fontBold, fontOblique);

    // --- 5. APPRÉCIATIONS & CONDUITE (Sans valeurs inventées) ---
    currentY = this.drawRemarksSection(lastPage, currentY, margin, contentWidth, reportCard, fontRegular, fontBold, fontOblique);

    // --- 6. SIGNATURES OFFICIELLES & CACHET ---
    this.drawSignaturesSection(
      lastPage,
      currentY,
      margin,
      contentWidth,
      identity,
      signatureSnap,
      batch,
      dirSigImg,
      stampImg,
      hrSigImg,
      fontRegular,
      fontBold
    );

    // --- 7. PIED DE PAGE & NUMÉROTATION SUR TOUTES LES PAGES ---
    const totalPagesCount = pdfDoc.getPageCount();
    for (let i = 0; i < totalPagesCount; i++) {
      this.drawFooter(pdfDoc.getPage(i), margin, contentWidth, i + 1, totalPagesCount, reportCard, batch, fontRegular);
    }

    return await pdfDoc.save();
  }

  private static async embedImageSafely(pdfDoc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      return await pdfDoc.embedPng(bytes);
    }
    return await pdfDoc.embedJpg(bytes);
  }

  private static drawHeader(
    page: PDFPage,
    startY: number,
    margin: number,
    width: number,
    identity: any,
    logoImg: PDFImage | null,
    fontReg: PDFFont,
    fontBold: PDFFont
  ): number {
    let y = startY;

    const nationalTitle = "RÉPUBLIQUE DÉMOCRATIQUE DU CONGO";
    const ministryTitle = "MINISTÈRE DE L'ÉDUCATION NATIONALE ET NOUVELLE CITOYENNETÉ";

    page.drawText(nationalTitle, {
      x: margin + (width - fontBold.widthOfTextAtSize(nationalTitle, 8.5)) / 2,
      y,
      size: 8.5,
      font: fontBold,
      color: COLOR_NAVY
    });
    y -= 11;

    page.drawText(ministryTitle, {
      x: margin + (width - fontReg.widthOfTextAtSize(ministryTitle, 7.5)) / 2,
      y,
      size: 7.5,
      font: fontReg,
      color: COLOR_MUTED
    });
    y -= 14;

    page.drawLine({
      start: { x: margin + 40, y },
      end: { x: margin + width - 40, y },
      thickness: 0.6,
      color: COLOR_BORDER
    });
    y -= 10;

    const logoSize = 42;
    if (logoImg) {
      page.drawImage(logoImg, {
        x: margin + 4,
        y: y - logoSize + 8,
        width: logoSize,
        height: logoSize
      });
    }

    const textLeftOffset = logoImg ? margin + logoSize + 12 : margin;
    const textAvailableWidth = logoImg ? width - logoSize - 12 : width;

    const rawSchoolName = (identity.school_name || "ÉTABLISSEMENT SCOLAIRE").toUpperCase();
    const schoolName = truncateText(rawSchoolName, textAvailableWidth - 10, fontBold, 12);
    const regNo = identity.official_registration_number
      ? truncateText(`Agrément / N° : ${identity.official_registration_number}`, textAvailableWidth - 10, fontReg, 7.5)
      : "";
    const motto = identity.motto ? truncateText(`« ${identity.motto} »`, textAvailableWidth - 10, fontReg, 7.5) : "";
    const contact = truncateText(
      [identity.school_address, identity.school_phone, identity.school_email].filter(Boolean).join(" • "),
      textAvailableWidth - 10,
      fontReg,
      6.5
    );

    page.drawText(schoolName, {
      x: textLeftOffset + (textAvailableWidth - fontBold.widthOfTextAtSize(schoolName, 12)) / 2,
      y,
      size: 12,
      font: fontBold,
      color: COLOR_NAVY
    });
    y -= 13;

    if (motto) {
      page.drawText(motto, {
        x: textLeftOffset + (textAvailableWidth - fontReg.widthOfTextAtSize(motto, 7.5)) / 2,
        y,
        size: 7.5,
        font: fontReg,
        color: COLOR_MUTED
      });
      y -= 10;
    }

    if (regNo) {
      page.drawText(regNo, {
        x: textLeftOffset + (textAvailableWidth - fontReg.widthOfTextAtSize(regNo, 7.5)) / 2,
        y,
        size: 7.5,
        font: fontReg,
        color: COLOR_DARK
      });
      y -= 10;
    }

    if (contact) {
      page.drawText(contact, {
        x: textLeftOffset + (textAvailableWidth - fontReg.widthOfTextAtSize(contact, 6.5)) / 2,
        y,
        size: 6.5,
        font: fontReg,
        color: COLOR_MUTED
      });
      y -= 10;
    }

    y -= 6;
    return y;
  }

  private static drawStudentInfoCard(
    page: PDFPage,
    startY: number,
    margin: number,
    width: number,
    identity: any,
    reportCard: PeriodReportCardRecord,
    fontReg: PDFFont,
    fontBold: PDFFont
  ): number {
    const cardHeight = 62;
    const cardY = startY - cardHeight;

    page.drawRectangle({
      x: margin,
      y: cardY,
      width,
      height: cardHeight,
      color: COLOR_BG_LIGHT,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8
    });

    const bannerTitle = "BULLETIN SCOLAIRE OFFICIEL";
    page.drawRectangle({
      x: margin,
      y: cardY + cardHeight - 16,
      width,
      height: 16,
      color: COLOR_NAVY
    });

    page.drawText(bannerTitle, {
      x: margin + (width - fontBold.widthOfTextAtSize(bannerTitle, 8.5)) / 2,
      y: cardY + cardHeight - 12,
      size: 8.5,
      font: fontBold,
      color: rgb(1, 1, 1)
    });

    // Colonne 1 : Élève
    const rawStudentName = identity.student_name || "Élève non identifié";
    const studentName = truncateText(rawStudentName, 240, fontBold, 8);
    const studentNumber = truncateText(identity.student_number || "—", 75, fontBold, 7.5);
    const gender = identity.gender === 'M' ? 'Masculin' : identity.gender === 'F' ? 'Féminin' : identity.gender || '—';
    const dob = identity.date_of_birth ? formatDateFrUtc(identity.date_of_birth) : '—';

    const col1X = margin + 10;
    let textY = cardY + cardHeight - 28;

    page.drawText("Élève :", { x: col1X, y: textY, size: 7.5, font: fontReg, color: COLOR_MUTED });
    page.drawText(studentName, { x: col1X + 35, y: textY, size: 8, font: fontBold, color: COLOR_DARK });
    textY -= 12;

    page.drawText("Matricule :", { x: col1X, y: textY, size: 7.5, font: fontReg, color: COLOR_MUTED });
    page.drawText(studentNumber, { x: col1X + 45, y: textY, size: 7.5, font: fontBold, color: COLOR_DARK });

    page.drawText("Sexe :", { x: col1X + 130, y: textY, size: 7.5, font: fontReg, color: COLOR_MUTED });
    page.drawText(gender, { x: col1X + 155, y: textY, size: 7.5, font: fontReg, color: COLOR_DARK });

    page.drawText("Né(e) le :", { x: col1X + 205, y: textY, size: 7.5, font: fontReg, color: COLOR_MUTED });
    page.drawText(dob, { x: col1X + 240, y: textY, size: 7.5, font: fontReg, color: COLOR_DARK });

    // Colonne 2 : Classe & Période
    const className = truncateText(identity.class_name || "—", 90, fontBold, 8);
    const cycle = identity.education_cycle === 'primary' ? 'Primaire' : identity.education_cycle === 'secondary' ? 'Secondaire' : identity.education_cycle || '—';
    const yearName = truncateText(identity.academic_year_name || "—", 50, fontBold, 7.5);
    const periodName = truncateText(identity.period_name || "—", 90, fontBold, 7.5);
    const termName = truncateText(identity.term_name || "—", 90, fontBold, 7.5);

    const col2X = margin + 310;
    textY = cardY + cardHeight - 28;

    page.drawText("Classe :", { x: col2X, y: textY, size: 7.5, font: fontReg, color: COLOR_MUTED });
    page.drawText(`${className} (${cycle})`, { x: col2X + 38, y: textY, size: 8, font: fontBold, color: COLOR_NAVY });

    page.drawText("Année :", { x: col2X + 140, y: textY, size: 7.5, font: fontReg, color: COLOR_MUTED });
    page.drawText(yearName, { x: col2X + 175, y: textY, size: 7.5, font: fontBold, color: COLOR_DARK });
    textY -= 12;

    page.drawText("Période :", { x: col2X, y: textY, size: 7.5, font: fontReg, color: COLOR_MUTED });
    page.drawText(`${periodName} • ${termName}`, { x: col2X + 42, y: textY, size: 7.5, font: fontBold, color: COLOR_DARK });

    return cardY - 10;
  }

  private static drawSubjectsTable(
    pdfDoc: PDFDocument,
    initialPage: PDFPage,
    startY: number,
    margin: number,
    width: number,
    subjects: ReportCardSubjectResultRecord[],
    reportCard: PeriodReportCardRecord,
    fontReg: PDFFont,
    fontBold: PDFFont,
    pageHeight: number
  ): number {
    let currentPage = initialPage;
    let y = startY;

    // Colonnes sans note pondérée recalculée : Total = 539.28
    const cols = [
      { name: "DISCIPLINE / MATIÈRE", width: 225, align: "left" },
      { name: "COEFF.", width: 55, align: "center" },
      { name: "ÉVALUATIONS", width: 75, align: "center" },
      { name: "POURCENTAGE", width: 90, align: "right" },
      { name: "APPRÉCIATION", width: 94.28, align: "left" }
    ];

    const rowHeight = 16;
    const headerHeight = 18;

    const drawTableHeader = (p: PDFPage, currentTopY: number) => {
      p.drawRectangle({
        x: margin,
        y: currentTopY - headerHeight,
        width,
        height: headerHeight,
        color: COLOR_NAVY
      });

      let curX = margin;
      for (const col of cols) {
        let textX = curX + 6;
        if (col.align === "center") {
          textX = curX + (col.width - fontBold.widthOfTextAtSize(col.name, 6.5)) / 2;
        } else if (col.align === "right") {
          textX = curX + col.width - fontBold.widthOfTextAtSize(col.name, 6.5) - 6;
        }
        p.drawText(col.name, {
          x: textX,
          y: currentTopY - headerHeight + 5.5,
          size: 6.5,
          font: fontBold,
          color: rgb(1, 1, 1)
        });
        curX += col.width;
      }
      return currentTopY - headerHeight;
    };

    y = drawTableHeader(currentPage, y);

    let rowIndex = 0;
    for (const subj of subjects) {
      if (y - rowHeight < margin + 180) {
        currentPage = pdfDoc.addPage([595.28, pageHeight]);
        y = pageHeight - margin - 15;
        y = drawTableHeader(currentPage, y);
      }

      if (rowIndex % 2 === 0) {
        currentPage.drawRectangle({
          x: margin,
          y: y - rowHeight,
          width,
          height: rowHeight,
          color: COLOR_BG_LIGHT
        });
      }

      currentPage.drawLine({
        start: { x: margin, y: y - rowHeight },
        end: { x: margin + width, y: y - rowHeight },
        thickness: 0.4,
        color: COLOR_BORDER
      });

      let curX = margin;

      // 1. Matière avec troncature sécurisée
      const rawSubj = subj.subject_name_snapshot || "Matière";
      const codeStr = subj.subject_code_snapshot ? ` (${subj.subject_code_snapshot})` : "";
      const subjDisplay = truncateText(rawSubj + codeStr, cols[0].width - 12, fontBold, 7.5);
      currentPage.drawText(subjDisplay, {
        x: curX + 6,
        y: y - rowHeight + 5,
        size: 7.5,
        font: fontBold,
        color: COLOR_DARK
      });
      curX += cols[0].width;

      // 2. Coefficient
      const coeffStr = String(subj.coefficient || 1);
      currentPage.drawText(coeffStr, {
        x: curX + (cols[1].width - fontReg.widthOfTextAtSize(coeffStr, 7.5)) / 2,
        y: y - rowHeight + 5,
        size: 7.5,
        font: fontReg,
        color: COLOR_DARK
      });
      curX += cols[1].width;

      // 3. Évaluations
      const evalStr = `${subj.completed_assessment_count ?? 0} / ${subj.assessment_count ?? 0}`;
      currentPage.drawText(evalStr, {
        x: curX + (cols[2].width - fontReg.widthOfTextAtSize(evalStr, 7)) / 2,
        y: y - rowHeight + 5,
        size: 7,
        font: fontReg,
        color: subj.is_complete ? COLOR_MUTED : COLOR_WARN_TEXT
      });
      curX += cols[2].width;

      // 4. Pourcentage périodique
      const pctStr = subj.subject_percentage !== null ? `${Number(subj.subject_percentage).toFixed(1)} %` : '—';
      const pctColor = subj.subject_percentage !== null && subj.subject_percentage >= 50 ? COLOR_DARK : COLOR_WARN_TEXT;
      currentPage.drawText(pctStr, {
        x: curX + cols[3].width - fontBold.widthOfTextAtSize(pctStr, 7.5) - 6,
        y: y - rowHeight + 5,
        size: 7.5,
        font: fontBold,
        color: pctColor
      });
      curX += cols[3].width;

      // 5. Appréciation officielle (Sans valeurs inventées)
      const rawRemark = subj.subject_remark ? subj.subject_remark.trim() : "";
      const remarkStr = truncateText(rawRemark, cols[4].width - 12, fontReg, 7);
      if (remarkStr) {
        currentPage.drawText(remarkStr, {
          x: curX + 6,
          y: y - rowHeight + 5,
          size: 7,
          font: fontReg,
          color: COLOR_MUTED
        });
      }

      y -= rowHeight;
      rowIndex++;
    }

    // Ligne de synthèse
    const totalRowHeight = 18;
    currentPage.drawRectangle({
      x: margin,
      y: y - totalRowHeight,
      width,
      height: totalRowHeight,
      color: rgb(0.92, 0.94, 0.97),
      borderColor: COLOR_BORDER,
      borderWidth: 0.6
    });

    const totalLabel = "TOTAUX & SYNTHÈSE :";
    currentPage.drawText(totalLabel, {
      x: margin + 8,
      y: y - totalRowHeight + 5.5,
      size: 7.5,
      font: fontBold,
      color: COLOR_NAVY
    });

    const totalCoeffStr = String(reportCard.total_subject_coefficients || 0);
    currentPage.drawText(totalCoeffStr, {
      x: margin + cols[0].width + (cols[1].width - fontBold.widthOfTextAtSize(totalCoeffStr, 7.5)) / 2,
      y: y - totalRowHeight + 5.5,
      size: 7.5,
      font: fontBold,
      color: COLOR_NAVY
    });

    const overallStr = reportCard.overall_percentage !== null
      ? `${Number(reportCard.overall_percentage).toFixed(2)} %`
      : "—";
    currentPage.drawText(overallStr, {
      x: margin + cols[0].width + cols[1].width + cols[2].width + cols[3].width - fontBold.widthOfTextAtSize(overallStr, 8) - 6,
      y: y - totalRowHeight + 5.5,
      size: 8,
      font: fontBold,
      color: COLOR_NAVY
    });

    y -= (totalRowHeight + 8);
    return y;
  }

  private static drawPerformanceSummary(
    page: PDFPage,
    startY: number,
    margin: number,
    width: number,
    reportCard: PeriodReportCardRecord,
    fontReg: PDFFont,
    fontBold: PDFFont,
    fontOblique: PDFFont
  ): number {
    const boxHeight = 44;
    const boxY = startY - boxHeight;

    const isWarn = reportCard.is_incomplete || reportCard.rank_type === 'provisional';

    page.drawRectangle({
      x: margin,
      y: boxY,
      width,
      height: boxHeight,
      color: isWarn ? COLOR_WARN_BG : COLOR_BG_LIGHT,
      borderColor: isWarn ? rgb(0.92, 0.70, 0.40) : COLOR_BORDER,
      borderWidth: 0.8
    });

    // Pourcentage Général
    const pct = reportCard.overall_percentage !== null ? Number(reportCard.overall_percentage).toFixed(2) : '—';
    page.drawText("POURCENTAGE GÉNÉRAL", {
      x: margin + 12,
      y: boxY + boxHeight - 14,
      size: 6.5,
      font: fontBold,
      color: COLOR_MUTED
    });
    page.drawText(`${pct} %`, {
      x: margin + 12,
      y: boxY + 10,
      size: 14,
      font: fontBold,
      color: Number(pct) >= 50 ? COLOR_NAVY : COLOR_WARN_TEXT
    });

    page.drawLine({
      start: { x: margin + 150, y: boxY + 6 },
      end: { x: margin + 150, y: boxY + boxHeight - 6 },
      thickness: 0.6,
      color: COLOR_BORDER
    });

    // Rang & Effectif
    const rankStr = reportCard.rank ? (reportCard.rank === 1 ? "1er" : `${reportCard.rank}e`) : "—";
    const totalRanked = reportCard.total_students_ranked ? `sur ${reportCard.total_students_ranked} élèves classés` : "";

    page.drawText("RANG / CLASSEMENT", {
      x: margin + 165,
      y: boxY + boxHeight - 14,
      size: 6.5,
      font: fontBold,
      color: COLOR_MUTED
    });
    page.drawText(rankStr, {
      x: margin + 165,
      y: boxY + 10,
      size: 14,
      font: fontBold,
      color: COLOR_NAVY
    });
    page.drawText(totalRanked, {
      x: margin + 205,
      y: boxY + 12,
      size: 7.5,
      font: fontReg,
      color: COLOR_MUTED
    });

    page.drawLine({
      start: { x: margin + 320, y: boxY + 6 },
      end: { x: margin + 320, y: boxY + boxHeight - 6 },
      thickness: 0.6,
      color: COLOR_BORDER
    });

    // Statut du Rang & Incomplétude
    const statusTitle = isWarn ? "CLASSEMENT PROVISOIRE" : "CLASSEMENT OFFICIEL";
    const statusDetail = isWarn
      ? truncateText(`Bulletin incomplet — ${reportCard.pending_subjects_count} matière(s) en attente`, 200, fontOblique, 7)
      : "Résultats validés et certifiés conformes";

    page.drawText(statusTitle, {
      x: margin + 335,
      y: boxY + boxHeight - 14,
      size: 7,
      font: fontBold,
      color: isWarn ? COLOR_WARN_TEXT : COLOR_SUCCESS
    });
    page.drawText(statusDetail, {
      x: margin + 335,
      y: boxY + 12,
      size: 7,
      font: fontOblique,
      color: isWarn ? COLOR_WARN_TEXT : COLOR_MUTED
    });

    return boxY - 8;
  }

  private static drawRemarksSection(
    page: PDFPage,
    startY: number,
    margin: number,
    width: number,
    reportCard: PeriodReportCardRecord,
    fontReg: PDFFont,
    fontBold: PDFFont,
    fontOblique: PDFFont
  ): number {
    const boxHeight = 46;
    const boxY = startY - boxHeight;

    page.drawRectangle({
      x: margin,
      y: boxY,
      width,
      height: boxHeight,
      color: COLOR_BG_LIGHT,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8
    });

    const colWidth = width / 3;

    // 1. Conduite (Sans valeur inventée)
    const conduct = reportCard.conduct_grade ? truncateText(reportCard.conduct_grade, colWidth - 16, fontBold, 8) : "Non renseigné";
    page.drawText("CONDUITE & DISCIPLINE :", {
      x: margin + 8,
      y: boxY + boxHeight - 13,
      size: 6.5,
      font: fontBold,
      color: COLOR_NAVY
    });
    page.drawText(conduct, {
      x: margin + 8,
      y: boxY + 12,
      size: 8,
      font: fontBold,
      color: reportCard.conduct_grade ? COLOR_DARK : COLOR_MUTED
    });

    page.drawLine({
      start: { x: margin + colWidth, y: boxY + 5 },
      end: { x: margin + colWidth, y: boxY + boxHeight - 5 },
      thickness: 0.5,
      color: COLOR_BORDER
    });

    // 2. Appréciation du Titulaire (Sans valeur inventée)
    const rawHrRemarks = reportCard.homeroom_teacher_remarks ? reportCard.homeroom_teacher_remarks.trim() : "Non renseigné";
    const hrRemarks = truncateText(rawHrRemarks, colWidth - 16, fontOblique, 7);
    page.drawText("APPRÉCIATION DU TITULAIRE :", {
      x: margin + colWidth + 8,
      y: boxY + boxHeight - 13,
      size: 6.5,
      font: fontBold,
      color: COLOR_NAVY
    });
    page.drawText(hrRemarks, {
      x: margin + colWidth + 8,
      y: boxY + 12,
      size: 7,
      font: fontOblique,
      color: reportCard.homeroom_teacher_remarks ? COLOR_DARK : COLOR_MUTED
    });

    page.drawLine({
      start: { x: margin + colWidth * 2, y: boxY + 5 },
      end: { x: margin + colWidth * 2, y: boxY + boxHeight - 5 },
      thickness: 0.5,
      color: COLOR_BORDER
    });

    // 3. Observation de la Direction (Sans valeur inventée)
    const rawDirRemarks = reportCard.principal_remarks ? reportCard.principal_remarks.trim() : "Non renseigné";
    const dirRemarks = truncateText(rawDirRemarks, colWidth - 16, fontOblique, 7);
    page.drawText("OBSERVATION DE LA DIRECTION :", {
      x: margin + colWidth * 2 + 8,
      y: boxY + boxHeight - 13,
      size: 6.5,
      font: fontBold,
      color: COLOR_NAVY
    });
    page.drawText(dirRemarks, {
      x: margin + colWidth * 2 + 8,
      y: boxY + 12,
      size: 7,
      font: fontOblique,
      color: reportCard.principal_remarks ? COLOR_DARK : COLOR_MUTED
    });

    return boxY - 10;
  }

  private static drawSignaturesSection(
    page: PDFPage,
    startY: number,
    margin: number,
    width: number,
    identity: any,
    signatureSnap: any,
    batch: ReportCardBatchRecord,
    dirSigImg: PDFImage,
    stampImg: PDFImage,
    hrSigImg: PDFImage,
    fontReg: PDFFont,
    fontBold: PDFFont
  ): void {
    const boxHeight = 70;
    const boxY = startY - boxHeight;

    const colWidth = width / 3;

    // Colonne 1 : Professeur Titulaire
    const rawHrName = signatureSnap.homeroom_teacher_name || "Le Professeur Titulaire";
    const hrName = truncateText(rawHrName, colWidth - 20, fontReg, 7);
    page.drawText("Le Professeur Titulaire,", {
      x: margin + 10,
      y: boxY + boxHeight - 10,
      size: 7.5,
      font: fontBold,
      color: COLOR_NAVY
    });
    page.drawImage(hrSigImg, {
      x: margin + 10,
      y: boxY + 14,
      width: 65,
      height: 30
    });
    page.drawText(hrName, {
      x: margin + 10,
      y: boxY + 4,
      size: 7,
      font: fontReg,
      color: COLOR_DARK
    });

    // Colonne 2 : Cachet Officiel
    page.drawText("Sceau de l'Établissement,", {
      x: margin + colWidth + 25,
      y: boxY + boxHeight - 10,
      size: 7.5,
      font: fontBold,
      color: COLOR_NAVY
    });
    page.drawImage(stampImg, {
      x: margin + colWidth + 30,
      y: boxY + 12,
      width: 44,
      height: 44
    });

    // Colonne 3 : Chef d'Établissement
    const rawPrincipalName = signatureSnap.principal_name || "Le Chef d'Établissement";
    const principalName = truncateText(rawPrincipalName, colWidth - 20, fontReg, 7);
    const validatedDate = formatDateFrUtc(getStableValidatedDate(batch));

    page.drawText(`Fait le ${validatedDate},`, {
      x: margin + colWidth * 2 + 10,
      y: boxY + boxHeight - 10,
      size: 7,
      font: fontReg,
      color: COLOR_MUTED
    });
    page.drawText("Le Chef d'Établissement,", {
      x: margin + colWidth * 2 + 10,
      y: boxY + boxHeight - 20,
      size: 7.5,
      font: fontBold,
      color: COLOR_NAVY
    });
    page.drawImage(dirSigImg, {
      x: margin + colWidth * 2 + 10,
      y: boxY + 14,
      width: 65,
      height: 30
    });
    page.drawText(principalName, {
      x: margin + colWidth * 2 + 10,
      y: boxY + 4,
      size: 7,
      font: fontReg,
      color: COLOR_DARK
    });
  }

  private static drawFooter(
    page: PDFPage,
    margin: number,
    width: number,
    pageNumber: number,
    totalPages: number,
    reportCard: PeriodReportCardRecord,
    batch: ReportCardBatchRecord,
    fontReg: PDFFont
  ): void {
    const footerY = margin - 12;

    page.drawLine({
      start: { x: margin, y: footerY + 12 },
      end: { x: margin + width, y: footerY + 12 },
      thickness: 0.5,
      color: COLOR_BORDER
    });

    const docId = `ID Bulletin: ${reportCard.id} • Révision #${batch.revision_number}`;
    page.drawText(docId, {
      x: margin,
      y: footerY + 3,
      size: 6,
      font: fontReg,
      color: COLOR_MUTED
    });

    const pageStr = `Page ${pageNumber} / ${totalPages}`;
    page.drawText(pageStr, {
      x: margin + width - fontReg.widthOfTextAtSize(pageStr, 6.5),
      y: footerY + 3,
      size: 6.5,
      font: fontReg,
      color: COLOR_MUTED
    });
  }
}
