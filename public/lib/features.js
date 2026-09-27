// Turns a screenshot into a fixed-length vector of layout and colour cues that
// separate source code from program output:
//   - syntax highlighting (several hues per text line)
//   - line-number gutters and nested indentation levels
//   - uniform monospaced line pitch vs. mixed font sizes / widgets / plots
//   - background structure (editor chrome, browser pages, GUI panels)
//
// Pure JavaScript over RGBA pixels, shared by the browser app and the Node training scripts.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PRB = Object.assign(root.PRB || {}, { features: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_W = 1400;
  const MAX_PIXELS = 2.4e6;
  const TILE = 24;
  const INK = 64; // colour distance from local background to count as ink
  const STRONG = 110; // ...and to trust the pixel's hue

  const FEATURE_NAMES = [
    "bgLum", "bgSat", "dominantBgFrac", "bgClusters", "panelArea", "uniformTiles", "colorfulArea", "aspect",
    "inkFrac", "chromaticInk", "hueEntropy", "hueCount",
    "lineCount", "textCoverage", "fontScale", "lineHeightCV", "regularPitch",
    "lineHues", "multiHueLines", "tripleHueLines",
    "gutter", "gutterWidth",
    "indentLevels", "atMinIndent", "indentChangeRate", "deepIndent",
    "widthCV", "shortLines", "fillWidth", "segmentsPerLine", "lineInkDensity", "alignedGaps", "fewLines",
  ];

  // Screenshots are downscaled to this size before analysis (same in Node and the browser).
  function scaledSize(w, h) {
    const s = Math.min(1, MAX_W / w, Math.sqrt(MAX_PIXELS / (w * h)));
    return { width: Math.max(8, Math.round(w * s)), height: Math.max(8, Math.round(h * s)) };
  }

  function hueBin(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    if (max < 64 || d / max < 0.25) return 12; // achromatic
    let h;
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return Math.min(11, Math.floor(h * 2));
  }

  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const std = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
  };
  const median = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function computeFeatures({ data, width: W, height: H }) {
    // ---- 1. local background per tile (mode of a 5-bit-per-channel histogram)
    const tw = Math.ceil(W / TILE), th = Math.ceil(H / TILE);
    const tileBg = new Float32Array(tw * th * 3);
    const tileUniform = new Float32Array(tw * th);
    const hist = new Int32Array(32768);
    const touched = [];
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const x0 = tx * TILE, y0 = ty * TILE;
        const x1 = Math.min(W, x0 + TILE), y1 = Math.min(H, y0 + TILE);
        let best = 0, bestKey = 0, n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
            if (hist[key] === 0) touched.push(key);
            const c = ++hist[key];
            if (c > best) { best = c; bestKey = key; }
            n++;
          }
        }
        let sr = 0, sg = 0, sb = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
            if (key === bestKey) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; }
          }
        }
        const t = ty * tw + tx;
        tileBg[t * 3] = sr / best; tileBg[t * 3 + 1] = sg / best; tileBg[t * 3 + 2] = sb / best;
        tileUniform[t] = best / n;
        for (const k of touched) hist[k] = 0;
        touched.length = 0;
      }
    }

    // ---- 2. cluster tile backgrounds; the dominant cluster is the "page"
    const clusters = [];
    const tileCluster = new Int32Array(tw * th);
    for (let t = 0; t < tw * th; t++) {
      const r = tileBg[t * 3], g = tileBg[t * 3 + 1], b = tileBg[t * 3 + 2];
      let found = -1;
      for (let c = 0; c < clusters.length; c++) {
        const k = clusters[c];
        if ((k.r - r) ** 2 + (k.g - g) ** 2 + (k.b - b) ** 2 < 20 * 20) { found = c; break; }
      }
      if (found === -1) { clusters.push({ r, g, b, n: 0 }); found = clusters.length - 1; }
      clusters[found].n++;
      tileCluster[t] = found;
    }
    let dom = 0;
    for (let c = 1; c < clusters.length; c++) if (clusters[c].n > clusters[dom].n) dom = c;
    const bg = clusters[dom];
    const bgMax = Math.max(bg.r, bg.g, bg.b), bgMin = Math.min(bg.r, bg.g, bg.b);
    const nTiles = tw * th;

    // ---- 3. main panel = longest run of columns, then rows, dominated by the page background
    const longestRun = (flags) => {
      let best = [0, flags.length - 1], bestLen = 0, start = -1;
      for (let i = 0; i <= flags.length; i++) {
        if (i < flags.length && flags[i]) { if (start < 0) start = i; }
        else if (start >= 0) { if (i - start > bestLen) { bestLen = i - start; best = [start, i - 1]; } start = -1; }
      }
      return best;
    };
    const colFlags = [];
    for (let tx = 0; tx < tw; tx++) {
      let k = 0;
      for (let ty = 0; ty < th; ty++) if (tileCluster[ty * tw + tx] === dom) k++;
      colFlags.push(k / th >= 0.5);
    }
    const [c0, c1] = longestRun(colFlags);
    const rowFlags = [];
    for (let ty = 0; ty < th; ty++) {
      let k = 0;
      for (let tx = c0; tx <= c1; tx++) if (tileCluster[ty * tw + tx] === dom) k++;
      rowFlags.push(k / (c1 - c0 + 1) >= 0.5);
    }
    const [r0, r1] = longestRun(rowFlags);
    const px0 = c0 * TILE, px1 = Math.min(W, (c1 + 1) * TILE);
    const py0 = r0 * TILE, py1 = Math.min(H, (r1 + 1) * TILE);
    const PW = px1 - px0, PH = py1 - py0;

    // ---- 4. ink mask inside the panel (distance from the pixel's own tile background)
    const ink = new Uint8Array(PW * PH); // 0 none, 1 ink, 2 strong ink
    const hue = new Uint8Array(PW * PH);
    let inkCount = 0, strongCount = 0, chromatic = 0;
    const hueHist = new Float64Array(13);
    for (let y = py0; y < py1; y++) {
      const tRow = Math.floor(y / TILE) * tw;
      for (let x = px0; x < px1; x++) {
        const t = tRow + Math.floor(x / TILE);
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const d2 = (r - tileBg[t * 3]) ** 2 + (g - tileBg[t * 3 + 1]) ** 2 + (b - tileBg[t * 3 + 2]) ** 2;
        if (d2 < INK * INK) continue;
        const p = (y - py0) * PW + (x - px0);
        inkCount++;
        if (d2 >= STRONG * STRONG) {
          ink[p] = 2;
          const hb = hueBin(r, g, b);
          hue[p] = hb;
          hueHist[hb]++;
          strongCount++;
          if (hb !== 12) chromatic++;
        } else ink[p] = 1;
      }
    }

    // colourful area over the whole image (photos, plots, buttons, nav bars)
    let colorfulPx = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 80 && (max - min) / max > 0.45) colorfulPx++;
    }
    let uniformTiles = 0;
    for (let t = 0; t < nTiles; t++) if (tileUniform[t] > 0.98) uniformTiles++;

    let hueEntropy = 0;
    if (strongCount > 0) for (const c of hueHist) if (c > 0) { const p = c / strongCount; hueEntropy -= p * Math.log(p); }
    let hueCount = 0;
    if (chromatic > 0) for (let h = 0; h < 12; h++) if (hueHist[h] / chromatic >= 0.03 && hueHist[h] >= 20) hueCount++;

    // ---- 5. text lines from the row profile (ignoring full-height rules / scrollbars)
    const structCol = new Uint8Array(PW);
    for (let x = 0; x < PW; x++) {
      let k = 0;
      for (let y = 0; y < PH; y++) if (ink[y * PW + x]) k++;
      if (k > 0.6 * PH) structCol[x] = 1;
    }
    const rowInk = new Int32Array(PH);
    for (let y = 0; y < PH; y++) {
      let k = 0;
      for (let x = 0; x < PW; x++) if (ink[y * PW + x] && !structCol[x]) k++;
      rowInk[y] = k;
    }
    const minRow = Math.max(2, 0.003 * PW);
    const lines = [];
    let start = -1, gap = 0;
    for (let y = 0; y <= PH; y++) {
      const on = y < PH && rowInk[y] >= minRow && rowInk[y] < 0.7 * PW;
      if (on) { if (start < 0) start = y; gap = 0; }
      else if (start >= 0) {
        gap++;
        if (gap > 1 || y === PH) {
          const end = y - gap;
          const h = end - start + 1;
          if (h >= 4 && h <= 0.25 * PH + 4) lines.push({ top: start, h });
          start = -1; gap = 0;
        }
      }
    }

    const n = lines.length;
    const heights = lines.map((l) => l.h);
    const medH = median(heights) || 10;

    // per-line column occupancy
    for (const l of lines) {
      const cols = new Uint8Array(PW);
      for (let y = l.top; y < l.top + l.h; y++) {
        for (let x = 0; x < PW; x++) if (ink[y * PW + x] && !structCol[x]) cols[x] = 1;
      }
      l.cols = cols;
    }

    // ---- 6. line-number gutter: a narrow left column present on (almost) every line,
    // followed by a vertical gap that no line crosses.
    let gutter = 0, gutterWidth = 0, cut = 0;
    if (n >= 4) {
      const colLines = new Int32Array(PW);
      for (const l of lines) for (let x = 0; x < PW; x++) if (l.cols[x]) colLines[x]++;
      const firstInk = lines.map((l) => l.cols.indexOf(1));
      const lastInk = lines.map((l) => l.cols.lastIndexOf(1));
      let textL = 0;
      while (textL < PW && colLines[textL] === 0) textL++;
      const limit = Math.min(PW, textL + Math.max(6 * medH, 0.3 * PW));
      let covered = 0, zeroStart = -1;
      for (let x = textL; x < limit; x++) {
        if (colLines[x] <= 0.02 * n) {
          if (zeroStart < 0) zeroStart = x;
          continue;
        }
        if (zeroStart >= 0 && x - zeroStart >= 0.8 * medH && covered >= 0.8 * n) {
          const after = lastInk.filter((v) => v >= x).length;
          // line numbers are right-aligned: most lines' gutter ink ends at the same column
          const ends = lines.map((l) => l.cols.lastIndexOf(1, zeroStart - 1)).filter((v) => v >= textL);
          const aligned = ends.filter((v) => zeroStart - 1 - v <= 0.3 * medH).length;
          if (after >= 0.4 * n && zeroStart - textL <= 4 * medH && aligned >= 0.8 * ends.length) {
            gutter = 1;
            gutterWidth = (zeroStart - textL) / medH;
            cut = x;
          }
          break;
        }
        zeroStart = -1;
        covered = firstInk.filter((v) => v >= 0 && v <= x).length;
      }
    }

    // ---- 7. per-line geometry and colour (to the right of any gutter)
    const body = [];
    for (const l of lines) {
      let left = -1, right = -1, segs = 0, lastInk = -1e9, inkPx = 0;
      for (let x = cut; x < PW; x++) {
        if (!l.cols[x]) continue;
        if (left < 0) left = x;
        if (x - lastInk > 1.2 * medH) segs++;
        lastInk = x;
        right = x;
      }
      if (left < 0) continue;
      const bins = new Int32Array(13);
      let strongPx = 0;
      for (let y = l.top; y < l.top + l.h; y++) {
        for (let x = left; x <= right; x++) {
          const p = y * PW + x;
          if (!ink[p] || structCol[x]) continue;
          inkPx++;
          if (ink[p] === 2) { bins[hue[p]]++; strongPx++; }
        }
      }
      let hues = 0;
      if (strongPx >= 20) for (let b = 0; b < 13; b++) if (bins[b] >= 6 && bins[b] / strongPx >= 0.1) hues++;
      body.push({ left, right, width: right - left + 1, h: l.h, top: l.top, segs, hues, strongPx, density: inkPx / ((right - left + 1) * l.h) });
    }

    const m = body.length;
    const colourLines = body.filter((b) => b.strongPx >= 20);
    const lefts = body.map((b) => b.left);
    const minLeft = lefts.length ? Math.min(...lefts) : 0;

    // indentation levels: cluster left edges
    const sortedL = [...lefts].sort((a, b) => a - b);
    let levels = 0, run = 0;
    for (let i = 0; i < sortedL.length; i++) {
      if (i > 0 && sortedL[i] - sortedL[i - 1] > 0.6 * medH) { if (run >= 2) levels++; run = 0; }
      run++;
    }
    if (run >= 2) levels++;
    let changes = 0;
    for (let i = 1; i < m; i++) if (Math.abs(body[i].left - body[i - 1].left) > medH) changes++;
    const atMin = body.filter((b) => b.left - minLeft <= 0.6 * medH).length;
    const deep = body.filter((b) => b.left - minLeft >= 3 * medH).length;

    // column alignment: vertical gaps shared by most lines that span them (tables, matrices)
    let alignedGaps = 0;
    if (m >= 4) {
      const bodyLines = lines.filter((l) => l.cols.indexOf(1, cut) >= 0);
      let runLen = 0;
      for (let x = cut; x < PW; x++) {
        let span = 0, empty = 0;
        bodyLines.forEach((l, i) => {
          if (body[i].left < x && body[i].right > x) { span++; if (!l.cols[x]) empty++; }
        });
        if (span >= 4 && span >= 0.5 * m && empty >= 0.9 * span) runLen++;
        else { if (runLen >= 0.4 * medH) alignedGaps++; runLen = 0; }
      }
    }

    const widths = body.map((b) => b.width);
    const pitches = [];
    for (let i = 1; i < lines.length; i++) pitches.push(lines[i].top - lines[i - 1].top);
    const medPitch = median(pitches) || 1;
    // blank lines make pitches integer multiples of the base pitch, which is still "regular"
    const regular = pitches.filter((p) => {
      const k = Math.max(1, Math.round(p / medPitch));
      return Math.abs(p - k * medPitch) <= 0.12 * medPitch + 1;
    }).length;

    const safe = (v, d = 0) => (Number.isFinite(v) ? v : d);
    const f = {
      bgLum: (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255,
      bgSat: bgMax > 0 ? (bgMax - bgMin) / bgMax : 0,
      dominantBgFrac: bg.n / nTiles,
      bgClusters: Math.min(10, clusters.filter((c) => c.n / nTiles >= 0.03).length) / 10,
      panelArea: (PW * PH) / (W * H),
      uniformTiles: uniformTiles / nTiles,
      colorfulArea: colorfulPx / (data.length / 16),
      aspect: clamp01((Math.log(W / H) + 1.5) / 3),
      inkFrac: inkCount / (PW * PH),
      chromaticInk: strongCount ? chromatic / strongCount : 0,
      hueEntropy: hueEntropy / Math.log(13),
      hueCount: hueCount / 12,
      lineCount: clamp01(Math.log1p(n) / Math.log(80)),
      textCoverage: clamp01(heights.reduce((s, v) => s + v, 0) / PH),
      fontScale: clamp01(Math.log(medH / W * 100 + 1) / Math.log(12)),
      lineHeightCV: clamp01(safe(std(heights) / mean(heights))),
      regularPitch: pitches.length ? regular / pitches.length : 0,
      lineHues: clamp01(mean(colourLines.map((b) => b.hues)) / 4),
      multiHueLines: colourLines.length ? colourLines.filter((b) => b.hues >= 2).length / colourLines.length : 0,
      tripleHueLines: colourLines.length ? colourLines.filter((b) => b.hues >= 3).length / colourLines.length : 0,
      gutter,
      gutterWidth: clamp01(gutterWidth / 5),
      indentLevels: Math.min(8, levels) / 8,
      atMinIndent: m ? atMin / m : 0,
      indentChangeRate: m > 1 ? changes / (m - 1) : 0,
      deepIndent: m ? deep / m : 0,
      widthCV: clamp01(safe(std(widths) / mean(widths))),
      shortLines: m ? body.filter((b) => b.width < 2.5 * medH).length / m : 0,
      fillWidth: m ? clamp01(Math.max(...widths) / PW) : 0,
      segmentsPerLine: clamp01(mean(body.map((b) => b.segs)) / 8),
      lineInkDensity: clamp01(mean(body.map((b) => b.density))),
      alignedGaps: Math.min(6, alignedGaps) / 6,
      fewLines: n < 3 ? 1 : 0,
    };
    return FEATURE_NAMES.map((k) => safe(f[k]));
  }

  return { FEATURE_NAMES, scaledSize, computeFeatures };
});
