/**
 * input.schema.js
 * Greatest Business Solution LLC â€” Tax Estimator
 *
 * Responsibilities:
 *   1. Define the canonical shape of every input field
 *   2. Normalize raw form values (strings â†’ numbers, yes/no â†’ booleans)
 *   3. Apply safe defaults for optional fields
 *   4. Validate all fields and return { valid, errors }
 *
 * Usage:
 *   const { normalize, validate, prepareInput } = require('./schema/input.schema');
 *
 *   const input   = normalize(rawFormData);   // step 1 â€” clean the data
 *   const check   = validate(input);          // step 2 â€” check it
 *   if (!check.valid) return check.errors;
 *   // input is now safe to pass to any engine
 */

"use strict";

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONSTANTS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SUPPORTED_TAX_YEARS = [2022, 2023, 2024, 2025];

const FILING_STATUSES = ["single", "mfj", "mfs", "hoh", "qw"];

const FILING_STATUS_LABELS = {
  single: "Single",
  mfj:    "Married Filing Jointly",
  mfs:    "Married Filing Separately",
  hoh:    "Head of Household",
  qw:     "Qualifying Widow(er)",
};

// All valid two-letter US state/territory codes
const VALID_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC",
]);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FIELD DEFINITIONS
// Used for documentation, default application, and structured error messages.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const FIELDS = {

  // â”€â”€ Required â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  taxYear: {
    required:    true,
    type:        "integer",
    label:       "Tax Year",
    allowed:     SUPPORTED_TAX_YEARS,
  },

  filingStatus: {
    required:    true,
    type:        "string",
    label:       "Filing Status",
    allowed:     FILING_STATUSES,
  },

  age: {
    required:    true,
    type:        "integer",
    label:       "Age",
    min:         1,
    max:         120,
    hint:        "Your age as of December 31 of the tax year",
  },

  isFullTimeStudent: {
    required:    true,
    type:        "boolean",
    label:       "Full-Time Student",
  },

  canBeClaimedAsDependent: {
    required:    true,
    type:        "boolean",
    label:       "Can Be Claimed as Dependent",
  },

  stateCode: {
    required:    true,
    type:        "string",
    label:       "State of Residence",
    hint:        "Two-letter state abbreviation (e.g. CA, TX, NY)",
  },

  numberOfDependents: {
    required:    true,
    type:        "integer",
    label:       "Number of Dependents",
    min:         0,
    max:         20,
    default:     0,
  },

  w2Income: {
    required:    true,
    type:        "number",
    label:       "W-2 Wages",
    min:         0,
    hint:        "Total from all W-2s, Box 1",
    default:     0,
  },

  federalWithheld: {
    required:    true,
    type:        "number",
    label:       "Federal Tax Withheld",
    min:         0,
    hint:        "Total from all W-2s, Box 2",
    default:     0,
  },

  stateWithheld: {
    required:    true,
    type:        "number",
    label:       "State Tax Withheld",
    min:         0,
    hint:        "Total from all W-2s, Box 17",
    default:     0,
  },

  // â”€â”€ Optional â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  otherIncome: {
    required:    false,
    type:        "number",
    label:       "Other Income",
    min:         0,
    hint:        "1099, freelance, rental, interest, dividends, etc.",
    default:     0,
  },

  scholarships: {
    required:    false,
    type:        "number",
    label:       "Scholarships & Grants",
    min:         0,
    hint:        "Total scholarships and grants received",
    default:     0,
  },

  educationExpenses: {
    required:    false,
    type:        "number",
    label:       "Qualified Education Expenses",
    min:         0,
    hint:        "Tuition, required fees, required books and supplies",
    default:     0,
  },
selfEmploymentIncome: {
  required: false,
  type: "number",
  label: "1099 / Business Income",
  min: 0,
  default: 0,
},

businessExpenses: {
  required: false,
  type: "number",
  label: "Business Expenses",
  min: 0,
  default: 0,
},

businessMileage: {
  required: false,
  type: "number",
  label: "Business Mileage",
  min: 0,
  default: 0,
},

estimatedTaxPayments: {
  required: false,
  type: "number",
  label: "Estimated Tax Payments",
  min: 0,
  default: 0,
},

// ðŸ”¥ ADD THIS RIGHT HERE
selfEmploymentStreams: {
  required: false,
  type: "array",
  label: "1099 Income Streams",
  default: [],
},

};
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP 1 â€” NORMALIZE
// Converts raw form values into typed, clean values.
// Safe to call on any raw input â€” will never throw.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Convert a value to a boolean.
 * Handles: true/false, "yes"/"no", "true"/"false", 1/0, "1"/"0"
 * Returns null if the value cannot be resolved.
 */
function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number")  return value === 1 ? true : value === 0 ? false : null;

  const s = String(value).trim().toLowerCase();
  if (s === "true"  || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no"  || s === "0") return false;

  return null; // unresolvable
}

/**
 * Convert a value to a finite number.
 * Strips commas and dollar signs from strings.
 * Returns null if the result is not a finite number.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const cleaned = String(value).replace(/[$,\s]/g, "");
  const parsed  = Number(cleaned);

  return isFinite(parsed) ? parsed : null;
}

/**
 * Convert a value to an integer.
 * Returns null if the result is not a safe integer.
 */
function toInteger(value) {
  const n = toNumber(value);
  if (n === null) return null;
  const i = Math.round(n); // tolerate "2024.0" from some form inputs
  return Number.isSafeInteger(i) ? i : null;
}

/**
 * Normalize a raw input object into typed values.
 * Does not validate â€” just cleans and converts.
 *
 * @param  {object} raw   Raw data from the UI form
 * @returns {object}      Normalized input object
 */
function normalize(raw) {
  if (!raw || typeof raw !== "object") return {};

  const out = {};

  // Tax Year
  out.taxYear = toInteger(raw.taxYear);

  // Filing Status â€” lowercase and trim
  out.filingStatus = (typeof raw.filingStatus === "string")
    ? raw.filingStatus.trim().toLowerCase()
    : raw.filingStatus;

  // Age
  out.age = toInteger(raw.age);

  // Booleans
  out.isFullTimeStudent        = toBoolean(raw.isFullTimeStudent);
  out.canBeClaimedAsDependent  = toBoolean(raw.canBeClaimedAsDependent);

  // State Code â€” uppercase and trim
  out.stateCode = (typeof raw.stateCode === "string")
    ? raw.stateCode.trim().toUpperCase()
    : raw.stateCode;

  // Integer count
  out.numberOfDependents = toInteger(raw.numberOfDependents) ?? 0;

  // Dollar amounts â€” floor to 2 decimal places, never negative
  const moneyFields = [
  "w2Income",
  "federalWithheld",
  "stateWithheld",
  "otherIncome",
  "scholarships",
  "educationExpenses",

  // ðŸ”¥ ADD THESE
  "selfEmploymentIncome",
  "businessExpenses",
  "businessMileage",
  "estimatedTaxPayments",
];

  for (const field of moneyFields) {
  const n = toNumber(raw[field]);
  out[field] = n !== null ? Math.max(0, Math.round(n * 100) / 100) : null;
}

// ðŸ”¥ ADD THIS RIGHT HERE (before return)
if (Array.isArray(raw.selfEmploymentStreams)) {
  out.selfEmploymentStreams = raw.selfEmploymentStreams.map(stream => ({
    source: typeof stream.source === "string" ? stream.source.trim() : "",
    income: Math.max(0, toNumber(stream.income) || 0),
    expenses: Math.max(0, toNumber(stream.expenses) || 0),
  }));
} else {
  out.selfEmploymentStreams = [];
}

return out;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP 2 â€” APPLY DEFAULTS
// Fills in safe zero-values for optional fields that were not provided.
// Call after normalize(), before validate().
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Apply field defaults to a normalized input object.
 * Only fills in fields that are null, undefined, or not present.
 *
 * @param  {object} normalized   Output of normalize()
 * @returns {object}             Input with defaults applied (does not mutate original)
 */
function applyDefaults(normalized) {
  const out = { ...normalized };

  for (const [field, rules] of Object.entries(FIELDS)) {
    if (
      rules.default !== undefined &&
      (out[field] === null || out[field] === undefined)
    ) {
      out[field] = rules.default;
    }
  }

  return out;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP 3 â€” VALIDATE
// Checks all fields and returns { valid: boolean, errors: string[] }.
// Expects input that has already been through normalize() and applyDefaults().
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Validate a normalized, defaulted input object.
 *
 * @param  {object} input   Output of applyDefaults(normalize(raw))
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(input) {
  const errors = [];

  for (const [field, rules] of Object.entries(FIELDS)) {
    const value = input[field];
    const label = rules.label || field;

    // â”€â”€ Presence check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const missing = value === null || value === undefined;

    if (rules.required && missing) {
      errors.push(`"${label}" is required.`);
      continue; // no point running further checks on a missing value
    }

    if (missing) continue; // optional and absent â€” skip all checks

    // â”€â”€ Type checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (rules.type === "boolean" && typeof value !== "boolean") {
      errors.push(`"${label}" must be Yes or No.`);
      continue;
    }

    if (rules.type === "integer") {
      if (!Number.isInteger(value)) {
        errors.push(`"${label}" must be a whole number.`);
        continue;
      }
    }

    if (rules.type === "number") {
      if (typeof value !== "number" || !isFinite(value)) {
        errors.push(`"${label}" must be a valid dollar amount.`);
        continue;
      }
    }

    if (rules.type === "string" && typeof value !== "string") {
      errors.push(`"${label}" must be text.`);
      continue;
    }

    // â”€â”€ Allowed values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (rules.allowed && !rules.allowed.includes(value)) {
      if (field === "taxYear") {
        errors.push(
          `"${label}" must be one of: ${rules.allowed.join(", ")}.`
        );
      } else if (field === "filingStatus") {
        const opts = FILING_STATUSES.map(k => FILING_STATUS_LABELS[k]).join(", ");
        errors.push(`"${label}" must be one of: ${opts}.`);
      } else {
        errors.push(`"${label}" has an unrecognized value.`);
      }
      continue;
    }

    // â”€â”€ State code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (field === "stateCode" && !VALID_STATE_CODES.has(value)) {
      errors.push(`"${label}" must be a valid two-letter US state code (e.g. CA, TX, NY).`);
      continue;
    }

    // â”€â”€ Range checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (rules.min !== undefined && value < rules.min) {
      errors.push(`"${label}" must be at least ${rules.min}.`);
    }
    if (rules.max !== undefined && value > rules.max) {
      errors.push(`"${label}" must be no more than ${rules.max}.`);
    }
  }

  // â”€â”€ Cross-field rules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Withholding sanity check: federal withheld should not exceed total income
  const totalIncome = (input.w2Income || 0) + (input.otherIncome || 0);
  if (
    totalIncome > 0 &&
    (input.federalWithheld || 0) > totalIncome
  ) {
    errors.push(
      `"Federal Tax Withheld" (${fmt(input.federalWithheld)}) cannot exceed total income ` +
      `(${fmt(totalIncome)}). Please check your W-2.`
    );
  }

  return {
    valid:  errors.length === 0,
    errors,
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONVENIENCE â€” prepareInput()
// Runs normalize â†’ applyDefaults â†’ validate in one call.
// Returns { valid, errors, input } where input is ready for engines.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Full pipeline: normalize â†’ defaults â†’ validate.
 * Use this in the orchestrator instead of calling each step manually.
 *
 * @param  {object} raw   Raw data from the UI form
 * @returns {{ valid: boolean, errors: string[], input: object }}
 */
function prepareInput(raw) {
  const normalized   = normalize(raw);
  const withDefaults = applyDefaults(normalized);
  const result       = validate(withDefaults);

  return {
    valid:  result.valid,
    errors: result.errors,
    input:  withDefaults,   // always return cleaned input even if invalid (useful for partial UIs)
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// INTERNAL HELPERS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function fmt(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(amount || 0);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// EXPORTS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

module.exports = {
  // Main pipeline (use this in the orchestrator)
  prepareInput,

  // Individual steps (use these in unit tests)
  normalize,
  applyDefaults,
  validate,

  // Conversion helpers (exposed for unit testing)
  toBoolean,
  toNumber,
  toInteger,

  // Constants (available to other modules if needed)
  FIELDS,
  FILING_STATUSES,
  FILING_STATUS_LABELS,
  VALID_STATE_CODES,
  SUPPORTED_TAX_YEARS,
};



