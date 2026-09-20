"use strict";
// Regression tests for the Client Portal "Reset Access" recovery fix:
//   - POST /api/client-portal/request-reset -- email-only reset request for
//     an already-active portal account, neutral response either way.
//   - POST /api/client-portal/reset -- completes the reset with
//     email + code + new password, no leadId required.
//   - First Visit (request-activation/activate) is untouched and still
//     requires the client reference number.
//
// Spawns the real server.js in dev mode (local leads.json + local
// client-portal-accounts.local.json fallback, since Supabase is
// deliberately unreachable) -- never touches a real Supabase project or
// live Stripe/email. The dev-mode email transport captures "sent" messages
// in memory, readable via GET /api/dev/sent-test-emails, which is how these
// tests recover the real six-digit codes without any real SMTP delivery.
//
// Run with: npm test  (node --test test/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");
const PORTAL_ACCOUNTS_FILE = path.join(
  REPO_ROOT,
  "client-portal-accounts.local.json"
);

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET =
  "test-only-office-session-secret-automated-tests-32chars-min";
const PUBLIC_LEAD_ACCESS_SECRET =
  "test-only-public-lead-access-secret-for-automated-tests-32ch";

const DEV_PORT = 3927;

function baseEnv(port) {
  return {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "",
    RENDER: "",
    SUPABASE_URL: "http://127.0.0.1:1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
    SUPABASE_PUBLISHABLE_KEY: "test-anon-key-not-real",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-not-real",
    SUPABASE_SECRET_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    STRIPE_SECRET_KEY:
      "sk_test_dummy_key_constructed_only_never_used_for_a_real_api_call",
    STRIPE_WEBHOOK_SECRET: "whsec_test_only_dummy_secret_for_automated_tests",
    OFFICE_DOCUMENT_REVIEW_KEY: OFFICE_KEY,
    OFFICE_DOCUMENT_REVIEW_SESSION_SECRET: OFFICE_SESSION_SECRET,
    PUBLIC_LEAD_ACCESS_SECRET,
    EMAIL_USER: "",
    EMAIL_APP_PASSWORD: "",
    TAX_WATCH_STRIPE_CHECKOUT_ENABLED: "",
    PINNACLE_STRIPE_CHECKOUT_ENABLED: ""
  };
}

function startServer(port) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: baseEnv(port),
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.on("data", () => {});
  child.stdout.on("data", () => {});
  return child;
}

async function waitForServer(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server on port ${port} did not become ready in time`);
}

const base = () => `http://127.0.0.1:${DEV_PORT}`;

async function postJson(pathname, payload, extraHeaders = {}) {
  return fetch(`${base()}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(payload)
  });
}

function extractSetCookie(res) {
  const raw = res.headers.get("set-cookie") || "";
  return raw.split(";")[0];
}

function normalizeEmailLower(value) {
  return String(value || "").trim().toLowerCase();
}

async function getSentEmails() {
  const res = await fetch(`${base()}/api/dev/sent-test-emails`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.usingTestTransport, true);
  return body.emails || [];
}

async function getLatestEmail(to, subjectContains) {
  const emails = await getSentEmails();
  const matches = emails.filter(
    (entry) =>
      normalizeEmailLower(entry.to) === normalizeEmailLower(to) &&
      String(entry.subject || "").includes(subjectContains)
  );
  return matches.length ? matches[matches.length - 1] : null;
}

function extractCode(text) {
  const match = /\b(\d{6})\b/.exec(text || "");
  return match ? match[1] : null;
}

async function createLead(marker, email) {
  const res = await postJson("/api/lead", {
    name: marker,
    email,
    phone: "(555) 555-0111",
    estimate: { totalTax: 0 }
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  const leadId = body.leadId || body.lead?.leadId;
  assert.ok(leadId);
  return leadId;
}

function readLeadsFile() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  const raw = fs.readFileSync(LEADS_FILE, "utf8").trim();
  return raw ? JSON.parse(raw) : [];
}

function writeLeadsFile(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2) + "\n", "utf8");
}

function removeTestLead(leadId) {
  const leads = readLeadsFile();
  const remaining = leads.filter((l) => l.leadId !== leadId);
  if (remaining.length !== leads.length) {
    writeLeadsFile(remaining);
  }
}

function readPortalAccounts() {
  if (!fs.existsSync(PORTAL_ACCOUNTS_FILE)) return [];
  const raw = fs.readFileSync(PORTAL_ACCOUNTS_FILE, "utf8").trim();
  return raw ? JSON.parse(raw) : [];
}

function writePortalAccounts(records) {
  fs.writeFileSync(
    PORTAL_ACCOUNTS_FILE,
    JSON.stringify(records, null, 2),
    "utf8"
  );
}

function findPortalAccount(leadId) {
  return (
    readPortalAccounts().find((record) => record.leadId === leadId) || null
  );
}

function patchPortalAccount(leadId, fields) {
  const records = readPortalAccounts();
  const idx = records.findIndex((record) => record.leadId === leadId);
  assert.ok(idx >= 0, "portal account must exist locally to patch it");
  records[idx] = { ...records[idx], ...fields };
  writePortalAccounts(records);
}

function removePortalAccount(leadId) {
  const records = readPortalAccounts();
  const remaining = records.filter((record) => record.leadId !== leadId);
  if (remaining.length !== records.length) {
    writePortalAccounts(remaining);
  }
}

async function createActivatedAccount(marker, password = "InitialPass123") {
  const email = `client-portal-reset-test+${marker}@example.test`;
  const leadId = await createLead(marker, email);

  const reqRes = await postJson("/api/client-portal/request-activation", {
    email,
    leadId
  });
  assert.equal(reqRes.status, 200);

  const emailEntry = await getLatestEmail(
    email,
    "Your Secure Client Portal Code"
  );
  assert.ok(emailEntry, "activation code email must have been captured");
  const code = extractCode(emailEntry.text);
  assert.ok(code, "activation code must be extractable from the email body");

  const activateRes = await postJson("/api/client-portal/activate", {
    email,
    leadId,
    code,
    password
  });
  assert.equal(activateRes.status, 200);
  const cookie = extractSetCookie(activateRes);
  assert.ok(cookie, "activation must issue a session cookie");

  return { leadId, email, password, cookie };
}

function cleanupAccount(account) {
  if (!account) return;
  removeTestLead(account.leadId);
  removePortalAccount(account.leadId);
}

let devServer;

before(async () => {
  devServer = startServer(DEV_PORT);
  await waitForServer(DEV_PORT);
});

after(() => {
  if (devServer) devServer.kill();
});

const NEUTRAL_RESET_MESSAGE =
  "If an account exists for that email, reset instructions have been sent.";

// =============================================================================
// 1/2. Neutral, non-enumerating response
// =============================================================================

test("1. Reset request for an existing active account returns the neutral success response", async () => {
  const account = await createActivatedAccount("reset-neutral-existing-" + Date.now());

  try {
    const res = await postJson("/api/client-portal/request-reset", {
      email: account.email
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.message, NEUTRAL_RESET_MESSAGE);
  } finally {
    cleanupAccount(account);
  }
});

test("2. Reset request for a nonexistent email returns the identical neutral success response", async () => {
  const email = "reset-neutral-nonexistent-" + Date.now() + "@example.test";

  const res = await postJson("/api/client-portal/request-reset", { email });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.message, NEUTRAL_RESET_MESSAGE);
});

// =============================================================================
// 3. Reset code only ever goes to the registered email
// =============================================================================

test("3. Reset code email is sent only to the registered account email", async () => {
  const account = await createActivatedAccount("reset-email-target-" + Date.now());

  try {
    const res = await postJson("/api/client-portal/request-reset", {
      email: account.email
    });
    assert.equal(res.status, 200);

    const emailEntry = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    assert.ok(emailEntry, "a reset-code email must have been sent");
    assert.equal(
      normalizeEmailLower(emailEntry.to),
      normalizeEmailLower(account.email)
    );
  } finally {
    cleanupAccount(account);
  }
});

// =============================================================================
// 4. Reset completes without a leadId
// =============================================================================

test("4. Reset completes with email + code + new password, with no leadId in the request", async () => {
  const account = await createActivatedAccount("reset-no-leadid-" + Date.now());
  const newPassword = "BrandNewPass456";

  try {
    await postJson("/api/client-portal/request-reset", {
      email: account.email
    });
    const emailEntry = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    const code = extractCode(emailEntry.text);
    assert.ok(code);

    const payload = { email: account.email, code, password: newPassword };
    assert.equal(
      Object.prototype.hasOwnProperty.call(payload, "leadId"),
      false,
      "the reset payload must not include leadId"
    );

    const resetRes = await postJson("/api/client-portal/reset", payload);
    assert.equal(resetRes.status, 200);
    const body = await resetRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.redirect, "/client-portal/home");
    assert.ok(extractSetCookie(resetRes), "reset must issue a session cookie");

    const loginRes = await postJson("/api/client-portal/login", {
      email: account.email,
      password: newPassword
    });
    assert.equal(loginRes.status, 200);
  } finally {
    cleanupAccount(account);
  }
});

// =============================================================================
// 5/6/7/8. Code validation
// =============================================================================

test("5. Wrong reset code is rejected", async () => {
  const account = await createActivatedAccount("reset-wrong-code-" + Date.now());

  try {
    await postJson("/api/client-portal/request-reset", { email: account.email });
    const emailEntry = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    const realCode = extractCode(emailEntry.text);
    const wrongCode = realCode === "111111" ? "222222" : "111111";

    const res = await postJson("/api/client-portal/reset", {
      email: account.email,
      code: wrongCode,
      password: "AnotherValidPass789"
    });
    assert.equal(res.status, 400);
  } finally {
    cleanupAccount(account);
  }
});

test("6. Expired reset code is rejected", async () => {
  const account = await createActivatedAccount("reset-expired-code-" + Date.now());

  try {
    await postJson("/api/client-portal/request-reset", { email: account.email });
    const emailEntry = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    const code = extractCode(emailEntry.text);
    assert.ok(code);

    const stored = findPortalAccount(account.leadId);
    assert.ok(stored?.activation?.hash, "a stored activation/reset code must exist");
    patchPortalAccount(account.leadId, {
      activation: {
        ...stored.activation,
        expiresAt: new Date(Date.now() - 60 * 1000).toISOString()
      }
    });

    const res = await postJson("/api/client-portal/reset", {
      email: account.email,
      code,
      password: "StillValidPass789"
    });
    assert.equal(res.status, 400);
  } finally {
    cleanupAccount(account);
  }
});

test("7. A successfully used reset code cannot be reused", async () => {
  const account = await createActivatedAccount("reset-reuse-code-" + Date.now());

  try {
    await postJson("/api/client-portal/request-reset", { email: account.email });
    const emailEntry = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    const code = extractCode(emailEntry.text);

    const firstRes = await postJson("/api/client-portal/reset", {
      email: account.email,
      code,
      password: "FirstResetPass123"
    });
    assert.equal(firstRes.status, 200);

    const secondRes = await postJson("/api/client-portal/reset", {
      email: account.email,
      code,
      password: "SecondResetPass456"
    });
    assert.equal(secondRes.status, 400);
  } finally {
    cleanupAccount(account);
  }
});

test("8. A new reset request invalidates the previous reset code", async () => {
  const account = await createActivatedAccount("reset-invalidate-prior-" + Date.now());

  try {
    await postJson("/api/client-portal/request-reset", { email: account.email });
    const firstEmail = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    const staleCode = extractCode(firstEmail.text);

    await postJson("/api/client-portal/request-reset", { email: account.email });
    const secondEmail = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    const freshCode = extractCode(secondEmail.text);
    assert.notEqual(staleCode, freshCode);

    const staleRes = await postJson("/api/client-portal/reset", {
      email: account.email,
      code: staleCode,
      password: "StaleAttemptPass123"
    });
    assert.equal(staleRes.status, 400);

    const freshRes = await postJson("/api/client-portal/reset", {
      email: account.email,
      code: freshCode,
      password: "FreshAttemptPass123"
    });
    assert.equal(freshRes.status, 200);
  } finally {
    cleanupAccount(account);
  }
});

// =============================================================================
// 9. Password policy still enforced on reset
// =============================================================================

test("9. Password policy is enforced on reset completion", async () => {
  const account = await createActivatedAccount("reset-policy-" + Date.now());

  try {
    await postJson("/api/client-portal/request-reset", { email: account.email });
    const emailEntry = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    const code = extractCode(emailEntry.text);

    const res = await postJson("/api/client-portal/reset", {
      email: account.email,
      code,
      password: "short1"
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.ok(body.error && body.error.length > 0);
  } finally {
    cleanupAccount(account);
  }
});

// =============================================================================
// 10/11. sessionVersion + prior-session invalidation
// =============================================================================

test("10. sessionVersion increments after a successful reset", async () => {
  const account = await createActivatedAccount("reset-session-version-" + Date.now());

  try {
    const before = findPortalAccount(account.leadId);
    const versionBefore = Number(before?.sessionVersion || 0);

    await postJson("/api/client-portal/request-reset", { email: account.email });
    const emailEntry = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    const code = extractCode(emailEntry.text);

    const res = await postJson("/api/client-portal/reset", {
      email: account.email,
      code,
      password: "VersionBumpPass123"
    });
    assert.equal(res.status, 200);

    const after = findPortalAccount(account.leadId);
    assert.equal(Number(after.sessionVersion || 0), versionBefore + 1);
  } finally {
    cleanupAccount(account);
  }
});

test("11. A session cookie issued before the reset is rejected after the reset", async () => {
  const account = await createActivatedAccount("reset-prior-session-" + Date.now());

  try {
    const beforeReset = await fetch(`${base()}/api/client-portal/session`, {
      headers: { Cookie: account.cookie }
    });
    assert.equal(beforeReset.status, 200);

    await postJson("/api/client-portal/request-reset", { email: account.email });
    const emailEntry = await getLatestEmail(
      account.email,
      "Your Secure Client Portal Password Reset Code"
    );
    const code = extractCode(emailEntry.text);

    const resetRes = await postJson("/api/client-portal/reset", {
      email: account.email,
      code,
      password: "InvalidatesOldSession123"
    });
    assert.equal(resetRes.status, 200);
    const newCookie = extractSetCookie(resetRes);

    const afterResetOldCookie = await fetch(
      `${base()}/api/client-portal/session`,
      { headers: { Cookie: account.cookie } }
    );
    assert.equal(afterResetOldCookie.status, 401);

    const afterResetNewCookie = await fetch(
      `${base()}/api/client-portal/session`,
      { headers: { Cookie: newCookie } }
    );
    assert.equal(afterResetNewCookie.status, 200);
  } finally {
    cleanupAccount(account);
  }
});

// =============================================================================
// 12. Rate limiting
// =============================================================================

test("12. Rate limiting applies to both reset routes", async () => {
  const requestEmail =
    "reset-rate-limit-request-" + Date.now() + "@example.test";

  let lastStatus = 200;
  for (let i = 0; i < 6; i += 1) {
    const res = await postJson("/api/client-portal/request-reset", {
      email: requestEmail
    });
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429);

  const verifyEmail =
    "reset-rate-limit-verify-" + Date.now() + "@example.test";

  let lastVerifyStatus = 400;
  for (let i = 0; i < 8; i += 1) {
    const res = await postJson("/api/client-portal/reset", {
      email: verifyEmail,
      code: "000000",
      password: "DoesNotMatterPass123"
    });
    lastVerifyStatus = res.status;
  }
  assert.equal(lastVerifyStatus, 429);
});

// =============================================================================
// 13/14. First Visit is unaffected
// =============================================================================

test("13. First Visit activation still requires the client reference number", async () => {
  const email = "first-visit-still-requires-leadid-" + Date.now() + "@example.test";

  const res = await postJson("/api/client-portal/request-activation", {
    email
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(
    body.error,
    "Enter your email address and client reference number."
  );
});

test("14. The existing First Visit activation workflow still completes end to end", async () => {
  const account = await createActivatedAccount("first-visit-still-works-" + Date.now());

  try {
    const loginRes = await postJson("/api/client-portal/login", {
      email: account.email,
      password: account.password
    });
    assert.equal(loginRes.status, 200);
    const body = await loginRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.redirect, "/client-portal/home");
  } finally {
    cleanupAccount(account);
  }
});

// =============================================================================
// 15. Show/Hide password controls -- static verification (no DOM engine in
// this test harness, so this checks the actual markup/script rather than
// simulating clicks).
// =============================================================================

test("15. Show/Hide password controls exist for every password field and remain independent", () => {
  const html = fs.readFileSync(
    path.join(REPO_ROOT, "ui", "client-portal.html"),
    "utf8"
  );

  const expectedPasswordFieldIds = [
    "signInPassword",
    "newPassword",
    "confirmPassword",
    "resetNewPassword",
    "resetConfirmPassword"
  ];

  for (const id of expectedPasswordFieldIds) {
    const inputPattern = new RegExp(
      `<input id="${id}" type="password"[^>]*>`
    );
    assert.match(html, inputPattern, `expected a password input for ${id}`);

    const togglePattern = new RegExp(
      `data-password-toggle="${id}"[^>]*aria-pressed="false"`
    );
    assert.match(
      html,
      togglePattern,
      `expected an independent Show/Hide toggle for ${id}`
    );
  }

  const idMatches = [...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map(
    (m) => m[1]
  );
  const idCounts = new Map();
  for (const id of idMatches) {
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  for (const id of expectedPasswordFieldIds) {
    assert.equal(idCounts.get(id), 1, `id="${id}" must be unique`);
  }

  assert.match(
    html,
    /querySelectorAll\("\[data-password-toggle\]"\)/,
    "the shared password-toggle wiring script must still be present"
  );
});
