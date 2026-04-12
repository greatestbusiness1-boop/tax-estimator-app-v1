/**
 * clientExperienceEngine.js
 * Greatest Business Solution LLC — Tax Estimator
 *
 * Transforms raw calculation results into plain-English explanations,
 * contextual insights, and personalized recommendations.
 *
 * This engine never calculates tax. It only reads results and produces
 * client-facing content designed to educate, build trust, and convert
 * users into paying tax preparation clients.
 *
 * Usage:
 *   const { generateClientExperience } = require('./engines/clientExperienceEngine');
 *   const cx = generateClientExperience(input, federal, state, combined);
 *
 * Output shape:
 *   {
 *     headline,
 *     summary,
 *     keyDrivers,
 *     whatCouldChange,
 *     recommendations,
 *     disclaimer,
 *     cta
 *   }
 */

"use strict";

// =============================================================================
// CONSTANTS
// =============================================================================

const FILING_STATUS_LABELS = {
  single: "Single",
  mfj:    "Married Filing Jointly",
  mfs:    "Married Filing Separately",
  hoh:    "Head of Household",
  qw:     "Qualifying Widow(er)",
};

const CTA_PRIMARY   = "Have a Tax Professional Review My Return";
const CTA_SECONDARY = "Schedule a Free Consultation with Greatest Business Solution LLC";
const CTA_URGENT    = "Speak with a Tax Professional Before You File";

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format a number as a US dollar amount with no decimal places.
 * Always uses the absolute value — sign is handled by context.
 */
function fmt(amount) {
  return new Intl.NumberFormat("en-US", {
    style:                 "currency",
    currency:              "USD",
    maximumFractionDigits: 0,
  }).format(Math.abs(amount || 0));
}

/**
 * Format a decimal rate as a percentage string.
 */
function fmtPct(rate) {
  return `${Math.round((rate || 0) * 100)}%`;
}

/**
 * Return "1 dependent" or "2 dependents" correctly.
 */
function depWord(n) {
  return n === 1 ? "1 dependent" : `${n} dependents`;
}

/**
 * Return a short signed dollar label like "+$1,200" or "-$450".
 */
function signedFmt(amount) {
  if (amount > 0) return `+${fmt(amount)}`;
  if (amount < 0) return `−${fmt(amount)}`;
  return "$0";
}

// =============================================================================
// SECTION 1 — HEADLINE
//
// A single short statement the user sees first.
// Tone: direct, clear, never alarming.
// =============================================================================

function buildHeadline(combined) {
  const { net, isRefund, isOwed, refundAmount, owedAmount } = combined;

  if (isRefund && refundAmount >= 1000) {
    return {
      type:    "refund",
      text:    `You may be on track for a ${fmt(refundAmount)} refund.`,
      tone:    "positive",
    };
  }

  if (isRefund && refundAmount > 0) {
    return {
      type:    "small_refund",
      text:    `You may receive a small refund of ${fmt(refundAmount)}.`,
      tone:    "neutral",
    };
  }

  if (isOwed && owedAmount >= 1000) {
    return {
      type:    "owe",
      text:    `You may owe ${fmt(owedAmount)} when you file.`,
      tone:    "caution",
    };
  }

  if (isOwed && owedAmount > 0) {
    return {
      type:    "small_owe",
      text:    `You may owe a small balance of ${fmt(owedAmount)} when you file.`,
      tone:    "caution",
    };
  }

  return {
    type:    "breakeven",
    text:    "You appear to be close to break-even this year.",
    tone:    "neutral",
  };
}

// =============================================================================
// SECTION 2 — SUMMARY EXPLANATION
//
// 3–5 plain-English sentences explaining what the numbers mean.
// Personalized based on filing situation.
// =============================================================================

function buildSummary(input, federal, state, combined) {
  const fs      = FILING_STATUS_LABELS[input.filingStatus] || input.filingStatus;
  const fed     = federal.summary;
  const st      = state.summary;
  const deps    = input.numberOfDependents || 0;
  const lines   = [];

  // Opening — what we looked at
  lines.push(
    `Based on your ${input.taxYear} tax information as a ${fs} filer in ${state.stateName}, ` +
    `we estimated your tax picture using ${fmt(fed.grossIncome)} in total income ` +
    `and a ${fmt(fed.standardDeduction)} standard deduction.`
  );

  // Federal result explanation
  if (fed.isRefund) {
    lines.push(
      `Your employer withheld more federal income tax than you likely owe, ` +
      `which is why you may receive a federal refund of ${fmt(fed.refundAmount)}. ` +
      `The IRS will send this to you after your return is filed and processed.`
    );
  } else if (fed.isOwed) {
    lines.push(
      `Your federal withholding appears to be less than your estimated tax liability. ` +
      `This means you may owe ${fmt(fed.owedAmount)} to the IRS when you file. ` +
      `This is common when income comes from multiple sources or when withholding ` +
      `was not adjusted after a life change.`
    );
  } else {
    lines.push(
      `Your federal withholding appears to closely match your estimated federal tax liability, ` +
      `putting you near break-even.`
    );
  }

  // State result explanation — only when state has income tax
  if (state.hasIncomeTax && state.canEstimate) {
    if (st.isRefund) {
      lines.push(
        `On the state side, ${state.stateName} also withheld more than your estimated ` +
        `state tax liability, resulting in an estimated state refund of ${fmt(st.refundAmount)}.`
      );
    } else if (st.isOwed) {
      lines.push(
        `Your state withholding for ${state.stateName} appears lower than your estimated ` +
        `state tax, so you may owe ${fmt(st.owedAmount)} to the state when you file.`
      );
    } else {
      lines.push(
        `Your ${state.stateName} withholding closely matches your estimated state tax liability.`
      );
    }
  } else if (!state.hasIncomeTax) {
    lines.push(
      `${state.stateName} has no state income tax, so there is no state return to file ` +
      `and no state liability to estimate. Any state taxes withheld from your paycheck ` +
      `may be returned to you automatically.`
    );
  } else if (!state.canEstimate) {
    lines.push(
      `We were not able to estimate your ${state.stateName} state tax with the information ` +
      `provided. A tax professional can calculate your state liability accurately.`
    );
  }

  // Advisory when federal and state go in opposite directions
  if (fed.isRefund && st.isOwed) {
    lines.push(
      `Keep in mind that your federal refund and your state balance due are separate. ` +
      `You will still need to pay ${state.stateName} ${fmt(st.owedAmount)} by the filing deadline, ` +
      `even while waiting for your federal refund to arrive.`
    );
  }

  if (fed.isOwed && st.isRefund) {
    lines.push(
      `Your state refund of ${fmt(st.refundAmount)} and your federal balance of ` +
      `${fmt(fed.owedAmount)} are separate payments. The state refund will not automatically ` +
      `offset what you owe the IRS.`
    );
  }

  // Low income note
  if (fed.grossIncome > 0 && fed.grossIncome < 20000) {
    lines.push(
      `At your income level, you may qualify for additional credits such as the ` +
      `Earned Income Tax Credit that could increase your refund significantly. ` +
      `A tax professional can confirm your eligibility.`
    );
  }

  return { paragraphs: lines };
}

// =============================================================================
// SECTION 3 — KEY DRIVERS
//
// Short labeled cards explaining the main factors that shaped the estimate.
// Each driver has a label, value, and plain-English explanation.
// =============================================================================

function buildKeyDrivers(input, federal, state) {
  const fed  = federal.summary;
  const deps = input.numberOfDependents || 0;
  const drivers = [];

  // Standard deduction
  drivers.push({
    label:       "Standard Deduction",
    value:       fmt(fed.standardDeduction),
    explanation: fed.isDependentAdjusted
      ? `Because you can be claimed as someone else's dependent, your standard deduction ` +
        `is limited to ${fmt(fed.standardDeduction)} instead of the full amount.`
      : `You reduced your taxable income by ${fmt(fed.standardDeduction)} using the ` +
        `standard deduction for your filing status. This is the simplest and most ` +
        `common deduction method.`,
  });

  // Taxable income
  drivers.push({
    label:       "Taxable Income",
    value:       fmt(fed.taxableIncome),
    explanation: `After your deduction, ${fmt(fed.taxableIncome)} of your income is ` +
                 `subject to federal income tax. Your tax is calculated on this amount, ` +
                 `not your full earnings.`,
  });

  // Marginal rate
  if (fed.marginalRate > 0) {
    drivers.push({
      label:       "Marginal Tax Rate",
      value:       fmtPct(fed.marginalRate),
      explanation: `Your highest tax bracket is ${fmtPct(fed.marginalRate)}. This rate ` +
                   `only applies to the portion of your income that falls within that ` +
                   `bracket — lower income is taxed at lower rates.`,
    });
  }

  // Education credit
  if (fed.educationCredit > 0) {
    drivers.push({
      label:       "Education Credit",
      value:       fmt(fed.educationCredit),
      explanation: input.isFullTimeStudent
        ? `As a full-time student, you may qualify for the American Opportunity Credit, ` +
          `which reduced your estimated tax by ${fmt(fed.educationCredit)}. ` +
          `Up to 40% of this credit is refundable, meaning it can increase your refund ` +
          `even if you owe little or no tax.`
        : `Your qualified education expenses may qualify you for the Lifetime Learning ` +
          `Credit, which reduced your estimated tax by ${fmt(fed.educationCredit)}.`,
    });
  }

  // Child Tax Credit
  if (fed.childTaxCredit > 0) {
    drivers.push({
      label:       "Child Tax Credit",
      value:       fmt(fed.childTaxCredit),
      explanation: `With ${depWord(deps)}, you may qualify for the Child Tax Credit, ` +
                   `which reduced your estimated tax by ${fmt(fed.childTaxCredit)}. ` +
                   `A portion of this credit may be refundable even if your tax is zero.`,
    });
  }

  // Federal withholding
  drivers.push({
    label:       "Federal Tax Withheld",
    value:       fmt(fed.federalWithheld),
    explanation: `Your employer sent ${fmt(fed.federalWithheld)} to the IRS on your behalf ` +
                 `throughout the year. This is compared to your actual estimated tax ` +
                 `liability to determine whether you get a refund or owe a balance.`,
  });

  // State type note
  if (!state.hasIncomeTax) {
    drivers.push({
      label:       `${state.stateName} — No State Income Tax`,
      value:       "$0",
      explanation: `${state.stateName} does not impose a state income tax, so your ` +
                   `state tax liability is zero. This is one less return to file.`,
    });
  } else if (state.canEstimate && state.summary.stateTax !== null) {
    drivers.push({
      label:       `${state.stateName} State Tax`,
      value:       fmt(state.summary.stateTax),
      explanation: `Based on your income and ${state.stateName}'s tax structure, your ` +
                   `estimated state tax liability is ${fmt(state.summary.stateTax)}. ` +
                   `State tax rates and deductions vary significantly from federal rules.`,
    });
  }

  // Student impact
  if (input.isFullTimeStudent) {
    drivers.push({
      label:       "Full-Time Student Status",
      value:       "Applies",
      explanation: `Your full-time student status may qualify you for education credits ` +
                   `not available to other filers. The type and amount of credit depends ` +
                   `on your income, year in school, and expenses paid.`,
    });
  }

  // Dependent status impact
  if (input.canBeClaimedAsDependent) {
    drivers.push({
      label:       "Claimed as Dependent",
      value:       "Applies",
      explanation: `Because another taxpayer can claim you as a dependent, your standard ` +
                   `deduction is limited and you are not eligible to claim the Child Tax ` +
                   `Credit or certain other credits for yourself.`,
    });
  }

  return { drivers };
}

// =============================================================================
// SECTION 4 — WHAT COULD CHANGE
//
// Factors that could make the actual return different from this estimate.
// Personalized to the filer's situation.
// =============================================================================

function buildWhatCouldChange(input, federal, state) {
  const fed     = federal.summary;
  const deps    = input.numberOfDependents || 0;
  const factors = [];

  // Universal factors
  factors.push({
    label:  "Income not included in this estimate",
    detail: "Freelance or gig income, rental income, investment gains or losses, " +
            "alimony received, gambling winnings, or retirement distributions not captured " +
            "here could increase your tax liability and reduce your refund.",
    impact: "negative",
  });

  factors.push({
    label:  "Itemized deductions",
    detail: `If your mortgage interest, charitable contributions, and state and local ` +
            `taxes paid exceed ${fmt(fed.standardDeduction)}, itemizing could reduce ` +
            `your taxable income and increase your refund compared to this estimate.`,
    impact: "positive",
  });

  // Student-specific
  if (input.isFullTimeStudent) {
    factors.push({
      label:  "Year in school and AOC eligibility",
      detail: "The American Opportunity Credit is available only for the first four years " +
              "of post-secondary education. If you are in your fifth year or beyond, a " +
              "different credit may apply and the amount could be lower.",
      impact: "neutral",
    });
  }

  // Education expenses
  if ((input.educationExpenses || 0) > 0) {
    factors.push({
      label:  "Education credit income limits",
      detail: "Education credits phase out at higher income levels. If your income is " +
              "close to the phase-out range, the actual credit may be smaller than shown here.",
      impact: "neutral",
    });
  }

  // Scholarship taxability
  if ((input.scholarships || 0) > (input.educationExpenses || 0)) {
    const taxable = (input.scholarships || 0) - (input.educationExpenses || 0);
    factors.push({
      label:  "Taxable scholarship income",
      detail: `Your scholarships exceeded your qualified education expenses by ${fmt(taxable)}. ` +
              `This amount was included as taxable income in this estimate. If your actual ` +
              `qualified expenses are higher, your taxable scholarship income could be lower.`,
      impact: "positive",
    });
  }

  // Dependent-related
  if (deps > 0) {
    factors.push({
      label:  "Earned Income Tax Credit (EITC)",
      detail: `With ${depWord(deps)} and income below certain thresholds, you may qualify ` +
              `for the Earned Income Tax Credit — one of the most valuable credits available ` +
              `to working families. This estimate does not include EITC. A tax professional ` +
              `can determine your eligibility.`,
      impact: "positive",
    });

    factors.push({
      label:  "Child and Dependent Care Credit",
      detail: "If you paid for childcare so you could work or look for work, you may " +
              "qualify for this additional credit, which was not included in this estimate.",
      impact: "positive",
    });
  }

  // Self-employment / other income
  if ((input.otherIncome || 0) > 2000) {
    factors.push({
      label:  "Self-employment tax on other income",
      detail: `If any of your ${fmt(input.otherIncome)} in other income came from ` +
              `freelance, contract, or self-employment work, you may owe self-employment ` +
              `tax of up to 15.3% on that amount — in addition to regular income tax. ` +
              `This could significantly reduce your refund or increase what you owe.`,
      impact: "negative",
    });
  }

  // High marginal rate — retirement opportunity
  if (fed.marginalRate >= 0.22) {
    factors.push({
      label:  "Retirement contribution deductions",
      detail: `At your income level, contributing to a traditional IRA or 401(k) before ` +
              `the deadline reduces your taxable income dollar for dollar. This could ` +
              `lower your tax bill and increase your refund.`,
      impact: "positive",
    });
  }

  // Mixed federal/state result
  if (federal.summary.isRefund && state.summary.isOwed) {
    factors.push({
      label:  `${state.stateName} balance due`,
      detail: `Your estimated state balance of ${fmt(state.summary.owedAmount)} is due ` +
              `by the filing deadline regardless of your federal refund. Planning ahead ` +
              `to cover this amount can prevent penalties and interest.`,
      impact: "negative",
    });
  }

  // Life events
  factors.push({
    label:  "Major life events",
    detail: "Marriage, divorce, a new child, buying or selling a home, starting or closing " +
            "a business, or receiving an inheritance can each significantly affect your " +
            "return in ways this estimate cannot fully capture.",
    impact: "neutral",
  });

  // W-4 adjustment
  if (federal.summary.isRefund && federal.summary.refundAmount > 2500) {
    factors.push({
      label:  "Withholding adjustment opportunity",
      detail: `A large refund means your employer is withholding more than necessary ` +
              `each paycheck. Updating your W-4 could give you an extra ` +
              `${fmt(Math.round(federal.summary.refundAmount / 12))} per month in ` +
              `take-home pay rather than waiting for a refund next year.`,
      impact: "positive",
    });
  }

  return { factors };
}

// =============================================================================
// SECTION 5 — RECOMMENDATIONS
//
// Personalized, prioritized, actionable suggestions.
// =============================================================================

function buildRecommendations(input, federal, state, combined) {
  const fed   = federal.summary;
  const st    = state.summary;
  const deps  = input.numberOfDependents || 0;
  const recs  = [];

  // Owe a significant amount — most urgent
  if (combined.isOwed && combined.owedAmount >= 500) {
    recs.push({
      priority: "high",
      title:    "Plan for your balance due before the deadline",
      body:     `You may owe ${fmt(combined.owedAmount)} when you file. ` +
                `Returns and payments are due by April 15. If you file late or pay late, ` +
                `the IRS and your state may charge interest and penalties. A tax professional ` +
                `can help you file on time and identify whether a payment plan is available.`,
    });
  }

  // Large federal owe — W-4 fix
  if (fed.isOwed && fed.owedAmount >= 500) {
    recs.push({
      priority: "high",
      title:    "Adjust your federal withholding to avoid owing again next year",
      body:     `Owing ${fmt(fed.owedAmount)} this year suggests your W-4 withholding is ` +
                `set too low. Updating your W-4 with your employer increases the amount ` +
                `withheld each paycheck, reducing or eliminating next year's balance due. ` +
                `A tax professional can calculate the right withholding amount for your situation.`,
    });
  }

  // Large refund — over-withholding
  if (fed.isRefund && fed.refundAmount > 2000) {
    recs.push({
      priority: "medium",
      title:    "Consider adjusting your W-4 to keep more money each month",
      body:     `A refund of ${fmt(fed.refundAmount)} means you gave the government an ` +
                `interest-free loan throughout the year. Adjusting your W-4 to reduce ` +
                `withholding could put an estimated ${fmt(Math.round(fed.refundAmount / 12))} ` +
                `more in your paycheck each month. A tax professional can help you find ` +
                `the right balance.`,
    });
  }

  // State owed but federal refund — cash flow warning
  if (fed.isRefund && st.isOwed && state.canEstimate) {
    recs.push({
      priority: "high",
      title:    `Set aside funds for your ${state.stateName} state tax balance`,
      body:     `Your federal refund and your ${state.stateName} balance of ` +
                `${fmt(st.owedAmount)} are separate. Federal refunds take 2–4 weeks ` +
                `to arrive after filing, but your state payment is due on the same deadline. ` +
                `We recommend setting aside ${fmt(st.owedAmount)} now to avoid a late payment.`,
    });
  }

  // Student — education credit follow-up
  if (input.isFullTimeStudent) {
    recs.push({
      priority: "medium",
      title:    "Confirm your education credit eligibility with a professional",
      body:     `As a full-time student, you may qualify for education tax credits worth ` +
                `up to $2,500 per year. The rules around which credit applies, whether ` +
                `it's refundable, and how your scholarship income interacts with it are ` +
                `complex. A tax professional can make sure you receive the maximum credit.`,
    });
  }

  // Dependents — EITC and CTC
  if (deps > 0) {
    recs.push({
      priority: "medium",
      title:    "Have a professional check for the Earned Income Tax Credit",
      body:     `With ${depWord(deps)}, you may qualify for the Earned Income Tax Credit — ` +
                `a refundable credit that can be worth several thousand dollars depending ` +
                `on your income and family size. EITC eligibility rules are detailed and ` +
                `easy to get wrong. A tax professional can confirm and apply it correctly.`,
    });
  }

  // Low income — additional credits available
  if (fed.grossIncome > 0 && fed.grossIncome < 25000) {
    recs.push({
      priority: "medium",
      title:    "You may qualify for credits that significantly increase your refund",
      body:     `At your income level, you may qualify for the Earned Income Tax Credit, ` +
                `the Saver's Credit, and possibly state-level low-income credits that ` +
                `were not captured in this estimate. Many low-income filers receive a ` +
                `refund larger than the taxes they paid. A tax professional can identify ` +
                `every credit you are entitled to.`,
    });
  }

  // Cannot estimate state
  if (!state.canEstimate) {
    recs.push({
      priority: "medium",
      title:    `Get a ${state.stateName} state tax estimate from a professional`,
      body:     `We were not able to estimate your ${state.stateName} state tax with this ` +
                `tool. A licensed tax professional can calculate your state liability ` +
                `accurately and ensure your state return is filed correctly and on time.`,
    });
  }

  // Other income — self-employment risk
  if ((input.otherIncome || 0) > 2000) {
    recs.push({
      priority: "medium",
      title:    "Review your self-employment or other income with a professional",
      body:     `Other income such as freelance, contract, or gig work carries additional ` +
                `tax obligations — including self-employment tax — that this estimate may ` +
                `not fully reflect. A professional can calculate your true liability and ` +
                `identify deductions specific to self-employed filers.`,
    });
  }

  // Universal recommendation — always included last
  recs.push({
    priority: "standard",
    title:    "Have a licensed tax professional review your complete return",
    body:     `This estimate is based on a limited set of inputs and is intended for ` +
              `educational purposes only. A tax professional at Greatest Business Solution LLC ` +
              `can review your complete financial picture, apply every deduction and credit ` +
              `you are entitled to, ensure accuracy, and file on your behalf — giving you ` +
              `confidence that your taxes are done right.`,
  });

  return { recommendations: recs };
}

// =============================================================================
// SECTION 6 — CONFIDENCE LEVEL
//
// Scores the reliability of this estimate based on input complexity.
// =============================================================================

function buildConfidence(input, federal, state) {
  let score = 100;
  const flags = [];

  if (!state.canEstimate) {
    score -= 25;
    flags.push("State tax could not be estimated for this state.");
  }

  if ((input.otherIncome || 0) > 0) {
    score -= 10;
    flags.push("Other income adds complexity not fully modeled here.");
  }

  if ((input.scholarships || 0) > 0) {
    score -= 5;
    flags.push("Scholarship income taxability depends on expense details.");
  }

  if (input.canBeClaimedAsDependent) {
    score -= 5;
    flags.push("Dependent filer deduction rules applied.");
  }

  if ((input.numberOfDependents || 0) > 0) {
    score -= 5;
    flags.push("Dependent credits may vary based on eligibility details.");
  }

  if ((input.educationExpenses || 0) > 0) {
    score -= 5;
    flags.push("Education credit eligibility requires professional verification.");
  }

  let label, description;

  if      (score >= 90) {
    label       = "High";
    description = "Your inputs were complete and straightforward. This estimate is likely close to your actual return.";
  } else if (score >= 75) {
    label       = "Good";
    description = "This is a solid approximation. A few factors could shift the final number.";
  } else if (score >= 55) {
    label       = "Moderate";
    description = "Several factors in your situation add complexity. A professional review is strongly recommended.";
  } else {
    label       = "Low";
    description = "Your situation has significant complexity this tool cannot fully model. Please consult a tax professional.";
  }

  return { score, label, description, flags };
}

// =============================================================================
// SECTION 7 — DISCLAIMER
// =============================================================================

function buildDisclaimer() {
  return [
    "This estimate is for educational and informational purposes only and does not constitute tax advice.",
    "Results are based solely on user-provided inputs and general tax parameters for the selected year.",
    "Actual refund or amount owed may differ based on factors not captured in this tool.",
    "Greatest Business Solution LLC is not responsible for discrepancies between this estimate and your actual tax return.",
    "Do not make financial decisions based solely on this estimate.",
    "Consult a licensed tax professional before filing your return.",
  ];
}

// =============================================================================
// SECTION 8 — CTA
// =============================================================================

function buildCTA(combined, state) {
  // Choose urgency level
  const isUrgent = combined.isOwed && combined.owedAmount >= 500;
  const hasMixedResult = (
    combined.federalNet > 0 && combined.stateNet < 0 && state.canEstimate
  ) || (
    combined.federalNet < 0 && combined.stateNet > 0 && state.canEstimate
  );

  const primary   = isUrgent ? CTA_URGENT : CTA_PRIMARY;
  const secondary = CTA_SECONDARY;

  let context;

  if (isUrgent) {
    context =
      "You may owe a balance when you file. A licensed tax professional can " +
      "review your return, confirm the amount due, identify any credits that " +
      "could reduce what you owe, and make sure your return is filed correctly " +
      "and on time.";
  } else if (hasMixedResult) {
    context =
      "Your federal and state results point in different directions. " +
      "A tax professional can reconcile both, ensure you pay only what you owe " +
      "to each, and help you avoid surprises at filing time.";
  } else if (combined.isRefund) {
    context =
      "A tax professional can verify this estimate, identify additional deductions " +
      "and credits you may have missed, and file your return to get your refund " +
      "as quickly as possible.";
  } else {
    context =
      "A tax professional can review your full situation, confirm this estimate, " +
      "and ensure your return is filed accurately and on time.";
  }

  return {
    primary,
    secondary,
    context,
    urgency: isUrgent ? "high" : "standard",
  };
}

// =============================================================================
// ORCHESTRATOR — generateClientExperience()
// =============================================================================

/**
 * Generate the full client-facing content object.
 *
 * @param  {object} input     Prepared input from prepareInput()
 * @param  {object} federal   Output from calculateFederal()
 * @param  {object} state     Output from calculateState()
 * @param  {object} combined  Combined totals from taxEstimator.js
 * @returns {object}          Structured client experience object
 */
function generateClientExperience(input, federal, state, combined) {
  if (!input || !federal || !state || !combined) {
    throw new Error(
      "clientExperienceEngine.generateClientExperience: " +
      "input, federal, state, and combined are all required."
    );
  }

  const headline        = buildHeadline(combined);
  const summary         = buildSummary(input, federal, state, combined);
  const keyDrivers      = buildKeyDrivers(input, federal, state);
  const whatCouldChange = buildWhatCouldChange(input, federal, state);
  const recommendations = buildRecommendations(input, federal, state, combined);
  const confidence      = buildConfidence(input, federal, state);
  const disclaimer      = buildDisclaimer();
  const cta             = buildCTA(combined, state);

  return {
    headline,
    summary:         summary.paragraphs,
    keyDrivers:      keyDrivers.drivers,
    whatCouldChange: whatCouldChange.factors,
    recommendations: recommendations.recommendations,
    confidence,
    disclaimer,
    cta,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  generateClientExperience,

  // Individual builders — exported for unit testing
  buildHeadline,
  buildSummary,
  buildKeyDrivers,
  buildWhatCouldChange,
  buildRecommendations,
  buildConfidence,
  buildDisclaimer,
  buildCTA,

  // Formatting helpers — exported for use in UI layer
  fmt,
  fmtPct,
  signedFmt,
};