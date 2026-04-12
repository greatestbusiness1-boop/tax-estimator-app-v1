"use strict";

// =============================================================================
// CONFIG — TAX RULES BY YEAR
// =============================================================================

const TAX_RULES = {

  2024: {
    standardDeduction: {
      single: 14600,
      mfj:    29200,
      mfs:    14600,
      hoh:    21900,
      qw:     29200,
    },
    dependentDeduction: {
      floor:       1300,
      earnedBonus: 450,
    },
    seniorAdditional: {
      single: 1950,
      mfj:    1550,
      mfs:    1550,
      hoh:    1950,
      qw:     1550,
    },
    mileageRatePerMile: 0.67,
    selfEmploymentTaxRate: 0.1530,
    selfEmploymentTaxDeductionRate: 0.50,
    brackets: {
      single: [
        { min: 0,      max: 11600,  rate: 0.10 },
        { min: 11600,  max: 47150,  rate: 0.12 },
        { min: 47150,  max: 100525, rate: 0.22 },
        { min: 100525, max: 191950, rate: 0.24 },
        { min: 191950, max: 243725, rate: 0.32 },
        { min: 243725, max: 609350, rate: 0.35 },
        { min: 609350, max: null,   rate: 0.37 },
      ],
      mfj: [
        { min: 0,      max: 23200,  rate: 0.10 },
        { min: 23200,  max: 94300,  rate: 0.12 },
        { min: 94300,  max: 201050, rate: 0.22 },
        { min: 201050, max: 383900, rate: 0.24 },
        { min: 383900, max: 487450, rate: 0.32 },
        { min: 487450, max: 731200, rate: 0.35 },
        { min: 731200, max: null,   rate: 0.37 },
      ],
      mfs: [
        { min: 0,      max: 11600,  rate: 0.10 },
        { min: 11600,  max: 47150,  rate: 0.12 },
        { min: 47150,  max: 100525, rate: 0.22 },
        { min: 100525, max: 191950, rate: 0.24 },
        { min: 191950, max: 243725, rate: 0.32 },
        { min: 243725, max: 365600, rate: 0.35 },
        { min: 365600, max: null,   rate: 0.37 },
      ],
      hoh: [
        { min: 0,      max: 16550,  rate: 0.10 },
        { min: 16550,  max: 63100,  rate: 0.12 },
        { min: 63100,  max: 100500, rate: 0.22 },
        { min: 100500, max: 191950, rate: 0.24 },
        { min: 191950, max: 243700, rate: 0.32 },
        { min: 243700, max: 609350, rate: 0.35 },
        { min: 609350, max: null,   rate: 0.37 },
      ],
      qw: [
        { min: 0,      max: 23200,  rate: 0.10 },
        { min: 23200,  max: 94300,  rate: 0.12 },
        { min: 94300,  max: 201050, rate: 0.22 },
        { min: 201050, max: 383900, rate: 0.24 },
        { min: 383900, max: 487450, rate: 0.32 },
        { min: 487450, max: 731200, rate: 0.35 },
        { min: 731200, max: null,   rate: 0.37 },
      ],
    },
    americanOpportunityCredit: {
      maxCredit:      2500,
      refundableRate: 0.40,
      tier1Cap:       2000,
      tier2Cap:       2000,
      tier2Rate:      0.25,
      phaseOutStart:  { single: 80000,  mfj: 160000 },
      phaseOutEnd:    { single: 90000,  mfj: 180000 },
    },
    lifetimeLearningCredit: {
      rate:          0.20,
      maxExpenses:   10000,
      maxCredit:     2000,
      phaseOutStart: { single: 80000,  mfj: 160000 },
      phaseOutEnd:   { single: 90000,  mfj: 180000 },
    },
    childTaxCredit: {
      perChild:          2000,
      refundablePortion: 1700,
      phaseOutThreshold: {
        single: 200000,
        mfj:    400000,
        mfs:    200000,
        hoh:    200000,
        qw:     400000,
      },
      phaseOutPer1000: 50,
    },
  },

  2023: {
    standardDeduction: {
      single: 13850,
      mfj:    27700,
      mfs:    13850,
      hoh:    20800,
      qw:     27700,
    },
    dependentDeduction: { floor: 1250, earnedBonus: 400 },
    seniorAdditional:   { single: 1850, mfj: 1500, mfs: 1500, hoh: 1850, qw: 1500 },
    mileageRatePerMile: 0.655,
    selfEmploymentTaxRate: 0.1530,
    selfEmploymentTaxDeductionRate: 0.50,
    brackets: {
      single: [
        { min: 0,      max: 11000,  rate: 0.10 },
        { min: 11000,  max: 44725,  rate: 0.12 },
        { min: 44725,  max: 95375,  rate: 0.22 },
        { min: 95375,  max: 182050, rate: 0.24 },
        { min: 182050, max: 231250, rate: 0.32 },
        { min: 231250, max: 578125, rate: 0.35 },
        { min: 578125, max: null,   rate: 0.37 },
      ],
      mfj: [
        { min: 0,      max: 22000,  rate: 0.10 },
        { min: 22000,  max: 89450,  rate: 0.12 },
        { min: 89450,  max: 190750, rate: 0.22 },
        { min: 190750, max: 364200, rate: 0.24 },
        { min: 364200, max: 462500, rate: 0.32 },
        { min: 462500, max: 693750, rate: 0.35 },
        { min: 693750, max: null,   rate: 0.37 },
      ],
      mfs: [
        { min: 0,      max: 11000,  rate: 0.10 },
        { min: 11000,  max: 44725,  rate: 0.12 },
        { min: 44725,  max: 95375,  rate: 0.22 },
        { min: 95375,  max: 182050, rate: 0.24 },
        { min: 182050, max: 231250, rate: 0.32 },
        { min: 231250, max: 346875, rate: 0.35 },
        { min: 346875, max: null,   rate: 0.37 },
      ],
      hoh: [
        { min: 0,      max: 15700,  rate: 0.10 },
        { min: 15700,  max: 59850,  rate: 0.12 },
        { min: 59850,  max: 95350,  rate: 0.22 },
        { min: 95350,  max: 182050, rate: 0.24 },
        { min: 182050, max: 231250, rate: 0.32 },
        { min: 231250, max: 578100, rate: 0.35 },
        { min: 578100, max: null,   rate: 0.37 },
      ],
      qw: [
        { min: 0,      max: 22000,  rate: 0.10 },
        { min: 22000,  max: 89450,  rate: 0.12 },
        { min: 89450,  max: 190750, rate: 0.22 },
        { min: 190750, max: 364200, rate: 0.24 },
        { min: 364200, max: 462500, rate: 0.32 },
        { min: 462500, max: 693750, rate: 0.35 },
        { min: 693750, max: null,   rate: 0.37 },
      ],
    },
    americanOpportunityCredit: {
      maxCredit: 2500,
      refundableRate: 0.40,
      tier1Cap: 2000,
      tier2Cap: 2000,
      tier2Rate: 0.25,
      phaseOutStart: { single: 80000, mfj: 160000 },
      phaseOutEnd:   { single: 90000, mfj: 180000 },
    },
    lifetimeLearningCredit: {
      rate: 0.20,
      maxExpenses: 10000,
      maxCredit: 2000,
      phaseOutStart: { single: 80000, mfj: 160000 },
      phaseOutEnd:   { single: 90000, mfj: 180000 },
    },
    childTaxCredit: {
      perChild: 2000,
      refundablePortion: 1600,
      phaseOutThreshold: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000, qw: 400000 },
      phaseOutPer1000: 50,
    },
  },

  2022: {
    standardDeduction: {
      single: 12950,
      mfj:    25900,
      mfs:    12950,
      hoh:    19400,
      qw:     25900,
    },
    dependentDeduction: { floor: 1150, earnedBonus: 400 },
    seniorAdditional:   { single: 1750, mfj: 1400, mfs: 1400, hoh: 1750, qw: 1400 },
    mileageRatePerMile: 0.585,
    selfEmploymentTaxRate: 0.1530,
    selfEmploymentTaxDeductionRate: 0.50,
    brackets: {
      single: [
        { min: 0,      max: 10275,  rate: 0.10 },
        { min: 10275,  max: 41775,  rate: 0.12 },
        { min: 41775,  max: 89075,  rate: 0.22 },
        { min: 89075,  max: 170050, rate: 0.24 },
        { min: 170050, max: 215950, rate: 0.32 },
        { min: 215950, max: 539900, rate: 0.35 },
        { min: 539900, max: null,   rate: 0.37 },
      ],
      mfj: [
        { min: 0,      max: 20550,  rate: 0.10 },
        { min: 20550,  max: 83550,  rate: 0.12 },
        { min: 83550,  max: 178150, rate: 0.22 },
        { min: 178150, max: 340100, rate: 0.24 },
        { min: 340100, max: 431900, rate: 0.32 },
        { min: 431900, max: 647850, rate: 0.35 },
        { min: 647850, max: null,   rate: 0.37 },
      ],
      mfs: [
        { min: 0,      max: 10275,  rate: 0.10 },
        { min: 10275,  max: 41775,  rate: 0.12 },
        { min: 41775,  max: 89075,  rate: 0.22 },
        { min: 89075,  max: 170050, rate: 0.24 },
        { min: 170050, max: 215950, rate: 0.32 },
        { min: 215950, max: 323925, rate: 0.35 },
        { min: 323925, max: null,   rate: 0.37 },
      ],
      hoh: [
        { min: 0,      max: 14650,  rate: 0.10 },
        { min: 14650,  max: 55900,  rate: 0.12 },
        { min: 55900,  max: 89050,  rate: 0.22 },
        { min: 89050,  max: 170050, rate: 0.24 },
        { min: 170050, max: 215950, rate: 0.32 },
        { min: 215950, max: 539900, rate: 0.35 },
        { min: 539900, max: null,   rate: 0.37 },
      ],
      qw: [
        { min: 0,      max: 20550,  rate: 0.10 },
        { min: 20550,  max: 83550,  rate: 0.12 },
        { min: 83550,  max: 178150, rate: 0.22 },
        { min: 178150, max: 340100, rate: 0.24 },
        { min: 340100, max: 431900, rate: 0.32 },
        { min: 431900, max: 647850, rate: 0.35 },
        { min: 647850, max: null,   rate: 0.37 },
      ],
    },
    americanOpportunityCredit: {
      maxCredit: 2500,
      refundableRate: 0.40,
      tier1Cap: 2000,
      tier2Cap: 2000,
      tier2Rate: 0.25,
      phaseOutStart: { single: 80000, mfj: 160000 },
      phaseOutEnd:   { single: 90000, mfj: 180000 },
    },
    lifetimeLearningCredit: {
      rate: 0.20,
      maxExpenses: 10000,
      maxCredit: 2000,
      phaseOutStart: { single: 80000, mfj: 160000 },
      phaseOutEnd:   { single: 90000, mfj: 180000 },
    },
    childTaxCredit: {
      perChild: 2000,
      refundablePortion: 1500,
      phaseOutThreshold: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000, qw: 400000 },
      phaseOutPer1000: 50,
    },
  },

};

// =============================================================================
// CONFIG ACCESSOR
// =============================================================================

function getRules(taxYear) {
  const rules = TAX_RULES[taxYear];
  if (!rules) {
    throw new Error(
      `federalEngine: No rules found for tax year ${taxYear}. ` +
      `Supported years: ${Object.keys(TAX_RULES).join(", ")}.`
    );
  }
  return rules;
}

// =============================================================================
// HELPERS
// =============================================================================

function dollars(n) {
  return Math.round(n || 0);
}

function phaseOutKey(filingStatus) {
  return filingStatus === "mfj" ? "mfj" : "single";
}

// =============================================================================
// STEP 1 — SELF-EMPLOYMENT INCOME
// =============================================================================

function computeSelfEmployment(input, rules) {
  const seIncome    = input.selfEmploymentIncome || 0;
  const businessExp = input.businessExpenses || 0;
  const mileage     = input.businessMileage || 0;

  if (seIncome === 0) {
    return {
      selfEmploymentIncome:    0,
      businessExpenses:        0,
      mileageDeduction:        0,
      netSelfEmploymentIncome: 0,
      selfEmploymentTax:       0,
      seAboveLineDeduction:    0,
      hasSelfEmployment:       false,
    };
  }

  const mileageDeduction     = dollars(mileage * rules.mileageRatePerMile);
  const netSE = seIncome - businessExp - mileageDeduction;
  const seTaxBase            = Math.max(0, netSE);
const selfEmploymentTax    = dollars(seTaxBase * rules.selfEmploymentTaxRate);
const seAboveLineDeduction = dollars(selfEmploymentTax * rules.selfEmploymentTaxDeductionRate);

  return {
    selfEmploymentIncome:    dollars(seIncome),
    businessExpenses:        dollars(businessExp),
    mileageDeduction,
    netSelfEmploymentIncome: dollars(netSE),
    selfEmploymentTax,
    seAboveLineDeduction,
    hasSelfEmployment:       true,
  };
}

// =============================================================================
// STEP 2 — TAXABLE SCHOLARSHIP INCOME
// =============================================================================

function computeTaxableScholarships(input) {
  const scholarships      = input.scholarships || 0;
  const educationExpenses = input.educationExpenses || 0;
  const taxable           = Math.max(0, scholarships - educationExpenses);
  return {
    scholarships,
    educationExpenses,
    taxableScholarshipIncome: dollars(taxable),
    scholarshipFullyExcluded: taxable === 0,
  };
}

// =============================================================================
// STEP 3 — GROSS INCOME
// =============================================================================

function computeGrossIncome(input, taxableScholarshipIncome, netSelfEmploymentIncome) {
  const w2Income    = input.w2Income || 0;
  const otherIncome = input.otherIncome || 0;
  const gross       = w2Income + otherIncome + taxableScholarshipIncome + netSelfEmploymentIncome;
  return {
    w2Income: dollars(w2Income),
    otherIncome: dollars(otherIncome),
    taxableScholarshipIncome: dollars(taxableScholarshipIncome),
    netSelfEmploymentIncome: dollars(netSelfEmploymentIncome),
    grossIncome: dollars(gross),
  };
}

// =============================================================================
// STEP 4 — ADJUSTED GROSS INCOME
// =============================================================================

function computeAGI(grossIncome, seAboveLineDeduction) {
  const agi = grossIncome - seAboveLineDeduction;
  return {
    grossIncome: dollars(grossIncome),
    seAboveLineDeduction: dollars(seAboveLineDeduction),
    agi: dollars(agi),
  };
}

// =============================================================================
// STEP 5 — STANDARD DEDUCTION
// =============================================================================

function computeStandardDeduction(input, rules) {
  const { filingStatus, age, canBeClaimedAsDependent, w2Income } = input;
  const base     = rules.standardDeduction[filingStatus] || rules.standardDeduction.single;
  const depRules = rules.dependentDeduction;
  const senior   = rules.seniorAdditional;

  let deduction      = base;
  let isDependentAdj = false;
  let isSeniorAdj    = false;

  if (canBeClaimedAsDependent) {
    const earnedIncome = w2Income || 0;
    const computed     = Math.max(depRules.floor, earnedIncome + depRules.earnedBonus);
    deduction          = Math.min(computed, base);
    isDependentAdj     = true;
  }

  if (age >= 65) {
    const additionalAmt = senior[filingStatus] || senior.single;
    deduction += additionalAmt;
    isSeniorAdj = true;
  }

  return {
    standardDeduction: dollars(deduction),
    isDependentAdjusted: isDependentAdj,
    isSeniorAdjusted: isSeniorAdj,
  };
}

// =============================================================================
// STEP 6 — TAXABLE INCOME
// =============================================================================

function computeTaxableIncome(agi, standardDeduction) {
  return dollars(Math.max(0, agi - standardDeduction));
}

// =============================================================================
// STEP 7 — PROGRESSIVE BRACKET TAX
// =============================================================================

function computeBracketTax(taxableIncome, filingStatus, rules) {
  const brackets   = rules.brackets[filingStatus] || rules.brackets.single;
  let tax          = 0;
  let marginalRate = 0;
  const bracketDetail = [];

  for (const bracket of brackets) {
    if (taxableIncome <= bracket.min) break;
    const ceiling   = bracket.max !== null ? bracket.max : Infinity;
    const inBracket = Math.min(taxableIncome, ceiling) - bracket.min;
    const taxInBand = inBracket * bracket.rate;
    tax += taxInBand;
    marginalRate = bracket.rate;
    bracketDetail.push({
      rate: bracket.rate,
      min: bracket.min,
      max: bracket.max,
      taxableInBracket: dollars(inBracket),
      taxInBracket: dollars(taxInBand),
    });
  }

  return {
    bracketTax: dollars(tax),
    marginalRate,
    effectiveRate: taxableIncome > 0
      ? Math.round((tax / taxableIncome) * 10000) / 10000
      : 0,
    bracketDetail,
  };
}

// =============================================================================
// STEP 8 — EDUCATION CREDIT
// =============================================================================

function computeEducationCredit(input, agi, rules) {
  const expenses = input.educationExpenses || 0;

  if (expenses === 0) {
    return {
      educationCredit: 0,
      educationCreditRefundable: 0,
      educationCreditNonRefundable: 0,
      educationCreditType: "none",
    };
  }

  const poKey = phaseOutKey(input.filingStatus);

  if (input.isFullTimeStudent) {
    const aoc     = rules.americanOpportunityCredit;
    const poStart = aoc.phaseOutStart[poKey];
    const poEnd   = aoc.phaseOutEnd[poKey];
    const tier1   = Math.min(expenses, aoc.tier1Cap);
    const tier2   = Math.min(Math.max(0, expenses - aoc.tier1Cap), aoc.tier2Cap) * aoc.tier2Rate;
    let credit    = Math.min(tier1 + tier2, aoc.maxCredit);
    if (agi >= poEnd) {
      credit = 0;
    } else if (agi > poStart) {
      credit = credit * (1 - (agi - poStart) / (poEnd - poStart));
    }
    const refundable    = dollars(credit * aoc.refundableRate);
    const nonRefundable = dollars(credit) - refundable;
    return {
      educationCredit: dollars(credit),
      educationCreditRefundable: refundable,
      educationCreditNonRefundable: nonRefundable,
      educationCreditType: "American Opportunity Credit",
    };
  }

  const llc     = rules.lifetimeLearningCredit;
  const poStart = llc.phaseOutStart[poKey];
  const poEnd   = llc.phaseOutEnd[poKey];
  let credit    = Math.min(expenses, llc.maxExpenses) * llc.rate;
  credit        = Math.min(credit, llc.maxCredit);
  if (agi >= poEnd) {
    credit = 0;
  } else if (agi > poStart) {
    credit = credit * (1 - (agi - poStart) / (poEnd - poStart));
  }
  return {
    educationCredit: dollars(credit),
    educationCreditRefundable: 0,
    educationCreditNonRefundable: dollars(credit),
    educationCreditType: "Lifetime Learning Credit",
  };
}

// =============================================================================
// STEP 9 — CHILD TAX CREDIT
// =============================================================================

function computeChildTaxCredit(input, agi, rules) {
  const deps = input.numberOfDependents || 0;
  if (deps === 0 || input.canBeClaimedAsDependent) {
    return { childTaxCredit: 0, childTaxCreditRefundable: 0 };
  }
  const ctc       = rules.childTaxCredit;
  const threshold = ctc.phaseOutThreshold[input.filingStatus] || ctc.phaseOutThreshold.single;
  let credit = deps * ctc.perChild;
  if (agi > threshold) {
    const reduction = Math.ceil((agi - threshold) / 1000) * ctc.phaseOutPer1000;
    credit          = Math.max(0, credit - reduction);
  }
  const refundable = Math.min(credit, deps * ctc.refundablePortion);
  return {
    childTaxCredit: dollars(credit),
    childTaxCreditRefundable: dollars(refundable),
  };
}

// =============================================================================
// STEP 10 — FINAL FEDERAL RESULT
// =============================================================================

function computeFederalResult(
  bracketTax,
  selfEmploymentTax,
  educationResult,
  ctcResult,
  federalWithheld,
  estimatedTaxPayments
) {
  const childNonRefundable = Math.max(
    0,
    (ctcResult.childTaxCredit || 0) - (ctcResult.childTaxCreditRefundable || 0)
  );

  const nonRefundableCredits =
    (educationResult.educationCreditNonRefundable || 0) + childNonRefundable;

  const refundableCredits =
    (educationResult.educationCreditRefundable || 0) +
    (ctcResult.childTaxCreditRefundable || 0);

  const taxAfterNonRefundable = Math.max(0, bracketTax - nonRefundableCredits);
  const totalLiability = Math.max(0, taxAfterNonRefundable + selfEmploymentTax);
  const extraRefund = Math.max(0, refundableCredits - totalLiability);
  const netLiability = Math.max(0, totalLiability - refundableCredits);
  const taxAfterCredits = dollars(netLiability);

  const totalPayments = dollars((federalWithheld || 0) + (estimatedTaxPayments || 0) + extraRefund);
  const net = dollars(totalPayments - netLiability);

  return {
    totalCredits: dollars(nonRefundableCredits + refundableCredits),
    educationCredit: dollars(educationResult.educationCredit || 0),
    childTaxCredit: dollars(ctcResult.childTaxCredit || 0),
    taxAfterCredits,
    federalWithheld: dollars(federalWithheld),
    estimatedTaxPayments: dollars(estimatedTaxPayments),
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    isBreakEven: net === 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// ORCHESTRATOR — calculateFederal()
// =============================================================================

function calculateFederal(input) {
  if (!input || typeof input !== "object") {
    throw new Error("federalEngine.calculateFederal: input must be a non-null object.");
  }

  const {
    taxYear,
    filingStatus,
    federalWithheld = 0,
    estimatedTaxPayments = 0,
  } = input;

  const rules = getRules(taxYear);

  const seResult          = computeSelfEmployment(input, rules);
  const scholarshipResult = computeTaxableScholarships(input);
  const incomeResult      = computeGrossIncome(
    input,
    scholarshipResult.taxableScholarshipIncome,
    seResult.netSelfEmploymentIncome
  );
  const agiResult         = computeAGI(incomeResult.grossIncome, seResult.seAboveLineDeduction);
  const deductionResult   = computeStandardDeduction(input, rules);
  const taxableIncome     = computeTaxableIncome(agiResult.agi, deductionResult.standardDeduction);
  const bracketResult     = computeBracketTax(taxableIncome, filingStatus, rules);
  const educationResult   = computeEducationCredit(input, agiResult.agi, rules);
  const ctcResult         = computeChildTaxCredit(input, agiResult.agi, rules);
  const finalResult       = computeFederalResult(
    bracketResult.bracketTax,
    seResult.selfEmploymentTax,
    educationResult,
    ctcResult,
    federalWithheld,
    estimatedTaxPayments
  );

  return {
    summary: {
      grossIncome: incomeResult.grossIncome,
      agi: agiResult.agi,
      selfEmploymentIncome: seResult.selfEmploymentIncome,
      businessExpenses: seResult.businessExpenses,
      mileageDeduction: seResult.mileageDeduction,
      netSelfEmploymentIncome: seResult.netSelfEmploymentIncome,
      selfEmploymentTax: seResult.selfEmploymentTax,
      seAboveLineDeduction: seResult.seAboveLineDeduction,
      hasSelfEmployment: seResult.hasSelfEmployment,
      standardDeduction: deductionResult.standardDeduction,
      taxableIncome,
      taxBeforeCredits: bracketResult.bracketTax,
      marginalRate: bracketResult.marginalRate,
      effectiveRate: bracketResult.effectiveRate,
      educationCredit: finalResult.educationCredit,
      childTaxCredit: finalResult.childTaxCredit,
      taxAfterCredits: finalResult.taxAfterCredits,
      federalWithheld: finalResult.federalWithheld,
      estimatedTaxPayments: finalResult.estimatedTaxPayments,
      net: finalResult.net,
      isRefund: finalResult.isRefund,
      isOwed: finalResult.isOwed,
      refundAmount: finalResult.refundAmount,
      owedAmount: finalResult.owedAmount,
    },

    detail: {
      taxYear,
      filingStatus,
      seResult,
      scholarshipResult,
      incomeResult,
      agiResult,
      deductionResult,
      taxableIncome,
      bracketResult,
      educationResult,
      ctcResult,
      finalResult,
    },
  };
}

module.exports = {
  calculateFederal,
  computeSelfEmployment,
  computeTaxableScholarships,
  computeGrossIncome,
  computeAGI,
  computeStandardDeduction,
  computeTaxableIncome,
  computeBracketTax,
  computeEducationCredit,
  computeChildTaxCredit,
  computeFederalResult,
  getRules,
};