import type { AnalyticsExportChart, AnalyticsExportCell, AnalyticsWorkbookModel } from './analyticsExportModel';

type SheetRow = { cells: AnalyticsExportCell[]; style?: number };
type ZipFile = { name: string; content: string | Uint8Array };

const encoder = new TextEncoder();
const maxCellCharacters = 32767;

function xml(value: unknown): string {
  const characters = [...String(value)].filter(character => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0xd7ff
      || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff;
  });
  const text = characters.length > maxCellCharacters
    ? `${characters.slice(0, maxCellCharacters - 3).join('')}...` : characters.join('');
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + value % 26) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function cellXml(reference: string, value: AnalyticsExportCell, style?: number): string {
  const styleAttribute = style === undefined ? '' : ` s="${style}"`;
  if (value === null) return `<c r="${reference}"${styleAttribute}/>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Analytics workbook contains a non-finite number.');
    return `<c r="${reference}"${styleAttribute}><v>${Object.is(value, -0) ? 0 : value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function worksheetXml(rows: SheetRow[], widths: number[], hasDrawing = false): string {
  if (rows.length > 1048576 || widths.length > 16384) throw new Error('Analytics workbook exceeds worksheet limits.');
  const columns = widths.length
    ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const content = rows.map((row, rowIndex) => {
    if (row.cells.length > 16384) throw new Error('Analytics workbook exceeds worksheet limits.');
    const cells = row.cells.map((value, columnIndex) => cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, value, row.style)).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const drawing = hasDrawing ? '<drawing r:id="rId1"/>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${columns}<sheetData>${content}</sheetData>${drawing}</worksheet>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: ZipFile[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

function createStylesXml(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="4"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="20"/><color rgb="FF073B82"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF073B82"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF073B82"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

function addDashboardChart(rows: SheetRow[], chart: AnalyticsExportChart, imageIndex: number, anchors: string[]) {
  rows.push({ cells: [chart.title], style: 2 });
  rows.push({ cells: ['Chart notes', chart.note] });
  if (!chart.hasChart) {
    rows.push({ cells: ['Chart availability', chart.note] });
    return;
  }
  if (!chart.image) throw new Error(`The ${chart.title} chart image was not captured.`);
  const { bytes, widthPx, heightPx } = chart.image;
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    throw new Error(`The ${chart.title} chart has invalid image dimensions.`);
  }
  if (bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) {
    throw new Error(`The ${chart.title} chart image is not a PNG.`);
  }
  const scale = Math.min(1, 760 / widthPx);
  const displayWidth = widthPx * scale;
  const displayHeight = heightPx * scale;
  const rowIndex = rows.length;
  rows.push({ cells: [] });
  for (let index = 0; index < Math.ceil(displayHeight / 20) + 1; index += 1) rows.push({ cells: [] });
  const pictureId = imageIndex + 1;
  const widthEmu = Math.round(displayWidth * 9525);
  const heightEmu = Math.round(displayHeight * 9525);
  anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${rowIndex}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${widthEmu}" cy="${heightEmu}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${pictureId}" name="${xml(chart.title)}" descr="${xml(chart.title)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${pictureId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
}

function dashboardRows(model: AnalyticsWorkbookModel): { rows: SheetRow[]; images: AnalyticsExportChart[]; anchors: string[] } {
  const rows: SheetRow[] = [
    { cells: ['TRAKFLIT | Operations Analytics'], style: 1 },
    { cells: ['Filtered dashboard export'] },
    { cells: ['Date range (Africa/Lagos)', `${model.rangeStart} to ${model.rangeEnd}`], style: 2 },
    { cells: ['Applied filters'], style: 2 },
    ...model.filters.map(filter => ({ cells: [filter.label, filter.value] })),
    { cells: [] },
    { cells: ['Filtered KPI', 'Value', 'Unit', 'Sample size / coverage'], style: 3 },
    ...model.kpis.map(kpi => ({ cells: [kpi.label, kpi.value, kpi.unit, kpi.sample] })),
    { cells: [] },
    { cells: ['Current chart selections'], style: 2 },
    ...model.selections.map(selection => ({ cells: [selection.label, selection.value] })),
    { cells: [] },
    { cells: ['Currently selected charts'], style: 2 },
  ];
  const images: AnalyticsExportChart[] = [];
  const anchors: string[] = [];
  for (const chart of model.charts) {
    const imageIndex = images.length;
    if (chart.hasChart) images.push(chart);
    addDashboardChart(rows, chart, imageIndex, anchors);
  }
  return { rows, images, anchors };
}

function chartDataRows(charts: AnalyticsExportChart[]): SheetRow[] {
  const rows: SheetRow[] = [
    { cells: ['Editable aggregate chart data'], style: 1 },
    { cells: ['Only data backing the currently selected Analytics charts is included. No raw operational records or internal IDs are exported.'] },
  ];
  for (const chart of charts) {
    rows.push({ cells: [] });
    rows.push({ cells: [chart.title, `Unit: ${chart.unit}`], style: 2 });
    rows.push({ cells: ['Chart notes', chart.note] });
    rows.push({ cells: chart.headers, style: 3 });
    if (!chart.rows.length) {
      rows.push({ cells: [`No data: ${chart.note}`, ...chart.headers.slice(1).map(() => null)] });
    } else {
      for (const dataRow of chart.rows) rows.push({ cells: dataRow });
    }
  }
  return rows;
}

function reportInformationRows(model: AnalyticsWorkbookModel): SheetRow[] {
  return [
    { cells: ['Report Information'], style: 1 },
    { cells: ['Export timestamp (Africa/Lagos)', model.exportedAtLagos] },
    { cells: ['Export timestamp (ISO 8601)', model.exportedAt] },
    { cells: ['Reporting date range (Africa/Lagos)', `${model.rangeStart} to ${model.rangeEnd}`] },
    { cells: [] },
    { cells: ['Applied filters'], style: 2 },
    ...model.filters.map(filter => ({ cells: [filter.label, filter.value] })),
    { cells: [] },
    { cells: ['Chart selections'], style: 2 },
    ...model.selections.map(selection => ({ cells: [selection.label, selection.value] })),
    { cells: [] },
    { cells: ['KPI definitions and cohorts'], style: 2 },
    { cells: ['KPI', 'Definition', 'Sample size / coverage'], style: 3 },
    ...model.kpis.map(kpi => ({ cells: [kpi.label, kpi.definition, kpi.sample] })),
    { cells: [] },
    { cells: ['Reporting limitations'], style: 2 },
    ...model.limitations.map(limitation => ({ cells: [limitation] })),
  ];
}

function drawingXml(anchors: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join('')}</xdr:wsDr>`;
}

export function createAnalyticsXlsxBytes(model: AnalyticsWorkbookModel): Uint8Array {
  const imageCharts = model.charts.filter(chart => chart.hasChart);
  if (model.charts.some(chart => chart.hasChart && !chart.image)) {
    const missing = model.charts.find(chart => chart.hasChart && !chart.image);
    throw new Error(`The ${missing?.title ?? 'selected'} chart image was not captured.`);
  }
  const dashboard = dashboardRows(model);
  const files: ZipFile[] = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${imageCharts.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}</Types>` },
    { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>TRAKFLIT Analytics</dc:title><dc:creator>TRAKFLIT</dc:creator><cp:lastModifiedBy>TRAKFLIT</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${xml(model.exportedAt)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${xml(model.exportedAt)}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>TRAKFLIT</Application><TitlesOfParts><vt:vector size="3" baseType="lpstr"><vt:lpstr>Dashboard</vt:lpstr><vt:lpstr>Chart Data</vt:lpstr><vt:lpstr>Report Information</vt:lpstr></vt:vector></TitlesOfParts></Properties>` },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Dashboard" sheetId="1" r:id="rId1"/><sheet name="Chart Data" sheetId="2" r:id="rId2"/><sheet name="Report Information" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="191029"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: createStylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: worksheetXml(dashboard.rows, [34, 26, 18, 70], imageCharts.length > 0) },
    { name: 'xl/worksheets/sheet2.xml', content: worksheetXml(chartDataRows(model.charts), [34, 30, 28, 28, 24, 20]) },
    { name: 'xl/worksheets/sheet3.xml', content: worksheetXml(reportInformationRows(model), [38, 92, 64]) },
  ];
  if (imageCharts.length) {
    files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>` });
    files.push({ name: 'xl/drawings/drawing1.xml', content: drawingXml(dashboard.anchors) });
    files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imageCharts.map((_chart, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/chart-${index + 1}.png"/>`).join('')}</Relationships>` });
    imageCharts.forEach((chart, index) => files.push({ name: `xl/media/chart-${index + 1}.png`, content: chart.image!.bytes }));
  }
  return zipStore(files);
}
