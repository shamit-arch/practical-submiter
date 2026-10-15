// Light / dark / auto theme, shared by index.html and login.html. "auto" follows the OS.
// Each page also sets data-theme in an inline <head> script so there is no flash on load.
(function (root) {
  "use strict";

  const KEY = "prb.theme";
  const MODES = ["auto", "light", "dark"];
  const LABELS = { auto: "Auto (follows your system)", light: "Light", dark: "Dark" };

  function get() {
    try {
      const t = localStorage.getItem(KEY);
      return MODES.includes(t) ? t : "auto";
    } catch {
      return "auto";
    }
  }

  function apply(mode) {
    if (mode === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
  }

  function set(mode) {
    apply(mode);
    try {
      if (mode === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch { /* storage unavailable: the choice lasts for this page only */ }
  }

  // Wires a button that cycles Auto → Light → Dark. The button's data-mode picks the icon.
  function bindToggle(btn) {
    const show = (mode) => {
      btn.dataset.mode = mode;
      btn.title = `Theme: ${LABELS[mode]} — click to change`;
      btn.setAttribute("aria-label", btn.title);
    };
    show(get());
    btn.addEventListener("click", () => {
      const next = MODES[(MODES.indexOf(get()) + 1) % MODES.length];
      set(next);
      show(next);
    });
  }

  root.PRB = Object.assign(root.PRB || {}, { theme: { get, set, bindToggle } });
})(self);
