// Extracts numbered practical aims from the text of a practical-list PDF.
// Shared by the browser app (text from pdf.js) and the Node tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PRB = Object.assign(root.PRB || {}, { aims: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Joins pdf.js text items into lines. `pages` is one array of items per page, as
   * returned by page.getTextContent().items ({ str, hasEOL, transform }).
   */
  function textFromPdfItems(pages) {
    return pages.map((items) => {
      let out = "";
      let lastY = null;
      for (const it of items) {
        const y = it.transform ? it.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
        out += it.str;
        if (it.hasEOL) out += "\n";
        if (y !== null) lastY = y;
      }
      return out;
    }).join("\n");
  }

  // Matches lines like: "Practical 6:", "6.", "6)", "Aim 6:", "6 -" at the start of an entry.
  const NUM_LINE = /^\s*(?:practical|aim|exp(?:eriment)?)?\s*[:\-]?\s*(\d{1,3})\s*[.:\-)]\s*(.*)$/i;
  // Table-style lists with no separator: "31 Write a C++ program ...", "Practical 6 Write ...",
  // or the number alone on its line when it sits in its own table cell.
  const BARE_NUM_LINE = /^\s*(?:(?:practical|aim|exp(?:eriment)?)\s*(?:no\.?)?\s*)?(\d{1,3})(?:\s+([A-Za-z(“"'].*))?\s*$/i;

  // A bare number could just be a wrapped line ("10 numbers are entered..."), so only
  // treat it as a new entry when it continues the numbering of the previous entry.
  function continuesNumbering(num, prev) {
    return prev === null || (num > prev && num <= prev + 3);
  }

  function parsePracticalsFromText(text) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => !/^--\s*\d+\s*of\s*\d+\s*--$/.test(l))
      .filter((l) => !/^page\s*\d+(\s*of\s*\d+)?$/i.test(l));

    const entries = [];
    let current = null;

    for (const line of lines) {
      let m = line.match(NUM_LINE);
      if (!m) {
        const b = line.match(BARE_NUM_LINE);
        if (b && continuesNumbering(parseInt(b[1], 10), current ? current.number : null)) m = b;
        else if (b && !b[2]) continue; // a lone number that breaks the sequence: a page number
      }
      if (m) {
        const num = parseInt(m[1], 10);
        const rest = (m[2] || "").trim();
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

  return { parsePracticalsFromText, textFromPdfItems };
});
