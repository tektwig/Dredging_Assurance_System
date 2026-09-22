// Type-check the dependency-free worker with the installed TypeScript compiler.
// Minimal Deno host declarations allow local checking without downloading Deno.
import ts from 'typescript';

const virtualPath = '/__dredging_deno_host.d.ts';
const declaration = 'declare namespace Deno { namespace env { function get(name: string): string | undefined; } function serve(handler: (request: Request) => Response | Promise<Response>): void; }';
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
], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: name => name, getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else console.log('PASS Edge Function TypeScript check (minimal Deno host declarations; not Deno runtime validation)');
