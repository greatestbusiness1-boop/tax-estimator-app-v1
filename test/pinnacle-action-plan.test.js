"use strict";
// Regression tests for the Pinnacle Tax Action Plan foundation phase:
//   - PATCH /api/admin/pinnacle-action-plan/:leadId (office-only) creates
//     and updates a pinnacleActionPlan sub-object on a lead record, with
//     server-side normalization of controlled status/priority values and
//     server-generated ids/timestamps.
//   - buildClientFacingPinnacleActionPlan() / getClientPortalPinnacleActionPlan()
//     (server.js) is the ONLY view an authenticated Pinnacle client ever
//     receives via GET /api/client-portal/session -- it never includes
//     preparerNotes (plan-level or per-recommendation), and never includes
//     any recommendation content at all unless the plan itself has been
//     marked "approved" or "delivered"; within an approved/delivered plan,
//     individual recommendations still marked "proposed" or "dismissed"
//     are filtered out.
//   - No client-facing write route for pinnacleActionPlan exists at all.
//   - pinnacleWorkspace (the existing client-entered data) and Tax Watch
//     Pro behavior are both unaffected by this addition.
//
// Spawns the real server.js in dev mode (local leads.json fallback, since
// Supabase is deliberately unreachable) -- never touches a real Supabase
// project or live Stripe. Same conventions as
// test/tax-watch-expired-preview.test.js and test/revenue-summary.test.js.
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
const CLIENT_PORTAL_SESSION_SECRET =
  "test-only-client-portal-session-secret-automated-tests-32chr";

const DEV_PORT = 3932;

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

function getLocalLead(leadId) {
  const leads = readLeadsFile();
  return leads.find((l) => l.leadId === leadId) || null;
}

async function createActivatedAccount(marker, password = "InitialPass123") {
  const email = `pinnacle-action-plan-test+${marker}@example.test`;
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

async function adminPatchActionPlan(leadId, body, cookie) {
  return fetch(
    `${base()}/api/admin/pinnacle-action-plan/${encodeURIComponent(leadId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: JSON.stringify(body)
    }
  );
}

async function getClientPortalSession(cookie) {
  const res = await fetch(`${base()}/api/client-portal/session`, {
    headers: { Cookie: cookie }
  });
  return res;
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

// =============================================================================
// A. Persistence
// =============================================================================

test("A. Pinnacle Action Plan persists correctly across separate updates", async () => {
  const leadId = await createLead("A-persist-" + Date.now(), "pinnacle-a@example.test");

  try {
    const first = await adminPatchActionPlan(
      leadId,
      { executiveSummary: "Initial summary", taxYear: "2026" },
      officeCookie
    );
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.pinnacleActionPlan.executiveSummary, "Initial summary");
    assert.equal(firstBody.pinnacleActionPlan.taxYear, "2026");
    assert.equal(firstBody.pinnacleActionPlan.status, "draft");

    // A second, partial update must not erase the first update's fields.
    const second = await adminPatchActionPlan(
      leadId,
      { currentTaxPosition: "Projected balance due of $4,000" },
      officeCookie
    );
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.pinnacleActionPlan.executiveSummary, "Initial summary");
    assert.equal(
      secondBody.pinnacleActionPlan.currentTaxPosition,
      "Projected balance due of $4,000"
    );

    const stored = getLocalLead(leadId);
    assert.equal(stored.pinnacleActionPlan.executiveSummary, "Initial summary");
    assert.equal(
      stored.pinnacleActionPlan.currentTaxPosition,
      "Projected balance due of $4,000"
    );
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// B. Unauthenticated access is rejected
// =============================================================================

test("B. Unauthenticated caller cannot modify a Pinnacle Action Plan", async () => {
  const leadId = await createLead("B-unauth-" + Date.now(), "pinnacle-b@example.test");

  try {
    const res = await adminPatchActionPlan(
      leadId,
      { executiveSummary: "Should not be saved" },
      null
    );
    assert.equal(res.status, 401);

    const stored = getLocalLead(leadId);
    assert.equal(stored.pinnacleActionPlan, undefined);
  } finally {
    removeTestLead(leadId);
  }
});

test("B2. Unauthenticated caller cannot retrieve any client's Pinnacle Action Plan", async () => {
  const res = await getClientPortalSession("");
  assert.equal(res.status, 401);
});

// =============================================================================
// C. Cross-customer isolation
// =============================================================================

test("C. One authenticated client cannot see another client's Pinnacle Action Plan", async () => {
  const accountA = await createActivatedAccount("C-clientA-" + Date.now());
  const accountB = await createActivatedAccount("C-clientB-" + Date.now());

  try {
    await adminPatchActionPlan(
      accountA.leadId,
      {
        status: "approved",
        executiveSummary: "SECRET-PLAN-FOR-CLIENT-A-ONLY",
        recommendations: [
          { title: "Client A only recommendation", status: "approved" }
        ]
      },
      officeCookie
    );

    const sessionB = await getClientPortalSession(accountB.cookie);
    assert.equal(sessionB.status, 200);
    const bodyB = await sessionB.json();
    const planB = bodyB.portal?.pinnacleActionPlan || {};

    assert.notEqual(planB.executiveSummary, "SECRET-PLAN-FOR-CLIENT-A-ONLY");
    assert.equal(
      JSON.stringify(planB.recommendations || []).includes(
        "Client A only recommendation"
      ),
      false
    );

    const sessionA = await getClientPortalSession(accountA.cookie);
    const bodyA = await sessionA.json();
    assert.equal(
      bodyA.portal?.pinnacleActionPlan?.executiveSummary,
      "SECRET-PLAN-FOR-CLIENT-A-ONLY"
    );
  } finally {
    removePortalAccountAndLead(accountA);
    removePortalAccountAndLead(accountB);
  }
});

// =============================================================================
// D. Client cannot modify preparer-controlled fields
// =============================================================================

test("D. Client session cannot authenticate against the office-only Action Plan write route", async () => {
  const account = await createActivatedAccount("D-clientwrite-" + Date.now());

  try {
    const res = await adminPatchActionPlan(
      account.leadId,
      { executiveSummary: "Client should not be able to write this" },
      account.cookie
    );
    assert.equal(res.status, 401);
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("D2. pinnacleActionPlan submitted through the generic public lead PATCH route is ignored", async () => {
  const leadId = await createLead("D2-genericpatch-" + Date.now(), "pinnacle-d2@example.test");

  try {
    await adminPatchActionPlan(
      leadId,
      { executiveSummary: "Original preparer summary", status: "approved" },
      officeCookie
    );

    // No public/client route accepts a pinnacleActionPlan field at all --
    // confirm the generic lead record is unaffected by attempting to smuggle
    // it in as an unrecognized field with no auth.
    const res = await fetch(`${base()}/api/leads/${encodeURIComponent(leadId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pinnacleActionPlan: { executiveSummary: "HACKED", status: "delivered" }
      })
    });

    // Either rejected outright (no valid token) or silently ignored -- either
    // way the stored plan must be untouched.
    const stored = getLocalLead(leadId);
    assert.equal(stored.pinnacleActionPlan.executiveSummary, "Original preparer summary");
    assert.notEqual(res.status, 200);
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// E. Authorized office user can create/update a plan
// =============================================================================

test("E. Authorized office user can create and update a plan, including status transitions", async () => {
  const leadId = await createLead("E-office-" + Date.now(), "pinnacle-e@example.test");

  try {
    const create = await adminPatchActionPlan(
      leadId,
      {
        taxYear: "2026",
        executiveSummary: "Draft summary",
        recommendations: [
          { title: "Increase SEP-IRA contribution", priority: "high", status: "proposed" }
        ]
      },
      officeCookie
    );
    assert.equal(create.status, 200);
    const createBody = await create.json();
    assert.equal(createBody.pinnacleActionPlan.status, "draft");
    assert.equal(createBody.pinnacleActionPlan.recommendations.length, 1);
    assert.ok(createBody.pinnacleActionPlan.recommendations[0].id);

    const approve = await adminPatchActionPlan(
      leadId,
      { status: "approved" },
      officeCookie
    );
    assert.equal(approve.status, 200);
    const approveBody = await approve.json();
    assert.equal(approveBody.pinnacleActionPlan.status, "approved");
    assert.ok(approveBody.pinnacleActionPlan.lastReviewedAt);
    // Prior content survives a status-only update.
    assert.equal(approveBody.pinnacleActionPlan.executiveSummary, "Draft summary");

    const deliver = await adminPatchActionPlan(
      leadId,
      { status: "delivered" },
      officeCookie
    );
    const deliverBody = await deliver.json();
    assert.equal(deliverBody.pinnacleActionPlan.status, "delivered");
    assert.ok(deliverBody.pinnacleActionPlan.deliveredAt);
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// F. Invalid plan status
// =============================================================================

test("F. Invalid plan status is normalized rather than stored as-is", async () => {
  const leadId = await createLead("F-status-" + Date.now(), "pinnacle-f@example.test");

  try {
    const res = await adminPatchActionPlan(
      leadId,
      { status: "totally-not-a-real-status" },
      officeCookie
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    const validStatuses = ["draft", "needs_review", "approved", "delivered"];
    assert.ok(validStatuses.includes(body.pinnacleActionPlan.status));
    assert.notEqual(body.pinnacleActionPlan.status, "totally-not-a-real-status");
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// G. Invalid recommendation priority/status
// =============================================================================

test("G. Invalid recommendation priority/status values are normalized rather than stored as-is", async () => {
  const leadId = await createLead("G-recstatus-" + Date.now(), "pinnacle-g@example.test");

  try {
    const res = await adminPatchActionPlan(
      leadId,
      {
        recommendations: [
          {
            title: "Bad enum values",
            priority: "URGENT!!!",
            status: "made-up-status"
          }
        ]
      },
      officeCookie
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    const rec = body.pinnacleActionPlan.recommendations[0];

    assert.ok(["high", "medium", "low"].includes(rec.priority));
    assert.notEqual(rec.priority, "URGENT!!!");
    assert.ok(
      ["proposed", "approved", "client_action_needed", "completed", "dismissed"].includes(
        rec.status
      )
    );
    assert.notEqual(rec.status, "made-up-status");
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// H. Draft/unapproved recommendations are never exposed as approved advice
// =============================================================================

test("H1. An unapproved (draft) plan shows only a professional pending message to the client, no recommendations", async () => {
  const account = await createActivatedAccount("H1-draft-" + Date.now());

  try {
    await adminPatchActionPlan(
      account.leadId,
      {
        status: "draft",
        executiveSummary: "Should not be visible yet",
        recommendations: [
          { title: "Should not be visible yet either", status: "approved" }
        ]
      },
      officeCookie
    );

    const res = await getClientPortalSession(account.cookie);
    const body = await res.json();
    const plan = body.portal?.pinnacleActionPlan || {};

    assert.equal(plan.available, false);
    assert.ok(plan.message);
    assert.equal(plan.executiveSummary, undefined);
    assert.equal(plan.recommendations, undefined);
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("H2. Within an approved plan, individual proposed/dismissed recommendations are filtered out and preparer notes never reach the client", async () => {
  const account = await createActivatedAccount("H2-mixed-" + Date.now());

  try {
    await adminPatchActionPlan(
      account.leadId,
      {
        status: "approved",
        preparerNotes: "OFFICE-ONLY-NOTE-NEVER-SHOW-CLIENT",
        recommendations: [
          {
            title: "Approved and visible",
            status: "approved",
            preparerNotes: "OFFICE-ONLY-REC-NOTE"
          },
          { title: "Still a draft idea", status: "proposed" },
          { title: "Rejected idea", status: "dismissed" }
        ]
      },
      officeCookie
    );

    const res = await getClientPortalSession(account.cookie);
    const body = await res.json();
    const plan = body.portal?.pinnacleActionPlan || {};

    assert.equal(plan.available, true);
    const titles = (plan.recommendations || []).map((r) => r.title);
    assert.ok(titles.includes("Approved and visible"));
    assert.equal(titles.includes("Still a draft idea"), false);
    assert.equal(titles.includes("Rejected idea"), false);

    const raw = JSON.stringify(plan);
    assert.equal(raw.includes("OFFICE-ONLY-NOTE-NEVER-SHOW-CLIENT"), false);
    assert.equal(raw.includes("OFFICE-ONLY-REC-NOTE"), false);
    assert.equal(plan.preparerNotes, undefined);
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// I. pinnacleWorkspace survives Action Plan updates
// =============================================================================

test("I. Existing pinnacleWorkspace data is preserved after an Action Plan update", async () => {
  const leadId = await createLead("I-workspace-" + Date.now(), "pinnacle-i@example.test");

  try {
    patchLocalLead(leadId, {
      pinnacleWorkspace: {
        version: 4,
        businessProfile: { businessName: "Test Bakery LLC" },
        incomeSources: [{ id: "src-1", name: "Bakery sales" }],
        expenses: [],
        vehicles: [],
        trips: [],
        dailyMileage: [],
        taxActivity: [],
        updatedAt: new Date().toISOString()
      }
    });

    await adminPatchActionPlan(
      leadId,
      { executiveSummary: "New action plan content" },
      officeCookie
    );

    const stored = getLocalLead(leadId);
    assert.equal(stored.pinnacleWorkspace.businessProfile.businessName, "Test Bakery LLC");
    assert.equal(stored.pinnacleWorkspace.incomeSources.length, 1);
    assert.equal(stored.pinnacleActionPlan.executiveSummary, "New action plan content");
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// J. Existing Tax Watch Pro behavior is unaffected
// =============================================================================

test("J. Tax Watch Pro session data is unaffected by the pinnacleActionPlan addition", async () => {
  const account = await createActivatedAccount("J-taxwatch-" + Date.now());

  try {
    patchLocalLead(account.leadId, {
      taxWatchProfile: {
        status: "preview",
        previewStartedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        previewEndsAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString()
      }
    });

    const res = await getClientPortalSession(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.portal?.taxWatch?.active, true);
    assert.equal(body.portal?.taxWatch?.status, "preview");
    // pinnacleActionPlan must be present alongside, and default to the
    // "not started" / unavailable shape without disturbing taxWatch at all.
    assert.equal(body.portal?.pinnacleActionPlan?.available, false);
  } finally {
    removePortalAccountAndLead(account);
  }
});
