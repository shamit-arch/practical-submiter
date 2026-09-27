// A small multilayer perceptron (inputs -> hidden ReLU layer -> softmax over labels),
// trained with Adam. Pure JavaScript, shared by the browser app and the Node training scripts.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PRB = Object.assign(root.PRB || {}, { mlp: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Deterministic PRNG (mulberry32) with a few helpers.
  function makeRng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rng = () => next();
    rng.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
    rng.chance = (p) => next() < p;
    rng.range = (lo, hi) => lo + next() * (hi - lo);
    return rng;
  }

  function standardizer(X) {
    const d = X[0].length;
    const mean = new Array(d).fill(0), std = new Array(d).fill(0);
    for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / X.length;
    for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / X.length;
    return { mean, std: std.map((s) => Math.sqrt(s) || 1) };
  }

  function forward(model, x) {
    const { W1, b1, W2, b2, mean, std } = model;
    const z = x.map((v, j) => (v - mean[j]) / std[j]);
    const h = b1.map((b, i) => {
      let s = b;
      for (let j = 0; j < z.length; j++) s += W1[i][j] * z[j];
      return s > 0 ? s : 0;
    });
    const logits = b2.map((b, k) => {
      let s = b;
      for (let i = 0; i < h.length; i++) s += W2[k][i] * h[i];
      return s;
    });
    const mx = Math.max(...logits);
    const e = logits.map((l) => Math.exp(l - mx));
    const tot = e.reduce((a, v) => a + v, 0);
    return { z, h, p: e.map((v) => v / tot) };
  }

  /**
   * @param {number[][]} X feature vectors
   * @param {number[]} y class indices
   * @param {{labels:string[], hidden?:number, epochs?:number, lr?:number, l2?:number, smoothing?:number, weights?:number[], seed?:number}} opts
   */
  function train(X, y, opts) {
    const { labels, hidden = 24, epochs = 120, lr = 0.01, l2 = 1e-4, smoothing = 0.04, batch = 32, seed = 7 } = opts;
    const weights = opts.weights || X.map(() => 1);
    const rng = makeRng(seed);
    const d = X[0].length, K = labels.length;
    const { mean, std } = standardizer(X);
    const init = (rows, cols) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rng() * 2 - 1) * Math.sqrt(6 / (rows + cols))));
    const model = { labels, mean, std, W1: init(hidden, d), b1: new Array(hidden).fill(0), W2: init(K, hidden), b2: new Array(K).fill(0) };

    // Adam state, flattened per parameter tensor
    const params = [model.W1, model.b1, model.W2, model.b2];
    const zeros = (p) => (Array.isArray(p[0]) ? p.map((r) => r.map(() => 0)) : p.map(() => 0));
    const m = params.map(zeros), v = params.map(zeros);
    let t = 0;
    const b1a = 0.9, b2a = 0.999, eps = 1e-8;

    const idx = X.map((_, i) => i);
    for (let ep = 0; ep < epochs; ep++) {
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      for (let s = 0; s < idx.length; s += batch) {
        const g = params.map(zeros);
        let wsum = 0;
        for (const n of idx.slice(s, s + batch)) {
          const w = weights[n];
          wsum += w;
          const { z, h, p } = forward(model, X[n]);
          const target = labels.map((_, k) => (k === y[n] ? 1 - smoothing : smoothing / (K - 1)));
          const dl = p.map((pk, k) => (pk - target[k]) * w);
          for (let k = 0; k < K; k++) {
            g[3][k] += dl[k];
            for (let i = 0; i < hidden; i++) g[2][k][i] += dl[k] * h[i];
          }
          for (let i = 0; i < hidden; i++) {
            if (h[i] <= 0) continue;
            let dh = 0;
            for (let k = 0; k < K; k++) dh += dl[k] * model.W2[k][i];
            g[1][i] += dh;
            for (let j = 0; j < d; j++) g[0][i][j] += dh * z[j];
          }
        }
        t++;
        const lrT = (lr * Math.sqrt(1 - b2a ** t)) / (1 - b1a ** t);
        params.forEach((P, pi) => {
          const step = (val, grad, mm, vv, set) => {
            mm = b1a * mm + (1 - b1a) * grad;
            vv = b2a * vv + (1 - b2a) * grad * grad;
            set(val - (lrT * mm) / (Math.sqrt(vv) + eps), mm, vv);
          };
          if (Array.isArray(P[0])) {
            for (let r = 0; r < P.length; r++) for (let c = 0; c < P[r].length; c++) {
              const grad = g[pi][r][c] / wsum + (pi === 0 || pi === 2 ? l2 * P[r][c] : 0);
              step(P[r][c], grad, m[pi][r][c], v[pi][r][c], (nv, mm, vv) => { P[r][c] = nv; m[pi][r][c] = mm; v[pi][r][c] = vv; });
            }
          } else {
            for (let r = 0; r < P.length; r++) {
              step(P[r], g[pi][r] / wsum, m[pi][r], v[pi][r], (nv, mm, vv) => { P[r] = nv; m[pi][r] = mm; v[pi][r] = vv; });
            }
          }
        });
      }
    }
    return model;
  }

  function predict(model, x) {
    return forward(model, x).p;
  }

  // Training settings shared by `npm run train` and in-browser retraining.
  const LABELS = ["code", "output"];
  const HYPER = { hidden: 24, epochs: 60, lr: 0.01, l2: 1e-4, smoothing: 0.04 };
  const USER_WEIGHT = 8; // one real labelled screenshot counts as much as 8 synthetic ones

  /** samples: [{ x: number[], label: "code"|"output", theme: string }]; real ones have theme "user"/"folder". */
  function fitSamples(samples) {
    return train(samples.map((s) => s.x), samples.map((s) => LABELS.indexOf(s.label)), {
      labels: LABELS,
      ...HYPER,
      weights: samples.map((s) => (s.theme === "user" || s.theme === "folder" ? USER_WEIGHT : 1)),
    });
  }

  return { makeRng, train, predict, fitSamples, LABELS, HYPER, USER_WEIGHT };
});
