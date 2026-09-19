const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  BorderStyle, AlignmentType, PageOrientation
} = require("docx");

const PAGE_WIDTH_TWIPS = 11906; // A4
const MARGIN_LEFT = 1080;
const MARGIN_RIGHT = 1080;
const MARGIN_TOP = 1440;
const MARGIN_BOTTOM = 567;

// Usable width in EMU (1 twip = 635 EMU), used to size images full-width like the reference doc.
const USABLE_WIDTH_TWIPS = PAGE_WIDTH_TWIPS - MARGIN_LEFT - MARGIN_RIGHT;
const USABLE_WIDTH_EMU = USABLE_WIDTH_TWIPS * 635;
const EMU_PER_PX = 9525;
const MAX_WIDTH_PX = Math.floor(USABLE_WIDTH_EMU / EMU_PER_PX);

function imageDims(meta) {
  // Scale to full usable width, preserving aspect ratio, unless the image is already narrower.
  const w = Math.min(meta.width, MAX_WIDTH_PX);
  const h = Math.round((w / meta.width) * meta.height);
  return { width: w, height: h };
}

function boldPara(text, extra = {}) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true })],
    ...extra,
  });
}

function buildDocument({ name, batch, enrollment, practicals }) {
  const children = [];

  const nameLine = batch ? `Name : ${name} (${batch})` : `Name : ${name}`;
  children.push(
    new Paragraph({
      children: [new TextRun({ text: nameLine, bold: true })],
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "auto" },
      },
    })
  );
  if (enrollment) {
    children.push(boldPara(`Enrollment No : ${enrollment}`));
  }
  children.push(new Paragraph({ children: [] }));

  for (const p of practicals) {
    children.push(boldPara(`Practical ${p.number}:`));
    const aimLines = (p.aim || "").split("\n").filter((l) => l.trim().length > 0);
    if (aimLines.length === 0) {
      children.push(boldPara(""));
    } else {
      for (const line of aimLines) children.push(boldPara(line));
    }

    for (const img of p.codeImages || []) {
      const dims = imageDims(img.meta);
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: img.buffer,
              transformation: dims,
              type: img.type,
            }),
          ],
        })
      );
    }

    if ((p.outputImages || []).length > 0) {
      children.push(boldPara("Output :"));
      for (const img of p.outputImages) {
        const dims = imageDims(img.meta);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: img.buffer,
                transformation: dims,
                type: img.type,
              }),
            ],
          })
        );
      }
    }

    children.push(new Paragraph({ children: [] }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH_TWIPS, height: 16838 },
            margin: {
              top: MARGIN_TOP,
              right: MARGIN_RIGHT,
              bottom: MARGIN_BOTTOM,
              left: MARGIN_LEFT,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildDocument };
