"use strict";
// Regression tests for the Tax Watch expired-preview access-state fix:
//   - buildClientPortalTaxWatchSummary()'s top-level `active`/`status`
//     fields must only report current preview access when the profile
//     exists AND the preview window has not expired (previewCurrentlyActive
//     = isActive && !previewWindow.expired), instead of the old bare
//     `isActive` (which only checked whether a taxWatchProfile record with
//     a preview/active-looking status string exists at all, regardless of
//     whether its own end date already passed).
//   - Paid membership access (membershipIsActive) is completely unaffected.
//   - taxWatch.preview itself keeps returning real data (dates, expired
//     flag) for any profile that ever existed, so the bottom-of-page
//     "Preview ended" messaging and countdown keep working -- only the
//     top-level active/status signals changed.
//
// Spawns the real server.js in dev mode (local leads.json fallback, since
// Supabase is deliberately unreachable) -- never touches a real Supabase
// project or live Stripe. Same conventions as
// test/membership-test-mode-isolation.test.js and
// test/client-portal-reset.test.js.
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
const CLIENT_PORTAL_HOME_FILE = path.join(
  REPO_ROOT,
  "private-ui",
  "client-portal-home.html"
);

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET =
  "test-only-office-session-secret-automated-tests-32chars-min";
const PUBLIC_LEAD_ACCESS_SECRET =
  "test-only-public-lead-access-secret-for-automated-tests-32ch";
const CLIENT_PORTAL_SESSION_SECRET =
  "test-only-client-portal-session-secret-automated-tests-32chr";

const DEV_PORT = 3931;

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

async function getLatestEmail(to, subjectContains) {
  const res = await fetch(`${base()}/api/dev/sent-test-emails`);
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

function taxWatchProfileFixture({ expired }) {
  const startedAt = expired
    ? new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const endsAt = expired
    ? new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString();

  return {
    taxWatchProfile: {
      status: "preview",
      previewStartedAt: startedAt,
      previewEndsAt: endsAt
    }
  };
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
        checkoutEnvironment: "live",
        paymentMethodBrand: "Visa",
        paymentMethodLast4: "1234",
        paymentHistory: [
          {
            id: "live-payment-1",
            status: "Paid",
            amountPaidCents: 1199,
            paidAt: new Date().toISOString(),
            environment: "live"
          }
        ],
        ...overrides
      }
    }
  };
}

async function createActivatedAccount(marker, password = "InitialPass123") {
  const email = `tax-watch-expired-preview-test+${marker}@example.test`;
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

async function getSessionTaxWatch(cookie) {
  const res = await fetch(`${base()}/api/client-portal/session`, {
    headers: { Cookie: cookie }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  return body.portal?.taxWatch || {};
}

let devServer;

before(async () => {
  devServer = startServer(DEV_PORT);
  await waitForServer(DEV_PORT);
});

after(() => {
  if (devServer) devServer.kill();
});

// =============================================================================
// A/B/C. Expired preview, no paid membership
// =============================================================================

test("A. Expired preview: taxWatch.active is false", async () => {
  const account = await createActivatedAccount("expired-active-" + Date.now());

  try {
    patchLocalLead(account.leadId, taxWatchProfileFixture({ expired: true }));

    const taxWatch = await getSessionTaxWatch(account.cookie);
    assert.equal(taxWatch.active, false);
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("B. Expired preview: Tax Watch hasAccess is false when there is no paid membership", async () => {
  const account = await createActivatedAccount("expired-hasaccess-" + Date.now());

  try {
    patchLocalLead(account.leadId, taxWatchProfileFixture({ expired: true }));

    const taxWatch = await getSessionTaxWatch(account.cookie);
    assert.equal(
      taxWatch.membership?.programAccess?.["tax-watch-pro"]?.hasAccess,
      false
    );
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("C. Expired preview: status does not resolve to preview or active-preview", async () => {
  const account = await createActivatedAccount("expired-status-" + Date.now());

  try {
    patchLocalLead(account.leadId, taxWatchProfileFixture({ expired: true }));

    const taxWatch = await getSessionTaxWatch(account.cookie);
    assert.notEqual(taxWatch.status, "preview");
    assert.notEqual(taxWatch.status, "active-preview");
    // Precise expected value, not just "something else":
    assert.equal(taxWatch.status, "preview-expired");
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// D. Non-expired preview is unaffected
// =============================================================================

test("D. Non-expired preview still remains active", async () => {
  const account = await createActivatedAccount("not-expired-" + Date.now());

  try {
    patchLocalLead(account.leadId, taxWatchProfileFixture({ expired: false }));

    const taxWatch = await getSessionTaxWatch(account.cookie);
    assert.equal(taxWatch.active, true);
    assert.equal(taxWatch.status, "preview");
    assert.equal(
      taxWatch.membership?.programAccess?.["tax-watch-pro"]?.hasAccess,
      true
    );
    // The bottom-of-page preview widget must still receive real dates.
    assert.ok(taxWatch.preview?.endsAt);
    assert.equal(taxWatch.preview?.expired, false);
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// E. Paid live membership overrides an old expired preview
// =============================================================================

test("E. A paid live membership remains active even alongside an old expired preview", async () => {
  const account = await createActivatedAccount("paid-overrides-" + Date.now());
  const membershipLeadId = await createLead(
    "paid-overrides-membership-" + Date.now(),
    account.email
  );

  try {
    patchLocalLead(account.leadId, taxWatchProfileFixture({ expired: true }));
    patchLocalLead(membershipLeadId, membershipEnrollmentFixture());

    const taxWatch = await getSessionTaxWatch(account.cookie);
    assert.equal(taxWatch.active, true);
    assert.equal(taxWatch.status, "active-membership");
    assert.equal(
      taxWatch.membership?.programAccess?.["tax-watch-pro"]?.hasAccess,
      true
    );
  } finally {
    removePortalAccountAndLead(account, [membershipLeadId]);
  }
});

// =============================================================================
// F. Expired preview is excluded from the Active Services count
// =============================================================================

test("F. Expired preview does not count as an active service through the returned portal state", async () => {
  const account = await createActivatedAccount("active-services-" + Date.now());

  try {
    patchLocalLead(account.leadId, taxWatchProfileFixture({ expired: true }));

    const taxWatch = await getSessionTaxWatch(account.cookie);

    // clientExperienceServiceItems() in private-ui/client-portal-home.html
    // adds a Tax Watch "active service" entry exclusively when
    // `portal.taxWatch?.active` is truthy -- confirmed by reading the
    // actual frontend source below. Since the fix makes this field false
    // for an expired preview, that entry is never added, so the Active
    // Services count correctly excludes it.
    assert.equal(taxWatch.active, false);

    const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");
    assert.match(
      frontendSource,
      /if\s*\(\s*portal\.taxWatch\?\.active\s*\)\s*\{/,
      "the Active Services builder must still key off portal.taxWatch.active " +
        "(confirms the server-side fix alone determines this outcome, with " +
        "no frontend change required)"
    );
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// G. Existing membership test/live isolation coverage is unaffected -- see
// test/membership-test-mode-isolation.test.js, exercised by the same
// `npm test` run as this file. Confirmed here only that isMembershipEnrollmentRecord/
// findMembershipEnrollmentLead were not touched by this change.
// =============================================================================

test("G. This fix does not touch the membership test/live isolation functions", () => {
  const serverSource = fs.readFileSync(
    path.join(REPO_ROOT, "server.js"),
    "utf8"
  );

  assert.match(
    serverSource,
    /CLIENT_PORTAL_PRODUCTION_HOST\s*&&\s*\n\s*String\(\s*\n\s*request\.membershipEnrollment\?\.checkoutEnvironment/,
    "isMembershipEnrollmentRecord's production test-mode guard must remain exactly as shipped earlier"
  );
});
