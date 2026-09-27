"use strict";
// Regression tests for the Pinnacle tax-aware reserve calculation
// (server.js computePinnacleTaxReserve(), exposed via
// GET /api/client-portal/session -> portal.pinnacleTaxReserve, and via the
// office-only GET /api/admin/pinnacle-tax-reserve/:leadId):
//   - Reuses the exact same federal/state estimate() pipeline
//     (taxEstimator.js -> engines/federalEngine.js + engines/stateEngine.js)
//     already shipped and relied on elsewhere in the app, via the same
//     marginal with-vs-without-self-employment diff technique as
//     computeSelfEmploymentTaxReserve() (used for Tax Watch Pro).
//   - Sources inputs from the existing pinnacleWorkspace data
//     (incomeSources[].ytd, expenses[].amount, classified business
//     trips/daily mileage) plus two new, minimal Business Profile fields
//     (filingStatus, otherTaxableIncome).
//   - Tax payments are sourced only from taxActivity entries whose
//     recordType is "estimated-payment" for the matching tax year --
//     generic "deposit" entries are never treated as a tax payment.
//   - Never fabricates a number it cannot support: missing filing status or
//     no recorded business income produces a safe, clearly-flagged
//     incomplete result instead of a guessed figure.
//
// Spawns the real server.js in dev mode (local leads.json fallback, since
// Supabase is deliberately unreachable) -- never touches a real Supabase
// project or live Stripe. Same conventions as
// test/pinnacle-action-plan.test.js and test/tax-watch-expired-preview.test.js.
//
// Run with: npm test  (node --test test/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { estimate } = require("../taxEstimator");

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

const DEV_PORT = 3933;

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
  const email = `pinnacle-tax-reserve-test+${marker}@example.test`;
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

async function getClientPortalSession(cookie) {
  return fetch(`${base()}/api/client-portal/session`, {
    headers: cookie ? { Cookie: cookie } : {}
  });
}

async function adminGetTaxReserve(leadId, cookie) {
  return fetch(
    `${base()}/api/admin/pinnacle-tax-reserve/${encodeURIComponent(leadId)}`,
    { headers: cookie ? { Cookie: cookie } : {} }
  );
}

// Full-income workspace fixture used across most tests: gross $60,000,
// expenses $10,000, 1,000 business miles (2025's supported-year rate,
// non-split), filing status "single", no other income, no tax payments.
function pinnacleWorkspaceFixture(overrides = {}) {
  return {
    version: 4,
    businessProfile: {
      structure: "sole-prop",
      fields: {
        legalName: "Test Reserve Business",
        filingStatus: "single",
        otherTaxableIncome: "0"
      }
    },
    incomeSources: [{ id: "INC-1", name: "Test Business", ytd: "60000" }],
    expenses: [{ id: "EXP-1", amount: "10000", date: "2025-03-15" }],
    vehicles: [],
    trips: [
      {
        id: "TRIP-1",
        date: "2025-03-15",
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

// =============================================================================
// A/B/C. Known scenario: net business income, SE tax match, deductible half
// =============================================================================

test("A/B/C. Known Schedule-C-style scenario produces the expected net business income, SE tax (matching the authoritative engine directly), and deductible half of SE tax", async () => {
  const account = await createActivatedAccount("abc-known-scenario-" + Date.now());

  try {
    patchLocalLead(account.leadId, { pinnacleWorkspace: pinnacleWorkspaceFixture() });

    const res = await getClientPortalSession(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    const reserve = body.portal?.pinnacleTaxReserve || {};

    assert.equal(reserve.calculationStatus, "complete");
    assert.equal(reserve.taxYear, 2025);

    // A: net business income = 60000 gross - 10000 expenses - 700 mileage
    // deduction (1000mi x 2025's $0.70/mi rate) = 49300.
    assert.equal(reserve.netBusinessIncome, 49300);

    // B: cross-check against a direct, independent call to the exact same
    // public estimate() pipeline the server itself uses -- this is the
    // authoritative calculation logic being matched, not a reimplementation.
    const directBaseInput = {
      taxYear: 2025,
      filingStatus: "single",
      stateCode: "AZ",
      age: 30,
      isFullTimeStudent: false,
      canBeClaimedAsDependent: false,
      otherIncome: 0,
      selfEmploymentIncome: 60000,
      businessExpenses: 10000,
      businessMileage: 1000
    };
    const directWithSE = estimate(directBaseInput);
    const directWithoutSE = estimate({
      ...directBaseInput,
      selfEmploymentIncome: 0,
      businessExpenses: 0,
      businessMileage: 0
    });
    assert.equal(directWithSE.ok, true);
    assert.equal(directWithoutSE.ok, true);

    assert.equal(reserve.selfEmploymentTax, directWithSE.result.federal.summary.selfEmploymentTax);
    assert.equal(reserve.selfEmploymentTax, 6966);

    // C: deductible half of SE tax must match the engine's own
    // seAboveLineDeduction (not a locally-recomputed / hardcoded 50%).
    assert.equal(
      reserve.deductibleHalfOfSETax,
      directWithSE.result.federal.summary.seAboveLineDeduction
    );
    assert.equal(reserve.deductibleHalfOfSETax, 3483);

    const expectedFederalMarginal = Math.max(
      0,
      directWithSE.result.federal.summary.taxAfterCredits -
        directWithoutSE.result.federal.summary.taxAfterCredits
    );
    const expectedEstimatedFederalIncomeTax = Math.max(
      0,
      Math.round(expectedFederalMarginal - directWithSE.result.federal.summary.selfEmploymentTax)
    );
    assert.equal(reserve.estimatedFederalIncomeTax, expectedEstimatedFederalIncomeTax);
    assert.equal(reserve.estimatedFederalIncomeTax, 3370);

    const expectedArizona = Math.max(
      0,
      Math.round(
        directWithSE.result.state.summary.stateTax -
          directWithoutSE.result.state.summary.stateTax
      )
    );
    assert.equal(reserve.estimatedArizonaIncomeTax, expectedArizona);
    assert.equal(reserve.estimatedArizonaIncomeTax, 752);

    assert.equal(reserve.estimatedTotalTax, 6966 + 3370 + 752);
    assert.equal(reserve.effectiveEstimatedTaxRate, 22.5);
    assert.ok(Array.isArray(reserve.assumptions) && reserve.assumptions.length > 0);
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// D/E. Tax payments: only real estimated-payment entries count
// =============================================================================

test("D/E. Only estimated-payment taxActivity entries reduce the remaining estimate; generic deposits do not", async () => {
  const account = await createActivatedAccount("de-payments-" + Date.now());

  try {
    patchLocalLead(account.leadId, {
      pinnacleWorkspace: pinnacleWorkspaceFixture({
        taxActivity: [
          {
            id: "ETP-1",
            recordType: "estimated-payment",
            paymentType: "Federal estimated tax payment",
            amount: "2000.00",
            date: "2025-04-15",
            taxYear: "2025"
          },
          {
            id: "TSD-1",
            recordType: "deposit",
            paymentType: "Transfer to tax savings account",
            amount: "500.00",
            date: "2025-04-15",
            taxYear: "2025"
          }
        ]
      })
    });

    const res = await getClientPortalSession(account.cookie);
    const body = await res.json();
    const reserve = body.portal?.pinnacleTaxReserve || {};

    assert.equal(reserve.calculationStatus, "complete");
    // Only the $2,000 estimated payment counts -- the $500 deposit must not
    // be added in (2000, not 2500).
    assert.equal(reserve.taxPaymentsRecorded, 2000);
    assert.equal(reserve.estimatedTotalTax, 6966 + 3370 + 752);
    assert.equal(
      reserve.remainingEstimatedTax,
      Math.max(0, reserve.estimatedTotalTax - 2000)
    );
    assert.equal(reserve.recommendedReserve, reserve.remainingEstimatedTax);
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("E2. A voided estimated-payment entry does not count toward tax payments recorded", async () => {
  const account = await createActivatedAccount("e2-voided-" + Date.now());

  try {
    patchLocalLead(account.leadId, {
      pinnacleWorkspace: pinnacleWorkspaceFixture({
        taxActivity: [
          {
            id: "ETP-2",
            recordType: "estimated-payment",
            amount: "2000.00",
            date: "2025-04-15",
            taxYear: "2025",
            voidedAt: new Date().toISOString()
          }
        ]
      })
    });

    const res = await getClientPortalSession(account.cookie);
    const body = await res.json();
    const reserve = body.portal?.pinnacleTaxReserve || {};

    assert.equal(reserve.taxPaymentsRecorded, 0);
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// F. Missing filing status -> safe incomplete calculation
// =============================================================================

test("F. Missing filing status produces a safe, clearly-flagged incomplete calculation instead of a fabricated tax figure", async () => {
  const account = await createActivatedAccount("f-missing-status-" + Date.now());

  try {
    patchLocalLead(account.leadId, {
      pinnacleWorkspace: pinnacleWorkspaceFixture({
        businessProfile: {
          structure: "sole-prop",
          fields: { legalName: "No Filing Status LLC" }
        }
      })
    });

    const res = await getClientPortalSession(account.cookie);
    const body = await res.json();
    const reserve = body.portal?.pinnacleTaxReserve || {};

    assert.equal(reserve.calculationStatus, "missing_filing_status");
    assert.equal(reserve.estimatedFederalIncomeTax, null);
    assert.equal(reserve.estimatedArizonaIncomeTax, null);
    assert.equal(reserve.estimatedTotalTax, null);
    assert.ok(reserve.assumptions.some((a) => /filing status/i.test(a)));
  } finally {
    removePortalAccountAndLead(account);
  }
});

test("F2. No recorded business income produces calculationStatus no_business_income, not a fabricated reserve", async () => {
  const account = await createActivatedAccount("f2-no-income-" + Date.now());

  try {
    const res = await getClientPortalSession(account.cookie);
    const body = await res.json();
    const reserve = body.portal?.pinnacleTaxReserve || {};

    assert.equal(reserve.calculationStatus, "no_business_income");
    assert.equal(reserve.estimatedTotalTax, 0);
    assert.equal(reserve.recommendedReserve, 0);
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// G. Cross-customer isolation
// =============================================================================

test("G. One authenticated client cannot see another client's tax reserve calculation", async () => {
  const accountA = await createActivatedAccount("g-clientA-" + Date.now());
  const accountB = await createActivatedAccount("g-clientB-" + Date.now());

  try {
    patchLocalLead(
      accountA.leadId,
      { pinnacleWorkspace: pinnacleWorkspaceFixture() }
    );
    // Account B has no business income recorded at all.

    const resB = await getClientPortalSession(accountB.cookie);
    const bodyB = await resB.json();
    const reserveB = bodyB.portal?.pinnacleTaxReserve || {};
    assert.equal(reserveB.calculationStatus, "no_business_income");
    assert.notEqual(reserveB.netBusinessIncome, 49300);

    const resA = await getClientPortalSession(accountA.cookie);
    const bodyA = await resA.json();
    assert.equal(bodyA.portal?.pinnacleTaxReserve?.netBusinessIncome, 49300);
  } finally {
    removePortalAccountAndLead(accountA);
    removePortalAccountAndLead(accountB);
  }
});

// =============================================================================
// H. Unauthenticated access is rejected
// =============================================================================

test("H. Unauthenticated caller cannot retrieve any client's tax reserve calculation", async () => {
  const res = await getClientPortalSession("");
  assert.equal(res.status, 401);
});

test("H2. Unauthenticated caller cannot use the office-only admin tax reserve endpoint", async () => {
  const leadId = await createLead("h2-admin-unauth-" + Date.now(), "pinnacle-h2@example.test");
  try {
    const res = await adminGetTaxReserve(leadId, null);
    assert.equal(res.status, 401);
  } finally {
    removeTestLead(leadId);
  }
});

// =============================================================================
// I. Invalid numeric inputs never produce NaN/Infinity or corrupt data
// =============================================================================

test("I. Invalid/garbage numeric workspace values degrade safely instead of producing NaN/Infinity", async () => {
  const account = await createActivatedAccount("i-invalid-numbers-" + Date.now());

  try {
    patchLocalLead(account.leadId, {
      pinnacleWorkspace: pinnacleWorkspaceFixture({
        incomeSources: [{ id: "INC-1", ytd: "not-a-number" }],
        expenses: [{ id: "EXP-1", amount: "NaN", date: "2025-03-15" }],
        trips: [
          {
            id: "TRIP-1",
            date: "2025-03-15",
            miles: "-500",
            roundTrip: "no",
            classification: "business"
          }
        ]
      })
    });

    const res = await getClientPortalSession(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    const reserve = body.portal?.pinnacleTaxReserve || {};

    // Garbage ytd -> treated as 0 income -> no fabricated tax figure.
    assert.equal(reserve.calculationStatus, "no_business_income");
    for (const key of [
      "netBusinessIncome",
      "estimatedTotalTax",
      "taxPaymentsRecorded",
      "remainingEstimatedTax",
      "recommendedReserve",
      "effectiveEstimatedTaxRate"
    ]) {
      const value = reserve[key];
      assert.equal(Number.isFinite(value), true, `${key} must be a finite number, got ${value}`);
    }
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// J/K. Existing pinnacleWorkspace / pinnacleActionPlan data are unaffected
// =============================================================================

test("J/K. Computing the tax reserve does not alter stored pinnacleWorkspace or pinnacleActionPlan data", async () => {
  const account = await createActivatedAccount("jk-unaffected-" + Date.now());

  try {
    const workspace = pinnacleWorkspaceFixture();
    patchLocalLead(account.leadId, { pinnacleWorkspace: workspace });

    await adminGetTaxReserve(account.leadId, officeCookie);

    const planRes = await fetch(
      `http://127.0.0.1:${DEV_PORT}/api/admin/pinnacle-action-plan/${encodeURIComponent(account.leadId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: officeCookie },
        body: JSON.stringify({ executiveSummary: "Untouched by tax reserve calc" })
      }
    );
    assert.equal(planRes.status, 200);

    // Read the tax reserve again (client + admin paths) -- this must never
    // write anything back to the lead record.
    await getClientPortalSession(account.cookie);
    await adminGetTaxReserve(account.leadId, officeCookie);

    const stored = getLocalLead(account.leadId);
    assert.equal(stored.pinnacleWorkspace.incomeSources.length, 1);
    assert.equal(stored.pinnacleWorkspace.incomeSources[0].ytd, "60000");
    assert.equal(stored.pinnacleActionPlan.executiveSummary, "Untouched by tax reserve calc");
  } finally {
    removePortalAccountAndLead(account);
  }
});

// =============================================================================
// L. Existing Tax Watch Pro behavior remains unaffected
// =============================================================================

test("L. Tax Watch Pro session data is unaffected by the Pinnacle tax reserve addition", async () => {
  const account = await createActivatedAccount("l-taxwatch-" + Date.now());

  try {
    patchLocalLead(account.leadId, {
      taxWatchProfile: {
        status: "preview",
        previewStartedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        previewEndsAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString()
      },
      pinnacleWorkspace: pinnacleWorkspaceFixture()
    });

    const res = await getClientPortalSession(account.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.portal?.taxWatch?.active, true);
    assert.equal(body.portal?.taxWatch?.status, "preview");
    assert.equal(body.portal?.pinnacleTaxReserve?.calculationStatus, "complete");
  } finally {
    removePortalAccountAndLead(account);
  }
});
