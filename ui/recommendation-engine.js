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

  const VERSION = "1.0.0";

  const PRIORITY_RANK = Object.freeze({
    urgent: 0,
    high: 1,
    medium: 2,
    review: 3,
    monitor: 4
  });

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

  function buildRecommendations(input, opportunitySummary) {
    const maximum = Math.max(1, Math.round(numberOrZero(input?.maxRecommendations) || 4));
    const withholdingRecommendation = buildWithholdingRecommendation(input);
    const opportunityRecommendations = (opportunitySummary?.actions || []).map(actionToRecommendation);
    const recommendations = [withholdingRecommendation, ...opportunityRecommendations];

    const deduplicated = [];
    const seen = new Set();

    sortActions(recommendations).forEach((recommendation) => {
      if (!recommendation.id || seen.has(recommendation.id)) return;
      seen.add(recommendation.id);
      deduplicated.push(recommendation);
    });

    return deduplicated.slice(0, maximum);
  }

  function evaluate(input = {}) {
    const opportunitySummary = calculateOpportunitySummary(input);
    const recommendations = buildRecommendations(input, opportunitySummary);
    const servicePaths = [...new Set(
      recommendations
        .map((recommendation) => recommendation.servicePath)
        .filter(Boolean)
    )];

    return {
      engine: "Tax Recommendation Engine",
      version: VERSION,
      opportunitySummary,
      actionPlan: opportunitySummary.actions,
      recommendations,
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
    getOpportunityDefinitions,
    getDefinition,
    sortActions
  });
});
