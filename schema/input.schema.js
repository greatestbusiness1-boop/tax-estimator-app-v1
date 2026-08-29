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

  spouseAge: {
    required:    false,
    type:        "integer",
    label:       "Spouse Age",
    min:         1,
    max:         120,
    hint:        "Required when filing Married Filing Jointly",
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

  ctcQualifyingChildren: {
    required:    false,
    type:        "integer",
    label:       "Qualifying Children Under Age 17",
    min:         0,
    max:         20,
    default:     0,
  },

  dependentsUnder17: {
    required:    false,
    type:        "integer",
    label:       "Arizona Dependents Under Age 17",
    min:         0,
    max:         20,
  },

  alFullYearResident: {
    required:    false,
    type:        "boolean",
    label:       "Alabama Full-Year Resident",
  },

  alHeadOfFamilyConfirmed: {
    required:    false,
    type:        "boolean",
    label:       "Alabama Head of Family Requirements Confirmed",
  },

  alQualifyingDependents: {
    required:    false,
    type:        "integer",
    label:       "Alabama Qualifying Dependents",
    min:         0,
    max:         20,
  },

  alItemizedDeductions: {
    required:    false,
    type:        "number",
    label:       "Alabama Itemized Deductions",
    min:         0,
    default:     0,
  },

  alExemptIncome: {
    required:    false,
    type:        "number",
    label:       "Alabama-Exempt Income Included in Starting Income",
    min:         0,
    default:     0,
  },

  alFederalIncomeTaxDeduction: {
    required:    false,
    type:        "number",
    label:       "Alabama Federal Income Tax Deduction",
    min:         0,
  },

  alEstimatedTaxPayments: {
    required:    false,
    type:        "number",
    label:       "Alabama Estimated Tax Payments",
    min:         0,
    default:     0,
  },

  alHasSpecialItems: {
    required:    false,
    type:        "boolean",
    label:       "Alabama Other State-Specific Items",
  },

  inFullYearResident: { required: false, type: "boolean", label: "Indiana Full-Year Resident" },
  inTotalAddbacks: { required: false, type: "number", label: "Indiana Schedule 1 Total Add-Backs", min: 0 },
  inTotalDeductions: { required: false, type: "number", label: "Indiana Schedule 2 Total Deductions", min: 0 },
  inAdditionalDependentChildCount: { required: false, type: "integer", label: "Indiana Additional Dependent-Child Count", min: 0, max: 20 },
  inFirstYearAdditionalChildCount: { required: false, type: "integer", label: "Indiana First-Year Additional Child Count", min: 0, max: 20 },
  inAdoptedDependentCount: { required: false, type: "integer", label: "Indiana Adopted Dependent Count", min: 0, max: 20 },
  inTaxpayerBlind: { required: false, type: "boolean", label: "Indiana Taxpayer Blind" },
  inSpouseBlind: { required: false, type: "boolean", label: "Indiana Spouse Blind" },
  inCountyTax: { required: false, type: "number", label: "Indiana Schedule CT-40 County Tax", min: 0 },
  inCountyWithheld: { required: false, type: "number", label: "Indiana County Withholding", min: 0 },
  inClaimedFederalEIC: { required: false, type: "boolean", label: "Indiana Federal EITC Claimed" },
  inFederalEICAmount: { required: false, type: "number", label: "Federal Earned Income Tax Credit for Indiana", min: 0, default: 0 },
  inHasUseTax: { required: false, type: "boolean", label: "Indiana Use Tax Due" },
  inUseTax: { required: false, type: "number", label: "Indiana Use Tax", min: 0, default: 0 },
  inEstimatedAndExtensionPayments: { required: false, type: "number", label: "Indiana Estimated and Extension Payments", min: 0, default: 0 },
  inHasUnifiedTaxCreditForElderly: { required: false, type: "boolean", label: "Indiana Unified Tax Credit for the Elderly" },
  inHasOtherCredits: { required: false, type: "boolean", label: "Indiana Other Schedule 5 or 6 Credits" },
  inHasOtherTaxesOrSpecialItems: { required: false, type: "boolean", label: "Indiana Other Taxes or Material Special Items" },

  ilFullYearResident: { required: false, type: "boolean", label: "Illinois Full-Year Resident" },
  ilTotalAdditions: { required: false, type: "number", label: "Illinois Total Additions", min: 0 },
  ilRetirementSocialSecuritySubtraction: { required: false, type: "number", label: "Illinois Social Security and Retirement Subtraction", min: 0 },
  ilIllinoisIncomeTaxOverpaymentSubtraction: { required: false, type: "number", label: "Illinois Income Tax Overpayment Subtraction", min: 0 },
  ilOtherSubtractions: { required: false, type: "number", label: "Illinois Schedule M Other Subtractions", min: 0 },
  ilSpouseCanBeClaimedAsDependent: { required: false, type: "boolean", label: "Illinois Spouse Can Be Claimed as a Dependent" },
  ilTaxpayerBlind: { required: false, type: "boolean", label: "Illinois Taxpayer Legally Blind" },
  ilSpouseBlind: { required: false, type: "boolean", label: "Illinois Spouse Legally Blind" },
  ilInvestmentCreditRecapture: { required: false, type: "number", label: "Illinois Investment Credit Recapture", min: 0 },
  ilScheduleICRCredit: { required: false, type: "number", label: "Illinois Schedule ICR Credit", min: 0 },
  ilSchedule1299CCredit: { required: false, type: "number", label: "Illinois Schedule 1299-C Credit", min: 0 },
  ilHasOtherStateTaxCredit: { required: false, type: "boolean", label: "Illinois Schedule CR Other-State Tax Credit" },
  ilHouseholdEmploymentTax: { required: false, type: "number", label: "Illinois Household Employment Tax", min: 0 },
  ilUseTax: { required: false, type: "number", label: "Illinois Use Tax", min: 0 },
  ilHasCannabisGamingSurcharge: { required: false, type: "boolean", label: "Illinois Cannabis or Gaming Surcharge" },
  ilEstimatedPayments: { required: false, type: "number", label: "Illinois Estimated Extension and Prior-Year Payments", min: 0 },
  ilPassThroughWithholding: { required: false, type: "number", label: "Illinois Pass-Through Withholding", min: 0 },
  ilPassThroughEntityTaxCredit: { required: false, type: "number", label: "Illinois Pass-Through Entity Tax Credit", min: 0 },
  ilClaimedFederalEITC: { required: false, type: "boolean", label: "Federal EITC Claimed for Illinois" },
  ilFederalEITCAmount: { required: false, type: "number", label: "Federal EITC Amount for Illinois", min: 0, default: 0 },
  ilHasDependentChildUnder12: { required: false, type: "boolean", label: "Illinois EITC Dependent Child Under Age 12" },
  ilNeedsExpandedEITCWorksheet: { required: false, type: "boolean", label: "Illinois Expanded EITC Worksheet Needed" },
  ilHasOtherSpecialItems: { required: false, type: "boolean", label: "Illinois Other Material Special Items" },

  moFullYearResident: { required: false, type: "boolean", label: "Missouri Full-Year Resident" },
  moTotalAdditions: { required: false, type: "number", label: "Missouri Form MO-A Total Additions", min: 0 },
  moTotalSubtractions: { required: false, type: "number", label: "Missouri Form MO-A Total Subtractions", min: 0 },
  moPrimaryAdjustedGrossIncome: { required: false, type: "number", label: "Missouri Adjusted Gross Income - Yourself" },
  moSpouseAdjustedGrossIncome: { required: false, type: "number", label: "Missouri Adjusted Gross Income - Spouse" },
  moPensionSocialSecurityExemption: { required: false, type: "number", label: "Missouri Pension and Social Security Exemption", min: 0 },
  moFederalIncomeTaxDeduction: { required: false, type: "number", label: "Missouri Federal Income Tax Deduction", min: 0 },
  moDeductionChoice: { required: false, type: "string", label: "Missouri Deduction Choice" },
  moItemizedDeductions: { required: false, type: "number", label: "Missouri Itemized Deductions", min: 0 },
  moDependentEarnedIncome: { required: false, type: "number", label: "Missouri Dependent Earned Income", min: 0 },
  moTaxpayerBlind: { required: false, type: "boolean", label: "Missouri Taxpayer Blind" },
  moSpouseBlind: { required: false, type: "boolean", label: "Missouri Spouse Blind" },
  moFederallyRequiredToItemize: { required: false, type: "boolean", label: "Missouri Federally Required to Itemize" },
  moHasQualifiedDisasterLossStandardDeductionIncrease: { required: false, type: "boolean", label: "Missouri Qualified Disaster Loss Standard Deduction Increase" },
  moOtherDeductions: { required: false, type: "number", label: "Missouri Other Deductions Lines 16-24", min: 0 },
  moClaimedFederalEIC: { required: false, type: "boolean", label: "Missouri Federal Earned Income Credit Allowed" },
  moFederalEICAmount: { required: false, type: "number", label: "Federal Earned Income Credit for Missouri", min: 0, default: 0 },
  moWftcInvestmentIncomeOver4400: { required: false, type: "boolean", label: "Missouri WFTC Investment Income Over $4,400" },
  moWftcChildInfoComplete: { required: false, type: "boolean", label: "Missouri WFTC Qualifying Child Information Complete" },
  moEstimatedTaxPayments: { required: false, type: "number", label: "Missouri Estimated Tax Payments", min: 0, default: 0 },
  moOtherPayments: { required: false, type: "number", label: "Missouri Other Payments", min: 0, default: 0 },
  moExtensionPayments: { required: false, type: "number", label: "Missouri Extension Payments", min: 0, default: 0 },
  moHasEnterpriseZoneModification: { required: false, type: "boolean", label: "Missouri Enterprise or Rural Zone Modification" },
  moHasResidentCreditOtherState: { required: false, type: "boolean", label: "Missouri Credit for Tax Paid to Another State" },
  moHasMiscOrPropertyTaxCredits: { required: false, type: "boolean", label: "Missouri Miscellaneous or Property Tax Credits" },
  moHasOtherTaxOrSpecialItems: { required: false, type: "boolean", label: "Missouri Other Tax or Material Special Items" },

  ohFullYearResident: { required: false, type: "boolean", label: "Ohio Full-Year Resident" },
  ohTotalAdditions: { required: false, type: "number", label: "Ohio Schedule of Adjustments Total Additions", min: 0 },
  ohOtherDeductionsExcludingBusinessIncomeDeduction: { required: false, type: "number", label: "Ohio Other Deductions Excluding Business Income Deduction", min: 0 },
  ohScheduleBusinessIncomeTotal: { required: false, type: "number", label: "Ohio Schedule of Business Income Line 10 Total Business Income" },
  ohSpouseCanBeClaimedAsDependent: { required: false, type: "boolean", label: "Ohio Spouse Can Be Claimed as a Dependent" },
  ohNonrefundableCredits: { required: false, type: "number", label: "Ohio Schedule of Credits Line 40 Nonrefundable Credits", min: 0 },
  ohInterestPenalty: { required: false, type: "number", label: "Ohio Estimated-Tax Interest Penalty", min: 0 },
  ohUseTax: { required: false, type: "number", label: "Ohio Unpaid Use Tax", min: 0 },
  ohEstimatedAndOtherPayments: { required: false, type: "number", label: "Ohio Estimated Extension Carryforward and Prior Payments", min: 0 },
  ohRefundableCredits: { required: false, type: "number", label: "Ohio Schedule of Credits Line 47 Refundable Credits", min: 0 },
  ohHasSchoolDistrictIncomeTax: { required: false, type: "boolean", label: "Ohio School District Income Tax Applies" },
  ohSchoolDistrictTax: { required: false, type: "number", label: "Ohio SD 100 School District Tax Liability", min: 0 },
  ohSchoolDistrictWithholding: { required: false, type: "number", label: "Ohio School District Withholding", min: 0 },
  ohSchoolDistrictPayments: { required: false, type: "number", label: "Ohio School District Payments and Credit Carryforward", min: 0 },
  ohHasResidencyCreditOrAllocation: { required: false, type: "boolean", label: "Ohio Residency Credit or Allocation Applies" },
  ohHasAmendedNolOrSpecialItems: { required: false, type: "boolean", label: "Ohio Amended NOL or Other Material Special Items" },

  paFullYearResident: { required: false, type: "boolean", label: "Pennsylvania Full-Year Resident" },
  paNetCompensation: { required: false, type: "number", label: "Pennsylvania PA-40 Line 1c Net Compensation", min: 0 },
  paInterestIncome: { required: false, type: "number", label: "Pennsylvania PA-40 Line 2 Interest Income", min: 0 },
  paDividendIncome: { required: false, type: "number", label: "Pennsylvania PA-40 Line 3 Dividend Income", min: 0 },
  paBusinessFarmIncomeLoss: { required: false, type: "number", label: "Pennsylvania PA-40 Line 4 Business Farm Income or Loss" },
  paPropertyGainLoss: { required: false, type: "number", label: "Pennsylvania PA-40 Line 5 Property Gain or Loss" },
  paRentRoyaltyIncomeLoss: { required: false, type: "number", label: "Pennsylvania PA-40 Line 6 Rent Royalty Income or Loss" },
  paEstateTrustIncome: { required: false, type: "number", label: "Pennsylvania PA-40 Line 7 Estate or Trust Income", min: 0 },
  paGamblingLotteryWinnings: { required: false, type: "number", label: "Pennsylvania PA-40 Line 8 Gambling and Lottery Winnings", min: 0 },
  paOtherDeductions: { required: false, type: "number", label: "Pennsylvania Schedule O Line 10 Other Deductions", min: 0 },
  paHasResidentCredit: { required: false, type: "boolean", label: "Pennsylvania Schedule G-L Resident Credit Applies" },
  paResidentCredit: { required: false, type: "number", label: "Pennsylvania PA-40 Line 22 Resident Credit", min: 0 },
  paClaimTaxForgiveness: { required: false, type: "boolean", label: "Pennsylvania Schedule SP Tax Forgiveness Claimed" },
  paTaxForgivenessEligibilityIncome: { required: false, type: "number", label: "Pennsylvania Schedule SP Eligibility Income", min: 0 },
  paTaxForgivenessDependentChildren: { required: false, type: "integer", label: "Pennsylvania Schedule SP Dependent Children", min: 0, max: 99 },
  paDependentClaimantEligibleTaxForgiveness: { required: false, type: "boolean", label: "Pennsylvania Dependent Claimant Eligible for Tax Forgiveness" },
  paHasChildDependentCareCredit: { required: false, type: "boolean", label: "Pennsylvania Child and Dependent Care Enhancement Credit Applies" },
  paChildDependentCareCredit: { required: false, type: "number", label: "Pennsylvania Schedule DC Credit", min: 0 },
  paHasRestrictedScheduleOCCredits: { required: false, type: "boolean", label: "Pennsylvania Schedule OC Restricted Credits Apply" },
  paClaimedFederalEITC: { required: false, type: "boolean", label: "Federal EITC Allowed for Pennsylvania WPTC" },
  paFederalEITCAmount: { required: false, type: "number", label: "Federal EITC Amount for Pennsylvania WPTC", min: 0 },
  paPriorYearCredit: { required: false, type: "number", label: "Pennsylvania PA-40 Line 14 Prior-Year Credit", min: 0 },
  paEstimatedPayments: { required: false, type: "number", label: "Pennsylvania PA-40 Line 15 Estimated Payments", min: 0 },
  paExtensionPayment: { required: false, type: "number", label: "Pennsylvania PA-40 Line 16 Extension Payment", min: 0 },
  paNonresidentWithholding: { required: false, type: "number", label: "Pennsylvania PA-40 Line 17 NRK-1 Withholding", min: 0 },
  paUseTax: { required: false, type: "number", label: "Pennsylvania PA-40 Line 25 Use Tax", min: 0 },
  paPenaltiesInterest: { required: false, type: "number", label: "Pennsylvania PA-40 Line 27 Penalties and Interest", min: 0 },
  paHasLocalEarnedIncomeTax: { required: false, type: "boolean", label: "Pennsylvania Local Earned Income or Wage Tax Applies" },
  paLocalEarnedIncomeTax: { required: false, type: "number", label: "Pennsylvania Local Earned Income Tax Liability", min: 0 },
  paLocalEarnedIncomeWithholding: { required: false, type: "number", label: "Pennsylvania Local Earned Income Tax Withholding", min: 0 },
  paLocalEarnedIncomePayments: { required: false, type: "number", label: "Pennsylvania Local Earned Income Tax Payments", min: 0 },
  paHasAmendedOrOtherSpecialItems: { required: false, type: "boolean", label: "Pennsylvania Amended or Other Material Special Items" },

  mnFullYearResident: { required: false, type: "boolean", label: "Minnesota Full-Year Resident" },
  mnM1Additions: { required: false, type: "number", label: "Minnesota Form M1 Line 2 Additions", min: 0 },
  mnUseItemizedDeductions: { required: false, type: "boolean", label: "Minnesota Uses Itemized Deductions" },
  mnItemizedDeductions: { required: false, type: "number", label: "Minnesota Schedule M1SA Line 27 Itemized Deductions", min: 0 },
  mnTaxpayerBlind: { required: false, type: "boolean", label: "Minnesota Taxpayer Blind" },
  mnSpouseBlind: { required: false, type: "boolean", label: "Minnesota Spouse Blind" },
  mnMfsSpouseItemizes: { required: false, type: "boolean", label: "Minnesota MFS Spouse Itemizes" },
  mnMfsSpouseNoGrossIncomeAndNotDependent: { required: false, type: "boolean", label: "Minnesota MFS Spouse Has No Gross Income and Is Not a Dependent" },
  mnSpouseCanBeClaimedAsDependent: { required: false, type: "boolean", label: "Minnesota MFJ Spouse Can Be Claimed as Dependent" },
  mnDependentEarnedIncome: { required: false, type: "number", label: "Minnesota Dependent Standard Deduction Earned Income", min: 0 },
  mnHasM1NCFederalAdjustments: { required: false, type: "boolean", label: "Minnesota Schedule M1NC Federal Adjustments Apply" },
  mnM1NCWorksheetAGI: { required: false, type: "number", label: "Minnesota Schedule M1NC Line 43 Worksheet AGI" },
  mnStateIncomeTaxRefund: { required: false, type: "number", label: "Minnesota Form M1 Line 6 State Income Tax Refund", min: 0 },
  mnM1Subtractions: { required: false, type: "number", label: "Minnesota Form M1 Line 7 Subtractions", min: 0 },
  mnAlternativeMinimumTax: { required: false, type: "number", label: "Minnesota Form M1 Line 11 Alternative Minimum Tax", min: 0 },
  mnOtherTaxes: { required: false, type: "number", label: "Minnesota Form M1 Line 14a Other Taxes", min: 0 },
  mnAdvanceChildTaxCreditRepayment: { required: false, type: "number", label: "Minnesota Form M1 Line 14b Advance Child Tax Credit Repayment", min: 0 },
  mnNonrefundableCredits: { required: false, type: "number", label: "Minnesota Form M1 Line 16 Nonrefundable Credits", min: 0 },
  mnNongameWildlifeContribution: { required: false, type: "number", label: "Minnesota Form M1 Line 18 Nongame Wildlife Contribution", min: 0 },
  mnEstimatedPayments: { required: false, type: "number", label: "Minnesota Form M1 Line 21 Estimated and Extension Payments", min: 0 },
  mnRefundableCredits: { required: false, type: "number", label: "Minnesota Form M1 Line 22 Refundable Credits", min: 0 },
  mnScheduleM15Penalty: { required: false, type: "number", label: "Minnesota Form M1 Line 27 Schedule M15 Penalty", min: 0 },
  mnOtherPenaltyInterest: { required: false, type: "number", label: "Minnesota Form M1 Line 28 Penalty and Interest", min: 0 },
  mnHasOtherStateCreditOrReciprocity: { required: false, type: "boolean", label: "Minnesota Other-State Credit or Reciprocity Applies" },
  mnShortPeriodOrNonresidentAlien: { required: false, type: "boolean", label: "Minnesota Short-Period or Nonresident-Alien Standard Deduction Restriction" },
  mnHasAmendedOrOtherSpecialItems: { required: false, type: "boolean", label: "Minnesota Amended or Other Material Special Items" },

  wiFullYearResident: { required: false, type: "boolean", label: "Wisconsin Full-Year Resident" },
  wiScheduleIAdjustment: { required: false, type: "number", label: "Wisconsin Schedule I Line 3 Net Adjustment" },
  wiScheduleADAdditions: { required: false, type: "number", label: "Wisconsin Schedule AD Line 33 Additions", min: 0 },
  wiScheduleSBSubtractions: { required: false, type: "number", label: "Wisconsin Schedule SB Line 50 Subtractions", min: 0 },
  wiShortPeriodOrPossessions: { required: false, type: "boolean", label: "Wisconsin Short-Period or U.S. Possessions Standard-Deduction Exception" },
  wiSpouseCanBeClaimedAsDependent: { required: false, type: "boolean", label: "Wisconsin Spouse Can Be Claimed as a Dependent" },
  wiDependentEarnedIncome: { required: false, type: "number", label: "Wisconsin Dependent Standard-Deduction Earned Income", min: 0 },
  wiUsedNewRetirementIncomeSubtraction: { required: false, type: "boolean", label: "Wisconsin New 2025 Age-67 Retirement Income Subtraction Used" },
  wiNonrefundableCredits: { required: false, type: "number", label: "Wisconsin Form 1 Lines 13-20 Nonrefundable Credits", min: 0 },
  wiClaimedFederalEIC: { required: false, type: "boolean", label: "Federal EIC Used for Wisconsin Earned Income Credit" },
  wiFederalEICAmount: { required: false, type: "number", label: "Federal EIC Amount for Wisconsin Purposes", min: 0 },
  wiEICQualifyingChildren: { required: false, type: "integer", label: "Wisconsin EIC Qualifying Children", min: 0, max: 20 },
  wiOtherRefundableCredits: { required: false, type: "number", label: "Wisconsin Form 1 Lines 31-35 Other Refundable Credits", min: 0 },
  wiUseTax: { required: false, type: "number", label: "Wisconsin Form 1 Line 23 Sales and Use Tax", min: 0 },
  wiDonations: { required: false, type: "number", label: "Wisconsin Form 1 Line 24 Donations", min: 0 },
  wiRetirementPenaltiesAndCreditRepayments: { required: false, type: "number", label: "Wisconsin Form 1 Lines 25-26 Penalties and Credit Repayments", min: 0 },
  wiEstimatedPayments: { required: false, type: "number", label: "Wisconsin Form 1 Line 29 Estimated and Extension Payments", min: 0 },
  wiUnderpaymentInterest: { required: false, type: "number", label: "Wisconsin Form 1 Line 44 Underpayment Interest", min: 0 },
  wiHasOtherStateCreditOrReciprocity: { required: false, type: "boolean", label: "Wisconsin Other-State Credit or Reciprocity Applies" },
  wiHasAmendedOrOtherSpecialItems: { required: false, type: "boolean", label: "Wisconsin Amended or Other Material Special Items" },

  miFullYearResident: {
    required:    false,
    type:        "boolean",
    label:       "Michigan Full-Year Resident",
  },
  miMfsMichiganFilingChoice: { required: false, type: "string", label: "Michigan Filing Choice When Federal MFS" },

  miOtherAdditions: { required: false, type: "number", label: "Michigan Schedule 1 Other Additions", min: 0 },
  miTaxableSocialSecurity: { required: false, type: "number", label: "Michigan Taxable Social Security Included in Federal AGI", min: 0 },
  miOtherSubtractions: { required: false, type: "number", label: "Michigan Schedule 1 Other Subtractions", min: 0 },
  miSpecialExemptionCount: { required: false, type: "integer", label: "Michigan Special Exemption Count", min: 0, max: 20 },
  miQualifiedDisabledVeteranCount: { required: false, type: "integer", label: "Michigan Qualified Disabled Veteran Exemption Count", min: 0, max: 20 },
  miStillbirthCount: { required: false, type: "integer", label: "Michigan Certificates of Stillbirth", min: 0, max: 20 },
  miClaimedFederalEIC: { required: false, type: "boolean", label: "Michigan Federal EITC Claimed" },
  miFederalEICAmount: { required: false, type: "number", label: "Federal Earned Income Tax Credit", min: 0, default: 0 },
  miHasRetirementPensionOrSeniorDeduction: { required: false, type: "boolean", label: "Michigan Form 4884 / Standard or Senior Deduction Applies" },
  miHasPA24DecouplingAdjustment: { required: false, type: "boolean", label: "Michigan 2025 PA 24 Federal-Decoupling Adjustment Applies" },
  miHasOtherStateCreditOrAllocation: { required: false, type: "boolean", label: "Michigan Other-State Credit or Allocation" },
  miHasDetroitCityReturn: { required: false, type: "boolean", label: "Michigan City Income-Tax Return Applies" },
  miHasUseTax: { required: false, type: "boolean", label: "Michigan Use Tax Due" },
  miUseTax: { required: false, type: "number", label: "Michigan Use Tax", min: 0, default: 0 },
  miEstimatedAndExtensionPayments: { required: false, type: "number", label: "Michigan Estimated and Extension Payments", min: 0, default: 0 },
  miHasSeparateRefundableCredits: { required: false, type: "boolean", label: "Michigan Separate Refundable Credits" },
  miHasOtherSpecialItems: { required: false, type: "boolean", label: "Michigan Other Material State-Specific Items" },

  wvFullYearResident: {
    required:    false,
    type:        "boolean",
    label:       "West Virginia Full-Year Resident",
  },

  wvTotalAdditions: {
    required:    false,
    type:        "number",
    label:       "West Virginia Schedule M Total Additions",
    min:         0,
  },

  wvOtherSubtractions: {
    required:    false,
    type:        "number",
    label:       "West Virginia Schedule M Other Subtractions",
    min:         0,
  },

  wvTaxableSocialSecurity: {
    required:    false,
    type:        "number",
    label:       "West Virginia Taxable Social Security Included in Federal AGI",
    min:         0,
  },

  wvLowIncomeEarnedIncome: {
    required:    false,
    type:        "number",
    label:       "West Virginia Low-Income Worksheet Earned Income",
    min:         0,
  },

  wvSpouseCanBeClaimedAsDependent: {
    required:    false,
    type:        "boolean",
    label:       "West Virginia Spouse Can Be Claimed as a Dependent",
  },

  wvSurvivingSpouseExemption: {
    required:    false,
    type:        "boolean",
    label:       "West Virginia Additional Surviving Spouse Exemption",
  },

  wvTaxExemptInterestForFamilyCredit: {
    required:    false,
    type:        "number",
    label:       "West Virginia Tax-Exempt Interest for Family Tax Credit",
    min:         0,
  },

  wvFederalAMT: {
    required:    false,
    type:        "boolean",
    label:       "Federal Alternative Minimum Tax Applies",
  },

  wvHasChildDependentCareCredit: {
    required:    false,
    type:        "boolean",
    label:       "West Virginia Child and Dependent Care Credit",
  },

  wvFederalChildDependentCareCredit: {
    required:    false,
    type:        "number",
    label:       "Federal Form 2441 Child and Dependent Care Credit",
    min:         0,
    default:     0,
  },

  wvHasOtherStateTaxCredit: {
    required:    false,
    type:        "boolean",
    label:       "West Virginia Credit for Tax Paid to Another State",
  },

  wvHasUseTax: {
    required:    false,
    type:        "boolean",
    label:       "West Virginia Purchaser Use Tax Due",
  },

  wvUseTax: {
    required:    false,
    type:        "number",
    label:       "West Virginia Purchaser Use Tax",
    min:         0,
    default:     0,
  },

  wvEstimatedAndExtensionPayments: {
    required:    false,
    type:        "number",
    label:       "West Virginia Estimated Tax and Extension Payments",
    min:         0,
    default:     0,
  },

  wvHasOtherSpecialItems: {
    required:    false,
    type:        "boolean",
    label:       "West Virginia Other Material State-Specific Items",
  },

  vaFullYearResident: {
    required:    false,
    type:        "boolean",
    label:       "Virginia Full-Year Resident",
  },

  vaFederalItemized: {
    required:    false,
    type:        "boolean",
    label:       "Virginia Federal Itemized Deduction Choice",
  },

  vaItemizedDeductions: {
    required:    false,
    type:        "number",
    label:       "Virginia Schedule A Itemized Deductions",
    min:         0,
  },

  vaDependentEarnedIncome: {
    required:    false,
    type:        "number",
    label:       "Virginia Dependent Earned Income",
    min:         0,
  },

  vaTotalAdditions: {
    required:    false,
    type:        "number",
    label:       "Virginia Schedule ADJ Total Additions",
    min:         0,
  },

  vaAgeDeduction: {
    required:    false,
    type:        "number",
    label:       "Virginia Age Deduction",
    min:         0,
    max:         24000,
  },

  vaTaxableSocialSecurityTier1: {
    required:    false,
    type:        "number",
    label:       "Virginia Taxable Social Security and Tier 1 Railroad Benefits",
    min:         0,
  },

  vaStateIncomeTaxRefund: {
    required:    false,
    type:        "number",
    label:       "Virginia State Income Tax Refund Included in Federal AGI",
    min:         0,
  },

  vaOtherSubtractions: {
    required:    false,
    type:        "number",
    label:       "Virginia Schedule ADJ Other Subtractions",
    min:         0,
  },

  vaOtherDeductions: {
    required:    false,
    type:        "number",
    label:       "Virginia Schedule ADJ Other Deductions",
    min:         0,
  },

  vaAge65OrOlderCount: {
    required:    false,
    type:        "integer",
    label:       "Virginia Age 65 or Older Exemption Count",
    min:         0,
    max:         2,
  },

  vaBlindCount: {
    required:    false,
    type:        "integer",
    label:       "Virginia Blind Exemption Count",
    min:         0,
    max:         2,
  },

  vaSpouseTaxAdjustment: {
    required:    false,
    type:        "number",
    label:       "Virginia Spouse Tax Adjustment",
    min:         0,
    max:         259,
  },

  vaIncomeBasedCreditType: {
    required:    false,
    type:        "string",
    label:       "Virginia Low-Income or Earned Income Credit Type",
    allowed:     ["none", "refundable_eitc", "nonrefundable_eitc", "low_income"],
  },

  vaIncomeBasedCreditAmount: {
    required:    false,
    type:        "number",
    label:       "Virginia Low-Income or Earned Income Credit Amount",
    min:         0,
    default:     0,
  },

  vaHasOtherStateTaxCredit: {
    required:    false,
    type:        "boolean",
    label:       "Virginia Credit for Tax Paid to Another State",
  },

  vaHasUseTax: {
    required:    false,
    type:        "boolean",
    label:       "Virginia Consumer Use Tax Due",
  },

  vaUseTax: {
    required:    false,
    type:        "number",
    label:       "Virginia Consumer Use Tax",
    min:         0,
    default:     0,
  },

  vaEstimatedTaxPayments: {
    required:    false,
    type:        "number",
    label:       "Virginia Estimated Tax Payments",
    min:         0,
    default:     0,
  },

  vaPriorYearOverpaymentApplied: {
    required:    false,
    type:        "number",
    label:       "Virginia Prior-Year Overpayment Applied",
    min:         0,
    default:     0,
  },

  vaExtensionPayment: {
    required:    false,
    type:        "number",
    label:       "Virginia Extension Payment",
    min:         0,
    default:     0,
  },

  vaOtherWithholding: {
    required:    false,
    type:        "number",
    label:       "Virginia Other Withholding",
    min:         0,
    default:     0,
  },

  vaHasOtherSpecialItems: {
    required:    false,
    type:        "boolean",
    label:       "Virginia Other Credits, Penalties, Contributions, or Special Items",
  },

  scFullYearResident: {
    required:    false,
    type:        "boolean",
    label:       "South Carolina Full-Year Resident",
  },

  scTotalAdditions: {
    required:    false,
    type:        "number",
    label:       "South Carolina SC1040 Total Additions",
    min:         0,
  },

  scOtherSubtractions: {
    required:    false,
    type:        "number",
    label:       "South Carolina Other Subtractions",
    min:         0,
  },

  scDependentsUnder6: {
    required:    false,
    type:        "integer",
    label:       "South Carolina Dependents Under Age 6",
    min:         0,
    max:         20,
  },

  scHasChildDependentCareCredit: {
    required:    false,
    type:        "boolean",
    label:       "South Carolina Child and Dependent Care Credit Applies",
  },

  scFederalChildCareExpense: {
    required:    false,
    type:        "number",
    label:       "Federal Child and Dependent Care Expense",
    min:         0,
  },

  scChildCareQualifyingPersons: {
    required:    false,
    type:        "integer",
    label:       "South Carolina Child Care Qualifying Persons",
    min:         1,
    max:         2,
  },

  scHasTwoWageEarnerCredit: {
    required:    false,
    type:        "boolean",
    label:       "South Carolina Two Wage Earner Credit Applies",
  },

  scTaxpayerQualifiedEarnedIncome: {
    required:    false,
    type:        "number",
    label:       "Taxpayer South Carolina Qualified Earned Income",
    min:         0,
  },

  scSpouseQualifiedEarnedIncome: {
    required:    false,
    type:        "number",
    label:       "Spouse South Carolina Qualified Earned Income",
    min:         0,
  },

  scClaimedFederalEIC: {
    required:    false,
    type:        "boolean",
    label:       "Federal Earned Income Tax Credit Claimed",
  },

  scFederalEICAmount: {
    required:    false,
    type:        "number",
    label:       "Federal Earned Income Tax Credit Amount",
    min:         0,
  },

  scHasOtherStateTaxCredit: {
    required:    false,
    type:        "boolean",
    label:       "South Carolina Credit for Taxes Paid to Another State",
  },

  scHasUseTax: {
    required:    false,
    type:        "boolean",
    label:       "South Carolina Use Tax Due",
  },

  scUseTax: {
    required:    false,
    type:        "number",
    label:       "South Carolina Use Tax",
    min:         0,
  },

  scEstimatedTaxPayments: {
    required:    false,
    type:        "number",
    label:       "South Carolina Estimated Tax Payments",
    min:         0,
    default:     0,
  },

  scExtensionPayment: {
    required:    false,
    type:        "number",
    label:       "South Carolina Extension Payment",
    min:         0,
    default:     0,
  },

  scOtherWithholding: {
    required:    false,
    type:        "number",
    label:       "South Carolina Other Withholding",
    min:         0,
    default:     0,
  },

  scHasOtherSpecialItems: {
    required:    false,
    type:        "boolean",
    label:       "South Carolina Other Credits, Taxes, or Special Items",
  },

  okFullYearResident: {
    required:    false,
    type:        "boolean",
    label:       "Oklahoma Full-Year Resident",
  },

  okHasNonresidentSpouseAllocation: {
    required:    false,
    type:        "boolean",
    label:       "Oklahoma Nonresident Spouse / Form 574 Allocation",
  },

  okHasOutOfStatePropertyBusinessIncome: {
    required:    false,
    type:        "boolean",
    label:       "Oklahoma Form 511 Line 4 Out-of-State Income",
  },

  okOklahomaAGI: {
    required:    false,
    type:        "number",
    label:       "Oklahoma Form 511 Line 7 Adjusted Gross Income",
    min:         0,
  },

  okOklahomaIncomeAfterAdjustments: {
    required:    false,
    type:        "number",
    label:       "Oklahoma Form 511 Line 9 Income After Adjustments",
    min:         0,
  },

  okFederalItemized: {
    required:    false,
    type:        "boolean",
    label:       "Federal Itemized Deductions Used",
  },

  okItemizedDeductions: {
    required:    false,
    type:        "number",
    label:       "Oklahoma Schedule 511-D Line 11 Itemized Deductions",
    min:         0,
  },

  okRegularExemptions: {
    required:    false,
    type:        "integer",
    label:       "Oklahoma Regular Exemptions",
    min:         0,
    max:         2,
  },

  okSpecial65Exemptions: {
    required:    false,
    type:        "integer",
    label:       "Oklahoma Age-65 Special Exemptions",
    min:         0,
    max:         2,
  },

  okBlindExemptions: {
    required:    false,
    type:        "integer",
    label:       "Oklahoma Blind Exemptions",
    min:         0,
    max:         2,
  },

  okQualifyingDependents: {
    required:    false,
    type:        "integer",
    label:       "Oklahoma Qualifying Dependents",
    min:         0,
    max:         20,
  },

  okHasFederalChildOrCareCredit: {
    required:    false,
    type:        "boolean",
    label:       "Federal Child Care or Child Tax Credit Applies",
  },

  okFederalChildCareCredit: {
    required:    false,
    type:        "number",
    label:       "Federal Child Care Credit",
    min:         0,
    default:     0,
  },

  okFederalChildTaxCreditTotal: {
    required:    false,
    type:        "number",
    label:       "Federal Child Tax Credit plus Additional Child Tax Credit",
    min:         0,
    default:     0,
  },

  okHasOklahomaEIC: {
    required:    false,
    type:        "boolean",
    label:       "Oklahoma Earned Income Credit Applies",
  },

  okFederalEIC2020Law: {
    required:    false,
    type:        "number",
    label:       "Federal EIC Calculated Under Oklahoma 2020-Law Method",
    min:         0,
    default:     0,
  },

  okUseTax: {
    required:    false,
    type:        "number",
    label:       "Oklahoma Use Tax",
    min:         0,
    default:     0,
  },

  okEstimatedTaxPayments: {
    required:    false,
    type:        "number",
    label:       "Oklahoma Estimated Tax Payments",
    min:         0,
    default:     0,
  },

  okExtensionPayment: {
    required:    false,
    type:        "number",
    label:       "Oklahoma Extension Payment",
    min:         0,
    default:     0,
  },

  okHasOtherSpecialItems: {
    required:    false,
    type:        "boolean",
    label:       "Oklahoma Other Credits or Additional Taxes",
  },

  arFullYearResident: {
    required:    false,
    type:        "boolean",
    label:       "Arkansas Full-Year Resident",
  },

  arArkansasTotalIncome: {
    required:    false,
    type:        "number",
    label:       "Arkansas AR1000F Line 23 Total Income",
    min:         0,
  },

  arArkansasAGI: {
    required:    false,
    type:        "number",
    label:       "Arkansas AR1000F Line 25 Adjusted Gross Income",
    min:         0,
  },

  arItemizedDeductions: {
    required:    false,
    type:        "number",
    label:       "Arkansas Itemized Deductions",
    min:         0,
    default:     0,
  },

  arQualifyingDependents: {
    required:    false,
    type:        "integer",
    label:       "Arkansas Qualifying Dependents",
    min:         0,
    max:         20,
    default:     0,
  },

  arAdditionalPersonalCreditBoxes: {
    required:    false,
    type:        "integer",
    label:       "Arkansas Additional Personal Credit Boxes",
    min:         0,
    max:         10,
    default:     0,
  },

  arMfsSameReturn: {
    required:    false,
    type:        "boolean",
    label:       "Arkansas Married Filing Separately on Same Return",
  },

  arMfsSpouseItemizes: {
    required:    false,
    type:        "boolean",
    label:       "Arkansas MFS Spouse Itemizes",
  },

  arSurvivingSpouseConfirmed: {
    required:    false,
    type:        "boolean",
    label:       "Arkansas Surviving Spouse Requirements Confirmed",
  },

  arEstimatedTaxPayments: {
    required:    false,
    type:        "number",
    label:       "Arkansas Estimated Tax Payments",
    min:         0,
    default:     0,
  },

  arExtensionPayment: {
    required:    false,
    type:        "number",
    label:       "Arkansas Extension Payment",
    min:         0,
    default:     0,
  },

  arHasOtherSpecialItems: {
    required:    false,
    type:        "boolean",
    label:       "Arkansas Other State-Specific Items",
  },

  laFullYearResident: {
    required:    false,
    type:        "boolean",
    label:       "Louisiana Full-Year Resident",
  },

  laFederalReturnRequired: {
    required:    false,
    type:        "boolean",
    label:       "Louisiana Federal Return Required",
  },

  laUsesScheduleE: {
    required:    false,
    type:        "boolean",
    label:       "Louisiana Schedule E Required",
  },

  laScheduleEAdjustedGrossIncome: {
    required:    false,
    type:        "number",
    label:       "Louisiana Schedule E Adjusted Gross Income",
    min:         0,
  },

  laFederalItemized: {
    required:    false,
    type:        "boolean",
    label:       "Louisiana Federal Itemized Deduction Screen",
  },

  laFederalMedicalDentalDeduction: {
    required:    false,
    type:        "number",
    label:       "Federal Schedule A Medical and Dental Deduction",
    min:         0,
  },

  laClaimedFederalEIC: {
    required:    false,
    type:        "boolean",
    label:       "Federal Earned Income Credit Claimed",
  },

  laFederalEICAmount: {
    required:    false,
    type:        "number",
    label:       "Federal Earned Income Credit Amount",
    min:         0,
  },

  laEstimatedTaxPayments: {
    required:    false,
    type:        "number",
    label:       "Louisiana Estimated Tax Payments",
    min:         0,
    default:     0,
  },

  laExtensionPayment: {
    required:    false,
    type:        "number",
    label:       "Louisiana Extension Payment",
    min:         0,
    default:     0,
  },

  laHasOtherSpecialItems: {
    required:    false,
    type:        "boolean",
    label:       "Louisiana Other State-Specific Items",
  },

  ncSpouseItemizes: {
    required:    false,
    type:        "boolean",
    label:       "North Carolina Spouse Itemizes Deductions",
  },

  gaUnbornDependents: {
    required:    false,
    type:        "integer",
    label:       "Georgia Unborn Dependents Eligible for State Exemption",
    min:         0,
    max:         20,
    default:     0,
  },

  kyFamilySize: {
    required:    false,
    type:        "integer",
    label:       "Kentucky Family Size",
    min:         1,
    max:         4,
  },

  kyItemizedDeductions: {
    required:    false,
    type:        "number",
    label:       "Kentucky Itemized Deductions",
    min:         0,
    default:     0,
  },

  kyTaxpayerRetirementIncome: {
    required:    false,
    type:        "number",
    label:       "Kentucky Taxpayer Retirement Income",
    min:         0,
    default:     0,
  },

  kySpouseRetirementIncome: {
    required:    false,
    type:        "number",
    label:       "Kentucky Spouse Retirement Income",
    min:         0,
    default:     0,
  },

  kySpecialPensionOverLimit: {
    required:    false,
    type:        "boolean",
    label:       "Kentucky Special Pension Over Limit",
  },

  kyHasOtherStateModifications: {
    required:    false,
    type:        "boolean",
    label:       "Kentucky Other State Modifications",
  },

  kyHasChildDependentCareCredit: {
    required:    false,
    type:        "boolean",
    label:       "Kentucky Child and Dependent Care Credit",
  },

  kyTaxpayerSpecialPersonalCredit: {
    required:    false,
    type:        "number",
    label:       "Kentucky Taxpayer Special Personal Credit",
    min:         0,
    max:         60,
    default:     0,
  },

  kySpouseSpecialPersonalCredit: {
    required:    false,
    type:        "number",
    label:       "Kentucky Spouse Special Personal Credit",
    min:         0,
    max:         60,
    default:     0,
  },

  msItemizedDeductions: {
    required:    false,
    type:        "number",
    label:       "Mississippi Itemized Deductions",
    min:         0,
    default:     0,
  },

  msExemptRetirementIncome: {
    required:    false,
    type:        "number",
    label:       "Mississippi Exempt Retirement or Social Security Income",
    min:         0,
    default:     0,
  },

  msTaxpayerBlind: {
    required:    false,
    type:        "boolean",
    label:       "Mississippi Taxpayer Blind",
  },

  msSpouseBlind: {
    required:    false,
    type:        "boolean",
    label:       "Mississippi Spouse Blind",
  },

  msSpouseShareOfMississippiAGI: {
    required:    false,
    type:        "number",
    label:       "Mississippi Spouse Share of Adjusted Gross Income",
    min:         0,
  },

  msHeadOfFamilyDependentLivedAllYear: {
    required:    false,
    type:        "boolean",
    label:       "Mississippi Head of Family Dependent Lived All Year",
  },

  msHasDependentCareCredit: {
    required:    false,
    type:        "boolean",
    label:       "Mississippi Dependent Care Credit Screen",
  },

  msHasOtherStateModifications: {
    required:    false,
    type:        "boolean",
    label:       "Mississippi Other State Modifications",
  },

  w2Income: {
    required:    true,
    type:        "number",
    label:       "W-2 Wages",
    min:         0,
    hint:        "Total from all W-2s, Box 1",
    default:     0,
  },

  w2SocialSecurityWages: {
    required:    false,
    type:        "number",
    label:       "W-2 Social Security Wages",
    min:         0,
    hint:        "Total from all W-2s, Box 3",
  },

  w2MedicareWages: {
    required:    false,
    type:        "number",
    label:       "W-2 Medicare Wages",
    min:         0,
    hint:        "Total from all W-2s, Box 5",
  },

  w2MedicareTaxWithheld: {
    required:    false,
    type:        "number",
    label:       "W-2 Medicare Tax Withheld",
    min:         0,
    hint:        "Total from all W-2s, Box 6",
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

businessMileageJanJun: {
  required: false,
  type: "number",
  label: "Business Mileage Jan. 1 through June 30",
  min: 0,
  default: 0,
},

businessMileageJulDec: {
  required: false,
  type: "number",
  label: "Business Mileage July 1 through Dec. 31",
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
  out.spouseAge = toInteger(raw.spouseAge);

  // Booleans
  out.isFullTimeStudent        = toBoolean(raw.isFullTimeStudent);
  out.canBeClaimedAsDependent  = toBoolean(raw.canBeClaimedAsDependent);
  out.alFullYearResident =
    raw.alFullYearResident === null ||
    raw.alFullYearResident === undefined ||
    String(raw.alFullYearResident).trim() === ""
      ? null
      : toBoolean(raw.alFullYearResident);

  out.alHeadOfFamilyConfirmed =
    raw.alHeadOfFamilyConfirmed === null ||
    raw.alHeadOfFamilyConfirmed === undefined ||
    String(raw.alHeadOfFamilyConfirmed).trim() === ""
      ? null
      : toBoolean(raw.alHeadOfFamilyConfirmed);

  out.alQualifyingDependents =
    raw.alQualifyingDependents === null ||
    raw.alQualifyingDependents === undefined ||
    String(raw.alQualifyingDependents).trim() === ""
      ? null
      : toInteger(raw.alQualifyingDependents);

  out.alItemizedDeductions =
    toNumber(raw.alItemizedDeductions) ?? 0;
  out.alExemptIncome =
    toNumber(raw.alExemptIncome) ?? 0;
  out.alFederalIncomeTaxDeduction =
    raw.alFederalIncomeTaxDeduction === null ||
    raw.alFederalIncomeTaxDeduction === undefined ||
    String(raw.alFederalIncomeTaxDeduction).trim() === ""
      ? null
      : toNumber(raw.alFederalIncomeTaxDeduction);
  out.alEstimatedTaxPayments =
    toNumber(raw.alEstimatedTaxPayments) ?? 0;

  out.alHasSpecialItems =
    raw.alHasSpecialItems === null ||
    raw.alHasSpecialItems === undefined ||
    String(raw.alHasSpecialItems).trim() === ""
      ? null
      : toBoolean(raw.alHasSpecialItems);

  out.inFullYearResident = raw.inFullYearResident === null || raw.inFullYearResident === undefined || String(raw.inFullYearResident).trim() === "" ? null : toBoolean(raw.inFullYearResident);
  out.inTotalAddbacks = raw.inTotalAddbacks === null || raw.inTotalAddbacks === undefined || String(raw.inTotalAddbacks).trim() === "" ? null : toNumber(raw.inTotalAddbacks);
  out.inTotalDeductions = raw.inTotalDeductions === null || raw.inTotalDeductions === undefined || String(raw.inTotalDeductions).trim() === "" ? null : toNumber(raw.inTotalDeductions);
  out.inAdditionalDependentChildCount = raw.inAdditionalDependentChildCount === null || raw.inAdditionalDependentChildCount === undefined || String(raw.inAdditionalDependentChildCount).trim() === "" ? null : toInteger(raw.inAdditionalDependentChildCount);
  out.inFirstYearAdditionalChildCount = raw.inFirstYearAdditionalChildCount === null || raw.inFirstYearAdditionalChildCount === undefined || String(raw.inFirstYearAdditionalChildCount).trim() === "" ? null : toInteger(raw.inFirstYearAdditionalChildCount);
  out.inAdoptedDependentCount = raw.inAdoptedDependentCount === null || raw.inAdoptedDependentCount === undefined || String(raw.inAdoptedDependentCount).trim() === "" ? null : toInteger(raw.inAdoptedDependentCount);
  out.inTaxpayerBlind = raw.inTaxpayerBlind === null || raw.inTaxpayerBlind === undefined || String(raw.inTaxpayerBlind).trim() === "" ? null : toBoolean(raw.inTaxpayerBlind);
  out.inSpouseBlind = raw.inSpouseBlind === null || raw.inSpouseBlind === undefined || String(raw.inSpouseBlind).trim() === "" ? null : toBoolean(raw.inSpouseBlind);
  out.inCountyTax = raw.inCountyTax === null || raw.inCountyTax === undefined || String(raw.inCountyTax).trim() === "" ? null : toNumber(raw.inCountyTax);
  out.inCountyWithheld = raw.inCountyWithheld === null || raw.inCountyWithheld === undefined || String(raw.inCountyWithheld).trim() === "" ? null : toNumber(raw.inCountyWithheld);
  out.inClaimedFederalEIC = raw.inClaimedFederalEIC === null || raw.inClaimedFederalEIC === undefined || String(raw.inClaimedFederalEIC).trim() === "" ? null : toBoolean(raw.inClaimedFederalEIC);
  out.inFederalEICAmount = toNumber(raw.inFederalEICAmount) ?? 0;
  out.inHasUseTax = raw.inHasUseTax === null || raw.inHasUseTax === undefined || String(raw.inHasUseTax).trim() === "" ? null : toBoolean(raw.inHasUseTax);
  out.inUseTax = toNumber(raw.inUseTax) ?? 0;
  out.inEstimatedAndExtensionPayments = toNumber(raw.inEstimatedAndExtensionPayments) ?? 0;
  out.inHasUnifiedTaxCreditForElderly = raw.inHasUnifiedTaxCreditForElderly === null || raw.inHasUnifiedTaxCreditForElderly === undefined || String(raw.inHasUnifiedTaxCreditForElderly).trim() === "" ? null : toBoolean(raw.inHasUnifiedTaxCreditForElderly);
  out.inHasOtherCredits = raw.inHasOtherCredits === null || raw.inHasOtherCredits === undefined || String(raw.inHasOtherCredits).trim() === "" ? null : toBoolean(raw.inHasOtherCredits);
  out.inHasOtherTaxesOrSpecialItems = raw.inHasOtherTaxesOrSpecialItems === null || raw.inHasOtherTaxesOrSpecialItems === undefined || String(raw.inHasOtherTaxesOrSpecialItems).trim() === "" ? null : toBoolean(raw.inHasOtherTaxesOrSpecialItems);

  out.ilFullYearResident = raw.ilFullYearResident === null || raw.ilFullYearResident === undefined || String(raw.ilFullYearResident).trim() === "" ? null : toBoolean(raw.ilFullYearResident);
  out.ilTotalAdditions = raw.ilTotalAdditions === null || raw.ilTotalAdditions === undefined || String(raw.ilTotalAdditions).trim() === "" ? null : toNumber(raw.ilTotalAdditions);
  out.ilRetirementSocialSecuritySubtraction = raw.ilRetirementSocialSecuritySubtraction === null || raw.ilRetirementSocialSecuritySubtraction === undefined || String(raw.ilRetirementSocialSecuritySubtraction).trim() === "" ? null : toNumber(raw.ilRetirementSocialSecuritySubtraction);
  out.ilIllinoisIncomeTaxOverpaymentSubtraction = raw.ilIllinoisIncomeTaxOverpaymentSubtraction === null || raw.ilIllinoisIncomeTaxOverpaymentSubtraction === undefined || String(raw.ilIllinoisIncomeTaxOverpaymentSubtraction).trim() === "" ? null : toNumber(raw.ilIllinoisIncomeTaxOverpaymentSubtraction);
  out.ilOtherSubtractions = raw.ilOtherSubtractions === null || raw.ilOtherSubtractions === undefined || String(raw.ilOtherSubtractions).trim() === "" ? null : toNumber(raw.ilOtherSubtractions);
  out.ilSpouseCanBeClaimedAsDependent = raw.ilSpouseCanBeClaimedAsDependent === null || raw.ilSpouseCanBeClaimedAsDependent === undefined || String(raw.ilSpouseCanBeClaimedAsDependent).trim() === "" ? null : toBoolean(raw.ilSpouseCanBeClaimedAsDependent);
  out.ilTaxpayerBlind = raw.ilTaxpayerBlind === null || raw.ilTaxpayerBlind === undefined || String(raw.ilTaxpayerBlind).trim() === "" ? null : toBoolean(raw.ilTaxpayerBlind);
  out.ilSpouseBlind = raw.ilSpouseBlind === null || raw.ilSpouseBlind === undefined || String(raw.ilSpouseBlind).trim() === "" ? null : toBoolean(raw.ilSpouseBlind);
  out.ilInvestmentCreditRecapture = raw.ilInvestmentCreditRecapture === null || raw.ilInvestmentCreditRecapture === undefined || String(raw.ilInvestmentCreditRecapture).trim() === "" ? null : toNumber(raw.ilInvestmentCreditRecapture);
  out.ilScheduleICRCredit = raw.ilScheduleICRCredit === null || raw.ilScheduleICRCredit === undefined || String(raw.ilScheduleICRCredit).trim() === "" ? null : toNumber(raw.ilScheduleICRCredit);
  out.ilSchedule1299CCredit = raw.ilSchedule1299CCredit === null || raw.ilSchedule1299CCredit === undefined || String(raw.ilSchedule1299CCredit).trim() === "" ? null : toNumber(raw.ilSchedule1299CCredit);
  out.ilHasOtherStateTaxCredit = raw.ilHasOtherStateTaxCredit === null || raw.ilHasOtherStateTaxCredit === undefined || String(raw.ilHasOtherStateTaxCredit).trim() === "" ? null : toBoolean(raw.ilHasOtherStateTaxCredit);
  out.ilHouseholdEmploymentTax = raw.ilHouseholdEmploymentTax === null || raw.ilHouseholdEmploymentTax === undefined || String(raw.ilHouseholdEmploymentTax).trim() === "" ? null : toNumber(raw.ilHouseholdEmploymentTax);
  out.ilUseTax = raw.ilUseTax === null || raw.ilUseTax === undefined || String(raw.ilUseTax).trim() === "" ? null : toNumber(raw.ilUseTax);
  out.ilHasCannabisGamingSurcharge = raw.ilHasCannabisGamingSurcharge === null || raw.ilHasCannabisGamingSurcharge === undefined || String(raw.ilHasCannabisGamingSurcharge).trim() === "" ? null : toBoolean(raw.ilHasCannabisGamingSurcharge);
  out.ilEstimatedPayments = raw.ilEstimatedPayments === null || raw.ilEstimatedPayments === undefined || String(raw.ilEstimatedPayments).trim() === "" ? null : toNumber(raw.ilEstimatedPayments);
  out.ilPassThroughWithholding = raw.ilPassThroughWithholding === null || raw.ilPassThroughWithholding === undefined || String(raw.ilPassThroughWithholding).trim() === "" ? null : toNumber(raw.ilPassThroughWithholding);
  out.ilPassThroughEntityTaxCredit = raw.ilPassThroughEntityTaxCredit === null || raw.ilPassThroughEntityTaxCredit === undefined || String(raw.ilPassThroughEntityTaxCredit).trim() === "" ? null : toNumber(raw.ilPassThroughEntityTaxCredit);
  out.ilClaimedFederalEITC = raw.ilClaimedFederalEITC === null || raw.ilClaimedFederalEITC === undefined || String(raw.ilClaimedFederalEITC).trim() === "" ? null : toBoolean(raw.ilClaimedFederalEITC);
  out.ilFederalEITCAmount = toNumber(raw.ilFederalEITCAmount) ?? 0;
  out.ilHasDependentChildUnder12 = raw.ilHasDependentChildUnder12 === null || raw.ilHasDependentChildUnder12 === undefined || String(raw.ilHasDependentChildUnder12).trim() === "" ? null : toBoolean(raw.ilHasDependentChildUnder12);
  out.ilNeedsExpandedEITCWorksheet = raw.ilNeedsExpandedEITCWorksheet === null || raw.ilNeedsExpandedEITCWorksheet === undefined || String(raw.ilNeedsExpandedEITCWorksheet).trim() === "" ? null : toBoolean(raw.ilNeedsExpandedEITCWorksheet);
  out.ilHasOtherSpecialItems = raw.ilHasOtherSpecialItems === null || raw.ilHasOtherSpecialItems === undefined || String(raw.ilHasOtherSpecialItems).trim() === "" ? null : toBoolean(raw.ilHasOtherSpecialItems);

  out.moFullYearResident = raw.moFullYearResident === null || raw.moFullYearResident === undefined || String(raw.moFullYearResident).trim() === "" ? null : toBoolean(raw.moFullYearResident);
  out.moTotalAdditions = raw.moTotalAdditions === null || raw.moTotalAdditions === undefined || String(raw.moTotalAdditions).trim() === "" ? null : toNumber(raw.moTotalAdditions);
  out.moTotalSubtractions = raw.moTotalSubtractions === null || raw.moTotalSubtractions === undefined || String(raw.moTotalSubtractions).trim() === "" ? null : toNumber(raw.moTotalSubtractions);
  out.moPrimaryAdjustedGrossIncome = raw.moPrimaryAdjustedGrossIncome === null || raw.moPrimaryAdjustedGrossIncome === undefined || String(raw.moPrimaryAdjustedGrossIncome).trim() === "" ? null : toNumber(raw.moPrimaryAdjustedGrossIncome);
  out.moSpouseAdjustedGrossIncome = raw.moSpouseAdjustedGrossIncome === null || raw.moSpouseAdjustedGrossIncome === undefined || String(raw.moSpouseAdjustedGrossIncome).trim() === "" ? null : toNumber(raw.moSpouseAdjustedGrossIncome);
  out.moPensionSocialSecurityExemption = raw.moPensionSocialSecurityExemption === null || raw.moPensionSocialSecurityExemption === undefined || String(raw.moPensionSocialSecurityExemption).trim() === "" ? null : toNumber(raw.moPensionSocialSecurityExemption);
  out.moFederalIncomeTaxDeduction = raw.moFederalIncomeTaxDeduction === null || raw.moFederalIncomeTaxDeduction === undefined || String(raw.moFederalIncomeTaxDeduction).trim() === "" ? null : toNumber(raw.moFederalIncomeTaxDeduction);
  out.moDeductionChoice = raw.moDeductionChoice === null || raw.moDeductionChoice === undefined ? "" : String(raw.moDeductionChoice).trim().toLowerCase();
  out.moItemizedDeductions = raw.moItemizedDeductions === null || raw.moItemizedDeductions === undefined || String(raw.moItemizedDeductions).trim() === "" ? null : toNumber(raw.moItemizedDeductions);
  out.moDependentEarnedIncome = raw.moDependentEarnedIncome === null || raw.moDependentEarnedIncome === undefined || String(raw.moDependentEarnedIncome).trim() === "" ? null : toNumber(raw.moDependentEarnedIncome);
  out.moTaxpayerBlind = raw.moTaxpayerBlind === null || raw.moTaxpayerBlind === undefined || String(raw.moTaxpayerBlind).trim() === "" ? null : toBoolean(raw.moTaxpayerBlind);
  out.moSpouseBlind = raw.moSpouseBlind === null || raw.moSpouseBlind === undefined || String(raw.moSpouseBlind).trim() === "" ? null : toBoolean(raw.moSpouseBlind);
  out.moFederallyRequiredToItemize = raw.moFederallyRequiredToItemize === null || raw.moFederallyRequiredToItemize === undefined || String(raw.moFederallyRequiredToItemize).trim() === "" ? null : toBoolean(raw.moFederallyRequiredToItemize);
  out.moHasQualifiedDisasterLossStandardDeductionIncrease = raw.moHasQualifiedDisasterLossStandardDeductionIncrease === null || raw.moHasQualifiedDisasterLossStandardDeductionIncrease === undefined || String(raw.moHasQualifiedDisasterLossStandardDeductionIncrease).trim() === "" ? null : toBoolean(raw.moHasQualifiedDisasterLossStandardDeductionIncrease);
  out.moOtherDeductions = raw.moOtherDeductions === null || raw.moOtherDeductions === undefined || String(raw.moOtherDeductions).trim() === "" ? null : toNumber(raw.moOtherDeductions);
  out.moClaimedFederalEIC = raw.moClaimedFederalEIC === null || raw.moClaimedFederalEIC === undefined || String(raw.moClaimedFederalEIC).trim() === "" ? null : toBoolean(raw.moClaimedFederalEIC);
  out.moFederalEICAmount = toNumber(raw.moFederalEICAmount) ?? 0;
  out.moWftcInvestmentIncomeOver4400 = raw.moWftcInvestmentIncomeOver4400 === null || raw.moWftcInvestmentIncomeOver4400 === undefined || String(raw.moWftcInvestmentIncomeOver4400).trim() === "" ? null : toBoolean(raw.moWftcInvestmentIncomeOver4400);
  out.moWftcChildInfoComplete = raw.moWftcChildInfoComplete === null || raw.moWftcChildInfoComplete === undefined || String(raw.moWftcChildInfoComplete).trim() === "" ? null : toBoolean(raw.moWftcChildInfoComplete);
  out.moEstimatedTaxPayments = toNumber(raw.moEstimatedTaxPayments) ?? 0;
  out.moOtherPayments = toNumber(raw.moOtherPayments) ?? 0;
  out.moExtensionPayments = toNumber(raw.moExtensionPayments) ?? 0;
  out.moHasEnterpriseZoneModification = raw.moHasEnterpriseZoneModification === null || raw.moHasEnterpriseZoneModification === undefined || String(raw.moHasEnterpriseZoneModification).trim() === "" ? null : toBoolean(raw.moHasEnterpriseZoneModification);
  out.moHasResidentCreditOtherState = raw.moHasResidentCreditOtherState === null || raw.moHasResidentCreditOtherState === undefined || String(raw.moHasResidentCreditOtherState).trim() === "" ? null : toBoolean(raw.moHasResidentCreditOtherState);
  out.moHasMiscOrPropertyTaxCredits = raw.moHasMiscOrPropertyTaxCredits === null || raw.moHasMiscOrPropertyTaxCredits === undefined || String(raw.moHasMiscOrPropertyTaxCredits).trim() === "" ? null : toBoolean(raw.moHasMiscOrPropertyTaxCredits);
  out.moHasOtherTaxOrSpecialItems = raw.moHasOtherTaxOrSpecialItems === null || raw.moHasOtherTaxOrSpecialItems === undefined || String(raw.moHasOtherTaxOrSpecialItems).trim() === "" ? null : toBoolean(raw.moHasOtherTaxOrSpecialItems);

  out.ohFullYearResident = raw.ohFullYearResident === null || raw.ohFullYearResident === undefined || String(raw.ohFullYearResident).trim() === "" ? null : toBoolean(raw.ohFullYearResident);
  out.ohTotalAdditions = raw.ohTotalAdditions === null || raw.ohTotalAdditions === undefined || String(raw.ohTotalAdditions).trim() === "" ? null : toNumber(raw.ohTotalAdditions);
  out.ohOtherDeductionsExcludingBusinessIncomeDeduction = raw.ohOtherDeductionsExcludingBusinessIncomeDeduction === null || raw.ohOtherDeductionsExcludingBusinessIncomeDeduction === undefined || String(raw.ohOtherDeductionsExcludingBusinessIncomeDeduction).trim() === "" ? null : toNumber(raw.ohOtherDeductionsExcludingBusinessIncomeDeduction);
  out.ohScheduleBusinessIncomeTotal = raw.ohScheduleBusinessIncomeTotal === null || raw.ohScheduleBusinessIncomeTotal === undefined || String(raw.ohScheduleBusinessIncomeTotal).trim() === "" ? null : toNumber(raw.ohScheduleBusinessIncomeTotal);
  out.ohSpouseCanBeClaimedAsDependent = raw.ohSpouseCanBeClaimedAsDependent === null || raw.ohSpouseCanBeClaimedAsDependent === undefined || String(raw.ohSpouseCanBeClaimedAsDependent).trim() === "" ? null : toBoolean(raw.ohSpouseCanBeClaimedAsDependent);
  out.ohNonrefundableCredits = raw.ohNonrefundableCredits === null || raw.ohNonrefundableCredits === undefined || String(raw.ohNonrefundableCredits).trim() === "" ? null : toNumber(raw.ohNonrefundableCredits);
  out.ohInterestPenalty = raw.ohInterestPenalty === null || raw.ohInterestPenalty === undefined || String(raw.ohInterestPenalty).trim() === "" ? null : toNumber(raw.ohInterestPenalty);
  out.ohUseTax = raw.ohUseTax === null || raw.ohUseTax === undefined || String(raw.ohUseTax).trim() === "" ? null : toNumber(raw.ohUseTax);
  out.ohEstimatedAndOtherPayments = raw.ohEstimatedAndOtherPayments === null || raw.ohEstimatedAndOtherPayments === undefined || String(raw.ohEstimatedAndOtherPayments).trim() === "" ? null : toNumber(raw.ohEstimatedAndOtherPayments);
  out.ohRefundableCredits = raw.ohRefundableCredits === null || raw.ohRefundableCredits === undefined || String(raw.ohRefundableCredits).trim() === "" ? null : toNumber(raw.ohRefundableCredits);
  out.ohHasSchoolDistrictIncomeTax = raw.ohHasSchoolDistrictIncomeTax === null || raw.ohHasSchoolDistrictIncomeTax === undefined || String(raw.ohHasSchoolDistrictIncomeTax).trim() === "" ? null : toBoolean(raw.ohHasSchoolDistrictIncomeTax);
  out.ohSchoolDistrictTax = raw.ohSchoolDistrictTax === null || raw.ohSchoolDistrictTax === undefined || String(raw.ohSchoolDistrictTax).trim() === "" ? null : toNumber(raw.ohSchoolDistrictTax);
  out.ohSchoolDistrictWithholding = raw.ohSchoolDistrictWithholding === null || raw.ohSchoolDistrictWithholding === undefined || String(raw.ohSchoolDistrictWithholding).trim() === "" ? null : toNumber(raw.ohSchoolDistrictWithholding);
  out.ohSchoolDistrictPayments = raw.ohSchoolDistrictPayments === null || raw.ohSchoolDistrictPayments === undefined || String(raw.ohSchoolDistrictPayments).trim() === "" ? null : toNumber(raw.ohSchoolDistrictPayments);
  out.ohHasResidencyCreditOrAllocation = raw.ohHasResidencyCreditOrAllocation === null || raw.ohHasResidencyCreditOrAllocation === undefined || String(raw.ohHasResidencyCreditOrAllocation).trim() === "" ? null : toBoolean(raw.ohHasResidencyCreditOrAllocation);
  out.ohHasAmendedNolOrSpecialItems = raw.ohHasAmendedNolOrSpecialItems === null || raw.ohHasAmendedNolOrSpecialItems === undefined || String(raw.ohHasAmendedNolOrSpecialItems).trim() === "" ? null : toBoolean(raw.ohHasAmendedNolOrSpecialItems);

  out.paFullYearResident = raw.paFullYearResident === null || raw.paFullYearResident === undefined || String(raw.paFullYearResident).trim() === "" ? null : toBoolean(raw.paFullYearResident);
  out.paNetCompensation = raw.paNetCompensation === null || raw.paNetCompensation === undefined || String(raw.paNetCompensation).trim() === "" ? null : toNumber(raw.paNetCompensation);
  out.paInterestIncome = raw.paInterestIncome === null || raw.paInterestIncome === undefined || String(raw.paInterestIncome).trim() === "" ? null : toNumber(raw.paInterestIncome);
  out.paDividendIncome = raw.paDividendIncome === null || raw.paDividendIncome === undefined || String(raw.paDividendIncome).trim() === "" ? null : toNumber(raw.paDividendIncome);
  out.paBusinessFarmIncomeLoss = raw.paBusinessFarmIncomeLoss === null || raw.paBusinessFarmIncomeLoss === undefined || String(raw.paBusinessFarmIncomeLoss).trim() === "" ? null : toNumber(raw.paBusinessFarmIncomeLoss);
  out.paPropertyGainLoss = raw.paPropertyGainLoss === null || raw.paPropertyGainLoss === undefined || String(raw.paPropertyGainLoss).trim() === "" ? null : toNumber(raw.paPropertyGainLoss);
  out.paRentRoyaltyIncomeLoss = raw.paRentRoyaltyIncomeLoss === null || raw.paRentRoyaltyIncomeLoss === undefined || String(raw.paRentRoyaltyIncomeLoss).trim() === "" ? null : toNumber(raw.paRentRoyaltyIncomeLoss);
  out.paEstateTrustIncome = raw.paEstateTrustIncome === null || raw.paEstateTrustIncome === undefined || String(raw.paEstateTrustIncome).trim() === "" ? null : toNumber(raw.paEstateTrustIncome);
  out.paGamblingLotteryWinnings = raw.paGamblingLotteryWinnings === null || raw.paGamblingLotteryWinnings === undefined || String(raw.paGamblingLotteryWinnings).trim() === "" ? null : toNumber(raw.paGamblingLotteryWinnings);
  out.paOtherDeductions = raw.paOtherDeductions === null || raw.paOtherDeductions === undefined || String(raw.paOtherDeductions).trim() === "" ? null : toNumber(raw.paOtherDeductions);
  out.paHasResidentCredit = raw.paHasResidentCredit === null || raw.paHasResidentCredit === undefined || String(raw.paHasResidentCredit).trim() === "" ? null : toBoolean(raw.paHasResidentCredit);
  out.paResidentCredit = raw.paResidentCredit === null || raw.paResidentCredit === undefined || String(raw.paResidentCredit).trim() === "" ? null : toNumber(raw.paResidentCredit);
  out.paClaimTaxForgiveness = raw.paClaimTaxForgiveness === null || raw.paClaimTaxForgiveness === undefined || String(raw.paClaimTaxForgiveness).trim() === "" ? null : toBoolean(raw.paClaimTaxForgiveness);
  out.paTaxForgivenessEligibilityIncome = raw.paTaxForgivenessEligibilityIncome === null || raw.paTaxForgivenessEligibilityIncome === undefined || String(raw.paTaxForgivenessEligibilityIncome).trim() === "" ? null : toNumber(raw.paTaxForgivenessEligibilityIncome);
  out.paTaxForgivenessDependentChildren = raw.paTaxForgivenessDependentChildren === null || raw.paTaxForgivenessDependentChildren === undefined || String(raw.paTaxForgivenessDependentChildren).trim() === "" ? null : toInteger(raw.paTaxForgivenessDependentChildren);
  out.paDependentClaimantEligibleTaxForgiveness = raw.paDependentClaimantEligibleTaxForgiveness === null || raw.paDependentClaimantEligibleTaxForgiveness === undefined || String(raw.paDependentClaimantEligibleTaxForgiveness).trim() === "" ? null : toBoolean(raw.paDependentClaimantEligibleTaxForgiveness);
  out.paHasChildDependentCareCredit = raw.paHasChildDependentCareCredit === null || raw.paHasChildDependentCareCredit === undefined || String(raw.paHasChildDependentCareCredit).trim() === "" ? null : toBoolean(raw.paHasChildDependentCareCredit);
  out.paChildDependentCareCredit = raw.paChildDependentCareCredit === null || raw.paChildDependentCareCredit === undefined || String(raw.paChildDependentCareCredit).trim() === "" ? null : toNumber(raw.paChildDependentCareCredit);
  out.paHasRestrictedScheduleOCCredits = raw.paHasRestrictedScheduleOCCredits === null || raw.paHasRestrictedScheduleOCCredits === undefined || String(raw.paHasRestrictedScheduleOCCredits).trim() === "" ? null : toBoolean(raw.paHasRestrictedScheduleOCCredits);
  out.paClaimedFederalEITC = raw.paClaimedFederalEITC === null || raw.paClaimedFederalEITC === undefined || String(raw.paClaimedFederalEITC).trim() === "" ? null : toBoolean(raw.paClaimedFederalEITC);
  out.paFederalEITCAmount = raw.paFederalEITCAmount === null || raw.paFederalEITCAmount === undefined || String(raw.paFederalEITCAmount).trim() === "" ? null : toNumber(raw.paFederalEITCAmount);
  out.paPriorYearCredit = raw.paPriorYearCredit === null || raw.paPriorYearCredit === undefined || String(raw.paPriorYearCredit).trim() === "" ? null : toNumber(raw.paPriorYearCredit);
  out.paEstimatedPayments = raw.paEstimatedPayments === null || raw.paEstimatedPayments === undefined || String(raw.paEstimatedPayments).trim() === "" ? null : toNumber(raw.paEstimatedPayments);
  out.paExtensionPayment = raw.paExtensionPayment === null || raw.paExtensionPayment === undefined || String(raw.paExtensionPayment).trim() === "" ? null : toNumber(raw.paExtensionPayment);
  out.paNonresidentWithholding = raw.paNonresidentWithholding === null || raw.paNonresidentWithholding === undefined || String(raw.paNonresidentWithholding).trim() === "" ? null : toNumber(raw.paNonresidentWithholding);
  out.paUseTax = raw.paUseTax === null || raw.paUseTax === undefined || String(raw.paUseTax).trim() === "" ? null : toNumber(raw.paUseTax);
  out.paPenaltiesInterest = raw.paPenaltiesInterest === null || raw.paPenaltiesInterest === undefined || String(raw.paPenaltiesInterest).trim() === "" ? null : toNumber(raw.paPenaltiesInterest);
  out.paHasLocalEarnedIncomeTax = raw.paHasLocalEarnedIncomeTax === null || raw.paHasLocalEarnedIncomeTax === undefined || String(raw.paHasLocalEarnedIncomeTax).trim() === "" ? null : toBoolean(raw.paHasLocalEarnedIncomeTax);
  out.paLocalEarnedIncomeTax = raw.paLocalEarnedIncomeTax === null || raw.paLocalEarnedIncomeTax === undefined || String(raw.paLocalEarnedIncomeTax).trim() === "" ? null : toNumber(raw.paLocalEarnedIncomeTax);
  out.paLocalEarnedIncomeWithholding = raw.paLocalEarnedIncomeWithholding === null || raw.paLocalEarnedIncomeWithholding === undefined || String(raw.paLocalEarnedIncomeWithholding).trim() === "" ? null : toNumber(raw.paLocalEarnedIncomeWithholding);
  out.paLocalEarnedIncomePayments = raw.paLocalEarnedIncomePayments === null || raw.paLocalEarnedIncomePayments === undefined || String(raw.paLocalEarnedIncomePayments).trim() === "" ? null : toNumber(raw.paLocalEarnedIncomePayments);
  out.paHasAmendedOrOtherSpecialItems = raw.paHasAmendedOrOtherSpecialItems === null || raw.paHasAmendedOrOtherSpecialItems === undefined || String(raw.paHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.paHasAmendedOrOtherSpecialItems);

  out.coFullYearResident = raw.coFullYearResident === null || raw.coFullYearResident === undefined || String(raw.coFullYearResident).trim() === "" ? null : toBoolean(raw.coFullYearResident);
  out.coAdditions = raw.coAdditions === null || raw.coAdditions === undefined || String(raw.coAdditions).trim() === "" ? null : toNumber(raw.coAdditions);
  out.coSubtractions = raw.coSubtractions === null || raw.coSubtractions === undefined || String(raw.coSubtractions).trim() === "" ? null : toNumber(raw.coSubtractions);
  out.coAlternativeMinimumTax = raw.coAlternativeMinimumTax === null || raw.coAlternativeMinimumTax === undefined || String(raw.coAlternativeMinimumTax).trim() === "" ? null : toNumber(raw.coAlternativeMinimumTax);
  out.coCreditRecapture = raw.coCreditRecapture === null || raw.coCreditRecapture === undefined || String(raw.coCreditRecapture).trim() === "" ? null : toNumber(raw.coCreditRecapture);
  out.coCreditRepayment = raw.coCreditRepayment === null || raw.coCreditRepayment === undefined || String(raw.coCreditRepayment).trim() === "" ? null : toNumber(raw.coCreditRepayment);
  out.coOtherNonrefundableCredits = raw.coOtherNonrefundableCredits === null || raw.coOtherNonrefundableCredits === undefined || String(raw.coOtherNonrefundableCredits).trim() === "" ? null : toNumber(raw.coOtherNonrefundableCredits);
  out.coChildTaxCredit = raw.coChildTaxCredit === null || raw.coChildTaxCredit === undefined || String(raw.coChildTaxCredit).trim() === "" ? null : toNumber(raw.coChildTaxCredit);
  out.coChildDependentCareCredit = raw.coChildDependentCareCredit === null || raw.coChildDependentCareCredit === undefined || String(raw.coChildDependentCareCredit).trim() === "" ? null : toNumber(raw.coChildDependentCareCredit);
  out.coFederalEITCAmount = raw.coFederalEITCAmount === null || raw.coFederalEITCAmount === undefined || String(raw.coFederalEITCAmount).trim() === "" ? null : toNumber(raw.coFederalEITCAmount);
  out.coOtherRefundableCredits = raw.coOtherRefundableCredits === null || raw.coOtherRefundableCredits === undefined || String(raw.coOtherRefundableCredits).trim() === "" ? null : toNumber(raw.coOtherRefundableCredits);
  out.coDirectRefundableCredits = raw.coDirectRefundableCredits === null || raw.coDirectRefundableCredits === undefined || String(raw.coDirectRefundableCredits).trim() === "" ? null : toNumber(raw.coDirectRefundableCredits);
  out.coOtherFormWithholding = raw.coOtherFormWithholding === null || raw.coOtherFormWithholding === undefined || String(raw.coOtherFormWithholding).trim() === "" ? null : toNumber(raw.coOtherFormWithholding);
  out.coPriorYearCarryforward = raw.coPriorYearCarryforward === null || raw.coPriorYearCarryforward === undefined || String(raw.coPriorYearCarryforward).trim() === "" ? null : toNumber(raw.coPriorYearCarryforward);
  out.coEstimatedPayments = raw.coEstimatedPayments === null || raw.coEstimatedPayments === undefined || String(raw.coEstimatedPayments).trim() === "" ? null : toNumber(raw.coEstimatedPayments);
  out.coExtensionPayment = raw.coExtensionPayment === null || raw.coExtensionPayment === undefined || String(raw.coExtensionPayment).trim() === "" ? null : toNumber(raw.coExtensionPayment);
  out.coOtherPrepayments = raw.coOtherPrepayments === null || raw.coOtherPrepayments === undefined || String(raw.coOtherPrepayments).trim() === "" ? null : toNumber(raw.coOtherPrepayments);
  out.coTaborRefund = raw.coTaborRefund === null || raw.coTaborRefund === undefined || String(raw.coTaborRefund).trim() === "" ? null : toNumber(raw.coTaborRefund);
  out.coDelinquentPenalty = raw.coDelinquentPenalty === null || raw.coDelinquentPenalty === undefined || String(raw.coDelinquentPenalty).trim() === "" ? null : toNumber(raw.coDelinquentPenalty);
  out.coDelinquentInterest = raw.coDelinquentInterest === null || raw.coDelinquentInterest === undefined || String(raw.coDelinquentInterest).trim() === "" ? null : toNumber(raw.coDelinquentInterest);
  out.coUnderpaymentPenalty = raw.coUnderpaymentPenalty === null || raw.coUnderpaymentPenalty === undefined || String(raw.coUnderpaymentPenalty).trim() === "" ? null : toNumber(raw.coUnderpaymentPenalty);
  out.coApplyToNextYear = raw.coApplyToNextYear === null || raw.coApplyToNextYear === undefined || String(raw.coApplyToNextYear).trim() === "" ? null : toNumber(raw.coApplyToNextYear);
  out.coVoluntaryContributions = raw.coVoluntaryContributions === null || raw.coVoluntaryContributions === undefined || String(raw.coVoluntaryContributions).trim() === "" ? null : toNumber(raw.coVoluntaryContributions);
  out.coHasOtherStateCredit = raw.coHasOtherStateCredit === null || raw.coHasOtherStateCredit === undefined || String(raw.coHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.coHasOtherStateCredit);
  out.coNeedsSpecialEITCFormTN = raw.coNeedsSpecialEITCFormTN === null || raw.coNeedsSpecialEITCFormTN === undefined || String(raw.coNeedsSpecialEITCFormTN).trim() === "" ? null : toBoolean(raw.coNeedsSpecialEITCFormTN);
  out.coHasAmendedOrOtherSpecialItems = raw.coHasAmendedOrOtherSpecialItems === null || raw.coHasAmendedOrOtherSpecialItems === undefined || String(raw.coHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.coHasAmendedOrOtherSpecialItems);

  out.utFullYearResident = raw.utFullYearResident === null || raw.utFullYearResident === undefined || String(raw.utFullYearResident).trim() === "" ? null : toBoolean(raw.utFullYearResident);
  out.utAdditions = raw.utAdditions === null || raw.utAdditions === undefined || String(raw.utAdditions).trim() === "" ? null : toNumber(raw.utAdditions);
  out.utStateTaxRefund = raw.utStateTaxRefund === null || raw.utStateTaxRefund === undefined || String(raw.utStateTaxRefund).trim() === "" ? null : toNumber(raw.utStateTaxRefund);
  out.utSubtractions = raw.utSubtractions === null || raw.utSubtractions === undefined || String(raw.utSubtractions).trim() === "" ? null : toNumber(raw.utSubtractions);
  out.utDependentExemptionCount = raw.utDependentExemptionCount === null || raw.utDependentExemptionCount === undefined || String(raw.utDependentExemptionCount).trim() === "" ? null : toInteger(raw.utDependentExemptionCount);
  out.utFederalDeductionLine12 = raw.utFederalDeductionLine12 === null || raw.utFederalDeductionLine12 === undefined || String(raw.utFederalDeductionLine12).trim() === "" ? null : toNumber(raw.utFederalDeductionLine12);
  out.utStateLocalIncomeTaxDeduction = raw.utStateLocalIncomeTaxDeduction === null || raw.utStateLocalIncomeTaxDeduction === undefined || String(raw.utStateLocalIncomeTaxDeduction).trim() === "" ? null : toNumber(raw.utStateLocalIncomeTaxDeduction);
  out.utFederalBaseStandardDeduction = raw.utFederalBaseStandardDeduction === null || raw.utFederalBaseStandardDeduction === undefined || String(raw.utFederalBaseStandardDeduction).trim() === "" ? null : toNumber(raw.utFederalBaseStandardDeduction);
  out.utMunicipalBondInterestAddition = raw.utMunicipalBondInterestAddition === null || raw.utMunicipalBondInterestAddition === undefined || String(raw.utMunicipalBondInterestAddition).trim() === "" ? null : toNumber(raw.utMunicipalBondInterestAddition);
  out.utFederalTaxExemptInterest = raw.utFederalTaxExemptInterest === null || raw.utFederalTaxExemptInterest === undefined || String(raw.utFederalTaxExemptInterest).trim() === "" ? null : toNumber(raw.utFederalTaxExemptInterest);
  out.utChildCreditQualifyingChildren = raw.utChildCreditQualifyingChildren === null || raw.utChildCreditQualifyingChildren === undefined || String(raw.utChildCreditQualifyingChildren).trim() === "" ? null : toInteger(raw.utChildCreditQualifyingChildren);
  out.utFederalEITCAmount = raw.utFederalEITCAmount === null || raw.utFederalEITCAmount === undefined || String(raw.utFederalEITCAmount).trim() === "" ? null : toNumber(raw.utFederalEITCAmount);
  out.utUtahW2Wages = raw.utUtahW2Wages === null || raw.utUtahW2Wages === undefined || String(raw.utUtahW2Wages).trim() === "" ? null : toNumber(raw.utUtahW2Wages);
  out.utOtherApportionableNonrefundableCredits = raw.utOtherApportionableNonrefundableCredits === null || raw.utOtherApportionableNonrefundableCredits === undefined || String(raw.utOtherApportionableNonrefundableCredits).trim() === "" ? null : toNumber(raw.utOtherApportionableNonrefundableCredits);
  out.utNonapportionableNonrefundableCredits = raw.utNonapportionableNonrefundableCredits === null || raw.utNonapportionableNonrefundableCredits === undefined || String(raw.utNonapportionableNonrefundableCredits).trim() === "" ? null : toNumber(raw.utNonapportionableNonrefundableCredits);
  out.utHasOtherStateCredit = raw.utHasOtherStateCredit === null || raw.utHasOtherStateCredit === undefined || String(raw.utHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.utHasOtherStateCredit);
  out.utVoluntaryContributions = raw.utVoluntaryContributions === null || raw.utVoluntaryContributions === undefined || String(raw.utVoluntaryContributions).trim() === "" ? null : toNumber(raw.utVoluntaryContributions);
  out.utLowIncomeHousingRecapture = raw.utLowIncomeHousingRecapture === null || raw.utLowIncomeHousingRecapture === undefined || String(raw.utLowIncomeHousingRecapture).trim() === "" ? null : toNumber(raw.utLowIncomeHousingRecapture);
  out.utUseTax = raw.utUseTax === null || raw.utUseTax === undefined || String(raw.utUseTax).trim() === "" ? null : toNumber(raw.utUseTax);
  out.utOtherWithholding = raw.utOtherWithholding === null || raw.utOtherWithholding === undefined || String(raw.utOtherWithholding).trim() === "" ? null : toNumber(raw.utOtherWithholding);
  out.utPrepayments = raw.utPrepayments === null || raw.utPrepayments === undefined || String(raw.utPrepayments).trim() === "" ? null : toNumber(raw.utPrepayments);
  out.utNonapportionableRefundableCredits = raw.utNonapportionableRefundableCredits === null || raw.utNonapportionableRefundableCredits === undefined || String(raw.utNonapportionableRefundableCredits).trim() === "" ? null : toNumber(raw.utNonapportionableRefundableCredits);
  out.utApportionableRefundableCredits = raw.utApportionableRefundableCredits === null || raw.utApportionableRefundableCredits === undefined || String(raw.utApportionableRefundableCredits).trim() === "" ? null : toNumber(raw.utApportionableRefundableCredits);
  out.utPenaltyInterest = raw.utPenaltyInterest === null || raw.utPenaltyInterest === undefined || String(raw.utPenaltyInterest).trim() === "" ? null : toNumber(raw.utPenaltyInterest);
  out.utRefundSubtractions = raw.utRefundSubtractions === null || raw.utRefundSubtractions === undefined || String(raw.utRefundSubtractions).trim() === "" ? null : toNumber(raw.utRefundSubtractions);
  out.utHasSpecialMarriedCoupleCalculation = raw.utHasSpecialMarriedCoupleCalculation === null || raw.utHasSpecialMarriedCoupleCalculation === undefined || String(raw.utHasSpecialMarriedCoupleCalculation).trim() === "" ? null : toBoolean(raw.utHasSpecialMarriedCoupleCalculation);
  out.utHasAmendedOrOtherSpecialItems = raw.utHasAmendedOrOtherSpecialItems === null || raw.utHasAmendedOrOtherSpecialItems === undefined || String(raw.utHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.utHasAmendedOrOtherSpecialItems);

  out.idFullYearResident = raw.idFullYearResident === null || raw.idFullYearResident === undefined || String(raw.idFullYearResident).trim() === "" ? null : toBoolean(raw.idFullYearResident);
  out.idMfsSpouseItemizes = raw.idMfsSpouseItemizes === null || raw.idMfsSpouseItemizes === undefined || String(raw.idMfsSpouseItemizes).trim() === "" ? null : toBoolean(raw.idMfsSpouseItemizes);
  out.idHasOtherStateCredit = raw.idHasOtherStateCredit === null || raw.idHasOtherStateCredit === undefined || String(raw.idHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.idHasOtherStateCredit);
  out.idHasNolOrCarryback = raw.idHasNolOrCarryback === null || raw.idHasNolOrCarryback === undefined || String(raw.idHasNolOrCarryback).trim() === "" ? null : toBoolean(raw.idHasNolOrCarryback);
  out.idHasClaimOfRightCase = raw.idHasClaimOfRightCase === null || raw.idHasClaimOfRightCase === undefined || String(raw.idHasClaimOfRightCase).trim() === "" ? null : toBoolean(raw.idHasClaimOfRightCase);
  out.idHasAmendedOrOtherSpecialItems = raw.idHasAmendedOrOtherSpecialItems === null || raw.idHasAmendedOrOtherSpecialItems === undefined || String(raw.idHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.idHasAmendedOrOtherSpecialItems);
  out.idAdditions = raw.idAdditions === null || raw.idAdditions === undefined || String(raw.idAdditions).trim() === "" ? null : toNumber(raw.idAdditions);
  out.idSubtractions = raw.idSubtractions === null || raw.idSubtractions === undefined || String(raw.idSubtractions).trim() === "" ? null : toNumber(raw.idSubtractions);
  out.idItemizedDeduction = raw.idItemizedDeduction === null || raw.idItemizedDeduction === undefined || String(raw.idItemizedDeduction).trim() === "" ? null : toNumber(raw.idItemizedDeduction);
  out.idStandardDeduction = raw.idStandardDeduction === null || raw.idStandardDeduction === undefined || String(raw.idStandardDeduction).trim() === "" ? null : toNumber(raw.idStandardDeduction);
  out.idFederalLine13Deductions = raw.idFederalLine13Deductions === null || raw.idFederalLine13Deductions === undefined || String(raw.idFederalLine13Deductions).trim() === "" ? null : toNumber(raw.idFederalLine13Deductions);
  out.idChildCreditQualifyingChildren = raw.idChildCreditQualifyingChildren === null || raw.idChildCreditQualifyingChildren === undefined || String(raw.idChildCreditQualifyingChildren).trim() === "" ? null : toInteger(raw.idChildCreditQualifyingChildren);
  out.idForm39rCredits = raw.idForm39rCredits === null || raw.idForm39rCredits === undefined || String(raw.idForm39rCredits).trim() === "" ? null : toNumber(raw.idForm39rCredits);
  out.idBusinessIncomeTaxCredits = raw.idBusinessIncomeTaxCredits === null || raw.idBusinessIncomeTaxCredits === undefined || String(raw.idBusinessIncomeTaxCredits).trim() === "" ? null : toNumber(raw.idBusinessIncomeTaxCredits);
  out.idFuelsUseTax = raw.idFuelsUseTax === null || raw.idFuelsUseTax === undefined || String(raw.idFuelsUseTax).trim() === "" ? null : toNumber(raw.idFuelsUseTax);
  out.idSalesUseTax = raw.idSalesUseTax === null || raw.idSalesUseTax === undefined || String(raw.idSalesUseTax).trim() === "" ? null : toNumber(raw.idSalesUseTax);
  out.idIncomeTaxCreditRecapture = raw.idIncomeTaxCreditRecapture === null || raw.idIncomeTaxCreditRecapture === undefined || String(raw.idIncomeTaxCreditRecapture).trim() === "" ? null : toNumber(raw.idIncomeTaxCreditRecapture);
  out.idQieRecapture = raw.idQieRecapture === null || raw.idQieRecapture === undefined || String(raw.idQieRecapture).trim() === "" ? null : toNumber(raw.idQieRecapture);
  out.idPermanentBuildingFundTax = raw.idPermanentBuildingFundTax === null || raw.idPermanentBuildingFundTax === undefined || String(raw.idPermanentBuildingFundTax).trim() === "" ? null : toNumber(raw.idPermanentBuildingFundTax);
  out.idDonations = raw.idDonations === null || raw.idDonations === undefined || String(raw.idDonations).trim() === "" ? null : toNumber(raw.idDonations);
  out.idParentalChoiceTaxCredit = raw.idParentalChoiceTaxCredit === null || raw.idParentalChoiceTaxCredit === undefined || String(raw.idParentalChoiceTaxCredit).trim() === "" ? null : toNumber(raw.idParentalChoiceTaxCredit);
  out.idFoodTaxCredit = raw.idFoodTaxCredit === null || raw.idFoodTaxCredit === undefined || String(raw.idFoodTaxCredit).trim() === "" ? null : toNumber(raw.idFoodTaxCredit);
  out.idHomeFamilyCredit = raw.idHomeFamilyCredit === null || raw.idHomeFamilyCredit === undefined || String(raw.idHomeFamilyCredit).trim() === "" ? null : toNumber(raw.idHomeFamilyCredit);
  out.idFuelsTaxRefund = raw.idFuelsTaxRefund === null || raw.idFuelsTaxRefund === undefined || String(raw.idFuelsTaxRefund).trim() === "" ? null : toNumber(raw.idFuelsTaxRefund);
  out.idOtherWithholding = raw.idOtherWithholding === null || raw.idOtherWithholding === undefined || String(raw.idOtherWithholding).trim() === "" ? null : toNumber(raw.idOtherWithholding);
  out.idEstimatedPayments = raw.idEstimatedPayments === null || raw.idEstimatedPayments === undefined || String(raw.idEstimatedPayments).trim() === "" ? null : toNumber(raw.idEstimatedPayments);
  out.idEntityPaidWithheldAbe = raw.idEntityPaidWithheldAbe === null || raw.idEntityPaidWithheldAbe === undefined || String(raw.idEntityPaidWithheldAbe).trim() === "" ? null : toNumber(raw.idEntityPaidWithheldAbe);
  out.idTaxReimbursementIncentiveCredit = raw.idTaxReimbursementIncentiveCredit === null || raw.idTaxReimbursementIncentiveCredit === undefined || String(raw.idTaxReimbursementIncentiveCredit).trim() === "" ? null : toNumber(raw.idTaxReimbursementIncentiveCredit);
  out.idPenaltyInterest = raw.idPenaltyInterest === null || raw.idPenaltyInterest === undefined || String(raw.idPenaltyInterest).trim() === "" ? null : toNumber(raw.idPenaltyInterest);
  out.idPriorYearNonrefundableCredit = raw.idPriorYearNonrefundableCredit === null || raw.idPriorYearNonrefundableCredit === undefined || String(raw.idPriorYearNonrefundableCredit).trim() === "" ? null : toNumber(raw.idPriorYearNonrefundableCredit);
  out.idRefundApplyToNextYear = raw.idRefundApplyToNextYear === null || raw.idRefundApplyToNextYear === undefined || String(raw.idRefundApplyToNextYear).trim() === "" ? null : toNumber(raw.idRefundApplyToNextYear);

  out.mtFullYearResident = raw.mtFullYearResident === null || raw.mtFullYearResident === undefined || String(raw.mtFullYearResident).trim() === "" ? null : toBoolean(raw.mtFullYearResident);
  out.mtFederalDeductionLine2 = raw.mtFederalDeductionLine2 === null || raw.mtFederalDeductionLine2 === undefined || String(raw.mtFederalDeductionLine2).trim() === "" ? null : toNumber(raw.mtFederalDeductionLine2);
  out.mtAdditions = raw.mtAdditions === null || raw.mtAdditions === undefined || String(raw.mtAdditions).trim() === "" ? null : toNumber(raw.mtAdditions);
  out.mtSubtractions = raw.mtSubtractions === null || raw.mtSubtractions === undefined || String(raw.mtSubtractions).trim() === "" ? null : toNumber(raw.mtSubtractions);
  out.mtNetLongTermCapitalGains = raw.mtNetLongTermCapitalGains === null || raw.mtNetLongTermCapitalGains === undefined || String(raw.mtNetLongTermCapitalGains).trim() === "" ? null : toNumber(raw.mtNetLongTermCapitalGains);
  out.mtOtherNonrefundableCredits = raw.mtOtherNonrefundableCredits === null || raw.mtOtherNonrefundableCredits === undefined || String(raw.mtOtherNonrefundableCredits).trim() === "" ? null : toNumber(raw.mtOtherNonrefundableCredits);
  out.mtOtherWithholdingAndPteCredits = raw.mtOtherWithholdingAndPteCredits === null || raw.mtOtherWithholdingAndPteCredits === undefined || String(raw.mtOtherWithholdingAndPteCredits).trim() === "" ? null : toNumber(raw.mtOtherWithholdingAndPteCredits);
  out.mtEstimatedPayments = raw.mtEstimatedPayments === null || raw.mtEstimatedPayments === undefined || String(raw.mtEstimatedPayments).trim() === "" ? null : toNumber(raw.mtEstimatedPayments);
  out.mtPriorYearOverpayment = raw.mtPriorYearOverpayment === null || raw.mtPriorYearOverpayment === undefined || String(raw.mtPriorYearOverpayment).trim() === "" ? null : toNumber(raw.mtPriorYearOverpayment);
  out.mtExtensionPayment = raw.mtExtensionPayment === null || raw.mtExtensionPayment === undefined || String(raw.mtExtensionPayment).trim() === "" ? null : toNumber(raw.mtExtensionPayment);
  out.mtFederalEITCAmount = raw.mtFederalEITCAmount === null || raw.mtFederalEITCAmount === undefined || String(raw.mtFederalEITCAmount).trim() === "" ? null : toNumber(raw.mtFederalEITCAmount);
  out.mtElderlyHomeownerRenterCredit = raw.mtElderlyHomeownerRenterCredit === null || raw.mtElderlyHomeownerRenterCredit === undefined || String(raw.mtElderlyHomeownerRenterCredit).trim() === "" ? null : toNumber(raw.mtElderlyHomeownerRenterCredit);
  out.mtOtherRefundableCredits = raw.mtOtherRefundableCredits === null || raw.mtOtherRefundableCredits === undefined || String(raw.mtOtherRefundableCredits).trim() === "" ? null : toNumber(raw.mtOtherRefundableCredits);
  out.mtScheduleIvOtherTaxes = raw.mtScheduleIvOtherTaxes === null || raw.mtScheduleIvOtherTaxes === undefined || String(raw.mtScheduleIvOtherTaxes).trim() === "" ? null : toNumber(raw.mtScheduleIvOtherTaxes);
  out.mtRefundApplyToNextYear = raw.mtRefundApplyToNextYear === null || raw.mtRefundApplyToNextYear === undefined || String(raw.mtRefundApplyToNextYear).trim() === "" ? null : toNumber(raw.mtRefundApplyToNextYear);
  out.mtRefund529Deposit = raw.mtRefund529Deposit === null || raw.mtRefund529Deposit === undefined || String(raw.mtRefund529Deposit).trim() === "" ? null : toNumber(raw.mtRefund529Deposit);
  out.mtHasOtherStateCredit = raw.mtHasOtherStateCredit === null || raw.mtHasOtherStateCredit === undefined || String(raw.mtHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.mtHasOtherStateCredit);
  out.mtHasEitcReductionCase = raw.mtHasEitcReductionCase === null || raw.mtHasEitcReductionCase === undefined || String(raw.mtHasEitcReductionCase).trim() === "" ? null : toBoolean(raw.mtHasEitcReductionCase);
  out.mtHasNolOrLossCarryforward = raw.mtHasNolOrLossCarryforward === null || raw.mtHasNolOrLossCarryforward === undefined || String(raw.mtHasNolOrLossCarryforward).trim() === "" ? null : toBoolean(raw.mtHasNolOrLossCarryforward);
  out.mtHasAmendedOrOtherSpecialItems = raw.mtHasAmendedOrOtherSpecialItems === null || raw.mtHasAmendedOrOtherSpecialItems === undefined || String(raw.mtHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.mtHasAmendedOrOtherSpecialItems);

  out.ndFullYearResident = raw.ndFullYearResident === null || raw.ndFullYearResident === undefined || String(raw.ndFullYearResident).trim() === "" ? null : toBoolean(raw.ndFullYearResident);
  out.ndFederalTaxableIncome = raw.ndFederalTaxableIncome === null || raw.ndFederalTaxableIncome === undefined || String(raw.ndFederalTaxableIncome).trim() === "" ? null : toNumber(raw.ndFederalTaxableIncome);
  out.ndContributionAdjustment = raw.ndContributionAdjustment === null || raw.ndContributionAdjustment === undefined || String(raw.ndContributionAdjustment).trim() === "" ? null : toNumber(raw.ndContributionAdjustment);
  out.ndOtherAdditions = raw.ndOtherAdditions === null || raw.ndOtherAdditions === undefined || String(raw.ndOtherAdditions).trim() === "" ? null : toNumber(raw.ndOtherAdditions);
  out.ndUsObligationInterest = raw.ndUsObligationInterest === null || raw.ndUsObligationInterest === undefined || String(raw.ndUsObligationInterest).trim() === "" ? null : toNumber(raw.ndUsObligationInterest);
  out.ndNetLongTermCapitalGainExclusion = raw.ndNetLongTermCapitalGainExclusion === null || raw.ndNetLongTermCapitalGainExclusion === undefined || String(raw.ndNetLongTermCapitalGainExclusion).trim() === "" ? null : toNumber(raw.ndNetLongTermCapitalGainExclusion);
  out.ndNativeAmericanExemptIncome = raw.ndNativeAmericanExemptIncome === null || raw.ndNativeAmericanExemptIncome === undefined || String(raw.ndNativeAmericanExemptIncome).trim() === "" ? null : toNumber(raw.ndNativeAmericanExemptIncome);
  out.ndRailroadBenefits = raw.ndRailroadBenefits === null || raw.ndRailroadBenefits === undefined || String(raw.ndRailroadBenefits).trim() === "" ? null : toNumber(raw.ndRailroadBenefits);
  out.ndPeaceOfficerRetirementExclusion = raw.ndPeaceOfficerRetirementExclusion === null || raw.ndPeaceOfficerRetirementExclusion === undefined || String(raw.ndPeaceOfficerRetirementExclusion).trim() === "" ? null : toNumber(raw.ndPeaceOfficerRetirementExclusion);
  out.ndMilitaryPayExclusion = raw.ndMilitaryPayExclusion === null || raw.ndMilitaryPayExclusion === undefined || String(raw.ndMilitaryPayExclusion).trim() === "" ? null : toNumber(raw.ndMilitaryPayExclusion);
  out.ndCollegeSaveContribution = raw.ndCollegeSaveContribution === null || raw.ndCollegeSaveContribution === undefined || String(raw.ndCollegeSaveContribution).trim() === "" ? null : toNumber(raw.ndCollegeSaveContribution);
  out.ndQualifiedDividends = raw.ndQualifiedDividends === null || raw.ndQualifiedDividends === undefined || String(raw.ndQualifiedDividends).trim() === "" ? null : toNumber(raw.ndQualifiedDividends);
  out.ndMilitaryRetirementExclusion = raw.ndMilitaryRetirementExclusion === null || raw.ndMilitaryRetirementExclusion === undefined || String(raw.ndMilitaryRetirementExclusion).trim() === "" ? null : toNumber(raw.ndMilitaryRetirementExclusion);
  out.ndSocialSecurityExclusion = raw.ndSocialSecurityExclusion === null || raw.ndSocialSecurityExclusion === undefined || String(raw.ndSocialSecurityExclusion).trim() === "" ? null : toNumber(raw.ndSocialSecurityExclusion);
  out.ndOtherSubtractions = raw.ndOtherSubtractions === null || raw.ndOtherSubtractions === undefined || String(raw.ndOtherSubtractions).trim() === "" ? null : toNumber(raw.ndOtherSubtractions);
  out.ndTaxpayerQualifiedIncome = raw.ndTaxpayerQualifiedIncome === null || raw.ndTaxpayerQualifiedIncome === undefined || String(raw.ndTaxpayerQualifiedIncome).trim() === "" ? null : toNumber(raw.ndTaxpayerQualifiedIncome);
  out.ndSpouseQualifiedIncome = raw.ndSpouseQualifiedIncome === null || raw.ndSpouseQualifiedIncome === undefined || String(raw.ndSpouseQualifiedIncome).trim() === "" ? null : toNumber(raw.ndSpouseQualifiedIncome);
  out.ndOtherCredits = raw.ndOtherCredits === null || raw.ndOtherCredits === undefined || String(raw.ndOtherCredits).trim() === "" ? null : toNumber(raw.ndOtherCredits);
  out.ndOtherWithholding = raw.ndOtherWithholding === null || raw.ndOtherWithholding === undefined || String(raw.ndOtherWithholding).trim() === "" ? null : toNumber(raw.ndOtherWithholding);
  out.ndEstimatedTaxPayment = raw.ndEstimatedTaxPayment === null || raw.ndEstimatedTaxPayment === undefined || String(raw.ndEstimatedTaxPayment).trim() === "" ? null : toNumber(raw.ndEstimatedTaxPayment);
  out.ndRefundApplyNextYear = raw.ndRefundApplyNextYear === null || raw.ndRefundApplyNextYear === undefined || String(raw.ndRefundApplyNextYear).trim() === "" ? null : toNumber(raw.ndRefundApplyNextYear);
  out.ndRefundContributions = raw.ndRefundContributions === null || raw.ndRefundContributions === undefined || String(raw.ndRefundContributions).trim() === "" ? null : toNumber(raw.ndRefundContributions);
  out.ndPenaltyInterest = raw.ndPenaltyInterest === null || raw.ndPenaltyInterest === undefined || String(raw.ndPenaltyInterest).trim() === "" ? null : toNumber(raw.ndPenaltyInterest);
  out.ndBalanceDueContributions = raw.ndBalanceDueContributions === null || raw.ndBalanceDueContributions === undefined || String(raw.ndBalanceDueContributions).trim() === "" ? null : toNumber(raw.ndBalanceDueContributions);
  out.ndUnderpaymentInterest = raw.ndUnderpaymentInterest === null || raw.ndUnderpaymentInterest === undefined || String(raw.ndUnderpaymentInterest).trim() === "" ? null : toNumber(raw.ndUnderpaymentInterest);
  out.ndHasOtherStateCredit = raw.ndHasOtherStateCredit === null || raw.ndHasOtherStateCredit === undefined || String(raw.ndHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.ndHasOtherStateCredit);
  out.ndHasFarmIncomeAveraging = raw.ndHasFarmIncomeAveraging === null || raw.ndHasFarmIncomeAveraging === undefined || String(raw.ndHasFarmIncomeAveraging).trim() === "" ? null : toBoolean(raw.ndHasFarmIncomeAveraging);
  out.ndHasSoldResearchCredit = raw.ndHasSoldResearchCredit === null || raw.ndHasSoldResearchCredit === undefined || String(raw.ndHasSoldResearchCredit).trim() === "" ? null : toBoolean(raw.ndHasSoldResearchCredit);
  out.ndHasAmendedNolOrOtherSpecialItems = raw.ndHasAmendedNolOrOtherSpecialItems === null || raw.ndHasAmendedNolOrOtherSpecialItems === undefined || String(raw.ndHasAmendedNolOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.ndHasAmendedNolOrOtherSpecialItems);

  out.nmFullYearResident = raw.nmFullYearResident === null || raw.nmFullYearResident === undefined || String(raw.nmFullYearResident).trim() === "" ? null : toBoolean(raw.nmFullYearResident);
  out.nmFederalDeductionLine12 = raw.nmFederalDeductionLine12 === null || raw.nmFederalDeductionLine12 === undefined || String(raw.nmFederalDeductionLine12).trim() === "" ? null : toNumber(raw.nmFederalDeductionLine12);
  out.nmStateLocalIncomeTaxAddback = raw.nmStateLocalIncomeTaxAddback === null || raw.nmStateLocalIncomeTaxAddback === undefined || String(raw.nmStateLocalIncomeTaxAddback).trim() === "" ? null : toNumber(raw.nmStateLocalIncomeTaxAddback);
  out.nmPitAdjAdditions = raw.nmPitAdjAdditions === null || raw.nmPitAdjAdditions === undefined || String(raw.nmPitAdjAdditions).trim() === "" ? null : toNumber(raw.nmPitAdjAdditions);
  out.nmPitAdjDeductions = raw.nmPitAdjDeductions === null || raw.nmPitAdjDeductions === undefined || String(raw.nmPitAdjDeductions).trim() === "" ? null : toNumber(raw.nmPitAdjDeductions);
  out.nmSpouseCanBeClaimedAsDependent = raw.nmSpouseCanBeClaimedAsDependent === null || raw.nmSpouseCanBeClaimedAsDependent === undefined || String(raw.nmSpouseCanBeClaimedAsDependent).trim() === "" ? null : toBoolean(raw.nmSpouseCanBeClaimedAsDependent);
  out.nmMfsCommunityPropertyAllocated = raw.nmMfsCommunityPropertyAllocated === null || raw.nmMfsCommunityPropertyAllocated === undefined || String(raw.nmMfsCommunityPropertyAllocated).trim() === "" ? null : toBoolean(raw.nmMfsCommunityPropertyAllocated);
  out.nmPitCrNonrefundableCredits = raw.nmPitCrNonrefundableCredits === null || raw.nmPitCrNonrefundableCredits === undefined || String(raw.nmPitCrNonrefundableCredits).trim() === "" ? null : toNumber(raw.nmPitCrNonrefundableCredits);
  out.nmPitRcTotalCredits = raw.nmPitRcTotalCredits === null || raw.nmPitRcTotalCredits === undefined || String(raw.nmPitRcTotalCredits).trim() === "" ? null : toNumber(raw.nmPitRcTotalCredits);
  out.nmFederalEITCAmount = raw.nmFederalEITCAmount === null || raw.nmFederalEITCAmount === undefined || String(raw.nmFederalEITCAmount).trim() === "" ? null : toNumber(raw.nmFederalEITCAmount);
  out.nmWftcExpansionCase = raw.nmWftcExpansionCase === null || raw.nmWftcExpansionCase === undefined || String(raw.nmWftcExpansionCase).trim() === "" ? null : toBoolean(raw.nmWftcExpansionCase);
  out.nmPitCrRefundableCredits = raw.nmPitCrRefundableCredits === null || raw.nmPitCrRefundableCredits === undefined || String(raw.nmPitCrRefundableCredits).trim() === "" ? null : toNumber(raw.nmPitCrRefundableCredits);
  out.nmOtherLine27Withholding = raw.nmOtherLine27Withholding === null || raw.nmOtherLine27Withholding === undefined || String(raw.nmOtherLine27Withholding).trim() === "" ? null : toNumber(raw.nmOtherLine27Withholding);
  out.nmOilGasWithholding = raw.nmOilGasWithholding === null || raw.nmOilGasWithholding === undefined || String(raw.nmOilGasWithholding).trim() === "" ? null : toNumber(raw.nmOilGasWithholding);
  out.nmPteWithholdingEntityTax = raw.nmPteWithholdingEntityTax === null || raw.nmPteWithholdingEntityTax === undefined || String(raw.nmPteWithholdingEntityTax).trim() === "" ? null : toNumber(raw.nmPteWithholdingEntityTax);
  out.nmEstimatedPayments = raw.nmEstimatedPayments === null || raw.nmEstimatedPayments === undefined || String(raw.nmEstimatedPayments).trim() === "" ? null : toNumber(raw.nmEstimatedPayments);
  out.nmOtherPayments = raw.nmOtherPayments === null || raw.nmOtherPayments === undefined || String(raw.nmOtherPayments).trim() === "" ? null : toNumber(raw.nmOtherPayments);
  out.nmUnderpaymentPenalty = raw.nmUnderpaymentPenalty === null || raw.nmUnderpaymentPenalty === undefined || String(raw.nmUnderpaymentPenalty).trim() === "" ? null : toNumber(raw.nmUnderpaymentPenalty);
  out.nmLatePenalty = raw.nmLatePenalty === null || raw.nmLatePenalty === undefined || String(raw.nmLatePenalty).trim() === "" ? null : toNumber(raw.nmLatePenalty);
  out.nmInterest = raw.nmInterest === null || raw.nmInterest === undefined || String(raw.nmInterest).trim() === "" ? null : toNumber(raw.nmInterest);
  out.nmRefundContributions = raw.nmRefundContributions === null || raw.nmRefundContributions === undefined || String(raw.nmRefundContributions).trim() === "" ? null : toNumber(raw.nmRefundContributions);
  out.nmApplyToNextYear = raw.nmApplyToNextYear === null || raw.nmApplyToNextYear === undefined || String(raw.nmApplyToNextYear).trim() === "" ? null : toNumber(raw.nmApplyToNextYear);
  out.nmHasPitBAllocation = raw.nmHasPitBAllocation === null || raw.nmHasPitBAllocation === undefined || String(raw.nmHasPitBAllocation).trim() === "" ? null : toBoolean(raw.nmHasPitBAllocation);
  out.nmHasScheduleCCAlternativeTax = raw.nmHasScheduleCCAlternativeTax === null || raw.nmHasScheduleCCAlternativeTax === undefined || String(raw.nmHasScheduleCCAlternativeTax).trim() === "" ? null : toBoolean(raw.nmHasScheduleCCAlternativeTax);
  out.nmHasLumpSumDistributionTax = raw.nmHasLumpSumDistributionTax === null || raw.nmHasLumpSumDistributionTax === undefined || String(raw.nmHasLumpSumDistributionTax).trim() === "" ? null : toBoolean(raw.nmHasLumpSumDistributionTax);
  out.nmHasOtherStateCredit = raw.nmHasOtherStateCredit === null || raw.nmHasOtherStateCredit === undefined || String(raw.nmHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.nmHasOtherStateCredit);
  out.nmHasAmendedOrOtherSpecialItems = raw.nmHasAmendedOrOtherSpecialItems === null || raw.nmHasAmendedOrOtherSpecialItems === undefined || String(raw.nmHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.nmHasAmendedOrOtherSpecialItems);

  out.caFullYearResident = raw.caFullYearResident === null || raw.caFullYearResident === undefined || String(raw.caFullYearResident).trim() === "" ? null : toBoolean(raw.caFullYearResident);
  out.caFilingStatusMatchesFederal = raw.caFilingStatusMatchesFederal === null || raw.caFilingStatusMatchesFederal === undefined || String(raw.caFilingStatusMatchesFederal).trim() === "" ? null : toBoolean(raw.caFilingStatusMatchesFederal);
  out.caIsRegisteredDomesticPartner = raw.caIsRegisteredDomesticPartner === null || raw.caIsRegisteredDomesticPartner === undefined || String(raw.caIsRegisteredDomesticPartner).trim() === "" ? null : toBoolean(raw.caIsRegisteredDomesticPartner);
  out.caScheduleCASubtractions = raw.caScheduleCASubtractions === null || raw.caScheduleCASubtractions === undefined || String(raw.caScheduleCASubtractions).trim() === "" ? null : toNumber(raw.caScheduleCASubtractions);
  out.caScheduleCAAdditions = raw.caScheduleCAAdditions === null || raw.caScheduleCAAdditions === undefined || String(raw.caScheduleCAAdditions).trim() === "" ? null : toNumber(raw.caScheduleCAAdditions);
  out.caDeductionMethod = raw.caDeductionMethod === null || raw.caDeductionMethod === undefined || String(raw.caDeductionMethod).trim() === "" ? "" : String(raw.caDeductionMethod).trim().toLowerCase();
  out.caDeductionAmount = raw.caDeductionAmount === null || raw.caDeductionAmount === undefined || String(raw.caDeductionAmount).trim() === "" ? null : toNumber(raw.caDeductionAmount);
  out.caPersonalExemptionCount = raw.caPersonalExemptionCount === null || raw.caPersonalExemptionCount === undefined || String(raw.caPersonalExemptionCount).trim() === "" ? null : toNumber(raw.caPersonalExemptionCount);
  out.caBlindExemptionCount = raw.caBlindExemptionCount === null || raw.caBlindExemptionCount === undefined || String(raw.caBlindExemptionCount).trim() === "" ? null : toNumber(raw.caBlindExemptionCount);
  out.caSeniorExemptionCount = raw.caSeniorExemptionCount === null || raw.caSeniorExemptionCount === undefined || String(raw.caSeniorExemptionCount).trim() === "" ? null : toNumber(raw.caSeniorExemptionCount);
  out.caDependentExemptionCount = raw.caDependentExemptionCount === null || raw.caDependentExemptionCount === undefined || String(raw.caDependentExemptionCount).trim() === "" ? null : toNumber(raw.caDependentExemptionCount);
  out.caMfsSpouseSameDeductionMethod = raw.caMfsSpouseSameDeductionMethod === null || raw.caMfsSpouseSameDeductionMethod === undefined || String(raw.caMfsSpouseSameDeductionMethod).trim() === "" ? null : toBoolean(raw.caMfsSpouseSameDeductionMethod);
  out.caMfsCommunityPropertyAllocated = raw.caMfsCommunityPropertyAllocated === null || raw.caMfsCommunityPropertyAllocated === undefined || String(raw.caMfsCommunityPropertyAllocated).trim() === "" ? null : toBoolean(raw.caMfsCommunityPropertyAllocated);
  out.caNonrefundableCreditsTotal = raw.caNonrefundableCreditsTotal === null || raw.caNonrefundableCreditsTotal === undefined || String(raw.caNonrefundableCreditsTotal).trim() === "" ? null : toNumber(raw.caNonrefundableCreditsTotal);
  out.caAlternativeMinimumTax = raw.caAlternativeMinimumTax === null || raw.caAlternativeMinimumTax === undefined || String(raw.caAlternativeMinimumTax).trim() === "" ? null : toNumber(raw.caAlternativeMinimumTax);
  out.caOtherTaxesRecapture = raw.caOtherTaxesRecapture === null || raw.caOtherTaxesRecapture === undefined || String(raw.caOtherTaxesRecapture).trim() === "" ? null : toNumber(raw.caOtherTaxesRecapture);
  out.caOtherLine71Withholding = raw.caOtherLine71Withholding === null || raw.caOtherLine71Withholding === undefined || String(raw.caOtherLine71Withholding).trim() === "" ? null : toNumber(raw.caOtherLine71Withholding);
  out.caEstimatedAndOtherPayments = raw.caEstimatedAndOtherPayments === null || raw.caEstimatedAndOtherPayments === undefined || String(raw.caEstimatedAndOtherPayments).trim() === "" ? null : toNumber(raw.caEstimatedAndOtherPayments);
  out.caForms592593Withholding = raw.caForms592593Withholding === null || raw.caForms592593Withholding === undefined || String(raw.caForms592593Withholding).trim() === "" ? null : toNumber(raw.caForms592593Withholding);
  out.caMotionPictureRefundableCredit = raw.caMotionPictureRefundableCredit === null || raw.caMotionPictureRefundableCredit === undefined || String(raw.caMotionPictureRefundableCredit).trim() === "" ? null : toNumber(raw.caMotionPictureRefundableCredit);
  out.caCalEitc = raw.caCalEitc === null || raw.caCalEitc === undefined || String(raw.caCalEitc).trim() === "" ? null : toNumber(raw.caCalEitc);
  out.caYoungChildTaxCredit = raw.caYoungChildTaxCredit === null || raw.caYoungChildTaxCredit === undefined || String(raw.caYoungChildTaxCredit).trim() === "" ? null : toNumber(raw.caYoungChildTaxCredit);
  out.caFosterYouthTaxCredit = raw.caFosterYouthTaxCredit === null || raw.caFosterYouthTaxCredit === undefined || String(raw.caFosterYouthTaxCredit).trim() === "" ? null : toNumber(raw.caFosterYouthTaxCredit);
  out.caUseTax = raw.caUseTax === null || raw.caUseTax === undefined || String(raw.caUseTax).trim() === "" ? null : toNumber(raw.caUseTax);
  out.caIsrPenalty = raw.caIsrPenalty === null || raw.caIsrPenalty === undefined || String(raw.caIsrPenalty).trim() === "" ? null : toNumber(raw.caIsrPenalty);
  out.caApplyToNextYear = raw.caApplyToNextYear === null || raw.caApplyToNextYear === undefined || String(raw.caApplyToNextYear).trim() === "" ? null : toNumber(raw.caApplyToNextYear);
  out.caContributions = raw.caContributions === null || raw.caContributions === undefined || String(raw.caContributions).trim() === "" ? null : toNumber(raw.caContributions);
  out.caInterestLatePenalties = raw.caInterestLatePenalties === null || raw.caInterestLatePenalties === undefined || String(raw.caInterestLatePenalties).trim() === "" ? null : toNumber(raw.caInterestLatePenalties);
  out.caUnderpaymentPenalty = raw.caUnderpaymentPenalty === null || raw.caUnderpaymentPenalty === undefined || String(raw.caUnderpaymentPenalty).trim() === "" ? null : toNumber(raw.caUnderpaymentPenalty);
  out.caHasCapitalConstructionFund = raw.caHasCapitalConstructionFund === null || raw.caHasCapitalConstructionFund === undefined || String(raw.caHasCapitalConstructionFund).trim() === "" ? null : toBoolean(raw.caHasCapitalConstructionFund);
  out.caHasFtb3800Or3803 = raw.caHasFtb3800Or3803 === null || raw.caHasFtb3800Or3803 === undefined || String(raw.caHasFtb3800Or3803).trim() === "" ? null : toBoolean(raw.caHasFtb3800Or3803);
  out.caHasScheduleG1Or5870A = raw.caHasScheduleG1Or5870A === null || raw.caHasScheduleG1Or5870A === undefined || String(raw.caHasScheduleG1Or5870A).trim() === "" ? null : toBoolean(raw.caHasScheduleG1Or5870A);
  out.caHasOtherStateTaxCredit = raw.caHasOtherStateTaxCredit === null || raw.caHasOtherStateTaxCredit === undefined || String(raw.caHasOtherStateTaxCredit).trim() === "" ? null : toBoolean(raw.caHasOtherStateTaxCredit);
  out.caHasClaimOfRightCredit = raw.caHasClaimOfRightCredit === null || raw.caHasClaimOfRightCredit === undefined || String(raw.caHasClaimOfRightCredit).trim() === "" ? null : toBoolean(raw.caHasClaimOfRightCredit);
  out.caHasAmendedOrOtherSpecialItems = raw.caHasAmendedOrOtherSpecialItems === null || raw.caHasAmendedOrOtherSpecialItems === undefined || String(raw.caHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.caHasAmendedOrOtherSpecialItems);


  out.hiFullYearResident = raw.hiFullYearResident === null || raw.hiFullYearResident === undefined || String(raw.hiFullYearResident).trim() === "" ? null : toBoolean(raw.hiFullYearResident);
  out.hiFilingStatusMatchesFederal = raw.hiFilingStatusMatchesFederal === null || raw.hiFilingStatusMatchesFederal === undefined || String(raw.hiFilingStatusMatchesFederal).trim() === "" ? null : toBoolean(raw.hiFilingStatusMatchesFederal);
  out.hiAdditions = raw.hiAdditions === null || raw.hiAdditions === undefined || String(raw.hiAdditions).trim() === "" ? null : toNumber(raw.hiAdditions);
  out.hiSubtractions = raw.hiSubtractions === null || raw.hiSubtractions === undefined || String(raw.hiSubtractions).trim() === "" ? null : toNumber(raw.hiSubtractions);
  out.hiDeductionMethod = raw.hiDeductionMethod === null || raw.hiDeductionMethod === undefined || String(raw.hiDeductionMethod).trim() === "" ? "" : String(raw.hiDeductionMethod).trim().toLowerCase();
  out.hiItemizedDeductionAmount = raw.hiItemizedDeductionAmount === null || raw.hiItemizedDeductionAmount === undefined || String(raw.hiItemizedDeductionAmount).trim() === "" ? null : toNumber(raw.hiItemizedDeductionAmount);
  out.hiMfsSpouseItemizes = raw.hiMfsSpouseItemizes === null || raw.hiMfsSpouseItemizes === undefined || String(raw.hiMfsSpouseItemizes).trim() === "" ? null : toBoolean(raw.hiMfsSpouseItemizes);
  out.hiExemptionCount = raw.hiExemptionCount === null || raw.hiExemptionCount === undefined || String(raw.hiExemptionCount).trim() === "" ? null : toNumber(raw.hiExemptionCount);
  out.hiHasCertifiedDisabilityExemption = raw.hiHasCertifiedDisabilityExemption === null || raw.hiHasCertifiedDisabilityExemption === undefined || String(raw.hiHasCertifiedDisabilityExemption).trim() === "" ? null : toBoolean(raw.hiHasCertifiedDisabilityExemption);
  out.hiHasCapitalGainAlternativeTaxCase = raw.hiHasCapitalGainAlternativeTaxCase === null || raw.hiHasCapitalGainAlternativeTaxCase === undefined || String(raw.hiHasCapitalGainAlternativeTaxCase).trim() === "" ? null : toBoolean(raw.hiHasCapitalGainAlternativeTaxCase);
  out.hiHasPteTaxCreditOrAdjustment = raw.hiHasPteTaxCreditOrAdjustment === null || raw.hiHasPteTaxCreditOrAdjustment === undefined || String(raw.hiHasPteTaxCreditOrAdjustment).trim() === "" ? null : toBoolean(raw.hiHasPteTaxCreditOrAdjustment);
  out.hiHasOtherStateCredit = raw.hiHasOtherStateCredit === null || raw.hiHasOtherStateCredit === undefined || String(raw.hiHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.hiHasOtherStateCredit);
  out.hiOtherTaxes = raw.hiOtherTaxes === null || raw.hiOtherTaxes === undefined || String(raw.hiOtherTaxes).trim() === "" ? null : toNumber(raw.hiOtherTaxes);
  out.hiNonrefundableCredits = raw.hiNonrefundableCredits === null || raw.hiNonrefundableCredits === undefined || String(raw.hiNonrefundableCredits).trim() === "" ? null : toNumber(raw.hiNonrefundableCredits);
  out.hiRefundableEic = raw.hiRefundableEic === null || raw.hiRefundableEic === undefined || String(raw.hiRefundableEic).trim() === "" ? null : toNumber(raw.hiRefundableEic);
  out.hiOtherRefundableCredits = raw.hiOtherRefundableCredits === null || raw.hiOtherRefundableCredits === undefined || String(raw.hiOtherRefundableCredits).trim() === "" ? null : toNumber(raw.hiOtherRefundableCredits);
  out.hiEstimatedPayments = raw.hiEstimatedPayments === null || raw.hiEstimatedPayments === undefined || String(raw.hiEstimatedPayments).trim() === "" ? null : toNumber(raw.hiEstimatedPayments);
  out.hiOtherPayments = raw.hiOtherPayments === null || raw.hiOtherPayments === undefined || String(raw.hiOtherPayments).trim() === "" ? null : toNumber(raw.hiOtherPayments);
  out.hiPenaltyInterest = raw.hiPenaltyInterest === null || raw.hiPenaltyInterest === undefined || String(raw.hiPenaltyInterest).trim() === "" ? null : toNumber(raw.hiPenaltyInterest);
  out.hiHasAmendedOrOtherSpecialItems = raw.hiHasAmendedOrOtherSpecialItems === null || raw.hiHasAmendedOrOtherSpecialItems === undefined || String(raw.hiHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.hiHasAmendedOrOtherSpecialItems);

  out.waFullYearResident = raw.waFullYearResident === null || raw.waFullYearResident === undefined || String(raw.waFullYearResident).trim() === "" ? null : toBoolean(raw.waFullYearResident);
  out.waIsRegisteredDomesticPartner = raw.waIsRegisteredDomesticPartner === null || raw.waIsRegisteredDomesticPartner === undefined || String(raw.waIsRegisteredDomesticPartner).trim() === "" ? null : toBoolean(raw.waIsRegisteredDomesticPartner);
  out.waCapitalGainsBaseCompleted = raw.waCapitalGainsBaseCompleted === null || raw.waCapitalGainsBaseCompleted === undefined || String(raw.waCapitalGainsBaseCompleted).trim() === "" ? null : toBoolean(raw.waCapitalGainsBaseCompleted);
  out.waCapitalGainsBeforeDeductions = raw.waCapitalGainsBeforeDeductions === null || raw.waCapitalGainsBeforeDeductions === undefined || String(raw.waCapitalGainsBeforeDeductions).trim() === "" ? null : toNumber(raw.waCapitalGainsBeforeDeductions);
  out.waConstitutionalDeduction = raw.waConstitutionalDeduction === null || raw.waConstitutionalDeduction === undefined || String(raw.waConstitutionalDeduction).trim() === "" ? null : toNumber(raw.waConstitutionalDeduction);
  out.waFamilyOwnedBusinessDeduction = raw.waFamilyOwnedBusinessDeduction === null || raw.waFamilyOwnedBusinessDeduction === undefined || String(raw.waFamilyOwnedBusinessDeduction).trim() === "" ? null : toNumber(raw.waFamilyOwnedBusinessDeduction);
  out.waQualifyingCharitableDonations = raw.waQualifyingCharitableDonations === null || raw.waQualifyingCharitableDonations === undefined || String(raw.waQualifyingCharitableDonations).trim() === "" ? null : toNumber(raw.waQualifyingCharitableDonations);
  out.waOtherJurisdictionCredit = raw.waOtherJurisdictionCredit === null || raw.waOtherJurisdictionCredit === undefined || String(raw.waOtherJurisdictionCredit).trim() === "" ? null : toNumber(raw.waOtherJurisdictionCredit);
  out.waBoCapitalGainsCredit = raw.waBoCapitalGainsCredit === null || raw.waBoCapitalGainsCredit === undefined || String(raw.waBoCapitalGainsCredit).trim() === "" ? null : toNumber(raw.waBoCapitalGainsCredit);
  out.waCapitalGainsPayments = raw.waCapitalGainsPayments === null || raw.waCapitalGainsPayments === undefined || String(raw.waCapitalGainsPayments).trim() === "" ? null : toNumber(raw.waCapitalGainsPayments);
  out.waWorkingFamiliesTaxCredit = raw.waWorkingFamiliesTaxCredit === null || raw.waWorkingFamiliesTaxCredit === undefined || String(raw.waWorkingFamiliesTaxCredit).trim() === "" ? null : toNumber(raw.waWorkingFamiliesTaxCredit);
  out.waPenaltyInterest = raw.waPenaltyInterest === null || raw.waPenaltyInterest === undefined || String(raw.waPenaltyInterest).trim() === "" ? null : toNumber(raw.waPenaltyInterest);
  out.waHasOtherMaterialSpecialCase = raw.waHasOtherMaterialSpecialCase === null || raw.waHasOtherMaterialSpecialCase === undefined || String(raw.waHasOtherMaterialSpecialCase).trim() === "" ? null : toBoolean(raw.waHasOtherMaterialSpecialCase);

  out.orFullYearResident = raw.orFullYearResident === null || raw.orFullYearResident === undefined || String(raw.orFullYearResident).trim() === "" ? null : toBoolean(raw.orFullYearResident);
  out.orFilingStatusMatchesFederal = raw.orFilingStatusMatchesFederal === null || raw.orFilingStatusMatchesFederal === undefined || String(raw.orFilingStatusMatchesFederal).trim() === "" ? null : toBoolean(raw.orFilingStatusMatchesFederal);
  out.orIsRegisteredDomesticPartner = raw.orIsRegisteredDomesticPartner === null || raw.orIsRegisteredDomesticPartner === undefined || String(raw.orIsRegisteredDomesticPartner).trim() === "" ? null : toBoolean(raw.orIsRegisteredDomesticPartner);
  out.orAdditions = raw.orAdditions === null || raw.orAdditions === undefined || String(raw.orAdditions).trim() === "" ? null : toNumber(raw.orAdditions);
  out.orFederalTaxLiabilitySubtraction = raw.orFederalTaxLiabilitySubtraction === null || raw.orFederalTaxLiabilitySubtraction === undefined || String(raw.orFederalTaxLiabilitySubtraction).trim() === "" ? null : toNumber(raw.orFederalTaxLiabilitySubtraction);
  out.orSocialSecurityTier1Subtraction = raw.orSocialSecurityTier1Subtraction === null || raw.orSocialSecurityTier1Subtraction === undefined || String(raw.orSocialSecurityTier1Subtraction).trim() === "" ? null : toNumber(raw.orSocialSecurityTier1Subtraction);
  out.orOregonRefundSubtraction = raw.orOregonRefundSubtraction === null || raw.orOregonRefundSubtraction === undefined || String(raw.orOregonRefundSubtraction).trim() === "" ? null : toNumber(raw.orOregonRefundSubtraction);
  out.orOtherSubtractions = raw.orOtherSubtractions === null || raw.orOtherSubtractions === undefined || String(raw.orOtherSubtractions).trim() === "" ? null : toNumber(raw.orOtherSubtractions);
  out.orDeductionMethod = raw.orDeductionMethod === null || raw.orDeductionMethod === undefined || String(raw.orDeductionMethod).trim() === "" ? "" : String(raw.orDeductionMethod).trim().toLowerCase();
  out.orDeductionAmount = raw.orDeductionAmount === null || raw.orDeductionAmount === undefined || String(raw.orDeductionAmount).trim() === "" ? null : toNumber(raw.orDeductionAmount);
  out.orMfsSpouseItemizes = raw.orMfsSpouseItemizes === null || raw.orMfsSpouseItemizes === undefined || String(raw.orMfsSpouseItemizes).trim() === "" ? null : toBoolean(raw.orMfsSpouseItemizes);
  out.orInstallmentSaleInterest = raw.orInstallmentSaleInterest === null || raw.orInstallmentSaleInterest === undefined || String(raw.orInstallmentSaleInterest).trim() === "" ? null : toNumber(raw.orInstallmentSaleInterest);
  out.orTaxRecaptures = raw.orTaxRecaptures === null || raw.orTaxRecaptures === undefined || String(raw.orTaxRecaptures).trim() === "" ? null : toNumber(raw.orTaxRecaptures);
  out.orExemptionCredit = raw.orExemptionCredit === null || raw.orExemptionCredit === undefined || String(raw.orExemptionCredit).trim() === "" ? null : toNumber(raw.orExemptionCredit);
  out.orPoliticalContributionCredit = raw.orPoliticalContributionCredit === null || raw.orPoliticalContributionCredit === undefined || String(raw.orPoliticalContributionCredit).trim() === "" ? null : toNumber(raw.orPoliticalContributionCredit);
  out.orOtherStandardCredits = raw.orOtherStandardCredits === null || raw.orOtherStandardCredits === undefined || String(raw.orOtherStandardCredits).trim() === "" ? null : toNumber(raw.orOtherStandardCredits);
  out.orCarryforwardCredits = raw.orCarryforwardCredits === null || raw.orCarryforwardCredits === undefined || String(raw.orCarryforwardCredits).trim() === "" ? null : toNumber(raw.orCarryforwardCredits);
  out.orKicker = raw.orKicker === null || raw.orKicker === undefined || String(raw.orKicker).trim() === "" ? null : toNumber(raw.orKicker);
  out.orOtherWithholding = raw.orOtherWithholding === null || raw.orOtherWithholding === undefined || String(raw.orOtherWithholding).trim() === "" ? null : toNumber(raw.orOtherWithholding);
  out.orPriorYearRefundApplied = raw.orPriorYearRefundApplied === null || raw.orPriorYearRefundApplied === undefined || String(raw.orPriorYearRefundApplied).trim() === "" ? null : toNumber(raw.orPriorYearRefundApplied);
  out.orEstimatedPayments = raw.orEstimatedPayments === null || raw.orEstimatedPayments === undefined || String(raw.orEstimatedPayments).trim() === "" ? null : toNumber(raw.orEstimatedPayments);
  out.orPteEstimatedPayments = raw.orPteEstimatedPayments === null || raw.orPteEstimatedPayments === undefined || String(raw.orPteEstimatedPayments).trim() === "" ? null : toNumber(raw.orPteEstimatedPayments);
  out.orFederalEitcAmount = raw.orFederalEitcAmount === null || raw.orFederalEitcAmount === undefined || String(raw.orFederalEitcAmount).trim() === "" ? null : toNumber(raw.orFederalEitcAmount);
  out.orYoungestDependentUnder3 = raw.orYoungestDependentUnder3 === null || raw.orYoungestDependentUnder3 === undefined || String(raw.orYoungestDependentUnder3).trim() === "" ? null : toBoolean(raw.orYoungestDependentUnder3);
  out.orKidsCredit = raw.orKidsCredit === null || raw.orKidsCredit === undefined || String(raw.orKidsCredit).trim() === "" ? null : toNumber(raw.orKidsCredit);
  out.orOtherRefundableCredits = raw.orOtherRefundableCredits === null || raw.orOtherRefundableCredits === undefined || String(raw.orOtherRefundableCredits).trim() === "" ? null : toNumber(raw.orOtherRefundableCredits);
  out.orPenaltyInterest = raw.orPenaltyInterest === null || raw.orPenaltyInterest === undefined || String(raw.orPenaltyInterest).trim() === "" ? null : toNumber(raw.orPenaltyInterest);
  out.orRefundApplications = raw.orRefundApplications === null || raw.orRefundApplications === undefined || String(raw.orRefundApplications).trim() === "" ? null : toNumber(raw.orRefundApplications);
  out.orHasAlternateTaxMethod = raw.orHasAlternateTaxMethod === null || raw.orHasAlternateTaxMethod === undefined || String(raw.orHasAlternateTaxMethod).trim() === "" ? null : toBoolean(raw.orHasAlternateTaxMethod);
  out.orHasOtherStateCredit = raw.orHasOtherStateCredit === null || raw.orHasOtherStateCredit === undefined || String(raw.orHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.orHasOtherStateCredit);
  out.orHasItinEicSpecialCase = raw.orHasItinEicSpecialCase === null || raw.orHasItinEicSpecialCase === undefined || String(raw.orHasItinEicSpecialCase).trim() === "" ? null : toBoolean(raw.orHasItinEicSpecialCase);
  out.orHasSeparateTransitTaxFiling = raw.orHasSeparateTransitTaxFiling === null || raw.orHasSeparateTransitTaxFiling === undefined || String(raw.orHasSeparateTransitTaxFiling).trim() === "" ? null : toBoolean(raw.orHasSeparateTransitTaxFiling);
  out.orHasAmendedNolOrOtherSpecialItems = raw.orHasAmendedNolOrOtherSpecialItems === null || raw.orHasAmendedNolOrOtherSpecialItems === undefined || String(raw.orHasAmendedNolOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.orHasAmendedNolOrOtherSpecialItems);

  out.ksFullYearResident = raw.ksFullYearResident === null || raw.ksFullYearResident === undefined || String(raw.ksFullYearResident).trim() === "" ? null : toBoolean(raw.ksFullYearResident);
  out.ksNetModifications = raw.ksNetModifications === null || raw.ksNetModifications === undefined || String(raw.ksNetModifications).trim() === "" ? null : toNumber(raw.ksNetModifications);
  out.ksDeductionMethod = raw.ksDeductionMethod === null || raw.ksDeductionMethod === undefined || String(raw.ksDeductionMethod).trim() === "" ? "" : String(raw.ksDeductionMethod).trim().toLowerCase();
  out.ksDeductionAmount = raw.ksDeductionAmount === null || raw.ksDeductionAmount === undefined || String(raw.ksDeductionAmount).trim() === "" ? null : toNumber(raw.ksDeductionAmount);
  out.ksMfsSpouseSameDeductionMethod = raw.ksMfsSpouseSameDeductionMethod === null || raw.ksMfsSpouseSameDeductionMethod === undefined || String(raw.ksMfsSpouseSameDeductionMethod).trim() === "" ? null : toBoolean(raw.ksMfsSpouseSameDeductionMethod);
  out.ksNewbornDependentCount = raw.ksNewbornDependentCount === null || raw.ksNewbornDependentCount === undefined || String(raw.ksNewbornDependentCount).trim() === "" ? null : toNumber(raw.ksNewbornDependentCount);
  out.ksStillbirthCount = raw.ksStillbirthCount === null || raw.ksStillbirthCount === undefined || String(raw.ksStillbirthCount).trim() === "" ? null : toNumber(raw.ksStillbirthCount);
  out.ksDisabledVeteranCount = raw.ksDisabledVeteranCount === null || raw.ksDisabledVeteranCount === undefined || String(raw.ksDisabledVeteranCount).trim() === "" ? null : toNumber(raw.ksDisabledVeteranCount);
  out.ksLumpSumDistributionTax = raw.ksLumpSumDistributionTax === null || raw.ksLumpSumDistributionTax === undefined || String(raw.ksLumpSumDistributionTax).trim() === "" ? null : toNumber(raw.ksLumpSumDistributionTax);
  out.ksHasOtherStateCredit = raw.ksHasOtherStateCredit === null || raw.ksHasOtherStateCredit === undefined || String(raw.ksHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.ksHasOtherStateCredit);
  out.ksFederalChildDependentCareCredit = raw.ksFederalChildDependentCareCredit === null || raw.ksFederalChildDependentCareCredit === undefined || String(raw.ksFederalChildDependentCareCredit).trim() === "" ? null : toNumber(raw.ksFederalChildDependentCareCredit);
  out.ksOtherNonrefundableCredits = raw.ksOtherNonrefundableCredits === null || raw.ksOtherNonrefundableCredits === undefined || String(raw.ksOtherNonrefundableCredits).trim() === "" ? null : toNumber(raw.ksOtherNonrefundableCredits);
  out.ksFederalEITCAmount = raw.ksFederalEITCAmount === null || raw.ksFederalEITCAmount === undefined || String(raw.ksFederalEITCAmount).trim() === "" ? null : toNumber(raw.ksFederalEITCAmount);
  out.ksCreditSsnEligibilityConfirmed = raw.ksCreditSsnEligibilityConfirmed === null || raw.ksCreditSsnEligibilityConfirmed === undefined || String(raw.ksCreditSsnEligibilityConfirmed).trim() === "" ? null : toBoolean(raw.ksCreditSsnEligibilityConfirmed);
  out.ksOtherFormWithholding = raw.ksOtherFormWithholding === null || raw.ksOtherFormWithholding === undefined || String(raw.ksOtherFormWithholding).trim() === "" ? null : toNumber(raw.ksOtherFormWithholding);
  out.ksEstimatedPayments = raw.ksEstimatedPayments === null || raw.ksEstimatedPayments === undefined || String(raw.ksEstimatedPayments).trim() === "" ? null : toNumber(raw.ksEstimatedPayments);
  out.ksExtensionPayment = raw.ksExtensionPayment === null || raw.ksExtensionPayment === undefined || String(raw.ksExtensionPayment).trim() === "" ? null : toNumber(raw.ksExtensionPayment);
  out.ksOtherRefundableCredits = raw.ksOtherRefundableCredits === null || raw.ksOtherRefundableCredits === undefined || String(raw.ksOtherRefundableCredits).trim() === "" ? null : toNumber(raw.ksOtherRefundableCredits);
  out.ksPtetCredit = raw.ksPtetCredit === null || raw.ksPtetCredit === undefined || String(raw.ksPtetCredit).trim() === "" ? null : toNumber(raw.ksPtetCredit);
  out.ksInterest = raw.ksInterest === null || raw.ksInterest === undefined || String(raw.ksInterest).trim() === "" ? null : toNumber(raw.ksInterest);
  out.ksLatePaymentPenalty = raw.ksLatePaymentPenalty === null || raw.ksLatePaymentPenalty === undefined || String(raw.ksLatePaymentPenalty).trim() === "" ? null : toNumber(raw.ksLatePaymentPenalty);
  out.ksEstimatedTaxPenalty = raw.ksEstimatedTaxPenalty === null || raw.ksEstimatedTaxPenalty === undefined || String(raw.ksEstimatedTaxPenalty).trim() === "" ? null : toNumber(raw.ksEstimatedTaxPenalty);
  out.ksCreditForward = raw.ksCreditForward === null || raw.ksCreditForward === undefined || String(raw.ksCreditForward).trim() === "" ? null : toNumber(raw.ksCreditForward);
  out.ksContributions = raw.ksContributions === null || raw.ksContributions === undefined || String(raw.ksContributions).trim() === "" ? null : toNumber(raw.ksContributions);
  out.ksHasSeparatePropertyTaxRefundClaim = raw.ksHasSeparatePropertyTaxRefundClaim === null || raw.ksHasSeparatePropertyTaxRefundClaim === undefined || String(raw.ksHasSeparatePropertyTaxRefundClaim).trim() === "" ? null : toBoolean(raw.ksHasSeparatePropertyTaxRefundClaim);
  out.ksHasAmendedOrOtherSpecialItems = raw.ksHasAmendedOrOtherSpecialItems === null || raw.ksHasAmendedOrOtherSpecialItems === undefined || String(raw.ksHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.ksHasAmendedOrOtherSpecialItems);

  out.neFullYearResident = raw.neFullYearResident === null || raw.neFullYearResident === undefined || String(raw.neFullYearResident).trim() === "" ? null : toBoolean(raw.neFullYearResident);
  out.neStandardDeduction = raw.neStandardDeduction === null || raw.neStandardDeduction === undefined || String(raw.neStandardDeduction).trim() === "" ? null : toNumber(raw.neStandardDeduction);
  out.neFederalItemizedDeductions = raw.neFederalItemizedDeductions === null || raw.neFederalItemizedDeductions === undefined || String(raw.neFederalItemizedDeductions).trim() === "" ? null : toNumber(raw.neFederalItemizedDeductions);
  out.neStateLocalIncomeTaxes = raw.neStateLocalIncomeTaxes === null || raw.neStateLocalIncomeTaxes === undefined || String(raw.neStateLocalIncomeTaxes).trim() === "" ? null : toNumber(raw.neStateLocalIncomeTaxes);
  out.neScheduleIIncreases = raw.neScheduleIIncreases === null || raw.neScheduleIIncreases === undefined || String(raw.neScheduleIIncreases).trim() === "" ? null : toNumber(raw.neScheduleIIncreases);
  out.neScheduleIDecreases = raw.neScheduleIDecreases === null || raw.neScheduleIDecreases === undefined || String(raw.neScheduleIDecreases).trim() === "" ? null : toNumber(raw.neScheduleIDecreases);
  out.neFederalLumpSumTax = raw.neFederalLumpSumTax === null || raw.neFederalLumpSumTax === undefined || String(raw.neFederalLumpSumTax).trim() === "" ? null : toNumber(raw.neFederalLumpSumTax);
  out.neFederalEarlyDistributionTax = raw.neFederalEarlyDistributionTax === null || raw.neFederalEarlyDistributionTax === undefined || String(raw.neFederalEarlyDistributionTax).trim() === "" ? null : toNumber(raw.neFederalEarlyDistributionTax);
  out.neSpouseCanBeClaimedAsDependent = raw.neSpouseCanBeClaimedAsDependent === null || raw.neSpouseCanBeClaimedAsDependent === undefined || String(raw.neSpouseCanBeClaimedAsDependent).trim() === "" ? null : toBoolean(raw.neSpouseCanBeClaimedAsDependent);
  out.neOtherNonrefundableCredits = raw.neOtherNonrefundableCredits === null || raw.neOtherNonrefundableCredits === undefined || String(raw.neOtherNonrefundableCredits).trim() === "" ? null : toNumber(raw.neOtherNonrefundableCredits);
  out.neFederalTaxBeforeCreditsLimit = raw.neFederalTaxBeforeCreditsLimit === null || raw.neFederalTaxBeforeCreditsLimit === undefined || String(raw.neFederalTaxBeforeCreditsLimit).trim() === "" ? null : toNumber(raw.neFederalTaxBeforeCreditsLimit);
  out.neHasOtherStateCredit = raw.neHasOtherStateCredit === null || raw.neHasOtherStateCredit === undefined || String(raw.neHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.neHasOtherStateCredit);
  out.neOtherFormWithholding = raw.neOtherFormWithholding === null || raw.neOtherFormWithholding === undefined || String(raw.neOtherFormWithholding).trim() === "" ? null : toNumber(raw.neOtherFormWithholding);
  out.neK1Withholding = raw.neK1Withholding === null || raw.neK1Withholding === undefined || String(raw.neK1Withholding).trim() === "" ? null : toNumber(raw.neK1Withholding);
  out.nePtetCredit = raw.nePtetCredit === null || raw.nePtetCredit === undefined || String(raw.nePtetCredit).trim() === "" ? null : toNumber(raw.nePtetCredit);
  out.neEstimatedPayments = raw.neEstimatedPayments === null || raw.neEstimatedPayments === undefined || String(raw.neEstimatedPayments).trim() === "" ? null : toNumber(raw.neEstimatedPayments);
  out.neForm3800RefundableCredit = raw.neForm3800RefundableCredit === null || raw.neForm3800RefundableCredit === undefined || String(raw.neForm3800RefundableCredit).trim() === "" ? null : toNumber(raw.neForm3800RefundableCredit);
  out.neChildDependentCareRefundableCredit = raw.neChildDependentCareRefundableCredit === null || raw.neChildDependentCareRefundableCredit === undefined || String(raw.neChildDependentCareRefundableCredit).trim() === "" ? null : toNumber(raw.neChildDependentCareRefundableCredit);
  out.neBeginningFarmerCredit = raw.neBeginningFarmerCredit === null || raw.neBeginningFarmerCredit === undefined || String(raw.neBeginningFarmerCredit).trim() === "" ? null : toNumber(raw.neBeginningFarmerCredit);
  out.neFederalEITCAmount = raw.neFederalEITCAmount === null || raw.neFederalEITCAmount === undefined || String(raw.neFederalEITCAmount).trim() === "" ? null : toNumber(raw.neFederalEITCAmount);
  out.neOtherRefundableCredits = raw.neOtherRefundableCredits === null || raw.neOtherRefundableCredits === undefined || String(raw.neOtherRefundableCredits).trim() === "" ? null : toNumber(raw.neOtherRefundableCredits);
  out.neUnderpaymentPenalty = raw.neUnderpaymentPenalty === null || raw.neUnderpaymentPenalty === undefined || String(raw.neUnderpaymentPenalty).trim() === "" ? null : toNumber(raw.neUnderpaymentPenalty);
  out.neUseTax = raw.neUseTax === null || raw.neUseTax === undefined || String(raw.neUseTax).trim() === "" ? null : toNumber(raw.neUseTax);
  out.neUseTaxRequiresSeparateForm3 = raw.neUseTaxRequiresSeparateForm3 === null || raw.neUseTaxRequiresSeparateForm3 === undefined || String(raw.neUseTaxRequiresSeparateForm3).trim() === "" ? null : toBoolean(raw.neUseTaxRequiresSeparateForm3);
  out.neApplyToNextYear = raw.neApplyToNextYear === null || raw.neApplyToNextYear === undefined || String(raw.neApplyToNextYear).trim() === "" ? null : toNumber(raw.neApplyToNextYear);
  out.neWildlifeDonation = raw.neWildlifeDonation === null || raw.neWildlifeDonation === undefined || String(raw.neWildlifeDonation).trim() === "" ? null : toNumber(raw.neWildlifeDonation);
  out.neHasFederalNolEitcSpecialCase = raw.neHasFederalNolEitcSpecialCase === null || raw.neHasFederalNolEitcSpecialCase === undefined || String(raw.neHasFederalNolEitcSpecialCase).trim() === "" ? null : toBoolean(raw.neHasFederalNolEitcSpecialCase);
  out.neHasAmendedOrOtherSpecialItems = raw.neHasAmendedOrOtherSpecialItems === null || raw.neHasAmendedOrOtherSpecialItems === undefined || String(raw.neHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.neHasAmendedOrOtherSpecialItems);

  out.iaFullYearResident = raw.iaFullYearResident === null || raw.iaFullYearResident === undefined || String(raw.iaFullYearResident).trim() === "" ? null : toBoolean(raw.iaFullYearResident);
  out.iaFederalTaxableIncomeLine2 = raw.iaFederalTaxableIncomeLine2 === null || raw.iaFederalTaxableIncomeLine2 === undefined || String(raw.iaFederalTaxableIncomeLine2).trim() === "" ? null : toNumber(raw.iaFederalTaxableIncomeLine2);
  out.iaNetIowaModifications = raw.iaNetIowaModifications === null || raw.iaNetIowaModifications === undefined || String(raw.iaNetIowaModifications).trim() === "" ? null : toNumber(raw.iaNetIowaModifications);
  out.iaFederalDeductionForSpecialCalc = raw.iaFederalDeductionForSpecialCalc === null || raw.iaFederalDeductionForSpecialCalc === undefined || String(raw.iaFederalDeductionForSpecialCalc).trim() === "" ? null : toNumber(raw.iaFederalDeductionForSpecialCalc);
  out.iaFederalPersonalExemptionForSpecialCalc = raw.iaFederalPersonalExemptionForSpecialCalc === null || raw.iaFederalPersonalExemptionForSpecialCalc === undefined || String(raw.iaFederalPersonalExemptionForSpecialCalc).trim() === "" ? null : toNumber(raw.iaFederalPersonalExemptionForSpecialCalc);
  out.iaQualifiedBusinessIncomeDeduction = raw.iaQualifiedBusinessIncomeDeduction === null || raw.iaQualifiedBusinessIncomeDeduction === undefined || String(raw.iaQualifiedBusinessIncomeDeduction).trim() === "" ? null : toNumber(raw.iaQualifiedBusinessIncomeDeduction);
  out.iaNolCarryover = raw.iaNolCarryover === null || raw.iaNolCarryover === undefined || String(raw.iaNolCarryover).trim() === "" ? null : toNumber(raw.iaNolCarryover);
  out.iaLumpSumDistributionTaxableIncome = raw.iaLumpSumDistributionTaxableIncome === null || raw.iaLumpSumDistributionTaxableIncome === undefined || String(raw.iaLumpSumDistributionTaxableIncome).trim() === "" ? null : toNumber(raw.iaLumpSumDistributionTaxableIncome);
  out.iaTaxpayerBlind = raw.iaTaxpayerBlind === null || raw.iaTaxpayerBlind === undefined || String(raw.iaTaxpayerBlind).trim() === "" ? null : toBoolean(raw.iaTaxpayerBlind);
  out.iaSpouseBlind = raw.iaSpouseBlind === null || raw.iaSpouseBlind === undefined || String(raw.iaSpouseBlind).trim() === "" ? null : toBoolean(raw.iaSpouseBlind);
  out.iaMfsSpouseIowaTaxableIncome = raw.iaMfsSpouseIowaTaxableIncome === null || raw.iaMfsSpouseIowaTaxableIncome === undefined || String(raw.iaMfsSpouseIowaTaxableIncome).trim() === "" ? null : toNumber(raw.iaMfsSpouseIowaTaxableIncome);
  out.iaMfsSpouseAdjustedIncome = raw.iaMfsSpouseAdjustedIncome === null || raw.iaMfsSpouseAdjustedIncome === undefined || String(raw.iaMfsSpouseAdjustedIncome).trim() === "" ? null : toNumber(raw.iaMfsSpouseAdjustedIncome);
  out.iaMfsSpouseNolCarryover = raw.iaMfsSpouseNolCarryover === null || raw.iaMfsSpouseNolCarryover === undefined || String(raw.iaMfsSpouseNolCarryover).trim() === "" ? null : toNumber(raw.iaMfsSpouseNolCarryover);
  out.iaLumpSumTax = raw.iaLumpSumTax === null || raw.iaLumpSumTax === undefined || String(raw.iaLumpSumTax).trim() === "" ? null : toNumber(raw.iaLumpSumTax);
  out.iaTuitionTextbookCredit = raw.iaTuitionTextbookCredit === null || raw.iaTuitionTextbookCredit === undefined || String(raw.iaTuitionTextbookCredit).trim() === "" ? null : toNumber(raw.iaTuitionTextbookCredit);
  out.iaVolunteerCredit = raw.iaVolunteerCredit === null || raw.iaVolunteerCredit === undefined || String(raw.iaVolunteerCredit).trim() === "" ? null : toNumber(raw.iaVolunteerCredit);
  out.iaOtherNonrefundableCredits = raw.iaOtherNonrefundableCredits === null || raw.iaOtherNonrefundableCredits === undefined || String(raw.iaOtherNonrefundableCredits).trim() === "" ? null : toNumber(raw.iaOtherNonrefundableCredits);
  out.iaHasOutOfStateTaxCredit = raw.iaHasOutOfStateTaxCredit === null || raw.iaHasOutOfStateTaxCredit === undefined || String(raw.iaHasOutOfStateTaxCredit).trim() === "" ? null : toBoolean(raw.iaHasOutOfStateTaxCredit);
  out.iaSchoolDistrictEmsSurtaxRate = raw.iaSchoolDistrictEmsSurtaxRate === null || raw.iaSchoolDistrictEmsSurtaxRate === undefined || String(raw.iaSchoolDistrictEmsSurtaxRate).trim() === "" ? null : toNumber(raw.iaSchoolDistrictEmsSurtaxRate);
  out.iaContributions = raw.iaContributions === null || raw.iaContributions === undefined || String(raw.iaContributions).trim() === "" ? null : toNumber(raw.iaContributions);
  out.iaFuelTaxCredit = raw.iaFuelTaxCredit === null || raw.iaFuelTaxCredit === undefined || String(raw.iaFuelTaxCredit).trim() === "" ? null : toNumber(raw.iaFuelTaxCredit);
  out.iaChildDependentOrEarlyChildhoodCredit = raw.iaChildDependentOrEarlyChildhoodCredit === null || raw.iaChildDependentOrEarlyChildhoodCredit === undefined || String(raw.iaChildDependentOrEarlyChildhoodCredit).trim() === "" ? null : toNumber(raw.iaChildDependentOrEarlyChildhoodCredit);
  out.iaEarnedIncomeTaxCredit = raw.iaEarnedIncomeTaxCredit === null || raw.iaEarnedIncomeTaxCredit === undefined || String(raw.iaEarnedIncomeTaxCredit).trim() === "" ? null : toNumber(raw.iaEarnedIncomeTaxCredit);
  out.iaOtherRefundableCredits = raw.iaOtherRefundableCredits === null || raw.iaOtherRefundableCredits === undefined || String(raw.iaOtherRefundableCredits).trim() === "" ? null : toNumber(raw.iaOtherRefundableCredits);
  out.iaCompositePtetCredit = raw.iaCompositePtetCredit === null || raw.iaCompositePtetCredit === undefined || String(raw.iaCompositePtetCredit).trim() === "" ? null : toNumber(raw.iaCompositePtetCredit);
  out.iaEstimatedAndOtherPayments = raw.iaEstimatedAndOtherPayments === null || raw.iaEstimatedAndOtherPayments === undefined || String(raw.iaEstimatedAndOtherPayments).trim() === "" ? null : toNumber(raw.iaEstimatedAndOtherPayments);
  out.iaUnderpaymentPenalty = raw.iaUnderpaymentPenalty === null || raw.iaUnderpaymentPenalty === undefined || String(raw.iaUnderpaymentPenalty).trim() === "" ? null : toNumber(raw.iaUnderpaymentPenalty);
  out.iaOtherPenaltyInterest = raw.iaOtherPenaltyInterest === null || raw.iaOtherPenaltyInterest === undefined || String(raw.iaOtherPenaltyInterest).trim() === "" ? null : toNumber(raw.iaOtherPenaltyInterest);
  out.iaHasAmendedOrOtherSpecialItems = raw.iaHasAmendedOrOtherSpecialItems === null || raw.iaHasAmendedOrOtherSpecialItems === undefined || String(raw.iaHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.iaHasAmendedOrOtherSpecialItems);

  out.mnFullYearResident = raw.mnFullYearResident === null || raw.mnFullYearResident === undefined || String(raw.mnFullYearResident).trim() === "" ? null : toBoolean(raw.mnFullYearResident);
  out.mnM1Additions = raw.mnM1Additions === null || raw.mnM1Additions === undefined || String(raw.mnM1Additions).trim() === "" ? null : toNumber(raw.mnM1Additions);
  out.mnUseItemizedDeductions = raw.mnUseItemizedDeductions === null || raw.mnUseItemizedDeductions === undefined || String(raw.mnUseItemizedDeductions).trim() === "" ? null : toBoolean(raw.mnUseItemizedDeductions);
  out.mnItemizedDeductions = raw.mnItemizedDeductions === null || raw.mnItemizedDeductions === undefined || String(raw.mnItemizedDeductions).trim() === "" ? null : toNumber(raw.mnItemizedDeductions);
  out.mnTaxpayerBlind = raw.mnTaxpayerBlind === null || raw.mnTaxpayerBlind === undefined || String(raw.mnTaxpayerBlind).trim() === "" ? null : toBoolean(raw.mnTaxpayerBlind);
  out.mnSpouseBlind = raw.mnSpouseBlind === null || raw.mnSpouseBlind === undefined || String(raw.mnSpouseBlind).trim() === "" ? null : toBoolean(raw.mnSpouseBlind);
  out.mnMfsSpouseItemizes = raw.mnMfsSpouseItemizes === null || raw.mnMfsSpouseItemizes === undefined || String(raw.mnMfsSpouseItemizes).trim() === "" ? null : toBoolean(raw.mnMfsSpouseItemizes);
  out.mnMfsSpouseNoGrossIncomeAndNotDependent = raw.mnMfsSpouseNoGrossIncomeAndNotDependent === null || raw.mnMfsSpouseNoGrossIncomeAndNotDependent === undefined || String(raw.mnMfsSpouseNoGrossIncomeAndNotDependent).trim() === "" ? null : toBoolean(raw.mnMfsSpouseNoGrossIncomeAndNotDependent);
  out.mnSpouseCanBeClaimedAsDependent = raw.mnSpouseCanBeClaimedAsDependent === null || raw.mnSpouseCanBeClaimedAsDependent === undefined || String(raw.mnSpouseCanBeClaimedAsDependent).trim() === "" ? null : toBoolean(raw.mnSpouseCanBeClaimedAsDependent);
  out.mnDependentEarnedIncome = raw.mnDependentEarnedIncome === null || raw.mnDependentEarnedIncome === undefined || String(raw.mnDependentEarnedIncome).trim() === "" ? null : toNumber(raw.mnDependentEarnedIncome);
  out.mnHasM1NCFederalAdjustments = raw.mnHasM1NCFederalAdjustments === null || raw.mnHasM1NCFederalAdjustments === undefined || String(raw.mnHasM1NCFederalAdjustments).trim() === "" ? null : toBoolean(raw.mnHasM1NCFederalAdjustments);
  out.mnM1NCWorksheetAGI = raw.mnM1NCWorksheetAGI === null || raw.mnM1NCWorksheetAGI === undefined || String(raw.mnM1NCWorksheetAGI).trim() === "" ? null : toNumber(raw.mnM1NCWorksheetAGI);
  out.mnStateIncomeTaxRefund = raw.mnStateIncomeTaxRefund === null || raw.mnStateIncomeTaxRefund === undefined || String(raw.mnStateIncomeTaxRefund).trim() === "" ? null : toNumber(raw.mnStateIncomeTaxRefund);
  out.mnM1Subtractions = raw.mnM1Subtractions === null || raw.mnM1Subtractions === undefined || String(raw.mnM1Subtractions).trim() === "" ? null : toNumber(raw.mnM1Subtractions);
  out.mnAlternativeMinimumTax = raw.mnAlternativeMinimumTax === null || raw.mnAlternativeMinimumTax === undefined || String(raw.mnAlternativeMinimumTax).trim() === "" ? null : toNumber(raw.mnAlternativeMinimumTax);
  out.mnOtherTaxes = raw.mnOtherTaxes === null || raw.mnOtherTaxes === undefined || String(raw.mnOtherTaxes).trim() === "" ? null : toNumber(raw.mnOtherTaxes);
  out.mnAdvanceChildTaxCreditRepayment = raw.mnAdvanceChildTaxCreditRepayment === null || raw.mnAdvanceChildTaxCreditRepayment === undefined || String(raw.mnAdvanceChildTaxCreditRepayment).trim() === "" ? null : toNumber(raw.mnAdvanceChildTaxCreditRepayment);
  out.mnNonrefundableCredits = raw.mnNonrefundableCredits === null || raw.mnNonrefundableCredits === undefined || String(raw.mnNonrefundableCredits).trim() === "" ? null : toNumber(raw.mnNonrefundableCredits);
  out.mnNongameWildlifeContribution = raw.mnNongameWildlifeContribution === null || raw.mnNongameWildlifeContribution === undefined || String(raw.mnNongameWildlifeContribution).trim() === "" ? null : toNumber(raw.mnNongameWildlifeContribution);
  out.mnEstimatedPayments = raw.mnEstimatedPayments === null || raw.mnEstimatedPayments === undefined || String(raw.mnEstimatedPayments).trim() === "" ? null : toNumber(raw.mnEstimatedPayments);
  out.mnRefundableCredits = raw.mnRefundableCredits === null || raw.mnRefundableCredits === undefined || String(raw.mnRefundableCredits).trim() === "" ? null : toNumber(raw.mnRefundableCredits);
  out.mnScheduleM15Penalty = raw.mnScheduleM15Penalty === null || raw.mnScheduleM15Penalty === undefined || String(raw.mnScheduleM15Penalty).trim() === "" ? null : toNumber(raw.mnScheduleM15Penalty);
  out.mnOtherPenaltyInterest = raw.mnOtherPenaltyInterest === null || raw.mnOtherPenaltyInterest === undefined || String(raw.mnOtherPenaltyInterest).trim() === "" ? null : toNumber(raw.mnOtherPenaltyInterest);
  out.mnHasOtherStateCreditOrReciprocity = raw.mnHasOtherStateCreditOrReciprocity === null || raw.mnHasOtherStateCreditOrReciprocity === undefined || String(raw.mnHasOtherStateCreditOrReciprocity).trim() === "" ? null : toBoolean(raw.mnHasOtherStateCreditOrReciprocity);
  out.mnShortPeriodOrNonresidentAlien = raw.mnShortPeriodOrNonresidentAlien === null || raw.mnShortPeriodOrNonresidentAlien === undefined || String(raw.mnShortPeriodOrNonresidentAlien).trim() === "" ? null : toBoolean(raw.mnShortPeriodOrNonresidentAlien);
  out.mnHasAmendedOrOtherSpecialItems = raw.mnHasAmendedOrOtherSpecialItems === null || raw.mnHasAmendedOrOtherSpecialItems === undefined || String(raw.mnHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.mnHasAmendedOrOtherSpecialItems);

  out.wiFullYearResident = raw.wiFullYearResident === null || raw.wiFullYearResident === undefined || String(raw.wiFullYearResident).trim() === "" ? null : toBoolean(raw.wiFullYearResident);
  out.wiScheduleIAdjustment = raw.wiScheduleIAdjustment === null || raw.wiScheduleIAdjustment === undefined || String(raw.wiScheduleIAdjustment).trim() === "" ? null : toNumber(raw.wiScheduleIAdjustment);
  out.wiScheduleADAdditions = raw.wiScheduleADAdditions === null || raw.wiScheduleADAdditions === undefined || String(raw.wiScheduleADAdditions).trim() === "" ? null : toNumber(raw.wiScheduleADAdditions);
  out.wiScheduleSBSubtractions = raw.wiScheduleSBSubtractions === null || raw.wiScheduleSBSubtractions === undefined || String(raw.wiScheduleSBSubtractions).trim() === "" ? null : toNumber(raw.wiScheduleSBSubtractions);
  out.wiShortPeriodOrPossessions = raw.wiShortPeriodOrPossessions === null || raw.wiShortPeriodOrPossessions === undefined || String(raw.wiShortPeriodOrPossessions).trim() === "" ? null : toBoolean(raw.wiShortPeriodOrPossessions);
  out.wiSpouseCanBeClaimedAsDependent = raw.wiSpouseCanBeClaimedAsDependent === null || raw.wiSpouseCanBeClaimedAsDependent === undefined || String(raw.wiSpouseCanBeClaimedAsDependent).trim() === "" ? null : toBoolean(raw.wiSpouseCanBeClaimedAsDependent);
  out.wiDependentEarnedIncome = raw.wiDependentEarnedIncome === null || raw.wiDependentEarnedIncome === undefined || String(raw.wiDependentEarnedIncome).trim() === "" ? null : toNumber(raw.wiDependentEarnedIncome);
  out.wiUsedNewRetirementIncomeSubtraction = raw.wiUsedNewRetirementIncomeSubtraction === null || raw.wiUsedNewRetirementIncomeSubtraction === undefined || String(raw.wiUsedNewRetirementIncomeSubtraction).trim() === "" ? null : toBoolean(raw.wiUsedNewRetirementIncomeSubtraction);
  out.wiNonrefundableCredits = raw.wiNonrefundableCredits === null || raw.wiNonrefundableCredits === undefined || String(raw.wiNonrefundableCredits).trim() === "" ? null : toNumber(raw.wiNonrefundableCredits);
  out.wiClaimedFederalEIC = raw.wiClaimedFederalEIC === null || raw.wiClaimedFederalEIC === undefined || String(raw.wiClaimedFederalEIC).trim() === "" ? null : toBoolean(raw.wiClaimedFederalEIC);
  out.wiFederalEICAmount = raw.wiFederalEICAmount === null || raw.wiFederalEICAmount === undefined || String(raw.wiFederalEICAmount).trim() === "" ? null : toNumber(raw.wiFederalEICAmount);
  out.wiEICQualifyingChildren = raw.wiEICQualifyingChildren === null || raw.wiEICQualifyingChildren === undefined || String(raw.wiEICQualifyingChildren).trim() === "" ? null : toInteger(raw.wiEICQualifyingChildren);
  out.wiOtherRefundableCredits = raw.wiOtherRefundableCredits === null || raw.wiOtherRefundableCredits === undefined || String(raw.wiOtherRefundableCredits).trim() === "" ? null : toNumber(raw.wiOtherRefundableCredits);
  out.wiUseTax = raw.wiUseTax === null || raw.wiUseTax === undefined || String(raw.wiUseTax).trim() === "" ? null : toNumber(raw.wiUseTax);
  out.wiDonations = raw.wiDonations === null || raw.wiDonations === undefined || String(raw.wiDonations).trim() === "" ? null : toNumber(raw.wiDonations);
  out.wiRetirementPenaltiesAndCreditRepayments = raw.wiRetirementPenaltiesAndCreditRepayments === null || raw.wiRetirementPenaltiesAndCreditRepayments === undefined || String(raw.wiRetirementPenaltiesAndCreditRepayments).trim() === "" ? null : toNumber(raw.wiRetirementPenaltiesAndCreditRepayments);
  out.wiEstimatedPayments = raw.wiEstimatedPayments === null || raw.wiEstimatedPayments === undefined || String(raw.wiEstimatedPayments).trim() === "" ? null : toNumber(raw.wiEstimatedPayments);
  out.wiUnderpaymentInterest = raw.wiUnderpaymentInterest === null || raw.wiUnderpaymentInterest === undefined || String(raw.wiUnderpaymentInterest).trim() === "" ? null : toNumber(raw.wiUnderpaymentInterest);
  out.wiHasOtherStateCreditOrReciprocity = raw.wiHasOtherStateCreditOrReciprocity === null || raw.wiHasOtherStateCreditOrReciprocity === undefined || String(raw.wiHasOtherStateCreditOrReciprocity).trim() === "" ? null : toBoolean(raw.wiHasOtherStateCreditOrReciprocity);
  out.wiHasAmendedOrOtherSpecialItems = raw.wiHasAmendedOrOtherSpecialItems === null || raw.wiHasAmendedOrOtherSpecialItems === undefined || String(raw.wiHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.wiHasAmendedOrOtherSpecialItems);

  out.miFullYearResident =
    raw.miFullYearResident === null || raw.miFullYearResident === undefined || String(raw.miFullYearResident).trim() === ""
      ? null : toBoolean(raw.miFullYearResident);
  out.miMfsMichiganFilingChoice = String(raw.miMfsMichiganFilingChoice || "").trim().toLowerCase();
  out.miOtherAdditions = raw.miOtherAdditions === null || raw.miOtherAdditions === undefined || String(raw.miOtherAdditions).trim() === "" ? null : toNumber(raw.miOtherAdditions);
  out.miTaxableSocialSecurity = raw.miTaxableSocialSecurity === null || raw.miTaxableSocialSecurity === undefined || String(raw.miTaxableSocialSecurity).trim() === "" ? null : toNumber(raw.miTaxableSocialSecurity);
  out.miOtherSubtractions = raw.miOtherSubtractions === null || raw.miOtherSubtractions === undefined || String(raw.miOtherSubtractions).trim() === "" ? null : toNumber(raw.miOtherSubtractions);
  out.miSpecialExemptionCount = raw.miSpecialExemptionCount === null || raw.miSpecialExemptionCount === undefined || String(raw.miSpecialExemptionCount).trim() === "" ? null : toInteger(raw.miSpecialExemptionCount);
  out.miQualifiedDisabledVeteranCount = raw.miQualifiedDisabledVeteranCount === null || raw.miQualifiedDisabledVeteranCount === undefined || String(raw.miQualifiedDisabledVeteranCount).trim() === "" ? null : toInteger(raw.miQualifiedDisabledVeteranCount);
  out.miStillbirthCount = raw.miStillbirthCount === null || raw.miStillbirthCount === undefined || String(raw.miStillbirthCount).trim() === "" ? null : toInteger(raw.miStillbirthCount);
  out.miClaimedFederalEIC = raw.miClaimedFederalEIC === null || raw.miClaimedFederalEIC === undefined || String(raw.miClaimedFederalEIC).trim() === "" ? null : toBoolean(raw.miClaimedFederalEIC);
  out.miFederalEICAmount = toNumber(raw.miFederalEICAmount) ?? 0;
  out.miHasRetirementPensionOrSeniorDeduction = raw.miHasRetirementPensionOrSeniorDeduction === null || raw.miHasRetirementPensionOrSeniorDeduction === undefined || String(raw.miHasRetirementPensionOrSeniorDeduction).trim() === "" ? null : toBoolean(raw.miHasRetirementPensionOrSeniorDeduction);
  out.miHasPA24DecouplingAdjustment = raw.miHasPA24DecouplingAdjustment === null || raw.miHasPA24DecouplingAdjustment === undefined || String(raw.miHasPA24DecouplingAdjustment).trim() === "" ? null : toBoolean(raw.miHasPA24DecouplingAdjustment);
  out.miHasOtherStateCreditOrAllocation = raw.miHasOtherStateCreditOrAllocation === null || raw.miHasOtherStateCreditOrAllocation === undefined || String(raw.miHasOtherStateCreditOrAllocation).trim() === "" ? null : toBoolean(raw.miHasOtherStateCreditOrAllocation);
  out.miHasDetroitCityReturn = raw.miHasDetroitCityReturn === null || raw.miHasDetroitCityReturn === undefined || String(raw.miHasDetroitCityReturn).trim() === "" ? null : toBoolean(raw.miHasDetroitCityReturn);
  out.miHasUseTax = raw.miHasUseTax === null || raw.miHasUseTax === undefined || String(raw.miHasUseTax).trim() === "" ? null : toBoolean(raw.miHasUseTax);
  out.miUseTax = toNumber(raw.miUseTax) ?? 0;
  out.miEstimatedAndExtensionPayments = toNumber(raw.miEstimatedAndExtensionPayments) ?? 0;
  out.miHasSeparateRefundableCredits = raw.miHasSeparateRefundableCredits === null || raw.miHasSeparateRefundableCredits === undefined || String(raw.miHasSeparateRefundableCredits).trim() === "" ? null : toBoolean(raw.miHasSeparateRefundableCredits);
  out.miHasOtherSpecialItems = raw.miHasOtherSpecialItems === null || raw.miHasOtherSpecialItems === undefined || String(raw.miHasOtherSpecialItems).trim() === "" ? null : toBoolean(raw.miHasOtherSpecialItems);

  out.wvFullYearResident =
    raw.wvFullYearResident === null ||
    raw.wvFullYearResident === undefined ||
    String(raw.wvFullYearResident).trim() === ""
      ? null
      : toBoolean(raw.wvFullYearResident);

  out.wvTotalAdditions =
    raw.wvTotalAdditions === null ||
    raw.wvTotalAdditions === undefined ||
    String(raw.wvTotalAdditions).trim() === ""
      ? null
      : toNumber(raw.wvTotalAdditions);

  out.wvOtherSubtractions =
    raw.wvOtherSubtractions === null ||
    raw.wvOtherSubtractions === undefined ||
    String(raw.wvOtherSubtractions).trim() === ""
      ? null
      : toNumber(raw.wvOtherSubtractions);

  out.wvTaxableSocialSecurity =
    raw.wvTaxableSocialSecurity === null ||
    raw.wvTaxableSocialSecurity === undefined ||
    String(raw.wvTaxableSocialSecurity).trim() === ""
      ? null
      : toNumber(raw.wvTaxableSocialSecurity);

  out.wvLowIncomeEarnedIncome =
    raw.wvLowIncomeEarnedIncome === null ||
    raw.wvLowIncomeEarnedIncome === undefined ||
    String(raw.wvLowIncomeEarnedIncome).trim() === ""
      ? null
      : toNumber(raw.wvLowIncomeEarnedIncome);

  out.wvSpouseCanBeClaimedAsDependent =
    raw.wvSpouseCanBeClaimedAsDependent === null ||
    raw.wvSpouseCanBeClaimedAsDependent === undefined ||
    String(raw.wvSpouseCanBeClaimedAsDependent).trim() === ""
      ? null
      : toBoolean(raw.wvSpouseCanBeClaimedAsDependent);

  out.wvSurvivingSpouseExemption =
    raw.wvSurvivingSpouseExemption === null ||
    raw.wvSurvivingSpouseExemption === undefined ||
    String(raw.wvSurvivingSpouseExemption).trim() === ""
      ? null
      : toBoolean(raw.wvSurvivingSpouseExemption);

  out.wvTaxExemptInterestForFamilyCredit =
    raw.wvTaxExemptInterestForFamilyCredit === null ||
    raw.wvTaxExemptInterestForFamilyCredit === undefined ||
    String(raw.wvTaxExemptInterestForFamilyCredit).trim() === ""
      ? null
      : toNumber(raw.wvTaxExemptInterestForFamilyCredit);

  out.wvFederalAMT =
    raw.wvFederalAMT === null ||
    raw.wvFederalAMT === undefined ||
    String(raw.wvFederalAMT).trim() === ""
      ? null
      : toBoolean(raw.wvFederalAMT);

  out.wvHasChildDependentCareCredit =
    raw.wvHasChildDependentCareCredit === null ||
    raw.wvHasChildDependentCareCredit === undefined ||
    String(raw.wvHasChildDependentCareCredit).trim() === ""
      ? null
      : toBoolean(raw.wvHasChildDependentCareCredit);

  out.wvFederalChildDependentCareCredit =
    toNumber(raw.wvFederalChildDependentCareCredit) ?? 0;

  out.wvHasOtherStateTaxCredit =
    raw.wvHasOtherStateTaxCredit === null ||
    raw.wvHasOtherStateTaxCredit === undefined ||
    String(raw.wvHasOtherStateTaxCredit).trim() === ""
      ? null
      : toBoolean(raw.wvHasOtherStateTaxCredit);

  out.wvHasUseTax =
    raw.wvHasUseTax === null ||
    raw.wvHasUseTax === undefined ||
    String(raw.wvHasUseTax).trim() === ""
      ? null
      : toBoolean(raw.wvHasUseTax);

  out.wvUseTax = toNumber(raw.wvUseTax) ?? 0;
  out.wvEstimatedAndExtensionPayments =
    toNumber(raw.wvEstimatedAndExtensionPayments) ?? 0;

  out.wvHasOtherSpecialItems =
    raw.wvHasOtherSpecialItems === null ||
    raw.wvHasOtherSpecialItems === undefined ||
    String(raw.wvHasOtherSpecialItems).trim() === ""
      ? null
      : toBoolean(raw.wvHasOtherSpecialItems);

  out.vaFullYearResident =
    raw.vaFullYearResident === null ||
    raw.vaFullYearResident === undefined ||
    String(raw.vaFullYearResident).trim() === ""
      ? null
      : toBoolean(raw.vaFullYearResident);

  out.vaFederalItemized =
    raw.vaFederalItemized === null ||
    raw.vaFederalItemized === undefined ||
    String(raw.vaFederalItemized).trim() === ""
      ? null
      : toBoolean(raw.vaFederalItemized);

  out.vaItemizedDeductions =
    raw.vaItemizedDeductions === null ||
    raw.vaItemizedDeductions === undefined ||
    String(raw.vaItemizedDeductions).trim() === ""
      ? null
      : toNumber(raw.vaItemizedDeductions);

  out.vaDependentEarnedIncome =
    raw.vaDependentEarnedIncome === null ||
    raw.vaDependentEarnedIncome === undefined ||
    String(raw.vaDependentEarnedIncome).trim() === ""
      ? null
      : toNumber(raw.vaDependentEarnedIncome);

  out.vaTotalAdditions =
    raw.vaTotalAdditions === null ||
    raw.vaTotalAdditions === undefined ||
    String(raw.vaTotalAdditions).trim() === ""
      ? null
      : toNumber(raw.vaTotalAdditions);
  out.vaAgeDeduction =
    raw.vaAgeDeduction === null ||
    raw.vaAgeDeduction === undefined ||
    String(raw.vaAgeDeduction).trim() === ""
      ? null
      : toNumber(raw.vaAgeDeduction);
  out.vaTaxableSocialSecurityTier1 =
    raw.vaTaxableSocialSecurityTier1 === null ||
    raw.vaTaxableSocialSecurityTier1 === undefined ||
    String(raw.vaTaxableSocialSecurityTier1).trim() === ""
      ? null
      : toNumber(raw.vaTaxableSocialSecurityTier1);
  out.vaStateIncomeTaxRefund =
    raw.vaStateIncomeTaxRefund === null ||
    raw.vaStateIncomeTaxRefund === undefined ||
    String(raw.vaStateIncomeTaxRefund).trim() === ""
      ? null
      : toNumber(raw.vaStateIncomeTaxRefund);
  out.vaOtherSubtractions =
    raw.vaOtherSubtractions === null ||
    raw.vaOtherSubtractions === undefined ||
    String(raw.vaOtherSubtractions).trim() === ""
      ? null
      : toNumber(raw.vaOtherSubtractions);
  out.vaOtherDeductions =
    raw.vaOtherDeductions === null ||
    raw.vaOtherDeductions === undefined ||
    String(raw.vaOtherDeductions).trim() === ""
      ? null
      : toNumber(raw.vaOtherDeductions);

  out.vaAge65OrOlderCount =
    raw.vaAge65OrOlderCount === null ||
    raw.vaAge65OrOlderCount === undefined ||
    String(raw.vaAge65OrOlderCount).trim() === ""
      ? null
      : toInteger(raw.vaAge65OrOlderCount);
  out.vaBlindCount =
    raw.vaBlindCount === null ||
    raw.vaBlindCount === undefined ||
    String(raw.vaBlindCount).trim() === ""
      ? null
      : toInteger(raw.vaBlindCount);

  out.vaSpouseTaxAdjustment =
    raw.vaSpouseTaxAdjustment === null ||
    raw.vaSpouseTaxAdjustment === undefined ||
    String(raw.vaSpouseTaxAdjustment).trim() === ""
      ? null
      : toNumber(raw.vaSpouseTaxAdjustment);

  out.vaIncomeBasedCreditType =
    typeof raw.vaIncomeBasedCreditType === "string"
      ? raw.vaIncomeBasedCreditType.trim().toLowerCase()
      : raw.vaIncomeBasedCreditType;

  out.vaIncomeBasedCreditAmount =
    toNumber(raw.vaIncomeBasedCreditAmount) ?? 0;

  out.vaHasOtherStateTaxCredit =
    raw.vaHasOtherStateTaxCredit === null ||
    raw.vaHasOtherStateTaxCredit === undefined ||
    String(raw.vaHasOtherStateTaxCredit).trim() === ""
      ? null
      : toBoolean(raw.vaHasOtherStateTaxCredit);

  out.vaHasUseTax =
    raw.vaHasUseTax === null ||
    raw.vaHasUseTax === undefined ||
    String(raw.vaHasUseTax).trim() === ""
      ? null
      : toBoolean(raw.vaHasUseTax);
  out.vaUseTax = toNumber(raw.vaUseTax) ?? 0;

  out.vaEstimatedTaxPayments =
    toNumber(raw.vaEstimatedTaxPayments) ?? 0;
  out.vaPriorYearOverpaymentApplied =
    toNumber(raw.vaPriorYearOverpaymentApplied) ?? 0;
  out.vaExtensionPayment =
    toNumber(raw.vaExtensionPayment) ?? 0;
  out.vaOtherWithholding =
    toNumber(raw.vaOtherWithholding) ?? 0;

  out.vaHasOtherSpecialItems =
    raw.vaHasOtherSpecialItems === null ||
    raw.vaHasOtherSpecialItems === undefined ||
    String(raw.vaHasOtherSpecialItems).trim() === ""
      ? null
      : toBoolean(raw.vaHasOtherSpecialItems);

  out.scFullYearResident =
    raw.scFullYearResident === null ||
    raw.scFullYearResident === undefined ||
    String(raw.scFullYearResident).trim() === ""
      ? null
      : toBoolean(raw.scFullYearResident);

  out.scTotalAdditions =
    raw.scTotalAdditions === null ||
    raw.scTotalAdditions === undefined ||
    String(raw.scTotalAdditions).trim() === ""
      ? null
      : toNumber(raw.scTotalAdditions);
  out.scOtherSubtractions =
    raw.scOtherSubtractions === null ||
    raw.scOtherSubtractions === undefined ||
    String(raw.scOtherSubtractions).trim() === ""
      ? null
      : toNumber(raw.scOtherSubtractions);
  out.scDependentsUnder6 =
    raw.scDependentsUnder6 === null ||
    raw.scDependentsUnder6 === undefined ||
    String(raw.scDependentsUnder6).trim() === ""
      ? null
      : toInteger(raw.scDependentsUnder6);

  out.scHasChildDependentCareCredit =
    raw.scHasChildDependentCareCredit === null ||
    raw.scHasChildDependentCareCredit === undefined ||
    String(raw.scHasChildDependentCareCredit).trim() === ""
      ? null
      : toBoolean(raw.scHasChildDependentCareCredit);
  out.scFederalChildCareExpense =
    raw.scFederalChildCareExpense === null ||
    raw.scFederalChildCareExpense === undefined ||
    String(raw.scFederalChildCareExpense).trim() === ""
      ? null
      : toNumber(raw.scFederalChildCareExpense);
  out.scChildCareQualifyingPersons =
    raw.scChildCareQualifyingPersons === null ||
    raw.scChildCareQualifyingPersons === undefined ||
    String(raw.scChildCareQualifyingPersons).trim() === ""
      ? null
      : toInteger(raw.scChildCareQualifyingPersons);

  out.scHasTwoWageEarnerCredit =
    raw.scHasTwoWageEarnerCredit === null ||
    raw.scHasTwoWageEarnerCredit === undefined ||
    String(raw.scHasTwoWageEarnerCredit).trim() === ""
      ? null
      : toBoolean(raw.scHasTwoWageEarnerCredit);
  out.scTaxpayerQualifiedEarnedIncome =
    raw.scTaxpayerQualifiedEarnedIncome === null ||
    raw.scTaxpayerQualifiedEarnedIncome === undefined ||
    String(raw.scTaxpayerQualifiedEarnedIncome).trim() === ""
      ? null
      : toNumber(raw.scTaxpayerQualifiedEarnedIncome);
  out.scSpouseQualifiedEarnedIncome =
    raw.scSpouseQualifiedEarnedIncome === null ||
    raw.scSpouseQualifiedEarnedIncome === undefined ||
    String(raw.scSpouseQualifiedEarnedIncome).trim() === ""
      ? null
      : toNumber(raw.scSpouseQualifiedEarnedIncome);

  out.scClaimedFederalEIC =
    raw.scClaimedFederalEIC === null ||
    raw.scClaimedFederalEIC === undefined ||
    String(raw.scClaimedFederalEIC).trim() === ""
      ? null
      : toBoolean(raw.scClaimedFederalEIC);
  out.scFederalEICAmount =
    raw.scFederalEICAmount === null ||
    raw.scFederalEICAmount === undefined ||
    String(raw.scFederalEICAmount).trim() === ""
      ? null
      : toNumber(raw.scFederalEICAmount);

  out.scHasOtherStateTaxCredit =
    raw.scHasOtherStateTaxCredit === null ||
    raw.scHasOtherStateTaxCredit === undefined ||
    String(raw.scHasOtherStateTaxCredit).trim() === ""
      ? null
      : toBoolean(raw.scHasOtherStateTaxCredit);
  out.scHasUseTax =
    raw.scHasUseTax === null ||
    raw.scHasUseTax === undefined ||
    String(raw.scHasUseTax).trim() === ""
      ? null
      : toBoolean(raw.scHasUseTax);
  out.scUseTax =
    raw.scUseTax === null ||
    raw.scUseTax === undefined ||
    String(raw.scUseTax).trim() === ""
      ? null
      : toNumber(raw.scUseTax);

  out.scEstimatedTaxPayments = toNumber(raw.scEstimatedTaxPayments) ?? 0;
  out.scExtensionPayment = toNumber(raw.scExtensionPayment) ?? 0;
  out.scOtherWithholding = toNumber(raw.scOtherWithholding) ?? 0;

  out.scHasOtherSpecialItems =
    raw.scHasOtherSpecialItems === null ||
    raw.scHasOtherSpecialItems === undefined ||
    String(raw.scHasOtherSpecialItems).trim() === ""
      ? null
      : toBoolean(raw.scHasOtherSpecialItems);

  out.okFullYearResident =
    raw.okFullYearResident === null ||
    raw.okFullYearResident === undefined ||
    String(raw.okFullYearResident).trim() === ""
      ? null
      : toBoolean(raw.okFullYearResident);

  out.okHasNonresidentSpouseAllocation =
    raw.okHasNonresidentSpouseAllocation === null ||
    raw.okHasNonresidentSpouseAllocation === undefined ||
    String(raw.okHasNonresidentSpouseAllocation).trim() === ""
      ? null
      : toBoolean(raw.okHasNonresidentSpouseAllocation);

  out.okHasOutOfStatePropertyBusinessIncome =
    raw.okHasOutOfStatePropertyBusinessIncome === null ||
    raw.okHasOutOfStatePropertyBusinessIncome === undefined ||
    String(raw.okHasOutOfStatePropertyBusinessIncome).trim() === ""
      ? null
      : toBoolean(raw.okHasOutOfStatePropertyBusinessIncome);

  out.okOklahomaAGI =
    raw.okOklahomaAGI === null ||
    raw.okOklahomaAGI === undefined ||
    String(raw.okOklahomaAGI).trim() === ""
      ? null
      : toNumber(raw.okOklahomaAGI);

  out.okOklahomaIncomeAfterAdjustments =
    raw.okOklahomaIncomeAfterAdjustments === null ||
    raw.okOklahomaIncomeAfterAdjustments === undefined ||
    String(raw.okOklahomaIncomeAfterAdjustments).trim() === ""
      ? null
      : toNumber(raw.okOklahomaIncomeAfterAdjustments);

  out.okFederalItemized =
    raw.okFederalItemized === null ||
    raw.okFederalItemized === undefined ||
    String(raw.okFederalItemized).trim() === ""
      ? null
      : toBoolean(raw.okFederalItemized);

  out.okItemizedDeductions =
    raw.okItemizedDeductions === null ||
    raw.okItemizedDeductions === undefined ||
    String(raw.okItemizedDeductions).trim() === ""
      ? null
      : toNumber(raw.okItemizedDeductions);
  out.okRegularExemptions =
    raw.okRegularExemptions === null ||
    raw.okRegularExemptions === undefined ||
    String(raw.okRegularExemptions).trim() === ""
      ? null
      : toInteger(raw.okRegularExemptions);
  out.okSpecial65Exemptions =
    raw.okSpecial65Exemptions === null ||
    raw.okSpecial65Exemptions === undefined ||
    String(raw.okSpecial65Exemptions).trim() === ""
      ? null
      : toInteger(raw.okSpecial65Exemptions);
  out.okBlindExemptions =
    raw.okBlindExemptions === null ||
    raw.okBlindExemptions === undefined ||
    String(raw.okBlindExemptions).trim() === ""
      ? null
      : toInteger(raw.okBlindExemptions);
  out.okQualifyingDependents =
    raw.okQualifyingDependents === null ||
    raw.okQualifyingDependents === undefined ||
    String(raw.okQualifyingDependents).trim() === ""
      ? null
      : toInteger(raw.okQualifyingDependents);

  out.okHasFederalChildOrCareCredit =
    raw.okHasFederalChildOrCareCredit === null ||
    raw.okHasFederalChildOrCareCredit === undefined ||
    String(raw.okHasFederalChildOrCareCredit).trim() === ""
      ? null
      : toBoolean(raw.okHasFederalChildOrCareCredit);

  out.okFederalChildCareCredit =
    toNumber(raw.okFederalChildCareCredit) ?? 0;
  out.okFederalChildTaxCreditTotal =
    toNumber(raw.okFederalChildTaxCreditTotal) ?? 0;

  out.okHasOklahomaEIC =
    raw.okHasOklahomaEIC === null ||
    raw.okHasOklahomaEIC === undefined ||
    String(raw.okHasOklahomaEIC).trim() === ""
      ? null
      : toBoolean(raw.okHasOklahomaEIC);

  out.okFederalEIC2020Law =
    toNumber(raw.okFederalEIC2020Law) ?? 0;
  out.okUseTax =
    toNumber(raw.okUseTax) ?? 0;
  out.okEstimatedTaxPayments =
    toNumber(raw.okEstimatedTaxPayments) ?? 0;
  out.okExtensionPayment =
    toNumber(raw.okExtensionPayment) ?? 0;

  out.okHasOtherSpecialItems =
    raw.okHasOtherSpecialItems === null ||
    raw.okHasOtherSpecialItems === undefined ||
    String(raw.okHasOtherSpecialItems).trim() === ""
      ? null
      : toBoolean(raw.okHasOtherSpecialItems);

  out.arFullYearResident =
    raw.arFullYearResident === null ||
    raw.arFullYearResident === undefined ||
    String(raw.arFullYearResident).trim() === ""
      ? null
      : toBoolean(raw.arFullYearResident);

  out.arArkansasTotalIncome =
    raw.arArkansasTotalIncome === null ||
    raw.arArkansasTotalIncome === undefined ||
    String(raw.arArkansasTotalIncome).trim() === ""
      ? null
      : toNumber(raw.arArkansasTotalIncome);

  out.arArkansasAGI =
    raw.arArkansasAGI === null ||
    raw.arArkansasAGI === undefined ||
    String(raw.arArkansasAGI).trim() === ""
      ? null
      : toNumber(raw.arArkansasAGI);

  out.arItemizedDeductions =
    toNumber(raw.arItemizedDeductions) ?? 0;
  out.arQualifyingDependents =
    toInteger(raw.arQualifyingDependents) ?? 0;
  out.arAdditionalPersonalCreditBoxes =
    toInteger(raw.arAdditionalPersonalCreditBoxes) ?? 0;

  out.arMfsSameReturn =
    raw.arMfsSameReturn === null ||
    raw.arMfsSameReturn === undefined ||
    String(raw.arMfsSameReturn).trim() === ""
      ? null
      : toBoolean(raw.arMfsSameReturn);

  out.arMfsSpouseItemizes =
    raw.arMfsSpouseItemizes === null ||
    raw.arMfsSpouseItemizes === undefined ||
    String(raw.arMfsSpouseItemizes).trim() === ""
      ? null
      : toBoolean(raw.arMfsSpouseItemizes);

  out.arSurvivingSpouseConfirmed =
    raw.arSurvivingSpouseConfirmed === null ||
    raw.arSurvivingSpouseConfirmed === undefined ||
    String(raw.arSurvivingSpouseConfirmed).trim() === ""
      ? null
      : toBoolean(raw.arSurvivingSpouseConfirmed);

  out.arEstimatedTaxPayments =
    toNumber(raw.arEstimatedTaxPayments) ?? 0;
  out.arExtensionPayment =
    toNumber(raw.arExtensionPayment) ?? 0;

  out.arHasOtherSpecialItems =
    raw.arHasOtherSpecialItems === null ||
    raw.arHasOtherSpecialItems === undefined ||
    String(raw.arHasOtherSpecialItems).trim() === ""
      ? null
      : toBoolean(raw.arHasOtherSpecialItems);

  out.laFullYearResident =
    raw.laFullYearResident === null ||
    raw.laFullYearResident === undefined ||
    String(raw.laFullYearResident).trim() === ""
      ? null
      : toBoolean(raw.laFullYearResident);

  out.laFederalReturnRequired =
    raw.laFederalReturnRequired === null ||
    raw.laFederalReturnRequired === undefined ||
    String(raw.laFederalReturnRequired).trim() === ""
      ? null
      : toBoolean(raw.laFederalReturnRequired);

  out.laUsesScheduleE =
    raw.laUsesScheduleE === null ||
    raw.laUsesScheduleE === undefined ||
    String(raw.laUsesScheduleE).trim() === ""
      ? null
      : toBoolean(raw.laUsesScheduleE);

  out.laScheduleEAdjustedGrossIncome =
    raw.laScheduleEAdjustedGrossIncome === null ||
    raw.laScheduleEAdjustedGrossIncome === undefined ||
    String(raw.laScheduleEAdjustedGrossIncome).trim() === ""
      ? null
      : toNumber(raw.laScheduleEAdjustedGrossIncome);

  out.laFederalItemized =
    raw.laFederalItemized === null ||
    raw.laFederalItemized === undefined ||
    String(raw.laFederalItemized).trim() === ""
      ? null
      : toBoolean(raw.laFederalItemized);

  out.laFederalMedicalDentalDeduction =
    raw.laFederalMedicalDentalDeduction === null ||
    raw.laFederalMedicalDentalDeduction === undefined ||
    String(raw.laFederalMedicalDentalDeduction).trim() === ""
      ? null
      : toNumber(raw.laFederalMedicalDentalDeduction);

  out.laClaimedFederalEIC =
    raw.laClaimedFederalEIC === null ||
    raw.laClaimedFederalEIC === undefined ||
    String(raw.laClaimedFederalEIC).trim() === ""
      ? null
      : toBoolean(raw.laClaimedFederalEIC);

  out.laFederalEICAmount =
    raw.laFederalEICAmount === null ||
    raw.laFederalEICAmount === undefined ||
    String(raw.laFederalEICAmount).trim() === ""
      ? null
      : toNumber(raw.laFederalEICAmount);

  out.laEstimatedTaxPayments =
    toNumber(raw.laEstimatedTaxPayments) ?? 0;
  out.laExtensionPayment =
    toNumber(raw.laExtensionPayment) ?? 0;

  out.laHasOtherSpecialItems =
    raw.laHasOtherSpecialItems === null ||
    raw.laHasOtherSpecialItems === undefined ||
    String(raw.laHasOtherSpecialItems).trim() === ""
      ? null
      : toBoolean(raw.laHasOtherSpecialItems);

  out.ncSpouseItemizes =
    raw.ncSpouseItemizes === null ||
    raw.ncSpouseItemizes === undefined ||
    String(raw.ncSpouseItemizes).trim() === ""
      ? null
      : toBoolean(raw.ncSpouseItemizes);

  // State Code â€” uppercase and trim
  out.stateCode = (typeof raw.stateCode === "string")
    ? raw.stateCode.trim().toUpperCase()
    : raw.stateCode;

  // Integer counts
  out.numberOfDependents =
    toInteger(raw.numberOfDependents) ?? 0;
  out.ctcQualifyingChildren =
    toInteger(raw.ctcQualifyingChildren) ?? 0;
  out.dependentsUnder17 =
    raw.dependentsUnder17 === null ||
    raw.dependentsUnder17 === undefined ||
    String(raw.dependentsUnder17).trim() === ""
      ? null
      : toInteger(raw.dependentsUnder17);
  out.gaUnbornDependents =
    toInteger(raw.gaUnbornDependents) ?? 0;

  out.kyFamilySize =
    raw.kyFamilySize === null ||
    raw.kyFamilySize === undefined ||
    String(raw.kyFamilySize).trim() === ""
      ? null
      : toInteger(raw.kyFamilySize);

  out.kyItemizedDeductions =
    toNumber(raw.kyItemizedDeductions) ?? 0;
  out.kyTaxpayerRetirementIncome =
    toNumber(raw.kyTaxpayerRetirementIncome) ?? 0;
  out.kySpouseRetirementIncome =
    toNumber(raw.kySpouseRetirementIncome) ?? 0;

  out.kySpecialPensionOverLimit =
    raw.kySpecialPensionOverLimit === null ||
    raw.kySpecialPensionOverLimit === undefined ||
    String(raw.kySpecialPensionOverLimit).trim() === ""
      ? null
      : toBoolean(raw.kySpecialPensionOverLimit);

  out.kyHasOtherStateModifications =
    raw.kyHasOtherStateModifications === null ||
    raw.kyHasOtherStateModifications === undefined ||
    String(raw.kyHasOtherStateModifications).trim() === ""
      ? null
      : toBoolean(raw.kyHasOtherStateModifications);

  out.kyHasChildDependentCareCredit =
    raw.kyHasChildDependentCareCredit === null ||
    raw.kyHasChildDependentCareCredit === undefined ||
    String(raw.kyHasChildDependentCareCredit).trim() === ""
      ? null
      : toBoolean(raw.kyHasChildDependentCareCredit);

  out.kyTaxpayerSpecialPersonalCredit =
    toNumber(raw.kyTaxpayerSpecialPersonalCredit) ?? 0;
  out.kySpouseSpecialPersonalCredit =
    toNumber(raw.kySpouseSpecialPersonalCredit) ?? 0;

  out.msItemizedDeductions =
    toNumber(raw.msItemizedDeductions) ?? 0;
  out.msExemptRetirementIncome =
    toNumber(raw.msExemptRetirementIncome) ?? 0;
  out.msTaxpayerBlind =
    toBoolean(raw.msTaxpayerBlind);
  out.msSpouseBlind =
    toBoolean(raw.msSpouseBlind);

  out.msSpouseShareOfMississippiAGI =
    raw.msSpouseShareOfMississippiAGI === null ||
    raw.msSpouseShareOfMississippiAGI === undefined ||
    String(raw.msSpouseShareOfMississippiAGI).trim() === ""
      ? null
      : toNumber(raw.msSpouseShareOfMississippiAGI);

  out.msHeadOfFamilyDependentLivedAllYear =
    raw.msHeadOfFamilyDependentLivedAllYear === null ||
    raw.msHeadOfFamilyDependentLivedAllYear === undefined ||
    String(raw.msHeadOfFamilyDependentLivedAllYear).trim() === ""
      ? null
      : toBoolean(raw.msHeadOfFamilyDependentLivedAllYear);

  out.msHasDependentCareCredit =
    toBoolean(raw.msHasDependentCareCredit);

  out.msHasOtherStateModifications =
    raw.msHasOtherStateModifications === null ||
    raw.msHasOtherStateModifications === undefined ||
    String(raw.msHasOtherStateModifications).trim() === ""
      ? null
      : toBoolean(raw.msHasOtherStateModifications);

  // Dollar amounts â€” floor to 2 decimal places, never negative
  const moneyFields = [
  "w2Income",
  "w2SocialSecurityWages",
  "w2MedicareWages",
  "w2MedicareTaxWithheld",
  "federalWithheld",
  "stateWithheld",
  "otherIncome",
  "scholarships",
  "educationExpenses",

  // ðŸ”¥ ADD THESE
  "selfEmploymentIncome",
  "businessExpenses",
  "businessMileage",
  "businessMileageJanJun",
  "businessMileageJulDec",
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


  out.deFullYearResident = raw.deFullYearResident === null || raw.deFullYearResident === undefined || String(raw.deFullYearResident).trim() === "" ? null : toBoolean(raw.deFullYearResident);
  out.deFilingStatusMatchesFederal = raw.deFilingStatusMatchesFederal === null || raw.deFilingStatusMatchesFederal === undefined || String(raw.deFilingStatusMatchesFederal).trim() === "" ? null : toBoolean(raw.deFilingStatusMatchesFederal);
  out.deAdditions = raw.deAdditions === null || raw.deAdditions === undefined || String(raw.deAdditions).trim() === "" ? null : toNumber(raw.deAdditions);
  out.deSubtractions = raw.deSubtractions === null || raw.deSubtractions === undefined || String(raw.deSubtractions).trim() === "" ? null : toNumber(raw.deSubtractions);
  out.deDeductionMethod = raw.deDeductionMethod === null || raw.deDeductionMethod === undefined || String(raw.deDeductionMethod).trim() === "" ? "" : String(raw.deDeductionMethod).trim().toLowerCase();
  out.deItemizedDeductionAmount = raw.deItemizedDeductionAmount === null || raw.deItemizedDeductionAmount === undefined || String(raw.deItemizedDeductionAmount).trim() === "" ? null : toNumber(raw.deItemizedDeductionAmount);
  out.deTaxpayerBlind = raw.deTaxpayerBlind === null || raw.deTaxpayerBlind === undefined || String(raw.deTaxpayerBlind).trim() === "" ? null : toBoolean(raw.deTaxpayerBlind);
  out.deSpouseBlind = raw.deSpouseBlind === null || raw.deSpouseBlind === undefined || String(raw.deSpouseBlind).trim() === "" ? null : toBoolean(raw.deSpouseBlind);
  out.deHasLumpSumDistribution = raw.deHasLumpSumDistribution === null || raw.deHasLumpSumDistribution === undefined || String(raw.deHasLumpSumDistribution).trim() === "" ? null : toBoolean(raw.deHasLumpSumDistribution);
  out.deHasOtherStateCredit = raw.deHasOtherStateCredit === null || raw.deHasOtherStateCredit === undefined || String(raw.deHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.deHasOtherStateCredit);
  out.deVolunteerFirefighterCount = raw.deVolunteerFirefighterCount === null || raw.deVolunteerFirefighterCount === undefined || String(raw.deVolunteerFirefighterCount).trim() === "" ? null : toNumber(raw.deVolunteerFirefighterCount);
  out.deFederalChildDependentCareCredit = raw.deFederalChildDependentCareCredit === null || raw.deFederalChildDependentCareCredit === undefined || String(raw.deFederalChildDependentCareCredit).trim() === "" ? null : toNumber(raw.deFederalChildDependentCareCredit);
  out.deOtherNonrefundableCredits = raw.deOtherNonrefundableCredits === null || raw.deOtherNonrefundableCredits === undefined || String(raw.deOtherNonrefundableCredits).trim() === "" ? null : toNumber(raw.deOtherNonrefundableCredits);
  out.deFederalEITCAmount = raw.deFederalEITCAmount === null || raw.deFederalEITCAmount === undefined || String(raw.deFederalEITCAmount).trim() === "" ? null : toNumber(raw.deFederalEITCAmount);
  out.deEstimatedPayments = raw.deEstimatedPayments === null || raw.deEstimatedPayments === undefined || String(raw.deEstimatedPayments).trim() === "" ? null : toNumber(raw.deEstimatedPayments);
  out.deSCorporationPayments = raw.deSCorporationPayments === null || raw.deSCorporationPayments === undefined || String(raw.deSCorporationPayments).trim() === "" ? null : toNumber(raw.deSCorporationPayments);
  out.deRealEstateCapitalGainsPayments = raw.deRealEstateCapitalGainsPayments === null || raw.deRealEstateCapitalGainsPayments === undefined || String(raw.deRealEstateCapitalGainsPayments).trim() === "" ? null : toNumber(raw.deRealEstateCapitalGainsPayments);
  out.deOtherRefundableCredits = raw.deOtherRefundableCredits === null || raw.deOtherRefundableCredits === undefined || String(raw.deOtherRefundableCredits).trim() === "" ? null : toNumber(raw.deOtherRefundableCredits);
  out.dePenaltyInterest = raw.dePenaltyInterest === null || raw.dePenaltyInterest === undefined || String(raw.dePenaltyInterest).trim() === "" ? null : toNumber(raw.dePenaltyInterest);
  out.deHasAmendedOrOtherSpecialItems = raw.deHasAmendedOrOtherSpecialItems === null || raw.deHasAmendedOrOtherSpecialItems === undefined || String(raw.deHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.deHasAmendedOrOtherSpecialItems);

  out.ctFullYearResident = raw.ctFullYearResident === null || raw.ctFullYearResident === undefined || String(raw.ctFullYearResident).trim() === "" ? null : toBoolean(raw.ctFullYearResident);
  out.ctFilingStatusMatchesFederal = raw.ctFilingStatusMatchesFederal === null || raw.ctFilingStatusMatchesFederal === undefined || String(raw.ctFilingStatusMatchesFederal).trim() === "" ? null : toBoolean(raw.ctFilingStatusMatchesFederal);
  out.ctAdditions = raw.ctAdditions === null || raw.ctAdditions === undefined || String(raw.ctAdditions).trim() === "" ? null : toNumber(raw.ctAdditions);
  out.ctSubtractions = raw.ctSubtractions === null || raw.ctSubtractions === undefined || String(raw.ctSubtractions).trim() === "" ? null : toNumber(raw.ctSubtractions);
  out.ctHasOtherStateCredit = raw.ctHasOtherStateCredit === null || raw.ctHasOtherStateCredit === undefined || String(raw.ctHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.ctHasOtherStateCredit);
  out.ctHasFederalAMT = raw.ctHasFederalAMT === null || raw.ctHasFederalAMT === undefined || String(raw.ctHasFederalAMT).trim() === "" ? null : toBoolean(raw.ctHasFederalAMT);
  out.ctAlternativeMinimumTax = raw.ctAlternativeMinimumTax === null || raw.ctAlternativeMinimumTax === undefined || String(raw.ctAlternativeMinimumTax).trim() === "" ? null : toNumber(raw.ctAlternativeMinimumTax);
  out.ctPropertyTaxCredit = raw.ctPropertyTaxCredit === null || raw.ctPropertyTaxCredit === undefined || String(raw.ctPropertyTaxCredit).trim() === "" ? null : toNumber(raw.ctPropertyTaxCredit);
  out.ctAllowableCredits = raw.ctAllowableCredits === null || raw.ctAllowableCredits === undefined || String(raw.ctAllowableCredits).trim() === "" ? null : toNumber(raw.ctAllowableCredits);
  out.ctUseTax = raw.ctUseTax === null || raw.ctUseTax === undefined || String(raw.ctUseTax).trim() === "" ? null : toNumber(raw.ctUseTax);
  out.ctEstimatedPayments = raw.ctEstimatedPayments === null || raw.ctEstimatedPayments === undefined || String(raw.ctEstimatedPayments).trim() === "" ? null : toNumber(raw.ctEstimatedPayments);
  out.ctExtensionPayment = raw.ctExtensionPayment === null || raw.ctExtensionPayment === undefined || String(raw.ctExtensionPayment).trim() === "" ? null : toNumber(raw.ctExtensionPayment);
  out.ctClaimedFederalEITC = raw.ctClaimedFederalEITC === null || raw.ctClaimedFederalEITC === undefined || String(raw.ctClaimedFederalEITC).trim() === "" ? null : toBoolean(raw.ctClaimedFederalEITC);
  out.ctFederalEITCAmount = raw.ctFederalEITCAmount === null || raw.ctFederalEITCAmount === undefined || String(raw.ctFederalEITCAmount).trim() === "" ? null : toNumber(raw.ctFederalEITCAmount);
  out.ctEitcHasQualifyingChild = raw.ctEitcHasQualifyingChild === null || raw.ctEitcHasQualifyingChild === undefined || String(raw.ctEitcHasQualifyingChild).trim() === "" ? null : toBoolean(raw.ctEitcHasQualifyingChild);
  out.ctOtherRefundableCredits = raw.ctOtherRefundableCredits === null || raw.ctOtherRefundableCredits === undefined || String(raw.ctOtherRefundableCredits).trim() === "" ? null : toNumber(raw.ctOtherRefundableCredits);
  out.ctRefundAllocations = raw.ctRefundAllocations === null || raw.ctRefundAllocations === undefined || String(raw.ctRefundAllocations).trim() === "" ? null : toNumber(raw.ctRefundAllocations);
  out.ctPenaltyInterest = raw.ctPenaltyInterest === null || raw.ctPenaltyInterest === undefined || String(raw.ctPenaltyInterest).trim() === "" ? null : toNumber(raw.ctPenaltyInterest);
  out.ctHasAmendedOrOtherSpecialItems = raw.ctHasAmendedOrOtherSpecialItems === null || raw.ctHasAmendedOrOtherSpecialItems === undefined || String(raw.ctHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.ctHasAmendedOrOtherSpecialItems);

  out.meFullYearResident = raw.meFullYearResident === null || raw.meFullYearResident === undefined || String(raw.meFullYearResident).trim() === "" ? null : toBoolean(raw.meFullYearResident);
  out.meFilingStatusMatchesFederal = raw.meFilingStatusMatchesFederal === null || raw.meFilingStatusMatchesFederal === undefined || String(raw.meFilingStatusMatchesFederal).trim() === "" ? null : toBoolean(raw.meFilingStatusMatchesFederal);
  out.meAdditions = raw.meAdditions === null || raw.meAdditions === undefined || String(raw.meAdditions).trim() === "" ? null : toNumber(raw.meAdditions);
  out.meSubtractions = raw.meSubtractions === null || raw.meSubtractions === undefined || String(raw.meSubtractions).trim() === "" ? null : toNumber(raw.meSubtractions);
  out.meFederalDeductionMethod = raw.meFederalDeductionMethod === null || raw.meFederalDeductionMethod === undefined ? "" : String(raw.meFederalDeductionMethod).trim().toLowerCase();
  out.meItemizedDeductionAmount = raw.meItemizedDeductionAmount === null || raw.meItemizedDeductionAmount === undefined || String(raw.meItemizedDeductionAmount).trim() === "" ? null : toNumber(raw.meItemizedDeductionAmount);
  out.meTaxpayerBlind = raw.meTaxpayerBlind === null || raw.meTaxpayerBlind === undefined || String(raw.meTaxpayerBlind).trim() === "" ? null : toBoolean(raw.meTaxpayerBlind);
  out.meSpouseBlind = raw.meSpouseBlind === null || raw.meSpouseBlind === undefined || String(raw.meSpouseBlind).trim() === "" ? null : toBoolean(raw.meSpouseBlind);
  out.meSpouseCanBeClaimedAsDependent = raw.meSpouseCanBeClaimedAsDependent === null || raw.meSpouseCanBeClaimedAsDependent === undefined || String(raw.meSpouseCanBeClaimedAsDependent).trim() === "" ? null : toBoolean(raw.meSpouseCanBeClaimedAsDependent);
  out.meDependentCreditAge6OrOlderCount = raw.meDependentCreditAge6OrOlderCount === null || raw.meDependentCreditAge6OrOlderCount === undefined || String(raw.meDependentCreditAge6OrOlderCount).trim() === "" ? null : toNumber(raw.meDependentCreditAge6OrOlderCount);
  out.meDependentCreditUnder6Count = raw.meDependentCreditUnder6Count === null || raw.meDependentCreditUnder6Count === undefined || String(raw.meDependentCreditUnder6Count).trim() === "" ? null : toNumber(raw.meDependentCreditUnder6Count);
  out.meTaxCreditRecapture = raw.meTaxCreditRecapture === null || raw.meTaxCreditRecapture === undefined || String(raw.meTaxCreditRecapture).trim() === "" ? null : toNumber(raw.meTaxCreditRecapture);
  out.meHasOtherStateCredit = raw.meHasOtherStateCredit === null || raw.meHasOtherStateCredit === undefined || String(raw.meHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.meHasOtherStateCredit);
  out.meOtherNonrefundableCredits = raw.meOtherNonrefundableCredits === null || raw.meOtherNonrefundableCredits === undefined || String(raw.meOtherNonrefundableCredits).trim() === "" ? null : toNumber(raw.meOtherNonrefundableCredits);
  out.meClaimedFederalEITC = raw.meClaimedFederalEITC === null || raw.meClaimedFederalEITC === undefined || String(raw.meClaimedFederalEITC).trim() === "" ? null : toBoolean(raw.meClaimedFederalEITC);
  out.meFederalEITCAmount = raw.meFederalEITCAmount === null || raw.meFederalEITCAmount === undefined || String(raw.meFederalEITCAmount).trim() === "" ? null : toNumber(raw.meFederalEITCAmount);
  out.meEitcHasQualifyingChild = raw.meEitcHasQualifyingChild === null || raw.meEitcHasQualifyingChild === undefined || String(raw.meEitcHasQualifyingChild).trim() === "" ? null : toBoolean(raw.meEitcHasQualifyingChild);
  out.meHasMaineOnlyEitcEligibility = raw.meHasMaineOnlyEitcEligibility === null || raw.meHasMaineOnlyEitcEligibility === undefined || String(raw.meHasMaineOnlyEitcEligibility).trim() === "" ? null : toBoolean(raw.meHasMaineOnlyEitcEligibility);
  out.meOtherRefundableCredits = raw.meOtherRefundableCredits === null || raw.meOtherRefundableCredits === undefined || String(raw.meOtherRefundableCredits).trim() === "" ? null : toNumber(raw.meOtherRefundableCredits);
  out.mePropertyTaxFairnessCredit = raw.mePropertyTaxFairnessCredit === null || raw.mePropertyTaxFairnessCredit === undefined || String(raw.mePropertyTaxFairnessCredit).trim() === "" ? null : toNumber(raw.mePropertyTaxFairnessCredit);
  out.meSalesTaxFairnessCredit = raw.meSalesTaxFairnessCredit === null || raw.meSalesTaxFairnessCredit === undefined || String(raw.meSalesTaxFairnessCredit).trim() === "" ? null : toNumber(raw.meSalesTaxFairnessCredit);
  out.meOtherMaineWithholding = raw.meOtherMaineWithholding === null || raw.meOtherMaineWithholding === undefined || String(raw.meOtherMaineWithholding).trim() === "" ? null : toNumber(raw.meOtherMaineWithholding);
  out.meOtherPayments = raw.meOtherPayments === null || raw.meOtherPayments === undefined || String(raw.meOtherPayments).trim() === "" ? null : toNumber(raw.meOtherPayments);
  out.meUseTax = raw.meUseTax === null || raw.meUseTax === undefined || String(raw.meUseTax).trim() === "" ? null : toNumber(raw.meUseTax);
  out.meCasualRentalTax = raw.meCasualRentalTax === null || raw.meCasualRentalTax === undefined || String(raw.meCasualRentalTax).trim() === "" ? null : toNumber(raw.meCasualRentalTax);
  out.meVoluntaryContributions = raw.meVoluntaryContributions === null || raw.meVoluntaryContributions === undefined || String(raw.meVoluntaryContributions).trim() === "" ? null : toNumber(raw.meVoluntaryContributions);
  out.meUnderpaymentPenalty = raw.meUnderpaymentPenalty === null || raw.meUnderpaymentPenalty === undefined || String(raw.meUnderpaymentPenalty).trim() === "" ? null : toNumber(raw.meUnderpaymentPenalty);
  out.meCreditToNextYear = raw.meCreditToNextYear === null || raw.meCreditToNextYear === undefined || String(raw.meCreditToNextYear).trim() === "" ? null : toNumber(raw.meCreditToNextYear);
  out.meHasAmendedOrOtherSpecialItems = raw.meHasAmendedOrOtherSpecialItems === null || raw.meHasAmendedOrOtherSpecialItems === undefined || String(raw.meHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.meHasAmendedOrOtherSpecialItems);

  // Maryland 2025 resident Form 502 exact/core inputs
  out.mdFullYearResident = raw.mdFullYearResident === null || raw.mdFullYearResident === undefined || String(raw.mdFullYearResident).trim() === "" ? null : toBoolean(raw.mdFullYearResident);
  out.mdFilingStatusMatchesFederal = raw.mdFilingStatusMatchesFederal === null || raw.mdFilingStatusMatchesFederal === undefined || String(raw.mdFilingStatusMatchesFederal).trim() === "" ? null : toBoolean(raw.mdFilingStatusMatchesFederal);
  out.mdSpousesSameLocalJurisdiction = raw.mdSpousesSameLocalJurisdiction === null || raw.mdSpousesSameLocalJurisdiction === undefined || String(raw.mdSpousesSameLocalJurisdiction).trim() === "" ? null : toBoolean(raw.mdSpousesSameLocalJurisdiction);
  out.mdAdditions = raw.mdAdditions === null || raw.mdAdditions === undefined || String(raw.mdAdditions).trim() === "" ? null : toNumber(raw.mdAdditions);
  out.mdSubtractions = raw.mdSubtractions === null || raw.mdSubtractions === undefined || String(raw.mdSubtractions).trim() === "" ? null : toNumber(raw.mdSubtractions);
  out.mdDeductionMethod = raw.mdDeductionMethod === null || raw.mdDeductionMethod === undefined ? "" : String(raw.mdDeductionMethod).trim().toLowerCase();
  out.mdItemizedDeductionBeforePhaseout = raw.mdItemizedDeductionBeforePhaseout === null || raw.mdItemizedDeductionBeforePhaseout === undefined || String(raw.mdItemizedDeductionBeforePhaseout).trim() === "" ? null : toNumber(raw.mdItemizedDeductionBeforePhaseout);
  out.mdTaxpayerBlind = raw.mdTaxpayerBlind === null || raw.mdTaxpayerBlind === undefined || String(raw.mdTaxpayerBlind).trim() === "" ? null : toBoolean(raw.mdTaxpayerBlind);
  out.mdSpouseBlind = raw.mdSpouseBlind === null || raw.mdSpouseBlind === undefined || String(raw.mdSpouseBlind).trim() === "" ? null : toBoolean(raw.mdSpouseBlind);
  out.mdAge65DependentCount = raw.mdAge65DependentCount === null || raw.mdAge65DependentCount === undefined || String(raw.mdAge65DependentCount).trim() === "" ? null : toNumber(raw.mdAge65DependentCount);
  out.mdLocalJurisdiction = raw.mdLocalJurisdiction === null || raw.mdLocalJurisdiction === undefined ? "" : String(raw.mdLocalJurisdiction).trim().toLowerCase();
  out.mdCapitalGainSubjectToAdditionalTax = raw.mdCapitalGainSubjectToAdditionalTax === null || raw.mdCapitalGainSubjectToAdditionalTax === undefined || String(raw.mdCapitalGainSubjectToAdditionalTax).trim() === "" ? null : toNumber(raw.mdCapitalGainSubjectToAdditionalTax);
  out.mdFederalEITCAmount = raw.mdFederalEITCAmount === null || raw.mdFederalEITCAmount === undefined || String(raw.mdFederalEITCAmount).trim() === "" ? null : toNumber(raw.mdFederalEITCAmount);
  out.mdEitcQualifyingChildCount = raw.mdEitcQualifyingChildCount === null || raw.mdEitcQualifyingChildCount === undefined || String(raw.mdEitcQualifyingChildCount).trim() === "" ? null : toNumber(raw.mdEitcQualifyingChildCount);
  out.mdHasMarylandOnlyEitcEligibility = raw.mdHasMarylandOnlyEitcEligibility === null || raw.mdHasMarylandOnlyEitcEligibility === undefined || String(raw.mdHasMarylandOnlyEitcEligibility).trim() === "" ? null : toBoolean(raw.mdHasMarylandOnlyEitcEligibility);
  out.mdEarnedIncome = raw.mdEarnedIncome === null || raw.mdEarnedIncome === undefined || String(raw.mdEarnedIncome).trim() === "" ? null : toNumber(raw.mdEarnedIncome);
  out.mdChildTaxCreditUnder6Count = raw.mdChildTaxCreditUnder6Count === null || raw.mdChildTaxCreditUnder6Count === undefined || String(raw.mdChildTaxCreditUnder6Count).trim() === "" ? null : toNumber(raw.mdChildTaxCreditUnder6Count);
  out.mdChildTaxCreditDisabledAge6To16Count = raw.mdChildTaxCreditDisabledAge6To16Count === null || raw.mdChildTaxCreditDisabledAge6To16Count === undefined || String(raw.mdChildTaxCreditDisabledAge6To16Count).trim() === "" ? null : toNumber(raw.mdChildTaxCreditDisabledAge6To16Count);
  out.mdOtherNonrefundableCredits = raw.mdOtherNonrefundableCredits === null || raw.mdOtherNonrefundableCredits === undefined || String(raw.mdOtherNonrefundableCredits).trim() === "" ? null : toNumber(raw.mdOtherNonrefundableCredits);
  out.mdOtherRefundableCredits = raw.mdOtherRefundableCredits === null || raw.mdOtherRefundableCredits === undefined || String(raw.mdOtherRefundableCredits).trim() === "" ? null : toNumber(raw.mdOtherRefundableCredits);
  out.mdOtherMarylandWithholding = raw.mdOtherMarylandWithholding === null || raw.mdOtherMarylandWithholding === undefined || String(raw.mdOtherMarylandWithholding).trim() === "" ? null : toNumber(raw.mdOtherMarylandWithholding);
  out.mdOtherPayments = raw.mdOtherPayments === null || raw.mdOtherPayments === undefined || String(raw.mdOtherPayments).trim() === "" ? null : toNumber(raw.mdOtherPayments);
  out.mdVoluntaryContributions = raw.mdVoluntaryContributions === null || raw.mdVoluntaryContributions === undefined || String(raw.mdVoluntaryContributions).trim() === "" ? null : toNumber(raw.mdVoluntaryContributions);
  out.mdUnderpaymentInterest = raw.mdUnderpaymentInterest === null || raw.mdUnderpaymentInterest === undefined || String(raw.mdUnderpaymentInterest).trim() === "" ? null : toNumber(raw.mdUnderpaymentInterest);
  out.mdHomebuyerWithdrawalPenalty = raw.mdHomebuyerWithdrawalPenalty === null || raw.mdHomebuyerWithdrawalPenalty === undefined || String(raw.mdHomebuyerWithdrawalPenalty).trim() === "" ? null : toNumber(raw.mdHomebuyerWithdrawalPenalty);
  out.mdCreditToNextYear = raw.mdCreditToNextYear === null || raw.mdCreditToNextYear === undefined || String(raw.mdCreditToNextYear).trim() === "" ? null : toNumber(raw.mdCreditToNextYear);
  out.mdHasOtherStateCredit = raw.mdHasOtherStateCredit === null || raw.mdHasOtherStateCredit === undefined || String(raw.mdHasOtherStateCredit).trim() === "" ? null : toBoolean(raw.mdHasOtherStateCredit);
  out.mdHasMilitaryOrSpecialFiling = raw.mdHasMilitaryOrSpecialFiling === null || raw.mdHasMilitaryOrSpecialFiling === undefined || String(raw.mdHasMilitaryOrSpecialFiling).trim() === "" ? null : toBoolean(raw.mdHasMilitaryOrSpecialFiling);
  out.mdHasAmendedOrOtherSpecialItems = raw.mdHasAmendedOrOtherSpecialItems === null || raw.mdHasAmendedOrOtherSpecialItems === undefined || String(raw.mdHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.mdHasAmendedOrOtherSpecialItems);

  // Massachusetts 2025 resident Form 1 exact/core inputs
  out.maFullYearResident = raw.maFullYearResident === null || raw.maFullYearResident === undefined || String(raw.maFullYearResident).trim() === "" ? null : toBoolean(raw.maFullYearResident);
  out.maHasFilingStatusException = raw.maHasFilingStatusException === null || raw.maHasFilingStatusException === undefined || String(raw.maHasFilingStatusException).trim() === "" ? null : toBoolean(raw.maHasFilingStatusException);
  out.maElectsOptional585Rate = raw.maElectsOptional585Rate === null || raw.maElectsOptional585Rate === undefined || String(raw.maElectsOptional585Rate).trim() === "" ? null : toBoolean(raw.maElectsOptional585Rate);
  out.maTotalFivePercentIncome = raw.maTotalFivePercentIncome === null || raw.maTotalFivePercentIncome === undefined || String(raw.maTotalFivePercentIncome).trim() === "" ? null : toNumber(raw.maTotalFivePercentIncome);
  out.maTotalDeductions = raw.maTotalDeductions === null || raw.maTotalDeductions === undefined || String(raw.maTotalDeductions).trim() === "" ? null : toNumber(raw.maTotalDeductions);
  out.maTaxpayerBlind = raw.maTaxpayerBlind === null || raw.maTaxpayerBlind === undefined || String(raw.maTaxpayerBlind).trim() === "" ? null : toBoolean(raw.maTaxpayerBlind);
  out.maSpouseBlind = raw.maSpouseBlind === null || raw.maSpouseBlind === undefined || String(raw.maSpouseBlind).trim() === "" ? null : toBoolean(raw.maSpouseBlind);
  for (const field of [
    "maMedicalDentalExemption","maAdoptionExemption","maScheduleBLine20","maScheduleB85Income","maScheduleB12Income",
    "maScheduleBLine37SurtaxIncome","maScheduleDLine21SurtaxIncome","maLongTermCapitalGainsTax","maCreditRecapture",
    "maInstallmentSaleAdditionalTax","maMassachusettsAGI","maOtherNonrefundableCredits","maVoluntaryContributions","maUseTax",
    "maHealthCarePenalty","maFederalEITCAmount","maSeniorCircuitBreakerCredit","maOtherRefundableCredits",
    "maOtherMassachusettsWithholding","maPriorYearOverpaymentApplied","maEstimatedPayments","maExtensionPayments",
    "maExcessPfmlWithholding","maRealEstateWithholding","maPenaltyInterest","maCreditToNextYear"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toNumber(raw[field]);
  out.maClaimedFederalEITC = raw.maClaimedFederalEITC === null || raw.maClaimedFederalEITC === undefined || String(raw.maClaimedFederalEITC).trim() === "" ? null : toBoolean(raw.maClaimedFederalEITC);
  out.maChildFamilyQualifyingCount = raw.maChildFamilyQualifyingCount === null || raw.maChildFamilyQualifyingCount === undefined || String(raw.maChildFamilyQualifyingCount).trim() === "" ? null : toNumber(raw.maChildFamilyQualifyingCount);
  out.maHasOtherJurisdictionCredit = raw.maHasOtherJurisdictionCredit === null || raw.maHasOtherJurisdictionCredit === undefined || String(raw.maHasOtherJurisdictionCredit).trim() === "" ? null : toBoolean(raw.maHasOtherJurisdictionCredit);
  out.maHasAmendedOrOtherSpecialItems = raw.maHasAmendedOrOtherSpecialItems === null || raw.maHasAmendedOrOtherSpecialItems === undefined || String(raw.maHasAmendedOrOtherSpecialItems).trim() === "" ? null : toBoolean(raw.maHasAmendedOrOtherSpecialItems);

  // New Jersey 2025 resident NJ-1040 exact/core inputs
  for (const field of [
    "njFullYearResident","njHasFilingStatusException","njClaimsDomesticPartnerExemption","njTaxpayerBlindOrDisabled",
    "njSpouseBlindOrDisabled","njTaxpayerVeteran","njSpouseVeteran","njPropertyTaxBenefitEligible",
    "njClaimedFederalEITC","njHasNJOnlyEITC","njHasOtherJurisdictionCredit","njHasAmendedOrOtherSpecialItems"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toBoolean(raw[field]);
  for (const field of [
    "njGrossIncome","njCollegeDependentCount","njMedicalExpenseDeduction","njAlimonyDeduction","njQualifiedConservationDeduction",
    "njHealthEnterpriseZoneDeduction","njAlternativeBusinessAdjustment","njOrganBoneMarrowDeduction","njNjbestDeduction",
    "njNjclassDeduction","njTuitionDeduction","njPropertyTaxesLine40a","njOtherNonrefundableCredits","njUseTax",
    "njUnderpaymentInterest","njSharedResponsibilityPayment","njOtherNJWithholding","njPaymentsCreditFromPriorYear",
    "njFederalEITCAmount","njExcessUiWfSwfCredit","njExcessDiCredit","njExcessFliCredit","njWoundedWarriorCredit",
    "njPteBaitCredit","njFederalChildDependentCareCredit","njChildTaxCreditUnder6Count","njCreditToNextYear","njCharitableContributions"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toNumber(raw[field]);


  // New York 2025 resident IT-201 exact/core inputs
  for (const field of [
    "nyFullYearResident","nyHasFilingStatusException","nyHasPartYearLocalResidency","nyJointLocalResidencyMismatch",
    "nyHasYonkersNonresidentEarnings","nyClaimedFederalEITC","nyHasNoncustodialEITC","nyHasOtherStateCredit","nyHasAmendedOrOtherSpecialItems"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toBoolean(raw[field]);
  out.nyDeductionMethod = raw.nyDeductionMethod == null ? "" : String(raw.nyDeductionMethod).trim().toLowerCase();
  out.nyLocality = raw.nyLocality == null ? "" : String(raw.nyLocality).trim().toLowerCase();
  for (const field of [
    "nyAdditions","nySubtractions","nyItemizedDeduction","nyHighIncomeLine39Tax","nyOtherNonrefundableCredits","nyOtherStateTaxes",
    "nySalesUseTax","nyMctmt","nyNycTaxableIncome","nyNycOtherTaxes","nyNycNonrefundableCredits","nyYonkersResidentSurcharge",
    "nyEmpireChildUnder4Count","nyEmpireChild4To16Count","nyStateChildDependentCareCredit","nyFederalEITCAmount",
    "nyRealPropertyTaxCredit","nyCollegeTuitionCredit","nyNycChildDependentCareCredit","nyNycSchoolTaxCreditFixed",
    "nyNycSchoolTaxCreditRateReduction","nyNycEITC","nyOtherRefundableCredits","nyOtherNYWithholding","nyEstimatedPayments",
    "nyExtensionPayment","nyVoluntaryContributions","nyPenaltyInterest","nyCreditToNextYear"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toNumber(raw[field]);


  // Rhode Island 2025 resident RI-1040 exact/core inputs
  for (const field of [
    "riFullYearResident","riHasFilingStatusException","riClaimedFederalEITC","riHasAmendedOrOtherSpecialItems"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toBoolean(raw[field]);
  for (const field of [
    "riNetModifications","riFederalChildDependentCareCredit","riOtherStateCredit","riOtherRhodeIslandCredits",
    "riCreditRecapture","riCheckoffContributions","riUseSalesTax","riIndividualMandatePenalty","riFederalEITCAmount",
    "riPropertyTaxReliefCredit","riLeadPaintCredit","riOtherRhodeIslandWithholding","riEstimatedPayments","riOtherPayments",
    "riUnderpaymentInterest","riCreditToNextYear"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toNumber(raw[field]);


  // Vermont 2025 resident IN-111 exact/core inputs
  for (const field of [
    "vtFullYearResident","vtHasFilingStatusException","vtSpouseCanBeClaimedAsDependent","vtHasIncomeAdjustment",
    "vtClaimedFederalEITC","vtIsQualifyingVeteran","vtUsesRenterCreditForIncomeTax","vtHasAmendedOrOtherSpecialItems"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toBoolean(raw[field]);
  for (const field of [
    "vtNetModifications","vtStandardDeductionBoxCount","vtUsObligationInterestForMinimumTax","vtNetTaxAdjustment",
    "vtCharitableContributions","vtOtherStateCredit","vtOtherNonrefundableCredits","vtChildCareContribution","vtUseTax",
    "vtVoluntaryContributions","vtFederalChildDependentCareCredit","vtChildTaxCreditQualifyingChildCount","vtFederalEITCAmount",
    "vtEitcQualifyingChildCount","vtOtherVermontWithholding","vtEstimatedPayments","vtRealEstateWithholding","vtK1EntityPayments",
    "vtUnderpaymentInterestPenalty","vtCreditToNextYear","vtCreditToPropertyTaxBill"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toNumber(raw[field]);

  // District of Columbia 2025 resident D-40 exact/core inputs
  for (const field of [
    "dcFullYearResident","dcHasFilingStatusException","dcTaxpayerBlind","dcSpouseBlind","dcFullYearHealthCoverageOrExempt",
    "dcClaimsEITC","dcClaimsScheduleH","dcHasOtherJurisdictionCredit","dcHasD30UnincorporatedBusiness",
    "dcHasNoncustodialEITC","dcHasAmendedOrOtherSpecialItems"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toBoolean(raw[field]);
  out.dcDeductionMethod = raw.dcDeductionMethod == null ? "" : String(raw.dcDeductionMethod).trim().toLowerCase();
  for (const field of [
    "dcFranchiseTaxAddback","dcOtherAdditions","dcStateLocalRefundSubtraction","dcTaxableSocialSecuritySubtraction",
    "dcFranchiseFiduciaryIncomeSubtraction","dcSurvivorBenefitsSubtraction","dcUnemploymentSubtraction","dcOtherSubtractions",
    "dcFederalItemizedDeductions","dcFederalStateLocalTaxDeduction","dcFederalRealEstateTax","dcFederalOtherTaxes",
    "dcProtectedItemizedDeductions","dcFederalChildDependentCareCredit","dcOtherNonrefundableCredits",
    "dcHealthCareSharedResponsibilityPayment","dcEitcQualifyingChildCount","dcCalculatedFederalEITCAmount",
    "dcChildlessEarnedIncome","dcScheduleHCredit","dcOtherRefundableCredits","dcOtherWithholding","dcEstimatedPayments",
    "dcExtensionPayment","dcUnderpaymentInterest","dcCreditToNextYear","dcVoluntaryContributions"
  ]) out[field] = raw[field] === null || raw[field] === undefined || String(raw[field]).trim() === "" ? null : toNumber(raw[field]);

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

  if (
    input.filingStatus === "mfj" &&
    (input.spouseAge === null || input.spouseAge === undefined)
  ) {
    errors.push(
      '"Spouse Age" is required for Married Filing Jointly estimates.'
    );
  }

  if (
    (input.ctcQualifyingChildren || 0) >
    (input.numberOfDependents || 0)
  ) {
    errors.push(
      '"Qualifying Children Under Age 17" cannot exceed the total number of dependents.'
    );
  }

  if (
    input.stateCode === "NC" &&
    input.filingStatus === "mfs" &&
    (
      input.ncSpouseItemizes === null ||
      input.ncSpouseItemizes === undefined
    )
  ) {
    errors.push(
      '"North Carolina Spouse Itemizes Deductions" is required for Married Filing Separately.'
    );
  }

  if (
    input.stateCode === "AZ" &&
    (input.numberOfDependents || 0) > 0 &&
    (input.dependentsUnder17 === null ||
      input.dependentsUnder17 === undefined)
  ) {
    errors.push(
      '"Arizona Dependents Under Age 17" is required when claiming dependents in Arizona.'
    );
  }

  if (
    input.dependentsUnder17 !== null &&
    input.dependentsUnder17 !== undefined &&
    input.dependentsUnder17 > (input.numberOfDependents || 0)
  ) {
    errors.push(
      '"Arizona Dependents Under Age 17" cannot exceed the total number of dependents.'
    );
  }

  const splitMileageYear =
    Number(input.taxYear) === 2022 ||
    Number(input.taxYear) === 2026;

  if (splitMileageYear && (input.businessMileage || 0) > 0) {
    errors.push(
      '"Business Mileage" must be entered in the Jan.–June and July–December fields for this tax year.'
    );
  }

  if (
    !splitMileageYear &&
    (
      (input.businessMileageJanJun || 0) > 0 ||
      (input.businessMileageJulDec || 0) > 0
    )
  ) {
    errors.push(
      'Split business mileage fields are only allowed for a tax year with a midyear IRS mileage-rate change.'
    );
  }

  if ((input.w2Income || 0) > 0) {
    if (input.w2SocialSecurityWages === null || input.w2SocialSecurityWages === undefined) {
      errors.push('"W-2 Social Security Wages" (Box 3) is required when W-2 wages are entered.');
    }
    if (input.w2MedicareWages === null || input.w2MedicareWages === undefined) {
      errors.push('"W-2 Medicare Wages" (Box 5) is required when W-2 wages are entered.');
    }
    if (input.w2MedicareTaxWithheld === null || input.w2MedicareTaxWithheld === undefined) {
      errors.push('"W-2 Medicare Tax Withheld" (Box 6) is required when W-2 wages are entered.');
    }
  }

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



