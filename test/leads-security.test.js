"use strict";
// Automated regression tests for the Phase 1 production-hardening pass:
// authorization on the admin lead routes, fail-closed persistence in
// production, and the local-development fallback staying available.
//
// Spawns the real server.js as a child process (twice: once in local/dev
// mode, once in a simulated production mode) with an intentionally
// unreachable Supabase URL, so the fail-closed code paths are exercised for
// real without ever touching a live Supabase project or live Stripe. Only
// self-signed, local-secret-signed test webhook events are sent (the same
// stripe.webhooks.generateTestHeaderString technique used throughout this
// project's manual testing) -- no live Stripe API calls are made.
//
// Run with: npm test  (node --test test/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const Stripe = require("stripe");

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

const DEV_PORT = 3921;
const PROD_PORT = 3922;

const stripeForSigning = Stripe(STRIPE_DUMMY_KEY);

// Mirrors server.js generateLeadAccessToken exactly (HMAC-SHA256, base64url)
// against the same PUBLIC_LEAD_ACCESS_SECRET both test servers are started
// with, so tests can present valid tokens without importing server.js.
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
    // Guaranteed-unreachable: nothing listens on 127.0.0.1:1 (a reserved,
    // unassignable port), so every Supabase call fails fast and
    // deterministically -- simulating a genuine outage without contacting
    // any real Supabase project.
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

function signedWebhookHeader(payload) {
  return stripeForSigning.webhooks.generateTestHeaderString({
    payload,
    secret: STRIPE_WEBHOOK_SECRET
  });
}

let devServer;
let prodServer;

before(async () => {
  devServer = startServer(DEV_PORT, false);
  prodServer = startServer(PROD_PORT, true);
  await Promise.all([
    waitForServer(DEV_PORT),
    waitForServer(PROD_PORT)
  ]);
});

after(() => {
  if (devServer) devServer.kill();
  if (prodServer) prodServer.kill();
});

// =============================================================================
// AUTHORIZATION
// =============================================================================

test("A. GET /api/leads without office auth is rejected", async () => {
  const res = await fetch(`http://127.0.0.1:${DEV_PORT}/api/leads`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
});

test("B. PATCH /api/leads/:leadId without office auth is rejected when touching an office-only field (even with a valid lead token)", async () => {
  const res = await fetch(
    `http://127.0.0.1:${DEV_PORT}/api/leads/NONEXISTENT-TEST-LEAD`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Lead-Access-Token": testLeadAccessToken("NONEXISTENT-TEST-LEAD")
      },
      body: JSON.stringify({
        taxPreparationWork: { paymentStatus: "Paid / Verified" }
      })
    }
  );
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.ok(
    Array.isArray(body.fields) && body.fields.includes("taxPreparationWork")
  );
});

test("C. Authenticated office session can read GET /api/leads (dev, local fallback available)", async () => {
  const cookie = await officeSignIn(DEV_PORT);
  const res = await fetch(`http://127.0.0.1:${DEV_PORT}/api/leads`, {
    headers: { cookie }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.leads));
});

// =============================================================================
// PRODUCTION PERSISTENCE (fail closed)
// =============================================================================

test("D. Production Supabase read failure does not fall back to leads.json (GET /api/leads -> 503, not empty 200)", async () => {
  const cookie = await officeSignIn(PROD_PORT);
  const res = await fetch(`http://127.0.0.1:${PROD_PORT}/api/leads`, {
    headers: { cookie }
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.retryable, true);
});

test("E. Production Supabase write failure does not fall back to leads.json (PATCH /api/leads/:leadId -> 503)", async () => {
  const before = fs.existsSync(LEADS_FILE)
    ? fs.readFileSync(LEADS_FILE, "utf8")
    : null;

  const cookie = await officeSignIn(PROD_PORT);
  const res = await fetch(
    `http://127.0.0.1:${PROD_PORT}/api/leads/NONEXISTENT-TEST-LEAD`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ notes: "should never be persisted locally" })
    }
  );
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);

  const after = fs.existsSync(LEADS_FILE)
    ? fs.readFileSync(LEADS_FILE, "utf8")
    : null;
  assert.equal(
    after,
    before,
    "leads.json must be byte-for-byte unchanged after a production persistence failure"
  );
});

test("F. Production lead submission reports failure when the authoritative save fails (POST /api/lead -> 503)", async () => {
  const before = fs.existsSync(LEADS_FILE)
    ? fs.readFileSync(LEADS_FILE, "utf8")
    : null;

  const res = await fetch(`http://127.0.0.1:${PROD_PORT}/api/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Automated Test Submitter",
      email: "automated-test-submitter@example.test",
      phone: "(555) 555-0100",
      estimate: { totalTax: 0 }
    })
  });

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);

  const after = fs.existsSync(LEADS_FILE)
    ? fs.readFileSync(LEADS_FILE, "utf8")
    : null;
  assert.equal(
    after,
    before,
    "A production submission must never be silently written to leads.json when Supabase is unreachable"
  );
});

test("G. Stripe webhook persistence failure produces a retryable non-2xx response", async () => {
  const payload = JSON.stringify({
    id: "evt_test_automated_" + Date.now(),
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: "cs_test_automated_" + Date.now(),
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 15000,
        payment_intent: "pi_test_automated_" + Date.now(),
        metadata: {
          service: "irs_transcript_help",
          leadId: "NONEXISTENT-TEST-LEAD"
        }
      }
    }
  });

  const signature = signedWebhookHeader(payload);

  const res = await fetch(
    `http://127.0.0.1:${PROD_PORT}/api/stripe-webhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": signature
      },
      body: payload
    }
  );

  assert.ok(
    res.status >= 500 && res.status < 600,
    `Expected a 5xx retryable response, got ${res.status}`
  );
  const body = await res.json();
  assert.equal(body.received, false);
  assert.equal(body.retry, true);
});

// =============================================================================
// LOCAL DEVELOPMENT (fallback intentionally preserved)
// =============================================================================

test("H. Local/dev submission still succeeds via the leads.json fallback when Supabase is unreachable", async () => {
  const marker = "AUTOMATED-TEST-LEAD-" + Date.now();
  let leadId = null;

  // Cleanup always runs, even if an assertion below throws, so a failing
  // run can never leave a stray test record behind in leads.json.
  try {
    const res = await fetch(`http://127.0.0.1:${DEV_PORT}/api/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: marker,
        email: "automated-dev-fallback-test@example.test",
        phone: "(555) 555-0101",
        estimate: { totalTax: 0 }
      })
    });

    const body = await res.json().catch(() => ({}));
    leadId = body.leadId || body.lead?.leadId || null;

    assert.equal(res.status, 201);
    assert.ok(leadId, "Response must include the saved leadId");

    assert.ok(
      fs.existsSync(LEADS_FILE),
      "leads.json should exist after a successful dev-mode local-fallback save"
    );
    const leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    const found = leads.find((l) => l.leadId === leadId);
    assert.ok(found, "The dev-mode submission must actually land in leads.json");
  } finally {
    if (fs.existsSync(LEADS_FILE)) {
      const leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
      const remaining = leads.filter(
        (l) => l.leadId !== leadId && !String(l.contact?.name || "").startsWith("AUTOMATED-TEST-LEAD-")
      );
      if (remaining.length !== leads.length) {
        fs.writeFileSync(
          LEADS_FILE,
          JSON.stringify(remaining, null, 2) + "\n",
          "utf8"
        );
      }
    }
  }
});

// =============================================================================
// SECURITY
// =============================================================================

test("I. No Supabase service-role/secret key literal appears in any browser-served file", () => {
  const uiDirs = ["ui", "private-ui"];
  const offenders = [];

  for (const dir of uiDirs) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;

    const walk = (folder) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && /\.(html|js)$/i.test(entry.name)) {
          const content = fs.readFileSync(full, "utf8");
          // Looks for an actual key-shaped literal value (a long JWT, or a
          // Supabase "sb_secret_"/"sb_service_role_" prefixed token), not
          // just the words "service role" appearing in human-readable
          // admin copy (e.g. a readiness-checklist warning message).
          if (
            /sb_secret_[A-Za-z0-9]{10,}/.test(content) ||
            /sb_service_role_[A-Za-z0-9]{10,}/.test(content) ||
            /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(
              content
            )
          ) {
            offenders.push(full);
          }
        }
      }
    };

    walk(abs);
  }

  assert.deepEqual(
    offenders,
    [],
    "Service-role/secret Supabase key references must never appear in browser-served files: " +
      offenders.join(", ")
  );
});

test("J. Public single-lead lookup cannot enumerate all leads (valid token for an unknown id still returns 404, never a list)", async () => {
  const fakeLeadId = `DOES-NOT-EXIST-${Date.now()}`;
  const res = await fetch(
    `http://127.0.0.1:${DEV_PORT}/api/estimate-summary/${fakeLeadId}`,
    { headers: { "X-Lead-Access-Token": testLeadAccessToken(fakeLeadId) } }
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.lead, undefined);
});
