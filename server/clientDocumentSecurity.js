"use strict";

const crypto = require("crypto");
const path = require("path");

const MAX_FILE_BYTES = 15 * 1024 * 1024;

const DOCUMENT_CATEGORIES = Object.freeze([
  {
    id: "income",
    label: "Income Documents"
  },
  {
    id: "deductions-credits",
    label: "Deductions & Credits"
  },
  {
    id: "life-events",
    label: "Life Events"
  },
  {
    id: "business",
    label: "Business Records"
  },
  {
    id: "irs-state-notices",
    label: "IRS / State Notices"
  },
  {
    id: "identity-authorization",
    label: "Identity & Authorization"
  },
  {
    id: "identity-verification",
    label: "Identity Verification Document"
  },
  {
    id: "signed-8821",
    label: "Signed Form 8821"
  },
  {
    id: "other",
    label: "Other Supporting Records"
  }
]);

const CATEGORY_BY_ID = new Map(
  DOCUMENT_CATEGORIES.map(
    (category) => [category.id, category]
  )
);

const REVIEW_STATUSES = Object.freeze([
  {
    id: "awaiting-review",
    label: "Received — Awaiting Office Review"
  },
  {
    id: "in-review",
    label: "Office Review In Progress"
  },
  {
    id: "accepted",
    label: "Accepted"
  },
  {
    id: "needs-replacement",
    label: "Replacement Requested"
  },
  {
    id: "withdrawn",
    label: "Removed From Active Portal"
  }
]);

const REVIEW_STATUS_BY_ID = new Map(
  REVIEW_STATUSES.map(
    (status) => [status.id, status]
  )
);


const FILE_TYPES = Object.freeze({
  ".pdf": {
    contentType: "application/pdf",
    label: "PDF"
  },
  ".jpg": {
    contentType: "image/jpeg",
    label: "JPEG image"
  },
  ".jpeg": {
    contentType: "image/jpeg",
    label: "JPEG image"
  },
  ".png": {
    contentType: "image/png",
    label: "PNG image"
  },
  ".heic": {
    contentType: "image/heic",
    label: "HEIC image"
  },
  ".heif": {
    contentType: "image/heif",
    label: "HEIF image"
  }
});

function cleanText(value, maxLength = 500) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeCategory(value) {
  const id = cleanText(value, 80)
    .toLowerCase();

  return CATEGORY_BY_ID.has(id)
    ? id
    : "";
}

function getCategoryLabel(value) {
  const id = normalizeCategory(value);

  return id
    ? CATEGORY_BY_ID.get(id).label
    : "";
}

function normalizeReviewStatus(value) {
  const id = cleanText(value, 80)
    .toLowerCase();

  return REVIEW_STATUS_BY_ID.has(id)
    ? id
    : "";
}

function getReviewStatusLabel(value) {
  const id =
    normalizeReviewStatus(value) ||
    "awaiting-review";

  return (
    REVIEW_STATUS_BY_ID.get(id)?.label ||
    "Received — Awaiting Office Review"
  );
}

function normalizeRetentionDate(value) {
  const text = cleanText(value, 20);

  if (!text) {
    return "";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return "";
  }

  const parsed = Date.parse(`${text}T00:00:00Z`);

  return Number.isFinite(parsed)
    ? text
    : "";
}

function normalizeTaxYear(value) {
  const text = cleanText(value, 20)
    .toLowerCase();

  if (
    text === "multiple" ||
    text === "not-sure"
  ) {
    return text;
  }

  if (!/^\d{4}$/.test(text)) {
    return "";
  }

  const year = Number(text);
  const maxYear =
    new Date().getFullYear() + 1;

  return (
    year >= 1990 &&
    year <= maxYear
  )
    ? text
    : "";
}

function getTaxYearLabel(value) {
  const normalized =
    normalizeTaxYear(value);

  if (normalized === "multiple") {
    return "Multiple Tax Years";
  }

  if (normalized === "not-sure") {
    return "Tax Year Not Sure";
  }

  return normalized
    ? `Tax Year ${normalized}`
    : "";
}

function sanitizeOriginalName(value) {
  const raw = cleanText(value, 220)
    .replace(/\\/g, "/");

  const base = path.posix.basename(raw)
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) {
    return "";
  }

  const extension =
    path.extname(base).toLowerCase();

  const stem = extension
    ? base.slice(0, -extension.length)
    : base;

  const safeStem = (
    stem
      .replace(/^\.+/g, "")
      .trim() ||
    "document"
  ).slice(0, 140);

  return `${safeStem}${extension}`;
}

function getFileTypeFromName(name) {
  const extension = path
    .extname(String(name || ""))
    .toLowerCase();

  return FILE_TYPES[extension]
    ? {
        extension,
        ...FILE_TYPES[extension]
      }
    : null;
}

function contentTypeMatches(
  reportedContentType,
  expectedContentType
) {
  const reported = String(
    reportedContentType || ""
  )
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (!reported) {
    return true;
  }

  if (
    reported ===
    expectedContentType
  ) {
    return true;
  }

  if (
    expectedContentType ===
      "image/jpeg" &&
    reported ===
      "image/pjpeg"
  ) {
    return true;
  }

  if (
    (
      expectedContentType ===
        "image/heic" ||
      expectedContentType ===
        "image/heif"
    ) &&
    (
      reported ===
        "image/heic" ||
      reported ===
        "image/heif" ||
      reported ===
        "application/octet-stream"
    )
  ) {
    return true;
  }

  return false;
}

function bufferStartsWith(
  buffer,
  bytes
) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < bytes.length
  ) {
    return false;
  }

  return bytes.every(
    (value, index) =>
      buffer[index] === value
  );
}

function hasValidFileSignature(
  buffer,
  extension
) {
  if (!Buffer.isBuffer(buffer)) {
    return false;
  }

  if (extension === ".pdf") {
    return (
      buffer.length >= 5 &&
      buffer
        .subarray(0, 5)
        .toString("ascii") ===
        "%PDF-"
    );
  }

  if (
    extension === ".jpg" ||
    extension === ".jpeg"
  ) {
    return bufferStartsWith(
      buffer,
      [0xff, 0xd8, 0xff]
    );
  }

  if (extension === ".png") {
    return bufferStartsWith(
      buffer,
      [
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a
      ]
    );
  }

  if (
    extension === ".heic" ||
    extension === ".heif"
  ) {
    if (buffer.length < 12) {
      return false;
    }

    const boxType = buffer
      .subarray(4, 8)
      .toString("ascii");

    const brand = buffer
      .subarray(8, 12)
      .toString("ascii");

    return (
      boxType === "ftyp" &&
      [
        "heic",
        "heix",
        "hevc",
        "hevx",
        "heim",
        "heis",
        "mif1",
        "msf1"
      ].includes(brand)
    );
  }

  return false;
}

function validateDocumentUpload(
  input = {}
) {
  const errors = [];

  const buffer = input.buffer;
  const originalName =
    sanitizeOriginalName(
      input.originalName
    );

  const fileType =
    getFileTypeFromName(
      originalName
    );

  const category =
    normalizeCategory(
      input.category
    );

  const taxYear =
    normalizeTaxYear(
      input.taxYear
    );

  const note =
    cleanText(
      input.note,
      500
    );

  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0
  ) {
    errors.push(
      "Choose a document to upload."
    );
  }

  if (
    Buffer.isBuffer(buffer) &&
    buffer.length >
      MAX_FILE_BYTES
  ) {
    errors.push(
      "The document is larger than 15 MB."
    );
  }

  if (!originalName) {
    errors.push(
      "The document name is missing."
    );
  }

  if (!fileType) {
    errors.push(
      "Upload a PDF, JPG, JPEG, PNG, HEIC, or HEIF file."
    );
  }

  if (
    fileType &&
    !contentTypeMatches(
      input.contentType,
      fileType.contentType
    )
  ) {
    errors.push(
      "The document type does not match its file name."
    );
  }

  if (
    fileType &&
    Buffer.isBuffer(buffer) &&
    buffer.length > 0 &&
    !hasValidFileSignature(
      buffer,
      fileType.extension
    )
  ) {
    errors.push(
      "The document content does not match an allowed file type."
    );
  }

  if (!category) {
    errors.push(
      "Choose a document category."
    );
  }

  if (!taxYear) {
    errors.push(
      "Choose the tax year for this document."
    );
  }

  if (errors.length) {
    return {
      ok: false,
      errors
    };
  }

  const sha256 = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");

  return {
    ok: true,
    value: {
      buffer,
      originalName,
      extension:
        fileType.extension,
      contentType:
        fileType.contentType,
      sizeBytes:
        buffer.length,
      category,
      categoryLabel:
        getCategoryLabel(category),
      taxYear,
      taxYearLabel:
        getTaxYearLabel(taxYear),
      note,
      sha256
    }
  };
}

function publicDocumentRecord(
  record = {}
) {
  const reviewStatus =
    normalizeReviewStatus(
      record.reviewStatus
    ) ||
    "awaiting-review";

  return {
    documentId:
      String(
        record.documentId || ""
      ),
    taxYear:
      String(
        record.taxYear || ""
      ),
    taxYearLabel:
      getTaxYearLabel(
        record.taxYear
      ),
    category:
      String(
        record.category || ""
      ),
    categoryLabel:
      getCategoryLabel(
        record.category
      ),
    originalName:
      sanitizeOriginalName(
        record.originalName
      ),
    contentType:
      String(
        record.contentType || ""
      ),
    sizeBytes:
      Number(
        record.sizeBytes || 0
      ),
    note:
      cleanText(
        record.note,
        500
      ),
    reviewStatus,
    statusLabel:
      getReviewStatusLabel(
        reviewStatus
      ),
    clientMessage:
      cleanText(
        record.clientMessage,
        1200
      ),
    retentionUntil:
      normalizeRetentionDate(
        record.retentionUntil
      ),
    reviewedAt:
      String(
        record.reviewedAt || ""
      ),
    uploadedAt:
      String(
        record.uploadedAt || ""
      ),
    updatedAt:
      String(
        record.updatedAt || ""
      )
  };
}

function officeDocumentRecord(
  record = {}
) {
  const publicRecord =
    publicDocumentRecord(record);

  return {
    ...publicRecord,
    portalId:
      String(
        record.portalId || ""
      ),
    accountLeadId:
      String(
        record.accountLeadId || ""
      ),
    linkedLeadId:
      String(
        record.linkedLeadId || ""
      ),
    email:
      normalizeEmail(
        record.email
      ),
    sha256:
      String(
        record.sha256 || ""
      ),
    officeNote:
      cleanText(
        record.officeNote,
        3000
      ),
    reviewedBy:
      cleanText(
        record.reviewedBy,
        200
      ),
    statusChangedAt:
      String(
        record.statusChangedAt || ""
      ),
    withdrawnAt:
      String(
        record.withdrawnAt || ""
      )
  };
}

module.exports = {
  MAX_FILE_BYTES,
  DOCUMENT_CATEGORIES,
  REVIEW_STATUSES,
  FILE_TYPES,
  cleanText,
  normalizeEmail,
  normalizeCategory,
  getCategoryLabel,
  normalizeReviewStatus,
  getReviewStatusLabel,
  normalizeRetentionDate,
  normalizeTaxYear,
  getTaxYearLabel,
  sanitizeOriginalName,
  getFileTypeFromName,
  hasValidFileSignature,
  validateDocumentUpload,
  publicDocumentRecord,
  officeDocumentRecord
};
