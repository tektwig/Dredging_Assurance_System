import { reportColumnsFor, type OperationsReportKind, type ReportRow } from './operationsReports';

const encoder = new TextEncoder();

function xml(value: string): string {
  return Array.from(value).filter(character => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0xd7ff
      || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff;
  }).join('')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let current = index + 1;
  let name = '';
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + current % 26) + name;
    current = Math.floor(current / 26);
  }
  return name;
}

function worksheet(kind: OperationsReportKind, rows: ReportRow[]): string {
  const columns = reportColumnsFor(kind);
  const allRows = [columns.map(([, title]) => title), ...rows.map(row => columns.map(([key]) => row[key]))];
  const content = allRows.map((cells, rowIndex) => `<row r="${rowIndex + 1}">${cells.map((cell, colIndex) => {
    const reference = `${columnName(colIndex)}${rowIndex + 1}`;
    if (typeof cell === 'number' && Number.isFinite(cell)) return `<c r="${reference}"><v>${cell}</v></c>`;
    if (typeof cell === 'boolean') return `<c r="${reference}" t="b"><v>${cell ? 1 : 0}</v></c>`;
    const text = cell === null || cell === undefined ? '' : String(cell);
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${content}</sheetData></worksheet>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; content: string }[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true); localView.setUint32(18, data.length, true); localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true); localHeader.set(name, 30);
    local.push(localHeader, data);

    const directory = new Uint8Array(46 + name.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true); directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true); directoryView.setUint16(8, 0x0800, true);
    directoryView.setUint16(10, 0, true); directoryView.setUint32(16, crc, true);
    directoryView.setUint32(20, data.length, true); directoryView.setUint32(24, data.length, true);
    directoryView.setUint16(28, name.length, true); directoryView.setUint32(42, offset, true);
    directory.set(name, 46); central.push(directory);
    offset += localHeader.length + data.length;
  }
  const centralSize = central.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true); endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...local, ...central, end]) { result.set(part, cursor); cursor += part.length; }
  return result;
}

export function createXlsxBytes(kind: OperationsReportKind, rows: ReportRow[]): Uint8Array {
  const files = [
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', content: worksheet(kind, rows) },
  ];
  return zipStore(files);
}
