"use strict";
// Regression tests for the Revenue Summary correction pass:
//   - Tax Watch Pro / Pinnacle: exclude Stripe TEST-mode membership
//     payments from PRODUCTION Revenue Summary while still counting live
//     production payments and older records that predate the per-entry
//     "environment" field.
//   - One-time services (Written Review, Transcript Help, Extensions,
//     Installment Agreements, Tax Preparation, Contractor 1099): a
//     previously-paid transaction must remain represented (as gross minus
//     refunded = net) after a Stripe refund, instead of disappearing
//     entirely once paymentStatus no longer contains "paid".
//   - Historical records that predate the Revenue Summary feature (paid
//     but missing amountPaidCents) must never be fabricated into revenue.
//
// Same approach as the other test files: spawns the real server.js twice
// (dev mode and simulated-production mode) against a deliberately
// unreachable Supabase URL -- never touches a real Supabase project or
// live Stripe. computeAdminRevenueSummary() always merges in the local
// leads.json fallback in addition to (an unreachable, here) Supabase, so
// writing directly to leads.json is a safe, real way to exercise its
// aggregation logic in both dev and simulated-production mode.
//
// Run with: npm test  (node --test test/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET =
  "test-only-office-session-secret-automated-tests-32chars-min";
const PUBLIC_LEAD_ACCESS_SECRET =
  "test-only-public-lead-access-secret-for-automated-tests-32ch";

const DEV_PORT = 3925;
const PROD_PORT = 3926;

function baseEnv(port, production) {
  return {
    ...process.env,
    PORT: String(port),
    NODE_ENV: production ? "production" : "",
    RENDER: production ? "1" : "",
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

function startServer(port, production) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: baseEnv(port, production),
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

async function officeSignIn(port) {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/office-document-review/sign-in`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey: OFFICE_KEY })
    }
  );
  const setCookie = res.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  assert.ok(cookie, "Office sign-in must return a session cookie");
  return cookie;
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

async function createDevLead(marker) {
  const res = await fetch(`http://127.0.0.1:${DEV_PORT}/api/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: marker,
      email: "revenue-summary-test@example.test",
      phone: "(555) 555-0111",
      estimate: { totalTax: 0 }
    })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  const leadId = body.leadId || body.lead?.leadId;
  assert.ok(leadId);
  return leadId;
}

function patchLocalLead(leadId, fields) {
  const leads = readLeadsFile();
  const idx = leads.findIndex((l) => l.leadId === leadId);
  assert.ok(idx >= 0, "test lead must exist in leads.json");
  Object.assign(leads[idx], fields);
  writeLeadsFile(leads);
}

async function getRevenueSummary(port, cookie) {
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/revenue-summary`, {
    headers: { Cookie: cookie }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  return body.summary;
}

function categoryOf(summary, key) {
  const found = summary.byCategory.find((c) => c.key === key);
  assert.ok(found, `revenue summary must include the "${key}" category`);
  return found;
}

let devServer;
let prodServer;
let devCookie;
let prodCookie;

before(async () => {
  devServer = startServer(DEV_PORT, false);
  prodServer = startServer(PROD_PORT, true);
  await Promise.all([waitForServer(DEV_PORT), waitForServer(PROD_PORT)]);
  devCookie = await officeSignIn(DEV_PORT);
  prodCookie = await officeSignIn(PROD_PORT);
});

after(() => {
  if (devServer) devServer.kill();
  if (prodServer) prodServer.kill();
});

// =============================================================================
// A. Tax Watch Pro / Pinnacle -- Stripe test-mode exclusion in production
// =============================================================================

test("1. Tax Watch Pro checkoutEnvironment=test is excluded from PRODUCTION Revenue Summary", async () => {
  const leadId = await createDevLead("REVSUM-TWP-TEST-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    patchLocalLead(leadId, {
      contactRequest: {
        membershipEnrollment: {
          planKey: "tax-watch-pro",
          checkoutEnvironment: "test",
          paymentHistory: [
            { status: "Paid", amountPaidCents: 1199, environment: "test" }
          ]
        }
      }
    });

    // The delta must be zero -- a test-mode entry must never contribute to
    // PRODUCTION revenue.
    const after = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    assert.equal(after.collectedCents, before.collectedCents);
    assert.equal(after.transactionCount, before.transactionCount);
  } finally {
    removeTestLead(leadId);
  }
});

test("2. Tax Watch Pro checkoutEnvironment=live is counted in PRODUCTION Revenue Summary", async () => {
  const leadId = await createDevLead("REVSUM-TWP-LIVE-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    patchLocalLead(leadId, {
      contactRequest: {
        membershipEnrollment: {
          planKey: "tax-watch-pro",
          checkoutEnvironment: "live",
          paymentHistory: [
            { status: "Paid", amountPaidCents: 1199, environment: "live" }
          ]
        }
      }
    });

    const after = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    assert.equal(after.collectedCents, before.collectedCents + 1199);
    assert.equal(after.transactionCount, before.transactionCount + 1);
  } finally {
    removeTestLead(leadId);
  }
});

test("2b. Tax Watch Pro entry with no environment recorded (older legitimate record) is still counted in production", async () => {
  const leadId = await createDevLead("REVSUM-TWP-NOENV-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    patchLocalLead(leadId, {
      contactRequest: {
        membershipEnrollment: {
          planKey: "tax-watch-pro",
          // No checkoutEnvironment at all -- predates the field.
          paymentHistory: [
            { status: "Paid", amountPaidCents: 1199 }
          ]
        }
      }
    });

    const after = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    assert.equal(after.collectedCents, before.collectedCents + 1199);
    assert.equal(after.transactionCount, before.transactionCount + 1);
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// B. One-time service refunds must remain represented, not disappear
// =============================================================================

test("3. Fully refunded Written Review remains 1 transaction: net $0.00, refunded $29.00", async () => {
  const leadId = await createDevLead("REVSUM-WR-FULL-REFUND-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "written_review"
    );

    patchLocalLead(leadId, {
      writtenReview: {
        paymentStatus: "Refunded",
        amountPaidCents: 2900,
        refundStatus: "refunded",
        refundedAmountCents: 2900
      }
    });

    const after = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "written_review"
    );

    assert.equal(after.collectedCents, before.collectedCents + 0);
    assert.equal(after.refundedCents, before.refundedCents + 2900);
    assert.equal(after.transactionCount, before.transactionCount + 1);
  } finally {
    removeTestLead(leadId);
  }
});

test("4. Partially refunded Extension shows net $100.00 / refunded $50.00 on $150.00 gross", async () => {
  const leadId = await createDevLead("REVSUM-EXT-PARTIAL-REFUND-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "extension"
    );

    patchLocalLead(leadId, {
      extensionRequest: {
        paymentStatus: "Partially Refunded",
        totalPriceCents: 15000,
        refundStatus: "partial",
        refundedAmountCents: 5000
      }
    });

    const after = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "extension"
    );

    assert.equal(after.collectedCents, before.collectedCents + 10000);
    assert.equal(after.refundedCents, before.refundedCents + 5000);
    assert.equal(after.transactionCount, before.transactionCount + 1);
  } finally {
    removeTestLead(leadId);
  }
});

test("5. Normal paid Transcript Help (no refund) still counts correctly", async () => {
  const leadId = await createDevLead("REVSUM-TRANSCRIPT-PAID-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "transcript_help"
    );

    patchLocalLead(leadId, {
      transcriptRequest: {
        paymentStatus: "Paid / Verified",
        amountPaidCents: 15000
      }
    });

    const after = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "transcript_help"
    );

    assert.equal(after.collectedCents, before.collectedCents + 15000);
    assert.equal(after.refundedCents, before.refundedCents);
    assert.equal(after.transactionCount, before.transactionCount + 1);
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// C. Historical records predating Revenue Summary must not be fabricated
// =============================================================================

test("6. Historical 'Paid / Verified' Written Review with no amountPaidCents contributes $0, not fabricated", async () => {
  const leadId = await createDevLead("REVSUM-WR-HISTORICAL-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "written_review"
    );

    patchLocalLead(leadId, {
      writtenReview: {
        status: "Paid / Needs Written Review",
        paymentStatus: "Paid / Verified"
        // No amountPaidCents -- matches the real historical records.
      }
    });

    const after = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "written_review"
    );

    assert.equal(after.collectedCents, before.collectedCents);
    assert.equal(after.refundedCents, before.refundedCents);
    assert.equal(after.transactionCount, before.transactionCount);
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// D. Tax Watch Pro / Pinnacle subscription payments must net refunds too
// (final certification fix batch, mirrors the one-time-service pattern above)
// =============================================================================

test("8. Partially refunded live Tax Watch Pro payment nets collected/refunded correctly", async () => {
  const leadId = await createDevLead("REVSUM-TWP-PARTIAL-REFUND-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    patchLocalLead(leadId, {
      contactRequest: {
        membershipEnrollment: {
          planKey: "tax-watch-pro",
          checkoutEnvironment: "live",
          paymentHistory: [
            {
              status: "Paid",
              amountPaidCents: 1199,
              environment: "live",
              refundedAmountCents: 500
            }
          ]
        }
      }
    });

    const after = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    assert.equal(after.collectedCents, before.collectedCents + 699);
    assert.equal(after.refundedCents, before.refundedCents + 500);
    assert.equal(after.transactionCount, before.transactionCount + 1);
  } finally {
    removeTestLead(leadId);
  }
});

test("9. Fully refunded live Tax Watch Pro payment nets to $0 collected, full amount refunded", async () => {
  const leadId = await createDevLead("REVSUM-TWP-FULL-REFUND-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    patchLocalLead(leadId, {
      contactRequest: {
        membershipEnrollment: {
          planKey: "tax-watch-pro",
          checkoutEnvironment: "live",
          paymentHistory: [
            {
              status: "Paid",
              amountPaidCents: 1199,
              environment: "live",
              refundedAmountCents: 1199
            }
          ]
        }
      }
    });

    const after = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    assert.equal(after.collectedCents, before.collectedCents + 0);
    assert.equal(after.refundedCents, before.refundedCents + 1199);
    assert.equal(after.transactionCount, before.transactionCount + 1);
  } finally {
    removeTestLead(leadId);
  }
});

test("10. Refunded TEST-mode Tax Watch Pro payment contributes $0 to PRODUCTION revenue and refunded totals", async () => {
  const leadId = await createDevLead("REVSUM-TWP-TEST-REFUND-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    patchLocalLead(leadId, {
      contactRequest: {
        membershipEnrollment: {
          planKey: "tax-watch-pro",
          checkoutEnvironment: "test",
          paymentHistory: [
            {
              status: "Paid",
              amountPaidCents: 1199,
              environment: "test",
              refundedAmountCents: 1199
            }
          ]
        }
      }
    });

    const after = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "tax_watch_pro"
    );

    assert.equal(after.collectedCents, before.collectedCents);
    assert.equal(after.refundedCents, before.refundedCents);
    assert.equal(after.transactionCount, before.transactionCount);
  } finally {
    removeTestLead(leadId);
  }
});

test("11. Partially refunded live Pinnacle payment nets collected/refunded correctly", async () => {
  const leadId = await createDevLead("REVSUM-PINNACLE-PARTIAL-REFUND-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "pinnacle"
    );

    patchLocalLead(leadId, {
      contactRequest: {
        membershipEnrollment: {
          planKey: "pinnacle",
          checkoutEnvironment: "live",
          paymentHistory: [
            {
              status: "Paid",
              amountPaidCents: 9900,
              environment: "live",
              refundedAmountCents: 2000
            }
          ]
        }
      }
    });

    const after = categoryOf(
      await getRevenueSummary(PROD_PORT, prodCookie),
      "pinnacle"
    );

    assert.equal(after.collectedCents, before.collectedCents + 7900);
    assert.equal(after.refundedCents, before.refundedCents + 2000);
    assert.equal(after.transactionCount, before.transactionCount + 1);
  } finally {
    removeTestLead(leadId);
  }
});

test("7. Unpaid Extension request with only a computed totalPriceCents is still excluded", async () => {
  const leadId = await createDevLead("REVSUM-EXT-UNPAID-" + Date.now());

  try {
    const before = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "extension"
    );

    patchLocalLead(leadId, {
      extensionRequest: {
        totalPriceCents: 17500
        // No paymentStatus, no refundStatus -- never actually paid.
      }
    });

    const after = categoryOf(
      await getRevenueSummary(DEV_PORT, devCookie),
      "extension"
    );

    assert.equal(after.collectedCents, before.collectedCents);
    assert.equal(after.transactionCount, before.transactionCount);
  } finally {
    removeTestLead(leadId);
  }
});
