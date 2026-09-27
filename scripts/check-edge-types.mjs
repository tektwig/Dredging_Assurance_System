// Type-check the dependency-free worker with the installed TypeScript compiler.
// Minimal Deno host declarations allow local checking without downloading Deno.
import ts from 'typescript';

const virtualPath = '/__dredging_deno_host.d.ts';
const declaration = `declare namespace Deno {
  namespace env { function get(name: string): string | undefined; }
  function serve(handler: (request: Request) => Response | Promise<Response>): void;
}
declare module 'npm:pdf-lib@1.17.1' {
  export const StandardFonts: { Helvetica: string; HelveticaBold: string };
  export function rgb(red: number, green: number, blue: number): unknown;
  export class PDFFont {
    encodeText(text: string): unknown;
    widthOfTextAtSize(text: string, size: number): number;
  }
  export class PDFPage {
    drawText(text: string, options: { x: number; y: number; size: number; font: PDFFont; color?: unknown }): void;
  }
  export class PDFDocument {
    static create(): Promise<PDFDocument>;
    embedFont(font: string): Promise<PDFFont>;
    addPage(size: [number, number]): PDFPage;
    setTitle(title: string): void;
    setSubject(subject: string): void;
    setAuthor(author: string): void;
    setCreationDate(date: Date): void;
    setModificationDate(date: Date): void;
    save(options: { useObjectStreams: boolean }): Promise<Uint8Array>;
  }
}`;
const options = {
  noEmit: true, strict: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true, skipLibCheck: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [],
};
const host = ts.createCompilerHost(options);
const originalGetSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (fileName, ...args) => fileName === virtualPath
  ? ts.createSourceFile(fileName, declaration, ts.ScriptTarget.ES2022, true)
  : originalGetSourceFile(fileName, ...args);
const program = ts.createProgram([
  virtualPath,
  'supabase/functions/process-trip-notifications/index.ts',
  'supabase/functions/process-trip-notifications/worker.ts',
  'supabase/functions/process-waybill-pdfs/index.ts',
  'supabase/functions/process-waybill-pdfs/worker.ts',
  'supabase/functions/process-waybill-pdfs/pdf.ts',
], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: name => name, getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else console.log('PASS Edge Function TypeScript check (minimal Deno host declarations; not Deno runtime validation)');
