"use strict";

// =============================================================================
// MODULE STATE
// =============================================================================

let _lastTaxInput = null;
let _lastEstimate = null;
let _leadGatewayUnlocked = false;
let _leadGatewayContact = null;
let _freeEstimateEditContext = null;
let _workingChildCounter = 0;
let _taxWatchUpdateContext = null;
let _currentStateYearSupport = null;
let _stateYearSupportRequestId = 0;

// Shared DOM value helpers used by state-specific visibility/UX refresh functions.
// readForm() keeps its own local helpers; these globals prevent state refresh chains
// from depending on readForm() scope.
function getVal(id) {
  return document.getElementById(id)?.value ?? "";
}

function getRadio(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

function getNum(id) {
  return currencyNumberValue(getVal(id));
}

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

function getActiveFreeEstimateEditIdentity() {
  if (
    !_freeEstimateEditContext ||
    !_leadGatewayContact ||
    !String(_freeEstimateEditContext.fullName || "").trim() ||
    !String(_freeEstimateEditContext.email || "").trim()
  ) {
    return null;
  }

  return {
    fullName: String(_freeEstimateEditContext.fullName || "").trim(),
    email: String(_freeEstimateEditContext.email || "").trim(),
    sourceLeadId: String(_freeEstimateEditContext.sourceLeadId || "").trim(),
    estimateFamilyId: String(
      _freeEstimateEditContext.estimateFamilyId ||
      _freeEstimateEditContext.sourceLeadId ||
      ""
    ).trim(),
    taxYear: String(
      _freeEstimateEditContext.taxYear ||
      _lastTaxInput?.taxYear ||
      ""
    ).trim()
  };
}

function refreshFreeEstimateEditBanner() {
  const banner = document.getElementById("freeEstimateEditBanner");
  if (!banner) return;

  const identity = getActiveFreeEstimateEditIdentity();
  banner.hidden = !identity;

  const taxYearField = document.getElementById("taxYear");
  if (taxYearField) {
    taxYearField.disabled = Boolean(identity);
  }

  const calculateButton = document.getElementById("calculateBtn");
  if (calculateButton) {
    calculateButton.dataset.editMode = identity ? "true" : "false";
    if (!calculateButton.disabled) {
      calculateButton.innerHTML = identity
        ? "Calculate Updated Estimate"
        : "Calculate My Estimate";
    }
  }

  if (!identity) return;

  const name = document.getElementById("freeEstimateEditName");
  const email = document.getElementById("freeEstimateEditEmail");
  const reference = document.getElementById("freeEstimateEditReference");

  if (name) name.textContent = identity.fullName;
  if (email) email.textContent = identity.email;
  if (reference) {
    reference.textContent =
      identity.estimateFamilyId ||
      identity.sourceLeadId ||
      "Saved estimate";
  }
}

function beginEstimateEdit() {
  const fullName = String(_leadGatewayContact?.fullName || "").trim();
  const email = String(_leadGatewayContact?.email || "").trim();
  const sourceLeadId = String(_leadGatewayContact?.leadId || "").trim();

  if (
    !_lastTaxInput ||
    !_lastEstimate ||
    !fullName ||
    !email ||
    !sourceLeadId
  ) {
    goToScreen("form");
    return;
  }

  restoreEstimatorFormFromTaxData(_lastTaxInput);

  _freeEstimateEditContext = {
    fullName,
    email,
    sourceLeadId,
    estimateFamilyId: String(
      _leadGatewayContact?.estimateFamilyId ||
      sourceLeadId
    ).trim(),
    taxYear: String(_lastTaxInput.taxYear || "").trim(),
    startedAt: new Date().toISOString()
  };

  refreshFreeEstimateEditBanner();
  goToScreen("form");
}

function cancelEstimateEdit() {
  if (!_freeEstimateEditContext) {
    if (_lastEstimate) {
      goToScreen("results");
    } else {
      goToScreen("welcome");
    }
    return;
  }

  if (_lastTaxInput) {
    restoreEstimatorFormFromTaxData(_lastTaxInput);
  }

  const verifiedSavedIdentity = {
    fullName: String(
      _freeEstimateEditContext.fullName ||
      _leadGatewayContact?.fullName ||
      ""
    ).trim(),
    email: String(
      _freeEstimateEditContext.email ||
      _leadGatewayContact?.email ||
      ""
    ).trim(),
    leadId: String(
      _freeEstimateEditContext.sourceLeadId ||
      _leadGatewayContact?.leadId ||
      ""
    ).trim(),
    estimateFamilyId: String(
      _freeEstimateEditContext.estimateFamilyId ||
      _leadGatewayContact?.estimateFamilyId ||
      _freeEstimateEditContext.sourceLeadId ||
      _leadGatewayContact?.leadId ||
      ""
    ).trim(),
    freeEstimateUsage:
      _leadGatewayContact?.freeEstimateUsage || null
  };

  _freeEstimateEditContext = null;
  refreshFreeEstimateEditBanner();

  if (_lastTaxInput && _lastEstimate) {
    renderResults(_lastEstimate, _lastTaxInput);
    renderFreeEstimateUsageNotice(
      verifiedSavedIdentity.freeEstimateUsage
    );
    goToScreen("results");
    return;
  }

  const identityIsComplete = Boolean(
    verifiedSavedIdentity.fullName &&
    verifiedSavedIdentity.email &&
    verifiedSavedIdentity.leadId
  );

  if (identityIsComplete) {
    _leadGatewayUnlocked = true;
    _leadGatewayContact = verifiedSavedIdentity;
    goToScreen("welcome");

    window.setTimeout(() => {
      const plans =
        document.querySelector(".home-pricing-grid") ||
        document.querySelector(
          "[data-estimator-membership-plan]"
        );

      if (plans) {
        plans.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    }, 60);

    return;
  }

  _leadGatewayUnlocked = false;
  _leadGatewayContact = null;
  goToScreen("welcome");
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

function refreshSpouseAgeVisibility() {
  const filingStatus = document.getElementById("filingStatus");
  const spouseAgeRow = document.getElementById("spouseAgeRow");
  const spouseAge = document.getElementById("spouseAge");

  if (!filingStatus || !spouseAgeRow || !spouseAge) return;

  const show = filingStatus.value === "mfj";
  spouseAgeRow.hidden = !show;
  spouseAge.required = show;

  if (!show) {
    spouseAge.value = "";
    spouseAge.classList.remove("error-field");
  }
}

async function refreshStateYearSupport() {
  const stateCode =
    String(
      document.getElementById("stateCode")?.value ||
      ""
    ).trim().toUpperCase();

  const taxYear =
    Number(
      document.getElementById("taxYear")?.value ||
      0
    );

  const notice =
    document.getElementById(
      "stateYearSupportNotice"
    );

  const text =
    document.getElementById(
      "stateYearSupportText"
    );

  if (!notice || !text) {
    return;
  }

  if (!stateCode || !taxYear) {
    _currentStateYearSupport = null;
    notice.hidden = true;
    text.textContent = "";
    return;
  }

  const requestId =
    ++_stateYearSupportRequestId;

  notice.hidden = false;
  notice.style.background = "#eef5fb";
  notice.style.borderColor = "#9fc1dc";
  text.textContent =
    "Checking state tax-year availability…";

  try {
    const response = await fetch(
      "/api/state-tax-support?stateCode=" +
      encodeURIComponent(stateCode) +
      "&taxYear=" +
      encodeURIComponent(String(taxYear))
    );

    const data = await response.json();

    if (requestId !== _stateYearSupportRequestId) {
      return;
    }

    if (!response.ok || !data.ok || !data.support) {
      throw new Error(
        data?.error ||
        "Could not check state tax-year availability."
      );
    }

    _currentStateYearSupport =
      data.support;

    if (data.support.supported) {
      notice.style.background = "#edf8f2";
      notice.style.borderColor = "#8fc9aa";

      if (data.support.verifiedNoIndividualIncomeTax) {
        text.textContent =
          `${data.support.stateName} does not impose an individual state income tax for tax year ${taxYear}. ` +
          `No resident-state income tax is included in this estimate. ` +
          `If your W-2 shows state withholding, enter it so the estimator can flag a possible other-state filing issue.`;
      } else if (
        data.support.stateCode === "AL" &&
        Number(data.support.taxYear) === 2025
      ) {
        text.textContent =
          "Alabama 2025 full-year resident planning support is available. Alabama-specific questions below supply the federal-income-tax deduction and screen for filing-status, dependent, multi-state, credit, use-tax, and other special cases that must not be guessed.";
      } else if (
        data.support.stateCode === "OK" &&
        Number(data.support.taxYear) === 2025
      ) {
        text.textContent =
          "Oklahoma 2025 full-year resident Form 511 planning support is available. Oklahoma-only questions collect line 7/9 adjusted income, deduction/exemption details, child-credit/EIC inputs when relevant, and block 511-NR, Schedule 511-E, nonresident-spouse allocation, and material special-credit/additional-tax cases rather than guessing.";
      } else if (
        data.support.stateCode === "AR" &&
        Number(data.support.taxYear) === 2025
      ) {
        text.textContent =
          "Arkansas 2025 full-year resident regular-table planning support is available. Arkansas-specific questions collect AR1000F Line 23/25 amounts, deduction and personal-credit details, and block Low Income Tax Table, AR1000NR, MFS-same-return, and other material special-schedule cases rather than guessing.";
      } else if (
        data.support.stateCode === "LA" &&
        Number(data.support.taxYear) === 2025
      ) {
        text.textContent =
          "Louisiana 2025 full-year resident planning support is available. Louisiana-specific questions below apply the new 3% rate and standard deduction, collect Schedule E or federal-itemized medical details only when needed, calculate the 5% Louisiana EIC when applicable, and block other material state-only items rather than guessing.";
      } else if (
        data.support.stateCode === "GA" &&
        Number(data.support.taxYear) === 2025
      ) {
        text.textContent =
          "Georgia 2025 core state calculation is available. If Georgia's low-income or retirement-exclusion rules could materially change the result, the estimator will stop and request more detail instead of guessing.";
      } else if (
        data.support.stateCode === "KY" &&
        Number(data.support.taxYear) === 2025
      ) {
        text.textContent =
          "Kentucky 2025 planning calculation is available. Kentucky-specific questions below are used for the Family Size Tax Credit, retirement exclusion, itemized deduction choice, and common personal credits.";
      } else if (
        data.support.stateCode === "MS" &&
        Number(data.support.taxYear) === 2025
      ) {
        text.textContent =
          "Mississippi 2025 core state calculation is available. Mississippi-specific questions below account for filing exemptions, age/blind exemptions, deduction choice, retirement exclusions, and the state's $10,000 zero-rate band.";
      } else {
        text.textContent =
          `${data.support.stateName} state calculation is available for tax year ${taxYear}.`;
      }
    } else {
      notice.style.background = "#fff6df";
      notice.style.borderColor = "#d8a536";

      const availableYears =
        Array.isArray(
          data.support.availableYears
        ) &&
        data.support.availableYears.length
          ? data.support.availableYears.join(", ")
          : "none currently configured";

      text.textContent =
        `${data.support.stateName} state estimate is not available for tax year ${taxYear}. ` +
        `The estimator will not substitute another year's rules. ` +
        `Currently configured year(s): ${availableYears}.`;
    }
  } catch (error) {
    if (requestId !== _stateYearSupportRequestId) {
      return;
    }

    _currentStateYearSupport = null;
    notice.style.background = "#fff6df";
    notice.style.borderColor = "#d8a536";
    text.textContent =
      error.message ||
      "Could not check state tax-year availability.";
  }
}

function refreshAlabamaStateVisibility() {
  const stateCode =
    String(
      document.getElementById("stateCode")?.value ||
      ""
    ).toUpperCase();
  const filingStatus =
    document.getElementById("filingStatus")?.value ||
    "";
  const dependentCount = Math.max(
    0,
    parseInt(
      document.getElementById("numberOfDependents")?.value || "0",
      10
    ) || 0
  );

  const container =
    document.getElementById("alabamaStateQuestions");
  const dependentRow =
    document.getElementById("alabamaDependentRow");
  const headOfFamilyRow =
    document.getElementById("alabamaHeadOfFamilyRow");

  if (!container) return;

  const show = stateCode === "AL";
  const showDependents = show && dependentCount > 0;
  const showHeadOfFamily = show && filingStatus === "hoh";

  container.hidden = !show;
  if (dependentRow) dependentRow.hidden = !showDependents;
  if (headOfFamilyRow) headOfFamilyRow.hidden = !showHeadOfFamily;

  const residentField = document.getElementById("alFullYearResident");
  const federalDeductionField = document.getElementById("alFederalIncomeTaxDeduction");
  const dependentField = document.getElementById("alQualifyingDependents");
  const headField = document.getElementById("alHeadOfFamilyConfirmed");
  const specialField = document.getElementById("alHasSpecialItems");

  if (residentField) residentField.required = show;
  if (federalDeductionField) federalDeductionField.required = show;
  if (dependentField) dependentField.required = showDependents;
  if (headField) headField.required = showHeadOfFamily;
  if (specialField) specialField.required = show;

  if (!show) {
    [
      ["alFullYearResident", ""],
      ["alHeadOfFamilyConfirmed", ""],
      ["alQualifyingDependents", ""],
      ["alItemizedDeductions", "0"],
      ["alExemptIncome", "0"],
      ["alFederalIncomeTaxDeduction", ""],
      ["alEstimatedTaxPayments", "0"],
      ["alHasSpecialItems", ""],
    ].forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (field) {
        field.value = value;
        field.classList.remove("error-field");
      }
    });
    return;
  }

  if (!showDependents && dependentField) {
    dependentField.value = "";
  }

  if (!showHeadOfFamily && headField) {
    headField.value = "";
  }
}

function restoreIndianaStateFields(taxData = {}) {
  setEstimatorFieldValue("inFullYearResident", taxData.inFullYearResident === true ? "yes" : taxData.inFullYearResident === false ? "no" : "");
  setEstimatorFieldValue("inTotalAddbacks", taxData.inTotalAddbacks);
  setEstimatorFieldValue("inTotalDeductions", taxData.inTotalDeductions);
  setEstimatorFieldValue("inAdditionalDependentChildCount", taxData.inAdditionalDependentChildCount);
  setEstimatorFieldValue("inFirstYearAdditionalChildCount", taxData.inFirstYearAdditionalChildCount);
  setEstimatorFieldValue("inAdoptedDependentCount", taxData.inAdoptedDependentCount);
  setEstimatorFieldValue("inTaxpayerBlind", taxData.inTaxpayerBlind === true ? "yes" : taxData.inTaxpayerBlind === false ? "no" : "");
  setEstimatorFieldValue("inSpouseBlind", taxData.inSpouseBlind === true ? "yes" : taxData.inSpouseBlind === false ? "no" : "");
  setEstimatorFieldValue("inCountyTax", taxData.inCountyTax);
  setEstimatorFieldValue("inCountyWithheld", taxData.inCountyWithheld);
  setEstimatorFieldValue("inClaimedFederalEIC", taxData.inClaimedFederalEIC === true ? "yes" : taxData.inClaimedFederalEIC === false ? "no" : "");
  setEstimatorFieldValue("inFederalEICAmount", taxData.inFederalEICAmount);
  setEstimatorFieldValue("inHasUseTax", taxData.inHasUseTax === true ? "yes" : taxData.inHasUseTax === false ? "no" : "");
  setEstimatorFieldValue("inUseTax", taxData.inUseTax);
  setEstimatorFieldValue("inEstimatedAndExtensionPayments", taxData.inEstimatedAndExtensionPayments);
  setEstimatorFieldValue("inHasUnifiedTaxCreditForElderly", taxData.inHasUnifiedTaxCreditForElderly === true ? "yes" : taxData.inHasUnifiedTaxCreditForElderly === false ? "no" : "");
  setEstimatorFieldValue("inHasOtherCredits", taxData.inHasOtherCredits === true ? "yes" : taxData.inHasOtherCredits === false ? "no" : "");
  setEstimatorFieldValue("inHasOtherTaxesOrSpecialItems", taxData.inHasOtherTaxesOrSpecialItems === true ? "yes" : taxData.inHasOtherTaxesOrSpecialItems === false ? "no" : "");
  refreshIndianaStateVisibility();
}

function refreshIndianaStateVisibility() {
  const container = document.getElementById("indianaStateQuestions");
  if (!container) return;
  const isIN = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "IN" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const federalMfj = getVal("filingStatus") === "mfj";
  const hasEIC = getVal("inClaimedFederalEIC") === "yes";
  const hasUseTax = getVal("inHasUseTax") === "yes";
  container.hidden = !isIN;

  const spouseBlindGroup = document.getElementById("indianaSpouseBlindGroup");
  const eitcGroup = document.getElementById("indianaFederalEICAmountGroup");
  const useTaxGroup = document.getElementById("indianaUseTaxGroup");
  if (spouseBlindGroup) spouseBlindGroup.hidden = !(isIN && federalMfj);
  if (eitcGroup) eitcGroup.hidden = !(isIN && hasEIC);
  if (useTaxGroup) useTaxGroup.hidden = !(isIN && hasUseTax);

  [
    "inFullYearResident", "inTotalAddbacks", "inTotalDeductions",
    "inAdditionalDependentChildCount", "inFirstYearAdditionalChildCount",
    "inAdoptedDependentCount", "inTaxpayerBlind", "inCountyTax", "inCountyWithheld",
    "inClaimedFederalEIC", "inHasUseTax", "inHasUnifiedTaxCreditForElderly",
    "inHasOtherCredits", "inHasOtherTaxesOrSpecialItems"
  ].forEach((id) => { const el = document.getElementById(id); if (el) el.required = isIN; });
  const spouseBlind = document.getElementById("inSpouseBlind");
  if (spouseBlind) spouseBlind.required = isIN && federalMfj;
  const eitc = document.getElementById("inFederalEICAmount");
  if (eitc) eitc.required = isIN && hasEIC;
  const useTax = document.getElementById("inUseTax");
  if (useTax) useTax.required = isIN && hasUseTax;

  if (!isIN) {
    [
      ["inFullYearResident", ""], ["inTotalAddbacks", ""], ["inTotalDeductions", ""],
      ["inAdditionalDependentChildCount", ""], ["inFirstYearAdditionalChildCount", ""],
      ["inAdoptedDependentCount", ""], ["inTaxpayerBlind", ""], ["inSpouseBlind", ""],
      ["inCountyTax", ""], ["inCountyWithheld", ""], ["inClaimedFederalEIC", ""],
      ["inFederalEICAmount", "0"], ["inHasUseTax", ""], ["inUseTax", "0"],
      ["inEstimatedAndExtensionPayments", "0"], ["inHasUnifiedTaxCreditForElderly", ""],
      ["inHasOtherCredits", ""], ["inHasOtherTaxesOrSpecialItems", ""]
    ].forEach(([id, value]) => setEstimatorFieldValue(id, value));
    return;
  }
  if (!federalMfj) setEstimatorFieldValue("inSpouseBlind", "");
  if (!hasEIC) setEstimatorFieldValue("inFederalEICAmount", "0");
  if (!hasUseTax) setEstimatorFieldValue("inUseTax", "0");
}

function restoreIllinoisStateFields(taxData = {}) {
  setEstimatorFieldValue("ilFullYearResident", taxData.ilFullYearResident === true ? "yes" : taxData.ilFullYearResident === false ? "no" : "");
  setEstimatorFieldValue("ilTotalAdditions", taxData.ilTotalAdditions);
  setEstimatorFieldValue("ilRetirementSocialSecuritySubtraction", taxData.ilRetirementSocialSecuritySubtraction);
  setEstimatorFieldValue("ilIllinoisIncomeTaxOverpaymentSubtraction", taxData.ilIllinoisIncomeTaxOverpaymentSubtraction);
  setEstimatorFieldValue("ilOtherSubtractions", taxData.ilOtherSubtractions);
  setEstimatorFieldValue("ilSpouseCanBeClaimedAsDependent", taxData.ilSpouseCanBeClaimedAsDependent === true ? "yes" : taxData.ilSpouseCanBeClaimedAsDependent === false ? "no" : "");
  setEstimatorFieldValue("ilTaxpayerBlind", taxData.ilTaxpayerBlind === true ? "yes" : taxData.ilTaxpayerBlind === false ? "no" : "");
  setEstimatorFieldValue("ilSpouseBlind", taxData.ilSpouseBlind === true ? "yes" : taxData.ilSpouseBlind === false ? "no" : "");
  setEstimatorFieldValue("ilInvestmentCreditRecapture", taxData.ilInvestmentCreditRecapture);
  setEstimatorFieldValue("ilScheduleICRCredit", taxData.ilScheduleICRCredit);
  setEstimatorFieldValue("ilSchedule1299CCredit", taxData.ilSchedule1299CCredit);
  setEstimatorFieldValue("ilHasOtherStateTaxCredit", taxData.ilHasOtherStateTaxCredit === true ? "yes" : taxData.ilHasOtherStateTaxCredit === false ? "no" : "");
  setEstimatorFieldValue("ilHouseholdEmploymentTax", taxData.ilHouseholdEmploymentTax);
  setEstimatorFieldValue("ilUseTax", taxData.ilUseTax);
  setEstimatorFieldValue("ilHasCannabisGamingSurcharge", taxData.ilHasCannabisGamingSurcharge === true ? "yes" : taxData.ilHasCannabisGamingSurcharge === false ? "no" : "");
  setEstimatorFieldValue("ilEstimatedPayments", taxData.ilEstimatedPayments);
  setEstimatorFieldValue("ilPassThroughWithholding", taxData.ilPassThroughWithholding);
  setEstimatorFieldValue("ilPassThroughEntityTaxCredit", taxData.ilPassThroughEntityTaxCredit);
  setEstimatorFieldValue("ilClaimedFederalEITC", taxData.ilClaimedFederalEITC === true ? "yes" : taxData.ilClaimedFederalEITC === false ? "no" : "");
  setEstimatorFieldValue("ilFederalEITCAmount", taxData.ilFederalEITCAmount);
  setEstimatorFieldValue("ilHasDependentChildUnder12", taxData.ilHasDependentChildUnder12 === true ? "yes" : taxData.ilHasDependentChildUnder12 === false ? "no" : "");
  setEstimatorFieldValue("ilNeedsExpandedEITCWorksheet", taxData.ilNeedsExpandedEITCWorksheet === true ? "yes" : taxData.ilNeedsExpandedEITCWorksheet === false ? "no" : "");
  setEstimatorFieldValue("ilHasOtherSpecialItems", taxData.ilHasOtherSpecialItems === true ? "yes" : taxData.ilHasOtherSpecialItems === false ? "no" : "");
  refreshIllinoisStateVisibility();
}

function refreshIllinoisStateVisibility() {
  const container = document.getElementById("illinoisStateQuestions");
  if (!container) return;

  const isIL = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "IL" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const filingStatus = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  const isMFJ = filingStatus === "mfj";
  const claimedFederalEITC = getVal("ilClaimedFederalEITC") === "yes";

  container.hidden = !isIL;
  const spouseBlind = document.getElementById("illinoisSpouseBlindGroup");
  const spouseDependent = document.getElementById("illinoisSpouseDependentGroup");
  const eitcDetails = document.getElementById("illinoisEitcDetailsGroup");
  if (spouseBlind) spouseBlind.hidden = !(isIL && isMFJ);
  if (spouseDependent) spouseDependent.hidden = !(isIL && isMFJ);
  if (eitcDetails) eitcDetails.hidden = !(isIL && claimedFederalEITC);

  [
    "ilFullYearResident", "ilTotalAdditions", "ilRetirementSocialSecuritySubtraction",
    "ilIllinoisIncomeTaxOverpaymentSubtraction", "ilOtherSubtractions", "ilTaxpayerBlind",
    "ilInvestmentCreditRecapture", "ilScheduleICRCredit", "ilSchedule1299CCredit",
    "ilHasOtherStateTaxCredit", "ilHouseholdEmploymentTax", "ilUseTax",
    "ilHasCannabisGamingSurcharge", "ilEstimatedPayments", "ilPassThroughWithholding",
    "ilPassThroughEntityTaxCredit", "ilClaimedFederalEITC", "ilNeedsExpandedEITCWorksheet",
    "ilHasOtherSpecialItems"
  ].forEach((id) => { const el = document.getElementById(id); if (el) el.required = isIL; });
  const spouseClaim = document.getElementById("ilSpouseCanBeClaimedAsDependent");
  if (spouseClaim) spouseClaim.required = isIL && isMFJ;
  const spouseBlindField = document.getElementById("ilSpouseBlind");
  if (spouseBlindField) spouseBlindField.required = isIL && isMFJ;
  const federalEitcAmount = document.getElementById("ilFederalEITCAmount");
  if (federalEitcAmount) federalEitcAmount.required = isIL && claimedFederalEITC;
  const childUnder12 = document.getElementById("ilHasDependentChildUnder12");
  if (childUnder12) childUnder12.required = isIL && claimedFederalEITC;

  if (!isIL) {
    [
      ["ilFullYearResident", ""], ["ilTotalAdditions", ""], ["ilRetirementSocialSecuritySubtraction", ""],
      ["ilIllinoisIncomeTaxOverpaymentSubtraction", ""], ["ilOtherSubtractions", ""],
      ["ilSpouseCanBeClaimedAsDependent", ""], ["ilTaxpayerBlind", ""], ["ilSpouseBlind", ""],
      ["ilInvestmentCreditRecapture", ""], ["ilScheduleICRCredit", ""], ["ilSchedule1299CCredit", ""],
      ["ilHasOtherStateTaxCredit", ""], ["ilHouseholdEmploymentTax", ""], ["ilUseTax", ""],
      ["ilHasCannabisGamingSurcharge", ""], ["ilEstimatedPayments", ""], ["ilPassThroughWithholding", ""],
      ["ilPassThroughEntityTaxCredit", ""], ["ilClaimedFederalEITC", ""], ["ilFederalEITCAmount", "0"],
      ["ilHasDependentChildUnder12", ""], ["ilNeedsExpandedEITCWorksheet", ""], ["ilHasOtherSpecialItems", ""]
    ].forEach(([id, value]) => setEstimatorFieldValue(id, value));
    return;
  }

  if (!isMFJ) {
    setEstimatorFieldValue("ilSpouseCanBeClaimedAsDependent", "");
    setEstimatorFieldValue("ilSpouseBlind", "");
  }
  if (!claimedFederalEITC) {
    setEstimatorFieldValue("ilFederalEITCAmount", "0");
    setEstimatorFieldValue("ilHasDependentChildUnder12", "");
  }
}

function restoreOhioStateFields(taxData = {}) {
  setEstimatorFieldValue("ohFullYearResident", taxData.ohFullYearResident === true ? "yes" : taxData.ohFullYearResident === false ? "no" : "");
  setEstimatorFieldValue("ohTotalAdditions", taxData.ohTotalAdditions);
  setEstimatorFieldValue("ohOtherDeductionsExcludingBusinessIncomeDeduction", taxData.ohOtherDeductionsExcludingBusinessIncomeDeduction);
  setEstimatorFieldValue("ohScheduleBusinessIncomeTotal", taxData.ohScheduleBusinessIncomeTotal);
  setEstimatorFieldValue("ohSpouseCanBeClaimedAsDependent", taxData.ohSpouseCanBeClaimedAsDependent === true ? "yes" : taxData.ohSpouseCanBeClaimedAsDependent === false ? "no" : "");
  setEstimatorFieldValue("ohNonrefundableCredits", taxData.ohNonrefundableCredits);
  setEstimatorFieldValue("ohInterestPenalty", taxData.ohInterestPenalty);
  setEstimatorFieldValue("ohUseTax", taxData.ohUseTax);
  setEstimatorFieldValue("ohEstimatedAndOtherPayments", taxData.ohEstimatedAndOtherPayments);
  setEstimatorFieldValue("ohRefundableCredits", taxData.ohRefundableCredits);
  setEstimatorFieldValue("ohHasSchoolDistrictIncomeTax", taxData.ohHasSchoolDistrictIncomeTax === true ? "yes" : taxData.ohHasSchoolDistrictIncomeTax === false ? "no" : "");
  setEstimatorFieldValue("ohSchoolDistrictTax", taxData.ohSchoolDistrictTax);
  setEstimatorFieldValue("ohSchoolDistrictWithholding", taxData.ohSchoolDistrictWithholding);
  setEstimatorFieldValue("ohSchoolDistrictPayments", taxData.ohSchoolDistrictPayments);
  setEstimatorFieldValue("ohHasResidencyCreditOrAllocation", taxData.ohHasResidencyCreditOrAllocation === true ? "yes" : taxData.ohHasResidencyCreditOrAllocation === false ? "no" : "");
  setEstimatorFieldValue("ohHasAmendedNolOrSpecialItems", taxData.ohHasAmendedNolOrSpecialItems === true ? "yes" : taxData.ohHasAmendedNolOrSpecialItems === false ? "no" : "");
  refreshOhioStateVisibility();
}

function refreshOhioStateVisibility() {
  const container = document.getElementById("ohioStateQuestions");
  if (!container) return;

  const isOH = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "OH" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const isMFJ = String(document.getElementById("filingStatus")?.value || "").toLowerCase() === "mfj";
  const hasSchoolDistrictTax = getVal("ohHasSchoolDistrictIncomeTax") === "yes";

  container.hidden = !isOH;
  const spouseDependentGroup = document.getElementById("ohioSpouseDependentGroup");
  const schoolDistrictGroup = document.getElementById("ohioSchoolDistrictDetailsGroup");
  if (spouseDependentGroup) spouseDependentGroup.hidden = !(isOH && isMFJ);
  if (schoolDistrictGroup) schoolDistrictGroup.hidden = !(isOH && hasSchoolDistrictTax);

  [
    "ohFullYearResident", "ohTotalAdditions", "ohOtherDeductionsExcludingBusinessIncomeDeduction",
    "ohScheduleBusinessIncomeTotal", "ohNonrefundableCredits", "ohInterestPenalty", "ohUseTax",
    "ohEstimatedAndOtherPayments", "ohRefundableCredits", "ohHasSchoolDistrictIncomeTax",
    "ohHasResidencyCreditOrAllocation", "ohHasAmendedNolOrSpecialItems"
  ].forEach((id) => { const el = document.getElementById(id); if (el) el.required = isOH; });
  const spouseDependent = document.getElementById("ohSpouseCanBeClaimedAsDependent");
  if (spouseDependent) spouseDependent.required = isOH && isMFJ;
  ["ohSchoolDistrictTax", "ohSchoolDistrictWithholding", "ohSchoolDistrictPayments"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isOH && hasSchoolDistrictTax;
  });

  if (!isOH) {
    [
      ["ohFullYearResident", ""], ["ohTotalAdditions", ""],
      ["ohOtherDeductionsExcludingBusinessIncomeDeduction", ""], ["ohScheduleBusinessIncomeTotal", ""],
      ["ohSpouseCanBeClaimedAsDependent", ""], ["ohNonrefundableCredits", ""], ["ohInterestPenalty", ""],
      ["ohUseTax", ""], ["ohEstimatedAndOtherPayments", ""], ["ohRefundableCredits", ""],
      ["ohHasSchoolDistrictIncomeTax", ""], ["ohSchoolDistrictTax", ""], ["ohSchoolDistrictWithholding", ""],
      ["ohSchoolDistrictPayments", ""], ["ohHasResidencyCreditOrAllocation", ""],
      ["ohHasAmendedNolOrSpecialItems", ""]
    ].forEach(([id, value]) => setEstimatorFieldValue(id, value));
    return;
  }

  if (!isMFJ) setEstimatorFieldValue("ohSpouseCanBeClaimedAsDependent", "");
  if (!hasSchoolDistrictTax) {
    setEstimatorFieldValue("ohSchoolDistrictTax", "");
    setEstimatorFieldValue("ohSchoolDistrictWithholding", "");
    setEstimatorFieldValue("ohSchoolDistrictPayments", "");
  }
}

function restorePennsylvaniaStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  setEstimatorFieldValue("paFullYearResident", boolVal(taxData.paFullYearResident));
  [
    "paNetCompensation", "paInterestIncome", "paDividendIncome", "paBusinessFarmIncomeLoss",
    "paPropertyGainLoss", "paRentRoyaltyIncomeLoss", "paEstateTrustIncome", "paGamblingLotteryWinnings",
    "paOtherDeductions", "paResidentCredit", "paTaxForgivenessEligibilityIncome",
    "paTaxForgivenessDependentChildren", "paChildDependentCareCredit", "paFederalEITCAmount",
    "paPriorYearCredit", "paEstimatedPayments", "paExtensionPayment", "paNonresidentWithholding",
    "paUseTax", "paPenaltiesInterest", "paLocalEarnedIncomeTax", "paLocalEarnedIncomeWithholding",
    "paLocalEarnedIncomePayments"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  [
    "paHasResidentCredit", "paClaimTaxForgiveness", "paDependentClaimantEligibleTaxForgiveness",
    "paHasChildDependentCareCredit", "paHasRestrictedScheduleOCCredits", "paClaimedFederalEITC",
    "paHasLocalEarnedIncomeTax", "paHasAmendedOrOtherSpecialItems"
  ].forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshPennsylvaniaStateVisibility();
}

function refreshPennsylvaniaStateVisibility() {
  const container = document.getElementById("pennsylvaniaStateQuestions");
  if (!container) return;

  const isPA = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "PA" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const hasResidentCredit = getVal("paHasResidentCredit") === "yes";
  const claimTaxForgiveness = getVal("paClaimTaxForgiveness") === "yes";
  const claimantIsDependent = document.querySelector('input[name="canBeClaimedAsDependent"]:checked')?.value === "yes";
  const hasChildCareCredit = getVal("paHasChildDependentCareCredit") === "yes";
  const claimedFederalEITC = getVal("paClaimedFederalEITC") === "yes";
  const hasLocalEIT = getVal("paHasLocalEarnedIncomeTax") === "yes";

  container.hidden = !isPA;
  const residentCreditGroup = document.getElementById("pennsylvaniaResidentCreditGroup");
  const taxForgivenessGroup = document.getElementById("pennsylvaniaTaxForgivenessGroup");
  const dependentForgivenessGroup = document.getElementById("pennsylvaniaDependentTaxForgivenessGroup");
  const childCareGroup = document.getElementById("pennsylvaniaChildCareCreditGroup");
  const federalEITCGroup = document.getElementById("pennsylvaniaFederalEITCGroup");
  const localEITGroup = document.getElementById("pennsylvaniaLocalEITGroup");
  if (residentCreditGroup) residentCreditGroup.hidden = !(isPA && hasResidentCredit);
  if (taxForgivenessGroup) taxForgivenessGroup.hidden = !(isPA && claimTaxForgiveness);
  if (dependentForgivenessGroup) dependentForgivenessGroup.hidden = !(isPA && claimTaxForgiveness && claimantIsDependent);
  if (childCareGroup) childCareGroup.hidden = !(isPA && hasChildCareCredit);
  if (federalEITCGroup) federalEITCGroup.hidden = !(isPA && claimedFederalEITC);
  if (localEITGroup) localEITGroup.hidden = !(isPA && hasLocalEIT);

  [
    "paFullYearResident", "paNetCompensation", "paInterestIncome", "paDividendIncome",
    "paBusinessFarmIncomeLoss", "paPropertyGainLoss", "paRentRoyaltyIncomeLoss", "paEstateTrustIncome",
    "paGamblingLotteryWinnings", "paOtherDeductions", "paHasResidentCredit", "paClaimTaxForgiveness",
    "paHasChildDependentCareCredit", "paHasRestrictedScheduleOCCredits", "paClaimedFederalEITC",
    "paPriorYearCredit", "paEstimatedPayments", "paExtensionPayment", "paNonresidentWithholding",
    "paUseTax", "paPenaltiesInterest", "paHasLocalEarnedIncomeTax", "paHasAmendedOrOtherSpecialItems"
  ].forEach((id) => { const el = document.getElementById(id); if (el) el.required = isPA; });

  const conditionalRequired = {
    paResidentCredit: isPA && hasResidentCredit,
    paTaxForgivenessEligibilityIncome: isPA && claimTaxForgiveness,
    paTaxForgivenessDependentChildren: isPA && claimTaxForgiveness,
    paDependentClaimantEligibleTaxForgiveness: isPA && claimTaxForgiveness && claimantIsDependent,
    paChildDependentCareCredit: isPA && hasChildCareCredit,
    paFederalEITCAmount: isPA && claimedFederalEITC,
    paLocalEarnedIncomeTax: isPA && hasLocalEIT,
    paLocalEarnedIncomeWithholding: isPA && hasLocalEIT,
    paLocalEarnedIncomePayments: isPA && hasLocalEIT,
  };
  Object.entries(conditionalRequired).forEach(([id, required]) => {
    const el = document.getElementById(id);
    if (el) el.required = required;
  });

  const clearAll = [
    "paFullYearResident", "paNetCompensation", "paInterestIncome", "paDividendIncome", "paBusinessFarmIncomeLoss",
    "paPropertyGainLoss", "paRentRoyaltyIncomeLoss", "paEstateTrustIncome", "paGamblingLotteryWinnings", "paOtherDeductions",
    "paHasResidentCredit", "paResidentCredit", "paClaimTaxForgiveness", "paTaxForgivenessEligibilityIncome",
    "paTaxForgivenessDependentChildren", "paDependentClaimantEligibleTaxForgiveness", "paHasChildDependentCareCredit",
    "paChildDependentCareCredit", "paHasRestrictedScheduleOCCredits", "paClaimedFederalEITC", "paFederalEITCAmount",
    "paPriorYearCredit", "paEstimatedPayments", "paExtensionPayment", "paNonresidentWithholding", "paUseTax",
    "paPenaltiesInterest", "paHasLocalEarnedIncomeTax", "paLocalEarnedIncomeTax", "paLocalEarnedIncomeWithholding",
    "paLocalEarnedIncomePayments", "paHasAmendedOrOtherSpecialItems"
  ];
  if (!isPA) {
    clearAll.forEach((id) => setEstimatorFieldValue(id, ""));
    return;
  }
  if (!hasResidentCredit) setEstimatorFieldValue("paResidentCredit", "");
  if (!claimTaxForgiveness) {
    setEstimatorFieldValue("paTaxForgivenessEligibilityIncome", "");
    setEstimatorFieldValue("paTaxForgivenessDependentChildren", "");
    setEstimatorFieldValue("paDependentClaimantEligibleTaxForgiveness", "");
  } else if (!claimantIsDependent) {
    setEstimatorFieldValue("paDependentClaimantEligibleTaxForgiveness", "");
  }
  if (!hasChildCareCredit) setEstimatorFieldValue("paChildDependentCareCredit", "");
  if (!claimedFederalEITC) setEstimatorFieldValue("paFederalEITCAmount", "");
  if (!hasLocalEIT) {
    setEstimatorFieldValue("paLocalEarnedIncomeTax", "");
    setEstimatorFieldValue("paLocalEarnedIncomeWithholding", "");
    setEstimatorFieldValue("paLocalEarnedIncomePayments", "");
  }
}

function restoreIowaStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "iaFederalTaxableIncomeLine2", "iaNetIowaModifications", "iaFederalDeductionForSpecialCalc", "iaFederalPersonalExemptionForSpecialCalc",
    "iaQualifiedBusinessIncomeDeduction", "iaNolCarryover", "iaLumpSumDistributionTaxableIncome",
    "iaMfsSpouseIowaTaxableIncome", "iaMfsSpouseAdjustedIncome", "iaMfsSpouseNolCarryover", "iaLumpSumTax",
    "iaTuitionTextbookCredit", "iaVolunteerCredit", "iaOtherNonrefundableCredits", "iaSchoolDistrictEmsSurtaxRate",
    "iaContributions", "iaFuelTaxCredit", "iaChildDependentOrEarlyChildhoodCredit", "iaEarnedIncomeTaxCredit",
    "iaOtherRefundableCredits", "iaCompositePtetCredit", "iaEstimatedAndOtherPayments", "iaUnderpaymentPenalty",
    "iaOtherPenaltyInterest"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  ["iaFullYearResident", "iaTaxpayerBlind", "iaSpouseBlind", "iaHasOutOfStateTaxCredit", "iaHasAmendedOrOtherSpecialItems"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshIowaStateVisibility();
  refreshColoradoStateVisibility();
  refreshUtahStateVisibility();
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
  refreshKansasStateVisibility();
  refreshNebraskaStateVisibility();
}

function refreshIowaStateVisibility() {
  const container = document.getElementById("iowaStateQuestions");
  if (!container) return;
  const isIA = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "IA" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const status = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  container.hidden = !isIA;
  const spouseBlindGroup = document.getElementById("iowaSpouseBlindGroup");
  const mfsGroup = document.getElementById("iowaMfsDetailsGroup");
  if (spouseBlindGroup) spouseBlindGroup.hidden = !(isIA && status === "mfj");
  if (mfsGroup) mfsGroup.hidden = !(isIA && status === "mfs");

  const requiredAlways = [
    "iaFullYearResident", "iaFederalTaxableIncomeLine2", "iaNetIowaModifications", "iaFederalDeductionForSpecialCalc", "iaFederalPersonalExemptionForSpecialCalc",
    "iaQualifiedBusinessIncomeDeduction", "iaNolCarryover", "iaLumpSumDistributionTaxableIncome", "iaTaxpayerBlind", "iaLumpSumTax",
    "iaTuitionTextbookCredit", "iaVolunteerCredit", "iaOtherNonrefundableCredits", "iaHasOutOfStateTaxCredit", "iaSchoolDistrictEmsSurtaxRate",
    "iaContributions", "iaFuelTaxCredit", "iaChildDependentOrEarlyChildhoodCredit", "iaEarnedIncomeTaxCredit", "iaOtherRefundableCredits",
    "iaCompositePtetCredit", "iaEstimatedAndOtherPayments", "iaUnderpaymentPenalty", "iaOtherPenaltyInterest", "iaHasAmendedOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => { const el=document.getElementById(id); if(el) el.required=isIA; });
  const setReq=(id,v)=>{const el=document.getElementById(id); if(el) el.required=!!v;};
  setReq("iaSpouseBlind", isIA && status === "mfj");
  ["iaMfsSpouseIowaTaxableIncome","iaMfsSpouseAdjustedIncome","iaMfsSpouseNolCarryover"].forEach((id)=>setReq(id,isIA && status === "mfs"));

  const all=[...requiredAlways,"iaSpouseBlind","iaMfsSpouseIowaTaxableIncome","iaMfsSpouseAdjustedIncome","iaMfsSpouseNolCarryover"];
  if(!isIA){all.forEach((id)=>setEstimatorFieldValue(id,"")); return;}
  if(status!=="mfj") setEstimatorFieldValue("iaSpouseBlind","");
  if(status!=="mfs") ["iaMfsSpouseIowaTaxableIncome","iaMfsSpouseAdjustedIncome","iaMfsSpouseNolCarryover"].forEach((id)=>setEstimatorFieldValue(id,""));
}

function restoreColoradoStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "coAdditions", "coSubtractions", "coAlternativeMinimumTax", "coCreditRecapture", "coCreditRepayment", "coOtherNonrefundableCredits",
    "coChildTaxCredit", "coChildDependentCareCredit", "coFederalEITCAmount", "coOtherRefundableCredits", "coDirectRefundableCredits",
    "coOtherFormWithholding", "coPriorYearCarryforward", "coEstimatedPayments", "coExtensionPayment", "coOtherPrepayments",
    "coTaborRefund", "coDelinquentPenalty", "coDelinquentInterest", "coUnderpaymentPenalty", "coApplyToNextYear", "coVoluntaryContributions"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  ["coFullYearResident", "coHasOtherStateCredit", "coNeedsSpecialEITCFormTN", "coHasAmendedOrOtherSpecialItems"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshColoradoStateVisibility();
}

function refreshColoradoStateVisibility() {
  const container = document.getElementById("coloradoStateQuestions");
  if (!container) return;
  const isCO = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "CO" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isCO;
  const requiredAlways = [
    "coFullYearResident", "coAdditions", "coSubtractions", "coAlternativeMinimumTax", "coCreditRecapture", "coCreditRepayment",
    "coOtherNonrefundableCredits", "coChildTaxCredit", "coChildDependentCareCredit", "coFederalEITCAmount",
    "coOtherRefundableCredits", "coDirectRefundableCredits", "coNeedsSpecialEITCFormTN", "coHasOtherStateCredit", "coOtherFormWithholding",
    "coPriorYearCarryforward", "coEstimatedPayments", "coExtensionPayment", "coOtherPrepayments", "coTaborRefund",
    "coDelinquentPenalty", "coDelinquentInterest", "coUnderpaymentPenalty", "coApplyToNextYear", "coVoluntaryContributions", "coHasAmendedOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isCO;
  });
  if (!isCO) requiredAlways.forEach((id) => setEstimatorFieldValue(id, ""));
}

function restoreUtahStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "utAdditions", "utStateTaxRefund", "utSubtractions", "utDependentExemptionCount", "utFederalDeductionLine12",
    "utStateLocalIncomeTaxDeduction", "utFederalBaseStandardDeduction", "utMunicipalBondInterestAddition", "utFederalTaxExemptInterest",
    "utChildCreditQualifyingChildren", "utFederalEITCAmount", "utUtahW2Wages", "utOtherApportionableNonrefundableCredits",
    "utNonapportionableNonrefundableCredits", "utVoluntaryContributions", "utLowIncomeHousingRecapture", "utUseTax",
    "utOtherWithholding", "utPrepayments", "utNonapportionableRefundableCredits", "utApportionableRefundableCredits",
    "utPenaltyInterest", "utRefundSubtractions"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  ["utFullYearResident", "utHasOtherStateCredit", "utHasSpecialMarriedCoupleCalculation", "utHasAmendedOrOtherSpecialItems"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshUtahStateVisibility();
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshUtahStateVisibility() {
  const container = document.getElementById("utahStateQuestions");
  if (!container) return;
  const isUT = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "UT" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isUT;
  const requiredAlways = [
    "utFullYearResident", "utAdditions", "utStateTaxRefund", "utSubtractions", "utDependentExemptionCount",
    "utFederalDeductionLine12", "utStateLocalIncomeTaxDeduction", "utFederalBaseStandardDeduction", "utMunicipalBondInterestAddition",
    "utFederalTaxExemptInterest", "utChildCreditQualifyingChildren", "utFederalEITCAmount", "utUtahW2Wages",
    "utOtherApportionableNonrefundableCredits", "utNonapportionableNonrefundableCredits", "utHasOtherStateCredit",
    "utHasSpecialMarriedCoupleCalculation", "utVoluntaryContributions", "utLowIncomeHousingRecapture", "utUseTax",
    "utOtherWithholding", "utPrepayments", "utNonapportionableRefundableCredits", "utApportionableRefundableCredits",
    "utPenaltyInterest", "utRefundSubtractions", "utHasAmendedOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isUT;
  });
  if (!isUT) requiredAlways.forEach((id) => setEstimatorFieldValue(id, ""));
}


function restoreIdahoStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "idAdditions", "idSubtractions", "idItemizedDeduction", "idStandardDeduction", "idFederalLine13Deductions",
    "idChildCreditQualifyingChildren", "idForm39rCredits", "idBusinessIncomeTaxCredits", "idFuelsUseTax",
    "idSalesUseTax", "idIncomeTaxCreditRecapture", "idQieRecapture", "idPermanentBuildingFundTax", "idDonations",
    "idParentalChoiceTaxCredit", "idFoodTaxCredit", "idHomeFamilyCredit", "idFuelsTaxRefund", "idOtherWithholding",
    "idEstimatedPayments", "idEntityPaidWithheldAbe", "idTaxReimbursementIncentiveCredit", "idPenaltyInterest",
    "idPriorYearNonrefundableCredit", "idRefundApplyToNextYear"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  ["idFullYearResident", "idMfsSpouseItemizes", "idHasOtherStateCredit", "idHasNolOrCarryback", "idHasClaimOfRightCase", "idHasAmendedOrOtherSpecialItems"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshIdahoStateVisibility() {
  const container = document.getElementById("idahoStateQuestions");
  if (!container) return;
  const isID = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "ID" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isID;
  const requiredAlways = [
    "idFullYearResident", "idAdditions", "idSubtractions", "idItemizedDeduction", "idStandardDeduction", "idFederalLine13Deductions",
    "idChildCreditQualifyingChildren", "idHasOtherStateCredit", "idForm39rCredits", "idBusinessIncomeTaxCredits", "idFuelsUseTax",
    "idSalesUseTax", "idIncomeTaxCreditRecapture", "idQieRecapture", "idPermanentBuildingFundTax", "idDonations",
    "idParentalChoiceTaxCredit", "idFoodTaxCredit", "idHomeFamilyCredit", "idFuelsTaxRefund", "idOtherWithholding",
    "idEstimatedPayments", "idEntityPaidWithheldAbe", "idTaxReimbursementIncentiveCredit", "idPenaltyInterest",
    "idPriorYearNonrefundableCredit", "idRefundApplyToNextYear", "idHasNolOrCarryback", "idHasClaimOfRightCase",
    "idHasAmendedOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isID;
  });
  const mfsGroup = document.getElementById("idahoMfsSpouseItemizesGroup");
  const isMfs = isID && String(document.getElementById("filingStatus")?.value || "") === "mfs";
  if (mfsGroup) mfsGroup.hidden = !isMfs;
  const mfsEl = document.getElementById("idMfsSpouseItemizes");
  if (mfsEl) mfsEl.required = isMfs;
  if (!isMfs) setEstimatorFieldValue("idMfsSpouseItemizes", "");
  if (!isID) requiredAlways.forEach((id) => setEstimatorFieldValue(id, ""));
}

function restoreMontanaStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "mtFederalDeductionLine2", "mtAdditions", "mtSubtractions", "mtNetLongTermCapitalGains",
    "mtOtherNonrefundableCredits", "mtOtherWithholdingAndPteCredits", "mtEstimatedPayments",
    "mtPriorYearOverpayment", "mtExtensionPayment", "mtFederalEITCAmount", "mtElderlyHomeownerRenterCredit",
    "mtOtherRefundableCredits", "mtScheduleIvOtherTaxes", "mtRefundApplyToNextYear", "mtRefund529Deposit"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  ["mtFullYearResident", "mtHasOtherStateCredit", "mtHasEitcReductionCase", "mtHasNolOrLossCarryforward", "mtHasAmendedOrOtherSpecialItems"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshMontanaStateVisibility() {
  const container = document.getElementById("montanaStateQuestions");
  if (!container) return;
  const isMT = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "MT" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isMT;
  const requiredAlways = [
    "mtFullYearResident", "mtFederalDeductionLine2", "mtAdditions", "mtSubtractions", "mtNetLongTermCapitalGains",
    "mtOtherNonrefundableCredits", "mtHasOtherStateCredit", "mtOtherWithholdingAndPteCredits", "mtEstimatedPayments",
    "mtPriorYearOverpayment", "mtExtensionPayment", "mtFederalEITCAmount", "mtElderlyHomeownerRenterCredit",
    "mtOtherRefundableCredits", "mtScheduleIvOtherTaxes", "mtRefundApplyToNextYear", "mtRefund529Deposit",
    "mtHasNolOrLossCarryforward", "mtHasAmendedOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isMT;
  });
  const eitcGroup = document.getElementById("montanaEitcReductionGroup");
  const federalEitc = Number(currencyNumberValue(document.getElementById("mtFederalEITCAmount")?.value || "0") || 0);
  const needsEitcScreen = isMT && federalEitc > 0;
  if (eitcGroup) eitcGroup.hidden = !needsEitcScreen;
  const eitcEl = document.getElementById("mtHasEitcReductionCase");
  if (eitcEl) eitcEl.required = needsEitcScreen;
  if (!needsEitcScreen) setEstimatorFieldValue("mtHasEitcReductionCase", "");
  if (!isMT) requiredAlways.forEach((id) => setEstimatorFieldValue(id, ""));
}


function restoreNorthDakotaStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "ndFederalTaxableIncome", "ndContributionAdjustment", "ndOtherAdditions", "ndUsObligationInterest",
    "ndNetLongTermCapitalGainExclusion", "ndNativeAmericanExemptIncome", "ndRailroadBenefits",
    "ndPeaceOfficerRetirementExclusion", "ndMilitaryPayExclusion", "ndCollegeSaveContribution",
    "ndQualifiedDividends", "ndMilitaryRetirementExclusion", "ndSocialSecurityExclusion", "ndOtherSubtractions",
    "ndTaxpayerQualifiedIncome", "ndSpouseQualifiedIncome", "ndOtherCredits", "ndOtherWithholding",
    "ndEstimatedTaxPayment", "ndRefundApplyNextYear", "ndRefundContributions", "ndPenaltyInterest",
    "ndBalanceDueContributions", "ndUnderpaymentInterest"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  ["ndFullYearResident", "ndHasOtherStateCredit", "ndHasFarmIncomeAveraging", "ndHasSoldResearchCredit", "ndHasAmendedNolOrOtherSpecialItems"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshNorthDakotaStateVisibility() {
  const container = document.getElementById("northDakotaStateQuestions");
  if (!container) return;
  const isND = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "ND" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const status = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  container.hidden = !isND;
  const requiredAlways = [
    "ndFullYearResident", "ndFederalTaxableIncome", "ndContributionAdjustment", "ndOtherAdditions", "ndUsObligationInterest",
    "ndNetLongTermCapitalGainExclusion", "ndNativeAmericanExemptIncome", "ndRailroadBenefits", "ndPeaceOfficerRetirementExclusion",
    "ndMilitaryPayExclusion", "ndCollegeSaveContribution", "ndQualifiedDividends", "ndMilitaryRetirementExclusion",
    "ndSocialSecurityExclusion", "ndOtherSubtractions", "ndOtherCredits", "ndOtherWithholding", "ndEstimatedTaxPayment",
    "ndRefundApplyNextYear", "ndRefundContributions", "ndPenaltyInterest", "ndBalanceDueContributions", "ndUnderpaymentInterest",
    "ndHasOtherStateCredit", "ndHasFarmIncomeAveraging", "ndHasSoldResearchCredit", "ndHasAmendedNolOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => { const el = document.getElementById(id); if (el) el.required = isND; });
  const marriageGroup = document.getElementById("northDakotaMarriagePenaltyGroup");
  const isMfj = isND && status === "mfj";
  if (marriageGroup) marriageGroup.hidden = !isMfj;
  ["ndTaxpayerQualifiedIncome", "ndSpouseQualifiedIncome"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isMfj;
    if (!isMfj) setEstimatorFieldValue(id, "");
  });
  if (!isND) requiredAlways.forEach((id) => setEstimatorFieldValue(id, ""));
}

function restoreNewMexicoStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "nmFederalDeductionLine12", "nmStateLocalIncomeTaxAddback", "nmPitAdjAdditions", "nmPitAdjDeductions",
    "nmPitCrNonrefundableCredits", "nmPitRcTotalCredits", "nmFederalEITCAmount", "nmPitCrRefundableCredits",
    "nmOtherLine27Withholding", "nmOilGasWithholding", "nmPteWithholdingEntityTax", "nmEstimatedPayments",
    "nmOtherPayments", "nmUnderpaymentPenalty", "nmLatePenalty", "nmInterest", "nmRefundContributions", "nmApplyToNextYear"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  [
    "nmFullYearResident", "nmSpouseCanBeClaimedAsDependent", "nmMfsCommunityPropertyAllocated", "nmWftcExpansionCase",
    "nmHasPitBAllocation", "nmHasScheduleCCAlternativeTax", "nmHasLumpSumDistributionTax", "nmHasOtherStateCredit",
    "nmHasAmendedOrOtherSpecialItems"
  ].forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshNewMexicoStateVisibility() {
  const container = document.getElementById("newMexicoStateQuestions");
  if (!container) return;
  const isNM = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "NM" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const status = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  container.hidden = !isNM;
  const requiredAlways = [
    "nmFullYearResident", "nmFederalDeductionLine12", "nmStateLocalIncomeTaxAddback", "nmPitAdjAdditions", "nmPitAdjDeductions",
    "nmPitCrNonrefundableCredits", "nmPitRcTotalCredits", "nmFederalEITCAmount", "nmWftcExpansionCase", "nmPitCrRefundableCredits",
    "nmOtherLine27Withholding", "nmOilGasWithholding", "nmPteWithholdingEntityTax", "nmEstimatedPayments", "nmOtherPayments",
    "nmUnderpaymentPenalty", "nmLatePenalty", "nmInterest", "nmRefundContributions", "nmApplyToNextYear", "nmHasPitBAllocation",
    "nmHasScheduleCCAlternativeTax", "nmHasLumpSumDistributionTax", "nmHasOtherStateCredit", "nmHasAmendedOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => { const el = document.getElementById(id); if (el) el.required = isNM; });

  const spouseGroup = document.getElementById("newMexicoSpouseDependentGroup");
  const isMfj = isNM && status === "mfj";
  if (spouseGroup) spouseGroup.hidden = !isMfj;
  const spouseEl = document.getElementById("nmSpouseCanBeClaimedAsDependent");
  if (spouseEl) spouseEl.required = isMfj;
  if (!isMfj) setEstimatorFieldValue("nmSpouseCanBeClaimedAsDependent", "");

  const mfsGroup = document.getElementById("newMexicoMfsCommunityGroup");
  const isMfs = isNM && status === "mfs";
  if (mfsGroup) mfsGroup.hidden = !isMfs;
  const mfsEl = document.getElementById("nmMfsCommunityPropertyAllocated");
  if (mfsEl) mfsEl.required = isMfs;
  if (!isMfs) setEstimatorFieldValue("nmMfsCommunityPropertyAllocated", "");

  if (!isNM) requiredAlways.forEach((id) => setEstimatorFieldValue(id, ""));
}

function restoreCaliforniaStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "caScheduleCASubtractions", "caScheduleCAAdditions", "caDeductionAmount", "caPersonalExemptionCount", "caBlindExemptionCount",
    "caSeniorExemptionCount", "caDependentExemptionCount", "caNonrefundableCreditsTotal", "caAlternativeMinimumTax", "caOtherTaxesRecapture",
    "caOtherLine71Withholding", "caEstimatedAndOtherPayments", "caForms592593Withholding", "caMotionPictureRefundableCredit", "caCalEitc",
    "caYoungChildTaxCredit", "caFosterYouthTaxCredit", "caUseTax", "caIsrPenalty", "caApplyToNextYear", "caContributions",
    "caInterestLatePenalties", "caUnderpaymentPenalty"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  setEstimatorFieldValue("caDeductionMethod", taxData.caDeductionMethod || "");
  [
    "caFullYearResident", "caFilingStatusMatchesFederal", "caIsRegisteredDomesticPartner", "caMfsSpouseSameDeductionMethod",
    "caMfsCommunityPropertyAllocated", "caHasCapitalConstructionFund", "caHasFtb3800Or3803", "caHasScheduleG1Or5870A",
    "caHasOtherStateTaxCredit", "caHasClaimOfRightCredit", "caHasAmendedOrOtherSpecialItems"
  ].forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshCaliforniaStateVisibility() {
  const container = document.getElementById("californiaStateQuestions");
  if (!container) return;
  const isCA = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "CA" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const status = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  container.hidden = !isCA;
  const requiredAlways = [
    "caFullYearResident", "caFilingStatusMatchesFederal", "caIsRegisteredDomesticPartner", "caScheduleCASubtractions", "caScheduleCAAdditions",
    "caDeductionMethod", "caDeductionAmount", "caPersonalExemptionCount", "caBlindExemptionCount", "caSeniorExemptionCount", "caDependentExemptionCount",
    "caNonrefundableCreditsTotal", "caAlternativeMinimumTax", "caOtherTaxesRecapture", "caOtherLine71Withholding", "caEstimatedAndOtherPayments",
    "caForms592593Withholding", "caMotionPictureRefundableCredit", "caCalEitc", "caYoungChildTaxCredit", "caFosterYouthTaxCredit", "caUseTax",
    "caIsrPenalty", "caApplyToNextYear", "caContributions", "caInterestLatePenalties", "caUnderpaymentPenalty", "caHasCapitalConstructionFund",
    "caHasFtb3800Or3803", "caHasScheduleG1Or5870A", "caHasOtherStateTaxCredit", "caHasClaimOfRightCredit", "caHasAmendedOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => { const el = document.getElementById(id); if (el) el.required = isCA; });
  const mfsGroup = document.getElementById("californiaMfsGroup");
  const isMfs = isCA && status === "mfs";
  if (mfsGroup) mfsGroup.hidden = !isMfs;
  ["caMfsSpouseSameDeductionMethod", "caMfsCommunityPropertyAllocated"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isMfs;
    if (!isMfs) setEstimatorFieldValue(id, "");
  });
  if (!isCA) requiredAlways.forEach((id) => setEstimatorFieldValue(id, ""));
}


function restoreOregonStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "orAdditions", "orFederalTaxLiabilitySubtraction", "orSocialSecurityTier1Subtraction", "orOregonRefundSubtraction", "orOtherSubtractions",
    "orDeductionAmount", "orInstallmentSaleInterest", "orTaxRecaptures", "orExemptionCredit", "orPoliticalContributionCredit",
    "orOtherStandardCredits", "orCarryforwardCredits", "orKicker", "orOtherWithholding", "orPriorYearRefundApplied", "orEstimatedPayments",
    "orPteEstimatedPayments", "orFederalEitcAmount", "orKidsCredit", "orOtherRefundableCredits", "orPenaltyInterest", "orRefundApplications"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  setEstimatorFieldValue("orDeductionMethod", taxData.orDeductionMethod || "");
  [
    "orFullYearResident", "orFilingStatusMatchesFederal", "orIsRegisteredDomesticPartner", "orMfsSpouseItemizes",
    "orYoungestDependentUnder3", "orHasAlternateTaxMethod", "orHasOtherStateCredit", "orHasItinEicSpecialCase",
    "orHasSeparateTransitTaxFiling", "orHasAmendedNolOrOtherSpecialItems"
  ].forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshOregonStateVisibility() {
  const container = document.getElementById("oregonStateQuestions");
  if (!container) return;
  const isOR = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "OR" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const status = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  container.hidden = !isOR;
  const requiredAlways = [
    "orFullYearResident", "orFilingStatusMatchesFederal", "orIsRegisteredDomesticPartner", "orAdditions", "orFederalTaxLiabilitySubtraction",
    "orSocialSecurityTier1Subtraction", "orOregonRefundSubtraction", "orOtherSubtractions", "orDeductionMethod", "orDeductionAmount",
    "orInstallmentSaleInterest", "orTaxRecaptures", "orExemptionCredit", "orPoliticalContributionCredit", "orOtherStandardCredits",
    "orCarryforwardCredits", "orKicker", "orOtherWithholding", "orPriorYearRefundApplied", "orEstimatedPayments", "orPteEstimatedPayments",
    "orFederalEitcAmount", "orKidsCredit", "orOtherRefundableCredits", "orPenaltyInterest", "orRefundApplications",
    "orHasAlternateTaxMethod", "orHasOtherStateCredit", "orHasItinEicSpecialCase", "orHasSeparateTransitTaxFiling", "orHasAmendedNolOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => { const el = document.getElementById(id); if (el) el.required = isOR; });

  const mfsGroup = document.getElementById("oregonMfsGroup");
  const needsMfs = isOR && status === "mfs" && String(document.getElementById("orDeductionMethod")?.value || "") === "standard";
  if (mfsGroup) mfsGroup.hidden = !needsMfs;
  const mfsEl = document.getElementById("orMfsSpouseItemizes");
  if (mfsEl) mfsEl.required = needsMfs;
  if (!needsMfs) setEstimatorFieldValue("orMfsSpouseItemizes", "");

  const eicGroup = document.getElementById("oregonEicChildAgeGroup");
  const federalEitcRaw = String(document.getElementById("orFederalEitcAmount")?.value || "").replace(/[$,\s]/g, "");
  const needsEicAge = isOR && Number(federalEitcRaw || 0) > 0;
  if (eicGroup) eicGroup.hidden = !needsEicAge;
  const eicAgeEl = document.getElementById("orYoungestDependentUnder3");
  if (eicAgeEl) eicAgeEl.required = needsEicAge;
  if (!needsEicAge) setEstimatorFieldValue("orYoungestDependentUnder3", "");

  if (!isOR) requiredAlways.forEach((id) => setEstimatorFieldValue(id, ""));
}

function restoreWashingtonStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "waCapitalGainsBeforeDeductions", "waConstitutionalDeduction", "waFamilyOwnedBusinessDeduction", "waQualifyingCharitableDonations",
    "waOtherJurisdictionCredit", "waBoCapitalGainsCredit", "waCapitalGainsPayments", "waWorkingFamiliesTaxCredit", "waPenaltyInterest"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id] ?? ""));
  ["waFullYearResident", "waIsRegisteredDomesticPartner", "waCapitalGainsBaseCompleted", "waHasOtherMaterialSpecialCase"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshWashingtonStateVisibility() {
  const container = document.getElementById("washingtonStateQuestions");
  if (!container) return;
  const isWA = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "WA" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isWA;
  const required = [
    "waFullYearResident", "waIsRegisteredDomesticPartner", "waCapitalGainsBaseCompleted", "waCapitalGainsBeforeDeductions",
    "waConstitutionalDeduction", "waFamilyOwnedBusinessDeduction", "waQualifyingCharitableDonations", "waOtherJurisdictionCredit",
    "waBoCapitalGainsCredit", "waCapitalGainsPayments", "waWorkingFamiliesTaxCredit", "waPenaltyInterest", "waHasOtherMaterialSpecialCase"
  ];
  required.forEach((id) => { const el = document.getElementById(id); if (el) el.required = isWA; });
  if (!isWA) required.forEach((id) => setEstimatorFieldValue(id, ""));
}

function restoreHawaiiStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  ["hiAdditions","hiSubtractions","hiItemizedDeductionAmount","hiExemptionCount","hiOtherTaxes","hiNonrefundableCredits","hiRefundableEic","hiOtherRefundableCredits","hiEstimatedPayments","hiOtherPayments","hiPenaltyInterest"]
    .forEach((id) => setEstimatorFieldValue(id, taxData[id] ?? ""));
  setEstimatorFieldValue("hiDeductionMethod", taxData.hiDeductionMethod ?? "");
  ["hiFullYearResident","hiFilingStatusMatchesFederal","hiMfsSpouseItemizes","hiHasCertifiedDisabilityExemption","hiHasCapitalGainAlternativeTaxCase","hiHasPteTaxCreditOrAdjustment","hiHasOtherStateCredit","hiHasAmendedOrOtherSpecialItems"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshHawaiiStateVisibility() {
  const container = document.getElementById("hawaiiStateQuestions");
  if (!container) return;
  const isHI = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "HI" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isHI;
  const baseRequired = ["hiFullYearResident","hiFilingStatusMatchesFederal","hiAdditions","hiSubtractions","hiDeductionMethod","hiExemptionCount","hiHasCertifiedDisabilityExemption","hiHasCapitalGainAlternativeTaxCase","hiHasPteTaxCreditOrAdjustment","hiHasOtherStateCredit","hiOtherTaxes","hiNonrefundableCredits","hiRefundableEic","hiOtherRefundableCredits","hiEstimatedPayments","hiOtherPayments","hiPenaltyInterest","hiHasAmendedOrOtherSpecialItems"];
  baseRequired.forEach((id) => { const el = document.getElementById(id); if (el) el.required = isHI; });
  const method = String(document.getElementById("hiDeductionMethod")?.value || "");
  const itemizedDetail = document.getElementById("hiItemizedDetail");
  const itemized = isHI && method === "itemized";
  if (itemizedDetail) itemizedDetail.hidden = !itemized;
  const itemizedAmount = document.getElementById("hiItemizedDeductionAmount");
  if (itemizedAmount) itemizedAmount.required = itemized;
  if (isHI && method === "standard") setEstimatorFieldValue("hiItemizedDeductionAmount", "0");
  const filingStatus = String(document.getElementById("filingStatus")?.value || "");
  const isMfs = isHI && filingStatus === "mfs";
  const mfsDetail = document.getElementById("hiMfsDetail");
  if (mfsDetail) mfsDetail.hidden = !isMfs;
  const spouseItemizes = document.getElementById("hiMfsSpouseItemizes");
  if (spouseItemizes) spouseItemizes.required = isMfs;
  if (!isMfs) setEstimatorFieldValue("hiMfsSpouseItemizes", "");
  if (!isHI) {
    [...baseRequired,"hiItemizedDeductionAmount","hiMfsSpouseItemizes"].forEach((id) => setEstimatorFieldValue(id, ""));
  }
}


function restoreDelawareStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "deAdditions","deSubtractions","deItemizedDeductionAmount","deVolunteerFirefighterCount",
    "deFederalChildDependentCareCredit","deOtherNonrefundableCredits","deFederalEITCAmount",
    "deEstimatedPayments","deSCorporationPayments","deRealEstateCapitalGainsPayments",
    "deOtherRefundableCredits","dePenaltyInterest"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id] ?? ""));
  setEstimatorFieldValue("deDeductionMethod", taxData.deDeductionMethod ?? "");
  [
    "deFullYearResident","deFilingStatusMatchesFederal","deTaxpayerBlind","deSpouseBlind",
    "deHasLumpSumDistribution","deHasOtherStateCredit","deHasAmendedOrOtherSpecialItems"
  ].forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshDelawareStateVisibility() {
  const container = document.getElementById("delawareStateQuestions");
  if (!container) return;
  const isDE = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "DE" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isDE;

  const baseRequired = [
    "deFullYearResident","deFilingStatusMatchesFederal","deAdditions","deSubtractions","deDeductionMethod",
    "deVolunteerFirefighterCount","deHasLumpSumDistribution","deHasOtherStateCredit",
    "deFederalChildDependentCareCredit","deOtherNonrefundableCredits","deFederalEITCAmount",
    "deEstimatedPayments","deSCorporationPayments","deRealEstateCapitalGainsPayments",
    "deOtherRefundableCredits","dePenaltyInterest","deHasAmendedOrOtherSpecialItems"
  ];
  baseRequired.forEach((id) => { const el = document.getElementById(id); if (el) el.required = isDE; });

  const method = String(document.getElementById("deDeductionMethod")?.value || "");
  const itemized = isDE && method === "itemized";
  const itemizedDetail = document.getElementById("delawareItemizedDetail");
  if (itemizedDetail) itemizedDetail.hidden = !itemized;
  const itemizedAmount = document.getElementById("deItemizedDeductionAmount");
  if (itemizedAmount) itemizedAmount.required = itemized;
  if (isDE && method === "standard") setEstimatorFieldValue("deItemizedDeductionAmount", "0");

  const standard = isDE && method === "standard";
  const blindDetail = document.getElementById("delawareBlindDetail");
  if (blindDetail) blindDetail.hidden = !standard;
  const taxpayerBlind = document.getElementById("deTaxpayerBlind");
  if (taxpayerBlind) taxpayerBlind.required = standard;
  const filingStatus = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  const spouseBlindGroup = document.getElementById("delawareSpouseBlindGroup");
  const spouseBlindNeeded = standard && filingStatus === "mfj";
  if (spouseBlindGroup) spouseBlindGroup.hidden = !spouseBlindNeeded;
  const spouseBlind = document.getElementById("deSpouseBlind");
  if (spouseBlind) spouseBlind.required = spouseBlindNeeded;
  if (!standard) {
    setEstimatorFieldValue("deTaxpayerBlind", "");
    setEstimatorFieldValue("deSpouseBlind", "");
  } else if (!spouseBlindNeeded) {
    setEstimatorFieldValue("deSpouseBlind", "");
  }

  if (!isDE) {
    [...baseRequired,"deItemizedDeductionAmount","deTaxpayerBlind","deSpouseBlind"].forEach((id) => setEstimatorFieldValue(id, ""));
  }
}

function restoreConnecticutStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "ctAdditions","ctSubtractions","ctAlternativeMinimumTax","ctPropertyTaxCredit","ctAllowableCredits",
    "ctUseTax","ctEstimatedPayments","ctExtensionPayment","ctFederalEITCAmount",
    "ctOtherRefundableCredits","ctRefundAllocations","ctPenaltyInterest"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id] ?? ""));
  [
    "ctFullYearResident","ctFilingStatusMatchesFederal","ctHasOtherStateCredit","ctHasFederalAMT",
    "ctClaimedFederalEITC","ctEitcHasQualifyingChild","ctHasAmendedOrOtherSpecialItems"
  ].forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshConnecticutStateVisibility() {
  const container = document.getElementById("connecticutStateQuestions");
  if (!container) return;
  const isCT = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "CT" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isCT;

  const baseRequired = [
    "ctFullYearResident","ctFilingStatusMatchesFederal","ctAdditions","ctSubtractions","ctHasOtherStateCredit",
    "ctHasFederalAMT","ctPropertyTaxCredit","ctAllowableCredits","ctUseTax","ctEstimatedPayments",
    "ctExtensionPayment","ctClaimedFederalEITC","ctOtherRefundableCredits","ctRefundAllocations",
    "ctPenaltyInterest","ctHasAmendedOrOtherSpecialItems"
  ];
  baseRequired.forEach((id) => { const el = document.getElementById(id); if (el) el.required = isCT; });

  const hasAmt = isCT && document.getElementById("ctHasFederalAMT")?.value === "yes";
  const amtDetail = document.getElementById("connecticutAmtDetail");
  if (amtDetail) amtDetail.hidden = !hasAmt;
  const amt = document.getElementById("ctAlternativeMinimumTax");
  if (amt) amt.required = hasAmt;
  if (isCT && !hasAmt) setEstimatorFieldValue("ctAlternativeMinimumTax", "0");

  const hasEitc = isCT && document.getElementById("ctClaimedFederalEITC")?.value === "yes";
  const eitcDetail = document.getElementById("connecticutEitcDetail");
  if (eitcDetail) eitcDetail.hidden = !hasEitc;
  ["ctFederalEITCAmount","ctEitcHasQualifyingChild"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = hasEitc;
  });
  if (isCT && !hasEitc) {
    setEstimatorFieldValue("ctFederalEITCAmount", "0");
    setEstimatorFieldValue("ctEitcHasQualifyingChild", "");
  }

  if (!isCT) {
    [
      ...baseRequired,"ctAlternativeMinimumTax","ctFederalEITCAmount","ctEitcHasQualifyingChild"
    ].forEach((id) => setEstimatorFieldValue(id, ""));
  }
}

function restoreMaineStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "meAdditions","meSubtractions","meItemizedDeductionAmount","meDependentCreditAge6OrOlderCount",
    "meDependentCreditUnder6Count","meTaxCreditRecapture","meOtherNonrefundableCredits","meFederalEITCAmount",
    "meOtherRefundableCredits","mePropertyTaxFairnessCredit","meSalesTaxFairnessCredit","meOtherMaineWithholding",
    "meOtherPayments","meUseTax","meCasualRentalTax","meVoluntaryContributions","meUnderpaymentPenalty","meCreditToNextYear"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id] ?? ""));
  setEstimatorFieldValue("meFederalDeductionMethod", taxData.meFederalDeductionMethod ?? "");
  [
    "meFullYearResident","meFilingStatusMatchesFederal","meTaxpayerBlind","meSpouseBlind",
    "meSpouseCanBeClaimedAsDependent","meHasOtherStateCredit","meClaimedFederalEITC","meEitcHasQualifyingChild",
    "meHasMaineOnlyEitcEligibility","meHasAmendedOrOtherSpecialItems"
  ].forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshMaineStateVisibility() {
  const container = document.getElementById("maineStateQuestions");
  if (!container) return;
  const isME = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "ME" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isME;

  const baseRequired = [
    "meFullYearResident","meFilingStatusMatchesFederal","meAdditions","meSubtractions","meFederalDeductionMethod",
    "meTaxpayerBlind","meTaxCreditRecapture","meHasOtherStateCredit","meOtherNonrefundableCredits",
    "meClaimedFederalEITC","meOtherRefundableCredits","mePropertyTaxFairnessCredit","meSalesTaxFairnessCredit",
    "meOtherMaineWithholding","meOtherPayments","meUseTax","meCasualRentalTax","meVoluntaryContributions",
    "meUnderpaymentPenalty","meCreditToNextYear","meHasAmendedOrOtherSpecialItems"
  ];
  baseRequired.forEach((id) => { const el = document.getElementById(id); if (el) el.required = isME; });

  const status = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  const isMfj = isME && status === "mfj";
  const spouseDetail = document.getElementById("maineSpouseDetail");
  const spouseBlindDetail = document.getElementById("maineSpouseBlindDetail");
  if (spouseDetail) spouseDetail.hidden = !isMfj;
  if (spouseBlindDetail) spouseBlindDetail.hidden = !isMfj;
  ["meSpouseCanBeClaimedAsDependent","meSpouseBlind"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.required = isMfj;
  });
  if (isME && !isMfj) {
    setEstimatorFieldValue("meSpouseCanBeClaimedAsDependent", "");
    setEstimatorFieldValue("meSpouseBlind", "");
  }

  const itemized = isME && document.getElementById("meFederalDeductionMethod")?.value === "itemized";
  const itemizedDetail = document.getElementById("maineItemizedDetail");
  if (itemizedDetail) itemizedDetail.hidden = !itemized;
  const itemizedAmount = document.getElementById("meItemizedDeductionAmount");
  if (itemizedAmount) itemizedAmount.required = itemized;
  if (isME && !itemized) setEstimatorFieldValue("meItemizedDeductionAmount", "0");

  const dependentCount = Number(document.getElementById("numberOfDependents")?.value || 0);
  const hasDependents = isME && dependentCount > 0;
  const dependentDetail = document.getElementById("maineDependentCreditDetail");
  if (dependentDetail) dependentDetail.hidden = !hasDependents;
  ["meDependentCreditAge6OrOlderCount","meDependentCreditUnder6Count"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.required = hasDependents;
  });
  if (isME && !hasDependents) {
    setEstimatorFieldValue("meDependentCreditAge6OrOlderCount", "0");
    setEstimatorFieldValue("meDependentCreditUnder6Count", "0");
  }

  const hasEitc = isME && document.getElementById("meClaimedFederalEITC")?.value === "yes";
  const eitcDetail = document.getElementById("maineEitcDetail");
  if (eitcDetail) eitcDetail.hidden = !hasEitc;
  ["meFederalEITCAmount","meEitcHasQualifyingChild"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.required = hasEitc;
  });
  const specialScreen = document.getElementById("maineEitcSpecialScreen");
  const showSpecialScreen = isME && document.getElementById("meClaimedFederalEITC")?.value === "no";
  if (specialScreen) specialScreen.hidden = !showSpecialScreen;
  const specialField = document.getElementById("meHasMaineOnlyEitcEligibility");
  if (specialField) specialField.required = showSpecialScreen;
  if (isME && hasEitc) setEstimatorFieldValue("meHasMaineOnlyEitcEligibility", "no");
  if (isME && !hasEitc) {
    setEstimatorFieldValue("meFederalEITCAmount", "0");
    setEstimatorFieldValue("meEitcHasQualifyingChild", "");
  }

  if (!isME) {
    [
      ...baseRequired,"meSpouseCanBeClaimedAsDependent","meSpouseBlind","meItemizedDeductionAmount",
      "meDependentCreditAge6OrOlderCount","meDependentCreditUnder6Count","meFederalEITCAmount",
      "meEitcHasQualifyingChild","meHasMaineOnlyEitcEligibility"
    ].forEach((id) => setEstimatorFieldValue(id, ""));
  }
}

function restoreMarylandStateFields(taxData = {}) {
  ["mdFullYearResident","mdFilingStatusMatchesFederal","mdSpousesSameLocalJurisdiction","mdTaxpayerBlind","mdSpouseBlind","mdHasMarylandOnlyEitcEligibility","mdHasOtherStateCredit","mdHasMilitaryOrSpecialFiling","mdHasAmendedOrOtherSpecialItems"].forEach((id) => setEstimatorFieldValue(id, taxData[id] === true ? "yes" : taxData[id] === false ? "no" : ""));
  ["mdAdditions","mdSubtractions","mdItemizedDeductionBeforePhaseout","mdAge65DependentCount","mdCapitalGainSubjectToAdditionalTax","mdFederalEITCAmount","mdEitcQualifyingChildCount","mdEarnedIncome","mdChildTaxCreditUnder6Count","mdChildTaxCreditDisabledAge6To16Count","mdOtherNonrefundableCredits","mdOtherRefundableCredits","mdOtherMarylandWithholding","mdOtherPayments","mdVoluntaryContributions","mdUnderpaymentInterest","mdHomebuyerWithdrawalPenalty","mdCreditToNextYear"].forEach((id) => setEstimatorFieldValue(id, taxData[id] ?? ""));
  setEstimatorFieldValue("mdDeductionMethod", taxData.mdDeductionMethod ?? "");
  setEstimatorFieldValue("mdLocalJurisdiction", taxData.mdLocalJurisdiction ?? "");
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshMarylandStateVisibility() {
  const container = document.getElementById("marylandStateQuestions");
  if (!container) return;
  const isMD = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "MD" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  container.hidden = !isMD;
  const allIds=["mdFullYearResident","mdFilingStatusMatchesFederal","mdSpousesSameLocalJurisdiction","mdAdditions","mdSubtractions","mdDeductionMethod","mdItemizedDeductionBeforePhaseout","mdTaxpayerBlind","mdSpouseBlind","mdAge65DependentCount","mdLocalJurisdiction","mdCapitalGainSubjectToAdditionalTax","mdFederalEITCAmount","mdEitcQualifyingChildCount","mdHasMarylandOnlyEitcEligibility","mdEarnedIncome","mdChildTaxCreditUnder6Count","mdChildTaxCreditDisabledAge6To16Count","mdOtherNonrefundableCredits","mdOtherRefundableCredits","mdOtherMarylandWithholding","mdOtherPayments","mdVoluntaryContributions","mdUnderpaymentInterest","mdHomebuyerWithdrawalPenalty","mdCreditToNextYear","mdHasOtherStateCredit","mdHasMilitaryOrSpecialFiling","mdHasAmendedOrOtherSpecialItems"];
  allIds.forEach((id)=>{const el=document.getElementById(id); if(el) el.disabled=!isMD;});
  const joint = isMD && String(document.getElementById("filingStatus")?.value || "") === "mfj";
  const jointDetail=document.getElementById("marylandJointLocalDetail"); if(jointDetail) jointDetail.hidden=!joint;
  const jointField=document.getElementById("mdSpousesSameLocalJurisdiction"); if(jointField) jointField.disabled=!joint;
  if(isMD && !joint) setEstimatorFieldValue("mdSpousesSameLocalJurisdiction", "");
  const spouseBlindDetail=document.getElementById("marylandSpouseBlindDetail"); if(spouseBlindDetail) spouseBlindDetail.hidden=!joint;
  const spouseBlind=document.getElementById("mdSpouseBlind"); if(spouseBlind) spouseBlind.disabled=!joint;
  if(isMD && !joint) setEstimatorFieldValue("mdSpouseBlind", "");
  const itemized=isMD && document.getElementById("mdDeductionMethod")?.value === "itemized";
  const itemizedDetail=document.getElementById("marylandItemizedDetail"); if(itemizedDetail) itemizedDetail.hidden=!itemized;
  const itemizedField=document.getElementById("mdItemizedDeductionBeforePhaseout"); if(itemizedField) itemizedField.disabled=!itemized;
  if(isMD && !itemized) setEstimatorFieldValue("mdItemizedDeductionBeforePhaseout", "0");
}

function restoreMassachusettsStateFields(taxData = {}) {
  const boolVal = (v) => v === true ? "yes" : v === false ? "no" : "";
  ["maFullYearResident","maHasFilingStatusException","maElectsOptional585Rate","maTaxpayerBlind","maSpouseBlind","maClaimedFederalEITC","maHasOtherJurisdictionCredit","maHasAmendedOrOtherSpecialItems"].forEach((id)=>setEstimatorFieldValue(id,boolVal(taxData[id])));
  ["maTotalFivePercentIncome","maTotalDeductions","maMedicalDentalExemption","maAdoptionExemption","maScheduleBLine20","maScheduleB85Income","maScheduleB12Income","maScheduleBLine37SurtaxIncome","maScheduleDLine21SurtaxIncome","maLongTermCapitalGainsTax","maCreditRecapture","maInstallmentSaleAdditionalTax","maMassachusettsAGI","maOtherNonrefundableCredits","maVoluntaryContributions","maUseTax","maHealthCarePenalty","maFederalEITCAmount","maSeniorCircuitBreakerCredit","maChildFamilyQualifyingCount","maOtherRefundableCredits","maOtherMassachusettsWithholding","maPriorYearOverpaymentApplied","maEstimatedPayments","maExtensionPayments","maExcessPfmlWithholding","maRealEstateWithholding","maPenaltyInterest","maCreditToNextYear"].forEach((id)=>setEstimatorFieldValue(id,taxData[id] ?? ""));
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshMassachusettsStateVisibility() {
  const container=document.getElementById("massachusettsStateQuestions");
  if(!container) return;
  const isMA=String(document.getElementById("stateCode")?.value||"").toUpperCase()==="MA" && Number(document.getElementById("taxYear")?.value||0)===2025;
  const allIds=["maFullYearResident","maHasFilingStatusException","maElectsOptional585Rate","maTotalFivePercentIncome","maTotalDeductions","maMassachusettsAGI","maTaxpayerBlind","maSpouseBlind","maMedicalDentalExemption","maAdoptionExemption","maScheduleBLine20","maScheduleB85Income","maScheduleB12Income","maLongTermCapitalGainsTax","maCreditRecapture","maInstallmentSaleAdditionalTax","maScheduleBLine37SurtaxIncome","maScheduleDLine21SurtaxIncome","maClaimedFederalEITC","maFederalEITCAmount","maChildFamilyQualifyingCount","maOtherNonrefundableCredits","maSeniorCircuitBreakerCredit","maOtherRefundableCredits","maVoluntaryContributions","maUseTax","maHealthCarePenalty","maOtherMassachusettsWithholding","maPriorYearOverpaymentApplied","maEstimatedPayments","maExtensionPayments","maExcessPfmlWithholding","maRealEstateWithholding","maPenaltyInterest","maCreditToNextYear","maHasOtherJurisdictionCredit","maHasAmendedOrOtherSpecialItems"];
  container.hidden=!isMA;
  allIds.forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!isMA;el.required=isMA;}});
  const joint=isMA && String(document.getElementById("filingStatus")?.value||"").toLowerCase()==="mfj";
  const spouseDetail=document.getElementById("massachusettsSpouseBlindDetail"); if(spouseDetail) spouseDetail.hidden=!joint;
  const spouseBlind=document.getElementById("maSpouseBlind"); if(spouseBlind){spouseBlind.disabled=!joint;spouseBlind.required=joint;}
  if(isMA&&!joint) setEstimatorFieldValue("maSpouseBlind","");
  const eitc=isMA && document.getElementById("maClaimedFederalEITC")?.value==="yes";
  const eitcDetail=document.getElementById("massachusettsEitcDetail"); if(eitcDetail) eitcDetail.hidden=!eitc;
  const eitcAmount=document.getElementById("maFederalEITCAmount"); if(eitcAmount){eitcAmount.disabled=!eitc;eitcAmount.required=eitc;}
  if(isMA&&!eitc) setEstimatorFieldValue("maFederalEITCAmount","0");
  if(!isMA) allIds.forEach((id)=>setEstimatorFieldValue(id,""));
}

function restoreNewJerseyStateFields(taxData = {}) {
  const boolVal=(v)=>v===true?"yes":v===false?"no":"";
  ["njFullYearResident","njHasFilingStatusException","njClaimsDomesticPartnerExemption","njTaxpayerBlindOrDisabled","njSpouseBlindOrDisabled","njTaxpayerVeteran","njSpouseVeteran","njPropertyTaxBenefitEligible","njClaimedFederalEITC","njHasNJOnlyEITC","njHasOtherJurisdictionCredit","njHasAmendedOrOtherSpecialItems"].forEach((id)=>setEstimatorFieldValue(id,boolVal(taxData[id])));
  ["njGrossIncome","njCollegeDependentCount","njMedicalExpenseDeduction","njAlimonyDeduction","njQualifiedConservationDeduction","njHealthEnterpriseZoneDeduction","njAlternativeBusinessAdjustment","njOrganBoneMarrowDeduction","njNjbestDeduction","njNjclassDeduction","njTuitionDeduction","njPropertyTaxesLine40a","njOtherNonrefundableCredits","njUseTax","njUnderpaymentInterest","njSharedResponsibilityPayment","njOtherNJWithholding","njPaymentsCreditFromPriorYear","njFederalEITCAmount","njExcessUiWfSwfCredit","njExcessDiCredit","njExcessFliCredit","njWoundedWarriorCredit","njPteBaitCredit","njFederalChildDependentCareCredit","njChildTaxCreditUnder6Count","njCreditToNextYear","njCharitableContributions"].forEach((id)=>setEstimatorFieldValue(id,taxData[id]??""));
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshNewJerseyStateVisibility() {
  const container=document.getElementById("newJerseyStateQuestions");
  if(!container) return;
  const isNJ=String(document.getElementById("stateCode")?.value||"").toUpperCase()==="NJ"&&Number(document.getElementById("taxYear")?.value||0)===2025;
  const allIds=["njFullYearResident","njHasFilingStatusException","njClaimsDomesticPartnerExemption","njTaxpayerBlindOrDisabled","njSpouseBlindOrDisabled","njTaxpayerVeteran","njSpouseVeteran","njGrossIncome","njCollegeDependentCount","njMedicalExpenseDeduction","njAlimonyDeduction","njQualifiedConservationDeduction","njHealthEnterpriseZoneDeduction","njAlternativeBusinessAdjustment","njOrganBoneMarrowDeduction","njNjbestDeduction","njNjclassDeduction","njTuitionDeduction","njPropertyTaxBenefitEligible","njPropertyTaxesLine40a","njOtherNonrefundableCredits","njUseTax","njUnderpaymentInterest","njSharedResponsibilityPayment","njOtherNJWithholding","njPaymentsCreditFromPriorYear","njClaimedFederalEITC","njFederalEITCAmount","njHasNJOnlyEITC","njExcessUiWfSwfCredit","njExcessDiCredit","njExcessFliCredit","njWoundedWarriorCredit","njPteBaitCredit","njFederalChildDependentCareCredit","njChildTaxCreditUnder6Count","njCreditToNextYear","njCharitableContributions","njHasOtherJurisdictionCredit","njHasAmendedOrOtherSpecialItems"];
  container.hidden=!isNJ;
  allIds.forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!isNJ;el.required=isNJ;}});
  const joint=isNJ&&String(document.getElementById("filingStatus")?.value||"").toLowerCase()==="mfj";
  const spouseDetail=document.getElementById("newJerseySpouseDetail");if(spouseDetail)spouseDetail.hidden=!joint;
  ["njSpouseBlindOrDisabled","njSpouseVeteran"].forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!joint;el.required=joint;}if(isNJ&&!joint)setEstimatorFieldValue(id,"");});
  const property=isNJ&&document.getElementById("njPropertyTaxBenefitEligible")?.value==="yes";
  const propertyDetail=document.getElementById("newJerseyPropertyTaxDetail");if(propertyDetail)propertyDetail.hidden=!property;
  const propertyAmount=document.getElementById("njPropertyTaxesLine40a");if(propertyAmount){propertyAmount.disabled=!property;propertyAmount.required=property;}
  if(isNJ&&!property)setEstimatorFieldValue("njPropertyTaxesLine40a","0");
  const eitc=isNJ&&document.getElementById("njClaimedFederalEITC")?.value==="yes";
  const eitcDetail=document.getElementById("newJerseyEitcDetail");if(eitcDetail)eitcDetail.hidden=!eitc;
  const eitcAmount=document.getElementById("njFederalEITCAmount");if(eitcAmount){eitcAmount.disabled=!eitc;eitcAmount.required=eitc;}
  if(isNJ&&!eitc)setEstimatorFieldValue("njFederalEITCAmount","0");
  if(!isNJ)allIds.forEach((id)=>setEstimatorFieldValue(id,""));
}

function restoreNewYorkStateFields(taxData = {}) {
  const boolVal=(v)=>v===true?"yes":v===false?"no":"";
  ["nyFullYearResident","nyHasFilingStatusException","nyHasPartYearLocalResidency","nyJointLocalResidencyMismatch","nyHasYonkersNonresidentEarnings","nyClaimedFederalEITC","nyHasNoncustodialEITC","nyHasOtherStateCredit","nyHasAmendedOrOtherSpecialItems"].forEach((id)=>setEstimatorFieldValue(id,boolVal(taxData[id])));
  setEstimatorFieldValue("nyDeductionMethod",taxData.nyDeductionMethod||"");
  setEstimatorFieldValue("nyLocality",taxData.nyLocality||"");
  ["nyAdditions","nySubtractions","nyItemizedDeduction","nyHighIncomeLine39Tax","nyOtherNonrefundableCredits","nyOtherStateTaxes","nySalesUseTax","nyMctmt","nyNycTaxableIncome","nyNycOtherTaxes","nyNycNonrefundableCredits","nyYonkersResidentSurcharge","nyEmpireChildUnder4Count","nyEmpireChild4To16Count","nyStateChildDependentCareCredit","nyFederalEITCAmount","nyRealPropertyTaxCredit","nyCollegeTuitionCredit","nyNycChildDependentCareCredit","nyNycSchoolTaxCreditFixed","nyNycSchoolTaxCreditRateReduction","nyNycEITC","nyOtherRefundableCredits","nyOtherNYWithholding","nyEstimatedPayments","nyExtensionPayment","nyVoluntaryContributions","nyPenaltyInterest","nyCreditToNextYear"].forEach((id)=>setEstimatorFieldValue(id,taxData[id]??""));
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshNewYorkStateVisibility() {
  const container=document.getElementById("newYorkStateQuestions");
  if(!container) return;
  const isNY=String(document.getElementById("stateCode")?.value||"").toUpperCase()==="NY"&&Number(document.getElementById("taxYear")?.value||0)===2025;
  const allIds=["nyFullYearResident","nyHasFilingStatusException","nyDeductionMethod","nyItemizedDeduction","nyAdditions","nySubtractions","nyLocality","nyHasPartYearLocalResidency","nyJointLocalResidencyMismatch","nyHasYonkersNonresidentEarnings","nyHighIncomeLine39Tax","nyOtherNonrefundableCredits","nyOtherStateTaxes","nySalesUseTax","nyMctmt","nyNycTaxableIncome","nyNycOtherTaxes","nyNycNonrefundableCredits","nyYonkersResidentSurcharge","nyEmpireChildUnder4Count","nyEmpireChild4To16Count","nyStateChildDependentCareCredit","nyClaimedFederalEITC","nyFederalEITCAmount","nyHasNoncustodialEITC","nyRealPropertyTaxCredit","nyCollegeTuitionCredit","nyNycChildDependentCareCredit","nyNycSchoolTaxCreditFixed","nyNycSchoolTaxCreditRateReduction","nyNycEITC","nyOtherRefundableCredits","nyOtherNYWithholding","nyEstimatedPayments","nyExtensionPayment","nyVoluntaryContributions","nyPenaltyInterest","nyCreditToNextYear","nyHasOtherStateCredit","nyHasAmendedOrOtherSpecialItems"];
  container.hidden=!isNY;
  allIds.forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!isNY;el.required=isNY;}});
  const highIncomeDetail=document.getElementById("newYorkHighIncomeDetail");if(highIncomeDetail)highIncomeDetail.hidden=!isNY;
  const highIncomeAmount=document.getElementById("nyHighIncomeLine39Tax");if(highIncomeAmount){highIncomeAmount.disabled=!isNY;highIncomeAmount.required=isNY;}
  const itemized=isNY&&document.getElementById("nyDeductionMethod")?.value==="itemized";
  const itemizedDetail=document.getElementById("newYorkItemizedDetail");if(itemizedDetail)itemizedDetail.hidden=!itemized;
  const itemizedAmount=document.getElementById("nyItemizedDeduction");if(itemizedAmount){itemizedAmount.disabled=!itemized;itemizedAmount.required=itemized;}if(isNY&&!itemized)setEstimatorFieldValue("nyItemizedDeduction","0");
  const nyc=isNY&&document.getElementById("nyLocality")?.value==="nyc";
  const nycDetail=document.getElementById("newYorkNycDetail");if(nycDetail)nycDetail.hidden=!nyc;
  ["nyNycTaxableIncome","nyNycOtherTaxes","nyNycNonrefundableCredits","nyNycChildDependentCareCredit","nyNycSchoolTaxCreditFixed","nyNycSchoolTaxCreditRateReduction","nyNycEITC"].forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!nyc;el.required=nyc;}if(isNY&&!nyc)setEstimatorFieldValue(id,"0");});
  const yonkers=isNY&&document.getElementById("nyLocality")?.value==="yonkers";
  const yonkersDetail=document.getElementById("newYorkYonkersDetail");if(yonkersDetail)yonkersDetail.hidden=!yonkers;
  const yonkersAmount=document.getElementById("nyYonkersResidentSurcharge");if(yonkersAmount){yonkersAmount.disabled=!yonkers;yonkersAmount.required=yonkers;}if(isNY&&!yonkers)setEstimatorFieldValue("nyYonkersResidentSurcharge","0");
  const eitc=isNY&&document.getElementById("nyClaimedFederalEITC")?.value==="yes";
  const eitcDetail=document.getElementById("newYorkEitcDetail");if(eitcDetail)eitcDetail.hidden=!eitc;
  const eitcAmount=document.getElementById("nyFederalEITCAmount");if(eitcAmount){eitcAmount.disabled=!eitc;eitcAmount.required=eitc;}if(isNY&&!eitc)setEstimatorFieldValue("nyFederalEITCAmount","0");
  if(!isNY)allIds.forEach((id)=>setEstimatorFieldValue(id,""));
}

function restoreRhodeIslandStateFields(taxData = {}) {
  const boolVal=(v)=>v===true?"yes":v===false?"no":"";
  ["riFullYearResident","riHasFilingStatusException","riClaimedFederalEITC","riHasAmendedOrOtherSpecialItems"].forEach((id)=>setEstimatorFieldValue(id,boolVal(taxData[id])));
  ["riNetModifications","riFederalChildDependentCareCredit","riOtherStateCredit","riOtherRhodeIslandCredits","riCreditRecapture","riCheckoffContributions","riUseSalesTax","riIndividualMandatePenalty","riFederalEITCAmount","riPropertyTaxReliefCredit","riLeadPaintCredit","riOtherRhodeIslandWithholding","riEstimatedPayments","riOtherPayments","riUnderpaymentInterest","riCreditToNextYear"].forEach((id)=>setEstimatorFieldValue(id,taxData[id]??""));
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshRhodeIslandStateVisibility() {
  const container=document.getElementById("rhodeIslandStateQuestions");
  if(!container) return;
  const isRI=String(document.getElementById("stateCode")?.value||"").toUpperCase()==="RI"&&Number(document.getElementById("taxYear")?.value||0)===2025;
  const allIds=["riFullYearResident","riHasFilingStatusException","riNetModifications","riFederalChildDependentCareCredit","riOtherStateCredit","riOtherRhodeIslandCredits","riCreditRecapture","riCheckoffContributions","riUseSalesTax","riIndividualMandatePenalty","riClaimedFederalEITC","riFederalEITCAmount","riPropertyTaxReliefCredit","riLeadPaintCredit","riOtherRhodeIslandWithholding","riEstimatedPayments","riOtherPayments","riUnderpaymentInterest","riCreditToNextYear","riHasAmendedOrOtherSpecialItems"];
  container.hidden=!isRI;
  allIds.forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!isRI;el.required=isRI;}});
  const eitc=isRI&&document.getElementById("riClaimedFederalEITC")?.value==="yes";
  const eitcDetail=document.getElementById("rhodeIslandEitcDetail");if(eitcDetail)eitcDetail.hidden=!eitc;
  const eitcAmount=document.getElementById("riFederalEITCAmount");if(eitcAmount){eitcAmount.disabled=!eitc;eitcAmount.required=eitc;}
  if(isRI&&!eitc)setEstimatorFieldValue("riFederalEITCAmount","0");
  if(!isRI)allIds.forEach((id)=>setEstimatorFieldValue(id,""));
}

function restoreVermontStateFields(taxData = {}) {
  const boolVal=(v)=>v===true?"yes":v===false?"no":"";
  ["vtFullYearResident","vtHasFilingStatusException","vtSpouseCanBeClaimedAsDependent","vtHasIncomeAdjustment","vtClaimedFederalEITC","vtIsQualifyingVeteran","vtUsesRenterCreditForIncomeTax","vtHasAmendedOrOtherSpecialItems"].forEach((id)=>setEstimatorFieldValue(id,boolVal(taxData[id])));
  ["vtNetModifications","vtStandardDeductionBoxCount","vtUsObligationInterestForMinimumTax","vtNetTaxAdjustment","vtCharitableContributions","vtOtherStateCredit","vtOtherNonrefundableCredits","vtChildCareContribution","vtUseTax","vtVoluntaryContributions","vtFederalChildDependentCareCredit","vtChildTaxCreditQualifyingChildCount","vtFederalEITCAmount","vtEitcQualifyingChildCount","vtOtherVermontWithholding","vtEstimatedPayments","vtRealEstateWithholding","vtK1EntityPayments","vtUnderpaymentInterestPenalty","vtCreditToNextYear","vtCreditToPropertyTaxBill"].forEach((id)=>setEstimatorFieldValue(id,taxData[id]??""));
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshVermontStateVisibility() {
  const container=document.getElementById("vermontStateQuestions");
  if(!container) return;
  const isVT=String(document.getElementById("stateCode")?.value||"").toUpperCase()==="VT"&&Number(document.getElementById("taxYear")?.value||0)===2025;
  const allIds=["vtFullYearResident","vtHasFilingStatusException","vtNetModifications","vtStandardDeductionBoxCount","vtSpouseCanBeClaimedAsDependent","vtUsObligationInterestForMinimumTax","vtNetTaxAdjustment","vtCharitableContributions","vtHasIncomeAdjustment","vtOtherStateCredit","vtOtherNonrefundableCredits","vtChildCareContribution","vtUseTax","vtVoluntaryContributions","vtFederalChildDependentCareCredit","vtChildTaxCreditQualifyingChildCount","vtClaimedFederalEITC","vtFederalEITCAmount","vtEitcQualifyingChildCount","vtIsQualifyingVeteran","vtUsesRenterCreditForIncomeTax","vtOtherVermontWithholding","vtEstimatedPayments","vtRealEstateWithholding","vtK1EntityPayments","vtUnderpaymentInterestPenalty","vtCreditToNextYear","vtCreditToPropertyTaxBill","vtHasAmendedOrOtherSpecialItems"];
  container.hidden=!isVT;
  allIds.forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!isVT;el.required=isVT;}});
  const status=String(document.getElementById("filingStatus")?.value||"").toLowerCase();
  const spouseDetail=document.getElementById("vermontSpouseDependencyDetail"); const spouseField=document.getElementById("vtSpouseCanBeClaimedAsDependent"); const needSpouse=isVT&&status==="mfj";
  if(spouseDetail)spouseDetail.hidden=!needSpouse; if(spouseField){spouseField.disabled=!needSpouse;spouseField.required=needSpouse;if(isVT&&!needSpouse)setEstimatorFieldValue("vtSpouseCanBeClaimedAsDependent","");}
  const eitc=isVT&&document.getElementById("vtClaimedFederalEITC")?.value==="yes";
  const eitcDetail=document.getElementById("vermontEitcDetail");if(eitcDetail)eitcDetail.hidden=!eitc;
  ["vtFederalEITCAmount","vtEitcQualifyingChildCount"].forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!eitc;el.required=eitc;}});
  if(isVT&&!eitc){setEstimatorFieldValue("vtFederalEITCAmount","0");setEstimatorFieldValue("vtEitcQualifyingChildCount","0");}
  if(!isVT)allIds.forEach((id)=>setEstimatorFieldValue(id,""));
}

function restoreDistrictOfColumbiaStateFields(taxData = {}) {
  const boolVal=(v)=>v===true?"yes":v===false?"no":"";
  ["dcFullYearResident","dcHasFilingStatusException","dcTaxpayerBlind","dcSpouseBlind","dcFullYearHealthCoverageOrExempt","dcClaimsEITC","dcClaimsScheduleH","dcHasOtherJurisdictionCredit","dcHasD30UnincorporatedBusiness","dcHasNoncustodialEITC","dcHasAmendedOrOtherSpecialItems"].forEach((id)=>setEstimatorFieldValue(id,boolVal(taxData[id])));
  setEstimatorFieldValue("dcDeductionMethod",taxData.dcDeductionMethod||"");
  ["dcFranchiseTaxAddback","dcOtherAdditions","dcStateLocalRefundSubtraction","dcTaxableSocialSecuritySubtraction","dcFranchiseFiduciaryIncomeSubtraction","dcSurvivorBenefitsSubtraction","dcUnemploymentSubtraction","dcOtherSubtractions","dcFederalItemizedDeductions","dcFederalStateLocalTaxDeduction","dcFederalRealEstateTax","dcFederalOtherTaxes","dcProtectedItemizedDeductions","dcFederalChildDependentCareCredit","dcOtherNonrefundableCredits","dcHealthCareSharedResponsibilityPayment","dcEitcQualifyingChildCount","dcCalculatedFederalEITCAmount","dcChildlessEarnedIncome","dcScheduleHCredit","dcOtherRefundableCredits","dcOtherWithholding","dcEstimatedPayments","dcExtensionPayment","dcUnderpaymentInterest","dcCreditToNextYear","dcVoluntaryContributions"].forEach((id)=>setEstimatorFieldValue(id,taxData[id]??""));
  refreshDistrictOfColumbiaStateVisibility();
}

function refreshDistrictOfColumbiaStateVisibility() {
  const container=document.getElementById("districtOfColumbiaStateQuestions");
  if(!container) return;
  const isDC=String(document.getElementById("stateCode")?.value||"").toUpperCase()==="DC"&&Number(document.getElementById("taxYear")?.value||0)===2025;
  const allIds=["dcFullYearResident","dcHasFilingStatusException","dcDeductionMethod","dcTaxpayerBlind","dcSpouseBlind","dcFranchiseTaxAddback","dcOtherAdditions","dcStateLocalRefundSubtraction","dcTaxableSocialSecuritySubtraction","dcFranchiseFiduciaryIncomeSubtraction","dcSurvivorBenefitsSubtraction","dcUnemploymentSubtraction","dcOtherSubtractions","dcFederalItemizedDeductions","dcFederalStateLocalTaxDeduction","dcFederalRealEstateTax","dcFederalOtherTaxes","dcProtectedItemizedDeductions","dcFederalChildDependentCareCredit","dcOtherNonrefundableCredits","dcFullYearHealthCoverageOrExempt","dcHealthCareSharedResponsibilityPayment","dcClaimsEITC","dcEitcQualifyingChildCount","dcCalculatedFederalEITCAmount","dcChildlessEarnedIncome","dcClaimsScheduleH","dcScheduleHCredit","dcOtherRefundableCredits","dcOtherWithholding","dcEstimatedPayments","dcExtensionPayment","dcCreditToNextYear","dcUnderpaymentInterest","dcVoluntaryContributions","dcHasOtherJurisdictionCredit","dcHasD30UnincorporatedBusiness","dcHasNoncustodialEITC","dcHasAmendedOrOtherSpecialItems"];
  container.hidden=!isDC;
  allIds.forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!isDC;el.required=isDC;}});
  const status=String(document.getElementById("filingStatus")?.value||"").toLowerCase();
  const spouse=isDC&&status==="mfj"; const spouseDetail=document.getElementById("districtSpouseBlindDetail"); const spouseField=document.getElementById("dcSpouseBlind");
  if(spouseDetail)spouseDetail.hidden=!spouse;if(spouseField){spouseField.disabled=!spouse;spouseField.required=spouse;if(isDC&&!spouse)setEstimatorFieldValue("dcSpouseBlind","");}
  const itemized=isDC&&document.getElementById("dcDeductionMethod")?.value==="itemized";const itemizedDetail=document.getElementById("districtItemizedDetail");if(itemizedDetail)itemizedDetail.hidden=!itemized;
  ["dcFederalItemizedDeductions","dcFederalStateLocalTaxDeduction","dcFederalRealEstateTax","dcFederalOtherTaxes","dcProtectedItemizedDeductions"].forEach((id)=>{const el=document.getElementById(id);if(el){el.disabled=!itemized;el.required=itemized;}if(isDC&&!itemized)setEstimatorFieldValue(id,"0");});
  const hsr=isDC&&document.getElementById("dcFullYearHealthCoverageOrExempt")?.value==="no";const hsrDetail=document.getElementById("districtHsrDetail");if(hsrDetail)hsrDetail.hidden=!hsr;const hsrField=document.getElementById("dcHealthCareSharedResponsibilityPayment");if(hsrField){hsrField.disabled=!hsr;hsrField.required=hsr;}if(isDC&&!hsr)setEstimatorFieldValue("dcHealthCareSharedResponsibilityPayment","0");
  const eitc=isDC&&document.getElementById("dcClaimsEITC")?.value==="yes";const eitcDetail=document.getElementById("districtEitcDetail");if(eitcDetail)eitcDetail.hidden=!eitc;const childCount=document.getElementById("dcEitcQualifyingChildCount");if(childCount){childCount.disabled=!eitc;childCount.required=eitc;}if(isDC&&!eitc)setEstimatorFieldValue("dcEitcQualifyingChildCount","0");
  const count=Number(document.getElementById("dcEitcQualifyingChildCount")?.value||0);const withChildren=eitc&&count>0;const childless=eitc&&count===0;
  const withDetail=document.getElementById("districtEitcWithChildrenDetail");if(withDetail)withDetail.hidden=!withChildren;const fed=document.getElementById("dcCalculatedFederalEITCAmount");if(fed){fed.disabled=!withChildren;fed.required=withChildren;}if(isDC&&!withChildren)setEstimatorFieldValue("dcCalculatedFederalEITCAmount","0");
  const childlessDetail=document.getElementById("districtChildlessEitcDetail");if(childlessDetail)childlessDetail.hidden=!childless;const earned=document.getElementById("dcChildlessEarnedIncome");if(earned){earned.disabled=!childless;earned.required=childless;}if(isDC&&!childless)setEstimatorFieldValue("dcChildlessEarnedIncome","0");
  const schedH=isDC&&document.getElementById("dcClaimsScheduleH")?.value==="yes";const schedDetail=document.getElementById("districtScheduleHDetail");if(schedDetail)schedDetail.hidden=!schedH;const schedField=document.getElementById("dcScheduleHCredit");if(schedField){schedField.disabled=!schedH;schedField.required=schedH;}if(isDC&&!schedH)setEstimatorFieldValue("dcScheduleHCredit","0");
  if(!isDC)allIds.forEach((id)=>setEstimatorFieldValue(id,""));
}

function restoreKansasStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "ksNetModifications", "ksDeductionAmount", "ksNewbornDependentCount", "ksStillbirthCount", "ksDisabledVeteranCount",
    "ksLumpSumDistributionTax", "ksFederalChildDependentCareCredit", "ksOtherNonrefundableCredits", "ksFederalEITCAmount",
    "ksOtherFormWithholding", "ksEstimatedPayments", "ksExtensionPayment", "ksOtherRefundableCredits", "ksPtetCredit",
    "ksInterest", "ksLatePaymentPenalty", "ksEstimatedTaxPenalty", "ksCreditForward", "ksContributions"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  setEstimatorFieldValue("ksDeductionMethod", taxData.ksDeductionMethod || "");
  ["ksFullYearResident", "ksMfsSpouseSameDeductionMethod", "ksCreditSsnEligibilityConfirmed", "ksHasOtherStateCredit", "ksHasSeparatePropertyTaxRefundClaim", "ksHasAmendedOrOtherSpecialItems"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshColoradoStateVisibility();
  refreshKansasStateVisibility();
}

function refreshKansasStateVisibility() {
  const container = document.getElementById("kansasStateQuestions");
  if (!container) return;
  const isKS = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "KS" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const status = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  const hasCredit = ["ksFederalChildDependentCareCredit", "ksOtherNonrefundableCredits", "ksFederalEITCAmount", "ksOtherRefundableCredits"]
    .some((id) => getVal(id) !== "" && getNum(id) > 0);
  container.hidden = !isKS;
  const mfsGroup = document.getElementById("kansasMfsDeductionGroup");
  if (mfsGroup) mfsGroup.hidden = !(isKS && status === "mfs");
  const creditSsnGroup = document.getElementById("kansasCreditSsnGroup");
  if (creditSsnGroup) creditSsnGroup.hidden = !(isKS && hasCredit);

  const requiredAlways = [
    "ksFullYearResident", "ksNetModifications", "ksDeductionMethod", "ksDeductionAmount", "ksNewbornDependentCount", "ksStillbirthCount", "ksDisabledVeteranCount",
    "ksLumpSumDistributionTax", "ksHasOtherStateCredit", "ksFederalChildDependentCareCredit", "ksOtherNonrefundableCredits", "ksFederalEITCAmount",
    "ksOtherFormWithholding", "ksEstimatedPayments", "ksExtensionPayment", "ksOtherRefundableCredits", "ksPtetCredit", "ksInterest", "ksLatePaymentPenalty",
    "ksEstimatedTaxPenalty", "ksCreditForward", "ksContributions", "ksHasSeparatePropertyTaxRefundClaim", "ksHasAmendedOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => { const el=document.getElementById(id); if(el) el.required=isKS; });
  const mfs = document.getElementById("ksMfsSpouseSameDeductionMethod");
  if (mfs) mfs.required = isKS && status === "mfs";
  const ssn = document.getElementById("ksCreditSsnEligibilityConfirmed");
  if (ssn) ssn.required = isKS && hasCredit;
  const all=[...requiredAlways,"ksMfsSpouseSameDeductionMethod","ksCreditSsnEligibilityConfirmed"];
  if(!isKS){all.forEach((id)=>setEstimatorFieldValue(id,"")); return;}
  if(status!=="mfs") setEstimatorFieldValue("ksMfsSpouseSameDeductionMethod","");
  if(!hasCredit) setEstimatorFieldValue("ksCreditSsnEligibilityConfirmed","");
}

function restoreNebraskaStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "neStandardDeduction", "neFederalItemizedDeductions", "neStateLocalIncomeTaxes", "neScheduleIIncreases", "neScheduleIDecreases",
    "neFederalLumpSumTax", "neFederalEarlyDistributionTax", "neOtherNonrefundableCredits", "neFederalTaxBeforeCreditsLimit",
    "neOtherFormWithholding", "neK1Withholding", "nePtetCredit", "neEstimatedPayments", "neForm3800RefundableCredit", "neChildDependentCareRefundableCredit",
    "neBeginningFarmerCredit", "neFederalEITCAmount", "neOtherRefundableCredits", "neUnderpaymentPenalty", "neUseTax",
    "neApplyToNextYear", "neWildlifeDonation"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  ["neFullYearResident", "neSpouseCanBeClaimedAsDependent", "neHasOtherStateCredit", "neUseTaxRequiresSeparateForm3", "neHasFederalNolEitcSpecialCase", "neHasAmendedOrOtherSpecialItems"]
    .forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshNebraskaStateVisibility();
}

function refreshNebraskaStateVisibility() {
  const container = document.getElementById("nebraskaStateQuestions");
  if (!container) return;
  const isNE = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "NE" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const status = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  const scheduleIIncreasesRaw = getVal("neScheduleIIncreases");
  const scheduleIDecreasesRaw = getVal("neScheduleIDecreases");
  const haveAdjustmentInputs = scheduleIIncreasesRaw !== "" && scheduleIDecreasesRaw !== "";
  const netAdjustments = haveAdjustmentInputs ? getNum("neScheduleIIncreases") - getNum("neScheduleIDecreases") : null;
  const needsFederalLimit = isNE && haveAdjustmentInputs && netAdjustments < 5000;

  container.hidden = !isNE;
  const spouseGroup = document.getElementById("nebraskaSpouseDependentGroup");
  if (spouseGroup) spouseGroup.hidden = !(isNE && status === "mfj");
  const federalLimitGroup = document.getElementById("nebraskaFederalTaxLimitGroup");
  if (federalLimitGroup) federalLimitGroup.hidden = !needsFederalLimit;

  const requiredAlways = [
    "neFullYearResident", "neStandardDeduction", "neFederalItemizedDeductions", "neStateLocalIncomeTaxes", "neScheduleIIncreases", "neScheduleIDecreases",
    "neFederalLumpSumTax", "neFederalEarlyDistributionTax", "neOtherNonrefundableCredits", "neHasOtherStateCredit",
    "neOtherFormWithholding", "neK1Withholding", "nePtetCredit", "neEstimatedPayments", "neForm3800RefundableCredit", "neChildDependentCareRefundableCredit", "neBeginningFarmerCredit",
    "neFederalEITCAmount", "neOtherRefundableCredits", "neUnderpaymentPenalty", "neUseTax", "neApplyToNextYear", "neWildlifeDonation",
    "neUseTaxRequiresSeparateForm3", "neHasFederalNolEitcSpecialCase", "neHasAmendedOrOtherSpecialItems"
  ];
  requiredAlways.forEach((id) => { const el=document.getElementById(id); if(el) el.required=isNE; });
  const federalLimit = document.getElementById("neFederalTaxBeforeCreditsLimit");
  if (federalLimit) federalLimit.required = needsFederalLimit;
  const spouse = document.getElementById("neSpouseCanBeClaimedAsDependent");
  if (spouse) spouse.required = isNE && status === "mfj";
  const all=[...requiredAlways,"neFederalTaxBeforeCreditsLimit","neSpouseCanBeClaimedAsDependent"];
  if(!isNE){ all.forEach((id)=>setEstimatorFieldValue(id,"")); return; }
  if(status!=="mfj") setEstimatorFieldValue("neSpouseCanBeClaimedAsDependent","");
  if(haveAdjustmentInputs && !needsFederalLimit) setEstimatorFieldValue("neFederalTaxBeforeCreditsLimit","");
}

function restoreMinnesotaStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "mnM1Additions", "mnItemizedDeductions", "mnDependentEarnedIncome", "mnM1NCWorksheetAGI",
    "mnStateIncomeTaxRefund", "mnM1Subtractions", "mnAlternativeMinimumTax", "mnOtherTaxes",
    "mnAdvanceChildTaxCreditRepayment", "mnNonrefundableCredits", "mnNongameWildlifeContribution",
    "mnEstimatedPayments", "mnRefundableCredits", "mnScheduleM15Penalty", "mnOtherPenaltyInterest"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  [
    "mnFullYearResident", "mnUseItemizedDeductions", "mnTaxpayerBlind", "mnSpouseBlind",
    "mnMfsSpouseItemizes", "mnMfsSpouseNoGrossIncomeAndNotDependent", "mnSpouseCanBeClaimedAsDependent",
    "mnHasM1NCFederalAdjustments", "mnHasOtherStateCreditOrReciprocity", "mnShortPeriodOrNonresidentAlien",
    "mnHasAmendedOrOtherSpecialItems"
  ].forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshMinnesotaStateVisibility();
}

function refreshMinnesotaStateVisibility() {
  const container = document.getElementById("minnesotaStateQuestions");
  if (!container) return;
  const isMN = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "MN" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const status = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  const useItemized = getVal("mnUseItemizedDeductions") === "yes";
  const hasM1NC = getVal("mnHasM1NCFederalAdjustments") === "yes";
  const taxpayerDependent = document.querySelector('input[name="canBeClaimedAsDependent"]:checked')?.value === "yes";
  const spouseDependent = status === "mfj" && getVal("mnSpouseCanBeClaimedAsDependent") === "yes";
  const dependentWorksheet = !useItemized && (taxpayerDependent || spouseDependent);

  container.hidden = !isMN;
  const show = (id, visible) => { const el=document.getElementById(id); if (el) el.hidden=!visible; };
  show("minnesotaM1NCAGIGroup", isMN && hasM1NC);
  show("minnesotaItemizedDeductionGroup", isMN && useItemized);
  show("minnesotaStandardDeductionDetailsGroup", isMN && !useItemized);
  show("minnesotaSpouseBlindGroup", isMN && !useItemized && ["mfj","mfs"].includes(status));
  show("minnesotaMfsDetailsGroup", isMN && status === "mfs");
  show("minnesotaMfsSpouseBoxGroup", isMN && status === "mfs" && !useItemized);
  show("minnesotaSpouseDependentGroup", isMN && status === "mfj" && !useItemized);
  show("minnesotaDependentEarnedIncomeGroup", isMN && dependentWorksheet);

  const requiredAlways = ["mnFullYearResident","mnM1Additions","mnUseItemizedDeductions","mnHasM1NCFederalAdjustments","mnStateIncomeTaxRefund","mnM1Subtractions","mnAlternativeMinimumTax","mnOtherTaxes","mnAdvanceChildTaxCreditRepayment","mnNonrefundableCredits","mnNongameWildlifeContribution","mnEstimatedPayments","mnRefundableCredits","mnScheduleM15Penalty","mnOtherPenaltyInterest","mnHasOtherStateCreditOrReciprocity","mnShortPeriodOrNonresidentAlien","mnHasAmendedOrOtherSpecialItems"];
  requiredAlways.forEach((id)=>{const el=document.getElementById(id); if(el) el.required=isMN;});
  const setReq=(id,v)=>{const el=document.getElementById(id); if(el) el.required=!!v;};
  setReq("mnItemizedDeductions", isMN && useItemized);
  setReq("mnTaxpayerBlind", isMN && !useItemized);
  setReq("mnSpouseBlind", isMN && !useItemized && ["mfj","mfs"].includes(status));
  setReq("mnMfsSpouseItemizes", isMN && status === "mfs");
  setReq("mnMfsSpouseNoGrossIncomeAndNotDependent", isMN && status === "mfs" && !useItemized);
  setReq("mnSpouseCanBeClaimedAsDependent", isMN && status === "mfj" && !useItemized);
  setReq("mnDependentEarnedIncome", isMN && dependentWorksheet);
  setReq("mnM1NCWorksheetAGI", isMN && hasM1NC);

  const all=[...requiredAlways,"mnItemizedDeductions","mnTaxpayerBlind","mnSpouseBlind","mnMfsSpouseItemizes","mnMfsSpouseNoGrossIncomeAndNotDependent","mnSpouseCanBeClaimedAsDependent","mnDependentEarnedIncome","mnM1NCWorksheetAGI"];
  if(!isMN){all.forEach((id)=>setEstimatorFieldValue(id,"")); return;}
  if(!useItemized) setEstimatorFieldValue("mnItemizedDeductions","");
  if(useItemized){["mnTaxpayerBlind","mnSpouseBlind","mnMfsSpouseNoGrossIncomeAndNotDependent","mnSpouseCanBeClaimedAsDependent","mnDependentEarnedIncome"].forEach((id)=>setEstimatorFieldValue(id,""));}
  if(status!=="mfs"){setEstimatorFieldValue("mnMfsSpouseItemizes",""); setEstimatorFieldValue("mnMfsSpouseNoGrossIncomeAndNotDependent","");}
  if(!["mfj","mfs"].includes(status)) setEstimatorFieldValue("mnSpouseBlind","");
  if(status!=="mfj") setEstimatorFieldValue("mnSpouseCanBeClaimedAsDependent","");
  if(!dependentWorksheet) setEstimatorFieldValue("mnDependentEarnedIncome","");
  if(!hasM1NC) setEstimatorFieldValue("mnM1NCWorksheetAGI","");
}

function restoreWisconsinStateFields(taxData = {}) {
  const boolVal = (value) => value === true ? "yes" : value === false ? "no" : "";
  [
    "wiScheduleIAdjustment", "wiScheduleADAdditions", "wiScheduleSBSubtractions",
    "wiDependentEarnedIncome", "wiNonrefundableCredits", "wiFederalEICAmount",
    "wiEICQualifyingChildren", "wiOtherRefundableCredits", "wiUseTax", "wiDonations",
    "wiRetirementPenaltiesAndCreditRepayments", "wiEstimatedPayments", "wiUnderpaymentInterest"
  ].forEach((id) => setEstimatorFieldValue(id, taxData[id]));
  [
    "wiFullYearResident", "wiShortPeriodOrPossessions", "wiSpouseCanBeClaimedAsDependent",
    "wiUsedNewRetirementIncomeSubtraction", "wiClaimedFederalEIC",
    "wiHasOtherStateCreditOrReciprocity", "wiHasAmendedOrOtherSpecialItems"
  ].forEach((id) => setEstimatorFieldValue(id, boolVal(taxData[id])));
  refreshWisconsinStateVisibility();
}

function refreshWisconsinStateVisibility() {
  const container = document.getElementById("wisconsinStateQuestions");
  if (!container) return;

  const isWI = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "WI" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const filingStatus = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  const isMFJ = filingStatus === "mfj";
  const taxpayerIsDependent = document.querySelector('input[name="canBeClaimedAsDependent"]:checked')?.value === "yes";
  const spouseIsDependent = isMFJ && getVal("wiSpouseCanBeClaimedAsDependent") === "yes";
  const dependentWorksheetApplies = taxpayerIsDependent || spouseIsDependent;
  const claimedFederalEIC = getVal("wiClaimedFederalEIC") === "yes";

  container.hidden = !isWI;
  const spouseGroup = document.getElementById("wisconsinSpouseDependentGroup");
  const dependentIncomeGroup = document.getElementById("wisconsinDependentEarnedIncomeGroup");
  const eicDetailsGroup = document.getElementById("wisconsinEICDetailsGroup");
  if (spouseGroup) spouseGroup.hidden = !(isWI && isMFJ);
  if (dependentIncomeGroup) dependentIncomeGroup.hidden = !(isWI && dependentWorksheetApplies);
  if (eicDetailsGroup) eicDetailsGroup.hidden = !(isWI && claimedFederalEIC);

  [
    "wiFullYearResident", "wiScheduleIAdjustment", "wiScheduleADAdditions", "wiScheduleSBSubtractions",
    "wiShortPeriodOrPossessions", "wiUsedNewRetirementIncomeSubtraction", "wiNonrefundableCredits",
    "wiClaimedFederalEIC", "wiOtherRefundableCredits", "wiUseTax", "wiDonations",
    "wiRetirementPenaltiesAndCreditRepayments", "wiEstimatedPayments", "wiUnderpaymentInterest",
    "wiHasOtherStateCreditOrReciprocity", "wiHasAmendedOrOtherSpecialItems"
  ].forEach((id) => { const el = document.getElementById(id); if (el) el.required = isWI; });

  const spouseDependentField = document.getElementById("wiSpouseCanBeClaimedAsDependent");
  if (spouseDependentField) spouseDependentField.required = isWI && isMFJ;
  const dependentEarnedIncomeField = document.getElementById("wiDependentEarnedIncome");
  if (dependentEarnedIncomeField) dependentEarnedIncomeField.required = isWI && dependentWorksheetApplies;
  ["wiFederalEICAmount", "wiEICQualifyingChildren"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isWI && claimedFederalEIC;
  });

  const clearAll = [
    "wiFullYearResident", "wiScheduleIAdjustment", "wiScheduleADAdditions", "wiScheduleSBSubtractions",
    "wiShortPeriodOrPossessions", "wiSpouseCanBeClaimedAsDependent", "wiDependentEarnedIncome",
    "wiUsedNewRetirementIncomeSubtraction", "wiNonrefundableCredits", "wiClaimedFederalEIC",
    "wiFederalEICAmount", "wiEICQualifyingChildren", "wiOtherRefundableCredits", "wiUseTax", "wiDonations",
    "wiRetirementPenaltiesAndCreditRepayments", "wiEstimatedPayments", "wiUnderpaymentInterest",
    "wiHasOtherStateCreditOrReciprocity", "wiHasAmendedOrOtherSpecialItems"
  ];
  if (!isWI) {
    clearAll.forEach((id) => setEstimatorFieldValue(id, ""));
    return;
  }

  if (!isMFJ) setEstimatorFieldValue("wiSpouseCanBeClaimedAsDependent", "");
  if (!dependentWorksheetApplies) setEstimatorFieldValue("wiDependentEarnedIncome", "");
  if (!claimedFederalEIC) {
    setEstimatorFieldValue("wiFederalEICAmount", "");
    setEstimatorFieldValue("wiEICQualifyingChildren", "");
  }
}

function restoreMissouriStateFields(taxData = {}) {
  setEstimatorFieldValue("moFullYearResident", taxData.moFullYearResident === true ? "yes" : taxData.moFullYearResident === false ? "no" : "");
  setEstimatorFieldValue("moTotalAdditions", taxData.moTotalAdditions);
  setEstimatorFieldValue("moTotalSubtractions", taxData.moTotalSubtractions);
  setEstimatorFieldValue("moPrimaryAdjustedGrossIncome", taxData.moPrimaryAdjustedGrossIncome);
  setEstimatorFieldValue("moSpouseAdjustedGrossIncome", taxData.moSpouseAdjustedGrossIncome);
  setEstimatorFieldValue("moPensionSocialSecurityExemption", taxData.moPensionSocialSecurityExemption);
  setEstimatorFieldValue("moFederalIncomeTaxDeduction", taxData.moFederalIncomeTaxDeduction);
  setEstimatorFieldValue("moDeductionChoice", taxData.moDeductionChoice || "");
  setEstimatorFieldValue("moItemizedDeductions", taxData.moItemizedDeductions);
  setEstimatorFieldValue("moDependentEarnedIncome", taxData.moDependentEarnedIncome);
  setEstimatorFieldValue("moTaxpayerBlind", taxData.moTaxpayerBlind === true ? "yes" : taxData.moTaxpayerBlind === false ? "no" : "");
  setEstimatorFieldValue("moSpouseBlind", taxData.moSpouseBlind === true ? "yes" : taxData.moSpouseBlind === false ? "no" : "");
  setEstimatorFieldValue("moFederallyRequiredToItemize", taxData.moFederallyRequiredToItemize === true ? "yes" : taxData.moFederallyRequiredToItemize === false ? "no" : "");
  setEstimatorFieldValue("moHasQualifiedDisasterLossStandardDeductionIncrease", taxData.moHasQualifiedDisasterLossStandardDeductionIncrease === true ? "yes" : taxData.moHasQualifiedDisasterLossStandardDeductionIncrease === false ? "no" : "");
  setEstimatorFieldValue("moOtherDeductions", taxData.moOtherDeductions);
  setEstimatorFieldValue("moClaimedFederalEIC", taxData.moClaimedFederalEIC === true ? "yes" : taxData.moClaimedFederalEIC === false ? "no" : "");
  setEstimatorFieldValue("moFederalEICAmount", taxData.moFederalEICAmount);
  setEstimatorFieldValue("moWftcInvestmentIncomeOver4400", taxData.moWftcInvestmentIncomeOver4400 === true ? "yes" : taxData.moWftcInvestmentIncomeOver4400 === false ? "no" : "");
  setEstimatorFieldValue("moWftcChildInfoComplete", taxData.moWftcChildInfoComplete === true ? "yes" : taxData.moWftcChildInfoComplete === false ? "no" : "");
  setEstimatorFieldValue("moEstimatedTaxPayments", taxData.moEstimatedTaxPayments);
  setEstimatorFieldValue("moOtherPayments", taxData.moOtherPayments);
  setEstimatorFieldValue("moExtensionPayments", taxData.moExtensionPayments);
  setEstimatorFieldValue("moHasEnterpriseZoneModification", taxData.moHasEnterpriseZoneModification === true ? "yes" : taxData.moHasEnterpriseZoneModification === false ? "no" : "");
  setEstimatorFieldValue("moHasResidentCreditOtherState", taxData.moHasResidentCreditOtherState === true ? "yes" : taxData.moHasResidentCreditOtherState === false ? "no" : "");
  setEstimatorFieldValue("moHasMiscOrPropertyTaxCredits", taxData.moHasMiscOrPropertyTaxCredits === true ? "yes" : taxData.moHasMiscOrPropertyTaxCredits === false ? "no" : "");
  setEstimatorFieldValue("moHasOtherTaxOrSpecialItems", taxData.moHasOtherTaxOrSpecialItems === true ? "yes" : taxData.moHasOtherTaxOrSpecialItems === false ? "no" : "");
  refreshMissouriStateVisibility();
}

function refreshMissouriStateVisibility() {
  const container = document.getElementById("missouriStateQuestions");
  if (!container) return;

  const isMO = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "MO" && Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const filingStatus = String(document.getElementById("filingStatus")?.value || "").toLowerCase();
  const isCombined = filingStatus === "mfj";
  const deductionChoice = getVal("moDeductionChoice");
  const usesStandard = deductionChoice === "standard";
  const isDependent = getRadio("canBeClaimedAsDependent") === "yes";
  const claimedEic = getVal("moClaimedFederalEIC") === "yes";
  const wftcStatusEligible = ["single", "mfj", "hoh", "qw"].includes(filingStatus) && !isDependent;

  container.hidden = !isMO;
  const nonCombined = document.getElementById("missouriNonCombinedAgiGroup");
  const combined = document.getElementById("missouriCombinedAgiGroup");
  const standardDetails = document.getElementById("missouriStandardDetailsGroup");
  const standardGuardrails = document.getElementById("missouriStandardGuardrailGroup");
  const spouseBlind = document.getElementById("missouriSpouseBlindGroup");
  const dependentEarned = document.getElementById("missouriDependentEarnedIncomeGroup");
  const itemized = document.getElementById("missouriItemizedGroup");
  const eicAmount = document.getElementById("missouriFederalEICAmountGroup");
  const wftc = document.getElementById("missouriWftcEligibilityGroup");

  if (nonCombined) nonCombined.hidden = !(isMO && !isCombined);
  if (combined) combined.hidden = !(isMO && isCombined);
  if (standardDetails) standardDetails.hidden = !(isMO && usesStandard);
  if (standardGuardrails) standardGuardrails.hidden = !(isMO && usesStandard);
  if (spouseBlind) spouseBlind.hidden = !(isMO && usesStandard && isCombined);
  if (dependentEarned) dependentEarned.hidden = !(isMO && usesStandard && isDependent);
  if (itemized) itemized.hidden = !(isMO && deductionChoice === "itemized");
  if (eicAmount) eicAmount.hidden = !(isMO && claimedEic);
  if (wftc) wftc.hidden = !(isMO && claimedEic && wftcStatusEligible);

  [
    "moFullYearResident", "moPensionSocialSecurityExemption", "moFederalIncomeTaxDeduction",
    "moDeductionChoice", "moOtherDeductions", "moClaimedFederalEIC",
    "moHasEnterpriseZoneModification", "moHasResidentCreditOtherState",
    "moHasMiscOrPropertyTaxCredits", "moHasOtherTaxOrSpecialItems"
  ].forEach((id) => { const el = document.getElementById(id); if (el) el.required = isMO; });

  ["moTotalAdditions", "moTotalSubtractions"].forEach((id) => { const el = document.getElementById(id); if (el) el.required = isMO && !isCombined; });
  ["moPrimaryAdjustedGrossIncome", "moSpouseAdjustedGrossIncome"].forEach((id) => { const el = document.getElementById(id); if (el) el.required = isMO && isCombined; });
  const itemizedField = document.getElementById("moItemizedDeductions");
  if (itemizedField) itemizedField.required = isMO && deductionChoice === "itemized";
  const federallyRequiredToItemize = document.getElementById("moFederallyRequiredToItemize");
  if (federallyRequiredToItemize) federallyRequiredToItemize.required = isMO && usesStandard;
  const disasterLoss = document.getElementById("moHasQualifiedDisasterLossStandardDeductionIncrease");
  if (disasterLoss) disasterLoss.required = isMO && usesStandard;
  const taxpayerBlind = document.getElementById("moTaxpayerBlind");
  if (taxpayerBlind) taxpayerBlind.required = isMO && usesStandard;
  const spouseBlindField = document.getElementById("moSpouseBlind");
  if (spouseBlindField) spouseBlindField.required = isMO && usesStandard && isCombined;
  const dependentEarnedField = document.getElementById("moDependentEarnedIncome");
  if (dependentEarnedField) dependentEarnedField.required = isMO && usesStandard && isDependent;
  const federalEicAmount = document.getElementById("moFederalEICAmount");
  if (federalEicAmount) federalEicAmount.required = isMO && claimedEic;
  const investment = document.getElementById("moWftcInvestmentIncomeOver4400");
  if (investment) investment.required = isMO && claimedEic && wftcStatusEligible;
  const childInfo = document.getElementById("moWftcChildInfoComplete");
  if (childInfo) childInfo.required = isMO && claimedEic && wftcStatusEligible;

  if (!isMO) {
    [
      ["moFullYearResident", ""], ["moTotalAdditions", ""], ["moTotalSubtractions", ""],
      ["moPrimaryAdjustedGrossIncome", ""], ["moSpouseAdjustedGrossIncome", ""],
      ["moPensionSocialSecurityExemption", ""], ["moFederalIncomeTaxDeduction", ""],
      ["moDeductionChoice", ""], ["moItemizedDeductions", ""], ["moDependentEarnedIncome", ""],
      ["moTaxpayerBlind", ""], ["moSpouseBlind", ""], ["moFederallyRequiredToItemize", ""],
      ["moHasQualifiedDisasterLossStandardDeductionIncrease", ""], ["moOtherDeductions", ""],
      ["moClaimedFederalEIC", ""], ["moFederalEICAmount", "0"],
      ["moWftcInvestmentIncomeOver4400", ""], ["moWftcChildInfoComplete", ""],
      ["moEstimatedTaxPayments", "0"], ["moOtherPayments", "0"], ["moExtensionPayments", "0"],
      ["moHasEnterpriseZoneModification", ""], ["moHasResidentCreditOtherState", ""],
      ["moHasMiscOrPropertyTaxCredits", ""], ["moHasOtherTaxOrSpecialItems", ""]
    ].forEach(([id, value]) => setEstimatorFieldValue(id, value));
    return;
  }

  if (isCombined) {
    setEstimatorFieldValue("moTotalAdditions", "");
    setEstimatorFieldValue("moTotalSubtractions", "");
  } else {
    setEstimatorFieldValue("moPrimaryAdjustedGrossIncome", "");
    setEstimatorFieldValue("moSpouseAdjustedGrossIncome", "");
  }
  if (deductionChoice !== "itemized") setEstimatorFieldValue("moItemizedDeductions", "");
  if (!usesStandard) {
    setEstimatorFieldValue("moDependentEarnedIncome", "");
    setEstimatorFieldValue("moFederallyRequiredToItemize", "");
    setEstimatorFieldValue("moHasQualifiedDisasterLossStandardDeductionIncrease", "");
    setEstimatorFieldValue("moTaxpayerBlind", "");
    setEstimatorFieldValue("moSpouseBlind", "");
  } else {
    if (!isDependent) setEstimatorFieldValue("moDependentEarnedIncome", "");
    if (!isCombined) setEstimatorFieldValue("moSpouseBlind", "");
  }
  if (!claimedEic) {
    setEstimatorFieldValue("moFederalEICAmount", "0");
    setEstimatorFieldValue("moWftcInvestmentIncomeOver4400", "");
    setEstimatorFieldValue("moWftcChildInfoComplete", "");
  } else if (!wftcStatusEligible) {
    setEstimatorFieldValue("moWftcInvestmentIncomeOver4400", "");
    setEstimatorFieldValue("moWftcChildInfoComplete", "");
  }
}

function restoreMichiganStateFields(taxData = {}) {
  setEstimatorFieldValue("miFullYearResident", taxData.miFullYearResident === true ? "yes" : taxData.miFullYearResident === false ? "no" : "");
  setEstimatorFieldValue("miMfsMichiganFilingChoice", taxData.miMfsMichiganFilingChoice || "");
  setEstimatorFieldValue("miOtherAdditions", taxData.miOtherAdditions);
  setEstimatorFieldValue("miTaxableSocialSecurity", taxData.miTaxableSocialSecurity);
  setEstimatorFieldValue("miOtherSubtractions", taxData.miOtherSubtractions);
  setEstimatorFieldValue("miSpecialExemptionCount", taxData.miSpecialExemptionCount);
  setEstimatorFieldValue("miQualifiedDisabledVeteranCount", taxData.miQualifiedDisabledVeteranCount);
  setEstimatorFieldValue("miStillbirthCount", taxData.miStillbirthCount);
  setEstimatorFieldValue("miClaimedFederalEIC", taxData.miClaimedFederalEIC === true ? "yes" : taxData.miClaimedFederalEIC === false ? "no" : "");
  setEstimatorFieldValue("miFederalEICAmount", taxData.miFederalEICAmount);
  setEstimatorFieldValue("miHasRetirementPensionOrSeniorDeduction", taxData.miHasRetirementPensionOrSeniorDeduction === true ? "yes" : taxData.miHasRetirementPensionOrSeniorDeduction === false ? "no" : "");
  setEstimatorFieldValue("miHasPA24DecouplingAdjustment", taxData.miHasPA24DecouplingAdjustment === true ? "yes" : taxData.miHasPA24DecouplingAdjustment === false ? "no" : "");
  setEstimatorFieldValue("miHasOtherStateCreditOrAllocation", taxData.miHasOtherStateCreditOrAllocation === true ? "yes" : taxData.miHasOtherStateCreditOrAllocation === false ? "no" : "");
  setEstimatorFieldValue("miHasDetroitCityReturn", taxData.miHasDetroitCityReturn === true ? "yes" : taxData.miHasDetroitCityReturn === false ? "no" : "");
  setEstimatorFieldValue("miHasUseTax", taxData.miHasUseTax === true ? "yes" : taxData.miHasUseTax === false ? "no" : "");
  setEstimatorFieldValue("miUseTax", taxData.miUseTax);
  setEstimatorFieldValue("miEstimatedAndExtensionPayments", taxData.miEstimatedAndExtensionPayments);
  setEstimatorFieldValue("miHasSeparateRefundableCredits", taxData.miHasSeparateRefundableCredits === true ? "yes" : taxData.miHasSeparateRefundableCredits === false ? "no" : "");
  setEstimatorFieldValue("miHasOtherSpecialItems", taxData.miHasOtherSpecialItems === true ? "yes" : taxData.miHasOtherSpecialItems === false ? "no" : "");
  refreshMichiganStateVisibility();
}

function refreshMichiganStateVisibility() {
  const container = document.getElementById("michiganStateQuestions");
  if (!container) return;

  const isMI =
    String(document.getElementById("stateCode")?.value || "").toUpperCase() === "MI" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const hasEIC = getVal("miClaimedFederalEIC") === "yes";
  const hasUseTax = getVal("miHasUseTax") === "yes";
  const federalMfs = String(document.getElementById("filingStatus")?.value || "").toLowerCase() === "mfs";
  container.hidden = !isMI;

  const mfsGroup = document.getElementById("michiganMfsChoiceGroup");
  const eitcGroup = document.getElementById("michiganFederalEICAmountGroup");
  const useTaxGroup = document.getElementById("michiganUseTaxGroup");
  if (mfsGroup) mfsGroup.hidden = !(isMI && federalMfs);
  if (eitcGroup) eitcGroup.hidden = !(isMI && hasEIC);
  if (useTaxGroup) useTaxGroup.hidden = !(isMI && hasUseTax);

  [
    "miFullYearResident", "miOtherAdditions", "miTaxableSocialSecurity",
    "miOtherSubtractions", "miSpecialExemptionCount",
    "miQualifiedDisabledVeteranCount", "miStillbirthCount",
    "miClaimedFederalEIC", "miHasRetirementPensionOrSeniorDeduction",
    "miHasPA24DecouplingAdjustment", "miHasOtherStateCreditOrAllocation",
    "miHasDetroitCityReturn", "miHasUseTax",
    "miHasSeparateRefundableCredits", "miHasOtherSpecialItems"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isMI;
  });
  const mfsChoice = document.getElementById("miMfsMichiganFilingChoice");
  if (mfsChoice) mfsChoice.required = isMI && federalMfs;
  const eitc = document.getElementById("miFederalEICAmount");
  if (eitc) eitc.required = isMI && hasEIC;
  const useTax = document.getElementById("miUseTax");
  if (useTax) useTax.required = isMI && hasUseTax;

  if (!isMI) {
    [
      ["miFullYearResident", ""], ["miMfsMichiganFilingChoice", ""], ["miOtherAdditions", ""],
      ["miTaxableSocialSecurity", ""], ["miOtherSubtractions", ""],
      ["miSpecialExemptionCount", ""], ["miQualifiedDisabledVeteranCount", ""],
      ["miStillbirthCount", ""], ["miClaimedFederalEIC", ""],
      ["miFederalEICAmount", "0"], ["miHasRetirementPensionOrSeniorDeduction", ""],
      ["miHasPA24DecouplingAdjustment", ""], ["miHasOtherStateCreditOrAllocation", ""],
      ["miHasDetroitCityReturn", ""], ["miHasUseTax", ""],
      ["miUseTax", "0"], ["miEstimatedAndExtensionPayments", "0"],
      ["miHasSeparateRefundableCredits", ""], ["miHasOtherSpecialItems", ""]
    ].forEach(([id, value]) => setEstimatorFieldValue(id, value));
    return;
  }
  if (!federalMfs) setEstimatorFieldValue("miMfsMichiganFilingChoice", "");
  if (!hasEIC) setEstimatorFieldValue("miFederalEICAmount", "0");
  if (!hasUseTax) setEstimatorFieldValue("miUseTax", "0");
}

function restoreWestVirginiaStateFields(taxData = {}) {
  setEstimatorFieldValue("wvFullYearResident", taxData.wvFullYearResident === true ? "yes" : taxData.wvFullYearResident === false ? "no" : "");
  setEstimatorFieldValue("wvTotalAdditions", taxData.wvTotalAdditions);
  setEstimatorFieldValue("wvOtherSubtractions", taxData.wvOtherSubtractions);
  setEstimatorFieldValue("wvTaxableSocialSecurity", taxData.wvTaxableSocialSecurity);
  setEstimatorFieldValue("wvLowIncomeEarnedIncome", taxData.wvLowIncomeEarnedIncome);
  setEstimatorFieldValue("wvSpouseCanBeClaimedAsDependent", taxData.wvSpouseCanBeClaimedAsDependent === true ? "yes" : taxData.wvSpouseCanBeClaimedAsDependent === false ? "no" : "");
  setEstimatorFieldValue("wvSurvivingSpouseExemption", taxData.wvSurvivingSpouseExemption === true ? "yes" : taxData.wvSurvivingSpouseExemption === false ? "no" : "");
  setEstimatorFieldValue("wvTaxExemptInterestForFamilyCredit", taxData.wvTaxExemptInterestForFamilyCredit);
  setEstimatorFieldValue("wvFederalAMT", taxData.wvFederalAMT === true ? "yes" : taxData.wvFederalAMT === false ? "no" : "");
  setEstimatorFieldValue("wvHasChildDependentCareCredit", taxData.wvHasChildDependentCareCredit === true ? "yes" : taxData.wvHasChildDependentCareCredit === false ? "no" : "");
  setEstimatorFieldValue("wvFederalChildDependentCareCredit", taxData.wvFederalChildDependentCareCredit);
  setEstimatorFieldValue("wvHasOtherStateTaxCredit", taxData.wvHasOtherStateTaxCredit === true ? "yes" : taxData.wvHasOtherStateTaxCredit === false ? "no" : "");
  setEstimatorFieldValue("wvHasUseTax", taxData.wvHasUseTax === true ? "yes" : taxData.wvHasUseTax === false ? "no" : "");
  setEstimatorFieldValue("wvUseTax", taxData.wvUseTax);
  setEstimatorFieldValue("wvEstimatedAndExtensionPayments", taxData.wvEstimatedAndExtensionPayments);
  setEstimatorFieldValue("wvHasOtherSpecialItems", taxData.wvHasOtherSpecialItems === true ? "yes" : taxData.wvHasOtherSpecialItems === false ? "no" : "");
  refreshWestVirginiaStateVisibility();
}

function refreshWestVirginiaStateVisibility() {
  const container = document.getElementById("westVirginiaStateQuestions");
  if (!container) return;

  const isWV =
    String(document.getElementById("stateCode")?.value || "").toUpperCase() === "WV" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const filingStatus = getVal("filingStatus");
  const isMFJ = filingStatus === "mfj";
  const isQW = filingStatus === "qw";
  const hasChildCare = getVal("wvHasChildDependentCareCredit") === "yes";
  const hasUseTax = getVal("wvHasUseTax") === "yes";

  container.hidden = !isWV;

  const spouseRow = document.getElementById("westVirginiaSpouseExemptionRow");
  const survivingRow = document.getElementById("westVirginiaSurvivingSpouseRow");
  const childCareAmount = document.getElementById("westVirginiaChildCareAmountGroup");
  const useTaxRow = document.getElementById("westVirginiaUseTaxRow");
  if (spouseRow) spouseRow.hidden = !(isWV && isMFJ);
  if (survivingRow) survivingRow.hidden = !(isWV && isQW);
  if (childCareAmount) childCareAmount.hidden = !(isWV && hasChildCare);
  if (useTaxRow) useTaxRow.hidden = !(isWV && hasUseTax);

  [
    "wvFullYearResident", "wvTotalAdditions", "wvOtherSubtractions",
    "wvTaxableSocialSecurity", "wvTaxExemptInterestForFamilyCredit",
    "wvFederalAMT", "wvHasChildDependentCareCredit", "wvHasOtherStateTaxCredit",
    "wvHasUseTax", "wvHasOtherSpecialItems"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isWV;
  });

  const spouseDependent = document.getElementById("wvSpouseCanBeClaimedAsDependent");
  if (spouseDependent) spouseDependent.required = isWV && isMFJ;
  const surviving = document.getElementById("wvSurvivingSpouseExemption");
  if (surviving) surviving.required = isWV && isQW;
  const childCareCredit = document.getElementById("wvFederalChildDependentCareCredit");
  if (childCareCredit) childCareCredit.required = isWV && hasChildCare;
  const useTax = document.getElementById("wvUseTax");
  if (useTax) useTax.required = isWV && hasUseTax;

  if (!isWV) {
    [
      ["wvFullYearResident", ""], ["wvTotalAdditions", ""],
      ["wvOtherSubtractions", ""], ["wvTaxableSocialSecurity", ""],
      ["wvLowIncomeEarnedIncome", ""], ["wvSpouseCanBeClaimedAsDependent", ""],
      ["wvSurvivingSpouseExemption", ""], ["wvTaxExemptInterestForFamilyCredit", ""],
      ["wvFederalAMT", ""], ["wvHasChildDependentCareCredit", ""],
      ["wvFederalChildDependentCareCredit", "0"], ["wvHasOtherStateTaxCredit", ""],
      ["wvHasUseTax", ""], ["wvUseTax", "0"],
      ["wvEstimatedAndExtensionPayments", "0"], ["wvHasOtherSpecialItems", ""]
    ].forEach(([id, value]) => setEstimatorFieldValue(id, value));
    return;
  }

  if (!isMFJ) setEstimatorFieldValue("wvSpouseCanBeClaimedAsDependent", "");
  if (!isQW) setEstimatorFieldValue("wvSurvivingSpouseExemption", "");
  if (!hasChildCare) setEstimatorFieldValue("wvFederalChildDependentCareCredit", "0");
  if (!hasUseTax) setEstimatorFieldValue("wvUseTax", "0");
}

function restoreVirginiaStateFields(taxData = {}) {
  setEstimatorFieldValue("vaFullYearResident", taxData.vaFullYearResident === true ? "yes" : taxData.vaFullYearResident === false ? "no" : "");
  setEstimatorFieldValue("vaFederalItemized", taxData.vaFederalItemized === true ? "yes" : taxData.vaFederalItemized === false ? "no" : "");
  setEstimatorFieldValue("vaItemizedDeductions", taxData.vaItemizedDeductions);
  setEstimatorFieldValue("vaDependentEarnedIncome", taxData.vaDependentEarnedIncome);
  setEstimatorFieldValue("vaTotalAdditions", taxData.vaTotalAdditions);
  setEstimatorFieldValue("vaAgeDeduction", taxData.vaAgeDeduction);
  setEstimatorFieldValue("vaTaxableSocialSecurityTier1", taxData.vaTaxableSocialSecurityTier1);
  setEstimatorFieldValue("vaStateIncomeTaxRefund", taxData.vaStateIncomeTaxRefund);
  setEstimatorFieldValue("vaOtherSubtractions", taxData.vaOtherSubtractions);
  setEstimatorFieldValue("vaOtherDeductions", taxData.vaOtherDeductions);
  setEstimatorFieldValue("vaAge65OrOlderCount", taxData.vaAge65OrOlderCount);
  setEstimatorFieldValue("vaBlindCount", taxData.vaBlindCount);
  setEstimatorFieldValue("vaSpouseTaxAdjustment", taxData.vaSpouseTaxAdjustment);
  setEstimatorFieldValue("vaIncomeBasedCreditType", taxData.vaIncomeBasedCreditType);
  setEstimatorFieldValue("vaIncomeBasedCreditAmount", taxData.vaIncomeBasedCreditAmount);
  setEstimatorFieldValue("vaHasOtherStateTaxCredit", taxData.vaHasOtherStateTaxCredit === true ? "yes" : taxData.vaHasOtherStateTaxCredit === false ? "no" : "");
  setEstimatorFieldValue("vaHasUseTax", taxData.vaHasUseTax === true ? "yes" : taxData.vaHasUseTax === false ? "no" : "");
  setEstimatorFieldValue("vaUseTax", taxData.vaUseTax);
  setEstimatorFieldValue("vaEstimatedTaxPayments", taxData.vaEstimatedTaxPayments);
  setEstimatorFieldValue("vaPriorYearOverpaymentApplied", taxData.vaPriorYearOverpaymentApplied);
  setEstimatorFieldValue("vaExtensionPayment", taxData.vaExtensionPayment);
  setEstimatorFieldValue("vaOtherWithholding", taxData.vaOtherWithholding);
  setEstimatorFieldValue("vaHasOtherSpecialItems", taxData.vaHasOtherSpecialItems === true ? "yes" : taxData.vaHasOtherSpecialItems === false ? "no" : "");
  refreshVirginiaStateVisibility();
}

function refreshVirginiaStateVisibility() {
  const container = document.getElementById("virginiaStateQuestions");
  if (!container) return;

  const isVA =
    String(document.getElementById("stateCode")?.value || "").toUpperCase() === "VA" &&
    Number(document.getElementById("taxYear")?.value || 0) === 2025;
  const filingStatus = getVal("filingStatus");
  const canBeDependent =
    document.querySelector('input[name="canBeClaimedAsDependent"]:checked')?.value === "yes";
  const federalItemized = getVal("vaFederalItemized") === "yes";
  const creditType = getVal("vaIncomeBasedCreditType");
  const hasUseTax = getVal("vaHasUseTax") === "yes";
  const isMFJ = filingStatus === "mfj";

  container.hidden = !isVA;

  const itemizedRow = document.getElementById("virginiaItemizedRow");
  const dependentRow = document.getElementById("virginiaDependentEarnedIncomeRow");
  const spouseAdjustmentRow = document.getElementById("virginiaSpouseAdjustmentRow");
  const creditAmountGroup = document.getElementById("virginiaIncomeCreditAmountGroup");
  const useTaxRow = document.getElementById("virginiaUseTaxRow");

  if (itemizedRow) itemizedRow.hidden = !(isVA && federalItemized);
  if (dependentRow) dependentRow.hidden = !(isVA && !federalItemized && canBeDependent);
  if (spouseAdjustmentRow) spouseAdjustmentRow.hidden = !(isVA && isMFJ);
  if (creditAmountGroup) creditAmountGroup.hidden = !(isVA && creditType && creditType !== "none");
  if (useTaxRow) useTaxRow.hidden = !(isVA && hasUseTax);

  [
    "vaFullYearResident", "vaFederalItemized", "vaTotalAdditions",
    "vaAgeDeduction", "vaTaxableSocialSecurityTier1", "vaStateIncomeTaxRefund",
    "vaOtherSubtractions", "vaOtherDeductions", "vaAge65OrOlderCount",
    "vaBlindCount", "vaIncomeBasedCreditType", "vaHasOtherStateTaxCredit",
    "vaHasUseTax", "vaHasOtherSpecialItems"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isVA;
  });

  const itemizedAmount = document.getElementById("vaItemizedDeductions");
  if (itemizedAmount) itemizedAmount.required = isVA && federalItemized;
  const dependentEarned = document.getElementById("vaDependentEarnedIncome");
  if (dependentEarned) dependentEarned.required = isVA && !federalItemized && canBeDependent;
  const spouseAdjustment = document.getElementById("vaSpouseTaxAdjustment");
  if (spouseAdjustment) spouseAdjustment.required = isVA && isMFJ;
  const creditAmount = document.getElementById("vaIncomeBasedCreditAmount");
  if (creditAmount) creditAmount.required = isVA && creditType !== "" && creditType !== "none";
  const useTax = document.getElementById("vaUseTax");
  if (useTax) useTax.required = isVA && hasUseTax;

  if (!isVA) {
    [
      ["vaFullYearResident", ""], ["vaFederalItemized", ""],
      ["vaItemizedDeductions", ""], ["vaDependentEarnedIncome", ""],
      ["vaTotalAdditions", ""], ["vaAgeDeduction", ""],
      ["vaTaxableSocialSecurityTier1", ""], ["vaStateIncomeTaxRefund", ""],
      ["vaOtherSubtractions", ""], ["vaOtherDeductions", ""],
      ["vaAge65OrOlderCount", ""], ["vaBlindCount", ""],
      ["vaSpouseTaxAdjustment", ""], ["vaIncomeBasedCreditType", ""],
      ["vaIncomeBasedCreditAmount", "0"], ["vaHasOtherStateTaxCredit", ""],
      ["vaHasUseTax", ""], ["vaUseTax", "0"], ["vaEstimatedTaxPayments", "0"],
      ["vaPriorYearOverpaymentApplied", "0"], ["vaExtensionPayment", "0"],
      ["vaOtherWithholding", "0"], ["vaHasOtherSpecialItems", ""]
    ].forEach(([id, value]) => setEstimatorFieldValue(id, value));
    return;
  }

  if (!federalItemized) setEstimatorFieldValue("vaItemizedDeductions", "");
  if (federalItemized || !canBeDependent) setEstimatorFieldValue("vaDependentEarnedIncome", "");
  if (!isMFJ) setEstimatorFieldValue("vaSpouseTaxAdjustment", "");
  if (!creditType || creditType === "none") setEstimatorFieldValue("vaIncomeBasedCreditAmount", "0");
  if (!hasUseTax) setEstimatorFieldValue("vaUseTax", "0");
}

function restoreSouthCarolinaStateFields(taxData = {}) {
  setEstimatorFieldValue("scFullYearResident", taxData.scFullYearResident === true ? "yes" : taxData.scFullYearResident === false ? "no" : "");
  setEstimatorFieldValue("scTotalAdditions", taxData.scTotalAdditions);
  setEstimatorFieldValue("scOtherSubtractions", taxData.scOtherSubtractions);
  setEstimatorFieldValue("scDependentsUnder6", taxData.scDependentsUnder6);
  setEstimatorFieldValue("scHasChildDependentCareCredit", taxData.scHasChildDependentCareCredit === true ? "yes" : taxData.scHasChildDependentCareCredit === false ? "no" : "");
  setEstimatorFieldValue("scFederalChildCareExpense", taxData.scFederalChildCareExpense);
  setEstimatorFieldValue("scChildCareQualifyingPersons", taxData.scChildCareQualifyingPersons);
  setEstimatorFieldValue("scHasTwoWageEarnerCredit", taxData.scHasTwoWageEarnerCredit === true ? "yes" : taxData.scHasTwoWageEarnerCredit === false ? "no" : "");
  setEstimatorFieldValue("scTaxpayerQualifiedEarnedIncome", taxData.scTaxpayerQualifiedEarnedIncome);
  setEstimatorFieldValue("scSpouseQualifiedEarnedIncome", taxData.scSpouseQualifiedEarnedIncome);
  setEstimatorFieldValue("scClaimedFederalEIC", taxData.scClaimedFederalEIC === true ? "yes" : taxData.scClaimedFederalEIC === false ? "no" : "");
  setEstimatorFieldValue("scFederalEICAmount", taxData.scFederalEICAmount);
  setEstimatorFieldValue("scHasOtherStateTaxCredit", taxData.scHasOtherStateTaxCredit === true ? "yes" : taxData.scHasOtherStateTaxCredit === false ? "no" : "");
  setEstimatorFieldValue("scHasUseTax", taxData.scHasUseTax === true ? "yes" : taxData.scHasUseTax === false ? "no" : "");
  setEstimatorFieldValue("scUseTax", taxData.scUseTax);
  setEstimatorFieldValue("scEstimatedTaxPayments", taxData.scEstimatedTaxPayments);
  setEstimatorFieldValue("scExtensionPayment", taxData.scExtensionPayment);
  setEstimatorFieldValue("scOtherWithholding", taxData.scOtherWithholding);
  setEstimatorFieldValue("scHasOtherSpecialItems", taxData.scHasOtherSpecialItems === true ? "yes" : taxData.scHasOtherSpecialItems === false ? "no" : "");
  refreshSouthCarolinaStateVisibility();
}

function refreshSouthCarolinaStateVisibility() {
  const container = document.getElementById("southCarolinaStateQuestions");
  if (!container) return;

  const isSC = String(document.getElementById("stateCode")?.value || "").toUpperCase() === "SC";
  const filingStatus = getVal("filingStatus");
  const dependentCount = parseInt(getVal("numberOfDependents"), 10) || 0;
  container.hidden = !isSC;

  const under6Row = document.getElementById("southCarolinaUnder6Row");
  const childCareRow = document.getElementById("southCarolinaChildCareRow");
  const twoWageQuestion = document.getElementById("southCarolinaTwoWageQuestion");
  const twoWageRow = document.getElementById("southCarolinaTwoWageRow");
  const eicRow = document.getElementById("southCarolinaEicRow");
  const useTaxRow = document.getElementById("southCarolinaUseTaxRow");

  const hasChildCare = isSC && getVal("scHasChildDependentCareCredit") === "yes";
  const isMFJ = isSC && filingStatus === "mfj";
  const hasTwoWage = isMFJ && getVal("scHasTwoWageEarnerCredit") === "yes";
  const hasEic = isSC && getVal("scClaimedFederalEIC") === "yes";
  const hasUseTax = isSC && getVal("scHasUseTax") === "yes";

  if (under6Row) under6Row.hidden = !(isSC && dependentCount > 0);
  if (childCareRow) childCareRow.hidden = !hasChildCare;
  if (twoWageQuestion) twoWageQuestion.hidden = !isMFJ;
  if (twoWageRow) twoWageRow.hidden = !hasTwoWage;
  if (eicRow) eicRow.hidden = !hasEic;
  if (useTaxRow) useTaxRow.hidden = !hasUseTax;

  [
    "scFullYearResident", "scTotalAdditions", "scOtherSubtractions",
    "scHasChildDependentCareCredit", "scClaimedFederalEIC",
    "scHasOtherStateTaxCredit", "scHasUseTax", "scHasOtherSpecialItems"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.required = isSC;
  });

  const depUnder6 = document.getElementById("scDependentsUnder6");
  if (depUnder6) depUnder6.required = isSC && dependentCount > 0;
  ["scFederalChildCareExpense", "scChildCareQualifyingPersons"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.required = hasChildCare;
  });
  const twoWageSelect = document.getElementById("scHasTwoWageEarnerCredit");
  if (twoWageSelect) twoWageSelect.required = isMFJ;
  ["scTaxpayerQualifiedEarnedIncome", "scSpouseQualifiedEarnedIncome"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.required = hasTwoWage;
  });
  const eicAmount = document.getElementById("scFederalEICAmount");
  if (eicAmount) eicAmount.required = hasEic;
  const useTax = document.getElementById("scUseTax");
  if (useTax) useTax.required = hasUseTax;

  if (!isSC) {
    [
      ["scFullYearResident", ""], ["scTotalAdditions", ""], ["scOtherSubtractions", ""],
      ["scDependentsUnder6", ""], ["scHasChildDependentCareCredit", ""],
      ["scFederalChildCareExpense", ""], ["scChildCareQualifyingPersons", ""],
      ["scHasTwoWageEarnerCredit", ""], ["scTaxpayerQualifiedEarnedIncome", ""],
      ["scSpouseQualifiedEarnedIncome", ""], ["scClaimedFederalEIC", ""],
      ["scFederalEICAmount", ""], ["scHasOtherStateTaxCredit", ""],
      ["scHasUseTax", ""], ["scUseTax", ""], ["scEstimatedTaxPayments", "0"],
      ["scExtensionPayment", "0"], ["scOtherWithholding", "0"],
      ["scHasOtherSpecialItems", ""]
    ].forEach(([id, value]) => setEstimatorFieldValue(id, value));
  } else {
    if (dependentCount <= 0) setEstimatorFieldValue("scDependentsUnder6", "");
    if (!hasChildCare) {
      setEstimatorFieldValue("scFederalChildCareExpense", "");
      setEstimatorFieldValue("scChildCareQualifyingPersons", "");
    }
    if (!isMFJ) setEstimatorFieldValue("scHasTwoWageEarnerCredit", "");
    if (!hasTwoWage) {
      setEstimatorFieldValue("scTaxpayerQualifiedEarnedIncome", "");
      setEstimatorFieldValue("scSpouseQualifiedEarnedIncome", "");
    }
    if (!hasEic) setEstimatorFieldValue("scFederalEICAmount", "");
    if (!hasUseTax) setEstimatorFieldValue("scUseTax", "");
  }
}

function refreshOklahomaStateVisibility() {
  const stateCode = String(
    document.getElementById("stateCode")?.value || ""
  ).toUpperCase();
  const filingStatus = document.getElementById("filingStatus")?.value || "";
  const container = document.getElementById("oklahomaStateQuestions");
  if (!container) return;

  const show = stateCode === "OK";
  const showMarriedSpouse = show && (filingStatus === "mfj" || filingStatus === "mfs");
  const federalItemized = document.getElementById("okFederalItemized")?.value || "";
  const showItemized = show && federalItemized === "yes";
  const childCredit = document.getElementById("okHasFederalChildOrCareCredit")?.value || "";
  const showChildCredit = show && childCredit === "yes";
  const eic = document.getElementById("okHasOklahomaEIC")?.value || "";
  const showEic = show && eic === "yes";

  container.hidden = !show;
  const spouseField = document.getElementById("oklahomaNonresidentSpouseField");
  const itemizedRow = document.getElementById("oklahomaItemizedRow");
  const childRow = document.getElementById("oklahomaChildCreditRow");
  const eicRow = document.getElementById("oklahomaEicRow");
  if (spouseField) spouseField.hidden = !showMarriedSpouse;
  if (itemizedRow) itemizedRow.hidden = !showItemized;
  if (childRow) childRow.hidden = !showChildCredit;
  if (eicRow) eicRow.hidden = !showEic;

  [
    "okFullYearResident",
    "okHasOutOfStatePropertyBusinessIncome",
    "okOklahomaAGI",
    "okOklahomaIncomeAfterAdjustments",
    "okFederalItemized",
    "okRegularExemptions",
    "okSpecial65Exemptions",
    "okBlindExemptions",
    "okQualifyingDependents",
    "okHasFederalChildOrCareCredit",
    "okHasOklahomaEIC",
    "okHasOtherSpecialItems",
  ].forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.required = show;
  });

  const spouseSelect = document.getElementById("okHasNonresidentSpouseAllocation");
  const itemizedInput = document.getElementById("okItemizedDeductions");
  const eicInput = document.getElementById("okFederalEIC2020Law");
  if (spouseSelect) spouseSelect.required = showMarriedSpouse;
  if (itemizedInput) itemizedInput.required = showItemized;
  if (eicInput) eicInput.required = showEic;

  if (!show) {
    [
      ["okFullYearResident", ""],
      ["okHasNonresidentSpouseAllocation", ""],
      ["okHasOutOfStatePropertyBusinessIncome", ""],
      ["okOklahomaAGI", ""],
      ["okOklahomaIncomeAfterAdjustments", ""],
      ["okFederalItemized", ""],
      ["okItemizedDeductions", ""],
      ["okRegularExemptions", ""],
      ["okSpecial65Exemptions", ""],
      ["okBlindExemptions", ""],
      ["okQualifyingDependents", ""],
      ["okHasFederalChildOrCareCredit", ""],
      ["okFederalChildCareCredit", "0"],
      ["okFederalChildTaxCreditTotal", "0"],
      ["okHasOklahomaEIC", ""],
      ["okFederalEIC2020Law", "0"],
      ["okUseTax", "0"],
      ["okEstimatedTaxPayments", "0"],
      ["okExtensionPayment", "0"],
      ["okHasOtherSpecialItems", ""],
    ].forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (field) {
        field.value = value;
        field.classList.remove("error-field");
      }
    });
    return;
  }

  if (!showMarriedSpouse && spouseSelect) spouseSelect.value = "";
  if (!showItemized && itemizedInput) itemizedInput.value = "";
  if (!showChildCredit) {
    const care = document.getElementById("okFederalChildCareCredit");
    const ctc = document.getElementById("okFederalChildTaxCreditTotal");
    if (care) care.value = "0";
    if (ctc) ctc.value = "0";
  }
  if (!showEic && eicInput) eicInput.value = "0";
}

function refreshArkansasStateVisibility() {
  const stateCode = String(
    document.getElementById("stateCode")?.value || ""
  ).toUpperCase();
  const filingStatus =
    document.getElementById("filingStatus")?.value || "";
  const container =
    document.getElementById("arkansasStateQuestions");
  if (!container) return;

  const show = stateCode === "AR";
  const showMfs = show && filingStatus === "mfs";
  const mfsSameReturn =
    document.getElementById("arMfsSameReturn")?.value || "";
  const showMfsSpouseItemizes =
    showMfs && mfsSameReturn === "no";
  const showSurvivingSpouse =
    show && filingStatus === "qw";

  const mfsRow = document.getElementById("arkansasMfsRow");
  const mfsSpouseField = document.getElementById("arkansasMfsSpouseItemizesField");
  const survivingRow = document.getElementById("arkansasSurvivingSpouseRow");

  container.hidden = !show;
  if (mfsRow) mfsRow.hidden = !showMfs;
  if (mfsSpouseField) mfsSpouseField.hidden = !showMfsSpouseItemizes;
  if (survivingRow) survivingRow.hidden = !showSurvivingSpouse;

  const requiredIds = [
    "arFullYearResident",
    "arArkansasTotalIncome",
    "arArkansasAGI",
    "arQualifyingDependents",
    "arHasOtherSpecialItems",
  ];
  requiredIds.forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.required = show;
  });

  const mfsSameField = document.getElementById("arMfsSameReturn");
  const mfsSpouseItemizesField = document.getElementById("arMfsSpouseItemizes");
  const survivingField = document.getElementById("arSurvivingSpouseConfirmed");
  if (mfsSameField) mfsSameField.required = showMfs;
  if (mfsSpouseItemizesField) {
    mfsSpouseItemizesField.required = showMfsSpouseItemizes;
  }
  if (survivingField) survivingField.required = showSurvivingSpouse;

  if (!show) {
    [
      ["arFullYearResident", ""],
      ["arArkansasTotalIncome", ""],
      ["arArkansasAGI", ""],
      ["arItemizedDeductions", "0"],
      ["arQualifyingDependents", "0"],
      ["arAdditionalPersonalCreditBoxes", "0"],
      ["arMfsSameReturn", ""],
      ["arMfsSpouseItemizes", ""],
      ["arSurvivingSpouseConfirmed", ""],
      ["arEstimatedTaxPayments", "0"],
      ["arExtensionPayment", "0"],
      ["arHasOtherSpecialItems", ""],
    ].forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (field) {
        field.value = value;
        field.classList.remove("error-field");
      }
    });
    return;
  }

  if (!showMfs) {
    if (mfsSameField) mfsSameField.value = "";
    if (mfsSpouseItemizesField) mfsSpouseItemizesField.value = "";
  } else if (!showMfsSpouseItemizes && mfsSpouseItemizesField) {
    mfsSpouseItemizesField.value = "";
  }

  if (!showSurvivingSpouse && survivingField) {
    survivingField.value = "";
  }
}

function refreshLouisianaStateVisibility() {
  const stateCode =
    String(
      document.getElementById("stateCode")?.value ||
      ""
    ).toUpperCase();

  const container =
    document.getElementById("louisianaStateQuestions");
  if (!container) return;

  const show = stateCode === "LA";
  const federalReturnValue =
    document.getElementById("laFederalReturnRequired")?.value ||
    "";
  const showFederalDetails =
    show && federalReturnValue === "yes";
  const usesScheduleE =
    document.getElementById("laUsesScheduleE")?.value === "yes";
  const federalItemized =
    document.getElementById("laFederalItemized")?.value === "yes";
  const claimedEIC =
    document.getElementById("laClaimedFederalEIC")?.value === "yes";

  const federalDetails =
    document.getElementById("louisianaFederalReturnDetails");
  const scheduleERow =
    document.getElementById("louisianaScheduleERow");
  const medicalRow =
    document.getElementById("louisianaMedicalRow");
  const eicRow =
    document.getElementById("louisianaEICRow");

  container.hidden = !show;
  if (federalDetails) federalDetails.hidden = !showFederalDetails;
  if (scheduleERow) scheduleERow.hidden = !(showFederalDetails && usesScheduleE);
  if (medicalRow) medicalRow.hidden = !(showFederalDetails && federalItemized);
  if (eicRow) eicRow.hidden = !(showFederalDetails && claimedEIC);

  const residentField = document.getElementById("laFullYearResident");
  const federalReturnField = document.getElementById("laFederalReturnRequired");
  const scheduleEScreen = document.getElementById("laUsesScheduleE");
  const scheduleEAmount = document.getElementById("laScheduleEAdjustedGrossIncome");
  const itemizedScreen = document.getElementById("laFederalItemized");
  const medicalAmount = document.getElementById("laFederalMedicalDentalDeduction");
  const eicScreen = document.getElementById("laClaimedFederalEIC");
  const eicAmount = document.getElementById("laFederalEICAmount");
  const specialField = document.getElementById("laHasOtherSpecialItems");

  if (residentField) residentField.required = show;
  if (federalReturnField) federalReturnField.required = show;
  if (scheduleEScreen) scheduleEScreen.required = showFederalDetails;
  if (scheduleEAmount) scheduleEAmount.required = showFederalDetails && usesScheduleE;
  if (itemizedScreen) itemizedScreen.required = showFederalDetails;
  if (medicalAmount) medicalAmount.required = showFederalDetails && federalItemized;
  if (eicScreen) eicScreen.required = showFederalDetails;
  if (eicAmount) eicAmount.required = showFederalDetails && claimedEIC;
  if (specialField) specialField.required = show;

  if (!show) {
    [
      ["laFullYearResident", ""],
      ["laFederalReturnRequired", ""],
      ["laUsesScheduleE", ""],
      ["laScheduleEAdjustedGrossIncome", ""],
      ["laFederalItemized", ""],
      ["laFederalMedicalDentalDeduction", ""],
      ["laClaimedFederalEIC", ""],
      ["laFederalEICAmount", ""],
      ["laEstimatedTaxPayments", "0"],
      ["laExtensionPayment", "0"],
      ["laHasOtherSpecialItems", ""],
    ].forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (field) {
        field.value = value;
        field.classList.remove("error-field");
      }
    });
    return;
  }

  if (!showFederalDetails) {
    [
      ["laUsesScheduleE", ""],
      ["laScheduleEAdjustedGrossIncome", ""],
      ["laFederalItemized", ""],
      ["laFederalMedicalDentalDeduction", ""],
      ["laClaimedFederalEIC", ""],
      ["laFederalEICAmount", ""],
    ].forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (field) {
        field.value = value;
        field.classList.remove("error-field");
      }
    });
    return;
  }

  if (!usesScheduleE && scheduleEAmount) {
    scheduleEAmount.value = "";
  }
  if (!federalItemized && medicalAmount) {
    medicalAmount.value = "";
  }
  if (!claimedEIC && eicAmount) {
    eicAmount.value = "";
  }
}

function refreshMississippiStateVisibility() {
  const stateCode =
    String(
      document.getElementById("stateCode")?.value ||
      ""
    ).toUpperCase();

  const filingStatus =
    document.getElementById("filingStatus")?.value ||
    "";

  const container =
    document.getElementById("mississippiStateQuestions");
  const spouseBlind =
    document.getElementById("mississippiSpouseBlindField");
  const spouseIncome =
    document.getElementById("mississippiSpouseIncomeRow");
  const headOfFamily =
    document.getElementById("mississippiHeadOfFamilyRow");

  if (!container) return;

  const show =
    stateCode === "MS";
  const showSpouse =
    show && filingStatus === "mfj";
  const showHead =
    show && filingStatus === "hoh";

  container.hidden = !show;

  if (spouseBlind) {
    spouseBlind.hidden = !showSpouse;
  }

  if (spouseIncome) {
    spouseIncome.hidden = !showSpouse;
  }

  if (headOfFamily) {
    headOfFamily.hidden = !showHead;
  }

  if (!show) {
    [
      ["msItemizedDeductions", "0"],
      ["msExemptRetirementIncome", "0"],
      ["msTaxpayerBlind", "no"],
      ["msSpouseBlind", "no"],
      ["msSpouseShareOfMississippiAGI", ""],
      ["msHeadOfFamilyDependentLivedAllYear", ""],
      ["msHasDependentCareCredit", "no"],
      ["msHasOtherStateModifications", ""],
    ].forEach(([id, value]) => {
      const field =
        document.getElementById(id);
      if (field) {
        field.value = value;
        field.classList.remove("error-field");
      }
    });
  } else {
    if (!showSpouse) {
      const spouseBlindField =
        document.getElementById("msSpouseBlind");
      const spouseIncomeField =
        document.getElementById("msSpouseShareOfMississippiAGI");

      if (spouseBlindField) {
        spouseBlindField.value = "no";
      }

      if (spouseIncomeField) {
        spouseIncomeField.value = "";
      }
    }

    if (!showHead) {
      const headField =
        document.getElementById("msHeadOfFamilyDependentLivedAllYear");

      if (headField) {
        headField.value = "";
      }
    }
  }
}

function refreshKentuckyStateVisibility() {
  const stateCode =
    String(
      document.getElementById("stateCode")?.value ||
      ""
    ).toUpperCase();

  const filingStatus =
    document.getElementById("filingStatus")?.value ||
    "";

  const container =
    document.getElementById("kentuckyStateQuestions");
  const spouseRetirement =
    document.getElementById("kentuckySpouseRetirementField");
  const spouseCreditRow =
    document.getElementById("kentuckySpouseCreditRow");

  if (!container) return;

  const show =
    stateCode === "KY";
  const showSpouse =
    show && filingStatus === "mfj";

  container.hidden = !show;

  if (spouseRetirement) {
    spouseRetirement.hidden = !showSpouse;
  }

  if (spouseCreditRow) {
    spouseCreditRow.hidden = !showSpouse;
  }

  if (!show) {
    [
      ["kyFamilySize", ""],
      ["kyItemizedDeductions", "0"],
      ["kyTaxpayerRetirementIncome", "0"],
      ["kySpouseRetirementIncome", "0"],
      ["kySpecialPensionOverLimit", ""],
      ["kyHasOtherStateModifications", ""],
      ["kyHasChildDependentCareCredit", ""],
      ["kyTaxpayerSpecialPersonalCredit", "0"],
      ["kySpouseSpecialPersonalCredit", "0"],
    ].forEach(([id, value]) => {
      const field =
        document.getElementById(id);
      if (field) {
        field.value = value;
        field.classList.remove("error-field");
      }
    });
  } else if (!showSpouse) {
    const spouseRetirementField =
      document.getElementById("kySpouseRetirementIncome");
    const spouseCreditField =
      document.getElementById("kySpouseSpecialPersonalCredit");

    if (spouseRetirementField) {
      spouseRetirementField.value = "0";
    }

    if (spouseCreditField) {
      spouseCreditField.value = "0";
    }
  }
}

function refreshGeorgiaDependentVisibility() {
  const stateCode =
    String(
      document.getElementById("stateCode")?.value ||
      ""
    ).toUpperCase();

  const row =
    document.getElementById("georgiaDependentRow");
  const field =
    document.getElementById("gaUnbornDependents");

  if (!row || !field) return;

  const show =
    stateCode === "GA";

  row.hidden = !show;

  if (!show) {
    field.value = "0";
    field.classList.remove("error-field");
  }
}

function refreshNorthCarolinaMfsVisibility() {
  const stateCode =
    String(
      document.getElementById("stateCode")?.value ||
      ""
    ).toUpperCase();

  const filingStatus =
    document.getElementById("filingStatus")?.value ||
    "";

  const row =
    document.getElementById("northCarolinaMfsRow");
  const field =
    document.getElementById("ncSpouseItemizes");

  if (!row || !field) return;

  const show =
    stateCode === "NC" &&
    filingStatus === "mfs";

  row.hidden = !show;
  field.required = show;

  if (!show) {
    field.value = "";
    field.classList.remove("error-field");
  }
}

function refreshArizonaDependentAgeVisibility() {
  const stateCode = document.getElementById("stateCode");
  const dependents = document.getElementById("numberOfDependents");
  const row = document.getElementById("arizonaDependentAgeRow");
  const field = document.getElementById("dependentsUnder17");

  if (!stateCode || !dependents || !row || !field) return;

  const show =
    String(stateCode.value || "").toUpperCase() === "AZ" &&
    Number(dependents.value || 0) > 0;

  row.hidden = !show;
  field.required = show;

  if (!show) {
    field.value = "";
    field.classList.remove("error-field");
  }
}

function refreshBusinessMileageVisibility() {
  const taxYear = Number(
    document.getElementById("taxYear")?.value || 0
  );
  const annualRow =
    document.getElementById("businessMileageAnnualRow");
  const splitRow =
    document.getElementById("businessMileageSplitRow");
  const annualField =
    document.getElementById("businessMileage");
  const firstHalfField =
    document.getElementById("businessMileageJanJun");
  const secondHalfField =
    document.getElementById("businessMileageJulDec");
  const note =
    document.getElementById("splitMileageRateNote");

  if (
    !annualRow ||
    !splitRow ||
    !annualField ||
    !firstHalfField ||
    !secondHalfField
  ) {
    return;
  }

  const splitYear =
    taxYear === 2022 ||
    taxYear === 2026;

  annualRow.hidden = splitYear;
  splitRow.hidden = !splitYear;

  if (splitYear) {
    annualField.value = "";
    annualField.classList.remove("error-field");

    if (note) {
      note.textContent =
        taxYear === 2022
          ? "2022 IRS business mileage rates: 58.5¢ per mile Jan.–June and 62.5¢ per mile July–December."
          : "2026 IRS business mileage rates: 72.5¢ per mile Jan.–June and 76¢ per mile July–December.";
    }
  } else {
    firstHalfField.value = "";
    secondHalfField.value = "";
    firstHalfField.classList.remove("error-field");
    secondHalfField.classList.remove("error-field");
  }
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
  const numVal = (id) =>
    currencyNumberValue(getVal(id));
  // State-specific audited fields added in recent phases use getNum; keep the
  // helper local to readForm so every state path resolves consistently.
  const getNum = (id) =>
    currencyNumberValue(getVal(id));
  const getSignedNum = (id) =>
    signedCurrencyNumberValue(getVal(id));

  const optionalMoneyVal = (id) => {
    const raw = String(getVal(id) || "").trim();
    return raw === ""
      ? null
      : Math.round(currencyNumberValue(raw));
  };

  const roundTaxDollar = (value) =>
    Math.round(
      currencyNumberValue(value)
    );

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

  const sumCurrencyValues = (values) =>
    values.reduce(
      (totalCents, value) =>
        totalCents +
        Math.round(
          currencyNumberValue(value) * 100
        ),
      0
    ) / 100;

  const categoryTotal = (categories) =>
    sumCurrencyValues(
      Object.values(categories)
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

  const totalSelfEmploymentIncome = sumCurrencyValues(
    selfEmploymentStreams.map(
      (stream) => stream.income
    )
  );

  const totalBusinessExpenses = sumCurrencyValues(
    selfEmploymentStreams.map(
      (stream) => stream.expenses
    )
  );

  return {
    taxYear: parseInt(getVal("taxYear"), 10) || 2024,
    filingStatus: getVal("filingStatus"),
    age: parseInt(getVal("age"), 10) || 0,
    spouseAge: getVal("spouseAge")
      ? parseInt(getVal("spouseAge"), 10) || 0
      : null,
    isFullTimeStudent: getRadio("isFullTimeStudent") === "yes",
    canBeClaimedAsDependent: getRadio("canBeClaimedAsDependent") === "yes",
    stateCode: getVal("stateCode"),
    numberOfDependents: parseInt(getVal("numberOfDependents"), 10) || 0,
    ctcQualifyingChildren:
      parseInt(getVal("ctcQualifyingChildren"), 10) || 0,
    dependentsUnder17:
      getVal("dependentsUnder17") === ""
        ? null
        : parseInt(getVal("dependentsUnder17"), 10) || 0,
    alFullYearResident:
      getVal("alFullYearResident") === ""
        ? null
        : getVal("alFullYearResident") === "yes",
    alHeadOfFamilyConfirmed:
      getVal("alHeadOfFamilyConfirmed") === ""
        ? null
        : getVal("alHeadOfFamilyConfirmed") === "yes",
    alQualifyingDependents:
      getVal("alQualifyingDependents") === ""
        ? null
        : parseInt(getVal("alQualifyingDependents"), 10) || 0,
    alItemizedDeductions:
      roundTaxDollar(numVal("alItemizedDeductions")),
    alExemptIncome:
      roundTaxDollar(numVal("alExemptIncome")),
    alFederalIncomeTaxDeduction:
      getVal("alFederalIncomeTaxDeduction") === ""
        ? null
        : roundTaxDollar(numVal("alFederalIncomeTaxDeduction")),
    alEstimatedTaxPayments:
      roundTaxDollar(numVal("alEstimatedTaxPayments")),
    alHasSpecialItems:
      getVal("alHasSpecialItems") === ""
        ? null
        : getVal("alHasSpecialItems") === "yes",
    inFullYearResident: getVal("inFullYearResident") === "" ? null : getVal("inFullYearResident") === "yes",
    inTotalAddbacks: getVal("inTotalAddbacks") === "" ? null : getNum("inTotalAddbacks"),
    inTotalDeductions: getVal("inTotalDeductions") === "" ? null : getNum("inTotalDeductions"),
    inAdditionalDependentChildCount: getVal("inAdditionalDependentChildCount") === "" ? null : getNum("inAdditionalDependentChildCount"),
    inFirstYearAdditionalChildCount: getVal("inFirstYearAdditionalChildCount") === "" ? null : getNum("inFirstYearAdditionalChildCount"),
    inAdoptedDependentCount: getVal("inAdoptedDependentCount") === "" ? null : getNum("inAdoptedDependentCount"),
    inTaxpayerBlind: getVal("inTaxpayerBlind") === "" ? null : getVal("inTaxpayerBlind") === "yes",
    inSpouseBlind: getVal("inSpouseBlind") === "" ? null : getVal("inSpouseBlind") === "yes",
    inCountyTax: getVal("inCountyTax") === "" ? null : getNum("inCountyTax"),
    inCountyWithheld: getVal("inCountyWithheld") === "" ? null : getNum("inCountyWithheld"),
    inClaimedFederalEIC: getVal("inClaimedFederalEIC") === "" ? null : getVal("inClaimedFederalEIC") === "yes",
    inFederalEICAmount: getNum("inFederalEICAmount"),
    inHasUseTax: getVal("inHasUseTax") === "" ? null : getVal("inHasUseTax") === "yes",
    inUseTax: getNum("inUseTax"),
    inEstimatedAndExtensionPayments: getNum("inEstimatedAndExtensionPayments"),
    inHasUnifiedTaxCreditForElderly: getVal("inHasUnifiedTaxCreditForElderly") === "" ? null : getVal("inHasUnifiedTaxCreditForElderly") === "yes",
    inHasOtherCredits: getVal("inHasOtherCredits") === "" ? null : getVal("inHasOtherCredits") === "yes",
    inHasOtherTaxesOrSpecialItems: getVal("inHasOtherTaxesOrSpecialItems") === "" ? null : getVal("inHasOtherTaxesOrSpecialItems") === "yes",

    ilFullYearResident: getVal("ilFullYearResident") === "" ? null : getVal("ilFullYearResident") === "yes",
    ilTotalAdditions: getVal("ilTotalAdditions") === "" ? null : getNum("ilTotalAdditions"),
    ilRetirementSocialSecuritySubtraction: getVal("ilRetirementSocialSecuritySubtraction") === "" ? null : getNum("ilRetirementSocialSecuritySubtraction"),
    ilIllinoisIncomeTaxOverpaymentSubtraction: getVal("ilIllinoisIncomeTaxOverpaymentSubtraction") === "" ? null : getNum("ilIllinoisIncomeTaxOverpaymentSubtraction"),
    ilOtherSubtractions: getVal("ilOtherSubtractions") === "" ? null : getNum("ilOtherSubtractions"),
    ilSpouseCanBeClaimedAsDependent: getVal("ilSpouseCanBeClaimedAsDependent") === "" ? null : getVal("ilSpouseCanBeClaimedAsDependent") === "yes",
    ilTaxpayerBlind: getVal("ilTaxpayerBlind") === "" ? null : getVal("ilTaxpayerBlind") === "yes",
    ilSpouseBlind: getVal("ilSpouseBlind") === "" ? null : getVal("ilSpouseBlind") === "yes",
    ilInvestmentCreditRecapture: getVal("ilInvestmentCreditRecapture") === "" ? null : getNum("ilInvestmentCreditRecapture"),
    ilScheduleICRCredit: getVal("ilScheduleICRCredit") === "" ? null : getNum("ilScheduleICRCredit"),
    ilSchedule1299CCredit: getVal("ilSchedule1299CCredit") === "" ? null : getNum("ilSchedule1299CCredit"),
    ilHasOtherStateTaxCredit: getVal("ilHasOtherStateTaxCredit") === "" ? null : getVal("ilHasOtherStateTaxCredit") === "yes",
    ilHouseholdEmploymentTax: getVal("ilHouseholdEmploymentTax") === "" ? null : getNum("ilHouseholdEmploymentTax"),
    ilUseTax: getVal("ilUseTax") === "" ? null : getNum("ilUseTax"),
    ilHasCannabisGamingSurcharge: getVal("ilHasCannabisGamingSurcharge") === "" ? null : getVal("ilHasCannabisGamingSurcharge") === "yes",
    ilEstimatedPayments: getVal("ilEstimatedPayments") === "" ? null : getNum("ilEstimatedPayments"),
    ilPassThroughWithholding: getVal("ilPassThroughWithholding") === "" ? null : getNum("ilPassThroughWithholding"),
    ilPassThroughEntityTaxCredit: getVal("ilPassThroughEntityTaxCredit") === "" ? null : getNum("ilPassThroughEntityTaxCredit"),
    ilClaimedFederalEITC: getVal("ilClaimedFederalEITC") === "" ? null : getVal("ilClaimedFederalEITC") === "yes",
    ilFederalEITCAmount: getNum("ilFederalEITCAmount"),
    ilHasDependentChildUnder12: getVal("ilHasDependentChildUnder12") === "" ? null : getVal("ilHasDependentChildUnder12") === "yes",
    ilNeedsExpandedEITCWorksheet: getVal("ilNeedsExpandedEITCWorksheet") === "" ? null : getVal("ilNeedsExpandedEITCWorksheet") === "yes",
    ilHasOtherSpecialItems: getVal("ilHasOtherSpecialItems") === "" ? null : getVal("ilHasOtherSpecialItems") === "yes",

    moFullYearResident: getVal("moFullYearResident") === "" ? null : getVal("moFullYearResident") === "yes",
    moTotalAdditions: getVal("moTotalAdditions") === "" ? null : getNum("moTotalAdditions"),
    moTotalSubtractions: getVal("moTotalSubtractions") === "" ? null : getNum("moTotalSubtractions"),
    moPrimaryAdjustedGrossIncome: getVal("moPrimaryAdjustedGrossIncome") === "" ? null : getNum("moPrimaryAdjustedGrossIncome"),
    moSpouseAdjustedGrossIncome: getVal("moSpouseAdjustedGrossIncome") === "" ? null : getNum("moSpouseAdjustedGrossIncome"),
    moPensionSocialSecurityExemption: getVal("moPensionSocialSecurityExemption") === "" ? null : getNum("moPensionSocialSecurityExemption"),
    moFederalIncomeTaxDeduction: getVal("moFederalIncomeTaxDeduction") === "" ? null : getNum("moFederalIncomeTaxDeduction"),
    moDeductionChoice: getVal("moDeductionChoice"),
    moItemizedDeductions: getVal("moItemizedDeductions") === "" ? null : getNum("moItemizedDeductions"),
    moDependentEarnedIncome: getVal("moDependentEarnedIncome") === "" ? null : getNum("moDependentEarnedIncome"),
    moTaxpayerBlind: getVal("moTaxpayerBlind") === "" ? null : getVal("moTaxpayerBlind") === "yes",
    moSpouseBlind: getVal("moSpouseBlind") === "" ? null : getVal("moSpouseBlind") === "yes",
    moFederallyRequiredToItemize: getVal("moFederallyRequiredToItemize") === "" ? null : getVal("moFederallyRequiredToItemize") === "yes",
    moHasQualifiedDisasterLossStandardDeductionIncrease: getVal("moHasQualifiedDisasterLossStandardDeductionIncrease") === "" ? null : getVal("moHasQualifiedDisasterLossStandardDeductionIncrease") === "yes",
    moOtherDeductions: getVal("moOtherDeductions") === "" ? null : getNum("moOtherDeductions"),
    moClaimedFederalEIC: getVal("moClaimedFederalEIC") === "" ? null : getVal("moClaimedFederalEIC") === "yes",
    moFederalEICAmount: getNum("moFederalEICAmount"),
    moWftcInvestmentIncomeOver4400: getVal("moWftcInvestmentIncomeOver4400") === "" ? null : getVal("moWftcInvestmentIncomeOver4400") === "yes",
    moWftcChildInfoComplete: getVal("moWftcChildInfoComplete") === "" ? null : getVal("moWftcChildInfoComplete") === "yes",
    moEstimatedTaxPayments: getNum("moEstimatedTaxPayments"),
    moOtherPayments: getNum("moOtherPayments"),
    moExtensionPayments: getNum("moExtensionPayments"),
    moHasEnterpriseZoneModification: getVal("moHasEnterpriseZoneModification") === "" ? null : getVal("moHasEnterpriseZoneModification") === "yes",
    moHasResidentCreditOtherState: getVal("moHasResidentCreditOtherState") === "" ? null : getVal("moHasResidentCreditOtherState") === "yes",
    moHasMiscOrPropertyTaxCredits: getVal("moHasMiscOrPropertyTaxCredits") === "" ? null : getVal("moHasMiscOrPropertyTaxCredits") === "yes",
    moHasOtherTaxOrSpecialItems: getVal("moHasOtherTaxOrSpecialItems") === "" ? null : getVal("moHasOtherTaxOrSpecialItems") === "yes",

    ohFullYearResident: getVal("ohFullYearResident") === "" ? null : getVal("ohFullYearResident") === "yes",
    ohTotalAdditions: getVal("ohTotalAdditions") === "" ? null : getNum("ohTotalAdditions"),
    ohOtherDeductionsExcludingBusinessIncomeDeduction: getVal("ohOtherDeductionsExcludingBusinessIncomeDeduction") === "" ? null : getNum("ohOtherDeductionsExcludingBusinessIncomeDeduction"),
    ohScheduleBusinessIncomeTotal: getVal("ohScheduleBusinessIncomeTotal") === "" ? null : getNum("ohScheduleBusinessIncomeTotal"),
    ohSpouseCanBeClaimedAsDependent: getVal("ohSpouseCanBeClaimedAsDependent") === "" ? null : getVal("ohSpouseCanBeClaimedAsDependent") === "yes",
    ohNonrefundableCredits: getVal("ohNonrefundableCredits") === "" ? null : getNum("ohNonrefundableCredits"),
    ohInterestPenalty: getVal("ohInterestPenalty") === "" ? null : getNum("ohInterestPenalty"),
    ohUseTax: getVal("ohUseTax") === "" ? null : getNum("ohUseTax"),
    ohEstimatedAndOtherPayments: getVal("ohEstimatedAndOtherPayments") === "" ? null : getNum("ohEstimatedAndOtherPayments"),
    ohRefundableCredits: getVal("ohRefundableCredits") === "" ? null : getNum("ohRefundableCredits"),
    ohHasSchoolDistrictIncomeTax: getVal("ohHasSchoolDistrictIncomeTax") === "" ? null : getVal("ohHasSchoolDistrictIncomeTax") === "yes",
    ohSchoolDistrictTax: getVal("ohSchoolDistrictTax") === "" ? null : getNum("ohSchoolDistrictTax"),
    ohSchoolDistrictWithholding: getVal("ohSchoolDistrictWithholding") === "" ? null : getNum("ohSchoolDistrictWithholding"),
    ohSchoolDistrictPayments: getVal("ohSchoolDistrictPayments") === "" ? null : getNum("ohSchoolDistrictPayments"),
    ohHasResidencyCreditOrAllocation: getVal("ohHasResidencyCreditOrAllocation") === "" ? null : getVal("ohHasResidencyCreditOrAllocation") === "yes",
    ohHasAmendedNolOrSpecialItems: getVal("ohHasAmendedNolOrSpecialItems") === "" ? null : getVal("ohHasAmendedNolOrSpecialItems") === "yes",
    paFullYearResident: getVal("paFullYearResident") === "" ? null : getVal("paFullYearResident") === "yes",
    paNetCompensation: getVal("paNetCompensation") === "" ? null : getNum("paNetCompensation"),
    paInterestIncome: getVal("paInterestIncome") === "" ? null : getNum("paInterestIncome"),
    paDividendIncome: getVal("paDividendIncome") === "" ? null : getNum("paDividendIncome"),
    paBusinessFarmIncomeLoss: getVal("paBusinessFarmIncomeLoss") === "" ? null : getNum("paBusinessFarmIncomeLoss"),
    paPropertyGainLoss: getVal("paPropertyGainLoss") === "" ? null : getNum("paPropertyGainLoss"),
    paRentRoyaltyIncomeLoss: getVal("paRentRoyaltyIncomeLoss") === "" ? null : getNum("paRentRoyaltyIncomeLoss"),
    paEstateTrustIncome: getVal("paEstateTrustIncome") === "" ? null : getNum("paEstateTrustIncome"),
    paGamblingLotteryWinnings: getVal("paGamblingLotteryWinnings") === "" ? null : getNum("paGamblingLotteryWinnings"),
    paOtherDeductions: getVal("paOtherDeductions") === "" ? null : getNum("paOtherDeductions"),
    paHasResidentCredit: getVal("paHasResidentCredit") === "" ? null : getVal("paHasResidentCredit") === "yes",
    paResidentCredit: getVal("paResidentCredit") === "" ? null : getNum("paResidentCredit"),
    paClaimTaxForgiveness: getVal("paClaimTaxForgiveness") === "" ? null : getVal("paClaimTaxForgiveness") === "yes",
    paTaxForgivenessEligibilityIncome: getVal("paTaxForgivenessEligibilityIncome") === "" ? null : getNum("paTaxForgivenessEligibilityIncome"),
    paTaxForgivenessDependentChildren: getVal("paTaxForgivenessDependentChildren") === "" ? null : Number(getVal("paTaxForgivenessDependentChildren")),
    paDependentClaimantEligibleTaxForgiveness: getVal("paDependentClaimantEligibleTaxForgiveness") === "" ? null : getVal("paDependentClaimantEligibleTaxForgiveness") === "yes",
    paHasChildDependentCareCredit: getVal("paHasChildDependentCareCredit") === "" ? null : getVal("paHasChildDependentCareCredit") === "yes",
    paChildDependentCareCredit: getVal("paChildDependentCareCredit") === "" ? null : getNum("paChildDependentCareCredit"),
    paHasRestrictedScheduleOCCredits: getVal("paHasRestrictedScheduleOCCredits") === "" ? null : getVal("paHasRestrictedScheduleOCCredits") === "yes",
    paClaimedFederalEITC: getVal("paClaimedFederalEITC") === "" ? null : getVal("paClaimedFederalEITC") === "yes",
    paFederalEITCAmount: getVal("paFederalEITCAmount") === "" ? null : getNum("paFederalEITCAmount"),
    paPriorYearCredit: getVal("paPriorYearCredit") === "" ? null : getNum("paPriorYearCredit"),
    paEstimatedPayments: getVal("paEstimatedPayments") === "" ? null : getNum("paEstimatedPayments"),
    paExtensionPayment: getVal("paExtensionPayment") === "" ? null : getNum("paExtensionPayment"),
    paNonresidentWithholding: getVal("paNonresidentWithholding") === "" ? null : getNum("paNonresidentWithholding"),
    paUseTax: getVal("paUseTax") === "" ? null : getNum("paUseTax"),
    paPenaltiesInterest: getVal("paPenaltiesInterest") === "" ? null : getNum("paPenaltiesInterest"),
    paHasLocalEarnedIncomeTax: getVal("paHasLocalEarnedIncomeTax") === "" ? null : getVal("paHasLocalEarnedIncomeTax") === "yes",
    paLocalEarnedIncomeTax: getVal("paLocalEarnedIncomeTax") === "" ? null : getNum("paLocalEarnedIncomeTax"),
    paLocalEarnedIncomeWithholding: getVal("paLocalEarnedIncomeWithholding") === "" ? null : getNum("paLocalEarnedIncomeWithholding"),
    paLocalEarnedIncomePayments: getVal("paLocalEarnedIncomePayments") === "" ? null : getNum("paLocalEarnedIncomePayments"),
    paHasAmendedOrOtherSpecialItems: getVal("paHasAmendedOrOtherSpecialItems") === "" ? null : getVal("paHasAmendedOrOtherSpecialItems") === "yes",
    coFullYearResident: getVal("coFullYearResident") === "" ? null : getVal("coFullYearResident") === "yes",
    coAdditions: getVal("coAdditions") === "" ? null : getNum("coAdditions"),
    coSubtractions: getVal("coSubtractions") === "" ? null : getNum("coSubtractions"),
    coAlternativeMinimumTax: getVal("coAlternativeMinimumTax") === "" ? null : getNum("coAlternativeMinimumTax"),
    coCreditRecapture: getVal("coCreditRecapture") === "" ? null : getNum("coCreditRecapture"),
    coCreditRepayment: getVal("coCreditRepayment") === "" ? null : getNum("coCreditRepayment"),
    coOtherNonrefundableCredits: getVal("coOtherNonrefundableCredits") === "" ? null : getNum("coOtherNonrefundableCredits"),
    coChildTaxCredit: getVal("coChildTaxCredit") === "" ? null : getNum("coChildTaxCredit"),
    coChildDependentCareCredit: getVal("coChildDependentCareCredit") === "" ? null : getNum("coChildDependentCareCredit"),
    coFederalEITCAmount: getVal("coFederalEITCAmount") === "" ? null : getNum("coFederalEITCAmount"),
    coOtherRefundableCredits: getVal("coOtherRefundableCredits") === "" ? null : getNum("coOtherRefundableCredits"),
    coDirectRefundableCredits: getVal("coDirectRefundableCredits") === "" ? null : getNum("coDirectRefundableCredits"),
    coNeedsSpecialEITCFormTN: getVal("coNeedsSpecialEITCFormTN") === "" ? null : getVal("coNeedsSpecialEITCFormTN") === "yes",
    coHasOtherStateCredit: getVal("coHasOtherStateCredit") === "" ? null : getVal("coHasOtherStateCredit") === "yes",
    coOtherFormWithholding: getVal("coOtherFormWithholding") === "" ? null : getNum("coOtherFormWithholding"),
    coPriorYearCarryforward: getVal("coPriorYearCarryforward") === "" ? null : getNum("coPriorYearCarryforward"),
    coEstimatedPayments: getVal("coEstimatedPayments") === "" ? null : getNum("coEstimatedPayments"),
    coExtensionPayment: getVal("coExtensionPayment") === "" ? null : getNum("coExtensionPayment"),
    coOtherPrepayments: getVal("coOtherPrepayments") === "" ? null : getNum("coOtherPrepayments"),
    coTaborRefund: getVal("coTaborRefund") === "" ? null : getNum("coTaborRefund"),
    coDelinquentPenalty: getVal("coDelinquentPenalty") === "" ? null : getNum("coDelinquentPenalty"),
    coDelinquentInterest: getVal("coDelinquentInterest") === "" ? null : getNum("coDelinquentInterest"),
    coUnderpaymentPenalty: getVal("coUnderpaymentPenalty") === "" ? null : getNum("coUnderpaymentPenalty"),
    coApplyToNextYear: getVal("coApplyToNextYear") === "" ? null : getNum("coApplyToNextYear"),
    coVoluntaryContributions: getVal("coVoluntaryContributions") === "" ? null : getNum("coVoluntaryContributions"),
    coHasAmendedOrOtherSpecialItems: getVal("coHasAmendedOrOtherSpecialItems") === "" ? null : getVal("coHasAmendedOrOtherSpecialItems") === "yes",
    utFullYearResident: getVal("utFullYearResident") === "" ? null : getVal("utFullYearResident") === "yes",
    utAdditions: getVal("utAdditions") === "" ? null : getNum("utAdditions"),
    utStateTaxRefund: getVal("utStateTaxRefund") === "" ? null : getNum("utStateTaxRefund"),
    utSubtractions: getVal("utSubtractions") === "" ? null : getNum("utSubtractions"),
    utDependentExemptionCount: getVal("utDependentExemptionCount") === "" ? null : Number(getVal("utDependentExemptionCount")),
    utFederalDeductionLine12: getVal("utFederalDeductionLine12") === "" ? null : getNum("utFederalDeductionLine12"),
    utStateLocalIncomeTaxDeduction: getVal("utStateLocalIncomeTaxDeduction") === "" ? null : getNum("utStateLocalIncomeTaxDeduction"),
    utFederalBaseStandardDeduction: getVal("utFederalBaseStandardDeduction") === "" ? null : getNum("utFederalBaseStandardDeduction"),
    utMunicipalBondInterestAddition: getVal("utMunicipalBondInterestAddition") === "" ? null : getNum("utMunicipalBondInterestAddition"),
    utFederalTaxExemptInterest: getVal("utFederalTaxExemptInterest") === "" ? null : getNum("utFederalTaxExemptInterest"),
    utChildCreditQualifyingChildren: getVal("utChildCreditQualifyingChildren") === "" ? null : Number(getVal("utChildCreditQualifyingChildren")),
    utFederalEITCAmount: getVal("utFederalEITCAmount") === "" ? null : getNum("utFederalEITCAmount"),
    utUtahW2Wages: getVal("utUtahW2Wages") === "" ? null : getNum("utUtahW2Wages"),
    utOtherApportionableNonrefundableCredits: getVal("utOtherApportionableNonrefundableCredits") === "" ? null : getNum("utOtherApportionableNonrefundableCredits"),
    utNonapportionableNonrefundableCredits: getVal("utNonapportionableNonrefundableCredits") === "" ? null : getNum("utNonapportionableNonrefundableCredits"),
    utHasOtherStateCredit: getVal("utHasOtherStateCredit") === "" ? null : getVal("utHasOtherStateCredit") === "yes",
    utHasSpecialMarriedCoupleCalculation: getVal("utHasSpecialMarriedCoupleCalculation") === "" ? null : getVal("utHasSpecialMarriedCoupleCalculation") === "yes",
    utVoluntaryContributions: getVal("utVoluntaryContributions") === "" ? null : getNum("utVoluntaryContributions"),
    utLowIncomeHousingRecapture: getVal("utLowIncomeHousingRecapture") === "" ? null : getNum("utLowIncomeHousingRecapture"),
    utUseTax: getVal("utUseTax") === "" ? null : getNum("utUseTax"),
    utOtherWithholding: getVal("utOtherWithholding") === "" ? null : getNum("utOtherWithholding"),
    utPrepayments: getVal("utPrepayments") === "" ? null : getNum("utPrepayments"),
    utNonapportionableRefundableCredits: getVal("utNonapportionableRefundableCredits") === "" ? null : getNum("utNonapportionableRefundableCredits"),
    utApportionableRefundableCredits: getVal("utApportionableRefundableCredits") === "" ? null : getNum("utApportionableRefundableCredits"),
    utPenaltyInterest: getVal("utPenaltyInterest") === "" ? null : getNum("utPenaltyInterest"),
    utRefundSubtractions: getVal("utRefundSubtractions") === "" ? null : getNum("utRefundSubtractions"),
    utHasAmendedOrOtherSpecialItems: getVal("utHasAmendedOrOtherSpecialItems") === "" ? null : getVal("utHasAmendedOrOtherSpecialItems") === "yes",
    idFullYearResident: getVal("idFullYearResident") === "" ? null : getVal("idFullYearResident") === "yes",
    idAdditions: getVal("idAdditions") === "" ? null : getNum("idAdditions"),
    idSubtractions: getVal("idSubtractions") === "" ? null : getNum("idSubtractions"),
    idItemizedDeduction: getVal("idItemizedDeduction") === "" ? null : getNum("idItemizedDeduction"),
    idStandardDeduction: getVal("idStandardDeduction") === "" ? null : getNum("idStandardDeduction"),
    idFederalLine13Deductions: getVal("idFederalLine13Deductions") === "" ? null : getNum("idFederalLine13Deductions"),
    idMfsSpouseItemizes: getVal("idMfsSpouseItemizes") === "" ? null : getVal("idMfsSpouseItemizes") === "yes",
    idChildCreditQualifyingChildren: getVal("idChildCreditQualifyingChildren") === "" ? null : Number(getVal("idChildCreditQualifyingChildren")),
    idHasOtherStateCredit: getVal("idHasOtherStateCredit") === "" ? null : getVal("idHasOtherStateCredit") === "yes",
    idForm39rCredits: getVal("idForm39rCredits") === "" ? null : getNum("idForm39rCredits"),
    idBusinessIncomeTaxCredits: getVal("idBusinessIncomeTaxCredits") === "" ? null : getNum("idBusinessIncomeTaxCredits"),
    idFuelsUseTax: getVal("idFuelsUseTax") === "" ? null : getNum("idFuelsUseTax"),
    idSalesUseTax: getVal("idSalesUseTax") === "" ? null : getNum("idSalesUseTax"),
    idIncomeTaxCreditRecapture: getVal("idIncomeTaxCreditRecapture") === "" ? null : getNum("idIncomeTaxCreditRecapture"),
    idQieRecapture: getVal("idQieRecapture") === "" ? null : getNum("idQieRecapture"),
    idPermanentBuildingFundTax: getVal("idPermanentBuildingFundTax") === "" ? null : getNum("idPermanentBuildingFundTax"),
    idDonations: getVal("idDonations") === "" ? null : getNum("idDonations"),
    idParentalChoiceTaxCredit: getVal("idParentalChoiceTaxCredit") === "" ? null : getNum("idParentalChoiceTaxCredit"),
    idFoodTaxCredit: getVal("idFoodTaxCredit") === "" ? null : getNum("idFoodTaxCredit"),
    idHomeFamilyCredit: getVal("idHomeFamilyCredit") === "" ? null : getNum("idHomeFamilyCredit"),
    idFuelsTaxRefund: getVal("idFuelsTaxRefund") === "" ? null : getNum("idFuelsTaxRefund"),
    idOtherWithholding: getVal("idOtherWithholding") === "" ? null : getNum("idOtherWithholding"),
    idEstimatedPayments: getVal("idEstimatedPayments") === "" ? null : getNum("idEstimatedPayments"),
    idEntityPaidWithheldAbe: getVal("idEntityPaidWithheldAbe") === "" ? null : getNum("idEntityPaidWithheldAbe"),
    idTaxReimbursementIncentiveCredit: getVal("idTaxReimbursementIncentiveCredit") === "" ? null : getNum("idTaxReimbursementIncentiveCredit"),
    idPenaltyInterest: getVal("idPenaltyInterest") === "" ? null : getNum("idPenaltyInterest"),
    idPriorYearNonrefundableCredit: getVal("idPriorYearNonrefundableCredit") === "" ? null : getNum("idPriorYearNonrefundableCredit"),
    idRefundApplyToNextYear: getVal("idRefundApplyToNextYear") === "" ? null : getNum("idRefundApplyToNextYear"),
    idHasNolOrCarryback: getVal("idHasNolOrCarryback") === "" ? null : getVal("idHasNolOrCarryback") === "yes",
    idHasClaimOfRightCase: getVal("idHasClaimOfRightCase") === "" ? null : getVal("idHasClaimOfRightCase") === "yes",
    idHasAmendedOrOtherSpecialItems: getVal("idHasAmendedOrOtherSpecialItems") === "" ? null : getVal("idHasAmendedOrOtherSpecialItems") === "yes",
    mtFullYearResident: getVal("mtFullYearResident") === "" ? null : getVal("mtFullYearResident") === "yes",
    mtFederalDeductionLine2: getVal("mtFederalDeductionLine2") === "" ? null : getNum("mtFederalDeductionLine2"),
    mtAdditions: getVal("mtAdditions") === "" ? null : getNum("mtAdditions"),
    mtSubtractions: getVal("mtSubtractions") === "" ? null : getNum("mtSubtractions"),
    mtNetLongTermCapitalGains: getVal("mtNetLongTermCapitalGains") === "" ? null : getNum("mtNetLongTermCapitalGains"),
    mtOtherNonrefundableCredits: getVal("mtOtherNonrefundableCredits") === "" ? null : getNum("mtOtherNonrefundableCredits"),
    mtHasOtherStateCredit: getVal("mtHasOtherStateCredit") === "" ? null : getVal("mtHasOtherStateCredit") === "yes",
    mtOtherWithholdingAndPteCredits: getVal("mtOtherWithholdingAndPteCredits") === "" ? null : getNum("mtOtherWithholdingAndPteCredits"),
    mtEstimatedPayments: getVal("mtEstimatedPayments") === "" ? null : getNum("mtEstimatedPayments"),
    mtPriorYearOverpayment: getVal("mtPriorYearOverpayment") === "" ? null : getNum("mtPriorYearOverpayment"),
    mtExtensionPayment: getVal("mtExtensionPayment") === "" ? null : getNum("mtExtensionPayment"),
    mtFederalEITCAmount: getVal("mtFederalEITCAmount") === "" ? null : getNum("mtFederalEITCAmount"),
    mtHasEitcReductionCase: getVal("mtHasEitcReductionCase") === "" ? null : getVal("mtHasEitcReductionCase") === "yes",
    mtElderlyHomeownerRenterCredit: getVal("mtElderlyHomeownerRenterCredit") === "" ? null : getNum("mtElderlyHomeownerRenterCredit"),
    mtOtherRefundableCredits: getVal("mtOtherRefundableCredits") === "" ? null : getNum("mtOtherRefundableCredits"),
    mtScheduleIvOtherTaxes: getVal("mtScheduleIvOtherTaxes") === "" ? null : getNum("mtScheduleIvOtherTaxes"),
    mtRefundApplyToNextYear: getVal("mtRefundApplyToNextYear") === "" ? null : getNum("mtRefundApplyToNextYear"),
    mtRefund529Deposit: getVal("mtRefund529Deposit") === "" ? null : getNum("mtRefund529Deposit"),
    mtHasNolOrLossCarryforward: getVal("mtHasNolOrLossCarryforward") === "" ? null : getVal("mtHasNolOrLossCarryforward") === "yes",
    mtHasAmendedOrOtherSpecialItems: getVal("mtHasAmendedOrOtherSpecialItems") === "" ? null : getVal("mtHasAmendedOrOtherSpecialItems") === "yes",
    ndFullYearResident: getVal("ndFullYearResident") === "" ? null : getVal("ndFullYearResident") === "yes",
    ndFederalTaxableIncome: getVal("ndFederalTaxableIncome") === "" ? null : getSignedNum("ndFederalTaxableIncome"),
    ndContributionAdjustment: getVal("ndContributionAdjustment") === "" ? null : getNum("ndContributionAdjustment"),
    ndOtherAdditions: getVal("ndOtherAdditions") === "" ? null : getNum("ndOtherAdditions"),
    ndUsObligationInterest: getVal("ndUsObligationInterest") === "" ? null : getNum("ndUsObligationInterest"),
    ndNetLongTermCapitalGainExclusion: getVal("ndNetLongTermCapitalGainExclusion") === "" ? null : getNum("ndNetLongTermCapitalGainExclusion"),
    ndNativeAmericanExemptIncome: getVal("ndNativeAmericanExemptIncome") === "" ? null : getNum("ndNativeAmericanExemptIncome"),
    ndRailroadBenefits: getVal("ndRailroadBenefits") === "" ? null : getNum("ndRailroadBenefits"),
    ndPeaceOfficerRetirementExclusion: getVal("ndPeaceOfficerRetirementExclusion") === "" ? null : getNum("ndPeaceOfficerRetirementExclusion"),
    ndMilitaryPayExclusion: getVal("ndMilitaryPayExclusion") === "" ? null : getNum("ndMilitaryPayExclusion"),
    ndCollegeSaveContribution: getVal("ndCollegeSaveContribution") === "" ? null : getNum("ndCollegeSaveContribution"),
    ndQualifiedDividends: getVal("ndQualifiedDividends") === "" ? null : getNum("ndQualifiedDividends"),
    ndMilitaryRetirementExclusion: getVal("ndMilitaryRetirementExclusion") === "" ? null : getNum("ndMilitaryRetirementExclusion"),
    ndSocialSecurityExclusion: getVal("ndSocialSecurityExclusion") === "" ? null : getNum("ndSocialSecurityExclusion"),
    ndOtherSubtractions: getVal("ndOtherSubtractions") === "" ? null : getNum("ndOtherSubtractions"),
    ndTaxpayerQualifiedIncome: getVal("ndTaxpayerQualifiedIncome") === "" ? null : getNum("ndTaxpayerQualifiedIncome"),
    ndSpouseQualifiedIncome: getVal("ndSpouseQualifiedIncome") === "" ? null : getNum("ndSpouseQualifiedIncome"),
    ndOtherCredits: getVal("ndOtherCredits") === "" ? null : getNum("ndOtherCredits"),
    ndOtherWithholding: getVal("ndOtherWithholding") === "" ? null : getNum("ndOtherWithholding"),
    ndEstimatedTaxPayment: getVal("ndEstimatedTaxPayment") === "" ? null : getNum("ndEstimatedTaxPayment"),
    ndRefundApplyNextYear: getVal("ndRefundApplyNextYear") === "" ? null : getNum("ndRefundApplyNextYear"),
    ndRefundContributions: getVal("ndRefundContributions") === "" ? null : getNum("ndRefundContributions"),
    ndPenaltyInterest: getVal("ndPenaltyInterest") === "" ? null : getNum("ndPenaltyInterest"),
    ndBalanceDueContributions: getVal("ndBalanceDueContributions") === "" ? null : getNum("ndBalanceDueContributions"),
    ndUnderpaymentInterest: getVal("ndUnderpaymentInterest") === "" ? null : getNum("ndUnderpaymentInterest"),
    ndHasOtherStateCredit: getVal("ndHasOtherStateCredit") === "" ? null : getVal("ndHasOtherStateCredit") === "yes",
    ndHasFarmIncomeAveraging: getVal("ndHasFarmIncomeAveraging") === "" ? null : getVal("ndHasFarmIncomeAveraging") === "yes",
    ndHasSoldResearchCredit: getVal("ndHasSoldResearchCredit") === "" ? null : getVal("ndHasSoldResearchCredit") === "yes",
    ndHasAmendedNolOrOtherSpecialItems: getVal("ndHasAmendedNolOrOtherSpecialItems") === "" ? null : getVal("ndHasAmendedNolOrOtherSpecialItems") === "yes",

    nmFullYearResident: getVal("nmFullYearResident") === "" ? null : getVal("nmFullYearResident") === "yes",
    nmFederalDeductionLine12: getVal("nmFederalDeductionLine12") === "" ? null : getNum("nmFederalDeductionLine12"),
    nmStateLocalIncomeTaxAddback: getVal("nmStateLocalIncomeTaxAddback") === "" ? null : getNum("nmStateLocalIncomeTaxAddback"),
    nmPitAdjAdditions: getVal("nmPitAdjAdditions") === "" ? null : getNum("nmPitAdjAdditions"),
    nmPitAdjDeductions: getVal("nmPitAdjDeductions") === "" ? null : getNum("nmPitAdjDeductions"),
    nmSpouseCanBeClaimedAsDependent: getVal("nmSpouseCanBeClaimedAsDependent") === "" ? null : getVal("nmSpouseCanBeClaimedAsDependent") === "yes",
    nmMfsCommunityPropertyAllocated: getVal("nmMfsCommunityPropertyAllocated") === "" ? null : getVal("nmMfsCommunityPropertyAllocated") === "yes",
    nmPitCrNonrefundableCredits: getVal("nmPitCrNonrefundableCredits") === "" ? null : getNum("nmPitCrNonrefundableCredits"),
    nmPitRcTotalCredits: getVal("nmPitRcTotalCredits") === "" ? null : getNum("nmPitRcTotalCredits"),
    nmFederalEITCAmount: getVal("nmFederalEITCAmount") === "" ? null : getNum("nmFederalEITCAmount"),
    nmWftcExpansionCase: getVal("nmWftcExpansionCase") === "" ? null : getVal("nmWftcExpansionCase") === "yes",
    nmPitCrRefundableCredits: getVal("nmPitCrRefundableCredits") === "" ? null : getNum("nmPitCrRefundableCredits"),
    nmOtherLine27Withholding: getVal("nmOtherLine27Withholding") === "" ? null : getNum("nmOtherLine27Withholding"),
    nmOilGasWithholding: getVal("nmOilGasWithholding") === "" ? null : getNum("nmOilGasWithholding"),
    nmPteWithholdingEntityTax: getVal("nmPteWithholdingEntityTax") === "" ? null : getNum("nmPteWithholdingEntityTax"),
    nmEstimatedPayments: getVal("nmEstimatedPayments") === "" ? null : getNum("nmEstimatedPayments"),
    nmOtherPayments: getVal("nmOtherPayments") === "" ? null : getNum("nmOtherPayments"),
    nmUnderpaymentPenalty: getVal("nmUnderpaymentPenalty") === "" ? null : getNum("nmUnderpaymentPenalty"),
    nmLatePenalty: getVal("nmLatePenalty") === "" ? null : getNum("nmLatePenalty"),
    nmInterest: getVal("nmInterest") === "" ? null : getNum("nmInterest"),
    nmRefundContributions: getVal("nmRefundContributions") === "" ? null : getNum("nmRefundContributions"),
    nmApplyToNextYear: getVal("nmApplyToNextYear") === "" ? null : getNum("nmApplyToNextYear"),
    nmHasPitBAllocation: getVal("nmHasPitBAllocation") === "" ? null : getVal("nmHasPitBAllocation") === "yes",
    nmHasScheduleCCAlternativeTax: getVal("nmHasScheduleCCAlternativeTax") === "" ? null : getVal("nmHasScheduleCCAlternativeTax") === "yes",
    nmHasLumpSumDistributionTax: getVal("nmHasLumpSumDistributionTax") === "" ? null : getVal("nmHasLumpSumDistributionTax") === "yes",
    nmHasOtherStateCredit: getVal("nmHasOtherStateCredit") === "" ? null : getVal("nmHasOtherStateCredit") === "yes",
    nmHasAmendedOrOtherSpecialItems: getVal("nmHasAmendedOrOtherSpecialItems") === "" ? null : getVal("nmHasAmendedOrOtherSpecialItems") === "yes",

    caFullYearResident: getVal("caFullYearResident") === "" ? null : getVal("caFullYearResident") === "yes",
    caFilingStatusMatchesFederal: getVal("caFilingStatusMatchesFederal") === "" ? null : getVal("caFilingStatusMatchesFederal") === "yes",
    caIsRegisteredDomesticPartner: getVal("caIsRegisteredDomesticPartner") === "" ? null : getVal("caIsRegisteredDomesticPartner") === "yes",
    caScheduleCASubtractions: signedCurrencyNumberValue(document.getElementById("caScheduleCASubtractions")),
    caScheduleCAAdditions: signedCurrencyNumberValue(document.getElementById("caScheduleCAAdditions")),
    caDeductionMethod: getVal("caDeductionMethod"),
    caDeductionAmount: currencyNumberValue(document.getElementById("caDeductionAmount")),
    caPersonalExemptionCount: getVal("caPersonalExemptionCount") === "" ? null : Number(getVal("caPersonalExemptionCount")),
    caBlindExemptionCount: getVal("caBlindExemptionCount") === "" ? null : Number(getVal("caBlindExemptionCount")),
    caSeniorExemptionCount: getVal("caSeniorExemptionCount") === "" ? null : Number(getVal("caSeniorExemptionCount")),
    caDependentExemptionCount: getVal("caDependentExemptionCount") === "" ? null : Number(getVal("caDependentExemptionCount")),
    caMfsSpouseSameDeductionMethod: getVal("caMfsSpouseSameDeductionMethod") === "" ? null : getVal("caMfsSpouseSameDeductionMethod") === "yes",
    caMfsCommunityPropertyAllocated: getVal("caMfsCommunityPropertyAllocated") === "" ? null : getVal("caMfsCommunityPropertyAllocated") === "yes",
    caNonrefundableCreditsTotal: currencyNumberValue(document.getElementById("caNonrefundableCreditsTotal")),
    caAlternativeMinimumTax: currencyNumberValue(document.getElementById("caAlternativeMinimumTax")),
    caOtherTaxesRecapture: currencyNumberValue(document.getElementById("caOtherTaxesRecapture")),
    caOtherLine71Withholding: currencyNumberValue(document.getElementById("caOtherLine71Withholding")),
    caEstimatedAndOtherPayments: currencyNumberValue(document.getElementById("caEstimatedAndOtherPayments")),
    caForms592593Withholding: currencyNumberValue(document.getElementById("caForms592593Withholding")),
    caMotionPictureRefundableCredit: currencyNumberValue(document.getElementById("caMotionPictureRefundableCredit")),
    caCalEitc: currencyNumberValue(document.getElementById("caCalEitc")),
    caYoungChildTaxCredit: currencyNumberValue(document.getElementById("caYoungChildTaxCredit")),
    caFosterYouthTaxCredit: currencyNumberValue(document.getElementById("caFosterYouthTaxCredit")),
    caUseTax: currencyNumberValue(document.getElementById("caUseTax")),
    caIsrPenalty: currencyNumberValue(document.getElementById("caIsrPenalty")),
    caApplyToNextYear: currencyNumberValue(document.getElementById("caApplyToNextYear")),
    caContributions: currencyNumberValue(document.getElementById("caContributions")),
    caInterestLatePenalties: currencyNumberValue(document.getElementById("caInterestLatePenalties")),
    caUnderpaymentPenalty: currencyNumberValue(document.getElementById("caUnderpaymentPenalty")),
    caHasCapitalConstructionFund: getVal("caHasCapitalConstructionFund") === "" ? null : getVal("caHasCapitalConstructionFund") === "yes",
    caHasFtb3800Or3803: getVal("caHasFtb3800Or3803") === "" ? null : getVal("caHasFtb3800Or3803") === "yes",
    caHasScheduleG1Or5870A: getVal("caHasScheduleG1Or5870A") === "" ? null : getVal("caHasScheduleG1Or5870A") === "yes",
    caHasOtherStateTaxCredit: getVal("caHasOtherStateTaxCredit") === "" ? null : getVal("caHasOtherStateTaxCredit") === "yes",
    caHasClaimOfRightCredit: getVal("caHasClaimOfRightCredit") === "" ? null : getVal("caHasClaimOfRightCredit") === "yes",
    caHasAmendedOrOtherSpecialItems: getVal("caHasAmendedOrOtherSpecialItems") === "" ? null : getVal("caHasAmendedOrOtherSpecialItems") === "yes",


    orFullYearResident: getVal("orFullYearResident") === "" ? null : getVal("orFullYearResident") === "yes",
    orFilingStatusMatchesFederal: getVal("orFilingStatusMatchesFederal") === "" ? null : getVal("orFilingStatusMatchesFederal") === "yes",
    orIsRegisteredDomesticPartner: getVal("orIsRegisteredDomesticPartner") === "" ? null : getVal("orIsRegisteredDomesticPartner") === "yes",
    orAdditions: getVal("orAdditions") === "" ? null : getNum("orAdditions"),
    orFederalTaxLiabilitySubtraction: getVal("orFederalTaxLiabilitySubtraction") === "" ? null : getNum("orFederalTaxLiabilitySubtraction"),
    orSocialSecurityTier1Subtraction: getVal("orSocialSecurityTier1Subtraction") === "" ? null : getNum("orSocialSecurityTier1Subtraction"),
    orOregonRefundSubtraction: getVal("orOregonRefundSubtraction") === "" ? null : getNum("orOregonRefundSubtraction"),
    orOtherSubtractions: getVal("orOtherSubtractions") === "" ? null : getNum("orOtherSubtractions"),
    orDeductionMethod: getVal("orDeductionMethod"),
    orDeductionAmount: getVal("orDeductionAmount") === "" ? null : getNum("orDeductionAmount"),
    orMfsSpouseItemizes: getVal("orMfsSpouseItemizes") === "" ? null : getVal("orMfsSpouseItemizes") === "yes",
    orInstallmentSaleInterest: getVal("orInstallmentSaleInterest") === "" ? null : getNum("orInstallmentSaleInterest"),
    orTaxRecaptures: getVal("orTaxRecaptures") === "" ? null : getNum("orTaxRecaptures"),
    orExemptionCredit: getVal("orExemptionCredit") === "" ? null : getNum("orExemptionCredit"),
    orPoliticalContributionCredit: getVal("orPoliticalContributionCredit") === "" ? null : getNum("orPoliticalContributionCredit"),
    orOtherStandardCredits: getVal("orOtherStandardCredits") === "" ? null : getNum("orOtherStandardCredits"),
    orCarryforwardCredits: getVal("orCarryforwardCredits") === "" ? null : getNum("orCarryforwardCredits"),
    orKicker: getVal("orKicker") === "" ? null : getNum("orKicker"),
    orOtherWithholding: getVal("orOtherWithholding") === "" ? null : getNum("orOtherWithholding"),
    orPriorYearRefundApplied: getVal("orPriorYearRefundApplied") === "" ? null : getNum("orPriorYearRefundApplied"),
    orEstimatedPayments: getVal("orEstimatedPayments") === "" ? null : getNum("orEstimatedPayments"),
    orPteEstimatedPayments: getVal("orPteEstimatedPayments") === "" ? null : getNum("orPteEstimatedPayments"),
    orFederalEitcAmount: getVal("orFederalEitcAmount") === "" ? null : getNum("orFederalEitcAmount"),
    orYoungestDependentUnder3: getVal("orYoungestDependentUnder3") === "" ? null : getVal("orYoungestDependentUnder3") === "yes",
    orKidsCredit: getVal("orKidsCredit") === "" ? null : getNum("orKidsCredit"),
    orOtherRefundableCredits: getVal("orOtherRefundableCredits") === "" ? null : getNum("orOtherRefundableCredits"),
    orPenaltyInterest: getVal("orPenaltyInterest") === "" ? null : getNum("orPenaltyInterest"),
    orRefundApplications: getVal("orRefundApplications") === "" ? null : getNum("orRefundApplications"),
    orHasAlternateTaxMethod: getVal("orHasAlternateTaxMethod") === "" ? null : getVal("orHasAlternateTaxMethod") === "yes",
    orHasOtherStateCredit: getVal("orHasOtherStateCredit") === "" ? null : getVal("orHasOtherStateCredit") === "yes",
    orHasItinEicSpecialCase: getVal("orHasItinEicSpecialCase") === "" ? null : getVal("orHasItinEicSpecialCase") === "yes",
    orHasSeparateTransitTaxFiling: getVal("orHasSeparateTransitTaxFiling") === "" ? null : getVal("orHasSeparateTransitTaxFiling") === "yes",
    orHasAmendedNolOrOtherSpecialItems: getVal("orHasAmendedNolOrOtherSpecialItems") === "" ? null : getVal("orHasAmendedNolOrOtherSpecialItems") === "yes",

    waFullYearResident: getVal("waFullYearResident") === "" ? null : getVal("waFullYearResident") === "yes",
    waIsRegisteredDomesticPartner: getVal("waIsRegisteredDomesticPartner") === "" ? null : getVal("waIsRegisteredDomesticPartner") === "yes",
    waCapitalGainsBaseCompleted: getVal("waCapitalGainsBaseCompleted") === "" ? null : getVal("waCapitalGainsBaseCompleted") === "yes",
    waCapitalGainsBeforeDeductions: getVal("waCapitalGainsBeforeDeductions") === "" ? null : getNum("waCapitalGainsBeforeDeductions"),
    waConstitutionalDeduction: getVal("waConstitutionalDeduction") === "" ? null : getNum("waConstitutionalDeduction"),
    waFamilyOwnedBusinessDeduction: getVal("waFamilyOwnedBusinessDeduction") === "" ? null : getNum("waFamilyOwnedBusinessDeduction"),
    waQualifyingCharitableDonations: getVal("waQualifyingCharitableDonations") === "" ? null : getNum("waQualifyingCharitableDonations"),
    waOtherJurisdictionCredit: getVal("waOtherJurisdictionCredit") === "" ? null : getNum("waOtherJurisdictionCredit"),
    waBoCapitalGainsCredit: getVal("waBoCapitalGainsCredit") === "" ? null : getNum("waBoCapitalGainsCredit"),
    waCapitalGainsPayments: getVal("waCapitalGainsPayments") === "" ? null : getNum("waCapitalGainsPayments"),
    waWorkingFamiliesTaxCredit: getVal("waWorkingFamiliesTaxCredit") === "" ? null : getNum("waWorkingFamiliesTaxCredit"),
    waPenaltyInterest: getVal("waPenaltyInterest") === "" ? null : getNum("waPenaltyInterest"),
    waHasOtherMaterialSpecialCase: getVal("waHasOtherMaterialSpecialCase") === "" ? null : getVal("waHasOtherMaterialSpecialCase") === "yes",

    hiFullYearResident: getVal("hiFullYearResident") === "" ? null : getVal("hiFullYearResident") === "yes",
    hiFilingStatusMatchesFederal: getVal("hiFilingStatusMatchesFederal") === "" ? null : getVal("hiFilingStatusMatchesFederal") === "yes",
    hiAdditions: getVal("hiAdditions") === "" ? null : getNum("hiAdditions"),
    hiSubtractions: getVal("hiSubtractions") === "" ? null : getNum("hiSubtractions"),
    hiDeductionMethod: getVal("hiDeductionMethod"),
    hiItemizedDeductionAmount: getVal("hiItemizedDeductionAmount") === "" ? null : getNum("hiItemizedDeductionAmount"),
    hiMfsSpouseItemizes: getVal("hiMfsSpouseItemizes") === "" ? null : getVal("hiMfsSpouseItemizes") === "yes",
    hiExemptionCount: getVal("hiExemptionCount") === "" ? null : getNum("hiExemptionCount"),
    hiHasCertifiedDisabilityExemption: getVal("hiHasCertifiedDisabilityExemption") === "" ? null : getVal("hiHasCertifiedDisabilityExemption") === "yes",
    hiHasCapitalGainAlternativeTaxCase: getVal("hiHasCapitalGainAlternativeTaxCase") === "" ? null : getVal("hiHasCapitalGainAlternativeTaxCase") === "yes",
    hiHasPteTaxCreditOrAdjustment: getVal("hiHasPteTaxCreditOrAdjustment") === "" ? null : getVal("hiHasPteTaxCreditOrAdjustment") === "yes",
    hiHasOtherStateCredit: getVal("hiHasOtherStateCredit") === "" ? null : getVal("hiHasOtherStateCredit") === "yes",
    hiOtherTaxes: getVal("hiOtherTaxes") === "" ? null : getNum("hiOtherTaxes"),
    hiNonrefundableCredits: getVal("hiNonrefundableCredits") === "" ? null : getNum("hiNonrefundableCredits"),
    hiRefundableEic: getVal("hiRefundableEic") === "" ? null : getNum("hiRefundableEic"),
    hiOtherRefundableCredits: getVal("hiOtherRefundableCredits") === "" ? null : getNum("hiOtherRefundableCredits"),
    hiEstimatedPayments: getVal("hiEstimatedPayments") === "" ? null : getNum("hiEstimatedPayments"),
    hiOtherPayments: getVal("hiOtherPayments") === "" ? null : getNum("hiOtherPayments"),
    hiPenaltyInterest: getVal("hiPenaltyInterest") === "" ? null : getNum("hiPenaltyInterest"),
    hiHasAmendedOrOtherSpecialItems: getVal("hiHasAmendedOrOtherSpecialItems") === "" ? null : getVal("hiHasAmendedOrOtherSpecialItems") === "yes",

    deFullYearResident: getVal("deFullYearResident") === "" ? null : getVal("deFullYearResident") === "yes",
    deFilingStatusMatchesFederal: getVal("deFilingStatusMatchesFederal") === "" ? null : getVal("deFilingStatusMatchesFederal") === "yes",
    deAdditions: getVal("deAdditions") === "" ? null : getNum("deAdditions"),
    deSubtractions: getVal("deSubtractions") === "" ? null : getNum("deSubtractions"),
    deDeductionMethod: getVal("deDeductionMethod"),
    deItemizedDeductionAmount: getVal("deItemizedDeductionAmount") === "" ? null : getNum("deItemizedDeductionAmount"),
    deTaxpayerBlind: getVal("deTaxpayerBlind") === "" ? null : getVal("deTaxpayerBlind") === "yes",
    deSpouseBlind: getVal("deSpouseBlind") === "" ? null : getVal("deSpouseBlind") === "yes",
    deHasLumpSumDistribution: getVal("deHasLumpSumDistribution") === "" ? null : getVal("deHasLumpSumDistribution") === "yes",
    deHasOtherStateCredit: getVal("deHasOtherStateCredit") === "" ? null : getVal("deHasOtherStateCredit") === "yes",
    deVolunteerFirefighterCount: getVal("deVolunteerFirefighterCount") === "" ? null : Number(getVal("deVolunteerFirefighterCount")),
    deFederalChildDependentCareCredit: getVal("deFederalChildDependentCareCredit") === "" ? null : getNum("deFederalChildDependentCareCredit"),
    deOtherNonrefundableCredits: getVal("deOtherNonrefundableCredits") === "" ? null : getNum("deOtherNonrefundableCredits"),
    deFederalEITCAmount: getVal("deFederalEITCAmount") === "" ? null : getNum("deFederalEITCAmount"),
    deEstimatedPayments: getVal("deEstimatedPayments") === "" ? null : getNum("deEstimatedPayments"),
    deSCorporationPayments: getVal("deSCorporationPayments") === "" ? null : getNum("deSCorporationPayments"),
    deRealEstateCapitalGainsPayments: getVal("deRealEstateCapitalGainsPayments") === "" ? null : getNum("deRealEstateCapitalGainsPayments"),
    deOtherRefundableCredits: getVal("deOtherRefundableCredits") === "" ? null : getNum("deOtherRefundableCredits"),
    dePenaltyInterest: getVal("dePenaltyInterest") === "" ? null : getNum("dePenaltyInterest"),
    deHasAmendedOrOtherSpecialItems: getVal("deHasAmendedOrOtherSpecialItems") === "" ? null : getVal("deHasAmendedOrOtherSpecialItems") === "yes",

    ctFullYearResident: getVal("ctFullYearResident") === "" ? null : getVal("ctFullYearResident") === "yes",
    ctFilingStatusMatchesFederal: getVal("ctFilingStatusMatchesFederal") === "" ? null : getVal("ctFilingStatusMatchesFederal") === "yes",
    ctAdditions: getVal("ctAdditions") === "" ? null : getNum("ctAdditions"),
    ctSubtractions: getVal("ctSubtractions") === "" ? null : getNum("ctSubtractions"),
    ctHasOtherStateCredit: getVal("ctHasOtherStateCredit") === "" ? null : getVal("ctHasOtherStateCredit") === "yes",
    ctHasFederalAMT: getVal("ctHasFederalAMT") === "" ? null : getVal("ctHasFederalAMT") === "yes",
    ctAlternativeMinimumTax: getVal("ctAlternativeMinimumTax") === "" ? null : getNum("ctAlternativeMinimumTax"),
    ctPropertyTaxCredit: getVal("ctPropertyTaxCredit") === "" ? null : getNum("ctPropertyTaxCredit"),
    ctAllowableCredits: getVal("ctAllowableCredits") === "" ? null : getNum("ctAllowableCredits"),
    ctUseTax: getVal("ctUseTax") === "" ? null : getNum("ctUseTax"),
    ctEstimatedPayments: getVal("ctEstimatedPayments") === "" ? null : getNum("ctEstimatedPayments"),
    ctExtensionPayment: getVal("ctExtensionPayment") === "" ? null : getNum("ctExtensionPayment"),
    ctClaimedFederalEITC: getVal("ctClaimedFederalEITC") === "" ? null : getVal("ctClaimedFederalEITC") === "yes",
    ctFederalEITCAmount: getVal("ctFederalEITCAmount") === "" ? null : getNum("ctFederalEITCAmount"),
    ctEitcHasQualifyingChild: getVal("ctEitcHasQualifyingChild") === "" ? null : getVal("ctEitcHasQualifyingChild") === "yes",
    ctOtherRefundableCredits: getVal("ctOtherRefundableCredits") === "" ? null : getNum("ctOtherRefundableCredits"),
    ctRefundAllocations: getVal("ctRefundAllocations") === "" ? null : getNum("ctRefundAllocations"),
    ctPenaltyInterest: getVal("ctPenaltyInterest") === "" ? null : getNum("ctPenaltyInterest"),
    ctHasAmendedOrOtherSpecialItems: getVal("ctHasAmendedOrOtherSpecialItems") === "" ? null : getVal("ctHasAmendedOrOtherSpecialItems") === "yes",

    meFullYearResident: getVal("meFullYearResident") === "" ? null : getVal("meFullYearResident") === "yes",
    meFilingStatusMatchesFederal: getVal("meFilingStatusMatchesFederal") === "" ? null : getVal("meFilingStatusMatchesFederal") === "yes",
    meAdditions: getVal("meAdditions") === "" ? null : getNum("meAdditions"),
    meSubtractions: getVal("meSubtractions") === "" ? null : getNum("meSubtractions"),
    meFederalDeductionMethod: getVal("meFederalDeductionMethod"),
    meItemizedDeductionAmount: getVal("meItemizedDeductionAmount") === "" ? null : getNum("meItemizedDeductionAmount"),
    meTaxpayerBlind: getVal("meTaxpayerBlind") === "" ? null : getVal("meTaxpayerBlind") === "yes",
    meSpouseBlind: getVal("meSpouseBlind") === "" ? null : getVal("meSpouseBlind") === "yes",
    meSpouseCanBeClaimedAsDependent: getVal("meSpouseCanBeClaimedAsDependent") === "" ? null : getVal("meSpouseCanBeClaimedAsDependent") === "yes",
    meDependentCreditAge6OrOlderCount: getVal("meDependentCreditAge6OrOlderCount") === "" ? null : Number(getVal("meDependentCreditAge6OrOlderCount")),
    meDependentCreditUnder6Count: getVal("meDependentCreditUnder6Count") === "" ? null : Number(getVal("meDependentCreditUnder6Count")),
    meTaxCreditRecapture: getVal("meTaxCreditRecapture") === "" ? null : getNum("meTaxCreditRecapture"),
    meHasOtherStateCredit: getVal("meHasOtherStateCredit") === "" ? null : getVal("meHasOtherStateCredit") === "yes",
    meOtherNonrefundableCredits: getVal("meOtherNonrefundableCredits") === "" ? null : getNum("meOtherNonrefundableCredits"),
    meClaimedFederalEITC: getVal("meClaimedFederalEITC") === "" ? null : getVal("meClaimedFederalEITC") === "yes",
    meFederalEITCAmount: getVal("meFederalEITCAmount") === "" ? null : getNum("meFederalEITCAmount"),
    meEitcHasQualifyingChild: getVal("meEitcHasQualifyingChild") === "" ? null : getVal("meEitcHasQualifyingChild") === "yes",
    meHasMaineOnlyEitcEligibility: getVal("meHasMaineOnlyEitcEligibility") === "" ? null : getVal("meHasMaineOnlyEitcEligibility") === "yes",
    meOtherRefundableCredits: getVal("meOtherRefundableCredits") === "" ? null : getNum("meOtherRefundableCredits"),
    mePropertyTaxFairnessCredit: getVal("mePropertyTaxFairnessCredit") === "" ? null : getNum("mePropertyTaxFairnessCredit"),
    meSalesTaxFairnessCredit: getVal("meSalesTaxFairnessCredit") === "" ? null : getNum("meSalesTaxFairnessCredit"),
    meOtherMaineWithholding: getVal("meOtherMaineWithholding") === "" ? null : getNum("meOtherMaineWithholding"),
    meOtherPayments: getVal("meOtherPayments") === "" ? null : getNum("meOtherPayments"),
    meUseTax: getVal("meUseTax") === "" ? null : getNum("meUseTax"),
    meCasualRentalTax: getVal("meCasualRentalTax") === "" ? null : getNum("meCasualRentalTax"),
    meVoluntaryContributions: getVal("meVoluntaryContributions") === "" ? null : getNum("meVoluntaryContributions"),
    meUnderpaymentPenalty: getVal("meUnderpaymentPenalty") === "" ? null : getNum("meUnderpaymentPenalty"),
    meCreditToNextYear: getVal("meCreditToNextYear") === "" ? null : getNum("meCreditToNextYear"),
    meHasAmendedOrOtherSpecialItems: getVal("meHasAmendedOrOtherSpecialItems") === "" ? null : getVal("meHasAmendedOrOtherSpecialItems") === "yes",
    mdFullYearResident: getVal("mdFullYearResident") === "" ? null : getVal("mdFullYearResident") === "yes",
    mdFilingStatusMatchesFederal: getVal("mdFilingStatusMatchesFederal") === "" ? null : getVal("mdFilingStatusMatchesFederal") === "yes",
    mdSpousesSameLocalJurisdiction: getVal("mdSpousesSameLocalJurisdiction") === "" ? null : getVal("mdSpousesSameLocalJurisdiction") === "yes",
    mdAdditions: getVal("mdAdditions") === "" ? null : getNum("mdAdditions"), mdSubtractions: getVal("mdSubtractions") === "" ? null : getNum("mdSubtractions"),
    mdDeductionMethod: getVal("mdDeductionMethod"), mdItemizedDeductionBeforePhaseout: getVal("mdItemizedDeductionBeforePhaseout") === "" ? null : getNum("mdItemizedDeductionBeforePhaseout"),
    mdTaxpayerBlind: getVal("mdTaxpayerBlind") === "" ? null : getVal("mdTaxpayerBlind") === "yes", mdSpouseBlind: getVal("mdSpouseBlind") === "" ? null : getVal("mdSpouseBlind") === "yes",
    mdAge65DependentCount: getVal("mdAge65DependentCount") === "" ? null : Number(getVal("mdAge65DependentCount")), mdLocalJurisdiction: getVal("mdLocalJurisdiction"),
    mdCapitalGainSubjectToAdditionalTax: getVal("mdCapitalGainSubjectToAdditionalTax") === "" ? null : getNum("mdCapitalGainSubjectToAdditionalTax"),
    mdFederalEITCAmount: getVal("mdFederalEITCAmount") === "" ? null : getNum("mdFederalEITCAmount"), mdEitcQualifyingChildCount: getVal("mdEitcQualifyingChildCount") === "" ? null : Number(getVal("mdEitcQualifyingChildCount")),
    mdHasMarylandOnlyEitcEligibility: getVal("mdHasMarylandOnlyEitcEligibility") === "" ? null : getVal("mdHasMarylandOnlyEitcEligibility") === "yes", mdEarnedIncome: getVal("mdEarnedIncome") === "" ? null : getNum("mdEarnedIncome"),
    mdChildTaxCreditUnder6Count: getVal("mdChildTaxCreditUnder6Count") === "" ? null : Number(getVal("mdChildTaxCreditUnder6Count")), mdChildTaxCreditDisabledAge6To16Count: getVal("mdChildTaxCreditDisabledAge6To16Count") === "" ? null : Number(getVal("mdChildTaxCreditDisabledAge6To16Count")),
    mdOtherNonrefundableCredits: getVal("mdOtherNonrefundableCredits") === "" ? null : getNum("mdOtherNonrefundableCredits"), mdOtherRefundableCredits: getVal("mdOtherRefundableCredits") === "" ? null : getNum("mdOtherRefundableCredits"),
    mdOtherMarylandWithholding: getVal("mdOtherMarylandWithholding") === "" ? null : getNum("mdOtherMarylandWithholding"), mdOtherPayments: getVal("mdOtherPayments") === "" ? null : getNum("mdOtherPayments"),
    mdVoluntaryContributions: getVal("mdVoluntaryContributions") === "" ? null : getNum("mdVoluntaryContributions"), mdUnderpaymentInterest: getVal("mdUnderpaymentInterest") === "" ? null : getNum("mdUnderpaymentInterest"), mdHomebuyerWithdrawalPenalty: getVal("mdHomebuyerWithdrawalPenalty") === "" ? null : getNum("mdHomebuyerWithdrawalPenalty"), mdCreditToNextYear: getVal("mdCreditToNextYear") === "" ? null : getNum("mdCreditToNextYear"),
    mdHasOtherStateCredit: getVal("mdHasOtherStateCredit") === "" ? null : getVal("mdHasOtherStateCredit") === "yes", mdHasMilitaryOrSpecialFiling: getVal("mdHasMilitaryOrSpecialFiling") === "" ? null : getVal("mdHasMilitaryOrSpecialFiling") === "yes", mdHasAmendedOrOtherSpecialItems: getVal("mdHasAmendedOrOtherSpecialItems") === "" ? null : getVal("mdHasAmendedOrOtherSpecialItems") === "yes",

    njFullYearResident: getVal("njFullYearResident") === "" ? null : getVal("njFullYearResident") === "yes",
    njHasFilingStatusException: getVal("njHasFilingStatusException") === "" ? null : getVal("njHasFilingStatusException") === "yes",
    njClaimsDomesticPartnerExemption: getVal("njClaimsDomesticPartnerExemption") === "" ? null : getVal("njClaimsDomesticPartnerExemption") === "yes",
    njTaxpayerBlindOrDisabled: getVal("njTaxpayerBlindOrDisabled") === "" ? null : getVal("njTaxpayerBlindOrDisabled") === "yes",
    njSpouseBlindOrDisabled: getVal("njSpouseBlindOrDisabled") === "" ? null : getVal("njSpouseBlindOrDisabled") === "yes",
    njTaxpayerVeteran: getVal("njTaxpayerVeteran") === "" ? null : getVal("njTaxpayerVeteran") === "yes",
    njSpouseVeteran: getVal("njSpouseVeteran") === "" ? null : getVal("njSpouseVeteran") === "yes",
    njGrossIncome: getVal("njGrossIncome") === "" ? null : getNum("njGrossIncome"),
    njCollegeDependentCount: getVal("njCollegeDependentCount") === "" ? null : Number(getVal("njCollegeDependentCount")),
    njMedicalExpenseDeduction: getVal("njMedicalExpenseDeduction") === "" ? null : getNum("njMedicalExpenseDeduction"),
    njAlimonyDeduction: getVal("njAlimonyDeduction") === "" ? null : getNum("njAlimonyDeduction"),
    njQualifiedConservationDeduction: getVal("njQualifiedConservationDeduction") === "" ? null : getNum("njQualifiedConservationDeduction"),
    njHealthEnterpriseZoneDeduction: getVal("njHealthEnterpriseZoneDeduction") === "" ? null : getNum("njHealthEnterpriseZoneDeduction"),
    njAlternativeBusinessAdjustment: getVal("njAlternativeBusinessAdjustment") === "" ? null : getNum("njAlternativeBusinessAdjustment"),
    njOrganBoneMarrowDeduction: getVal("njOrganBoneMarrowDeduction") === "" ? null : getNum("njOrganBoneMarrowDeduction"),
    njNjbestDeduction: getVal("njNjbestDeduction") === "" ? null : getNum("njNjbestDeduction"),
    njNjclassDeduction: getVal("njNjclassDeduction") === "" ? null : getNum("njNjclassDeduction"),
    njTuitionDeduction: getVal("njTuitionDeduction") === "" ? null : getNum("njTuitionDeduction"),
    njPropertyTaxBenefitEligible: getVal("njPropertyTaxBenefitEligible") === "" ? null : getVal("njPropertyTaxBenefitEligible") === "yes",
    njPropertyTaxesLine40a: getVal("njPropertyTaxesLine40a") === "" ? null : getNum("njPropertyTaxesLine40a"),
    njOtherNonrefundableCredits: getVal("njOtherNonrefundableCredits") === "" ? null : getNum("njOtherNonrefundableCredits"),
    njUseTax: getVal("njUseTax") === "" ? null : getNum("njUseTax"), njUnderpaymentInterest: getVal("njUnderpaymentInterest") === "" ? null : getNum("njUnderpaymentInterest"), njSharedResponsibilityPayment: getVal("njSharedResponsibilityPayment") === "" ? null : getNum("njSharedResponsibilityPayment"),
    njOtherNJWithholding: getVal("njOtherNJWithholding") === "" ? null : getNum("njOtherNJWithholding"), njPaymentsCreditFromPriorYear: getVal("njPaymentsCreditFromPriorYear") === "" ? null : getNum("njPaymentsCreditFromPriorYear"),
    njClaimedFederalEITC: getVal("njClaimedFederalEITC") === "" ? null : getVal("njClaimedFederalEITC") === "yes", njFederalEITCAmount: getVal("njFederalEITCAmount") === "" ? null : getNum("njFederalEITCAmount"), njHasNJOnlyEITC: getVal("njHasNJOnlyEITC") === "" ? null : getVal("njHasNJOnlyEITC") === "yes",
    njExcessUiWfSwfCredit: getVal("njExcessUiWfSwfCredit") === "" ? null : getNum("njExcessUiWfSwfCredit"), njExcessDiCredit: getVal("njExcessDiCredit") === "" ? null : getNum("njExcessDiCredit"), njExcessFliCredit: getVal("njExcessFliCredit") === "" ? null : getNum("njExcessFliCredit"),
    njWoundedWarriorCredit: getVal("njWoundedWarriorCredit") === "" ? null : getNum("njWoundedWarriorCredit"), njPteBaitCredit: getVal("njPteBaitCredit") === "" ? null : getNum("njPteBaitCredit"), njFederalChildDependentCareCredit: getVal("njFederalChildDependentCareCredit") === "" ? null : getNum("njFederalChildDependentCareCredit"), njChildTaxCreditUnder6Count: getVal("njChildTaxCreditUnder6Count") === "" ? null : Number(getVal("njChildTaxCreditUnder6Count")),
    njCreditToNextYear: getVal("njCreditToNextYear") === "" ? null : getNum("njCreditToNextYear"), njCharitableContributions: getVal("njCharitableContributions") === "" ? null : getNum("njCharitableContributions"),
    njHasOtherJurisdictionCredit: getVal("njHasOtherJurisdictionCredit") === "" ? null : getVal("njHasOtherJurisdictionCredit") === "yes", njHasAmendedOrOtherSpecialItems: getVal("njHasAmendedOrOtherSpecialItems") === "" ? null : getVal("njHasAmendedOrOtherSpecialItems") === "yes",
    nyFullYearResident: getVal("nyFullYearResident") === "" ? null : getVal("nyFullYearResident") === "yes",
    nyHasFilingStatusException: getVal("nyHasFilingStatusException") === "" ? null : getVal("nyHasFilingStatusException") === "yes",
    nyDeductionMethod: getVal("nyDeductionMethod"), nyLocality: getVal("nyLocality"),
    nyHasPartYearLocalResidency: getVal("nyHasPartYearLocalResidency") === "" ? null : getVal("nyHasPartYearLocalResidency") === "yes",
    nyJointLocalResidencyMismatch: getVal("nyJointLocalResidencyMismatch") === "" ? null : getVal("nyJointLocalResidencyMismatch") === "yes",
    nyHasYonkersNonresidentEarnings: getVal("nyHasYonkersNonresidentEarnings") === "" ? null : getVal("nyHasYonkersNonresidentEarnings") === "yes",
    nyClaimedFederalEITC: getVal("nyClaimedFederalEITC") === "" ? null : getVal("nyClaimedFederalEITC") === "yes",
    nyHasNoncustodialEITC: getVal("nyHasNoncustodialEITC") === "" ? null : getVal("nyHasNoncustodialEITC") === "yes",
    nyHasOtherStateCredit: getVal("nyHasOtherStateCredit") === "" ? null : getVal("nyHasOtherStateCredit") === "yes",
    nyHasAmendedOrOtherSpecialItems: getVal("nyHasAmendedOrOtherSpecialItems") === "" ? null : getVal("nyHasAmendedOrOtherSpecialItems") === "yes",
    nyAdditions: getVal("nyAdditions") === "" ? null : getNum("nyAdditions"), nySubtractions: getVal("nySubtractions") === "" ? null : getNum("nySubtractions"), nyItemizedDeduction: getVal("nyItemizedDeduction") === "" ? null : getNum("nyItemizedDeduction"), nyHighIncomeLine39Tax: getVal("nyHighIncomeLine39Tax") === "" ? null : getNum("nyHighIncomeLine39Tax"),
    nyOtherNonrefundableCredits: getVal("nyOtherNonrefundableCredits") === "" ? null : getNum("nyOtherNonrefundableCredits"), nyOtherStateTaxes: getVal("nyOtherStateTaxes") === "" ? null : getNum("nyOtherStateTaxes"), nySalesUseTax: getVal("nySalesUseTax") === "" ? null : getNum("nySalesUseTax"), nyMctmt: getVal("nyMctmt") === "" ? null : getNum("nyMctmt"),
    nyNycTaxableIncome: getVal("nyNycTaxableIncome") === "" ? null : getNum("nyNycTaxableIncome"), nyNycOtherTaxes: getVal("nyNycOtherTaxes") === "" ? null : getNum("nyNycOtherTaxes"), nyNycNonrefundableCredits: getVal("nyNycNonrefundableCredits") === "" ? null : getNum("nyNycNonrefundableCredits"), nyYonkersResidentSurcharge: getVal("nyYonkersResidentSurcharge") === "" ? null : getNum("nyYonkersResidentSurcharge"),
    nyEmpireChildUnder4Count: getVal("nyEmpireChildUnder4Count") === "" ? null : Number(getVal("nyEmpireChildUnder4Count")), nyEmpireChild4To16Count: getVal("nyEmpireChild4To16Count") === "" ? null : Number(getVal("nyEmpireChild4To16Count")), nyStateChildDependentCareCredit: getVal("nyStateChildDependentCareCredit") === "" ? null : getNum("nyStateChildDependentCareCredit"), nyFederalEITCAmount: getVal("nyFederalEITCAmount") === "" ? null : getNum("nyFederalEITCAmount"),
    nyRealPropertyTaxCredit: getVal("nyRealPropertyTaxCredit") === "" ? null : getNum("nyRealPropertyTaxCredit"), nyCollegeTuitionCredit: getVal("nyCollegeTuitionCredit") === "" ? null : getNum("nyCollegeTuitionCredit"), nyNycChildDependentCareCredit: getVal("nyNycChildDependentCareCredit") === "" ? null : getNum("nyNycChildDependentCareCredit"), nyNycSchoolTaxCreditFixed: getVal("nyNycSchoolTaxCreditFixed") === "" ? null : getNum("nyNycSchoolTaxCreditFixed"), nyNycSchoolTaxCreditRateReduction: getVal("nyNycSchoolTaxCreditRateReduction") === "" ? null : getNum("nyNycSchoolTaxCreditRateReduction"), nyNycEITC: getVal("nyNycEITC") === "" ? null : getNum("nyNycEITC"),
    nyOtherRefundableCredits: getVal("nyOtherRefundableCredits") === "" ? null : getNum("nyOtherRefundableCredits"), nyOtherNYWithholding: getVal("nyOtherNYWithholding") === "" ? null : getNum("nyOtherNYWithholding"), nyEstimatedPayments: getVal("nyEstimatedPayments") === "" ? null : getNum("nyEstimatedPayments"), nyExtensionPayment: getVal("nyExtensionPayment") === "" ? null : getNum("nyExtensionPayment"), nyVoluntaryContributions: getVal("nyVoluntaryContributions") === "" ? null : getNum("nyVoluntaryContributions"), nyPenaltyInterest: getVal("nyPenaltyInterest") === "" ? null : getNum("nyPenaltyInterest"), nyCreditToNextYear: getVal("nyCreditToNextYear") === "" ? null : getNum("nyCreditToNextYear"),
    riFullYearResident: getVal("riFullYearResident") === "" ? null : getVal("riFullYearResident") === "yes",
    riHasFilingStatusException: getVal("riHasFilingStatusException") === "" ? null : getVal("riHasFilingStatusException") === "yes",
    riNetModifications: getVal("riNetModifications") === "" ? null : getSignedNum("riNetModifications"),
    riFederalChildDependentCareCredit: getVal("riFederalChildDependentCareCredit") === "" ? null : getNum("riFederalChildDependentCareCredit"),
    riOtherStateCredit: getVal("riOtherStateCredit") === "" ? null : getNum("riOtherStateCredit"), riOtherRhodeIslandCredits: getVal("riOtherRhodeIslandCredits") === "" ? null : getNum("riOtherRhodeIslandCredits"),
    riCreditRecapture: getVal("riCreditRecapture") === "" ? null : getNum("riCreditRecapture"), riCheckoffContributions: getVal("riCheckoffContributions") === "" ? null : getNum("riCheckoffContributions"), riUseSalesTax: getVal("riUseSalesTax") === "" ? null : getNum("riUseSalesTax"), riIndividualMandatePenalty: getVal("riIndividualMandatePenalty") === "" ? null : getNum("riIndividualMandatePenalty"),
    riClaimedFederalEITC: getVal("riClaimedFederalEITC") === "" ? null : getVal("riClaimedFederalEITC") === "yes", riFederalEITCAmount: getVal("riFederalEITCAmount") === "" ? null : getNum("riFederalEITCAmount"),
    riPropertyTaxReliefCredit: getVal("riPropertyTaxReliefCredit") === "" ? null : getNum("riPropertyTaxReliefCredit"), riLeadPaintCredit: getVal("riLeadPaintCredit") === "" ? null : getNum("riLeadPaintCredit"), riOtherRhodeIslandWithholding: getVal("riOtherRhodeIslandWithholding") === "" ? null : getNum("riOtherRhodeIslandWithholding"),
    riEstimatedPayments: getVal("riEstimatedPayments") === "" ? null : getNum("riEstimatedPayments"), riOtherPayments: getVal("riOtherPayments") === "" ? null : getNum("riOtherPayments"), riUnderpaymentInterest: getVal("riUnderpaymentInterest") === "" ? null : getNum("riUnderpaymentInterest"), riCreditToNextYear: getVal("riCreditToNextYear") === "" ? null : getNum("riCreditToNextYear"),
    riHasAmendedOrOtherSpecialItems: getVal("riHasAmendedOrOtherSpecialItems") === "" ? null : getVal("riHasAmendedOrOtherSpecialItems") === "yes",

    vtFullYearResident: getVal("vtFullYearResident") === "" ? null : getVal("vtFullYearResident") === "yes",
    vtHasFilingStatusException: getVal("vtHasFilingStatusException") === "" ? null : getVal("vtHasFilingStatusException") === "yes",
    vtNetModifications: getVal("vtNetModifications") === "" ? null : getSignedNum("vtNetModifications"),
    vtStandardDeductionBoxCount: getVal("vtStandardDeductionBoxCount") === "" ? null : Number(getVal("vtStandardDeductionBoxCount")),
    vtSpouseCanBeClaimedAsDependent: getVal("vtSpouseCanBeClaimedAsDependent") === "" ? null : getVal("vtSpouseCanBeClaimedAsDependent") === "yes",
    vtUsObligationInterestForMinimumTax: getVal("vtUsObligationInterestForMinimumTax") === "" ? null : getNum("vtUsObligationInterestForMinimumTax"),
    vtNetTaxAdjustment: getVal("vtNetTaxAdjustment") === "" ? null : getSignedNum("vtNetTaxAdjustment"),
    vtCharitableContributions: getVal("vtCharitableContributions") === "" ? null : getNum("vtCharitableContributions"),
    vtHasIncomeAdjustment: getVal("vtHasIncomeAdjustment") === "" ? null : getVal("vtHasIncomeAdjustment") === "yes",
    vtOtherStateCredit: getVal("vtOtherStateCredit") === "" ? null : getNum("vtOtherStateCredit"), vtOtherNonrefundableCredits: getVal("vtOtherNonrefundableCredits") === "" ? null : getNum("vtOtherNonrefundableCredits"),
    vtChildCareContribution: getVal("vtChildCareContribution") === "" ? null : getNum("vtChildCareContribution"), vtUseTax: getVal("vtUseTax") === "" ? null : getNum("vtUseTax"), vtVoluntaryContributions: getVal("vtVoluntaryContributions") === "" ? null : getNum("vtVoluntaryContributions"),
    vtFederalChildDependentCareCredit: getVal("vtFederalChildDependentCareCredit") === "" ? null : getNum("vtFederalChildDependentCareCredit"), vtChildTaxCreditQualifyingChildCount: getVal("vtChildTaxCreditQualifyingChildCount") === "" ? null : Number(getVal("vtChildTaxCreditQualifyingChildCount")),
    vtClaimedFederalEITC: getVal("vtClaimedFederalEITC") === "" ? null : getVal("vtClaimedFederalEITC") === "yes", vtFederalEITCAmount: getVal("vtFederalEITCAmount") === "" ? null : getNum("vtFederalEITCAmount"), vtEitcQualifyingChildCount: getVal("vtEitcQualifyingChildCount") === "" ? null : Number(getVal("vtEitcQualifyingChildCount")),
    vtIsQualifyingVeteran: getVal("vtIsQualifyingVeteran") === "" ? null : getVal("vtIsQualifyingVeteran") === "yes", vtUsesRenterCreditForIncomeTax: getVal("vtUsesRenterCreditForIncomeTax") === "" ? null : getVal("vtUsesRenterCreditForIncomeTax") === "yes",
    vtOtherVermontWithholding: getVal("vtOtherVermontWithholding") === "" ? null : getNum("vtOtherVermontWithholding"), vtEstimatedPayments: getVal("vtEstimatedPayments") === "" ? null : getNum("vtEstimatedPayments"), vtRealEstateWithholding: getVal("vtRealEstateWithholding") === "" ? null : getNum("vtRealEstateWithholding"), vtK1EntityPayments: getVal("vtK1EntityPayments") === "" ? null : getNum("vtK1EntityPayments"),
    vtUnderpaymentInterestPenalty: getVal("vtUnderpaymentInterestPenalty") === "" ? null : getNum("vtUnderpaymentInterestPenalty"), vtCreditToNextYear: getVal("vtCreditToNextYear") === "" ? null : getNum("vtCreditToNextYear"), vtCreditToPropertyTaxBill: getVal("vtCreditToPropertyTaxBill") === "" ? null : getNum("vtCreditToPropertyTaxBill"),
    vtHasAmendedOrOtherSpecialItems: getVal("vtHasAmendedOrOtherSpecialItems") === "" ? null : getVal("vtHasAmendedOrOtherSpecialItems") === "yes",

    dcFullYearResident: getVal("dcFullYearResident") === "" ? null : getVal("dcFullYearResident") === "yes",
    dcHasFilingStatusException: getVal("dcHasFilingStatusException") === "" ? null : getVal("dcHasFilingStatusException") === "yes",
    dcDeductionMethod: getVal("dcDeductionMethod"), dcTaxpayerBlind: getVal("dcTaxpayerBlind") === "" ? null : getVal("dcTaxpayerBlind") === "yes", dcSpouseBlind: getVal("dcSpouseBlind") === "" ? null : getVal("dcSpouseBlind") === "yes",
    dcFullYearHealthCoverageOrExempt: getVal("dcFullYearHealthCoverageOrExempt") === "" ? null : getVal("dcFullYearHealthCoverageOrExempt") === "yes", dcClaimsEITC: getVal("dcClaimsEITC") === "" ? null : getVal("dcClaimsEITC") === "yes", dcClaimsScheduleH: getVal("dcClaimsScheduleH") === "" ? null : getVal("dcClaimsScheduleH") === "yes",
    dcHasOtherJurisdictionCredit: getVal("dcHasOtherJurisdictionCredit") === "" ? null : getVal("dcHasOtherJurisdictionCredit") === "yes", dcHasD30UnincorporatedBusiness: getVal("dcHasD30UnincorporatedBusiness") === "" ? null : getVal("dcHasD30UnincorporatedBusiness") === "yes", dcHasNoncustodialEITC: getVal("dcHasNoncustodialEITC") === "" ? null : getVal("dcHasNoncustodialEITC") === "yes", dcHasAmendedOrOtherSpecialItems: getVal("dcHasAmendedOrOtherSpecialItems") === "" ? null : getVal("dcHasAmendedOrOtherSpecialItems") === "yes",
    dcFranchiseTaxAddback: getVal("dcFranchiseTaxAddback") === "" ? null : getNum("dcFranchiseTaxAddback"), dcOtherAdditions: getVal("dcOtherAdditions") === "" ? null : getNum("dcOtherAdditions"), dcStateLocalRefundSubtraction: getVal("dcStateLocalRefundSubtraction") === "" ? null : getNum("dcStateLocalRefundSubtraction"), dcTaxableSocialSecuritySubtraction: getVal("dcTaxableSocialSecuritySubtraction") === "" ? null : getNum("dcTaxableSocialSecuritySubtraction"),
    dcFranchiseFiduciaryIncomeSubtraction: getVal("dcFranchiseFiduciaryIncomeSubtraction") === "" ? null : getNum("dcFranchiseFiduciaryIncomeSubtraction"), dcSurvivorBenefitsSubtraction: getVal("dcSurvivorBenefitsSubtraction") === "" ? null : getNum("dcSurvivorBenefitsSubtraction"), dcUnemploymentSubtraction: getVal("dcUnemploymentSubtraction") === "" ? null : getNum("dcUnemploymentSubtraction"), dcOtherSubtractions: getVal("dcOtherSubtractions") === "" ? null : getNum("dcOtherSubtractions"),
    dcFederalItemizedDeductions: getVal("dcFederalItemizedDeductions") === "" ? null : getNum("dcFederalItemizedDeductions"), dcFederalStateLocalTaxDeduction: getVal("dcFederalStateLocalTaxDeduction") === "" ? null : getNum("dcFederalStateLocalTaxDeduction"), dcFederalRealEstateTax: getVal("dcFederalRealEstateTax") === "" ? null : getNum("dcFederalRealEstateTax"), dcFederalOtherTaxes: getVal("dcFederalOtherTaxes") === "" ? null : getNum("dcFederalOtherTaxes"), dcProtectedItemizedDeductions: getVal("dcProtectedItemizedDeductions") === "" ? null : getNum("dcProtectedItemizedDeductions"),
    dcFederalChildDependentCareCredit: getVal("dcFederalChildDependentCareCredit") === "" ? null : getNum("dcFederalChildDependentCareCredit"), dcOtherNonrefundableCredits: getVal("dcOtherNonrefundableCredits") === "" ? null : getNum("dcOtherNonrefundableCredits"), dcHealthCareSharedResponsibilityPayment: getVal("dcHealthCareSharedResponsibilityPayment") === "" ? null : getNum("dcHealthCareSharedResponsibilityPayment"),
    dcEitcQualifyingChildCount: getVal("dcEitcQualifyingChildCount") === "" ? null : Number(getVal("dcEitcQualifyingChildCount")), dcCalculatedFederalEITCAmount: getVal("dcCalculatedFederalEITCAmount") === "" ? null : getNum("dcCalculatedFederalEITCAmount"), dcChildlessEarnedIncome: getVal("dcChildlessEarnedIncome") === "" ? null : getNum("dcChildlessEarnedIncome"), dcScheduleHCredit: getVal("dcScheduleHCredit") === "" ? null : getNum("dcScheduleHCredit"),
    dcOtherRefundableCredits: getVal("dcOtherRefundableCredits") === "" ? null : getNum("dcOtherRefundableCredits"), dcOtherWithholding: getVal("dcOtherWithholding") === "" ? null : getNum("dcOtherWithholding"), dcEstimatedPayments: getVal("dcEstimatedPayments") === "" ? null : getNum("dcEstimatedPayments"), dcExtensionPayment: getVal("dcExtensionPayment") === "" ? null : getNum("dcExtensionPayment"), dcUnderpaymentInterest: getVal("dcUnderpaymentInterest") === "" ? null : getNum("dcUnderpaymentInterest"), dcCreditToNextYear: getVal("dcCreditToNextYear") === "" ? null : getNum("dcCreditToNextYear"), dcVoluntaryContributions: getVal("dcVoluntaryContributions") === "" ? null : getNum("dcVoluntaryContributions"),

    maFullYearResident: getVal("maFullYearResident") === "" ? null : getVal("maFullYearResident") === "yes",
    maHasFilingStatusException: getVal("maHasFilingStatusException") === "" ? null : getVal("maHasFilingStatusException") === "yes",
    maElectsOptional585Rate: getVal("maElectsOptional585Rate") === "" ? null : getVal("maElectsOptional585Rate") === "yes",
    maTaxpayerBlind: getVal("maTaxpayerBlind") === "" ? null : getVal("maTaxpayerBlind") === "yes",
    maSpouseBlind: getVal("maSpouseBlind") === "" ? null : getVal("maSpouseBlind") === "yes",
    maClaimedFederalEITC: getVal("maClaimedFederalEITC") === "" ? null : getVal("maClaimedFederalEITC") === "yes",
    maHasOtherJurisdictionCredit: getVal("maHasOtherJurisdictionCredit") === "" ? null : getVal("maHasOtherJurisdictionCredit") === "yes",
    maHasAmendedOrOtherSpecialItems: getVal("maHasAmendedOrOtherSpecialItems") === "" ? null : getVal("maHasAmendedOrOtherSpecialItems") === "yes",
    maTotalFivePercentIncome: getVal("maTotalFivePercentIncome") === "" ? null : getNum("maTotalFivePercentIncome"), maTotalDeductions: getVal("maTotalDeductions") === "" ? null : getNum("maTotalDeductions"), maMassachusettsAGI: getVal("maMassachusettsAGI") === "" ? null : getNum("maMassachusettsAGI"),
    maMedicalDentalExemption: getVal("maMedicalDentalExemption") === "" ? null : getNum("maMedicalDentalExemption"), maAdoptionExemption: getVal("maAdoptionExemption") === "" ? null : getNum("maAdoptionExemption"), maScheduleBLine20: getVal("maScheduleBLine20") === "" ? null : getNum("maScheduleBLine20"),
    maScheduleB85Income: getVal("maScheduleB85Income") === "" ? null : getNum("maScheduleB85Income"), maScheduleB12Income: getVal("maScheduleB12Income") === "" ? null : getNum("maScheduleB12Income"), maScheduleBLine37SurtaxIncome: getVal("maScheduleBLine37SurtaxIncome") === "" ? null : getNum("maScheduleBLine37SurtaxIncome"), maScheduleDLine21SurtaxIncome: getVal("maScheduleDLine21SurtaxIncome") === "" ? null : getNum("maScheduleDLine21SurtaxIncome"),
    maLongTermCapitalGainsTax: getVal("maLongTermCapitalGainsTax") === "" ? null : getNum("maLongTermCapitalGainsTax"), maCreditRecapture: getVal("maCreditRecapture") === "" ? null : getNum("maCreditRecapture"), maInstallmentSaleAdditionalTax: getVal("maInstallmentSaleAdditionalTax") === "" ? null : getNum("maInstallmentSaleAdditionalTax"),
    maOtherNonrefundableCredits: getVal("maOtherNonrefundableCredits") === "" ? null : getNum("maOtherNonrefundableCredits"), maVoluntaryContributions: getVal("maVoluntaryContributions") === "" ? null : getNum("maVoluntaryContributions"), maUseTax: getVal("maUseTax") === "" ? null : getNum("maUseTax"), maHealthCarePenalty: getVal("maHealthCarePenalty") === "" ? null : getNum("maHealthCarePenalty"),
    maFederalEITCAmount: getVal("maFederalEITCAmount") === "" ? null : getNum("maFederalEITCAmount"), maSeniorCircuitBreakerCredit: getVal("maSeniorCircuitBreakerCredit") === "" ? null : getNum("maSeniorCircuitBreakerCredit"), maChildFamilyQualifyingCount: getVal("maChildFamilyQualifyingCount") === "" ? null : Number(getVal("maChildFamilyQualifyingCount")), maOtherRefundableCredits: getVal("maOtherRefundableCredits") === "" ? null : getNum("maOtherRefundableCredits"),
    maOtherMassachusettsWithholding: getVal("maOtherMassachusettsWithholding") === "" ? null : getNum("maOtherMassachusettsWithholding"), maPriorYearOverpaymentApplied: getVal("maPriorYearOverpaymentApplied") === "" ? null : getNum("maPriorYearOverpaymentApplied"), maEstimatedPayments: getVal("maEstimatedPayments") === "" ? null : getNum("maEstimatedPayments"), maExtensionPayments: getVal("maExtensionPayments") === "" ? null : getNum("maExtensionPayments"),
    maExcessPfmlWithholding: getVal("maExcessPfmlWithholding") === "" ? null : getNum("maExcessPfmlWithholding"), maRealEstateWithholding: getVal("maRealEstateWithholding") === "" ? null : getNum("maRealEstateWithholding"), maPenaltyInterest: getVal("maPenaltyInterest") === "" ? null : getNum("maPenaltyInterest"), maCreditToNextYear: getVal("maCreditToNextYear") === "" ? null : getNum("maCreditToNextYear"),

    ksFullYearResident: getVal("ksFullYearResident") === "" ? null : getVal("ksFullYearResident") === "yes",
    ksNetModifications: getVal("ksNetModifications") === "" ? null : getNum("ksNetModifications"),
    ksDeductionMethod: getVal("ksDeductionMethod"),
    ksDeductionAmount: getVal("ksDeductionAmount") === "" ? null : getNum("ksDeductionAmount"),
    ksMfsSpouseSameDeductionMethod: getVal("ksMfsSpouseSameDeductionMethod") === "" ? null : getVal("ksMfsSpouseSameDeductionMethod") === "yes",
    ksNewbornDependentCount: getVal("ksNewbornDependentCount") === "" ? null : Number(getVal("ksNewbornDependentCount")),
    ksStillbirthCount: getVal("ksStillbirthCount") === "" ? null : Number(getVal("ksStillbirthCount")),
    ksDisabledVeteranCount: getVal("ksDisabledVeteranCount") === "" ? null : Number(getVal("ksDisabledVeteranCount")),
    ksLumpSumDistributionTax: getVal("ksLumpSumDistributionTax") === "" ? null : getNum("ksLumpSumDistributionTax"),
    ksHasOtherStateCredit: getVal("ksHasOtherStateCredit") === "" ? null : getVal("ksHasOtherStateCredit") === "yes",
    ksFederalChildDependentCareCredit: getVal("ksFederalChildDependentCareCredit") === "" ? null : getNum("ksFederalChildDependentCareCredit"),
    ksOtherNonrefundableCredits: getVal("ksOtherNonrefundableCredits") === "" ? null : getNum("ksOtherNonrefundableCredits"),
    ksFederalEITCAmount: getVal("ksFederalEITCAmount") === "" ? null : getNum("ksFederalEITCAmount"),
    ksCreditSsnEligibilityConfirmed: getVal("ksCreditSsnEligibilityConfirmed") === "" ? null : getVal("ksCreditSsnEligibilityConfirmed") === "yes",
    ksOtherFormWithholding: getVal("ksOtherFormWithholding") === "" ? null : getNum("ksOtherFormWithholding"),
    ksEstimatedPayments: getVal("ksEstimatedPayments") === "" ? null : getNum("ksEstimatedPayments"),
    ksExtensionPayment: getVal("ksExtensionPayment") === "" ? null : getNum("ksExtensionPayment"),
    ksOtherRefundableCredits: getVal("ksOtherRefundableCredits") === "" ? null : getNum("ksOtherRefundableCredits"),
    ksPtetCredit: getVal("ksPtetCredit") === "" ? null : getNum("ksPtetCredit"),
    ksInterest: getVal("ksInterest") === "" ? null : getNum("ksInterest"),
    ksLatePaymentPenalty: getVal("ksLatePaymentPenalty") === "" ? null : getNum("ksLatePaymentPenalty"),
    ksEstimatedTaxPenalty: getVal("ksEstimatedTaxPenalty") === "" ? null : getNum("ksEstimatedTaxPenalty"),
    ksCreditForward: getVal("ksCreditForward") === "" ? null : getNum("ksCreditForward"),
    ksContributions: getVal("ksContributions") === "" ? null : getNum("ksContributions"),
    ksHasSeparatePropertyTaxRefundClaim: getVal("ksHasSeparatePropertyTaxRefundClaim") === "" ? null : getVal("ksHasSeparatePropertyTaxRefundClaim") === "yes",
    ksHasAmendedOrOtherSpecialItems: getVal("ksHasAmendedOrOtherSpecialItems") === "" ? null : getVal("ksHasAmendedOrOtherSpecialItems") === "yes",
    neFullYearResident: getVal("neFullYearResident") === "" ? null : getVal("neFullYearResident") === "yes",
    neStandardDeduction: getVal("neStandardDeduction") === "" ? null : getNum("neStandardDeduction"),
    neFederalItemizedDeductions: getVal("neFederalItemizedDeductions") === "" ? null : getNum("neFederalItemizedDeductions"),
    neStateLocalIncomeTaxes: getVal("neStateLocalIncomeTaxes") === "" ? null : getNum("neStateLocalIncomeTaxes"),
    neScheduleIIncreases: getVal("neScheduleIIncreases") === "" ? null : getNum("neScheduleIIncreases"),
    neScheduleIDecreases: getVal("neScheduleIDecreases") === "" ? null : getNum("neScheduleIDecreases"),
    neFederalLumpSumTax: getVal("neFederalLumpSumTax") === "" ? null : getNum("neFederalLumpSumTax"),
    neFederalEarlyDistributionTax: getVal("neFederalEarlyDistributionTax") === "" ? null : getNum("neFederalEarlyDistributionTax"),
    neSpouseCanBeClaimedAsDependent: getVal("neSpouseCanBeClaimedAsDependent") === "" ? null : getVal("neSpouseCanBeClaimedAsDependent") === "yes",
    neOtherNonrefundableCredits: getVal("neOtherNonrefundableCredits") === "" ? null : getNum("neOtherNonrefundableCredits"),
    neFederalTaxBeforeCreditsLimit: getVal("neFederalTaxBeforeCreditsLimit") === "" ? null : getNum("neFederalTaxBeforeCreditsLimit"),
    neHasOtherStateCredit: getVal("neHasOtherStateCredit") === "" ? null : getVal("neHasOtherStateCredit") === "yes",
    neOtherFormWithholding: getVal("neOtherFormWithholding") === "" ? null : getNum("neOtherFormWithholding"),
    neK1Withholding: getVal("neK1Withholding") === "" ? null : getNum("neK1Withholding"),
    nePtetCredit: getVal("nePtetCredit") === "" ? null : getNum("nePtetCredit"),
    neEstimatedPayments: getVal("neEstimatedPayments") === "" ? null : getNum("neEstimatedPayments"),
    neForm3800RefundableCredit: getVal("neForm3800RefundableCredit") === "" ? null : getNum("neForm3800RefundableCredit"),
    neChildDependentCareRefundableCredit: getVal("neChildDependentCareRefundableCredit") === "" ? null : getNum("neChildDependentCareRefundableCredit"),
    neBeginningFarmerCredit: getVal("neBeginningFarmerCredit") === "" ? null : getNum("neBeginningFarmerCredit"),
    neFederalEITCAmount: getVal("neFederalEITCAmount") === "" ? null : getNum("neFederalEITCAmount"),
    neOtherRefundableCredits: getVal("neOtherRefundableCredits") === "" ? null : getNum("neOtherRefundableCredits"),
    neUnderpaymentPenalty: getVal("neUnderpaymentPenalty") === "" ? null : getNum("neUnderpaymentPenalty"),
    neUseTax: getVal("neUseTax") === "" ? null : getNum("neUseTax"),
    neUseTaxRequiresSeparateForm3: getVal("neUseTaxRequiresSeparateForm3") === "" ? null : getVal("neUseTaxRequiresSeparateForm3") === "yes",
    neApplyToNextYear: getVal("neApplyToNextYear") === "" ? null : getNum("neApplyToNextYear"),
    neWildlifeDonation: getVal("neWildlifeDonation") === "" ? null : getNum("neWildlifeDonation"),
    neHasFederalNolEitcSpecialCase: getVal("neHasFederalNolEitcSpecialCase") === "" ? null : getVal("neHasFederalNolEitcSpecialCase") === "yes",
    neHasAmendedOrOtherSpecialItems: getVal("neHasAmendedOrOtherSpecialItems") === "" ? null : getVal("neHasAmendedOrOtherSpecialItems") === "yes",
    iaFullYearResident: getVal("iaFullYearResident") === "" ? null : getVal("iaFullYearResident") === "yes",
    iaFederalTaxableIncomeLine2: getVal("iaFederalTaxableIncomeLine2") === "" ? null : getSignedNum("iaFederalTaxableIncomeLine2"),
    iaNetIowaModifications: getVal("iaNetIowaModifications") === "" ? null : getNum("iaNetIowaModifications"),
    iaFederalDeductionForSpecialCalc: getVal("iaFederalDeductionForSpecialCalc") === "" ? null : getNum("iaFederalDeductionForSpecialCalc"),
    iaFederalPersonalExemptionForSpecialCalc: getVal("iaFederalPersonalExemptionForSpecialCalc") === "" ? null : getNum("iaFederalPersonalExemptionForSpecialCalc"),
    iaQualifiedBusinessIncomeDeduction: getVal("iaQualifiedBusinessIncomeDeduction") === "" ? null : getNum("iaQualifiedBusinessIncomeDeduction"),
    iaNolCarryover: getVal("iaNolCarryover") === "" ? null : getNum("iaNolCarryover"),
    iaLumpSumDistributionTaxableIncome: getVal("iaLumpSumDistributionTaxableIncome") === "" ? null : getNum("iaLumpSumDistributionTaxableIncome"),
    iaTaxpayerBlind: getVal("iaTaxpayerBlind") === "" ? null : getVal("iaTaxpayerBlind") === "yes",
    iaSpouseBlind: getVal("iaSpouseBlind") === "" ? null : getVal("iaSpouseBlind") === "yes",
    iaMfsSpouseIowaTaxableIncome: getVal("iaMfsSpouseIowaTaxableIncome") === "" ? null : getNum("iaMfsSpouseIowaTaxableIncome"),
    iaMfsSpouseAdjustedIncome: getVal("iaMfsSpouseAdjustedIncome") === "" ? null : getNum("iaMfsSpouseAdjustedIncome"),
    iaMfsSpouseNolCarryover: getVal("iaMfsSpouseNolCarryover") === "" ? null : getNum("iaMfsSpouseNolCarryover"),
    iaLumpSumTax: getVal("iaLumpSumTax") === "" ? null : getNum("iaLumpSumTax"),
    iaTuitionTextbookCredit: getVal("iaTuitionTextbookCredit") === "" ? null : getNum("iaTuitionTextbookCredit"),
    iaVolunteerCredit: getVal("iaVolunteerCredit") === "" ? null : getNum("iaVolunteerCredit"),
    iaOtherNonrefundableCredits: getVal("iaOtherNonrefundableCredits") === "" ? null : getNum("iaOtherNonrefundableCredits"),
    iaHasOutOfStateTaxCredit: getVal("iaHasOutOfStateTaxCredit") === "" ? null : getVal("iaHasOutOfStateTaxCredit") === "yes",
    iaSchoolDistrictEmsSurtaxRate: getVal("iaSchoolDistrictEmsSurtaxRate") === "" ? null : Number(getVal("iaSchoolDistrictEmsSurtaxRate")),
    iaContributions: getVal("iaContributions") === "" ? null : getNum("iaContributions"),
    iaFuelTaxCredit: getVal("iaFuelTaxCredit") === "" ? null : getNum("iaFuelTaxCredit"),
    iaChildDependentOrEarlyChildhoodCredit: getVal("iaChildDependentOrEarlyChildhoodCredit") === "" ? null : getNum("iaChildDependentOrEarlyChildhoodCredit"),
    iaEarnedIncomeTaxCredit: getVal("iaEarnedIncomeTaxCredit") === "" ? null : getNum("iaEarnedIncomeTaxCredit"),
    iaOtherRefundableCredits: getVal("iaOtherRefundableCredits") === "" ? null : getNum("iaOtherRefundableCredits"),
    iaCompositePtetCredit: getVal("iaCompositePtetCredit") === "" ? null : getNum("iaCompositePtetCredit"),
    iaEstimatedAndOtherPayments: getVal("iaEstimatedAndOtherPayments") === "" ? null : getNum("iaEstimatedAndOtherPayments"),
    iaUnderpaymentPenalty: getVal("iaUnderpaymentPenalty") === "" ? null : getNum("iaUnderpaymentPenalty"),
    iaOtherPenaltyInterest: getVal("iaOtherPenaltyInterest") === "" ? null : getNum("iaOtherPenaltyInterest"),
    iaHasAmendedOrOtherSpecialItems: getVal("iaHasAmendedOrOtherSpecialItems") === "" ? null : getVal("iaHasAmendedOrOtherSpecialItems") === "yes",
    mnFullYearResident: getVal("mnFullYearResident") === "" ? null : getVal("mnFullYearResident") === "yes",
    mnM1Additions: getVal("mnM1Additions") === "" ? null : getNum("mnM1Additions"),
    mnUseItemizedDeductions: getVal("mnUseItemizedDeductions") === "" ? null : getVal("mnUseItemizedDeductions") === "yes",
    mnItemizedDeductions: getVal("mnItemizedDeductions") === "" ? null : getNum("mnItemizedDeductions"),
    mnTaxpayerBlind: getVal("mnTaxpayerBlind") === "" ? null : getVal("mnTaxpayerBlind") === "yes",
    mnSpouseBlind: getVal("mnSpouseBlind") === "" ? null : getVal("mnSpouseBlind") === "yes",
    mnMfsSpouseItemizes: getVal("mnMfsSpouseItemizes") === "" ? null : getVal("mnMfsSpouseItemizes") === "yes",
    mnMfsSpouseNoGrossIncomeAndNotDependent: getVal("mnMfsSpouseNoGrossIncomeAndNotDependent") === "" ? null : getVal("mnMfsSpouseNoGrossIncomeAndNotDependent") === "yes",
    mnSpouseCanBeClaimedAsDependent: getVal("mnSpouseCanBeClaimedAsDependent") === "" ? null : getVal("mnSpouseCanBeClaimedAsDependent") === "yes",
    mnDependentEarnedIncome: getVal("mnDependentEarnedIncome") === "" ? null : getNum("mnDependentEarnedIncome"),
    mnHasM1NCFederalAdjustments: getVal("mnHasM1NCFederalAdjustments") === "" ? null : getVal("mnHasM1NCFederalAdjustments") === "yes",
    mnM1NCWorksheetAGI: getVal("mnM1NCWorksheetAGI") === "" ? null : getNum("mnM1NCWorksheetAGI"),
    mnStateIncomeTaxRefund: getVal("mnStateIncomeTaxRefund") === "" ? null : getNum("mnStateIncomeTaxRefund"),
    mnM1Subtractions: getVal("mnM1Subtractions") === "" ? null : getNum("mnM1Subtractions"),
    mnAlternativeMinimumTax: getVal("mnAlternativeMinimumTax") === "" ? null : getNum("mnAlternativeMinimumTax"),
    mnOtherTaxes: getVal("mnOtherTaxes") === "" ? null : getNum("mnOtherTaxes"),
    mnAdvanceChildTaxCreditRepayment: getVal("mnAdvanceChildTaxCreditRepayment") === "" ? null : getNum("mnAdvanceChildTaxCreditRepayment"),
    mnNonrefundableCredits: getVal("mnNonrefundableCredits") === "" ? null : getNum("mnNonrefundableCredits"),
    mnNongameWildlifeContribution: getVal("mnNongameWildlifeContribution") === "" ? null : getNum("mnNongameWildlifeContribution"),
    mnEstimatedPayments: getVal("mnEstimatedPayments") === "" ? null : getNum("mnEstimatedPayments"),
    mnRefundableCredits: getVal("mnRefundableCredits") === "" ? null : getNum("mnRefundableCredits"),
    mnScheduleM15Penalty: getVal("mnScheduleM15Penalty") === "" ? null : getNum("mnScheduleM15Penalty"),
    mnOtherPenaltyInterest: getVal("mnOtherPenaltyInterest") === "" ? null : getNum("mnOtherPenaltyInterest"),
    mnHasOtherStateCreditOrReciprocity: getVal("mnHasOtherStateCreditOrReciprocity") === "" ? null : getVal("mnHasOtherStateCreditOrReciprocity") === "yes",
    mnShortPeriodOrNonresidentAlien: getVal("mnShortPeriodOrNonresidentAlien") === "" ? null : getVal("mnShortPeriodOrNonresidentAlien") === "yes",
    mnHasAmendedOrOtherSpecialItems: getVal("mnHasAmendedOrOtherSpecialItems") === "" ? null : getVal("mnHasAmendedOrOtherSpecialItems") === "yes",
    wiFullYearResident: getVal("wiFullYearResident") === "" ? null : getVal("wiFullYearResident") === "yes",
    wiScheduleIAdjustment: getVal("wiScheduleIAdjustment") === "" ? null : getNum("wiScheduleIAdjustment"),
    wiScheduleADAdditions: getVal("wiScheduleADAdditions") === "" ? null : getNum("wiScheduleADAdditions"),
    wiScheduleSBSubtractions: getVal("wiScheduleSBSubtractions") === "" ? null : getNum("wiScheduleSBSubtractions"),
    wiShortPeriodOrPossessions: getVal("wiShortPeriodOrPossessions") === "" ? null : getVal("wiShortPeriodOrPossessions") === "yes",
    wiSpouseCanBeClaimedAsDependent: getVal("wiSpouseCanBeClaimedAsDependent") === "" ? null : getVal("wiSpouseCanBeClaimedAsDependent") === "yes",
    wiDependentEarnedIncome: getVal("wiDependentEarnedIncome") === "" ? null : getNum("wiDependentEarnedIncome"),
    wiUsedNewRetirementIncomeSubtraction: getVal("wiUsedNewRetirementIncomeSubtraction") === "" ? null : getVal("wiUsedNewRetirementIncomeSubtraction") === "yes",
    wiNonrefundableCredits: getVal("wiNonrefundableCredits") === "" ? null : getNum("wiNonrefundableCredits"),
    wiClaimedFederalEIC: getVal("wiClaimedFederalEIC") === "" ? null : getVal("wiClaimedFederalEIC") === "yes",
    wiFederalEICAmount: getVal("wiFederalEICAmount") === "" ? null : getNum("wiFederalEICAmount"),
    wiEICQualifyingChildren: getVal("wiEICQualifyingChildren") === "" ? null : Number(getVal("wiEICQualifyingChildren")),
    wiOtherRefundableCredits: getVal("wiOtherRefundableCredits") === "" ? null : getNum("wiOtherRefundableCredits"),
    wiUseTax: getVal("wiUseTax") === "" ? null : getNum("wiUseTax"),
    wiDonations: getVal("wiDonations") === "" ? null : getNum("wiDonations"),
    wiRetirementPenaltiesAndCreditRepayments: getVal("wiRetirementPenaltiesAndCreditRepayments") === "" ? null : getNum("wiRetirementPenaltiesAndCreditRepayments"),
    wiEstimatedPayments: getVal("wiEstimatedPayments") === "" ? null : getNum("wiEstimatedPayments"),
    wiUnderpaymentInterest: getVal("wiUnderpaymentInterest") === "" ? null : getNum("wiUnderpaymentInterest"),
    wiHasOtherStateCreditOrReciprocity: getVal("wiHasOtherStateCreditOrReciprocity") === "" ? null : getVal("wiHasOtherStateCreditOrReciprocity") === "yes",
    wiHasAmendedOrOtherSpecialItems: getVal("wiHasAmendedOrOtherSpecialItems") === "" ? null : getVal("wiHasAmendedOrOtherSpecialItems") === "yes",
    miFullYearResident:
      getVal("miFullYearResident") === "" ? null : getVal("miFullYearResident") === "yes",
    miMfsMichiganFilingChoice: getVal("miMfsMichiganFilingChoice"),
    miOtherAdditions:
      getVal("miOtherAdditions") === "" ? null : roundTaxDollar(numVal("miOtherAdditions")),
    miTaxableSocialSecurity:
      getVal("miTaxableSocialSecurity") === "" ? null : roundTaxDollar(numVal("miTaxableSocialSecurity")),
    miOtherSubtractions:
      getVal("miOtherSubtractions") === "" ? null : roundTaxDollar(numVal("miOtherSubtractions")),
    miSpecialExemptionCount:
      getVal("miSpecialExemptionCount") === "" ? null : parseInt(getVal("miSpecialExemptionCount"), 10) || 0,
    miQualifiedDisabledVeteranCount:
      getVal("miQualifiedDisabledVeteranCount") === "" ? null : parseInt(getVal("miQualifiedDisabledVeteranCount"), 10) || 0,
    miStillbirthCount:
      getVal("miStillbirthCount") === "" ? null : parseInt(getVal("miStillbirthCount"), 10) || 0,
    miClaimedFederalEIC:
      getVal("miClaimedFederalEIC") === "" ? null : getVal("miClaimedFederalEIC") === "yes",
    miFederalEICAmount: roundTaxDollar(numVal("miFederalEICAmount")),
    miHasRetirementPensionOrSeniorDeduction:
      getVal("miHasRetirementPensionOrSeniorDeduction") === "" ? null : getVal("miHasRetirementPensionOrSeniorDeduction") === "yes",
    miHasPA24DecouplingAdjustment:
      getVal("miHasPA24DecouplingAdjustment") === "" ? null : getVal("miHasPA24DecouplingAdjustment") === "yes",
    miHasOtherStateCreditOrAllocation:
      getVal("miHasOtherStateCreditOrAllocation") === "" ? null : getVal("miHasOtherStateCreditOrAllocation") === "yes",
    miHasDetroitCityReturn:
      getVal("miHasDetroitCityReturn") === "" ? null : getVal("miHasDetroitCityReturn") === "yes",
    miHasUseTax:
      getVal("miHasUseTax") === "" ? null : getVal("miHasUseTax") === "yes",
    miUseTax: roundTaxDollar(numVal("miUseTax")),
    miEstimatedAndExtensionPayments: roundTaxDollar(numVal("miEstimatedAndExtensionPayments")),
    miHasSeparateRefundableCredits:
      getVal("miHasSeparateRefundableCredits") === "" ? null : getVal("miHasSeparateRefundableCredits") === "yes",
    miHasOtherSpecialItems:
      getVal("miHasOtherSpecialItems") === "" ? null : getVal("miHasOtherSpecialItems") === "yes",
    wvFullYearResident:
      getVal("wvFullYearResident") === ""
        ? null
        : getVal("wvFullYearResident") === "yes",
    wvTotalAdditions:
      getVal("wvTotalAdditions") === ""
        ? null
        : roundTaxDollar(numVal("wvTotalAdditions")),
    wvOtherSubtractions:
      getVal("wvOtherSubtractions") === ""
        ? null
        : roundTaxDollar(numVal("wvOtherSubtractions")),
    wvTaxableSocialSecurity:
      getVal("wvTaxableSocialSecurity") === ""
        ? null
        : roundTaxDollar(numVal("wvTaxableSocialSecurity")),
    wvLowIncomeEarnedIncome:
      getVal("wvLowIncomeEarnedIncome") === ""
        ? null
        : roundTaxDollar(numVal("wvLowIncomeEarnedIncome")),
    wvSpouseCanBeClaimedAsDependent:
      getVal("wvSpouseCanBeClaimedAsDependent") === ""
        ? null
        : getVal("wvSpouseCanBeClaimedAsDependent") === "yes",
    wvSurvivingSpouseExemption:
      getVal("wvSurvivingSpouseExemption") === ""
        ? null
        : getVal("wvSurvivingSpouseExemption") === "yes",
    wvTaxExemptInterestForFamilyCredit:
      getVal("wvTaxExemptInterestForFamilyCredit") === ""
        ? null
        : roundTaxDollar(numVal("wvTaxExemptInterestForFamilyCredit")),
    wvFederalAMT:
      getVal("wvFederalAMT") === ""
        ? null
        : getVal("wvFederalAMT") === "yes",
    wvHasChildDependentCareCredit:
      getVal("wvHasChildDependentCareCredit") === ""
        ? null
        : getVal("wvHasChildDependentCareCredit") === "yes",
    wvFederalChildDependentCareCredit:
      roundTaxDollar(numVal("wvFederalChildDependentCareCredit")),
    wvHasOtherStateTaxCredit:
      getVal("wvHasOtherStateTaxCredit") === ""
        ? null
        : getVal("wvHasOtherStateTaxCredit") === "yes",
    wvHasUseTax:
      getVal("wvHasUseTax") === ""
        ? null
        : getVal("wvHasUseTax") === "yes",
    wvUseTax: roundTaxDollar(numVal("wvUseTax")),
    wvEstimatedAndExtensionPayments:
      roundTaxDollar(numVal("wvEstimatedAndExtensionPayments")),
    wvHasOtherSpecialItems:
      getVal("wvHasOtherSpecialItems") === ""
        ? null
        : getVal("wvHasOtherSpecialItems") === "yes",
    vaFullYearResident:
      getVal("vaFullYearResident") === ""
        ? null
        : getVal("vaFullYearResident") === "yes",
    vaFederalItemized:
      getVal("vaFederalItemized") === ""
        ? null
        : getVal("vaFederalItemized") === "yes",
    vaItemizedDeductions:
      getVal("vaItemizedDeductions") === ""
        ? null
        : roundTaxDollar(numVal("vaItemizedDeductions")),
    vaDependentEarnedIncome:
      getVal("vaDependentEarnedIncome") === ""
        ? null
        : roundTaxDollar(numVal("vaDependentEarnedIncome")),
    vaTotalAdditions:
      getVal("vaTotalAdditions") === ""
        ? null
        : roundTaxDollar(numVal("vaTotalAdditions")),
    vaAgeDeduction:
      getVal("vaAgeDeduction") === ""
        ? null
        : roundTaxDollar(numVal("vaAgeDeduction")),
    vaTaxableSocialSecurityTier1:
      getVal("vaTaxableSocialSecurityTier1") === ""
        ? null
        : roundTaxDollar(numVal("vaTaxableSocialSecurityTier1")),
    vaStateIncomeTaxRefund:
      getVal("vaStateIncomeTaxRefund") === ""
        ? null
        : roundTaxDollar(numVal("vaStateIncomeTaxRefund")),
    vaOtherSubtractions:
      getVal("vaOtherSubtractions") === ""
        ? null
        : roundTaxDollar(numVal("vaOtherSubtractions")),
    vaOtherDeductions:
      getVal("vaOtherDeductions") === ""
        ? null
        : roundTaxDollar(numVal("vaOtherDeductions")),
    vaAge65OrOlderCount:
      getVal("vaAge65OrOlderCount") === ""
        ? null
        : parseInt(getVal("vaAge65OrOlderCount"), 10),
    vaBlindCount:
      getVal("vaBlindCount") === ""
        ? null
        : parseInt(getVal("vaBlindCount"), 10),
    vaSpouseTaxAdjustment:
      getVal("vaSpouseTaxAdjustment") === ""
        ? null
        : roundTaxDollar(numVal("vaSpouseTaxAdjustment")),
    vaIncomeBasedCreditType: getVal("vaIncomeBasedCreditType"),
    vaIncomeBasedCreditAmount: roundTaxDollar(numVal("vaIncomeBasedCreditAmount")),
    vaHasOtherStateTaxCredit:
      getVal("vaHasOtherStateTaxCredit") === ""
        ? null
        : getVal("vaHasOtherStateTaxCredit") === "yes",
    vaHasUseTax:
      getVal("vaHasUseTax") === ""
        ? null
        : getVal("vaHasUseTax") === "yes",
    vaUseTax: roundTaxDollar(numVal("vaUseTax")),
    vaEstimatedTaxPayments: roundTaxDollar(numVal("vaEstimatedTaxPayments")),
    vaPriorYearOverpaymentApplied: roundTaxDollar(numVal("vaPriorYearOverpaymentApplied")),
    vaExtensionPayment: roundTaxDollar(numVal("vaExtensionPayment")),
    vaOtherWithholding: roundTaxDollar(numVal("vaOtherWithholding")),
    vaHasOtherSpecialItems:
      getVal("vaHasOtherSpecialItems") === ""
        ? null
        : getVal("vaHasOtherSpecialItems") === "yes",
    scFullYearResident:
      getVal("scFullYearResident") === ""
        ? null
        : getVal("scFullYearResident") === "yes",
    scTotalAdditions:
      getVal("scTotalAdditions") === ""
        ? null
        : roundTaxDollar(numVal("scTotalAdditions")),
    scOtherSubtractions:
      getVal("scOtherSubtractions") === ""
        ? null
        : roundTaxDollar(numVal("scOtherSubtractions")),
    scDependentsUnder6:
      getVal("scDependentsUnder6") === ""
        ? null
        : parseInt(getVal("scDependentsUnder6"), 10),
    scHasChildDependentCareCredit:
      getVal("scHasChildDependentCareCredit") === ""
        ? null
        : getVal("scHasChildDependentCareCredit") === "yes",
    scFederalChildCareExpense:
      getVal("scFederalChildCareExpense") === ""
        ? null
        : roundTaxDollar(numVal("scFederalChildCareExpense")),
    scChildCareQualifyingPersons:
      getVal("scChildCareQualifyingPersons") === ""
        ? null
        : parseInt(getVal("scChildCareQualifyingPersons"), 10),
    scHasTwoWageEarnerCredit:
      getVal("scHasTwoWageEarnerCredit") === ""
        ? null
        : getVal("scHasTwoWageEarnerCredit") === "yes",
    scTaxpayerQualifiedEarnedIncome:
      getVal("scTaxpayerQualifiedEarnedIncome") === ""
        ? null
        : roundTaxDollar(numVal("scTaxpayerQualifiedEarnedIncome")),
    scSpouseQualifiedEarnedIncome:
      getVal("scSpouseQualifiedEarnedIncome") === ""
        ? null
        : roundTaxDollar(numVal("scSpouseQualifiedEarnedIncome")),
    scClaimedFederalEIC:
      getVal("scClaimedFederalEIC") === ""
        ? null
        : getVal("scClaimedFederalEIC") === "yes",
    scFederalEICAmount:
      getVal("scFederalEICAmount") === ""
        ? null
        : roundTaxDollar(numVal("scFederalEICAmount")),
    scHasOtherStateTaxCredit:
      getVal("scHasOtherStateTaxCredit") === ""
        ? null
        : getVal("scHasOtherStateTaxCredit") === "yes",
    scHasUseTax:
      getVal("scHasUseTax") === ""
        ? null
        : getVal("scHasUseTax") === "yes",
    scUseTax:
      getVal("scUseTax") === ""
        ? null
        : roundTaxDollar(numVal("scUseTax")),
    scEstimatedTaxPayments: roundTaxDollar(numVal("scEstimatedTaxPayments")),
    scExtensionPayment: roundTaxDollar(numVal("scExtensionPayment")),
    scOtherWithholding: roundTaxDollar(numVal("scOtherWithholding")),
    scHasOtherSpecialItems:
      getVal("scHasOtherSpecialItems") === ""
        ? null
        : getVal("scHasOtherSpecialItems") === "yes",
    okFullYearResident:
      getVal("okFullYearResident") === ""
        ? null
        : getVal("okFullYearResident") === "yes",
    okHasNonresidentSpouseAllocation:
      getVal("okHasNonresidentSpouseAllocation") === ""
        ? null
        : getVal("okHasNonresidentSpouseAllocation") === "yes",
    okHasOutOfStatePropertyBusinessIncome:
      getVal("okHasOutOfStatePropertyBusinessIncome") === ""
        ? null
        : getVal("okHasOutOfStatePropertyBusinessIncome") === "yes",
    okOklahomaAGI:
      getVal("okOklahomaAGI") === ""
        ? null
        : roundTaxDollar(numVal("okOklahomaAGI")),
    okOklahomaIncomeAfterAdjustments:
      getVal("okOklahomaIncomeAfterAdjustments") === ""
        ? null
        : roundTaxDollar(numVal("okOklahomaIncomeAfterAdjustments")),
    okFederalItemized:
      getVal("okFederalItemized") === ""
        ? null
        : getVal("okFederalItemized") === "yes",
    okItemizedDeductions:
      getVal("okItemizedDeductions") === ""
        ? null
        : roundTaxDollar(numVal("okItemizedDeductions")),
    okRegularExemptions:
      getVal("okRegularExemptions") === ""
        ? null
        : parseInt(getVal("okRegularExemptions"), 10),
    okSpecial65Exemptions:
      getVal("okSpecial65Exemptions") === ""
        ? null
        : parseInt(getVal("okSpecial65Exemptions"), 10),
    okBlindExemptions:
      getVal("okBlindExemptions") === ""
        ? null
        : parseInt(getVal("okBlindExemptions"), 10),
    okQualifyingDependents:
      getVal("okQualifyingDependents") === ""
        ? null
        : parseInt(getVal("okQualifyingDependents"), 10),
    okHasFederalChildOrCareCredit:
      getVal("okHasFederalChildOrCareCredit") === ""
        ? null
        : getVal("okHasFederalChildOrCareCredit") === "yes",
    okFederalChildCareCredit:
      roundTaxDollar(numVal("okFederalChildCareCredit")),
    okFederalChildTaxCreditTotal:
      roundTaxDollar(numVal("okFederalChildTaxCreditTotal")),
    okHasOklahomaEIC:
      getVal("okHasOklahomaEIC") === ""
        ? null
        : getVal("okHasOklahomaEIC") === "yes",
    okFederalEIC2020Law:
      roundTaxDollar(numVal("okFederalEIC2020Law")),
    okUseTax:
      roundTaxDollar(numVal("okUseTax")),
    okEstimatedTaxPayments:
      roundTaxDollar(numVal("okEstimatedTaxPayments")),
    okExtensionPayment:
      roundTaxDollar(numVal("okExtensionPayment")),
    okHasOtherSpecialItems:
      getVal("okHasOtherSpecialItems") === ""
        ? null
        : getVal("okHasOtherSpecialItems") === "yes",
    arFullYearResident:
      getVal("arFullYearResident") === ""
        ? null
        : getVal("arFullYearResident") === "yes",
    arArkansasTotalIncome:
      getVal("arArkansasTotalIncome") === ""
        ? null
        : roundTaxDollar(numVal("arArkansasTotalIncome")),
    arArkansasAGI:
      getVal("arArkansasAGI") === ""
        ? null
        : roundTaxDollar(numVal("arArkansasAGI")),
    arItemizedDeductions:
      roundTaxDollar(numVal("arItemizedDeductions")),
    arQualifyingDependents:
      parseInt(getVal("arQualifyingDependents"), 10) || 0,
    arAdditionalPersonalCreditBoxes:
      parseInt(getVal("arAdditionalPersonalCreditBoxes"), 10) || 0,
    arMfsSameReturn:
      getVal("arMfsSameReturn") === ""
        ? null
        : getVal("arMfsSameReturn") === "yes",
    arMfsSpouseItemizes:
      getVal("arMfsSpouseItemizes") === ""
        ? null
        : getVal("arMfsSpouseItemizes") === "yes",
    arSurvivingSpouseConfirmed:
      getVal("arSurvivingSpouseConfirmed") === ""
        ? null
        : getVal("arSurvivingSpouseConfirmed") === "yes",
    arEstimatedTaxPayments:
      roundTaxDollar(numVal("arEstimatedTaxPayments")),
    arExtensionPayment:
      roundTaxDollar(numVal("arExtensionPayment")),
    arHasOtherSpecialItems:
      getVal("arHasOtherSpecialItems") === ""
        ? null
        : getVal("arHasOtherSpecialItems") === "yes",
    laFullYearResident:
      getVal("laFullYearResident") === ""
        ? null
        : getVal("laFullYearResident") === "yes",
    laFederalReturnRequired:
      getVal("laFederalReturnRequired") === ""
        ? null
        : getVal("laFederalReturnRequired") === "yes",
    laUsesScheduleE:
      getVal("laUsesScheduleE") === ""
        ? null
        : getVal("laUsesScheduleE") === "yes",
    laScheduleEAdjustedGrossIncome:
      getVal("laScheduleEAdjustedGrossIncome") === ""
        ? null
        : roundTaxDollar(numVal("laScheduleEAdjustedGrossIncome")),
    laFederalItemized:
      getVal("laFederalItemized") === ""
        ? null
        : getVal("laFederalItemized") === "yes",
    laFederalMedicalDentalDeduction:
      getVal("laFederalMedicalDentalDeduction") === ""
        ? null
        : roundTaxDollar(numVal("laFederalMedicalDentalDeduction")),
    laClaimedFederalEIC:
      getVal("laClaimedFederalEIC") === ""
        ? null
        : getVal("laClaimedFederalEIC") === "yes",
    laFederalEICAmount:
      getVal("laFederalEICAmount") === ""
        ? null
        : roundTaxDollar(numVal("laFederalEICAmount")),
    laEstimatedTaxPayments:
      roundTaxDollar(numVal("laEstimatedTaxPayments")),
    laExtensionPayment:
      roundTaxDollar(numVal("laExtensionPayment")),
    laHasOtherSpecialItems:
      getVal("laHasOtherSpecialItems") === ""
        ? null
        : getVal("laHasOtherSpecialItems") === "yes",
    ncSpouseItemizes:
      getVal("ncSpouseItemizes") === ""
        ? null
        : getVal("ncSpouseItemizes") === "yes",
    gaUnbornDependents:
      parseInt(getVal("gaUnbornDependents"), 10) || 0,
    kyFamilySize:
      getVal("kyFamilySize") === ""
        ? null
        : parseInt(getVal("kyFamilySize"), 10) || null,
    kyItemizedDeductions:
      roundTaxDollar(numVal("kyItemizedDeductions")),
    kyTaxpayerRetirementIncome:
      roundTaxDollar(numVal("kyTaxpayerRetirementIncome")),
    kySpouseRetirementIncome:
      roundTaxDollar(numVal("kySpouseRetirementIncome")),
    kySpecialPensionOverLimit:
      getVal("kySpecialPensionOverLimit") === ""
        ? null
        : getVal("kySpecialPensionOverLimit") === "yes",
    kyHasOtherStateModifications:
      getVal("kyHasOtherStateModifications") === ""
        ? null
        : getVal("kyHasOtherStateModifications") === "yes",
    kyHasChildDependentCareCredit:
      getVal("kyHasChildDependentCareCredit") === ""
        ? null
        : getVal("kyHasChildDependentCareCredit") === "yes",
    kyTaxpayerSpecialPersonalCredit:
      parseInt(getVal("kyTaxpayerSpecialPersonalCredit"), 10) || 0,
    kySpouseSpecialPersonalCredit:
      parseInt(getVal("kySpouseSpecialPersonalCredit"), 10) || 0,
    msItemizedDeductions:
      roundTaxDollar(numVal("msItemizedDeductions")),
    msExemptRetirementIncome:
      roundTaxDollar(numVal("msExemptRetirementIncome")),
    msTaxpayerBlind:
      getVal("msTaxpayerBlind") === "yes",
    msSpouseBlind:
      getVal("msSpouseBlind") === "yes",
    msSpouseShareOfMississippiAGI:
      getVal("msSpouseShareOfMississippiAGI") === ""
        ? null
        : roundTaxDollar(numVal("msSpouseShareOfMississippiAGI")),
    msHeadOfFamilyDependentLivedAllYear:
      getVal("msHeadOfFamilyDependentLivedAllYear") === ""
        ? null
        : getVal("msHeadOfFamilyDependentLivedAllYear") === "yes",
    msHasDependentCareCredit:
      getVal("msHasDependentCareCredit") === "yes",
    msHasOtherStateModifications:
      getVal("msHasOtherStateModifications") === ""
        ? null
        : getVal("msHasOtherStateModifications") === "yes",
    hasWorkingChildIncome: getRadio("hasWorkingChildIncome") === "yes",
    workingChildren: getRadio("hasWorkingChildIncome") === "yes" ? collectWorkingChildren() : [],
    w2Income: roundTaxDollar(numVal("w2Income")),
    w2SocialSecurityWages:
      optionalMoneyVal("w2SocialSecurityWages"),
    w2MedicareWages:
      optionalMoneyVal("w2MedicareWages"),
    w2MedicareTaxWithheld:
      optionalMoneyVal("w2MedicareTaxWithheld"),
    otherIncome: roundTaxDollar(numVal("otherIncome")),
    scholarships: roundTaxDollar(numVal("scholarships")),
    educationExpenses: roundTaxDollar(
      numVal("educationExpenses")
    ),
    federalWithheld: roundTaxDollar(
      numVal("federalWithheld")
    ),
    stateWithheld: roundTaxDollar(
      numVal("stateWithheld")
    ),
    selfEmploymentIncome: roundTaxDollar(
      totalSelfEmploymentIncome
    ),
    businessExpenses: roundTaxDollar(
      totalBusinessExpenses
    ),
    businessMileage: Math.round(
      numVal("businessMileage")
    ),
    businessMileageJanJun: Math.round(
      numVal("businessMileageJanJun")
    ),
    businessMileageJulDec: Math.round(
      numVal("businessMileageJulDec")
    ),
    estimatedTaxPayments: roundTaxDollar(
      numVal("estimatedTaxPayments")
    ),
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

  if (
    input.filingStatus === "mfj" &&
    (!input.spouseAge || input.spouseAge < 13 || input.spouseAge > 120)
  ) {
    errors.push(
      "Spouse Age is required for Married Filing Jointly estimates."
    );
    markError("spouseAge");
  }

  if (!input.stateCode) {
    errors.push("State of Residence is required.");
    markError("stateCode");
  }

  if (
    input.stateCode &&
    _currentStateYearSupport &&
    String(_currentStateYearSupport.stateCode || "") === input.stateCode &&
    Number(_currentStateYearSupport.taxYear || 0) === Number(input.taxYear) &&
    _currentStateYearSupport.supported === false
  ) {
    errors.push(
      `${_currentStateYearSupport.stateName} state estimate is not available for tax year ${input.taxYear}. ` +
      "The estimator will not use another year's state rules."
    );
    markError("stateCode");
    markError("taxYear");
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

  if (
    (input.ctcQualifyingChildren || 0) >
    (input.numberOfDependents || 0)
  ) {
    errors.push(
      "Children Under Age 17 for Child Tax Credit cannot exceed your total dependents."
    );
    markError("ctcQualifyingChildren");
  }

  if (input.stateCode === "IN" && Number(input.taxYear) === 2025) {
    if (input.inFullYearResident === null || input.inFullYearResident === undefined) { errors.push("Indiana full-year residency confirmation is required."); markError("inFullYearResident"); }
    else if (input.inFullYearResident !== true) { errors.push("Indiana part-year/nonresident returns require IT-40PNR or IT-40RNR and cannot be estimated in this supported path."); markError("inFullYearResident"); }
    [
      ["inTotalAddbacks", "Enter Indiana Schedule 1 total add-backs, including 0 when none apply."],
      ["inTotalDeductions", "Enter Indiana Schedule 2 total deductions, including 0 when none apply."],
      ["inAdditionalDependentChildCount", "Enter the Indiana additional dependent-child count, including 0."],
      ["inFirstYearAdditionalChildCount", "Enter the Indiana first-year additional child-exemption count, including 0."],
      ["inAdoptedDependentCount", "Enter the Indiana adopted dependent count, including 0."],
      ["inCountyTax", "Enter the exact Indiana Schedule CT-40 county-tax amount, including 0 when none applies."],
      ["inCountyWithheld", "Enter Indiana county withholding, including 0 when none applies."],
    ].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    const depCount = Number(input.numberOfDependents || 0);
    if (Number(input.inAdditionalDependentChildCount || 0) > depCount) { errors.push("Indiana additional dependent-child exemptions cannot exceed dependents claimed."); markError("inAdditionalDependentChildCount"); }
    if (Number(input.inFirstYearAdditionalChildCount || 0) > Number(input.inAdditionalDependentChildCount || 0)) { errors.push("Indiana first-year additional child exemptions must be a subset of qualifying dependent children."); markError("inFirstYearAdditionalChildCount"); }
    if (Number(input.inAdoptedDependentCount || 0) > depCount) { errors.push("Indiana adopted-child exemptions cannot exceed dependents claimed."); markError("inAdoptedDependentCount"); }
    if (input.inTaxpayerBlind === null || input.inTaxpayerBlind === undefined) { errors.push("Select whether the taxpayer is blind for Indiana Schedule 3."); markError("inTaxpayerBlind"); }
    if (input.filingStatus === "mfj" && (input.inSpouseBlind === null || input.inSpouseBlind === undefined)) { errors.push("Select whether the spouse is blind for Indiana Schedule 3."); markError("inSpouseBlind"); }
    if (input.inClaimedFederalEIC === null || input.inClaimedFederalEIC === undefined) { errors.push("Select whether the federal EITC was claimed for the Indiana EITC."); markError("inClaimedFederalEIC"); }
    else if (input.inClaimedFederalEIC === true && Number(input.inFederalEICAmount || 0) <= 0) { errors.push("Enter the federal EITC amount for the Indiana 10% EITC."); markError("inFederalEICAmount"); }
    [
      ["inHasUseTax", "Complete the Indiana use-tax screening question."],
      ["inHasUnifiedTaxCreditForElderly", "Complete the Indiana Unified Tax Credit for the Elderly screening question."],
      ["inHasOtherCredits", "Complete the Indiana other-credit screening question."],
      ["inHasOtherTaxesOrSpecialItems", "Complete the Indiana other-tax/special-item screening question."],
    ].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    if (input.inHasUseTax === true && Number(input.inUseTax || 0) <= 0) { errors.push("Enter the Indiana use-tax amount from Schedule 4."); markError("inUseTax"); }
    if (input.inHasUnifiedTaxCreditForElderly === true) { errors.push("Indiana Unified Tax Credit for the Elderly requires separate credit review and is held rather than guessed."); markError("inHasUnifiedTaxCreditForElderly"); }
    if (input.inHasOtherCredits === true) { errors.push("Indiana Schedule 5/6 credits other than withholding and EITC require credit-specific review."); markError("inHasOtherCredits"); }
    if (input.inHasOtherTaxesOrSpecialItems === true) { errors.push("This Indiana return has another material tax, recapture, contribution, penalty, amended item, or special schedule requiring review."); markError("inHasOtherTaxesOrSpecialItems"); }
  }

  if (input.stateCode === "MO" && Number(input.taxYear) === 2025) {
    if (input.moFullYearResident === null || input.moFullYearResident === undefined) { errors.push("Missouri full-year residency confirmation is required."); markError("moFullYearResident"); }
    else if (input.moFullYearResident !== true) { errors.push("Missouri part-year/nonresident returns require MO-NRI and/or resident-credit allocation review."); markError("moFullYearResident"); }
    if (input.filingStatus === "mfj") {
      [["moPrimaryAdjustedGrossIncome", "Enter MO-1040 Line 5Y Missouri adjusted gross income."], ["moSpouseAdjustedGrossIncome", "Enter MO-1040 Line 5S spouse Missouri adjusted gross income."]].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    } else {
      [["moTotalAdditions", "Enter Form MO-A total additions, including 0."], ["moTotalSubtractions", "Enter Form MO-A total subtractions, including 0."]].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    }
    [["moPensionSocialSecurityExemption", "Enter MO-1040 Line 8 pension/Social Security exemption, including 0."], ["moFederalIncomeTaxDeduction", "Enter MO-1040 Line 13 federal income tax deduction, including 0."], ["moOtherDeductions", "Enter MO-1040 Lines 16-24 other deductions total, including 0."]].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    const moFedCap = input.filingStatus === "mfj" ? 10000 : 5000;
    if (Number(input.moFederalIncomeTaxDeduction || 0) > moFedCap) { errors.push(`Missouri federal income tax deduction exceeds the $${moFedCap.toLocaleString()} cap for this filing status.`); markError("moFederalIncomeTaxDeduction"); }
    if (!["standard", "itemized"].includes(input.moDeductionChoice)) { errors.push("Select the Missouri standard or itemized deduction."); markError("moDeductionChoice"); }
    if (input.moDeductionChoice === "itemized" && (input.moItemizedDeductions === null || input.moItemizedDeductions === undefined)) { errors.push("Enter the exact Missouri itemized deduction amount."); markError("moItemizedDeductions"); }
    if (input.moDeductionChoice === "standard") {
      if (input.moTaxpayerBlind === null || input.moTaxpayerBlind === undefined) { errors.push("Select whether the taxpayer is blind for Missouri's additional standard deduction."); markError("moTaxpayerBlind"); }
      if (input.filingStatus === "mfj" && (input.moSpouseBlind === null || input.moSpouseBlind === undefined)) { errors.push("Select whether the spouse is blind for Missouri's additional standard deduction."); markError("moSpouseBlind"); }
      if (input.canBeClaimedAsDependent === true && (input.moDependentEarnedIncome === null || input.moDependentEarnedIncome === undefined)) { errors.push("Enter dependent earned income for Missouri's standard-deduction worksheet."); markError("moDependentEarnedIncome"); }
      if (input.moFederallyRequiredToItemize === null || input.moFederallyRequiredToItemize === undefined) { errors.push("Complete the Missouri federal-required-itemization screening question."); markError("moFederallyRequiredToItemize"); }
      else if (input.moFederallyRequiredToItemize === true) { errors.push("Federal rules required itemizing, so Missouri standard deduction cannot be used. Select Missouri itemized deductions."); markError("moFederallyRequiredToItemize"); }
      if (input.moHasQualifiedDisasterLossStandardDeductionIncrease === null || input.moHasQualifiedDisasterLossStandardDeductionIncrease === undefined) { errors.push("Complete the Missouri qualified-disaster-loss standard-deduction screening question."); markError("moHasQualifiedDisasterLossStandardDeductionIncrease"); }
      else if (input.moHasQualifiedDisasterLossStandardDeductionIncrease === true) { errors.push("A qualified disaster loss increased the Missouri standard deduction and requires separate review."); markError("moHasQualifiedDisasterLossStandardDeductionIncrease"); }
    }
    if (input.moClaimedFederalEIC === null || input.moClaimedFederalEIC === undefined) { errors.push("Complete the Missouri Working Family Tax Credit federal-EIC screening question."); markError("moClaimedFederalEIC"); }
    const moWftcStatusEligible = ["single", "mfj", "hoh", "qw"].includes(input.filingStatus) && input.canBeClaimedAsDependent !== true;
    if (input.moClaimedFederalEIC === true) {
      if (Number(input.moFederalEICAmount || 0) <= 0) { errors.push("Enter the federal EIC amount for Missouri's 20% Working Family Tax Credit."); markError("moFederalEICAmount"); }
      if (moWftcStatusEligible && (input.moWftcInvestmentIncomeOver4400 === null || input.moWftcInvestmentIncomeOver4400 === undefined)) { errors.push("Complete the Missouri WFTC investment-income screening question."); markError("moWftcInvestmentIncomeOver4400"); }
      if (moWftcStatusEligible && (input.moWftcChildInfoComplete === null || input.moWftcChildInfoComplete === undefined)) { errors.push("Complete the Missouri WFTC qualifying-child-information screening question."); markError("moWftcChildInfoComplete"); }
    }
    [["moHasEnterpriseZoneModification", "Complete the Missouri enterprise/rural-zone screening question."], ["moHasResidentCreditOtherState", "Complete the Missouri other-state-credit screening question."], ["moHasMiscOrPropertyTaxCredits", "Complete the Missouri miscellaneous/property-credit screening question."], ["moHasOtherTaxOrSpecialItems", "Complete the Missouri other-tax/special-item screening question."]].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    if (input.moHasEnterpriseZoneModification === true) { errors.push("Missouri enterprise/rural-zone modifications require separate approved-amount review."); markError("moHasEnterpriseZoneModification"); }
    if (input.moHasResidentCreditOtherState === true) { errors.push("Missouri MO-CR other-state credit requires separate jurisdiction detail and is held rather than guessed."); markError("moHasResidentCreditOtherState"); }
    if (input.moHasMiscOrPropertyTaxCredits === true) { errors.push("Missouri miscellaneous/property credits require separate credit-specific review."); markError("moHasMiscOrPropertyTaxCredits"); }
    if (input.moHasOtherTaxOrSpecialItems === true) { errors.push("This Missouri return has another material tax, recapture, amended item, penalty, refund diversion, or special schedule requiring review."); markError("moHasOtherTaxOrSpecialItems"); }
  }

  if (input.stateCode === "IL" && Number(input.taxYear) === 2025) {
    if (input.ilFullYearResident === null || input.ilFullYearResident === undefined) { errors.push("Illinois full-year residency confirmation is required."); markError("ilFullYearResident"); }
    else if (input.ilFullYearResident !== true) { errors.push("Illinois part-year/nonresident returns require Schedule NR and cannot be estimated in this supported path."); markError("ilFullYearResident"); }
    [
      ["ilTotalAdditions", "Enter Illinois Line 3 total additions, including 0."],
      ["ilRetirementSocialSecuritySubtraction", "Enter Illinois Line 5 Social Security/retirement subtraction, including 0."],
      ["ilIllinoisIncomeTaxOverpaymentSubtraction", "Enter Illinois Line 6 Income Tax overpayment subtraction, including 0."],
      ["ilOtherSubtractions", "Enter Illinois Line 7 other subtractions, including 0."],
      ["ilInvestmentCreditRecapture", "Enter Illinois Line 13 investment-credit recapture, including 0."],
      ["ilScheduleICRCredit", "Enter the exact Illinois Schedule ICR credit, including 0."],
      ["ilSchedule1299CCredit", "Enter the exact Illinois Schedule 1299-C credit, including 0."],
      ["ilHouseholdEmploymentTax", "Enter Illinois household employment tax, including 0."],
      ["ilUseTax", "Enter Illinois use tax, including 0."],
      ["ilEstimatedPayments", "Enter Illinois estimated/extension/prior-year-applied payments, including 0."],
      ["ilPassThroughWithholding", "Enter Illinois pass-through withholding, including 0."],
      ["ilPassThroughEntityTaxCredit", "Enter Illinois pass-through entity tax credit, including 0."],
    ].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    if (input.ilTaxpayerBlind === null || input.ilTaxpayerBlind === undefined) { errors.push("Select whether the taxpayer is legally blind for Illinois exemptions."); markError("ilTaxpayerBlind"); }
    if (input.filingStatus === "mfj") {
      if (input.ilSpouseCanBeClaimedAsDependent === null || input.ilSpouseCanBeClaimedAsDependent === undefined) { errors.push("Select whether the spouse can be claimed as another taxpayer's dependent for Illinois Line 10a."); markError("ilSpouseCanBeClaimedAsDependent"); }
      if (input.ilSpouseBlind === null || input.ilSpouseBlind === undefined) { errors.push("Select whether the spouse is legally blind for Illinois exemptions."); markError("ilSpouseBlind"); }
    }
    [["ilHasOtherStateTaxCredit", "Complete the Illinois Schedule CR screening question."], ["ilHasCannabisGamingSurcharge", "Complete the Illinois cannabis/gaming surcharge screening question."], ["ilClaimedFederalEITC", "Complete the Illinois federal-EITC screening question."], ["ilNeedsExpandedEITCWorksheet", "Complete the Illinois Expanded EITC Worksheet screening question."], ["ilHasOtherSpecialItems", "Complete the Illinois other-special-item screening question."]].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    if (input.ilHasOtherStateTaxCredit === true) { errors.push("Illinois Schedule CR requires detailed other-state income/tax information and is held rather than guessed."); markError("ilHasOtherStateTaxCredit"); }
    if (input.ilHasCannabisGamingSurcharge === true) { errors.push("Illinois Line 22 cannabis/gaming surcharge requires separate review."); markError("ilHasCannabisGamingSurcharge"); }
    if (input.ilNeedsExpandedEITCWorksheet === true) { errors.push("Illinois Expanded EITC Worksheet cases require additional earned-income, ITIN, age, and qualifying-child detail and are held for review."); markError("ilNeedsExpandedEITCWorksheet"); }
    if (input.ilClaimedFederalEITC === true) {
      if (Number(input.ilFederalEITCAmount || 0) <= 0) { errors.push("Enter the federal EITC amount for Illinois's 20% EITC calculation."); markError("ilFederalEITCAmount"); }
      if (input.ilHasDependentChildUnder12 === null || input.ilHasDependentChildUnder12 === undefined) { errors.push("Select whether at least one dependent child was under age 12 for the 2025 Illinois Child Tax Credit."); markError("ilHasDependentChildUnder12"); }
    }
    if (input.ilHasOtherSpecialItems === true) { errors.push("This Illinois return has another material credit, tax, amended item, allocation, penalty, or special schedule requiring review."); markError("ilHasOtherSpecialItems"); }
  }

  if (input.stateCode === "OH" && Number(input.taxYear) === 2025) {
    if (input.ohFullYearResident === null || input.ohFullYearResident === undefined) { errors.push("Ohio full-year residency confirmation is required."); markError("ohFullYearResident"); }
    else if (input.ohFullYearResident !== true) { errors.push("Ohio part-year/nonresident returns require residency/allocation review and cannot be estimated in this supported full-year path."); markError("ohFullYearResident"); }
    [
      ["ohTotalAdditions", "Enter Ohio Schedule of Adjustments line 12 total additions, including 0."],
      ["ohOtherDeductionsExcludingBusinessIncomeDeduction", "Enter Ohio Schedule of Adjustments lines 14-46 deductions excluding the business-income deduction, including 0."],
      ["ohScheduleBusinessIncomeTotal", "Enter Ohio Schedule of Business Income line 10 total business income or loss, including 0."],
      ["ohNonrefundableCredits", "Enter Ohio Schedule of Credits line 40 nonrefundable credits, including 0."],
      ["ohInterestPenalty", "Enter Ohio IT 1040 line 11 estimated-tax interest penalty, including 0."],
      ["ohUseTax", "Enter Ohio IT 1040 line 12 unpaid use tax, including 0."],
      ["ohEstimatedAndOtherPayments", "Enter Ohio IT 1040 line 15 estimated/extension/carryforward/prior payments, including 0."],
      ["ohRefundableCredits", "Enter Ohio Schedule of Credits line 47 refundable credits, including 0."],
    ].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    if (input.filingStatus === "mfj" && (input.ohSpouseCanBeClaimedAsDependent === null || input.ohSpouseCanBeClaimedAsDependent === undefined)) { errors.push("Select whether the spouse can be claimed as another taxpayer's dependent for Ohio exemptions."); markError("ohSpouseCanBeClaimedAsDependent"); }
    if (input.ohHasSchoolDistrictIncomeTax === null || input.ohHasSchoolDistrictIncomeTax === undefined) { errors.push("Complete the Ohio school-district-income-tax screening question."); markError("ohHasSchoolDistrictIncomeTax"); }
    if (input.ohHasSchoolDistrictIncomeTax === true) {
      [["ohSchoolDistrictTax", "Enter the exact SD 100 line 10 school-district tax liability."], ["ohSchoolDistrictWithholding", "Enter SD 100 line 11 school-district withholding, including 0."], ["ohSchoolDistrictPayments", "Enter SD 100 line 12 payments/credit carryforward, including 0."]].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    }
    [["ohHasResidencyCreditOrAllocation", "Complete the Ohio IT RC / IT NRC residency-credit/allocation screening question."], ["ohHasAmendedNolOrSpecialItems", "Complete the Ohio amended/NOL/other-special-item screening question."]].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    if (input.ohHasResidencyCreditOrAllocation === true) { errors.push("Ohio IT RC/IT NRC residency credits or allocations require separate jurisdiction/residency detail and are held for review."); markError("ohHasResidencyCreditOrAllocation"); }
    if (input.ohHasAmendedNolOrSpecialItems === true) { errors.push("Ohio amended returns, NOL carrybacks, and other material special items require separate review."); markError("ohHasAmendedNolOrSpecialItems"); }
  }

  if (input.stateCode === "PA" && Number(input.taxYear) === 2025) {
    if (input.paFullYearResident === null || input.paFullYearResident === undefined) { errors.push("Pennsylvania full-year residency confirmation is required."); markError("paFullYearResident"); }
    else if (input.paFullYearResident !== true) { errors.push("Pennsylvania part-year/nonresident returns require separate source/residency review and cannot be estimated in this full-year path."); markError("paFullYearResident"); }
    [
      ["paNetCompensation", "Enter PA-40 Line 1c net compensation, including 0."], ["paInterestIncome", "Enter PA-40 Line 2 interest income, including 0."],
      ["paDividendIncome", "Enter PA-40 Line 3 dividend income, including 0."], ["paBusinessFarmIncomeLoss", "Enter PA-40 Line 4 business/farm income or loss, including 0."],
      ["paPropertyGainLoss", "Enter PA-40 Line 5 property gain or loss, including 0."], ["paRentRoyaltyIncomeLoss", "Enter PA-40 Line 6 rent/royalty income or loss, including 0."],
      ["paEstateTrustIncome", "Enter PA-40 Line 7 estate/trust income, including 0."], ["paGamblingLotteryWinnings", "Enter PA-40 Line 8 gambling/lottery winnings, including 0."],
      ["paOtherDeductions", "Enter exact Schedule O / PA-40 Line 10 deductions, including 0."], ["paPriorYearCredit", "Enter PA-40 Line 14 prior-year credit, including 0."],
      ["paEstimatedPayments", "Enter PA-40 Line 15 estimated payments, including 0."], ["paExtensionPayment", "Enter PA-40 Line 16 extension payment, including 0."],
      ["paNonresidentWithholding", "Enter PA-40 Line 17 NRK-1 withholding, including 0."], ["paUseTax", "Enter PA-40 Line 25 use tax, including 0."],
      ["paPenaltiesInterest", "Enter PA-40 Line 27 penalties/interest, including 0."],
    ].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    const paLine9 = [input.paNetCompensation, input.paInterestIncome, input.paDividendIncome, input.paBusinessFarmIncomeLoss, input.paPropertyGainLoss, input.paRentRoyaltyIncomeLoss, input.paEstateTrustIncome, input.paGamblingLotteryWinnings].reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    if (Number(input.paOtherDeductions || 0) > paLine9) { errors.push("PA Schedule O Line 10 cannot exceed PA-40 Line 9; recheck the completed Schedule O amount."); markError("paOtherDeductions"); }
    [["paHasResidentCredit", "Complete the PA Schedule G-L resident-credit screen."], ["paClaimTaxForgiveness", "Complete the PA Schedule SP Tax Forgiveness screen."], ["paHasChildDependentCareCredit", "Complete the PA Schedule DC credit screen."], ["paHasRestrictedScheduleOCCredits", "Complete the PA Schedule OC restricted-credit screen."], ["paClaimedFederalEITC", "Complete the Pennsylvania Working Pennsylvanians Tax Credit federal-EITC screen."], ["paHasLocalEarnedIncomeTax", "Complete the Pennsylvania local earned-income/wage-tax screen."], ["paHasAmendedOrOtherSpecialItems", "Complete the Pennsylvania amended/other-special-item screen."]].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    if (input.paHasResidentCredit === true && (input.paResidentCredit === null || input.paResidentCredit === undefined)) { errors.push("Enter exact PA-40 Line 22 resident credit from Schedule G-L."); markError("paResidentCredit"); }
    if (input.paClaimTaxForgiveness === true) {
      if (input.paTaxForgivenessEligibilityIncome === null || input.paTaxForgivenessEligibilityIncome === undefined) { errors.push("Enter Schedule SP Line 11 eligibility income; married taxpayers use joint eligibility income even when filing separately."); markError("paTaxForgivenessEligibilityIncome"); }
      if (input.paTaxForgivenessDependentChildren === null || input.paTaxForgivenessDependentChildren === undefined) { errors.push("Enter the Schedule SP dependent-child count."); markError("paTaxForgivenessDependentChildren"); }
      else if (Number(input.paTaxForgivenessDependentChildren) > 9) { errors.push("More than nine Schedule SP dependent children requires separate Pennsylvania Tax Forgiveness review."); markError("paTaxForgivenessDependentChildren"); }
      if (input.canBeClaimedAsDependent === true) {
        if (input.paDependentClaimantEligibleTaxForgiveness === null || input.paDependentClaimantEligibleTaxForgiveness === undefined) { errors.push("Confirm the Schedule SP dependent-claimant parent/grandparent/foster-parent eligibility rule."); markError("paDependentClaimantEligibleTaxForgiveness"); }
        else if (input.paDependentClaimantEligibleTaxForgiveness !== true) { errors.push("This dependent claimant is not eligible for the supported PA Tax Forgiveness path."); markError("paDependentClaimantEligibleTaxForgiveness"); }
      }
    }
    if (input.paHasChildDependentCareCredit === true) {
      if (input.filingStatus === "mfs") { errors.push("Pennsylvania married-filing-separately child/dependent-care credit claims require separate review."); markError("paHasChildDependentCareCredit"); }
      if (input.paChildDependentCareCredit === null || input.paChildDependentCareCredit === undefined) { errors.push("Enter the exact completed PA Schedule DC credit."); markError("paChildDependentCareCredit"); }
    }
    if (input.paHasRestrictedScheduleOCCredits === true) { errors.push("PA Schedule OC restricted credits require separate authorization/documentation review."); markError("paHasRestrictedScheduleOCCredits"); }
    if (input.paClaimedFederalEITC === true && !(Number(input.paFederalEITCAmount || 0) > 0)) { errors.push("Enter the federal EITC amount for Pennsylvania's 10% Working Pennsylvanians Tax Credit."); markError("paFederalEITCAmount"); }
    if (input.paHasLocalEarnedIncomeTax === true) { [["paLocalEarnedIncomeTax", "Enter exact local earned-income/wage-tax liability."], ["paLocalEarnedIncomeWithholding", "Enter exact local withholding, including 0."], ["paLocalEarnedIncomePayments", "Enter exact local payments, including 0."]].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } }); }
    if (input.paHasAmendedOrOtherSpecialItems === true) { errors.push("Pennsylvania amended returns and other material special items require separate review."); markError("paHasAmendedOrOtherSpecialItems"); }
  }

  if (input.stateCode === "CO" && Number(input.taxYear) === 2025) {
    if (input.coFullYearResident === null || input.coFullYearResident === undefined) { errors.push("Colorado full-year residency confirmation is required."); markError("coFullYearResident"); }
    else if (input.coFullYearResident !== true) { errors.push("Colorado part-year/nonresident DR 0104PN returns require separate apportionment."); markError("coFullYearResident"); }
    ["coAdditions","coSubtractions","coAlternativeMinimumTax","coCreditRecapture","coCreditRepayment","coOtherNonrefundableCredits","coChildTaxCredit","coChildDependentCareCredit","coFederalEITCAmount","coOtherRefundableCredits","coDirectRefundableCredits","coOtherFormWithholding","coPriorYearCarryforward","coEstimatedPayments","coExtensionPayment","coOtherPrepayments","coTaborRefund","coDelinquentPenalty","coDelinquentInterest","coUnderpaymentPenalty","coApplyToNextYear","coVoluntaryContributions"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined){errors.push(`Complete required Colorado amount: ${field}. Enter 0 when none applies.`);markError(field);}
      else if(Number(input[field])<0){errors.push(`Colorado amount ${field} cannot be negative.`);markError(field);}
    });
    ["coHasOtherStateCredit","coNeedsSpecialEITCFormTN","coHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Colorado screen: ${field}.`);markError(field);}});
    if(input.coHasOtherStateCredit===true){errors.push("Colorado DR 0104CR Part II credit for tax paid to another state requires separate review.");markError("coHasOtherStateCredit");}
    if(input.coNeedsSpecialEITCFormTN===true){errors.push("Colorado special DR 0104TN EITC cases require separate review.");markError("coNeedsSpecialEITCFormTN");}
    if(input.coHasAmendedOrOtherSpecialItems===true){errors.push("Colorado amended or material special cases require separate review.");markError("coHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "UT" && Number(input.taxYear) === 2025) {
    if (input.utFullYearResident === null || input.utFullYearResident === undefined) { errors.push("Utah full-year residency confirmation is required."); markError("utFullYearResident"); }
    else if (input.utFullYearResident !== true) { errors.push("Utah part-year/nonresident TC-40B returns require separate apportionment."); markError("utFullYearResident"); }
    ["utAdditions","utStateTaxRefund","utSubtractions","utDependentExemptionCount","utFederalDeductionLine12","utStateLocalIncomeTaxDeduction","utFederalBaseStandardDeduction","utMunicipalBondInterestAddition","utFederalTaxExemptInterest","utChildCreditQualifyingChildren","utFederalEITCAmount","utUtahW2Wages","utOtherApportionableNonrefundableCredits","utNonapportionableNonrefundableCredits","utVoluntaryContributions","utLowIncomeHousingRecapture","utUseTax","utOtherWithholding","utPrepayments","utNonapportionableRefundableCredits","utApportionableRefundableCredits","utPenaltyInterest","utRefundSubtractions"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined){errors.push(`Complete required Utah amount: ${field}. Enter 0 when none applies.`);markError(field);}
      else if(Number(input[field])<0){errors.push(`Utah amount ${field} cannot be negative.`);markError(field);}
    });
    ["utHasOtherStateCredit","utHasSpecialMarriedCoupleCalculation","utHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Utah screen: ${field}.`);markError(field);}});
    if(!Number.isInteger(Number(input.utDependentExemptionCount))||!Number.isInteger(Number(input.utChildCreditQualifyingChildren))){errors.push("Utah dependent and child-credit counts must be whole numbers.");}
    if(Number(input.utChildCreditQualifyingChildren)>Number(input.numberOfDependents||0)){errors.push("Utah child-credit count cannot exceed the federal dependent count.");markError("utChildCreditQualifyingChildren");}
    if(Number(input.utMunicipalBondInterestAddition)>Number(input.utAdditions)){errors.push("Utah municipal-bond interest cannot exceed total additions.");markError("utMunicipalBondInterestAddition");}
    if(Number(input.utStateLocalIncomeTaxDeduction)>Number(input.utFederalDeductionLine12)){errors.push("Utah state/local income-tax deduction cannot exceed the federal deduction on TC-40 Line 12.");markError("utStateLocalIncomeTaxDeduction");}
    if(input.utHasOtherStateCredit===true){errors.push("Utah TC-40S other-state income-tax credit requires separate review.");markError("utHasOtherStateCredit");}
    if(input.utHasSpecialMarriedCoupleCalculation===true){errors.push("Utah special married-couple calculation requires separate review.");markError("utHasSpecialMarriedCoupleCalculation");}
    if(input.utHasAmendedOrOtherSpecialItems===true){errors.push("Utah amended or material special cases require separate review.");markError("utHasAmendedOrOtherSpecialItems");}
  }


  if (input.stateCode === "ID" && Number(input.taxYear) === 2025) {
    if (input.idFullYearResident === null || input.idFullYearResident === undefined) { errors.push("Idaho full-year residency confirmation is required."); markError("idFullYearResident"); }
    else if (input.idFullYearResident !== true) { errors.push("Idaho part-year/nonresident Form 43 returns require separate allocation."); markError("idFullYearResident"); }
    ["idAdditions","idSubtractions","idItemizedDeduction","idStandardDeduction","idFederalLine13Deductions","idChildCreditQualifyingChildren","idForm39rCredits","idBusinessIncomeTaxCredits","idFuelsUseTax","idSalesUseTax","idIncomeTaxCreditRecapture","idQieRecapture","idPermanentBuildingFundTax","idDonations","idParentalChoiceTaxCredit","idFoodTaxCredit","idHomeFamilyCredit","idFuelsTaxRefund","idOtherWithholding","idEstimatedPayments","idEntityPaidWithheldAbe","idTaxReimbursementIncentiveCredit","idPenaltyInterest","idPriorYearNonrefundableCredit","idRefundApplyToNextYear"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined){errors.push(`Complete required Idaho amount: ${field}. Enter 0 when none applies.`);markError(field);}
      else if(Number(input[field])<0){errors.push(`Idaho amount ${field} cannot be negative.`);markError(field);}
    });
    ["idHasOtherStateCredit","idHasNolOrCarryback","idHasClaimOfRightCase","idHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Idaho screen: ${field}.`);markError(field);}});
    if(input.filingStatus==="mfs"&&(input.idMfsSpouseItemizes===null||input.idMfsSpouseItemizes===undefined)){errors.push("Idaho MFS returns require spouse itemizing confirmation.");markError("idMfsSpouseItemizes");}
    if(!Number.isInteger(Number(input.idChildCreditQualifyingChildren))){errors.push("Idaho child-tax-credit qualifying children must be a whole number.");markError("idChildCreditQualifyingChildren");}
    if(Number(input.idChildCreditQualifyingChildren)>Number(input.numberOfDependents||0)){errors.push("Idaho child-tax-credit count cannot exceed the federal dependent count.");markError("idChildCreditQualifyingChildren");}
    if(input.idHasOtherStateCredit===true){errors.push("Idaho Form 39R other-state income-tax credit requires separate review.");markError("idHasOtherStateCredit");}
    if(input.idHasNolOrCarryback===true){errors.push("Idaho NOL/Form 56 cases require separate review.");markError("idHasNolOrCarryback");}
    if(input.idHasClaimOfRightCase===true){errors.push("Idaho claim-of-right Worksheet CR cases require separate review.");markError("idHasClaimOfRightCase");}
    if(input.idHasAmendedOrOtherSpecialItems===true){errors.push("Idaho amended, dual-status/nonresident-alien, or material special cases require separate review.");markError("idHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "MT" && Number(input.taxYear) === 2025) {
    if (input.mtFullYearResident === null || input.mtFullYearResident === undefined) { errors.push("Montana full-year residency confirmation is required."); markError("mtFullYearResident"); }
    else if (input.mtFullYearResident !== true) { errors.push("Montana part-year/nonresident/mixed-residency Schedule II returns require separate review."); markError("mtFullYearResident"); }
    const mtRequiredAmounts = [
      "mtFederalDeductionLine2", "mtAdditions", "mtSubtractions", "mtNetLongTermCapitalGains", "mtOtherNonrefundableCredits",
      "mtOtherWithholdingAndPteCredits", "mtEstimatedPayments", "mtPriorYearOverpayment", "mtExtensionPayment", "mtFederalEITCAmount",
      "mtElderlyHomeownerRenterCredit", "mtOtherRefundableCredits", "mtScheduleIvOtherTaxes", "mtRefundApplyToNextYear", "mtRefund529Deposit"
    ];
    mtRequiredAmounts.forEach((field) => {
      if (input[field] === null || input[field] === undefined || Number(input[field]) < 0) { errors.push(`Enter a valid nonnegative Montana amount for ${field}, including 0.`); markError(field); }
    });
    ["mtHasOtherStateCredit", "mtHasNolOrLossCarryforward", "mtHasAmendedOrOtherSpecialItems"].forEach((field) => {
      if (input[field] === null || input[field] === undefined) { errors.push(`Complete the Montana review screen: ${field}.`); markError(field); }
    });
    if (Number(input.mtFederalEITCAmount || 0) > 0 && (input.mtHasEitcReductionCase === null || input.mtHasEitcReductionCase === undefined)) {
      errors.push("Confirm whether the special Montana EITC Worksheet A reduction applies."); markError("mtHasEitcReductionCase");
    }
  }


  if (input.stateCode === "ND" && Number(input.taxYear) === 2025) {
    if (input.ndFullYearResident === null || input.ndFullYearResident === undefined) { errors.push("North Dakota full-year residency confirmation is required."); markError("ndFullYearResident"); }
    else if (input.ndFullYearResident !== true) { errors.push("North Dakota part-year/nonresident Schedule ND-1NR returns require separate allocation."); markError("ndFullYearResident"); }
    if (input.ndFederalTaxableIncome === null || input.ndFederalTaxableIncome === undefined || !Number.isFinite(Number(input.ndFederalTaxableIncome))) { errors.push("Enter exact signed North Dakota Form ND-1 Line 1b federal taxable income, including a negative amount when applicable."); markError("ndFederalTaxableIncome"); }
    ["ndContributionAdjustment","ndOtherAdditions","ndUsObligationInterest","ndNetLongTermCapitalGainExclusion","ndNativeAmericanExemptIncome","ndRailroadBenefits","ndPeaceOfficerRetirementExclusion","ndMilitaryPayExclusion","ndCollegeSaveContribution","ndQualifiedDividends","ndMilitaryRetirementExclusion","ndSocialSecurityExclusion","ndOtherSubtractions","ndOtherCredits","ndOtherWithholding","ndEstimatedTaxPayment","ndRefundApplyNextYear","ndRefundContributions","ndPenaltyInterest","ndBalanceDueContributions","ndUnderpaymentInterest"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined||!Number.isFinite(Number(input[field]))||Number(input[field])<0){errors.push(`Enter a valid nonnegative North Dakota amount for ${field}, including 0.`);markError(field);}
    });
    if(input.filingStatus==="mfj"){
      ["ndTaxpayerQualifiedIncome","ndSpouseQualifiedIncome"].forEach((field)=>{if(input[field]===null||input[field]===undefined||!Number.isFinite(Number(input[field]))||Number(input[field])<0){errors.push(`Complete the North Dakota marriage-penalty worksheet amount: ${field}.`);markError(field);}});
    }
    ["ndHasOtherStateCredit","ndHasFarmIncomeAveraging","ndHasSoldResearchCredit","ndHasAmendedNolOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required North Dakota review screen: ${field}.`);markError(field);}});
    if(input.ndHasOtherStateCredit===true){errors.push("North Dakota Schedule ND-1CR other-state/local credit requires separate review.");markError("ndHasOtherStateCredit");}
    if(input.ndHasFarmIncomeAveraging===true){errors.push("North Dakota Form ND-1FA farm-income averaging requires separate review.");markError("ndHasFarmIncomeAveraging");}
    if(input.ndHasSoldResearchCredit===true){errors.push("North Dakota Schedule ND-1CS sold-research-credit tax computation requires separate review.");markError("ndHasSoldResearchCredit");}
    if(input.ndHasAmendedNolOrOtherSpecialItems===true){errors.push("North Dakota amended/NOL/fiscal-year/nonresident-alien or other material special cases require separate review.");markError("ndHasAmendedNolOrOtherSpecialItems");}
  }

  if (input.stateCode === "NM" && Number(input.taxYear) === 2025) {
    if (input.nmFullYearResident === null || input.nmFullYearResident === undefined) { errors.push("New Mexico full-year residency confirmation is required."); markError("nmFullYearResident"); }
    else if (input.nmFullYearResident !== true) { errors.push("New Mexico part-year/first-year/nonresident PIT-B returns require separate allocation."); markError("nmFullYearResident"); }
    ["nmFederalDeductionLine12","nmStateLocalIncomeTaxAddback","nmPitAdjAdditions","nmPitAdjDeductions","nmPitCrNonrefundableCredits","nmPitRcTotalCredits","nmFederalEITCAmount","nmPitCrRefundableCredits","nmOtherLine27Withholding","nmOilGasWithholding","nmPteWithholdingEntityTax","nmEstimatedPayments","nmOtherPayments","nmUnderpaymentPenalty","nmLatePenalty","nmInterest","nmRefundContributions","nmApplyToNextYear"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined||!Number.isFinite(Number(input[field]))||Number(input[field])<0){errors.push(`Enter a valid nonnegative New Mexico amount for ${field}, including 0.`);markError(field);}
    });
    if(input.nmWftcExpansionCase===null||input.nmWftcExpansionCase===undefined){errors.push("Complete the New Mexico WFTC TIN/age expansion screen.");markError("nmWftcExpansionCase");}
    if(input.filingStatus==="mfj"&&(input.nmSpouseCanBeClaimedAsDependent===null||input.nmSpouseCanBeClaimedAsDependent===undefined)){errors.push("Complete the New Mexico spouse dependent-status screen for PIT-1 Line 5.");markError("nmSpouseCanBeClaimedAsDependent");}
    if(input.filingStatus==="mfs"&&(input.nmMfsCommunityPropertyAllocated===null||input.nmMfsCommunityPropertyAllocated===undefined)){errors.push("Confirm New Mexico MFS community/separate income allocation.");markError("nmMfsCommunityPropertyAllocated");}
    else if(input.filingStatus==="mfs"&&input.nmMfsCommunityPropertyAllocated!==true){errors.push("New Mexico MFS community-property income must be correctly divided before estimating.");markError("nmMfsCommunityPropertyAllocated");}
    ["nmHasPitBAllocation","nmHasScheduleCCAlternativeTax","nmHasLumpSumDistributionTax","nmHasOtherStateCredit","nmHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required New Mexico review screen: ${field}.`);markError(field);}});
    if(input.nmHasPitBAllocation===true){errors.push("New Mexico PIT-B allocation/apportionment requires separate review.");markError("nmHasPitBAllocation");}
    if(input.nmHasScheduleCCAlternativeTax===true){errors.push("New Mexico Schedule CC alternative tax requires separate review.");markError("nmHasScheduleCCAlternativeTax");}
    if(input.nmHasLumpSumDistributionTax===true){errors.push("New Mexico lump-sum distribution tax requires separate review.");markError("nmHasLumpSumDistributionTax");}
    if(input.nmHasOtherStateCredit===true){errors.push("New Mexico credit for tax paid to another state requires separate review.");markError("nmHasOtherStateCredit");}
    if(input.nmHasAmendedOrOtherSpecialItems===true){errors.push("New Mexico amended or other material special cases require separate review.");markError("nmHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "CA" && Number(input.taxYear) === 2025) {
    if (input.caFullYearResident === null || input.caFullYearResident === undefined) { errors.push("California full-year residency confirmation is required."); markError("caFullYearResident"); }
    else if (input.caFullYearResident !== true) { errors.push("California part-year/nonresident returns require Form 540NR and separate review."); markError("caFullYearResident"); }
    if (input.caFilingStatusMatchesFederal === null || input.caFilingStatusMatchesFederal === undefined) { errors.push("Confirm whether California filing status matches federal."); markError("caFilingStatusMatchesFederal"); }
    else if (input.caFilingStatusMatchesFederal !== true) { errors.push("California filing-status differences require separate review."); markError("caFilingStatusMatchesFederal"); }
    if (input.caIsRegisteredDomesticPartner === null || input.caIsRegisteredDomesticPartner === undefined) { errors.push("Complete the California registered-domestic-partner screen."); markError("caIsRegisteredDomesticPartner"); }
    else if (input.caIsRegisteredDomesticPartner === true) { errors.push("California RDP returns require a pro forma federal calculation and separate review."); markError("caIsRegisteredDomesticPartner"); }
    if (!["standard","itemized"].includes(input.caDeductionMethod)) { errors.push("Select the California deduction method."); markError("caDeductionMethod"); }
    ["caScheduleCASubtractions","caScheduleCAAdditions","caDeductionAmount","caPersonalExemptionCount","caBlindExemptionCount","caSeniorExemptionCount","caDependentExemptionCount","caNonrefundableCreditsTotal","caAlternativeMinimumTax","caOtherTaxesRecapture","caOtherLine71Withholding","caEstimatedAndOtherPayments","caForms592593Withholding","caMotionPictureRefundableCredit","caCalEitc","caYoungChildTaxCredit","caFosterYouthTaxCredit","caUseTax","caIsrPenalty","caApplyToNextYear","caContributions","caInterestLatePenalties","caUnderpaymentPenalty"].forEach((field)=>{
      if (input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))) { errors.push(`Complete required California amount/count: ${field}. Enter 0 when none applies.`); markError(field); }
    });
    ["caDeductionAmount","caPersonalExemptionCount","caBlindExemptionCount","caSeniorExemptionCount","caDependentExemptionCount","caNonrefundableCreditsTotal","caAlternativeMinimumTax","caOtherTaxesRecapture","caOtherLine71Withholding","caEstimatedAndOtherPayments","caForms592593Withholding","caMotionPictureRefundableCredit","caCalEitc","caYoungChildTaxCredit","caFosterYouthTaxCredit","caUseTax","caIsrPenalty","caApplyToNextYear","caContributions","caInterestLatePenalties","caUnderpaymentPenalty"].forEach((field)=>{
      if (input[field]!==null&&input[field]!==undefined&&Number(input[field])<0) { errors.push(`California amount/count ${field} cannot be negative.`); markError(field); }
    });
    ["caHasCapitalConstructionFund","caHasFtb3800Or3803","caHasScheduleG1Or5870A","caHasOtherStateTaxCredit","caHasClaimOfRightCredit","caHasAmendedOrOtherSpecialItems"].forEach((field)=>{ if(input[field]===null||input[field]===undefined){ errors.push(`Complete required California special-case screen: ${field}.`); markError(field); } });
    if (input.filingStatus === "mfs") {
      if (input.caMfsSpouseSameDeductionMethod===null||input.caMfsSpouseSameDeductionMethod===undefined) { errors.push("Confirm the California MFS spouse deduction method."); markError("caMfsSpouseSameDeductionMethod"); }
      else if (input.caMfsSpouseSameDeductionMethod!==true) { errors.push("California MFS spouses must use the same deduction method."); markError("caMfsSpouseSameDeductionMethod"); }
      if (input.caMfsCommunityPropertyAllocated===null||input.caMfsCommunityPropertyAllocated===undefined) { errors.push("Confirm California MFS community-property allocation."); markError("caMfsCommunityPropertyAllocated"); }
      else if (input.caMfsCommunityPropertyAllocated!==true) { errors.push("California MFS community-property allocation must be completed."); markError("caMfsCommunityPropertyAllocated"); }
    }
    if(input.caHasCapitalConstructionFund===true){errors.push("California Capital Construction Fund cases require separate review.");markError("caHasCapitalConstructionFund");}
    if(input.caHasFtb3800Or3803===true){errors.push("California FTB 3800/3803 cases require separate review.");markError("caHasFtb3800Or3803");}
    if(input.caHasScheduleG1Or5870A===true){errors.push("California Schedule G-1/FTB 5870A cases require separate review.");markError("caHasScheduleG1Or5870A");}
    if(input.caHasOtherStateTaxCredit===true){errors.push("California Schedule S other-state credit cases require separate review.");markError("caHasOtherStateTaxCredit");}
    if(input.caHasClaimOfRightCredit===true){errors.push("California claim-of-right credit cases require separate review.");markError("caHasClaimOfRightCredit");}
    if(input.caHasAmendedOrOtherSpecialItems===true){errors.push("California amended or material special cases require separate review.");markError("caHasAmendedOrOtherSpecialItems");}
  }


  if (input.stateCode === "OR" && Number(input.taxYear) === 2025) {
    if (input.orFullYearResident === null || input.orFullYearResident === undefined) { errors.push("Oregon full-year residency confirmation is required."); markError("orFullYearResident"); }
    else if (input.orFullYearResident !== true) { errors.push("Oregon part-year/nonresident returns require Form OR-40-P or OR-40-N and separate review."); markError("orFullYearResident"); }
    if (input.orFilingStatusMatchesFederal === null || input.orFilingStatusMatchesFederal === undefined) { errors.push("Confirm whether Oregon filing status matches federal."); markError("orFilingStatusMatchesFederal"); }
    else if (input.orFilingStatusMatchesFederal !== true) { errors.push("Oregon filing-status differences require separate review."); markError("orFilingStatusMatchesFederal"); }
    if (input.orIsRegisteredDomesticPartner === null || input.orIsRegisteredDomesticPartner === undefined) { errors.push("Complete the Oregon registered-domestic-partner screen."); markError("orIsRegisteredDomesticPartner"); }
    else if (input.orIsRegisteredDomesticPartner === true) { errors.push("Oregon RDP returns require a separate federal-as-if-married computation."); markError("orIsRegisteredDomesticPartner"); }
    if (!["standard","itemized"].includes(String(input.orDeductionMethod||""))) { errors.push("Select the Oregon deduction method."); markError("orDeductionMethod"); }
    ["orAdditions","orFederalTaxLiabilitySubtraction","orSocialSecurityTier1Subtraction","orOregonRefundSubtraction","orOtherSubtractions","orDeductionAmount","orInstallmentSaleInterest","orTaxRecaptures","orExemptionCredit","orPoliticalContributionCredit","orOtherStandardCredits","orCarryforwardCredits","orKicker","orOtherWithholding","orPriorYearRefundApplied","orEstimatedPayments","orPteEstimatedPayments","orFederalEitcAmount","orKidsCredit","orOtherRefundableCredits","orPenaltyInterest","orRefundApplications"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required Oregon amount: ${field}. Enter 0 when none applies.`);markError(field);}
      else if(Number(input[field])<0){errors.push(`Oregon amount ${field} cannot be negative.`);markError(field);}
    });
    if(input.filingStatus==="mfs"&&input.orDeductionMethod==="standard"&&(input.orMfsSpouseItemizes===null||input.orMfsSpouseItemizes===undefined)){errors.push("Confirm whether the Oregon MFS spouse itemizes deductions.");markError("orMfsSpouseItemizes");}
    if(input.filingStatus==="mfs"&&input.orDeductionMethod==="standard"&&input.orMfsSpouseItemizes===true&&Number(input.orDeductionAmount)!==0){errors.push("Oregon MFS standard deduction must be $0 when the spouse itemizes.");markError("orDeductionAmount");}
    if(Number(input.orFederalEitcAmount||0)>0&&(input.orYoungestDependentUnder3===null||input.orYoungestDependentUnder3===undefined)){errors.push("Confirm whether the youngest Oregon EIC qualifying dependent was under age 3.");markError("orYoungestDependentUnder3");}
    ["orHasAlternateTaxMethod","orHasOtherStateCredit","orHasItinEicSpecialCase","orHasSeparateTransitTaxFiling","orHasAmendedNolOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Oregon special-case screen: ${field}.`);markError(field);}});
    if(input.orHasAlternateTaxMethod===true){errors.push("Oregon alternate tax methods require separate review.");markError("orHasAlternateTaxMethod");}
    if(input.orHasOtherStateCredit===true){errors.push("Oregon credit for tax paid to another state requires separate review.");markError("orHasOtherStateCredit");}
    if(input.orHasItinEicSpecialCase===true){errors.push("Oregon special ITIN EIC cases require separate review.");markError("orHasItinEicSpecialCase");}
    if(input.orHasSeparateTransitTaxFiling===true){errors.push("Separate Oregon transit-tax filing requires separate review.");markError("orHasSeparateTransitTaxFiling");}
    if(input.orHasAmendedNolOrOtherSpecialItems===true){errors.push("Oregon amended, NOL, or material special cases require separate review.");markError("orHasAmendedNolOrOtherSpecialItems");}
  }

  if (input.stateCode === "WA" && Number(input.taxYear) === 2025) {
    if (input.waFullYearResident === null || input.waFullYearResident === undefined) { errors.push("Washington full-year residency confirmation is required."); markError("waFullYearResident"); }
    else if (input.waFullYearResident !== true) { errors.push("Washington part-year/nonresident or domicile-change capital-gains allocation requires separate review."); markError("waFullYearResident"); }
    if (input.filingStatus === "mfs") { errors.push("Washington MFS capital-gains standard-deduction allocation requires separate review."); }
    if (input.waIsRegisteredDomesticPartner === null || input.waIsRegisteredDomesticPartner === undefined) { errors.push("Complete the Washington registered-domestic-partner screen."); markError("waIsRegisteredDomesticPartner"); }
    else if (input.waIsRegisteredDomesticPartner === true) { errors.push("Washington RDP capital-gains deduction allocation requires separate review."); markError("waIsRegisteredDomesticPartner"); }
    if (input.waCapitalGainsBaseCompleted === null || input.waCapitalGainsBaseCompleted === undefined) { errors.push("Confirm that Washington allocation/exempt-asset adjustments are complete."); markError("waCapitalGainsBaseCompleted"); }
    else if (input.waCapitalGainsBaseCompleted !== true) { errors.push("Complete the Washington capital-gains allocation/exempt-asset base before estimating."); markError("waCapitalGainsBaseCompleted"); }
    ["waCapitalGainsBeforeDeductions","waConstitutionalDeduction","waFamilyOwnedBusinessDeduction","waQualifyingCharitableDonations","waOtherJurisdictionCredit","waBoCapitalGainsCredit","waCapitalGainsPayments","waWorkingFamiliesTaxCredit","waPenaltyInterest"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required Washington amount: ${field}. Enter 0 when none applies.`);markError(field);}
    });
    ["waConstitutionalDeduction","waFamilyOwnedBusinessDeduction","waQualifyingCharitableDonations","waOtherJurisdictionCredit","waBoCapitalGainsCredit","waCapitalGainsPayments","waWorkingFamiliesTaxCredit","waPenaltyInterest"].forEach((field)=>{
      if(input[field]!==null&&input[field]!==undefined&&Number(input[field])<0){errors.push(`Washington amount ${field} cannot be negative.`);markError(field);}
    });
    if(Number(input.waWorkingFamiliesTaxCredit||0)>1330){errors.push("Washington 2025 Working Families Tax Credit cannot exceed $1,330.");markError("waWorkingFamiliesTaxCredit");}
    if(Number(input.stateWithheld||0)>0){errors.push("Washington has no wage income tax; entered state withholding requires multi-state review.");markError("stateWithheld");}
    if(input.waHasOtherMaterialSpecialCase===null||input.waHasOtherMaterialSpecialCase===undefined){errors.push("Complete the Washington material-special-case screen.");markError("waHasOtherMaterialSpecialCase");}
    else if(input.waHasOtherMaterialSpecialCase===true){errors.push("Washington material capital-gains special cases require separate review.");markError("waHasOtherMaterialSpecialCase");}
  }

  if (input.stateCode === "HI" && Number(input.taxYear) === 2025) {
    if(input.hiFullYearResident===null||input.hiFullYearResident===undefined){errors.push("Hawaii full-year residency confirmation is required.");markError("hiFullYearResident");}
    else if(input.hiFullYearResident!==true){errors.push("Hawaii part-year/nonresident Form N-15 cases require separate allocation review.");markError("hiFullYearResident");}
    if(input.hiFilingStatusMatchesFederal===null||input.hiFilingStatusMatchesFederal===undefined){errors.push("Confirm that Hawaii filing status matches federal.");markError("hiFilingStatusMatchesFederal");}
    else if(input.hiFilingStatusMatchesFederal!==true){errors.push("Hawaii filing-status differences require separate review.");markError("hiFilingStatusMatchesFederal");}
    if(input.canBeClaimedAsDependent===true){errors.push("Hawaii dependent-taxpayer standard-deduction cases require separate review.");}
    if(!["standard","itemized"].includes(String(input.hiDeductionMethod||""))){errors.push("Select the Hawaii deduction method.");markError("hiDeductionMethod");}
    ["hiAdditions","hiSubtractions","hiItemizedDeductionAmount","hiExemptionCount","hiOtherTaxes","hiNonrefundableCredits","hiRefundableEic","hiOtherRefundableCredits","hiEstimatedPayments","hiOtherPayments","hiPenaltyInterest"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required Hawaii amount: ${field}. Enter 0 when none applies.`);markError(field);}
      else if(Number(input[field])<0){errors.push(`Hawaii amount ${field} cannot be negative.`);markError(field);}
    });
    if(input.hiExemptionCount!==null&&input.hiExemptionCount!==undefined&&!Number.isInteger(Number(input.hiExemptionCount))){errors.push("Hawaii exemption count must be a whole number.");markError("hiExemptionCount");}
    if(input.hiDeductionMethod==="standard"&&Number(input.hiItemizedDeductionAmount||0)!==0){errors.push("Enter 0 for Hawaii itemized deductions when using the standard deduction.");markError("hiItemizedDeductionAmount");}
    if(input.filingStatus==="mfs"){
      if(input.hiMfsSpouseItemizes===null||input.hiMfsSpouseItemizes===undefined){errors.push("Confirm whether the Hawaii MFS spouse itemizes.");markError("hiMfsSpouseItemizes");}
      else if(input.hiMfsSpouseItemizes===true&&input.hiDeductionMethod==="standard"){errors.push("Hawaii MFS must itemize when the spouse itemizes.");markError("hiDeductionMethod");}
    }
    ["hiHasCertifiedDisabilityExemption","hiHasCapitalGainAlternativeTaxCase","hiHasPteTaxCreditOrAdjustment","hiHasOtherStateCredit","hiHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Hawaii screen: ${field}.`);markError(field);}});
    if(input.hiHasCertifiedDisabilityExemption===true){errors.push("Hawaii certified $7,000 disability exemption requires Form N-172 review.");markError("hiHasCertifiedDisabilityExemption");}
    if(input.hiHasCapitalGainAlternativeTaxCase===true){errors.push("Hawaii alternative capital-gains tax worksheet cases require separate review.");markError("hiHasCapitalGainAlternativeTaxCase");}
    if(input.hiHasPteTaxCreditOrAdjustment===true){errors.push("Hawaii 2025 PTE credit/addition cases require separate review.");markError("hiHasPteTaxCreditOrAdjustment");}
    if(input.hiHasOtherStateCredit===true){errors.push("Hawaii other-state credit cases require separate review.");markError("hiHasOtherStateCredit");}
    if(input.hiHasAmendedOrOtherSpecialItems===true){errors.push("Hawaii amended or material special cases require separate review.");markError("hiHasAmendedOrOtherSpecialItems");}
  }


  if (input.stateCode === "DE" && Number(input.taxYear) === 2025) {
    if(input.deFullYearResident===null||input.deFullYearResident===undefined){errors.push("Delaware full-year residency confirmation is required.");markError("deFullYearResident");}
    else if(input.deFullYearResident!==true){errors.push("Delaware part-year/nonresident cases require separate PIT-NON/resident-election review.");markError("deFullYearResident");}
    if(input.deFilingStatusMatchesFederal===null||input.deFilingStatusMatchesFederal===undefined){errors.push("Confirm that Delaware filing status matches federal.");markError("deFilingStatusMatchesFederal");}
    else if(input.deFilingStatusMatchesFederal!==true){errors.push("Delaware filing-status differences require separate review.");markError("deFilingStatusMatchesFederal");}
    if(input.filingStatus==="mfs"){errors.push("Delaware married separate/combined-separate returns require spouse-level allocation and are held for separate review.");markError("filingStatus");}
    if(input.filingStatus==="qw"){errors.push("Delaware qualifying-surviving-spouse filing-status mapping requires separate review.");markError("filingStatus");}
    if(!["standard","itemized"].includes(String(input.deDeductionMethod||""))){errors.push("Select the Delaware deduction method.");markError("deDeductionMethod");}
    [
      "deAdditions","deSubtractions","deItemizedDeductionAmount","deVolunteerFirefighterCount",
      "deFederalChildDependentCareCredit","deOtherNonrefundableCredits","deFederalEITCAmount",
      "deEstimatedPayments","deSCorporationPayments","deRealEstateCapitalGainsPayments",
      "deOtherRefundableCredits","dePenaltyInterest"
    ].forEach((field)=>{
      if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required Delaware amount: ${field}. Enter 0 when none applies.`);markError(field);}
      else if(Number(input[field])<0){errors.push(`Delaware amount ${field} cannot be negative.`);markError(field);}
    });
    if(input.deVolunteerFirefighterCount!==null&&input.deVolunteerFirefighterCount!==undefined&&!Number.isInteger(Number(input.deVolunteerFirefighterCount))){errors.push("Delaware volunteer-firefighter credit count must be a whole number.");markError("deVolunteerFirefighterCount");}
    const deMaxFirefighters=input.filingStatus==="mfj"?2:1;
    if(Number(input.deVolunteerFirefighterCount||0)>deMaxFirefighters){errors.push(`Delaware volunteer-firefighter credit count cannot exceed ${deMaxFirefighters} for this filing status.`);markError("deVolunteerFirefighterCount");}
    if(input.deDeductionMethod==="standard"){
      if(input.deTaxpayerBlind===null||input.deTaxpayerBlind===undefined){errors.push("Answer the Delaware taxpayer blindness question for the additional standard deduction.");markError("deTaxpayerBlind");}
      if(input.filingStatus==="mfj"&&(input.deSpouseBlind===null||input.deSpouseBlind===undefined)){errors.push("Answer the Delaware spouse blindness question for the additional standard deduction.");markError("deSpouseBlind");}
      if(Number(input.deItemizedDeductionAmount||0)!==0){errors.push("Enter 0 for Delaware itemized deductions when using the standard deduction.");markError("deItemizedDeductionAmount");}
    }
    ["deHasLumpSumDistribution","deHasOtherStateCredit","deHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Delaware screen: ${field}.`);markError(field);}});
    if(input.deHasLumpSumDistribution===true){errors.push("Delaware PIT-STC lump-sum distribution tax requires separate review.");markError("deHasLumpSumDistribution");}
    if(input.deHasOtherStateCredit===true){errors.push("Delaware other-state credit requires the other-state return and limitation worksheet.");markError("deHasOtherStateCredit");}
    if(input.deHasAmendedOrOtherSpecialItems===true){errors.push("Delaware amended or material special cases require separate review.");markError("deHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "CT" && Number(input.taxYear) === 2025) {
    if (input.ctFullYearResident === null || input.ctFullYearResident === undefined) { errors.push("Connecticut full-year residency confirmation is required."); markError("ctFullYearResident"); }
    else if (input.ctFullYearResident !== true) { errors.push("Connecticut part-year/nonresident CT-1040NR/PY returns require separate allocation and review."); markError("ctFullYearResident"); }
    if (input.ctFilingStatusMatchesFederal === null || input.ctFilingStatusMatchesFederal === undefined) { errors.push("Connecticut filing-status confirmation is required."); markError("ctFilingStatusMatchesFederal"); }
    else if (input.ctFilingStatusMatchesFederal !== true) { errors.push("Connecticut filing-status exceptions require separate review."); markError("ctFilingStatusMatchesFederal"); }
    [
      "ctAdditions","ctSubtractions","ctAlternativeMinimumTax","ctPropertyTaxCredit","ctAllowableCredits",
      "ctUseTax","ctEstimatedPayments","ctExtensionPayment","ctFederalEITCAmount",
      "ctOtherRefundableCredits","ctRefundAllocations","ctPenaltyInterest"
    ].forEach((field) => {
      if (input[field] === null || input[field] === undefined || Number.isNaN(Number(input[field]))) { errors.push(`Complete required Connecticut amount: ${field}. Enter 0 when none applies.`); markError(field); }
      else if (Number(input[field]) < 0) { errors.push(`Connecticut amount ${field} cannot be negative.`); markError(field); }
    });
    if (Number(input.ctPropertyTaxCredit || 0) > 300) { errors.push("Connecticut property tax credit cannot exceed $300 per return."); markError("ctPropertyTaxCredit"); }
    ["ctHasOtherStateCredit","ctHasFederalAMT","ctClaimedFederalEITC","ctHasAmendedOrOtherSpecialItems"].forEach((field) => {
      if (input[field] === null || input[field] === undefined) { errors.push(`Complete required Connecticut screen: ${field}.`); markError(field); }
    });
    if (input.ctHasOtherStateCredit === true) { errors.push("Connecticut credit for tax paid to another jurisdiction requires Schedule 2 and the other jurisdiction's return."); markError("ctHasOtherStateCredit"); }
    if (input.ctHasFederalAMT === true && Number(input.ctAlternativeMinimumTax || 0) < 0) { errors.push("Enter the exact Connecticut AMT from Form CT-6251 Line 23."); markError("ctAlternativeMinimumTax"); }
    if (input.ctHasFederalAMT !== true && Number(input.ctAlternativeMinimumTax || 0) !== 0) { errors.push("Enter 0 for Connecticut AMT when federal AMT was not required."); markError("ctAlternativeMinimumTax"); }
    if (input.ctClaimedFederalEITC === true) {
      if (!(Number(input.ctFederalEITCAmount) > 0)) { errors.push("Enter the federal earned income credit amount used for the Connecticut EITC."); markError("ctFederalEITCAmount"); }
      if (input.ctEitcHasQualifyingChild === null || input.ctEitcHasQualifyingChild === undefined) { errors.push("Answer whether the federal EITC has at least one qualifying child."); markError("ctEitcHasQualifyingChild"); }
    } else if (Number(input.ctFederalEITCAmount || 0) !== 0) {
      errors.push("Enter 0 for the federal EITC amount when no federal EITC was claimed."); markError("ctFederalEITCAmount");
    }
    if (input.ctHasAmendedOrOtherSpecialItems === true) { errors.push("Connecticut amended or material special cases require separate review."); markError("ctHasAmendedOrOtherSpecialItems"); }
  }

  if (input.stateCode === "ME" && Number(input.taxYear) === 2025) {
    if (input.meFullYearResident === null || input.meFullYearResident === undefined) { errors.push("Maine full-year residency confirmation is required."); markError("meFullYearResident"); }
    else if (input.meFullYearResident !== true) { errors.push("Maine part-year/nonresident/safe-harbor returns require Schedule NR/NRH and separate allocation."); markError("meFullYearResident"); }
    if (input.meFilingStatusMatchesFederal === null || input.meFilingStatusMatchesFederal === undefined) { errors.push("Maine filing-status confirmation is required."); markError("meFilingStatusMatchesFederal"); }
    else if (input.meFilingStatusMatchesFederal !== true) { errors.push("Maine filing-status exceptions require separate review."); markError("meFilingStatusMatchesFederal"); }
    if (input.filingStatus === "mfs") { errors.push("Maine married-filing-separately returns are held for separate review in this supported core path."); markError("filingStatus"); }
    if (!["single","mfj","hoh","qw"].includes(String(input.filingStatus || ""))) { errors.push("This filing status is outside the supported Maine full-year core path."); markError("filingStatus"); }
    if (!["standard","itemized"].includes(String(input.meFederalDeductionMethod || ""))) { errors.push("Select the 2025 federal deduction method for Maine."); markError("meFederalDeductionMethod"); }
    if (input.meTaxpayerBlind === null || input.meTaxpayerBlind === undefined) { errors.push("Answer the Maine taxpayer blindness question."); markError("meTaxpayerBlind"); }
    if (input.filingStatus === "mfj") {
      if (input.meSpouseCanBeClaimedAsDependent === null || input.meSpouseCanBeClaimedAsDependent === undefined) { errors.push("Answer whether the spouse can be claimed as another person's dependent for Maine."); markError("meSpouseCanBeClaimedAsDependent"); }
      if (input.meSpouseBlind === null || input.meSpouseBlind === undefined) { errors.push("Answer the Maine spouse blindness question."); markError("meSpouseBlind"); }
    }
    [
      "meAdditions","meSubtractions","meItemizedDeductionAmount","meTaxCreditRecapture","meOtherNonrefundableCredits",
      "meFederalEITCAmount","meOtherRefundableCredits","mePropertyTaxFairnessCredit","meSalesTaxFairnessCredit",
      "meOtherMaineWithholding","meOtherPayments","meUseTax","meCasualRentalTax","meVoluntaryContributions",
      "meUnderpaymentPenalty","meCreditToNextYear"
    ].forEach((field) => {
      if (input[field] === null || input[field] === undefined || Number.isNaN(Number(input[field]))) { errors.push(`Complete required Maine amount: ${field}. Enter 0 when none applies.`); markError(field); }
      else if (Number(input[field]) < 0) { errors.push(`Maine amount ${field} cannot be negative.`); markError(field); }
    });
    if (input.meFederalDeductionMethod !== "itemized" && Number(input.meItemizedDeductionAmount || 0) !== 0) { errors.push("Enter 0 for Maine itemized deductions when the federal return used the standard deduction."); markError("meItemizedDeductionAmount"); }
    ["meDependentCreditAge6OrOlderCount","meDependentCreditUnder6Count"].forEach((field) => {
      if (input[field] === null || input[field] === undefined || !Number.isInteger(Number(input[field])) || Number(input[field]) < 0) { errors.push("Enter whole-number Maine dependent exemption credit counts, including 0."); markError(field); }
    });
    if (Number(input.meDependentCreditAge6OrOlderCount || 0) + Number(input.meDependentCreditUnder6Count || 0) > Number(input.numberOfDependents || 0)) { errors.push("Maine dependent credit counts cannot exceed total dependents."); markError("meDependentCreditAge6OrOlderCount"); markError("meDependentCreditUnder6Count"); }
    ["meHasOtherStateCredit","meClaimedFederalEITC","meHasMaineOnlyEitcEligibility","meHasAmendedOrOtherSpecialItems"].forEach((field) => { if (input[field] === null || input[field] === undefined) { errors.push(`Complete required Maine screen: ${field}.`); markError(field); } });
    if (input.meHasOtherStateCredit === true) { errors.push("Maine credit for income tax paid to another taxing jurisdiction requires the other jurisdiction's return and Maine limitation worksheet."); markError("meHasOtherStateCredit"); }
    if (input.meClaimedFederalEITC === true) {
      if (!(Number(input.meFederalEITCAmount) > 0)) { errors.push("Enter the allowed federal EIC amount used by the Maine EIC worksheet."); markError("meFederalEITCAmount"); }
      if (input.meEitcHasQualifyingChild === null || input.meEitcHasQualifyingChild === undefined) { errors.push("Answer whether the federal EIC had at least one qualifying child."); markError("meEitcHasQualifyingChild"); }
    } else if (Number(input.meFederalEITCAmount || 0) !== 0) { errors.push("Enter 0 for federal EIC when no federal EIC was claimed."); markError("meFederalEITCAmount"); }
    if (input.meHasMaineOnlyEitcEligibility === true) { errors.push("Maine-only EIC eligibility requires a pro-forma federal EIC worksheet and separate review."); markError("meHasMaineOnlyEitcEligibility"); }
    if (Number(input.meCasualRentalTax || 0) > 2000) { errors.push("Maine casual-rental sales tax over $2,000 must be reported on a separate sales/use tax return."); markError("meCasualRentalTax"); }
    if (input.meHasAmendedOrOtherSpecialItems === true) { errors.push("Maine amended or material special cases require separate review."); markError("meHasAmendedOrOtherSpecialItems"); }
  }

  if (input.stateCode === "MD" && Number(input.taxYear) === 2025) {
    if (input.mdFullYearResident !== true) { errors.push("Maryland full-year resident Form 502 confirmation is required for this supported path."); markError("mdFullYearResident"); }
    if (input.mdFilingStatusMatchesFederal !== true) { errors.push("Maryland filing-status exceptions require separate review."); markError("mdFilingStatusMatchesFederal"); }
    if (input.filingStatus === "mfs") { errors.push("Maryland married-filing-separately returns require separate review."); markError("filingStatus"); }
    if (input.filingStatus === "mfj" && input.mdSpousesSameLocalJurisdiction !== true) { errors.push("Joint Maryland spouses must be in the same local jurisdiction for this supported path."); markError("mdSpousesSameLocalJurisdiction"); }
    if (!["standard","itemized"].includes(String(input.mdDeductionMethod || ""))) { errors.push("Select the Maryland deduction method."); markError("mdDeductionMethod"); }
    if (!input.mdLocalJurisdiction) { errors.push("Select the Maryland county or Baltimore City."); markError("mdLocalJurisdiction"); }
    ["mdAdditions","mdSubtractions","mdItemizedDeductionBeforePhaseout","mdAge65DependentCount","mdCapitalGainSubjectToAdditionalTax","mdFederalEITCAmount","mdEitcQualifyingChildCount","mdEarnedIncome","mdChildTaxCreditUnder6Count","mdChildTaxCreditDisabledAge6To16Count","mdOtherNonrefundableCredits","mdOtherRefundableCredits","mdOtherMarylandWithholding","mdOtherPayments","mdVoluntaryContributions","mdUnderpaymentInterest","mdHomebuyerWithdrawalPenalty","mdCreditToNextYear"].forEach((field)=>{ if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required Maryland amount: ${field}. Enter 0 when none applies.`);markError(field);} else if(Number(input[field])<0){errors.push(`Maryland amount ${field} cannot be negative.`);markError(field);} });
    if (input.mdTaxpayerBlind === null || input.mdTaxpayerBlind === undefined) { errors.push("Answer the Maryland taxpayer blindness question."); markError("mdTaxpayerBlind"); }
    if (input.filingStatus === "mfj" && (input.mdSpouseBlind === null || input.mdSpouseBlind === undefined)) { errors.push("Answer the Maryland spouse blindness question."); markError("mdSpouseBlind"); }
    if (input.mdDeductionMethod !== "itemized" && Number(input.mdItemizedDeductionBeforePhaseout || 0)!==0) { errors.push("Enter 0 for Maryland itemized deductions when the standard deduction is selected."); markError("mdItemizedDeductionBeforePhaseout"); }
    if (Number(input.mdAge65DependentCount || 0)>Number(input.numberOfDependents || 0)) { errors.push("Maryland age-65 dependent count cannot exceed total dependents."); markError("mdAge65DependentCount"); }
    if (Number(input.mdChildTaxCreditUnder6Count || 0)+Number(input.mdChildTaxCreditDisabledAge6To16Count || 0)>Number(input.numberOfDependents || 0)) { errors.push("Maryland child-tax-credit counts cannot exceed total dependents."); markError("mdChildTaxCreditUnder6Count"); markError("mdChildTaxCreditDisabledAge6To16Count"); }
    if (input.mdHasMarylandOnlyEitcEligibility === true) { errors.push("Maryland-only EITC eligibility requires separate pro-forma federal EIC review."); markError("mdHasMarylandOnlyEitcEligibility"); }
    if (input.mdHasOtherStateCredit === true) { errors.push("Maryland other-state credit requires Form 502CR and separate review."); markError("mdHasOtherStateCredit"); }
    if (input.mdHasMilitaryOrSpecialFiling === true) { errors.push("Maryland military/special filing treatment requires separate review."); markError("mdHasMilitaryOrSpecialFiling"); }
    if (input.mdHasAmendedOrOtherSpecialItems === true) { errors.push("Maryland amended or material special cases require separate review."); markError("mdHasAmendedOrOtherSpecialItems"); }
  }

  if (input.stateCode === "MA" && Number(input.taxYear) === 2025) {
    const status=String(input.filingStatus||"").toLowerCase();
    if(input.maFullYearResident!==true){errors.push("Massachusetts full-year resident Form 1 confirmation is required for this supported path.");markError("maFullYearResident");}
    if(input.maHasFilingStatusException!==false){errors.push("Massachusetts filing-status exceptions require separate review.");markError("maHasFilingStatusException");}
    if(input.maElectsOptional585Rate!==false){errors.push("The optional Massachusetts 5.85% election requires separate review.");markError("maElectsOptional585Rate");}
    if(input.maTaxpayerBlind===null||input.maTaxpayerBlind===undefined){errors.push("Answer the Massachusetts taxpayer blindness question.");markError("maTaxpayerBlind");}
    if(status==="mfj"&&(input.maSpouseBlind===null||input.maSpouseBlind===undefined)){errors.push("Answer the Massachusetts spouse blindness question.");markError("maSpouseBlind");}
    ["maTotalFivePercentIncome","maTotalDeductions","maMedicalDentalExemption","maAdoptionExemption","maScheduleBLine20","maScheduleB85Income","maScheduleB12Income","maScheduleBLine37SurtaxIncome","maScheduleDLine21SurtaxIncome","maLongTermCapitalGainsTax","maCreditRecapture","maInstallmentSaleAdditionalTax","maMassachusettsAGI","maOtherNonrefundableCredits","maVoluntaryContributions","maUseTax","maHealthCarePenalty","maFederalEITCAmount","maSeniorCircuitBreakerCredit","maChildFamilyQualifyingCount","maOtherRefundableCredits","maOtherMassachusettsWithholding","maPriorYearOverpaymentApplied","maEstimatedPayments","maExtensionPayments","maExcessPfmlWithholding","maRealEstateWithholding","maPenaltyInterest","maCreditToNextYear"].forEach((field)=>{if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required Massachusetts amount: ${field}. Enter 0 when none applies.`);markError(field);}else if(Number(input[field])<0){errors.push(`Massachusetts amount ${field} cannot be negative.`);markError(field);}});
    if(!Number.isInteger(Number(input.maChildFamilyQualifyingCount))){errors.push("Massachusetts Child and Family Tax Credit count must be a whole number.");markError("maChildFamilyQualifyingCount");}
    if(input.maClaimedFederalEITC===null||input.maClaimedFederalEITC===undefined){errors.push("Answer whether federal EITC was claimed.");markError("maClaimedFederalEITC");}
    if(input.maClaimedFederalEITC===true&&Number(input.maFederalEITCAmount)<=0){errors.push("Enter the federal EITC amount for the Massachusetts 40% credit.");markError("maFederalEITCAmount");}
    if(input.maClaimedFederalEITC!==true&&Number(input.maFederalEITCAmount||0)!==0){errors.push("Enter 0 for federal EITC when none was claimed.");markError("maFederalEITCAmount");}
    if(status==="mfs"&&input.maClaimedFederalEITC===true){errors.push("Massachusetts MFS EITC requires separate review.");markError("maClaimedFederalEITC");}
    if(status==="mfs"&&Number(input.maChildFamilyQualifyingCount||0)>0){errors.push("Massachusetts MFS Child and Family Tax Credit requires separate review.");markError("maChildFamilyQualifyingCount");}
    if(Number(input.maSeniorCircuitBreakerCredit||0)>2820){errors.push("The 2025 Massachusetts Senior Circuit Breaker Credit cannot exceed $2,820.");markError("maSeniorCircuitBreakerCredit");}
    if(input.maHasOtherJurisdictionCredit===true){errors.push("Massachusetts other-jurisdiction credit requires Schedule F and separate review.");markError("maHasOtherJurisdictionCredit");}
    if(input.maHasAmendedOrOtherSpecialItems===true){errors.push("Massachusetts amended or material special cases require separate review.");markError("maHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "NJ" && Number(input.taxYear) === 2025) {
    const status=String(input.filingStatus||"").toLowerCase();
    if(input.njFullYearResident!==true){errors.push("New Jersey supported planning requires a full-year resident NJ-1040.");markError("njFullYearResident");}
    if(input.njHasFilingStatusException!==false){errors.push("New Jersey filing-status exceptions require separate review.");markError("njHasFilingStatusException");}
    if(status==="mfs"){errors.push("New Jersey married filing separately requires separate review.");}
    const boolFields=["njClaimsDomesticPartnerExemption","njTaxpayerBlindOrDisabled","njTaxpayerVeteran","njPropertyTaxBenefitEligible","njClaimedFederalEITC","njHasNJOnlyEITC","njHasOtherJurisdictionCredit","njHasAmendedOrOtherSpecialItems"];
    if(status==="mfj")boolFields.push("njSpouseBlindOrDisabled","njSpouseVeteran");
    boolFields.forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required New Jersey screen: ${field}.`);markError(field);}});
    ["njGrossIncome","njCollegeDependentCount","njMedicalExpenseDeduction","njAlimonyDeduction","njQualifiedConservationDeduction","njHealthEnterpriseZoneDeduction","njAlternativeBusinessAdjustment","njOrganBoneMarrowDeduction","njNjbestDeduction","njNjclassDeduction","njTuitionDeduction","njPropertyTaxesLine40a","njOtherNonrefundableCredits","njUseTax","njUnderpaymentInterest","njSharedResponsibilityPayment","njOtherNJWithholding","njPaymentsCreditFromPriorYear","njFederalEITCAmount","njExcessUiWfSwfCredit","njExcessDiCredit","njExcessFliCredit","njWoundedWarriorCredit","njPteBaitCredit","njFederalChildDependentCareCredit","njChildTaxCreditUnder6Count","njCreditToNextYear","njCharitableContributions"].forEach((field)=>{if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required New Jersey amount: ${field}. Enter 0 when none applies.`);markError(field);}else if(Number(input[field])<0){errors.push(`New Jersey amount ${field} cannot be negative.`);markError(field);}});
    if(Number(input.njCollegeDependentCount)>Number(input.numberOfDependents||0)){errors.push("New Jersey college-dependent count cannot exceed total dependents.");markError("njCollegeDependentCount");}
    if(Number(input.njChildTaxCreditUnder6Count)>Number(input.numberOfDependents||0)){errors.push("New Jersey children age 5 or younger cannot exceed total dependents.");markError("njChildTaxCreditUnder6Count");}
    if(Number(input.njGrossIncome)>200000&&(Number(input.njNjbestDeduction)>0||Number(input.njNjclassDeduction)>0||Number(input.njTuitionDeduction)>0)){errors.push("NJBEST, NJCLASS, and tuition deductions require NJ gross income of $200,000 or less.");markError("njGrossIncome");}
    const njFilingThreshold=(status==="single"||status==="mfs")?10000:20000;
    if(input.njPropertyTaxBenefitEligible===true&&Number(input.njGrossIncome)<=njFilingThreshold){errors.push("New Jersey property-tax credit at or below the filing threshold uses the special low-income senior/blind/disabled path, including NJ-1040-HW when applicable. Separate review is required.");markError("njPropertyTaxBenefitEligible");}
    if(input.njPropertyTaxBenefitEligible!==true&&Number(input.njPropertyTaxesLine40a||0)!==0){errors.push("Enter 0 for NJ property taxes/rent when the property-tax benefit eligibility answer is No.");markError("njPropertyTaxesLine40a");}
    if(Number(input.njGrossIncome)<=njFilingThreshold&&Number(input.njSharedResponsibilityPayment||0)!==0){errors.push("New Jersey shared responsibility payment must be 0 when New Jersey gross income is at or below the filing threshold.");markError("njSharedResponsibilityPayment");}
    if(input.njClaimedFederalEITC===true&&Number(input.njFederalEITCAmount)<=0){errors.push("Enter the federal EITC amount for the standard 40% New Jersey EITC.");markError("njFederalEITCAmount");}
    if(input.njHasNJOnlyEITC===true){errors.push("New Jersey-only EITC eligibility requires separate review.");markError("njHasNJOnlyEITC");}
    if(input.njHasOtherJurisdictionCredit===true){errors.push("New Jersey other-jurisdiction credit requires Schedule NJ-COJ/Worksheet I and separate review.");markError("njHasOtherJurisdictionCredit");}
    if(input.njHasAmendedOrOtherSpecialItems===true){errors.push("New Jersey amended or material special cases require separate review.");markError("njHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "NY" && Number(input.taxYear) === 2025) {
    const status=String(input.filingStatus||"").toLowerCase();
    if(input.nyFullYearResident!==true){errors.push("New York supported planning requires a full-year resident IT-201.");markError("nyFullYearResident");}
    if(input.nyHasFilingStatusException!==false){errors.push("New York filing-status exceptions require separate review.");markError("nyHasFilingStatusException");}
    if(status==="mfs"){errors.push("New York married filing separately requires separate review for this supported path.");}
    if(!["single","mfj","hoh","qw"].includes(status)){errors.push("This filing status is outside the supported New York IT-201 path.");}
    ["nyHasPartYearLocalResidency","nyJointLocalResidencyMismatch","nyHasYonkersNonresidentEarnings","nyClaimedFederalEITC","nyHasNoncustodialEITC","nyHasOtherStateCredit","nyHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required New York screen: ${field}.`);markError(field);}});
    if(!["standard","itemized"].includes(String(input.nyDeductionMethod||""))){errors.push("Select the New York deduction method.");markError("nyDeductionMethod");}
    if(!["none","nyc","yonkers"].includes(String(input.nyLocality||""))){errors.push("Select the full-year New York local-resident status.");markError("nyLocality");}
    ["nyAdditions","nySubtractions","nyItemizedDeduction","nyHighIncomeLine39Tax","nyOtherNonrefundableCredits","nyOtherStateTaxes","nySalesUseTax","nyMctmt","nyNycTaxableIncome","nyNycOtherTaxes","nyNycNonrefundableCredits","nyYonkersResidentSurcharge","nyEmpireChildUnder4Count","nyEmpireChild4To16Count","nyStateChildDependentCareCredit","nyFederalEITCAmount","nyRealPropertyTaxCredit","nyCollegeTuitionCredit","nyNycChildDependentCareCredit","nyNycSchoolTaxCreditFixed","nyNycSchoolTaxCreditRateReduction","nyNycEITC","nyOtherRefundableCredits","nyOtherNYWithholding","nyEstimatedPayments","nyExtensionPayment","nyVoluntaryContributions","nyPenaltyInterest","nyCreditToNextYear"].forEach((field)=>{if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required New York amount: ${field}. Enter 0 when none applies.`);markError(field);}else if(Number(input[field])<0){errors.push(`New York amount ${field} cannot be negative.`);markError(field);}});
    if(input.nyDeductionMethod!=="itemized"&&Number(input.nyItemizedDeduction||0)!==0){errors.push("Enter 0 for NY itemized deduction when using the standard deduction.");markError("nyItemizedDeduction");}
    if(input.nyHasPartYearLocalResidency===true){errors.push("Part-year NYC/Yonkers residency requires Form IT-360.1 and separate review.");markError("nyHasPartYearLocalResidency");}
    if(input.nyJointLocalResidencyMismatch===true){errors.push("Different spouse NYC/Yonkers residency on a joint return requires separate IT-201 worksheets.");markError("nyJointLocalResidencyMismatch");}
    if(input.nyHasYonkersNonresidentEarnings===true){errors.push("Yonkers nonresident earnings require Form Y-203 and separate review.");markError("nyHasYonkersNonresidentEarnings");}
    if(input.nyLocality!=="nyc"&&["nyNycTaxableIncome","nyNycOtherTaxes","nyNycNonrefundableCredits","nyNycChildDependentCareCredit","nyNycSchoolTaxCreditFixed","nyNycSchoolTaxCreditRateReduction","nyNycEITC"].some((f)=>Number(input[f]||0)!==0)){errors.push("NYC-only amounts must be 0 unless full-year NYC resident is selected.");markError("nyLocality");}
    if(input.nyLocality!=="yonkers"&&Number(input.nyYonkersResidentSurcharge||0)!==0){errors.push("Yonkers resident surcharge must be 0 unless full-year Yonkers resident is selected.");markError("nyYonkersResidentSurcharge");}
    if(!Number.isInteger(Number(input.nyEmpireChildUnder4Count))||!Number.isInteger(Number(input.nyEmpireChild4To16Count))){errors.push("Empire State child-credit counts must be whole numbers.");}
    if(Number(input.nyEmpireChildUnder4Count)+Number(input.nyEmpireChild4To16Count)>Number(input.numberOfDependents||0)){errors.push("Empire State qualifying-child counts cannot exceed total dependents.");markError("nyEmpireChildUnder4Count");}
    if(input.nyClaimedFederalEITC===true&&Number(input.nyFederalEITCAmount)<=0){errors.push("Enter the federal EITC amount for the New York State EIC.");markError("nyFederalEITCAmount");}
    if(input.nyHasNoncustodialEITC===true){errors.push("New York noncustodial-parent EIC requires Form IT-209 and separate review.");markError("nyHasNoncustodialEITC");}
    if(input.nyHasOtherStateCredit===true){errors.push("New York resident credit for taxes paid to another state/Canada requires IT-112-R/IT-112-C and separate review.");markError("nyHasOtherStateCredit");}
    if(input.nyHasAmendedOrOtherSpecialItems===true){errors.push("New York amended or material special cases require separate review.");markError("nyHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "RI" && Number(input.taxYear) === 2025) {
    const status=String(input.filingStatus||"").toLowerCase();
    if(input.riFullYearResident===null||input.riFullYearResident===undefined){errors.push("Rhode Island full-year residency confirmation is required.");markError("riFullYearResident");}
    else if(input.riFullYearResident!==true){errors.push("Rhode Island part-year/nonresident RI-1040NR returns require separate allocation and review.");markError("riFullYearResident");}
    if(input.riHasFilingStatusException===null||input.riHasFilingStatusException===undefined){errors.push("Rhode Island filing-status confirmation is required.");markError("riHasFilingStatusException");}
    else if(input.riHasFilingStatusException===true){errors.push("Rhode Island filing-status exceptions require separate review.");markError("riHasFilingStatusException");}
    if(status==="mfs"){errors.push("Rhode Island married-filing-separately returns are held for separate review in this supported core path.");markError("filingStatus");}
    if(!["single","mfj","hoh","qw"].includes(status)){errors.push("This filing status is outside the supported Rhode Island RI-1040 core path.");markError("filingStatus");}
    if(input.riNetModifications===null||input.riNetModifications===undefined||Number.isNaN(Number(input.riNetModifications))){errors.push("Enter the exact signed RI Schedule M Line 3 net modification, including 0.");markError("riNetModifications");}
    ["riFederalChildDependentCareCredit","riOtherStateCredit","riOtherRhodeIslandCredits","riCreditRecapture","riCheckoffContributions","riUseSalesTax","riIndividualMandatePenalty","riFederalEITCAmount","riPropertyTaxReliefCredit","riLeadPaintCredit","riOtherRhodeIslandWithholding","riEstimatedPayments","riOtherPayments","riUnderpaymentInterest","riCreditToNextYear"].forEach((field)=>{if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required Rhode Island amount: ${field}. Enter 0 when none applies.`);markError(field);}else if(Number(input[field])<0){errors.push(`Rhode Island amount ${field} cannot be negative.`);markError(field);}});
    ["riClaimedFederalEITC","riHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Rhode Island screen: ${field}.`);markError(field);}});
    if(input.riClaimedFederalEITC===true&&Number(input.riFederalEITCAmount)<=0){errors.push("Enter the federal EITC amount used for the Rhode Island 16% EIC.");markError("riFederalEITCAmount");}
    if(input.riClaimedFederalEITC!==true&&Number(input.riFederalEITCAmount||0)!==0){errors.push("Enter 0 for federal EITC when no federal EITC was claimed.");markError("riFederalEITCAmount");}
    if(input.riHasAmendedOrOtherSpecialItems===true){errors.push("Rhode Island amended or other material special cases require separate review.");markError("riHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "VT" && Number(input.taxYear) === 2025) {
    const status=String(input.filingStatus||"").toLowerCase();
    if(input.vtFullYearResident===null||input.vtFullYearResident===undefined){errors.push("Vermont full-year residency confirmation is required.");markError("vtFullYearResident");}
    else if(input.vtFullYearResident!==true){errors.push("Vermont part-year/nonresident returns require Schedule IN-113 allocation and review.");markError("vtFullYearResident");}
    if(input.vtHasFilingStatusException===null||input.vtHasFilingStatusException===undefined){errors.push("Vermont special/recomputed filing-status confirmation is required.");markError("vtHasFilingStatusException");}
    else if(input.vtHasFilingStatusException===true){errors.push("Vermont recomputed federal, cannabis recomputation, civil-union, or other filing-status exceptions require separate review.");markError("vtHasFilingStatusException");}
    if(!["single","mfj","mfs","hoh","qw"].includes(status)){errors.push("This filing status is outside the supported Vermont IN-111 core path.");markError("filingStatus");}
    ["vtHasIncomeAdjustment","vtClaimedFederalEITC","vtIsQualifyingVeteran","vtUsesRenterCreditForIncomeTax","vtHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Vermont screen: ${field}.`);markError(field);}});
    if(status==="mfj"&&(input.vtSpouseCanBeClaimedAsDependent===null||input.vtSpouseCanBeClaimedAsDependent===undefined)){errors.push("Confirm whether the MFJ spouse can be claimed as another person's dependent for Vermont.");markError("vtSpouseCanBeClaimedAsDependent");}
    ["vtNetModifications","vtNetTaxAdjustment"].forEach((field)=>{if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required signed Vermont amount: ${field}. Enter 0 when none applies.`);markError(field);}});
    ["vtStandardDeductionBoxCount","vtUsObligationInterestForMinimumTax","vtCharitableContributions","vtOtherStateCredit","vtOtherNonrefundableCredits","vtChildCareContribution","vtUseTax","vtVoluntaryContributions","vtFederalChildDependentCareCredit","vtChildTaxCreditQualifyingChildCount","vtFederalEITCAmount","vtEitcQualifyingChildCount","vtOtherVermontWithholding","vtEstimatedPayments","vtRealEstateWithholding","vtK1EntityPayments","vtUnderpaymentInterestPenalty","vtCreditToNextYear","vtCreditToPropertyTaxBill"].forEach((field)=>{if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))){errors.push(`Complete required Vermont amount: ${field}. Enter 0 when none applies.`);markError(field);}else if(Number(input[field])<0){errors.push(`Vermont amount ${field} cannot be negative.`);markError(field);}});
    const boxes=Number(input.vtStandardDeductionBoxCount);const maxBoxes=["mfj","mfs"].includes(status)?4:2;if(!Number.isInteger(boxes)||boxes<0||boxes>maxBoxes){errors.push(`Vermont standard-deduction box count must be a whole number from 0 through ${maxBoxes}.`);markError("vtStandardDeductionBoxCount");}
    const childCount=Number(input.vtChildTaxCreditQualifyingChildCount);if(!Number.isInteger(childCount)||childCount<0||childCount>Number(input.numberOfDependents||0)){errors.push("Vermont Child Tax Credit qualifying-child count cannot exceed federal dependents.");markError("vtChildTaxCreditQualifyingChildCount");}
    const eitcChildren=Number(input.vtEitcQualifyingChildCount);if(!Number.isInteger(eitcChildren)||eitcChildren<0||eitcChildren>3){errors.push("Vermont EITC qualifying-child count must be 0 through 3.");markError("vtEitcQualifyingChildCount");}
    if(input.vtClaimedFederalEITC===true&&Number(input.vtFederalEITCAmount)<=0){errors.push("Enter the federal EITC amount used for Vermont.");markError("vtFederalEITCAmount");}
    if(input.vtClaimedFederalEITC!==true&&(Number(input.vtFederalEITCAmount||0)!==0||eitcChildren!==0)){errors.push("Enter 0 for federal EITC and qualifying children when no federal EITC was claimed.");markError("vtFederalEITCAmount");markError("vtEitcQualifyingChildCount");}
    if(input.vtHasIncomeAdjustment===true){errors.push("Vermont Schedule IN-113 income adjustments require separate review.");markError("vtHasIncomeAdjustment");}
    if(input.vtUsesRenterCreditForIncomeTax===true){errors.push("A Vermont RCC-146 Renter Credit used against income tax requires separate review.");markError("vtUsesRenterCreditForIncomeTax");}
    if(input.vtHasAmendedOrOtherSpecialItems===true){errors.push("Vermont amended or other material special cases require separate review.");markError("vtHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "DC" && Number(input.taxYear) === 2025) {
    const status=String(input.filingStatus||"").toLowerCase();
    if(input.dcFullYearResident===null||input.dcFullYearResident===undefined){errors.push("District full-year residency confirmation is required.");markError("dcFullYearResident");}
    else if(input.dcFullYearResident!==true){errors.push("District part-year/nonresident returns require separate review.");markError("dcFullYearResident");}
    if(input.dcHasFilingStatusException===null||input.dcHasFilingStatusException===undefined){errors.push("Complete the District filing-status exception screen.");markError("dcHasFilingStatusException");}
    else if(input.dcHasFilingStatusException===true){errors.push("District combined-separate or other filing-status exceptions require separate review.");markError("dcHasFilingStatusException");}
    if(status==="mfs"){errors.push("District married filing separately requires separate spouse allocations and review.");markError("filingStatus");}
    if(!["standard","itemized"].includes(input.dcDeductionMethod)){errors.push("Select the District deduction method.");markError("dcDeductionMethod");}
    ["dcTaxpayerBlind","dcFullYearHealthCoverageOrExempt","dcClaimsEITC","dcClaimsScheduleH","dcHasOtherJurisdictionCredit","dcHasD30UnincorporatedBusiness","dcHasNoncustodialEITC","dcHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required District screen: ${field}.`);markError(field);}});
    if(status==="mfj"&&(input.dcSpouseBlind===null||input.dcSpouseBlind===undefined)){errors.push("Complete the MFJ spouse blind screen for the District standard deduction.");markError("dcSpouseBlind");}
    const amounts=["dcFranchiseTaxAddback","dcOtherAdditions","dcStateLocalRefundSubtraction","dcTaxableSocialSecuritySubtraction","dcFranchiseFiduciaryIncomeSubtraction","dcSurvivorBenefitsSubtraction","dcUnemploymentSubtraction","dcOtherSubtractions","dcFederalItemizedDeductions","dcFederalStateLocalTaxDeduction","dcFederalRealEstateTax","dcFederalOtherTaxes","dcProtectedItemizedDeductions","dcFederalChildDependentCareCredit","dcOtherNonrefundableCredits","dcHealthCareSharedResponsibilityPayment","dcEitcQualifyingChildCount","dcCalculatedFederalEITCAmount","dcChildlessEarnedIncome","dcScheduleHCredit","dcOtherRefundableCredits","dcOtherWithholding","dcEstimatedPayments","dcExtensionPayment","dcUnderpaymentInterest","dcCreditToNextYear","dcVoluntaryContributions"];
    amounts.forEach((field)=>{if(input[field]===null||input[field]===undefined||Number.isNaN(Number(input[field]))||Number(input[field])<0){errors.push(`Complete District amount ${field} with 0 or a nonnegative amount.`);markError(field);}});
    if(input.dcHasOtherJurisdictionCredit===true){errors.push("District other-jurisdiction credit requires separate review.");markError("dcHasOtherJurisdictionCredit");}
    if(input.dcHasD30UnincorporatedBusiness===true){errors.push("District D-30/unincorporated-business situations require separate review.");markError("dcHasD30UnincorporatedBusiness");}
    if(input.dcHasNoncustodialEITC===true){errors.push("District Schedule N noncustodial-parent EITC requires separate review.");markError("dcHasNoncustodialEITC");}
    if(input.dcHasAmendedOrOtherSpecialItems===true){errors.push("District amended or other material special cases require separate review.");markError("dcHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "KS" && Number(input.taxYear) === 2025) {
    if (input.ksFullYearResident === null || input.ksFullYearResident === undefined) { errors.push("Kansas full-year residency confirmation is required."); markError("ksFullYearResident"); }
    else if (input.ksFullYearResident !== true) { errors.push("Kansas part-year/nonresident Schedule S Part B returns require separate allocation."); markError("ksFullYearResident"); }
    if (!["standard","itemized"].includes(String(input.ksDeductionMethod||""))) { errors.push("Select the Kansas K-40 Line 4 deduction method."); markError("ksDeductionMethod"); }
    ["ksDeductionAmount","ksNewbornDependentCount","ksStillbirthCount","ksDisabledVeteranCount","ksLumpSumDistributionTax","ksFederalChildDependentCareCredit","ksOtherNonrefundableCredits","ksFederalEITCAmount","ksOtherFormWithholding","ksEstimatedPayments","ksExtensionPayment","ksOtherRefundableCredits","ksPtetCredit","ksInterest","ksLatePaymentPenalty","ksEstimatedTaxPenalty","ksCreditForward","ksContributions"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined){errors.push(`Complete required Kansas amount: ${field}. Enter 0 when none applies.`);markError(field);}
      else if(Number(input[field])<0){errors.push(`Kansas amount ${field} cannot be negative.`);markError(field);}
    });
    if(input.ksNetModifications===null||input.ksNetModifications===undefined){errors.push("Enter exact signed Kansas Schedule S net modifications, including 0.");markError("ksNetModifications");}
    ["ksHasOtherStateCredit","ksHasSeparatePropertyTaxRefundClaim","ksHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Kansas screen: ${field}.`);markError(field);}});
    if(input.filingStatus==="mfs"&&(input.ksMfsSpouseSameDeductionMethod===null||input.ksMfsSpouseSameDeductionMethod===undefined)){errors.push("Confirm that both Kansas MFS spouses use the same deduction method.");markError("ksMfsSpouseSameDeductionMethod");}
    else if(input.filingStatus==="mfs"&&input.ksMfsSpouseSameDeductionMethod!==true){errors.push("Kansas MFS spouses must use the same deduction method.");markError("ksMfsSpouseSameDeductionMethod");}
    const ksCreditClaimed=Number(input.ksFederalChildDependentCareCredit||0)>0||Number(input.ksOtherNonrefundableCredits||0)>0||Number(input.ksFederalEITCAmount||0)>0||Number(input.ksOtherRefundableCredits||0)>0;
    if(ksCreditClaimed&&(input.ksCreditSsnEligibilityConfirmed===null||input.ksCreditSsnEligibilityConfirmed===undefined)){errors.push("Confirm the Kansas valid-SSN rule for the supported credits claimed.");markError("ksCreditSsnEligibilityConfirmed");}
    else if(ksCreditClaimed&&input.ksCreditSsnEligibilityConfirmed!==true){errors.push("Kansas supported credits require the applicable valid-SSN rule to be satisfied.");markError("ksCreditSsnEligibilityConfirmed");}
    if(!Number.isInteger(Number(input.ksNewbornDependentCount))||!Number.isInteger(Number(input.ksStillbirthCount))||!Number.isInteger(Number(input.ksDisabledVeteranCount))){errors.push("Kansas additional-exemption counts must be whole numbers.");}
    const ksMaxDisabled=input.filingStatus==="mfj"?2:1;
    if(Number(input.ksDisabledVeteranCount)>ksMaxDisabled){errors.push("Kansas qualified disabled-veteran count exceeds the taxpayer/spouse positions for this filing status.");markError("ksDisabledVeteranCount");}
    if(input.canBeClaimedAsDependent!==true&&Number(input.ksNewbornDependentCount)>Number(input.numberOfDependents||0)){errors.push("Kansas newborn dependent count cannot exceed the federal dependent count.");markError("ksNewbornDependentCount");}
    if(input.ksHasOtherStateCredit===true){errors.push("Kansas K-40 Line 13 other-state/local tax credit requires separate review.");markError("ksHasOtherStateCredit");}
    if(input.ksHasSeparatePropertyTaxRefundClaim===true){errors.push("Kansas K-40H/K-40PT/K-40SVR property-tax refund claims require a separate calculation.");markError("ksHasSeparatePropertyTaxRefundClaim");}
    if(input.ksHasAmendedOrOtherSpecialItems===true){errors.push("Kansas amended or material special cases require separate review.");markError("ksHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "NE" && Number(input.taxYear) === 2025) {
    if (input.neFullYearResident === null || input.neFullYearResident === undefined) { errors.push("Nebraska full-year residency confirmation is required."); markError("neFullYearResident"); }
    else if (input.neFullYearResident !== true) { errors.push("Nebraska partial-year/nonresident Schedule III returns require separate allocation."); markError("neFullYearResident"); }
    ["neStandardDeduction","neFederalItemizedDeductions","neStateLocalIncomeTaxes","neScheduleIIncreases","neScheduleIDecreases","neFederalLumpSumTax","neFederalEarlyDistributionTax","neOtherNonrefundableCredits","neOtherFormWithholding","neK1Withholding","nePtetCredit","neEstimatedPayments","neForm3800RefundableCredit","neChildDependentCareRefundableCredit","neBeginningFarmerCredit","neFederalEITCAmount","neOtherRefundableCredits","neUnderpaymentPenalty","neUseTax","neApplyToNextYear","neWildlifeDonation"].forEach((field)=>{
      if(input[field]===null||input[field]===undefined){errors.push(`Complete required Nebraska amount: ${field}. Enter 0 when none applies.`);markError(field);}
      else if(Number(input[field])<0){errors.push(`Nebraska amount ${field} cannot be negative.`);markError(field);}
    });
    const neNetAdjustments = Number(input.neScheduleIIncreases || 0) - Number(input.neScheduleIDecreases || 0);
    if (neNetAdjustments < 5000) {
      if (input.neFederalTaxBeforeCreditsLimit === null || input.neFederalTaxBeforeCreditsLimit === undefined) { errors.push("Enter the exact federal-tax-before-credits amount from Nebraska's Line 35 worksheet."); markError("neFederalTaxBeforeCreditsLimit"); }
      else if (Number(input.neFederalTaxBeforeCreditsLimit) < 0) { errors.push("Nebraska federal-tax-before-credits amount cannot be negative."); markError("neFederalTaxBeforeCreditsLimit"); }
    }
    ["neHasOtherStateCredit","neUseTaxRequiresSeparateForm3","neHasFederalNolEitcSpecialCase","neHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Nebraska screen: ${field}.`);markError(field);}});
    if(input.filingStatus==="mfj"&&(input.neSpouseCanBeClaimedAsDependent===null||input.neSpouseCanBeClaimedAsDependent===undefined)){errors.push("Confirm whether the MFJ spouse can be claimed by another taxpayer for Nebraska.");markError("neSpouseCanBeClaimedAsDependent");}
    if(Number(input.neStateLocalIncomeTaxes)>Number(input.neFederalItemizedDeductions)){errors.push("Nebraska Line 8 state/local income taxes cannot exceed Line 7 itemized deductions.");markError("neStateLocalIncomeTaxes");}
    if(input.neHasOtherStateCredit===true){errors.push("Nebraska Schedule II other-state credit cases require separate review.");markError("neHasOtherStateCredit");}
    if(input.neUseTaxRequiresSeparateForm3===true){errors.push("Nebraska use tax requiring separate Form 3 review cannot be safely calculated in the Form 1040N path.");markError("neUseTaxRequiresSeparateForm3");}
    if(input.neHasFederalNolEitcSpecialCase===true){errors.push("Nebraska NOL/EITC special worksheet cases require separate review.");markError("neHasFederalNolEitcSpecialCase");}
    if(input.neHasAmendedOrOtherSpecialItems===true){errors.push("Nebraska amended or material special cases require separate review.");markError("neHasAmendedOrOtherSpecialItems");}
  }

  if (input.stateCode === "IA" && Number(input.taxYear) === 2025) {
    if (input.iaFullYearResident === null || input.iaFullYearResident === undefined) { errors.push("Iowa full-year residency confirmation is required."); markError("iaFullYearResident"); }
    else if (input.iaFullYearResident !== true) { errors.push("Iowa part-year/nonresident IA 126 returns require separate allocation."); markError("iaFullYearResident"); }
    [
      "iaNetIowaModifications","iaFederalDeductionForSpecialCalc","iaFederalPersonalExemptionForSpecialCalc","iaQualifiedBusinessIncomeDeduction","iaNolCarryover","iaLumpSumDistributionTaxableIncome",
      "iaLumpSumTax","iaTuitionTextbookCredit","iaVolunteerCredit","iaOtherNonrefundableCredits","iaSchoolDistrictEmsSurtaxRate","iaContributions","iaFuelTaxCredit","iaChildDependentOrEarlyChildhoodCredit",
      "iaEarnedIncomeTaxCredit","iaOtherRefundableCredits","iaCompositePtetCredit","iaEstimatedAndOtherPayments","iaUnderpaymentPenalty","iaOtherPenaltyInterest"
    ].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Iowa amount: ${field}.`);markError(field);}});
    ["iaTaxpayerBlind","iaHasOutOfStateTaxCredit","iaHasAmendedOrOtherSpecialItems"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete required Iowa screen: ${field}.`);markError(field);}});
    if (input.filingStatus === "mfj" && (input.iaSpouseBlind===null||input.iaSpouseBlind===undefined)) { errors.push("Confirm spouse blind status for Iowa MFJ."); markError("iaSpouseBlind"); }
    if (input.filingStatus === "mfs") {
      ["iaMfsSpouseIowaTaxableIncome","iaMfsSpouseAdjustedIncome","iaMfsSpouseNolCarryover"].forEach((field)=>{if(input[field]===null||input[field]===undefined){errors.push(`Complete Iowa MFS spouse amount: ${field}.`);markError(field);}});
    }
    if (Number(input.iaSchoolDistrictEmsSurtaxRate) < 0 || Number(input.iaSchoolDistrictEmsSurtaxRate) > 100) { errors.push("Iowa school-district/EMS surtax rate must be between 0% and 100%."); markError("iaSchoolDistrictEmsSurtaxRate"); }
    if (input.iaHasOutOfStateTaxCredit === true) { errors.push("Iowa IA 130 out-of-state credit cases require separate review."); markError("iaHasOutOfStateTaxCredit"); }
    if (input.iaHasAmendedOrOtherSpecialItems === true) { errors.push("Iowa amended or material special cases require separate review."); markError("iaHasAmendedOrOtherSpecialItems"); }
  }

  if (input.stateCode === "MN" && Number(input.taxYear) === 2025) {
    if (input.mnFullYearResident === null || input.mnFullYearResident === undefined) { errors.push("Minnesota full-year residency confirmation is required."); markError("mnFullYearResident"); }
    else if (input.mnFullYearResident !== true) { errors.push("Minnesota part-year/nonresident Schedule M1NR returns require separate allocation."); markError("mnFullYearResident"); }
    ["mnM1Additions","mnStateIncomeTaxRefund","mnM1Subtractions","mnAlternativeMinimumTax","mnOtherTaxes","mnAdvanceChildTaxCreditRepayment","mnNonrefundableCredits","mnNongameWildlifeContribution","mnEstimatedPayments","mnRefundableCredits","mnScheduleM15Penalty","mnOtherPenaltyInterest"].forEach((f)=>{if(input[f]===null||input[f]===undefined){errors.push(`Complete required Minnesota amount: ${f}. Enter 0 when none applies.`);markError(f);}});
    ["mnUseItemizedDeductions","mnHasM1NCFederalAdjustments","mnHasOtherStateCreditOrReciprocity","mnShortPeriodOrNonresidentAlien","mnHasAmendedOrOtherSpecialItems"].forEach((f)=>{if(input[f]===null||input[f]===undefined){errors.push(`Complete required Minnesota screen: ${f}.`);markError(f);}});
    if (input.mnShortPeriodOrNonresidentAlien === true) { errors.push("Minnesota short-period/nonresident-alien standard-deduction cases require separate review."); markError("mnShortPeriodOrNonresidentAlien"); }
    if (input.mnUseItemizedDeductions === true && (input.mnItemizedDeductions===null||input.mnItemizedDeductions===undefined)) { errors.push("Enter exact Minnesota Schedule M1SA Line 27 itemized deduction."); markError("mnItemizedDeductions"); }
    if (input.mnUseItemizedDeductions !== true && (input.mnTaxpayerBlind===null||input.mnTaxpayerBlind===undefined)) { errors.push("Confirm taxpayer blind status for Minnesota's standard deduction."); markError("mnTaxpayerBlind"); }
    if (input.filingStatus === "mfs" && (input.mnMfsSpouseItemizes===null||input.mnMfsSpouseItemizes===undefined)) { errors.push("Confirm whether the spouse itemizes for Minnesota MFS."); markError("mnMfsSpouseItemizes"); }
    if (input.filingStatus === "mfs" && input.mnMfsSpouseItemizes!==null && input.mnMfsSpouseItemizes!==undefined && input.mnUseItemizedDeductions!==input.mnMfsSpouseItemizes) { errors.push("Minnesota MFS spouses must use the same deduction method."); markError("mnMfsSpouseItemizes"); }
    if (input.filingStatus === "mfs" && input.mnUseItemizedDeductions !== true && (input.mnMfsSpouseNoGrossIncomeAndNotDependent===null||input.mnMfsSpouseNoGrossIncomeAndNotDependent===undefined)) { errors.push("Complete the Minnesota MFS spouse standard-deduction box screen."); markError("mnMfsSpouseNoGrossIncomeAndNotDependent"); }
    if (input.mnUseItemizedDeductions !== true && ["mfj","mfs"].includes(input.filingStatus) && (input.mnSpouseBlind===null||input.mnSpouseBlind===undefined)) { errors.push("Confirm spouse blind status for Minnesota's standard deduction."); markError("mnSpouseBlind"); }
    if (input.mnUseItemizedDeductions !== true && input.filingStatus === "mfj" && (input.mnSpouseCanBeClaimedAsDependent===null||input.mnSpouseCanBeClaimedAsDependent===undefined)) { errors.push("Confirm whether the MFJ spouse can be claimed as another person's dependent for Minnesota."); markError("mnSpouseCanBeClaimedAsDependent"); }
    const mnDependentWorksheet = input.mnUseItemizedDeductions !== true && (input.canBeClaimedAsDependent===true || (input.filingStatus==="mfj" && input.mnSpouseCanBeClaimedAsDependent===true));
    if (mnDependentWorksheet && (input.mnDependentEarnedIncome===null||input.mnDependentEarnedIncome===undefined)) { errors.push("Enter earned income for Minnesota's dependent standard-deduction worksheet."); markError("mnDependentEarnedIncome"); }
    if (input.mnHasM1NCFederalAdjustments===true && (input.mnM1NCWorksheetAGI===null||input.mnM1NCWorksheetAGI===undefined)) { errors.push("Enter Schedule M1NC Line 43 worksheet AGI."); markError("mnM1NCWorksheetAGI"); }
    if (input.mnHasOtherStateCreditOrReciprocity===true) { errors.push("Minnesota other-state credit/reciprocity cases require separate review."); markError("mnHasOtherStateCreditOrReciprocity"); }
    if (input.mnHasAmendedOrOtherSpecialItems===true) { errors.push("Minnesota amended or material special cases require separate review."); markError("mnHasAmendedOrOtherSpecialItems"); }
  }

  if (input.stateCode === "WI" && Number(input.taxYear) === 2025) {
    if (input.wiFullYearResident === null || input.wiFullYearResident === undefined) { errors.push("Wisconsin full-year residency confirmation is required."); markError("wiFullYearResident"); }
    else if (input.wiFullYearResident !== true) { errors.push("Wisconsin part-year/nonresident Form 1NPR returns require separate allocation and cannot be estimated in this full-year path."); markError("wiFullYearResident"); }

    [
      ["wiScheduleIAdjustment", "Enter exact Wisconsin Schedule I Line 3 net adjustment, including 0."],
      ["wiScheduleADAdditions", "Enter exact Schedule AD Line 33 additions, including 0."],
      ["wiScheduleSBSubtractions", "Enter exact Schedule SB Line 50 subtractions, including 0."],
      ["wiNonrefundableCredits", "Enter exact Form 1 Lines 13–20 nonrefundable credits, including 0."],
      ["wiOtherRefundableCredits", "Enter exact Form 1 Lines 31–35 other refundable credits, including 0."],
      ["wiUseTax", "Enter Form 1 Line 23 sales/use tax, including 0."],
      ["wiDonations", "Enter Form 1 Line 24 donations, including 0."],
      ["wiRetirementPenaltiesAndCreditRepayments", "Enter exact Form 1 Lines 25–26 penalties/credit repayments, including 0."],
      ["wiEstimatedPayments", "Enter Form 1 Line 29 estimated/extension payments, including 0."],
      ["wiUnderpaymentInterest", "Enter exact Form 1 Line 44 underpayment interest, including 0."],
    ].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });

    [
      ["wiShortPeriodOrPossessions", "Complete the Wisconsin short-period/U.S.-possessions standard-deduction screen."],
      ["wiUsedNewRetirementIncomeSubtraction", "Complete the Wisconsin new age-67 retirement-subtraction screen."],
      ["wiClaimedFederalEIC", "Complete the Wisconsin earned-income-credit screen."],
      ["wiHasOtherStateCreditOrReciprocity", "Complete the Wisconsin other-state-credit/reciprocity screen."],
      ["wiHasAmendedOrOtherSpecialItems", "Complete the Wisconsin amended/other-special-item screen."],
    ].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });

    if (input.wiShortPeriodOrPossessions === true) { errors.push("Wisconsin short-period/Form 4563 cases do not use the ordinary standard deduction and require separate review."); markError("wiShortPeriodOrPossessions"); }
    if (input.filingStatus === "mfj" && (input.wiSpouseCanBeClaimedAsDependent === null || input.wiSpouseCanBeClaimedAsDependent === undefined)) { errors.push("Confirm whether the spouse can be claimed as another person's dependent for Wisconsin."); markError("wiSpouseCanBeClaimedAsDependent"); }
    const wiDependentWorksheetApplies = input.canBeClaimedAsDependent === true || (input.filingStatus === "mfj" && input.wiSpouseCanBeClaimedAsDependent === true);
    if (wiDependentWorksheetApplies && (input.wiDependentEarnedIncome === null || input.wiDependentEarnedIncome === undefined)) { errors.push("Enter earned income included on Wisconsin Form 1 Line 7 for the dependent standard-deduction worksheet."); markError("wiDependentEarnedIncome"); }

    if (input.wiClaimedFederalEIC === true) {
      if (input.filingStatus === "mfs") { errors.push("An ordinary Wisconsin MFS return cannot claim Wisconsin EIC; qualifying IRC 7703(b) cases should use Wisconsin head-of-household status."); markError("wiClaimedFederalEIC"); }
      if (!(Number(input.wiFederalEICAmount || 0) > 0)) { errors.push("Enter the exact federal EIC amount used for Wisconsin purposes."); markError("wiFederalEICAmount"); }
      if (!(Number(input.wiEICQualifyingChildren || 0) >= 1)) { errors.push("Wisconsin EIC requires at least one qualifying child; enter the federal EIC qualifying-child count."); markError("wiEICQualifyingChildren"); }
    }
    if (input.wiUsedNewRetirementIncomeSubtraction === true && (Number(input.wiNonrefundableCredits || 0) > 0 || input.wiClaimedFederalEIC === true || Number(input.wiOtherRefundableCredits || 0) > 0)) {
      errors.push("The new 2025 Wisconsin age-67 retirement-income subtraction cannot be combined with Wisconsin credits on Form 1 Lines 13–20 or 30–35."); markError("wiUsedNewRetirementIncomeSubtraction");
    }
    if (input.wiHasOtherStateCreditOrReciprocity === true) { errors.push("Wisconsin other-state credit/reciprocity cases require separate source and tax review."); markError("wiHasOtherStateCreditOrReciprocity"); }
    if (input.wiHasAmendedOrOtherSpecialItems === true) { errors.push("Wisconsin amended returns and other material special items require separate review."); markError("wiHasAmendedOrOtherSpecialItems"); }
  }

  if (input.stateCode === "MI" && Number(input.taxYear) === 2025) {
    if (input.miFullYearResident === null || input.miFullYearResident === undefined) {
      errors.push("Michigan full-year residency confirmation is required."); markError("miFullYearResident");
    } else if (input.miFullYearResident !== true) {
      errors.push("Michigan part-year/nonresident returns require Schedule NR and cannot be estimated in this supported path."); markError("miFullYearResident");
    }
    if (input.filingStatus === "mfs") {
      if (!input.miMfsMichiganFilingChoice) {
        errors.push("Select whether the Michigan return will be separate or joint when the federal return is Married Filing Separately."); markError("miMfsMichiganFilingChoice");
      } else if (input.miMfsMichiganFilingChoice !== "separate") {
        errors.push("A Michigan joint return after separate federal returns requires both spouses' federal information and is held for review rather than guessed."); markError("miMfsMichiganFilingChoice");
      }
    }
    [
      ["miOtherAdditions", "Enter Michigan Schedule 1 other additions, including 0 when none apply."],
      ["miTaxableSocialSecurity", "Enter taxable Social Security included in federal AGI, including 0 when none applies."],
      ["miOtherSubtractions", "Enter Michigan Schedule 1 other subtractions, including 0 when none apply."],
      ["miSpecialExemptionCount", "Enter the Michigan special exemption count, including 0."],
      ["miQualifiedDisabledVeteranCount", "Enter the Michigan qualified disabled-veteran exemption count, including 0."],
      ["miStillbirthCount", "Enter the Michigan Certificate of Stillbirth exemption count, including 0."],
    ].forEach(([field, message]) => {
      if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); }
    });
    const peopleCount = (input.filingStatus === "mfj" ? 2 : 1) + Number(input.numberOfDependents || 0);
    if (Number(input.miSpecialExemptionCount || 0) > peopleCount) { errors.push("Michigan special exemptions cannot exceed the people represented on the return."); markError("miSpecialExemptionCount"); }
    if (Number(input.miQualifiedDisabledVeteranCount || 0) > peopleCount) { errors.push("Michigan disabled-veteran exemptions cannot exceed the people represented on the return."); markError("miQualifiedDisabledVeteranCount"); }
    if (input.canBeClaimedAsDependent === true && Number(input.numberOfDependents || 0) > 0) { errors.push("A Michigan filer who is claimed as another person's dependent also listing dependents requires dependency review."); markError("numberOfDependents"); }
    if (input.miClaimedFederalEIC === null || input.miClaimedFederalEIC === undefined) { errors.push("Select whether the federal Earned Income Tax Credit was claimed for the Michigan EITC."); markError("miClaimedFederalEIC"); }
    else if (input.miClaimedFederalEIC === true && Number(input.miFederalEICAmount || 0) <= 0) { errors.push("Enter the federal Earned Income Tax Credit amount."); markError("miFederalEICAmount"); }
    [
      ["miHasRetirementPensionOrSeniorDeduction", "Complete the Michigan Form 4884 / standard-or-senior deduction screening question."],
      ["miHasPA24DecouplingAdjustment", "Complete the Michigan 2025 PA 24 federal-decoupling adjustment screening question."],
      ["miHasOtherStateCreditOrAllocation", "Complete the Michigan other-state credit/allocation screening question."],
      ["miHasDetroitCityReturn", "Complete the Michigan city income-tax return screening question."],
      ["miHasUseTax", "Select whether Michigan use tax is due."],
      ["miHasSeparateRefundableCredits", "Complete the Michigan separate refundable-credit screening question."],
      ["miHasOtherSpecialItems", "Complete the Michigan special-items screening question."],
    ].forEach(([field, message]) => { if (input[field] === null || input[field] === undefined) { errors.push(message); markError(field); } });
    if (input.miHasRetirementPensionOrSeniorDeduction === true) { errors.push("Michigan Form 4884 retirement/pension and Michigan standard-or-senior deductions require birth-year, benefit-type, and worksheet details; this estimate is held rather than guessed."); markError("miHasRetirementPensionOrSeniorDeduction"); }
    if (input.miHasPA24DecouplingAdjustment === true) { errors.push("Michigan 2025 PA 24 federal-decoupling business adjustments require a separate Michigan recomputation and are held for review rather than guessed."); markError("miHasPA24DecouplingAdjustment"); }
    if (input.miHasOtherStateCreditOrAllocation === true) { errors.push("Michigan other-state credit/allocation requires separate limitation or apportionment review rather than a guessed estimate."); markError("miHasOtherStateCreditOrAllocation"); }
    if (input.miHasDetroitCityReturn === true) { errors.push("A Michigan city income-tax return is separate from the MI-1040 calculation. This estimate is being held so local income tax is not silently omitted."); markError("miHasDetroitCityReturn"); }
    if (input.miHasUseTax === true && Number(input.miUseTax || 0) <= 0) { errors.push("Enter the Michigan use-tax worksheet amount."); markError("miUseTax"); }
    if (input.miHasSeparateRefundableCredits === true) { errors.push("Michigan Homestead Property Tax, Home Heating, Farmland Preservation, or other separate refundable credits require additional details and are held for review."); markError("miHasSeparateRefundableCredits"); }
    if (input.miHasOtherSpecialItems === true) { errors.push("This Michigan return has a material special credit, penalty, contribution, amended item, or special schedule requiring review."); markError("miHasOtherSpecialItems"); }
  }

  if (input.stateCode === "WV" && Number(input.taxYear) === 2025) {
    if (input.wvFullYearResident === null || input.wvFullYearResident === undefined) {
      errors.push("West Virginia full-year residency confirmation is required.");
      markError("wvFullYearResident");
    } else if (input.wvFullYearResident !== true) {
      errors.push("West Virginia part-year/nonresident and special-nonresident returns require Schedule A review and cannot be estimated in this supported path.");
      markError("wvFullYearResident");
    }

    [
      ["wvTotalAdditions", "Enter West Virginia Schedule M total additions, including 0 when none apply."],
      ["wvOtherSubtractions", "Enter West Virginia Schedule M other subtractions, including 0 when none apply."],
      ["wvTaxableSocialSecurity", "Enter taxable Social Security included in federal AGI, including 0 when none applies."],
      ["wvTaxExemptInterestForFamilyCredit", "Enter tax-exempt interest for the West Virginia Family Tax Credit worksheet, including 0 when none applies."],
    ].forEach(([field, message]) => {
      if (input[field] === null || input[field] === undefined) {
        errors.push(message);
        markError(field);
      }
    });

    if (input.filingStatus === "mfj" && (input.wvSpouseCanBeClaimedAsDependent === null || input.wvSpouseCanBeClaimedAsDependent === undefined)) {
      errors.push("Select whether your spouse can be claimed as someone else's dependent for the West Virginia spouse exemption.");
      markError("wvSpouseCanBeClaimedAsDependent");
    }
    if (input.filingStatus === "qw" && (input.wvSurvivingSpouseExemption === null || input.wvSurvivingSpouseExemption === undefined)) {
      errors.push("Select whether the additional West Virginia surviving-spouse exemption applies.");
      markError("wvSurvivingSpouseExemption");
    }
    if (input.canBeClaimedAsDependent === true && Number(input.numberOfDependents || 0) > 0) {
      errors.push("A taxpayer who can be claimed as another person's dependent cannot claim West Virginia dependents in this return path.");
      markError("numberOfDependents");
    }
    if (input.wvFederalAMT === null || input.wvFederalAMT === undefined) {
      errors.push("Select whether federal alternative minimum tax applies for the West Virginia Family Tax Credit screen.");
      markError("wvFederalAMT");
    }
    if (input.wvHasChildDependentCareCredit === null || input.wvHasChildDependentCareCredit === undefined) {
      errors.push("Select whether a federal Form 2441 Child and Dependent Care Credit was claimed.");
      markError("wvHasChildDependentCareCredit");
    } else if (input.wvHasChildDependentCareCredit === true && Number(input.wvFederalChildDependentCareCredit || 0) <= 0) {
      errors.push("Enter the federal Form 2441 Child and Dependent Care Credit amount.");
      markError("wvFederalChildDependentCareCredit");
    }
    if (input.wvHasOtherStateTaxCredit === null || input.wvHasOtherStateTaxCredit === undefined) {
      errors.push("Complete the West Virginia credit-for-tax-paid-to-another-state screening question.");
      markError("wvHasOtherStateTaxCredit");
    } else if (input.wvHasOtherStateTaxCredit === true) {
      errors.push("West Virginia Schedule E other-state credit requires separate limitation review rather than a guessed estimate.");
      markError("wvHasOtherStateTaxCredit");
    }
    if (input.wvHasUseTax === null || input.wvHasUseTax === undefined) {
      errors.push("Select whether West Virginia purchaser's use tax is due.");
      markError("wvHasUseTax");
    } else if (input.wvHasUseTax === true && Number(input.wvUseTax || 0) <= 0) {
      errors.push("Enter the West Virginia Schedule UT use-tax amount.");
      markError("wvUseTax");
    }
    if (input.wvHasOtherSpecialItems === null || input.wvHasOtherSpecialItems === undefined) {
      errors.push("Complete the West Virginia special-items screening question.");
      markError("wvHasOtherSpecialItems");
    } else if (input.wvHasOtherSpecialItems === true) {
      errors.push("This West Virginia return has a material special credit/refundable property credit/penalty/donation/election that requires review rather than a guessed estimate.");
      markError("wvHasOtherSpecialItems");
    }
  }

  if (input.stateCode === "VA" && Number(input.taxYear) === 2025) {
    if (input.vaFullYearResident === null || input.vaFullYearResident === undefined) {
      errors.push("Virginia full-year residency confirmation is required.");
      markError("vaFullYearResident");
    } else if (input.vaFullYearResident !== true) {
      errors.push("Virginia part-year, nonresident, and mixed-residency returns require a separate review path.");
      markError("vaFullYearResident");
    }

    [
      ["vaTotalAdditions", "Enter Virginia Schedule ADJ Total Additions, including 0 when none apply."],
      ["vaAgeDeduction", "Enter the Virginia age deduction, including 0 when none applies."],
      ["vaTaxableSocialSecurityTier1", "Enter taxable Social Security/Tier 1 benefits for Virginia, including 0 when none apply."],
      ["vaStateIncomeTaxRefund", "Enter the state income-tax refund included in federal AGI, including 0 when none applies."],
      ["vaOtherSubtractions", "Enter Virginia Schedule ADJ Other Subtractions, including 0 when none apply."],
      ["vaOtherDeductions", "Enter Virginia Schedule ADJ Other Deductions, including 0 when none apply."]
    ].forEach(([field, message]) => {
      if (input[field] === null || input[field] === undefined) {
        errors.push(message);
        markError(field);
      }
    });

    if (input.vaFederalItemized === null || input.vaFederalItemized === undefined) {
      errors.push("Select whether you itemized deductions on the federal return for Virginia.");
      markError("vaFederalItemized");
    } else if (input.vaFederalItemized === true && (input.vaItemizedDeductions === null || input.vaItemizedDeductions === undefined)) {
      errors.push("Enter Virginia Schedule A itemized deductions.");
      markError("vaItemizedDeductions");
    } else if (
      input.vaFederalItemized === false &&
      input.canBeClaimedAsDependent === true &&
      (input.vaDependentEarnedIncome === null || input.vaDependentEarnedIncome === undefined)
    ) {
      errors.push("Enter earned income for the Virginia limited standard deduction.");
      markError("vaDependentEarnedIncome");
    }

    const maxVaExtraCount = input.filingStatus === "mfj" ? 2 : 1;
    if (input.vaAge65OrOlderCount === null || input.vaAge65OrOlderCount === undefined) {
      errors.push("Select the Virginia age-65-or-older exemption count.");
      markError("vaAge65OrOlderCount");
    } else if (Number(input.vaAge65OrOlderCount) > maxVaExtraCount) {
      errors.push("Virginia age-65-or-older exemption count exceeds the taxpayers on this return.");
      markError("vaAge65OrOlderCount");
    }
    if (input.vaBlindCount === null || input.vaBlindCount === undefined) {
      errors.push("Select the Virginia blind exemption count.");
      markError("vaBlindCount");
    } else if (Number(input.vaBlindCount) > maxVaExtraCount) {
      errors.push("Virginia blind exemption count exceeds the taxpayers on this return.");
      markError("vaBlindCount");
    }

    const maxVaAgeDeduction = input.filingStatus === "mfj" ? 24000 : 12000;
    if (Number(input.vaAgeDeduction || 0) > maxVaAgeDeduction) {
      errors.push(`Virginia age deduction cannot exceed $${maxVaAgeDeduction.toLocaleString("en-US")} for this filing status.`);
      markError("vaAgeDeduction");
    }

    if (input.filingStatus === "mfj") {
      if (input.vaSpouseTaxAdjustment === null || input.vaSpouseTaxAdjustment === undefined) {
        errors.push("Enter the Virginia Spouse Tax Adjustment worksheet amount, including 0 when it does not apply.");
        markError("vaSpouseTaxAdjustment");
      } else if (Number(input.vaSpouseTaxAdjustment) > 259) {
        errors.push("Virginia Spouse Tax Adjustment cannot exceed $259.");
        markError("vaSpouseTaxAdjustment");
      }
    } else if (Number(input.vaSpouseTaxAdjustment || 0) !== 0) {
      errors.push("Virginia Spouse Tax Adjustment is available only for Married Filing Jointly.");
      markError("vaSpouseTaxAdjustment");
    }

    if (!["none", "refundable_eitc", "nonrefundable_eitc", "low_income"].includes(input.vaIncomeBasedCreditType)) {
      errors.push("Select the Virginia low-income/EITC credit type.");
      markError("vaIncomeBasedCreditType");
    } else if (input.vaIncomeBasedCreditType !== "none" && Number(input.vaIncomeBasedCreditAmount || 0) <= 0) {
      errors.push("Enter the Virginia Schedule ADJ low-income/EITC credit amount.");
      markError("vaIncomeBasedCreditAmount");
    }

    if (input.vaIncomeBasedCreditType !== "none" && Number(input.vaAgeDeduction || 0) > 0) {
      errors.push("Virginia age deduction cannot be combined with the selected low-income/EITC credit.");
      markError("vaAgeDeduction");
      markError("vaIncomeBasedCreditType");
    }
    if (
      input.vaIncomeBasedCreditType === "low_income" &&
      (Number(input.vaAge65OrOlderCount || 0) > 0 || Number(input.vaBlindCount || 0) > 0)
    ) {
      errors.push("Virginia Credit for Low-Income Individuals cannot be combined with the age-65-or-older or blind exemptions.");
      markError("vaIncomeBasedCreditType");
    }

    if (input.vaHasOtherStateTaxCredit === null || input.vaHasOtherStateTaxCredit === undefined) {
      errors.push("Select whether a Virginia credit for tax paid to another state applies.");
      markError("vaHasOtherStateTaxCredit");
    } else if (input.vaHasOtherStateTaxCredit === true) {
      errors.push("Virginia Schedule OSC / other-state credit cases require manual multi-state review.");
      markError("vaHasOtherStateTaxCredit");
    }

    if (input.vaHasUseTax === null || input.vaHasUseTax === undefined) {
      errors.push("Select whether Virginia Consumer's Use Tax is due.");
      markError("vaHasUseTax");
    } else if (input.vaHasUseTax === true && Number(input.vaUseTax || 0) <= 0) {
      errors.push("Enter the Virginia Consumer's Use Tax worksheet amount.");
      markError("vaUseTax");
    }

    if (input.vaHasOtherSpecialItems === null || input.vaHasOtherSpecialItems === undefined) {
      errors.push("Complete the Virginia special-items screening question.");
      markError("vaHasOtherSpecialItems");
    } else if (input.vaHasOtherSpecialItems === true) {
      errors.push("This Virginia return has a material special credit/penalty/contribution/election that requires review rather than a guessed estimate.");
      markError("vaHasOtherSpecialItems");
    }
  }

  if (input.stateCode === "SC") {
    if (input.scFullYearResident === null || input.scFullYearResident === undefined) {
      errors.push("South Carolina full-year residency confirmation is required.");
      markError("scFullYearResident");
    } else if (input.scFullYearResident !== true) {
      errors.push("South Carolina part-year/nonresident returns require Schedule NR or residency-election review and cannot be estimated in this supported path.");
      markError("scFullYearResident");
    }
    if (input.scTotalAdditions === null || input.scTotalAdditions === undefined) {
      errors.push("Enter South Carolina SC1040 Total Additions, including 0 when none apply.");
      markError("scTotalAdditions");
    }
    if (input.scOtherSubtractions === null || input.scOtherSubtractions === undefined) {
      errors.push("Enter South Carolina Other Subtractions, including 0 when none apply.");
      markError("scOtherSubtractions");
    }
    if (input.numberOfDependents > 0 && (input.scDependentsUnder6 === null || input.scDependentsUnder6 === undefined)) {
      errors.push("Enter the number of South Carolina dependents under age 6, including 0 when none qualify.");
      markError("scDependentsUnder6");
    } else if (Number(input.scDependentsUnder6 || 0) > Number(input.numberOfDependents || 0)) {
      errors.push("South Carolina dependents under age 6 cannot exceed Number of Dependents.");
      markError("scDependentsUnder6");
    }
    if (input.scHasChildDependentCareCredit === null || input.scHasChildDependentCareCredit === undefined) {
      errors.push("Select whether the South Carolina Child and Dependent Care Credit applies.");
      markError("scHasChildDependentCareCredit");
    }
    if (input.scHasChildDependentCareCredit === true) {
      if (input.filingStatus === "mfs") {
        errors.push("South Carolina Child and Dependent Care Credit is not supported for Married Filing Separately in this path.");
        markError("scHasChildDependentCareCredit");
      }
      if (input.scFederalChildCareExpense === null || input.scFederalChildCareExpense === undefined) {
        errors.push("Enter the federal child/dependent-care expense for the South Carolina credit.");
        markError("scFederalChildCareExpense");
      }
      if (![1,2].includes(Number(input.scChildCareQualifyingPersons))) {
        errors.push("Select 1 or 2-or-more qualifying persons for the South Carolina child-care credit.");
        markError("scChildCareQualifyingPersons");
      }
    }
    if (input.filingStatus !== "mfj" && input.scHasTwoWageEarnerCredit === true) {
      errors.push("South Carolina Two Wage Earner Credit is available only for Married Filing Jointly.");
      markError("scHasTwoWageEarnerCredit");
    }
    if (input.filingStatus === "mfj") {
      if (input.scHasTwoWageEarnerCredit === null || input.scHasTwoWageEarnerCredit === undefined) {
        errors.push("Select whether both spouses have South Carolina qualified earned income for the Two Wage Earner Credit.");
        markError("scHasTwoWageEarnerCredit");
      } else if (input.scHasTwoWageEarnerCredit === true) {
        if (Number(input.scTaxpayerQualifiedEarnedIncome || 0) <= 0) {
          errors.push("Enter your positive South Carolina qualified earned income for the Two Wage Earner Credit.");
          markError("scTaxpayerQualifiedEarnedIncome");
        }
        if (Number(input.scSpouseQualifiedEarnedIncome || 0) <= 0) {
          errors.push("Enter your spouse's positive South Carolina qualified earned income for the Two Wage Earner Credit.");
          markError("scSpouseQualifiedEarnedIncome");
        }
      }
    }
    if (input.scClaimedFederalEIC === null || input.scClaimedFederalEIC === undefined) {
      errors.push("Select whether a federal Earned Income Tax Credit was claimed.");
      markError("scClaimedFederalEIC");
    } else if (input.scClaimedFederalEIC === true && (input.scFederalEICAmount === null || input.scFederalEICAmount === undefined)) {
      errors.push("Enter the federal EITC amount for the South Carolina 125% credit.");
      markError("scFederalEICAmount");
    }
    if (input.scHasOtherStateTaxCredit === null || input.scHasOtherStateTaxCredit === undefined) {
      errors.push("Select whether a South Carolina credit for taxes paid to another state applies.");
      markError("scHasOtherStateTaxCredit");
    } else if (input.scHasOtherStateTaxCredit === true) {
      errors.push("A South Carolina credit for taxes paid to another state requires manual multi-state review.");
      markError("scHasOtherStateTaxCredit");
    }
    if (input.scHasUseTax === null || input.scHasUseTax === undefined) {
      errors.push("Select whether South Carolina Use Tax is due.");
      markError("scHasUseTax");
    } else if (input.scHasUseTax === true && Number(input.scUseTax || 0) <= 0) {
      errors.push("Enter the South Carolina Use Tax Worksheet amount.");
      markError("scUseTax");
    }
    if (input.scHasOtherSpecialItems === null || input.scHasOtherSpecialItems === undefined) {
      errors.push("Complete the South Carolina special-items screening question.");
      markError("scHasOtherSpecialItems");
    } else if (input.scHasOtherSpecialItems === true) {
      errors.push("This South Carolina return has a material special credit/tax/payment/schedule that requires review rather than a guessed estimate.");
      markError("scHasOtherSpecialItems");
    }
  }

  if (input.stateCode === "OK") {
    if (
      input.okFullYearResident === null ||
      input.okFullYearResident === undefined
    ) {
      errors.push(
        "For Oklahoma, confirm whether this is a full-year resident 2025 return."
      );
      markError("okFullYearResident");
    }

    if (
      (input.filingStatus === "mfj" || input.filingStatus === "mfs") &&
      (
        input.okHasNonresidentSpouseAllocation === null ||
        input.okHasNonresidentSpouseAllocation === undefined
      )
    ) {
      errors.push(
        "For this married Oklahoma return, tell us whether a nonresident-spouse/Form 574 allocation applies."
      );
      markError("okHasNonresidentSpouseAllocation");
    }

    if (
      input.okHasOutOfStatePropertyBusinessIncome === null ||
      input.okHasOutOfStatePropertyBusinessIncome === undefined
    ) {
      errors.push(
        "For Oklahoma, tell us whether Form 511 line 4 includes out-of-state property or business income."
      );
      markError("okHasOutOfStatePropertyBusinessIncome");
    }

    if (input.okOklahomaAGI === null || input.okOklahomaAGI === undefined) {
      errors.push("Enter Oklahoma Form 511 Line 7 Adjusted Gross Income.");
      markError("okOklahomaAGI");
    }

    if (
      input.okOklahomaIncomeAfterAdjustments === null ||
      input.okOklahomaIncomeAfterAdjustments === undefined
    ) {
      errors.push("Enter Oklahoma Form 511 Line 9 Income After Adjustments.");
      markError("okOklahomaIncomeAfterAdjustments");
    }

    if (
      input.okOklahomaAGI !== null &&
      input.okOklahomaIncomeAfterAdjustments !== null &&
      Number(input.okOklahomaIncomeAfterAdjustments) > Number(input.okOklahomaAGI)
    ) {
      errors.push(
        "Oklahoma Line 9 income after adjustments cannot exceed Line 7 adjusted gross income in this supported path."
      );
      markError("okOklahomaIncomeAfterAdjustments");
    }

    if (
      input.okFederalItemized === null ||
      input.okFederalItemized === undefined
    ) {
      errors.push(
        "For Oklahoma, tell us whether you used federal itemized deductions."
      );
      markError("okFederalItemized");
    }

    if (
      input.okFederalItemized === true &&
      (input.okItemizedDeductions === null || input.okItemizedDeductions === undefined)
    ) {
      errors.push("Enter Oklahoma Schedule 511-D Line 11 itemized deductions.");
      markError("okItemizedDeductions");
    }

    if ([
      input.okRegularExemptions,
      input.okSpecial65Exemptions,
      input.okBlindExemptions,
      input.okQualifyingDependents,
    ].some((value) => value === null || value === undefined)) {
      errors.push(
        "For Oklahoma, enter each Form 511 exemption count, using 0 when a category does not apply."
      );
      [
        "okRegularExemptions",
        "okSpecial65Exemptions",
        "okBlindExemptions",
        "okQualifyingDependents",
      ].forEach(markError);
    }

    if (
      input.okHasFederalChildOrCareCredit === null ||
      input.okHasFederalChildOrCareCredit === undefined
    ) {
      errors.push(
        "For Oklahoma, tell us whether a federal child-care credit or child tax credit applies."
      );
      markError("okHasFederalChildOrCareCredit");
    }

    if (
      input.okHasFederalChildOrCareCredit === true &&
      Number(input.okFederalChildCareCredit || 0) <= 0 &&
      Number(input.okFederalChildTaxCreditTotal || 0) <= 0
    ) {
      errors.push(
        "Enter the federal child-care credit and/or total federal child tax credit used by Oklahoma Schedule 511-F."
      );
      markError("okFederalChildCareCredit");
      markError("okFederalChildTaxCreditTotal");
    }

    if (
      input.okHasOklahomaEIC === null ||
      input.okHasOklahomaEIC === undefined
    ) {
      errors.push(
        "For Oklahoma, tell us whether the Oklahoma earned income credit applies."
      );
      markError("okHasOklahomaEIC");
    }

    if (
      input.okHasOklahomaEIC === true &&
      Number(input.okFederalEIC2020Law || 0) <= 0
    ) {
      errors.push(
        "Enter the federal EIC calculated under Oklahoma Form 511-EIC's 2020-law method."
      );
      markError("okFederalEIC2020Law");
    }

    if (
      input.okHasOtherSpecialItems === null ||
      input.okHasOtherSpecialItems === undefined
    ) {
      errors.push(
        "For Oklahoma, tell us whether other state credits, additional taxes, or special payments apply."
      );
      markError("okHasOtherSpecialItems");
    }
  }

  if (input.stateCode === "AR") {
    if (
      input.arFullYearResident === null ||
      input.arFullYearResident === undefined
    ) {
      errors.push(
        "For Arkansas, confirm whether this is a full-year resident 2025 return."
      );
      markError("arFullYearResident");
    }

    if (
      input.arArkansasTotalIncome === null ||
      input.arArkansasTotalIncome === undefined
    ) {
      errors.push("Enter Arkansas AR1000F Line 23 Total Income.");
      markError("arArkansasTotalIncome");
    }

    if (
      input.arArkansasAGI === null ||
      input.arArkansasAGI === undefined
    ) {
      errors.push("Enter Arkansas AR1000F Line 25 Adjusted Gross Income.");
      markError("arArkansasAGI");
    }

    if (
      input.arArkansasTotalIncome !== null &&
      input.arArkansasAGI !== null &&
      Number(input.arArkansasAGI) > Number(input.arArkansasTotalIncome)
    ) {
      errors.push(
        "Arkansas Line 25 adjusted gross income cannot exceed Line 23 total income in this supported path."
      );
      markError("arArkansasAGI");
    }

    if (input.filingStatus === "mfs") {
      if (
        input.arMfsSameReturn === null ||
        input.arMfsSameReturn === undefined
      ) {
        errors.push(
          "For Arkansas MFS, tell us whether you are filing on the same Arkansas return or separate returns."
        );
        markError("arMfsSameReturn");
      } else if (
        input.arMfsSameReturn === false &&
        (
          input.arMfsSpouseItemizes === null ||
          input.arMfsSpouseItemizes === undefined
        )
      ) {
        errors.push(
          "For a separate Arkansas MFS return, tell us whether your spouse itemizes."
        );
        markError("arMfsSpouseItemizes");
      }
    }

    if (
      input.filingStatus === "qw" &&
      (
        input.arSurvivingSpouseConfirmed === null ||
        input.arSurvivingSpouseConfirmed === undefined
      )
    ) {
      errors.push(
        "For Arkansas Surviving Spouse, confirm the Arkansas eligibility requirements."
      );
      markError("arSurvivingSpouseConfirmed");
    }

    if (
      input.arHasOtherSpecialItems === null ||
      input.arHasOtherSpecialItems === undefined
    ) {
      errors.push(
        "For Arkansas, tell us whether other Arkansas credits, additional taxes, or special schedules apply."
      );
      markError("arHasOtherSpecialItems");
    }
  }

  if (input.stateCode === "LA") {
    if (
      input.laFullYearResident === null ||
      input.laFullYearResident === undefined
    ) {
      errors.push(
        "For Louisiana, confirm whether this is a full-year resident 2025 return."
      );
      markError("laFullYearResident");
    }

    if (
      input.laFederalReturnRequired === null ||
      input.laFederalReturnRequired === undefined
    ) {
      errors.push(
        "For Louisiana, tell us whether you were required to file a 2025 federal return."
      );
      markError("laFederalReturnRequired");
    }

    if (input.laFederalReturnRequired === true) {
      if (
        input.laUsesScheduleE === null ||
        input.laUsesScheduleE === undefined
      ) {
        errors.push(
          "For Louisiana, tell us whether Schedule E adjustments apply."
        );
        markError("laUsesScheduleE");
      }

      if (
        input.laUsesScheduleE === true &&
        (
          input.laScheduleEAdjustedGrossIncome === null ||
          input.laScheduleEAdjustedGrossIncome === undefined
        )
      ) {
        errors.push(
          "Enter Louisiana Schedule E, Line 5 adjusted gross income."
        );
        markError("laScheduleEAdjustedGrossIncome");
      }

      if (
        input.laFederalItemized === null ||
        input.laFederalItemized === undefined
      ) {
        errors.push(
          "For Louisiana, tell us whether you itemized deductions on your federal return."
        );
        markError("laFederalItemized");
      }

      if (
        input.laFederalItemized === true &&
        (
          input.laFederalMedicalDentalDeduction === null ||
          input.laFederalMedicalDentalDeduction === undefined
        )
      ) {
        errors.push(
          "Enter Federal Schedule A, Line 4 medical and dental deduction for Louisiana."
        );
        markError("laFederalMedicalDentalDeduction");
      }

      if (
        input.laClaimedFederalEIC === null ||
        input.laClaimedFederalEIC === undefined
      ) {
        errors.push(
          "For Louisiana, tell us whether you claimed the federal Earned Income Credit."
        );
        markError("laClaimedFederalEIC");
      }

      if (
        input.laClaimedFederalEIC === true &&
        (
          input.laFederalEICAmount === null ||
          input.laFederalEICAmount === undefined ||
          Number(input.laFederalEICAmount) <= 0
        )
      ) {
        errors.push(
          "Enter the 2025 federal Earned Income Credit amount for Louisiana."
        );
        markError("laFederalEICAmount");
      }
    }

    if (
      input.laHasOtherSpecialItems === null ||
      input.laHasOtherSpecialItems === undefined
    ) {
      errors.push(
        "For Louisiana, tell us whether other Louisiana credits, taxes, fees, or carryforwards apply."
      );
      markError("laHasOtherSpecialItems");
    }
  }

  if (input.stateCode === "MS") {
    if (
      input.msHasOtherStateModifications === null ||
      input.msHasOtherStateModifications === undefined
    ) {
      errors.push(
        "For Mississippi, tell us whether you have other Mississippi-specific income adjustments or credits."
      );
      markError("msHasOtherStateModifications");
    }

    if (
      input.filingStatus === "mfj" &&
      (
        input.msSpouseShareOfMississippiAGI === null ||
        input.msSpouseShareOfMississippiAGI === undefined
      )
    ) {
      errors.push(
        "For Mississippi Married Filing Jointly, enter the spouse's share of Mississippi adjusted gross income."
      );
      markError("msSpouseShareOfMississippiAGI");
    }

    if (
      input.filingStatus === "hoh" &&
      (
        input.msHeadOfFamilyDependentLivedAllYear === null ||
        input.msHeadOfFamilyDependentLivedAllYear === undefined
      )
    ) {
      errors.push(
        "For Mississippi Head of Family, confirm whether a qualifying dependent lived in your home for the entire year."
      );
      markError("msHeadOfFamilyDependentLivedAllYear");
    }
  }

  if (input.stateCode === "KY") {
    if (
      input.kyHasOtherStateModifications === null ||
      input.kyHasOtherStateModifications === undefined
    ) {
      errors.push(
        "For Kentucky, tell us whether you have other Kentucky-specific income additions or subtractions."
      );
      markError("kyHasOtherStateModifications");
    }

    if (
      input.kyHasChildDependentCareCredit === null ||
      input.kyHasChildDependentCareCredit === undefined
    ) {
      errors.push(
        "For Kentucky, tell us whether you expect to claim a federal Child and Dependent Care Credit."
      );
      markError("kyHasChildDependentCareCredit");
    }

    if ((input.kyItemizedDeductions || 0) < 0) {
      errors.push(
        "Kentucky itemized deductions cannot be negative."
      );
      markError("kyItemizedDeductions");
    }

    if ((input.kyTaxpayerRetirementIncome || 0) < 0) {
      errors.push(
        "Kentucky taxpayer retirement income cannot be negative."
      );
      markError("kyTaxpayerRetirementIncome");
    }

    if ((input.kySpouseRetirementIncome || 0) < 0) {
      errors.push(
        "Kentucky spouse retirement income cannot be negative."
      );
      markError("kySpouseRetirementIncome");
    }

    if (
      (
        (input.kyTaxpayerRetirementIncome || 0) > 31110 ||
        (input.kySpouseRetirementIncome || 0) > 31110
      ) &&
      (
        input.kySpecialPensionOverLimit === null ||
        input.kySpecialPensionOverLimit === undefined
      )
    ) {
      errors.push(
        "For Kentucky retirement income above $31,110, answer the government/Tier 2 Railroad Retirement question."
      );
      markError("kySpecialPensionOverLimit");
    }
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
      "For North Carolina Married Filing Separately, tell us whether your spouse itemizes deductions."
    );
    markError("ncSpouseItemizes");
  }

  if (
    input.stateCode === "AZ" &&
    (input.numberOfDependents || 0) > 0 &&
    (input.dependentsUnder17 === null ||
      input.dependentsUnder17 === undefined)
  ) {
    errors.push(
      "Arizona Dependents Under Age 17 is required when you are claiming dependents in Arizona."
    );
    markError("dependentsUnder17");
  }

  if (
    input.dependentsUnder17 !== null &&
    input.dependentsUnder17 !== undefined &&
    input.dependentsUnder17 > (input.numberOfDependents || 0)
  ) {
    errors.push(
      "Arizona Dependents Under Age 17 cannot exceed your total dependents."
    );
    markError("dependentsUnder17");
  }

  const splitMileageYear =
    Number(input.taxYear) === 2022 ||
    Number(input.taxYear) === 2026;

  if (
    splitMileageYear &&
    (input.businessMileage || 0) > 0
  ) {
    errors.push(
      "This tax year uses two IRS business mileage rates. Enter Jan.–June and July–December miles separately."
    );
    markError("businessMileage");
  }

  if (
    !splitMileageYear &&
    (
      (input.businessMileageJanJun || 0) > 0 ||
      (input.businessMileageJulDec || 0) > 0
    )
  ) {
    errors.push(
      "Split business mileage is only used for tax years with a midyear mileage-rate change."
    );
    markError("businessMileageJanJun");
    markError("businessMileageJulDec");
  }

  if (input.w2Income < 0) {
    errors.push("W-2 Wages must be $0 or more.");
    markError("w2Income");
  }

  if ((input.w2Income || 0) > 0) {
    [
      ["w2SocialSecurityWages", input.w2SocialSecurityWages, "W-2 Box 3 Social Security Wages"],
      ["w2MedicareWages", input.w2MedicareWages, "W-2 Box 5 Medicare Wages"],
      ["w2MedicareTaxWithheld", input.w2MedicareTaxWithheld, "W-2 Box 6 Medicare Tax Withheld"],
    ].forEach(([fieldId, value, label]) => {
      if (value === null || value === undefined) {
        errors.push(
          `${label} is required when W-2 wages are entered. Enter 0 if the W-2 shows 0.`
        );
        markError(fieldId);
      }
    });
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
    btn.innerHTML = btn.dataset.editMode === "true"
      ? "Calculate Updated Estimate"
      : "Calculate My Estimate";
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

    const editIdentity = getActiveFreeEstimateEditIdentity();

    if (editIdentity && !_taxWatchUpdateContext) {
      await submitLeadGateway(
        input,
        data.result,
        editIdentity
      );
      return;
    }

    _lastTaxInput = input;
    _lastEstimate = data.result;

    _leadGatewayUnlocked = false;
    _leadGatewayContact = null;
    _freeEstimateEditContext = null;
    refreshFreeEstimateEditBanner();
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
// SECURE SAVED-ESTIMATE RETURN
// =============================================================================

function showSavedEstimateReturn() {
  document
    .getElementById("savedEstimateReturnOverlay")
    ?.remove();

  const gatewayEmail =
    document.getElementById("gatewayEmail")
      ?.value || "";

  const overlay =
    document.createElement("div");

  overlay.id =
    "savedEstimateReturnOverlay";

  overlay.style.cssText = `
    position:fixed;
    inset:0;
    z-index:10050;
    background:rgba(15, 23, 42, 0.82);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:18px;
  `;

  overlay.innerHTML = `
    <div style="
      width:100%;
      max-width:540px;
      background:#ffffff;
      border-radius:22px;
      padding:28px;
      box-shadow:0 30px 80px rgba(0,0,0,0.38);
      border:3px solid #0f2c56;
    ">
      <div style="
        font-size:14px;
        font-weight:900;
        color:#2563eb;
        text-transform:uppercase;
        letter-spacing:1px;
        margin-bottom:10px;
      ">
        Returning Client
      </div>

      <h2 style="
        margin:0 0 12px;
        color:#0f2c56;
        font-size:29px;
        line-height:1.15;
      ">
        Return to a Saved Estimate
      </h2>

      <p style="
        margin:0 0 18px;
        color:#334155;
        font-size:16px;
        line-height:1.6;
      ">
        Enter the email address used for the saved estimate. We will send a six-digit code so you can reopen the latest saved entries without typing your name again.
      </p>

      <div
        id="savedEstimateReturnStatus"
        style="
          display:none;
          padding:12px;
          border-radius:12px;
          margin-bottom:14px;
          font-weight:800;
          line-height:1.45;
        "
      ></div>

      <div style="display:grid;gap:12px;">
        <div>
          <label style="
            display:block;
            font-weight:800;
            color:#0f172a;
            margin-bottom:6px;
          ">
            Email Address
          </label>
          <input
            id="savedEstimateReturnEmail"
            type="email"
            autocomplete="email"
            placeholder="you@email.com"
            value="${escHtml(gatewayEmail)}"
            style="
              width:100%;
              box-sizing:border-box;
              padding:14px;
              border-radius:12px;
              border:1px solid #cbd5e1;
              font-size:16px;
            "
          />
        </div>

        <button
          type="button"
          id="savedEstimateRequestCodeBtn"
          style="
            width:100%;
            background:#0f2c56;
            color:#fff;
            border:none;
            border-radius:14px;
            padding:15px;
            font-size:17px;
            font-weight:900;
            cursor:pointer;
          "
        >
          Send My Return Code
        </button>

        <div
          id="savedEstimateCodePanel"
          style="display:none;gap:12px;"
        >
          <div>
            <label style="
              display:block;
              font-weight:800;
              color:#0f172a;
              margin-bottom:6px;
            ">
              Six-Digit Return Code
            </label>
            <input
              id="savedEstimateReturnCode"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="000000"
              style="
                width:100%;
                box-sizing:border-box;
                padding:14px;
                border-radius:12px;
                border:1px solid #cbd5e1;
                font-size:20px;
                letter-spacing:5px;
                text-align:center;
                font-weight:900;
              "
            />
          </div>

          <button
            type="button"
            id="savedEstimateVerifyCodeBtn"
            style="
              width:100%;
              background:#15803d;
              color:#fff;
              border:none;
              border-radius:14px;
              padding:15px;
              font-size:17px;
              font-weight:900;
              cursor:pointer;
            "
          >
            Reopen My Saved Entries
          </button>
        </div>

        <button
          type="button"
          id="savedEstimateReturnCloseBtn"
          style="
            width:100%;
            background:#ffffff;
            color:#334155;
            border:1px solid #cbd5e1;
            border-radius:14px;
            padding:13px;
            font-size:15px;
            font-weight:800;
            cursor:pointer;
          "
        >
          Cancel
        </button>

        <div style="
          font-size:13px;
          color:#64748b;
          line-height:1.5;
          text-align:center;
        ">
          Opening saved entries does not use another free estimate. A new use is counted only after an updated estimate is recalculated and completed.
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const emailInput =
    document.getElementById(
      "savedEstimateReturnEmail"
    );

  const codeInput =
    document.getElementById(
      "savedEstimateReturnCode"
    );

  const requestBtn =
    document.getElementById(
      "savedEstimateRequestCodeBtn"
    );

  const verifyBtn =
    document.getElementById(
      "savedEstimateVerifyCodeBtn"
    );

  const codePanel =
    document.getElementById(
      "savedEstimateCodePanel"
    );

  const status =
    document.getElementById(
      "savedEstimateReturnStatus"
    );

  function showStatus(message, isError = false) {
    if (!status) return;

    status.textContent = message;
    status.style.display = "block";
    status.style.background =
      isError ? "#fee2e2" : "#dcfce7";
    status.style.border =
      isError
        ? "1px solid #ef4444"
        : "1px solid #22c55e";
    status.style.color =
      isError ? "#991b1b" : "#166534";
  }

  requestBtn?.addEventListener(
    "click",
    async () => {
      const email =
        String(emailInput?.value || "")
          .trim();

      if (
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        showStatus(
          "Enter the email address used for the saved estimate.",
          true
        );
        return;
      }

      requestBtn.disabled = true;
      requestBtn.textContent =
        "Sending Code...";
      requestBtn.style.opacity = "0.72";

      try {
        const response = await fetch(
          "/api/free-estimate-return/request",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              email
            })
          }
        );

        const data =
          await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(
            data.error ||
            "The return code could not be sent."
          );
        }

        showStatus(
          data.message ||
          "Check your email for the six-digit return code."
        );

        if (codePanel) {
          codePanel.style.display = "grid";
        }

        codeInput?.focus();
      } catch (error) {
        showStatus(
          error.message ||
          "The return code could not be sent.",
          true
        );
      } finally {
        requestBtn.disabled = false;
        requestBtn.textContent =
          "Send My Return Code";
        requestBtn.style.opacity = "";
      }
    }
  );

  verifyBtn?.addEventListener(
    "click",
    async () => {
      const email =
        String(emailInput?.value || "")
          .trim();

      const code =
        String(codeInput?.value || "")
          .replace(/\D/g, "")
          .slice(0, 6);

      if (code.length !== 6) {
        showStatus(
          "Enter the complete six-digit return code.",
          true
        );
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.textContent =
        "Reopening Saved Entries...";
      verifyBtn.style.opacity = "0.72";

      try {
        const response = await fetch(
          "/api/free-estimate-return/verify",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              email,
              code
            })
          }
        );

        const data =
          await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(
            data.error ||
            "The saved estimate could not be reopened."
          );
        }

        const saved =
          data.savedEstimate || {};

        if (
          !saved.taxData ||
          !saved.fullName ||
          !saved.email ||
          !saved.leadId
        ) {
          throw new Error(
            "The saved estimate entries are incomplete."
          );
        }

        _lastTaxInput =
          saved.taxData;
        _lastEstimate = null;
        _leadGatewayUnlocked = true;
        _leadGatewayContact = {
          fullName:
            String(saved.fullName).trim(),
          email:
            String(saved.email).trim(),
          leadId:
            String(saved.leadId).trim(),
          estimateFamilyId:
            String(
              saved.estimateFamilyId ||
              saved.leadId
            ).trim(),
          freeEstimateUsage:
            saved.freeEstimateUsage || null
        };

        _freeEstimateEditContext = {
          fullName:
            _leadGatewayContact.fullName,
          email:
            _leadGatewayContact.email,
          sourceLeadId:
            _leadGatewayContact.leadId,
          estimateFamilyId:
            _leadGatewayContact.estimateFamilyId,
          taxYear:
            String(
              saved.taxYear ||
              saved.taxData.taxYear ||
              ""
            ).trim(),
          startedAt:
            new Date().toISOString()
        };

        restoreEstimatorFormFromTaxData(
          saved.taxData
        );

        refreshFreeEstimateEditBanner();

        document
          .getElementById(
            "leadGatewayOverlay"
          )
          ?.remove();

        overlay.remove();

        goToScreen("form");

        window.scrollTo({
          top: 0,
          behavior: "auto"
        });
      } catch (error) {
        showStatus(
          error.message ||
          "The saved estimate could not be reopened.",
          true
        );
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent =
          "Reopen My Saved Entries";
        verifyBtn.style.opacity = "";
      }
    }
  );

  codeInput?.addEventListener(
    "input",
    () => {
      codeInput.value =
        codeInput.value
          .replace(/\D/g, "")
          .slice(0, 6);
    }
  );

  document
    .getElementById(
      "savedEstimateReturnCloseBtn"
    )
    ?.addEventListener(
      "click",
      () => overlay.remove()
    );

  emailInput?.focus();
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
        Save and View This Estimate
      </h2>

      <p style="margin:0 0 18px;color:#334155;font-size:16px;line-height:1.6;">
        Enter the full name and email for this estimate. Returning clients must use the same name spelling, or reopen the saved estimate with an emailed return code.
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
          Save &amp; View My Estimate
        </button>

        <button
          type="button"
          id="gatewayReturnSavedBtn"
          style="
            width:100%;
            background:#ffffff;
            color:#0f2c56;
            border:2px solid #0f2c56;
            border-radius:14px;
            padding:13px;
            font-size:15px;
            font-weight:900;
            cursor:pointer;
          "
        >
          Return to a Saved Estimate
        </button>

        <div style="font-size:13px;color:#64748b;line-height:1.5;text-align:center;">
          This saves your completed estimate and shows your results first. Secure Client Portal activation is optional and is offered after you review the estimate. Opening an earlier saved estimate uses a secure six-digit email code and does not count as another estimate.
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

  document
    .getElementById("gatewayReturnSavedBtn")
    ?.addEventListener(
      "click",
      showSavedEstimateReturn
    );
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

function getFreeEstimateMembershipContext() {
  const fullName = String(
    _leadGatewayContact?.fullName || ""
  ).trim();
  const email = String(
    _leadGatewayContact?.email || ""
  ).trim();
  const leadId = String(
    _leadGatewayContact?.estimateFamilyId ||
    _leadGatewayContact?.leadId ||
    ""
  ).trim();

  return {
    fullName,
    email,
    leadId,
    ready: Boolean(fullName && email && leadId)
  };
}

window.getFreeEstimateMembershipContext =
  getFreeEstimateMembershipContext;

function buildClaimSavedEstimateUrl(
  leadId,
  email
) {
  const reference = String(leadId || "").trim();
  const accountEmail = String(email || "").trim();

  if (!reference || !accountEmail) {
    return "/client-portal";
  }

  return (
    "/client-portal?activate=1&estimate=1&leadId=" +
    encodeURIComponent(reference) +
    "&email=" +
    encodeURIComponent(accountEmail)
  );
}

function renderFreeEstimateLimitReached(
  usage = {},
  context = {}
) {
  const overlay = document.getElementById("leadGatewayOverlay");
  const card = overlay?.firstElementChild;
  if (!card) return;

  const taxYear = String(
    usage.taxYear ||
    context.taxYear ||
    ""
  ).trim();
  const latestLeadId = String(
    usage.latestSavedLeadId || ""
  ).trim();
  const email = String(
    context.email || ""
  ).trim();
  const latestLink = latestLeadId
    ? `/estimate/${encodeURIComponent(latestLeadId)}`
    : "";
  const claimUrl = buildClaimSavedEstimateUrl(
    latestLeadId,
    email
  );

  card.innerHTML = `
    <div class="free-estimate-limit-kicker">Free Estimate Limit Reached</div>
    <h2 class="free-estimate-limit-title">
      Your free estimate${taxYear ? ` for tax year ${escHtml(taxYear)}` : ""} has already been used.
    </h2>
    <p class="free-estimate-limit-copy">
      Your saved results remain available. Corrections are allowed for
      ${escHtml(String(usage.correctionWindowHours || 48))} hours after the original estimate.
      After that, ongoing income, withholding, dependent, mileage, or business changes
      are handled through Tax Watch Pro.
    </p>
    <div class="free-estimate-limit-preview">
      <strong>One-time 14-day Tax Watch Pro preview.</strong>
      No automatic charge. Choose a plan only when you are ready.
    </div>
    <div class="free-estimate-limit-actions">
      <a class="free-estimate-limit-primary" href="${escHtml(claimUrl)}">
        Claim My Saved Estimate
      </a>
      ${latestLink ? `
        <a class="free-estimate-limit-secondary" href="${escHtml(latestLink)}" target="_blank" rel="noopener noreferrer">
          Open My Latest Saved Estimate
        </a>
      ` : ""}
      <button type="button" class="free-estimate-limit-secondary" id="closeFreeEstimateLimit">
        Return to My Estimate Entries
      </button>
      <a class="free-estimate-limit-secondary" href="/">
        Exit to Home Page
      </a>
    </div>
    <p class="free-estimate-limit-footnote">
      A full secure portal account is created only after you request the
      six-digit code and choose a password. Completing a free estimate
      alone does not create a password-protected portal.
    </p>
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
  const taxYear = String(
    usage.taxYear ||
    _lastTaxInput?.taxYear ||
    ""
  ).trim();
  const results = document.getElementById("screen-results");
  const disclaimer = results?.querySelector(".disclaimer-banner");

  if (!results || !disclaimer) return;

  const notice = document.createElement("div");
  notice.id = "freeEstimateUsageNotice";
  notice.className =
    "free-estimate-usage-notice" +
    (remaining === 0 ? " limit-used" : "");

  const correctionHours = Math.max(
    1,
    Number(usage.correctionWindowHours || 48)
  );

  const usageSummary = limit === 1 && used >= 1
    ? `
      <strong>Your free estimate${taxYear ? ` for tax year ${escHtml(taxYear)}` : ""} has been used.</strong>
      <span>
        Opening, printing, or refreshing this saved estimate is still free and does not use another estimate.
      </span>
      <span>
        ${
          usage.correctionWindowEligible
            ? `Your ${correctionHours}-hour correction window is still open. You may correct information in this same saved estimate without using another annual free estimate.`
            : `The ${correctionHours}-hour correction window has ended. Use Tax Watch Pro for ongoing changes during the year.`
        }
      </span>
    `
    : remaining > 0
      ? `
        <strong>${remaining} of ${limit} free estimates remaining${taxYear ? ` for tax year ${escHtml(taxYear)}` : ""}</strong>
        <span>
          Only successfully completed estimate families count. Opening, printing,
          or refreshing a saved estimate does not use another estimate.
        </span>
      `
      : `
        <strong>Your annual free-estimate allowance${taxYear ? ` for tax year ${escHtml(taxYear)}` : ""} has been used.</strong>
        <span>
          Your saved results remain available. Use Tax Watch Pro for ongoing changes,
          estimate comparisons, and year-round savings accountability.
        </span>
      `;

  notice.innerHTML = `
    ${usageSummary}
    <span style="margin-top:8px;">
      Your estimate is saved. Review your tax results first. A Secure Client Portal is optional
      unless you later choose a service that requires secure ongoing access.
    </span>
  `;

  disclaimer.insertAdjacentElement("afterend", notice);
}

async function submitLeadGateway(input, result, existingIdentity = null) {
  const identity = existingIdentity && typeof existingIdentity === "object"
    ? existingIdentity
    : null;
  const fullName = identity
    ? String(identity.fullName || "").trim()
    : (document.getElementById("gatewayFullName")?.value || "").trim();
  const email = identity
    ? String(identity.email || "").trim()
    : (document.getElementById("gatewayEmail")?.value || "").trim();
  const errorBox = document.getElementById("leadGatewayErrors");
  const btn = identity
    ? null
    : document.getElementById("gatewayUnlockBtn");

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
    btn.textContent = "Saving Estimate...";
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
        freeEstimateRevision: identity?.sourceLeadId
          ? {
              sourceLeadId: identity.sourceLeadId,
              estimateFamilyId:
                identity.estimateFamilyId ||
                identity.sourceLeadId,
              editStartedAt:
                _freeEstimateEditContext?.startedAt ||
                new Date().toISOString()
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
        if (!document.getElementById("leadGatewayOverlay")) {
          showLeadGateway(input, result);
        }

        renderFreeEstimateLimitReached(
          data.freeEstimateUsage || {},
          {
            email,
            taxYear: input?.taxYear || ""
          }
        );
        return false;
      }

      const serverErrors = Array.isArray(data.errors) && data.errors.length > 0
        ? data.errors
        : ["Could not unlock your estimate. Please try again."];
      throw new Error(serverErrors.join(" "));
    }

    _lastTaxInput = input;
    _lastEstimate = result;
    _leadGatewayUnlocked = true;
    _leadGatewayContact = {
      fullName,
      email,
      leadId: data.leadId || null,
      estimateFamilyId:
        data.estimateFamilyId ||
        identity?.estimateFamilyId ||
        data.leadId ||
        null,
      freeEstimateUsage: data.freeEstimateUsage || null,
    };
    _freeEstimateEditContext = null;
    refreshFreeEstimateEditBanner();

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

    return true;
  } catch (err) {
    const message = err.message || "Could not unlock your estimate. Please try again.";

    if (identity) {
      showErrors([message]);
    } else if (errorBox) {
      errorBox.textContent = message;
      errorBox.style.display = "block";
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save & View My Estimate";
      btn.style.opacity = "";
    }

    return false;
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

function sanitizeCurrencyInput(value) {
  let text = String(value ?? "")
    .replace(/[$,\s]/g, "")
    .replace(/[^\d.]/g, "");

  const firstDecimal = text.indexOf(".");
  if (firstDecimal >= 0) {
    text =
      text.slice(0, firstDecimal + 1) +
      text
        .slice(firstDecimal + 1)
        .replace(/\./g, "");
  }

  let [whole = "", cents = ""] = text.split(".");
  whole = whole.replace(/^0+(?=\d)/, "");
  cents = cents.slice(0, 2);

  if (firstDecimal >= 0) {
    return `${whole || "0"}.${cents}`;
  }

  return whole;
}

function currencyInputToCents(value) {
  const normalized = sanitizeCurrencyInput(value);
  if (!normalized) return 0;

  const [wholePart = "0", centsPart = ""] =
    normalized.split(".");
  const whole = Number.parseInt(
    wholePart || "0",
    10
  );
  const cents = Number.parseInt(
    `${centsPart}00`.slice(0, 2),
    10
  );

  if (
    !Number.isFinite(whole) ||
    !Number.isFinite(cents)
  ) {
    return 0;
  }

  return Math.max(
    0,
    (whole * 100) + cents
  );
}

function currencyNumberValue(value) {
  return currencyInputToCents(value) / 100;
}

function sanitizeSignedCurrencyInput(value) {
  const raw = String(value ?? "").trim();
  const negative = raw.startsWith("-");
  const normalized = sanitizeCurrencyInput(raw);
  if (!normalized) return negative ? "-" : "";
  return negative ? `-${normalized}` : normalized;
}

function signedCurrencyNumberValue(value) {
  const normalized = sanitizeSignedCurrencyInput(value);
  if (!normalized || normalized === "-") return 0;
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const cents = currencyInputToCents(unsigned);
  return (negative ? -cents : cents) / 100;
}

function formatSignedCurrencyInputDisplay(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return Math.round(signedCurrencyNumberValue(raw)).toLocaleString("en-US", {
    minimumFractionDigits:2,
    maximumFractionDigits:2
  });
}

function formatSignedCurrencyInputForEditing(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return signedCurrencyNumberValue(raw).toFixed(2);
}

function formatCurrencyInputDisplay(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  return Math.round(
    currencyNumberValue(raw)
  ).toLocaleString("en-US", {
    minimumFractionDigits:2,
    maximumFractionDigits:2
  });
}

function formatCurrencyInputForEditing(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  return currencyNumberValue(raw).toFixed(2);
}

function formatWholeNumberDisplay(value) {
  const digits = String(value || "")
    .replace(/\D/g, "");

  if (!digits) return "";

  return Number(digits).toLocaleString("en-US");
}

function attachCurrencyFormatting() {
  const currencyInputs = Array.from(
    document.querySelectorAll(
      ".dollar-input input"
    )
  );

  currencyInputs.forEach((input) => {
    if (
      input.dataset.currencyFormatAttached ===
      "true"
    ) {
      return;
    }

    input.dataset.currencyFormatAttached = "true";
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "decimal");
    input.setAttribute("autocomplete", "off");

    const allowNegative = input.dataset.allowNegative === "true";

    input.addEventListener("focus", (event) => {
      event.target.value = allowNegative
        ? formatSignedCurrencyInputForEditing(event.target.value)
        : formatCurrencyInputForEditing(event.target.value);

      event.target.select();
    });

    input.addEventListener("input", (event) => {
      const cursorWasAtEnd =
        event.target.selectionStart ===
        event.target.value.length;

      event.target.value = allowNegative
        ? sanitizeSignedCurrencyInput(event.target.value)
        : sanitizeCurrencyInput(event.target.value);

      if (cursorWasAtEnd) {
        event.target.selectionStart =
          event.target.value.length;
        event.target.selectionEnd =
          event.target.value.length;
      }
    });

    input.addEventListener("blur", (event) => {
      event.target.value = allowNegative
        ? formatSignedCurrencyInputDisplay(event.target.value)
        : formatCurrencyInputDisplay(event.target.value);
    });

    input.value = allowNegative
      ? formatSignedCurrencyInputDisplay(input.value)
      : formatCurrencyInputDisplay(input.value);
  });
}

function attachWholeNumberFormatting() {
  [
    "businessMileage",
    "businessMileageJanJun",
    "businessMileageJulDec"
  ].forEach((fieldId) => {
    const input = document.getElementById(fieldId);

    if (!input) return;

    if (
      input.dataset.wholeNumberFormatAttached ===
      "true"
    ) {
      return;
    }

    input.dataset.wholeNumberFormatAttached = "true";
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");

    input.addEventListener("input", (event) => {
      const cursorWasAtEnd =
        event.target.selectionStart ===
        event.target.value.length;

      event.target.value =
        formatWholeNumberDisplay(
          event.target.value
        );

      if (cursorWasAtEnd) {
        event.target.selectionStart =
          event.target.value.length;
        event.target.selectionEnd =
          event.target.value.length;
      }
    });

    input.addEventListener("blur", (event) => {
      event.target.value =
        formatWholeNumberDisplay(
          event.target.value
        );
    });

    input.value = formatWholeNumberDisplay(
      input.value
    );
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
  attachCurrencyFormatting();
  attachWholeNumberFormatting();
  attachAgeFormatting();

  const observer = new MutationObserver(() => {
    attachCurrencyFormatting();
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

  const clientReference = String(
    _leadGatewayContact?.estimateFamilyId ||
    leadId
  ).trim();

  const summaryUrl =
    `${window.location.origin}/estimate/${encodeURIComponent(leadId)}`;

  const activationUrl =
    buildClaimSavedEstimateUrl(
      clientReference,
      _leadGatewayContact?.email
    );

  const box = document.createElement("div");
  box.id = "clientSummaryLinkBox";
  box.className = "detailed-summary-ready-box";

  box.innerHTML = `
    <div class="detailed-summary-ready-copy">
      <div class="detailed-summary-ready-kicker">
        Step 1 &mdash; Review your saved estimate
      </div>
      <div class="detailed-summary-ready-title">
        Your Detailed Tax Estimate Summary Is Ready
      </div>
      <div class="detailed-summary-ready-text">
        Review the detailed tax summary first. It shows tax after credits,
        estimated credits applied, marginal and effective tax rates,
        withholding differences, working-child guidance, and the items that
        could change the estimate.
      </div>
      <div class="detailed-summary-ready-reference">
        Reference ID: ${escHtml(clientReference)}
      </div>
    </div>

    <div class="detailed-summary-ready-actions">
      <a
        href="${escHtml(summaryUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        class="detailed-summary-ready-button"
      >
        Review My Detailed Estimate
      </a>

      <div class="detailed-summary-portal-card">
        <strong style="display:block;margin-bottom:5px;">
          Step 2 &mdash; Secure Portal (Optional)
        </strong>
        <small style="display:block;line-height:1.4;margin-bottom:8px;color:#425b54;">
          Use the portal only if you want secure document access or an ongoing portal-based service.
        </small>
        <a
          href="${escHtml(activationUrl)}"
          style="
            display:block;
            box-sizing:border-box;
            width:100%;
            padding:10px 12px;
            border:2px solid #0f5f57;
            border-radius:9px;
            background:#ffffff;
            color:#0f5f57;
            font-weight:900;
            text-align:center;
            text-decoration:none;
          "
        >
          Activate Secure Client Portal
        </a>
        <small style="display:block;margin-top:6px;line-height:1.35;color:#52665f;">
          No subscription or payment required.
        </small>
      </div>
    </div>
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
  if (
    !element ||
    value === undefined ||
    value === null
  ) {
    return;
  }

  const previousValue = element.value;

  if (element.closest(".dollar-input")) {
    element.value = element.dataset.allowNegative === "true"
      ? formatSignedCurrencyInputDisplay(value)
      : formatCurrencyInputDisplay(value);
  } else if (
    id === "businessMileage" ||
    id === "businessMileageJanJun" ||
    id === "businessMileageJulDec"
  ) {
    element.value =
      formatWholeNumberDisplay(value);
  } else {
    element.value = String(value);
  }

  if (element.value !== previousValue) {
    element.dispatchEvent(
      new Event("change", { bubbles:true })
    );
  }
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

function restoreEstimatorFormFromTaxData(taxData = {}) {
  if (!taxData || typeof taxData !== "object") return;

  setEstimatorFieldValue("taxYear", taxData.taxYear);
  setEstimatorFieldValue("filingStatus", taxData.filingStatus);
  setEstimatorFieldValue("age", taxData.age);
  setEstimatorFieldValue("spouseAge", taxData.spouseAge);
  refreshSpouseAgeVisibility();
  setEstimatorRadioValue(
    "isFullTimeStudent",
    Boolean(taxData.isFullTimeStudent)
  );
  setEstimatorRadioValue(
    "canBeClaimedAsDependent",
    Boolean(taxData.canBeClaimedAsDependent)
  );
  setEstimatorFieldValue("stateCode", taxData.stateCode);
  setEstimatorFieldValue(
    "numberOfDependents",
    taxData.numberOfDependents
  );
  setEstimatorFieldValue(
    "ctcQualifyingChildren",
    taxData.ctcQualifyingChildren
  );
  setEstimatorFieldValue(
    "dependentsUnder17",
    taxData.dependentsUnder17
  );
  setEstimatorFieldValue(
    "alFullYearResident",
    taxData.alFullYearResident === true
      ? "yes"
      : taxData.alFullYearResident === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "alHeadOfFamilyConfirmed",
    taxData.alHeadOfFamilyConfirmed === true
      ? "yes"
      : taxData.alHeadOfFamilyConfirmed === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "alQualifyingDependents",
    taxData.alQualifyingDependents
  );
  setEstimatorFieldValue(
    "alItemizedDeductions",
    taxData.alItemizedDeductions
  );
  setEstimatorFieldValue(
    "alExemptIncome",
    taxData.alExemptIncome
  );
  setEstimatorFieldValue(
    "alFederalIncomeTaxDeduction",
    taxData.alFederalIncomeTaxDeduction
  );
  setEstimatorFieldValue(
    "alEstimatedTaxPayments",
    taxData.alEstimatedTaxPayments
  );
  setEstimatorFieldValue(
    "alHasSpecialItems",
    taxData.alHasSpecialItems === true
      ? "yes"
      : taxData.alHasSpecialItems === false
        ? "no"
        : ""
  );
  restoreIndianaStateFields(taxData);
  restoreIllinoisStateFields(taxData);
  restoreOhioStateFields(taxData);
  restorePennsylvaniaStateFields(taxData);
  restoreIowaStateFields(taxData);
  restoreColoradoStateFields(taxData);
  restoreUtahStateFields(taxData);
  restoreIdahoStateFields(taxData);
  restoreMontanaStateFields(taxData);
  restoreNorthDakotaStateFields(taxData);
  restoreNewMexicoStateFields(taxData);
  restoreCaliforniaStateFields(taxData);
  restoreOregonStateFields(taxData);
  restoreWashingtonStateFields(taxData);
  restoreHawaiiStateFields(taxData);
  restoreDelawareStateFields(taxData);
  restoreConnecticutStateFields(taxData);
  restoreMaineStateFields(taxData);
  restoreMarylandStateFields(taxData);
  restoreMassachusettsStateFields(taxData);
  restoreNewJerseyStateFields(taxData);
  restoreNewYorkStateFields(taxData);
  restoreRhodeIslandStateFields(taxData);
  restoreVermontStateFields(taxData);
  restoreDistrictOfColumbiaStateFields(taxData);
  restoreKansasStateFields(taxData);
  restoreNebraskaStateFields(taxData);
  restoreMinnesotaStateFields(taxData);
  restoreWisconsinStateFields(taxData);
  restoreMissouriStateFields(taxData);
  restoreMichiganStateFields(taxData);
  restoreWestVirginiaStateFields(taxData);
  restoreVirginiaStateFields(taxData);
  restoreSouthCarolinaStateFields(taxData);
  setEstimatorFieldValue(
    "okFullYearResident",
    taxData.okFullYearResident === true
      ? "yes"
      : taxData.okFullYearResident === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "okHasNonresidentSpouseAllocation",
    taxData.okHasNonresidentSpouseAllocation === true
      ? "yes"
      : taxData.okHasNonresidentSpouseAllocation === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "okHasOutOfStatePropertyBusinessIncome",
    taxData.okHasOutOfStatePropertyBusinessIncome === true
      ? "yes"
      : taxData.okHasOutOfStatePropertyBusinessIncome === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue("okOklahomaAGI", taxData.okOklahomaAGI);
  setEstimatorFieldValue(
    "okOklahomaIncomeAfterAdjustments",
    taxData.okOklahomaIncomeAfterAdjustments
  );
  setEstimatorFieldValue(
    "okFederalItemized",
    taxData.okFederalItemized === true
      ? "yes"
      : taxData.okFederalItemized === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue("okItemizedDeductions", taxData.okItemizedDeductions);
  setEstimatorFieldValue("okRegularExemptions", taxData.okRegularExemptions);
  setEstimatorFieldValue("okSpecial65Exemptions", taxData.okSpecial65Exemptions);
  setEstimatorFieldValue("okBlindExemptions", taxData.okBlindExemptions);
  setEstimatorFieldValue("okQualifyingDependents", taxData.okQualifyingDependents);
  setEstimatorFieldValue(
    "okHasFederalChildOrCareCredit",
    taxData.okHasFederalChildOrCareCredit === true
      ? "yes"
      : taxData.okHasFederalChildOrCareCredit === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue("okFederalChildCareCredit", taxData.okFederalChildCareCredit);
  setEstimatorFieldValue("okFederalChildTaxCreditTotal", taxData.okFederalChildTaxCreditTotal);
  setEstimatorFieldValue(
    "okHasOklahomaEIC",
    taxData.okHasOklahomaEIC === true
      ? "yes"
      : taxData.okHasOklahomaEIC === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue("okFederalEIC2020Law", taxData.okFederalEIC2020Law);
  setEstimatorFieldValue("okUseTax", taxData.okUseTax);
  setEstimatorFieldValue("okEstimatedTaxPayments", taxData.okEstimatedTaxPayments);
  setEstimatorFieldValue("okExtensionPayment", taxData.okExtensionPayment);
  setEstimatorFieldValue(
    "okHasOtherSpecialItems",
    taxData.okHasOtherSpecialItems === true
      ? "yes"
      : taxData.okHasOtherSpecialItems === false
        ? "no"
        : ""
  );
  refreshOklahomaStateVisibility();
  setEstimatorFieldValue(
    "arFullYearResident",
    taxData.arFullYearResident === true
      ? "yes"
      : taxData.arFullYearResident === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "arArkansasTotalIncome",
    taxData.arArkansasTotalIncome
  );
  setEstimatorFieldValue(
    "arArkansasAGI",
    taxData.arArkansasAGI
  );
  setEstimatorFieldValue(
    "arItemizedDeductions",
    taxData.arItemizedDeductions
  );
  setEstimatorFieldValue(
    "arQualifyingDependents",
    taxData.arQualifyingDependents
  );
  setEstimatorFieldValue(
    "arAdditionalPersonalCreditBoxes",
    taxData.arAdditionalPersonalCreditBoxes
  );
  setEstimatorFieldValue(
    "arMfsSameReturn",
    taxData.arMfsSameReturn === true
      ? "yes"
      : taxData.arMfsSameReturn === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "arMfsSpouseItemizes",
    taxData.arMfsSpouseItemizes === true
      ? "yes"
      : taxData.arMfsSpouseItemizes === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "arSurvivingSpouseConfirmed",
    taxData.arSurvivingSpouseConfirmed === true
      ? "yes"
      : taxData.arSurvivingSpouseConfirmed === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "arEstimatedTaxPayments",
    taxData.arEstimatedTaxPayments
  );
  setEstimatorFieldValue(
    "arExtensionPayment",
    taxData.arExtensionPayment
  );
  setEstimatorFieldValue(
    "arHasOtherSpecialItems",
    taxData.arHasOtherSpecialItems === true
      ? "yes"
      : taxData.arHasOtherSpecialItems === false
        ? "no"
        : ""
  );
  refreshArkansasStateVisibility();
  restoreIndianaStateFields(taxData);
  restoreIllinoisStateFields(taxData);
  restoreOhioStateFields(taxData);
  restorePennsylvaniaStateFields(taxData);
  restoreIowaStateFields(taxData);
  restoreKansasStateFields(taxData);
  restoreNebraskaStateFields(taxData);
  restoreMinnesotaStateFields(taxData);
  restoreWisconsinStateFields(taxData);
  restoreMissouriStateFields(taxData);
  restoreMichiganStateFields(taxData);
  restoreWestVirginiaStateFields(taxData);
  restoreVirginiaStateFields(taxData);
  restoreSouthCarolinaStateFields(taxData);
  setEstimatorFieldValue(
    "laFullYearResident",
    taxData.laFullYearResident === true
      ? "yes"
      : taxData.laFullYearResident === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laFederalReturnRequired",
    taxData.laFederalReturnRequired === true
      ? "yes"
      : taxData.laFederalReturnRequired === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laUsesScheduleE",
    taxData.laUsesScheduleE === true
      ? "yes"
      : taxData.laUsesScheduleE === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laScheduleEAdjustedGrossIncome",
    taxData.laScheduleEAdjustedGrossIncome
  );
  setEstimatorFieldValue(
    "laFederalItemized",
    taxData.laFederalItemized === true
      ? "yes"
      : taxData.laFederalItemized === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laFederalMedicalDentalDeduction",
    taxData.laFederalMedicalDentalDeduction
  );
  setEstimatorFieldValue(
    "laClaimedFederalEIC",
    taxData.laClaimedFederalEIC === true
      ? "yes"
      : taxData.laClaimedFederalEIC === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laFederalEICAmount",
    taxData.laFederalEICAmount
  );
  setEstimatorFieldValue(
    "laEstimatedTaxPayments",
    taxData.laEstimatedTaxPayments
  );
  setEstimatorFieldValue(
    "laExtensionPayment",
    taxData.laExtensionPayment
  );
  setEstimatorFieldValue(
    "laHasOtherSpecialItems",
    taxData.laHasOtherSpecialItems === true
      ? "yes"
      : taxData.laHasOtherSpecialItems === false
        ? "no"
        : ""
  );
  refreshLouisianaStateVisibility();
  setEstimatorFieldValue(
    "ncSpouseItemizes",
    taxData.ncSpouseItemizes === true
      ? "yes"
      : taxData.ncSpouseItemizes === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "gaUnbornDependents",
    taxData.gaUnbornDependents
  );
  setEstimatorFieldValue(
    "kyFamilySize",
    taxData.kyFamilySize
  );
  setEstimatorFieldValue(
    "kyItemizedDeductions",
    taxData.kyItemizedDeductions
  );
  setEstimatorFieldValue(
    "kyTaxpayerRetirementIncome",
    taxData.kyTaxpayerRetirementIncome
  );
  setEstimatorFieldValue(
    "kySpouseRetirementIncome",
    taxData.kySpouseRetirementIncome
  );
  setEstimatorFieldValue(
    "kySpecialPensionOverLimit",
    taxData.kySpecialPensionOverLimit === true
      ? "yes"
      : taxData.kySpecialPensionOverLimit === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "kyHasOtherStateModifications",
    taxData.kyHasOtherStateModifications === true
      ? "yes"
      : taxData.kyHasOtherStateModifications === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "kyHasChildDependentCareCredit",
    taxData.kyHasChildDependentCareCredit === true
      ? "yes"
      : taxData.kyHasChildDependentCareCredit === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "kyTaxpayerSpecialPersonalCredit",
    taxData.kyTaxpayerSpecialPersonalCredit
  );
  setEstimatorFieldValue(
    "kySpouseSpecialPersonalCredit",
    taxData.kySpouseSpecialPersonalCredit
  );
  setEstimatorFieldValue(
    "msItemizedDeductions",
    taxData.msItemizedDeductions
  );
  setEstimatorFieldValue(
    "msExemptRetirementIncome",
    taxData.msExemptRetirementIncome
  );
  setEstimatorFieldValue(
    "msTaxpayerBlind",
    taxData.msTaxpayerBlind === true ? "yes" : "no"
  );
  setEstimatorFieldValue(
    "msSpouseBlind",
    taxData.msSpouseBlind === true ? "yes" : "no"
  );
  setEstimatorFieldValue(
    "msSpouseShareOfMississippiAGI",
    taxData.msSpouseShareOfMississippiAGI
  );
  setEstimatorFieldValue(
    "msHeadOfFamilyDependentLivedAllYear",
    taxData.msHeadOfFamilyDependentLivedAllYear === true
      ? "yes"
      : taxData.msHeadOfFamilyDependentLivedAllYear === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "msHasDependentCareCredit",
    taxData.msHasDependentCareCredit === true ? "yes" : "no"
  );
  setEstimatorFieldValue(
    "msHasOtherStateModifications",
    taxData.msHasOtherStateModifications === true
      ? "yes"
      : taxData.msHasOtherStateModifications === false
        ? "no"
        : ""
  );
  refreshArizonaDependentAgeVisibility();
  refreshAlabamaStateVisibility();
  refreshMichiganStateVisibility();
  refreshWestVirginiaStateVisibility();
  refreshVirginiaStateVisibility();
  refreshSouthCarolinaStateVisibility();
  refreshOklahomaStateVisibility();
  refreshArkansasStateVisibility();
  refreshLouisianaStateVisibility();
  refreshMississippiStateVisibility();
  refreshKentuckyStateVisibility();
  refreshGeorgiaDependentVisibility();
  refreshNorthCarolinaMfsVisibility();
  setEstimatorFieldValue("w2Income", taxData.w2Income);
  setEstimatorFieldValue(
    "w2SocialSecurityWages",
    taxData.w2SocialSecurityWages
  );
  setEstimatorFieldValue(
    "w2MedicareWages",
    taxData.w2MedicareWages
  );
  setEstimatorFieldValue(
    "w2MedicareTaxWithheld",
    taxData.w2MedicareTaxWithheld
  );
  setEstimatorFieldValue("otherIncome", taxData.otherIncome);
  setEstimatorFieldValue("scholarships", taxData.scholarships);
  setEstimatorFieldValue(
    "educationExpenses",
    taxData.educationExpenses
  );
  setEstimatorFieldValue(
    "federalWithheld",
    taxData.federalWithheld
  );
  setEstimatorFieldValue(
    "stateWithheld",
    taxData.stateWithheld
  );
  refreshBusinessMileageVisibility();
  setEstimatorFieldValue(
    "businessMileage",
    taxData.businessMileage
  );
  setEstimatorFieldValue(
    "businessMileageJanJun",
    taxData.businessMileageJanJun
  );
  setEstimatorFieldValue(
    "businessMileageJulDec",
    taxData.businessMileageJulDec
  );
  setEstimatorFieldValue(
    "estimatedTaxPayments",
    taxData.estimatedTaxPayments
  );

  const children = Array.isArray(taxData.workingChildren)
    ? taxData.workingChildren
    : [];
  const hasWorkingChildren = Boolean(
    taxData.hasWorkingChildIncome &&
    children.length > 0
  );

  setEstimatorRadioValue(
    "hasWorkingChildIncome",
    hasWorkingChildren
  );

  const workingChildList =
    document.getElementById("workingChildList");
  if (workingChildList) {
    workingChildList.innerHTML = "";
  }
  _workingChildCounter = 0;
  setWorkingChildPanelVisible(hasWorkingChildren);

  if (hasWorkingChildren) {
    children.forEach((child, index) => {
      if (index > 0) addWorkingChildCard();
      const card = document.querySelectorAll(
        ".working-child-card"
      )[index];
      if (!card) return;

      const values = {
        ".wc-name": child.name,
        ".wc-relationship": child.relationship,
        ".wc-age": child.age,
        ".wc-student": child.student,
        ".wc-disabled": child.disabled,
        ".wc-residency": child.residency,
        ".wc-wages": child.wages,
        ".wc-gig-income": child.gigIncome,
        ".wc-unearned-income": child.unearnedIncome,
        ".wc-federal-withheld": child.federalWithheld,
        ".wc-state-withheld": child.stateWithheld,
        ".wc-support": child.support,
        ".wc-citizenship": child.citizenship,
        ".wc-joint-return": child.jointReturn,
        ".wc-other-claim": child.otherClaim
      };

      Object.entries(values).forEach(
        ([selector, value]) => {
          const field = card.querySelector(selector);
          if (field) {
            field.value = value === undefined || value === null
              ? ""
              : String(value);
          }
        }
      );
    });
  }

  updateWorkingChildCheckerVisibility();
  refreshWorkingChildInlineResults();

  const streams = Array.isArray(
    taxData.selfEmploymentStreams
  )
    ? taxData.selfEmploymentStreams
    : [];
  const expenseKeys = [
    "advertising", "contractLabor", "insurance",
    "legalProfessional", "officeExpense",
    "equipmentRent", "repairs", "supplies",
    "taxesLicenses", "travel", "meals",
    "utilities", "platformFees",
    "softwareSubscriptions", "phoneInternet",
    "other"
  ];

  for (
    let sourceNumber = 1;
    sourceNumber <= TAX_WATCH_PRO_SOURCE_LIMIT;
    sourceNumber += 1
  ) {
    const source = streams[sourceNumber - 1] || {};
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
      source.uncategorizedExpenses ?? 0
    );

    expenseKeys.forEach((key) => {
      setEstimatorFieldValue(
        `businessSource${sourceNumber}Expense_${key}`,
        source.expenseCategories?.[key] || 0
      );
    });
  }

  openPopulatedTaxWatchAdditionalSources();
  clearErrors();
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
  setEstimatorFieldValue("spouseAge", taxData.spouseAge);
  refreshSpouseAgeVisibility();
  setEstimatorRadioValue("isFullTimeStudent", Boolean(taxData.isFullTimeStudent));
  setEstimatorRadioValue("canBeClaimedAsDependent", Boolean(taxData.canBeClaimedAsDependent));
  setEstimatorFieldValue("stateCode", taxData.stateCode);
  setEstimatorFieldValue("numberOfDependents", taxData.numberOfDependents);
  setEstimatorFieldValue("ctcQualifyingChildren", taxData.ctcQualifyingChildren);
  setEstimatorFieldValue("dependentsUnder17", taxData.dependentsUnder17);
  setEstimatorFieldValue(
    "alFullYearResident",
    taxData.alFullYearResident === true
      ? "yes"
      : taxData.alFullYearResident === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "alHeadOfFamilyConfirmed",
    taxData.alHeadOfFamilyConfirmed === true
      ? "yes"
      : taxData.alHeadOfFamilyConfirmed === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "alQualifyingDependents",
    taxData.alQualifyingDependents
  );
  setEstimatorFieldValue(
    "alItemizedDeductions",
    taxData.alItemizedDeductions
  );
  setEstimatorFieldValue(
    "alExemptIncome",
    taxData.alExemptIncome
  );
  setEstimatorFieldValue(
    "alFederalIncomeTaxDeduction",
    taxData.alFederalIncomeTaxDeduction
  );
  setEstimatorFieldValue(
    "alEstimatedTaxPayments",
    taxData.alEstimatedTaxPayments
  );
  setEstimatorFieldValue(
    "alHasSpecialItems",
    taxData.alHasSpecialItems === true
      ? "yes"
      : taxData.alHasSpecialItems === false
        ? "no"
        : ""
  );
  restoreIndianaStateFields(taxData);
  restoreIllinoisStateFields(taxData);
  restoreOhioStateFields(taxData);
  restorePennsylvaniaStateFields(taxData);
  restoreIowaStateFields(taxData);
  restoreKansasStateFields(taxData);
  restoreNebraskaStateFields(taxData);
  restoreMinnesotaStateFields(taxData);
  restoreWisconsinStateFields(taxData);
  restoreMissouriStateFields(taxData);
  restoreMichiganStateFields(taxData);
  restoreWestVirginiaStateFields(taxData);
  restoreVirginiaStateFields(taxData);
  restoreSouthCarolinaStateFields(taxData);
  setEstimatorFieldValue(
    "laFullYearResident",
    taxData.laFullYearResident === true
      ? "yes"
      : taxData.laFullYearResident === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laFederalReturnRequired",
    taxData.laFederalReturnRequired === true
      ? "yes"
      : taxData.laFederalReturnRequired === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laUsesScheduleE",
    taxData.laUsesScheduleE === true
      ? "yes"
      : taxData.laUsesScheduleE === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laScheduleEAdjustedGrossIncome",
    taxData.laScheduleEAdjustedGrossIncome
  );
  setEstimatorFieldValue(
    "laFederalItemized",
    taxData.laFederalItemized === true
      ? "yes"
      : taxData.laFederalItemized === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laFederalMedicalDentalDeduction",
    taxData.laFederalMedicalDentalDeduction
  );
  setEstimatorFieldValue(
    "laClaimedFederalEIC",
    taxData.laClaimedFederalEIC === true
      ? "yes"
      : taxData.laClaimedFederalEIC === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "laFederalEICAmount",
    taxData.laFederalEICAmount
  );
  setEstimatorFieldValue(
    "laEstimatedTaxPayments",
    taxData.laEstimatedTaxPayments
  );
  setEstimatorFieldValue(
    "laExtensionPayment",
    taxData.laExtensionPayment
  );
  setEstimatorFieldValue(
    "laHasOtherSpecialItems",
    taxData.laHasOtherSpecialItems === true
      ? "yes"
      : taxData.laHasOtherSpecialItems === false
        ? "no"
        : ""
  );
  refreshLouisianaStateVisibility();
  setEstimatorFieldValue(
    "ncSpouseItemizes",
    taxData.ncSpouseItemizes === true
      ? "yes"
      : taxData.ncSpouseItemizes === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "gaUnbornDependents",
    taxData.gaUnbornDependents
  );
  setEstimatorFieldValue(
    "kyFamilySize",
    taxData.kyFamilySize
  );
  setEstimatorFieldValue(
    "kyItemizedDeductions",
    taxData.kyItemizedDeductions
  );
  setEstimatorFieldValue(
    "kyTaxpayerRetirementIncome",
    taxData.kyTaxpayerRetirementIncome
  );
  setEstimatorFieldValue(
    "kySpouseRetirementIncome",
    taxData.kySpouseRetirementIncome
  );
  setEstimatorFieldValue(
    "kySpecialPensionOverLimit",
    taxData.kySpecialPensionOverLimit === true
      ? "yes"
      : taxData.kySpecialPensionOverLimit === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "kyHasOtherStateModifications",
    taxData.kyHasOtherStateModifications === true
      ? "yes"
      : taxData.kyHasOtherStateModifications === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "kyHasChildDependentCareCredit",
    taxData.kyHasChildDependentCareCredit === true
      ? "yes"
      : taxData.kyHasChildDependentCareCredit === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "kyTaxpayerSpecialPersonalCredit",
    taxData.kyTaxpayerSpecialPersonalCredit
  );
  setEstimatorFieldValue(
    "kySpouseSpecialPersonalCredit",
    taxData.kySpouseSpecialPersonalCredit
  );
  setEstimatorFieldValue(
    "msItemizedDeductions",
    taxData.msItemizedDeductions
  );
  setEstimatorFieldValue(
    "msExemptRetirementIncome",
    taxData.msExemptRetirementIncome
  );
  setEstimatorFieldValue(
    "msTaxpayerBlind",
    taxData.msTaxpayerBlind === true ? "yes" : "no"
  );
  setEstimatorFieldValue(
    "msSpouseBlind",
    taxData.msSpouseBlind === true ? "yes" : "no"
  );
  setEstimatorFieldValue(
    "msSpouseShareOfMississippiAGI",
    taxData.msSpouseShareOfMississippiAGI
  );
  setEstimatorFieldValue(
    "msHeadOfFamilyDependentLivedAllYear",
    taxData.msHeadOfFamilyDependentLivedAllYear === true
      ? "yes"
      : taxData.msHeadOfFamilyDependentLivedAllYear === false
        ? "no"
        : ""
  );
  setEstimatorFieldValue(
    "msHasDependentCareCredit",
    taxData.msHasDependentCareCredit === true ? "yes" : "no"
  );
  setEstimatorFieldValue(
    "msHasOtherStateModifications",
    taxData.msHasOtherStateModifications === true
      ? "yes"
      : taxData.msHasOtherStateModifications === false
        ? "no"
        : ""
  );
  refreshArizonaDependentAgeVisibility();
  refreshAlabamaStateVisibility();
  refreshIndianaStateVisibility();
  refreshMissouriStateVisibility();
  refreshIllinoisStateVisibility();
  refreshOhioStateVisibility();
  refreshPennsylvaniaStateVisibility();
  refreshIowaStateVisibility();
  refreshColoradoStateVisibility();
  refreshUtahStateVisibility();
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
  refreshKansasStateVisibility();
  refreshNebraskaStateVisibility();
  refreshMinnesotaStateVisibility();
  refreshWisconsinStateVisibility();
  refreshMichiganStateVisibility();
  refreshVirginiaStateVisibility();
  refreshSouthCarolinaStateVisibility();
  refreshOklahomaStateVisibility();
  refreshLouisianaStateVisibility();
  refreshMississippiStateVisibility();
  refreshKentuckyStateVisibility();
  refreshGeorgiaDependentVisibility();
  refreshNorthCarolinaMfsVisibility();
  setEstimatorFieldValue("w2Income", taxData.w2Income);
  setEstimatorFieldValue("w2SocialSecurityWages", taxData.w2SocialSecurityWages);
  setEstimatorFieldValue("w2MedicareWages", taxData.w2MedicareWages);
  setEstimatorFieldValue("w2MedicareTaxWithheld", taxData.w2MedicareTaxWithheld);
  setEstimatorFieldValue("otherIncome", taxData.otherIncome);
  setEstimatorFieldValue("scholarships", taxData.scholarships);
  setEstimatorFieldValue("educationExpenses", taxData.educationExpenses);
  setEstimatorFieldValue("federalWithheld", taxData.federalWithheld);
  setEstimatorFieldValue("stateWithheld", taxData.stateWithheld);
  refreshBusinessMileageVisibility();
  setEstimatorFieldValue("businessMileage", taxData.businessMileage);
  setEstimatorFieldValue("businessMileageJanJun", taxData.businessMileageJanJun);
  setEstimatorFieldValue("businessMileageJulDec", taxData.businessMileageJulDec);
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

  document
    .getElementById("filingStatus")
    ?.addEventListener("change", () => {
      refreshSpouseAgeVisibility();
      refreshAlabamaStateVisibility();
      refreshIndianaStateVisibility();
      refreshMissouriStateVisibility();
      refreshIllinoisStateVisibility();
      refreshOhioStateVisibility();
      refreshPennsylvaniaStateVisibility();
      refreshIowaStateVisibility();
  refreshColoradoStateVisibility();
  refreshUtahStateVisibility();
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
  refreshKansasStateVisibility();
  refreshNebraskaStateVisibility();
      refreshMinnesotaStateVisibility();
      refreshWisconsinStateVisibility();
      refreshMichiganStateVisibility();
      refreshWestVirginiaStateVisibility();
      refreshVirginiaStateVisibility();
      refreshSouthCarolinaStateVisibility();
      refreshOklahomaStateVisibility();
      refreshArkansasStateVisibility();
      refreshLouisianaStateVisibility();
      refreshMississippiStateVisibility();
      refreshKentuckyStateVisibility();
      refreshNorthCarolinaMfsVisibility();
    });

  document
    .getElementById("stateCode")
    ?.addEventListener("change", () => {
      refreshArizonaDependentAgeVisibility();
      refreshAlabamaStateVisibility();
      refreshIndianaStateVisibility();
      refreshMissouriStateVisibility();
      refreshIllinoisStateVisibility();
      refreshOhioStateVisibility();
      refreshPennsylvaniaStateVisibility();
      refreshIowaStateVisibility();
  refreshColoradoStateVisibility();
  refreshUtahStateVisibility();
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
  refreshKansasStateVisibility();
  refreshNebraskaStateVisibility();
      refreshMinnesotaStateVisibility();
      refreshWisconsinStateVisibility();
      refreshMichiganStateVisibility();
      refreshWestVirginiaStateVisibility();
      refreshVirginiaStateVisibility();
      refreshSouthCarolinaStateVisibility();
      refreshOklahomaStateVisibility();
      refreshArkansasStateVisibility();
      refreshLouisianaStateVisibility();
      refreshMississippiStateVisibility();
      refreshKentuckyStateVisibility();
      refreshGeorgiaDependentVisibility();
      refreshNorthCarolinaMfsVisibility();
      refreshStateYearSupport();
    });

  [
    "inClaimedFederalEIC",
    "inHasUseTax",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", refreshIndianaStateVisibility);
  });

  [
    "moDeductionChoice",
    "moClaimedFederalEIC",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", refreshMissouriStateVisibility);
  });

  [
    "ilClaimedFederalEITC",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", refreshIllinoisStateVisibility);
  });

  document
    .getElementById("ohHasSchoolDistrictIncomeTax")
    ?.addEventListener("change", refreshOhioStateVisibility);

  [
    "paHasResidentCredit", "paClaimTaxForgiveness", "paHasChildDependentCareCredit",
    "paClaimedFederalEITC", "paHasLocalEarnedIncomeTax"
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", refreshPennsylvaniaStateVisibility);
  });

  document
    .querySelectorAll('input[name="canBeClaimedAsDependent"]')
    .forEach((radio) => radio.addEventListener("change", refreshPennsylvaniaStateVisibility));

  ["mnUseItemizedDeductions","mnHasM1NCFederalAdjustments","mnMfsSpouseItemizes","mnMfsSpouseNoGrossIncomeAndNotDependent","mnSpouseCanBeClaimedAsDependent"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", refreshMinnesotaStateVisibility);
  });
  document.querySelectorAll('input[name="canBeClaimedAsDependent"]').forEach((radio) => radio.addEventListener("change", refreshMinnesotaStateVisibility));

  document
    .getElementById("wiSpouseCanBeClaimedAsDependent")
    ?.addEventListener("change", refreshWisconsinStateVisibility);

  document
    .getElementById("wiClaimedFederalEIC")
    ?.addEventListener("change", refreshWisconsinStateVisibility);

  document
    .querySelectorAll('input[name="canBeClaimedAsDependent"]')
    .forEach((radio) => radio.addEventListener("change", refreshWisconsinStateVisibility));

  [
    "miClaimedFederalEIC",
    "miHasUseTax",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", refreshMichiganStateVisibility);
  });

  [
    "wvHasChildDependentCareCredit",
    "wvHasUseTax",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", refreshWestVirginiaStateVisibility);
  });

  [
    "vaFederalItemized",
    "vaIncomeBasedCreditType",
    "vaHasUseTax",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", refreshVirginiaStateVisibility);
  });

  document
    .querySelectorAll('input[name="canBeClaimedAsDependent"]')
    .forEach((radio) => radio.addEventListener("change", refreshMissouriStateVisibility));

  document
    .querySelectorAll('input[name="canBeClaimedAsDependent"]')
    .forEach((radio) => radio.addEventListener("change", refreshVirginiaStateVisibility));

  [
    "scHasChildDependentCareCredit",
    "scHasTwoWageEarnerCredit",
    "scClaimedFederalEIC",
    "scHasUseTax",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", refreshSouthCarolinaStateVisibility);
  });

  [
    "okFederalItemized",
    "okHasFederalChildOrCareCredit",
    "okHasOklahomaEIC",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", refreshOklahomaStateVisibility);
  });

  ["ksFederalChildDependentCareCredit", "ksOtherNonrefundableCredits", "ksFederalEITCAmount", "ksOtherRefundableCredits"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", refreshKansasStateVisibility);
    document.getElementById(id)?.addEventListener("change", refreshKansasStateVisibility);
  });

  ["neScheduleIIncreases", "neScheduleIDecreases"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", refreshNebraskaStateVisibility);
    document.getElementById(id)?.addEventListener("change", refreshNebraskaStateVisibility);
  });

  document
    .getElementById("arMfsSameReturn")
    ?.addEventListener("change", refreshArkansasStateVisibility);

  [
    "laFederalReturnRequired",
    "laUsesScheduleE",
    "laFederalItemized",
    "laClaimedFederalEIC",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", refreshLouisianaStateVisibility);
  });

  document
    .getElementById("numberOfDependents")
    ?.addEventListener("input", () => {
      refreshArizonaDependentAgeVisibility();
      refreshAlabamaStateVisibility();
      refreshIndianaStateVisibility();
      refreshMissouriStateVisibility();
      refreshIllinoisStateVisibility();
      refreshOhioStateVisibility();
      refreshPennsylvaniaStateVisibility();
      refreshIowaStateVisibility();
  refreshColoradoStateVisibility();
  refreshUtahStateVisibility();
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
  refreshKansasStateVisibility();
  refreshNebraskaStateVisibility();
      refreshMinnesotaStateVisibility();
      refreshWisconsinStateVisibility();
      refreshMichiganStateVisibility();
      refreshVirginiaStateVisibility();
      refreshSouthCarolinaStateVisibility();
    });

  document
    .getElementById("numberOfDependents")
    ?.addEventListener("change", () => {
      refreshArizonaDependentAgeVisibility();
      refreshAlabamaStateVisibility();
      refreshIndianaStateVisibility();
      refreshMissouriStateVisibility();
      refreshIllinoisStateVisibility();
      refreshOhioStateVisibility();
      refreshPennsylvaniaStateVisibility();
      refreshIowaStateVisibility();
  refreshColoradoStateVisibility();
  refreshUtahStateVisibility();
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
  refreshKansasStateVisibility();
  refreshNebraskaStateVisibility();
      refreshMinnesotaStateVisibility();
      refreshWisconsinStateVisibility();
      refreshMichiganStateVisibility();
      refreshVirginiaStateVisibility();
      refreshSouthCarolinaStateVisibility();
    });

  document.getElementById("mtFederalEITCAmount")?.addEventListener("input", refreshMontanaStateVisibility);
  document.getElementById("mtFederalEITCAmount")?.addEventListener("change", refreshMontanaStateVisibility);
  document.getElementById("ctHasFederalAMT")?.addEventListener("change", refreshConnecticutStateVisibility);
  document.getElementById("ctClaimedFederalEITC")?.addEventListener("change", refreshConnecticutStateVisibility);
  document.getElementById("maClaimedFederalEITC")?.addEventListener("change", refreshMassachusettsStateVisibility);
  document.getElementById("njClaimedFederalEITC")?.addEventListener("change", refreshNewJerseyStateVisibility);
  document.getElementById("njPropertyTaxBenefitEligible")?.addEventListener("change", refreshNewJerseyStateVisibility);
  document.getElementById("nyDeductionMethod")?.addEventListener("change", refreshNewYorkStateVisibility);
  document.getElementById("nyLocality")?.addEventListener("change", refreshNewYorkStateVisibility);
  document.getElementById("nyClaimedFederalEITC")?.addEventListener("change", refreshNewYorkStateVisibility);
  document.getElementById("riClaimedFederalEITC")?.addEventListener("change", refreshRhodeIslandStateVisibility);
  document.getElementById("vtClaimedFederalEITC")?.addEventListener("change", refreshVermontStateVisibility);
  document.getElementById("filingStatus")?.addEventListener("change", refreshVermontStateVisibility);
  document.getElementById("dcDeductionMethod")?.addEventListener("change", refreshDistrictOfColumbiaStateVisibility);
  document.getElementById("dcFullYearHealthCoverageOrExempt")?.addEventListener("change", refreshDistrictOfColumbiaStateVisibility);
  document.getElementById("dcClaimsEITC")?.addEventListener("change", refreshDistrictOfColumbiaStateVisibility);
  document.getElementById("dcEitcQualifyingChildCount")?.addEventListener("input", refreshDistrictOfColumbiaStateVisibility);
  document.getElementById("dcClaimsScheduleH")?.addEventListener("change", refreshDistrictOfColumbiaStateVisibility);
  document.getElementById("filingStatus")?.addEventListener("change", refreshDistrictOfColumbiaStateVisibility);
  document.getElementById("meFederalDeductionMethod")?.addEventListener("change", refreshMaineStateVisibility);
  document.getElementById("meClaimedFederalEITC")?.addEventListener("change", refreshMaineStateVisibility);
  document.getElementById("meSpouseCanBeClaimedAsDependent")?.addEventListener("change", refreshMaineStateVisibility);

  document
    .getElementById("taxYear")
    ?.addEventListener("change", () => {
      refreshBusinessMileageVisibility();
      refreshIndianaStateVisibility();
      refreshMissouriStateVisibility();
      refreshIllinoisStateVisibility();
      refreshOhioStateVisibility();
      refreshPennsylvaniaStateVisibility();
      refreshIowaStateVisibility();
  refreshColoradoStateVisibility();
  refreshUtahStateVisibility();
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
  refreshKansasStateVisibility();
  refreshNebraskaStateVisibility();
      refreshMinnesotaStateVisibility();
      refreshWisconsinStateVisibility();
      refreshMichiganStateVisibility();
      refreshWestVirginiaStateVisibility();
      refreshVirginiaStateVisibility();
      refreshStateYearSupport();
    });

  refreshSpouseAgeVisibility();
  refreshArizonaDependentAgeVisibility();
  refreshAlabamaStateVisibility();
  refreshIndianaStateVisibility();
  refreshMissouriStateVisibility();
  refreshIllinoisStateVisibility();
  refreshOhioStateVisibility();
  refreshPennsylvaniaStateVisibility();
  refreshIowaStateVisibility();
  refreshColoradoStateVisibility();
  refreshUtahStateVisibility();
  refreshIdahoStateVisibility();
  refreshMontanaStateVisibility();
  refreshNorthDakotaStateVisibility();
  refreshNewMexicoStateVisibility();
  refreshCaliforniaStateVisibility();
  refreshOregonStateVisibility();
  refreshWashingtonStateVisibility();
  refreshHawaiiStateVisibility();
  refreshDelawareStateVisibility();
  refreshConnecticutStateVisibility();
  refreshMaineStateVisibility();
  refreshMarylandStateVisibility();
  refreshMassachusettsStateVisibility();
  refreshNewJerseyStateVisibility();
  refreshNewYorkStateVisibility();
  refreshRhodeIslandStateVisibility();
  refreshVermontStateVisibility();
  refreshDistrictOfColumbiaStateVisibility();
  refreshKansasStateVisibility();
  refreshNebraskaStateVisibility();
  refreshMinnesotaStateVisibility();
  refreshWisconsinStateVisibility();
  refreshMichiganStateVisibility();
  refreshVirginiaStateVisibility();
  refreshSouthCarolinaStateVisibility();
  refreshOklahomaStateVisibility();
  refreshLouisianaStateVisibility();
  refreshMississippiStateVisibility();
  refreshKentuckyStateVisibility();
  refreshGeorgiaDependentVisibility();
  refreshNorthCarolinaMfsVisibility();
  refreshBusinessMileageVisibility();
  refreshStateYearSupport();

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


/* State-withholding integrity: keep Box 17 editable even for verified no-income-tax residence states. */
(function () {
  const verifiedNoTaxStates =
    new Set(["AK","FL","NV","SD","TN","TX","WY","NH"]);

  function applyNoTaxStateWithheldRule() {
    const stateEl =
      document.getElementById("stateCode");
    const withheldEl =
      document.getElementById("stateWithheld");

    if (!stateEl || !withheldEl) return;

    let note =
      document.getElementById(
        "noTaxStateWithheldNote"
      );

    if (!note) {
      note = document.createElement("div");
      note.id = "noTaxStateWithheldNote";
      note.style.cssText =
        "display:none;margin-top:8px;padding:10px 12px;border-radius:10px;background:#ecfeff;border:1px solid #38bdf8;color:#075985;font-weight:800;font-size:13px;line-height:1.45;";
      const wrapper =
        withheldEl.closest(".field-group") ||
        withheldEl.parentElement;

      if (wrapper) {
        wrapper.appendChild(note);
      }
    }

    const isVerifiedNoTaxState =
      verifiedNoTaxStates.has(
        String(stateEl.value || "").toUpperCase()
      );

    withheldEl.disabled = false;
    withheldEl.style.background = "";
    withheldEl.style.cursor = "";

    if (isVerifiedNoTaxState) {
      note.textContent =
        "This residence state has no individual state income tax. If Box 17 on your W-2 shows state withholding, enter it here so the estimator can flag a possible other-state or special filing issue.";
      note.style.display = "block";
    } else {
      note.style.display = "none";
    }
  }

  document.addEventListener(
    "change",
    function (event) {
      if (
        event.target &&
        event.target.id === "stateCode"
      ) {
        applyNoTaxStateWithheldRule();
      }
    }
  );

  document.addEventListener(
    "DOMContentLoaded",
    applyNoTaxStateWithheldRule
  );

  setTimeout(
    applyNoTaxStateWithheldRule,
    0
  );
})();






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
