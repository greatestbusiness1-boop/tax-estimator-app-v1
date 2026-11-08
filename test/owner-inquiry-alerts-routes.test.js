"use strict";

// Integration tests: owner inquiry alerts through the real server routes.
//
// Two local servers (never production) with:
//   - a Supabase stand-in that answers instantly with HTTP 500, so leads use
//     the local leads.json fallback (no 7s postgrest-js retry delays);
//   - the local JSON email transport (EMAIL_USER/EMAIL_APP_PASSWORD empty),
//     so no real email is ever sent;
//   - server B additionally simulates an SMTP failure for the owner
//     recipient via LOCAL_TEST_EMAIL_FAIL_RECIPIENTS (local-only switch).
//
// Every lead created here is removed from leads.json afterwards.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET =
  "test-only-office-session-secret-automated-tests-32chars-min";
const PUBLIC_LEAD_ACCESS_SECRET =
  "test-only-public-lead-access-secret-for-automated-tests-32ch";

const OK_PORT = 3955;
const FAIL_PORT = 3956;
const PROD_PORT = 3957;
const OWNER_OK = "owner-alerts@office-test.local";
const OWNER_FAIL = "owner-alerts-fail@office-test.local";

const createdLeadIds = new Set();
let supabaseStub;
let okServer;
let failServer;
let prodServer;

function startSupabaseStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "TEST_STUB", message: "Supabase intentionally unavailable." }));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function startServer(port, ownerEmail, extraEnv = {}) {
  const stubUrl = `http://127.0.0.1:${supabaseStub.address().port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "",
      RENDER: "",
      SUPABASE_URL: stubUrl,
      NEXT_PUBLIC_SUPABASE_URL: stubUrl,
      SUPABASE_PUBLISHABLE_KEY: "test-anon-key-not-real",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-not-real",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      STRIPE_SECRET_KEY: "sk_test_dummy_key_constructed_only_never_used_for_a_real_api_call",
      STRIPE_WEBHOOK_SECRET: "whsec_test_only_dummy_secret_for_automated_tests",
      OFFICE_DOCUMENT_REVIEW_KEY: OFFICE_KEY,
      OFFICE_DOCUMENT_REVIEW_SESSION_SECRET: OFFICE_SESSION_SECRET,
      PUBLIC_LEAD_ACCESS_SECRET,
      EMAIL_USER: "",
      EMAIL_APP_PASSWORD: "",
      CONTACT_EMAIL: ownerEmail,
      OWNER_ALERT_EMAIL: "",
      OWNER_ALERT_TEST_EMAILS: "",
      LOCAL_TEST_EMAIL_FAIL_RECIPIENTS: "",
      TAX_WATCH_STRIPE_CHECKOUT_ENABLED: "",
      PINNACLE_STRIPE_CHECKOUT_ENABLED: "",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server on port ${port} did not become ready`);
}

async function waitFor(check, timeoutMs = 8000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return last;
}

async function officeCookie(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/office-document-review/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey: OFFICE_KEY })
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie, "office sign-in must return a cookie");
  return cookie;
}

async function postJson(port, pathname, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
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

async function officeLeads(port, cookie) {
  const res = await fetch(`http://127.0.0.1:${port}/api/leads?includeLocal=1`, {
    headers: { Cookie: cookie }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  return body.leads || [];
}

async function findLead(port, cookie, leadId) {
  const leads = await officeLeads(port, cookie);
  return leads.find((lead) => lead.leadId === leadId) || null;
}

async function ownerEmailsFor(port, leadId) {
  const res = await fetch(`http://127.0.0.1:${port}/api/dev/sent-test-emails`);
  const body = await res.json();
  return (body.emails || []).filter(
    (entry) =>
      [OWNER_OK, OWNER_FAIL].includes(String(entry.to || "").toLowerCase()) &&
      `${entry.subject}\n${entry.text}`.includes(leadId)
  );
}

function uniqueCustomerEmail(tag) {
  return `alerts-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@customer-mail.net`;
}

function contactBody(email, overrides = {}) {
  return {
    name: "Alert Route Test",
    email,
    phone: "(555) 555-0142",
    service: "Contractor Forms 1099",
    preferredContact: "Email",
    message: "PRIVATE-CUSTOMER-MESSAGE I need 1099s for my contractors.",
    ...overrides
  };
}

function leadAccessToken(leadId) {
  return crypto
    .createHmac("sha256", PUBLIC_LEAD_ACCESS_SECRET)
    .update(String(leadId))
    .digest("base64url");
}

before(async () => {
  supabaseStub = await startSupabaseStub();
  okServer = startServer(OK_PORT, OWNER_OK);
  failServer = startServer(FAIL_PORT, OWNER_FAIL, {
    LOCAL_TEST_EMAIL_FAIL_RECIPIENTS: OWNER_FAIL
  });
  // Production-mode server: Supabase is the authoritative store and must
  // never fall back to Render's temporary disk.
  prodServer = startServer(PROD_PORT, OWNER_OK, { NODE_ENV: "production", RENDER: "1" });
  await Promise.all([
    waitForServer(OK_PORT),
    waitForServer(FAIL_PORT),
    waitForServer(PROD_PORT)
  ]);
});

after(() => {
  if (okServer) okServer.kill();
  if (failServer) failServer.kill();
  if (prodServer) prodServer.kill();
  if (supabaseStub) supabaseStub.close();

  if (fs.existsSync(LEADS_FILE) && createdLeadIds.size) {
    const raw = fs.readFileSync(LEADS_FILE, "utf8").trim();
    const leads = raw ? JSON.parse(raw) : [];
    const remaining = leads.filter((lead) => !createdLeadIds.has(lead.leadId));
    if (remaining.length !== leads.length) {
      fs.writeFileSync(LEADS_FILE, JSON.stringify(remaining, null, 2), "utf8");
    }
  }
});

// =============================================================================

test("1. Contact request (Contractor Forms 1099): lead saved, owner alerted, state 'sent' visible to the office", async () => {
  const email = uniqueCustomerEmail("contact");
  const { res, json } = await postJson(OK_PORT, "/api/contact-request", contactBody(email));

  assert.equal(res.status, 201);
  assert.equal(json.ok, true);
  assert.match(json.leadId, /^CONTACT-/);
  assert.equal(json.notificationSent, true);
  createdLeadIds.add(json.leadId);

  const cookie = await officeCookie(OK_PORT);
  const lead = await findLead(OK_PORT, cookie, json.leadId);
  assert.ok(lead, "lead must be visible in the Tax Lead Center data");
  assert.equal(lead.contactRequest.service, "Contractor Forms 1099");
  assert.equal(lead.ownerAlerts["contact-request"].status, "sent");
  assert.equal(lead.ownerAlerts["contact-request"].attempts, 1);

  const ownerEmails = await ownerEmailsFor(OK_PORT, json.leadId);
  assert.equal(ownerEmails.length, 1);
  assert.equal(ownerEmails[0].subject, "New Contact Request - Contractor Forms 1099");
});

test("2. Free estimate (/api/lead): owner alert delivered in the background and recorded", async () => {
  const email = uniqueCustomerEmail("estimate");
  const { res, json } = await postJson(OK_PORT, "/api/lead", {
    name: "Alert Estimate Test",
    email,
    phone: "(555) 555-0143",
    estimate: { totalTax: 0 }
  });
  assert.equal(res.status, 201);
  const leadId = json.leadId || json.lead?.leadId;
  assert.ok(leadId);
  createdLeadIds.add(leadId);

  const cookie = await officeCookie(OK_PORT);
  const lead = await waitFor(async () => {
    const found = await findLead(OK_PORT, cookie, leadId);
    return found?.ownerAlerts?.["free-estimate"]?.status === "sent" ? found : null;
  });
  assert.ok(lead, "free estimate alert must reach 'sent'");
  assert.equal((await ownerEmailsFor(OK_PORT, leadId)).length, 1);
});

test("3. Customer transcript help request on an existing lead (public PATCH) alerts the owner once", async () => {
  const email = uniqueCustomerEmail("transcript");
  const created = await postJson(OK_PORT, "/api/lead", {
    name: "Alert Transcript Test",
    email,
    phone: "(555) 555-0144",
    estimate: { totalTax: 0 }
  });
  const leadId = created.json.leadId || created.json.lead?.leadId;
  createdLeadIds.add(leadId);

  const cookie = await officeCookie(OK_PORT);
  // Let the free-estimate alert settle so the two local writes never overlap.
  await waitFor(async () => {
    const found = await findLead(OK_PORT, cookie, leadId);
    return found?.ownerAlerts?.["free-estimate"]?.status === "sent";
  });

  const patch = (requestedAt) =>
    fetch(`http://127.0.0.1:${OK_PORT}/api/leads/${encodeURIComponent(leadId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Lead-Access-Token": leadAccessToken(leadId)
      },
      body: JSON.stringify({
        status: "Transcript Help - Payment Pending",
        transcriptRequest: { requested: true, requestedAt, taxYears: ["2025"] }
      })
    });

  const first = await patch(new Date().toISOString());
  assert.equal(first.status, 200);

  const lead = await waitFor(async () => {
    const found = await findLead(OK_PORT, cookie, leadId);
    return found?.ownerAlerts?.["transcript-help-request"]?.status === "sent" ? found : null;
  });
  assert.ok(lead, "transcript help alert must reach 'sent'");

  // The customer saving the same request again does not re-alert.
  const second = await patch(new Date().toISOString());
  assert.equal(second.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 600));

  const transcriptAlerts = (await ownerEmailsFor(OK_PORT, leadId)).filter((entry) =>
    entry.subject.includes("IRS Transcript Help Request")
  );
  assert.equal(transcriptAlerts.length, 1);
});

test("4. Duplicate submission: a rapid identical resubmission is saved but not re-alerted", async () => {
  const email = uniqueCustomerEmail("dup");
  const first = await postJson(OK_PORT, "/api/contact-request", contactBody(email));
  const second = await postJson(OK_PORT, "/api/contact-request", contactBody(email));
  assert.equal(first.res.status, 201);
  assert.equal(second.res.status, 201);
  assert.notEqual(first.json.leadId, second.json.leadId);
  createdLeadIds.add(first.json.leadId);
  createdLeadIds.add(second.json.leadId);

  const cookie = await officeCookie(OK_PORT);
  const secondLead = await findLead(OK_PORT, cookie, second.json.leadId);
  assert.ok(secondLead, "duplicate submission is still saved and visible");
  assert.equal(secondLead.ownerAlerts["contact-request"].status, "duplicate");
  assert.equal(secondLead.ownerAlerts["contact-request"].duplicateOf, first.json.leadId);
  assert.equal((await ownerEmailsFor(OK_PORT, second.json.leadId)).length, 0);
});

test("5. Test submission (reserved test domain) is saved but never alerts the owner", async () => {
  const email = `alerts-qa-${Date.now()}@example.test`;
  const { res, json } = await postJson(OK_PORT, "/api/contact-request", contactBody(email));
  assert.equal(res.status, 201);
  createdLeadIds.add(json.leadId);

  const cookie = await officeCookie(OK_PORT);
  const lead = await findLead(OK_PORT, cookie, json.leadId);
  assert.equal(lead.ownerAlerts["contact-request"].status, "suppressed");
  assert.equal((await ownerEmailsFor(OK_PORT, json.leadId)).length, 0);
});

test("6. Email transport failure after persistence: lead saved, customer told success, failure visible to the office", async () => {
  const email = uniqueCustomerEmail("fail");
  const { res, json } = await postJson(FAIL_PORT, "/api/contact-request", contactBody(email));

  assert.equal(res.status, 201, "customer submission still succeeds");
  assert.equal(json.ok, true);
  assert.equal(json.notificationSent, false);
  createdLeadIds.add(json.leadId);

  const cookie = await officeCookie(FAIL_PORT);
  const lead = await findLead(FAIL_PORT, cookie, json.leadId);
  assert.ok(lead, "lead is persisted even though the alert failed");
  const state = lead.ownerAlerts["contact-request"];
  assert.equal(state.status, "retrying");
  assert.equal(state.attempts, 2);
  assert.equal(state.lastError, "ECONNECTION");
  assert.ok(state.nextAttemptAt);

  // Privacy: alert state never stores the message body or addresses.
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /PRIVATE-CUSTOMER-MESSAGE/);
  assert.doesNotMatch(serialized, /@/);
});

test("7. Office retry is authenticated, bounded, and records each attempt", async () => {
  const email = uniqueCustomerEmail("retry");
  const { json } = await postJson(FAIL_PORT, "/api/contact-request", contactBody(email));
  createdLeadIds.add(json.leadId);

  const unauthenticated = await postJson(FAIL_PORT, "/api/owner-alerts/retry", { leadId: json.leadId });
  assert.equal(unauthenticated.res.status, 401);

  const invalid = await postJson(
    FAIL_PORT,
    "/api/owner-alerts/retry",
    { leadId: "../../etc/passwd" },
    { Cookie: await officeCookie(FAIL_PORT) }
  );
  assert.equal(invalid.res.status, 400);

  const cookie = await officeCookie(FAIL_PORT);
  const retry = await postJson(FAIL_PORT, "/api/owner-alerts/retry", { leadId: json.leadId }, { Cookie: cookie });
  assert.equal(retry.res.status, 200);
  assert.equal(retry.json.summary.attempted, 1);
  assert.equal(retry.json.summary.stillFailing, 1);
  assert.equal(retry.json.summary.sent, 0);

  const lead = await findLead(FAIL_PORT, cookie, json.leadId);
  assert.equal(lead.ownerAlerts["contact-request"].attempts, 3);
  assert.equal(lead.ownerAlerts["contact-request"].status, "retrying");
});

test("8. Lead data, including alert state, stays office-only", async () => {
  const res = await fetch(`http://127.0.0.1:${OK_PORT}/api/leads?includeLocal=1`);
  assert.equal(res.status, 401);
});

// =============================================================================
// Homepage IRS Transcript Help (POST /api/transcript-help)
// =============================================================================

function transcriptBody(email, overrides = {}) {
  return {
    clientName: "Transcript Route Test",
    clientEmail: email,
    clientPhone: "5555550150",
    taxYear: "2025",
    multipleYears: "",
    issueType: "IRS notice or letter",
    transcriptType: "Account Transcript",
    clientExplanation: "PRIVATE-TRANSCRIPT-DETAIL I received an IRS notice.",
    ...overrides
  };
}

function readLocalLeadIds() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  const raw = fs.readFileSync(LEADS_FILE, "utf8").trim();
  return (raw ? JSON.parse(raw) : []).map((lead) => lead.leadId);
}

test("9. Homepage transcript form: request saved as a transcript lead and the owner is alerted", async () => {
  const email = uniqueCustomerEmail("transcript-home");
  const { res, json } = await postJson(OK_PORT, "/api/transcript-help", transcriptBody(email));

  assert.equal(res.status, 201);
  assert.equal(json.ok, true);
  assert.match(json.leadId, /^TRANSCRIPT-\d+-[0-9A-F]{6}$/);
  createdLeadIds.add(json.leadId);

  const cookie = await officeCookie(OK_PORT);
  const lead = await waitFor(async () => {
    const found = await findLead(OK_PORT, cookie, json.leadId);
    return found?.ownerAlerts?.["transcript-help-request"]?.status === "sent" ? found : null;
  });
  assert.ok(lead, "transcript lead visible with a delivered owner alert");

  // Same shape the Transcript Requests work center already recognizes.
  assert.equal(lead.status, "Transcript Help - Payment Pending");
  assert.equal(lead.transcriptRequest.requested, true);
  assert.equal(lead.transcriptRequest.paymentStatus, "Need Payment");
  assert.deepEqual(lead.transcriptRequest.taxYears, ["2025"]);
  assert.equal(lead.contact.phone, "(555) 555-0150");
  assert.equal(lead.contact.email, email.toLowerCase());

  const ownerEmails = await ownerEmailsFor(OK_PORT, json.leadId);
  assert.equal(ownerEmails.length, 1);
  assert.match(ownerEmails[0].subject, /IRS Transcript Help Request/);
  // Privacy-minimal alert: the customer explanation stays in the dashboard.
  assert.doesNotMatch(ownerEmails[0].text, /PRIVATE-TRANSCRIPT-DETAIL/);
});

test("10. Homepage transcript form: validation rejects incomplete requests and saves nothing", async () => {
  const before = readLocalLeadIds().length;
  const email = uniqueCustomerEmail("transcript-invalid");

  for (const overrides of [
    { clientName: "" },
    { clientEmail: "not-an-email" },
    { clientPhone: "" },
    { taxYear: "" },
    { issueType: "" },
    { clientExplanation: "" },
    { taxYear: "Multiple Years", multipleYears: "" }
  ]) {
    const { res, json } = await postJson(OK_PORT, "/api/transcript-help", transcriptBody(email, overrides));
    assert.equal(res.status, 400, JSON.stringify(overrides));
    assert.equal(json.ok, false);
    assert.ok(json.error);
  }

  assert.equal(readLocalLeadIds().length, before, "no lead created for invalid input");
});

test("11. Homepage transcript form: multiple years are recorded; oversized input is bounded", async () => {
  const email = uniqueCustomerEmail("transcript-multi");
  const { res, json } = await postJson(
    OK_PORT,
    "/api/transcript-help",
    transcriptBody(email, {
      taxYear: "Multiple Years",
      multipleYears: "2022, 2023 2024",
      clientExplanation: "x".repeat(10000)
    })
  );
  assert.equal(res.status, 201);
  createdLeadIds.add(json.leadId);

  const cookie = await officeCookie(OK_PORT);
  const lead = await findLead(OK_PORT, cookie, json.leadId);
  assert.deepEqual(lead.transcriptRequest.taxYears, ["2022", "2023", "2024"]);
  assert.equal(lead.transcriptRequest.clientIssue.length, 4000);
});

test("12. Homepage transcript form: alert failure is retried and visible; the request is still saved", async () => {
  const email = uniqueCustomerEmail("transcript-fail");
  const { res, json } = await postJson(FAIL_PORT, "/api/transcript-help", transcriptBody(email));
  assert.equal(res.status, 201);
  createdLeadIds.add(json.leadId);

  const cookie = await officeCookie(FAIL_PORT);
  const lead = await waitFor(async () => {
    const found = await findLead(FAIL_PORT, cookie, json.leadId);
    return found?.ownerAlerts?.["transcript-help-request"]?.status === "retrying" ? found : null;
  });
  assert.ok(lead, "failed alert is recorded as retrying");
  assert.equal(lead.ownerAlerts["transcript-help-request"].lastError, "ECONNECTION");

  const retry = await postJson(FAIL_PORT, "/api/owner-alerts/retry", { leadId: json.leadId }, { Cookie: cookie });
  assert.equal(retry.res.status, 200);
  assert.equal(retry.json.summary.attempted, 1);
  const after = await findLead(FAIL_PORT, cookie, json.leadId);
  assert.equal(after.ownerAlerts["transcript-help-request"].attempts, 3);
});

test("13. Production database failure: the transcript request fails closed (503) with no local write and no alert", async () => {
  const before = readLocalLeadIds();
  const email = uniqueCustomerEmail("transcript-prod");
  const { res, json } = await postJson(PROD_PORT, "/api/transcript-help", transcriptBody(email));

  assert.equal(res.status, 503);
  assert.equal(json.ok, false);
  assert.equal(json.retryable, true);
  assert.deepEqual(readLocalLeadIds(), before, "never written to the temporary local file");

  const sent = await fetch(`http://127.0.0.1:${PROD_PORT}/api/dev/sent-test-emails`);
  const body = await sent.json();
  const alerts = (body.emails || []).filter((entry) => String(entry.text || "").includes(email));
  assert.equal(alerts.length, 0);
});

test("14. The damaged /api/-help route no longer exists", async () => {
  const { res } = await postJson(OK_PORT, "/api/-help", transcriptBody(uniqueCustomerEmail("old")));
  assert.equal(res.status, 404);
});
