import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'npm:pdf-lib@1.17.1';
import type { CompanyWaybillSnapshot, DriverWaybillSnapshot, WaybillFields } from './types.ts';

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 42;
const navy = rgb(7 / 255, 59 / 255, 130 / 255);
const deepNavy = rgb(6 / 255, 45 / 255, 99 / 255);
const electricBlue = rgb(8 / 255, 123 / 255, 240 / 255);
const blueSoft = rgb(234 / 255, 245 / 255, 255 / 255);
const border = rgb(215 / 255, 229 / 255, 242 / 255);
const ink = rgb(26 / 255, 43 / 255, 64 / 255);
const muted = rgb(89 / 255, 109 / 255, 132 / 255);
const white = rgb(1, 1, 1);
const footerReserve = 70;
const cardPadding = 12;
const cardLabelSize = 7.5;
const cardValueSize = 10.5;
const cardLineHeight = 14;

function printableText(value: string, font: PDFFont): string {
  return Array.from(value, character => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      return '?';
    }
  }).join('');
}

function wrapText(value: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of printableText(value, font).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const parts: string[] = [];
      let part = '';
      for (const character of word) {
        const candidate = part + character;
        if (part && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
          parts.push(part);
          part = character;
        } else {
          part = candidate;
        }
      }
      if (part) parts.push(part);
      for (const nextPart of parts) {
        const candidate = line ? `${line} ${nextPart}` : nextPart;
        if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
          lines.push(line);
          line = nextPart;
        } else {
          line = candidate;
        }
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

export function formatLagosTimestamp(value: string, includeTime = true): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not provided';
  const options: Intl.DateTimeFormatOptions = includeTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  return `${new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Africa/Lagos' }).format(date)}${includeTime ? ' WAT' : ''}`;
}

function formatTonnage(value: number | string): string {
  const tonnage = Number(value);
  if (!Number.isFinite(tonnage)) return `${String(value)} tonnes`;
  return `${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tonnage)} tonnes`;
}

function cardLines(value: string, font: PDFFont, width: number): string[] {
  return value.split('\n').flatMap(line => wrapText(line, font, cardValueSize, width));
}

function cardHeight(lineCount: number): number {
  return cardPadding * 2 + 12 + lineCount * cardLineHeight;
}

function drawCard(
  page: PDFPage,
  x: number,
  top: number,
  width: number,
  height: number,
  label: string,
  lines: string[],
  regular: PDFFont,
  bold: PDFFont,
  options: { accent?: boolean; firstLineBold?: boolean } = {},
) {
  page.drawRectangle({
    x,
    y: top - height,
    width,
    height,
    color: options.accent ? blueSoft : white,
    borderColor: options.accent ? electricBlue : border,
    borderWidth: options.accent ? 1.1 : 0.7,
  });
  page.drawText(printableText(label.toUpperCase(), bold), {
    x: x + cardPadding,
    y: top - cardPadding - cardLabelSize,
    size: cardLabelSize,
    font: bold,
    color: options.accent ? navy : muted,
  });
  let textY = top - cardPadding - 12 - cardLabelSize;
  lines.forEach((line, index) => {
    const isPrimary = index === 0 && options.firstLineBold;
    page.drawText(printableText(line, isPrimary ? bold : regular), {
      x: x + cardPadding,
      y: textY,
      size: cardValueSize,
      font: isPrimary ? bold : regular,
      color: ink,
    });
    textY -= cardLineHeight;
  });
}

function drawHeader(
  page: PDFPage,
  logo: PDFImage,
  snapshot: WaybillFields,
  copyLabel: string,
  regular: PDFFont,
  bold: PDFFont,
) {
  const logoBox = 112;
  const logoDimensions = logo.scaleToFit(logoBox, logoBox);
  page.drawImage(logo, {
    x: margin + (logoBox - logoDimensions.width) / 2,
    y: pageHeight - margin - logoBox + (logoBox - logoDimensions.height) / 2,
    width: logoDimensions.width,
    height: logoDimensions.height,
  });
  const textX = margin + 132;
  page.drawText('WAYBILL', { x: textX, y: pageHeight - margin - 28, size: 23, font: bold, color: deepNavy });
  page.drawRectangle({ x: textX, y: pageHeight - margin - 56, width: 100, height: 19, color: blueSoft });
  page.drawText(copyLabel.toUpperCase(), {
    x: textX + 7,
    y: pageHeight - margin - 50,
    size: 8,
    font: bold,
    color: navy,
  });
  page.drawText(`Waybill Number: ${printableText(snapshot.invoice_number, regular)}`, {
    x: textX,
    y: pageHeight - margin - 79,
    size: 10,
    font: bold,
    color: ink,
  });
  page.drawLine({
    start: { x: margin, y: pageHeight - margin - 126 },
    end: { x: pageWidth - margin, y: pageHeight - margin - 126 },
    thickness: 2,
    color: electricBlue,
  });
  return pageHeight - margin - 148;
}

function drawFooter(page: PDFPage, snapshot: WaybillFields, regular: PDFFont) {
  page.drawLine({
    start: { x: margin, y: margin + 17 },
    end: { x: pageWidth - margin, y: margin + 17 },
    thickness: 0.6,
    color: border,
  });
  page.drawText(`Issue date: ${formatLagosTimestamp(snapshot.issued_at, false)}`, {
    x: margin,
    y: margin + 2,
    size: 8,
    font: regular,
    color: muted,
  });
  page.drawText('Issued by TRAKFLIT', {
    x: pageWidth - margin - 100,
    y: margin + 2,
    size: 8,
    font: regular,
    color: muted,
  });
}

async function createSecureWaybillPdf(
  snapshot: DriverWaybillSnapshot | CompanyWaybillSnapshot,
  logoBytes: Uint8Array,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await document.embedJpg(logoBytes);
  const issueDate = new Date(snapshot.issued_at);
  if (Number.isNaN(issueDate.getTime())) throw new Error('Invalid Waybill issue date');
  const copyLabel = snapshot.copy_kind === 'company' ? 'Company Copy' : 'Driver Copy';
  document.setTitle(`TRAKFLIT Waybill ${snapshot.invoice_number} — ${copyLabel}`);
  document.setSubject(copyLabel);
  document.setAuthor('TRAKFLIT');
  document.setCreationDate(issueDate);
  document.setModificationDate(issueDate);

  const pages: PDFPage[] = [];
  let page = document.addPage([pageWidth, pageHeight]);
  pages.push(page);
  let y = drawHeader(page, logo, snapshot, copyLabel, regular, bold);
  const newPage = () => {
    page = document.addPage([pageWidth, pageHeight]);
    pages.push(page);
    y = drawHeader(page, logo, snapshot, copyLabel, regular, bold);
  };
  const ensureRoom = (height: number) => {
    if (y - height < footerReserve) newPage();
  };
  const gap = 9;
  const halfWidth = (pageWidth - margin * 2 - gap) / 2;
  const drawPair = (left: { label: string; value: string; accent?: boolean }, right: { label: string; value: string; accent?: boolean }) => {
    const leftLines = cardLines(left.value, regular, halfWidth - cardPadding * 2);
    const rightLines = cardLines(right.value, regular, halfWidth - cardPadding * 2);
    const height = cardHeight(Math.max(leftLines.length, rightLines.length));
    ensureRoom(height);
    drawCard(page, margin, y, halfWidth, height, left.label, leftLines, regular, bold, {
      accent: left.accent,
      firstLineBold: left.accent,
    });
    drawCard(page, margin + halfWidth + gap, y, halfWidth, height, right.label, rightLines, regular, bold, {
      accent: right.accent,
      firstLineBold: right.accent,
    });
    y -= height + gap;
  };
  const drawFull = (label: string, value: string, options: { accent?: boolean; firstLineBold?: boolean } = {}) => {
    const lines = cardLines(value, regular, pageWidth - margin * 2 - cardPadding * 2);
    const height = cardHeight(lines.length);
    ensureRoom(height);
    drawCard(page, margin, y, pageWidth - margin * 2, height, label, lines, regular, bold, options);
    y -= height + gap;
  };

  drawPair(
    { label: 'Truck Registration', value: snapshot.truck_registration },
    {
      label: 'Driver',
      value: snapshot.copy_kind === 'company' && snapshot.driver_phone
        ? `${snapshot.driver_name}\nPhone: ${snapshot.driver_phone}`
        : snapshot.driver_name,
    },
  );
  drawPair(
    { label: 'Loading Site', value: `${snapshot.loading_site_name}\n${formatLagosTimestamp(snapshot.opened_at)}` },
    { label: 'Offloading Site', value: `${snapshot.offloading_site_name}\n${formatLagosTimestamp(snapshot.closed_at)}` },
  );
  drawFull('Tonnage', formatTonnage(snapshot.quantity_tonnes), { accent: true, firstLineBold: true });

  if (snapshot.copy_kind === 'company') {
    const headingHeight = 18;
    ensureRoom(headingHeight + gap);
    page.drawText('DRIVER PAYMENT DETAILS', {
      x: margin,
      y: y - 10,
      size: 8,
      font: bold,
      color: navy,
    });
    y -= headingHeight;
    drawPair(
      { label: 'Bank Name', value: snapshot.bank_name },
      { label: 'Account Name', value: snapshot.account_name },
    );
    drawFull('Account Number', snapshot.account_number, { accent: true, firstLineBold: true });
  }

  for (const currentPage of pages) drawFooter(currentPage, snapshot, regular);
  return await document.save({ useObjectStreams: false });
}

export function generateDriverWaybillPdf(snapshot: DriverWaybillSnapshot, logoBytes: Uint8Array): Promise<Uint8Array> {
  return createSecureWaybillPdf(snapshot, logoBytes);
}

export function generateCompanyWaybillPdf(snapshot: CompanyWaybillSnapshot, logoBytes: Uint8Array): Promise<Uint8Array> {
  if (!snapshot.bank_name.trim() || !snapshot.account_name.trim() || !/^\d{10}$/.test(snapshot.account_number)) {
    throw new Error('Verified company banking snapshot is incomplete');
  }
  return createSecureWaybillPdf(snapshot, logoBytes);
}
