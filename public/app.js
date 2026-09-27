// Everything runs in this browser: the model, grouping, PDF parsing and the Word
// document. Nothing is uploaded anywhere. Shared logic lives in lib/ (window.PRB).
const { features: F, mlp, jev: J, aims: A, document: D } = window.PRB;

let parsedAims = {}; // { number: aimText } from the PDF
const aimEdits = {}; // { number: aimText } typed by the user
// { id, file, url, pCode, features, kind, probs, userSet, split, status }
let items = [];
let nextId = 1;

const $ = (id) => document.getElementById(id);
const pdfInput = $("pdfInput");
const pdfStatus = $("pdfStatus");
const bulkDropzone = $("bulkDropzone");
const thumbGrid = $("thumbGrid");
const generateBtn = $("generateBtn");
const generateStatus = $("generateStatus");
const classifyStatus = $("classifyStatus");
const groupWarning = $("groupWarning");
const rangeStartEl = $("rangeStart");
const rangeEndEl = $("rangeEnd");
const rangeAutoTag = $("rangeAutoTag");

function setStatus(el, msg, kind = "") {
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

// ------------------------------------------------------------------ browser storage
// Corrections and a retrained model are kept per browser (localStorage).

const STORE = { model: "prb.model.v1", corrections: "prb.corrections.v1" };
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

// ------------------------------------------------------------------ helpers

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(el);
  });
}

// Same pipeline as the Node trainer: downscale, read RGBA, compute features.
async function extractFeatures(file) {
  const bmp = await createImageBitmap(file);
  const { width, height } = F.scaledSize(bmp.width, bmp.height);
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return F.computeFeatures({ data: ctx.getImageData(0, 0, width, height).data, width, height });
}

// ------------------------------------------------------------------ model card

const pct = (v) => (v == null ? "–" : `${Math.round(v * 100)}%`);
let builtInModel = null;
let jev = null;

async function loadModel() {
  try {
    const res = await fetch("model/model.json");
    if (!res.ok) throw new Error("model/model.json not found — run `npm run build`");
    builtInModel = await res.json();
    jev = new J.LocalJev(builtInModel, extractFeatures);
    const custom = store.get(STORE.model);
    if (custom) {
      try { jev.load(custom); } catch { store.remove(STORE.model); }
    }
    renderModel();
  } catch (err) {
    setStatus($("modelStats"), "Model unavailable: " + err.message, "error");
  }
}

function renderModel() {
  const m = jev.model;
  const custom = !!store.get(STORE.model);
  const corrections = (store.get(STORE.corrections) || []).length;
  $("modelName").textContent = `${m.name} v${m.version}${custom ? " · retrained here" : ""}`;
  const s = m.samples || {};
  const trained = new Date(m.trainedAt).toLocaleString();
  const metrics = m.metrics
    ? ` · accuracy on new screenshots ${pct(m.metrics.freshSamplesAccuracy)}, on unseen editor/terminal styles ${pct(m.metrics.unseenStylesAccuracy)}`
    : "";
  $("modelStats").textContent =
    `Trained ${trained} on ${s.synthetic || 0} synthetic + ${(s.userCorrections || 0) + (s.trainingData || 0)} real screenshots${metrics}. ` +
    `${corrections} correction(s) saved in this browser.`;
  $("resetModelBtn").classList.toggle("hidden", !custom && !corrections);
}

$("retrainBtn").addEventListener("click", async () => {
  const btn = $("retrainBtn");
  const corrections = store.get(STORE.corrections) || [];
  if (!corrections.length) {
    setStatus($("retrainStatus"), "No corrections yet. Flip any wrong labels, generate the document, then retrain.", "error");
    return;
  }
  btn.disabled = true;
  setStatus($("retrainStatus"), `Retraining with ${corrections.length} correction(s)…`);
  try {
    const res = await fetch("model/training-set.json");
    if (!res.ok) throw new Error("model/training-set.json not found — run `npm run build`");
    const set = await res.json();
    const samples = set.rows.map((r) => ({ label: set.labels[r[0]], theme: r[1] ? "folder" : "synthetic", x: r.slice(2) }));
    for (const c of corrections) samples.push({ x: c.x, label: c.label, theme: "user" });
    await new Promise((r) => setTimeout(r, 30)); // let the status paint before the CPU-bound fit
    const net = mlp.fitSamples(samples);
    const base = builtInModel.samples || {};
    const file = J.modelFile(net, {
      samples: { ...base, userCorrections: (base.userCorrections || 0) + corrections.length },
      metrics: builtInModel.metrics,
    });
    jev.load(file);
    if (!store.set(STORE.model, file)) throw new Error("Retrained, but this browser would not let the model be saved.");
    renderModel();
    setStatus($("retrainStatus"), "Model retrained in this browser. New screenshots will use it.", "success");
  } catch (err) {
    setStatus($("retrainStatus"), err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

$("resetModelBtn").addEventListener("click", () => {
  if (!confirm("Forget the corrections saved in this browser and go back to the built-in model?")) return;
  store.remove(STORE.model);
  store.remove(STORE.corrections);
  jev.load(builtInModel);
  renderModel();
  setStatus($("retrainStatus"), "Back to the built-in model.", "success");
});

// ------------------------------------------------------------------ PDF + range

function getRange() {
  const start = parseInt(rangeStartEl.value, 10);
  const end = parseInt(rangeEndEl.value, 10);
  if (!start || !end || end < start) return null;
  const nums = [];
  for (let n = start; n <= end; n++) nums.push(n);
  return nums;
}

async function readPdfText(file) {
  const pdfjs = await import("./vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdf.worker.min.mjs", location.href).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items);
  await doc.destroy();
  return A.textFromPdfItems(pages);
}

pdfInput.addEventListener("change", async () => {
  const file = pdfInput.files[0];
  if (!file) return;
  setStatus(pdfStatus, "Reading PDF…");
  try {
    parsedAims = A.parsePracticalsFromText(await readPdfText(file));
    const nums = Object.keys(parsedAims).map(Number);
    setStatus(pdfStatus, `Found ${nums.length} numbered aim(s) in the PDF.`, nums.length ? "success" : "error");
    if (nums.length && !rangeStartEl.dataset.userEdited && !rangeEndEl.dataset.userEdited) {
      rangeStartEl.value = Math.min(...nums);
      rangeEndEl.value = Math.max(...nums);
      rangeAutoTag.textContent = "(auto-detected from PDF)";
      rangeAutoTag.className = "optional auto";
    }
    decide();
  } catch (err) {
    setStatus(pdfStatus, "Could not read the PDF: " + err.message, "error");
  }
});

for (const el of [rangeStartEl, rangeEndEl]) {
  el.addEventListener("input", () => {
    el.dataset.userEdited = "true";
    rangeAutoTag.textContent = "(manual)";
    rangeAutoTag.className = "optional manual";
    decide();
  });
}

// ------------------------------------------------------------------ classification

async function classifyPending() {
  const pending = items.filter((it) => it.status === "pending");
  if (!pending.length || !jev) return;
  pending.forEach((it) => (it.status = "working"));
  render();
  try {
    const results = await jev.analyze(pending.map((it) => it.file), (done, total) =>
      setStatus(classifyStatus, `Analysing screenshot ${done} of ${total} with the offline model…`));
    results.forEach((r, i) => Object.assign(pending[i], { pCode: r.pCode, features: r.x, status: "done" }));
    setStatus(classifyStatus, "");
  } catch (err) {
    pending.forEach((it) => { if (it.status !== "done") { it.status = "error"; it.pCode = 0.5; } });
    setStatus(classifyStatus, err.message + " — label the screenshots manually.", "error");
  }
  decide();
  classifyPending(); // screenshots added while this batch was running
}

// Re-decide labels for the whole sequence (cheap: no image work).
// User-set labels are treated as certain so the model plans around them.
function decide() {
  const ready = items.filter((it) => it.status === "done" || it.status === "error");
  if (!ready.length || ready.length !== items.length) { render(); return; }
  const nums = getRange();
  const decisions = J.decideSequence(
    items.map((it) => (it.userSet ? (it.kind === "code" ? 0.999 : 0.001) : it.pCode)),
    nums && !items.some((it) => it.split !== null) ? nums.length : undefined,
  );
  decisions.forEach((d, i) => {
    const it = items[i];
    it.probs = d.probabilities;
    if (!it.userSet) it.kind = d.choice;
  });
  render();
}

// ------------------------------------------------------------------ grouping

function computeGroups() {
  const groups = [];
  items.forEach((it, i) => {
    const auto = i === 0 || (it.kind === "code" && items[i - 1].kind === "output");
    const starts = i === 0 || (it.split !== null ? it.split : auto);
    if (starts) groups.push({ items: [] });
    groups[groups.length - 1].items.push(it);
  });
  const nums = getRange();
  groups.forEach((g, gi) => {
    g.outOfRange = !!nums && gi >= nums.length;
    if (!nums) g.number = gi + 1;
    else g.number = g.outOfRange ? nums[nums.length - 1] + (gi - nums.length + 1) : nums[gi];
  });
  return { groups, nums };
}

function aimFor(n) {
  return n in aimEdits ? aimEdits[n] : parsedAims[n] || "";
}

// ------------------------------------------------------------------ rendering

function render() {
  thumbGrid.innerHTML = "";
  const { groups, nums } = computeGroups();
  let idx = 0;
  for (const g of groups) {
    const head = document.createElement("div");
    head.className = "group-head" + (g.outOfRange ? " out" : "");
    const title = document.createElement("span");
    title.className = "group-title";
    title.textContent = `Practical ${g.number}${g.outOfRange ? " (outside range)" : ""}`;
    const aim = document.createElement("input");
    aim.type = "text";
    aim.placeholder = "Aim (leave blank to fill in by hand)";
    aim.value = aimFor(g.number);
    aim.addEventListener("input", () => { aimEdits[g.number] = aim.value; });
    head.append(title, aim);
    thumbGrid.appendChild(head);

    for (const it of g.items) thumbGrid.appendChild(thumbFor(it, idx++));
  }

  if (items.length && nums && groups.length !== nums.length) {
    groupWarning.textContent = `Found ${groups.length} practical(s) in the screenshots but the range ${nums[0]}–${nums[nums.length - 1]} has ${nums.length}. Check the labels, or use ⤒ on a thumbnail to start/merge practicals.`;
    groupWarning.classList.remove("hidden");
  } else groupWarning.classList.add("hidden");
}

function thumbFor(it, idx) {
  const el = document.createElement("div");
  el.className = "thumb-item";
  el.draggable = true;
  el.dataset.id = it.id;

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const img = document.createElement("img");
  img.src = it.url;
  img.alt = it.file.name;
  const remove = document.createElement("button");
  remove.className = "remove";
  remove.type = "button";
  remove.title = "Remove";
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    URL.revokeObjectURL(it.url);
    items = items.filter((x) => x !== it);
    decide();
  });
  thumb.append(img, remove);
  if (it.status === "working" || it.status === "pending") {
    const spin = document.createElement("div");
    spin.className = "thumb-busy";
    spin.textContent = "Analysing…";
    thumb.appendChild(spin);
  }

  const bar = document.createElement("div");
  bar.className = "thumb-bar";
  const kindBtn = document.createElement("button");
  kindBtn.type = "button";
  const known = it.kind === "code" || it.kind === "output";
  kindBtn.className = "kind " + (known ? it.kind : "");
  const conf = it.probs && known ? ` ${Math.round(it.probs[it.kind] * 100)}%` : "";
  kindBtn.textContent = known ? `${it.kind.toUpperCase()}${it.userSet ? " ✓" : conf}` : "…";
  kindBtn.title = it.userSet ? "Set by you — click to flip" : "Model's label and confidence — click to flip";
  kindBtn.disabled = !known;
  kindBtn.addEventListener("click", () => {
    it.kind = it.kind === "code" ? "output" : "code";
    it.userSet = true;
    decide();
  });

  const splitBtn = document.createElement("button");
  splitBtn.type = "button";
  splitBtn.className = "split" + (it.split === true ? " on" : it.split === false ? " off" : "");
  splitBtn.textContent = "⤒";
  splitBtn.title = it.split === null ? "Force a new practical to start here" : it.split ? "Forced to start a practical — click to force merge" : "Forced to merge — click to go back to automatic";
  splitBtn.disabled = idx === 0;
  splitBtn.addEventListener("click", () => {
    it.split = it.split === null ? true : it.split === true ? false : null;
    decide();
  });

  const num = document.createElement("span");
  num.className = "thumb-num";
  num.textContent = `#${idx + 1}`;
  bar.append(num, kindBtn, splitBtn);
  el.append(thumb, bar);

  el.addEventListener("dragstart", () => el.classList.add("dragging"));
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  return el;
}

thumbGrid.addEventListener("dragover", (e) => {
  e.preventDefault();
  const dragging = thumbGrid.querySelector(".dragging");
  if (!dragging) return;
  const siblings = [...thumbGrid.querySelectorAll(".thumb-item:not(.dragging)")];
  const next = siblings.find((sib) => {
    const r = sib.getBoundingClientRect();
    return e.clientY < r.bottom && (e.clientY < r.top || e.clientX < r.left + r.width / 2);
  });
  if (next) thumbGrid.insertBefore(dragging, next);
  else thumbGrid.appendChild(dragging);
});

thumbGrid.addEventListener("drop", () => {
  const order = [...thumbGrid.querySelectorAll(".thumb-item")].map((el) => Number(el.dataset.id));
  items = order.map((id) => items.find((it) => it.id === id));
  decide();
});

// ------------------------------------------------------------------ adding screenshots

function addScreenshots(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  for (const file of files) {
    items.push({ id: nextId++, file, url: URL.createObjectURL(file), pCode: null, features: null, kind: null, probs: null, userSet: false, split: null, status: "pending" });
  }
  classifyPending();
}

bulkDropzone.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.addEventListener("change", () => addScreenshots(input.files));
  input.click();
});
bulkDropzone.addEventListener("dragover", (e) => { e.preventDefault(); bulkDropzone.classList.add("dragover"); });
bulkDropzone.addEventListener("dragleave", () => bulkDropzone.classList.remove("dragover"));
bulkDropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  bulkDropzone.classList.remove("dragover");
  addScreenshots(e.dataTransfer.files);
});
document.addEventListener("paste", (e) => {
  const files = [];
  for (const item of e.clipboardData?.items || []) {
    if (item.type.startsWith("image/")) {
      const blob = item.getAsFile();
      if (blob) files.push(new File([blob], `pasted-${Date.now()}-${files.length}.png`, { type: blob.type }));
    }
  }
  if (files.length) addScreenshots(files);
});

// ------------------------------------------------------------------ generate

// Labels the user corrected become training examples for "Retrain model".
function saveCorrections() {
  const corrected = items.filter((it) => it.userSet && !it.feedbackSent && it.features && (it.pCode >= 0.5 ? "code" : "output") !== it.kind);
  if (!corrected.length) return 0;
  const all = store.get(STORE.corrections) || [];
  for (const it of corrected) {
    all.push({ x: it.features, label: it.kind, at: new Date().toISOString() });
    it.feedbackSent = true;
  }
  store.set(STORE.corrections, all);
  renderModel();
  return corrected.length;
}

// docx embeds PNG/JPEG/GIF/BMP; anything else (e.g. WebP) is re-encoded as PNG.
async function toDocxImage(file) {
  const bmp = await createImageBitmap(file);
  const meta = { width: bmp.width, height: bmp.height };
  const type = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp" }[file.type];
  if (type) {
    bmp.close();
    return { data: new Uint8Array(await file.arrayBuffer()), type, meta };
  }
  const cv = document.createElement("canvas");
  cv.width = meta.width;
  cv.height = meta.height;
  cv.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  return { data: new Uint8Array(await blob.arrayBuffer()), type: "png", meta };
}

generateBtn.addEventListener("click", async () => {
  const name = $("name").value.trim();
  if (!name) { alert("Please enter your name."); return; }
  if (!items.length) { alert("Please add at least one screenshot."); return; }
  if (items.some((it) => it.status === "pending" || it.status === "working")) { alert("Screenshots are still being analysed — try again in a moment."); return; }

  generateBtn.disabled = true;
  setStatus(generateStatus, "Generating document…");
  try {
    if (!window.docx) await loadScript("vendor/docx.js");
    const { groups } = computeGroups();
    const images = new Map();
    for (const it of items) images.set(it, await toDocxImage(it.file));
    const pick = (g, kind) => g.items.filter((it) => it.kind === kind).map((it) => images.get(it));
    const val = (id) => $(id).value.trim();
    const buffer = await D.buildDocument({
      name,
      batch: val("batch"),
      enrollment: val("enrollment"),
      subject: val("subject"),
      institute: val("institute"),
      includeIndex: $("includeIndex").checked,
      newPagePerPractical: $("newPagePerPractical").checked,
      captions: $("captions").checked,
      practicals: groups.map((g) => ({ number: g.number, aim: aimFor(g.number), codeImages: pick(g, "code"), outputImages: pick(g, "output") })),
    });

    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/\s+/g, "_")}_Practicals.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const learned = saveCorrections();
    setStatus(generateStatus, `Document generated with ${groups.length} practical(s).` + (learned ? ` Saved ${learned} label correction(s) — click "Retrain model" to teach the model.` : ""), "success");
  } catch (err) {
    setStatus(generateStatus, err.message, "error");
  } finally {
    generateBtn.disabled = false;
  }
});

// Offline support once deployed (service workers need HTTPS; skipped on http://localhost).
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* the app still works online */ });
}

loadModel().then(classifyPending);
