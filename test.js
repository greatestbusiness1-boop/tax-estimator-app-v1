"use strict";

const { estimate } = require("./taxEstimator");

const result = estimate({
  taxYear: 2024,
  filingStatus: "single",
  age: 22,
  isFullTimeStudent: true,
  canBeClaimedAsDependent: false,
  stateCode: "AZ",
  numberOfDependents: 0,
  w2Income: 42000,
  otherIncome: 0,
  scholarships: 8000,
  educationExpenses: 6000,
  federalWithheld: 5100,
  stateWithheld: 2200,
});

console.log(JSON.stringify(result, null, 2));