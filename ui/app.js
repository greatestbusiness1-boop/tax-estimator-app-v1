"use strict";

// =============================================================================
// MODULE STATE
// =============================================================================

let _lastTaxInput = null;
let _lastEstimate = null;
let _leadGatewayUnlocked = false;
let _leadGatewayContact = null;
let _workingChildCounter = 0;
let _taxWatchUpdateContext = null;

const QUALIFYING_RELATIVE_GROSS_INCOME_LIMITS = {
  2022: 4400,
  2023: 4700,
  2024: 5050,
  2025: 5200,
};

const DEPENDENT_FILING_THRESHOLDS = {
  2022: {
    unearnedIncome: 1150,
    earnedIncome: 12950,
    earnedIncomeCap: 12550,
    earnedIncomeAddition: 400,
  },
  2023: {
    unearnedIncome: 1250,
    earnedIncome: 13850,
    earnedIncomeCap: 13450,
    earnedIncomeAddition: 400,
  },
  2024: {
    unearnedIncome: 1300,
    earnedIncome: 14600,
    earnedIncomeCap: 14150,
    earnedIncomeAddition: 450,
  },
  2025: {
    unearnedIncome: 1350,
    earnedIncome: 15750,
    earnedIncomeCap: 15300,
    earnedIncomeAddition: 450,
  },
};

// =============================================================================
// SCREEN NAVIGATION
// =============================================================================

const SCREENS = ["welcome", "form", "results"];
const ESTIMATOR_RETURN_CONTEXT_KEY = "tspEstimatorReturnContext";
const ESTIMATOR_RETURN_MAX_AGE_MS = 4 * 60 * 60 * 1000;

function updateNewsletterVisibility(screenId) {
  const newsletter = document.querySelector(".footer-newsletter-shell");
  if (!newsletter) return;

  const dedicatedPublicPage =
    document.documentElement.hasAttribute("data-public-page");

  newsletter.hidden =
    dedicatedPublicPage ||
    screenId !== "welcome";
}

function saveEstimatorReturnContext() {
  if (!_lastTaxInput || !_lastEstimate || !_leadGatewayContact) {
    return;
  }

  const context = {
    screen: "results",
    savedAt: Date.now(),
    scrollY: Math.max(0, Number(window.scrollY || 0)),
    taxInput: _lastTaxInput,
    estimate: _lastEstimate,
    contact: _leadGatewayContact
  };

  try {
    sessionStorage.setItem(
      ESTIMATOR_RETURN_CONTEXT_KEY,
      JSON.stringify(context)
    );

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("restoreEstimate", "1");

    window.history.replaceState(
      { restoreEstimate: true },
      "",
      currentUrl.pathname +
        currentUrl.search +
        currentUrl.hash
    );
  } catch (error) {
    console.warn("Could not save the temporary estimate return context.", error);
  }
}

function restoreEstimatorReturnContext() {
  const currentUrl = new URL(window.location.href);

  if (
    currentUrl.pathname !== "/" ||
    currentUrl.searchParams.get("restoreEstimate") !== "1"
  ) {
    return false;
  }

  let context = null;

  try {
    context = JSON.parse(
      sessionStorage.getItem(ESTIMATOR_RETURN_CONTEXT_KEY) || "null"
    );
  } catch {
    context = null;
  }

  const contextIsCurrent =
    context &&
    context.screen === "results" &&
    Number(context.savedAt || 0) >
      Date.now() - ESTIMATOR_RETURN_MAX_AGE_MS &&
    context.taxInput &&
    context.estimate &&
    context.contact;

  if (!contextIsCurrent) {
    currentUrl.searchParams.delete("restoreEstimate");
    window.history.replaceState(
      {},
      "",
      currentUrl.pathname +
        currentUrl.search +
        currentUrl.hash
    );
    return false;
  }

  _lastTaxInput = context.taxInput;
  _lastEstimate = context.estimate;
  _leadGatewayContact = context.contact;
  _leadGatewayUnlocked = true;

  renderResults(_lastEstimate, _lastTaxInput);
  renderFreeEstimateUsageNotice(
    _leadGatewayContact?.freeEstimateUsage || null
  );
  goToScreen("results");

  window.setTimeout(() => {
    window.scrollTo({
      top: Math.max(0, Number(context.scrollY || 0)),
      behavior: "auto"
    });
  }, 0);

  currentUrl.searchParams.delete("restoreEstimate");
  window.history.replaceState(
    {},
    "",
    currentUrl.pathname +
      currentUrl.search +
      currentUrl.hash
  );

  sessionStorage.removeItem(ESTIMATOR_RETURN_CONTEXT_KEY);
  return true;
}

function initializeEstimatorReturnLinks() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-estimator-return-link]");
    if (!link) return;
    saveEstimatorReturnContext();
  });
}

function goToScreen(id) {
  SCREENS.forEach((s) => {
    const el = document.getElementById("screen-" + s);
    if (el) el.classList.remove("active");
  });

  const target = document.getElementById("screen-" + id);
  if (target) {
    target.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  updateProgress(id);
  updateNewsletterVisibility(id);
}

function updateProgress(activeId) {
  const order = { welcome: 0, form: 1, results: 2 };
  const activeIdx = order[activeId] ?? 0;

  SCREENS.forEach((_, i) => {
    const el = document.getElementById("prog-" + i);
    if (!el) return;
    el.classList.remove("active", "done");
    if (i < activeIdx) el.classList.add("done");
    if (i === activeIdx) el.classList.add("active");
  });
}

function scrollToLead() {
  const el = document.getElementById("leadSection");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

const PAID_REVIEW_URL = "https://buy.stripe.com/eVq4gz9vf0nmgAJ7MN1ZS00";
const TRANSCRIPT_HELP_PAYMENT_URL = "https://buy.stripe.com/fZu6oHfTD6LK98h3wx1ZS01";

async function openPaidReview() {
  const leadId = _leadGatewayContact?.leadId;
  const clientName = _leadGatewayContact?.fullName || "";
  const clientEmail = _leadGatewayContact?.email || "";
  const paymentWindow = window.open("about:blank", "_blank");

  if (!leadId || !clientEmail) {
    if (paymentWindow) {
      paymentWindow.location.href = PAID_REVIEW_URL;
    } else {
      window.location.href = PAID_REVIEW_URL;
    }
    return;
  }

  const stamp = new Date().toLocaleString();
  const actionNote =
    `[${stamp}] Client clicked Written Red Flag Review + Tax Savings Planner Bonus - Payment not yet confirmed`;

  try {
    let existingNotes = "";

    try {
      const readRes = await fetch(
        "/api/estimate-summary/" + encodeURIComponent(leadId)
      );
      const readData = await readRes.json();
      existingNotes = readData?.lead?.notes || "";
    } catch {
      existingNotes = "";
    }

    const notes = existingNotes
      ? `${existingNotes}
${actionNote}`
      : actionNote;

    await fetch("/api/leads/" + encodeURIComponent(leadId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "Written Review - Payment Pending",
        notes,
      }),
    });

    const checkoutRes = await fetch(
      "/api/create-written-review-checkout",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leadId,
          clientName,
          clientEmail,
        }),
      }
    );

    const checkoutData = await checkoutRes.json();

    if (
      !checkoutRes.ok ||
      !checkoutData.ok ||
      !checkoutData.checkoutUrl
    ) {
      throw new Error(
        checkoutData.error ||
        "Could not open Written Review checkout."
      );
    }

    if (paymentWindow) {
      paymentWindow.location.href = checkoutData.checkoutUrl;
    } else {
      window.location.href = checkoutData.checkoutUrl;
    }
  } catch (err) {
    if (paymentWindow) paymentWindow.close();
    alert(
      "Payment error: " +
      (err.message ||
        "Could not open Written Review checkout.")
    );
  }
}

async function requestTranscriptHelp() {
  const leadId = _leadGatewayContact?.leadId;

  if (!leadId) {
    alert("Please unlock your estimate first so we can attach this transcript help request to your lead record.");
    return;
  }

  const selectedNeeds = Array.from(document.querySelectorAll(".transcriptNeedOption:checked"))
    .map(input => input.value);

  const selectedTranscriptTypes = Array.from(document.querySelectorAll(".transcriptTypeOption:checked"))
    .map(input => input.value);

  const transcriptReasonEl = document.getElementById("transcriptHelpRequestText");
  const cleanedTranscriptReason = String(transcriptReasonEl?.value || "").trim();

  if (!selectedNeeds.length) {
    alert("Please select at least one item under 'What do you need help with?' before continuing.");
    const firstNeedOption = document.querySelector(".transcriptNeedOption");
    if (firstNeedOption) {
      firstNeedOption.focus();
    }
    return;
  }

  const transcriptNeedText = selectedNeeds.join(", ");
  const transcriptTypeText = selectedTranscriptTypes.length
    ? selectedTranscriptTypes.join(", ")
    : "Not selected / client may need help deciding";

  const transcriptStamp = new Date().toLocaleString();
  const transcriptIso = new Date().toISOString();

  const transcriptRequestSummary =
    `Client needs help with: ${transcriptNeedText}\n` +
    `Transcript type selected: ${transcriptTypeText}` +
    (cleanedTranscriptReason ? `\nAdditional details: ${cleanedTranscriptReason}` : "");

  const transcriptNote =
    `[${transcriptStamp}] Client submitted IRS Transcript Help Request from public estimate summary.\n` +
    `[${transcriptStamp}] Client Transcript Request:\n${transcriptRequestSummary}\n` +
    `[${transcriptStamp}] Payment Status: Requested / Waiting for Payment Verification\n` +
    `[${transcriptStamp}] Authorization Status: Not requested yet`;

  try {
    const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        status: "Transcript Help - Payment Pending",
        notes: transcriptNote,
        transcriptRequest: {
          requested: true,
          requestedAt: transcriptIso,
          serviceName: "IRS Transcript Help & Tax Records Review",
          issueType: transcriptNeedText,
          transcriptType: transcriptTypeText,
          clientExplanation: cleanedTranscriptReason || transcriptNeedText,
          taxYear: _lastTaxInput?.taxYear || "",
          multipleYears: "",
          paymentStatus: "Requested / Waiting for Payment Verification",
          authorizationStatus: "Not requested yet",
          authorizationReceivedDate: "",
          transcriptPulledDate: "",
          transcriptReceivedDate: "",
          deliveryMethod: "",
          deliveryDate: "",
          mailCertifiedFee: "",
          errorStatus: "No error",
          internalNotes: "Client requested IRS Transcript Help from the free estimate results page.",
          fee: "$150 flat service fee"
        }
      })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data?.error || "Could not save transcript help request.");
    }

    const checkoutResponse = await fetch("/api/create-transcript-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        leadId,
        clientName: _leadGatewayContact?.fullName || "",
        clientEmail: _leadGatewayContact?.email || ""
      })
    });

    const checkoutData = await checkoutResponse.json();

    if (!checkoutResponse.ok || !checkoutData.ok || !checkoutData.checkoutUrl) {
      throw new Error(checkoutData?.error || "Could not open Stripe checkout.");
    }

    window.location.href = checkoutData.checkoutUrl;
  } catch (err) {
    alert(err.message || "Could not save transcript help request. Please try again.");
  }
}

// =============================================================================
// WORKING CHILD & DEPENDENT ELIGIBILITY CHECK
// =============================================================================

function moneyValue(value) {
  const cleaned = String(value || "").replace(/[$,\s]/g, "");
  const amount = Number.parseFloat(cleaned);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function getWorkingChildIncomeLimit(taxYear) {
  return QUALIFYING_RELATIVE_GROSS_INCOME_LIMITS[Number(taxYear)] || 5200;
}

function getDependentFilingThresholds(taxYear) {
  return DEPENDENT_FILING_THRESHOLDS[Number(taxYear)] ||
    DEPENDENT_FILING_THRESHOLDS[2025];
}

function evaluateDependentFiling(child, taxYear) {
  const name = child.name || "This child";
  const year = Number(taxYear) || 2025;
  const thresholds = getDependentFilingThresholds(year);
  const wages = Number(child.wages || 0);
  const gigIncome = Number(child.gigIncome || 0);
  const unearnedIncome = Number(child.unearnedIncome || 0);
  const federalWithheld = Number(child.federalWithheld || 0);
  const stateWithheld = Number(child.stateWithheld || 0);
  const earnedIncome = wages + gigIncome;
  const grossIncome = earnedIncome + unearnedIncome;
  const grossIncomeThreshold = Math.max(
    thresholds.unearnedIncome,
    Math.min(
      earnedIncome,
      thresholds.earnedIncomeCap
    ) + thresholds.earnedIncomeAddition
  );

  const filingReasons = [];

  if (unearnedIncome > thresholds.unearnedIncome) {
    filingReasons.push(
      `Unearned income is more than the ${fmt(thresholds.unearnedIncome)} dependent filing threshold.`
    );
  }

  if (earnedIncome > thresholds.earnedIncome) {
    filingReasons.push(
      `Earned income is more than the ${fmt(thresholds.earnedIncome)} dependent filing threshold.`
    );
  }

  if (grossIncome > grossIncomeThreshold) {
    filingReasons.push(
      `Gross income is more than the applicable ${fmt(grossIncomeThreshold)} dependent filing threshold.`
    );
  }

  if (gigIncome >= 400) {
    filingReasons.push(
      "Net self-employment income is at least $400."
    );
  }

  const federalReturnLikelyRequired =
    filingReasons.length > 0;

  let filingTitle = "";
  let filingMessage = "";

  if (federalReturnLikelyRequired) {
    filingTitle =
      "Separate Federal Return Likely Required";
    filingMessage =
      `${name} appears to meet at least one ${year} federal filing requirement for a dependent.`;
  } else {
    filingTitle =
      "Federal Return Likely Not Required";
    filingMessage =
      `Based on the income entered, ${name} appears below the ${year} federal filing thresholds for a dependent.`;
  }

  const refundMessages = [];

  if (federalWithheld > 0) {
    refundMessages.push(
      `${name} should consider filing a separate federal return to claim up to ${fmt(federalWithheld)} of federal income tax withheld from W-2 Box 2.`
    );
  } else if (!federalReturnLikelyRequired) {
    refundMessages.push(
      "No federal income tax withholding was entered, so a federal refund is not indicated from withholding alone."
    );
  }

  if (stateWithheld > 0) {
    refundMessages.push(
      `${name} should check the state filing rules and may need to file a state return to claim up to ${fmt(stateWithheld)} of state income tax withheld from W-2 Box 17.`
    );
  }

  if (
    !federalReturnLikelyRequired &&
    federalWithheld === 0 &&
    stateWithheld === 0
  ) {
    refundMessages.push(
      "A separate return may still be needed for another filing trigger not covered by this screening."
    );
  }

  return {
    federalReturnLikelyRequired,
    filingTitle,
    filingMessage,
    filingReasons,
    refundMessages,
    earnedIncome,
    grossIncome,
    federalWithheld,
    stateWithheld,
    thresholds,
    grossIncomeThreshold,
  };
}

function getWorkingChildStatusLabel(value) {
  const labels = {
    eligible: "Likely Eligible to Claim",
    review: "Preparer Review Recommended",
    ineligible: "Probably Not Eligible",
  };
  return labels[value] || labels.review;
}

function evaluateWorkingChild(child, taxYear, taxpayerAge, taxpayerCanBeClaimed = false, filingStatus = "") {
  const name = child.name || "This child";
  const age = Number(child.age || 0);
  const grossIncome =
    Number(child.wages || 0) +
    Number(child.gigIncome || 0) +
    Number(child.unearnedIncome || 0);
  const earnedIncome = Number(child.wages || 0) + Number(child.gigIncome || 0);
  const incomeLimit = getWorkingChildIncomeLimit(taxYear);
  const filing = evaluateDependentFiling(
    child,
    taxYear
  );
  const relationshipPass = ["child", "sibling"].includes(child.relationship);
  const relationshipRelativePass = ["child", "sibling", "other-relative"].includes(child.relationship);
  const agePass =
    child.disabled === "yes" ||
    (age > 0 && age < 19) ||
    (age > 0 && age < 24 && child.student === "yes");
  const youngerPass = !taxpayerAge || !age || age < Number(taxpayerAge);
  const residencyPass = ["yes", "school-absence"].includes(child.residency);
  const childProvidedOwnSupport = child.support === "child";
  const supportKnown = Boolean(child.support && child.support !== "not-sure");
  const jointReturnPass = ["no", "refund-only"].includes(child.jointReturn);
  const citizenshipPass = child.citizenship === "yes";
  const competingClaimClear = child.otherClaim === "no";
  const spouseAgeMayMatter = filingStatus === "mfj" && age > 0 && taxpayerAge > 0 && age >= Number(taxpayerAge);
  const hasUncertainty = [
    child.student,
    child.disabled,
    child.residency,
    child.support,
    child.citizenship,
    child.jointReturn,
    child.otherClaim,
  ].some((value) => !value || value === "not-sure");

  const reasons = [];
  const cautions = [];

  if (taxpayerCanBeClaimed) {
    return {
      status: "review",
      title: getWorkingChildStatusLabel("review"),
      name,
      grossIncome,
      incomeLimit,
      classification: "Taxpayer dependent rule needs review",
      reasons: ["You indicated that another taxpayer can claim you. A taxpayer who can be claimed as a dependent generally cannot claim another dependent."],
      cautions: ["Review the dependent-taxpayer exception and your filing situation before including this child."],
      filing,
    };
  }

  const qualifyingChildPass =
    relationshipPass &&
    agePass &&
    youngerPass &&
    residencyPass &&
    supportKnown &&
    !childProvidedOwnSupport &&
    citizenshipPass &&
    jointReturnPass &&
    competingClaimClear;

  if (qualifyingChildPass) {
    reasons.push(`${name} appears to meet the relationship, age or student, residency, support, and joint-return tests for a qualifying child.`);
    reasons.push(`${name}'s ${fmt(grossIncome)} of income does not create a gross-income cutoff for the qualifying-child test.`);

    if (Number(child.gigIncome || 0) >= 400) {
      cautions.push(`${name} may need a separate tax return because net self-employment income is at least $400.`);
    }

    return {
      status: "eligible",
      title: getWorkingChildStatusLabel("eligible"),
      name,
      grossIncome,
      incomeLimit,
      classification: "Likely qualifying child",
      reasons,
      cautions,
      filing,
    };
  }

  if (
    spouseAgeMayMatter &&
    relationshipPass &&
    agePass &&
    residencyPass &&
    supportKnown &&
    !childProvidedOwnSupport &&
    citizenshipPass &&
    jointReturnPass &&
    competingClaimClear
  ) {
    return {
      status: "review",
      title: getWorkingChildStatusLabel("review"),
      name,
      grossIncome,
      incomeLimit,
      classification: "Spouse age needed",
      reasons: ["The child must be younger than you or your spouse on a joint return. The estimator has your age but not your spouse's age."],
      cautions: ["Confirm the spouse's age before deciding whether this person is a qualifying child."],
      filing,
    };
  }

  const qualifyingRelativePass =
    relationshipRelativePass &&
    grossIncome < incomeLimit &&
    child.support === "taxpayer" &&
    citizenshipPass &&
    jointReturnPass &&
    competingClaimClear;

  if (qualifyingRelativePass) {
    reasons.push(`${name} may qualify under the qualifying-relative rules because gross income is below ${fmt(incomeLimit)} for tax year ${taxYear} and you indicated that you provided more than half of total support.`);
    cautions.push("This result depends on the person not being the qualifying child of another taxpayer.");
    if (Number(child.gigIncome || 0) > 0) {
      cautions.push("Business gross-income rules can differ from net profit, so self-employment income should be reviewed before relying on the qualifying-relative limit.");
    }
    return {
      status: hasUncertainty ? "review" : "eligible",
      title: hasUncertainty ? getWorkingChildStatusLabel("review") : getWorkingChildStatusLabel("eligible"),
      name,
      grossIncome,
      incomeLimit,
      classification: "Possible qualifying relative",
      reasons,
      cautions,
      filing,
    };
  }

  if (hasUncertainty || child.otherClaim === "yes" || spouseAgeMayMatter) {
    reasons.push("One or more answers require a closer review before deciding who can claim this person.");
    if (child.otherClaim === "yes") cautions.push("Another taxpayer may also have a claim, so the IRS tie-breaker or custodial-parent rules may matter.");
    if (spouseAgeMayMatter) cautions.push("Because you selected Married Filing Jointly, the spouse's age may determine whether the child is younger than at least one spouse.");
    if (child.citizenship === "not-sure") cautions.push("The citizen or resident test must be confirmed.");
    if (!residencyPass) cautions.push("The child may not meet the more-than-half-the-year residency test unless an exception applies.");
    if (childProvidedOwnSupport) cautions.push("You indicated that the child provided more than half of their own support.");
    return {
      status: "review",
      title: getWorkingChildStatusLabel("review"),
      name,
      grossIncome,
      incomeLimit,
      classification: "Facts need review",
      reasons,
      cautions,
      filing,
    };
  }

  if (!citizenshipPass) reasons.push(`${name} did not meet the citizen or resident test based on the answer entered.`);
  if (!jointReturnPass) reasons.push(`${name} filed or expects to file a joint return for a reason other than claiming a refund.`);
  if (childProvidedOwnSupport) reasons.push(`${name} provided more than half of their own support.`);
  if (!agePass && grossIncome >= incomeLimit) reasons.push(`${name} does not meet the qualifying-child age or student test, and gross income is not below the ${fmt(incomeLimit)} qualifying-relative limit for tax year ${taxYear}.`);
  if (!residencyPass) reasons.push(`${name} did not live with you for more than half the year and was not marked as temporarily away at school.`);
  if (!relationshipRelativePass) reasons.push("The relationship entered does not fit the simplified qualifying-child or qualifying-relative screen.");

  return {
    status: "ineligible",
    title: getWorkingChildStatusLabel("ineligible"),
    name,
    grossIncome,
    incomeLimit,
    classification: "Likely not claimable from these answers",
    reasons: reasons.length ? reasons : ["The answers entered do not satisfy the simplified dependent screen."],
    cautions: ["A tax professional should review special circumstances before the return is filed."],
    filing,
  };
}

function workingChildCardTemplate(index) {
  return `
    <div class="working-child-card" data-working-child-index="${index}">
      <div class="working-child-card-head">
        <div>
          <span class="working-child-number">Working Child ${index + 1}</span>
          <strong>Dependent eligibility questions</strong>
        </div>
        <button type="button" class="working-child-remove" aria-label="Remove working child">Remove</button>
      </div>

      <div class="field-row cols-3 working-child-grid">
        <div class="field-group">
          <label class="field-label">Child's First Name <span class="req-star">*</span></label>
          <input type="text" class="wc-name" placeholder="e.g. Jordan" />
        </div>
        <div class="field-group">
          <label class="field-label">Relationship <span class="req-star">*</span></label>
          <div class="select-wrap">
            <select class="wc-relationship">
              <option value="">- Select -</option>
              <option value="child">Son, daughter, stepchild, foster child, or descendant</option>
              <option value="sibling">Brother, sister, step-sibling, or descendant</option>
              <option value="other-relative">Other relative</option>
              <option value="not-related">Not related</option>
            </select>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Age at Year-End <span class="req-star">*</span></label>
          <input type="number" class="wc-age" min="0" max="120" placeholder="e.g. 17" />
        </div>
      </div>

      <div class="field-row cols-3 working-child-grid">
        <div class="field-group">
          <label class="field-label">Full-Time Student for at Least 5 Months? <span class="req-star">*</span></label>
          <div class="select-wrap">
            <select class="wc-student">
              <option value="">- Select -</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="not-sure">Not sure</option>
            </select>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Permanently and Totally Disabled? <span class="req-star">*</span></label>
          <div class="select-wrap">
            <select class="wc-disabled">
              <option value="">- Select -</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="not-sure">Not sure</option>
            </select>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Living Arrangement <span class="req-star">*</span></label>
          <div class="select-wrap">
            <select class="wc-residency">
              <option value="">- Select -</option>
              <option value="yes">Lived with me more than half the year</option>
              <option value="school-absence">Away at school but home otherwise</option>
              <option value="no">Did not live with me more than half the year</option>
              <option value="not-sure">Not sure</option>
            </select>
          </div>
        </div>
      </div>

      <div class="field-row cols-3 working-child-grid">
        <div class="field-group">
          <label class="field-label">W-2 / Job Wages</label>
          <div class="dollar-input"><input type="number" class="wc-wages" min="0" placeholder="0" /></div>
        </div>
        <div class="field-group">
          <label class="field-label">Net Gig / Self-Employment Income</label>
          <div class="dollar-input"><input type="number" class="wc-gig-income" min="0" placeholder="0" /></div>
        </div>
        <div class="field-group">
          <label class="field-label">Interest, Dividends, or Other Unearned Income</label>
          <div class="dollar-input"><input type="number" class="wc-unearned-income" min="0" placeholder="0" /></div>
        </div>
      </div>

      <div class="field-row cols-2 working-child-grid working-child-withholding-grid">
        <div class="field-group">
          <label class="field-label">Federal Income Tax Withheld <span class="field-label-note">(W-2 Box 2)</span></label>
          <div class="dollar-input"><input type="number" class="wc-federal-withheld" min="0" placeholder="0" /></div>
          <div class="working-child-field-help">Income tax only - do not include Social Security or Medicare.</div>
        </div>
        <div class="field-group">
          <label class="field-label">State Income Tax Withheld <span class="field-label-note">(W-2 Box 17)</span></label>
          <div class="dollar-input"><input type="number" class="wc-state-withheld" min="0" placeholder="0" /></div>
          <div class="working-child-field-help">Enter the state income tax withheld, if any.</div>
        </div>
      </div>

      <div class="field-row working-child-grid working-child-grid-four">
        <div class="field-group">
          <label class="field-label">Who Provided More Than Half of Total Support? <span class="req-star">*</span></label>
          <div class="select-wrap">
            <select class="wc-support">
              <option value="">- Select -</option>
              <option value="taxpayer">I did</option>
              <option value="child">The child did</option>
              <option value="someone-else">Someone else did</option>
              <option value="not-sure">Not sure</option>
            </select>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Citizen or Resident Test <span class="req-star">*</span></label>
          <div class="select-wrap">
            <select class="wc-citizenship">
              <option value="">- Select -</option>
              <option value="yes">U.S. citizen, U.S. national, resident alien, or resident of Canada/Mexico</option>
              <option value="no">No</option>
              <option value="not-sure">Not sure</option>
            </select>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Will the Child File a Joint Return? <span class="req-star">*</span></label>
          <div class="select-wrap">
            <select class="wc-joint-return">
              <option value="">- Select -</option>
              <option value="no">No</option>
              <option value="refund-only">Only to claim a refund</option>
              <option value="yes">Yes, for another reason</option>
              <option value="not-sure">Not sure</option>
            </select>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Could Another Taxpayer Claim This Child? <span class="req-star">*</span></label>
          <div class="select-wrap">
            <select class="wc-other-claim">
              <option value="">- Select -</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
              <option value="not-sure">Not sure</option>
            </select>
          </div>
        </div>
      </div>

      <div class="working-child-inline-result" aria-live="polite">
        Complete the required questions to see the likely dependent result.
      </div>
    </div>
  `;
}

function collectWorkingChildren() {
  return Array.from(document.querySelectorAll(".working-child-card")).map((card) => ({
    name: card.querySelector(".wc-name")?.value?.trim() || "",
    relationship: card.querySelector(".wc-relationship")?.value || "",
    age: Number.parseInt(card.querySelector(".wc-age")?.value || "0", 10) || 0,
    student: card.querySelector(".wc-student")?.value || "",
    disabled: card.querySelector(".wc-disabled")?.value || "",
    residency: card.querySelector(".wc-residency")?.value || "",
    wages: moneyValue(card.querySelector(".wc-wages")?.value),
    gigIncome: moneyValue(card.querySelector(".wc-gig-income")?.value),
    unearnedIncome: moneyValue(card.querySelector(".wc-unearned-income")?.value),
    federalWithheld: moneyValue(card.querySelector(".wc-federal-withheld")?.value),
    stateWithheld: moneyValue(card.querySelector(".wc-state-withheld")?.value),
    support: card.querySelector(".wc-support")?.value || "",
    citizenship: card.querySelector(".wc-citizenship")?.value || "",
    jointReturn: card.querySelector(".wc-joint-return")?.value || "",
    otherClaim: card.querySelector(".wc-other-claim")?.value || "",
  }));
}

function isWorkingChildComplete(child) {
  return Boolean(
    child.name &&
    child.relationship &&
    child.age > 0 &&
    child.student &&
    child.disabled &&
    child.residency &&
    child.support &&
    child.citizenship &&
    child.jointReturn &&
    child.otherClaim
  );
}

function updateWorkingChildCardNumbers() {
  const cards = document.querySelectorAll(".working-child-card");
  cards.forEach((card, index) => {
    card.dataset.workingChildIndex = String(index);
    const number = card.querySelector(".working-child-number");
    if (number) number.textContent = `Working Child ${index + 1}`;
    const remove = card.querySelector(".working-child-remove");
    if (remove) remove.hidden = cards.length === 1;
  });
}

function refreshWorkingChildInlineResults() {
  const taxYear = Number(document.getElementById("taxYear")?.value || 2025);
  const taxpayerAge = Number(document.getElementById("age")?.value || 0);
  const children = collectWorkingChildren();

  document.querySelectorAll(".working-child-card").forEach((card, index) => {
    const host = card.querySelector(".working-child-inline-result");
    const child = children[index];
    if (!host || !child) return;

    if (!isWorkingChildComplete(child)) {
      host.className = "working-child-inline-result";
      host.textContent = "Complete the required questions to see the likely dependent result.";
      return;
    }

    const result = evaluateWorkingChild(
      child,
      taxYear,
      taxpayerAge,
      document.querySelector('input[name="canBeClaimedAsDependent"]:checked')?.value === "yes",
      document.getElementById("filingStatus")?.value || ""
    );
    const filing = result.filing;
    const refundMessages =
      filing.refundMessages.length > 0
        ? filing.refundMessages
        : [
          "Review whether a separate child return is needed."
        ];
    const refundGuidance = refundMessages
      .map(
        (message) =>
          `<li>${escHtml(message)}</li>`
      )
      .join("");

    host.className = `working-child-inline-result ${result.status}`;
    host.innerHTML = `
      <strong>${escHtml(result.title)}</strong>
      <span>${escHtml(result.classification)}. Total income entered: ${escHtml(fmt(result.grossIncome))}.</span>
      <small>${escHtml(result.reasons[0] || "Review the dependent rules before filing.")}</small>
      <div class="working-child-filing-summary ${filing.federalReturnLikelyRequired ? "required" : "not-required"}">
        <strong>${escHtml(filing.filingTitle)}</strong>
        <span>${escHtml(filing.filingMessage)}</span>
        <ul class="working-child-inline-refund-list">
          ${refundGuidance}
        </ul>
      </div>
      <div class="working-child-dependent-reminder">
        Include ${escHtml(result.name)} in Number of Dependents above if you expect to claim ${escHtml(result.name)}.
      </div>
    `;
  });
}

function addWorkingChildCard() {
  const list = document.getElementById("workingChildList");
  if (!list) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = workingChildCardTemplate(_workingChildCounter++).trim();
  const card = wrapper.firstElementChild;
  list.appendChild(card);

  card.querySelectorAll("input, select").forEach((element) => {
    element.addEventListener("input", refreshWorkingChildInlineResults);
    element.addEventListener("change", refreshWorkingChildInlineResults);
  });

  card.querySelector(".working-child-remove")?.addEventListener("click", () => {
    card.remove();
    updateWorkingChildCardNumbers();
    refreshWorkingChildInlineResults();
  });

  updateWorkingChildCardNumbers();
  refreshWorkingChildInlineResults();
}

function setWorkingChildPanelVisible(visible) {
  const panel = document.getElementById("workingChildPanel");
  if (!panel) return;

  panel.hidden = !visible;
  if (visible && !document.querySelector(".working-child-card")) {
    addWorkingChildCard();
  }
}

function updateWorkingChildCheckerVisibility() {
  const checker = document.getElementById("workingChildChecker");
  const dependentsInput = document.getElementById("numberOfDependents");
  if (!checker || !dependentsInput) return;

  const dependentCount = Math.max(0, parseInt(dependentsInput.value, 10) || 0);
  const shouldShow = dependentCount > 0;
  checker.hidden = !shouldShow;

  if (!shouldShow) {
    const noRadio = document.querySelector('input[name="hasWorkingChildIncome"][value="no"]');
    if (noRadio) noRadio.checked = true;
    setWorkingChildPanelVisible(false);
    return;
  }

  const yesRadio = document.querySelector('input[name="hasWorkingChildIncome"][value="yes"]');
  setWorkingChildPanelVisible(Boolean(yesRadio?.checked));
}

function initWorkingChildChecker() {
  document.querySelectorAll('input[name="hasWorkingChildIncome"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      setWorkingChildPanelVisible(radio.value === "yes" && radio.checked);
    });
  });

  const dependentsInput = document.getElementById("numberOfDependents");
  dependentsInput?.addEventListener("input", updateWorkingChildCheckerVisibility);
  dependentsInput?.addEventListener("change", updateWorkingChildCheckerVisibility);

  document.getElementById("addWorkingChildBtn")?.addEventListener("click", addWorkingChildCard);
  document.getElementById("taxYear")?.addEventListener("change", refreshWorkingChildInlineResults);
  document.getElementById("age")?.addEventListener("input", refreshWorkingChildInlineResults);
  updateWorkingChildCheckerVisibility();
}

function renderWorkingChildResults(input) {
  const section = document.getElementById("workingChildResultsSection");
  const host = document.getElementById("workingChildResults");
  const children = Array.isArray(input?.workingChildren) ? input.workingChildren : [];

  if (!section || !host) return;

  if (!input?.hasWorkingChildIncome || children.length === 0) {
    section.hidden = true;
    host.innerHTML = "";
    return;
  }

  section.hidden = false;
  host.innerHTML = children.map((child) => {
    const result = evaluateWorkingChild(
      child,
      input.taxYear,
      input.age,
      input.canBeClaimedAsDependent,
      input.filingStatus
    );
    const reasonItems = result.reasons.map((reason) => `<li>${escHtml(reason)}</li>`).join("");
    const cautionItems = result.cautions.map((caution) => `<li>${escHtml(caution)}</li>`).join("");
    const filingReasonItems = result.filing.filingReasons
      .map((reason) => `<li>${escHtml(reason)}</li>`)
      .join("");
    const refundItems = result.filing.refundMessages
      .map((message) => `<li>${escHtml(message)}</li>`)
      .join("");

    return `
      <article class="working-child-result-card ${escHtml(result.status)}">
        <div class="working-child-result-top">
          <div>
            <div class="working-child-result-name">${escHtml(result.name)}</div>
            <div class="working-child-result-classification">${escHtml(result.classification)}</div>
          </div>
          <span>${escHtml(result.title)}</span>
        </div>
        <div class="working-child-result-income">Income entered: <strong>${escHtml(fmt(result.grossIncome))}</strong></div>
        <ul>${reasonItems}${cautionItems}</ul>
        <div class="working-child-filing-card ${result.filing.federalReturnLikelyRequired ? "required" : "not-required"}">
          <strong>${escHtml(result.filing.filingTitle)}</strong>
          <p>${escHtml(result.filing.filingMessage)}</p>
          ${filingReasonItems ? `<ul>${filingReasonItems}</ul>` : ""}
          ${refundItems ? `<ul class="working-child-refund-list">${refundItems}</ul>` : ""}
        </div>
        <div class="working-child-result-next"><strong>Remember:</strong> Include ${escHtml(result.name)} in Number of Dependents above if you expect to claim ${escHtml(result.name)}. This is a screening result; special custody, support, residency, disability, married-dependent, and other filing rules may require professional review.</div>
      </article>
    `;
  }).join("");
}

function getEstimateCompleteness(input) {
  const rawRequiredValues = [
    document.getElementById("taxYear")?.value,
    document.getElementById("filingStatus")?.value,
    document.getElementById("age")?.value,
    document.getElementById("stateCode")?.value,
    document.getElementById("numberOfDependents")?.value,
    document.getElementById("w2Income")?.value,
    document.getElementById("federalWithheld")?.value,
    document.getElementById("stateWithheld")?.value,
  ];

  const completed = rawRequiredValues.filter((value) => String(value ?? "").trim() !== "").length;
  const childCount = Array.isArray(input?.workingChildren) ? input.workingChildren.length : 0;

  return {
    completed,
    total: rawRequiredValues.length,
    childCount,
  };
}

// =============================================================================
// TAX FORM - READ
// =============================================================================

const TAX_WATCH_PRO_SOURCE_LIMIT = 5;

function taxWatchAdditionalSourceHasData(sourceNumber) {
  const disclosure = document.querySelector(
    `[data-tax-watch-source-disclosure-number="${sourceNumber}"]`
  );

  if (!disclosure) return false;

  const name = String(
    document.getElementById(`businessSource${sourceNumber}Name`)?.value || ""
  ).trim();

  if (name) return true;

  return Array.from(disclosure.querySelectorAll('input[type="number"]')).some(
    (input) => Number(String(input.value || "").replace(/[$,\s]/g, "")) > 0
  );
}

function refreshTaxWatchAdditionalSourceDisclosure(sourceNumber) {
  const disclosure = document.querySelector(
    `[data-tax-watch-source-disclosure-number="${sourceNumber}"]`
  );

  if (!disclosure) return;

  const name = String(
    document.getElementById(`businessSource${sourceNumber}Name`)?.value || ""
  ).trim();
  const title = disclosure.querySelector(".tax-watch-source-summary-title");
  const action = disclosure.querySelector(".tax-watch-source-summary-action");
  const hasData = taxWatchAdditionalSourceHasData(sourceNumber);

  if (title) {
    title.textContent = name
      ? `Gig or Business Source ${sourceNumber}: ${name}`
      : `Gig or Business Source ${sourceNumber}`;
  }

  if (action) {
    action.textContent = disclosure.open
      ? "Hide details"
      : hasData
        ? "View saved details"
        : "Add source details";
  }
}

function openPopulatedTaxWatchAdditionalSources() {
  for (let sourceNumber = 3; sourceNumber <= TAX_WATCH_PRO_SOURCE_LIMIT; sourceNumber += 1) {
    const disclosure = document.querySelector(
      `[data-tax-watch-source-disclosure-number="${sourceNumber}"]`
    );

    if (disclosure && taxWatchAdditionalSourceHasData(sourceNumber)) {
      disclosure.open = true;
    }

    refreshTaxWatchAdditionalSourceDisclosure(sourceNumber);
  }
}

function ensureTaxWatchAdditionalSources() {
  const container = document.getElementById("taxWatchAdditionalSources");
  const template = document.querySelector('[data-tax-watch-source-number="2"]');

  if (!container || !template || container.children.length > 0) {
    return;
  }

  for (let sourceNumber = 3; sourceNumber <= TAX_WATCH_PRO_SOURCE_LIMIT; sourceNumber += 1) {
    const card = template.cloneNode(true);
    card.dataset.taxWatchSourceNumber = String(sourceNumber);

    card.querySelectorAll("[id]").forEach((element) => {
      element.id = element.id.replace(/businessSource2/g, `businessSource${sourceNumber}`);
    });

    card.querySelectorAll("label[for]").forEach((label) => {
      label.htmlFor = label.htmlFor.replace(/businessSource2/g, `businessSource${sourceNumber}`);
    });

    card.querySelectorAll("input").forEach((input) => {
      input.value = "";
    });

    const title = card.querySelector(".tax-watch-source-title");
    if (title) {
      title.innerHTML = `Gig or Business Source ${sourceNumber} <span>Optional</span>`;
    }

    const nameInput = card.querySelector(`#businessSource${sourceNumber}Name`);
    if (nameInput) {
      nameInput.placeholder = `Example: Income source ${sourceNumber}`;
    }

    const disclosure = document.createElement("details");
    disclosure.className = "tax-watch-source-disclosure";
    disclosure.dataset.taxWatchSourceDisclosureNumber = String(sourceNumber);

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <span class="tax-watch-source-summary-copy">
        <strong class="tax-watch-source-summary-title">Gig or Business Source ${sourceNumber}</strong>
        <span class="tax-watch-source-summary-help">Optional - open only when you need this income source</span>
      </span>
      <span class="tax-watch-source-summary-action">Add source details</span>
    `;

    disclosure.appendChild(summary);
    disclosure.appendChild(card);
    disclosure.addEventListener("toggle", () => {
      refreshTaxWatchAdditionalSourceDisclosure(sourceNumber);
    });

    card.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        refreshTaxWatchAdditionalSourceDisclosure(sourceNumber);
      });
      input.addEventListener("change", () => {
        refreshTaxWatchAdditionalSourceDisclosure(sourceNumber);
      });
    });

    container.appendChild(disclosure);
    refreshTaxWatchAdditionalSourceDisclosure(sourceNumber);
  }
}

function readForm() {
  const getVal = (id) => document.getElementById(id)?.value ?? "";
  const getRadio = (name) => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : null;
  };
  const numVal = (id) => {
    const raw = String(getVal(id)).replace(/[$,\s]/g, "");
    const n = parseFloat(raw);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
  };

  const taxWatchExpenseKeys = [
    "advertising", "contractLabor", "insurance", "legalProfessional",
    "officeExpense", "equipmentRent", "repairs", "supplies",
    "taxesLicenses", "travel", "meals", "utilities", "platformFees",
    "softwareSubscriptions", "phoneInternet", "other"
  ];

  const readExpenseCategories = (sourceNumber) => {
    const categories = {};
    taxWatchExpenseKeys.forEach((key) => {
      categories[key] = numVal(`businessSource${sourceNumber}Expense_${key}`);
    });
    return categories;
  };

  const categoryTotal = (categories) =>
    Object.values(categories).reduce(
      (sum, value) => sum + Number(value || 0),
      0
    );

  const selfEmploymentStreams = Array.from(
    { length: TAX_WATCH_PRO_SOURCE_LIMIT },
    (_, index) => {
      const sourceNumber = index + 1;
      const categories = readExpenseCategories(sourceNumber);
      const incomeField = sourceNumber === 1
        ? "selfEmploymentIncome"
        : `businessSource${sourceNumber}Income`;
      const expenseField = sourceNumber === 1
        ? "businessExpenses"
        : `businessSource${sourceNumber}Expenses`;
      const uncategorizedExpenses = numVal(expenseField);

      return {
        source:
          String(
            getVal(`businessSource${sourceNumber}Name`) ||
            ""
          ).trim() ||
          `Gig or business source ${sourceNumber}`,
        income: numVal(incomeField),
        uncategorizedExpenses,
        expenseCategories: categories,
        expenses:
          uncategorizedExpenses +
          categoryTotal(categories)
      };
    }
  ).filter(
    (stream, index) =>
      stream.income > 0 ||
      stream.expenses > 0 ||
      stream.source !==
        `Gig or business source ${index + 1}`
  );

  const totalSelfEmploymentIncome = selfEmploymentStreams.reduce(
    (sum, stream) => sum + Number(stream.income || 0),
    0
  );

  const totalBusinessExpenses = selfEmploymentStreams.reduce(
    (sum, stream) => sum + Number(stream.expenses || 0),
    0
  );

  return {
    taxYear: parseInt(getVal("taxYear"), 10) || 2024,
    filingStatus: getVal("filingStatus"),
    age: parseInt(getVal("age"), 10) || 0,
    isFullTimeStudent: getRadio("isFullTimeStudent") === "yes",
    canBeClaimedAsDependent: getRadio("canBeClaimedAsDependent") === "yes",
    stateCode: getVal("stateCode"),
    numberOfDependents: parseInt(getVal("numberOfDependents"), 10) || 0,
    hasWorkingChildIncome: getRadio("hasWorkingChildIncome") === "yes",
    workingChildren: getRadio("hasWorkingChildIncome") === "yes" ? collectWorkingChildren() : [],
    w2Income: numVal("w2Income"),
    otherIncome: numVal("otherIncome"),
    scholarships: numVal("scholarships"),
    educationExpenses: numVal("educationExpenses"),
    federalWithheld: numVal("federalWithheld"),
    stateWithheld: numVal("stateWithheld"),
    selfEmploymentIncome: totalSelfEmploymentIncome,
    businessExpenses: totalBusinessExpenses,
    businessMileage: numVal("businessMileage"),
    estimatedTaxPayments: numVal("estimatedTaxPayments"),
    selfEmploymentStreams,
  };
}

// =============================================================================
// TAX FORM - VALIDATE
// =============================================================================

function validateFormClient(input) {
  const errors = [];

  if (!input.filingStatus) {
    errors.push("Filing Status is required.");
    markError("filingStatus");
  }
  if (!input.age || input.age < 13 || input.age > 120) {
    errors.push("Age must be a realistic taxpayer age between 13 and 120.");
    markError("age");
  }
  if (!input.stateCode) {
    errors.push("State of Residence is required.");
    markError("stateCode");
  }

  if (input.hasWorkingChildIncome) {
    if (!Array.isArray(input.workingChildren) || input.workingChildren.length === 0) {
      errors.push("Add at least one working child or select No for the working-child question.");
    } else {
      input.workingChildren.forEach((child, index) => {
        if (!isWorkingChildComplete(child)) {
          errors.push(`Complete all required Working Child ${index + 1} eligibility questions.`);
        }
      });
    }
  }

  if (input.w2Income < 0) {
    errors.push("W-2 Wages must be $0 or more.");
    markError("w2Income");
  }
  if (input.federalWithheld < 0) {
    errors.push("Federal Tax Withheld must be $0 or more.");
    markError("federalWithheld");
  }
  if (input.stateWithheld < 0) {
    errors.push("State Tax Withheld must be $0 or more.");
    markError("stateWithheld");
  }

  const totalIncome =
    (input.w2Income || 0) +
    (input.otherIncome || 0) +
    (input.selfEmploymentIncome || 0);

  if (totalIncome > 0 && input.federalWithheld > totalIncome) {
    errors.push("Federal Tax Withheld cannot exceed total income. Please check your W-2.");
    markError("federalWithheld");
  }

  return errors;
}

function markError(fieldId) {
  const el = document.getElementById(fieldId);
  if (el) el.classList.add("error-field");
}

function clearErrors() {
  document.querySelectorAll(".error-field").forEach((el) => el.classList.remove("error-field"));
  const errBox = document.getElementById("formErrors");
  if (errBox) errBox.style.display = "none";
}

function showErrors(errors) {
  const errBox = document.getElementById("formErrors");
  const errList = document.getElementById("errorsList");
  if (!errBox || !errList) return;
  errList.innerHTML = errors.map((e) => `<li>${escHtml(e)}</li>`).join("");
  errBox.style.display = "block";
  errBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearForm() {
  document.getElementById("taxForm")?.reset();
  const studentNo = document.querySelector('input[name="isFullTimeStudent"][value="no"]');
  const depNo = document.querySelector('input[name="canBeClaimedAsDependent"][value="no"]');
  if (studentNo) studentNo.checked = true;
  if (depNo) depNo.checked = true;

  const workingChildNo = document.querySelector('input[name="hasWorkingChildIncome"][value="no"]');
  if (workingChildNo) workingChildNo.checked = true;
  const workingChildList = document.getElementById("workingChildList");
  if (workingChildList) workingChildList.innerHTML = "";
  _workingChildCounter = 0;
  setWorkingChildPanelVisible(false);
  updateWorkingChildCheckerVisibility();
  clearErrors();
}

// =============================================================================
// BUTTON STATE HELPERS
// =============================================================================

function setCalculateLoading(isLoading) {
  const btn = document.getElementById("calculateBtn");
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = "Calculating&hellip;";
    btn.style.opacity = "0.72";
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.orig || "Calculate My Estimate";
    btn.style.opacity = "";
  }
}

function setLeadLoading(isLoading) {
  const btn = document.getElementById("leadSubmitBtn");
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = "Submitting&hellip;";
    btn.style.opacity = "0.72";
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.orig || "Request Tax Preparation Fit Call";
    btn.style.opacity = "";
  }
}

// =============================================================================
// CALCULATE - SUBMIT TO /api/estimate
// =============================================================================

async function handleCalculate() {
  clearErrors();

  const input = readForm();
  const clientErrors = validateFormClient(input);

  if (clientErrors.length > 0) {
    showErrors(clientErrors);
    return;
  }

  setCalculateLoading(true);

  try {
    const response = await fetch("/api/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The server returned an unreadable response. Please try again.");
    }

    if (!response.ok || !data.ok) {
      const serverErrors = Array.isArray(data.errors) && data.errors.length > 0
        ? data.errors
        : ["An error occurred on the server. Please check your inputs and try again."];
      showErrors(serverErrors);
      return;
    }

    _lastTaxInput = input;
    _lastEstimate = data.result;

    _leadGatewayUnlocked = false;
    _leadGatewayContact = null;
    showLeadGateway(input, data.result);
  } catch (err) {
    console.error("[handleCalculate]", err);
    showErrors([
      err.message || "Could not reach the server. Please check your connection and try again.",
    ]);
  } finally {
    setCalculateLoading(false);
  }
}

// =============================================================================
// LEAD GATEWAY - CAPTURE NAME + EMAIL BEFORE SHOWING RESULTS
// =============================================================================

function showLeadGateway(input, result) {
  const existing = document.getElementById("leadGatewayOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "leadGatewayOverlay";
  overlay.style.cssText = `
    position:fixed;
    inset:0;
    z-index:9999;
    background:rgba(15, 23, 42, 0.78);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:18px;
  `;

  overlay.innerHTML = `
    <div
      style="
        width:100%;
        max-width:520px;
        background:#ffffff;
        border-radius:22px;
        padding:28px;
        box-shadow:0 30px 80px rgba(0,0,0,0.35);
        border:3px solid #0f2c56;
      "
    >
      <div style="font-size:14px;font-weight:800;color:#2563eb;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">
        Your Estimate Is Ready
      </div>

      <h2 style="margin:0 0 12px;color:#0f2c56;font-size:30px;line-height:1.15;">
        Unlock Your Full Tax Estimate
      </h2>

      <p style="margin:0 0 18px;color:#334155;font-size:16px;line-height:1.6;">
        Enter your full name and email to view your full tax estimate and personalized tax insights.
      </p>

      <div id="leadGatewayErrors" style="display:none;background:#fee2e2;border:1px solid #ef4444;color:#991b1b;padding:12px;border-radius:12px;margin-bottom:14px;font-weight:700;"></div>

      <div style="display:grid;gap:12px;">
        <div>
          <label style="display:block;font-weight:800;color:#0f172a;margin-bottom:6px;">Full Name</label>
          <input
            id="gatewayFullName"
            type="text"
            placeholder="Full name"
            style="width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #cbd5e1;font-size:16px;"
          />
        </div>

        <div>
          <label style="display:block;font-weight:800;color:#0f172a;margin-bottom:6px;">Email Address</label>
          <input
            id="gatewayEmail"
            type="email"
            placeholder="you@email.com"
            style="width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #cbd5e1;font-size:16px;"
          />
        </div>

        <button
          type="button"
          id="gatewayUnlockBtn"
          style="
            margin-top:6px;
            width:100%;
            background:#0f2c56;
            color:#fff;
            border:none;
            border-radius:14px;
            padding:16px;
            font-size:17px;
            font-weight:900;
            cursor:pointer;
          "
        >
          View My Full Estimate
        </button>

        <div style="font-size:13px;color:#64748b;line-height:1.5;text-align:center;">
          We ask for this so your estimate can be saved and you can return to it later.
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  if (_taxWatchUpdateContext) {
    const nameInput = document.getElementById("gatewayFullName");
    const emailInput = document.getElementById("gatewayEmail");
    if (nameInput) nameInput.value = _taxWatchUpdateContext.clientName || "";
    if (emailInput) {
      emailInput.value = _taxWatchUpdateContext.email || "";
      emailInput.readOnly = true;
    }
  }

  const btn = document.getElementById("gatewayUnlockBtn");
  if (btn) {
    btn.addEventListener("click", () => submitLeadGateway(input, result));
  }
}


function buildSavedEstimateSummary(result, input) {
  if (!result) return null;

  const fed = result.federal?.summary || {};
  const st = result.state?.summary || {};
  const experience = result.clientExperience || {};
  const completeness = getEstimateCompleteness(input || {});
  const workingChildren = Array.isArray(input?.workingChildren)
    ? input.workingChildren
    : [];

  const workingChildResults = workingChildren.map((child) => {
    const childResult = evaluateWorkingChild(
      child,
      input?.taxYear,
      input?.age,
      input?.canBeClaimedAsDependent,
      input?.filingStatus
    );

    return {
      name: childResult.name,
      status: childResult.status,
      title: childResult.title,
      classification: childResult.classification,
      grossIncome: childResult.grossIncome,
      reasons: childResult.reasons,
      cautions: childResult.cautions,
      filing: childResult.filing,
    };
  });

  return {
    taxYear: result.meta?.taxYear,
    filingStatus: result.meta?.filingStatus,
    stateCode: result.meta?.stateCode,
    stateName: result.meta?.stateName,
    completeness,
    workingChildResults,
    clientExperience: {
      summary: Array.isArray(experience.summary) ? experience.summary : [],
      whatCouldChange: Array.isArray(experience.whatCouldChange)
        ? experience.whatCouldChange
        : [],
      recommendations: Array.isArray(experience.recommendations)
        ? experience.recommendations
        : [],
      disclaimer: Array.isArray(experience.disclaimer)
        ? experience.disclaimer
        : [],
    },
    federal: {
      grossIncome: fed.grossIncome,
      agi: fed.agi,
      standardDeduction: fed.standardDeduction,
      taxableIncome: fed.taxableIncome,
      taxBeforeCredits: fed.taxBeforeCredits,
      educationCredit: fed.educationCredit,
      childTaxCredit: fed.childTaxCredit,
      taxAfterCredits: fed.taxAfterCredits,
      federalWithheld: fed.federalWithheld,
      estimatedTaxPayments: fed.estimatedTaxPayments,
      selfEmploymentIncome: fed.selfEmploymentIncome,
      netSelfEmploymentIncome: fed.netSelfEmploymentIncome,
      selfEmploymentTax: fed.selfEmploymentTax,
      net: fed.net,
      isRefund: fed.isRefund,
      refundAmount: fed.refundAmount,
      owedAmount: fed.owedAmount,
      marginalRate: fed.marginalRate,
      effectiveRate:
        Number(fed.agi) > 0
          ? (
            Number(fed.taxAfterCredits || 0) /
            Number(fed.agi)
          ) * 100
          : 0,
    },
    state: {
      stateName: result.meta?.stateName,
      hasIncomeTax: result.state?.hasIncomeTax,
      canEstimate: result.state?.canEstimate,
      stateTaxableIncome: st.stateTaxableIncome,
      stateTax: st.stateTax,
      stateWithheld: st.stateWithheld,
      net: st.net,
      isRefund: st.isRefund,
      refundAmount: st.refundAmount,
      owedAmount: st.owedAmount,
    },
    combined: result.combined,
  };
}

function formatFreeEstimateLimitDate(value) {
  const parsed = new Date(value || "");
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function renderFreeEstimateLimitReached(usage = {}) {
  const overlay = document.getElementById("leadGatewayOverlay");
  const card = overlay?.firstElementChild;
  if (!card) return;

  const nextAvailable = formatFreeEstimateLimitDate(
    usage.nextAvailableAt
  );
  const latestLeadId = String(
    usage.latestSavedLeadId || ""
  ).trim();
  const latestLink = latestLeadId
    ? `/estimate/${encodeURIComponent(latestLeadId)}`
    : "";

  card.innerHTML = `
    <div class="free-estimate-limit-kicker">Free Estimate Limit Reached</div>
    <h2 class="free-estimate-limit-title">
      You have used your 3 free estimates during the current 30-day period.
    </h2>
    <p class="free-estimate-limit-copy">
      Your saved results remain available. If your numbers keep changing,
      Tax Money Tracker can update your estimate throughout the year,
      explain what changed and why, and track the money you reported saving.
    </p>
    ${nextAvailable ? `
      <div class="free-estimate-limit-date">
        Your next free estimate becomes available after
        <strong>${escHtml(nextAvailable)}</strong>.
      </div>
    ` : ""}
    <div class="free-estimate-limit-preview">
      <strong>14-day Tax Watch Pro preview.</strong>
      No automatic charge. Choose a plan only when you are ready.
    </div>
    <div class="free-estimate-limit-actions">
      <a class="free-estimate-limit-primary" href="/client-portal">
        Open Secure Client Portal
      </a>
      ${latestLink ? `
        <a class="free-estimate-limit-secondary" href="${escHtml(latestLink)}" target="_blank" rel="noopener noreferrer">
          Open My Latest Saved Estimate
        </a>
      ` : ""}
      <button type="button" class="free-estimate-limit-secondary" id="closeFreeEstimateLimit">
        Return to My Entries
      </button>
    </div>
  `;

  document.getElementById("closeFreeEstimateLimit")
    ?.addEventListener("click", () => overlay.remove());
}

function renderFreeEstimateUsageNotice(usage = {}) {
  const existing = document.getElementById(
    "freeEstimateUsageNotice"
  );

  if (existing) existing.remove();

  if (
    !usage ||
    usage.exempt ||
    !Number.isFinite(Number(usage.limit)) ||
    !Number.isFinite(Number(usage.remaining))
  ) {
    return;
  }

  const limit = Math.max(1, Number(usage.limit));
  const remaining = Math.max(
    0,
    Number(usage.remaining)
  );
  const used = Math.max(0, Number(usage.used || 0));
  const results = document.getElementById("screen-results");
  const disclaimer = results?.querySelector(".disclaimer-banner");

  if (!results || !disclaimer) return;

  const notice = document.createElement("div");
  notice.id = "freeEstimateUsageNotice";
  notice.className =
    "free-estimate-usage-notice" +
    (remaining === 0 ? " limit-used" : "");

  notice.innerHTML = remaining > 0
    ? `
      <strong>${remaining} of ${limit} free estimates remaining</strong>
      <span>
        Completed estimates are counted by email during a rolling 30-day period.
        Opening, printing, or refreshing a saved estimate does not use another estimate.
      </span>
    `
    : `
      <strong>This was free estimate ${used} of ${limit} for the current 30-day period.</strong>
      <span>
        Your saved results remain available. Use Tax Money Tracker for ongoing changes,
        estimate comparisons, and year-round savings accountability.
      </span>
      <a href="/client-portal">Explore the 14-day preview — no automatic charge</a>
    `;

  disclaimer.insertAdjacentElement("afterend", notice);
}

async function submitLeadGateway(input, result) {
  const fullName = (document.getElementById("gatewayFullName")?.value || "").trim();
  const email = (document.getElementById("gatewayEmail")?.value || "").trim();
  const errorBox = document.getElementById("leadGatewayErrors");
  const btn = document.getElementById("gatewayUnlockBtn");

  const errors = [];

  if (!fullName) errors.push("Full name is required.");
  if (!email) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Please enter a valid email address.");
  }

  if (errors.length > 0) {
    if (errorBox) {
      errorBox.innerHTML = errors.map((e) => `<div>${escHtml(e)}</div>`).join("");
      errorBox.style.display = "block";
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Unlocking Estimate...";
    btn.style.opacity = "0.75";
  }

  const estimateSummary = buildSavedEstimateSummary(result, input);

  try {
    const response = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fullName,
        email,
        phone: null,
        priority: result
          ? getReviewStatus(result.federal.summary, result.combined).level
          : "low",
        taxData: input || null,
        estimateSummary: estimateSummary || null,
        submissionType: _taxWatchUpdateContext
          ? "tax-watch-update"
          : "free-estimate",
        taxWatchUpdate: _taxWatchUpdateContext
          ? {
              sourceLeadId: _taxWatchUpdateContext.sourceLeadId || "",
              sourceCount: Array.isArray(input?.selfEmploymentStreams)
                ? Math.min(TAX_WATCH_PRO_SOURCE_LIMIT, input.selfEmploymentStreams.length)
                : 0,
              updateReason: "Tax Watch Pro estimate update"
            }
          : null,
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The server returned an unreadable response. Please try again.");
    }

    if (!response.ok || !data.ok) {
      if (data.code === "FREE_ESTIMATE_LIMIT_REACHED") {
        renderFreeEstimateLimitReached(
          data.freeEstimateUsage || {}
        );
        return;
      }

      const serverErrors = Array.isArray(data.errors) && data.errors.length > 0
        ? data.errors
        : ["Could not unlock your estimate. Please try again."];
      throw new Error(serverErrors.join(" "));
    }

    _leadGatewayUnlocked = true;
    _leadGatewayContact = {
      fullName,
      email,
      leadId: data.leadId || null,
      freeEstimateUsage: data.freeEstimateUsage || null,
    };

    const overlay = document.getElementById("leadGatewayOverlay");
    if (overlay) overlay.remove();

    resetLeadForm();
    const leadNameInput = document.getElementById("leadName");
    const leadEmailInput = document.getElementById("leadEmail");
    if (leadNameInput) leadNameInput.value = fullName;
    if (leadEmailInput) leadEmailInput.value = email;
    renderResults(result, input);
    renderFreeEstimateUsageNotice(
      data.freeEstimateUsage || null
    );
    goToScreen("results");

    if (_taxWatchUpdateContext) {
      localStorage.removeItem(TAX_WATCH_UPDATE_CONTEXT_KEY);
      ensureTaxWatchReturnBanner();
    }
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || "Could not unlock your estimate. Please try again.";
      errorBox.style.display = "block";
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = "View My Full Estimate";
      btn.style.opacity = "";
    }
  }
}

// =============================================================================
// LEAD FORM - SUBMIT TO /api/lead
// =============================================================================

async function handleLeadSubmit(event) {
  console.log("LEAD SUBMIT FIRED");
  event.preventDefault();

  const nameEl = document.getElementById("leadName");
  const emailEl = document.getElementById("leadEmail");
  const phoneEl = document.getElementById("leadPhone");

  const name = (nameEl?.value || "").trim();
  const email = (emailEl?.value || "").trim();
  const phone = formatPhoneDisplay((phoneEl?.value || "").trim());
  const fitReason = (
    document.getElementById("taxPrepFitReason")?.value ||
    ""
  ).trim();
  const taxPrepInterestConfirmed = Boolean(
    document.getElementById("taxPrepInterestConfirm")?.checked
  );

  console.log("lead values", {
    name,
    email,
    phone,
    fitReason,
    taxPrepInterestConfirmed,
  });
  console.log("_lastTaxInput", _lastTaxInput);
  console.log("_lastEstimate", _lastEstimate);

  const errors = [];
  if (!name) errors.push("Full name is required.");
  if (!email) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Please enter a valid email address.");
  }

  if (!fitReason) {
    errors.push(
      "Select the tax preparation service you are considering."
    );
  }

  if (!taxPrepInterestConfirmed) {
    errors.push(
      "Confirm that you are considering hiring Greatest Business Solution LLC for paid tax preparation."
    );
  }

  console.log("lead validation errors", errors);

  if (errors.length > 0) {
    showLeadErrors(errors);
    return;
  }

  clearLeadErrors();
  setLeadLoading(true);

  const estimateSummary = buildSavedEstimateSummary(_lastEstimate, _lastTaxInput);

  console.log("about to fetch /api/lead", { estimateSummary });

  const followUpStamp = new Date().toLocaleString();
  const followUpNote =
    `[${followUpStamp}] Client requested a Tax Preparation Fit Call. ` +
    `Service interest: ${fitReason}. ` +
    `Client confirmed they are considering paid tax preparation.`;

  try {
    const response = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        phone: phone || null,
        priority: _lastEstimate
          ? getReviewStatus(_lastEstimate.federal.summary, _lastEstimate.combined).level
          : "low",
        status: "Follow-up Needed",
        notes: followUpNote,
        submissionType: "tax-preparation-fit-call",
        taxData: _lastTaxInput || null,
        estimateSummary: estimateSummary || null,
      }),
    });

    console.log("lead fetch response status", response.status);

    let data;
    try {
      data = await response.json();
      console.log("lead fetch response data", data);
    } catch {
      throw new Error("The server returned an unreadable response. Please try again.");
    }
    if (!response.ok || !data.ok) {
      const serverErrors = Array.isArray(data.errors) && data.errors.length > 0
        ? data.errors
        : ["Could not save your request. Please try again."];
      showLeadErrors(serverErrors);
      return;
    }

    showLeadSuccess(name, data.leadId);
  } catch (err) {
    console.error("[handleLeadSubmit]", err);
    showLeadErrors([
      err.message || "Could not reach the server. Please check your connection and try again.",
    ]);
  } finally {
    setLeadLoading(false);
  }
}

function showLeadErrors(errors) {
  const box = document.getElementById("leadErrors");
  const list = document.getElementById("leadErrorsList");
  if (!box || !list) return;
  list.innerHTML = errors.map((e) => `<li>${escHtml(e)}</li>`).join("");
  box.style.display = "block";
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearLeadErrors() {
  const box = document.getElementById("leadErrors");
  if (box) box.style.display = "none";
}

function showLeadSuccess(name, leadId) {
  const formState = document.getElementById("leadFormState");
  const success = document.getElementById("leadSuccess");
  const meta = document.getElementById("leadSuccessMeta");

  if (formState) formState.style.display = "none";
  if (success) success.style.display = "block";
  if (meta) meta.textContent = leadId ? `Reference: ${leadId}` : "";

  if (success) success.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetLeadForm() {
  const form = document.getElementById("leadForm");
  const formState = document.getElementById("leadFormState");
  const success = document.getElementById("leadSuccess");

  if (form) form.reset();
  if (formState) formState.style.display = "block";
  if (success) success.style.display = "none";
  clearLeadErrors();
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

function fmt(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function signedFmt(n) {
  if (n > 0) return `+${fmt(n)}`;
  if (n < 0) return `-${fmt(Math.abs(n))}`;
  return "$0";
}

function escHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPhoneDisplay(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);

  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function formatWholeNumberDisplay(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";

  return Number(digits).toLocaleString("en-US");
}

function attachWholeNumberFormatting() {
  const formattedFieldIds = [
    "w2Income",
    "otherIncome",
    "scholarships",
    "educationExpenses",
    "federalWithheld",
    "stateWithheld",
    "selfEmploymentIncome",
    "businessExpenses",
    "businessMileage",
    "estimatedTaxPayments"
  ];

  formattedFieldIds.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    if (input.dataset.wholeNumberFormatAttached === "true") return;

    input.dataset.wholeNumberFormatAttached = "true";
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");

    input.addEventListener("input", (e) => {
      const cursorWasAtEnd = e.target.selectionStart === e.target.value.length;
      e.target.value = formatWholeNumberDisplay(e.target.value);

      if (cursorWasAtEnd) {
        e.target.selectionStart = e.target.value.length;
        e.target.selectionEnd = e.target.value.length;
      }
    });

    input.addEventListener("blur", (e) => {
      e.target.value = formatWholeNumberDisplay(e.target.value);
    });

    input.value = formatWholeNumberDisplay(input.value);
  });
}

function attachAgeFormatting() {
  const ageInput = document.getElementById("age");
  if (!ageInput) return;
  if (ageInput.dataset.ageFormatAttached === "true") return;

  ageInput.dataset.ageFormatAttached = "true";
  ageInput.setAttribute("type", "text");
  ageInput.setAttribute("inputmode", "numeric");
  ageInput.setAttribute("min", "13");
  ageInput.setAttribute("max", "120");
  ageInput.setAttribute("maxlength", "3");

  ageInput.addEventListener("input", (e) => {
    e.target.value = String(e.target.value || "").replace(/\D/g, "").slice(0, 3);
  });

  const hint = ageInput.closest(".field-group")?.querySelector(".field-hint");
  if (hint) {
    hint.textContent = "Enter taxpayer age as of December 31. Minors may still need to file depending on income and dependency status.";
  }
}

function initGlobalInputFormatting() {
  attachWholeNumberFormatting();
  attachAgeFormatting();

  const observer = new MutationObserver(() => {
    attachWholeNumberFormatting();
    attachAgeFormatting();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
function attachPhoneInputFormatting() {
  const phoneInputs = [
    document.getElementById("leadPhone"),
    ...Array.from(document.querySelectorAll('input[type="tel"], input[name="phone"], input[autocomplete="tel"]')),
  ].filter(Boolean);

  phoneInputs.forEach((input) => {
    if (input.dataset.phoneFormatAttached === "true") return;
    input.dataset.phoneFormatAttached = "true";

    input.setAttribute("maxlength", "14");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "tel");
    input.setAttribute("placeholder", "(555) 000-0000");

    input.addEventListener("input", (e) => {
      e.target.value = formatPhoneDisplay(e.target.value);
    });

    input.addEventListener("blur", (e) => {
      e.target.value = formatPhoneDisplay(e.target.value);
    });

    input.value = formatPhoneDisplay(input.value);
  });
}

function initPhoneFormatting() {
  attachPhoneInputFormatting();

  const observer = new MutationObserver(() => {
    attachPhoneInputFormatting();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// =============================================================================
// INSIGHT / RESULTS HELPERS
// =============================================================================

function buildSelfEmploymentInsights(fed) {
  if (!fed.hasSelfEmployment) return [];

  const insights = [];
  const net = fed.netSelfEmploymentIncome || 0;
  const gross = fed.selfEmploymentIncome || 0;
  const expenses = fed.businessExpenses || 0;
  const mileage = fed.mileageDeduction || 0;
  const seTax = fed.selfEmploymentTax || 0;
  const estPaid = fed.estimatedTaxPayments || 0;

  if (net < 0) {
    insights.push({
      priority: "high",
      title: "Your business is showing a loss",
      body: `Your current estimate shows a business loss of ${fmt(net)}. This can reduce taxes, but your expenses and mileage should be well documented.`,
    });
  }

  if (net > 0 && estPaid === 0) {
    insights.push({
      priority: "high",
      title: "You may need quarterly estimated tax payments",
      body: `Your business profit of ${fmt(net)} may require quarterly payments to avoid IRS penalties.`,
    });
  }

  if (seTax > 0) {
    insights.push({
      priority: "medium",
      title: "Self-employment tax impact",
      body: `Your self-employment tax is ${fmt(seTax)}. This is separate from income tax and often surprises 1099 earners.`,
    });
  }

  if (gross > 0 && expenses / gross < 0.1) {
    insights.push({
      priority: "medium",
      title: "You may be missing deductions",
      body: `Your expenses appear low compared to income. A review may uncover additional deductions.`,
    });
  }

  if (mileage >= 5000) {
    insights.push({
      priority: "medium",
      title: "Mileage is a major deduction",
      body: `Your mileage deduction is ${fmt(mileage)}. Be sure you have proper tracking records.`,
    });
  }

  return insights;
}

function getPrimaryTaxProInsight(fed, combined) {
  const insights = buildSelfEmploymentInsights(fed);

  if (insights.length > 0) return insights[0];

  if ((combined?.refundAmount || 0) > 0) {
    return {
      priority: "medium",
      title: "What This Means For You",
      body: `You're currently estimated to get back ${fmt(combined.refundAmount)} between your federal and state returns. A professional follow-up can confirm whether additional deductions or credits may improve this result.`,
    };
  }

  if ((combined?.owedAmount || 0) > 0) {
    return {
      priority: "high",
      title: "What This Means For You",
      body: `You're currently estimated to owe ${fmt(combined.owedAmount)} between your federal and state returns. A professional follow-up may help reduce what you owe and improve your tax planning.`,
    };
  }

  return {
    priority: "medium",
    title: "What This Means For You",
    body: "Your estimate appears close to break-even. A professional follow-up can help confirm accuracy and identify missed opportunities.",
  };
}

function getReviewStatus(fed, combined) {
  const netSE = fed.netSelfEmploymentIncome || 0;
  const seTax = fed.selfEmploymentTax || 0;
  const estPaid = fed.estimatedTaxPayments || 0;
  const mileage = fed.mileageDeduction || 0;
  const owed = combined?.owedAmount || 0;
  const refund = combined?.refundAmount || 0;
  const grossSE = fed.selfEmploymentIncome || 0;

  if (
    netSE < 0 ||
    owed >= 3000 ||
    seTax >= 1000 ||
    (netSE > 0 && estPaid === 0) ||
    mileage >= 10000
  ) {
    return {
      level: "high",
      label: "High Priority Review",
      reason:
        netSE < 0
          ? "Business loss detected. Review records and deduction support carefully."
          : owed >= 3000
            ? "Estimated total amount due is high enough to justify immediate review."
            : seTax >= 1000
              ? "Self-employment tax is significant and may need planning."
              : mileage >= 10000
                ? "Mileage is a major deduction and should be documented."
                : "This estimate may benefit from professional follow-up.",
    };
  }

  if (owed > 0 || netSE > 0 || refund >= 1000 || grossSE > 0) {
    return {
      level: "medium",
      label: "Moderate Priority Review",
      reason: "This estimate may still benefit from a professional check for deductions, credits, and planning opportunities.",
    };
  }

  return {
    level: "low",
    label: "Low Priority Review",
    reason: "This estimate appears straightforward, but professional follow-up is still available if you want added confidence.",
  };
}

function renderTaxProInsightBanner(fed, combined) {
  const host = document.getElementById("taxProInsightBanner");
  if (!host) return;

  const insight = getPrimaryTaxProInsight(fed, combined);
  const reviewStatus = getReviewStatus(fed, combined);

  host.innerHTML = `
    <div class="taxpro-banner taxpro-banner-${escHtml(reviewStatus.level)} taxpro-banner-compact">
      <div class="taxpro-banner-top">
        <div class="taxpro-banner-status">
          <span class="taxpro-status-dot"></span>
          <span class="taxpro-status-label">${escHtml(reviewStatus.label)}</span>
        </div>
        <div class="taxpro-banner-mini">
          Automated estimate screening
        </div>
      </div>

      <div class="taxpro-banner-title">${escHtml(insight.title)}</div>
      <div class="taxpro-banner-body">${escHtml(insight.body)}</div>

      <div class="taxpro-banner-reason">
        ${escHtml(reviewStatus.reason)}
      </div>
    </div>

    <details class="transcript-help-details">
      <summary>
        <span>
          Missing a W-2, 1099, prior-year return, or IRS record?
        </span>
        <strong>View IRS Transcript Help - $150</strong>
      </summary>

      <div class="transcript-help-details-body">
        <p>
          Use this only when you need IRS records, missing wage documents,
          prior-year filing research, or help understanding an IRS notice or balance.
          The $150 service covers one transcript-help matter for one taxpayer.
        </p>

        <div class="transcript-help-choice-grid">
          <div class="transcript-help-choice-box">
            <div class="transcript-help-choice-title">
              What do you need help with?
            </div>
            <label><input type="checkbox" class="transcriptNeedOption" value="I received an IRS letter or notice"> I received an IRS letter or notice</label>
            <label><input type="checkbox" class="transcriptNeedOption" value="I am missing a W-2"> I am missing a W-2</label>
            <label><input type="checkbox" class="transcriptNeedOption" value="I am missing a 1099"> I am missing a 1099</label>
            <label><input type="checkbox" class="transcriptNeedOption" value="I need wage or income records"> I need wage or income records</label>
            <label><input type="checkbox" class="transcriptNeedOption" value="I need to know if a return was filed"> I need to know if a return was filed</label>
            <label><input type="checkbox" class="transcriptNeedOption" value="I need prior-year tax records"> I need prior-year tax records</label>
            <label><input type="checkbox" class="transcriptNeedOption" value="I need to know what I owe the IRS"> I need to know what I owe the IRS</label>
            <label><input type="checkbox" class="transcriptNeedOption" value="I need records for tax preparation"> I need records for tax preparation</label>
            <label><input type="checkbox" class="transcriptNeedOption" value="I am not sure / I need help figuring it out"> I am not sure / I need help figuring it out</label>
          </div>

          <div class="transcript-help-choice-box">
            <div class="transcript-help-choice-title">
              Transcript type, if known
            </div>
            <label><input type="checkbox" class="transcriptTypeOption" value="Wage and Income Transcript"> Wage and Income Transcript</label>
            <label><input type="checkbox" class="transcriptTypeOption" value="Tax Account Transcript"> Tax Account Transcript</label>
            <label><input type="checkbox" class="transcriptTypeOption" value="Tax Return Transcript"> Tax Return Transcript</label>
            <label><input type="checkbox" class="transcriptTypeOption" value="Record of Account Transcript"> Record of Account Transcript</label>
            <label><input type="checkbox" class="transcriptTypeOption" value="Verification of Non-Filing"> Verification of Non-Filing</label>
            <label><input type="checkbox" class="transcriptTypeOption" value="Not sure - please help me decide"> Not sure - please help me decide</label>
          </div>
        </div>

        <label class="transcript-help-detail-label" for="transcriptHelpRequestText">
          Additional details (optional)
        </label>
        <textarea
          id="transcriptHelpRequestText"
          class="transcript-help-detail-textarea"
          placeholder="Example: I am missing a 2025 W-2 and need wage and income records for tax preparation."
        ></textarea>

        <div class="transcript-help-action-row">
          <button
            type="button"
            id="transcriptReviewBtn"
            class="btn-transcript-help"
          >
            Purchase IRS Transcript Help - $150
          </button>
          <span>
            Not full tax preparation, IRS representation, or ongoing monitoring.
          </span>
        </div>
      </div>
    </details>
  `;

  const transcriptBtn = document.getElementById("transcriptReviewBtn");
  if (transcriptBtn) {
    transcriptBtn.addEventListener("click", requestTranscriptHelp);
  }
}

function renderBreakdownRows(elId, rows) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = rows
    .map(
      (r) => `
        <li>
          <span>${escHtml(r.label)}</span>
          <span class="brow-val">${escHtml(r.val)}</span>
        </li>
      `
    )
    .join("");
}

function renderBreakdownTotal(elId, label, val, cls) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `
    <span>${escHtml(label)}</span>
    <span class="total-val ${escHtml(cls)}">${escHtml(val)}</span>
  `;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderClientEstimateSummaryLink() {
  const host = document.getElementById("taxProInsightBanner");
  if (!host) return;

  const existing = document.getElementById("clientSummaryLinkBox");
  if (existing) existing.remove();

  const leadId = _leadGatewayContact?.leadId;
  if (!leadId) return;

  const summaryUrl =
    `${window.location.origin}/estimate/${encodeURIComponent(leadId)}`;

  const box = document.createElement("div");
  box.id = "clientSummaryLinkBox";
  box.className = "detailed-summary-ready-box";

  box.innerHTML = `
    <div class="detailed-summary-ready-copy">
      <div class="detailed-summary-ready-kicker">
        Your saved estimate
      </div>
      <div class="detailed-summary-ready-title">
        Your Detailed Tax Estimate Summary Is Ready
      </div>
      <div class="detailed-summary-ready-text">
        Open it to see tax after credits, estimated credits applied,
        marginal and effective tax rates, withholding differences,
        working-child guidance, and the items that could change the estimate.
      </div>
      <div class="detailed-summary-ready-reference">
        Reference ID: ${escHtml(leadId)}
      </div>
    </div>

    <a
      href="${escHtml(summaryUrl)}"
      target="_blank"
      rel="noopener noreferrer"
      class="detailed-summary-ready-button"
    >
      Open My Detailed Estimate Summary
    </a>
  `;

  host.parentNode.insertBefore(box, host.nextSibling);
}


function renderPersonalizedUpgradeOffer(combined, meta) {
  const section = document.getElementById("personalizedUpgradeSection");
  const title = document.getElementById("personalizedUpgradeTitle");
  const body = document.getElementById("personalizedUpgradeBody");
  const amountLabel = document.getElementById("personalizedUpgradeAmountLabel");
  const amount = document.getElementById("personalizedUpgradeAmount");
  const watchReason = document.getElementById("taxWatchUpgradeReason");
  const pinnacleReason = document.getElementById("pinnacleUpgradeReason");

  if (!section || !title || !body || !amountLabel || !amount) return;

  const taxYear = meta?.taxYear ? ` for tax year ${meta.taxYear}` : "";
  let amountValue = "$0";

  if (combined?.isRefund) {
    amountValue = fmt(combined.refundAmount || 0);
    amountLabel.textContent = "Current estimated refund";
    title.textContent = "Keep the refund—or see how future changes may affect it.";
    body.textContent =
      `Your current combined estimate${taxYear} shows a possible refund of ${amountValue}. ` +
      "A new job, different withholding, gig income, or a family change could move that number.";
    if (watchReason) {
      watchReason.textContent =
        "Track how income, withholding, dependents, and life changes affect your projected refund.";
    }
    if (pinnacleReason) {
      pinnacleReason.textContent =
        "Compare keeping a larger refund with possible paycheck or savings adjustments during the year.";
    }
  } else if (combined?.isOwed) {
    amountValue = fmt(combined.owedAmount || 0);
    amountLabel.textContent = "Current estimated balance due";
    title.textContent = "You may owe. See what changed and prepare before tax season.";
    body.textContent =
      `Your current combined estimate${taxYear} shows a possible balance due of ${amountValue}. ` +
      "Year-round tracking can help you see when the number changes instead of finding out at filing time.";
    if (watchReason) {
      watchReason.textContent =
        "Track new income, withholding, dependents, and business changes that may increase or reduce what you owe.";
    }
    if (pinnacleReason) {
      pinnacleReason.textContent =
        "Build toward paycheck, monthly savings, or quarterly-payment guidance based on your selected goal.";
    }
  } else {
    amountLabel.textContent = "Current estimated result";
    title.textContent = "You are near break-even. Keep it that way as life changes.";
    body.textContent =
      `Your current combined estimate${taxYear} is close to $0. ` +
      "A job change, extra income, different withholding, or a new dependent could change the result.";
    if (watchReason) {
      watchReason.textContent =
        "Watch your estimate during the year so a change does not become a surprise at tax time.";
    }
    if (pinnacleReason) {
      pinnacleReason.textContent =
        "Set a refund or balance-due goal and compare future paycheck or savings options.";
    }
  }

  amount.textContent = amountValue;
  amount.className =
    "personalized-upgrade-amount " +
    (combined?.isRefund ? "refund" : combined?.isOwed ? "owed" : "even");
  section.hidden = false;
}

function renderResults(result, input) {
  const { meta, federal, state, combined, clientExperience } = result;
  const fed = federal.summary;
  const st = state.summary;
  const cx = clientExperience || {};

  renderTaxProInsightBanner(fed, combined);
  renderClientEstimateSummaryLink();

  setText("resultYear", meta.taxYear);
  setText("actionBarYear", meta.taxYear); setText("combinedTaxYearLine", "Tax Year " + meta.taxYear);

  const heroAmount = document.getElementById("heroAmount");
  const heroStatus = document.getElementById("heroStatus");

  if (heroAmount) {
    heroAmount.textContent = combined.isRefund
      ? fmt(combined.refundAmount)
      : combined.isOwed
        ? fmt(combined.owedAmount)
        : "$0";
    heroAmount.className = "result-hero-amount" + (combined.isOwed ? " owe" : "");
  }

  if (heroStatus) {
    heroStatus.textContent = combined.isRefund
      ? "Estimated combined refund - you may be getting money back"
      : combined.isOwed
        ? "Estimated combined balance due - you may owe this amount"
        : "You appear to be near break-even this year";
  }

  renderPersonalizedUpgradeOffer(combined, meta);

  const completeness = getEstimateCompleteness(input);
  const confScore = document.getElementById("confidenceScore");
  const confDesc = document.getElementById("confidenceDesc");
  if (confScore) {
    confScore.textContent = `${completeness.completed} of ${completeness.total}`;
    confScore.className = "confidence-score";
  }
  if (confDesc) {
    confDesc.textContent = completeness.childCount > 0
      ? `Required fields completed. Working-child check completed for ${completeness.childCount} child${completeness.childCount === 1 ? "" : "ren"}.`
      : "All required estimate fields were completed.";
  }

  renderWorkingChildResults(input);

  const fedRows = [];
  fedRows.push({ label: "W-2 wages", val: fmt((fed.grossIncome || 0) - (fed.netSelfEmploymentIncome || 0)) });
  if (fed.hasSelfEmployment) {
    fedRows.push({ label: "- 1099 / self-employment income", val: fmt(fed.selfEmploymentIncome) });
    if ((fed.businessExpenses || 0) > 0) {
      fedRows.push({ label: "- Business expenses", val: `-${fmt(fed.businessExpenses)}` });
    }
    if ((fed.mileageDeduction || 0) > 0) {
      fedRows.push({ label: "- Mileage deduction", val: `-${fmt(fed.mileageDeduction)}` });
    }
    fedRows.push({ label: "- Net business income", val: fmt(fed.netSelfEmploymentIncome) });
    fedRows.push({ label: "Self-employment tax", val: fmt(fed.selfEmploymentTax) });
    if ((fed.seAboveLineDeduction || 0) > 0) {
      fedRows.push({ label: "SE tax deduction (50%)", val: `-${fmt(fed.seAboveLineDeduction)}` });
    }
  }
  fedRows.push({ label: "Adjusted gross income", val: fmt(fed.agi) });
  fedRows.push({ label: "Standard deduction", val: `-${fmt(fed.standardDeduction)}` });
  fedRows.push({ label: "Taxable income", val: fmt(fed.taxableIncome) });
  fedRows.push({ label: "Income tax", val: fmt(fed.taxBeforeCredits) });
  if ((fed.educationCredit || 0) > 0) fedRows.push({ label: "Education credit", val: `-${fmt(fed.educationCredit)}` });
  if ((fed.childTaxCredit || 0) > 0) fedRows.push({ label: "Child Tax Credit", val: `-${fmt(fed.childTaxCredit)}` });
  fedRows.push({ label: "Federal tax withheld", val: fmt(fed.federalWithheld) });
  if ((fed.estimatedTaxPayments || 0) > 0) fedRows.push({ label: "Estimated tax payments", val: fmt(fed.estimatedTaxPayments) });

  renderBreakdownRows("federalRows", fedRows);
  renderBreakdownTotal(
    "federalTotal",
    fed.isRefund ? "Federal refund" : fed.isOwed ? "Federal balance due" : "Federal break-even",
    fed.isRefund ? `+${fmt(fed.refundAmount)}` : fed.isOwed ? `-${fmt(fed.owedAmount)}` : "$0",
    fed.isRefund ? "refund" : fed.isOwed ? "owe" : "none"
  );

  const stateCardLabel = document.getElementById("stateCardLabel");
  if (stateCardLabel) stateCardLabel.textContent = meta.stateName || meta.stateCode;

  if (!state.hasIncomeTax) {
    renderBreakdownRows("stateRows", [
      { label: "State income tax", val: "$0" },
      { label: "No state tax", val: "-" },
    ]);
    const sw = st.stateWithheld || 0;
    renderBreakdownTotal("stateTotal", "State result", sw > 0 ? `+${fmt(sw)}` : "$0", sw > 0 ? "refund" : "none");
  } else if (!state.canEstimate) {
    renderBreakdownRows("stateRows", [{ label: "State estimate", val: "Not available" }]);
    renderBreakdownTotal("stateTotal", "Cannot estimate", "-", "none");
  } else {
    renderBreakdownRows("stateRows", [
      { label: "State taxable income", val: fmt(st.stateTaxableIncome) },
      { label: "Estimated state tax", val: fmt(st.stateTax) },
      { label: "State withheld", val: fmt(st.stateWithheld) },
    ]);
    renderBreakdownTotal(
      "stateTotal",
      st.isRefund ? "State refund" : st.isOwed ? "State balance due" : "State break-even",
      st.isRefund ? `+${fmt(st.refundAmount)}` : st.isOwed ? `-${fmt(st.owedAmount)}` : "$0",
      st.isRefund ? "refund" : st.isOwed ? "owe" : "none"
    );
  }

  renderBreakdownRows("combinedRows", [
    { label: "Federal estimate", val: signedFmt(combined.federalNet) },
    { label: "State estimate", val: signedFmt(combined.stateNet) },
  ]);
  renderBreakdownTotal(
    "combinedTotal",
    combined.isRefund ? "Total refund" : combined.isOwed ? "Total balance due" : "Break-even",
    combined.isRefund ? `+${fmt(combined.refundAmount)}` : combined.isOwed ? `-${fmt(combined.owedAmount)}` : "$0",
    combined.isRefund ? "refund" : combined.isOwed ? "owe" : "none"
  );

  const summaryEl = document.getElementById("summaryText");
  if (summaryEl) {
    const paras = Array.isArray(cx.summary) && cx.summary.length > 0
      ? cx.summary
      : ["This estimate is based on the information you entered. A professional review can help confirm the final result."];
    summaryEl.innerHTML = paras.map((p) => `<p>${escHtml(p)}</p>`).join("");
  }

  const driversEl = document.getElementById("driversGrid");
  if (driversEl) {
    const drivers = Array.isArray(cx.keyDrivers) ? cx.keyDrivers : [];
    driversEl.innerHTML = drivers
      .map(
        (d) => `
          <div class="driver-card">
            <div class="driver-header">
              <div class="driver-label">${escHtml(d.label)}</div>
              <div class="driver-value">${escHtml(d.value)}</div>
            </div>
            <div class="driver-explanation">${escHtml(d.explanation)}</div>
          </div>
        `
      )
      .join("");
  }

  const changesEl = document.getElementById("changesList");
  if (changesEl) {
    const changes = Array.isArray(cx.whatCouldChange) ? cx.whatCouldChange : [];
    changesEl.innerHTML = changes
      .map(
        (c) => `
          <div class="change-item">
            <div class="change-impact ${escHtml(c.impact || "neutral")}">${c.impact === "positive" ? "+" : c.impact === "negative" ? "-" : "~"}</div>
            <div class="change-body">
              <div class="change-label">${escHtml(c.label)}</div>
              <div class="change-detail">${escHtml(c.detail)}</div>
            </div>
          </div>
        `
      )
      .join("");
  }

  const recsEl = document.getElementById("recommendationsList");
  if (recsEl) {
    const recs = Array.isArray(cx.recommendations) ? cx.recommendations : [];
    recsEl.innerHTML = recs
      .map(
        (r) => `
          <div class="rec-card priority-${escHtml(r.priority || "standard")}">
            <div class="rec-badge ${escHtml(r.priority || "standard")}">${r.priority === "high" ? "Action Needed" : r.priority === "medium" ? "Recommended" : "Advisory"}</div>
            <div class="rec-title">${escHtml(r.title)}</div>
            <div class="rec-body">${escHtml(r.body)}</div>
          </div>
        `
      )
      .join("");
  }

  const discEl = document.getElementById("disclaimerList");
  if (discEl) {
    const disclaimers = Array.isArray(cx.disclaimer) ? cx.disclaimer : [];
    discEl.innerHTML = disclaimers.map((d) => `<li>${escHtml(d)}</li>`).join("");
  }

  const cta = cx.cta || {};
  const ctaTitle = document.getElementById("ctaTitle");
  const ctaCtx = document.getElementById("ctaContext");
  if (ctaTitle) ctaTitle.textContent = "Understand the Number Before You File";
  if (ctaCtx) ctaCtx.textContent = "The $29 Written Red Flag Review includes the Tax Savings Planner bonus. A Tax Preparation Fit Call is available only for taxpayers considering paid return preparation.";
}


const TAX_WATCH_UPDATE_CONTEXT_KEY = "tspTaxWatchUpdateContextV1";

function setEstimatorFieldValue(id, value) {
  const element = document.getElementById(id);
  if (!element || value === undefined || value === null) return;
  element.value = String(value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setEstimatorRadioValue(name, value) {
  const normalized = value === true ? "yes" : value === false ? "no" : String(value || "");
  const radio = document.querySelector(
    `input[name="${name}"][value="${normalized}"]`
  );
  if (radio) {
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function loadTaxWatchUpdateContext() {
  const url = new URL(window.location.href);

  if (url.searchParams.get("taxWatchUpdate") !== "1") {
    return false;
  }

  let context = null;

  try {
    context = JSON.parse(
      localStorage.getItem(TAX_WATCH_UPDATE_CONTEXT_KEY) || "null"
    );
  } catch {
    context = null;
  }

  if (!context || !context.taxData || !context.email) {
    return false;
  }

  _taxWatchUpdateContext = context;
  const taxData = context.taxData || {};
  const streams = Array.isArray(taxData.selfEmploymentStreams)
    ? taxData.selfEmploymentStreams.slice(0, TAX_WATCH_PRO_SOURCE_LIMIT)
    : [];

  setEstimatorFieldValue("taxYear", taxData.taxYear);
  setEstimatorFieldValue("filingStatus", taxData.filingStatus);
  setEstimatorFieldValue("age", taxData.age);
  setEstimatorRadioValue("isFullTimeStudent", Boolean(taxData.isFullTimeStudent));
  setEstimatorRadioValue("canBeClaimedAsDependent", Boolean(taxData.canBeClaimedAsDependent));
  setEstimatorFieldValue("stateCode", taxData.stateCode);
  setEstimatorFieldValue("numberOfDependents", taxData.numberOfDependents);
  setEstimatorFieldValue("w2Income", taxData.w2Income);
  setEstimatorFieldValue("otherIncome", taxData.otherIncome);
  setEstimatorFieldValue("scholarships", taxData.scholarships);
  setEstimatorFieldValue("educationExpenses", taxData.educationExpenses);
  setEstimatorFieldValue("federalWithheld", taxData.federalWithheld);
  setEstimatorFieldValue("stateWithheld", taxData.stateWithheld);
  setEstimatorFieldValue("businessMileage", taxData.businessMileage);
  setEstimatorFieldValue("estimatedTaxPayments", taxData.estimatedTaxPayments);

  ensureTaxWatchAdditionalSources();

  const sourceDefaults = {
    source: "",
    income: 0,
    uncategorizedExpenses: 0,
    expenses: 0,
    expenseCategories: {}
  };

  const expenseKeys = [
    "advertising", "contractLabor", "insurance", "legalProfessional",
    "officeExpense", "equipmentRent", "repairs", "supplies",
    "taxesLicenses", "travel", "meals", "utilities", "platformFees",
    "softwareSubscriptions", "phoneInternet", "other"
  ];

  for (let sourceNumber = 1; sourceNumber <= TAX_WATCH_PRO_SOURCE_LIMIT; sourceNumber += 1) {
    const fallback = sourceNumber === 1
      ? {
          ...sourceDefaults,
          income: taxData.selfEmploymentIncome || 0,
          expenses: taxData.businessExpenses || 0
        }
      : sourceDefaults;
    const source = streams[sourceNumber - 1] || fallback;
    const incomeField = sourceNumber === 1
      ? "selfEmploymentIncome"
      : `businessSource${sourceNumber}Income`;
    const expenseField = sourceNumber === 1
      ? "businessExpenses"
      : `businessSource${sourceNumber}Expenses`;

    setEstimatorFieldValue(
      `businessSource${sourceNumber}Name`,
      source.source || ""
    );
    setEstimatorFieldValue(
      incomeField,
      source.income || 0
    );
    setEstimatorFieldValue(
      expenseField,
      source.uncategorizedExpenses ??
        source.expenses ??
        0
    );

    expenseKeys.forEach((key) => {
      setEstimatorFieldValue(
        `businessSource${sourceNumber}Expense_${key}`,
        source.expenseCategories?.[key] || 0
      );
    });
  }

  openPopulatedTaxWatchAdditionalSources();

  const banner = document.getElementById("taxWatchUpdateBanner");
  if (banner) banner.hidden = false;

  goToScreen("form");
  window.scrollTo({ top: 0, behavior: "auto" });
  return true;
}

function ensureTaxWatchReturnBanner() {
  if (!_taxWatchUpdateContext) return;

  const results = document.getElementById("screen-results");
  if (!results || document.getElementById("taxWatchReturnBanner")) return;

  const banner = document.createElement("div");
  banner.id = "taxWatchReturnBanner";
  banner.className = "tax-watch-return-banner";
  banner.innerHTML = `
    <div>
      <strong>Your Tax Watch Pro update was saved.</strong>
      <span>Return to the portal to compare this estimate with your starting estimate.</span>
    </div>
    <a href="/client-portal/home#tax-watch">Return to Tax Watch Pro</a>
  `;

  results.prepend(banner);
}


// =============================================================================
// INIT
// =============================================================================

function initAllInputFormatting() {
  initPhoneFormatting();
  initGlobalInputFormatting();
  initWorkingChildChecker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAllInputFormatting);
} else {
  initAllInputFormatting();
}

document.addEventListener("DOMContentLoaded", () => {
  initializeEstimatorReturnLinks();

  if (!restoreEstimatorReturnContext()) {
    if (!loadTaxWatchUpdateContext()) {
      goToScreen("welcome");
    }
  }
});

window.addEventListener("pageshow", () => {
  const currentUrl = new URL(window.location.href);

  if (
    currentUrl.pathname === "/" &&
    currentUrl.searchParams.get("restoreEstimate") === "1" &&
    document.getElementById("screen-results")?.classList.contains("active")
  ) {
    currentUrl.searchParams.delete("restoreEstimate");
    window.history.replaceState(
      {},
      "",
      currentUrl.pathname +
        currentUrl.search +
        currentUrl.hash
    );
    sessionStorage.removeItem(ESTIMATOR_RETURN_CONTEXT_KEY);
  }

  const activeScreen = SCREENS.find((screenId) =>
    document
      .getElementById("screen-" + screenId)
      ?.classList.contains("active")
  );

  updateNewsletterVisibility(activeScreen || "welcome");
});


/* Launch safety: no broad state income tax states should not use State Tax Withheld */ (function(){ const noTaxStates=new Set(["AK","FL","NV","SD","TN","TX","WA","WY","NH"]); function applyNoTaxStateWithheldRule(){ const stateEl=document.getElementById("stateCode"); const withheldEl=document.getElementById("stateWithheld"); if(!stateEl||!withheldEl)return; let note=document.getElementById("noTaxStateWithheldNote"); if(!note){ note=document.createElement("div"); note.id="noTaxStateWithheldNote"; note.style.cssText="display:none;margin-top:8px;padding:10px 12px;border-radius:10px;background:#ecfeff;border:1px solid #38bdf8;color:#075985;font-weight:800;font-size:13px;line-height:1.45;"; note.textContent="This state has no broad state income tax, so State Tax Withheld is not used in this estimate."; const wrapper=withheldEl.closest(".field-group")||withheldEl.parentElement; if(wrapper)wrapper.appendChild(note); } if(noTaxStates.has(String(stateEl.value||"").toUpperCase())){ withheldEl.value="0"; withheldEl.disabled=true; withheldEl.style.background="#e2e8f0"; withheldEl.style.cursor="not-allowed"; note.style.display="block"; }else{ withheldEl.disabled=false; withheldEl.style.background=""; withheldEl.style.cursor=""; note.style.display="none"; } } document.addEventListener("change",function(e){ if(e.target&&e.target.id==="stateCode")applyNoTaxStateWithheldRule(); }); document.addEventListener("input",function(e){ const stateEl=document.getElementById("stateCode"); if(e.target&&e.target.id==="stateWithheld"&&stateEl&&noTaxStates.has(String(stateEl.value||"").toUpperCase())){ e.target.value="0"; } }); document.addEventListener("DOMContentLoaded",applyNoTaxStateWithheldRule); setTimeout(applyNoTaxStateWithheldRule,0); })();






// PAID-REVIEW-INTAKE-OVERRIDE
(function () {
  if (window.__paidReviewIntakeOverride) return;
  window.__paidReviewIntakeOverride = true;

  function showPaidReviewIntakeModal() {
    return new Promise((resolve) => {
      const old = document.getElementById("paidReviewIntakeOverlay");
      if (old) old.remove();

      const overlay = document.createElement("div");
      overlay.id = "paidReviewIntakeOverlay";
      overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.78);display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto;";

      overlay.innerHTML = `
        <div style="background:#ffffff;width:min(920px,96vw);max-height:92vh;overflow:auto;border-radius:22px;box-shadow:0 24px 60px rgba(0,0,0,.35);border:3px solid #0f2c56;">
          <div style="padding:22px 24px;border-bottom:1px solid #dbe4f0;background:linear-gradient(180deg,#eff6ff 0%,#ffffff 100%);">
            <div style="font-size:13px;font-weight:950;color:#0f2c56;text-transform:uppercase;letter-spacing:.45px;">Written Red Flag Review + Tax Savings Planner Bonus - $29</div>
            <div style="font-size:26px;font-weight:950;color:#0f2c56;margin-top:5px;">Before payment, tell us what may affect your estimate</div>
            <div style="margin-top:8px;color:#334155;font-size:15px;line-height:1.55;font-weight:750;">
              This helps us prepare a more useful written review. Your written review will be emailed to the email address you provided, and the Tax Savings Planner is included as a bonus at no additional cost. The review is limited to the estimate information you entered and the answers below. It is not full tax preparation or a document-by-document tax return review.
            </div>
            <div style="margin-top:12px;padding:12px 14px;border:2px solid #0f766e;border-radius:13px;background:#ecfdf5;color:#065f46;font-size:14px;line-height:1.5;font-weight:850;">
              <strong>Bonus included:</strong> Tax Savings Planner&trade; with withholding checkup, quarterly-tax planning, what-if scenarios, tax-savings opportunities, and a personalized action plan.
            </div>
          </div>

          <div style="padding:22px 24px;">
            <div style="background:#fff7ed;border:2px solid #f59e0b;border-radius:16px;padding:14px 16px;color:#7c2d12;font-weight:850;line-height:1.55;margin-bottom:16px;">
              Select anything that applies. If you answer yes to any item, briefly explain it below. This protects both you and our office from relying on an estimate that may be missing important tax information.
            </div>

            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
              ${[
                "I had W-2 wages from one or more jobs.",
                "I had 1099-NEC, 1099-MISC, gig work, or independent contractor income.",
                "I had business expenses, mileage, tools, supplies, insurance, phone, advertising, or subcontractor costs.",
                "I received bank interest, dividends, stock sales, crypto, retirement income, unemployment, Social Security, or gambling income.",
                "I received Form 1099-C for cancellation of debt.",
                "I had mortgage interest, property taxes, or large charitable donations.",
                "I had marketplace health insurance and may receive Form 1095-A.",
                "I paid childcare, education expenses, or student loan interest.",
                "I moved states, worked in more than one state, or had income from another state.",
                "I received an IRS or state notice, have prior-year issues, or need transcript help."
              ].map((text, i) => `
                <label style="display:flex;gap:9px;align-items:flex-start;border:1px solid #dbe4f0;border-radius:14px;padding:12px;background:#f8fafc;font-size:14px;line-height:1.45;color:#0f172a;font-weight:750;">
                  <input class="paidReviewRedFlag" type="checkbox" value="${text.replace(/"/g, "&quot;")}" style="margin-top:3px;transform:scale(1.15);" />
                  <span>${text}</span>
                </label>
              `).join("")}
            </div>

            <label style="display:block;margin-top:16px;font-size:13px;font-weight:950;color:#0f2c56;text-transform:uppercase;letter-spacing:.35px;">
              Briefly explain any checked items
            </label>
            <textarea id="paidReviewIntakeComment" style="width:100%;min-height:110px;box-sizing:border-box;border:2px solid #cbd5e1;border-radius:14px;padding:12px;font-size:15px;line-height:1.55;margin-top:7px;font-family:Arial,sans-serif;" placeholder="Example: I have one W-2, mortgage interest, bank interest, and a 1099-NEC from side work. I am not sure if I included all business expenses."></textarea>

            <label style="display:flex;gap:10px;align-items:flex-start;margin-top:14px;background:#ecfdf5;border:1px solid #bbf7d0;border-radius:14px;padding:12px;color:#065f46;font-size:14px;line-height:1.45;font-weight:850;">
              <input id="paidReviewScopeAck" type="checkbox" style="margin-top:3px;transform:scale(1.15);" />
              <span>I understand this is a limited written red-flag review based on the information I entered and disclosed here. It is not full tax preparation, IRS/state representation, audit protection, or a guarantee of my final refund or balance due.</span>
            </label>

            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px;">
              <button id="paidReviewCancelBtn" type="button" style="background:#ffffff;color:#0f2c56;border:2px solid #0f2c56;border-radius:12px;padding:11px 15px;font-weight:950;cursor:pointer;">Cancel</button>
              <button id="paidReviewContinueBtn" type="button" style="background:#0f2c56;color:#ffffff;border:2px solid #0f2c56;border-radius:12px;padding:11px 15px;font-weight:950;cursor:pointer;">Continue to Payment</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      document.getElementById("paidReviewCancelBtn").onclick = () => {
        overlay.remove();
        resolve(null);
      };

      document.getElementById("paidReviewContinueBtn").onclick = () => {
        const selected = Array.from(document.querySelectorAll(".paidReviewRedFlag:checked")).map(x => x.value);
        const comment = String(document.getElementById("paidReviewIntakeComment")?.value || "").trim();
        const ack = document.getElementById("paidReviewScopeAck")?.checked;

        if (selected.length && comment.length < 10) {
          alert("Please briefly explain the items you checked before continuing.");
          return;
        }

        if (!selected.length && comment.length < 5) {
          alert("Please either select at least one item or briefly write that no other items apply.");
          return;
        }

        if (!ack) {
          alert("Please check the limited-scope acknowledgement before continuing.");
          return;
        }

        overlay.remove();
        resolve({ selected, comment, ack });
      };
    });
  }

  openPaidReview = async function () {
    const leadId = _leadGatewayContact?.leadId;

    if (!leadId) {
      alert("Please unlock your estimate first so the written review request can be attached to your record.");
      return;
    }

    const intake = await showPaidReviewIntakeModal();
    if (!intake) return;

    const paymentWindow = window.open("about:blank", "_blank");

    const stamp = new Date().toLocaleString();
    const actionNote =
      "[" + stamp + "] Client clicked Written Red Flag Review + Tax Savings Planner Bonus and completed the paid-review intake. Payment not yet confirmed.\n" +
      "Paid Review Intake - Selected Items: " + (intake.selected.length ? intake.selected.join("; ") : "None selected") + "\n" +
      "Paid Review Intake - Client Explanation: " + intake.comment + "\n" +
      "Paid Review Intake - Limited Scope Acknowledged: Yes";

    let clientName = "";
    let clientEmail = "";

    try {
      const readRes = await fetch("/api/estimate-summary/" + encodeURIComponent(leadId));
      const readData = await readRes.json();

      const lead = readData?.lead || {};
      const contact = lead.contact || {};
      clientName = contact.name || _leadGatewayContact?.fullName || "";
      clientEmail = contact.email || _leadGatewayContact?.email || "";

      const existingNotes = lead.notes || "";
      const notes = existingNotes ? existingNotes + "\n\n" + actionNote : actionNote;

      await fetch("/api/leads/" + encodeURIComponent(leadId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "Written Review - Payment Pending",
          notes
        })
      });
    } catch (err) {
      console.warn("Could not record written review intake before Stripe", err);
    }

    try {
      const checkoutRes = await fetch("/api/create-written-review-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          clientName,
          clientEmail
        })
      });

      const checkoutData = await checkoutRes.json();

      if (!checkoutRes.ok || !checkoutData.ok || !checkoutData.checkoutUrl) {
        throw new Error(checkoutData.error || "Could not open Written Review Stripe checkout.");
      }

      if (paymentWindow) {
        paymentWindow.location.href = checkoutData.checkoutUrl;
      } else {
        window.location.href = checkoutData.checkoutUrl;
      }
    } catch (err) {
      if (paymentWindow) paymentWindow.close();
      alert("Payment error: " + (err.message || "Could not open Written Review Stripe checkout."));
    }
  };
})();
