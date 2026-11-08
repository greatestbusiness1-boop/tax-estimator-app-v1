"use strict";

// =============================================================================
// Owner inquiry alerts
//
// Reliable owner notification lifecycle for newly saved customer inquiries.
//
// Rules:
//   - A lead is always persisted BEFORE any alert is attempted. The initial
//     alert state ("pending", "suppressed" or "duplicate") is written in the
//     same insert as the lead itself (see initialState()), so a crash between
//     saving and alerting leaves a visible, retryable "pending" alert.
//   - Alert state lives on the lead record (lead.ownerAlerts[kind]) under the
//     stable leadId. It records status, attempt counts, timestamps and a
//     sanitized error CODE only -- never credentials, message bodies, or raw
//     transport error messages (which can echo addresses/content).
//   - Delivery is idempotent per (leadId, kind): once "sent", "suppressed" or
//     "duplicate", it is never sent again. Concurrent attempts for the same
//     key in this process are collapsed.
//   - Retries are bounded: a short immediate retry, then scheduled background
//     retries, then "failed" (needs owner attention in the Tax Lead Center).
//     An office user may force one more attempt on a failed alert.
// =============================================================================

const OPEN_STATUSES = new Set(["pending", "retrying", "failed"]);
const FINAL_STATUSES = new Set(["sent", "suppressed", "duplicate"]);

const RESERVED_TEST_DOMAIN_PATTERN =
  /(^|\.)(example\.(com|org|net)|[a-z0-9-]+\.test|[a-z0-9-]+\.invalid|localhost|[a-z0-9-]+\.localhost)$/i;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeErrorCode(err) {
  if (!err) return "SEND_FAILED";
  if (err.ownerAlertCode) return String(err.ownerAlertCode);
  const code = String(err.code || "").toUpperCase();
  const responseCode = Number(err.responseCode || 0);
  if (/^[A-Z_]{3,40}$/.test(code)) {
    return responseCode ? `${code}_${responseCode}` : code;
  }
  if (responseCode) return `SMTP_${responseCode}`;
  return "SEND_FAILED";
}

function isOpenAlertState(state) {
  return Boolean(state && OPEN_STATUSES.has(state.status));
}

// Concurrency-safe write of ONE alert state into a lead's estimate JSON.
//
// The leads table stores the whole lead in a single `estimate` jsonb column,
// and other writers (Stripe webhook payment updates, office edits, customer
// PATCH requests) replace that whole column. A naive read-modify-write here
// could therefore revert a payment or office update made between our read and
// our write. This helper:
//   - re-reads the row, merges ONLY ownerAlerts[kind] into the fresh estimate;
//   - writes only if the row version (updated_at, maintained by the
//     leads_set_updated_at trigger) is unchanged since the read;
//   - on a version conflict, re-reads and retries (bounded).
// If the row exposes no version, it falls back to a single plain write and
// reports `guarded: false` so the caller can warn.
//
//   load()  -> { found: boolean, estimate: object, version: string|undefined }
//   save(estimate, version) -> { ok: boolean, conflict?: boolean }
async function writeAlertStateWithConcurrencyGuard({
  load,
  save,
  kind,
  state,
  maxAttempts = 4
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const row = await load();
    if (!row || !row.found) return { ok: false, reason: "not-found" };

    const estimate = row.estimate && typeof row.estimate === "object" ? row.estimate : {};
    const updatedEstimate = {
      ...estimate,
      ownerAlerts: {
        ...(estimate.ownerAlerts && typeof estimate.ownerAlerts === "object"
          ? estimate.ownerAlerts
          : {}),
        [kind]: state
      }
    };

    const guarded = Boolean(row.version);
    const result = await save(updatedEstimate, guarded ? row.version : undefined);

    if (result && result.ok) {
      return { ok: true, guarded, attempts: attempt, estimate: updatedEstimate };
    }
    if (!result || !result.conflict) {
      return { ok: false, reason: "write-failed", guarded };
    }
    // conflict: someone else updated the lead -- re-read and merge again.
  }

  return { ok: false, reason: "conflict-retries-exhausted", guarded: true };
}

function createOwnerInquiryAlerts({
  sendMail,
  getDeliveryConfig,
  loadLead,
  saveAlertState,
  listLeadsWithOpenAlerts,
  suppressedEmails = [],
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
  immediateRetryDelaysMs = [1500],
  backgroundRetryMinutes = [5, 15, 60, 240],
  attemptTimeoutMs = 20000,
  pendingGraceMs = 2 * 60 * 1000,
  duplicateWindowMs = 10 * 60 * 1000,
  maxManualAttempts = 10
} = {}) {
  const maxAutomaticAttempts =
    1 + immediateRetryDelaysMs.length + backgroundRetryMinutes.length;
  const suppressed = new Set(
    (suppressedEmails || []).map(normalizeEmail).filter(Boolean)
  );
  const inFlight = new Set();
  const recentFingerprints = new Map();
  // Delivered alerts seen by this process. If another writer later replaces
  // the lead's estimate with an older copy (reverting ownerAlerts to
  // pending/retrying), the alert is NOT re-sent; the delivered state is
  // written back instead. Bounded in size.
  const deliveredStates = new Map();
  const MAX_DELIVERED_TRACKED = 5000;

  function rememberDelivered(key, state) {
    deliveredStates.delete(key);
    deliveredStates.set(key, state);
    if (deliveredStates.size > MAX_DELIVERED_TRACKED) {
      deliveredStates.delete(deliveredStates.keys().next().value);
    }
  }

  async function healIfDelivered(leadId, kind, currentState) {
    const key = `${leadId}|${kind}`;
    const delivered = deliveredStates.get(key);
    if (!delivered) return false;
    if (!currentState || currentState.status !== "sent") {
      await persist(leadId, kind, delivered);
    }
    return true;
  }

  const iso = (ms) => new Date(ms).toISOString();

  function isTestSubmissionEmail(email) {
    const clean = normalizeEmail(email);
    if (!clean) return false;
    if (suppressed.has(clean)) return true;
    const domain = clean.split("@")[1] || "";
    return RESERVED_TEST_DOMAIN_PATTERN.test(domain);
  }

  function fingerprintFor(lead, kind) {
    const email = normalizeEmail(lead?.contact?.email);
    if (!email) return "";
    const service = String(
      lead?.contactRequest?.service ||
      lead?.contractor1099Request?.serviceTypes ||
      ""
    );
    return `${kind}|${email}|${service}`;
  }

  // Initial alert state, decided BEFORE the lead is inserted so it is
  // persisted atomically with the lead.
  function initialState(lead, { kind, label }) {
    const at = iso(now());
    const base = { kind, label, attempts: 0, createdAt: at, updatedAt: at };

    if (isTestSubmissionEmail(lead?.contact?.email)) {
      return { ...base, status: "suppressed", reason: "test-submission" };
    }

    const fingerprint = fingerprintFor(lead, kind);
    if (fingerprint) {
      const previous = recentFingerprints.get(fingerprint);
      if (
        previous &&
        previous.leadId !== lead.leadId &&
        now() - previous.at < duplicateWindowMs
      ) {
        return {
          ...base,
          status: "duplicate",
          reason: "repeat-submission",
          duplicateOf: previous.leadId
        };
      }
      recentFingerprints.set(fingerprint, { leadId: lead.leadId, at: now() });
      for (const [key, value] of recentFingerprints) {
        if (now() - value.at >= duplicateWindowMs) recentFingerprints.delete(key);
      }
    }

    return { ...base, status: "pending" };
  }

  function buildAlertForLead(lead = {}, kind = "", label = "") {
    const config = getDeliveryConfig() || {};
    const contact = lead.contact || {};
    const service =
      lead.contactRequest?.service ||
      label ||
      kind;
    const subject = `New customer inquiry - ${label || service} - ${lead.leadId || ""}`.trim();
    const text = [
      "A new customer inquiry was saved in the Tax Lead Center.",
      "",
      `Inquiry: ${label || service}`,
      `Reference number: ${lead.leadId || ""}`,
      `Received: ${lead.timestamp || lead.createdAt || ""}`,
      "",
      `Name: ${contact.name || "Not provided"}`,
      `Email: ${contact.email || "Not provided"}`,
      `Phone: ${contact.phone || "Not provided"}`,
      "",
      "Open the Tax Lead Center to review the full request:",
      config.dashboardUrl || "/leads-dashboard",
      "",
      "Customer message details are kept in the Tax Lead Center and are not repeated in this alert."
    ].join("\n");
    return { subject, text, replyTo: contact.email || undefined };
  }

  async function sendOnce(mail) {
    const config = getDeliveryConfig() || {};
    if (!config.ready) {
      const err = new Error("Owner alert email delivery is not configured.");
      err.ownerAlertCode = config.reason || "EMAIL_NOT_CONFIGURED";
      throw err;
    }

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error("Owner alert send timed out.");
        err.ownerAlertCode = "TIMEOUT";
        reject(err);
      }, attemptTimeoutMs);
      if (timer && typeof timer.unref === "function") timer.unref();
    });

    try {
      await Promise.race([
        sendMail({
          from: config.from,
          to: config.to,
          replyTo: mail.replyTo,
          subject: mail.subject,
          text: mail.text
        }),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function persist(leadId, kind, state) {
    try {
      const result = await saveAlertState(leadId, kind, state);
      if (result && result.ok === false) {
        logger.error("[owner alert] Could not record alert state:", leadId, kind, state.status);
      }
    } catch {
      logger.error("[owner alert] Could not record alert state:", leadId, kind, state.status);
    }
  }

  // Runs up to `attemptCount` attempts (with the configured immediate delays
  // between them) and persists the resulting state.
  async function runAttempts(lead, kind, label, previous, mail, { attemptCount, manual }) {
    const leadId = lead.leadId;
    let state = {
      kind,
      label: label || previous?.label || kind,
      createdAt: previous?.createdAt || iso(now()),
      firstAttemptAt: previous?.firstAttemptAt || "",
      attempts: Number(previous?.attempts || 0)
    };
    let lastCode = "";

    for (let i = 0; i < attemptCount; i += 1) {
      if (i > 0) await sleep(immediateRetryDelaysMs[i - 1] ?? 0);
      const at = now();
      state.attempts += 1;
      state.firstAttemptAt = state.firstAttemptAt || iso(at);
      state.lastAttemptAt = iso(at);

      try {
        await sendOnce(mail);
        state = {
          ...state,
          status: "sent",
          sentAt: iso(now()),
          updatedAt: iso(now()),
          lastError: previous?.lastError ? previous.lastError : undefined,
          nextAttemptAt: undefined,
          recoveredAfterFailure: Boolean(previous?.lastError) || i > 0
        };
        rememberDelivered(`${leadId}|${kind}`, state);
        await persist(leadId, kind, state);
        return state;
      } catch (err) {
        lastCode = sanitizeErrorCode(err);
      }
    }

    const automaticRemaining = maxAutomaticAttempts - state.attempts;
    const scheduleIndex = Math.max(
      0,
      state.attempts - (1 + immediateRetryDelaysMs.length)
    );
    const canRetryAutomatically =
      !manual &&
      automaticRemaining > 0 &&
      scheduleIndex < backgroundRetryMinutes.length;

    state = {
      ...state,
      status: canRetryAutomatically ? "retrying" : "failed",
      lastError: lastCode,
      updatedAt: iso(now()),
      nextAttemptAt: canRetryAutomatically
        ? iso(now() + backgroundRetryMinutes[scheduleIndex] * 60 * 1000)
        : undefined
    };
    if (manual && state.status === "failed" && automaticRemaining > 0) {
      // A manual retry never cancels the remaining automatic schedule.
      state.status = "retrying";
      state.nextAttemptAt = iso(now() + backgroundRetryMinutes[0] * 60 * 1000);
    }

    logger.error(
      "[owner alert] Delivery failed:",
      leadId,
      kind,
      lastCode,
      `attempt ${state.attempts}`,
      state.status
    );
    await persist(leadId, kind, state);
    return state;
  }

  // First delivery for a newly saved inquiry (or a newly added request on an
  // existing lead). `mail` may carry a route's existing detailed alert; if
  // omitted, a privacy-minimal alert is built from the lead.
  async function notify(lead, { kind, label, mail, existingState, persistPendingFirst = false } = {}) {
    const leadId = String(lead?.leadId || "").trim();
    if (!leadId || !kind) return { status: "skipped", reason: "missing-lead-or-kind" };

    const key = `${leadId}|${kind}`;
    if (inFlight.has(key)) return { status: "in-progress", skipped: true };
    // Claim the key before any await so simultaneous calls cannot both send.
    inFlight.add(key);

    try {
      let state = existingState !== undefined ? existingState : lead?.ownerAlerts?.[kind];

      if (await healIfDelivered(leadId, kind, state)) {
        return { status: "sent", skipped: true };
      }

      if (state && (FINAL_STATUSES.has(state.status) || (state.status !== "pending" && isOpenAlertState(state)))) {
        // Already sent / intentionally not sent / already in the retry cycle.
        return { status: state.status, skipped: true };
      }

      if (!state) {
        state = initialState(lead, { kind, label });
        // Test submissions are re-evaluated identically every time, so their
        // "suppressed" state is not written back (no needless writes).
        if (
          state.status === "duplicate" ||
          (state.status === "pending" && persistPendingFirst)
        ) {
          await persist(leadId, kind, state);
        }
        if (state.status !== "pending") return { status: state.status, skipped: true };
      }

      return await runAttempts(
        lead,
        kind,
        label || state.label,
        state,
        mail || buildAlertForLead(lead, kind, label || state.label),
        { attemptCount: 1 + immediateRetryDelaysMs.length, manual: false }
      );
    } finally {
      inFlight.delete(key);
    }
  }

  function isDue(state, { force }) {
    if (!state) return false;
    const t = now();
    if (state.status === "pending") {
      const created = Date.parse(state.createdAt || "") || 0;
      return force || t - created >= pendingGraceMs;
    }
    if (state.status === "retrying") {
      const next = Date.parse(state.nextAttemptAt || "") || 0;
      return force || next <= t;
    }
    if (state.status === "failed") {
      return Boolean(force) && Number(state.attempts || 0) < maxManualAttempts;
    }
    return false;
  }

  // Background sweep (force=false) or office "Retry now" (force=true).
  async function retryDue({ leadId = "", force = false } = {}) {
    const summary = { checked: 0, attempted: 0, sent: 0, stillFailing: 0, skipped: 0 };
    let leads = [];

    if (leadId) {
      const lead = await loadLead(leadId);
      leads = lead ? [lead] : [];
    } else {
      leads = (await listLeadsWithOpenAlerts()) || [];
    }

    for (const lead of leads) {
      const alerts = lead?.ownerAlerts || {};
      for (const [kind, state] of Object.entries(alerts)) {
        summary.checked += 1;
        const key = `${lead.leadId}|${kind}`;
        if (inFlight.has(key)) {
          summary.skipped += 1;
          continue;
        }
        inFlight.add(key);
        try {
          if (isOpenAlertState(state) && (await healIfDelivered(lead.leadId, kind, state))) {
            summary.skipped += 1;
            continue;
          }
          if (!isDue(state, { force })) {
            summary.skipped += 1;
            continue;
          }
          summary.attempted += 1;
          const result = await runAttempts(
            lead,
            kind,
            state.label,
            state,
            buildAlertForLead(lead, kind, state.label),
            { attemptCount: 1, manual: Boolean(force) }
          );
          if (result.status === "sent") summary.sent += 1;
          else summary.stillFailing += 1;
        } finally {
          inFlight.delete(key);
        }
      }
    }

    return summary;
  }

  return {
    initialState,
    notify,
    retryDue,
    buildAlertForLead,
    isTestSubmissionEmail,
    maxAutomaticAttempts
  };
}

module.exports = {
  createOwnerInquiryAlerts,
  isOpenAlertState,
  sanitizeErrorCode,
  writeAlertStateWithConcurrencyGuard
};
