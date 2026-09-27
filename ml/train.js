#!/usr/bin/env node
// Trains the screenshot classifier and writes ml/model.json, plus ml/training-set.json
// (the feature vectors it was trained on) so the browser app can retrain with corrections.
//
//   npm run train                 full run: evaluation report + final model
//   node ml/train.js --quick      skip evaluation, just (re)train on everything
//
// Evaluation holds out whole editor/terminal styles the model never sees in
// training, which is a fairer proxy for "a screenshot from an IDE I haven't met".
const fs = require("fs");
const path = require("path");
const mlp = require("../public/lib/mlp");
const { modelFile } = require("../public/lib/jev");
const { LABELS, buildSynthetic, loadFolderSamples } = require("./dataset");

const MODEL_PATH = path.join(__dirname, "model.json");
const TRAINING_SET_PATH = path.join(__dirname, "training-set.json");
const HOLDOUT = ["monokai", "notepadpp", "bash-ubuntu", "eclipse-console", "gui"];
const fit = mlp.fitSamples;

function score(model, samples) {
  const byTheme = {};
  let correct = 0;
  const confusion = { code: { code: 0, output: 0 }, output: { code: 0, output: 0 } };
  for (const s of samples) {
    const p = mlp.predict(model, s.x);
    const pred = LABELS[p[0] >= p[1] ? 0 : 1];
    confusion[s.label][pred]++;
    const t = (byTheme[s.theme] ||= { n: 0, ok: 0 });
    t.n++;
    if (pred === s.label) { correct++; t.ok++; }
  }
  return { accuracy: correct / samples.length, n: samples.length, confusion, byTheme };
}

async function trainAndSave({ evaluate = true, perClass = 1200, log = console.log } = {}) {
  log(`Building synthetic dataset (${perClass} code + ${perClass} output)…`);
  const synthetic = await buildSynthetic({ perClass, log });
  const folder = await loadFolderSamples(log);
  log(`Real labelled screenshots from training-data/: ${folder.length}`);

  const metrics = {};
  if (evaluate) {
    const trainSet = synthetic.filter((s) => !HOLDOUT.includes(s.theme));
    const unseen = synthetic.filter((s) => HOLDOUT.includes(s.theme));
    const m1 = fit(trainSet);
    metrics.unseenStyles = score(m1, unseen);
    log(`\nHeld-out styles (${HOLDOUT.join(", ")}): accuracy ${(metrics.unseenStyles.accuracy * 100).toFixed(1)}% on ${unseen.length}`);
    for (const [t, r] of Object.entries(metrics.unseenStyles.byTheme)) log(`  ${t.padEnd(18)} ${((r.ok / r.n) * 100).toFixed(1)}%  (${r.n})`);

    // Fresh screenshots from a different random seed: all styles seen, new content.
    const fresh = await buildSynthetic({ perClass: 300, seed: 99, log });
    metrics.freshSamples = score(m1, fresh.filter((s) => !HOLDOUT.includes(s.theme)));
    log(`Fresh synthetic screenshots (seen styles): accuracy ${(metrics.freshSamples.accuracy * 100).toFixed(1)}% on ${metrics.freshSamples.n}`);
    const c = metrics.freshSamples.confusion;
    log(`  confusion  code→code ${c.code.code}  code→output ${c.code.output}  output→code ${c.output.code}  output→output ${c.output.output}`);

    if (folder.length) {
      metrics.realScreenshots = score(fit(synthetic), folder);
      log(`Your training-data/ screenshots (model trained without them): ${(metrics.realScreenshots.accuracy * 100).toFixed(1)}% on ${folder.length}`);
    }
  }

  const all = [...synthetic, ...folder];
  const model = fit(all);
  const trainScore = score(model, all);
  const out = modelFile(model, {
    samples: { synthetic: synthetic.length, userCorrections: 0, trainingData: folder.length },
    trainingAccuracy: trainScore.accuracy,
    metrics: evaluate ? {
      unseenStylesAccuracy: metrics.unseenStyles.accuracy,
      freshSamplesAccuracy: metrics.freshSamples.accuracy,
      realScreenshotsAccuracy: metrics.realScreenshots ? metrics.realScreenshots.accuracy : null,
    } : (readExisting() || {}).metrics || null,
  });
  fs.writeFileSync(MODEL_PATH, JSON.stringify(out));
  // Compact rows: [labelIndex, isRealScreenshot, ...features rounded to 4 decimals]
  const rows = all.map((s) => [LABELS.indexOf(s.label), s.theme === "folder" ? 1 : 0, ...s.x.map((v) => Math.round(v * 1e4) / 1e4)]);
  fs.writeFileSync(TRAINING_SET_PATH, JSON.stringify({ labels: LABELS, rows }));
  log(`\nSaved ${path.relative(process.cwd(), MODEL_PATH)} (training accuracy ${(trainScore.accuracy * 100).toFixed(1)}% on ${all.length})`);
  return out;
}

function readExisting() {
  try { return JSON.parse(fs.readFileSync(MODEL_PATH, "utf8")); } catch { return null; }
}

if (require.main === module) {
  const quick = process.argv.includes("--quick");
  const n = process.argv.find((a) => a.startsWith("--per-class="));
  trainAndSave({ evaluate: !quick, perClass: n ? parseInt(n.split("=")[1], 10) : 1200 }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { trainAndSave, MODEL_PATH, TRAINING_SET_PATH };
