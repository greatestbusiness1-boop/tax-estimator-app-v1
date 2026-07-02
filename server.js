"use strict";

const express = require("express");
const clientCore = require("./server/clientCore");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const { estimate } = require("./taxEstimator");

require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const app = express();

const PORT = process.env.PORT || 3000;
const LEADS_FILE = path.join(__dirname, "leads.json");
const APP_BASE_URL = process.env.APP_BASE_URL || "https://tax-estimator-app-v1.onrender.com";
const recentLeads = new Map();

// =============================================================================
// EMAIL CONFIG
// =============================================================================

const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || "";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_APP_PASSWORD
  }
});

// =============================================================================
// LEADS FILE HELPERS
// =============================================================================

function readLeads() {
  try {
    if (!fs.existsSync(LEADS_FILE)) return [];
    const raw = fs.readFileSync(LEADS_FILE, "utf8").trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error("[leads] Read error:", err.message);
    return [];
  }
}

function writeLeads(leads) {
  const tmp = LEADS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(leads, null, 2), "utf8");
  fs.renameSync(tmp, LEADS_FILE);
}

async function appendLead(lead) {
  const row = {
    leadId: lead.leadId,
    name: lead.contact?.name || "",
    email: lead.contact?.email || "",
    phone: lead.contact?.phone || "",
    estimate: {
      timestamp: lead.timestamp,
      priority: lead.priority,
      status: lead.status,
      notes: lead.notes,
      contact: lead.contact,
      taxData: lead.taxData,
      estimateSummary: lead.estimateSummary
    },
    taxYear: lead.taxData?.taxYear || null,
    filingYear: lead.taxData?.filingYear || null
  };

  try {
    const { error } = await supabase
      .from("leads")
      .insert([row]);

    if (error) {
      throw error;
    }

    console.log("Lead saved to Supabase:", lead.leadId);
    return lead;
  } catch (err) {
    console.error("Supabase insert failed. Saving to local  instead:", err.message || err);

    const leads = readLeads();
    leads.push(lead);
    writeLeads(leads);

    console.log("Lead saved locally:", lead.leadId);
    return lead;
  }
}

// =============================================================================
// GENERAL HELPERS
// =============================================================================

function formatPhoneNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "").slice(0, 10);
  if (digits.length !== 10) return phone || "Not provided";
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function roundWholeDollar(amount) {
  const n = Number(amount || 0);
  return Math.round(n);
}

function formatWholeDollar(amount) {
  return roundWholeDollar(amount).toLocaleString("en-US");
}

function labelAmount(amount, type) {
  const rounded = roundWholeDollar(amount);

  if (rounded > 0) {
    return `${type} Refund: $${formatWholeDollar(rounded)}`;
  }

  if (rounded < 0) {
    return `${type} Amount You Owe: $${formatWholeDollar(Math.abs(rounded))}`;
  }

  return `${type}: $0`;
}

function buildEstimateDisplay(estimateSummary = {}) {
  const federal = estimateSummary.federal || {};
  const state = estimateSummary.state || {};

  const federalNet = Number(federal.net || 0);
  const stateNet = Number(state.net || 0);
  const combinedNet = federalNet + stateNet;

  let totalLine = "Estimated break-even";

  if (combinedNet > 0) {
    totalLine = `Estimated Total Refund: $${formatWholeDollar(combinedNet)}`;
  } else if (combinedNet < 0) {
    totalLine = `Estimated Total Due: $${formatWholeDollar(Math.abs(combinedNet))}`;
  }

  return {
    totalLine,
    federalLine: labelAmount(federalNet, "Federal"),
    stateLine: labelAmount(stateNet, "State"),
    federalNet,
    stateNet,
    combinedNet
  };
}

function mapRowToLead(row) {
  const estimate = row.estimate || {};

  const normalizedLeadId =
    row.leadId ||
    row.leadid ||
    row.lead_id ||
    row.id ||
    estimate.leadId ||
    estimate.leadid ||
    estimate.lead_id ||
    estimate.id ||
    "";

  return {
    leadId: normalizedLeadId,
    timestamp: estimate.timestamp || row.timestamp || row.created_at || row.createdAt || "",
    priority: estimate.priority || row.priority || "medium",
    status: estimate.status || row.status || "New",
    notes: estimate.notes || row.notes || "",
    contact: estimate.contact || row.contact || {
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || ""
    },
    taxData: estimate.taxData || row.taxData || row.tax_data || null,
    estimateSummary: estimate.estimateSummary || row.estimateSummary || row.estimate_summary || {},
    Request: estimate.Request || estimate.request || row.Request || row.request || null
  };
}

function buildLeadEmailMessages(lead) {
  const priority = lead.priority || "low";
  const name = lead.contact?.name || "Client";
  const email = lead.contact?.email || "";
  const phone = lead.contact?.phone || "Not provided";
  const bookingLink = "https://calendly.com/ngmsllc/tax-estimate-review-15-minutes";
  const estimateSummaryLink = `${APP_BASE_URL}/estimate/${lead.leadId}`;

  const estimateDisplay = buildEstimateDisplay(lead.estimateSummary);
  const federal = lead.estimateSummary?.federal || {};
  const state = lead.estimateSummary?.state || {};

  let internalHeadline = "";
  let internalAction = "";
  let clientSubject = "";
  let clientBody = "";

  if (priority === "high") {
    internalHeadline = "HIGH PRIORITY LEAD";
    internalAction = "Recommended action: Review and contact as soon as possible.";

    clientSubject = "Your tax estimate review is ready";
    clientBody =
      `Hello ${name},

Thank you for using the tax estimator.

Based on your estimate, there may be opportunities to improve your outcome, reduce what you owe, or confirm you are receiving the maximum refund available.

Summary:
- ${estimateDisplay.totalLine}
- ${estimateDisplay.federalLine}
- ${estimateDisplay.stateLine}

View your estimate summary:
${estimateSummaryLink}

ðŸ‘‰ Schedule your 15-minute tax review now:
${bookingLink}

Thank you,
Greatest Business Solution LLC`;
  } else if (priority === "medium") {
    internalHeadline = "MODERATE PRIORITY LEAD";
    internalAction = "Recommended action: Review soon and follow up as appropriate.";

    clientSubject = "Your tax estimate summary";
    clientBody =
      `Hello ${name},

Thank you for using the tax estimator.

Summary:
- ${estimateDisplay.totalLine}
- ${estimateDisplay.federalLine}
- ${estimateDisplay.stateLine}

View your estimate summary:
${estimateSummaryLink}

ðŸ‘‰ Schedule your 15-minute tax review:
${bookingLink}

Thank you,
Greatest Business Solution LLC`;
  } else {
    internalHeadline = "LOW PRIORITY LEAD";
    internalAction = "Optional follow-up.";

    clientSubject = "Your tax estimate has been received";
    clientBody =
      `Hello ${name},

Thank you for using the tax estimator.

Summary:
- ${estimateDisplay.totalLine}
- ${estimateDisplay.federalLine}
- ${estimateDisplay.stateLine}

View your estimate summary:
${estimateSummaryLink}

Thank you,
Greatest Business Solution LLC`;
  }

  const internalSubject = `${internalHeadline} - ${name}`;
  const internalBody =
    `${internalHeadline}

Lead ID: ${lead.leadId}
Submitted: ${lead.timestamp}

Contact
- Name: ${name}
- Email: ${email}
- Phone: ${phone}

Summary
- ${estimateDisplay.totalLine}
- ${estimateDisplay.federalLine}
- ${estimateDisplay.stateLine}

Link: ${estimateSummaryLink}

${internalAction}`;

  return {
    internalSubject,
    internalBody,
    clientSubject,
    clientBody
  };
}


async function updateLeadAfterStripePayment(leadId, applyUpdate) {
  const cleanId = String(leadId || "").trim();

  if (!cleanId) {
    return { ok: false, error: "Missing leadId." };
  }

  function matchesLeadId(obj = {}) {
    const estimate = obj.estimate || {};
    const possibleIds = [
      obj.leadId,
      obj.leadid,
      obj.lead_id,
      obj.id,
      obj.estimateId,
      estimate.leadId,
      estimate.leadid,
      estimate.lead_id,
      estimate.id,
      estimate.estimateId
    ];

    return possibleIds.some((id) => String(id || "").trim() === cleanId);
  }

  try {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[stripe webhook] Supabase lookup error:", error.message || error);
    }

    if (!error && Array.isArray(data)) {
      const matchingRow = data.find(matchesLeadId);

      if (matchingRow) {
        const updatedEstimate = applyUpdate(matchingRow.estimate || matchingRow);

        let updateQuery = supabase
          .from("leads")
          .update({ estimate: updatedEstimate });

        if (matchingRow.leadId) {
          updateQuery = updateQuery.eq("leadId", matchingRow.leadId);
        } else if (matchingRow.leadid) {
          updateQuery = updateQuery.eq("leadid", matchingRow.leadid);
        } else if (matchingRow.lead_id) {
          updateQuery = updateQuery.eq("lead_id", matchingRow.lead_id);
        } else if (matchingRow.id) {
          updateQuery = updateQuery.eq("id", matchingRow.id);
        } else {
          throw new Error("Matched Supabase row has no usable ID column.");
        }

        const { error: updateError } = await updateQuery;

        if (updateError) {
          console.error("[stripe webhook] Supabase update error:", updateError.message || updateError);
          return { ok: false, error: "Could not update Supabase lead." };
        }

        return { ok: true, source: "supabase" };
      }
    }
  } catch (err) {
    console.error("[stripe webhook] Supabase update failed:", err.message || err);
  }

  const localLeads = readLeads();
  const localIndex = localLeads.findIndex(matchesLeadId);

  if (localIndex >= 0) {
    localLeads[localIndex] = applyUpdate(localLeads[localIndex]);
    writeLeads(localLeads);
    return { ok: true, source: "local" };
  }

  return { ok: false, error: "Lead not found." };
}

async function applyStripePaidUpdate(leadId, paymentInfo = {}) {
  const nowIso = new Date().toISOString();
  const nowDisplay = new Date().toLocaleString();

  return updateLeadAfterStripePayment(leadId, function applyTranscriptPaid(record = {}) {
    const updated = { ...record };

    const existingTranscriptRequest =
      updated.transcriptRequest ||
      updated.Request ||
      {};

    const paymentNote =
      "[" + nowDisplay + "] Stripe confirmed IRS Transcript Help payment." +
      (paymentInfo.sessionId ? " Checkout Session: " + paymentInfo.sessionId + "." : "") +
      (paymentInfo.paymentIntentId ? " Payment Intent: " + paymentInfo.paymentIntentId + "." : "");

    updated.transcriptRequest = {
      ...existingTranscriptRequest,
      requested: true,
      paymentStatus: "Paid / Verified",
      paymentVerifiedAt: nowIso,
      paidAt: nowIso,
      stripeCheckoutSessionId: paymentInfo.sessionId || existingTranscriptRequest.stripeCheckoutSessionId || "",
      stripePaymentIntentId: paymentInfo.paymentIntentId || existingTranscriptRequest.stripePaymentIntentId || "",
      paymentSource: "Stripe Checkout",
      updatedAt: nowIso
    };

    // Keep legacy field in sync in case older dashboard code still checks it.
    updated.Request = {
      ...(updated.Request || {}),
      ...updated.transcriptRequest
    };

    updated.status = "Transcript Help - Paid / Needs Review";
    updated.updatedAt = nowIso;

    const oldNotes = typeof updated.notes === "string" ? updated.notes.trim() : "";
    updated.notes = oldNotes ? oldNotes + "\n" + paymentNote : paymentNote;

    return updated;
  });
}

async function applyWrittenReviewPaidUpdate(leadId, paymentInfo = {}) {
  const nowIso = new Date().toISOString();
  const nowDisplay = new Date().toLocaleString();

  return updateLeadAfterStripePayment(leadId, function applyWrittenPaid(record = {}) {
    const updated = { ...record };
    const existingWrittenReview = updated.writtenReview || {};
    const existingPayments = updated.payments || {};

    const paymentNote =
      "[" + nowDisplay + "] Stripe confirmed Written Estimate Red Flag Review payment." +
      (paymentInfo.sessionId ? " Checkout Session: " + paymentInfo.sessionId + "." : "") +
      (paymentInfo.paymentIntentId ? " Payment Intent: " + paymentInfo.paymentIntentId + "." : "");

    updated.writtenReview = {
      ...existingWrittenReview,
      requested: true,
      status: "Paid / Needs Written Review",
      paymentStatus: "Paid / Verified",
      paymentVerifiedAt: nowIso,
      paidAt: nowIso,
      stripeCheckoutSessionId: paymentInfo.sessionId || existingWrittenReview.stripeCheckoutSessionId || "",
      stripePaymentIntentId: paymentInfo.paymentIntentId || existingWrittenReview.stripePaymentIntentId || "",
      paymentSource: "Stripe Checkout",
      updatedAt: nowIso
    };

    updated.payments = {
      ...existingPayments,
      reviewStatus: "Paid / Verified",
      writtenReviewStatus: "Paid / Verified"
    };

    updated.paymentStatus = "Paid / Verified";
    updated.status = "Written Review - Paid / Needs Written Review";
    updated.updatedAt = nowIso;

    const oldNotes = typeof updated.notes === "string" ? updated.notes.trim() : "";
    updated.notes = oldNotes ? oldNotes + "\n" + paymentNote : paymentNote;

    return updated;
  });
}

// =============================================================================
// LOCAL ONLY: Simulate $150 transcript payment without Stripe charge
// =============================================================================

app.get("/api/dev/simulate-transcript-paid", async (req, res) => {
  try {
    const host = String(req.headers.host || "").toLowerCase();
    const isLocal =
      host.includes("localhost") ||
      host.includes("127.0.0.1");

    if (!isLocal && process.env.ALLOW_PAYMENT_SIMULATION !== "true") {
      return res.status(403).json({
        ok: false,
        error: "Payment simulation is disabled outside localhost."
      });
    }

    const leadId = String(req.query.leadId || "").trim();

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error: "Missing leadId. Example: /api/dev/simulate-transcript-paid?leadId=LEAD-123"
      });
    }

    const result = await applyStripePaidUpdate(leadId, {
      sessionId: "LOCAL_SIMULATED_CHECKOUT_SESSION",
      paymentIntentId: "LOCAL_SIMULATED_PAYMENT_INTENT"
    });

    return res.json({
      ok: result.ok,
      source: result.source || null,
      error: result.error || null,
      leadId
    });
  } catch (err) {
    console.error("[local payment simulation] Error:", err.message || err);
    return res.status(500).json({
      ok: false,
      error: "Local payment simulation failed."
    });
  }
});

// =============================================================================
// LOCAL ONLY: Simulate $29 written review payment without Stripe charge
// =============================================================================

app.get("/api/dev/simulate-written-review-paid", async (req, res) => {
  try {
    const host = String(req.headers.host || "").toLowerCase();
    const isLocal =
      host.includes("localhost") ||
      host.includes("127.0.0.1");

    if (!isLocal && process.env.ALLOW_PAYMENT_SIMULATION !== "true") {
      return res.status(403).json({
        ok: false,
        error: "Payment simulation is disabled outside localhost."
      });
    }

    const leadId = String(req.query.leadId || "").trim();

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error: "Missing leadId."
      });
    }

    const result = await applyWrittenReviewPaidUpdate(leadId, {
      sessionId: "LOCAL_SIMULATED_WRITTEN_REVIEW_SESSION",
      paymentIntentId: "LOCAL_SIMULATED_WRITTEN_REVIEW_PAYMENT"
    });

    return res.json({
      ok: result.ok,
      source: result.source || null,
      error: result.error || null,
      leadId
    });
  } catch (err) {
    console.error(
      "[written review payment simulation] Error:",
      err.message || err
    );

    return res.status(500).json({
      ok: false,
      error: "Local written review payment simulation failed."
    });
  }
});

// =============================================================================
// POST /api/written-review/:leadId/send-completed
// Sends the completed review email, then closes the lead only after email success.
// =============================================================================

async function findWrittenReviewLeadForDelivery(leadId) {
  const cleanId = String(leadId || "").trim();

  function matchesLeadId(obj = {}) {
    const estimate = obj.estimate || {};
    const possibleIds = [
      obj.leadId,
      obj.leadid,
      obj.lead_id,
      obj.id,
      obj.estimateId,
      estimate.leadId,
      estimate.leadid,
      estimate.lead_id,
      estimate.id,
      estimate.estimateId
    ];

    return possibleIds.some(
      (id) => String(id || "").trim() === cleanId
    );
  }

  try {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      const matchingRow = data.find(matchesLeadId);

      if (matchingRow) {
        return {
          ok: true,
          source: "supabase",
          lead: matchingRow.estimate || matchingRow
        };
      }
    }

    if (error) {
      console.error(
        "[written review delivery] Supabase lookup error:",
        error.message || error
      );
    }
  } catch (err) {
    console.error(
      "[written review delivery] Supabase lookup failed:",
      err.message || err
    );
  }

  const localLeads = readLeads();
  const localLead = localLeads.find(matchesLeadId);

  if (localLead) {
    return {
      ok: true,
      source: "local",
      lead: localLead
    };
  }

  return {
    ok: false,
    error: "Lead not found."
  };
}

app.post("/api/written-review/:leadId/send-completed", async (req, res) => {
  try {
    const leadId = String(req.params.leadId || "").trim();

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error: "Missing lead ID."
      });
    }

    const lookup = await findWrittenReviewLeadForDelivery(leadId);

    if (!lookup.ok || !lookup.lead) {
      return res.status(404).json({
        ok: false,
        error: lookup.error || "Lead not found."
      });
    }

    const lead = lookup.lead;
    const writtenReview = lead.writtenReview || {};

    if (
      writtenReview.deliveredAt ||
      writtenReview.completedAt ||
      String(lead.status || "").toLowerCase().includes("closed")
    ) {
      return res.status(409).json({
        ok: false,
        error: "This Written Review is already completed or delivered."
      });
    }

    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      return res.status(500).json({
        ok: false,
        error: "Gmail delivery is not configured."
      });
    }

    const host = String(req.headers.host || "").toLowerCase();
    const isLocal =
      host.includes("localhost") ||
      host.includes("127.0.0.1");

    const useOfficeEmail =
      isLocal &&
      req.body &&
      req.body.useOfficeEmail === true;

    const clientEmail =
      String(lead.contact?.email || "").trim();

    const recipient =
      useOfficeEmail
        ? EMAIL_USER
        : clientEmail;

    if (!recipient) {
      return res.status(400).json({
        ok: false,
        error: "The client does not have an email address."
      });
    }

    const clientName =
      String(lead.contact?.name || "Client").trim();

    const baseUrl =
      String(APP_BASE_URL || "").replace(/\/+$/, "");

    const reportUrl =
      baseUrl +
      "/written-review-report/" +
      encodeURIComponent(leadId);

    const subject =
      "Your Written Tax Estimate Red Flag Review Is Ready";

    const body =
`Hello ${clientName},

Your Written Tax Estimate Red Flag Review has been completed.

Open your completed review:
${reportUrl}

Please keep in mind that this review is based on the information entered into the tax estimator. It is not a filed tax return or a substitute for full tax preparation.

Thank you,

Greatest Business Solution LLC`;

    const emailResult = await transporter.sendMail({
      from: EMAIL_USER,
      to: recipient,
      subject,
      text: body
    });

    const nowIso = new Date().toISOString();
    const nowDisplay = new Date().toLocaleString();

    const closeResult = await updateLeadAfterStripePayment(
      leadId,
      function applyWrittenReviewDelivery(record = {}) {
        const updated = { ...record };
        const existingReview = updated.writtenReview || {};

        updated.writtenReview = {
          ...existingReview,
          status: "Completed / Delivered",
          completedAt: nowIso,
          deliveredAt: nowIso,
          emailSentAt: nowIso,
          deliveryMethod: "Email",
          deliveryRecipient: recipient,
          emailMessageId: emailResult.messageId || "",
          updatedAt: nowIso
        };

        updated.status = "Closed - Written Review Completed";
        updated.updatedAt = nowIso;

        const deliveryNote =
          "[" + nowDisplay + "] Written Review emailed and marked completed." +
          " Recipient: " + recipient + ".";

        const oldNotes =
          typeof updated.notes === "string"
            ? updated.notes.trim()
            : "";

        updated.notes =
          oldNotes
            ? oldNotes + "\n" + deliveryNote
            : deliveryNote;

        return updated;
      }
    );

    if (!closeResult.ok) {
      console.error(
        "[written review delivery] Email sent but closeout failed:",
        closeResult.error || closeResult
      );

      return res.status(500).json({
        ok: false,
        emailSent: true,
        error:
          "The email was sent, but the lead could not be moved to Closed Leads."
      });
    }

    return res.status(200).json({
      ok: true,
      emailSent: true,
      closed: true,
      recipient,
      source: closeResult.source,
      leadId
    });
  } catch (err) {
    console.error(
      "[written review delivery] Error:",
      err.message || err
    );

    return res.status(500).json({
      ok: false,
      error: "The completed Written Review could not be delivered."
    });
  }
});
// =============================================================================
// POST /api/stripe-webhook
// =============================================================================

app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET is not configured.");
    return res.status(500).send("Stripe webhook secret is not configured.");
  }

  const signature = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[stripe webhook] Signature verification failed:", err.message || err);
    return res.status(400).send("Webhook signature verification failed.");
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object || {};
      const service = session.metadata?.service || "";
      const leadId = session.metadata?.leadId || session.client_reference_id || "";

      if ((service === "irs_transcript_help" || service === "irs__help") && session.payment_status === "paid") {
        const result = await applyStripePaidUpdate(leadId, {
          sessionId: session.id,
          paymentIntentId: session.payment_intent
        });

        if (!result.ok) {
          console.error("[stripe webhook] Could not mark transcript lead paid:", result.error || result);
        } else {
          console.log("[stripe webhook] Transcript lead marked paid:", leadId, result.source);
        }
      }

      if (service === "written_review" && session.payment_status === "paid") {
        const result = await applyWrittenReviewPaidUpdate(leadId, {
          sessionId: session.id,
          paymentIntentId: session.payment_intent
        });

        if (!result.ok) {
          console.error("[stripe webhook] Could not mark written review paid:", result.error || result);
        } else {
          console.log("[stripe webhook] Written review marked paid:", leadId, result.source);
        }
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("[stripe webhook] Handler error:", err.message || err);
    return res.status(500).send("Webhook handler failed.");
  }
});

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============================================================================
// SEARCH ENGINE PROTECTION FOR PRIVATE / WORKFLOW PAGES
// Keep public homepage indexable, but prevent admin/customer-specific pages
// from appearing in Google search results.
// =============================================================================

app.use((req, res, next) => {
  const path = String(req.path || "").toLowerCase();

  const shouldNoIndex =
    path === "/leads-dashboard" ||
    path.startsWith("/leads-dashboard/") ||
    path.startsWith("/written-review-report/") ||
    path.startsWith("/client-tax-strategy-worksheet/") ||
    path.startsWith("/api/") ||
    path === "/stripe-thank-you";

  if (shouldNoIndex) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  }

  next();
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *
Disallow: /leads-dashboard
Disallow: /written-review-report/
Disallow: /client-tax-strategy-worksheet/
Disallow: /api/
Disallow: /stripe-thank-you

Allow: /
`);
});
app.use(express.static(path.join(__dirname, "ui"), {
  setHeaders: (res, filePath) => {
    const lowerFilePath = String(filePath || "").toLowerCase();

    const shouldNoIndexFile =
      lowerFilePath.endsWith("leads-dashboard.html") ||
      lowerFilePath.endsWith("written-review-report.html") ||
      lowerFilePath.endsWith("client-tax-strategy-worksheet.html") ||
      lowerFilePath.endsWith("stripe-thank-you.html");

    if (shouldNoIndexFile) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    }
  }
}));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// =============================================================================
// POST /api/estimate
// =============================================================================

app.post("/api/estimate", (req, res) => {
  try {
    const leadId = result?.leadId || result?.id || req.body?.leadId;

    if (leadId) {
      clientCore.getOrCreateClient(leadId, {
        name: (req.body?.firstName || "") + " " + (req.body?.lastName || ""),
        email: req.body?.email || ""
      });
    }
  } catch (err) {
    console.log("[clientCore] mirror failed:", err.message);
  }

  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({
      ok: false,
      errors: ["Request body is missing or not valid JSON."]
    });
  }

  let engineResult;
  try {
    engineResult = estimate(req.body);
  } catch (err) {
    console.error("[/api/estimate] Engine error:", err);
    return res.status(500).json({
      ok: false,
      errors: ["Internal server error. Please try again or contact support."]
    });
  }

  if (!engineResult.ok) {
    return res.status(400).json({
      ok: false,
      errors: engineResult.errors || ["Validation failed. Please check your inputs."]
    });
  }

  return res.status(200).json({
    ok: true,
    result: engineResult.result
  });
});

// =============================================================================
// POST /api/lead
// =============================================================================

app.post("/api/lead", async (req, res) => {
  const { name, email, phone, priority, taxData, estimateSummary, status, notes } = req.body;

  const errors = [];

  if (!name || typeof name !== "string" || !name.trim()) {
    errors.push("Full name is required.");
  }

  if (!email || typeof email !== "string" || !email.trim()) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.push("Email address format is invalid.");
  }

  if (errors.length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  const leadId = `LEAD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const formattedPhone = formatPhoneNumber(phone);

  const lead = {
    leadId,
    timestamp: new Date().toISOString(),
    priority: priority || "low",
    status: status || "New",
    notes: notes || "",
    contact: {
      name: name.trim(),
      email: email.trim(),
      phone: formattedPhone || null
    },
    taxData: taxData || null,
    estimateSummary: estimateSummary || {}
  };

  // ðŸ”¥ Build summary lines for dashboard
  if (lead.estimateSummary) {
    const e = lead.estimateSummary;

    const federal = e.federal?.net || 0;
    const state = e.state?.net || 0;
    const combined = (federal + state);

    lead.estimateSummary.federalLine =
      federal > 0
        ? `Federal Refund: $${Math.round(federal).toLocaleString()}`
        : federal < 0
          ? `Federal Due: $${Math.abs(Math.round(federal)).toLocaleString()}`
          : `Federal: $0`;

    lead.estimateSummary.stateLine =
      state > 0
        ? `State Refund: $${Math.round(state).toLocaleString()}`
        : state < 0
          ? `State Due: $${Math.abs(Math.round(state)).toLocaleString()}`
          : `State: $0`;

    lead.estimateSummary.totalLine =
      combined > 0
        ? `Estimated Total Refund: $${Math.round(combined).toLocaleString()}`
        : combined < 0
          ? `Estimated Total Due: $${Math.abs(Math.round(combined)).toLocaleString()}`
          : `Break-even`;
  }


  let savedLead;

  try {
    savedLead = await appendLead(lead);
    recentLeads.set(savedLead.leadId, savedLead);
  } catch (err) {
    console.error("[/api/lead] Save error:", err);
    return res.status(500).json({
      ok: false,
      errors: ["Could not save your request. Please try again."]
    });
  }

  console.log("Lead saved successfully:", savedLead.leadId);
  console.log("Email sending skipped on live deploy for now.");

  return res.status(201).json({
    ok: true,
    leadId: savedLead.leadId,
    message: "Your request has been received. A tax professional will contact you within 1 business day."
  });
});

// =============================================================================
// GET /api/estimate-summary/:leadId
// =============================================================================

app.get("/api/estimate-summary/:leadId", async (req, res) => {
  const { leadId } = req.params;
  const cleanId = String(leadId || "").trim();

  const findLeadById = (leadList) => {
    return (leadList || []).find((lead) => {
      const estimate = lead?.estimate || {};

      const possibleIds = [
        lead?.leadId,
        lead?.leadid,
        lead?.lead_id,
        lead?.id,
        lead?.estimateId,
        lead?.estimate_id,
        estimate?.leadId,
        estimate?.leadid,
        estimate?.lead_id,
        estimate?.id,
        estimate?.estimateId,
        estimate?.estimate_id
      ];

      return possibleIds.some((id) => String(id || "").trim() === cleanId);
    });
  };

  try {
    let supabaseLeads = [];
    let localLeads = [];
    let foundLead = null;
    let foundSource = null;

    try {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Summary Supabase lookup error:", error.message || error);
      }

      if (!error && Array.isArray(data)) {
        supabaseLeads = data.map(mapRowToLead);
        foundLead = findLeadById(supabaseLeads);

        if (foundLead) {
          foundSource = "supabase";
        }
      }
    } catch (supabaseErr) {
      console.error("Summary Supabase lookup failed:", supabaseErr.message || supabaseErr);
    }

    if (!foundLead) {
      localLeads = readLeads();
      foundLead = findLeadById(localLeads);

      if (foundLead) {
        foundSource = "local";
      }
    }

    console.log("[estimate-summary lookup]", {
      requestedLeadId: cleanId,
      supabaseCount: supabaseLeads.length,
      localCount: localLeads.length,
      found: Boolean(foundLead),
      source: foundSource
    });

    if (!foundLead) {
      return res.status(404).json({
        ok: false,
        error: "Estimate not found.",
        requestedLeadId: cleanId,
        supabaseCount: supabaseLeads.length,
        localCount: localLeads.length
      });
    }

    if (!localLeads.length) {
      localLeads = readLeads();
    }

    const localLeadForRequest = findLeadById(localLeads);
    const mergedRequest =
      foundLead.Request ||
      foundLead.request ||
      localLeadForRequest?.Request ||
      localLeadForRequest?.request ||
      null;

    return res.status(200).json({
      ok: true,
      source: foundSource,
      lead: {
        leadId: foundLead.leadId || foundLead.id || foundLead.estimateId || foundLead.lead_id,
        timestamp: foundLead.timestamp || foundLead.created_at || null,
        status: foundLead.status || "New",
        priority: foundLead.priority || "medium",
        notes: foundLead.notes || "",
        estimateSummary: foundLead.estimateSummary || null,
        taxData: foundLead.taxData || null,
        contact: foundLead.contact || null,
        Request: mergedRequest,
        request: mergedRequest
      }
    });
  } catch (err) {
    console.error("Estimate fetch error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// =============================================================================
// GET /estimate/:leadId (serves HTML page)
// =============================================================================

app.get("/estimate/:leadId", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "estimate-summary.html"));
});

// =============================================================================
// PATCH /api/leads/:leadId
// =============================================================================

app.patch("/api/leads/:leadId", async (req, res) => {
  const { leadId } = req.params;
  const { status, notes, Request } = req.body;
  const cleanId = String(leadId || "").trim();

  const findMatchingRow = (rows) => {
    return (rows || []).find((row) => {
      const estimate = row.estimate || {};

      const possibleIds = [
        row.leadId,
        row.leadid,
        row.lead_id,
        row.id,
        estimate.leadId,
        estimate.leadid,
        estimate.lead_id,
        estimate.id
      ];

      return possibleIds.some((id) => String(id || "").trim() === cleanId);
    });
  };

  const applyUpdateToEstimate = (estimate = {}) => {
    const updatedEstimate = { ...estimate };

    if (typeof status === "string" && status.trim()) {
      updatedEstimate.status = status.trim();
    }

    if (typeof notes === "string") {
      updatedEstimate.notes = notes;
    }

    if (Request && typeof Request === "object" && !Array.isArray(Request)) {
      updatedEstimate.Request = {
        ...(updatedEstimate.Request || {}),
        ...Request,
        updatedAt: new Date().toISOString()
      };
    }

    return updatedEstimate;
  };

  try {
    // First try Supabase using the same broad lookup style as the estimate summary route.
    try {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[PATCH /api/leads] Supabase lookup error:", error.message || error);
      }

      if (!error && Array.isArray(data)) {
        const matchingRow = findMatchingRow(data);

        if (matchingRow) {
          const updatedEstimate = applyUpdateToEstimate(matchingRow.estimate || {});

          let updateQuery = supabase
            .from("leads")
            .update({ estimate: updatedEstimate });

          if (matchingRow.leadId) {
            updateQuery = updateQuery.eq("leadId", matchingRow.leadId);
          } else if (matchingRow.leadid) {
            updateQuery = updateQuery.eq("leadid", matchingRow.leadid);
          } else if (matchingRow.lead_id) {
            updateQuery = updateQuery.eq("lead_id", matchingRow.lead_id);
          } else if (matchingRow.id) {
            updateQuery = updateQuery.eq("id", matchingRow.id);
          } else {
            throw new Error("Matched Supabase row has no usable ID column.");
          }

          const { error: updateError } = await updateQuery;

          if (updateError) {
            console.error("[PATCH /api/leads] Supabase update error:", updateError.message || updateError);
            return res.status(500).json({
              ok: false,
              error: "Could not update lead."
            });
          }

          const updatedLead = mapRowToLead({
            ...matchingRow,
            estimate: updatedEstimate
          });

          recentLeads.set(updatedLead.leadId, updatedLead);

          return res.status(200).json({
            ok: true,
            source: "supabase",
            lead: updatedLead
          });
        }
      }
    } catch (supabaseErr) {
      console.error("[PATCH /api/leads] Supabase update failed:", supabaseErr.message || supabaseErr);
    }

    // Fallback: update local  if the lead was found there.
    const localLeads = readLeads();
    const localIndex = localLeads.findIndex((lead) => {
      const possibleIds = [
        lead?.leadId,
        lead?.id,
        lead?.estimateId,
        lead?.lead_id
      ];

      return possibleIds.some((id) => String(id || "").trim() === cleanId);
    });

    if (localIndex >= 0) {
      const localLead = localLeads[localIndex];

      if (typeof status === "string" && status.trim()) {
        localLead.status = status.trim();
      }

      if (typeof notes === "string") {
        localLead.notes = notes;
      }

      if (Request && typeof Request === "object" && !Array.isArray(Request)) {
        localLead.Request = {
          ...(localLead.Request || {}),
          ...Request,
          updatedAt: new Date().toISOString()
        };
      }

      localLeads[localIndex] = localLead;
      writeLeads(localLeads);
      recentLeads.set(localLead.leadId, localLead);

      return res.status(200).json({
        ok: true,
        source: "local",
        lead: localLead
      });
    }

    return res.status(404).json({
      ok: false,
      error: "Lead not found.",
      requestedLeadId: cleanId
    });
  } catch (err) {
    console.error("[PATCH /api/leads] Unexpected error:", err);
    return res.status(500).json({
      ok: false,
      error: "Could not update lead."
    });
  }
});


// =============================================================================
// GET /client-tax-strategy-worksheet/:leadId
// =============================================================================
app.get("/client-tax-strategy-worksheet/:leadId", (req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.sendFile(path.join(__dirname, "ui", "client-tax-strategy-worksheet.html"));
});
// =============================================================================
// GET /tax-prep-request/:leadId
// =============================================================================
app.get("/tax-prep-request/:leadId", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "tax-prep-request.html"));
});

// =============================================================================
// GET /transcript-help-request/:leadId
// =============================================================================
app.get("/transcript-help-request/:leadId", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "transcript-help-request.html"));
});
// =============================================================================
// GET /leads-dashboard
// =============================================================================


// =============================================================================
// POST /api/create-transcript-checkout
// =============================================================================

app.post("/api/create-transcript-checkout", async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Stripe secret key is not configured."
      });
    }

    const body = req.body || {};
    const leadId = String(body.leadId || "").trim();
    const clientName = String(body.clientName || "").trim();
    const clientEmail = String(body.clientEmail || "").trim();

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error: "Lead ID is required before checkout can be created."
      });
    }

    if (!clientEmail) {
      return res.status(400).json({
        ok: false,
        error: "Client email is required before checkout can be created."
      });
    }

    const amount = Number(process.env.TRANSCRIPT_HELP_PRICE_CENTS || 15000);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: leadId,
      customer_email: clientEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "IRS Transcript Help & Tax Records Review",
              description: "One-time transcript help service. Authorization and identity verification are required before IRS records can be accessed."
            },
            unit_amount: amount
          },
          quantity: 1
        }
      ],
      metadata: {
        leadId,
        clientName,
        clientEmail,
        service: "irs_transcript_help"
      },
      success_url: `${APP_BASE_URL}/transcript-help-next.html?checkout=success&leadId=${encodeURIComponent(leadId)}`,
      cancel_url: `${APP_BASE_URL}/transcript-help-next.html?checkout=cancelled&leadId=${encodeURIComponent(leadId)}`
    });

    return res.status(200).json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (err) {
    console.error("[create-transcript-checkout] Error:", err.message || err);
    return res.status(500).json({
      ok: false,
      error: "Could not create Stripe checkout session."
    });
  }
});
app.get("/written-review-report/:leadId", (req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.sendFile(path.join(__dirname, "ui", "written-review-report.html"));
});

app.get("/transcript-requests", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "transcript-requests.html"));
});
app.get("/-requests", (req, res) => { res.sendFile(path.join(__dirname, "ui", "-requests.html")); });

app.get("/leads-dashboard", (req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.sendFile(path.join(__dirname, "ui", "leads-dashboard.html"));
});

app.get("/-thank-you", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "-thank-you.html"));
});

// =============================================================================
// GET /stripe-thank-you
// =============================================================================

app.get("/stripe-thank-you", (req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.sendFile(path.join(__dirname, "ui", "stripe-thank-you.html"));
});

// =============================================================================
// GET /api/leads
// =============================================================================

app.get("/api/leads", async (req, res) => {
  try {
    const includeLocal =
      String(req.query.includeLocal || "").trim() === "1";

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const supabaseLeads = (data || []).map(mapRowToLead);

    if (!includeLocal) {
      return res.status(200).json({
        ok: true,
        source: "supabase",
        count: supabaseLeads.length,
        leads: supabaseLeads
      });
    }

    const localLeads = readLeads();
    const mergedById = new Map();

    supabaseLeads.forEach((lead) => {
      const id = String(lead?.leadId || "");
      if (id) mergedById.set(id, lead);
    });

    localLeads.forEach((localLead) => {
      const id = String(localLead?.leadId || localLead?.id || localLead?.estimateId || localLead?.lead_id || "");
      if (!id) return;

      const existing = mergedById.get(id);

      if (existing) {
        mergedById.set(id, {
          ...existing,
          ...localLead,
          contact: {
            ...(existing.contact || {}),
            ...(localLead.contact || {})
          },
          taxData: localLead.taxData || existing.taxData,
          estimateSummary: localLead.estimateSummary || existing.estimateSummary,
          Request: {
            ...(existing.Request || existing.request || {}),
            ...(localLead.Request || localLead.request || {})
          }
        });
      } else {
        mergedById.set(id, localLead);
      }
    });

    const leads = Array.from(mergedById.values());

    return res.status(200).json({
      ok: true,
      source: "supabase+local",
      count: leads.length,
      leads
    });
  } catch (err) {
    console.error("Supabase load leads failed. Loading local instead:", err.message || err);

    const leads = readLeads();

    return res.status(200).json({
      ok: true,
      source: "local-fallback",
      count: leads.length,
      leads
    });
  }
});

// =============================================================================
// FALLBACK
// =============================================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "index.html"));
});

// =============================================================================
// GLOBAL ERROR HANDLER
// =============================================================================

app.use((err, req, res, next) => {
  console.error("[Unhandled error]", err);
  res.status(500).json({
    ok: false,
    errors: ["An unexpected error occurred. Please try again."]
  });
});

// =============================================================================
// START
// =============================================================================

app.post("/api/-help", (req, res) => {
  try {
    const body = req.body || {};

    const clientName = String(body.clientName || "").trim();
    const clientEmail = String(body.clientEmail || "").trim();
    const clientPhone = String(body.clientPhone || "").trim();
    const taxYear = String(body.taxYear || "").trim();
    const multipleYears = String(body.multipleYears || "").trim();
    const issueType = String(body.issueType || "").trim();
    const Type = String(body.Type || "Not sure / preparer review needed").trim();
    const clientExplanation = String(body.clientExplanation || "").trim();

    if (!clientName || !clientEmail || !clientPhone || !taxYear || !issueType || !clientExplanation) {
      return res.status(400).json({
        ok: false,
        error: "Missing required  help request fields."
      });
    }

    if (taxYear === "Multiple Years" && !multipleYears) {
      return res.status(400).json({
        ok: false,
        error: "Please enter the tax years needed."
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const leadId = `-${Date.now()}`;
    const taxYearForLead = taxYear === "Multiple Years" && multipleYears ? multipleYears : taxYear;

    const notes = [
      `[${nowIso}] Client submitted  Help Request.`,
      `Issue Type: ${issueType}`,
      `Tax Year Needed: ${taxYearForLead}`,
      ` Type Selected: ${Type}`,
      `Client Explanation: ${clientExplanation}`,
      `Payment Status: Requested / Waiting for Payment Verification`,
      `Authorization Status: Not requested yet`
    ].join("\n");

    const leads = readLeads();

    const newLead = {
      leadId,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: " Help - Payment Pending",
      priority: "high",
      source: " Help Request Page",
      contact: {
        name: clientName,
        email: clientEmail,
        phone: clientPhone
      },
      taxData: {
        taxYear: taxYearForLead
      },
      notes,
      Request: {
        requested: true,
        requestedAt: nowIso,
        serviceName: "IRS  Help & Tax Records Review",
        issueType,
        Type,
        clientExplanation,
        taxYear,
        multipleYears,
        paymentStatus: "Requested / Waiting for Payment Verification",
        authorizationStatus: "Not requested yet",
        authorizationReceivedDate: "",
        PulledDate: "",
        ReceivedDate: "",
        deliveryMethod: "",
        deliveryDate: "",
        mailCertifiedFee: "",
        errorStatus: "No error",
        internalNotes: "New client-facing  help request submitted.",
        fee: "$150 flat service fee"
      }
    };

    leads.unshift(newLead);
    writeLeads(leads);

    res.json({
      ok: true,
      leadId,
      message: " help request saved."
    });
  } catch (err) {
    console.error("[-help] Save error:", err);
    res.status(500).json({
      ok: false,
      error: "Could not save  help request."
    });
  }
});

app.delete("/api/leads/:leadId", (req, res) => {
  try {
    const leadId = String(req.params.leadId || "").trim();

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error: "Lead ID is required."
      });
    }

    const leads = readLeads();
    const originalCount = leads.length;

    const updatedLeads = leads.filter((lead) => String(lead.leadId) !== leadId);

    if (updatedLeads.length === originalCount) {
      return res.status(404).json({
        ok: false,
        error: "Lead was not found."
      });
    }

    writeLeads(updatedLeads);

    return res.json({
      ok: true,
      removed: true,
      leadId
    });
  } catch (err) {
    console.error("[leads] Delete error:", err);

    return res.status(500).json({
      ok: false,
      error: "Could not delete lead."
    });
  }
});

// =============================================================================
// POST /api/create-written-review-checkout
// =============================================================================

app.post("/api/create-written-review-checkout", async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Stripe secret key is not configured."
      });
    }

    const body = req.body || {};
    const leadId = String(body.leadId || "").trim();
    const clientName = String(body.clientName || "").trim();
    const clientEmail = String(body.clientEmail || "").trim();

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error: "Lead ID is required before checkout can be created."
      });
    }

    if (!clientEmail) {
      return res.status(400).json({
        ok: false,
        error: "Client email is required before checkout can be created."
      });
    }

    const amount = Number(process.env.WRITTEN_REVIEW_PRICE_CENTS || 2900);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: leadId,
      customer_email: clientEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Written Estimate Red Flag Review",
              description: "One-time written review of the tax estimate for possible red flags, missing items, and next-step guidance. This is not full tax preparation."
            },
            unit_amount: amount
          },
          quantity: 1
        }
      ],
      metadata: {
        leadId,
        clientName,
        clientEmail,
        service: "written_review"
      },
      success_url: `${APP_BASE_URL}/stripe-thank-you?service=written-review&leadId=${encodeURIComponent(leadId)}`,
      cancel_url: `${APP_BASE_URL}/estimate/${encodeURIComponent(leadId)}?checkout=cancelled`
    });

    return res.status(200).json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (err) {
    console.error("[create-written-review-checkout] Error:", err.message || err);
    return res.status(500).json({
      ok: false,
      error: "Could not create Written Review Stripe checkout session."
    });
  }
});

// =============================================================================
// GET /api/debug/supabase-leads
// Safe diagnostic: does not expose secret keys
// =============================================================================

app.get("/api/debug/supabase-leads", async (req, res) => {
  try {
    const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasAnonKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    let result = {
      ok: false,
      hasUrl,
      hasAnonKey,
      table: "leads"
    };

    if (!hasUrl || !hasAnonKey) {
      return res.status(200).json({
        ...result,
        error: "Missing Supabase environment variable on this server."
      });
    }

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .limit(5);

    if (error) {
      return res.status(200).json({
        ...result,
        error: error.message || String(error),
        code: error.code || null,
        details: error.details || null,
        hint: error.hint || null
      });
    }

    return res.status(200).json({
      ok: true,
      hasUrl,
      hasAnonKey,
      table: "leads",
      countReturned: Array.isArray(data) ? data.length : 0,
      sampleLeadIds: Array.isArray(data)
        ? data.map(row => row.leadId || row.leadid || row.lead_id || row.id || null)
        : []
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  }
});

app.listen(PORT, () => {
  console.log("=".repeat(54));
  console.log("  Greatest Business Solution LLC");
  console.log("  Tax Estimator + Lead Capture Server");
  console.log("=".repeat(54));
  console.log(`  App      : http://localhost:${PORT}`);
  console.log(`  Estimate : POST /api/estimate`);
  console.log(`  Lead     : POST /api/lead`);
  console.log(`  View     : GET  /api/leads`);
  console.log(`  Leads DB : ${LEADS_FILE}`);
  console.log("=".repeat(54));
});

module.exports = app;









app.get("/api/leads", (req, res) => {
  try {
    const clients = clientCore.getClientMasterData();
    return res.json(clients || []);
  } catch (err) {
    console.log("[clientCore] fallback to legacy ");
    const fs = require("fs");
    const data = fs.existsSync("")
      ? JSON.parse(fs.readFileSync("", "utf8"))
      : [];
    return res.json(data);
  }
});

function getOfficeWorkQueue() {
  try {
    const clients = clientCore.getClientMasterData() || [];

    return clients.filter(c =>
      c.lifecycle?.stage === "lead" ||
      c.transcript?.status !== "none" ||
      c.payments?.transcriptPaid === true ||
      c.payments?.estimateReviewPaid === true
    );
  } catch (err) {
    console.log("[queue] clientCore fallback error:", err.message);
    return [];
  }
}

function getClientMasterData() {
  try {
    const clients = clientCore.getClientMasterData() || [];
    return clients;
  } catch (err) {
    console.log("[master] fallback error:", err.message);
    return [];
  }
}


function updateClientTranscript(leadId, update) {
  try {
    const client = clientCore.getOrCreateClient(leadId);

    client.transcript = {
      ...client.transcript,
      ...update
    };

    clientCore.updateClient(leadId, client);

    return client;
  } catch (err) {
    console.log("[transcript merge error]", err.message);
  }
}





























