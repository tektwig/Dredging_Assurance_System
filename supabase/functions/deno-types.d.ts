declare namespace Deno {
  namespace env {
    function get(name: string): string | undefined;
  }
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
}

declare module 'https://*' {
  const content: any;
  export default content;
  export const serve: any;
  export const createClient: any;
  export const corsHeaders: any;
  export const Status: any;
  export const STATUS_TEXT: any;
}
