// Builds the training set: synthetic screenshots (cached as feature vectors) plus
// any real, labelled screenshots from training-data/.
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { makeRng } = require("./corpus");
const { renderSample, CODE_THEME_NAMES, OUTPUT_THEME_NAMES } = require("./synth");
const { featuresFromCanvas, featuresFromBuffer } = require("./features");

const ROOT = path.join(__dirname, "..");
const CACHE_DIR = path.join(__dirname, "cache");
const TRAINING_DIR = path.join(ROOT, "training-data");
const LABELS = ["code", "output"];
const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif)$/i;
// Bump when features.js or synth.js change so stale caches are rebuilt.
const DATA_VERSION = 4;

// Simulate what happens to real screenshots: DPI scaling, cropping, JPEG re-compression.
async function augment(rng, canvas) {
  let src = canvas;
  if (rng.chance(0.3)) {
    const cx = Math.round(canvas.width * rng.range(0, 0.15));
    const cy = Math.round(canvas.height * rng.range(0, 0.15));
    const cw = Math.round(canvas.width * rng.range(0.7, 1)) - cx;
    const ch = Math.round(canvas.height * rng.range(0.7, 1)) - cy;
    if (cw > 200 && ch > 120) {
      const c = createCanvas(cw, ch);
      c.getContext("2d").drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
      src = c;
    }
  }
  const s = rng.range(0.55, 1.25);
  const out = createCanvas(Math.max(120, Math.round(src.width * s)), Math.max(80, Math.round(src.height * s)));
  out.getContext("2d").drawImage(src, 0, 0, out.width, out.height);
  if (rng.chance(0.2)) {
    const img = await loadImage(out.encodeSync("jpeg", rng.int(45, 90)));
    const c = createCanvas(img.width, img.height);
    c.getContext("2d").drawImage(img, 0, 0);
    return c;
  }
  return out;
}

async function buildSynthetic({ perClass = 1200, seed = 1, log = () => {} } = {}) {
  const file = path.join(CACHE_DIR, `synthetic-v${DATA_VERSION}-${perClass}-${seed}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const samples = [];
  const total = perClass * 2;
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    const rng = makeRng(seed * 1000003 + i);
    const label = LABELS[i % 2];
    const themes = label === "code" ? CODE_THEME_NAMES : OUTPUT_THEME_NAMES;
    const theme = themes[Math.floor(i / 2) % themes.length];
    const canvas = await augment(rng, renderSample(rng, label, theme));
    samples.push({ x: featuresFromCanvas(canvas), label, theme });
    if ((i + 1) % 200 === 0) log(`  rendered ${i + 1}/${total} synthetic screenshots (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(samples));
  return samples;
}

// training-data/code/*.png and training-data/output/*.png — real screenshots you label by folder.
async function loadFolderSamples(log = () => {}) {
  const out = [];
  for (const label of LABELS) {
    const dir = path.join(TRAINING_DIR, label);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => IMAGE_EXT.test(n))) {
      try {
        out.push({ x: await featuresFromBuffer(fs.readFileSync(path.join(dir, f))), label, theme: "folder" });
      } catch (err) {
        log(`  skipped ${label}/${f}: ${err.message}`);
      }
    }
  }
  return out;
}

module.exports = { LABELS, augment, buildSynthetic, loadFolderSamples, TRAINING_DIR };
