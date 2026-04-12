module.exports = {
  year: 2024,
  filingYear: 2025,
  standardDeduction: {
    single: 14600,
    married: 29200,
    hoh: 21900,
  },
  taxBrackets: {
    single: [
      { rate: 0.10, min: 0, max: 11600 },
      { rate: 0.12, min: 11601, max: 47150 },
      { rate: 0.22, min: 47151, max: 100525 },
      { rate: 0.24, min: 100526, max: 191950 },
      { rate: 0.32, min: 191951, max: 243725 },
      { rate: 0.35, min: 243726, max: 609350 },
      { rate: 0.37, min: 609351, max: Infinity },
    ],
    married: [
      { rate: 0.10, min: 0, max: 23200 },
      { rate: 0.12, min: 23201, max: 94300 },
      { rate: 0.22, min: 94301, max: 201050 },
      { rate: 0.24, min: 201051, max: 383900 },
      { rate: 0.32, min: 383901, max: 487450 },
      { rate: 0.35, min: 487451, max: 731200 },
      { rate: 0.37, min: 731201, max: Infinity },
    ],
    hoh: [
      { rate: 0.10, min: 0, max: 16550 },
      { rate: 0.12, min: 16551, max: 63100 },
      { rate: 0.22, min: 63101, max: 100500 },
      { rate: 0.24, min: 100501, max: 191950 },
      { rate: 0.32, min: 191951, max: 243700 },
      { rate: 0.35, min: 243701, max: 609350 },
      { rate: 0.37, min: 609351, max: Infinity },
    ],
  },
  childTaxCredit: {
    maxPerChild: 2000,
    phaseoutStart: { single: 200000, married: 400000 },
  },
  earnedIncomeCredit: {
    single: {
      0: { max: 600, phaseoutStart: 9500, phaseoutEnd: 17000 },
      1: { max: 3800, phaseoutStart: 20000, phaseoutEnd: 43000 },
      2: { max: 6600, phaseoutStart: 20000, phaseoutEnd: 49000 },
      3: { max: 7830, phaseoutStart: 20000, phaseoutEnd: 53000 },
    },
    married: {
      0: { max: 600, phaseoutStart: 15000, phaseoutEnd: 25000 },
      1: { max: 3800, phaseoutStart: 25000, phaseoutEnd: 47000 },
      2: { max: 6600, phaseoutStart: 25000, phaseoutEnd: 54000 },
      3: { max: 7830, phaseoutStart: 25000, phaseoutEnd: 58000 },
    },
    hoh: {
      0: { max: 600, phaseoutStart: 9500, phaseoutEnd: 17000 },
      1: { max: 3800, phaseoutStart: 20000, phaseoutEnd: 43000 },
      2: { max: 6600, phaseoutStart: 20000, phaseoutEnd: 49000 },
      3: { max: 7830, phaseoutStart: 20000, phaseoutEnd: 53000 },
    },
  },
  seTaxThreshold: 132900,
};