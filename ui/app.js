"use strict";

// =============================================================================
// MODULE STATE
// =============================================================================

let _lastTaxInput = null;
let _lastEstimate = null;

// =============================================================================
// SCREEN NAVIGATION
// =============================================================================

const SCREENS = ["welcome", "form", "results"];

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

function openPaidReview() {
  window.open(PAID_REVIEW_URL, "_blank");
}

// =============================================================================
// TAX FORM — READ
// =============================================================================

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

  const selfEmploymentStreams = Array.from(
    document.querySelectorAll("#selfEmploymentStreams .stream-row")
  )
    .map((row) => ({
      source: row.querySelector(".stream-source")?.value?.trim() || "",
      income: parseFloat(row.querySelector(".stream-income")?.value || "0") || 0,
      expenses: parseFloat(row.querySelector(".stream-expenses")?.value || "0") || 0,
    }))
    .filter((stream) => stream.source || stream.income || stream.expenses);

  const fallbackSelfEmploymentIncome = numVal("selfEmploymentIncome");
  const fallbackBusinessExpenses = numVal("businessExpenses");

  const totalSelfEmploymentIncome = selfEmploymentStreams.length > 0
    ? selfEmploymentStreams.reduce((sum, s) => sum + s.income, 0)
    : fallbackSelfEmploymentIncome;

  const totalBusinessExpenses = selfEmploymentStreams.length > 0
    ? selfEmploymentStreams.reduce((sum, s) => sum + s.expenses, 0)
    : fallbackBusinessExpenses;

  return {
    taxYear: parseInt(getVal("taxYear"), 10) || 2024,
    filingStatus: getVal("filingStatus"),
    age: parseInt(getVal("age"), 10) || 0,
    isFullTimeStudent: getRadio("isFullTimeStudent") === "yes",
    canBeClaimedAsDependent: getRadio("canBeClaimedAsDependent") === "yes",
    stateCode: getVal("stateCode"),
    numberOfDependents: parseInt(getVal("numberOfDependents"), 10) || 0,
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
// TAX FORM — VALIDATE
// =============================================================================

function validateFormClient(input) {
  const errors = [];

  if (!input.filingStatus) {
    errors.push("Filing Status is required.");
    markError("filingStatus");
  }
  if (!input.age || input.age < 1 || input.age > 120) {
    errors.push("Age must be a number between 1 and 120.");
    markError("age");
  }
  if (!input.stateCode) {
    errors.push("State of Residence is required.");
    markError("stateCode");
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
    btn.innerHTML = btn.dataset.orig || "Get My Free Professional Review";
    btn.style.opacity = "";
  }
}

// =============================================================================
// CALCULATE — SUBMIT TO /api/estimate
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

    resetLeadForm();
    renderResults(data.result, input);
    goToScreen("results");
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
// LEAD FORM — SUBMIT TO /api/lead
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

  console.log("lead values", { name, email, phone });
  console.log("_lastTaxInput", _lastTaxInput);
  console.log("_lastEstimate", _lastEstimate);

  const errors = [];
  if (!name) errors.push("Full name is required.");
  if (!email) {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Please enter a valid email address.");
  }

  console.log("lead validation errors", errors);

  if (errors.length > 0) {
    showLeadErrors(errors);
    return;
  }

  clearLeadErrors();
  setLeadLoading(true);

  const estimateSummary = _lastEstimate
    ? {
        taxYear: _lastEstimate.meta?.taxYear,
        filingStatus: _lastEstimate.meta?.filingStatus,
        stateCode: _lastEstimate.meta?.stateCode,
        stateName: _lastEstimate.meta?.stateName,
        federal: {
          grossIncome: _lastEstimate.federal?.summary?.grossIncome,
          agi: _lastEstimate.federal?.summary?.agi,
          taxableIncome: _lastEstimate.federal?.summary?.taxableIncome,
          taxBeforeCredits: _lastEstimate.federal?.summary?.taxBeforeCredits,
          taxAfterCredits: _lastEstimate.federal?.summary?.taxAfterCredits,
          federalWithheld: _lastEstimate.federal?.summary?.federalWithheld,
          estimatedTaxPayments: _lastEstimate.federal?.summary?.estimatedTaxPayments,
          selfEmploymentIncome: _lastEstimate.federal?.summary?.selfEmploymentIncome,
          selfEmploymentTax: _lastEstimate.federal?.summary?.selfEmploymentTax,
          net: _lastEstimate.federal?.summary?.net,
          isRefund: _lastEstimate.federal?.summary?.isRefund,
          refundAmount: _lastEstimate.federal?.summary?.refundAmount,
          owedAmount: _lastEstimate.federal?.summary?.owedAmount,
          marginalRate: _lastEstimate.federal?.summary?.marginalRate,
          effectiveRate: _lastEstimate.federal?.summary?.effectiveRate,
        },
        state: {
          stateName: _lastEstimate.meta?.stateName,
          hasIncomeTax: _lastEstimate.state?.hasIncomeTax,
          canEstimate: _lastEstimate.state?.canEstimate,
          stateTaxableIncome: _lastEstimate.state?.summary?.stateTaxableIncome,
          stateTax: _lastEstimate.state?.summary?.stateTax,
          stateWithheld: _lastEstimate.state?.summary?.stateWithheld,
          net: _lastEstimate.state?.summary?.net,
          isRefund: _lastEstimate.state?.summary?.isRefund,
          refundAmount: _lastEstimate.state?.summary?.refundAmount,
          owedAmount: _lastEstimate.state?.summary?.owedAmount,
        },
        combined: _lastEstimate.combined,
      }
    : null;

  console.log("about to fetch /api/lead", { estimateSummary });

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
  if (n < 0) return `−${fmt(Math.abs(n))}`;
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
      body: `You’re currently estimated to get back ${fmt(combined.refundAmount)} between your federal and state returns. A professional follow-up can confirm whether additional deductions or credits may improve this result.`,
    };
  }

  if ((combined?.owedAmount || 0) > 0) {
    return {
      priority: "high",
      title: "What This Means For You",
      body: `You’re currently estimated to owe ${fmt(combined.owedAmount)} between your federal and state returns. A professional follow-up may help reduce what you owe and improve your tax planning.`,
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
    <div class="taxpro-banner taxpro-banner-${escHtml(reviewStatus.level)}">
      <div class="taxpro-banner-top">
        <div class="taxpro-banner-status">
          <span class="taxpro-status-dot"></span>
          <span class="taxpro-status-label">${escHtml(reviewStatus.label)}</span>
        </div>
        <div class="taxpro-banner-mini">
          Free instant estimate review • Professional follow-up available
        </div>
      </div>

      <div class="taxpro-banner-title">${escHtml(insight.title)}</div>
      <div class="taxpro-banner-body">${escHtml(insight.body)}</div>

      <div class="taxpro-banner-reason">
        ${escHtml(reviewStatus.reason)}
      </div>

      <div class="taxpro-banner-actions">
        <button type="button" id="taxProInsightCtaBtn" class="cta-urgent-btn">
          Request Tax Pro Follow-Up
        </button>

        <button type="button" id="paidReviewCtaBtn" class="btn-cta-secondary" style="margin-left:10px;">
          Unlock Paid Tax Review ($29)
        </button>

        <div class="cta-subtext">
          Start with a free follow-up or unlock a paid professional review
        </div>
      </div>
    </div>
  `;

  const freeBtn = document.getElementById("taxProInsightCtaBtn");
  if (freeBtn) freeBtn.addEventListener("click", scrollToLead);

  const paidBtn = document.getElementById("paidReviewCtaBtn");
  if (paidBtn) paidBtn.addEventListener("click", openPaidReview);
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

function renderResults(result, input) {
  const { meta, federal, state, combined, clientExperience } = result;
  const fed = federal.summary;
  const st = state.summary;
  const cx = clientExperience || {};

  renderTaxProInsightBanner(fed, combined);

  setText("resultYear", meta.taxYear);
  setText("actionBarYear", meta.taxYear);

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
      ? "Estimated combined refund — you may be getting money back"
      : combined.isOwed
        ? "Estimated combined balance due — you may owe this amount"
        : "You appear to be near break-even this year";
  }

  const conf = cx.confidence || {};
  const confScore = document.getElementById("confidenceScore");
  const confDesc = document.getElementById("confidenceDesc");
  if (confScore) {
    confScore.textContent = conf.label || "Estimate";
    confScore.className = "confidence-score" + (conf.score < 75 ? (conf.score < 55 ? " low" : " moderate") : "");
  }
  if (confDesc) confDesc.textContent = conf.description || "Based on the information provided.";

  const fedRows = [];
  fedRows.push({ label: "W-2 wages", val: fmt((fed.grossIncome || 0) - (fed.netSelfEmploymentIncome || 0)) });
  if (fed.hasSelfEmployment) {
    fedRows.push({ label: "— 1099 / self-employment income", val: fmt(fed.selfEmploymentIncome) });
    if ((fed.businessExpenses || 0) > 0) {
      fedRows.push({ label: "— Business expenses", val: `−${fmt(fed.businessExpenses)}` });
    }
    if ((fed.mileageDeduction || 0) > 0) {
      fedRows.push({ label: "— Mileage deduction", val: `−${fmt(fed.mileageDeduction)}` });
    }
    fedRows.push({ label: "— Net business income", val: fmt(fed.netSelfEmploymentIncome) });
    fedRows.push({ label: "Self-employment tax", val: fmt(fed.selfEmploymentTax) });
    if ((fed.seAboveLineDeduction || 0) > 0) {
      fedRows.push({ label: "SE tax deduction (50%)", val: `−${fmt(fed.seAboveLineDeduction)}` });
    }
  }
  fedRows.push({ label: "Adjusted gross income", val: fmt(fed.agi) });
  fedRows.push({ label: "Standard deduction", val: `−${fmt(fed.standardDeduction)}` });
  fedRows.push({ label: "Taxable income", val: fmt(fed.taxableIncome) });
  fedRows.push({ label: "Income tax", val: fmt(fed.taxBeforeCredits) });
  if ((fed.educationCredit || 0) > 0) fedRows.push({ label: "Education credit", val: `−${fmt(fed.educationCredit)}` });
  if ((fed.childTaxCredit || 0) > 0) fedRows.push({ label: "Child Tax Credit", val: `−${fmt(fed.childTaxCredit)}` });
  fedRows.push({ label: "Federal tax withheld", val: fmt(fed.federalWithheld) });
  if ((fed.estimatedTaxPayments || 0) > 0) fedRows.push({ label: "Estimated tax payments", val: fmt(fed.estimatedTaxPayments) });

  renderBreakdownRows("federalRows", fedRows);
  renderBreakdownTotal(
    "federalTotal",
    fed.isRefund ? "Federal refund" : fed.isOwed ? "Federal balance due" : "Federal break-even",
    fed.isRefund ? `+${fmt(fed.refundAmount)}` : fed.isOwed ? `−${fmt(fed.owedAmount)}` : "$0",
    fed.isRefund ? "refund" : fed.isOwed ? "owe" : "none"
  );

  const stateCardLabel = document.getElementById("stateCardLabel");
  if (stateCardLabel) stateCardLabel.textContent = meta.stateName || meta.stateCode;

  if (!state.hasIncomeTax) {
    renderBreakdownRows("stateRows", [
      { label: "State income tax", val: "$0" },
      { label: "No state tax", val: "✓" },
    ]);
    const sw = st.stateWithheld || 0;
    renderBreakdownTotal("stateTotal", "State result", sw > 0 ? `+${fmt(sw)}` : "$0", sw > 0 ? "refund" : "none");
  } else if (!state.canEstimate) {
    renderBreakdownRows("stateRows", [{ label: "State estimate", val: "Not available" }]);
    renderBreakdownTotal("stateTotal", "Cannot estimate", "—", "none");
  } else {
    renderBreakdownRows("stateRows", [
      { label: "State taxable income", val: fmt(st.stateTaxableIncome) },
      { label: "Estimated state tax", val: fmt(st.stateTax) },
      { label: "State withheld", val: fmt(st.stateWithheld) },
    ]);
    renderBreakdownTotal(
      "stateTotal",
      st.isRefund ? "State refund" : st.isOwed ? "State balance due" : "State break-even",
      st.isRefund ? `+${fmt(st.refundAmount)}` : st.isOwed ? `−${fmt(st.owedAmount)}` : "$0",
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
    combined.isRefund ? `+${fmt(combined.refundAmount)}` : combined.isOwed ? `−${fmt(combined.owedAmount)}` : "$0",
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
            <div class="change-impact ${escHtml(c.impact || "neutral")}">${c.impact === "positive" ? "+" : c.impact === "negative" ? "−" : "~"}</div>
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
  if (ctaTitle) ctaTitle.textContent = cta.primary || "Have a Tax Professional Review My Return";
  if (ctaCtx) ctaCtx.textContent = cta.context || "A professional review can help confirm your estimate and identify opportunities.";
}

// =============================================================================
// INIT
// =============================================================================

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPhoneFormatting);
} else {
  initPhoneFormatting();
}

document.addEventListener("DOMContentLoaded", () => {
  goToScreen("welcome");
});
