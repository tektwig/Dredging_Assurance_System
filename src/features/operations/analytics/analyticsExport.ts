import type { AnalyticsOptionKind, OperationsAnalyticsData } from '../services/operationsAnalytics';
import {
  analyticsExportFilename,
  buildAnalyticsWorkbookModel,
  type AnalyticsExportSelections,
  type AnalyticsWorkbookModel,
} from './analyticsExportModel';
import { createAnalyticsXlsxBytes } from './analyticsXlsxWriter';

type AnalyticsWorkbookRequest = {
  results: HTMLDivElement;
  data: OperationsAnalyticsData;
  filters: Parameters<typeof buildAnalyticsWorkbookModel>[0]['filters'];
  filterLabels: Partial<Record<AnalyticsOptionKind, string>>;
  selections: AnalyticsExportSelections;
};

type ChartSnapshot = { chartIndex: number; svg: string; width: number; height: number };

const svgStyleProperties = [
  'color', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'letter-spacing', 'visibility', 'display', 'shape-rendering', 'vector-effect',
];

function isVisible(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  let current: HTMLElement | null = element;
  while (current) {
    const style = view.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
      || style.opacity === '0') return false;
    current = current.parentElement;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function serializeStyledSvg(svg: SVGSVGElement, width: number, height: number): string {
  const document = svg.ownerDocument;
  const view = document.defaultView;
  const Serializer = view?.XMLSerializer;
  if (!view || !Serializer) throw new Error('This browser cannot serialize chart images.');
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const sourceNodes = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const clonedNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (let index = 0; index < sourceNodes.length; index += 1) {
    const computed = view.getComputedStyle(sourceNodes[index]);
    const styles = svgStyleProperties.map(property => {
      const value = computed.getPropertyValue(property);
      return value ? `${property}:${value}` : '';
    }).filter(Boolean).join(';');
    if (styles) clonedNodes[index].setAttribute('style', styles);
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', `${width}px`);
  clone.setAttribute('height', `${height}px`);
  if (!clone.hasAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return new Serializer().serializeToString(clone);
}

async function svgToPng(svgMarkup: string, width: number, height: number, document: Document): Promise<Uint8Array> {
  const view = document.defaultView;
  if (!view || typeof view.URL.createObjectURL !== 'function') {
    throw new Error('This browser cannot create chart image URLs.');
  }
  const scale = Math.min(2, 4096 / width, 4096 / height, Math.sqrt(16777216 / (width * height)));
  const canvasWidth = Math.max(1, Math.round(width * scale));
  const canvasHeight = Math.max(1, Math.round(height * scale));
  const imageUrl = view.URL.createObjectURL(new view.Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new view.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The chart SVG could not be rendered.'));
      image.src = imageUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create a chart image canvas.');
    context.drawImage(image, 0, 0, canvasWidth, canvasHeight);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('The chart PNG could not be created.')), 'image/png');
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    view.URL.revokeObjectURL(imageUrl);
  }
}

function collectChartSnapshots(results: HTMLDivElement, model: AnalyticsWorkbookModel): ChartSnapshot[] {
  const wrappers = Array.from(results.querySelectorAll<HTMLElement>('[data-analytics-chart-export]'));
  const wrapperByKey = new Map(wrappers.map(wrapper => [wrapper.dataset.analyticsChartExport ?? '', wrapper]));
  if (wrapperByKey.size !== model.charts.length || model.charts.some(chart => !wrapperByKey.has(chart.key))) {
    throw new Error('The visible Analytics chart set changed; reload the dashboard and try again.');
  }
  const snapshots: ChartSnapshot[] = [];
  for (const [chartIndex, chart] of model.charts.entries()) {
    const wrapper = wrapperByKey.get(chart.key)!;
    if (!isVisible(wrapper)) throw new Error(`The ${chart.title} chart is not visible; export was stopped.`);
    const svg = wrapper.querySelector<SVGSVGElement>('.analytics-chart svg');
    if (!chart.hasChart) {
      const explanation = wrapper.querySelector('[role="status"]')?.textContent?.trim();
      if (svg || !explanation) throw new Error(`The ${chart.title} no-data state changed; export was stopped.`);
      chart.note = explanation;
      continue;
    }
    if (!svg || !isVisible(svg as unknown as HTMLElement)) {
      throw new Error(`The ${chart.title} chart could not be captured; no image was omitted.`);
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error(`The ${chart.title} chart has no renderable dimensions.`);
    snapshots.push({ chartIndex, svg: serializeStyledSvg(svg, rect.width, rect.height), width: rect.width, height: rect.height });
  }
  return snapshots;
}

function download(bytes: Uint8Array, model: AnalyticsWorkbookModel, document: Document) {
  const view = document.defaultView;
  if (!view || typeof view.URL.createObjectURL !== 'function') throw new Error('This browser cannot start the workbook download.');
  const blob = new view.Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = view.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = analyticsExportFilename(model.rangeStart, model.rangeEnd);
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
  }
}

export async function exportAnalyticsWorkbook(request: AnalyticsWorkbookRequest): Promise<void> {
  const model = buildAnalyticsWorkbookModel(request);
  const snapshots = collectChartSnapshots(request.results, model);
  for (const snapshot of snapshots) {
    const chart = model.charts[snapshot.chartIndex];
    try {
      chart.image = {
        bytes: await svgToPng(snapshot.svg, snapshot.width, snapshot.height, request.results.ownerDocument),
        widthPx: snapshot.width,
        heightPx: snapshot.height,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'image conversion failed';
      throw new Error(`${chart.title} chart capture failed: ${reason}`);
    }
  }
  const workbook = createAnalyticsXlsxBytes(model);
  download(workbook, model, request.results.ownerDocument);
}
