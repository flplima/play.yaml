// svg-to-pdfkit ships no types. pdf.ts uses only the call typed here.
declare module 'svg-to-pdfkit' {
  const SVGtoPDF: (doc: unknown, svg: string, x: number, y: number, options?: Record<string, unknown>) => void;
  export default SVGtoPDF;
}
