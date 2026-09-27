"use strict";
// Deterministic verification tests for the Pinnacle Phase 2.5 tax-year-2026
// readiness certification. Every expected value below is calculated by hand
// from the verified 2026 rules (engines/federalEngine.js TAX_RULES[2026],
// engines/stateEngine.js STATE_YEAR_OVERRIDES[2026].AZ) and their documented
// primary sources (irs.gov, SSA, Arizona H.B. 4168), not copied from engine
// output -- estimate() calls below cross-check that hand math, they do not
// define it.
//
// Pure unit tests against taxEstimator.js's estimate() -- no server spawn
// needed (these test the shared federal/state engines directly, independent
// of the Pinnacle-specific reserve calculation in server.js, which has its
// own 2026 tests in test/pinnacle-tax-reserve.test.js).
//
// Run with: npm test  (node --test test/)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { estimate } = require("../taxEstimator");

function run(input) {
  const result = estimate(input);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.result;
}

// =============================================================================
// 1. Schema accepts tax year 2026
// =============================================================================

test("1. estimate() schema accepts tax year 2026", () => {
  const result = estimate({
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 50000
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.meta.taxYear, 2026);
});

// =============================================================================
// 2. Known single-filer 2026 scenario (no self-employment)
//
// Hand calculation: taxable income = $80,000 - $16,100 standard deduction =
// $63,900. 2026 single brackets: 10% to $12,400 = $1,240; 12% on the next
// $38,000 (to $50,400) = $4,560; 22% on the remaining $13,500 (to $63,900) =
// $2,970. Total = $1,240 + $4,560 + $2,970 = $8,770. No dependents/credits
// apply, so tax-after-credits equals the bracket tax exactly.
// =============================================================================

test("2. Known single-filer 2026 scenario matches an independently calculated federal tax", () => {
  const result = run({
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 80000
  });
  assert.equal(result.federal.summary.standardDeduction, 16100);
  assert.equal(result.federal.summary.taxAfterCredits, 8770);
});

// =============================================================================
// 3. Known MFJ 2026 scenario (no self-employment)
//
// Hand calculation: taxable income = $150,000 - $32,200 standard deduction =
// $117,800. 2026 MFJ brackets: 10% to $24,800 = $2,480; 12% on the next
// $76,000 (to $100,800) = $9,120; 22% on the remaining $17,000 (to $117,800)
// = $3,740. Total = $2,480 + $9,120 + $3,740 = $15,340.
// =============================================================================

test("3. Known MFJ 2026 scenario matches an independently calculated federal tax", () => {
  const result = run({
    taxYear: 2026,
    filingStatus: "mfj",
    stateCode: "AZ",
    age: 30,
    spouseAge: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 150000
  });
  assert.equal(result.federal.summary.standardDeduction, 32200);
  assert.equal(result.federal.summary.taxAfterCredits, 15340);
});

// =============================================================================
// 4/5. Schedule C / SE tax and the deductible half, 2026
//
// Hand calculation: net SE income = $60,000 (no expenses/mileage). Net
// earnings from self-employment = $60,000 x 0.9235 = $55,410 (below the
// $184,500 SSA wage base, so the full amount is Social-Security-taxable).
// Social Security tax = $55,410 x 12.4% = $6,870.84 -> rounds to $6,871.
// Medicare tax = $55,410 x 2.9% = $1,606.89 -> rounds to $1,607.
// SE tax = $6,871 + $1,607 = $8,478. Deductible half = round($8,478 x 0.5) =
// $4,239.
// =============================================================================

test("4/5. Known Schedule-C 2026 scenario matches an independently calculated SE tax and its deductible half", () => {
  const result = run({
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 0,
    selfEmploymentIncome: 60000,
    businessExpenses: 0,
    businessMileageJanJun: 0,
    businessMileageJulDec: 0
  });
  assert.equal(result.federal.summary.netSelfEmploymentIncome, 60000);
  assert.equal(result.federal.summary.selfEmploymentTax, 8478);
  assert.equal(result.federal.summary.seAboveLineDeduction, 4239);
});

// =============================================================================
// 6. Mid-year mileage-rate split, 2026
//
// 2026 is a split-mileage year: $0.725/mi Jan-Jun, $0.76/mi Jul-Dec. Hand
// calculation: mileage deduction = (2,000 x $0.725) + (1,000 x $0.76) =
// $1,450 + $760 = $2,210. Net SE income = $5,000 - $0 - $2,210 = $2,790.
// =============================================================================

test("6. Split-year 2026 mileage rate (72.5 cents Jan-Jun, 76 cents Jul-Dec) matches an independently calculated deduction", () => {
  const result = run({
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 0,
    selfEmploymentIncome: 5000,
    businessExpenses: 0,
    businessMileageJanJun: 2000,
    businessMileageJulDec: 1000
  });
  assert.equal(result.federal.summary.mileageDeduction, 2210);
  assert.equal(result.federal.summary.netSelfEmploymentIncome, 2790);
});

// =============================================================================
// 7. Arizona standard deduction, 2026 (confirmed via H.B. 4168 / ARS
// Sec. 43-1041(H) conformity to the federal standard deduction)
//
// Boundary check: income set exactly to the confirmed deduction amount must
// leave $0 of Arizona taxable income; income $40 above it must leave exactly
// $40 taxable ($1 of AZ tax at the flat 2.5% rate). This directly confirms
// the exact dollar deduction amount rather than reading it off a config
// object.
// =============================================================================

test("7. Arizona 2026 standard deduction (single $16,100 / MFJ $32,200) matches the H.B. 4168-confirmed federal-conformity amount", () => {
  const single = run({
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 16140
  });
  assert.equal(single.state.summary.stateTaxableIncome, 40);
  assert.equal(single.state.summary.stateTax, 1);

  const mfj = run({
    taxYear: 2026,
    filingStatus: "mfj",
    stateCode: "AZ",
    age: 30,
    spouseAge: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 32200
  });
  assert.equal(mfj.state.summary.stateTaxableIncome, 0);
  assert.equal(mfj.state.summary.stateTax, 0);
});

// =============================================================================
// 8/9. Arizona dependent tax credit, 2026 (ARS Sec. 43-1073.01, amended by
// H.B. 4168 Sec. 18: $100 -> $125 for under-17; $25 for 17+, unchanged)
//
// Hand calculation (shared base): $100,000 income, single, AZ standard
// deduction $16,100 -> taxable $83,900 -> tax before credits =
// round($83,900 x 0.025) = $2,098 (below the $200,000 phase-out threshold,
// so the full credit applies with no reduction).
// =============================================================================

test("8. Arizona 2026 dependent credit for a single under-17 dependent is exactly $125", () => {
  const result = run({
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 100000,
    numberOfDependents: 1,
    dependentsUnder17: 1
  });
  assert.equal(result.state.summary.stateTaxBeforeCredits, 2098);
  assert.equal(result.state.summary.dependentTaxCredit, 125);
  assert.equal(result.state.summary.stateTax, 2098 - 125);
});

test("9. Arizona 2026 dependent credit for a single age-17-plus dependent is exactly $25 (unchanged by H.B. 4168)", () => {
  const result = run({
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 100000,
    numberOfDependents: 1,
    dependentsUnder17: 0
  });
  assert.equal(result.state.summary.stateTaxBeforeCredits, 2098);
  assert.equal(result.state.summary.dependentTaxCredit, 25);
  assert.equal(result.state.summary.stateTax, 2098 - 25);
});

// =============================================================================
// 10. Arizona dependent-credit phase-out, 2026 (thresholds/5%-per-$1,000 rate
// unchanged by H.B. 4168)
//
// Hand calculation: AGI $210,500, single -> $10,500 over the $200,000
// threshold -> ceil($10,500 / $1,000) = 11 phase-out steps -> factor =
// 1 - (11 x 0.05) = 0.45. Credit before phase-out (1 under-17 + 1 age-17+) =
// $125 + $25 = $150. Phased credit = round($150 x 0.45) = $68 (not capped,
// since tax before credits is far larger). Taxable income = $210,500 -
// $16,100 = $194,400 -> tax before credits = round($194,400 x 0.025) =
// $4,860. Tax after credit = $4,860 - $68 = $4,792.
// =============================================================================

test("10. Arizona 2026 dependent-credit phase-out (unchanged thresholds/rate) matches an independently calculated reduced credit", () => {
  const result = run({
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 210500,
    numberOfDependents: 2,
    dependentsUnder17: 1
  });
  assert.equal(result.state.summary.stateTaxBeforeCredits, 4860);
  assert.equal(result.state.summary.dependentTaxCredit, 68);
  assert.equal(result.state.summary.stateTax, 4792);
});

// =============================================================================
// 11. Arizona flat-tax calculation, 2026 (no dependents)
//
// Hand calculation: $100,000 income, single, AZ standard deduction $16,100
// -> taxable $83,900 -> tax = round($83,900 x 0.025) = $2,098.
// =============================================================================

test("11. Arizona 2026 flat 2.5% tax calculation matches an independently calculated amount", () => {
  const result = run({
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 100000
  });
  assert.equal(result.state.summary.stateTaxableIncome, 83900);
  assert.equal(result.state.summary.stateTax, 2098);
});

// =============================================================================
// 15. 2025 calculations are unchanged by adding 2026
//
// Hand calculation: taxable income = $80,000 - $15,750 (2025 single standard
// deduction) = $64,250. 2025 single brackets: 10% to $11,925 = $1,192.50;
// 12% on the next $36,550 (to $48,475) = $4,386; 22% on the remaining
// $15,775 (to $64,250) = $3,470.50. Total = $1,192.50 + $4,386 + $3,470.50 =
// $9,049.00 exactly.
// =============================================================================

test("15. 2025 federal calculations are unaffected by enabling 2026", () => {
  const result = run({
    taxYear: 2025,
    filingStatus: "single",
    stateCode: "AZ",
    age: 30,
    isFullTimeStudent: false,
    canBeClaimedAsDependent: false,
    otherIncome: 80000
  });
  assert.equal(result.federal.summary.standardDeduction, 15750);
  assert.equal(result.federal.summary.taxAfterCredits, 9049);
});
