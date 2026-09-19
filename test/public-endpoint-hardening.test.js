"use strict";
// Regression tests for the second (public-endpoint) and third (lead-access-
// token) hardening passes:
//   - GET /api/estimate-summary/:leadId fail-closed + sanitized DTO
//   - PATCH /api/leads/:leadId allowlist model
//   - Stateless HMAC-SHA256 public lead access token (X-Lead-Access-Token)
//     now required, in addition to the allowlist, for every unauthenticated
//     lead-scoped request.
// Same approach as test/leads-security.test.js: spawns the real server.js
// against a deliberately unreachable Supabase URL (dev-mode and simulated-
// production instances) -- never touches a real Supabase project or live
// Stripe.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET =
  "test-only-office-session-secret-automated-tests-32chars-min";
const STRIPE_WEBHOOK_SECRET =
  "whsec_test_only_dummy_secret_for_automated_tests";
const STRIPE_DUMMY_KEY =
  "sk_test_dummy_key_constructed_only_never_used_for_a_real_api_call";
const PUBLIC_LEAD_ACCESS_SECRET =
  "test-only-public-lead-access-secret-for-automated-tests-32ch";

const DEV_PORT = 3923;
const PROD_PORT = 3924;

// Mirrors server.js generateLeadAccessToken exactly (HMAC-SHA256, base64url)
// against the same PUBLIC_LEAD_ACCESS_SECRET both test servers are started
// with below, so tests can present valid/forged tokens without importing
// server.js.
function testLeadAccessToken(leadId) {
  return crypto
    .createHmac("sha256", PUBLIC_LEAD_ACCESS_SECRET)
    .update(String(leadId || ""))
    .digest("base64url");
}

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
    STRIPE_SECRET_KEY: STRIPE_DUMMY_KEY,
    STRIPE_WEBHOOK_SECRET,
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
      email: "public-hardening-test@example.test",
      phone: "(555) 555-0111",
      estimate: { totalTax: 0 }
    })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  const leadId = body.leadId || body.lead?.leadId;
  assert.ok(leadId);
  // POST /api/lead itself now also returns a valid token for the lead it
  // just created -- confirm that end-to-end wiring here once, cheaply.
  assert.ok(body.accessToken, "POST /api/lead must return an accessToken");
  assert.equal(
    body.accessToken,
    testLeadAccessToken(leadId),
    "the returned accessToken must match the deterministic HMAC for this leadId"
  );
  return leadId;
}

let devServer;
let prodServer;

before(async () => {
  devServer = startServer(DEV_PORT, false);
  prodServer = startServer(PROD_PORT, true);
  await Promise.all([waitForServer(DEV_PORT), waitForServer(PROD_PORT)]);
});

after(() => {
  if (devServer) devServer.kill();
  if (prodServer) prodServer.kill();
});

// =============================================================================
// A/12/13. estimate-summary production fail-closed
// =============================================================================

test("A. Production GET /api/estimate-summary/:leadId does not fall back to leads.json (-> 503), even with a valid token", async () => {
  const before = fs.existsSync(LEADS_FILE)
    ? fs.readFileSync(LEADS_FILE, "utf8")
    : null;

  const res = await fetch(
    `http://127.0.0.1:${PROD_PORT}/api/estimate-summary/ANY-LEAD-ID`,
    { headers: { "X-Lead-Access-Token": testLeadAccessToken("ANY-LEAD-ID") } }
  );
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.retryable, true);

  const after = fs.existsSync(LEADS_FILE)
    ? fs.readFileSync(LEADS_FILE, "utf8")
    : null;
  assert.equal(after, before, "leads.json must be unchanged by a production outage");
});

// =============================================================================
// B/10/11. estimate-summary sanitized DTO
// =============================================================================

test("B. Public estimate-summary (with a valid token) cannot expose office-only/payment-sensitive fields", async () => {
  const marker = "PUBLIC-DTO-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    // Simulate what a real payment/office workflow would have written onto
    // this lead (internal notes, Stripe identifiers, workflow status) by
    // writing directly to the local fallback file the dev server is using.
    const leads = readLeadsFile();
    const idx = leads.findIndex((l) => l.leadId === leadId);
    assert.ok(idx >= 0, "test lead must exist in leads.json");

    leads[idx].notes =
      "[office] Internal-only note: client called about billing.";
    leads[idx].priority = "high";
    leads[idx].status = "Transcript Help - Paid / Needs Review";
    leads[idx].Request = {
      requested: true,
      clientTaxStrategyWorksheet: { fullName: "Test Client" },
      clientTaxStrategyWorksheetStatus: "Completed",
      clientTaxStrategyWorksheetCompletedAt: new Date().toISOString(),
      paymentStatus: "Paid / Verified",
      stripeCheckoutSessionId: "cs_test_should_not_leak",
      stripePaymentIntentId: "pi_test_should_not_leak",
      refundStatus: "refunded",
      refundedAmountCents: 5000,
      amountPaidCents: 15000
    };
    writeLeadsFile(leads);

    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/estimate-summary/${encodeURIComponent(leadId)}`,
      { headers: { "X-Lead-Access-Token": testLeadAccessToken(leadId) } }
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const lead = body.lead;
    assert.equal(lead.notes, undefined, "notes must never be returned publicly");
    assert.equal(lead.status, undefined, "status must never be returned publicly");
    assert.equal(lead.priority, undefined, "priority must never be returned publicly");

    const serialized = JSON.stringify(lead);
    assert.ok(
      !/cs_test_should_not_leak|pi_test_should_not_leak/.test(serialized),
      "Stripe identifiers must never appear in the public response"
    );
    assert.ok(
      !/Paid \/ Verified|refunded|amountPaidCents|refundedAmountCents/i.test(
        serialized
      ),
      "Payment/refund state must never appear in the public response"
    );
    assert.ok(
      !/Internal-only note/.test(serialized),
      "Internal office notes must never appear in the public response"
    );

    // The legitimately-needed worksheet fields must still be present.
    assert.equal(
      lead.Request.clientTaxStrategyWorksheetStatus,
      "Completed"
    );
    assert.ok(lead.Request.clientTaxStrategyWorksheet);
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// 1-4. Lead access token: read-path enforcement
// =============================================================================

test("Token-1. Valid signed token allows the legitimate public estimate-summary read", async () => {
  const marker = "TOKEN-VALID-READ-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/estimate-summary/${encodeURIComponent(leadId)}`,
      { headers: { "X-Lead-Access-Token": testLeadAccessToken(leadId) } }
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.lead.leadId, leadId);
  } finally {
    removeTestLead(leadId);
  }
});

test("Token-2. Missing token is rejected on estimate-summary", async () => {
  const marker = "TOKEN-MISSING-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/estimate-summary/${encodeURIComponent(leadId)}`
    );
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
  } finally {
    removeTestLead(leadId);
  }
});

test("Token-3. Invalid/forged token is rejected on estimate-summary", async () => {
  const marker = "TOKEN-FORGED-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const forged = Buffer.from("not-a-real-hmac-value").toString("base64url");
    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/estimate-summary/${encodeURIComponent(leadId)}`,
      { headers: { "X-Lead-Access-Token": forged } }
    );
    assert.equal(res.status, 401);
  } finally {
    removeTestLead(leadId);
  }
});

test("Token-4. Token issued for lead A cannot access lead B", async () => {
  const markerA = "TOKEN-LEAD-A-" + Date.now();
  const markerB = "TOKEN-LEAD-B-" + Date.now();
  const leadIdA = await createDevLead(markerA);
  const leadIdB = await createDevLead(markerB);

  try {
    const tokenForA = testLeadAccessToken(leadIdA);
    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/estimate-summary/${encodeURIComponent(leadIdB)}`,
      { headers: { "X-Lead-Access-Token": tokenForA } }
    );
    assert.equal(res.status, 401);
  } finally {
    removeTestLead(leadIdA);
    removeTestLead(leadIdB);
  }
});

// =============================================================================
// C-E, H. PATCH allowlist enforcement (now requires a valid token first)
// =============================================================================

test("C. Unauthenticated PATCH (with a valid token) rejects an unknown arbitrary field", async () => {
  const leadId = "NONEXISTENT-TEST-LEAD";
  const res = await fetch(
    `http://127.0.0.1:${DEV_PORT}/api/leads/${leadId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Lead-Access-Token": testLeadAccessToken(leadId)
      },
      body: JSON.stringify({ someRandomFutureField: "hello" })
    }
  );
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.fields.includes("someRandomFutureField"));
});

test("D. Unauthenticated PATCH (with a valid token) rejects contactEmail", async () => {
  const leadId = "NONEXISTENT-TEST-LEAD";
  const res = await fetch(
    `http://127.0.0.1:${DEV_PORT}/api/leads/${leadId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Lead-Access-Token": testLeadAccessToken(leadId)
      },
      body: JSON.stringify({ contactEmail: "attacker@example.test" })
    }
  );
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.fields.includes("contactEmail"));
});

test("E. Unauthenticated PATCH (with a valid token) rejects payment/Stripe fields smuggled inside transcriptRequest", async () => {
  const leadId = "NONEXISTENT-TEST-LEAD";
  const res = await fetch(
    `http://127.0.0.1:${DEV_PORT}/api/leads/${leadId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Lead-Access-Token": testLeadAccessToken(leadId)
      },
      body: JSON.stringify({
        transcriptRequest: {
          requested: true,
          paymentStatus: "Paid / Verified",
          stripePaymentIntentId: "pi_fake_injected"
        }
      })
    }
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.ok(
    body.rejected.includes("paymentStatus") ||
      body.rejected.includes("stripePaymentIntentId")
  );
});

test("E2. Unauthenticated PATCH (with a valid token) still rejects office-only top-level fields (taxPreparationWork)", async () => {
  const leadId = "NONEXISTENT-TEST-LEAD";
  const res = await fetch(
    `http://127.0.0.1:${DEV_PORT}/api/leads/${leadId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Lead-Access-Token": testLeadAccessToken(leadId)
      },
      body: JSON.stringify({
        taxPreparationWork: { paymentStatus: "Paid / Verified" }
      })
    }
  );
  assert.equal(res.status, 401);
});

test("H. Public status updates (with a valid token) are restricted to their allowed values", async () => {
  const leadId = "NONEXISTENT-TEST-LEAD";
  const res = await fetch(
    `http://127.0.0.1:${DEV_PORT}/api/leads/${leadId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Lead-Access-Token": testLeadAccessToken(leadId)
      },
      body: JSON.stringify({ status: "Completed" })
    }
  );
  assert.equal(res.status, 400);
});

// =============================================================================
// 5/6. PATCH token enforcement
// =============================================================================

test("Token-5. Valid token allows the legitimate narrowly-scoped public PATCH workflow", async () => {
  const marker = "TOKEN-PATCH-VALID-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/leads/${encodeURIComponent(leadId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Lead-Access-Token": testLeadAccessToken(leadId)
        },
        body: JSON.stringify({ notes: "Legitimate client note." })
      }
    );
    assert.equal(res.status, 200);
  } finally {
    removeTestLead(leadId);
  }
});

test("Token-6. Missing/invalid token cannot PATCH a real lead", async () => {
  const marker = "TOKEN-PATCH-INVALID-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const missing = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/leads/${encodeURIComponent(leadId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "should be rejected" })
      }
    );
    assert.equal(missing.status, 401);

    const invalid = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/leads/${encodeURIComponent(leadId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Lead-Access-Token": "forged-token-value"
        },
        body: JSON.stringify({ notes: "should also be rejected" })
      }
    );
    assert.equal(invalid.status, 401);

    const after = readLeadsFile().find((l) => l.leadId === leadId);
    assert.equal(
      (after.notes || "").includes("should"),
      false,
      "neither rejected attempt may have written anything"
    );
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// F. Legitimate public workflows still succeed (with a valid token)
// =============================================================================

test("F. The real ui/app.js transcript-request PATCH payload still succeeds with a valid token", async () => {
  const marker = "PUBLIC-WORKFLOW-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/leads/${encodeURIComponent(leadId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Lead-Access-Token": testLeadAccessToken(leadId)
        },
        body: JSON.stringify({
          status: "Transcript Help - Payment Pending",
          notes: "[test] Client submitted IRS Transcript Help Request.",
          transcriptRequest: {
            requested: true,
            requestedAt: new Date().toISOString(),
            serviceName: "IRS Transcript Help & Tax Records Review",
            issueType: "Missing W-2",
            transcriptType: "Wage and Income",
            clientExplanation: "Need my W-2 transcript",
            taxYear: "2025",
            paymentStatus: "Requested / Waiting for Payment Verification",
            authorizationStatus: "Not requested yet"
          }
        })
      }
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// 9/G. Office-authenticated callers remain functional without the public token
// =============================================================================

test("G. Authenticated office PATCH still supports office-only field updates without a public token", async () => {
  const marker = "OFFICE-WORKFLOW-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const cookie = await officeSignIn(DEV_PORT);
    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/leads/${encodeURIComponent(leadId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          taxPreparationWork: { workStatus: "Ready to Prepare" }
        })
      }
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  } finally {
    removeTestLead(leadId);
  }
});

test("G2. Authenticated office session can read estimate-summary without a public token", async () => {
  const marker = "OFFICE-READ-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const cookie = await officeSignIn(DEV_PORT);
    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/estimate-summary/${encodeURIComponent(leadId)}`,
      { headers: { cookie } }
    );
    assert.equal(res.status, 200);
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// I. Public notes append-only (cannot overwrite internal staff notes)
// =============================================================================

test("I. Public notes submission (valid token) appends to, and never overwrites, existing internal notes", async () => {
  const marker = "NOTES-APPEND-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const leads = readLeadsFile();
    const idx = leads.findIndex((l) => l.leadId === leadId);
    leads[idx].notes = "[office] CONFIDENTIAL internal staff note.";
    writeLeadsFile(leads);

    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/leads/${encodeURIComponent(leadId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Lead-Access-Token": testLeadAccessToken(leadId)
        },
        body: JSON.stringify({ notes: "New client-submitted note." })
      }
    );
    assert.equal(res.status, 200);

    const after = readLeadsFile().find((l) => l.leadId === leadId);
    assert.ok(
      after.notes.includes("CONFIDENTIAL internal staff note"),
      "the original internal note must survive"
    );
    assert.ok(
      after.notes.includes("New client-submitted note"),
      "the new client note must be appended"
    );
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// 7/8. client-note token enforcement
// =============================================================================

test("Token-7. Valid token allows client-note append", async () => {
  const marker = "TOKEN-NOTE-VALID-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const res = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/leads/${encodeURIComponent(leadId)}/client-note`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lead-Access-Token": testLeadAccessToken(leadId)
        },
        body: JSON.stringify({ note: "Client started checkout." })
      }
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const after = readLeadsFile().find((l) => l.leadId === leadId);
    assert.ok(after.notes.includes("Client started checkout."));
  } finally {
    removeTestLead(leadId);
  }
});

test("Token-8. Missing/invalid token cannot append client notes", async () => {
  const marker = "TOKEN-NOTE-INVALID-TEST-" + Date.now();
  const leadId = await createDevLead(marker);

  try {
    const missing = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/leads/${encodeURIComponent(leadId)}/client-note`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "should be rejected" })
      }
    );
    assert.equal(missing.status, 401);

    const invalid = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/leads/${encodeURIComponent(leadId)}/client-note`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lead-Access-Token": "forged-value"
        },
        body: JSON.stringify({ note: "should also be rejected" })
      }
    );
    assert.equal(invalid.status, 401);

    const after = readLeadsFile().find((l) => l.leadId === leadId);
    assert.equal(
      (after.notes || "").includes("should"),
      false,
      "neither rejected attempt may have written a note"
    );
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// 12/13/J. Production database failure never reports a successful public
// mutation, and never touches leads.json
// =============================================================================

test("J. Production /api/leads/:leadId/client-note reports failure (even with a valid token) rather than a false success", async () => {
  const before = fs.existsSync(LEADS_FILE)
    ? fs.readFileSync(LEADS_FILE, "utf8")
    : null;

  const res = await fetch(
    `http://127.0.0.1:${PROD_PORT}/api/leads/ANY-LEAD-ID/client-note`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lead-Access-Token": testLeadAccessToken("ANY-LEAD-ID")
      },
      body: JSON.stringify({ note: "test action" })
    }
  );
  assert.notEqual(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);

  const after = fs.existsSync(LEADS_FILE)
    ? fs.readFileSync(LEADS_FILE, "utf8")
    : null;
  assert.equal(after, before, "leads.json must be unchanged by a production outage");
});
