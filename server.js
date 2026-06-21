"use strict";

const express = require("express");
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

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "greatestbusiness1@gmail.com",
    pass: "mnqe aasn cenb tszu"
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
    console.error("Supabase insert failed. Saving to local leads.json instead:", err.message || err);

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

  return {
    leadId: row.leadId || estimate.leadId || "",
    timestamp: estimate.timestamp || row.created_at || "",
    priority: estimate.priority || "medium",
    status: estimate.status || "New",
    notes: estimate.notes || "",
    contact: estimate.contact || {
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || ""
    },
    taxData: estimate.taxData || null,
    estimateSummary: estimate.estimateSummary || {},
    transcriptRequest: estimate.transcriptRequest || row.transcriptRequest || null
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


async function applyStripePaidTranscriptUpdate(leadId, paymentInfo = {}) {
  const cleanId = String(leadId || "").trim();

  if (!cleanId) {
    return { ok: false, error: "Missing leadId." };
  }

  const nowIso = new Date().toISOString();
  const nowDisplay = new Date().toLocaleString();

  const paymentNote =
    "[" + nowDisplay + "] Stripe confirmed IRS Transcript Help payment." +
    (paymentInfo.sessionId ? " Checkout Session: " + paymentInfo.sessionId + "." : "") +
    (paymentInfo.paymentIntentId ? " Payment Intent: " + paymentInfo.paymentIntentId + "." : "");

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

  function applyPaidUpdate(record = {}) {
    const updated = { ...record };

    const existingTranscriptRequest = updated.transcriptRequest || {};
    updated.transcriptRequest = {
      ...existingTranscriptRequest,
      requested: true,
      paymentStatus: "Paid / Verified",
      paymentVerifiedAt: nowIso,
      paidAt: nowIso,
      stripeCheckoutSessionId: paymentInfo.sessionId || existingTranscriptRequest.stripeCheckoutSessionId || "",
      stripePaymentIntentId: paymentInfo.paymentIntentId || existingTranscriptRequest.stripePaymentIntentId || "",
      paymentSource: "Stripe Checkout"
    };

    updated.status = "Transcript Help - Paid / Needs Review";
    updated.updatedAt = nowIso;

    const oldNotes = typeof updated.notes === "string" ? updated.notes.trim() : "";
    updated.notes = oldNotes ? oldNotes + "\n" + paymentNote : paymentNote;

    return updated;
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
        const updatedEstimate = applyPaidUpdate(matchingRow.estimate || {});

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
    localLeads[localIndex] = applyPaidUpdate(localLeads[localIndex]);
    writeLeads(localLeads);
    return { ok: true, source: "local" };
  }

  return { ok: false, error: "Lead not found." };
}


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

      if (service === "irs_transcript_help" && session.payment_status === "paid") {
        const result = await applyStripePaidTranscriptUpdate(leadId, {
          sessionId: session.id,
          paymentIntentId: session.payment_intent
        });

        if (!result.ok) {
          console.error("[stripe webhook] Could not mark transcript lead paid:", result.error || result);
        } else {
          console.log("[stripe webhook] Transcript lead marked paid:", leadId, result.source);
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
app.use(express.static(path.join(__dirname, "ui")));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// =============================================================================
// POST /api/estimate
// =============================================================================

app.post("/api/estimate", (req, res) => {
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
      const possibleIds = [
        lead?.leadId,
        lead?.id,
        lead?.estimateId,
        lead?.lead_id
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
        contact: foundLead.contact || null
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
  const { status, notes, transcriptRequest } = req.body;
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

    if (transcriptRequest && typeof transcriptRequest === "object" && !Array.isArray(transcriptRequest)) {
      updatedEstimate.transcriptRequest = {
        ...(updatedEstimate.transcriptRequest || {}),
        ...transcriptRequest,
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

    // Fallback: update local leads.json if the lead was found there.
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

      if (transcriptRequest && typeof transcriptRequest === "object" && !Array.isArray(transcriptRequest)) {
        localLead.transcriptRequest = {
          ...(localLead.transcriptRequest || {}),
          ...transcriptRequest,
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
      cancel_url: `${APP_BASE_URL}/?checkout=cancelled&leadId=${encodeURIComponent(leadId)}`
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
  res.sendFile(path.join(__dirname, "ui", "written-review-report.html"));
});

app.get("/transcript-requests", (req, res) => { res.sendFile(path.join(__dirname, "ui", "transcript-requests.html")); });

app.get("/leads-dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "leads-dashboard.html"));
});

app.get("/transcript-thank-you", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "transcript-thank-you.html"));
});

// =============================================================================
// GET /stripe-thank-you
// =============================================================================

app.get("/stripe-thank-you", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "stripe-thank-you.html"));
});

// =============================================================================
// GET /api/leads
// =============================================================================

app.get("/api/leads", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const leads = (data || []).map(mapRowToLead);

    return res.status(200).json({
      ok: true,
      source: "supabase",
      count: leads.length,
      leads
    });
  } catch (err) {
    console.error("Supabase load leads failed. Loading local leads.json instead:", err.message || err);

    const leads = readLeads();

    return res.status(200).json({
      ok: true,
      source: "local",
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

app.post("/api/transcript-help", (req, res) => {
  try {
    const body = req.body || {};

    const clientName = String(body.clientName || "").trim();
    const clientEmail = String(body.clientEmail || "").trim();
    const clientPhone = String(body.clientPhone || "").trim();
    const taxYear = String(body.taxYear || "").trim();
    const multipleYears = String(body.multipleYears || "").trim();
    const issueType = String(body.issueType || "").trim();
    const transcriptType = String(body.transcriptType || "Not sure / preparer review needed").trim();
    const clientExplanation = String(body.clientExplanation || "").trim();

    if (!clientName || !clientEmail || !clientPhone || !taxYear || !issueType || !clientExplanation) {
      return res.status(400).json({
        ok: false,
        error: "Missing required transcript help request fields."
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
    const leadId = `transcript-${Date.now()}`;
    const taxYearForLead = taxYear === "Multiple Years" && multipleYears ? multipleYears : taxYear;

    const notes = [
      `[${nowIso}] Client submitted Transcript Help Request.`,
      `Issue Type: ${issueType}`,
      `Tax Year Needed: ${taxYearForLead}`,
      `Transcript Type Selected: ${transcriptType}`,
      `Client Explanation: ${clientExplanation}`,
      `Payment Status: Requested / Waiting for Payment Verification`,
      `Authorization Status: Not requested yet`
    ].join("\n");

    const leads = readLeads();

    const newLead = {
      leadId,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: "Transcript Help - Payment Pending",
      priority: "high",
      source: "Transcript Help Request Page",
      contact: {
        name: clientName,
        email: clientEmail,
        phone: clientPhone
      },
      taxData: {
        taxYear: taxYearForLead
      },
      notes,
      transcriptRequest: {
        requested: true,
        requestedAt: nowIso,
        serviceName: "IRS Transcript Help & Tax Records Review",
        issueType,
        transcriptType,
        clientExplanation,
        taxYear,
        multipleYears,
        paymentStatus: "Requested / Waiting for Payment Verification",
        authorizationStatus: "Not requested yet",
        authorizationReceivedDate: "",
        transcriptPulledDate: "",
        transcriptReceivedDate: "",
        deliveryMethod: "",
        deliveryDate: "",
        mailCertifiedFee: "",
        errorStatus: "No error",
        internalNotes: "New client-facing transcript help request submitted.",
        fee: "$150 flat service fee"
      }
    };

    leads.unshift(newLead);
    writeLeads(leads);

    res.json({
      ok: true,
      leadId,
      message: "Transcript help request saved."
    });
  } catch (err) {
    console.error("[transcript-help] Save error:", err);
    res.status(500).json({
      ok: false,
      error: "Could not save transcript help request."
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





