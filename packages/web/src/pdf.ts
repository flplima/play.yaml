/**
 * pdf.ts: OSMD's SVG pages as a vector PDF.
 *
 * jsPDF makes the document and svg2pdf.js draws each page's SVG into it as
 * paths and text, so the file stays sharp at any zoom and small. Both are
 * loaded with `import()` on the first PDF, like OSMD itself.
 */
import { PAGE_HEIGHT, PAGE_WIDTH } from './score';

/** A4 in PDF points. */
const A4_W = 595.28;
const A4_H = 841.89;

/**
 * OSMD's SVG is written for a browser, and svg2pdf is stricter. Three things
 * would otherwise go wrong, all found by looking at the PDF:
 *
 * - The tempo mark ("= 100") is a text with `font-family="times"`, a size in
 *   `pt`, `xml:space="preserve"` and a leading space. svg2pdf drops it whole.
 *   Written as a plain Times text in pixels it prints; the note it follows is
 *   an ordinary path, so no music font is needed.
 * - Clef changes that OSMD hides are filled `#12345600`, transparent in a
 *   browser. svg2pdf ignores the alpha byte and prints them dark blue.
 */
function mendForPdf(svg: SVGElement): void {
  svg.querySelectorAll('text').forEach((text) => {
    const family = text.getAttribute('font-family');
    if (family === 'times') text.setAttribute('font-family', 'Times New Roman');
    const size = text.getAttribute('font-size') ?? '';
    const px = size.endsWith('pt') ? (parseFloat(size) * 4) / 3 : parseFloat(size);
    if (size.endsWith('pt')) text.setAttribute('font-size', `${px}px`);
    text.removeAttribute('xml:space');
    const content = text.textContent ?? '';
    const lead = content.length - content.trimStart().length;
    if (lead > 0) {
      // The leading space is what separates "= 100" from its note; a space is a quarter em wide.
      text.textContent = content.trimStart();
      text.setAttribute('x', String(parseFloat(text.getAttribute('x') ?? '0') + lead * px * 0.25));
    }
  });
  svg.querySelectorAll('[fill="#12345600"]').forEach((el) => el.remove());
}

export async function scorePdf(pages: string[], title?: string): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  if (title) doc.setProperties({ title });

  // svg2pdf reads computed styles, so the page has to be in the document. It
  // sits off screen and is gone before this returns.
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT}px;color:#000;`;
  document.body.appendChild(host);
  try {
    for (let i = 0; i < pages.length; i++) {
      // The pages carry a viewBox only, so they scale with their card; svg2pdf
      // needs a size to map onto the sheet.
      host.innerHTML = pages[i].replace('<svg ', `<svg width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" `);
      mendForPdf(host.firstElementChild as SVGElement);
      if (i > 0) doc.addPage();
      await svg2pdf(host.firstElementChild as SVGElement, doc, { x: 0, y: 0, width: A4_W, height: A4_H });
    }
  } finally {
    host.remove();
  }
  return doc.output('blob');
}
