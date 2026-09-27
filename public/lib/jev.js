// Local, offline decision engine modelled on TypeSafe's Jev workflow: you pass
// `state` and named `questions`, and get back structured, probabilistic answers
// (never free text). Unlike hosted Jev it only knows the decisions it was trained
// for, and says so instead of guessing:
//
//   kind            choice {code, output}   – is this screenshot source code or program output?
//   startsPractical noul                   – does this screenshot begin a new practical?
//
//   const jev = new LocalJev(modelFile, extractFeatures);
//   const res = await jev.systemOne({
//     state: { screenshots: [img1, img2, ...], practicalCount: 8 },
//     questions: { kind: choice("Source code or output?", { code: null, output: null }), startsPractical: noul() },
//   });
//   res.answers[0].kind  -> { type: "choice", choice: "code", confidence: 0.97, probabilities: { code: 0.97, output: 0.03 } }
//
// Shared by the browser app and Node; `extractFeatures(screenshot)` is the only
// platform-specific part (decoding the image).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./mlp"), require("./features"));
  else root.PRB = Object.assign(root.PRB || {}, { jev: factory(root.PRB.mlp, root.PRB.features) });
})(typeof self !== "undefined" ? self : this, function (mlp, features) {
  "use strict";

  const LABELS = ["code", "output"];
  // How screenshots usually follow each other in a practical file (rows: from code/output).
  // Code is mostly followed by its output; several code pages or several outputs in a row are common too.
  const TRANSITIONS = [[0.3, 0.7], [0.55, 0.45]];
  const P_FIRST_IS_CODE = 0.8;
  const MIN_FORCED_PROB = 0.15;

  const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
  const noul = (instructions, criteria) => ({ type: "noul", instructions, criteria });

  class UnsupportedQuestionError extends Error {}

  class LocalJev {
    /**
     * @param {object} modelFile        contents of model.json
     * @param {(screenshot:any) => Promise<number[]>} extractFeatures
     */
    constructor(modelFile, extractFeatures) {
      this.extractFeatures = extractFeatures;
      this.load(modelFile);
    }

    load(file) {
      if (file.featureNames.join() !== features.FEATURE_NAMES.join()) {
        throw new Error("The model was trained on different features; run `npm run train`.");
      }
      this.card = {
        name: file.name,
        version: file.version,
        trainedAt: file.trainedAt,
        samples: file.samples,
        metrics: file.metrics,
      };
      this.net = { ...file.model, labels: file.labels };
    }

    get model() {
      return this.card;
    }

    /** Image-only probability that each screenshot is code, plus the feature vectors used. */
    async analyze(screenshots, onProgress) {
      const out = [];
      for (let i = 0; i < screenshots.length; i++) {
        const x = await this.extractFeatures(screenshots[i]);
        const [pCode] = mlp.predict(this.net, x);
        out.push({ x, pCode: Math.min(0.999, Math.max(0.001, pCode)) });
        if (onProgress) onProgress(i + 1, screenshots.length);
      }
      return out;
    }

    /**
     * Jev-style entry point. `state.screenshots` is required; `state.practicalCount`
     * (optional) lets the engine pick the most likely labelling that splits the
     * screenshots into exactly that many practicals.
     * Returns one answers object per screenshot, in order.
     */
    async systemOne({ state, questions }) {
      for (const [name, q] of Object.entries(questions || {})) {
        const isKind = q.type === "choice" && Object.keys(q.criteria || {}).sort().join() === "code,output";
        const isStart = q.type === "noul" && name === "startsPractical";
        if (!isKind && !isStart) {
          throw new UnsupportedQuestionError(`LocalJev can't answer "${name}": it is trained only for a code/output choice and a startsPractical noul.`);
        }
      }
      const analysis = await this.analyze(state.screenshots || []);
      const decisions = decideSequence(analysis.map((a) => a.pCode), state.practicalCount);
      return {
        model: `${this.card.name}@${this.card.version}`,
        answers: decisions.map((d) => answersFor(d, questions)),
        features: analysis.map((a) => a.x),
      };
    }
  }

  function answersFor(d, questions) {
    const answers = {};
    for (const [name, q] of Object.entries(questions)) {
      answers[name] = q.type === "choice"
        ? { type: "choice", choice: d.choice, confidence: d.probabilities[d.choice], probabilities: d.probabilities, imageOnly: d.imageOnly }
        : { type: "noul", noul: d.startsPractical };
    }
    return answers;
  }

  /** Serialises a trained network into the model.json format. */
  function modelFile(net, info) {
    return {
      name: "jev-local-screenshot",
      version: 1,
      trainedAt: new Date().toISOString(),
      labels: LABELS,
      featureNames: features.FEATURE_NAMES,
      ...info,
      hyper: mlp.HYPER,
      model: { mean: net.mean, std: net.std, W1: net.W1, b1: net.b1, W2: net.W2, b2: net.b2 },
    };
  }

  /**
   * Combines per-image probabilities with the order of screenshots.
   * - probabilities: forward-backward posterior of a 2-state HMM (uses neighbours)
   * - startsPractical: P(this is code and the previous one was output)
   * - choice: posterior argmax, or — when practicalCount is known — the jointly most
   *   likely labelling (Viterbi) that yields exactly that many practicals.
   */
  function decideSequence(pCode, practicalCount) {
    const n = pCode.length;
    if (n === 0) return [];
    const T = TRANSITIONS;
    const e = pCode.map((p) => [p, 1 - p]);
    const start = [P_FIRST_IS_CODE, 1 - P_FIRST_IS_CODE];
    const norm = (v) => { const s = v[0] + v[1]; return [v[0] / s, v[1] / s]; };

    const a = [norm([start[0] * e[0][0], start[1] * e[0][1]])];
    for (let i = 1; i < n; i++) {
      a.push(norm([0, 1].map((j) => (a[i - 1][0] * T[0][j] + a[i - 1][1] * T[1][j]) * e[i][j])));
    }
    const b = new Array(n);
    b[n - 1] = [1, 1];
    for (let i = n - 2; i >= 0; i--) {
      b[i] = norm([0, 1].map((j) => T[j][0] * e[i + 1][0] * b[i + 1][0] + T[j][1] * e[i + 1][1] * b[i + 1][1]));
    }
    const post = a.map((v, i) => norm([v[0] * b[i][0], v[1] * b[i][1]]));
    const starts = post.map((_, i) => {
      if (i === 0) return 1;
      // pairwise marginal P(s_{i-1} = output, s_i = code)
      const pair = [0, 1].map((s) => [0, 1].map((t) => a[i - 1][s] * T[s][t] * e[i][t] * b[i][t]));
      const tot = pair[0][0] + pair[0][1] + pair[1][0] + pair[1][1];
      return pair[1][0] / tot;
    });

    let labels = post.map((p) => (p[0] >= 0.5 ? 0 : 1));
    if (practicalCount && practicalCount >= 1 && practicalCount <= n) {
      const constrained = viterbiWithCount(e, practicalCount);
      // The count may only settle uncertain screenshots, never overrule confident ones
      // (or labels the user set). If it would, keep the unconstrained answer instead.
      if (constrained && constrained.every((l, i) => e[i][l] >= MIN_FORCED_PROB)) labels = constrained;
    }

    return post.map((p, i) => ({
      choice: LABELS[labels[i]],
      probabilities: { code: round(p[0]), output: round(p[1]) },
      imageOnly: { code: round(pCode[i]), output: round(1 - pCode[i]) },
      startsPractical: round(i === 0 ? 1 : labels[i] === 0 && labels[i - 1] === 1 ? Math.max(starts[i], 0.5) : Math.min(starts[i], 0.49)),
    }));
  }

  function viterbiWithCount(e, N) {
    const n = e.length, L = Math.log, NEG = -Infinity;
    let dp = [new Array(N + 1).fill(NEG), new Array(N + 1).fill(NEG)];
    dp[0][1] = L(P_FIRST_IS_CODE) + L(e[0][0]);
    dp[1][1] = L(1 - P_FIRST_IS_CODE) + L(e[0][1]);
    const back = [null];
    for (let i = 1; i < n; i++) {
      const nd = [new Array(N + 1).fill(NEG), new Array(N + 1).fill(NEG)];
      const bk = [[], []];
      for (let g = 1; g <= N; g++) {
        for (let s = 0; s < 2; s++) {
          if (dp[s][g] === NEG) continue;
          for (let t = 0; t < 2; t++) {
            const ng = g + (s === 1 && t === 0 ? 1 : 0);
            if (ng > N) continue;
            const v = dp[s][g] + L(TRANSITIONS[s][t]) + L(e[i][t]);
            if (v > nd[t][ng]) { nd[t][ng] = v; bk[t][ng] = [s, g]; }
          }
        }
      }
      dp = nd;
      back.push(bk);
    }
    let s = dp[0][N] >= dp[1][N] ? 0 : 1;
    if (dp[s][N] === NEG) return null;
    let g = N;
    const out = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      out[i] = s;
      if (i > 0) [s, g] = back[i][s][g];
    }
    return out;
  }

  const round = (v) => Math.round(v * 1000) / 1000;

  return { LocalJev, choice, noul, decideSequence, answersFor, modelFile, UnsupportedQuestionError, LABELS };
});
