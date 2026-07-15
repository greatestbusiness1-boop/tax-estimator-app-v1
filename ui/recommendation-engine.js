(function (root, factory) {
  "use strict";

  const engine = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = engine;
  }

  if (root) {
    root.TaxRecommendationEngine = engine;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "1.8.0";

  const PRIORITY_RANK = Object.freeze({
    urgent: 0,
    high: 1,
    medium: 2,
    review: 3,
    monitor: 4
  });

  const OPPORTUNITY_STAGE_DEFINITIONS = Object.freeze([
    Object.freeze({
      key: "potential",
      label: "Potential Opportunity",
      summary: "The Planner identified an item that may apply. Eligibility and the amount have not been verified.",
      weight: 10,
      tone: "potential"
    }),
    Object.freeze({
      key: "under-review",
      label: "Under Professional Review",
      summary: "The facts and supporting documents are being reviewed before a recommendation is made.",
      weight: 35,
      tone: "review"
    }),
    Object.freeze({
      key: "client-action",
      label: "Client Action Required",
      summary: "The review cannot move forward until the client provides information, documents, or completes a requested step.",
      weight: 55,
      tone: "action"
    }),
    Object.freeze({
      key: "verified",
      label: "Verified Opportunity",
      summary: "The available facts support the opportunity. The verified estimate remains subject to final tax-return information.",
      weight: 80,
      tone: "verified"
    }),
    Object.freeze({
      key: "completed",
      label: "Completed",
      summary: "The agreed planning action has been completed and documented.",
      weight: 100,
      tone: "completed"
    }),
    Object.freeze({
      key: "not-applicable",
      label: "Not Applicable",
      summary: "The item was reviewed and does not apply based on the information currently available.",
      weight: 100,
      tone: "closed"
    })
  ]);

  const OPPORTUNITY_STAGE_MAP = new Map(
    OPPORTUNITY_STAGE_DEFINITIONS.map((stage) => [stage.key, stage])
  );

  const OPPORTUNITY_DEFINITIONS = Object.freeze([
    Object.freeze({
      key: "retirement",
      type: "deduction",
      category: "tax-savings",
      title: "Review deductible retirement contribution",
      detail: "Confirm eligibility, contribution limit, deadline, and whether the contribution is deductible.",
      clientAction: "Gather current retirement contribution records and identify how much additional cash is available to contribute.",
      professionalAction: "Verify the eligible plan, contribution limit, deduction treatment, and deadline before a contribution is made.",
      priority: "medium",
      servicePath: "Tax Planning Meeting"
    }),
    Object.freeze({
      key: "hsa",
      type: "deduction",
      category: "tax-savings",
      title: "Review HSA contribution",
      detail: "Confirm HSA eligibility, coverage type, annual limit, and contribution deadline.",
      clientAction: "Confirm the months covered by an HSA-eligible health plan and provide year-to-date HSA contributions.",
      professionalAction: "Verify eligibility, annual limit, employer contributions, and the final contribution deadline.",
      priority: "medium",
      servicePath: "Tax Planning Meeting"
    }),
    Object.freeze({
      key: "mileage",
      type: "deduction",
      category: "business",
      title: "Document business vehicle deduction",
      detail: "Complete mileage records or actual-expense support before claiming the deduction.",
      clientAction: "Reconstruct and maintain a business mileage log with dates, destinations, business purpose, and miles.",
      professionalAction: "Compare the standard-mileage and actual-expense methods and verify documentation before filing.",
      priority: "medium",
      servicePath: "Small-Business Tax Preparation"
    }),
    Object.freeze({
      key: "homeOffice",
      type: "deduction",
      category: "business",
      title: "Review home-office eligibility",
      detail: "Confirm regular and exclusive use, business purpose, and the correct deduction method.",
      clientAction: "Measure the workspace and gather housing costs, utilities, insurance, and other supporting records.",
      professionalAction: "Verify regular and exclusive business use and compare the simplified and actual-expense methods.",
      priority: "medium",
      servicePath: "Small-Business Tax Preparation"
    }),
    Object.freeze({
      key: "energy",
      type: "credit",
      category: "tax-credit",
      title: "Verify residential energy credit",
      detail: "Collect invoices, manufacturer certifications, installation dates, and qualified-property details.",
      clientAction: "Gather itemized invoices, proof of payment, installation dates, and product certification information.",
      professionalAction: "Confirm the property qualifies, apply annual limits, and verify any credit restrictions.",
      priority: "medium",
      servicePath: "Written Red Flag Review"
    }),
    Object.freeze({
      key: "education",
      type: "credit",
      category: "tax-credit",
      title: "Verify education credit",
      detail: "Review Form 1098-T, paid expenses, student eligibility, prior credit claims, and income limits.",
      clientAction: "Gather Form 1098-T, account statements, receipts for qualified expenses, and scholarship information.",
      professionalAction: "Determine the eligible student, qualified expenses, credit type, income limitation, and coordination rules.",
      priority: "medium",
      servicePath: "Written Red Flag Review"
    }),
    Object.freeze({
      key: "entity",
      type: "review",
      category: "business",
      title: "Schedule entity and business tax review",
      detail: "Review business structure, payroll, owner compensation, retirement plans, and tax-planning opportunities.",
      clientAction: "Provide current entity documents, year-to-date profit, payroll information, and owner compensation details.",
      professionalAction: "Review entity fit, payroll obligations, reasonable compensation, retirement options, and estimated-tax exposure.",
      priority: "high",
      servicePath: "Business Tax Intelligence™"
    }),
    Object.freeze({
      key: "bookkeeping",
      type: "review",
      category: "risk-reduction",
      title: "Complete bookkeeping cleanup",
      detail: "Reconcile accounts and identify missing or misclassified business expenses before tax preparation.",
      clientAction: "Provide all bank and credit-card statements and identify uncategorized, personal, duplicate, or missing transactions.",
      professionalAction: "Reconcile accounts, correct classifications, document owner activity, and identify missing deductions before filing.",
      priority: "high",
      servicePath: "Bookkeeping Cleanup"
    }),
    Object.freeze({
      key: "transcript",
      type: "service",
      category: "risk-reduction",
      title: "Start IRS transcript recovery",
      detail: "Confirm missing records, filing history, balances, and transcript types needed.",
      clientAction: "List the missing tax years and records, then complete the required authorization for transcript access.",
      professionalAction: "Confirm the tax years and transcript types required before tax preparation or resolution work begins.",
      priority: "high",
      servicePath: "IRS Transcript Help"
    }),
    Object.freeze({
      key: "notice",
      type: "service",
      category: "risk-reduction",
      title: "Review IRS notice deadline",
      detail: "Identify the notice number, tax period, response deadline, disputed amount, and required documents.",
      clientAction: "Upload every page of the notice and provide the envelope or received date when available.",
      professionalAction: "Identify the notice issue, response deadline, account history, and documents required before responding.",
      priority: "urgent",
      servicePath: "IRS Notice Review"
    })
  ]);

  const DEFINITION_MAP = new Map(
    OPPORTUNITY_DEFINITIONS.map((definition) => [definition.key, definition])
  );

  const SMART_ALERT_TYPE_DEFINITIONS = Object.freeze({
    "tax-savings": Object.freeze({
      key: "tax-savings",
      label: "Potential Tax Savings",
      tone: "savings"
    }),
    "tax-exposure": Object.freeze({
      key: "tax-exposure",
      label: "Potential Tax Exposure",
      tone: "exposure"
    }),
    "risk-action": Object.freeze({
      key: "risk-action",
      label: "Risk Reduction / Required Action",
      tone: "risk"
    }),
    "documentation": Object.freeze({
      key: "documentation",
      label: "Documentation / Verification",
      tone: "documentation"
    })
  });


  const BUSINESS_ENTITY_LABELS = Object.freeze({
    unknown: "Business type not confirmed",
    "independent-contractor": "Independent contractor / gig worker",
    "sole-proprietor": "Sole proprietor",
    "single-member-llc": "Single-member LLC",
    partnership: "Partnership",
    "multi-member-llc": "Multi-member LLC",
    "s-corporation": "S corporation",
    "c-corporation": "C corporation",
    other: "Other business structure"
  });

  const BUSINESS_PAYROLL_LABELS = Object.freeze({
    unknown: "Payroll status not confirmed",
    none: "No employees or owner payroll reported",
    employees: "Employees reported",
    "owner-payroll": "Owner payroll reported",
    both: "Employees and owner payroll reported"
  });

  const BUSINESS_ACCOUNT_LABELS = Object.freeze({
    unknown: "Account separation not confirmed",
    separate: "Business and personal funds are separated",
    mixed: "Business and personal funds are mixed"
  });

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function signedNumberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function clampRate(value) {
    return Math.min(1, Math.max(0, numberOrZero(value)));
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(Math.round(numberOrZero(value)));
  }

  function priorityRank(priority) {
    return PRIORITY_RANK[priority] ?? PRIORITY_RANK.review;
  }

  function benefitPriority(definition, estimatedBenefit) {
    if (definition.priority === "urgent" || definition.priority === "high") {
      return definition.priority;
    }

    if (estimatedBenefit >= 2500) return "high";
    if (estimatedBenefit > 0) return "medium";
    return definition.priority || "review";
  }

  function normalizeSelections(selections) {
    const source = selections && typeof selections === "object" ? selections : {};

    return OPPORTUNITY_DEFINITIONS.reduce((normalized, definition) => {
      const value = source[definition.key];
      const selected = typeof value === "object"
        ? Boolean(value.selected)
        : Boolean(value);
      const amount = typeof value === "object"
        ? numberOrZero(value.amount)
        : 0;

      normalized[definition.key] = { selected, amount };
      return normalized;
    }, {});
  }

  function createAction(definition, estimatedBenefit, amount) {
    const priority = benefitPriority(definition, estimatedBenefit);

    return {
      id: `opportunity-${definition.key}`,
      opportunityKey: definition.key,
      source: "tax-savings-finder",
      type: definition.type,
      category: definition.category,
      title: definition.title,
      detail: definition.detail,
      clientAction: definition.clientAction,
      professionalAction: definition.professionalAction,
      estimatedBenefit: Math.round(numberOrZero(estimatedBenefit)),
      enteredAmount: Math.round(numberOrZero(amount)),
      priority,
      priorityRank: priorityRank(priority),
      impact: estimatedBenefit > 0
        ? `Potential benefit: ${money(estimatedBenefit)}`
        : `Priority: ${priority === "urgent" ? "Urgent" : priority === "high" ? "High" : "Review"}`,
      servicePath: definition.servicePath || "Tax Planning Meeting"
    };
  }

  function sortActions(actions) {
    return [...(actions || [])].sort((a, b) => {
      const priorityDifference = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDifference !== 0) return priorityDifference;

      const benefitDifference = numberOrZero(b.estimatedBenefit) - numberOrZero(a.estimatedBenefit);
      if (benefitDifference !== 0) return benefitDifference;

      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  function calculateOpportunitySummary(input) {
    const federalRate = clampRate(input?.federalRate);
    const stateRate = clampRate(input?.stateRate);
    const selections = normalizeSelections(input?.selections);

    let selectedCount = 0;
    let deductionTotal = 0;
    let directCredits = 0;
    let federalSavings = 0;
    let stateSavings = 0;
    const actions = [];

    OPPORTUNITY_DEFINITIONS.forEach((definition) => {
      const selection = selections[definition.key];
      if (!selection.selected) return;

      selectedCount += 1;
      let estimatedBenefit = 0;

      if (definition.type === "deduction") {
        deductionTotal += selection.amount;
        const federalBenefit = selection.amount * federalRate;
        const stateBenefit = selection.amount * stateRate;
        federalSavings += federalBenefit;
        stateSavings += stateBenefit;
        estimatedBenefit = federalBenefit + stateBenefit;
      } else if (definition.type === "credit") {
        directCredits += selection.amount;
        federalSavings += selection.amount;
        estimatedBenefit = selection.amount;
      }

      actions.push(createAction(definition, estimatedBenefit, selection.amount));
    });

    const combinedSavings = federalSavings + stateSavings;
    const score = Math.min(
      100,
      Math.round(
        (selectedCount * 8) +
        Math.min(35, combinedSavings / 100) +
        (deductionTotal > 0 ? 10 : 0) +
        (directCredits > 0 ? 10 : 0)
      )
    );

    return {
      selectedCount,
      deductionTotal: Math.round(deductionTotal),
      directCredits: Math.round(directCredits),
      federalSavings: Math.round(federalSavings),
      stateSavings: Math.round(stateSavings),
      combinedSavings: Math.round(combinedSavings),
      score,
      actions: sortActions(actions)
    };
  }

  function buildWithholdingRecommendation(input) {
    const combinedResult = signedNumberOrZero(input?.combinedWithholdingResult);
    const payPeriods = Math.max(1, Math.round(numberOrZero(input?.payPeriods) || 26));
    const targetBand = Math.max(100, numberOrZero(input?.withholdingTargetBand) || 100);

    if (input?.hasWithholdingData === false) {
      return {
        id: "withholding-complete-checkup",
        source: "withholding-checkup",
        category: "planning-input",
        title: "Complete the Withholding Checkup",
        detail: "Enter current wages, other income, federal withholding, state withholding, and filing information to create a reliable projection.",
        clientAction: "Use the most recent paystubs and year-to-date income records to complete the withholding inputs.",
        professionalAction: "Review the completed projection before recommending withholding or estimated-payment changes.",
        estimatedBenefit: 0,
        priority: "review",
        priorityRank: priorityRank("review"),
        impact: "Next step: Complete inputs",
        servicePath: "Tax Planning Meeting"
      };
    }

    if (combinedResult < -targetBand) {
      const adjustment = Math.abs(combinedResult) / payPeriods;

      return {
        id: "withholding-balance-due",
        source: "withholding-checkup",
        category: "cash-flow-and-risk",
        title: "Adjust withholding",
        detail: `The current projection shows a combined balance due. Review federal and state withholding and consider increasing total withholding by about ${money(adjustment)} per paycheck.`,
        clientAction: "Provide the most recent paystubs and confirm the number of pay periods remaining in the year.",
        professionalAction: "Review the projected federal and state balance due before recommending a Form W-4 or state withholding change.",
        estimatedBenefit: 0,
        priority: "high",
        priorityRank: priorityRank("high"),
        impact: "Priority: High",
        servicePath: "Tax Planning Meeting"
      };
    }

    if (combinedResult > Math.max(1000, targetBand)) {
      return {
        id: "withholding-overpayment",
        source: "withholding-checkup",
        category: "cash-flow",
        title: "Review overwithholding",
        detail: "The current projection shows a sizable combined refund. Consider whether reducing withholding could improve monthly cash flow without creating an underpayment risk.",
        clientAction: "Provide the most recent paystubs and identify whether a larger refund is intentional or whether monthly cash flow is the priority.",
        professionalAction: "Review safe withholding changes and preserve an appropriate cushion for income changes, credits, and underpayment rules.",
        estimatedBenefit: 0,
        priority: "medium",
        priorityRank: priorityRank("medium"),
        impact: "Priority: Medium",
        servicePath: "Tax Planning Meeting"
      };
    }

    return {
      id: "withholding-monitor",
      source: "withholding-checkup",
      category: "monitoring",
      title: "Maintain withholding review",
      detail: "Current withholding appears reasonably close to the combined estimated tax. Recheck after major income, family, or deduction changes.",
      clientAction: "Update the planner after a job change, raise, new dependent, major deduction, or other significant tax event.",
      professionalAction: "Recheck the projection after material income, withholding, filing-status, dependent, or deduction changes.",
      estimatedBenefit: 0,
      priority: "monitor",
      priorityRank: priorityRank("monitor"),
      impact: "Priority: Monitor",
      servicePath: "Tax Planning Meeting"
    };
  }

  function normalizeReviewStatus(value, allowed, fallback = "unknown") {
    const normalized = String(value || "").trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
  }

  function buildBusinessDetection(input = {}) {
    const signals = input?.smartAlertSignals && typeof input.smartAlertSignals === "object"
      ? input.smartAlertSignals
      : input?.signals && typeof input.signals === "object"
        ? input.signals
        : input;
    const selections = normalizeSelections(input?.selections || {});

    const entityType = normalizeReviewStatus(
      signals.businessEntityType,
      Object.keys(BUSINESS_ENTITY_LABELS)
    );
    const payrollStatus = normalizeReviewStatus(
      signals.businessPayrollStatus,
      Object.keys(BUSINESS_PAYROLL_LABELS)
    );
    const accountStatus = normalizeReviewStatus(
      signals.businessAccountStatus,
      Object.keys(BUSINESS_ACCOUNT_LABELS)
    );
    const booksStatus = normalizeReviewStatus(
      signals.businessBooksStatus,
      ["current", "cleanup", "unknown"]
    );

    const quarterlyGrossIncome = numberOrZero(signals.quarterlyBusinessIncome);
    const quarterlyExpenses = numberOrZero(signals.quarterlyBusinessExpenses);
    const quarterlyNetProfit = Math.max(0, quarterlyGrossIncome - quarterlyExpenses);
    const profileNetProfit = numberOrZero(signals.businessNetProfit);
    const netProfit = Math.max(profileNetProfit, quarterlyNetProfit);
    const estimatedPayments =
      numberOrZero(signals.federalEstimatedPayments) +
      numberOrZero(signals.stateEstimatedPayments) +
      numberOrZero(signals.quarterlyEstimatedPayments);

    const finderSignals = [
      ["mileage", "Business mileage / vehicle records selected"],
      ["homeOffice", "Home-office review selected"],
      ["entity", "Entity / business tax review selected"],
      ["bookkeeping", "Bookkeeping cleanup selected"]
    ].filter(([key]) => Boolean(selections[key]?.selected));

    const indicators = [];
    let score = 0;

    if (Boolean(signals.hasBusinessActivity)) {
      score += 5;
      indicators.push("Business or self-employment activity was confirmed in the Client Tax Profile.");
    }
    if (quarterlyGrossIncome > 0) {
      score += 5;
      indicators.push(`${money(quarterlyGrossIncome)} of 1099 / business income was entered in the Quarterly Planner.`);
    }
    if (profileNetProfit > 0) {
      score += 4;
      indicators.push(`${money(profileNetProfit)} of estimated net business profit was entered.`);
    }
    if (entityType !== "unknown") {
      score += 5;
      indicators.push(`${BUSINESS_ENTITY_LABELS[entityType]} was identified as the business structure.`);
    }
    if (booksStatus !== "unknown") {
      score += 2;
      indicators.push(booksStatus === "current"
        ? "Business books were reported as current and reconciled."
        : "Business books were reported as needing cleanup.");
    }
    if (accountStatus !== "unknown") {
      score += 2;
      indicators.push(BUSINESS_ACCOUNT_LABELS[accountStatus] + ".");
    }
    if (payrollStatus !== "unknown") {
      score += 2;
      indicators.push(BUSINESS_PAYROLL_LABELS[payrollStatus] + ".");
    }
    finderSignals.forEach(([, label]) => {
      score += 2;
      indicators.push(label + ".");
    });

    const directConfirmation = Boolean(
      signals.hasBusinessActivity ||
      quarterlyGrossIncome > 0 ||
      profileNetProfit > 0 ||
      entityType !== "unknown"
    );
    const secondaryCount = finderSignals.length +
      (booksStatus !== "unknown" ? 1 : 0) +
      (accountStatus !== "unknown" ? 1 : 0) +
      (payrollStatus !== "unknown" ? 1 : 0);

    let level = "none";
    let levelLabel = "Not detected";
    let tone = "none";

    if (directConfirmation) {
      level = "confirmed";
      levelLabel = "Business activity confirmed";
      tone = "confirmed";
    } else if (score >= 4 || secondaryCount >= 2) {
      level = "strong";
      levelLabel = "Strong business indicators";
      tone = "strong";
    } else if (score > 0) {
      level = "possible";
      levelLabel = "Possible business activity";
      tone = "possible";
    }

    const isBusinessClient = level === "confirmed" || level === "strong";
    const possibleBusinessClient = level === "possible";

    let profileType = "Personal tax planning profile";
    if (["partnership", "multi-member-llc", "s-corporation", "c-corporation"].includes(entityType)) {
      profileType = "Business entity owner";
    } else if (["independent-contractor", "sole-proprietor", "single-member-llc"].includes(entityType)) {
      profileType = "Self-employed business owner";
    } else if (isBusinessClient && (quarterlyGrossIncome > 0 || netProfit > 0)) {
      profileType = "Self-employed / business owner";
    } else if (possibleBusinessClient) {
      profileType = "Business activity needs confirmation";
    } else if (isBusinessClient) {
      profileType = "Small-business owner";
    }

    const missingItems = [];
    if (level !== "none") {
      if (entityType === "unknown") missingItems.push("Confirm the business type and federal tax classification.");
      if (netProfit <= 0) missingItems.push("Provide current gross income, expenses, and estimated net profit.");
      if (booksStatus === "unknown") missingItems.push("Confirm whether the business books are current and reconciled.");
      if (booksStatus === "cleanup") missingItems.push("Complete bookkeeping cleanup before relying on the profit figure.");
      if (accountStatus === "unknown") missingItems.push("Confirm whether business and personal funds are separated.");
      if (accountStatus === "mixed") missingItems.push("Separate business and personal activity and document owner transactions.");
      if (payrollStatus === "unknown") missingItems.push("Confirm employee and owner-payroll status.");
      if (netProfit > 0 && estimatedPayments <= 0) missingItems.push("Review federal and state estimated-tax payments.");
    }

    let readinessScore = 0;
    if (level !== "none") {
      readinessScore += 15;
      if (entityType !== "unknown") readinessScore += 20;
      if (netProfit > 0) readinessScore += 15;
      if (booksStatus === "current") readinessScore += 20;
      else if (booksStatus === "cleanup") readinessScore += 5;
      if (accountStatus === "separate") readinessScore += 15;
      else if (accountStatus === "mixed") readinessScore += 3;
      if (payrollStatus !== "unknown") readinessScore += 8;
      if (netProfit <= 0 || estimatedPayments > 0) readinessScore += 7;
    }
    readinessScore = Math.max(0, Math.min(100, readinessScore));

    const highRisk = Boolean(
      booksStatus === "cleanup" ||
      accountStatus === "mixed" ||
      (netProfit >= 25000 && estimatedPayments <= 0) ||
      (["s-corporation", "c-corporation"].includes(entityType) && payrollStatus === "unknown")
    );

    let priority = "monitor";
    if (highRisk) priority = "high";
    else if (isBusinessClient) priority = "medium";
    else if (possibleBusinessClient) priority = "review";

    let servicePath = "Personal Tax Planning";
    if (isBusinessClient) servicePath = "Business Tax Intelligence™ Assessment";
    else if (possibleBusinessClient) servicePath = "Confirm Business Activity";

    const clientNeeds = level === "none"
      ? ["Update the Client Tax Profile if the client receives 1099 income, operates a side business, owns an LLC or corporation, or has business deductions."]
      : [
          "Current year-to-date profit and loss report or a reliable income-and-expense summary.",
          "Business bank and credit-card statements, mileage records, payroll information, entity documents, and estimated-payment records.",
          ...missingItems.slice(0, 4)
        ];

    const professionalReview = level === "none"
      ? ["No business review is currently triggered. Continue the personal tax-planning workflow unless new business facts are entered."]
      : [
          "Confirm the business type, federal tax classification, filing requirements, and whether a separate business return may be required.",
          "Review bookkeeping reliability, owner activity, payroll, estimated-tax exposure, documented deductions, and retirement-plan opportunities.",
          "Determine whether the client should remain in the personal Planner or be routed to the separate Business Tax Intelligence™ Assessment."
        ];

    let nextAction = "Continue the personal Tax Savings Planner workflow.";
    if (highRisk) {
      nextAction = "Complete a business tax review before relying on the current profit figure or making year-end tax decisions.";
    } else if (isBusinessClient) {
      nextAction = "Confirm the business profile and schedule the Business Tax Intelligence™ Assessment when deeper entity, bookkeeping, payroll, and owner-planning analysis is needed.";
    } else if (possibleBusinessClient) {
      nextAction = "Confirm whether the activity is a business, side gig, or self-employment before routing the client to business planning.";
    }

    return {
      level,
      levelLabel,
      tone,
      detected: level !== "none",
      isBusinessClient,
      possibleBusinessClient,
      profileType,
      priority,
      priorityLabel: priority === "high"
        ? "High-priority review"
        : priority === "medium"
          ? "Business review recommended"
          : priority === "review"
            ? "Confirm business activity"
            : "No business review triggered",
      readinessScore,
      entityType,
      entityLabel: BUSINESS_ENTITY_LABELS[entityType],
      payrollStatus,
      payrollLabel: BUSINESS_PAYROLL_LABELS[payrollStatus],
      accountStatus,
      accountLabel: BUSINESS_ACCOUNT_LABELS[accountStatus],
      booksStatus,
      grossBusinessIncome: quarterlyGrossIncome,
      businessExpenses: quarterlyExpenses,
      netProfit,
      estimatedPayments,
      indicators,
      missingItems,
      clientNeeds,
      professionalReview,
      nextAction,
      servicePath,
      routeToBusinessAssessment: isBusinessClient,
      boundaryNote: "Business Detection identifies when deeper business analysis may be appropriate. It does not complete the separate Business Tax Intelligence™ Assessment or guarantee an entity, deduction, payroll, or tax-saving recommendation."
    };
  }

  function createSmartAlert({
    id,
    alertType,
    title,
    detail,
    clientAction,
    professionalAction,
    priority = "review",
    servicePath = "Tax Planning Meeting",
    flaggedAmount = 0,
    sourceField = ""
  }) {
    const type = SMART_ALERT_TYPE_DEFINITIONS[alertType] ||
      SMART_ALERT_TYPE_DEFINITIONS.documentation;

    return {
      id,
      source: "smart-alerts",
      sourceField,
      category: alertType,
      alertType: type.key,
      alertTypeLabel: type.label,
      alertTone: type.tone,
      title,
      detail,
      clientAction,
      professionalAction,
      estimatedBenefit: 0,
      flaggedAmount: Math.round(numberOrZero(flaggedAmount)),
      priority,
      priorityRank: priorityRank(priority),
      impact: type.label,
      servicePath
    };
  }

  function buildSmartAlerts(input = {}) {
    const signals = input?.signals && typeof input.signals === "object"
      ? input.signals
      : input;
    const context = input?.context && typeof input.context === "object"
      ? input.context
      : {};

    const cashCharity = numberOrZero(signals.charitableCash);
    const noncashCharity = numberOrZero(signals.charitableNoncash);
    const charitableTotal = cashCharity + noncashCharity;
    const charitableDocs = normalizeReviewStatus(
      signals.charitableDocs,
      ["complete", "review", "missing", "unknown"]
    );

    const shortTermGains = numberOrZero(signals.shortTermGains);
    const longTermGains = numberOrZero(signals.longTermGains);
    const capitalLosses = numberOrZero(signals.capitalLosses);
    const dividends = numberOrZero(signals.dividendsDistributions);
    const investmentTotal = shortTermGains + longTermGains + dividends;
    const investmentDocs = normalizeReviewStatus(
      signals.investmentDocs,
      ["complete", "review", "missing", "unknown"]
    );

    const retirementDistributions = numberOrZero(signals.retirementDistributions);
    const retirementWithholding = numberOrZero(signals.retirementWithholding);
    const socialSecurityBenefits = numberOrZero(signals.socialSecurityBenefits);
    const retirementDocs = normalizeReviewStatus(
      signals.retirementDocs,
      ["complete", "review", "missing", "unknown"]
    );

    const federalEstimatedPayments = numberOrZero(signals.federalEstimatedPayments);
    const stateEstimatedPayments = numberOrZero(signals.stateEstimatedPayments);
    const totalEstimatedPayments = federalEstimatedPayments + stateEstimatedPayments;
    const hasInstallmentAgreement = Boolean(signals.hasInstallmentAgreement);
    const installmentStatus = normalizeReviewStatus(
      signals.installmentStatus,
      ["current", "needs-review", "unknown"]
    );

    const hasBusinessActivity = Boolean(signals.hasBusinessActivity);
    const businessNetProfit = numberOrZero(signals.businessNetProfit);
    const businessBooksStatus = normalizeReviewStatus(
      signals.businessBooksStatus,
      ["current", "cleanup", "unknown"]
    );

    const projectedResult = signedNumberOrZero(context.combinedWithholdingResult);
    const wages = numberOrZero(context.wages);
    const otherIncome = numberOrZero(context.otherIncome);
    const alerts = [];

    if (charitableTotal > 0) {
      alerts.push(createSmartAlert({
        id: "smart-charitable-strategy",
        alertType: "tax-savings",
        title: "Review charitable contribution strategy",
        detail: `${money(charitableTotal)} of charitable giving was entered. Confirm qualified recipients, contribution dates, itemized-deduction treatment, and whether the contributions create an actual tax benefit.`,
        clientAction: "Provide contribution receipts, written acknowledgments, proof of payment, and a description of any noncash property donated.",
        professionalAction: "Verify deductibility and substantiation, compare total itemized deductions with the standard deduction, and explain that the contribution amount is not the same as the tax savings.",
        priority: charitableTotal >= 10000 ? "high" : "medium",
        servicePath: "Tax Planning Meeting",
        flaggedAmount: charitableTotal,
        sourceField: "charitable"
      }));

      if (charitableDocs !== "complete") {
        alerts.push(createSmartAlert({
          id: "smart-charitable-documentation",
          alertType: "documentation",
          title: "Complete charitable contribution documentation",
          detail: noncashCharity > 0
            ? "Noncash charitable contributions were entered and the documentation status is not complete. Receipts, descriptions, valuation support, and any additional required records should be reviewed before filing."
            : "Charitable contributions were entered and the documentation status is not complete. Contribution receipts and written acknowledgments should be collected before filing.",
          clientAction: "Gather all charitable receipts, acknowledgment letters, proof of payment, and noncash contribution records.",
          professionalAction: "Review the records for completeness and determine whether any additional substantiation or reporting is required.",
          priority: charitableDocs === "missing" ? "high" : "review",
          servicePath: "Written Red Flag Review",
          flaggedAmount: charitableTotal,
          sourceField: "charitable-docs"
        }));
      }
    }

    if (shortTermGains > 0) {
      alerts.push(createSmartAlert({
        id: "smart-short-term-capital-gain",
        alertType: "tax-exposure",
        title: "Review short-term capital gain exposure",
        detail: `${money(shortTermGains)} of short-term capital gains was entered. Short-term gains should be reviewed with the client's ordinary income, withholding, losses, and estimated payments before projecting the final tax result.`,
        clientAction: "Provide brokerage gain/loss reports and confirm whether any additional sales are expected before year-end.",
        professionalAction: "Review holding periods, basis, wash-sale information, available capital losses, and the effect on the federal and state projection.",
        priority: shortTermGains >= 10000 ? "high" : "medium",
        servicePath: "Tax Planning Meeting",
        flaggedAmount: shortTermGains,
        sourceField: "short-term-gains"
      }));
    }

    if (longTermGains > 0) {
      alerts.push(createSmartAlert({
        id: "smart-long-term-capital-gain",
        alertType: "tax-exposure",
        title: "Review long-term capital gain exposure",
        detail: `${money(longTermGains)} of long-term capital gains was entered. The final tax effect depends on the client's complete taxable income, filing status, other investment income, and state treatment.`,
        clientAction: "Provide brokerage gain/loss reports and identify any planned sales or large distributions still expected this year.",
        professionalAction: "Review basis, holding periods, available losses, total taxable income, and the effect on the federal and state projection.",
        priority: longTermGains >= 25000 ? "high" : "medium",
        servicePath: "Tax Planning Meeting",
        flaggedAmount: longTermGains,
        sourceField: "long-term-gains"
      }));
    }

    if (dividends > 0) {
      alerts.push(createSmartAlert({
        id: "smart-dividend-distribution-review",
        alertType: "tax-exposure",
        title: "Review dividends and investment distributions",
        detail: `${money(dividends)} of dividends or investment distributions was entered. Qualified dividends, ordinary dividends, capital-gain distributions, and other distributions may receive different tax treatment.`,
        clientAction: "Provide the year-end Forms 1099-DIV and brokerage statements, plus any year-to-date distribution reports.",
        professionalAction: "Separate the income by tax character, confirm basis adjustments where applicable, and include the income in the withholding or estimated-payment review.",
        priority: dividends >= 10000 ? "high" : "medium",
        servicePath: "Tax Planning Meeting",
        flaggedAmount: dividends,
        sourceField: "dividends"
      }));
    }

    if (capitalLosses > 0) {
      alerts.push(createSmartAlert({
        id: "smart-capital-loss-coordination",
        alertType: "tax-savings",
        title: "Review capital losses with gains and carryovers",
        detail: `${money(capitalLosses)} of capital losses was entered. Losses should be coordinated with current gains, prior-year carryovers, basis records, and wash-sale information before estimating a tax benefit.`,
        clientAction: "Provide brokerage gain/loss reports and the prior-year return so capital-loss carryovers can be verified.",
        professionalAction: "Verify realized losses, wash-sale adjustments, prior-year carryovers, and how the losses coordinate with current-year gains.",
        priority: shortTermGains + longTermGains > 0 ? "medium" : "review",
        servicePath: "Tax Planning Meeting",
        flaggedAmount: capitalLosses,
        sourceField: "capital-losses"
      }));
    }

    if (investmentTotal + capitalLosses > 0 && investmentDocs !== "complete") {
      alerts.push(createSmartAlert({
        id: "smart-investment-documentation",
        alertType: "documentation",
        title: "Verify investment tax documents and basis",
        detail: "Investment activity was entered, but the document status is not complete. Brokerage statements, Forms 1099, cost basis, and prior-year carryovers should be reviewed before the result is treated as final.",
        clientAction: "Provide all brokerage tax documents, year-end statements, corrected forms, and the prior-year return.",
        professionalAction: "Reconcile the tax forms to the gain/loss detail, verify basis and carryovers, and identify missing or corrected documents.",
        priority: investmentDocs === "missing" ? "high" : "review",
        servicePath: "Written Red Flag Review",
        flaggedAmount: investmentTotal + capitalLosses,
        sourceField: "investment-docs"
      }));
    }

    if (retirementDistributions > 0) {
      const noWithholding = retirementWithholding <= 0;
      alerts.push(createSmartAlert({
        id: "smart-1099r-review",
        alertType: "tax-exposure",
        title: "Review 1099-R taxability and withholding",
        detail: `${money(retirementDistributions)} of retirement distributions and ${money(retirementWithholding)} of federal withholding were entered. The taxable amount, distribution code, rollover treatment, and withholding should be verified before projecting the final tax result.`,
        clientAction: "Provide every Form 1099-R, retirement account statement, and any rollover or distribution documentation.",
        professionalAction: "Review the taxable amount, distribution code, basis, rollover treatment, withholding, and any state-specific treatment.",
        priority: noWithholding ? "high" : "medium",
        servicePath: "Tax Planning Meeting",
        flaggedAmount: retirementDistributions,
        sourceField: "retirement-distributions"
      }));
    }

    if (socialSecurityBenefits > 0) {
      const relatedIncome = wages + otherIncome + investmentTotal + retirementDistributions;
      alerts.push(createSmartAlert({
        id: "smart-social-security-taxability",
        alertType: "tax-exposure",
        title: "Review Social Security taxability with other income",
        detail: `${money(socialSecurityBenefits)} of Social Security benefits was entered. The taxable portion must be reviewed together with wages, retirement distributions, investment income, business income, and other household income.`,
        clientAction: "Provide every Form SSA-1099 and information for all other household income expected for the year.",
        professionalAction: "Review the benefits with the client's complete income picture and determine whether withholding or estimated-payment changes should be considered.",
        priority: relatedIncome > 0 ? "medium" : "review",
        servicePath: "Tax Planning Meeting",
        flaggedAmount: socialSecurityBenefits,
        sourceField: "social-security"
      }));
    }

    if (
      retirementDistributions + socialSecurityBenefits > 0 &&
      retirementDocs !== "complete"
    ) {
      alerts.push(createSmartAlert({
        id: "smart-retirement-documentation",
        alertType: "documentation",
        title: "Collect retirement and Social Security tax documents",
        detail: "Retirement or Social Security income was entered, but the tax-document status is not complete. All Forms 1099-R, SSA-1099, and related statements should be reviewed.",
        clientAction: "Provide all Forms 1099-R, SSA-1099, retirement statements, and rollover records.",
        professionalAction: "Reconcile the forms to the amounts entered and identify any missing, corrected, or state-specific information.",
        priority: retirementDocs === "missing" ? "high" : "review",
        servicePath: "Written Red Flag Review",
        flaggedAmount: retirementDistributions + socialSecurityBenefits,
        sourceField: "retirement-docs"
      }));
    }

    if (totalEstimatedPayments > 0) {
      alerts.push(createSmartAlert({
        id: "smart-estimated-payment-verification",
        alertType: "documentation",
        title: "Verify federal and state estimated-tax payments",
        detail: `${money(federalEstimatedPayments)} of federal and ${money(stateEstimatedPayments)} of state estimated-tax payments were entered. Payment dates, amounts, tax year, and proof of payment should be verified before the return is filed.`,
        clientAction: "Provide payment confirmations, bank records, vouchers, or tax-agency account transcripts showing the date and amount of each payment.",
        professionalAction: "Reconcile each payment to the correct tax year and agency and confirm that all payments are included in the projection and return.",
        priority: "medium",
        servicePath: "Tax Preparation",
        flaggedAmount: totalEstimatedPayments,
        sourceField: "estimated-payments"
      }));
    }

    if (projectedResult < 0) {
      alerts.push(createSmartAlert({
        id: "smart-estimated-payment-need",
        alertType: "tax-exposure",
        title: totalEstimatedPayments > 0
          ? "Reconcile projected balance with estimated payments"
          : "Review estimated-tax payment need",
        detail: totalEstimatedPayments > 0
          ? "The current withholding projection shows a balance due and estimated payments were entered. Confirm that the payments are included correctly and determine whether additional payment or withholding action is needed."
          : "The current withholding projection shows a balance due and no estimated payments were entered. Review whether an estimated payment or withholding adjustment should be considered.",
        clientAction: "Provide current income records, withholding details, and proof of any estimated payments already made.",
        professionalAction: "Recalculate the projection using verified payments and determine the appropriate next payment or withholding action.",
        priority: "high",
        servicePath: "Tax Planning Meeting",
        flaggedAmount: Math.abs(projectedResult),
        sourceField: "projected-balance"
      }));
    }

    if (hasInstallmentAgreement) {
      const needsReview = installmentStatus !== "current";
      alerts.push(createSmartAlert({
        id: "smart-installment-agreement",
        alertType: "risk-action",
        title: needsReview
          ? "Review IRS installment agreement status"
          : "Protect IRS installment agreement compliance",
        detail: needsReview
          ? "An IRS installment agreement was identified, but the current status is not confirmed. Payment compliance, filing compliance, and any new balance-due exposure should be reviewed promptly."
          : "An active IRS installment agreement was identified. Current payments, filing compliance, and the risk of creating a new unpaid balance should be monitored.",
        clientAction: "Provide the agreement notice, recent payment history, current IRS notices, and confirmation that required returns have been filed.",
        professionalAction: "Verify the agreement status, payment compliance, filing compliance, and whether the current-year projection could create a new balance.",
        priority: needsReview ? "urgent" : "high",
        servicePath: "IRS Resolution Review",
        sourceField: "installment-agreement"
      }));
    }

    if (hasBusinessActivity) {
      alerts.push(createSmartAlert({
        id: "smart-business-owner-review",
        alertType: "risk-action",
        title: "Complete a small-business owner tax review",
        detail: businessNetProfit > 0
          ? `${money(businessNetProfit)} of estimated net business profit was entered. Business income, expenses, records, entity structure, estimated taxes, retirement opportunities, and owner compensation should be reviewed together.`
          : "Business or self-employment activity was identified. Business income, expenses, records, entity structure, estimated taxes, retirement opportunities, and owner compensation should be reviewed together.",
        clientAction: "Provide year-to-date profit and loss reports, bank and credit-card statements, mileage records, payroll information, entity documents, and estimated-payment records.",
        professionalAction: "Review the books, tax classification, owner activity, estimated-tax exposure, retirement-plan opportunities, and any business deductions requiring documentation.",
        priority: "high",
        servicePath: "Small-Business Tax Planning",
        flaggedAmount: businessNetProfit,
        sourceField: "business-activity"
      }));

      if (businessNetProfit > 0 && totalEstimatedPayments <= 0) {
        alerts.push(createSmartAlert({
          id: "smart-business-estimated-tax",
          alertType: "tax-exposure",
          title: "Review business estimated-tax exposure",
          detail: `${money(businessNetProfit)} of estimated net business profit was entered and no federal or state estimated payments were entered. The current-year payment need should be reviewed before year-end or the next payment deadline.`,
          clientAction: "Provide current profit and loss reports, household income, withholding, and any tax payments already made.",
          professionalAction: "Estimate the federal and state tax exposure, coordinate it with household withholding, and determine the next payment or withholding action.",
          priority: "high",
          servicePath: "Small-Business Tax Planning",
          flaggedAmount: businessNetProfit,
          sourceField: "business-estimated-tax"
        }));
      }

      if (businessBooksStatus === "cleanup") {
        alerts.push(createSmartAlert({
          id: "smart-business-books-cleanup",
          alertType: "risk-action",
          title: "Complete business bookkeeping cleanup",
          detail: "The business books were marked as needing cleanup. Tax planning and return preparation may be unreliable until accounts are reconciled and missing or misclassified transactions are corrected.",
          clientAction: "Provide all business bank and credit-card statements and identify missing, personal, duplicate, or uncategorized transactions.",
          professionalAction: "Reconcile the accounts, correct classifications, document owner activity, and identify missing deductions before relying on the profit figure.",
          priority: "high",
          servicePath: "Bookkeeping Cleanup",
          flaggedAmount: businessNetProfit,
          sourceField: "business-books"
        }));
      } else if (businessBooksStatus === "unknown") {
        alerts.push(createSmartAlert({
          id: "smart-business-books-verification",
          alertType: "documentation",
          title: "Confirm whether business books are current",
          detail: "Business activity was identified, but the bookkeeping status is unknown. The reliability of the profit figure and available deductions should be verified.",
          clientAction: "Provide the current profit and loss report, balance sheet if available, and all business bank and credit-card statements.",
          professionalAction: "Confirm whether the books are reconciled and complete before using the business profit for planning or return preparation.",
          priority: "review",
          servicePath: "Bookkeeping Review",
          flaggedAmount: businessNetProfit,
          sourceField: "business-books"
        }));
      }
    }

    const sortedAlerts = sortActions(alerts);
    const counts = {
      "tax-savings": 0,
      "tax-exposure": 0,
      "risk-action": 0,
      "documentation": 0
    };

    sortedAlerts.forEach((alert) => {
      if (Object.prototype.hasOwnProperty.call(counts, alert.alertType)) {
        counts[alert.alertType] += 1;
      }
    });

    const urgentCount = sortedAlerts.filter((alert) => alert.priority === "urgent").length;
    const highCount = sortedAlerts.filter((alert) => alert.priority === "high").length;
    const highestPriority = sortedAlerts[0]?.priority || "monitor";

    let status = "No active alerts";
    if (sortedAlerts.length) status = "Smart Alerts ready for review";
    if (highCount > 0) status = "High-priority review needed";
    if (urgentCount > 0) status = "Urgent client action required";

    return {
      alerts: sortedAlerts,
      totalCount: sortedAlerts.length,
      savingsCount: counts["tax-savings"],
      exposureCount: counts["tax-exposure"],
      riskCount: counts["risk-action"],
      documentationCount: counts.documentation,
      urgentCount,
      highCount,
      highestPriority,
      status
    };
  }


  function cleanScenarioText(value, fallback = "Not confirmed") {
    const text = String(value ?? "").trim();
    return text && text !== "unknown" ? text : fallback;
  }

  function lifeEventRecommendation(item) {
    return {
      id: item.id,
      source: "life-event-scenario",
      category: item.category,
      title: item.title,
      detail: item.detail,
      clientAction: item.clientAction,
      professionalAction: item.professionalAction,
      estimatedBenefit: 0,
      priority: item.priority,
      priorityRank: PRIORITY_RANK[item.priority] ?? PRIORITY_RANK.review,
      impact: item.impact,
      servicePath: item.servicePath,
      opportunityKey: item.key
    };
  }

  function buildLifeEventScenarios(input = {}) {
    const items = [];
    const lottery = input?.lottery || {};
    const adoption = input?.adoption || {};
    const cashHome = input?.cashHome || {};
    const stockSale = input?.stockSale || {};
    const businessPurchase = input?.businessPurchase || {};
    const earlyRetirement = input?.earlyRetirement || {};
    const spouseDebt = input?.spouseDebt || {};
    const deathOfLovedOne = input?.deathOfLovedOne || {};

    if (lottery.selected) {
      const amount = Math.round(numberOrZero(lottery.amount));
      const federalWithholding = Math.round(numberOrZero(lottery.federalWithholding));
      const stateWithholding = Math.round(numberOrZero(lottery.stateWithholding));
      const payoutType = cleanScenarioText(lottery.payoutType);

      items.push({
        key: "lottery",
        id: "life-event-lottery",
        title: "Review lottery or major gambling winnings",
        category: "tax-exposure",
        priority: "high",
        priorityRank: PRIORITY_RANK.high,
        impact: "Potential Tax Exposure",
        statusLabel: "Income and payment review",
        amount,
        detail: `${amount > 0 ? `${money(amount)} of winnings or prize value` : "Lottery or gambling winnings"} were reported. Review taxable income, federal and state withholding, payout timing, estimated-payment needs, and the effect on credits, deductions, and the total return. Payout type: ${payoutType}.`,
        clientAction: "Provide every W-2G, award statement, payout agreement, proof of federal and state withholding, and the date the winnings or prize were received.",
        professionalAction: "Reconcile the reported winnings and withholding, review federal and state treatment, update the full-year projection, and determine whether an estimated payment or withholding adjustment should be considered.",
        documents: ["W-2G or prize statement", "Payout agreement", "Proof of withholding", "Payment date"],
        servicePath: "Tax Planning Review",
        caution: "The amount won is not the amount of tax due. The complete income picture and current-law rules must be reviewed."
      });
    }

    if (adoption.selected) {
      const expenses = Math.round(numberOrZero(adoption.expenses));
      const benefits = Math.round(numberOrZero(adoption.employerBenefits));
      const adoptionType = cleanScenarioText(adoption.type);
      const status = cleanScenarioText(adoption.status);

      items.push({
        key: "adoption",
        id: "life-event-adoption",
        title: "Review adoption tax credit and employer-benefit eligibility",
        category: "tax-savings",
        priority: "medium",
        priorityRank: PRIORITY_RANK.medium,
        impact: "Potential Tax Opportunity",
        statusLabel: "Eligibility and timing review",
        amount: expenses,
        detail: `${expenses > 0 ? `${money(expenses)} of adoption expenses` : "Adoption expenses"} and ${benefits > 0 ? `${money(benefits)} of employer benefits` : "no confirmed employer-benefit amount"} were entered. Adoption type: ${adoptionType}. Status: ${status}. Eligibility, timing, income limits, employer assistance, and documentation must be verified before estimating a credit.`,
        clientAction: "Provide itemized adoption expenses, proof of payment, agency and attorney records, employer adoption assistance, and documents showing the adoption type and current status.",
        professionalAction: "Verify qualified expenses, timing rules, employer-benefit coordination, income limitations, special-needs treatment when applicable, and the amount that can be used in the active tax year.",
        documents: ["Expense ledger", "Receipts and proof of payment", "Agency or legal records", "Employer-benefit statement"],
        servicePath: "Tax Planning Review",
        caution: "The amount paid is not automatically the credit amount. Eligibility, annual limits, timing, and phase-outs apply."
      });
    }

    if (cashHome.selected) {
      const purchasePrice = Math.round(numberOrZero(cashHome.purchasePrice));
      const closingCosts = Math.round(numberOrZero(cashHome.closingCosts));
      const propertyTax = Math.round(numberOrZero(cashHome.propertyTax));
      const use = cleanScenarioText(cashHome.use);

      items.push({
        key: "cash-home",
        id: "life-event-cash-home",
        title: "Document cash home purchase, basis, and homeowner tax items",
        category: "documentation",
        priority: "medium",
        priorityRank: PRIORITY_RANK.medium,
        impact: "Documentation and Future Tax Planning",
        statusLabel: "Basis and property-use review",
        amount: purchasePrice,
        detail: `${purchasePrice > 0 ? `${money(purchasePrice)} cash purchase price` : "A cash home purchase"} was entered, with ${money(closingCosts)} of closing costs and ${money(propertyTax)} of property tax reported. Intended use: ${use}. The purchase price itself is not automatically a current deduction; basis, deductible taxes, closing items, improvements, and business or rental use must be separated correctly.`,
        clientAction: "Provide the closing disclosure or settlement statement, deed, proof of payment, property-tax records, improvement records, and the intended personal, rental, or business use.",
        professionalAction: "Establish starting basis, identify capitalizable closing costs, separate potentially deductible taxes from basis items, and review depreciation or home-office implications when the property has business or rental use.",
        documents: ["Closing statement", "Proof of cash purchase", "Deed", "Property-tax records", "Improvement records"],
        servicePath: "Tax Planning Review",
        caution: "Paying cash does not make the purchase price deductible. Good basis records may be important for depreciation and a future sale."
      });
    }

    if (stockSale.selected) {
      const proceeds = Math.round(numberOrZero(stockSale.proceeds));
      const basis = Math.round(numberOrZero(stockSale.basis));
      const estimatedGain = proceeds - basis;
      const holding = cleanScenarioText(stockSale.holding);
      const docs = cleanScenarioText(stockSale.docs);
      const basisMissing = proceeds > 0 && basis <= 0;
      const priority = basisMissing || stockSale.docs === "missing" || stockSale.docs === "missing-basis"
        ? "high"
        : "medium";

      items.push({
        key: "stock-sale",
        id: "life-event-stock-sale",
        title: "Review investment sale, basis, and capital-gain treatment",
        category: "tax-exposure",
        priority,
        priorityRank: PRIORITY_RANK[priority],
        impact: estimatedGain >= 0 ? "Potential Tax Exposure" : "Potential Capital Loss Review",
        statusLabel: basisMissing ? "Basis information required" : "Gain or loss review",
        amount: Math.max(proceeds, Math.abs(estimatedGain)),
        detail: `${money(proceeds)} of proceeds and ${money(basis)} of known basis were entered. The preliminary difference is ${money(estimatedGain)}, but the final gain or loss depends on adjusted basis, transaction details, holding period, wash-sale adjustments, and complete brokerage reporting. Holding period: ${holding}. Documents: ${docs}.`,
        clientAction: "Provide the complete consolidated brokerage statement, every Form 1099-B, acquisition records for any missing basis, and records of prior transfers, reinvested dividends, splits, or inherited or gifted property.",
        professionalAction: "Reconcile proceeds and basis, separate short- and long-term transactions, identify adjustments, review capital-loss treatment, and update the tax projection before year-end or filing.",
        documents: ["1099-B", "Consolidated brokerage statement", "Basis records", "Acquisition and sale dates"],
        servicePath: "Tax Planning Review",
        caution: "Proceeds are not the taxable gain. The taxable result generally depends on adjusted basis and transaction-specific rules."
      });
    }

    if (businessPurchase.selected) {
      const purchasePrice = Math.round(numberOrZero(businessPurchase.purchasePrice));
      const purchaseType = cleanScenarioText(businessPurchase.purchaseType);
      const entity = cleanScenarioText(businessPurchase.entity);
      const books = cleanScenarioText(businessPurchase.books);

      items.push({
        key: "business-purchase",
        id: "life-event-business-purchase",
        title: "Review new business purchase and tax setup",
        category: "business",
        priority: "high",
        priorityRank: PRIORITY_RANK.high,
        impact: "Business Tax and Compliance Review",
        statusLabel: "Business acquisition review",
        amount: purchasePrice,
        detail: `${purchasePrice > 0 ? `${money(purchasePrice)} business purchase price` : "A new business purchase or startup"} was entered. Structure: ${purchaseType}. Entity: ${entity}. Accounting records: ${books}. The tax treatment depends on what was acquired, purchase-price allocation, entity ownership, financing, opening balances, payroll, licenses, and the date operations began.`,
        clientAction: "Provide the purchase agreement, closing statement, asset list, allocation schedules, financing documents, entity documents, tax IDs, licenses, opening bank records, and the first accounting records.",
        professionalAction: "Determine whether the transaction was an asset purchase, ownership-interest purchase, or startup; review purchase-price allocation, basis, depreciation or amortization, entity setup, payroll, estimated taxes, and bookkeeping readiness.",
        documents: ["Purchase agreement", "Asset and allocation schedules", "Financing documents", "Entity records", "Opening books and bank statements"],
        servicePath: "Business Tax Intelligence™ Assessment",
        caution: "A business purchase should be reviewed before the first tax return, payroll filing, owner payment, or major year-end decision."
      });
    }

    if (earlyRetirement.selected) {
      const gross = Math.round(numberOrZero(earlyRetirement.gross));
      const taxable = Math.round(numberOrZero(earlyRetirement.taxable));
      const withholding = Math.round(numberOrZero(earlyRetirement.withholding));
      const age = numberOrZero(earlyRetirement.age);
      const code = cleanScenarioText(earlyRetirement.code);
      const exception = cleanScenarioText(earlyRetirement.exception);
      const possibleEarly = age > 0 && age < 59.5;
      const priority = possibleEarly || earlyRetirement.exception === "unknown"
        ? "high"
        : "medium";

      items.push({
        key: "early-retirement",
        id: "life-event-early-retirement",
        title: "Review early 1099-R distribution and possible additional tax",
        category: "tax-exposure",
        priority,
        priorityRank: PRIORITY_RANK[priority],
        impact: "Potential Tax Exposure",
        statusLabel: possibleEarly ? "Early-distribution review" : "Retirement-distribution review",
        amount: gross,
        detail: `${money(gross)} gross distribution, ${money(taxable)} taxable amount, and ${money(withholding)} federal withholding were entered. Age at distribution: ${age || "not confirmed"}. Box 7 code: ${code}. Exception or rollover: ${exception}. Income tax and a possible additional tax must be reviewed using the complete Form 1099-R facts.`,
        clientAction: "Provide every page of Form 1099-R, the retirement account statement, rollover documentation, proof of any returned funds, and records supporting any claimed exception.",
        professionalAction: "Verify the taxable amount, distribution code, age, rollover treatment, withholding, applicable exception, Form 5329 reporting, state treatment, and whether an additional payment is needed.",
        documents: ["Form 1099-R", "Account statement", "Rollover proof", "Exception documentation"],
        servicePath: "Tax Planning Review",
        caution: "An early distribution may be subject to regular income tax and an additional tax unless a specific exception applies."
      });
    }

    if (spouseDebt.selected) {
      const event = cleanScenarioText(spouseDebt.event);
      const debtYears = cleanScenarioText(spouseDebt.debtYears);
      const filing = cleanScenarioText(spouseDebt.filing);
      const offset = cleanScenarioText(spouseDebt.offset);
      const notice = cleanScenarioText(spouseDebt.notice);
      const state = cleanScenarioText(spouseDebt.state);
      const urgent = spouseDebt.offset === "yes" ||
        spouseDebt.offset === "expected" ||
        spouseDebt.notice === "yes";

      items.push({
        key: "spouse-debt",
        id: "life-event-spouse-debt",
        title: "Review marriage, divorce, and spouse tax-debt responsibility",
        category: "risk-action",
        priority: urgent ? "urgent" : "high",
        priorityRank: PRIORITY_RANK[urgent ? "urgent" : "high"],
        impact: "Tax Liability and Refund Protection Review",
        statusLabel: urgent ? "Notice or refund-offset review" : "Responsibility review",
        amount: 0,
        detail: `Relationship event: ${event}. Debt year(s): ${debtYears}. Filing situation: ${filing}. Refund offset: ${offset}. Notice: ${notice}. State: ${state}. A spouse's tax debt from before marriage is not automatically divided 50/50, but joint returns, refund offsets, community-property rules, later joint-return liabilities, and the exact tax years can change the result.`,
        clientAction: "Provide the IRS or state account notices, prior returns for the affected years, marriage or divorce dates, refund-offset notice, current filing status, and any divorce decree or separation agreement.",
        professionalAction: "Separate premarital debt from joint-return liability, identify which returns created the balance, review refund-offset exposure, community-property rules, injured-spouse or innocent-spouse relief, and determine whether legal counsel or IRS representation is appropriate.",
        documents: ["IRS or state notices", "Affected tax returns", "Refund-offset notice", "Marriage or divorce dates", "Divorce decree when applicable"],
        servicePath: urgent ? "Spouse Tax Relief / IRS Review" : "Tax Planning Review",
        caution: "Do not assume you owe half—or nothing—until the tax years, return signatures, state rules, notices, and refund history are reviewed."
      });
    }

    if (deathOfLovedOne.selected) {
      const relationship = cleanScenarioText(deathOfLovedOne.relationship);
      const role = cleanScenarioText(deathOfLovedOne.role);
      const dateOfDeath = cleanScenarioText(deathOfLovedOne.dateOfDeath);
      const jointReturn = cleanScenarioText(deathOfLovedOne.jointReturn);
      const inheritedAssets = cleanScenarioText(deathOfLovedOne.inheritedAssets);
      const beneficiaryStatus = cleanScenarioText(
        deathOfLovedOne.beneficiaryStatus,
        "Not applicable / not confirmed"
      );
      const inheritedValue = Math.round(numberOrZero(deathOfLovedOne.inheritedValue));
      const inheritedAssetLabels = {
        "life-insurance": "Life insurance proceeds",
        "cash": "Cash",
        "home-property": "Home or other real property",
        "investments": "Stocks, investments, or brokerage assets",
        "retirement": "IRA, 401(k), pension, or other retirement account",
        "business": "Business ownership or business assets",
        "mixed": "More than one type of asset",
        "none": "Nothing received"
      };
      const inheritedAssetLabel =
        inheritedAssetLabels[deathOfLovedOne.inheritedAssets] || inheritedAssets;
      const beneficiaryLabels = {
        "primary": "Named primary beneficiary",
        "contingent": "Named contingent beneficiary",
        "estate": "The estate was named beneficiary",
        "other": "Another person or trust was named beneficiary",
        "not-applicable": "Not applicable / no life insurance"
      };
      const beneficiaryLabel =
        beneficiaryLabels[deathOfLovedOne.beneficiaryStatus] || beneficiaryStatus;
      const lifeInsuranceSelected =
        deathOfLovedOne.inheritedAssets === "life-insurance" ||
        deathOfLovedOne.inheritedAssets === "mixed";
      const knownTaxDebt = cleanScenarioText(deathOfLovedOne.knownTaxDebt);
      const estateDistributed = cleanScenarioText(deathOfLovedOne.estateDistributed);
      const notice = cleanScenarioText(deathOfLovedOne.notice);
      const urgent =
        deathOfLovedOne.notice === "yes" ||
        (
          deathOfLovedOne.knownTaxDebt === "yes" &&
          (
            deathOfLovedOne.estateDistributed === "partial" ||
            deathOfLovedOne.estateDistributed === "yes"
          )
        );

      items.push({
        key: "death-of-loved-one",
        id: "life-event-death-of-loved-one",
        title: "Review tax responsibilities after the death of a spouse or parent",
        category: "risk-action",
        priority: urgent ? "urgent" : "high",
        priorityRank: PRIORITY_RANK[urgent ? "urgent" : "high"],
        impact: "Estate, Survivor, and Inheritance Tax Review",
        statusLabel: urgent ? "Tax notice or estate-distribution review" : "Survivor and estate responsibility review",
        amount: inheritedValue,
        detail: `Relationship: ${relationship}. Role: ${role}. Date of death: ${dateOfDeath}. Joint-return status: ${jointReturn}. What was inherited or received: ${inheritedAssetLabel}. Life insurance beneficiary designation: ${beneficiaryLabel}. Estimated value received: ${money(inheritedValue)}. Known tax debt: ${knownTaxDebt}. Estate distribution status: ${estateDistributed}. IRS or state notice: ${notice}. A spouse or child is not automatically personally responsible for the deceased person's taxes merely because of the relationship. The final individual return and the estate's income-tax return are separate matters. ${lifeInsuranceSelected ? "Life insurance proceeds paid because of the insured person's death are generally not included in the beneficiary's gross income, but interest, installment terms, ownership, transfer, or estate-beneficiary facts may require separate review. " : ""}Responsibility can change when a surviving spouse signs a joint return, a person serves as executor or personal representative, estate assets are distributed before taxes are resolved, inherited retirement accounts create taxable distributions, or a beneficiary receives estate income.`,
        clientAction: `Provide the death certificate, will or trust, letters of appointment if you are the executor or personal representative, prior and final tax records, IRS or state notices, estate bank records, asset and beneficiary statements, inherited retirement-account documents, property valuations, and any Schedule K-1 received from the estate.${lifeInsuranceSelected ? " Also provide the life insurance policy or beneficiary designation, claim or settlement statement, payment election, and any Form 1099-INT or other tax form from the insurer." : ""}`,
        professionalAction: `Determine who is responsible for the final Form 1040, whether a surviving spouse should file jointly or separately for the year of death, whether the estate needs Form 1041 or another return, whether inherited retirement distributions or estate income are taxable to the beneficiary, what basis records are needed for inherited property, whether unpaid tax belongs to the estate or a jointly filed return, and whether estate or legal counsel should be involved.${lifeInsuranceSelected ? " Verify who was named beneficiary, whether proceeds were paid directly or through the estate, and whether any interest or other taxable amount was included in the insurance settlement." : ""}`,
        documents: [
          "Death certificate",
          "Will or trust",
          "Executor / personal representative papers",
          "Prior and final tax records",
          "IRS or state notices",
          "Estate bank and asset statements",
          ...(lifeInsuranceSelected
            ? [
                "Life insurance policy or beneficiary designation",
                "Insurance claim or settlement statement",
                "Form 1099-INT or other insurer tax form"
              ]
            : []),
          "Inherited retirement-account records",
          "Property valuations and estate Schedule K-1"
        ],
        servicePath: urgent ? "Estate / Survivor Tax Review" : "Tax Planning Review",
        caution: "Do not assume you owe the deceased person's taxes—or that you owe nothing—until the signed returns, estate role, assets received, distributions made, notices, and applicable federal and state rules are reviewed."
      });
    }

    const sortedItems = [...items].sort((a, b) =>
      (a.priorityRank - b.priorityRank) ||
      String(a.title).localeCompare(String(b.title))
    );

    const recommendations = sortedItems.map(lifeEventRecommendation);
    const urgentCount = sortedItems.filter((item) => item.priority === "urgent").length;
    const highCount = sortedItems.filter((item) =>
      item.priority === "urgent" || item.priority === "high"
    ).length;
    const totalReportedAmount = sortedItems.reduce(
      (total, item) => total + numberOrZero(item.amount),
      0
    );
    const highestPriority = sortedItems[0]?.priority || "review";
    const priorityLabels = {
      urgent: "Immediate review",
      high: "High-priority review",
      medium: "Planning review",
      review: "Professional review",
      monitor: "Monitor"
    };

    return {
      items: sortedItems,
      recommendations,
      selectedCount: sortedItems.length,
      urgentCount,
      highCount,
      totalReportedAmount: Math.round(totalReportedAmount),
      highestPriority,
      highestPriorityLabel: sortedItems.length
        ? priorityLabels[highestPriority] || "Professional review"
        : "Not started",
      status: sortedItems.length
        ? urgentCount > 0
          ? "Immediate professional review identified"
          : highCount > 0
            ? "High-priority life event review identified"
            : "Life event planning review ready"
        : "Select a real-life event to begin",
      boundaryNote: "Life Event Tax Scenarios organize tax questions, documents, possible exposure or opportunity, and next actions. They do not create a filed return, legal conclusion, investment recommendation, or guaranteed tax result."
    };
  }

  function actionToRecommendation(action) {
    return {
      id: action.id,
      source: action.source,
      category: action.category,
      title: action.title,
      detail: action.detail,
      clientAction: action.clientAction,
      professionalAction: action.professionalAction,
      estimatedBenefit: action.estimatedBenefit,
      priority: action.priority,
      priorityRank: action.priorityRank,
      impact: action.impact,
      servicePath: action.servicePath,
      opportunityKey: action.opportunityKey
    };
  }

  function buildRecommendations(input, opportunitySummary, smartAlertResult = null, lifeEventResult = null) {
    const maximum = Math.max(1, Math.round(numberOrZero(input?.maxRecommendations) || 4));
    const withholdingRecommendation = buildWithholdingRecommendation(input);
    const opportunityRecommendations = (opportunitySummary?.actions || []).map(actionToRecommendation);
    const smartAlertRecommendations = Array.isArray(smartAlertResult?.alerts)
      ? smartAlertResult.alerts
      : [];
    const lifeEventRecommendations = Array.isArray(lifeEventResult?.recommendations)
      ? lifeEventResult.recommendations
      : [];
    const recommendations = [
      withholdingRecommendation,
      ...opportunityRecommendations,
      ...lifeEventRecommendations,
      ...smartAlertRecommendations
    ];

    const deduplicated = [];
    const seen = new Set();

    sortActions(recommendations).forEach((recommendation) => {
      if (!recommendation.id || seen.has(recommendation.id)) return;
      seen.add(recommendation.id);
      deduplicated.push(recommendation);
    });

    return deduplicated.slice(0, maximum);
  }

  function getOpportunityStages() {
    return OPPORTUNITY_STAGE_DEFINITIONS.map((stage) => ({ ...stage }));
  }

  function getOpportunityStage(key) {
    const stage = OPPORTUNITY_STAGE_MAP.get(String(key || ""));
    return stage ? { ...stage } : null;
  }

  function normalizeScorecardRecords(recommendations, records) {
    const source = records && typeof records === "object" ? records : {};

    return sortActions(recommendations || []).reduce((normalized, recommendation) => {
      const record = source[recommendation.id] && typeof source[recommendation.id] === "object"
        ? source[recommendation.id]
        : {};
      const requestedStage = String(record.stage || "potential");
      const stage = OPPORTUNITY_STAGE_MAP.has(requestedStage)
        ? requestedStage
        : "potential";

      normalized[recommendation.id] = {
        stage,
        verifiedBenefit: Math.round(numberOrZero(record.verifiedBenefit)),
        notes: String(record.notes || "").slice(0, 5000)
      };

      return normalized;
    }, {});
  }

  function buildClientExplanation(recommendation, stageKey, verifiedBenefit = 0) {
    const stage = OPPORTUNITY_STAGE_MAP.get(String(stageKey || "")) ||
      OPPORTUNITY_STAGE_MAP.get("potential");
    const title = String(recommendation?.title || "This planning item");
    const potentialBenefit = Math.round(numberOrZero(recommendation?.estimatedBenefit));
    const verifiedAmount = Math.round(numberOrZero(verifiedBenefit));

    if (stage.key === "under-review") {
      return `${title} is under professional review. I am checking the facts, eligibility rules, supporting documents, and tax treatment before recommending that you take action.`;
    }

    if (stage.key === "client-action") {
      return `${title} needs information, documents, or action from you before I can complete the review. The amount shown remains a potential estimate until the missing items are received and verified.`;
    }

    if (stage.key === "verified") {
      const amountText = verifiedAmount > 0
        ? ` The current verified estimate is ${money(verifiedAmount)}.`
        : " The opportunity appears available, but a verified dollar estimate has not yet been entered.";
      return `${title} has been reviewed and appears to be available based on the information provided.${amountText} The final result may change if the client's facts or final tax-return information changes.`;
    }

    if (stage.key === "completed") {
      const amountText = verifiedAmount > 0
        ? ` The documented estimate is ${money(verifiedAmount)}.`
        : " No verified dollar amount is recorded for this item.";
      return `${title} has been completed and documented.${amountText} The final tax-return result remains subject to the complete filing information.`;
    }

    if (stage.key === "not-applicable") {
      return `${title} was reviewed and does not apply based on the information currently available. No tax benefit is being claimed or promised for this item.`;
    }

    const amountText = potentialBenefit > 0
      ? ` The Planner currently estimates a potential benefit of ${money(potentialBenefit)}.`
      : " A reliable dollar estimate is not available yet.";

    return `${title} was identified as a potential opportunity based on the information currently entered.${amountText} This is not a guaranteed tax benefit. I need to confirm eligibility, supporting documents, deadlines, and the tax treatment before recommending any action.`;
  }

  function buildOpportunityScorecard(recommendations, records = {}) {
    const normalizedRecords = normalizeScorecardRecords(recommendations, records);
    const items = sortActions(recommendations || []).map((recommendation, index) => {
      const record = normalizedRecords[recommendation.id];
      const stage = OPPORTUNITY_STAGE_MAP.get(record.stage) ||
        OPPORTUNITY_STAGE_MAP.get("potential");

      return {
        ...recommendation,
        scorecardOrder: index + 1,
        stage: stage.key,
        stageLabel: stage.label,
        stageSummary: stage.summary,
        stageTone: stage.tone,
        stageWeight: stage.weight,
        verifiedBenefit: record.verifiedBenefit,
        notes: record.notes,
        clientExplanation: buildClientExplanation(
          recommendation,
          stage.key,
          record.verifiedBenefit
        )
      };
    });

    const applicableItems = items.filter((item) => item.stage !== "not-applicable");
    const countByStage = OPPORTUNITY_STAGE_DEFINITIONS.reduce((counts, stage) => {
      counts[stage.key] = items.filter((item) => item.stage === stage.key).length;
      return counts;
    }, {});

    const potentialBenefit = applicableItems.reduce(
      (total, item) => total + numberOrZero(item.estimatedBenefit),
      0
    );
    const verifiedBenefit = applicableItems
      .filter((item) => item.stage === "verified" || item.stage === "completed")
      .reduce((total, item) => total + numberOrZero(item.verifiedBenefit), 0);
    const readinessScore = applicableItems.length
      ? Math.round(
          applicableItems.reduce((total, item) => total + item.stageWeight, 0) /
          applicableItems.length
        )
      : 0;

    let status = "Not started";
    if (items.length) status = "Potential opportunities identified";
    if (countByStage.verified > 0) status = "Verified opportunities identified";
    if (countByStage["under-review"] > 0) status = "Professional review in progress";
    if (countByStage["client-action"] > 0) status = "Client action required";
    if (
      applicableItems.length > 0 &&
      countByStage.completed === applicableItems.length
    ) {
      status = "Opportunity plan completed";
    }

    return {
      items,
      records: normalizedRecords,
      totalCount: items.length,
      applicableCount: applicableItems.length,
      potentialCount: countByStage.potential || 0,
      reviewCount: countByStage["under-review"] || 0,
      clientActionCount: countByStage["client-action"] || 0,
      verifiedCount: countByStage.verified || 0,
      completedCount: countByStage.completed || 0,
      notApplicableCount: countByStage["not-applicable"] || 0,
      potentialBenefit: Math.round(potentialBenefit),
      verifiedBenefit: Math.round(verifiedBenefit),
      readinessScore,
      status
    };
  }

  function getScorecardItem(scorecard, recommendationId) {
    return (scorecard?.items || []).find(
      (item) => String(item.id || "") === String(recommendationId || "")
    ) || null;
  }

  function isScorecardItemResolved(scorecard, recommendationId) {
    const item = getScorecardItem(scorecard, recommendationId);
    return Boolean(
      item &&
      (item.stage === "completed" || item.stage === "not-applicable")
    );
  }

  function immediateActionConsequence(recommendation) {
    const id = String(recommendation?.id || "");

    if (id === "opportunity-notice") {
      return "Waiting may reduce the time available to respond, increase penalties or interest, or allow IRS collection or adjustment activity to continue.";
    }

    if (id === "smart-installment-agreement") {
      return "A missed payment, unfiled return, or new unpaid balance can place the agreement at risk and may restart collection activity.";
    }

    if (id === "opportunity-transcript") {
      return "Missing IRS records can delay filing, prevent accurate return preparation, or leave an unresolved balance or filing issue undiscovered.";
    }

    return "Delaying this item may increase tax exposure, penalties, interest, missed deadlines, or the cost of correcting the issue later.";
  }

  function immediateActionTiming(recommendation) {
    const id = String(recommendation?.id || "");

    if (id === "opportunity-notice") {
      return "Today — upload every page before the response deadline is missed.";
    }

    if (id === "smart-installment-agreement") {
      return "Today — confirm the next payment date and current compliance status.";
    }

    if (id === "opportunity-transcript") {
      return "As soon as possible — begin the record-recovery process before filing work continues.";
    }

    return "Act now — complete the requested step before the next tax deadline or appointment.";
  }

  function buildImmediateAction(recommendations, scorecard) {
    const unresolvedUrgent = sortActions(recommendations || []).filter(
      (recommendation) =>
        recommendation.priority === "urgent" &&
        !isScorecardItemResolved(scorecard, recommendation.id)
    );

    const primary = unresolvedUrgent[0] || null;

    if (!primary) {
      return {
        active: false,
        count: 0,
        title: "",
        whyUrgent: "",
        consequence: "",
        nextAction: "",
        professionalAction: "",
        timing: "",
        servicePath: ""
      };
    }

    return {
      active: true,
      count: unresolvedUrgent.length,
      recommendationId: primary.id,
      title: primary.title,
      whyUrgent: primary.detail,
      consequence: immediateActionConsequence(primary),
      nextAction: primary.clientAction,
      professionalAction: primary.professionalAction,
      timing: immediateActionTiming(primary),
      servicePath: primary.servicePath || "Urgent Tax Review"
    };
  }

  function healthCategory(key, label, score, maximum, summary) {
    return {
      key,
      label,
      score: Math.max(0, Math.min(maximum, Math.round(score))),
      maximum,
      summary
    };
  }

  function buildTaxHealthProgress(
    input,
    opportunitySummary,
    smartAlerts,
    scorecard
  ) {
    const hasWithholdingData = input?.hasWithholdingData !== false;
    const combinedResult = signedNumberOrZero(input?.combinedWithholdingResult);
    const targetBand = Math.max(
      100,
      numberOrZero(input?.withholdingTargetBand) || 100
    );
    const alerts = Array.isArray(smartAlerts?.alerts)
      ? smartAlerts.alerts
      : [];
    const scorecardItems = Array.isArray(scorecard?.items)
      ? scorecard.items
      : [];
    const isStarted = Boolean(
      hasWithholdingData ||
      numberOrZero(opportunitySummary?.selectedCount) > 0 ||
      alerts.length > 0 ||
      scorecardItems.length > 1
    );

    const strengths = [];
    const nextActions = [];
    const blockers = [];
    const categories = [];

    let withholdingScore = 0;
    if (!hasWithholdingData) {
      nextActions.push({
        id: "health-complete-withholding",
        title: "Complete the Withholding Checkup",
        detail: "Enter current wages, other income, federal and state withholding, and filing information.",
        points: 30,
        priority: "high",
        category: "Withholding & payment readiness"
      });
    } else if (Math.abs(combinedResult) <= targetBand) {
      withholdingScore = 30;
      strengths.push("Withholding is currently close to the combined estimated tax.");
    } else if (combinedResult > targetBand) {
      withholdingScore = 22;
      strengths.push("Current withholding information is complete and usable for planning.");
      nextActions.push({
        id: "health-review-overwithholding",
        title: "Review projected overwithholding",
        detail: "Confirm whether improving current cash flow is more important than receiving a larger refund.",
        points: 8,
        priority: "medium",
        category: "Withholding & payment readiness"
      });
    } else {
      withholdingScore = 12;
      nextActions.push({
        id: "health-address-balance",
        title: "Address the projected balance due",
        detail: "Review additional withholding or estimated payments using verified current-year information.",
        points: 18,
        priority: "high",
        category: "Withholding & payment readiness"
      });
    }

    categories.push(healthCategory(
      "withholding",
      "Withholding & payment readiness",
      withholdingScore,
      30,
      withholdingScore === 30
        ? "Projection is currently aligned."
        : "Additional review can improve payment readiness."
    ));

    const applicableItems = scorecardItems.filter(
      (item) => item.stage !== "not-applicable" &&
        item.id !== "withholding-complete-checkup"
    );
    let reviewScore = 0;

    if (applicableItems.length) {
      reviewScore = Math.round(
        applicableItems.reduce(
          (total, item) => total + numberOrZero(item.stageWeight),
          0
        ) / applicableItems.length * 0.30
      );

      const verifiedCount = applicableItems.filter(
        (item) => item.stage === "verified" || item.stage === "completed"
      ).length;

      if (verifiedCount > 0) {
        strengths.push(
          `${verifiedCount} planning item${verifiedCount === 1 ? " has" : "s have"} been verified or completed.`
        );
      }

      const unresolved = applicableItems.filter(
        (item) =>
          item.stage !== "verified" &&
          item.stage !== "completed"
      );

      if (unresolved.length) {
        nextActions.push({
          id: "health-advance-scorecard",
          title: "Advance unresolved Scorecard findings",
          detail: "Verify eligibility, collect missing information, and document the professional conclusion for the highest-priority items.",
          points: Math.max(1, 30 - reviewScore),
          priority: unresolved.some((item) => item.priority === "urgent")
            ? "urgent"
            : "medium",
          category: "Professional review readiness"
        });
      }
    } else {
      nextActions.push({
        id: "health-create-scorecard",
        title: "Create the Client Opportunity Scorecard",
        detail: "Complete the Tax Savings Finder and Client Tax Profile so findings can move from potential to verified or completed.",
        points: 30,
        priority: "medium",
        category: "Professional review readiness"
      });
    }

    categories.push(healthCategory(
      "review",
      "Professional review readiness",
      reviewScore,
      30,
      applicableItems.length
        ? `${Math.round(numberOrZero(scorecard?.readinessScore))}% of the identified findings are review-ready.`
        : "No review-ready findings have been documented yet."
    ));

    const unresolvedAlerts = alerts.filter(
      (alert) => !isScorecardItemResolved(scorecard, alert.id)
    );
    const documentationAlerts = unresolvedAlerts.filter(
      (alert) => alert.alertType === "documentation"
    );
    const bookkeepingAlerts = unresolvedAlerts.filter(
      (alert) =>
        alert.id === "smart-business-books-cleanup" ||
        alert.id === "opportunity-bookkeeping"
    );

    let documentationScore = isStarted ? 20 : 0;
    documentationScore -= Math.min(15, documentationAlerts.length * 5);
    documentationScore -= bookkeepingAlerts.length ? 5 : 0;
    documentationScore = Math.max(0, documentationScore);

    if (isStarted && documentationScore === 20) {
      strengths.push("No unresolved documentation alert is currently reducing the score.");
    }

    documentationAlerts.slice(0, 3).forEach((alert) => {
      nextActions.push({
        id: `health-doc-${alert.id}`,
        title: alert.title,
        detail: alert.clientAction,
        points: 5,
        priority: alert.priority || "review",
        category: "Documentation & record readiness"
      });
    });

    if (bookkeepingAlerts.length) {
      nextActions.push({
        id: "health-books-cleanup",
        title: "Complete the bookkeeping cleanup",
        detail: "Reconcile accounts and correct missing or misclassified transactions before relying on business profit.",
        points: 5,
        priority: "high",
        category: "Documentation & record readiness"
      });
    }

    categories.push(healthCategory(
      "documentation",
      "Documentation & record readiness",
      documentationScore,
      20,
      documentationScore === 20
        ? "No unresolved documentation reduction is active."
        : "Missing or unverified records are holding back points."
    ));

    const unresolvedScorecardRiskItems = scorecardItems.filter(
      (item) =>
        item.stage !== "completed" &&
        item.stage !== "not-applicable" &&
        (
          item.priority === "urgent" ||
          (
            item.priority === "high" &&
            (
              item.category === "risk-reduction" ||
              item.category === "risk-action" ||
              item.category === "tax-exposure" ||
              item.category === "cash-flow-and-risk" ||
              item.source === "smart-alerts"
            )
          )
        )
    );
    const urgentRiskItems = [
      ...unresolvedAlerts.filter((alert) => alert.priority === "urgent"),
      ...unresolvedScorecardRiskItems.filter((item) => item.priority === "urgent")
    ].filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.id === item.id) === index
    );
    const highRiskItems = [
      ...unresolvedAlerts.filter(
        (alert) =>
          alert.priority === "high" &&
          (
            alert.alertType === "risk-action" ||
            alert.alertType === "tax-exposure"
          )
      ),
      ...unresolvedScorecardRiskItems.filter((item) => item.priority === "high")
    ].filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.id === item.id) === index
    );

    let riskScore = isStarted ? 20 : 0;
    riskScore -= Math.min(20, urgentRiskItems.length * 10);
    riskScore -= Math.min(12, highRiskItems.length * 4);
    riskScore = Math.max(0, riskScore);

    if (isStarted && riskScore === 20) {
      strengths.push("No unresolved urgent or high-priority risk is currently reducing the score.");
    }

    urgentRiskItems.forEach((item) => {
      blockers.push({
        id: item.id,
        title: item.title,
        detail: item.clientAction,
        points: 10,
        priority: "urgent"
      });
    });

    highRiskItems.slice(0, 3).forEach((item) => {
      blockers.push({
        id: item.id,
        title: item.title,
        detail: item.clientAction,
        points: 4,
        priority: "high"
      });
    });

    categories.push(healthCategory(
      "risk",
      "Risk & deadline control",
      riskScore,
      20,
      riskScore === 20
        ? "No unresolved urgent or high-priority risk reduction is active."
        : "Urgent or high-priority items require action."
    ));

    const score = Math.max(
      0,
      Math.min(
        100,
        categories.reduce((total, category) => total + category.score, 0)
      )
    );

    const externalPendingIds = new Set([
      "opportunity-notice",
      "opportunity-transcript",
      "smart-installment-agreement"
    ]);
    const externalPending = scorecardItems.filter(
      (item) =>
        externalPendingIds.has(item.id) &&
        item.stage !== "completed" &&
        item.stage !== "not-applicable"
    );
    const attainableReduction = Math.min(15, externalPending.length * 5);
    const attainableScore = Math.max(score, 100 - attainableReduction);

    externalPending.forEach((item) => {
      blockers.push({
        id: `pending-${item.id}`,
        title: `${item.title}: outside confirmation still pending`,
        detail: "The final points remain pending until the required IRS record, notice review, or agreement confirmation is received and documented.",
        points: 5,
        priority: "review"
      });
    });

    const milestoneOptions = [60, 70, 80, 90, 95, 100];
    let nextMilestone = milestoneOptions.find(
      (milestone) => milestone > score && milestone <= attainableScore
    );

    if (!nextMilestone) {
      nextMilestone = attainableScore > score
        ? attainableScore
        : Math.min(100, Math.max(score, attainableScore));
    }

    const sortedNextActions = [...nextActions].sort((a, b) => {
      const priorityDifference = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDifference !== 0) return priorityDifference;
      return numberOrZero(b.points) - numberOrZero(a.points);
    });

    let status = "Not started";
    if (isStarted) status = "Needs attention";
    if (score >= 50) status = "Building tax readiness";
    if (score >= 70) status = "Good progress";
    if (score >= 85) status = "Strong tax readiness";
    if (score >= 95) status = "Excellent tax readiness";
    if (score === 100) status = "Tax plan fully documented";

    return {
      isStarted,
      score,
      maximumScore: 100,
      attainableScore,
      remainingPoints: Math.max(0, 100 - score),
      pointsAvailableNow: Math.max(0, attainableScore - score),
      nextMilestone,
      pointsToNextMilestone: Math.max(0, nextMilestone - score),
      status,
      categories,
      strengths: strengths.slice(0, 5),
      nextActions: sortedNextActions.slice(0, 6),
      blockers: blockers.slice(0, 6),
      externalPendingCount: externalPending.length
    };
  }

  const YEAR_END_CHECKLIST_STATUS_DEFINITIONS = Object.freeze([
    Object.freeze({ key: "not-started", label: "Not Started", progress: 0, tone: "open" }),
    Object.freeze({ key: "in-progress", label: "In Progress", progress: 35, tone: "progress" }),
    Object.freeze({ key: "waiting-client", label: "Waiting on Client", progress: 45, tone: "waiting" }),
    Object.freeze({ key: "ready-review", label: "Ready for Review", progress: 75, tone: "ready" }),
    Object.freeze({ key: "completed", label: "Completed", progress: 100, tone: "completed" }),
    Object.freeze({ key: "not-applicable", label: "Not Applicable", progress: 100, tone: "closed" })
  ]);

  const YEAR_END_CHECKLIST_STATUS_MAP = new Map(
    YEAR_END_CHECKLIST_STATUS_DEFINITIONS.map((status) => [status.key, status])
  );

  const YEAR_END_TIMING_DEFINITIONS = Object.freeze([
    Object.freeze({ key: "act-now", label: "Act Now", order: 0 }),
    Object.freeze({ key: "next-payment", label: "Before the Next Tax Payment or Payroll Deadline", order: 1 }),
    Object.freeze({ key: "before-year-end", label: "Before Year-End", order: 2 }),
    Object.freeze({ key: "before-filing", label: "Before Filing", order: 3 }),
    Object.freeze({ key: "final-review", label: "Final Review & Ongoing Follow-Through", order: 4 })
  ]);

  const YEAR_END_TIMING_MAP = new Map(
    YEAR_END_TIMING_DEFINITIONS.map((timing) => [timing.key, timing])
  );

  function getYearEndChecklistStatuses() {
    return YEAR_END_CHECKLIST_STATUS_DEFINITIONS.map((status) => ({ ...status }));
  }

  function checklistTimingForRecommendation(recommendation) {
    const id = String(recommendation?.id || "");
    const priority = String(recommendation?.priority || "review");

    if (priority === "urgent") return "act-now";

    if (
      id.includes("installment") ||
      id.includes("notice") ||
      id.includes("transcript")
    ) {
      return "act-now";
    }

    if (
      id.includes("withholding") ||
      id.includes("estimated-tax") ||
      id.includes("estimated-payment")
    ) {
      return "next-payment";
    }

    if (
      id.includes("charitable") ||
      id.includes("capital-gain") ||
      id.includes("capital-loss") ||
      id.includes("investment") ||
      id.includes("business-books") ||
      id.includes("business-estimated") ||
      id.includes("entity") ||
      id.includes("retirement") ||
      id.includes("hsa") ||
      id.includes("mileage") ||
      id.includes("homeOffice") ||
      id.includes("home-office") ||
      id.includes("bookkeeping")
    ) {
      return "before-year-end";
    }

    if (
      id.includes("1099-r") ||
      id.includes("social-security") ||
      id.includes("retirement-doc") ||
      id.includes("investment-doc") ||
      id.includes("education") ||
      id.includes("energy")
    ) {
      return "before-filing";
    }

    return "before-filing";
  }

  function checklistOwnerForRecommendation(recommendation) {
    const id = String(recommendation?.id || "");

    if (
      id.includes("notice") ||
      id.includes("transcript") ||
      id.includes("installment") ||
      id.includes("entity") ||
      id.includes("estimated-tax") ||
      id.includes("withholding")
    ) {
      return "Client + Tax Professional";
    }

    if (recommendation?.clientAction && recommendation?.professionalAction) {
      return "Client + Tax Professional";
    }

    if (recommendation?.professionalAction) return "Tax Professional";
    return "Client";
  }

  function normalizeYearEndChecklistRecords(items, records) {
    const source = records && typeof records === "object" ? records : {};

    return items.reduce((normalized, item) => {
      const record = source[item.id] && typeof source[item.id] === "object"
        ? source[item.id]
        : {};
      const requestedStatus = String(record.status || "");
      const status = YEAR_END_CHECKLIST_STATUS_MAP.has(requestedStatus)
        ? requestedStatus
        : "";

      normalized[item.id] = {
        status,
        targetDate: String(record.targetDate || "").slice(0, 10),
        notes: String(record.notes || "").slice(0, 3000)
      };

      return normalized;
    }, {});
  }

  function checklistStatusFromScorecard(scorecard, recommendationId) {
    const scorecardItem = getScorecardItem(scorecard, recommendationId);
    const stage = String(scorecardItem?.stage || "");

    if (stage === "completed") return "completed";
    if (stage === "not-applicable") return "not-applicable";
    if (stage === "verified") return "ready-review";
    if (stage === "client-action") return "waiting-client";
    if (stage === "under-review") return "in-progress";
    return "not-started";
  }

  function resolveYearEndChecklistStatus(savedStatus, scorecardStatus) {
    const saved = YEAR_END_CHECKLIST_STATUS_MAP.has(String(savedStatus || ""))
      ? String(savedStatus)
      : "";
    const derived = YEAR_END_CHECKLIST_STATUS_MAP.has(String(scorecardStatus || ""))
      ? String(scorecardStatus)
      : "not-started";

    // The Opportunity Scorecard is the source of truth for a linked
    // recommendation's professional conclusion. Terminal conclusions must
    // immediately synchronize to the Year-End Planning Checklist, even when
    // the checklist has an older manually saved workflow status.
    if (derived === "completed" || derived === "not-applicable") {
      return derived;
    }

    // Let an active Scorecard stage replace an empty or stale Not Started
    // checklist status. Preserve a more specific manual checklist workflow
    // status for nonterminal Scorecard stages.
    if (!saved || saved === "not-started") {
      return derived;
    }

    return saved;
  }

  function buildYearEndPlanningChecklist(
    input,
    recommendations,
    smartAlerts,
    scorecard,
    records = {}
  ) {
    const taxYear = String(input?.taxYear || "").trim() || "Current";
    const items = [];
    const seen = new Set();

    function addItem(item) {
      if (!item?.id || seen.has(item.id)) return;
      seen.add(item.id);
      items.push({
        id: item.id,
        title: String(item.title || "Planning item"),
        detail: String(item.detail || "Review this item before the tax year is finalized."),
        clientAction: String(item.clientAction || "Provide the requested information and supporting records."),
        professionalAction: String(item.professionalAction || "Review the facts, documentation, timing, and tax treatment."),
        timing: YEAR_END_TIMING_MAP.has(item.timing) ? item.timing : "before-filing",
        owner: String(item.owner || "Client + Tax Professional"),
        priority: String(item.priority || "review"),
        servicePath: String(item.servicePath || "Tax Planning Review"),
        sourceRecommendationId: String(item.sourceRecommendationId || ""),
        source: String(item.source || "planner")
      });
    }

    const hasPlannerActivity = Boolean(
      input?.hasWithholdingData ||
      numberOrZero(input?.opportunitySummary?.selectedCount) > 0 ||
      (recommendations || []).length > 0 ||
      numberOrZero(smartAlerts?.totalCount) > 0
    );

    addItem({
      id: "year-end-income-picture",
      title: `Confirm the complete ${taxYear} income picture`,
      detail: "Confirm wages, business income, investment activity, retirement distributions, Social Security, and other income before relying on the final projection.",
      clientAction: "Provide the latest paystubs, business profit and loss information, investment activity, retirement statements, and other current-year income records.",
      professionalAction: "Reconcile all known income sources to the projection and identify missing information or possible tax exposure.",
      timing: "before-year-end",
      owner: "Client + Tax Professional",
      priority: hasPlannerActivity ? "high" : "review",
      servicePath: "Year-End Tax Planning",
      source: "baseline"
    });

    addItem({
      id: "year-end-payment-reconciliation",
      title: "Reconcile federal and state tax payments",
      detail: "Confirm withholding and estimated payments so the client understands the projected balance, refund position, and any payment action still needed.",
      clientAction: "Provide the latest paystubs and proof of every federal and state estimated-tax payment made for the year.",
      professionalAction: "Reconcile withholding and estimated payments to the current projection and determine whether an additional payment or withholding adjustment should be considered.",
      timing: "next-payment",
      owner: "Client + Tax Professional",
      priority: "high",
      servicePath: "Tax Planning Review",
      source: "baseline"
    });

    addItem({
      id: "year-end-document-readiness",
      title: "Identify missing records before filing season",
      detail: "Create a clear list of records that are complete, still expected, missing, or require professional review.",
      clientAction: "Gather receipts, statements, notices, payment confirmations, basis records, charitable documentation, and business records identified by the Planner.",
      professionalAction: "Review documentation gaps and explain which records are required before a conclusion or tax position can be treated as verified.",
      timing: "before-filing",
      owner: "Client + Tax Professional",
      priority: "medium",
      servicePath: "Written Red Flag Review",
      source: "baseline"
    });

    sortActions(recommendations || []).forEach((recommendation) => {
      addItem({
        id: `year-end-${recommendation.id}`,
        title: recommendation.title,
        detail: recommendation.detail,
        clientAction: recommendation.clientAction,
        professionalAction: recommendation.professionalAction,
        timing: checklistTimingForRecommendation(recommendation),
        owner: checklistOwnerForRecommendation(recommendation),
        priority: recommendation.priority,
        servicePath: recommendation.servicePath,
        sourceRecommendationId: recommendation.id,
        source: recommendation.source || recommendation.category || "recommendation"
      });
    });

    addItem({
      id: "year-end-final-planning-review",
      title: "Complete the final planning review and document next steps",
      detail: "Review the completed checklist, unresolved items, Tax Health Score, verified opportunities, and remaining client actions before the year or filing work is closed.",
      clientAction: "Attend the review, confirm the agreed next steps, and complete any remaining document or payment requests.",
      professionalAction: "Explain what was verified, what remains potential, what action is required, and how the completed work affects the client's Tax Health Score and filing readiness.",
      timing: "final-review",
      owner: "Client + Tax Professional",
      priority: "medium",
      servicePath: "Tax Planning Meeting",
      source: "baseline"
    });

    const normalizedRecords = normalizeYearEndChecklistRecords(items, records);

    const normalizedItems = items.map((item) => {
      const record = normalizedRecords[item.id];
      const derivedStatus = item.sourceRecommendationId
        ? checklistStatusFromScorecard(scorecard, item.sourceRecommendationId)
        : "not-started";
      const statusKey = resolveYearEndChecklistStatus(
        record.status,
        derivedStatus
      );
      const status = YEAR_END_CHECKLIST_STATUS_MAP.get(statusKey) ||
        YEAR_END_CHECKLIST_STATUS_MAP.get("not-started");
      const timing = YEAR_END_TIMING_MAP.get(item.timing) ||
        YEAR_END_TIMING_MAP.get("before-filing");

      return {
        ...item,
        status: status.key,
        statusLabel: status.label,
        statusTone: status.tone,
        statusProgress: status.progress,
        timingLabel: timing.label,
        timingOrder: timing.order,
        targetDate: record.targetDate,
        notes: record.notes
      };
    }).sort((a, b) => {
      const timingDifference = a.timingOrder - b.timingOrder;
      if (timingDifference !== 0) return timingDifference;
      const priorityDifference = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDifference !== 0) return priorityDifference;
      return a.title.localeCompare(b.title);
    });

    const applicableItems = normalizedItems.filter((item) => item.status !== "not-applicable");
    const completedCount = applicableItems.filter((item) => item.status === "completed").length;
    const waitingClientCount = applicableItems.filter((item) => item.status === "waiting-client").length;
    const readyReviewCount = applicableItems.filter((item) => item.status === "ready-review").length;
    const inProgressCount = applicableItems.filter((item) => item.status === "in-progress").length;
    const actNowCount = applicableItems.filter(
      (item) => item.timing === "act-now" && item.status !== "completed"
    ).length;
    const progress = applicableItems.length
      ? Math.round(
          applicableItems.reduce((total, item) => total + item.statusProgress, 0) /
          applicableItems.length
        )
      : 0;

    let status = "Checklist ready to begin";
    if (actNowCount > 0) status = "Immediate checklist action required";
    else if (waitingClientCount > 0) status = "Waiting on client information";
    else if (readyReviewCount > 0) status = "Items ready for professional review";
    else if (progress >= 75 && completedCount < applicableItems.length) status = "Final review in progress";
    else if (progress > 0) status = "Checklist in progress";
    if (applicableItems.length > 0 && completedCount === applicableItems.length) {
      status = "Year-end checklist completed";
    }

    const groups = YEAR_END_TIMING_DEFINITIONS.map((timing) => ({
      ...timing,
      items: normalizedItems.filter((item) => item.timing === timing.key)
    })).filter((group) => group.items.length > 0);

    return {
      taxYear,
      items: normalizedItems,
      groups,
      records: normalizedRecords,
      totalCount: normalizedItems.length,
      applicableCount: applicableItems.length,
      completedCount,
      remainingCount: Math.max(0, applicableItems.length - completedCount),
      waitingClientCount,
      readyReviewCount,
      inProgressCount,
      actNowCount,
      progress,
      status
    };
  }


  const WEALTH_ROADMAP_PHASE_DEFINITIONS = Object.freeze([
    Object.freeze({
      key: "protect",
      order: 1,
      label: "Protect & Stabilize",
      timeline: "Act Now",
      purpose: "Resolve deadlines, IRS issues, payment-plan concerns, projected balances, and other risks before optional strategies are pursued."
    }),
    Object.freeze({
      key: "prepare",
      order: 2,
      label: "Verify & Organize",
      timeline: "Next 30 Days",
      purpose: "Collect the records, confirm eligibility, and move findings from possible to professionally reviewed."
    }),
    Object.freeze({
      key: "optimize",
      order: 3,
      label: "Optimize & Capture",
      timeline: "Next 90 Days / Before Year-End",
      purpose: "Improve withholding and estimated payments, capture verified tax opportunities, and strengthen business and retirement planning."
    }),
    Object.freeze({
      key: "grow",
      order: 4,
      label: "Maintain & Grow",
      timeline: "Ongoing",
      purpose: "Use quarterly reviews, current records, annual planning, and documented follow-through to preserve progress and build long-term tax readiness."
    })
  ]);

  function roadmapCategoryProgress(taxHealthProgress, key) {
    const category = (taxHealthProgress?.categories || []).find(
      (item) => item.key === key
    );
    if (!category || !numberOrZero(category.maximum)) return 0;
    return Math.round(
      Math.min(1, numberOrZero(category.score) / numberOrZero(category.maximum)) * 100
    );
  }

  function roadmapPhaseStatus(progress, isCurrent) {
    if (progress >= 90) {
      return { key: "complete", label: "Strong Foundation", tone: "complete" };
    }
    if (isCurrent) {
      return { key: "current", label: "Current Focus", tone: "current" };
    }
    if (progress > 0) {
      return { key: "progress", label: "In Progress", tone: "progress" };
    }
    return { key: "upcoming", label: "Upcoming", tone: "upcoming" };
  }

  function roadmapPhaseForChecklistItem(item) {
    const timing = String(item?.timing || "");
    const id = String(item?.id || "");
    const priority = String(item?.priority || "review");

    if (
      timing === "act-now" ||
      priority === "urgent" ||
      id.includes("notice") ||
      id.includes("installment") ||
      id.includes("transcript")
    ) {
      return "protect";
    }

    if (
      timing === "before-filing" ||
      id.includes("document") ||
      id.includes("books") ||
      id.includes("income-picture")
    ) {
      return "prepare";
    }

    if (
      timing === "next-payment" ||
      timing === "before-year-end"
    ) {
      return "optimize";
    }

    return "grow";
  }

  function roadmapBusinessStepStatus(scorecard, ids, fallbackLabel) {
    const items = Array.isArray(scorecard?.items) ? scorecard.items : [];
    const item = items.find((candidate) => ids.includes(candidate.id));

    if (!item) {
      return {
        status: "upcoming",
        label: fallbackLabel || "Review Needed",
        tone: "upcoming"
      };
    }

    if (item.stage === "completed" || item.stage === "not-applicable") {
      return { status: "complete", label: "Completed / Documented", tone: "complete" };
    }

    if (item.stage === "verified") {
      return { status: "ready", label: "Verified — Next Action Ready", tone: "ready" };
    }

    if (item.stage === "client-action") {
      return { status: "action", label: "Client Action Required", tone: "action" };
    }

    if (item.stage === "under-review") {
      return { status: "review", label: "Under Professional Review", tone: "review" };
    }

    return { status: "potential", label: "Potential — Needs Review", tone: "potential" };
  }

  function buildWealthRoadmap(
    input,
    recommendations,
    smartAlerts,
    scorecard,
    taxHealthProgress,
    yearEndChecklist
  ) {
    const health = taxHealthProgress || {};
    const checklist = yearEndChecklist || {};
    const scorecardSummary = scorecard || {};
    const alerts = Array.isArray(smartAlerts?.alerts) ? smartAlerts.alerts : [];
    const checklistItems = Array.isArray(checklist.items) ? checklist.items : [];

    const riskProgress = roadmapCategoryProgress(health, "risk");
    const documentationProgress = roadmapCategoryProgress(health, "documentation");
    const reviewProgress = roadmapCategoryProgress(health, "review");
    const withholdingProgress = roadmapCategoryProgress(health, "withholding");
    const checklistProgress = Math.round(numberOrZero(checklist.progress));
    const score = Math.round(numberOrZero(health.score));

    const phaseProgress = {
      protect: riskProgress,
      prepare: Math.round((documentationProgress + reviewProgress) / 2),
      optimize: Math.round((withholdingProgress + reviewProgress + checklistProgress) / 3),
      grow: Math.round((score + checklistProgress) / 2)
    };

    const unresolvedUrgent = alerts.filter(
      (alert) =>
        alert.priority === "urgent" &&
        !isScorecardItemResolved(scorecardSummary, alert.id)
    );

    let currentPhaseIndex = unresolvedUrgent.length
      ? 0
      : WEALTH_ROADMAP_PHASE_DEFINITIONS.findIndex(
          (phase) => phaseProgress[phase.key] < 85
        );
    if (currentPhaseIndex < 0) currentPhaseIndex = WEALTH_ROADMAP_PHASE_DEFINITIONS.length - 1;

    const openChecklistItems = checklistItems
      .filter((item) => item.status !== "completed" && item.status !== "not-applicable")
      .sort((a, b) => {
        const timingDifference = numberOrZero(a.timingOrder) - numberOrZero(b.timingOrder);
        if (timingDifference !== 0) return timingDifference;
        const priorityDifference = priorityRank(a.priority) - priorityRank(b.priority);
        if (priorityDifference !== 0) return priorityDifference;
        return String(a.title || "").localeCompare(String(b.title || ""));
      });

    const phases = WEALTH_ROADMAP_PHASE_DEFINITIONS.map((definition, index) => {
      const progress = Math.max(0, Math.min(100, phaseProgress[definition.key] || 0));
      const status = roadmapPhaseStatus(progress, index === currentPhaseIndex);
      const items = openChecklistItems
        .filter((item) => roadmapPhaseForChecklistItem(item) === definition.key)
        .slice(0, 3)
        .map((item) => ({
          id: item.id,
          title: item.title,
          timingLabel: item.timingLabel,
          priority: item.priority,
          status: item.status,
          statusLabel: item.statusLabel,
          clientAction: item.clientAction,
          professionalAction: item.professionalAction,
          servicePath: item.servicePath
        }));

      return {
        ...definition,
        progress,
        status: status.key,
        statusLabel: status.label,
        statusTone: status.tone,
        items
      };
    });

    const nextMoves = openChecklistItems.slice(0, 3).map((item, index) => ({
      order: index + 1,
      id: item.id,
      title: item.title,
      timingLabel: item.timingLabel,
      priority: item.priority,
      status: item.status,
      statusLabel: item.statusLabel,
      clientAction: item.clientAction,
      professionalAction: item.professionalAction,
      servicePath: item.servicePath,
      roadmapPhase: roadmapPhaseForChecklistItem(item)
    }));

    const businessSignals = input?.smartAlertSignals && typeof input.smartAlertSignals === "object"
      ? input.smartAlertSignals
      : {};
    const businessDetection = input?.businessDetection && typeof input.businessDetection === "object"
      ? input.businessDetection
      : buildBusinessDetection(input || {});
    const businessDetected = Boolean(
      businessDetection.isBusinessClient ||
      businessSignals.hasBusinessActivity ||
      alerts.some((alert) => String(alert.id || "").includes("business")) ||
      (recommendations || []).some(
        (item) => item.category === "business" || String(item.id || "").includes("entity")
      )
    );
    const booksReportedCurrent = String(businessSignals.businessBooksStatus || "") === "current";
    const estimatedPaymentsEntered =
      numberOrZero(businessSignals.federalEstimatedPayments) +
      numberOrZero(businessSignals.stateEstimatedPayments) > 0;

    const businessTrack = businessDetected
      ? {
          active: true,
          title: "Small-Business Owner Wealth Track",
          summary: "Reliable books, controlled estimated taxes, the right entity and compensation structure, and owner retirement planning create the foundation for stronger tax decisions.",
          steps: [
            {
              key: "books",
              title: "Build reliable books",
              detail: "Keep business income, expenses, owner activity, and account reconciliations current before relying on profit or tax projections.",
              ...(booksReportedCurrent
                ? { status: "complete", label: "Books Reported Current", tone: "complete" }
                : roadmapBusinessStepStatus(
                    scorecardSummary,
                    ["smart-business-books-cleanup", "smart-business-books-verification", "opportunity-bookkeeping"],
                    "Confirm Bookkeeping Status"
                  ))
            },
            {
              key: "payments",
              title: "Control quarterly tax payments",
              detail: "Review business profit, withholding, and federal and state estimated payments before a balance grows unexpectedly.",
              ...(estimatedPaymentsEntered
                ? { status: "review", label: "Payments Entered — Verify", tone: "review" }
                : roadmapBusinessStepStatus(
                    scorecardSummary,
                    ["smart-business-estimated-tax", "smart-estimated-payment-need", "withholding-adjust"],
                    "Quarterly Review Needed"
                  ))
            },
            {
              key: "entity",
              title: "Review entity and owner compensation",
              detail: "Evaluate whether the current structure, payroll treatment, and owner compensation still fit the business facts and goals.",
              ...roadmapBusinessStepStatus(
                scorecardSummary,
                ["opportunity-entity", "smart-business-owner-review"],
                "Business Tax Review Needed"
              )
            },
            {
              key: "owner-wealth",
              title: "Build an owner tax-and-retirement strategy",
              detail: "Coordinate retirement contributions, cash needs, deductions, and year-end planning instead of making isolated tax decisions.",
              ...roadmapBusinessStepStatus(
                scorecardSummary,
                ["opportunity-retirement", "opportunity-hsa"],
                "Owner Strategy Review"
              )
            }
          ]
        }
      : { active: false, title: "", summary: "", steps: [] };

    const currentPhase = phases[currentPhaseIndex] || phases[0];
    const roadmapProgress = phases.length
      ? Math.round(
          phases.reduce((total, phase) => total + phase.progress, 0) /
          phases.length
        )
      : 0;
    const targetScore = Math.round(numberOrZero(health.nextMilestone) || 60);
    const attainableScore = Math.round(numberOrZero(health.attainableScore) || 100);
    const pointsToTarget = Math.max(0, targetScore - score);

    let status = "Roadmap ready to begin";
    if (unresolvedUrgent.length) status = "Immediate action required before optimization";
    else if (score >= 95 && checklistProgress >= 90) status = "Maintain and protect strong tax readiness";
    else if (roadmapProgress >= 70) status = "Roadmap progress is strong";
    else if (roadmapProgress > 0) status = "Roadmap in progress";

    return {
      taxYear: String(input?.taxYear || "Current"),
      currentPhaseKey: currentPhase?.key || "protect",
      currentPhaseLabel: currentPhase?.label || "Protect & Stabilize",
      currentPhasePurpose: currentPhase?.purpose || "Resolve urgent tax risks first.",
      roadmapProgress,
      score,
      targetScore,
      pointsToTarget,
      attainableScore,
      potentialBenefit: Math.round(numberOrZero(scorecardSummary.potentialBenefit)),
      verifiedBenefit: Math.round(numberOrZero(scorecardSummary.verifiedBenefit)),
      checklistProgress,
      unresolvedUrgentCount: unresolvedUrgent.length,
      unresolvedOpportunityCount: Math.max(
        0,
        numberOrZero(scorecardSummary.applicableCount) -
        numberOrZero(scorecardSummary.completedCount)
      ),
      verifiedOpportunityCount:
        numberOrZero(scorecardSummary.verifiedCount) +
        numberOrZero(scorecardSummary.completedCount),
      phases,
      nextMoves,
      businessTrack,
      status,
      guidance: "Potential benefits remain estimates until eligibility, documentation, timing, and tax treatment are professionally reviewed. The roadmap is tax-focused planning and is not investment advice."
    };
  }

  function evaluate(input = {}) {
    const opportunitySummary = calculateOpportunitySummary(input);
    const businessDetection = buildBusinessDetection({
      ...input,
      opportunitySummary
    });
    const smartAlerts = buildSmartAlerts({
      signals: {
        ...(input?.smartAlertSignals || {}),
        hasBusinessActivity: businessDetection.isBusinessClient || Boolean(input?.smartAlertSignals?.hasBusinessActivity),
        businessNetProfit: Math.max(
          numberOrZero(input?.smartAlertSignals?.businessNetProfit),
          numberOrZero(businessDetection.netProfit)
        )
      },
      context: {
        combinedWithholdingResult: input?.combinedWithholdingResult,
        wages: input?.wages,
        otherIncome: input?.otherIncome
      }
    });
    const lifeEventScenarios = buildLifeEventScenarios(
      input?.lifeEventScenarios || {}
    );
    const recommendations = buildRecommendations(
      input,
      opportunitySummary,
      smartAlerts,
      lifeEventScenarios
    );
    const scorecard = buildOpportunityScorecard(
      recommendations,
      input?.scorecardRecords || {}
    );
    const immediateAction = buildImmediateAction(
      recommendations,
      scorecard
    );
    const taxHealthProgress = buildTaxHealthProgress(
      input,
      opportunitySummary,
      smartAlerts,
      scorecard
    );
    const yearEndChecklist = buildYearEndPlanningChecklist(
      {
        ...input,
        opportunitySummary
      },
      recommendations,
      smartAlerts,
      scorecard,
      input?.yearEndChecklistRecords || {}
    );
    const wealthRoadmap = buildWealthRoadmap(
      {
        ...input,
        opportunitySummary,
        businessDetection
      },
      recommendations,
      smartAlerts,
      scorecard,
      taxHealthProgress,
      yearEndChecklist
    );
    const servicePaths = [...new Set(
      recommendations
        .map((recommendation) => recommendation.servicePath)
        .filter(Boolean)
    )];

    return {
      engine: "Tax Recommendation Engine",
      version: VERSION,
      opportunitySummary,
      businessDetection,
      smartAlerts,
      lifeEventScenarios,
      actionPlan: recommendations,
      recommendations,
      scorecard,
      immediateAction,
      taxHealthProgress,
      yearEndChecklist,
      wealthRoadmap,
      primaryRecommendation: recommendations[0] || null,
      servicePaths
    };
  }

  function getOpportunityDefinitions() {
    return OPPORTUNITY_DEFINITIONS.map((definition) => ({ ...definition }));
  }

  function getDefinition(key) {
    const definition = DEFINITION_MAP.get(String(key || ""));
    return definition ? { ...definition } : null;
  }

  return Object.freeze({
    VERSION,
    evaluate,
    calculateOpportunitySummary,
    buildRecommendations,
    buildWithholdingRecommendation,
    buildSmartAlerts,
    buildLifeEventScenarios,
    buildBusinessDetection,
    buildOpportunityScorecard,
    buildImmediateAction,
    buildTaxHealthProgress,
    buildYearEndPlanningChecklist,
    buildWealthRoadmap,
    buildClientExplanation,
    getOpportunityDefinitions,
    getDefinition,
    getOpportunityStages,
    getOpportunityStage,
    getYearEndChecklistStatuses,
    sortActions
  });
});
