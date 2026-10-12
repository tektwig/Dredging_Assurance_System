import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const overrides = new Map();
const cache = new Map();

overrides.set('recharts', Object.fromEntries([
  'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Legend', 'Line', 'LineChart', 'Pie', 'PieChart',
  'ReferenceLine', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis',
].map(name => [name, () => null])));
overrides.set(resolve('src/lib/supabase.ts'), { supabase: null });

function load(path) {
  const full = resolve(path);
  if (overrides.has(full)) return overrides.get(full);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} };
  cache.set(full, module);
  const output = ts.transpileModule(readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = name => {
    if (overrides.has(name)) return overrides.get(name);
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(full), name);
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.css`].find(existsSync);
    assert(target, `Local import must resolve: ${name}`);
    return target.endsWith('.css') ? {} : load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

const dateList = Array.from({ length: 7 }, (_, index) => `2026-10-0${index + 1}`);
const data = {
  as_of: '2026-10-08T10:00:00.000Z', range_start: dateList[0], range_end: dateList.at(-1),
  time_zone: 'Africa/Lagos', period: 'custom',
  kpis: {
    total_trips: 20, actual_tonnage_tonnes: 105.678, actual_tonnage_closed_trip_count: 12,
    average_tonnage_per_trip_tonnes: 8.789, average_tonnage_trip_count: 12,
    average_turnaround_seconds: 5400, average_turnaround_trip_count: 9,
    average_tonnage_variance_tonnes: -1.234, total_tonnage_variance_tonnes: -8.638,
    variance_trip_count: 7, estimate_coverage: 7 / 12,
  },
  trips_trend: dateList.map((date, index) => ({ date, opened: index + 2, closed: index + 1 })),
  tonnage_trend: dateList.map((date, index) => index === 2
    ? { date, estimated_tonnage_tonnes: null, actual_tonnage_tonnes: null, paired_trip_count: 0 }
    : { date, estimated_tonnage_tonnes: 12.5, actual_tonnage_tonnes: 11.25, paired_trip_count: 1 }),
  performance: {
    dimension: 'driver', metric: 'average_turnaround', entity_count: 12,
    items: Array.from({ length: 10 }, (_, index) => ({
      entity_id: `private-driver-id-${index}`, label: index === 0 ? '=HYPERLINK("https://bad.example")<&"' : `Driver ${index}`,
      trip_count: 12 - index, closed_trip_count: 8, actual_tonnage_tonnes: 80.25,
      average_tonnage_tonnes: 10.03125, average_turnaround_seconds: 5400 + index * 60,
    })),
  },
  status_distributions: {
    trip: { denominator: 20, slices: [{ status: 'closed', count: 15, share: 0.75 }, { status: 'open', count: 5, share: 0.25 }] },
    exception: { denominator: 4, slices: [{ status: 'in_review', count: 3, share: 0.75 }, { status: 'resolved', count: 1, share: 0.25 }] },
  },
  variance: {
    total_variance_tonnes: -8.638, average_variance_tonnes: -1.234, paired_trip_count: 7,
    estimate_coverage: 7 / 12,
    daily: dateList.map((date, index) => ({ date, variance_tonnes: index === 2 ? null : -1.234,
      paired_trip_count: index === 2 ? 0 : 1 })),
    trucks: Array.from({ length: 10 }, (_, index) => ({ entity_id: `private-truck-id-${index}`,
      label: `Truck ${index}`, average_variance_tonnes: -2.5 + index, total_variance_tonnes: -5 + index,
      paired_trip_count: 2 })),
  },
  driver_performance_daily: {
    selected_driver_id: 'private-selected-driver-id',
    days: dateList.map((date, index) => ({ date, trips_opened: index + 1, trips_closed: index,
      actual_tonnage_tonnes: index ? 12.5 : 0, average_tonnage_per_trip_tonnes: index ? 12.5 : null,
      average_tonnage_trip_count: index ? 1 : 0, average_turnaround_seconds: index ? 5400 : null,
      average_turnaround_trip_count: index ? 1 : 0 })),
  },
  period_summaries: {
    weekly: [{ period_start: dateList[0], period_end: dateList.at(-1), trips_opened: 20, trips_closed: 15,
      outstanding_at_period_end: 5, outstanding_excluded_unassigned_offloading_site_count: 0,
      actual_tonnage_tonnes: 105.678, average_tonnage_per_trip_tonnes: 8.789,
      average_tonnage_trip_count: 12, average_turnaround_seconds: 5400, average_turnaround_trip_count: 9 }],
    monthly: [{ period_start: '2026-10-01', period_end: '2026-10-31', trips_opened: 20, trips_closed: 15,
      outstanding_at_period_end: 5, outstanding_excluded_unassigned_offloading_site_count: 0,
      actual_tonnage_tonnes: 105.678, average_tonnage_per_trip_tonnes: 8.789,
      average_tonnage_trip_count: 12, average_turnaround_seconds: 5400, average_turnaround_trip_count: 9 }],
    outstanding_definition: 'open_at_end_of_last_included_lagos_operational_date',
    offloading_site_filter_scope: 'all_matching_trips',
  },
};

const modelModule = load('src/features/operations/analytics/analyticsExportModel.ts');
const writer = load('src/features/operations/analytics/analyticsXlsxWriter.ts');
const filters = { period: 'custom', date_from: dateList[0], date_to: dateList.at(-1),
  loading_site_id: 'private-site-id', driver_id: 'private-selected-driver-id' };
const filterLabels = { loading_site: 'Quarry & <North>', driver: 'Driver "A"' };
const selections = {
  dimension: 'driver', metric: 'average_turnaround', driverMetric: 'average_turnaround_seconds',
  summaryGranularity: 'monthly', summaryMetric: 'actual_tonnage_tonnes', statusCohort: 'exception',
};
const model = modelModule.buildAnalyticsWorkbookModel({ data, filters, filterLabels, selections,
  exportedAt: new Date('2026-10-12T12:30:00.000Z') });

assert.deepEqual(model.filters, [
  { label: 'Period', value: 'Custom date range' },
  { label: 'Date range (Africa/Lagos)', value: `${dateList[0]} to ${dateList.at(-1)}` },
  { label: 'Loading Site', value: 'Quarry & <North>' },
  { label: 'Driver', value: 'Driver "A"' },
]);
assert.equal(model.selections.find(item => item.label === 'Performance chart').value, 'Driver · Average Turnaround Time');
assert.equal(model.selections.find(item => item.label === 'Summary chart').value, 'Monthly · Actual Tonnage');
assert.equal(model.selections.find(item => item.label === 'Status chart').value, 'Exception Status');
assert.equal(model.charts.find(chart => chart.key === 'driver-daily').rows[1][1], 1.5);
assert.equal(model.charts.find(chart => chart.key === 'period-summary').rows[0][2], 105.678);
assert.equal(model.charts.find(chart => chart.key === 'status-distribution').rows[0][0], 'in_review');
assert.equal(modelModule.analyticsExportFilename(model.rangeStart, model.rangeEnd),
  'TRAKFLIT_Analytics_2026-10-01_to_2026-10-07.xlsx');
assert.equal(model.kpis.length, 5);
assert.deepEqual(model.kpis.map(kpi => kpi.value), [20, 105.68, 8.79, 1.5, -1.23]);
assert(model.kpis.every(kpi => kpi.sample.length > 0 && kpi.definition.length > 0));
assert(model.limitations.some(note => note.includes('90')));
assert(model.charts.find(chart => chart.key === 'performance').note.includes('top 10'));
assert(model.charts.find(chart => chart.key === 'variance-trucks').note.includes('top 10'));
assert(!JSON.stringify(model).includes('private-selected-driver-id'));
assert(!JSON.stringify(model).includes('private-driver-id'));
assert(!JSON.stringify(model).includes('private-truck-id'));
console.log('PASS filtered KPI, filter labels, selected chart series, date grouping, privacy, and limitation model');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, bytes) {
  const nameBytes = Buffer.from(name, 'ascii');
  const chunk = Buffer.alloc(12 + bytes.length);
  chunk.writeUInt32BE(bytes.length, 0);
  nameBytes.copy(chunk, 4);
  bytes.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([nameBytes, bytes])), 8 + bytes.length);
  return chunk;
}

function syntheticPng() {
  const imageHeader = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const pixelData = Buffer.from([0, 7, 59, 130, 255]);
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', imageHeader), pngChunk('IDAT', require('node:zlib').deflateSync(pixelData)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function packageEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { endOffset = offset; break; }
  }
  assert(endOffset >= 0, 'ZIP end-of-central-directory record exists');
  const count = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50, 'central directory record signature');
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    assert.equal(method, 0, `${name} uses store compression`);
    assert.equal(view.getUint32(localOffset, true), 0x04034b50, `${name} local header signature`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const content = bytes.slice(start, start + size);
    assert.equal(crc32(content), checksum, `${name} CRC-32`);
    assert(!entries.has(name), `ZIP entry ${name} is unique`);
    entries.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXml(bytes, partName) {
  const dom = new JSDOM(new TextDecoder().decode(bytes), { contentType: 'text/xml' });
  assert.equal(dom.window.document.getElementsByTagName('parsererror').length, 0, `${partName} parses as XML`);
  return dom.window.document;
}

function rowsByNumber(document) {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return Array.from(document.getElementsByTagNameNS(ns, 'row'));
}

function cellText(row, column) {
  const cell = Array.from(row.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'c'))
    .find(item => item.getAttribute('r')?.startsWith(column));
  if (!cell) return '';
  return cell.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 't')[0]?.textContent
    ?? cell.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'v')[0]?.textContent
    ?? '';
}

const image = syntheticPng();
assert.deepEqual(Array.from(image.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
for (const chart of model.charts) if (chart.hasChart) chart.image = { bytes: image, widthPx: 640, heightPx: 320 };
const workbookBytes = writer.createAnalyticsXlsxBytes(model);
const entries = packageEntries(workbookBytes);
assert.equal(entries.size, 13 + model.charts.filter(chart => chart.hasChart).length,
  'three-sheet workbook contains core parts, drawing relationships, and one PNG per visible chart');
for (const [name, content] of entries) {
  if (name.endsWith('.xml') || name.endsWith('.rels')) parseXml(content, name);
}
const workbookDocument = parseXml(entries.get('xl/workbook.xml'), 'workbook.xml');
const sheetNames = Array.from(workbookDocument.getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'sheet')).map(sheet => sheet.getAttribute('name'));
assert.deepEqual(sheetNames, ['Dashboard', 'Chart Data', 'Report Information']);
assert.equal(sheetNames.length, 3);

const drawingDocument = parseXml(entries.get('xl/drawings/drawing1.xml'), 'drawing1.xml');
const anchors = Array.from(drawingDocument.getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing', 'oneCellAnchor'));
assert.equal(anchors.length, model.charts.filter(chart => chart.hasChart).length);
assert(anchors.every(anchor => anchor.getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing', 'pic').length === 1));
const drawingRels = parseXml(entries.get('xl/drawings/_rels/drawing1.xml.rels'), 'drawing relationships');
const imageRelationships = Array.from(drawingRels.getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship'));
assert.equal(imageRelationships.length, anchors.length);
assert(imageRelationships.every((relation, index) => entries.has(`xl/media/chart-${index + 1}.png`)));
const sheetRels = parseXml(entries.get('xl/worksheets/_rels/sheet1.xml.rels'), 'worksheet drawing relationship');
assert.equal(sheetRels.getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship')[0].getAttribute('Target'),
'../drawings/drawing1.xml');
assert.equal(entries.get('xl/workbook.xml').length > 0, true);
assert(entries.has('docProps/core.xml') && entries.has('docProps/app.xml'));

const dashboardDocument = parseXml(entries.get('xl/worksheets/sheet1.xml'), 'Dashboard worksheet');
const dashboardRows = rowsByNumber(dashboardDocument);
for (const label of ['Total Trips', 'Actual Tonnage', 'Avg Tonnage / Trip', 'Avg Turnaround Time', 'Avg Tonnage Variance']) {
  assert(dashboardRows.some(row => cellText(row, 'A') === label), `Dashboard includes ${label}`);
}
assert(dashboardRows.some(row => cellText(row, 'B') === '20'));
assert(dashboardRows.some(row => cellText(row, 'D').includes('7 paired trips')));
assert(dashboardRows.some(row => cellText(row, 'B').includes('Quarry & <North>')));

const chartDataDocument = parseXml(entries.get('xl/worksheets/sheet2.xml'), 'Chart Data worksheet');
const chartDataRows = rowsByNumber(chartDataDocument);
assert(chartDataRows.some(row => `${cellText(row, 'A')} ${cellText(row, 'B')}`.toLowerCase().includes('top 10')));
assert(chartDataRows.some(row => cellText(row, 'A') === '=HYPERLINK("https://bad.example")<&"'));
assert.equal(chartDataDocument.getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'f').length, 0, 'strings are never serialized as formula cells');
assert(Array.from(chartDataDocument.getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'c')).some(cell =>
  cell.getAttribute('t') === 'inlineStr' && cellText(cell.parentElement, cell.getAttribute('r').match(/^[A-Z]+/)[0]).startsWith('=')));
const nullAggregateRow = chartDataRows.find(row => cellText(row, 'A') === dateList[2]
  && cellText(row, 'C') === 'No data' && cellText(row, 'E') === 'No data');
assert(nullAggregateRow, 'null tonnage aggregates have explicit availability labels');
for (const reference of ['B', 'D']) {
  const nullCell = Array.from(nullAggregateRow.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'c'))
    .find(cell => cell.getAttribute('r')?.startsWith(reference));
  assert(nullCell);
  assert.equal(nullCell.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'v').length, 0,
    `${reference} null aggregate is a blank numeric cell`);
}
assert(chartDataRows.some(row => cellText(row, 'A') === dateList[2] && cellText(row, 'B') === '4'),
  'numeric aggregate counts remain numeric cells');
assert(entries.has('xl/media/chart-1.png'));
console.log('PASS three sheets, KPI/sample values, multiple image anchors/relationships, numeric/null cells, XML escaping, and formula safety');

const emptyData = {
  ...data,
  performance: { ...data.performance, entity_count: 0, items: [] },
  status_distributions: { ...data.status_distributions, exception: { denominator: 0, slices: [] } },
  variance: { ...data.variance, paired_trip_count: 0, average_variance_tonnes: null, total_variance_tonnes: null,
    estimate_coverage: 0, daily: dateList.map(date => ({ date, variance_tonnes: null, paired_trip_count: 0 })), trucks: [] },
  driver_performance_daily: { selected_driver_id: null, days: [] },
};
const emptyModel = modelModule.buildAnalyticsWorkbookModel({ data: emptyData, filters: { period: '7_days' },
  filterLabels: {}, selections: { ...selections, statusCohort: 'exception' }, exportedAt: new Date('2026-10-12T12:30:00.000Z') });
assert.equal(emptyModel.charts.find(chart => chart.key === 'performance').hasChart, false);
assert.equal(emptyModel.charts.find(chart => chart.key === 'driver-daily').hasChart, false);
assert.match(emptyModel.charts.find(chart => chart.key === 'status-distribution').note, /No exception status records/);
assert.match(emptyModel.charts.find(chart => chart.key === 'variance-trucks').note, /No trucks/);
for (const chart of emptyModel.charts) if (chart.hasChart) chart.image = { bytes: image, widthPx: 640, heightPx: 320 };
const emptyEntries = packageEntries(writer.createAnalyticsXlsxBytes(emptyModel));
const emptyChartSheet = parseXml(emptyEntries.get('xl/worksheets/sheet2.xml'), 'empty Chart Data worksheet');
assert(Array.from(emptyChartSheet.getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 't')).some(cell => cell.textContent.startsWith('No data:')));
console.log('PASS empty cohorts, explicit no-data notes, and still-exportable sparse dashboards');

const longLabelData = { ...data, performance: { ...data.performance, items: [
  { ...data.performance.items[0], label: `Long ${'label '.repeat(6000)}` }, ...data.performance.items.slice(1),
] } };
const longModel = modelModule.buildAnalyticsWorkbookModel({ data: longLabelData, filters, filterLabels, selections,
  exportedAt: new Date('2026-10-12T12:30:00.000Z') });
for (const chart of longModel.charts) if (chart.hasChart) chart.image = { bytes: image, widthPx: 640, heightPx: 320 };
const longEntries = packageEntries(writer.createAnalyticsXlsxBytes(longModel));
const longSheet = parseXml(longEntries.get('xl/worksheets/sheet2.xml'), 'long-label Chart Data worksheet');
const longText = Array.from(longSheet.getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 't')).find(cell => cell.textContent.startsWith('Long ')).textContent;
assert.equal(longText.length, 32767);
assert(longText.endsWith('...'), 'Excel-length labels are visibly truncated');
assert(!new TextDecoder().decode(longEntries.get('xl/worksheets/sheet2.xml')).includes('<script>'));
console.log('PASS long labels and XML-special characters remain safe within Excel cell limits');

const view = load('src/features/operations/analytics/OperationsAnalytics.tsx');
const viewProps = {
  state: { status: 'ready', data }, filters, options: {}, selectedOptions: { driver: { id: 'private-selected-driver-id', label: 'Driver "A"', is_active: true } },
  optionsLoading: {}, optionsError: {}, today: dateList.at(-1), ...selections,
  exporting: false, exportError: '', onExport() {}, onChangeFilters() {}, onSearchOptions() {}, onSelectOption() {},
  onRetryOptions() {}, onResetFilters() {}, onDimension() {}, onMetric() {}, onDriverMetric() {},
  onSummaryGranularity() {}, onSummaryMetric() {}, onStatusCohort() {}, onRetry() {},
};
const renderView = props => renderToStaticMarkup(React.createElement(view.OperationsAnalyticsView, props));
const loadingHtml = renderView({ ...viewProps, state: { status: 'loading' } });
assert.match(loadingHtml, /<button[^>]*disabled=""[^>]*>Export Excel<\/button>/);
const readyHtml = renderView(viewProps);
assert.match(readyHtml, /<button[^>]*>Export Excel<\/button>/);
assert.equal((readyHtml.match(/data-analytics-chart-export=/g) ?? []).length, 8);
assert(readyHtml.includes('value="average_turnaround_seconds" selected=""'));
assert(readyHtml.includes('value="actual_tonnage_tonnes" selected=""'));
assert(readyHtml.includes('aria-pressed="true"'));
assert(readyHtml.includes('<span>Exception Status</span>'));
const exportingHtml = renderView({ ...viewProps, exporting: true });
assert.match(exportingHtml, /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>Exporting…<\/button>/);
const exportErrorHtml = renderView({ ...viewProps, exportError: 'Analytics export failed: chart capture failed.' });
assert(exportErrorHtml.includes('role="alert"'));
assert(exportErrorHtml.includes('Analytics export failed: chart capture failed.'));
const exporter = load('src/features/operations/analytics/analyticsExport.ts');
const emptyRoot = new JSDOM('<div class="analytics-results"></div>').window.document.querySelector('div');
await assert.rejects(() => exporter.exportAnalyticsWorkbook({ results: emptyRoot, data, filters, filterLabels, selections }),
  /visible Analytics chart set changed/);
const integrationSource = readFileSync('src/features/operations/analytics/OperationsAnalytics.tsx', 'utf8');
assert.match(integrationSource, /catch \(error\)[\s\S]*setExportError/);
assert.match(integrationSource, /finally \{[\s\S]*setExporting\(false\)/);
console.log('PASS Analytics UI loading/exporting/error states, selected controls, and explicit chart-capture failure');
