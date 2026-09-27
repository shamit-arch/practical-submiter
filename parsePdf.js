#!/usr/bin/env node
// Node helper to check what the app will extract from a practical-list PDF:
//   node parsePdf.js "Practical List.pdf"
// Uses the same pdf.js text extraction and aim parser as the browser app.
const fs = require("fs");
const { parsePracticalsFromText, textFromPdfItems } = require("./public/lib/aims");

async function extractAimsFromPdf(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items);
  await doc.destroy();
  return parsePracticalsFromText(textFromPdfItems(pages));
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node parsePdf.js "Practical List.pdf"');
    process.exit(1);
  }
  extractAimsFromPdf(fs.readFileSync(file)).then((aims) => {
    const nums = Object.keys(aims);
    console.log(`${nums.length} aim(s) found`);
    for (const n of nums) console.log(`${n}: ${aims[n]}`);
  });
}

module.exports = { extractAimsFromPdf, parsePracticalsFromText };
