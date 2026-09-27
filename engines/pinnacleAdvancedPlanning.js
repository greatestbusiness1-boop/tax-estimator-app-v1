"use strict";
// =============================================================================
// PINNACLE ADVANCED PLANNING V1 -- QBI (Section 199A) preliminary calculation
// and self-employed retirement (SEP-IRA / Solo 401(k)) contribution planning.
//
// PREPARER DECISION SUPPORT ONLY. Nothing here becomes approved client advice
// on its own -- see server.js's Pinnacle Planning Opportunities integration,
// which requires a deliberate preparer action to copy any of this into a
// draft Action Plan recommendation.
//
// Every dollar figure below is either (a) taken from the authoritative
// Pinnacle tax reserve calculation (server.js computePinnacleTaxReserve(),
// itself built on taxEstimator.js/federalEngine.js), or (b) a statutory
// dollar limit verified directly against a primary IRS source for the
// specific tax year, cited inline. Years without a verified rules entry
// below return a clear "calculation_unavailable" status rather than a
// guessed number.
// =============================================================================

// ---------------------------------------------------------------------------
// 2026 QBI (Section 199A) rules -- verified directly against IRS Rev. Proc.
// 2025-32 (irs.gov/pub/irs-drop/rp-25-32.pdf), Section 4.26 "Qualified
// Business Income" (read 2026-09-27):
//   - 20% deduction rate: statutory, § 199A(a) (unchanged by Rev. Proc.
//     2025-32 or the OBBBA).
//   - threshold (§ 199A(e)(2)) / phase-in ceiling (§ 199A(b)(3)(B) and
//     § 199A(d)(3)(A)) for 2026: All Other Returns (single/HOH/QSS)
//     $201,750 / $276,750; MFS $201,775 / $276,775; MFJ $403,500 / $553,500.
//     Below the threshold, neither the W-2-wage/UBIA limitation nor the
//     SSTB exclusion applies (full 20% deduction regardless of SSTB status
//     or W-2 wages). At/above the phase-in ceiling, the W-2/UBIA limitation
//     fully applies (or the deduction is fully eliminated for an SSTB).
//     Within the phase-in range, both are partially phased in.
//   - § 199A(i) minimum deduction (added by OBBBA § 70105, effective tax
//     years beginning after 12/31/2025): $400 when the taxpayer has at
//     least $1,000 of QBI from an active qualified trade or business. Per
//     Rev. Proc. 2025-32 § 4.12, these two amounts ($400/$1,000) are not
//     inflation-adjusted until tax years after 2026, so the 2026 figures
//     are the exact statutory amounts.
// ---------------------------------------------------------------------------

const QBI_RULES = {
  2026: {
    rate: 0.20,
    threshold: { single: 201750, hoh: 201750, qw: 201750, mfs: 201775, mfj: 403500 },
    phaseInCeiling: { single: 276750, hoh: 276750, qw: 276750, mfs: 276775, mfj: 553500 },
    minimumDeductionQbiFloor: 1000,
    minimumDeduction: 400
  }
};

// ---------------------------------------------------------------------------
// 2026 self-employed retirement plan rules -- verified directly against IRS
// Notice 2025-67 (irs.gov/pub/irs-drop/n-25-67.pdf), "2026 Amounts Relating
// to Retirement Plans and IRAs" (read 2026-09-27):
//   - annualAdditionsLimit ($72,000): § 415(c)(1)(A) defined-contribution
//     limit, up from $70,000 for 2025. Applies to the combined
//     employee-deferral + employer-contribution total for a Solo 401(k),
//     and to the SEP-IRA contribution -- but NOT to catch-up contributions
//     (catch-up is excluded from the § 415(c) limit by § 414(v)(3)(A), a
//     stable, long-standing rule unaffected by this notice).
//   - electiveDeferralLimit ($24,500): § 402(g)(1), up from $23,500.
//   - catchUp50 ($8,000): § 414(v)(2)(B)(i), ages 50-59 and 64+, up from
//     $7,500.
//   - catchUp60to63 ($11,250): § 414(v)(2)(E)(i), ages 60-63 specifically
//     (SECURE 2.0) -- replaces, does not stack with, catchUp50. Unchanged
//     from 2025 per the notice ("remains $11,250").
//   - compensationLimit ($360,000): §§ 401(a)(17)/408(k)(3)(C), up from
//     $350,000.
//   - sepEmployerRateOfCompensation (25%): § 404(h)(1)(C)/§ 415(c)(3)
//     statutory contribution-rate cap for SEP/profit-sharing plans. This is
//     a stable percentage set by statute, not an annually-indexed dollar
//     figure -- confirmed unaffected by the OBBBA (Rev. Proc. 2025-32's
//     OBBBA change list at Section 2 does not touch §§ 401/402/404/408/
//     414/415).
// ---------------------------------------------------------------------------

const RETIREMENT_RULES = {
  2026: {
    annualAdditionsLimit: 72000,
    electiveDeferralLimit: 24500,
    catchUp50: 8000,
    catchUp60to63: 11250,
    compensationLimit: 360000,
    sepEmployerRateOfCompensation: 0.25
  }
};

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// The statutory self-employed contribution rate (25% "of compensation") is
// circular for a self-employed person, because "compensation" for this
// purpose is itself net of the plan contribution (IRC § 401(c)(2)). The
// standard, well-established simplification (see IRS Publication 560's
// self-employed contribution rate table) converts a stated employer rate R
// into an effective rate of R / (1 + R) applied to net earnings BEFORE the
// contribution -- for the statutory 25% rate, that is exactly 25/125 = 20%.
// This is a stable mathematical/statutory mechanic, not an annually-indexed
// figure, so it needs no separate per-year verification.
function selfEmployedEffectiveRate(statutoryRate) {
  return statutoryRate / (1 + statutoryRate);
}

// =============================================================================
// QBI (SECTION 199A) PRELIMINARY CALCULATION
// =============================================================================

function computeQbiPreliminary(context = {}) {
  const taxYear = context.taxYear;
  const rules = QBI_RULES[taxYear];

  const base = {
    taxYear,
    estimatedQualifiedBusinessIncome: null,
    tentativeQbiDeduction: null,
    taxableIncomeBeforeQbi: null,
    taxableIncomeLimitation: null,
    estimatedQbiDeduction: null,
    calculationDetails: {}
  };

  if (context.reserveStatus === "no_business_income") {
    return {
      ...base,
      status: "no_business_income",
      requiresProfessionalReview: false,
      reviewReasons: [],
      assumptions: [
        "No Pinnacle business income has been recorded yet, so no QBI estimate is available."
      ]
    };
  }

  if (context.reserveStatus !== "complete") {
    return {
      ...base,
      status: "incomplete_data",
      requiresProfessionalReview: true,
      reviewReasons: [
        "The underlying Pinnacle tax reserve calculation is incomplete (missing filing status or otherwise unavailable), so a QBI estimate cannot be calculated yet."
      ],
      assumptions: []
    };
  }

  if (!rules) {
    return {
      ...base,
      status: "calculation_unavailable",
      requiresProfessionalReview: true,
      reviewReasons: [
        `Verified Section 199A (QBI) figures for tax year ${taxYear} are not yet available in this repository.`
      ],
      assumptions: []
    };
  }

  const netBusinessIncome = Math.max(0, numberOrZero(context.netBusinessIncome));
  const deductibleHalfOfSETax = Math.max(0, numberOrZero(context.deductibleHalfOfSETax));
  const taxableIncomeBeforeQbi = Math.max(0, numberOrZero(context.taxableIncomeBeforeQbi));

  // QBI must be reduced by the deductible portion of self-employment tax
  // attributable to the business (§ 199A(c)(4)); self-employed health
  // insurance and retirement-plan-contribution adjustments to QBI are not
  // modeled (Pinnacle does not track SE health insurance, and the
  // retirement contribution itself is what this phase's other calculation
  // helps plan, so folding it in here would be circular) -- disclosed below.
  const estimatedQualifiedBusinessIncome = Math.max(0, Math.round(netBusinessIncome - deductibleHalfOfSETax));

  const assumptions = [
    "This is a preliminary, tentative 20%-style estimate, not a final Form 8995/8995-A calculation.",
    "Qualified business income is estimated as net business income less the deductible half of self-employment tax; self-employed health insurance and retirement-contribution adjustments to QBI are not reflected.",
    "The overall taxable-income limitation below assumes net capital gain is $0 (Pinnacle does not track investment income)."
  ];

  if (estimatedQualifiedBusinessIncome <= 0) {
    return {
      ...base,
      estimatedQualifiedBusinessIncome,
      taxableIncomeBeforeQbi: Math.round(taxableIncomeBeforeQbi),
      status: "no_positive_qbi",
      requiresProfessionalReview: false,
      reviewReasons: [],
      assumptions: [
        "Estimated qualified business income is zero or negative after adjustments, so no QBI deduction is estimated."
      ]
    };
  }

  const threshold = rules.threshold[context.filingStatus] ?? rules.threshold.single;
  const phaseInCeiling = rules.phaseInCeiling[context.filingStatus] ?? rules.phaseInCeiling.single;

  const reviewReasons = [];
  let requiresProfessionalReview = false;

  if (taxableIncomeBeforeQbi >= phaseInCeiling) {
    requiresProfessionalReview = true;
    reviewReasons.push(
      "Taxable income is at or above the full phase-in point, where the deduction depends on W-2 wages paid by the business and the unadjusted basis of qualified property (UBIA), and may be eliminated entirely if the business is a specified service trade or business (SSTB) -- none of which are currently tracked."
    );
  } else if (taxableIncomeBeforeQbi >= threshold) {
    requiresProfessionalReview = true;
    reviewReasons.push(
      "Taxable income is within the wage/UBIA phase-in range, where the deduction is partially limited based on W-2 wages, UBIA, and (for an SSTB) a phase-out -- none of which are currently tracked."
    );
  }

  let tentativeQbiDeduction = Math.round(estimatedQualifiedBusinessIncome * rules.rate);
  if (estimatedQualifiedBusinessIncome >= rules.minimumDeductionQbiFloor) {
    if (tentativeQbiDeduction < rules.minimumDeduction) {
      assumptions.push(
        `Section 199A(i)'s new $${rules.minimumDeduction} minimum deduction (available when QBI is at least $${rules.minimumDeductionQbiFloor.toLocaleString("en-US")}) has been applied conservatively before the taxable-income limitation below; its precise interaction with that limitation has not been independently verified beyond the statutory text.`
      );
    }
    tentativeQbiDeduction = Math.max(tentativeQbiDeduction, rules.minimumDeduction);
  }

  const taxableIncomeLimitation = Math.round(taxableIncomeBeforeQbi * rules.rate);
  const estimatedQbiDeduction = requiresProfessionalReview
    ? null
    : Math.min(tentativeQbiDeduction, taxableIncomeLimitation);

  if (requiresProfessionalReview) {
    assumptions.push(
      "No final estimated deduction amount is presented because the facts needed (W-2 wages, UBIA, SSTB status) are not available -- only the tentative, unlimited 20% figure is shown for reference."
    );
  }

  return {
    taxYear,
    status: requiresProfessionalReview ? "review_required" : "preliminary_below_threshold",
    estimatedQualifiedBusinessIncome,
    tentativeQbiDeduction,
    taxableIncomeBeforeQbi: Math.round(taxableIncomeBeforeQbi),
    taxableIncomeLimitation,
    estimatedQbiDeduction,
    requiresProfessionalReview,
    reviewReasons,
    assumptions,
    calculationDetails: {
      netBusinessIncome: Math.round(netBusinessIncome),
      deductibleHalfOfSETax: Math.round(deductibleHalfOfSETax),
      filingStatus: context.filingStatus,
      threshold,
      phaseInCeiling,
      rate: rules.rate
    }
  };
}

// =============================================================================
// SELF-EMPLOYED RETIREMENT PLANNING (SEP-IRA / SOLO 401(K))
// =============================================================================

function computeRetirementPlanning(context = {}) {
  const taxYear = context.taxYear;
  const rules = RETIREMENT_RULES[taxYear];

  const emptyPlan = () => ({
    estimatedMaximumContribution: null,
    assumptions: [],
    requiresProfessionalReview: true
  });

  if (context.reserveStatus === "no_business_income") {
    return {
      taxYear,
      status: "no_business_income",
      selfEmploymentCompensation: 0,
      sepIra: { estimatedMaximumContribution: 0, assumptions: [], requiresProfessionalReview: false },
      solo401k: {
        employeeDeferralComponent: 0,
        employerContributionComponent: 0,
        catchUpComponent: 0,
        estimatedMaximumContribution: 0,
        assumptions: [],
        requiresProfessionalReview: false
      },
      comparisonNotes: [],
      reviewReasons: [
        "No Pinnacle business income has been recorded yet, so no retirement contribution estimate is available."
      ]
    };
  }

  if (context.reserveStatus !== "complete") {
    return {
      taxYear,
      status: "incomplete_data",
      selfEmploymentCompensation: null,
      sepIra: emptyPlan(),
      solo401k: { employeeDeferralComponent: null, employerContributionComponent: null, catchUpComponent: null, ...emptyPlan() },
      comparisonNotes: [],
      reviewReasons: [
        "The underlying Pinnacle tax reserve calculation is incomplete (missing filing status or otherwise unavailable), so a retirement contribution estimate cannot be calculated yet."
      ]
    };
  }

  if (!rules) {
    return {
      taxYear,
      status: "calculation_unavailable",
      selfEmploymentCompensation: null,
      sepIra: emptyPlan(),
      solo401k: { employeeDeferralComponent: null, employerContributionComponent: null, catchUpComponent: null, ...emptyPlan() },
      comparisonNotes: [],
      reviewReasons: [
        `Verified self-employed retirement plan limits for tax year ${taxYear} are not yet available in this repository.`
      ]
    };
  }

  const netBusinessIncome = Math.max(0, numberOrZero(context.netBusinessIncome));
  const deductibleHalfOfSETax = Math.max(0, numberOrZero(context.deductibleHalfOfSETax));

  // IRC § 401(c)(2) "earned income" for retirement-plan purposes: net
  // self-employment earnings less the deductible half of self-employment
  // tax. This is the same base as the QBI adjustment above, because both
  // derive from the same statutory "net earnings from self-employment"
  // concept.
  const netEarningsForRetirement = Math.max(0, netBusinessIncome - deductibleHalfOfSETax);
  const cappedCompensation = Math.min(netEarningsForRetirement, rules.compensationLimit);

  if (netEarningsForRetirement <= 0) {
    return {
      taxYear,
      status: "no_positive_earnings",
      selfEmploymentCompensation: 0,
      sepIra: { estimatedMaximumContribution: 0, assumptions: [], requiresProfessionalReview: false },
      solo401k: {
        employeeDeferralComponent: 0,
        employerContributionComponent: 0,
        catchUpComponent: 0,
        estimatedMaximumContribution: 0,
        assumptions: [],
        requiresProfessionalReview: false
      },
      comparisonNotes: [],
      reviewReasons: [
        "Net self-employment earnings (after the deductible half of SE tax) are zero or negative, so no retirement contribution is estimated."
      ]
    };
  }

  const comparisonNotes = [
    "A higher estimated maximum contribution is not automatically the better strategy -- cash-flow needs, administrative cost, and whether the business may add employees in the future should all factor into the choice between a SEP-IRA and a Solo 401(k).",
    "A SEP-IRA has simpler ongoing administration; a Solo 401(k) can allow a larger contribution at lower net-earnings levels because of its separate employee-deferral component, and may allow Roth deferrals where the plan permits."
  ];
  const reviewReasons = [];

  // --- SEP-IRA ---------------------------------------------------------
  const sepEffectiveRate = selfEmployedEffectiveRate(rules.sepEmployerRateOfCompensation);
  const sepContribution = Math.round(cappedCompensation * sepEffectiveRate);
  const sepEstimatedMaximumContribution = Math.min(sepContribution, rules.annualAdditionsLimit);
  const sepAssumptions = [
    `Uses the statutory self-employed contribution rate (${(rules.sepEmployerRateOfCompensation * 100).toFixed(0)}% of compensation, applied at an effective ${(sepEffectiveRate * 100).toFixed(0)}% of net earnings for a self-employed individual) capped at the $${rules.annualAdditionsLimit.toLocaleString("en-US")} annual limit.`,
    "SEP-IRAs do not permit catch-up contributions for individuals age 50 or older."
  ];
  if (cappedCompensation < netEarningsForRetirement) {
    sepAssumptions.push(
      `Net earnings were capped at the $${rules.compensationLimit.toLocaleString("en-US")} annual compensation limit before applying the contribution rate.`
    );
  }

  // --- Solo 401(k) -------------------------------------------------------
  const age = context.age === null || context.age === undefined ? null : Math.max(0, Math.trunc(numberOrZero(context.age)));
  const outsideElectiveDeferrals = Math.max(0, numberOrZero(context.outsideElectiveDeferralsThisYear));

  const solo401kAssumptions = [];
  let catchUpComponent = 0;
  let catchUpLimit = 0;

  if (age === null) {
    solo401kAssumptions.push(
      "Age has not been entered in the Pinnacle Business Profile, so no age-based catch-up contribution is included in this estimate."
    );
  } else if (age >= 60 && age <= 63) {
    catchUpLimit = rules.catchUp60to63;
  } else if (age >= 50) {
    catchUpLimit = rules.catchUp50;
  }

  const baseDeferralRoom = Math.max(0, rules.electiveDeferralLimit - outsideElectiveDeferrals);
  const employeeDeferralComponent = Math.round(Math.min(baseDeferralRoom, cappedCompensation));

  if (outsideElectiveDeferrals > 0) {
    solo401kAssumptions.push(
      `The $${rules.electiveDeferralLimit.toLocaleString("en-US")} employee-deferral limit under IRC section 402(g) applies across all plans an individual participates in during the year, so the $${outsideElectiveDeferrals.toLocaleString("en-US")} of elective deferrals already made to an outside employer plan reduce the deferral room available here.`
    );
  }

  const remainingCompAfterDeferral = Math.max(0, cappedCompensation - employeeDeferralComponent);
  catchUpComponent = Math.round(Math.min(catchUpLimit, remainingCompAfterDeferral));
  if (catchUpLimit > 0) {
    solo401kAssumptions.push(
      age >= 60 && age <= 63
        ? `Ages 60-63 catch-up limit of $${rules.catchUp60to63.toLocaleString("en-US")} applied (this replaces, rather than adds to, the standard age-50 catch-up).`
        : `Standard age-50-and-over catch-up limit of $${rules.catchUp50.toLocaleString("en-US")} applied.`
    );
  }

  const solo401kEmployerEffectiveRate = selfEmployedEffectiveRate(rules.sepEmployerRateOfCompensation);
  const employerContributionComponent = Math.round(cappedCompensation * solo401kEmployerEffectiveRate);
  solo401kAssumptions.push(
    `The employer (profit-sharing) component uses the same statutory self-employed contribution rate as the SEP-IRA (effective ${(solo401kEmployerEffectiveRate * 100).toFixed(0)}% of net earnings).`
  );

  const solo401kBeforeCatchUp = Math.min(
    employeeDeferralComponent + employerContributionComponent,
    rules.annualAdditionsLimit
  );
  // Catch-up contributions are excluded from the section 415(c) annual
  // additions limit (IRC section 414(v)(3)(A)) and are added on top of it.
  const solo401kEstimatedMaximumContribution = solo401kBeforeCatchUp + catchUpComponent;

  if (cappedCompensation < netEarningsForRetirement) {
    solo401kAssumptions.push(
      `Net earnings were capped at the $${rules.compensationLimit.toLocaleString("en-US")} annual compensation limit before calculating the employee and employer components.`
    );
  }

  return {
    taxYear,
    status: "complete",
    selfEmploymentCompensation: Math.round(cappedCompensation),
    sepIra: {
      estimatedMaximumContribution: sepEstimatedMaximumContribution,
      assumptions: sepAssumptions,
      requiresProfessionalReview: false
    },
    solo401k: {
      employeeDeferralComponent,
      employerContributionComponent,
      catchUpComponent,
      estimatedMaximumContribution: solo401kEstimatedMaximumContribution,
      assumptions: solo401kAssumptions,
      requiresProfessionalReview: false
    },
    comparisonNotes,
    reviewReasons
  };
}

module.exports = {
  computeQbiPreliminary,
  computeRetirementPlanning,
  QBI_RULES,
  RETIREMENT_RULES
};
