// Sign-in for the app — NOT IN USE YET. Only login.html loads this file, and nothing links
// to login.html. Accounts are created by the administrator; there is no self sign-up.
//
// To enable sign-in later:
//   1. Pick a backend that holds the accounts, e.g. Cloudflare Access (no code: protect the
//      Pages project in the Zero Trust dashboard), Supabase Auth, Firebase Auth, or a small
//      Cloudflare Pages Function that checks a hashed password list.
//   2. Replace signIn() below with a call to it, and store the returned session in
//      sessionStorage/localStorage (or rely on the backend's cookie).
//   3. Guard index.html: early in app.js, `if (!PRB.auth.currentUser()) location.replace("login.html")`.
//      A browser-side check is only a convenience; the real protection must be server-side,
//      because this is a static site anyone can download.
(function (root) {
  "use strict";

  const SESSION_KEY = "prb.session.v1";

  class AuthNotConfiguredError extends Error {
    constructor() {
      super("Sign-in is not configured yet.");
      this.name = "AuthNotConfiguredError";
    }
  }

  /** Resolves to { email, name } when the credentials are valid. */
  async function signIn(email, password) {
    if (!email || !password) throw new Error("Enter your email and password.");
    throw new AuthNotConfiguredError();
  }

  function signOut() {
    try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ }
  }

  /** The signed-in user, or null. */
  function currentUser() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  }

  root.PRB = Object.assign(root.PRB || {}, { auth: { signIn, signOut, currentUser, AuthNotConfiguredError, SESSION_KEY } });
})(self);
