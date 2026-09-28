"use strict";
// Regression tests for the direct paid-membership signup path.
//
// Context: the Free Tax Estimator was, until this fix, an undocumented but
// real prerequisite for purchasing either Tax Watch Pro or Pinnacle --
// ui/index.html's beginMembershipAction() hard-blocked every purchase
// button unless a completed estimate had populated an in-memory
// (per-page-load) fullName/email/leadId context. Portal account activation
// itself (POST /api/client-portal/request-activation) also required a
// pre-existing lead record with a matching leadId+email, which only an
// estimate (or another paid-service intake form) could produce.
//
// The fix adds POST /api/client-portal/membership-signup, a small
// pre-session route that mints a membership-only lead (the same
// CONTACT-{timestamp}-{random} shape ensureMembershipEnrollmentLead()
// already used for an authenticated customer buying a second plan) so a
// brand-new visitor can obtain a client reference and enter the existing,
// unchanged activation flow. The lead-minting logic itself was extracted
// into a shared helper, createMembershipOnlyLead(), so the authenticated
// and pre-session paths never duplicate that logic.
//
// These tests run against real spawned server.js instances (dev mode,
// unreachable Supabase, local-file fallback for both leads.json and
// client-portal-accounts.local.json -- the same harness every other
// client-portal test file in this project uses), so the full HTTP
// surface (signup -> activation -> checkout) is exercised end to end.
// Pinnacle-specific scenarios use a second server instance with
// PINNACLE_STRIPE_CHECKOUT_ENABLED="true", matching the pattern already
// established in test/pinnacle-launch-hardening.test.js.
//
// Run with: npm test  (node --test test/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");
const PORTAL_ACCOUNTS_FILE = path.join(REPO_ROOT, "client-portal-accounts.local.json");

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET = "test-only-office-session-secret-automated-tests-32chars-min";
const PUBLIC_LEAD_ACCESS_SECRET = "test-only-public-lead-access-secret-for-automated-tests-32ch";
const CLIENT_PORTAL_SESSION_SECRET = "test-only-client-portal-session-secret-automated-tests-32chr";

const PORT_DEFAULT = 3940; // Pinnacle disabled (Tax Watch Pro available locally by default)
const PORT_PINNACLE = 3941; // PINNACLE_STRIPE_CHECKOUT_ENABLED="true" (test-only, local, disposable)

function baseEnv(port, overrides = {}) {
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
    STRIPE_SECRET_KEY: "sk_test_dummy_key_constructed_only_never_used_for_a_real_api_call",
    STRIPE_WEBHOOK_SECRET: "whsec_test_only_dummy_secret_for_automated_tests",
    OFFICE_DOCUMENT_REVIEW_KEY: OFFICE_KEY,
    OFFICE_DOCUMENT_REVIEW_SESSION_SECRET: OFFICE_SESSION_SECRET,
    PUBLIC_LEAD_ACCESS_SECRET,
    CLIENT_PORTAL_SESSION_SECRET,
    EMAIL_USER: "",
    EMAIL_APP_PASSWORD: "",
    TAX_WATCH_STRIPE_CHECKOUT_ENABLED: "",
    PINNACLE_STRIPE_CHECKOUT_ENABLED: "",
    ...overrides
  };
}

function startServer(port, envOverrides) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: baseEnv(port, envOverrides),
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

function baseFor(port) {
  return `http://127.0.0.1:${port}`;
}

async function postJson(port, pathname, payload, cookie) {
  return fetch(`${baseFor(port)}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
}

function normalizeEmailLower(value) {
  return String(value || "").trim().toLowerCase();
}

async function getLatestEmail(port, to, subjectContains) {
  const res = await fetch(`${baseFor(port)}/api/dev/sent-test-emails`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const emails = body.emails || [];
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

async function createLead(port, name, email) {
  const res = await postJson(port, "/api/lead", {
    name,
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

function removeLeadsByEmail(email) {
  const normalized = normalizeEmailLower(email);
  const leads = readLeadsFile();
  const remaining = leads.filter(
    (l) => normalizeEmailLower(l?.contact?.email || "") !== normalized
  );
  if (remaining.length !== leads.length) {
    writeLeadsFile(remaining);
  }
}

function patchLocalLead(leadId, fields) {
  const leads = readLeadsFile();
  const idx = leads.findIndex((l) => l.leadId === leadId);
  assert.ok(idx >= 0, "test lead must exist in leads.json");
  Object.assign(leads[idx], fields);
  writeLeadsFile(leads);
}

function getLocalLead(leadId) {
  const leads = readLeadsFile();
  return leads.find((l) => l.leadId === leadId) || null;
}

function activeEnrollmentFields(planKey) {
  return {
    contactRequest: {
      membershipEnrollment: {
        planKey,
        enrollmentStatus: "Active Membership",
        paymentStatus: "Paid / Confirmed"
      }
    }
  };
}

async function requestMembershipCheckout(port, cookie, planKey, billingFrequency = "monthly") {
  return postJson(port, "/api/client-portal/membership-checkout", { planKey, billingFrequency }, cookie);
}

// The test Stripe key used across this harness (like every other
// client-portal test file in this project) is a syntactically valid but
// non-functional sk_test_ key: real outbound network calls to Stripe's API
// succeed at the transport level but Stripe itself rejects the key
// (StripeAuthenticationError), which the route surfaces as a 500. That is
// an EXPECTED, deterministic outcome in this offline harness, not a bug --
// see test/pinnacle-launch-hardening.test.js for the same documented
// constraint. What these tests verify is that a checkout attempt from a
// direct-signup-created identity clears every one of the route's OWN
// guards (feature availability, plan-scoped duplicate-purchase) and
// reaches the real Stripe call -- i.e. it is never rejected with 409/503
// for a reason specific to how the identity was created.
async function assertCheckoutReachedStripe(res, body) {
  assert.ok(
    [201, 500].includes(res.status),
    `expected checkout to clear all guards and reach Stripe (201 success or 500 Stripe-auth-failure), got ${res.status}: ${JSON.stringify(body)}`
  );
  if (res.status === 201) {
    assert.equal(body.ok, true);
    assert.ok(body.checkoutUrl);
  }
}

async function directSignup(port, email, name, planKey, billingFrequency) {
  return postJson(port, "/api/client-portal/membership-signup", { email, name, planKey, billingFrequency });
}

async function activateWithLeadId(port, leadId, email, password = "InitialPass123") {
  const reqRes = await postJson(port, "/api/client-portal/request-activation", { email, leadId });
  assert.equal(reqRes.status, 200);

  const emailEntry = await getLatestEmail(port, email, "Your Secure Client Portal Code");
  assert.ok(emailEntry, "activation code email must have been captured");
  const code = extractCode(emailEntry.text);
  assert.ok(code);

  const activateRes = await postJson(port, "/api/client-portal/activate", { email, leadId, code, password });
  assert.equal(activateRes.status, 200);
  const setCookie = activateRes.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  assert.ok(cookie);

  return { leadId, email, password, cookie };
}

// Full direct-purchase identity chain: signup -> activate.
async function directSignupAndActivate(port, marker, planKey, billingFrequency = "monthly") {
  const email = `direct-signup-test+${marker}@example.test`;
  const signupRes = await directSignup(port, email, "", planKey, billingFrequency);
  assert.equal(signupRes.status, 200);
  const signupBody = await signupRes.json();
  assert.equal(signupBody.ok, true);
  assert.equal(signupBody.existingAccount, false);
  assert.ok(signupBody.leadId);

  const account = await activateWithLeadId(port, signupBody.leadId, email);
  return { ...account, signupBody };
}

async function createActivatedAccount(port, marker, password = "InitialPass123") {
  const email = `direct-signup-test+${marker}@example.test`;
  const leadId = await createLead(port, marker, email);
  return activateWithLeadId(port, leadId, email, password);
}

function removePortalAccountAndLead(account, extraLeadIds = []) {
  if (!account) return;
  removeTestLead(account.leadId);
  extraLeadIds.forEach((id) => removeTestLead(id));

  if (!fs.existsSync(PORTAL_ACCOUNTS_FILE)) return;
  const raw = fs.readFileSync(PORTAL_ACCOUNTS_FILE, "utf8").trim();
  const records = raw ? JSON.parse(raw) : [];
  const remaining = records.filter((r) => r.leadId !== account.leadId);
  if (remaining.length !== records.length) {
    fs.writeFileSync(PORTAL_ACCOUNTS_FILE, JSON.stringify(remaining, null, 2), "utf8");
  }
}

let defaultServer;
let pinnacleServer;

before(async () => {
  defaultServer = startServer(PORT_DEFAULT, { PINNACLE_STRIPE_CHECKOUT_ENABLED: "" });
  pinnacleServer = startServer(PORT_PINNACLE, { PINNACLE_STRIPE_CHECKOUT_ENABLED: "true" });
  await Promise.all([waitForServer(PORT_DEFAULT), waitForServer(PORT_PINNACLE)]);
});

after(() => {
  if (defaultServer) defaultServer.kill();
  if (pinnacleServer) pinnacleServer.kill();
});

test("A. A new visitor can establish membership identity via direct signup, with no Free Estimator involved", async () => {
  const email = `direct-signup-test+a-${Date.now()}@example.test`;

  try {
    const res = await directSignup(PORT_DEFAULT, email, "", "tax-watch-pro", "monthly");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.existingAccount, false);
    assert.ok(body.leadId);
  } finally {
    removeLeadsByEmail(email);
  }
});

test("B. The signup response carries a server-generated client reference, and the minted lead has no fabricated estimate data", async () => {
  const email = `direct-signup-test+b-${Date.now()}@example.test`;

  try {
    const res = await directSignup(PORT_DEFAULT, email, "Jamie Test", "pinnacle", "annual");
    const body = await res.json();
    assert.match(body.leadId, /^CONTACT-\d+-[A-Z0-9]{5}$/);

    const lead = getLocalLead(body.leadId);
    assert.ok(lead, "the minted lead must be persisted");
    assert.equal(lead.contact.email, email);
    assert.equal(lead.contact.name, "Jamie Test");
    assert.deepEqual(lead.taxData, {});
    assert.deepEqual(lead.estimateSummary, {});
  } finally {
    removeLeadsByEmail(email);
  }
});

test("C. A caller-supplied leadId is ignored -- the server always mints its own", async () => {
  const email = `direct-signup-test+c-${Date.now()}@example.test`;

  try {
    const res = await fetch(`${baseFor(PORT_DEFAULT)}/api/client-portal/membership-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        planKey: "tax-watch-pro",
        leadId: "ATTACKER-CONTROLLED-ID"
      })
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.notEqual(body.leadId, "ATTACKER-CONTROLLED-ID");
    assert.match(body.leadId, /^CONTACT-/);
    assert.equal(getLocalLead("ATTACKER-CONTROLLED-ID"), null);
  } finally {
    removeLeadsByEmail(email);
  }
});

test("D. An email with an existing active portal account is directed to sign in, and no second lead/client reference is created", async () => {
  const account = await createActivatedAccount(PORT_DEFAULT, "d-existing-" + Date.now());

  try {
    const before = readLeadsFile().filter(
      (l) => normalizeEmailLower(l?.contact?.email || "") === normalizeEmailLower(account.email)
    ).length;

    const res = await directSignup(PORT_DEFAULT, account.email, "", "pinnacle", "monthly");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.existingAccount, true);
    assert.equal(body.leadId, undefined);
    // Selected plan/billing must still be echoed back so the caller can
    // preserve purchase intent through to sign-in.
    assert.equal(body.planKey, "pinnacle");
    assert.equal(body.billingFrequency, "monthly");

    const after = readLeadsFile().filter(
      (l) => normalizeEmailLower(l?.contact?.email || "") === normalizeEmailLower(account.email)
    ).length;
    assert.equal(after, before, "no new lead should be created for an existing active account");
  } finally {
    removePortalAccountAndLead(account);
    removeLeadsByEmail(account.email);
  }
});

test("E. Tax Watch Pro checkout can be initiated via the direct-signup path with no Free Estimator involved", async () => {
  const account = await directSignupAndActivate(PORT_DEFAULT, "e-taxwatch-" + Date.now(), "tax-watch-pro");

  try {
    const res = await requestMembershipCheckout(PORT_DEFAULT, account.cookie, "tax-watch-pro");
    const body = await res.json().catch(() => ({}));
    await assertCheckoutReachedStripe(res, body);
  } finally {
    removePortalAccountAndLead(account);
    removeLeadsByEmail(account.email);
  }
});

test("F. Pinnacle checkout can be initiated via the direct-signup path with no Free Estimator involved", async () => {
  const account = await directSignupAndActivate(PORT_PINNACLE, "f-pinnacle-" + Date.now(), "pinnacle");

  try {
    const res = await requestMembershipCheckout(PORT_PINNACLE, account.cookie, "pinnacle");
    const body = await res.json().catch(() => ({}));
    await assertCheckoutReachedStripe(res, body);
  } finally {
    removePortalAccountAndLead(account);
    removeLeadsByEmail(account.email);
  }
});

test("G. The existing estimator-assisted activation -> membership checkout path still works unchanged", async () => {
  const account = await createActivatedAccount(PORT_DEFAULT, "g-estimator-" + Date.now());

  try {
    const res = await requestMembershipCheckout(PORT_DEFAULT, account.cookie, "tax-watch-pro");
    const body = await res.json().catch(() => ({}));
    await assertCheckoutReachedStripe(res, body);
  } finally {
    removePortalAccountAndLead(account);
    removeLeadsByEmail(account.email);
  }
});

test("H. An authenticated purchase still resolves the enrollment lead's contact name from the account's own lead record", async () => {
  const email = `direct-signup-test+h-namecheck-${Date.now()}@example.test`;
  const leadId = await createLead(PORT_DEFAULT, "Pat Example", email);
  const account = await activateWithLeadId(PORT_DEFAULT, leadId, email);

  try {
    const res = await requestMembershipCheckout(PORT_DEFAULT, account.cookie, "tax-watch-pro");
    const body = await res.json().catch(() => ({}));
    await assertCheckoutReachedStripe(res, body);

    const leads = readLeadsFile();
    const enrollmentLead = leads.find(
      (l) =>
        normalizeEmailLower(l?.contact?.email || "") === normalizeEmailLower(email) &&
        l.leadId !== leadId
    );
    assert.ok(enrollmentLead, "a separate enrollment lead must have been created");
    assert.equal(enrollmentLead.contact.name, "Pat Example");
  } finally {
    removePortalAccountAndLead(account);
    removeLeadsByEmail(email);
  }
});

test("I. A Tax Watch Pro customer who entered via direct signup can purchase Pinnacle without disturbing Tax Watch Pro", async () => {
  const account = await directSignupAndActivate(PORT_PINNACLE, "i-cross-tw-" + Date.now(), "tax-watch-pro");

  try {
    patchLocalLead(account.leadId, activeEnrollmentFields("tax-watch-pro"));

    const res = await requestMembershipCheckout(PORT_PINNACLE, account.cookie, "pinnacle");
    const body = await res.json().catch(() => ({}));
    await assertCheckoutReachedStripe(res, body);

    const stillActive = getLocalLead(account.leadId).contactRequest.membershipEnrollment;
    assert.equal(stillActive.planKey, "tax-watch-pro");
    assert.equal(stillActive.enrollmentStatus, "Active Membership");
  } finally {
    removePortalAccountAndLead(account);
    removeLeadsByEmail(account.email);
  }
});

test("J. A Pinnacle customer who entered via direct signup can purchase Tax Watch Pro without disturbing Pinnacle", async () => {
  const account = await directSignupAndActivate(PORT_PINNACLE, "j-cross-pin-" + Date.now(), "pinnacle");

  try {
    patchLocalLead(account.leadId, activeEnrollmentFields("pinnacle"));

    const res = await requestMembershipCheckout(PORT_PINNACLE, account.cookie, "tax-watch-pro");
    const body = await res.json().catch(() => ({}));
    await assertCheckoutReachedStripe(res, body);

    const stillActive = getLocalLead(account.leadId).contactRequest.membershipEnrollment;
    assert.equal(stillActive.planKey, "pinnacle");
    assert.equal(stillActive.enrollmentStatus, "Active Membership");
  } finally {
    removePortalAccountAndLead(account);
    removeLeadsByEmail(account.email);
  }
});

test("K. A direct-signup customer with an already-active plan is still blocked from a duplicate purchase of that plan", async () => {
  const account = await directSignupAndActivate(PORT_DEFAULT, "k-dup-" + Date.now(), "tax-watch-pro");

  try {
    patchLocalLead(account.leadId, activeEnrollmentFields("tax-watch-pro"));

    const res = await requestMembershipCheckout(PORT_DEFAULT, account.cookie, "tax-watch-pro");
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /already active/);
  } finally {
    removePortalAccountAndLead(account);
    removeLeadsByEmail(account.email);
  }
});

test("L. Plan and billing frequency survive the signup round trip and the client-side handoff into stored intent", async () => {
  const email = `direct-signup-test+l-${Date.now()}@example.test`;

  try {
    const res = await directSignup(PORT_DEFAULT, email, "", "pinnacle", "annual");
    const body = await res.json();
    assert.equal(body.planKey, "pinnacle");
    assert.equal(body.billingFrequency, "annual");
  } finally {
    removeLeadsByEmail(email);
  }

  // Front-end: confirm beginMembershipAction()'s direct-purchase branch
  // stores planKey/action/billingFrequency/email/leadId from the
  // membership-signup response before handing off to activation. Checked
  // at the source level (this repo has no DOM test harness for this file)
  // against the actual shipped ui/index.html.
  const indexHtml = fs.readFileSync(path.join(REPO_ROOT, "ui", "index.html"), "utf8");
  assert.match(indexHtml, /leadId: data\.leadId \|\| ""/);
  assert.match(indexHtml, /planKey: data\.planKey \|\| planKey/);
  assert.match(indexHtml, /billingFrequency: data\.billingFrequency \|\| billingFrequency/);
  assert.match(indexHtml, /\/api\/client-portal\/membership-signup/);
});

test("M. The signup endpoint is rate limited", async () => {
  const email = `direct-signup-test+m-${Date.now()}@example.test`;

  try {
    let lastStatus = 200;
    for (let i = 0; i < 6; i += 1) {
      const res = await directSignup(PORT_DEFAULT, email, "", "tax-watch-pro", "monthly");
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    assert.equal(lastStatus, 429);
  } finally {
    removeLeadsByEmail(email);
  }
});

test("N. No cross-plan contamination: a direct-signup Tax Watch Pro customer has no Pinnacle access", async () => {
  const account = await directSignupAndActivate(PORT_PINNACLE, "n-nocontam-" + Date.now(), "tax-watch-pro");

  try {
    patchLocalLead(account.leadId, activeEnrollmentFields("tax-watch-pro"));

    const pinnacleAccess = await fetch(`${baseFor(PORT_PINNACLE)}/api/client-portal/view-access?view=pinnacle`, {
      headers: { Cookie: account.cookie }
    });
    const pinnacleBody = await pinnacleAccess.json();
    assert.equal(pinnacleBody.allowed, false);

    const taxWatchAccess = await fetch(`${baseFor(PORT_PINNACLE)}/api/client-portal/view-access?view=tax-watch`, {
      headers: { Cookie: account.cookie }
    });
    const taxWatchBody = await taxWatchAccess.json();
    assert.equal(taxWatchBody.allowed, true);
  } finally {
    removePortalAccountAndLead(account);
    removeLeadsByEmail(account.email);
  }
});
