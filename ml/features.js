// Node side of feature extraction: decodes images with @napi-rs/canvas, then runs the
// shared pure-JS extractor in public/lib/features.js (the same code the browser runs).
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { FEATURE_NAMES, scaledSize, computeFeatures } = require("../public/lib/features");

function toImageData(src, w, h) {
  const { width: W, height: H } = scaledSize(w, h);
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  ctx.drawImage(src, 0, 0, W, H);
  return { data: ctx.getImageData(0, 0, W, H).data, width: W, height: H };
}

async function featuresFromBuffer(buffer) {
  const img = await loadImage(buffer);
  return computeFeatures(toImageData(img, img.width, img.height));
}

function featuresFromCanvas(canvas) {
  return computeFeatures(toImageData(canvas, canvas.width, canvas.height));
}

module.exports = { FEATURE_NAMES, featuresFromBuffer, featuresFromCanvas, computeFeatures };
