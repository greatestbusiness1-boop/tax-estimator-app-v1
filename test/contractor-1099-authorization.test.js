"use strict";

// Authorization hardening for Contractor 1099 (and Tax Preparation) office
// actions:
//   - POST /api/contractor-1099-completion-email      -> office session required
//   - POST /api/create-contractor-1099-checkout       -> officeRequest needs office session
//   - POST /api/create-tax-preparation-checkout       -> officeRequest needs office session
//
// One local, non-production server is started with
// test/helpers/mock-stripe-and-email.js preloaded, so Stripe Checkout Session
// creation and all email sending are recorded to a log file instead of
// leaving the machine. Supabase points at a local stub that answers HTTP 500
// immediately, so leads come from the local leads.json fallback. Fixture
// leads use @example.test addresses and are removed afterwards.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const Stripe = require("stripe");

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");
const PRELOAD = path.join(__dirname, "helpers", "mock-stripe-and-email.js");
const OUTBOUND_LOG = path.join(
  os.tmpdir(),
  `c1099-auth-outbound-${process.pid}-${Date.now()}.jsonl`
);

const PORT = 3961;
const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET = "test-only-office-session-secret-automated-tests-32chars-min";
const STRIPE_DUMMY_KEY = "sk_test_dummy_key_constructed_only_never_used_for_a_real_api_call";
const STRIPE_WEBHOOK_SECRET = "whsec_test_only_dummy_secret_for_automated_tests";
const FORGED_OFFICE_COOKIE =
  "tsp_office_document_review=eyJwdXJwb3NlIjoib2ZmaWNlLWRvY3VtZW50LXJldmlldyIsImV4cGlyZXNBdCI6OTk5OTk5OTk5OTk5OX0.forged-signature";

const fixtureIds = new Set();
let supabaseStub;
let server;

// -----------------------------------------------------------------------------
// Infrastructure
// -----------------------------------------------------------------------------

function startSupabaseStub() {
  return new Promise((resolve) => {
    const stub = http.createServer((req, res) => {
      req.resume();
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "TEST_STUB", message: "Supabase intentionally unavailable." }));
    });
    stub.listen(0, "127.0.0.1", () => resolve(stub));
  });
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Test server did not become ready");
}

function readLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  const raw = fs.readFileSync(LEADS_FILE, "utf8").trim();
  return raw ? JSON.parse(raw) : [];
}

function writeLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf8");
}

function insertLead(lead) {
  const leads = readLeads();
  leads.push(lead);
  writeLeads(leads);
  fixtureIds.add(lead.leadId);
  return lead;
}

function getLead(leadId) {
  return readLeads().find((lead) => lead.leadId === leadId) || null;
}

function outbound() {
  if (!fs.existsSync(OUTBOUND_LOG)) return [];
  return fs
    .readFileSync(OUTBOUND_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sessionsFor(leadId) {
  return outbound().filter(
    (entry) =>
      entry.type === "stripe.checkout.sessions.create" &&
      entry.params?.client_reference_id === leadId
  );
}

function emailsTo(address) {
  return outbound().filter(
    (entry) => entry.type === "email" && String(entry.to).toLowerCase() === address.toLowerCase()
  );
}

async function post(pathname, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  return { res, json };
}

async function officeCookie() {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/office-document-review/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey: OFFICE_KEY })
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie, "office sign-in must return a session cookie");
  return cookie;
}

function uniqueId(prefix) {
  return `${prefix}-AUTHTEST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function contractor1099Lead(workOverrides = {}) {
  const leadId = uniqueId("C1099");
  const email = `${leadId.toLowerCase()}@example.test`;
  return insertLead({
    leadId,
    timestamp: new Date().toISOString(),
    status: "Contractor 1099 - Quote Sent",
    contact: { name: "Auth Test Client", email, phone: "(555) 555-0170" },
    contractor1099Request: {
      businessLegalName: "Auth Test Business LLC",
      taxYear: "2025",
      recipientCount: 3,
      serviceTypes: ["original_1099_nec"]
    },
    contractor1099Work: {
      workStatus: "Quote Sent",
      paymentRequirement: "Required",
      quotedFeeCents: 45000,
      paymentRequestAmountCents: 20000,
      amountPaidCents: 0,
      ...workOverrides
    }
  });
}

function completedContractor1099Lead(workOverrides = {}) {
  return contractor1099Lead({
    workStatus: "Completed",
    payerInformationStatus: "Complete",
    contractorInformationStatus: "Complete",
    w9RequirementStatus: "Resolved",
    documentStatus: "Complete",
    paymentRequirement: "Waived by Office",
    preparationStatus: "Complete",
    filingStatus: "Filed",
    irsAcceptanceStatus: "Accepted",
    stateFilingWorkStatus: "Not Required",
    recipientCopyStatus: "Delivered",
    filingConfirmationStatus: "Delivered",
    ...workOverrides
  });
}

function taxPreparationLead(workOverrides = {}) {
  const leadId = uniqueId("TAXPREP");
  const email = `${leadId.toLowerCase()}@example.test`;
  return insertLead({
    leadId,
    timestamp: new Date().toISOString(),
    status: "Tax Preparation - Quote Sent",
    contact: { name: "Auth Test Filer", email, phone: "(555) 555-0171" },
    taxPreparationIntake: { taxYear: "2025", recommendedLane: "Individual" },
    taxPreparationWork: {
      paymentRequirement: "Required",
      quotedFeeCents: 60000,
      paymentRequestAmountCents: 30000,
      amountPaidCents: 0,
      ...workOverrides
    }
  });
}

// -----------------------------------------------------------------------------

before(async () => {
  supabaseStub = await startSupabaseStub();
  const stubUrl = `http://127.0.0.1:${supabaseStub.address().port}`;

  server = spawn(process.execPath, ["-r", PRELOAD, "server.js"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "",
      RENDER: "",
      SUPABASE_URL: stubUrl,
      NEXT_PUBLIC_SUPABASE_URL: stubUrl,
      SUPABASE_PUBLISHABLE_KEY: "test-anon-key-not-real",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-not-real",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      STRIPE_SECRET_KEY: STRIPE_DUMMY_KEY,
      STRIPE_WEBHOOK_SECRET,
      OFFICE_DOCUMENT_REVIEW_KEY: OFFICE_KEY,
      OFFICE_DOCUMENT_REVIEW_SESSION_SECRET: OFFICE_SESSION_SECRET,
      PUBLIC_LEAD_ACCESS_SECRET: "test-only-public-lead-access-secret-for-automated-tests-32ch",
      // Dummy credentials so the email code paths run; nodemailer is mocked
      // by the preload, so nothing is ever sent.
      EMAIL_USER: "office-mailer@office-test.local",
      EMAIL_APP_PASSWORD: "dummy-app-password-not-real",
      CONTACT_EMAIL: "owner-alerts@office-test.local",
      TAX_WATCH_STRIPE_CHECKOUT_ENABLED: "",
      PINNACLE_STRIPE_CHECKOUT_ENABLED: "",
      MOCK_OUTBOUND_LOG: OUTBOUND_LOG
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});
  await waitForServer();
});

after(() => {
  if (server) server.kill();
  if (supabaseStub) supabaseStub.close();
  const remaining = readLeads().filter((lead) => !fixtureIds.has(lead.leadId));
  if (remaining.length !== readLeads().length) writeLeads(remaining);
  if (fs.existsSync(OUTBOUND_LOG)) fs.unlinkSync(OUTBOUND_LOG);
});

// =============================================================================
// A-C. Completion email
// =============================================================================

test("A. Anonymous completion-email request is denied before any side effect", async () => {
  const lead = completedContractor1099Lead();
  const { res, json } = await post("/api/contractor-1099-completion-email", { leadId: lead.leadId });

  assert.equal(res.status, 401);
  assert.equal(json.ok, false);
  assert.doesNotMatch(JSON.stringify(json), new RegExp(lead.contact.email.replace(/[.+]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(json), /Auth Test|missing|Contractor 1099 record/);
  assert.equal(emailsTo(lead.contact.email).length, 0);
  assert.equal(getLead(lead.leadId).contractor1099Work.completionEmailSentAt, undefined);
  assert.equal(getLead(lead.leadId).contractor1099Work.completionEmailStatus, undefined);
});

test("B. Unauthorized resend (anonymous or forged office cookie) is denied and changes nothing", async () => {
  const lead = completedContractor1099Lead({
    completionEmailSentAt: "2026-11-01T12:00:00.000Z",
    completionEmailStatus: "Sent",
    completionEmailResendCount: 0
  });

  for (const headers of [{}, { Cookie: FORGED_OFFICE_COOKIE }]) {
    const { res } = await post(
      "/api/contractor-1099-completion-email",
      { leadId: lead.leadId, resend: true },
      headers
    );
    assert.equal(res.status, 401);
  }

  assert.equal(emailsTo(lead.contact.email).length, 0);
  const work = getLead(lead.leadId).contractor1099Work;
  assert.equal(work.completionEmailResendCount, 0);
  assert.equal(work.completionEmailSentAt, "2026-11-01T12:00:00.000Z");
});

test("C. Authorized office completion email still works, including an explicit resend", async () => {
  const cookie = await officeCookie();
  const lead = completedContractor1099Lead();

  const first = await post("/api/contractor-1099-completion-email", { leadId: lead.leadId }, { Cookie: cookie });
  assert.equal(first.res.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.ok, true);

  let emails = emailsTo(lead.contact.email);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Your Contractor Forms 1099 Service Is Complete");
  let work = getLead(lead.leadId).contractor1099Work;
  assert.equal(work.completionEmailStatus, "Sent");
  assert.ok(work.completionEmailSentAt);

  // Repeating without resend is a no-op (existing behavior preserved).
  const repeat = await post("/api/contractor-1099-completion-email", { leadId: lead.leadId }, { Cookie: cookie });
  assert.equal(repeat.res.status, 200);
  assert.equal(repeat.json.alreadySent, true);
  assert.equal(emailsTo(lead.contact.email).length, 1);

  const resend = await post(
    "/api/contractor-1099-completion-email",
    { leadId: lead.leadId, resend: true },
    { Cookie: cookie }
  );
  assert.equal(resend.res.status, 200);
  emails = emailsTo(lead.contact.email);
  assert.equal(emails.length, 2);
  work = getLead(lead.leadId).contractor1099Work;
  assert.equal(work.completionEmailResendCount, 1);
});

test("C2. Office completion email still enforces the existing completion requirements", async () => {
  const cookie = await officeCookie();
  const lead = completedContractor1099Lead({ recipientCopyStatus: "Not Started" });
  const { res, json } = await post("/api/contractor-1099-completion-email", { leadId: lead.leadId }, { Cookie: cookie });
  assert.equal(res.status, 409);
  assert.ok(Array.isArray(json.missing));
  assert.equal(emailsTo(lead.contact.email).length, 0);
});

// =============================================================================
// D-I. Contractor 1099 checkout
// =============================================================================

test("D. Anonymous officeRequest checkout is denied: no Stripe session, no email, no lead change", async () => {
  const lead = contractor1099Lead();
  const before = JSON.stringify(getLead(lead.leadId));

  const { res, json } = await post("/api/create-contractor-1099-checkout", {
    leadId: lead.leadId,
    clientEmail: lead.contact.email,
    officeRequest: true
  });

  assert.equal(res.status, 401);
  assert.equal(json.ok, false);
  assert.equal(json.checkoutUrl, undefined);
  assert.equal(sessionsFor(lead.leadId).length, 0);
  assert.equal(emailsTo(lead.contact.email).length, 0);
  assert.equal(JSON.stringify(getLead(lead.leadId)), before);
});

test("E. officeRequest with a forged or missing office session creates nothing", async () => {
  const lead = contractor1099Lead();
  const before = JSON.stringify(getLead(lead.leadId));

  for (const headers of [{ Cookie: FORGED_OFFICE_COOKIE }, { Cookie: "tsp_office_document_review=" }]) {
    const { res } = await post(
      "/api/create-contractor-1099-checkout",
      { leadId: lead.leadId, clientEmail: lead.contact.email, officeRequest: true },
      headers
    );
    assert.equal(res.status, 401);
  }

  // Unknown lead + officeRequest is denied before lookup (no record probing).
  const probe = await post("/api/create-contractor-1099-checkout", {
    leadId: "C1099-DOES-NOT-EXIST",
    clientEmail: "nobody@example.test",
    officeRequest: true
  });
  assert.equal(probe.res.status, 401);

  assert.equal(sessionsFor(lead.leadId).length, 0);
  assert.equal(emailsTo(lead.contact.email).length, 0);
  assert.equal(JSON.stringify(getLead(lead.leadId)), before);
});

test("F. Customer self-service checkout still works with the reference and matching email", async () => {
  const lead = contractor1099Lead();

  const wrongEmail = await post("/api/create-contractor-1099-checkout", {
    leadId: lead.leadId,
    clientEmail: "someone-else@example.test"
  });
  assert.equal(wrongEmail.res.status, 400);
  assert.equal(sessionsFor(lead.leadId).length, 0);

  const { res, json } = await post("/api/create-contractor-1099-checkout", {
    leadId: lead.leadId,
    clientEmail: lead.contact.email.toUpperCase()
  });

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.match(json.checkoutUrl, /^https:\/\/checkout\.stripe\.test\/mock\//);

  const sessions = sessionsFor(lead.leadId);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].params.line_items[0].price_data.unit_amount, 20000);
  assert.equal(sessions[0].params.metadata.service, "contractor_1099");
  assert.equal(emailsTo(lead.contact.email).length, 0, "self-service never sends the office email");

  const work = getLead(lead.leadId).contractor1099Work;
  assert.equal(work.stripeCheckoutSessionId, sessions[0].session.id);
  assert.equal(work.paymentStatus, "Payment Link Created");
});

test("G. Authorized office payment-link workflow still creates the session and emails the client", async () => {
  const cookie = await officeCookie();
  const lead = contractor1099Lead();

  const { res, json } = await post(
    "/api/create-contractor-1099-checkout",
    { leadId: lead.leadId, clientEmail: lead.contact.email, officeRequest: true },
    { Cookie: cookie }
  );

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.emailSent, true);
  assert.equal(sessionsFor(lead.leadId).length, 1);

  const emails = emailsTo(lead.contact.email);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Your Secure Contractor 1099 Service Payment Link");
  assert.match(emails[0].text, /checkout\.stripe\.test\/mock\//);
});

test("H. Server-side pricing cannot be overridden from the request body", async () => {
  const cookie = await officeCookie();
  const lead = contractor1099Lead();

  for (const [headers, extra] of [
    [{}, {}],
    [{ Cookie: cookie }, { officeRequest: true }]
  ]) {
    const { res } = await post(
      "/api/create-contractor-1099-checkout",
      {
        leadId: lead.leadId,
        clientEmail: lead.contact.email,
        amountCents: 1,
        unit_amount: 1,
        paymentRequestAmountCents: 1,
        quotedFeeCents: 1,
        amount: 0.01,
        ...extra
      },
      headers
    );
    assert.equal(res.status, 200);
  }

  for (const session of sessionsFor(lead.leadId)) {
    assert.equal(session.params.line_items[0].price_data.unit_amount, 20000);
    assert.equal(session.params.metadata.quotedFeeCents, "45000");
  }
});

test("I. Duplicate-payment protections remain intact (overpayment refused; webhook replay counted once)", async () => {
  const paidInFull = contractor1099Lead({ amountPaidCents: 45000 });
  const full = await post("/api/create-contractor-1099-checkout", {
    leadId: paidInFull.leadId,
    clientEmail: paidInFull.contact.email
  });
  assert.equal(full.res.status, 400);
  assert.equal(sessionsFor(paidInFull.leadId).length, 0);

  const overBalance = contractor1099Lead({ amountPaidCents: 40000, paymentRequestAmountCents: 20000 });
  const over = await post("/api/create-contractor-1099-checkout", {
    leadId: overBalance.leadId,
    clientEmail: overBalance.contact.email
  });
  assert.equal(over.res.status, 400);
  assert.equal(sessionsFor(overBalance.leadId).length, 0);

  // Stripe webhook replay of the same paid Checkout Session.
  const lead = contractor1099Lead();
  const stripe = Stripe(STRIPE_DUMMY_KEY);
  const sessionId = `cs_test_replay_${Date.now()}`;
  const payload = JSON.stringify({
    id: `evt_test_replay_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 20000,
        payment_intent: `pi_test_replay_${Date.now()}`,
        client_reference_id: lead.leadId,
        livemode: false,
        metadata: { service: "contractor_1099", leadId: lead.leadId }
      }
    }
  });

  for (let i = 0; i < 2; i += 1) {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/stripe-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": stripe.webhooks.generateTestHeaderString({
          payload,
          secret: STRIPE_WEBHOOK_SECRET
        })
      },
      body: payload
    });
    assert.equal(res.status, 200);
  }

  const work = getLead(lead.leadId).contractor1099Work;
  assert.equal(work.amountPaidCents, 20000, "replayed payment is counted once");
  assert.equal(
    (work.processedStripeSessions || []).filter((id) => id === sessionId).length,
    1
  );
});

// =============================================================================
// J. Related: Tax Preparation checkout
// =============================================================================

test("J. Tax Preparation checkout: officeRequest needs an office session; customer and office flows still work", async () => {
  const lead = taxPreparationLead();
  const before = JSON.stringify(getLead(lead.leadId));

  for (const headers of [{}, { Cookie: FORGED_OFFICE_COOKIE }]) {
    const denied = await post(
      "/api/create-tax-preparation-checkout",
      { leadId: lead.leadId, clientEmail: lead.contact.email, officeRequest: true },
      headers
    );
    assert.equal(denied.res.status, 401);
  }
  assert.equal(sessionsFor(lead.leadId).length, 0);
  assert.equal(emailsTo(lead.contact.email).length, 0);
  assert.equal(JSON.stringify(getLead(lead.leadId)), before);

  const customer = await post("/api/create-tax-preparation-checkout", {
    leadId: lead.leadId,
    clientEmail: lead.contact.email,
    amountCents: 1
  });
  assert.equal(customer.res.status, 200);
  assert.equal(sessionsFor(lead.leadId).length, 1);
  assert.equal(sessionsFor(lead.leadId)[0].params.line_items[0].price_data.unit_amount, 30000);
  assert.equal(emailsTo(lead.contact.email).length, 0);

  const cookie = await officeCookie();
  const office = await post(
    "/api/create-tax-preparation-checkout",
    { leadId: lead.leadId, clientEmail: lead.contact.email, officeRequest: true },
    { Cookie: cookie }
  );
  assert.equal(office.res.status, 200);
  assert.equal(office.json.emailSent, true);
  assert.equal(sessionsFor(lead.leadId).length, 2);
  assert.equal(emailsTo(lead.contact.email).length, 1);
});

// =============================================================================
// K. Related: Tax Extension checkout (POST /api/create-extension-checkout)
// =============================================================================

function extensionLead(requestOverrides = {}) {
  const leadId = uniqueId("EXT");
  const email = `${leadId.toLowerCase()}@example.test`;
  return insertLead({
    leadId,
    timestamp: new Date().toISOString(),
    status: "Tax Extension - Payment Pending",
    contact: { name: "Auth Test Extension", email, phone: "(555) 555-0172" },
    extensionRequest: {
      serviceType: "individual",
      stateExtensionRequested: false,
      serviceTier: "individual_federal",
      totalPriceCents: 15000,
      checkoutEligible: true,
      deadlineReviewRequired: false,
      quoteNeeded: false,
      paymentStatus: "Payment Pending",
      ...requestOverrides
    }
  });
}

test("K1. Extension checkout: anonymous or forged officeRequest is denied with no session, email, or lead change", async () => {
  const lead = extensionLead();
  const before = JSON.stringify(getLead(lead.leadId));

  for (const headers of [{}, { Cookie: FORGED_OFFICE_COOKIE }, { Cookie: "tsp_office_document_review=" }]) {
    const { res, json } = await post(
      "/api/create-extension-checkout",
      { leadId: lead.leadId, clientEmail: lead.contact.email, officeRequest: true },
      headers
    );
    assert.equal(res.status, 401);
    assert.equal(json.ok, false);
    assert.equal(json.checkoutUrl, undefined);
  }

  assert.equal(sessionsFor(lead.leadId).length, 0);
  assert.equal(emailsTo(lead.contact.email).length, 0);
  assert.equal(JSON.stringify(getLead(lead.leadId)), before);
});

test("K2. Extension checkout: customer self-service still works (as used by the extension request page)", async () => {
  const lead = extensionLead();

  const wrongEmail = await post("/api/create-extension-checkout", {
    leadId: lead.leadId,
    clientEmail: "someone-else@example.test"
  });
  assert.equal(wrongEmail.res.status, 400);
  assert.equal(sessionsFor(lead.leadId).length, 0);

  const { res, json } = await post("/api/create-extension-checkout", {
    leadId: lead.leadId,
    clientEmail: lead.contact.email
  });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.ok, true);
  assert.match(json.checkoutUrl, /^https:\/\/checkout\.stripe\.test\/mock\//);

  const sessions = sessionsFor(lead.leadId);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].params.line_items[0].price_data.unit_amount, 15000);
  assert.equal(emailsTo(lead.contact.email).length, 0, "self-service never sends the office email");
  assert.equal(getLead(lead.leadId).extensionRequest.stripeCheckoutSessionId, sessions[0].session.id);
});

test("K3. Extension checkout: authenticated office checkout still creates the session and emails the client", async () => {
  const cookie = await officeCookie();
  const lead = extensionLead();

  const { res, json } = await post(
    "/api/create-extension-checkout",
    { leadId: lead.leadId, clientEmail: lead.contact.email, officeRequest: true },
    { Cookie: cookie }
  );
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.emailSent, true);
  assert.equal(sessionsFor(lead.leadId).length, 1);

  const emails = emailsTo(lead.contact.email);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Your Secure Tax Extension Payment Link");
});

test("K4. Extension checkout: client-supplied prices never override the saved service price", async () => {
  const cookie = await officeCookie();
  const lead = extensionLead();

  for (const [headers, extra] of [
    [{}, {}],
    [{ Cookie: cookie }, { officeRequest: true }]
  ]) {
    const { res } = await post(
      "/api/create-extension-checkout",
      {
        leadId: lead.leadId,
        clientEmail: lead.contact.email,
        totalPriceCents: 1,
        amount: 1,
        unit_amount: 1,
        serviceTier: "business_federal_state",
        ...extra
      },
      headers
    );
    assert.equal(res.status, 200);
  }
  for (const session of sessionsFor(lead.leadId)) {
    assert.equal(session.params.line_items[0].price_data.unit_amount, 15000);
  }

  // A tampered saved price that does not match the service tier is refused.
  const tampered = extensionLead({ totalPriceCents: 100 });
  const refused = await post("/api/create-extension-checkout", {
    leadId: tampered.leadId,
    clientEmail: tampered.contact.email
  });
  assert.equal(refused.res.status, 400);
  assert.equal(sessionsFor(tampered.leadId).length, 0);

  // Already-paid requests are not charged again.
  const paid = extensionLead({ paymentStatus: "Paid / Verified" });
  const again = await post("/api/create-extension-checkout", {
    leadId: paid.leadId,
    clientEmail: paid.contact.email
  });
  assert.equal(again.res.status, 409);
  assert.equal(sessionsFor(paid.leadId).length, 0);
});
