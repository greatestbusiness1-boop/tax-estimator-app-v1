"use strict";

// Regression coverage for the Tax Lead Center lead-loading behavior
// (ui/leads-dashboard.html).
//
// Incident: a website Contact Request (CONTACT-...) for "Contractor Forms 1099"
// generated an email notification, but the dashboard showed "0 leads". The
// dashboard's loadLeads() treated any failed /api/leads response (expired
// office sign-in, server error, network failure) as an empty lead list.
//
// These tests run the real dashboard functions (extracted from the HTML) in a
// vm sandbox with a minimal DOM stub. No server, database, or email is used.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const LEADS_DASHBOARD_FILE = path.join(
  __dirname,
  "..",
  "ui",
  "leads-dashboard.html"
);
const SOURCE = fs.readFileSync(LEADS_DASHBOARD_FILE, "utf8");

function extractFunctionSource(source, functionName) {
  const declPattern = new RegExp(
    `(?:async\\s+)?function\\s+${functionName}\\s*\\(`
  );
  const match = declPattern.exec(source);
  assert.ok(match, `function ${functionName} must exist in leads-dashboard.html`);

  let parenDepth = 1;
  let i = match.index + match[0].length;
  for (; i < source.length && parenDepth > 0; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    if (source[i] === ")") parenDepth -= 1;
  }

  const openBraceIndex = source.indexOf("{", i);
  let depth = 0;
  for (let j = openBraceIndex; j < source.length; j += 1) {
    if (source[j] === "{") depth += 1;
    if (source[j] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, j + 1);
    }
  }

  throw new Error(`Could not find end of function ${functionName}`);
}

function extractConstSource(source, constName) {
  const match = new RegExp(`const\\s+${constName}\\s*=[\\s\\S]*?;`).exec(source);
  assert.ok(match, `const ${constName} must exist in leads-dashboard.html`);
  return match[0];
}

// -----------------------------------------------------------------------------
// Minimal DOM stub
// -----------------------------------------------------------------------------

function makeElement(id) {
  return {
    id,
    hidden: false,
    innerHTML: "",
    innerText: "",
    textContent: "",
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
}

function makeDocument() {
  const elements = {
    leadsLoadStatus: makeElement("leadsLoadStatus"),
    ownerAlertStatus: makeElement("ownerAlertStatus"),
    leadCount: makeElement("leadCount"),
    leadList: makeElement("leadList"),
    contractor1099RequestsSidebarCount: makeElement(
      "contractor1099RequestsSidebarCount"
    ),
    transcriptRequestsSidebarCount: makeElement("transcriptRequestsSidebarCount")
  };
  elements.leadsLoadStatus.hidden = true;
  elements.contractor1099RequestsSidebarCount.textContent = "0";
  elements.transcriptRequestsSidebarCount.textContent = "0";

  return {
    elements,
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[id$="SidebarCount"]') {
        return Object.values(elements).filter((el) =>
          el.id.endsWith("SidebarCount")
        );
      }
      return [];
    }
  };
}

// -----------------------------------------------------------------------------
// Sandbox loaders
// -----------------------------------------------------------------------------

const LOAD_FUNCTIONS = [
  "escapeOfficeHtml",
  "interpretLeadsApiResponse",
  "fetchLeadsResult",
  "renderLeadsLoadStatus",
  "renderLeadsUnavailable",
  "loadLeads",
  "renderLeads",
  "getUnresolvedOwnerAlerts",
  "describeOwnerAlertStatus",
  "renderOwnerAlertStatus"
];

function loadDashboardSandbox(fetchImpl) {
  const document = makeDocument();
  const calls = [];
  const consoleErrors = [];

  const sandbox = {
    document,
    window: { fetch: fetchImpl },
    console: {
      log() {},
      error(...args) {
        consoleErrors.push(args.join(" "));
      }
    },
    encodeURIComponent,
    calls,
    consoleErrors
  };

  // Stubs for the successful-path work loadLeads() performs. renderLeads is
  // the real function so its new "never loaded" guard is exercised; once the
  // list has loaded, the guard passes and these spies record the render.
  [
    "populateAllLeadFilters",
    "populateTaxPrepAdvancedFilters",
    "populateContactAdvancedFilters",
    "populateClosedYearFilter",
    "updateExtensionRequestCounts",
    "updateContractor1099Counts",
    "updateTranscriptSidebarCount",
    "updateTaxPrepRequestCounts",
    "updateMembershipEnrollmentCounts",
    "updateInstallmentAgreementCounts"
  ].forEach((name) => {
    sandbox[name] = () => calls.push(name);
  });

  vm.createContext(sandbox);

  // Only the first part of the real renderLeads (the guard and its sidebar
  // updates) is needed; stop it before view rendering by stubbing
  // getVisibleLeads to throw a sentinel after recording the call.
  sandbox.getVisibleLeads = () => {
    calls.push("getVisibleLeads");
    throw new Error("render-sentinel");
  };

  const script = [
    "var allLeads = [];",
    "var leadsLoadState = { status: 'loading', loadedOnce: false, lastSuccessAt: '', error: null };",
    extractConstSource(SOURCE, "LEADS_SIGN_IN_URL"),
    extractConstSource(SOURCE, "OWNER_ALERT_PENDING_GRACE_MS"),
    ...LOAD_FUNCTIONS.map((name) => extractFunctionSource(SOURCE, name)),
    "this.LEADS_SIGN_IN_URL = LEADS_SIGN_IN_URL;"
  ].join("\n");

  vm.runInContext(script, sandbox);
  return sandbox;
}

function jsonResponse(status, body) {
  return async () => ({
    status,
    async json() {
      return body;
    }
  });
}

function htmlResponse(status) {
  return async () => ({
    status,
    async json() {
      throw new SyntaxError("Unexpected token < in JSON");
    }
  });
}

function sequenceFetch(...responders) {
  let index = 0;
  return async (...args) => {
    const responder = responders[Math.min(index, responders.length - 1)];
    index += 1;
    return responder(...args);
  };
}

const GABRIEL_STYLE_CONTACT_LEAD = {
  leadId: "CONTACT-1794019105793-TEST1",
  timestamp: "2026-11-07T02:38:25.793Z",
  status: "Contact Request - New",
  contact: { name: "Test Client", email: "test@example.com", phone: "Not provided" },
  contactRequest: {
    service: "Contractor Forms 1099",
    preferredContact: "Email",
    message: "I need help filing 1099s for my contractors.",
    submittedAt: "2026-11-07T02:38:25.793Z"
  },
  Request: {
    type: "Contact Request",
    service: "Contractor Forms 1099",
    preferredContact: "Email",
    message: "I need help filing 1099s for my contractors."
  }
};

// =============================================================================
// interpretLeadsApiResponse
// =============================================================================

test("interpretLeadsApiResponse: 401 and 403 are sign-in failures, not empty lists", () => {
  const sandbox = loadDashboardSandbox(jsonResponse(200, {}));
  for (const status of [401, 403]) {
    const result = sandbox.interpretLeadsApiResponse(status, {
      ok: false,
      error: "Secure office document review sign-in is required."
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "auth");
    assert.equal(result.leads, undefined);
  }
});

test("interpretLeadsApiResponse: 5xx is a server error even if a leads array is present", () => {
  const sandbox = loadDashboardSandbox(jsonResponse(200, {}));
  const result = sandbox.interpretLeadsApiResponse(500, { ok: true, leads: [] });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "server");
  assert.match(result.message, /HTTP 500/);
});

test("interpretLeadsApiResponse: malformed 200 responses are rejected", () => {
  const sandbox = loadDashboardSandbox(jsonResponse(200, {}));
  for (const body of [null, {}, { ok: true }, { ok: false, leads: [] }, { ok: true, leads: "x" }]) {
    const result = sandbox.interpretLeadsApiResponse(200, body);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.kind, "malformed");
  }
});

test("interpretLeadsApiResponse: confirmed success returns the leads array, including an empty one", () => {
  const sandbox = loadDashboardSandbox(jsonResponse(200, {}));
  const empty = sandbox.interpretLeadsApiResponse(200, { ok: true, leads: [] });
  assert.equal(empty.ok, true);
  assert.equal(empty.leads.length, 0);

  const populated = sandbox.interpretLeadsApiResponse(200, {
    ok: true,
    leads: [GABRIEL_STYLE_CONTACT_LEAD]
  });
  assert.equal(populated.ok, true);
  assert.equal(populated.leads.length, 1);
});

// =============================================================================
// loadLeads end-to-end (sandboxed)
// =============================================================================

test("loadLeads: expired session shows a sign-in error and never renders 0 leads", async () => {
  const sandbox = loadDashboardSandbox(
    jsonResponse(401, { ok: false, error: "Secure office document review sign-in is required." })
  );
  await sandbox.loadLeads();

  const { elements } = sandbox.document;
  assert.equal(sandbox.leadsLoadState.status, "error");
  assert.equal(sandbox.leadsLoadState.loadedOnce, false);
  assert.equal(elements.leadsLoadStatus.hidden, false);
  assert.match(elements.leadsLoadStatus.innerHTML, /Leads could not be loaded/);
  assert.match(elements.leadsLoadStatus.innerHTML, /Sign in again/);
  assert.ok(
    elements.leadsLoadStatus.innerHTML.includes(
      "/office-document-review/sign-in?next=%2Fleads-dashboard"
    )
  );
  assert.match(elements.leadsLoadStatus.innerHTML, /Retry/);
  assert.match(elements.leadsLoadStatus.innerHTML, /does not mean there are zero leads/);
  assert.equal(elements.leadCount.innerText, "Leads unavailable");
  assert.doesNotMatch(elements.leadCount.innerText, /\b0 leads\b/);
  assert.equal(elements.contractor1099RequestsSidebarCount.textContent, "–");
  assert.equal(
    elements.contractor1099RequestsSidebarCount.attributes["aria-label"],
    "Count unavailable"
  );
  assert.ok(!sandbox.calls.includes("populateContactAdvancedFilters"));
  assert.ok(sandbox.consoleErrors.some((line) => line.includes("auth")));
});

test("loadLeads: server error shows an error without a sign-in link", async () => {
  const sandbox = loadDashboardSandbox(
    jsonResponse(500, { ok: false, error: "Could not load leads." })
  );
  await sandbox.loadLeads();

  const box = sandbox.document.elements.leadsLoadStatus;
  assert.equal(box.hidden, false);
  assert.match(box.innerHTML, /HTTP 500/);
  assert.doesNotMatch(box.innerHTML, /Sign in again/);
  assert.equal(sandbox.document.elements.leadCount.innerText, "Leads unavailable");
});

test("loadLeads: non-JSON error page is treated as a failure, not an empty list", async () => {
  const sandbox = loadDashboardSandbox(htmlResponse(502));
  await sandbox.loadLeads();
  assert.equal(sandbox.leadsLoadState.error.kind, "server");
  assert.equal(sandbox.leadsLoadState.loadedOnce, false);
});

test("loadLeads: network failure shows a connection error", async () => {
  const sandbox = loadDashboardSandbox(async () => {
    throw new TypeError("Failed to fetch");
  });
  await sandbox.loadLeads();

  assert.equal(sandbox.leadsLoadState.error.kind, "network");
  assert.match(
    sandbox.document.elements.leadsLoadStatus.innerHTML,
    /could not be reached/
  );
  assert.equal(sandbox.document.elements.leadCount.innerText, "Leads unavailable");
});

test("loadLeads: confirmed successful empty response is a real empty list", async () => {
  const sandbox = loadDashboardSandbox(jsonResponse(200, { ok: true, count: 0, leads: [] }));
  const returned = await sandbox.loadLeads();

  assert.equal(sandbox.leadsLoadState.status, "ok");
  assert.equal(sandbox.leadsLoadState.loadedOnce, true);
  assert.equal(returned.length, 0);
  assert.equal(sandbox.document.elements.leadsLoadStatus.hidden, true);
  // Normal render pipeline ran (renderLeads passed its guard).
  assert.ok(sandbox.calls.includes("populateContactAdvancedFilters"));
  assert.ok(sandbox.calls.includes("getVisibleLeads"));
});

test("loadLeads: successful populated response preserves existing load behavior", async () => {
  const sandbox = loadDashboardSandbox(
    jsonResponse(200, { ok: true, count: 1, leads: [GABRIEL_STYLE_CONTACT_LEAD] })
  );
  const returned = await sandbox.loadLeads();

  assert.equal(returned.length, 1);
  assert.equal(sandbox.allLeads[0].leadId, GABRIEL_STYLE_CONTACT_LEAD.leadId);
  assert.deepEqual(
    sandbox.calls.slice(0, 6),
    [
      "populateAllLeadFilters",
      "populateTaxPrepAdvancedFilters",
      "populateContactAdvancedFilters",
      "populateClosedYearFilter",
      "updateExtensionRequestCounts",
      "updateContractor1099Counts"
    ]
  );
  assert.ok(sandbox.calls.includes("getVisibleLeads"));
  assert.equal(sandbox.document.elements.leadsLoadStatus.hidden, true);
});

test("loadLeads: a failed refresh keeps previously loaded leads and marks them stale", async () => {
  const sandbox = loadDashboardSandbox(
    sequenceFetch(
      jsonResponse(200, { ok: true, leads: [GABRIEL_STYLE_CONTACT_LEAD] }),
      jsonResponse(401, { ok: false })
    )
  );

  await sandbox.loadLeads();
  const returned = await sandbox.loadLeads();

  assert.equal(returned.length, 1);
  assert.equal(sandbox.allLeads.length, 1);
  assert.equal(sandbox.leadsLoadState.loadedOnce, true);
  assert.equal(sandbox.leadsLoadState.status, "error");

  const box = sandbox.document.elements.leadsLoadStatus;
  assert.equal(box.hidden, false);
  assert.match(box.innerHTML, /last successful load/);
  assert.match(box.innerHTML, /may be out of date/);
  assert.match(box.innerHTML, /Sign in again/);
  // The stale list is not replaced with an "unavailable" placeholder.
  assert.notEqual(sandbox.document.elements.leadCount.innerText, "Leads unavailable");
});

test("loadLeads: a successful retry clears the error banner", async () => {
  const sandbox = loadDashboardSandbox(
    sequenceFetch(
      jsonResponse(500, { ok: false }),
      jsonResponse(200, { ok: true, leads: [] })
    )
  );

  await sandbox.loadLeads();
  assert.equal(sandbox.document.elements.leadsLoadStatus.hidden, false);

  await sandbox.loadLeads();
  assert.equal(sandbox.document.elements.leadsLoadStatus.hidden, true);
  assert.equal(sandbox.leadsLoadState.status, "ok");
});

test("renderLeads: before any successful load it shows a loading state, never 0 leads", () => {
  const sandbox = loadDashboardSandbox(jsonResponse(200, {}));
  sandbox.renderLeads();

  assert.equal(sandbox.document.elements.leadCount.innerText, "Loading leads...");
  assert.match(sandbox.document.elements.leadList.innerHTML, /Loading leads/);
  assert.ok(!sandbox.calls.includes("getVisibleLeads"));
});

test("error message text is HTML-escaped", () => {
  const sandbox = loadDashboardSandbox(jsonResponse(200, {}));
  sandbox.leadsLoadState = {
    status: "error",
    loadedOnce: false,
    lastSuccessAt: "",
    error: { kind: "server", message: "<img src=x onerror=alert(1)>" }
  };
  sandbox.renderLeadsLoadStatus();
  const html = sandbox.document.elements.leadsLoadStatus.innerHTML;
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("dashboard markup includes an accessible lead-load status region", () => {
  assert.match(
    SOURCE,
    /<div id="leadsLoadStatus"[^>]*role="alert"[^>]*aria-live="assertive"[^>]*hidden><\/div>/
  );
});

// =============================================================================
// Classification regression: CONTACT- inquiry about Contractor Forms 1099
// =============================================================================

function loadClassificationSandbox(leads) {
  const sandbox = {};
  vm.createContext(sandbox);
  const script = [
    "var allLeads = [];",
    "var currentView = 'websitecontact';",
    "var currentContactFilter = 'new';",
    "var currentContactYear = 'all';",
    "var currentContactMonth = 'all';",
    "var currentContactService = 'all';",
    "var currentContactStatus = 'all';",
    "var currentContactSearch = '';",
    ...[
      "getLeadEnteredAt",
      "getMembershipEnrollmentText",
      "isWebsiteContactLead",
      "isTaxWatchEnrollmentLead",
      "isPinnacleEnrollmentLead",
      "isMembershipEnrollmentLead",
      "isContractor1099Lead",
      "getContactRepliedAt",
      "matchesContactFilter",
      "getWebsiteContactService",
      "matchesContactAdvancedFilters",
      "getVisibleLeads"
    ].map((name) => extractFunctionSource(SOURCE, name))
  ].join("\n");
  vm.runInContext(script, sandbox);
  sandbox.allLeads = leads;
  return sandbox;
}

test("CONTACT- inquiry for Contractor Forms 1099 appears under Website Contact Requests", () => {
  const sandbox = loadClassificationSandbox([GABRIEL_STYLE_CONTACT_LEAD]);

  assert.equal(sandbox.isWebsiteContactLead(GABRIEL_STYLE_CONTACT_LEAD), true);
  assert.equal(sandbox.isMembershipEnrollmentLead(GABRIEL_STYLE_CONTACT_LEAD), false);

  // Default view filters ("new", all years/services/statuses).
  const visible = sandbox.getVisibleLeads();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].leadId, GABRIEL_STYLE_CONTACT_LEAD.leadId);

  // Filtering by its service also finds it.
  sandbox.currentContactService = "Contractor Forms 1099";
  assert.equal(sandbox.getVisibleLeads().length, 1);
});

test("existing classification rules are preserved: CONTACT- is not a Contractor 1099 service request; C1099- is", () => {
  const sandbox = loadClassificationSandbox([]);

  assert.equal(sandbox.isContractor1099Lead(GABRIEL_STYLE_CONTACT_LEAD), false);

  assert.equal(
    sandbox.isContractor1099Lead({ leadId: "C1099-123", status: "Contractor 1099 - Needs Review" }),
    true
  );
  assert.equal(
    sandbox.isContractor1099Lead({ leadId: "X-1", contractor1099Request: { taxYear: "2026" } }),
    true
  );
  assert.equal(sandbox.isWebsiteContactLead({ leadId: "C1099-123", status: "Contractor 1099 - New" }), false);
});

// =============================================================================
// Owner inquiry alert visibility
// =============================================================================

function leadWithAlert(leadId, kind, state) {
  return {
    leadId,
    contact: { name: "Pat Customer", email: "pat@customer-mail.net" },
    ownerAlerts: { [kind]: state }
  };
}

test("getUnresolvedOwnerAlerts: surfaces failed, retrying, and stale pending alerts only", () => {
  const sandbox = loadDashboardSandbox(jsonResponse(200, {}));
  const now = Date.parse("2026-11-08T12:00:00.000Z");
  const leads = [
    leadWithAlert("L-SENT", "contact-request", { status: "sent", attempts: 1 }),
    leadWithAlert("L-SUPP", "contact-request", { status: "suppressed" }),
    leadWithAlert("L-DUP", "contact-request", { status: "duplicate" }),
    leadWithAlert("L-FRESH", "free-estimate", { status: "pending", createdAt: "2026-11-08T11:59:30.000Z" }),
    leadWithAlert("L-STALE", "free-estimate", { status: "pending", createdAt: "2026-11-08T11:50:00.000Z" }),
    leadWithAlert("L-RETRY", "contractor-1099-request", { status: "retrying", attempts: 2, lastError: "ECONNECTION", label: "Contractor Forms 1099 Request" }),
    leadWithAlert("L-FAIL", "contact-request", { status: "failed", attempts: 6, lastError: "EAUTH_535" }),
    { leadId: "L-LEGACY", contact: { name: "Old" } }
  ];

  const rows = sandbox.getUnresolvedOwnerAlerts(leads, now);
  assert.deepEqual(
    Array.from(rows, (row) => row.leadId),
    ["L-FAIL", "L-STALE", "L-RETRY"]
  );
  assert.equal(rows[2].label, "Contractor Forms 1099 Request");
});

test("loadLeads: unresolved owner alerts are shown in the authenticated dashboard with a retry action", async () => {
  const leads = [
    leadWithAlert("CONTACT-1794019105793-TEST1", "contact-request", {
      status: "failed",
      attempts: 6,
      lastError: "ECONNECTION",
      label: "Contact Request - Contractor Forms 1099"
    })
  ];
  const sandbox = loadDashboardSandbox(jsonResponse(200, { ok: true, leads }));
  await sandbox.loadLeads();

  const box = sandbox.document.elements.ownerAlertStatus;
  assert.equal(box.hidden, false);
  assert.match(box.innerHTML, /1 customer inquiry alert has not been delivered/);
  assert.match(box.innerHTML, /CONTACT-1794019105793-TEST1/);
  assert.match(box.innerHTML, /Alert FAILED after 6 attempt/);
  assert.match(box.innerHTML, /\[ECONNECTION\]/);
  assert.match(box.innerHTML, /data-lead-id="CONTACT-1794019105793-TEST1"/);
  assert.match(box.innerHTML, /retryOwnerAlerts\(this\.dataset\.leadId\)/);
  assert.match(box.innerHTML, /Retry all now/);
});

test("loadLeads: no owner alert banner when every alert was delivered", async () => {
  const sandbox = loadDashboardSandbox(
    jsonResponse(200, {
      ok: true,
      leads: [leadWithAlert("L-1", "contact-request", { status: "sent", attempts: 1 })]
    })
  );
  await sandbox.loadLeads();
  assert.equal(sandbox.document.elements.ownerAlertStatus.hidden, true);
});

test("owner alert banner escapes customer-controlled text", () => {
  const sandbox = loadDashboardSandbox(jsonResponse(200, {}));
  sandbox.allLeads = [
    {
      leadId: "L-X",
      contact: { name: "<img src=x onerror=alert(1)>" },
      ownerAlerts: { "contact-request": { status: "failed", attempts: 6, label: "<b>x</b>" } }
    }
  ];
  sandbox.renderOwnerAlertStatus();
  const html = sandbox.document.elements.ownerAlertStatus.innerHTML;
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;img/);
});
