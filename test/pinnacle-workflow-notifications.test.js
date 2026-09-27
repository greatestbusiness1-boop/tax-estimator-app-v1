"use strict";
// Tests for Pinnacle Workflow + Notifications v1 (Phase 6):
//   - Derived (never separately stored) office workflow status for a
//     Pinnacle enrollment lead: NEW ENROLLMENT / NEEDS REVIEW /
//     READY TO DELIVER / DELIVERED (ui/leads-dashboard.html
//     getPinnacleWorkflowStatus() / pinnacleWorkflowNeedsAttention()),
//     extracted and executed directly via Node's vm module -- the same
//     established technique test/tax-watch-expired-preview.test.js already
//     uses for testing real frontend functions.
//   - Idempotent Pinnacle enrollment-confirmation and plan-ready
//     transactional emails (server.js maybeSendPinnacleEnrollmentConfirmation()/
//     maybeSendPinnacleActionPlanReadyEmail()), using the existing
//     jsonTransport-backed /api/dev/sent-test-emails test convention --
//     never a real SMTP provider.
//   - Notification state lives in the isolated lead.pinnacleNotifications
//     field and can never affect pinnacleActionPlan's
//     deliveredAt/deliveryVersion/deliveredSnapshot/status.
//
// Spawns the real server.js in dev mode (local leads.json fallback, since
// Supabase is deliberately unreachable) -- never touches a real Supabase
// project or live Stripe/SMTP. Same conventions as
// test/pinnacle-action-plan-report.test.js.
//
// Run with: npm test  (node --test test/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_DASHBOARD_FILE = path.join(REPO_ROOT, "ui", "leads-dashboard.html");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");
const PORTAL_ACCOUNTS_FILE = path.join(REPO_ROOT, "client-portal-accounts.local.json");

// =============================================================================
// Group 1: pure unit tests -- derived Pinnacle workflow status
// =============================================================================

function extractFunctionSource(source, functionName) {
  const declPattern = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
  const match = declPattern.exec(source);
  assert.ok(match, `function ${functionName} must exist in leads-dashboard.html`);

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

function loadPinnacleWorkflowSandbox() {
  const frontendSource = fs.readFileSync(LEADS_DASHBOARD_FILE, "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  const script =
    extractFunctionSource(frontendSource, "getPinnacleWorkflowStatus") +
    "\n" +
    extractFunctionSource(frontendSource, "pinnacleWorkflowNeedsAttention");
  vm.runInContext(script, sandbox);
  return sandbox;
}

test("A. A new Pinnacle enrollment (no Action Plan yet) derives NEW ENROLLMENT", () => {
  const sandbox = loadPinnacleWorkflowSandbox();
  const result = vm.runInContext("getPinnacleWorkflowStatus({})", sandbox);
  assert.equal(result.key, "new_enrollment");

  sandbox.__lead = { pinnacleActionPlan: { status: "draft" } };
  const draftResult = vm.runInContext("getPinnacleWorkflowStatus(__lead)", sandbox);
  assert.equal(draftResult.key, "new_enrollment");
});

test("B. A plan with status needs_review derives NEEDS REVIEW", () => {
  const sandbox = loadPinnacleWorkflowSandbox();
  sandbox.__lead = { pinnacleActionPlan: { status: "needs_review" } };
  const result = vm.runInContext("getPinnacleWorkflowStatus(__lead)", sandbox);
  assert.equal(result.key, "needs_review");
});

test("C. A plan with status approved derives READY TO DELIVER", () => {
  const sandbox = loadPinnacleWorkflowSandbox();
  sandbox.__lead = { pinnacleActionPlan: { status: "approved" } };
  const result = vm.runInContext("getPinnacleWorkflowStatus(__lead)", sandbox);
  assert.equal(result.key, "ready_to_deliver");
});

test("D. A plan with status delivered derives DELIVERED", () => {
  const sandbox = loadPinnacleWorkflowSandbox();
  sandbox.__lead = { pinnacleActionPlan: { status: "delivered" } };
  const result = vm.runInContext("getPinnacleWorkflowStatus(__lead)", sandbox);
  assert.equal(result.key, "delivered");
});

test("E. Delivered plans are excluded from the attention count", () => {
  const sandbox = loadPinnacleWorkflowSandbox();
  sandbox.__lead = { pinnacleActionPlan: { status: "delivered" } };
  const needsAttention = vm.runInContext("pinnacleWorkflowNeedsAttention(__lead)", sandbox);
  assert.equal(needsAttention, false);
});

test("F. New enrollment, needs_review, and approved are all included in the attention count", () => {
  const sandbox = loadPinnacleWorkflowSandbox();
  for (const status of [undefined, "draft", "needs_review", "approved"]) {
    sandbox.__lead = status ? { pinnacleActionPlan: { status } } : {};
    const needsAttention = vm.runInContext("pinnacleWorkflowNeedsAttention(__lead)", sandbox);
    assert.equal(needsAttention, true, `status ${status} should need attention`);
  }
});

// =============================================================================
// Group 2: server-spawning tests -- notifications
// =============================================================================

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET = "test-only-office-session-secret-automated-tests-32chars-min";
const PUBLIC_LEAD_ACCESS_SECRET = "test-only-public-lead-access-secret-for-automated-tests-32ch";
const CLIENT_PORTAL_SESSION_SECRET = "test-only-client-portal-session-secret-automated-tests-32chr";

const DEV_PORT = 3937;

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
    STRIPE_SECRET_KEY: "sk_test_dummy_key_constructed_only_never_used_for_a_real_api_call",
    STRIPE_WEBHOOK_SECRET: "whsec_test_only_dummy_secret_for_automated_tests",
    OFFICE_DOCUMENT_REVIEW_KEY: OFFICE_KEY,
    OFFICE_DOCUMENT_REVIEW_SESSION_SECRET: OFFICE_SESSION_SECRET,
    PUBLIC_LEAD_ACCESS_SECRET,
    CLIENT_PORTAL_SESSION_SECRET,
    // Deliberately blank -- forces the jsonTransport test transport (see
    // server.js EMAIL CONFIG), so no real SMTP provider is ever contacted
    // and every "sent" email is captured in-memory for inspection via
    // GET /api/dev/sent-test-emails.
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

async function postJson(pathname, payload, cookie, method = "POST") {
  return fetch(`${base()}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
}

async function getSentTestEmails() {
  const res = await fetch(`${base()}/api/dev/sent-test-emails`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.usingTestTransport, true, "tests must use the jsonTransport test transport, never real SMTP");
  return body.emails || [];
}

function emailsTo(emails, address) {
  return emails.filter((e) => String(e.to || "").toLowerCase() === address.toLowerCase());
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

function getLocalLead(leadId) {
  const leads = readLeadsFile();
  return leads.find((l) => l.leadId === leadId) || null;
}

async function officeSignIn(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/office-document-review/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey: OFFICE_KEY })
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  assert.ok(cookie, "Office sign-in must return a session cookie");
  return cookie;
}

function pinnacleActiveEnrollmentFields(overrides = {}) {
  return {
    contactRequest: {
      membershipEnrollment: {
        planKey: "pinnacle",
        enrollmentStatus: "Active Membership",
        paymentStatus: "Paid / Confirmed",
        ...overrides
      }
    }
  };
}

function fullPlanFixture(overrides = {}) {
  return {
    status: "approved",
    taxYear: "2026",
    executiveSummary: "Summary.",
    recommendations: [
      {
        priority: "high",
        status: "approved",
        title: "Rec A",
        recommendation: "Do the thing.",
        rationale: "Because tax law.",
        deadline: "2026-04-15",
        documentsNeeded: "1099 forms",
        clientAction: "Gather your 1099 forms"
      }
    ],
    ...overrides
  };
}

async function patchActionPlan(leadId, body, cookie) {
  return postJson(`/api/admin/pinnacle-action-plan/${encodeURIComponent(leadId)}`, body, cookie, "PATCH");
}

async function deliverActionPlan(leadId, cookie) {
  return postJson(`/api/admin/pinnacle-action-plan/${encodeURIComponent(leadId)}/deliver`, undefined, cookie, "POST");
}

async function resendPlanReady(leadId, cookie, body) {
  return postJson(`/api/admin/pinnacle-action-plan/${encodeURIComponent(leadId)}/resend-plan-ready-email`, body, cookie, "POST");
}

async function resendEnrollmentConfirmation(leadId, cookie, body) {
  return postJson(`/api/admin/pinnacle-action-plan/${encodeURIComponent(leadId)}/resend-enrollment-confirmation`, body, cookie, "POST");
}

async function triggerEnrollmentConfirmationDev(leadId) {
  return postJson(`/api/dev/pinnacle-notifications/trigger-enrollment-confirmation/${encodeURIComponent(leadId)}`, undefined, null, "POST");
}

let devServer;
let officeCookie;

before(async () => {
  devServer = startServer(DEV_PORT);
  await waitForServer(DEV_PORT);
  officeCookie = await officeSignIn(DEV_PORT);
});

after(() => {
  if (devServer) devServer.kill();
});

test("G/H/I/J. A confirmed Pinnacle enrollment triggers exactly one confirmation email with a portal CTA and no sensitive data, even when processed twice", async () => {
  const leadId = await createLead("gh-enrollment-" + Date.now(), "pinnacle-workflow-gh@example.test");

  try {
    patchLocalLead(leadId, pinnacleActiveEnrollmentFields());

    const first = await triggerEnrollmentConfirmationDev(leadId);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.result.attempted, true);
    assert.equal(firstBody.result.ok, true);

    // H: a second, duplicate trigger (simulating a retried webhook) must not
    // send a second email.
    const second = await triggerEnrollmentConfirmationDev(leadId);
    const secondBody = await second.json();
    assert.equal(secondBody.result.attempted, false);
    assert.equal(secondBody.result.alreadySent, true);

    const emails = emailsTo(await getSentTestEmails(), "pinnacle-workflow-gh@example.test");
    assert.equal(emails.length, 1);

    const email = emails[0];
    assert.match(email.subject, /Pinnacle Tax Action Plan/i);

    // I: secure portal CTA present.
    assert.ok(email.text.includes("/client-portal"));

    // J: no sensitive planning data of any kind.
    const forbidden = ["calculationDetails", "strategyKey", "confidence", "sourceInputs", "requiresProfessionalReview", "$"];
    forbidden.forEach((marker) => {
      assert.ok(!email.text.includes(marker), `enrollment email must not contain "${marker}"`);
    });

    const stored = getLocalLead(leadId);
    assert.equal(stored.pinnacleNotifications.enrollmentConfirmation.status, "sent");
    assert.ok(stored.pinnacleNotifications.enrollmentConfirmation.sentAt);
  } finally {
    removeTestLead(leadId);
  }
});

test("K/L/M. A successful approved -> delivered transition attempts a plan-ready notification with a portal CTA and no raw tax/planning data", async () => {
  const leadId = await createLead("klm-deliver-" + Date.now(), "pinnacle-workflow-klm@example.test");

  try {
    await patchActionPlan(leadId, fullPlanFixture(), officeCookie);

    const deliverRes = await deliverActionPlan(leadId, officeCookie);
    assert.equal(deliverRes.status, 200);
    const deliverBody = await deliverRes.json();
    assert.equal(deliverBody.pinnacleActionPlan.status, "delivered");
    assert.equal(deliverBody.notification.attempted, true);
    assert.equal(deliverBody.notification.ok, true);

    const emails = emailsTo(await getSentTestEmails(), "pinnacle-workflow-klm@example.test");
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /ready/i);
    assert.ok(emails[0].text.includes("/client-portal"));

    const forbidden = ["Rec A", "Do the thing", "calculationDetails", "strategyKey", "1099 forms", "executiveSummary"];
    forbidden.forEach((marker) => {
      assert.ok(!emails[0].text.includes(marker), `plan-ready email must not contain "${marker}"`);
    });
  } finally {
    removeTestLead(leadId);
  }
});

test("N/O/P/Q/V. A missing/invalid customer email does not corrupt the delivered Action Plan state", async () => {
  const leadId = await createLead("noqv-noemail-" + Date.now(), "pinnacle-workflow-noqv@example.test");
  // Force an unusable email directly on the stored contact after creation,
  // bypassing lead-creation validation, to deterministically exercise the
  // "no valid email" notification-failure path without needing to fake an
  // SMTP error.
  patchLocalLead(leadId, { contact: { name: "No Email Client", email: "not-an-email", phone: "" } });

  try {
    await patchActionPlan(leadId, fullPlanFixture(), officeCookie);

    const deliverRes = await deliverActionPlan(leadId, officeCookie);
    assert.equal(deliverRes.status, 200);
    const deliverBody = await deliverRes.json();

    // N: delivered status is unaffected by the notification outcome.
    assert.equal(deliverBody.pinnacleActionPlan.status, "delivered");
    // O: deliveredAt is still set.
    assert.ok(deliverBody.pinnacleActionPlan.deliveredAt);
    // P: deliveredSnapshot is still present.
    assert.ok(deliverBody.pinnacleActionPlan.deliveredSnapshot);
    // Q: deliveryVersion incremented exactly once, as a normal first delivery.
    assert.equal(deliverBody.pinnacleActionPlan.deliveryVersion, 1);
    // The notification attempt itself is reported as unavailable, not thrown.
    assert.equal(deliverBody.notification.attempted, false);
    assert.equal(deliverBody.notification.reason, "no_email");

    const stored = getLocalLead(leadId);
    assert.equal(stored.pinnacleActionPlan.status, "delivered");
    assert.equal(stored.pinnacleActionPlan.deliveryVersion, 1);
    assert.equal(stored.pinnacleNotifications.planReady.status, "unavailable");
    assert.ok(stored.pinnacleNotifications.planReady.lastError);

    const emails = await getSentTestEmails();
    assert.equal(emails.filter((e) => e.subject.match(/ready/i) && e.to === "not-an-email").length, 0);
  } finally {
    removeTestLead(leadId);
  }
});

test("R/S/T. Resending the plan-ready email never changes deliveredAt, deliveryVersion, or deliveredSnapshot", async () => {
  const leadId = await createLead("rst-resend-" + Date.now(), "pinnacle-workflow-rst@example.test");

  try {
    await patchActionPlan(leadId, fullPlanFixture(), officeCookie);
    const deliverRes = await deliverActionPlan(leadId, officeCookie);
    const deliverBody = await deliverRes.json();

    const before = {
      deliveredAt: deliverBody.pinnacleActionPlan.deliveredAt,
      deliveryVersion: deliverBody.pinnacleActionPlan.deliveryVersion,
      deliveredSnapshot: JSON.stringify(deliverBody.pinnacleActionPlan.deliveredSnapshot)
    };

    const resendRes = await resendPlanReady(leadId, officeCookie);
    assert.equal(resendRes.status, 200);
    const resendBody = await resendRes.json();
    assert.equal(resendBody.notification.attempted, true);
    assert.equal(resendBody.notification.ok, true);

    const stored = getLocalLead(leadId);
    assert.equal(stored.pinnacleActionPlan.deliveredAt, before.deliveredAt);
    assert.equal(stored.pinnacleActionPlan.deliveryVersion, before.deliveryVersion);
    assert.equal(JSON.stringify(stored.pinnacleActionPlan.deliveredSnapshot), before.deliveredSnapshot);

    const emails = emailsTo(await getSentTestEmails(), "pinnacle-workflow-rst@example.test");
    // One from the automatic post-deliver attempt, one from the explicit resend.
    assert.equal(emails.length, 2);
  } finally {
    removeTestLead(leadId);
  }
});

test("U. An arbitrary browser-supplied recipient address is ignored -- the notification always goes to the lead's own stored email", async () => {
  const leadId = await createLead("u-recipient-" + Date.now(), "pinnacle-workflow-u@example.test");

  try {
    await patchActionPlan(leadId, fullPlanFixture(), officeCookie);
    await deliverActionPlan(leadId, officeCookie);

    const resendRes = await resendPlanReady(leadId, officeCookie, { to: "attacker@evil.test", recipient: "attacker@evil.test" });
    assert.equal(resendRes.status, 200);

    const emails = await getSentTestEmails();
    assert.equal(emails.filter((e) => e.to === "attacker@evil.test").length, 0);
    assert.ok(emailsTo(emails, "pinnacle-workflow-u@example.test").length >= 1);
  } finally {
    removeTestLead(leadId);
  }
});

test("W. Unauthenticated caller cannot invoke the resend/notification admin routes", async () => {
  const leadId = await createLead("w-unauth-" + Date.now(), "pinnacle-workflow-w@example.test");

  try {
    const resendPlanReadyRes = await resendPlanReady(leadId, null);
    assert.equal(resendPlanReadyRes.status, 401);

    const resendEnrollmentRes = await resendEnrollmentConfirmation(leadId, null);
    assert.equal(resendEnrollmentRes.status, 401);
  } finally {
    removeTestLead(leadId);
  }
});
