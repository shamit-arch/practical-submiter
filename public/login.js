// Sign-in page — NOT IN USE YET (see lib/auth.js). Sign-in only: accounts are added by the
// administrator.
const { auth, theme } = window.PRB;

const $ = (id) => document.getElementById(id);
const form = $("loginForm");
const errorBox = $("authError");
const submitBtn = $("submitBtn");

theme.bindToggle($("themeBtn"));

$("togglePw").addEventListener("click", () => {
  const pw = $("password");
  const show = pw.type === "password";
  pw.type = show ? "text" : "password";
  $("togglePw").textContent = show ? "Hide" : "Show";
});

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.toggle("hidden", !msg);
}

for (const id of ["email", "password"]) {
  $(id).addEventListener("input", () => { $(id).classList.remove("invalid"); showError(""); });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  const missing = [!email && "email", !password && "password"].filter(Boolean);
  if (missing.length) {
    missing.forEach((id) => $(id).classList.add("invalid"));
    $(missing[0]).focus();
    showError("Enter your email and password.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Signing in…';
  try {
    const user = await auth.signIn(email, password);
    const where = $("remember").checked ? localStorage : sessionStorage;
    where.setItem(auth.SESSION_KEY, JSON.stringify(user));
    location.replace("./");
  } catch (err) {
    showError(err.message || "Could not sign in.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign in";
  }
});
