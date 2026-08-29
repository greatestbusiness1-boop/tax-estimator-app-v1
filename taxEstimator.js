"use strict";

const { prepareInput } = require("./schema/input.schema");
const { calculateFederal } = require("./engines/federalEngine");
const {
  calculateState,
  getStateSupport,
  getArkansas2025StandardDeduction,
  getArkansas2025LowIncomeUpperLimit,
} = require("./engines/stateEngine");
const { generateClientExperience } = require("./engines/clientExperienceEngine");

function estimate(rawInput) {
  const prepared = prepareInput(rawInput);

  if (!prepared.valid) {
    return {
      ok: false,
      errors: prepared.errors,
    };
  }

  const input = prepared.input;

  const stateSupport =
    getStateSupport(
      input.stateCode,
      input.taxYear
    );

  if (!stateSupport.supported) {
    const availableYears =
      Array.isArray(stateSupport.availableYears) &&
      stateSupport.availableYears.length > 0
        ? stateSupport.availableYears.join(", ")
        : "none currently configured";

    return {
      ok: false,
      code: "STATE_YEAR_NOT_SUPPORTED",
      errors: [
        `${stateSupport.stateName} state estimate for tax year ${input.taxYear} is not available yet. ` +
        `The estimator will not substitute another tax year's rules. ` +
        `Currently configured year(s) for ${stateSupport.stateName}: ${availableYears}.`
      ],
      stateSupport,
    };
  }

  if (
    input.stateCode === "NC" &&
    input.filingStatus === "mfs" &&
    (
      input.ncSpouseItemizes === null ||
      input.ncSpouseItemizes === undefined
    )
  ) {
    return {
      ok: false,
      code: "NC_MFS_SPOUSE_ITEMIZING_REQUIRED",
      errors: [
        "North Carolina requires one additional question for Married Filing Separately: whether your spouse itemizes deductions."
      ],
      stateSupport,
    };
  }

  if (
    stateSupport.verifiedNoIndividualIncomeTax &&
    Number(input.stateWithheld || 0) > 0
  ) {
    return {
      ok: false,
      code: "MULTISTATE_WITHHOLDING_REVIEW_REQUIRED",
      errors: [
        `${stateSupport.stateName} does not impose an individual state income tax for tax year ${input.taxYear}, ` +
        `but you entered state income tax withholding. That withholding may relate to another state or require a special refund filing. ` +
        `This one-state estimator will not treat it as a ${stateSupport.stateName} refund.`
      ],
      stateSupport,
    };
  }

  const federal = calculateFederal(input);

  if (input.stateCode === "AL") {
    if (
      input.alFullYearResident === null ||
      input.alFullYearResident === undefined
    ) {
      return {
        ok: false,
        code: "AL_RESIDENCY_SCREEN_REQUIRED",
        errors: [
          "Alabama needs confirmation that you (and your spouse, if filing jointly) were full-year Alabama residents for 2025."
        ],
        stateSupport,
      };
    }

    if (input.alFullYearResident !== true) {
      return {
        ok: false,
        code: "AL_PART_YEAR_OR_MULTISTATE_REVIEW_REQUIRED",
        errors: [
          "Alabama part-year, nonresident, or split-residency returns require Alabama-source income and federal-tax-deduction allocation details that this one-state estimate does not yet collect. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    if (input.filingStatus === "qw") {
      return {
        ok: false,
        code: "AL_FILING_STATUS_REVIEW_REQUIRED",
        errors: [
          "Alabama does not use the federal Qualifying Surviving Spouse status directly on Form 40. An Alabama filing-status review is required before calculating the state estimate."
        ],
        stateSupport,
      };
    }

    if (
      input.filingStatus === "hoh" &&
      (
        input.alHeadOfFamilyConfirmed === null ||
        input.alHeadOfFamilyConfirmed === undefined
      )
    ) {
      return {
        ok: false,
        code: "AL_HEAD_OF_FAMILY_SCREEN_REQUIRED",
        errors: [
          "Alabama Head of Family needs confirmation that the Alabama household and qualifying-relative requirements are met."
        ],
        stateSupport,
      };
    }

    if (
      input.filingStatus === "hoh" &&
      input.alHeadOfFamilyConfirmed !== true
    ) {
      return {
        ok: false,
        code: "AL_HEAD_OF_FAMILY_NOT_CONFIRMED",
        errors: [
          "The Alabama Head of Family requirements were not confirmed. This state estimate is being held for filing-status review."
        ],
        stateSupport,
      };
    }

    if (
      Number(input.numberOfDependents || 0) > 0 &&
      (
        input.alQualifyingDependents === null ||
        input.alQualifyingDependents === undefined
      )
    ) {
      return {
        ok: false,
        code: "AL_DEPENDENT_COUNT_REQUIRED",
        errors: [
          "Alabama needs the number of dependents who meet Alabama's support rules before the dependent exemption can be calculated."
        ],
        stateSupport,
      };
    }

    if (
      input.alQualifyingDependents !== null &&
      input.alQualifyingDependents !== undefined &&
      Number(input.alQualifyingDependents) >
        Number(input.numberOfDependents || 0)
    ) {
      return {
        ok: false,
        code: "AL_DEPENDENT_COUNT_INVALID",
        errors: [
          "Alabama qualifying dependents cannot exceed the total Number of Dependents entered above."
        ],
        stateSupport,
      };
    }

    if (
      input.alFederalIncomeTaxDeduction === null ||
      input.alFederalIncomeTaxDeduction === undefined
    ) {
      return {
        ok: false,
        code: "AL_FEDERAL_TAX_DEDUCTION_REQUIRED",
        errors: [
          "Alabama requires the 2025 Federal Income Tax Deduction from the Alabama Form 40 worksheet. Enter the worksheet line 6 amount, including zero when line 6 is zero."
        ],
        stateSupport,
      };
    }

    const maxAlabamaStartingIncome = Math.max(
      0,
      Number(federal?.summary?.agi || 0) +
        Number(federal?.summary?.seAboveLineDeduction || 0)
    );

    if (
      Number(input.alExemptIncome || 0) >
      maxAlabamaStartingIncome
    ) {
      return {
        ok: false,
        code: "AL_EXEMPT_INCOME_INVALID",
        errors: [
          "Alabama-exempt income cannot exceed the income currently included in the estimator's Alabama starting-income calculation."
        ],
        stateSupport,
      };
    }

    if (
      input.alHasSpecialItems === null ||
      input.alHasSpecialItems === undefined
    ) {
      return {
        ok: false,
        code: "AL_SPECIAL_ITEMS_SCREEN_REQUIRED",
        errors: [
          "Alabama needs one final screening question for state-only adjustments, credits, use tax, multi-state credits, NOLs, and other special items."
        ],
        stateSupport,
      };
    }

    if (input.alHasSpecialItems === true) {
      return {
        ok: false,
        code: "AL_SPECIAL_ITEMS_DETAIL_REQUIRED",
        errors: [
          "Your Alabama return includes a state-specific item that can materially change the result. This estimate is being held rather than guessing without the applicable Alabama schedule details."
        ],
        stateSupport,
      };
    }
  }

  if (input.stateCode === "IN" && Number(input.taxYear) === 2025) {
    if (input.inFullYearResident === null || input.inFullYearResident === undefined) {
      return { ok: false, code: "IN_RESIDENCY_SCREEN_REQUIRED", errors: ["Indiana needs confirmation that this is a full-year resident 2025 IT-40 return."], stateSupport };
    }
    if (input.inFullYearResident !== true) {
      return { ok: false, code: "IN_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Indiana part-year residents and nonresidents require IT-40PNR or IT-40RNR rules. This estimate is being held rather than guessed."], stateSupport };
    }

    for (const [field, label] of [
      ["inTotalAddbacks", "Schedule 1 total add-backs"],
      ["inTotalDeductions", "Schedule 2 total deductions"],
      ["inAdditionalDependentChildCount", "additional qualifying dependent-child count"],
      ["inFirstYearAdditionalChildCount", "first-year additional child-exemption count"],
      ["inAdoptedDependentCount", "adopted dependent count"],
      ["inCountyTax", "Schedule CT-40 county tax"],
      ["inCountyWithheld", "Indiana county withholding"],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code: "IN_REQUIRED_DETAIL_MISSING", errors: [`Enter the Indiana ${label}, including 0 when none applies.`], stateSupport };
      }
    }

    const depCount = Number(input.numberOfDependents || 0);
    const childCount = Number(input.inAdditionalDependentChildCount || 0);
    const firstYearCount = Number(input.inFirstYearAdditionalChildCount || 0);
    const adoptedCount = Number(input.inAdoptedDependentCount || 0);
    if (childCount > depCount) {
      return { ok: false, code: "IN_DEPENDENT_CHILD_COUNT_INVALID", errors: ["Indiana additional dependent-child exemptions cannot exceed the dependents claimed on the return."], stateSupport };
    }
    if (firstYearCount > childCount) {
      return { ok: false, code: "IN_FIRST_YEAR_CHILD_COUNT_INVALID", errors: ["Indiana first-year additional child exemptions must be a subset of the qualifying dependent children."], stateSupport };
    }
    if (adoptedCount > depCount) {
      return { ok: false, code: "IN_ADOPTED_DEPENDENT_COUNT_INVALID", errors: ["Indiana adopted-child exemptions cannot exceed the dependents claimed on the return."], stateSupport };
    }

    if (input.inTaxpayerBlind === null || input.inTaxpayerBlind === undefined) {
      return { ok: false, code: "IN_TAXPAYER_BLIND_SCREEN_REQUIRED", errors: ["Indiana needs the taxpayer blind-status answer for Schedule 3 exemptions."], stateSupport };
    }
    if (input.filingStatus === "mfj" && (input.inSpouseBlind === null || input.inSpouseBlind === undefined)) {
      return { ok: false, code: "IN_SPOUSE_BLIND_SCREEN_REQUIRED", errors: ["Indiana needs the spouse blind-status answer for Schedule 3 exemptions."], stateSupport };
    }

    if (input.inClaimedFederalEIC === null || input.inClaimedFederalEIC === undefined) {
      return { ok: false, code: "IN_EITC_SCREEN_REQUIRED", errors: ["Indiana needs to know whether a federal Earned Income Tax Credit was claimed because the Indiana EITC is 10% of the federal credit."], stateSupport };
    }
    if (input.inClaimedFederalEIC === true && Number(input.inFederalEICAmount || 0) <= 0) {
      return { ok: false, code: "IN_FEDERAL_EITC_AMOUNT_REQUIRED", errors: ["Enter the federal Earned Income Tax Credit amount so the Indiana 10% EITC can be calculated."], stateSupport };
    }

    for (const [field, code, message] of [
      ["inHasUseTax", "IN_USE_TAX_SCREEN_REQUIRED", "Indiana needs to know whether Schedule 4 use tax is due."],
      ["inHasUnifiedTaxCreditForElderly", "IN_ELDERLY_CREDIT_SCREEN_REQUIRED", "Indiana needs to know whether the Unified Tax Credit for the Elderly is being claimed."],
      ["inHasOtherCredits", "IN_OTHER_CREDITS_SCREEN_REQUIRED", "Indiana needs to know whether Schedule 5 or Schedule 6 credits other than withholding and EITC apply."],
      ["inHasOtherTaxesOrSpecialItems", "IN_SPECIAL_ITEMS_SCREEN_REQUIRED", "Indiana needs one final screen for household employment tax, recapture, donations, penalty, amended items, and other material special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    if (input.inHasUseTax === true && Number(input.inUseTax || 0) <= 0) {
      return { ok: false, code: "IN_USE_TAX_AMOUNT_REQUIRED", errors: ["Enter the Indiana use-tax amount from Schedule 4."], stateSupport };
    }
    if (input.inHasUnifiedTaxCreditForElderly === true) {
      return { ok: false, code: "IN_ELDERLY_CREDIT_REVIEW_REQUIRED", errors: ["Indiana's Unified Tax Credit for the Elderly depends on age, filing status, and qualifying income limits. This estimate is being held rather than guessing the credit."], stateSupport };
    }
    if (input.inHasOtherCredits === true) {
      return { ok: false, code: "IN_OTHER_CREDITS_REVIEW_REQUIRED", errors: ["Indiana Schedule 5/6 credits other than withholding and EITC require credit-specific limits and carryover rules. This estimate is being held rather than guessed."], stateSupport };
    }
    if (input.inHasOtherTaxesOrSpecialItems === true) {
      return { ok: false, code: "IN_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Indiana return has a material other tax, recapture, contribution, penalty, amended-return item, or special schedule that requires review rather than a guessed estimate."], stateSupport };
    }
  }

  if (input.stateCode === "MO" && Number(input.taxYear) === 2025) {
    if (input.moFullYearResident === null || input.moFullYearResident === undefined) {
      return { ok: false, code: "MO_RESIDENCY_SCREEN_REQUIRED", errors: ["Missouri needs confirmation that this is a full-year resident 2025 MO-1040 return."], stateSupport };
    }
    if (input.moFullYearResident !== true) {
      return { ok: false, code: "MO_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Missouri part-year residents and nonresidents require MO-NRI and/or resident-credit allocation rules. This estimate is being held rather than guessed."], stateSupport };
    }

    if (input.filingStatus === "mfj") {
      for (const [field, label] of [
        ["moPrimaryAdjustedGrossIncome", "MO-1040 Line 5Y Missouri adjusted gross income"],
        ["moSpouseAdjustedGrossIncome", "MO-1040 Line 5S spouse Missouri adjusted gross income"],
      ]) {
        if (input[field] === null || input[field] === undefined) {
          return { ok: false, code: "MO_COMBINED_AGI_SPLIT_REQUIRED", errors: [`Enter the exact ${label}. Missouri requires married filing combined income to be split between spouses before tax is calculated.`], stateSupport };
        }
      }
    } else {
      for (const [field, label] of [
        ["moTotalAdditions", "Form MO-A total additions"],
        ["moTotalSubtractions", "Form MO-A total subtractions"],
      ]) {
        if (input[field] === null || input[field] === undefined) {
          return { ok: false, code: "MO_MODIFICATION_DETAIL_REQUIRED", errors: [`Enter Missouri ${label}, including 0 when none applies.`], stateSupport };
        }
      }
    }

    for (const [field, label] of [
      ["moPensionSocialSecurityExemption", "MO-1040 Line 8 pension/Social Security exemption"],
      ["moFederalIncomeTaxDeduction", "MO-1040 Line 13 federal income tax deduction"],
      ["moOtherDeductions", "MO-1040 Lines 16 through 24 other deductions total"],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code: "MO_REQUIRED_DETAIL_MISSING", errors: [`Enter the ${label}, including 0 when none applies.`], stateSupport };
      }
    }

    const federalDeductionCap = input.filingStatus === "mfj" ? 10000 : 5000;
    if (Number(input.moFederalIncomeTaxDeduction || 0) > federalDeductionCap) {
      return { ok: false, code: "MO_FEDERAL_TAX_DEDUCTION_CAP_EXCEEDED", errors: [`Missouri's 2025 federal income tax deduction cannot exceed $${federalDeductionCap.toLocaleString()} for this filing status.`], stateSupport };
    }

    if (!["standard", "itemized"].includes(String(input.moDeductionChoice || "").toLowerCase())) {
      return { ok: false, code: "MO_DEDUCTION_CHOICE_REQUIRED", errors: ["Select the Missouri standard deduction or Missouri itemized deductions for MO-1040 Line 14."], stateSupport };
    }
    if (input.moDeductionChoice === "itemized" && (input.moItemizedDeductions === null || input.moItemizedDeductions === undefined)) {
      return { ok: false, code: "MO_ITEMIZED_DEDUCTION_REQUIRED", errors: ["Enter the exact Missouri itemized-deduction amount from Form MO-A, Part 2."], stateSupport };
    }
    if (input.moDeductionChoice === "standard") {
      if (input.moTaxpayerBlind === null || input.moTaxpayerBlind === undefined) {
        return { ok: false, code: "MO_TAXPAYER_BLIND_SCREEN_REQUIRED", errors: ["Missouri needs the taxpayer blind-status answer to calculate the 2025 additional standard deduction."], stateSupport };
      }
      if (input.filingStatus === "mfj" && (input.moSpouseBlind === null || input.moSpouseBlind === undefined)) {
        return { ok: false, code: "MO_SPOUSE_BLIND_SCREEN_REQUIRED", errors: ["Missouri needs the spouse blind-status answer to calculate the 2025 additional standard deduction."], stateSupport };
      }
      if (input.canBeClaimedAsDependent === true && (input.moDependentEarnedIncome === null || input.moDependentEarnedIncome === undefined)) {
        return { ok: false, code: "MO_DEPENDENT_EARNED_INCOME_REQUIRED", errors: ["Enter earned income for Missouri's dependent standard-deduction worksheet."], stateSupport };
      }
      if (input.moFederallyRequiredToItemize === null || input.moFederallyRequiredToItemize === undefined) {
        return { ok: false, code: "MO_FEDERAL_REQUIRED_ITEMIZE_SCREEN_REQUIRED", errors: ["Missouri needs to know whether federal rules required itemizing deductions. A taxpayer required to itemize federally must itemize on the Missouri return."], stateSupport };
      }
      if (input.moFederallyRequiredToItemize === true) {
        return { ok: false, code: "MO_FEDERAL_REQUIRED_ITEMIZE_REVIEW_REQUIRED", errors: ["Federal rules required itemizing deductions, so Missouri standard deduction cannot be used. Select Missouri itemized deductions and enter the exact Form MO-A Part 2 amount."], stateSupport };
      }
      if (input.moHasQualifiedDisasterLossStandardDeductionIncrease === null || input.moHasQualifiedDisasterLossStandardDeductionIncrease === undefined) {
        return { ok: false, code: "MO_DISASTER_LOSS_SCREEN_REQUIRED", errors: ["Missouri needs to know whether the federal standard deduction was increased for a net qualified disaster loss."], stateSupport };
      }
      if (input.moHasQualifiedDisasterLossStandardDeductionIncrease === true) {
        return { ok: false, code: "MO_DISASTER_LOSS_REVIEW_REQUIRED", errors: ["A net qualified disaster loss increased the federal and Missouri standard deduction. This special paper-return calculation is being held rather than using the ordinary 2025 standard deduction."], stateSupport };
      }
    }

    if (input.moClaimedFederalEIC === null || input.moClaimedFederalEIC === undefined) {
      return { ok: false, code: "MO_WFTC_SCREEN_REQUIRED", errors: ["Missouri needs to know whether a federal Earned Income Credit was allowed because the 2025 Working Family Tax Credit may be 20% of that federal credit."], stateSupport };
    }
    const moWftcStatusEligible = ["single", "mfj", "hoh", "qw"].includes(input.filingStatus) && input.canBeClaimedAsDependent !== true;
    if (input.moClaimedFederalEIC === true) {
      if (Number(input.moFederalEICAmount || 0) <= 0) {
        return { ok: false, code: "MO_FEDERAL_EIC_AMOUNT_REQUIRED", errors: ["Enter the federal Earned Income Credit amount from Form 1040 line 27a for the Missouri Working Family Tax Credit."], stateSupport };
      }
      if (moWftcStatusEligible && (input.moWftcInvestmentIncomeOver4400 === null || input.moWftcInvestmentIncomeOver4400 === undefined)) {
        return { ok: false, code: "MO_WFTC_INVESTMENT_SCREEN_REQUIRED", errors: ["Missouri needs to know whether 2025 investment income exceeded $4,400 for Working Family Tax Credit eligibility."], stateSupport };
      }
      if (moWftcStatusEligible && (input.moWftcChildInfoComplete === null || input.moWftcChildInfoComplete === undefined)) {
        return { ok: false, code: "MO_WFTC_CHILD_INFO_SCREEN_REQUIRED", errors: ["Confirm that any qualifying-child identification required by Form MO-WFTC is complete, or that no qualifying child is used for the credit."], stateSupport };
      }
    }

    for (const [field, code, message] of [
      ["moHasEnterpriseZoneModification", "MO_ENTERPRISE_ZONE_SCREEN_REQUIRED", "Missouri needs to know whether an enterprise-zone or rural-empowerment-zone modification applies."],
      ["moHasResidentCreditOtherState", "MO_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Missouri needs to know whether Form MO-CR credit for tax paid to another state or political subdivision applies."],
      ["moHasMiscOrPropertyTaxCredits", "MO_OTHER_CREDITS_SCREEN_REQUIRED", "Missouri needs to know whether miscellaneous credits or the Property Tax Credit apply."],
      ["moHasOtherTaxOrSpecialItems", "MO_SPECIAL_ITEMS_SCREEN_REQUIRED", "Missouri needs one final screen for lump-sum tax, recapture, amended-return items, nonresident allocation, penalties, refund diversions, and other material special items."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }
    if (input.moHasEnterpriseZoneModification === true) {
      return { ok: false, code: "MO_ENTERPRISE_ZONE_REVIEW_REQUIRED", errors: ["Missouri enterprise-zone and rural-empowerment-zone modifications require approved facility-specific amounts and spouse allocation. This estimate is being held rather than guessed."], stateSupport };
    }
    if (input.moHasResidentCreditOtherState === true) {
      return { ok: false, code: "MO_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Missouri Form MO-CR requires the other jurisdiction's income and tax details. This one-state estimate is being held rather than guessing the resident credit."], stateSupport };
    }
    if (input.moHasMiscOrPropertyTaxCredits === true) {
      return { ok: false, code: "MO_OTHER_CREDITS_REVIEW_REQUIRED", errors: ["Missouri miscellaneous credits and the Property Tax Credit have credit-specific eligibility and limitation rules. This estimate is being held rather than guessing those credits."], stateSupport };
    }
    if (input.moHasOtherTaxOrSpecialItems === true) {
      return { ok: false, code: "MO_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Missouri return includes a material other tax, recapture, amended-return item, allocation, penalty, refund diversion, or special schedule that requires review rather than a guessed estimate."], stateSupport };
    }
  }

  if (input.stateCode === "IL" && Number(input.taxYear) === 2025) {
    if (input.ilFullYearResident === null || input.ilFullYearResident === undefined) {
      return { ok: false, code: "IL_RESIDENCY_SCREEN_REQUIRED", errors: ["Illinois needs confirmation that this is a full-year resident 2025 IL-1040 return."], stateSupport };
    }
    if (input.ilFullYearResident !== true) {
      return { ok: false, code: "IL_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Illinois part-year residents and nonresidents require Schedule NR allocation. This estimate is being held rather than guessed."], stateSupport };
    }

    for (const [field, code, message] of [
      ["ilTotalAdditions", "IL_ADDITIONS_REQUIRED", "Enter Form IL-1040 Line 3 total additions from Schedule M, including 0 when none apply."],
      ["ilRetirementSocialSecuritySubtraction", "IL_RETIREMENT_SUBTRACTION_REQUIRED", "Enter IL-1040 Line 5 federally taxed Social Security and qualified retirement income, including 0 when none applies."],
      ["ilIllinoisIncomeTaxOverpaymentSubtraction", "IL_OVERPAYMENT_SUBTRACTION_REQUIRED", "Enter IL-1040 Line 6 Illinois Income Tax overpayment included in federal AGI, including 0 when none applies."],
      ["ilOtherSubtractions", "IL_OTHER_SUBTRACTIONS_REQUIRED", "Enter IL-1040 Line 7 other subtractions from Schedule M, including 0 when none apply."],
      ["ilInvestmentCreditRecapture", "IL_RECAPTURE_REQUIRED", "Enter IL-1040 Line 13 investment-credit recapture, including 0 when none applies."],
      ["ilScheduleICRCredit", "IL_ICR_CREDIT_REQUIRED", "Enter the exact Schedule ICR credit for IL-1040 Line 16, including 0 when none applies."],
      ["ilSchedule1299CCredit", "IL_1299C_CREDIT_REQUIRED", "Enter the exact Schedule 1299-C credit for IL-1040 Line 17, including 0 when none applies."],
      ["ilHouseholdEmploymentTax", "IL_HOUSEHOLD_TAX_REQUIRED", "Enter IL-1040 Line 20 household employment tax, including 0 when none applies."],
      ["ilUseTax", "IL_USE_TAX_REQUIRED", "Enter IL-1040 Line 21 Illinois Use Tax, including 0 when no use tax is due."],
      ["ilEstimatedPayments", "IL_ESTIMATED_PAYMENTS_REQUIRED", "Enter IL-1040 Line 26 estimated/extension/prior-year-applied payments, including 0 when none apply."],
      ["ilPassThroughWithholding", "IL_PASS_THROUGH_WITHHOLDING_REQUIRED", "Enter IL-1040 Line 27 pass-through withholding, including 0 when none applies."],
      ["ilPassThroughEntityTaxCredit", "IL_PTE_CREDIT_REQUIRED", "Enter IL-1040 Line 28 pass-through entity tax credit, including 0 when none applies."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    if (input.ilTaxpayerBlind === null || input.ilTaxpayerBlind === undefined) {
      return { ok: false, code: "IL_TAXPAYER_BLIND_SCREEN_REQUIRED", errors: ["Illinois needs the taxpayer legal-blindness answer for the $1,000 additional exemption."], stateSupport };
    }
    if (input.filingStatus === "mfj") {
      if (input.ilSpouseCanBeClaimedAsDependent === null || input.ilSpouseCanBeClaimedAsDependent === undefined) {
        return { ok: false, code: "IL_SPOUSE_DEPENDENT_SCREEN_REQUIRED", errors: ["Illinois needs to know whether the spouse can be claimed as another taxpayer's dependent to calculate the joint Line 10a exemption."], stateSupport };
      }
      if (input.ilSpouseBlind === null || input.ilSpouseBlind === undefined) {
        return { ok: false, code: "IL_SPOUSE_BLIND_SCREEN_REQUIRED", errors: ["Illinois needs the spouse legal-blindness answer for the $1,000 additional exemption."], stateSupport };
      }
    }

    for (const [field, code, message] of [
      ["ilHasOtherStateTaxCredit", "IL_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Illinois needs to know whether Schedule CR credit for tax paid to another state applies."],
      ["ilHasCannabisGamingSurcharge", "IL_SURCHARGE_SCREEN_REQUIRED", "Illinois needs to know whether the Line 22 cannabis or gaming-licensee surcharge applies."],
      ["ilClaimedFederalEITC", "IL_EITC_SCREEN_REQUIRED", "Illinois needs to know whether a federal Earned Income Tax Credit was claimed."],
      ["ilNeedsExpandedEITCWorksheet", "IL_EXPANDED_EITC_SCREEN_REQUIRED", "Illinois needs to know whether the Illinois Expanded EITC Worksheet is required because of ITIN, age, or additional ITIN-child rules."],
      ["ilHasOtherSpecialItems", "IL_SPECIAL_ITEMS_SCREEN_REQUIRED", "Illinois needs one final screen for other material credits, taxes, amended items, allocations, penalties, or special schedules."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    if (input.ilHasOtherStateTaxCredit === true) {
      return { ok: false, code: "IL_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Illinois Schedule CR requires detailed other-state income and tax information. This one-state estimate is being held rather than guessing the credit."], stateSupport };
    }
    if (input.ilHasCannabisGamingSurcharge === true) {
      return { ok: false, code: "IL_SURCHARGE_REVIEW_REQUIRED", errors: ["Illinois Line 22 cannabis/gaming surcharges require surcharge-specific facts and are being held for review rather than guessed."], stateSupport };
    }
    if (input.ilNeedsExpandedEITCWorksheet === true) {
      return { ok: false, code: "IL_EXPANDED_EITC_REVIEW_REQUIRED", errors: ["The Illinois Expanded EITC Worksheet is required for this return. It needs detailed earned-income, ITIN, age, and qualifying-child data, so this estimate is being held rather than guessed."], stateSupport };
    }
    if (input.ilClaimedFederalEITC === true) {
      if (Number(input.ilFederalEITCAmount || 0) <= 0) {
        return { ok: false, code: "IL_FEDERAL_EITC_AMOUNT_REQUIRED", errors: ["Enter the federal EITC amount from Form 1040 Line 27a so the standard Illinois EITC can be calculated at 20%."], stateSupport };
      }
      if (input.ilHasDependentChildUnder12 === null || input.ilHasDependentChildUnder12 === undefined) {
        return { ok: false, code: "IL_CHILD_TAX_CREDIT_SCREEN_REQUIRED", errors: ["Illinois needs to know whether at least one dependent child was under age 12 at the end of 2025 for the Child Tax Credit."], stateSupport };
      }
    }
    if (input.ilHasOtherSpecialItems === true) {
      return { ok: false, code: "IL_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Illinois return includes another material credit, tax, amended-return item, allocation, penalty, or special schedule that requires review rather than a guessed estimate."], stateSupport };
    }
  }

  if (input.stateCode === "OH" && Number(input.taxYear) === 2025) {
    if (input.ohFullYearResident === null || input.ohFullYearResident === undefined) {
      return { ok: false, code: "OH_RESIDENCY_SCREEN_REQUIRED", errors: ["Ohio needs confirmation that this is a full-year resident 2025 IT 1040 return."], stateSupport };
    }
    if (input.ohFullYearResident !== true) {
      return { ok: false, code: "OH_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Ohio part-year residents and nonresidents require residency/allocation rules that are outside this full-year resident path. This estimate is being held rather than guessed."], stateSupport };
    }

    for (const [field, code, message] of [
      ["ohTotalAdditions", "OH_ADDITIONS_REQUIRED", "Enter Ohio Schedule of Adjustments line 12 total additions, including 0 when none apply."],
      ["ohOtherDeductionsExcludingBusinessIncomeDeduction", "OH_OTHER_DEDUCTIONS_REQUIRED", "Enter Ohio Schedule of Adjustments deductions from lines 14-46 only, excluding the business income deduction on line 13; enter 0 when none apply."],
      ["ohScheduleBusinessIncomeTotal", "OH_BUSINESS_INCOME_TOTAL_REQUIRED", "Enter the exact Ohio Schedule of Business Income line 10 total business income or loss, including 0 when none applies."],
      ["ohNonrefundableCredits", "OH_NONREFUNDABLE_CREDITS_REQUIRED", "Enter the exact completed Ohio Schedule of Credits line 40 nonrefundable-credit total, including 0 when none applies."],
      ["ohInterestPenalty", "OH_INTEREST_PENALTY_REQUIRED", "Enter Ohio IT 1040 line 11 estimated-tax interest penalty, including 0 when none applies."],
      ["ohUseTax", "OH_USE_TAX_REQUIRED", "Enter Ohio IT 1040 line 12 unpaid use tax, including 0 when none applies."],
      ["ohEstimatedAndOtherPayments", "OH_OTHER_PAYMENTS_REQUIRED", "Enter Ohio IT 1040 line 15 estimated/extension/carryforward/previously-paid amount, including 0 when none applies."],
      ["ohRefundableCredits", "OH_REFUNDABLE_CREDITS_REQUIRED", "Enter the exact completed Ohio Schedule of Credits line 47 refundable-credit total, including 0 when none applies."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    if (input.filingStatus === "mfj" && (input.ohSpouseCanBeClaimedAsDependent === null || input.ohSpouseCanBeClaimedAsDependent === undefined)) {
      return { ok: false, code: "OH_SPOUSE_DEPENDENT_SCREEN_REQUIRED", errors: ["Ohio needs to know whether the spouse can be claimed as another taxpayer's dependent so the personal exemption count is correct."], stateSupport };
    }
    if (input.ohHasSchoolDistrictIncomeTax === null || input.ohHasSchoolDistrictIncomeTax === undefined) {
      return { ok: false, code: "OH_SCHOOL_DISTRICT_SCREEN_REQUIRED", errors: ["Ohio needs to know whether an SD 100 school-district income-tax return applies."], stateSupport };
    }
    if (input.ohHasSchoolDistrictIncomeTax === true) {
      for (const [field, code, message] of [
        ["ohSchoolDistrictTax", "OH_SD_TAX_REQUIRED", "Enter the exact SD 100 line 10 school-district tax liability, including any SD 100 interest penalty included there."],
        ["ohSchoolDistrictWithholding", "OH_SD_WITHHOLDING_REQUIRED", "Enter SD 100 line 11 school-district withholding, including 0 when none applies."],
        ["ohSchoolDistrictPayments", "OH_SD_PAYMENTS_REQUIRED", "Enter SD 100 line 12 payments and credit carryforward, including 0 when none applies."],
      ]) {
        if (input[field] === null || input[field] === undefined) {
          return { ok: false, code, errors: [message], stateSupport };
        }
      }
    }

    for (const [field, code, message] of [
      ["ohHasResidencyCreditOrAllocation", "OH_RESIDENCY_CREDIT_SCREEN_REQUIRED", "Ohio needs to know whether an IT RC/IT NRC residency-credit or allocation calculation applies."],
      ["ohHasAmendedNolOrSpecialItems", "OH_SPECIAL_ITEMS_SCREEN_REQUIRED", "Ohio needs one final screen for amended returns, NOL carrybacks, or other material special items."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }
    if (input.ohHasResidencyCreditOrAllocation === true) {
      return { ok: false, code: "OH_RESIDENCY_CREDIT_REVIEW_REQUIRED", errors: ["Ohio IT RC/IT NRC residency credits and allocations require other-jurisdiction or residency-period detail. This estimate is being held rather than guessing that allocation or credit."], stateSupport };
    }
    if (input.ohHasAmendedNolOrSpecialItems === true) {
      return { ok: false, code: "OH_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Ohio return includes an amended-return item, NOL carryback, or another material special item that requires separate review rather than a guessed estimate."], stateSupport };
    }
  }

  if (input.stateCode === "PA" && Number(input.taxYear) === 2025) {
    if (input.paFullYearResident === null || input.paFullYearResident === undefined) {
      return { ok: false, code: "PA_RESIDENCY_SCREEN_REQUIRED", errors: ["Pennsylvania needs confirmation that this is a full-year resident 2025 PA-40 return."], stateSupport };
    }
    if (input.paFullYearResident !== true) {
      return { ok: false, code: "PA_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Pennsylvania part-year and nonresident returns require source/residency rules outside this full-year resident path. This estimate is being held rather than guessed."], stateSupport };
    }

    for (const [field, code, message] of [
      ["paNetCompensation", "PA_COMPENSATION_REQUIRED", "Enter PA-40 Line 1c net compensation, including 0 when none applies."],
      ["paInterestIncome", "PA_INTEREST_REQUIRED", "Enter PA-40 Line 2 interest income, including 0 when none applies."],
      ["paDividendIncome", "PA_DIVIDENDS_REQUIRED", "Enter PA-40 Line 3 dividend and capital-gains-distribution income, including 0 when none applies."],
      ["paBusinessFarmIncomeLoss", "PA_BUSINESS_INCOME_REQUIRED", "Enter PA-40 Line 4 net business/profession/farm income or loss, including 0 when none applies."],
      ["paPropertyGainLoss", "PA_PROPERTY_GAIN_REQUIRED", "Enter PA-40 Line 5 net property gain or loss, including 0 when none applies."],
      ["paRentRoyaltyIncomeLoss", "PA_RENT_ROYALTY_REQUIRED", "Enter PA-40 Line 6 net rent/royalty/patent/copyright income or loss, including 0 when none applies."],
      ["paEstateTrustIncome", "PA_ESTATE_TRUST_REQUIRED", "Enter PA-40 Line 7 estate or trust income, including 0 when none applies."],
      ["paGamblingLotteryWinnings", "PA_GAMBLING_REQUIRED", "Enter PA-40 Line 8 gambling and lottery winnings, including 0 when none applies."],
      ["paOtherDeductions", "PA_OTHER_DEDUCTIONS_REQUIRED", "Enter the exact PA Schedule O deduction total for PA-40 Line 10, including 0 when none applies."],
      ["paPriorYearCredit", "PA_PRIOR_YEAR_CREDIT_REQUIRED", "Enter PA-40 Line 14 prior-year credit, including 0 when none applies."],
      ["paEstimatedPayments", "PA_ESTIMATED_PAYMENTS_REQUIRED", "Enter PA-40 Line 15 estimated installment payments, including 0 when none applies."],
      ["paExtensionPayment", "PA_EXTENSION_PAYMENT_REQUIRED", "Enter PA-40 Line 16 extension payment, including 0 when none applies."],
      ["paNonresidentWithholding", "PA_NR_WITHHOLDING_REQUIRED", "Enter PA-40 Line 17 nonresident tax withheld from PA Schedule NRK-1, including 0 when none applies."],
      ["paUseTax", "PA_USE_TAX_REQUIRED", "Enter PA-40 Line 25 use tax, including 0 when none applies."],
      ["paPenaltiesInterest", "PA_PENALTIES_REQUIRED", "Enter PA-40 Line 27 penalties and interest, including 0 when none applies."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    const paLine9 =
      Math.max(0, Number(input.paNetCompensation || 0)) +
      Math.max(0, Number(input.paInterestIncome || 0)) +
      Math.max(0, Number(input.paDividendIncome || 0)) +
      Math.max(0, Number(input.paBusinessFarmIncomeLoss || 0)) +
      Math.max(0, Number(input.paPropertyGainLoss || 0)) +
      Math.max(0, Number(input.paRentRoyaltyIncomeLoss || 0)) +
      Math.max(0, Number(input.paEstateTrustIncome || 0)) +
      Math.max(0, Number(input.paGamblingLotteryWinnings || 0));
    if (Number(input.paOtherDeductions || 0) > paLine9) {
      return { ok: false, code: "PA_SCHEDULE_O_LIMIT_REVIEW_REQUIRED", errors: ["PA Schedule O Line 10 cannot exceed PA-40 Line 9. Recheck the completed Pennsylvania Schedule O amount before estimating."], stateSupport };
    }

    for (const [field, code, message] of [
      ["paHasResidentCredit", "PA_RESIDENT_CREDIT_SCREEN_REQUIRED", "Pennsylvania needs to know whether PA Schedule G-L resident credit applies."],
      ["paClaimTaxForgiveness", "PA_TAX_FORGIVENESS_SCREEN_REQUIRED", "Pennsylvania needs to know whether PA Schedule SP Tax Forgiveness is being claimed."],
      ["paHasChildDependentCareCredit", "PA_CHILD_CARE_SCREEN_REQUIRED", "Pennsylvania needs to know whether PA Schedule DC child/dependent-care credit applies."],
      ["paHasRestrictedScheduleOCCredits", "PA_RESTRICTED_CREDIT_SCREEN_REQUIRED", "Pennsylvania needs to know whether any Schedule OC restricted credit applies."],
      ["paClaimedFederalEITC", "PA_WPTC_SCREEN_REQUIRED", "Pennsylvania needs to know whether the 2025 federal EITC was allowed for the Working Pennsylvanians Tax Credit."],
      ["paHasLocalEarnedIncomeTax", "PA_LOCAL_EIT_SCREEN_REQUIRED", "Pennsylvania needs to know whether a local earned-income/wage-tax liability or reconciliation applies."],
      ["paHasAmendedOrOtherSpecialItems", "PA_SPECIAL_ITEMS_SCREEN_REQUIRED", "Pennsylvania needs a final screen for amended returns or other material special items."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    if (input.paHasResidentCredit === true && (input.paResidentCredit === null || input.paResidentCredit === undefined)) {
      return { ok: false, code: "PA_RESIDENT_CREDIT_REQUIRED", errors: ["Enter the exact completed PA-40 Line 22 resident credit from Schedule G-L."], stateSupport };
    }
    if (input.paClaimTaxForgiveness === true) {
      if (input.paTaxForgivenessEligibilityIncome === null || input.paTaxForgivenessEligibilityIncome === undefined) {
        return { ok: false, code: "PA_TAX_FORGIVENESS_INCOME_REQUIRED", errors: ["Enter PA Schedule SP Section III Line 11 total eligibility income. Married taxpayers must use joint eligibility income even when filing separately."], stateSupport };
      }
      if (input.paTaxForgivenessDependentChildren === null || input.paTaxForgivenessDependentChildren === undefined) {
        return { ok: false, code: "PA_TAX_FORGIVENESS_DEPENDENTS_REQUIRED", errors: ["Enter the PA Schedule SP dependent-child count used for the Tax Forgiveness table."], stateSupport };
      }
      if (Number(input.paTaxForgivenessDependentChildren) > 9) {
        return { ok: false, code: "PA_TAX_FORGIVENESS_OVER_NINE_DEPENDENTS_REVIEW_REQUIRED", errors: ["The published 2025 PA Schedule SP eligibility-income table covers zero through nine dependent children. This estimator holds cases with more than nine for review rather than extrapolating an unpublished threshold."], stateSupport };
      }
      if (input.canBeClaimedAsDependent === true) {
        if (input.paDependentClaimantEligibleTaxForgiveness === null || input.paDependentClaimantEligibleTaxForgiveness === undefined) {
          return { ok: false, code: "PA_DEPENDENT_TAX_FORGIVENESS_SCREEN_REQUIRED", errors: ["A dependent claimant needs confirmation that the PA Schedule SP parent/grandparent/foster-parent eligibility rules are satisfied."], stateSupport };
        }
        if (input.paDependentClaimantEligibleTaxForgiveness !== true) {
          return { ok: false, code: "PA_DEPENDENT_TAX_FORGIVENESS_REVIEW_REQUIRED", errors: ["A dependent claimant who does not satisfy the PA Schedule SP dependent-child eligibility rule cannot use this Tax Forgiveness path. Turn off Tax Forgiveness or review the Schedule SP relationship."], stateSupport };
        }
      }
    }
    if (input.paHasChildDependentCareCredit === true) {
      if (input.filingStatus === "mfs") {
        return { ok: false, code: "PA_CHILD_CARE_MFS_REVIEW_REQUIRED", errors: ["Pennsylvania generally requires married taxpayers to file jointly to claim the Child and Dependent Care Enhancement Tax Credit. This MFS claim needs separate review."], stateSupport };
      }
      if (input.paChildDependentCareCredit === null || input.paChildDependentCareCredit === undefined) {
        return { ok: false, code: "PA_CHILD_CARE_CREDIT_REQUIRED", errors: ["Enter the exact completed PA Schedule DC child/dependent-care credit amount."], stateSupport };
      }
    }
    if (input.paHasRestrictedScheduleOCCredits === true) {
      return { ok: false, code: "PA_SCHEDULE_OC_REVIEW_REQUIRED", errors: ["Pennsylvania Schedule OC restricted credits require credit-specific authorization/documentation and are held for review instead of guessed."], stateSupport };
    }
    if (input.paClaimedFederalEITC === true && !(Number(input.paFederalEITCAmount || 0) > 0)) {
      return { ok: false, code: "PA_FEDERAL_EITC_AMOUNT_REQUIRED", errors: ["Enter the federal EITC amount so the 2025 Working Pennsylvanians Tax Credit can be calculated at 10%, subject to the $805 maximum."], stateSupport };
    }
    if (input.paHasLocalEarnedIncomeTax === true) {
      for (const [field, code, message] of [
        ["paLocalEarnedIncomeTax", "PA_LOCAL_EIT_TAX_REQUIRED", "Enter the exact completed Pennsylvania local earned-income/wage-tax liability."],
        ["paLocalEarnedIncomeWithholding", "PA_LOCAL_EIT_WITHHOLDING_REQUIRED", "Enter exact local earned-income/wage-tax withholding, including 0 when none applies."],
        ["paLocalEarnedIncomePayments", "PA_LOCAL_EIT_PAYMENTS_REQUIRED", "Enter exact local earned-income/wage-tax estimated or other payments, including 0 when none applies."],
      ]) {
        if (input[field] === null || input[field] === undefined) {
          return { ok: false, code, errors: [message], stateSupport };
        }
      }
    }
    if (input.paHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "PA_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Pennsylvania return includes an amended-return item or another material Pennsylvania special situation that requires separate review rather than a guessed estimate."], stateSupport };
    }
  }

  if (input.stateCode === "CO" && Number(input.taxYear) === 2025) {
    if (input.coFullYearResident === null || input.coFullYearResident === undefined) {
      return { ok: false, code: "CO_RESIDENCY_SCREEN_REQUIRED", errors: ["Colorado needs confirmation that this is a full-year resident 2025 DR 0104 return."], stateSupport };
    }
    if (input.coFullYearResident !== true) {
      return { ok: false, code: "CO_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Colorado part-year and nonresident returns require DR 0104PN apportionment. This estimate is held rather than guessed."], stateSupport };
    }

    for (const [field, code, message] of [
      ["coAdditions", "CO_ADDITIONS_REQUIRED", "Enter exact 2025 DR 0104 additions to federal taxable income, including 0."],
      ["coSubtractions", "CO_SUBTRACTIONS_REQUIRED", "Enter exact 2025 DR 0104AD subtractions from federal taxable income, including 0."],
      ["coAlternativeMinimumTax", "CO_AMT_REQUIRED", "Enter exact 2025 DR 0104 Line 14 Colorado alternative minimum tax, including 0."],
      ["coCreditRecapture", "CO_CREDIT_RECAPTURE_REQUIRED", "Enter exact 2025 DR 0104 Line 15 recapture of prior-year credits, including 0."],
      ["coCreditRepayment", "CO_CREDIT_REPAYMENT_REQUIRED", "Enter exact 2025 DR 0104 Line 22 repayment of credit from DR 0619, including 0."],
      ["coOtherNonrefundableCredits", "CO_NONREFUNDABLE_CREDITS_REQUIRED", "Enter exact supported Colorado nonrefundable credits, excluding any credit for tax paid to another state, including 0."],
      ["coChildTaxCredit", "CO_CHILD_TAX_CREDIT_REQUIRED", "Enter exact 2025 DR 0104CR Line 1 Colorado child tax credit / family affordability credit, including 0."],
      ["coChildDependentCareCredit", "CO_CHILD_CARE_CREDIT_REQUIRED", "Enter exact 2025 DR 0104CR Line 2 child/dependent-care credit, including 0."],
      ["coFederalEITCAmount", "CO_FEDERAL_EITC_REQUIRED", "Enter the exact federal EITC used for the standard 2025 Colorado 50% EITC calculation, including 0."],
      ["coOtherRefundableCredits", "CO_OTHER_REFUNDABLE_REQUIRED", "Enter exact other refundable credits from DR 0104CR, excluding child tax, child/dependent care, and the standard Colorado EITC, including 0."],
      ["coDirectRefundableCredits", "CO_DIRECT_REFUNDABLE_REQUIRED", "Enter exact 2025 DR 0104 Lines 29, 30, and 32 refundable/direct credits not included in DR 0104CR, including 0."],
      ["coOtherFormWithholding", "CO_OTHER_WITHHOLDING_REQUIRED", "Enter Colorado withholding from W-2G/1099 forms not already included in State Tax Withheld, including 0."],
      ["coPriorYearCarryforward", "CO_PRIOR_CARRYFORWARD_REQUIRED", "Enter 2024 Colorado overpayment applied to 2025, including 0."],
      ["coEstimatedPayments", "CO_ESTIMATED_PAYMENTS_REQUIRED", "Enter 2025 Colorado quarterly estimated payments, including 0."],
      ["coExtensionPayment", "CO_EXTENSION_PAYMENT_REQUIRED", "Enter the 2025 Colorado extension payment, including 0."],
      ["coOtherPrepayments", "CO_OTHER_PREPAYMENTS_REQUIRED", "Enter other 2025 Colorado prepayments such as applicable DR 0104BEP/DR 0108/real-estate withholding, including 0."],
      ["coTaborRefund", "CO_TABOR_REFUND_REQUIRED", "Enter exact 2025 DR 0104 Line 38 TABOR state sales tax refund, including 0."],
      ["coDelinquentPenalty", "CO_DELINQUENT_PENALTY_REQUIRED", "Enter exact DR 0104 Line 44 delinquent payment penalty, including 0."],
      ["coDelinquentInterest", "CO_DELINQUENT_INTEREST_REQUIRED", "Enter exact DR 0104 Line 45 delinquent payment interest, including 0."],
      ["coUnderpaymentPenalty", "CO_UNDERPAYMENT_PENALTY_REQUIRED", "Enter exact DR 0104 Line 46 estimated-tax penalty, including 0."],
      ["coApplyToNextYear", "CO_APPLY_NEXT_YEAR_REQUIRED", "Enter the overpayment amount to apply to 2026, including 0."],
      ["coVoluntaryContributions", "CO_CONTRIBUTIONS_REQUIRED", "Enter total Colorado voluntary contributions, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
      if (Number(input[field]) < 0) {
        return { ok: false, code: "CO_NEGATIVE_AMOUNT_INVALID", errors: [`Colorado amount ${field} cannot be negative.`], stateSupport };
      }
    }

    for (const [field, code, message] of [
      ["coHasOtherStateCredit", "CO_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Colorado needs to know whether DR 0104CR credit for tax paid to another state applies."],
      ["coNeedsSpecialEITCFormTN", "CO_SPECIAL_EITC_SCREEN_REQUIRED", "Colorado needs to know whether DR 0104TN is required for an ITIN/SSN or under-age-25 special EITC case."],
      ["coHasAmendedOrOtherSpecialItems", "CO_SPECIAL_ITEMS_SCREEN_REQUIRED", "Colorado needs a final screen for amended returns or other material Colorado special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    if (input.coHasOtherStateCredit === true) {
      return { ok: false, code: "CO_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Colorado credit for tax paid to another state requires DR 0104CR Part II, the other state's return, and Colorado limitation calculations. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.coNeedsSpecialEITCFormTN === true) {
      return { ok: false, code: "CO_SPECIAL_EITC_REVIEW_REQUIRED", errors: ["Colorado DR 0104TN special EITC cases can apply when federal EITC is unavailable because of SSN/ITIN or minimum-age rules. This case is held rather than substituting the standard 50% federal-EITC calculation."], stateSupport };
    }
    if (input.coHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "CO_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Colorado return includes an amended-return item or another material Colorado special situation that requires separate review."], stateSupport };
    }
  }

  if (input.stateCode === "UT" && Number(input.taxYear) === 2025) {
    if (input.utFullYearResident === null || input.utFullYearResident === undefined) {
      return { ok: false, code: "UT_RESIDENCY_SCREEN_REQUIRED", errors: ["Utah needs confirmation that this is a full-year resident 2025 TC-40 return."], stateSupport };
    }
    if (input.utFullYearResident !== true) {
      return { ok: false, code: "UT_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Utah part-year and nonresident returns require TC-40B apportionment. This estimate is held rather than guessed."], stateSupport };
    }

    for (const [field, code, message] of [
      ["utAdditions", "UT_ADDITIONS_REQUIRED", "Enter exact 2025 TC-40A Part 1 additions to income, including 0."],
      ["utStateTaxRefund", "UT_STATE_REFUND_REQUIRED", "Enter TC-40 Line 7 state tax refund included on the federal return, including 0."],
      ["utSubtractions", "UT_SUBTRACTIONS_REQUIRED", "Enter exact 2025 TC-40A Part 2 subtractions from income, including 0."],
      ["utDependentExemptionCount", "UT_DEPENDENT_COUNT_REQUIRED", "Enter TC-40 Line 2d qualifying dependent count, including the extra newborn count required by Utah, or 0."],
      ["utFederalDeductionLine12", "UT_FEDERAL_DEDUCTION_REQUIRED", "Enter exact 2025 federal standard or itemized deduction used on TC-40 Line 12."],
      ["utStateLocalIncomeTaxDeduction", "UT_STATE_LOCAL_DEDUCTION_REQUIRED", "Enter TC-40 Line 14 state/local income tax included in federal itemized deductions, including 0."],
      ["utFederalBaseStandardDeduction", "UT_BASE_STANDARD_DEDUCTION_REQUIRED", "Enter the federal standard-deduction amount used by Utah's Line 21 qualified-exempt-taxpayer worksheet, before the enhanced senior deduction."],
      ["utMunicipalBondInterestAddition", "UT_MUNICIPAL_BOND_INTEREST_REQUIRED", "Enter TC-40A Part 1 code 57 municipal-bond interest used in Utah credit worksheets, including 0."],
      ["utFederalTaxExemptInterest", "UT_TAX_EXEMPT_INTEREST_REQUIRED", "Enter federal Form 1040 Line 2a tax-exempt interest used in Utah credit worksheets, including 0."],
      ["utChildCreditQualifyingChildren", "UT_CHILD_CREDIT_COUNT_REQUIRED", "Enter the number of children age 5 or younger on Dec. 31, 2025 who qualify for the federal child tax credit, including 0."],
      ["utFederalEITCAmount", "UT_FEDERAL_EITC_REQUIRED", "Enter exact federal EITC used for Utah's 20% credit, including 0."],
      ["utUtahW2Wages", "UT_UTAH_WAGES_REQUIRED", "Enter total Utah wages from W-2 Box 16 for the Utah EITC limit, including 0."],
      ["utOtherApportionableNonrefundableCredits", "UT_OTHER_APPORTIONABLE_NONREF_REQUIRED", "Enter exact TC-40A Part 3 nonrefundable credits other than the Utah child tax credit and Utah EITC calculated here, including 0."],
      ["utNonapportionableNonrefundableCredits", "UT_NONAPPORTIONABLE_NONREF_REQUIRED", "Enter exact TC-40A Part 4 nonrefundable credits excluding credit for tax paid to another state, including 0."],
      ["utVoluntaryContributions", "UT_CONTRIBUTIONS_REQUIRED", "Enter TC-40 Line 28 voluntary contributions, including 0."],
      ["utLowIncomeHousingRecapture", "UT_HOUSING_RECAPTURE_REQUIRED", "Enter TC-40 Line 30 low-income-housing credit recapture, including 0."],
      ["utUseTax", "UT_USE_TAX_REQUIRED", "Enter exact TC-40 Line 31 Utah use tax, including 0. Do not guess a local rate."],
      ["utOtherWithholding", "UT_OTHER_WITHHOLDING_REQUIRED", "Enter Utah withholding not already included in State Tax Withheld, including 1099/mineral-production/pass-through withholding, or 0."],
      ["utPrepayments", "UT_PREPAYMENTS_REQUIRED", "Enter TC-40 Line 34 Utah income-tax prepayments/prior-year refund applied, including 0."],
      ["utNonapportionableRefundableCredits", "UT_NONAPPORTIONABLE_REFUNDABLE_REQUIRED", "Enter TC-40A Part 5 refundable credits, including 0."],
      ["utApportionableRefundableCredits", "UT_APPORTIONABLE_REFUNDABLE_REQUIRED", "Enter TC-40A Part 6 refundable credits, including 0."],
      ["utPenaltyInterest", "UT_PENALTY_INTEREST_REQUIRED", "Enter exact TC-40 Line 40 penalty and interest, including 0."],
      ["utRefundSubtractions", "UT_REFUND_SUBTRACTIONS_REQUIRED", "Enter TC-40 Line 43 voluntary refund subtractions, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
      if (Number(input[field]) < 0) {
        return { ok: false, code: "UT_NEGATIVE_AMOUNT_INVALID", errors: [`Utah amount ${field} cannot be negative.`], stateSupport };
      }
    }

    if (!Number.isInteger(Number(input.utDependentExemptionCount)) || !Number.isInteger(Number(input.utChildCreditQualifyingChildren))) {
      return { ok: false, code: "UT_COUNT_INVALID", errors: ["Utah dependent and child-credit counts must be whole numbers."], stateSupport };
    }
    if (Number(input.utChildCreditQualifyingChildren) > Number(input.numberOfDependents || 0)) {
      return { ok: false, code: "UT_CHILD_CREDIT_COUNT_INVALID", errors: ["Utah child-tax-credit qualifying children cannot exceed the federal dependent count."], stateSupport };
    }
    if (Number(input.utMunicipalBondInterestAddition) > Number(input.utAdditions)) {
      return { ok: false, code: "UT_MUNICIPAL_BOND_INTEREST_INVALID", errors: ["Utah municipal-bond interest used in the credit worksheets cannot exceed total TC-40A Part 1 additions."], stateSupport };
    }
    if (Number(input.utStateLocalIncomeTaxDeduction) > Number(input.utFederalDeductionLine12)) {
      return { ok: false, code: "UT_STATE_LOCAL_DEDUCTION_INVALID", errors: ["TC-40 Line 14 state/local income tax cannot exceed the federal deduction entered on TC-40 Line 12."], stateSupport };
    }

    for (const [field, code, message] of [
      ["utHasOtherStateCredit", "UT_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Utah needs to know whether TC-40A Part 4 code 17 credit for income tax paid to another state applies."],
      ["utHasSpecialMarriedCoupleCalculation", "UT_SPECIAL_MARRIED_COUPLE_SCREEN_REQUIRED", "Utah needs to know whether the special married-couple calculation / TC-40 filing-status code 9 applies."],
      ["utHasAmendedOrOtherSpecialItems", "UT_SPECIAL_ITEMS_SCREEN_REQUIRED", "Utah needs a final screen for amended returns or other material Utah special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }
    if (input.utHasOtherStateCredit === true) {
      return { ok: false, code: "UT_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Utah credit for income tax paid to another state requires TC-40S and the other jurisdiction's tax calculation. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.utHasSpecialMarriedCoupleCalculation === true) {
      return { ok: false, code: "UT_SPECIAL_MARRIED_COUPLE_REVIEW_REQUIRED", errors: ["Utah's special instructions for married couples require a separate allocation calculation. This case is held rather than forcing the normal resident path."], stateSupport };
    }
    if (input.utHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "UT_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Utah return includes an amended-return item or another material Utah special situation that requires separate review."], stateSupport };
    }
  }


  if (input.stateCode === "ID" && Number(input.taxYear) === 2025) {
    if (input.idFullYearResident === null || input.idFullYearResident === undefined) {
      return { ok: false, code: "ID_RESIDENCY_SCREEN_REQUIRED", errors: ["Idaho needs confirmation that this is a full-year resident 2025 Form 40 return."], stateSupport };
    }
    if (input.idFullYearResident !== true) {
      return { ok: false, code: "ID_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Idaho part-year and nonresident returns require Form 43 and Idaho-source allocation. This estimate is held rather than guessed."], stateSupport };
    }
    for (const [field, code, message] of [
      ["idAdditions", "ID_ADDITIONS_REQUIRED", "Enter exact Form 39R Part A total additions for Form 40 Line 8, including 0."],
      ["idSubtractions", "ID_SUBTRACTIONS_REQUIRED", "Enter exact Form 39R Part B total subtractions for Form 40 Line 10, including 0."],
      ["idItemizedDeduction", "ID_ITEMIZED_DEDUCTION_REQUIRED", "Enter Form 40 Line 15 Idaho itemized deduction after removing state/local income or general sales taxes, including 0."],
      ["idStandardDeduction", "ID_STANDARD_DEDUCTION_REQUIRED", "Enter exact 2025 Form 40 Line 16 Idaho standard deduction, including age/blind/dependent adjustments when applicable."],
      ["idFederalLine13Deductions", "ID_FEDERAL_LINE13_DEDUCTIONS_REQUIRED", "Enter Form 40 Line 18 total of federal Form 1040 Lines 13a and 13b, including QBI and applicable Schedule 1-A conformity deductions, or 0."],
      ["idChildCreditQualifyingChildren", "ID_CHILD_COUNT_REQUIRED", "Enter the number of Idaho Child Tax Credit qualifying children age 16 or younger on Dec. 31, 2025, including 0."],
      ["idForm39rCredits", "ID_39R_CREDITS_REQUIRED", "Enter exact Form 40 Line 22 credits from Form 39R Part D, including 0."],
      ["idBusinessIncomeTaxCredits", "ID_BUSINESS_CREDITS_REQUIRED", "Enter exact Form 40 Line 23 business income tax credits from Form 44, including 0."],
      ["idFuelsUseTax", "ID_FUELS_USE_TAX_REQUIRED", "Enter Form 40 Line 27 fuels use tax, including 0."],
      ["idSalesUseTax", "ID_SALES_USE_TAX_REQUIRED", "Enter Form 40 Line 28 Idaho sales/use tax due, including 0."],
      ["idIncomeTaxCreditRecapture", "ID_CREDIT_RECAPTURE_REQUIRED", "Enter Form 40 Line 29 income-tax credit recapture from Form 44, including 0."],
      ["idQieRecapture", "ID_QIE_RECAPTURE_REQUIRED", "Enter Form 40 Line 30 QIE recapture from Form 49ER, including 0."],
      ["idPermanentBuildingFundTax", "ID_BUILDING_FUND_REQUIRED", "Enter exact Form 40 Line 31 Permanent Building Fund tax, normally $10 unless an exception applies."],
      ["idDonations", "ID_DONATIONS_REQUIRED", "Enter total Form 40 Lines 33 through 40 voluntary donations, including 0."],
      ["idParentalChoiceTaxCredit", "ID_PARENTAL_CHOICE_REQUIRED", "Enter exact awarded/qualified Form 40 Line 42 Parental Choice Tax Credit, including 0."],
      ["idFoodTaxCredit", "ID_FOOD_CREDIT_REQUIRED", "Enter exact Form 40 Line 43 Food Tax Credit from the official worksheet, including 0."],
      ["idHomeFamilyCredit", "ID_HOME_FAMILY_CREDIT_REQUIRED", "Enter Form 40 Line 44 maintaining-a-home credit, including 0."],
      ["idFuelsTaxRefund", "ID_FUELS_REFUND_REQUIRED", "Enter Form 40 Line 45 fuels tax refund, including 0."],
      ["idOtherWithholding", "ID_OTHER_WITHHOLDING_REQUIRED", "Enter Idaho withholding from 1099s and other forms not already included in W-2 Box 17 State Tax Withheld, including 0."],
      ["idEstimatedPayments", "ID_ESTIMATED_PAYMENTS_REQUIRED", "Enter Form 40 Line 47 Form 51 payments and 2024 overpayment applied, including 0."],
      ["idEntityPaidWithheldAbe", "ID_ENTITY_PAYMENT_REQUIRED", "Enter Form 40 Line 48 entity-paid/withheld/ABE amount from Idaho K-1s, including 0."],
      ["idTaxReimbursementIncentiveCredit", "ID_REIMBURSEMENT_CREDIT_REQUIRED", "Enter Form 40 Line 49 Tax Reimbursement Incentive credit, including 0."],
      ["idPenaltyInterest", "ID_PENALTY_INTEREST_REQUIRED", "Enter Form 40 Line 52 penalty and interest, including 0."],
      ["idPriorYearNonrefundableCredit", "ID_PRIOR_YEAR_CREDIT_REQUIRED", "Enter Form 40 Line 53 nonrefundable credit from a prior-year return, including 0."],
      ["idRefundApplyToNextYear", "ID_REFUND_APPLY_REQUIRED", "Enter any Form 40 Line 56 overpayment to apply to 2026, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
      if (Number(input[field]) < 0) return { ok: false, code: "ID_NEGATIVE_AMOUNT_INVALID", errors: [`Idaho amount ${field} cannot be negative.`], stateSupport };
    }
    for (const [field, code, message] of [
      ["idHasOtherStateCredit", "ID_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Idaho needs to know whether Form 40 Line 21 credit for income tax paid to another state applies."],
      ["idHasNolOrCarryback", "ID_NOL_SCREEN_REQUIRED", "Idaho needs to know whether an Idaho net operating loss/carryback or Form 56 situation applies."],
      ["idHasClaimOfRightCase", "ID_CLAIM_OF_RIGHT_SCREEN_REQUIRED", "Idaho needs to know whether a claim-of-right repayment requires Idaho Worksheet CR."],
      ["idHasAmendedOrOtherSpecialItems", "ID_SPECIAL_ITEMS_SCREEN_REQUIRED", "Idaho needs a final screen for amended, dual-status/nonresident-alien, or other material Idaho special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.filingStatus === "mfs" && (input.idMfsSpouseItemizes === null || input.idMfsSpouseItemizes === undefined)) {
      return { ok: false, code: "ID_MFS_SPOUSE_ITEMIZES_REQUIRED", errors: ["Idaho MFS returns need confirmation whether the spouse itemizes, because Idaho requires itemizing when the spouse itemizes."], stateSupport };
    }
    if (!Number.isInteger(Number(input.idChildCreditQualifyingChildren))) {
      return { ok: false, code: "ID_CHILD_COUNT_INVALID", errors: ["Idaho child-tax-credit qualifying children must be a whole number."], stateSupport };
    }
    if (Number(input.idChildCreditQualifyingChildren) > Number(input.numberOfDependents || 0)) {
      return { ok: false, code: "ID_CHILD_COUNT_EXCEEDS_DEPENDENTS", errors: ["Idaho child-tax-credit qualifying children cannot exceed the federal dependent count."], stateSupport };
    }
    const idTotalAdjustedIncome = Number(federal.summary?.agi || 0) + Number(input.idAdditions || 0) - Number(input.idSubtractions || 0);
    if (idTotalAdjustedIncome < 0 || input.idHasNolOrCarryback === true) {
      return { ok: false, code: "ID_NOL_REVIEW_REQUIRED", errors: ["Idaho Form 40 total adjusted income is negative or an Idaho NOL/carryback applies. Form 56 rules require separate review rather than a guessed estimate."], stateSupport };
    }
    if (input.idHasOtherStateCredit === true) {
      return { ok: false, code: "ID_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Idaho Form 39R credit for income tax paid to another state requires the other state's return and Idaho limitation calculation. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.idHasClaimOfRightCase === true) {
      return { ok: false, code: "ID_CLAIM_OF_RIGHT_REVIEW_REQUIRED", errors: ["Idaho claim-of-right cases require Worksheet CR to compare deduction and credit treatment. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.idHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "ID_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Idaho return includes an amended, dual-status/nonresident-alien, or other material Idaho special situation that requires separate review."], stateSupport };
    }
  }

  if (input.stateCode === "MT" && Number(input.taxYear) === 2025) {
    if (input.mtFullYearResident === null || input.mtFullYearResident === undefined) {
      return { ok: false, code: "MT_RESIDENCY_SCREEN_REQUIRED", errors: ["Montana needs confirmation that this is a full-year resident 2025 Form 2 return."], stateSupport };
    }
    if (input.mtFullYearResident !== true) {
      return { ok: false, code: "MT_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Montana part-year, nonresident, and mixed-residency returns require Schedule II allocation. This estimate is held rather than guessed."], stateSupport };
    }
    for (const [field, code, message] of [
      ["mtFederalDeductionLine2", "MT_FEDERAL_DEDUCTION_REQUIRED", "Enter exact Montana Form 2 Line 2 federal deduction total (federal Form 1040 Lines 12e + 13b, excluding QBI Line 13a), including 0."],
      ["mtAdditions", "MT_ADDITIONS_REQUIRED", "Enter exact Montana Schedule I Line 7 total additions for Form 2 Line 4, including 0."],
      ["mtSubtractions", "MT_SUBTRACTIONS_REQUIRED", "Enter exact Montana Schedule I Line 24 total subtractions for Form 2 Line 5, including 0."],
      ["mtNetLongTermCapitalGains", "MT_LTCG_REQUIRED", "Enter exact 2025 Montana net long-term capital gains used on the Form 2 tax worksheet, including 0."],
      ["mtOtherNonrefundableCredits", "MT_NONREFUNDABLE_CREDITS_REQUIRED", "Enter Schedule III nonrefundable credits other than the credit for tax paid to another state/country, including 0."],
      ["mtOtherWithholdingAndPteCredits", "MT_OTHER_WITHHOLDING_REQUIRED", "Enter total Form 2 Lines 11b through 11e withholding/PTE credits not already included in W-2 Box 17 State Tax Withheld, including 0."],
      ["mtEstimatedPayments", "MT_ESTIMATED_PAYMENTS_REQUIRED", "Enter Form 2 Line 12 estimated payments, including 0."],
      ["mtPriorYearOverpayment", "MT_PRIOR_OVERPAYMENT_REQUIRED", "Enter Form 2 Line 13 prior-year overpayment applied to 2025, including 0."],
      ["mtExtensionPayment", "MT_EXTENSION_PAYMENT_REQUIRED", "Enter Form 2 Line 14 extension payment, including 0."],
      ["mtFederalEITCAmount", "MT_FEDERAL_EITC_REQUIRED", "Enter the exact federal EITC used for Montana Form 2 Line 15, including 0."],
      ["mtElderlyHomeownerRenterCredit", "MT_ELDERLY_CREDIT_REQUIRED", "Enter the exact Montana Elderly Homeowner/Renter Credit from the completed Schedule 2EC, including 0."],
      ["mtOtherRefundableCredits", "MT_OTHER_REFUNDABLE_REQUIRED", "Enter exact Schedule III refundable credits reported on Form 2 Line 17, including 0."],
      ["mtScheduleIvOtherTaxes", "MT_SCHEDULE_IV_REQUIRED", "Enter exact Schedule IV total contributions/penalties/interest/other taxes reported on Form 2 Line 19, including 0."],
      ["mtRefundApplyToNextYear", "MT_REFUND_APPLY_REQUIRED", "Enter Form 2 Line 24 overpayment applied to 2026, including 0."],
      ["mtRefund529Deposit", "MT_REFUND_529_REQUIRED", "Enter Form 2 Line 25 Montana 529/529A refund deposit, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
      if (Number(input[field]) < 0) return { ok: false, code: "MT_NEGATIVE_AMOUNT_INVALID", errors: [`Montana amount ${field} cannot be negative.`], stateSupport };
    }
    for (const [field, code, message] of [
      ["mtHasOtherStateCredit", "MT_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Montana needs to know whether Schedule III credit for income tax paid to another state or country applies."],
      ["mtHasNolOrLossCarryforward", "MT_NOL_LOSS_SCREEN_REQUIRED", "Montana needs to know whether an NOL transition/carryforward or other tracked loss carryforward applies."],
      ["mtHasAmendedOrOtherSpecialItems", "MT_SPECIAL_ITEMS_SCREEN_REQUIRED", "Montana needs a final screen for amended returns or other material Montana special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (Number(input.mtFederalEITCAmount || 0) > 0 && (input.mtHasEitcReductionCase === null || input.mtHasEitcReductionCase === undefined)) {
      return { ok: false, code: "MT_EITC_REDUCTION_SCREEN_REQUIRED", errors: ["Montana EITC claim needs confirmation whether the special Worksheet A reduction applies."], stateSupport };
    }
    if (input.mtHasOtherStateCredit === true) {
      return { ok: false, code: "MT_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Montana Schedule III credit for tax paid to another state/country requires the other jurisdiction's return and Montana limitation calculation. This estimate is held rather than guessed."], stateSupport };
    }
    if (Number(input.mtFederalEITCAmount || 0) > 0 && input.mtHasEitcReductionCase === true) {
      return { ok: false, code: "MT_EITC_REDUCTION_REVIEW_REQUIRED", errors: ["This Montana EITC requires Worksheet A because of part-year/mixed residency, tribal-reservation income, a 501(d) organization, or resident active-duty military status. This case is held rather than guessing the reduction ratio."], stateSupport };
    }
    if (input.mtHasNolOrLossCarryforward === true) {
      return { ok: false, code: "MT_NOL_LOSS_REVIEW_REQUIRED", errors: ["Montana NOL transition/carryforward, capital-loss, or passive-loss carryforward cases require separate tracking and review. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.mtHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "MT_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Montana return includes an amended-return item or another material Montana special situation that requires separate review."], stateSupport };
    }
  }


  if (input.stateCode === "ND" && Number(input.taxYear) === 2025) {
    if (input.ndFullYearResident === null || input.ndFullYearResident === undefined) {
      return { ok: false, code: "ND_RESIDENCY_SCREEN_REQUIRED", errors: ["North Dakota needs confirmation that this is a full-year resident 2025 Form ND-1 return."], stateSupport };
    }
    if (input.ndFullYearResident !== true) {
      return { ok: false, code: "ND_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["North Dakota part-year/nonresident returns require Schedule ND-1NR allocation. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.ndFederalTaxableIncome === null || input.ndFederalTaxableIncome === undefined || !Number.isFinite(Number(input.ndFederalTaxableIncome))) {
      return { ok: false, code: "ND_FEDERAL_TAXABLE_INCOME_REQUIRED", errors: ["Enter the exact signed North Dakota Form ND-1 Line 1b federal taxable-income amount, including a negative amount when the federal form displays zero."], stateSupport };
    }
    for (const [field, code, message] of [
      ["ndContributionAdjustment", "ND_CONTRIBUTION_ADJUSTMENT_REQUIRED", "Enter North Dakota Form ND-1 Line 2 planned gift/endowment credit adjustment, including 0."],
      ["ndOtherAdditions", "ND_OTHER_ADDITIONS_REQUIRED", "Enter exact Schedule ND-1SA total other additions for Form ND-1 Line 3, including 0."],
      ["ndUsObligationInterest", "ND_US_OBLIGATION_REQUIRED", "Enter Form ND-1 Line 5 U.S. obligation interest subtraction, including 0."],
      ["ndNetLongTermCapitalGainExclusion", "ND_LTCG_EXCLUSION_REQUIRED", "Enter the exact completed Form ND-1 Line 6 net long-term capital gain exclusion, including 0."],
      ["ndNativeAmericanExemptIncome", "ND_NATIVE_AMERICAN_EXCLUSION_REQUIRED", "Enter Form ND-1 Line 7 eligible Native American exempt income, including 0."],
      ["ndRailroadBenefits", "ND_RAILROAD_BENEFITS_REQUIRED", "Enter Form ND-1 Line 8 U.S. Railroad Retirement Board benefits subtraction, including 0."],
      ["ndPeaceOfficerRetirementExclusion", "ND_PEACE_OFFICER_RETIREMENT_REQUIRED", "Enter Form ND-1 Line 9 licensed peace officer retirement exclusion, including 0."],
      ["ndMilitaryPayExclusion", "ND_MILITARY_PAY_REQUIRED", "Enter Form ND-1 Line 11 military pay exclusion, including 0."],
      ["ndCollegeSaveContribution", "ND_COLLEGE_SAVE_REQUIRED", "Enter qualifying North Dakota College SAVE contribution for Form ND-1 Line 12, including 0."],
      ["ndQualifiedDividends", "ND_QUALIFIED_DIVIDENDS_REQUIRED", "Enter federal qualified dividends used for the Form ND-1 Line 13 40% exclusion, including 0."],
      ["ndMilitaryRetirementExclusion", "ND_MILITARY_RETIREMENT_REQUIRED", "Enter Form ND-1 Line 14 qualifying military retirement benefit exclusion, including 0."],
      ["ndSocialSecurityExclusion", "ND_SOCIAL_SECURITY_REQUIRED", "Enter Form ND-1 Line 15 taxable Social Security benefit exclusion, including 0."],
      ["ndOtherSubtractions", "ND_OTHER_SUBTRACTIONS_REQUIRED", "Enter exact Schedule ND-1SA total other subtractions for Form ND-1 Line 16, including 0."],
      ["ndOtherCredits", "ND_OTHER_CREDITS_REQUIRED", "Enter exact Schedule ND-1TC other nonrefundable credits for Form ND-1 Line 23, including 0."],
      ["ndOtherWithholding", "ND_OTHER_WITHHOLDING_REQUIRED", "Enter Form ND-1 Line 26 withholding from 1099/K-1/other forms not already included in W-2 Box 17 State Tax Withheld, including 0."],
      ["ndEstimatedTaxPayment", "ND_ESTIMATED_PAYMENTS_REQUIRED", "Enter Form ND-1 Line 27 estimated/extension/prior-year-applied payments, including 0."],
      ["ndRefundApplyNextYear", "ND_REFUND_APPLY_REQUIRED", "Enter Form ND-1 Line 30 overpayment applied to 2026, including 0."],
      ["ndRefundContributions", "ND_REFUND_CONTRIBUTIONS_REQUIRED", "Enter Form ND-1 Line 31 voluntary contributions from an overpayment, including 0."],
      ["ndPenaltyInterest", "ND_PENALTY_INTEREST_REQUIRED", "Enter Form ND-1 Line 34 penalty and interest, including 0."],
      ["ndBalanceDueContributions", "ND_BALANCE_CONTRIBUTIONS_REQUIRED", "Enter Form ND-1 Line 35 voluntary contributions added to a balance due, including 0."],
      ["ndUnderpaymentInterest", "ND_UNDERPAYMENT_INTEREST_REQUIRED", "Enter Form ND-1 Line 37 underpayment interest from Schedule ND-1UT, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
      if (!Number.isFinite(Number(input[field])) || Number(input[field]) < 0) return { ok: false, code: "ND_NEGATIVE_AMOUNT_INVALID", errors: [`North Dakota amount ${field} must be a valid nonnegative amount.`], stateSupport };
    }
    if (input.filingStatus === "mfj") {
      for (const [field, code, message] of [
        ["ndTaxpayerQualifiedIncome", "ND_TAXPAYER_QUALIFIED_INCOME_REQUIRED", "Enter the taxpayer's exact qualified income for the North Dakota marriage-penalty credit worksheet, including 0."],
        ["ndSpouseQualifiedIncome", "ND_SPOUSE_QUALIFIED_INCOME_REQUIRED", "Enter the spouse's exact qualified income for the North Dakota marriage-penalty credit worksheet, including 0."],
      ]) {
        if (input[field] === null || input[field] === undefined || !Number.isFinite(Number(input[field])) || Number(input[field]) < 0) {
          return { ok: false, code, errors: [message], stateSupport };
        }
      }
    }
    for (const [field, code, message] of [
      ["ndHasOtherStateCredit", "ND_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "North Dakota needs to know whether Schedule ND-1CR credit for income tax paid to another state/local jurisdiction applies."],
      ["ndHasFarmIncomeAveraging", "ND_FARM_INCOME_SCREEN_REQUIRED", "North Dakota needs to know whether federal Schedule J / Form ND-1FA farm-income averaging applies."],
      ["ndHasSoldResearchCredit", "ND_SOLD_RESEARCH_CREDIT_SCREEN_REQUIRED", "North Dakota needs to know whether a sold research-expense tax credit requires Schedule ND-1CS."],
      ["ndHasAmendedNolOrOtherSpecialItems", "ND_SPECIAL_ITEMS_SCREEN_REQUIRED", "North Dakota needs a final screen for amended returns, NOL/carryback, fiscal-year, nonresident-alien, or other material special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.ndHasOtherStateCredit === true) {
      return { ok: false, code: "ND_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["North Dakota Schedule ND-1CR requires the other jurisdiction's return and limitation calculation. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.ndHasFarmIncomeAveraging === true) {
      return { ok: false, code: "ND_FARM_INCOME_AVERAGING_REVIEW_REQUIRED", errors: ["North Dakota farm-income averaging requires Form ND-1FA and federal Schedule J. This estimate is held for separate review."], stateSupport };
    }
    if (input.ndHasSoldResearchCredit === true) {
      return { ok: false, code: "ND_SOLD_RESEARCH_CREDIT_REVIEW_REQUIRED", errors: ["A sold North Dakota research-expense tax credit requires Schedule ND-1CS special tax computation. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.ndHasAmendedNolOrOtherSpecialItems === true) {
      return { ok: false, code: "ND_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This North Dakota return includes an amended, NOL/carryback, fiscal-year, nonresident-alien, or other material special situation that requires separate review."], stateSupport };
    }
  }

  if (input.stateCode === "NM" && Number(input.taxYear) === 2025) {
    if (input.nmFullYearResident === null || input.nmFullYearResident === undefined) {
      return { ok: false, code: "NM_RESIDENCY_SCREEN_REQUIRED", errors: ["New Mexico needs confirmation that this is a full-year resident 2025 PIT-1 return."], stateSupport };
    }
    if (input.nmFullYearResident !== true) {
      return { ok: false, code: "NM_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["New Mexico part-year, first-year, and nonresident returns require PIT-B allocation. This estimate is held rather than guessed."], stateSupport };
    }
    for (const [field, code, message] of [
      ["nmFederalDeductionLine12", "NM_FEDERAL_DEDUCTION_REQUIRED", "Enter exact federal Form 1040/1040-SR Line 12 deduction used on PIT-1 Line 12, including 0."],
      ["nmStateLocalIncomeTaxAddback", "NM_SALT_ADDBACK_REQUIRED", "Enter exact PIT-1 Line 10 state/local income-tax addback from the New Mexico worksheet, including 0."],
      ["nmPitAdjAdditions", "NM_PIT_ADJ_ADDITIONS_REQUIRED", "Enter exact PIT-ADJ additions total used on PIT-1 Line 11, including 0."],
      ["nmPitAdjDeductions", "NM_PIT_ADJ_DEDUCTIONS_REQUIRED", "Enter exact PIT-ADJ deductions/exemptions total used on PIT-1 Line 15, including 0."],
      ["nmPitCrNonrefundableCredits", "NM_NONREFUNDABLE_CREDITS_REQUIRED", "Enter exact PIT-CR Line A nonrefundable business-related credit applied on PIT-1 Line 21, including 0."],
      ["nmPitRcTotalCredits", "NM_PIT_RC_CREDITS_REQUIRED", "Enter exact PIT-RC Line 26 total transferred to PIT-1 Line 24, including 0."],
      ["nmFederalEITCAmount", "NM_EITC_BASE_REQUIRED", "Enter the exact federal EITC amount, or the federal-EITC-equivalent amount allowed by New Mexico's WFTC expansion, including 0."],
      ["nmPitCrRefundableCredits", "NM_REFUNDABLE_BUSINESS_CREDITS_REQUIRED", "Enter exact PIT-CR Line B refundable business-related credits for PIT-1 Line 26, including 0."],
      ["nmOtherLine27Withholding", "NM_OTHER_WITHHOLDING_REQUIRED", "Enter New Mexico withholding from W-2G/1099/1099-R/1099-NEC/1099-MISC not already included in W-2 state withholding, including 0."],
      ["nmOilGasWithholding", "NM_OIL_GAS_WITHHOLDING_REQUIRED", "Enter PIT-1 Line 28 oil-and-gas proceeds withholding, including 0."],
      ["nmPteWithholdingEntityTax", "NM_PTE_WITHHOLDING_REQUIRED", "Enter PIT-1 Line 29 pass-through withholding/entity-level/composite tax amount, including 0."],
      ["nmEstimatedPayments", "NM_ESTIMATED_PAYMENTS_REQUIRED", "Enter PIT-1 Line 30 estimated payments and prior-year overpayment applied to 2025, including 0."],
      ["nmOtherPayments", "NM_OTHER_PAYMENTS_REQUIRED", "Enter PIT-1 Line 31 extension/return/other payments, including 0."],
      ["nmUnderpaymentPenalty", "NM_UNDERPAYMENT_PENALTY_REQUIRED", "Enter PIT-1 Line 34 estimated-tax underpayment penalty, including 0."],
      ["nmLatePenalty", "NM_LATE_PENALTY_REQUIRED", "Enter PIT-1 Line 36 late-filing/payment penalty, including 0."],
      ["nmInterest", "NM_INTEREST_REQUIRED", "Enter PIT-1 Line 37 interest, including 0."],
      ["nmRefundContributions", "NM_REFUND_CONTRIBUTIONS_REQUIRED", "Enter PIT-1 Line 40 PIT-D voluntary contributions, including 0."],
      ["nmApplyToNextYear", "NM_APPLY_NEXT_YEAR_REQUIRED", "Enter PIT-1 Line 41 overpayment to apply to 2026 estimated tax, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined || !Number.isFinite(Number(input[field]))) return { ok: false, code, errors: [message], stateSupport };
      if (Number(input[field]) < 0) return { ok: false, code: "NM_NEGATIVE_AMOUNT_INVALID", errors: [`New Mexico amount ${field} must be a valid nonnegative amount.`], stateSupport };
    }
    if (input.nmWftcExpansionCase === null || input.nmWftcExpansionCase === undefined) {
      return { ok: false, code: "NM_WFTC_EXPANSION_SCREEN_REQUIRED", errors: ["New Mexico needs to know whether the Working Families Tax Credit uses the special TIN/age expansion path."], stateSupport };
    }
    if (input.filingStatus === "mfj" && (input.nmSpouseCanBeClaimedAsDependent === null || input.nmSpouseCanBeClaimedAsDependent === undefined)) {
      return { ok: false, code: "NM_SPOUSE_DEPENDENT_SCREEN_REQUIRED", errors: ["New Mexico needs the spouse dependent-status answer to determine the PIT-1 Line 5 exemption count."], stateSupport };
    }
    if (input.filingStatus === "mfs") {
      if (input.nmMfsCommunityPropertyAllocated === null || input.nmMfsCommunityPropertyAllocated === undefined) {
        return { ok: false, code: "NM_MFS_COMMUNITY_PROPERTY_SCREEN_REQUIRED", errors: ["New Mexico MFS requires confirmation that community/separate income has been correctly divided under New Mexico community-property rules."], stateSupport };
      }
      if (input.nmMfsCommunityPropertyAllocated !== true) {
        return { ok: false, code: "NM_MFS_COMMUNITY_PROPERTY_REVIEW_REQUIRED", errors: ["New Mexico MFS community-property income must be correctly divided before this estimate can be calculated."], stateSupport };
      }
    }
    for (const [field, code, message] of [
      ["nmHasPitBAllocation", "NM_PIT_B_SCREEN_REQUIRED", "New Mexico needs to know whether PIT-B allocation/apportionment applies."],
      ["nmHasScheduleCCAlternativeTax", "NM_SCHEDULE_CC_SCREEN_REQUIRED", "New Mexico needs to know whether Schedule CC alternative tax applies."],
      ["nmHasLumpSumDistributionTax", "NM_LUMP_SUM_SCREEN_REQUIRED", "New Mexico needs to know whether PIT-1 Line 19 lump-sum distribution tax applies."],
      ["nmHasOtherStateCredit", "NM_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "New Mexico needs to know whether PIT-1 Line 20 credit for taxes paid to another state applies."],
      ["nmHasAmendedOrOtherSpecialItems", "NM_SPECIAL_ITEMS_SCREEN_REQUIRED", "New Mexico needs a final screen for PIT-X, fiscal-year, special royalty, or other material special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.nmHasPitBAllocation === true) return { ok: false, code: "NM_PIT_B_REVIEW_REQUIRED", errors: ["New Mexico PIT-B allocation/apportionment requires income-source details and a separate limitation calculation. This estimate is held rather than guessed."], stateSupport };
    if (input.nmHasScheduleCCAlternativeTax === true) return { ok: false, code: "NM_SCHEDULE_CC_REVIEW_REQUIRED", errors: ["New Mexico Schedule CC alternative-tax cases require the separate Schedule CC computation. This estimate is held rather than guessed."], stateSupport };
    if (input.nmHasLumpSumDistributionTax === true) return { ok: false, code: "NM_LUMP_SUM_REVIEW_REQUIRED", errors: ["New Mexico PIT-1 Line 19 lump-sum distribution tax requires the federal Form 4972/New Mexico averaging worksheet. This estimate is held rather than guessed."], stateSupport };
    if (input.nmHasOtherStateCredit === true) return { ok: false, code: "NM_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["New Mexico credit for tax paid to another state requires the other state's return and New Mexico limitation worksheet. This estimate is held rather than guessed."], stateSupport };
    if (input.nmHasAmendedOrOtherSpecialItems === true) return { ok: false, code: "NM_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This New Mexico return includes an amended, fiscal-year, special royalty, or other material situation that requires separate review."], stateSupport };
  }

  if (input.stateCode === "CA" && Number(input.taxYear) === 2025) {
    if (input.caFullYearResident === null || input.caFullYearResident === undefined) {
      return { ok: false, code: "CA_RESIDENCY_SCREEN_REQUIRED", errors: ["California needs confirmation that this is a full-year resident 2025 Form 540 return."], stateSupport };
    }
    if (input.caFullYearResident !== true) {
      return { ok: false, code: "CA_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["California part-year and nonresident returns require Form 540NR. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.caFilingStatusMatchesFederal === null || input.caFilingStatusMatchesFederal === undefined) {
      return { ok: false, code: "CA_FILING_STATUS_SCREEN_REQUIRED", errors: ["California needs confirmation that the California filing status matches the federal filing status."], stateSupport };
    }
    if (input.caFilingStatusMatchesFederal !== true) {
      return { ok: false, code: "CA_DIFFERENT_FILING_STATUS_REVIEW_REQUIRED", errors: ["California returns using a filing status different from the federal return require separate California filing-status analysis."], stateSupport };
    }
    if (input.caIsRegisteredDomesticPartner === null || input.caIsRegisteredDomesticPartner === undefined) {
      return { ok: false, code: "CA_RDP_SCREEN_REQUIRED", errors: ["California needs to know whether registered domestic partner filing rules apply."], stateSupport };
    }
    if (input.caIsRegisteredDomesticPartner === true) {
      return { ok: false, code: "CA_RDP_REVIEW_REQUIRED", errors: ["California registered domestic partner returns require a California pro forma federal computation and separate review."], stateSupport };
    }
    if (!["standard", "itemized"].includes(String(input.caDeductionMethod || ""))) {
      return { ok: false, code: "CA_DEDUCTION_METHOD_REQUIRED", errors: ["Select whether Form 540 Line 18 uses the California standard deduction or California itemized deductions."], stateSupport };
    }
    for (const [field, code, message] of [
      ["caScheduleCASubtractions", "CA_SCHEDULE_CA_SUBTRACTIONS_REQUIRED", "Enter exact signed Schedule CA amount carried to Form 540 Line 14, including 0."],
      ["caScheduleCAAdditions", "CA_SCHEDULE_CA_ADDITIONS_REQUIRED", "Enter exact signed Schedule CA amount carried to Form 540 Line 16, including 0."],
      ["caDeductionAmount", "CA_DEDUCTION_AMOUNT_REQUIRED", "Enter exact Form 540 Line 18 California deduction, including the completed dependent-standard-deduction worksheet when applicable."],
      ["caPersonalExemptionCount", "CA_PERSONAL_EXEMPTION_COUNT_REQUIRED", "Enter the exact Form 540 Line 7 personal exemption count."],
      ["caBlindExemptionCount", "CA_BLIND_EXEMPTION_COUNT_REQUIRED", "Enter the exact Form 540 Line 8 blind exemption count."],
      ["caSeniorExemptionCount", "CA_SENIOR_EXEMPTION_COUNT_REQUIRED", "Enter the exact Form 540 Line 9 senior exemption count."],
      ["caDependentExemptionCount", "CA_DEPENDENT_EXEMPTION_COUNT_REQUIRED", "Enter the exact Form 540 Line 10 dependent exemption count."],
      ["caNonrefundableCreditsTotal", "CA_NONREFUNDABLE_CREDITS_REQUIRED", "Enter exact Form 540 Line 47 total nonrefundable credits after all California limitations, including 0."],
      ["caAlternativeMinimumTax", "CA_AMT_REQUIRED", "Enter exact Form 540 Line 61 alternative minimum tax, including 0."],
      ["caOtherTaxesRecapture", "CA_OTHER_TAXES_REQUIRED", "Enter exact Form 540 Line 63 other taxes/credit recapture, including 0."],
      ["caOtherLine71Withholding", "CA_OTHER_WITHHOLDING_REQUIRED", "Enter California withholding on Form 540 Line 71 not already included in W-2 Box 17 withholding, including 0."],
      ["caEstimatedAndOtherPayments", "CA_ESTIMATED_PAYMENTS_REQUIRED", "Enter exact Form 540 Line 72 estimated tax and other payments, including 0."],
      ["caForms592593Withholding", "CA_FORMS_592_593_REQUIRED", "Enter exact Form 540 Line 73 Forms 592-B/593 withholding, including 0."],
      ["caMotionPictureRefundableCredit", "CA_MOTION_PICTURE_CREDIT_REQUIRED", "Enter exact Form 540 Line 74 refundable motion picture/television credit, including 0."],
      ["caCalEitc", "CA_EITC_REQUIRED", "Enter exact Form 540 Line 75 California Earned Income Tax Credit, including 0."],
      ["caYoungChildTaxCredit", "CA_YCTC_REQUIRED", "Enter exact Form 540 Line 76 Young Child Tax Credit, including 0."],
      ["caFosterYouthTaxCredit", "CA_FYTC_REQUIRED", "Enter exact Form 540 Line 77 Foster Youth Tax Credit, including 0."],
      ["caUseTax", "CA_USE_TAX_REQUIRED", "Enter exact Form 540 Line 91 use tax, including 0."],
      ["caIsrPenalty", "CA_ISR_REQUIRED", "Enter exact Form 540 Line 92 individual shared responsibility penalty from FTB 3853, including 0."],
      ["caApplyToNextYear", "CA_APPLY_NEXT_YEAR_REQUIRED", "Enter the amount of overpayment requested for 2026 estimated tax on Form 540 Line 98, including 0."],
      ["caContributions", "CA_CONTRIBUTIONS_REQUIRED", "Enter exact Form 540 Line 110 voluntary contributions, including 0."],
      ["caInterestLatePenalties", "CA_INTEREST_LATE_PENALTIES_REQUIRED", "Enter exact Form 540 Line 112 interest and late penalties, including 0."],
      ["caUnderpaymentPenalty", "CA_UNDERPAYMENT_PENALTY_REQUIRED", "Enter exact Form 540 Line 113 estimated-tax underpayment penalty, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined || String(input[field]).trim() === "") return { ok: false, code, errors: [message], stateSupport };
    }
    for (const field of [
      "caDeductionAmount", "caNonrefundableCreditsTotal", "caAlternativeMinimumTax", "caOtherTaxesRecapture", "caOtherLine71Withholding",
      "caEstimatedAndOtherPayments", "caForms592593Withholding", "caMotionPictureRefundableCredit", "caCalEitc", "caYoungChildTaxCredit",
      "caFosterYouthTaxCredit", "caUseTax", "caIsrPenalty", "caApplyToNextYear", "caContributions", "caInterestLatePenalties", "caUnderpaymentPenalty"
    ]) {
      if (!Number.isFinite(Number(input[field])) || Number(input[field]) < 0) return { ok: false, code: "CA_NEGATIVE_AMOUNT_INVALID", errors: [`California amount ${field} must be a valid nonnegative amount.`], stateSupport };
    }
    for (const field of ["caScheduleCASubtractions", "caScheduleCAAdditions"]) {
      if (!Number.isFinite(Number(input[field]))) return { ok: false, code: "CA_SIGNED_AMOUNT_INVALID", errors: [`California signed amount ${field} must be numeric.`], stateSupport };
    }
    for (const [field, max] of [["caPersonalExemptionCount",2],["caBlindExemptionCount",2],["caSeniorExemptionCount",2]]) {
      const value = Number(input[field]);
      if (!Number.isInteger(value) || value < 0 || value > max) return { ok: false, code: "CA_EXEMPTION_COUNT_INVALID", errors: [`California exemption count ${field} must be a whole number from 0 through ${max}.`], stateSupport };
    }
    if (!Number.isInteger(Number(input.caDependentExemptionCount)) || Number(input.caDependentExemptionCount) < 0) {
      return { ok: false, code: "CA_DEPENDENT_COUNT_INVALID", errors: ["California dependent exemption count must be a nonnegative whole number."], stateSupport };
    }
    if (input.caDeductionMethod === "standard" && input.canBeClaimedAsDependent !== true) {
      const status = String(input.filingStatus || "single").toLowerCase();
      const expected = ["mfj","hoh","qw"].includes(status) ? 11412 : 5706;
      if (Number(input.caDeductionAmount) !== expected) return { ok: false, code: "CA_STANDARD_DEDUCTION_MISMATCH", errors: [`California 2025 standard deduction should be $${expected.toLocaleString()} for this filing status when the taxpayer is not claimed as a dependent.`], stateSupport };
    }
    if (input.filingStatus === "mfs") {
      if (input.caMfsSpouseSameDeductionMethod === null || input.caMfsSpouseSameDeductionMethod === undefined) return { ok: false, code: "CA_MFS_DEDUCTION_SCREEN_REQUIRED", errors: ["California MFS needs confirmation that both spouses use the same standard/itemized deduction method."], stateSupport };
      if (input.caMfsSpouseSameDeductionMethod !== true) return { ok: false, code: "CA_MFS_DEDUCTION_REVIEW_REQUIRED", errors: ["California MFS spouses must both itemize or both take the standard deduction. Correct the deduction method before estimating."], stateSupport };
      if (input.caMfsCommunityPropertyAllocated === null || input.caMfsCommunityPropertyAllocated === undefined) return { ok: false, code: "CA_MFS_COMMUNITY_PROPERTY_SCREEN_REQUIRED", errors: ["California MFS needs confirmation that community and separate income has been correctly allocated."], stateSupport };
      if (input.caMfsCommunityPropertyAllocated !== true) return { ok: false, code: "CA_MFS_COMMUNITY_PROPERTY_REVIEW_REQUIRED", errors: ["California community-property allocation must be completed before this MFS estimate can be calculated."], stateSupport };
    }
    for (const [field, code, message] of [
      ["caHasCapitalConstructionFund", "CA_CCF_SCREEN_REQUIRED", "California needs to know whether a Capital Construction Fund adjustment applies."],
      ["caHasFtb3800Or3803", "CA_FTB3800_3803_SCREEN_REQUIRED", "California needs to know whether FTB 3800 or FTB 3803 child-investment-income tax applies."],
      ["caHasScheduleG1Or5870A", "CA_G1_5870A_SCREEN_REQUIRED", "California needs to know whether Schedule G-1 or FTB 5870A special tax applies."],
      ["caHasOtherStateTaxCredit", "CA_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "California needs to know whether Schedule S credit for tax paid to another state applies."],
      ["caHasClaimOfRightCredit", "CA_CLAIM_OF_RIGHT_SCREEN_REQUIRED", "California needs to know whether a claim-of-right credit applies."],
      ["caHasAmendedOrOtherSpecialItems", "CA_SPECIAL_ITEMS_SCREEN_REQUIRED", "California needs a final screen for amended or other material special items."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.caHasCapitalConstructionFund === true) return { ok: false, code: "CA_CCF_REVIEW_REQUIRED", errors: ["California Capital Construction Fund adjustments require the special Form 540 worksheet. This estimate is held rather than guessed."], stateSupport };
    if (input.caHasFtb3800Or3803 === true) return { ok: false, code: "CA_FTB3800_3803_REVIEW_REQUIRED", errors: ["California FTB 3800/3803 child-investment-income tax cases require a separate computation. This estimate is held rather than guessed."], stateSupport };
    if (input.caHasScheduleG1Or5870A === true) return { ok: false, code: "CA_G1_5870A_REVIEW_REQUIRED", errors: ["California Schedule G-1/FTB 5870A special tax requires a separate computation. This estimate is held rather than guessed."], stateSupport };
    if (input.caHasOtherStateTaxCredit === true) return { ok: false, code: "CA_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["California Schedule S other-state credit requires the other jurisdiction return and limitation calculation. This estimate is held rather than guessed."], stateSupport };
    if (input.caHasClaimOfRightCredit === true) return { ok: false, code: "CA_CLAIM_OF_RIGHT_REVIEW_REQUIRED", errors: ["California claim-of-right credit cases require separate California computation and reporting. This estimate is held rather than guessed."], stateSupport };
    if (input.caHasAmendedOrOtherSpecialItems === true) return { ok: false, code: "CA_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This California return includes an amended or other material special situation that requires separate review."], stateSupport };
  }


  if (input.stateCode === "OR" && Number(input.taxYear) === 2025) {
    if (input.orFullYearResident === null || input.orFullYearResident === undefined) {
      return { ok: false, code: "OR_RESIDENCY_SCREEN_REQUIRED", errors: ["Oregon needs confirmation that this is a full-year resident 2025 Form OR-40 return."], stateSupport };
    }
    if (input.orFullYearResident !== true) {
      return { ok: false, code: "OR_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Oregon part-year and nonresident returns require Form OR-40-P or OR-40-N. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.orFilingStatusMatchesFederal === null || input.orFilingStatusMatchesFederal === undefined) {
      return { ok: false, code: "OR_FILING_STATUS_SCREEN_REQUIRED", errors: ["Oregon needs confirmation that the Oregon filing status matches the federal filing status."], stateSupport };
    }
    if (input.orFilingStatusMatchesFederal !== true) {
      return { ok: false, code: "OR_DIFFERENT_FILING_STATUS_REVIEW_REQUIRED", errors: ["Oregon filing-status differences require separate Oregon analysis. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.orIsRegisteredDomesticPartner === null || input.orIsRegisteredDomesticPartner === undefined) {
      return { ok: false, code: "OR_RDP_SCREEN_REQUIRED", errors: ["Oregon needs to know whether registered domestic partner filing rules apply."], stateSupport };
    }
    if (input.orIsRegisteredDomesticPartner === true) {
      return { ok: false, code: "OR_RDP_REVIEW_REQUIRED", errors: ["Oregon registered domestic partner returns require a separate federal-as-if-married computation. This estimate is held rather than guessed."], stateSupport };
    }
    if (!["standard", "itemized"].includes(String(input.orDeductionMethod || ""))) {
      return { ok: false, code: "OR_DEDUCTION_METHOD_REQUIRED", errors: ["Select whether Form OR-40 uses the Oregon standard deduction or Oregon itemized deductions."], stateSupport };
    }
    const orAmountFields = [
      "orAdditions", "orFederalTaxLiabilitySubtraction", "orSocialSecurityTier1Subtraction", "orOregonRefundSubtraction",
      "orOtherSubtractions", "orDeductionAmount", "orInstallmentSaleInterest", "orTaxRecaptures", "orExemptionCredit",
      "orPoliticalContributionCredit", "orOtherStandardCredits", "orCarryforwardCredits", "orKicker", "orOtherWithholding",
      "orPriorYearRefundApplied", "orEstimatedPayments", "orPteEstimatedPayments", "orFederalEitcAmount", "orKidsCredit",
      "orOtherRefundableCredits", "orPenaltyInterest", "orRefundApplications"
    ];
    for (const field of orAmountFields) {
      if (input[field] === null || input[field] === undefined || String(input[field]).trim() === "" || !Number.isFinite(Number(input[field]))) {
        return { ok: false, code: "OR_AMOUNT_REQUIRED", errors: [`Complete required Oregon amount ${field}. Enter 0 when none applies.`], stateSupport };
      }
      if (Number(input[field]) < 0) {
        return { ok: false, code: "OR_NEGATIVE_AMOUNT_INVALID", errors: [`Oregon amount ${field} must be a valid nonnegative amount.`], stateSupport };
      }
    }
    const orAgi = Math.max(0, Number(federal?.summary?.agi || 0));
    const orStatus = String(input.filingStatus || "single").toLowerCase();
    let orFedTaxMax;
    if (orStatus === "mfs") {
      orFedTaxMax = orAgi < 125000 ? 4250 : orAgi < 130000 ? 3400 : orAgi < 135000 ? 2550 : orAgi < 140000 ? 1700 : orAgi < 145000 ? 850 : 0;
    } else if (orStatus === "single") {
      orFedTaxMax = orAgi < 125000 ? 8500 : orAgi < 130000 ? 6800 : orAgi < 135000 ? 5100 : orAgi < 140000 ? 3400 : orAgi < 145000 ? 1700 : 0;
    } else {
      orFedTaxMax = orAgi < 250000 ? 8500 : orAgi < 260000 ? 6800 : orAgi < 270000 ? 5100 : orAgi < 280000 ? 3400 : orAgi < 290000 ? 1700 : 0;
    }
    if (Number(input.orFederalTaxLiabilitySubtraction) > orFedTaxMax) {
      return { ok: false, code: "OR_FEDERAL_TAX_SUBTRACTION_EXCEEDS_MAX", errors: [`Oregon 2025 federal tax liability subtraction exceeds the $${orFedTaxMax.toLocaleString()} maximum for this filing status and federal AGI.`], stateSupport };
    }
    if (input.filingStatus === "mfs" && input.orDeductionMethod === "standard") {
      if (input.orMfsSpouseItemizes === null || input.orMfsSpouseItemizes === undefined) {
        return { ok: false, code: "OR_MFS_SPOUSE_ITEMIZES_SCREEN_REQUIRED", errors: ["Oregon MFS needs confirmation whether the spouse itemizes deductions."], stateSupport };
      }
      if (input.orMfsSpouseItemizes === true && Number(input.orDeductionAmount) !== 0) {
        return { ok: false, code: "OR_MFS_STANDARD_DEDUCTION_ZERO_REQUIRED", errors: ["Oregon MFS standard deduction must be $0 when the spouse itemizes deductions."], stateSupport };
      }
    }
    if (Number(input.orFederalEitcAmount) > 0 && (input.orYoungestDependentUnder3 === null || input.orYoungestDependentUnder3 === undefined)) {
      return { ok: false, code: "OR_EIC_CHILD_AGE_SCREEN_REQUIRED", errors: ["Oregon needs to know whether the youngest qualifying dependent was under age 3 at the end of 2025 to apply the 9% or 12% Oregon EIC rate."], stateSupport };
    }
    for (const [field, code, message] of [
      ["orHasAlternateTaxMethod", "OR_ALTERNATE_TAX_SCREEN_REQUIRED", "Oregon needs to know whether farm income averaging, farm capital gain, or OR-PTE qualified business income tax treatment applies."],
      ["orHasOtherStateCredit", "OR_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Oregon needs to know whether a credit for tax paid to another state applies."],
      ["orHasItinEicSpecialCase", "OR_ITIN_EIC_SCREEN_REQUIRED", "Oregon needs to know whether the special ITIN Oregon EIC path applies."],
      ["orHasSeparateTransitTaxFiling", "OR_TRANSIT_TAX_SCREEN_REQUIRED", "Oregon needs to know whether a separate transit self-employment or statewide transit tax filing applies."],
      ["orHasAmendedNolOrOtherSpecialItems", "OR_SPECIAL_ITEMS_SCREEN_REQUIRED", "Oregon needs a final screen for amended, Oregon NOL, or other material special items."]
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.orHasAlternateTaxMethod === true) return { ok: false, code: "OR_ALTERNATE_TAX_REVIEW_REQUIRED", errors: ["Oregon farm income averaging, farm capital-gain method, and OR-PTE qualified business income methods require a separate tax computation. This estimate is held rather than guessed."], stateSupport };
    if (input.orHasOtherStateCredit === true) return { ok: false, code: "OR_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Oregon credit for tax paid to another state requires the other jurisdiction return and Oregon limitation calculation. This estimate is held rather than guessed."], stateSupport };
    if (input.orHasItinEicSpecialCase === true) return { ok: false, code: "OR_ITIN_EIC_REVIEW_REQUIRED", errors: ["Oregon's special ITIN earned-income-credit path requires separate eligibility analysis. This estimate is held rather than guessed."], stateSupport };
    if (input.orHasSeparateTransitTaxFiling === true) return { ok: false, code: "OR_TRANSIT_TAX_REVIEW_REQUIRED", errors: ["Separate Oregon transit-tax filing applies. That liability is not guessed inside the OR-40 estimate and requires separate review."], stateSupport };
    if (input.orHasAmendedNolOrOtherSpecialItems === true) return { ok: false, code: "OR_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Oregon return includes an amended, Oregon NOL, or other material special situation that requires separate review."], stateSupport };
  }

  if (input.stateCode === "WA" && Number(input.taxYear) === 2025) {
    if (input.waFullYearResident === null || input.waFullYearResident === undefined) {
      return { ok: false, code: "WA_RESIDENCY_SCREEN_REQUIRED", errors: ["Washington needs confirmation that this 2025 estimate is for a full-year Washington resident."], stateSupport };
    }
    if (input.waFullYearResident !== true) {
      return { ok: false, code: "WA_RESIDENCY_REVIEW_REQUIRED", errors: ["Washington capital-gains allocation for part-year/nonresident or domicile-change situations requires transaction-level sourcing. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.filingStatus === "mfs") {
      return { ok: false, code: "WA_MFS_REVIEW_REQUIRED", errors: ["Washington spouses filing separately share one combined capital-gains standard deduction. MFS requires a separate allocation review and is held rather than guessed."], stateSupport };
    }
    if (input.waIsRegisteredDomesticPartner === null || input.waIsRegisteredDomesticPartner === undefined) {
      return { ok: false, code: "WA_RDP_SCREEN_REQUIRED", errors: ["Washington needs to know whether state-registered domestic-partner rules apply."], stateSupport };
    }
    if (input.waIsRegisteredDomesticPartner === true) {
      return { ok: false, code: "WA_RDP_REVIEW_REQUIRED", errors: ["Washington registered domestic partners share the combined capital-gains standard deduction and require separate return-allocation review. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.waCapitalGainsBaseCompleted === null || input.waCapitalGainsBaseCompleted === undefined) {
      return { ok: false, code: "WA_CAPITAL_GAINS_BASE_SCREEN_REQUIRED", errors: ["Confirm that the Washington capital-gains amount has been completed after allocation and exempt-asset adjustments."], stateSupport };
    }
    if (input.waCapitalGainsBaseCompleted !== true) {
      return { ok: false, code: "WA_CAPITAL_GAINS_BASE_REVIEW_REQUIRED", errors: ["Washington requires allocation and exempt-asset adjustments before tax can be calculated. Complete that Washington capital-gains base first; this estimator will not guess transaction sourcing."], stateSupport };
    }
    for (const field of ["waCapitalGainsBeforeDeductions","waConstitutionalDeduction","waFamilyOwnedBusinessDeduction","waQualifyingCharitableDonations","waOtherJurisdictionCredit","waBoCapitalGainsCredit","waCapitalGainsPayments","waWorkingFamiliesTaxCredit","waPenaltyInterest"]) {
      if (input[field] === null || input[field] === undefined || !Number.isFinite(Number(input[field]))) {
        return { ok: false, code: "WA_AMOUNT_REQUIRED", errors: [`Complete required Washington amount ${field}. Enter 0 when none applies.`], stateSupport };
      }
    }
    for (const field of ["waConstitutionalDeduction","waFamilyOwnedBusinessDeduction","waQualifyingCharitableDonations","waOtherJurisdictionCredit","waBoCapitalGainsCredit","waCapitalGainsPayments","waWorkingFamiliesTaxCredit","waPenaltyInterest"]) {
      if (Number(input[field]) < 0) return { ok: false, code: "WA_NEGATIVE_AMOUNT_INVALID", errors: [`Washington amount ${field} cannot be negative.`], stateSupport };
    }
    if (Number(input.waWorkingFamiliesTaxCredit) > 1330) {
      return { ok: false, code: "WA_WFTC_AMOUNT_INVALID", errors: ["Washington 2025 Working Families Tax Credit cannot exceed the $1,330 maximum. Enter the exact completed 2025 credit amount."], stateSupport };
    }
    if (Number(input.stateWithheld || 0) > 0) {
      return { ok: false, code: "WA_WAGE_WITHHOLDING_REVIEW_REQUIRED", errors: ["Washington does not impose wage income tax. W-2 state withholding entered for a Washington resident may belong to another state and requires multi-state review; it is not treated as a Washington refund."], stateSupport };
    }
    if (input.waHasOtherMaterialSpecialCase === null || input.waHasOtherMaterialSpecialCase === undefined) {
      return { ok: false, code: "WA_SPECIAL_ITEMS_SCREEN_REQUIRED", errors: ["Washington needs a final screen for other material capital-gains special cases."], stateSupport };
    }
    if (input.waHasOtherMaterialSpecialCase === true) {
      return { ok: false, code: "WA_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Washington capital-gains return has another material special situation that requires separate review rather than a guessed calculation."], stateSupport };
    }
  }

  if (input.stateCode === "HI" && Number(input.taxYear) === 2025) {
    if (input.hiFullYearResident === null || input.hiFullYearResident === undefined) return { ok: false, code: "HI_RESIDENCY_SCREEN_REQUIRED", errors: ["Hawaii needs confirmation that this is a full-year resident 2025 Form N-11 return."], stateSupport };
    if (input.hiFullYearResident !== true) return { ok: false, code: "HI_N15_REVIEW_REQUIRED", errors: ["Hawaii part-year and nonresident returns require Form N-15 and allocation. This estimate is held rather than guessed."], stateSupport };
    if (input.hiFilingStatusMatchesFederal === null || input.hiFilingStatusMatchesFederal === undefined) return { ok: false, code: "HI_FILING_STATUS_SCREEN_REQUIRED", errors: ["Hawaii needs confirmation that the Hawaii filing status matches the federal filing status."], stateSupport };
    if (input.hiFilingStatusMatchesFederal !== true) return { ok: false, code: "HI_DIFFERENT_FILING_STATUS_REVIEW_REQUIRED", errors: ["Hawaii filing-status differences, including civil-union treatment, require separate analysis. This estimate is held rather than guessed."], stateSupport };
    if (input.canBeClaimedAsDependent === true) return { ok: false, code: "HI_DEPENDENT_DEDUCTION_REVIEW_REQUIRED", errors: ["A taxpayer who can be claimed as another taxpayer's dependent can have a special Hawaii standard-deduction computation. This estimate is held rather than guessed."], stateSupport };
    if (!["standard", "itemized"].includes(String(input.hiDeductionMethod || ""))) return { ok: false, code: "HI_DEDUCTION_METHOD_REQUIRED", errors: ["Select the Hawaii standard deduction or exact completed Hawaii itemized deduction."], stateSupport };
    const amountFields = ["hiAdditions","hiSubtractions","hiItemizedDeductionAmount","hiExemptionCount","hiOtherTaxes","hiNonrefundableCredits","hiRefundableEic","hiOtherRefundableCredits","hiEstimatedPayments","hiOtherPayments","hiPenaltyInterest"];
    for (const field of amountFields) {
      if (input[field] === null || input[field] === undefined || !Number.isFinite(Number(input[field]))) return { ok: false, code: "HI_AMOUNT_REQUIRED", errors: [`Complete required Hawaii amount ${field}. Enter 0 when none applies.`], stateSupport };
      if (Number(input[field]) < 0) return { ok: false, code: "HI_NEGATIVE_AMOUNT_INVALID", errors: [`Hawaii amount ${field} cannot be negative.`], stateSupport };
    }
    if (!Number.isInteger(Number(input.hiExemptionCount))) return { ok: false, code: "HI_EXEMPTION_COUNT_INVALID", errors: ["Hawaii exemption count must be a whole number of $1,144 exemption units."], stateSupport };
    if (input.hiDeductionMethod === "standard" && Number(input.hiItemizedDeductionAmount) !== 0) return { ok: false, code: "HI_STANDARD_DEDUCTION_ITEMIZED_ZERO_REQUIRED", errors: ["Enter 0 for Hawaii itemized deductions when the standard deduction is selected."], stateSupport };
    if (input.filingStatus === "mfs") {
      if (input.hiMfsSpouseItemizes === null || input.hiMfsSpouseItemizes === undefined) return { ok: false, code: "HI_MFS_SPOUSE_ITEMIZES_SCREEN_REQUIRED", errors: ["Hawaii MFS needs confirmation whether the spouse itemizes deductions."], stateSupport };
      if (input.hiMfsSpouseItemizes === true && input.hiDeductionMethod === "standard") return { ok: false, code: "HI_MFS_ITEMIZED_REVIEW_REQUIRED", errors: ["Hawaii MFS cannot use the standard deduction when the spouse itemizes. Use the exact completed Hawaii itemized deduction or review separately."], stateSupport };
    }
    for (const [field, code, message] of [
      ["hiHasCertifiedDisabilityExemption", "HI_DISABILITY_SCREEN_REQUIRED", "Hawaii needs to know whether the certified $7,000 disability exemption applies."],
      ["hiHasCapitalGainAlternativeTaxCase", "HI_CAPITAL_GAIN_SCREEN_REQUIRED", "Hawaii needs to know whether the alternative tax on capital gains worksheet may apply."],
      ["hiHasPteTaxCreditOrAdjustment", "HI_PTE_SCREEN_REQUIRED", "Hawaii needs to know whether 2025 PTE tax credit/addition treatment applies."],
      ["hiHasOtherStateCredit", "HI_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Hawaii needs to know whether a credit for tax paid to another state applies."],
      ["hiHasAmendedOrOtherSpecialItems", "HI_SPECIAL_ITEMS_SCREEN_REQUIRED", "Hawaii needs a final screen for amended or other material special items."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.hiHasCertifiedDisabilityExemption === true) return { ok: false, code: "HI_DISABILITY_REVIEW_REQUIRED", errors: ["Hawaii's certified $7,000 blindness/deafness/total-disability exemption is in lieu of the regular personal exemption and requires separate Form N-172 review."], stateSupport };
    if (input.hiHasCapitalGainAlternativeTaxCase === true) return { ok: false, code: "HI_CAPITAL_GAIN_REVIEW_REQUIRED", errors: ["Hawaii's alternative tax on capital gains uses a separate worksheet and 2025 corrected thresholds. This estimate is held rather than guessed."], stateSupport };
    if (input.hiHasPteTaxCreditOrAdjustment === true) return { ok: false, code: "HI_PTE_REVIEW_REQUIRED", errors: ["Hawaii 2025 PTE credit cases require the qualified-member income add-back and Schedule CR/Form N-362 computation. This estimate is held rather than guessed."], stateSupport };
    if (input.hiHasOtherStateCredit === true) return { ok: false, code: "HI_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Hawaii credit for tax paid to another state requires the other jurisdiction return and limitation computation. This estimate is held rather than guessed."], stateSupport };
    if (input.hiHasAmendedOrOtherSpecialItems === true) return { ok: false, code: "HI_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Hawaii return includes an amended or other material special situation requiring separate review."], stateSupport };
  }


  if (input.stateCode === "DE" && Number(input.taxYear) === 2025) {
    if (input.deFullYearResident === null || input.deFullYearResident === undefined) {
      return { ok: false, code: "DE_RESIDENCY_SCREEN_REQUIRED", errors: ["Delaware needs confirmation that this is a full-year resident 2025 PIT-RES return."], stateSupport };
    }
    if (input.deFullYearResident !== true) {
      return { ok: false, code: "DE_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Delaware part-year and nonresident cases require resident-election or PIT-NON allocation analysis. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.deFilingStatusMatchesFederal === null || input.deFilingStatusMatchesFederal === undefined) {
      return { ok: false, code: "DE_FILING_STATUS_SCREEN_REQUIRED", errors: ["Delaware needs confirmation that the Delaware filing status matches the federal filing status."], stateSupport };
    }
    if (input.deFilingStatusMatchesFederal !== true) {
      return { ok: false, code: "DE_DIFFERENT_FILING_STATUS_REVIEW_REQUIRED", errors: ["A Delaware filing-status election that differs from federal requires separate analysis. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.filingStatus === "mfs") {
      return { ok: false, code: "DE_SEPARATE_RETURN_REVIEW_REQUIRED", errors: ["Delaware married taxpayers may use separate or combined-separate filing with spouse-level income, deduction, credit, and joint-asset allocation. This MFS case is held for separate review."], stateSupport };
    }
    if (input.filingStatus === "qw") {
      return { ok: false, code: "DE_QSS_STATUS_REVIEW_REQUIRED", errors: ["Delaware PIT-RES uses its own filing-status categories and the qualifying-surviving-spouse mapping is held for separate review rather than guessed."], stateSupport };
    }
    if (!["single", "mfj", "hoh"].includes(String(input.filingStatus || ""))) {
      return { ok: false, code: "DE_FILING_STATUS_REVIEW_REQUIRED", errors: ["This Delaware filing status is outside the supported full-year PIT-RES core path."], stateSupport };
    }
    if (!["standard", "itemized"].includes(String(input.deDeductionMethod || ""))) {
      return { ok: false, code: "DE_DEDUCTION_METHOD_REQUIRED", errors: ["Select the Delaware standard deduction or exact completed Delaware PIT-RSA itemized deduction."], stateSupport };
    }
    for (const field of [
      "deAdditions","deSubtractions","deItemizedDeductionAmount","deVolunteerFirefighterCount",
      "deFederalChildDependentCareCredit","deOtherNonrefundableCredits","deFederalEITCAmount",
      "deEstimatedPayments","deSCorporationPayments","deRealEstateCapitalGainsPayments",
      "deOtherRefundableCredits","dePenaltyInterest"
    ]) {
      if (input[field] === null || input[field] === undefined || !Number.isFinite(Number(input[field]))) {
        return { ok: false, code: "DE_AMOUNT_REQUIRED", errors: [`Complete required Delaware amount ${field}. Enter 0 when none applies.`], stateSupport };
      }
      if (Number(input[field]) < 0) {
        return { ok: false, code: "DE_NEGATIVE_AMOUNT_INVALID", errors: [`Delaware amount ${field} cannot be negative.`], stateSupport };
      }
    }
    if (!Number.isInteger(Number(input.deVolunteerFirefighterCount))) {
      return { ok: false, code: "DE_FIREFIGHTER_COUNT_INVALID", errors: ["Delaware volunteer-firefighter credit count must be a whole number."], stateSupport };
    }
    const maxFirefighterCount = input.filingStatus === "mfj" ? 2 : 1;
    if (Number(input.deVolunteerFirefighterCount) > maxFirefighterCount) {
      return { ok: false, code: "DE_FIREFIGHTER_COUNT_INVALID", errors: [`Delaware volunteer-firefighter credit count cannot exceed ${maxFirefighterCount} for this supported filing status.`], stateSupport };
    }
    if (input.deDeductionMethod === "standard") {
      if (input.deTaxpayerBlind === null || input.deTaxpayerBlind === undefined) {
        return { ok: false, code: "DE_TAXPAYER_BLIND_SCREEN_REQUIRED", errors: ["Delaware standard deduction needs the taxpayer blindness answer for the additional $2,500 deduction."], stateSupport };
      }
      if (input.filingStatus === "mfj" && (input.deSpouseBlind === null || input.deSpouseBlind === undefined)) {
        return { ok: false, code: "DE_SPOUSE_BLIND_SCREEN_REQUIRED", errors: ["Delaware MFJ standard deduction needs the spouse blindness answer for the additional $2,500 deduction."], stateSupport };
      }
      if (Number(input.deItemizedDeductionAmount) !== 0) {
        return { ok: false, code: "DE_STANDARD_DEDUCTION_ITEMIZED_ZERO_REQUIRED", errors: ["Enter 0 for Delaware itemized deductions when using the standard deduction."], stateSupport };
      }
    }
    for (const [field, code, message] of [
      ["deHasLumpSumDistribution", "DE_LUMP_SUM_SCREEN_REQUIRED", "Delaware needs to know whether the special PIT-STC lump-sum distribution tax applies."],
      ["deHasOtherStateCredit", "DE_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Delaware needs to know whether a credit for income tax paid to another state applies."],
      ["deHasAmendedOrOtherSpecialItems", "DE_SPECIAL_ITEMS_SCREEN_REQUIRED", "Delaware needs a final screen for amended or other material special items."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.deHasLumpSumDistribution === true) {
      return { ok: false, code: "DE_LUMP_SUM_REVIEW_REQUIRED", errors: ["Delaware qualified lump-sum distributions use the separate PIT-STC special tax computation. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.deHasOtherStateCredit === true) {
      return { ok: false, code: "DE_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Delaware other-state credit requires the other state's adjusted gross income, net tax paid, and Delaware limitation worksheet. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.deHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "DE_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Delaware return includes an amended or other material special situation requiring separate review."], stateSupport };
    }
  }

  if (input.stateCode === "CT" && Number(input.taxYear) === 2025) {
    if (input.ctFullYearResident === null || input.ctFullYearResident === undefined) {
      return { ok: false, code: "CT_RESIDENCY_SCREEN_REQUIRED", errors: ["Connecticut needs confirmation that this is a full-year resident 2025 CT-1040 return."], stateSupport };
    }
    if (input.ctFullYearResident !== true) {
      return { ok: false, code: "CT_NR_PY_REVIEW_REQUIRED", errors: ["Connecticut part-year and nonresident returns require Form CT-1040NR/PY and Connecticut-source allocation. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.ctFilingStatusMatchesFederal === null || input.ctFilingStatusMatchesFederal === undefined) {
      return { ok: false, code: "CT_FILING_STATUS_SCREEN_REQUIRED", errors: ["Connecticut needs confirmation that the Connecticut filing status matches the federal filing status."], stateSupport };
    }
    if (input.ctFilingStatusMatchesFederal !== true) {
      return { ok: false, code: "CT_DIFFERENT_FILING_STATUS_REVIEW_REQUIRED", errors: ["A Connecticut filing-status exception requires separate analysis. This estimate is held rather than guessed."], stateSupport };
    }
    if (!["single", "mfj", "mfs", "hoh", "qw"].includes(String(input.filingStatus || ""))) {
      return { ok: false, code: "CT_FILING_STATUS_REVIEW_REQUIRED", errors: ["This Connecticut filing status is outside the supported full-year CT-1040 core path."], stateSupport };
    }
    for (const field of [
      "ctAdditions","ctSubtractions","ctAlternativeMinimumTax","ctPropertyTaxCredit","ctAllowableCredits",
      "ctUseTax","ctEstimatedPayments","ctExtensionPayment","ctFederalEITCAmount",
      "ctOtherRefundableCredits","ctRefundAllocations","ctPenaltyInterest"
    ]) {
      if (input[field] === null || input[field] === undefined || !Number.isFinite(Number(input[field]))) {
        return { ok: false, code: "CT_AMOUNT_REQUIRED", errors: [`Complete required Connecticut amount ${field}. Enter 0 when none applies.`], stateSupport };
      }
      if (Number(input[field]) < 0) {
        return { ok: false, code: "CT_NEGATIVE_AMOUNT_INVALID", errors: [`Connecticut amount ${field} cannot be negative.`], stateSupport };
      }
    }
    if (Number(input.ctPropertyTaxCredit) > 300) {
      return { ok: false, code: "CT_PROPERTY_TAX_CREDIT_INVALID", errors: ["Connecticut's property tax credit cannot exceed $300 per return. Enter the exact completed Schedule 3 Line 68 amount."], stateSupport };
    }
    for (const [field, code, message] of [
      ["ctHasOtherStateCredit", "CT_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Connecticut needs to know whether a credit for income tax paid to another jurisdiction applies."],
      ["ctHasFederalAMT", "CT_AMT_SCREEN_REQUIRED", "Connecticut needs to know whether federal alternative minimum tax was required for 2025."],
      ["ctClaimedFederalEITC", "CT_EITC_SCREEN_REQUIRED", "Connecticut needs to know whether a federal earned income credit was claimed and allowed."],
      ["ctHasAmendedOrOtherSpecialItems", "CT_SPECIAL_ITEMS_SCREEN_REQUIRED", "Connecticut needs a final screen for amended or other material special items."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.ctHasOtherStateCredit === true) {
      return { ok: false, code: "CT_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Connecticut credit for tax paid to another jurisdiction requires Schedule 2 and the other jurisdiction's return. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.ctHasFederalAMT !== true && Number(input.ctAlternativeMinimumTax) !== 0) {
      return { ok: false, code: "CT_AMT_ZERO_REQUIRED", errors: ["Enter 0 for Connecticut alternative minimum tax when federal AMT was not required."], stateSupport };
    }
    if (input.ctClaimedFederalEITC === true) {
      if (!(Number(input.ctFederalEITCAmount) > 0)) {
        return { ok: false, code: "CT_FEDERAL_EITC_REQUIRED", errors: ["Enter the federal earned income credit amount used to calculate the Connecticut EITC."], stateSupport };
      }
      if (input.ctEitcHasQualifyingChild === null || input.ctEitcHasQualifyingChild === undefined) {
        return { ok: false, code: "CT_EITC_CHILD_SCREEN_REQUIRED", errors: ["Connecticut needs to know whether the federal EITC has at least one qualifying child for the additional $250 credit."], stateSupport };
      }
    } else if (Number(input.ctFederalEITCAmount) !== 0) {
      return { ok: false, code: "CT_EITC_ZERO_REQUIRED", errors: ["Enter 0 for the federal EITC amount when no federal EITC was claimed."], stateSupport };
    }
    if (input.ctHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "CT_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Connecticut return includes an amended or other material special situation requiring separate review."], stateSupport };
    }
  }

  if (input.stateCode === "ME" && Number(input.taxYear) === 2025) {
    if (input.meFullYearResident === null || input.meFullYearResident === undefined) {
      return { ok: false, code: "ME_RESIDENCY_SCREEN_REQUIRED", errors: ["Maine needs confirmation that this is a full-year resident 2025 Form 1040ME return."], stateSupport };
    }
    if (input.meFullYearResident !== true) {
      return { ok: false, code: "ME_NR_PY_REVIEW_REQUIRED", errors: ["Maine part-year, nonresident, and safe-harbor returns require Schedule NR/NRH and Maine-source allocation. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.meFilingStatusMatchesFederal === null || input.meFilingStatusMatchesFederal === undefined) {
      return { ok: false, code: "ME_FILING_STATUS_SCREEN_REQUIRED", errors: ["Maine needs confirmation that the Maine filing status follows the federal filing status."], stateSupport };
    }
    if (input.meFilingStatusMatchesFederal !== true) {
      return { ok: false, code: "ME_DIFFERENT_FILING_STATUS_REVIEW_REQUIRED", errors: ["A Maine filing-status exception requires separate analysis. This estimate is held rather than guessed."], stateSupport };
    }
    if (String(input.filingStatus || "").toLowerCase() === "mfs") {
      return { ok: false, code: "ME_MFS_REVIEW_REQUIRED", errors: ["Maine married-filing-separately returns have spouse-exemption and deduction interactions outside this supported core path. This estimate is held rather than guessed."], stateSupport };
    }
    if (!["single","mfj","hoh","qw"].includes(String(input.filingStatus || "").toLowerCase())) {
      return { ok: false, code: "ME_FILING_STATUS_REVIEW_REQUIRED", errors: ["This Maine filing status is outside the supported full-year Form 1040ME core path."], stateSupport };
    }
    if (!['standard','itemized'].includes(String(input.meFederalDeductionMethod || '').toLowerCase())) {
      return { ok: false, code: "ME_DEDUCTION_METHOD_REQUIRED", errors: ["Select whether the 2025 federal return used the standard deduction or itemized deductions for Maine Line 17."], stateSupport };
    }
    if (input.meTaxpayerBlind === null || input.meTaxpayerBlind === undefined) {
      return { ok: false, code: "ME_BLINDNESS_SCREEN_REQUIRED", errors: ["Maine needs the taxpayer blindness answer for the 2025 additional standard deduction."], stateSupport };
    }
    if (String(input.filingStatus || '').toLowerCase() === 'mfj') {
      if (input.meSpouseCanBeClaimedAsDependent === null || input.meSpouseCanBeClaimedAsDependent === undefined) {
        return { ok: false, code: "ME_SPOUSE_DEPENDENT_SCREEN_REQUIRED", errors: ["Maine needs to know whether the spouse can be claimed as another person's dependent."], stateSupport };
      }
      if (input.meSpouseBlind === null || input.meSpouseBlind === undefined) {
        return { ok: false, code: "ME_SPOUSE_BLINDNESS_SCREEN_REQUIRED", errors: ["Maine needs the spouse blindness answer for the 2025 additional standard deduction."], stateSupport };
      }
    }
    const amountFields = [
      "meAdditions","meSubtractions","meItemizedDeductionAmount","meTaxCreditRecapture","meOtherNonrefundableCredits",
      "meFederalEITCAmount","meOtherRefundableCredits","mePropertyTaxFairnessCredit","meSalesTaxFairnessCredit",
      "meOtherMaineWithholding","meOtherPayments","meUseTax","meCasualRentalTax","meVoluntaryContributions",
      "meUnderpaymentPenalty","meCreditToNextYear"
    ];
    for (const field of amountFields) {
      if (input[field] === null || input[field] === undefined || Number.isNaN(Number(input[field]))) {
        return { ok: false, code: "ME_AMOUNT_REQUIRED", errors: [`Complete required Maine amount ${field}. Enter 0 when none applies.`], stateSupport };
      }
      if (Number(input[field]) < 0) {
        return { ok: false, code: "ME_NEGATIVE_AMOUNT_INVALID", errors: [`Maine amount ${field} cannot be negative.`], stateSupport };
      }
    }
    if (String(input.meFederalDeductionMethod || '').toLowerCase() !== 'itemized' && Number(input.meItemizedDeductionAmount || 0) !== 0) {
      return { ok: false, code: "ME_ITEMIZED_ZERO_REQUIRED", errors: ["Enter 0 for Maine Schedule 2 itemized deductions when the federal return did not itemize."], stateSupport };
    }
    for (const field of ["meDependentCreditAge6OrOlderCount","meDependentCreditUnder6Count"]) {
      if (input[field] === null || input[field] === undefined || !Number.isInteger(Number(input[field])) || Number(input[field]) < 0) {
        return { ok: false, code: "ME_DEPENDENT_CREDIT_COUNT_INVALID", errors: ["Enter whole-number Maine dependent-credit counts, including 0."], stateSupport };
      }
    }
    if (Number(input.meDependentCreditAge6OrOlderCount || 0) + Number(input.meDependentCreditUnder6Count || 0) > Number(input.numberOfDependents || 0)) {
      return { ok: false, code: "ME_DEPENDENT_CREDIT_COUNT_EXCEEDS_DEPENDENTS", errors: ["Maine dependent exemption credit counts cannot exceed the total dependents entered on the estimate."], stateSupport };
    }
    for (const field of ["meHasOtherStateCredit","meClaimedFederalEITC","meHasMaineOnlyEitcEligibility","meHasAmendedOrOtherSpecialItems"]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code: "ME_SCREEN_REQUIRED", errors: [`Complete required Maine screen ${field}.`], stateSupport };
      }
    }
    if (input.meHasOtherStateCredit === true) {
      return { ok: false, code: "ME_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Maine credit for income tax paid to another taxing jurisdiction requires the other jurisdiction's return and Maine limitation worksheet. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.meClaimedFederalEITC === true) {
      if (!(Number(input.meFederalEITCAmount) > 0)) {
        return { ok: false, code: "ME_FEDERAL_EITC_REQUIRED", errors: ["Enter the allowed 2025 federal earned income credit amount used by the Maine EIC worksheet."], stateSupport };
      }
      if (input.meEitcHasQualifyingChild === null || input.meEitcHasQualifyingChild === undefined) {
        return { ok: false, code: "ME_EITC_CHILD_SCREEN_REQUIRED", errors: ["Maine needs to know whether the 2025 federal EIC had at least one qualifying child."], stateSupport };
      }
      if (input.meHasMaineOnlyEitcEligibility === true) {
        return { ok: false, code: "ME_EITC_SCREEN_CONFLICT", errors: ["Do not select Maine-only EIC eligibility when a federal EIC was already claimed."], stateSupport };
      }
    } else {
      if (Number(input.meFederalEITCAmount || 0) !== 0) {
        return { ok: false, code: "ME_EITC_ZERO_REQUIRED", errors: ["Enter 0 for federal EIC when no federal EIC was claimed."], stateSupport };
      }
      if (input.meHasMaineOnlyEitcEligibility === true) {
        return { ok: false, code: "ME_SPECIAL_EITC_REVIEW_REQUIRED", errors: ["Maine can allow EIC for certain ITIN filers or age-18-or-older taxpayers without qualifying children even when no federal EIC was claimed. That pro-forma federal EIC worksheet case is held for separate review rather than guessed."], stateSupport };
      }
    }
    if (Number(input.meCasualRentalTax || 0) > 2000) {
      return { ok: false, code: "ME_CASUAL_RENTAL_TAX_REVIEW_REQUIRED", errors: ["Maine casual-rental sales tax over $2,000 must be filed on a separate sales/use tax return and cannot be placed on Form 1040ME Line 30a."], stateSupport };
    }
    if (input.meHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "ME_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Maine return includes an amended or other material special situation requiring separate review."], stateSupport };
    }
  }

  if (input.stateCode === "MD" && Number(input.taxYear) === 2025) {
    const status = String(input.filingStatus || "").toLowerCase();
    if (input.mdFullYearResident === null || input.mdFullYearResident === undefined) return { ok:false, code:"MD_RESIDENCY_SCREEN_REQUIRED", errors:["Maryland needs confirmation that this is a full-year resident 2025 Form 502 return."], stateSupport };
    if (input.mdFullYearResident !== true) return { ok:false, code:"MD_NR_PY_REVIEW_REQUIRED", errors:["Maryland part-year and nonresident returns require residence-period and Maryland-source allocation. This estimate is held rather than guessed."], stateSupport };
    if (input.mdFilingStatusMatchesFederal === null || input.mdFilingStatusMatchesFederal === undefined) return { ok:false, code:"MD_FILING_STATUS_SCREEN_REQUIRED", errors:["Maryland needs confirmation that Form 502 uses the supported federal-matching filing status."], stateSupport };
    if (input.mdFilingStatusMatchesFederal !== true) return { ok:false, code:"MD_FILING_STATUS_EXCEPTION_REVIEW_REQUIRED", errors:["A Maryland filing-status exception requires separate analysis. This estimate is held rather than guessed."], stateSupport };
    if (status === "mfs") return { ok:false, code:"MD_MFS_REVIEW_REQUIRED", errors:["Maryland married-filing-separately returns require spouse-specific allocation and are held for separate review."], stateSupport };
    if (!["single","mfj","hoh","qw"].includes(status)) return { ok:false, code:"MD_FILING_STATUS_REVIEW_REQUIRED", errors:["This Maryland filing status is outside the supported full-year Form 502 core path."], stateSupport };
    if (status === "mfj") {
      if (input.mdSpousesSameLocalJurisdiction === null || input.mdSpousesSameLocalJurisdiction === undefined) return { ok:false, code:"MD_LOCAL_RESIDENCE_SCREEN_REQUIRED", errors:["Maryland needs confirmation that both spouses resided in the same Maryland local jurisdiction for the supported joint path."], stateSupport };
      if (input.mdSpousesSameLocalJurisdiction !== true) return { ok:false, code:"MD_DIFFERENT_LOCAL_JURISDICTION_REVIEW_REQUIRED", errors:["Joint spouses residing in different Maryland local jurisdictions require separate local-tax allocation and are held rather than guessed."], stateSupport };
    }
    if (!["standard","itemized"].includes(String(input.mdDeductionMethod || "").toLowerCase())) return { ok:false, code:"MD_DEDUCTION_METHOD_REQUIRED", errors:["Select the Maryland Form 502 deduction method."], stateSupport };
    if (input.mdTaxpayerBlind === null || input.mdTaxpayerBlind === undefined) return { ok:false, code:"MD_BLINDNESS_SCREEN_REQUIRED", errors:["Maryland needs the taxpayer blindness answer for the additional exemption."], stateSupport };
    if (status === "mfj" && (input.mdSpouseBlind === null || input.mdSpouseBlind === undefined)) return { ok:false, code:"MD_SPOUSE_BLINDNESS_SCREEN_REQUIRED", errors:["Maryland needs the spouse blindness answer for the additional exemption."], stateSupport };
    const amounts=["mdAdditions","mdSubtractions","mdItemizedDeductionBeforePhaseout","mdAge65DependentCount","mdCapitalGainSubjectToAdditionalTax","mdFederalEITCAmount","mdEitcQualifyingChildCount","mdEarnedIncome","mdChildTaxCreditUnder6Count","mdChildTaxCreditDisabledAge6To16Count","mdOtherNonrefundableCredits","mdOtherRefundableCredits","mdOtherMarylandWithholding","mdOtherPayments","mdVoluntaryContributions","mdUnderpaymentInterest","mdHomebuyerWithdrawalPenalty","mdCreditToNextYear"];
    for (const field of amounts) {
      if (input[field] === null || input[field] === undefined || Number.isNaN(Number(input[field]))) return { ok:false, code:"MD_AMOUNT_REQUIRED", errors:[`Complete required Maryland amount ${field}. Enter 0 when none applies.`], stateSupport };
      if (Number(input[field]) < 0) return { ok:false, code:"MD_NEGATIVE_AMOUNT_INVALID", errors:[`Maryland amount ${field} cannot be negative.`], stateSupport };
    }
    for (const field of ["mdAge65DependentCount","mdEitcQualifyingChildCount","mdChildTaxCreditUnder6Count","mdChildTaxCreditDisabledAge6To16Count"]) {
      if (!Number.isInteger(Number(input[field]))) return { ok:false, code:"MD_COUNT_INVALID", errors:["Maryland dependent/qualifying-child counts must be whole numbers."], stateSupport };
    }
    if (Number(input.mdAge65DependentCount) > Number(input.numberOfDependents || 0)) return { ok:false, code:"MD_AGE65_DEPENDENT_COUNT_INVALID", errors:["Maryland age-65 dependent count cannot exceed total dependents."], stateSupport };
    if (Number(input.mdChildTaxCreditUnder6Count || 0) + Number(input.mdChildTaxCreditDisabledAge6To16Count || 0) > Number(input.numberOfDependents || 0)) return { ok:false, code:"MD_CHILD_CREDIT_COUNT_INVALID", errors:["Maryland resident child-tax-credit counts cannot exceed total dependents."], stateSupport };
    if (String(input.mdDeductionMethod).toLowerCase() !== "itemized" && Number(input.mdItemizedDeductionBeforePhaseout || 0) !== 0) return { ok:false, code:"MD_ITEMIZED_ZERO_REQUIRED", errors:["Enter 0 for Maryland itemized deductions when the Maryland standard deduction is selected."], stateSupport };
    const locals=["allegany","anne_arundel","baltimore_city","baltimore_county","calvert","caroline","carroll","cecil","charles","dorchester","frederick","garrett","harford","howard","kent","montgomery","prince_georges","queen_annes","st_marys","somerset","talbot","washington","wicomico","worcester"];
    if (!locals.includes(String(input.mdLocalJurisdiction || "").toLowerCase())) return { ok:false, code:"MD_LOCAL_JURISDICTION_REQUIRED", errors:["Select the Maryland county or Baltimore City used for the 2025 local income tax."], stateSupport };
    for (const field of ["mdHasMarylandOnlyEitcEligibility","mdHasOtherStateCredit","mdHasMilitaryOrSpecialFiling","mdHasAmendedOrOtherSpecialItems"]) if (input[field] === null || input[field] === undefined) return { ok:false, code:"MD_SCREEN_REQUIRED", errors:[`Complete required Maryland screen ${field}.`], stateSupport };
    if (input.mdHasMarylandOnlyEitcEligibility === true) return { ok:false, code:"MD_SPECIAL_EITC_REVIEW_REQUIRED", errors:["Maryland-only EIC eligibility, including ITIN/minimum-age exceptions, requires a pro-forma federal EIC calculation and is held for separate review rather than guessed."], stateSupport };
    if (input.mdHasOtherStateCredit === true) return { ok:false, code:"MD_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors:["Maryland Form 502CR credit for tax paid to another state requires the other jurisdiction return and limitation calculation. This estimate is held rather than guessed."], stateSupport };
    if (input.mdHasMilitaryOrSpecialFiling === true) return { ok:false, code:"MD_MILITARY_SPECIAL_REVIEW_REQUIRED", errors:["Maryland military/special-filing residency or subtraction treatment requires separate review."], stateSupport };
    if (input.mdHasAmendedOrOtherSpecialItems === true) return { ok:false, code:"MD_SPECIAL_ITEMS_REVIEW_REQUIRED", errors:["This Maryland return includes an amended or other material special situation requiring separate review."], stateSupport };
    const agi = Number(federal?.summary?.agi ?? federal?.agi ?? 0);
    if (agi <= 350000 && Number(input.mdCapitalGainSubjectToAdditionalTax || 0) !== 0) return { ok:false, code:"MD_CAPITAL_GAIN_ZERO_REQUIRED", errors:["Enter 0 for Maryland Form 502CG capital gain subject to additional tax when federal AGI does not exceed $350,000."], stateSupport };
  }

  if (input.stateCode === "MA" && Number(input.taxYear) === 2025) {
    const status = String(input.filingStatus || "").toLowerCase();
    if (input.maFullYearResident === null || input.maFullYearResident === undefined) return { ok:false, code:"MA_RESIDENCY_SCREEN_REQUIRED", errors:["Massachusetts needs confirmation that this is a full-year resident 2025 Form 1 return."], stateSupport };
    if (input.maFullYearResident !== true) return { ok:false, code:"MA_NR_PY_REVIEW_REQUIRED", errors:["Massachusetts part-year and nonresident returns require Form 1-NR/PY allocation. This estimate is held rather than guessed."], stateSupport };
    if (input.maHasFilingStatusException === null || input.maHasFilingStatusException === undefined) return { ok:false, code:"MA_FILING_STATUS_SCREEN_REQUIRED", errors:["Massachusetts needs confirmation that no state filing-status exception applies."], stateSupport };
    if (input.maHasFilingStatusException === true) return { ok:false, code:"MA_FILING_STATUS_EXCEPTION_REVIEW_REQUIRED", errors:["A Massachusetts filing-status exception requires separate analysis. This estimate is held rather than guessed."], stateSupport };
    if (!["single","mfj","mfs","hoh","qw"].includes(status)) return { ok:false, code:"MA_FILING_STATUS_REVIEW_REQUIRED", errors:["This filing status is outside the supported Massachusetts Form 1 core path."], stateSupport };
    if (input.maElectsOptional585Rate === null || input.maElectsOptional585Rate === undefined) return { ok:false, code:"MA_OPTIONAL_RATE_SCREEN_REQUIRED", errors:["Massachusetts needs the optional 5.85% tax-rate election answer."], stateSupport };
    if (input.maElectsOptional585Rate === true) return { ok:false, code:"MA_OPTIONAL_585_REVIEW_REQUIRED", errors:["The Massachusetts optional 5.85% rate election requires a separate calculation and is held rather than silently assuming the standard 5% rate."], stateSupport };
    if (input.maTaxpayerBlind === null || input.maTaxpayerBlind === undefined) return { ok:false, code:"MA_BLINDNESS_SCREEN_REQUIRED", errors:["Massachusetts needs the taxpayer blindness answer for the Form 1 exemption."], stateSupport };
    if (status === "mfj" && (input.maSpouseBlind === null || input.maSpouseBlind === undefined)) return { ok:false, code:"MA_SPOUSE_BLINDNESS_SCREEN_REQUIRED", errors:["Massachusetts needs the spouse blindness answer for the joint Form 1 exemption."], stateSupport };
    const amounts=["maTotalFivePercentIncome","maTotalDeductions","maMedicalDentalExemption","maAdoptionExemption","maScheduleBLine20","maScheduleB85Income","maScheduleB12Income","maScheduleBLine37SurtaxIncome","maScheduleDLine21SurtaxIncome","maLongTermCapitalGainsTax","maCreditRecapture","maInstallmentSaleAdditionalTax","maMassachusettsAGI","maOtherNonrefundableCredits","maVoluntaryContributions","maUseTax","maHealthCarePenalty","maFederalEITCAmount","maSeniorCircuitBreakerCredit","maChildFamilyQualifyingCount","maOtherRefundableCredits","maOtherMassachusettsWithholding","maPriorYearOverpaymentApplied","maEstimatedPayments","maExtensionPayments","maExcessPfmlWithholding","maRealEstateWithholding","maPenaltyInterest","maCreditToNextYear"];
    for (const field of amounts) {
      if (input[field] === null || input[field] === undefined || Number.isNaN(Number(input[field]))) return { ok:false, code:"MA_AMOUNT_REQUIRED", errors:[`Complete required Massachusetts amount ${field}. Enter 0 when none applies.`], stateSupport };
      if (Number(input[field]) < 0) return { ok:false, code:"MA_NEGATIVE_AMOUNT_INVALID", errors:[`Massachusetts amount ${field} cannot be negative.`], stateSupport };
    }
    if (!Number.isInteger(Number(input.maChildFamilyQualifyingCount))) return { ok:false, code:"MA_CHILD_FAMILY_COUNT_INVALID", errors:["Massachusetts Child and Family Tax Credit qualifying-individual count must be a whole number."], stateSupport };
    for (const field of ["maClaimedFederalEITC","maHasOtherJurisdictionCredit","maHasAmendedOrOtherSpecialItems"]) if (input[field] === null || input[field] === undefined) return { ok:false, code:"MA_SCREEN_REQUIRED", errors:[`Complete required Massachusetts screen ${field}.`], stateSupport };
    if (input.maClaimedFederalEITC === true && Number(input.maFederalEITCAmount) <= 0) return { ok:false, code:"MA_EITC_AMOUNT_REQUIRED", errors:["Enter the federal EITC amount used for the Massachusetts 40% EITC."], stateSupport };
    if (input.maClaimedFederalEITC !== true && Number(input.maFederalEITCAmount) !== 0) return { ok:false, code:"MA_EITC_ZERO_REQUIRED", errors:["Enter 0 for federal EITC when no federal EITC was claimed."], stateSupport };
    if (status === "mfs" && input.maClaimedFederalEITC === true) return { ok:false, code:"MA_MFS_EITC_REVIEW_REQUIRED", errors:["Massachusetts MFS EITC eligibility has qualifying-child/domestic-abuse conditions and requires separate review."], stateSupport };
    if (status === "mfs" && Number(input.maChildFamilyQualifyingCount) > 0) return { ok:false, code:"MA_MFS_CHILD_FAMILY_REVIEW_REQUIRED", errors:["Massachusetts MFS Child and Family Tax Credit treatment requires separate review."], stateSupport };
    if (Number(input.maSeniorCircuitBreakerCredit) > 2820) return { ok:false, code:"MA_CIRCUIT_BREAKER_MAX_INVALID", errors:["The 2025 Massachusetts Senior Circuit Breaker Credit cannot exceed $2,820."], stateSupport };
    if (Number(input.maSeniorCircuitBreakerCredit) > 0 && Number(input.age || 0) < 65 && Number(input.spouseAge || 0) < 65) return { ok:false, code:"MA_CIRCUIT_BREAKER_AGE_REVIEW_REQUIRED", errors:["A Massachusetts Senior Circuit Breaker Credit was entered but neither taxpayer age field shows age 65 or older. Separate review is required."], stateSupport };
    if (input.maHasOtherJurisdictionCredit === true) return { ok:false, code:"MA_OTHER_JURISDICTION_CREDIT_REVIEW_REQUIRED", errors:["Massachusetts credit for income taxes paid to another jurisdiction requires Schedule F and the other jurisdiction return. This estimate is held rather than guessed."], stateSupport };
    if (input.maHasAmendedOrOtherSpecialItems === true) return { ok:false, code:"MA_SPECIAL_ITEMS_REVIEW_REQUIRED", errors:["This Massachusetts return includes an amended or other material special situation requiring separate review."], stateSupport };
  }

  if (input.stateCode === "NJ" && Number(input.taxYear) === 2025) {
    const status = String(input.filingStatus || "").toLowerCase();
    if (input.njFullYearResident === null || input.njFullYearResident === undefined) return { ok:false, code:"NJ_RESIDENCY_SCREEN_REQUIRED", errors:["New Jersey needs confirmation that this is a full-year resident 2025 NJ-1040 return."], stateSupport };
    if (input.njFullYearResident !== true) return { ok:false, code:"NJ_NR_PY_REVIEW_REQUIRED", errors:["New Jersey part-year/nonresident cases may require both NJ-1040 and NJ-1040NR with allocation/proration. This estimate is held rather than guessed."], stateSupport };
    if (input.njHasFilingStatusException === null || input.njHasFilingStatusException === undefined) return { ok:false, code:"NJ_FILING_STATUS_SCREEN_REQUIRED", errors:["New Jersey needs confirmation that no state filing-status exception applies."], stateSupport };
    if (input.njHasFilingStatusException === true) return { ok:false, code:"NJ_FILING_STATUS_EXCEPTION_REVIEW_REQUIRED", errors:["A New Jersey filing-status exception, including certain civil-union or nonresident-spouse situations, requires separate review."], stateSupport };
    if (status === "mfs") return { ok:false, code:"NJ_MFS_REVIEW_REQUIRED", errors:["New Jersey married-filing-separately rules require separate review for this supported planning path."], stateSupport };
    if (!["single","mfj","hoh","qw"].includes(status)) return { ok:false, code:"NJ_FILING_STATUS_REVIEW_REQUIRED", errors:["This filing status is outside the supported New Jersey NJ-1040 core path."], stateSupport };
    const boolFields=["njClaimsDomesticPartnerExemption","njTaxpayerBlindOrDisabled","njTaxpayerVeteran","njPropertyTaxBenefitEligible","njClaimedFederalEITC","njHasNJOnlyEITC","njHasOtherJurisdictionCredit","njHasAmendedOrOtherSpecialItems"];
    if(status==="mfj") boolFields.push("njSpouseBlindOrDisabled","njSpouseVeteran");
    for(const field of boolFields) if(input[field]===null||input[field]===undefined) return {ok:false,code:"NJ_SCREEN_REQUIRED",errors:[`Complete required New Jersey screen ${field}.`],stateSupport};
    const amounts=["njGrossIncome","njCollegeDependentCount","njMedicalExpenseDeduction","njAlimonyDeduction","njQualifiedConservationDeduction","njHealthEnterpriseZoneDeduction","njAlternativeBusinessAdjustment","njOrganBoneMarrowDeduction","njNjbestDeduction","njNjclassDeduction","njTuitionDeduction","njPropertyTaxesLine40a","njOtherNonrefundableCredits","njUseTax","njUnderpaymentInterest","njSharedResponsibilityPayment","njOtherNJWithholding","njPaymentsCreditFromPriorYear","njFederalEITCAmount","njExcessUiWfSwfCredit","njExcessDiCredit","njExcessFliCredit","njWoundedWarriorCredit","njPteBaitCredit","njFederalChildDependentCareCredit","njChildTaxCreditUnder6Count","njCreditToNextYear","njCharitableContributions"];
    for(const field of amounts){if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field])))return {ok:false,code:"NJ_AMOUNT_REQUIRED",errors:[`Complete required New Jersey amount ${field}. Enter 0 when none applies.`],stateSupport};if(Number(input[field])<0)return {ok:false,code:"NJ_NEGATIVE_AMOUNT_INVALID",errors:[`New Jersey amount ${field} cannot be negative.`],stateSupport};}
    if(!Number.isInteger(Number(input.njCollegeDependentCount))) return {ok:false,code:"NJ_COLLEGE_DEPENDENT_COUNT_INVALID",errors:["New Jersey college dependent count must be a whole number."],stateSupport};
    if(!Number.isInteger(Number(input.njChildTaxCreditUnder6Count))) return {ok:false,code:"NJ_CHILD_COUNT_INVALID",errors:["New Jersey Child Tax Credit child count must be a whole number."],stateSupport};
    if(Number(input.njCollegeDependentCount)>Number(input.numberOfDependents||0)) return {ok:false,code:"NJ_COLLEGE_DEPENDENT_COUNT_EXCEEDS_DEPENDENTS",errors:["New Jersey college-dependent count cannot exceed total dependents."],stateSupport};
    if(Number(input.njChildTaxCreditUnder6Count)>Number(input.numberOfDependents||0)) return {ok:false,code:"NJ_CHILD_COUNT_EXCEEDS_DEPENDENTS",errors:["New Jersey children age 5 or younger cannot exceed total dependents."],stateSupport};
    if(Number(input.njOrganBoneMarrowDeduction)>10000) return {ok:false,code:"NJ_ORGAN_DEDUCTION_MAX_INVALID",errors:["The supported 2025 New Jersey organ/bone-marrow deduction cannot exceed $10,000."],stateSupport};
    if(Number(input.njNjbestDeduction)>10000) return {ok:false,code:"NJ_NJBEST_MAX_INVALID",errors:["The supported 2025 NJBEST deduction cannot exceed $10,000."],stateSupport};
    if(Number(input.njNjclassDeduction)>2500) return {ok:false,code:"NJ_NJCLASS_MAX_INVALID",errors:["The supported 2025 NJCLASS deduction cannot exceed $2,500."],stateSupport};
    if(Number(input.njTuitionDeduction)>10000) return {ok:false,code:"NJ_TUITION_MAX_INVALID",errors:["The supported 2025 New Jersey tuition deduction cannot exceed $10,000."],stateSupport};
    if(Number(input.njGrossIncome)>200000&&(Number(input.njNjbestDeduction)>0||Number(input.njNjclassDeduction)>0||Number(input.njTuitionDeduction)>0)) return {ok:false,code:"NJ_EDUCATION_DEDUCTION_INCOME_INVALID",errors:["The supported NJBEST, NJCLASS, and tuition deductions require New Jersey gross income of $200,000 or less."],stateSupport};
    const njFilingThreshold=(status==="single"||status==="mfs")?10000:20000;
    if(input.njPropertyTaxBenefitEligible===true&&Number(input.njGrossIncome)<=njFilingThreshold) return {ok:false,code:"NJ_PROPERTY_TAX_LOW_INCOME_REVIEW_REQUIRED",errors:["New Jersey property-tax credit for income at or below the filing threshold uses the special low-income senior/blind/disabled path, including NJ-1040-HW when applicable. Separate review is required."],stateSupport};
    if(input.njPropertyTaxBenefitEligible!==true&&Number(input.njPropertyTaxesLine40a)!==0) return {ok:false,code:"NJ_PROPERTY_TAX_ZERO_REQUIRED",errors:["Enter 0 for NJ-1040 Line 40a when the property-tax deduction/credit eligibility screen is No."],stateSupport};
    if(Number(input.njGrossIncome)<=njFilingThreshold&&Number(input.njSharedResponsibilityPayment)!==0) return {ok:false,code:"NJ_SHARED_RESPONSIBILITY_ZERO_REQUIRED",errors:["New Jersey shared responsibility payment must be 0 when New Jersey gross income is at or below the filing threshold."],stateSupport};
    if(input.njClaimedFederalEITC===true&&Number(input.njFederalEITCAmount)<=0) return {ok:false,code:"NJ_EITC_AMOUNT_REQUIRED",errors:["Enter the federal EITC amount used for the standard 40% New Jersey EITC."],stateSupport};
    if(input.njClaimedFederalEITC!==true&&Number(input.njFederalEITCAmount)!==0) return {ok:false,code:"NJ_EITC_ZERO_REQUIRED",errors:["Enter 0 for the federal EITC amount when no federal EITC was claimed."],stateSupport};
    if(input.njHasNJOnlyEITC===true) return {ok:false,code:"NJ_ONLY_EITC_REVIEW_REQUIRED",errors:["New Jersey-only EITC eligibility (including the state age exception) requires a separate pro-forma federal EITC analysis and is held rather than guessed."],stateSupport};
    if(input.njHasOtherJurisdictionCredit===true) return {ok:false,code:"NJ_OTHER_JURISDICTION_CREDIT_REVIEW_REQUIRED",errors:["New Jersey credit for taxes paid to another jurisdiction requires Schedule NJ-COJ/Worksheet I and the other jurisdiction return. This estimate is held rather than guessed."],stateSupport};
    if(input.njHasAmendedOrOtherSpecialItems===true) return {ok:false,code:"NJ_SPECIAL_ITEMS_REVIEW_REQUIRED",errors:["This New Jersey return includes an amended or other material special situation requiring separate review."],stateSupport};
  }

  if (input.stateCode === "NY" && Number(input.taxYear) === 2025) {
    const status = String(input.filingStatus || "").toLowerCase();
    if (input.nyFullYearResident === null || input.nyFullYearResident === undefined) return { ok:false, code:"NY_RESIDENCY_SCREEN_REQUIRED", errors:["New York needs confirmation that this is a full-year resident 2025 IT-201 return."], stateSupport };
    if (input.nyFullYearResident !== true) return { ok:false, code:"NY_NR_PY_REVIEW_REQUIRED", errors:["New York part-year/nonresident returns require IT-203 allocation and are held rather than guessed."], stateSupport };
    if (input.nyHasFilingStatusException === null || input.nyHasFilingStatusException === undefined) return { ok:false, code:"NY_FILING_STATUS_SCREEN_REQUIRED", errors:["New York needs confirmation that no state filing-status exception applies."], stateSupport };
    if (input.nyHasFilingStatusException === true) return { ok:false, code:"NY_FILING_STATUS_EXCEPTION_REVIEW_REQUIRED", errors:["A New York filing-status exception requires separate review."], stateSupport };
    if (status === "mfs") return { ok:false, code:"NY_MFS_REVIEW_REQUIRED", errors:["New York married-filing-separately rules require separate review for this supported planning path."], stateSupport };
    if (!["single","mfj","hoh","qw"].includes(status)) return { ok:false, code:"NY_FILING_STATUS_REVIEW_REQUIRED", errors:["This filing status is outside the supported New York IT-201 core path."], stateSupport };
    for(const field of ["nyHasPartYearLocalResidency","nyJointLocalResidencyMismatch","nyHasYonkersNonresidentEarnings","nyClaimedFederalEITC","nyHasNoncustodialEITC","nyHasOtherStateCredit","nyHasAmendedOrOtherSpecialItems"]) if(input[field]===null||input[field]===undefined) return {ok:false,code:"NY_SCREEN_REQUIRED",errors:[`Complete required New York screen ${field}.`],stateSupport};
    if(!["standard","itemized"].includes(String(input.nyDeductionMethod||""))) return {ok:false,code:"NY_DEDUCTION_METHOD_REQUIRED",errors:["Select the New York deduction method."],stateSupport};
    if(!["none","nyc","yonkers"].includes(String(input.nyLocality||""))) return {ok:false,code:"NY_LOCALITY_REQUIRED",errors:["Select the full-year New York local-resident status."],stateSupport};
    const amounts=["nyAdditions","nySubtractions","nyItemizedDeduction","nyHighIncomeLine39Tax","nyOtherNonrefundableCredits","nyOtherStateTaxes","nySalesUseTax","nyMctmt","nyNycTaxableIncome","nyNycOtherTaxes","nyNycNonrefundableCredits","nyYonkersResidentSurcharge","nyEmpireChildUnder4Count","nyEmpireChild4To16Count","nyStateChildDependentCareCredit","nyFederalEITCAmount","nyRealPropertyTaxCredit","nyCollegeTuitionCredit","nyNycChildDependentCareCredit","nyNycSchoolTaxCreditFixed","nyNycSchoolTaxCreditRateReduction","nyNycEITC","nyOtherRefundableCredits","nyOtherNYWithholding","nyEstimatedPayments","nyExtensionPayment","nyVoluntaryContributions","nyPenaltyInterest","nyCreditToNextYear"];
    for(const field of amounts){if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field])))return {ok:false,code:"NY_AMOUNT_REQUIRED",errors:[`Complete required New York amount ${field}. Enter 0 when none applies.`],stateSupport};if(Number(input[field])<0)return {ok:false,code:"NY_NEGATIVE_AMOUNT_INVALID",errors:[`New York amount ${field} cannot be negative.`],stateSupport};}
    if(input.nyDeductionMethod!=="itemized"&&Number(input.nyItemizedDeduction)!==0) return {ok:false,code:"NY_ITEMIZED_ZERO_REQUIRED",errors:["Enter 0 for New York itemized deduction when the standard deduction is selected."],stateSupport};
    if(input.nyDeductionMethod==="itemized"&&Number(input.nyItemizedDeduction)<=0) return {ok:false,code:"NY_ITEMIZED_AMOUNT_REQUIRED",errors:["Enter the exact completed 2025 Form IT-196 itemized deduction amount."],stateSupport};
    if(input.nyHasPartYearLocalResidency===true) return {ok:false,code:"NY_PART_YEAR_LOCAL_REVIEW_REQUIRED",errors:["Part-year NYC/Yonkers residency requires Form IT-360.1 and separate review."],stateSupport};
    if(input.nyJointLocalResidencyMismatch===true) return {ok:false,code:"NY_JOINT_LOCAL_MISMATCH_REVIEW_REQUIRED",errors:["Different spouse NYC/Yonkers residency on a joint return requires separate calculations and is held rather than guessed."],stateSupport};
    if(input.nyHasYonkersNonresidentEarnings===true) return {ok:false,code:"NY_YONKERS_NONRESIDENT_EARNINGS_REVIEW_REQUIRED",errors:["Yonkers nonresident earnings require Form Y-203 and separate review."],stateSupport};
    const federalAGI=Number(federal?.summary?.agi||0); const nyAGI=Math.max(0,federalAGI+Number(input.nyAdditions)-Number(input.nySubtractions));
    if(nyAGI>107650&&Number(input.nyHighIncomeLine39Tax)<=0) return {ok:false,code:"NY_HIGH_INCOME_LINE39_REQUIRED",errors:["New York adjusted gross income exceeds $107,650. Enter the exact IT-201 Line 39 amount from the official 2025 tax-computation worksheet; the estimator will not approximate the recapture worksheet."],stateSupport};
    if(nyAGI<=107650&&Number(input.nyHighIncomeLine39Tax)!==0) return {ok:false,code:"NY_HIGH_INCOME_LINE39_ZERO_REQUIRED",errors:["Enter 0 for the high-NYAGI Line 39 worksheet tax when New York adjusted gross income does not exceed $107,650."],stateSupport};
    if(input.nyLocality!=="nyc"&&["nyNycTaxableIncome","nyNycOtherTaxes","nyNycNonrefundableCredits","nyNycChildDependentCareCredit","nyNycSchoolTaxCreditFixed","nyNycSchoolTaxCreditRateReduction","nyNycEITC"].some((f)=>Number(input[f])!==0)) return {ok:false,code:"NY_NYC_ZERO_REQUIRED",errors:["NYC-only amounts must be 0 unless full-year NYC resident is selected."],stateSupport};
    if(input.nyLocality!=="yonkers"&&Number(input.nyYonkersResidentSurcharge)!==0) return {ok:false,code:"NY_YONKERS_ZERO_REQUIRED",errors:["Yonkers resident surcharge must be 0 unless full-year Yonkers resident is selected."],stateSupport};
    if(!Number.isInteger(Number(input.nyEmpireChildUnder4Count))||!Number.isInteger(Number(input.nyEmpireChild4To16Count))) return {ok:false,code:"NY_CHILD_COUNT_INVALID",errors:["Empire State child-credit counts must be whole numbers."],stateSupport};
    if(Number(input.nyEmpireChildUnder4Count)+Number(input.nyEmpireChild4To16Count)>Number(input.numberOfDependents||0)) return {ok:false,code:"NY_CHILD_COUNT_EXCEEDS_DEPENDENTS",errors:["Empire State qualifying-child counts cannot exceed total dependents."],stateSupport};
    if(input.nyClaimedFederalEITC===true&&Number(input.nyFederalEITCAmount)<=0) return {ok:false,code:"NY_EITC_AMOUNT_REQUIRED",errors:["Enter the federal EITC amount used for the New York State EIC."],stateSupport};
    if(input.nyClaimedFederalEITC!==true&&Number(input.nyFederalEITCAmount)!==0) return {ok:false,code:"NY_EITC_ZERO_REQUIRED",errors:["Enter 0 for federal EITC amount when no federal EITC is claimed."],stateSupport};
    if(input.nyHasNoncustodialEITC===true) return {ok:false,code:"NY_NONCUSTODIAL_EITC_REVIEW_REQUIRED",errors:["New York noncustodial-parent EIC requires Form IT-209 and separate review."],stateSupport};
    if(input.nyHasOtherStateCredit===true) return {ok:false,code:"NY_OTHER_STATE_CREDIT_REVIEW_REQUIRED",errors:["New York resident credit for taxes paid to another state, local government, DC, or Canadian province requires Form IT-112-R/IT-112-C and separate review."],stateSupport};
    if(input.nyHasAmendedOrOtherSpecialItems===true) return {ok:false,code:"NY_SPECIAL_ITEMS_REVIEW_REQUIRED",errors:["This New York return includes an amended or other material special situation requiring separate review."],stateSupport};
  }

  if (input.stateCode === "RI" && Number(input.taxYear) === 2025) {
    const status = String(input.filingStatus || "").toLowerCase();
    if (input.riFullYearResident === null || input.riFullYearResident === undefined) return { ok:false, code:"RI_RESIDENCY_SCREEN_REQUIRED", errors:["Rhode Island needs confirmation that this is a full-year resident 2025 RI-1040 return."], stateSupport };
    if (input.riFullYearResident !== true) return { ok:false, code:"RI_NR_PY_REVIEW_REQUIRED", errors:["Rhode Island part-year and nonresident returns require RI-1040NR allocation and are held rather than guessed."], stateSupport };
    if (input.riHasFilingStatusException === null || input.riHasFilingStatusException === undefined) return { ok:false, code:"RI_FILING_STATUS_SCREEN_REQUIRED", errors:["Rhode Island needs confirmation that no state filing-status exception applies."], stateSupport };
    if (input.riHasFilingStatusException === true) return { ok:false, code:"RI_FILING_STATUS_EXCEPTION_REVIEW_REQUIRED", errors:["A Rhode Island filing-status exception requires separate review."], stateSupport };
    if (status === "mfs") return { ok:false, code:"RI_MFS_REVIEW_REQUIRED", errors:["Rhode Island married-filing-separately returns are held for separate review in this supported core path."], stateSupport };
    if (!["single","mfj","hoh","qw"].includes(status)) return { ok:false, code:"RI_FILING_STATUS_REVIEW_REQUIRED", errors:["This filing status is outside the supported Rhode Island RI-1040 core path."], stateSupport };
    for (const field of ["riClaimedFederalEITC","riHasAmendedOrOtherSpecialItems"]) if (input[field] === null || input[field] === undefined) return { ok:false, code:"RI_SCREEN_REQUIRED", errors:[`Complete required Rhode Island screen ${field}.`], stateSupport };
    const signedAmounts=["riNetModifications"];
    for(const field of signedAmounts){if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field])))return {ok:false,code:"RI_AMOUNT_REQUIRED",errors:[`Complete required Rhode Island amount ${field}. Enter 0 when none applies.`],stateSupport};}
    const amounts=["riFederalChildDependentCareCredit","riOtherStateCredit","riOtherRhodeIslandCredits","riCreditRecapture","riCheckoffContributions","riUseSalesTax","riIndividualMandatePenalty","riFederalEITCAmount","riPropertyTaxReliefCredit","riLeadPaintCredit","riOtherRhodeIslandWithholding","riEstimatedPayments","riOtherPayments","riUnderpaymentInterest","riCreditToNextYear"];
    for(const field of amounts){if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field])))return {ok:false,code:"RI_AMOUNT_REQUIRED",errors:[`Complete required Rhode Island amount ${field}. Enter 0 when none applies.`],stateSupport};if(Number(input[field])<0)return {ok:false,code:"RI_NEGATIVE_AMOUNT_INVALID",errors:[`Rhode Island amount ${field} cannot be negative.`],stateSupport};}
    if (input.riClaimedFederalEITC === true && Number(input.riFederalEITCAmount) <= 0) return { ok:false, code:"RI_EITC_AMOUNT_REQUIRED", errors:["Enter the federal EITC amount used for the Rhode Island 16% earned income credit."], stateSupport };
    if (input.riClaimedFederalEITC !== true && Number(input.riFederalEITCAmount) !== 0) return { ok:false, code:"RI_EITC_ZERO_REQUIRED", errors:["Enter 0 for federal EITC when no federal EITC was claimed."], stateSupport };
    if (input.riHasAmendedOrOtherSpecialItems === true) return { ok:false, code:"RI_SPECIAL_ITEMS_REVIEW_REQUIRED", errors:["This Rhode Island return includes an amended or other material special situation requiring separate review."], stateSupport };
  }

  if (input.stateCode === "VT" && Number(input.taxYear) === 2025) {
    const status = String(input.filingStatus || "").toLowerCase();
    if (input.vtFullYearResident === null || input.vtFullYearResident === undefined) return { ok:false, code:"VT_RESIDENCY_SCREEN_REQUIRED", errors:["Vermont needs confirmation that this is a full-year resident 2025 IN-111 return."], stateSupport };
    if (input.vtFullYearResident !== true) return { ok:false, code:"VT_NR_PY_REVIEW_REQUIRED", errors:["Vermont part-year/nonresident returns require Schedule IN-113 allocation and are held rather than guessed."], stateSupport };
    if (input.vtHasFilingStatusException === null || input.vtHasFilingStatusException === undefined) return { ok:false, code:"VT_FILING_STATUS_SCREEN_REQUIRED", errors:["Vermont needs confirmation that no recomputed federal/civil-union/special filing-status exception applies."], stateSupport };
    if (input.vtHasFilingStatusException === true) return { ok:false, code:"VT_FILING_STATUS_EXCEPTION_REVIEW_REQUIRED", errors:["Vermont recomputed federal, cannabis recomputation, civil-union, or other filing-status exceptions require separate review."], stateSupport };
    if (!["single","mfj","mfs","hoh","qw"].includes(status)) return { ok:false, code:"VT_FILING_STATUS_REVIEW_REQUIRED", errors:["This filing status is outside the supported Vermont IN-111 core path."], stateSupport };
    for (const field of ["vtHasIncomeAdjustment","vtClaimedFederalEITC","vtIsQualifyingVeteran","vtUsesRenterCreditForIncomeTax","vtHasAmendedOrOtherSpecialItems"]) if (input[field] === null || input[field] === undefined) return { ok:false, code:"VT_SCREEN_REQUIRED", errors:[`Complete required Vermont screen ${field}.`], stateSupport };
    if (status === "mfj" && (input.vtSpouseCanBeClaimedAsDependent === null || input.vtSpouseCanBeClaimedAsDependent === undefined)) return { ok:false, code:"VT_SPOUSE_DEPENDENCY_SCREEN_REQUIRED", errors:["Confirm whether the MFJ spouse can be claimed as another person's dependent for Vermont's personal exemption."], stateSupport };
    for (const field of ["vtNetModifications","vtNetTaxAdjustment"]) if (input[field] === null || input[field] === undefined || Number.isNaN(Number(input[field]))) return { ok:false, code:"VT_AMOUNT_REQUIRED", errors:[`Complete required signed Vermont amount ${field}. Enter 0 when none applies.`], stateSupport };
    const nonnegative=["vtStandardDeductionBoxCount","vtUsObligationInterestForMinimumTax","vtCharitableContributions","vtOtherStateCredit","vtOtherNonrefundableCredits","vtChildCareContribution","vtUseTax","vtVoluntaryContributions","vtFederalChildDependentCareCredit","vtChildTaxCreditQualifyingChildCount","vtFederalEITCAmount","vtEitcQualifyingChildCount","vtOtherVermontWithholding","vtEstimatedPayments","vtRealEstateWithholding","vtK1EntityPayments","vtUnderpaymentInterestPenalty","vtCreditToNextYear","vtCreditToPropertyTaxBill"];
    for(const field of nonnegative){if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field])))return {ok:false,code:"VT_AMOUNT_REQUIRED",errors:[`Complete required Vermont amount ${field}. Enter 0 when none applies.`],stateSupport};if(Number(input[field])<0)return {ok:false,code:"VT_NEGATIVE_AMOUNT_INVALID",errors:[`Vermont amount ${field} cannot be negative.`],stateSupport};}
    const boxes=Number(input.vtStandardDeductionBoxCount); const maxBoxes=["mfj","mfs"].includes(status)?4:2;
    if (!Number.isInteger(boxes) || boxes < 0 || boxes > maxBoxes) return { ok:false, code:"VT_STANDARD_DEDUCTION_BOX_COUNT_INVALID", errors:[`Vermont needs the exact federal Form 1040 standard-deduction box count from 0 through ${maxBoxes} for this filing status.`], stateSupport };
    const childCount=Number(input.vtChildTaxCreditQualifyingChildCount); if(!Number.isInteger(childCount)||childCount<0||childCount>Number(input.numberOfDependents||0)) return {ok:false,code:"VT_CHILD_TAX_CREDIT_COUNT_INVALID",errors:["Vermont Child Tax Credit qualifying-child count must be a whole number from 0 through the dependents claimed on the federal return."],stateSupport};
    const eitcChildren=Number(input.vtEitcQualifyingChildCount); if(!Number.isInteger(eitcChildren)||eitcChildren<0||eitcChildren>3)return {ok:false,code:"VT_EITC_CHILD_COUNT_INVALID",errors:["Vermont needs the federal Schedule EIC qualifying-child count from 0 through 3."],stateSupport};
    if (input.vtClaimedFederalEITC === true && Number(input.vtFederalEITCAmount) <= 0) return { ok:false, code:"VT_EITC_AMOUNT_REQUIRED", errors:["Enter the federal EITC amount used for the Vermont EITC."], stateSupport };
    if (input.vtClaimedFederalEITC !== true && (Number(input.vtFederalEITCAmount) !== 0 || eitcChildren !== 0)) return { ok:false, code:"VT_EITC_ZERO_REQUIRED", errors:["Enter 0 for federal EITC and qualifying children when no federal EITC was claimed."], stateSupport };
    if (input.vtHasIncomeAdjustment === true) return { ok:false, code:"VT_IN113_REVIEW_REQUIRED", errors:["Vermont IN-111 Line 15 below 100% requires Schedule IN-113 (including exempt military pay) and separate review."], stateSupport };
    if (input.vtUsesRenterCreditForIncomeTax === true) return { ok:false, code:"VT_RENTER_CREDIT_REVIEW_REQUIRED", errors:["A Vermont RCC-146 Renter Credit used to pay income-tax liability requires the separate renter-credit calculation and is held for review."], stateSupport };
    if (input.vtHasAmendedOrOtherSpecialItems === true) return { ok:false, code:"VT_SPECIAL_ITEMS_REVIEW_REQUIRED", errors:["This Vermont return includes an amended or other material special situation requiring separate review."], stateSupport };
  }

  if (input.stateCode === "DC" && Number(input.taxYear) === 2025) {
    const status = String(input.filingStatus || "").toLowerCase();
    if (input.dcFullYearResident === null || input.dcFullYearResident === undefined) return { ok:false, code:"DC_RESIDENCY_SCREEN_REQUIRED", errors:["District of Columbia needs confirmation that this is a full-year resident 2025 D-40 return."], stateSupport };
    if (input.dcFullYearResident !== true) return { ok:false, code:"DC_NR_PY_REVIEW_REQUIRED", errors:["District of Columbia part-year/nonresident returns require separate allocation/refund review and are held rather than guessed."], stateSupport };
    if (input.dcHasFilingStatusException === null || input.dcHasFilingStatusException === undefined) return { ok:false, code:"DC_FILING_STATUS_SCREEN_REQUIRED", errors:["Confirm that no District filing-status exception or combined-separate computation applies."], stateSupport };
    if (input.dcHasFilingStatusException === true) return { ok:false, code:"DC_FILING_STATUS_EXCEPTION_REVIEW_REQUIRED", errors:["District filing-status exceptions and married/registered domestic partners filing separately on the same return require Calculation J and separate review."], stateSupport };
    if (status === "mfs") return { ok:false, code:"DC_MFS_REVIEW_REQUIRED", errors:["District married-filing-separately calculations require separate spouse allocations and are held rather than guessed in this supported core path."], stateSupport };
    if (!['single','mfj','hoh','qw'].includes(status)) return { ok:false, code:"DC_FILING_STATUS_REVIEW_REQUIRED", errors:["This filing status is outside the supported District D-40 core path."], stateSupport };
    for (const field of ["dcTaxpayerBlind","dcFullYearHealthCoverageOrExempt","dcClaimsEITC","dcClaimsScheduleH","dcHasOtherJurisdictionCredit","dcHasD30UnincorporatedBusiness","dcHasNoncustodialEITC","dcHasAmendedOrOtherSpecialItems"]) if (input[field] === null || input[field] === undefined) return { ok:false, code:"DC_SCREEN_REQUIRED", errors:[`Complete required District screen ${field}.`], stateSupport };
    if (status === "mfj" && (input.dcSpouseBlind === null || input.dcSpouseBlind === undefined)) return { ok:false, code:"DC_SPOUSE_BLIND_SCREEN_REQUIRED", errors:["Confirm whether the MFJ spouse is blind for the District additional standard deduction."], stateSupport };
    if (!["standard","itemized"].includes(String(input.dcDeductionMethod || ""))) return { ok:false, code:"DC_DEDUCTION_METHOD_REQUIRED", errors:["Select the District deduction method. It must match the federal standard-versus-itemized choice."], stateSupport };
    const amounts=["dcFranchiseTaxAddback","dcOtherAdditions","dcStateLocalRefundSubtraction","dcTaxableSocialSecuritySubtraction","dcFranchiseFiduciaryIncomeSubtraction","dcSurvivorBenefitsSubtraction","dcUnemploymentSubtraction","dcOtherSubtractions","dcFederalItemizedDeductions","dcFederalStateLocalTaxDeduction","dcFederalRealEstateTax","dcFederalOtherTaxes","dcProtectedItemizedDeductions","dcFederalChildDependentCareCredit","dcOtherNonrefundableCredits","dcHealthCareSharedResponsibilityPayment","dcEitcQualifyingChildCount","dcCalculatedFederalEITCAmount","dcChildlessEarnedIncome","dcScheduleHCredit","dcOtherRefundableCredits","dcOtherWithholding","dcEstimatedPayments","dcExtensionPayment","dcUnderpaymentInterest","dcCreditToNextYear","dcVoluntaryContributions"];
    for(const field of amounts){if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field])))return {ok:false,code:"DC_AMOUNT_REQUIRED",errors:[`Complete required District amount ${field}. Enter 0 when none applies.`],stateSupport};if(Number(input[field])<0)return {ok:false,code:"DC_NEGATIVE_AMOUNT_INVALID",errors:[`District amount ${field} cannot be negative.`],stateSupport};}
    const itemizedFields=["dcFederalItemizedDeductions","dcFederalStateLocalTaxDeduction","dcFederalRealEstateTax","dcFederalOtherTaxes","dcProtectedItemizedDeductions"];
    if(input.dcDeductionMethod!=="itemized"&&itemizedFields.some((f)=>Number(input[f])!==0)) return {ok:false,code:"DC_ITEMIZED_ZERO_REQUIRED",errors:["Enter 0 for District Calculation F itemized fields when the standard deduction is selected."],stateSupport};
    if(input.dcDeductionMethod==="itemized"&&Number(input.dcFederalItemizedDeductions)<=0) return {ok:false,code:"DC_ITEMIZED_AMOUNT_REQUIRED",errors:["Enter the exact federal Schedule A amounts needed for District Calculation F."],stateSupport};
    if(Number(input.dcFederalStateLocalTaxDeduction)>Number(input.dcFederalItemizedDeductions)) return {ok:false,code:"DC_ITEMIZED_SALT_INVALID",errors:["Federal state/local tax deduction cannot exceed total federal itemized deductions for District Calculation F."],stateSupport};
    const calcFBase=Math.max(0,Number(input.dcFederalItemizedDeductions)-Number(input.dcFederalStateLocalTaxDeduction))+Number(input.dcFederalRealEstateTax)+Number(input.dcFederalOtherTaxes);
    if(Number(input.dcProtectedItemizedDeductions)>calcFBase) return {ok:false,code:"DC_ITEMIZED_PROTECTED_INVALID",errors:["District Calculation F protected itemized deductions cannot exceed the preliminary District itemized deduction."],stateSupport};
    if(input.dcFullYearHealthCoverageOrExempt===true&&Number(input.dcHealthCareSharedResponsibilityPayment)!==0) return {ok:false,code:"DC_HSR_ZERO_REQUIRED",errors:["Enter 0 for the DC Health Care Shared Responsibility payment when the family was fully covered or fully exempt."],stateSupport};
    if(input.dcFullYearHealthCoverageOrExempt!==true&&Number(input.dcHealthCareSharedResponsibilityPayment)<=0) return {ok:false,code:"DC_HSR_AMOUNT_REQUIRED",errors:["Enter the exact completed 2025 Schedule HSR payment when the family was not fully covered or fully exempt."],stateSupport};
    const eitcChildren=Number(input.dcEitcQualifyingChildCount); if(!Number.isInteger(eitcChildren)||eitcChildren<0||eitcChildren>3)return {ok:false,code:"DC_EITC_CHILD_COUNT_INVALID",errors:["District EITC qualifying-child count must be a whole number from 0 through 3."],stateSupport};
    if(input.dcClaimsEITC===true&&eitcChildren>0&&Number(input.dcCalculatedFederalEITCAmount)<=0) return {ok:false,code:"DC_EITC_AMOUNT_REQUIRED",errors:["Enter the calculated federal EITC amount used for the 100% District EITC with qualifying children."],stateSupport};
    if(input.dcClaimsEITC===true&&eitcChildren===0&&Number(input.dcChildlessEarnedIncome)<=0) return {ok:false,code:"DC_CHILDLESS_EITC_EARNED_INCOME_REQUIRED",errors:["Enter earned income for the 2025 District childless-EITC worksheet."],stateSupport};
    if(input.dcClaimsEITC!==true&&(eitcChildren!==0||Number(input.dcCalculatedFederalEITCAmount)!==0||Number(input.dcChildlessEarnedIncome)!==0)) return {ok:false,code:"DC_EITC_ZERO_REQUIRED",errors:["Enter 0 for District EITC detail amounts when no DC EITC is claimed."],stateSupport};
    if(input.dcClaimsScheduleH===true&&Number(input.dcScheduleHCredit)<=0) return {ok:false,code:"DC_SCHEDULE_H_AMOUNT_REQUIRED",errors:["Enter the exact completed 2025 Schedule H property-tax credit amount."],stateSupport};
    if(input.dcClaimsScheduleH!==true&&Number(input.dcScheduleHCredit)!==0) return {ok:false,code:"DC_SCHEDULE_H_ZERO_REQUIRED",errors:["Enter 0 for Schedule H credit when Schedule H is not claimed."],stateSupport};
    if(input.dcHasOtherJurisdictionCredit===true) return {ok:false,code:"DC_OTHER_JURISDICTION_CREDIT_REVIEW_REQUIRED",errors:["District credit for tax paid to another state or jurisdiction requires the other return and Schedule U calculation. This estimate is held rather than guessed."],stateSupport};
    if(input.dcHasD30UnincorporatedBusiness===true) return {ok:false,code:"DC_D30_REVIEW_REQUIRED",errors:["A District D-30/unincorporated-business situation can materially change D-40 treatment and requires separate review."],stateSupport};
    if(input.dcHasNoncustodialEITC===true) return {ok:false,code:"DC_NONCUSTODIAL_EITC_REVIEW_REQUIRED",errors:["District noncustodial-parent EITC requires Schedule N and separate review."],stateSupport};
    if(input.dcHasAmendedOrOtherSpecialItems===true) return {ok:false,code:"DC_SPECIAL_ITEMS_REVIEW_REQUIRED",errors:["This District return includes an amended or other material special situation requiring separate review."],stateSupport};
  }

  if (input.stateCode === "KS" && Number(input.taxYear) === 2025) {
    if (input.ksFullYearResident === null || input.ksFullYearResident === undefined) {
      return { ok: false, code: "KS_RESIDENCY_SCREEN_REQUIRED", errors: ["Kansas needs confirmation that this is a full-year resident 2025 K-40 return."], stateSupport };
    }
    if (input.ksFullYearResident !== true) {
      return { ok: false, code: "KS_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Kansas part-year and nonresident returns require Schedule S Part B allocation. This estimate is held rather than guessed."], stateSupport };
    }
    if (!["standard", "itemized"].includes(String(input.ksDeductionMethod || ""))) {
      return { ok: false, code: "KS_DEDUCTION_METHOD_REQUIRED", errors: ["Select whether the Kansas K-40 Line 4 deduction is standard or itemized."], stateSupport };
    }
    for (const [field, code, message] of [
      ["ksNetModifications", "KS_NET_MODIFICATIONS_REQUIRED", "Enter exact Schedule S Part A Line A27 net Kansas modifications for K-40 Line 2, including 0. This signed amount may be negative."],
      ["ksDeductionAmount", "KS_DEDUCTION_REQUIRED", "Enter exact K-40 Line 4 Kansas deduction, including the applicable 2025 standard-deduction worksheet amount or completed Schedule A amount."],
      ["ksNewbornDependentCount", "KS_NEWBORN_COUNT_REQUIRED", "Enter the number of Kansas dependent-child birth additional exemptions, including 0."],
      ["ksStillbirthCount", "KS_STILLBIRTH_COUNT_REQUIRED", "Enter the number of Kansas stillbirth additional exemptions, including 0."],
      ["ksDisabledVeteranCount", "KS_DISABLED_VETERAN_COUNT_REQUIRED", "Enter the number of qualified disabled-veteran additional exemptions, including 0."],
      ["ksLumpSumDistributionTax", "KS_LUMP_SUM_TAX_REQUIRED", "Enter exact completed K-40 Line 11 Kansas tax on lump-sum distributions, including 0."],
      ["ksFederalChildDependentCareCredit", "KS_CHILD_CARE_FEDERAL_CREDIT_REQUIRED", "Enter the federal Form 2441 credit allowed against federal tax for Kansas Line 14, including 0."],
      ["ksOtherNonrefundableCredits", "KS_OTHER_NONREFUNDABLE_REQUIRED", "Enter exact K-40 Line 15 other nonrefundable credits, including 0."],
      ["ksFederalEITCAmount", "KS_FEDERAL_EITC_REQUIRED", "Enter exact federal EITC used for Kansas's 17% resident credit, including 0."],
      ["ksOtherFormWithholding", "KS_OTHER_FORM_WITHHOLDING_REQUIRED", "Enter Kansas withholding from 1099 and other non-W-2 forms included on K-40 Line 19, including 0."],
      ["ksEstimatedPayments", "KS_ESTIMATED_PAYMENTS_REQUIRED", "Enter K-40 Line 20 estimated tax/prior-year overpayment credit, including 0."],
      ["ksExtensionPayment", "KS_EXTENSION_PAYMENT_REQUIRED", "Enter K-40 Line 21 extension payment, including 0."],
      ["ksOtherRefundableCredits", "KS_OTHER_REFUNDABLE_REQUIRED", "Enter exact K-40 refundable credits other than the refundable Kansas EITC and K-120S PTET credit, including 0."],
      ["ksPtetCredit", "KS_PTET_CREDIT_REQUIRED", "Enter K-40 Line 25 K-120S pass-through entity tax credit, including 0."],
      ["ksInterest", "KS_INTEREST_REQUIRED", "Enter K-40 interest amount, including 0."],
      ["ksLatePaymentPenalty", "KS_LATE_PAYMENT_PENALTY_REQUIRED", "Enter K-40 late-payment penalty, including 0."],
      ["ksEstimatedTaxPenalty", "KS_ESTIMATED_TAX_PENALTY_REQUIRED", "Enter K-40/K-210 estimated-tax penalty, including 0."],
      ["ksCreditForward", "KS_CREDIT_FORWARD_REQUIRED", "Enter overpayment requested as a 2026 Kansas credit, including 0."],
      ["ksContributions", "KS_CONTRIBUTIONS_REQUIRED", "Enter total K-40 voluntary contributions, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
      if (field !== "ksNetModifications" && Number(input[field]) < 0) return { ok: false, code: "KS_NEGATIVE_AMOUNT_INVALID", errors: [`Kansas amount ${field} cannot be negative.`], stateSupport };
    }
    for (const [field, code, message] of [
      ["ksHasOtherStateCredit", "KS_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Kansas needs to know whether the K-40 Line 13 credit for taxes paid to another state or local jurisdiction applies."],
      ["ksHasSeparatePropertyTaxRefundClaim", "KS_PROPERTY_REFUND_SCREEN_REQUIRED", "Kansas needs to know whether a separate K-40H/K-40PT/K-40SVR homestead or property-tax relief claim applies."],
      ["ksHasAmendedOrOtherSpecialItems", "KS_SPECIAL_ITEMS_SCREEN_REQUIRED", "Kansas needs a final screen for amended returns or other material Kansas special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.filingStatus === "mfs" && (input.ksMfsSpouseSameDeductionMethod === null || input.ksMfsSpouseSameDeductionMethod === undefined)) {
      return { ok: false, code: "KS_MFS_DEDUCTION_SCREEN_REQUIRED", errors: ["Kansas MFS returns need confirmation that both spouses use the same deduction method."], stateSupport };
    }
    if (input.filingStatus === "mfs" && input.ksMfsSpouseSameDeductionMethod !== true) {
      return { ok: false, code: "KS_MFS_DEDUCTION_METHOD_REVIEW_REQUIRED", errors: ["Kansas married-filing-separately spouses must use the same deduction method. Correct the method before estimating."], stateSupport };
    }
    if (!Number.isInteger(Number(input.ksNewbornDependentCount)) || !Number.isInteger(Number(input.ksStillbirthCount)) || !Number.isInteger(Number(input.ksDisabledVeteranCount))) {
      return { ok: false, code: "KS_EXEMPTION_COUNT_INVALID", errors: ["Kansas additional-exemption counts must be whole numbers."], stateSupport };
    }
    const maxDisabledVeterans = input.filingStatus === "mfj" ? 2 : 1;
    if (Number(input.ksDisabledVeteranCount) > maxDisabledVeterans) {
      return { ok: false, code: "KS_DISABLED_VETERAN_COUNT_INVALID", errors: ["The supported Kansas disabled-veteran personal exemption count exceeds the number of taxpayer/spouse positions on this filing status."], stateSupport };
    }
    if (input.canBeClaimedAsDependent !== true && Number(input.ksNewbornDependentCount) > Number(input.numberOfDependents || 0)) {
      return { ok: false, code: "KS_NEWBORN_DEPENDENT_COUNT_INVALID", errors: ["Kansas newborn additional exemptions cannot exceed the federal dependent count entered for this return."], stateSupport };
    }
    const hasSupportedCredit = Number(input.ksFederalChildDependentCareCredit || 0) > 0 || Number(input.ksOtherNonrefundableCredits || 0) > 0 || Number(input.ksFederalEITCAmount || 0) > 0 || Number(input.ksOtherRefundableCredits || 0) > 0;
    if (hasSupportedCredit && (input.ksCreditSsnEligibilityConfirmed === null || input.ksCreditSsnEligibilityConfirmed === undefined)) {
      return { ok: false, code: "KS_CREDIT_SSN_SCREEN_REQUIRED", errors: ["Kansas requires confirmation of the valid-SSN rule for the supported individual income-tax credits being claimed."], stateSupport };
    }
    if (hasSupportedCredit && input.ksCreditSsnEligibilityConfirmed !== true) {
      return { ok: false, code: "KS_CREDIT_SSN_REVIEW_REQUIRED", errors: ["The supported Kansas credit path requires the applicable taxpayer/spouse/dependent valid-SSN rule to be satisfied. This estimate is held rather than allowing an ineligible credit."], stateSupport };
    }
    if (input.ksHasOtherStateCredit === true) {
      return { ok: false, code: "KS_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Kansas K-40 Line 13 other-state/local-jurisdiction credit requires the other jurisdiction's return and Kansas limitation worksheet. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.ksHasSeparatePropertyTaxRefundClaim === true) {
      return { ok: false, code: "KS_SEPARATE_PROPERTY_REFUND_REVIEW_REQUIRED", errors: ["Kansas homestead/property-tax relief claims use separate K-40H, K-40PT, or K-40SVR calculations. This state-income-tax estimate is held so a separate refund is not silently omitted."], stateSupport };
    }
    if (input.ksHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "KS_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Kansas return includes an amended-return item or another material Kansas special situation that requires separate review."], stateSupport };
    }
  }

  if (input.stateCode === "NE" && Number(input.taxYear) === 2025) {
    if (input.neFullYearResident === null || input.neFullYearResident === undefined) {
      return { ok: false, code: "NE_RESIDENCY_SCREEN_REQUIRED", errors: ["Nebraska needs confirmation that this is a full-year resident 2025 Form 1040N return."], stateSupport };
    }
    if (input.neFullYearResident !== true) {
      return { ok: false, code: "NE_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Nebraska partial-year and nonresident returns require Schedule III source-income allocation. This estimate is held rather than guessed."], stateSupport };
    }

    for (const [field, code, message] of [
      ["neStandardDeduction", "NE_STANDARD_DEDUCTION_REQUIRED", "Enter exact 2025 Form 1040N Line 6 Nebraska standard deduction from the official chart/dependent rule, including 0 if legitimately none."],
      ["neFederalItemizedDeductions", "NE_ITEMIZED_DEDUCTIONS_REQUIRED", "Enter Federal Schedule A Line 17 itemized deductions for Nebraska Line 7, including 0 when not itemizing."],
      ["neStateLocalIncomeTaxes", "NE_STATE_LOCAL_INCOME_TAX_REQUIRED", "Enter the state/local income taxes used on Nebraska Line 8, including 0 when sales tax was used or no itemized deduction applies."],
      ["neScheduleIIncreases", "NE_SCHEDULE_I_INCREASES_REQUIRED", "Enter exact Nebraska Schedule I Line 13 adjustments increasing federal AGI, including 0."],
      ["neScheduleIDecreases", "NE_SCHEDULE_I_DECREASES_REQUIRED", "Enter exact Nebraska Schedule I Line 44 adjustments decreasing federal AGI, including 0."],
      ["neFederalLumpSumTax", "NE_LUMP_SUM_TAX_REQUIRED", "Enter federal Form 4972 lump-sum tax used on Form 1040N Line 16a, including 0."],
      ["neFederalEarlyDistributionTax", "NE_EARLY_DISTRIBUTION_TAX_REQUIRED", "Enter the federal early-distribution tax amount used on Form 1040N Line 16b, including 0."],
      ["neOtherNonrefundableCredits", "NE_NONREFUNDABLE_CREDITS_REQUIRED", "Enter the exact total of Form 1040N Lines 20 through 33 nonrefundable credits excluding the personal-exemption credit and Schedule II other-state credit, including 0."],
      ["neOtherFormWithholding", "NE_OTHER_FORM_WITHHOLDING_REQUIRED", "Enter Form 1040N Line 37 Nebraska withholding from W-2G, 1099-R, 1099-MISC, 1099-NEC, and other federal forms, including 0."],
      ["neK1Withholding", "NE_K1_WITHHOLDING_REQUIRED", "Enter Form 1040N Line 38 K-1N withholding, including 0."],
      ["nePtetCredit", "NE_PTET_CREDIT_REQUIRED", "Enter Form 1040N Line 39 PTET credit, including 0."],
      ["neEstimatedPayments", "NE_ESTIMATED_PAYMENTS_REQUIRED", "Enter Form 1040N Line 40 estimated/extension payments, including 0."],
      ["neForm3800RefundableCredit", "NE_3800_REFUNDABLE_REQUIRED", "Enter Form 1040N Line 41 Form 3800N refundable credit, including 0."],
      ["neChildDependentCareRefundableCredit", "NE_CHILD_CARE_REFUNDABLE_REQUIRED", "Enter Form 1040N Line 42 Nebraska child/dependent-care refundable credit, including 0."],
      ["neBeginningFarmerCredit", "NE_BEGINNING_FARMER_REQUIRED", "Enter Form 1040N Line 43 Beginning Farmer credit, including 0."],
      ["neFederalEITCAmount", "NE_FEDERAL_EITC_REQUIRED", "Enter the exact federal EITC amount used for Nebraska Line 44, including 0."],
      ["neOtherRefundableCredits", "NE_OTHER_REFUNDABLE_REQUIRED", "Enter the exact total of Form 1040N Lines 45 through 51 other refundable credits, including 0."],
      ["neUnderpaymentPenalty", "NE_UNDERPAYMENT_PENALTY_REQUIRED", "Enter Form 1040N Line 56 underpayment penalty, including 0."],
      ["neUseTax", "NE_USE_TAX_REQUIRED", "Enter exact Form 1040N Line 58 state/local use tax, including 0. The estimator will not guess a local sales/use-tax rate."],
      ["neApplyToNextYear", "NE_APPLY_NEXT_YEAR_REQUIRED", "Enter the amount of overpayment to apply to 2026 on Form 1040N Line 61, including 0."],
      ["neWildlifeDonation", "NE_WILDLIFE_DONATION_REQUIRED", "Enter Form 1040N Line 62 Wildlife Conservation Fund donation, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
      if (Number(input[field]) < 0) return { ok: false, code: "NE_NEGATIVE_AMOUNT_INVALID", errors: [`Nebraska amount ${field} cannot be negative.`], stateSupport };
    }

    const neNetAdjustments = Number(input.neScheduleIIncreases || 0) - Number(input.neScheduleIDecreases || 0);
    if (neNetAdjustments < 5000) {
      if (input.neFederalTaxBeforeCreditsLimit === null || input.neFederalTaxBeforeCreditsLimit === undefined) {
        return { ok: false, code: "NE_FEDERAL_TAX_LIMIT_REQUIRED", errors: ["Nebraska's Line 35 Federal Tax Liability Worksheet can apply when Line 12 minus Line 13 is under $5,000. Enter the exact worksheet federal-tax-before-credits amount, including 0."], stateSupport };
      }
      if (Number(input.neFederalTaxBeforeCreditsLimit) < 0) {
        return { ok: false, code: "NE_NEGATIVE_AMOUNT_INVALID", errors: ["Nebraska amount neFederalTaxBeforeCreditsLimit cannot be negative."], stateSupport };
      }
    }

    for (const [field, code, message] of [
      ["neHasOtherStateCredit", "NE_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Nebraska needs to know whether Schedule II credit for tax paid to another state applies."],
      ["neHasFederalNolEitcSpecialCase", "NE_NOL_EITC_SCREEN_REQUIRED", "Nebraska needs to know whether the special NOL earned-income worksheet affects Nebraska EITC eligibility."],
      ["neUseTaxRequiresSeparateForm3", "NE_USE_TAX_FORM3_SCREEN_REQUIRED", "Nebraska needs to know whether use tax must be reported separately on Form 3 because multiple local jurisdictions or a Good Life District rule applies."],
      ["neHasAmendedOrOtherSpecialItems", "NE_SPECIAL_ITEMS_SCREEN_REQUIRED", "Nebraska needs a final screen for amended returns or other material Nebraska special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }

    if (input.filingStatus === "mfj" && (input.neSpouseCanBeClaimedAsDependent === null || input.neSpouseCanBeClaimedAsDependent === undefined)) {
      return { ok: false, code: "NE_SPOUSE_DEPENDENT_SCREEN_REQUIRED", errors: ["Nebraska needs to know whether the MFJ spouse can be claimed by another taxpayer for the personal-exemption credit."], stateSupport };
    }
    if (Number(input.neStateLocalIncomeTaxes) > Number(input.neFederalItemizedDeductions)) {
      return { ok: false, code: "NE_ITEMIZED_SUBTRACTION_INVALID", errors: ["Nebraska Line 8 state/local income taxes cannot exceed the Federal Schedule A Line 17 amount entered for Nebraska Line 7."], stateSupport };
    }
    if (input.neHasOtherStateCredit === true) {
      return { ok: false, code: "NE_SCHEDULE_II_REVIEW_REQUIRED", errors: ["Nebraska Schedule II credit for tax paid to another state requires the other state's return and conversion-chart details. This estimate is held rather than guessed."], stateSupport };
    }
    if (input.neUseTaxRequiresSeparateForm3 === true) {
      return { ok: false, code: "NE_USE_TAX_FORM3_REVIEW_REQUIRED", errors: ["Nebraska use tax involving multiple local jurisdictions or an applicable Good Life District must be handled on Form 3. This estimate is held rather than guessing a separate state/local use-tax calculation."], stateSupport };
    }
    if (input.neHasFederalNolEitcSpecialCase === true) {
      return { ok: false, code: "NE_NOL_EITC_REVIEW_REQUIRED", errors: ["Nebraska's special NOL earned-income worksheet can change EITC eligibility. This case requires separate review rather than a guessed 10% credit."], stateSupport };
    }
    if (input.neHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "NE_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Nebraska return includes an amended-return item or another material Nebraska special situation that requires separate review."], stateSupport };
    }
  }

  if (input.stateCode === "IA" && Number(input.taxYear) === 2025) {
    if (input.iaFullYearResident === null || input.iaFullYearResident === undefined) {
      return { ok: false, code: "IA_RESIDENCY_SCREEN_REQUIRED", errors: ["Iowa needs confirmation that this is a full-year resident 2025 IA 1040 return."], stateSupport };
    }
    if (input.iaFullYearResident !== true) {
      return { ok: false, code: "IA_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Iowa part-year and nonresident returns require IA 126 source allocation. This estimate is held rather than guessed."], stateSupport };
    }

    for (const [field, code, message] of [
      ["iaFederalTaxableIncomeLine2", "IA_FEDERAL_TAXABLE_INCOME_REQUIRED", "Enter exact 2025 IA 1040 Line 2 federal taxable income for Iowa purposes. This may be negative when federal Form 1040 Line 15 is zero."],
      ["iaNetIowaModifications", "IA_MODIFICATIONS_REQUIRED", "Enter exact IA 1040 Line 3 net Iowa modifications from Schedule 1, including 0."],
      ["iaFederalDeductionForSpecialCalc", "IA_SPECIAL_DEDUCTION_REQUIRED", "Enter the IA 1040 Line 1d federal standard/itemized deduction amount used for Iowa low-income/alternate-tax calculations, including 0."],
      ["iaFederalPersonalExemptionForSpecialCalc", "IA_PERSONAL_EXEMPTION_REQUIRED", "Enter the federal personal exemption / enhanced senior deduction used on IA 1040 Line 1f for Iowa special calculations, including 0."],
      ["iaQualifiedBusinessIncomeDeduction", "IA_QBI_REQUIRED", "Enter IA 1040 Line 1e qualified business income deduction, including 0."],
      ["iaNolCarryover", "IA_NOL_REQUIRED", "Enter IA 1040 Schedule 1 Line 17b NOL carryover used by Iowa special computations, including 0."],
      ["iaLumpSumDistributionTaxableIncome", "IA_LUMP_SUM_INCOME_REQUIRED", "Enter federal Form 4972 Line 8 taxable lump-sum distribution used by Iowa special computations, including 0."],
      ["iaLumpSumTax", "IA_LUMP_SUM_TAX_REQUIRED", "Enter exact IA 1040 Line 6 Iowa lump-sum tax, including 0."],
      ["iaTuitionTextbookCredit", "IA_TUITION_CREDIT_REQUIRED", "Enter exact IA 1040 Line 9 tuition/textbook credit, including 0."],
      ["iaVolunteerCredit", "IA_VOLUNTEER_CREDIT_REQUIRED", "Enter exact IA 1040 Line 10 volunteer firefighter/EMS/reserve peace officer credit, including 0."],
      ["iaOtherNonrefundableCredits", "IA_OTHER_NONREFUNDABLE_CREDITS_REQUIRED", "Enter exact IA 1040 Line 17 other nonrefundable Iowa credits, including 0."],
      ["iaSchoolDistrictEmsSurtaxRate", "IA_SURTAX_RATE_REQUIRED", "Enter the exact combined 2025 school-district/EMS surtax rate from Iowa form 41-027, including 0 when no surtax applies."],
      ["iaContributions", "IA_CONTRIBUTIONS_REQUIRED", "Enter IA 1040 Line 21 voluntary contributions, including 0."],
      ["iaFuelTaxCredit", "IA_FUEL_CREDIT_REQUIRED", "Enter IA 1040 Line 23 Iowa fuel tax credit, including 0."],
      ["iaChildDependentOrEarlyChildhoodCredit", "IA_CHILD_CARE_CREDIT_REQUIRED", "Enter exact IA 1040 Line 24 child/dependent-care or early-childhood-development credit, including 0."],
      ["iaEarnedIncomeTaxCredit", "IA_EITC_REQUIRED", "Enter exact IA 1040 Line 25 Iowa earned income tax credit, including 0."],
      ["iaOtherRefundableCredits", "IA_OTHER_REFUNDABLE_CREDITS_REQUIRED", "Enter IA 1040 Line 26 other refundable credits, including 0."],
      ["iaCompositePtetCredit", "IA_COMPOSITE_PTET_REQUIRED", "Enter IA 1040 Line 27 composite/PTET credit, including 0."],
      ["iaEstimatedAndOtherPayments", "IA_ESTIMATED_PAYMENTS_REQUIRED", "Enter IA 1040 Line 29 estimated and other payments, including 0."],
      ["iaUnderpaymentPenalty", "IA_UNDERPAYMENT_PENALTY_REQUIRED", "Enter exact IA 1040 Line 35 underpayment penalty, including 0."],
      ["iaOtherPenaltyInterest", "IA_OTHER_PENALTY_REQUIRED", "Enter exact IA 1040 Line 36 penalty and interest, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }

    for (const [field, code, message] of [
      ["iaTaxpayerBlind", "IA_TAXPAYER_BLIND_REQUIRED", "Iowa needs taxpayer blind-status confirmation for the Step 3 additional personal credit."],
      ["iaHasOutOfStateTaxCredit", "IA_OUT_OF_STATE_CREDIT_SCREEN_REQUIRED", "Iowa needs to know whether IA 130 out-of-state tax credit applies."],
      ["iaHasAmendedOrOtherSpecialItems", "IA_SPECIAL_ITEMS_SCREEN_REQUIRED", "Iowa needs a final screen for amended or other material special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }

    if (input.filingStatus === "mfj" && (input.iaSpouseBlind === null || input.iaSpouseBlind === undefined)) {
      return { ok: false, code: "IA_SPOUSE_BLIND_REQUIRED", errors: ["Iowa needs spouse blind-status confirmation for a married filing jointly return."], stateSupport };
    }
    if (input.filingStatus === "mfs") {
      for (const [field, code, message] of [
        ["iaMfsSpouseIowaTaxableIncome", "IA_MFS_SPOUSE_TAXABLE_REQUIRED", "Enter the spouse's exact IA 1040 Line 4 Iowa taxable income for MFS alternate-tax testing."],
        ["iaMfsSpouseAdjustedIncome", "IA_MFS_SPOUSE_ADJUSTED_REQUIRED", "Enter the spouse's exact adjusted Iowa income total used on the 2025 alternate-tax/low-income worksheet."],
        ["iaMfsSpouseNolCarryover", "IA_MFS_SPOUSE_NOL_REQUIRED", "Enter the spouse's IA 1040 Schedule 1 Line 17b NOL carryover, including 0."],
      ]) {
        if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
      }
    }
    if (Number(input.iaSchoolDistrictEmsSurtaxRate) < 0 || Number(input.iaSchoolDistrictEmsSurtaxRate) > 100) {
      return { ok: false, code: "IA_SURTAX_RATE_INVALID", errors: ["Iowa school-district/EMS surtax rate must be entered as a percentage from 0 through 100."], stateSupport };
    }
    if (input.iaHasOutOfStateTaxCredit === true) {
      return { ok: false, code: "IA_OUT_OF_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Iowa IA 130 out-of-state credit requires the other jurisdiction's income and tax details. This estimate is held rather than guessing the credit."], stateSupport };
    }
    if (input.iaHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "IA_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Iowa return includes an amended-return item or another material Iowa special situation requiring separate review."], stateSupport };
    }
  }

  if (input.stateCode === "MN" && Number(input.taxYear) === 2025) {
    if (input.mnFullYearResident === null || input.mnFullYearResident === undefined) {
      return { ok: false, code: "MN_RESIDENCY_SCREEN_REQUIRED", errors: ["Minnesota needs confirmation that this is a full-year resident 2025 Form M1 return."], stateSupport };
    }
    if (input.mnFullYearResident !== true) {
      return { ok: false, code: "MN_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Minnesota part-year and nonresident returns require Schedule M1NR allocation. This estimate is being held rather than guessed."], stateSupport };
    }
    for (const [field, code, message] of [
      ["mnM1Additions", "MN_ADDITIONS_REQUIRED", "Enter the exact 2025 Form M1 Line 2 additions from Schedules M1M and M1MB, including 0."],
      ["mnStateIncomeTaxRefund", "MN_STATE_REFUND_REQUIRED", "Enter Form M1 Line 6 state income tax refund included in federal AGI, including 0."],
      ["mnM1Subtractions", "MN_SUBTRACTIONS_REQUIRED", "Enter the exact Form M1 Line 7 subtractions from Schedules M1M and M1MB, including 0."],
      ["mnAlternativeMinimumTax", "MN_AMT_REQUIRED", "Enter the exact Schedule M1MT alternative minimum tax for Form M1 Line 11, including 0."],
      ["mnOtherTaxes", "MN_OTHER_TAXES_REQUIRED", "Enter exact Form M1 Line 14a other taxes, including Schedule NIIT when applicable, or 0."],
      ["mnAdvanceChildTaxCreditRepayment", "MN_ADVANCE_CTC_REPAYMENT_REQUIRED", "Enter Form M1 Line 14b advance Child Tax Credit repayment, including 0."],
      ["mnNonrefundableCredits", "MN_NONREF_CREDITS_REQUIRED", "Enter exact Schedule M1C Line 19 nonrefundable credits for Form M1 Line 16, including 0."],
      ["mnNongameWildlifeContribution", "MN_NONGAME_REQUIRED", "Enter Form M1 Line 18 Nongame Wildlife Fund contribution, including 0."],
      ["mnEstimatedPayments", "MN_ESTIMATED_PAYMENTS_REQUIRED", "Enter Form M1 Line 21 estimated and extension payments, including 0."],
      ["mnRefundableCredits", "MN_REFUNDABLE_CREDITS_REQUIRED", "Enter exact Schedule M1REF Line 14 refundable credits for Form M1 Line 22, including 0."],
      ["mnScheduleM15Penalty", "MN_M15_PENALTY_REQUIRED", "Enter exact Form M1 Line 27 Schedule M15 penalty, including 0."],
      ["mnOtherPenaltyInterest", "MN_OTHER_PENALTY_REQUIRED", "Enter Form M1 Line 28 penalty and interest, including 0."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    for (const [field, code, message] of [
      ["mnUseItemizedDeductions", "MN_DEDUCTION_CHOICE_REQUIRED", "Minnesota needs to know whether Form M1 Line 4 uses Minnesota itemized deductions or the Minnesota standard deduction."],
      ["mnHasM1NCFederalAdjustments", "MN_M1NC_SCREEN_REQUIRED", "Minnesota needs to know whether Schedule M1NC changes the AGI used by Minnesota deduction/exemption worksheets."],
      ["mnHasOtherStateCreditOrReciprocity", "MN_OTHER_STATE_SCREEN_REQUIRED", "Minnesota needs to know whether an other-state credit or reciprocity issue applies."],
      ["mnShortPeriodOrNonresidentAlien", "MN_SPECIAL_STANDARD_DEDUCTION_SCREEN_REQUIRED", "Minnesota needs to know whether the short-period/nonresident-alien standard-deduction restriction applies."],
      ["mnHasAmendedOrOtherSpecialItems", "MN_SPECIAL_ITEMS_SCREEN_REQUIRED", "Minnesota needs a final screen for amended or other material special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) return { ok: false, code, errors: [message], stateSupport };
    }
    if (input.mnShortPeriodOrNonresidentAlien === true) {
      return { ok: false, code: "MN_STANDARD_DEDUCTION_SPECIAL_REVIEW_REQUIRED", errors: ["Minnesota short-period and nonresident-alien standard-deduction cases require separate review rather than the ordinary Form M1 resident path."], stateSupport };
    }
    if (input.mnUseItemizedDeductions === true && (input.mnItemizedDeductions === null || input.mnItemizedDeductions === undefined)) {
      return { ok: false, code: "MN_ITEMIZED_DEDUCTION_REQUIRED", errors: ["Enter the exact completed Schedule M1SA Line 27 Minnesota itemized deduction."], stateSupport };
    }
    if (input.mnUseItemizedDeductions !== true && (input.mnTaxpayerBlind === null || input.mnTaxpayerBlind === undefined)) {
      return { ok: false, code: "MN_TAXPAYER_BLIND_REQUIRED", errors: ["Minnesota needs the taxpayer blind-status confirmation for the 2025 standard deduction."], stateSupport };
    }
    if (input.filingStatus === "mfs" && (input.mnMfsSpouseItemizes === null || input.mnMfsSpouseItemizes === undefined)) {
      return { ok: false, code: "MN_MFS_SPOUSE_ITEMIZES_REQUIRED", errors: ["Minnesota MFS needs confirmation whether the spouse itemizes because both spouses must use the same deduction method."], stateSupport };
    }
    if (input.filingStatus === "mfs" && input.mnUseItemizedDeductions !== input.mnMfsSpouseItemizes) {
      return { ok: false, code: "MN_MFS_DEDUCTION_METHOD_CONFLICT", errors: ["Minnesota married-filing-separately spouses must use the same Minnesota deduction method. Recheck the itemized/standard selections."], stateSupport };
    }
    if (input.filingStatus === "mfs" && input.mnUseItemizedDeductions !== true && (input.mnMfsSpouseNoGrossIncomeAndNotDependent === null || input.mnMfsSpouseNoGrossIncomeAndNotDependent === undefined)) {
      return { ok: false, code: "MN_MFS_SPOUSE_STANDARD_BOX_SCREEN_REQUIRED", errors: ["Minnesota MFS needs to know whether the spouse has no gross income and cannot be claimed as a dependent before spouse age/blind boxes can affect the standard deduction."], stateSupport };
    }
    if (input.mnUseItemizedDeductions !== true && ["mfj","mfs"].includes(input.filingStatus) && (input.mnSpouseBlind === null || input.mnSpouseBlind === undefined)) {
      return { ok: false, code: "MN_SPOUSE_BLIND_REQUIRED", errors: ["Minnesota needs the spouse blind-status confirmation for the standard deduction."], stateSupport };
    }
    if (input.mnUseItemizedDeductions !== true && input.filingStatus === "mfj" && (input.mnSpouseCanBeClaimedAsDependent === null || input.mnSpouseCanBeClaimedAsDependent === undefined)) {
      return { ok: false, code: "MN_SPOUSE_DEPENDENT_REQUIRED", errors: ["Minnesota needs to know whether an MFJ spouse can be claimed as another person's dependent for the dependent standard-deduction worksheet."], stateSupport };
    }
    const mnDependentWorksheetApplies = input.canBeClaimedAsDependent === true || (input.filingStatus === "mfj" && input.mnSpouseCanBeClaimedAsDependent === true);
    if (input.mnUseItemizedDeductions !== true && mnDependentWorksheetApplies && (input.mnDependentEarnedIncome === null || input.mnDependentEarnedIncome === undefined)) {
      return { ok: false, code: "MN_DEPENDENT_EARNED_INCOME_REQUIRED", errors: ["Enter earned income for Minnesota's 2025 dependent standard-deduction worksheet."], stateSupport };
    }
    if (input.mnHasM1NCFederalAdjustments === true && (input.mnM1NCWorksheetAGI === null || input.mnM1NCWorksheetAGI === undefined)) {
      return { ok: false, code: "MN_M1NC_AGI_REQUIRED", errors: ["Enter exact Schedule M1NC Line 43 AGI used for Minnesota standard-deduction and dependent-exemption worksheets."], stateSupport };
    }
    if (input.mnHasOtherStateCreditOrReciprocity === true) {
      return { ok: false, code: "MN_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Minnesota Schedule M1CR/M1RCR and Michigan/North Dakota reciprocity cases require the other jurisdiction's income, source, and tax information. This estimate is held rather than guessing."], stateSupport };
    }
    if (input.mnHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "MN_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Minnesota return includes an amended-return item or another material Minnesota special situation that requires separate review."], stateSupport };
    }
  }

  if (input.stateCode === "WI" && Number(input.taxYear) === 2025) {
    if (input.wiFullYearResident === null || input.wiFullYearResident === undefined) {
      return { ok: false, code: "WI_RESIDENCY_SCREEN_REQUIRED", errors: ["Wisconsin needs confirmation that this is a full-year resident 2025 Form 1 return, including the joint-return residency requirement when filing MFJ."], stateSupport };
    }
    if (input.wiFullYearResident !== true) {
      return { ok: false, code: "WI_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED", errors: ["Wisconsin part-year and nonresident returns use Form 1NPR and prorated income/tax rules. This estimate is being held rather than guessed."], stateSupport };
    }

    for (const [field, code, message] of [
      ["wiScheduleIAdjustment", "WI_SCHEDULE_I_REQUIRED", "Enter the exact 2025 Wisconsin Schedule I Line 3 net adjustment, including 0 when no Schedule I adjustment applies."],
      ["wiScheduleADAdditions", "WI_SCHEDULE_AD_REQUIRED", "Enter the exact 2025 Schedule AD Line 33 additions total for Form 1 Line 4, including 0 when none applies."],
      ["wiScheduleSBSubtractions", "WI_SCHEDULE_SB_REQUIRED", "Enter the exact 2025 Schedule SB Line 50 subtraction total for Form 1 Line 6, including 0 when none applies."],
      ["wiNonrefundableCredits", "WI_NONREFUNDABLE_CREDITS_REQUIRED", "Enter the exact completed Form 1 Lines 13 through 20 nonrefundable-credit total, including 0 when none applies."],
      ["wiOtherRefundableCredits", "WI_OTHER_REFUNDABLE_CREDITS_REQUIRED", "Enter the exact completed Form 1 Lines 31 through 35 refundable-credit total excluding Wisconsin EIC, including 0 when none applies."],
      ["wiUseTax", "WI_USE_TAX_REQUIRED", "Enter Form 1 Line 23 Wisconsin sales/use tax due, including 0 when none applies."],
      ["wiDonations", "WI_DONATIONS_REQUIRED", "Enter Form 1 Line 24 donations, including 0 when none applies."],
      ["wiRetirementPenaltiesAndCreditRepayments", "WI_PENALTIES_REQUIRED", "Enter the exact combined Form 1 Lines 25 and 26 penalties/credit repayments, including 0 when none applies."],
      ["wiEstimatedPayments", "WI_ESTIMATED_PAYMENTS_REQUIRED", "Enter Form 1 Line 29 estimated/extension payments and 2024 amount applied, including 0 when none applies."],
      ["wiUnderpaymentInterest", "WI_UNDERPAYMENT_INTEREST_REQUIRED", "Enter exact Form 1 Line 44 underpayment interest from Schedule U, including 0 when none applies."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    for (const [field, code, message] of [
      ["wiShortPeriodOrPossessions", "WI_SPECIAL_STANDARD_DEDUCTION_SCREEN_REQUIRED", "Wisconsin needs to know whether this is a short-period return or federal Form 4563/U.S.-possessions case."],
      ["wiUsedNewRetirementIncomeSubtraction", "WI_NEW_RETIREMENT_SUBTRACTION_SCREEN_REQUIRED", "Wisconsin needs to know whether Schedule SB includes the new 2025 age-67 retirement-income subtraction that restricts all Wisconsin credits."],
      ["wiClaimedFederalEIC", "WI_EIC_SCREEN_REQUIRED", "Wisconsin needs to know whether a federal EIC is being used for the Wisconsin earned income credit."],
      ["wiHasOtherStateCreditOrReciprocity", "WI_OTHER_STATE_CREDIT_SCREEN_REQUIRED", "Wisconsin needs to know whether a credit for tax paid to another state or a reciprocity issue applies."],
      ["wiHasAmendedOrOtherSpecialItems", "WI_SPECIAL_ITEMS_SCREEN_REQUIRED", "Wisconsin needs a final screen for amended returns or other material special items."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    if (input.wiShortPeriodOrPossessions === true) {
      return { ok: false, code: "WI_STANDARD_DEDUCTION_SPECIAL_REVIEW_REQUIRED", errors: ["Wisconsin short-period returns and federal Form 4563/U.S.-possessions cases do not use the ordinary standard deduction. This case requires separate review."], stateSupport };
    }

    if (input.filingStatus === "mfj" && (input.wiSpouseCanBeClaimedAsDependent === null || input.wiSpouseCanBeClaimedAsDependent === undefined)) {
      return { ok: false, code: "WI_SPOUSE_DEPENDENT_SCREEN_REQUIRED", errors: ["Wisconsin needs to know whether the spouse can be claimed as another person's dependent so the dependent standard-deduction worksheet and exemptions are correct."], stateSupport };
    }

    const wiDependentWorksheetApplies = input.canBeClaimedAsDependent === true || (input.filingStatus === "mfj" && input.wiSpouseCanBeClaimedAsDependent === true);
    if (wiDependentWorksheetApplies && (input.wiDependentEarnedIncome === null || input.wiDependentEarnedIncome === undefined)) {
      return { ok: false, code: "WI_DEPENDENT_EARNED_INCOME_REQUIRED", errors: ["Enter earned income included on Wisconsin Form 1 Line 7 so the 2025 Standard Deduction Worksheet for Dependents can be completed."], stateSupport };
    }

    if (input.wiClaimedFederalEIC === true) {
      if (input.filingStatus === "mfs") {
        return { ok: false, code: "WI_EIC_MFS_REVIEW_REQUIRED", errors: ["Wisconsin does not allow the Wisconsin EIC on an ordinary married-filing-separately return. A taxpayer meeting the IRC 7703(b) exception should use Wisconsin head-of-household filing status; this MFS case is held for review."], stateSupport };
      }
      if (!(Number(input.wiFederalEICAmount || 0) > 0)) {
        return { ok: false, code: "WI_FEDERAL_EIC_AMOUNT_REQUIRED", errors: ["Enter the exact federal EIC amount used for Wisconsin purposes. If Schedule I changes federal income, use the recomputed Schedule I Part III amount."], stateSupport };
      }
      if (!(Number(input.wiEICQualifyingChildren || 0) >= 1)) {
        return { ok: false, code: "WI_EIC_CHILD_COUNT_REQUIRED", errors: ["Wisconsin's 2025 earned income credit requires at least one qualifying child. Enter the federal EIC qualifying-child count."], stateSupport };
      }
    }

    if (input.wiUsedNewRetirementIncomeSubtraction === true) {
      const hasAnyWisconsinCredit =
        Number(input.wiNonrefundableCredits || 0) > 0 ||
        input.wiClaimedFederalEIC === true ||
        Number(input.wiOtherRefundableCredits || 0) > 0;
      if (hasAnyWisconsinCredit) {
        return { ok: false, code: "WI_NEW_RETIREMENT_SUBTRACTION_CREDIT_CONFLICT", errors: ["The new 2025 Wisconsin age-67 retirement-income subtraction cannot be claimed with Wisconsin tax credits on Form 1 Lines 13-20 or 30-35. Recheck Schedule SB and the credit entries before estimating."], stateSupport };
      }
    }

    if (input.wiHasOtherStateCreditOrReciprocity === true) {
      return { ok: false, code: "WI_OTHER_STATE_CREDIT_REVIEW_REQUIRED", errors: ["Wisconsin credit-for-tax-paid-to-another-state and reciprocity cases require the other jurisdiction's income/tax and source rules. This estimate is being held rather than guessing the credit or allocation."], stateSupport };
    }

    if (input.wiHasAmendedOrOtherSpecialItems === true) {
      return { ok: false, code: "WI_SPECIAL_ITEMS_REVIEW_REQUIRED", errors: ["This Wisconsin return includes an amended-return item or another material Wisconsin special situation that requires separate review rather than a guessed estimate."], stateSupport };
    }
  }

  if (input.stateCode === "MI" && Number(input.taxYear) === 2025) {
    if (input.miFullYearResident === null || input.miFullYearResident === undefined) {
      return {
        ok: false,
        code: "MI_RESIDENCY_SCREEN_REQUIRED",
        errors: ["Michigan needs confirmation that this is a full-year resident 2025 MI-1040 return."],
        stateSupport,
      };
    }

    if (input.miFullYearResident !== true) {
      return {
        ok: false,
        code: "MI_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED",
        errors: ["Michigan part-year residents and nonresidents require Schedule NR allocation. This estimate is being held rather than guessed."],
        stateSupport,
      };
    }

    if (input.filingStatus === "mfs") {
      if (!input.miMfsMichiganFilingChoice) {
        return {
          ok: false,
          code: "MI_MFS_FILING_CHOICE_REQUIRED",
          errors: ["Michigan allows spouses with separate federal returns to file either separate or joint Michigan returns. Select the Michigan filing choice."],
          stateSupport,
        };
      }
      if (input.miMfsMichiganFilingChoice !== "separate") {
        return {
          ok: false,
          code: "MI_MFS_JOINT_RETURN_REVIEW_REQUIRED",
          errors: ["A Michigan joint return after separate federal returns requires both spouses' federal AGI and Michigan adjustments. This estimate is being held rather than combining incomplete spouse information."],
          stateSupport,
        };
      }
    }

    for (const [field, label] of [
      ["miOtherAdditions", "Schedule 1 other additions"],
      ["miTaxableSocialSecurity", "taxable Social Security included in federal AGI"],
      ["miOtherSubtractions", "Schedule 1 other subtractions"],
      ["miSpecialExemptionCount", "special exemption count"],
      ["miQualifiedDisabledVeteranCount", "qualified disabled-veteran exemption count"],
      ["miStillbirthCount", "Certificate of Stillbirth exemption count"],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return {
          ok: false,
          code: "MI_REQUIRED_DETAIL_MISSING",
          errors: [`Enter the Michigan ${label}, including 0 when none applies.`],
          stateSupport,
        };
      }
    }

    if (input.canBeClaimedAsDependent === true && Number(input.numberOfDependents || 0) > 0) {
      return {
        ok: false,
        code: "MI_DEPENDENT_WITH_DEPENDENTS_REVIEW_REQUIRED",
        errors: ["A Michigan filer who is being claimed as another person's dependent uses the special $1,500 line 9e allowance. This return also lists dependents, so the dependency facts need review before estimating."],
        stateSupport,
      };
    }

    const peopleCount = (input.filingStatus === "mfj" ? 2 : 1) + Number(input.numberOfDependents || 0);
    if (Number(input.miSpecialExemptionCount || 0) > peopleCount) {
      return {
        ok: false,
        code: "MI_SPECIAL_EXEMPTION_COUNT_INVALID",
        errors: ["Michigan special exemptions cannot exceed the number of people represented on the return."],
        stateSupport,
      };
    }
    if (Number(input.miQualifiedDisabledVeteranCount || 0) > peopleCount) {
      return {
        ok: false,
        code: "MI_DISABLED_VETERAN_COUNT_INVALID",
        errors: ["Michigan qualified disabled-veteran exemptions cannot exceed the number of people represented on the return."],
        stateSupport,
      };
    }

    if (input.miClaimedFederalEIC === null || input.miClaimedFederalEIC === undefined) {
      return {
        ok: false,
        code: "MI_EITC_SCREEN_REQUIRED",
        errors: ["Michigan needs to know whether a federal Earned Income Tax Credit was claimed because the 2025 Michigan EITC equals 30% of the federal credit."],
        stateSupport,
      };
    }
    if (input.miClaimedFederalEIC === true && Number(input.miFederalEICAmount || 0) <= 0) {
      return {
        ok: false,
        code: "MI_FEDERAL_EITC_AMOUNT_REQUIRED",
        errors: ["Enter the federal Earned Income Tax Credit amount so the Michigan 30% refundable EITC can be calculated."],
        stateSupport,
      };
    }

    for (const [field, code, message] of [
      ["miHasRetirementPensionOrSeniorDeduction", "MI_RETIREMENT_SENIOR_SCREEN_REQUIRED", "Michigan needs to know whether a Form 4884 retirement/pension subtraction or Michigan standard/senior deduction applies."],
      ["miHasPA24DecouplingAdjustment", "MI_PA24_DECOUPLING_SCREEN_REQUIRED", "Michigan needs to know whether a 2025 PA 24 federal-decoupling business adjustment applies."],
      ["miHasOtherStateCreditOrAllocation", "MI_OTHER_STATE_REVIEW_SCREEN_REQUIRED", "Michigan needs to know whether an other-state credit, business apportionment, or other-state income allocation applies."],
      ["miHasDetroitCityReturn", "MI_DETROIT_CITY_SCREEN_REQUIRED", "Michigan needs to know whether a City of Detroit income-tax return applies."],
      ["miHasUseTax", "MI_USE_TAX_SCREEN_REQUIRED", "Michigan needs to know whether Michigan use tax is due."],
      ["miHasSeparateRefundableCredits", "MI_SEPARATE_REFUNDABLE_CREDIT_SCREEN_REQUIRED", "Michigan needs to know whether a Homestead Property Tax Credit, Home Heating Credit, Farmland Preservation Credit, or another separate refundable-credit claim applies."],
      ["miHasOtherSpecialItems", "MI_SPECIAL_ITEMS_SCREEN_REQUIRED", "Michigan needs one final screen for historic-preservation credits, organ-donation credit, flow-through entity credit, first-time-home-buyer penalties, voluntary contributions, amended-return items, and other material special cases."],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return { ok: false, code, errors: [message], stateSupport };
      }
    }

    if (input.miHasRetirementPensionOrSeniorDeduction === true) {
      return {
        ok: false,
        code: "MI_RETIREMENT_OR_SENIOR_DEDUCTION_REVIEW_REQUIRED",
        errors: ["Michigan Form 4884 retirement/pension and Michigan standard-or-senior deductions depend on birth year, benefit type, SSA-exempt employment, surviving-spouse facts, and worksheet comparisons. This estimate is being held rather than guessed."],
        stateSupport,
      };
    }
    if (input.miHasPA24DecouplingAdjustment === true) {
      return {
        ok: false,
        code: "MI_PA24_DECOUPLING_REVIEW_REQUIRED",
        errors: ["Michigan 2025 PA 24 federal-decoupling adjustments can require recomputing federal business-interest, depreciation, research/experimental-cost, Section 179, and related items for Michigan purposes. This estimate is being held rather than guessed."],
        stateSupport,
      };
    }
    if (input.miHasOtherStateCreditOrAllocation === true) {
      return {
        ok: false,
        code: "MI_OTHER_STATE_CREDIT_OR_ALLOCATION_REVIEW_REQUIRED",
        errors: ["Michigan other-state credits and business/income allocation can require separate limitation or apportionment calculations. This estimate is being held rather than guessed."],
        stateSupport,
      };
    }
    if (input.miHasDetroitCityReturn === true) {
      return {
        ok: false,
        code: "MI_DETROIT_CITY_RETURN_REVIEW_REQUIRED",
        errors: ["A Michigan city income-tax return is separate from the MI-1040 calculation. This estimate is being held so local income tax is not silently omitted."],
        stateSupport,
      };
    }
    if (input.miHasUseTax === true && Number(input.miUseTax || 0) <= 0) {
      return {
        ok: false,
        code: "MI_USE_TAX_AMOUNT_REQUIRED",
        errors: ["Enter the Michigan use-tax amount from the 2025 use-tax worksheet."],
        stateSupport,
      };
    }
    if (input.miHasSeparateRefundableCredits === true) {
      return {
        ok: false,
        code: "MI_SEPARATE_REFUNDABLE_CREDIT_REVIEW_REQUIRED",
        errors: ["Michigan Homestead Property Tax, Home Heating, Farmland Preservation, and other separate refundable credits require additional household/property/farm details. This estimate is being held rather than guessed."],
        stateSupport,
      };
    }
    if (input.miHasOtherSpecialItems === true) {
      return {
        ok: false,
        code: "MI_SPECIAL_ITEMS_REVIEW_REQUIRED",
        errors: ["This Michigan return has a material special credit, penalty, contribution, amended-return item, or other special schedule that requires review rather than a guessed estimate."],
        stateSupport,
      };
    }
  }

  if (input.stateCode === "WV" && Number(input.taxYear) === 2025) {
    if (
      input.wvFullYearResident === null ||
      input.wvFullYearResident === undefined
    ) {
      return {
        ok: false,
        code: "WV_RESIDENCY_SCREEN_REQUIRED",
        errors: [
          "West Virginia needs confirmation that this is a full-year resident 2025 IT-140 return."
        ],
        stateSupport,
      };
    }

    if (input.wvFullYearResident !== true) {
      return {
        ok: false,
        code: "WV_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED",
        errors: [
          "West Virginia part-year residents, nonresidents, and special nonresidents require Schedule A allocation or reciprocal-state rules. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    for (const [field, label] of [
      ["wvTotalAdditions", "Schedule M total additions"],
      ["wvOtherSubtractions", "Schedule M other subtractions"],
      ["wvTaxableSocialSecurity", "taxable Social Security included in federal AGI"],
      ["wvTaxExemptInterestForFamilyCredit", "tax-exempt interest used by the Family Tax Credit worksheet"],
    ]) {
      if (input[field] === null || input[field] === undefined) {
        return {
          ok: false,
          code: "WV_ADJUSTMENT_AMOUNT_REQUIRED",
          errors: [
            `Enter the West Virginia ${label}, including 0 when none applies.`
          ],
          stateSupport,
        };
      }
    }

    const federalAGI = Number(federal?.summary?.agi || 0);
    const lowIncomeThreshold = input.filingStatus === "mfs" ? 5000 : 10000;
    if (
      federalAGI <= lowIncomeThreshold &&
      (input.wvLowIncomeEarnedIncome === null || input.wvLowIncomeEarnedIncome === undefined)
    ) {
      return {
        ok: false,
        code: "WV_LOW_INCOME_EARNED_INCOME_REQUIRED",
        errors: [
          "West Virginia's low-income earned-income exclusion may apply. Enter the earned income from the official worksheet, including 0 if there was no earned income."
        ],
        stateSupport,
      };
    }

    if (
      input.canBeClaimedAsDependent === true &&
      Number(input.numberOfDependents || 0) > 0
    ) {
      return {
        ok: false,
        code: "WV_DEPENDENT_EXEMPTION_CONFLICT",
        errors: [
          "West Virginia does not allow a taxpayer who can be claimed as another person's dependent to claim dependents on the West Virginia return. Review the dependency entries before estimating."
        ],
        stateSupport,
      };
    }

    if (
      input.filingStatus === "mfj" &&
      (input.wvSpouseCanBeClaimedAsDependent === null || input.wvSpouseCanBeClaimedAsDependent === undefined)
    ) {
      return {
        ok: false,
        code: "WV_MFJ_SPOUSE_EXEMPTION_SCREEN_REQUIRED",
        errors: [
          "West Virginia needs to know whether your spouse can be claimed as a dependent by someone else before allowing the spouse exemption."
        ],
        stateSupport,
      };
    }

    if (
      input.filingStatus === "qw" &&
      (input.wvSurvivingSpouseExemption === null || input.wvSurvivingSpouseExemption === undefined)
    ) {
      return {
        ok: false,
        code: "WV_SURVIVING_SPOUSE_EXEMPTION_SCREEN_REQUIRED",
        errors: [
          "West Virginia needs to know whether the additional surviving-spouse exemption applies for one of the two tax years after the spouse's year of death."
        ],
        stateSupport,
      };
    }

    if (input.wvFederalAMT === null || input.wvFederalAMT === undefined) {
      return {
        ok: false,
        code: "WV_FAMILY_TAX_CREDIT_AMT_SCREEN_REQUIRED",
        errors: [
          "West Virginia needs to know whether federal alternative minimum tax applies because taxpayers who pay federal AMT cannot claim the Family Tax Credit."
        ],
        stateSupport,
      };
    }

    if (
      input.wvHasChildDependentCareCredit === null ||
      input.wvHasChildDependentCareCredit === undefined
    ) {
      return {
        ok: false,
        code: "WV_CHILD_CARE_SCREEN_REQUIRED",
        errors: [
          "West Virginia needs to know whether a federal Form 2441 Child and Dependent Care Credit was claimed."
        ],
        stateSupport,
      };
    }

    if (
      input.wvHasChildDependentCareCredit === true &&
      Number(input.wvFederalChildDependentCareCredit || 0) <= 0
    ) {
      return {
        ok: false,
        code: "WV_CHILD_CARE_AMOUNT_REQUIRED",
        errors: [
          "Enter the federal Form 2441 Child and Dependent Care Credit. West Virginia allows 50% of that federal credit."
        ],
        stateSupport,
      };
    }

    if (
      input.wvHasOtherStateTaxCredit === null ||
      input.wvHasOtherStateTaxCredit === undefined
    ) {
      return {
        ok: false,
        code: "WV_OTHER_STATE_CREDIT_SCREEN_REQUIRED",
        errors: [
          "West Virginia needs to know whether Schedule E credit for income tax paid to another state may apply."
        ],
        stateSupport,
      };
    }

    if (input.wvHasOtherStateTaxCredit === true) {
      return {
        ok: false,
        code: "WV_OTHER_STATE_CREDIT_REVIEW_REQUIRED",
        errors: [
          "West Virginia Schedule E requires the other state's income and tax details plus limitation calculations. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    if (input.wvHasUseTax === null || input.wvHasUseTax === undefined) {
      return {
        ok: false,
        code: "WV_USE_TAX_SCREEN_REQUIRED",
        errors: [
          "West Virginia needs to know whether purchaser's use tax is due on Schedule UT."
        ],
        stateSupport,
      };
    }

    if (input.wvHasUseTax === true && Number(input.wvUseTax || 0) <= 0) {
      return {
        ok: false,
        code: "WV_USE_TAX_AMOUNT_REQUIRED",
        errors: [
          "Enter the West Virginia purchaser's use tax amount from Schedule UT. The estimator will not guess the taxable purchase amount or local rate."
        ],
        stateSupport,
      };
    }

    if (
      input.wvHasOtherSpecialItems === null ||
      input.wvHasOtherSpecialItems === undefined
    ) {
      return {
        ok: false,
        code: "WV_SPECIAL_ITEMS_SCREEN_REQUIRED",
        errors: [
          "West Virginia needs one final screening question for other Tax Credit Recap credits, refundable property/adoption credits, underpayment penalty, amended-return items, donations, payment elections, and other material special items."
        ],
        stateSupport,
      };
    }

    if (input.wvHasOtherSpecialItems === true) {
      return {
        ok: false,
        code: "WV_SPECIAL_ITEMS_REVIEW_REQUIRED",
        errors: [
          "Your West Virginia return includes another credit, refundable property/adoption credit, penalty, donation/election, amended-return item, or special schedule that can materially change the result. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }
  }

  if (input.stateCode === "VA" && Number(input.taxYear) === 2025) {
    if (
      input.vaFullYearResident === null ||
      input.vaFullYearResident === undefined
    ) {
      return {
        ok: false,
        code: "VA_RESIDENCY_SCREEN_REQUIRED",
        errors: [
          "Virginia needs confirmation that this is a full-year resident 2025 Form 760 return."
        ],
        stateSupport,
      };
    }

    if (input.vaFullYearResident !== true) {
      return {
        ok: false,
        code: "VA_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED",
        errors: [
          "Virginia part-year residents generally use Form 760PY and nonresidents use Form 763. Mixed-residency returns can also require special filing-status treatment. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    const requiredVirginiaAmounts = [
      ["vaTotalAdditions", "Virginia Schedule ADJ total additions"],
      ["vaAgeDeduction", "Virginia Form 760 age deduction"],
      ["vaTaxableSocialSecurityTier1", "taxable Social Security and Tier 1 Railroad Retirement benefits"],
      ["vaStateIncomeTaxRefund", "state income tax refund or overpayment included in federal AGI"],
      ["vaOtherSubtractions", "Virginia Schedule ADJ other subtractions"],
      ["vaOtherDeductions", "Virginia Schedule ADJ other deductions"],
    ];
    for (const [field, label] of requiredVirginiaAmounts) {
      if (input[field] === null || input[field] === undefined) {
        return {
          ok: false,
          code: "VA_ADJUSTMENT_AMOUNT_REQUIRED",
          errors: [
            `Enter ${label}, including zero when none applies. Virginia starts with federal adjusted gross income and these state-specific lines cannot be guessed.`
          ],
          stateSupport,
        };
      }
    }

    if (
      input.vaFederalItemized === null ||
      input.vaFederalItemized === undefined
    ) {
      return {
        ok: false,
        code: "VA_DEDUCTION_METHOD_REQUIRED",
        errors: [
          "Virginia needs to know whether you itemized deductions on the federal return. Virginia generally requires the same standard-versus-itemized choice."
        ],
        stateSupport,
      };
    }

    if (
      input.vaFederalItemized === true &&
      (
        input.vaItemizedDeductions === null ||
        input.vaItemizedDeductions === undefined
      )
    ) {
      return {
        ok: false,
        code: "VA_ITEMIZED_DEDUCTION_REQUIRED",
        errors: [
          "Enter the 2025 Virginia Schedule A itemized-deduction amount. The estimator will not substitute federal itemized deductions because Virginia adjustments can differ."
        ],
        stateSupport,
      };
    }

    if (
      input.vaFederalItemized !== true &&
      input.canBeClaimedAsDependent === true &&
      (
        input.vaDependentEarnedIncome === null ||
        input.vaDependentEarnedIncome === undefined
      )
    ) {
      return {
        ok: false,
        code: "VA_DEPENDENT_EARNED_INCOME_REQUIRED",
        errors: [
          "Because you can be claimed as a dependent and are using the Virginia standard deduction, enter your earned income so the limited Virginia standard deduction can be applied."
        ],
        stateSupport,
      };
    }

    const maxExtraExemptionCount =
      input.filingStatus === "mfj" ? 2 : 1;
    if (
      input.vaAge65OrOlderCount === null ||
      input.vaAge65OrOlderCount === undefined ||
      input.vaBlindCount === null ||
      input.vaBlindCount === undefined
    ) {
      return {
        ok: false,
        code: "VA_ADDITIONAL_EXEMPTIONS_REQUIRED",
        errors: [
          "Enter the Virginia age-65-or-older exemption count and blind exemption count, including zero when none apply."
        ],
        stateSupport,
      };
    }

    if (
      Number(input.vaAge65OrOlderCount) > maxExtraExemptionCount ||
      Number(input.vaBlindCount) > maxExtraExemptionCount
    ) {
      return {
        ok: false,
        code: "VA_ADDITIONAL_EXEMPTIONS_INVALID",
        errors: [
          "The Virginia age/blind exemption count cannot exceed the number of taxpayers on this Virginia return."
        ],
        stateSupport,
      };
    }

    const maxAgeDeduction =
      input.filingStatus === "mfj" ? 24000 : 12000;
    if (Number(input.vaAgeDeduction || 0) > maxAgeDeduction) {
      return {
        ok: false,
        code: "VA_AGE_DEDUCTION_INVALID",
        errors: [
          `The Virginia age deduction entered exceeds the supported maximum of $${maxAgeDeduction.toLocaleString("en-US")} for this filing status.`
        ],
        stateSupport,
      };
    }

    if (input.filingStatus === "mfj") {
      if (
        input.vaSpouseTaxAdjustment === null ||
        input.vaSpouseTaxAdjustment === undefined
      ) {
        return {
          ok: false,
          code: "VA_SPOUSE_TAX_ADJUSTMENT_REQUIRED",
          errors: [
            "For a Married Filing Jointly Virginia return, enter the Spouse Tax Adjustment from the Virginia worksheet, including zero when it does not apply. The adjustment can be as much as $259."
          ],
          stateSupport,
        };
      }
    } else if (Number(input.vaSpouseTaxAdjustment || 0) !== 0) {
      return {
        ok: false,
        code: "VA_SPOUSE_TAX_ADJUSTMENT_FILING_STATUS_INVALID",
        errors: [
          "Virginia's Spouse Tax Adjustment is available only on Filing Status 2 (Married Filing Jointly)."
        ],
        stateSupport,
      };
    }

    if (
      !["none", "refundable_eitc", "nonrefundable_eitc", "low_income"]
        .includes(String(input.vaIncomeBasedCreditType || ""))
    ) {
      return {
        ok: false,
        code: "VA_INCOME_CREDIT_SCREEN_REQUIRED",
        errors: [
          "Select whether a 2025 Virginia low-income or earned-income credit applies."
        ],
        stateSupport,
      };
    }

    if (
      input.vaIncomeBasedCreditType !== "none" &&
      Number(input.vaIncomeBasedCreditAmount || 0) <= 0
    ) {
      return {
        ok: false,
        code: "VA_INCOME_CREDIT_AMOUNT_REQUIRED",
        errors: [
          "Enter the Virginia Schedule ADJ low-income/EITC credit amount. Eligibility can depend on family income and other return details, so the estimator will not guess the amount."
        ],
        stateSupport,
      };
    }

    if (
      input.vaIncomeBasedCreditType !== "none" &&
      Number(input.vaAgeDeduction || 0) > 0
    ) {
      return {
        ok: false,
        code: "VA_AGE_DEDUCTION_INCOME_CREDIT_CONFLICT",
        errors: [
          "Virginia does not allow the age deduction together with the Credit for Low-Income Individuals, Virginia Earned Income Credit, or refundable Virginia EITC. Review the Virginia choice before estimating."
        ],
        stateSupport,
      };
    }

    if (
      input.vaIncomeBasedCreditType === "low_income" &&
      (
        Number(input.vaAge65OrOlderCount || 0) > 0 ||
        Number(input.vaBlindCount || 0) > 0
      )
    ) {
      return {
        ok: false,
        code: "VA_LOW_INCOME_EXTRA_EXEMPTION_CONFLICT",
        errors: [
          "Virginia does not allow the Credit for Low-Income Individuals together with the additional age-65-or-older or blind exemptions. Review the Virginia return choice before estimating."
        ],
        stateSupport,
      };
    }

    if (
      input.vaHasOtherStateTaxCredit === null ||
      input.vaHasOtherStateTaxCredit === undefined
    ) {
      return {
        ok: false,
        code: "VA_OTHER_STATE_CREDIT_SCREEN_REQUIRED",
        errors: [
          "Virginia needs to know whether a credit for income tax paid to another state applies."
        ],
        stateSupport,
      };
    }

    if (input.vaHasOtherStateTaxCredit === true) {
      return {
        ok: false,
        code: "VA_OTHER_STATE_CREDIT_REVIEW_REQUIRED",
        errors: [
          "A Virginia credit for tax paid to another state requires Schedule OSC and the other state's return. This multi-state credit is being held for review rather than guessed from withholding."
        ],
        stateSupport,
      };
    }

    if (
      input.vaHasUseTax === null ||
      input.vaHasUseTax === undefined
    ) {
      return {
        ok: false,
        code: "VA_USE_TAX_SCREEN_REQUIRED",
        errors: [
          "Virginia needs to know whether Consumer's Use Tax is due on Form 760."
        ],
        stateSupport,
      };
    }

    if (
      input.vaHasUseTax === true &&
      Number(input.vaUseTax || 0) <= 0
    ) {
      return {
        ok: false,
        code: "VA_USE_TAX_AMOUNT_REQUIRED",
        errors: [
          "Enter the Virginia Consumer's Use Tax amount from the Virginia worksheet. The amount can depend on purchase type and local rate, so the estimator will not guess it."
        ],
        stateSupport,
      };
    }

    if (
      input.vaHasOtherSpecialItems === null ||
      input.vaHasOtherSpecialItems === undefined
    ) {
      return {
        ok: false,
        code: "VA_SPECIAL_ITEMS_SCREEN_REQUIRED",
        errors: [
          "Virginia needs one final screening question for Schedule CR credits, underpayment additions, penalties/interest, voluntary contributions, current-year overpayment elections, and other material Virginia-only items."
        ],
        stateSupport,
      };
    }

    if (input.vaHasOtherSpecialItems === true) {
      return {
        ok: false,
        code: "VA_SPECIAL_ITEMS_REVIEW_REQUIRED",
        errors: [
          "Your Virginia return includes another credit, penalty, contribution, payment election, or special schedule that can materially change the result. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }
  }

  if (input.stateCode === "SC") {
    if (
      input.scFullYearResident === null ||
      input.scFullYearResident === undefined
    ) {
      return {
        ok: false,
        code: "SC_RESIDENCY_SCREEN_REQUIRED",
        errors: [
          "South Carolina needs confirmation that this is a full-year resident 2025 SC1040 return."
        ],
        stateSupport,
      };
    }

    if (input.scFullYearResident !== true) {
      return {
        ok: false,
        code: "SC_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED",
        errors: [
          "South Carolina part-year/nonresident and mixed-residency returns can require Schedule NR, elections, and allocation. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    if (
      input.scTotalAdditions === null ||
      input.scTotalAdditions === undefined ||
      input.scOtherSubtractions === null ||
      input.scOtherSubtractions === undefined
    ) {
      return {
        ok: false,
        code: "SC_ADDITIONS_SUBTRACTIONS_REQUIRED",
        errors: [
          "Enter South Carolina SC1040 total additions and the requested other-subtractions total, including zero when none apply. South Carolina starts with federal taxable income but has state-specific additions and subtractions that cannot be guessed."
        ],
        stateSupport,
      };
    }

    if (Number(input.numberOfDependents || 0) > 0) {
      if (
        input.scDependentsUnder6 === null ||
        input.scDependentsUnder6 === undefined
      ) {
        return {
          ok: false,
          code: "SC_DEPENDENTS_UNDER6_REQUIRED",
          errors: [
            "South Carolina needs the number of federal dependents who were under age 6 on December 31, 2025. Enter 0 when none qualify."
          ],
          stateSupport,
        };
      }
      if (
        Number(input.scDependentsUnder6) < 0 ||
        Number(input.scDependentsUnder6) > Number(input.numberOfDependents || 0)
      ) {
        return {
          ok: false,
          code: "SC_DEPENDENTS_UNDER6_INVALID",
          errors: [
            "South Carolina dependents under age 6 cannot exceed the total Number of Dependents entered above."
          ],
          stateSupport,
        };
      }
    }

    if (
      input.scHasChildDependentCareCredit === null ||
      input.scHasChildDependentCareCredit === undefined
    ) {
      return {
        ok: false,
        code: "SC_CHILD_CARE_SCREEN_REQUIRED",
        errors: [
          "South Carolina needs to know whether the full-year resident Child and Dependent Care Credit applies."
        ],
        stateSupport,
      };
    }

    if (
      input.scHasChildDependentCareCredit === true &&
      input.filingStatus === "mfs"
    ) {
      return {
        ok: false,
        code: "SC_CHILD_CARE_MFS_REVIEW_REQUIRED",
        errors: [
          "The supported South Carolina child/dependent-care credit path does not apply to Married Filing Separately. This estimate is being held rather than claiming an ineligible credit."
        ],
        stateSupport,
      };
    }

    if (input.scHasChildDependentCareCredit === true) {
      if (
        input.scFederalChildCareExpense === null ||
        input.scFederalChildCareExpense === undefined ||
        input.scChildCareQualifyingPersons === null ||
        input.scChildCareQualifyingPersons === undefined
      ) {
        return {
          ok: false,
          code: "SC_CHILD_CARE_DETAILS_REQUIRED",
          errors: [
            "Enter the federal child/dependent-care expense used for the South Carolina credit and whether it covers one or two-or-more qualifying persons."
          ],
          stateSupport,
        };
      }
      if (![1, 2].includes(Number(input.scChildCareQualifyingPersons))) {
        return {
          ok: false,
          code: "SC_CHILD_CARE_PERSON_COUNT_INVALID",
          errors: [
            "South Carolina child/dependent-care qualifying persons must be entered as 1 or 2 (use 2 for two or more)."
          ],
          stateSupport,
        };
      }
    }

    if (
      input.filingStatus !== "mfj" &&
      input.scHasTwoWageEarnerCredit === true
    ) {
      return {
        ok: false,
        code: "SC_TWO_WAGE_EARNER_FILING_STATUS_INVALID",
        errors: [
          "South Carolina's Two Wage Earner Credit is available only to Married Filing Jointly returns. This estimate is being held rather than applying the credit to another filing status."
        ],
        stateSupport,
      };
    }

    if (input.filingStatus === "mfj") {
      if (
        input.scHasTwoWageEarnerCredit === null ||
        input.scHasTwoWageEarnerCredit === undefined
      ) {
        return {
          ok: false,
          code: "SC_TWO_WAGE_EARNER_SCREEN_REQUIRED",
          errors: [
            "South Carolina needs to know whether both spouses have South Carolina qualified earned income for the Two Wage Earner Credit."
          ],
          stateSupport,
        };
      }
      if (input.scHasTwoWageEarnerCredit === true) {
        if (
          input.scTaxpayerQualifiedEarnedIncome === null ||
          input.scTaxpayerQualifiedEarnedIncome === undefined ||
          input.scSpouseQualifiedEarnedIncome === null ||
          input.scSpouseQualifiedEarnedIncome === undefined
        ) {
          return {
            ok: false,
            code: "SC_TWO_WAGE_EARNER_DETAILS_REQUIRED",
            errors: [
              "Enter each spouse's South Carolina qualified earned income from the Two Wage Earner Credit worksheet."
            ],
            stateSupport,
          };
        }
        if (
          Number(input.scTaxpayerQualifiedEarnedIncome) <= 0 ||
          Number(input.scSpouseQualifiedEarnedIncome) <= 0
        ) {
          return {
            ok: false,
            code: "SC_TWO_WAGE_EARNER_INCOME_INVALID",
            errors: [
              "Both spouses must have positive South Carolina qualified earned income to claim the Two Wage Earner Credit."
            ],
            stateSupport,
          };
        }
      }
    }

    if (
      input.scClaimedFederalEIC === null ||
      input.scClaimedFederalEIC === undefined
    ) {
      return {
        ok: false,
        code: "SC_EIC_SCREEN_REQUIRED",
        errors: [
          "South Carolina needs to know whether you claimed the federal Earned Income Tax Credit because full-year residents may claim a nonrefundable South Carolina EITC."
        ],
        stateSupport,
      };
    }

    if (
      input.scClaimedFederalEIC === true &&
      (
        input.scFederalEICAmount === null ||
        input.scFederalEICAmount === undefined
      )
    ) {
      return {
        ok: false,
        code: "SC_FEDERAL_EIC_REQUIRED",
        errors: [
          "Enter the federal Earned Income Tax Credit allowed on the 2025 federal return so the South Carolina 125% nonrefundable EITC can be calculated."
        ],
        stateSupport,
      };
    }

    if (
      input.scHasOtherStateTaxCredit === null ||
      input.scHasOtherStateTaxCredit === undefined
    ) {
      return {
        ok: false,
        code: "SC_OTHER_STATE_CREDIT_SCREEN_REQUIRED",
        errors: [
          "South Carolina needs to know whether a credit for income taxes paid to another state applies."
        ],
        stateSupport,
      };
    }

    if (input.scHasOtherStateTaxCredit === true) {
      return {
        ok: false,
        code: "SC_OTHER_STATE_CREDIT_REVIEW_REQUIRED",
        errors: [
          "A South Carolina credit for taxes paid to another state requires other-state return and SC1040TC details. This estimate is being held rather than guessing a multi-state credit."
        ],
        stateSupport,
      };
    }

    if (
      input.scHasUseTax === null ||
      input.scHasUseTax === undefined
    ) {
      return {
        ok: false,
        code: "SC_USE_TAX_SCREEN_REQUIRED",
        errors: [
          "South Carolina needs to know whether SC1040 line 26 Use Tax is due."
        ],
        stateSupport,
      };
    }

    if (
      input.scHasUseTax === true &&
      (
        input.scUseTax === null ||
        input.scUseTax === undefined ||
        Number(input.scUseTax) <= 0
      )
    ) {
      return {
        ok: false,
        code: "SC_USE_TAX_AMOUNT_REQUIRED",
        errors: [
          "Enter the South Carolina Use Tax due from the SC Use Tax Worksheet. Use Tax depends on the applicable state and local rate, so the estimator will not guess the amount."
        ],
        stateSupport,
      };
    }

    if (
      input.scHasOtherSpecialItems === null ||
      input.scHasOtherSpecialItems === undefined
    ) {
      return {
        ok: false,
        code: "SC_SPECIAL_ITEMS_SCREEN_REQUIRED",
        errors: [
          "South Carolina needs one final screening question for other SC1040TC credits, refundable credits, active-business tax, lump-sum tax, catastrophe-account tax, special withholding, and other material state items."
        ],
        stateSupport,
      };
    }

    if (input.scHasOtherSpecialItems === true) {
      return {
        ok: false,
        code: "SC_SPECIAL_ITEMS_REVIEW_REQUIRED",
        errors: [
          "Your South Carolina return includes another state-specific credit, tax, payment, or special schedule that can materially change the result. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }
  }

  if (input.stateCode === "OK") {
    if (
      input.okFullYearResident === null ||
      input.okFullYearResident === undefined
    ) {
      return {
        ok: false,
        code: "OK_RESIDENCY_SCREEN_REQUIRED",
        errors: [
          "Oklahoma needs confirmation that this is a full-year resident 2025 Form 511 return."
        ],
        stateSupport,
      };
    }

    if (input.okFullYearResident !== true) {
      return {
        ok: false,
        code: "OK_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED",
        errors: [
          "Oklahoma part-year and nonresident returns use Form 511-NR and require Oklahoma-source/resident-period allocation. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    if (
      (input.filingStatus === "mfj" || input.filingStatus === "mfs") &&
      (
        input.okHasNonresidentSpouseAllocation === null ||
        input.okHasNonresidentSpouseAllocation === undefined
      )
    ) {
      return {
        ok: false,
        code: "OK_NONRESIDENT_SPOUSE_SCREEN_REQUIRED",
        errors: [
          "Oklahoma needs to know whether this married return involves a nonresident spouse or Form 574 allocation."
        ],
        stateSupport,
      };
    }

    if (input.okHasNonresidentSpouseAllocation === true) {
      return {
        ok: false,
        code: "OK_NONRESIDENT_SPOUSE_REVIEW_REQUIRED",
        errors: [
          "This Oklahoma return involves a nonresident-spouse/Form 574 allocation choice that can change filing status, income, and deductions. The estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    if (
      input.okHasOutOfStatePropertyBusinessIncome === null ||
      input.okHasOutOfStatePropertyBusinessIncome === undefined
    ) {
      return {
        ok: false,
        code: "OK_OUT_OF_STATE_INCOME_SCREEN_REQUIRED",
        errors: [
          "Oklahoma needs to know whether Form 511 line 4 contains out-of-state property or business income because Schedule 511-E can prorate deductions and exemptions."
        ],
        stateSupport,
      };
    }

    if (input.okHasOutOfStatePropertyBusinessIncome === true) {
      return {
        ok: false,
        code: "OK_SCHEDULE_511E_REVIEW_REQUIRED",
        errors: [
          "Your Oklahoma Form 511 includes line 4 out-of-state property/business income. Schedule 511-E must prorate deductions and exemptions, so this estimate is being held rather than guessing the allocation."
        ],
        stateSupport,
      };
    }

    if (
      input.okOklahomaAGI === null ||
      input.okOklahomaAGI === undefined ||
      input.okOklahomaIncomeAfterAdjustments === null ||
      input.okOklahomaIncomeAfterAdjustments === undefined
    ) {
      return {
        ok: false,
        code: "OK_LINE_7_9_REQUIRED",
        errors: [
          "Enter Oklahoma Form 511 line 7 Oklahoma adjusted gross income and line 9 Oklahoma income after adjustments so Oklahoma subtractions, additions, retirement exclusions, and Schedule 511-C adjustments are not guessed."
        ],
        stateSupport,
      };
    }

    if (
      Number(input.okOklahomaIncomeAfterAdjustments) >
      Number(input.okOklahomaAGI)
    ) {
      return {
        ok: false,
        code: "OK_LINE_9_EXCEEDS_LINE_7",
        errors: [
          "Oklahoma Form 511 line 9 income after adjustments cannot exceed line 7 Oklahoma adjusted gross income in this supported path. Review the Oklahoma entries before continuing."
        ],
        stateSupport,
      };
    }

    if (
      input.okFederalItemized === null ||
      input.okFederalItemized === undefined
    ) {
      return {
        ok: false,
        code: "OK_DEDUCTION_METHOD_REQUIRED",
        errors: [
          "Oklahoma needs to know whether you used the federal standard deduction or federal itemized deductions. Oklahoma requires the same deduction method."
        ],
        stateSupport,
      };
    }

    if (
      input.okFederalItemized === true &&
      (
        input.okItemizedDeductions === null ||
        input.okItemizedDeductions === undefined
      )
    ) {
      return {
        ok: false,
        code: "OK_ITEMIZED_DEDUCTION_REQUIRED",
        errors: [
          "Enter Oklahoma Schedule 511-D line 11 itemized deductions. Oklahoma itemized deductions have state-specific adjustments and limits that cannot be inferred safely from the current federal fields."
        ],
        stateSupport,
      };
    }

    if ([
      input.okRegularExemptions,
      input.okSpecial65Exemptions,
      input.okBlindExemptions,
      input.okQualifyingDependents,
    ].some((value) => value === null || value === undefined)) {
      return {
        ok: false,
        code: "OK_EXEMPTION_COUNTS_REQUIRED",
        errors: [
          "Enter the Oklahoma regular, age-65 special, blind, and dependent exemption counts shown for Form 511. Enter 0 when a category does not apply so exemptions are confirmed rather than assumed."
        ],
        stateSupport,
      };
    }

    if (
      input.okHasFederalChildOrCareCredit === null ||
      input.okHasFederalChildOrCareCredit === undefined
    ) {
      return {
        ok: false,
        code: "OK_CHILD_CREDIT_SCREEN_REQUIRED",
        errors: [
          "Oklahoma needs to know whether a federal child care credit or child tax credit applies because Form 511 may allow a related Oklahoma credit when Federal AGI is $100,000 or less."
        ],
        stateSupport,
      };
    }

    if (
      input.okHasFederalChildOrCareCredit === true &&
      Number(federal?.summary?.agi || 0) <= 100000 &&
      Number(federal?.summary?.agi || 0) <= 0
    ) {
      return {
        ok: false,
        code: "OK_CHILD_CREDIT_RATIO_REVIEW_REQUIRED",
        errors: [
          "Oklahoma Schedule 511-F requires an Oklahoma-AGI-to-Federal-AGI ratio, but Federal AGI is zero or negative. This credit needs manual review rather than a guessed ratio."
        ],
        stateSupport,
      };
    }

    if (
      input.okHasFederalChildOrCareCredit === true &&
      Number(federal?.summary?.agi || 0) <= 100000 &&
      Number(input.okFederalChildCareCredit || 0) <= 0 &&
      Number(input.okFederalChildTaxCreditTotal || 0) <= 0
    ) {
      return {
        ok: false,
        code: "OK_FEDERAL_CHILD_CREDIT_AMOUNTS_REQUIRED",
        errors: [
          "Enter the federal child care credit and/or total federal child tax credit (including additional child tax credit) used by Oklahoma Schedule 511-F. At least one amount must be greater than zero."
        ],
        stateSupport,
      };
    }

    if (
      input.okHasOklahomaEIC === null ||
      input.okHasOklahomaEIC === undefined
    ) {
      return {
        ok: false,
        code: "OK_EIC_SCREEN_REQUIRED",
        errors: [
          "Oklahoma needs to know whether the Oklahoma earned income credit applies. Oklahoma bases this credit on a federal EIC recalculated under 2020 federal-law requirements."
        ],
        stateSupport,
      };
    }

    if (
      input.okHasOklahomaEIC === true &&
      Number(federal?.summary?.agi || 0) <= 0
    ) {
      return {
        ok: false,
        code: "OK_EIC_RATIO_REVIEW_REQUIRED",
        errors: [
          "Oklahoma Schedule 511-G requires an Oklahoma-AGI-to-Federal-AGI ratio, but Federal AGI is zero or negative. This credit needs manual review rather than a guessed ratio."
        ],
        stateSupport,
      };
    }

    if (
      input.okHasOklahomaEIC === true &&
      Number(input.okFederalEIC2020Law || 0) <= 0
    ) {
      return {
        ok: false,
        code: "OK_EIC_2020_LAW_AMOUNT_REQUIRED",
        errors: [
          "Enter the federal earned income credit amount calculated under the Oklahoma Form 511-EIC 2020-law method. The estimator will then apply Oklahoma's 5% credit and required AGI proration."
        ],
        stateSupport,
      };
    }

    if (
      input.okHasOtherSpecialItems === null ||
      input.okHasOtherSpecialItems === undefined
    ) {
      return {
        ok: false,
        code: "OK_SPECIAL_ITEMS_SCREEN_REQUIRED",
        errors: [
          "Oklahoma needs one final screening question for Form 511-TX, Form 511-CR, property/sales-tax relief, Parental Choice credits, farm averaging, additional taxes/recapture, NOL/PTE items, and other material credits or payments."
        ],
        stateSupport,
      };
    }

    if (input.okHasOtherSpecialItems === true) {
      return {
        ok: false,
        code: "OK_SPECIAL_ITEMS_DETAIL_REQUIRED",
        errors: [
          "Your Oklahoma return includes a credit, additional tax, special payment, or other item that can materially change the result. This estimate is being held rather than guessed without the applicable Oklahoma schedule details."
        ],
        stateSupport,
      };
    }
  }

  if (input.stateCode === "AR") {
    if (
      input.arFullYearResident === null ||
      input.arFullYearResident === undefined
    ) {
      return {
        ok: false,
        code: "AR_RESIDENCY_SCREEN_REQUIRED",
        errors: [
          "Arkansas needs confirmation that this is a full-year resident 2025 AR1000F return."
        ],
        stateSupport,
      };
    }

    if (input.arFullYearResident !== true) {
      return {
        ok: false,
        code: "AR_PART_YEAR_OR_NONRESIDENT_REVIEW_REQUIRED",
        errors: [
          "Arkansas part-year and nonresident returns use AR1000NR and require Arkansas-source/resident-period income allocation. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    if (
      input.arArkansasTotalIncome === null ||
      input.arArkansasTotalIncome === undefined ||
      input.arArkansasAGI === null ||
      input.arArkansasAGI === undefined
    ) {
      return {
        ok: false,
        code: "AR_LINE_23_25_REQUIRED",
        errors: [
          "Enter Arkansas AR1000F Line 23 Total Income and Line 25 Arkansas Adjusted Gross Income so Arkansas-specific exclusions and adjustments are not guessed."
        ],
        stateSupport,
      };
    }

    if (
      Number(input.arArkansasAGI) >
      Number(input.arArkansasTotalIncome)
    ) {
      return {
        ok: false,
        code: "AR_AGI_EXCEEDS_TOTAL_INCOME",
        errors: [
          "Arkansas AR1000F Line 25 adjusted gross income cannot exceed Line 23 total income in this supported planning path. Review the Arkansas entries before continuing."
        ],
        stateSupport,
      };
    }

    if (input.filingStatus === "mfs") {
      if (
        input.arMfsSameReturn === null ||
        input.arMfsSameReturn === undefined
      ) {
        return {
          ok: false,
          code: "AR_MFS_RETURN_METHOD_REQUIRED",
          errors: [
            "Arkansas needs to know whether Married Filing Separately is being filed on the same Arkansas return or on separate returns."
          ],
          stateSupport,
        };
      }

      if (input.arMfsSameReturn === true) {
        return {
          ok: false,
          code: "AR_MFS_SAME_RETURN_REVIEW_REQUIRED",
          errors: [
            "Arkansas Married Filing Separately on the same return uses separate taxpayer/spouse income columns. This estimate does not yet collect the required split and is being held rather than guessed."
          ],
          stateSupport,
        };
      }

      if (
        input.arMfsSpouseItemizes === null ||
        input.arMfsSpouseItemizes === undefined
      ) {
        return {
          ok: false,
          code: "AR_MFS_SPOUSE_ITEMIZING_REQUIRED",
          errors: [
            "For an Arkansas separate MFS return, tell us whether your spouse itemizes deductions because that can require you to itemize as well."
          ],
          stateSupport,
        };
      }
    }

    if (input.filingStatus === "qw") {
      if (
        input.arSurvivingSpouseConfirmed === null ||
        input.arSurvivingSpouseConfirmed === undefined
      ) {
        return {
          ok: false,
          code: "AR_SURVIVING_SPOUSE_SCREEN_REQUIRED",
          errors: [
            "Arkansas needs confirmation that its Surviving Spouse requirements are met before using that filing status."
          ],
          stateSupport,
        };
      }

      if (input.arSurvivingSpouseConfirmed !== true) {
        return {
          ok: false,
          code: "AR_SURVIVING_SPOUSE_NOT_CONFIRMED",
          errors: [
            "The Arkansas Surviving Spouse requirements were not confirmed. This state estimate is being held for filing-status review."
          ],
          stateSupport,
        };
      }
    }

    if (
      input.arHasOtherSpecialItems === null ||
      input.arHasOtherSpecialItems === undefined
    ) {
      return {
        ok: false,
        code: "AR_SPECIAL_ITEMS_SCREEN_REQUIRED",
        errors: [
          "Arkansas needs one final screening question for state-only credits, additional taxes, other-state credits, NOL/PTE items, and other special schedules."
        ],
        stateSupport,
      };
    }

    if (input.arHasOtherSpecialItems === true) {
      return {
        ok: false,
        code: "AR_SPECIAL_ITEMS_DETAIL_REQUIRED",
        errors: [
          "Your Arkansas return includes a state-specific credit, additional tax, or special schedule that can materially change the result. This estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    // Arkansas publishes separate Low Income Tax Tables. Itemizers and MFS
    // taxpayers use the regular table, but other taxpayers within the low-income
    // ranges may need a table choice/exclusion review that the current inputs do
    // not safely resolve.
    const arLowIncomeUpperLimit =
      getArkansas2025LowIncomeUpperLimit(
        input.filingStatus,
        input.arQualifyingDependents
      );
    const arStandardDeduction =
      getArkansas2025StandardDeduction(input.filingStatus);
    const arUsesItemizedForRegularTable =
      input.filingStatus === "mfs"
        ? input.arMfsSpouseItemizes === true
        : Number(input.arItemizedDeductions || 0) > arStandardDeduction;

    if (
      arLowIncomeUpperLimit !== null &&
      Number(input.arArkansasTotalIncome) <= arLowIncomeUpperLimit &&
      !arUsesItemizedForRegularTable
    ) {
      return {
        ok: false,
        code: "AR_LOW_INCOME_TABLE_REVIEW_REQUIRED",
        errors: [
          "Your Arkansas income falls within a 2025 Low Income Tax Table range. Arkansas low-income tables and retirement/military exclusion choices can change the result, so this estimate is being held for that table review rather than using the regular table automatically."
        ],
        stateSupport,
      };
    }
  }

  if (input.stateCode === "LA") {
    if (
      input.laFullYearResident === null ||
      input.laFullYearResident === undefined
    ) {
      return {
        ok: false,
        code: "LA_RESIDENCY_SCREEN_REQUIRED",
        errors: [
          "Louisiana needs confirmation that you (and your spouse, if filing jointly) were full-year Louisiana residents for 2025."
        ],
        stateSupport,
      };
    }

    if (input.laFullYearResident !== true) {
      return {
        ok: false,
        code: "LA_PART_YEAR_OR_MULTISTATE_REVIEW_REQUIRED",
        errors: [
          "Louisiana part-year and nonresident returns use Form IT-540B and require Louisiana-source income allocation. This one-state resident estimate is being held rather than guessed."
        ],
        stateSupport,
      };
    }

    if (
      input.laFederalReturnRequired === null ||
      input.laFederalReturnRequired === undefined
    ) {
      return {
        ok: false,
        code: "LA_FEDERAL_RETURN_SCREEN_REQUIRED",
        errors: [
          "Louisiana needs to know whether you were required to file a 2025 federal income tax return because Form IT-540 sets Louisiana tax liability to zero when no federal return is required."
        ],
        stateSupport,
      };
    }

    if (input.laFederalReturnRequired === true) {
      if (
        input.laUsesScheduleE === null ||
        input.laUsesScheduleE === undefined
      ) {
        return {
          ok: false,
          code: "LA_SCHEDULE_E_SCREEN_REQUIRED",
          errors: [
            "Louisiana needs to know whether Schedule E adjustments apply before Louisiana adjusted gross income can be calculated."
          ],
          stateSupport,
        };
      }

      if (
        input.laUsesScheduleE === true &&
        (
          input.laScheduleEAdjustedGrossIncome === null ||
          input.laScheduleEAdjustedGrossIncome === undefined
        )
      ) {
        return {
          ok: false,
          code: "LA_SCHEDULE_E_AGI_REQUIRED",
          errors: [
            "Enter Louisiana Schedule E, line 5 adjusted gross income so the estimator does not guess at Louisiana-specific additions or exemptions."
          ],
          stateSupport,
        };
      }

      if (
        input.laFederalItemized === null ||
        input.laFederalItemized === undefined
      ) {
        return {
          ok: false,
          code: "LA_FEDERAL_ITEMIZED_SCREEN_REQUIRED",
          errors: [
            "Louisiana needs to know whether you itemized deductions on your 2025 federal return because Form IT-540 may allow an additional medical deduction."
          ],
          stateSupport,
        };
      }

      if (
        input.laFederalItemized === true &&
        (
          input.laFederalMedicalDentalDeduction === null ||
          input.laFederalMedicalDentalDeduction === undefined
        )
      ) {
        return {
          ok: false,
          code: "LA_MEDICAL_DEDUCTION_REQUIRED",
          errors: [
            "Enter Federal Schedule A, line 4 medical and dental deduction for the Louisiana 2025 excess-itemized-deduction calculation. Enter 0 if Schedule A line 4 is zero."
          ],
          stateSupport,
        };
      }

      if (
        input.laClaimedFederalEIC === null ||
        input.laClaimedFederalEIC === undefined
      ) {
        return {
          ok: false,
          code: "LA_EIC_SCREEN_REQUIRED",
          errors: [
            "Louisiana needs to know whether you claimed the federal Earned Income Credit because the 2025 Louisiana EIC equals 5% of the federal EIC."
          ],
          stateSupport,
        };
      }

      if (
        input.laClaimedFederalEIC === true &&
        (
          input.laFederalEICAmount === null ||
          input.laFederalEICAmount === undefined ||
          Number(input.laFederalEICAmount) <= 0
        )
      ) {
        return {
          ok: false,
          code: "LA_FEDERAL_EIC_AMOUNT_REQUIRED",
          errors: [
            "Enter the federal Earned Income Credit amount used on your 2025 federal return so the Louisiana 5% refundable EIC can be calculated exactly."
          ],
          stateSupport,
        };
      }
    }

    if (
      input.laHasOtherSpecialItems === null ||
      input.laHasOtherSpecialItems === undefined
    ) {
      return {
        ok: false,
        code: "LA_SPECIAL_ITEMS_SCREEN_REQUIRED",
        errors: [
          "Louisiana needs one final screening question for other state credits, child-care or school-readiness credits, use tax, electric/hybrid road-use fees, carryforwards, and other Louisiana-only items."
        ],
        stateSupport,
      };
    }

    if (input.laHasOtherSpecialItems === true) {
      return {
        ok: false,
        code: "LA_SPECIAL_ITEMS_DETAIL_REQUIRED",
        errors: [
          "Your Louisiana return includes a state-specific credit, tax, fee, carryforward, or other item that can materially change the result. This estimate is being held rather than guessing without the applicable Louisiana schedule details."
        ],
        stateSupport,
      };
    }
  }

  if (
    input.stateCode === "GA" &&
    Number(federal?.summary?.agi || 0) < 20000
  ) {
    return {
      ok: false,
      code: "GA_LOW_INCOME_CREDIT_REVIEW_REQUIRED",
      errors: [
        "Georgia's Low Income Credit can materially change a 2025 estimate when federal adjusted gross income is under $20,000. " +
        "This combination is being held for the next Georgia-specific credit step rather than showing a knowingly incomplete state number."
      ],
      stateSupport,
    };
  }

  if (
    input.stateCode === "GA" &&
    Number(input.otherIncome || 0) > 0 &&
    (
      Number(input.age || 0) >= 62 ||
      (
        input.filingStatus === "mfj" &&
        Number(input.spouseAge || 0) >= 62
      )
    )
  ) {
    return {
      ok: false,
      code: "GA_RETIREMENT_DETAIL_REQUIRED",
      errors: [
        "Georgia has a retirement-income exclusion for qualifying taxpayers age 62 or older. " +
        "Because Other Income was entered, additional Georgia retirement-income detail is required before a reliable state estimate can be shown."
      ],
      stateSupport,
    };
  }

  if (input.stateCode === "KY") {
    const federalAGI =
      Number(federal?.summary?.agi || 0);

    if (
      input.kyHasChildDependentCareCredit === null ||
      input.kyHasChildDependentCareCredit === undefined
    ) {
      return {
        ok: false,
        code: "KY_CHILD_CARE_SCREEN_REQUIRED",
        errors: [
          "Kentucky needs one additional question: whether you expect to claim a federal Child and Dependent Care Credit."
        ],
        stateSupport,
      };
    }

    if (input.kyHasChildDependentCareCredit === true) {
      return {
        ok: false,
        code: "KY_CHILD_CARE_DETAIL_REQUIRED",
        errors: [
          "Kentucky allows a credit equal to 20% of the federal Child and Dependent Care Credit. " +
          "The current estimator does not yet collect the Form 2441 details needed to calculate that credit accurately."
        ],
        stateSupport,
      };
    }

    if (
      input.kyHasOtherStateModifications === null ||
      input.kyHasOtherStateModifications === undefined
    ) {
      return {
        ok: false,
        code: "KY_MODIFICATION_SCREEN_REQUIRED",
        errors: [
          "Kentucky needs one additional question about state-specific income additions or subtractions."
        ],
        stateSupport,
      };
    }

    if (input.kyHasOtherStateModifications === true) {
      return {
        ok: false,
        code: "KY_STATE_MODIFICATION_DETAIL_REQUIRED",
        errors: [
          "Kentucky-specific additions or subtractions can change Kentucky adjusted gross income. " +
          "This estimate is being held rather than guessing without the Schedule M details."
        ],
        stateSupport,
      };
    }

    const taxpayerRetirement =
      Number(input.kyTaxpayerRetirementIncome || 0);
    const spouseRetirement =
      input.filingStatus === "mfj"
        ? Number(input.kySpouseRetirementIncome || 0)
        : 0;

    if (
      taxpayerRetirement > 31110 ||
      spouseRetirement > 31110
    ) {
      if (
        input.kySpecialPensionOverLimit === null ||
        input.kySpecialPensionOverLimit === undefined
      ) {
        return {
          ok: false,
          code: "KY_SPECIAL_PENSION_SCREEN_REQUIRED",
          errors: [
            "Kentucky needs to know whether retirement income above $31,110 is from federal, Kentucky state/local government service, or Tier 2 Railroad Retirement."
          ],
          stateSupport,
        };
      }

      if (input.kySpecialPensionOverLimit === true) {
        return {
          ok: false,
          code: "KY_SCHEDULE_P_DETAIL_REQUIRED",
          errors: [
            "This Kentucky retirement-income combination may qualify for an exclusion above $31,110 and requires Schedule P detail. " +
            "The estimator will not cap the exclusion and guess."
          ],
          stateSupport,
        };
      }
    }

    if (federalAGI <= 42760) {
      if (
        !Number.isInteger(Number(input.kyFamilySize)) ||
        Number(input.kyFamilySize) < 1 ||
        Number(input.kyFamilySize) > 4
      ) {
        return {
          ok: false,
          code: "KY_FAMILY_SIZE_REQUIRED",
          errors: [
            "Kentucky family size is required because your income may qualify for the 2025 Family Size Tax Credit."
          ],
          stateSupport,
        };
      }

      if (input.filingStatus === "mfs") {
        return {
          ok: false,
          code: "KY_MFS_FAMILY_SIZE_DETAIL_REQUIRED",
          errors: [
            "For a lower-income Kentucky Married Filing Separately estimate, spouse household/income information is needed to compute modified gross income for the Family Size Tax Credit."
          ],
          stateSupport,
        };
      }
    }
  }

  if (input.stateCode === "MS") {
    if (input.filingStatus === "qw") {
      return {
        ok: false,
        code: "MS_FILING_STATUS_REVIEW_REQUIRED",
        errors: [
          "Mississippi does not use the federal Qualifying Surviving Spouse label in the same way as this estimator. " +
          "A Mississippi filing-status review is required before calculating the state estimate."
        ],
        stateSupport,
      };
    }

    if (
      input.filingStatus === "hoh" &&
      (
        input.msHeadOfFamilyDependentLivedAllYear === null ||
        input.msHeadOfFamilyDependentLivedAllYear === undefined
      )
    ) {
      return {
        ok: false,
        code: "MS_HEAD_OF_FAMILY_SCREEN_REQUIRED",
        errors: [
          "Mississippi Head of Family needs confirmation that a qualifying dependent lived in your home for the entire year."
        ],
        stateSupport,
      };
    }

    if (
      input.filingStatus === "hoh" &&
      input.msHeadOfFamilyDependentLivedAllYear !== true
    ) {
      return {
        ok: false,
        code: "MS_HEAD_OF_FAMILY_NOT_CONFIRMED",
        errors: [
          "Mississippi Head of Family generally requires a qualifying dependent to live in your home for the entire year. " +
          "This state estimate is being held for filing-status review."
        ],
        stateSupport,
      };
    }

    if (
      input.msHasOtherStateModifications === null ||
      input.msHasOtherStateModifications === undefined
    ) {
      return {
        ok: false,
        code: "MS_MODIFICATION_SCREEN_REQUIRED",
        errors: [
          "Mississippi needs one additional question about state-specific income adjustments or credits."
        ],
        stateSupport,
      };
    }

    if (input.msHasOtherStateModifications === true) {
      return {
        ok: false,
        code: "MS_STATE_MODIFICATION_DETAIL_REQUIRED",
        errors: [
          "Mississippi-specific income adjustments or credits can materially change the state result. " +
          "This estimate is being held rather than guessing without those details."
        ],
        stateSupport,
      };
    }

    if (
      input.filingStatus === "mfj" &&
      (
        input.msSpouseShareOfMississippiAGI === null ||
        input.msSpouseShareOfMississippiAGI === undefined
      )
    ) {
      return {
        ok: false,
        code: "MS_MFJ_INCOME_SPLIT_REQUIRED",
        errors: [
          "Mississippi gives each spouse a separate $10,000 zero-rate band on a joint/combined return. " +
          "Enter the spouse's share of Mississippi adjusted gross income so the tax is not understated."
        ],
        stateSupport,
      };
    }

    const mississippiAGI =
      Math.max(
        0,
        Number(federal?.summary?.agi || 0) -
          Number(input.msExemptRetirementIncome || 0)
      );

    if (
      input.filingStatus === "mfj" &&
      Number(input.msSpouseShareOfMississippiAGI || 0) >
        mississippiAGI
    ) {
      return {
        ok: false,
        code: "MS_MFJ_INCOME_SPLIT_INVALID",
        errors: [
          "The spouse's share of Mississippi adjusted gross income cannot exceed total Mississippi adjusted gross income."
        ],
        stateSupport,
      };
    }

    if (
      input.msHasDependentCareCredit === true &&
      Number(federal?.summary?.agi || 0) <= 50000
    ) {
      return {
        ok: false,
        code: "MS_DEPENDENT_CARE_DETAIL_REQUIRED",
        errors: [
          "Mississippi may allow a dependent-care credit equal to 25% of the federal credit when federal AGI is $50,000 or less. " +
          "The estimator does not yet collect the Form 2441 details needed to calculate that credit accurately."
        ],
        stateSupport,
      };
    }
  }

  const state = calculateState(
    input,
    federal.summary.agi,
    federal.summary
  );

  const federalNet = federal?.summary?.net || 0;
  const stateNet = state?.summary?.net || 0;
  const combinedNet = federalNet + stateNet;

  const combined = {
    net: Math.round(combinedNet),
    isRefund: combinedNet > 0,
    isOwed: combinedNet < 0,
    isBreakEven: combinedNet === 0,
    refundAmount: combinedNet > 0 ? Math.round(combinedNet) : 0,
    owedAmount: combinedNet < 0 ? Math.round(Math.abs(combinedNet)) : 0,
    federalNet: Math.round(federalNet),
    stateNet: Math.round(stateNet),
  };

  const clientExperience = generateClientExperience(input, federal, state, combined);

  return {
    ok: true,
    result: {
      meta: {
        taxYear: input.taxYear,
        filingStatus: input.filingStatus,
        stateCode: input.stateCode,
        generatedAt: new Date().toISOString(),
      },
      federal: {
        summary: federal.summary,
      },
      state: {
        summary: state.summary,
        canEstimate: state.canEstimate,
        hasIncomeTax: state.hasIncomeTax,
        stateName: state.stateName,
      },
      combined,
      clientExperience,
    },
  };
}

module.exports = { estimate };


