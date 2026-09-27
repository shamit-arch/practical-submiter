const test = require("node:test");
const assert = require("node:assert");
const JSZip = require("jszip");
const { createCanvas } = require("@napi-rs/canvas");
const { buildDocument } = require("../generate");

function png(w, h, color) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return { data: cv.toBuffer("image/png"), type: "png", meta: { width: w, height: h } };
}

async function documentXml(opts) {
  const buf = await buildDocument(opts);
  const zip = await JSZip.loadAsync(buf);
  return zip.file("word/document.xml").async("string");
}

const base = {
  name: "Test Student",
  batch: "D2D",
  enrollment: "230123456789",
  subject: "Data Structures",
  institute: "Test Institute",
  practicals: [
    { number: 1, aim: "Implement a stack using arrays.", codeImages: [png(800, 600, "#1e1e1e")], outputImages: [png(700, 300, "#000000")] },
    { number: 2, aim: "", codeImages: [], outputImages: [png(600, 400, "#ffffff"), png(600, 400, "#eeeeee")] },
  ],
};

test("cover page lists every practical in the index", async () => {
  const xml = await documentXml(base);
  assert.match(xml, /PRACTICAL FILE/);
  assert.match(xml, /INDEX/);
  assert.match(xml, /Implement a stack using arrays\./);
  assert.match(xml, /Test Institute/);
});

test("each practical has heading, aim, and only the sections it has images for", async () => {
  const xml = await documentXml(base);
  assert.match(xml, /Practical 1/);
  assert.match(xml, /Practical 2/);
  assert.strictEqual((xml.match(/Source Code:/g) || []).length, 1, "practical 2 has no code screenshot");
  assert.strictEqual((xml.match(/Output:/g) || []).length, 2);
  assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, 4);
  assert.strictEqual((xml.match(/<w:pageBreakBefore\/>/g) || []).length, 2);
});

test("tall screenshots are scaled to fit on one page", async () => {
  const xml = await documentXml({ ...base, practicals: [{ number: 1, aim: "x", codeImages: [png(900, 5000, "#fff")], outputImages: [] }] });
  const [, cx, cy] = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
  const inches = (emu) => Number(emu) / 914400;
  assert.ok(inches(cy) < 9.5, `height ${inches(cy).toFixed(2)}in fits an A4 page`);
  assert.ok(inches(cx) <= 6.6, `width ${inches(cx).toFixed(2)}in fits the margins`);
});

test("compact layout without a cover keeps the name line", async () => {
  const xml = await documentXml({ ...base, includeIndex: false, newPagePerPractical: false });
  assert.doesNotMatch(xml, /INDEX/);
  assert.match(xml, /Name : Test Student \(D2D\)/);
  assert.strictEqual((xml.match(/<w:pageBreakBefore\/>/g) || []).length, 0);
});
