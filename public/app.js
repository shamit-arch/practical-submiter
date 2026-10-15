// Everything runs in this browser: the model, grouping, PDF parsing and the Word
// document. Nothing is uploaded anywhere. Shared logic lives in lib/ (window.PRB).
const { features: F, mlp, jev: J, aims: A, document: D, theme } = window.PRB;

let parsedAims = {}; // { number: aimText } from the PDF
const aimEdits = {}; // { number: aimText } typed by the user
// { id, file, url, pCode, features, kind, probs, userSet, split, status }
let items = [];
let nextId = 1;
const allItems = new Set(); // every item ever added, so object URLs can be released
const selected = new Set(); // item ids
let focusId = null; // keyboard cursor
let anchorId = null; // start of a Shift-click range

// A label the model is less sure about than this gets a "Check" badge.
const UNCERTAIN = 0.75;

const $ = (id) => document.getElementById(id);
const pdfInput = $("pdfInput");
const pdfStatus = $("pdfStatus");
const board = $("board");
const emptyState = $("emptyState");
const generateBtn = $("generateBtn");
const classifyStatus = $("classifyStatus");
const groupWarning = $("groupWarning");
const rangeStartEl = $("rangeStart");
const rangeEndEl = $("rangeEnd");
const rangeAutoTag = $("rangeAutoTag");
const detailsPanel = $("detailsPanel");
const bulkBar = $("bulkBar");
const viewerEl = $("viewer");
const modelDialog = $("modelDialog");
const shortcutsDialog = $("shortcutsDialog");
const dropOverlay = $("dropOverlay");

function setStatus(el, msg, kind = "") {
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, className = "", title = "") {
  const b = el("button", className, label);
  b.type = "button";
  if (title) b.title = title;
  return b;
}

const ICONS = {
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ------------------------------------------------------------------ toasts

function toast(msg, { kind = "", action, timeout = 4500 } = {}) {
  const box = $("toasts");
  const t = el("div", "toast" + (kind ? " " + kind : ""));
  t.setAttribute("role", kind === "error" ? "alert" : "status");
  t.append(el("span", "", msg));
  const close = () => t.remove();
  if (action) {
    const b = button(action.label);
    b.addEventListener("click", () => { close(); action.run(); });
    t.append(b);
  }
  const x = button("✕", "x", "Dismiss");
  x.addEventListener("click", close);
  t.append(x);
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(close, timeout);
}

// ------------------------------------------------------------------ browser storage
// Corrections, a retrained model and the report details are kept per browser (localStorage).

const STORE = { model: "prb.model.v1", corrections: "prb.corrections.v1", details: "prb.details.v1" };
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

// ------------------------------------------------------------------ helpers

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
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

// ------------------------------------------------------------------ model

const pct = (v) => (v == null ? "–" : `${Math.round(v * 100)}%`);
let builtInModel = null;
let jev = null;
let modelFailed = false;

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
    modelFailed = true;
    $("modelDot").className = "dot error";
    $("modelChip").textContent = "Model unavailable";
    setStatus($("modelStats"), "Model unavailable: " + err.message + ". Label screenshots by hand.", "error");
  }
}

function renderModel() {
  const m = jev.model;
  const custom = !!store.get(STORE.model);
  const corrections = (store.get(STORE.corrections) || []).length;
  $("modelDot").className = "dot ready";
  $("modelChip").textContent = custom ? "Model ready · retrained" : "Model ready";
  $("modelName").textContent = `${m.name} v${m.version}${custom ? " · retrained here" : ""}`;
  const stats = [
    [pct(m.metrics?.freshSamplesAccuracy), "accuracy on new screenshots"],
    [pct(m.metrics?.unseenStylesAccuracy), "on unseen editor styles"],
    [String(corrections), "corrections saved here"],
  ];
  $("modelStatGrid").replaceChildren(...stats.map(([v, l]) => {
    const s = el("div", "stat");
    s.append(el("div", "v", v), el("div", "l", l));
    return s;
  }));
  const s = m.samples || {};
  $("modelStats").textContent =
    `Trained ${new Date(m.trainedAt).toLocaleString()} on ${s.synthetic || 0} synthetic + ` +
    `${(s.userCorrections || 0) + (s.trainingData || 0)} real screenshots.`;
  $("resetModelBtn").classList.toggle("hidden", !custom && !corrections);
}

$("modelBtn").addEventListener("click", () => modelDialog.showModal());

$("retrainBtn").addEventListener("click", async () => {
  const btn = $("retrainBtn");
  const corrections = store.get(STORE.corrections) || [];
  if (!jev) return;
  if (!corrections.length) {
    setStatus($("retrainStatus"), "No corrections yet. Fix any wrong labels, generate the document, then retrain.", "error");
    return;
  }
  btn.disabled = true;
  setStatus($("retrainStatus"), `Retraining with ${corrections.length} correction(s)…`, "busy");
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

// ------------------------------------------------------------------ dialogs + theme

for (const dlg of [modelDialog, shortcutsDialog]) {
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });
}
$("shortcutsBtn").addEventListener("click", () => shortcutsDialog.showModal());
theme.bindToggle($("themeBtn"));

// ------------------------------------------------------------------ report details (remembered)

const DETAIL_TEXT = ["name", "batch", "enrollment", "subject", "institute"];
const DETAIL_CHECKS = ["includeIndex", "newPagePerPractical", "captions"];

function saveDetails() {
  const d = {};
  for (const id of DETAIL_TEXT) d[id] = $(id).value;
  for (const id of DETAIL_CHECKS) d[id] = $(id).checked;
  store.set(STORE.details, d);
  updateDetailsSub();
}

function restoreDetails() {
  const d = store.get(STORE.details) || {};
  for (const id of DETAIL_TEXT) if (typeof d[id] === "string") $(id).value = d[id];
  for (const id of DETAIL_CHECKS) if (typeof d[id] === "boolean") $(id).checked = d[id];
  updateDetailsSub();
}

function updateDetailsSub() {
  $("detailsSub").textContent = $("name").value.trim() || "Name needed";
}

for (const id of DETAIL_TEXT) $(id).addEventListener("input", saveDetails);
for (const id of DETAIL_CHECKS) $(id).addEventListener("change", saveDetails);
$("name").addEventListener("input", () => $("name").classList.remove("invalid"));

restoreDetails();
// On small screens the details collapse once they're filled in, so the screenshots come first.
if (matchMedia("(max-width: 959px)").matches && $("name").value.trim()) detailsPanel.open = false;

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

async function loadPdf(file) {
  $("pdfTitle").textContent = file.name;
  setStatus(pdfStatus, "Reading PDF…", "busy");
  try {
    parsedAims = A.parsePracticalsFromText(await readPdfText(file));
    const nums = Object.keys(parsedAims).map(Number);
    setStatus(pdfStatus, nums.length ? `Found ${nums.length} numbered aim(s).` : "No numbered aims found in this PDF.", nums.length ? "success" : "error");
    if (nums.length && !rangeStartEl.dataset.userEdited && !rangeEndEl.dataset.userEdited) {
      rangeStartEl.value = Math.min(...nums);
      rangeEndEl.value = Math.max(...nums);
      rangeAutoTag.textContent = "· from PDF";
      rangeAutoTag.className = "auto-tag auto";
    }
    decide();
  } catch (err) {
    setStatus(pdfStatus, "Could not read the PDF: " + err.message, "error");
  }
}

pdfInput.addEventListener("change", () => {
  if (pdfInput.files[0]) loadPdf(pdfInput.files[0]);
  pdfInput.value = "";
});

for (const input of [rangeStartEl, rangeEndEl]) {
  input.addEventListener("input", () => {
    input.dataset.userEdited = "true";
    rangeAutoTag.textContent = "· manual";
    rangeAutoTag.className = "auto-tag manual";
    decide();
  });
}

// ------------------------------------------------------------------ classification

async function classifyPending() {
  const pending = items.filter((it) => it.status === "pending");
  if (!pending.length) return;
  if (modelFailed) {
    pending.forEach((it) => { it.status = "error"; it.pCode = 0.5; });
    decide();
    return;
  }
  if (!jev) return; // loadModel() runs this again once the model is ready
  pending.forEach((it) => (it.status = "working"));
  render();
  setStatus(classifyStatus, `Analysing ${pending.length} screenshot(s)…`, "busy");
  try {
    const results = await jev.analyze(pending.map((it) => it.file), (done, total) =>
      setStatus(classifyStatus, `Analysing ${done} of ${total}…`, "busy"));
    results.forEach((r, i) => Object.assign(pending[i], { pCode: r.pCode, features: r.x, status: "done" }));
    setStatus(classifyStatus, "");
  } catch (err) {
    pending.forEach((it) => { if (it.status !== "done") { it.status = "error"; it.pCode = 0.5; } });
    setStatus(classifyStatus, err.message + " — label the screenshots by hand.", "error");
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

const isKnown = (it) => it.kind === "code" || it.kind === "output";
const isUncertain = (it) => isKnown(it) && !it.userSet && !!it.probs && it.probs[it.kind] < UNCERTAIN;
const byId = (id) => items.find((it) => it.id === id);

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

// ------------------------------------------------------------------ undo / redo
// Every edit to the screenshot list is one undoable step: a snapshot of the order and of
// each screenshot's label and split flag.

const undoStack = [];
const redoStack = [];

function snapshot() {
  return { items: items.slice(), state: items.map((it) => ({ kind: it.kind, userSet: it.userSet, split: it.split })) };
}

function restore(snap) {
  items = snap.items.slice();
  snap.items.forEach((it, i) => Object.assign(it, snap.state[i]));
}

function change(fn) {
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  fn();
  afterChange();
}

function undo() {
  if (!undoStack.length) { toast("Nothing to undo"); return; }
  redoStack.push(snapshot());
  restore(undoStack.pop());
  afterChange();
  classifyPending();
}

function redo() {
  if (!redoStack.length) { toast("Nothing to redo"); return; }
  undoStack.push(snapshot());
  restore(redoStack.pop());
  afterChange();
}

function afterChange() {
  const ids = new Set(items.map((it) => it.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  if (focusId != null && !ids.has(focusId)) focusId = null;
  // Removed screenshots keep their image until no undo/redo step can bring them back.
  const live = new Set(items);
  for (const s of [...undoStack, ...redoStack]) for (const it of s.items) live.add(it);
  for (const it of allItems) {
    if (!live.has(it)) { URL.revokeObjectURL(it.url); allItems.delete(it); }
  }
  decide();
}

// ------------------------------------------------------------------ edits

function setKind(list, kind) {
  if (!list.length) return;
  change(() => list.forEach((it) => { it.kind = kind; it.userSet = true; }));
}

function flip(list) {
  list = list.filter(isKnown);
  if (!list.length) return;
  change(() => list.forEach((it) => { it.kind = it.kind === "code" ? "output" : "code"; it.userSet = true; }));
}

function groupStarts() {
  return new Set(computeGroups().groups.map((g) => g.items[0]));
}

// Toggles whether a practical starts at this screenshot.
function toggleSplit(it) {
  if (items.indexOf(it) <= 0) return;
  const starts = groupStarts().has(it);
  change(() => { it.split = !starts; });
}

function splitAt(list) {
  list = list.filter((it) => items.indexOf(it) > 0);
  if (!list.length) return;
  change(() => list.forEach((it) => { it.split = true; }));
}

// Joins the practical containing `it` onto the one before it.
function mergeWithPrevious(it) {
  const g = computeGroups().groups.find((gr) => gr.items.includes(it));
  const first = g && g.items[0];
  if (!first || items.indexOf(first) <= 0) return;
  change(() => { first.split = false; });
}

// Puts everything from the first to the last selected screenshot in one practical.
function mergeRange(list) {
  const idx = list.map((it) => items.indexOf(it)).sort((a, b) => a - b);
  if (idx.length < 2) return;
  change(() => { for (let i = idx[0] + 1; i <= idx[idx.length - 1]; i++) items[i].split = false; });
}

function removeItems(list) {
  if (!list.length) return;
  const drop = new Set(list);
  let nextFocus = null;
  if (focusId != null && drop.has(byId(focusId))) {
    const start = items.indexOf(byId(focusId));
    nextFocus = items.slice(start).find((it) => !drop.has(it)) || items.slice(0, start).reverse().find((it) => !drop.has(it));
  }
  change(() => { items = items.filter((it) => !drop.has(it)); });
  if (nextFocus) { focusId = nextFocus.id; syncSelection(); }
  toast(`Removed ${list.length} screenshot${list.length > 1 ? "s" : ""}`, { action: { label: "Undo", run: undo } });
}

// What the keyboard and bulk bar act on: the selection, or else the focused screenshot.
function targets() {
  if (selected.size) return items.filter((it) => selected.has(it.id));
  const f = byId(focusId);
  return f ? [f] : [];
}

// ------------------------------------------------------------------ rendering

function render() {
  const { groups, nums } = computeGroups();
  const refocus = rememberFocus();

  board.replaceChildren();
  let idx = 0;
  groups.forEach((g, gi) => {
    board.append(practicalCard(g, gi, idx));
    idx += g.items.length;
  });

  const has = items.length > 0;
  emptyState.classList.toggle("hidden", has);
  $("addBtn").classList.toggle("hidden", !has);
  $("reviewAllBtn").classList.toggle("hidden", !has);

  const uncertain = items.filter(isUncertain).length;
  const reviewBtn = $("reviewBtn");
  reviewBtn.classList.toggle("hidden", !uncertain);
  reviewBtn.textContent = `Review ${uncertain} to check`;
  reviewBtn.title = "Step through only the screenshots the model is unsure about";

  $("summary").innerHTML = has
    ? `<b>${items.length}</b> screenshot${items.length > 1 ? "s" : ""} · <b>${groups.length}</b> practical${groups.length > 1 ? "s" : ""}` +
      (uncertain ? ` · <span class="warn-text">${uncertain} to check</span>` : "")
    : "";

  if (has && nums && groups.length !== nums.length) {
    groupWarning.textContent = `Found ${groups.length} practical(s) in the screenshots, but the range ${nums[0]}–${nums[nums.length - 1]} has ${nums.length}. Check the labels, or use ✂ Split / Merge to fix the grouping.`;
    groupWarning.classList.remove("hidden");
  } else groupWarning.classList.add("hidden");

  syncSelection();
  refocus();
  renderViewer();
}

// Re-rendering replaces the DOM, so keep the caret in an aim box or the focus on a thumbnail.
function rememberFocus() {
  const a = document.activeElement;
  if (a && a.classList.contains("aim")) {
    const n = a.dataset.number;
    const [s, e] = [a.selectionStart, a.selectionEnd];
    return () => {
      const b = board.querySelector(`.aim[data-number="${n}"]`);
      if (b) { b.focus({ preventScroll: true }); b.setSelectionRange(s, e); }
    };
  }
  if (a && board.contains(a)) return () => focusEl()?.focus({ preventScroll: true });
  return () => {};
}

function practicalCard(g, gi, startIdx) {
  const card = el("section", "practical" + (g.outOfRange ? " out" : ""));
  const head = el("div", "practical-head");
  const aim = el("input", "aim");
  aim.type = "text";
  aim.dataset.number = g.number;
  aim.placeholder = "Aim — type it, or leave blank to fill in by hand";
  aim.setAttribute("aria-label", `Aim of practical ${g.number}`);
  aim.value = aimFor(g.number);
  aim.addEventListener("input", () => { aimEdits[g.number] = aim.value; });

  const codeN = g.items.filter((it) => it.kind === "code").length;
  const outN = g.items.filter((it) => it.kind === "output").length;
  const ready = g.items.every(isKnown);
  const meta = el("span", "p-meta");
  meta.textContent = `${codeN} code · ${outN} output` + (g.outOfRange ? " · outside range" : "");
  if (ready && (!codeN || !outN)) {
    meta.classList.add("warn-text");
    meta.title = codeN ? "This practical has no output screenshot" : "This practical has no source code screenshot";
  }
  head.append(el("span", "p-badge", `Practical ${g.number}`), aim, meta);
  if (gi > 0) {
    const merge = button("Merge with previous", "small ghost", "Join this practical onto the previous one (M)");
    merge.addEventListener("click", () => mergeWithPrevious(g.items[0]));
    head.append(merge);
  }

  const grid = el("div", "thumbs");
  g.items.forEach((it, j) => grid.append(thumbFor(it, startIdx + j, j > 0)));
  card.append(head, grid);
  return card;
}

function thumbFor(it, idx, canSplit) {
  const item = el("div", "thumb-item" + (isUncertain(it) ? " uncertain" : ""));
  item.draggable = true;
  item.dataset.id = it.id;
  item.tabIndex = -1;
  item.setAttribute("aria-label", `Screenshot ${idx + 1}${isKnown(it) ? ", " + it.kind : ""}`);

  const thumb = el("div", "thumb");
  const img = el("img");
  img.src = it.url;
  img.alt = it.file.name;
  img.draggable = false;
  img.loading = "lazy";
  thumb.append(img, el("span", "thumb-num", `#${idx + 1}`));
  if (isUncertain(it)) {
    const badge = el("span", "check-badge", "Check");
    badge.title = `The model is only ${pct(it.probs[it.kind])} sure — confirm or flip the label`;
    thumb.append(badge);
  }

  const actions = el("div", "thumb-actions");
  const view = button("", "", "Full-screen review (Enter)");
  view.innerHTML = icon("expand");
  view.setAttribute("aria-label", "Open full-screen review");
  view.addEventListener("click", () => openViewer(it.id));
  const rm = button("", "rm", "Remove (Delete)");
  rm.innerHTML = icon("x");
  rm.setAttribute("aria-label", "Remove screenshot");
  rm.addEventListener("click", () => removeItems([it]));
  actions.append(view, rm);
  thumb.append(actions);

  if (it.status === "working" || it.status === "pending") {
    const busy = el("div", "thumb-busy");
    busy.append(el("span", "spinner"), el("span", "", "Analysing…"));
    thumb.append(busy);
  }

  const seg = el("div", "seg");
  for (const kind of ["code", "output"]) {
    const on = it.kind === kind;
    const b = button(kind === "code" ? "CODE" : "OUTPUT", kind + (on ? " on" : ""));
    b.setAttribute("aria-pressed", String(on));
    if (on && (it.userSet || it.probs)) b.append(el("span", "conf", it.userSet ? "✓" : pct(it.probs[kind])));
    b.title = on
      ? it.userSet ? "Set by you" : "Model's label — click to confirm it"
      : `Mark as ${kind === "code" ? "source code" : "output"} (${kind === "code" ? "C" : "O"})`;
    b.addEventListener("click", () => setKind([it], kind));
    seg.append(b);
  }

  item.append(thumb, seg);

  if (canSplit) {
    const split = button("", "split-handle", "Start a new practical here (S)");
    split.innerHTML = icon("scissors");
    split.setAttribute("aria-label", "Start a new practical here");
    split.addEventListener("click", () => splitAt([it]));
    item.append(split);
  }

  item.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    clickSelect(it, e);
  });
  item.addEventListener("dblclick", (e) => {
    if (!e.target.closest("button")) openViewer(it.id);
  });
  item.addEventListener("focus", () => {
    if (focusId !== it.id) { focusId = it.id; syncSelection(); }
  });
  return item;
}

// ------------------------------------------------------------------ selection

function clickSelect(it, e) {
  const multi = e.ctrlKey || e.metaKey;
  if (e.shiftKey && anchorId != null && byId(anchorId)) {
    const [a, b] = [items.indexOf(byId(anchorId)), items.indexOf(it)].sort((x, y) => x - y);
    if (!multi) selected.clear();
    for (let i = a; i <= b; i++) selected.add(items[i].id);
  } else if (multi) {
    if (selected.has(it.id)) selected.delete(it.id);
    else selected.add(it.id);
    anchorId = it.id;
  } else {
    const only = selected.size === 1 && selected.has(it.id);
    selected.clear();
    if (!only) selected.add(it.id);
    anchorId = it.id;
  }
  focusId = it.id;
  syncSelection();
}

function clearSelection() {
  selected.clear();
  syncSelection();
}

const focusEl = () => (focusId == null ? null : board.querySelector(`.thumb-item[data-id="${focusId}"]`));

function syncSelection() {
  const els = board.querySelectorAll(".thumb-item");
  els.forEach((node, i) => {
    const id = Number(node.dataset.id);
    node.classList.toggle("selected", selected.has(id));
    node.classList.toggle("focused", id === focusId);
    node.tabIndex = id === focusId || (focusId == null && i === 0) ? 0 : -1;
  });
  const n = selected.size;
  bulkBar.classList.toggle("hidden", !n);
  document.body.classList.toggle("has-selection", !!n);
  $("bulkCount").textContent = `${n} selected`;
  bulkBar.querySelector('[data-bulk="merge"]').classList.toggle("hidden", n < 2);
}

function moveFocus(key, extend) {
  const els = [...board.querySelectorAll(".thumb-item")];
  if (!els.length) return;
  const cur = focusEl();
  let next;
  if (!cur) next = els[0];
  else if (key === "ArrowLeft" || key === "ArrowRight") {
    next = els[els.indexOf(cur) + (key === "ArrowRight" ? 1 : -1)];
  } else {
    // Up/down: the nearest row above/below, then the closest thumbnail in it.
    const r = cur.getBoundingClientRect();
    const down = key === "ArrowDown";
    const cands = els.map((node) => ({ node, r: node.getBoundingClientRect() }))
      .filter((c) => (down ? c.r.top >= r.bottom - 1 : c.r.bottom <= r.top + 1));
    if (cands.length) {
      const rowTop = down ? Math.min(...cands.map((c) => c.r.top)) : Math.max(...cands.map((c) => c.r.top));
      const cx = r.left + r.width / 2;
      next = cands.filter((c) => Math.abs(c.r.top - rowTop) < 8)
        .sort((p, q) => Math.abs(p.r.left + p.r.width / 2 - cx) - Math.abs(q.r.left + q.r.width / 2 - cx))[0].node;
    }
  }
  if (!next) return;
  const id = Number(next.dataset.id);
  if (extend) {
    if (focusId != null) selected.add(focusId);
    selected.add(id);
  }
  focusId = id;
  anchorId = id;
  syncSelection();
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

bulkBar.addEventListener("click", (e) => {
  const b = e.target.closest("[data-bulk]");
  if (!b) return;
  const list = targets();
  switch (b.dataset.bulk) {
    case "code": setKind(list, "code"); break;
    case "output": setKind(list, "output"); break;
    case "split": splitAt(list); break;
    case "merge": mergeRange(list); break;
    case "remove": removeItems(list); break;
    case "clear": clearSelection(); break;
  }
});

board.addEventListener("click", (e) => {
  if (!e.target.closest(".thumb-item, .practical-head")) clearSelection();
});

// ------------------------------------------------------------------ drag to reorder

let dragId = null;

board.addEventListener("dragstart", (e) => {
  const node = e.target.closest(".thumb-item");
  if (!node) return;
  dragId = Number(node.dataset.id);
  node.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "");
});

board.addEventListener("dragover", (e) => {
  if (dragId == null) return;
  e.preventDefault();
  const dragging = board.querySelector(".dragging");
  if (!dragging) return;
  const others = [...board.querySelectorAll(".thumb-item:not(.dragging)")];
  const next = others.find((sib) => {
    const r = sib.getBoundingClientRect();
    return e.clientY < r.bottom && (e.clientY < r.top || e.clientX < r.left + r.width / 2);
  });
  if (next) next.parentNode.insertBefore(dragging, next);
  else if (others.length) others[others.length - 1].parentNode.appendChild(dragging);
});

board.addEventListener("drop", (e) => {
  if (dragId == null) return;
  e.preventDefault();
  dragId = null;
  const order = [...board.querySelectorAll(".thumb-item")].map((node) => byId(Number(node.dataset.id)));
  if (order.every((it, i) => it === items[i])) { render(); return; }
  change(() => { items = order; });
});

board.addEventListener("dragend", () => {
  if (dragId == null) return; // dropped: already handled
  dragId = null;
  render(); // cancelled: put the DOM back
});

// ------------------------------------------------------------------ full-screen review

const viewer = { ids: [], pos: 0, mode: "all" };

function openViewer(startId, mode = "all") {
  const list = mode === "uncertain" ? items.filter(isUncertain) : items;
  if (!list.length) return;
  viewer.ids = list.map((it) => it.id);
  viewer.pos = Math.max(0, viewer.ids.indexOf(startId));
  viewer.mode = mode;
  viewerEl.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderViewer();
  $("viewerClose").focus({ preventScroll: true });
}

function closeViewer() {
  if (viewerEl.classList.contains("hidden")) return;
  const id = viewer.ids[viewer.pos];
  viewerEl.classList.add("hidden");
  document.body.style.overflow = "";
  if (byId(id)) {
    focusId = id;
    syncSelection();
    const node = focusEl();
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: "center" });
  }
}

const viewerItem = () => byId(viewer.ids[viewer.pos]);

function renderViewer() {
  if (viewerEl.classList.contains("hidden")) return;
  // Screenshots removed while reviewing drop out of the list; the next one takes their place.
  const cur = viewer.ids[viewer.pos];
  const before = viewer.ids.slice(0, viewer.pos).filter((id) => byId(id)).length;
  viewer.ids = viewer.ids.filter((id) => byId(id));
  if (!viewer.ids.length) { closeViewer(); return; }
  viewer.pos = byId(cur) ? viewer.ids.indexOf(cur) : Math.min(before, viewer.ids.length - 1);

  const it = viewerItem();
  const index = items.indexOf(it);
  const g = computeGroups().groups.find((gr) => gr.items.includes(it));
  const starts = g.items[0] === it;
  const img = $("viewerImg");
  if (img.getAttribute("src") !== it.url) img.src = it.url;
  img.alt = it.file.name;

  $("viewerPos").textContent = `${viewer.pos + 1} / ${viewer.ids.length}${viewer.mode === "uncertain" ? " to check" : ""}`;
  $("viewerGroup").textContent = `Practical ${g.number} · #${index + 1}`;
  const conf = $("viewerConf");
  conf.textContent = !isKnown(it) ? "Analysing…" : it.userSet ? "✓ Set by you" : `Model ${pct(it.probs?.[it.kind])} sure`;
  conf.classList.toggle("warn", isUncertain(it));
  for (const b of $("viewerSeg").querySelectorAll("button")) {
    const on = it.kind === b.dataset.kind;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  const split = $("viewerSplit");
  split.disabled = index === 0;
  split.classList.toggle("pressed", starts && index > 0);
  split.firstChild.textContent = starts && index > 0 ? "✓ Starts a new practical " : "New practical starts here ";
  $("viewerPrev").disabled = viewer.pos === 0;
  $("viewerNext").disabled = viewer.pos === viewer.ids.length - 1;
}

function viewerStep(delta) {
  viewer.pos = Math.min(Math.max(viewer.pos + delta, 0), viewer.ids.length - 1);
  renderViewer();
}

// Labels the current screenshot and moves on, so a whole report can be checked with C / O.
function viewerLabel(kind) {
  const it = viewerItem();
  if (!it) return;
  setKind([it], kind);
  if (viewer.pos < viewer.ids.length - 1) viewerStep(1);
  else toast(viewer.mode === "uncertain" ? "All flagged screenshots checked." : "That was the last screenshot.", { kind: "success" });
}

$("viewerClose").addEventListener("click", closeViewer);
$("viewerPrev").addEventListener("click", () => viewerStep(-1));
$("viewerNext").addEventListener("click", () => viewerStep(1));
$("viewerSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (b) viewerLabel(b.dataset.kind);
});
$("viewerSplit").addEventListener("click", () => { const it = viewerItem(); if (it) toggleSplit(it); });
$("viewerRemove").addEventListener("click", () => { const it = viewerItem(); if (it) removeItems([it]); });
$("reviewAllBtn").addEventListener("click", () => openViewer(focusId ?? items[0]?.id));
$("reviewBtn").addEventListener("click", () => openViewer(items.find(isUncertain)?.id, "uncertain"));

function viewerKey(e) {
  const it = viewerItem();
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === "y") { e.preventDefault(); redo(); }
    return;
  }
  switch (e.key) {
    case "Escape": closeViewer(); break;
    case "ArrowLeft": case "ArrowUp": viewerStep(-1); break;
    case "ArrowRight": case "ArrowDown": viewerStep(1); break;
    case "c": case "C": viewerLabel("code"); break;
    case "o": case "O": viewerLabel("output"); break;
    case " ": if (it) flip([it]); break;
    case "s": case "S": if (it) toggleSplit(it); break;
    case "Delete": case "Backspace": if (it) removeItems([it]); break;
    default: return;
  }
  e.preventDefault();
}

// ------------------------------------------------------------------ keyboard

document.addEventListener("keydown", (e) => {
  if (!viewerEl.classList.contains("hidden")) { viewerKey(e); return; }
  if (document.querySelector("dialog[open]")) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "Enter") { e.preventDefault(); generate(); return; }

  const t = e.target;
  if (t.closest && t.closest("input, textarea, select, [contenteditable]")) {
    if (e.key === "Enter" && t.classList.contains("aim")) t.blur();
    if (e.key === "Escape") t.blur();
    return;
  }
  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === "y") { e.preventDefault(); redo(); }
    else if (k === "a" && items.length) {
      e.preventDefault();
      items.forEach((it) => selected.add(it.id));
      syncSelection();
    }
    return;
  }
  if (e.altKey) return;
  if (e.key === "?") { shortcutsDialog.showModal(); return; }
  if (!items.length) return;
  // Enter/Space on a focused button should press that button.
  if ((e.key === "Enter" || e.key === " ") && t.closest && t.closest("button")) return;

  const cur = byId(focusId);
  switch (e.key) {
    case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown":
      moveFocus(e.key, e.shiftKey); break;
    case "Escape": clearSelection(); break;
    case "Enter": openViewer(cur ? cur.id : items[0].id); break;
    case "c": case "C": setKind(targets(), "code"); break;
    case "o": case "O": setKind(targets(), "output"); break;
    case " ": flip(targets()); break;
    case "s": case "S":
      if (selected.size > 1) splitAt(targets());
      else if (cur) toggleSplit(cur);
      break;
    case "m": case "M": if (cur) mergeWithPrevious(cur); break;
    case "Delete": case "Backspace": removeItems(targets()); break;
    default: return;
  }
  e.preventDefault();
});

// ------------------------------------------------------------------ adding screenshots

function addScreenshots(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return 0;
  const added = files.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file), pCode: null, features: null, kind: null, probs: null, userSet: false, split: null, status: "pending" }));
  added.forEach((it) => allItems.add(it));
  change(() => { items = items.concat(added); });
  classifyPending();
  return files.length;
}

// Images become screenshots; a PDF becomes the practical list.
function handleFiles(fileList) {
  const files = Array.from(fileList);
  const pdf = files.find((f) => f.type === "application/pdf");
  if (pdf) loadPdf(pdf);
  const n = addScreenshots(files);
  if (!n && !pdf && files.length) toast("Only images (and the practical-list PDF) can be added.", { kind: "error" });
}

function openPicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.addEventListener("change", () => addScreenshots(input.files));
  input.click();
}

emptyState.addEventListener("click", openPicker);
emptyState.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
});
$("addBtn").addEventListener("click", openPicker);

// Dropping files anywhere on the page shows a full-window target.
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dropOverlay.classList.remove("hidden");
});
window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); }); // never navigate to a dropped file
dropOverlay.addEventListener("dragleave", (e) => { if (e.target === dropOverlay) dropOverlay.classList.add("hidden"); });
dropOverlay.addEventListener("drop", (e) => {
  e.preventDefault();
  dropOverlay.classList.add("hidden");
  handleFiles(e.dataTransfer.files);
});

document.addEventListener("paste", (e) => {
  const files = [];
  for (const item of e.clipboardData?.items || []) {
    if (item.type.startsWith("image/")) {
      const blob = item.getAsFile();
      if (blob) files.push(new File([blob], `pasted-${Date.now()}-${files.length}.png`, { type: blob.type }));
    }
  }
  if (files.length) {
    e.preventDefault();
    addScreenshots(files);
    toast(`Pasted ${files.length} screenshot${files.length > 1 ? "s" : ""}`);
  }
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
  if (jev) renderModel();
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

let generating = false;

async function generate() {
  if (generating) return;
  const nameEl = $("name");
  const name = nameEl.value.trim();
  if (!name) {
    detailsPanel.open = true;
    nameEl.classList.add("invalid");
    nameEl.focus();
    nameEl.scrollIntoView({ block: "center", behavior: "smooth" });
    toast("Enter your name first — it goes on the cover page.", { kind: "error" });
    return;
  }
  if (!items.length) { toast("Add your screenshots first.", { kind: "error" }); return; }
  if (items.some((it) => it.status === "pending" || it.status === "working")) {
    toast("Still analysing screenshots — try again in a moment.");
    return;
  }

  generating = true;
  const original = generateBtn.innerHTML;
  generateBtn.disabled = true;
  generateBtn.innerHTML = '<span class="spinner"></span><span></span>';
  const progress = (msg) => { generateBtn.lastChild.textContent = msg; };
  try {
    progress("Preparing…");
    if (!window.docx) await loadScript("vendor/docx.js");
    const { groups } = computeGroups();
    const images = new Map();
    for (const [i, it] of items.entries()) {
      progress(`Image ${i + 1}/${items.length}`);
      images.set(it, await toDocxImage(it.file));
    }
    progress("Building…");
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
    toast(
      `Downloaded ${a.download} — ${groups.length} practical(s).` + (learned ? ` Saved ${learned} label correction(s) for retraining.` : ""),
      { kind: "success", timeout: 8000, action: learned ? { label: "Retrain…", run: () => modelDialog.showModal() } : undefined },
    );
  } catch (err) {
    toast("Could not generate the document: " + err.message, { kind: "error", timeout: 9000 });
  } finally {
    generateBtn.innerHTML = original;
    generateBtn.disabled = false;
    generating = false;
  }
}

generateBtn.addEventListener("click", generate);

// Offline support once deployed (service workers need HTTPS; skipped on http://localhost).
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* the app still works online */ });
}

render();
loadModel().then(classifyPending);
