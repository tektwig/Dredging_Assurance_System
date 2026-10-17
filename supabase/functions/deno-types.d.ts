declare namespace Deno {
  namespace env {
    function get(name: string): string | undefined;
  }
  function readFile(path: URL | string): Promise<Uint8Array>;
  function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

declare module 'npm:pdf-lib@1.17.1' {
  export const StandardFonts: { Helvetica: string; HelveticaBold: string };
  export function rgb(red: number, green: number, blue: number): unknown;
  export class PDFFont {
    encodeText(text: string): unknown;
    widthOfTextAtSize(text: string, size: number): number;
  }
  export class PDFImage {
    scaleToFit(width: number, height: number): { width: number; height: number };
  }
  export class PDFPage {
    drawText(text: string, options: { x: number; y: number; size: number; font: PDFFont; color?: unknown }): void;
    drawRectangle(options: { x: number; y: number; width: number; height: number; color?: unknown;
      borderColor?: unknown; borderWidth?: number }): void;
    drawImage(image: PDFImage, options: { x: number; y: number; width: number; height: number }): void;
    drawLine(options: { start: { x: number; y: number }; end: { x: number; y: number };
      thickness: number; color?: unknown }): void;
  }
  export class PDFDocument {
    static create(): Promise<PDFDocument>;
    embedFont(font: string): Promise<PDFFont>;
    embedJpg(image: Uint8Array): Promise<PDFImage>;
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
