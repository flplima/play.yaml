# Third-party notices

The studio (`packages/web`) loads these libraries in the browser. play.yaml
itself is MIT licensed (see `LICENSE`). The command line's own dependencies
are at the end.

## OpenSheetMusicDisplay

- Version 2.3.1, npm package `opensheetmusicdisplay`. Licence: BSD
  3-Clause "New" or "Revised" (BSD-3-Clause), copyright 2019 PhonicScore.
  https://github.com/opensheetmusicdisplay/opensheetmusicdisplay
- Draws the Score tab. Loaded with `import()` only when the Score tab opens
  (or a PDF is made), as its own file in the studio build
  (`assets/opensheetmusicdisplay.min-*.js`).
- Its published browser build has these runtime dependencies compiled in,
  so they ship inside that same file:

### VexFlow

- Version 1.2.93, npm package `vexflow`. MIT licence, copyright 2010 Mohit
  Muthanna Cheppudira. https://github.com/0xfe/vexflow
- Does the actual drawing of staves, notes and beams to SVG.

### JSZip

- Version 3.10.2, npm package `jszip`. Dual licensed "MIT OR GPL-3.0-or-later";
  it is used here under the MIT licence, copyright 2009-2016 Stuart Knightley,
  David Duponchel, Franz Buchinger and António Afonso.
  https://github.com/Stuk/jszip
- Reads compressed MusicXML. Its browser build embeds pako (MIT and zlib
  licences, copyright 2014-2017 Vitaly Puzrin and Andrei Tuputcyn).

### loglevel

- Version 1.9.2, npm package `loglevel`. MIT licence, copyright 2013 Tim
  Perry. https://github.com/pimterry/loglevel

### typescript-collections

- Version 1.3.3, npm package `typescript-collections`. MIT licence,
  copyright 2010-2017 Tomasz Ciborski.
  https://github.com/basarat/typescript-collections

## jsPDF

- Version 4.2.1, npm package `jspdf`. MIT licence, copyright 2010-2025 James
  Hall and 2015-2025 yWorks GmbH. https://github.com/parallax/jsPDF
- Builds the PDF file. Loaded only when a PDF is made. Its own
  dependencies (`fast-png`, `@babel/runtime`, `fflate`, MIT) and optional
  ones (`dompurify`, `html2canvas`, `canvg`, `core-js`) come along as
  separate lazy chunks; `dompurify` is MPL-2.0 or Apache-2.0,
  the others MIT.

## svg2pdf.js

- Version 2.9.0, npm package `svg2pdf.js`. MIT licence, copyright 2015-2026
  yWorks GmbH and 2013-2015 Vitaly Puzrin. https://github.com/yWorks/svg2pdf.js
- Draws the engraved SVG pages into the PDF as vectors. Loaded only when a
  PDF is made.

## Paper Mono

- Variable webfont `PaperMono[wght].woff2`, self-hosted as
  `packages/web/public/fonts/PaperMono-Variable.woff2`. Licence: SIL Open Font
  License 1.1, copyright 2025 The Paper-Mono.Git Project Authors. The full
  text is next to the font, in `PaperMono-OFL.txt`.
  https://github.com/paper-design/paper-mono
- The font of the whole studio: interface, editor and canvases. The engraved
  sheet music keeps its own music fonts.

## The command line (`packages/cli`)

The cli does not bundle these. npm installs them as normal dependencies, each
with its own licence file, and they load only when a PDF is written.

- `opensheetmusicdisplay` 2.3.1, BSD-3-Clause (see above). Engraves the pages.
- `jsdom` 31, MIT. https://github.com/jsdom/jsdom (the page model OpenSheetMusicDisplay draws into, since Node has no browser)
- `pdfkit` 0.20, MIT. https://github.com/foliojs/pdfkit
- `svg-to-pdfkit` 0.1, MIT. https://github.com/alafr/SVG-to-PDFKit
