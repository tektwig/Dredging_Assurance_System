/// <reference path="../deno-types.d.ts" />
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import type { WaybillSnapshot } from './worker.ts';

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 44;
const lineHeight = 16;
const fontSize = 10;

function readableText(text: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>) {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return Array.from(text, character => {
      try {
        font.encodeText(character);
        return character;
      } catch {
        return '?';
      }
    }).join('');
  }
}

export async function generateWaybillPdf(snapshot: WaybillSnapshot): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const issuedDate = new Date(snapshot.issued_at);
  document.setTitle(`Waybill ${snapshot.invoice_number}`);
  document.setSubject(`Trip ${snapshot.trip_number}`);
  document.setAuthor('Dredging Assurance System');
  document.setCreationDate(issuedDate);
  document.setModificationDate(issuedDate);

  const fields: Array<[string, string | number | null]> = [
    ['Trip Number', snapshot.trip_number],
    ['Truck Registration', snapshot.truck_registration],
    ['Truck Type', snapshot.truck_type],
    ['Truck Capacity (tonnes)', snapshot.truck_capacity_tonnes],
    ['Truck Owner', snapshot.truck_owner_name],
    ['Driver Name', snapshot.driver_name],
    ['Driver Phone', snapshot.driver_phone],
    ['Driver Email', snapshot.driver_email],
    ['Driver Licence', snapshot.driver_license],
    ['Loading Site', snapshot.loading_site_name],
    ['Loading Time', snapshot.opened_at],
    ['Offloading Site', snapshot.offloading_site_name],
    ['Offloading Time', snapshot.closed_at],
    ['Tonnage (tonnes)', snapshot.quantity_tonnes],
    ['Loading Officer', snapshot.loading_officer_name],
    ['Offloading Officer', snapshot.offloading_officer_name],
    ['Issued At', snapshot.issued_at],
  ];
  fields.splice(9, 0,
    ['Bank Name', snapshot.bank_name],
    ['Account Name', snapshot.account_name],
    ['Account Number', snapshot.account_number]);

  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const drawHeader = () => {
    page.drawText('WAYBILL', { x: margin, y, size: 18, font: bold, color: rgb(0.12, 0.2, 0.3) });
    y -= 26;
    page.drawText(`Waybill Number: ${snapshot.invoice_number}`, { x: margin, y, size: 11, font: bold });
    y -= 26;
  };
  const nextPage = () => {
    page = document.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    drawHeader();
  };
  const drawLine = (value: string, font: typeof regular) => {
    const safeValue = readableText(value, regular);
    const words = safeValue.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (regular.widthOfTextAtSize(candidate, fontSize) > pageWidth - margin * 2 && line) {
        if (y < margin + lineHeight) nextPage();
        page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.12, 0.12, 0.12) });
        y -= lineHeight;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      if (y < margin + lineHeight) nextPage();
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.12, 0.12, 0.12) });
      y -= lineHeight;
    }
  };

  drawHeader();
  for (const [label, value] of fields) {
    const displayValue = value === null || value === '' ? 'Not provided' : String(value);
    drawLine(`${label}: ${displayValue}`, regular);
  }
  return await document.save({ useObjectStreams: false });
}
