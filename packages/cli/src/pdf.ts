/**
 * pdf.ts: MusicXML to a paginated, vector PDF, in plain Node with no browser.
 *
 * OpenSheetMusicDisplay engraves the MusicXML into one SVG per page. It needs
 * a DOM, so jsdom stands in for the browser, and svg-to-pdfkit draws each SVG
 * onto a pdfkit page. The libraries load on first use, so exporting MIDI or
 * MusicXML never pays for them.
 */

export type Paper = 'a4' | 'letter';

/** Page size in points (pdfkit's unit) and OSMD's name for the format. */
const PAPER: Record<Paper, { pt: [number, number]; osmd: string }> = {
  a4: { pt: [595.28, 841.89], osmd: 'A4 P' },
  letter: { pt: [612, 792], osmd: 'Letter P' },
};

/** Width in CSS pixels OSMD lays a page out in (A4 at 96 dpi). The PDF scales it to the paper. */
const PAGE_PX = 794;

export interface PdfResult {
  bytes: Buffer;
  pages: number;
}

/**
 * Engrave `xml` and write it as a PDF. Throws an Error with a readable message
 * when the MusicXML cannot be engraved.
 */
export async function musicXmlToPdf(xml: string, paper: Paper = 'a4'): Promise<PdfResult> {
  const size = PAPER[paper];
  const svgs = await engrave(xml, size.osmd);
  if (svgs.length < 1) throw new Error('could not engrave the score: OpenSheetMusicDisplay produced no pages');

  const [{ default: PDFDocument }, { default: SVGtoPDF }] = await Promise.all([
    import('pdfkit'),
    import('svg-to-pdfkit'),
  ]);
  const doc = new PDFDocument({ size: size.pt, margin: 0, autoFirstPage: false, info: { Creator: 'play.yaml' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  try {
    for (const svg of svgs) {
      doc.addPage({ size: size.pt, margin: 0 });
      SVGtoPDF(doc, fixSvg(svg), 0, 0, {
        width: size.pt[0],
        height: size.pt[1],
        preserveAspectRatio: 'xMidYMin meet',
        // Text is plain Latin: the built-in Times fonts cover the accents.
        fontCallback: (_family: string, bold: boolean, italic: boolean) =>
          bold ? (italic ? 'Times-BoldItalic' : 'Times-Bold') : italic ? 'Times-Italic' : 'Times-Roman',
      });
    }
  } catch (err) {
    throw new Error(`could not draw the PDF: ${err instanceof Error ? err.message : err}`);
  }
  doc.end();
  await done;
  return { bytes: Buffer.concat(chunks), pages: svgs.length };
}

/** Keys of the globals jsdom lends to OSMD while it engraves. */
const BORROWED = ['window', 'document', 'HTMLElement', 'XMLHttpRequest', 'DOMParser', 'Node', 'navigator'] as const;

/** One SVG string per page, from OSMD running on jsdom. */
/**
 * Printed-edition density, as in the studio. Units are OSMD's: one unit is
 * the distance between two staff lines.
 */
function tighten(osmd: { EngravingRules: Record<string, unknown> }): void {
  Object.assign(osmd.EngravingRules, {
    PageLeftMargin: 4,
    PageRightMargin: 4,
    PageTopMargin: 3,
    PageTopMarginNarrow: 2,
    PageBottomMargin: 3,
    SystemLeftMargin: 1,
    TitleTopDistance: 2,
    SheetTitleHeight: 3,
    MinimumDistanceBetweenSystems: 3,
    MinSkyBottomDistBetweenSystems: 3,
    StaffDistance: 4,
    BetweenStaffDistance: 3,
    MinSkyBottomDistBetweenStaves: 1.5,
    MinNoteDistance: 1.5,
  });
}

/** An 8 mm staff on A4, as printed editions use (the studio's zoom). */
const ZOOM = 0.75;

async function engrave(xml: string, pageFormat: string): Promise<string[]> {
  const { JSDOM, VirtualConsole } = await import('jsdom');
  // A silent console: jsdom would print "not implemented" for the canvas it lacks.
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of BORROWED) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value: (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  try {
    // jsdom does no layout: OSMD reads the page width from the element's offsetWidth.
    const proto = dom.window.HTMLElement.prototype;
    for (const [prop, value] of [['offsetWidth', PAGE_PX], ['offsetHeight', PAGE_PX * 1.5], ['offsetLeft', 0], ['offsetTop', 0]] as const) {
      Object.defineProperty(proto, prop, { configurable: true, get: () => value });
    }
    // No native canvas: OSMD only measures text with it, so a stub estimates widths from the font size.
    (dom.window.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => textMeter();
    const container = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(container);

    // Loaded after the globals exist: OSMD reads `window` when it starts.
    const osmdModule = (await import('opensheetmusicdisplay')) as Record<string, any>;
    const { OpenSheetMusicDisplay } = osmdModule.OpenSheetMusicDisplay ? osmdModule : osmdModule.default;
    // These options, the rules in `tighten` and the zoom are the studio's
    // too (packages/web/src/score.ts), so both print the same pages.
    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false,
      backend: 'svg',
      drawingParameters: 'compacttight',
      autoBeam: false,
      drawTitle: true,
      drawPartNames: true,
      pageFormat,
      pageBackgroundColor: '#FFFFFF',
    });
    try {
      await osmd.load(xml);
      tighten(osmd);
      osmd.zoom = ZOOM;
      osmd.render();
    } catch (err) {
      throw new Error(`could not engrave the score: ${err instanceof Error ? err.message : err}`);
    }
    const svgs: string[] = [];
    for (let i = 1; ; i++) {
      const page = dom.window.document.getElementById(`osmdSvgPage${i}`);
      if (!page) break;
      page.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgs.push(page.outerHTML);
    }
    return svgs;
  } finally {
    for (const key of BORROWED) {
      const old = saved.get(key);
      if (old) Object.defineProperty(globalThis, key, old);
      else delete g[key];
    }
    dom.window.close();
  }
}

/** Make one OSMD page drawable by svg-to-pdfkit, which reads attributes but not CSS. */
function fixSvg(svg: string): string {
  return svg.replace(/currentColor/g, '#000000');
}

/** A 2D context that measures text by estimate: 0.5 em per character, 0.55 em for capitals. */
function textMeter() {
  const ctx = {
    font: '10px serif',
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      const bold = /bold/.test(ctx.font) ? 1.05 : 1;
      let em = 0;
      for (const ch of text) em += /[A-Z]/.test(ch) ? 0.68 : /[ iljt.,']/.test(ch) ? 0.3 : 0.5;
      const width = em * px * bold;
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: px * 0.75, actualBoundingBoxDescent: px * 0.25 };
    },
  };
  return ctx;
}
