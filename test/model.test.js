const test = require("node:test");
const assert = require("node:assert");
const { LocalJev, choice, noul, decideSequence, UnsupportedQuestionError } = require("../ml/jev-local");
const { makeRng } = require("../ml/corpus");
const { renderSample, CODE_THEME_NAMES, OUTPUT_THEME_NAMES } = require("../ml/synth");

const QUESTIONS = { kind: choice("Code or output?", { code: null, output: null }), startsPractical: noul() };
const labelsOf = (ds) => ds.map((d) => d.choice[0]).join("");
const startsOf = (ds) => ds.map((d) => (d.startsPractical >= 0.5 ? "|" : ".")).join("");

test("confident predictions pass through the sequence model unchanged", () => {
  const ds = decideSequence([0.95, 0.05, 0.97, 0.03, 0.02]);
  assert.strictEqual(labelsOf(ds), "cocoo");
  assert.strictEqual(startsOf(ds), "|.|..");
});

test("an uncertain screenshot is resolved by its neighbours", () => {
  // code, ???, code, output — the middle one is most likely the first practical's output
  const ds = decideSequence([0.95, 0.52, 0.95, 0.05]);
  assert.strictEqual(ds[1].choice, "output");
  assert.ok(ds[1].imageOnly.code > 0.5, "image-only view still favoured code");
});

test("knowing the practical count picks a labelling with exactly that many practicals", () => {
  const p = [0.9, 0.2, 0.6, 0.1, 0.85, 0.15];
  const free = decideSequence(p);
  const three = decideSequence(p, 3);
  assert.strictEqual((startsOf(free).match(/\|/g) || []).length, 3);
  const two = decideSequence(p, 2);
  assert.strictEqual((startsOf(two).match(/\|/g) || []).length, 2);
  assert.strictEqual((startsOf(three).match(/\|/g) || []).length, 3);
});

test("an impossible practical count never overrules confident labels", () => {
  // 3 practicals would need the confident output (#2) to become code — keep the real labels instead
  const ds = decideSequence([0.966, 0.001, 0.965, 0.07], 3);
  assert.strictEqual(labelsOf(ds), "coco");
});

test("answers use Jev's structured shape", async () => {
  const jev = new LocalJev();
  const rng = makeRng(4242);
  const buf = renderSample(rng, "code", "vscode-dark").toBuffer("image/png");
  const res = await jev.systemOne({ state: { screenshots: [buf] }, questions: QUESTIONS });
  const a = res.answers[0];
  assert.strictEqual(a.kind.type, "choice");
  assert.ok(["code", "output"].includes(a.kind.choice));
  assert.ok(Math.abs(a.kind.probabilities.code + a.kind.probabilities.output - 1) < 0.01);
  assert.strictEqual(a.kind.confidence, a.kind.probabilities[a.kind.choice]);
  assert.strictEqual(a.startsPractical.type, "noul");
  assert.strictEqual(res.features[0].length, jev.net.mean.length);
});

test("questions the model was not trained for are refused, not guessed", async () => {
  const jev = new LocalJev();
  await assert.rejects(
    jev.systemOne({ state: { screenshots: [] }, questions: { lang: choice("Which language?", { c: null, java: null }) } }),
    UnsupportedQuestionError,
  );
});

test("classifies freshly rendered screenshots it has never seen", async () => {
  const jev = new LocalJev();
  let correct = 0, total = 0;
  for (let i = 0; i < 40; i++) {
    const rng = makeRng(777000 + i);
    const label = i % 2 ? "output" : "code";
    const themes = label === "code" ? CODE_THEME_NAMES : OUTPUT_THEME_NAMES;
    const buf = renderSample(rng, label, themes[i % themes.length]).toBuffer("image/png");
    const [{ pCode }] = await jev.analyze([buf]);
    total++;
    if ((pCode >= 0.5 ? "code" : "output") === label) correct++;
  }
  assert.ok(correct / total >= 0.9, `accuracy ${correct}/${total}`);
});
