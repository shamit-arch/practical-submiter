const { PDFParse } = require("pdf-parse");

// Matches lines like: "Practical 6:", "6.", "6)", "Aim 6:", "6 -" at the start of an entry.
const NUM_LINE = /^\s*(?:practical|aim|exp(?:eriment)?)?\s*[:\-]?\s*(\d{1,3})\s*[.:\-)]\s*(.*)$/i;

function parsePracticalsFromText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^--\s*\d+\s*of\s*\d+\s*--$/.test(l));

  const entries = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(NUM_LINE);
    if (m) {
      const num = parseInt(m[1], 10);
      const rest = m[2].trim();
      current = { number: num, lines: rest ? [rest] : [] };
      entries.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  const map = {};
  for (const e of entries) {
    const text = e.lines.join(" ").replace(/\s+/g, " ").trim();
    if (text) map[e.number] = text;
  }
  return map;
}

async function extractAimsFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return parsePracticalsFromText(result.text);
}

module.exports = { extractAimsFromPdf, parsePracticalsFromText };
