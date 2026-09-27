"use strict";
// Tests for the Pinnacle Tax Action Plan Report v1 (Phase 5):
//   - buildPinnacleActionPlanReport() (server.js) assembles the premium
//     client-facing report model on top of buildClientFacingPinnacleActionPlan()
//     -- same approved/delivered gate, same hidden-status recommendation
//     filter, same preparerNotes stripping -- plus grouping by priority,
//     key-date/document/client-action aggregation, and an authoritative
//     tax-position snapshot.
//   - GET /api/client-portal/pinnacle/action-plan-report (client-authenticated,
//     leadId derived only from the verified session, never client input).
//   - GET /api/admin/pinnacle-action-plan-report/:leadId (office preview,
//     identical client-safe model, honors the same approved/delivered gate).
//   - POST /api/admin/pinnacle-action-plan/:leadId/deliver (office-only;
//     only an approved plan may transition to delivered; deliveredAt is
//     server-generated).
//   - Status-transition validation on the generic PATCH route (draft/
//     needs_review -> delivered rejected; deliveredAt history preserved on
//     a later regression back to draft).
//
// Spawns the real server.js in dev mode (local leads.json fallback, since
// Supabase is deliberately unreachable) -- never touches a real Supabase
// project or live Stripe. Same conventions as test/pinnacle-action-plan.test.js.
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

const DEV_PORT = 3936;

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

function getLocalLead(leadId) {
  const leads = readLeadsFile();
  return leads.find((l) => l.leadId === leadId) || null;
}

async function createActivatedAccount(marker, password = "InitialPass123") {
  const email = `pinnacle-report-test+${marker}@example.test`;
  const leadId = await createLead(marker, email);

  const reqRes = await postJson("/api/client-portal/request-activation", { email, leadId });
  assert.equal(reqRes.status, 200);

  const emailEntry = await getLatestEmail(email, "Your Secure Client Portal Code");
  assert.ok(emailEntry, "activation code email must have been captured");
  const code = extractCode(emailEntry.text);
  assert.ok(code);

  const activateRes = await postJson("/api/client-portal/activate", { email, leadId, code, password });
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
    fs.writeFileSync(PORTAL_ACCOUNTS_FILE, JSON.stringify(remaining, null, 2), "utf8");
  }
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

async function patchActionPlan(leadId, body, cookie) {
  return postJson(`/api/admin/pinnacle-action-plan/${encodeURIComponent(leadId)}`, body, cookie, "PATCH");
}

async function deliverActionPlan(leadId, cookie) {
  return postJson(`/api/admin/pinnacle-action-plan/${encodeURIComponent(leadId)}/deliver`, undefined, cookie, "POST");
}

async function getClientReport(cookie) {
  return fetch(`${base()}/api/client-portal/pinnacle/action-plan-report`, {
    headers: cookie ? { Cookie: cookie } : {}
  });
}

async function getOfficePreviewReport(leadId, cookie) {
  return fetch(`${base()}/api/admin/pinnacle-action-plan-report/${encodeURIComponent(leadId)}`, {
    headers: cookie ? { Cookie: cookie } : {}
  });
}

function pinnacleWorkspaceFixture(overrides = {}) {
  return {
    version: 4,
    businessProfile: {
      structure: "sole-prop",
      fields: {
        legalName: "Test Report Business",
        filingStatus: "single",
        otherTaxableIncome: "0"
      }
    },
    incomeSources: [{ id: "INC-1", name: "Test Business", ytd: "60000" }],
    expenses: [{ id: "EXP-1", amount: "10000", date: "2026-03-15" }],
    vehicles: [],
    trips: [
      { id: "TRIP-1", date: "2026-03-15", miles: "1000", roundTrip: "no", classification: "business" }
    ],
    dailyMileage: [],
    taxActivity: [],
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

// Five recommendations exercising priority grouping (M), proposed/dismissed
// exclusion (J/K), and checklist aggregation/dedup (N/O/P) all in one plan.
function fullPlanFixture() {
  return {
    status: "approved",
    taxYear: "2026",
    executiveSummary: "You are on track for a strong year -- a few items need attention before year-end.",
    currentTaxPosition: "Your business income has grown compared to last year.",
    preparerNotes: "OFFICE-ONLY: client is difficult, handle with care.",
    assumptions: "Figures assume no major changes to income before year-end.",
    reviewedBy: "Test Preparer",
    recommendations: [
      {
        priority: "high",
        status: "approved",
        title: "Rec High A",
        recommendation: "Increase estimated payments.",
        rationale: "Avoid an underpayment penalty.",
        estimatedImpact: "approx. $1,200",
        deadline: "2026-04-15",
        documentsNeeded: "1099 forms, Bank statements",
        clientAction: "Gather your 1099 forms",
        preparerNotes: "OFFICE-ONLY: client pushed back on this last year."
      },
      {
        priority: "high",
        status: "proposed",
        title: "Rec High Proposed (should be excluded)",
        recommendation: "Not yet approved.",
        clientAction: "Should never appear"
      },
      {
        priority: "medium",
        status: "approved",
        title: "Rec Medium A",
        recommendation: "Review bookkeeping categorization.",
        documentsNeeded: "Bank statements, Receipts",
        clientAction: "Gather your 1099 forms"
      },
      {
        priority: "low",
        status: "dismissed",
        title: "Rec Low Dismissed (should be excluded)",
        recommendation: "Not applicable this year.",
        clientAction: "Should never appear"
      },
      {
        priority: "low",
        status: "client_action_needed",
        title: "Rec Low A",
        recommendation: "Sign the engagement letter for next year.",
        deadline: "2026-03-01",
        documentsNeeded: "Receipts",
        clientAction: "Sign engagement letter"
      }
    ]
  };
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

test("A/G/H/I/J/K/L/M/N/O/P/Q. An approved plan produces a full, client-safe, correctly grouped/aggregated report", async () => {
  const account = await createActivatedAccount("a-approved-" + Date.now());

  try {
    patchLocalLead(account.leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });
    const patchRes = await patchActionPlan(account.leadId, fullPlanFixture(), officeCookie);
    assert.equal(patchRes.status, 200);

    const res = await getClientReport(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    const report = body.report;

    // A: report model is produced for an approved plan.
    assert.equal(report.available, true);
    assert.equal(report.identity.status, "approved");

    const rawJson = JSON.stringify(report);

    // G: preparer notes (plan-level and per-recommendation) never appear.
    assert.ok(!rawJson.includes("OFFICE-ONLY"));
    assert.ok(!rawJson.includes("difficult"));
    assert.ok(!rawJson.includes("pushed back"));

    // H/I: no raw planning opportunities, calculationDetails, confidence,
    // sourceInputs, or internal review-reason vocabulary anywhere.
    assert.ok(!rawJson.includes("strategyKey"));
    assert.ok(!rawJson.includes("calculationDetails"));
    assert.ok(!rawJson.includes("confidence"));
    assert.ok(!rawJson.includes("sourceInputs"));
    assert.ok(!rawJson.includes("requiresProfessionalReview"));

    // J/K/L: proposed and dismissed recommendations excluded; approved and
    // client_action_needed recommendations included.
    assert.ok(!rawJson.includes("should be excluded"));
    assert.ok(!rawJson.includes("Should never appear"));
    assert.equal(report.priorityActionPlan.high.length, 1);
    assert.equal(report.priorityActionPlan.high[0].title, "Rec High A");
    assert.equal(report.priorityActionPlan.medium.length, 1);
    assert.equal(report.priorityActionPlan.low.length, 1);
    assert.equal(report.priorityActionPlan.low[0].title, "Rec Low A");

    // M: grouping is deterministic and keyed by priority.
    assert.deepEqual(Object.keys(report.priorityActionPlan).sort(), ["high", "low", "medium"]);

    // N: key dates aggregated from valid deadlines only, sorted chronologically.
    assert.deepEqual(report.keyDates, [
      { title: "Rec Low A", deadline: "2026-03-01" },
      { title: "Rec High A", deadline: "2026-04-15" }
    ]);

    // O: document checklist split/deduplicated, case-insensitively, in
    // order of first appearance.
    assert.deepEqual(report.documentChecklist, ["1099 forms", "Bank statements", "Receipts"]);

    // P: client-action checklist deduplicated on exact repeated instructions.
    assert.deepEqual(report.clientActionChecklist, ["Gather your 1099 forms", "Sign engagement letter"]);

    // Q: the authoritative tax-position snapshot is present and uses the
    // same field names as computePinnacleTaxReserve() -- never the legacy
    // flat-reserve field names (baseReserve/safeToSpend/recommendedTaxSavings/
    // fundingSurplus), which belong only to client-portal-home.html's local,
    // unreconciled calculatePinnacleFinancialPlan().
    assert.ok(report.currentTaxPosition.snapshot);
    assert.equal(typeof report.currentTaxPosition.snapshot.estimatedTotalTax, "number");
    assert.equal(typeof report.currentTaxPosition.snapshot.taxPaymentsRecorded, "number");
    assert.equal(typeof report.currentTaxPosition.snapshot.remainingEstimatedTax, "number");
    assert.ok(!rawJson.includes("baseReserve"));
    assert.ok(!rawJson.includes("safeToSpend"));
    assert.ok(!rawJson.includes("recommendedTaxSavings"));
    assert.ok(!rawJson.includes("fundingSurplus"));
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("B/U. A delivered plan still produces a full report and remains client-accessible", async () => {
  const account = await createActivatedAccount("b-delivered-" + Date.now());

  try {
    patchLocalLead(account.leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });
    await patchActionPlan(account.leadId, fullPlanFixture(), officeCookie);

    const deliverRes = await deliverActionPlan(account.leadId, officeCookie);
    assert.equal(deliverRes.status, 200);
    const deliverBody = await deliverRes.json();
    assert.equal(deliverBody.pinnacleActionPlan.status, "delivered");

    const res = await getClientReport(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.report.available, true);
    assert.equal(body.report.identity.status, "delivered");
    assert.ok(body.report.identity.deliveredAt);
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("C. A draft plan does not produce a final report", async () => {
  const account = await createActivatedAccount("c-draft-" + Date.now());

  try {
    patchLocalLead(account.leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });
    await patchActionPlan(account.leadId, { ...fullPlanFixture(), status: "draft" }, officeCookie);

    const res = await getClientReport(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.report.available, false);
    assert.ok(/being prepared/i.test(body.report.message));
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("D. A needs_review plan does not produce a final report", async () => {
  const account = await createActivatedAccount("d-needsreview-" + Date.now());

  try {
    patchLocalLead(account.leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });
    await patchActionPlan(account.leadId, { ...fullPlanFixture(), status: "needs_review" }, officeCookie);

    const res = await getClientReport(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.report.available, false);
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("E. A client cannot retrieve another customer's report", async () => {
  const accountA = await createActivatedAccount("e-clienta-" + Date.now());
  const accountB = await createActivatedAccount("e-clientb-" + Date.now());

  try {
    patchLocalLead(accountB.leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });
    await patchActionPlan(accountB.leadId, fullPlanFixture(), officeCookie);

    // Account A has no plan at all -- its own report call must reflect
    // account A's own (unavailable) plan, never B's approved content.
    const resA = await getClientReport(accountA.cookie);
    assert.equal(resA.status, 200);
    const bodyA = await resA.json();
    assert.equal(bodyA.report.available, false);
    assert.ok(!JSON.stringify(bodyA).includes("Rec High A"));

    const resB = await getClientReport(accountB.cookie);
    const bodyB = await resB.json();
    assert.equal(bodyB.report.available, true);
  } finally {
    removePortalAccountAndLead(accountA);
    removePortalAccountAndLead(accountB);
  }
});

test("F. Unauthenticated request to the client report route is rejected", async () => {
  const res = await getClientReport("");
  assert.equal(res.status, 401);
});

test("R. Office preview uses the identical client-safe report model and is gated the same way", async () => {
  const leadId = await createLead("r-preview-" + Date.now(), "pinnacle-report-r@example.test");

  try {
    patchLocalLead(leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });
    await patchActionPlan(leadId, fullPlanFixture(), officeCookie);

    const res = await getOfficePreviewReport(leadId, officeCookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.report.available, true);
    assert.equal(body.report.preview, true);
    const rawJson = JSON.stringify(body.report);
    assert.ok(!rawJson.includes("OFFICE-ONLY"));
    assert.ok(!rawJson.includes("calculationDetails"));

    // A draft plan previews as the same "being prepared" message the client
    // would see -- the preview is always faithful to reality.
    const leadId2 = await createLead("r-preview-draft-" + Date.now(), "pinnacle-report-r2@example.test");
    await patchActionPlan(leadId2, { ...fullPlanFixture(), status: "draft" }, officeCookie);
    const res2 = await getOfficePreviewReport(leadId2, officeCookie);
    const body2 = await res2.json();
    assert.equal(body2.report.available, false);
    removeTestLead(leadId2);

    // Unauthenticated caller cannot use the office preview route either.
    const unauthRes = await getOfficePreviewReport(leadId, null);
    assert.equal(unauthRes.status, 401);
  } finally {
    removeTestLead(leadId);
  }
});

test("S/T. Only an approved plan can be marked delivered, and deliveredAt is generated server-side", async () => {
  const leadId = await createLead("st-deliver-" + Date.now(), "pinnacle-report-st@example.test");

  try {
    await patchActionPlan(leadId, { ...fullPlanFixture(), status: "draft" }, officeCookie);

    const draftDeliverRes = await deliverActionPlan(leadId, officeCookie);
    assert.equal(draftDeliverRes.status, 400);

    await patchActionPlan(leadId, { status: "approved" }, officeCookie);

    const before = Date.now();
    const deliverRes = await deliverActionPlan(leadId, officeCookie);
    assert.equal(deliverRes.status, 200);
    const deliverBody = await deliverRes.json();
    assert.equal(deliverBody.pinnacleActionPlan.status, "delivered");
    const deliveredAtMs = Date.parse(deliverBody.pinnacleActionPlan.deliveredAt);
    assert.ok(Number.isFinite(deliveredAtMs));
    assert.ok(deliveredAtMs >= before - 5000);
  } finally {
    removeTestLead(leadId);
  }
});

test("V. Status-transition validation rejects draft/needs_review -> delivered and preserves deliveredAt history on a later regression", async () => {
  const leadId = await createLead("v-transitions-" + Date.now(), "pinnacle-report-v@example.test");

  try {
    // draft -> delivered directly: rejected.
    await patchActionPlan(leadId, { ...fullPlanFixture(), status: "draft" }, officeCookie);
    const draftToDelivered = await patchActionPlan(leadId, { status: "delivered" }, officeCookie);
    assert.equal(draftToDelivered.status, 400);

    // needs_review -> delivered directly: also rejected.
    await patchActionPlan(leadId, { status: "needs_review" }, officeCookie);
    const needsReviewToDelivered = await patchActionPlan(leadId, { status: "delivered" }, officeCookie);
    assert.equal(needsReviewToDelivered.status, 400);

    // approved -> delivered: allowed via the generic PATCH route too.
    await patchActionPlan(leadId, { status: "approved" }, officeCookie);
    const approvedToDelivered = await patchActionPlan(leadId, { status: "delivered" }, officeCookie);
    assert.equal(approvedToDelivered.status, 200);
    const deliveredBody = await approvedToDelivered.json();
    const deliveredAt = deliveredBody.pinnacleActionPlan.deliveredAt;
    assert.ok(deliveredAt);

    // Regressing back to draft for a correction must not clear deliveredAt.
    const regressRes = await patchActionPlan(leadId, { status: "draft" }, officeCookie);
    assert.equal(regressRes.status, 200);
    const regressBody = await regressRes.json();
    assert.equal(regressBody.pinnacleActionPlan.status, "draft");
    assert.equal(regressBody.pinnacleActionPlan.deliveredAt, deliveredAt);

    const stored = getLocalLead(leadId);
    assert.equal(stored.pinnacleActionPlan.deliveredAt, deliveredAt);
  } finally {
    removeTestLead(leadId);
  }
});

test("W. Existing client portal Action Plan security remains intact for the new report route", async () => {
  const leadId = await createLead("w-security-" + Date.now(), "pinnacle-report-w@example.test");

  try {
    // The client report route must never accept a leadId from the caller --
    // confirm it ignores a query string leadId entirely and still resolves
    // strictly from the (here, absent) session.
    const res = await fetch(
      `${base()}/api/client-portal/pinnacle/action-plan-report?leadId=${encodeURIComponent(leadId)}`
    );
    assert.equal(res.status, 401);
  } finally {
    removeTestLead(leadId);
  }
});
