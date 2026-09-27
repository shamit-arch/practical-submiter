// Builds the practical-file Word document. Shared by the browser app (docx loaded as a
// global from vendor/docx.js) and Node (require("docx")). Returns an ArrayBuffer.
//
// images: { data: ArrayBuffer|Uint8Array, type: "png"|"jpg"|"gif"|"bmp", meta: { width, height } }
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(() => require("docx"));
  else root.PRB = Object.assign(root.PRB || {}, { document: factory(() => root.docx) });
})(typeof self !== "undefined" ? self : this, function (getDocx) {
  "use strict";

  function make(docx) {
    const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer, BorderStyle, AlignmentType, WidthType, PageNumber, TabStopType, VerticalAlign, } = docx;

    const FONT = "Times New Roman";
    const PAGE = { width: 11906, height: 16838 }; // A4 in twips
    const MARGIN = { top: 1080, bottom: 1080, left: 1440, right: 1080, header: 567, footer: 567 };
    const USABLE_TWIPS = PAGE.width - MARGIN.left - MARGIN.right;
    const PX_PER_TWIP = 96 / 1440;
    const MAX_IMG_W = Math.floor(USABLE_TWIPS * PX_PER_TWIP);
    // leave room for header/footer and a heading above the image
    const MAX_IMG_H = Math.floor((PAGE.height - MARGIN.top - MARGIN.bottom - 1700) * PX_PER_TWIP);

    const pt = (n) => n * 2; // docx sizes are half-points

    function fit({ width, height }) {
      const s = Math.min(1, MAX_IMG_W / width, MAX_IMG_H / height);
      return { width: Math.round(width * s), height: Math.round(height * s) };
    }

    function text(t, opts = {}) {
      return new TextRun({ text: t, font: FONT, size: pt(12), ...opts });
    }

    function imageParagraph(img, caption) {
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: caption ? 40 : 160 },
          keepNext: !!caption,
          children: [
            new ImageRun({
              data: img.data,
              type: img.type,
              transformation: fit(img.meta),
              outline: { type: "solidFill", solidFillType: "rgb", value: "808080", width: 9525 },
            }),
          ],
        }),
        ...(caption
          ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [text(caption, { italics: true, size: pt(10), color: "555555" })] })]
          : []),
      ];
    }

    function sectionLabel(label) {
      return new Paragraph({
        spacing: { before: 240, after: 80 },
        keepNext: true,
        children: [text(label, { bold: true, underline: {} })],
      });
    }

    const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

    function cell(content, widthPct, opts = {}) {
      return new TableCell({
        width: { size: widthPct, type: WidthType.PERCENTAGE },
        borders,
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: opts.header ? { fill: "E7E6E6" } : undefined,
        children: [new Paragraph({ alignment: opts.align || AlignmentType.LEFT, children: [text(content, { bold: !!opts.header, size: pt(11) })] })],
      });
    }

    function coverAndIndex({ name, batch, enrollment, subject, institute, practicals }) {
      const out = [];
      if (institute) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [text(institute, { bold: true, size: pt(18) })] }));
      if (subject) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [text(subject, { bold: true, size: pt(15) })] }));
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 360 }, children: [text("PRACTICAL FILE", { bold: true, size: pt(14), characterSpacing: 40 })] }));

      const detail = (k, v) => new TableRow({ children: [cell(k, 35, { header: true }), cell(v || "", 65)] });
      out.push(new Table({
        width: { size: 70, type: WidthType.PERCENTAGE },
        alignment: AlignmentType.CENTER,
        rows: [detail("Name", name), detail("Class / Batch", batch), detail("Enrollment No.", enrollment)],
      }));

      out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480, after: 200 }, children: [text("INDEX", { bold: true, size: pt(14), underline: {} })] }));
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: [cell("Sr. No.", 9, { header: true, align: AlignmentType.CENTER }), cell("Practical", 61, { header: true }), cell("Date", 15, { header: true, align: AlignmentType.CENTER }), cell("Sign", 15, { header: true, align: AlignmentType.CENTER })] }),
          ...practicals.map((p) => new TableRow({
            cantSplit: true,
            children: [cell(String(p.number), 9, { align: AlignmentType.CENTER }), cell(p.aim || `Practical ${p.number}`, 61), cell("", 15), cell("", 15)],
          })),
        ],
      }));
      return out;
    }

    // Compact heading used when no cover/index page is wanted (matches the college reference layout).
    function compactHeading({ name, batch, enrollment }) {
      const out = [
        new Paragraph({
          children: [text(`Name : ${name}${batch ? ` (${batch})` : ""}`, { bold: true })],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "auto" } },
        }),
      ];
      if (enrollment) out.push(new Paragraph({ children: [text(`Enrollment No : ${enrollment}`, { bold: true })] }));
      out.push(new Paragraph({ children: [] }));
      return out;
    }

    function practicalBlock(p, { captions, pageBreakBefore }) {
      const out = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          keepNext: true,
          pageBreakBefore,
          children: [text(`Practical ${p.number}`, { bold: true, size: pt(14), underline: {} })],
        }),
      ];
      const aim = (p.aim || "").trim();
      out.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 160, line: 300 },
        keepNext: true,
        children: [text("Aim: ", { bold: true }), text(aim || "_______________________________________________")],
      }));

      let fig = 1;
      if (p.codeImages.length) {
        out.push(sectionLabel("Source Code:"));
        p.codeImages.forEach((img, i) => out.push(...imageParagraph(img, captions ? `Fig. ${p.number}.${fig++}: Source code${p.codeImages.length > 1 ? ` (part ${i + 1})` : ""}` : null)));
      }
      if (p.outputImages.length) {
        out.push(sectionLabel("Output:"));
        p.outputImages.forEach((img, i) => out.push(...imageParagraph(img, captions ? `Fig. ${p.number}.${fig++}: Output${p.outputImages.length > 1 ? ` (${i + 1})` : ""}` : null)));
      }
      return out;
    }

    /**
     * @param {object} opts
     * @param {string} opts.name
     * @param {string} [opts.batch]
     * @param {string} [opts.enrollment]
     * @param {string} [opts.subject]
     * @param {string} [opts.institute]
     * @param {boolean} [opts.includeIndex]   cover + index table on page 1
     * @param {boolean} [opts.newPagePerPractical]
     * @param {boolean} [opts.captions]       "Fig. 3.1: Source code" under images
     * @param {{number:number, aim:string, codeImages:object[], outputImages:object[]}[]} opts.practicals
     */
    function buildDocument(opts) {
      const { name, enrollment, subject, practicals, includeIndex = true, newPagePerPractical = true, captions = false } = opts;
      const children = includeIndex ? coverAndIndex(opts) : compactHeading(opts);

      practicals.forEach((p, i) => {
        const pageBreakBefore = includeIndex ? i === 0 || newPagePerPractical : i > 0 && newPagePerPractical;
        if (!pageBreakBefore && i > 0) children.push(new Paragraph({ spacing: { before: 240 }, children: [] }));
        children.push(...practicalBlock(p, { captions, pageBreakBefore }));
      });

      const headerLeft = subject || "Practical File";
      const header = new Header({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: USABLE_TWIPS }],
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 4, color: "999999" } },
          children: [text(headerLeft, { size: pt(9), color: "555555" }), text(`\t${enrollment ? `Enrollment No: ${enrollment}` : name}`, { size: pt(9), color: "555555" })],
        })],
      });
      const footer = new Footer({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: USABLE_TWIPS }],
          border: { top: { style: BorderStyle.SINGLE, size: 4, space: 4, color: "999999" } },
          children: [
            text(name, { size: pt(9), color: "555555" }),
            new TextRun({ children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: FONT, size: pt(9), color: "555555" }),
          ],
        })],
      });

      const doc = new Document({
        creator: name,
        title: `${subject ? subject + " – " : ""}Practical File`,
        styles: { default: { document: { run: { font: FONT, size: pt(12) } } } },
        sections: [{
          properties: { page: { size: PAGE, margin: MARGIN } },
          headers: { default: header },
          footers: { default: footer },
          children,
        }],
      });
      return Packer.toArrayBuffer(doc);
    }

    return buildDocument;
  }

  /**
   * @param {object} opts see buildDocument options below
   * @param {object} [docxLib] the docx library (defaults to the global/required one)
   * @returns {Promise<ArrayBuffer>}
   */
  function buildDocument(opts, docxLib) {
    return make(docxLib || getDocx())(opts);
  }

  return { buildDocument };
});
