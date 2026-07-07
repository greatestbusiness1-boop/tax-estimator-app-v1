"use strict";

const express = require("express");
const clientCore = require("./server/clientCore");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
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
      estimateSummary: lead.estimateSummary,
      taxPreparationIntake: lead.taxPreparationIntake || null,
      contactRequest: lead.contactRequest || null
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

function buildFreeEstimatePdfBuffer(lead = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "LETTER",
        margins: {
          top: 42,
          bottom: 42,
          left: 48,
          right: 48
        },
        info: {
          Title: "Free Tax Estimate",
          Author: "Greatest Business Solution LLC",
          Subject: "Free Tax Estimate Summary"
        }
      });

      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const contact = lead.contact || {};
      const taxData = lead.taxData || {};
      const estimateSummary = lead.estimateSummary || {};
      const estimateDisplay =
        buildEstimateDisplay(estimateSummary);

      const federal =
        estimateSummary.federal || {};

      const state =
        estimateSummary.state || {};

      const taxYear =
        taxData.taxYear ||
        estimateSummary.taxYear ||
        "Not provided";

      const rawFilingStatus =
        String(
          taxData.filingStatus ||
          estimateSummary.filingStatus ||
          "Not provided"
        )
          .trim()
          .toLowerCase();

      const filingStatusMap = {
        single: "Single",
        married_filing_jointly:
          "Married Filing Jointly",
        marriedfilingjointly:
          "Married Filing Jointly",
        mfj:
          "Married Filing Jointly",
        married_filing_separately:
          "Married Filing Separately",
        marriedfilingseparately:
          "Married Filing Separately",
        mfs:
          "Married Filing Separately",
        head_of_household:
          "Head of Household",
        headofhousehold:
          "Head of Household",
        hoh:
          "Head of Household",
        qualifying_surviving_spouse:
          "Qualifying Surviving Spouse",
        qss:
          "Qualifying Surviving Spouse"
      };

      const filingStatus =
        filingStatusMap[rawFilingStatus] ||
        rawFilingStatus
          .replace(/_/g, " ")
          .replace(/\b\w/g, (letter) =>
            letter.toUpperCase()
          );

      const formatMoney = (value) =>
        "$" +
        Math.round(Number(value || 0))
          .toLocaleString("en-US");

      const logoPath =
        path.join(
          __dirname,
          "ui",
          "logo.png"
        );

      const baseUrl =
        String(APP_BASE_URL || "")
          .trim()
          .replace(/\/+$/, "");

      const summaryUrl =
        baseUrl +
        "/estimate/" +
        encodeURIComponent(lead.leadId || "");

      const bookingUrl =
        "https://calendly.com/ngmsllc/tax-estimate-review-15-minutes";

      const taxReturnIntakeUrl =
        baseUrl +
        "/start-my-tax-return?leadId=" +
        encodeURIComponent(lead.leadId || "");

      const contactEmail =
        "alerts@taxestimatereview.com";

      const addLabelValue = (label, value) => {
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor("#1f2937")
          .text(label, {
            continued: true
          });

        doc
          .font("Helvetica")
          .fillColor("#111827")
          .text(" " + String(value || "Not provided"));
      };

      if (fs.existsSync(logoPath)) {
        doc.image(
          logoPath,
          48,
          34,
          {
            fit: [230, 90],
            align: "left"
          }
        );
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(20)
        .fillColor("#0f2f59")
        .text(
          "FREE TAX ESTIMATE",
          290,
          48,
          {
            width: 270,
            align: "right"
          }
        );

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#6b7280")
        .text(
          "Prepared for your records",
          290,
          76,
          {
            width: 270,
            align: "right"
          }
        );

      doc.y = 128;

      doc
        .strokeColor("#c69a37")
        .lineWidth(2)
        .moveTo(48, doc.y)
        .lineTo(564, doc.y)
        .stroke();

      doc.moveDown(1);

      addLabelValue(
        "Prepared for:",
        contact.name || "Client"
      );

      addLabelValue(
        "Tax year:",
        taxYear
      );

      addLabelValue(
        "Filing status:",
        filingStatus
      );

      addLabelValue(
        "Reference number:",
        lead.leadId || "Not available"
      );

      doc.moveDown(0.8);

      doc
        .font("Helvetica-Bold")
        .fontSize(15)
        .fillColor("#0f2f59")
        .text("Estimated Results");

      doc.moveDown(0.45);

      const resultRows = [
        {
          label: "Federal",
          value:
            estimateDisplay.federalLine ||
            "Federal: $0"
        },
        {
          label: "State",
          value:
            estimateDisplay.stateLine ||
            "State: $0"
        },
        {
          label: "Combined",
          value:
            estimateDisplay.totalLine ||
            "Estimated break-even"
        }
      ];

      resultRows.forEach((row, index) => {
        const y = doc.y;

        doc
          .roundedRect(48, y, 516, 44, 6)
          .fillAndStroke(
            index === 2
              ? "#eaf1f7"
              : "#f8fafc",
            index === 2
              ? "#9fb5cb"
              : "#d5dce4"
          );

        doc
          .fillColor("#111827")
          .font("Helvetica-Bold")
          .fontSize(11)
          .text(
            row.label,
            62,
            y + 10,
            {
              width: 110
            }
          );

        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .text(
            row.value,
            180,
            y + 10,
            {
              width: 365,
              align: "right"
            }
          );

        doc.y = y + 54;
      });

      doc.moveDown(0.3);

      doc
        .font("Helvetica-Bold")
        .fontSize(15)
        .fillColor("#0f2f59")
        .text("Information Used");

      doc.moveDown(0.45);

      const informationUsed = [];

      const addMoneyIfPositive = (
        label,
        value
      ) => {
        const amount = Number(value || 0);

        if (amount !== 0) {
          informationUsed.push([
            label,
            formatMoney(amount)
          ]);
        }
      };

      addMoneyIfPositive(
        "W-2 wages",
        taxData.w2Income
      );

      addMoneyIfPositive(
        "Self-employment income",
        taxData.selfEmploymentIncome
      );

      addMoneyIfPositive(
        "Federal withholding",
        taxData.federalWithheld ??
          federal.federalWithheld
      );

      addMoneyIfPositive(
        "State withholding",
        taxData.stateWithheld ??
          state.stateWithheld
      );

      const dependents =
        Number(
          taxData.numberOfDependents || 0
        );

      if (dependents > 0) {
        informationUsed.push([
          "Dependents entered",
          dependents
        ]);
      }

      if (informationUsed.length === 0) {
        informationUsed.push([
          "Tax information entered",
          "See your online estimate for details"
        ]);
      }

      informationUsed.forEach(
        ([label, value]) => {
          doc
            .font("Helvetica")
            .fontSize(10)
            .fillColor("#111827")
            .text(
              "• " + label + ": " + value,
              {
                indent: 8,
                paragraphGap: 2
              }
            );
        }
      );

      doc.addPage();

      if (fs.existsSync(logoPath)) {
        doc.image(
          logoPath,
          48,
          34,
          {
            fit: [205, 80]
          }
        );
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor("#0f2f59")
        .text(
          "YOUR NEXT STEPS",
          290,
          48,
          {
            width: 270,
            align: "right"
          }
        );

      doc.y = 126;

      doc
        .strokeColor("#c69a37")
        .lineWidth(2)
        .moveTo(48, doc.y)
        .lineTo(564, doc.y)
        .stroke();

      doc.moveDown(1);

      doc
        .font("Helvetica-Bold")
        .fontSize(15)
        .fillColor("#0f2f59")
        .text(
          "Do More Than Keep an Estimate"
        );

      doc.moveDown(0.45);

      doc
        .font("Helvetica")
        .fontSize(10.5)
        .fillColor("#111827")
        .text(
          "Your estimate gives you a useful starting point. The next step is deciding whether you need tax preparation, a deeper review, or help planning before filing."
        );

      doc.moveDown(0.8);

      const drawActionBox = (
        title,
        description,
        linkText,
        linkUrl
      ) => {
        const y = doc.y;

        doc
          .roundedRect(
            48,
            y,
            516,
            86,
            7
          )
          .fillAndStroke(
            "#f8fafc",
            "#d5dce4"
          );

        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .fillColor("#0f2f59")
          .text(
            title,
            62,
            y + 12,
            {
              width: 480
            }
          );

        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor("#374151")
          .text(
            description,
            62,
            y + 32,
            {
              width: 475
            }
          );

        doc
          .font("Helvetica-Bold")
          .fontSize(9.5)
          .fillColor("#1d4ed8")
          .text(
            linkText,
            62,
            y + 63,
            {
              width: 475,
              link: linkUrl,
              underline: true
            }
          );

        doc.y = y + 98;
      };

      drawActionBox(
        "Start My Tax Return",
        "Tell us about your income, tax documents, states, investments, gig work, business activity, and filing needs so we can recommend the right preparation service.",
        "Start My Tax Return",
        taxReturnIntakeUrl
      );

      drawActionBox(
        "Want a Deeper Review?",
        "The Written Tax Estimate Red Flag Review looks for missing credits, filing concerns, withholding problems, and planning opportunities.",
        "Return to your online estimate and review the paid option",
        summaryUrl
      );

      drawActionBox(
        "Prefer to Talk First?",
        "Schedule a short tax-estimate review appointment before deciding what service you need.",
        "Schedule a 15-minute appointment",
        bookingUrl
      );

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#0f2f59")
        .text("Reopen Your Online Estimate");

      doc.moveDown(0.25);

      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor("#1d4ed8")
        .text(
          summaryUrl,
          {
            link: summaryUrl,
            underline: true
          }
        );

      doc.moveDown(0.8);

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#0f2f59")
        .text("Important Information");

      doc.moveDown(0.25);

      doc
        .font("Helvetica")
        .fontSize(9.3)
        .fillColor("#374151")
        .text(
          "This document is an estimate based only on the information entered into the online estimator. It is not a filed tax return, a guarantee of a refund, or a substitute for complete tax preparation."
        );

      doc.moveDown(0.45);

      doc.text(
        "Your actual federal and state results may change after all income documents, deductions, credits, prior-year information, and tax records are reviewed."
      );

      doc.moveDown(0.8);

      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#6b7280")
        .text(
          "Reference: " +
          String(
            lead.leadId ||
            "Not available"
          )
        );

      doc.text(
        "Generated: " +
        new Date().toLocaleString(
          "en-US"
        )
      );

      doc.moveDown(0.65);

      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor("#0f2f59")
        .text(
          "Greatest Business Solution LLC",
          {
            align: "center"
          }
        );

      const contactRequestUrl =
        baseUrl +
        "/contact?service=Tax%20Preparation";

      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#6b7280")
        .text(
          "Contact Greatest Business Solution LLC",
          {
            align: "center",
            link: contactRequestUrl,
            underline: true
          }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
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
    taxPreparationIntake:
      estimate.taxPreparationIntake ||
      row.taxPreparationIntake ||
      row.tax_preparation_intake ||
      null,
    contactRequest:
      estimate.contactRequest ||
      row.contactRequest ||
      row.contact_request ||
      null,
    calendarAppointment:
      estimate.calendarAppointment ||
      row.calendarAppointment ||
      row.calendar_appointment ||
      null,
    writtenReview:
      estimate.writtenReview ||
      row.writtenReview ||
      row.written_review ||
      null,
    writtenReviewDeliveredAt:
      estimate.writtenReviewDeliveredAt ||
      row.writtenReviewDeliveredAt ||
      row.written_review_delivered_at ||
      "",
    writtenReviewDeliveryStatus:
      estimate.writtenReviewDeliveryStatus ||
      row.writtenReviewDeliveryStatus ||
      row.written_review_delivery_status ||
      "",
    writtenReviewCompletedAt:
      estimate.writtenReviewCompletedAt ||
      row.writtenReviewCompletedAt ||
      row.written_review_completed_at ||
      "",
    writtenReviewCompletedStatus:
      estimate.writtenReviewCompletedStatus ||
      row.writtenReviewCompletedStatus ||
      row.written_review_completed_status ||
      "",
    closedAt:
      estimate.closedAt ||
      row.closedAt ||
      row.closed_at ||
      "",
    completedAt:
      estimate.completedAt ||
      row.completedAt ||
      row.completed_at ||
      "",
    updatedAt:
      estimate.updatedAt ||
      row.updatedAt ||
      row.updated_at ||
      "",
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

Ã°Å¸â€˜â€° Schedule your 15-minute tax review now:
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

Ã°Å¸â€˜â€° Schedule your 15-minute tax review:
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

    const alreadyDelivered =
      existingWrittenReview.deliveredAt ||
      existingWrittenReview.completedAt ||
      String(updated.status || "").toLowerCase().includes("closed");

    if (alreadyDelivered) {
      return updated;
    }

    const paymentNote =
      "[" + nowDisplay + "] Stripe confirmed Written Estimate Red Flag Review payment." +
      (paymentInfo.sessionId ? " Checkout Session: " + paymentInfo.sessionId + "." : "") +
      (paymentInfo.paymentIntentId ? " Payment Intent: " + paymentInfo.paymentIntentId + "." : "");

    updated.writtenReview = {
      ...existingWrittenReview,
      requested: true,
      status: "Paid / Waiting for Client Worksheet",
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
    updated.status = "Written Review - Waiting for Client Worksheet";
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

    if (!isLocal) {
      const expectedKey =
        String(process.env.LIVE_TEST_KEY || "").trim();

      const suppliedKey =
        String(req.get("x-live-test-key") || "").trim();

      if (!expectedKey) {
        return res.status(403).json({
          ok: false,
          error: "Protected live testing is not configured."
        });
      }

      if (!suppliedKey || suppliedKey !== expectedKey) {
        return res.status(403).json({
          ok: false,
          error: "Invalid protected live-test key."
        });
      }
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

    if (!isLocal) {
      const expectedKey =
        String(process.env.LIVE_TEST_KEY || "").trim();

      const suppliedKey =
        String(req.get("x-live-test-key") || "").trim();

      if (!expectedKey) {
        return res.status(403).json({
          ok: false,
          error: "Protected live testing is not configured."
        });
      }

      if (!suppliedKey || suppliedKey !== expectedKey) {
        return res.status(403).json({
          ok: false,
          error: "Invalid protected live-test key."
        });
      }
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

    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        paymentConfirmed: false,
        error: result.error || "Could not mark Written Review paid.",
        leadId
      });
    }

    const localBaseUrl =
      "http://" + String(req.headers.host || "localhost:3000");

    const nextStep =
      await triggerAutomaticWrittenReviewNextStep(
        leadId,
        localBaseUrl
      );

    return res.status(nextStep.ok ? 200 : 500).json({
      ok: nextStep.ok,
      paymentConfirmed: true,
      worksheetInvitationSent:
        nextStep.worksheetInvitationSent === true,
      finalReviewDelivered:
        nextStep.emailSent === true &&
        nextStep.closed === true,
      closed: nextStep.closed === true,
      source:
        nextStep.source ||
        result.source ||
        null,
      error: nextStep.error || null,
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
    const requestData =
      lead.Request ||
      lead.request ||
      {};

    const worksheetCompleted =
      Boolean(requestData.clientTaxStrategyWorksheet) &&
      (
        requestData.clientTaxStrategyWorksheetStatus === "Completed" ||
        Boolean(requestData.clientTaxStrategyWorksheetCompletedAt)
      );

    if (!worksheetCompleted) {
      return res.status(409).json({
        ok: false,
        error: "The Client Tax Strategy Worksheet has not been completed."
      });
    }

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
        updated.closedAt = nowIso;
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
// POST /api/written-review/:leadId/mark-delivered
// Explicitly records delivery/completion and moves the lead to Closed Leads.
// =============================================================================

app.post("/api/written-review/:leadId/mark-delivered", async (req, res) => {
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
    const requestData = lead.Request || lead.request || {};
    const worksheetCompleted =
      Boolean(requestData.clientTaxStrategyWorksheet) &&
      (
        requestData.clientTaxStrategyWorksheetStatus === "Completed" ||
        Boolean(requestData.clientTaxStrategyWorksheetCompletedAt)
      );

    if (!worksheetCompleted) {
      return res.status(409).json({
        ok: false,
        error: "The Client Tax Strategy Worksheet has not been completed."
      });
    }

    const alreadyDelivered =
      Boolean(lead.writtenReviewDeliveredAt) ||
      Boolean(lead.writtenReviewCompletedAt) ||
      Boolean(lead.writtenReview?.deliveredAt) ||
      Boolean(lead.writtenReview?.completedAt) ||
      String(lead.status || "").toLowerCase().includes("closed");

    if (alreadyDelivered) {
      return res.status(200).json({
        ok: true,
        alreadyDelivered: true,
        leadId
      });
    }

    const nowIso = new Date().toISOString();
    const nowDisplay = new Date().toLocaleString();

    const updateResult = await updateLeadAfterStripePayment(
      leadId,
      function applyWrittenReviewDelivered(record = {}) {
        const updated = { ...record };
        const existingReview = updated.writtenReview || {};

        updated.writtenReviewDeliveredAt = nowIso;
        updated.writtenReviewDeliveryStatus = "Delivered";
        updated.writtenReviewCompletedAt = nowIso;
        updated.writtenReviewCompletedStatus = "Completed";

        updated.writtenReview = {
          ...existingReview,
          status: "Completed / No action needed",
          deliveredAt: existingReview.deliveredAt || nowIso,
          completedAt: existingReview.completedAt || nowIso,
          deliveryStatus: "Delivered",
          completedStatus: "Completed",
          updatedAt: nowIso
        };

        updated.status = "Closed - Written Review Completed";
        updated.closedAt = updated.closedAt || nowIso;
        updated.updatedAt = nowIso;

        const deliveryNote =
          "[" + nowDisplay + "] Written Review marked delivered and completed.";

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

    if (!updateResult.ok) {
      return res.status(500).json({
        ok: false,
        error: updateResult.error || "The Written Review could not be marked delivered."
      });
    }

    return res.status(200).json({
      ok: true,
      delivered: true,
      completed: true,
      leadId,
      deliveredAt: nowIso,
      source: updateResult.source
    });
  } catch (err) {
    console.error(
      "[written review mark delivered] Error:",
      err.message || err
    );

    return res.status(500).json({
      ok: false,
      error: "The Written Review could not be marked delivered."
    });
  }
});

// =============================================================================
// AUTOMATIC CLIENT WORKSHEET INVITATION
// Payment sends the worksheet first. Final delivery waits for submission.
// =============================================================================

async function sendWrittenReviewWorksheetInvitation(
  leadId,
  baseUrlOverride = ""
) {
  const cleanId = String(leadId || "").trim();

  if (!cleanId) {
    return {
      ok: false,
      error: "Missing lead ID for worksheet invitation."
    };
  }

  if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
    return {
      ok: false,
      error: "Gmail delivery is not configured."
    };
  }

  const lookup =
    await findWrittenReviewLeadForDelivery(cleanId);

  if (!lookup.ok || !lookup.lead) {
    return {
      ok: false,
      error: lookup.error || "Lead not found."
    };
  }

  const lead = lookup.lead;
  const review = lead.writtenReview || {};
  const requestData =
    lead.Request ||
    lead.request ||
    {};

  const worksheetCompleted =
    Boolean(requestData.clientTaxStrategyWorksheet) &&
    (
      requestData.clientTaxStrategyWorksheetStatus === "Completed" ||
      Boolean(requestData.clientTaxStrategyWorksheetCompletedAt)
    );

  if (worksheetCompleted) {
    return triggerAutomaticWrittenReviewDelivery(
      cleanId,
      baseUrlOverride
    );
  }

  if (review.worksheetInvitationSentAt) {
    return {
      ok: true,
      worksheetInvitationSent: true,
      alreadySent: true,
      leadId: cleanId
    };
  }

  const clientEmail =
    String(lead.contact?.email || "").trim();

  if (!clientEmail) {
    return {
      ok: false,
      error: "The client does not have an email address."
    };
  }

  const clientName =
    String(lead.contact?.name || "Client").trim();

  const baseUrl =
    String(baseUrlOverride || APP_BASE_URL || "")
      .trim()
      .replace(/\/+$/, "");

  if (!baseUrl) {
    return {
      ok: false,
      error: "APP_BASE_URL is not configured."
    };
  }

  const worksheetUrl =
    baseUrl +
    "/client-tax-strategy-worksheet/" +
    encodeURIComponent(cleanId);

  const subject =
    "Complete Your Tax Strategy Worksheet";

  const body =
`Hello ${clientName},

Thank you for purchasing the Written Tax Estimate Red Flag Review.

Before your complete review can be finalized, please complete your Client Tax Strategy Worksheet:

${worksheetUrl}

Your answers will be included in the tax-strategy portion of your completed review.

After you submit the worksheet, the system will automatically finalize and email your complete Written Red Flag Review.

Thank you,

Greatest Business Solution LLC`;

  const emailResult =
    await transporter.sendMail({
      from: EMAIL_USER,
      to: clientEmail,
      subject,
      text: body
    });

  const nowIso = new Date().toISOString();
  const nowDisplay = new Date().toLocaleString();

  const saveResult =
    await updateLeadAfterStripePayment(
      cleanId,
      function applyWorksheetInvitation(record = {}) {
        const updated = { ...record };
        const existingReview =
          updated.writtenReview || {};

        updated.writtenReview = {
          ...existingReview,
          status: "Waiting for Client Worksheet",
          worksheetInvitationSentAt: nowIso,
          worksheetInvitationRecipient: clientEmail,
          worksheetInvitationMessageId:
            emailResult.messageId || "",
          updatedAt: nowIso
        };

        updated.status =
          "Written Review - Waiting for Client Worksheet";
        updated.updatedAt = nowIso;

        const note =
          "[" + nowDisplay + "] Client Tax Strategy Worksheet invitation emailed to " +
          clientEmail + ".";

        const oldNotes =
          typeof updated.notes === "string"
            ? updated.notes.trim()
            : "";

        updated.notes =
          oldNotes
            ? oldNotes + "\n" + note
            : note;

        return updated;
      }
    );

  if (!saveResult.ok) {
    return {
      ok: false,
      emailSent: true,
      error:
        "Worksheet invitation was emailed, but its status could not be saved."
    };
  }

  return {
    ok: true,
    worksheetInvitationSent: true,
    recipient: clientEmail,
    source: saveResult.source,
    leadId: cleanId
  };
}

async function triggerAutomaticWrittenReviewNextStep(
  leadId,
  baseUrlOverride = ""
) {
  const result =
    await sendWrittenReviewWorksheetInvitation(
      leadId,
      baseUrlOverride
    );

  if (!result.ok) {
    await markWrittenReviewAutomationFailure(
      leadId,
      result.error ||
        "Automatic Written Review next step failed."
    );
  }

  return result;
}
// =============================================================================
// AUTOMATIC WRITTEN REVIEW DELIVERY
// Stripe payment confirmation calls the already-tested completed-review route.
// Successful reviews email and close automatically.
// Failed reviews stay open with an exact action-required status.
// =============================================================================

async function markWrittenReviewAutomationFailure(leadId, errorMessage) {
  const nowIso = new Date().toISOString();
  const nowDisplay = new Date().toLocaleString();
  const cleanError =
    String(errorMessage || "Automatic delivery failed.").trim();

  return updateLeadAfterStripePayment(
    leadId,
    function applyWrittenReviewFailure(record = {}) {
      const updated = { ...record };
      const existingReview = updated.writtenReview || {};

      updated.writtenReview = {
        ...existingReview,
        status: "Delivery Failed / Action Required",
        automationStatus: "Failed",
        automationError: cleanError,
        automationFailedAt: nowIso,
        updatedAt: nowIso
      };

      updated.status =
        "Written Review - Delivery Failed / Action Required";
      updated.updatedAt = nowIso;

      const failureNote =
        "[" + nowDisplay + "] Automatic Written Review delivery failed. " +
        cleanError;

      const oldNotes =
        typeof updated.notes === "string"
          ? updated.notes.trim()
          : "";

      updated.notes =
        oldNotes
          ? oldNotes + "\n" + failureNote
          : failureNote;

      return updated;
    }
  );
}

async function triggerAutomaticWrittenReviewDelivery(
  leadId,
  baseUrlOverride = ""
) {
  const cleanId = String(leadId || "").trim();

  if (!cleanId) {
    return {
      ok: false,
      error: "Missing lead ID for automatic delivery."
    };
  }

  const baseUrl =
    String(baseUrlOverride || APP_BASE_URL || "")
      .trim()
      .replace(/\/+$/, "");

  if (!baseUrl) {
    const error = "APP_BASE_URL is not configured.";
    await markWrittenReviewAutomationFailure(cleanId, error);

    return {
      ok: false,
      error
    };
  }

  try {
    const response = await fetch(
      baseUrl +
        "/api/written-review/" +
        encodeURIComponent(cleanId) +
        "/send-completed",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    let result = {};

    try {
      result = await response.json();
    } catch {
      result = {};
    }

    const alreadyCompleted =
      response.status === 409 &&
      String(result.error || "")
        .toLowerCase()
        .includes("already completed");

    if (alreadyCompleted) {
      return {
        ok: true,
        alreadyCompleted: true,
        leadId: cleanId
      };
    }

    if (!response.ok || !result.ok) {
      const error =
        result.error ||
        "Automatic Written Review delivery request failed.";

      await markWrittenReviewAutomationFailure(cleanId, error);

      return {
        ok: false,
        error,
        emailSent: result.emailSent === true,
        leadId: cleanId
      };
    }

    return {
      ...result,
      automatic: true
    };
  } catch (err) {
    const error =
      err && err.message
        ? err.message
        : "Automatic Written Review delivery failed.";

    await markWrittenReviewAutomationFailure(cleanId, error);

    return {
      ok: false,
      error,
      leadId: cleanId
    };
  }
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
          console.error(
            "[stripe webhook] Could not mark written review paid:",
            result.error || result
          );
        } else {
          console.log(
            "[stripe webhook] Written review marked paid:",
            leadId,
            result.source
          );

          const nextStep =
            await triggerAutomaticWrittenReviewNextStep(leadId);

          if (!nextStep.ok) {
            console.error(
              "[stripe webhook] Automatic Written Review next step failed:",
              leadId,
              nextStep.error || nextStep
            );
          } else if (nextStep.closed) {
            console.log(
              "[stripe webhook] Completed Written Review automatically emailed and closed:",
              leadId
            );
          } else {
            console.log(
              "[stripe webhook] Client Tax Strategy Worksheet invitation emailed:",
              leadId
            );
          }
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
// CALENDLY WEBHOOK
// Stores invitee.created and invitee.canceled inside the existing lead record.
// The webhook URL must include ?secret=<CALENDLY_WEBHOOK_SECRET>.
// =============================================================================

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getCalendlyWebhookSecret(req) {
  return String(
    req.query?.secret ||
    req.headers["x-calendly-webhook-secret"] ||
    ""
  ).trim();
}

function getCalendlyAppointmentFromPayload(body = {}) {
  const payload = body.payload || {};
  const eventType = String(body.event || "").trim();
  const scheduledEvent = payload.scheduled_event || {};
  const cancellation = payload.cancellation || {};

  const inviteeEmail = normalizeEmail(payload.email);
  const inviteeName = String(payload.name || "").trim();
  const inviteeUri = String(payload.uri || "").trim();
  const eventUri = String(
    scheduledEvent.uri ||
    payload.event ||
    ""
  ).trim();

  const isCanceled = eventType === "invitee.canceled";

  return {
    provider: "Calendly",
    webhookEvent: eventType,
    status: isCanceled ? "Canceled" : "Scheduled",
    inviteeName,
    inviteeEmail,
    inviteeUri,
    eventUri,
    eventName: String(scheduledEvent.name || "").trim(),
    startTime: String(scheduledEvent.start_time || "").trim(),
    endTime: String(scheduledEvent.end_time || "").trim(),
    location:
      scheduledEvent.location &&
      typeof scheduledEvent.location === "object"
        ? scheduledEvent.location
        : null,
    cancelUrl: String(payload.cancel_url || "").trim(),
    rescheduleUrl: String(payload.reschedule_url || "").trim(),
    canceledAt: isCanceled ? new Date().toISOString() : "",
    cancellationReason: String(cancellation.reason || "").trim(),
    canceledBy: String(cancellation.canceler_type || "").trim(),
    rescheduled: Boolean(payload.rescheduled),
    oldInviteeUri: String(payload.old_invitee || "").trim(),
    newInviteeUri: String(payload.new_invitee || "").trim(),
    receivedAt: new Date().toISOString()
  };
}

function calendlyAppointmentMatches(existing = {}, incoming = {}) {
  const existingInviteeUri = String(existing.inviteeUri || "").trim();
  const incomingInviteeUri = String(incoming.inviteeUri || "").trim();
  const existingEventUri = String(existing.eventUri || "").trim();
  const incomingEventUri = String(incoming.eventUri || "").trim();

  if (
    existingInviteeUri &&
    incomingInviteeUri &&
    existingInviteeUri === incomingInviteeUri
  ) {
    return true;
  }

  if (
    existingEventUri &&
    incomingEventUri &&
    existingEventUri === incomingEventUri
  ) {
    return true;
  }

  return (
    normalizeEmail(existing.inviteeEmail) &&
    normalizeEmail(existing.inviteeEmail) ===
      normalizeEmail(incoming.inviteeEmail)
  );
}

async function saveCalendlyAppointment(appointment) {
  const email = normalizeEmail(appointment.inviteeEmail);

  if (!email) {
    return {
      ok: false,
      statusCode: 400,
      error: "Calendly payload did not include an invitee email."
    };
  }

  try {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const matchingRow = (data || []).find((row) => {
      const estimate = row.estimate || {};
      const rowEmail = normalizeEmail(
        estimate.contact?.email ||
        row.email
      );

      const existingAppointment =
        estimate.calendarAppointment || {};

      return (
        rowEmail === email ||
        calendlyAppointmentMatches(
          existingAppointment,
          appointment
        )
      );
    });

    if (matchingRow) {
      const estimate = matchingRow.estimate || {};
      const updatedEstimate = {
        ...estimate,
        calendarAppointment: {
          ...(estimate.calendarAppointment || {}),
          ...appointment
        },
        updatedAt: new Date().toISOString()
      };

      let updateQuery = supabase
        .from("leads")
        .update({ estimate: updatedEstimate });

      if (matchingRow.leadId) {
        updateQuery = updateQuery.eq("leadId", matchingRow.leadId);
      } else if (matchingRow.leadid) {
        updateQuery = updateQuery.eq("leadid", matchingRow.leadid);
      } else if (matchingRow.lead_id) {
        updateQuery = updateQuery.eq("lead_id", matchingRow.lead_id);
      } else {
        updateQuery = updateQuery.eq("id", matchingRow.id);
      }

      const { error: updateError } = await updateQuery;
      if (updateError) throw updateError;

      const updatedLead = mapRowToLead({
        ...matchingRow,
        estimate: updatedEstimate
      });

      recentLeads.set(updatedLead.leadId, updatedLead);

      return {
        ok: true,
        source: "supabase",
        action: "updated",
        leadId: updatedLead.leadId,
        appointment: updatedLead.calendarAppointment
      };
    }

    const leadId =
      "LEAD-" +
      Date.now() +
      "-CAL";

    const newLead = {
      leadId,
      timestamp: new Date().toISOString(),
      priority: "medium",
      status:
        appointment.status === "Canceled"
          ? "Calendar - Canceled"
          : "Calendar - Scheduled",
      notes: "Created automatically from Calendly.",
      contact: {
        name: appointment.inviteeName || "Calendly Client",
        email,
        phone: ""
      },
      taxData: null,
      estimateSummary: {},
      calendarAppointment: appointment
    };

    const row = {
      leadId: newLead.leadId,
      name: newLead.contact.name,
      email: newLead.contact.email,
      phone: "",
      estimate: {
        timestamp: newLead.timestamp,
        priority: newLead.priority,
        status: newLead.status,
        notes: newLead.notes,
        contact: newLead.contact,
        taxData: null,
        estimateSummary: {},
        calendarAppointment: appointment
      },
      taxYear: null,
      filingYear: null
    };

    const { error: insertError } = await supabase
      .from("leads")
      .insert([row]);

    if (insertError) throw insertError;

    recentLeads.set(leadId, newLead);

    return {
      ok: true,
      source: "supabase",
      action: "created",
      leadId,
      appointment
    };
  } catch (supabaseError) {
    console.error(
      "[Calendly webhook] Supabase save failed:",
      supabaseError.message || supabaseError
    );
  }

  const leads = readLeads();
  let matchingIndex = leads.findIndex((lead) => {
    const leadEmail = normalizeEmail(lead?.contact?.email);
    return (
      leadEmail === email ||
      calendlyAppointmentMatches(
        lead?.calendarAppointment || {},
        appointment
      )
    );
  });

  if (matchingIndex >= 0) {
    leads[matchingIndex] = {
      ...leads[matchingIndex],
      calendarAppointment: {
        ...(leads[matchingIndex].calendarAppointment || {}),
        ...appointment
      },
      updatedAt: new Date().toISOString()
    };

    writeLeads(leads);
    recentLeads.set(
      leads[matchingIndex].leadId,
      leads[matchingIndex]
    );

    return {
      ok: true,
      source: "local",
      action: "updated",
      leadId: leads[matchingIndex].leadId,
      appointment: leads[matchingIndex].calendarAppointment
    };
  }

  const leadId =
    "LEAD-" +
    Date.now() +
    "-CAL";

  const newLead = {
    leadId,
    timestamp: new Date().toISOString(),
    priority: "medium",
    status:
      appointment.status === "Canceled"
        ? "Calendar - Canceled"
        : "Calendar - Scheduled",
    notes: "Created automatically from Calendly.",
    contact: {
      name: appointment.inviteeName || "Calendly Client",
      email,
      phone: ""
    },
    taxData: null,
    estimateSummary: {},
    calendarAppointment: appointment
  };

  leads.unshift(newLead);
  writeLeads(leads);
  recentLeads.set(leadId, newLead);

  return {
    ok: true,
    source: "local",
    action: "created",
    leadId,
    appointment
  };
}

app.post("/api/calendly-webhook", async (req, res) => {
  const configuredSecret = String(
    process.env.CALENDLY_WEBHOOK_SECRET || ""
  ).trim();

  if (!configuredSecret) {
    console.error(
      "[Calendly webhook] CALENDLY_WEBHOOK_SECRET is not configured."
    );

    return res.status(500).json({
      ok: false,
      error: "Calendly webhook secret is not configured."
    });
  }

  const suppliedSecret = getCalendlyWebhookSecret(req);

  if (!suppliedSecret || suppliedSecret !== configuredSecret) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized Calendly webhook request."
    });
  }

  const webhookEvent = String(req.body?.event || "").trim();

  if (
    webhookEvent !== "invitee.created" &&
    webhookEvent !== "invitee.canceled"
  ) {
    return res.status(200).json({
      ok: true,
      ignored: true,
      event: webhookEvent || "unknown"
    });
  }

  try {
    const appointment =
      getCalendlyAppointmentFromPayload(req.body || {});

    const result =
      await saveCalendlyAppointment(appointment);

    if (!result.ok) {
      return res
        .status(result.statusCode || 500)
        .json(result);
    }

    console.log(
      "[Calendly webhook]",
      webhookEvent,
      result.action,
      result.leadId
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error(
      "[Calendly webhook] Processing failed:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      error: "Calendly webhook processing failed."
    });
  }
});

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
  const {
    name,
    email,
    phone,
    priority,
    taxData,
    estimateSummary,
    status,
    notes
  } = req.body || {};

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

  const leadId =
    `LEAD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

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

  if (lead.estimateSummary) {
    const e = lead.estimateSummary;
    const federal = e.federal?.net || 0;
    const state = e.state?.net || 0;
    const combined = federal + state;

    lead.estimateSummary.federalLine =
      federal > 0
        ? `Federal Refund: $${Math.round(federal).toLocaleString()}`
        : federal < 0
          ? `Federal Due: $${Math.abs(Math.round(federal)).toLocaleString()}`
          : "Federal: $0";

    lead.estimateSummary.stateLine =
      state > 0
        ? `State Refund: $${Math.round(state).toLocaleString()}`
        : state < 0
          ? `State Due: $${Math.abs(Math.round(state)).toLocaleString()}`
          : "State: $0";

    lead.estimateSummary.totalLine =
      combined > 0
        ? `Estimated Total Refund: $${Math.round(combined).toLocaleString()}`
        : combined < 0
          ? `Estimated Total Due: $${Math.abs(Math.round(combined)).toLocaleString()}`
          : "Break-even";
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

  let emailSent = false;
  let emailError = "";

  try {
    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      throw new Error("Email delivery is not configured.");
    }

    const baseUrl = String(APP_BASE_URL || "").trim().replace(/\/+$/, "");

    if (!baseUrl) {
      throw new Error("APP_BASE_URL is not configured.");
    }

    const estimateDisplay = buildEstimateDisplay(savedLead.estimateSummary || {});
    const summaryUrl = `${baseUrl}/estimate/${encodeURIComponent(savedLead.leadId)}`;
    const pdfBuffer = await buildFreeEstimatePdfBuffer(savedLead);

    const safeClientName =
      String(savedLead.contact?.name || "Client")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "Client";

    const emailResult = await transporter.sendMail({
      from: EMAIL_USER,
      to: savedLead.contact.email,
      subject: "Your Free Tax Estimate Is Ready",
      text:
`Hello ${savedLead.contact?.name || "Client"},

Thank you for completing your free tax estimate.

Your Free Tax Estimate PDF is attached.

Estimate summary:
- ${estimateDisplay.totalLine}
- ${estimateDisplay.federalLine}
- ${estimateDisplay.stateLine}

You may reopen your online estimate here:
${summaryUrl}

Reference number:
${savedLead.leadId}

This is an estimate based on the information entered. It is not a filed tax return or a guarantee of your final tax result.

Thank you,

Greatest Business Solution LLC`,
      attachments: [
        {
          filename: `Free-Tax-Estimate-${safeClientName}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf"
        }
      ]
    });

    emailSent = true;
    const deliveredAt = new Date().toISOString();

    await updateLeadAfterStripePayment(
      savedLead.leadId,
      function recordFreeEstimateDelivery(record = {}) {
        return {
          ...record,
          freeEstimateDelivery: {
            status: "Emailed",
            deliveredAt,
            recipient: savedLead.contact.email,
            messageId: emailResult.messageId || ""
          },
          updatedAt: deliveredAt
        };
      }
    );

    console.log(
      "Free estimate PDF emailed:",
      savedLead.leadId,
      savedLead.contact.email
    );
  } catch (error) {
    emailError =
      error && error.message
        ? error.message
        : "Free estimate email failed.";

    console.error(
      "[free estimate email] Delivery failed:",
      savedLead.leadId,
      emailError
    );

    const failedAt = new Date().toISOString();

    await updateLeadAfterStripePayment(
      savedLead.leadId,
      function recordFreeEstimateFailure(record = {}) {
        const oldNotes =
          typeof record.notes === "string"
            ? record.notes.trim()
            : "";

        const failureNote =
          `[${new Date().toLocaleString()}] Free Estimate PDF email failed: ${emailError}`;

        return {
          ...record,
          status: "Free Estimate - Email Failed / Action Required",
          notes: oldNotes ? `${oldNotes}\n${failureNote}` : failureNote,
          freeEstimateDelivery: {
            status: "Failed",
            failedAt,
            recipient: savedLead.contact?.email || "",
            error: emailError
          },
          updatedAt: failedAt
        };
      }
    );
  }

  return res.status(201).json({
    ok: true,
    leadId: savedLead.leadId,
    emailSent,
    emailError: emailSent ? null : emailError,
    message: emailSent
      ? "Your free estimate was saved and emailed as a PDF."
      : "Your estimate was saved, but the email could not be delivered."
  });
});

// =============================================================================
// POST /api/contact-request
// =============================================================================

app.post("/api/contact-request", async (req, res) => {
  const body = req.body || {};

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const phone = formatPhoneNumber(body.phone || "");
  const service = String(body.service || "General Question").trim();
  const preferredContact = String(body.preferredContact || "Email").trim();
  const message = String(body.message || "").trim();

  const errors = [];

  if (!name) {
    errors.push("Full name is required.");
  }

  if (!email) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email address format is invalid.");
  }

  if (!message) {
    errors.push("Please tell us how we can help.");
  }

  if (errors.length > 0) {
    return res.status(400).json({
      ok: false,
      errors
    });
  }

  const submittedAt = new Date().toISOString();
  const leadId =
    "CONTACT-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2, 7).toUpperCase();

  const lead = {
    leadId,
    timestamp: submittedAt,
    priority: "medium",
    status: "Contact Request - New",
    notes:
      "Contact request submitted for " +
      service +
      ". Preferred contact: " +
      preferredContact +
      ".",
    contact: {
      name,
      email,
      phone: phone || "Not provided"
    },
    taxData: {},
    estimateSummary: {},
    contactRequest: {
      service,
      preferredContact,
      message,
      submittedAt
    },
    Request: {
      type: "Contact Request",
      service,
      preferredContact,
      message
    }
  };

  try {
    const savedLead = await appendLead(lead);
    recentLeads.set(savedLead.leadId, savedLead);

    let notificationSent = false;
    let confirmationSent = false;
    let emailError = "";

    try {
      if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
        throw new Error("Email delivery is not configured.");
      }

      const businessRecipient =
        process.env.CONTACT_EMAIL ||
        "greatestbusiness1@gmail.com";

      await transporter.sendMail({
        from: EMAIL_USER,
        to: businessRecipient,
        replyTo: email,
        subject: "New Contact Request - " + service,
        text:
`New contact request received.

Name: ${name}
Email: ${email}
Phone: ${phone || "Not provided"}
Service: ${service}
Preferred contact: ${preferredContact}

Message:
${message}

Reference number:
${leadId}`
      });

      notificationSent = true;

      await transporter.sendMail({
        from: EMAIL_USER,
        to: email,
        subject: "We Received Your Contact Request",
        text:
`Hello ${name},

We received your request regarding:

${service}

Your message:
${message}

Preferred contact method:
${preferredContact}

Reference number:
${leadId}

We will review your request and follow up. Please do not email Social Security numbers, tax documents, bank information, or other sensitive records.

Thank you,

Greatest Business Solution LLC`
      });

      confirmationSent = true;
    } catch (emailErr) {
      emailError =
        emailErr && emailErr.message
          ? emailErr.message
          : "Email delivery failed.";

      console.error(
        "[contact request] Email failed:",
        leadId,
        emailError
      );
    }

    return res.status(201).json({
      ok: true,
      leadId,
      notificationSent,
      confirmationSent,
      emailError:
        notificationSent && confirmationSent
          ? null
          : emailError
    });
  } catch (err) {
    console.error(
      "[contact request] Save failed:",
      err.message || err
    );

    return res.status(500).json({
      ok: false,
      errors: [
        "Could not save your contact request. Please try again."
      ]
    });
  }
});

// =============================================================================
// POST /api/tax-preparation-intake
// =============================================================================

app.post("/api/tax-preparation-intake", async (req, res) => {
  const body = req.body || {};
  const contact = body.contact || {};
  const intake = body.intake || {};
  const errors = [];

  const name = String(contact.name || "").trim();
  const email = String(contact.email || "").trim();
  const phone = formatPhoneNumber(contact.phone || "");

  if (!name) {
    errors.push("Full name is required.");
  }

  if (!email) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email address format is invalid.");
  }

  const serviceTypes = Array.isArray(intake.serviceTypes)
    ? intake.serviceTypes.filter(Boolean)
    : [];

  const incomeTypes = Array.isArray(intake.incomeTypes)
    ? intake.incomeTypes.filter(Boolean)
    : [];

  if (serviceTypes.length === 0) {
    errors.push("Select at least one tax service needed.");
  }

  if (incomeTypes.length === 0) {
    errors.push("Select at least one income or tax situation.");
  }

  if (errors.length > 0) {
    return res.status(400).json({
      ok: false,
      errors
    });
  }

  const documentCount = Math.max(
    0,
    Number.parseInt(intake.documentCount, 10) || 0
  );

  const stateCount = Math.max(
    1,
    Number.parseInt(intake.stateCount, 10) || 1
  );

  const complexSignals = [
    "stocks_bonds_investments",
    "foreign_tax",
    "rental_income",
    "k1_income",
    "cryptocurrency",
    "minister_clergy",
    "multiple_states",
    "estimated_tax_payments"
  ];

  const businessSignals = [
    "business_return",
    "partnership_return",
    "s_corporation_return",
    "c_corporation_return",
    "nonprofit_return"
  ];

  const gigSignals = [
    "1099_nec",
    "1099_k",
    "gig_platform",
    "creator_income",
    "self_employment",
    "delivery_driver",
    "rideshare_driver"
  ];

  const hasBusiness =
    serviceTypes.some((item) => businessSignals.includes(item)) ||
    incomeTypes.some((item) => businessSignals.includes(item));

  const hasComplex =
    documentCount > 10 ||
    stateCount > 1 ||
    incomeTypes.some((item) => complexSignals.includes(item));

  const hasGig =
    incomeTypes.some((item) => gigSignals.includes(item));

  let recommendedLane = "Individual Form 1040";
  let status = "Tax Preparation Intake - Ready to Schedule";
  let needsProfessionalReview = false;

  if (hasBusiness) {
    recommendedLane = "Business or Entity Return";
    status = "Tax Preparation Intake - Needs Review";
    needsProfessionalReview = true;
  } else if (hasComplex) {
    recommendedLane = "Investment & Complex Individual Return";
    status = "Tax Preparation Intake - Needs Review";
    needsProfessionalReview = true;
  } else if (hasGig) {
    recommendedLane = "Gig Worker / Self-Employed Return";
  }

  const leadId =
    "TAXPREP-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2, 7).toUpperCase();

  const submittedAt = new Date().toISOString();

  const lead = {
    leadId,
    timestamp: submittedAt,
    priority: needsProfessionalReview ? "high" : "medium",
    status,
    notes:
      "Tax preparation intake submitted. Recommended lane: " +
      recommendedLane +
      ".",
    contact: {
      name,
      email,
      phone: phone || "Not provided"
    },
    taxData: {
      taxYear: intake.taxYear || null,
      filingStatus: intake.filingStatus || null,
      stateCode: intake.primaryState || null
    },
    estimateSummary: {},
    taxPreparationIntake: {
      ...intake,
      sourceLeadId: String(body.sourceLeadId || "").trim(),
      submittedAt,
      recommendedLane,
      needsProfessionalReview
    }
  };

  try {
    const savedLead = await appendLead(lead);
    recentLeads.set(savedLead.leadId, savedLead);

    let emailSent = false;
    let emailError = "";

    try {
      if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
        throw new Error("Email delivery is not configured.");
      }

      const bookingUrl =
        "https://calendly.com/ngmsllc/tax-estimate-review-15-minutes";

      const nextStepText = needsProfessionalReview
        ? "Your intake includes items that need a professional review before pricing or scheduling. We will review the information and contact you."
        : "Your intake is ready for the next step. You may schedule a 15-minute appointment using the link below.";

      await transporter.sendMail({
        from: EMAIL_USER,
        to: email,
        subject: "We Received Your Tax Preparation Request",
        text:
`Hello ${name},

We received your Start My Tax Return intake.

Recommended service:
${recommendedLane}

${nextStepText}

Schedule:
${bookingUrl}

Reference number:
${leadId}

Please do not email Social Security numbers, tax documents, or other sensitive records. Secure document-upload instructions will be provided separately when needed.

Thank you,

Greatest Business Solution LLC`
      });

      emailSent = true;
    } catch (emailErr) {
      emailError =
        emailErr && emailErr.message
          ? emailErr.message
          : "Confirmation email failed.";

      console.error(
        "[tax preparation intake] Confirmation email failed:",
        leadId,
        emailError
      );
    }

    return res.status(201).json({
      ok: true,
      leadId,
      recommendedLane,
      needsProfessionalReview,
      status,
      emailSent,
      emailError: emailSent ? null : emailError
    });
  } catch (err) {
    console.error(
      "[tax preparation intake] Save failed:",
      err.message || err
    );

    return res.status(500).json({
      ok: false,
      errors: [
        "Could not save your tax preparation request. Please try again."
      ]
    });
  }
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

app.get("/start-my-tax-return", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "start-my-tax-return.html"));
});

app.get("/contact", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "contact.html"));
});

app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "privacy.html"));
});

app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "terms.html"));
});

// =============================================================================
// PATCH /api/leads/:leadId
// =============================================================================

app.patch("/api/leads/:leadId", async (req, res) => {
  const { leadId } = req.params;
  const {
    status,
    notes,
    Request,
    completedAt,
    closedAt
  } = req.body || {};
  const cleanId = String(leadId || "").trim();

  const worksheetWasSubmitted =
    Request &&
    typeof Request === "object" &&
    !Array.isArray(Request) &&
    Request.clientTaxStrategyWorksheetStatus === "Completed" &&
    Boolean(Request.clientTaxStrategyWorksheet);

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

      return possibleIds.some(
        (id) => String(id || "").trim() === cleanId
      );
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

    if (typeof completedAt === "string" && completedAt.trim()) {
      updatedEstimate.completedAt = completedAt.trim();
    }

    if (typeof closedAt === "string" && closedAt.trim()) {
      updatedEstimate.closedAt = closedAt.trim();
    }

    if (
      Request &&
      typeof Request === "object" &&
      !Array.isArray(Request)
    ) {
      updatedEstimate.Request = {
        ...(updatedEstimate.Request || {}),
        ...Request,
        updatedAt: new Date().toISOString()
      };
    }

    return updatedEstimate;
  };

  try {
    try {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error(
          "[PATCH /api/leads] Supabase lookup error:",
          error.message || error
        );
      }

      if (!error && Array.isArray(data)) {
        const matchingRow = findMatchingRow(data);

        if (matchingRow) {
          const updatedEstimate =
            applyUpdateToEstimate(matchingRow.estimate || {});

          let updateQuery = supabase
            .from("leads")
            .update({ estimate: updatedEstimate });

          if (matchingRow.leadId) {
            updateQuery = updateQuery.eq(
              "leadId",
              matchingRow.leadId
            );
          } else if (matchingRow.leadid) {
            updateQuery = updateQuery.eq(
              "leadid",
              matchingRow.leadid
            );
          } else if (matchingRow.lead_id) {
            updateQuery = updateQuery.eq(
              "lead_id",
              matchingRow.lead_id
            );
          } else if (matchingRow.id) {
            updateQuery = updateQuery.eq(
              "id",
              matchingRow.id
            );
          } else {
            throw new Error(
              "Matched Supabase row has no usable ID column."
            );
          }

          const { error: updateError } = await updateQuery;

          if (updateError) {
            console.error(
              "[PATCH /api/leads] Supabase update error:",
              updateError.message || updateError
            );

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

          let automaticDelivery = null;

          if (worksheetWasSubmitted) {
            const localBaseUrl =
              "http://" +
              String(req.headers.host || "localhost:3000");

            automaticDelivery =
              await triggerAutomaticWrittenReviewDelivery(
                cleanId,
                localBaseUrl
              );
          }

          return res.status(200).json({
            ok: true,
            source: "supabase",
            lead: updatedLead,
            automaticDelivery
          });
        }
      }
    } catch (supabaseErr) {
      console.error(
        "[PATCH /api/leads] Supabase update failed:",
        supabaseErr.message || supabaseErr
      );
    }

    const localLeads = readLeads();

    const localIndex = localLeads.findIndex((lead) => {
      const possibleIds = [
        lead?.leadId,
        lead?.id,
        lead?.estimateId,
        lead?.lead_id
      ];

      return possibleIds.some(
        (id) => String(id || "").trim() === cleanId
      );
    });

    if (localIndex >= 0) {
      const localLead = localLeads[localIndex];

      if (typeof status === "string" && status.trim()) {
        localLead.status = status.trim();
      }

      if (typeof notes === "string") {
        localLead.notes = notes;
      }

      if (typeof completedAt === "string" && completedAt.trim()) {
        localLead.completedAt = completedAt.trim();
      }

      if (typeof closedAt === "string" && closedAt.trim()) {
        localLead.closedAt = closedAt.trim();
      }

      if (
        Request &&
        typeof Request === "object" &&
        !Array.isArray(Request)
      ) {
        localLead.Request = {
          ...(localLead.Request || {}),
          ...Request,
          updatedAt: new Date().toISOString()
        };
      }

      localLeads[localIndex] = localLead;
      writeLeads(localLeads);
      recentLeads.set(localLead.leadId, localLead);

      let automaticDelivery = null;

      if (worksheetWasSubmitted) {
        const localBaseUrl =
          "http://" +
          String(req.headers.host || "localhost:3000");

        automaticDelivery =
          await triggerAutomaticWrittenReviewDelivery(
            cleanId,
            localBaseUrl
          );
      }

      return res.status(200).json({
        ok: true,
        source: "local",
        lead: localLead,
        automaticDelivery
      });
    }

    return res.status(404).json({
      ok: false,
      error: "Lead not found.",
      requestedLeadId: cleanId
    });
  } catch (err) {
    console.error(
      "[PATCH /api/leads] Unexpected error:",
      err
    );

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







































