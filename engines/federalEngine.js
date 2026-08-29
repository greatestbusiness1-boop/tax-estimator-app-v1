"use strict";

// =============================================================================
// CONFIG â€” TAX RULES BY YEAR
// =============================================================================

const TAX_RULES = {

  2026: {
    // Internal federal support only; 2026 is not exposed to clients yet.
    standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150, qw: 32200 },
    dependentDeduction: { floor: 1350, earnedBonus: 450 },
    seniorAdditional: { single: 2050, mfj: 1650, mfs: 1650, hoh: 2050, qw: 1650 },
    enhancedSeniorDeduction: {
      perEligiblePerson: 6000,
      phaseOutStart: { single: 75000, mfj: 150000, hoh: 75000, qw: 75000 },
      phaseOutRate: 0.06,
    },
    mileageRatePerMile: null,
    mileageRateSchedule: {
      firstHalf: 0.725,
      secondHalf: 0.76,
      changeDate: "2026-07-01",
    },
    selfEmploymentNetEarningsFactor: 0.9235,
    socialSecurityTaxRate: 0.124,
    socialSecurityWageBase: 184500,
    medicareTaxRate: 0.029,
    selfEmploymentTaxDeductionRate: 0.50,
    brackets: {
      single: [
        { min: 0, max: 12400, rate: 0.10 },
        { min: 12400, max: 50400, rate: 0.12 },
        { min: 50400, max: 105700, rate: 0.22 },
        { min: 105700, max: 201775, rate: 0.24 },
        { min: 201775, max: 256225, rate: 0.32 },
        { min: 256225, max: 640600, rate: 0.35 },
        { min: 640600, max: null, rate: 0.37 },
      ],
      mfj: [
        { min: 0, max: 24800, rate: 0.10 },
        { min: 24800, max: 100800, rate: 0.12 },
        { min: 100800, max: 211400, rate: 0.22 },
        { min: 211400, max: 403550, rate: 0.24 },
        { min: 403550, max: 512450, rate: 0.32 },
        { min: 512450, max: 768700, rate: 0.35 },
        { min: 768700, max: null, rate: 0.37 },
      ],
      mfs: [
        { min: 0, max: 12400, rate: 0.10 },
        { min: 12400, max: 50400, rate: 0.12 },
        { min: 50400, max: 105700, rate: 0.22 },
        { min: 105700, max: 201775, rate: 0.24 },
        { min: 201775, max: 256225, rate: 0.32 },
        { min: 256225, max: 384350, rate: 0.35 },
        { min: 384350, max: null, rate: 0.37 },
      ],
      hoh: [
        { min: 0, max: 17700, rate: 0.10 },
        { min: 17700, max: 67450, rate: 0.12 },
        { min: 67450, max: 105700, rate: 0.22 },
        { min: 105700, max: 201750, rate: 0.24 },
        { min: 201750, max: 256200, rate: 0.32 },
        { min: 256200, max: 640600, rate: 0.35 },
        { min: 640600, max: null, rate: 0.37 },
      ],
      qw: [
        { min: 0, max: 24800, rate: 0.10 },
        { min: 24800, max: 100800, rate: 0.12 },
        { min: 100800, max: 211400, rate: 0.22 },
        { min: 211400, max: 403550, rate: 0.24 },
        { min: 403550, max: 512450, rate: 0.32 },
        { min: 512450, max: 768700, rate: 0.35 },
        { min: 768700, max: null, rate: 0.37 },
      ],
    },
    americanOpportunityCredit: {
      maxCredit: 2500, refundableRate: 0.40, tier1Cap: 2000, tier2Cap: 2000, tier2Rate: 0.25,
      phaseOutStart: { single: 80000, mfj: 160000 },
      phaseOutEnd: { single: 90000, mfj: 180000 },
    },
    lifetimeLearningCredit: {
      rate: 0.20, maxExpenses: 10000, maxCredit: 2000,
      phaseOutStart: { single: 80000, mfj: 160000 },
      phaseOutEnd: { single: 90000, mfj: 180000 },
    },
    childTaxCredit: {
      perChild: 2200, refundablePortion: 1700,
      phaseOutThreshold: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000, qw: 400000 },
      phaseOutPer1000: 50,
    },
  },

  2025: {
    standardDeduction: {
      single: 15750,
      mfj:    31500,
      mfs:    15750,
      hoh:    23625,
      qw:     31500,
    },
    dependentDeduction: {
      floor:       1350,
      earnedBonus: 450,
    },
    seniorAdditional: {
      single: 2000,
      mfj:    1600,
      mfs:    1600,
      hoh:    2000,
      qw:     1600,
    },
    enhancedSeniorDeduction: {
      perEligiblePerson: 6000,
      phaseOutStart: {
        single: 75000,
        mfj:    150000,
        hoh:    75000,
        qw:     75000,
      },
      phaseOutRate: 0.06,
    },
    mileageRatePerMile: 0.70,
    selfEmploymentNetEarningsFactor: 0.9235,
    socialSecurityTaxRate: 0.124,
    socialSecurityWageBase: 176100, // SSA 2025 contribution and benefit base
    medicareTaxRate: 0.029,
    selfEmploymentTaxDeductionRate: 0.50,
    brackets: {
      single: [
        { min: 0,      max: 11925,  rate: 0.10 },
        { min: 11925,  max: 48475,  rate: 0.12 },
        { min: 48475,  max: 103350, rate: 0.22 },
        { min: 103350, max: 197300, rate: 0.24 },
        { min: 197300, max: 250525, rate: 0.32 },
        { min: 250525, max: 626350, rate: 0.35 },
        { min: 626350, max: null,   rate: 0.37 },
      ],
      mfj: [
        { min: 0,      max: 23850,  rate: 0.10 },
        { min: 23850,  max: 96950,  rate: 0.12 },
        { min: 96950,  max: 206700, rate: 0.22 },
        { min: 206700, max: 394600, rate: 0.24 },
        { min: 394600, max: 501050, rate: 0.32 },
        { min: 501050, max: 751600, rate: 0.35 },
        { min: 751600, max: null,   rate: 0.37 },
      ],
      mfs: [
        { min: 0,      max: 11925,  rate: 0.10 },
        { min: 11925,  max: 48475,  rate: 0.12 },
        { min: 48475,  max: 103350, rate: 0.22 },
        { min: 103350, max: 197300, rate: 0.24 },
        { min: 197300, max: 250525, rate: 0.32 },
        { min: 250525, max: 375800, rate: 0.35 },
        { min: 375800, max: null,   rate: 0.37 },
      ],
      hoh: [
        { min: 0,      max: 17000,  rate: 0.10 },
        { min: 17000,  max: 64850,  rate: 0.12 },
        { min: 64850,  max: 103350, rate: 0.22 },
        { min: 103350, max: 197300, rate: 0.24 },
        { min: 197300, max: 250500, rate: 0.32 },
        { min: 250500, max: 626350, rate: 0.35 },
        { min: 626350, max: null,   rate: 0.37 },
      ],
      qw: [
        { min: 0,      max: 23850,  rate: 0.10 },
        { min: 23850,  max: 96950,  rate: 0.12 },
        { min: 96950,  max: 206700, rate: 0.22 },
        { min: 206700, max: 394600, rate: 0.24 },
        { min: 394600, max: 501050, rate: 0.32 },
        { min: 501050, max: 751600, rate: 0.35 },
        { min: 751600, max: null,   rate: 0.37 },
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
      perChild:          2200,
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
    selfEmploymentNetEarningsFactor: 0.9235,
    socialSecurityTaxRate: 0.124,
    socialSecurityWageBase: 168600, // SSA 2024 contribution and benefit base
    medicareTaxRate: 0.029,
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
    selfEmploymentNetEarningsFactor: 0.9235,
    socialSecurityTaxRate: 0.124,
    socialSecurityWageBase: 160200, // SSA 2023 contribution and benefit base
    medicareTaxRate: 0.029,
    selfEmploymentTaxDeductionRate: 0.50,
    brackets: {
      single: [
        { min: 0,      max: 11000,  rate: 0.10 },
        { min: 11000,  max: 44725,  rate: 0.12 },
        { min: 44725,  max: 95375,  rate: 0.22 },
        { min: 95375,  max: 182100, rate: 0.24 },
        { min: 182100, max: 231250, rate: 0.32 },
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
        { min: 95375,  max: 182100, rate: 0.24 },
        { min: 182100, max: 231250, rate: 0.32 },
        { min: 231250, max: 346875, rate: 0.35 },
        { min: 346875, max: null,   rate: 0.37 },
      ],
      hoh: [
        { min: 0,      max: 15700,  rate: 0.10 },
        { min: 15700,  max: 59850,  rate: 0.12 },
        { min: 59850,  max: 95350,  rate: 0.22 },
        { min: 95350,  max: 182100, rate: 0.24 },
        { min: 182100, max: 231250, rate: 0.32 },
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
    mileageRatePerMile: null,
    mileageRateSchedule: {
      firstHalf: 0.585,
      secondHalf: 0.625,
      changeDate: "2022-07-01",
    },
    selfEmploymentNetEarningsFactor: 0.9235,
    socialSecurityTaxRate: 0.124,
    socialSecurityWageBase: 147000, // SSA 2022 contribution and benefit base
    medicareTaxRate: 0.029,
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
  const requestedYear = Number(taxYear);
  const rules = TAX_RULES[requestedYear];

  if (!rules) {
    throw new Error(`federalEngine: No rules found for tax year ${taxYear}. Supported years: ${Object.keys(TAX_RULES).join(", ")}.`);
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

const ADDITIONAL_MEDICARE_TAX_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLDS = {
  single: 200000,
  mfj:    250000,
  mfs:    125000,
  hoh:    200000,
  qw:     200000,
};

const ACTC_EARNED_INCOME_THRESHOLD = 2500;
const ACTC_EARNED_INCOME_RATE = 0.15;
const OTHER_DEPENDENT_CREDIT_PER_PERSON = 500;

// =============================================================================
// STEP 1 â€” SELF-EMPLOYMENT INCOME
// =============================================================================

function computeSelfEmployment(input, rules) {
  const seIncome    = input.selfEmploymentIncome || 0;
  const businessExp = input.businessExpenses || 0;
  const mileage     = Math.max(0, Number(input.businessMileage || 0));
  const mileageJanJun = Math.max(0, Number(input.businessMileageJanJun || 0));
  const mileageJulDec = Math.max(0, Number(input.businessMileageJulDec || 0));
  const w2SocialSecurityWages = Math.max(
    0,
    Number(input.w2SocialSecurityWages || 0)
  );

  if (seIncome === 0) {
    return {
      selfEmploymentIncome:            0,
      businessExpenses:                0,
      mileageDeduction:                0,
      businessMileage:                 0,
      businessMileageJanJun:           0,
      businessMileageJulDec:           0,
      netSelfEmploymentIncome:         0,
      netEarningsFromSelfEmployment:   0,
      socialSecurityTaxableEarnings:   0,
      remainingSocialSecurityWageBase: Math.max(
        0,
        rules.socialSecurityWageBase -
          Math.min(w2SocialSecurityWages, rules.socialSecurityWageBase)
      ),
      socialSecurityTax:               0,
      medicareTax:                     0,
      selfEmploymentTax:               0,
      seAboveLineDeduction:            0,
      hasSelfEmployment:               false,
    };
  }

  let mileageDeduction = 0;
  let totalBusinessMileage = mileage;

  if (rules.mileageRateSchedule) {
    if (mileage > 0) {
      throw new Error(
        "federalEngine: This tax year uses split business mileage rates. " +
        "Use businessMileageJanJun and businessMileageJulDec instead of one annual mileage total."
      );
    }

    totalBusinessMileage = mileageJanJun + mileageJulDec;
    mileageDeduction = dollars(
      (mileageJanJun * Number(rules.mileageRateSchedule.firstHalf || 0)) +
      (mileageJulDec * Number(rules.mileageRateSchedule.secondHalf || 0))
    );
  } else {
    if (mileageJanJun > 0 || mileageJulDec > 0) {
      throw new Error(
        "federalEngine: Split mileage fields are only valid for a tax year with split mileage rates."
      );
    }

    mileageDeduction = dollars(
      mileage * Number(rules.mileageRatePerMile || 0)
    );
  }
  const netSE            = seIncome - businessExp - mileageDeduction;
  const seTaxBase        = Math.max(0, netSE);

  const netEarningsFromSelfEmployment =
    seTaxBase * rules.selfEmploymentNetEarningsFactor;

  const remainingSocialSecurityWageBase = Math.max(
    0,
    rules.socialSecurityWageBase -
      Math.min(w2SocialSecurityWages, rules.socialSecurityWageBase)
  );

  const socialSecurityTaxableEarnings = Math.min(
    netEarningsFromSelfEmployment,
    remainingSocialSecurityWageBase
  );

  const socialSecurityTax = dollars(
    socialSecurityTaxableEarnings * rules.socialSecurityTaxRate
  );

  const medicareTax = dollars(
    netEarningsFromSelfEmployment * rules.medicareTaxRate
  );

  const selfEmploymentTax    = socialSecurityTax + medicareTax;
  const seAboveLineDeduction = dollars(
    selfEmploymentTax * rules.selfEmploymentTaxDeductionRate
  );

  return {
    selfEmploymentIncome:            dollars(seIncome),
    businessExpenses:                dollars(businessExp),
    businessMileage:                 dollars(totalBusinessMileage),
    businessMileageJanJun:           dollars(mileageJanJun),
    businessMileageJulDec:           dollars(mileageJulDec),
    mileageDeduction,
    netSelfEmploymentIncome:         dollars(netSE),
    netEarningsFromSelfEmployment:   dollars(netEarningsFromSelfEmployment),
    socialSecurityTaxableEarnings:   dollars(socialSecurityTaxableEarnings),
    remainingSocialSecurityWageBase: dollars(remainingSocialSecurityWageBase),
    socialSecurityTax,
    medicareTax,
    selfEmploymentTax,
    seAboveLineDeduction,
    hasSelfEmployment:               true,
  };
}

// =============================================================================
// STEP 2 â€” TAXABLE SCHOLARSHIP INCOME
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
// STEP 3 â€” GROSS INCOME
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
// STEP 4 â€” ADJUSTED GROSS INCOME
// =============================================================================

function computeAGI(grossIncome, seAboveLineDeduction) {
  const agi = grossIncome - seAboveLineDeduction;
  return {
    grossIncome: dollars(grossIncome),
    seAboveLineDeduction: dollars(seAboveLineDeduction),
    agi: dollars(agi),
  };
}

function computeEnhancedSeniorDeduction(input, agi, rules) {
  const cfg = rules.enhancedSeniorDeduction;

  if (!cfg) {
    return {
      enhancedSeniorDeduction: 0,
      eligibleSeniorCount: 0,
      phaseOutReduction: 0,
      planningMagi: dollars(agi),
    };
  }

  const filingStatus = input.filingStatus;
  const taxpayerEligible = Number(input.age || 0) >= 65;
  const spouseEligible =
    filingStatus === "mfj" && Number(input.spouseAge || 0) >= 65;

  if (filingStatus === "mfs") {
    return {
      enhancedSeniorDeduction: 0,
      eligibleSeniorCount: 0,
      phaseOutReduction: 0,
      planningMagi: dollars(agi),
    };
  }

  const eligibleSeniorCount =
    (taxpayerEligible ? 1 : 0) + (spouseEligible ? 1 : 0);

  if (eligibleSeniorCount === 0) {
    return {
      enhancedSeniorDeduction: 0,
      eligibleSeniorCount: 0,
      phaseOutReduction: 0,
      planningMagi: dollars(agi),
    };
  }

  const phaseOutStart =
    cfg.phaseOutStart[filingStatus] ?? cfg.phaseOutStart.single;

  const planningMagi = Math.max(0, Number(agi || 0));
  const maximumDeduction = cfg.perEligiblePerson * eligibleSeniorCount;
  const phaseOutReduction = Math.max(
    0,
    (planningMagi - phaseOutStart) * cfg.phaseOutRate
  );

  return {
    enhancedSeniorDeduction: dollars(
      Math.max(0, maximumDeduction - phaseOutReduction)
    ),
    eligibleSeniorCount,
    phaseOutReduction: dollars(phaseOutReduction),
    planningMagi: dollars(planningMagi),
  };
}

// =============================================================================
// STEP 5 â€” STANDARD DEDUCTION
// =============================================================================

function computeStandardDeduction(input, rules) {
  const {
    filingStatus,
    age,
    spouseAge,
    canBeClaimedAsDependent,
    w2Income,
  } = input;

  const base     = rules.standardDeduction[filingStatus] || rules.standardDeduction.single;
  const depRules = rules.dependentDeduction;
  const senior   = rules.seniorAdditional;

  let deduction      = base;
  let isDependentAdj = false;
  let seniorCount    = 0;

  if (canBeClaimedAsDependent) {
    const earnedIncome = w2Income || 0;
    const computed     = Math.max(depRules.floor, earnedIncome + depRules.earnedBonus);
    deduction          = Math.min(computed, base);
    isDependentAdj     = true;
  }

  if (Number(age || 0) >= 65) seniorCount += 1;
  if (filingStatus === "mfj" && Number(spouseAge || 0) >= 65) seniorCount += 1;

  if (seniorCount > 0) {
    const additionalAmt = senior[filingStatus] || senior.single;
    deduction += additionalAmt * seniorCount;
  }

  return {
    standardDeduction: dollars(deduction),
    isDependentAdjusted: isDependentAdj,
    isSeniorAdjusted: seniorCount > 0,
    seniorCount,
  };
}

// =============================================================================
// STEP 6 â€” TAXABLE INCOME
// =============================================================================

function computeTaxableIncome(
  agi,
  standardDeduction,
  enhancedSeniorDeduction = 0
) {
  return dollars(
    Math.max(
      0,
      agi - standardDeduction - enhancedSeniorDeduction
    )
  );
}

// =============================================================================
// STEP 7 â€” PROGRESSIVE BRACKET TAX
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
// STEP 8 â€” EDUCATION CREDIT
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
// STEP 9 â€” CHILD TAX CREDIT
// =============================================================================

function computeChildTaxCredit(input, agi, rules, seResult) {
  const qualifyingChildren = Math.max(
    0,
    Math.min(
      Number(input.ctcQualifyingChildren || 0),
      Number(input.numberOfDependents || 0)
    )
  );
  const otherDependents = Math.max(
    0,
    Number(input.numberOfDependents || 0) - qualifyingChildren
  );

  if (
    (qualifyingChildren === 0 && otherDependents === 0) ||
    input.canBeClaimedAsDependent
  ) {
    return {
      childTaxCreditAvailable: 0,
      otherDependentCreditAvailable: 0,
      totalDependentCreditAvailable: 0,
      actcIncomeBasedMaximum: 0,
      qualifyingChildren,
      otherDependents,
      earnedIncomeForActc: 0,
      threeChildAlternativeMayApply: false,
    };
  }

  const ctc = rules.childTaxCredit;
  const threshold =
    ctc.phaseOutThreshold[input.filingStatus] ||
    ctc.phaseOutThreshold.single;

  const childCreditBeforePhaseOut =
    qualifyingChildren * ctc.perChild;
  const otherDependentCreditBeforePhaseOut =
    otherDependents * OTHER_DEPENDENT_CREDIT_PER_PERSON;
  const combinedBeforePhaseOut =
    childCreditBeforePhaseOut + otherDependentCreditBeforePhaseOut;

  let combinedAfterPhaseOut = combinedBeforePhaseOut;
  if (agi > threshold) {
    const reduction =
      Math.ceil((agi - threshold) / 1000) *
      ctc.phaseOutPer1000;
    combinedAfterPhaseOut = Math.max(
      0,
      combinedBeforePhaseOut - reduction
    );
  }

  const childTaxCreditAvailable = Math.min(
    childCreditBeforePhaseOut,
    combinedAfterPhaseOut
  );
  const otherDependentCreditAvailable = Math.max(
    0,
    combinedAfterPhaseOut - childTaxCreditAvailable
  );

  const earnedIncomeForActc = Math.max(
    0,
    Number(input.w2Income || 0) +
      Number(seResult?.netSelfEmploymentIncome || 0)
  );
  const actcIncomeBasedMaximum = Math.max(
    0,
    (earnedIncomeForActc - ACTC_EARNED_INCOME_THRESHOLD) *
      ACTC_EARNED_INCOME_RATE
  );

  return {
    childTaxCreditAvailable: dollars(childTaxCreditAvailable),
    otherDependentCreditAvailable: dollars(otherDependentCreditAvailable),
    totalDependentCreditAvailable: dollars(combinedAfterPhaseOut),
    actcIncomeBasedMaximum: dollars(actcIncomeBasedMaximum),
    qualifyingChildren,
    otherDependents,
    earnedIncomeForActc: dollars(earnedIncomeForActc),
    threeChildAlternativeMayApply: qualifyingChildren >= 3,
  };
}

function computeAdditionalMedicareTax(input, seResult) {
  const filingStatus = input.filingStatus || "single";
  const threshold =
    ADDITIONAL_MEDICARE_THRESHOLDS[filingStatus] ??
    ADDITIONAL_MEDICARE_THRESHOLDS.single;

  const medicareWages = Math.max(
    0,
    Number(input.w2MedicareWages || 0)
  );
  const medicareTaxWithheld = Math.max(
    0,
    Number(input.w2MedicareTaxWithheld || 0)
  );

  const wageAdditionalMedicareTax =
    Math.max(0, medicareWages - threshold) *
    ADDITIONAL_MEDICARE_TAX_RATE;

  const reducedSeThreshold = Math.max(
    0,
    threshold - medicareWages
  );
  const netSeEarnings = Math.max(
    0,
    Number(seResult?.netEarningsFromSelfEmployment || 0)
  );
  const seAdditionalMedicareTax =
    Math.max(0, netSeEarnings - reducedSeThreshold) *
    ADDITIONAL_MEDICARE_TAX_RATE;

  const regularMedicareWithholding =
    medicareWages * 0.0145;
  const additionalMedicareWithheld = Math.max(
    0,
    medicareTaxWithheld - regularMedicareWithholding
  );

  return {
    threshold: dollars(threshold),
    wageAdditionalMedicareTax: dollars(wageAdditionalMedicareTax),
    seAdditionalMedicareTax: dollars(seAdditionalMedicareTax),
    additionalMedicareTax: dollars(
      wageAdditionalMedicareTax + seAdditionalMedicareTax
    ),
    additionalMedicareWithheld: dollars(additionalMedicareWithheld),
  };
}

// =============================================================================
// STEP 10 â€” FINAL FEDERAL RESULT
// =============================================================================

function computeFederalResult(
  bracketTax,
  selfEmploymentTax,
  additionalMedicareResult,
  educationResult,
  ctcResult,
  federalWithheld,
  estimatedTaxPayments,
  rules
) {
  const taxAfterEducationCredit = Math.max(
    0,
    bracketTax -
      (educationResult.educationCreditNonRefundable || 0)
  );

  const dependentCreditAvailable =
    ctcResult.totalDependentCreditAvailable || 0;
  const dependentCreditNonRefundable = Math.min(
    dependentCreditAvailable,
    taxAfterEducationCredit
  );
  const taxAfterNonRefundable = Math.max(
    0,
    taxAfterEducationCredit - dependentCreditNonRefundable
  );

  const unusedDependentCredit = Math.max(
    0,
    dependentCreditAvailable - dependentCreditNonRefundable
  );
  const actcPerChildCap =
    (ctcResult.qualifyingChildren || 0) *
    (rules.childTaxCredit.refundablePortion || 0);

  const childTaxCreditRefundable = Math.min(
    unusedDependentCredit,
    ctcResult.childTaxCreditAvailable || 0,
    ctcResult.actcIncomeBasedMaximum || 0,
    actcPerChildCap
  );

  const refundableCredits =
    (educationResult.educationCreditRefundable || 0) +
    childTaxCreditRefundable;

  const totalTaxLiability = Math.max(
    0,
    taxAfterNonRefundable +
      (selfEmploymentTax || 0) +
      (additionalMedicareResult.additionalMedicareTax || 0)
  );

  const totalPayments =
    (federalWithheld || 0) +
    (estimatedTaxPayments || 0) +
    (additionalMedicareResult.additionalMedicareWithheld || 0) +
    refundableCredits;

  const net = dollars(totalPayments - totalTaxLiability);

  return {
    totalCredits: dollars(
      (educationResult.educationCreditNonRefundable || 0) +
      dependentCreditNonRefundable +
      refundableCredits
    ),
    educationCredit: dollars(
      educationResult.educationCredit || 0
    ),
    childTaxCredit: dollars(
      ctcResult.childTaxCreditAvailable || 0
    ),
    otherDependentCredit: dollars(
      ctcResult.otherDependentCreditAvailable || 0
    ),
    childTaxCreditRefundable: dollars(
      childTaxCreditRefundable
    ),
    dependentCreditNonRefundable: dollars(
      dependentCreditNonRefundable
    ),
    additionalMedicareTax: dollars(
      additionalMedicareResult.additionalMedicareTax || 0
    ),
    additionalMedicareWithheld: dollars(
      additionalMedicareResult.additionalMedicareWithheld || 0
    ),
    taxAfterCredits: dollars(totalTaxLiability),
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
// ORCHESTRATOR â€” calculateFederal()
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
  const enhancedSeniorResult = computeEnhancedSeniorDeduction(
    input,
    agiResult.agi,
    rules
  );
  const taxableIncome     = computeTaxableIncome(
    agiResult.agi,
    deductionResult.standardDeduction,
    enhancedSeniorResult.enhancedSeniorDeduction
  );
  const bracketResult     = computeBracketTax(taxableIncome, filingStatus, rules);
  const educationResult   = computeEducationCredit(input, agiResult.agi, rules);
  const ctcResult         = computeChildTaxCredit(
    input,
    agiResult.agi,
    rules,
    seResult
  );
  const additionalMedicareResult = computeAdditionalMedicareTax(
    input,
    seResult
  );
  const finalResult       = computeFederalResult(
    bracketResult.bracketTax,
    seResult.selfEmploymentTax,
    additionalMedicareResult,
    educationResult,
    ctcResult,
    federalWithheld,
    estimatedTaxPayments,
    rules
  );

  return {
    summary: {
      grossIncome: incomeResult.grossIncome,
      agi: agiResult.agi,
      selfEmploymentIncome: seResult.selfEmploymentIncome,
      businessExpenses: seResult.businessExpenses,
      businessMileage: seResult.businessMileage,
      businessMileageJanJun: seResult.businessMileageJanJun,
      businessMileageJulDec: seResult.businessMileageJulDec,
      mileageDeduction: seResult.mileageDeduction,
      netSelfEmploymentIncome: seResult.netSelfEmploymentIncome,
      selfEmploymentTax: seResult.selfEmploymentTax,
      seAboveLineDeduction: seResult.seAboveLineDeduction,
      hasSelfEmployment: seResult.hasSelfEmployment,
      standardDeduction: deductionResult.standardDeduction,
      enhancedSeniorDeduction: enhancedSeniorResult.enhancedSeniorDeduction,
      totalDeduction: dollars(
        deductionResult.standardDeduction +
        enhancedSeniorResult.enhancedSeniorDeduction
      ),
      taxableIncome,
      taxBeforeCredits: bracketResult.bracketTax,
      marginalRate: bracketResult.marginalRate,
      effectiveRate: bracketResult.effectiveRate,
      educationCredit: finalResult.educationCredit,
      childTaxCredit: finalResult.childTaxCredit,
      otherDependentCredit: finalResult.otherDependentCredit,
      childTaxCreditRefundable: finalResult.childTaxCreditRefundable,
      actcThreeChildAlternativeMayApply:
        ctcResult.threeChildAlternativeMayApply,
      additionalMedicareTax: finalResult.additionalMedicareTax,
      additionalMedicareWithheld: finalResult.additionalMedicareWithheld,
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
      enhancedSeniorResult,
      taxableIncome,
      bracketResult,
      educationResult,
      ctcResult,
      additionalMedicareResult,
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
  computeEnhancedSeniorDeduction,
  computeStandardDeduction,
  computeTaxableIncome,
  computeBracketTax,
  computeEducationCredit,
  computeChildTaxCredit,
  computeAdditionalMedicareTax,
  computeFederalResult,
  getRules,
};

