# Local PDF preview

Oscar includes a passive canvas renderer built from Mozilla PDF.js **6.4.299**,
the stable release published on 3 October 2026:
https://github.com/mozilla/pdf.js/releases/tag/v6.4.299

Official npm package:
https://registry.npmjs.org/pdfjs-dist/6.4.299

Archive:
https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz

The archive was verified against its official npm SHA-512 integrity before
extracting the files included here:

`sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`

The exact filenames, sizes and SHA-256 digests are recorded in
`public/vendor/pdfjs/6.4.299/manifest.json`. The server checks every runtime file
before it starts and exposes only the listed rendering assets. The original
legacy builds are used unchanged. No package installation, CDN or external
service is needed while previewing a document.

PDF.js is distributed under Apache License 2.0. Its full license is retained at
`public/vendor/pdfjs/6.4.299/LICENSE`. The included standard fonts, character maps
and image decoding fallbacks retain their original accompanying licenses:
`cmaps/LICENSE`, `standard_fonts/LICENSE_FOXIT`,
`standard_fonts/LICENSE_LIBERATION`, and the `wasm/LICENSE_*` files.

Only the display library, worker, CMaps, standard fonts and two image decoding
fallbacks are included. The PDF scripting sandbox, QuickJS and PDF viewer UI are
not included. WebAssembly is disabled for this preview. PDF JavaScript is not
run; forms, links, annotations and attachments receive no interactive DOM.
Existing annotation appearances may be drawn as pixels on the page.

The preview receives already validated document bytes from the mission's file
route. It renders one page at a time, at most 4,000,000 canvas pixels and 200
navigable pages, with a twenty-second limit for each load or render operation.
The dedicated worker is terminated on close, cancellation or timeout. The full
original file remains available through download and native application actions.
