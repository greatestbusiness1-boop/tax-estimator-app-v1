"use strict";

const { prepareInput } = require("./schema/input.schema");
const { calculateFederal } = require("./engines/federalEngine");
const { calculateState } = require("./engines/stateEngine");
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

  const federal = calculateFederal(input);
  const state = calculateState(input, federal.summary.agi);

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