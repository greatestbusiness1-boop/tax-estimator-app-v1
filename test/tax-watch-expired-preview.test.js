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

// Also covers the final Tax Watch production-certification fix batch:
//   - accessLabel must not say "Not started" for Cancelled/Expired
//     memberships (buildClientPortalTaxWatchSummary).
//   - applyMembershipStripeUpdate() must clear paymentMethodBrand/Last4
//     (not just nextRenewalAt) when a subscription transitions to
//     Cancelled/Expired, proven end-to-end through the real
//     /api/stripe-webhook route using a locally HMAC-signed test event
//     (stripe.webhooks.generateTestHeaderString -- pure local signing, no
//     network call, no real Stripe API access).
//   - private-ui/client-portal-home.html's renderPortalPlanNavigation()
//     must use only the server-authoritative
//     programAccess["tax-watch-pro"].hasAccess, not a duplicated
//     taxWatch.active/status OR-chain.
//
// Also covers the disabled-checkout-button fix: the portal render flow must
// copy portal.taxWatch.checkout into currentMembershipCheckout
// unconditionally (not only as a side effect of configureTaxWatchPreview(),
// which is skipped whenever taxWatch.active is false), so a genuinely
// available checkout is never left permanently disabled for an account
// with no current preview/membership access.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const Stripe = require("stripe");

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
const STRIPE_WEBHOOK_SECRET =
  "whsec_test_only_dummy_secret_for_automated_tests";
const STRIPE_DUMMY_KEY =
  "sk_test_dummy_key_constructed_only_never_used_for_a_real_api_call";

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

const stripeTestClient = new Stripe(STRIPE_DUMMY_KEY);

// Locally HMAC-signs a Stripe event payload with the same dummy webhook
// secret the spawned server is configured with (stripe.webhooks.
// generateTestHeaderString performs no network call -- it is pure local
// signing, identical to what Stripe's own test suite uses) and posts it to
// the real /api/stripe-webhook route, exercising the actual
// processMembershipSubscription -> applyMembershipStripeUpdate code path.
async function postSignedStripeWebhook(eventPayload) {
  const payload = JSON.stringify(eventPayload);
  const header = stripeTestClient.webhooks.generateTestHeaderString({
    payload,
    secret: STRIPE_WEBHOOK_SECRET
  });
  return fetch(`${base()}/api/stripe-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": header
    },
    body: payload
  });
}

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

// =============================================================================
// H. State A -- clean account: no Tax Watch profile, no membership at all
// =============================================================================

test("H. Clean account (no profile, no membership): no access, not active, no active service, accessLabel is Not started", async () => {
  const account = await createActivatedAccount("clean-account-" + Date.now());

  try {
    const taxWatch = await getSessionTaxWatch(account.cookie);

    assert.equal(taxWatch.active, false);
    assert.equal(taxWatch.status, "not-started");
    assert.equal(taxWatch.accessLabel, "Not started");
    assert.equal(
      taxWatch.membership?.programAccess?.["tax-watch-pro"]?.hasAccess,
      false
    );
    // Nothing blocks a fresh live checkout for this account: no membership
    // record exists at all for getClientPortalMembershipSummary to find.
    assert.equal(taxWatch.membership?.exists, false);
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// I. Cancelled live membership
// =============================================================================

test("I. Cancelled live membership: no paid access, accurate accessLabel, no current renewal", async () => {
  const account = await createActivatedAccount("cancelled-" + Date.now());
  const membershipLeadId = await createLead(
    "cancelled-membership-" + Date.now(),
    account.email
  );

  try {
    patchLocalLead(
      membershipLeadId,
      membershipEnrollmentFixture({
        enrollmentStatus: "Cancelled",
        paymentStatus: "Cancelled",
        nextRenewalAt: "",
        paymentMethodBrand: "",
        paymentMethodLast4: ""
      })
    );

    const taxWatch = await getSessionTaxWatch(account.cookie);

    assert.equal(taxWatch.active, false);
    assert.equal(taxWatch.status, "cancelled");
    assert.equal(
      taxWatch.accessLabel,
      "Membership cancelled — no active access"
    );
    assert.notEqual(taxWatch.accessLabel, "Not started");
    assert.equal(
      taxWatch.membership?.programAccess?.["tax-watch-pro"]?.hasAccess,
      false
    );
    assert.equal(taxWatch.membership?.nextRenewalAt, "");
  } finally {
    removePortalAccountAndLead(account, [membershipLeadId]);
  }
});

// =============================================================================
// J. Expired live membership
// =============================================================================

test("J. Expired live membership: no active paid access, accurate accessLabel", async () => {
  const account = await createActivatedAccount("expired-membership-" + Date.now());
  const membershipLeadId = await createLead(
    "expired-membership-lead-" + Date.now(),
    account.email
  );

  try {
    patchLocalLead(
      membershipLeadId,
      membershipEnrollmentFixture({
        enrollmentStatus: "Expired",
        paymentStatus: "Expired",
        nextRenewalAt: "",
        paymentMethodBrand: "",
        paymentMethodLast4: ""
      })
    );

    const taxWatch = await getSessionTaxWatch(account.cookie);

    assert.equal(taxWatch.active, false);
    assert.equal(taxWatch.status, "expired");
    assert.equal(
      taxWatch.accessLabel,
      "Membership expired — no active access"
    );
    assert.notEqual(taxWatch.accessLabel, "Not started");
    assert.equal(
      taxWatch.membership?.programAccess?.["tax-watch-pro"]?.hasAccess,
      false
    );
  } finally {
    removePortalAccountAndLead(account, [membershipLeadId]);
  }
});

// =============================================================================
// K. Past Due / payment-failure state
// =============================================================================

test("K. Past Due membership: entitlement matches server rules, accessLabel does not imply healthy active access", async () => {
  const account = await createActivatedAccount("past-due-" + Date.now());
  const membershipLeadId = await createLead(
    "past-due-membership-" + Date.now(),
    account.email
  );

  try {
    patchLocalLead(
      membershipLeadId,
      membershipEnrollmentFixture({
        enrollmentStatus: "Past Due",
        paymentStatus: "Past Due"
      })
    );

    const taxWatch = await getSessionTaxWatch(account.cookie);

    // Entitlement: Past Due must never grant paid access.
    assert.equal(taxWatch.active, false);
    assert.notEqual(taxWatch.status, "active-membership");
    assert.equal(
      taxWatch.membership?.programAccess?.["tax-watch-pro"]?.hasAccess,
      false
    );
    // Wording: must not falsely present healthy active paid status, and
    // must not fall through to the generic (and here misleading) "Not
    // started" wording either.
    assert.equal(taxWatch.accessLabel, "Past Due — payment not confirmed");
    assert.notEqual(taxWatch.accessLabel, "Not started");
  } finally {
    removePortalAccountAndLead(account, [membershipLeadId]);
  }
});

// =============================================================================
// L. Stale payment card cleared end-to-end through the real Stripe webhook
// route (customer.subscription.deleted), proving the write-path fix in
// applyMembershipStripeUpdate() -- not just a read-path/source check.
// =============================================================================

test("L. Webhook-driven cancellation clears paymentMethodBrand/Last4 and nextRenewalAt, but preserves paymentHistory", async () => {
  const account = await createActivatedAccount("webhook-cancel-" + Date.now());
  const membershipLeadId = await createLead(
    "webhook-cancel-membership-" + Date.now(),
    account.email
  );

  try {
    // Simulate a previously-active paid membership with a saved card on
    // file, exactly the state that used to go stale after cancellation.
    patchLocalLead(
      membershipLeadId,
      membershipEnrollmentFixture({
        enrollmentStatus: "Active Membership",
        paymentStatus: "Paid / Confirmed",
        nextRenewalAt: new Date(
          Date.now() + 20 * 24 * 60 * 60 * 1000
        ).toISOString(),
        paymentMethodBrand: "Visa",
        paymentMethodLast4: "4242",
        stripeSubscriptionId: "sub_test_defect3_" + Date.now(),
        paymentHistory: [
          {
            id: "live-payment-defect3",
            status: "Paid",
            amountPaidCents: 1199,
            paidAt: new Date().toISOString(),
            environment: "live"
          }
        ]
      })
    );

    const before = await getSessionTaxWatch(account.cookie);
    assert.equal(before.membership?.paymentMethodBrand, "Visa");
    assert.equal(before.membership?.paymentMethodLast4, "4242");
    assert.ok(before.membership?.nextRenewalAt);

    const subscriptionId = "sub_test_defect3_webhook_" + Date.now();
    const webhookRes = await postSignedStripeWebhook({
      id: "evt_test_defect3_" + Date.now(),
      object: "event",
      type: "customer.subscription.deleted",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: {
        object: {
          id: subscriptionId,
          object: "subscription",
          customer: "cus_test_defect3",
          status: "canceled",
          livemode: false,
          cancel_at_period_end: false,
          cancel_at: null,
          metadata: {
            leadId: membershipLeadId,
            service: "year_round_membership",
            planKey: "tax-watch-pro",
            billingFrequency: "monthly"
          }
        }
      }
    });
    assert.equal(webhookRes.status, 200);

    const after = await getSessionTaxWatch(account.cookie);

    // Defect 3: stale card and renewal date both cleared.
    assert.equal(after.membership?.paymentMethodBrand, "");
    assert.equal(after.membership?.paymentMethodLast4, "");
    assert.equal(after.membership?.nextRenewalAt, "");
    assert.equal(after.status, "cancelled");
    assert.equal(after.accessLabel, "Membership cancelled — no active access");

    // Historical paymentHistory must survive the same update untouched.
    const history = after.membership?.paymentHistory || [];
    assert.ok(
      history.some((entry) => entry.id === "live-payment-defect3"),
      "historical paymentHistory entry must be preserved after cancellation"
    );
  } finally {
    removePortalAccountAndLead(account, [membershipLeadId]);
  }
});

// =============================================================================
// M. Frontend no longer independently reconstructs Tax Watch access
// =============================================================================

test("M. renderPortalPlanNavigation uses only the server-authoritative programAccess hasAccess flag", () => {
  const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");

  const fnMatch = /function renderPortalPlanNavigation\(portal = \{\}\) \{[\s\S]*?\r?\n    \}\r?\n/.exec(
    frontendSource
  );
  assert.ok(fnMatch, "renderPortalPlanNavigation must still exist");
  const fnBody = fnMatch[0];
  // Strip // line comments before checking for taxWatch.active/status usage
  // -- the explanatory comment left in place by the fix itself legitimately
  // mentions "taxWatch.active/status" in prose, which must not trip these
  // code-content assertions.
  const fnCode = fnBody.replace(/\/\/[^\r\n]*/g, "");

  assert.match(
    fnCode,
    /hasAccess:\s*Boolean\(access\["tax-watch-pro"\]\?\.hasAccess\)/,
    "hasAccess must be sourced solely from access[\"tax-watch-pro\"]?.hasAccess"
  );
  assert.doesNotMatch(
    fnCode,
    /taxWatch\.active/,
    "must no longer independently read taxWatch.active"
  );
  assert.doesNotMatch(
    fnCode,
    /taxWatch\.status\s*===\s*["']preview["']/,
    "must no longer independently read taxWatch.status === \"preview\""
  );
});

// =============================================================================
// N. Item 12 (paid live membership + expired old preview remains active) is
// already covered above by test E, unchanged by this batch -- see
// "E. A paid live membership remains active even alongside an old expired
// preview". No duplicate test added here.
// =============================================================================

// =============================================================================
// O-R. Disabled Tax Watch checkout button fix.
//
// Behavioral coverage below executes the REAL extracted source (via Node's
// built-in vm module -- no new dependency) against a minimal fake DOM,
// rather than re-implementing the logic, so these tests fail if the shipped
// behavior regresses even if the surrounding code is refactored.
// =============================================================================

function extractFunctionSource(source, functionName) {
  // (?:async\s+)? -- an async function's "async" keyword must be captured
  // as part of the extracted source (via match.index pointing at its
  // start), or the extracted text becomes a plain function containing a
  // now-illegal top-level `await`.
  const declPattern = new RegExp(
    `(?:async\\s+)?function\\s+${functionName}\\s*\\(`
  );
  const match = declPattern.exec(source);
  assert.ok(match, `function ${functionName} must exist in client-portal-home.html`);

  // Skip past the entire parameter list first -- a default value containing
  // its own braces would otherwise be mistaken for the function body's
  // closing brace.
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

function createFakeCheckoutButton(dataset = {}) {
  const attrs = {};
  const classes = new Set();
  return {
    dataset: { ...dataset },
    disabled: false,
    title: "",
    textContent: "",
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          classes.has(c) ? classes.delete(c) : classes.add(c);
        } else if (force) {
          classes.add(c);
        } else {
          classes.delete(c);
        }
      },
      contains: (c) => classes.has(c)
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name)
        ? attrs[name]
        : null;
    },
    removeAttribute(name) {
      delete attrs[name];
    }
  };
}

function buildPortalCheckoutSandbox(frontendSource, { withBillingToggle } = {}) {
  const configureSource = extractFunctionSource(
    frontendSource,
    "configureMembershipCheckoutButtons"
  );

  const checkoutButtons = [];
  const idElements = {};

  const fakeDocument = {
    querySelectorAll(selector) {
      if (selector === "[data-membership-checkout-plan]") return checkoutButtons;
      return [];
    },
    getElementById(id) {
      return idElements[id] || null;
    }
  };

  const sandbox = {
    document: fakeDocument,
    currentMembershipCheckout: {},
    portal: {},
    portalBillingMode: "annual",
    console
  };
  vm.createContext(sandbox);

  let script = configureSource;
  if (withBillingToggle) {
    script += "\n" + extractFunctionSource(frontendSource, "applyPortalBillingMode");
    idElements.taxWatchPricingCheckoutButton = createFakeCheckoutButton();
  }
  vm.runInContext(script, sandbox);

  return { sandbox, checkoutButtons, idElements };
}

test("O. The portal render flow copies taxWatch.checkout into currentMembershipCheckout before renderClientExperienceExplore runs, unconditionally on taxWatch.active", () => {
  const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");

  const flowMatch = /currentMembershipCheckout = \(portal\.taxWatch \|\| \{\}\)\.checkout \|\| \{\};[\s\S]{0,80}?renderClientExperienceExplore\(portal, serviceState\);/.exec(
    frontendSource
  );
  assert.ok(
    flowMatch,
    "currentMembershipCheckout must be assigned from portal.taxWatch.checkout " +
      "immediately before renderClientExperienceExplore(portal, serviceState) runs, " +
      "so it is populated on every render regardless of taxWatch.active"
  );
});

test("P. Real fix line + real configureMembershipCheckoutButtons(): taxWatch.active === false with checkout.taxWatchAvailable === true still enables the button", () => {
  const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");
  const fixLineMatch = /currentMembershipCheckout = \(portal\.taxWatch \|\| \{\}\)\.checkout \|\| \{\};/.exec(
    frontendSource
  );
  assert.ok(fixLineMatch, "the render-flow fix line must exist");

  const { sandbox, checkoutButtons } = buildPortalCheckoutSandbox(frontendSource);
  const button = createFakeCheckoutButton({ membershipCheckoutPlan: "tax-watch-pro" });
  checkoutButtons.push(button);

  // Exactly the reported production scenario: no current preview/membership
  // access, but the server reports checkout as genuinely available.
  sandbox.portal = {
    taxWatch: { active: false, checkout: { taxWatchAvailable: true } }
  };
  vm.runInContext(fixLineMatch[0], sandbox);
  sandbox.configureMembershipCheckoutButtons();

  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-disabled"), "false");
});

test("Q. Real fix line + real configureMembershipCheckoutButtons(): checkout.taxWatchAvailable === false keeps the button disabled", () => {
  const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");
  const fixLineMatch = /currentMembershipCheckout = \(portal\.taxWatch \|\| \{\}\)\.checkout \|\| \{\};/.exec(
    frontendSource
  );
  assert.ok(fixLineMatch, "the render-flow fix line must exist");

  const { sandbox, checkoutButtons } = buildPortalCheckoutSandbox(frontendSource);
  const button = createFakeCheckoutButton({ membershipCheckoutPlan: "tax-watch-pro" });
  checkoutButtons.push(button);

  sandbox.portal = {
    taxWatch: { active: false, checkout: { taxWatchAvailable: false } }
  };
  vm.runInContext(fixLineMatch[0], sandbox);
  sandbox.configureMembershipCheckoutButtons();

  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-disabled"), "true");
});

test("R. applyPortalBillingMode(): Monthly/Annual checkout button text still updates correctly after the fix", () => {
  const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");
  const { sandbox, idElements } = buildPortalCheckoutSandbox(frontendSource, {
    withBillingToggle: true
  });
  const checkoutEl = idElements.taxWatchPricingCheckoutButton;

  sandbox.applyPortalBillingMode("monthly");
  assert.equal(checkoutEl.textContent, "Open Monthly Checkout — $11.99");
  assert.equal(checkoutEl.dataset.membershipCheckoutBilling, "monthly");

  sandbox.applyPortalBillingMode("annual");
  assert.equal(checkoutEl.textContent, "Open Annual Checkout — $119");
  assert.equal(checkoutEl.dataset.membershipCheckoutBilling, "annual");
});

// =============================================================================
// S-W. Cancelled Tax Watch checkout return experience.
//
// Root cause: the Stripe cancel_url landed on the access-gated #tax-watch
// view, which -- for an account with no current Tax Watch access -- tripped
// openPortalView()'s restricted-view redirect and showed "That page is not
// included in your current plan." #plans-pricing (view "plans") is never
// listed in portalRestrictedViews, so returning there instead never trips
// that branch at all.
// =============================================================================

test("S. Server: a cancelled Tax Watch Pro checkout redirects to #plans-pricing, not #tax-watch", () => {
  const serverSource = fs.readFileSync(path.join(REPO_ROOT, "server.js"), "utf8");

  assert.match(
    serverSource,
    /config\.planKey === "tax-watch-pro"\s*\n\s*\?\s*`\$\{baseUrl\}\/client-portal\/home` \+\s*\n\s*"\?membershipCheckout=cancelled" \+\s*\n\s*`&billing=\$\{config\.billingFrequency\}` \+\s*\n\s*"#plans-pricing"/,
    "the tax-watch-pro cancel_url branch must use #plans-pricing (with the billing frequency carried through), not #tax-watch"
  );
});

test("T. Server: a cancelled Pinnacle checkout is left unchanged (#tax-watch, no billing param)", () => {
  const serverSource = fs.readFileSync(path.join(REPO_ROOT, "server.js"), "utf8");

  assert.match(
    serverSource,
    /:\s*`\$\{baseUrl\}\/client-portal\/home` \+\s*\n\s*"\?membershipCheckout=cancelled" \+\s*\n\s*"#tax-watch"/,
    "the non-tax-watch-pro (Pinnacle) cancel_url branch must remain exactly #tax-watch, unmodified"
  );
});

test("U. Server: the successful-checkout return path (success_url) is byte-for-byte unchanged", () => {
  const serverSource = fs.readFileSync(path.join(REPO_ROOT, "server.js"), "utf8");

  assert.match(
    serverSource,
    /success_url:\s*\n\s*`\$\{baseUrl\}\/client-portal\/home` \+\s*\n\s*"\?membershipCheckout=success" \+\s*\n\s*"&session_id=\{CHECKOUT_SESSION_ID\}" \+\s*\n\s*"#tax-watch",/,
    "success_url must remain exactly as it was before this fix"
  );
});

test("V. Frontend: #plans-pricing (view \"plans\") is never a restricted/access-gated view", () => {
  const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");

  const restrictedMatch = /const portalRestrictedViews = \{[\s\S]*?\n\s*\};/.exec(frontendSource);
  assert.ok(restrictedMatch, "portalRestrictedViews must exist");
  assert.doesNotMatch(
    restrictedMatch[0],
    /["']?plans["']?\s*:/,
    "\"plans\" must not appear as a key in portalRestrictedViews -- otherwise " +
      "landing there after a cancelled checkout would itself trip the " +
      "access-denied warning"
  );

  const hashMatch = /plans:\s*"plans-pricing"/.exec(frontendSource);
  assert.ok(
    hashMatch,
    "the \"plans\" view must map to the #plans-pricing hash so the cancel_url's " +
      "hash resolves to the unrestricted plans view"
  );
});

test("W. Frontend: cancelled-checkout handling shows the correct message and preserves the Monthly/Annual selection, using the real extracted source", async () => {
  const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");

  const confirmSource = extractFunctionSource(
    frontendSource,
    "confirmMembershipCheckoutFromUrl"
  );
  const messageSource = extractFunctionSource(
    frontendSource,
    "showMembershipCheckoutMessage"
  );
  const billingSource = extractFunctionSource(
    frontendSource,
    "applyPortalBillingMode"
  );

  const messageEl = createFakeCheckoutButton();
  const checkoutEl = createFakeCheckoutButton();
  const idElements = {
    membershipCheckoutMessage: messageEl,
    taxWatchPricingCheckoutButton: checkoutEl
  };
  const replaceStateCalls = [];

  const sandbox = {
    document: {
      getElementById(id) {
        return idElements[id] || null;
      },
      querySelectorAll() {
        return [];
      }
    },
    window: {
      location: {
        href: "https://portal.example.test/client-portal/home?membershipCheckout=cancelled&billing=monthly#plans-pricing"
      },
      history: {
        replaceState(...args) {
          replaceStateCalls.push(args);
        }
      }
    },
    URL,
    membershipCheckoutConfirming: false,
    portalBillingMode: "annual",
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${messageSource}\n${billingSource}\n${confirmSource}`,
    sandbox
  );

  const confirmed = await sandbox.confirmMembershipCheckoutFromUrl();

  assert.equal(confirmed, false);
  assert.match(messageEl.textContent, /Checkout cancelled\. No payment was made\./);
  // Monthly was carried through the return URL's billing param and must be
  // reflected in the actual pricing button text (proves the real
  // applyPortalBillingMode() ran, not just that the message changed).
  assert.equal(checkoutEl.textContent, "Open Monthly Checkout — $11.99");
  assert.equal(sandbox.portalBillingMode, "monthly");
  // membershipCheckout/session_id/billing must be scrubbed from the URL
  // after handling, same as the pre-existing cleanup behavior.
  assert.equal(replaceStateCalls.length, 1);
  const [, , newUrl] = replaceStateCalls[0];
  assert.doesNotMatch(newUrl, /membershipCheckout|session_id|billing=/);
});

// =============================================================================
// X-Y. Missing #membershipCheckoutMessage element fix.
//
// Root cause: showMembershipCheckoutMessage() correctly targeted
// document.getElementById("membershipCheckoutMessage"), but no element with
// that id existed anywhere in the page, so every Tax Watch checkout status
// message (checkout-creation, cancellation, success, and every error) was
// silently discarded. Test W above only proved the *function* behaves
// correctly against a fake element keyed by that id -- it could not catch a
// missing real element, since it never reads the real template. Test X
// closes that gap by checking the real template string directly.
// =============================================================================

test("X. membershipCheckoutMessage exists on the Tax Watch Pro pricing card, inside the same container as the checkout button", () => {
  const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");

  const cardMatch = /const taxWatchCheckoutAction = activeMembership[\s\S]*?: `<div class="tax-watch-preview-actions">[\s\S]*?<\/div>`;/.exec(
    frontendSource
  );
  assert.ok(
    cardMatch,
    "the Tax Watch Pro pricing card's non-active-membership checkout template must exist"
  );

  const template = cardMatch[0];
  assert.match(template, /id="taxWatchPricingCheckoutButton"/);
  assert.match(
    template,
    /id="membershipCheckoutMessage"/,
    "membershipCheckoutMessage must exist inside the same tax-watch-preview-actions " +
      "container as the checkout button -- otherwise showMembershipCheckoutMessage() " +
      "silently discards every Tax Watch checkout status message"
  );
  assert.match(
    template,
    /class="tax-watch-message" id="membershipCheckoutMessage" role="status" aria-live="polite"/,
    "must mirror the existing pinnacleCheckoutMessage element pattern exactly"
  );
});

test("Y. showMembershipCheckoutMessage(): real function writes visible text/class for cancellation, checkout-creation, and error messages", () => {
  const frontendSource = fs.readFileSync(CLIENT_PORTAL_HOME_FILE, "utf8");
  const messageSource = extractFunctionSource(
    frontendSource,
    "showMembershipCheckoutMessage"
  );

  const messageEl = createFakeCheckoutButton();
  const sandbox = {
    document: {
      getElementById(id) {
        return id === "membershipCheckoutMessage" ? messageEl : null;
      }
    },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(messageSource, sandbox);

  // B: the exact cancellation text confirmMembershipCheckoutFromUrl() sends.
  sandbox.showMembershipCheckoutMessage(
    "Checkout cancelled. No payment was made. Your saved records remain connected."
  );
  assert.equal(
    messageEl.textContent,
    "Checkout cancelled. No payment was made. Your saved records remain connected."
  );
  assert.match(messageEl.className, /\bshow\b/);

  // C: the exact checkout-creation text startMembershipCheckout() sends.
  sandbox.showMembershipCheckoutMessage(
    "Creating your secure Stripe subscription checkout. No charge occurs until you review and complete Stripe Checkout."
  );
  assert.match(messageEl.textContent, /Creating your secure Stripe subscription checkout/);
  assert.match(messageEl.className, /\bshow\b/);

  // D: an error message, using the real "bad" type used on checkout-creation
  // and confirmation failures.
  sandbox.showMembershipCheckoutMessage(
    "Secure Stripe checkout could not be opened. No charge was made.",
    "bad"
  );
  assert.match(messageEl.textContent, /could not be opened/);
  assert.match(messageEl.className, /\bshow\b/);
  assert.match(messageEl.className, /\bbad\b/);
});
