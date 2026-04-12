module.exports = {
  year: 2025,
  filingYear: 2026,
  standardDeduction: {
    single: 15000,
    married: 30000,
    hoh: 22500,
  },
  taxBrackets: {
    single: [
      { rate: 0.10, min: 0, max: 11925 },
      { rate: 0.12, min: 11926, max: 48475 },
      { rate: 0.22, min: 48476, max: 103350 },
      { rate: 0.24, min: 103351, max: 197300 },
      { rate: 0.32, min: 197301, max: 250525 },
      { rate: 0.35, min: 250526, max: 626350 },
      { rate: 0.37, min: 626351, max: Infinity },
    ],
    married: [
      { rate: 0.10, min: 0, max: 23850 },
      { rate: 0.12, min: 23851, max: 96950 },
      { rate: 0.22, min: 96951, max: 206700 },
      { rate: 0.24, min: 206701, max: 394600 },
      { rate: 0.32, min: 394601, max: 501050 },
      { rate: 0.35, min: 501051, max: 751600 },
      { rate: 0.37, min: 751601, max: Infinity },
    ],
    hoh: [
      { rate: 0.10, min: 0, max: 17000 },
      { rate: 0.12, min: 17001, max: 64850 },
      { rate: 0.22, min: 64851, max: 103350 },
      { rate: 0.24, min: 103351, max: 197300 },
      { rate: 0.32, min: 197301, max: 250500 },
      { rate: 0.35, min: 250501, max: 626350 },
      { rate: 0.37, min: 626351, max: Infinity },
    ],
  },
  childTaxCredit: {
    maxPerChild: 2000,
    phaseoutStart: { single: 200000, married: 400000 },
  },
  earnedIncomeCredit: {
    single: {
      0: { max: 620, phaseoutStart: 9700, phaseoutEnd: 17200 },
      1: { max: 3950, phaseoutStart: 20500, phaseoutEnd: 44000 },
      2: { max: 6800, phaseoutStart: 20500, phaseoutEnd: 50000 },
      3: { max: 8100, phaseoutStart: 20500, phaseoutEnd: 54000 },
    },
    married: {
      0: { max: 620, phaseoutStart: 15500, phaseoutEnd: 25800 },
      1: { max: 3950, phaseoutStart: 25500, phaseoutEnd: 47500 },
      2: { max: 6800, phaseoutStart: 25500, phaseoutEnd: 54500 },
      3: { max: 8100, phaseoutStart: 25500, phaseoutEnd: 58500 },
    },
    hoh: {
      0: { max: 620, phaseoutStart: 9700, phaseoutEnd: 17200 },
      1: { max: 3950, phaseoutStart: 20500, phaseoutEnd: 44000 },
      2: { max: 6800, phaseoutStart: 20500, phaseoutEnd: 50000 },
      3: { max: 8100, phaseoutStart: 20500, phaseoutEnd: 54000 },
    },
  },
  seTaxThreshold: 137700,
};