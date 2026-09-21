"use strict";
// Regression tests for the production test-mode membership isolation fix:
//   - isMembershipEnrollmentRecord() excludes any enrollment whose
//     checkoutEnvironment === "test" when CLIENT_PORTAL_PRODUCTION_HOST is
//     true (dev/test environments are unaffected).
//   - This single shared filter is what getClientPortalMembershipSummary()
//     (active status / programAccess.hasAccess / billing history / preview
//     reconciliation / checkout-confirm responses) and
//     findMembershipEnrollmentLead() (checkout eligibility +
//     ensureMembershipEnrollmentLead()'s reuse-vs-create decision) both sit
//     behind, so fixing it once covers all of them.
//
// IMPORTANT ARCHITECTURAL NOTE ON TEST STRATEGY:
// The Secure Client Portal's credential store (client_portal_accounts) is
// deliberately fail-closed: its local-file fallback is only enabled when
// CLIENT_PORTAL_PRODUCTION_HOST is false (allowLocalFallback:
// !CLIENT_PORTAL_PRODUCTION_HOST in server.js -- see the client-portal
// recovery work earlier in this project). That means every
// requireClientPortalApiSession-gated route (GET /api/client-portal/session,
// POST /api/client-portal/membership-checkout, etc.) is unreachable in a
// simulated-production spawned test instance without a real, reachable
// Supabase project -- this is a pre-existing constraint of the codebase,
// not something introduced by this fix, and it equally affected every
// earlier client-portal test file in this project (none of them spawn a
// production-mode instance for this reason).
//
// So: behavior that's genuinely reachable via HTTP without a live Supabase
// project (the dev-mode baseline, and the underlying leads-table matching
// that findMembershipEnrollmentLead/ensureMembershipEnrollmentLead perform,
// which reads leads.json + Supabase-with-fallback and does NOT depend on
// the credential store at all) is tested end-to-end over HTTP. The
// production-only branch of isMembershipEnrollmentRecord() -- reachable
// only through session-gated routes -- is verified by reading the actual,
// deployed function bodies out of server.js and asserting the exact guard
// condition and call-chain wiring are present. This is the same
// source-verification technique already used by test 15 in
// client-portal-reset.test.js for something else not exercisable through
// this offline harness.
//
// Run with: npm test  (node --test test/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");
const SERVER_FILE = path.join(REPO_ROOT, "server.js");

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET =
  "test-only-office-session-secret-automated-tests-32chars-min";
const PUBLIC_LEAD_ACCESS_SECRET =
  "test-only-public-lead-access-secret-for-automated-tests-32ch";
const CLIENT_PORTAL_SESSION_SECRET =
  "test-only-client-portal-session-secret-automated-tests-32chr";

const DEV_PORT = 3930;

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
    CLIENT_PORTAL_SESSION_SECRET,
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

async function postJson(pathname, payload) {
  return fetch(`${base()}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

function patchLocalLead(leadId, fields) {
  const leads = readLeadsFile();
  const idx = leads.findIndex((l) => l.leadId === leadId);
  assert.ok(idx >= 0, "test lead must exist in leads.json");
  Object.assign(leads[idx], fields);
  writeLeadsFile(leads);
}

function membershipEnrollmentFixture(overrides = {}) {
  return {
    contactRequest: {
      service: "Tax Watch Pro",
      membershipEnrollment: {
        version: 2,
        planKey: "tax-watch-pro",
        planName: "Tax Watch Pro",
        billingFrequency: "monthly",
        billingLabel: "Monthly",
        enrollmentStatus: "Active Membership",
        paymentStatus: "Paid / Confirmed",
        requestedAt: new Date().toISOString(),
        statusUpdatedAt: new Date().toISOString(),
        nextRenewalAt: "2026-11-28T00:00:00.000Z",
        paymentMethodBrand: "Visa",
        paymentMethodLast4: "4242",
        paymentHistory: [
          {
            id: overrides.paymentId || "payment-1",
            status: "Paid",
            amountPaidCents: 1199,
            paidAt: new Date().toISOString(),
            environment: overrides.environment || "test"
          }
        ],
        ...overrides
      }
    }
  };
}

async function createActivatedAccount(marker, password = "InitialPass123") {
  const email = `membership-isolation-test+${marker}@example.test`;
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
  assert.ok(code);

  const activateRes = await postJson("/api/client-portal/activate", {
    email,
    leadId,
    code,
    password
  });
  assert.equal(activateRes.status, 200);
  const cookie = extractSetCookie(activateRes);
  assert.ok(cookie);

  return { leadId, email, password, cookie };
}

function removePortalAccountAndLead(account, extraLeadIds = []) {
  if (!account) return;
  removeTestLead(account.leadId);
  extraLeadIds.forEach((id) => removeTestLead(id));

  const PORTAL_ACCOUNTS_FILE = path.join(
    REPO_ROOT,
    "client-portal-accounts.local.json"
  );
  if (!fs.existsSync(PORTAL_ACCOUNTS_FILE)) return;
  const raw = fs.readFileSync(PORTAL_ACCOUNTS_FILE, "utf8").trim();
  const records = raw ? JSON.parse(raw) : [];
  const remaining = records.filter((r) => r.leadId !== account.leadId);
  if (remaining.length !== records.length) {
    fs.writeFileSync(
      PORTAL_ACCOUNTS_FILE,
      JSON.stringify(remaining, null, 2),
      "utf8"
    );
  }
}

// =============================================================================
// Source-verification helper: extract a top-level named function's full
// source text from server.js by brace-matching from its declaration. Used
// only for the production-only branches this offline harness cannot
// exercise end to end (see the file header note above).
// =============================================================================

function extractFunctionSource(source, functionName) {
  const declPattern = new RegExp(
    `function\\s+${functionName}\\s*\\(`
  );
  const match = declPattern.exec(source);
  assert.ok(match, `function ${functionName} must exist in server.js`);

  // Skip past the entire parameter list first -- a default value like
  // `record = {}` contains its own brace pair, which would otherwise be
  // mistaken for the function body's closing brace.
  let parenDepth = 1;
  let i = match.index + match[0].length;
  for (; i < source.length && parenDepth > 0; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    if (source[i] === ")") parenDepth -= 1;
  }

  const openBraceIndex = source.indexOf("{", i);
  assert.ok(openBraceIndex > -1);

  let depth = 0;
  for (let j = openBraceIndex; j < source.length; j += 1) {
    if (source[j] === "{") depth += 1;
    if (source[j] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(match.index, j + 1);
      }
    }
  }

  throw new Error(`Could not find end of function ${functionName}`);
}

let devServer;
let serverSource;

before(async () => {
  devServer = startServer(DEV_PORT);
  await waitForServer(DEV_PORT);
  serverSource = fs.readFileSync(SERVER_FILE, "utf8");
});

after(() => {
  if (devServer) devServer.kill();
});

// =============================================================================
// A/B/D/E/F/G. Production-only branches -- source-verified (see file header)
// =============================================================================

test("A/D. isMembershipEnrollmentRecord excludes checkoutEnvironment===\"test\" only when CLIENT_PORTAL_PRODUCTION_HOST is true", () => {
  const fn = extractFunctionSource(
    serverSource,
    "isMembershipEnrollmentRecord"
  );

  assert.match(
    fn,
    /CLIENT_PORTAL_PRODUCTION_HOST/,
    "the production flag must gate the exclusion"
  );
  assert.match(
    fn,
    /checkoutEnvironment[\s\S]{0,40}===\s*["']test["']/,
    "the exclusion must check checkoutEnvironment === \"test\" exactly"
  );
  assert.match(
    fn,
    /return\s+false/,
    "a matching test-mode record must be excluded (return false)"
  );

  // The guard must not exclude records with no checkoutEnvironment at all
  // (older/legacy enrollments) -- it only checks equality to the literal
  // string "test", so an empty/undefined value never matches.
  assert.doesNotMatch(
    fn,
    /checkoutEnvironment[\s\S]{0,40}!==\s*["']live["']/,
    "must not exclude by \"not live\" (would wrongly exclude legacy/unmarked records)"
  );
});

test("B. isMembershipEnrollmentRecord does not exclude checkoutEnvironment===\"live\"", () => {
  const fn = extractFunctionSource(
    serverSource,
    "isMembershipEnrollmentRecord"
  );

  // The only literal environment value ever compared for exclusion is
  // "test" -- "live" (and any other value) is never matched by the guard,
  // so a live enrollment always falls through to `return true`.
  const testLiteralCount = (fn.match(/["']test["']/g) || []).length;
  const liveLiteralCount = (fn.match(/["']live["']/g) || []).length;

  assert.ok(testLiteralCount >= 1, "must reference the \"test\" literal");
  assert.equal(
    liveLiteralCount,
    0,
    "must never reference a \"live\" literal (nothing excludes live records)"
  );
  assert.match(fn, /return\s+true/, "a non-test record must resolve to true");
});

test("E/F. getClientPortalMembershipSummary and findMembershipEnrollmentLead both filter exclusively through isMembershipEnrollmentRecord", () => {
  const summaryFn = extractFunctionSource(
    serverSource,
    "getClientPortalMembershipSummary"
  );
  const findFn = extractFunctionSource(
    serverSource,
    "findMembershipEnrollmentLead"
  );

  assert.match(
    summaryFn,
    /isMembershipEnrollmentRecord\(/,
    "getClientPortalMembershipSummary must filter membershipEntries through isMembershipEnrollmentRecord " +
      "-- this is what activeMembershipExists (checkout eligibility), programAccess.hasAccess, billing " +
      "history, and preview reconciliation all read"
  );
  assert.match(
    findFn,
    /if\s*\(\s*!isMembershipEnrollmentRecord\(/,
    "findMembershipEnrollmentLead must reject a candidate that fails isMembershipEnrollmentRecord " +
      "(its sole membership-type gate) before ever comparing planKey"
  );

  // Confirm the actual call sites in the route layer that depend on these
  // two functions still exist and are wired the way the audit found them.
  assert.match(
    serverSource,
    /const\s+activeMembershipExists\s*=\s*\n?\s*existingMembership\.enrollmentStatus\s*===\s*\n?\s*["']Active Membership["']/,
    "the membership-checkout route's eligibility gate must still read enrollmentStatus from getClientPortalMembershipSummary's output"
  );
});

test("G. ensureMembershipEnrollmentLead only creates a new lead when findMembershipEnrollmentLead finds nothing", () => {
  const fn = extractFunctionSource(
    serverSource,
    "ensureMembershipEnrollmentLead"
  );

  assert.match(
    fn,
    /findMembershipEnrollmentLead\(/,
    "ensureMembershipEnrollmentLead must look up via findMembershipEnrollmentLead first"
  );
  assert.match(
    fn,
    /if\s*\(\s*existing\s*\)\s*\{\s*\n?\s*return\s+existing;/,
    "an existing match is returned as-is (reused) -- so once findMembershipEnrollmentLead correctly " +
      "excludes a test-mode record in production, this function falls through to create a brand-new, " +
      "clean CONTACT-... lead instead of reusing it"
  );
});

// =============================================================================
// C. Dev/test environment still sees test enrollment data (fully behavioral)
// =============================================================================

test("C. Dev-mode client-portal session still reports a test-mode Tax Watch Pro enrollment as active", async () => {
  const account = await createActivatedAccount(
    "dev-sees-test-" + Date.now()
  );
  const membershipLeadId = await createLead(
    "dev-sees-test-membership-" + Date.now(),
    account.email
  );

  try {
    patchLocalLead(
      membershipLeadId,
      membershipEnrollmentFixture({ environment: "test" })
    );

    const res = await fetch(`${base()}/api/client-portal/session`, {
      headers: { Cookie: account.cookie }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const membership = body.portal?.taxWatch?.membership;

    assert.equal(membership?.enrollmentStatus, "Active Membership");
    assert.equal(membership?.paymentStatus, "Paid / Confirmed");
    assert.equal(
      membership?.programAccess?.["tax-watch-pro"]?.hasAccess,
      true,
      "dev mode must still grant program access for a test-mode enrollment"
    );
  } finally {
    removePortalAccountAndLead(account, [membershipLeadId]);
  }
});

// =============================================================================
// H/I. Separate live and test enrollment leads never cross-contaminate
// (this is a data-modeling fact -- mergeMembershipPaymentHistory only ever
// runs within a single lead's own upsert, so two physically separate lead
// records for the same email can never merge paymentHistory with each
// other regardless of environment filtering)
// =============================================================================

test("H/I. A live-environment enrollment lead reports its own clean paymentHistory, uncontaminated by a co-existing test-environment lead for the same email", async () => {
  const account = await createActivatedAccount(
    "live-vs-test-" + Date.now()
  );
  const testLeadId = await createLead(
    "live-vs-test-testlead-" + Date.now(),
    account.email
  );
  const liveLeadId = await createLead(
    "live-vs-test-livelead-" + Date.now(),
    account.email
  );

  try {
    patchLocalLead(
      testLeadId,
      membershipEnrollmentFixture({
        environment: "test",
        paymentId: "test-payment-historic",
        statusUpdatedAt: new Date(Date.now() - 60000).toISOString()
      })
    );
    patchLocalLead(
      liveLeadId,
      membershipEnrollmentFixture({
        environment: "live",
        paymentId: "live-payment-new",
        statusUpdatedAt: new Date().toISOString()
      })
    );

    const res = await fetch(`${base()}/api/client-portal/session`, {
      headers: { Cookie: account.cookie }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const membership = body.portal?.taxWatch?.membership;

    // The most-recently-updated entry (the live one) is preferred, and its
    // paymentHistory must contain only its own entry -- never the historic
    // test lead's entry, since they are separate lead records.
    assert.equal(membership?.leadId, liveLeadId);
    const historyIds = (membership?.paymentHistory || []).map(
      (entry) => entry.id
    );
    assert.ok(historyIds.includes("live-payment-new"));
    assert.ok(
      !historyIds.includes("test-payment-historic"),
      "the historic test lead's payment entry must never appear merged into the live lead's history"
    );
  } finally {
    removePortalAccountAndLead(account, [testLeadId, liveLeadId]);
  }
});

// =============================================================================
// J. Existing Revenue Summary production test-mode exclusion is unaffected
// =============================================================================

test("J. This fix does not touch computeAdminRevenueSummary's separate, already-fixed test-mode exclusion", () => {
  // Revenue Summary's Tax Watch Pro/Pinnacle test-mode exclusion
  // (server.js, computeAdminRevenueSummary's membership loop) is a
  // completely separate code path from isMembershipEnrollmentRecord and
  // was not modified by this change. Its own dedicated regression coverage
  // lives in test/revenue-summary.test.js (tests 1, 2, 2b) and is exercised
  // by the same `npm test` run as this file -- confirming here only that
  // this fix left that function's source untouched.
  const revenueSummaryFn = extractFunctionSource(
    serverSource,
    "computeAdminRevenueSummary"
  );
  assert.match(
    revenueSummaryFn,
    /entryEnvironment\s*=\s*String\(\s*\n?\s*entry\.environment\s*\|\|\s*enrollment\.checkoutEnvironment/,
    "computeAdminRevenueSummary's own independent test-mode filter must remain exactly as fixed earlier"
  );
});
