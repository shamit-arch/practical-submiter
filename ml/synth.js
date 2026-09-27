// Renders synthetic screenshots for training: code editors/IDEs on one side,
// consoles, browsers, GUI windows and plots on the other. Every theme has a name
// so train.js can hold some out and measure generalisation to unseen styles.
const { createCanvas } = require("@napi-rs/canvas");
const { LANGS, codeLines, consoleTranscript, outputBody, sentence, cap, NOUNS, VERBS, CLASSES } = require("./corpus");

const MONO = ["Consolas", "Courier New", "Lucida Console"];
const UI = ["Segoe UI", "Arial", "Calibri", "Times New Roman"];

// ---------------------------------------------------------------- tokenizer

function tokenize(line, lang) {
  const L = LANGS[lang];
  const toks = [];
  if (L.markup) {
    const re = /(<!--.*?-->)|(<\/?[\w!]+)|(\s[\w-]+=)|("[^"]*")|(\/?>)|([^<"]+)/g;
    let m;
    while ((m = re.exec(line))) {
      const cls = m[1] ? "comment" : m[2] ? "tag" : m[3] ? "attr" : m[4] ? "string" : m[5] ? "tag" : "default";
      toks.push({ text: m[0], cls });
    }
    return toks;
  }
  const trimmed = line.trimStart();
  if ((L.preproc && trimmed.startsWith("#")) || trimmed.startsWith("<?php") || trimmed.startsWith("?>")) {
    return [{ text: line, cls: "preproc" }];
  }
  const re = /(\s+)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(\/\/.*|#.*|--.*|\/\*.*?\*\/)|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|(.)/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1]) toks.push({ text: m[1], cls: "ws" });
    else if (m[2]) toks.push({ text: m[2], cls: "string" });
    else if (m[3]) {
      const c = m[3];
      const isComment = (L.lineComment && c.startsWith(L.lineComment)) || c.startsWith("/*");
      if (isComment) { toks.push({ text: line.slice(m.index), cls: "comment" }); break; }
      toks.push({ text: c[0], cls: "punct" });
      re.lastIndex = m.index + 1;
    } else if (m[4]) toks.push({ text: m[4], cls: "number" });
    else if (m[5]) {
      const w = m[5];
      const next = line.slice(re.lastIndex).trimStart()[0];
      const cls = L.keywords.includes(w) ? "keyword" : L.types.includes(w) ? "type" : next === "(" ? "func" : /^[A-Z]/.test(w) ? "type" : "default";
      toks.push({ text: w, cls });
    } else toks.push({ text: m[6], cls: "punct" });
  }
  return toks;
}

// ---------------------------------------------------------------- themes

const CODE_THEMES = [
  { name: "vscode-dark", bg: "#1e1e1e", fg: "#d4d4d4", gutterFg: "#858585", keyword: "#569cd6", type: "#4ec9b0", func: "#dcdcaa", string: "#ce9178", comment: "#6a9955", number: "#b5cea8", preproc: "#c586c0", tag: "#569cd6", attr: "#9cdcfe", punct: "#d4d4d4", guide: "#404040", hl: "#282828", chrome: { tab: "#252526", tabActive: "#1e1e1e", side: "#252526", sideFg: "#cccccc", status: "#007acc", statusFg: "#ffffff" } },
  { name: "vscode-light", bg: "#ffffff", fg: "#000000", gutterFg: "#237893", keyword: "#0000ff", type: "#267f99", func: "#795e26", string: "#a31515", comment: "#008000", number: "#098658", preproc: "#af00db", tag: "#800000", attr: "#e50000", punct: "#000000", guide: "#d3d3d3", hl: "#f3f3f3", chrome: { tab: "#f3f3f3", tabActive: "#ffffff", side: "#f3f3f3", sideFg: "#616161", status: "#007acc", statusFg: "#ffffff" } },
  { name: "darcula", bg: "#2b2b2b", fg: "#a9b7c6", gutterBg: "#313335", gutterFg: "#606366", keyword: "#cc7832", type: "#a9b7c6", func: "#ffc66d", string: "#6a8759", comment: "#808080", number: "#6897bb", preproc: "#bbb529", tag: "#e8bf6a", attr: "#bababa", punct: "#cc7832", hl: "#323232", chrome: { tab: "#3c3f41", tabActive: "#4e5254", side: "#3c3f41", sideFg: "#bbbbbb", status: "#3c3f41", statusFg: "#bbbbbb" } },
  { name: "intellij-light", bg: "#ffffff", fg: "#080808", gutterBg: "#f0f0f0", gutterFg: "#999999", keyword: "#0033b3", type: "#000000", func: "#00627a", string: "#067d17", comment: "#8c8c8c", number: "#1750eb", preproc: "#9e880d", tag: "#0033b3", attr: "#174ad4", punct: "#080808", boldKw: true, hl: "#fcfaed", chrome: { tab: "#f2f2f2", tabActive: "#ffffff", side: "#f7f8fa", sideFg: "#000000", status: "#f2f2f2", statusFg: "#555555" } },
  { name: "eclipse", bg: "#ffffff", fg: "#000000", gutterFg: "#787878", keyword: "#7f0055", type: "#000000", func: "#000000", string: "#2a00ff", comment: "#3f7f5f", number: "#000000", preproc: "#7f0055", tag: "#3f7f7f", attr: "#7f007f", punct: "#000000", boldKw: true, hl: "#e8f2fe", chrome: { tab: "#e6e6e6", tabActive: "#ffffff", side: "#ffffff", sideFg: "#000000", status: "#e6e6e6", statusFg: "#333333" } },
  { name: "turbo-c", bg: "#0000aa", fg: "#ffff55", keyword: "#ffffff", type: "#ffffff", func: "#ffff55", string: "#55ffff", comment: "#aaaaaa", number: "#55ffff", preproc: "#55ff55", tag: "#ffffff", attr: "#ffff55", punct: "#ffff55", mono: "Lucida Console", noGutter: true, turbo: true },
  { name: "notepad", bg: "#ffffff", fg: "#000000", mono_only: true, noGutter: true, chrome: { tab: "#f3f3f3", tabActive: "#ffffff", status: "#f0f0f0", statusFg: "#000000" } },
  { name: "notepadpp", bg: "#ffffff", fg: "#000000", gutterBg: "#e4e4e4", gutterFg: "#808080", keyword: "#0000ff", type: "#8000ff", func: "#000000", string: "#808080", comment: "#008000", number: "#ff8000", preproc: "#804000", tag: "#0000ff", attr: "#ff0000", punct: "#000080", boldKw: true, hl: "#e8e8ff", chrome: { tab: "#f0f0f0", tabActive: "#ffffff", status: "#f0f0f0", statusFg: "#000000" } },
  { name: "idle", bg: "#ffffff", fg: "#000000", keyword: "#ff7700", type: "#900090", func: "#0000ff", string: "#00aa00", comment: "#dd0000", number: "#000000", preproc: "#ff7700", tag: "#ff7700", attr: "#000000", punct: "#000000", noGutter: true, mono: "Courier New" },
  { name: "monokai", bg: "#272822", fg: "#f8f8f2", gutterFg: "#90908a", keyword: "#f92672", type: "#66d9ef", func: "#a6e22e", string: "#e6db74", comment: "#75715e", number: "#ae81ff", preproc: "#f92672", tag: "#f92672", attr: "#a6e22e", punct: "#f8f8f2", hl: "#3e3d32", chrome: { tab: "#1e1f1c", tabActive: "#272822", side: "#1e1f1c", sideFg: "#cccccc", status: "#414339", statusFg: "#ffffff" } },
  { name: "one-dark", bg: "#282c34", fg: "#abb2bf", gutterFg: "#495162", keyword: "#c678dd", type: "#e5c07b", func: "#61afef", string: "#98c379", comment: "#7f848e", number: "#d19a66", preproc: "#c678dd", tag: "#e06c75", attr: "#d19a66", punct: "#abb2bf", guide: "#3b4048", hl: "#2c313c", chrome: { tab: "#21252b", tabActive: "#282c34", side: "#21252b", sideFg: "#abb2bf", status: "#21252b", statusFg: "#9da5b4" } },
  { name: "codeblocks", bg: "#ffffff", fg: "#000000", gutterBg: "#e0e0e0", gutterFg: "#000000", keyword: "#0000a0", type: "#0000a0", func: "#000000", string: "#0000ff", comment: "#a0a0a0", number: "#f000f0", preproc: "#00a000", tag: "#0000a0", attr: "#000000", punct: "#ff0000", boldKw: true, chrome: { tab: "#ece9d8", tabActive: "#ffffff", side: "#ffffff", sideFg: "#000000", status: "#ece9d8", statusFg: "#000000" } },
  { name: "github-dark", bg: "#0d1117", fg: "#e6edf3", gutterFg: "#6e7681", keyword: "#ff7b72", type: "#ffa657", func: "#d2a8ff", string: "#a5d6ff", comment: "#8b949e", number: "#79c0ff", preproc: "#ff7b72", tag: "#7ee787", attr: "#79c0ff", punct: "#e6edf3", chrome: { tab: "#010409", tabActive: "#0d1117", side: "#010409", sideFg: "#e6edf3", status: "#010409", statusFg: "#7d8590" } },
];

const CONSOLE_THEMES = [
  { name: "cmd", flavor: "cmd", bg: "#0c0c0c", fg: "#cccccc", title: "light" },
  { name: "cmd-classic", flavor: "cmd", bg: "#000000", fg: "#c0c0c0", title: "light", mono: "Lucida Console" },
  { name: "powershell", flavor: "powershell", bg: "#012456", fg: "#eeedf0", title: "light" },
  { name: "win-terminal", flavor: "powershell", bg: "#0c0c0c", fg: "#cccccc", title: "tabs" },
  { name: "bash-ubuntu", flavor: "bash", bg: "#300a24", fg: "#ffffff", prompt: ["#8ae234", "#729fcf"], title: "dark" },
  { name: "bash-dark", flavor: "bash", bg: "#1d1f21", fg: "#c5c8c6", prompt: ["#b5bd68", "#81a2be"], title: "dark" },
  { name: "mac-light", flavor: "bash", bg: "#ffffff", fg: "#000000", title: "light" },
  { name: "vscode-terminal", flavor: "powershell", bg: "#1e1e1e", fg: "#cccccc", title: "vscode" },
  { name: "vscode-output", flavor: "ide", bg: "#1e1e1e", fg: "#cccccc", title: "vscode", firstLine: "#569cd6" },
  { name: "intellij-run", flavor: "ide", bg: "#2b2b2b", fg: "#a9b7c6", firstLine: "#808080", title: "run-dark" },
  { name: "intellij-run-light", flavor: "ide", bg: "#ffffff", fg: "#080808", firstLine: "#7a7a7a", title: "run-light" },
  { name: "eclipse-console", flavor: "ide", bg: "#ffffff", fg: "#000000", input: "#00c800", title: "eclipse" },
  { name: "idle-shell", flavor: "idle", bg: "#ffffff", fg: "#0000ff", title: "light" },
  { name: "turbo-output", flavor: "plain", bg: "#000000", fg: "#aaaaaa", mono: "Lucida Console" },
  { name: "devcpp-console", flavor: "ide", bg: "#000000", fg: "#ffffff", title: "light" },
  { name: "jupyter-output", flavor: "plain", bg: "#ffffff", fg: "#000000", title: "jupyter" },
];

const VISUAL_OUTPUTS = ["browser", "gui", "plot"];

// ---------------------------------------------------------------- helpers

function hexMix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function isDark(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}
function drawTitleBar(ctx, rng, W, style, text) {
  const h = rng.int(26, 34);
  const dark = style === "dark";
  ctx.fillStyle = dark ? "#2d2d2d" : style === "light" ? rng.pick(["#ffffff", "#f3f3f3", "#dfe7f1"]) : "#202020";
  ctx.fillRect(0, 0, W, h);
  ctx.fillStyle = dark || style === "tabs" ? "#e0e0e0" : "#1a1a1a";
  ctx.font = `${Math.round(h * 0.42)}px Segoe UI`;
  ctx.fillText(text, 36, h * 0.66);
  ctx.fillRect(12, h * 0.3, h * 0.4, h * 0.4);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const x = W - 20 - i * 46;
    ctx.beginPath();
    if (i === 0) { ctx.moveTo(x - 5, h / 2 - 5); ctx.lineTo(x + 5, h / 2 + 5); ctx.moveTo(x + 5, h / 2 - 5); ctx.lineTo(x - 5, h / 2 + 5); }
    else if (i === 1) ctx.rect(x - 5, h / 2 - 5, 10, 10);
    else { ctx.moveTo(x - 5, h / 2); ctx.lineTo(x + 5, h / 2); }
    ctx.stroke();
  }
  return h;
}

// ---------------------------------------------------------------- code editor

function renderCode(rng, theme) {
  const { lang, lines } = codeLines(rng);
  const fontSize = rng.int(12, 22);
  const lh = Math.round(fontSize * rng.range(1.18, 1.6));
  const mono = theme.mono || rng.pick(MONO);
  const W = rng.int(560, 1600);
  const chrome = theme.chrome && rng.chance(0.55);
  const tabs = chrome && rng.chance(0.85);
  const side = chrome && theme.chrome.side && rng.chance(0.45) ? rng.int(160, 300) : 0;
  const status = chrome && rng.chance(0.6) ? rng.int(20, 26) : 0;
  const titleH = chrome && rng.chance(0.4) ? 30 : 0;
  const tabH = tabs ? Math.round(fontSize * 2.2) : 0;
  const padTop = rng.int(4, 16);
  const visibleLines = Math.min(lines.length, rng.int(8, 60));
  const H = Math.min(1150, titleH + tabH + padTop + visibleLines * lh + (rng.chance(0.3) ? rng.int(60, 500) : rng.int(6, 60)) + status);
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  let top = 0;
  if (titleH) top = drawTitleBar(ctx, rng, W, isDark(theme.bg) ? "dark" : "light", `${rng.pick(CLASSES)}.${lang} - ${rng.pick(["Visual Studio Code", "IntelliJ IDEA", "Notepad++", "Eclipse IDE"])}`);
  if (side) {
    ctx.fillStyle = theme.chrome.side;
    ctx.fillRect(0, top, side, H - top);
    ctx.fillStyle = theme.chrome.sideFg;
    const sf = rng.int(11, 14);
    ctx.font = `${sf}px ${rng.pick(UI)}`;
    ctx.fillText(rng.pick(["EXPLORER", "Project", "PRACTICALS"]), 14, top + sf * 2);
    for (let y = top + sf * 4, i = 0; y < H - status - 10; y += sf * 1.8, i++) {
      ctx.fillText(`${i % 4 ? "  " : ""}${rng.pick(NOUNS)}${rng.pick([".java", ".py", ".c", ".cpp", ".html", ".js", "", ""])}`, 14 + (i % 4 ? 16 : 0), y);
    }
  }
  if (tabs) {
    ctx.fillStyle = theme.chrome.tab;
    ctx.fillRect(side, top, W - side, tabH);
    let x = side;
    for (let t = 0; t < rng.int(1, 4); t++) {
      const tw = rng.int(110, 190);
      ctx.fillStyle = t === 0 ? theme.chrome.tabActive : theme.chrome.tab;
      ctx.fillRect(x, top, tw, tabH);
      ctx.fillStyle = theme.chrome.sideFg || theme.fg;
      ctx.font = `${Math.round(fontSize * 0.85)}px ${rng.pick(UI)}`;
      ctx.fillText(`${rng.pick(NOUNS)}.${lang}`, x + 14, top + tabH * 0.63);
      x += tw + 1;
    }
    top += tabH;
  }
  if (status) {
    ctx.fillStyle = theme.chrome.status;
    ctx.fillRect(0, H - status, W, status);
    ctx.fillStyle = theme.chrome.statusFg;
    ctx.font = `12px ${rng.pick(UI)}`;
    ctx.fillText(`Ln ${rng.int(1, 80)}, Col ${rng.int(1, 40)}   Spaces: 4   UTF-8   CRLF   ${lang.toUpperCase()}`, W - 420, H - status / 3);
  }

  ctx.font = `${fontSize}px ${mono}`;
  const charW = ctx.measureText("M").width;
  const showGutter = !theme.noGutter && rng.chance(0.85);
  const startNum = rng.chance(0.6) ? 1 : rng.int(2, 120);
  const digits = String(startNum + visibleLines).length;
  const gutterW = showGutter ? Math.round(charW * (digits + rng.range(1.5, 4))) : 0;
  if (showGutter && theme.gutterBg) {
    ctx.fillStyle = theme.gutterBg;
    ctx.fillRect(side, top, gutterW, H - top - status);
  }
  const x0 = side + gutterW + rng.int(4, 18);
  const guides = theme.guide && rng.chance(0.45);
  const hlLine = theme.hl && rng.chance(0.35) ? rng.int(0, visibleLines - 1) : -1;
  const plain = theme.mono_only || rng.chance(0.04);

  for (let i = 0; i < visibleLines; i++) {
    const y = top + padTop + i * lh;
    if (y + lh > H - status) break;
    if (i === hlLine) {
      ctx.fillStyle = theme.hl;
      ctx.fillRect(side + gutterW, y, W, lh);
    }
    if (showGutter) {
      ctx.font = `${fontSize}px ${mono}`;
      ctx.fillStyle = theme.gutterFg;
      const s = String(startNum + i);
      ctx.fillText(s, side + gutterW - charW * (s.length + 1), y + lh * 0.75);
    }
    const line = lines[i].replace(/\t/g, "    ");
    if (guides) {
      const lead = line.length - line.trimStart().length;
      ctx.fillStyle = theme.guide;
      for (let g = 4; g < lead; g += 4) ctx.fillRect(Math.round(x0 + g * charW), y, 1, lh);
    }
    let x = x0;
    for (const tok of tokenize(line, lang)) {
      if (tok.cls === "ws") { x += tok.text.length * charW; continue; }
      const color = plain ? theme.fg : theme[tok.cls] || theme.fg;
      const bold = theme.boldKw && tok.cls === "keyword";
      ctx.font = `${bold ? "bold " : ""}${tok.cls === "comment" && rng.chance(0.2) ? "italic " : ""}${fontSize}px ${mono}`;
      ctx.fillStyle = color;
      ctx.fillText(tok.text, x, y + lh * 0.75);
      x += tok.text.length * charW;
    }
  }
  if (theme.turbo) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.strokeRect(8, 8, W - 16, H - 16);
  }
  if (chrome && rng.chance(0.3)) {
    // minimap
    const mx = W - 90;
    for (let i = 0; i < Math.min(lines.length, 120); i++) {
      ctx.fillStyle = hexMix(theme.bg, theme.fg, 0.35);
      ctx.fillRect(mx + (lines[i].length - lines[i].trimStart().length), top + 4 + i * 3, Math.min(70, lines[i].trim().length), 2);
    }
  }
  return cv;
}

// ---------------------------------------------------------------- consoles

function renderConsole(rng, theme) {
  const lines = consoleTranscript(rng, theme.flavor);
  const fontSize = rng.int(12, 21);
  const lh = Math.round(fontSize * rng.range(1.12, 1.45));
  const mono = theme.mono || rng.pick(MONO);
  const W = rng.int(560, 1600);
  let top = 0;
  const hasTitle = theme.title && rng.chance(0.6);
  const visible = Math.min(lines.length, rng.int(6, 50));
  const header = hasTitle ? (theme.title === "vscode" || theme.title === "jupyter" || theme.title.startsWith("run") || theme.title === "eclipse" ? 34 : theme.title === "tabs" ? 40 : 30) : 0;
  // Real terminal windows are often much taller than what was printed.
  const content = header + 12 + visible * lh;
  const H = Math.min(1100, rng.chance(0.45) ? Math.max(content + 8, rng.int(300, 900)) : content + rng.int(8, 120));
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  if (hasTitle) {
    const t = theme.title;
    if (t === "light" || t === "dark") top = drawTitleBar(ctx, rng, W, t, rng.pick(["Command Prompt", "Windows PowerShell", "student@ubuntu: ~", "C:\\WINDOWS\\system32\\cmd.exe", "Terminal", "IDLE Shell 3.12.4"]));
    else if (t === "tabs") {
      ctx.fillStyle = "#202020"; ctx.fillRect(0, 0, W, 40);
      ctx.fillStyle = "#0c0c0c"; ctx.fillRect(8, 6, 200, 34);
      ctx.fillStyle = "#ffffff"; ctx.font = "13px Segoe UI"; ctx.fillText("Windows PowerShell", 40, 28);
      top = 40;
    } else if (t === "vscode") {
      ctx.fillStyle = "#1e1e1e"; ctx.fillRect(0, 0, W, 34);
      ctx.font = "11px Segoe UI";
      ["PROBLEMS", "OUTPUT", "DEBUG CONSOLE", "TERMINAL", "PORTS"].forEach((s, i) => {
        ctx.fillStyle = (theme.flavor === "ide" ? i === 1 : i === 3) ? "#e7e7e7" : "#969696";
        ctx.fillText(s, 20 + i * 110, 22);
      });
      top = 34;
    } else if (t === "run-dark" || t === "run-light" || t === "eclipse") {
      ctx.fillStyle = t === "run-dark" ? "#3c3f41" : "#f2f2f2"; ctx.fillRect(0, 0, W, 30);
      ctx.fillStyle = t === "run-dark" ? "#bbbbbb" : "#333333"; ctx.font = "12px Segoe UI";
      ctx.fillText(t === "eclipse" ? `Console  \u00d7   Problems   Javadoc   Declaration` : `Run:   ${rng.pick(CLASSES)}  \u00d7`, 12, 20);
      if (t === "eclipse") { ctx.fillStyle = "#333333"; ctx.fillText(`<terminated> ${rng.pick(CLASSES)} [Java Application] C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe`, 12, 48); top = 56; }
      else top = 30;
    } else if (t === "jupyter") {
      ctx.fillStyle = "#d84315"; ctx.font = `${fontSize}px ${mono}`;
      ctx.fillText(`Out[${rng.int(1, 30)}]:`, 8, 24);
      top = 6;
    }
  }
  const x0 = theme.title === "jupyter" && hasTitle ? rng.int(90, 120) : rng.int(4, 16);
  const colorful = rng.chance(0.12);
  for (let i = 0; i < visible; i++) {
    const y = top + 8 + i * lh;
    if (y + lh > H) break;
    const text = lines[i];
    ctx.font = `${fontSize}px ${mono}`;
    let color = theme.fg;
    if (i === 0 && theme.firstLine) color = theme.firstLine;
    if (/error|exception|traceback/i.test(text) && (theme.flavor === "ide" || theme.flavor === "idle")) color = isDark(theme.bg) ? "#ff6b68" : "#c00000";
    if (theme.input && /: \d+$/.test(text) && rng.chance(0.8)) {
      const idx = text.lastIndexOf(": ") + 2;
      ctx.fillStyle = color; ctx.fillText(text.slice(0, idx), x0, y + lh * 0.75);
      ctx.fillStyle = theme.input; ctx.fillText(text.slice(idx), x0 + ctx.measureText(text.slice(0, idx)).width, y + lh * 0.75);
      continue;
    }
    if (colorful && rng.chance(0.3)) color = rng.pick(["#16c60c", "#e74856", "#f9f1a5", "#3b78ff", "#61d6d6"]);
    const pm = theme.prompt && text.match(/^([\w-]+@[\w-]+)(:)(~[^$]*)(\$ )(.*)$/);
    if (pm) {
      let x = x0;
      const parts = [[pm[1], theme.prompt[0], true], [pm[2], theme.fg], [pm[3], theme.prompt[1], true], [pm[4], theme.fg], [pm[5], theme.fg]];
      for (const [s, c, b] of parts) {
        ctx.font = `${b ? "bold " : ""}${fontSize}px ${mono}`;
        ctx.fillStyle = c; ctx.fillText(s, x, y + lh * 0.75); x += ctx.measureText(s).width;
      }
      continue;
    }
    if (theme.flavor === "idle" && text.startsWith(">>>")) color = "#c77c0e";
    if (theme.flavor === "idle" && text.startsWith("Python")) color = "#000000";
    ctx.fillStyle = color;
    ctx.fillText(text, x0, y + lh * 0.75);
  }
  if (rng.chance(0.4)) {
    ctx.fillStyle = isDark(theme.bg) ? "#3a3a3a" : "#dcdcdc";
    ctx.fillRect(W - 14, top, 14, H - top);
    ctx.fillStyle = isDark(theme.bg) ? "#6a6a6a" : "#a0a0a0";
    ctx.fillRect(W - 11, top + rng.int(4, 40), 8, rng.int(40, 200));
  }
  return cv;
}

// ---------------------------------------------------------------- browser / GUI / plot

function wrapText(ctx, text, maxW) {
  const words = text.split(" ");
  const out = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

function renderBrowser(rng) {
  const W = rng.int(700, 1600), H = rng.int(400, 1000);
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  const pageBg = rng.pick(["#ffffff", "#ffffff", "#f4f6f8", "#fdf6e3", "#e8f5e9", "#1f2937", "#eef2ff"]);
  const dark = isDark(pageBg);
  const accent = rng.pick(["#1976d2", "#e53935", "#43a047", "#8e24aa", "#fb8c00", "#00897b", "#3949ab", "#333333"]);
  const font = rng.pick(UI);
  ctx.fillStyle = pageBg; ctx.fillRect(0, 0, W, H);
  let y = 0;
  if (rng.chance(0.65)) {
    ctx.fillStyle = "#dee1e6"; ctx.fillRect(0, 0, W, 40);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(8, 6, 230, 34);
    ctx.fillStyle = "#333"; ctx.font = "12px Segoe UI"; ctx.fillText(sentence(rng, 1, 3), 20, 28);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 40, W, 38);
    ctx.fillStyle = "#f1f3f4"; ctx.fillRect(110, 45, W - 220, 28);
    ctx.fillStyle = "#555"; ctx.font = "13px Segoe UI";
    ctx.fillText(rng.pick([`127.0.0.1:5500/${rng.pick(NOUNS)}.html`, `file:///C:/Users/Student/Desktop/${rng.pick(NOUNS)}.html`, `localhost/${rng.pick(NOUNS)}/index.php`, "localhost:3000"]), 124, 64);
    y = 78;
  }
  if (rng.chance(0.6)) {
    ctx.fillStyle = accent; ctx.fillRect(0, y, W, 56);
    ctx.fillStyle = "#ffffff"; ctx.font = `bold 20px ${font}`; ctx.fillText(cap(rng.pick(NOUNS)) + " " + rng.pick(["Portal", "College", "Shop", "App"]), 24, y + 36);
    ctx.font = `15px ${font}`;
    ["Home", "About", "Services", "Contact"].forEach((s, i) => ctx.fillText(s, W - 380 + i * 90, y + 34));
    y += 56;
  }
  const margin = rng.int(20, Math.max(24, Math.round(W * 0.2)));
  y += 30;
  const fg = dark ? "#f3f4f6" : "#222222";
  while (y < H - 30) {
    const block = rng.pick(["h", "p", "p", "form", "buttons", "table", "img", "cards", "list"]);
    if (block === "h") {
      const s = rng.int(22, 40);
      ctx.font = `bold ${s}px ${font}`; ctx.fillStyle = rng.chance(0.5) ? accent : fg;
      ctx.fillText(sentence(rng, 2, 5), rng.chance(0.3) ? W / 2 - 150 : margin, y + s);
      y += s + 20;
    } else if (block === "p") {
      const s = rng.int(14, 18);
      ctx.font = `${s}px ${font}`; ctx.fillStyle = fg;
      const lines = wrapText(ctx, Array.from({ length: rng.int(2, 6) }, () => sentence(rng, 6, 14)).join(". ") + ".", W - margin * 2);
      for (const l of lines.slice(0, 6)) { ctx.fillText(l, margin, y + s); y += s * 1.5; }
      y += 12;
    } else if (block === "form") {
      const s = rng.int(14, 16);
      for (let i = 0; i < rng.int(2, 5); i++) {
        ctx.font = `${s}px ${font}`; ctx.fillStyle = fg;
        ctx.fillText(cap(rng.pick(NOUNS)) + ":", margin, y + s);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(margin + 140, y - 4, 260, 32);
        ctx.strokeStyle = "#8a8a8a"; ctx.lineWidth = 1; ctx.strokeRect(margin + 140.5, y - 3.5, 260, 32);
        y += 44;
      }
    } else if (block === "buttons") {
      let x = margin;
      for (let i = 0; i < rng.int(1, 5); i++) {
        const bw = rng.int(80, 140);
        ctx.fillStyle = rng.chance(0.7) ? accent : "#e0e0e0";
        ctx.fillRect(x, y, bw, 38);
        ctx.fillStyle = "#ffffff"; ctx.font = `15px ${font}`; ctx.fillText(cap(rng.pick(VERBS)), x + 16, y + 25);
        x += bw + 14;
      }
      y += 60;
    } else if (block === "table") {
      const cols = rng.int(2, 5), rows = rng.int(2, 6), cw = Math.min(180, (W - margin * 2) / cols);
      ctx.strokeStyle = dark ? "#9ca3af" : "#444"; ctx.lineWidth = 1;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (r === 0) { ctx.fillStyle = rng.chance(0.5) ? accent : dark ? "#374151" : "#e5e7eb"; ctx.fillRect(margin + c * cw, y + r * 30, cw, 30); }
        ctx.strokeRect(margin + c * cw + 0.5, y + r * 30 + 0.5, cw, 30);
        ctx.fillStyle = r === 0 ? (dark ? "#fff" : "#111") : fg; ctx.font = `${r === 0 ? "bold " : ""}14px ${font}`;
        ctx.fillText(r === 0 ? cap(rng.pick(NOUNS)) : String(rng.chance(0.5) ? rng.int(1, 999) : cap(rng.pick(NOUNS))), margin + c * cw + 8, y + r * 30 + 20);
      }
      y += rows * 30 + 24;
    } else if (block === "img") {
      const iw = rng.int(150, Math.min(600, W - margin * 2)), ih = rng.int(100, 260);
      const g = ctx.createLinearGradient(margin, y, margin + iw, y + ih);
      g.addColorStop(0, rng.pick(["#90caf9", "#ffcc80", "#a5d6a7", "#ce93d8"])); g.addColorStop(1, rng.pick(["#1565c0", "#e65100", "#2e7d32", "#6a1b9a"]));
      ctx.fillStyle = g; ctx.fillRect(margin, y, iw, ih);
      y += ih + 20;
    } else if (block === "cards") {
      const n = rng.int(2, 4), cw = (W - margin * 2 - (n - 1) * 20) / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = dark ? "#374151" : "#ffffff"; ctx.fillRect(margin + i * (cw + 20), y, cw, 140);
        ctx.strokeStyle = "#d1d5db"; ctx.strokeRect(margin + i * (cw + 20) + 0.5, y + 0.5, cw, 140);
        ctx.fillStyle = accent; ctx.fillRect(margin + i * (cw + 20), y, cw, 6);
        ctx.fillStyle = fg; ctx.font = `bold 17px ${font}`; ctx.fillText(cap(rng.pick(NOUNS)), margin + i * (cw + 20) + 14, y + 40);
        ctx.font = `14px ${font}`; ctx.fillText(sentence(rng, 2, 4), margin + i * (cw + 20) + 14, y + 70);
      }
      y += 164;
    } else {
      ctx.font = `16px ${font}`; ctx.fillStyle = fg;
      for (let i = 0; i < rng.int(2, 5); i++) { ctx.fillText("\u2022  " + sentence(rng, 2, 6), margin + 10, y + 16); y += 26; }
      y += 12;
    }
  }
  return cv;
}

function renderGui(rng) {
  const W = rng.int(360, 900), H = rng.int(260, 700);
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  const panel = rng.pick(["#f0f0f0", "#eeeeee", "#d9d9d9", "#ffffff", "#ece9d8"]);
  ctx.fillStyle = panel; ctx.fillRect(0, 0, W, H);
  const top = drawTitleBar(ctx, rng, W, "light", rng.pick(["Calculator", "Student Form", "tk", "Login", "Java Swing Demo", "Temperature Converter"]));
  const font = rng.pick(["Segoe UI", "Arial", "Tahoma", "Calibri"]);
  const fs = rng.int(12, 18);
  let y = top + 24;
  const grid = rng.chance(0.3);
  if (grid) {
    const cols = 4, bw = (W - 40) / cols;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(16, y, W - 32, 46); ctx.strokeStyle = "#7a7a7a"; ctx.strokeRect(16.5, y + 0.5, W - 32, 46);
    ctx.fillStyle = "#000"; ctx.font = `22px ${font}`; ctx.fillText(String(rng.int(0, 99999)), W - 140, y + 32);
    y += 60;
    const keys = "789/456*123-0.=+".split("");
    for (let i = 0; i < keys.length && y < H - 40; i++) {
      const x = 16 + (i % cols) * bw;
      ctx.fillStyle = rng.pick(["#e1e1e1", "#fdfdfd", "#dddddd"]); ctx.fillRect(x + 2, y, bw - 6, 42);
      ctx.strokeStyle = "#adadad"; ctx.strokeRect(x + 2.5, y + 0.5, bw - 6, 42);
      ctx.fillStyle = "#000"; ctx.font = `18px ${font}`; ctx.fillText(keys[i], x + bw / 2 - 6, y + 28);
      if (i % cols === cols - 1) y += 50;
    }
    return cv;
  }
  while (y < H - 60) {
    ctx.font = `${fs}px ${font}`; ctx.fillStyle = "#000";
    const r = rng();
    if (r < 0.55) {
      ctx.fillText(`${rng.pick(["Enter", "Name", "Roll No", "Amount", "Celsius", "Result", "Password"])}${rng.chance(0.5) ? " " + rng.pick(NOUNS) : ""}:`, 20, y + fs);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(170, y - 4, Math.min(260, W - 200), fs + 14);
      ctx.strokeStyle = "#7a7a7a"; ctx.strokeRect(170.5, y - 3.5, Math.min(260, W - 200), fs + 14);
      if (rng.chance(0.6)) { ctx.fillStyle = "#000"; ctx.fillText(String(rng.chance(0.5) ? rng.int(1, 9999) : cap(rng.pick(NOUNS))), 176, y + fs); }
      y += fs + 26;
    } else if (r < 0.8) {
      let x = 20;
      for (let i = 0; i < rng.int(1, 3); i++) {
        const bw = rng.int(80, 130);
        ctx.fillStyle = rng.pick(["#e1e1e1", "#dddddd", "#0078d7", "#4caf50"]); ctx.fillRect(x, y, bw, fs + 16);
        ctx.strokeStyle = "#adadad"; ctx.strokeRect(x + 0.5, y + 0.5, bw, fs + 16);
        ctx.fillStyle = ctx.fillStyle === "#0078d7" ? "#fff" : "#000"; ctx.font = `${fs}px ${font}`; ctx.fillText(cap(rng.pick(VERBS)), x + 12, y + fs + 4);
        x += bw + 12;
      }
      y += fs + 34;
    } else {
      ctx.fillStyle = "#ffffff"; const th = rng.int(60, 160); ctx.fillRect(20, y, W - 40, th);
      ctx.strokeStyle = "#7a7a7a"; ctx.strokeRect(20.5, y + 0.5, W - 40, th);
      ctx.fillStyle = "#000"; ctx.font = `${fs}px ${font}`;
      outputBody(rng).slice(0, Math.floor(th / (fs + 6))).forEach((l, i) => ctx.fillText(l, 28, y + (i + 1) * (fs + 4)));
      y += th + 16;
    }
  }
  return cv;
}

function renderPlot(rng) {
  const W = rng.int(500, 1100), H = rng.int(380, 800);
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  let top = 0;
  if (rng.chance(0.4)) top = drawTitleBar(ctx, rng, W, "light", "Figure 1");
  const L = 80, R = W - 30, T = top + 50, B = H - 60;
  ctx.fillStyle = "#000"; ctx.font = `16px ${rng.pick(["Arial", "Segoe UI"])}`;
  ctx.fillText(sentence(rng, 2, 4), W / 2 - 80, top + 30);
  ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, T + 0.5, R - L, B - T);
  ctx.font = "12px Arial";
  for (let i = 0; i <= 5; i++) {
    ctx.fillText(String(i * rng.int(1, 20)), L - 30, B - (i * (B - T)) / 5 + 4);
    ctx.fillText(String(i * rng.int(1, 5)), L + (i * (R - L)) / 5 - 4, B + 18);
  }
  const colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd"];
  const kind = rng.pick(["line", "bar", "scatter", "pie"]);
  if (kind === "bar") {
    const n = rng.int(3, 10), bw = (R - L) / n;
    for (let i = 0; i < n; i++) { ctx.fillStyle = rng.chance(0.7) ? colors[0] : colors[i % 5]; const h = rng.range(0.1, 0.95) * (B - T); ctx.fillRect(L + i * bw + bw * 0.15, B - h, bw * 0.7, h); }
  } else if (kind === "pie") {
    let a = 0; const cx = (L + R) / 2, cy = (T + B) / 2, r = Math.min(R - L, B - T) / 2.4;
    ctx.fillStyle = "#fff"; ctx.fillRect(L + 1, T + 1, R - L - 2, B - T - 2);
    for (let i = 0; i < 5; i++) { const d = rng.range(0.4, 1.6); ctx.fillStyle = colors[i]; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, Math.min(a + d, Math.PI * 2)); ctx.fill(); a += d; }
  } else {
    for (let s = 0; s < rng.int(1, 3); s++) {
      ctx.strokeStyle = ctx.fillStyle = colors[s]; ctx.lineWidth = 2; ctx.beginPath();
      let v = rng.range(0.2, 0.8);
      for (let i = 0; i <= 40; i++) {
        v = Math.min(0.95, Math.max(0.05, v + rng.range(-0.08, 0.08)));
        const x = L + (i * (R - L)) / 40, y = B - v * (B - T);
        if (kind === "scatter") ctx.fillRect(x - 3, y - 3, 6, 6); else i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      if (kind === "line") ctx.stroke();
    }
  }
  return cv;
}

// ---------------------------------------------------------------- entry

function renderSample(rng, label, themeName) {
  if (label === "code") return renderCode(rng, CODE_THEMES.find((t) => t.name === themeName));
  if (themeName === "browser") return renderBrowser(rng);
  if (themeName === "gui") return renderGui(rng);
  if (themeName === "plot") return renderPlot(rng);
  return renderConsole(rng, CONSOLE_THEMES.find((t) => t.name === themeName));
}

module.exports = {
  renderSample,
  tokenize,
  CODE_THEME_NAMES: CODE_THEMES.map((t) => t.name),
  OUTPUT_THEME_NAMES: [...CONSOLE_THEMES.map((t) => t.name), ...VISUAL_OUTPUTS],
};
