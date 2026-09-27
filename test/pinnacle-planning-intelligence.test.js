"use strict";
// Tests for Pinnacle Planning Intelligence v1
// (engines/pinnaclePlanningEngine.js buildPinnaclePlanningOpportunities(),
// exposed office-only via GET /api/admin/pinnacle-planning-opportunities/:leadId
// and POST .../add-to-action-plan).
//
// Two groups:
//   1. Pure unit tests against buildPinnaclePlanningOpportunities() directly,
//      with hand-built context objects -- fast, no server needed. These
//      verify each strategy's deterministic threshold/priority/confidence
//      behavior and that no strategy ever fabricates a dollar amount it
//      cannot support (QBI/retirement/entity opportunities always carry
//      estimatedImpact: null and requiresProfessionalReview: true).
//   2. Server-spawning tests for the office-only routes, the client-portal
//      boundary (opportunities must never reach a client), and the
//      preparer's "Add to Action Plan" workflow. Same conventions as
//      test/pinnacle-tax-reserve.test.js and test/pinnacle-action-plan.test.js.
//
// Run with: npm test  (node --test test/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const {
  buildPinnaclePlanningOpportunities,
  ENTITY_STRUCTURE_REVIEW_THRESHOLD,
  RETIREMENT_REVIEW_MIN_NET_INCOME,
  MIN_MILEAGE_FOR_REVIEW_TRIGGER,
  SHORTFALL_MATERIALITY_THRESHOLD
} = require("../engines/pinnaclePlanningEngine");

// =============================================================================
// Group 1: pure unit tests
// =============================================================================

function findOpportunity(result, strategyKey) {
  return result.opportunities.find((item) => item.strategyKey === strategyKey);
}

test("A. A material estimated-tax shortfall creates the estimated_tax_shortfall opportunity", () => {
  const result = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: {
      calculationStatus: "complete",
      netBusinessIncome: 50000,
      estimatedTotalTax: 11000,
      taxPaymentsRecorded: 0,
      remainingEstimatedTax: 11000
    },
    grossBusinessIncome: 80000,
    businessExpenses: 30000,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 11000
  });

  const shortfall = findOpportunity(result, "estimated_tax_shortfall");
  assert.ok(shortfall, "expected an estimated_tax_shortfall opportunity");
  assert.equal(shortfall.estimatedImpact, 11000);
  assert.equal(shortfall.priority, "high");
  assert.equal(shortfall.confidence, "high");
  assert.equal(shortfall.requiresProfessionalReview, false);
});

test("B. A fully funded position (no remaining estimated tax) does not create a false shortfall opportunity", () => {
  const result = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: {
      calculationStatus: "complete",
      netBusinessIncome: 50000,
      estimatedTotalTax: 11000,
      taxPaymentsRecorded: 11000,
      remainingEstimatedTax: 0
    },
    grossBusinessIncome: 80000,
    businessExpenses: 30000,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });

  assert.equal(findOpportunity(result, "estimated_tax_shortfall"), undefined);
  assert.equal(findOpportunity(result, "quarterly_estimated_payment_review"), undefined);
});

test("C. Savings deposits reduce the funding-gap opportunity only -- they never reduce the shortfall opportunity's estimated impact", () => {
  const result = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: {
      calculationStatus: "complete",
      netBusinessIncome: 50000,
      estimatedTotalTax: 11000,
      taxPaymentsRecorded: 0,
      remainingEstimatedTax: 11000
    },
    grossBusinessIncome: 80000,
    businessExpenses: 30000,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 5000
  });

  const shortfall = findOpportunity(result, "estimated_tax_shortfall");
  assert.ok(shortfall);
  // Savings deposits must never be treated as tax payments -- the shortfall
  // figure (derived only from reserve.remainingEstimatedTax) is unaffected
  // by the $5,000 recorded as saved.
  assert.equal(shortfall.estimatedImpact, 11000);

  const fundingGap = findOpportunity(result, "tax_savings_funding_gap");
  assert.ok(fundingGap, "expected a tax_savings_funding_gap opportunity");
  assert.equal(fundingGap.estimatedImpact, 11000 - 5000);
  assert.equal(fundingGap.priority, "high");
});

test("D. Low business-expense ratio triggers a review opportunity without claiming a deduction is missing", () => {
  const result = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "no_business_income" },
    grossBusinessIncome: 80000,
    businessExpenses: 100,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });

  const opportunity = findOpportunity(result, "low_expense_ratio_review");
  assert.ok(opportunity);
  assert.equal(opportunity.estimatedImpact, null);
  assert.equal(opportunity.priority, "low");
  assert.ok(/review/i.test(opportunity.title));
  // The finding itself must describe a ratio, not assert that a deduction is
  // missing; the rationale must explicitly disclaim that conclusion.
  assert.ok(!/deductions? (is|are) missing/i.test(opportunity.finding));
  assert.ok(/not a finding that/i.test(opportunity.rationale));
});

test("E. No recorded business mileage creates only a review opportunity -- it does not assume the client drives for business", () => {
  const result = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "no_business_income" },
    grossBusinessIncome: 40000,
    businessExpenses: 20000,
    businessMileageTotal: 0,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });

  const opportunity = findOpportunity(result, "mileage_recordkeeping_review");
  assert.ok(opportunity);
  assert.equal(opportunity.estimatedImpact, null);
  assert.equal(opportunity.requiresProfessionalReview, false);
  assert.ok(/does not assume/i.test(opportunity.rationale));
});

test("F. Actual business mileage above the review threshold prevents the mileage-recordkeeping trigger", () => {
  const result = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "no_business_income" },
    grossBusinessIncome: 40000,
    businessExpenses: 20000,
    businessMileageTotal: MIN_MILEAGE_FOR_REVIEW_TRIGGER + 1,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });

  assert.equal(findOpportunity(result, "mileage_recordkeeping_review"), undefined);

  const withIncompleteRecords = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "no_business_income" },
    grossBusinessIncome: 40000,
    businessExpenses: 20000,
    businessMileageTotal: MIN_MILEAGE_FOR_REVIEW_TRIGGER + 1,
    incompleteMileageRecordCount: 2,
    savingsDeposited: 0
  });

  const opportunity = findOpportunity(withIncompleteRecords, "mileage_recordkeeping_review");
  assert.ok(opportunity, "existing mileage with incomplete records should still surface a completion-review opportunity");
  assert.equal(opportunity.title, "Complete incomplete mileage records");
  assert.ok(/2/.test(opportunity.finding));
});

test("G. The quarterly estimated-payment review trigger behaves deterministically at its boundaries", () => {
  const materialNoPayments = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: {
      calculationStatus: "complete",
      netBusinessIncome: 10000,
      estimatedTotalTax: SHORTFALL_MATERIALITY_THRESHOLD,
      taxPaymentsRecorded: 0,
      remainingEstimatedTax: SHORTFALL_MATERIALITY_THRESHOLD
    },
    grossBusinessIncome: 20000,
    businessExpenses: 10000,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  assert.ok(findOpportunity(materialNoPayments, "quarterly_estimated_payment_review"));

  const belowMateriality = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: {
      calculationStatus: "complete",
      netBusinessIncome: 10000,
      estimatedTotalTax: SHORTFALL_MATERIALITY_THRESHOLD - 1,
      taxPaymentsRecorded: 0,
      remainingEstimatedTax: SHORTFALL_MATERIALITY_THRESHOLD - 1
    },
    grossBusinessIncome: 20000,
    businessExpenses: 10000,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  assert.equal(findOpportunity(belowMateriality, "quarterly_estimated_payment_review"), undefined);

  const anyPaymentRecorded = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: {
      calculationStatus: "complete",
      netBusinessIncome: 10000,
      estimatedTotalTax: 5000,
      taxPaymentsRecorded: 1,
      remainingEstimatedTax: 4999
    },
    grossBusinessIncome: 20000,
    businessExpenses: 10000,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  assert.equal(findOpportunity(anyPaymentRecorded, "quarterly_estimated_payment_review"), undefined);
});

test("H. The QBI review opportunity never carries a fabricated dollar impact", () => {
  const present = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "complete", netBusinessIncome: 1 },
    grossBusinessIncome: 1,
    businessExpenses: 0,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  const qbi = findOpportunity(present, "qbi_section_199a_review");
  assert.ok(qbi);
  assert.equal(qbi.estimatedImpact, null);
  assert.equal(qbi.requiresProfessionalReview, true);
  assert.equal(qbi.confidence, "review_required");

  const absent = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "no_business_income", netBusinessIncome: 0 },
    grossBusinessIncome: 0,
    businessExpenses: 0,
    businessMileageTotal: 0,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  assert.equal(findOpportunity(absent, "qbi_section_199a_review"), undefined);
});

test("I. The retirement-plan review opportunity never carries a fabricated contribution limit", () => {
  const present = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "complete", netBusinessIncome: RETIREMENT_REVIEW_MIN_NET_INCOME },
    grossBusinessIncome: RETIREMENT_REVIEW_MIN_NET_INCOME,
    businessExpenses: 0,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  const retirement = findOpportunity(present, "self_employed_retirement_review");
  assert.ok(retirement);
  assert.equal(retirement.estimatedImpact, null);
  assert.equal(retirement.requiresProfessionalReview, true);

  const belowThreshold = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "complete", netBusinessIncome: RETIREMENT_REVIEW_MIN_NET_INCOME - 1 },
    grossBusinessIncome: RETIREMENT_REVIEW_MIN_NET_INCOME - 1,
    businessExpenses: 0,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  assert.equal(findOpportunity(belowThreshold, "self_employed_retirement_review"), undefined);
});

test("J. The entity-structure review opportunity never carries a fabricated savings estimate", () => {
  const result = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "complete", netBusinessIncome: ENTITY_STRUCTURE_REVIEW_THRESHOLD },
    grossBusinessIncome: ENTITY_STRUCTURE_REVIEW_THRESHOLD,
    businessExpenses: 0,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  const entity = findOpportunity(result, "entity_structure_review");
  assert.ok(entity);
  assert.equal(entity.estimatedImpact, null);
  assert.equal(entity.requiresProfessionalReview, true);
});

test("K. The entity-structure threshold is an internal review trigger (not a tax-law eligibility rule) and its boundary is deterministic", () => {
  assert.equal(ENTITY_STRUCTURE_REVIEW_THRESHOLD, 60000);

  const justBelow = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "complete", netBusinessIncome: ENTITY_STRUCTURE_REVIEW_THRESHOLD - 1 },
    grossBusinessIncome: ENTITY_STRUCTURE_REVIEW_THRESHOLD - 1,
    businessExpenses: 0,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  assert.equal(findOpportunity(justBelow, "entity_structure_review"), undefined);

  const atThreshold = buildPinnaclePlanningOpportunities({
    taxYear: 2026,
    reserve: { calculationStatus: "complete", netBusinessIncome: ENTITY_STRUCTURE_REVIEW_THRESHOLD },
    grossBusinessIncome: ENTITY_STRUCTURE_REVIEW_THRESHOLD,
    businessExpenses: 0,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0
  });
  const entity = findOpportunity(atThreshold, "entity_structure_review");
  assert.ok(entity);
  assert.ok(/review trigger/i.test(entity.rationale));
  assert.ok(!/eligib/i.test(entity.rationale) || /not.*eligib/i.test(entity.rationale));
});

// =============================================================================
// Group 2: server-spawning tests (office routes, client boundary, add-to-plan)
// =============================================================================

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");
const PORTAL_ACCOUNTS_FILE = path.join(REPO_ROOT, "client-portal-accounts.local.json");

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET = "test-only-office-session-secret-automated-tests-32chars-min";
const PUBLIC_LEAD_ACCESS_SECRET = "test-only-public-lead-access-secret-for-automated-tests-32ch";
const CLIENT_PORTAL_SESSION_SECRET = "test-only-client-portal-session-secret-automated-tests-32chr";

const DEV_PORT = 3934;

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

async function postJson(pathname, payload, cookie) {
  return fetch(`${base()}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
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
  const email = `pinnacle-planning-test+${marker}@example.test`;
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

async function getClientPortalSession(cookie) {
  return fetch(`${base()}/api/client-portal/session`, {
    headers: cookie ? { Cookie: cookie } : {}
  });
}

async function adminGetPlanningOpportunities(leadId, cookie) {
  return fetch(
    `${base()}/api/admin/pinnacle-planning-opportunities/${encodeURIComponent(leadId)}`,
    { headers: cookie ? { Cookie: cookie } : {} }
  );
}

async function adminAddToActionPlan(leadId, strategyKey, cookie, overrides) {
  return postJson(
    `/api/admin/pinnacle-planning-opportunities/${encodeURIComponent(leadId)}/add-to-action-plan`,
    { strategyKey, overrides },
    cookie
  );
}

// Gross $60,000, expenses $10,000, 1,000 business miles in March -- the same
// shape as test/pinnacle-tax-reserve.test.js's default fixture. Under 2026
// rules (the current tax year) this reliably produces: a material shortfall,
// no recorded estimated payments, a funding gap, and enough net business
// income to trigger the QBI and retirement review opportunities, but not the
// low-expense-ratio, mileage, or entity-structure opportunities.
function pinnacleWorkspaceFixture(overrides = {}) {
  return {
    version: 4,
    businessProfile: {
      structure: "sole-prop",
      fields: {
        legalName: "Test Planning Business",
        filingStatus: "single",
        otherTaxableIncome: "0"
      }
    },
    incomeSources: [{ id: "INC-1", name: "Test Business", ytd: "60000" }],
    expenses: [{ id: "EXP-1", amount: "10000", date: "2026-03-15" }],
    vehicles: [],
    trips: [
      {
        id: "TRIP-1",
        date: "2026-03-15",
        miles: "1000",
        roundTrip: "no",
        classification: "business"
      }
    ],
    dailyMileage: [],
    taxActivity: [],
    updatedAt: new Date().toISOString(),
    ...overrides
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

test("L. Planning opportunities are never exposed through the client portal session", async () => {
  const account = await createActivatedAccount("l-client-boundary-" + Date.now());

  try {
    patchLocalLead(account.leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });

    const res = await getClientPortalSession(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.portal?.planningOpportunities, undefined);
    // No raw opportunity object -- identifiable by its unique strategyKey
    // field -- may ever appear anywhere in the client portal payload.
    assert.ok(!JSON.stringify(body.portal || {}).includes("strategyKey"));
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("M. Authenticated office user can retrieve planning opportunities for a lead", async () => {
  const leadId = await createLead("m-office-read-" + Date.now(), "pinnacle-planning-m@example.test");

  try {
    patchLocalLead(leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });

    const res = await adminGetPlanningOpportunities(leadId, officeCookie);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.planningOpportunities?.opportunities));
    assert.ok(
      body.planningOpportunities.opportunities.some((o) => o.strategyKey === "estimated_tax_shortfall")
    );
  } finally {
    removeTestLead(leadId);
  }
});

test("N. Unauthenticated caller cannot retrieve planning opportunities", async () => {
  const leadId = await createLead("n-unauth-" + Date.now(), "pinnacle-planning-n@example.test");

  try {
    const res = await adminGetPlanningOpportunities(leadId, null);
    assert.equal(res.status, 401);
  } finally {
    removeTestLead(leadId);
  }
});

test("O/P. A preparer can add ONE opportunity to the Action Plan, and it is created as a proposed/draft recommendation, not automatically approved", async () => {
  const leadId = await createLead("op-add-to-plan-" + Date.now(), "pinnacle-planning-op@example.test");

  try {
    patchLocalLead(leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });

    const res = await adminAddToActionPlan(leadId, "estimated_tax_shortfall", officeCookie);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.ok, true);
    assert.equal(body.addedRecommendation.strategyKey, "estimated_tax_shortfall");
    assert.equal(body.addedRecommendation.status, "proposed");
    assert.equal(body.pinnacleActionPlan.recommendations.length, 1);
    // The plan itself is not auto-approved just because a recommendation was added.
    assert.equal(body.pinnacleActionPlan.status, "draft");

    // A second, different opportunity can be added independently -- adding is
    // deliberate and per-opportunity, never a bulk operation.
    const res2 = await adminAddToActionPlan(leadId, "quarterly_estimated_payment_review", officeCookie);
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.pinnacleActionPlan.recommendations.length, 2);
  } finally {
    removeTestLead(leadId);
  }
});

test("Q. Provenance (strategyKey, sourceOpportunityId, generatedAt) survives Action Plan normalization and persistence", async () => {
  const leadId = await createLead("q-provenance-" + Date.now(), "pinnacle-planning-q@example.test");

  try {
    patchLocalLead(leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });

    await adminAddToActionPlan(leadId, "estimated_tax_shortfall", officeCookie, {
      title: "Preparer-edited title"
    });

    const stored = getLocalLead(leadId);
    const recommendation = stored.pinnacleActionPlan.recommendations[0];

    assert.equal(recommendation.strategyKey, "estimated_tax_shortfall");
    assert.ok(recommendation.sourceOpportunityId);
    assert.ok(recommendation.generatedAt);
    assert.equal(recommendation.title, "Preparer-edited title");

    // Re-reading through the admin route must also still show it.
    const res = await adminGetPlanningOpportunities(leadId, officeCookie);
    assert.equal(res.status, 200);
  } finally {
    removeTestLead(leadId);
  }
});

test("R. Existing (pre-Phase-3) Action Plan recommendations without provenance fields remain fully compatible", async () => {
  const leadId = await createLead("r-legacy-compat-" + Date.now(), "pinnacle-planning-r@example.test");

  try {
    const legacyPlan = {
      version: 1,
      status: "draft",
      taxYear: "2025",
      executiveSummary: "",
      currentTaxPosition: "",
      recommendations: [
        {
          id: "legacy-rec-1",
          priority: "medium",
          category: "Legacy",
          title: "Pre-existing recommendation",
          recommendation: "Created before Phase 3.",
          rationale: "",
          estimatedImpact: "",
          impactType: "",
          deadline: "",
          documentsNeeded: "",
          clientAction: "",
          status: "proposed",
          requiresProfessionalReview: false,
          preparerNotes: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
          // No strategyKey / sourceOpportunityId / generatedAt -- simulating
          // a recommendation created before this phase existed.
        }
      ],
      preparerNotes: "",
      assumptions: "",
      lastReviewedAt: "",
      reviewedBy: "",
      deliveredAt: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    patchLocalLead(leadId, {
      pinnacleWorkspace: pinnacleWorkspaceFixture(),
      pinnacleActionPlan: legacyPlan
    });

    // Adding a new opportunity must not disturb the legacy recommendation.
    const res = await adminAddToActionPlan(leadId, "estimated_tax_shortfall", officeCookie);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.pinnacleActionPlan.recommendations.length, 2);
    const legacy = body.pinnacleActionPlan.recommendations.find((r) => r.id === "legacy-rec-1");
    assert.ok(legacy, "the legacy recommendation must be preserved");
    assert.equal(legacy.title, "Pre-existing recommendation");
    assert.equal(legacy.strategyKey, "");
    assert.equal(legacy.sourceOpportunityId, "");
    assert.equal(legacy.generatedAt, "");
  } finally {
    removeTestLead(leadId);
  }
});
