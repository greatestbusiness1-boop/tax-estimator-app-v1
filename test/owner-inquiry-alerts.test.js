"use strict";

// Unit tests for server/ownerInquiryAlerts.js -- the owner notification
// lifecycle for saved customer inquiries. Mocked transport and in-memory lead
// store only; no server, network, database, or real email.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createOwnerInquiryAlerts,
  sanitizeErrorCode
} = require("../server/ownerInquiryAlerts");

function harness({
  failSends = 0,
  failWith = Object.assign(new Error("connect failed to smtp for owner@x.com"), { code: "ECONNECTION" }),
  ready = true,
  reason = "",
  hangSends = false,
  suppressedEmails = []
} = {}) {
  let clock = Date.parse("2026-11-08T12:00:00.000Z");
  const store = new Map();
  const sent = [];
  const logs = [];
  let remainingFailures = failSends;

  const alerts = createOwnerInquiryAlerts({
    sendMail: async (mail) => {
      if (hangSends) return new Promise(() => {});
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw failWith;
      }
      sent.push(mail);
      return { messageId: "m" + sent.length };
    },
    getDeliveryConfig: () =>
      ready
        ? { ready: true, from: "office@test.local", to: "owner@test.local", dashboardUrl: "https://site.example/leads-dashboard" }
        : { ready: false, reason },
    loadLead: async (leadId) => (store.has(leadId) ? JSON.parse(JSON.stringify(store.get(leadId))) : null),
    saveAlertState: async (leadId, kind, state) => {
      const lead = store.get(leadId);
      if (!lead) return { ok: false };
      lead.ownerAlerts = { ...(lead.ownerAlerts || {}), [kind]: JSON.parse(JSON.stringify(state)) };
      return { ok: true };
    },
    listLeadsWithOpenAlerts: async () =>
      Array.from(store.values()).map((lead) => JSON.parse(JSON.stringify(lead))),
    suppressedEmails,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    logger: {
      error: (...args) => logs.push(args.join(" ")),
      log: (...args) => logs.push(args.join(" "))
    },
    attemptTimeoutMs: 50
  });

  function saveNewLead(lead, kind = "contact-request", label = "Contact Request - Contractor Forms 1099") {
    const initial = alerts.initialState(lead, { kind, label });
    const stored = { ...lead, ownerAlerts: { [kind]: initial } };
    store.set(lead.leadId, stored);
    return JSON.parse(JSON.stringify(stored));
  }

  return {
    alerts,
    store,
    sent,
    logs,
    saveNewLead,
    advance: (ms) => {
      clock += ms;
    },
    stateOf: (leadId, kind = "contact-request") => store.get(leadId)?.ownerAlerts?.[kind]
  };
}

function customerLead(id, overrides = {}) {
  return {
    leadId: id,
    timestamp: "2026-11-08T12:00:00.000Z",
    contact: { name: "Pat Customer", email: `pat.${id}@customer-mail.net`, phone: "(555) 555-0100" },
    contactRequest: {
      service: "Contractor Forms 1099",
      message: "PRIVATE-MESSAGE-BODY need 1099s for 4 contractors"
    },
    ...overrides
  };
}

test("successful persistence then notification records status 'sent'", async () => {
  const h = harness();
  const lead = h.saveNewLead(customerLead("CONTACT-1"));
  assert.equal(lead.ownerAlerts["contact-request"].status, "pending");

  const result = await h.alerts.notify(lead, { kind: "contact-request", label: "Contact Request - Contractor Forms 1099" });

  assert.equal(result.status, "sent");
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].to, "owner@test.local");
  assert.match(h.sent[0].subject, /CONTACT-1/);
  const state = h.stateOf("CONTACT-1");
  assert.equal(state.status, "sent");
  assert.equal(state.attempts, 1);
  assert.ok(state.sentAt);
});

test("a route-supplied detailed alert is used for the first attempt", async () => {
  const h = harness();
  const lead = h.saveNewLead(customerLead("CONTACT-2"));
  await h.alerts.notify(lead, {
    kind: "contact-request",
    mail: { subject: "New Contact Request - Contractor Forms 1099", text: "detailed body", replyTo: "pat@customer-mail.net" }
  });
  assert.equal(h.sent[0].subject, "New Contact Request - Contractor Forms 1099");
  assert.equal(h.sent[0].replyTo, "pat@customer-mail.net");
});

test("transport failure after persistence: lead keeps a 'retrying' state with a sanitized code and a scheduled retry", async () => {
  const h = harness({ failSends: 10 });
  const lead = h.saveNewLead(customerLead("CONTACT-3"));

  const result = await h.alerts.notify(lead, { kind: "contact-request" });

  assert.equal(result.status, "retrying");
  const state = h.stateOf("CONTACT-3");
  assert.equal(state.status, "retrying");
  assert.equal(state.attempts, 2, "one immediate retry");
  assert.equal(state.lastError, "ECONNECTION");
  assert.ok(Date.parse(state.nextAttemptAt) > Date.parse(state.lastAttemptAt));
  assert.equal(h.sent.length, 0);

  // Privacy: neither state nor logs contain message content or raw error text.
  const serialized = JSON.stringify(state) + h.logs.join("\n");
  assert.doesNotMatch(serialized, /PRIVATE-MESSAGE-BODY/);
  assert.doesNotMatch(serialized, /owner@x\.com/);
  assert.doesNotMatch(serialized, /connect failed/);
  assert.ok(h.logs.some((line) => line.includes("CONTACT-3") && line.includes("ECONNECTION")));
});

test("retry and recovery: the background sweep delivers once the retry is due", async () => {
  const h = harness({ failSends: 2 });
  const lead = h.saveNewLead(customerLead("CONTACT-4"));
  await h.alerts.notify(lead, { kind: "contact-request" });
  assert.equal(h.stateOf("CONTACT-4").status, "retrying");

  // Not due yet: nothing is sent.
  let summary = await h.alerts.retryDue();
  assert.equal(summary.attempted, 0);
  assert.equal(h.sent.length, 0);

  h.advance(5 * 60 * 1000);
  summary = await h.alerts.retryDue();
  assert.equal(summary.attempted, 1);
  assert.equal(summary.sent, 1);
  const state = h.stateOf("CONTACT-4");
  assert.equal(state.status, "sent");
  assert.equal(state.attempts, 3);
  assert.equal(state.recoveredAfterFailure, true);

  // Privacy-minimal retry alert: no message body.
  assert.doesNotMatch(h.sent[0].text, /PRIVATE-MESSAGE-BODY/);
  assert.match(h.sent[0].text, /CONTACT-4/);
  assert.match(h.sent[0].text, /leads-dashboard/);
});

test("retries are bounded: after the schedule is exhausted the alert is 'failed'", async () => {
  const h = harness({ failSends: 100 });
  const lead = h.saveNewLead(customerLead("CONTACT-5"));
  await h.alerts.notify(lead, { kind: "contact-request" });

  for (let i = 0; i < 10; i += 1) {
    h.advance(5 * 60 * 60 * 1000);
    await h.alerts.retryDue();
  }

  const state = h.stateOf("CONTACT-5");
  assert.equal(state.status, "failed");
  assert.equal(state.attempts, h.alerts.maxAutomaticAttempts);
  assert.equal(state.nextAttemptAt, undefined);

  // Further sweeps do not attempt a failed alert.
  const summary = await h.alerts.retryDue();
  assert.equal(summary.attempted, 0);
});

test("office 'Retry now' (force) attempts a failed alert and can recover it", async () => {
  const h = harness({ failSends: 6 });
  const lead = h.saveNewLead(customerLead("CONTACT-6"));
  await h.alerts.notify(lead, { kind: "contact-request" });
  for (let i = 0; i < 6; i += 1) {
    h.advance(5 * 60 * 60 * 1000);
    await h.alerts.retryDue();
  }
  assert.equal(h.stateOf("CONTACT-6").status, "failed");

  const summary = await h.alerts.retryDue({ leadId: "CONTACT-6", force: true });
  assert.equal(summary.attempted, 1);
  assert.equal(summary.sent, 1);
  assert.equal(h.stateOf("CONTACT-6").status, "sent");
});

test("duplicate prevention: a sent alert is never re-sent, and concurrent notifies send once", async () => {
  const h = harness();
  const lead = h.saveNewLead(customerLead("CONTACT-7"));

  const [a, b] = await Promise.all([
    h.alerts.notify(lead, { kind: "contact-request" }),
    h.alerts.notify(lead, { kind: "contact-request" })
  ]);
  assert.deepEqual([a.status, b.status].sort(), ["in-progress", "sent"]);
  assert.equal(h.sent.length, 1);

  const reloaded = await h.alerts.notify(h.store.get("CONTACT-7"), { kind: "contact-request" });
  assert.equal(reloaded.skipped, true);
  assert.equal(h.sent.length, 1);

  const forced = await h.alerts.retryDue({ leadId: "CONTACT-7", force: true });
  assert.equal(forced.attempted, 0, "force never re-sends a delivered alert");
  assert.equal(h.sent.length, 1);
});

test("duplicate prevention: a repeat submission by the same customer within the window is not re-alerted", () => {
  const h = harness();
  const first = h.saveNewLead(customerLead("CONTACT-8", { contact: { name: "Sam", email: "sam@customer-mail.net" } }));
  const second = h.saveNewLead(customerLead("CONTACT-9", { contact: { name: "Sam", email: "SAM@customer-mail.net" } }));

  assert.equal(first.ownerAlerts["contact-request"].status, "pending");
  assert.equal(second.ownerAlerts["contact-request"].status, "duplicate");
  assert.equal(second.ownerAlerts["contact-request"].duplicateOf, "CONTACT-8");

  h.advance(11 * 60 * 1000);
  const third = h.saveNewLead(customerLead("CONTACT-10", { contact: { name: "Sam", email: "sam@customer-mail.net" } }));
  assert.equal(third.ownerAlerts["contact-request"].status, "pending");
});

test("test submissions (reserved test domains and configured test emails) never alert", async () => {
  const h = harness({ suppressedEmails: ["owner+qa@gmail.com"] });

  for (const [id, email] of [
    ["T-1", "someone@example.com"],
    ["T-2", "a+b@example.test"],
    ["T-3", "x@foo.invalid"],
    ["T-4", "Owner+QA@gmail.com"]
  ]) {
    const lead = h.saveNewLead(customerLead(id, { contact: { name: "QA", email } }));
    assert.equal(lead.ownerAlerts["contact-request"].status, "suppressed", email);
    const result = await h.alerts.notify(lead, { kind: "contact-request" });
    assert.equal(result.skipped, true);
  }
  assert.equal(h.sent.length, 0);
  assert.equal(h.alerts.isTestSubmissionEmail("real.customer@gmail.com"), false);
});

test("production without email credentials is a visible failure, not a silent success", async () => {
  const h = harness({ ready: false, reason: "EMAIL_NOT_CONFIGURED" });
  const lead = h.saveNewLead(customerLead("CONTACT-11"));
  const result = await h.alerts.notify(lead, { kind: "contact-request" });
  assert.equal(result.status, "retrying");
  assert.equal(h.stateOf("CONTACT-11").lastError, "EMAIL_NOT_CONFIGURED");
  assert.equal(h.sent.length, 0);
});

test("a hung SMTP send is bounded by the attempt timeout", async () => {
  const h = harness({ hangSends: true });
  const lead = h.saveNewLead(customerLead("CONTACT-12"));
  const started = Date.now();
  const result = await h.alerts.notify(lead, { kind: "contact-request" });
  assert.ok(Date.now() - started < 2000);
  assert.equal(result.status, "retrying");
  assert.equal(h.stateOf("CONTACT-12").lastError, "TIMEOUT");
});

test("a crash before delivery leaves a 'pending' alert that the sweep picks up after the grace period", async () => {
  const h = harness();
  h.saveNewLead(customerLead("CONTACT-13"));

  let summary = await h.alerts.retryDue();
  assert.equal(summary.attempted, 0, "fresh pending alerts belong to the in-flight request");

  h.advance(3 * 60 * 1000);
  summary = await h.alerts.retryDue();
  assert.equal(summary.sent, 1);
  assert.equal(h.stateOf("CONTACT-13").status, "sent");
});

test("sanitizeErrorCode never returns raw error text", () => {
  assert.equal(sanitizeErrorCode(Object.assign(new Error("x"), { code: "EAUTH", responseCode: 535 })), "EAUTH_535");
  assert.equal(sanitizeErrorCode(new Error("550 mailbox owner@example.com unavailable")), "SEND_FAILED");
  assert.equal(sanitizeErrorCode({ responseCode: 421 }), "SMTP_421");
  assert.equal(sanitizeErrorCode({ code: "weird code with spaces <script>" }), "SEND_FAILED");
});

// =============================================================================
// Concurrency safety
// =============================================================================

const { writeAlertStateWithConcurrencyGuard } = require("../server/ownerInquiryAlerts");

function versionedRow(estimate) {
  // Mimics the leads row: estimate jsonb + updated_at bumped on every update
  // by the leads_set_updated_at trigger.
  let version = 1;
  let current = JSON.parse(JSON.stringify(estimate));
  return {
    read: () => ({ found: true, estimate: JSON.parse(JSON.stringify(current)), version: `v${version}` }),
    writeIfVersion(next, expected) {
      if (expected && expected !== `v${version}`) return { ok: false, conflict: true };
      current = JSON.parse(JSON.stringify(next));
      version += 1;
      return { ok: true };
    },
    // An unrelated writer (Stripe webhook / office edit) replacing estimate.
    externalReplace(mutator) {
      current = mutator(JSON.parse(JSON.stringify(current)));
      version += 1;
    },
    get value() {
      return current;
    }
  };
}

test("concurrent payment update between the alert read and write is preserved (CAS retry)", async () => {
  const row = versionedRow({
    status: "Transcript Help - Payment Pending",
    transcriptRequest: { requested: true, paymentStatus: "Need Payment" },
    ownerAlerts: { "transcript-help-request": { status: "pending" } }
  });

  let loads = 0;
  const result = await writeAlertStateWithConcurrencyGuard({
    kind: "transcript-help-request",
    state: { status: "sent", attempts: 1 },
    load: async () => {
      const snapshot = row.read();
      loads += 1;
      if (loads === 1) {
        // The Stripe webhook marks the lead paid right after our read.
        row.externalReplace((estimate) => ({
          ...estimate,
          status: "Transcript Help - Paid",
          transcriptRequest: {
            ...estimate.transcriptRequest,
            paymentStatus: "Paid / Verified",
            stripeCheckoutSessionId: "cs_test_123"
          }
        }));
      }
      return snapshot;
    },
    save: async (estimate, version) => row.writeIfVersion(estimate, version)
  });

  assert.equal(result.ok, true);
  assert.equal(result.guarded, true);
  assert.equal(result.attempts, 2, "first write conflicted, second succeeded");
  assert.equal(row.value.status, "Transcript Help - Paid", "payment status was not reverted");
  assert.equal(row.value.transcriptRequest.paymentStatus, "Paid / Verified");
  assert.equal(row.value.transcriptRequest.stripeCheckoutSessionId, "cs_test_123");
  assert.equal(row.value.ownerAlerts["transcript-help-request"].status, "sent");
});

test("alert writes merge only their own alert kind and keep other alert states", async () => {
  const row = versionedRow({
    contact: { name: "Pat" },
    ownerAlerts: { "free-estimate": { status: "sent" } }
  });
  const result = await writeAlertStateWithConcurrencyGuard({
    kind: "transcript-help-request",
    state: { status: "retrying" },
    load: async () => row.read(),
    save: async (estimate, version) => row.writeIfVersion(estimate, version)
  });
  assert.equal(result.ok, true);
  assert.equal(row.value.contact.name, "Pat");
  assert.equal(row.value.ownerAlerts["free-estimate"].status, "sent");
  assert.equal(row.value.ownerAlerts["transcript-help-request"].status, "retrying");
});

test("continuous conflicts are bounded and reported, never forced through", async () => {
  const row = versionedRow({ status: "x" });
  let saves = 0;
  const result = await writeAlertStateWithConcurrencyGuard({
    kind: "contact-request",
    state: { status: "sent" },
    maxAttempts: 3,
    load: async () => {
      const snapshot = row.read();
      row.externalReplace((estimate) => ({ ...estimate, touched: (estimate.touched || 0) + 1 }));
      return snapshot;
    },
    save: async (estimate, version) => {
      saves += 1;
      return row.writeIfVersion(estimate, version);
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "conflict-retries-exhausted");
  assert.equal(saves, 3);
  assert.equal(row.value.ownerAlerts, undefined, "no unguarded overwrite happened");
});

test("a database write error is reported without retry loops; a missing row is not created", async () => {
  let saves = 0;
  const failed = await writeAlertStateWithConcurrencyGuard({
    kind: "contact-request",
    state: { status: "sent" },
    load: async () => ({ found: true, estimate: {}, version: "v1" }),
    save: async () => {
      saves += 1;
      return { ok: false };
    }
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "write-failed");
  assert.equal(saves, 1);

  const missing = await writeAlertStateWithConcurrencyGuard({
    kind: "contact-request",
    state: { status: "sent" },
    load: async () => ({ found: false }),
    save: async () => {
      throw new Error("must not write");
    }
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "not-found");
});

test("without a row version the write is reported as unguarded (so the server can warn)", async () => {
  let writtenVersion = "unset";
  const result = await writeAlertStateWithConcurrencyGuard({
    kind: "contact-request",
    state: { status: "sent" },
    load: async () => ({ found: true, estimate: {}, version: undefined }),
    save: async (estimate, version) => {
      writtenVersion = version;
      return { ok: true };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.guarded, false);
  assert.equal(writtenVersion, undefined);
});

test("a delivered alert reverted by another writer is repaired, not re-sent", async () => {
  const h = harness();
  const lead = h.saveNewLead(customerLead("CONTACT-20"));
  await h.alerts.notify(lead, { kind: "contact-request" });
  assert.equal(h.sent.length, 1);

  // Another writer replaces the estimate with an older copy (alert back to
  // an overdue "retrying" state).
  h.store.get("CONTACT-20").ownerAlerts["contact-request"] = {
    status: "retrying",
    attempts: 2,
    nextAttemptAt: "2000-01-01T00:00:00.000Z"
  };

  const summary = await h.alerts.retryDue();
  assert.equal(summary.attempted, 0);
  assert.equal(h.sent.length, 1, "no duplicate owner alert");
  assert.equal(h.stateOf("CONTACT-20").status, "sent", "delivered state written back");

  const again = await h.alerts.notify(h.store.get("CONTACT-20"), { kind: "contact-request" });
  assert.equal(again.skipped, true);
  assert.equal(h.sent.length, 1);
});
