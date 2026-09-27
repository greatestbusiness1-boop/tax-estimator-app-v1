"use strict";
// =============================================================================
// PINNACLE PLANNING INTELLIGENCE V1
//
// Detects deterministic, traceable PLANNING OPPORTUNITIES from a customer's
// existing Pinnacle data. This module never talks to a client directly and
// never becomes an approved Action Plan recommendation on its own -- it only
// produces office-only candidates that a preparer reviews, edits, and
// explicitly chooses to add to the Action Plan (server.js handles that
// office-only exposure and the add-to-Action-Plan conversion).
//
// Every rule here is a plain deterministic threshold against numbers that
// were already computed by the authoritative tax engine (computePinnacleTaxReserve
// in server.js) or summed directly from the customer's own recorded
// workspace data -- this module performs no tax calculations of its own and
// fabricates no dollar amounts. Where the repository cannot yet calculate a
// real number (QBI, retirement contribution limits, S-corp savings), the
// opportunity is a review trigger only: estimatedImpact is null and
// requiresProfessionalReview is true.
// =============================================================================

// ---------------------------------------------------------------------------
// Review-trigger thresholds. These are internal signals for when a preparer
// should look at something -- none of them are tax-law eligibility rules.
// ---------------------------------------------------------------------------

// Below this remaining/unfunded amount, a shortfall or funding-gap
// opportunity is not raised at all -- avoids noise for trivial amounts.
const SHORTFALL_MATERIALITY_THRESHOLD = 500;
const SHORTFALL_HIGH_PRIORITY_THRESHOLD = 2000;
const FUNDING_GAP_MATERIALITY_THRESHOLD = 500;
const FUNDING_GAP_HIGH_PRIORITY_THRESHOLD = 2000;

// Gross Schedule-C-style business income below this is treated as too small
// to meaningfully evaluate an expense ratio against (avoids flagging trivial
// side income where a near-zero expense ratio is unremarkable).
const MIN_INCOME_FOR_EXPENSE_REVIEW = 5000;
// Recorded business expenses below this share of gross business income
// trigger a "review for completeness" opportunity. This is a conservative,
// internal review trigger only -- not an industry benchmark and not a claim
// that any specific deduction is missing.
const LOW_EXPENSE_RATIO_THRESHOLD = 0.05;

// Active business income at or below this level of recorded business
// mileage triggers a mileage-recordkeeping review opportunity. This does not
// assume the client drives for business -- see buildMileageOpportunity().
const MIN_MILEAGE_FOR_REVIEW_TRIGGER = 50;

// "Meaningful" self-employment income for opening a retirement-plan review
// hook. Distinct from the QBI trigger (any positive amount) because a
// retirement-contribution conversation is not useful at trivial income
// levels.
const RETIREMENT_REVIEW_MIN_NET_INCOME = 5000;

// Internal review-trigger threshold only -- NOT an S-corp/entity tax-law
// eligibility threshold. It exists solely to decide when a preparer should
// take a look at entity structure; the actual analysis (payroll cost,
// reasonable compensation, state-level cost, filing overhead) happens later
// in a dedicated phase.
const ENTITY_STRUCTURE_REVIEW_THRESHOLD = 60000;

const CONFIDENCE = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  REVIEW_REQUIRED: "review_required"
});

const PRIORITY = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
});

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return `$${Math.round(numberOrZero(value)).toLocaleString("en-US")}`;
}

function baseOpportunity(fields) {
  return {
    id: fields.strategyKey,
    strategyKey: fields.strategyKey,
    category: fields.category,
    priority: fields.priority,
    title: fields.title,
    finding: fields.finding,
    rationale: fields.rationale,
    estimatedImpact: fields.estimatedImpact === undefined ? null : fields.estimatedImpact,
    impactType: fields.impactType || "",
    deadline: fields.deadline || "",
    documentsNeeded: Array.isArray(fields.documentsNeeded) ? fields.documentsNeeded : [],
    suggestedClientAction: fields.suggestedClientAction || "",
    sourceInputs: Array.isArray(fields.sourceInputs) ? fields.sourceInputs : [],
    assumptions: Array.isArray(fields.assumptions) ? fields.assumptions : [],
    confidence: fields.confidence,
    requiresProfessionalReview: Boolean(fields.requiresProfessionalReview),
    calculationDetails: fields.calculationDetails || {}
  };
}

// =============================================================================
// A. Estimated tax / reserve shortfall
// =============================================================================

function buildShortfallOpportunity(context) {
  const reserve = context.reserve || {};
  if (reserve.calculationStatus !== "complete") return null;

  const remaining = numberOrZero(reserve.remainingEstimatedTax);
  if (remaining < SHORTFALL_MATERIALITY_THRESHOLD) return null;

  const priority = remaining >= SHORTFALL_HIGH_PRIORITY_THRESHOLD
    ? PRIORITY.HIGH
    : PRIORITY.MEDIUM;

  return baseOpportunity({
    strategyKey: "estimated_tax_shortfall",
    category: "estimated-tax",
    priority,
    title: "Estimated tax reserve shortfall",
    finding: `The current Pinnacle tax reserve calculation shows an estimated total tax position of ${money(reserve.estimatedTotalTax)}, with ${money(reserve.taxPaymentsRecorded)} in recorded estimated-tax payments and ${money(remaining)} remaining unfunded.`,
    rationale: "This is based directly on the authoritative Pinnacle reserve calculation and the client's own recorded estimated-tax payments. It does not calculate an underpayment penalty and does not state that a specific payment amount is legally required -- it flags that the recorded payments appear to be behind the current estimated position so the preparer can review the client's situation.",
    estimatedImpact: remaining,
    impactType: "remaining_estimated_tax",
    documentsNeeded: ["Current profit-and-loss detail", "Records of any estimated-tax payments made outside the Pinnacle workspace"],
    suggestedClientAction: "Review your recorded income, expenses, and any estimated-tax payments for accuracy, and discuss your current tax position with your preparer.",
    sourceInputs: ["reserve.estimatedTotalTax", "reserve.taxPaymentsRecorded", "reserve.remainingEstimatedTax"],
    assumptions: [
      "This reflects only estimated-tax payments and business data recorded in the Pinnacle workspace -- payments made outside the workspace will not be reflected until they are recorded.",
      "This is not an underpayment-penalty calculation."
    ],
    confidence: CONFIDENCE.HIGH,
    requiresProfessionalReview: false,
    calculationDetails: {
      estimatedTotalTax: numberOrZero(reserve.estimatedTotalTax),
      taxPaymentsRecorded: numberOrZero(reserve.taxPaymentsRecorded),
      remainingEstimatedTax: remaining
    }
  });
}

// =============================================================================
// B. Business expense recordkeeping / low expense ratio
// =============================================================================

function buildLowExpenseRatioOpportunity(context) {
  const grossIncome = numberOrZero(context.grossBusinessIncome);
  const expenses = numberOrZero(context.businessExpenses);

  if (grossIncome < MIN_INCOME_FOR_EXPENSE_REVIEW) return null;

  const ratio = grossIncome > 0 ? expenses / grossIncome : 0;
  if (ratio >= LOW_EXPENSE_RATIO_THRESHOLD) return null;

  return baseOpportunity({
    strategyKey: "low_expense_ratio_review",
    category: "recordkeeping",
    priority: PRIORITY.LOW,
    title: "Review business expenses for completeness",
    finding: `Recorded business expenses (${money(expenses)}) are low relative to recorded gross business income (${money(grossIncome)}).`,
    rationale: `This uses a conservative internal review threshold (recorded expenses below ${(LOW_EXPENSE_RATIO_THRESHOLD * 100).toFixed(0)}% of gross business income, with gross income of at least ${money(MIN_INCOME_FOR_EXPENSE_REVIEW)}) designed only to trigger a preparer review -- it is not an industry benchmark and it is not a finding that any deduction is missing.`,
    estimatedImpact: null,
    impactType: "",
    documentsNeeded: ["Business bank and credit-card statements", "Receipts for business purchases"],
    suggestedClientAction: "Review your business bank and credit-card statements for any business expenses that may not yet be recorded in Pinnacle.",
    sourceInputs: ["grossBusinessIncome", "businessExpenses"],
    assumptions: [
      "This does not conclude that any specific expense or deduction is missing -- it only flags a recorded ratio for review."
    ],
    confidence: CONFIDENCE.MEDIUM,
    requiresProfessionalReview: false,
    calculationDetails: {
      grossBusinessIncome: grossIncome,
      businessExpenses: expenses,
      expenseRatio: Math.round(ratio * 10000) / 10000,
      threshold: LOW_EXPENSE_RATIO_THRESHOLD
    }
  });
}

// =============================================================================
// C. Business mileage / vehicle recordkeeping
// =============================================================================

function buildMileageOpportunity(context) {
  const grossIncome = numberOrZero(context.grossBusinessIncome);
  if (grossIncome <= 0) return null;

  const mileageTotal = numberOrZero(context.businessMileageTotal);
  const incompleteRecords = Math.max(0, Math.trunc(numberOrZero(context.incompleteMileageRecordCount)));

  if (mileageTotal <= MIN_MILEAGE_FOR_REVIEW_TRIGGER) {
    return baseOpportunity({
      strategyKey: "mileage_recordkeeping_review",
      category: "recordkeeping",
      priority: PRIORITY.LOW,
      title: "Review vehicle / business mileage records",
      finding: mileageTotal > 0
        ? `Only ${Math.round(mileageTotal)} business miles are recorded despite active business income.`
        : "No business mileage is currently recorded despite active business income.",
      rationale: "This does not assume the client uses a vehicle for business. It only flags that, if a vehicle is used for business, mileage or actual-expense records should be reviewed for completeness.",
      estimatedImpact: null,
      impactType: "",
      documentsNeeded: ["Mileage log (dates, destinations, business purpose, miles) if a vehicle is used for business"],
      suggestedClientAction: "If you use a vehicle for business, confirm that your mileage or actual vehicle expenses are being tracked and recorded in Pinnacle.",
      sourceInputs: ["businessMileageTotal", "grossBusinessIncome"],
      assumptions: [
        "This does not assume the client drives for business -- it is a recordkeeping review trigger only."
      ],
      confidence: CONFIDENCE.MEDIUM,
      requiresProfessionalReview: false,
      calculationDetails: {
        businessMileageTotal: mileageTotal,
        threshold: MIN_MILEAGE_FOR_REVIEW_TRIGGER
      }
    });
  }

  if (incompleteRecords > 0) {
    return baseOpportunity({
      strategyKey: "mileage_recordkeeping_review",
      category: "recordkeeping",
      priority: PRIORITY.LOW,
      title: "Complete incomplete mileage records",
      finding: `${incompleteRecords} recorded mileage ${incompleteRecords === 1 ? "entry is" : "entries are"} missing information (a date or a mile count) needed to support the deduction.`,
      rationale: "Business mileage is recorded, so this does not question whether the client drives for business -- it only flags specific existing entries that are missing information the workspace already tracks.",
      estimatedImpact: null,
      impactType: "",
      documentsNeeded: ["Completed mileage log entries (date and miles) for the flagged records"],
      suggestedClientAction: "Review and complete the flagged mileage entries in Pinnacle so each one has a date and a mile count.",
      sourceInputs: ["incompleteMileageRecordCount", "businessMileageTotal"],
      assumptions: [],
      confidence: CONFIDENCE.MEDIUM,
      requiresProfessionalReview: false,
      calculationDetails: {
        businessMileageTotal: mileageTotal,
        incompleteMileageRecordCount: incompleteRecords
      }
    });
  }

  return null;
}

// =============================================================================
// D. Quarterly estimated payment review
// =============================================================================

function buildQuarterlyPaymentReviewOpportunity(context) {
  const reserve = context.reserve || {};
  if (reserve.calculationStatus !== "complete") return null;

  const estimatedTotalTax = numberOrZero(reserve.estimatedTotalTax);
  const taxPaymentsRecorded = numberOrZero(reserve.taxPaymentsRecorded);

  if (estimatedTotalTax < SHORTFALL_MATERIALITY_THRESHOLD) return null;
  if (taxPaymentsRecorded > 0) return null;

  return baseOpportunity({
    strategyKey: "quarterly_estimated_payment_review",
    category: "estimated-tax",
    priority: PRIORITY.MEDIUM,
    title: "Quarterly estimated payment review",
    finding: `No estimated-tax payments are recorded for the current tax year, while the Pinnacle reserve calculation shows an estimated total tax position of ${money(estimatedTotalTax)}.`,
    rationale: "This is a review trigger, not an automated payment instruction. The repository does not currently calculate safe-harbor amounts or quarterly due dates, so no specific quarterly amount is presented here -- a preparer should review the client's quarterly estimated-payment situation directly.",
    estimatedImpact: null,
    impactType: "",
    documentsNeeded: ["Records of any estimated-tax payments made outside the Pinnacle workspace"],
    suggestedClientAction: "Confirm with your preparer whether quarterly estimated-tax payments are needed and, if so, when the next payment is due.",
    sourceInputs: ["reserve.estimatedTotalTax", "reserve.taxPaymentsRecorded"],
    assumptions: [
      "This does not calculate a safe-harbor amount or a specific quarterly due amount.",
      "This reflects only payments recorded in the Pinnacle workspace."
    ],
    confidence: CONFIDENCE.MEDIUM,
    requiresProfessionalReview: false,
    calculationDetails: {
      estimatedTotalTax,
      taxPaymentsRecorded
    }
  });
}

// =============================================================================
// E. Tax savings funding gap
// =============================================================================

function buildFundingGapOpportunity(context) {
  const reserve = context.reserve || {};
  if (reserve.calculationStatus !== "complete") return null;

  const remaining = numberOrZero(reserve.remainingEstimatedTax);
  const savingsDeposited = numberOrZero(context.savingsDeposited);
  const gap = remaining - savingsDeposited;

  if (gap < FUNDING_GAP_MATERIALITY_THRESHOLD) return null;

  const priority = gap >= FUNDING_GAP_HIGH_PRIORITY_THRESHOLD
    ? PRIORITY.HIGH
    : PRIORITY.MEDIUM;

  return baseOpportunity({
    strategyKey: "tax_savings_funding_gap",
    category: "cash-flow",
    priority,
    title: "Tax savings funding gap",
    finding: `${money(savingsDeposited)} has been recorded as saved toward taxes, while the remaining estimated tax position is ${money(remaining)} -- a funding gap of ${money(gap)}.`,
    rationale: "Money recorded as a savings deposit is not the same as money actually paid to a taxing authority. This compares the authoritative remaining estimated tax against the client's own recorded savings deposits (not tax payments) to flag whether the client appears underfunded relative to their current estimated tax position.",
    estimatedImpact: gap,
    impactType: "funding_gap",
    documentsNeeded: ["Records of the tax savings account or fund used"],
    suggestedClientAction: "Review how much you have set aside toward taxes compared to your current estimated tax position, and consider whether additional savings are needed.",
    sourceInputs: ["reserve.remainingEstimatedTax", "savingsDeposited"],
    assumptions: [
      "Savings deposits are tracked separately from actual tax payments -- this opportunity never treats a savings deposit as a tax payment.",
      "This reflects only savings deposits recorded in the Pinnacle workspace."
    ],
    confidence: CONFIDENCE.HIGH,
    requiresProfessionalReview: false,
    calculationDetails: {
      remainingEstimatedTax: remaining,
      savingsDeposited,
      fundingGap: gap
    }
  });
}

// =============================================================================
// QBI / retirement / entity -- detection only, no calculations
// =============================================================================

// Phase 4 note: even when engines/pinnacleAdvancedPlanning.js can produce a
// defensible preliminary number (context.qbi), this opportunity always keeps
// estimatedImpact: null and requiresProfessionalReview: true -- the
// preliminary figure is surfaced only through calculationDetails/finding for
// the preparer to review, never as a trusted "impact" amount.
function buildQbiOpportunity(context) {
  const netBusinessIncome = numberOrZero(context.reserve?.netBusinessIncome);
  if (netBusinessIncome <= 0) return null;

  const qbi = context.qbi && typeof context.qbi === "object" ? context.qbi : null;
  const hasPreliminaryAmount = Boolean(
    qbi && qbi.status === "preliminary_below_threshold" && typeof qbi.estimatedQbiDeduction === "number"
  );

  const finding = hasPreliminaryAmount
    ? `Positive qualified-looking self-employment/business income (${money(netBusinessIncome)} net business income) was identified. A tentative, below-threshold Section 199A calculation estimates a preliminary QBI deduction of ${money(qbi.estimatedQbiDeduction)} -- see calculationDetails.`
    : `Positive qualified-looking self-employment/business income (${money(netBusinessIncome)} net business income) was identified.`;

  const rationale = qbi && qbi.reviewReasons && qbi.reviewReasons.length
    ? `The current tax engine does not calculate a final Qualified Business Income (Section 199A) deduction. ${qbi.reviewReasons.join(" ")}`
    : "The current tax engine does not calculate the Qualified Business Income (Section 199A) deduction. Eligibility and the deduction amount depend on facts -- taxable income level, business type, W-2 wages paid, and qualified property -- that are not yet fully modeled in this repository. This is a review opportunity only.";

  return baseOpportunity({
    strategyKey: "qbi_section_199a_review",
    category: "planning-review",
    priority: PRIORITY.MEDIUM,
    title: "QBI / Section 199A review opportunity",
    finding,
    rationale,
    estimatedImpact: null,
    impactType: "",
    documentsNeeded: ["Complete business income and expense detail", "Prior-year tax return"],
    suggestedClientAction: "Discuss with your preparer whether your business income may qualify for the QBI deduction.",
    sourceInputs: ["reserve.netBusinessIncome", "advancedPlanning.qbi"],
    assumptions: [
      "This does not state that the client qualifies for the QBI deduction.",
      "No deduction amount is calculated or implied by this opportunity, even when a preliminary figure is available in calculationDetails.",
      ...(qbi?.assumptions || [])
    ],
    confidence: CONFIDENCE.REVIEW_REQUIRED,
    requiresProfessionalReview: true,
    calculationDetails: {
      netBusinessIncome,
      preliminaryQbiCalculation: qbi || null
    }
  });
}

function buildRetirementOpportunity(context) {
  const netBusinessIncome = numberOrZero(context.reserve?.netBusinessIncome);
  if (netBusinessIncome < RETIREMENT_REVIEW_MIN_NET_INCOME) return null;

  const retirement = context.retirement && typeof context.retirement === "object" ? context.retirement : null;
  const hasPreliminaryAmounts = Boolean(
    retirement &&
    retirement.status === "complete" &&
    typeof retirement.sepIra?.estimatedMaximumContribution === "number" &&
    typeof retirement.solo401k?.estimatedMaximumContribution === "number"
  );

  const finding = hasPreliminaryAmounts
    ? `Meaningful positive self-employment income (${money(netBusinessIncome)} net business income) was identified. Preliminary estimates: up to ${money(retirement.sepIra.estimatedMaximumContribution)} SEP-IRA or up to ${money(retirement.solo401k.estimatedMaximumContribution)} Solo 401(k) -- see calculationDetails.`
    : `Meaningful positive self-employment income (${money(netBusinessIncome)} net business income) was identified.`;

  return baseOpportunity({
    strategyKey: "self_employed_retirement_review",
    category: "planning-review",
    priority: PRIORITY.MEDIUM,
    title: "Self-employed retirement plan review",
    finding,
    rationale: "This is a review opportunity to open the conversation. A higher estimated maximum contribution is not automatically the better strategy, and the preliminary figures below do not account for the client's cash-flow needs or administrative preferences.",
    estimatedImpact: null,
    impactType: "",
    documentsNeeded: ["Current-year net business income detail", "Existing retirement account statements, if any"],
    suggestedClientAction: "Discuss with your preparer whether a SEP-IRA or Solo 401(k) contribution may reduce your tax liability this year.",
    sourceInputs: ["reserve.netBusinessIncome", "advancedPlanning.retirement"],
    assumptions: [
      "No contribution amount is recommended by this opportunity, even when preliminary maximums are available in calculationDetails.",
      "A higher estimated maximum contribution is not automatically the better strategy.",
      ...(retirement?.comparisonNotes || [])
    ],
    confidence: CONFIDENCE.REVIEW_REQUIRED,
    requiresProfessionalReview: true,
    calculationDetails: {
      netBusinessIncome,
      threshold: RETIREMENT_REVIEW_MIN_NET_INCOME,
      preliminaryRetirementCalculation: retirement || null
    }
  });
}

function buildEntityStructureOpportunity(context) {
  const netBusinessIncome = numberOrZero(context.reserve?.netBusinessIncome);
  if (netBusinessIncome < ENTITY_STRUCTURE_REVIEW_THRESHOLD) return null;

  return baseOpportunity({
    strategyKey: "entity_structure_review",
    category: "planning-review",
    priority: PRIORITY.MEDIUM,
    title: "Entity structure / S-corporation review",
    finding: `Net self-employment income (${money(netBusinessIncome)}) exceeds the internal entity-structure review threshold (${money(ENTITY_STRUCTURE_REVIEW_THRESHOLD)}).`,
    rationale: "This threshold is an internal review trigger only -- it is not an S-corporation tax-law eligibility threshold. The current tax engine does not calculate S-corp payroll cost, reasonable compensation, or potential savings. This does not recommend that the client elect S-corp status.",
    estimatedImpact: null,
    impactType: "",
    documentsNeeded: ["Current-year net business income detail", "Estimate of reasonable owner compensation, if available"],
    suggestedClientAction: "Discuss with your preparer whether your current business structure is still the right fit as your business income grows.",
    sourceInputs: ["reserve.netBusinessIncome"],
    assumptions: [
      "This does not recommend an S-corporation election.",
      "No savings amount is calculated or implied.",
      `The ${money(ENTITY_STRUCTURE_REVIEW_THRESHOLD)} figure is an internal review trigger, not a tax-law eligibility threshold.`
    ],
    confidence: CONFIDENCE.REVIEW_REQUIRED,
    requiresProfessionalReview: true,
    calculationDetails: {
      netBusinessIncome,
      threshold: ENTITY_STRUCTURE_REVIEW_THRESHOLD
    }
  });
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function sortOpportunities(opportunities) {
  return [...opportunities].sort((a, b) => {
    const rankDiff = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
    if (rankDiff !== 0) return rankDiff;
    return String(a.strategyKey).localeCompare(String(b.strategyKey));
  });
}

// =============================================================================
// buildPinnaclePlanningOpportunities(context)
//
// context: {
//   taxYear,
//   reserve: the object returned by server.js computePinnacleTaxReserve(),
//   grossBusinessIncome, businessExpenses, businessMileageTotal,
//   incompleteMileageRecordCount, savingsDeposited
// }
//
// Returns { generatedAt, taxYear, opportunities: [...] }. Every strategy is
// independent and evaluated deterministically -- the same context always
// produces the same result.
// =============================================================================

function buildPinnaclePlanningOpportunities(context = {}) {
  const builders = [
    buildShortfallOpportunity,
    buildLowExpenseRatioOpportunity,
    buildMileageOpportunity,
    buildQuarterlyPaymentReviewOpportunity,
    buildFundingGapOpportunity,
    buildQbiOpportunity,
    buildRetirementOpportunity,
    buildEntityStructureOpportunity
  ];

  const opportunities = builders
    .map((build) => build(context))
    .filter(Boolean);

  return {
    generatedAt: context.now || new Date().toISOString(),
    taxYear: context.taxYear || null,
    opportunities: sortOpportunities(opportunities)
  };
}

module.exports = {
  buildPinnaclePlanningOpportunities,
  // Exported for tests and for documenting the review-trigger thresholds --
  // none of these are tax-law eligibility rules.
  SHORTFALL_MATERIALITY_THRESHOLD,
  SHORTFALL_HIGH_PRIORITY_THRESHOLD,
  MIN_INCOME_FOR_EXPENSE_REVIEW,
  LOW_EXPENSE_RATIO_THRESHOLD,
  MIN_MILEAGE_FOR_REVIEW_TRIGGER,
  FUNDING_GAP_MATERIALITY_THRESHOLD,
  FUNDING_GAP_HIGH_PRIORITY_THRESHOLD,
  RETIREMENT_REVIEW_MIN_NET_INCOME,
  ENTITY_STRUCTURE_REVIEW_THRESHOLD
};
