let parsedAims = {}; // { number: aimText }
let screenshots = []; // ordered array of File, as dumped by the user

const pdfInput = document.getElementById("pdfInput");
const pdfStatus = document.getElementById("pdfStatus");
const aimsPreview = document.getElementById("aimsPreview");
const bulkDropzone = document.getElementById("bulkDropzone");
const thumbGrid = document.getElementById("thumbGrid");
const generateBtn = document.getElementById("generateBtn");
const generateStatus = document.getElementById("generateStatus");
const rangeStartEl = document.getElementById("rangeStart");
const rangeEndEl = document.getElementById("rangeEnd");
const perPracticalEl = document.getElementById("perPractical");
const rangeAutoTag = document.getElementById("rangeAutoTag");
const perPracticalAutoTag = document.getElementById("perPracticalAutoTag");

function getRange() {
  const start = parseInt(rangeStartEl.value, 10);
  const end = parseInt(rangeEndEl.value, 10);
  if (!start || !end || end < start) return null;
  const nums = [];
  for (let n = start; n <= end; n++) nums.push(n);
  return nums;
}

function renderAimsPreview() {
  const nums = getRange();
  aimsPreview.innerHTML = "";
  if (!nums) return;
  for (const n of nums) {
    const row = document.createElement("div");
    const aim = parsedAims[n];
    row.className = "aim-row" + (aim ? "" : " missing");
    row.innerHTML = `<b>Practical ${n}:</b> ${aim ? aim : "aim not found in PDF — will be left blank"}`;
    aimsPreview.appendChild(row);
  }
}

pdfInput.addEventListener("change", async () => {
  const file = pdfInput.files[0];
  if (!file) return;
  pdfStatus.textContent = "Parsing PDF...";
  pdfStatus.className = "status";
  try {
    const fd = new FormData();
    fd.append("pdf", file);
    const res = await fetch("/api/parse-pdf", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to parse PDF");
    parsedAims = data.aims || {};
    const count = Object.keys(parsedAims).length;
    pdfStatus.textContent = `Found ${count} numbered aim(s) in the PDF.`;
    pdfStatus.className = "status success";
    autoFillRangeFromAims();
    renderAimsPreview();
    updatePerPracticalAuto();
    renderThumbGrid();
  } catch (err) {
    pdfStatus.textContent = err.message;
    pdfStatus.className = "status error";
  }
});

function autoFillRangeFromAims() {
  const nums = Object.keys(parsedAims).map(Number);
  if (nums.length === 0) return;
  if (!rangeStartEl.dataset.userEdited && !rangeEndEl.dataset.userEdited) {
    rangeStartEl.value = Math.min(...nums);
    rangeEndEl.value = Math.max(...nums);
    rangeAutoTag.textContent = "(auto-detected from PDF)";
    rangeAutoTag.className = "optional auto";
  }
}

function updatePerPracticalAuto() {
  const nums = getRange();
  if (perPracticalEl.dataset.userEdited) {
    perPracticalAutoTag.textContent = "(manual)";
    perPracticalAutoTag.className = "optional manual";
    return;
  }
  if (!nums || screenshots.length === 0) {
    perPracticalAutoTag.textContent = "";
    return;
  }
  if (screenshots.length % nums.length === 0) {
    perPracticalEl.value = screenshots.length / nums.length;
    perPracticalAutoTag.textContent = "(auto-detected)";
    perPracticalAutoTag.className = "optional auto";
  } else {
    perPracticalAutoTag.textContent = "(couldn't auto-detect — please check)";
    perPracticalAutoTag.className = "optional manual";
  }
}

rangeStartEl.addEventListener("input", () => {
  rangeStartEl.dataset.userEdited = "true";
  rangeAutoTag.textContent = "(manual)";
  rangeAutoTag.className = "optional manual";
  renderAimsPreview(); updatePerPracticalAuto(); renderThumbGrid();
});
rangeEndEl.addEventListener("input", () => {
  rangeEndEl.dataset.userEdited = "true";
  rangeAutoTag.textContent = "(manual)";
  rangeAutoTag.className = "optional manual";
  renderAimsPreview(); updatePerPracticalAuto(); renderThumbGrid();
});
perPracticalEl.addEventListener("input", () => {
  perPracticalEl.dataset.userEdited = "true";
  perPracticalAutoTag.textContent = "(manual)";
  perPracticalAutoTag.className = "optional manual";
  renderThumbGrid();
});
document.getElementById("firstIsCode").addEventListener("change", renderThumbGrid);

function slotLabelFor(index) {
  const perPractical = Math.max(1, parseInt(perPracticalEl.value, 10) || 1);
  const firstIsCode = document.getElementById("firstIsCode").checked;
  const nums = getRange();
  if (!nums) return `#${index + 1}`;
  const practicalIdx = Math.floor(index / perPractical);
  const posInGroup = index % perPractical;
  if (practicalIdx >= nums.length) return "Unused (out of range)";
  const num = nums[practicalIdx];
  if (perPractical === 1) return `Practical ${num}`;
  if (firstIsCode) {
    return posInGroup === 0 ? `Practical ${num} — Code` : `Practical ${num} — Output`;
  }
  return `Practical ${num} — #${posInGroup + 1}`;
}

function renderThumbGrid() {
  thumbGrid.innerHTML = "";
  screenshots.forEach((file, idx) => {
    const item = document.createElement("div");
    item.className = "thumb-item";
    item.draggable = true;
    item.dataset.idx = idx;

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove";
    removeBtn.type = "button";
    removeBtn.textContent = "x";
    removeBtn.addEventListener("click", () => {
      screenshots.splice(idx, 1);
      updatePerPracticalAuto();
      renderThumbGrid();
    });
    thumb.appendChild(img);
    thumb.appendChild(removeBtn);

    const tag = document.createElement("span");
    tag.className = "thumb-tag";
    tag.textContent = `${idx + 1}. ${slotLabelFor(idx)}`;

    item.appendChild(thumb);
    item.appendChild(tag);
    thumbGrid.appendChild(item);

    item.addEventListener("dragstart", () => item.classList.add("dragging"));
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
  });
}

thumbGrid.addEventListener("dragover", (e) => {
  e.preventDefault();
  const dragging = thumbGrid.querySelector(".dragging");
  if (!dragging) return;
  const siblings = [...thumbGrid.querySelectorAll(".thumb-item:not(.dragging)")];
  const next = siblings.find((sib) => {
    const rect = sib.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 && e.clientX < rect.left + rect.width;
  }) || siblings.find((sib) => {
    const rect = sib.getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2;
  });
  if (next) thumbGrid.insertBefore(dragging, next);
  else thumbGrid.appendChild(dragging);
});

thumbGrid.addEventListener("drop", () => {
  const newOrder = [...thumbGrid.querySelectorAll(".thumb-item")].map((el) => screenshots[parseInt(el.dataset.idx, 10)]);
  screenshots = newOrder;
  renderThumbGrid();
});

function addScreenshots(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (files.length === 0) return;
  screenshots.push(...files);
  updatePerPracticalAuto();
  renderThumbGrid();
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
bulkDropzone.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const blob = item.getAsFile();
      if (blob) files.push(blob);
    }
  }
  if (files.length) addScreenshots(files);
});
document.addEventListener("paste", (e) => {
  if (document.activeElement === bulkDropzone) return; // already handled above
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const blob = item.getAsFile();
      if (blob) files.push(blob);
    }
  }
  if (files.length) addScreenshots(files);
});

generateBtn.addEventListener("click", async () => {
  const name = document.getElementById("name").value.trim();
  const batch = document.getElementById("batch").value.trim();
  const enrollment = document.getElementById("enrollment").value.trim();
  const nums = getRange();
  const perPractical = Math.max(1, parseInt(perPracticalEl.value, 10) || 1);
  const firstIsCode = document.getElementById("firstIsCode").checked;

  if (!name) { alert("Please enter your name."); return; }
  if (!nums) { alert("Please enter a valid practical number range."); return; }
  if (screenshots.length === 0) { alert("Please add at least one screenshot."); return; }

  generateBtn.disabled = true;
  generateStatus.textContent = "Generating document...";
  generateStatus.className = "status";

  try {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("batch", batch);
    fd.append("enrollment", enrollment);
    fd.append("perPractical", String(perPractical));
    fd.append("firstIsCode", String(firstIsCode));
    const meta = nums.map((n) => ({ number: n, aim: parsedAims[n] || "" }));
    fd.append("practicals", JSON.stringify(meta));
    screenshots.forEach((file) => fd.append("screenshots", file));

    const res = await fetch("/api/generate", { method: "POST", body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to generate document");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/\s+/g, "_")}_Practicals.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    generateStatus.textContent = "Document generated and downloaded.";
    generateStatus.className = "status success";
  } catch (err) {
    generateStatus.textContent = err.message;
    generateStatus.className = "status error";
  } finally {
    generateBtn.disabled = false;
  }
});
