"use strict";

const express = require("express");
const clientCore = require("./server/clientCore");
const { createClientPortalSecurity } = require("./server/clientPortalSecurity");
const { createClientPortalStore } = require("./server/clientPortalStore");
const { createClientDocumentStore } = require("./server/clientDocumentStore");
const {
  MAX_FILE_BYTES: CLIENT_DOCUMENT_MAX_BYTES,
  DOCUMENT_CATEGORIES: CLIENT_DOCUMENT_CATEGORIES,
  REVIEW_STATUSES: CLIENT_DOCUMENT_REVIEW_STATUSES,
  normalizeTaxYear: normalizeClientDocumentTaxYear,
  normalizeReviewStatus: normalizeClientDocumentReviewStatus,
  normalizeRetentionDate: normalizeClientDocumentRetentionDate,
  cleanText: cleanClientDocumentText,
  getCategoryLabel: getClientDocumentCategoryLabel,
  validateDocumentUpload,
  publicDocumentRecord,
  officeDocumentRecord
} = require("./server/clientDocumentSecurity");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const scheduleCCodes2025 = require(
  "./ui/data/schedule-c-codes-2025.json"
);
const scheduleCCodeMaps = new Map([
  [
    "2025",
    new Map(
      (scheduleCCodes2025.codes || []).map(
        (entry) => [
          String(entry.code || ""),
          entry
        ]
      )
    )
  ]
]);
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const { estimate } = require("./taxEstimator");

require("dotenv").config();
const STRIPE_SECRET_KEY = String(
  process.env.STRIPE_SECRET_KEY || ""
).trim();
const stripe = require("stripe")(
  STRIPE_SECRET_KEY
);
const STRIPE_KEY_MODE = STRIPE_SECRET_KEY.startsWith("sk_test_")
  ? "test"
  : STRIPE_SECRET_KEY.startsWith("sk_live_")
    ? "live"
    : "unavailable";
const TAX_WATCH_STRIPE_CHECKOUT_ENABLED =
  String(process.env.TAX_WATCH_STRIPE_CHECKOUT_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
const PINNACLE_STRIPE_CHECKOUT_ENABLED =
  String(process.env.PINNACLE_STRIPE_CHECKOUT_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = String(
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).trim();

const SUPABASE_PUBLIC_KEY = String(
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ""
).trim();

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLIC_KEY
);

const app = express();

const PORT = process.env.PORT || 3000;
const LEADS_FILE = path.join(__dirname, "leads.json");
const APP_BASE_URL = process.env.APP_BASE_URL || "https://tax-estimator-app-v1.onrender.com";
const recentLeads = new Map();

// =============================================================================
// SECURE CLIENT PORTAL FOUNDATION
// Client sessions use an HttpOnly, signed cookie. Passwords and activation
// codes are stored only as slow hashes. Set CLIENT_PORTAL_SESSION_SECRET in
// Render before inviting live clients so sessions remain valid after restarts.
// =============================================================================

const CLIENT_PORTAL_COOKIE_NAME =
  "tsp_client_portal_session";

const CLIENT_PORTAL_SESSION_DAYS = 7;
const CLIENT_PORTAL_ACTIVATION_MINUTES = 15;

const CLIENT_PORTAL_PRODUCTION_HOST = Boolean(
  process.env.RENDER ||
  String(process.env.NODE_ENV || "").toLowerCase() === "production"
);

const CLIENT_PORTAL_SESSION_SECRET = String(
  process.env.CLIENT_PORTAL_SESSION_SECRET || ""
).trim();

const CLIENT_PORTAL_SESSION_SECRET_READY =
  CLIENT_PORTAL_SESSION_SECRET.length >= 32;

const clientPortalSecurity = createClientPortalSecurity({
  secret:
    CLIENT_PORTAL_SESSION_SECRET ||
    (
      CLIENT_PORTAL_PRODUCTION_HOST
        ? ""
        : "tax-savings-planner-local-session-only"
    ),
  cookieName: CLIENT_PORTAL_COOKIE_NAME
});

const clientPortalAttemptBuckets = new Map();

const CLIENT_PORTAL_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ""
).trim();

const CLIENT_PORTAL_SERVICE_KEY_TYPE =
  String(
    process.env.SUPABASE_SECRET_KEY || ""
  ).trim()
    ? "Supabase secret key"
    : String(
        process.env.SUPABASE_SERVICE_ROLE_KEY || ""
      ).trim()
      ? "Legacy service-role key"
      : "Not configured";

const clientPortalSupabaseAdmin =
  CLIENT_PORTAL_SERVICE_ROLE_KEY &&
  SUPABASE_URL
    ? createClient(
        SUPABASE_URL,
        CLIENT_PORTAL_SERVICE_ROLE_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        }
      )
    : null;

const clientPortalStore = createClientPortalStore({
  supabaseAdmin: clientPortalSupabaseAdmin,
  tableName: "client_portal_accounts",
  localFile: path.join(
    __dirname,
    "client-portal-accounts.local.json"
  ),
  allowLocalFallback:
    !CLIENT_PORTAL_PRODUCTION_HOST
});

// =============================================================================
// SECURE DOCUMENT CENTER
// Files are never served from the public /ui directory. Local development uses
// a private folder beside server.js. Live storage requires the Supabase service
// role plus the private bucket/table created by supabase/client-document-center.sql.
// =============================================================================

const CLIENT_DOCUMENTS_BUCKET = String(
  process.env.CLIENT_DOCUMENTS_BUCKET ||
  "client-portal-documents"
).trim();

const clientDocumentStore = createClientDocumentStore({
  supabaseAdmin: clientPortalSupabaseAdmin,
  tableName: "client_portal_documents",
  bucketName: CLIENT_DOCUMENTS_BUCKET,
  localMetadataFile: path.join(
    __dirname,
    "client-portal-documents.local.json"
  ),
  localDirectory: path.join(
    __dirname,
    "client-portal-documents.local"
  ),
  allowLocalFallback:
    !CLIENT_PORTAL_PRODUCTION_HOST
});

// =============================================================================
// SECURE OFFICE DOCUMENT REVIEW
// Local development uses an explicit local-only bypass. Production requires
// OFFICE_DOCUMENT_REVIEW_KEY and a signed HttpOnly office session cookie.
// =============================================================================

const OFFICE_DOCUMENT_REVIEW_COOKIE_NAME =
  "tsp_office_document_review";

const OFFICE_DOCUMENT_REVIEW_SESSION_HOURS = 8;

const OFFICE_DOCUMENT_REVIEW_KEY = String(
  process.env.OFFICE_DOCUMENT_REVIEW_KEY || ""
).trim();

const OFFICE_DOCUMENT_REVIEW_KEY_READY =
  OFFICE_DOCUMENT_REVIEW_KEY.length >= 20;

const OFFICE_DOCUMENT_REVIEW_SESSION_SECRET = String(
  process.env.OFFICE_DOCUMENT_REVIEW_SESSION_SECRET || ""
).trim();

const OFFICE_DOCUMENT_REVIEW_SESSION_SECRET_READY =
  OFFICE_DOCUMENT_REVIEW_SESSION_SECRET.length >= 32;

const OFFICE_DOCUMENT_REVIEW_SECRET =
  OFFICE_DOCUMENT_REVIEW_SESSION_SECRET ||
  (
    CLIENT_PORTAL_PRODUCTION_HOST
      ? ""
      : (
          CLIENT_PORTAL_SESSION_SECRET ||
          OFFICE_DOCUMENT_REVIEW_KEY ||
          "local-office-document-review-only"
        )
  );

function officeReviewBase64Url(value) {
  return Buffer.from(value)
    .toString("base64url");
}

function createOfficeDocumentReviewToken() {
  const now = Date.now();

  const payload = {
    purpose: "office-document-review",
    issuedAt: now,
    expiresAt:
      now +
      OFFICE_DOCUMENT_REVIEW_SESSION_HOURS *
      60 *
      60 *
      1000
  };

  const encoded =
    officeReviewBase64Url(
      JSON.stringify(payload)
    );

  const signature = crypto
    .createHmac(
      "sha256",
      OFFICE_DOCUMENT_REVIEW_SECRET ||
      "local-office-document-review-only"
    )
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

function verifyOfficeDocumentReviewToken(token) {
  const [encoded, signature] = String(
    token || ""
  ).split(".");

  if (!encoded || !signature) {
    return null;
  }

  const expected = crypto
    .createHmac(
      "sha256",
      OFFICE_DOCUMENT_REVIEW_SECRET ||
      "local-office-document-review-only"
    )
    .update(encoded)
    .digest("base64url");

  const suppliedBuffer =
    Buffer.from(signature);

  const expectedBuffer =
    Buffer.from(expected);

  if (
    suppliedBuffer.length !==
    expectedBuffer.length
  ) {
    return null;
  }

  if (
    !crypto.timingSafeEqual(
      suppliedBuffer,
      expectedBuffer
    )
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(
        encoded,
        "base64url"
      ).toString("utf8")
    );

    if (
      payload.purpose !==
        "office-document-review" ||
      Number(payload.expiresAt || 0) <=
        Date.now()
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function getCookieValue(req, name) {
  const cookieHeader = String(
    req.headers?.cookie || ""
  );

  const target =
    `${encodeURIComponent(name)}=`;

  const pair = cookieHeader
    .split(";")
    .map((value) => value.trim())
    .find(
      (value) =>
        value.startsWith(target)
    );

  return pair
    ? decodeURIComponent(
        pair.slice(target.length)
      )
    : "";
}

function setOfficeDocumentReviewCookie(
  res,
  token
) {
  const secure =
    CLIENT_PORTAL_PRODUCTION_HOST
      ? "; Secure"
      : "";

  res.setHeader(
    "Set-Cookie",
    `${encodeURIComponent(OFFICE_DOCUMENT_REVIEW_COOKIE_NAME)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${OFFICE_DOCUMENT_REVIEW_SESSION_HOURS * 60 * 60}${secure}`
  );
}

function clearOfficeDocumentReviewCookie(
  res
) {
  const secure =
    CLIENT_PORTAL_PRODUCTION_HOST
      ? "; Secure"
      : "";

  res.setHeader(
    "Set-Cookie",
    `${encodeURIComponent(OFFICE_DOCUMENT_REVIEW_COOKIE_NAME)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
  );
}

function officeDocumentReviewLocalBypass() {
  return (
    !CLIENT_PORTAL_PRODUCTION_HOST &&
    !OFFICE_DOCUMENT_REVIEW_KEY
  );
}

function officeDocumentReviewAuthenticated(
  req
) {
  if (
    officeDocumentReviewLocalBypass()
  ) {
    return {
      mode:
        "local-development-bypass"
    };
  }

  const token =
    getCookieValue(
      req,
      OFFICE_DOCUMENT_REVIEW_COOKIE_NAME
    );

  const payload =
    verifyOfficeDocumentReviewToken(
      token
    );

  return payload
    ? {
        mode: "signed-office-session",
        payload
      }
    : null;
}

function getSafeOfficeDocumentReviewRedirect(
  value
) {
  const target = String(
    value || ""
  ).trim();

  const allowed =
    target ===
      "/office-document-review" ||
    target.startsWith(
      "/office-document-review?"
    ) ||
    target ===
      "/transcript-requests" ||
    target.startsWith(
      "/transcript-requests?"
    );

  return allowed
    ? target
    : "/office-document-review";
}

function requireOfficeDocumentReviewPage(
  req,
  res,
  next
) {
  const access =
    officeDocumentReviewAuthenticated(
      req
    );

  if (access) {
    req.officeDocumentReview =
      access;
    return next();
  }

  if (
    CLIENT_PORTAL_PRODUCTION_HOST &&
    (
      !OFFICE_DOCUMENT_REVIEW_KEY_READY ||
      !OFFICE_DOCUMENT_REVIEW_SESSION_SECRET_READY
    )
  ) {
    return res.status(503).send(
      "Secure office document review is not enabled. Configure the office access key and office session secret before live use."
    );
  }

  const returnTo =
    getSafeOfficeDocumentReviewRedirect(
      req.originalUrl
    );

  return res.redirect(
    `/office-document-review/sign-in?next=${encodeURIComponent(returnTo)}`
  );
}

function requireOfficeDocumentReviewApi(
  req,
  res,
  next
) {
  const access =
    officeDocumentReviewAuthenticated(
      req
    );

  if (access) {
    req.officeDocumentReview =
      access;
    return next();
  }

  return res.status(401).json({
    ok: false,
    error:
      "Secure office document review sign-in is required."
  });
}

function officeDocumentReviewKeyMatches(
  supplied
) {
  const actual = Buffer.from(
    String(
      OFFICE_DOCUMENT_REVIEW_KEY || ""
    )
  );

  const candidate = Buffer.from(
    String(
      supplied || ""
    )
  );

  if (
    actual.length === 0 ||
    actual.length !==
      candidate.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    actual,
    candidate
  );
}


function getPortalProductionEnvironmentChecks() {
  const httpsBaseUrl =
    /^https:\/\//i.test(
      String(APP_BASE_URL || "")
    );

  return [
    {
      id: "app-base-url",
      label: "Secure application URL",
      ready:
        !CLIENT_PORTAL_PRODUCTION_HOST ||
        httpsBaseUrl,
      required: true,
      detail:
        CLIENT_PORTAL_PRODUCTION_HOST
          ? (
              httpsBaseUrl
                ? "APP_BASE_URL uses HTTPS."
                : "Set APP_BASE_URL to the secure live website URL."
            )
          : "Local testing uses localhost."
    },
    {
      id: "portal-session-secret",
      label: "Client portal session secret",
      ready:
        CLIENT_PORTAL_SESSION_SECRET_READY,
      required: true,
      detail:
        CLIENT_PORTAL_SESSION_SECRET_READY
          ? "CLIENT_PORTAL_SESSION_SECRET is configured."
          : "Create a private value of at least 32 characters."
    },
    {
      id: "office-access-key",
      label: "Office review access key",
      ready:
        OFFICE_DOCUMENT_REVIEW_KEY_READY,
      required: true,
      detail:
        OFFICE_DOCUMENT_REVIEW_KEY_READY
          ? "OFFICE_DOCUMENT_REVIEW_KEY is configured."
          : "Create a private office access key of at least 20 characters."
    },
    {
      id: "office-session-secret",
      label: "Office review session secret",
      ready:
        OFFICE_DOCUMENT_REVIEW_SESSION_SECRET_READY,
      required: true,
      detail:
        OFFICE_DOCUMENT_REVIEW_SESSION_SECRET_READY
          ? "OFFICE_DOCUMENT_REVIEW_SESSION_SECRET is configured."
          : "Create a separate private value of at least 32 characters."
    },
    {
      id: "supabase-url",
      label: "Supabase project URL",
      ready: Boolean(SUPABASE_URL),
      required: true,
      detail:
        SUPABASE_URL
          ? "The server has the Supabase project URL."
          : "Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL."
    },
    {
      id: "supabase-server-key",
      label: "Server-only Supabase secret",
      ready:
        Boolean(
          CLIENT_PORTAL_SERVICE_ROLE_KEY
        ),
      required: true,
      detail:
        CLIENT_PORTAL_SERVICE_ROLE_KEY
          ? `${CLIENT_PORTAL_SERVICE_KEY_TYPE} is configured on the server.`
          : "Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY on the server only."
    },
    {
      id: "email-delivery",
      label: "Portal email delivery",
      ready:
        Boolean(
          EMAIL_USER &&
          EMAIL_APP_PASSWORD
        ),
      required: true,
      detail:
        EMAIL_USER &&
        EMAIL_APP_PASSWORD
          ? "Activation and document-status email delivery is configured."
          : "Configure the business email and app password."
    },
    {
      id: "document-bucket-name",
      label: "Private document bucket name",
      ready:
        Boolean(
          CLIENT_DOCUMENTS_BUCKET
        ),
      required: true,
      detail:
        CLIENT_DOCUMENTS_BUCKET
          ? `Bucket: ${CLIENT_DOCUMENTS_BUCKET}`
          : "Set CLIENT_DOCUMENTS_BUCKET."
    }
  ];
}

function clientPortalProductionEnvironmentBlockers() {
  if (!CLIENT_PORTAL_PRODUCTION_HOST) {
    return [];
  }

  return getPortalProductionEnvironmentChecks()
    .filter(
      (check) =>
        check.required &&
        !check.ready
    );
}

async function getPortalProductionReadiness() {
  const environmentChecks =
    getPortalProductionEnvironmentChecks();

  const credentialReadiness =
    await clientPortalStore
      .checkLiveReadiness();

  const documentReadiness =
    await clientDocumentStore
      .checkLiveReadiness();

  const checks = [
    ...environmentChecks,
    {
      id: "portal-credential-table",
      label: "Portal credential table",
      ready:
        Boolean(
          credentialReadiness.tableReady
        ),
      required: true,
      detail:
        credentialReadiness.tableReady
          ? "client_portal_accounts is available."
          : (
              credentialReadiness.errors[0] ||
              "Run the portal foundation SQL migration."
            )
    },
    {
      id: "document-table",
      label: "Document metadata table",
      ready:
        Boolean(
          documentReadiness.tableReady
        ),
      required: true,
      detail:
        documentReadiness.tableReady
          ? "client_portal_documents is available."
          : (
              documentReadiness.errors.find(
                (error) =>
                  String(error).startsWith(
                    "Document table:"
                  )
              ) ||
              "Run the document-center SQL migration."
            )
    },
    {
      id: "private-document-bucket",
      label: "Private document storage bucket",
      ready:
        Boolean(
          documentReadiness.bucketReady &&
          documentReadiness.privateBucket
        ),
      required: true,
      detail:
        documentReadiness.bucketReady &&
        documentReadiness.privateBucket
          ? "The document bucket exists and is private."
          : (
              documentReadiness.errors.find(
                (error) =>
                  String(error).startsWith(
                    "Document bucket:"
                  ) ||
                  String(error).includes(
                    "bucket is public"
                  )
              ) ||
              "Create the bucket and keep public access disabled."
            )
    }
  ];

  const blockers = checks.filter(
    (check) =>
      check.required &&
      !check.ready
  );

  return {
    version: "1.0.0",
    productionHost:
      CLIENT_PORTAL_PRODUCTION_HOST,
    localTesting:
      !CLIENT_PORTAL_PRODUCTION_HOST,
    livePortalReady:
      CLIENT_PORTAL_PRODUCTION_HOST &&
      blockers.length === 0,
    environmentReady:
      environmentChecks.every(
        (check) =>
          !check.required ||
          check.ready
      ),
    credentialStorage:
      credentialReadiness,
    documentStorage:
      documentReadiness,
    checks,
    blockers:
      blockers.map(
        (check) => check.label
      )
  };
}

function requireClientPortalProductionConfiguration(
  req,
  res,
  next
) {
  const blockers =
    clientPortalProductionEnvironmentBlockers();

  if (!blockers.length) {
    return next();
  }

  setClientPortalNoStore(res);

  return res.status(503).json({
    ok: false,
    error:
      "The secure client portal is temporarily unavailable while production security is being configured.",
    blockers:
      blockers.map(
        (check) => check.label
      )
  });
}

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
      taxPreparationWork: lead.taxPreparationWork || null,
      contractor1099Request: lead.contractor1099Request || null,
      contractor1099Work: lead.contractor1099Work || null,
      extensionRequest: lead.extensionRequest || null,
      contactRequest: lead.contactRequest || null,
      calendarAppointment: lead.calendarAppointment || null
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

const VALID_US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC",
  "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
  "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY"
]);

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
              "- " + label + ": " + value,
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

function sanitizeClientPortalRecord(record) {
  const value =
    record &&
    typeof record === "object" &&
    !Array.isArray(record)
      ? record
      : {};

  const documentCenter =
    value.documentCenter &&
    typeof value.documentCenter === "object" &&
    !Array.isArray(value.documentCenter)
      ? value.documentCenter
      : {};

  return {
    version: Number(value.version || 1),
    status: String(value.status || "not-activated"),
    email: String(value.email || ""),
    activatedAt: String(value.activatedAt || ""),
    lastLoginAt: String(value.lastLoginAt || ""),
    lastActivityAt: String(value.lastActivityAt || ""),
    setupRequestedAt: String(value.setupRequestedAt || ""),
    sourceLeadId: String(value.sourceLeadId || ""),
    documentCenter: {
      version: Number(
        documentCenter.version || 1
      ),
      status: String(
        documentCenter.status || "not-started"
      ),
      totalDocuments: Number(
        documentCenter.totalDocuments || 0
      ),
      awaitingReview: Number(
        documentCenter.awaitingReview || 0
      ),
      inReview: Number(
        documentCenter.inReview || 0
      ),
      accepted: Number(
        documentCenter.accepted || 0
      ),
      needsReplacement: Number(
        documentCenter.needsReplacement || 0
      ),
      latestUploadAt: String(
        documentCenter.latestUploadAt || ""
      ),
      latestFileName: String(
        documentCenter.latestFileName || ""
      )
    }
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
    taxPreparationIntake:
      estimate.taxPreparationIntake ||
      row.taxPreparationIntake ||
      row.tax_preparation_intake ||
      null,
    taxPreparationWork:
      estimate.taxPreparationWork ||
      row.taxPreparationWork ||
      row.tax_preparation_work ||
      null,
    contractor1099Request:
      estimate.contractor1099Request ||
      row.contractor1099Request ||
      row.contractor_1099_request ||
      null,
    contractor1099Work:
      estimate.contractor1099Work ||
      row.contractor1099Work ||
      row.contractor_1099_work ||
      null,
    extensionRequest:
      estimate.extensionRequest ||
      row.extensionRequest ||
      row.extension_request ||
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
    taxSavingsPlanner:
      estimate.taxSavingsPlanner ||
      row.taxSavingsPlanner ||
      row.tax_savings_planner ||
      null,
    taxWatchProfile:
      estimate.taxWatchProfile ||
      row.taxWatchProfile ||
      row.tax_watch_profile ||
      null,
    taxWatchOrganizer:
      estimate.taxWatchOrganizer ||
      row.taxWatchOrganizer ||
      row.tax_watch_organizer ||
      null,
    taxWatchMoneyTracker:
      estimate.taxWatchMoneyTracker ||
      row.taxWatchMoneyTracker ||
      row.tax_watch_money_tracker ||
      null,
    clientPortal: sanitizeClientPortalRecord(
      estimate.clientPortal ||
      row.clientPortal ||
      row.client_portal ||
      null
    ),
    Request: estimate.Request || estimate.request || row.Request || row.request || null
  };
}


function getNewsletterSubscriptionRecord(lead = {}) {
  const contactRequest =
    lead.contactRequest &&
    typeof lead.contactRequest === "object"
      ? lead.contactRequest
      : {};

  const request =
    lead.Request &&
    typeof lead.Request === "object"
      ? lead.Request
      : {};

  const candidate =
    /tax updates that matter newsletter/i.test(
      String(contactRequest.service || "")
    )
      ? contactRequest
      : (
          /tax updates that matter newsletter/i.test(
            String(request.service || request.type || "")
          )
            ? request
            : null
        );

  return candidate;
}

function isNewsletterSubscriptionLead(lead = {}) {
  return Boolean(
    getNewsletterSubscriptionRecord(lead)
  );
}

function isNewsletterOnlyLead(lead = {}) {
  if (!isNewsletterSubscriptionLead(lead)) {
    return false;
  }

  return !(
    lead.taxPreparationIntake ||
    lead.taxPreparationWork ||
    lead.contractor1099Request ||
    lead.contractor1099Work ||
    lead.extensionRequest ||
    lead.calendarAppointment ||
    lead.writtenReview ||
    lead.taxSavingsPlanner ||
    lead.transcriptRequest
  );
}

async function findNewsletterSubscription({
  email = "",
  leadId = ""
} = {}) {
  const cleanEmail = normalizeEmail(email);
  const cleanLeadId = String(leadId || "").trim();
  const byId = new Map();

  function consider(rawLead) {
    const mapped = mapRowToLead(rawLead || {});

    if (!isNewsletterSubscriptionLead(mapped)) {
      return;
    }

    const mappedId = String(mapped.leadId || "").trim();
    const mappedEmail = normalizeEmail(
      mapped.contact?.email || ""
    );

    if (cleanLeadId && mappedId !== cleanLeadId) {
      return;
    }

    if (cleanEmail && mappedEmail !== cleanEmail) {
      return;
    }

    if (mappedId) {
      byId.set(mappedId, mapped);
    }
  }

  try {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    (data || []).forEach(consider);
  } catch (error) {
    console.warn(
      "[newsletter] Supabase lookup unavailable:",
      error.message || error
    );
  }

  readLeads().forEach(consider);

  return Array.from(byId.values())[0] || null;
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

Schedule your 15-minute tax review now:
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

Schedule your 15-minute tax review:
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

        const updatedLead = mapRowToLead({
          ...matchingRow,
          estimate: updatedEstimate
        });

        if (updatedLead?.leadId) {
          recentLeads.set(
            updatedLead.leadId,
            updatedLead
          );
        }

        return {
          ok: true,
          source: "supabase",
          lead: updatedLead
        };
      }
    }
  } catch (err) {
    console.error("[stripe webhook] Supabase update failed:", err.message || err);
  }

  const localLeads = readLeads();
  const localIndex = localLeads.findIndex(matchesLeadId);

  if (localIndex >= 0) {
    localLeads[localIndex] =
      applyUpdate(
        localLeads[localIndex]
      );

    writeLeads(localLeads);

    const updatedLead =
      mapRowToLead(
        localLeads[localIndex]
      );

    if (updatedLead?.leadId) {
      recentLeads.set(
        updatedLead.leadId,
        updatedLead
      );
    }

    return {
      ok: true,
      source: "local",
      lead: updatedLead
    };
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


async function applyExtensionPaidUpdate(
  leadId,
  paymentInfo = {}
) {
  const cleanId =
    String(leadId || "").trim();

  const current =
    await findClientPortalLeadById(
      cleanId
    );

  const currentLead =
    current?.lead || {};

  const currentRequest =
    currentLead.extensionRequest || {};

  const incomingSessionId =
    String(
      paymentInfo.sessionId || ""
    ).trim();

  const existingSessionId =
    String(
      currentRequest
        .stripeCheckoutSessionId ||
      ""
    ).trim();

  const alreadyPaid =
    /paid|verified/i.test(
      String(
        currentRequest.paymentStatus ||
        ""
      )
    ) &&
    (
      !incomingSessionId ||
      !existingSessionId ||
      incomingSessionId ===
        existingSessionId
    );

  if (alreadyPaid) {
    return {
      ok: true,
      alreadyPaid: true,
      source:
        current?.source ||
        "existing-record",
      lead: currentLead
    };
  }

  const nowIso = new Date().toISOString();
  const nowDisplay =
    new Date().toLocaleString();

  return updateLeadAfterStripePayment(
    cleanId,
    function applyExtensionPaid(
      record = {}
    ) {
      const updated = { ...record };
      const existing =
        updated.extensionRequest &&
        typeof updated.extensionRequest ===
          "object"
          ? updated.extensionRequest
          : {};

      const paymentNote =
        "[" + nowDisplay + "] Stripe confirmed Tax Extension service payment." +
        (paymentInfo.sessionId
          ? " Checkout Session: " +
            paymentInfo.sessionId +
            "."
          : "") +
        (paymentInfo.paymentIntentId
          ? " Payment Intent: " +
            paymentInfo.paymentIntentId +
            "."
          : "");

      updated.extensionRequest = {
        ...existing,
        requested: true,
        paymentStatus: "Paid / Verified",
        workStatus: "Paid / Needs Review",
        paymentVerifiedAt: nowIso,
        paidAt:
          existing.paidAt ||
          nowIso,
        stripeCheckoutSessionId:
          paymentInfo.sessionId ||
          existing.stripeCheckoutSessionId ||
          "",
        stripePaymentIntentId:
          paymentInfo.paymentIntentId ||
          existing.stripePaymentIntentId ||
          "",
        paymentSource: "Stripe Checkout",
        updatedAt: nowIso
      };

      updated.status =
        "Extension Request - Paid / Needs Review";
      updated.updatedAt = nowIso;

      const oldNotes =
        typeof updated.notes === "string"
          ? updated.notes.trim()
          : "";

      updated.notes = oldNotes
        ? oldNotes + "\n" + paymentNote
        : paymentNote;

      return updated;
    }
  );
}



async function applyTaxPreparationPaidUpdate(
  leadId,
  paymentInfo = {}
) {
  const cleanId = String(leadId || "").trim();

  const current =
    await findClientPortalLeadById(cleanId);

  const currentLead = current?.lead || {};
  const currentWork =
    currentLead.taxPreparationWork || {};

  const incomingSessionId = String(
    paymentInfo.sessionId || ""
  ).trim();

  const processedSessions = Array.isArray(
    currentWork.processedStripeSessions
  )
    ? currentWork.processedStripeSessions
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];

  if (
    incomingSessionId &&
    processedSessions.includes(incomingSessionId)
  ) {
    return {
      ok: true,
      alreadyPaid: true,
      source: current?.source || "existing-record",
      lead: currentLead
    };
  }

  const paidAmountCents = Math.max(
    0,
    Number.parseInt(
      paymentInfo.amountPaidCents,
      10
    ) || 0
  );

  if (!paidAmountCents) {
    return {
      ok: false,
      error:
        "Stripe did not provide a valid Tax Preparation payment amount."
    };
  }

  const nowIso = new Date().toISOString();
  const nowDisplay = new Date().toLocaleString();

  return updateLeadAfterStripePayment(
    cleanId,
    function applyTaxPreparationPaid(record = {}) {
      const updated = { ...record };
      const existing =
        updated.taxPreparationWork &&
        typeof updated.taxPreparationWork === "object"
          ? updated.taxPreparationWork
          : {};

      const currentPaidCents = Math.max(
        0,
        Number.parseInt(existing.amountPaidCents, 10) || 0
      );

      const quotedFeeCents = Math.max(
        0,
        Number.parseInt(existing.quotedFeeCents, 10) || 0
      );

      const newPaidCents =
        currentPaidCents + paidAmountCents;

      const paymentStatus =
        quotedFeeCents > 0 &&
        newPaidCents >= quotedFeeCents
          ? "Paid / Verified"
          : "Deposit Paid / Verified";

      const nextWorkStatus = String(
        existing.workStatus ||
        "Needs Professional Review"
      ).trim();

      const paymentNote =
        "[" + nowDisplay + "] Stripe confirmed a Tax Preparation payment of $" +
        (paidAmountCents / 100).toFixed(2) + "." +
        (paymentInfo.paymentPurpose
          ? " Purpose: " + paymentInfo.paymentPurpose + "."
          : "") +
        (incomingSessionId
          ? " Checkout Session: " + incomingSessionId + "."
          : "") +
        (paymentInfo.paymentIntentId
          ? " Payment Intent: " + paymentInfo.paymentIntentId + "."
          : "");

      updated.taxPreparationWork = {
        ...existing,
        paymentStatus,
        amountPaidCents: newPaidCents,
        amountPaid: Number(
          (newPaidCents / 100).toFixed(2)
        ),
        paymentVerifiedAt: nowIso,
        paidAt:
          paymentStatus === "Paid / Verified"
            ? nowIso
            : (existing.paidAt || ""),
        lastPaymentAt: nowIso,
        lastPaymentAmountCents: paidAmountCents,
        lastPaymentPurpose:
          String(paymentInfo.paymentPurpose || "").trim(),
        stripeCheckoutSessionId:
          incomingSessionId ||
          existing.stripeCheckoutSessionId ||
          "",
        stripePaymentIntentId:
          paymentInfo.paymentIntentId ||
          existing.stripePaymentIntentId ||
          "",
        processedStripeSessions:
          incomingSessionId
            ? Array.from(
                new Set([
                  ...processedSessions,
                  incomingSessionId
                ])
              )
            : processedSessions,
        paymentSource: "Stripe Checkout",
        workStatus: nextWorkStatus,
        updatedAt: nowIso
      };

      updated.status =
        "Tax Preparation - " + nextWorkStatus;
      updated.updatedAt = nowIso;

      const oldNotes =
        typeof updated.notes === "string"
          ? updated.notes.trim()
          : "";

      updated.notes = oldNotes
        ? oldNotes + "\n" + paymentNote
        : paymentNote;

      return updated;
    }
  );
}


async function applyContractor1099PaidUpdate(
  leadId,
  paymentInfo = {}
) {
  const cleanId = String(leadId || "").trim();

  const current =
    await findClientPortalLeadById(cleanId);

  const currentLead = current?.lead || {};
  const currentWork =
    currentLead.contractor1099Work || {};

  const incomingSessionId = String(
    paymentInfo.sessionId || ""
  ).trim();

  const processedSessions = Array.isArray(
    currentWork.processedStripeSessions
  )
    ? currentWork.processedStripeSessions
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];

  if (
    incomingSessionId &&
    processedSessions.includes(incomingSessionId)
  ) {
    return {
      ok: true,
      alreadyPaid: true,
      source: current?.source || "existing-record",
      lead: currentLead
    };
  }

  const paidAmountCents = Math.max(
    0,
    Number.parseInt(
      paymentInfo.amountPaidCents,
      10
    ) || 0
  );

  if (!paidAmountCents) {
    return {
      ok: false,
      error:
        "Stripe did not provide a valid Contractor 1099 payment amount."
    };
  }

  const nowIso = new Date().toISOString();
  const nowDisplay = new Date().toLocaleString();

  return updateLeadAfterStripePayment(
    cleanId,
    function applyContractor1099Paid(record = {}) {
      const updated = { ...record };
      const existing =
        updated.contractor1099Work &&
        typeof updated.contractor1099Work === "object"
          ? updated.contractor1099Work
          : {};

      const currentPaidCents = Math.max(
        0,
        Number.parseInt(existing.amountPaidCents, 10) || 0
      );

      const quotedFeeCents = Math.max(
        0,
        Number.parseInt(existing.quotedFeeCents, 10) || 0
      );

      const newPaidCents =
        currentPaidCents + paidAmountCents;

      const paymentStatus =
        quotedFeeCents > 0 &&
        newPaidCents >= quotedFeeCents
          ? "Paid / Verified"
          : "Deposit Paid / Verified";

      const currentWorkStatus = String(
        existing.workStatus ||
        "Needs Professional Review"
      ).trim();

      const nextWorkStatus =
        /quote needed|payment pending/i.test(currentWorkStatus)
          ? "Paid / Needs Review"
          : currentWorkStatus;

      const paymentNote =
        "[" + nowDisplay + "] Stripe confirmed a Contractor Forms 1099 service payment of $" +
        (paidAmountCents / 100).toFixed(2) + "." +
        (paymentInfo.paymentPurpose
          ? " Purpose: " + paymentInfo.paymentPurpose + "."
          : "") +
        (incomingSessionId
          ? " Checkout Session: " + incomingSessionId + "."
          : "") +
        (paymentInfo.paymentIntentId
          ? " Payment Intent: " + paymentInfo.paymentIntentId + "."
          : "");

      updated.contractor1099Work = {
        ...existing,
        paymentStatus,
        amountPaidCents: newPaidCents,
        amountPaid: Number(
          (newPaidCents / 100).toFixed(2)
        ),
        paymentVerifiedAt: nowIso,
        paidAt:
          paymentStatus === "Paid / Verified"
            ? nowIso
            : (existing.paidAt || ""),
        lastPaymentAt: nowIso,
        lastPaymentAmountCents: paidAmountCents,
        lastPaymentPurpose:
          String(paymentInfo.paymentPurpose || "").trim(),
        stripeCheckoutSessionId:
          incomingSessionId ||
          existing.stripeCheckoutSessionId ||
          "",
        stripePaymentIntentId:
          paymentInfo.paymentIntentId ||
          existing.stripePaymentIntentId ||
          "",
        processedStripeSessions:
          incomingSessionId
            ? Array.from(
                new Set([
                  ...processedSessions,
                  incomingSessionId
                ])
              )
            : processedSessions,
        paymentSource: "Stripe Checkout",
        workStatus: nextWorkStatus,
        updatedAt: nowIso
      };

      updated.status =
        "Contractor 1099 - " + nextWorkStatus;
      updated.updatedAt = nowIso;

      const oldNotes =
        typeof updated.notes === "string"
          ? updated.notes.trim()
          : "";

      updated.notes = oldNotes
        ? oldNotes + "\n" + paymentNote
        : paymentNote;

      return updated;
    }
  );
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

      if (
        service === "tax_extension" &&
        session.payment_status === "paid"
      ) {
        const result = await applyExtensionPaidUpdate(
          leadId,
          {
            sessionId: session.id,
            paymentIntentId:
              session.payment_intent
          }
        );

        if (!result.ok) {
          console.error(
            "[stripe webhook] Could not mark extension request paid:",
            result.error || result
          );
        } else {
          console.log(
            result.alreadyPaid
              ? "[stripe webhook] Extension request was already marked paid:"
              : "[stripe webhook] Extension request marked paid:",
            leadId,
            result.source
          );

          const paidLead = result.lead || {};
          const clientEmail =
            String(
              paidLead.contact?.email || ""
            ).trim();

          if (
            !result.alreadyPaid &&
            clientEmail &&
            EMAIL_USER &&
            EMAIL_APP_PASSWORD
          ) {
            const portalUrl =
              String(APP_BASE_URL || "")
                .replace(/\/+$/, "") +
              "/client-portal?activate=1&leadId=" +
              encodeURIComponent(leadId);

            void transporter.sendMail({
              from: EMAIL_USER,
              to: clientEmail,
              subject:
                "Your Tax Extension Request Payment Was Received",
              text:
`Hello ${paidLead.contact?.name || "Client"},

Your payment for the Tax Extension service was received.

Reference number:
${leadId}

The office will review the deadline, return type, estimated payment information, and any state-extension request before filing.

An extension gives additional time to file. It does not extend the deadline to pay tax that may be owed.

Use your secure client portal for documents and office updates:
${portalUrl}

This is a standalone extension service. You may use any tax professional to prepare the full return.

Thank you,

Greatest Business Solution LLC`
            }).catch((emailError) => {
              console.error(
                "[stripe webhook] Extension payment confirmation email failed:",
                leadId,
                emailError.message || emailError
              );
            });
          }
        }
      }

      if (
        service === "tax_preparation" &&
        session.payment_status === "paid"
      ) {
        const result =
          await applyTaxPreparationPaidUpdate(
            leadId,
            {
              sessionId: session.id,
              paymentIntentId:
                session.payment_intent,
              amountPaidCents:
                session.amount_total,
              paymentPurpose:
                session.metadata?.paymentPurpose ||
                "Tax Preparation Payment"
            }
          );

        if (!result.ok) {
          console.error(
            "[stripe webhook] Could not record Tax Preparation payment:",
            result.error || result
          );
        } else {
          console.log(
            result.alreadyPaid
              ? "[stripe webhook] Tax Preparation payment was already recorded:"
              : "[stripe webhook] Tax Preparation payment recorded:",
            leadId,
            result.source
          );

          const paidLead = result.lead || {};
          const clientEmail = String(
            paidLead.contact?.email || ""
          ).trim();

          if (
            !result.alreadyPaid &&
            clientEmail &&
            EMAIL_USER &&
            EMAIL_APP_PASSWORD
          ) {
            const work =
              paidLead.taxPreparationWork || {};
            const portalUrl =
              String(APP_BASE_URL || "")
                .replace(/\/+$/, "") +
              "/client-portal?activate=1&leadId=" +
              encodeURIComponent(leadId);

            void transporter.sendMail({
              from: EMAIL_USER,
              to: clientEmail,
              subject:
                "Your Tax Preparation Payment Was Received",
              text:
`Hello ${paidLead.contact?.name || "Client"},

We received your secure Tax Preparation payment.

Amount received:
$${(Number(session.amount_total || 0) / 100).toFixed(2)}

Payment status:
${String(work.paymentStatus || "Payment Received")}

Tax year:
${String(
  paidLead.taxPreparationIntake?.taxYear ||
  paidLead.taxData?.taxYear ||
  "Not recorded"
)}

Use your secure client portal for documents and office updates:
${portalUrl}

Reference number:
${leadId}

Please do not email Social Security numbers, tax documents, bank information, or passwords.

Thank you,

Greatest Business Solution LLC`
            }).catch((emailError) => {
              console.error(
                "[stripe webhook] Tax Preparation payment confirmation email failed:",
                leadId,
                emailError.message || emailError
              );
            });
          }
        }
      }

      if (
        service === "contractor_1099" &&
        session.payment_status === "paid"
      ) {
        const result =
          await applyContractor1099PaidUpdate(
            leadId,
            {
              sessionId: session.id,
              paymentIntentId:
                session.payment_intent,
              amountPaidCents:
                session.amount_total,
              paymentPurpose:
                session.metadata?.paymentPurpose ||
                "Contractor 1099 Service Payment"
            }
          );

        if (!result.ok) {
          console.error(
            "[stripe webhook] Could not record Contractor 1099 payment:",
            result.error || result
          );
        } else {
          console.log(
            result.alreadyPaid
              ? "[stripe webhook] Contractor 1099 payment was already recorded:"
              : "[stripe webhook] Contractor 1099 payment recorded:",
            leadId,
            result.source
          );

          const paidLead =
            result.lead || {};
          const clientEmail =
            String(
              paidLead.contact?.email || ""
            ).trim();

          if (
            !result.alreadyPaid &&
            clientEmail &&
            EMAIL_USER &&
            EMAIL_APP_PASSWORD
          ) {
            const work =
              paidLead.contractor1099Work || {};
            const portalUrl =
              String(APP_BASE_URL || "")
                .replace(/\/+$/, "") +
              "/client-portal?contractor1099=1&leadId=" +
              encodeURIComponent(leadId);

            void transporter.sendMail({
              from: EMAIL_USER,
              to: clientEmail,
              subject:
                "Your Contractor 1099 Service Payment Was Received",
              text:
`Hello ${paidLead.contact?.name || "Client"},

We received your secure Contractor Forms 1099 service payment.

Amount received:
$${(Number(session.amount_total || 0) / 100).toFixed(2)}

Payment status:
${String(
  work.paymentStatus ||
  "Payment Received"
)}

Reporting year:
${String(
  paidLead.contractor1099Request?.taxYear ||
  paidLead.taxData?.taxYear ||
  "Not recorded"
)}

Use the Secure Client Portal for W-9s, payee information, payment totals, and office updates:
${portalUrl}

Reference number:
${leadId}

Please do not email Social Security numbers, contractor EINs, W-9s, bank information, or detailed payment records.

Thank you,

Greatest Business Solution LLC`
            }).catch((emailError) => {
              console.error(
                "[stripe webhook] Contractor 1099 payment confirmation email failed:",
                leadId,
                emailError.message || emailError
              );
            });
          }
        }
      }

      if (service === "year_round_membership") {
        const result =
          await processMembershipCheckoutSession(
            session,
            event.id,
            stripeUnixToIso(event.created)
          );

        if (!result.ok) {
          console.error(
            "[stripe webhook] Membership Checkout Session could not be synchronized:",
            result.error || result
          );
        } else if (!result.ignored) {
          console.log(
            "[stripe webhook] Membership Checkout Session synchronized:",
            leadId
          );
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

    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_failed"
    ) {
      const result = await processMembershipInvoice(
        event.data.object || {},
        event.id,
        event.type,
        stripeUnixToIso(event.created)
      );

      if (!result.ok) {
        console.error(
          "[stripe webhook] Membership invoice could not be synchronized:",
          result.error || result
        );
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const result =
        await processMembershipSubscription(
          event.data.object || {},
          event.id,
          event.type,
          stripeUnixToIso(event.created)
        );

      if (!result.ok) {
        console.error(
          "[stripe webhook] Membership subscription could not be synchronized:",
          result.error || result
        );
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

// Planner CRM synchronization includes the completed Planner state, score history,
// checklist records, and Executive Report snapshot. Express defaults JSON bodies to
// 100 KB, which can reject a legitimate completed Planner before the sync route runs.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));


// =============================================================================
// CALENDLY WEBHOOK
// Stores invitee.created and invitee.canceled inside the existing lead record.
// The webhook URL must include ?secret=<CALENDLY_WEBHOOK_SECRET>.
// =============================================================================

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}


function getClientPortalRecord(record = {}) {
  const estimate = record?.estimate || {};

  const value =
    estimate.clientPortal ||
    record.clientPortal ||
    record.client_portal ||
    null;

  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value
      : null;
}

function getLeadIdValue(record = {}) {
  const estimate = record?.estimate || {};

  return String(
    record.leadId ||
    record.leadid ||
    record.lead_id ||
    record.id ||
    record.estimateId ||
    estimate.leadId ||
    estimate.leadid ||
    estimate.lead_id ||
    estimate.id ||
    estimate.estimateId ||
    ""
  ).trim();
}

function getLeadEmailValue(record = {}) {
  const estimate = record?.estimate || {};
  const contact =
    estimate.contact ||
    record.contact ||
    {};

  return normalizeEmail(
    contact.email ||
    record.email ||
    ""
  );
}

function getLeadNameValue(record = {}) {
  const estimate = record?.estimate || {};
  const contact =
    estimate.contact ||
    record.contact ||
    {};

  return String(
    contact.name ||
    record.name ||
    "Client"
  ).trim();
}

function getClientPortalRequestIsSecure(req) {
  return Boolean(
    req.secure ||
    String(
      req.headers["x-forwarded-proto"] || ""
    ).toLowerCase() === "https"
  );
}

function setClientPortalNoStore(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader(
    "X-Robots-Tag",
    "noindex, nofollow, noarchive"
  );
}

function setClientPortalSessionCookie(req, res, payload) {
  const now = Date.now();
  const maxAgeSeconds =
    CLIENT_PORTAL_SESSION_DAYS * 24 * 60 * 60;

  const token = clientPortalSecurity.createSessionToken({
    ...payload,
    issuedAt: now,
    expiresAt: now + (maxAgeSeconds * 1000)
  });

  res.setHeader(
    "Set-Cookie",
    clientPortalSecurity.buildSessionCookie(
      token,
      {
        maxAgeSeconds,
        secure: getClientPortalRequestIsSecure(req)
      }
    )
  );
}

function clearClientPortalSessionCookie(req, res) {
  res.setHeader(
    "Set-Cookie",
    clientPortalSecurity.buildClearCookie({
      secure: getClientPortalRequestIsSecure(req)
    })
  );
}

function clientPortalRateLimitKey(
  req,
  action,
  identity = ""
) {
  const forwarded = String(
    req.headers["x-forwarded-for"] || ""
  ).split(",")[0].trim();

  const ip =
    forwarded ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown";

  return [
    action,
    ip,
    normalizeEmail(identity)
  ].join(":");
}

function consumeClientPortalAttempt(
  key,
  options = {}
) {
  const now = Date.now();
  const windowMs = Number(
    options.windowMs || (15 * 60 * 1000)
  );
  const limit = Number(options.limit || 5);
  const current = clientPortalAttemptBuckets.get(key);

  if (
    !current ||
    Number(current.resetAt || 0) <= now
  ) {
    const next = {
      count: 1,
      resetAt: now + windowMs
    };

    clientPortalAttemptBuckets.set(key, next);

    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetAt: next.resetAt
    };
  }

  current.count += 1;
  clientPortalAttemptBuckets.set(key, current);

  return {
    allowed: current.count <= limit,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt
  };
}

function clearClientPortalAttempts(key) {
  clientPortalAttemptBuckets.delete(key);
}

function saveClientPortalLocalOverlay(
  leadId,
  clientPortal,
  updatedAt
) {
  const cleanId = String(leadId || "").trim();
  const localLeads = readLeads();
  const localIndex = localLeads.findIndex(
    (lead) => getLeadIdValue(lead) === cleanId
  );

  if (localIndex >= 0) {
    localLeads[localIndex] = {
      ...localLeads[localIndex],
      clientPortal,
      updatedAt
    };
  } else {
    localLeads.push({
      leadId: cleanId,
      clientPortal,
      updatedAt
    });
  }

  writeLeads(localLeads);

  return {
    ok: true,
    source:
      localIndex >= 0
        ? "local"
        : "local-overlay"
  };
}

async function updateClientPortalLeadStatus(
  leadId,
  applyStatusUpdate,
  options = {}
) {
  const cleanId = String(leadId || "").trim();
  const now = new Date().toISOString();
  const awaitPrimary =
    options?.awaitPrimary === true;

  if (!cleanId) {
    return {
      ok: false,
      error: "The client reference number is missing."
    };
  }

  // Client Portal Foundation V1.0.1:
  // Save the portal status locally first so activation, sign-in, and sign-out
  // never wait for a slower Supabase/CRM request before the browser receives
  // its response. Document workflow updates can opt into an awaited primary
  // sync so two full-record writes cannot race and overwrite checklist data.
  const localLeads = readLeads();
  const localRecord = localLeads.find(
    (record = {}) => getLeadIdValue(record) === cleanId
  ) || {};

  const currentStatus =
    getClientPortalRecord(localRecord) || {};

  const nextStatus = applyStatusUpdate(
    currentStatus,
    localRecord,
    now
  );

  if (!nextStatus) {
    return {
      ok: false,
      error:
        "The client portal status could not be updated."
    };
  }

  const overlay = saveClientPortalLocalOverlay(
    cleanId,
    nextStatus,
    now
  );

  const primarySync =
    updateLeadAfterStripePayment(
      cleanId,
      (record = {}) => ({
        ...record,
        clientPortal: {
          ...(getClientPortalRecord(record) || {}),
          ...nextStatus
        },
        updatedAt: now
      })
    );

  if (awaitPrimary) {
    try {
      const primaryUpdate =
        await primarySync;

      if (!primaryUpdate?.ok) {
        console.warn(
          "[client portal] Awaited CRM status sync used the local overlay:",
          cleanId,
          primaryUpdate?.error || "Primary update unavailable."
        );
      }

      return {
        ok: true,
        source:
          primaryUpdate?.ok
            ? `${overlay.source}+primary-crm-sync`
            : `${overlay.source}+primary-sync-unavailable`,
        status: nextStatus,
        updatedAt: now,
        primaryUpdate
      };
    } catch (error) {
      console.warn(
        "[client portal] Awaited CRM status sync failed; local overlay preserved:",
        cleanId,
        error?.message || error
      );

      return {
        ok: true,
        source:
          `${overlay.source}+primary-sync-failed`,
        status: nextStatus,
        updatedAt: now,
        primaryError:
          error?.message || String(error)
      };
    }
  }

  void primarySync
    .then((primaryUpdate) => {
      if (!primaryUpdate?.ok) {
        console.warn(
          "[client portal] Background CRM status sync used the local overlay:",
          cleanId,
          primaryUpdate?.error || "Primary update unavailable."
        );
      }
    })
    .catch((error) => {
      console.warn(
        "[client portal] Background CRM status sync failed; local overlay preserved:",
        cleanId,
        error?.message || error
      );
    });

  return {
    ok: true,
    source: `${overlay.source}+background-crm-sync`,
    status: nextStatus,
    updatedAt: now
  };
}

async function loadClientPortalLeadCandidates() {
  const byId = new Map();

  try {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    (data || []).forEach((row) => {
      const leadId = getLeadIdValue(row);
      const mappedLead = mapRowToLead(row);

      if (!leadId || isNewsletterOnlyLead(mappedLead)) return;

      byId.set(leadId, {
        leadId,
        raw: row,
        lead: mappedLead,
        portal: getClientPortalRecord(row),
        source: "supabase"
      });
    });
  } catch (error) {
    console.warn(
      "[client portal] Supabase lead load unavailable:",
      error.message || error
    );
  }

  readLeads().forEach((row) => {
    const leadId = getLeadIdValue(row);
    const mapped = mapRowToLead(row);

    if (!leadId || isNewsletterOnlyLead(mapped)) return;

    const existing = byId.get(leadId);
    const localPortal = getClientPortalRecord(row);

    if (!existing) {
      byId.set(leadId, {
        leadId,
        raw: row,
        lead: mapped,
        portal: localPortal,
        source: "local"
      });
      return;
    }

    const authoritativeTranscriptRequest = {
      ...(
        mapped.transcriptRequest ||
        mapped.Request ||
        {}
      ),
      ...(
        existing.lead?.transcriptRequest ||
        existing.lead?.Request ||
        {}
      )
    };

    const hasTranscriptRequest =
      Object.keys(
        authoritativeTranscriptRequest
      ).length > 0;

    const asPlainObject = (
      value
    ) => (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
        ? value
        : {}
    );

    const authoritativeTaxPreparationIntake = {
      ...asPlainObject(
        mapped.taxPreparationIntake
      ),
      ...asPlainObject(
        existing.lead
          ?.taxPreparationIntake
      )
    };

    const authoritativeTaxPreparationWork = {
      ...asPlainObject(
        mapped.taxPreparationWork
      ),
      ...asPlainObject(
        existing.lead
          ?.taxPreparationWork
      )
    };

    const authoritativeExtensionRequest = {
      ...asPlainObject(
        mapped.extensionRequest
      ),
      ...asPlainObject(
        existing.lead
          ?.extensionRequest
      )
    };

    const authoritativeContractor1099Request = {
      ...asPlainObject(
        mapped.contractor1099Request
      ),
      ...asPlainObject(
        existing.lead
          ?.contractor1099Request
      )
    };

    const authoritativeContractor1099Work = {
      ...asPlainObject(
        mapped.contractor1099Work
      ),
      ...asPlainObject(
        existing.lead
          ?.contractor1099Work
      )
    };

    const authoritativeTaxWatchProfile = {
      ...asPlainObject(
        mapped.taxWatchProfile
      ),
      ...asPlainObject(
        existing.lead
          ?.taxWatchProfile
      )
    };

    const authoritativeTaxWatchOrganizer = {
      ...asPlainObject(
        mapped.taxWatchOrganizer
      ),
      ...asPlainObject(
        existing.lead
          ?.taxWatchOrganizer
      )
    };

    const authoritativeTaxWatchMoneyTracker = {
      ...asPlainObject(
        mapped.taxWatchMoneyTracker
      ),
      ...asPlainObject(
        existing.lead
          ?.taxWatchMoneyTracker
      )
    };

    byId.set(leadId, {
      ...existing,
      lead: {
        ...existing.lead,
        ...mapped,
        contact: {
          ...(mapped.contact || {}),
          ...(existing.lead?.contact || {})
        },
        taxData:
          mapped.taxData ||
          existing.lead?.taxData,
        estimateSummary:
          mapped.estimateSummary ||
          existing.lead?.estimateSummary,
        taxSavingsPlanner:
          mapped.taxSavingsPlanner ||
          existing.lead?.taxSavingsPlanner,
        taxWatchProfile:
          Object.keys(
            authoritativeTaxWatchProfile
          ).length
            ? authoritativeTaxWatchProfile
            : null,
        taxWatchOrganizer:
          Object.keys(
            authoritativeTaxWatchOrganizer
          ).length
            ? authoritativeTaxWatchOrganizer
            : null,
        taxWatchMoneyTracker:
          Object.keys(
            authoritativeTaxWatchMoneyTracker
          ).length
            ? authoritativeTaxWatchMoneyTracker
            : null,
        status:
          existing.lead?.status ||
          mapped.status,
        updatedAt:
          existing.lead?.updatedAt ||
          mapped.updatedAt,
        transcriptRequest:
          hasTranscriptRequest
            ? authoritativeTranscriptRequest
            : undefined,
        Request:
          hasTranscriptRequest
            ? authoritativeTranscriptRequest
            : undefined,
        taxPreparationIntake:
          Object.keys(
            authoritativeTaxPreparationIntake
          ).length
            ? authoritativeTaxPreparationIntake
            : null,
        taxPreparationWork:
          Object.keys(
            authoritativeTaxPreparationWork
          ).length
            ? authoritativeTaxPreparationWork
            : null,
        extensionRequest:
          Object.keys(
            authoritativeExtensionRequest
          ).length
            ? authoritativeExtensionRequest
            : null,
        contractor1099Request:
          Object.keys(
            authoritativeContractor1099Request
          ).length
            ? authoritativeContractor1099Request
            : null,
        contractor1099Work:
          Object.keys(
            authoritativeContractor1099Work
          ).length
            ? authoritativeContractor1099Work
            : null,
        clientPortal:
          sanitizeClientPortalRecord(
            localPortal ||
            existing.portal
          )
      },
      portal:
        localPortal ||
        existing.portal,
      source: `${existing.source}+local`
    });
  });

  return Array.from(byId.values());
}

async function findClientPortalLeadById(leadId) {
  const cleanId = String(leadId || "").trim();
  const candidates =
    await loadClientPortalLeadCandidates();

  return candidates.find(
    (entry) => entry.leadId === cleanId
  ) || null;
}

async function findActiveClientPortalAccountByEmail(email) {
  return clientPortalStore.getActiveByEmail(
    normalizeEmail(email)
  );
}

function buildClientPortalAccountSummary(account = {}) {
  if (!account || typeof account !== "object") {
    return null;
  }

  const status = String(account.status || "").trim();
  const email = normalizeEmail(account.email || "");
  const sourceLeadId = String(account.leadId || "").trim();

  if (status !== "active" || !email || !sourceLeadId) {
    return null;
  }

  return {
    status: "active",
    email,
    sourceLeadId,
    activatedAt: String(account.activatedAt || ""),
    lastLoginAt: String(account.lastLoginAt || ""),
    lastActivityAt: String(account.lastActivityAt || "")
  };
}

async function hydrateLeadsWithPortalAccountSummaries(leads = []) {
  const safeLeads = Array.isArray(leads) ? leads : [];
  const emails = Array.from(
    new Set(
      safeLeads
        .map((lead) => getLeadEmailValue(lead))
        .filter(Boolean)
    )
  );

  if (!emails.length || !clientPortalStore.isAvailable()) {
    return safeLeads;
  }

  const accountsByEmail = new Map();

  await Promise.all(
    emails.map(async (email) => {
      try {
        const account =
          await findActiveClientPortalAccountByEmail(email);
        const summary =
          buildClientPortalAccountSummary(account);

        if (summary) {
          accountsByEmail.set(email, summary);
        }
      } catch (error) {
        console.warn(
          "[api/leads] Portal account lookup unavailable:",
          email,
          error?.message || error
        );
      }
    })
  );

  return safeLeads.map((lead) => {
    const email = getLeadEmailValue(lead);
    const portalAccount = accountsByEmail.get(email);

    if (!portalAccount) {
      return lead;
    }

    return {
      ...lead,
      portalAccount
    };
  });
}

async function getClientPortalAccessibleLeads(email) {
  const normalized = normalizeEmail(email);
  const candidates =
    await loadClientPortalLeadCandidates();

  return candidates.filter(
    (entry) =>
      getLeadEmailValue(entry.raw) === normalized
  );
}

function getClientPortalServiceLabel(lead = {}) {
  if (lead.contractor1099Request) {
    return "Contractor Forms 1099";
  }

  if (lead.extensionRequest) {
    return "Tax Extension";
  }

  const transcriptRequest =
    lead.transcriptRequest ||
    lead.Request ||
    {};

  if (
    transcriptRequest.requested ||
    String(lead.status || "")
      .toLowerCase()
      .includes("transcript help")
  ) {
    return "IRS Transcript Help";
  }

  if (lead.taxSavingsPlanner) {
    return "Tax Savings Planner";
  }

  if (lead.writtenReview) {
    return "Written Red Flag Review";
  }

  if (lead.taxPreparationIntake) {
    return "Tax Preparation";
  }

  const requestedService = String(
    lead.contactRequest?.service || ""
  ).trim();

  if (requestedService) {
    return requestedService;
  }

  return "Tax Planning Profile";
}

function normalizeClientPortalServiceLabel(value) {
  const label = String(value || "").trim();
  const lower = label.toLowerCase();

  if (
    lower.includes("transcript")
  ) {
    return "IRS Transcript Help";
  }

  if (
    lower.includes("written") &&
    lower.includes("review")
  ) {
    return "Written Red Flag Review";
  }

  if (
    lower.includes("contractor") &&
    lower.includes("1099")
  ) {
    return "Contractor Forms 1099";
  }

  if (
    lower.includes("extension")
  ) {
    return "Tax Extension";
  }

  if (
    lower.includes("tax prep") ||
    lower.includes("tax preparation")
  ) {
    return "Tax Preparation";
  }

  if (
    lower.includes("tax planning") ||
    lower.includes("strategy")
  ) {
    return "Tax Planning";
  }

  if (
    lower.includes("general question") ||
    lower === "question"
  ) {
    return "General Question";
  }

  if (
    lower.includes("tax savings planner")
  ) {
    return "Tax Savings Planner";
  }

  return label || "Tax Planning Profile";
}

function getClientPortalTranscriptNextAction(
  lead = {},
  transcriptRequest = {}
) {
  const status =
    String(lead.status || "")
      .toLowerCase();

  const payment =
    String(
      transcriptRequest.paymentStatus || ""
    ).toLowerCase();

  const authorization =
    String(
      transcriptRequest.authorizationStatus || ""
    ).toLowerCase();

  const identity =
    String(
      transcriptRequest.identityVerified || ""
    ).toLowerCase();

  const transcriptType =
    String(
      transcriptRequest.transcriptType || ""
    ).toLowerCase();

  const years =
    String(
      transcriptRequest.yearsNeeded ||
      transcriptRequest.taxYears ||
      ""
    ).trim();

  if (
    status === "transcript help - completed" ||
    String(
      transcriptRequest.internalStatus || ""
    ).toLowerCase() === "completed"
  ) {
    return "Your IRS Transcript Help service is complete.";
  }

  if (
    !payment.includes("paid") &&
    !payment.includes("verified")
  ) {
    return "Complete the $150 IRS Transcript Help payment.";
  }

  if (
    !authorization.includes("received") &&
    !authorization.includes("signed")
  ) {
    if (
      transcriptRequest.authorizationPortalReviewStatus ===
      "needs-replacement"
    ) {
      return (
        transcriptRequest.authorizationPortalMessage ||
        "Upload a corrected signed Form 8821 using the secure backup upload."
      );
    }

    if (authorization.includes("sent")) {
      return "Complete the Form 8821 e-sign request sent by the office. Use the secure backup upload only when instructed.";
    }

    return "The office will prepare and send Form 8821 through PitBullTax / DocuSign.";
  }

  if (identity !== "yes") {
    return "Complete identity verification using the secure method provided by the office.";
  }

  if (
    !transcriptType ||
    transcriptType.includes("need") ||
    transcriptType.includes("not sure") ||
    !years
  ) {
    return "Confirm the transcript type and tax year information with the office.";
  }

  if (!transcriptRequest.transcriptPulledDate) {
    return "Authorization is complete. The office is preparing to pull your IRS transcript.";
  }

  if (!transcriptRequest.transcriptReceivedDate) {
    return "Your transcript has been requested and is awaiting office review.";
  }

  if (!transcriptRequest.deliveryDate) {
    return "Your transcript is being reviewed for secure delivery.";
  }

  return "Your transcript was delivered securely.";
}

function buildClientPortalTranscriptRequestSummary(
  entry
) {
  const lead = entry?.lead || {};
  const transcriptRequest =
    lead.transcriptRequest ||
    lead.Request ||
    {};

  const status =
    String(lead.status || "");

  const isTranscriptRequest =
    Boolean(transcriptRequest.requested) ||
    status
      .toLowerCase()
      .includes("transcript help");

  if (!isTranscriptRequest) {
    return null;
  }

  const authorizationStatus =
    String(
      transcriptRequest.authorizationStatus ||
      "Need 8821"
    );

  const completed =
    status.toLowerCase() ===
      "transcript help - completed" ||
    String(
      transcriptRequest.internalStatus || ""
    ).toLowerCase() === "completed";

  const authorizationReceived =
    /received|signed/i.test(
      authorizationStatus
    ) ||
    Boolean(
      transcriptRequest.authorizationReceivedDate
    );

  return {
    leadId:
      String(entry.leadId || ""),
    clientName:
      String(
        lead?.contact?.name ||
        getLeadNameValue(entry.raw) ||
        "Client"
      ),
    requestReference:
      String(entry.leadId || ""),
    taxYears:
      String(
        transcriptRequest.yearsNeeded ||
        transcriptRequest.taxYears ||
        getClientPortalTaxYear(
          lead,
          lead.taxSavingsPlanner || {}
        ) ||
        "Not recorded"
      ),
    transcriptType:
      String(
        transcriptRequest.transcriptType ||
        "Not selected yet"
      ),
    paymentStatus:
      String(
        transcriptRequest.paymentStatus ||
        "Need Payment"
      ),
    authorizationStatus,
    authorizationSentDate:
      String(
        transcriptRequest.authorizationSentDate ||
        ""
      ),
    authorizationReceivedDate:
      String(
        transcriptRequest.authorizationReceivedDate ||
        ""
      ),
    authorizationPortalReviewStatus:
      String(
        transcriptRequest.authorizationPortalReviewStatus ||
        ""
      ),
    authorizationPortalMessage:
      String(
        transcriptRequest.authorizationPortalMessage ||
        ""
      ).slice(0, 1200),
    identityVerified:
      String(
        transcriptRequest.identityVerified ||
        "No"
      ),
    identityVerifiedDate:
      String(
        transcriptRequest.identityVerifiedDate ||
        ""
      ),
    identityPortalReviewStatus:
      String(
        transcriptRequest.identityPortalReviewStatus ||
        ""
      ),
    identityPortalMessage:
      String(
        transcriptRequest.identityPortalMessage ||
        ""
      ).slice(0, 1200),
    internalStatus:
      String(
        transcriptRequest.internalStatus ||
        "Open"
      ),
    transcriptPulledDate:
      String(
        transcriptRequest.transcriptPulledDate ||
        ""
      ),
    transcriptReceivedDate:
      String(
        transcriptRequest.transcriptReceivedDate ||
        ""
      ),
    deliveryMethod:
      String(
        transcriptRequest.deliveryMethod ||
        ""
      ),
    deliveryDate:
      String(
        transcriptRequest.deliveryDate ||
        ""
      ),
    deliveryDocumentId:
      String(
        transcriptRequest.deliveryDocumentId ||
        ""
      ),
    deliveryFileLocation:
      String(
        transcriptRequest.deliveryFileLocation ||
        ""
      ),
    deliveryPortalStatus:
      String(
        transcriptRequest.deliveryPortalStatus ||
        ""
      ),
    deliveryPortalMessage:
      String(
        transcriptRequest.deliveryPortalMessage ||
        ""
      ).slice(0, 1200),
    completed,
    authorizationReceived,
    canUploadSigned8821:
      !completed &&
      !authorizationReceived,
    canUploadIdentityVerification:
      !completed &&
      authorizationReceived &&
      String(
        transcriptRequest.identityVerified || ""
      ).toLowerCase() !== "yes",
    nextAction:
      getClientPortalTranscriptNextAction(
        lead,
        transcriptRequest
      ),
    updatedAt:
      String(
        transcriptRequest.lastSavedAt ||
        transcriptRequest.updatedAt ||
        lead.updatedAt ||
        lead.timestamp ||
        ""
      )
  };
}


const TAX_PREPARATION_SERVICE_LABELS = Object.freeze({
  individual_federal_state:
    "Individual tax return — W-2 and/or 1099 income",
  prior_year_return:
    "Prior-year or multiple-year return",
  multiple_states:
    "Multi-state return",
  business_return:
    "Business or entity return",
  partnership_return:
    "Partnership return",
  s_corporation_return:
    "S corporation return",
  c_corporation_return:
    "C corporation return",
  nonprofit_return:
    "Nonprofit return"
});

const TAX_PREPARATION_INCOME_LABELS = Object.freeze({
  w2_income:
    "I received a W-2",
  "1099_nec":
    "I received a 1099 or 1099-NEC for contractor or self-employment income",
  "1099_k":
    "I received a 1099-K from a payment app, platform, or online marketplace",
  "1099_other":
    "I received another type of 1099",
  gig_platform:
    "Uber, Lyft, DoorDash, Instacart, or other gig-work income",
  creator_income:
    "TikTok, YouTube, Twitch, influencer, or creator income",
  self_employment:
    "Freelance, consulting, or other self-employment income",
  minister_clergy:
    "Minister, clergy, speaker, or housing allowance",
  stocks_bonds_investments:
    "Stocks, bonds, mutual funds, or investment sales",
  interest_dividends:
    "Interest or dividend income",
  foreign_tax:
    "Foreign tax, foreign income, or foreign accounts",
  estimated_tax_payments:
    "Federal or state estimated-tax payments",
  rental_income:
    "Rental property income or expenses",
  k1_income:
    "Schedule K-1 income",
  retirement_income:
    "Pension, IRA, or Social Security income",
  cryptocurrency:
    "Digital asset or cryptocurrency activity",
  other_income:
    "Other income not listed"
});

function taxPreparationLabelList(
  values,
  labelMap
) {
  const list =
    Array.isArray(values)
      ? values
      : [];

  return list.map(
    (value) =>
      labelMap[value] ||
      String(value || "")
        .replace(/[_-]+/g, " ")
        .replace(
          /\b\w/g,
          (letter) =>
            letter.toUpperCase()
        )
        .trim()
  );
}

function buildTaxPreparationDocumentChecklist(
  intake = {}
) {
  const services =
    new Set(
      Array.isArray(intake.serviceTypes)
        ? intake.serviceTypes
        : []
    );

  const incomeTypes =
    new Set(
      Array.isArray(intake.incomeTypes)
        ? intake.incomeTypes
        : []
    );

  const checklist = [];
  const add = (item) => {
    const text = String(item || "").trim();

    if (
      text &&
      !checklist.includes(text)
    ) {
      checklist.push(text);
    }
  };

  add(
    "Government-issued photo ID for each taxpayer."
  );

  add(
    "Social Security cards or ITIN letters for taxpayers and dependents."
  );

  add(
    "Prior-year federal and state tax return, if available."
  );

  if (incomeTypes.has("w2_income")) {
    add(
      "Every W-2 received for the tax year."
    );
  }

  if (incomeTypes.has("1099_nec")) {
    add(
      "Every 1099 or 1099-NEC received for contractor or self-employment income."
    );

    add(
      "Business-income records and a list of related business expenses, even when an expense is not shown on a 1099."
    );
  }

  if (incomeTypes.has("1099_k")) {
    add(
      "Every 1099-K plus related payment-platform or marketplace statements."
    );

    add(
      "Records showing which 1099-K amounts were business income, personal transfers, refunds, or other non-taxable activity."
    );
  }

  if (incomeTypes.has("1099_other")) {
    add(
      "Every other 1099 received, including any 1099-MISC, 1099-INT, 1099-DIV, 1099-R, or SSA-1099."
    );
  }

  if (
    incomeTypes.has("gig_platform") ||
    incomeTypes.has("creator_income") ||
    incomeTypes.has("self_employment")
  ) {
    add(
      "Year-end platform statements, income summaries, and business-expense records."
    );
  }

  if (incomeTypes.has("minister_clergy")) {
    add(
      "W-2 or 1099 forms, housing-allowance records, and ministry-related expense records."
    );
  }

  if (
    incomeTypes.has("stocks_bonds_investments")
  ) {
    add(
      "Brokerage 1099-B statements, year-end investment statements, and cost-basis information."
    );
  }

  if (incomeTypes.has("interest_dividends")) {
    add(
      "All 1099-INT and 1099-DIV forms."
    );
  }

  if (incomeTypes.has("foreign_tax")) {
    add(
      "Foreign-income statements, foreign-tax records, and foreign-account information requested by the office."
    );
  }

  if (
    incomeTypes.has(
      "estimated_tax_payments"
    )
  ) {
    add(
      "Federal and state estimated-tax payment confirmations, including payment dates and amounts."
    );
  }

  if (incomeTypes.has("rental_income")) {
    add(
      "Rental-income and expense records, property information, mortgage statements, and prior depreciation records."
    );
  }

  if (incomeTypes.has("k1_income")) {
    add(
      "Every Schedule K-1 received."
    );
  }

  if (
    incomeTypes.has(
      "retirement_income"
    )
  ) {
    add(
      "All 1099-R and SSA-1099 forms."
    );
  }

  if (
    incomeTypes.has(
      "cryptocurrency"
    )
  ) {
    add(
      "Cryptocurrency transaction reports, gain/loss summaries, and wallet or exchange statements."
    );
  }

  if (incomeTypes.has("other_income")) {
    add(
      "Records supporting the other income described in your intake."
    );
  }

  if (
    services.has("business_return") ||
    services.has("partnership_return") ||
    services.has("s_corporation_return") ||
    services.has("c_corporation_return") ||
    services.has("nonprofit_return")
  ) {
    add(
      "Prior-year business return, year-end profit-and-loss statement, balance sheet, and entity records."
    );
  }

  if (
    services.has("multiple_states") ||
    Number(intake.stateCount || 1) > 1
  ) {
    add("Income, withholding, and residency records for every state involved.");
  }
  if (String(intake.contractor1099Requirement || "").toLowerCase() === "yes") {
    add("Contractor payment totals, W-9 forms, and copies of any Forms 1099 filed or still needing review.");
  }
  if (String(intake.businessVehicleUsed || "").toLowerCase() === "yes") {
    add("Business mileage log, vehicle purchase or lease information, and the date the vehicle was first used for business.");
  }
  if (["no", "not_sure"].includes(String(intake.businessTaxStatus || "").toLowerCase())) {
    add("Business-tax notices, prior filings, and payment records for any federal, state, or local business taxes that may not be current.");
  }

  return checklist;
}

function getTaxPreparationPortalNextAction(
  lead = {},
  work = {}
) {
  const workStatus = String(
    work.workStatus ||
    lead.status ||
    ""
  ).toLowerCase();

  const documentStatus = String(
    work.documentStatus || ""
  ).toLowerCase();

  if (
    workStatus.includes("accepted") ||
    workStatus.includes("completed")
  ) {
    return "Your tax return is complete. Download any available final client copy from the Secure Document Center.";
  }

  if (
    workStatus.includes("submitted") ||
    workStatus.includes("awaiting acceptance")
  ) {
    return "Your return was submitted and is awaiting the next filing-status update.";
  }

  if (
    workStatus.includes("ready to e-file") ||
    workStatus.includes("signature")
  ) {
    return "Review and complete any signature or authorization step requested by the office.";
  }

  if (workStatus.includes("in preparation")) {
    return "Your return is in preparation. The office will contact you if additional information is needed.";
  }

  if (
    documentStatus.includes("needed") ||
    workStatus.includes("documents needed")
  ) {
    return "Upload the requested tax documents through the Secure Document Center.";
  }

  if (workStatus.includes("portal activation")) {
    return "Your secure portal is ready. Use the Document Center to begin providing tax records.";
  }

  if (workStatus.includes("review")) {
    return "The office is reviewing your tax-preparation request and will confirm the next step.";
  }

  return "The office is reviewing your tax-preparation request.";
}

function buildClientPortalTaxPreparationSummary(entry) {
  const lead = entry?.lead || {};
  const intake = lead.taxPreparationIntake || {};
  const work = lead.taxPreparationWork || {};
  const status = String(lead.status || "");

  const isTaxPreparation =
    Boolean(lead.taxPreparationIntake) ||
    Boolean(lead.taxPreparationWork) ||
    String(entry?.leadId || "")
      .startsWith("TAXPREP-") ||
    status.toLowerCase()
      .includes("tax preparation");

  if (!isTaxPreparation) {
    return null;
  }

  return {
    leadId: String(entry.leadId || ""),
    clientName: String(
      lead.contact?.name ||
      getLeadNameValue(entry.raw) ||
      "Client"
    ),
    taxYear: String(
      intake.taxYear ||
      lead.taxData?.taxYear ||
      "Not recorded"
    ),
    returnType: String(
      intake.recommendedLane ||
      work.returnType ||
      "Tax Preparation"
    ),
    workStatus: String(
      work.workStatus ||
      status ||
      "New Request"
    ),
    documentStatus: String(
      work.documentStatus ||
      "Documents Needed"
    ),
    paymentStatus: String(
      work.paymentStatus ||
      "Quote Needed"
    ),
    quotedFee: Number(work.quotedFee || 0),
    amountPaid: Number(work.amountPaid || 0),
    signatureStatus: String(
      work.signatureStatus ||
      "Not Requested"
    ),
    acceptanceStatus: String(
      work.acceptanceStatus ||
      "Not Submitted"
    ),
    efileStatus: String(
      work.efileStatus ||
      "Not Started"
    ),
    finalReturnDeliveryStatus: String(
      work.finalReturnDeliveryStatus ||
      "Not Delivered"
    ),
    serviceLabels:
      taxPreparationLabelList(
        intake.serviceTypes,
        TAX_PREPARATION_SERVICE_LABELS
      ),
    incomeLabels:
      taxPreparationLabelList(
        intake.incomeTypes,
        TAX_PREPARATION_INCOME_LABELS
      ),
    documentChecklist:
      buildTaxPreparationDocumentChecklist(
        intake
      ),
    form1099Count: Number(
      intake.form1099Count || 0
    ),
    received1099Nec: String(
      intake.received1099Nec || ""
    ),
    has1099Expenses: String(
      intake.has1099Expenses || ""
    ),
    businessTradeName: String(
      intake.businessTradeName || ""
    ),
    hasEin: String(
      intake.hasEin || ""
    ),
    llcStatus: String(
      intake.llcStatus || ""
    ),
    businessEntityType: String(
      intake.businessEntityType || ""
    ),
    principalBusinessProfession: String(
      intake.principalBusinessProfession || ""
    ),
    businessAddressSameAsHome: String(
      intake.businessAddressSameAsHome || ""
    ),
    businessAddress: String(
      intake.businessAddress || ""
    ),
    businessAddressStreet: String(
      intake.businessAddressStreet || ""
    ),
    businessAddressCity: String(
      intake.businessAddressCity || ""
    ),
    businessAddressState: String(
      intake.businessAddressState || ""
    ),
    businessAddressZip: String(
      intake.businessAddressZip || ""
    ),
    digitalAssetActivity: String(
      intake.digitalAssetActivity || ""
    ),
    accountingMethod: String(
      intake.accountingMethod || ""
    ),
    materialParticipation: String(
      intake.materialParticipation || ""
    ),
    businessStartYear: String(intake.businessStartYear || ""),
    businessTaxStatus: String(intake.businessTaxStatus || ""),
    contractor1099Requirement: String(intake.contractor1099Requirement || ""),
    contractor1099Filed: String(intake.contractor1099Filed || ""),
    businessVehicleUsed: String(intake.businessVehicleUsed || ""),
    vehicleBusinessUseDate: String(intake.vehicleBusinessUseDate || ""),
    vehicleBusinessUseDateUnknown: intake.vehicleBusinessUseDateUnknown === true || String(intake.vehicleBusinessUseDateUnknown || "").toLowerCase() === "yes",
    businessProfileApplies:
      intake.businessProfileApplies === true,
    usedBusinessName: String(
      intake.usedBusinessName || ""
    ),
    multiState1099: String(
      intake.multiState1099 || ""
    ),
    completed:
      /accepted|completed|closed/i.test(
        String(
          work.workStatus ||
          status
        )
      ),
    nextAction:
      getTaxPreparationPortalNextAction(
        lead,
        work
      ),
    updatedAt: String(
      work.updatedAt ||
      lead.updatedAt ||
      lead.timestamp ||
      ""
    )
  };
}


function contractor1099Label(value) {
  const labels = {
    original_1099_nec:
      "Original Form 1099-NEC",
    original_1099_misc:
      "Original Form 1099-MISC",
    correction:
      "Correction",
    late_filing:
      "Late / Past-Due Filing",
    recipient_copies:
      "Recipient Copies",
    not_sure:
      "Form Type Not Sure",
    all_collected:
      "W-9 collected for every payee",
    some_missing:
      "Some W-9s are missing",
    none_collected:
      "No W-9s collected",
    complete:
      "Complete",
    partial:
      "Partial",
    not_ready:
      "Not Ready",
    on_time:
      "Original / On-Time Filing",
    late:
      "Deadline May Have Passed",
    primary_state_only:
      "Primary State Only",
    multiple_states:
      "Multiple States",
    secure_electronic:
      "Secure Electronic Delivery",
    paper_mail:
      "Paper / Mail Delivery",
    client_handles:
      "Business Delivers Recipient Copies",
    office_recommendation:
      "Office Recommendation",
    not_expected:
      "No State Filing Expected",
    information_missing:
      "Some Contractor Information Is Missing",
    resolved:
      "Resolved",
    not_required:
      "Not Required",
    yes:
      "Yes",
    no:
      "No"
  };

  const key = String(value || "").trim();

  return labels[key] ||
    key
      .replace(/[_-]+/g, " ")
      .replace(
        /\b\w/g,
        (letter) => letter.toUpperCase()
      )
      .trim();
}

const CONTRACTOR_1099_STRIPE_OWNED_WORK_FIELDS = new Set([
  "paymentStatus",
  "amountPaid",
  "amountPaidCents",
  "paymentVerifiedAt",
  "paidAt",
  "lastPaymentAt",
  "lastPaymentAmountCents",
  "lastPaymentPurpose",
  "stripeCheckoutSessionId",
  "stripeCheckoutUrl",
  "stripePaymentIntentId",
  "checkoutCreatedAt",
  "processedStripeSessions",
  "paymentSource",
  "paymentLinkSentAt",
  "paymentLinkEmailSent",
  "paymentLinkEmailError",
  "completionEmailSentAt",
  "completionEmailStatus",
  "completionEmailError",
  "completionEmailResendCount"
]);

function mergeContractor1099OfficeWork(
  existingWork = {},
  incomingWork = {}
) {
  const existing =
    existingWork &&
    typeof existingWork === "object" &&
    !Array.isArray(existingWork)
      ? existingWork
      : {};

  const incoming =
    incomingWork &&
    typeof incomingWork === "object" &&
    !Array.isArray(incomingWork)
      ? incomingWork
      : {};

  const merged = {
    ...existing,
    ...incoming
  };

  for (const field of
    CONTRACTOR_1099_STRIPE_OWNED_WORK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(existing, field)) {
      merged[field] = existing[field];
    } else {
      delete merged[field];
    }
  }

  if (
    String(merged.paymentRequirement || "Required") ===
    "Waived by Office"
  ) {
    merged.paymentStatus = "Waived by Office";
  } else if (
    !merged.paymentStatus ||
    merged.paymentStatus === "Waived by Office"
  ) {
    const quotedFeeCents = Math.max(
      0,
      Number.parseInt(merged.quotedFeeCents, 10) || 0
    );

    const amountPaidCents = Math.max(
      0,
      Number.parseInt(merged.amountPaidCents, 10) || 0
    );

    merged.paymentStatus =
      quotedFeeCents > 0 &&
      amountPaidCents >= quotedFeeCents
        ? "Paid / Verified"
        : quotedFeeCents > 0
          ? "Payment Pending"
          : "Quote Needed";
  }

  return merged;
}

function contractor1099CompletionRequested(
  status = "",
  work = {}
) {
  const workStatus = String(
    work?.workStatus || ""
  ).trim();

  const leadStatus = String(status || "").trim();

  return (
    /^completed$/i.test(workStatus) ||
    /^contractor 1099\s*-\s*completed$/i.test(
      leadStatus
    )
  );
}

function getContractor1099CompletionMissing(
  lead = {}
) {
  const work =
    lead.contractor1099Work &&
    typeof lead.contractor1099Work === "object"
      ? lead.contractor1099Work
      : {};

  const missing = [];

  const legacyPayeeComplete =
    String(work.payeeInformationStatus || "") ===
    "Complete";

  const contractorInformationStatus = String(
    work.contractorInformationStatus ||
    (legacyPayeeComplete
      ? "Complete"
      : "Information Needed")
  );

  const w9RequirementStatus = String(
    work.w9RequirementStatus ||
    (legacyPayeeComplete
      ? "Resolved"
      : "W-9s Needed")
  );

  const quotedFeeCents = Math.max(
    0,
    Number.parseInt(work.quotedFeeCents, 10) ||
    Math.round(
      Math.max(0, Number(work.quotedFee || 0)) *
      100
    )
  );

  const amountPaidCents = Math.max(
    0,
    Number.parseInt(work.amountPaidCents, 10) || 0
  );

  if (
    String(work.payerInformationStatus || "") !==
    "Complete"
  ) {
    missing.push(
      "Client and payer business information must be reviewed and marked Complete"
    );
  }

  if (contractorInformationStatus !== "Complete") {
    missing.push(
      "Contractor or payee information must be Complete"
    );
  }

  if (
    !/^(resolved|not required)$/i.test(
      w9RequirementStatus
    )
  ) {
    missing.push(
      "The W-9 requirement must be Resolved or Not Required"
    );
  }

  if (
    !/complete/i.test(
      String(work.documentStatus || "")
    )
  ) {
    missing.push(
      "Required secure documents must be Complete"
    );
  }

  if (
    String(work.paymentRequirement || "Required") !==
      "Waived by Office" &&
    !(
      quotedFeeCents > 0 &&
      amountPaidCents >= quotedFeeCents
    )
  ) {
    missing.push(
      "Stripe must verify full payment, or the office must waive payment"
    );
  }

  if (
    !/^(complete|ready to file)$/i.test(
      String(work.preparationStatus || "")
    )
  ) {
    missing.push(
      "Forms must be prepared and marked Complete or Ready to File"
    );
  }

  if (
    !/^(filed|accepted|not required)$/i.test(
      String(work.filingStatus || "")
    ) ||
    !/^(accepted|not required)$/i.test(
      String(work.irsAcceptanceStatus || "")
    )
  ) {
    missing.push(
      "Federal filing and IRS acceptance must be recorded, or marked Not Required"
    );
  }

  if (
    !/^(filed|accepted|not required)$/i.test(
      String(work.stateFilingWorkStatus || "")
    )
  ) {
    missing.push(
      "State filing must be completed or marked Not Required"
    );
  }

  if (
    !/^delivered$/i.test(
      String(work.recipientCopyStatus || "")
    )
  ) {
    missing.push(
      "Recipient copies must be Delivered"
    );
  }

  if (
    !/^delivered$/i.test(
      String(work.filingConfirmationStatus || "")
    )
  ) {
    missing.push(
      "The filing confirmation must be Delivered to the client"
    );
  }

  return missing;
}

function contractor1099CompletionError(missing = []) {
  const error = new Error(
    "This Contractor 1099 service cannot be completed until every mandatory item is finished."
  );

  error.code =
    "CONTRACTOR_1099_COMPLETION_BLOCKED";
  error.missing = Array.isArray(missing)
    ? missing
    : [];

  return error;
}

function buildContractor1099DocumentChecklist(
  request = {}
) {
  const checklist = [];
  const add = (value) => {
    const text = String(value || "").trim();

    if (text && !checklist.includes(text)) {
      checklist.push(text);
    }
  };

  add(
    "Business legal name, mailing address, and taxpayer identification information for the payer."
  );

  add(
    "A completed Form W-9 or equivalent payee information for every contractor or other recipient."
  );

  add(
    "Year-end payment total for each payee, separated by payment type when needed."
  );

  if (
    Array.isArray(request.serviceTypes) &&
    request.serviceTypes.includes("correction")
  ) {
    add(
      "Copy of every original Form 1099 that needs correction plus the exact corrected name, TIN, address, or amount."
    );
  }

  if (
    Array.isArray(request.serviceTypes) &&
    request.serviceTypes.includes("late_filing")
  ) {
    add(
      "Any prior filing confirmation, IRS or state notice, and the date the missing form was discovered."
    );
  }

  if (
    Number(request.stateCount || 1) > 1 ||
    request.stateFilingStatus === "multiple_states"
  ) {
    add(
      "State allocation details and any state withholding for each payee."
    );
  }

  if (
    request.backupWithholdingStatus === "yes" ||
    request.backupWithholdingStatus === "not_sure"
  ) {
    add(
      "Backup-withholding records, deposit confirmations, and any Form 945 information available."
    );
  }

  add(
    "Prior-year payer copies or filing confirmation when available."
  );

  return checklist;
}

function getContractor1099PortalNextAction(
  lead = {},
  work = {}
) {
  const status = String(
    work.workStatus ||
    lead.status ||
    ""
  ).toLowerCase();

  if (
    status.includes("completed") ||
    status.includes("closed")
  ) {
    return "The Contractor Forms 1099 service is complete. Keep filing confirmations and recipient copies with the business records.";
  }

  if (
    status.includes("filed") ||
    status.includes("awaiting acceptance")
  ) {
    return "The forms were submitted. The office is monitoring acceptance and recipient-copy delivery.";
  }

  const legacyPayeeComplete =
    String(work.payeeInformationStatus || "") ===
    "Complete";

  const contractorInformationStatus = String(
    work.contractorInformationStatus ||
    (legacyPayeeComplete
      ? "Complete"
      : "Information Needed")
  );

  const w9RequirementStatus = String(
    work.w9RequirementStatus ||
    (legacyPayeeComplete
      ? "Resolved"
      : "W-9s Needed")
  );

  if (
    contractorInformationStatus !== "Complete" ||
    !/^(resolved|not required)$/i.test(
      w9RequirementStatus
    ) ||
    String(work.documentStatus || "")
      .toLowerCase()
      .includes("needed")
  ) {
    return "Upload missing W-9s, contractor information, and payment totals through the Secure Document Center.";
  }

  if (
    !String(work.paymentStatus || "")
      .toLowerCase()
      .includes("paid") &&
    String(work.paymentRequirement || "Required") !==
      "Waived by Office"
  ) {
    return "The office is reviewing the request and will send a secure payment link after the service quote is approved.";
  }

  if (status.includes("ready to prepare")) {
    return "The request is ready for the office to prepare the forms.";
  }

  if (status.includes("preparing")) {
    return "The office is preparing the Contractor Forms 1099 and will contact you if a payer or payee record needs correction.";
  }

  if (
    /accepted|filed/i.test(
      String(work.irsAcceptanceStatus || "") +
      " " +
      String(work.filingStatus || "")
    ) &&
    !/^delivered$/i.test(
      String(work.filingConfirmationStatus || "")
    )
  ) {
    return "The office must deliver the filing confirmation before the service can be completed.";
  }

  return "The office is reviewing the request, W-9 readiness, filing timing, and service quote.";
}

function buildClientPortalContractor1099Summary(entry) {
  const lead = entry?.lead || {};
  const request = lead.contractor1099Request || {};
  const work = lead.contractor1099Work || {};
  const status = String(lead.status || "");

  const isContractor1099 =
    Boolean(lead.contractor1099Request) ||
    Boolean(lead.contractor1099Work) ||
    String(entry?.leadId || "")
      .startsWith("C1099-") ||
    status.toLowerCase()
      .includes("contractor 1099");

  if (!isContractor1099) {
    return null;
  }

  return {
    leadId: String(entry.leadId || ""),
    clientName: String(
      lead.contact?.name ||
      getLeadNameValue(entry.raw) ||
      "Client"
    ),
    businessLegalName: String(
      request.businessLegalName || ""
    ),
    businessTradeName: String(
      request.businessTradeName || ""
    ),
    taxYear: String(
      request.taxYear ||
      lead.taxData?.taxYear ||
      "Not recorded"
    ),
    serviceLabels:
      Array.isArray(request.serviceTypes)
        ? request.serviceTypes.map(
            contractor1099Label
          )
        : [],
    recipientCount: Number(
      request.recipientCount || 0
    ),
    totalInformationReturns: Number(
      request.totalInformationReturns || 0
    ),
    electronicFilingReview:
      request.electronicFilingReview === true,
    w9Status: contractor1099Label(
      request.w9Status
    ),
    contractorInformationReadiness:
      contractor1099Label(
        request.contractorInformationStatus
      ),
    federalFilingNeeded:
      contractor1099Label(
        request.federalFilingNeeded
      ),
    paymentRecordsStatus:
      contractor1099Label(
        request.paymentRecordsStatus
      ),
    deadlineStatus: contractor1099Label(
      request.deadlineStatus
    ),
    primaryState: String(
      request.primaryState || ""
    ),
    stateCount: Number(
      request.stateCount || 1
    ),
    stateFilingStatus:
      contractor1099Label(
        request.stateFilingStatus
      ),
    recipientCopyMethod:
      contractor1099Label(
        request.recipientCopyMethod
      ),
    workStatus: String(
      work.workStatus ||
      status ||
      "New Request"
    ),
    documentStatus: String(
      work.documentStatus ||
      "Documents Needed"
    ),
    payerInformationStatus: String(
      work.payerInformationStatus ||
      "Needs Review"
    ),
    payeeInformationStatus: String(
      work.payeeInformationStatus ||
      "W-9s Needed"
    ),
    contractorInformationStatus: String(
      work.contractorInformationStatus ||
      (
        String(work.payeeInformationStatus || "") ===
        "Complete"
          ? "Complete"
          : "Information Needed"
      )
    ),
    w9RequirementStatus: String(
      work.w9RequirementStatus ||
      (
        String(work.payeeInformationStatus || "") ===
        "Complete"
          ? "Resolved"
          : "W-9s Needed"
      )
    ),
    paymentStatus: String(
      work.paymentStatus ||
      "Quote Needed"
    ),
    quotedFee: Number(
      work.quotedFee || 0
    ),
    amountPaid: Number(
      work.amountPaid || 0
    ),
    preparationStatus: String(
      work.preparationStatus ||
      "Not Started"
    ),
    filingStatus: String(
      work.filingStatus ||
      "Not Started"
    ),
    irsAcceptanceStatus: String(
      work.irsAcceptanceStatus ||
      "Not Submitted"
    ),
    stateFilingWorkStatus: String(
      work.stateFilingWorkStatus ||
      "Not Reviewed"
    ),
    recipientCopyStatus: String(
      work.recipientCopyStatus ||
      "Not Delivered"
    ),
    filingConfirmationStatus: String(
      work.filingConfirmationStatus ||
      "Not Delivered"
    ),
    documentChecklist:
      buildContractor1099DocumentChecklist(
        request
      ),
    completed:
      /completed|closed/i.test(
        String(
          work.workStatus ||
          status
        )
      ),
    nextAction:
      getContractor1099PortalNextAction(
        lead,
        work
      ),
    updatedAt: String(
      work.updatedAt ||
      lead.updatedAt ||
      lead.timestamp ||
      ""
    )
  };
}


function getExtensionPortalNextAction(
  lead = {},
  request = {}
) {
  const workStatus = String(
    request.workStatus ||
    lead.status ||
    ""
  ).toLowerCase();

  const paymentStatus = String(
    request.paymentStatus || ""
  ).toLowerCase();

  if (
    workStatus.includes("completed") ||
    workStatus.includes("confirmation delivered")
  ) {
    return "Your extension confirmation has been delivered. Keep it with your tax records and complete the full return by the extended filing deadline.";
  }

  if (workStatus.includes("filed")) {
    return "Your extension was filed. The office is preparing the filing confirmation for secure delivery.";
  }

  if (workStatus.includes("ready to file")) {
    return "Your extension information is complete and ready for filing.";
  }

  if (
    workStatus.includes("deadline review") ||
    workStatus.includes("information needed")
  ) {
    return "The office needs to confirm deadline eligibility or additional information before filing.";
  }

  if (
    !paymentStatus.includes("paid") &&
    !paymentStatus.includes("verified")
  ) {
    return "Complete the extension-service payment after deadline eligibility is confirmed.";
  }

  return "The office is reviewing your paid extension request.";
}

function buildClientPortalExtensionSummary(entry) {
  const lead = entry?.lead || {};
  const request = lead.extensionRequest || {};
  const status = String(lead.status || "");

  const isExtension =
    Boolean(lead.extensionRequest) ||
    String(entry?.leadId || "")
      .startsWith("EXT-") ||
    status.toLowerCase()
      .includes("extension request");

  if (!isExtension) {
    return null;
  }

  const serviceType =
    String(request.serviceType || "individual")
      .toLowerCase() === "business"
      ? "Business Extension"
      : "Individual Extension";

  return {
    leadId: String(entry.leadId || ""),
    clientName: String(
      lead.contact?.name ||
      getLeadNameValue(entry.raw) ||
      "Client"
    ),
    taxYear: String(
      request.taxYear ||
      lead.taxData?.taxYear ||
      "Not recorded"
    ),
    serviceType,
    stateExtensionRequested:
      request.stateExtensionRequested === true,
    stateCode: String(
      request.stateCode || ""
    ),
    paymentStatus: String(
      request.paymentStatus ||
      "Payment Pending"
    ),
    workStatus: String(
      request.workStatus ||
      status ||
      "New Request"
    ),
    totalPrice: Number(
      request.totalPrice || 0
    ),
    confirmationStatus: String(
      request.confirmationStatus ||
      "Not Delivered"
    ),
    completed:
      /completed|confirmation delivered|closed/i.test(
        String(
          request.workStatus ||
          status
        )
      ),
    nextAction:
      getExtensionPortalNextAction(
        lead,
        request
      ),
    updatedAt: String(
      request.updatedAt ||
      lead.updatedAt ||
      lead.timestamp ||
      ""
    )
  };
}

function getClientPortalRecordDate(lead = {}, planner = {}) {
  const values = [
    planner.syncedAt,
    planner.updatedAt,
    lead.updatedAt,
    lead.timestamp,
    lead.createdAt,
    lead.estimate?.timestamp
  ];

  return String(
    values.find((value) => value) || ""
  );
}

function getClientPortalTaxYear(lead = {}, planner = {}) {
  return String(
    planner.taxYear ||
    lead.contractor1099Request?.taxYear ||
    lead.extensionRequest?.taxYear ||
    lead.taxPreparationIntake?.taxYear ||
    lead.taxData?.taxYear ||
    lead.taxYear ||
    lead.filingYear ||
    lead.estimate?.taxData?.taxYear ||
    "Not recorded"
  );
}

function buildClientPortalLeadSummary(entry) {
  const lead = entry.lead || {};
  const planner = lead.taxSavingsPlanner || {};
  const summary = planner.summary || {};
  const service = normalizeClientPortalServiceLabel(
    getClientPortalServiceLabel(lead)
  );

  return {
    leadId: entry.leadId,
    taxYear: getClientPortalTaxYear(
      lead,
      planner
    ),
    service,
    status: String(
      summary.plannerStatus ||
      lead.status ||
      "Profile available"
    ),
    hasPlanner: Boolean(lead.taxSavingsPlanner),
    hasExecutiveReport: Boolean(
      lead.taxSavingsPlanner?.executiveReport
    ),
    plannerSyncedAt: String(
      planner.syncedAt || ""
    ),
    recordDate: getClientPortalRecordDate(
      lead,
      planner
    ),
    taxHealthScore: Number(
      summary.taxHealthScore || 0
    ),
    urgentCount: Number(
      summary.urgentCount || 0
    ),
    completedCount: Number(
      summary.completedCount || 0
    ),
    nextAction: String(
      summary.nextAction ||
      "Continue your tax planning profile."
    ).slice(0, 500)
  };
}


function getTaxWatchNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getTaxWatchSnapshot(entry = {}) {
  const lead = entry.lead || {};
  const summary = lead.estimateSummary || {};
  const federal = summary.federal || {};
  const state = summary.state || {};
  const taxData = lead.taxData || {};

  const hasEstimate =
    Boolean(summary.taxYear) ||
    Boolean(summary.combined) ||
    Number.isFinite(Number(federal.net)) ||
    Number.isFinite(Number(state.net));

  if (!hasEstimate) return null;

  const federalNet = getTaxWatchNumber(federal.net);
  const stateNet = getTaxWatchNumber(state.net);
  const combinedNet = federalNet + stateNet;
  const recordedAt = String(
    lead.updatedAt ||
    lead.timestamp ||
    entry.raw?.created_at ||
    ""
  );

  return {
    leadId: String(entry.leadId || lead.leadId || ""),
    taxYear: String(
      summary.taxYear ||
      taxData.taxYear ||
      "Not recorded"
    ),
    recordedAt,
    filingStatus: String(
      summary.filingStatus ||
      taxData.filingStatus ||
      "Not recorded"
    ),
    stateCode: String(
      summary.stateCode ||
      taxData.stateCode ||
      ""
    ),
    federalNet,
    stateNet,
    combinedNet,
    projectedResult:
      combinedNet > 0
        ? "refund"
        : combinedNet < 0
          ? "balance-due"
          : "break-even",
    projectedAmount: Math.abs(combinedNet),
    w2Income: getTaxWatchNumber(taxData.w2Income),
    otherIncome: getTaxWatchNumber(taxData.otherIncome),
    selfEmploymentIncome: getTaxWatchNumber(
      taxData.selfEmploymentIncome
    ),
    businessExpenses: getTaxWatchNumber(
      taxData.businessExpenses
    ),
    selfEmploymentStreams: Array.isArray(taxData.selfEmploymentStreams)
      ? taxData.selfEmploymentStreams.slice(0, 5)
      : [],
    federalWithheld: getTaxWatchNumber(
      taxData.federalWithheld ??
      federal.federalWithheld
    ),
    stateWithheld: getTaxWatchNumber(
      taxData.stateWithheld ??
      state.stateWithheld
    ),
    estimatedTaxPayments: getTaxWatchNumber(
      taxData.estimatedTaxPayments ??
      federal.estimatedTaxPayments
    ),
    dependents: getTaxWatchNumber(
      taxData.numberOfDependents
    )
  };
}

function getTaxWatchObjectiveLabel(value) {
  const labels = {
    avoid_owing: "Avoid owing at tax time",
    target_refund: "Target a specific refund",
    increase_take_home: "Increase take-home pay",
    self_employment: "Prepare for self-employment taxes",
    quarterly_payments: "Save for quarterly payments",
    track_changes: "Track changes throughout the year"
  };

  return labels[String(value || "")] || labels.track_changes;
}

function getTaxWatchResultText(snapshot = {}) {
  const amount = Math.round(
    Math.abs(getTaxWatchNumber(snapshot.combinedNet))
  ).toLocaleString("en-US");

  if (snapshot.combinedNet > 0) {
    return `Projected refund: $${amount}`;
  }

  if (snapshot.combinedNet < 0) {
    return `Projected balance due: $${amount}`;
  }

  return "Projected result: Near break-even";
}

function getTaxWatchChangeDetails(previous, current) {
  if (!current) return [];

  if (!previous) {
    return [
      "Your first saved estimate is now the starting point for future comparisons."
    ];
  }

  const details = [];
  const addMoneyChange = (label, before, after) => {
    const difference = getTaxWatchNumber(after) - getTaxWatchNumber(before);
    if (Math.abs(difference) < 1) return;

    details.push(
      `${label} ${difference > 0 ? "increased" : "decreased"} by $${Math.abs(Math.round(difference)).toLocaleString("en-US")}.`
    );
  };

  addMoneyChange(
    "W-2 income",
    previous.w2Income,
    current.w2Income
  );
  addMoneyChange(
    "Other income",
    previous.otherIncome,
    current.otherIncome
  );
  addMoneyChange(
    "Gig or self-employment income",
    previous.selfEmploymentIncome,
    current.selfEmploymentIncome
  );
  addMoneyChange(
    "Business expenses",
    previous.businessExpenses,
    current.businessExpenses
  );
  addMoneyChange(
    "Federal withholding",
    previous.federalWithheld,
    current.federalWithheld
  );
  addMoneyChange(
    "State withholding",
    previous.stateWithheld,
    current.stateWithheld
  );
  addMoneyChange(
    "Estimated tax payments",
    previous.estimatedTaxPayments,
    current.estimatedTaxPayments
  );

  const dependentDifference =
    getTaxWatchNumber(current.dependents) -
    getTaxWatchNumber(previous.dependents);

  if (dependentDifference) {
    details.push(
      `The number of dependents ${dependentDifference > 0 ? "increased" : "decreased"} by ${Math.abs(dependentDifference)}.`
    );
  }

  const resultDifference =
    getTaxWatchNumber(current.combinedNet) -
    getTaxWatchNumber(previous.combinedNet);

  if (Math.abs(resultDifference) >= 1) {
    const direction = resultDifference > 0
      ? "improved"
      : "moved toward a larger balance due";

    details.unshift(
      `Your combined estimate ${direction} by $${Math.abs(Math.round(resultDifference)).toLocaleString("en-US")} since the previous update.`
    );
  }

  return details.length
    ? details
    : [
        "The information entered did not create a meaningful change from the previous saved estimate."
      ];
}

const TAX_WATCH_PREVIEW_DAYS = 14;
const TAX_WATCH_PREVIEW_MILLISECONDS =
  TAX_WATCH_PREVIEW_DAYS * 24 * 60 * 60 * 1000;

function getTaxWatchPreviewWindow(profile = {}) {
  const status = String(profile.status || "")
    .trim()
    .toLowerCase();

  const startedAt = String(
    profile.previewStartedAt ||
    profile.activatedAt ||
    ""
  ).trim();

  const startedAtMs = Date.parse(startedAt);
  const explicitEndsAt = String(
    profile.previewEndsAt ||
    ""
  ).trim();
  const explicitEndsAtMs = Date.parse(explicitEndsAt);

  const endsAtMs = Number.isFinite(explicitEndsAtMs)
    ? explicitEndsAtMs
    : Number.isFinite(startedAtMs)
      ? startedAtMs + TAX_WATCH_PREVIEW_MILLISECONDS
      : NaN;

  const endsAt = Number.isFinite(endsAtMs)
    ? new Date(endsAtMs).toISOString()
    : "";

  const isPreview = status === "preview";
  const remainingMs =
    isPreview && Number.isFinite(endsAtMs)
      ? Math.max(0, endsAtMs - Date.now())
      : 0;
  const expired =
    isPreview &&
    Number.isFinite(endsAtMs) &&
    remainingMs <= 0;

  return {
    durationDays: TAX_WATCH_PREVIEW_DAYS,
    startedAt,
    endsAt,
    remainingMs,
    expired,
    canEdit: status === "active" || (isPreview && !expired),
    noAutomaticCharge: true
  };
}

function getTaxWatchRecommendedNextAction(profile = {}, current = null) {
  if (!current) {
    return "Complete the Free Tax Estimator using the same email address as this portal account.";
  }

  const objective = String(
    profile.objective || "track_changes"
  );
  const targetAmount = Math.max(
    0,
    getTaxWatchNumber(profile.targetAmount)
  );

  if (objective === "avoid_owing") {
    return current.combinedNet < 0
      ? "Review your income and withholding, then update the estimator after any paycheck or income change."
      : "Your current estimate is not showing a balance due. Keep tracking income and withholding changes.";
  }

  if (objective === "target_refund") {
    if (!targetAmount) {
      return "Enter the refund amount you want to target, then compare it with your current projection.";
    }

    const difference = current.combinedNet - targetAmount;
    return Math.abs(difference) < 100
      ? "Your current projection is close to your selected refund target. Keep the estimate updated."
      : difference > 0
        ? "Your projected refund is above your target. The future Action Plan can help compare take-home pay and refund choices."
        : "Your projected refund is below your target. Update income and withholding whenever they change.";
  }

  if (objective === "increase_take_home") {
    return current.combinedNet > 1500
      ? "Your projected refund may indicate extra withholding. Keep tracking it before considering any paycheck change."
      : "Keep your estimate updated before changing withholding so you do not create an unexpected balance due.";
  }

  if (
    objective === "self_employment" ||
    objective === "quarterly_payments"
  ) {
    return current.selfEmploymentIncome > 0
      ? "Update gig or business income and expenses regularly so your projected tax position stays current."
      : "Add your gig or business income when it begins so Tax Watch Pro can track the effect.";
  }

  return "Update your estimate after a new job, gig, withholding change, or family change to see what moved and why.";
}

function buildClientPortalTaxWatchSummary(
  accessible = [],
  accountLeadId = ""
) {
  const snapshots = accessible
    .map(getTaxWatchSnapshot)
    .filter(Boolean)
    .sort(
      (left, right) =>
        Date.parse(left.recordedAt || 0) -
        Date.parse(right.recordedAt || 0)
    );

  const deduped = [];
  const seen = new Set();

  snapshots.forEach((snapshot) => {
    if (!snapshot.leadId || seen.has(snapshot.leadId)) return;
    seen.add(snapshot.leadId);
    deduped.push(snapshot);
  });

  const profileEntry =
    accessible.find(
      (entry) =>
        entry.lead?.taxWatchProfile &&
        String(entry.lead.taxWatchProfile.status || "")
          .toLowerCase()
          .match(/preview|active/)
    ) || null;

  const profile =
    profileEntry?.lead?.taxWatchProfile || {};

  const organizerEntry =
    accessible.find(
      (entry) =>
        entry.lead?.taxWatchOrganizer &&
        typeof entry.lead.taxWatchOrganizer === "object" &&
        !Array.isArray(entry.lead.taxWatchOrganizer)
    ) || null;

  const organizerRecord =
    organizerEntry?.lead?.taxWatchOrganizer || {};

  const organizerStatus = String(
    organizerRecord.status || ""
  ).trim();

  const trackerEntry =
    accessible.find(
      (entry) =>
        entry.lead?.taxWatchMoneyTracker &&
        typeof entry.lead.taxWatchMoneyTracker === "object" &&
        !Array.isArray(entry.lead.taxWatchMoneyTracker)
    ) || null;

  const trackerRecord =
    trackerEntry?.lead?.taxWatchMoneyTracker || {};

  const rawTrackerEntries = Array.isArray(
    trackerRecord.entries
  )
    ? trackerRecord.entries
        .map((entry = {}) => ({
          id: String(entry.id || ""),
          amount: Math.max(
            0,
            getTaxWatchNumber(entry.amount)
          ),
          note: String(entry.note || ""),
          recordedAt: String(
            entry.recordedAt || ""
          ),
          estimatedTaxMoneyNeededAtEntry:
            entry.estimatedTaxMoneyNeededAtEntry ===
            undefined
              ? null
              : getTaxWatchNumber(
                  entry.estimatedTaxMoneyNeededAtEntry
                ),
          savedBalanceAfterEntry:
            entry.savedBalanceAfterEntry ===
            undefined
              ? null
              : getTaxWatchNumber(
                  entry.savedBalanceAfterEntry
                ),
          amountStillNeededAfterEntry:
            entry.amountStillNeededAfterEntry ===
            undefined
              ? null
              : getTaxWatchNumber(
                  entry.amountStillNeededAfterEntry
                )
        }))
        .filter((entry) => entry.amount > 0)
        .sort(
          (left, right) =>
            Date.parse(left.recordedAt || 0) -
            Date.parse(right.recordedAt || 0)
        )
    : [];

  const current = deduped[deduped.length - 1] || null;
  const previous = deduped[deduped.length - 2] || null;
  const baseline = profile.baselineSnapshot || deduped[0] || null;
  const isActive = Boolean(profileEntry);
  const previewWindow = getTaxWatchPreviewWindow(profile);
  const membership = getClientPortalMembershipSummary(
    accessible
  );
  const membershipIsActive =
    membership.enrollmentStatus === "Active Membership" &&
    membership.paymentStatus === "Paid / Confirmed";
  const membershipNeedsPayment = [
    "Past Due",
    "Payment Pending",
    "Enrollment Steps Sent",
    "Enrollment Requested"
  ].includes(membership.enrollmentStatus);
  const businessIncome = getTaxWatchNumber(current?.selfEmploymentIncome);
  const organizedExpenses = getTaxWatchNumber(current?.businessExpenses);
  const netBusinessIncome = Math.max(0, businessIncome - organizedExpenses);
  const paymentsAlreadyMade = getTaxWatchNumber(current?.estimatedTaxPayments);
  const generalReserveBeforePayments = Math.round(netBusinessIncome * 0.25);
  const generalTaxReserve = Math.max(0, generalReserveBeforePayments - paymentsAlreadyMade);
  const estimatedAvailableToSpend = Math.max(0, netBusinessIncome - generalTaxReserve);

  let calculatedSavedBalance = 0;
  const trackerEntries = rawTrackerEntries
    .map((entry) => {
      calculatedSavedBalance =
        Math.round(
          (calculatedSavedBalance + entry.amount) * 100
        ) / 100;

      const hasEstimateSnapshot =
        Number.isFinite(
          entry.estimatedTaxMoneyNeededAtEntry
        ) &&
        entry.estimatedTaxMoneyNeededAtEntry >= 0;

      const estimatedAtEntry =
        hasEstimateSnapshot
          ? entry.estimatedTaxMoneyNeededAtEntry
          : generalTaxReserve;

      const savedBalanceAfterEntry =
        Number.isFinite(entry.savedBalanceAfterEntry) &&
        entry.savedBalanceAfterEntry > 0
          ? entry.savedBalanceAfterEntry
          : calculatedSavedBalance;

      const amountStillNeededAfterEntry =
        Number.isFinite(
          entry.amountStillNeededAfterEntry
        ) &&
        entry.amountStillNeededAfterEntry >= 0
          ? entry.amountStillNeededAfterEntry
          : Math.max(
              0,
              estimatedAtEntry -
                savedBalanceAfterEntry
            );

      return {
        id: entry.id,
        amount: entry.amount,
        note: entry.note,
        recordedAt: entry.recordedAt,
        estimatedTaxMoneyNeededAtEntry:
          estimatedAtEntry,
        savedBalanceAfterEntry,
        amountStillNeededAfterEntry,
        estimateSnapshotStored:
          hasEstimateSnapshot
      };
    })
    .sort(
      (left, right) =>
        Date.parse(right.recordedAt || 0) -
        Date.parse(left.recordedAt || 0)
    );

  const reportedSaved =
    Math.round(
      rawTrackerEntries.reduce(
        (sum, entry) => sum + entry.amount,
        0
      ) * 100
    ) / 100;

  const stillNeeded = Math.max(
    0,
    generalTaxReserve - reportedSaved
  );

  const progressPercent =
    generalTaxReserve > 0
      ? Math.min(
          100,
          Math.round(
            (reportedSaved / generalTaxReserve) * 100
          )
        )
      : reportedSaved > 0
        ? 100
        : 0;

  const trackerStatus =
    reportedSaved <= 0
      ? {
          key: "none",
          label: "No savings reported yet",
          message:
            "Add your first savings entry when you report setting money aside for taxes."
        }
      : stillNeeded <= 0
        ? {
            key: "reached",
            label: "Target reached",
            message:
              "Your reported savings meet or exceed the current estimated tax money needed."
          }
        : progressPercent < 25
          ? {
              key: "behind",
              label: "Behind target",
              message:
                "Your reported savings cover less than 25% of the current estimate. Keep building the balance."
            }
          : {
              key: "progress",
              label: "Making progress",
              message:
                "Your reported savings are building toward the current estimated tax money needed."
            };

  return {
    available: Boolean(current),
    active: isActive || membershipIsActive,
    canEdit: membershipIsActive
      ? true
      : isActive
        ? previewWindow.canEdit
        : false,
    status: membershipIsActive
      ? "active-membership"
      : membership.enrollmentStatus === "Past Due"
        ? "past-due"
        : membership.enrollmentStatus === "Cancelled"
          ? "cancelled"
          : membership.enrollmentStatus === "Expired"
            ? "expired"
            : isActive
              ? String(profile.status || "preview")
              : "not-started",
    planName:
      membership.planName || "Tax Watch Pro",
    serviceName: "Tax Money Tracker",
    serviceSubtitle: "Year-Round Income, Expense, and Tax Tracking",
    accessLabel: membershipIsActive
      ? `${membership.planName} membership active`
      : membershipNeedsPayment
        ? `${membership.enrollmentStatus} — payment not confirmed`
        : isActive
          ? previewWindow.expired
            ? "Preview ended — no charge occurred"
            : "Preview active — no charge during preview"
          : "Not started",
    membership,
    checkout: getMembershipCheckoutAvailability(),
    preview: isActive
      ? previewWindow
      : {
          durationDays: TAX_WATCH_PREVIEW_DAYS,
          startedAt: "",
          endsAt: "",
          remainingMs: 0,
          expired: false,
          canEdit: false,
          noAutomaticCharge: true
        },
    profileLeadId: String(
      profileEntry?.leadId ||
      accountLeadId ||
      current?.leadId ||
      ""
    ),
    objective: String(
      profile.objective || "track_changes"
    ),
    objectiveLabel: getTaxWatchObjectiveLabel(
      profile.objective
    ),
    targetAmount: Math.max(
      0,
      getTaxWatchNumber(profile.targetAmount)
    ),
    activatedAt: String(profile.activatedAt || ""),
    updatedAt: String(profile.updatedAt || ""),
    baseline,
    previous,
    current,
    currentResult: current
      ? getTaxWatchResultText(current)
      : "No saved estimate yet",
    businessCashSnapshot: {
      incomeReceived: businessIncome,
      organizedExpenses,
      netBusinessIncome,
      generalTaxReserve,
      estimatedAvailableToSpend,
      reserveRate: 25,
      estimatedPaymentsAlreadyMade: paymentsAlreadyMade,
      disclaimer: "This is a general planning reserve, not a final self-employment tax calculation or tax return."
    },
    moneyTracker: {
      estimatedTaxMoneyNeeded: generalTaxReserve,
      moneyReportedSaved: reportedSaved,
      amountStillNeeded: stillNeeded,
      progressPercent,
      statusKey: trackerStatus.key,
      statusLabel: trackerStatus.label,
      statusMessage: trackerStatus.message,
      latestEntryAt:
        trackerEntries[0]?.recordedAt || "",
      entries: trackerEntries,
      disclaimer:
        "Savings entries are entered by the client and do not verify an actual bank deposit."
    },
    changes: getTaxWatchChangeDetails(previous, current),
    recommendedNextAction:
      getTaxWatchRecommendedNextAction(profile, current),
    organizer: {
      exists: Boolean(organizerEntry || current),
      status:
        organizerStatus ||
        (current ? "ready" : "not-created"),
      statusLabel:
        organizerStatus === "sent-for-professional-preparation"
          ? "Sent to Greatest Business Solution LLC"
          : organizerStatus === "shared-with-tax-professional"
            ? organizerRecord.sharedWithName
              ? `Shared with ${organizerRecord.sharedWithName}`
              : "Shared with My Tax Professional"
            : current
              ? "Ready"
              : "Not created",
      createdAt: String(
        organizerRecord.createdAt ||
        organizerRecord.updatedAt ||
        current?.recordedAt ||
        ""
      ),
      sentAt: String(organizerRecord.sentAt || ""),
      sharedAt: String(organizerRecord.sharedAt || ""),
      sharedWithName: String(
        organizerRecord.sharedWithName || ""
      ),
      sharedWithEmail: String(
        organizerRecord.sharedWithEmail || ""
      )
    },
    history: [...deduped].reverse().slice(0, 12)
  };
}

function getClientPortalRecordSortTime(record = {}) {
  const value =
    record.plannerSyncedAt ||
    record.recordDate ||
    "";

  const parsed = Date.parse(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function getClientPortalPrimaryRecord(records = []) {
  return [...records].sort((left, right) => {
    const plannerDifference =
      Number(Boolean(right.hasPlanner)) -
      Number(Boolean(left.hasPlanner));

    if (plannerDifference) {
      return plannerDifference;
    }

    const reportDifference =
      Number(Boolean(right.hasExecutiveReport)) -
      Number(Boolean(left.hasExecutiveReport));

    if (reportDifference) {
      return reportDifference;
    }

    return (
      getClientPortalRecordSortTime(right) -
      getClientPortalRecordSortTime(left)
    );
  })[0] || null;
}

function buildClientPortalRecordGroups(records = []) {
  const generalRequests = [];
  const taxYearRecords = [];

  records.forEach((record) => {
    if (
      normalizeClientPortalServiceLabel(
        record.service
      ) === "General Question"
    ) {
      generalRequests.push(record);
      return;
    }

    taxYearRecords.push(record);
  });

  const byTaxYear = new Map();

  taxYearRecords.forEach((record) => {
    const year = String(
      record.taxYear || "Not recorded"
    );

    if (!byTaxYear.has(year)) {
      byTaxYear.set(year, []);
    }

    byTaxYear.get(year).push(record);
  });

  const groups = Array.from(
    byTaxYear.entries()
  ).map(([taxYear, yearRecords]) => {
    const primary =
      getClientPortalPrimaryRecord(
        yearRecords
      ) || {};

    const services = Array.from(
      new Set(
        yearRecords.map((record) =>
          normalizeClientPortalServiceLabel(
            record.service
          )
        )
      )
    ).sort();

    const serviceHistory = services.map(
      (service) => {
        const matching = yearRecords
          .filter(
            (record) =>
              normalizeClientPortalServiceLabel(
                record.service
              ) === service
          )
          .sort(
            (left, right) =>
              getClientPortalRecordSortTime(right) -
              getClientPortalRecordSortTime(left)
          );

        return {
          service,
          requestCount: matching.length,
          latestAt:
            matching[0]?.recordDate ||
            matching[0]?.plannerSyncedAt ||
            ""
        };
      }
    );

    return {
      taxYear,
      leadId: primary.leadId || "",
      service:
        primary.service ||
        services[0] ||
        "Tax Planning Profile",
      services,
      serviceHistory,
      requestCount: yearRecords.length,
      status:
        primary.status ||
        "Profile available",
      hasPlanner: Boolean(
        primary.hasPlanner
      ),
      hasExecutiveReport: Boolean(
        primary.hasExecutiveReport
      ),
      plannerSyncedAt:
        primary.plannerSyncedAt || "",
      recordDate:
        primary.recordDate || "",
      taxHealthScore: Number(
        primary.taxHealthScore || 0
      ),
      urgentCount: Number(
        primary.urgentCount || 0
      ),
      completedCount: Number(
        primary.completedCount || 0
      ),
      nextAction:
        primary.nextAction ||
        "Continue your tax planning profile."
    };
  });

  groups.sort((left, right) => {
    const leftYear = Number(left.taxYear);
    const rightYear = Number(right.taxYear);

    if (
      Number.isFinite(leftYear) &&
      Number.isFinite(rightYear)
    ) {
      return rightYear - leftYear;
    }

    if (Number.isFinite(rightYear)) {
      return 1;
    }

    if (Number.isFinite(leftYear)) {
      return -1;
    }

    return String(left.taxYear).localeCompare(
      String(right.taxYear)
    );
  });

  const numericGroups = groups.filter(
    (group) =>
      Number.isFinite(Number(group.taxYear))
  );

  const unassignedGroups = groups.filter(
    (group) =>
      !Number.isFinite(Number(group.taxYear))
  );

  const visibleRecordGroups = [
    ...numericGroups.slice(0, 4),
    ...unassignedGroups
  ];

  const olderRecordGroups =
    numericGroups.slice(4);

  const serviceHistoryRecords = records.filter(
    (record) =>
      normalizeClientPortalServiceLabel(
        record.service
      ) !== "General Question"
  );

  const serviceHistory = Array.from(
    new Map(
      serviceHistoryRecords.map((record) => {
        const service =
          normalizeClientPortalServiceLabel(
            record.service
          );

        return [
          service,
          {
            service,
            count: serviceHistoryRecords.filter(
              (candidate) =>
                normalizeClientPortalServiceLabel(
                  candidate.service
                ) === service
            ).length,
            latestAt: serviceHistoryRecords
              .filter(
                (candidate) =>
                  normalizeClientPortalServiceLabel(
                    candidate.service
                  ) === service
              )
              .sort(
                (left, right) =>
                  getClientPortalRecordSortTime(right) -
                  getClientPortalRecordSortTime(left)
              )[0]?.recordDate || ""
          }
        ];
      })
    ).values()
  ).sort(
    (left, right) =>
      getClientPortalRecordSortTime({
        recordDate: right.latestAt
      }) -
      getClientPortalRecordSortTime({
        recordDate: left.latestAt
      })
  );

  return {
    visibleRecordGroups,
    olderRecordGroups,
    serviceHistory,
    generalRequestCount:
      generalRequests.length,
    totalTaxYearGroups:
      groups.length,
    totalRawRecords:
      records.length,
    visibleYearLimit: 4
  };
}


function decodeClientDocumentHeader(
  value,
  maxLength = 500
) {
  const raw = String(
    value || ""
  ).slice(0, maxLength * 3);

  try {
    return decodeURIComponent(raw)
      .slice(0, maxLength);
  } catch {
    return raw.slice(
      0,
      maxLength
    );
  }
}

function getClientUploadDocumentCategories() {
  return CLIENT_DOCUMENT_CATEGORIES.filter(
    (category) =>
      category.officeOnly !== true
  );
}

function getPhoenixDateOnly(value) {
  const parsed = new Date(
    value || Date.now()
  );

  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "America/Phoenix",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(parsed);

  const values =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value
        ]
      )
    );

  return `${values.year}-${values.month}-${values.day}`;
}

function getClientDocumentTaxYearOptions() {
  const currentYear =
    new Date().getFullYear();

  const years = [];

  for (
    let year = currentYear;
    year >= currentYear - 20;
    year -= 1
  ) {
    years.push({
      value: String(year),
      label: `Tax Year ${year}`
    });
  }

  years.push(
    {
      value: "multiple",
      label: "Multiple Tax Years"
    },
    {
      value: "not-sure",
      label: "Not Sure Which Tax Year"
    }
  );

  return years;
}

async function getClientPortalDocumentCenterState(
  session
) {
  const available =
    clientDocumentStore.isAvailable();

  const localTesting =
    clientDocumentStore.mode ===
    "local-development";

  if (!available) {
    return {
      version: "1.1.0",
      enabled: false,
      status:
        "Secure document storage is not configured yet.",
      storageMode:
        clientDocumentStore.mode,
      liveStorageReady: false,
      localTesting: false,
      maxFileBytes:
        CLIENT_DOCUMENT_MAX_BYTES,
      maxFileMegabytes: 15,
      categories:
        getClientUploadDocumentCategories(),
      taxYears:
        getClientDocumentTaxYearOptions(),
      allowedFileTypes: [
        "PDF",
        "JPG / JPEG",
        "PNG",
        "HEIC / HEIF"
      ],
      documents: [],
      summary:
        clientDocumentStore.buildSummary(
          []
        )
    };
  }

  let records = [];
  let loadError = "";

  try {
    records =
      await clientDocumentStore.listForPortal({
        portalId:
          session.portal.portalId,
        email:
          session.email
      });
  } catch (error) {
    loadError =
      error?.message ||
      String(error);

    console.warn(
      "[client document center] Document list unavailable:",
      loadError
    );
  }

  return {
    version: "1.1.0",
    enabled: !loadError,
    status: loadError
      ? "Your secure document list could not be loaded."
      : localTesting
        ? "Local testing storage is active. Do not upload real client documents until private cloud storage is configured and validated."
        : "Private client document storage is active.",
    storageMode:
      clientDocumentStore.mode,
    liveStorageReady:
      clientDocumentStore.isLiveReady(),
    localTesting,
    maxFileBytes:
      CLIENT_DOCUMENT_MAX_BYTES,
    maxFileMegabytes: 15,
    categories:
      getClientUploadDocumentCategories(),
    taxYears:
      getClientDocumentTaxYearOptions(),
    allowedFileTypes: [
      "PDF",
      "JPG / JPEG",
      "PNG",
      "HEIC / HEIF"
    ],
    documents:
      records.map(
        publicDocumentRecord
      ),
    summary:
      clientDocumentStore.buildSummary(
        records
      )
  };
}

async function findClientDocumentLinkedLeadId(
  email,
  taxYear,
  accountLeadId
) {
  const normalizedYear =
    normalizeClientDocumentTaxYear(
      taxYear
    );

  if (
    !normalizedYear ||
    normalizedYear === "multiple" ||
    normalizedYear === "not-sure"
  ) {
    return String(
      accountLeadId || ""
    );
  }

  const accessible =
    await getClientPortalAccessibleLeads(
      email
    );

  const matching =
    accessible.find(
      (entry) =>
        getClientPortalTaxYear(
          entry.lead || {},
          entry.lead?.taxSavingsPlanner || {}
        ) === normalizedYear
    );

  return String(
    matching?.leadId ||
    accountLeadId ||
    ""
  );
}

function getClientDocumentSummaryLeadId(record = {}) {
  return String(
    record.linkedLeadId ||
    record.accountLeadId ||
    ""
  ).trim();
}

function clientDocumentBelongsToLead(
  record = {},
  leadId = ""
) {
  const cleanLeadId = String(
    leadId || ""
  ).trim();

  if (!cleanLeadId) {
    return false;
  }

  return getClientDocumentSummaryLeadId(
    record
  ) === cleanLeadId;
}

async function syncClientDocumentSummaryToLinkedLead(
  record,
  records = []
) {
  const linkedLeadId =
    getClientDocumentSummaryLeadId(
      record
    );

  if (!linkedLeadId) {
    return;
  }

  const linkedRecords = Array.isArray(
    records
  )
    ? records.filter((entry) =>
        clientDocumentBelongsToLead(
          entry,
          linkedLeadId
        )
      )
    : [];

  const summary =
    clientDocumentStore.buildSummary(
      linkedRecords
    );

  await updateClientPortalLeadStatus(
    linkedLeadId,
    (current = {}) => ({
      ...current,
      documentCenter: {
        version: 3,
        status: "active",
        totalDocuments: Number(
          summary.totalDocuments || 0
        ),
        awaitingReview: Number(
          summary.awaitingReview || 0
        ),
        inReview: Number(
          summary.inReview || 0
        ),
        accepted: Number(
          summary.accepted || 0
        ),
        needsReplacement: Number(
          summary.needsReplacement || 0
        ),
        latestUploadAt: String(
          summary.latestUploadAt || ""
        ),
        latestFileName: String(
          summary.latestFileName || ""
        )
      }
    }),
    {
      awaitPrimary: true
    }
  );
}

async function sendClientDocumentUploadReceipt({
  to,
  clientName,
  document
}) {
  const email = normalizeEmail(to);

  if (
    !email ||
    !EMAIL_USER ||
    !EMAIL_APP_PASSWORD ||
    !document
  ) {
    return;
  }

  const portalUrl =
    String(APP_BASE_URL || "")
      .replace(/\/+$/, "") +
    "/client-portal";

  try {
    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject:
        "Secure document upload received",
      text:
`Hello ${clientName || "Client"},

We received your secure portal upload.

Document:
${document.originalName}

Tax year:
${document.taxYearLabel}

Category:
${document.categoryLabel}

Status:
Received — Awaiting Office Review

You can view your upload history in the Secure Document Center:
${portalUrl}

For your protection, do not email Social Security numbers, tax documents, passwords, or security codes.

Thank you,
Greatest Business Solution LLC`
    });
  } catch (error) {
    console.warn(
      "[client document center] Upload receipt email could not be sent:",
      error?.message || error
    );
  }
}



async function sendClientDocumentReviewEmail({
  document,
  clientName
}) {
  if (
    !document ||
    !EMAIL_USER ||
    !EMAIL_APP_PASSWORD
  ) {
    return;
  }

  const email = normalizeEmail(
    document.email
  );

  if (!email) {
    return;
  }

  const status = String(
    document.reviewStatus || ""
  );

  if (
    status !== "accepted" &&
    status !== "needs-replacement"
  ) {
    return;
  }

  const portalUrl =
    String(APP_BASE_URL || "")
      .replace(/\/+$/, "") +
    "/client-portal";

  const accepted =
    status === "accepted";

  const subject = accepted
    ? "Secure document accepted"
    : "Replacement document requested";

  const headline = accepted
    ? "Your document was accepted."
    : "A replacement document is needed.";

  const clientMessage =
    cleanClientDocumentText(
      document.clientMessage,
      1200
    );

  const categoryLabel =
    getClientDocumentCategoryLabel(
      document.category
    ) ||
    cleanClientDocumentText(
      document.categoryLabel,
      120
    ) ||
    "Other Supporting Records";

  try {
    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject,
      text:
`Hello ${clientName || "Client"},

${headline}

Document:
${document.originalName}

Tax year:
${document.taxYear}

Category:
${categoryLabel}

Status:
${accepted ? "Accepted" : "Replacement Requested"}

${clientMessage ? `Message from Greatest Business Solution LLC:
${clientMessage}

` : ""}View your Secure Document Center:
${portalUrl}

For your protection, do not email Social Security numbers, tax documents, passwords, or security codes.

Thank you,
Greatest Business Solution LLC`
    });
  } catch (error) {
    console.warn(
      "[office document review] Client status email could not be sent:",
      error?.message || error
    );
  }
}

function getTranscriptAuthorizationInternalStatus(
  transcriptRequest = {}
) {
  const payment =
    String(
      transcriptRequest.paymentStatus || ""
    ).toLowerCase();

  if (
    !payment.includes("paid") &&
    !payment.includes("verified")
  ) {
    return "Waiting on payment";
  }

  const authorizationStatus =
    String(
      transcriptRequest.authorizationStatus || ""
    ).toLowerCase();

  const authorizationReceived =
    authorizationStatus.includes("received") ||
    authorizationStatus.includes("signed") ||
    Boolean(
      transcriptRequest.authorizationReceivedDate
    );

  if (!authorizationReceived) {
    return "Waiting on 8821";
  }

  const identityVerified =
    String(
      transcriptRequest.identityVerified || ""
    ).toLowerCase() === "yes";

  if (!identityVerified) {
    return "Waiting on identity";
  }

  const transcriptType =
    String(
      transcriptRequest.transcriptType || ""
    ).toLowerCase();

  const years =
    String(
      transcriptRequest.yearsNeeded ||
      transcriptRequest.taxYears ||
      ""
    ).trim();

  const typeReady =
    transcriptType &&
    !transcriptType.includes("need") &&
    !transcriptType.includes("not sure");

  return (
    typeReady &&
    years
  )
    ? "Ready to pull"
    : "Open";
}

async function syncSigned8821DocumentToTranscriptRequest({
  document,
  reviewStatus,
  clientMessage,
  reviewedAt
}) {
  if (
    !document ||
    document.category !== "signed-8821" ||
    ![
      "accepted",
      "needs-replacement"
    ].includes(reviewStatus)
  ) {
    return {
      ok: true,
      skipped: true
    };
  }

  const linkedLeadId =
    String(
      document.linkedLeadId ||
      document.accountLeadId ||
      ""
    ).trim();

  if (!linkedLeadId) {
    return {
      ok: false,
      error:
        "The signed Form 8821 is not linked to a transcript request."
    };
  }

  const reviewedDate =
    new Date(
      reviewedAt ||
      Date.now()
    );

  const phoenixDateParts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "America/Phoenix",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(reviewedDate);

  const phoenixDateValues =
    Object.fromEntries(
      phoenixDateParts.map(
        (part) => [
          part.type,
          part.value
        ]
      )
    );

  const dateOnly =
    `${phoenixDateValues.year}-${phoenixDateValues.month}-${phoenixDateValues.day}`;

  return updateLeadAfterStripePayment(
    linkedLeadId,
    (record = {}) => {
      const updated = {
        ...record
      };

      const existing =
        updated.transcriptRequest ||
        updated.Request ||
        {};

      const completed =
        String(updated.status || "")
          .toLowerCase() ===
          "transcript help - completed" ||
        String(
          existing.internalStatus || ""
        ).toLowerCase() === "completed";

      const accepted =
        reviewStatus === "accepted";

      const nextTranscriptRequest = {
        ...existing,
        requested: true,
        authorizationStatus:
          accepted
            ? "8821 Signed / Received"
            : "Need 8821",
        authorizationReceivedDate:
          accepted
            ? (
                existing.authorizationReceivedDate ||
                dateOnly
              )
            : "",
        authorizationFileLocation:
          accepted
            ? `Secure Client Portal Document: ${document.originalName} (${document.documentId})`
            : "",
        authorizationDocumentId:
          accepted
            ? document.documentId
            : "",
        authorizationPortalReviewStatus:
          reviewStatus,
        authorizationPortalMessage:
          String(
            clientMessage ||
            (
              accepted
                ? "Your signed Form 8821 was accepted by the office."
                : "A corrected signed Form 8821 is required."
            )
          ).slice(0, 1200),
        authorizationReviewedAt:
          String(reviewedAt || ""),
        signingMethod:
          accepted
            ? (
                existing.signingMethod &&
                existing.signingMethod !==
                  "Not selected"
                  ? existing.signingMethod
                  : "Secure portal upload"
              )
            : existing.signingMethod || "",
        internalStatus:
          completed
            ? "Completed"
            : accepted
              ? getTranscriptAuthorizationInternalStatus({
                  ...existing,
                  authorizationStatus:
                    "8821 Signed / Received",
                  authorizationReceivedDate:
                    existing.authorizationReceivedDate ||
                    dateOnly
                })
              : (
                  String(
                    existing.paymentStatus || ""
                  ).toLowerCase().includes("paid")
                    ? "Waiting on 8821"
                    : "Waiting on payment"
                ),
        lastSavedAt:
          String(reviewedAt || "")
      };

      updated.transcriptRequest =
        nextTranscriptRequest;

      updated.Request = {
        ...(updated.Request || {}),
        ...nextTranscriptRequest
      };

      if (!completed) {
        updated.status =
          String(
            nextTranscriptRequest.paymentStatus ||
            ""
          ).toLowerCase().includes("paid")
            ? "Transcript Help - Paid / Needs Review"
            : "Transcript Help - Payment Pending";
      }

      updated.updatedAt =
        String(reviewedAt || "");

      const note =
        accepted
          ? `[${new Date(reviewedAt).toLocaleString()}] Signed Form 8821 accepted from Secure Client Portal document ${document.originalName}.`
          : `[${new Date(reviewedAt).toLocaleString()}] Replacement signed Form 8821 requested for Secure Client Portal document ${document.originalName}.`;

      const oldNotes =
        typeof updated.notes === "string"
          ? updated.notes.trim()
          : "";

      updated.notes =
        oldNotes
          ? `${oldNotes}\n${note}`
          : note;

      return updated;
    }
  );
}

async function syncIdentityVerificationDocumentToTranscriptRequest({
  document,
  reviewStatus,
  clientMessage,
  reviewedAt
}) {
  if (
    !document ||
    document.category !== "identity-verification" ||
    ![
      "accepted",
      "needs-replacement"
    ].includes(reviewStatus)
  ) {
    return {
      ok: true,
      skipped: true
    };
  }

  const linkedLeadId =
    String(
      document.linkedLeadId ||
      document.accountLeadId ||
      ""
    ).trim();

  if (!linkedLeadId) {
    return {
      ok: false,
      error:
        "The identity verification document is not linked to a transcript request."
    };
  }

  const reviewedDate =
    new Date(
      reviewedAt ||
      Date.now()
    );

  const phoenixDateParts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "America/Phoenix",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(reviewedDate);

  const phoenixDateValues =
    Object.fromEntries(
      phoenixDateParts.map(
        (part) => [
          part.type,
          part.value
        ]
      )
    );

  const dateOnly =
    `${phoenixDateValues.year}-${phoenixDateValues.month}-${phoenixDateValues.day}`;

  return updateLeadAfterStripePayment(
    linkedLeadId,
    (record = {}) => {
      const updated = {
        ...record
      };

      const existing =
        updated.transcriptRequest ||
        updated.Request ||
        {};

      const completed =
        String(updated.status || "")
          .toLowerCase() ===
          "transcript help - completed" ||
        String(
          existing.internalStatus || ""
        ).toLowerCase() === "completed";

      const accepted =
        reviewStatus === "accepted";

      const nextTranscriptRequest = {
        ...existing,
        requested: true,
        identityVerified:
          accepted
            ? "Yes"
            : "No",
        identityVerifiedDate:
          accepted
            ? (
                dateOnly
              )
            : "",
        identityVerificationFileLocation:
          accepted
            ? `Secure Client Portal Document: ${document.originalName} (${document.documentId})`
            : "",
        identityVerificationDocumentId:
          accepted
            ? document.documentId
            : "",
        identityPortalReviewStatus:
          reviewStatus,
        identityPortalMessage:
          String(
            clientMessage ||
            (
              accepted
                ? "Your identity verification document was accepted by the office."
                : "A replacement identity verification document is required."
            )
          ).slice(0, 1200),
        identityReviewedAt:
          String(reviewedAt || ""),
        internalStatus:
          completed
            ? "Completed"
            : getTranscriptAuthorizationInternalStatus({
                ...existing,
                identityVerified:
                  accepted
                    ? "Yes"
                    : "No",
                identityVerifiedDate:
                  accepted
                    ? (
                        dateOnly
                      )
                    : ""
              }),
        lastSavedAt:
          String(reviewedAt || "")
      };

      updated.transcriptRequest =
        nextTranscriptRequest;

      updated.Request = {
        ...(updated.Request || {}),
        ...nextTranscriptRequest
      };

      if (!completed) {
        updated.status =
          String(
            nextTranscriptRequest.paymentStatus ||
            ""
          ).toLowerCase().includes("paid")
            ? "Transcript Help - Paid / Needs Review"
            : "Transcript Help - Payment Pending";
      }

      updated.updatedAt =
        String(reviewedAt || "");

      const note =
        accepted
          ? `[${new Date(reviewedAt).toLocaleString()}] Identity verification document accepted from Secure Client Portal document ${document.originalName}.`
          : `[${new Date(reviewedAt).toLocaleString()}] Replacement identity verification document requested for Secure Client Portal document ${document.originalName}.`;

      const oldNotes =
        typeof updated.notes === "string"
          ? updated.notes.trim()
          : "";

      updated.notes =
        oldNotes
          ? `${oldNotes}\n${note}`
          : note;

      return updated;
    }
  );
}


function getTranscriptRequestRecord(
  lead = {}
) {
  return (
    lead.transcriptRequest ||
    lead.Request ||
    {}
  );
}

function getSecureTranscriptDeliveryMissingItems(
  lead = {},
  transcriptRequest = {}
) {
  const missing = [];

  const payment = String(
    transcriptRequest.paymentStatus || ""
  ).toLowerCase();

  if (
    !payment.includes("paid") &&
    !payment.includes("verified")
  ) {
    missing.push("Verify payment");
  }

  const authorization = String(
    transcriptRequest.authorizationStatus || ""
  ).toLowerCase();

  if (
    !authorization.includes("signed") &&
    !authorization.includes("received") &&
    !transcriptRequest.authorizationReceivedDate
  ) {
    missing.push("Receive signed Form 8821");
  }

  if (
    String(
      transcriptRequest.identityVerified || ""
    ).toLowerCase() !== "yes" ||
    !transcriptRequest.identityVerifiedDate
  ) {
    missing.push("Complete identity verification");
  }

  const transcriptType = String(
    transcriptRequest.transcriptType || ""
  ).trim();

  if (
    !transcriptType ||
    /need|not sure/i.test(transcriptType)
  ) {
    missing.push("Select transcript type");
  }

  const taxYears = String(
    transcriptRequest.yearsNeeded ||
    transcriptRequest.taxYears ||
    ""
  ).trim();

  if (!taxYears || /need/i.test(taxYears)) {
    missing.push("Enter tax year(s)");
  }

  if (!transcriptRequest.transcriptPulledDate) {
    missing.push("Record PitBullTax pull date");
  }

  return missing;
}

async function getSecureTranscriptDeliveryTarget(
  leadId
) {
  const cleanLeadId = String(
    leadId || ""
  ).trim();

  if (!cleanLeadId) {
    return {
      ok: false,
      status: 400,
      error:
        "A transcript request reference is required."
    };
  }

  const candidate =
    await findClientPortalLeadById(
      cleanLeadId
    );

  if (!candidate) {
    return {
      ok: false,
      status: 404,
      error:
        "The transcript request could not be found."
    };
  }

  const lead = candidate.lead || {};
  const transcriptRequest =
    getTranscriptRequestRecord(lead);

  const isTranscriptRequest =
    Boolean(transcriptRequest.requested) ||
    String(lead.status || "")
      .toLowerCase()
      .includes("transcript help");

  if (!isTranscriptRequest) {
    return {
      ok: false,
      status: 409,
      error:
        "The selected client record is not an IRS Transcript Help request."
    };
  }

  const email = getLeadEmailValue(
    candidate.raw
  );

  const portal = email
    ? await findActiveClientPortalAccountByEmail(
        email
      )
    : null;

  const missing =
    getSecureTranscriptDeliveryMissingItems(
      lead,
      transcriptRequest
    );

  if (!email) {
    missing.unshift(
      "Add the client email address"
    );
  }

  if (!portal?.portalId) {
    missing.push(
      "Activate the client's secure portal account"
    );
  }

  return {
    ok: true,
    leadId: cleanLeadId,
    lead,
    candidate,
    transcriptRequest,
    email,
    portal,
    missing,
    ready:
      missing.length === 0,
    clientName:
      getLeadNameValue(
        candidate.raw
      ) || "Client",
    taxYears:
      String(
        transcriptRequest.yearsNeeded ||
        transcriptRequest.taxYears ||
        ""
      ),
    transcriptType:
      String(
        transcriptRequest.transcriptType ||
        ""
      )
  };
}

async function syncSecureTranscriptDeliveryToTranscriptRequest({
  document,
  deliveredAt,
  clientMessage
}) {
  if (
    !document ||
    document.category !==
      "irs-transcript-delivery"
  ) {
    return {
      ok: true,
      skipped: true
    };
  }

  const linkedLeadId = String(
    document.linkedLeadId ||
    document.accountLeadId ||
    ""
  ).trim();

  if (!linkedLeadId) {
    return {
      ok: false,
      error:
        "The secure transcript is not linked to a transcript request."
    };
  }

  const dateOnly =
    getPhoenixDateOnly(
      deliveredAt
    );

  return updateLeadAfterStripePayment(
    linkedLeadId,
    (record = {}) => {
      const updated = {
        ...record
      };

      const existing =
        getTranscriptRequestRecord(
          updated
        );

      const completed =
        String(updated.status || "")
          .toLowerCase() ===
          "transcript help - completed" ||
        String(
          existing.internalStatus || ""
        ).toLowerCase() === "completed";

      const nextTranscriptRequest = {
        ...existing,
        requested: true,
        transcriptReceivedDate:
          existing.transcriptReceivedDate ||
          dateOnly,
        deliveryMethod:
          "Client portal",
        deliveryDate:
          dateOnly,
        deliveryDocumentId:
          document.documentId,
        deliveryFileLocation:
          `Secure Client Portal Document: ${document.originalName} (${document.documentId})`,
        deliveryPortalStatus:
          "delivered",
        deliveryPortalMessage:
          String(
            clientMessage ||
            "Your IRS transcript is ready for secure download in the client portal."
          ).slice(0, 1200),
        deliveryUploadedAt:
          String(deliveredAt || ""),
        internalStatus:
          completed
            ? "Completed"
            : "Delivered / ready to complete",
        lastSavedAt:
          String(deliveredAt || "")
      };

      updated.transcriptRequest =
        nextTranscriptRequest;

      updated.Request = {
        ...(updated.Request || {}),
        ...nextTranscriptRequest
      };

      if (!completed) {
        updated.status =
          "Transcript Help - Paid / Needs Review";
      }

      updated.updatedAt =
        String(deliveredAt || "");

      const note =
        `[${new Date(deliveredAt).toLocaleString()}] IRS transcript delivered through the Secure Client Portal document ${document.originalName}.`;

      const oldNotes =
        typeof updated.notes === "string"
          ? updated.notes.trim()
          : "";

      updated.notes = oldNotes
        ? `${oldNotes}\n${note}`
        : note;

      return updated;
    }
  );
}

async function sendSecureTranscriptDeliveryEmail({
  to,
  clientName,
  document,
  transcriptRequest
}) {
  const email = normalizeEmail(to);

  if (
    !email ||
    !EMAIL_USER ||
    !EMAIL_APP_PASSWORD ||
    !document
  ) {
    return;
  }

  const portalUrl =
    String(APP_BASE_URL || "")
      .replace(/\/+$/, "") +
    "/client-portal";

  try {
    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject:
        "Your IRS transcript is ready in the secure portal",
      text:
`Hello ${clientName || "Client"},

Your IRS transcript is ready for secure download.

Transcript type:
${transcriptRequest?.transcriptType || "IRS Transcript"}

Tax year(s):
${transcriptRequest?.yearsNeeded || transcriptRequest?.taxYears || document.taxYear}

Secure file:
${document.originalName}

Sign in to your Secure Client Portal to download the transcript:
${portalUrl}

For your protection, the transcript is not attached to this email. Do not email Social Security numbers, identity documents, passwords, security codes, or IRS transcripts.

Thank you,
Greatest Business Solution LLC`
    });
  } catch (error) {
    console.warn(
      "[secure transcript delivery] Client notification email could not be sent:",
      error?.message || error
    );
  }
}

async function getOfficeDocumentReviewState(
  filters = {}
) {
  let records = [];
  let error = "";

  try {
    records =
      await clientDocumentStore.listForOffice(
        filters
      );
  } catch (loadError) {
    error =
      loadError?.message ||
      String(loadError);
  }

  let allRecords = records;

  if (
    filters.status ||
    filters.search ||
    filters.portalId ||
    filters.email
  ) {
    try {
      allRecords =
        await clientDocumentStore
          .listForOffice({});
    } catch {
      allRecords = records;
    }
  }

  const readiness =
    await clientDocumentStore
      .checkLiveReadiness();

  const productionReadiness =
    await getPortalProductionReadiness();

  return {
    version: "1.1.0",
    enabled:
      clientDocumentStore.isAvailable(),
    localTesting:
      clientDocumentStore.mode ===
      "local-development",
    officeAccessMode:
      officeDocumentReviewLocalBypass()
        ? "local-development-bypass"
        : OFFICE_DOCUMENT_REVIEW_KEY
          ? "signed-office-session"
          : "not-configured",
    storageMode:
      clientDocumentStore.mode,
    readiness,
    productionReadiness,
    statuses:
      CLIENT_DOCUMENT_REVIEW_STATUSES,
    documents:
      records.map(
        officeDocumentRecord
      ),
    summary:
      clientDocumentStore.buildSummary(
        allRecords
      ),
    error
  };
}

function safeClientDocumentDownloadName(
  value
) {
  return String(
    value || "document"
  )
    .replace(
      /[\r\n"\\;]/g,
      "-"
    )
    .slice(0, 180) ||
    "document";
}

async function sendClientPortalAccountEmail({
  to,
  clientName,
  leadId,
  subject,
  headline,
  message
}) {
  const email = normalizeEmail(to);

  if (
    !email ||
    !EMAIL_USER ||
    !EMAIL_APP_PASSWORD
  ) {
    return {
      ok: false,
      skipped: true
    };
  }

  const portalUrl =
    String(APP_BASE_URL || "")
      .replace(/\/+$/, "") +
    "/client-portal";

  try {
    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject,
      text:
`Hello ${clientName || "Client"},

${headline}

Username:
${email}

${message}

Secure portal:
${portalUrl}

Client reference number:
${leadId || "Available in your portal invitation"}

For your security, your password is never included in email. Greatest Business Solution LLC cannot view or recover your current password. Use Activate / Reset Access if you forget it.

If you did not make this change, contact Greatest Business Solution LLC promptly.

Thank you,
Greatest Business Solution LLC`
    });

    return {
      ok: true
    };
  } catch (error) {
    console.warn(
      "[client portal] Account email could not be sent:",
      error?.message || error
    );

    return {
      ok: false,
      error:
        error?.message ||
        String(error)
    };
  }
}

async function getAuthenticatedClientPortalSession(req) {
  const token =
    clientPortalSecurity.getSessionTokenFromRequest(req);

  const payload =
    clientPortalSecurity.verifySessionToken(token);

  if (!payload) {
    return null;
  }

  const portal = await clientPortalStore.getByLeadId(
    payload.accountLeadId
  );

  if (!portal) {
    return null;
  }

  const accountLead = await findClientPortalLeadById(
    payload.accountLeadId
  );

  if (!accountLead) {
    return null;
  }

  if (
    String(portal.status || "") !== "active" ||
    String(portal.portalId || "") !==
      String(payload.portalId || "") ||
    Number(portal.sessionVersion || 0) !==
      Number(payload.sessionVersion || 0) ||
    normalizeEmail(portal.email) !==
      normalizeEmail(payload.email)
  ) {
    return null;
  }

  return {
    payload,
    accountLead,
    portal,
    email: normalizeEmail(payload.email)
  };
}

async function requireClientPortalApiSession(
  req,
  res,
  next
) {
  setClientPortalNoStore(res);

  const session =
    await getAuthenticatedClientPortalSession(req);

  if (!session) {
    clearClientPortalSessionCookie(req, res);

    return res.status(401).json({
      ok: false,
      error:
        "Your secure portal session has expired. Please sign in again."
    });
  }

  req.clientPortalSession = session;
  return next();
}

async function requireClientPortalPageSession(
  req,
  res,
  next
) {
  setClientPortalNoStore(res);

  const session =
    await getAuthenticatedClientPortalSession(req);

  if (!session) {
    clearClientPortalSessionCookie(req, res);

    const returnTo = encodeURIComponent(
      req.originalUrl || "/client-portal/home"
    );

    return res.redirect(
      `/client-portal?reason=session&returnTo=${returnTo}`
    );
  }

  req.clientPortalSession = session;
  return next();
}

async function clientPortalSessionCanAccessLead(
  session,
  leadId
) {
  const candidate = await findClientPortalLeadById(leadId);

  if (!candidate) {
    return null;
  }

  const candidateEmail = getLeadEmailValue(
    candidate.raw
  );

  return candidateEmail === session.email
    ? candidate
    : null;
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
  const inviteeNameKey = String(
    appointment.inviteeName || ""
  ).trim().toLowerCase();

  if (!email) {
    return {
      ok: false,
      statusCode: 400,
      error: "Calendly payload did not include an invitee email."
    };
  }

  const getCalendarStatus = () =>
    appointment.status === "Canceled"
      ? "Calendar - Canceled"
      : "Calendar - Scheduled";

  const pickMatchingLead = (rows = [], getEstimate) => {
    const candidates = rows.map((row) => {
      const estimate = getEstimate(row) || {};
      const existingAppointment =
        estimate.calendarAppointment || {};

      return {
        row,
        estimate,
        existingAppointment,
        rowEmail: normalizeEmail(
          estimate.contact?.email ||
          row.email
        ),
        rowName: String(
          estimate.contact?.name ||
          row.name ||
          ""
        ).trim().toLowerCase()
      };
    });

    return (
      candidates.find((candidate) => {
        const existingInviteeUri = String(
          candidate.existingAppointment.inviteeUri || ""
        ).trim();

        const incomingInviteeUri = String(
          appointment.inviteeUri || ""
        ).trim();

        const existingEventUri = String(
          candidate.existingAppointment.eventUri || ""
        ).trim();

        const incomingEventUri = String(
          appointment.eventUri || ""
        ).trim();

        return (
          (
            existingInviteeUri &&
            incomingInviteeUri &&
            existingInviteeUri === incomingInviteeUri
          ) ||
          (
            existingEventUri &&
            incomingEventUri &&
            existingEventUri === incomingEventUri
          )
        );
      }) ||
      candidates.find((candidate) => {
        return (
          candidate.rowEmail === email &&
          inviteeNameKey &&
          candidate.rowName === inviteeNameKey
        );
      }) ||
      candidates.find((candidate) => {
        return candidate.rowEmail === email;
      }) ||
      null
    );
  };

  try {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const matchingCandidate = pickMatchingLead(
      data || [],
      (row) => row.estimate || {}
    );

    const matchingRow = matchingCandidate?.row || null;

    if (matchingRow) {
      const estimate = matchingRow.estimate || {};
      const updatedEstimate = {
        ...estimate,
        status: getCalendarStatus(),
        contact: {
          ...(estimate.contact || {}),
          name:
            appointment.inviteeName ||
            estimate.contact?.name ||
            matchingRow.name ||
            "Calendly Client",
          email:
            appointment.inviteeEmail ||
            estimate.contact?.email ||
            matchingRow.email ||
            ""
        },
        calendarAppointment: {
          ...(estimate.calendarAppointment || {}),
          ...appointment
        },
        updatedAt: new Date().toISOString()
      };

      let updateQuery = supabase
        .from("leads")
        .update({
          name: updatedEstimate.contact.name,
          email: updatedEstimate.contact.email,
          estimate: updatedEstimate
        });

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
        name: updatedEstimate.contact.name,
        email: updatedEstimate.contact.email,
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
      status: getCalendarStatus(),
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
  const matchingCandidate = pickMatchingLead(
    leads,
    (lead) => lead || {}
  );

  const matchingIndex = matchingCandidate
    ? leads.indexOf(matchingCandidate.row)
    : -1;

  if (matchingIndex >= 0) {
    leads[matchingIndex] = {
      ...leads[matchingIndex],
      status: getCalendarStatus(),
      contact: {
        ...(leads[matchingIndex].contact || {}),
        name:
          appointment.inviteeName ||
          leads[matchingIndex].contact?.name ||
          "Calendly Client",
        email:
          appointment.inviteeEmail ||
          leads[matchingIndex].contact?.email ||
          ""
      },
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
    status: getCalendarStatus(),
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
    path.startsWith("/client-portal") ||
    path.startsWith("/office-document-review") ||
    path.startsWith("/transcript-requests") ||
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
Disallow: /client-portal
Disallow: /office-document-review
Disallow: /transcript-requests
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
      lowerFilePath.endsWith("client-portal.html") ||
      lowerFilePath.endsWith("office-document-review-login.html") ||
      lowerFilePath.endsWith("transcript-requests.html") ||
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
    notes,
    taxWatchUpdate
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
    estimateSummary: estimateSummary || {},
    taxWatchUpdate:
      taxWatchUpdate &&
      typeof taxWatchUpdate === "object" &&
      !Array.isArray(taxWatchUpdate)
        ? {
            sourceLeadId: String(taxWatchUpdate.sourceLeadId || "").trim(),
            sourceCount: Math.max(
              0,
              Math.min(2, Number(taxWatchUpdate.sourceCount || 0))
            ),
            updateReason: String(
              taxWatchUpdate.updateReason || "Tax Watch Pro estimate update"
            ).slice(0, 200),
            recordedAt: new Date().toISOString()
          }
        : null
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
// POST /api/calendar-appointment
// Creates a manual appointment without requiring Calendly.
// =============================================================================

app.post("/api/calendar-appointment", async (req, res) => {
  const {
    name,
    email,
    phone,
    service,
    startTime,
    endTime,
    durationMinutes,
    meetingType,
    meetingLink,
    meetingAddress,
    notes,
    allowConflict
  } = req.body || {};

  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanPhone = formatPhoneNumber(phone || "");
  const cleanService = String(service || "").trim();
  const cleanMeetingType = String(meetingType || "Phone Call").trim();
  const cleanMeetingLink = String(meetingLink || "").trim();
  const cleanMeetingAddress = String(meetingAddress || "").trim();
  const cleanNotes = String(notes || "").trim();
  const parsedStart = new Date(startTime);
  const parsedEnd = new Date(endTime);
  const allowedMeetingTypes = [
    "Phone Call",
    "Google Meet",
    "In Person",
    "Other Online Meeting"
  ];

  const errors = [];

  if (!cleanName) {
    errors.push("Client name is required.");
  }

  if (!cleanEmail) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    errors.push("Email address format is invalid.");
  }

  if (!cleanService) {
    errors.push("Service is required.");
  }

  if (!allowedMeetingTypes.includes(cleanMeetingType)) {
    errors.push("Select a valid meeting type.");
  }

  if (!startTime || Number.isNaN(parsedStart.getTime())) {
    errors.push("A valid appointment start date and time is required.");
  }

  if (!endTime || Number.isNaN(parsedEnd.getTime())) {
    errors.push("A valid appointment end date and time is required.");
  }

  if (
    !Number.isNaN(parsedStart.getTime()) &&
    !Number.isNaN(parsedEnd.getTime()) &&
    parsedEnd <= parsedStart
  ) {
    errors.push("Appointment end time must be after the start time.");
  }

  if (cleanMeetingType === "Phone Call") {
    const phoneDigits = String(phone || "").replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      errors.push("A 10-digit U.S. phone number is required for a phone call.");
    }
  }

  if (
    cleanMeetingType === "Google Meet" ||
    cleanMeetingType === "Other Online Meeting"
  ) {
    try {
      const url = new URL(cleanMeetingLink);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Invalid protocol");
      }

      if (
        cleanMeetingType === "Google Meet" &&
        (
          url.protocol !== "https:" ||
          url.hostname.toLowerCase() !== "meet.google.com"
        )
      ) {
        errors.push(
          "Google Meet requires a secure https://meet.google.com/... link."
        );
      }
    } catch {
      errors.push("Enter a valid online meeting link.");
    }
  }

  if (cleanMeetingType === "In Person" && !cleanMeetingAddress) {
    errors.push("Enter the in-person address or location.");
  }

  if (errors.length > 0) {
    return res.status(400).json({
      ok: false,
      errors
    });
  }

  const allCalendarLeads = [];

  try {
    const { data, error } = await supabase
      .from("leads")
      .select("*");

    if (error) throw error;

    (data || []).forEach((row) => {
      const lead = mapRowToLead(row);
      if (lead?.calendarAppointment) {
        allCalendarLeads.push(lead);
      }
    });
  } catch (error) {
    console.error(
      "[/api/calendar-appointment] Conflict check using Supabase failed:",
      error.message || error
    );

    readLeads().forEach((lead) => {
      if (lead?.calendarAppointment) {
        allCalendarLeads.push(lead);
      }
    });
  }

  const conflicts = allCalendarLeads
    .filter((lead) => {
      const appointment = lead.calendarAppointment || {};
      const status = String(
        appointment.status || lead.status || ""
      ).toLowerCase();

      if (
        status.includes("completed") ||
        status.includes("canceled") ||
        status.includes("cancelled") ||
        status.includes("no-show") ||
        status.includes("no show")
      ) {
        return false;
      }

      const existingStart = new Date(appointment.startTime);
      const existingEnd = new Date(appointment.endTime);

      if (
        Number.isNaN(existingStart.getTime()) ||
        Number.isNaN(existingEnd.getTime())
      ) {
        return false;
      }

      return (
        parsedStart < existingEnd &&
        parsedEnd > existingStart
      );
    })
    .map((lead) => ({
      leadId: lead.leadId,
      clientName:
        lead.contact?.name ||
        lead.calendarAppointment?.inviteeName ||
        "Client",
      service:
        lead.calendarAppointment?.eventName ||
        "Calendar Appointment",
      startTime: lead.calendarAppointment?.startTime,
      endTime: lead.calendarAppointment?.endTime
    }));

  if (conflicts.length > 0 && allowConflict !== true) {
    return res.status(409).json({
      ok: false,
      conflict: true,
      message: "This appointment overlaps another scheduled appointment.",
      conflicts
    });
  }

  const leadId = `LEAD-${Date.now()}-MANUAL-CAL`;
  const now = new Date().toISOString();

  let location = {
    type: cleanMeetingType
  };

  if (cleanMeetingType === "Phone Call") {
    location.phone = cleanPhone;
    location.display = `Phone Call - ${cleanPhone}`;
  }

  if (
    cleanMeetingType === "Google Meet" ||
    cleanMeetingType === "Other Online Meeting"
  ) {
    location.join_url = cleanMeetingLink;
    location.display = cleanMeetingLink;
  }

  if (cleanMeetingType === "In Person") {
    location.address = cleanMeetingAddress;
    location.display = cleanMeetingAddress;
  }

  const lead = {
    leadId,
    timestamp: now,
    priority: "medium",
    status: "Calendar - Scheduled",
    notes: cleanNotes,
    contact: {
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone || "Not provided"
    },
    taxData: null,
    estimateSummary: {},
    calendarAppointment: {
      provider: "Manual",
      source: "Manual",
      webhookEvent: "manual.created",
      status: "Scheduled",
      inviteeName: cleanName,
      inviteeEmail: cleanEmail,
      eventName: cleanService,
      startTime: parsedStart.toISOString(),
      endTime: parsedEnd.toISOString(),
      durationMinutes:
        Number(durationMinutes) ||
        Math.round((parsedEnd - parsedStart) / 60000),
      meetingType: cleanMeetingType,
      location,
      notes: cleanNotes,
      timeZone: "America/Phoenix",
      receivedAt: now,
      createdAt: now
    }
  };

  try {
    const savedLead = await appendLead(lead);
    recentLeads.set(savedLead.leadId, savedLead);

    return res.status(201).json({
      ok: true,
      action: "created",
      leadId: savedLead.leadId,
      lead: savedLead,
      conflictOverrideUsed: conflicts.length > 0
    });
  } catch (error) {
    console.error(
      "[/api/calendar-appointment] Save failed:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      errors: ["Could not save the appointment. Please try again."]
    });
  }
});

// =============================================================================
// TAX UPDATES THAT MATTER - MONTHLY NEWSLETTER SIGNUP
// =============================================================================

function getNewsletterSourcePageLabel(sourcePage) {
  const normalizedPath = String(sourcePage || "/").trim() || "/";
  const sourceLabels = {
    "/": "Free Tax Estimator Home Page",
    "/plans-pricing": "Plans & Pricing",
    "/professional-tax-services": "Professional Tax Services",
    "/client-portal": "Secure Client Portal"
  };

  return sourceLabels[normalizedPath] || normalizedPath;
}

app.post("/api/newsletter-signup", async (req, res) => {
  const body = req.body || {};
  const email = normalizeEmail(body.email || "");
  const consent = body.consent === true;
  const sourcePage = String(body.sourcePage || "/").trim().slice(0, 200);
  const sourcePageLabel = getNewsletterSourcePageLabel(sourcePage);
  const errors = [];

  if (!email) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Enter a valid email address.");
  }

  if (!consent) {
    errors.push("Please confirm that you want the once-per-month email.");
  }

  if (errors.length) {
    return res.status(400).json({
      ok: false,
      errors
    });
  }

  const submittedAt = new Date().toISOString();
  const existing = await findNewsletterSubscription({ email });

  if (existing) {
    const currentRequest = getNewsletterSubscriptionRecord(existing) || {};
    const currentStatus = String(
      currentRequest.newsletterStatus || "active"
    ).trim().toLowerCase();

    if (currentStatus === "active") {
      return res.status(200).json({
        ok: true,
        alreadySubscribed: true
      });
    }

    const unsubscribeToken =
      String(currentRequest.unsubscribeToken || "").trim() ||
      crypto.randomBytes(24).toString("hex");

    const updateResult = await updateLeadAfterStripePayment(
      existing.leadId,
      (record = {}) => {
        const updated = { ...record };
        const contactRequest = {
          ...(
            updated.contactRequest ||
            updated.Request ||
            {}
          ),
          service: "Tax Updates That Matter Newsletter",
          preferredContact: "Email",
          message: "Monthly newsletter opt-in.",
          newsletterStatus: "active",
          frequency: "monthly",
          consentAt: submittedAt,
          resubscribedAt: submittedAt,
          sourcePage,
          sourcePageLabel,
          unsubscribeToken
        };

        updated.status = "Newsletter Subscriber - Active";
        updated.updatedAt = submittedAt;
        updated.contact = {
          ...(updated.contact || {}),
          name:
            String(updated.contact?.name || "").trim() ||
            "Tax Updates Subscriber",
          email,
          phone: ""
        };
        updated.contactRequest = contactRequest;
        updated.Request = {
          ...contactRequest,
          type: "Newsletter Subscription"
        };

        return updated;
      }
    );

    if (!updateResult.ok) {
      return res.status(500).json({
        ok: false,
        errors: ["We could not reactivate the monthly email right now. Please try again."]
      });
    }
  }

  let savedLead = existing;
  let unsubscribeToken = String(
    getNewsletterSubscriptionRecord(existing || {})?.unsubscribeToken || ""
  ).trim();

  if (!savedLead) {
    unsubscribeToken = crypto.randomBytes(24).toString("hex");

    const leadId =
      "NEWS-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 7).toUpperCase();

    const contactRequest = {
      service: "Tax Updates That Matter Newsletter",
      preferredContact: "Email",
      message: "Monthly newsletter opt-in.",
      newsletterStatus: "active",
      frequency: "monthly",
      consentAt: submittedAt,
      sourcePage,
      sourcePageLabel,
      unsubscribeToken
    };

    const lead = {
      leadId,
      timestamp: submittedAt,
      updatedAt: submittedAt,
      priority: "low",
      status: "Newsletter Subscriber - Active",
      source: "Tax Updates That Matter",
      notes:
        "Subscriber requested one Tax Updates That Matter email per month.",
      contact: {
        name: "Tax Updates Subscriber",
        email,
        phone: ""
      },
      taxData: {},
      estimateSummary: {},
      contactRequest,
      Request: {
        ...contactRequest,
        type: "Newsletter Subscription"
      }
    };

    try {
      savedLead = await appendLead(lead);
      recentLeads.set(savedLead.leadId, savedLead);
    } catch (error) {
      console.error(
        "[newsletter] Save failed:",
        error.message || error
      );

      return res.status(500).json({
        ok: false,
        errors: ["We could not add you right now. Please try again."]
      });
    }
  }

  const configuredNewsletterBaseUrl =
    String(APP_BASE_URL || "").trim();
  const newsletterBaseUrl =
    !configuredNewsletterBaseUrl ||
    /tax-estimator-app-v1\.onrender\.com/i.test(
      configuredNewsletterBaseUrl
    )
      ? "https://www.taxestimatereview.com"
      : configuredNewsletterBaseUrl.replace(/\/+$/, "");

  const unsubscribeUrl =
    newsletterBaseUrl +
    "/newsletter/unsubscribe?leadId=" +
    encodeURIComponent(savedLead.leadId || existing?.leadId || "") +
    "&token=" +
    encodeURIComponent(unsubscribeToken);

  let confirmationSent = false;
  let notificationSent = false;
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
      subject: "New Tax Updates That Matter Subscriber",
      text:
`A new subscriber joined the once-per-month Tax Updates That Matter list.

Email:
${email}

Source page:
${sourcePageLabel}

Frequency:
Once per month

Educational content and paid service offers will remain clearly separated.`
    });

    notificationSent = true;

    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject: "You’re on the Tax Updates That Matter List",
      text:
`Thank you for joining Tax Updates That Matter from Greatest Business Solution LLC.

You will receive one useful email per month with:
- The one tax update to know
- Important upcoming deadlines
- One common tax myth explained
- One quick action you can take
- A clearly labeled service offer only when it connects to that month’s topic

Changing dates and dollar amounts will be checked against current official sources before each edition.

Unsubscribe at any time:
${unsubscribeUrl}

Please do not email Social Security numbers, tax documents, bank information, or passwords.

Greatest Business Solution LLC`
    });

    confirmationSent = true;
  } catch (error) {
    emailError = error.message || "Email delivery failed.";
    console.error(
      "[newsletter] Email failed:",
      emailError
    );
  }

  return res.status(existing ? 200 : 201).json({
    ok: true,
    alreadySubscribed: false,
    confirmationSent,
    notificationSent,
    emailError:
      confirmationSent && notificationSent
        ? null
        : emailError
  });
});

app.get("/newsletter/unsubscribe", async (req, res) => {
  const leadId = String(req.query.leadId || "").trim();
  const token = String(req.query.token || "").trim();

  function renderPage(title, message, statusCode = 200) {
    return res.status(statusCode).send(
`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;background:#eef4f7;color:#163550;font-family:Arial,sans-serif;">
  <main style="max-width:680px;margin:70px auto;padding:34px;background:#fff;border:1px solid #d7e1e8;border-radius:18px;box-shadow:0 18px 42px rgba(18,54,80,.12);">
    <p style="color:#9a6d00;font-weight:800;text-transform:uppercase;letter-spacing:.08em;">Tax Updates That Matter</p>
    <h1 style="font-family:Georgia,serif;font-size:36px;line-height:1.1;margin:8px 0 16px;">${title}</h1>
    <p style="font-size:17px;line-height:1.7;">${message}</p>
    <a href="/" style="display:inline-block;margin-top:12px;padding:13px 18px;border-radius:9px;background:#123a5c;color:#fff;text-decoration:none;font-weight:800;">Return to Home Page</a>
  </main>
</body>
</html>`
    );
  }

  if (!leadId || !token) {
    return renderPage(
      "We Could Not Find That Unsubscribe Request",
      "The unsubscribe link is incomplete. Please use the full link from your email.",
      400
    );
  }

  const existing = await findNewsletterSubscription({ leadId });
  const currentRequest = getNewsletterSubscriptionRecord(existing || {}) || {};

  const expectedToken = String(
    currentRequest.unsubscribeToken || ""
  );
  const expectedTokenBuffer = Buffer.from(expectedToken);
  const suppliedTokenBuffer = Buffer.from(token);
  const tokenMatches =
    expectedTokenBuffer.length > 0 &&
    expectedTokenBuffer.length === suppliedTokenBuffer.length &&
    crypto.timingSafeEqual(
      expectedTokenBuffer,
      suppliedTokenBuffer
    );

  if (!existing || !tokenMatches) {
    return renderPage(
      "We Could Not Verify That Link",
      "The unsubscribe link is invalid or no longer active.",
      400
    );
  }

  if (
    String(currentRequest.newsletterStatus || "")
      .trim()
      .toLowerCase() === "inactive"
  ) {
    return renderPage(
      "You Are Already Unsubscribed",
      "No more Tax Updates That Matter emails will be sent to this address."
    );
  }

  const unsubscribedAt = new Date().toISOString();
  const updateResult = await updateLeadAfterStripePayment(
    existing.leadId,
    (record = {}) => {
      const updated = { ...record };
      const request = {
        ...(
          updated.contactRequest ||
          updated.Request ||
          {}
        ),
        newsletterStatus: "inactive",
        unsubscribedAt
      };

      updated.status = "Newsletter Subscriber - Unsubscribed";
      updated.updatedAt = unsubscribedAt;
      updated.contactRequest = request;
      updated.Request = {
        ...request,
        type: "Newsletter Subscription"
      };

      return updated;
    }
  );

  if (!updateResult.ok) {
    return renderPage(
      "We Could Not Complete That Request",
      "Please try the unsubscribe link again later.",
      500
    );
  }

  return renderPage(
    "You Have Been Unsubscribed",
    "You will not receive future Tax Updates That Matter emails. You may join again from the home page whenever you choose."
  );
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

  const phoneDigits = String(
    contact.phone || ""
  ).replace(/\D/g, "");

  if (phoneDigits.length !== 10) {
    errors.push(
      "Enter a 10-digit phone number in the format (555) 555-0123."
    );
  }

  const taxYear = String(
    intake.taxYear || ""
  ).trim();

  if (
    !/^\d{4}$/.test(taxYear) ||
    Number(taxYear) < 2015 ||
    Number(taxYear) > new Date().getFullYear()
  ) {
    errors.push(
      "Enter a valid four-digit tax year."
    );
  }


  const primaryState = String(
    intake.primaryState || ""
  )
    .trim()
    .toUpperCase();

  if (
    !primaryState ||
    !VALID_US_STATE_CODES.has(
      primaryState
    )
  ) {
    errors.push(
      "Select a valid two-letter state abbreviation."
    );
  }

  const serviceTypes = Array.isArray(intake.serviceTypes)
    ? intake.serviceTypes.filter(Boolean)
    : [];

  let incomeTypes = Array.isArray(intake.incomeTypes)
    ? intake.incomeTypes.filter(Boolean)
    : [];

  const received1099Nec = String(
    intake.received1099Nec ||
    (
      incomeTypes.includes("1099_nec")
        ? "yes"
        : ""
    )
  )
    .trim()
    .toLowerCase();

  if (
    received1099Nec &&
    ![
      "yes",
      "no"
    ].includes(received1099Nec)
  ) {
    errors.push(
      "Select Yes or No for the 1099 or 1099-NEC question."
    );
  }

  if (received1099Nec === "yes") {
    if (!incomeTypes.includes("1099_nec")) {
      incomeTypes = [
        "1099_nec",
        ...incomeTypes
      ];
    }
  } else if (received1099Nec === "no") {
    incomeTypes = incomeTypes.filter(
      (item) => item !== "1099_nec"
    );
  }


  if (serviceTypes.length === 0) {
    errors.push("Select at least one tax service needed.");
  }

  if (incomeTypes.length === 0) {
    errors.push("Select at least one income or tax situation.");
  }

  const selected1099Nec =
    received1099Nec === "yes" ||
    incomeTypes.includes("1099_nec");

  const form1099Count = Math.max(
    0,
    Number.parseInt(
      intake.form1099Count,
      10
    ) || 0
  );

  const has1099Expenses = String(
    intake.has1099Expenses || ""
  ).trim();

  const businessTradeName = String(
    intake.businessTradeName || ""
  ).trim();

  const hasEin = String(
    intake.hasEin || ""
  )
    .trim()
    .toLowerCase();

  const usedBusinessName = String(
    intake.usedBusinessName ||
    (
      businessTradeName
        ? "yes"
        : "no"
    )
  ).trim();

  const llcStatus = String(
    intake.llcStatus || ""
  )
    .trim()
    .toLowerCase();

  const businessEntityType = String(
    intake.businessEntityType || ""
  )
    .trim()
    .toLowerCase();

  const principalBusinessProfession = String(
    intake.principalBusinessProfession || ""
  ).trim();

  const businessActivityCode = String(
    intake.businessActivityCode || ""
  )
    .replace(/\D/g, "")
    .slice(0, 6);

  const businessActivityDescription = String(
    intake.businessActivityDescription || ""
  ).trim();

  const businessActivityCodeYear = String(
    intake.businessActivityCodeYear || ""
  ).trim();

  const businessActivityCodeStatus = String(
    intake.businessActivityCodeStatus || ""
  )
    .trim()
    .toLowerCase();

  const businessAddressSameAsHome = String(
    intake.businessAddressSameAsHome || ""
  )
    .trim()
    .toLowerCase();

  const businessAddressStreet = String(
    intake.businessAddressStreet || ""
  ).trim();

  const businessAddressCity = String(
    intake.businessAddressCity || ""
  ).trim();

  const businessAddressState = String(
    intake.businessAddressState || ""
  )
    .trim()
    .toUpperCase();

  const businessAddressZip = String(
    intake.businessAddressZip || ""
  ).trim();

  const businessAddress = [
    businessAddressStreet,
    businessAddressCity,
    [
      businessAddressState,
      businessAddressZip
    ]
      .filter(Boolean)
      .join(" ")
  ]
    .filter(Boolean)
    .join(", ");

  const accountingMethod = String(
    intake.accountingMethod || ""
  )
    .trim()
    .toLowerCase();

  const materialParticipation = String(
    intake.materialParticipation || ""
  )
    .trim()
    .toLowerCase();

  const multiState1099 = String(intake.multiState1099 || "").trim().toLowerCase();
  const businessStartYear = String(intake.businessStartYear || "").trim();
  const businessTaxStatus = String(intake.businessTaxStatus || "").trim().toLowerCase();
  const contractor1099Requirement = String(intake.contractor1099Requirement || "").trim().toLowerCase();
  const contractor1099Filed = String(intake.contractor1099Filed || "").trim().toLowerCase();
  const businessVehicleUsed = String(intake.businessVehicleUsed || "").trim().toLowerCase();
  const vehicleBusinessUseDate = String(intake.vehicleBusinessUseDate || "").trim();
  const vehicleBusinessUseDateUnknown = intake.vehicleBusinessUseDateUnknown === true || String(intake.vehicleBusinessUseDateUnknown || "").toLowerCase() === "yes";

  const businessProfileServiceValues = new Set([
    "business_return",
    "partnership_return",
    "s_corporation_return",
    "c_corporation_return",
    "nonprofit_return"
  ]);

  const businessProfileIncomeValues = new Set([
    "1099_k",
    "gig_platform",
    "creator_income",
    "self_employment",
    "rental_income",
    "k1_income"
  ]);

  const businessProfileApplies =
    intake.businessProfileApplies === true ||
    selected1099Nec ||
    serviceTypes.some(
      (item) => businessProfileServiceValues.has(item)
    ) ||
    incomeTypes.some(
      (item) => businessProfileIncomeValues.has(item)
    );

  const separateEntityServiceValues = new Set([
    "partnership_return",
    "s_corporation_return",
    "c_corporation_return",
    "nonprofit_return"
  ]);

  const scheduleCCodeApplies =
    businessProfileApplies &&
    !serviceTypes.some(
      (item) => separateEntityServiceValues.has(item)
    ) &&
    ![
      "multi_member_llc",
      "partnership",
      "s_corporation",
      "c_corporation",
      "nonprofit"
    ].includes(businessEntityType);

  const scheduleCCodeMap =
    scheduleCCodeMaps.get(taxYear) || null;

  const officialScheduleCCodeEntry =
    scheduleCCodeMap &&
    businessActivityCode
      ? scheduleCCodeMap.get(
          businessActivityCode
        ) || null
      : null;

  if (
    selected1099Nec &&
    form1099Count < 1
  ) {
    errors.push(
      "Enter the number of 1099 or 1099-NEC forms received."
    );
  }

  if (businessProfileApplies) {
    const yesNoNotSure = [
      "yes",
      "no",
      "not_sure"
    ];

    if (!yesNoNotSure.includes(has1099Expenses)) {
      errors.push(
        "Select whether the business had related expenses."
      );
    }

    if (!yesNoNotSure.includes(hasEin)) {
      errors.push(
        "Select whether you have an EIN."
      );
    }

    if (!yesNoNotSure.includes(llcStatus)) {
      errors.push(
        "Select whether the business is an LLC."
      );
    }

    if (
      ![
        "sole_proprietor",
        "single_member_llc",
        "multi_member_llc",
        "partnership",
        "s_corporation",
        "c_corporation",
        "nonprofit",
        "other",
        "not_sure"
      ].includes(businessEntityType)
    ) {
      errors.push(
        "Select the business structure."
      );
    }

    if (!principalBusinessProfession) {
      errors.push(
        "Enter the principal business or profession."
      );
    }

    if (scheduleCCodeApplies) {
      if (
        ![
          "client_selected",
          "office_review_needed",
          "office_confirmed"
        ].includes(businessActivityCodeStatus)
      ) {
        errors.push(
          "Select an official Schedule C business code or request office review."
        );
      }

      if (
        businessActivityCodeStatus ===
        "office_review_needed"
      ) {
        if (businessActivityCode) {
          errors.push(
            "Clear the Schedule C business code when requesting office review."
          );
        }
      } else {
        if (!/^\d{6}$/.test(businessActivityCode)) {
          errors.push(
            "Enter or select a valid six-digit Schedule C business code."
          );
        }

        if (
          businessActivityCodeYear !== taxYear
        ) {
          errors.push(
            "The Schedule C business-code source year must match the selected tax year."
          );
        }

        if (!scheduleCCodeMap) {
          errors.push(
            "The official Schedule C business-code list for the selected tax year is not loaded. Request office review."
          );
        } else if (!officialScheduleCCodeEntry) {
          errors.push(
            "The selected Schedule C business code is not in the official IRS list for the selected tax year."
          );
        }
      }
    }

    if (
      !yesNoNotSure.includes(
        businessAddressSameAsHome
      )
    ) {
      errors.push(
        "Select whether the business address is the same as the home address."
      );
    }

    if (
      businessAddressSameAsHome === "no"
    ) {
      if (!businessAddressStreet) {
        errors.push(
          "Enter the business street address."
        );
      }

      if (!businessAddressCity) {
        errors.push(
          "Enter the business city."
        );
      }

      if (
        !businessAddressState ||
        !VALID_US_STATE_CODES.has(
          businessAddressState
        )
      ) {
        errors.push(
          "Select a valid two-letter business state."
        );
      }

      if (
        !/^\d{5}(?:-\d{4})?$/.test(
          businessAddressZip
        )
      ) {
        errors.push(
          "Enter a valid business ZIP code."
        );
      }
    }

    if (
      ![
        "cash",
        "accrual",
        "other",
        "not_sure"
      ].includes(accountingMethod)
    ) {
      errors.push(
        "Select the accounting method."
      );
    }

    if (
      !yesNoNotSure.includes(
        materialParticipation
      )
    ) {
      errors.push(
        "Select whether you regularly worked in or managed the business during the selected tax year."
      );
    }

    if (!/^\d{4}$/.test(businessStartYear) || Number(businessStartYear) < 1900 || Number(businessStartYear) > Number(taxYear)) {
      errors.push("Enter the year the business started. It cannot be later than the selected tax year.");
    }
    if (!["yes", "no", "not_sure", "new_business"].includes(businessTaxStatus)) {
      errors.push("Select whether required business tax returns and payments are current.");
    }
    if (!yesNoNotSure.includes(contractor1099Requirement)) {
      errors.push("Select whether the business made contractor or nonemployee payments that may require Forms 1099.");
    }
    if (contractor1099Requirement === "yes" && !["yes", "no", "not_sure", "not_due_yet"].includes(contractor1099Filed)) {
      errors.push("Select whether all required contractor Forms 1099 were filed.");
    }
    if (!yesNoNotSure.includes(businessVehicleUsed)) {
      errors.push("Select whether a car, truck, or van was used for the business.");
    }
    if (businessVehicleUsed === "yes" && !vehicleBusinessUseDate && !vehicleBusinessUseDateUnknown) {
      errors.push("Enter when the primary vehicle was first used for business, or indicate that the exact date is not remembered.");
    }
    if (vehicleBusinessUseDate && !/^\d{4}-\d{2}-\d{2}$/.test(vehicleBusinessUseDate)) {
      errors.push("Enter a valid first business-use date for the vehicle.");
    }
    if (!yesNoNotSure.includes(multiState1099)) {
      errors.push("Select whether the business or 1099 income involved more than one state.");
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      ok: false,
      errors
    });
  }

  const documentCount = Math.max(
    0,
    Number.parseInt(intake.documentCount, 10) || 0,
    form1099Count
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

  const hasGig = incomeTypes.some((item) => gigSignals.includes(item));
  const businessComplianceReviewNeeded = businessProfileApplies && (
    ["no", "not_sure"].includes(businessTaxStatus) ||
    (contractor1099Requirement === "yes" && ["no", "not_sure"].includes(contractor1099Filed))
  );

  const businessCodeReviewNeeded =
    scheduleCCodeApplies &&
    businessActivityCodeStatus !==
      "office_confirmed";

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
  if (
    businessComplianceReviewNeeded ||
    businessCodeReviewNeeded
  ) {
    status = "Tax Preparation Intake - Needs Review";
    needsProfessionalReview = true;
  }

  let activePortalAccount = null;

  try {
    activePortalAccount =
      await findActiveClientPortalAccountByEmail(
        email
      );
  } catch (portalLookupError) {
    console.warn(
      "[tax preparation intake] Existing portal lookup failed:",
      portalLookupError?.message ||
      portalLookupError
    );
  }

  const portalAccessMode =
    activePortalAccount
      ? "sign-in"
      : "activate";

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
      taxYear: taxYear || null,
      filingStatus: intake.filingStatus || null,
      stateCode: primaryState || null
    },
    estimateSummary: {},
    taxPreparationIntake: {
      ...intake,
      taxYear,
      serviceTypes,
      incomeTypes,
      documentCount,
      stateCount,
      primaryState,
      received1099Nec:
        selected1099Nec
          ? "yes"
          : received1099Nec || "no",
      form1099Count:
        selected1099Nec
          ? form1099Count
          : 0,
      businessProfileApplies,
      has1099Expenses:
        businessProfileApplies
          ? has1099Expenses
          : "",
      businessTradeName:
        businessProfileApplies
          ? businessTradeName
          : "",
      hasEin:
        businessProfileApplies
          ? hasEin
          : "",
      llcStatus:
        businessProfileApplies
          ? llcStatus
          : "",
      businessEntityType:
        businessProfileApplies
          ? businessEntityType
          : "",
      principalBusinessProfession:
        businessProfileApplies
          ? principalBusinessProfession
          : "",
      businessActivityCode:
        scheduleCCodeApplies &&
        officialScheduleCCodeEntry
          ? businessActivityCode
          : "",
      businessActivityDescription:
        scheduleCCodeApplies &&
        officialScheduleCCodeEntry
          ? officialScheduleCCodeEntry.description
          : "",
      businessActivitySector:
        scheduleCCodeApplies &&
        officialScheduleCCodeEntry
          ? officialScheduleCCodeEntry.sector
          : "",
      businessActivityCodeYear:
        scheduleCCodeApplies &&
        officialScheduleCCodeEntry
          ? businessActivityCodeYear
          : "",
      businessActivityCodeStatus:
        scheduleCCodeApplies
          ? businessActivityCodeStatus
          : "",
      businessActivitySourceTitle:
        scheduleCCodeApplies
          ? scheduleCCodes2025.sourceTitle
          : "",
      businessActivitySourceUrl:
        scheduleCCodeApplies
          ? scheduleCCodes2025.sourceUrl
          : "",
      businessAddressSameAsHome:
        businessProfileApplies
          ? businessAddressSameAsHome
          : "",
      businessAddressStreet:
        businessProfileApplies &&
        businessAddressSameAsHome === "no"
          ? businessAddressStreet
          : "",
      businessAddressCity:
        businessProfileApplies &&
        businessAddressSameAsHome === "no"
          ? businessAddressCity
          : "",
      businessAddressState:
        businessProfileApplies &&
        businessAddressSameAsHome === "no"
          ? businessAddressState
          : "",
      businessAddressZip:
        businessProfileApplies &&
        businessAddressSameAsHome === "no"
          ? businessAddressZip
          : "",
      businessAddress:
        businessProfileApplies &&
        businessAddressSameAsHome === "no"
          ? businessAddress
          : "",
      accountingMethod:
        businessProfileApplies
          ? accountingMethod
          : "",
      materialParticipation: businessProfileApplies ? materialParticipation : "",
      businessStartYear: businessProfileApplies ? businessStartYear : "",
      businessTaxStatus: businessProfileApplies ? businessTaxStatus : "",
      contractor1099Requirement: businessProfileApplies ? contractor1099Requirement : "",
      contractor1099Filed: businessProfileApplies && contractor1099Requirement === "yes" ? contractor1099Filed : "",
      businessVehicleUsed: businessProfileApplies ? businessVehicleUsed : "",
      vehicleBusinessUseDate: businessProfileApplies && businessVehicleUsed === "yes" && !vehicleBusinessUseDateUnknown ? vehicleBusinessUseDate : "",
      vehicleBusinessUseDateUnknown: businessProfileApplies && businessVehicleUsed === "yes" ? vehicleBusinessUseDateUnknown : false,
      usedBusinessName:
        businessProfileApplies
          ? usedBusinessName
          : "",
      multiState1099:
        businessProfileApplies
          ? multiState1099
          : "",
      sourceLeadId: String(body.sourceLeadId || "").trim(),
      submittedAt,
      recommendedLane,
      needsProfessionalReview
    },
    taxPreparationWork: {
      version: 1,
      portalStatus:
        activePortalAccount
          ? "Active"
          : "Activation Needed",
      workStatus: needsProfessionalReview
        ? "Needs Professional Review"
        : activePortalAccount
          ? "Documents Needed"
          : "Portal Activation Needed",
      documentStatus: "Documents Needed",
      clientInformationStatus: "Needs Review",
      paymentStatus: "Quote Needed",
      paymentRequirement: "Required",
      quotedFee: 0,
      quotedFeeCents: 0,
      amountPaid: 0,
      amountPaidCents: 0,
      paymentRequestAmount: 0,
      paymentRequestAmountCents: 0,
      paymentPurpose: "Full Payment",
      signatureStatus: "Not Requested",
      efileStatus: "Not Started",
      acceptanceStatus: "Not Submitted",
      finalReturnDeliveryStatus: "Not Delivered",
      convertedAt: submittedAt,
      updatedAt: submittedAt
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

      const portalBaseUrl =
        String(APP_BASE_URL || "")
          .replace(/\/+$/, "") +
        "/client-portal";

      const portalUrl =
        activePortalAccount
          ? portalBaseUrl +
            "?taxPrep=1&email=" +
            encodeURIComponent(email)
          : portalBaseUrl +
            "?activate=1&taxPrep=1&leadId=" +
            encodeURIComponent(leadId) +
            "&email=" +
            encodeURIComponent(email);

      const nextStepText = needsProfessionalReview
        ? "Your intake includes items that need a professional review before pricing or scheduling. We will review the information and contact you."
        : "Your intake is ready for the next step. You may schedule a Tax Preparation Fit Call using the link below.";

      const portalInstruction =
        activePortalAccount
          ? "This request was connected to your existing secure portal. Sign in with the same email address and password you already use."
          : "Activate your secure portal using the link below. The activation screen will already contain your email address and client reference number. You will create one password for this same portal.";

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

Secure client portal:
${portalUrl}

${portalInstruction}

Reference number:
${leadId}

Use the same secure portal for tax-preparation documents and office updates. Please do not email Social Security numbers, tax documents, bank information, or passwords.

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
      portalAccessMode,
      portalUrl:
        activePortalAccount
          ? "/client-portal?taxPrep=1&email=" +
            encodeURIComponent(email)
          : "/client-portal?activate=1&taxPrep=1&leadId=" +
            encodeURIComponent(leadId) +
            "&email=" +
            encodeURIComponent(email),
      portalActionLabel:
        activePortalAccount
          ? "Sign In to My Secure Portal"
          : "Activate My Secure Client Portal",
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
// POST /api/contractor-1099-request
// Creates a separate business filing request for Forms 1099 issued to
// contractors or other payees. Sensitive payer/payee data is collected later
// through the Secure Client Portal.
// =============================================================================

app.post("/api/contractor-1099-request", async (req, res) => {
  const body = req.body || {};
  const contact = body.contact || {};
  const request = body.request || {};
  const errors = [];

  const name = String(contact.name || "").trim();
  const email = normalizeEmail(contact.email || "");
  const phoneDigits = String(
    contact.phone || ""
  )
    .replace(/\D/g, "")
    .slice(0, 10);
  const phone = formatPhoneNumber(phoneDigits);

  const businessLegalName = String(
    request.businessLegalName || ""
  ).trim();

  const businessTradeName = String(
    request.businessTradeName || ""
  ).trim();

  const hasEin = String(
    request.hasEin || ""
  )
    .trim()
    .toLowerCase();

  const taxYear = String(
    request.taxYear || ""
  ).trim();

  const primaryState = String(
    request.primaryState || ""
  )
    .trim()
    .toUpperCase();

  const stateCount = Math.max(
    1,
    Number.parseInt(request.stateCount, 10) || 1
  );

  const serviceTypes = Array.isArray(
    request.serviceTypes
  )
    ? Array.from(
        new Set(
          request.serviceTypes
            .map((value) =>
              String(value || "")
                .trim()
                .toLowerCase()
            )
            .filter(Boolean)
        )
      )
    : [];

  const allowedServiceTypes = new Set([
    "original_1099_nec",
    "original_1099_misc",
    "correction",
    "late_filing",
    "recipient_copies",
    "not_sure"
  ]);

  const recipientCount = Math.max(
    0,
    Number.parseInt(
      request.recipientCount,
      10
    ) || 0
  );

  const totalInformationReturns = Math.max(
    0,
    Number.parseInt(
      request.totalInformationReturns,
      10
    ) || 0
  );

  const w9Status = String(
    request.w9Status || ""
  )
    .trim()
    .toLowerCase();

  const contractorInformationStatus = String(
    request.contractorInformationStatus || ""
  )
    .trim()
    .toLowerCase();

  const paymentRecordsStatus = String(
    request.paymentRecordsStatus || ""
  )
    .trim()
    .toLowerCase();

  const federalFilingNeeded = String(
    request.federalFilingNeeded || ""
  )
    .trim()
    .toLowerCase();

  const deadlineStatus = String(
    request.deadlineStatus || ""
  )
    .trim()
    .toLowerCase();

  const backupWithholdingStatus = String(
    request.backupWithholdingStatus || ""
  )
    .trim()
    .toLowerCase();

  const stateFilingStatus = String(
    request.stateFilingStatus || ""
  )
    .trim()
    .toLowerCase();

  const recipientCopyMethod = String(
    request.recipientCopyMethod || ""
  )
    .trim()
    .toLowerCase();

  const taxPreparationConnection = String(
    request.taxPreparationConnection || ""
  )
    .trim()
    .toLowerCase();

  const portalAccountKnown = String(
    request.portalAccountKnown || ""
  )
    .trim()
    .toLowerCase();

  const acknowledgedSecurePortal =
    request.acknowledgedSecurePortal === true;

  const clientNotes = String(
    request.notes || ""
  )
    .trim()
    .slice(0, 1500);

  if (!name) {
    errors.push("Contact name is required.");
  }

  if (!email) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email address format is invalid.");
  }

  if (phoneDigits.length !== 10) {
    errors.push(
      "Enter a 10-digit phone number in the format (555) 555-0123."
    );
  }

  if (!businessLegalName) {
    errors.push("Business legal name is required.");
  }

  if (!["yes", "no", "not_sure"].includes(hasEin)) {
    errors.push("Select whether the business has an EIN.");
  }

  if (
    !/^\d{4}$/.test(taxYear) ||
    Number(taxYear) < 2015 ||
    Number(taxYear) > new Date().getFullYear()
  ) {
    errors.push(
      "Enter a valid four-digit reporting year."
    );
  }

  if (!VALID_US_STATE_CODES.has(primaryState)) {
    errors.push(
      "Select a valid two-letter primary business state."
    );
  }

  if (
    !serviceTypes.length ||
    serviceTypes.some(
      (value) => !allowedServiceTypes.has(value)
    )
  ) {
    errors.push(
      "Select at least one valid Contractor 1099 service."
    );
  }

  if (recipientCount < 1) {
    errors.push(
      "Enter the number of contractors or other payees that may need a form."
    );
  }

  if (
    totalInformationReturns < recipientCount
  ) {
    errors.push(
      "Total W-2 and 1099 forms cannot be less than the number of payees in this request."
    );
  }

  if (![
    "all_collected",
    "some_missing",
    "none_collected",
    "not_sure"
  ].includes(w9Status)) {
    errors.push("Select the W-9 collection status.");
  }

  if (![
    "complete",
    "information_missing",
    "not_ready",
    "not_sure"
  ].includes(contractorInformationStatus)) {
    errors.push(
      "Select whether any contractor or payee information is missing."
    );
  }

  if (![
    "complete",
    "partial",
    "not_ready",
    "not_sure"
  ].includes(paymentRecordsStatus)) {
    errors.push(
      "Select the contractor payment-record status."
    );
  }

  if (![
    "yes",
    "no",
    "not_sure"
  ].includes(federalFilingNeeded)) {
    errors.push(
      "Select whether federal filing is needed."
    );
  }

  if (![
    "on_time",
    "late",
    "correction",
    "not_sure"
  ].includes(deadlineStatus)) {
    errors.push(
      "Select the filing deadline or correction situation."
    );
  }

  if (![
    "yes",
    "no",
    "not_sure"
  ].includes(backupWithholdingStatus)) {
    errors.push(
      "Select the backup-withholding status."
    );
  }

  if (![
    "not_expected",
    "primary_state_only",
    "multiple_states",
    "not_sure"
  ].includes(stateFilingStatus)) {
    errors.push(
      "Select the state-filing situation."
    );
  }

  if (![
    "secure_electronic",
    "paper_mail",
    "client_handles",
    "office_recommendation"
  ].includes(recipientCopyMethod)) {
    errors.push(
      "Select the preferred recipient-copy method."
    );
  }

  if (![
    "yes",
    "no",
    "not_sure"
  ].includes(taxPreparationConnection)) {
    errors.push(
      "Select whether this service is connected to a tax return we are preparing."
    );
  }

  if (![
    "yes",
    "no",
    "not_sure"
  ].includes(portalAccountKnown)) {
    errors.push(
      "Select whether you already use the Secure Client Portal."
    );
  }

  if (!acknowledgedSecurePortal) {
    errors.push(
      "Confirm that sensitive contractor information will be provided only through the Secure Client Portal."
    );
  }

  const sensitivePublicNumberPattern =
    /(?:\b\d{3}[- ]?\d{2}[- ]?\d{4}\b)|(?:\b\d{2}[- ]?\d{7}\b)/;

  if (sensitivePublicNumberPattern.test(clientNotes)) {
    errors.push(
      "Remove Social Security numbers and EIN-style taxpayer identification numbers from General Notes. Provide them only through the Secure Client Portal."
    );
  }

  if (errors.length) {
    return res.status(400).json({
      ok: false,
      errors
    });
  }

  const activePortalAccount =
    await findActiveClientPortalAccountByEmail(email);

  const submittedAt = new Date().toISOString();
  const leadId =
    "C1099-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase();

  const electronicFilingReview =
    totalInformationReturns >= 10;

  const needsProfessionalReview =
    serviceTypes.includes("correction") ||
    serviceTypes.includes("late_filing") ||
    serviceTypes.includes("not_sure") ||
    ["late", "correction", "not_sure"].includes(
      deadlineStatus
    ) ||
    w9Status !== "all_collected" ||
    contractorInformationStatus !== "complete" ||
    paymentRecordsStatus !== "complete" ||
    federalFilingNeeded !== "yes" ||
    backupWithholdingStatus !== "no" ||
    stateCount > 1 ||
    stateFilingStatus !== "primary_state_only" ||
    electronicFilingReview ||
    hasEin !== "yes";

  const workStatus =
    needsProfessionalReview
      ? "Needs Professional Review"
      : activePortalAccount
        ? "Documents Needed"
        : "Portal Activation Needed";

  const status =
    "Contractor 1099 - " + workStatus;

  const serviceLabels = {
    original_1099_nec:
      "Original Form 1099-NEC",
    original_1099_misc:
      "Original Form 1099-MISC",
    correction:
      "Correction",
    late_filing:
      "Late / Past-Due Filing",
    recipient_copies:
      "Recipient Copies",
    not_sure:
      "Form Type Not Sure"
  };

  const lead = {
    leadId,
    timestamp: submittedAt,
    updatedAt: submittedAt,
    priority:
      needsProfessionalReview
        ? "high"
        : "medium",
    status,
    notes:
      "Contractor Forms 1099 service request submitted." +
      (
        clientNotes
          ? "\nClient note: " + clientNotes
          : ""
      ),
    contact: {
      name,
      email,
      phone
    },
    taxData: {
      taxYear,
      stateCode: primaryState
    },
    contractor1099Request: {
      version: 2,
      submittedAt,
      taxYear,
      businessLegalName,
      businessTradeName,
      hasEin,
      primaryState,
      stateCount,
      serviceTypes,
      serviceLabels: serviceTypes.map(
        (value) =>
          serviceLabels[value] || value
      ),
      recipientCount,
      totalInformationReturns,
      electronicFilingReview,
      w9Status,
      contractorInformationStatus,
      paymentRecordsStatus,
      federalFilingNeeded,
      deadlineStatus,
      backupWithholdingStatus,
      stateFilingStatus,
      recipientCopyMethod,
      taxPreparationConnection,
      portalAccountKnown,
      acknowledgedSecurePortal,
      clientNotes,
      source: "Public Contractor 1099 Intake"
    },
    contractor1099Work: {
      version: 1,
      portalStatus:
        activePortalAccount
          ? "Active"
          : "Activation Needed",
      workStatus,
      documentStatus: "Documents Needed",
      payerInformationStatus: "Needs Review",
      contractorInformationStatus:
        contractorInformationStatus === "complete"
          ? "Needs Review"
          : "Information Needed",
      w9RequirementStatus:
        w9Status === "all_collected"
          ? "Needs Review"
          : "W-9s Needed",
      payeeInformationStatus:
        w9Status === "all_collected" &&
        contractorInformationStatus === "complete"
          ? "Needs Review"
          : "W-9s Needed",
      paymentStatus: "Quote Needed",
      paymentRequirement: "Required",
      quotedFee: 0,
      quotedFeeCents: 0,
      amountPaid: 0,
      amountPaidCents: 0,
      paymentRequestAmount: 0,
      paymentRequestAmountCents: 0,
      paymentPurpose: "Full Payment",
      preparationStatus: "Not Started",
      filingStatus: "Not Started",
      irsAcceptanceStatus: "Not Submitted",
      stateFilingWorkStatus:
        stateFilingStatus === "not_expected"
          ? "Not Required"
          : "Not Reviewed",
      recipientCopyStatus: "Not Delivered",
      filingConfirmationStatus: "Not Delivered",
      correctionStatus:
        serviceTypes.includes("correction")
          ? "Correction Review Needed"
          : "Not Applicable",
      officeNote: "",
      convertedAt: submittedAt,
      updatedAt: submittedAt
    }
  };

  try {
    const savedLead = await appendLead(lead);
    recentLeads.set(savedLead.leadId, savedLead);

    let officeEmailSent = false;
    let clientEmailSent = false;
    let emailError = "";

    const portalBaseUrl =
      String(APP_BASE_URL || "")
        .replace(/\/+$/, "") +
      "/client-portal";

    const portalUrl =
      activePortalAccount
        ? portalBaseUrl +
          "?contractor1099=1&email=" +
          encodeURIComponent(email)
        : portalBaseUrl +
          "?activate=1&contractor1099=1&leadId=" +
          encodeURIComponent(leadId) +
          "&email=" +
          encodeURIComponent(email);

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
        subject:
          "New Contractor Forms 1099 Request - " +
          businessLegalName,
        text:
`A new Contractor Forms 1099 request was submitted.

Contact:
${name}
${email}
${phone}

Business:
${businessLegalName}
${businessTradeName || "No separate trade name reported"}

Reporting year:
${taxYear}

Services:
${serviceTypes.map(
  (value) => serviceLabels[value] || value
).join(", ")}

Potential payees:
${recipientCount}

W-9 status:
${w9Status}

Deadline situation:
${deadlineStatus}

Reference number:
${leadId}

Open Tax Lead Center > Contractor 1099 Requests.`
      });

      officeEmailSent = true;

      await transporter.sendMail({
        from: EMAIL_USER,
        to: email,
        subject:
          "We Received Your Contractor Forms 1099 Request",
        text:
`Hello ${name},

We received your Contractor Forms 1099 service request for ${businessLegalName}.

Reporting year:
${taxYear}

Potential contractors or other payees:
${recipientCount}

Current status:
${workStatus}

The office will review the form type, W-9 readiness, payment records, filing timing, state requirements, and service quote. No payment was charged by this intake.

Secure Client Portal:
${portalUrl}

${activePortalAccount
  ? "This request is connected to your existing portal. Sign in with the same email and password. Do not create another account."
  : "Activate the secure portal using the link above. Sensitive W-9s, taxpayer identification numbers, payment totals, and filing records must be provided through the portal."}

Reference number:
${leadId}

Please do not email Social Security numbers, contractor EINs, W-9s, bank information, or detailed payment records.

Thank you,

Greatest Business Solution LLC`
      });

      clientEmailSent = true;
    } catch (emailErr) {
      emailError =
        emailErr?.message ||
        "Email delivery failed.";

      console.error(
        "[contractor 1099 request] Email failed:",
        leadId,
        emailError
      );
    }

    return res.status(201).json({
      ok: true,
      leadId,
      status: workStatus,
      needsProfessionalReview,
      electronicFilingReview,
      portalAccessMode:
        activePortalAccount
          ? "existing"
          : "activation",
      portalUrl:
        activePortalAccount
          ? "/client-portal?contractor1099=1&email=" +
            encodeURIComponent(email)
          : "/client-portal?activate=1&contractor1099=1&leadId=" +
            encodeURIComponent(leadId) +
            "&email=" +
            encodeURIComponent(email),
      portalActionLabel:
        activePortalAccount
          ? "Sign In to My Secure Portal"
          : "Activate My Secure Client Portal",
      officeEmailSent,
      clientEmailSent,
      emailError:
        officeEmailSent && clientEmailSent
          ? null
          : emailError
    });
  } catch (err) {
    console.error(
      "[contractor 1099 request] Save failed:",
      err.message || err
    );

    return res.status(500).json({
      ok: false,
      errors: [
        "Could not save your Contractor 1099 request. Please try again."
      ]
    });
  }
});



// =============================================================================
// POST /api/extension-request
// Creates a deadline-aware Tax Extension request before Stripe checkout.
// =============================================================================

app.post("/api/extension-request", async (req, res) => {
  const body = req.body || {};
  const contact = body.contact || {};
  const request = body.extension || {};
  const errors = [];

  const name = String(contact.name || "").trim();
  const email = normalizeEmail(contact.email || "");
  const phoneDigits =
    String(contact.phone || "")
      .replace(/\D/g, "")
      .slice(0, 10);
  const phone = formatPhoneNumber(phoneDigits);
  const serviceType =
    String(request.serviceType || "").trim().toLowerCase();
  const taxYear =
    String(request.taxYear || "").trim();
  const entityType =
    String(request.entityType || "").trim();
  const deadlineStatus =
    String(request.deadlineStatus || "").trim();
  const stateExtensionRequested =
    request.stateExtensionRequested === true;
  const stateCode =
    String(request.stateCode || "")
      .trim()
      .toUpperCase();

  if (!name) {
    errors.push("Full name is required.");
  }

  if (!email) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email address format is invalid.");
  }

  if (phoneDigits.length !== 10) {
    errors.push(
      "Enter a 10-digit phone number in the format (555) 555-0123."
    );
  }

  if (!["individual", "business"].includes(serviceType)) {
    errors.push("Select an individual or business extension.");
  }

  const numericTaxYear =
    Number(taxYear);

  if (
    !/^\d{4}$/.test(taxYear) ||
    numericTaxYear < 2000 ||
    numericTaxYear >
      new Date().getFullYear()
  ) {
    errors.push(
      "Enter a valid tax year that is not in the future."
    );
  }

  if (
    serviceType === "individual" &&
    !String(
      request.filingStatus || ""
    ).trim()
  ) {
    errors.push(
      "Select the individual filing status."
    );
  }

  if (
    serviceType === "business" &&
    !entityType
  ) {
    errors.push("Select the business return type.");
  }

  if (
    ![
      "before_due_date",
      "relief_or_special_rule",
      "unsure_or_late"
    ].includes(deadlineStatus)
  ) {
    errors.push("Select the deadline situation that applies.");
  }

  if (
    stateExtensionRequested &&
    !VALID_US_STATE_CODES.has(stateCode)
  ) {
    errors.push("Select valid two-letter state initials.");
  }

  if (request.acknowledgmentAccepted !== true) {
    errors.push(
      "Acknowledge that an extension gives more time to file, not more time to pay."
    );
  }

  if (errors.length) {
    return res.status(400).json({
      ok: false,
      errors
    });
  }

  const basePrice =
    serviceType === "business"
      ? 99
      : 49;

  const stateAddOn =
    stateExtensionRequested
      ? 25
      : 0;

  const totalPrice =
    basePrice + stateAddOn;

  const checkoutEligible =
    deadlineStatus !== "unsure_or_late";

  const now = new Date().toISOString();
  const leadId =
    "EXT-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase();

  const workStatus =
    checkoutEligible
      ? "Payment Pending"
      : "Deadline Review Needed";

  const lead = {
    leadId,
    timestamp: now,
    updatedAt: now,
    priority:
      checkoutEligible
        ? "high"
        : "critical",
    status:
      checkoutEligible
        ? "Extension Request - Payment Pending"
        : "Extension Request - Deadline Review Needed",
    notes:
      checkoutEligible
        ? "Tax Extension request submitted and awaiting Stripe payment."
        : "Tax Extension request submitted for deadline eligibility review before payment.",
    contact: {
      name,
      email,
      phone
    },
    taxData: {
      taxYear,
      stateCode:
        stateCode || null
    },
    estimateSummary: {},
    extensionRequest: {
      version: 1,
      requested: true,
      requestedAt: now,
      updatedAt: now,
      serviceType,
      entityType:
        serviceType === "business"
          ? entityType
          : "",
      taxYear,
      filingStatus:
        String(request.filingStatus || "").trim(),
      federalIncluded: true,
      stateExtensionRequested,
      stateCode:
        stateExtensionRequested
          ? stateCode
          : "",
      deadlineStatus,
      deadlineReviewRequired:
        !checkoutEligible,
      deadlineDecision:
        checkoutEligible
          ? "Eligible"
          : "Not Reviewed",
      informationStatus: "Needs Review",
      stateActionStatus:
        stateExtensionRequested
          ? "Not Reviewed"
          : "Not Applicable",
      checkoutEligible,
      estimatedTotalTax:
        Math.max(
          0,
          Number(request.estimatedTotalTax || 0)
        ),
      totalPayments:
        Math.max(
          0,
          Number(request.totalPayments || 0)
        ),
      estimatedBalanceDue:
        Math.max(
          0,
          Number(request.estimatedBalanceDue || 0)
        ),
      paymentWithExtension:
        Math.max(
          0,
          Number(request.paymentWithExtension || 0)
        ),
      consideringFullPreparation:
        request.consideringFullPreparation === true,
      preparationQuoteRequested:
        request.consideringFullPreparation === true,
      acknowledgmentAccepted: true,
      feeCreditTowardPreparation: false,
      basePrice,
      stateAddOn,
      totalPrice,
      totalPriceCents:
        totalPrice * 100,
      paymentStatus:
        checkoutEligible
          ? "Payment Pending"
          : "Not Charged - Deadline Review",
      stripeCheckoutUrl: "",
      paymentLinkSentAt: "",
      paymentLinkEmailSent: false,
      paymentLinkEmailError: "",
      workStatus,
      confirmationStatus: "Not Delivered"
    }
  };

  try {
    const savedLead = await appendLead(lead);
    recentLeads.set(
      savedLead.leadId,
      savedLead
    );

    let emailSent = false;
    let emailError = "";

    try {
      if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
        throw new Error(
          "Email delivery is not configured."
        );
      }

      const nextStep = checkoutEligible
        ? "You may continue to the secure payment page. The office will review your request before filing."
        : "The regular deadline may have passed or may require a special rule. The office will review eligibility before any payment is requested.";

      await transporter.sendMail({
        from: EMAIL_USER,
        to: email,
        subject:
          "We Received Your Tax Extension Request",
        text:
`Hello ${name},

We received your Tax Extension request for tax year ${taxYear}.

Service:
${serviceType === "business" ? "Business Extension" : "Individual Federal Extension"}${stateExtensionRequested ? " + State Extension Add-On (" + stateCode + ")" : ""}

Professional service fee:
$${totalPrice}

${nextStep}

Important: An extension gives additional time to file. It does not extend the deadline to pay tax that may be owed.

This is a standalone extension service. You may use any tax professional to prepare the full return.${request.consideringFullPreparation === true ? "\n\nYou asked for tax preparation quote or next-step information. The office will follow up after reviewing the extension request." : ""}

Reference number:
${leadId}

Please do not email Social Security numbers, tax documents, bank information, or passwords. Use the secure client portal when documents are requested.

Thank you,

Greatest Business Solution LLC`
      });

      emailSent = true;
    } catch (emailErr) {
      emailError =
        emailErr?.message ||
        "Confirmation email failed.";

      console.error(
        "[extension request] Confirmation email failed:",
        leadId,
        emailError
      );
    }

    return res.status(201).json({
      ok: true,
      leadId,
      checkoutEligible,
      deadlineReviewRequired:
        !checkoutEligible,
      totalPrice,
      emailSent,
      emailError:
        emailSent
          ? null
          : emailError
    });
  } catch (error) {
    console.error(
      "[extension request] Save failed:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      errors: [
        "Could not save the Tax Extension request. Please try again."
      ]
    });
  }
});

// =============================================================================
// TAX SAVINGS PLANNER CRM SYNCHRONIZATION
// The primary route keeps the existing URL. The alias route provides a stable
// fallback for environments that do not resolve the parameterized route.
// If an existing Supabase/local record cannot be updated, a minimal local
// overlay preserves the Planner summary without overwriting unrelated lead data.
// The Recommendation Engine remains the single source of recommendation logic.
// =============================================================================

function savePlannerLocalOverlay(leadId, plannerRecord, syncedAt) {
  const cleanId = String(leadId || "").trim();

  const matchesLeadId = (lead = {}) => {
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

    return possibleIds.some(
      (id) => String(id || "").trim() === cleanId
    );
  };

  const localLeads = readLeads();
  const localIndex = localLeads.findIndex(matchesLeadId);

  if (localIndex >= 0) {
    localLeads[localIndex] = {
      ...localLeads[localIndex],
      taxSavingsPlanner: plannerRecord,
      updatedAt: syncedAt
    };
  } else {
    // This is intentionally a minimal overlay. When the same lead already
    // exists in Supabase, /api/leads merges this Planner data into that record
    // without replacing the client's existing status, contact, or tax data.
    localLeads.push({
      leadId: cleanId,
      taxSavingsPlanner: plannerRecord,
      updatedAt: syncedAt
    });
  }

  writeLeads(localLeads);

  return {
    ok: true,
    source: localIndex >= 0
      ? "local"
      : "local-overlay"
  };
}

async function handleTaxSavingsPlannerSync(req, res) {
  const payload = req.body && typeof req.body === "object"
    ? req.body
    : {};

  const cleanId = String(
    req.params?.leadId ||
    payload.leadId ||
    ""
  ).trim();

  const now = new Date().toISOString();

  if (!cleanId || cleanId === "general") {
    return res.status(400).json({
      ok: false,
      error: "A valid client lead ID is required for Planner synchronization."
    });
  }

  let payloadSize = 0;

  try {
    payloadSize = Buffer.byteLength(
      JSON.stringify(payload),
      "utf8"
    );
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: "The Planner synchronization payload is not valid JSON."
    });
  }

  if (payloadSize > 750000) {
    return res.status(413).json({
      ok: false,
      error: "The Planner synchronization payload is too large."
    });
  }

  const asObject = (value) => (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value
      : {}
  );

  const asNumber = (value) => {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  };

  const incomingSummary = asObject(payload.summary);

  const taxYear = /^\d{4}$/.test(
    String(payload.taxYear || "")
  )
    ? String(payload.taxYear)
    : "";

  const plannerRecord = {
    version: 1,
    engineVersion: String(
      payload.engineVersion || ""
    ).slice(0, 30),
    syncedAt: now,
    source: "Tax Savings Planner",
    taxYear,
    plannerState: asObject(payload.plannerState),
    professionalNotes: String(
      payload.professionalNotes || ""
    ).slice(0, 12000),
    opportunityScorecardRecords: asObject(
      payload.opportunityScorecardRecords
    ),
    yearEndChecklistRecords: asObject(
      payload.yearEndChecklistRecords
    ),
    taxHealthHistory: Array.isArray(
      payload.taxHealthHistory
    )
      ? payload.taxHealthHistory.slice(-36)
      : [],
    executiveReport: asObject(payload.executiveReport),
    summary: {
      clientName: String(
        incomingSummary.clientName || ""
      ).slice(0, 160),
      taxHealthScore: asNumber(
        incomingSummary.taxHealthScore
      ),
      attainableScore: asNumber(
        incomingSummary.attainableScore
      ),
      nextMilestone: asNumber(
        incomingSummary.nextMilestone
      ),
      urgentCount: asNumber(
        incomingSummary.urgentCount
      ),
      highPriorityCount: asNumber(
        incomingSummary.highPriorityCount
      ),
      opportunityCount: asNumber(
        incomingSummary.opportunityCount
      ),
      potentialCount: asNumber(
        incomingSummary.potentialCount
      ),
      underReviewCount: asNumber(
        incomingSummary.underReviewCount
      ),
      clientActionCount: asNumber(
        incomingSummary.clientActionCount
      ),
      verifiedCount: asNumber(
        incomingSummary.verifiedCount
      ),
      completedCount: asNumber(
        incomingSummary.completedCount
      ),
      potentialBenefit: asNumber(
        incomingSummary.potentialBenefit
      ),
      verifiedBenefit: asNumber(
        incomingSummary.verifiedBenefit
      ),
      businessDetected: Boolean(
        incomingSummary.businessDetected
      ),
      currentRoadmapPhase: String(
        incomingSummary.currentRoadmapPhase || ""
      ).slice(0, 160),
      roadmapProgress: asNumber(
        incomingSummary.roadmapProgress
      ),
      nextAction: String(
        incomingSummary.nextAction || ""
      ).slice(0, 500),
      reportGeneratedAt: String(
        incomingSummary.reportGeneratedAt || ""
      ).slice(0, 60),
      plannerStatus: String(
        incomingSummary.plannerStatus || ""
      ).slice(0, 160)
    }
  };

  try {
    const primaryUpdate =
      await updateLeadAfterStripePayment(
        cleanId,
        (record = {}) => ({
          ...record,
          taxSavingsPlanner: plannerRecord,
          updatedAt: now
        })
      );

    if (!primaryUpdate.ok) {
      console.warn(
        "[tax-savings-planner sync] Existing lead update was unavailable. Preserving the Planner through the local CRM overlay.",
        {
          leadId: cleanId,
          reason:
            primaryUpdate.error ||
            "Existing lead record was not found."
        }
      );
    }

    // Keep a current local overlay even when Supabase updates successfully.
    // /api/leads merges this minimal record by lead ID, which guarantees that
    // the CRM summary is visible without replacing unrelated client fields.
    const overlayUpdate = savePlannerLocalOverlay(
      cleanId,
      plannerRecord,
      now
    );

    const syncSource = primaryUpdate.ok
      ? `${primaryUpdate.source}+${overlayUpdate.source}`
      : overlayUpdate.source;

    return res.status(200).json({
      ok: true,
      source: syncSource,
      leadId: cleanId,
      syncedAt: now,
      summary: plannerRecord.summary
    });
  } catch (error) {
    console.error(
      "[tax-savings-planner sync] Failed:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      error:
        "The Planner could not be synchronized with the Tax Lead Center."
    });
  }
}

app.get("/api/tax-savings-planner-sync/health", (req, res) => {
  return res.status(200).json({
    ok: true,
    route: "tax-savings-planner-sync",
    version: "1.0.5"
  });
});

app.post(
  "/api/tax-savings-planner/:leadId/sync",
  handleTaxSavingsPlannerSync
);

app.post(
  "/api/tax-savings-planner-sync",
  handleTaxSavingsPlannerSync
);


// =============================================================================
// SECURE CLIENT PORTAL + DOCUMENT CENTER ROUTES
// Activation requires the lead reference number and exact email on the client
// record. Document files are stored outside the public UI and can be listed or
// downloaded only through an authenticated portal session.
// =============================================================================

app.get("/client-portal", (req, res) => {
  setClientPortalNoStore(res);
  res.sendFile(
    path.join(__dirname, "ui", "client-portal.html")
  );
});

app.get(
  "/client-portal/home",
  requireClientPortalPageSession,
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "private-ui",
        "client-portal-home.html"
      )
    );
  }
);

app.get(
  "/client-portal/planner",
  requireClientPortalPageSession,
  async (req, res) => {
    const leadId = String(
      req.query?.leadId || ""
    ).trim();

    const allowed =
      await clientPortalSessionCanAccessLead(
        req.clientPortalSession,
        leadId
      );

    if (!allowed) {
      return res.status(403).send(
        "This tax-planning record is not available in your portal."
      );
    }

    res.sendFile(
      path.join(
        __dirname,
        "ui",
        "tax-savings-planner.html"
      )
    );
  }
);

app.get(
  "/client-portal/report",
  requireClientPortalPageSession,
  async (req, res) => {
    const leadId = String(
      req.query?.leadId || ""
    ).trim();

    const allowed =
      await clientPortalSessionCanAccessLead(
        req.clientPortalSession,
        leadId
      );

    if (!allowed) {
      return res.status(403).send(
        "This tax-planning report is not available in your portal."
      );
    }

    res.sendFile(
      path.join(
        __dirname,
        "ui",
        "tax-planning-report.html"
      )
    );
  }
);


app.get(
  "/office-document-review/sign-in",
  (req, res) => {
    setClientPortalNoStore(res);

    if (
      officeDocumentReviewLocalBypass()
    ) {
      return res.redirect(
        getSafeOfficeDocumentReviewRedirect(
          req.query?.next
        )
      );
    }

    return res.sendFile(
      path.join(
        __dirname,
        "ui",
        "office-document-review-login.html"
      )
    );
  }
);

app.get(
  "/office-document-review",
  requireOfficeDocumentReviewPage,
  (req, res) => {
    setClientPortalNoStore(res);

    return res.sendFile(
      path.join(
        __dirname,
        "private-ui",
        "office-document-review.html"
      )
    );
  }
);

app.post(
  "/api/office-document-review/sign-in",
  (req, res) => {
    setClientPortalNoStore(res);

    const redirectTo =
      getSafeOfficeDocumentReviewRedirect(
        req.body?.next
      );

    if (
      officeDocumentReviewLocalBypass()
    ) {
      return res.status(200).json({
        ok: true,
        redirectTo,
        mode:
          "local-development-bypass"
      });
    }

    if (
      CLIENT_PORTAL_PRODUCTION_HOST &&
      (
        !OFFICE_DOCUMENT_REVIEW_KEY_READY ||
        !OFFICE_DOCUMENT_REVIEW_SESSION_SECRET_READY
      )
    ) {
      return res.status(503).json({
        ok: false,
        error:
          "Secure office review access is not configured. Add the office access key and office session secret."
      });
    }

    if (
      !officeDocumentReviewKeyMatches(
        req.body?.accessKey
      )
    ) {
      return res.status(401).json({
        ok: false,
        error:
          "The office review access key is incorrect."
      });
    }

    setOfficeDocumentReviewCookie(
      res,
      createOfficeDocumentReviewToken()
    );

    return res.status(200).json({
      ok: true,
      redirectTo,
      mode:
        "signed-office-session"
    });
  }
);

app.post(
  "/api/office-document-review/sign-out",
  (req, res) => {
    setClientPortalNoStore(res);
    clearOfficeDocumentReviewCookie(
      res
    );

    return res.status(200).json({
      ok: true,
      redirectTo:
        "/office-document-review/sign-in"
    });
  }
);

app.get("/health", (req, res) => {
  return res.status(200).json({
    ok: true,
    service:
      "Greatest Business Solution LLC Tax Estimator",
    timestamp:
      new Date().toISOString()
  });
});

app.use(
  "/api/client-portal",
  (req, res, next) => {
    if (
      req.method === "GET" &&
      req.path === "/health"
    ) {
      return next();
    }

    return requireClientPortalProductionConfiguration(
      req,
      res,
      next
    );
  }
);

app.get("/api/client-portal/health", async (req, res) => {
  setClientPortalNoStore(res);

  const productionReadiness =
    await getPortalProductionReadiness();

  return res.status(200).json({
    ok: true,
    module: "Secure Client Portal + Document Center",
    version: "1.4.0",
    sessionCookie: "HttpOnly / SameSite=Lax",
    persistentSessionSecretConfigured: Boolean(
      process.env.CLIENT_PORTAL_SESSION_SECRET
    ),
    credentialStorageMode: clientPortalStore.mode,
    liveCredentialStorageReady:
      clientPortalStore.isLiveReady(),
    emailDeliveryConfigured: Boolean(
      EMAIL_USER && EMAIL_APP_PASSWORD
    ),
    documentUploadsEnabled:
      clientDocumentStore.isAvailable(),
    documentStorageMode:
      clientDocumentStore.mode,
    liveDocumentStorageReady:
      clientDocumentStore.isLiveReady(),
    documentBucket:
      CLIENT_DOCUMENTS_BUCKET,
    productionHost:
      productionReadiness.productionHost,
    livePortalReady:
      productionReadiness.livePortalReady,
    productionBlockerCount:
      productionReadiness.blockers.length
  });
});

app.post(
  "/api/client-portal/request-activation",
  async (req, res) => {
    setClientPortalNoStore(res);

    const leadId = String(
      req.body?.leadId || ""
    ).trim();

    const email = normalizeEmail(
      req.body?.email || ""
    );

    const rateKey = clientPortalRateLimitKey(
      req,
      "activation-request",
      `${leadId}:${email}`
    );

    const rate = consumeClientPortalAttempt(
      rateKey,
      {
        limit: 5,
        windowMs: 15 * 60 * 1000
      }
    );

    if (!rate.allowed) {
      return res.status(429).json({
        ok: false,
        error:
          "Too many activation requests. Please wait 15 minutes and try again."
      });
    }

    if (
      !leadId ||
      !email ||
      !/^\S+@\S+\.\S+$/.test(email)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter your email address and client reference number."
      });
    }

    if (!clientPortalStore.isAvailable()) {
      return res.status(503).json({
        ok: false,
        error:
          "Secure portal credential storage is not configured yet. Please contact Greatest Business Solution LLC."
      });
    }

    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      return res.status(503).json({
        ok: false,
        error:
          "Secure portal email delivery is not configured yet. Please contact Greatest Business Solution LLC."
      });
    }

    const candidate =
      await findClientPortalLeadById(leadId);

    const detailsMatch = Boolean(
      candidate &&
      getLeadEmailValue(candidate.raw) === email
    );

    if (!detailsMatch) {
      return res.status(200).json({
        ok: true,
        message:
          "If the information matches our records, a six-digit security code will be sent to the email address on file."
      });
    }

    const code =
      clientPortalSecurity.generateActivationCode();

    const codeRecord =
      clientPortalSecurity.hashActivationCode(code);

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() +
      (CLIENT_PORTAL_ACTIVATION_MINUTES * 60 * 1000)
    ).toISOString();

    const currentAccount =
      await clientPortalStore.getByLeadId(leadId) || {};

    const accountUpdate =
      await clientPortalStore.upsert({
        ...currentAccount,
        leadId,
        version: 1,
        status:
          currentAccount.status === "active"
            ? "active"
            : "pending-activation",
        portalId:
          currentAccount.portalId ||
          require("crypto").randomUUID(),
        email,
        setupRequestedAt: now.toISOString(),
        activation: {
          hash: codeRecord.hash,
          salt: codeRecord.salt,
          expiresAt,
          attempts: 0,
          requestedAt: now.toISOString()
        }
      });

    if (!accountUpdate.ok) {
      console.error(
        "[client portal] Credential store update failed:",
        accountUpdate.error
      );

      return res.status(503).json({
        ok: false,
        error:
          "The secure portal invitation could not be prepared."
      });
    }

    await updateClientPortalLeadStatus(
      leadId,
      (current = {}) => ({
        ...current,
        version: 1,
        status:
          accountUpdate.record.status,
        email,
        sourceLeadId: leadId,
        setupRequestedAt: now.toISOString()
      })
    );

    const clientName = getLeadNameValue(
      candidate.raw
    );

    const activationUrl =
      String(APP_BASE_URL || "")
        .replace(/\/+$/, "") +
      "/client-portal?activate=1&leadId=" +
      encodeURIComponent(leadId);

    try {
      await transporter.sendMail({
        from: EMAIL_USER,
        to: email,
        subject:
          "Your Tax Savings Planner Secure Portal Code",
        text:
`Hello ${clientName},

Your six-digit secure portal code is:

${code}

This code expires in ${CLIENT_PORTAL_ACTIVATION_MINUTES} minutes.

Your portal username is:
${email}

Open your secure portal:
${activationUrl}

Enter your client reference number:
${leadId}

For your protection, your password is never included in email. Do not email Social Security numbers, tax documents, passwords, or this security code.

Thank you,
Greatest Business Solution LLC`
      });
    } catch (error) {
      console.error(
        "[client portal] Activation email failed:",
        error.message || error
      );

      return res.status(503).json({
        ok: false,
        error:
          "The security code could not be emailed. Please contact Greatest Business Solution LLC."
      });
    }

    clearClientPortalAttempts(rateKey);

    return res.status(200).json({
      ok: true,
      message:
        "A six-digit security code was sent to the email address on file. It expires in 15 minutes."
    });
  }
);

app.post(
  "/api/client-portal/activate",
  async (req, res) => {
    setClientPortalNoStore(res);

    const leadId = String(
      req.body?.leadId || ""
    ).trim();

    const email = normalizeEmail(
      req.body?.email || ""
    );

    const code = String(
      req.body?.code || ""
    ).replace(/\D/g, "").slice(0, 6);

    const password = String(
      req.body?.password || ""
    );

    const rateKey = clientPortalRateLimitKey(
      req,
      "activation-verify",
      `${leadId}:${email}`
    );

    const rate = consumeClientPortalAttempt(
      rateKey,
      {
        limit: 7,
        windowMs: 15 * 60 * 1000
      }
    );

    if (!rate.allowed) {
      return res.status(429).json({
        ok: false,
        error:
          "Too many code attempts. Request a new code after 15 minutes."
      });
    }

    const policy =
      clientPortalSecurity.passwordPolicy(password);

    if (
      !leadId ||
      !email ||
      code.length !== 6 ||
      !policy.ok
    ) {
      return res.status(400).json({
        ok: false,
        error:
          policy.ok
            ? "Enter the complete six-digit code."
            : policy.errors.join(" ")
      });
    }

    const candidate =
      await findClientPortalLeadById(leadId);

    const portal =
      await clientPortalStore.getByLeadId(leadId) || {};
    const activation = portal.activation || {};

    const matches = Boolean(
      candidate &&
      getLeadEmailValue(candidate.raw) === email &&
      normalizeEmail(portal.email) === email &&
      activation.hash &&
      activation.salt &&
      Date.parse(activation.expiresAt || "") > Date.now() &&
      Number(activation.attempts || 0) < 7 &&
      clientPortalSecurity.verifyActivationCode(
        code,
        activation
      )
    );

    if (!matches) {
      if (candidate && portal.portalId) {
        await clientPortalStore.upsert({
          ...portal,
          leadId,
          activation: {
            ...(portal.activation || {}),
            attempts:
              Number(
                portal.activation?.attempts || 0
              ) + 1
          }
        });
      }

      return res.status(400).json({
        ok: false,
        error:
          "The security code is invalid or expired. Request a new code and try again."
      });
    }

    const passwordRecord =
      clientPortalSecurity.hashPassword(password);

    const now = new Date().toISOString();

    const accountUpdate =
      await clientPortalStore.upsert({
        ...portal,
        leadId,
        version: 1,
        status: "active",
        email,
        passwordAlgorithm:
          passwordRecord.algorithm,
        passwordIterations:
          passwordRecord.iterations,
        passwordSalt:
          passwordRecord.salt,
        passwordHash:
          passwordRecord.hash,
        sessionVersion:
          Number(portal.sessionVersion || 0) + 1,
        activatedAt:
          portal.activatedAt || now,
        passwordUpdatedAt: now,
        lastLoginAt: now,
        lastActivityAt: now,
        activation: null
      });

    if (!accountUpdate.ok) {
      return res.status(500).json({
        ok: false,
        error:
          "Your secure portal access could not be activated."
      });
    }

    await updateClientPortalLeadStatus(
      leadId,
      (current = {}) => ({
        ...current,
        version: 1,
        status: "active",
        email,
        sourceLeadId: leadId,
        activatedAt:
          current.activatedAt || now,
        lastLoginAt: now,
        lastActivityAt: now
      })
    );

    setClientPortalSessionCookie(
      req,
      res,
      {
        accountLeadId: leadId,
        portalId: accountUpdate.record.portalId,
        email,
        sessionVersion:
          Number(accountUpdate.record.sessionVersion || 1)
      }
    );

    clearClientPortalAttempts(rateKey);

    void sendClientPortalAccountEmail({
      to: email,
      clientName: getLeadNameValue(
        candidate.raw
      ),
      leadId,
      subject:
        "Your Secure Tax Portal Is Active",
      headline:
        "Your Secure Client Portal is active.",
      message:
        "Your password was created or updated successfully. Your tax-service records, planning records, and secure documents remain connected to your client profile."
    });

    console.log(
      "[client portal] Activation completed and secure session issued:",
      leadId
    );

    return res.status(200).json({
      ok: true,
      message:
        "Your secure portal is active. A confirmation email with your username was sent. Your password is never emailed.",
      redirect: "/client-portal/home"
    });
  }
);

app.post(
  "/api/client-portal/login",
  async (req, res) => {
    setClientPortalNoStore(res);

    const email = normalizeEmail(
      req.body?.email || ""
    );

    const password = String(
      req.body?.password || ""
    );

    const rateKey = clientPortalRateLimitKey(
      req,
      "login",
      email
    );

    const rate = consumeClientPortalAttempt(
      rateKey,
      {
        limit: 5,
        windowMs: 15 * 60 * 1000
      }
    );

    if (!rate.allowed) {
      return res.status(429).json({
        ok: false,
        error:
          "Too many sign-in attempts. Please wait 15 minutes and try again."
      });
    }

    if (
      !email ||
      !password ||
      !/^\S+@\S+\.\S+$/.test(email)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter your email address and password."
      });
    }

    const account =
      await findActiveClientPortalAccountByEmail(email);

    const portal = account || {};

    const valid = Boolean(
      account &&
      clientPortalSecurity.verifyPassword(
        password,
        {
          hash: portal.passwordHash,
          salt: portal.passwordSalt,
          iterations: portal.passwordIterations
        }
      )
    );

    if (!valid) {
      return res.status(401).json({
        ok: false,
        error:
          "The email address or password is not correct."
      });
    }

    const now = new Date().toISOString();

    const accountUpdate =
      await clientPortalStore.upsert({
        ...portal,
        lastLoginAt: now,
        lastActivityAt: now
      });

    if (!accountUpdate.ok) {
      return res.status(500).json({
        ok: false,
        error:
          "Your secure portal session could not be started."
      });
    }

    const currentPortal = accountUpdate.record;

    await updateClientPortalLeadStatus(
      account.leadId,
      (current = {}) => ({
        ...current,
        status: "active",
        email,
        sourceLeadId: account.leadId,
        activatedAt:
          current.activatedAt ||
          currentPortal.activatedAt || "",
        lastLoginAt: now,
        lastActivityAt: now
      })
    );

    setClientPortalSessionCookie(
      req,
      res,
      {
        accountLeadId: account.leadId,
        portalId: currentPortal.portalId,
        email,
        sessionVersion:
          Number(currentPortal.sessionVersion || 1)
      }
    );

    clearClientPortalAttempts(rateKey);

    return res.status(200).json({
      ok: true,
      message: "Signed in securely.",
      redirect: "/client-portal/home"
    });
  }
);

app.post(
  "/api/client-portal/change-password",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    const session = req.clientPortalSession;
    const currentPassword = String(
      req.body?.currentPassword || ""
    );
    const newPassword = String(
      req.body?.newPassword || ""
    );

    const policy =
      clientPortalSecurity.passwordPolicy(
        newPassword
      );

    if (!currentPassword) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter your current password."
      });
    }

    if (!policy.ok) {
      return res.status(400).json({
        ok: false,
        error: policy.errors.join(" ")
      });
    }

    const portal =
      await clientPortalStore.getByLeadId(
        session.payload.accountLeadId
      );

    if (!portal) {
      return res.status(404).json({
        ok: false,
        error:
          "Your secure portal account could not be found."
      });
    }

    const currentIsValid =
      clientPortalSecurity.verifyPassword(
        currentPassword,
        {
          hash: portal.passwordHash,
          salt: portal.passwordSalt,
          iterations:
            portal.passwordIterations
        }
      );

    if (!currentIsValid) {
      return res.status(401).json({
        ok: false,
        error:
          "Your current password is not correct."
      });
    }

    const samePassword =
      clientPortalSecurity.verifyPassword(
        newPassword,
        {
          hash: portal.passwordHash,
          salt: portal.passwordSalt,
          iterations:
            portal.passwordIterations
        }
      );

    if (samePassword) {
      return res.status(400).json({
        ok: false,
        error:
          "Choose a new password that is different from your current password."
      });
    }

    const passwordRecord =
      clientPortalSecurity.hashPassword(
        newPassword
      );

    const now = new Date().toISOString();

    const accountUpdate =
      await clientPortalStore.upsert({
        ...portal,
        passwordAlgorithm:
          passwordRecord.algorithm,
        passwordIterations:
          passwordRecord.iterations,
        passwordSalt:
          passwordRecord.salt,
        passwordHash:
          passwordRecord.hash,
        sessionVersion:
          Number(
            portal.sessionVersion || 0
          ) + 1,
        passwordUpdatedAt: now,
        lastActivityAt: now
      });

    if (!accountUpdate.ok) {
      return res.status(500).json({
        ok: false,
        error:
          "Your password could not be changed."
      });
    }

    const updatedPortal =
      accountUpdate.record;

    setClientPortalSessionCookie(
      req,
      res,
      {
        accountLeadId:
          updatedPortal.leadId,
        portalId:
          updatedPortal.portalId,
        email:
          updatedPortal.email,
        sessionVersion:
          Number(
            updatedPortal.sessionVersion || 1
          )
      }
    );

    void updateClientPortalLeadStatus(
      updatedPortal.leadId,
      (current = {}) => ({
        ...current,
        status: "active",
        email:
          updatedPortal.email,
        sourceLeadId:
          updatedPortal.leadId,
        passwordUpdatedAt: now,
        lastActivityAt: now
      })
    );

    void sendClientPortalAccountEmail({
      to:
        updatedPortal.email,
      clientName:
        "Client",
      leadId:
        updatedPortal.leadId,
      subject:
        "Your Secure Tax Portal Password Was Changed",
      headline:
        "Your secure portal password was changed successfully.",
      message:
        "Your username and all saved Planner data, reports, tax-year records, and future document history remain connected to the same client profile."
    });

    return res.status(200).json({
      ok: true,
      message:
        "Your password was changed. Your saved portal data remains connected to your profile.",
      passwordUpdatedAt: now
    });
  }
);

app.post(
  "/api/client-portal/logout",
  (req, res) => {
    setClientPortalNoStore(res);
    clearClientPortalSessionCookie(req, res);

    return res.status(200).json({
      ok: true,
      redirect: "/client-portal"
    });
  }
);

app.get(
  "/api/client-portal/session",
  requireClientPortalApiSession,
  async (req, res) => {
    const session = req.clientPortalSession;
    const accessible =
      await getClientPortalAccessibleLeads(
        session.email
      );

    const records = accessible
      .map(buildClientPortalLeadSummary)
      .sort(
        (left, right) =>
          getClientPortalRecordSortTime(right) -
          getClientPortalRecordSortTime(left)
      );

    const recordOrganization =
      buildClientPortalRecordGroups(records);

    const primary =
      accessible.find(
        (entry) =>
          entry.leadId ===
          session.payload.accountLeadId
      ) || accessible[0];

    const documentCenter =
      await getClientPortalDocumentCenterState(
        session
      );

    const accountLeadId =
      String(
        session.payload.accountLeadId ||
        ""
      );

    const taxPreparationRequests =
      accessible
        .map(
          buildClientPortalTaxPreparationSummary
        )
        .filter(Boolean)
        .sort(
          (left, right) =>
            Date.parse(
              right.updatedAt || 0
            ) -
            Date.parse(
              left.updatedAt || 0
            )
        );

    const contractor1099Requests =
      accessible
        .map(
          buildClientPortalContractor1099Summary
        )
        .filter(Boolean)
        .sort(
          (left, right) =>
            Date.parse(
              right.updatedAt || 0
            ) -
            Date.parse(
              left.updatedAt || 0
            )
        );

    const extensionRequests =
      accessible
        .map(
          buildClientPortalExtensionSummary
        )
        .filter(Boolean)
        .sort(
          (left, right) =>
            Date.parse(
              right.updatedAt || 0
            ) -
            Date.parse(
              left.updatedAt || 0
            )
        );

    const taxWatch =
      buildClientPortalTaxWatchSummary(
        accessible,
        accountLeadId
      );

    const transcriptRequests =
      accessible
        .map(
          buildClientPortalTranscriptRequestSummary
        )
        .filter(Boolean)
        .sort(
          (left, right) => {
            const leftPrimary =
              left.leadId === accountLeadId
                ? 1
                : 0;

            const rightPrimary =
              right.leadId === accountLeadId
                ? 1
                : 0;

            if (
              leftPrimary !== rightPrimary
            ) {
              return (
                rightPrimary -
                leftPrimary
              );
            }

            return (
              Date.parse(
                right.updatedAt || 0
              ) -
              Date.parse(
                left.updatedAt || 0
              )
            );
          }
        );

    return res.status(200).json({
      ok: true,
      portal: {
        version: "1.6.0",
        status: "active",
        clientName:
          primary
            ? getLeadNameValue(primary.raw)
            : "Client",
        username: session.email,
        email: session.email,
        activatedAt:
          session.portal.activatedAt || "",
        lastLoginAt:
          session.portal.lastLoginAt || "",
        passwordUpdatedAt:
          session.portal.passwordUpdatedAt || "",
        planningYear: "2026",
        records:
          recordOrganization.visibleRecordGroups,
        olderRecords:
          recordOrganization.olderRecordGroups,
        serviceHistory:
          recordOrganization.serviceHistory,
        generalRequestCount:
          recordOrganization.generalRequestCount,
        totalTaxYearGroups:
          recordOrganization.totalTaxYearGroups,
        totalRawRecords:
          recordOrganization.totalRawRecords,
        visibleYearLimit:
          recordOrganization.visibleYearLimit,
        taxPreparationRequests,
        contractor1099Requests,
        extensionRequests,
        transcriptRequests,
        taxWatch,
        documentCenter
      }
    });
  }
);


app.post(
  "/api/client-portal/tax-watch",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    const allowedObjectives = new Set([
      "avoid_owing",
      "target_refund",
      "increase_take_home",
      "self_employment",
      "quarterly_payments",
      "track_changes"
    ]);

    const objective = String(
      req.body?.objective || "track_changes"
    ).trim();

    if (!allowedObjectives.has(objective)) {
      return res.status(400).json({
        ok: false,
        error:
          "Choose one of the available Tax Watch Pro objectives."
      });
    }

    const targetAmount = Math.max(
      0,
      getTaxWatchNumber(req.body?.targetAmount)
    );

    const session = req.clientPortalSession;
    const accessible =
      await getClientPortalAccessibleLeads(
        session.email
      );

    const currentSummary =
      buildClientPortalTaxWatchSummary(
        accessible,
        session.payload.accountLeadId
      );

    if (!currentSummary.current) {
      return res.status(409).json({
        ok: false,
        error:
          "Complete the Free Tax Estimator with this portal email before starting Tax Watch Pro."
      });
    }

    if (currentSummary.active && !currentSummary.canEdit) {
      return res.status(403).json({
        ok: false,
        error:
          "Your Tax Watch Pro preview has ended. Choose a monthly or annual plan to resume Tax Money Tracker updates."
      });
    }

    const targetLeadId = String(
      currentSummary.profileLeadId ||
      session.payload.accountLeadId ||
      currentSummary.current.leadId ||
      ""
    ).trim();

    if (!targetLeadId) {
      return res.status(409).json({
        ok: false,
        error:
          "A portal record could not be selected for Tax Watch Pro."
      });
    }

    const now = new Date().toISOString();
    const updateResult =
      await updateLeadAfterStripePayment(
        targetLeadId,
        (record = {}) => {
          const existing =
            record.taxWatchProfile &&
            typeof record.taxWatchProfile === "object" &&
            !Array.isArray(record.taxWatchProfile)
              ? record.taxWatchProfile
              : {};

          const previewStartedAt = String(
            existing.previewStartedAt ||
            existing.activatedAt ||
            now
          );
          const previewStartedAtMs = Date.parse(previewStartedAt);
          const previewEndsAt = String(
            existing.previewEndsAt ||
            new Date(
              (Number.isFinite(previewStartedAtMs)
                ? previewStartedAtMs
                : Date.now()) +
              TAX_WATCH_PREVIEW_MILLISECONDS
            ).toISOString()
          );

          return {
            ...record,
            taxWatchProfile: {
              ...existing,
              version: 1,
              planName: "Tax Watch Pro",
              status: "preview",
              objective,
              targetAmount:
                objective === "target_refund"
                  ? targetAmount
                  : 0,
              baselineLeadId:
                existing.baselineLeadId ||
                currentSummary.current.leadId,
              baselineSnapshot:
                existing.baselineSnapshot ||
                currentSummary.current,
              activatedAt:
                existing.activatedAt || now,
              previewStartedAt,
              previewEndsAt,
              updatedAt: now
            },
            updatedAt: now
          };
        }
      );

    if (!updateResult.ok) {
      return res.status(500).json({
        ok: false,
        error:
          updateResult.error ||
          "Tax Watch Pro could not be saved."
      });
    }

    const refreshedAccessible =
      await getClientPortalAccessibleLeads(
        session.email
      );

    return res.status(200).json({
      ok: true,
      message:
        currentSummary.active
          ? "Your Tax Watch Pro objective was updated."
          : "Your Tax Watch Pro preview is ready.",
      taxWatch:
        buildClientPortalTaxWatchSummary(
          refreshedAccessible,
          session.payload.accountLeadId
        )
    });
  }
);



app.post(
  "/api/client-portal/tax-watch/savings",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    const amount = Math.max(
      0,
      getTaxWatchNumber(req.body?.amount)
    );

    const note = String(
      req.body?.note || ""
    ).trim().slice(0, 200);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter the amount you reported moving into tax savings."
      });
    }

    if (amount > 1000000) {
      return res.status(400).json({
        ok: false,
        error:
          "The savings entry is larger than the supported limit."
      });
    }

    const session = req.clientPortalSession;
    const accessible =
      await getClientPortalAccessibleLeads(
        session.email
      );

    const summary =
      buildClientPortalTaxWatchSummary(
        accessible,
        session.payload.accountLeadId
      );

    if (!summary.current) {
      return res.status(409).json({
        ok: false,
        error:
          "A saved Tax Watch estimate is required before adding tax savings."
      });
    }

    if (summary.active && !summary.canEdit) {
      return res.status(403).json({
        ok: false,
        error:
          "Your Tax Watch Pro preview has ended. Choose a monthly or annual plan to add new savings entries."
      });
    }

    const targetLeadId = String(
      session.payload.accountLeadId ||
      summary.profileLeadId ||
      summary.current.leadId ||
      ""
    ).trim();

    if (!targetLeadId) {
      return res.status(409).json({
        ok: false,
        error:
          "Your portal savings record could not be selected."
      });
    }

    const now = new Date().toISOString();
    const roundedAmount =
      Math.round(amount * 100) / 100;
    const estimatedTaxMoneyNeededAtEntry =
      Math.max(
        0,
        getTaxWatchNumber(
          summary.moneyTracker
            ?.estimatedTaxMoneyNeeded
        )
      );
    const savedBalanceAfterEntry =
      Math.round(
        (
          getTaxWatchNumber(
            summary.moneyTracker
              ?.moneyReportedSaved
          ) +
          roundedAmount
        ) * 100
      ) / 100;
    const amountStillNeededAfterEntry =
      Math.max(
        0,
        Math.round(
          (
            estimatedTaxMoneyNeededAtEntry -
            savedBalanceAfterEntry
          ) * 100
        ) / 100
      );

    const entry = {
      id: `TWS-${Date.now()}-${crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase()}`,
      amount: roundedAmount,
      note,
      recordedAt: now,
      estimatedTaxMoneyNeededAtEntry,
      savedBalanceAfterEntry,
      amountStillNeededAfterEntry
    };

    const updateResult =
      await updateLeadAfterStripePayment(
        targetLeadId,
        (record = {}) => {
          const existing =
            record.taxWatchMoneyTracker &&
            typeof record.taxWatchMoneyTracker === "object" &&
            !Array.isArray(record.taxWatchMoneyTracker)
              ? record.taxWatchMoneyTracker
              : {};

          const entries = Array.isArray(
            existing.entries
          )
            ? existing.entries
            : [];

          return {
            ...record,
            taxWatchMoneyTracker: {
              ...existing,
              version: 2,
              updatedAt: now,
              entries: [
                ...entries,
                entry
              ]
            },
            latestClientAction:
              `Tax savings entry added: ${taxWatchOrganizerMoney(entry.amount)}`,
            latestClientActionAt: now,
            updatedAt: now
          };
        }
      );

    if (!updateResult.ok) {
      return res.status(500).json({
        ok: false,
        error:
          updateResult.error ||
          "The tax savings entry could not be saved."
      });
    }

    const refreshedAccessible =
      await getClientPortalAccessibleLeads(
        session.email
      );

    return res.status(200).json({
      ok: true,
      message:
        "Your reported tax savings entry was added.",
      taxWatch:
        buildClientPortalTaxWatchSummary(
          refreshedAccessible,
          session.payload.accountLeadId
        )
    });
  }
);



function taxWatchOrganizerEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function taxWatchOrganizerMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(getTaxWatchNumber(value));
}

function taxWatchOrganizerLabel(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function getTaxWatchOrganizerSources(snapshot = {}) {
  const streams = Array.isArray(snapshot.selfEmploymentStreams)
    ? snapshot.selfEmploymentStreams.slice(0, 5)
    : [];

  if (!streams.length) {
    return [{
      name: "Gig or Business Income",
      income: getTaxWatchNumber(snapshot.selfEmploymentIncome),
      mileage: 0,
      expenses: [],
      totalExpenses: getTaxWatchNumber(snapshot.businessExpenses)
    }];
  }

  return streams.map((stream = {}, index) => {
    const categoryObjects = [
      stream.expenseCategories,
      stream.categorizedExpenses,
      stream.expensesByCategory,
      stream.businessExpenseCategories
    ].filter(
      (value) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    );

    const merged = Object.assign({}, ...categoryObjects);
    const expenses = Object.entries(merged)
      .map(([key, value]) => ({
        label: taxWatchOrganizerLabel(key),
        amount: getTaxWatchNumber(value)
      }))
      .filter((item) => item.amount > 0);

    const directTotal = getTaxWatchNumber(
      stream.totalExpenses ??
      stream.businessExpenses ??
      stream.expenses ??
      stream.uncategorizedExpenses
    );

    const categorizedTotal = expenses.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    return {
      name: String(
        stream.source ||
        stream.sourceName ||
        stream.businessName ||
        stream.name ||
        `Gig or Business Source ${index + 1}`
      ),
      income: getTaxWatchNumber(
        stream.income ??
        stream.incomeReceived ??
        stream.selfEmploymentIncome ??
        stream.grossIncome
      ),
      mileage: getTaxWatchNumber(
        stream.mileage ??
        stream.businessMileage
      ),
      expenses,
      totalExpenses: Math.max(
        directTotal,
        categorizedTotal
      )
    };
  });
}

function buildTaxWatchOrganizerEmailHtml({
  clientName = "Client",
  snapshot = {},
  sources = []
} = {}) {
  const income = sources.reduce(
    (sum, source) => sum + getTaxWatchNumber(source.income),
    0
  ) || getTaxWatchNumber(snapshot.selfEmploymentIncome);

  const expenses = sources.reduce(
    (sum, source) => sum + getTaxWatchNumber(source.totalExpenses),
    0
  ) || getTaxWatchNumber(snapshot.businessExpenses);

  const sourceSections = sources.map((source, index) => {
    const expenseRows = source.expenses.length
      ? source.expenses.map((item) => `
          <tr>
            <td style="padding:8px;border-bottom:1px solid #dbe5ec">${taxWatchOrganizerEscapeHtml(item.label)}</td>
            <td style="padding:8px;border-bottom:1px solid #dbe5ec;text-align:right">${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(item.amount))}</td>
          </tr>`).join("")
      : `<tr><td colspan="2" style="padding:8px">No categorized expenses entered.</td></tr>`;

    return `
      <h3 style="color:#0f355d;margin:22px 0 8px">${taxWatchOrganizerEscapeHtml(source.name || `Income Source ${index + 1}`)}</h3>
      <p><strong>Income entered:</strong> ${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(source.income))}<br>
      <strong>Total expenses:</strong> ${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(source.totalExpenses))}<br>
      <strong>Business mileage:</strong> ${Math.round(getTaxWatchNumber(source.mileage)).toLocaleString("en-US")} miles</p>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="padding:8px;text-align:left;border-bottom:2px solid #0f355d">Expense category</th><th style="padding:8px;text-align:right;border-bottom:2px solid #0f355d">Amount</th></tr></thead>
        <tbody>${expenseRows}</tbody>
      </table>`;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#17354e;max-width:760px;margin:auto">
      <div style="background:#0f355d;color:white;padding:24px;border-radius:14px">
        <div style="color:#ffd16b;font-weight:700">GREATEST BUSINESS SOLUTION LLC</div>
        <h1 style="margin:8px 0">Business Income and Expense Organizer</h1>
        <p style="margin:0">Prepared from information entered by ${taxWatchOrganizerEscapeHtml(clientName)} through Tax Watch Pro.</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0">
        <div style="background:#eef4f7;padding:14px"><strong>Money earned</strong><br>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(income))}</div>
        <div style="background:#eef4f7;padding:14px"><strong>Business expenses</strong><br>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(expenses))}</div>
        <div style="background:#eef4f7;padding:14px"><strong>Money left after expenses</strong><br>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(income - expenses))}</div>
      </div>
      ${sourceSections}
      <div style="margin-top:24px;padding:16px;background:#fff7df;border-left:5px solid #c6922e">
        <strong>Important:</strong> This organizer summarizes information entered by the client. It is not a completed Schedule C, tax return, or determination that every listed expense is deductible. The receiving tax professional must verify the records and determine the proper tax treatment.
      </div>
    </div>`;
}

function taxWatchOrganizerDateTime(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(parsed));
}

function buildTaxWatchOrganizerHtml({
  clientName = "Client",
  email = "",
  snapshot = {},
  organizer = {},
  sent = false,
  shared = false,
  error = ""
} = {}) {
  const sources = getTaxWatchOrganizerSources(snapshot);
  const income = sources.reduce(
    (sum, source) => sum + getTaxWatchNumber(source.income),
    0
  ) || getTaxWatchNumber(snapshot.selfEmploymentIncome);
  const expenses = sources.reduce(
    (sum, source) => sum + getTaxWatchNumber(source.totalExpenses),
    0
  ) || getTaxWatchNumber(snapshot.businessExpenses);
  const net = income - expenses;
  const estimatedPayments =
    getTaxWatchNumber(snapshot.estimatedTaxPayments);

  const sourceCards = sources.map((source, index) => {
    const rows = source.expenses.length
      ? source.expenses.map((item) => `
          <tr>
            <td>${taxWatchOrganizerEscapeHtml(item.label)}</td>
            <td>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(item.amount))}</td>
          </tr>`).join("")
      : `<tr><td colspan="2">No categorized expenses were entered for this source.</td></tr>`;

    return `
      <section class="source-card">
        <div class="source-heading">
          <div>
            <span>Income source ${index + 1}</span>
            <h2>${taxWatchOrganizerEscapeHtml(source.name)}</h2>
          </div>
          <strong>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(source.income))}</strong>
        </div>
        <div class="source-summary">
          <div><span>Income entered</span><strong>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(source.income))}</strong></div>
          <div><span>Total expenses</span><strong>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(source.totalExpenses))}</strong></div>
          <div><span>Business mileage</span><strong>${Math.round(getTaxWatchNumber(source.mileage)).toLocaleString("en-US")} miles</strong></div>
        </div>
        <h3>Expense organizer</h3>
        <table>
          <thead><tr><th>Expense category</th><th>Amount entered</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join("");

  const alerts = [];
  if (income <= 0) alerts.push("No gig or business income was entered.");
  if (expenses <= 0) alerts.push("No business expenses were entered.");
  if (!sources.some((source) => source.mileage > 0)) {
    alerts.push("No business mileage was entered. Review whether mileage records apply.");
  }
  if (estimatedPayments <= 0 && income > 0) {
    alerts.push("No estimated tax payments were entered.");
  }
  alerts.push("The tax professional preparing the return must verify the tax treatment, documentation, and allowable amount of every expense.");

  const sentBanner = sent
    ? `<div class="success"><strong>Organizer sent.</strong> Greatest Business Solution LLC now has a professional-preparation request connected to this portal record.</div>`
    : "";

  const sharedBanner = shared
    ? `<div class="success">
        <strong>Organizer shared with ${taxWatchOrganizerEscapeHtml(
          organizer.sharedWithName ||
          "your tax professional"
        )}.</strong>
        ${
          organizer.sharedWithEmail
            ? `<br>${taxWatchOrganizerEscapeHtml(
                organizer.sharedWithEmail
              )}`
            : ""
        }
        ${
          organizer.sharedAt
            ? `<br>${taxWatchOrganizerEscapeHtml(
                taxWatchOrganizerDateTime(
                  organizer.sharedAt
                )
              )}`
            : ""
        }
      </div>`
    : "";

  const errorBanner = error
    ? `<div class="error"><strong>The organizer was not shared.</strong> ${taxWatchOrganizerEscapeHtml(error)}</div>`
    : "";

  const statusText =
    organizer.status === "sent-for-professional-preparation"
      ? "Sent to Greatest Business Solution LLC"
      : organizer.status === "shared-with-tax-professional"
        ? "Shared with My Tax Professional"
        : "Ready";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Business Income and Expense Organizer</title>
  <style>
    :root{--navy:#0f355d;--blue:#155b83;--gold:#c6922e;--ink:#17354e;--line:#cbdce7;--soft:#eef4f7;--green:#0c7b58;--red:#8a1c1c}
    *{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--ink);font-family:Arial,sans-serif}
    .page{max-width:1080px;margin:28px auto;padding:0 18px 50px}.hero{background:linear-gradient(135deg,var(--navy),#177c7a);color:#fff;padding:30px;border-radius:22px}
    .hero small{color:#ffd16b;font-weight:800;letter-spacing:.12em}.hero h1{font-size:38px;margin:8px 0}.hero p{font-size:17px;line-height:1.55;max-width:800px}
    .client{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}.client div,.summary div{background:#fff;color:var(--ink);padding:15px;border-radius:12px}
    .client span,.summary span,.source-summary span{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#5d7182;font-weight:800}
    .client strong,.summary strong,.source-summary strong{display:block;font-size:20px;margin-top:5px}
    .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.panel,.source-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin-top:18px;box-shadow:0 10px 30px rgba(20,50,75,.07)}
    .source-heading{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.source-heading span{color:var(--gold);font-weight:800;text-transform:uppercase;font-size:12px}.source-heading h2{margin:6px 0}.source-heading>strong{font-size:26px}
    .source-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:15px 0}.source-summary div{background:#f5f9fb;padding:14px;border-radius:12px}
    table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #dce7ed;text-align:left}th:last-child,td:last-child{text-align:right}
    .notice{border-left:5px solid var(--gold);background:#fff7df}.success{background:#e8f7f1;border:1px solid #9fd7c3;color:#075b40;border-radius:14px;padding:16px;margin:18px 0}.error{background:#fff0f0;border:1px solid #e0aaaa;color:var(--red);border-radius:14px;padding:16px;margin:18px 0}
    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}.actions a,.actions button{border:0;border-radius:11px;padding:13px 17px;font-weight:800;text-decoration:none;cursor:pointer}
    .primary{background:var(--navy);color:#fff}.secondary{background:#fff;color:var(--navy);border:1px solid var(--navy)!important}.gold{background:var(--gold);color:#172f46}
    .share-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.share-grid label{font-weight:800}.share-grid input,.share-grid textarea{width:100%;padding:12px;border:1px solid #b8cbd7;border-radius:9px;margin-top:6px}.share-message{grid-column:1/-1}
    ul{line-height:1.7}@media(max-width:760px){.client,.summary,.source-summary,.share-grid{grid-template-columns:1fr}.hero h1{font-size:29px}.share-message{grid-column:auto}}
    @media print{body{background:#fff}.actions,.share-panel{display:none}.page{margin:0;max-width:none}.panel,.source-card{box-shadow:none;break-inside:avoid}}
  </style>
</head>
<body>
<main class="page">
  <section class="hero">
    <small>GREATEST BUSINESS SOLUTION LLC</small>
    <h1>Business Income and Expense Organizer</h1>
    <p>A plain-language summary of the business information entered through Tax Watch Pro. This is an organizer—not a completed Schedule C or tax return.</p>
    <div class="client">
      <div><span>Client</span><strong>${taxWatchOrganizerEscapeHtml(clientName)}</strong></div>
      <div><span>Tax year</span><strong>${taxWatchOrganizerEscapeHtml(snapshot.taxYear || "Not recorded")}</strong></div>
      <div><span>Organizer status</span><strong>${taxWatchOrganizerEscapeHtml(statusText)}</strong></div>
      <div><span>Portal email</span><strong style="font-size:15px">${taxWatchOrganizerEscapeHtml(email)}</strong></div>
    </div>
  </section>

  ${sentBanner}
  ${sharedBanner}
  ${errorBanner}

  <section class="summary">
    <div><span>Money earned</span><strong>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(income))}</strong></div>
    <div><span>Business expenses</span><strong>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(expenses))}</strong></div>
    <div><span>Money left after expenses</span><strong>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(net))}</strong></div>
    <div><span>Tax payments entered</span><strong>${taxWatchOrganizerEscapeHtml(taxWatchOrganizerMoney(estimatedPayments))}</strong></div>
  </section>

  ${sourceCards}

  <section class="panel notice">
    <h2>Items for Professional Review</h2>
    <ul>${alerts.map((alert) => `<li>${taxWatchOrganizerEscapeHtml(alert)}</li>`).join("")}</ul>
    <p><strong>Important:</strong> This organizer belongs to the client. Greatest Business Solution LLC may prepare the return, or the client may provide this organizer to another qualified tax professional. The tax professional selected by the client must determine the proper tax treatment, allowable amount, return placement, Schedule C preparation, and filing.</p>
  </section>

  <section class="panel">
    <h2>Your Organizer Choices</h2>
    <p>Keep a copy, send it to Greatest Business Solution LLC, or share it with the qualified tax professional of your choice.</p>
    <div class="actions">
      <button class="primary" type="button" onclick="window.print()">Print / Save Organizer</button>
      <form method="post" action="/client-portal/tax-watch/organizer/send" style="display:inline">
        <button class="gold" type="submit">Send to Greatest Business Solution LLC</button>
      </form>
      <a class="secondary" href="/start-my-tax-return?return=tax-watch-pro">Continue to Start My Tax Return</a>
      <a class="secondary" href="/client-portal/home#tax-watch">Return to Tax Watch Pro</a>
    </div>
  </section>

  <section class="panel share-panel">
    <h2>Share With My Tax Professional</h2>
    <p>Enter the qualified tax professional you selected. The system will email a copy of this organizer and will not send Social Security numbers, bank information, tax documents, or portal passwords.</p>
    <form method="post" action="/client-portal/tax-watch/organizer/share">
      <div class="share-grid">
        <label>Tax professional's name
          <input name="professionalName" maxlength="120" required>
        </label>
        <label>Tax professional's email
          <input name="professionalEmail" type="email" maxlength="200" required>
        </label>
        <label class="share-message">Optional message
          <textarea name="message" rows="4" maxlength="800" placeholder="Example: Please use this organizer when preparing my return."></textarea>
        </label>
      </div>
      <div class="actions">
        <button class="primary" type="submit">Email Organizer to My Tax Professional</button>
      </div>
    </form>
  </section>
</main>
</body>
</html>`;
}

async function getLatestTaxWatchOrganizerContext(session) {
  const accessible = await getClientPortalAccessibleLeads(
    session.email
  );

  const candidates = accessible
    .map((entry) => ({
      entry,
      snapshot: getTaxWatchSnapshot(entry)
    }))
    .filter((item) => item.snapshot)
    .sort(
      (left, right) =>
        Date.parse(right.snapshot.recordedAt || 0) -
        Date.parse(left.snapshot.recordedAt || 0)
    );

  const organizerEntry =
    accessible.find(
      (entry) =>
        entry.lead?.taxWatchOrganizer &&
        typeof entry.lead.taxWatchOrganizer === "object" &&
        !Array.isArray(entry.lead.taxWatchOrganizer)
    ) || null;

  return {
    accessible,
    latest: candidates[0] || null,
    organizerEntry
  };
}

function buildTaxWatchOrganizerRecord(snapshot = {}, existing = {}) {
  const now = new Date().toISOString();
  const sources = getTaxWatchOrganizerSources(snapshot);

  return {
    ...existing,
    version: 2,
    status: String(existing.status || "ready"),
    createdAt: String(existing.createdAt || now),
    updatedAt: now,
    taxYear: snapshot.taxYear,
    sourceLeadId: snapshot.leadId,
    sourceCount: sources.length,
    totalIncome: getTaxWatchNumber(snapshot.selfEmploymentIncome),
    totalExpenses: getTaxWatchNumber(snapshot.businessExpenses),
    estimatedTaxPayments: getTaxWatchNumber(
      snapshot.estimatedTaxPayments
    ),
    sources
  };
}

app.get(
  "/client-portal/tax-watch/organizer",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    const session = req.clientPortalSession;
    const { latest, organizerEntry } =
      await getLatestTaxWatchOrganizerContext(session);

    if (!latest) {
      return res.status(409).type("html").send(
        "<h1>Organizer unavailable</h1><p>No saved Tax Watch estimate is connected to this portal.</p><p><a href='/client-portal/home#tax-watch'>Return to Tax Watch Pro</a></p>"
      );
    }

    const existing =
      organizerEntry?.lead?.taxWatchOrganizer &&
      typeof organizerEntry.lead.taxWatchOrganizer === "object"
        ? organizerEntry.lead.taxWatchOrganizer
        : {};

    const organizer =
      Object.keys(existing).length
        ? buildTaxWatchOrganizerRecord(
            latest.snapshot,
            existing
          )
        : {
            version: 2,
            status: "ready",
            createdAt: String(
              latest.snapshot.recordedAt ||
              new Date().toISOString()
            ),
            updatedAt: String(
              latest.snapshot.recordedAt ||
              new Date().toISOString()
            ),
            taxYear: latest.snapshot.taxYear,
            sourceLeadId: latest.snapshot.leadId,
            sourceCount:
              getTaxWatchOrganizerSources(
                latest.snapshot
              ).length
          };

    const lead = latest.entry.lead || {};
    return res.status(200).type("html").send(
      buildTaxWatchOrganizerHtml({
        clientName:
          lead.contact?.name ||
          getLeadNameValue(latest.entry.raw) ||
          "Client",
        email: session.email,
        snapshot: latest.snapshot,
        organizer,
        sent: String(req.query?.sent || "") === "1",
        shared: String(req.query?.shared || "") === "1",
        error: String(req.query?.error || "")
      })
    );
  }
);

app.post(
  "/client-portal/tax-watch/organizer/send",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    const session = req.clientPortalSession;
    const { latest, organizerEntry } =
      await getLatestTaxWatchOrganizerContext(session);

    const organizerRecordLeadId = String(
      session.payload?.accountLeadId ||
      session.accountLead?.leadId ||
      latest?.snapshot?.leadId ||
      ""
    ).trim();

    if (!latest?.snapshot?.leadId || !organizerRecordLeadId) {
      return res.status(409).type("html").send(
        "<h1>Organizer could not be sent</h1><p>No saved Tax Watch estimate is connected to this portal.</p><p><a href='/client-portal/home#tax-watch'>Return to Tax Watch Pro</a></p>"
      );
    }

    const now = new Date().toISOString();
    const existing =
      organizerEntry?.lead?.taxWatchOrganizer &&
      typeof organizerEntry.lead.taxWatchOrganizer === "object"
        ? organizerEntry.lead.taxWatchOrganizer
        : {};

    const priorActivity = Array.isArray(
      existing.activity
    )
      ? existing.activity
      : [];

    const organizer = {
      ...buildTaxWatchOrganizerRecord(
        latest.snapshot,
        existing
      ),
      status: "sent-for-professional-preparation",
      sentAt: now,
      updatedAt: now,
      activity: [
        ...priorActivity,
        {
          type: "sent-to-greatest-business-solution",
          label:
            "Sent to Greatest Business Solution LLC",
          occurredAt: now
        }
      ].slice(-20)
    };

    const result = await updateLeadAfterStripePayment(
      organizerRecordLeadId,
      (record = {}) => ({
        ...record,
        taxWatchOrganizer: organizer,
        latestClientAction:
          "Business organizer sent for professional tax preparation",
        latestClientActionAt: now,
        updatedAt: now
      })
    );

    if (!result.ok) {
      return res.status(500).type("html").send(
        "<h1>Organizer could not be sent</h1><p>Your organizer was not saved. Return to Tax Watch Pro and try again.</p><p><a href='/client-portal/home#tax-watch'>Return to Tax Watch Pro</a></p>"
      );
    }

    return res.redirect(
      303,
      "/client-portal/tax-watch/organizer?sent=1"
    );
  }
);

app.post(
  "/client-portal/tax-watch/organizer/share",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    const professionalName = String(
      req.body?.professionalName || ""
    ).trim();

    const professionalEmail = String(
      req.body?.professionalEmail || ""
    ).trim().toLowerCase();

    const message = String(
      req.body?.message || ""
    ).trim().slice(0, 800);

    if (
      !professionalName ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        professionalEmail
      )
    ) {
      return res.redirect(
        303,
        "/client-portal/tax-watch/organizer?error=" +
        encodeURIComponent(
          "Enter the tax professional's name and a valid email address."
        )
      );
    }

    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      return res.redirect(
        303,
        "/client-portal/tax-watch/organizer?error=" +
        encodeURIComponent(
          "Email delivery is not configured right now. Use Print / Save Organizer and share the saved copy directly."
        )
      );
    }

    const session = req.clientPortalSession;
    const { latest, organizerEntry } =
      await getLatestTaxWatchOrganizerContext(session);

    const organizerRecordLeadId = String(
      session.payload?.accountLeadId ||
      session.accountLead?.leadId ||
      latest?.snapshot?.leadId ||
      ""
    ).trim();

    if (!latest?.snapshot?.leadId || !organizerRecordLeadId) {
      return res.redirect(
        303,
        "/client-portal/tax-watch/organizer?error=" +
        encodeURIComponent(
          "No saved Tax Watch estimate is connected to this portal."
        )
      );
    }

    const clientName =
      latest.entry.lead?.contact?.name ||
      getLeadNameValue(latest.entry.raw) ||
      "Client";

    const sources =
      getTaxWatchOrganizerSources(latest.snapshot);

    const emailHtml =
      buildTaxWatchOrganizerEmailHtml({
        clientName,
        snapshot: latest.snapshot,
        sources
      });

    const optionalMessage = message
      ? `<p><strong>Message from ${taxWatchOrganizerEscapeHtml(clientName)}:</strong><br>${taxWatchOrganizerEscapeHtml(message).replace(/\n/g, "<br>")}</p>`
      : "";

    try {
      await transporter.sendMail({
        from: EMAIL_USER,
        to: professionalEmail,
        replyTo: session.email,
        subject:
          `${clientName} shared a Business Income and Expense Organizer`,
        text:
          `${clientName} shared a Business Income and Expense Organizer with you.\n\n` +
          (message ? `Message: ${message}\n\n` : "") +
          "This organizer is not a completed Schedule C or tax return. The receiving tax professional must verify the records and determine the proper tax treatment.",
        html:
          `<p>Hello ${taxWatchOrganizerEscapeHtml(professionalName)},</p>` +
          `<p>${taxWatchOrganizerEscapeHtml(clientName)} selected you to receive a copy of their Business Income and Expense Organizer.</p>` +
          optionalMessage +
          emailHtml
      });
    } catch (error) {
      console.error(
        "[tax-watch-organizer-share]",
        error.message
      );

      return res.redirect(
        303,
        "/client-portal/tax-watch/organizer?error=" +
        encodeURIComponent(
          "The email could not be sent. Confirm the address or use Print / Save Organizer."
        )
      );
    }

    const now = new Date().toISOString();
    const existing =
      organizerEntry?.lead?.taxWatchOrganizer &&
      typeof organizerEntry.lead.taxWatchOrganizer === "object"
        ? organizerEntry.lead.taxWatchOrganizer
        : {};

    const priorActivity = Array.isArray(
      existing.activity
    )
      ? existing.activity
      : [];

    const organizer = {
      ...buildTaxWatchOrganizerRecord(
        latest.snapshot,
        existing
      ),
      status: "shared-with-tax-professional",
      sharedAt: now,
      sharedWithName: professionalName,
      sharedWithEmail: professionalEmail,
      updatedAt: now,
      activity: [
        ...priorActivity,
        {
          type: "shared-with-tax-professional",
          label: `Shared with ${professionalName}`,
          professionalName,
          professionalEmail,
          occurredAt: now
        }
      ].slice(-20)
    };

    const saveResult = await updateLeadAfterStripePayment(
      organizerRecordLeadId,
      (record = {}) => ({
        ...record,
        taxWatchOrganizer: organizer,
        latestClientAction:
          "Business organizer shared with client's tax professional",
        latestClientActionAt: now,
        updatedAt: now
      })
    );

    if (!saveResult.ok) {
      return res.redirect(
        303,
        "/client-portal/tax-watch/organizer?error=" +
        encodeURIComponent(
          "The email was sent, but the organizer activity could not be saved. Please contact Greatest Business Solution LLC."
        )
      );
    }

    return res.redirect(
      303,
      "/client-portal/tax-watch/organizer?shared=1"
    );
  }
);


app.get(
  "/client-portal/tax-watch/update-estimate",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    const session = req.clientPortalSession;
    const accessible =
      await getClientPortalAccessibleLeads(
        session.email
      );

    const taxWatchAccess =
      buildClientPortalTaxWatchSummary(
        accessible,
        session.payload.accountLeadId
      );

    if (taxWatchAccess.active && !taxWatchAccess.canEdit) {
      return res
        .status(403)
        .type("html")
        .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tax Money Tracker Preview Ended</title>
  <style>
    body{margin:0;background:#eef4f7;color:#17354e;font-family:Arial,sans-serif}
    main{max-width:680px;margin:70px auto;padding:28px;background:#fff;border:1px solid #cbdce7;border-radius:18px;box-shadow:0 12px 35px rgba(20,50,75,.12)}
    h1{margin-top:0;color:#0f2f59}p{font-size:17px;line-height:1.6}
    a{display:inline-block;margin:12px 8px 0 0;padding:13px 18px;border-radius:11px;background:#0f2f59;color:#fff;text-decoration:none;font-weight:800}
  </style>
</head>
<body><main>
  <h1>Your Tax Watch Pro preview has ended</h1>
  <p>No automatic charge occurred. Your saved Tax Money Tracker records remain available.</p>
  <a href="/plans-pricing#tax-watch-pro">Review Tax Watch Pro Plans</a>
  <a href="/client-portal/home#tax-watch">Return to Tax Money Tracker</a>
</main></body></html>`);
    }

    const candidates = accessible
      .map((entry) => ({
        entry,
        snapshot: getTaxWatchSnapshot(entry)
      }))
      .filter((item) => item.snapshot)
      .sort(
        (left, right) =>
          Date.parse(right.snapshot.recordedAt || 0) -
          Date.parse(left.snapshot.recordedAt || 0)
      );

    const latest = candidates[0] || null;

    if (!latest) {
      return res
        .status(409)
        .type("html")
        .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tax Watch Pro Update</title>
  <style>
    body{margin:0;background:#eef4f7;color:#17354e;font-family:Arial,sans-serif}
    main{max-width:680px;margin:70px auto;padding:28px;background:#fff;border:1px solid #cbdce7;border-radius:18px;box-shadow:0 12px 35px rgba(20,50,75,.12)}
    h1{margin-top:0;color:#0f2f59}p{font-size:17px;line-height:1.6}
    a{display:inline-block;margin-top:12px;padding:13px 18px;border-radius:11px;background:#0f2f59;color:#fff;text-decoration:none;font-weight:800}
  </style>
</head>
<body><main>
  <h1>Your estimate update could not be prepared</h1>
  <p>No saved Free Tax Estimator result is connected to this portal email yet.</p>
  <a href="/client-portal/home#tax-watch">Return to Tax Watch Pro</a>
</main></body></html>`);
    }

    const lead = latest.entry.lead || {};
    const taxData =
      lead.taxData &&
      typeof lead.taxData === "object" &&
      !Array.isArray(lead.taxData)
        ? lead.taxData
        : {};

    const context = {
      version: 1,
      sourceLeadId: latest.snapshot.leadId,
      clientName:
        lead.contact?.name ||
        getLeadNameValue(latest.entry.raw) ||
        "Client",
      email: session.email,
      taxData,
      startingSnapshot: latest.snapshot,
      sourceLimit: 5,
      createdAt: new Date().toISOString()
    };

    const contextLiteral = JSON.stringify(
      JSON.stringify(context)
    )
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\\u2028/g, "\\\\u2028")
      .replace(/\\u2029/g, "\\\\u2029");

    return res
      .status(200)
      .type("html")
      .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Preparing Tax Watch Pro Update</title>
  <style>
    body{margin:0;background:#eef4f7;color:#17354e;font-family:Arial,sans-serif}
    main{max-width:680px;margin:70px auto;padding:28px;background:#fff;border:1px solid #cbdce7;border-radius:18px;box-shadow:0 12px 35px rgba(20,50,75,.12);text-align:center}
    h1{margin-top:0;color:#0f2f59}p{font-size:17px;line-height:1.6}
  </style>
</head>
<body><main>
  <h1>Preparing Your Tax Watch Pro Update</h1>
  <p>Your latest saved estimate is being loaded.</p>
</main>
<script>
  try {
    localStorage.setItem("tspTaxWatchUpdateContextV1", ${contextLiteral});
    window.location.replace("/?taxWatchUpdate=1");
  } catch (error) {
    document.querySelector("main").innerHTML =
      "<h1>Your update could not be opened</h1>" +
      "<p>Your browser blocked the saved update context. Return to Tax Watch Pro and try again.</p>" +
      "<p><a href='/client-portal/home#tax-watch'>Return to Tax Watch Pro</a></p>";
  }
</script>
</body></html>`);
  }
);


app.get(
  "/api/client-portal/tax-watch/update-context",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    const session = req.clientPortalSession;
    const accessible =
      await getClientPortalAccessibleLeads(
        session.email
      );

    const taxWatchAccess =
      buildClientPortalTaxWatchSummary(
        accessible,
        session.payload.accountLeadId
      );

    if (taxWatchAccess.active && !taxWatchAccess.canEdit) {
      return res.status(403).json({
        ok: false,
        error:
          "Your Tax Watch Pro preview has ended. Choose a monthly or annual plan to resume Tax Money Tracker updates."
      });
    }

    const candidates = accessible
      .map((entry) => ({
        entry,
        snapshot: getTaxWatchSnapshot(entry)
      }))
      .filter((item) => item.snapshot)
      .sort(
        (left, right) =>
          Date.parse(right.snapshot.recordedAt || 0) -
          Date.parse(left.snapshot.recordedAt || 0)
      );

    const latest = candidates[0] || null;

    if (!latest) {
      return res.status(409).json({
        ok: false,
        error:
          "No saved Free Tax Estimator result is connected to this portal email yet."
      });
    }

    const lead = latest.entry.lead || {};
    const taxData =
      lead.taxData &&
      typeof lead.taxData === "object" &&
      !Array.isArray(lead.taxData)
        ? lead.taxData
        : {};

    return res.status(200).json({
      ok: true,
      context: {
        version: 1,
        sourceLeadId: latest.snapshot.leadId,
        clientName:
          lead.contact?.name ||
          getLeadNameValue(latest.entry.raw) ||
          "Client",
        email: session.email,
        taxData,
        startingSnapshot: latest.snapshot,
        sourceLimit: 5,
        createdAt: new Date().toISOString()
      }
    });
  }
);


const clientDocumentUploadParser =
  express.raw({
    type: "application/octet-stream",
    limit:
      CLIENT_DOCUMENT_MAX_BYTES
  });

function parseClientDocumentUpload(
  req,
  res,
  next
) {
  clientDocumentUploadParser(
    req,
    res,
    (error) => {
      if (!error) {
        next();
        return;
      }

      setClientPortalNoStore(res);

      if (
        error.type ===
        "entity.too.large"
      ) {
        res.status(413).json({
          ok: false,
          error:
            "The document is larger than 15 MB."
        });
        return;
      }

      console.warn(
        "[client document center] Upload body could not be read:",
        error.message || error
      );

      res.status(400).json({
        ok: false,
        error:
          "The document upload could not be read."
      });
    }
  );
}

app.get(
  "/api/client-portal/documents",
  requireClientPortalApiSession,
  async (req, res) => {
    const documentCenter =
      await getClientPortalDocumentCenterState(
        req.clientPortalSession
      );

    return res.status(
      documentCenter.enabled
        ? 200
        : 503
    ).json({
      ok:
        documentCenter.enabled,
      documentCenter,
      error:
        documentCenter.enabled
          ? undefined
          : documentCenter.status
    });
  }
);

app.post(
  "/api/client-portal/documents/upload",
  requireClientPortalApiSession,
  parseClientDocumentUpload,
  async (req, res) => {
    setClientPortalNoStore(res);

    if (
      !clientDocumentStore.isAvailable()
    ) {
      return res.status(503).json({
        ok: false,
        error:
          "Secure document storage is not configured yet."
      });
    }

    const session =
      req.clientPortalSession;

    const fileName =
      decodeClientDocumentHeader(
        req.headers[
          "x-document-file-name"
        ],
        220
      );

    const contentType =
      decodeClientDocumentHeader(
        req.headers[
          "x-document-content-type"
        ],
        100
      );

    const category =
      decodeClientDocumentHeader(
        req.headers[
          "x-document-category"
        ],
        80
      );

    const taxYear =
      decodeClientDocumentHeader(
        req.headers[
          "x-document-tax-year"
        ],
        20
      );

    const note =
      decodeClientDocumentHeader(
        req.headers[
          "x-document-note"
        ],
        500
      );

    const requestedLinkedLeadId =
      decodeClientDocumentHeader(
        req.headers[
          "x-document-linked-lead-id"
        ],
        180
      );

    const validation =
      validateDocumentUpload({
        buffer: req.body,
        originalName:
          fileName,
        contentType,
        category,
        taxYear,
        note
      });

    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        error:
          validation.errors.join(
            " "
          ),
        errors:
          validation.errors
      });
    }

    const rateKey =
      clientPortalRateLimitKey(
        req,
        "document-upload",
        session.email
      );

    const rate =
      consumeClientPortalAttempt(
        rateKey,
        {
          limit: 25,
          windowMs:
            60 * 60 * 1000
        }
      );

    if (!rate.allowed) {
      return res.status(429).json({
        ok: false,
        error:
          "Too many document uploads were attempted. Please wait before trying again."
      });
    }

    const upload =
      validation.value;

    if (
      upload.category ===
      "irs-transcript-delivery"
    ) {
      return res.status(403).json({
        ok: false,
        error:
          "IRS transcripts can only be delivered by the secure office workflow."
      });
    }

    const duplicate =
      await clientDocumentStore.findDuplicate({
        portalId:
          session.portal.portalId,
        email:
          session.email,
        taxYear:
          upload.taxYear,
        sha256:
          upload.sha256
      });

    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error:
          "This same document is already saved under the selected tax year."
      });
    }

    let linkedLeadId = "";

    const transcriptOnlyCategory =
      [
        "signed-8821",
        "identity-verification"
      ].includes(upload.category);

    if (requestedLinkedLeadId) {
      const linkedCandidate =
        await clientPortalSessionCanAccessLead(
          session,
          requestedLinkedLeadId
        );

      if (!linkedCandidate) {
        return res.status(403).json({
          ok: false,
          error:
            "This document cannot be linked to the selected client record."
        });
      }

      linkedLeadId =
        linkedCandidate.leadId;
    }

    if (!linkedLeadId) {
      linkedLeadId =
        await findClientDocumentLinkedLeadId(
          session.email,
          upload.taxYear,
          session.payload.accountLeadId
        );
    }

    if (transcriptOnlyCategory) {
      const transcriptCandidate =
        await clientPortalSessionCanAccessLead(
          session,
          linkedLeadId
        );

      const linkedTranscriptRequest =
        transcriptCandidate?.lead?.transcriptRequest ||
        transcriptCandidate?.lead?.Request ||
        {};

      const isTranscriptRecord =
        Boolean(
          linkedTranscriptRequest.requested
        ) ||
        String(
          transcriptCandidate?.lead?.status || ""
        )
          .toLowerCase()
          .includes("transcript help");

      if (!isTranscriptRecord) {
        return res.status(409).json({
          ok: false,
          error:
            upload.category ===
              "identity-verification"
              ? "Use the Upload Identity Verification Document button on the IRS Transcript Help request."
              : "Use the Upload Signed Form 8821 — Backup button on the IRS Transcript Help request."
        });
      }
    }

    const now =
      new Date().toISOString();

    const documentId =
      crypto.randomUUID();

    const saveResult =
      await clientDocumentStore.upload({
        buffer:
          upload.buffer,
        record: {
          documentId,
          portalId:
            session.portal.portalId,
          accountLeadId:
            session.payload.accountLeadId,
          linkedLeadId,
          email:
            session.email,
          taxYear:
            upload.taxYear,
          category:
            upload.category,
          originalName:
            upload.originalName,
          extension:
            upload.extension,
          contentType:
            upload.contentType,
          sizeBytes:
            upload.sizeBytes,
          sha256:
            upload.sha256,
          note:
            upload.note,
          reviewStatus:
            "awaiting-review",
          clientVisible: true,
          uploadedAt: now,
          updatedAt: now
        }
      });

    if (!saveResult.ok) {
      console.error(
        "[client document center] Upload save failed:",
        saveResult.error
      );

      return res.status(500).json({
        ok: false,
        error:
          clientDocumentStore.isLiveReady()
            ? "The secure document could not be saved. Confirm the private document bucket and database table are configured."
            : "The secure document could not be saved."
      });
    }

    const records =
      await clientDocumentStore.listForPortal({
        portalId:
          session.portal.portalId,
        email:
          session.email
      });

    const summary =
      clientDocumentStore.buildSummary(
        records
      );

    await syncClientDocumentSummaryToLinkedLead(
      saveResult.record,
      records
    );

    const publicRecord =
      publicDocumentRecord(
        saveResult.record
      );

    void sendClientDocumentUploadReceipt({
      to:
        session.email,
      clientName:
        getLeadNameValue(
          session.accountLead.raw
        ),
      document:
        publicRecord
    });

    return res.status(201).json({
      ok: true,
      message:
        "Your document was uploaded securely and is awaiting office review.",
      document:
        publicRecord,
      summary
    });
  }
);

app.get(
  "/api/client-portal/documents/:documentId/download",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    const documentId = String(
      req.params?.documentId || ""
    ).trim();

    const result =
      await clientDocumentStore.download({
        documentId,
        portalId:
          req.clientPortalSession
            .portal
            .portalId,
        email:
          req.clientPortalSession
            .email
      });

    if (!result.ok) {
      return res.status(404).json({
        ok: false,
        error:
          "The requested document is not available in your portal."
      });
    }

    const fileName =
      safeClientDocumentDownloadName(
        result.record.originalName
      );

    res.setHeader(
      "Content-Type",
      result.record.contentType ||
      "application/octet-stream"
    );

    res.setHeader(
      "Content-Length",
      String(
        result.buffer.length
      )
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    return res.send(
      result.buffer
    );
  }
);




const TRANSCRIPT_WORKSPACE_DOCUMENT_CATEGORIES =
  new Set([
    "signed-8821",
    "identity-verification",
    "irs-transcript-delivery"
  ]);

function transcriptWorkspaceDocumentBelongsToLead(
  record = {},
  leadId = ""
) {
  const cleanLeadId = String(
    leadId || ""
  ).trim();

  const recordLeadId = String(
    record.linkedLeadId ||
    record.accountLeadId ||
    ""
  ).trim();

  return (
    cleanLeadId &&
    recordLeadId === cleanLeadId &&
    TRANSCRIPT_WORKSPACE_DOCUMENT_CATEGORIES.has(
      String(record.category || "")
    )
  );
}

const DEFAULT_TRANSCRIPT_PORTAL_CLEANUP_DAYS =
  Math.max(
    1,
    Math.min(
      365,
      Number(
        process.env.TRANSCRIPT_PORTAL_CLEANUP_DAYS ||
        30
      ) || 30
    )
  );

function getDefaultTranscriptPortalCleanupDate(
  value = Date.now()
) {
  const base = new Date(
    value || Date.now()
  );

  const safeBase =
    Number.isFinite(base.getTime())
      ? base
      : new Date();

  safeBase.setUTCDate(
    safeBase.getUTCDate() +
    DEFAULT_TRANSCRIPT_PORTAL_CLEANUP_DAYS
  );

  return getPhoenixDateOnly(
    safeBase
  );
}

function getTranscriptWorkspaceCleanupState(
  documents = []
) {
  const safeDocuments =
    Array.isArray(documents)
      ? documents
      : [];

  const activeDocuments =
    safeDocuments.filter(
      (document = {}) =>
        String(
          document.reviewStatus ||
          ""
        ) !== "withdrawn"
    );

  const removedDocuments =
    safeDocuments.filter(
      (document = {}) =>
        String(
          document.reviewStatus ||
          ""
        ) === "withdrawn"
    );

  const scheduledDates =
    activeDocuments
      .map(
        (document = {}) =>
          normalizeClientDocumentRetentionDate(
            document.retentionUntil
          )
      )
      .filter(Boolean)
      .sort();

  return {
    activeCount:
      activeDocuments.length,
    removedCount:
      removedDocuments.length,
    scheduledCount:
      scheduledDates.length,
    nextReviewDate:
      scheduledDates[0] || "",
    defaultReviewDate:
      getDefaultTranscriptPortalCleanupDate(),
    defaultDays:
      DEFAULT_TRANSCRIPT_PORTAL_CLEANUP_DAYS,
    adminDocumentId:
      String(
        removedDocuments[0]?.documentId ||
        activeDocuments[0]?.documentId ||
        ""
      )
  };
}

async function applyTranscriptWorkspaceRetentionReminder({
  leadId,
  retentionUntil
}) {
  const cleanLeadId = String(
    leadId || ""
  ).trim();

  const cleanRetentionUntil =
    normalizeClientDocumentRetentionDate(
      retentionUntil
    );

  if (
    !cleanLeadId ||
    !cleanRetentionUntil
  ) {
    return {
      ok: false,
      error:
        "A transcript request and valid cleanup review date are required."
    };
  }

  const allDocuments =
    await clientDocumentStore
      .listForOffice({});

  const activeDocuments =
    allDocuments.filter(
      (document = {}) =>
        transcriptWorkspaceDocumentBelongsToLead(
          document,
          cleanLeadId
        ) &&
        String(
          document.reviewStatus ||
          ""
        ) !== "withdrawn"
    );

  const failures = [];
  let updatedCount = 0;

  for (const document of activeDocuments) {
    const result =
      await clientDocumentStore
        .updateReview({
          documentId:
            document.documentId,
          patch: {
            retentionUntil:
              cleanRetentionUntil,
            statusChangedAt:
              document.statusChangedAt ||
              document.updatedAt ||
              ""
          }
        });

    if (result?.ok) {
      updatedCount += 1;
    } else {
      failures.push({
        documentId:
          document.documentId,
        error:
          result?.error ||
          "The retention reminder could not be saved."
      });
    }
  }

  return {
    ok:
      failures.length === 0,
    retentionUntil:
      cleanRetentionUntil,
    updatedCount,
    totalDocuments:
      activeDocuments.length,
    failures
  };
}

async function getTranscriptWorkspaceDocumentState(
  leadId
) {
  const cleanLeadId = String(
    leadId || ""
  ).trim();

  if (!cleanLeadId) {
    return {
      ok: false,
      status: 400,
      error:
        "A transcript request reference is required."
    };
  }

  const candidate =
    await findClientPortalLeadById(
      cleanLeadId
    );

  if (!candidate) {
    return {
      ok: false,
      status: 404,
      error:
        "The transcript request could not be found."
    };
  }

  const allDocuments =
    await clientDocumentStore
      .listForOffice({});

  const documents =
    allDocuments.filter(
      (record) =>
        transcriptWorkspaceDocumentBelongsToLead(
          record,
          cleanLeadId
        )
    );

  let deliveryTarget = null;

  try {
    deliveryTarget =
      await getSecureTranscriptDeliveryTarget(
        cleanLeadId
      );
  } catch (error) {
    deliveryTarget = {
      ok: false,
      ready: false,
      missing: [
        error?.message ||
        "The secure delivery readiness could not be checked."
      ]
    };
  }

  return {
    ok: true,
    status: 200,
    state: {
      version: "1.1.1",
      leadId:
        cleanLeadId,
      clientName:
        getLeadNameValue(
          candidate.raw
        ) || "Client",
      email:
        getLeadEmailValue(
          candidate.raw
        ),
      documents:
        documents.map(
          officeDocumentRecord
        ),
      summary:
        clientDocumentStore
          .buildSummary(
            documents
          ),
      cleanup:
        getTranscriptWorkspaceCleanupState(
          documents
        ),
      delivery: {
        ready:
          Boolean(
            deliveryTarget?.ok &&
            deliveryTarget?.ready
          ),
        missing:
          Array.isArray(
            deliveryTarget?.missing
          )
            ? deliveryTarget.missing
            : [],
        portalReady:
          Boolean(
            deliveryTarget?.portal?.portalId
          ),
        transcriptType:
          String(
            deliveryTarget?.transcriptType ||
            ""
          ),
        taxYears:
          String(
            deliveryTarget?.taxYears ||
            ""
          ),
        transcriptPulledDate:
          String(
            deliveryTarget?.transcriptRequest
              ?.transcriptPulledDate ||
            ""
          ),
        transcriptReceivedDate:
          String(
            deliveryTarget?.transcriptRequest
              ?.transcriptReceivedDate ||
            ""
          ),
        deliveryDate:
          String(
            deliveryTarget?.transcriptRequest
              ?.deliveryDate ||
            ""
          ),
        deliveryFileLocation:
          String(
            deliveryTarget?.transcriptRequest
              ?.deliveryFileLocation ||
            ""
          )
      }
    }
  };
}

app.get(
  "/api/office-document-review/transcript-workspace/:leadId",
  requireOfficeDocumentReviewApi,
  async (req, res) => {
    setClientPortalNoStore(res);

    try {
      const result =
        await getTranscriptWorkspaceDocumentState(
          req.params?.leadId
        );

      if (!result.ok) {
        return res.status(
          result.status || 400
        ).json({
          ok: false,
          error:
            result.error
        });
      }

      return res.status(200).json({
        ok: true,
        state:
          result.state
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          error?.message ||
          "The transcript document workspace could not be loaded."
      });
    }
  }
);

app.post(
  "/api/office-document-review/transcript-workspace/:leadId/retention",
  requireOfficeDocumentReviewApi,
  async (req, res) => {
    setClientPortalNoStore(res);

    const leadId = String(
      req.params?.leadId || ""
    ).trim();

    const candidate =
      await findClientPortalLeadById(
        leadId
      );

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error:
          "The transcript request could not be found."
      });
    }

    const retentionRaw = String(
      req.body?.retentionUntil ||
      ""
    ).trim();

    const retentionUntil =
      retentionRaw
        ? normalizeClientDocumentRetentionDate(
            retentionRaw
          )
        : getDefaultTranscriptPortalCleanupDate();

    if (!retentionUntil) {
      return res.status(400).json({
        ok: false,
        error:
          "Choose a valid portal cleanup review date."
      });
    }

    const result =
      await applyTranscriptWorkspaceRetentionReminder({
        leadId,
        retentionUntil
      });

    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        error:
          result.error ||
          "The cleanup review date could not be applied to every active document.",
        result
      });
    }

    const refreshed =
      await getTranscriptWorkspaceDocumentState(
        leadId
      );

    return res.status(200).json({
      ok: true,
      message:
        `Portal cleanup review scheduled for ${retentionUntil} on ${result.updatedCount} active document${result.updatedCount === 1 ? "" : "s"}.`,
      retentionUntil,
      updatedCount:
        result.updatedCount,
      state:
        refreshed.ok
          ? refreshed.state
          : null
    });
  }
);

app.post(
  "/api/office-document-review/transcript-workspace/:leadId/complete",
  requireOfficeDocumentReviewApi,
  async (req, res) => {
    setClientPortalNoStore(res);

    const leadId = String(
      req.params?.leadId || ""
    ).trim();

    const candidate =
      await findClientPortalLeadById(
        leadId
      );

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error:
          "The transcript request could not be found."
      });
    }

    const currentRequest =
      getTranscriptRequestRecord(
        candidate.lead || {}
      );

    const missing = [];

    if (
      !currentRequest
        .transcriptReceivedDate
    ) {
      missing.push(
        "Record the transcript received date"
      );
    }

    if (
      !currentRequest.deliveryDate
    ) {
      missing.push(
        "Deliver the transcript to the client"
      );
    }

    if (
      !currentRequest.deliveryMethod ||
      String(
        currentRequest.deliveryMethod
      ).toLowerCase() ===
        "not delivered yet"
    ) {
      missing.push(
        "Record the delivery method"
      );
    }

    if (
      String(
        currentRequest.deliveryMethod ||
        ""
      ).toLowerCase().includes(
        "portal"
      ) &&
      !currentRequest
        .deliveryFileLocation
    ) {
      missing.push(
        "Record the secure transcript file"
      );
    }

    if (missing.length) {
      return res.status(409).json({
        ok: false,
        error:
          `Complete these items before closing the transcript request: ${missing.join(", ")}.`,
        missing
      });
    }

    const now =
      new Date().toISOString();

    const retentionRaw = String(
      req.body?.retentionUntil ||
      ""
    ).trim();

    const retentionUntil =
      retentionRaw
        ? normalizeClientDocumentRetentionDate(
            retentionRaw
          )
        : getDefaultTranscriptPortalCleanupDate(
            now
          );

    if (!retentionUntil) {
      return res.status(400).json({
        ok: false,
        error:
          "Choose a valid portal cleanup review date before completing the request."
      });
    }

    const retentionResult =
      await applyTranscriptWorkspaceRetentionReminder({
        leadId,
        retentionUntil
      });

    if (!retentionResult.ok) {
      return res.status(500).json({
        ok: false,
        error:
          retentionResult.error ||
          "The transcript request was not completed because the cleanup review date could not be scheduled for every active document.",
        retentionResult
      });
    }

    const result =
      await updateLeadAfterStripePayment(
        leadId,
        (record = {}) => {
          const updated = {
            ...record
          };

          const existing =
            getTranscriptRequestRecord(
              updated
            );

          const nextTranscriptRequest = {
            ...existing,
            requested: true,
            internalStatus:
              "Completed",
            completedAt:
              existing.completedAt ||
              now,
            documentCleanupReviewDate:
              retentionUntil,
            lastSavedAt:
              now
          };

          updated.transcriptRequest =
            nextTranscriptRequest;

          updated.Request = {
            ...(updated.Request || {}),
            ...nextTranscriptRequest
          };

          updated.status =
            "Transcript Help - Completed";

          updated.completedAt =
            updated.completedAt ||
            now;

          updated.updatedAt =
            now;

          const note =
            `[${new Date(now).toLocaleString()}] Transcript request completed after secure delivery. Portal cleanup review scheduled for ${retentionUntil}.`;

          const oldNotes =
            typeof updated.notes === "string"
              ? updated.notes.trim()
              : "";

          updated.notes =
            oldNotes
              ? `${oldNotes}\n${note}`
              : note;

          return updated;
        }
      );

    if (!result?.ok) {
      return res.status(500).json({
        ok: false,
        error:
          result?.error ||
          "The transcript request could not be completed."
      });
    }

    return res.status(200).json({
      ok: true,
      message:
        `The transcript request was completed and moved out of open work. Portal cleanup review is scheduled for ${retentionUntil}.`,
      retentionUntil,
      retentionScheduledCount:
        retentionResult.updatedCount,
      lead:
        result.lead ||
        null
    });
  }
);

app.get(
  "/api/office-document-review/transcript-delivery/:leadId",
  requireOfficeDocumentReviewApi,
  async (req, res) => {
    setClientPortalNoStore(res);

    try {
      const target =
        await getSecureTranscriptDeliveryTarget(
          req.params?.leadId
        );

      if (!target.ok) {
        return res.status(
          target.status || 400
        ).json({
          ok: false,
          error: target.error
        });
      }

      return res.status(200).json({
        ok: true,
        target: {
          leadId:
            target.leadId,
          clientName:
            target.clientName,
          email:
            target.email,
          portalReady:
            Boolean(
              target.portal?.portalId
            ),
          portalAccountLeadId:
            String(
              target.portal?.leadId || ""
            ),
          transcriptType:
            target.transcriptType,
          taxYears:
            target.taxYears,
          transcriptPulledDate:
            String(
              target.transcriptRequest
                .transcriptPulledDate || ""
            ),
          transcriptReceivedDate:
            String(
              target.transcriptRequest
                .transcriptReceivedDate || ""
            ),
          deliveryDate:
            String(
              target.transcriptRequest
                .deliveryDate || ""
            ),
          deliveryDocumentId:
            String(
              target.transcriptRequest
                .deliveryDocumentId || ""
            ),
          ready:
            target.ready,
          missing:
            target.missing
        }
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          error?.message ||
          "The secure transcript delivery record could not be loaded."
      });
    }
  }
);

app.post(
  "/api/office-document-review/transcript-delivery/upload",
  requireOfficeDocumentReviewApi,
  parseClientDocumentUpload,
  async (req, res) => {
    setClientPortalNoStore(res);

    try {
      const linkedLeadId =
        cleanClientDocumentText(
          decodeClientDocumentHeader(
            req.headers[
              "x-document-linked-lead-id"
            ],
            220
          ),
          220
        );

      const target =
        await getSecureTranscriptDeliveryTarget(
          linkedLeadId
        );

      if (!target.ok) {
        return res.status(
          target.status || 400
        ).json({
          ok: false,
          error: target.error
        });
      }

      if (!target.ready) {
        return res.status(409).json({
          ok: false,
          error:
            `Complete these transcript checklist items first: ${target.missing.join(", ")}.`,
          missing:
            target.missing
        });
      }

      const validation =
        validateDocumentUpload({
          buffer: req.body,
          originalName:
            decodeClientDocumentHeader(
              req.headers[
                "x-document-file-name"
              ],
              220
            ),
          contentType:
            decodeClientDocumentHeader(
              req.headers[
                "x-document-content-type"
              ],
              120
            ),
          taxYear:
            decodeClientDocumentHeader(
              req.headers[
                "x-document-tax-year"
              ],
              20
            ),
          category:
            "irs-transcript-delivery",
          note:
            decodeClientDocumentHeader(
              req.headers[
                "x-document-note"
              ],
              500
            )
        });

      if (!validation.ok) {
        return res.status(400).json({
          ok: false,
          error:
            validation.errors.join(" "),
          errors:
            validation.errors
        });
      }

      const upload =
        validation.value;

      const duplicate =
        await clientDocumentStore.findDuplicate({
          portalId:
            target.portal.portalId,
          email:
            target.email,
          taxYear:
            upload.taxYear,
          sha256:
            upload.sha256
        });

      if (duplicate) {
        return res.status(409).json({
          ok: false,
          error:
            "This same transcript file is already saved under the selected tax year."
        });
      }

      const now =
        new Date().toISOString();

      const clientMessage =
        "Your IRS transcript is ready for secure download in the client portal.";

      const saveResult =
        await clientDocumentStore.upload({
          buffer:
            upload.buffer,
          record: {
            documentId:
              crypto.randomUUID(),
            portalId:
              target.portal.portalId,
            accountLeadId:
              target.portal.leadId,
            linkedLeadId:
              target.leadId,
            email:
              target.email,
            taxYear:
              upload.taxYear,
            category:
              upload.category,
            originalName:
              upload.originalName,
            extension:
              upload.extension,
            contentType:
              upload.contentType,
            sizeBytes:
              upload.sizeBytes,
            sha256:
              upload.sha256,
            note:
              upload.note ||
              "IRS transcript securely delivered by Greatest Business Solution LLC.",
            reviewStatus:
              "accepted",
            clientVisible: true,
            officeNote:
              "Uploaded by the office for secure client delivery.",
            clientMessage,
            reviewedAt: now,
            reviewedBy:
              "Greatest Business Solution LLC",
            statusChangedAt: now,
            uploadedAt: now,
            updatedAt: now
          }
        });

      if (!saveResult.ok) {
        return res.status(500).json({
          ok: false,
          error:
            saveResult.error ||
            "The transcript could not be saved to private storage."
        });
      }

      const portalRecords =
        await clientDocumentStore.listForPortal({
          portalId:
            target.portal.portalId,
          email:
            target.email
        });

      await syncClientDocumentSummaryToLinkedLead(
        saveResult.record,
        portalRecords
      );

      const transcriptDeliverySync =
        await syncSecureTranscriptDeliveryToTranscriptRequest({
          document:
            saveResult.record,
          deliveredAt: now,
          clientMessage
        });

      if (
        !transcriptDeliverySync ||
        !transcriptDeliverySync.ok
      ) {
        console.warn(
          "[secure transcript delivery] Transcript checklist sync failed:",
          transcriptDeliverySync?.error ||
          transcriptDeliverySync
        );
      }

      void sendSecureTranscriptDeliveryEmail({
        to:
          target.email,
        clientName:
          target.clientName,
        document:
          saveResult.record,
        transcriptRequest:
          target.transcriptRequest
      });

      return res.status(201).json({
        ok: true,
        message:
          "SECURE TRANSCRIPT DELIVERED — CLIENT PORTAL AND TRANSCRIPT CHECKLIST UPDATED.",
        document:
          officeDocumentRecord(
            saveResult.record
          ),
        summary:
          clientDocumentStore.buildSummary(
            portalRecords
          ),
        transcriptDeliverySync
      });
    } catch (error) {
      console.error(
        "[secure transcript delivery] Upload failed:",
        error?.message || error
      );

      return res.status(500).json({
        ok: false,
        error:
          error?.message ||
          "The transcript could not be delivered securely."
      });
    }
  }
);

app.get(
  "/api/office-document-review/state",
  requireOfficeDocumentReviewApi,
  async (req, res) => {
    setClientPortalNoStore(res);

    const state =
      await getOfficeDocumentReviewState({
        status: String(
          req.query?.status || ""
        ),
        search: String(
          req.query?.search || ""
        ),
        portalId: String(
          req.query?.portalId || ""
        ),
        email: String(
          req.query?.email || ""
        )
      });

    return res.status(
      state.error
        ? 503
        : 200
    ).json({
      ok: !state.error,
      state,
      error:
        state.error ||
        undefined
    });
  }
);

app.get(
  "/api/office-document-review/documents/:documentId/download",
  requireOfficeDocumentReviewApi,
  async (req, res) => {
    setClientPortalNoStore(res);

    const result =
      await clientDocumentStore
        .downloadForOffice({
          documentId:
            req.params?.documentId
        });

    if (!result.ok) {
      return res.status(404).json({
        ok: false,
        error:
          "The requested office document is not available."
      });
    }

    const fileName =
      safeClientDocumentDownloadName(
        result.record.originalName
      );

    res.setHeader(
      "Content-Type",
      result.record.contentType ||
      "application/octet-stream"
    );

    res.setHeader(
      "Content-Length",
      String(
        result.buffer.length
      )
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    return res.send(
      result.buffer
    );
  }
);


app.post(
  "/api/office-document-review/documents/:documentId/retention",
  requireOfficeDocumentReviewApi,
  async (req, res) => {
    setClientPortalNoStore(res);

    const retentionRaw =
      String(
        req.body?.retentionUntil || ""
      ).trim();

    const retentionUntil =
      normalizeClientDocumentRetentionDate(
        retentionRaw
      );

    if (
      retentionRaw &&
      !retentionUntil
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "The retention reminder date is not valid."
      });
    }

    const existing =
      await clientDocumentStore
        .getForOffice({
          documentId:
            req.params?.documentId
        });

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error:
          "The document could not be found."
      });
    }

    const result =
      await clientDocumentStore
        .updateReview({
          documentId:
            existing.documentId,
          patch: {
            retentionUntil,
            statusChangedAt:
              existing.statusChangedAt ||
              existing.updatedAt ||
              ""
          }
        });

    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        error:
          result.error ||
          "The retention reminder could not be saved."
      });
    }

    return res.status(200).json({
      ok: true,
      message:
        retentionUntil
          ? "The retention reminder date was saved."
          : "The retention reminder date was cleared.",
      document:
        officeDocumentRecord(
          result.record
        )
    });
  }
);

app.post(
  "/api/office-document-review/documents/:documentId/review",
  requireOfficeDocumentReviewApi,
  async (req, res) => {
    setClientPortalNoStore(res);

    const reviewStatus =
      normalizeClientDocumentReviewStatus(
        req.body?.reviewStatus
      );

    if (!reviewStatus) {
      return res.status(400).json({
        ok: false,
        error:
          "Choose a valid document review status."
      });
    }

    const clientMessage =
      cleanClientDocumentText(
        req.body?.clientMessage,
        1200
      );

    if (
      reviewStatus ===
        "needs-replacement" &&
      !clientMessage
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter a client-visible replacement request."
      });
    }

    const retentionRaw =
      String(
        req.body?.retentionUntil || ""
      ).trim();

    const retentionUntil =
      normalizeClientDocumentRetentionDate(
        retentionRaw
      );

    if (
      retentionRaw &&
      !retentionUntil
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "The retention reminder date is not valid."
      });
    }

    const now =
      new Date().toISOString();

    const result =
      await clientDocumentStore
        .updateReview({
          documentId:
            req.params?.documentId,
          patch: {
            reviewStatus,
            officeNote:
              cleanClientDocumentText(
                req.body?.officeNote,
                3000
              ),
            clientMessage,
            retentionUntil,
            reviewedAt:
              reviewStatus ===
                "in-review" ||
              reviewStatus ===
                "awaiting-review"
                ? ""
                : now,
            reviewedBy:
              cleanClientDocumentText(
                req.body?.reviewedBy ||
                "Greatest Business Solution LLC",
                200
              ),
            statusChangedAt: now,
            clientVisible:
              reviewStatus !==
              "withdrawn",
            withdrawnAt:
              reviewStatus ===
              "withdrawn"
                ? now
                : ""
          }
        });

    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        error:
          result.error ||
          "The document review could not be saved."
      });
    }

    const portalRecords =
      await clientDocumentStore
        .listForOffice({
          portalId:
            result.record.portalId
        });

    const summary =
      clientDocumentStore
        .buildSummary(
          portalRecords
        );

    await syncClientDocumentSummaryToLinkedLead(
      result.record,
      portalRecords
    );

    let transcriptAuthorizationSync = null;
    let transcriptIdentitySync = null;
    let transcriptDeliverySync = null;

    if (
      result.record.category ===
        "signed-8821" &&
      (
        reviewStatus === "accepted" ||
        reviewStatus ===
          "needs-replacement"
      )
    ) {
      transcriptAuthorizationSync =
        await syncSigned8821DocumentToTranscriptRequest({
          document:
            result.record,
          reviewStatus,
          clientMessage,
          reviewedAt: now
        });

      if (
        transcriptAuthorizationSync &&
        !transcriptAuthorizationSync.ok
      ) {
        console.warn(
          "[office document review] Signed Form 8821 transcript sync failed:",
          transcriptAuthorizationSync.error ||
          transcriptAuthorizationSync
        );
      }
    }

    if (
      result.record.category ===
        "identity-verification" &&
      (
        reviewStatus === "accepted" ||
        reviewStatus ===
          "needs-replacement"
      )
    ) {
      transcriptIdentitySync =
        await syncIdentityVerificationDocumentToTranscriptRequest({
          document:
            result.record,
          reviewStatus,
          clientMessage,
          reviewedAt: now
        });

      if (
        transcriptIdentitySync &&
        !transcriptIdentitySync.ok
      ) {
        console.warn(
          "[office document review] Identity verification transcript sync failed:",
          transcriptIdentitySync.error ||
          transcriptIdentitySync
        );
      }
    }

    if (
      result.record.category ===
        "irs-transcript-delivery" &&
      reviewStatus === "accepted"
    ) {
      transcriptDeliverySync =
        await syncSecureTranscriptDeliveryToTranscriptRequest({
          document:
            result.record,
          deliveredAt:
            result.record.uploadedAt ||
            result.record.reviewedAt ||
            now,
          clientMessage:
            clientMessage ||
            result.record.clientMessage ||
            "Your IRS transcript is ready for secure download in the client portal."
        });

      if (
        transcriptDeliverySync &&
        !transcriptDeliverySync.ok
      ) {
        console.warn(
          "[office document review] Secure transcript delivery checklist sync failed:",
          transcriptDeliverySync.error ||
          transcriptDeliverySync
        );
      }
    }

    if (
      reviewStatus === "accepted" ||
      reviewStatus ===
        "needs-replacement"
    ) {
      const lead =
        await findClientPortalLeadById(
          result.record.accountLeadId
        );

      void sendClientDocumentReviewEmail({
        document:
          result.record,
        clientName:
          getLeadNameValue(
            lead?.raw || {}
          )
      });
    }

    return res.status(200).json({
      ok: true,
      message:
        "The secure document review was saved.",
      document:
        officeDocumentRecord(
          result.record
        ),
      summary,
      transcriptAuthorizationSync,
      transcriptIdentitySync,
      transcriptDeliverySync
    });
  }
);


async function appendSecureDocumentDeletionAudit(
  document = {},
  deletedAt = ""
) {
  const leadId =
    getClientDocumentSummaryLeadId(
      document
    );

  if (!leadId) {
    return {
      ok: false,
      skipped: true,
      error:
        "No linked client record was available for the deletion audit."
    };
  }

  const auditAt =
    String(
      deletedAt ||
      new Date().toISOString()
    );

  return updateLeadAfterStripePayment(
    leadId,
    (record = {}) => {
      const updated = {
        ...record
      };

      const currentPortal =
        getClientPortalRecord(
          updated
        ) || {};

      const currentHistory =
        Array.isArray(
          currentPortal
            .documentAuditHistory
        )
          ? currentPortal
              .documentAuditHistory
              .filter(Boolean)
              .slice(-99)
          : [];

      const auditEntry = {
        event:
          "permanently-deleted",
        documentId:
          String(
            document.documentId || ""
          ),
        originalName:
          String(
            document.originalName || ""
          ),
        category:
          String(
            document.category || ""
          ),
        categoryLabel:
          getClientDocumentCategoryLabel(
            document.category
          ),
        taxYear:
          String(
            document.taxYear || ""
          ),
        uploadedAt:
          String(
            document.uploadedAt || ""
          ),
        reviewedAt:
          String(
            document.reviewedAt || ""
          ),
        withdrawnAt:
          String(
            document.withdrawnAt || ""
          ),
        priorReviewStatus:
          String(
            document.reviewStatus || ""
          ),
        deletedAt:
          auditAt,
        linkedLeadId:
          String(
            document.linkedLeadId || ""
          ),
        accountLeadId:
          String(
            document.accountLeadId || ""
          )
      };

      updated.clientPortal = {
        ...currentPortal,
        documentAuditHistory: [
          ...currentHistory,
          auditEntry
        ]
      };

      updated.updatedAt =
        auditAt;

      const note =
        `[${new Date(auditAt).toLocaleString()}] Secure document permanently deleted after portal removal: ${document.originalName || document.documentId}. Audit details retained on the client record.`;

      const oldNotes =
        typeof updated.notes === "string"
          ? updated.notes.trim()
          : "";

      updated.notes =
        oldNotes
          ? `${oldNotes}\n${note}`
          : note;

      return updated;
    }
  );
}

app.delete(
  "/api/office-document-review/documents/:documentId",
  requireOfficeDocumentReviewApi,
  async (req, res) => {
    setClientPortalNoStore(res);

    if (
      String(
        req.body?.confirmation || ""
      ).trim() !==
      "DELETE PERMANENTLY"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          'Type "DELETE PERMANENTLY" to confirm permanent deletion.'
      });
    }

    const existing =
      await clientDocumentStore
        .getForOffice({
          documentId:
            req.params?.documentId
        });

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error:
          "The document could not be found."
      });
    }

    if (
      existing.reviewStatus !==
      "withdrawn"
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "Remove the document from the active portal before deleting it permanently."
      });
    }

    const result =
      await clientDocumentStore
        .deletePermanently({
          documentId:
            existing.documentId
        });

    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        error:
          result.error ||
          "The document could not be deleted."
      });
    }

    const deletionAudit =
      await appendSecureDocumentDeletionAudit(
        existing,
        new Date().toISOString()
      );

    const portalRecords =
      await clientDocumentStore
        .listForOffice({
          portalId:
            existing.portalId
        });

    const summary =
      clientDocumentStore
        .buildSummary(
          portalRecords
        );

    await syncClientDocumentSummaryToLinkedLead(
      existing,
      portalRecords
    );

    return res.status(200).json({
      ok: true,
      message:
        "The document file and metadata were permanently deleted. A deletion audit was retained on the client record.",
      summary,
      deletionAudit
    });
  }
);

app.get(
  "/api/client-portal/context",
  requireClientPortalApiSession,
  async (req, res) => {
    const leadId = String(
      req.query?.leadId || ""
    ).trim();

    const candidate =
      await clientPortalSessionCanAccessLead(
        req.clientPortalSession,
        leadId
      );

    if (!candidate) {
      return res.status(403).json({
        ok: false,
        error:
          "This tax-planning record is not available in your portal."
      });
    }

    const lead = candidate.lead || {};

    return res.status(200).json({
      ok: true,
      source: candidate.source,
      lead: {
        leadId: candidate.leadId,
        timestamp: lead.timestamp || null,
        status: lead.status || "Active",
        estimateSummary:
          lead.estimateSummary || null,
        taxData:
          lead.taxData || null,
        contact: {
          name:
            lead.contact?.name ||
            getLeadNameValue(candidate.raw),
          email:
            req.clientPortalSession.email,
          phone:
            lead.contact?.phone || ""
        },
        taxSavingsPlanner:
          lead.taxSavingsPlanner || null
      }
    });
  }
);

app.post(
  "/api/client-portal/planner-sync",
  requireClientPortalApiSession,
  async (req, res) => {
    const leadId = String(
      req.body?.leadId || ""
    ).trim();

    const candidate =
      await clientPortalSessionCanAccessLead(
        req.clientPortalSession,
        leadId
      );

    if (!candidate) {
      return res.status(403).json({
        ok: false,
        error:
          "This tax-planning record is not available in your portal."
      });
    }

    return handleTaxSavingsPlannerSync(req, res);
  }
);

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
    const mergedTaxSavingsPlanner =
      foundLead.taxSavingsPlanner ||
      localLeadForRequest?.taxSavingsPlanner ||
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
        taxSavingsPlanner: mergedTaxSavingsPlanner,
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

app.get("/request-tax-extension", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "extension-request.html"));
});

app.get("/contractor-1099-service", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "contractor-1099-service.html"));
});

app.get("/plans-pricing", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "index.html"));
});

app.get("/professional-tax-services", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "index.html"));
});

app.get("/extension-thank-you", (req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.sendFile(path.join(__dirname, "ui", "extension-thank-you.html"));
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


// =============================================================================
// POST /api/leads/:leadId/opportunity-action
// =============================================================================
app.post("/api/leads/:leadId/opportunity-action", async (req, res) => {
  const { leadId } = req.params;
  const { action } = req.body || {};
  const cleanId = String(leadId || "").trim();
  const cleanAction = String(action || "").trim();
  const now = new Date().toISOString();
  const bookingUrl =
    process.env.CALENDLY_URL ||
    "https://calendly.com/ngmsllc/tax-estimate-review-15-minutes";
  const publicBaseUrl =
    (
      process.env.PUBLIC_SITE_URL ||
      APP_BASE_URL ||
      "https://www.taxestimatereview.com"
    )
      .replace(/\/+$/, "");

  const taxPrepUrl =
    publicBaseUrl +
    "/start-my-tax-return";

  const portalActivationUrl =
    publicBaseUrl +
    "/client-portal?activate=1&leadId=" +
    encodeURIComponent(cleanId);

  if (!cleanId) {
    return res.status(400).json({ ok: false, error: "Missing lead ID." });
  }

  const allowedActions = [
    "send-tax-prep-email",
    "send-calendar-email",
    "send-follow-up-email",
    "mark-contacted",
    "snooze-follow-up",
    "close-opportunity",
    "convert-tax-prep"
  ];

  if (!allowedActions.includes(cleanAction)) {
    return res.status(400).json({ ok: false, error: "Invalid opportunity action." });
  }

  const findLead = async () => {
    const matchesLeadId = (obj = {}) => {
      const estimate = obj.estimate || {};
      const possibleIds = [
        obj.leadId,
        obj.leadid,
        obj.lead_id,
        obj.id,
        estimate.leadId,
        estimate.leadid,
        estimate.lead_id,
        estimate.id
      ];

      return possibleIds.some(
        (id) => String(id || "").trim() === cleanId
      );
    };

    try {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        const row = data.find(matchesLeadId);
        if (row) {
          return mapRowToLead(row);
        }
      }
    } catch (error) {
      console.error(
        "[opportunity-action] Supabase lead lookup failed:",
        error.message || error
      );
    }

    return readLeads().find(matchesLeadId) || null;
  };

  const lead = await findLead();

  if (!lead) {
    return res.status(404).json({ ok: false, error: "Lead not found." });
  }

  const name = String(lead?.contact?.name || "Client").trim();
  const email = String(lead?.contact?.email || "").trim();
  const service = String(
    lead?.contactRequest?.service ||
    lead?.taxPreparationIntake?.recommendedLane ||
    "tax help"
  ).trim();
  const message = String(lead?.contactRequest?.message || "").trim();

  const currentRequest =
    lead?.Request &&
    typeof lead.Request === "object" &&
    !Array.isArray(lead.Request)
      ? lead.Request
      : {};

  const currentHistory =
    Array.isArray(currentRequest.conversionActivityHistory)
      ? currentRequest.conversionActivityHistory
          .filter((entry) => entry && (entry.action || entry.at))
          .slice(-24)
      : [];

  const followUp48Hours =
    new Date(
      Date.now() +
      48 * 60 * 60 * 1000
    ).toISOString();

  const followUp5Days =
    new Date(
      Date.now() +
      5 * 24 * 60 * 60 * 1000
    ).toISOString();

  const addHistoryEntry = (
    actionLabel,
    stageLabel
  ) => {
    return [
      ...currentHistory,
      {
        action: actionLabel,
        stage: stageLabel,
        at: now
      }
    ].slice(-25);
  };

  let newStatus = "Contact Request - Outreach Sent";
  let responseMessage = "Opportunity updated.";
  let completedAt = "";
  let closedAt = "";
  let requestUpdate = {
    conversionLastActionAt: now,
    conversionLastAction: cleanAction,
    conversionPreviousStatus: String(lead.status || "")
  };

  const sendClientEmail = async ({ subject, text }) => {
    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      throw new Error("Email delivery is not configured on this server.");
    }

    if (!email) {
      throw new Error("This lead does not have an email address.");
    }

    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject,
      text
    });
  };

  try {
    if (cleanAction === "send-tax-prep-email") {
      await sendClientEmail({
        subject: "Next Step: Get Your 1040 Tax Return Prepared",
        text:
`Hello ${name},

Thank you for reaching out to Greatest Business Solution LLC.

Based on your request regarding ${service}, the next best step is to start your 1040 tax return preparation intake so we can review your filing situation properly.

Start here:
${taxPrepUrl}

You can also schedule a short consultation if you want to talk through your situation first:
${bookingUrl}

Please do not email Social Security numbers, tax documents, bank information, or other sensitive records until we provide secure instructions.

Thank you,
Greatest Business Solution LLC`
      });

      newStatus = "Contact Request - 1040 Tax Prep Email Sent";
      requestUpdate = {
        ...requestUpdate,
        conversionOpportunityStage: "outreach_sent",
        conversionLastAction: "1040 Tax Prep Email Sent",
        conversionEmailType: "1040 Tax Prep",
        conversionEmailSentAt: now,
        conversionWaitingSince: now,
        conversionStageChangedAt: now,
        conversionNextFollowUpAt: followUp48Hours,
        taxPrepUrl
      };
      responseMessage = "1040 tax prep help email was sent and the lead was moved to Outreach Sent.";
    }

    if (cleanAction === "send-calendar-email") {
      await sendClientEmail({
        subject: "Schedule Your Tax Consultation",
        text:
`Hello ${name},

Thank you for reaching out to Greatest Business Solution LLC.

Based on your request regarding ${service}, the next best step is to schedule a short consultation so we can understand your situation and recommend the right service.

Schedule here:
${bookingUrl}

Original message or request:
${message || "No message provided."}

Please do not email Social Security numbers, tax documents, bank information, or other sensitive records until we provide secure instructions.

Thank you,
Greatest Business Solution LLC`
      });

      newStatus = "Contact Request - Calendar Link Sent";
      requestUpdate = {
        ...requestUpdate,
        conversionOpportunityStage: "calendar_link_sent",
        conversionLastAction: "Calendar Scheduling Email Sent",
        conversionEmailType: "Calendar Scheduling",
        conversionEmailSentAt: now,
        conversionWaitingSince: now,
        conversionStageChangedAt: now,
        conversionNextFollowUpAt: followUp48Hours,
        bookingUrl
      };
      responseMessage = "Calendar scheduling email was sent and the lead is now waiting on the client to schedule.";
    }

    if (cleanAction === "send-follow-up-email") {
      const priorFollowUpCount =
        Number(currentRequest.conversionFollowUpCount || 0);

      await sendClientEmail({
        subject: "Following Up on Your Tax Help Request",
        text:
`Hello ${name},

I wanted to follow up on your recent request regarding ${service}.

If you would like to speak with us, you can schedule a short consultation here:
${bookingUrl}

If you are ready to have your 1040 tax return prepared, you can begin here:
${taxPrepUrl}

If you no longer need assistance, no action is required.

Please do not email Social Security numbers, tax documents, bank information, or other sensitive records until we provide secure instructions.

Thank you,
Greatest Business Solution LLC`
      });

      newStatus =
        "Contact Request - Follow-Up Email Sent";

      requestUpdate = {
        ...requestUpdate,
        conversionOpportunityStage:
          "follow_up_sent",

        conversionLastAction:
          "Follow-Up Email Sent",

        conversionFollowUpSentAt:
          now,

        conversionFollowUpCount:
          priorFollowUpCount + 1,

        conversionWaitingSince:
          now,

        conversionStageChangedAt:
          now,

        conversionNextFollowUpAt:
          followUp5Days,

        bookingUrl,
        taxPrepUrl
      };

      responseMessage =
        "Follow-up email was sent. The lead is waiting on the client, with the next review due in 5 days.";
    }

    if (cleanAction === "mark-contacted") {
      newStatus = "Contact Request - Contacted";
      requestUpdate = {
        ...requestUpdate,
        conversionOpportunityStage: "waiting_client",
        conversionContactedAt: now,
        conversionWaitingSince: now,
        conversionStageChangedAt: now,
        conversionNextFollowUpAt: followUp48Hours,
        conversionLastAction: "Marked Contacted"
      };
      responseMessage = "Lead was marked contacted.";
    }

    if (cleanAction === "snooze-follow-up") {
      const snoozedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      newStatus = "Contact Request - Follow-Up Snoozed";
      requestUpdate = {
        ...requestUpdate,
        conversionOpportunityStage: "snoozed",
        conversionSnoozedAt: now,
        conversionSnoozedUntil: snoozedUntil,
        conversionStageChangedAt: now,
        conversionNextFollowUpAt: snoozedUntil,
        conversionLastAction: "Snoozed 7 Days"
      };
      responseMessage = "Opportunity was snoozed for 7 days.";
    }

    if (cleanAction === "close-opportunity") {
      newStatus = "Closed - Opportunity Not Moving Forward";
      completedAt = now;
      closedAt = now;
      requestUpdate = {
        ...requestUpdate,
        conversionOpportunityStage: "closed",
        conversionClosedAt: now,
        conversionStageChangedAt: now,
        conversionLastAction: "Closed Opportunity"
      };
      responseMessage = "Opportunity was closed and removed from active conversion work.";
    }

    if (cleanAction === "convert-tax-prep") {
      newStatus =
        "Tax Preparation - Portal Activation Needed";

      let portalEmailSent = false;
      let portalEmailError = "";

      try {
        await sendClientEmail({
          subject:
            "Your Tax Preparation Request and Secure Portal",
          text:
`Hello ${name},

Your request has been moved into the Tax Preparation Work Center for professional review.

Secure client portal:
${portalActivationUrl}

Use your email address and client reference number below to request a six-digit activation code:
${cleanId}

The same secure portal will be used for tax-preparation documents, office updates, signatures, and any available final client copy. Do not email Social Security numbers, W-2s, 1099s, tax returns, bank information, or passwords.

You may update your Tax Preparation intake here:
${taxPrepUrl}

Thank you,
Greatest Business Solution LLC`
        });

        portalEmailSent = true;
      } catch (emailError) {
        portalEmailError =
          emailError?.message ||
          "Portal instructions email failed.";

        console.error(
          "[opportunity-action] Tax Preparation portal email failed:",
          cleanId,
          portalEmailError
        );
      }

      requestUpdate = {
        ...requestUpdate,
        conversionOpportunityStage:
          "converted_tax_prep",
        convertedToTaxPrepAt: now,
        conversionStageChangedAt: now,
        conversionLastAction:
          "Converted to Tax Preparation Client",
        requestedService:
          "Get My Tax Return Prepared",
        portalActivationUrl,
        portalInstructionsEmailSent:
          portalEmailSent,
        portalInstructionsEmailSentAt:
          portalEmailSent
            ? now
            : "",
        portalInstructionsEmailError:
          portalEmailSent
            ? ""
            : portalEmailError
      };

      responseMessage =
        portalEmailSent
          ? "Lead was converted, moved to Tax Preparation Requests, and sent secure portal instructions."
          : "Lead was converted and moved to Tax Preparation Requests. Portal instructions email needs office follow-up.";
    }

    const stageLabels = {
      outreach_sent: "Waiting on Client",
      calendar_link_sent: "Waiting on Client",
      follow_up_sent: "Waiting on Client",
      waiting_client: "Waiting on Client",
      snoozed: "Snoozed",
      closed: "Closed",
      converted_tax_prep: "Tax Prep Request"
    };

    requestUpdate = {
      ...requestUpdate,
      conversionStageChangedAt:
        requestUpdate.conversionStageChangedAt || now,

      conversionActivityHistory:
        addHistoryEntry(
          requestUpdate.conversionLastAction ||
          "Opportunity Updated",

          stageLabels[
            requestUpdate.conversionOpportunityStage
          ] ||
          "Opportunity Updated"
        )
    };

    const updateResult = await updateLeadAfterStripePayment(cleanId, (estimate = {}) => {
      const updated = {
        ...estimate,
        status: newStatus,
        Request: {
          ...(estimate.Request || {}),
          ...requestUpdate,
          updatedAt: now
        }
      };

      if (
        cleanAction ===
        "convert-tax-prep"
      ) {
        updated.taxPreparationIntake = {
          ...(estimate.taxPreparationIntake || {}),
          sourceLeadId: cleanId,
          submittedAt:
            estimate.taxPreparationIntake
              ?.submittedAt ||
            now,
          taxYear:
            estimate.taxPreparationIntake
              ?.taxYear ||
            lead.taxData?.taxYear ||
            "",
          recommendedLane:
            estimate.taxPreparationIntake
              ?.recommendedLane ||
            "Individual Form 1040",
          needsProfessionalReview: true
        };

        updated.taxPreparationWork = {
          ...(estimate.taxPreparationWork || {}),
          version: 1,
          workStatus:
            "Portal Activation Needed",
          documentStatus:
            estimate.taxPreparationWork
              ?.documentStatus ||
            "Documents Needed",
          paymentStatus:
            estimate.taxPreparationWork
              ?.paymentStatus ||
            "Not Set",
          efileStatus:
            estimate.taxPreparationWork
              ?.efileStatus ||
            "Not Started",
          finalReturnDeliveryStatus:
            estimate.taxPreparationWork
              ?.finalReturnDeliveryStatus ||
            "Not Delivered",
          convertedAt:
            estimate.taxPreparationWork
              ?.convertedAt ||
            now,
          updatedAt: now
        };
      }

      if (completedAt) updated.completedAt = completedAt;
      if (closedAt) updated.closedAt = closedAt;

      return updated;
    });

    if (!updateResult.ok) {
      return res.status(500).json({
        ok: false,
        error: updateResult.error || "Could not update the lead after the opportunity action."
      });
    }

    return res.status(200).json({
      ok: true,
      action: cleanAction,
      status: newStatus,
      message: responseMessage
    });
  } catch (error) {
    console.error(
      "[opportunity-action] Failed:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      error: error.message || "Opportunity action failed."
    });
  }
});


// =============================================================================
// POST /api/leads/:leadId/send-google-review-request
// Sends a review-request email only for completed services.
// Records the send date and prevents accidental duplicates.
// =============================================================================
app.post("/api/leads/:leadId/send-google-review-request", async (req, res) => {
  const cleanId = String(req.params.leadId || "").trim();
  const force = req.body?.force === true;
  const now = new Date().toISOString();

  const googleReviewUrl =
    process.env.GOOGLE_REVIEW_URL ||
    "https://g.page/r/CYlHVe-ARG5VEAI/review";

  if (!cleanId) {
    return res.status(400).json({
      ok: false,
      error: "Missing lead ID."
    });
  }

  const matchesLeadId = (obj = {}) => {
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
  };

  const findLead = async () => {
    try {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        const row = data.find(matchesLeadId);

        if (row) {
          return mapRowToLead(row);
        }
      }
    } catch (error) {
      console.error(
        "[google-review-request] Supabase lookup failed:",
        error.message || error
      );
    }

    return readLeads().find(matchesLeadId) || null;
  };

  const lead = await findLead();

  if (!lead) {
    return res.status(404).json({
      ok: false,
      error: "Lead not found."
    });
  }

  const name = String(
    lead?.contact?.name ||
    lead?.calendarAppointment?.inviteeName ||
    "Client"
  ).trim();

  const email = String(
    lead?.contact?.email ||
    lead?.calendarAppointment?.inviteeEmail ||
    ""
  ).trim();

  if (!email) {
    return res.status(400).json({
      ok: false,
      error: "This completed client does not have an email address."
    });
  }

  const status = String(lead?.status || "").toLowerCase();
  const calendarStatus = String(
    lead?.calendarAppointment?.status || ""
  ).toLowerCase();

  const isNoShowOrCanceled =
    status.includes("no-show") ||
    status.includes("no show") ||
    status.includes("cancel") ||
    calendarStatus.includes("no-show") ||
    calendarStatus.includes("no show") ||
    calendarStatus.includes("cancel");

  const isClosedWithoutService =
    status.includes("not moving forward") ||
    status.includes("opportunity not moving forward");

  const isCompletedService =
    Boolean(
      lead?.completedAt ||
      lead?.closedAt ||
      lead?.writtenReviewDeliveredAt ||
      lead?.writtenReviewCompletedAt ||
      lead?.writtenReview?.deliveredAt ||
      lead?.writtenReview?.completedAt
    ) ||
    status.includes("completed") ||
    status.includes("delivered") ||
    calendarStatus === "completed";

  if (
    !isCompletedService ||
    isNoShowOrCanceled ||
    isClosedWithoutService
  ) {
    return res.status(400).json({
      ok: false,
      error:
        "Google review requests are available only after a completed client service."
    });
  }

  const requestMeta =
    lead?.Request &&
    typeof lead.Request === "object" &&
    !Array.isArray(lead.Request)
      ? lead.Request
      : {};

  const priorSentAt = String(
    requestMeta.googleReviewRequestLastSentAt ||
    requestMeta.googleReviewRequestSentAt ||
    ""
  ).trim();

  if (priorSentAt && !force) {
    return res.status(409).json({
      ok: false,
      alreadySent: true,
      sentAt: priorSentAt,
      error:
        "A Google review request was already sent to this client."
    });
  }

  if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
    return res.status(500).json({
      ok: false,
      error: "Email delivery is not configured on this server."
    });
  }

  const firstName =
    name.split(/\s+/).filter(Boolean)[0] || "there";

  try {
    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject:
        "Would You Share Your Experience with Greatest Business Solution LLC?",
      text:
`Hello ${firstName},

Thank you for choosing Greatest Business Solution LLC.

Would you be willing to share an honest Google review about your experience? Your feedback helps other individuals and small-business owners understand what to expect when they need tax or business assistance.

Leave your review here:
${googleReviewUrl}

Please share only what you are comfortable making public. For your privacy, do not include Social Security numbers, tax documents, bank information, refund amounts, tax balances, or other sensitive financial details.

Thank you again for allowing Greatest Business Solution LLC to assist you.

Greatest Business Solution LLC`
    });

    const previousCount = Number(
      requestMeta.googleReviewRequestCount || 0
    );

    const existingHistory =
      Array.isArray(requestMeta.serviceActivityHistory)
        ? requestMeta.serviceActivityHistory
            .filter((entry) => entry && (entry.action || entry.at))
            .slice(-24)
        : [];

    const updateResult =
      await updateLeadAfterStripePayment(
        cleanId,
        (estimate = {}) => ({
          ...estimate,
          Request: {
            ...(estimate.Request || {}),
            googleReviewRequestStatus: "Sent",
            googleReviewRequestSentAt:
              requestMeta.googleReviewRequestSentAt || now,
            googleReviewRequestLastSentAt: now,
            googleReviewRequestCount: previousCount + 1,
            googleReviewUrl,
            serviceActivityHistory: [
              ...existingHistory,
              {
                action:
                  previousCount > 0
                    ? "Google Review Request Resent"
                    : "Google Review Request Sent",
                at: now
              }
            ].slice(-25),
            updatedAt: now
          }
        })
      );

    if (!updateResult.ok) {
      console.error(
        "[google-review-request] Email sent but history update failed:",
        updateResult.error
      );

      return res.status(500).json({
        ok: false,
        emailSent: true,
        error:
          "The review email was sent, but the send history could not be saved."
      });
    }

    return res.status(200).json({
      ok: true,
      sentAt: now,
      reviewUrl: googleReviewUrl,
      message:
        previousCount > 0
          ? "Google review request was resent and recorded."
          : "Google review request was sent and recorded."
    });
  } catch (error) {
    console.error(
      "[google-review-request] Failed:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      error:
        error.message ||
        "The Google review request could not be sent."
    });
  }
});

function getMembershipRequestRecord(record = {}) {
  const request =
    record.contactRequest &&
    typeof record.contactRequest === "object" &&
    !Array.isArray(record.contactRequest)
      ? record.contactRequest
      : {};

  const fallback =
    record.Request &&
    typeof record.Request === "object" &&
    !Array.isArray(record.Request)
      ? record.Request
      : {};

  return {
    ...fallback,
    ...request
  };
}

function getMembershipPlanDetails(record = {}) {
  const request = getMembershipRequestRecord(record);
  const service = String(request.service || "").trim();
  const message = String(request.message || "").trim();
  const combined = `${service} ${message}`.toLowerCase();
  const pinnacle = combined.includes("pinnacle tax action plan");
  const annual = combined.includes("annual");
  const monthly = combined.includes("monthly");

  return {
    planKey: pinnacle ? "pinnacle" : "tax-watch-pro",
    planName: pinnacle
      ? "Pinnacle Tax Action Plan"
      : "Tax Watch Pro",
    billingFrequency: annual
      ? "annual"
      : monthly
        ? "monthly"
        : "not-selected",
    billingLabel: annual
      ? "Annual"
      : monthly
        ? "Monthly"
        : "Not selected",
    selectedPriceCents: pinnacle
      ? annual
        ? 34900
        : 3499
      : annual
        ? 11900
        : 1199,
    selectedPriceDisplay: pinnacle
      ? annual
        ? "$349 per year"
        : "$34.99 per month"
      : annual
        ? "$119 per year"
        : "$11.99 per month"
  };
}

function getMembershipRequestTime(record = {}) {
  return String(
    record.timestamp ||
    record.createdAt ||
    record.created_at ||
    record.updatedAt ||
    ""
  ).trim();
}

function buildMembershipEnrollmentBase(record = {}) {
  const request = getMembershipRequestRecord(record);
  const current =
    request.membershipEnrollment &&
    typeof request.membershipEnrollment === "object" &&
    !Array.isArray(request.membershipEnrollment)
      ? request.membershipEnrollment
      : {};
  const plan = getMembershipPlanDetails(record);
  const requestedAt = String(
    current.requestedAt ||
    getMembershipRequestTime(record) ||
    new Date().toISOString()
  );
  const history = Array.isArray(current.statusHistory)
    ? current.statusHistory
        .filter((entry) => entry && (entry.status || entry.at))
        .slice(-49)
    : [];

  if (!history.length) {
    history.push({
      status: "Enrollment Requested",
      paymentStatus: "Not Paid",
      action: "Enrollment request received",
      at: requestedAt
    });
  }

  return {
    version: Math.max(2, Number(current.version || 1)),
    planKey: String(current.planKey || plan.planKey),
    planName: String(current.planName || plan.planName),
    billingFrequency: String(
      current.billingFrequency || plan.billingFrequency
    ),
    billingLabel: String(
      current.billingLabel || plan.billingLabel
    ),
    selectedPriceCents: Number(
      current.selectedPriceCents || plan.selectedPriceCents
    ),
    selectedPriceDisplay: String(
      current.selectedPriceDisplay || plan.selectedPriceDisplay
    ),
    enrollmentStatus: String(
      current.enrollmentStatus || "Enrollment Requested"
    ),
    paymentStatus: String(
      current.paymentStatus || "Not Paid"
    ),
    requestedAt,
    enrollmentStepsSentAt: String(
      current.enrollmentStepsSentAt || ""
    ),
    paymentPendingAt: String(
      current.paymentPendingAt || ""
    ),
    paymentConfirmedAt: String(
      current.paymentConfirmedAt || ""
    ),
    membershipStartedAt: String(
      current.membershipStartedAt || ""
    ),
    nextRenewalAt: String(
      current.nextRenewalAt || ""
    ),
    pastDueAt: String(current.pastDueAt || ""),
    cancelledAt: String(current.cancelledAt || ""),
    expiredAt: String(current.expiredAt || ""),
    closedAt: String(current.closedAt || ""),
    endedAt: String(current.endedAt || ""),
    stripeCheckoutSessionId: String(
      current.stripeCheckoutSessionId || ""
    ),
    stripeCustomerId: String(
      current.stripeCustomerId || ""
    ),
    stripeSubscriptionId: String(
      current.stripeSubscriptionId || ""
    ),
    stripeLatestInvoiceId: String(
      current.stripeLatestInvoiceId || ""
    ),
    stripeLatestEventId: String(
      current.stripeLatestEventId || ""
    ),
    stripeSubscriptionStatus: String(
      current.stripeSubscriptionStatus || ""
    ),
    stripeCurrentPeriodEnd: String(
      current.stripeCurrentPeriodEnd || ""
    ),
    checkoutCreatedAt: String(
      current.checkoutCreatedAt || ""
    ),
    checkoutEnvironment: String(
      current.checkoutEnvironment || ""
    ),
    paymentSource: String(
      current.paymentSource || ""
    ),
    lastPaymentAt: String(
      current.lastPaymentAt || ""
    ),
    lastPaymentAmountCents: Math.max(
      0,
      Number(current.lastPaymentAmountCents || 0)
    ),
    lastPaymentAmountDisplay: String(
      current.lastPaymentAmountDisplay || ""
    ),
    paymentMethodBrand: String(
      current.paymentMethodBrand || ""
    ),
    paymentMethodLast4: String(
      current.paymentMethodLast4 || ""
    ),
    billingHistorySyncedAt: String(
      current.billingHistorySyncedAt || ""
    ),
    paymentHistory: Array.isArray(
      current.paymentHistory
    )
      ? current.paymentHistory
          .filter(
            (entry) =>
              entry &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              (entry.id || entry.paidAt)
          )
          .map((entry) => ({
            id: String(entry.id || ""),
            invoiceId: String(entry.invoiceId || ""),
            paymentIntentId: String(entry.paymentIntentId || ""),
            chargeId: String(entry.chargeId || ""),
            status: String(entry.status || ""),
            amountPaidCents: Math.max(
              0,
              Number(entry.amountPaidCents || 0)
            ),
            currency: String(entry.currency || "usd"),
            paidAt: String(entry.paidAt || ""),
            planName: String(
              entry.planName || current.planName || plan.planName
            ),
            billingLabel: String(
              entry.billingLabel ||
              current.billingLabel ||
              plan.billingLabel
            ),
            servicePeriodStart: String(
              entry.servicePeriodStart || ""
            ),
            servicePeriodEnd: String(
              entry.servicePeriodEnd || ""
            ),
            cardBrand: String(entry.cardBrand || ""),
            cardLast4: String(entry.cardLast4 || ""),
            receiptUrl: String(entry.receiptUrl || ""),
            hostedInvoiceUrl: String(
              entry.hostedInvoiceUrl || ""
            ),
            invoicePdfUrl: String(
              entry.invoicePdfUrl || ""
            ),
            billingReason: String(
              entry.billingReason || ""
            ),
            environment: String(
              entry.environment || ""
            )
          }))
          .sort(
            (left, right) =>
              Date.parse(right.paidAt || 0) -
              Date.parse(left.paidAt || 0)
          )
          .slice(0, 240)
      : [],
    renewalCount: Math.max(
      0,
      Number.parseInt(current.renewalCount, 10) || 0
    ),
    cancelAtPeriodEnd:
      current.cancelAtPeriodEnd === true,
    cancelAt: String(current.cancelAt || ""),
    processedStripeEventIds: Array.isArray(
      current.processedStripeEventIds
    )
      ? current.processedStripeEventIds
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .slice(-99)
      : [],
    latestAction: String(
      current.latestAction || "Enrollment request received"
    ),
    statusUpdatedAt: String(
      current.statusUpdatedAt || requestedAt
    ),
    statusHistory: history
  };
}

function getMembershipRenewalDate(startIso, billingFrequency) {
  const date = new Date(startIso);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  if (billingFrequency === "annual") {
    date.setUTCFullYear(date.getUTCFullYear() + 1);
  } else {
    date.setUTCMonth(date.getUTCMonth() + 1);
  }

  return date.toISOString();
}

function applyMembershipAction(record = {}, action, now) {
  const current = buildMembershipEnrollmentBase(record);
  const next = { ...current };
  const actionMap = {
    "reset-requested": {
      enrollmentStatus: "Enrollment Requested",
      paymentStatus: "Not Paid",
      latestAction: "Enrollment request received"
    },
    "steps-sent": {
      enrollmentStatus: "Enrollment Steps Sent",
      paymentStatus: "Not Paid",
      latestAction: "Secure enrollment steps sent"
    },
    "payment-pending": {
      enrollmentStatus: "Payment Pending",
      paymentStatus: "Pending",
      latestAction: "Waiting for membership payment"
    },
    activate: {
      enrollmentStatus: "Active Membership",
      paymentStatus: "Paid / Confirmed",
      latestAction: "Membership activated"
    },
    "past-due": {
      enrollmentStatus: "Past Due",
      paymentStatus: "Past Due",
      latestAction: "Membership payment is past due"
    },
    cancel: {
      enrollmentStatus: "Cancelled",
      paymentStatus: "Cancelled",
      latestAction: "Membership cancelled"
    },
    expire: {
      enrollmentStatus: "Expired",
      paymentStatus: "Expired",
      latestAction: "Membership expired"
    },
    close: {
      enrollmentStatus: "Closed",
      paymentStatus: "Closed",
      latestAction: "Enrollment record closed"
    }
  };
  const update = actionMap[action];

  if (!update) {
    return null;
  }

  Object.assign(next, update, {
    statusUpdatedAt: now
  });

  if (action === "steps-sent") {
    next.enrollmentStepsSentAt = now;
  }

  if (action === "payment-pending") {
    next.paymentPendingAt = now;
  }

  if (action === "activate") {
    next.paymentConfirmedAt = now;
    next.membershipStartedAt =
      next.membershipStartedAt || now;
    next.nextRenewalAt = getMembershipRenewalDate(
      next.membershipStartedAt,
      next.billingFrequency
    );
    next.endedAt = "";
    next.cancelledAt = "";
    next.expiredAt = "";
    next.closedAt = "";
    next.pastDueAt = "";
  }

  if (action === "past-due") {
    next.pastDueAt = now;
  }

  if (action === "cancel") {
    next.cancelledAt = now;
    next.endedAt = now;
    next.nextRenewalAt = "";
  }

  if (action === "expire") {
    next.expiredAt = now;
    next.endedAt = now;
    next.nextRenewalAt = "";
  }

  if (action === "close") {
    next.closedAt = now;
  }

  next.statusHistory = [
    ...(Array.isArray(current.statusHistory)
      ? current.statusHistory
      : []),
    {
      status: next.enrollmentStatus,
      paymentStatus: next.paymentStatus,
      action: next.latestAction,
      at: now
    }
  ].slice(-50);

  return next;
}

function normalizeMembershipPlanKey(value) {
  const clean = String(value || "")
    .trim()
    .toLowerCase();

  return clean === "pinnacle" ||
    clean === "pinnacle-tax-action-plan"
    ? "pinnacle"
    : "tax-watch-pro";
}

function normalizeMembershipBillingFrequency(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "annual"
    ? "annual"
    : "monthly";
}

function getMembershipCheckoutPlanConfig(
  planKey,
  billingFrequency
) {
  const normalizedPlan =
    normalizeMembershipPlanKey(planKey);
  const normalizedBilling =
    normalizeMembershipBillingFrequency(
      billingFrequency
    );
  const pinnacle = normalizedPlan === "pinnacle";
  const annual = normalizedBilling === "annual";

  return {
    planKey: normalizedPlan,
    planName: pinnacle
      ? "Pinnacle Tax Action Plan"
      : "Tax Watch Pro",
    billingFrequency: normalizedBilling,
    billingLabel: annual ? "Annual" : "Monthly",
    interval: annual ? "year" : "month",
    selectedPriceCents: pinnacle
      ? annual
        ? 34900
        : 3499
      : annual
        ? 11900
        : 1199,
    selectedPriceDisplay: pinnacle
      ? annual
        ? "$349 per year"
        : "$34.99 per month"
      : annual
        ? "$119 per year"
        : "$11.99 per month",
    productDescription: pinnacle
      ? "Year-round tax tracking plus advanced planning scenarios. Tax preparation and filing are separate professional services."
      : "Year-round income, expense, tax-reserve, and savings-accountability tracking. Tax preparation and filing are separate professional services."
  };
}

function getMembershipCheckoutAvailability() {
  const localTestAvailable =
    !CLIENT_PORTAL_PRODUCTION_HOST &&
    STRIPE_KEY_MODE === "test";

  return {
    stripeConfigured:
      STRIPE_KEY_MODE !== "unavailable",
    stripeMode: STRIPE_KEY_MODE,
    taxWatchAvailable:
      localTestAvailable ||
      (
        CLIENT_PORTAL_PRODUCTION_HOST &&
        STRIPE_KEY_MODE === "live" &&
        TAX_WATCH_STRIPE_CHECKOUT_ENABLED
      ),
    pinnacleAvailable:
      localTestAvailable &&
      PINNACLE_STRIPE_CHECKOUT_ENABLED ||
      (
        CLIENT_PORTAL_PRODUCTION_HOST &&
        STRIPE_KEY_MODE === "live" &&
        PINNACLE_STRIPE_CHECKOUT_ENABLED
      ),
    pinnacleReady:
      PINNACLE_STRIPE_CHECKOUT_ENABLED,
    noAutomaticCharge:
      true
  };
}

function isMembershipEnrollmentRecord(record = {}) {
  const request = getMembershipRequestRecord(record);
  const text = `${request.service || ""} ${request.message || ""}`
    .toLowerCase();

  return text.includes("tax watch pro") ||
    text.includes("pinnacle tax action plan") ||
    Boolean(request.membershipEnrollment);
}

function getMembershipRecordSortTime(record = {}) {
  const enrollment =
    buildMembershipEnrollmentBase(record);
  const parsed = Date.parse(
    enrollment.statusUpdatedAt ||
    enrollment.requestedAt ||
    getMembershipRequestTime(record) ||
    0
  );

  return Number.isFinite(parsed) ? parsed : 0;
}

function getClientPortalMembershipSummary(
  accessible = []
) {
  const membershipEntries = accessible
    .filter((entry) =>
      isMembershipEnrollmentRecord(
        entry?.lead || entry?.raw || {}
      )
    )
    .sort(
      (left, right) =>
        getMembershipRecordSortTime(
          right?.lead || right?.raw || {}
        ) -
        getMembershipRecordSortTime(
          left?.lead || left?.raw || {}
        )
    );

  const preferred =
    membershipEntries.find((entry) => {
      const enrollment =
        buildMembershipEnrollmentBase(
          entry?.lead || entry?.raw || {}
        );

      return enrollment.enrollmentStatus ===
        "Active Membership";
    }) || membershipEntries[0] || null;

  if (!preferred) {
    return {
      exists: false,
      leadId: "",
      planKey: "",
      planName: "",
      billingFrequency: "",
      billingLabel: "",
      selectedPriceDisplay: "",
      enrollmentStatus: "",
      paymentStatus: "",
      requestedAt: "",
      paymentConfirmedAt: "",
      membershipStartedAt: "",
      nextRenewalAt: "",
      statusUpdatedAt: "",
      latestAction: "",
      paymentMethodBrand: "",
      paymentMethodLast4: "",
      paymentHistory: [],
      paidThisYearCents: 0,
      paidThisYearDisplay: "$0.00"
    };
  }

  const enrollment =
    buildMembershipEnrollmentBase(
      preferred.lead || preferred.raw || {}
    );

  return {
    exists: true,
    leadId: String(preferred.leadId || ""),
    planKey: enrollment.planKey,
    planName: enrollment.planName,
    billingFrequency:
      enrollment.billingFrequency,
    billingLabel: enrollment.billingLabel,
    selectedPriceDisplay:
      enrollment.selectedPriceDisplay,
    enrollmentStatus:
      enrollment.enrollmentStatus,
    paymentStatus: enrollment.paymentStatus,
    requestedAt: enrollment.requestedAt,
    paymentConfirmedAt:
      enrollment.paymentConfirmedAt,
    membershipStartedAt:
      enrollment.membershipStartedAt,
    nextRenewalAt: enrollment.nextRenewalAt,
    statusUpdatedAt:
      enrollment.statusUpdatedAt,
    latestAction: enrollment.latestAction,
    paymentMethodBrand:
      enrollment.paymentMethodBrand,
    paymentMethodLast4:
      enrollment.paymentMethodLast4,
    paymentHistory:
      enrollment.paymentHistory,
    paidThisYearCents:
      enrollment.paymentHistory
        .filter((entry) => {
          const paidAt = new Date(entry.paidAt || "");
          return (
            entry.status === "Paid" &&
            Number.isFinite(paidAt.getTime()) &&
            paidAt.getFullYear() ===
              new Date().getFullYear()
          );
        })
        .reduce(
          (total, entry) =>
            total +
            Math.max(
              0,
              Number(entry.amountPaidCents || 0)
            ),
          0
        ),
    paidThisYearDisplay:
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
      }).format(
        enrollment.paymentHistory
          .filter((entry) => {
            const paidAt = new Date(entry.paidAt || "");
            return (
              entry.status === "Paid" &&
              Number.isFinite(paidAt.getTime()) &&
              paidAt.getFullYear() ===
                new Date().getFullYear()
            );
          })
          .reduce(
            (total, entry) =>
              total +
              Math.max(
                0,
                Number(entry.amountPaidCents || 0)
              ),
            0
          ) / 100
      ),
    cancelAtPeriodEnd:
      enrollment.cancelAtPeriodEnd,
    cancelAt: enrollment.cancelAt
  };
}

function getStripeObjectId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value.id || "").trim();
}

function stripeUnixToIso(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  return new Date(seconds * 1000).toISOString();
}

function getStripeSubscriptionPeriodEnd(subscription = {}) {
  const direct = Number(
    subscription.current_period_end || 0
  );
  const itemEnd = Number(
    subscription.items?.data?.[0]
      ?.current_period_end || 0
  );

  return stripeUnixToIso(direct || itemEnd);
}

function getStripeSubscriptionStart(subscription = {}) {
  return stripeUnixToIso(
    subscription.start_date ||
    subscription.billing_cycle_anchor ||
    subscription.created ||
    0
  );
}

function getStripeInvoiceSubscriptionId(invoice = {}) {
  return getStripeObjectId(
    invoice.subscription ||
    invoice.parent?.subscription_details
      ?.subscription ||
    invoice.lines?.data?.[0]?.parent
      ?.subscription_item_details?.subscription
  );
}


function getStripeInvoicePaymentIntentId(invoice = {}) {
  return getStripeObjectId(
    invoice.payment_intent ||
    invoice.payments?.data?.[0]?.payment?.payment_intent ||
    invoice.payments?.data?.[0]?.payment_intent
  );
}

async function retrieveStripePaymentIntent(value) {
  const id = getStripeObjectId(value);
  if (!id) return null;

  try {
    return await stripe.paymentIntents.retrieve(
      id,
      {
        expand: [
          "payment_method",
          "latest_charge"
        ]
      }
    );
  } catch (error) {
    console.error(
      "[membership stripe] Payment Intent lookup failed:",
      error.message || error
    );
    return null;
  }
}

async function retrieveStripeCharge(value) {
  const id = getStripeObjectId(value);
  if (!id) return null;

  try {
    return await stripe.charges.retrieve(id);
  } catch (error) {
    console.error(
      "[membership stripe] Charge lookup failed:",
      error.message || error
    );
    return null;
  }
}

function getMembershipPaymentMethodDetails(
  charge = {},
  paymentIntent = {},
  subscription = {}
) {
  const chargeCard =
    charge.payment_method_details?.card || {};
  const intentMethod =
    paymentIntent.payment_method &&
    typeof paymentIntent.payment_method === "object"
      ? paymentIntent.payment_method
      : {};
  const intentCard = intentMethod.card || {};
  const subscriptionMethod =
    subscription.default_payment_method &&
    typeof subscription.default_payment_method === "object"
      ? subscription.default_payment_method
      : {};
  const subscriptionCard =
    subscriptionMethod.card || {};

  const brand = String(
    chargeCard.brand ||
    intentCard.brand ||
    subscriptionCard.brand ||
    ""
  ).trim();

  const last4 = String(
    chargeCard.last4 ||
    intentCard.last4 ||
    subscriptionCard.last4 ||
    ""
  ).trim();

  return {
    brand,
    last4
  };
}

function normalizeMembershipPaymentRecord(
  record = {},
  fallback = {}
) {
  const paidAt = String(
    record.paidAt ||
    fallback.paidAt ||
    new Date().toISOString()
  );
  const invoiceId = String(
    record.invoiceId ||
    fallback.invoiceId ||
    ""
  );
  const paymentIntentId = String(
    record.paymentIntentId ||
    fallback.paymentIntentId ||
    ""
  );
  const chargeId = String(
    record.chargeId ||
    fallback.chargeId ||
    ""
  );

  return {
    id: String(
      record.id ||
      invoiceId ||
      paymentIntentId ||
      chargeId ||
      `membership-payment-${Date.parse(paidAt) || Date.now()}`
    ),
    invoiceId,
    paymentIntentId,
    chargeId,
    status: String(
      record.status ||
      fallback.status ||
      "Paid"
    ),
    amountPaidCents: Math.max(
      0,
      Number(
        record.amountPaidCents ??
        fallback.amountPaidCents ??
        0
      )
    ),
    currency: String(
      record.currency ||
      fallback.currency ||
      "usd"
    ).toLowerCase(),
    paidAt,
    planName: String(
      record.planName ||
      fallback.planName ||
      "Tax Watch Pro"
    ),
    billingLabel: String(
      record.billingLabel ||
      fallback.billingLabel ||
      "Monthly"
    ),
    servicePeriodStart: String(
      record.servicePeriodStart ||
      fallback.servicePeriodStart ||
      ""
    ),
    servicePeriodEnd: String(
      record.servicePeriodEnd ||
      fallback.servicePeriodEnd ||
      ""
    ),
    cardBrand: String(
      record.cardBrand ||
      fallback.cardBrand ||
      ""
    ),
    cardLast4: String(
      record.cardLast4 ||
      fallback.cardLast4 ||
      ""
    ),
    receiptUrl: String(
      record.receiptUrl ||
      fallback.receiptUrl ||
      ""
    ),
    hostedInvoiceUrl: String(
      record.hostedInvoiceUrl ||
      fallback.hostedInvoiceUrl ||
      ""
    ),
    invoicePdfUrl: String(
      record.invoicePdfUrl ||
      fallback.invoicePdfUrl ||
      ""
    ),
    billingReason: String(
      record.billingReason ||
      fallback.billingReason ||
      ""
    ),
    environment: String(
      record.environment ||
      fallback.environment ||
      ""
    )
  };
}

async function buildMembershipPaymentRecordFromInvoice(
  invoice = {},
  subscription = {},
  config = {},
  occurredAt = ""
) {
  const paymentIntent =
    await retrieveStripePaymentIntent(
      getStripeInvoicePaymentIntentId(invoice)
    );
  const charge =
    await retrieveStripeCharge(
      invoice.charge ||
      paymentIntent?.latest_charge
    );
  const method =
    getMembershipPaymentMethodDetails(
      charge || {},
      paymentIntent || {},
      subscription || {}
    );
  const paidAt =
    stripeUnixToIso(
      invoice.status_transitions?.paid_at ||
      charge?.created ||
      paymentIntent?.created ||
      invoice.created ||
      0
    ) ||
    occurredAt ||
    new Date().toISOString();

  return normalizeMembershipPaymentRecord(
    {
      id:
        invoice.id ||
        paymentIntent?.id ||
        charge?.id ||
        "",
      invoiceId: invoice.id || "",
      paymentIntentId:
        paymentIntent?.id ||
        getStripeInvoicePaymentIntentId(invoice),
      chargeId:
        charge?.id ||
        getStripeObjectId(invoice.charge),
      status:
        invoice.paid === true ||
        invoice.status === "paid"
          ? "Paid"
          : invoice.status === "open"
            ? "Pending"
            : invoice.status === "void"
              ? "Void"
              : invoice.status === "uncollectible"
                ? "Failed"
                : String(invoice.status || "Pending"),
      amountPaidCents:
        Number(invoice.amount_paid || 0),
      currency: invoice.currency || "usd",
      paidAt,
      planName:
        config.planName ||
        subscription.metadata?.planName ||
        "Tax Watch Pro",
      billingLabel:
        config.billingLabel ||
        (subscription.metadata?.billingFrequency === "annual"
          ? "Annual"
          : "Monthly"),
      servicePeriodStart:
        stripeUnixToIso(
          invoice.period_start ||
          invoice.lines?.data?.[0]?.period?.start ||
          0
        ),
      servicePeriodEnd:
        stripeUnixToIso(
          invoice.period_end ||
          invoice.lines?.data?.[0]?.period?.end ||
          0
        ),
      cardBrand: method.brand,
      cardLast4: method.last4,
      receiptUrl: charge?.receipt_url || "",
      hostedInvoiceUrl:
        invoice.hosted_invoice_url || "",
      invoicePdfUrl: invoice.invoice_pdf || "",
      billingReason: invoice.billing_reason || "",
      environment:
        invoice.livemode === true
          ? "live"
          : "test"
    }
  );
}

function mergeMembershipPaymentHistory(
  currentHistory = [],
  incomingHistory = []
) {
  const byId = new Map();

  [
    ...(Array.isArray(currentHistory)
      ? currentHistory
      : []),
    ...(Array.isArray(incomingHistory)
      ? incomingHistory
      : [])
  ].forEach((entry) => {
    const normalized =
      normalizeMembershipPaymentRecord(entry);
    const key = String(
      normalized.id ||
      normalized.invoiceId ||
      normalized.paymentIntentId ||
      normalized.chargeId ||
      normalized.paidAt
    );

    if (!key) return;

    byId.set(
      key,
      {
        ...(byId.get(key) || {}),
        ...normalized
      }
    );
  });

  return Array.from(byId.values())
    .sort(
      (left, right) =>
        Date.parse(right.paidAt || 0) -
        Date.parse(left.paidAt || 0)
    )
    .slice(0, 240);
}

async function synchronizeMembershipBillingHistory(
  leadId,
  force = false
) {
  const candidate =
    await findClientPortalLeadById(leadId);

  if (!candidate) {
    return {
      ok: false,
      error: "Membership lead was not found."
    };
  }

  const current =
    buildMembershipEnrollmentBase(
      candidate.lead || candidate.raw || {}
    );
  const lastSync = Date.parse(
    current.billingHistorySyncedAt || 0
  );

  if (
    !force &&
    Number.isFinite(lastSync) &&
    Date.now() - lastSync < 5 * 60 * 1000
  ) {
    return {
      ok: true,
      skipped: true,
      membership: current
    };
  }

  if (!current.stripeSubscriptionId) {
    return {
      ok: true,
      skipped: true,
      membership: current
    };
  }

  const subscription =
    await stripe.subscriptions.retrieve(
      current.stripeSubscriptionId,
      {
        expand: [
          "default_payment_method"
        ]
      }
    );
  const invoiceList =
    await stripe.invoices.list({
      subscription:
        current.stripeSubscriptionId,
      limit: 100
    });
  const config =
    getMembershipCheckoutPlanConfig(
      current.planKey,
      current.billingFrequency
    );
  const paymentHistory = [];

  for (const invoice of invoiceList.data || []) {
    paymentHistory.push(
      await buildMembershipPaymentRecordFromInvoice(
        invoice,
        subscription,
        config,
        ""
      )
    );
  }

  const now = new Date().toISOString();
  const mergedHistory =
    mergeMembershipPaymentHistory(
      current.paymentHistory,
      paymentHistory
    );
  const latestPaid =
    mergedHistory.find(
      (entry) => entry.status === "Paid"
    ) || mergedHistory[0] || null;
  const updateResult =
    await updateLeadAfterStripePayment(
      leadId,
      (record = {}) => {
        const request =
          getMembershipRequestRecord(record);
        const enrollment =
          buildMembershipEnrollmentBase(record);
        const next = {
          ...enrollment,
          version: 3,
          billingHistorySyncedAt: now,
          paymentHistory: mergedHistory,
          paymentMethodBrand:
            latestPaid?.cardBrand ||
            enrollment.paymentMethodBrand ||
            "",
          paymentMethodLast4:
            latestPaid?.cardLast4 ||
            enrollment.paymentMethodLast4 ||
            ""
        };

        return {
          ...record,
          contactRequest: {
            ...request,
            membershipEnrollment: next
          },
          updatedAt: now
        };
      }
    );

  if (!updateResult.ok) {
    return updateResult;
  }

  return {
    ok: true,
    membership:
      buildMembershipEnrollmentBase(
        updateResult.lead || {}
      )
  };
}

function getMembershipCheckoutBaseUrl(req) {
  const host = String(
    req.get("host") || ""
  ).trim().toLowerCase();
  const forwardedProtocol = String(
    req.headers["x-forwarded-proto"] || ""
  ).split(",")[0].trim();
  const protocol = forwardedProtocol ||
    (req.secure ? "https" : "http");
  const allowedRequestHost =
    host === "localhost:3000" ||
    host.startsWith("127.0.0.1:") ||
    host === "taxestimatereview.com" ||
    host === "www.taxestimatereview.com" ||
    host.endsWith(".onrender.com");

  if (host && allowedRequestHost) {
    return `${protocol}://${host}`;
  }

  return String(APP_BASE_URL || "")
    .replace(/\/+$/, "");
}

function membershipHistoryEntryMatches(
  entry = {},
  status,
  paymentStatus,
  action
) {
  return String(entry.status || "") === status &&
    String(entry.paymentStatus || "") ===
      paymentStatus &&
    String(entry.action || "") === action;
}

async function findMembershipEnrollmentLead(
  email,
  planKey
) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPlan =
    normalizeMembershipPlanKey(planKey);
  const candidates =
    await loadClientPortalLeadCandidates();

  return candidates
    .filter((entry) => {
      if (
        getLeadEmailValue(entry.raw) !==
        normalizedEmail
      ) {
        return false;
      }

      if (
        !isMembershipEnrollmentRecord(
          entry.lead || entry.raw || {}
        )
      ) {
        return false;
      }

      return buildMembershipEnrollmentBase(
        entry.lead || entry.raw || {}
      ).planKey === normalizedPlan;
    })
    .sort(
      (left, right) =>
        getMembershipRecordSortTime(
          right.lead || right.raw || {}
        ) -
        getMembershipRecordSortTime(
          left.lead || left.raw || {}
        )
    )[0] || null;
}

async function ensureMembershipEnrollmentLead(
  session,
  config
) {
  const existing =
    await findMembershipEnrollmentLead(
      session.email,
      config.planKey
    );

  if (existing) {
    return existing;
  }

  const submittedAt = new Date().toISOString();
  const leadId =
    "CONTACT-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase();
  const name = String(
    getLeadNameValue(
      session.accountLead?.raw || {}
    ) || "Client"
  ).trim();
  const phone = String(
    session.accountLead?.lead?.contact?.phone ||
    session.accountLead?.raw?.phone ||
    "Not provided"
  ).trim();
  const message =
    `I selected ${config.planName} — ` +
    `${config.billingLabel} — ` +
    `${config.selectedPriceDisplay}. ` +
    "I understand that recurring billing begins only after I complete secure Stripe Checkout.";
  const enrollment = {
    version: 2,
    planKey: config.planKey,
    planName: config.planName,
    billingFrequency:
      config.billingFrequency,
    billingLabel: config.billingLabel,
    selectedPriceCents:
      config.selectedPriceCents,
    selectedPriceDisplay:
      config.selectedPriceDisplay,
    enrollmentStatus:
      "Enrollment Requested",
    paymentStatus: "Not Paid",
    requestedAt: submittedAt,
    latestAction:
      "Secure subscription checkout selected",
    statusUpdatedAt: submittedAt,
    processedStripeEventIds: [],
    statusHistory: [
      {
        status: "Enrollment Requested",
        paymentStatus: "Not Paid",
        action:
          "Secure subscription checkout selected",
        at: submittedAt
      }
    ]
  };
  const lead = {
    leadId,
    timestamp: submittedAt,
    priority: "medium",
    status:
      "Membership - Enrollment Requested",
    notes:
      `${config.planName} ${config.billingLabel} secure checkout selected.`,
    contact: {
      name,
      email: session.email,
      phone: phone || "Not provided"
    },
    taxData: {},
    estimateSummary: {},
    contactRequest: {
      service: config.planName,
      preferredContact: "Email",
      message,
      submittedAt,
      membershipEnrollment: enrollment
    },
    Request: {
      type: "Membership Enrollment",
      service: config.planName,
      preferredContact: "Email",
      message
    }
  };

  const saved = await appendLead(lead);
  recentLeads.set(saved.leadId, saved);

  return {
    leadId,
    raw: saved,
    lead: saved,
    source: "created"
  };
}

function getMembershipStripeStateFromSubscription(
  subscription = {}
) {
  const status = String(
    subscription.status || ""
  ).toLowerCase();

  if (status === "active" || status === "trialing") {
    return {
      enrollmentStatus: "Active Membership",
      paymentStatus: "Paid / Confirmed",
      latestAction:
        subscription.cancel_at_period_end
          ? "Membership active; cancellation scheduled at period end"
          : "Stripe confirmed active membership"
    };
  }

  if (
    status === "past_due" ||
    status === "unpaid" ||
    status === "paused"
  ) {
    return {
      enrollmentStatus: "Past Due",
      paymentStatus: "Past Due",
      latestAction:
        "Stripe reported that membership payment needs attention"
    };
  }

  if (status === "canceled") {
    return {
      enrollmentStatus: "Cancelled",
      paymentStatus: "Cancelled",
      latestAction:
        "Stripe reported that the membership ended"
    };
  }

  if (status === "incomplete_expired") {
    return {
      enrollmentStatus: "Expired",
      paymentStatus: "Expired",
      latestAction:
        "Stripe checkout expired before payment was completed"
    };
  }

  return {
    enrollmentStatus: "Payment Pending",
    paymentStatus: "Pending",
    latestAction:
      "Stripe is waiting for membership payment to complete"
  };
}

async function applyMembershipStripeUpdate(
  leadId,
  details = {}
) {
  const now = String(
    details.occurredAt ||
    new Date().toISOString()
  );
  const eventId = String(
    details.eventId || ""
  ).trim();

  return updateLeadAfterStripePayment(
    leadId,
    (record = {}) => {
      const request =
        getMembershipRequestRecord(record);
      const current =
        buildMembershipEnrollmentBase(record);
      const processed = new Set(
        current.processedStripeEventIds || []
      );

      if (eventId && processed.has(eventId)) {
        return record;
      }

      const config =
        getMembershipCheckoutPlanConfig(
          details.planKey || current.planKey,
          details.billingFrequency ||
            current.billingFrequency
        );
      const next = {
        ...current,
        version: 2,
        planKey: config.planKey,
        planName: config.planName,
        billingFrequency:
          config.billingFrequency,
        billingLabel: config.billingLabel,
        selectedPriceCents:
          config.selectedPriceCents,
        selectedPriceDisplay:
          config.selectedPriceDisplay,
        enrollmentStatus: String(
          details.enrollmentStatus ||
          current.enrollmentStatus
        ),
        paymentStatus: String(
          details.paymentStatus ||
          current.paymentStatus
        ),
        latestAction: String(
          details.latestAction ||
          current.latestAction
        ),
        statusUpdatedAt: now,
        stripeCheckoutSessionId: String(
          details.checkoutSessionId ||
          current.stripeCheckoutSessionId ||
          ""
        ),
        stripeCustomerId: String(
          details.customerId ||
          current.stripeCustomerId ||
          ""
        ),
        stripeSubscriptionId: String(
          details.subscriptionId ||
          current.stripeSubscriptionId ||
          ""
        ),
        stripeLatestInvoiceId: String(
          details.invoiceId ||
          current.stripeLatestInvoiceId ||
          ""
        ),
        stripeLatestEventId:
          eventId || current.stripeLatestEventId,
        stripeSubscriptionStatus: String(
          details.subscriptionStatus ||
          current.stripeSubscriptionStatus ||
          ""
        ),
        stripeCurrentPeriodEnd: String(
          details.currentPeriodEnd ||
          current.stripeCurrentPeriodEnd ||
          ""
        ),
        checkoutEnvironment: String(
          details.checkoutEnvironment ||
          current.checkoutEnvironment ||
          STRIPE_KEY_MODE
        ),
        paymentSource: String(
          details.paymentSource ||
          current.paymentSource ||
          "Stripe Subscription"
        ),
        cancelAtPeriodEnd:
          details.cancelAtPeriodEnd === true,
        cancelAt: String(
          details.cancelAt ||
          current.cancelAt ||
          ""
        )
      };

      if (details.checkoutCreatedAt) {
        next.checkoutCreatedAt =
          details.checkoutCreatedAt;
      }

      if (details.paymentConfirmedAt) {
        next.paymentConfirmedAt =
          details.paymentConfirmedAt;
        next.lastPaymentAt =
          details.paymentConfirmedAt;
      }

      if (details.membershipStartedAt) {
        next.membershipStartedAt =
          current.membershipStartedAt ||
          details.membershipStartedAt;
      }

      if (details.nextRenewalAt !== undefined) {
        next.nextRenewalAt =
          String(details.nextRenewalAt || "");
      }

      if (details.amountPaidCents !== undefined) {
        const amount = Math.max(
          0,
          Number(details.amountPaidCents || 0)
        );
        next.lastPaymentAmountCents = amount;
        next.lastPaymentAmountDisplay =
          new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD"
          }).format(amount / 100);
      }

      if (details.paymentRecord) {
        const paymentRecord =
          normalizeMembershipPaymentRecord(
            details.paymentRecord,
            {
              planName: config.planName,
              billingLabel:
                config.billingLabel,
              environment:
                details.checkoutEnvironment ||
                current.checkoutEnvironment ||
                STRIPE_KEY_MODE
            }
          );
        next.paymentHistory =
          mergeMembershipPaymentHistory(
            current.paymentHistory,
            [paymentRecord]
          );
        next.paymentMethodBrand =
          paymentRecord.cardBrand ||
          current.paymentMethodBrand ||
          "";
        next.paymentMethodLast4 =
          paymentRecord.cardLast4 ||
          current.paymentMethodLast4 ||
          "";
        next.billingHistorySyncedAt = now;
      }

      if (
        next.enrollmentStatus ===
        "Active Membership"
      ) {
        next.paymentConfirmedAt =
          next.paymentConfirmedAt || now;
        next.lastPaymentAt =
          next.lastPaymentAt || now;
        next.membershipStartedAt =
          next.membershipStartedAt || now;
        next.nextRenewalAt =
          next.nextRenewalAt ||
          getMembershipRenewalDate(
            next.membershipStartedAt,
            next.billingFrequency
          );
        next.pastDueAt = "";
        next.cancelledAt = "";
        next.expiredAt = "";
        next.endedAt = "";
      }

      if (
        next.enrollmentStatus === "Past Due"
      ) {
        next.pastDueAt = now;
      }

      if (
        next.enrollmentStatus === "Cancelled"
      ) {
        next.cancelledAt = now;
        next.endedAt = now;
        next.nextRenewalAt = "";
      }

      if (
        next.enrollmentStatus === "Expired"
      ) {
        next.expiredAt = now;
        next.endedAt = now;
        next.nextRenewalAt = "";
      }

      if (
        details.isRenewal === true &&
        next.enrollmentStatus ===
          "Active Membership"
      ) {
        next.renewalCount =
          Math.max(0, current.renewalCount) + 1;
      }

      if (eventId) {
        processed.add(eventId);
      }
      next.processedStripeEventIds =
        Array.from(processed).slice(-100);

      const lastHistory =
        current.statusHistory?.[
          current.statusHistory.length - 1
        ] || {};
      const shouldAddHistory =
        details.forceHistory === true ||
        !membershipHistoryEntryMatches(
          lastHistory,
          next.enrollmentStatus,
          next.paymentStatus,
          next.latestAction
        );

      next.statusHistory = shouldAddHistory
        ? [
            ...(current.statusHistory || []),
            {
              status: next.enrollmentStatus,
              paymentStatus:
                next.paymentStatus,
              action: next.latestAction,
              at: now,
              source:
                details.paymentSource ||
                "Stripe Subscription"
            }
          ].slice(-50)
        : current.statusHistory;

      const message =
        `I selected ${config.planName} — ` +
        `${config.billingLabel} — ` +
        `${config.selectedPriceDisplay}. ` +
        "Recurring billing is managed through secure Stripe Checkout.";

      return {
        ...record,
        status:
          `Membership - ${next.enrollmentStatus}`,
        notes:
          `${config.planName} ${config.billingLabel}: ${next.latestAction}.`,
        contactRequest: {
          ...request,
          service: config.planName,
          message,
          membershipEnrollment: next
        },
        Request: {
          ...(record.Request || {}),
          type: "Membership Enrollment",
          service: config.planName,
          message
        },
        updatedAt: now
      };
    }
  );
}

async function retrieveStripeSubscription(value) {
  if (!value) return null;
  if (typeof value === "object") return value;

  try {
    return await stripe.subscriptions.retrieve(
      String(value)
    );
  } catch (error) {
    console.error(
      "[membership stripe] Subscription lookup failed:",
      error.message || error
    );
    return null;
  }
}

async function processMembershipCheckoutSession(
  session = {},
  eventId = "",
  occurredAt = ""
) {
  const metadata = session.metadata || {};
  if (
    String(metadata.service || "") !==
      "year_round_membership"
  ) {
    return { ok: true, ignored: true };
  }

  const leadId = String(
    metadata.leadId ||
    session.client_reference_id ||
    ""
  ).trim();

  if (!leadId) {
    return {
      ok: false,
      error:
        "Membership Checkout Session is missing its client reference."
    };
  }

  const subscription =
    await retrieveStripeSubscription(
      session.subscription
    );
  const stripeState = subscription
    ? getMembershipStripeStateFromSubscription(
        subscription
      )
    : session.payment_status === "paid"
      ? {
          enrollmentStatus:
            "Active Membership",
          paymentStatus:
            "Paid / Confirmed",
          latestAction:
            "Stripe confirmed initial membership payment"
        }
      : {
          enrollmentStatus:
            "Payment Pending",
          paymentStatus: "Pending",
          latestAction:
            "Stripe Checkout completed and payment confirmation is pending"
        };
  const paid = session.payment_status === "paid";
  const startedAt = subscription
    ? getStripeSubscriptionStart(subscription)
    : occurredAt || new Date().toISOString();
  const nextRenewalAt = subscription
    ? getStripeSubscriptionPeriodEnd(subscription)
    : "";
  let paymentRecord = null;

  if (paid && subscription) {
    const latestInvoiceId =
      getStripeObjectId(
        subscription.latest_invoice
      );

    if (latestInvoiceId) {
      try {
        const latestInvoice =
          await stripe.invoices.retrieve(
            latestInvoiceId
          );
        const config =
          getMembershipCheckoutPlanConfig(
            metadata.planKey,
            metadata.billingFrequency
          );
        paymentRecord =
          await buildMembershipPaymentRecordFromInvoice(
            latestInvoice,
            subscription,
            config,
            occurredAt
          );
      } catch (error) {
        console.error(
          "[membership stripe] Initial invoice detail lookup failed:",
          error.message || error
        );
      }
    }
  }

  return applyMembershipStripeUpdate(
    leadId,
    {
      eventId,
      occurredAt,
      planKey: metadata.planKey,
      billingFrequency:
        metadata.billingFrequency,
      enrollmentStatus:
        stripeState.enrollmentStatus,
      paymentStatus:
        stripeState.paymentStatus,
      latestAction:
        stripeState.latestAction,
      checkoutSessionId: session.id,
      customerId:
        getStripeObjectId(session.customer),
      subscriptionId:
        getStripeObjectId(
          session.subscription
        ),
      subscriptionStatus:
        String(subscription?.status || ""),
      currentPeriodEnd: nextRenewalAt,
      paymentConfirmedAt:
        paid
          ? occurredAt ||
            new Date().toISOString()
          : "",
      membershipStartedAt:
        paid ? startedAt : "",
      nextRenewalAt:
        paid ? nextRenewalAt : undefined,
      amountPaidCents:
        Number(session.amount_total || 0),
      checkoutEnvironment:
        session.livemode ? "live" : "test",
      paymentSource:
        "Stripe Subscription Checkout",
      paymentRecord,
      invoiceId:
        paymentRecord?.invoiceId || "",
      cancelAtPeriodEnd:
        subscription?.cancel_at_period_end === true,
      cancelAt:
        stripeUnixToIso(
          subscription?.cancel_at || 0
        )
    }
  );
}

async function processMembershipInvoice(
  invoice = {},
  eventId = "",
  eventType = "",
  occurredAt = ""
) {
  const subscriptionId =
    getStripeInvoiceSubscriptionId(invoice);
  const subscription =
    await retrieveStripeSubscription(
      subscriptionId
    );
  const metadata = subscription?.metadata || {};
  const leadId = String(
    metadata.leadId || ""
  ).trim();

  if (
    !leadId ||
    String(metadata.service || "") !==
      "year_round_membership"
  ) {
    return { ok: true, ignored: true };
  }

  const paid =
    eventType === "invoice.paid" ||
    invoice.paid === true ||
    invoice.status === "paid";
  const nextRenewalAt =
    getStripeSubscriptionPeriodEnd(
      subscription || {}
    );
  const config =
    getMembershipCheckoutPlanConfig(
      metadata.planKey,
      metadata.billingFrequency
    );
  const paymentRecord =
    await buildMembershipPaymentRecordFromInvoice(
      invoice,
      subscription || {},
      config,
      occurredAt
    );
  const state = paid
    ? {
        enrollmentStatus:
          "Active Membership",
        paymentStatus:
          "Paid / Confirmed",
        latestAction:
          invoice.billing_reason ===
            "subscription_cycle"
            ? "Stripe confirmed membership renewal payment"
            : "Stripe confirmed membership payment"
      }
    : {
        enrollmentStatus: "Past Due",
        paymentStatus: "Past Due",
        latestAction:
          "Stripe reported that membership payment failed"
      };

  return applyMembershipStripeUpdate(
    leadId,
    {
      eventId,
      occurredAt,
      planKey: metadata.planKey,
      billingFrequency:
        metadata.billingFrequency,
      enrollmentStatus:
        state.enrollmentStatus,
      paymentStatus: state.paymentStatus,
      latestAction: state.latestAction,
      customerId:
        getStripeObjectId(invoice.customer),
      subscriptionId,
      invoiceId: invoice.id,
      subscriptionStatus:
        String(subscription?.status || ""),
      currentPeriodEnd: nextRenewalAt,
      paymentConfirmedAt:
        paid
          ? occurredAt ||
            new Date().toISOString()
          : "",
      membershipStartedAt:
        paid
          ? getStripeSubscriptionStart(
              subscription || {}
            )
          : "",
      nextRenewalAt:
        paid ? nextRenewalAt : undefined,
      amountPaidCents:
        Number(invoice.amount_paid || 0),
      checkoutEnvironment:
        invoice.livemode ? "live" : "test",
      paymentSource: "Stripe Subscription",
      paymentRecord,
      isRenewal:
        paid &&
        invoice.billing_reason ===
          "subscription_cycle",
      forceHistory: paid &&
        invoice.billing_reason ===
          "subscription_cycle",
      cancelAtPeriodEnd:
        subscription?.cancel_at_period_end === true,
      cancelAt:
        stripeUnixToIso(
          subscription?.cancel_at || 0
        )
    }
  );
}

async function processMembershipSubscription(
  subscription = {},
  eventId = "",
  eventType = "",
  occurredAt = ""
) {
  const metadata = subscription.metadata || {};
  const leadId = String(
    metadata.leadId || ""
  ).trim();

  if (
    !leadId ||
    String(metadata.service || "") !==
      "year_round_membership"
  ) {
    return { ok: true, ignored: true };
  }

  const state =
    eventType === "customer.subscription.deleted"
      ? {
          enrollmentStatus: "Cancelled",
          paymentStatus: "Cancelled",
          latestAction:
            "Stripe confirmed that the membership ended"
        }
      : getMembershipStripeStateFromSubscription(
          subscription
        );

  return applyMembershipStripeUpdate(
    leadId,
    {
      eventId,
      occurredAt,
      planKey: metadata.planKey,
      billingFrequency:
        metadata.billingFrequency,
      enrollmentStatus:
        state.enrollmentStatus,
      paymentStatus: state.paymentStatus,
      latestAction: state.latestAction,
      customerId:
        getStripeObjectId(
          subscription.customer
        ),
      subscriptionId: subscription.id,
      subscriptionStatus:
        String(subscription.status || ""),
      currentPeriodEnd:
        getStripeSubscriptionPeriodEnd(
          subscription
        ),
      membershipStartedAt:
        getStripeSubscriptionStart(
          subscription
        ),
      nextRenewalAt:
        state.enrollmentStatus ===
          "Active Membership"
          ? getStripeSubscriptionPeriodEnd(
              subscription
            )
          : state.enrollmentStatus ===
              "Cancelled"
            ? ""
            : undefined,
      checkoutEnvironment:
        subscription.livemode
          ? "live"
          : "test",
      paymentSource: "Stripe Subscription",
      cancelAtPeriodEnd:
        subscription.cancel_at_period_end === true,
      cancelAt:
        stripeUnixToIso(
          subscription.cancel_at || 0
        )
    }
  );
}


app.post(
  "/api/client-portal/membership-billing-history/sync",
  requireClientPortalApiSession,
  async (req, res) => {
    setClientPortalNoStore(res);

    try {
      const accessible =
        await getClientPortalAccessibleLeads(
          req.clientPortalSession.email
        );
      const summary =
        getClientPortalMembershipSummary(
          accessible
        );

      if (!summary.exists || !summary.leadId) {
        return res.status(200).json({
          ok: true,
          membership: summary
        });
      }

      const synchronized =
        await synchronizeMembershipBillingHistory(
          summary.leadId,
          req.body?.force === true
        );

      if (!synchronized.ok) {
        return res.status(500).json({
          ok: false,
          error:
            synchronized.error ||
            "Billing history could not be synchronized."
        });
      }

      const refreshed =
        await getClientPortalAccessibleLeads(
          req.clientPortalSession.email
        );

      return res.status(200).json({
        ok: true,
        membership:
          getClientPortalMembershipSummary(
            refreshed
          )
      });
    } catch (error) {
      console.error(
        "[membership billing history] Sync failed:",
        error.message || error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Billing history could not be synchronized with Stripe."
      });
    }
  }
);


app.post(
  "/api/leads/:leadId/membership-action",
  async (req, res) => {
    const leadId = String(req.params.leadId || "").trim();
    const action = String(req.body?.action || "").trim();
    const allowedActions = new Set([
      "reset-requested",
      "steps-sent",
      "payment-pending",
      "activate",
      "past-due",
      "cancel",
      "expire",
      "close"
    ]);

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error: "Client reference is required."
      });
    }

    if (!allowedActions.has(action)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid membership action."
      });
    }

    const now = new Date().toISOString();

    const result = await updateLeadAfterStripePayment(
      leadId,
      (record = {}) => {
        const request = getMembershipRequestRecord(record);
        const nextEnrollment = applyMembershipAction(
          record,
          action,
          now
        );

        if (!nextEnrollment) {
          return record;
        }

        return {
          ...record,
          status: `Membership - ${nextEnrollment.enrollmentStatus}`,
          contactRequest: {
            ...request,
            membershipEnrollment: nextEnrollment
          },
          updatedAt: now
        };
      }
    );

    if (!result.ok) {
      return res.status(404).json({
        ok: false,
        error:
          result.error ||
          "The membership record could not be updated."
      });
    }

    return res.status(200).json({
      ok: true,
      action,
      updatedAt: now,
      lead: result.lead,
      membershipEnrollment:
        result.lead?.contactRequest?.membershipEnrollment || null
    });
  }
);

app.post(
  "/api/client-portal/membership-checkout",
  requireClientPortalApiSession,
  async (req, res) => {
    try {
      if (!STRIPE_SECRET_KEY) {
        return res.status(503).json({
          ok: false,
          error:
            "Secure Stripe membership checkout is not configured yet."
        });
      }

      const planKey =
        normalizeMembershipPlanKey(
          req.body?.planKey
        );
      const billingFrequency =
        normalizeMembershipBillingFrequency(
          req.body?.billingFrequency
        );
      const config =
        getMembershipCheckoutPlanConfig(
          planKey,
          billingFrequency
        );
      const availability =
        getMembershipCheckoutAvailability();

      if (
        config.planKey === "pinnacle" &&
        !availability.pinnacleAvailable
      ) {
        return res.status(409).json({
          ok: false,
          error:
            "Pinnacle secure checkout will open after the complete Pinnacle planning tools are ready. No payment was created."
        });
      }

      if (
        config.planKey === "tax-watch-pro" &&
        !availability.taxWatchAvailable
      ) {
        const localLiveKeyBlocked =
          !CLIENT_PORTAL_PRODUCTION_HOST &&
          STRIPE_KEY_MODE === "live";

        return res.status(409).json({
          ok: false,
          error: localLiveKeyBlocked
            ? "LOCAL membership testing is blocked because the configured Stripe key is live. Use a Stripe test key locally. Do not send the key to Greatest Business Solution LLC or ChatGPT."
            : "Secure Tax Watch Pro checkout is not enabled for this environment yet. No payment was created."
        });
      }

      const portalSession =
        req.clientPortalSession;
      const existingMembership =
        getClientPortalMembershipSummary(
          await getClientPortalAccessibleLeads(
            portalSession.email
          )
        );
      const activeMembershipExists =
        existingMembership.enrollmentStatus ===
          "Active Membership" &&
        existingMembership.paymentStatus ===
          "Paid / Confirmed";

      if (activeMembershipExists) {
        return res.status(409).json({
          ok: false,
          error:
            "Your Tax Watch Pro membership is already active. No second Stripe subscription was created."
        });
      }

      const enrollmentEntry =
        await ensureMembershipEnrollmentLead(
          portalSession,
          config
        );
      const leadId = String(
        enrollmentEntry.leadId || ""
      ).trim();
      const baseUrl =
        getMembershipCheckoutBaseUrl(req);
      const metadata = {
        service: "year_round_membership",
        leadId,
        planKey: config.planKey,
        planName: config.planName,
        billingFrequency:
          config.billingFrequency,
        selectedPriceCents: String(
          config.selectedPriceCents
        ),
        portalEmail: portalSession.email
      };
      const session =
        await stripe.checkout.sessions.create({
          mode: "subscription",
          customer_email:
            portalSession.email,
          client_reference_id: leadId,
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount:
                  config.selectedPriceCents,
                recurring: {
                  interval: config.interval
                },
                product_data: {
                  name: config.planName,
                  description:
                    config.productDescription
                }
              },
              quantity: 1
            }
          ],
          metadata,
          subscription_data: {
            metadata
          },
          success_url:
            `${baseUrl}/client-portal/home` +
            "?membershipCheckout=success" +
            "&session_id={CHECKOUT_SESSION_ID}" +
            "#tax-watch",
          cancel_url:
            `${baseUrl}/client-portal/home` +
            "?membershipCheckout=cancelled" +
            "#tax-watch"
        });
      const now = new Date().toISOString();
      const saveResult =
        await applyMembershipStripeUpdate(
          leadId,
          {
            eventId:
              `checkout-created:${session.id}`,
            occurredAt: now,
            planKey: config.planKey,
            billingFrequency:
              config.billingFrequency,
            enrollmentStatus:
              "Payment Pending",
            paymentStatus: "Pending",
            latestAction:
              "Secure Stripe subscription checkout created",
            checkoutSessionId: session.id,
            checkoutCreatedAt: now,
            checkoutEnvironment:
              session.livemode
                ? "live"
                : "test",
            paymentSource:
              "Stripe Subscription Checkout"
          }
        );

      if (!saveResult.ok) {
        console.error(
          "[membership checkout] Checkout created but enrollment record could not be updated:",
          leadId,
          saveResult.error || saveResult
        );
      }

      return res.status(201).json({
        ok: true,
        leadId,
        planName: config.planName,
        billingLabel: config.billingLabel,
        selectedPriceDisplay:
          config.selectedPriceDisplay,
        checkoutEnvironment:
          session.livemode ? "live" : "test",
        checkoutUrl: session.url
      });
    } catch (error) {
      console.error(
        "[membership checkout] Creation failed:",
        error.message || error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Secure Stripe membership checkout could not be created. No charge was made."
      });
    }
  }
);

app.post(
  "/api/client-portal/membership-checkout-confirm",
  requireClientPortalApiSession,
  async (req, res) => {
    try {
      if (!STRIPE_SECRET_KEY) {
        return res.status(503).json({
          ok: false,
          error:
            "Stripe payment confirmation is not configured."
        });
      }

      const sessionId = String(
        req.body?.sessionId || ""
      ).trim();

      if (!sessionId.startsWith("cs_")) {
        return res.status(400).json({
          ok: false,
          error:
            "The Stripe Checkout Session reference is not valid."
        });
      }

      const checkoutSession =
        await stripe.checkout.sessions.retrieve(
          sessionId,
          {
            expand: ["subscription"]
          }
        );
      const metadata =
        checkoutSession.metadata || {};
      const portalEmail = normalizeEmail(
        metadata.portalEmail ||
        checkoutSession.customer_details?.email ||
        checkoutSession.customer_email ||
        ""
      );

      if (
        String(metadata.service || "") !==
          "year_round_membership" ||
        portalEmail !==
          req.clientPortalSession.email
      ) {
        return res.status(403).json({
          ok: false,
          error:
            "This Stripe membership payment is not connected to your portal account."
        });
      }

      const leadId = String(
        metadata.leadId ||
        checkoutSession.client_reference_id ||
        ""
      ).trim();
      const accessible =
        await clientPortalSessionCanAccessLead(
          req.clientPortalSession,
          leadId
        );

      if (!accessible) {
        return res.status(403).json({
          ok: false,
          error:
            "This membership record is not connected to your portal account."
        });
      }

      const result =
        await processMembershipCheckoutSession(
          checkoutSession,
          `checkout-confirm:${sessionId}`,
          new Date().toISOString()
        );

      if (!result.ok) {
        return res.status(500).json({
          ok: false,
          error:
            result.error ||
            "Stripe confirmed the checkout, but the membership record could not be updated."
        });
      }

      return res.status(200).json({
        ok: true,
        paymentStatus:
          checkoutSession.payment_status,
        membership:
          getClientPortalMembershipSummary(
            await getClientPortalAccessibleLeads(
              req.clientPortalSession.email
            )
          )
      });
    } catch (error) {
      console.error(
        "[membership checkout] Confirmation failed:",
        error.message || error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Stripe payment confirmation could not be completed. The office can verify the payment from Stripe."
      });
    }
  }
);

app.patch("/api/leads/:leadId", async (req, res) => {
  const { leadId } = req.params;
  const {
    status,
    notes,
    Request,
    transcriptRequest,
    taxPreparationIntake,
    taxPreparationWork,
    contractor1099Request,
    contractor1099Work,
    extensionRequest,
    calendarAppointment,
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

    const incomingTranscriptRequest =
      transcriptRequest &&
      typeof transcriptRequest === "object" &&
      !Array.isArray(transcriptRequest)
        ? transcriptRequest
        : Request &&
          typeof Request === "object" &&
          !Array.isArray(Request)
          ? Request
          : null;

    if (incomingTranscriptRequest) {
      const mergedTranscriptRequest = {
        ...(updatedEstimate.transcriptRequest ||
          updatedEstimate.Request ||
          {}),
        ...incomingTranscriptRequest,
        updatedAt: new Date().toISOString()
      };

      updatedEstimate.transcriptRequest =
        mergedTranscriptRequest;

      updatedEstimate.Request =
        mergedTranscriptRequest;
    }

    if (
      taxPreparationIntake &&
      typeof taxPreparationIntake === "object" &&
      !Array.isArray(taxPreparationIntake)
    ) {
      updatedEstimate.taxPreparationIntake = {
        ...(updatedEstimate.taxPreparationIntake || {}),
        ...taxPreparationIntake,
        updatedAt: new Date().toISOString()
      };
    }

    if (
      taxPreparationWork &&
      typeof taxPreparationWork === "object" &&
      !Array.isArray(taxPreparationWork)
    ) {
      updatedEstimate.taxPreparationWork = {
        ...(updatedEstimate.taxPreparationWork || {}),
        ...taxPreparationWork,
        updatedAt: new Date().toISOString()
      };
    }

    if (
      contractor1099Request &&
      typeof contractor1099Request === "object" &&
      !Array.isArray(contractor1099Request)
    ) {
      updatedEstimate.contractor1099Request = {
        ...(updatedEstimate.contractor1099Request || {}),
        ...contractor1099Request,
        updatedAt: new Date().toISOString()
      };
    }

    if (
      contractor1099Work &&
      typeof contractor1099Work === "object" &&
      !Array.isArray(contractor1099Work)
    ) {
      updatedEstimate.contractor1099Work = {
        ...mergeContractor1099OfficeWork(
          updatedEstimate.contractor1099Work || {},
          contractor1099Work
        ),
        updatedAt: new Date().toISOString()
      };
    }

    if (
      extensionRequest &&
      typeof extensionRequest === "object" &&
      !Array.isArray(extensionRequest)
    ) {
      updatedEstimate.extensionRequest = {
        ...(updatedEstimate.extensionRequest || {}),
        ...extensionRequest,
        updatedAt: new Date().toISOString()
      };
    }

    if (
      calendarAppointment &&
      typeof calendarAppointment === "object" &&
      !Array.isArray(calendarAppointment)
    ) {
      updatedEstimate.calendarAppointment = {
        ...(updatedEstimate.calendarAppointment || {}),
        ...calendarAppointment,
        updatedAt: new Date().toISOString()
      };
    }

    if (
      contractor1099CompletionRequested(
        updatedEstimate.status,
        updatedEstimate.contractor1099Work || {}
      )
    ) {
      const missing =
        getContractor1099CompletionMissing(
          updatedEstimate
        );

      if (missing.length) {
        throw contractor1099CompletionError(
          missing
        );
      }
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
      if (
        supabaseErr?.code ===
        "CONTRACTOR_1099_COMPLETION_BLOCKED"
      ) {
        return res.status(409).json({
          ok: false,
          error: supabaseErr.message,
          missing: supabaseErr.missing || []
        });
      }

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
        taxPreparationIntake &&
        typeof taxPreparationIntake === "object" &&
        !Array.isArray(taxPreparationIntake)
      ) {
        localLead.taxPreparationIntake = {
          ...(localLead.taxPreparationIntake || {}),
          ...taxPreparationIntake,
          updatedAt: new Date().toISOString()
        };
      }

      if (
        taxPreparationWork &&
        typeof taxPreparationWork === "object" &&
        !Array.isArray(taxPreparationWork)
      ) {
        localLead.taxPreparationWork = {
          ...(localLead.taxPreparationWork || {}),
          ...taxPreparationWork,
          updatedAt: new Date().toISOString()
        };
      }

      if (
        contractor1099Request &&
        typeof contractor1099Request === "object" &&
        !Array.isArray(contractor1099Request)
      ) {
        localLead.contractor1099Request = {
          ...(localLead.contractor1099Request || {}),
          ...contractor1099Request,
          updatedAt: new Date().toISOString()
        };
      }

      if (
        contractor1099Work &&
        typeof contractor1099Work === "object" &&
        !Array.isArray(contractor1099Work)
      ) {
        localLead.contractor1099Work = {
          ...mergeContractor1099OfficeWork(
            localLead.contractor1099Work || {},
            contractor1099Work
          ),
          updatedAt: new Date().toISOString()
        };
      }

      if (
        extensionRequest &&
        typeof extensionRequest === "object" &&
        !Array.isArray(extensionRequest)
      ) {
        localLead.extensionRequest = {
          ...(localLead.extensionRequest || {}),
          ...extensionRequest,
          updatedAt: new Date().toISOString()
        };
      }

      if (
        calendarAppointment &&
        typeof calendarAppointment === "object" &&
        !Array.isArray(calendarAppointment)
      ) {
        localLead.calendarAppointment = {
          ...(localLead.calendarAppointment || {}),
          ...calendarAppointment,
          updatedAt: new Date().toISOString()
        };
      }

      const incomingTranscriptRequest =
        transcriptRequest &&
        typeof transcriptRequest === "object" &&
        !Array.isArray(transcriptRequest)
          ? transcriptRequest
          : Request &&
            typeof Request === "object" &&
            !Array.isArray(Request)
            ? Request
            : null;

      if (incomingTranscriptRequest) {
        const mergedTranscriptRequest = {
          ...(localLead.transcriptRequest ||
            localLead.Request ||
            {}),
          ...incomingTranscriptRequest,
          updatedAt: new Date().toISOString()
        };

        localLead.transcriptRequest =
          mergedTranscriptRequest;

        localLead.Request =
          mergedTranscriptRequest;
      }

      if (
        contractor1099CompletionRequested(
          localLead.status,
          localLead.contractor1099Work || {}
        )
      ) {
        const missing =
          getContractor1099CompletionMissing(
            localLead
          );

        if (missing.length) {
          return res.status(409).json({
            ok: false,
            error:
              "This Contractor 1099 service cannot be completed until every mandatory item is finished.",
            missing
          });
        }
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

app.get(
  "/transcript-requests",
  requireOfficeDocumentReviewPage,
  (req, res) => {
    res.setHeader(
      "X-Robots-Tag",
      "noindex, nofollow, noarchive"
    );

    res.sendFile(
      path.join(
        __dirname,
        "ui",
        "transcript-requests.html"
      )
    );
  }
);
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

async function hydrateLeadsWithSecureDocumentSummaries(leads = []) {
  const safeLeads = Array.isArray(leads)
    ? leads
    : [];

  try {
    const records =
      await clientDocumentStore.listForOffice({});

    const recordsByLeadId = new Map();

    records.forEach((record = {}) => {
      const accountLeadId = String(
        record.accountLeadId || ""
      ).trim();

      const linkedLeadId = String(
        record.linkedLeadId || ""
      ).trim();

      const category = String(
        record.category || ""
      ).trim();

      const linkedTranscriptCategory =
        [
          "signed-8821",
          "identity-verification",
          "irs-transcript-delivery"
        ].includes(category);

      const targetLeadId =
        linkedTranscriptCategory &&
        linkedLeadId
          ? linkedLeadId
          : accountLeadId;

      if (!targetLeadId) {
        return;
      }

      if (!recordsByLeadId.has(targetLeadId)) {
        recordsByLeadId.set(targetLeadId, []);
      }

      recordsByLeadId
        .get(targetLeadId)
        .push(record);
    });

    return safeLeads.map((lead = {}) => {
      const leadId = getLeadIdValue(lead);

      const matchingRecords =
        recordsByLeadId.get(leadId) || [];

      if (matchingRecords.length === 0) {
        return lead;
      }

      const summary =
        clientDocumentStore.buildSummary(
          matchingRecords
        );

      const currentPortal =
        getClientPortalRecord(lead) || {};

      const currentDocumentCenter =
        currentPortal.documentCenter &&
        typeof currentPortal.documentCenter === "object" &&
        !Array.isArray(currentPortal.documentCenter)
          ? currentPortal.documentCenter
          : {};

      return {
        ...lead,
        clientPortal: {
          ...currentPortal,
          documentCenter: {
            ...currentDocumentCenter,
            version: 3,
            status: "active",
            totalDocuments: Number(
              summary.totalDocuments || 0
            ),
            awaitingReview: Number(
              summary.awaitingReview || 0
            ),
            inReview: Number(
              summary.inReview || 0
            ),
            accepted: Number(
              summary.accepted || 0
            ),
            needsReplacement: Number(
              summary.needsReplacement || 0
            ),
            latestUploadAt: String(
              summary.latestUploadAt || ""
            ),
            latestFileName: String(
              summary.latestFileName || ""
            )
          }
        }
      };
    });
  } catch (error) {
    console.warn(
      "[api/leads] Secure document summaries could not be loaded:",
      error?.message || error
    );

    return safeLeads;
  }
}

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

    const supabaseLeads = (data || [])
      .map(mapRowToLead)
      .filter((lead) => !isNewsletterOnlyLead(lead));

    if (!includeLocal) {
      const leadsWithDocuments =
        await hydrateLeadsWithSecureDocumentSummaries(
          supabaseLeads
        );
      const leads =
        await hydrateLeadsWithPortalAccountSummaries(
          leadsWithDocuments
        );

      return res.status(200).json({
        ok: true,
        source: "supabase+secure-documents",
        count: leads.length,
        leads
      });
    }

    const localLeads = readLeads()
      .filter((lead) => !isNewsletterOnlyLead(mapRowToLead(lead)));
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
        const localTranscriptRequest = {
          ...(
            localLead.transcriptRequest ||
            localLead.Request ||
            localLead.request ||
            {}
          )
        };

        const primaryTranscriptRequest = {
          ...(
            existing.transcriptRequest ||
            existing.Request ||
            existing.request ||
            {}
          )
        };

        const authoritativeTranscriptRequest = {
          ...localTranscriptRequest,
          ...primaryTranscriptRequest
        };

        const hasTranscriptRequest =
          Object.keys(
            authoritativeTranscriptRequest
          ).length > 0;

        const existingPortal =
          existing.clientPortal &&
          typeof existing.clientPortal === "object"
            ? existing.clientPortal
            : {};

        const localPortal =
          localLead.clientPortal &&
          typeof localLead.clientPortal === "object"
            ? localLead.clientPortal
            : {};

        mergedById.set(id, {
          ...localLead,
          ...existing,
          contact: {
            ...(localLead.contact || {}),
            ...(existing.contact || {})
          },
          taxData:
            existing.taxData ||
            localLead.taxData,
          estimateSummary:
            existing.estimateSummary ||
            localLead.estimateSummary,
          updatedAt:
            new Date(
              localLead.updatedAt || 0
            ).getTime() >
            new Date(
              existing.updatedAt || 0
            ).getTime()
              ? localLead.updatedAt
              : existing.updatedAt,
          transcriptRequest:
            hasTranscriptRequest
              ? authoritativeTranscriptRequest
              : undefined,
          Request:
            hasTranscriptRequest
              ? authoritativeTranscriptRequest
              : undefined,
          clientPortal: {
            ...existingPortal,
            ...localPortal,
            documentCenter: {
              ...(existingPortal.documentCenter || {}),
              ...(localPortal.documentCenter || {})
            }
          }
        });
      } else {
        mergedById.set(id, localLead);
      }
    });

    const leadsWithDocuments =
      await hydrateLeadsWithSecureDocumentSummaries(
        Array.from(mergedById.values())
      );
    const leads =
      await hydrateLeadsWithPortalAccountSummaries(
        leadsWithDocuments
      );

    return res.status(200).json({
      ok: true,
      source: "supabase+local",
      count: leads.length,
      leads
    });
  } catch (err) {
    console.error("Supabase load leads failed. Loading local instead:", err.message || err);

    const leadsWithDocuments =
      await hydrateLeadsWithSecureDocumentSummaries(
        readLeads().filter(
          (lead) => !isNewsletterOnlyLead(mapRowToLead(lead))
        )
      );
    const leads =
      await hydrateLeadsWithPortalAccountSummaries(
        leadsWithDocuments
      );

    return res.status(200).json({
      ok: true,
      source: "local-fallback+secure-documents",
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


function getExtensionServiceLabelForEmail(request = {}) {
  const business =
    String(request.serviceType || "")
      .toLowerCase() === "business";
  const state =
    request.stateExtensionRequested === true
      ? " + " +
        String(
          request.stateCode ||
          "State"
        ).toUpperCase()
      : "";

  return (
    business
      ? "Business Federal"
      : "Individual Federal"
  ) + state;
}


function getExtensionClosureEmailOutcome(request = {}) {
  const workStatus =
    String(request.workStatus || "").trim();

  if (
    /closed\s*(?:—|-)\s*not eligible/i.test(
      workStatus
    )
  ) {
    return "not_eligible";
  }

  if (/^completed$/i.test(workStatus)) {
    return "completed";
  }

  return "";
}

function buildExtensionClosureEmail({
  lead = {},
  request = {},
  outcome = ""
} = {}) {
  const name =
    String(
      lead.contact?.name || "Client"
    ).trim() || "Client";
  const taxYear =
    String(request.taxYear || "").trim() ||
    "the requested tax year";
  const service =
    getExtensionServiceLabelForEmail(request);
  const reference =
    String(lead.leadId || "").trim();

  if (outcome === "not_eligible") {
    return {
      subject:
        "Update on Your Tax Extension Request",
      text:
`Hello ${name},

We reviewed the deadline information provided with your Tax Extension request.

Service:
${service}

Tax year:
${taxYear}

What happened:
Based on our review, we did not file a standard extension through this request. A standard federal filing extension generally must be requested by the original tax-return due date.

Important:
No extension was filed through this request.
No extension-service payment was requested or charged.

This does not mean that you are disqualified from receiving tax help. It only means that this extension request was closed without filing an extension. You may still need to file the tax return, address a late return, or take another step based on your situation.

Contact Greatest Business Solution LLC if you would like help determining your next step.

Reference number:
${reference}

Please do not email Social Security numbers, tax documents, bank information, or passwords. Use the secure client portal when documents are requested.

Thank you,

Greatest Business Solution LLC`
    };
  }

  return {
    subject:
      "Your Tax Extension Service Is Complete",
    text:
`Hello ${name},

Your Tax Extension service has been completed and closed.

Service:
${service}

Tax year:
${taxYear}

Status:
Completed

Please keep the filing confirmation that was delivered for your records.

Important: An extension gives additional time to file the tax return. It does not extend the deadline to pay tax that may be owed, and it does not mean that the full tax return has been prepared or filed.

Reference number:
${reference}

Please do not email Social Security numbers, tax documents, bank information, or passwords. Use the secure client portal when documents are requested.

Thank you,

Greatest Business Solution LLC`
  };
}

// =============================================================================
// POST /api/extension-closure-email
// Automatically notifies the client when an extension is completed or closed.
// The endpoint also supports an explicit resend from Completed & Closed
// Extensions when an older record or delivery exception needs attention.
// =============================================================================

app.post("/api/extension-closure-email", async (req, res) => {
  const leadId =
    String(req.body?.leadId || "").trim();
  const resend =
    req.body?.resend === true;

  if (!leadId) {
    return res.status(400).json({
      ok: false,
      emailSent: false,
      error:
        "The extension reference number is required."
    });
  }

  try {
    const candidate =
      await findClientPortalLeadById(leadId);

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        emailSent: false,
        error:
          "The completed extension request could not be found."
      });
    }

    const lead = candidate.lead || {};
    const request =
      lead.extensionRequest || {};
    const outcome =
      getExtensionClosureEmailOutcome(request);

    if (!outcome) {
      return res.status(409).json({
        ok: false,
        emailSent: false,
        error:
          "The client closure email can be sent only after the extension is Completed or Closed — Not Eligible."
      });
    }

    if (
      request.closureEmailSentAt &&
      !resend
    ) {
      return res.status(200).json({
        ok: true,
        emailSent: false,
        alreadySent: true,
        sentAt:
          request.closureEmailSentAt
      });
    }

    const clientEmail =
      normalizeEmail(
        lead.contact?.email || ""
      );

    if (!clientEmail) {
      return res.status(400).json({
        ok: false,
        emailSent: false,
        error:
          "The completed extension does not have a client email address."
      });
    }

    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      const failureAt =
        new Date().toISOString();
      const configurationError =
        "Email delivery is not configured.";

      await updateLeadAfterStripePayment(
        leadId,
        (record = {}) => ({
          ...record,
          extensionRequest: {
            ...(record.extensionRequest || {}),
            closureEmailStatus:
              "Failed",
            closureEmailError:
              configurationError,
            closureEmailLastAttemptAt:
              failureAt,
            updatedAt:
              failureAt
          },
          updatedAt:
            failureAt
        })
      );

      return res.status(500).json({
        ok: false,
        emailSent: false,
        error:
          configurationError
      });
    }

    const message =
      buildExtensionClosureEmail({
        lead,
        request,
        outcome
      });

    try {
      await transporter.sendMail({
        from: EMAIL_USER,
        to: clientEmail,
        subject: message.subject,
        text: message.text
      });
    } catch (emailError) {
      const failureAt =
        new Date().toISOString();
      const deliveryError =
        emailError?.message ||
        "The client closure email could not be sent.";

      await updateLeadAfterStripePayment(
        leadId,
        (record = {}) => ({
          ...record,
          extensionRequest: {
            ...(record.extensionRequest || {}),
            closureEmailStatus:
              "Failed",
            closureEmailError:
              deliveryError,
            closureEmailLastAttemptAt:
              failureAt,
            updatedAt:
              failureAt
          },
          updatedAt:
            failureAt
        })
      );

      console.error(
        "[extension-closure-email] Delivery failed:",
        leadId,
        deliveryError
      );

      return res.status(500).json({
        ok: false,
        emailSent: false,
        error:
          deliveryError
      });
    }

    const sentAt =
      new Date().toISOString();

    const saveResult =
      await updateLeadAfterStripePayment(
        leadId,
        (record = {}) => ({
          ...record,
          extensionRequest: {
            ...(record.extensionRequest || {}),
            closureEmailSentAt:
              sentAt,
            closureEmailLastAttemptAt:
              sentAt,
            closureEmailStatus:
              "Sent",
            closureEmailType:
              outcome,
            closureEmailError:
              "",
            closureEmailResendCount:
              Number(
                record.extensionRequest
                  ?.closureEmailResendCount ||
                0
              ) + (
                resend
                  ? 1
                  : 0
              ),
            updatedAt:
              sentAt
          },
          updatedAt:
            sentAt
        })
      );

    if (!saveResult?.ok) {
      return res.status(500).json({
        ok: false,
        emailSent: true,
        sentAt,
        error:
          "The client email was sent, but its delivery record could not be saved."
      });
    }

    return res.status(200).json({
      ok: true,
      emailSent: true,
      alreadySent: false,
      sentAt,
      outcome
    });
  } catch (error) {
    console.error(
      "[extension-closure-email] Failed:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      emailSent: false,
      error:
        error.message ||
        "The client extension completion or closure email could not be sent."
    });
  }
});


// =============================================================================
// POST /api/contractor-1099-completion-email
// Sends or resends the final service-completion message.
// =============================================================================

app.post("/api/contractor-1099-completion-email", async (req, res) => {
  try {
    const leadId = String(req.body?.leadId || "").trim();
    const resend = req.body?.resend === true;

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error:
          "The Contractor 1099 reference number is required."
      });
    }

    const candidate =
      await findClientPortalLeadById(leadId);

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error:
          "The Contractor 1099 record could not be found."
      });
    }

    const lead = candidate.lead || {};
    const request =
      lead.contractor1099Request || {};
    const work =
      lead.contractor1099Work || {};
    const email = normalizeEmail(
      lead.contact?.email ||
      getLeadEmailValue(candidate.raw)
    );

    if (!email) {
      return res.status(400).json({
        ok: false,
        error:
          "The client email address is missing."
      });
    }

    if (
      !contractor1099CompletionRequested(
        lead.status,
        work
      )
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "The Contractor 1099 service must be Completed before the completion email is sent."
      });
    }

    const missingCompletionItems =
      getContractor1099CompletionMissing(lead);

    if (missingCompletionItems.length) {
      return res.status(409).json({
        ok: false,
        error:
          "The completion email cannot be sent until every mandatory Contractor 1099 item is finished.",
        missing: missingCompletionItems
      });
    }

    if (
      work.completionEmailSentAt &&
      !resend
    ) {
      return res.status(200).json({
        ok: true,
        emailSent: true,
        alreadySent: true,
        sentAt: work.completionEmailSentAt
      });
    }

    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      throw new Error(
        "Email delivery is not configured."
      );
    }

    const portalUrl =
      String(APP_BASE_URL || "")
        .replace(/\/+$/, "") +
      "/client-portal?contractor1099=1&leadId=" +
      encodeURIComponent(leadId);

    const services =
      Array.isArray(request.serviceLabels)
        ? request.serviceLabels.join(", ")
        : "Contractor Forms 1099 Service";

    const sentAt = new Date().toISOString();

    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject:
        "Your Contractor Forms 1099 Service Is Complete",
      text:
`Hello ${lead.contact?.name || "Client"},

Your Contractor Forms 1099 service is complete.

Business:
${request.businessLegalName || "Not recorded"}

Reporting year:
${request.taxYear || "Not recorded"}

Services:
${services}

Federal filing status:
${work.filingStatus || "Completed"}

IRS acceptance:
${work.irsAcceptanceStatus || "Check the secure portal"}

State filing:
${work.stateFilingWorkStatus || "Not reviewed"}

Recipient copies:
${work.recipientCopyStatus || "Check the secure portal"}

Use the Secure Client Portal to review filing confirmations, recipient-copy information, and office updates:
${portalUrl}

Keep the payer copy, filing acknowledgment, recipient-delivery records, W-9s, and supporting payment records with the business files.

Reference number:
${leadId}

Please do not email Social Security numbers, contractor EINs, W-9s, bank information, or detailed payment records.

Thank you,

Greatest Business Solution LLC`
    });

    const saveResult =
      await updateLeadAfterStripePayment(
        leadId,
        (record = {}) => ({
          ...record,
          contractor1099Work: {
            ...(record.contractor1099Work || {}),
            completionEmailSentAt: sentAt,
            completionEmailStatus: "Sent",
            completionEmailError: "",
            completionEmailResendCount:
              Math.max(
                0,
                Number.parseInt(
                  record.contractor1099Work
                    ?.completionEmailResendCount,
                  10
                ) || 0
              ) + (resend ? 1 : 0),
            updatedAt: sentAt
          },
          updatedAt: sentAt
        })
      );

    if (!saveResult?.ok) {
      return res.status(500).json({
        ok: false,
        emailSent: true,
        sentAt,
        error:
          "The completion email was sent, but the delivery record could not be saved."
      });
    }

    return res.status(200).json({
      ok: true,
      emailSent: true,
      alreadySent: false,
      sentAt
    });
  } catch (error) {
    console.error(
      "[contractor-1099-completion-email] Failed:",
      error.message || error
    );

    const leadId =
      String(req.body?.leadId || "").trim();
    const failedAt =
      new Date().toISOString();

    if (leadId) {
      try {
        await updateLeadAfterStripePayment(
          leadId,
          (record = {}) => ({
            ...record,
            contractor1099Work: {
              ...(record.contractor1099Work || {}),
              completionEmailStatus: "Failed",
              completionEmailError:
                error.message ||
                "The completion email could not be sent.",
              completionEmailLastAttemptAt:
                failedAt,
              updatedAt: failedAt
            },
            updatedAt: failedAt
          })
        );
      } catch (saveError) {
        console.error(
          "[contractor-1099-completion-email] Failure status save failed:",
          saveError.message || saveError
        );
      }
    }

    return res.status(500).json({
      ok: false,
      emailSent: false,
      error:
        error.message ||
        "The Contractor 1099 completion email could not be sent."
    });
  }
});


// =============================================================================
// POST /api/tax-preparation-completion-email
// Sends or resends the final client completion message and saves delivery status.
// =============================================================================

app.post("/api/tax-preparation-completion-email", async (req, res) => {
  try {
    const leadId = String(req.body?.leadId || "").trim();
    const resend = req.body?.resend === true;

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error: "The Tax Preparation reference number is required."
      });
    }

    const candidate = await findClientPortalLeadById(leadId);

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error: "The Tax Preparation record could not be found."
      });
    }

    const lead = candidate.lead || {};
    const work = lead.taxPreparationWork || {};
    const email = normalizeEmail(
      lead.contact?.email || getLeadEmailValue(candidate.raw)
    );

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "The client email address is missing."
      });
    }

    if (
      !/accepted|completed/i.test(
        String(work.workStatus || lead.status || "")
      )
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "The return must be Accepted / Completed before the completion email is sent."
      });
    }

    if (work.completionEmailSentAt && !resend) {
      return res.status(200).json({
        ok: true,
        emailSent: true,
        alreadySent: true,
        sentAt: work.completionEmailSentAt
      });
    }

    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      throw new Error("Email delivery is not configured.");
    }

    const portalUrl =
      String(APP_BASE_URL || "")
        .replace(/\/+$/, "") +
      "/client-portal?activate=1&leadId=" +
      encodeURIComponent(leadId);

    const taxYear = String(
      lead.taxPreparationIntake?.taxYear ||
      lead.taxData?.taxYear ||
      "Not recorded"
    );

    const returnType = String(
      lead.taxPreparationIntake?.recommendedLane ||
      work.returnType ||
      "Tax Preparation"
    );

    const sentAt = new Date().toISOString();

    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject: "Your Tax Return Is Complete",
      text:
`Hello ${lead.contact?.name || "Client"},

Your Tax Preparation work is complete.

Tax year:
${taxYear}

Return type:
${returnType}

Filing status:
${String(work.acceptanceStatus || work.efileStatus || "Completed")}

Final client copy:
${String(work.finalReturnDeliveryStatus || "Check the secure client portal")}

Use the secure client portal to review available final documents and office updates:
${portalUrl}

Keep your final return, filing acknowledgments, and supporting records with your tax files. This message is not a replacement for the filed return or official federal or state acceptance records.

Reference number:
${leadId}

Please do not email Social Security numbers, tax documents, bank information, or passwords.

Thank you,

Greatest Business Solution LLC`
    });

    const saveResult = await updateLeadAfterStripePayment(
      leadId,
      (record = {}) => ({
        ...record,
        taxPreparationWork: {
          ...(record.taxPreparationWork || {}),
          completionEmailSentAt: sentAt,
          completionEmailStatus: "Sent",
          completionEmailError: "",
          completionEmailResendCount:
            Math.max(
              0,
              Number.parseInt(
                record.taxPreparationWork?.completionEmailResendCount,
                10
              ) || 0
            ) + (resend ? 1 : 0),
          updatedAt: sentAt
        },
        updatedAt: sentAt
      })
    );

    if (!saveResult?.ok) {
      return res.status(500).json({
        ok: false,
        emailSent: true,
        sentAt,
        error:
          "The completion email was sent, but the delivery record could not be saved."
      });
    }

    return res.status(200).json({
      ok: true,
      emailSent: true,
      alreadySent: false,
      sentAt
    });
  } catch (error) {
    console.error(
      "[tax-preparation-completion-email] Failed:",
      error.message || error
    );

    const leadId = String(req.body?.leadId || "").trim();
    const failedAt = new Date().toISOString();

    if (leadId) {
      try {
        await updateLeadAfterStripePayment(
          leadId,
          (record = {}) => ({
            ...record,
            taxPreparationWork: {
              ...(record.taxPreparationWork || {}),
              completionEmailStatus: "Failed",
              completionEmailError:
                error.message ||
                "The completion email could not be sent.",
              completionEmailLastAttemptAt: failedAt,
              updatedAt: failedAt
            },
            updatedAt: failedAt
          })
        );
      } catch (saveError) {
        console.error(
          "[tax-preparation-completion-email] Failure status save failed:",
          saveError.message || saveError
        );
      }
    }

    return res.status(500).json({
      ok: false,
      emailSent: false,
      error:
        error.message ||
        "The Tax Preparation completion email could not be sent."
    });
  }
});

// =============================================================================
// POST /api/create-tax-preparation-checkout
// The payment amount is read from the office-saved Action Basket.
// Supports deposits, full payments, and balance payments.
// =============================================================================

app.post("/api/create-tax-preparation-checkout", async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Stripe secret key is not configured."
      });
    }

    const leadId = String(req.body?.leadId || "").trim();
    const clientEmail = normalizeEmail(
      req.body?.clientEmail || ""
    );
    const officeRequest = req.body?.officeRequest === true;

    if (!leadId || !clientEmail) {
      return res.status(400).json({
        ok: false,
        error:
          "The Tax Preparation reference number and client email are required."
      });
    }

    const candidate = await findClientPortalLeadById(leadId);

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error: "The Tax Preparation request could not be found."
      });
    }

    const lead = candidate.lead || {};
    const intake = lead.taxPreparationIntake || {};
    const work = lead.taxPreparationWork || {};

    if (
      normalizeEmail(
        lead.contact?.email || getLeadEmailValue(candidate.raw)
      ) !== clientEmail
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "The email address does not match the saved Tax Preparation request."
      });
    }

    if (
      String(work.paymentRequirement || "Required") ===
      "Waived by Office"
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "Payment is marked Waived by Office. Change the requirement before creating a payment link."
      });
    }

    const quotedFeeCents = Math.max(
      0,
      Number.parseInt(work.quotedFeeCents, 10) || 0
    );
    const amountPaidCents = Math.max(
      0,
      Number.parseInt(work.amountPaidCents, 10) || 0
    );
    const amountCents = Math.max(
      0,
      Number.parseInt(work.paymentRequestAmountCents, 10) || 0
    );
    const outstandingCents = Math.max(
      0,
      quotedFeeCents - amountPaidCents
    );

    if (quotedFeeCents < 100) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter and save the total Tax Preparation fee quote before creating a payment link."
      });
    }

    if (amountCents < 100) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter and save an amount to collect now before creating a payment link."
      });
    }

    if (amountCents > outstandingCents) {
      return res.status(400).json({
        ok: false,
        error:
          "The amount to collect is greater than the unpaid balance on the saved fee quote."
      });
    }

    const paymentPurpose = String(
      work.paymentPurpose || "Tax Preparation Payment"
    ).trim();
    const taxYear = String(
      intake.taxYear || lead.taxData?.taxYear || ""
    );
    const returnType = String(
      intake.recommendedLane ||
      work.returnType ||
      "Tax Preparation"
    );

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: leadId,
      customer_email: clientEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name:
                "Tax Preparation — " +
                (paymentPurpose || "Payment"),
              description:
                "Professional Tax Preparation service payment for tax year " +
                (taxYear || "not recorded") +
                ". Return type: " + returnType +
                ". The final scope and services are based on the office-approved fee quote."
            },
            unit_amount: amountCents
          },
          quantity: 1
        }
      ],
      metadata: {
        leadId,
        clientName: String(lead.contact?.name || ""),
        clientEmail,
        service: "tax_preparation",
        taxYear,
        returnType,
        paymentPurpose,
        quotedFeeCents: String(quotedFeeCents),
        amountBeforePaymentCents: String(amountPaidCents)
      },
      success_url:
        `${APP_BASE_URL}/client-portal?payment=success&leadId=${encodeURIComponent(leadId)}`,
      cancel_url:
        `${APP_BASE_URL}/client-portal?payment=cancelled&leadId=${encodeURIComponent(leadId)}`
    });

    const createdAt = new Date().toISOString();

    const saveResult = await updateLeadAfterStripePayment(
      leadId,
      (record = {}) => ({
        ...record,
        taxPreparationWork: {
          ...(record.taxPreparationWork || {}),
          stripeCheckoutSessionId: session.id,
          stripeCheckoutUrl: session.url,
          checkoutCreatedAt: createdAt,
          paymentStatus:
            amountPaidCents > 0
              ? "Balance Payment Link Created"
              : "Payment Link Created",
          updatedAt: createdAt
        },
        updatedAt: createdAt
      })
    );

    if (!saveResult?.ok) {
      return res.status(500).json({
        ok: false,
        error:
          "The secure Stripe link was created, but it could not be saved on the Tax Preparation card. No payment-link email was sent."
      });
    }

    let emailSent = false;
    let emailError = "";

    if (officeRequest) {
      try {
        if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
          throw new Error("Email delivery is not configured.");
        }

        const portalUrl =
          String(APP_BASE_URL || "")
            .replace(/\/+$/, "") +
          "/client-portal?activate=1&leadId=" +
          encodeURIComponent(leadId);

        await transporter.sendMail({
          from: EMAIL_USER,
          to: clientEmail,
          subject: "Your Secure Tax Preparation Payment Link",
          text:
`Hello ${lead.contact?.name || "Client"},

Your Tax Preparation payment link is ready.

Tax year:
${taxYear || "Not recorded"}

Return type:
${returnType}

Payment purpose:
${paymentPurpose}

Amount due now:
$${(amountCents / 100).toFixed(2)}

Total fee quote:
$${(quotedFeeCents / 100).toFixed(2)}

Use this secure Stripe payment link:
${session.url}

After Stripe confirms payment, your Tax Preparation Action Basket and secure client portal will update automatically.

Secure client portal:
${portalUrl}

Reference number:
${leadId}

Please do not email Social Security numbers, tax documents, bank information, or passwords.

Thank you,

Greatest Business Solution LLC`
        });

        emailSent = true;
      } catch (emailErr) {
        emailError =
          emailErr?.message ||
          "The payment-link email was not sent.";

        console.error(
          "[create-tax-preparation-checkout] Payment-link email failed:",
          leadId,
          emailError
        );
      }

      await updateLeadAfterStripePayment(
        leadId,
        (record = {}) => ({
          ...record,
          taxPreparationWork: {
            ...(record.taxPreparationWork || {}),
            paymentLinkSentAt: createdAt,
            paymentLinkEmailSent: emailSent,
            paymentLinkEmailError: emailError,
            paymentStatus: emailSent
              ? (amountPaidCents > 0
                  ? "Balance Payment Link Sent"
                  : "Payment Link Sent")
              : (record.taxPreparationWork?.paymentStatus ||
                  "Payment Link Created"),
            updatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        })
      );
    }

    return res.status(200).json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      emailSent: officeRequest ? emailSent : null,
      emailError: officeRequest ? emailError : ""
    });
  } catch (error) {
    console.error(
      "[create-tax-preparation-checkout] Failed:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      error:
        error.message ||
        "The secure Tax Preparation payment link could not be created."
    });
  }
});

// =============================================================================
// POST /api/create-contractor-1099-checkout
// The amount is read from the office-saved Contractor 1099 Action Basket.
// =============================================================================

app.post("/api/create-contractor-1099-checkout", async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "Stripe secret key is not configured."
      });
    }

    const leadId =
      String(req.body?.leadId || "").trim();
    const clientEmail =
      normalizeEmail(
        req.body?.clientEmail || ""
      );
    const officeRequest =
      req.body?.officeRequest === true;

    if (!leadId || !clientEmail) {
      return res.status(400).json({
        ok: false,
        error:
          "The Contractor 1099 reference number and client email are required."
      });
    }

    const candidate =
      await findClientPortalLeadById(leadId);

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error:
          "The Contractor 1099 request could not be found."
      });
    }

    const lead = candidate.lead || {};
    const request =
      lead.contractor1099Request || {};
    const work =
      lead.contractor1099Work || {};

    if (
      normalizeEmail(
        lead.contact?.email ||
        getLeadEmailValue(candidate.raw)
      ) !== clientEmail
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "The email address does not match the saved Contractor 1099 request."
      });
    }

    if (
      String(
        work.paymentRequirement || "Required"
      ) === "Waived by Office"
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "Payment is marked Waived by Office. Change the requirement before creating a payment link."
      });
    }

    const quotedFeeCents = Math.max(
      0,
      Number.parseInt(
        work.quotedFeeCents,
        10
      ) || 0
    );

    const amountPaidCents = Math.max(
      0,
      Number.parseInt(
        work.amountPaidCents,
        10
      ) || 0
    );

    const amountCents = Math.max(
      0,
      Number.parseInt(
        work.paymentRequestAmountCents,
        10
      ) || 0
    );

    const outstandingCents = Math.max(
      0,
      quotedFeeCents - amountPaidCents
    );

    if (quotedFeeCents < 100) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter and save the total Contractor 1099 service quote before creating a payment link."
      });
    }

    if (amountCents < 100) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter and save an amount to collect now before creating a payment link."
      });
    }

    if (amountCents > outstandingCents) {
      return res.status(400).json({
        ok: false,
        error:
          "The amount to collect is greater than the unpaid balance on the saved service quote."
      });
    }

    const paymentPurpose = String(
      work.paymentPurpose ||
      "Contractor 1099 Service Payment"
    ).trim();

    const taxYear = String(
      request.taxYear ||
      lead.taxData?.taxYear ||
      ""
    );

    const recipientCount = Math.max(
      0,
      Number.parseInt(
        request.recipientCount,
        10
      ) || 0
    );

    const session =
      await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: leadId,
        customer_email: clientEmail,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name:
                  "Contractor Forms 1099 — " +
                  paymentPurpose,
                description:
                  "Professional preparation and filing service for reporting year " +
                  (taxYear || "not recorded") +
                  ". Estimated payees: " +
                  recipientCount +
                  ". Final scope is based on the office-approved quote."
              },
              unit_amount: amountCents
            },
            quantity: 1
          }
        ],
        metadata: {
          leadId,
          clientName:
            String(
              lead.contact?.name || ""
            ),
          clientEmail,
          service: "contractor_1099",
          taxYear,
          recipientCount:
            String(recipientCount),
          paymentPurpose,
          quotedFeeCents:
            String(quotedFeeCents),
          amountBeforePaymentCents:
            String(amountPaidCents)
        },
        success_url:
          `${APP_BASE_URL}/client-portal?contractor1099=1&payment=success&leadId=${encodeURIComponent(leadId)}`,
        cancel_url:
          `${APP_BASE_URL}/client-portal?contractor1099=1&payment=cancelled&leadId=${encodeURIComponent(leadId)}`
      });

    const createdAt =
      new Date().toISOString();

    const saveResult =
      await updateLeadAfterStripePayment(
        leadId,
        (record = {}) => ({
          ...record,
          contractor1099Work: {
            ...(record.contractor1099Work || {}),
            stripeCheckoutSessionId:
              session.id,
            stripeCheckoutUrl:
              session.url,
            checkoutCreatedAt:
              createdAt,
            paymentStatus:
              amountPaidCents > 0
                ? "Balance Payment Link Created"
                : "Payment Link Created",
            updatedAt: createdAt
          },
          updatedAt: createdAt
        })
      );

    if (!saveResult?.ok) {
      return res.status(500).json({
        ok: false,
        error:
          "The Stripe link was created, but it could not be saved on the Contractor 1099 card. No payment-link email was sent."
      });
    }

    let emailSent = false;
    let emailError = "";

    if (officeRequest) {
      try {
        if (
          !EMAIL_USER ||
          !EMAIL_APP_PASSWORD
        ) {
          throw new Error(
            "Email delivery is not configured."
          );
        }

        const portalUrl =
          String(APP_BASE_URL || "")
            .replace(/\/+$/, "") +
          "/client-portal?contractor1099=1&leadId=" +
          encodeURIComponent(leadId);

        await transporter.sendMail({
          from: EMAIL_USER,
          to: clientEmail,
          subject:
            "Your Secure Contractor 1099 Service Payment Link",
          text:
`Hello ${lead.contact?.name || "Client"},

Your Contractor Forms 1099 service payment link is ready.

Business:
${request.businessLegalName || "Not recorded"}

Reporting year:
${taxYear || "Not recorded"}

Estimated payees:
${recipientCount}

Payment purpose:
${paymentPurpose}

Amount due now:
$${(amountCents / 100).toFixed(2)}

Total approved service quote:
$${(quotedFeeCents / 100).toFixed(2)}

Secure Stripe payment link:
${session.url}

After Stripe confirms payment, the Contractor 1099 Action Basket and Secure Client Portal will update automatically.

Secure Client Portal:
${portalUrl}

Reference number:
${leadId}

Please do not email Social Security numbers, contractor EINs, W-9s, bank information, or detailed payment records.

Thank you,

Greatest Business Solution LLC`
        });

        emailSent = true;
      } catch (emailErr) {
        emailError =
          emailErr?.message ||
          "The payment-link email was not sent.";

        console.error(
          "[create-contractor-1099-checkout] Payment-link email failed:",
          leadId,
          emailError
        );
      }

      await updateLeadAfterStripePayment(
        leadId,
        (record = {}) => ({
          ...record,
          contractor1099Work: {
            ...(record.contractor1099Work || {}),
            paymentLinkSentAt:
              createdAt,
            paymentLinkEmailSent:
              emailSent,
            paymentLinkEmailError:
              emailError,
            paymentStatus:
              emailSent
                ? (
                    amountPaidCents > 0
                      ? "Balance Payment Link Sent"
                      : "Payment Link Sent"
                  )
                : (
                    record.contractor1099Work
                      ?.paymentStatus ||
                    "Payment Link Created"
                  ),
            updatedAt:
              new Date().toISOString()
          },
          updatedAt:
            new Date().toISOString()
        })
      );
    }

    return res.status(200).json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      emailSent:
        officeRequest
          ? emailSent
          : null,
      emailError:
        officeRequest
          ? emailError
          : ""
    });
  } catch (error) {
    console.error(
      "[create-contractor-1099-checkout] Failed:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      error:
        error.message ||
        "The secure Contractor 1099 payment link could not be created."
    });
  }
});


// =============================================================================
// POST /api/create-extension-checkout
// Amount is calculated from the saved request, never from browser pricing.
// Office requests also save and email the secure payment link to the client.
// =============================================================================

app.post("/api/create-extension-checkout", async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "Stripe secret key is not configured."
      });
    }

    const leadId =
      String(req.body?.leadId || "").trim();
    const clientEmail =
      normalizeEmail(
        req.body?.clientEmail || ""
      );
    const officeRequest =
      req.body?.officeRequest === true;

    if (!leadId || !clientEmail) {
      return res.status(400).json({
        ok: false,
        error:
          "The extension reference number and client email are required."
      });
    }

    const candidate =
      await findClientPortalLeadById(leadId);

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error:
          "The extension request could not be found."
      });
    }

    const lead = candidate.lead || {};
    const request =
      lead.extensionRequest || {};

    if (
      normalizeEmail(
        lead.contact?.email ||
        getLeadEmailValue(candidate.raw)
      ) !== clientEmail
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "The email address does not match the saved extension request."
      });
    }

    if (
      /paid|verified/i.test(
        String(
          request.paymentStatus || ""
        )
      )
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "This Tax Extension request is already marked paid."
      });
    }

    if (
      request.checkoutEligible !== true ||
      request.deadlineReviewRequired === true
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "Deadline eligibility must be reviewed before payment."
      });
    }

    const business =
      String(request.serviceType || "")
        .toLowerCase() === "business";

    const hasState =
      request.stateExtensionRequested === true;

    const expectedAmount =
      (
        business
          ? 9900
          : 4900
      ) +
      (
        hasState
          ? 2500
          : 0
      );

    const amount =
      Number(request.totalPriceCents || 0);

    if (
      !Number.isInteger(amount) ||
      amount !== expectedAmount
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "The saved extension price does not match the selected service."
      });
    }

    const serviceName =
      business
        ? "Business Tax Extension Service"
        : "Individual Federal Tax Extension Service";

    const stateText =
      hasState
        ? " Includes review of one state's extension rules and preparation or filing when a separate state action is required for " +
          String(request.stateCode || "the selected state") +
          "."
        : "";

    const session =
      await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: leadId,
        customer_email: clientEmail,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name:
                  serviceName +
                  (hasState
                    ? " + State Add-On"
                    : ""),
                description:
                  "Professional review, preparation, filing, and confirmation of a timely eligible tax extension request." +
                  stateText +
                  " This is a professional service fee, not an IRS filing fee. An extension gives more time to file, not more time to pay."
              },
              unit_amount: amount
            },
            quantity: 1
          }
        ],
        metadata: {
          leadId,
          clientName:
            String(
              lead.contact?.name || ""
            ),
          clientEmail,
          service: "tax_extension",
          extensionType:
            business
              ? "business"
              : "individual",
          taxYear:
            String(request.taxYear || ""),
          stateExtensionRequested:
            hasState
              ? "yes"
              : "no",
          feeCreditTowardPreparation:
            "no"
        },
        success_url:
          `${APP_BASE_URL}/extension-thank-you?checkout=success&leadId=${encodeURIComponent(leadId)}`,
        cancel_url:
          `${APP_BASE_URL}/request-tax-extension?checkout=cancelled&leadId=${encodeURIComponent(leadId)}`
      });

    let emailSent = false;
    let emailError = "";
    const paymentLinkCreatedAt =
      new Date().toISOString();

    const paymentLinkSave =
      await updateLeadAfterStripePayment(
        leadId,
        (record = {}) => ({
          ...record,
          extensionRequest: {
            ...(record.extensionRequest || {}),
            stripeCheckoutSessionId:
              session.id,
            stripeCheckoutUrl:
              session.url,
            checkoutCreatedAt:
              paymentLinkCreatedAt,
            updatedAt:
              paymentLinkCreatedAt
          },
          updatedAt:
            paymentLinkCreatedAt
        })
      );

    if (!paymentLinkSave?.ok) {
      return res.status(500).json({
        ok: false,
        error:
          "The secure Stripe link was created, but it could not be saved on the extension card. No payment-link email was sent."
      });
    }

    if (officeRequest) {
      try {
        if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
          throw new Error(
            "Email delivery is not configured."
          );
        }

        await transporter.sendMail({
          from: EMAIL_USER,
          to: clientEmail,
          subject:
            "Your Secure Tax Extension Payment Link",
          text:
`Hello ${lead.contact?.name || "Client"},

Your Tax Extension request has been reviewed and is eligible to proceed to the secure payment step.

Service:
${getExtensionServiceLabelForEmail(request)}

Tax year:
${String(request.taxYear || "")}

Professional service fee:
$${Number(request.totalPrice || 0).toLocaleString()}

Use this secure Stripe payment link:
${session.url}

After Stripe confirms payment, the office will continue the extension review and filing workflow.

Important: An extension gives additional time to file. It does not extend the deadline to pay tax that may be owed.

This is a standalone extension service. You may use any tax professional to prepare the full return.

Reference number:
${leadId}

Please do not email Social Security numbers, tax documents, bank information, or passwords. Use the secure client portal when documents are requested.

Thank you,

Greatest Business Solution LLC`
        });

        emailSent = true;
      } catch (emailErr) {
        emailError =
          emailErr?.message ||
          "The payment-link email was not sent.";

        console.error(
          "[create-extension-checkout] Office payment-link email failed:",
          leadId,
          emailError
        );
      }

      const deliverySave =
        await updateLeadAfterStripePayment(
          leadId,
          (record = {}) => ({
            ...record,
            extensionRequest: {
              ...(record.extensionRequest || {}),
              paymentLinkSentAt:
                paymentLinkCreatedAt,
              paymentLinkEmailSent:
                emailSent,
              paymentLinkEmailError:
                emailError,
              updatedAt:
                new Date().toISOString()
            },
            updatedAt:
              new Date().toISOString()
          })
        );

      if (!deliverySave?.ok) {
        emailError = emailSent
          ? "The payment link was emailed, but the delivery result could not be saved on the client card."
          : (
              emailError ||
              "The payment-link delivery result could not be saved on the client card."
            );
      }
    }

    return res.status(200).json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      emailSent:
        officeRequest
          ? emailSent
          : null,
      emailError:
        officeRequest
          ? emailError
          : ""
    });
  } catch (error) {
    console.error(
      "[create-extension-checkout] Error:",
      error.message || error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Could not create the Tax Extension payment session."
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
              name: "Written Red Flag Review + Tax Savings Planner Bonus",
              description: "One-time written review of the tax estimate plus the Tax Savings Planner bonus at no additional cost. Includes red flags, missing items, withholding concerns, and next-step guidance. This is not full tax preparation."
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
        service: "written_review",
        includedBonus: "tax_savings_planner"
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
