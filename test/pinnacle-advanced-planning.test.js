"use strict";
// Tests for Pinnacle Advanced Planning v1 (QBI / Section 199A preliminary
// calculation + self-employed SEP-IRA / Solo 401(k) contribution planning).
// engines/pinnacleAdvancedPlanning.js, exposed office-only via
// GET /api/admin/pinnacle-advanced-planning/:leadId and folded into the
// existing QBI / retirement Pinnacle Planning Opportunities.
//
// Every expected value below is derived by hand from the rules documented
// at the top of engines/pinnacleAdvancedPlanning.js (IRS Rev. Proc. 2025-32
// Section 4.26 for QBI; IRS Notice 2025-67 for retirement plan limits, both
// read directly from irs.gov), not copied from the module's own output.
//
// Two groups: (1) pure unit tests against the engine functions directly --
// fast, no server; (2) server-spawning tests for the office-only route, the
// client-portal boundary, and the opportunity-to-Action-Plan workflow, same
// conventions as test/pinnacle-planning-intelligence.test.js.
//
// Run with: npm test  (node --test test/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const {
  computeQbiPreliminary,
  computeRetirementPlanning
} = require("../engines/pinnacleAdvancedPlanning");
const { buildPinnaclePlanningOpportunities } = require("../engines/pinnaclePlanningEngine");

// =============================================================================
// Group 1: pure unit tests
// =============================================================================

test("A/B. Positive qualifying-looking business income below the QBI threshold produces a preliminary calculation using the correct 20% rule", () => {
  const result = computeQbiPreliminary({
    taxYear: 2026,
    reserveStatus: "complete",
    filingStatus: "single",
    netBusinessIncome: 60000,
    deductibleHalfOfSETax: 4000,
    taxableIncomeBeforeQbi: 70000
  });

  assert.equal(result.status, "preliminary_below_threshold");
  assert.equal(result.requiresProfessionalReview, false);
  // QBI = 60000 - 4000 = 56000; tentative = round(56000 * 0.20) = 11200.
  assert.equal(result.estimatedQualifiedBusinessIncome, 56000);
  assert.equal(result.tentativeQbiDeduction, 11200);
  // Taxable-income limitation = round(70000 * 0.20) = 14000, above the
  // tentative amount, so it is not the binding constraint here.
  assert.equal(result.taxableIncomeLimitation, 14000);
  assert.equal(result.estimatedQbiDeduction, 11200);
});

test("C. The taxable-income limitation is applied when it is lower than the tentative 20% QBI amount", () => {
  const result = computeQbiPreliminary({
    taxYear: 2026,
    reserveStatus: "complete",
    filingStatus: "single",
    netBusinessIncome: 60000,
    deductibleHalfOfSETax: 0,
    taxableIncomeBeforeQbi: 10000
  });

  // QBI = 60000; tentative = round(60000 * 0.20) = 12000.
  assert.equal(result.tentativeQbiDeduction, 12000);
  // Limitation = round(10000 * 0.20) = 2000, lower than the tentative amount.
  assert.equal(result.taxableIncomeLimitation, 2000);
  assert.equal(result.estimatedQbiDeduction, 2000);
});

test("D. Zero or negative business income does not create a positive QBI deduction", () => {
  const zero = computeQbiPreliminary({
    taxYear: 2026,
    reserveStatus: "complete",
    filingStatus: "single",
    netBusinessIncome: 0,
    deductibleHalfOfSETax: 0,
    taxableIncomeBeforeQbi: 20000
  });
  assert.equal(zero.status, "no_positive_qbi");
  assert.equal(zero.estimatedQbiDeduction, null);

  const negative = computeQbiPreliminary({
    taxYear: 2026,
    reserveStatus: "complete",
    filingStatus: "single",
    netBusinessIncome: -5000,
    deductibleHalfOfSETax: 0,
    taxableIncomeBeforeQbi: 0
  });
  assert.equal(negative.status, "no_positive_qbi");
  assert.equal(negative.estimatedQbiDeduction, null);
});

test("E/F. Taxable income at or above the phase-in ceiling triggers professional review without assuming SSTB/W-2/UBIA facts", () => {
  const result = computeQbiPreliminary({
    taxYear: 2026,
    reserveStatus: "complete",
    filingStatus: "single",
    netBusinessIncome: 300000,
    deductibleHalfOfSETax: 15000,
    // 2026 single "All Other Returns" phase-in ceiling is $276,750
    // (verified from Rev. Proc. 2025-32 Section 4.26).
    taxableIncomeBeforeQbi: 300000
  });

  assert.equal(result.requiresProfessionalReview, true);
  assert.equal(result.estimatedQbiDeduction, null);
  assert.equal(result.reviewReasons.length > 0, true);
  assert.ok(/W-2 wages/.test(result.reviewReasons.join(" ")));
  assert.ok(/UBIA/.test(result.reviewReasons.join(" ")));
  assert.ok(/SSTB/.test(result.reviewReasons.join(" ")));
  // The tentative (unlimited) figure is still surfaced for reference, but
  // never presented as the estimated deduction.
  assert.equal(result.tentativeQbiDeduction, Math.round((300000 - 15000) * 0.20));
});

test("G/H. The QBI planning opportunity surfaces the preliminary figure through calculationDetails only, and estimatedImpact stays null in every scenario", () => {
  const belowThresholdContext = {
    taxYear: 2026,
    reserve: { calculationStatus: "complete", netBusinessIncome: 60000 },
    grossBusinessIncome: 70000,
    businessExpenses: 10000,
    businessMileageTotal: 500,
    incompleteMileageRecordCount: 0,
    savingsDeposited: 0,
    qbi: computeQbiPreliminary({
      taxYear: 2026,
      reserveStatus: "complete",
      filingStatus: "single",
      netBusinessIncome: 60000,
      deductibleHalfOfSETax: 4000,
      taxableIncomeBeforeQbi: 70000
    }),
    retirement: { status: "no_positive_earnings" }
  };

  const belowThresholdResult = buildPinnaclePlanningOpportunities(belowThresholdContext);
  const qbiOpp1 = belowThresholdResult.opportunities.find((o) => o.strategyKey === "qbi_section_199a_review");
  assert.ok(qbiOpp1);
  assert.equal(qbiOpp1.estimatedImpact, null);
  assert.equal(qbiOpp1.requiresProfessionalReview, true);
  assert.equal(qbiOpp1.calculationDetails.preliminaryQbiCalculation.estimatedQbiDeduction, 11200);
  assert.ok(/11,200|preliminary QBI deduction/.test(qbiOpp1.finding));

  const reviewRequiredContext = {
    ...belowThresholdContext,
    reserve: { calculationStatus: "complete", netBusinessIncome: 300000 },
    qbi: computeQbiPreliminary({
      taxYear: 2026,
      reserveStatus: "complete",
      filingStatus: "single",
      netBusinessIncome: 300000,
      deductibleHalfOfSETax: 15000,
      taxableIncomeBeforeQbi: 300000
    })
  };
  const reviewRequiredResult = buildPinnaclePlanningOpportunities(reviewRequiredContext);
  const qbiOpp2 = reviewRequiredResult.opportunities.find((o) => o.strategyKey === "qbi_section_199a_review");
  assert.ok(qbiOpp2);
  // Limited/incomplete QBI scenario: estimatedImpact stays null, and the
  // calculationDetails' own estimatedQbiDeduction also stays null.
  assert.equal(qbiOpp2.estimatedImpact, null);
  assert.equal(qbiOpp2.calculationDetails.preliminaryQbiCalculation.estimatedQbiDeduction, null);
});

test("I. SEP-IRA self-employed contribution mechanics (effective 20% of adjusted net earnings, not 25% of raw profit) are calculated correctly", () => {
  const result = computeRetirementPlanning({
    taxYear: 2026,
    reserveStatus: "complete",
    netBusinessIncome: 100000,
    deductibleHalfOfSETax: 6000,
    age: null,
    outsideElectiveDeferralsThisYear: 0
  });

  // Adjusted net earnings = 100000 - 6000 = 94000.
  assert.equal(result.selfEmploymentCompensation, 94000);
  // Effective self-employed rate = 25% / 125% = 20%; 94000 * 0.20 = 18800.
  assert.equal(result.sepIra.estimatedMaximumContribution, 18800);
  // Confirms this is NOT simply 25% of the raw $100,000 Schedule C profit.
  assert.notEqual(result.sepIra.estimatedMaximumContribution, Math.round(100000 * 0.25));
});

test("J/K. Solo 401(k) employee-deferral and employer-contribution components are calculated correctly and independently", () => {
  const result = computeRetirementPlanning({
    taxYear: 2026,
    reserveStatus: "complete",
    netBusinessIncome: 100000,
    deductibleHalfOfSETax: 6000,
    age: null,
    outsideElectiveDeferralsThisYear: 0
  });

  // J: employee deferral = min($24,500 statutory 2026 limit, $94,000 compensation) = $24,500.
  assert.equal(result.solo401k.employeeDeferralComponent, 24500);
  // K: employer component uses the same effective-20% mechanic as the SEP: 94000 * 0.20 = 18800.
  assert.equal(result.solo401k.employerContributionComponent, 18800);
});

test("L. The section 415(c) annual-additions limit ($72,000 for 2026) is enforced on the combined employee + employer Solo 401(k) total", () => {
  const result = computeRetirementPlanning({
    taxYear: 2026,
    reserveStatus: "complete",
    netBusinessIncome: 1000000,
    deductibleHalfOfSETax: 60000,
    age: null,
    outsideElectiveDeferralsThisYear: 0
  });

  // Adjusted net earnings = 940000, capped at the $360,000 2026 compensation
  // limit -> cappedCompensation = 360000. Employee deferral = 24500.
  // Employer = round(360000 * 0.20) = 72000. Combined (24500+72000=96500)
  // exceeds the $72,000 section 415(c) limit, so it must be capped there
  // (no catch-up in this scenario since age is not provided).
  assert.equal(result.selfEmploymentCompensation, 360000);
  assert.equal(result.solo401k.estimatedMaximumContribution, 72000);
  assert.equal(result.sepIra.estimatedMaximumContribution, 72000);
});

test("M. Age-based catch-up behavior is correct: no catch-up without an age, standard catch-up for 50+, and the non-stacking enhanced catch-up for ages 60-63", () => {
  const noAge = computeRetirementPlanning({
    taxYear: 2026, reserveStatus: "complete", netBusinessIncome: 100000, deductibleHalfOfSETax: 6000, age: null, outsideElectiveDeferralsThisYear: 0
  });
  assert.equal(noAge.solo401k.catchUpComponent, 0);

  const age55 = computeRetirementPlanning({
    taxYear: 2026, reserveStatus: "complete", netBusinessIncome: 100000, deductibleHalfOfSETax: 6000, age: 55, outsideElectiveDeferralsThisYear: 0
  });
  // 2026 age-50-and-over catch-up limit is $8,000 (IRS Notice 2025-67).
  assert.equal(age55.solo401k.catchUpComponent, 8000);

  const age61 = computeRetirementPlanning({
    taxYear: 2026, reserveStatus: "complete", netBusinessIncome: 100000, deductibleHalfOfSETax: 6000, age: 61, outsideElectiveDeferralsThisYear: 0
  });
  // 2026 ages-60-63 enhanced catch-up is $11,250 -- replaces, not adds to,
  // the standard $8,000 age-50 catch-up.
  assert.equal(age61.solo401k.catchUpComponent, 11250);

  const age65 = computeRetirementPlanning({
    taxYear: 2026, reserveStatus: "complete", netBusinessIncome: 100000, deductibleHalfOfSETax: 6000, age: 65, outsideElectiveDeferralsThisYear: 0
  });
  // Age 64+ reverts to the standard $8,000 catch-up, not the 60-63 amount.
  assert.equal(age65.solo401k.catchUpComponent, 8000);
});

test("N. Elective deferrals already made to an outside employer plan reduce the Solo 401(k) employee-deferral room available here", () => {
  const result = computeRetirementPlanning({
    taxYear: 2026,
    reserveStatus: "complete",
    netBusinessIncome: 40000,
    deductibleHalfOfSETax: 2500,
    age: null,
    outsideElectiveDeferralsThisYear: 20000
  });

  // Base 2026 deferral limit $24,500 - $20,000 already deferred elsewhere = $4,500 remaining.
  assert.equal(result.solo401k.employeeDeferralComponent, 4500);
});

test("O. Negative/zero self-employment earnings do not create a contribution amount", () => {
  const result = computeRetirementPlanning({
    taxYear: 2026,
    reserveStatus: "complete",
    netBusinessIncome: 0,
    deductibleHalfOfSETax: 0,
    age: 55,
    outsideElectiveDeferralsThisYear: 0
  });

  assert.equal(result.status, "no_positive_earnings");
  assert.equal(result.sepIra.estimatedMaximumContribution, 0);
  assert.equal(result.solo401k.estimatedMaximumContribution, 0);
});

// =============================================================================
// Group 2: server-spawning tests (office route, client boundary, Action Plan)
// =============================================================================

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");
const PORTAL_ACCOUNTS_FILE = path.join(REPO_ROOT, "client-portal-accounts.local.json");

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET = "test-only-office-session-secret-automated-tests-32chars-min";
const PUBLIC_LEAD_ACCESS_SECRET = "test-only-public-lead-access-secret-for-automated-tests-32ch";
const CLIENT_PORTAL_SESSION_SECRET = "test-only-client-portal-session-secret-automated-tests-32chr";

const DEV_PORT = 3935;

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

async function createActivatedAccount(marker, password = "InitialPass123") {
  const email = `pinnacle-advanced-planning-test+${marker}@example.test`;
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

async function adminGetAdvancedPlanning(leadId, cookie) {
  return fetch(
    `${base()}/api/admin/pinnacle-advanced-planning/${encodeURIComponent(leadId)}`,
    { headers: cookie ? { Cookie: cookie } : {} }
  );
}

async function adminAddToActionPlan(leadId, strategyKey, cookie) {
  return postJson(
    `/api/admin/pinnacle-planning-opportunities/${encodeURIComponent(leadId)}/add-to-action-plan`,
    { strategyKey },
    cookie
  );
}

// Gross $150,000, expenses $10,000, 500 miles -- a larger fixture than the
// standard $60k Pinnacle test fixture, specifically so net business income
// clears the $60,000 entity-structure threshold and stays below the 2026
// single QBI phase-in ceiling, producing defensible preliminary QBI and
// retirement figures for the server-level tests below.
function pinnacleWorkspaceFixture(overrides = {}) {
  return {
    version: 4,
    businessProfile: {
      structure: "sole-prop",
      fields: {
        legalName: "Test Advanced Planning Business",
        filingStatus: "single",
        otherTaxableIncome: "0",
        age: "45",
        outsideElectiveDeferralsThisYear: "0"
      }
    },
    incomeSources: [{ id: "INC-1", name: "Test Business", ytd: "150000" }],
    expenses: [{ id: "EXP-1", amount: "10000", date: "2026-03-15" }],
    vehicles: [],
    trips: [
      {
        id: "TRIP-1",
        date: "2026-03-15",
        miles: "500",
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

test("Q. Advanced planning calculations are never exposed through the client portal session", async () => {
  const account = await createActivatedAccount("q-client-boundary-" + Date.now());

  try {
    patchLocalLead(account.leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });

    const res = await getClientPortalSession(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.portal?.advancedPlanning, undefined);
    assert.ok(!JSON.stringify(body.portal || {}).includes("estimatedQualifiedBusinessIncome"));
    assert.ok(!JSON.stringify(body.portal || {}).includes("sepIra"));
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("R. Unauthenticated caller cannot retrieve advanced planning calculations", async () => {
  const leadId = await createLead("r-unauth-" + Date.now(), "pinnacle-advanced-planning-r@example.test");

  try {
    const res = await adminGetAdvancedPlanning(leadId, null);
    assert.equal(res.status, 401);
  } finally {
    removeTestLead(leadId);
  }
});

test("S. Authorized office user can retrieve advanced planning calculations for a lead", async () => {
  const leadId = await createLead("s-office-read-" + Date.now(), "pinnacle-advanced-planning-s@example.test");

  try {
    patchLocalLead(leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });

    const res = await adminGetAdvancedPlanning(leadId, officeCookie);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.ok, true);
    assert.ok(body.advancedPlanning?.qbi);
    assert.ok(body.advancedPlanning?.retirement);
    assert.equal(body.advancedPlanning.qbi.taxYear, 2026);
    assert.equal(body.advancedPlanning.retirement.taxYear, 2026);
  } finally {
    removeTestLead(leadId);
  }
});

test("T. Adding an upgraded QBI or retirement opportunity to the Action Plan still creates a proposed (not auto-approved) recommendation", async () => {
  const leadId = await createLead("t-add-upgraded-" + Date.now(), "pinnacle-advanced-planning-t@example.test");

  try {
    patchLocalLead(leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });

    const qbiRes = await adminAddToActionPlan(leadId, "qbi_section_199a_review", officeCookie);
    assert.equal(qbiRes.status, 200);
    const qbiBody = await qbiRes.json();
    assert.equal(qbiBody.addedRecommendation.status, "proposed");
    assert.equal(qbiBody.addedRecommendation.strategyKey, "qbi_section_199a_review");
    assert.equal(qbiBody.pinnacleActionPlan.status, "draft");

    const retirementRes = await adminAddToActionPlan(leadId, "self_employed_retirement_review", officeCookie);
    assert.equal(retirementRes.status, 200);
    const retirementBody = await retirementRes.json();
    assert.equal(retirementBody.addedRecommendation.status, "proposed");
    assert.equal(retirementBody.addedRecommendation.strategyKey, "self_employed_retirement_review");
    assert.equal(retirementBody.pinnacleActionPlan.status, "draft");
    assert.equal(retirementBody.pinnacleActionPlan.recommendations.length, 2);

    // Raw calculationDetails (e.g. the sepIra/solo401k breakdown) must never
    // be copied onto the stored recommendation -- only the reviewed
    // finding/rationale wording is.
    assert.equal(retirementBody.addedRecommendation.calculationDetails, undefined);
  } finally {
    removeTestLead(leadId);
  }
});
