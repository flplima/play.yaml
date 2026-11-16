# Third-party notices

The studio (`packages/web`) loads these libraries in the browser. play.yaml
itself is MIT licensed (see `LICENSE`).

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
