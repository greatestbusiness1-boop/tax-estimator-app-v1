/**
 * stateEngine.js
 * Greatest Business Solution LLC — Tax Estimator
 *
 * Calculates state tax liability from a normalized input object
 * and the federal AGI produced by federalEngine.js.
 *
 * Supports three state tax structures:
 *   "none"       — no state income tax (TX, FL, WA, NV, etc.)
 *   "flat"       — single rate applied to all taxable income (AZ, IL, etc.)
 *   "graduated"  — progressive brackets (CA, NY, VA, etc.)
 *
 * Usage:
 *   const { calculateState } = require('./engines/stateEngine');
 *   const result = calculateState(input, federalAGI);
 *   console.log(result.summary);
 *
 * Calculation order:
 *   1. loadStateConfig        look up state rules by stateCode + taxYear
 *   2. computeStateTaxableIncome   federalAGI - stateDeduction - exemptions
 *   3. computeStateTax        route to none / flat / graduated handler
 *   4. computeStateResult     compare stateTax to stateWithheld
 */

"use strict";

// =============================================================================
// CONFIG — STATE TAX RULES BY YEAR
//
// Add a new state by adding its entry under the correct tax year.
// Add a new year by duplicating the year block and updating values.
// No engine logic changes are needed for either operation.
//
// Structure per state:
//   name          {string}   Display name
//   type          {string}   "none" | "flat" | "graduated"
//   flatRate      {number}   Used when type === "flat"
//   brackets      {array}    Used when type === "graduated"
//   deduction     {object}   Standard deduction by filing status (0 if none)
//   exemption     {object}   Personal exemption amounts (0 if none)
//   dependentExemption {number} Per-dependent exemption (0 if none)
// =============================================================================

const STATE_RULES = {

  2024: {

    // ── No income tax states ──────────────────────────────────────────────────

    AK: { name: "Alaska",        type: "none" },
    FL: { name: "Florida",       type: "none" },
    NV: { name: "Nevada",        type: "none" },
    NH: { name: "New Hampshire", type: "none" },
    SD: { name: "South Dakota",  type: "none" },
    TN: { name: "Tennessee",     type: "none" },
    TX: { name: "Texas",         type: "none" },
    WA: { name: "Washington",    type: "none" },
    WY: { name: "Wyoming",       type: "none" },

    // ── Flat tax states ───────────────────────────────────────────────────────

    AZ: {
      name:     "Arizona",
      type:     "flat",
      flatRate: 0.025,
      deduction: { single: 14600, mfj: 29200, mfs: 14600, hoh: 21900, qw: 29200 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },

    CO: {
      name:     "Colorado",
      type:     "flat",
      flatRate: 0.044,
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },

    GA: {
      name:     "Georgia",
      type:     "flat",
      flatRate: 0.055,
      deduction: { single: 12000, mfj: 24000, mfs: 12000, hoh: 18000, qw: 24000 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 3000,
    },

    ID: {
      name:     "Idaho",
      type:     "flat",
      flatRate: 0.058,
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },

    IL: {
      name:     "Illinois",
      type:     "flat",
      flatRate: 0.0495,
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 2425, mfj: 4850, mfs: 2425, hoh: 2425, qw: 4850 },
      dependentExemption: 2425,
    },

    IN: {
      name:     "Indiana",
      type:     "flat",
      flatRate: 0.0305,
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 1000, mfj: 2000, mfs: 1000, hoh: 1500, qw: 2000 },
      dependentExemption: 1500,
    },

    KY: {
      name:     "Kentucky",
      type:     "flat",
      flatRate: 0.04,
      deduction: { single: 3160, mfj: 3160, mfs: 3160, hoh: 3160, qw: 3160 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },

    MA: {
      name:     "Massachusetts",
      type:     "flat",
      flatRate: 0.09,
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 4400, mfj: 8800, mfs: 4400, hoh: 6800, qw: 8800 },
      dependentExemption: 1000,
    },

    MI: {
      name:     "Michigan",
      type:     "flat",
      flatRate: 0.0425,
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 5600, mfj: 11200, mfs: 5600, hoh: 5600, qw: 11200 },
      dependentExemption: 5600,
    },

    MS: {
      name:     "Mississippi",
      type:     "flat",
      flatRate: 0.047,
      deduction: { single: 6000, mfj: 12000, mfs: 6000, hoh: 8000, qw: 12000 },
      exemption: { single: 6000, mfj: 12000, mfs: 6000, hoh: 9500, qw: 12000 },
      dependentExemption: 1500,
    },

    NC: {
      name:     "North Carolina",
      type:     "flat",
      flatRate: 0.045,
      deduction: { single: 12750, mfj: 25500, mfs: 12750, hoh: 19125, qw: 25500 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },

    PA: {
      name:     "Pennsylvania",
      type:     "flat",
      flatRate: 0.0307,
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },

    UT: {
      name:     "Utah",
      type:     "flat",
      flatRate: 0.0465,
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },

    // ── Graduated tax states ──────────────────────────────────────────────────

    AL: {
      name: "Alabama",
      type: "graduated",
      deduction: { single: 3000, mfj: 8500, mfs: 4250, hoh: 4700, qw: 8500 },
      exemption: { single: 1500, mfj: 3000, mfs: 1500, hoh: 3000, qw: 3000 },
      dependentExemption: 1000,
      brackets: {
        single: [
          { min: 0,     max: 500,   rate: 0.02 },
          { min: 500,   max: 3000,  rate: 0.04 },
          { min: 3000,  max: null,  rate: 0.05 },
        ],
        mfj: [
          { min: 0,     max: 1000,  rate: 0.02 },
          { min: 1000,  max: 6000,  rate: 0.04 },
          { min: 6000,  max: null,  rate: 0.05 },
        ],
        mfs: [
          { min: 0,     max: 500,   rate: 0.02 },
          { min: 500,   max: 3000,  rate: 0.04 },
          { min: 3000,  max: null,  rate: 0.05 },
        ],
        hoh: [
          { min: 0,     max: 1000,  rate: 0.02 },
          { min: 1000,  max: 6000,  rate: 0.04 },
          { min: 6000,  max: null,  rate: 0.05 },
        ],
        qw: [
          { min: 0,     max: 1000,  rate: 0.02 },
          { min: 1000,  max: 6000,  rate: 0.04 },
          { min: 6000,  max: null,  rate: 0.05 },
        ],
      },
    },

    AR: {
      name: "Arkansas",
      type: "graduated",
      deduction: { single: 2270, mfj: 4540, mfs: 2270, hoh: 2270, qw: 4540 },
      exemption: { single: 29, mfj: 58, mfs: 29, hoh: 29, qw: 58 },
      dependentExemption: 29,
      brackets: {
        single: [
          { min: 0,     max: 4300,  rate: 0.02  },
          { min: 4300,  max: 8500,  rate: 0.04  },
          { min: 8500,  max: null,  rate: 0.047 },
        ],
        mfj: [
          { min: 0,     max: 4300,  rate: 0.02  },
          { min: 4300,  max: 8500,  rate: 0.04  },
          { min: 8500,  max: null,  rate: 0.047 },
        ],
        mfs: [
          { min: 0,     max: 4300,  rate: 0.02  },
          { min: 4300,  max: 8500,  rate: 0.04  },
          { min: 8500,  max: null,  rate: 0.047 },
        ],
        hoh: [
          { min: 0,     max: 4300,  rate: 0.02  },
          { min: 4300,  max: 8500,  rate: 0.04  },
          { min: 8500,  max: null,  rate: 0.047 },
        ],
        qw: [
          { min: 0,     max: 4300,  rate: 0.02  },
          { min: 4300,  max: 8500,  rate: 0.04  },
          { min: 8500,  max: null,  rate: 0.047 },
        ],
      },
    },

    CA: {
      name: "California",
      type: "graduated",
      deduction: { single: 5202, mfj: 10404, mfs: 5202, hoh: 10404, qw: 10404 },
      exemption: { single: 144, mfj: 288, mfs: 144, hoh: 288, qw: 288 },
      dependentExemption: 433,
      brackets: {
        single: [
          { min: 0,       max: 10412,  rate: 0.01  },
          { min: 10412,   max: 24684,  rate: 0.02  },
          { min: 24684,   max: 38959,  rate: 0.04  },
          { min: 38959,   max: 54081,  rate: 0.06  },
          { min: 54081,   max: 68350,  rate: 0.08  },
          { min: 68350,   max: 349137, rate: 0.093 },
          { min: 349137,  max: 418961, rate: 0.103 },
          { min: 418961,  max: 698274, rate: 0.113 },
          { min: 698274,  max: null,   rate: 0.123 },
        ],
        mfj: [
          { min: 0,       max: 20824,  rate: 0.01  },
          { min: 20824,   max: 49368,  rate: 0.02  },
          { min: 49368,   max: 77918,  rate: 0.04  },
          { min: 77918,   max: 108162, rate: 0.06  },
          { min: 108162,  max: 136700, rate: 0.08  },
          { min: 136700,  max: 698274, rate: 0.093 },
          { min: 698274,  max: 837922, rate: 0.103 },
          { min: 837922,  max: null,   rate: 0.113 },
        ],
        mfs: [
          { min: 0,       max: 10412,  rate: 0.01  },
          { min: 10412,   max: 24684,  rate: 0.02  },
          { min: 24684,   max: 38959,  rate: 0.04  },
          { min: 38959,   max: 54081,  rate: 0.06  },
          { min: 54081,   max: 68350,  rate: 0.08  },
          { min: 68350,   max: 349137, rate: 0.093 },
          { min: 349137,  max: 418961, rate: 0.103 },
          { min: 418961,  max: 698274, rate: 0.113 },
          { min: 698274,  max: null,   rate: 0.123 },
        ],
        hoh: [
          { min: 0,       max: 20839,  rate: 0.01  },
          { min: 20839,   max: 49371,  rate: 0.02  },
          { min: 49371,   max: 63644,  rate: 0.04  },
          { min: 63644,   max: 78765,  rate: 0.06  },
          { min: 78765,   max: 93037,  rate: 0.08  },
          { min: 93037,   max: 474824, rate: 0.093 },
          { min: 474824,  max: 569790, rate: 0.103 },
          { min: 569790,  max: 949649, rate: 0.113 },
          { min: 949649,  max: null,   rate: 0.123 },
        ],
        qw: [
          { min: 0,       max: 20824,  rate: 0.01  },
          { min: 20824,   max: 49368,  rate: 0.02  },
          { min: 49368,   max: 77918,  rate: 0.04  },
          { min: 77918,   max: 108162, rate: 0.06  },
          { min: 108162,  max: 136700, rate: 0.08  },
          { min: 136700,  max: 698274, rate: 0.093 },
          { min: 698274,  max: 837922, rate: 0.103 },
          { min: 837922,  max: null,   rate: 0.113 },
        ],
      },
    },

    CT: {
      name: "Connecticut",
      type: "graduated",
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 15000, mfj: 24000, mfs: 12000, hoh: 19000, qw: 24000 },
      dependentExemption: 0,
      brackets: {
        single: [
          { min: 0,      max: 10000,  rate: 0.03  },
          { min: 10000,  max: 50000,  rate: 0.05  },
          { min: 50000,  max: 100000, rate: 0.055 },
          { min: 100000, max: 200000, rate: 0.06  },
          { min: 200000, max: 250000, rate: 0.065 },
          { min: 250000, max: 500000, rate: 0.069 },
          { min: 500000, max: null,   rate: 0.0699},
        ],
        mfj: [
          { min: 0,      max: 20000,  rate: 0.03  },
          { min: 20000,  max: 100000, rate: 0.05  },
          { min: 100000, max: 200000, rate: 0.055 },
          { min: 200000, max: 400000, rate: 0.06  },
          { min: 400000, max: 500000, rate: 0.065 },
          { min: 500000, max: 1000000,rate: 0.069 },
          { min: 1000000,max: null,   rate: 0.0699},
        ],
        mfs: [
          { min: 0,      max: 10000,  rate: 0.03  },
          { min: 10000,  max: 50000,  rate: 0.05  },
          { min: 50000,  max: 100000, rate: 0.055 },
          { min: 100000, max: 200000, rate: 0.06  },
          { min: 200000, max: 250000, rate: 0.065 },
          { min: 250000, max: 500000, rate: 0.069 },
          { min: 500000, max: null,   rate: 0.0699},
        ],
        hoh: [
          { min: 0,      max: 16000,  rate: 0.03  },
          { min: 16000,  max: 80000,  rate: 0.05  },
          { min: 80000,  max: 160000, rate: 0.055 },
          { min: 160000, max: 320000, rate: 0.06  },
          { min: 320000, max: 400000, rate: 0.065 },
          { min: 400000, max: 800000, rate: 0.069 },
          { min: 800000, max: null,   rate: 0.0699},
        ],
        qw: [
          { min: 0,      max: 20000,  rate: 0.03  },
          { min: 20000,  max: 100000, rate: 0.05  },
          { min: 100000, max: 200000, rate: 0.055 },
          { min: 200000, max: 400000, rate: 0.06  },
          { min: 400000, max: 500000, rate: 0.065 },
          { min: 500000, max: 1000000,rate: 0.069 },
          { min: 1000000,max: null,   rate: 0.0699},
        ],
      },
    },

    HI: {
      name: "Hawaii",
      type: "graduated",
      deduction: { single: 2200, mfj: 4400, mfs: 2200, hoh: 3212, qw: 4400 },
      exemption: { single: 1144, mfj: 2288, mfs: 1144, hoh: 2288, qw: 2288 },
      dependentExemption: 1144,
      brackets: {
        single: [
          { min: 0,      max: 2400,  rate: 0.014 },
          { min: 2400,   max: 4800,  rate: 0.032 },
          { min: 4800,   max: 9600,  rate: 0.055 },
          { min: 9600,   max: 14400, rate: 0.064 },
          { min: 14400,  max: 19200, rate: 0.068 },
          { min: 19200,  max: 24000, rate: 0.072 },
          { min: 24000,  max: 36000, rate: 0.076 },
          { min: 36000,  max: 48000, rate: 0.079 },
          { min: 48000,  max: 150000,rate: 0.0825},
          { min: 150000, max: 175000,rate: 0.09  },
          { min: 175000, max: 200000,rate: 0.10  },
          { min: 200000, max: null,  rate: 0.11  },
        ],
        mfj: [
          { min: 0,      max: 4800,  rate: 0.014 },
          { min: 4800,   max: 9600,  rate: 0.032 },
          { min: 9600,   max: 19200, rate: 0.055 },
          { min: 19200,  max: 28800, rate: 0.064 },
          { min: 28800,  max: 38400, rate: 0.068 },
          { min: 38400,  max: 48000, rate: 0.072 },
          { min: 48000,  max: 72000, rate: 0.076 },
          { min: 72000,  max: 96000, rate: 0.079 },
          { min: 96000,  max: 300000,rate: 0.0825},
          { min: 300000, max: 350000,rate: 0.09  },
          { min: 350000, max: 400000,rate: 0.10  },
          { min: 400000, max: null,  rate: 0.11  },
        ],
        mfs: [
          { min: 0,      max: 2400,  rate: 0.014 },
          { min: 2400,   max: 4800,  rate: 0.032 },
          { min: 4800,   max: 9600,  rate: 0.055 },
          { min: 9600,   max: 14400, rate: 0.064 },
          { min: 14400,  max: 19200, rate: 0.068 },
          { min: 19200,  max: 24000, rate: 0.072 },
          { min: 24000,  max: 36000, rate: 0.076 },
          { min: 36000,  max: 48000, rate: 0.079 },
          { min: 48000,  max: 150000,rate: 0.0825},
          { min: 150000, max: 175000,rate: 0.09  },
          { min: 175000, max: 200000,rate: 0.10  },
          { min: 200000, max: null,  rate: 0.11  },
        ],
        hoh: [
          { min: 0,      max: 3600,  rate: 0.014 },
          { min: 3600,   max: 7200,  rate: 0.032 },
          { min: 7200,   max: 14400, rate: 0.055 },
          { min: 14400,  max: 21600, rate: 0.064 },
          { min: 21600,  max: 28800, rate: 0.068 },
          { min: 28800,  max: 36000, rate: 0.072 },
          { min: 36000,  max: 54000, rate: 0.076 },
          { min: 54000,  max: 72000, rate: 0.079 },
          { min: 72000,  max: 225000,rate: 0.0825},
          { min: 225000, max: 262500,rate: 0.09  },
          { min: 262500, max: 300000,rate: 0.10  },
          { min: 300000, max: null,  rate: 0.11  },
        ],
        qw: [
          { min: 0,      max: 4800,  rate: 0.014 },
          { min: 4800,   max: 9600,  rate: 0.032 },
          { min: 9600,   max: 19200, rate: 0.055 },
          { min: 19200,  max: 28800, rate: 0.064 },
          { min: 28800,  max: 38400, rate: 0.068 },
          { min: 38400,  max: 48000, rate: 0.072 },
          { min: 48000,  max: 72000, rate: 0.076 },
          { min: 72000,  max: 96000, rate: 0.079 },
          { min: 96000,  max: 300000,rate: 0.0825},
          { min: 300000, max: 350000,rate: 0.09  },
          { min: 350000, max: 400000,rate: 0.10  },
          { min: 400000, max: null,  rate: 0.11  },
        ],
      },
    },

    IA: {
      name: "Iowa",
      type: "graduated",
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 40, mfj: 80, mfs: 40, hoh: 40, qw: 80 },
      dependentExemption: 40,
      brackets: {
        single: [
          { min: 0,      max: 6210,  rate: 0.044 },
          { min: 6210,   max: 31050, rate: 0.048 },
          { min: 31050,  max: null,  rate: 0.057 },
        ],
        mfj: [
          { min: 0,      max: 12420, rate: 0.044 },
          { min: 12420,  max: 62100, rate: 0.048 },
          { min: 62100,  max: null,  rate: 0.057 },
        ],
        mfs: [
          { min: 0,      max: 6210,  rate: 0.044 },
          { min: 6210,   max: 31050, rate: 0.048 },
          { min: 31050,  max: null,  rate: 0.057 },
        ],
        hoh: [
          { min: 0,      max: 6210,  rate: 0.044 },
          { min: 6210,   max: 31050, rate: 0.048 },
          { min: 31050,  max: null,  rate: 0.057 },
        ],
        qw: [
          { min: 0,      max: 12420, rate: 0.044 },
          { min: 12420,  max: 62100, rate: 0.048 },
          { min: 62100,  max: null,  rate: 0.057 },
        ],
      },
    },

    KS: {
      name: "Kansas",
      type: "graduated",
      deduction: { single: 3500, mfj: 8000, mfs: 4000, hoh: 6000, qw: 8000 },
      exemption: { single: 2250, mfj: 4500, mfs: 2250, hoh: 2250, qw: 4500 },
      dependentExemption: 2250,
      brackets: {
        single: [
          { min: 0,      max: 15000, rate: 0.031 },
          { min: 15000,  max: 30000, rate: 0.0525},
          { min: 30000,  max: null,  rate: 0.057 },
        ],
        mfj: [
          { min: 0,      max: 30000, rate: 0.031 },
          { min: 30000,  max: 60000, rate: 0.0525},
          { min: 60000,  max: null,  rate: 0.057 },
        ],
        mfs: [
          { min: 0,      max: 15000, rate: 0.031 },
          { min: 15000,  max: 30000, rate: 0.0525},
          { min: 30000,  max: null,  rate: 0.057 },
        ],
        hoh: [
          { min: 0,      max: 15000, rate: 0.031 },
          { min: 15000,  max: 30000, rate: 0.0525},
          { min: 30000,  max: null,  rate: 0.057 },
        ],
        qw: [
          { min: 0,      max: 30000, rate: 0.031 },
          { min: 30000,  max: 60000, rate: 0.0525},
          { min: 60000,  max: null,  rate: 0.057 },
        ],
      },
    },

    LA: {
      name: "Louisiana",
      type: "graduated",
      deduction: { single: 4500, mfj: 9000, mfs: 4500, hoh: 9000, qw: 9000 },
      exemption: { single: 4500, mfj: 9000, mfs: 4500, hoh: 9000, qw: 9000 },
      dependentExemption: 1000,
      brackets: {
        single: [
          { min: 0,      max: 12500, rate: 0.0185},
          { min: 12500,  max: 50000, rate: 0.035 },
          { min: 50000,  max: null,  rate: 0.0425},
        ],
        mfj: [
          { min: 0,      max: 25000, rate: 0.0185},
          { min: 25000,  max: 100000,rate: 0.035 },
          { min: 100000, max: null,  rate: 0.0425},
        ],
        mfs: [
          { min: 0,      max: 12500, rate: 0.0185},
          { min: 12500,  max: 50000, rate: 0.035 },
          { min: 50000,  max: null,  rate: 0.0425},
        ],
        hoh: [
          { min: 0,      max: 25000, rate: 0.0185},
          { min: 25000,  max: 100000,rate: 0.035 },
          { min: 100000, max: null,  rate: 0.0425},
        ],
        qw: [
          { min: 0,      max: 25000, rate: 0.0185},
          { min: 25000,  max: 100000,rate: 0.035 },
          { min: 100000, max: null,  rate: 0.0425},
        ],
      },
    },

    MD: {
      name: "Maryland",
      type: "graduated",
      deduction: { single: 2400, mfj: 4800, mfs: 2400, hoh: 2400, qw: 4800 },
      exemption: { single: 3200, mfj: 6400, mfs: 3200, hoh: 3200, qw: 6400 },
      dependentExemption: 3200,
      brackets: {
        single: [
          { min: 0,       max: 1000,   rate: 0.02  },
          { min: 1000,    max: 2000,   rate: 0.03  },
          { min: 2000,    max: 3000,   rate: 0.04  },
          { min: 3000,    max: 100000, rate: 0.0475},
          { min: 100000,  max: 125000, rate: 0.05  },
          { min: 125000,  max: 150000, rate: 0.0525},
          { min: 150000,  max: 250000, rate: 0.055 },
          { min: 250000,  max: null,   rate: 0.0575},
        ],
        mfj: [
          { min: 0,       max: 1000,   rate: 0.02  },
          { min: 1000,    max: 2000,   rate: 0.03  },
          { min: 2000,    max: 3000,   rate: 0.04  },
          { min: 3000,    max: 150000, rate: 0.0475},
          { min: 150000,  max: 175000, rate: 0.05  },
          { min: 175000,  max: 225000, rate: 0.0525},
          { min: 225000,  max: 300000, rate: 0.055 },
          { min: 300000,  max: null,   rate: 0.0575},
        ],
        mfs: [
          { min: 0,       max: 1000,   rate: 0.02  },
          { min: 1000,    max: 2000,   rate: 0.03  },
          { min: 2000,    max: 3000,   rate: 0.04  },
          { min: 3000,    max: 100000, rate: 0.0475},
          { min: 100000,  max: 125000, rate: 0.05  },
          { min: 125000,  max: 150000, rate: 0.0525},
          { min: 150000,  max: 250000, rate: 0.055 },
          { min: 250000,  max: null,   rate: 0.0575},
        ],
        hoh: [
          { min: 0,       max: 1000,   rate: 0.02  },
          { min: 1000,    max: 2000,   rate: 0.03  },
          { min: 2000,    max: 3000,   rate: 0.04  },
          { min: 3000,    max: 150000, rate: 0.0475},
          { min: 150000,  max: 175000, rate: 0.05  },
          { min: 175000,  max: 225000, rate: 0.0525},
          { min: 225000,  max: 300000, rate: 0.055 },
          { min: 300000,  max: null,   rate: 0.0575},
        ],
        qw: [
          { min: 0,       max: 1000,   rate: 0.02  },
          { min: 1000,    max: 2000,   rate: 0.03  },
          { min: 2000,    max: 3000,   rate: 0.04  },
          { min: 3000,    max: 150000, rate: 0.0475},
          { min: 150000,  max: 175000, rate: 0.05  },
          { min: 175000,  max: 225000, rate: 0.0525},
          { min: 225000,  max: 300000, rate: 0.055 },
          { min: 300000,  max: null,   rate: 0.0575},
        ],
      },
    },


    MN: {
      name: "Minnesota",
      type: "graduated",
      deduction: { single: 13825, mfj: 27650, mfs: 13825, hoh: 20800, qw: 27650 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
      brackets: {
        single: [
          { min: 0,      max: 30070,  rate: 0.0535},
          { min: 30070,  max: 98760,  rate: 0.068 },
          { min: 98760,  max: 183340, rate: 0.0785},
          { min: 183340, max: null,   rate: 0.0985},
        ],
        mfj: [
          { min: 0,      max: 43950,  rate: 0.0535},
          { min: 43950,  max: 174610, rate: 0.068 },
          { min: 174610, max: 304970, rate: 0.0785},
          { min: 304970, max: null,   rate: 0.0985},
        ],
        mfs: [
          { min: 0,      max: 21975,  rate: 0.0535},
          { min: 21975,  max: 87305,  rate: 0.068 },
          { min: 87305,  max: 152485, rate: 0.0785},
          { min: 152485, max: null,   rate: 0.0985},
        ],
        hoh: [
          { min: 0,      max: 37010,  rate: 0.0535},
          { min: 37010,  max: 131190, rate: 0.068 },
          { min: 131190, max: 214980, rate: 0.0785},
          { min: 214980, max: null,   rate: 0.0985},
        ],
        qw: [
          { min: 0,      max: 43950,  rate: 0.0535},
          { min: 43950,  max: 174610, rate: 0.068 },
          { min: 174610, max: 304970, rate: 0.0785},
          { min: 304970, max: null,   rate: 0.0985},
        ],
      },
    },

    MO: {
      name: "Missouri",
      type: "graduated",
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 1200,
      brackets: {
        single: [
          { min: 0,     max: 1207,  rate: 0.00  },
          { min: 1207,  max: 2414,  rate: 0.02  },
          { min: 2414,  max: 3621,  rate: 0.025 },
          { min: 3621,  max: 4828,  rate: 0.03  },
          { min: 4828,  max: 6035,  rate: 0.035 },
          { min: 6035,  max: 7242,  rate: 0.04  },
          { min: 7242,  max: 8449,  rate: 0.045 },
          { min: 8449,  max: null,  rate: 0.048 },
        ],
        mfj: [
          { min: 0,     max: 1207,  rate: 0.00  },
          { min: 1207,  max: 2414,  rate: 0.02  },
          { min: 2414,  max: 3621,  rate: 0.025 },
          { min: 3621,  max: 4828,  rate: 0.03  },
          { min: 4828,  max: 6035,  rate: 0.035 },
          { min: 6035,  max: 7242,  rate: 0.04  },
          { min: 7242,  max: 8449,  rate: 0.045 },
          { min: 8449,  max: null,  rate: 0.048 },
        ],
        mfs: [
          { min: 0,     max: 1207,  rate: 0.00  },
          { min: 1207,  max: 2414,  rate: 0.02  },
          { min: 2414,  max: 3621,  rate: 0.025 },
          { min: 3621,  max: 4828,  rate: 0.03  },
          { min: 4828,  max: 6035,  rate: 0.035 },
          { min: 6035,  max: 7242,  rate: 0.04  },
          { min: 7242,  max: 8449,  rate: 0.045 },
          { min: 8449,  max: null,  rate: 0.048 },
        ],
        hoh: [
          { min: 0,     max: 1207,  rate: 0.00  },
          { min: 1207,  max: 2414,  rate: 0.02  },
          { min: 2414,  max: 3621,  rate: 0.025 },
          { min: 3621,  max: 4828,  rate: 0.03  },
          { min: 4828,  max: 6035,  rate: 0.035 },
          { min: 6035,  max: 7242,  rate: 0.04  },
          { min: 7242,  max: 8449,  rate: 0.045 },
          { min: 8449,  max: null,  rate: 0.048 },
        ],
        qw: [
          { min: 0,     max: 1207,  rate: 0.00  },
          { min: 1207,  max: 2414,  rate: 0.02  },
          { min: 2414,  max: 3621,  rate: 0.025 },
          { min: 3621,  max: 4828,  rate: 0.03  },
          { min: 4828,  max: 6035,  rate: 0.035 },
          { min: 6035,  max: 7242,  rate: 0.04  },
          { min: 7242,  max: 8449,  rate: 0.045 },
          { min: 8449,  max: null,  rate: 0.048 },
        ],
      },
    },

    MT: {
      name: "Montana",
      type: "graduated",
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 2580,
      brackets: {
        single: [
          { min: 0,      max: 20500, rate: 0.047 },
          { min: 20500,  max: null,  rate: 0.059 },
        ],
        mfj: [
          { min: 0,      max: 41000, rate: 0.047 },
          { min: 41000,  max: null,  rate: 0.059 },
        ],
        mfs: [
          { min: 0,      max: 20500, rate: 0.047 },
          { min: 20500,  max: null,  rate: 0.059 },
        ],
        hoh: [
          { min: 0,      max: 20500, rate: 0.047 },
          { min: 20500,  max: null,  rate: 0.059 },
        ],
        qw: [
          { min: 0,      max: 41000, rate: 0.047 },
          { min: 41000,  max: null,  rate: 0.059 },
        ],
      },
    },

    NE: {
      name: "Nebraska",
      type: "graduated",
      deduction: { single: 7900, mfj: 15800, mfs: 7900, hoh: 7900, qw: 15800 },
      exemption: { single: 157, mfj: 314, mfs: 157, hoh: 157, qw: 314 },
      dependentExemption: 157,
      brackets: {
        single: [
          { min: 0,      max: 3700,  rate: 0.0246},
          { min: 3700,   max: 22170, rate: 0.0351},
          { min: 22170,  max: 35730, rate: 0.0501},
          { min: 35730,  max: null,  rate: 0.0664},
        ],
        mfj: [
          { min: 0,      max: 7390,  rate: 0.0246},
          { min: 7390,   max: 44350, rate: 0.0351},
          { min: 44350,  max: 71460, rate: 0.0501},
          { min: 71460,  max: null,  rate: 0.0664},
        ],
        mfs: [
          { min: 0,      max: 3700,  rate: 0.0246},
          { min: 3700,   max: 22170, rate: 0.0351},
          { min: 22170,  max: 35730, rate: 0.0501},
          { min: 35730,  max: null,  rate: 0.0664},
        ],
        hoh: [
          { min: 0,      max: 3700,  rate: 0.0246},
          { min: 3700,   max: 22170, rate: 0.0351},
          { min: 22170,  max: 35730, rate: 0.0501},
          { min: 35730,  max: null,  rate: 0.0664},
        ],
        qw: [
          { min: 0,      max: 7390,  rate: 0.0246},
          { min: 7390,   max: 44350, rate: 0.0351},
          { min: 44350,  max: 71460, rate: 0.0501},
          { min: 71460,  max: null,  rate: 0.0664},
        ],
      },
    },

    NJ: {
      name: "New Jersey",
      type: "graduated",
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 1000, mfj: 2000, mfs: 1000, hoh: 1500, qw: 2000 },
      dependentExemption: 1500,
      brackets: {
        single: [
          { min: 0,       max: 20000,  rate: 0.014 },
          { min: 20000,   max: 35000,  rate: 0.0175},
          { min: 35000,   max: 40000,  rate: 0.035 },
          { min: 40000,   max: 75000,  rate: 0.05525},
          { min: 75000,   max: 500000, rate: 0.0637},
          { min: 500000,  max: 1000000,rate: 0.0897},
          { min: 1000000, max: null,   rate: 0.1075},
        ],
        mfj: [
          { min: 0,       max: 20000,  rate: 0.014 },
          { min: 20000,   max: 50000,  rate: 0.0175},
          { min: 50000,   max: 70000,  rate: 0.0245},
          { min: 70000,   max: 80000,  rate: 0.035 },
          { min: 80000,   max: 150000, rate: 0.05525},
          { min: 150000,  max: 500000, rate: 0.0637},
          { min: 500000,  max: 1000000,rate: 0.0897},
          { min: 1000000, max: null,   rate: 0.1075},
        ],
        mfs: [
          { min: 0,       max: 20000,  rate: 0.014 },
          { min: 20000,   max: 35000,  rate: 0.0175},
          { min: 35000,   max: 40000,  rate: 0.035 },
          { min: 40000,   max: 75000,  rate: 0.05525},
          { min: 75000,   max: 500000, rate: 0.0637},
          { min: 500000,  max: 1000000,rate: 0.0897},
          { min: 1000000, max: null,   rate: 0.1075},
        ],
        hoh: [
          { min: 0,       max: 20000,  rate: 0.014 },
          { min: 20000,   max: 50000,  rate: 0.0175},
          { min: 50000,   max: 70000,  rate: 0.0245},
          { min: 70000,   max: 80000,  rate: 0.035 },
          { min: 80000,   max: 150000, rate: 0.05525},
          { min: 150000,  max: 500000, rate: 0.0637},
          { min: 500000,  max: 1000000,rate: 0.0897},
          { min: 1000000, max: null,   rate: 0.1075},
        ],
        qw: [
          { min: 0,       max: 20000,  rate: 0.014 },
          { min: 20000,   max: 50000,  rate: 0.0175},
          { min: 50000,   max: 70000,  rate: 0.0245},
          { min: 70000,   max: 80000,  rate: 0.035 },
          { min: 80000,   max: 150000, rate: 0.05525},
          { min: 150000,  max: 500000, rate: 0.0637},
          { min: 500000,  max: 1000000,rate: 0.0897},
          { min: 1000000, max: null,   rate: 0.1075},
        ],
      },
    },

    NM: {
      name: "New Mexico",
      type: "graduated",
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 4000,
      brackets: {
        single: [
          { min: 0,      max: 5500,  rate: 0.017 },
          { min: 5500,   max: 11000, rate: 0.032 },
          { min: 11000,  max: 16000, rate: 0.047 },
          { min: 16000,  max: 210000,rate: 0.049 },
          { min: 210000, max: null,  rate: 0.059 },
        ],
        mfj: [
          { min: 0,      max: 8000,  rate: 0.017 },
          { min: 8000,   max: 16000, rate: 0.032 },
          { min: 16000,  max: 24000, rate: 0.047 },
          { min: 24000,  max: 315000,rate: 0.049 },
          { min: 315000, max: null,  rate: 0.059 },
        ],
        mfs: [
          { min: 0,      max: 5500,  rate: 0.017 },
          { min: 5500,   max: 11000, rate: 0.032 },
          { min: 11000,  max: 16000, rate: 0.047 },
          { min: 16000,  max: 210000,rate: 0.049 },
          { min: 210000, max: null,  rate: 0.059 },
        ],
        hoh: [
          { min: 0,      max: 8000,  rate: 0.017 },
          { min: 8000,   max: 16000, rate: 0.032 },
          { min: 16000,  max: 24000, rate: 0.047 },
          { min: 24000,  max: 315000,rate: 0.049 },
          { min: 315000, max: null,  rate: 0.059 },
        ],
        qw: [
          { min: 0,      max: 8000,  rate: 0.017 },
          { min: 8000,   max: 16000, rate: 0.032 },
          { min: 16000,  max: 24000, rate: 0.047 },
          { min: 24000,  max: 315000,rate: 0.049 },
          { min: 315000, max: null,  rate: 0.059 },
        ],
      },
    },

    NY: {
      name: "New York",
      type: "graduated",
      deduction: { single: 8000, mfj: 16050, mfs: 8000, hoh: 11200, qw: 16050 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 1000,
      brackets: {
        single: [
          { min: 0,        max: 17150,   rate: 0.04   },
          { min: 17150,    max: 23600,   rate: 0.045  },
          { min: 23600,    max: 27900,   rate: 0.0525 },
          { min: 27900,    max: 161550,  rate: 0.0585 },
          { min: 161550,   max: 323200,  rate: 0.0625 },
          { min: 323200,   max: 2155350, rate: 0.0685 },
          { min: 2155350,  max: 5000000, rate: 0.0965 },
          { min: 5000000,  max: 25000000,rate: 0.103  },
          { min: 25000000, max: null,    rate: 0.109  },
        ],
        mfj: [
          { min: 0,        max: 27900,   rate: 0.04   },
          { min: 27900,    max: 43000,   rate: 0.045  },
          { min: 43000,    max: 161550,  rate: 0.0525 },
          { min: 161550,   max: 323200,  rate: 0.0585 },
          { min: 323200,   max: 2155350, rate: 0.0625 },
          { min: 2155350,  max: 5000000, rate: 0.0685 },
          { min: 5000000,  max: 25000000,rate: 0.0965 },
          { min: 25000000, max: null,    rate: 0.103  },
        ],
        mfs: [
          { min: 0,        max: 17150,   rate: 0.04   },
          { min: 17150,    max: 23600,   rate: 0.045  },
          { min: 23600,    max: 27900,   rate: 0.0525 },
          { min: 27900,    max: 161550,  rate: 0.0585 },
          { min: 161550,   max: 323200,  rate: 0.0625 },
          { min: 323200,   max: 2155350, rate: 0.0685 },
          { min: 2155350,  max: 5000000, rate: 0.0965 },
          { min: 5000000,  max: 25000000,rate: 0.103  },
          { min: 25000000, max: null,    rate: 0.109  },
        ],
        hoh: [
          { min: 0,        max: 17650,   rate: 0.04   },
          { min: 17650,    max: 23600,   rate: 0.045  },
          { min: 23600,    max: 27900,   rate: 0.0525 },
          { min: 27900,    max: 161550,  rate: 0.0585 },
          { min: 161550,   max: 323200,  rate: 0.0625 },
          { min: 323200,   max: 2155350, rate: 0.0685 },
          { min: 2155350,  max: 5000000, rate: 0.0965 },
          { min: 5000000,  max: 25000000,rate: 0.103  },
          { min: 25000000, max: null,    rate: 0.109  },
        ],
        qw: [
          { min: 0,        max: 27900,   rate: 0.04   },
          { min: 27900,    max: 43000,   rate: 0.045  },
          { min: 43000,    max: 161550,  rate: 0.0525 },
          { min: 161550,   max: 323200,  rate: 0.0585 },
          { min: 323200,   max: 2155350, rate: 0.0625 },
          { min: 2155350,  max: 5000000, rate: 0.0685 },
          { min: 5000000,  max: 25000000,rate: 0.0965 },
          { min: 25000000, max: null,    rate: 0.103  },
        ],
      },
    },

    OH: {
      name: "Ohio",
      type: "graduated",
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 2400, mfj: 4800, mfs: 2400, hoh: 2400, qw: 4800 },
      dependentExemption: 2400,
      brackets: {
        single: [
          { min: 0,      max: 26050,  rate: 0.00   },
          { min: 26050,  max: 46100,  rate: 0.02765},
          { min: 46100,  max: 92150,  rate: 0.03226},
          { min: 92150,  max: 115300, rate: 0.03688},
          { min: 115300, max: null,   rate: 0.03990},
        ],
        mfj: [
          { min: 0,      max: 26050,  rate: 0.00   },
          { min: 26050,  max: 46100,  rate: 0.02765},
          { min: 46100,  max: 92150,  rate: 0.03226},
          { min: 92150,  max: 115300, rate: 0.03688},
          { min: 115300, max: null,   rate: 0.03990},
        ],
        mfs: [
          { min: 0,      max: 26050,  rate: 0.00   },
          { min: 26050,  max: 46100,  rate: 0.02765},
          { min: 46100,  max: 92150,  rate: 0.03226},
          { min: 92150,  max: 115300, rate: 0.03688},
          { min: 115300, max: null,   rate: 0.03990},
        ],
        hoh: [
          { min: 0,      max: 26050,  rate: 0.00   },
          { min: 26050,  max: 46100,  rate: 0.02765},
          { min: 46100,  max: 92150,  rate: 0.03226},
          { min: 92150,  max: 115300, rate: 0.03688},
          { min: 115300, max: null,   rate: 0.03990},
        ],
        qw: [
          { min: 0,      max: 26050,  rate: 0.00   },
          { min: 26050,  max: 46100,  rate: 0.02765},
          { min: 46100,  max: 92150,  rate: 0.03226},
          { min: 92150,  max: 115300, rate: 0.03688},
          { min: 115300, max: null,   rate: 0.03990},
        ],
      },
    },

    OK: {
      name: "Oklahoma",
      type: "graduated",
      deduction: { single: 6350, mfj: 12700, mfs: 6350, hoh: 9350, qw: 12700 },
      exemption: { single: 1000, mfj: 2000, mfs: 1000, hoh: 1000, qw: 2000 },
      dependentExemption: 1000,
      brackets: {
        single: [
          { min: 0,     max: 1000,  rate: 0.0025},
          { min: 1000,  max: 2500,  rate: 0.0075},
          { min: 2500,  max: 3750,  rate: 0.0175},
          { min: 3750,  max: 4900,  rate: 0.0275},
          { min: 4900,  max: 7200,  rate: 0.0375},
          { min: 7200,  max: null,  rate: 0.0475},
        ],
        mfj: [
          { min: 0,     max: 2000,  rate: 0.0025},
          { min: 2000,  max: 5000,  rate: 0.0075},
          { min: 5000,  max: 7500,  rate: 0.0175},
          { min: 7500,  max: 9800,  rate: 0.0275},
          { min: 9800,  max: 12200, rate: 0.0375},
          { min: 12200, max: null,  rate: 0.0475},
        ],
        mfs: [
          { min: 0,     max: 1000,  rate: 0.0025},
          { min: 1000,  max: 2500,  rate: 0.0075},
          { min: 2500,  max: 3750,  rate: 0.0175},
          { min: 3750,  max: 4900,  rate: 0.0275},
          { min: 4900,  max: 7200,  rate: 0.0375},
          { min: 7200,  max: null,  rate: 0.0475},
        ],
        hoh: [
          { min: 0,     max: 2000,  rate: 0.0025},
          { min: 2000,  max: 5000,  rate: 0.0075},
          { min: 5000,  max: 7500,  rate: 0.0175},
          { min: 7500,  max: 9800,  rate: 0.0275},
          { min: 9800,  max: 12200, rate: 0.0375},
          { min: 12200, max: null,  rate: 0.0475},
        ],
        qw: [
          { min: 0,     max: 2000,  rate: 0.0025},
          { min: 2000,  max: 5000,  rate: 0.0075},
          { min: 5000,  max: 7500,  rate: 0.0175},
          { min: 7500,  max: 9800,  rate: 0.0275},
          { min: 9800,  max: 12200, rate: 0.0375},
          { min: 12200, max: null,  rate: 0.0475},
        ],
      },
    },

    OR: {
      name: "Oregon",
      type: "graduated",
      deduction: { single: 2420, mfj: 4840, mfs: 2420, hoh: 4840, qw: 4840 },
      exemption: { single: 236, mfj: 472, mfs: 236, hoh: 472, qw: 472 },
      dependentExemption: 236,
      brackets: {
        single: [
          { min: 0,      max: 18400,  rate: 0.0475},
          { min: 18400,  max: 46200,  rate: 0.0675},
          { min: 46200,  max: 250000, rate: 0.0875},
          { min: 250000, max: null,   rate: 0.099 },
        ],
        mfj: [
          { min: 0,      max: 36800,  rate: 0.0475},
          { min: 36800,  max: 92400,  rate: 0.0675},
          { min: 92400,  max: 400000, rate: 0.0875},
          { min: 400000, max: null,   rate: 0.099 },
        ],
        mfs: [
          { min: 0,      max: 18400,  rate: 0.0475},
          { min: 18400,  max: 46200,  rate: 0.0675},
          { min: 46200,  max: 250000, rate: 0.0875},
          { min: 250000, max: null,   rate: 0.099 },
        ],
        hoh: [
          { min: 0,      max: 36800,  rate: 0.0475},
          { min: 36800,  max: 92400,  rate: 0.0675},
          { min: 92400,  max: 400000, rate: 0.0875},
          { min: 400000, max: null,   rate: 0.099 },
        ],
        qw: [
          { min: 0,      max: 36800,  rate: 0.0475},
          { min: 36800,  max: 92400,  rate: 0.0675},
          { min: 92400,  max: 400000, rate: 0.0875},
          { min: 400000, max: null,   rate: 0.099 },
        ],
      },
    },

    RI: {
      name: "Rhode Island",
      type: "graduated",
      deduction: { single: 10550, mfj: 21150, mfs: 10550, hoh: 10550, qw: 21150 },
      exemption: { single: 4950, mfj: 9900, mfs: 4950, hoh: 4950, qw: 9900 },
      dependentExemption: 4950,
      brackets: {
        single: [
          { min: 0,      max: 77450,  rate: 0.0375},
          { min: 77450,  max: 176050, rate: 0.0475},
          { min: 176050, max: null,   rate: 0.0599},
        ],
        mfj: [
          { min: 0,      max: 77450,  rate: 0.0375},
          { min: 77450,  max: 176050, rate: 0.0475},
          { min: 176050, max: null,   rate: 0.0599},
        ],
        mfs: [
          { min: 0,      max: 77450,  rate: 0.0375},
          { min: 77450,  max: 176050, rate: 0.0475},
          { min: 176050, max: null,   rate: 0.0599},
        ],
        hoh: [
          { min: 0,      max: 77450,  rate: 0.0375},
          { min: 77450,  max: 176050, rate: 0.0475},
          { min: 176050, max: null,   rate: 0.0599},
        ],
        qw: [
          { min: 0,      max: 77450,  rate: 0.0375},
          { min: 77450,  max: 176050, rate: 0.0475},
          { min: 176050, max: null,   rate: 0.0599},
        ],
      },
    },

    SC: {
      name: "South Carolina",
      type: "graduated",
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 4610,
      brackets: {
        single: [
          { min: 0,     max: 3460,  rate: 0.00 },
          { min: 3460,  max: 17330, rate: 0.03 },
          { min: 17330, max: null,  rate: 0.064},
        ],
        mfj: [
          { min: 0,     max: 3460,  rate: 0.00 },
          { min: 3460,  max: 17330, rate: 0.03 },
          { min: 17330, max: null,  rate: 0.064},
        ],
        mfs: [
          { min: 0,     max: 3460,  rate: 0.00 },
          { min: 3460,  max: 17330, rate: 0.03 },
          { min: 17330, max: null,  rate: 0.064},
        ],
        hoh: [
          { min: 0,     max: 3460,  rate: 0.00 },
          { min: 3460,  max: 17330, rate: 0.03 },
          { min: 17330, max: null,  rate: 0.064},
        ],
        qw: [
          { min: 0,     max: 3460,  rate: 0.00 },
          { min: 3460,  max: 17330, rate: 0.03 },
          { min: 17330, max: null,  rate: 0.064},
        ],
      },
    },

    VA: {
      name: "Virginia",
      type: "graduated",
      deduction: { single: 8000, mfj: 16000, mfs: 8000, hoh: 8000, qw: 16000 },
      exemption: { single: 930, mfj: 1860, mfs: 930, hoh: 930, qw: 1860 },
      dependentExemption: 930,
      brackets: {
        single: [
          { min: 0,     max: 3000,  rate: 0.02  },
          { min: 3000,  max: 5000,  rate: 0.03  },
          { min: 5000,  max: 17000, rate: 0.05  },
          { min: 17000, max: null,  rate: 0.0575},
        ],
        mfj: [
          { min: 0,     max: 3000,  rate: 0.02  },
          { min: 3000,  max: 5000,  rate: 0.03  },
          { min: 5000,  max: 17000, rate: 0.05  },
          { min: 17000, max: null,  rate: 0.0575},
        ],
        mfs: [
          { min: 0,     max: 3000,  rate: 0.02  },
          { min: 3000,  max: 5000,  rate: 0.03  },
          { min: 5000,  max: 17000, rate: 0.05  },
          { min: 17000, max: null,  rate: 0.0575},
        ],
        hoh: [
          { min: 0,     max: 3000,  rate: 0.02  },
          { min: 3000,  max: 5000,  rate: 0.03  },
          { min: 5000,  max: 17000, rate: 0.05  },
          { min: 17000, max: null,  rate: 0.0575},
        ],
        qw: [
          { min: 0,     max: 3000,  rate: 0.02  },
          { min: 3000,  max: 5000,  rate: 0.03  },
          { min: 5000,  max: 17000, rate: 0.05  },
          { min: 17000, max: null,  rate: 0.0575},
        ],
      },
    },

    VT: {
      name: "Vermont",
      type: "graduated",
      deduction: { single: 6500, mfj: 13000, mfs: 6500, hoh: 9750, qw: 13000 },
      exemption: { single: 4500, mfj: 9000, mfs: 4500, hoh: 4500, qw: 9000 },
      dependentExemption: 4500,
      brackets: {
        single: [
          { min: 0,      max: 45400,  rate: 0.0335},
          { min: 45400,  max: 110050, rate: 0.066 },
          { min: 110050, max: 229550, rate: 0.076 },
          { min: 229550, max: null,   rate: 0.0875},
        ],
        mfj: [
          { min: 0,      max: 75850,  rate: 0.0335},
          { min: 75850,  max: 183400, rate: 0.066 },
          { min: 183400, max: 279450, rate: 0.076 },
          { min: 279450, max: null,   rate: 0.0875},
        ],
        mfs: [
          { min: 0,      max: 45400,  rate: 0.0335},
          { min: 45400,  max: 110050, rate: 0.066 },
          { min: 110050, max: 229550, rate: 0.076 },
          { min: 229550, max: null,   rate: 0.0875},
        ],
        hoh: [
          { min: 0,      max: 63100,  rate: 0.0335},
          { min: 63100,  max: 162750, rate: 0.066 },
          { min: 162750, max: 250000, rate: 0.076 },
          { min: 250000, max: null,   rate: 0.0875},
        ],
        qw: [
          { min: 0,      max: 75850,  rate: 0.0335},
          { min: 75850,  max: 183400, rate: 0.066 },
          { min: 183400, max: 279450, rate: 0.076 },
          { min: 279450, max: null,   rate: 0.0875},
        ],
      },
    },

    WI: {
      name: "Wisconsin",
      type: "graduated",
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 700, mfj: 1400, mfs: 700, hoh: 700, qw: 1400 },
      dependentExemption: 700,
      brackets: {
        single: [
          { min: 0,      max: 14320,  rate: 0.035 },
          { min: 14320,  max: 28640,  rate: 0.044 },
          { min: 28640,  max: 315310, rate: 0.053 },
          { min: 315310, max: null,   rate: 0.0765},
        ],
        mfj: [
          { min: 0,      max: 19090,  rate: 0.035 },
          { min: 19090,  max: 38190,  rate: 0.044 },
          { min: 38190,  max: 420420, rate: 0.053 },
          { min: 420420, max: null,   rate: 0.0765},
        ],
        mfs: [
          { min: 0,      max: 14320,  rate: 0.035 },
          { min: 14320,  max: 28640,  rate: 0.044 },
          { min: 28640,  max: 315310, rate: 0.053 },
          { min: 315310, max: null,   rate: 0.0765},
        ],
        hoh: [
          { min: 0,      max: 14320,  rate: 0.035 },
          { min: 14320,  max: 28640,  rate: 0.044 },
          { min: 28640,  max: 315310, rate: 0.053 },
          { min: 315310, max: null,   rate: 0.0765},
        ],
        qw: [
          { min: 0,      max: 19090,  rate: 0.035 },
          { min: 19090,  max: 38190,  rate: 0.044 },
          { min: 38190,  max: 420420, rate: 0.053 },
          { min: 420420, max: null,   rate: 0.0765},
        ],
      },
    },

    WV: {
      name: "West Virginia",
      type: "graduated",
      deduction: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      exemption: { single: 2000, mfj: 4000, mfs: 2000, hoh: 2000, qw: 4000 },
      dependentExemption: 2000,
      brackets: {
        single: [
          { min: 0,     max: 10000,  rate: 0.0236},
          { min: 10000, max: 25000,  rate: 0.0315},
          { min: 25000, max: 40000,  rate: 0.0354},
          { min: 40000, max: 60000,  rate: 0.0472},
          { min: 60000, max: null,   rate: 0.0512},
        ],
        mfj: [
          { min: 0,     max: 10000,  rate: 0.0236},
          { min: 10000, max: 25000,  rate: 0.0315},
          { min: 25000, max: 40000,  rate: 0.0354},
          { min: 40000, max: 60000,  rate: 0.0472},
          { min: 60000, max: null,   rate: 0.0512},
        ],
        mfs: [
          { min: 0,     max: 10000,  rate: 0.0236},
          { min: 10000, max: 25000,  rate: 0.0315},
          { min: 25000, max: 40000,  rate: 0.0354},
          { min: 40000, max: 60000,  rate: 0.0472},
          { min: 60000, max: null,   rate: 0.0512},
        ],
        hoh: [
          { min: 0,     max: 10000,  rate: 0.0236},
          { min: 10000, max: 25000,  rate: 0.0315},
          { min: 25000, max: 40000,  rate: 0.0354},
          { min: 40000, max: 60000,  rate: 0.0472},
          { min: 60000, max: null,   rate: 0.0512},
        ],
        qw: [
          { min: 0,     max: 10000,  rate: 0.0236},
          { min: 10000, max: 25000,  rate: 0.0315},
          { min: 25000, max: 40000,  rate: 0.0354},
          { min: 40000, max: 60000,  rate: 0.0472},
          { min: 60000, max: null,   rate: 0.0512},
        ],
      },
    },

    // States with income tax not yet fully configured return canEstimate: false
    DE: { name: "Delaware",      type: "unknown" },
    DC: { name: "Washington D.C.",type: "unknown" },
    ME: { name: "Maine",         type: "unknown" },
    ND: { name: "North Dakota",  type: "unknown" },

  }, // end 2024

};

// =============================================================================
// VERIFIED YEAR OVERRIDES
//
// Arizona values below are verified against Arizona Department of Revenue
// resident individual rules for the stated year.
//
// Arizona dependent tax credits are intentionally NOT treated as deductions
// from taxable income. The current estimator does not collect enough
// dependent-age detail to calculate those credits reliably.
// =============================================================================

const STATE_YEAR_OVERRIDES = {
  2022: {
    AZ: {
      name: "Arizona",
      type: "graduated",
      dependentCredit: {
        under17: 100,
        age17Plus: 25,
        phaseOutThreshold: { single: 200000, mfs: 200000, hoh: 200000, mfj: 400000, qw: 400000 },
        reductionPer1000: 0.05,
      },
      deduction: { single: 12950, mfj: 25900, mfs: 12950, hoh: 19400, qw: 25900 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
      brackets: {
        single: [
          { min: 0,     max: 28653, rate: 0.0255 },
          { min: 28653, max: null,  rate: 0.0298 },
        ],
        mfs: [
          { min: 0,     max: 28653, rate: 0.0255 },
          { min: 28653, max: null,  rate: 0.0298 },
        ],
        mfj: [
          { min: 0,     max: 57305, rate: 0.0255 },
          { min: 57305, max: null,  rate: 0.0298 },
        ],
        hoh: [
          { min: 0,     max: 57305, rate: 0.0255 },
          { min: 57305, max: null,  rate: 0.0298 },
        ],
        qw: [
          { min: 0,     max: 57305, rate: 0.0255 },
          { min: 57305, max: null,  rate: 0.0298 },
        ],
      },
    },
  },

  2023: {
    AZ: {
      name:     "Arizona",
      type:     "flat",
      dependentCredit: {
        under17: 100,
        age17Plus: 25,
        phaseOutThreshold: { single: 200000, mfs: 200000, hoh: 200000, mfj: 400000, qw: 400000 },
        reductionPer1000: 0.05,
      },
      flatRate: 0.025,
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },
  },

  2024: {
    AZ: {
      name:     "Arizona",
      type:     "flat",
      dependentCredit: {
        under17: 100,
        age17Plus: 25,
        phaseOutThreshold: { single: 200000, mfs: 200000, hoh: 200000, mfj: 400000, qw: 400000 },
        reductionPer1000: 0.05,
      },
      flatRate: 0.025,
      deduction: { single: 14600, mfj: 29200, mfs: 14600, hoh: 21900, qw: 29200 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },
  },

  2025: {
    AZ: {
      name:     "Arizona",
      type:     "flat",
      dependentCredit: {
        under17: 100,
        age17Plus: 25,
        phaseOutThreshold: { single: 200000, mfs: 200000, hoh: 200000, mfj: 400000, qw: 400000 },
        reductionPer1000: 0.05,
      },
      flatRate: 0.025,
      deduction: { single: 15750, mfj: 31500, mfs: 15750, hoh: 23625, qw: 31500 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
    },

    AK: {
      name: "Alaska",
      type: "none",
      verifiedNoIndividualIncomeTax: true,
    },
    FL: {
      name: "Florida",
      type: "none",
      verifiedNoIndividualIncomeTax: true,
    },
    NV: {
      name: "Nevada",
      type: "none",
      verifiedNoIndividualIncomeTax: true,
    },
    NH: {
      name: "New Hampshire",
      type: "none",
      verifiedNoIndividualIncomeTax: true,
      note: "Interest and Dividends Tax repealed for taxable periods beginning after December 31, 2024.",
    },
    SD: {
      name: "South Dakota",
      type: "none",
      verifiedNoIndividualIncomeTax: true,
    },
    TN: {
      name: "Tennessee",
      type: "none",
      verifiedNoIndividualIncomeTax: true,
      note: "Hall Income Tax fully repealed for tax years beginning on or after January 1, 2021.",
    },
    TX: {
      name: "Texas",
      type: "none",
      verifiedNoIndividualIncomeTax: true,
    },
    WY: {
      name: "Wyoming",
      type: "none",
      verifiedNoIndividualIncomeTax: true,
    },

    AL: {
      name: "Alabama",
      type: "graduated",
      specialCalculator: "AL_2025",
      verified2025Core: true,
      note: "2025 Alabama full-year resident planning calculation with exact standard-deduction schedule, personal/dependent exemptions, Alabama federal-income-tax deduction input, and official tax-table method through $100,000.",
    },

    AR: {
      name: "Arkansas",
      type: "graduated",
      specialCalculator: "AR_2025",
      verified2025Core: true,
      note: "2025 Arkansas full-year resident regular-table planning calculation using direct AR1000F line 23/25 inputs, exact regular tax-table midpoint method, 2025 standard deduction, personal/dependent credits, and explicit blocking for Low Income Tax Table and material special-schedule cases.",
    },

    LA: {
      name: "Louisiana",
      type: "flat",
      flatRate: 0.03,
      specialCalculator: "LA_2025",
      verified2025Core: true,
      note: "2025 Louisiana full-year resident planning calculation using the 3% flat rate, new Louisiana standard deduction, conditional federal-itemized medical adjustment, Schedule E adjusted-income input when applicable, Louisiana EIC, and explicit blocking for other material Louisiana credits, fees, and special items.",
    },

    IN: {
      name: "Indiana",
      type: "flat",
      flatRate: 0.03,
      specialCalculator: "IN_2025",
      verified2025Core: true,
      note: "2025 Indiana full-year resident IT-40 planning calculation starting from federal AGI, using direct Schedule 1 add-backs and Schedule 2 deductions, 2025 Schedule 3 exemptions, the 3.00% state rate, exact taxpayer-entered Schedule CT-40 county tax, Indiana county withholding, the 10% Indiana EITC, use tax, and explicit blocking for part-year/nonresident, other credits/taxes, and other material special cases.",
    },

    IL: {
      name: "Illinois",
      type: "flat",
      flatRate: 0.0495,
      specialCalculator: "IL_2025",
      verified2025Core: true,
      note: "2025 Illinois full-year resident IL-1040 planning calculation starting from federal AGI, using exact IL-1040/Schedule M additions and subtractions, 2025 exemption allowances, the 4.95% tax rate, direct supported nonrefundable credits and other taxes, the standard 20% Illinois EITC path, the 40% Illinois Child Tax Credit when eligible, and explicit blocking for Schedule NR, Schedule CR, expanded-EITC worksheet, cannabis/gaming surcharges, and other material special cases.",
    },

    OH: {
      name: "Ohio",
      type: "graduated",
      specialCalculator: "OH_2025",
      verified2025Core: true,
      note: "2025 Ohio full-year resident IT 1040 planning calculation starting from federal AGI, using exact Schedule of Adjustments additions and non-business-income deductions, the official Ohio business-income deduction and 3% business-income tax, MAGI-based personal/dependent exemptions, the official 2025 nonbusiness brackets, direct completed Schedule of Credits totals, exact SD 100 school-district tax/payments when applicable, and explicit blocking for part-year/nonresident, residency-credit/allocation, amended/NOL, and other material special cases.",
    },

    PA: {
      name: "Pennsylvania",
      type: "flat",
      flatRate: 0.0307,
      specialCalculator: "PA_2025",
      verified2025Core: true,
      note: "2025 Pennsylvania full-year resident PA-40 planning calculation using exact Pennsylvania-class income amounts, no standard deduction or personal exemption, Schedule O deductions, the 3.07% rate, Schedule SP Tax Forgiveness, exact resident and child/dependent-care credits, the new Working Pennsylvanians Tax Credit, use tax/payments, exact local earned-income/wage-tax totals when applicable, and explicit blocking for part-year/nonresident, Schedule OC restricted credits, amended, and other material special cases.",
    },

    DE: {
      name: "Delaware",
      type: "graduated",
      specialCalculator: "DE_2025",
      verified2025Core: true,
      note: "2025 Delaware full-year resident PIT-RES planning calculation for supported Single, Married Filing Jointly, and Head of Household returns. Starts from federal AGI, applies exact Delaware additions/subtractions, 2025 standard or exact completed itemized deduction, automatic age/blind additional standard deduction, official $50-band tax table below $60,000 and the 6.60% schedule at $60,000 or more, personal/additional personal credits, volunteer-firefighter and child-care credits, Delaware EITC logic, exact withholding/payments/refundable credits, and explicit blocking for part-year/nonresident, MFS/combined-separate, qualifying-surviving-spouse mapping, other-state credit, lump-sum distribution tax, amended, and other material special cases.",
    },

    CT: {
      name: "Connecticut",
      type: "graduated",
      specialCalculator: "CT_2025",
      verified2025Core: true,
      note: "2025 Connecticut full-year resident CT-1040 planning calculation. Starts from federal AGI, applies exact Schedule 1 additions/subtractions, uses the official 2025 CT-1040 TCS Tables A-E for personal exemptions, initial tax, 2% rate phase-out add-back, tax recapture, and personal tax credits, then applies exact AMT/property/allowable-credit/use-tax/payment inputs and Connecticut EITC rules. Part-year/nonresident, filing-status mismatch, other-state-credit, amended, and other material special cases are blocked rather than guessed.",
    },

    ME: {
      name: "Maine",
      type: "graduated",
      specialCalculator: "ME_2025",
      verified2025Core: true,
      note: "2025 Maine full-year resident Form 1040ME planning calculation for supported Single, Married Filing Jointly, Head of Household, and Qualifying Surviving Spouse returns. Starts from federal AGI, applies exact Schedule 1A additions and Schedule 1S subtractions, computes the 2025 Maine standard/itemized deduction and personal-exemption phaseouts, uses the official 2025 Maine tax rate schedules, calculates the refundable dependent exemption credit and standard Maine EIC, and uses exact completed-return amounts for other credits, payments, use tax, casual-rental tax, contributions, and penalty. Part-year/nonresident, MFS, filing-status exceptions, other-jurisdiction credit, special Maine-only EIC, amended, and other material special cases are blocked rather than guessed.",
    },

    MD: {
      name: "Maryland",
      type: "graduated",
      specialCalculator: "MD_2025",
      verified2025Core: true,
      note: "2025 Maryland full-year resident Form 502 planning calculation for supported Single, Married Filing Jointly, Head of Household, and Qualifying Surviving Spouse returns, including dependent-taxpayer treatment. Starts from federal AGI, applies exact Maryland additions/subtractions, 2025 standard or allowable itemized deduction with the high-income phaseout, official exemption phaseouts, mandatory state tax table below $100,000 and 2025 rate schedules above that level, the 2% additional tax on supported net capital gain, county/Baltimore City local income tax including Anne Arundel and Frederick special structures, standard Maryland EIC/poverty/senior/child-tax-credit paths, exact supported credits/payments, and explicit blocking for part-year/nonresident, MFS, filing-status exceptions, mixed local jurisdictions, other-state credit, Maryland-only EIC, military/special filing, amended, and other material special cases.",
    },

    MA: {
      name: "Massachusetts",
      type: "graduated",
      specialCalculator: "MA_2025",
      verified2025Core: true,
      note: "2025 Massachusetts full-year resident Form 1 planning calculation. Uses exact Form 1 five-percent income and deductions, official personal/dependent/age/blind exemptions, the official 5% tax table through $24,000, exact Schedule B / Schedule D category amounts, the 8.5% and 12% rates, exact long-term capital-gains tax, No Tax Status and Limited Income Credit from exact Massachusetts AGI, the 4% surtax above $1,083,150, standard 40% Massachusetts EITC, $440 Child and Family Tax Credit, exact supported credits/payments, and explicit blocking for part-year/nonresident, filing-status exceptions, optional 5.85% election, other-jurisdiction credit, MFS special-credit cases, amended, and other material special cases.",
    },

    NJ: {
      name: "New Jersey",
      type: "graduated",
      specialCalculator: "NJ_2025",
      verified2025Core: true,
      note: "2025 New Jersey full-year resident NJ-1040 planning calculation for supported Single, Married Filing Jointly, Head of Household, and Qualifying Widow(er)/Surviving CU Partner returns. Uses exact NJ-1040 Line 29 New Jersey gross income, official exemptions and deductions, mandatory $50-band tax table below $100,000 and 2025 Tax Rate Schedules at $100,000 or more, Worksheet H property-tax deduction-versus-credit comparison, standard 40% NJEITC, refundable child/dependent-care and child tax credits, exact supported payments/credits, and explicit blocking for part-year/nonresident, MFS, filing-status exceptions, NJ-only EITC, other-jurisdiction credit, amended, and other material special cases.",
    },

    NY: {
      name: "New York",
      type: "graduated",
      specialCalculator: "NY_2025",
      verified2025Core: true,
      note: "2025 New York full-year resident IT-201 planning calculation for supported Single, Married Filing Jointly, Head of Household, and Qualifying Surviving Spouse returns. Starts from federal AGI, applies exact New York additions/subtractions, official 2025 standard or exact completed itemized deduction, $1,000 dependent exemptions, the official $50-band state tax table below $65,000 and rate schedule through NYAGI $107,650, exact official line-39 worksheet tax above that AGI threshold, household credit, enhanced 2025 Empire State child credit, standard 30% New York EIC less household credit, exact supported credits/payments, optional full-year NYC resident tax/credits, exact full-year Yonkers surcharge, MCTMT, and explicit blocking for part-year/nonresident, MFS, filing-status exceptions, mixed/part-year local residence, Yonkers nonresident earnings, other-state credit, noncustodial EIC, amended, and other material special cases.",
    },

    RI: {
      name: "Rhode Island",
      type: "graduated",
      specialCalculator: "RI_2025",
      verified2025Core: true,
      note: "2025 Rhode Island full-year resident RI-1040 planning calculation for supported Single, Married Filing Jointly, Head of Household, and Qualifying Widow(er) returns. Starts from federal AGI plus the exact signed Schedule M net modification, applies the official 2025 standard deduction and $5,100 exemption with the $254,250 phaseout worksheets, uses the mandatory official $50-band tax table below $100,000 and the 2025 tax computation schedule at $100,000 or more, calculates the 25% allowable federal child/dependent-care credit and 16% Rhode Island EIC, accepts exact completed-return amounts for other-state/RI credits, recapture, use tax, health mandate penalty, property-tax relief, lead-paint credit, withholding/payments, contributions, and underpayment interest, and blocks part-year/nonresident, MFS, filing-status exceptions, amended, and other material special cases rather than guessing.",
    },

    VT: {
      name: "Vermont",
      type: "graduated",
      specialCalculator: "VT_2025",
      verified2025Core: true,
      note: "2025 Vermont full-year resident IN-111 planning calculation. Starts from federal AGI plus exact Schedule IN-112 net modifications, applies the official 2025 standard deduction plus exact federal standard-deduction-box additions and $5,300 personal exemptions, uses the official $100-band Vermont tax table below $75,000 and 2025 rate schedules above that threshold, applies the 3% minimum-tax rule when federal AGI exceeds $150,000, exact Schedule IN-119/IN-117 nonrefundable items, charitable-contribution credit, exact Child Care Contribution/use tax/payments, 72% child/dependent-care credit, 2025 Child Tax Credit phaseout, the 38%/100% Vermont EITC rule, the new 2025 Veteran Tax Credit, and explicit blocking for part-year/nonresident, IN-113 income adjustments, recomputed/civil-union filing exceptions, renter-credit-to-income-tax interactions, amended, and other material special cases rather than guessing.",
    },

    DC: {
      name: "District of Columbia",
      type: "graduated",
      specialCalculator: "DC_2025",
      verified2025Core: true,
      note: "2025 District of Columbia full-year resident D-40 planning calculation. Starts from federal AGI, applies supported D-40 additions/subtractions, the District's new 2025 standard deduction or exact Calculation F itemized deduction, the official $50-band tax table through $100,000 and Calculation I rate schedule above $100,000, child/dependent-care credit, DC EITC, Schedule H and exact Schedule U refundable/nonrefundable amounts, Health Care Shared Responsibility payment, withholding/payments, and explicit blocking for part-year/nonresident, MFS/combined-separate special computations, other-jurisdiction credit, D-30/unincorporated-business, noncustodial EITC, amended, and other material special cases rather than guessing.",
    },

    CO: {
      name: "Colorado",
      type: "flat",
      flatRate: 0.044,
      specialCalculator: "CO_2025",
      verified2025Core: true,
      note: "2025 Colorado full-year resident DR 0104 planning calculation using exact federal taxable income from the audited federal engine, exact Colorado additions/subtractions, the official 2025 Colorado tax table through $50,000 and 4.4% worksheet above $50,000, exact AMT/credit-recapture/DR 0619 repayment inputs, supported refundable credits including the standard 50% Colorado EITC, exact withholding/prepayments/TABOR/penalty inputs, and explicit blocking for DR 0104PN part-year/nonresident, credit for tax paid to another state, special DR 0104TN EITC cases, amended, and other material special cases.",
    },

    UT: {
      name: "Utah",
      type: "flat",
      flatRate: 0.045,
      specialCalculator: "UT_2025",
      verified2025Core: true,
      note: "2025 Utah full-year resident TC-40 planning calculation starting from federal AGI, using exact TC-40A additions/subtractions and federal deduction inputs, the 4.5% tax rate, Utah taxpayer tax credit and qualified-exempt-taxpayer worksheet, 2025 child tax credit, 20% Utah EITC, exact other credits/use tax/withholding/prepayments, and explicit blocking for TC-40B part-year/nonresident, other-state credit, special married-couple calculations, amended, and other material special cases.",
    },

    ID: {
      name: "Idaho",
      type: "flat",
      flatRate: 0.053,
      specialCalculator: "ID_2025",
      verified2025Core: true,
      note: "2025 Idaho full-year resident Form 40 planning calculation starting from federal AGI, using exact Form 39R additions/subtractions, exact Idaho deduction and federal Form 1040 Lines 13a/13b deduction inputs, the official 5.3% tax worksheet with filing-status zero-tax threshold, Idaho child tax credit, exact other credits/taxes/payments, and explicit blocking for Form 43 part-year/nonresident, other-state credit, Idaho NOL, claim-of-right, amended, and other material special cases.",
    },

    MT: {
      name: "Montana",
      type: "graduated",
      specialCalculator: "MT_2025",
      verified2025Core: true,
      note: "2025 Montana full-year resident Form 2 planning calculation starting from federal AGI, using exact Form 2 Line 2 federal deduction, exact Schedule I additions/subtractions, the $5,660 age-65 subtraction, the official 2025 ordinary-income and long-term-capital-gain rate structure, exact supported credits/payments/refund allocations, the standard 10% Montana EITC, and explicit blocking for Schedule II part-year/nonresident, other-state credit, EITC reduction worksheet, NOL/loss carryforward, amended, and other material special cases.",
    },

    ND: {
      name: "North Dakota",
      type: "graduated",
      specialCalculator: "ND_2025",
      verified2025Core: true,
      note: "2025 North Dakota full-year resident Form ND-1 planning calculation using exact signed Form ND-1 Line 1b federal taxable income, Schedule ND-1SA additions/subtractions, the official 2025 $50-band tax table below $100,000 and rate schedules at $100,000 or more, the MFJ marriage-penalty credit worksheet, exact supported credits/payments/refund allocations, and explicit blocking for ND-1NR part-year/nonresident, ND-1CR other-state credit, ND-1FA farm-income averaging, ND-1CS sold-research-credit tax computation, amended/NOL, and other material special cases.",
    },

    NM: {
      name: "New Mexico",
      type: "graduated",
      specialCalculator: "NM_2025",
      verified2025Core: true,
      note: "2025 New Mexico full-year resident PIT-1 planning calculation starting from federal AGI, using exact PIT-1/PIT-ADJ deduction and adjustment inputs, the dependent and low-/middle-income exemptions, the official 2025 $100-band rate table through $100,000 and high-income computation table above $100,000, exact PIT-CR/PIT-RC credits, the 25% Working Families Tax Credit, exact withholding/payments/penalties/refund allocations, and explicit blocking for PIT-B allocation, Schedule CC, lump-sum tax, other-state credit, amended, and other material special cases.",
    },

    CA: {
      name: "California",
      type: "graduated",
      specialCalculator: "CA_2025",
      verified2025Core: true,
      note: "2025 California full-year resident Form 540 planning calculation starting from federal AGI, using exact signed Schedule CA Line 14/16 adjustments, exact Form 540 Line 18 deduction, official 2025 tax table through $100,000 and rate schedules above $100,000, exact exemption counts and AGI-limited credits, automatic 1% Behavioral Health Services Tax above $1,000,000, exact supported credits/payments/use tax/ISR/refund allocations, and explicit blocking for Form 540NR, RDP/different filing-status, FTB 3800/3803, Schedule G-1/FTB 5870A, other-state credit, claim-of-right, amended, and other material special cases.",
    },

    OR: {
      name: "Oregon",
      type: "graduated",
      specialCalculator: "OR_2025",
      verified2025Core: true,
      note: "2025 Oregon full-year resident Form OR-40 planning calculation starting from federal AGI, using exact Oregon additions/subtractions and deduction, the official 2025 tax table below $50,000 and rate charts at $50,000 or more, the AGI-limited federal tax liability subtraction, exact exemption/standard/carryforward credits, the 2025 Oregon surplus kicker, supported payments/refundable credits, and explicit blocking for OR-40-N/P, RDP/different filing-status, alternate tax methods including OR-PTE/farm methods, other-state credit, ITIN EIC special cases, separate transit-tax filings, amended/NOL, and other material special cases.",
    },

    WA: {
      name: "Washington",
      type: "graduated",
      specialCalculator: "WA_2025",
      verified2025Core: true,
      note: "2025 Washington planning support for the state capital-gains excise tax and Working Families Tax Credit. Uses an exact taxpayer-entered Washington capital-gains amount after allocation/exempt-asset adjustments, the $278,000 standard deduction, exact constitutional/family-business deductions, the 2025 charitable-donation threshold/cap, the 7%/9.9% tiered rates, exact other-jurisdiction and B&O capital-gains credits, exact payments/penalty, and exact WFTC amount. MFS/RDP, incomplete allocation, and material special cases are blocked rather than guessed.",
    },

    HI: {
      name: "Hawaii",
      type: "graduated",
      specialCalculator: "HI_2025",
      verified2025Core: true,
      note: "2025 Hawaii full-year resident Form N-11 planning calculation starting from federal AGI, using exact Hawaii additions/subtractions, the 2025 standard deductions or an exact completed itemized deduction, exact $1,144 exemption-unit count, the official $50-band tax table below $100,000 and official rate schedules at $100,000 or more, exact nonrefundable/refundable credits and payments, and explicit blocking for N-15 part-year/nonresident, different Hawaii filing status/civil-union treatment, dependent standard-deduction cases, certified disability exemption, alternative capital-gains tax, PTE credit/adjustment, other-state credit, amended, and other material special cases.",
    },

    KS: {
      name: "Kansas",
      type: "graduated",
      specialCalculator: "KS_2025",
      verified2025Core: true,
      note: "2025 Kansas full-year resident K-40 planning calculation starting from federal AGI, using exact Schedule S Part A net modifications and exact K-40 deduction, the official 2025 Kansas tax table/rate schedule, 2025 exemption allowances, child/dependent-care credit, 17% Kansas EITC split between nonrefundable/refundable portions, exact withholding/payments/refund allocations, and explicit blocking for Schedule S Part B part-year/nonresident, other-state credit, separate homestead/property-tax refund claims, amended, and other material special cases.",
    },

    NE: {
      name: "Nebraska",
      type: "graduated",
      specialCalculator: "NE_2025",
      verified2025Core: true,
      note: "2025 Nebraska full-year resident Form 1040N planning calculation starting from federal AGI, using exact Nebraska deduction and Schedule I adjustment inputs, the official 2025 Tax Calculation Schedule, the $171 resident personal-exemption credit, the 29.6% Nebraska other-tax calculation, the federal-tax limit worksheet, exact credits/payments/use tax, the 10% Nebraska EITC, and explicit blocking for Schedule II other-state credit, Schedule III part-year/nonresident, NOL/EITC special cases, amended, and other material special cases.",
    },

    IA: {
      name: "Iowa",
      type: "flat",
      flatRate: 0.038,
      specialCalculator: "IA_2025",
      verified2025Core: true,
      note: "2025 Iowa full-year resident IA 1040 planning calculation starting from federal taxable income, applying exact IA 1040 Schedule 1 net modifications, the 3.8% flat rate, low-income exemption / alternate-tax / single-tax-reduction rules, Iowa exemption credits, exact nonrefundable/refundable credits and payments, exact school-district/EMS surtax rate, and explicit blocking for IA 126 part-year/nonresident, IA 130 out-of-state credit, amended, and other material special cases.",
    },

    MN: {
      name: "Minnesota",
      type: "graduated",
      specialCalculator: "MN_2025",
      verified2025Core: true,
      note: "2025 Minnesota full-year resident Form M1 planning calculation starting from federal AGI, using exact Form M1 additions/subtractions and completed credit/tax inputs, the official 2025 Minnesota standard-deduction and dependent-exemption phaseouts, official tax-table/rate-schedule method, and explicit blocking for M1NR, other-state-credit/reciprocity, short-period/nonresident-alien, amended, and other material special cases.",
    },

    WI: {
      name: "Wisconsin",
      type: "graduated",
      specialCalculator: "WI_2025",
      verified2025Core: true,
      note: "2025 Wisconsin full-year resident Form 1 planning calculation starting from federal AGI, using exact Schedule I/AD/SB adjustments, the official income-sensitive standard-deduction table and dependent worksheet, 2025 exemptions, official Form 1 tax-table/tax-computation method, exact nonrefundable and refundable credits, Wisconsin EIC, sales/use tax, payments and underpayment interest, and explicit blocking for part-year/nonresident, other-state-credit/reciprocity, short-period/U.S.-possessions, amended, and other material special cases.",
    },

    MO: {
      name: "Missouri",
      type: "graduated",
      specialCalculator: "MO_2025",
      verified2025Core: true,
      note: "2025 Missouri full-year resident MO-1040 planning calculation using federal AGI for non-combined filers, exact spouse-level Missouri adjusted gross income allocation for married filing combined returns, the official 2025 standard-deduction rules, direct MO-1040 federal-income-tax and pension/Social-Security deductions, the official graduated tax chart through 4.7%, the 20% Missouri Working Family Tax Credit when eligible, and explicit blocking for part-year/nonresident, resident other-state credit, enterprise/rural-zone modification, miscellaneous/property credits, and material other-tax/special cases.",
    },

    MI: {
      name: "Michigan",
      type: "flat",
      flatRate: 0.0425,
      specialCalculator: "MI_2025",
      verified2025Core: true,
      note: "2025 Michigan full-year resident MI-1040 planning calculation starting from federal AGI, automatically adding back the federal self-employment-tax deduction modeled by the federal engine, applying supported Michigan Schedule 1 additions/subtractions, 2025 exemption allowances, the 4.25% tax rate, the 30% Michigan EITC, use tax, supporting Michigan-separate filing when federal MFS, and explicit blocking for Michigan-joint-after-federal-MFS, Schedule NR, Form 4884/standard-or-senior deductions, 2025 PA 24 decoupling adjustments, Michigan city filing, other-state credit/allocation, separate refundable-credit claims, and other material special cases.",
    },

    WV: {
      name: "West Virginia",
      type: "graduated",
      specialCalculator: "WV_2025",
      verified2025Core: true,
      note: "2025 West Virginia full-year resident IT-140 planning calculation starting from federal AGI, applying Schedule M modifications, the 2025 Social Security subtraction, low-income earned-income exclusion, personal exemptions, the official tax-table/rate-schedule method, Family Tax Credit, child/dependent-care credit, use tax, and explicit blocking for part-year/nonresident, other-state-credit, refundable-property-credit, and other material special cases.",
    },

    VA: {
      name: "Virginia",
      type: "graduated",
      specialCalculator: "VA_2025",
      verified2025Core: true,
      note: "2025 Virginia full-year resident Form 760 planning calculation starting from federal AGI, using confirmed Virginia additions/subtractions, 2025 standard or Virginia itemized deductions, personal/age/blind exemptions, the official tax-rate schedule, supported low-income/EITC credit amounts, and explicit blocking for multi-state and material special-schedule cases.",
    },

    SC: {
      name: "South Carolina",
      type: "graduated",
      specialCalculator: "SC_2025",
      verified2025Core: true,
      note: "2025 South Carolina full-year resident SC1040 planning calculation starting from federal taxable income, using the official SC tax-table midpoint method, 2025 dependent deductions/exemptions, supported resident credits, and explicit blocking for material special schedules and multi-state cases.",
    },

    OK: {
      name: "Oklahoma",
      type: "graduated",
      specialCalculator: "OK_2025",
      verified2025Core: true,
      note: "2025 Oklahoma full-year resident Form 511 planning calculation using direct Oklahoma line 7/9 inputs, exact $50-band tax-table midpoint method through $99,999, the published $100,000+ computation, 2025 deductions/exemptions, Schedule 511-F child credit proration, Schedule 511-G EIC proration, and explicit blocking for material unsupported credits/additional-tax cases.",
    },

    NC: {
      name: "North Carolina",
      type: "flat",
      flatRate: 0.0425,
      deduction: {
        single: 12750,
        mfj: 25500,
        mfs: 12750,
        hoh: 19125,
        qw: 25500,
      },
      exemption: {
        single: 0,
        mfj: 0,
        mfs: 0,
        hoh: 0,
        qw: 0,
      },
      dependentExemption: 0,
      childDeduction: {
        countField: "ctcQualifyingChildren",
        schedules: {
          single: [
            { maxAGI: 20000, perChild: 3000 },
            { maxAGI: 30000, perChild: 2500 },
            { maxAGI: 40000, perChild: 2000 },
            { maxAGI: 50000, perChild: 1500 },
            { maxAGI: 60000, perChild: 1000 },
            { maxAGI: 70000, perChild: 500 },
            { maxAGI: null, perChild: 0 },
          ],
          mfs: [
            { maxAGI: 20000, perChild: 3000 },
            { maxAGI: 30000, perChild: 2500 },
            { maxAGI: 40000, perChild: 2000 },
            { maxAGI: 50000, perChild: 1500 },
            { maxAGI: 60000, perChild: 1000 },
            { maxAGI: 70000, perChild: 500 },
            { maxAGI: null, perChild: 0 },
          ],
          hoh: [
            { maxAGI: 30000, perChild: 3000 },
            { maxAGI: 45000, perChild: 2500 },
            { maxAGI: 60000, perChild: 2000 },
            { maxAGI: 75000, perChild: 1500 },
            { maxAGI: 90000, perChild: 1000 },
            { maxAGI: 105000, perChild: 500 },
            { maxAGI: null, perChild: 0 },
          ],
          mfj: [
            { maxAGI: 40000, perChild: 3000 },
            { maxAGI: 60000, perChild: 2500 },
            { maxAGI: 80000, perChild: 2000 },
            { maxAGI: 100000, perChild: 1500 },
            { maxAGI: 120000, perChild: 1000 },
            { maxAGI: 140000, perChild: 500 },
            { maxAGI: null, perChild: 0 },
          ],
          qw: [
            { maxAGI: 40000, perChild: 3000 },
            { maxAGI: 60000, perChild: 2500 },
            { maxAGI: 80000, perChild: 2000 },
            { maxAGI: 100000, perChild: 1500 },
            { maxAGI: 120000, perChild: 1000 },
            { maxAGI: 140000, perChild: 500 },
            { maxAGI: null, perChild: 0 },
          ],
        },
      },
      mfsSpouseItemizesField: "ncSpouseItemizes",
      verified2025Core: true,
    },

    GA: {
      name: "Georgia",
      type: "flat",
      flatRate: 0.0519,
      deduction: {
        single: 12000,
        mfj: 24000,
        mfs: 12000,
        hoh: 12000,
        qw: 12000,
      },
      exemption: {
        single: 0,
        mfj: 0,
        mfs: 0,
        hoh: 0,
        qw: 0,
      },
      dependentExemption: 4000,
      additionalDependentCountField: "gaUnbornDependents",
      verified2025Core: true,
      note: "Core 2025 Georgia estimate with material low-income and retirement cases guarded for additional detail.",
    },

    KY: {
      name: "Kentucky",
      type: "flat",
      flatRate: 0.04,
      deduction: {
        single: 3270,
        mfj: 3270,
        mfs: 3270,
        hoh: 3270,
        qw: 3270,
      },
      exemption: {
        single: 0,
        mfj: 0,
        mfs: 0,
        hoh: 0,
        qw: 0,
      },
      dependentExemption: 0,
      specialCalculator: "KY_2025",
      verified2025Core: true,
      note: "2025 Kentucky resident planning calculation with family-size, education, retirement, and personal-credit handling plus explicit guardrails for unsupported special items.",
    },

    MS: {
      name: "Mississippi",
      type: "graduated",
      specialCalculator: "MS_2025",
      verified2025Core: true,
      note: "2025 Mississippi resident planning calculation with filing-status exemptions, dependent/age/blind exemptions, deduction choice, retirement/Social Security subtraction input, and the $10,000 zero-rate band per taxpayer.",
    },
  },

  2026: {
    AZ: {
      name:     "Arizona",
      type:     "flat",
      flatRate: 0.025,
      deduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150, qw: 32200 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 0,
      dependentCredit: {
        under17: 125,
        age17Plus: 25,
        phaseOutThreshold: { single: 200000, mfs: 200000, hoh: 200000, mfj: 400000, qw: 400000 },
        reductionPer1000: 0.05,
      },
      planningRule: true,
    },
  },
};

// =============================================================================
// CONFIG ACCESSOR
// =============================================================================

function getConfiguredStateYears(stateCode) {
  const normalizedStateCode = String(stateCode || "").toUpperCase();
  const years = new Set();

  Object.entries(STATE_RULES).forEach(([year, rules]) => {
    if (rules?.[normalizedStateCode]) {
      years.add(Number(year));
    }
  });

  Object.entries(STATE_YEAR_OVERRIDES).forEach(([year, rules]) => {
    if (rules?.[normalizedStateCode]) {
      years.add(Number(year));
    }
  });

  return Array.from(years)
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => a - b);
}

function getStateSupport(stateCode, taxYear) {
  const requestedYear = Number(taxYear);
  const normalizedStateCode = String(stateCode || "").toUpperCase();

  const verifiedOverride =
    STATE_YEAR_OVERRIDES[requestedYear]?.[normalizedStateCode];

  if (verifiedOverride) {
    return {
      supported: true,
      stateCode: normalizedStateCode,
      stateName: verifiedOverride.name || normalizedStateCode,
      taxYear: requestedYear,
      ruleYear: requestedYear,
      exactYear: true,
      isYearFallback: false,
      supportLevel: verifiedOverride.planningRule
        ? "planning-verified"
        : "verified",
      stateTaxType: verifiedOverride.type || "unknown",
      verifiedNoIndividualIncomeTax:
        Boolean(verifiedOverride.verifiedNoIndividualIncomeTax),
      availableYears: getConfiguredStateYears(normalizedStateCode),
    };
  }

  const exactRule =
    STATE_RULES[requestedYear]?.[normalizedStateCode];

  if (exactRule) {
    return {
      supported: true,
      stateCode: normalizedStateCode,
      stateName: exactRule.name || normalizedStateCode,
      taxYear: requestedYear,
      ruleYear: requestedYear,
      exactYear: true,
      isYearFallback: false,
      supportLevel: "configured-exact-year",
      stateTaxType: exactRule.type || "unknown",
      verifiedNoIndividualIncomeTax: false,
      availableYears: getConfiguredStateYears(normalizedStateCode),
    };
  }

  const availableYears =
    getConfiguredStateYears(normalizedStateCode);

  const priorConfiguredYear =
    availableYears
      .filter((year) => year <= requestedYear)
      .sort((a, b) => b - a)[0] || null;

  const nextConfiguredYear =
    availableYears
      .filter((year) => year > requestedYear)
      .sort((a, b) => a - b)[0] || null;

  let stateName = normalizedStateCode;

  const knownYear =
    priorConfiguredYear ??
    nextConfiguredYear;

  if (knownYear !== null) {
    const knownRule =
      STATE_YEAR_OVERRIDES[knownYear]?.[normalizedStateCode] ||
      STATE_RULES[knownYear]?.[normalizedStateCode];

    stateName =
      knownRule?.name ||
      normalizedStateCode;
  }

  return {
    supported: false,
    stateCode: normalizedStateCode,
    stateName,
    taxYear: requestedYear,
    ruleYear: null,
    exactYear: false,
    isYearFallback: false,
    supportLevel: "unsupported-year",
    stateTaxType: null,
    verifiedNoIndividualIncomeTax: false,
    availableYears,
    priorConfiguredYear,
    nextConfiguredYear,
  };
}

function getStateRules(stateCode, taxYear) {
  const support =
    getStateSupport(stateCode, taxYear);

  if (!support.supported) {
    return {
      name: support.stateName,
      type: "unknown",
      ruleYear: null,
      isYearFallback: false,
      support,
    };
  }

  const rule =
    STATE_YEAR_OVERRIDES[support.taxYear]?.[support.stateCode] ||
    STATE_RULES[support.taxYear]?.[support.stateCode];

  return {
    ...rule,
    ruleYear: support.taxYear,
    isYearFallback: false,
    support,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function dollars(n) {
  return Math.round(n || 0);
}

// =============================================================================
// STEP 1 — LOAD STATE CONFIG
// =============================================================================

function loadStateConfig(stateCode, taxYear) {
  return getStateRules(stateCode.toUpperCase(), taxYear);
}

// =============================================================================
// STEP 2 — STATE TAXABLE INCOME
//
// stateTaxableIncome = max(0, federalAGI - stateDeduction - exemptions)
//
// stateDeduction  = state standard deduction by filing status (0 if none)
// exemptions      = personal exemption + (numberOfDependents * dependentExemption)
// =============================================================================

function computeStateChildDeduction(federalAGI, input, stateCfg) {
  const cfg = stateCfg?.childDeduction;
  if (!cfg) {
    return {
      qualifyingChildren: 0,
      perChild: 0,
      childDeduction: 0,
    };
  }

  const filingStatus = input?.filingStatus || "single";
  const count = Math.max(
    0,
    Math.trunc(
      Number(
        input?.[cfg.countField || "ctcQualifyingChildren"] || 0
      )
    )
  );

  const schedule =
    cfg.schedules?.[filingStatus] ||
    cfg.schedules?.single ||
    [];

  const agi = Math.max(0, Number(federalAGI || 0));
  const row =
    schedule.find(
      (item) =>
        item.maxAGI === null ||
        agi <= Number(item.maxAGI)
    ) || { perChild: 0 };

  const perChild = Math.max(
    0,
    Number(row.perChild || 0)
  );

  return {
    qualifyingChildren: count,
    perChild,
    childDeduction: dollars(count * perChild),
  };
}

function computeStateTaxableIncome(federalAGI, input, stateCfg) {
  const { filingStatus, numberOfDependents = 0 } = input;

  let deduction =
    (stateCfg.deduction &&
      stateCfg.deduction[filingStatus]) ||
    0;

  if (
    filingStatus === "mfs" &&
    stateCfg.mfsSpouseItemizesField &&
    input?.[stateCfg.mfsSpouseItemizesField] === true
  ) {
    deduction = 0;
  }

  const exemption =
    (stateCfg.exemption &&
      stateCfg.exemption[filingStatus]) ||
    0;
  const additionalDependentCount =
    stateCfg.additionalDependentCountField
      ? Math.max(
          0,
          Math.trunc(
            Number(
              input?.[
                stateCfg.additionalDependentCountField
              ] || 0
            )
          )
        )
      : 0;

  const dependentExemptionCount =
    Math.max(
      0,
      Number(numberOfDependents || 0)
    ) +
    additionalDependentCount;

  const depExempt =
    (stateCfg.dependentExemption || 0) *
    dependentExemptionCount;

  const childDeductionResult =
    computeStateChildDeduction(
      federalAGI,
      input,
      stateCfg
    );

  const childDeduction =
    childDeductionResult.childDeduction;

  const totalReductions =
    deduction +
    exemption +
    depExempt +
    childDeduction;

  const taxableIncome =
    Math.max(
      0,
      federalAGI - totalReductions
    );

  return {
    federalAGI: dollars(federalAGI),
    stateDeduction: dollars(deduction),
    stateExemption: dollars(exemption),
    dependentExemptionCount,
    additionalDependentCount,
    dependentExempt: dollars(depExempt),
    stateChildDeduction: dollars(childDeduction),
    childDeductionResult,
    totalReductions: dollars(totalReductions),
    stateTaxableIncome: dollars(taxableIncome),
  };
}

// =============================================================================
// ARIZONA DEPENDENT TAX CREDIT
//
// Arizona needs dependents split by age (<17 vs 17+). The current estimator
// has total dependents plus a narrower federal CTC child count, so the state
// engine does not guess. It applies the credit only when dependentsUnder17 is
// supplied explicitly.
// =============================================================================

function computeDependentTaxCredit(input, stateCfg, federalAGI, taxBeforeCredits) {
  const cfg = stateCfg?.dependentCredit;

  if (!cfg) {
    return {
      available: false,
      dataComplete: true,
      creditBeforePhaseOut: 0,
      phaseOutFactor: 1,
      allowedCredit: 0,
      taxAfterCredit: dollars(taxBeforeCredits),
    };
  }

  const totalDependents = Math.max(
    0,
    Math.trunc(Number(input?.numberOfDependents || 0))
  );

  const hasAgeSplit =
    input &&
    input.dependentsUnder17 !== undefined &&
    input.dependentsUnder17 !== null &&
    input.dependentsUnder17 !== "";

  if (!hasAgeSplit) {
    return {
      available: true,
      dataComplete: totalDependents === 0,
      creditBeforePhaseOut: 0,
      phaseOutFactor: 1,
      allowedCredit: 0,
      taxAfterCredit: dollars(taxBeforeCredits),
      needsDependentAgeSplit: totalDependents > 0,
    };
  }

  const under17 = Math.min(
    totalDependents,
    Math.max(0, Math.trunc(Number(input.dependentsUnder17 || 0)))
  );

  const age17Plus = Math.max(0, totalDependents - under17);

  const creditBeforePhaseOut =
    (under17 * Number(cfg.under17 || 0)) +
    (age17Plus * Number(cfg.age17Plus || 0));

  const filingStatus = input?.filingStatus || "single";
  const threshold =
    Number(cfg.phaseOutThreshold?.[filingStatus] ?? cfg.phaseOutThreshold?.single ?? Infinity);

  const excess = Math.max(0, Number(federalAGI || 0) - threshold);
  const phaseOutSteps = excess > 0 ? Math.ceil(excess / 1000) : 0;
  const phaseOutFactor = Math.max(
    0,
    1 - (phaseOutSteps * Number(cfg.reductionPer1000 || 0))
  );

  const phasedCredit = dollars(creditBeforePhaseOut * phaseOutFactor);
  const allowedCredit = Math.min(dollars(taxBeforeCredits), phasedCredit);

  return {
    available: true,
    dataComplete: true,
    totalDependents,
    dependentsUnder17: under17,
    dependentsAge17Plus: age17Plus,
    creditBeforePhaseOut: dollars(creditBeforePhaseOut),
    phaseOutThreshold: threshold,
    phaseOutSteps,
    phaseOutFactor,
    allowedCredit,
    taxAfterCredit: Math.max(0, dollars(taxBeforeCredits) - allowedCredit),
    needsDependentAgeSplit: false,
  };
}

// =============================================================================
// ALABAMA 2025 — SPECIAL FULL-YEAR RESIDENT PLANNING CALCULATOR
// =============================================================================

function getAlabama2025StandardDeduction(alabamaAGI, filingStatus) {
  const agi = Math.max(0, dollars(alabamaAGI));

  if (filingStatus === "mfj") {
    if (agi < 26000) return 8500;
    if (agi >= 35500) return 5000;
    const steps = Math.floor((agi - 26000) / 500) + 1;
    return 8500 - (steps * 175);
  }

  if (filingStatus === "mfs") {
    if (agi < 13000) return 4250;
    if (agi >= 17750) return 2500;
    const steps = Math.floor((agi - 13000) / 250) + 1;
    return 4250 - (steps * 88);
  }

  if (filingStatus === "hoh") {
    if (agi < 26000) return 5200;
    if (agi >= 35500) return 2500;
    const steps = Math.floor((agi - 26000) / 500) + 1;
    return 5200 - (steps * 135);
  }

  // Alabama Single schedule. Qualifying Surviving Spouse is blocked before
  // calculation because Alabama does not use the federal QSS status directly.
  if (agi < 26000) return 3000;
  if (agi >= 35500) return 2500;
  const steps = Math.floor((agi - 26000) / 500) + 1;
  return 3000 - (steps * 25);
}

function getAlabama2025PersonalExemption(filingStatus) {
  if (filingStatus === "mfj" || filingStatus === "hoh") {
    return 3000;
  }
  return 1500;
}

function getAlabama2025DependentExemptionPerPerson(alabamaAGI) {
  const agi = Math.max(0, dollars(alabamaAGI));
  if (agi <= 50000) return 1000;
  if (agi <= 100000) return 500;
  return 300;
}

function computeAlabama2025RateTaxAtIncome(income, filingStatus) {
  const amount = Math.max(0, Number(income || 0));

  if (filingStatus === "mfj") {
    if (amount <= 1000) return amount * 0.02;
    if (amount <= 6000) return 20 + ((amount - 1000) * 0.04);
    return 220 + ((amount - 6000) * 0.05);
  }

  if (amount <= 500) return amount * 0.02;
  if (amount <= 3000) return 10 + ((amount - 500) * 0.04);
  return 110 + ((amount - 3000) * 0.05);
}

function computeAlabama2025TaxTable(taxableIncome, filingStatus) {
  const taxable = Math.max(0, dollars(taxableIncome));

  // The official 2025 Form 40 tax table has two special lowest bands.
  if (taxable < 50) return 0;
  if (taxable < 100) return 1;

  // From $100 through $99,999, the official table uses $100 income bands.
  // Each published amount equals the statutory tax at the midpoint of the band,
  // rounded to the nearest whole dollar.
  if (taxable < 100000) {
    const bandStart = Math.floor(taxable / 100) * 100;
    const midpoint = bandStart + 50;
    return dollars(
      computeAlabama2025RateTaxAtIncome(
        midpoint,
        filingStatus
      )
    );
  }

  // The Form 40 worksheet for taxable income at/above $100,000 continues at 5%.
  // Its published $100,000 table bases are $4,958 for Single/MFS/HOF and
  // $4,918 for MFJ.
  const base = filingStatus === "mfj" ? 4918 : 4958;
  return dollars(base + ((taxable - 100000) * 0.05));
}

function computeAlabama2025Tax(input, federalAGI, federalSummary = {}) {
  // The current federal engine's only modeled above-line adjustment is the
  // deductible portion of self-employment tax. Alabama does not use that as an
  // AGI adjustment, so add it back before applying Alabama-specific exclusions.
  const federalSeAboveLineDeduction = Math.max(
    0,
    Number(federalSummary?.seAboveLineDeduction || 0)
  );
  const exemptIncome = Math.max(
    0,
    Number(input?.alExemptIncome || 0)
  );
  const alabamaAGI = Math.max(
    0,
    Number(federalAGI || 0) +
      federalSeAboveLineDeduction -
      exemptIncome
  );

  const standardDeduction =
    getAlabama2025StandardDeduction(
      alabamaAGI,
      input.filingStatus
    );
  const itemizedDeduction = Math.max(
    0,
    Number(input?.alItemizedDeductions || 0)
  );
  const deduction = Math.max(
    standardDeduction,
    itemizedDeduction
  );

  const personalExemption =
    getAlabama2025PersonalExemption(
      input.filingStatus
    );
  const qualifyingDependents = Math.max(
    0,
    Math.trunc(Number(input?.alQualifyingDependents || 0))
  );
  const dependentExemptionPerPerson =
    getAlabama2025DependentExemptionPerPerson(
      alabamaAGI
    );
  const dependentExemption =
    qualifyingDependents *
    dependentExemptionPerPerson;

  const federalIncomeTaxDeduction = Math.max(
    0,
    Number(input?.alFederalIncomeTaxDeduction || 0)
  );

  const stateTaxableIncome = Math.max(
    0,
    alabamaAGI -
      deduction -
      federalIncomeTaxDeduction -
      personalExemption -
      dependentExemption
  );

  const stateTax = computeAlabama2025TaxTable(
    stateTaxableIncome,
    input.filingStatus
  );
  const stateWithheld = dollars(
    input.stateWithheld || 0
  );
  const estimatedTaxPayments = dollars(
    input.alEstimatedTaxPayments || 0
  );
  const totalStatePayments = dollars(
    stateWithheld + estimatedTaxPayments
  );
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAGI: dollars(federalAGI),
      federalSeAboveLineDeduction: dollars(
        federalSeAboveLineDeduction
      ),
      exemptIncome: dollars(exemptIncome),
      alabamaAGI: dollars(alabamaAGI),
      standardDeduction: dollars(standardDeduction),
      itemizedDeduction: dollars(itemizedDeduction),
      deductionUsed: dollars(deduction),
      federalIncomeTaxDeduction: dollars(
        federalIncomeTaxDeduction
      ),
      personalExemption: dollars(personalExemption),
      qualifyingDependents,
      dependentExemptionPerPerson: dollars(
        dependentExemptionPerPerson
      ),
      dependentExemption: dollars(dependentExemption),
      stateTaxableIncome: dollars(stateTaxableIncome),
    },
    stateTaxBeforeCredits: stateTax,
    stateTax,
    stateWithheld,
    estimatedTaxPayments,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// OKLAHOMA 2025 — SPECIAL FULL-YEAR RESIDENT FORM 511 CALCULATOR
// =============================================================================

function getOklahoma2025StandardDeduction(filingStatus) {
  if (filingStatus === "mfj" || filingStatus === "qw") return 12700;
  if (filingStatus === "hoh") return 9350;
  return 6350;
}

function computeIndiana2025Tax(input, federalAGI) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAdjustedGrossIncome = dollars(federalAGI || 0);
  const totalAddbacks = Math.max(0, dollars(input?.inTotalAddbacks || 0));
  const totalDeductions = Math.max(0, dollars(input?.inTotalDeductions || 0));
  const indianaAdjustedGrossIncome = Math.max(
    0,
    dollars(federalAdjustedGrossIncome + totalAddbacks - totalDeductions)
  );

  const dependentCount = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  const basePersonalExemption = filingStatus === "mfj" ? 2000 : 1000;
  const dependentExemption = dollars(dependentCount * 1000);

  const qualifyingChildCount = Math.max(0, Math.trunc(Number(input?.inAdditionalDependentChildCount || 0)));
  const firstYearChildCount = Math.max(0, Math.trunc(Number(input?.inFirstYearAdditionalChildCount || 0)));
  const standardAdditionalChildCount = Math.max(0, qualifyingChildCount - firstYearChildCount);
  const additionalDependentChildExemption = dollars(
    standardAdditionalChildCount * 1500 + firstYearChildCount * 3000
  );

  const adoptedChildCount = Math.max(0, Math.trunc(Number(input?.inAdoptedDependentCount || 0)));
  const adoptedChildExemption = dollars(adoptedChildCount * 3000);

  const taxpayerAge65 = Number(input?.age || 0) >= 65;
  const spouseIncluded = filingStatus === "mfj";
  const spouseAge65 = spouseIncluded && Number(input?.spouseAge || 0) >= 65;
  const taxpayerBlind = input?.inTaxpayerBlind === true;
  const spouseBlind = spouseIncluded && input?.inSpouseBlind === true;
  const ageBlindBoxCount =
    (taxpayerAge65 ? 1 : 0) +
    (spouseAge65 ? 1 : 0) +
    (taxpayerBlind ? 1 : 0) +
    (spouseBlind ? 1 : 0);
  const ageBlindExemption = dollars(ageBlindBoxCount * 1000);

  const specialAgeThreshold = filingStatus === "mfs" ? 20000 : 40000;
  const specialAgeCount = federalAdjustedGrossIncome < specialAgeThreshold
    ? (taxpayerAge65 ? 1 : 0) + (spouseAge65 ? 1 : 0)
    : 0;
  const specialAgeExemption = dollars(specialAgeCount * 500);

  const totalExemptions = dollars(
    basePersonalExemption +
    dependentExemption +
    additionalDependentChildExemption +
    adoptedChildExemption +
    ageBlindExemption +
    specialAgeExemption
  );

  const stateTaxableIncome = Math.max(0, dollars(indianaAdjustedGrossIncome - totalExemptions));
  const stateTaxBeforeCredits = dollars(stateTaxableIncome * 0.03);
  const countyTax = Math.max(0, dollars(input?.inCountyTax || 0));
  const useTax = input?.inHasUseTax === true ? Math.max(0, dollars(input?.inUseTax || 0)) : 0;
  const stateTax = dollars(stateTaxBeforeCredits + countyTax + useTax);

  const indianaEITC = input?.inClaimedFederalEIC === true
    ? dollars(Math.max(0, Number(input?.inFederalEICAmount || 0)) * 0.10)
    : 0;
  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const countyWithheld = Math.max(0, dollars(input?.inCountyWithheld || 0));
  const estimatedAndExtensionPayments = Math.max(0, dollars(input?.inEstimatedAndExtensionPayments || 0));
  const totalStatePayments = dollars(
    stateWithheld + countyWithheld + estimatedAndExtensionPayments + indianaEITC
  );
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      totalAddbacks,
      totalDeductions,
      indianaAdjustedGrossIncome,
      basePersonalExemption,
      dependentCount,
      dependentExemption,
      qualifyingChildCount,
      firstYearChildCount,
      standardAdditionalChildCount,
      additionalDependentChildExemption,
      adoptedChildCount,
      adoptedChildExemption,
      taxpayerAge65,
      spouseAge65,
      taxpayerBlind,
      spouseBlind,
      ageBlindBoxCount,
      ageBlindExemption,
      specialAgeThreshold,
      specialAgeCount,
      specialAgeExemption,
      totalExemptions,
      stateTaxableIncome,
    },
    stateTaxBeforeCredits,
    countyTax,
    useTax,
    stateTax,
    indianaEITC,
    stateWithheld,
    countyWithheld,
    estimatedAndExtensionPayments,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function getMissouri2025StandardDeduction(input) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const canBeClaimed = input?.canBeClaimedAsDependent === true;
  const baseByStatus = {
    single: 15750,
    mfj: 31500,
    mfs: 15750,
    hoh: 23625,
    qw: 31500,
  };

  let base = baseByStatus[filingStatus] ?? baseByStatus.single;
  if (canBeClaimed) {
    const earnedIncome = Math.max(0, dollars(input?.moDependentEarnedIncome || 0));
    base = Math.min(15750, Math.max(1350, 450 + earnedIncome));
  }

  const additionalPerCondition = ["mfj", "mfs", "qw"].includes(filingStatus) ? 1600 : 2000;
  let conditions = 0;
  if (Number(input?.age || 0) >= 65) conditions += 1;
  if (input?.moTaxpayerBlind === true) conditions += 1;
  if (filingStatus === "mfj") {
    if (Number(input?.spouseAge || 0) >= 65) conditions += 1;
    if (input?.moSpouseBlind === true) conditions += 1;
  }

  return dollars(base + conditions * additionalPerCondition);
}

function computeMissouri2025TaxChart(taxableIncome) {
  const taxable = Math.max(0, dollars(taxableIncome || 0));
  let rawTax = 0;

  if (taxable <= 1313) rawTax = 0;
  else if (taxable <= 2626) rawTax = (taxable - 1313) * 0.02;
  else if (taxable <= 3939) rawTax = 26 + (taxable - 2626) * 0.025;
  else if (taxable <= 5252) rawTax = 59 + (taxable - 3939) * 0.03;
  else if (taxable <= 6565) rawTax = 98 + (taxable - 5252) * 0.035;
  else if (taxable <= 7878) rawTax = 144 + (taxable - 6565) * 0.04;
  else if (taxable <= 9191) rawTax = 197 + (taxable - 7878) * 0.045;
  else rawTax = 256 + (taxable - 9191) * 0.047;

  return Math.max(0, Math.round(rawTax));
}

function computeMissouri2025Tax(input, federalAGI) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAdjustedGrossIncome = dollars(federalAGI || 0);
  const isCombined = filingStatus === "mfj";

  let primaryMissouriAdjustedGrossIncome = 0;
  let spouseMissouriAdjustedGrossIncome = 0;
  let totalAdditions = 0;
  let totalSubtractions = 0;

  if (isCombined) {
    primaryMissouriAdjustedGrossIncome = dollars(input?.moPrimaryAdjustedGrossIncome || 0);
    spouseMissouriAdjustedGrossIncome = dollars(input?.moSpouseAdjustedGrossIncome || 0);
  } else {
    const missouriStartingFagi = Math.max(0, federalAdjustedGrossIncome);
    totalAdditions = Math.max(0, dollars(input?.moTotalAdditions || 0));
    totalSubtractions = Math.max(0, dollars(input?.moTotalSubtractions || 0));
    primaryMissouriAdjustedGrossIncome = dollars(
      missouriStartingFagi + totalAdditions - totalSubtractions
    );
  }

  const totalMissouriAdjustedGrossIncome = dollars(
    primaryMissouriAdjustedGrossIncome + spouseMissouriAdjustedGrossIncome
  );

  let primaryIncomePercentage = 100;
  let spouseIncomePercentage = 0;
  if (isCombined) {
    if (primaryMissouriAdjustedGrossIncome <= 0 && spouseMissouriAdjustedGrossIncome > 0) {
      primaryIncomePercentage = 0;
      spouseIncomePercentage = 100;
    } else if (spouseMissouriAdjustedGrossIncome <= 0 && primaryMissouriAdjustedGrossIncome > 0) {
      primaryIncomePercentage = 100;
      spouseIncomePercentage = 0;
    } else if (
      primaryMissouriAdjustedGrossIncome > 0 &&
      spouseMissouriAdjustedGrossIncome > 0 &&
      totalMissouriAdjustedGrossIncome > 0
    ) {
      primaryIncomePercentage = Math.max(
        0,
        Math.min(100, Math.round((primaryMissouriAdjustedGrossIncome / totalMissouriAdjustedGrossIncome) * 100))
      );
      spouseIncomePercentage = 100 - primaryIncomePercentage;
    } else {
      primaryIncomePercentage = 100;
      spouseIncomePercentage = 0;
    }
  }

  const pensionSocialSecurityExemption = Math.max(
    0,
    dollars(input?.moPensionSocialSecurityExemption || 0)
  );
  const federalIncomeTaxDeduction = Math.max(
    0,
    dollars(input?.moFederalIncomeTaxDeduction || 0)
  );
  const deductionChoice = String(input?.moDeductionChoice || "standard").toLowerCase();
  const standardOrItemizedDeduction = deductionChoice === "itemized"
    ? Math.max(0, dollars(input?.moItemizedDeductions || 0))
    : getMissouri2025StandardDeduction(input);
  const headOrWidowAdditionalExemption = ["hoh", "qw"].includes(filingStatus) ? 1400 : 0;
  const otherDeductions = Math.max(0, dollars(input?.moOtherDeductions || 0));

  const totalDeductions = dollars(
    pensionSocialSecurityExemption +
    federalIncomeTaxDeduction +
    standardOrItemizedDeduction +
    headOrWidowAdditionalExemption +
    otherDeductions
  );

  const subtotalAfterDeductions = Math.max(
    0,
    dollars(totalMissouriAdjustedGrossIncome - totalDeductions)
  );

  let primaryTaxableIncome = subtotalAfterDeductions;
  let spouseTaxableIncome = 0;
  if (isCombined) {
    primaryTaxableIncome = Math.max(
      0,
      Math.round(subtotalAfterDeductions * (primaryIncomePercentage / 100))
    );
    spouseTaxableIncome = Math.max(0, dollars(subtotalAfterDeductions - primaryTaxableIncome));
  }

  const primaryTax = computeMissouri2025TaxChart(primaryTaxableIncome);
  const spouseTax = isCombined ? computeMissouri2025TaxChart(spouseTaxableIncome) : 0;
  const stateTaxBeforeCredits = dollars(primaryTax + spouseTax);
  const stateTax = stateTaxBeforeCredits;

  const potentiallyEligibleForWftc =
    input?.moClaimedFederalEIC === true &&
    ["single", "mfj", "hoh", "qw"].includes(filingStatus) &&
    input?.canBeClaimedAsDependent !== true &&
    input?.moWftcInvestmentIncomeOver4400 !== true &&
    input?.moWftcChildInfoComplete === true;

  const requestedWorkingFamilyTaxCredit = potentiallyEligibleForWftc
    ? Math.max(0, Math.round(Number(input?.moFederalEICAmount || 0) * 0.20))
    : 0;
  const missouriWorkingFamilyTaxCredit = Math.min(
    requestedWorkingFamilyTaxCredit,
    stateTaxBeforeCredits
  );

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const estimatedTaxPayments = Math.max(0, dollars(input?.moEstimatedTaxPayments || 0));
  const otherPayments = Math.max(0, dollars(input?.moOtherPayments || 0));
  const extensionPayments = Math.max(0, dollars(input?.moExtensionPayments || 0));
  const totalStatePayments = dollars(
    stateWithheld +
    estimatedTaxPayments +
    otherPayments +
    extensionPayments +
    missouriWorkingFamilyTaxCredit
  );
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      isCombined,
      totalAdditions,
      totalSubtractions,
      primaryMissouriAdjustedGrossIncome,
      spouseMissouriAdjustedGrossIncome,
      totalMissouriAdjustedGrossIncome,
      primaryIncomePercentage,
      spouseIncomePercentage,
      pensionSocialSecurityExemption,
      federalIncomeTaxDeduction,
      deductionChoice,
      standardOrItemizedDeduction,
      headOrWidowAdditionalExemption,
      otherDeductions,
      totalDeductions,
      subtotalAfterDeductions,
      primaryTaxableIncome,
      spouseTaxableIncome,
      stateTaxableIncome: dollars(primaryTaxableIncome + spouseTaxableIncome),
    },
    primaryTax,
    spouseTax,
    stateTaxBeforeCredits,
    stateTax,
    requestedWorkingFamilyTaxCredit,
    missouriWorkingFamilyTaxCredit,
    stateWithheld,
    estimatedTaxPayments,
    otherPayments,
    extensionPayments,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function computeIllinois2025ExemptionAllowance(input, federalAGI, baseIncome) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAdjustedGrossIncome = dollars(federalAGI || 0);
  const illinoisBaseIncome = Math.max(0, dollars(baseIncome || 0));
  const highIncomeThreshold = filingStatus === "mfj" ? 500000 : 250000;
  if (federalAdjustedGrossIncome > highIncomeThreshold) {
    return {
      personalExemption: 0,
      ageExemption: 0,
      blindExemption: 0,
      dependentExemption: 0,
      totalExemption: 0,
      highIncomeExemptionDisallowance: true,
    };
  }

  const taxpayerCanBeClaimed = input?.canBeClaimedAsDependent === true;
  let personalExemption = 0;
  if (filingStatus === "mfj") {
    const spouseCanBeClaimed = input?.ilSpouseCanBeClaimedAsDependent === true;
    const claimedCount = (taxpayerCanBeClaimed ? 1 : 0) + (spouseCanBeClaimed ? 1 : 0);
    if (claimedCount === 0) personalExemption = 5700;
    else if (claimedCount === 1) personalExemption = illinoisBaseIncome <= 2850 ? 5700 : 2850;
    else personalExemption = illinoisBaseIncome <= 5700 ? 5700 : 0;
  } else {
    personalExemption = taxpayerCanBeClaimed && illinoisBaseIncome > 2850 ? 0 : 2850;
  }

  let ageCount = Number(input?.age || 0) >= 65 ? 1 : 0;
  let blindCount = input?.ilTaxpayerBlind === true ? 1 : 0;
  if (filingStatus === "mfj") {
    if (Number(input?.spouseAge || 0) >= 65) ageCount += 1;
    if (input?.ilSpouseBlind === true) blindCount += 1;
  }
  const ageExemption = ageCount * 1000;
  const blindExemption = blindCount * 1000;
  const dependentCount = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  const dependentExemption = dependentCount * 2850;
  const totalExemption = dollars(
    personalExemption + ageExemption + blindExemption + dependentExemption
  );

  return {
    personalExemption,
    ageExemption,
    blindExemption,
    dependentExemption,
    totalExemption,
    highIncomeExemptionDisallowance: false,
  };
}

function computeIllinois2025Tax(input, federalAGI) {
  const federalAdjustedGrossIncome = dollars(federalAGI || 0);
  const totalAdditions = Math.max(0, dollars(input?.ilTotalAdditions || 0));
  const retirementSocialSecuritySubtraction = Math.max(
    0,
    dollars(input?.ilRetirementSocialSecuritySubtraction || 0)
  );
  const illinoisIncomeTaxOverpaymentSubtraction = Math.max(
    0,
    dollars(input?.ilIllinoisIncomeTaxOverpaymentSubtraction || 0)
  );
  const otherSubtractions = Math.max(0, dollars(input?.ilOtherSubtractions || 0));
  const totalSubtractions = dollars(
    retirementSocialSecuritySubtraction +
    illinoisIncomeTaxOverpaymentSubtraction +
    otherSubtractions
  );
  const illinoisBaseIncome = Math.max(
    0,
    dollars(federalAdjustedGrossIncome + totalAdditions - totalSubtractions)
  );

  const exemption = computeIllinois2025ExemptionAllowance(
    input,
    federalAdjustedGrossIncome,
    illinoisBaseIncome
  );
  const stateTaxableIncome = Math.max(
    0,
    dollars(illinoisBaseIncome - exemption.totalExemption)
  );
  const incomeTax = Math.max(0, Math.round(stateTaxableIncome * 0.0495));
  const investmentCreditRecapture = Math.max(
    0,
    dollars(input?.ilInvestmentCreditRecapture || 0)
  );
  const totalIncomeTax = dollars(incomeTax + investmentCreditRecapture);

  const scheduleICRCredit = Math.max(0, dollars(input?.ilScheduleICRCredit || 0));
  const schedule1299CCredit = Math.max(0, dollars(input?.ilSchedule1299CCredit || 0));
  const requestedNonrefundableCredits = dollars(scheduleICRCredit + schedule1299CCredit);
  const totalNonrefundableCredits = Math.min(totalIncomeTax, requestedNonrefundableCredits);
  const taxAfterNonrefundableCredits = dollars(totalIncomeTax - totalNonrefundableCredits);

  const householdEmploymentTax = Math.max(0, dollars(input?.ilHouseholdEmploymentTax || 0));
  const useTax = Math.max(0, dollars(input?.ilUseTax || 0));
  const stateTax = dollars(taxAfterNonrefundableCredits + householdEmploymentTax + useTax);

  const claimedFederalEITC = input?.ilClaimedFederalEITC === true;
  const illinoisEITC = claimedFederalEITC
    ? Math.max(0, Math.round(Number(input?.ilFederalEITCAmount || 0) * 0.20))
    : 0;
  const illinoisChildTaxCredit =
    illinoisEITC > 0 && input?.ilHasDependentChildUnder12 === true
      ? Math.max(0, Math.round(illinoisEITC * 0.40))
      : 0;

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const estimatedPayments = Math.max(0, dollars(input?.ilEstimatedPayments || 0));
  const passThroughWithholding = Math.max(0, dollars(input?.ilPassThroughWithholding || 0));
  const passThroughEntityTaxCredit = Math.max(
    0,
    dollars(input?.ilPassThroughEntityTaxCredit || 0)
  );
  const totalStatePayments = dollars(
    stateWithheld +
    estimatedPayments +
    passThroughWithholding +
    passThroughEntityTaxCredit +
    illinoisEITC +
    illinoisChildTaxCredit
  );
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      totalAdditions,
      retirementSocialSecuritySubtraction,
      illinoisIncomeTaxOverpaymentSubtraction,
      otherSubtractions,
      totalSubtractions,
      illinoisBaseIncome,
      ...exemption,
      stateTaxableIncome,
    },
    incomeTax,
    investmentCreditRecapture,
    totalIncomeTax,
    scheduleICRCredit,
    schedule1299CCredit,
    requestedNonrefundableCredits,
    totalNonrefundableCredits,
    taxAfterNonrefundableCredits,
    householdEmploymentTax,
    useTax,
    stateTax,
    illinoisEITC,
    illinoisChildTaxCredit,
    stateWithheld,
    estimatedPayments,
    passThroughWithholding,
    passThroughEntityTaxCredit,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function getOhio2025ExemptionPerPerson(modifiedAdjustedGrossIncome) {
  const magi = dollars(modifiedAdjustedGrossIncome || 0);
  if (magi <= 40000) return 2400;
  if (magi <= 80000) return 2150;
  if (magi <= 749999) return 1900;
  return 0;
}

function computeOhio2025NonbusinessTax(taxableNonbusinessIncome) {
  const income = Math.max(0, dollars(taxableNonbusinessIncome || 0));
  if (income <= 26050) return 0;
  if (income <= 100000) {
    return Math.max(0, Math.round(342 + ((income - 26050) * 0.0275)));
  }
  return Math.max(0, Math.round(2394.32 + ((income - 100000) * 0.03125)));
}

function computeOhio2025Tax(input, federalAGI) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAdjustedGrossIncome = dollars(federalAGI || 0);
  const totalAdditions = Math.max(0, dollars(input?.ohTotalAdditions || 0));
  const otherDeductionsExcludingBusinessIncomeDeduction = Math.max(
    0,
    dollars(input?.ohOtherDeductionsExcludingBusinessIncomeDeduction || 0)
  );

  // Ohio Schedule of Business Income, Part 2: line 11 is the lesser of
  // total business income (line 10) or federal AGI (IT 1040 line 1), but
  // zero if that result is negative. The 2025 deduction cap is $250,000
  // except Married Filing Separately, where it is $125,000.
  const scheduleBusinessIncomeTotal = dollars(input?.ohScheduleBusinessIncomeTotal || 0);
  const businessIncomeLine11 = Math.max(
    0,
    Math.min(scheduleBusinessIncomeTotal, federalAdjustedGrossIncome)
  );
  const businessIncomeDeductionCap = filingStatus === "mfs" ? 125000 : 250000;
  const businessIncomeDeduction = Math.min(
    businessIncomeLine11,
    businessIncomeDeductionCap
  );

  const totalDeductions = dollars(
    otherDeductionsExcludingBusinessIncomeDeduction + businessIncomeDeduction
  );
  const ohioAdjustedGrossIncome = dollars(
    federalAdjustedGrossIncome + totalAdditions - totalDeductions
  );
  const modifiedAdjustedGrossIncome = dollars(
    ohioAdjustedGrossIncome + businessIncomeDeduction
  );

  const primaryExemptionCount = input?.canBeClaimedAsDependent === true ? 0 : 1;
  const spouseExemptionCount =
    filingStatus === "mfj" && input?.ohSpouseCanBeClaimedAsDependent !== true ? 1 : 0;
  const dependentExemptionCount = Math.max(
    0,
    Math.trunc(Number(input?.numberOfDependents || 0))
  );
  const exemptionCount =
    primaryExemptionCount + spouseExemptionCount + dependentExemptionCount;
  const exemptionPerPerson = getOhio2025ExemptionPerPerson(
    modifiedAdjustedGrossIncome
  );
  const exemptionAmount = dollars(exemptionCount * exemptionPerPerson);

  const ohioIncomeTaxBase = Math.max(
    0,
    dollars(ohioAdjustedGrossIncome - exemptionAmount)
  );

  // Schedule of Business Income Part 3, lines 14-16.
  const businessIncomeAfterDeduction = Math.max(
    0,
    dollars(businessIncomeLine11 - businessIncomeDeduction)
  );
  const taxableBusinessIncome = Math.min(
    businessIncomeAfterDeduction,
    ohioIncomeTaxBase
  );
  const taxableNonbusinessIncome = Math.max(
    0,
    dollars(ohioIncomeTaxBase - taxableBusinessIncome)
  );
  const nonbusinessIncomeTax = computeOhio2025NonbusinessTax(
    taxableNonbusinessIncome
  );
  const businessIncomeTax = Math.max(
    0,
    Math.round(taxableBusinessIncome * 0.03)
  );
  const incomeTaxBeforeCredits = dollars(
    nonbusinessIncomeTax + businessIncomeTax
  );

  const requestedNonrefundableCredits = Math.max(
    0,
    dollars(input?.ohNonrefundableCredits || 0)
  );
  const nonrefundableCredits = Math.min(
    incomeTaxBeforeCredits,
    requestedNonrefundableCredits
  );
  const taxAfterNonrefundableCredits = dollars(
    incomeTaxBeforeCredits - nonrefundableCredits
  );
  const interestPenalty = Math.max(0, dollars(input?.ohInterestPenalty || 0));
  const useTax = Math.max(0, dollars(input?.ohUseTax || 0));
  const ohioTaxLiability = dollars(
    taxAfterNonrefundableCredits + interestPenalty + useTax
  );

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const estimatedAndOtherPayments = Math.max(
    0,
    dollars(input?.ohEstimatedAndOtherPayments || 0)
  );
  const refundableCredits = Math.max(
    0,
    dollars(input?.ohRefundableCredits || 0)
  );
  const ohioPayments = dollars(
    stateWithheld + estimatedAndOtherPayments + refundableCredits
  );

  const hasSchoolDistrictIncomeTax = input?.ohHasSchoolDistrictIncomeTax === true;
  const schoolDistrictTax = hasSchoolDistrictIncomeTax
    ? Math.max(0, dollars(input?.ohSchoolDistrictTax || 0))
    : 0;
  const schoolDistrictWithholding = hasSchoolDistrictIncomeTax
    ? Math.max(0, dollars(input?.ohSchoolDistrictWithholding || 0))
    : 0;
  const schoolDistrictPayments = hasSchoolDistrictIncomeTax
    ? Math.max(0, dollars(input?.ohSchoolDistrictPayments || 0))
    : 0;
  const schoolDistrictTotalPayments = dollars(
    schoolDistrictWithholding + schoolDistrictPayments
  );

  const stateTax = dollars(ohioTaxLiability + schoolDistrictTax);
  const totalStatePayments = dollars(ohioPayments + schoolDistrictTotalPayments);
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      totalAdditions,
      otherDeductionsExcludingBusinessIncomeDeduction,
      scheduleBusinessIncomeTotal,
      businessIncomeLine11,
      businessIncomeDeductionCap,
      businessIncomeDeduction,
      totalDeductions,
      ohioAdjustedGrossIncome,
      modifiedAdjustedGrossIncome,
      primaryExemptionCount,
      spouseExemptionCount,
      dependentExemptionCount,
      exemptionCount,
      exemptionPerPerson,
      exemptionAmount,
      ohioIncomeTaxBase,
      businessIncomeAfterDeduction,
      taxableBusinessIncome,
      taxableNonbusinessIncome,
    },
    nonbusinessIncomeTax,
    businessIncomeTax,
    incomeTaxBeforeCredits,
    requestedNonrefundableCredits,
    nonrefundableCredits,
    taxAfterNonrefundableCredits,
    interestPenalty,
    useTax,
    ohioTaxLiability,
    stateWithheld,
    estimatedAndOtherPayments,
    refundableCredits,
    ohioPayments,
    hasSchoolDistrictIncomeTax,
    schoolDistrictTax,
    schoolDistrictWithholding,
    schoolDistrictPayments,
    schoolDistrictTotalPayments,
    stateTax,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// COLORADO 2025 — SPECIAL FULL-YEAR RESIDENT DR 0104 CALCULATOR
// Colorado starts from federal taxable income, not federal AGI. For taxable
// income at or below $50,000, the official 2025 table uses special opening
// bands through $100 and then $100 bands. Above $50,000, DR 0104 uses 4.4%.
// =============================================================================

function computeColorado2025TaxTable(taxableIncome) {
  const income = Math.max(0, dollars(taxableIncome));
  if (income <= 10) return 0;
  if (income <= 30) return 1;
  if (income <= 50) return 2;
  if (income <= 75) return 3;
  if (income <= 100) return 4;
  if (income > 50000) return Math.max(0, Math.round(income * 0.044));

  // Table rows are "Over X but not over Y". Exact multiples of $100 belong
  // to the preceding row; all other values belong to the row whose lower
  // boundary is the preceding multiple of $100.
  const lower = income % 100 === 0
    ? income - 100
    : Math.floor(income / 100) * 100;
  const midpoint = lower + 50;
  return Math.max(0, Math.round(midpoint * 0.044));
}

function computeColorado2025Tax(input, federalSummary = {}) {
  const federalTaxableIncome = dollars(federalSummary?.taxableIncome || 0);
  const additions = Math.max(0, dollars(input?.coAdditions || 0));
  const subtractions = Math.max(0, dollars(input?.coSubtractions || 0));
  const stateTaxableIncome = Math.max(0, dollars(federalTaxableIncome + additions - subtractions));

  const normalTax = stateTaxableIncome <= 50000
    ? computeColorado2025TaxTable(stateTaxableIncome)
    : Math.max(0, Math.round(stateTaxableIncome * 0.044));

  const alternativeMinimumTax = Math.max(0, dollars(input?.coAlternativeMinimumTax || 0));
  const creditRecapture = Math.max(0, dollars(input?.coCreditRecapture || 0));
  const subtotalTax = dollars(normalTax + alternativeMinimumTax + creditRecapture);

  const otherNonrefundableCredits = Math.max(0, dollars(input?.coOtherNonrefundableCredits || 0));
  const nonrefundableCreditsUsed = Math.min(subtotalTax, otherNonrefundableCredits);
  const netIncomeTax = Math.max(0, dollars(subtotalTax - nonrefundableCreditsUsed));
  const creditRepayment = Math.max(0, dollars(input?.coCreditRepayment || 0));
  const netTaxAndRequiredRepayment = dollars(netIncomeTax + creditRepayment);

  const childTaxCredit = Math.max(0, dollars(input?.coChildTaxCredit || 0));
  const childDependentCareCredit = Math.max(0, dollars(input?.coChildDependentCareCredit || 0));
  const federalEITCAmount = Math.max(0, dollars(input?.coFederalEITCAmount || 0));
  const coloradoEITC = Math.max(0, Math.round(federalEITCAmount * 0.50));
  const otherRefundableCredits = Math.max(0, dollars(input?.coOtherRefundableCredits || 0));
  const directRefundableCredits = Math.max(0, dollars(input?.coDirectRefundableCredits || 0));
  const refundableCredits = dollars(
    childTaxCredit + childDependentCareCredit + coloradoEITC +
    otherRefundableCredits + directRefundableCredits
  );

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherFormWithholding = Math.max(0, dollars(input?.coOtherFormWithholding || 0));
  const priorYearCarryforward = Math.max(0, dollars(input?.coPriorYearCarryforward || 0));
  const estimatedPayments = Math.max(0, dollars(input?.coEstimatedPayments || 0));
  const extensionPayment = Math.max(0, dollars(input?.coExtensionPayment || 0));
  const otherPrepayments = Math.max(0, dollars(input?.coOtherPrepayments || 0));
  const taborRefund = Math.max(0, dollars(input?.coTaborRefund || 0));
  const totalStatePayments = dollars(
    stateWithheld + otherFormWithholding + priorYearCarryforward +
    estimatedPayments + extensionPayment + otherPrepayments +
    refundableCredits + taborRefund
  );

  const delinquentPenalty = Math.max(0, dollars(input?.coDelinquentPenalty || 0));
  const delinquentInterest = Math.max(0, dollars(input?.coDelinquentInterest || 0));
  const underpaymentPenalty = Math.max(0, dollars(input?.coUnderpaymentPenalty || 0));
  const penaltiesAndInterest = dollars(delinquentPenalty + delinquentInterest + underpaymentPenalty);
  const stateTax = dollars(netTaxAndRequiredRepayment + penaltiesAndInterest);
  const preAllocationNet = dollars(totalStatePayments - stateTax);

  const requestedCarryforward = Math.max(0, dollars(input?.coApplyToNextYear || 0));
  const availableOverpayment = Math.max(0, preAllocationNet);
  const applyToNextYear = Math.min(availableOverpayment, requestedCarryforward);
  const afterCarryforward = dollars(preAllocationNet - applyToNextYear);

  const requestedVoluntaryContributions = Math.max(0, dollars(input?.coVoluntaryContributions || 0));
  const voluntaryContributions = Math.min(Math.max(0, afterCarryforward), requestedVoluntaryContributions);
  const net = dollars(afterCarryforward - voluntaryContributions);

  return {
    incomeResult: {
      federalTaxableIncome,
      additions,
      subtractions,
      stateTaxableIncome,
    },
    normalTax,
    alternativeMinimumTax,
    creditRecapture,
    subtotalTax,
    otherNonrefundableCredits,
    nonrefundableCreditsUsed,
    netIncomeTax,
    creditRepayment,
    netTaxAndRequiredRepayment,
    childTaxCredit,
    childDependentCareCredit,
    federalEITCAmount,
    coloradoEITC,
    otherRefundableCredits,
    directRefundableCredits,
    refundableCredits,
    stateWithheld,
    otherFormWithholding,
    priorYearCarryforward,
    estimatedPayments,
    extensionPayment,
    otherPrepayments,
    taborRefund,
    totalStatePayments,
    delinquentPenalty,
    delinquentInterest,
    underpaymentPenalty,
    penaltiesAndInterest,
    stateTax,
    applyToNextYear,
    voluntaryContributions,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// UTAH 2025 — SPECIAL FULL-YEAR RESIDENT TC-40 CALCULATOR
// TC-40 starts with federal AGI, applies TC-40A additions/subtractions, taxes
// Utah taxable income at 4.5%, then applies the taxpayer tax credit. Utah's
// qualified-exempt-taxpayer worksheet uses the federal standard deduction
// (not itemized deductions) plus the federal enhanced senior deduction.
// =============================================================================

function getUtah2025TaxpayerCreditPhaseoutBase(filingStatus) {
  const table = {
    single: 18213,
    mfj: 36426,
    mfs: 18213,
    hoh: 27320,
    qw: 36426,
  };
  return table[filingStatus] ?? table.single;
}

function getUtah2025ChildCreditThreshold(filingStatus) {
  const table = {
    single: 43000,
    mfj: 54000,
    mfs: 27000,
    hoh: 43000,
    qw: 54000,
  };
  return table[filingStatus] ?? table.single;
}

function computeUtah2025Tax(input, federalSummary = {}) {
  const filingStatus = input?.filingStatus || "single";
  const federalAGI = dollars(federalSummary?.agi || 0);
  const additions = Math.max(0, dollars(input?.utAdditions || 0));
  const totalIncome = dollars(federalAGI + additions);
  const stateTaxRefund = Math.max(0, dollars(input?.utStateTaxRefund || 0));
  const subtractions = Math.max(0, dollars(input?.utSubtractions || 0));
  const utahTaxableIncome = dollars(totalIncome - stateTaxRefund - subtractions);
  const taxBeforeTaxpayerCredit = Math.max(0, dollars(Math.max(0, utahTaxableIncome) * 0.045));

  const dependentExemptionCount = Math.max(0, Math.trunc(Number(input?.utDependentExemptionCount || 0)));
  const personalExemption = dollars(dependentExemptionCount * 2111);
  const federalDeductionLine12 = Math.max(0, dollars(input?.utFederalDeductionLine12 || 0));
  const stateLocalIncomeTaxDeduction = Math.max(0, dollars(input?.utStateLocalIncomeTaxDeduction || 0));
  const totalExemptionsAndFederalDeductions = Math.max(
    0,
    dollars(personalExemption + federalDeductionLine12 - stateLocalIncomeTaxDeduction)
  );
  const initialTaxpayerCredit = Math.max(0, dollars(totalExemptionsAndFederalDeductions * 0.06));
  const taxpayerCreditPhaseoutBase = getUtah2025TaxpayerCreditPhaseoutBase(filingStatus);
  const incomeSubjectToPhaseout = Math.max(0, dollars(utahTaxableIncome - taxpayerCreditPhaseoutBase));
  const taxpayerCreditPhaseout = Math.max(0, dollars(incomeSubjectToPhaseout * 0.013));
  const taxpayerTaxCredit = Math.max(0, dollars(initialTaxpayerCredit - taxpayerCreditPhaseout));

  const federalBaseStandardDeduction = Math.max(0, dollars(input?.utFederalBaseStandardDeduction || 0));
  const federalEnhancedSeniorDeduction = Math.max(0, dollars(federalSummary?.enhancedSeniorDeduction || 0));
  const qualifiedExemptTaxpayer = federalAGI <= dollars(federalBaseStandardDeduction + federalEnhancedSeniorDeduction);
  const utahIncomeTax = qualifiedExemptTaxpayer
    ? 0
    : Math.max(0, dollars(taxBeforeTaxpayerCredit - taxpayerTaxCredit));

  const municipalBondInterestAddition = Math.max(0, dollars(input?.utMunicipalBondInterestAddition || 0));
  const federalTaxExemptInterest = Math.max(0, dollars(input?.utFederalTaxExemptInterest || 0));
  const childCreditQualifyingChildren = Math.max(0, Math.trunc(Number(input?.utChildCreditQualifyingChildren || 0)));
  const childCreditBeforePhaseout = dollars(childCreditQualifyingChildren * 1000);
  const childCreditModifiedAGI = dollars(totalIncome - municipalBondInterestAddition + federalTaxExemptInterest);
  const childCreditThreshold = getUtah2025ChildCreditThreshold(filingStatus);
  const childCreditPhaseout = Math.max(0, dollars(Math.max(0, childCreditModifiedAGI - childCreditThreshold) * 0.10));
  const childTaxCredit = Math.max(0, dollars(childCreditBeforePhaseout - childCreditPhaseout));

  const federalEITCAmount = Math.max(0, dollars(input?.utFederalEITCAmount || 0));
  const utahW2Wages = Math.max(0, dollars(input?.utUtahW2Wages || 0));
  const utahEITC = Math.max(0, Math.min(dollars(federalEITCAmount * 0.20), utahW2Wages));
  const otherApportionableNonrefundableCredits = Math.max(0, dollars(input?.utOtherApportionableNonrefundableCredits || 0));
  const apportionableNonrefundableCredits = dollars(childTaxCredit + utahEITC + otherApportionableNonrefundableCredits);
  const taxAfterApportionableCredits = Math.max(0, dollars(utahIncomeTax - apportionableNonrefundableCredits));
  const nonapportionableNonrefundableCredits = Math.max(0, dollars(input?.utNonapportionableNonrefundableCredits || 0));
  const incomeTaxLiability = Math.max(0, dollars(taxAfterApportionableCredits - nonapportionableNonrefundableCredits));

  const voluntaryContributions = Math.max(0, dollars(input?.utVoluntaryContributions || 0));
  const lowIncomeHousingRecapture = Math.max(0, dollars(input?.utLowIncomeHousingRecapture || 0));
  const useTax = Math.max(0, dollars(input?.utUseTax || 0));
  const totalTaxBeforePenalty = dollars(incomeTaxLiability + voluntaryContributions + lowIncomeHousingRecapture + useTax);

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherWithholding = Math.max(0, dollars(input?.utOtherWithholding || 0));
  const prepayments = Math.max(0, dollars(input?.utPrepayments || 0));
  const nonapportionableRefundableCredits = Math.max(0, dollars(input?.utNonapportionableRefundableCredits || 0));
  const apportionableRefundableCredits = Math.max(0, dollars(input?.utApportionableRefundableCredits || 0));
  const totalStatePayments = dollars(
    stateWithheld + otherWithholding + prepayments +
    nonapportionableRefundableCredits + apportionableRefundableCredits
  );

  const taxDueBeforePenalty = Math.max(0, dollars(totalTaxBeforePenalty - totalStatePayments));
  const penaltyInterestRequested = Math.max(0, dollars(input?.utPenaltyInterest || 0));
  const penaltyInterest = taxDueBeforePenalty > 0 ? penaltyInterestRequested : 0;
  const stateTax = dollars(totalTaxBeforePenalty + penaltyInterest);
  const preRefundSubtractionNet = dollars(totalStatePayments - stateTax);
  const requestedRefundSubtractions = Math.max(0, dollars(input?.utRefundSubtractions || 0));
  const refundSubtractions = Math.min(Math.max(0, preRefundSubtractionNet), requestedRefundSubtractions);
  const net = dollars(preRefundSubtractionNet - refundSubtractions);

  return {
    incomeResult: {
      federalAGI,
      additions,
      totalIncome,
      stateTaxRefund,
      subtractions,
      utahTaxableIncome,
    },
    taxBeforeTaxpayerCredit,
    dependentExemptionCount,
    personalExemption,
    federalDeductionLine12,
    stateLocalIncomeTaxDeduction,
    totalExemptionsAndFederalDeductions,
    initialTaxpayerCredit,
    taxpayerCreditPhaseoutBase,
    incomeSubjectToPhaseout,
    taxpayerCreditPhaseout,
    taxpayerTaxCredit,
    federalBaseStandardDeduction,
    federalEnhancedSeniorDeduction,
    qualifiedExemptTaxpayer,
    utahIncomeTax,
    municipalBondInterestAddition,
    federalTaxExemptInterest,
    childCreditQualifyingChildren,
    childCreditModifiedAGI,
    childCreditThreshold,
    childTaxCredit,
    federalEITCAmount,
    utahW2Wages,
    utahEITC,
    otherApportionableNonrefundableCredits,
    apportionableNonrefundableCredits,
    taxAfterApportionableCredits,
    nonapportionableNonrefundableCredits,
    incomeTaxLiability,
    voluntaryContributions,
    lowIncomeHousingRecapture,
    useTax,
    totalTaxBeforePenalty,
    stateWithheld,
    otherWithholding,
    prepayments,
    nonapportionableRefundableCredits,
    apportionableRefundableCredits,
    totalStatePayments,
    taxDueBeforePenalty,
    penaltyInterest,
    stateTax,
    refundSubtractions,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}


// =============================================================================
// IDAHO 2025 — SPECIAL FULL-YEAR RESIDENT FORM 40 CALCULATOR
// Form 40 begins with federal AGI, applies Form 39R additions/subtractions,
// subtracts the larger allowable Idaho deduction and federal Form 1040 lines
// 13a/13b deductions, then applies the official 5.3% worksheet after the
// filing-status threshold. Complex Form 43/NOL/other-state/claim-of-right cases
// are blocked before this calculator is reached.
// =============================================================================
function getIdaho2025TaxThreshold(filingStatus) {
  return ["mfj", "hoh", "qw"].includes(String(filingStatus || "")) ? 9622 : 4811;
}

function computeIdaho2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single");
  const federalAGI = dollars(federalSummary?.agi || 0);
  const additions = Math.max(0, dollars(input?.idAdditions || 0));
  const subtractions = Math.max(0, dollars(input?.idSubtractions || 0));
  const totalAdjustedIncome = dollars(federalAGI + additions - subtractions);

  const itemizedDeduction = Math.max(0, dollars(input?.idItemizedDeduction || 0));
  const standardDeduction = Math.max(0, dollars(input?.idStandardDeduction || 0));
  const mfsSpouseItemizes = input?.idMfsSpouseItemizes === true;
  const deductionUsed = filingStatus === "mfs" && mfsSpouseItemizes
    ? itemizedDeduction
    : Math.max(itemizedDeduction, standardDeduction);
  const incomeAfterDeduction = Math.max(0, dollars(totalAdjustedIncome - deductionUsed));
  const federalLine13Deductions = Math.max(0, dollars(input?.idFederalLine13Deductions || 0));
  const idahoTaxableIncome = Math.max(0, dollars(incomeAfterDeduction - federalLine13Deductions));

  const taxThreshold = getIdaho2025TaxThreshold(filingStatus);
  const taxBeforeCredits = Math.max(0, dollars((idahoTaxableIncome - taxThreshold) * 0.053));

  const form39rCredits = Math.max(0, dollars(input?.idForm39rCredits || 0));
  const businessIncomeTaxCredits = Math.max(0, dollars(input?.idBusinessIncomeTaxCredits || 0));
  const childCreditQualifyingChildren = Math.max(0, Math.trunc(Number(input?.idChildCreditQualifyingChildren || 0)));
  const childTaxCreditPotential = dollars(childCreditQualifyingChildren * 205);
  const childTaxCredit = Math.min(
    childTaxCreditPotential,
    Math.max(0, dollars(taxBeforeCredits - form39rCredits - businessIncomeTaxCredits))
  );
  const totalNonrefundableCredits = Math.min(
    taxBeforeCredits,
    dollars(form39rCredits + businessIncomeTaxCredits + childTaxCredit)
  );
  const incomeTaxLiability = Math.max(0, dollars(taxBeforeCredits - totalNonrefundableCredits));

  const fuelsUseTax = Math.max(0, dollars(input?.idFuelsUseTax || 0));
  const salesUseTax = Math.max(0, dollars(input?.idSalesUseTax || 0));
  const incomeTaxCreditRecapture = Math.max(0, dollars(input?.idIncomeTaxCreditRecapture || 0));
  const qieRecapture = Math.max(0, dollars(input?.idQieRecapture || 0));
  const permanentBuildingFundTax = Math.max(0, dollars(input?.idPermanentBuildingFundTax || 0));
  const otherTaxes = dollars(fuelsUseTax + salesUseTax + incomeTaxCreditRecapture + qieRecapture + permanentBuildingFundTax);
  const totalTax = dollars(incomeTaxLiability + otherTaxes);
  const donations = Math.max(0, dollars(input?.idDonations || 0));
  const totalTaxPlusDonations = dollars(totalTax + donations);

  const parentalChoiceTaxCredit = Math.max(0, dollars(input?.idParentalChoiceTaxCredit || 0));
  const foodTaxCredit = Math.max(0, dollars(input?.idFoodTaxCredit || 0));
  const homeFamilyCredit = Math.max(0, dollars(input?.idHomeFamilyCredit || 0));
  const fuelsTaxRefund = Math.max(0, dollars(input?.idFuelsTaxRefund || 0));
  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherWithholding = Math.max(0, dollars(input?.idOtherWithholding || 0));
  const estimatedPayments = Math.max(0, dollars(input?.idEstimatedPayments || 0));
  const entityPaidWithheldAbe = Math.max(0, dollars(input?.idEntityPaidWithheldAbe || 0));
  const taxReimbursementIncentiveCredit = Math.max(0, dollars(input?.idTaxReimbursementIncentiveCredit || 0));
  const totalPaymentsAndCredits = dollars(
    parentalChoiceTaxCredit + foodTaxCredit + homeFamilyCredit + fuelsTaxRefund +
    stateWithheld + otherWithholding + estimatedPayments + entityPaidWithheldAbe +
    taxReimbursementIncentiveCredit
  );

  const penaltyInterest = Math.max(0, dollars(input?.idPenaltyInterest || 0));
  const priorYearNonrefundableCreditRequested = Math.max(0, dollars(input?.idPriorYearNonrefundableCredit || 0));
  let netBeforePriorCredit = dollars(totalPaymentsAndCredits - totalTaxPlusDonations - penaltyInterest);
  const priorYearNonrefundableCreditUsed = netBeforePriorCredit < 0
    ? Math.min(Math.abs(netBeforePriorCredit), priorYearNonrefundableCreditRequested)
    : 0;
  let overpaymentOrDue = dollars(netBeforePriorCredit + priorYearNonrefundableCreditUsed);

  const refundApplyToNextYearRequested = Math.max(0, dollars(input?.idRefundApplyToNextYear || 0));
  const refundApplyToNextYear = overpaymentOrDue > 0
    ? Math.min(overpaymentOrDue, refundApplyToNextYearRequested)
    : 0;
  const net = dollars(overpaymentOrDue - refundApplyToNextYear);

  return {
    incomeResult: {
      federalAGI,
      additions,
      subtractions,
      totalAdjustedIncome,
      itemizedDeduction,
      standardDeduction,
      deductionUsed,
      incomeAfterDeduction,
      federalLine13Deductions,
      idahoTaxableIncome,
    },
    taxThreshold,
    taxBeforeCredits,
    form39rCredits,
    businessIncomeTaxCredits,
    childCreditQualifyingChildren,
    childTaxCreditPotential,
    childTaxCredit,
    totalNonrefundableCredits,
    incomeTaxLiability,
    fuelsUseTax,
    salesUseTax,
    incomeTaxCreditRecapture,
    qieRecapture,
    permanentBuildingFundTax,
    otherTaxes,
    totalTax,
    donations,
    totalTaxPlusDonations,
    parentalChoiceTaxCredit,
    foodTaxCredit,
    homeFamilyCredit,
    fuelsTaxRefund,
    stateWithheld,
    otherWithholding,
    estimatedPayments,
    entityPaidWithheldAbe,
    taxReimbursementIncentiveCredit,
    totalPaymentsAndCredits,
    penaltyInterest,
    priorYearNonrefundableCreditRequested,
    priorYearNonrefundableCreditUsed,
    refundApplyToNextYear,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// MONTANA 2025 — SPECIAL FULL-YEAR RESIDENT FORM 2 CALCULATOR
// Form 2 starts with federal AGI, subtracts the exact Form 2 line 2 federal
// deduction amount, applies Schedule I additions/subtractions and the age-65
// subtraction, then taxes ordinary income and net long-term capital gains under
// Montana's separate 2025 rate structure. Schedule II / other-state-credit /
// special EITC reduction / NOL-loss carryforward cases are blocked before use.
// =============================================================================
function getMontana2025OrdinaryTaxParameters(filingStatus) {
  const status = String(filingStatus || "single");
  if (["mfj", "qw"].includes(status)) return { threshold: 42200, adjustment: 506 };
  if (status === "hoh") return { threshold: 31700, adjustment: 380 };
  return { threshold: 21100, adjustment: 253 };
}

function computeMontana2025OrdinaryIncomeTax(ordinaryIncome, filingStatus) {
  const income = Math.max(0, dollars(ordinaryIncome || 0));
  const { threshold, adjustment } = getMontana2025OrdinaryTaxParameters(filingStatus);
  if (income < threshold) return Math.max(0, dollars(income * 0.047));
  return Math.max(0, dollars(income * 0.059 - adjustment));
}

function computeMontana2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single");
  const federalAGI = dollars(federalSummary?.agi || 0);
  const federalDeductionLine2 = Math.max(0, dollars(input?.mtFederalDeductionLine2 || 0));
  const federalTaxableForMontana = Math.max(0, dollars(federalAGI - federalDeductionLine2));
  const additions = Math.max(0, dollars(input?.mtAdditions || 0));
  const subtractions = Math.max(0, dollars(input?.mtSubtractions || 0));

  const taxpayerAge = Number(input?.age || 0);
  const spouseAge = Number(input?.spouseAge || 0);
  const age65Count = (taxpayerAge >= 65 ? 1 : 0) +
    (["mfj"].includes(filingStatus) && spouseAge >= 65 ? 1 : 0);
  const age65Subtraction = dollars(age65Count * 5660);

  const montanaTaxableIncome = Math.max(0, dollars(
    federalTaxableForMontana + additions - subtractions - age65Subtraction
  ));

  const netLongTermCapitalGainsRequested = Math.max(0, dollars(input?.mtNetLongTermCapitalGains || 0));
  const netLongTermCapitalGains = Math.min(montanaTaxableIncome, netLongTermCapitalGainsRequested);
  const ordinaryIncome = Math.max(0, dollars(montanaTaxableIncome - netLongTermCapitalGains));

  const { threshold: ordinaryThreshold } = getMontana2025OrdinaryTaxParameters(filingStatus);
  const ordinaryIncomeTax = computeMontana2025OrdinaryIncomeTax(ordinaryIncome, filingStatus);
  const capitalGainRoomAt3Percent = Math.max(0, dollars(ordinaryThreshold - ordinaryIncome));
  const capitalGainsAt3Percent = Math.min(netLongTermCapitalGains, capitalGainRoomAt3Percent);
  const capitalGainsAt41Percent = Math.max(0, dollars(netLongTermCapitalGains - capitalGainsAt3Percent));
  const capitalGainsTaxAt3Percent = dollars(capitalGainsAt3Percent * 0.03);
  const capitalGainsTaxAt41Percent = dollars(capitalGainsAt41Percent * 0.041);
  const netLongTermCapitalGainsTax = dollars(capitalGainsTaxAt3Percent + capitalGainsTaxAt41Percent);
  const taxBeforeCredits = dollars(ordinaryIncomeTax + netLongTermCapitalGainsTax);

  const otherNonrefundableCreditsRequested = Math.max(0, dollars(input?.mtOtherNonrefundableCredits || 0));
  const otherNonrefundableCredits = Math.min(taxBeforeCredits, otherNonrefundableCreditsRequested);
  const incomeTaxLiability = Math.max(0, dollars(taxBeforeCredits - otherNonrefundableCredits));

  const scheduleIvOtherTaxes = Math.max(0, dollars(input?.mtScheduleIvOtherTaxes || 0));
  const totalTax = dollars(incomeTaxLiability + scheduleIvOtherTaxes);

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherWithholdingAndPteCredits = Math.max(0, dollars(input?.mtOtherWithholdingAndPteCredits || 0));
  const estimatedPayments = Math.max(0, dollars(input?.mtEstimatedPayments || 0));
  const priorYearOverpayment = Math.max(0, dollars(input?.mtPriorYearOverpayment || 0));
  const extensionPayment = Math.max(0, dollars(input?.mtExtensionPayment || 0));
  const federalEITCAmount = Math.max(0, dollars(input?.mtFederalEITCAmount || 0));
  const montanaEITC = dollars(federalEITCAmount * 0.10);
  const elderlyHomeownerRenterCredit = Math.max(0, dollars(input?.mtElderlyHomeownerRenterCredit || 0));
  const otherRefundableCredits = Math.max(0, dollars(input?.mtOtherRefundableCredits || 0));
  const totalStatePayments = dollars(
    stateWithheld + otherWithholdingAndPteCredits + estimatedPayments + priorYearOverpayment +
    extensionPayment + montanaEITC + elderlyHomeownerRenterCredit + otherRefundableCredits
  );

  const overpaymentBeforeAllocations = Math.max(0, dollars(totalStatePayments - totalTax));
  const amountDue = Math.max(0, dollars(totalTax - totalStatePayments));
  const refundApplyToNextYearRequested = Math.max(0, dollars(input?.mtRefundApplyToNextYear || 0));
  const refundApplyToNextYear = Math.min(overpaymentBeforeAllocations, refundApplyToNextYearRequested);
  const remainingAfterNextYear = Math.max(0, dollars(overpaymentBeforeAllocations - refundApplyToNextYear));
  const refund529DepositRequested = Math.max(0, dollars(input?.mtRefund529Deposit || 0));
  const refund529Deposit = Math.min(remainingAfterNextYear, refund529DepositRequested);
  const refundAmount = Math.max(0, dollars(remainingAfterNextYear - refund529Deposit));
  const net = refundAmount > 0 ? refundAmount : amountDue > 0 ? -amountDue : 0;

  return {
    incomeResult: {
      federalAGI,
      federalDeductionLine2,
      federalTaxableForMontana,
      additions,
      subtractions,
      age65Count,
      age65Subtraction,
      montanaTaxableIncome,
      netLongTermCapitalGainsRequested,
      netLongTermCapitalGains,
      ordinaryIncome,
    },
    ordinaryThreshold,
    ordinaryIncomeTax,
    capitalGainRoomAt3Percent,
    capitalGainsAt3Percent,
    capitalGainsAt41Percent,
    capitalGainsTaxAt3Percent,
    capitalGainsTaxAt41Percent,
    netLongTermCapitalGainsTax,
    taxBeforeCredits,
    otherNonrefundableCreditsRequested,
    otherNonrefundableCredits,
    incomeTaxLiability,
    scheduleIvOtherTaxes,
    totalTax,
    stateWithheld,
    otherWithholdingAndPteCredits,
    estimatedPayments,
    priorYearOverpayment,
    extensionPayment,
    federalEITCAmount,
    montanaEITC,
    elderlyHomeownerRenterCredit,
    otherRefundableCredits,
    totalStatePayments,
    overpaymentBeforeAllocations,
    amountDue,
    refundApplyToNextYear,
    refund529Deposit,
    net,
    isRefund: refundAmount > 0,
    isOwed: amountDue > 0,
    refundAmount,
    owedAmount: amountDue,
  };
}


// =============================================================================
// NORTH DAKOTA 2025 — SPECIAL FULL-YEAR RESIDENT FORM ND-1 CALCULATOR
// Form ND-1 starts from a signed federal taxable-income amount. If federal
// Form 1040 line 15 is zero but the underlying taxable income is negative,
// North Dakota requires that negative amount on Form ND-1 line 1b.
// The official tax table uses $50 income bands below $100,000; the table tax
// equals the rate-schedule tax at the midpoint of the applicable $50 band.
// =============================================================================
function getNorthDakota2025RateParameters(filingStatus) {
  const status = String(filingStatus || "single").toLowerCase();
  if (["mfj", "qw"].includes(status)) {
    return { firstThreshold: 80975, secondThreshold: 298075, highBaseTax: 4233.45 };
  }
  if (status === "mfs") {
    return { firstThreshold: 40475, secondThreshold: 149025, highBaseTax: 2116.73 };
  }
  if (status === "hoh") {
    return { firstThreshold: 64950, secondThreshold: 271450, highBaseTax: 4026.75 };
  }
  return { firstThreshold: 48475, secondThreshold: 244825, highBaseTax: 3828.83 };
}

function computeNorthDakota2025RateScheduleTax(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome || 0));
  const { firstThreshold, secondThreshold, highBaseTax } = getNorthDakota2025RateParameters(filingStatus);
  if (income <= firstThreshold) return 0;
  if (income <= secondThreshold) return Math.max(0, dollars((income - firstThreshold) * 0.0195));
  return Math.max(0, dollars(highBaseTax + (income - secondThreshold) * 0.025));
}

function computeNorthDakota2025TaxTable(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome || 0));
  if (income >= 100000) return computeNorthDakota2025RateScheduleTax(income, filingStatus);
  const bandFloor = Math.floor(income / 50) * 50;
  const midpoint = bandFloor + 25;
  return computeNorthDakota2025RateScheduleTax(midpoint, filingStatus);
}

function computeNorthDakota2025MarriagePenaltyCredit(taxableIncome, filingStatus, taxpayerQualifiedIncome, spouseQualifiedIncome) {
  const status = String(filingStatus || "single").toLowerCase();
  const taxable = Math.max(0, dollars(taxableIncome || 0));
  if (status !== "mfj" || taxable <= 81036) return 0;
  const taxpayerQualified = Math.max(0, dollars(taxpayerQualifiedIncome || 0));
  const spouseQualified = Math.max(0, dollars(spouseQualifiedIncome || 0));
  const smallerQualifiedIncome = Math.min(taxpayerQualified, spouseQualified);
  if (smallerQualifiedIncome <= 47550) return 0;

  const line6 = Math.max(0, dollars(smallerQualifiedIncome - 15750));
  const line7 = computeNorthDakota2025RateScheduleTax(line6, "single");
  const line8 = Math.max(0, dollars(taxable - line6));
  const line9 = computeNorthDakota2025RateScheduleTax(line8, "single");
  const line10 = computeNorthDakota2025RateScheduleTax(taxable, "mfj");
  const line12 = Math.max(0, dollars(line10 - line7 - line9));
  return Math.min(312, line12);
}

function computeNorthDakota2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAGI = dollars(federalSummary?.agi || 0);
  const federalTaxableIncome = dollars(input?.ndFederalTaxableIncome || 0); // signed exact ND-1 line 1b
  const contributionAdjustment = Math.max(0, dollars(input?.ndContributionAdjustment || 0));
  const otherAdditions = Math.max(0, dollars(input?.ndOtherAdditions || 0));
  const totalAdditions = dollars(contributionAdjustment + otherAdditions);
  const incomeAfterAdditions = dollars(federalTaxableIncome + totalAdditions);

  const usObligationInterest = Math.max(0, dollars(input?.ndUsObligationInterest || 0));
  const netLongTermCapitalGainExclusion = Math.max(0, dollars(input?.ndNetLongTermCapitalGainExclusion || 0));
  const nativeAmericanExemptIncome = Math.max(0, dollars(input?.ndNativeAmericanExemptIncome || 0));
  const railroadBenefits = Math.max(0, dollars(input?.ndRailroadBenefits || 0));
  const peaceOfficerRetirementExclusion = Math.max(0, dollars(input?.ndPeaceOfficerRetirementExclusion || 0));
  const militaryPayExclusion = Math.max(0, dollars(input?.ndMilitaryPayExclusion || 0));
  const collegeSaveContributionRequested = Math.max(0, dollars(input?.ndCollegeSaveContribution || 0));
  const collegeSaveContribution = Math.min(collegeSaveContributionRequested, ["mfj", "qw"].includes(filingStatus) ? 10000 : 5000);
  const qualifiedDividends = Math.max(0, dollars(input?.ndQualifiedDividends || 0));
  const qualifiedDividendExclusion = dollars(qualifiedDividends * 0.40);
  const militaryRetirementExclusion = Math.max(0, dollars(input?.ndMilitaryRetirementExclusion || 0));
  const socialSecurityExclusion = Math.max(0, dollars(input?.ndSocialSecurityExclusion || 0));
  const otherSubtractions = Math.max(0, dollars(input?.ndOtherSubtractions || 0));
  const totalSubtractions = dollars(
    usObligationInterest + netLongTermCapitalGainExclusion + nativeAmericanExemptIncome + railroadBenefits +
    peaceOfficerRetirementExclusion + militaryPayExclusion + collegeSaveContribution + qualifiedDividendExclusion +
    militaryRetirementExclusion + socialSecurityExclusion + otherSubtractions
  );
  const northDakotaTaxableIncome = Math.max(0, dollars(incomeAfterAdditions - totalSubtractions));
  const incomeTaxBeforeCredits = computeNorthDakota2025TaxTable(northDakotaTaxableIncome, filingStatus);

  const marriagePenaltyCredit = computeNorthDakota2025MarriagePenaltyCredit(
    northDakotaTaxableIncome,
    filingStatus,
    input?.ndTaxpayerQualifiedIncome,
    input?.ndSpouseQualifiedIncome
  );
  const taxAfterMarriagePenalty = Math.max(0, dollars(incomeTaxBeforeCredits - marriagePenaltyCredit));
  const otherCreditsRequested = Math.max(0, dollars(input?.ndOtherCredits || 0));
  const otherCreditsUsed = Math.min(taxAfterMarriagePenalty, otherCreditsRequested);
  const stateTax = Math.max(0, dollars(taxAfterMarriagePenalty - otherCreditsUsed));

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherWithholding = Math.max(0, dollars(input?.ndOtherWithholding || 0));
  const estimatedTaxPayment = Math.max(0, dollars(input?.ndEstimatedTaxPayment || 0));
  const totalStatePayments = dollars(stateWithheld + otherWithholding + estimatedTaxPayment);

  const rawOverpayment = Math.max(0, dollars(totalStatePayments - stateTax));
  const overpayment = rawOverpayment >= 5 ? rawOverpayment : 0;
  const refundApplyToNextYearRequested = Math.max(0, dollars(input?.ndRefundApplyNextYear || 0));
  const refundApplyToNextYear = Math.min(overpayment, refundApplyToNextYearRequested);
  const afterNextYear = Math.max(0, dollars(overpayment - refundApplyToNextYear));
  const refundContributionsRequested = Math.max(0, dollars(input?.ndRefundContributions || 0));
  const refundContributions = Math.min(afterNextYear, refundContributionsRequested);
  const rawRefundAmount = Math.max(0, dollars(afterNextYear - refundContributions));
  const refundAmount = rawRefundAmount >= 5 ? rawRefundAmount : 0;

  const rawTaxDue = Math.max(0, dollars(stateTax - totalStatePayments));
  const taxDue = rawTaxDue >= 5 ? rawTaxDue : 0;
  const penaltyInterest = Math.max(0, dollars(input?.ndPenaltyInterest || 0));
  const balanceDueContributions = Math.max(0, dollars(input?.ndBalanceDueContributions || 0));
  const underpaymentInterest = Math.max(0, dollars(input?.ndUnderpaymentInterest || 0));
  const balanceDue = dollars(taxDue + penaltyInterest + balanceDueContributions + underpaymentInterest);
  const net = refundAmount > 0 ? refundAmount : balanceDue > 0 ? -balanceDue : 0;

  return {
    incomeResult: {
      federalAGI,
      federalTaxableIncome,
      contributionAdjustment,
      otherAdditions,
      totalAdditions,
      incomeAfterAdditions,
      usObligationInterest,
      netLongTermCapitalGainExclusion,
      nativeAmericanExemptIncome,
      railroadBenefits,
      peaceOfficerRetirementExclusion,
      militaryPayExclusion,
      collegeSaveContributionRequested,
      collegeSaveContribution,
      qualifiedDividends,
      qualifiedDividendExclusion,
      militaryRetirementExclusion,
      socialSecurityExclusion,
      otherSubtractions,
      totalSubtractions,
      northDakotaTaxableIncome,
    },
    incomeTaxBeforeCredits,
    marriagePenaltyCredit,
    otherCreditsRequested,
    otherCreditsUsed,
    stateTax,
    stateWithheld,
    otherWithholding,
    estimatedTaxPayment,
    totalStatePayments,
    rawOverpayment,
    overpayment,
    refundApplyToNextYear,
    refundContributions,
    refundAmount,
    rawTaxDue,
    taxDue,
    penaltyInterest,
    balanceDueContributions,
    underpaymentInterest,
    balanceDue,
    net,
    isRefund: refundAmount > 0,
    isOwed: balanceDue > 0,
    owedAmount: balanceDue,
  };
}

// =============================================================================
// NEW MEXICO 2025 — SPECIAL FULL-YEAR RESIDENT PIT-1 CALCULATOR
// PIT-1 starts with federal AGI. It then applies the exact Line 10 state/local
// income-tax addback, Line 11 PIT-ADJ additions, federal deduction on Line 12,
// the certain-dependent deduction, the low-/middle-income exemption, and exact
// PIT-ADJ deductions/exemptions. The official 2025 lookup table uses $100
// taxable-income bands through $100,000 (with special opening bands), then a
// high-income computation table above $100,000. PIT-B / Schedule CC / lump-sum
// / other-state-credit / amended-special cases are screened before calculation.
// =============================================================================
function normalizeNewMexico2025FilingStatus(filingStatus) {
  const status = String(filingStatus || "single").toLowerCase();
  return status === "qw" ? "mfj" : status;
}

function computeNewMexico2025StatutoryTax(taxableIncome, filingStatus) {
  const income = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeNewMexico2025FilingStatus(filingStatus);
  if (status === "mfj" || status === "hoh") {
    if (income <= 8000) return income * 0.015;
    if (income <= 25000) return 120 + (income - 8000) * 0.032;
    if (income <= 50000) return 664 + (income - 25000) * 0.043;
    if (income <= 100000) return 1739 + (income - 50000) * 0.047;
    if (income <= 315000) return 4089 + (income - 100000) * 0.049;
    return 14624 + (income - 315000) * 0.059;
  }
  if (status === "mfs") {
    if (income <= 4000) return income * 0.015;
    if (income <= 12500) return 60 + (income - 4000) * 0.032;
    if (income <= 25000) return 332 + (income - 12500) * 0.043;
    if (income <= 50000) return 869.5 + (income - 25000) * 0.047;
    if (income <= 157500) return 2044.5 + (income - 50000) * 0.049;
    return 7312 + (income - 157500) * 0.059;
  }
  if (income <= 5500) return income * 0.015;
  if (income <= 16500) return 82.5 + (income - 5500) * 0.032;
  if (income <= 33500) return 434.5 + (income - 16500) * 0.043;
  if (income <= 66500) return 1165.5 + (income - 33500) * 0.047;
  if (income <= 210000) return 2716.5 + (income - 66500) * 0.049;
  return 9748 + (income - 210000) * 0.059;
}

function computeNewMexico2025TaxTable(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome || 0));
  const status = normalizeNewMexico2025FilingStatus(filingStatus);
  if (income > 100000) {
    if (status === "mfj" || status === "hoh") {
      if (income <= 315000) return Math.max(0, dollars(4087 + (income - 100000) * 0.049));
      return Math.max(0, dollars(14622 + (income - 315000) * 0.059));
    }
    if (status === "mfs") {
      if (income <= 157500) return Math.max(0, dollars(4492 + (income - 100000) * 0.049));
      return Math.max(0, dollars(7310 + (income - 157500) * 0.059));
    }
    if (income <= 210000) return Math.max(0, dollars(4356 + (income - 100000) * 0.049));
    return Math.max(0, dollars(9746 + (income - 210000) * 0.059));
  }

  let midpoint;
  if (income <= 60) midpoint = 30;
  else if (income <= 100) midpoint = 80;
  else {
    const lower = Math.floor((income - 1) / 100) * 100;
    midpoint = lower + 50;
  }
  return Math.max(0, dollars(computeNewMexico2025StatutoryTax(midpoint, status)));
}

function getNewMexico2025ExemptionCount(input) {
  let count = input?.canBeClaimedAsDependent === true ? 0 : 1;
  if (String(input?.filingStatus || "").toLowerCase() === "mfj" && input?.nmSpouseCanBeClaimedAsDependent !== true) count += 1;
  count += Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  return count;
}

function getNewMexico2025CertainDependentDeduction(input) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  if (input?.canBeClaimedAsDependent === true || !["mfj", "hoh"].includes(status)) return 0;
  const qualifiedDependents = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)) - 1);
  return dollars(qualifiedDependents * 4000);
}

function getNewMexico2025LowMiddleIncomeExemption(federalAGI, filingStatus, exemptionCount) {
  const status = normalizeNewMexico2025FilingStatus(filingStatus);
  const agi = dollars(federalAGI || 0);
  let limit;
  let base;
  let reductionRate;
  if (status === "single") { limit = 36667; base = 20000; reductionRate = 0.15; }
  else if (status === "mfs") { limit = 27500; base = 15000; reductionRate = 0.20; }
  else { limit = 55000; base = 30000; reductionRate = 0.10; }
  if (agi > limit) return 0;
  const excess = Math.max(0, dollars(agi - base));
  const perExemption = Math.max(0, 2500 - excess * reductionRate);
  return Math.max(0, dollars(perExemption * Math.max(0, Math.trunc(Number(exemptionCount || 0)))));
}

function computeNewMexico2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAGI = dollars(federalSummary?.agi || 0);
  const stateLocalIncomeTaxAddback = Math.max(0, dollars(input?.nmStateLocalIncomeTaxAddback || 0));
  const pitAdjAdditions = Math.max(0, dollars(input?.nmPitAdjAdditions || 0));
  const federalDeductionLine12 = Math.max(0, dollars(input?.nmFederalDeductionLine12 || 0));
  const certainDependentDeduction = getNewMexico2025CertainDependentDeduction(input);
  const exemptionCount = getNewMexico2025ExemptionCount(input);
  const lowMiddleIncomeExemption = getNewMexico2025LowMiddleIncomeExemption(federalAGI, filingStatus, exemptionCount);
  const pitAdjDeductions = Math.max(0, dollars(input?.nmPitAdjDeductions || 0));
  const newMexicoTaxableIncome = Math.max(0, dollars(
    federalAGI + stateLocalIncomeTaxAddback + pitAdjAdditions - federalDeductionLine12 -
    certainDependentDeduction - lowMiddleIncomeExemption - pitAdjDeductions
  ));
  const newMexicoTax = computeNewMexico2025TaxTable(newMexicoTaxableIncome, filingStatus);

  const pitCrNonrefundableCreditsRequested = Math.max(0, dollars(input?.nmPitCrNonrefundableCredits || 0));
  const pitCrNonrefundableCreditsUsed = Math.min(newMexicoTax, pitCrNonrefundableCreditsRequested);
  const stateTax = Math.max(0, dollars(newMexicoTax - pitCrNonrefundableCreditsUsed));

  const pitRcTotalCredits = Math.max(0, dollars(input?.nmPitRcTotalCredits || 0));
  const federalEITCAmount = Math.max(0, dollars(input?.nmFederalEITCAmount || 0));
  const workingFamiliesTaxCredit = Math.max(0, dollars(federalEITCAmount * 0.25));
  const pitCrRefundableCredits = Math.max(0, dollars(input?.nmPitCrRefundableCredits || 0));
  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherLine27Withholding = Math.max(0, dollars(input?.nmOtherLine27Withholding || 0));
  const oilGasWithholding = Math.max(0, dollars(input?.nmOilGasWithholding || 0));
  const pteWithholdingEntityTax = Math.max(0, dollars(input?.nmPteWithholdingEntityTax || 0));
  const estimatedPayments = Math.max(0, dollars(input?.nmEstimatedPayments || 0));
  const otherPayments = Math.max(0, dollars(input?.nmOtherPayments || 0));
  const totalStatePayments = dollars(
    pitRcTotalCredits + workingFamiliesTaxCredit + pitCrRefundableCredits + stateWithheld + otherLine27Withholding +
    oilGasWithholding + pteWithholdingEntityTax + estimatedPayments + otherPayments
  );

  const underpaymentPenalty = Math.max(0, dollars(input?.nmUnderpaymentPenalty || 0));
  const latePenalty = Math.max(0, dollars(input?.nmLatePenalty || 0));
  const interest = Math.max(0, dollars(input?.nmInterest || 0));
  const penaltiesInterest = dollars(underpaymentPenalty + latePenalty + interest);
  const rawTaxDue = Math.max(0, dollars(stateTax - totalStatePayments));
  const balanceDue = dollars(rawTaxDue + penaltiesInterest);
  const rawOverpayment = Math.max(0, dollars(totalStatePayments - stateTax));
  const overpaymentAfterPenalty = Math.max(0, dollars(rawOverpayment - penaltiesInterest));
  const refundContributionsRequested = Math.max(0, dollars(input?.nmRefundContributions || 0));
  const refundContributions = Math.min(overpaymentAfterPenalty, refundContributionsRequested);
  const afterContributions = Math.max(0, dollars(overpaymentAfterPenalty - refundContributions));
  const applyToNextYearRequested = Math.max(0, dollars(input?.nmApplyToNextYear || 0));
  const applyToNextYear = Math.min(afterContributions, applyToNextYearRequested);
  const rawRefundAmount = Math.max(0, dollars(afterContributions - applyToNextYear));
  const refundAmount = rawRefundAmount > 1 ? rawRefundAmount : 0;
  const net = refundAmount > 0 ? refundAmount : balanceDue > 0 ? -balanceDue : 0;

  return {
    incomeResult: {
      federalAGI, stateLocalIncomeTaxAddback, pitAdjAdditions, federalDeductionLine12,
      certainDependentDeduction, exemptionCount, lowMiddleIncomeExemption, pitAdjDeductions, newMexicoTaxableIncome,
    },
    newMexicoTax,
    pitCrNonrefundableCreditsRequested,
    pitCrNonrefundableCreditsUsed,
    stateTax,
    pitRcTotalCredits,
    federalEITCAmount,
    workingFamiliesTaxCredit,
    pitCrRefundableCredits,
    stateWithheld,
    otherLine27Withholding,
    oilGasWithholding,
    pteWithholdingEntityTax,
    estimatedPayments,
    otherPayments,
    totalStatePayments,
    underpaymentPenalty,
    latePenalty,
    interest,
    penaltiesInterest,
    rawTaxDue,
    balanceDue,
    rawOverpayment,
    overpaymentAfterPenalty,
    refundContributions,
    applyToNextYear,
    rawRefundAmount,
    refundAmount,
    net,
    isRefund: refundAmount > 0,
    isOwed: balanceDue > 0,
    owedAmount: balanceDue,
  };
}

// =============================================================================
// CALIFORNIA 2025 — SPECIAL FULL-YEAR RESIDENT FORM 540 CALCULATOR
// Form 540 starts from federal AGI, applies exact signed Schedule CA Line 14/16
// adjustments and exact Line 18 deduction, then uses the official $100-band tax
// table through $100,000 or the rate schedules above $100,000. Exemption credits
// use exact Form 540 Line 7–10 counts and the 2025 AGI limitation worksheet.
// =============================================================================
function normalizeCalifornia2025FilingStatus(filingStatus) {
  const status = String(filingStatus || "single").toLowerCase();
  return status === "qw" ? "mfj" : status;
}

function computeCalifornia2025StatutoryTax(taxableIncome, filingStatus) {
  const income = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeCalifornia2025FilingStatus(filingStatus);
  const schedules = {
    single: [
      [11079, 0, 0.01, 0],
      [26264, 11079, 0.02, 110.79],
      [41452, 26264, 0.04, 414.49],
      [57542, 41452, 0.06, 1022.01],
      [72724, 57542, 0.08, 1987.41],
      [371479, 72724, 0.093, 3201.97],
      [445771, 371479, 0.103, 30986.19],
      [742953, 445771, 0.113, 38638.27],
      [Infinity, 742953, 0.123, 72219.84],
    ],
    mfs: [
      [11079, 0, 0.01, 0],
      [26264, 11079, 0.02, 110.79],
      [41452, 26264, 0.04, 414.49],
      [57542, 41452, 0.06, 1022.01],
      [72724, 57542, 0.08, 1987.41],
      [371479, 72724, 0.093, 3201.97],
      [445771, 371479, 0.103, 30986.19],
      [742953, 445771, 0.113, 38638.27],
      [Infinity, 742953, 0.123, 72219.84],
    ],
    mfj: [
      [22158, 0, 0.01, 0],
      [52528, 22158, 0.02, 221.58],
      [82904, 52528, 0.04, 828.98],
      [115084, 82904, 0.06, 2044.02],
      [145448, 115084, 0.08, 3974.82],
      [742958, 145448, 0.093, 6403.94],
      [891542, 742958, 0.103, 61972.37],
      [1485906, 891542, 0.113, 77276.52],
      [Infinity, 1485906, 0.123, 144439.65],
    ],
    hoh: [
      [22173, 0, 0.01, 0],
      [52530, 22173, 0.02, 221.73],
      [67716, 52530, 0.04, 828.87],
      [83805, 67716, 0.06, 1436.31],
      [98990, 83805, 0.08, 2401.65],
      [505208, 98990, 0.093, 3616.45],
      [606251, 505208, 0.103, 41394.72],
      [1010417, 606251, 0.113, 51802.15],
      [Infinity, 1010417, 0.123, 97472.91],
    ],
  };
  const rows = schedules[status] || schedules.single;
  for (const [max, base, rate, fixed] of rows) {
    if (income <= max) return Math.max(0, fixed + (income - base) * rate);
  }
  return 0;
}

function computeCalifornia2025TaxTable(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome));
  if (income <= 0) return 0;
  if (income > 100000) return Math.max(0, dollars(computeCalifornia2025StatutoryTax(income, filingStatus)));
  let midpoint;
  if (income <= 50) midpoint = 25.5;
  else if (income >= 99951) midpoint = 99975.5;
  else {
    const lower = 51 + Math.floor((income - 51) / 100) * 100;
    midpoint = lower + 49.5;
  }
  return Math.max(0, dollars(computeCalifornia2025StatutoryTax(midpoint, filingStatus)));
}

function getCalifornia2025ExemptionCredit(input, federalAGI) {
  const status = normalizeCalifornia2025FilingStatus(input?.filingStatus);
  const personal = Math.max(0, Math.trunc(Number(input?.caPersonalExemptionCount || 0)));
  const blind = Math.max(0, Math.trunc(Number(input?.caBlindExemptionCount || 0)));
  const senior = Math.max(0, Math.trunc(Number(input?.caSeniorExemptionCount || 0)));
  const dependents = Math.max(0, Math.trunc(Number(input?.caDependentExemptionCount || 0)));
  const ordinaryUnits = personal + blind + senior;
  const threshold = status === "mfj" ? 504411 : status === "hoh" ? 378310 : 252203;
  const divisor = status === "mfs" ? 1250 : 2500;
  const agi = Number(federalAGI || 0);
  let ordinaryPerUnit = 153;
  let dependentPerUnit = 475;
  if (agi > threshold) {
    const steps = Math.ceil((agi - threshold) / divisor);
    const reduction = steps * 6;
    ordinaryPerUnit = Math.max(0, 153 - reduction);
    dependentPerUnit = Math.max(0, 475 - reduction);
  }
  return Math.max(0, dollars(ordinaryUnits * ordinaryPerUnit + dependents * dependentPerUnit));
}

function computeCalifornia2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAGI = dollars(federalSummary?.agi || 0);
  const scheduleCASubtractions = dollars(input?.caScheduleCASubtractions || 0);
  const scheduleCAAdditions = dollars(input?.caScheduleCAAdditions || 0);
  const californiaAGI = dollars(federalAGI - scheduleCASubtractions + scheduleCAAdditions);
  const deductionAmount = Math.max(0, dollars(input?.caDeductionAmount || 0));
  const californiaTaxableIncome = Math.max(0, dollars(californiaAGI - deductionAmount));
  const regularTax = computeCalifornia2025TaxTable(californiaTaxableIncome, filingStatus);
  const exemptionCredit = getCalifornia2025ExemptionCredit(input, federalAGI);
  const taxAfterExemption = Math.max(0, dollars(regularTax - exemptionCredit));
  const nonrefundableCreditsRequested = Math.max(0, dollars(input?.caNonrefundableCreditsTotal || 0));
  const nonrefundableCreditsUsed = Math.min(taxAfterExemption, nonrefundableCreditsRequested);
  const taxAfterCredits = Math.max(0, dollars(taxAfterExemption - nonrefundableCreditsUsed));
  const alternativeMinimumTax = Math.max(0, dollars(input?.caAlternativeMinimumTax || 0));
  const behavioralHealthServicesTax = californiaTaxableIncome > 1000000
    ? Math.max(0, dollars((californiaTaxableIncome - 1000000) * 0.01))
    : 0;
  const otherTaxesRecapture = Math.max(0, dollars(input?.caOtherTaxesRecapture || 0));
  const stateTax = Math.max(0, dollars(taxAfterCredits + alternativeMinimumTax + behavioralHealthServicesTax + otherTaxesRecapture));

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherLine71Withholding = Math.max(0, dollars(input?.caOtherLine71Withholding || 0));
  const line71Withholding = dollars(stateWithheld + otherLine71Withholding);
  const estimatedAndOtherPayments = Math.max(0, dollars(input?.caEstimatedAndOtherPayments || 0));
  const forms592593Withholding = Math.max(0, dollars(input?.caForms592593Withholding || 0));
  const motionPictureRefundableCredit = Math.max(0, dollars(input?.caMotionPictureRefundableCredit || 0));
  const calEitc = Math.max(0, dollars(input?.caCalEitc || 0));
  const youngChildTaxCredit = Math.max(0, dollars(input?.caYoungChildTaxCredit || 0));
  const fosterYouthTaxCredit = Math.max(0, dollars(input?.caFosterYouthTaxCredit || 0));
  const totalStatePayments = dollars(
    line71Withholding + estimatedAndOtherPayments + forms592593Withholding + motionPictureRefundableCredit +
    calEitc + youngChildTaxCredit + fosterYouthTaxCredit
  );

  const useTax = Math.max(0, dollars(input?.caUseTax || 0));
  const individualSharedResponsibilityPenalty = Math.max(0, dollars(input?.caIsrPenalty || 0));
  const paymentsAfterUseTax = Math.max(0, dollars(totalStatePayments - useTax));
  const useTaxDue = Math.max(0, dollars(useTax - totalStatePayments));
  const paymentsAfterIsr = Math.max(0, dollars(paymentsAfterUseTax - individualSharedResponsibilityPenalty));
  const isrDue = Math.max(0, dollars(individualSharedResponsibilityPenalty - paymentsAfterUseTax));
  const rawOverpayment = Math.max(0, dollars(paymentsAfterIsr - stateTax));
  const rawTaxDue = Math.max(0, dollars(stateTax - paymentsAfterIsr));
  const applyToNextYearRequested = Math.max(0, dollars(input?.caApplyToNextYear || 0));
  const applyToNextYear = Math.min(rawOverpayment, applyToNextYearRequested);
  const overpaymentAfterApply = Math.max(0, dollars(rawOverpayment - applyToNextYear));
  const contributions = Math.max(0, dollars(input?.caContributions || 0));
  const interestLatePenalties = Math.max(0, dollars(input?.caInterestLatePenalties || 0));
  const underpaymentPenalty = Math.max(0, dollars(input?.caUnderpaymentPenalty || 0));
  const charges = dollars(contributions + interestLatePenalties + underpaymentPenalty);
  const baseAmountDue = dollars(useTaxDue + isrDue + rawTaxDue);
  const refundAmount = baseAmountDue > 0 ? 0 : Math.max(0, dollars(overpaymentAfterApply - charges));
  const owedAmount = baseAmountDue > 0
    ? dollars(baseAmountDue + charges)
    : Math.max(0, dollars(charges - overpaymentAfterApply));
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    incomeResult: { federalAGI, scheduleCASubtractions, scheduleCAAdditions, californiaAGI, deductionAmount, californiaTaxableIncome },
    regularTax,
    exemptionCredit,
    taxAfterExemption,
    nonrefundableCreditsRequested,
    nonrefundableCreditsUsed,
    taxAfterCredits,
    alternativeMinimumTax,
    behavioralHealthServicesTax,
    otherTaxesRecapture,
    stateTax,
    stateWithheld,
    otherLine71Withholding,
    line71Withholding,
    estimatedAndOtherPayments,
    forms592593Withholding,
    motionPictureRefundableCredit,
    calEitc,
    youngChildTaxCredit,
    fosterYouthTaxCredit,
    totalStatePayments,
    useTax,
    individualSharedResponsibilityPenalty,
    paymentsAfterUseTax,
    useTaxDue,
    paymentsAfterIsr,
    isrDue,
    rawOverpayment,
    rawTaxDue,
    applyToNextYear,
    overpaymentAfterApply,
    contributions,
    interestLatePenalties,
    underpaymentPenalty,
    refundAmount,
    owedAmount,
    net,
    isRefund: refundAmount > 0,
    isOwed: owedAmount > 0,
  };
}

// =============================================================================
// OREGON 2025 — SPECIAL FULL-YEAR RESIDENT FORM OR-40 CALCULATOR
// Form OR-40 starts from federal AGI, applies exact additions/subtractions and
// deduction, then uses the official 2025 tax table below $50,000 or rate chart
// at $50,000 or more. The federal tax liability subtraction is checked against
// Oregon's 2025 AGI phaseout maximum. Complex alternate methods are blocked.
// =============================================================================
function normalizeOregon2025FilingStatus(filingStatus) {
  const status = String(filingStatus || "single").toLowerCase();
  return status === "qw" ? "mfj" : status;
}

function getOregon2025FederalTaxSubtractionMaximum(filingStatus, federalAGI) {
  const status = normalizeOregon2025FilingStatus(filingStatus);
  const agi = Math.max(0, Number(federalAGI || 0));
  if (status === "mfs") {
    if (agi < 125000) return 4250;
    if (agi < 130000) return 3400;
    if (agi < 135000) return 2550;
    if (agi < 140000) return 1700;
    if (agi < 145000) return 850;
    return 0;
  }
  if (status === "single") {
    if (agi < 125000) return 8500;
    if (agi < 130000) return 6800;
    if (agi < 135000) return 5100;
    if (agi < 140000) return 3400;
    if (agi < 145000) return 1700;
    return 0;
  }
  if (agi < 250000) return 8500;
  if (agi < 260000) return 6800;
  if (agi < 270000) return 5100;
  if (agi < 280000) return 3400;
  if (agi < 290000) return 1700;
  return 0;
}

function computeOregon2025RateScheduleTax(taxableIncome, filingStatus) {
  const income = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeOregon2025FilingStatus(filingStatus);
  const chartS = status === "single" || status === "mfs";
  if (chartS) {
    if (income <= 4400) return Math.max(0, dollars(income * 0.0475));
    if (income <= 11100) return Math.max(0, dollars(209 + (income - 4400) * 0.0675));
    if (income <= 125000) return Math.max(0, dollars(661 + (income - 11100) * 0.0875));
    return Math.max(0, dollars(10627 + (income - 125000) * 0.099));
  }
  if (income <= 8800) return Math.max(0, dollars(income * 0.0475));
  if (income <= 22200) return Math.max(0, dollars(418 + (income - 8800) * 0.0675));
  if (income <= 250000) return Math.max(0, dollars(1323 + (income - 22200) * 0.0875));
  return Math.max(0, dollars(21256 + (income - 250000) * 0.099));
}

function computeOregon2025TaxTable(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome));
  if (income <= 0) return 0;
  if (income < 50000) {
    let lower;
    let upper;
    if (income < 20) { lower = 0; upper = 20; }
    else if (income < 50) { lower = 20; upper = 50; }
    else if (income < 100) { lower = 50; upper = 100; }
    else { lower = Math.floor(income / 100) * 100; upper = lower + 100; }
    return computeOregon2025RateScheduleTax((lower + upper) / 2, filingStatus);
  }
  const status = normalizeOregon2025FilingStatus(filingStatus);
  const chartS = status === "single" || status === "mfs";
  if (chartS) {
    if (income <= 125000) return Math.max(0, dollars(4065 + (income - 50000) * 0.0875));
    return Math.max(0, dollars(10627 + (income - 125000) * 0.099));
  }
  if (income <= 250000) return Math.max(0, dollars(3756 + (income - 50000) * 0.0875));
  return Math.max(0, dollars(21256 + (income - 250000) * 0.099));
}

function computeOregon2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAGI = dollars(federalSummary?.agi || 0);
  const additions = Math.max(0, dollars(input?.orAdditions || 0));
  const federalTaxLiabilitySubtraction = Math.max(0, dollars(input?.orFederalTaxLiabilitySubtraction || 0));
  const socialSecurityTier1Subtraction = Math.max(0, dollars(input?.orSocialSecurityTier1Subtraction || 0));
  const oregonRefundSubtraction = Math.max(0, dollars(input?.orOregonRefundSubtraction || 0));
  const otherSubtractions = Math.max(0, dollars(input?.orOtherSubtractions || 0));
  const incomeAfterAdditions = dollars(federalAGI + additions);
  const totalSubtractions = dollars(federalTaxLiabilitySubtraction + socialSecurityTier1Subtraction + oregonRefundSubtraction + otherSubtractions);
  const incomeAfterSubtractions = dollars(incomeAfterAdditions - totalSubtractions);
  const deductionAmount = Math.max(0, dollars(input?.orDeductionAmount || 0));
  const oregonTaxableIncome = Math.max(0, dollars(incomeAfterSubtractions - deductionAmount));
  const regularTax = computeOregon2025TaxTable(oregonTaxableIncome, filingStatus);
  const installmentSaleInterest = Math.max(0, dollars(input?.orInstallmentSaleInterest || 0));
  const taxRecaptures = Math.max(0, dollars(input?.orTaxRecaptures || 0));
  const taxBeforeCredits = Math.max(0, dollars(regularTax + installmentSaleInterest + taxRecaptures));
  const exemptionCredit = Math.max(0, dollars(input?.orExemptionCredit || 0));
  const politicalContributionCredit = Math.max(0, dollars(input?.orPoliticalContributionCredit || 0));
  const otherStandardCredits = Math.max(0, dollars(input?.orOtherStandardCredits || 0));
  const carryforwardCredits = Math.max(0, dollars(input?.orCarryforwardCredits || 0));
  const nonrefundableCreditsRequested = dollars(exemptionCredit + politicalContributionCredit + otherStandardCredits + carryforwardCredits);
  const nonrefundableCreditsUsed = Math.min(taxBeforeCredits, nonrefundableCreditsRequested);
  const stateTax = Math.max(0, dollars(taxBeforeCredits - nonrefundableCreditsUsed));
  const kicker = Math.max(0, dollars(input?.orKicker || 0));
  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherWithholding = Math.max(0, dollars(input?.orOtherWithholding || 0));
  const priorYearRefundApplied = Math.max(0, dollars(input?.orPriorYearRefundApplied || 0));
  const estimatedPayments = Math.max(0, dollars(input?.orEstimatedPayments || 0));
  const pteEstimatedPayments = Math.max(0, dollars(input?.orPteEstimatedPayments || 0));
  const federalEitcAmount = Math.max(0, dollars(input?.orFederalEitcAmount || 0));
  const eicRate = input?.orYoungestDependentUnder3 === true ? 0.12 : 0.09;
  const oregonEarnedIncomeCredit = federalEitcAmount > 0 ? Math.max(0, dollars(federalEitcAmount * eicRate)) : 0;
  const oregonKidsCredit = Math.max(0, dollars(input?.orKidsCredit || 0));
  const otherRefundableCredits = Math.max(0, dollars(input?.orOtherRefundableCredits || 0));
  const totalStatePayments = dollars(kicker + stateWithheld + otherWithholding + priorYearRefundApplied + estimatedPayments + pteEstimatedPayments + oregonEarnedIncomeCredit + oregonKidsCredit + otherRefundableCredits);
  const rawOverpayment = Math.max(0, dollars(totalStatePayments - stateTax));
  const rawTaxDue = Math.max(0, dollars(stateTax - totalStatePayments));
  const penaltyInterest = Math.max(0, dollars(input?.orPenaltyInterest || 0));
  const overpaymentAfterPenalty = Math.max(0, dollars(rawOverpayment - penaltyInterest));
  const penaltyBalanceDue = Math.max(0, dollars(penaltyInterest - rawOverpayment));
  const refundApplicationsRequested = Math.max(0, dollars(input?.orRefundApplications || 0));
  const refundApplications = Math.min(overpaymentAfterPenalty, refundApplicationsRequested);
  const refundAmount = Math.max(0, dollars(overpaymentAfterPenalty - refundApplications));
  const owedAmount = Math.max(0, dollars(rawTaxDue + penaltyBalanceDue));
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;
  return {
    incomeResult: { federalAGI, additions, incomeAfterAdditions, federalTaxLiabilitySubtraction, socialSecurityTier1Subtraction, oregonRefundSubtraction, otherSubtractions, totalSubtractions, incomeAfterSubtractions, deductionAmount, oregonTaxableIncome },
    federalTaxSubtractionMaximum: getOregon2025FederalTaxSubtractionMaximum(filingStatus, federalAGI),
    regularTax, installmentSaleInterest, taxRecaptures, taxBeforeCredits, exemptionCredit, politicalContributionCredit,
    otherStandardCredits, carryforwardCredits, nonrefundableCreditsRequested, nonrefundableCreditsUsed, stateTax,
    kicker, stateWithheld, otherWithholding, priorYearRefundApplied, estimatedPayments, pteEstimatedPayments,
    federalEitcAmount, eicRate, oregonEarnedIncomeCredit, oregonKidsCredit, otherRefundableCredits, totalStatePayments,
    rawOverpayment, rawTaxDue, penaltyInterest, refundApplications, refundAmount, owedAmount, net,
    isRefund: refundAmount > 0, isOwed: owedAmount > 0,
  };
}

// =============================================================================
// WASHINGTON 2025 — CAPITAL GAINS EXCISE TAX + WORKING FAMILIES TAX CREDIT
// Washington does not impose a broad individual wage/income tax, but tax year
// 2025 has a capital-gains excise tax with a $278,000 standard deduction and
// tiered 7% / 9.9% rates. The estimator requires the exact Washington capital-
// gains amount after allocation and exempt-asset adjustments rather than
// guessing transaction sourcing. The WFTC is accepted as an exact completed
// amount because its eligibility/phaseout path is separate from the capital-
// gains return.
// =============================================================================
function computeWashington2025CapitalGainsTax(taxableWashingtonCapitalGains) {
  const taxable = Math.max(0, Number(taxableWashingtonCapitalGains || 0));
  if (taxable <= 1000000) return Math.max(0, dollars(taxable * 0.07));
  return Math.max(0, dollars(70000 + (taxable - 1000000) * 0.099));
}

function computeWashington2025Tax(input) {
  const washingtonCapitalGainsBeforeDeductions = Number(input?.waCapitalGainsBeforeDeductions || 0);
  const standardDeduction = 278000;
  const constitutionalDeduction = Math.max(0, Number(input?.waConstitutionalDeduction || 0));
  const familyOwnedBusinessDeduction = Math.max(0, Number(input?.waFamilyOwnedBusinessDeduction || 0));
  const qualifyingCharitableDonations = Math.max(0, Number(input?.waQualifyingCharitableDonations || 0));
  const charitableDonationDeduction = Math.min(111000, Math.max(0, qualifyingCharitableDonations - 278000));
  const totalDeductions = standardDeduction + constitutionalDeduction + familyOwnedBusinessDeduction + charitableDonationDeduction;
  const taxableWashingtonCapitalGains = Math.max(0, dollars(washingtonCapitalGainsBeforeDeductions - totalDeductions));
  const capitalGainsTaxBeforeCredits = computeWashington2025CapitalGainsTax(taxableWashingtonCapitalGains);
  const otherJurisdictionCreditRequested = Math.max(0, dollars(input?.waOtherJurisdictionCredit || 0));
  const boCapitalGainsCreditRequested = Math.max(0, dollars(input?.waBoCapitalGainsCredit || 0));
  const totalCreditsRequested = dollars(otherJurisdictionCreditRequested + boCapitalGainsCreditRequested);
  const totalCreditsUsed = Math.min(capitalGainsTaxBeforeCredits, totalCreditsRequested);
  const capitalGainsTaxAfterCredits = Math.max(0, dollars(capitalGainsTaxBeforeCredits - totalCreditsUsed));
  const capitalGainsPayments = Math.max(0, dollars(input?.waCapitalGainsPayments || 0));
  const workingFamiliesTaxCredit = Math.max(0, dollars(input?.waWorkingFamiliesTaxCredit || 0));
  const penaltyInterest = Math.max(0, dollars(input?.waPenaltyInterest || 0));
  const stateTax = Math.max(0, dollars(capitalGainsTaxAfterCredits + penaltyInterest));
  const totalStatePayments = dollars(capitalGainsPayments + workingFamiliesTaxCredit);
  const refundAmount = Math.max(0, dollars(totalStatePayments - stateTax));
  const owedAmount = Math.max(0, dollars(stateTax - totalStatePayments));
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;
  return {
    washingtonCapitalGainsBeforeDeductions,
    standardDeduction,
    constitutionalDeduction,
    familyOwnedBusinessDeduction,
    qualifyingCharitableDonations,
    charitableDonationDeduction,
    totalDeductions,
    taxableWashingtonCapitalGains,
    capitalGainsTaxBeforeCredits,
    otherJurisdictionCreditRequested,
    boCapitalGainsCreditRequested,
    totalCreditsRequested,
    totalCreditsUsed,
    capitalGainsTaxAfterCredits,
    capitalGainsPayments,
    workingFamiliesTaxCredit,
    penaltyInterest,
    stateTax,
    totalStatePayments,
    refundAmount,
    owedAmount,
    net,
    isRefund: refundAmount > 0,
    isOwed: owedAmount > 0,
  };
}

// =============================================================================
// HAWAII 2025 — SPECIAL FULL-YEAR RESIDENT FORM N-11 CALCULATOR
// Hawaii starts from federal AGI, applies Hawaii additions/subtractions,
// subtracts the Hawaii standard or exact completed itemized deduction and the
// taxpayer-entered number of $1,144 exemption units, then uses the mandatory
// $50-band tax table below $100,000 or the official rate schedules at $100,000
// or more. Material special computations are screened and blocked rather than
// guessed.
// =============================================================================
function normalizeHawaii2025FilingStatus(filingStatus) {
  const status = String(filingStatus || "single").toLowerCase();
  return status === "qw" ? "mfj" : status;
}

function getHawaii2025StandardDeduction(filingStatus) {
  const status = normalizeHawaii2025FilingStatus(filingStatus);
  if (status === "mfj") return 8800;
  if (status === "hoh") return 6424;
  return 4400;
}

function computeHawaii2025RateScheduleTax(taxableIncome, filingStatus) {
  const income = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeHawaii2025FilingStatus(filingStatus);
  if (status === "mfj") {
    if (income <= 19200) return Math.max(0, dollars(income * 0.014));
    if (income <= 28800) return Math.max(0, dollars(269 + (income - 19200) * 0.032));
    if (income <= 38400) return Math.max(0, dollars(576 + (income - 28800) * 0.055));
    if (income <= 48000) return Math.max(0, dollars(1104 + (income - 38400) * 0.064));
    if (income <= 72000) return Math.max(0, dollars(1718 + (income - 48000) * 0.068));
    if (income <= 96000) return Math.max(0, dollars(3350 + (income - 72000) * 0.072));
    if (income <= 250000) return Math.max(0, dollars(5078 + (income - 96000) * 0.076));
    if (income <= 350000) return Math.max(0, dollars(16782 + (income - 250000) * 0.079));
    if (income <= 450000) return Math.max(0, dollars(24682 + (income - 350000) * 0.0825));
    if (income <= 550000) return Math.max(0, dollars(32932 + (income - 450000) * 0.09));
    if (income <= 650000) return Math.max(0, dollars(41932 + (income - 550000) * 0.10));
    return Math.max(0, dollars(51932 + (income - 650000) * 0.11));
  }
  if (status === "hoh") {
    if (income <= 14400) return Math.max(0, dollars(income * 0.014));
    if (income <= 21600) return Math.max(0, dollars(202 + (income - 14400) * 0.032));
    if (income <= 28800) return Math.max(0, dollars(432 + (income - 21600) * 0.055));
    if (income <= 36000) return Math.max(0, dollars(828 + (income - 28800) * 0.064));
    if (income <= 54000) return Math.max(0, dollars(1289 + (income - 36000) * 0.068));
    if (income <= 72000) return Math.max(0, dollars(2513 + (income - 54000) * 0.072));
    if (income <= 187500) return Math.max(0, dollars(3809 + (income - 72000) * 0.076));
    if (income <= 262500) return Math.max(0, dollars(12587 + (income - 187500) * 0.079));
    if (income <= 337500) return Math.max(0, dollars(18512 + (income - 262500) * 0.0825));
    if (income <= 412500) return Math.max(0, dollars(24699 + (income - 337500) * 0.09));
    if (income <= 487500) return Math.max(0, dollars(31449 + (income - 412500) * 0.10));
    return Math.max(0, dollars(38949 + (income - 487500) * 0.11));
  }
  if (income <= 9600) return Math.max(0, dollars(income * 0.014));
  if (income <= 14400) return Math.max(0, dollars(134 + (income - 9600) * 0.032));
  if (income <= 19200) return Math.max(0, dollars(288 + (income - 14400) * 0.055));
  if (income <= 24000) return Math.max(0, dollars(552 + (income - 19200) * 0.064));
  if (income <= 36000) return Math.max(0, dollars(859 + (income - 24000) * 0.068));
  if (income <= 48000) return Math.max(0, dollars(1675 + (income - 36000) * 0.072));
  if (income <= 125000) return Math.max(0, dollars(2539 + (income - 48000) * 0.076));
  if (income <= 175000) return Math.max(0, dollars(8391 + (income - 125000) * 0.079));
  if (income <= 225000) return Math.max(0, dollars(12341 + (income - 175000) * 0.0825));
  if (income <= 275000) return Math.max(0, dollars(16466 + (income - 225000) * 0.09));
  if (income <= 325000) return Math.max(0, dollars(20966 + (income - 275000) * 0.10));
  return Math.max(0, dollars(25966 + (income - 325000) * 0.11));
}

function computeHawaii2025TaxTable(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome));
  if (income <= 0) return 0;
  if (income < 100000) {
    const lower = Math.floor(income / 50) * 50;
    return computeHawaii2025RateScheduleTax(lower + 25, filingStatus);
  }
  return computeHawaii2025RateScheduleTax(income, filingStatus);
}

function computeHawaii2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAGI = dollars(federalSummary?.agi || 0);
  const additions = Math.max(0, dollars(input?.hiAdditions || 0));
  const subtractions = Math.max(0, dollars(input?.hiSubtractions || 0));
  const hawaiiAGI = dollars(federalAGI + additions - subtractions);
  const deductionMethod = String(input?.hiDeductionMethod || "standard").toLowerCase();
  const deductionAmount = deductionMethod === "itemized"
    ? Math.max(0, dollars(input?.hiItemizedDeductionAmount || 0))
    : getHawaii2025StandardDeduction(filingStatus);
  const exemptionCount = Math.max(0, Math.trunc(Number(input?.hiExemptionCount || 0)));
  const exemptionAmount = dollars(exemptionCount * 1144);
  const hawaiiTaxableIncome = Math.max(0, dollars(hawaiiAGI - deductionAmount - exemptionAmount));
  const regularTax = computeHawaii2025TaxTable(hawaiiTaxableIncome, filingStatus);
  const otherTaxes = Math.max(0, dollars(input?.hiOtherTaxes || 0));
  const taxBeforeCredits = Math.max(0, dollars(regularTax + otherTaxes));
  const nonrefundableCreditsRequested = Math.max(0, dollars(input?.hiNonrefundableCredits || 0));
  const nonrefundableCreditsUsed = Math.min(taxBeforeCredits, nonrefundableCreditsRequested);
  const taxAfterCredits = Math.max(0, dollars(taxBeforeCredits - nonrefundableCreditsUsed));
  const penaltyInterest = Math.max(0, dollars(input?.hiPenaltyInterest || 0));
  const stateTax = Math.max(0, dollars(taxAfterCredits + penaltyInterest));
  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const estimatedPayments = Math.max(0, dollars(input?.hiEstimatedPayments || 0));
  const otherPayments = Math.max(0, dollars(input?.hiOtherPayments || 0));
  const refundableEic = Math.max(0, dollars(input?.hiRefundableEic || 0));
  const otherRefundableCredits = Math.max(0, dollars(input?.hiOtherRefundableCredits || 0));
  const totalStatePayments = dollars(stateWithheld + estimatedPayments + otherPayments + refundableEic + otherRefundableCredits);
  const refundAmount = Math.max(0, dollars(totalStatePayments - stateTax));
  const owedAmount = Math.max(0, dollars(stateTax - totalStatePayments));
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;
  return {
    incomeResult: { federalAGI, additions, subtractions, hawaiiAGI, deductionMethod, deductionAmount, exemptionCount, exemptionAmount, hawaiiTaxableIncome },
    regularTax, otherTaxes, taxBeforeCredits, nonrefundableCreditsRequested, nonrefundableCreditsUsed, taxAfterCredits,
    penaltyInterest, stateTax, stateWithheld, estimatedPayments, otherPayments, refundableEic, otherRefundableCredits,
    totalStatePayments, refundAmount, owedAmount, net, isRefund: refundAmount > 0, isOwed: owedAmount > 0,
  };
}


// =============================================================================
// CONNECTICUT 2025 — SPECIAL FULL-YEAR RESIDENT CT-1040 CALCULATOR
// Uses the official 2025 Form CT-1040 Tax Calculation Schedule (Tables A-E).
// Complex allocation and unsupported special cases are blocked by the UI.
// =============================================================================
function normalizeConnecticut2025FilingStatus(filingStatus) {
  const status = String(filingStatus || "single").toLowerCase();
  if (["single", "mfj", "mfs", "hoh", "qw"].includes(status)) return status;
  return "single";
}

function getConnecticut2025PersonalExemption(connecticutAGI, filingStatus) {
  const agi = Number(connecticutAGI || 0);
  const status = normalizeConnecticut2025FilingStatus(filingStatus);
  const cfg = {
    single: { threshold: 30000, base: 15000, zeroAbove: 44000 },
    mfj:    { threshold: 48000, base: 24000, zeroAbove: 71000 },
    mfs:    { threshold: 24000, base: 12000, zeroAbove: 35000 },
    hoh:    { threshold: 38000, base: 19000, zeroAbove: 56000 },
  }[status];
  if (agi <= cfg.threshold) return cfg.base;
  if (agi > cfg.zeroAbove) return 0;
  const reductions = Math.ceil((agi - cfg.threshold) / 1000);
  return Math.max(0, cfg.base - reductions * 1000);
}

function computeConnecticut2025InitialTax(taxableIncome, filingStatus) {
  const income = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeConnecticut2025FilingStatus(filingStatus);
  let value = 0;
  if (status === "mfj") {
    if (income <= 20000) value = income * 0.02;
    else if (income <= 100000) value = 400 + (income - 20000) * 0.045;
    else if (income <= 200000) value = 4000 + (income - 100000) * 0.055;
    else if (income <= 400000) value = 9500 + (income - 200000) * 0.06;
    else if (income <= 500000) value = 21500 + (income - 400000) * 0.065;
    else if (income <= 1000000) value = 28000 + (income - 500000) * 0.069;
    else value = 62500 + (income - 1000000) * 0.0699;
  } else if (status === "hoh") {
    if (income <= 16000) value = income * 0.02;
    else if (income <= 80000) value = 320 + (income - 16000) * 0.045;
    else if (income <= 160000) value = 3200 + (income - 80000) * 0.055;
    else if (income <= 320000) value = 7600 + (income - 160000) * 0.06;
    else if (income <= 400000) value = 17200 + (income - 320000) * 0.065;
    else if (income <= 800000) value = 22400 + (income - 400000) * 0.069;
    else value = 50000 + (income - 800000) * 0.0699;
  } else {
    if (income <= 10000) value = income * 0.02;
    else if (income <= 50000) value = 200 + (income - 10000) * 0.045;
    else if (income <= 100000) value = 2000 + (income - 50000) * 0.055;
    else if (income <= 200000) value = 4750 + (income - 100000) * 0.06;
    else if (income <= 250000) value = 10750 + (income - 200000) * 0.065;
    else if (income <= 500000) value = 14000 + (income - 250000) * 0.069;
    else value = 31250 + (income - 500000) * 0.0699;
  }
  return Math.max(0, Math.round(value));
}

function getConnecticut2025PhaseOutAddBack(connecticutAGI, filingStatus) {
  const agi = Number(connecticutAGI || 0);
  const status = normalizeConnecticut2025FilingStatus(filingStatus);
  const cfg = {
    single: { threshold: 56500, step: 5000, increment: 25, max: 250 },
    mfj:    { threshold: 100500, step: 5000, increment: 50, max: 500 },
    mfs:    { threshold: 50250, step: 2500, increment: 25, max: 250 },
    hoh:    { threshold: 78500, step: 4000, increment: 40, max: 400 },
  }[status];
  if (agi <= cfg.threshold) return 0;
  return Math.min(cfg.max, Math.ceil((agi - cfg.threshold) / cfg.step) * cfg.increment);
}

function getConnecticut2025TaxRecapture(connecticutAGI, filingStatus) {
  const agi = Number(connecticutAGI || 0);
  const status = normalizeConnecticut2025FilingStatus(filingStatus);
  if (status === "mfj") {
    if (agi <= 210000) return 0;
    if (agi <= 300000) return Math.ceil((agi - 210000) / 10000) * 50;
    if (agi <= 400000) return 500;
    if (agi <= 690000) return 680 + (Math.ceil((agi - 400000) / 10000) - 1) * 180;
    if (agi <= 1000000) return 5900;
    if (agi <= 1080000) return 6000 + (Math.ceil((agi - 1000000) / 10000) - 1) * 100;
    return 6800;
  }
  if (status === "hoh") {
    if (agi <= 168000) return 0;
    if (agi <= 240000) return Math.ceil((agi - 168000) / 8000) * 40;
    if (agi <= 320000) return 400;
    if (agi <= 552000) return 540 + (Math.ceil((agi - 320000) / 8000) - 1) * 140;
    if (agi <= 800000) return 4600;
    if (agi <= 864000) return 4680 + (Math.ceil((agi - 800000) / 8000) - 1) * 80;
    return 5320;
  }
  if (agi <= 105000) return 0;
  if (agi <= 150000) return Math.ceil((agi - 105000) / 5000) * 25;
  if (agi <= 200000) return 250;
  if (agi <= 345000) return 340 + (Math.ceil((agi - 200000) / 5000) - 1) * 90;
  if (agi <= 500000) return 2950;
  if (agi <= 540000) return 3000 + (Math.ceil((agi - 500000) / 5000) - 1) * 50;
  return 3400;
}

const CONNECTICUT_2025_PERSONAL_CREDIT_TABLE = {
  single: [
    [18800,.75],[19300,.70],[19800,.65],[20300,.60],[20800,.55],[21300,.50],[21800,.45],[22300,.40],
    [25000,.35],[25500,.30],[26000,.25],[26500,.20],[31300,.15],[31800,.14],[32300,.13],[32800,.12],
    [33300,.11],[60000,.10],[60500,.09],[61000,.08],[61500,.07],[62000,.06],[62500,.05],[63000,.04],
    [63500,.03],[64000,.02],[64500,.01]
  ],
  mfj: [
    [30000,.75],[30500,.70],[31000,.65],[31500,.60],[32000,.55],[32500,.50],[33000,.45],[33500,.40],
    [40000,.35],[40500,.30],[41000,.25],[41500,.20],[50000,.15],[50500,.14],[51000,.13],[51500,.12],
    [52000,.11],[96000,.10],[96500,.09],[97000,.08],[97500,.07],[98000,.06],[98500,.05],[99000,.04],
    [99500,.03],[100000,.02],[100500,.01]
  ],
  mfs: [
    [15000,.75],[15500,.70],[16000,.65],[16500,.60],[17000,.55],[17500,.50],[18000,.45],[18500,.40],
    [20000,.35],[20500,.30],[21000,.25],[21500,.20],[25000,.15],[25500,.14],[26000,.13],[26500,.12],
    [27000,.11],[48000,.10],[48500,.09],[49000,.08],[49500,.07],[50000,.06],[50500,.05],[51000,.04],
    [51500,.03],[52000,.02],[52500,.01]
  ],
  hoh: [
    [24000,.75],[24500,.70],[25000,.65],[25500,.60],[26000,.55],[26500,.50],[27000,.45],[27500,.40],
    [34000,.35],[34500,.30],[35000,.25],[35500,.20],[44000,.15],[44500,.14],[45000,.13],[45500,.12],
    [46000,.11],[74000,.10],[74500,.09],[75000,.08],[75500,.07],[76000,.06],[76500,.05],[77000,.04],
    [77500,.03],[78000,.02],[78500,.01]
  ],
};

function getConnecticut2025PersonalCreditRate(connecticutAGI, filingStatus) {
  const agi = Number(connecticutAGI || 0);
  const status = normalizeConnecticut2025FilingStatus(filingStatus);
  const table = CONNECTICUT_2025_PERSONAL_CREDIT_TABLE[status];
  for (const [upper, rate] of table) {
    if (agi <= upper) return rate;
  }
  return 0;
}

function computeConnecticut2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const normalizedStatus = normalizeConnecticut2025FilingStatus(filingStatus);
  const money = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const federalAGIRaw = money(federalSummary?.agi);
  const additionsRaw = money(input?.ctAdditions);
  const subtractionsRaw = money(input?.ctSubtractions);
  const connecticutAGIRaw = federalAGIRaw + additionsRaw - subtractionsRaw;
  const federalAGI = Math.round(federalAGIRaw);
  const additions = Math.round(additionsRaw);
  const subtractions = Math.round(subtractionsRaw);
  const connecticutAGI = Math.round(connecticutAGIRaw);

  const personalExemption = getConnecticut2025PersonalExemption(connecticutAGIRaw, normalizedStatus);
  const connecticutTaxableIncomeRaw = Math.max(0, connecticutAGIRaw - personalExemption);
  const connecticutTaxableIncome = Math.round(connecticutTaxableIncomeRaw);
  const initialTax = computeConnecticut2025InitialTax(connecticutTaxableIncomeRaw, normalizedStatus);
  const phaseOutAddBack = getConnecticut2025PhaseOutAddBack(connecticutAGIRaw, normalizedStatus);
  const taxRecapture = getConnecticut2025TaxRecapture(connecticutAGIRaw, normalizedStatus);
  const taxBeforePersonalCredit = initialTax + phaseOutAddBack + taxRecapture;
  const personalCreditRate = getConnecticut2025PersonalCreditRate(connecticutAGIRaw, normalizedStatus);
  const personalTaxCredit = Math.round(taxBeforePersonalCredit * personalCreditRate);
  let regularTax = Math.max(0, taxBeforePersonalCredit - personalTaxCredit);

  const zeroThreshold = { single: 15000, mfj: 24000, mfs: 12000, hoh: 19000 }[normalizedStatus];
  if (connecticutAGIRaw <= zeroThreshold) regularTax = 0;

  const alternativeMinimumTax = input?.ctHasFederalAMT === true
    ? Math.max(0, Math.round(money(input?.ctAlternativeMinimumTax)))
    : 0;
  const taxBeforePropertyCredit = regularTax + alternativeMinimumTax;
  const propertyTaxCreditRequested = Math.max(0, Math.round(money(input?.ctPropertyTaxCredit)));
  const propertyTaxCredit = Math.min(300, taxBeforePropertyCredit, propertyTaxCreditRequested);
  const taxAfterPropertyCredit = Math.max(0, taxBeforePropertyCredit - propertyTaxCredit);
  const allowableCreditsRequested = Math.max(0, Math.round(money(input?.ctAllowableCredits)));
  const allowableCreditsUsed = Math.min(taxAfterPropertyCredit, allowableCreditsRequested);
  const connecticutIncomeTax = Math.max(0, taxAfterPropertyCredit - allowableCreditsUsed);
  const useTax = Math.max(0, Math.round(money(input?.ctUseTax)));
  const taxBeforePenalty = connecticutIncomeTax + useTax;
  const penaltyInterest = Math.max(0, Math.round(money(input?.ctPenaltyInterest)));
  const stateTax = taxBeforePenalty + penaltyInterest;

  const stateWithheld = Math.max(0, Math.round(money(input?.stateWithheld)));
  const estimatedPayments = Math.max(0, Math.round(money(input?.ctEstimatedPayments)));
  const extensionPayment = Math.max(0, Math.round(money(input?.ctExtensionPayment)));
  const federalEitc = input?.ctClaimedFederalEITC === true
    ? Math.max(0, money(input?.ctFederalEITCAmount))
    : 0;
  const connecticutEitc = input?.ctClaimedFederalEITC === true
    ? Math.max(0, Math.round(federalEitc * 0.40) + (input?.ctEitcHasQualifyingChild === true ? 250 : 0))
    : 0;
  const otherRefundableCredits = Math.max(0, Math.round(money(input?.ctOtherRefundableCredits)));
  const totalStatePayments = stateWithheld + estimatedPayments + extensionPayment + connecticutEitc + otherRefundableCredits;

  const rawNet = totalStatePayments - stateTax;
  const overpayment = Math.max(0, rawNet);
  const amountDue = Math.max(0, -rawNet);
  const refundAllocationsRequested = Math.max(0, Math.round(money(input?.ctRefundAllocations)));
  const refundAllocationsUsed = Math.min(overpayment, refundAllocationsRequested);
  const refundAmount = Math.max(0, overpayment - refundAllocationsUsed);
  const owedAmount = amountDue;
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    incomeResult: { federalAGI, additions, subtractions, connecticutAGI, personalExemption, connecticutTaxableIncome },
    normalizedStatus, initialTax, phaseOutAddBack, taxRecapture, taxBeforePersonalCredit,
    personalCreditRate, personalTaxCredit, regularTax, alternativeMinimumTax,
    propertyTaxCreditRequested, propertyTaxCredit, allowableCreditsRequested, allowableCreditsUsed,
    connecticutIncomeTax, useTax, taxBeforePenalty, penaltyInterest, stateTax,
    stateWithheld, estimatedPayments, extensionPayment, federalEitc, connecticutEitc,
    otherRefundableCredits, totalStatePayments, overpayment, refundAllocationsRequested,
    refundAllocationsUsed, refundAmount, owedAmount, net,
    isRefund: refundAmount > 0,
    isOwed: owedAmount > 0,
  };
}

// =============================================================================
// MASSACHUSETTS 2025 — SPECIAL FULL-YEAR RESIDENT FORM 1 CALCULATOR
// Official TY2025 core path. Exact completed Massachusetts schedule amounts are
// required where the nationwide estimator cannot safely derive a state-only
// figure. Allocation and material special cases are blocked by validation.
// =============================================================================
function normalizeMassachusetts2025FilingStatus(input = {}) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  if (status === "qw") return "hoh";
  if (["single", "mfj", "mfs", "hoh"].includes(status)) return status;
  return "single";
}

function getMassachusetts2025PersonalExemption(input = {}) {
  const status = normalizeMassachusetts2025FilingStatus(input);
  if (status === "mfj") return 8800;
  if (status === "hoh") return 6800;
  return 4400;
}

function computeMassachusetts2025TotalExemptions(input = {}) {
  const status = normalizeMassachusetts2025FilingStatus(input);
  const deps = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  let total = getMassachusetts2025PersonalExemption(input) + deps * 1000;
  if (Number(input?.age || 0) >= 65) total += 700;
  if (status === "mfj" && Number(input?.spouseAge || 0) >= 65) total += 700;
  if (input?.maTaxpayerBlind === true) total += 2200;
  if (status === "mfj" && input?.maSpouseBlind === true) total += 2200;
  total += Math.max(0, Math.round(dollars(input?.maMedicalDentalExemption)));
  total += Math.max(0, Math.round(dollars(input?.maAdoptionExemption)));
  return Math.max(0, Math.round(total));
}

function computeMassachusetts2025FivePercentTax(taxableFivePercentIncome) {
  const x = Math.max(0, Math.round(Number(taxableFivePercentIncome || 0)));
  if (x < 10) return 0;
  if (x <= 24000) {
    const bandUpper = Math.ceil(x / 50) * 50;
    const midpoint = bandUpper - 25;
    return Math.max(0, Math.round(midpoint * 0.05));
  }
  return Math.max(0, Math.round(x * 0.05));
}

function getMassachusetts2025NoTaxStatusThreshold(input = {}) {
  const status = normalizeMassachusetts2025FilingStatus(input);
  const deps = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  if (status === "single") return 8000;
  if (status === "hoh") return 14400 + deps * 1000;
  if (status === "mfj") return 16400 + deps * 1000;
  return null;
}

function getMassachusetts2025LimitedIncomeMaximum(input = {}) {
  const status = normalizeMassachusetts2025FilingStatus(input);
  const deps = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  if (status === "single") return 14000;
  if (status === "hoh") return 25200 + deps * 1750;
  if (status === "mfj") return 28700 + deps * 1750;
  return null;
}

function computeMassachusetts2025LimitedIncomeCredit(input = {}, massachusettsAGI = 0, taxBeforeLic = 0) {
  const status = normalizeMassachusetts2025FilingStatus(input);
  if (status === "mfs") return 0;
  const ntsThreshold = getMassachusetts2025NoTaxStatusThreshold(input);
  const licMaximum = getMassachusetts2025LimitedIncomeMaximum(input);
  const agi = Math.max(0, Math.round(Number(massachusettsAGI || 0)));
  if (ntsThreshold === null || licMaximum === null || agi <= ntsThreshold || agi > licMaximum) return 0;
  const incomeOverNts = Math.max(0, agi - ntsThreshold);
  const limitedTax = Math.max(0, Math.round(incomeOverNts * 0.10));
  return Math.max(0, Math.round(Number(taxBeforeLic || 0)) - limitedTax);
}

function computeMassachusetts2025Tax(input = {}, federalSummary = {}) {
  const status = normalizeMassachusetts2025FilingStatus(input);
  const fivePercentIncome = Math.max(0, Math.round(dollars(input?.maTotalFivePercentIncome)));
  const deductions = Math.max(0, Math.round(dollars(input?.maTotalDeductions)));
  const line17 = Math.max(0, fivePercentIncome - deductions);
  const exemptions = computeMassachusetts2025TotalExemptions(input);
  const line19 = Math.max(0, line17 - exemptions);
  const scheduleBLine20 = Math.max(0, Math.round(dollars(input?.maScheduleBLine20)));
  const line21 = Math.max(0, line19 + scheduleBLine20);
  const line22Tax = computeMassachusetts2025FivePercentTax(line21);
  const scheduleB85Income = Math.max(0, Math.round(dollars(input?.maScheduleB85Income)));
  const scheduleB12Income = Math.max(0, Math.round(dollars(input?.maScheduleB12Income)));
  const line23aTax = Math.max(0, Math.round(scheduleB85Income * 0.085));
  const line23bTax = Math.max(0, Math.round(scheduleB12Income * 0.12));
  const longTermCapitalGainsTax = Math.max(0, Math.round(dollars(input?.maLongTermCapitalGainsTax)));
  const creditRecapture = Math.max(0, Math.round(dollars(input?.maCreditRecapture)));
  const installmentSaleAdditionalTax = Math.max(0, Math.round(dollars(input?.maInstallmentSaleAdditionalTax)));
  const massachusettsAGI = Math.max(0, Math.round(dollars(input?.maMassachusettsAGI)));
  const ntsThreshold = getMassachusetts2025NoTaxStatusThreshold(input);
  const noTaxStatus = status !== "mfs" && ntsThreshold !== null && massachusettsAGI <= ntsThreshold;
  const ordinaryIncomeTaxes = noTaxStatus ? 0 : line22Tax + line23aTax + line23bTax + longTermCapitalGainsTax;
  const line28a = ordinaryIncomeTaxes + creditRecapture + installmentSaleAdditionalTax;
  const scheduleBLine37 = Math.max(0, Math.round(dollars(input?.maScheduleBLine37SurtaxIncome)));
  const scheduleDLine21 = Math.max(0, Math.round(dollars(input?.maScheduleDLine21SurtaxIncome)));
  const surtaxBase = Math.max(0, line19 + scheduleBLine37 + scheduleDLine21);
  const surtax = Math.max(0, Math.round(Math.max(0, surtaxBase - 1083150) * 0.04));
  const line28 = line28a + surtax;
  const taxEligibleForLic = Math.max(0, line28 - creditRecapture - installmentSaleAdditionalTax);
  const limitedIncomeCredit = noTaxStatus ? 0 : computeMassachusetts2025LimitedIncomeCredit(input, massachusettsAGI, taxEligibleForLic);
  const otherNonrefundableCreditsRequested = Math.max(0, Math.round(dollars(input?.maOtherNonrefundableCredits)));
  const afterLic = Math.max(0, line28 - limitedIncomeCredit);
  const otherNonrefundableCreditsUsed = Math.min(afterLic, otherNonrefundableCreditsRequested);
  const line32 = Math.max(0, afterLic - otherNonrefundableCreditsUsed);
  const voluntaryContributions = Math.max(0, Math.round(dollars(input?.maVoluntaryContributions)));
  const useTax = Math.max(0, Math.round(dollars(input?.maUseTax)));
  const healthCarePenalty = Math.max(0, Math.round(dollars(input?.maHealthCarePenalty)));
  const line37 = line32 + voluntaryContributions + useTax + healthCarePenalty;

  const claimedFederalEitc = input?.maClaimedFederalEITC === true;
  const federalEitc = claimedFederalEitc ? Math.max(0, Math.round(dollars(input?.maFederalEITCAmount))) : 0;
  const massachusettsEitc = Math.max(0, Math.round(federalEitc * 0.40));
  const seniorCircuitBreakerCredit = Math.max(0, Math.round(dollars(input?.maSeniorCircuitBreakerCredit)));
  const childFamilyCount = Math.max(0, Math.trunc(Number(input?.maChildFamilyQualifyingCount || 0)));
  const childFamilyTaxCredit = childFamilyCount * 440;
  const otherRefundableCredits = Math.max(0, Math.round(dollars(input?.maOtherRefundableCredits)));
  const refundableCredits = massachusettsEitc + seniorCircuitBreakerCredit + childFamilyTaxCredit + otherRefundableCredits;

  const stateWithheld = Math.max(0, Math.round(dollars(input?.stateWithheld)));
  const otherMassachusettsWithholding = Math.max(0, Math.round(dollars(input?.maOtherMassachusettsWithholding)));
  const priorYearOverpaymentApplied = Math.max(0, Math.round(dollars(input?.maPriorYearOverpaymentApplied)));
  const estimatedPayments = Math.max(0, Math.round(dollars(input?.maEstimatedPayments)));
  const extensionPayments = Math.max(0, Math.round(dollars(input?.maExtensionPayments)));
  const excessPfmlWithholding = Math.max(0, Math.round(dollars(input?.maExcessPfmlWithholding)));
  const realEstateWithholding = Math.max(0, Math.round(dollars(input?.maRealEstateWithholding)));
  const totalStatePayments = stateWithheld + otherMassachusettsWithholding + priorYearOverpaymentApplied + estimatedPayments + extensionPayments + refundableCredits + excessPfmlWithholding + realEstateWithholding;
  const penaltyInterest = Math.max(0, Math.round(dollars(input?.maPenaltyInterest)));
  const stateTax = line37 + penaltyInterest;
  const rawNet = totalStatePayments - stateTax;
  const overpayment = Math.max(0, rawNet);
  const amountDue = Math.max(0, -rawNet);
  const creditToNextYearRequested = Math.max(0, Math.round(dollars(input?.maCreditToNextYear)));
  const creditToNextYearUsed = Math.min(overpayment, creditToNextYearRequested);
  const refundAmount = Math.max(0, overpayment - creditToNextYearUsed);
  const owedAmount = amountDue;
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    status, fivePercentIncome, deductions, line17, exemptions, line19, scheduleBLine20, line21,
    line22Tax, scheduleB85Income, scheduleB12Income, line23aTax, line23bTax, longTermCapitalGainsTax,
    creditRecapture, installmentSaleAdditionalTax, massachusettsAGI, ntsThreshold, noTaxStatus,
    ordinaryIncomeTaxes, line28a, scheduleBLine37, scheduleDLine21, surtaxBase, surtax, line28,
    taxEligibleForLic, limitedIncomeCredit, otherNonrefundableCreditsRequested, otherNonrefundableCreditsUsed,
    line32, voluntaryContributions, useTax, healthCarePenalty, line37,
    federalEitc, massachusettsEitc, seniorCircuitBreakerCredit, childFamilyCount, childFamilyTaxCredit,
    otherRefundableCredits, refundableCredits, stateWithheld, otherMassachusettsWithholding,
    priorYearOverpaymentApplied, estimatedPayments, extensionPayments, excessPfmlWithholding, realEstateWithholding,
    totalStatePayments, penaltyInterest, stateTax, overpayment, creditToNextYearRequested, creditToNextYearUsed,
    refundAmount, owedAmount, net, isRefund: refundAmount > 0, isOwed: owedAmount > 0,
    incomeResult: { line17, exemptions, line19, scheduleBLine20, line21, surtaxBase, massachusettsAGI },
  };
}

// =============================================================================
// NEW JERSEY 2025 — SPECIAL FULL-YEAR RESIDENT NJ-1040 CALCULATOR
// Uses exact NJ-defined gross income and completed-return deduction/credit inputs.
// The statutory rate schedule is used directly at $100,000 or more; below that
// threshold the mandatory $50-band tax table is reproduced from the midpoint of
// each official band. Unsupported allocation/special-return cases are blocked.
// =============================================================================
function normalizeNewJersey2025FilingStatus(input = {}) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  if (["single", "mfj", "mfs", "hoh", "qw"].includes(status)) return status;
  return "single";
}

function computeNewJersey2025ExemptionAmount(input = {}) {
  const status = normalizeNewJersey2025FilingStatus(input);
  let amount = 1000; // taxpayer regular exemption
  if (status === "mfj") amount += 1000;
  if (input?.njClaimsDomesticPartnerExemption === true) amount += 1000;
  if (Number(input?.age || 0) >= 65) amount += 1000;
  if (status === "mfj" && Number(input?.spouseAge || 0) >= 65) amount += 1000;
  if (input?.njTaxpayerBlindOrDisabled === true) amount += 1000;
  if (status === "mfj" && input?.njSpouseBlindOrDisabled === true) amount += 1000;
  if (input?.njTaxpayerVeteran === true) amount += 6000;
  if (status === "mfj" && input?.njSpouseVeteran === true) amount += 6000;
  amount += Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0))) * 1500;
  amount += Math.max(0, Math.trunc(Number(input?.njCollegeDependentCount || 0))) * 1000;
  return Math.max(0, Math.round(amount));
}

function computeNewJersey2025RateScheduleTax(taxableIncome, input = {}) {
  const x = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeNewJersey2025FilingStatus(input);
  const tableB = ["mfj", "hoh", "qw"].includes(status);
  let raw = 0;
  if (tableB) {
    if (x <= 20000) raw = x * 0.014;
    else if (x <= 50000) raw = x * 0.0175 - 70;
    else if (x <= 70000) raw = x * 0.0245 - 420;
    else if (x <= 80000) raw = x * 0.035 - 1154.50;
    else if (x <= 150000) raw = x * 0.05525 - 2775;
    else if (x <= 500000) raw = x * 0.0637 - 4042.50;
    else if (x <= 1000000) raw = x * 0.0897 - 17042.50;
    else raw = x * 0.1075 - 34842.50;
  } else {
    if (x <= 20000) raw = x * 0.014;
    else if (x <= 35000) raw = x * 0.0175 - 70;
    else if (x <= 40000) raw = x * 0.035 - 682.50;
    else if (x <= 75000) raw = x * 0.05525 - 1492.50;
    else if (x <= 500000) raw = x * 0.0637 - 2126.25;
    else if (x <= 1000000) raw = x * 0.0897 - 15126.25;
    else raw = x * 0.1075 - 32926.25;
  }
  return Math.max(0, Math.round(raw));
}

function computeNewJersey2025TaxTable(taxableIncome, input = {}) {
  const x = Math.max(0, Math.floor(Number(taxableIncome || 0)));
  if (x >= 100000) return computeNewJersey2025RateScheduleTax(x, input);
  const bandStart = Math.floor(x / 50) * 50;
  const midpoint = bandStart + 25;
  return computeNewJersey2025RateScheduleTax(midpoint, input);
}

function computeNewJersey2025ChildDependentCareCredit(federalCredit, taxableIncome) {
  const fed = Math.max(0, Number(federalCredit || 0));
  const x = Math.max(0, Number(taxableIncome || 0));
  let pct = 0;
  if (x <= 30000) pct = 0.50;
  else if (x <= 60000) pct = 0.40;
  else if (x <= 90000) pct = 0.30;
  else if (x <= 120000) pct = 0.20;
  else if (x <= 150000) pct = 0.10;
  return Math.max(0, Math.round(fed * pct));
}

function getNewJersey2025ChildTaxCreditPerChild(taxableIncome) {
  const x = Math.max(0, Number(taxableIncome || 0));
  if (x <= 30000) return 1000;
  if (x <= 40000) return 800;
  if (x <= 50000) return 600;
  if (x <= 60000) return 400;
  if (x <= 80000) return 200;
  return 0;
}

function computeNewJersey2025Tax(input = {}, federalSummary = {}) {
  const status = normalizeNewJersey2025FilingStatus(input);
  const njGrossIncome = Math.max(0, Math.round(Number(input?.njGrossIncome || 0)));
  const exemptions = computeNewJersey2025ExemptionAmount(input);
  const deductionFields = [
    "njMedicalExpenseDeduction", "njAlimonyDeduction", "njQualifiedConservationDeduction",
    "njHealthEnterpriseZoneDeduction", "njAlternativeBusinessAdjustment", "njOrganBoneMarrowDeduction",
    "njNjbestDeduction", "njNjclassDeduction", "njTuitionDeduction"
  ];
  const otherDeductionsRaw = deductionFields.reduce((sum, field) => sum + Math.max(0, Number(input?.[field] || 0)), 0);
  const otherDeductions = Math.max(0, Math.round(otherDeductionsRaw));
  const line38 = Math.max(0, Math.round(exemptions + otherDeductions));
  const line39 = Math.max(0, Math.round(njGrossIncome - line38));

  const propertyEligible = input?.njPropertyTaxBenefitEligible === true;
  const propertyTaxLine40a = propertyEligible ? Math.max(0, Math.round(Number(input?.njPropertyTaxesLine40a || 0))) : 0;
  const propertyTaxDeductionCandidate = propertyEligible ? Math.min(15000, propertyTaxLine40a) : 0;
  const taxWithoutPropertyDeduction = computeNewJersey2025TaxTable(line39, input);
  const taxableWithPropertyDeduction = Math.max(0, line39 - propertyTaxDeductionCandidate);
  const taxWithPropertyDeduction = computeNewJersey2025TaxTable(taxableWithPropertyDeduction, input);
  const propertyTaxSavings = Math.max(0, taxWithoutPropertyDeduction - taxWithPropertyDeduction);
  const usesPropertyTaxDeduction = propertyEligible && propertyTaxDeductionCandidate > 0 && propertyTaxSavings >= 50;
  const propertyTaxDeduction = usesPropertyTaxDeduction ? propertyTaxDeductionCandidate : 0;
  const propertyTaxCredit = propertyEligible && !usesPropertyTaxDeduction ? 50 : 0;
  const line42 = Math.max(0, line39 - propertyTaxDeduction);
  const line43Tax = computeNewJersey2025TaxTable(line42, input);

  const otherNonrefundableCreditsRequested = Math.max(0, Math.round(Number(input?.njOtherNonrefundableCredits || 0)));
  const otherNonrefundableCreditsUsed = Math.min(line43Tax, otherNonrefundableCreditsRequested);
  const line50 = Math.max(0, line43Tax - otherNonrefundableCreditsUsed);
  const useTax = Math.max(0, Math.round(Number(input?.njUseTax || 0)));
  const underpaymentInterest = Math.max(0, Math.round(Number(input?.njUnderpaymentInterest || 0)));
  const sharedResponsibilityPayment = Math.max(0, Math.round(Number(input?.njSharedResponsibilityPayment || 0)));
  const line54TotalTaxDue = line50 + useTax + underpaymentInterest + sharedResponsibilityPayment;

  // Line 55 is a total withholding line: preserve cents across sources, then round the total.
  const stateWithheldRaw = Math.max(0, Number(input?.stateWithheld || 0));
  const otherNJWithholdingRaw = Math.max(0, Number(input?.njOtherNJWithholding || 0));
  const withholdingTotal = Math.max(0, Math.round(stateWithheldRaw + otherNJWithholdingRaw));
  const paymentsCreditFromPriorYear = Math.max(0, Math.round(Number(input?.njPaymentsCreditFromPriorYear || 0)));
  const federalEitc = input?.njClaimedFederalEITC === true ? Math.max(0, Math.round(Number(input?.njFederalEITCAmount || 0))) : 0;
  const newJerseyEitc = input?.njClaimedFederalEITC === true ? Math.max(0, Math.round(federalEitc * 0.40)) : 0;
  const excessUiWfSwfCredit = Math.max(0, Math.round(Number(input?.njExcessUiWfSwfCredit || 0)));
  const excessDiCredit = Math.max(0, Math.round(Number(input?.njExcessDiCredit || 0)));
  const excessFliCredit = Math.max(0, Math.round(Number(input?.njExcessFliCredit || 0)));
  const woundedWarriorCredit = Math.max(0, Math.round(Number(input?.njWoundedWarriorCredit || 0)));
  const pteBaitCredit = Math.max(0, Math.round(Number(input?.njPteBaitCredit || 0)));
  const federalChildDependentCareCredit = Math.max(0, Math.round(Number(input?.njFederalChildDependentCareCredit || 0)));
  const childDependentCareCredit = computeNewJersey2025ChildDependentCareCredit(federalChildDependentCareCredit, line42);
  const childTaxCreditCount = Math.max(0, Math.trunc(Number(input?.njChildTaxCreditUnder6Count || 0)));
  const childTaxCreditPerChild = getNewJersey2025ChildTaxCreditPerChild(line42);
  const childTaxCredit = status === "mfs" ? 0 : childTaxCreditCount * childTaxCreditPerChild;

  const refundableCredits = propertyTaxCredit + newJerseyEitc + excessUiWfSwfCredit + excessDiCredit + excessFliCredit + woundedWarriorCredit + pteBaitCredit + childDependentCareCredit + childTaxCredit;
  const totalStatePayments = withholdingTotal + paymentsCreditFromPriorYear + refundableCredits;
  const rawNet = totalStatePayments - line54TotalTaxDue;
  const line68Overpayment = Math.max(0, rawNet);
  const baseAmountDue = Math.max(0, -rawNet);
  const creditToNextYearRequested = Math.max(0, Math.round(Number(input?.njCreditToNextYear || 0)));
  const creditToNextYearUsed = Math.min(line68Overpayment, creditToNextYearRequested);
  const charitableContributions = Math.max(0, Math.round(Number(input?.njCharitableContributions || 0)));
  const line78Adjustments = creditToNextYearUsed + charitableContributions;
  const finalNet = line68Overpayment - line78Adjustments - baseAmountDue;
  const refundAmount = Math.max(0, finalNet);
  const owedAmount = Math.max(0, -finalNet);
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    status, njGrossIncome, exemptions, otherDeductions, line38, line39,
    propertyEligible, propertyTaxLine40a, propertyTaxDeductionCandidate, taxWithoutPropertyDeduction,
    taxWithPropertyDeduction, propertyTaxSavings, usesPropertyTaxDeduction, propertyTaxDeduction, propertyTaxCredit,
    line42, line43Tax, otherNonrefundableCreditsRequested, otherNonrefundableCreditsUsed, line50,
    useTax, underpaymentInterest, sharedResponsibilityPayment, line54TotalTaxDue,
    withholdingTotal, paymentsCreditFromPriorYear, federalEitc, newJerseyEitc,
    excessUiWfSwfCredit, excessDiCredit, excessFliCredit, woundedWarriorCredit, pteBaitCredit,
    federalChildDependentCareCredit, childDependentCareCredit, childTaxCreditCount, childTaxCreditPerChild, childTaxCredit,
    refundableCredits, totalStatePayments, rawNet, line68Overpayment, baseAmountDue,
    creditToNextYearRequested, creditToNextYearUsed, charitableContributions, line78Adjustments,
    refundAmount, owedAmount, net, isRefund: refundAmount > 0, isOwed: owedAmount > 0,
    incomeResult: { newJerseyGrossIncome: njGrossIncome, line38, line39, propertyTaxDeduction, line42 },
  };
}

// =============================================================================
// NEW YORK 2025 — SPECIAL FULL-YEAR RESIDENT IT-201 CALCULATOR
// Core resident support uses official 2025 standard deductions, dependent
// exemptions, $50-band tax table mechanics, state/NYC rate schedules and
// household-credit tables. High-NYAGI IT-201 worksheet tax and complex credits
// are accepted only as exact completed-form amounts rather than approximated.
// =============================================================================
function normalizeNewYork2025FilingStatus(input = {}) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  if (["single", "mfj", "mfs", "hoh", "qw"].includes(status)) return status;
  return "single";
}

function getNewYork2025StandardDeduction(input = {}) {
  const status = normalizeNewYork2025FilingStatus(input);
  if (status === "single") return input?.canBeClaimedAsDependent === true ? 3100 : 8000;
  if (status === "mfj" || status === "qw") return 16050;
  if (status === "hoh") return 11200;
  return 8000;
}

function computeNewYork2025RateScheduleTax(taxableIncome, input = {}) {
  const x = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeNewYork2025FilingStatus(input);
  let raw = 0;
  if (status === "mfj" || status === "qw") {
    if (x <= 17150) raw = x * 0.04;
    else if (x <= 23600) raw = 686 + (x - 17150) * 0.045;
    else if (x <= 27900) raw = 976 + (x - 23600) * 0.0525;
    else if (x <= 161550) raw = 1202 + (x - 27900) * 0.055;
    else if (x <= 323200) raw = 8553 + (x - 161550) * 0.06;
    else if (x <= 2155350) raw = 18252 + (x - 323200) * 0.0685;
    else if (x <= 5000000) raw = 143754 + (x - 2155350) * 0.0965;
    else if (x <= 25000000) raw = 418263 + (x - 5000000) * 0.103;
    else raw = 2478263 + (x - 25000000) * 0.109;
  } else if (status === "hoh") {
    if (x <= 12800) raw = x * 0.04;
    else if (x <= 17650) raw = 512 + (x - 12800) * 0.045;
    else if (x <= 20900) raw = 730 + (x - 17650) * 0.0525;
    else if (x <= 107650) raw = 901 + (x - 20900) * 0.055;
    else if (x <= 269300) raw = 5672 + (x - 107650) * 0.06;
    else if (x <= 1616450) raw = 15371 + (x - 269300) * 0.0685;
    else if (x <= 5000000) raw = 107651 + (x - 1616450) * 0.0965;
    else if (x <= 25000000) raw = 434163 + (x - 5000000) * 0.103;
    else raw = 2494163 + (x - 25000000) * 0.109;
  } else {
    if (x <= 8500) raw = x * 0.04;
    else if (x <= 11700) raw = 340 + (x - 8500) * 0.045;
    else if (x <= 13900) raw = 484 + (x - 11700) * 0.0525;
    else if (x <= 80650) raw = 600 + (x - 13900) * 0.055;
    else if (x <= 215400) raw = 4271 + (x - 80650) * 0.06;
    else if (x <= 1077550) raw = 12356 + (x - 215400) * 0.0685;
    else if (x <= 5000000) raw = 71413 + (x - 1077550) * 0.0965;
    else if (x <= 25000000) raw = 449929 + (x - 5000000) * 0.103;
    else raw = 2509929 + (x - 25000000) * 0.109;
  }
  return Math.max(0, Math.round(raw));
}

function computeNewYork2025TaxTable(taxableIncome, input = {}) {
  const x = Math.max(0, Math.floor(Number(taxableIncome || 0)));
  if (x >= 65000) return computeNewYork2025RateScheduleTax(x, input);
  // The official 2025 table starts with three special low-income bands
  // before settling into $50 bands: $0-$12 => $0; $13-$24 => $1;
  // $25-$49 => $2. From $50 through $64,999, each $50 band equals
  // the rounded rate-schedule tax at that band's midpoint.
  if (x < 13) return 0;
  if (x < 25) return 1;
  if (x < 50) return 2;
  const bandStart = Math.floor(x / 50) * 50;
  return computeNewYork2025RateScheduleTax(bandStart + 25, input);
}

function computeNewYork2025HouseholdCredit(federalAGI, input = {}) {
  if (input?.canBeClaimedAsDependent === true) return 0;
  const fagi = Number(federalAGI || 0);
  const status = normalizeNewYork2025FilingStatus(input);
  if (status === "single") {
    if (fagi <= 5000) return 75;
    if (fagi <= 6000) return 60;
    if (fagi <= 7000) return 50;
    if (fagi <= 20000) return 45;
    if (fagi <= 25000) return 40;
    if (fagi <= 28000) return 20;
    return 0;
  }
  if (!["mfj", "hoh", "qw"].includes(status)) return 0;
  const size = Math.max(1, Math.trunc(Number(input?.numberOfDependents || 0)) + (status === "mfj" ? 2 : 1));
  let row;
  if (fagi <= 5000) row = [90,105,120,135,150,165,180,15];
  else if (fagi <= 6000) row = [75,90,105,120,135,150,165,15];
  else if (fagi <= 7000) row = [65,80,95,110,125,140,155,15];
  else if (fagi <= 20000) row = [60,75,90,105,120,135,150,15];
  else if (fagi <= 22000) row = [60,70,80,90,100,110,120,10];
  else if (fagi <= 25000) row = [50,60,70,80,90,100,110,10];
  else if (fagi <= 28000) row = [40,45,50,55,60,65,70,5];
  else if (fagi <= 32000) row = [20,25,30,35,40,45,50,5];
  else return 0;
  if (size <= 7) return row[size - 1];
  return row[6] + (size - 7) * row[7];
}

function computeNewYorkCity2025RateScheduleTax(taxableIncome, input = {}) {
  const x = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeNewYork2025FilingStatus(input);
  let raw = 0;
  if (status === "mfj" || status === "qw") {
    if (x <= 21600) raw = x * 0.03078;
    else if (x <= 45000) raw = 665 + (x - 21600) * 0.03762;
    else if (x <= 90000) raw = 1545 + (x - 45000) * 0.03819;
    else raw = 3264 + (x - 90000) * 0.03876;
  } else if (status === "hoh") {
    if (x <= 14400) raw = x * 0.03078;
    else if (x <= 30000) raw = 443 + (x - 14400) * 0.03762;
    else if (x <= 60000) raw = 1030 + (x - 30000) * 0.03819;
    else raw = 2176 + (x - 60000) * 0.03876;
  } else {
    if (x <= 12000) raw = x * 0.03078;
    else if (x <= 25000) raw = 369 + (x - 12000) * 0.03762;
    else if (x <= 50000) raw = 858 + (x - 25000) * 0.03819;
    else raw = 1813 + (x - 50000) * 0.03876;
  }
  return Math.max(0, Math.round(raw));
}

function computeNewYorkCity2025TaxTable(taxableIncome, input = {}) {
  const x = Math.max(0, Math.floor(Number(taxableIncome || 0)));
  if (x >= 65000) return computeNewYorkCity2025RateScheduleTax(x, input);
  // The official NYC table has a special zero-tax opening band of
  // $0-$17, then $1 from $18-$49, before regular $50 bands begin.
  if (x < 18) return 0;
  if (x < 50) return 1;
  const bandStart = Math.floor(x / 50) * 50;
  return computeNewYorkCity2025RateScheduleTax(bandStart + 25, input);
}

function computeNewYorkCity2025HouseholdCredit(federalAGI, input = {}) {
  if (input?.canBeClaimedAsDependent === true) return 0;
  const fagi = Number(federalAGI || 0);
  const status = normalizeNewYork2025FilingStatus(input);
  if (status === "single") {
    if (fagi <= 10000) return 15;
    if (fagi <= 12500) return 10;
    return 0;
  }
  if (!["mfj", "hoh", "qw"].includes(status)) return 0;
  const size = Math.max(1, Math.trunc(Number(input?.numberOfDependents || 0)) + (status === "mfj" ? 2 : 1));
  let row;
  if (fagi <= 15000) row = [30,60,90,120,150,180,210,30];
  else if (fagi <= 17500) row = [25,50,75,100,125,150,175,25];
  else if (fagi <= 20000) row = [15,30,45,60,75,90,105,15];
  else if (fagi <= 22500) row = [10,20,30,40,50,60,70,10];
  else return 0;
  if (size <= 7) return row[size - 1];
  return row[6] + (size - 7) * row[7];
}

function computeNewYork2025EmpireStateChildCredit(federalAGI, input = {}) {
  const under4 = Math.max(0, Math.trunc(Number(input?.nyEmpireChildUnder4Count || 0)));
  const age4to16 = Math.max(0, Math.trunc(Number(input?.nyEmpireChild4To16Count || 0)));
  let credit = under4 * 1000 + age4to16 * 330;
  const status = normalizeNewYork2025FilingStatus(input);
  const threshold = status === "mfj" ? 110000 : status === "mfs" ? 55000 : 75000;
  const roundedFagi = Math.floor(Math.max(0, Number(federalAGI || 0)) / 1000) * 1000;
  if (roundedFagi > threshold) credit -= ((roundedFagi - threshold) / 1000) * 16.5;
  return Math.max(0, Math.round(credit));
}

function computeNewYork2025Tax(input = {}, federalSummary = {}) {
  const status = normalizeNewYork2025FilingStatus(input);
  const federalAGI = Math.round(Number(federalSummary?.agi ?? 0));
  const additions = Math.max(0, Math.round(Number(input?.nyAdditions || 0)));
  const subtractions = Math.max(0, Math.round(Number(input?.nySubtractions || 0)));
  const nyAGI = Math.max(0, federalAGI + additions - subtractions);
  const deductionMethod = String(input?.nyDeductionMethod || "standard");
  const deduction = deductionMethod === "itemized"
    ? Math.max(0, Math.round(Number(input?.nyItemizedDeduction || 0)))
    : getNewYork2025StandardDeduction(input);
  const dependentExemption = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0))) * 1000;
  const taxableIncome = Math.max(0, nyAGI - deduction - dependentExemption);
  const stateTaxBeforeCredits = nyAGI > 107650
    ? Math.max(0, Math.round(Number(input?.nyHighIncomeLine39Tax || 0)))
    : computeNewYork2025TaxTable(taxableIncome, input);
  const householdCredit = computeNewYork2025HouseholdCredit(federalAGI, input);
  const otherNonrefundableCreditsRequested = Math.max(0, Math.round(Number(input?.nyOtherNonrefundableCredits || 0)));
  const stateCreditsUsed = Math.min(stateTaxBeforeCredits, householdCredit + otherNonrefundableCreditsRequested);
  const otherStateTaxes = Math.max(0, Math.round(Number(input?.nyOtherStateTaxes || 0)));
  const stateTaxAfterCredits = Math.max(0, stateTaxBeforeCredits - stateCreditsUsed) + otherStateTaxes;

  const locality = String(input?.nyLocality || "none").toLowerCase();
  const nycTaxableIncome = locality === "nyc" ? Math.max(0, Math.round(Number(input?.nyNycTaxableIncome || 0))) : 0;
  const nycTaxBeforeCredits = locality === "nyc" ? computeNewYorkCity2025TaxTable(nycTaxableIncome, input) : 0;
  const nycHouseholdCredit = locality === "nyc" ? computeNewYorkCity2025HouseholdCredit(federalAGI, input) : 0;
  const nycNonrefundableRequested = locality === "nyc" ? Math.max(0, Math.round(Number(input?.nyNycNonrefundableCredits || 0))) : 0;
  const nycNonrefundableUsed = Math.min(nycTaxBeforeCredits, nycHouseholdCredit + nycNonrefundableRequested);
  const nycOtherTaxes = locality === "nyc" ? Math.max(0, Math.round(Number(input?.nyNycOtherTaxes || 0))) : 0;
  const nycTaxAfterCredits = Math.max(0, nycTaxBeforeCredits - nycNonrefundableUsed) + nycOtherTaxes;
  const yonkersResidentSurcharge = locality === "yonkers" ? Math.max(0, Math.round(Number(input?.nyYonkersResidentSurcharge || 0))) : 0;
  const mctmt = Math.max(0, Math.round(Number(input?.nyMctmt || 0)));
  const salesUseTax = Math.max(0, Math.round(Number(input?.nySalesUseTax || 0)));

  const empireStateChildCredit = computeNewYork2025EmpireStateChildCredit(federalAGI, input);
  const stateChildDependentCareCredit = Math.max(0, Math.round(Number(input?.nyStateChildDependentCareCredit || 0)));
  const federalEitc = input?.nyClaimedFederalEITC === true ? Math.max(0, Math.round(Number(input?.nyFederalEITCAmount || 0))) : 0;
  const stateEitc = input?.nyClaimedFederalEITC === true ? Math.max(0, Math.round(federalEitc * 0.30 - householdCredit)) : 0;
  const realPropertyTaxCredit = Math.max(0, Math.round(Number(input?.nyRealPropertyTaxCredit || 0)));
  const collegeTuitionCredit = Math.max(0, Math.round(Number(input?.nyCollegeTuitionCredit || 0)));
  const nycChildDependentCareCredit = locality === "nyc" ? Math.max(0, Math.round(Number(input?.nyNycChildDependentCareCredit || 0))) : 0;
  const nycSchoolTaxCreditFixed = locality === "nyc" ? Math.max(0, Math.round(Number(input?.nyNycSchoolTaxCreditFixed || 0))) : 0;
  const nycSchoolTaxCreditRateReduction = locality === "nyc" ? Math.max(0, Math.round(Number(input?.nyNycSchoolTaxCreditRateReduction || 0))) : 0;
  const nycEitc = locality === "nyc" ? Math.max(0, Math.round(Number(input?.nyNycEITC || 0))) : 0;
  const otherRefundableCredits = Math.max(0, Math.round(Number(input?.nyOtherRefundableCredits || 0)));
  const refundableCredits = empireStateChildCredit + stateChildDependentCareCredit + stateEitc + realPropertyTaxCredit + collegeTuitionCredit + nycChildDependentCareCredit + nycSchoolTaxCreditFixed + nycSchoolTaxCreditRateReduction + nycEitc + otherRefundableCredits;

  const stateWithheldRaw = Math.max(0, Number(input?.stateWithheld || 0));
  const otherNYWithholdingRaw = Math.max(0, Number(input?.nyOtherNYWithholding || 0));
  const withholdingTotal = Math.max(0, Math.round(stateWithheldRaw + otherNYWithholdingRaw));
  const estimatedPayments = Math.max(0, Math.round(Number(input?.nyEstimatedPayments || 0)));
  const extensionPayment = Math.max(0, Math.round(Number(input?.nyExtensionPayment || 0)));
  const totalStatePayments = withholdingTotal + estimatedPayments + extensionPayment + refundableCredits;
  const totalTax = stateTaxAfterCredits + nycTaxAfterCredits + yonkersResidentSurcharge + mctmt + salesUseTax;
  const rawNet = totalStatePayments - totalTax;
  const voluntaryContributions = Math.max(0, Math.round(Number(input?.nyVoluntaryContributions || 0)));
  const penaltyInterest = Math.max(0, Math.round(Number(input?.nyPenaltyInterest || 0)));
  const afterAdjustments = rawNet - voluntaryContributions - penaltyInterest;
  const overpayment = Math.max(0, afterAdjustments);
  const baseAmountDue = Math.max(0, -afterAdjustments);
  const creditToNextYearRequested = Math.max(0, Math.round(Number(input?.nyCreditToNextYear || 0)));
  const creditToNextYearUsed = Math.min(overpayment, creditToNextYearRequested);
  const refundAmount = Math.max(0, overpayment - creditToNextYearUsed);
  const owedAmount = baseAmountDue;
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    status, federalAGI, additions, subtractions, nyAGI, deductionMethod, deduction, dependentExemption, taxableIncome,
    stateTaxBeforeCredits, householdCredit, otherNonrefundableCreditsRequested, stateCreditsUsed, otherStateTaxes, stateTaxAfterCredits,
    locality, nycTaxableIncome, nycTaxBeforeCredits, nycHouseholdCredit, nycNonrefundableRequested, nycNonrefundableUsed, nycOtherTaxes, nycTaxAfterCredits,
    yonkersResidentSurcharge, mctmt, salesUseTax, empireStateChildCredit, stateChildDependentCareCredit, federalEitc, stateEitc,
    realPropertyTaxCredit, collegeTuitionCredit, nycChildDependentCareCredit, nycSchoolTaxCreditFixed, nycSchoolTaxCreditRateReduction, nycEitc,
    otherRefundableCredits, refundableCredits, withholdingTotal, estimatedPayments, extensionPayment, totalStatePayments,
    totalTax, voluntaryContributions, penaltyInterest, rawNet, overpayment, baseAmountDue, creditToNextYearRequested, creditToNextYearUsed,
    refundAmount, owedAmount, net, isRefund: refundAmount > 0, isOwed: owedAmount > 0,
    incomeResult: { federalAGI, nyAGI, deduction, dependentExemption, taxableIncome, nycTaxableIncome },
  };
}

// =============================================================================
// RHODE ISLAND 2025 — SPECIAL FULL-YEAR RESIDENT RI-1040 CALCULATOR
// Uses the official 2025 standard-deduction and exemption phaseout worksheets,
// mandatory $50-band table below $100,000, tax computation schedule above it,
// and exact completed-return amounts for material credits/taxes/payments.
// =============================================================================
function normalizeRhodeIsland2025FilingStatus(input = {}) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  if (["single", "mfj", "mfs", "hoh", "qw"].includes(status)) return status;
  return "single";
}

function getRhodeIsland2025BaseStandardDeduction(input = {}) {
  const status = normalizeRhodeIsland2025FilingStatus(input);
  if (status === "mfj" || status === "qw") return 21800;
  if (status === "hoh") return 16350;
  return 10900;
}

function getRhodeIsland2025PhaseoutPercentage(modifiedFederalAGI) {
  const agi = Number(modifiedFederalAGI || 0);
  if (agi <= 254250) return 1;
  const excess = agi - 254250;
  if (excess > 29000) return 0;
  const step = Math.ceil(excess / 7250);
  if (step <= 1) return 0.8;
  if (step === 2) return 0.6;
  if (step === 3) return 0.4;
  return 0.2;
}

function getRhodeIsland2025StandardDeduction(modifiedFederalAGI, input = {}) {
  return Math.max(0, Math.round(
    getRhodeIsland2025BaseStandardDeduction(input) *
    getRhodeIsland2025PhaseoutPercentage(modifiedFederalAGI)
  ));
}

function getRhodeIsland2025ExemptionCount(input = {}) {
  if (input?.canBeClaimedAsDependent === true) return 0;
  const status = normalizeRhodeIsland2025FilingStatus(input);
  const dependents = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  return (status === "mfj" ? 2 : 1) + dependents;
}

function getRhodeIsland2025ExemptionAmount(modifiedFederalAGI, input = {}) {
  const base = getRhodeIsland2025ExemptionCount(input) * 5100;
  return Math.max(0, Math.round(base * getRhodeIsland2025PhaseoutPercentage(modifiedFederalAGI)));
}

function computeRhodeIsland2025RateScheduleTax(taxableIncome) {
  const x = Math.max(0, Number(taxableIncome || 0));
  let raw = 0;
  if (x <= 79900) raw = x * 0.0375;
  else if (x <= 181650) raw = 2996.25 + (x - 79900) * 0.0475;
  else raw = 7829.38 + (x - 181650) * 0.0599;
  return Math.max(0, Math.round(raw));
}

function computeRhodeIsland2025TaxTable(taxableIncome) {
  const x = Math.max(0, Math.floor(Number(taxableIncome || 0)));
  if (x >= 100000) return computeRhodeIsland2025RateScheduleTax(x);
  // Official 2025 table uses $50 bands. The opening $0-$49 band is $0;
  // subsequent bands equal the rounded schedule tax at the band midpoint.
  if (x < 50) return 0;
  const bandStart = Math.floor(x / 50) * 50;
  return computeRhodeIsland2025RateScheduleTax(bandStart + 25);
}

function computeRhodeIsland2025Tax(input = {}, federalSummary = {}) {
  const federalAGI = Math.round(Number(federalSummary?.agi ?? 0));
  const netModifications = Math.round(Number(input?.riNetModifications || 0));
  const modifiedFederalAGI = Math.round(federalAGI + netModifications);
  const standardDeduction = getRhodeIsland2025StandardDeduction(modifiedFederalAGI, input);
  const exemptionCount = getRhodeIsland2025ExemptionCount(input);
  const exemptionAmount = getRhodeIsland2025ExemptionAmount(modifiedFederalAGI, input);
  const taxableIncome = Math.max(0, Math.round(modifiedFederalAGI - standardDeduction - exemptionAmount));
  const incomeTax = computeRhodeIsland2025TaxTable(taxableIncome);

  const federalChildDependentCareCredit = Math.max(0, Math.round(Number(input?.riFederalChildDependentCareCredit || 0)));
  const allowableFederalCredit = Math.min(incomeTax, Math.max(0, Math.round(federalChildDependentCareCredit * 0.25)));
  const otherStateCredit = Math.max(0, Math.round(Number(input?.riOtherStateCredit || 0)));
  const otherRhodeIslandCredits = Math.max(0, Math.round(Number(input?.riOtherRhodeIslandCredits || 0)));
  const nonrefundableCreditsRequested = allowableFederalCredit + otherStateCredit + otherRhodeIslandCredits;
  const nonrefundableCreditsUsed = Math.min(incomeTax, nonrefundableCreditsRequested);
  const incomeTaxAfterCredits = Math.max(0, incomeTax - nonrefundableCreditsUsed);

  const creditRecapture = Math.max(0, Math.round(Number(input?.riCreditRecapture || 0)));
  const checkoffContributions = Math.max(0, Math.round(Number(input?.riCheckoffContributions || 0)));
  const useSalesTax = Math.max(0, Math.round(Number(input?.riUseSalesTax || 0)));
  const individualMandatePenalty = Math.max(0, Math.round(Number(input?.riIndividualMandatePenalty || 0)));
  const totalTax = incomeTaxAfterCredits + creditRecapture + checkoffContributions + useSalesTax + individualMandatePenalty;

  const federalEitc = input?.riClaimedFederalEITC === true
    ? Math.max(0, Math.round(Number(input?.riFederalEITCAmount || 0)))
    : 0;
  const rhodeIslandEitc = input?.riClaimedFederalEITC === true
    ? Math.max(0, Math.round(federalEitc * 0.16))
    : 0;
  const propertyTaxReliefCredit = Math.max(0, Math.round(Number(input?.riPropertyTaxReliefCredit || 0)));
  const leadPaintCredit = Math.max(0, Math.round(Number(input?.riLeadPaintCredit || 0)));
  const stateWithheldRaw = Math.max(0, Number(input?.stateWithheld || 0));
  const otherRhodeIslandWithholdingRaw = Math.max(0, Number(input?.riOtherRhodeIslandWithholding || 0));
  const withholdingTotal = Math.max(0, Math.round(stateWithheldRaw + otherRhodeIslandWithholdingRaw));
  const estimatedPayments = Math.max(0, Math.round(Number(input?.riEstimatedPayments || 0)));
  const otherPayments = Math.max(0, Math.round(Number(input?.riOtherPayments || 0)));
  const totalStatePayments = withholdingTotal + estimatedPayments + propertyTaxReliefCredit + rhodeIslandEitc + leadPaintCredit + otherPayments;

  const rawNet = totalStatePayments - totalTax;
  const underpaymentInterest = Math.max(0, Math.round(Number(input?.riUnderpaymentInterest || 0)));
  const afterInterest = rawNet - underpaymentInterest;
  const overpayment = Math.max(0, afterInterest);
  const baseAmountDue = Math.max(0, -afterInterest);
  const creditToNextYearRequested = Math.max(0, Math.round(Number(input?.riCreditToNextYear || 0)));
  const creditToNextYearUsed = Math.min(overpayment, creditToNextYearRequested);
  const refundAmount = Math.max(0, overpayment - creditToNextYearUsed);
  const owedAmount = baseAmountDue;
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    federalAGI, netModifications, modifiedFederalAGI, standardDeduction, exemptionCount, exemptionAmount, taxableIncome,
    incomeTax, federalChildDependentCareCredit, allowableFederalCredit, otherStateCredit, otherRhodeIslandCredits,
    nonrefundableCreditsRequested, nonrefundableCreditsUsed, incomeTaxAfterCredits, creditRecapture, checkoffContributions,
    useSalesTax, individualMandatePenalty, totalTax, federalEitc, rhodeIslandEitc, propertyTaxReliefCredit, leadPaintCredit,
    withholdingTotal, estimatedPayments, otherPayments, totalStatePayments, rawNet, underpaymentInterest, overpayment,
    baseAmountDue, creditToNextYearRequested, creditToNextYearUsed, refundAmount, owedAmount, net,
    isRefund: refundAmount > 0, isOwed: owedAmount > 0,
    incomeResult: { federalAGI, netModifications, modifiedFederalAGI, standardDeduction, exemptionCount, exemptionAmount, taxableIncome },
  };
}

// =============================================================================
// VERMONT 2025 — SPECIAL FULL-YEAR RESIDENT IN-111 CALCULATOR
// Uses the official 2025 standard deduction, personal exemptions, $100-band
// tax table below $75,000, rate schedules, minimum-tax rule, credits/payments,
// and blocks material Schedule IN-113 / special-filing situations rather than
// approximating them.
// =============================================================================
function normalizeVermont2025FilingStatus(input = {}) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  if (["single", "mfj", "mfs", "hoh", "qw"].includes(status)) return status;
  return "single";
}

function getVermont2025BaseStandardDeduction(input = {}) {
  const status = normalizeVermont2025FilingStatus(input);
  if (status === "mfj" || status === "qw") return 15300;
  if (status === "hoh") return 11450;
  return 7650;
}

function getVermont2025StandardDeduction(input = {}) {
  const boxes = Math.max(0, Math.trunc(Number(input?.vtStandardDeductionBoxCount || 0)));
  return getVermont2025BaseStandardDeduction(input) + (boxes * 1250);
}

function getVermont2025ExemptionCount(input = {}) {
  const status = normalizeVermont2025FilingStatus(input);
  const taxpayer = input?.canBeClaimedAsDependent === true ? 0 : 1;
  const spouse = status === "mfj" && input?.vtSpouseCanBeClaimedAsDependent !== true ? 1 : 0;
  const dependents = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  return taxpayer + spouse + dependents;
}

function computeVermont2025RateScheduleTax(taxableIncome, input = {}) {
  const x = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeVermont2025FilingStatus(input);
  let raw = 0;
  if (status === "mfj" || status === "qw") {
    if (x <= 82500) raw = x * 0.0335;
    else if (x <= 199450) raw = 2764 + (x - 82500) * 0.066;
    else if (x <= 304000) raw = 10482 + (x - 199450) * 0.076;
    else raw = 18428 + (x - 304000) * 0.0875;
  } else if (status === "mfs") {
    if (x <= 41250) raw = x * 0.0335;
    else if (x <= 99725) raw = 1382 + (x - 41250) * 0.066;
    else if (x <= 152000) raw = 5241 + (x - 99725) * 0.076;
    else raw = 9214 + (x - 152000) * 0.0875;
  } else if (status === "hoh") {
    if (x <= 66200) raw = x * 0.0335;
    else if (x <= 171000) raw = 2218 + (x - 66200) * 0.066;
    else if (x <= 276850) raw = 9135 + (x - 171000) * 0.076;
    else raw = 17179 + (x - 276850) * 0.0875;
  } else {
    if (x <= 49400) raw = x * 0.0335;
    else if (x <= 119700) raw = 1655 + (x - 49400) * 0.066;
    else if (x <= 249700) raw = 6295 + (x - 119700) * 0.076;
    else raw = 16175 + (x - 249700) * 0.0875;
  }
  return Math.max(0, Math.round(raw));
}

function computeVermont2025TaxTable(taxableIncome, input = {}) {
  const x = Math.max(0, Math.floor(Number(taxableIncome || 0)));
  if (x >= 75000) return computeVermont2025RateScheduleTax(x, input);
  // Official 2025 table uses $100 bands below $75,000. The $0-$99 band is $0;
  // all later rows equal the rounded schedule tax at the $100-band midpoint.
  if (x < 100) return 0;
  const bandStart = Math.floor(x / 100) * 100;
  return computeVermont2025RateScheduleTax(bandStart + 50, input);
}

function computeVermont2025ChildTaxCreditPerChild(federalAGI) {
  const agi = Math.round(Number(federalAGI || 0));
  if (agi <= 125000) return 1000;
  if (agi >= 174001) return 0;
  const bands = Math.ceil((agi - 125000) / 1000);
  return Math.max(0, 1000 - (bands * 20));
}

function computeVermont2025VeteranCredit(federalAGI, eligible) {
  if (eligible !== true) return 0;
  const agi = Math.round(Number(federalAGI || 0));
  if (agi <= 25000) return 250;
  if (agi >= 30000) return 0;
  const excess = agi - 25000;
  const steps = Math.floor(excess / 100);
  return Math.max(0, 250 - (steps * 5));
}

function computeVermont2025Tax(input = {}, federalSummary = {}) {
  const federalAGI = Math.round(Number(federalSummary?.agi ?? 0));
  const netModifications = Math.round(Number(input?.vtNetModifications || 0));
  const modifiedFederalAGI = Math.round(federalAGI + netModifications);
  const standardDeduction = getVermont2025StandardDeduction(input);
  const exemptionCount = getVermont2025ExemptionCount(input);
  const exemptionAmount = exemptionCount * 5300;
  const taxableIncome = Math.max(0, Math.round(modifiedFederalAGI - standardDeduction - exemptionAmount));

  const regularIncomeTax = federalAGI > 150000
    ? computeVermont2025RateScheduleTax(taxableIncome, input)
    : computeVermont2025TaxTable(taxableIncome, input);
  const usObligationInterest = Math.max(0, Math.round(Number(input?.vtUsObligationInterestForMinimumTax || 0)));
  // IN-111 Line 8 minimum-tax comparison: 3% of federal AGI, less
  // interest from U.S. obligations (the interest is subtracted after the 3% calculation).
  const minimumTax = federalAGI > 150000
    ? Math.max(0, Math.round((federalAGI * 0.03) - usObligationInterest))
    : 0;
  const incomeTax = Math.max(regularIncomeTax, minimumTax);

  const netTaxAdjustment = Math.round(Number(input?.vtNetTaxAdjustment || 0));
  const incomeTaxWithAdjustments = Math.max(0, incomeTax + netTaxAdjustment);
  const charitableContributions = Math.max(0, Math.round(Number(input?.vtCharitableContributions || 0)));
  const charitableContributionCredit = Math.min(1000, Math.max(0, Math.round(charitableContributions * 0.05)));
  const taxAfterCharity = Math.max(0, incomeTaxWithAdjustments - charitableContributionCredit);

  // Supported full-year resident path requires IN-111 Line 15 = 100%.
  const adjustedVermontIncomeTax = taxAfterCharity;
  const otherStateCredit = Math.max(0, Math.round(Number(input?.vtOtherStateCredit || 0)));
  const otherNonrefundableCredits = Math.max(0, Math.round(Number(input?.vtOtherNonrefundableCredits || 0)));
  const nonrefundableCreditsRequested = otherStateCredit + otherNonrefundableCredits;
  const nonrefundableCreditsUsed = Math.min(adjustedVermontIncomeTax, nonrefundableCreditsRequested);
  const incomeTaxAfterCredits = Math.max(0, adjustedVermontIncomeTax - nonrefundableCreditsUsed);

  const childCareContribution = Math.max(0, Math.round(Number(input?.vtChildCareContribution || 0)));
  const useTax = Math.max(0, Math.round(Number(input?.vtUseTax || 0)));
  const voluntaryContributions = Math.max(0, Math.round(Number(input?.vtVoluntaryContributions || 0)));
  const totalTax = incomeTaxAfterCredits + childCareContribution + useTax + voluntaryContributions;

  const federalChildDependentCareCredit = Math.max(0, Math.round(Number(input?.vtFederalChildDependentCareCredit || 0)));
  const childDependentCareCredit = Math.max(0, Math.round(federalChildDependentCareCredit * 0.72));
  const childTaxCreditQualifyingChildCount = Math.max(0, Math.trunc(Number(input?.vtChildTaxCreditQualifyingChildCount || 0)));
  const childTaxCreditPerChild = computeVermont2025ChildTaxCreditPerChild(federalAGI);
  const childTaxCredit = childTaxCreditQualifyingChildCount * childTaxCreditPerChild;
  const federalEitc = input?.vtClaimedFederalEITC === true
    ? Math.max(0, Math.round(Number(input?.vtFederalEITCAmount || 0)))
    : 0;
  const eitcQualifyingChildCount = Math.max(0, Math.trunc(Number(input?.vtEitcQualifyingChildCount || 0)));
  const vermontEitc = input?.vtClaimedFederalEITC === true
    ? (eitcQualifyingChildCount > 0 ? Math.max(0, Math.round(federalEitc * 0.38)) : federalEitc)
    : 0;
  const veteranCredit = computeVermont2025VeteranCredit(federalAGI, input?.vtIsQualifyingVeteran === true);
  const refundableCredits = childDependentCareCredit + childTaxCredit + vermontEitc + veteranCredit;

  const stateWithheldRaw = Math.max(0, Number(input?.stateWithheld || 0));
  const otherVermontWithholdingRaw = Math.max(0, Number(input?.vtOtherVermontWithholding || 0));
  const withholdingTotal = Math.max(0, Math.round(stateWithheldRaw + otherVermontWithholdingRaw));
  const estimatedPayments = Math.max(0, Math.round(Number(input?.vtEstimatedPayments || 0)));
  const realEstateWithholding = Math.max(0, Math.round(Number(input?.vtRealEstateWithholding || 0)));
  const k1EntityPayments = Math.max(0, Math.round(Number(input?.vtK1EntityPayments || 0)));
  const totalStatePayments = withholdingTotal + estimatedPayments + refundableCredits + realEstateWithholding + k1EntityPayments;

  const rawNetBeforeAllocationsAndPenalty = totalStatePayments - totalTax;
  const overpayment = Math.max(0, rawNetBeforeAllocationsAndPenalty);
  const baseAmountDue = Math.max(0, -rawNetBeforeAllocationsAndPenalty);
  const creditToNextYearRequested = Math.max(0, Math.round(Number(input?.vtCreditToNextYear || 0)));
  const creditToNextYearUsed = Math.min(overpayment, creditToNextYearRequested);
  const remainingAfterNextYear = Math.max(0, overpayment - creditToNextYearUsed);
  const creditToPropertyTaxRequested = Math.max(0, Math.round(Number(input?.vtCreditToPropertyTaxBill || 0)));
  const creditToPropertyTaxUsed = Math.min(remainingAfterNextYear, creditToPropertyTaxRequested);
  const refundBeforePenalty = Math.max(0, remainingAfterNextYear - creditToPropertyTaxUsed);
  const underpaymentInterestPenalty = Math.max(0, Math.round(Number(input?.vtUnderpaymentInterestPenalty || 0)));
  const refundAmount = Math.max(0, refundBeforePenalty - underpaymentInterestPenalty);
  const owedAmount = baseAmountDue + Math.max(0, underpaymentInterestPenalty - refundBeforePenalty);
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    federalAGI, netModifications, modifiedFederalAGI, standardDeduction, exemptionCount, exemptionAmount, taxableIncome,
    regularIncomeTax, usObligationInterest, minimumTax, incomeTax, netTaxAdjustment, incomeTaxWithAdjustments,
    charitableContributions, charitableContributionCredit, taxAfterCharity, adjustedVermontIncomeTax, otherStateCredit,
    otherNonrefundableCredits, nonrefundableCreditsRequested, nonrefundableCreditsUsed, incomeTaxAfterCredits,
    childCareContribution, useTax, voluntaryContributions, totalTax, federalChildDependentCareCredit, childDependentCareCredit,
    childTaxCreditQualifyingChildCount, childTaxCreditPerChild, childTaxCredit, federalEitc, eitcQualifyingChildCount,
    vermontEitc, veteranCredit, refundableCredits, withholdingTotal, estimatedPayments, realEstateWithholding, k1EntityPayments,
    totalStatePayments, rawNetBeforeAllocationsAndPenalty, overpayment, baseAmountDue, creditToNextYearRequested,
    creditToNextYearUsed, creditToPropertyTaxRequested, creditToPropertyTaxUsed, refundBeforePenalty,
    underpaymentInterestPenalty, refundAmount, owedAmount, net, isRefund: refundAmount > 0, isOwed: owedAmount > 0,
    incomeResult: { federalAGI, netModifications, modifiedFederalAGI, standardDeduction, exemptionCount, exemptionAmount, taxableIncome },
  };
}

// =============================================================================
// DISTRICT OF COLUMBIA 2025 — SPECIAL FULL-YEAR RESIDENT D-40 CALCULATOR
// Uses the District's 2025 standard deduction, Calculation F itemized-deduction
// limitation, $50-band tax table through $100,000, Calculation I rates, D-40
// credits/payments and explicit review blockers for material special cases.
// =============================================================================
function normalizeDistrictOfColumbia2025FilingStatus(input = {}) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  if (["single", "mfj", "mfs", "hoh", "qw"].includes(status)) return status;
  return "single";
}

function getDistrictOfColumbia2025BaseStandardDeduction(input = {}) {
  const status = normalizeDistrictOfColumbia2025FilingStatus(input);
  if (status === "mfj" || status === "qw") return 30000;
  if (status === "hoh") return 22500;
  return 15000;
}

function getDistrictOfColumbia2025StandardDeduction(input = {}) {
  const status = normalizeDistrictOfColumbia2025FilingStatus(input);
  const taxpayerAdditional = (Number(input?.age || 0) >= 65 ? 1 : 0) + (input?.dcTaxpayerBlind === true ? 1 : 0);
  const spouseAdditional = status === "mfj"
    ? ((Number(input?.spouseAge || 0) >= 65 ? 1 : 0) + (input?.dcSpouseBlind === true ? 1 : 0))
    : 0;
  const unit = (status === "single" || status === "hoh") ? 2000 : 1600;
  return getDistrictOfColumbia2025BaseStandardDeduction(input) + (taxpayerAdditional + spouseAdditional) * unit;
}

function computeDistrictOfColumbia2025ItemizedDeduction(input = {}, dcAGI = 0) {
  const a = Math.max(0, Math.round(Number(input?.dcFederalItemizedDeductions || 0)));
  const b = Math.max(0, Math.round(Number(input?.dcFederalStateLocalTaxDeduction || 0)));
  const d = Math.max(0, Math.round(Number(input?.dcFederalRealEstateTax || 0)));
  const e = Math.max(0, Math.round(Number(input?.dcFederalOtherTaxes || 0)));
  const c = Math.max(0, a - b);
  const f = Math.max(0, c + d + e);
  const status = normalizeDistrictOfColumbia2025FilingStatus(input);
  const threshold = status === "mfs" ? 100000 : 200000;
  if (Number(dcAGI || 0) <= threshold) return f;
  const g = Math.max(0, Math.round(Number(input?.dcProtectedItemizedDeductions || 0)));
  const h = Math.max(0, f - g);
  const l = Math.max(0, Math.round((Number(dcAGI || 0) - threshold) * 0.05));
  const m = Math.max(0, h - l);
  return Math.max(0, g + m);
}

function computeDistrictOfColumbia2025RateScheduleTax(taxableIncome) {
  const x = Math.max(0, Number(taxableIncome || 0));
  let raw = 0;
  if (x <= 10000) raw = x * 0.04;
  else if (x <= 40000) raw = 400 + (x - 10000) * 0.06;
  else if (x <= 60000) raw = 2200 + (x - 40000) * 0.065;
  else if (x <= 250000) raw = 3500 + (x - 60000) * 0.085;
  else if (x <= 500000) raw = 19650 + (x - 250000) * 0.0925;
  else if (x <= 1000000) raw = 42775 + (x - 500000) * 0.0975;
  else raw = 91525 + (x - 1000000) * 0.1075;
  return Math.max(0, Math.round(raw));
}

function computeDistrictOfColumbia2025TaxTable(taxableIncome) {
  const x = Math.max(0, Math.floor(Number(taxableIncome || 0)));
  if (x > 100000) return computeDistrictOfColumbia2025RateScheduleTax(x);

  // 2025 D-40 tax tables (booklet pp. 93-102) are authoritative for Line 19
  // taxable income of $100,000 or less. The published table uses $50 bands
  // and contains two edge details that must not be replaced by a generic
  // midpoint/rate approximation: the $0-$49 row is $0, and the single
  // $100,000 row is $6,901. The published $60,000-$99,999 bands also follow
  // the table values below (a $3,499 table base), which differ by $1 in some
  // bands from blindly applying Calculation I to a midpoint.
  if (x < 50) return 0;
  if (x === 100000) return 6901;

  const bandStart = Math.floor(x / 50) * 50;
  const representativeIncome = bandStart + 25;
  let raw;
  if (bandStart < 10000) raw = representativeIncome * 0.04;
  else if (bandStart < 40000) raw = 400 + (representativeIncome - 10000) * 0.06;
  else if (bandStart < 60000) raw = 2200 + (representativeIncome - 40000) * 0.065;
  else raw = 3499 + (representativeIncome - 60000) * 0.085;
  return Math.max(0, Math.round(raw));
}

function computeDistrictOfColumbia2025ChildlessEITC(earnedIncome, federalAGI) {
  const earned = Math.max(0, Number(earnedIncome || 0));
  const agi = Math.max(0, Number(federalAGI || 0));
  if (earned > 30941 || agi > 30941) return 0;
  const tentative = earned < 8484 ? Math.max(0, Math.round(earned * 0.0765)) : 649;
  const measure = Math.max(earned, agi);
  if (measure < 23288) return tentative;
  const phaseout = Math.max(0, Math.round((measure - 23288) * 0.0848));
  return Math.max(0, tentative - phaseout);
}

function computeDistrictOfColumbia2025Tax(input = {}, federalSummary = {}) {
  const federalAGI = Math.round(Number(federalSummary?.agi ?? 0));
  const additionsRaw = Number(input?.dcFranchiseTaxAddback || 0) + Number(input?.dcOtherAdditions || 0);
  const subtractionsRaw = Number(input?.dcStateLocalRefundSubtraction || 0) +
    Number(input?.dcTaxableSocialSecuritySubtraction || 0) +
    Number(input?.dcFranchiseFiduciaryIncomeSubtraction || 0) +
    Number(input?.dcSurvivorBenefitsSubtraction || 0) +
    Number(input?.dcUnemploymentSubtraction || 0) +
    Number(input?.dcOtherSubtractions || 0);
  const additions = Math.round(additionsRaw);
  const subtractions = Math.round(subtractionsRaw);
  const dcAGI = Math.round(federalAGI + additionsRaw - subtractionsRaw);

  const deductionMethod = String(input?.dcDeductionMethod || "standard").toLowerCase();
  const standardDeduction = getDistrictOfColumbia2025StandardDeduction(input);
  const itemizedDeduction = computeDistrictOfColumbia2025ItemizedDeduction(input, dcAGI);
  const deductionAmount = deductionMethod === "itemized" ? itemizedDeduction : standardDeduction;
  const taxableIncome = Math.max(0, Math.round(dcAGI - deductionAmount));
  const incomeTax = taxableIncome <= 100000
    ? computeDistrictOfColumbia2025TaxTable(taxableIncome)
    : computeDistrictOfColumbia2025RateScheduleTax(taxableIncome);

  const federalChildDependentCareCredit = Math.max(0, Math.round(Number(input?.dcFederalChildDependentCareCredit || 0)));
  const childDependentCareCredit = Math.max(0, Math.round(federalChildDependentCareCredit * 0.32));
  const otherNonrefundableCredits = Math.max(0, Math.round(Number(input?.dcOtherNonrefundableCredits || 0)));
  const nonrefundableCreditsRequested = childDependentCareCredit + otherNonrefundableCredits;
  const nonrefundableCreditsUsed = Math.min(incomeTax, nonrefundableCreditsRequested);
  const incomeTaxAfterCredits = Math.max(0, incomeTax - nonrefundableCreditsUsed);

  const healthCareSharedResponsibilityPayment = input?.dcFullYearHealthCoverageOrExempt === true
    ? 0 : Math.max(0, Math.round(Number(input?.dcHealthCareSharedResponsibilityPayment || 0)));
  const totalTax = incomeTaxAfterCredits + healthCareSharedResponsibilityPayment;

  const eitcQualifyingChildCount = Math.max(0, Math.trunc(Number(input?.dcEitcQualifyingChildCount || 0)));
  let dcEitc = 0;
  if (input?.dcClaimsEITC === true) {
    dcEitc = eitcQualifyingChildCount > 0
      ? Math.max(0, Math.round(Number(input?.dcCalculatedFederalEITCAmount || 0)))
      : computeDistrictOfColumbia2025ChildlessEITC(input?.dcChildlessEarnedIncome, federalAGI);
  }
  const scheduleHCredit = input?.dcClaimsScheduleH === true
    ? Math.max(0, Math.round(Number(input?.dcScheduleHCredit || 0))) : 0;
  const otherRefundableCredits = Math.max(0, Math.round(Number(input?.dcOtherRefundableCredits || 0)));
  const refundableCredits = dcEitc + scheduleHCredit + otherRefundableCredits;

  const withholdingTotal = Math.max(0, Math.round(Number(input?.stateWithheld || 0) + Number(input?.dcOtherWithholding || 0)));
  const estimatedPayments = Math.max(0, Math.round(Number(input?.dcEstimatedPayments || 0)));
  const extensionPayment = Math.max(0, Math.round(Number(input?.dcExtensionPayment || 0)));
  const totalStatePayments = refundableCredits + withholdingTotal + estimatedPayments + extensionPayment;

  const rawNet = totalStatePayments - totalTax;
  const overpayment = Math.max(0, rawNet);
  const baseAmountDue = Math.max(0, -rawNet);
  const creditToNextYearRequested = Math.max(0, Math.round(Number(input?.dcCreditToNextYear || 0)));
  const creditToNextYearUsed = Math.min(overpayment, creditToNextYearRequested);
  let remaining = Math.max(0, overpayment - creditToNextYearUsed);
  const underpaymentInterest = Math.max(0, Math.round(Number(input?.dcUnderpaymentInterest || 0)));
  const interestAgainstOverpayment = Math.min(remaining, underpaymentInterest);
  remaining = Math.max(0, remaining - interestAgainstOverpayment);
  const contributionsRequested = Math.max(0, Math.round(Number(input?.dcVoluntaryContributions || 0)));
  const contributionsUsed = Math.min(remaining, contributionsRequested);
  const refundAmount = Math.max(0, remaining - contributionsUsed);
  const owedAmount = baseAmountDue + Math.max(0, underpaymentInterest - interestAgainstOverpayment);
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    federalAGI, additions, subtractions, dcAGI, deductionMethod, standardDeduction, itemizedDeduction, deductionAmount,
    taxableIncome, incomeTax, federalChildDependentCareCredit, childDependentCareCredit, otherNonrefundableCredits,
    nonrefundableCreditsRequested, nonrefundableCreditsUsed, incomeTaxAfterCredits, healthCareSharedResponsibilityPayment,
    totalTax, eitcQualifyingChildCount, dcEitc, scheduleHCredit, otherRefundableCredits, refundableCredits, withholdingTotal,
    estimatedPayments, extensionPayment, totalStatePayments, rawNet, overpayment, baseAmountDue, creditToNextYearRequested,
    creditToNextYearUsed, underpaymentInterest, contributionsRequested, contributionsUsed, refundAmount, owedAmount, net,
    isRefund: refundAmount > 0, isOwed: owedAmount > 0,
    incomeResult: { federalAGI, additions, subtractions, dcAGI, deductionMethod, deductionAmount, taxableIncome },
  };
}

// =============================================================================
// MARYLAND 2025 — SPECIAL FULL-YEAR RESIDENT FORM 502 CALCULATOR
// Supports core Single, MFJ, HOH, QSS and dependent-taxpayer treatment.
// Material allocation/special-form cases are blocked by validation rather than
// approximated. Whole-dollar rounding follows the estimator's audited display
// convention after each completed Maryland form/work-sheet amount.
// =============================================================================
function normalizeMaryland2025FilingStatus(input = {}) {
  if (input?.canBeClaimedAsDependent === true) return "dependent";
  const status = String(input?.filingStatus || "single").toLowerCase();
  if (["single", "mfj", "mfs", "hoh", "qw"].includes(status)) return status;
  return "single";
}

function getMaryland2025StandardDeduction(input = {}) {
  const status = normalizeMaryland2025FilingStatus(input);
  if (["mfj", "hoh", "qw"].includes(status)) return 6700;
  return 3350;
}

function getMaryland2025RegularExemptionPerPerson(federalAGI, input = {}) {
  if (input?.canBeClaimedAsDependent === true) return 0;
  const agi = Number(federalAGI || 0);
  const status = normalizeMaryland2025FilingStatus(input);
  const jointGroup = ["mfj", "hoh", "qw"].includes(status);
  if (jointGroup) {
    if (agi <= 150000) return 3200;
    if (agi <= 175000) return 1600;
    if (agi <= 200000) return 800;
    return 0;
  }
  if (agi <= 100000) return 3200;
  if (agi <= 125000) return 1600;
  if (agi <= 150000) return 800;
  return 0;
}

function computeMaryland2025ExemptionAmount(input = {}, federalAGI = 0) {
  const status = normalizeMaryland2025FilingStatus(input);
  const deps = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  const age65Deps = Math.max(0, Math.trunc(Number(input?.mdAge65DependentCount || 0)));
  const perPerson = getMaryland2025RegularExemptionPerPerson(federalAGI, input);
  let regularCount = 0;
  if (input?.canBeClaimedAsDependent !== true) {
    regularCount = 1 + (status === "mfj" ? 1 : 0) + deps + age65Deps;
  }
  const taxpayerAgeBlind = (Number(input?.age || 0) >= 65 ? 1 : 0) + (input?.mdTaxpayerBlind === true ? 1 : 0);
  const spouseAgeBlind = status === "mfj"
    ? ((Number(input?.spouseAge || 0) >= 65 ? 1 : 0) + (input?.mdSpouseBlind === true ? 1 : 0))
    : 0;
  const fixedAdditional = 1000 * (taxpayerAgeBlind + spouseAgeBlind);
  return Math.max(0, Math.round(regularCount * perPerson + fixedAdditional));
}

function computeMaryland2025ItemizedDeduction(input = {}, federalAGI = 0) {
  const base = Math.max(0, Math.round(Number(input?.mdItemizedDeductionBeforePhaseout || 0)));
  if (String(input?.mdDeductionMethod || "standard").toLowerCase() !== "itemized") return 0;
  const threshold = normalizeMaryland2025FilingStatus(input) === "mfs" ? 100000 : 200000;
  const excess = Math.max(0, Number(federalAGI || 0) - threshold);
  const phaseout = Math.round(excess * 0.075);
  return Math.max(0, base - phaseout);
}

function computeMaryland2025RateScheduleTax(taxableIncome, input = {}) {
  const x = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeMaryland2025FilingStatus(input);
  const schedule2 = ["mfj", "hoh", "qw"].includes(status);
  let tax;
  if (!schedule2) {
    if (x <= 1000) tax = x * 0.02;
    else if (x <= 2000) tax = 20 + (x - 1000) * 0.03;
    else if (x <= 3000) tax = 50 + (x - 2000) * 0.04;
    else if (x <= 100000) tax = 90 + (x - 3000) * 0.0475;
    else if (x <= 125000) tax = 4697.50 + (x - 100000) * 0.05;
    else if (x <= 150000) tax = 5947.50 + (x - 125000) * 0.0525;
    else if (x <= 250000) tax = 7260 + (x - 150000) * 0.055;
    else if (x <= 500000) tax = 12760 + (x - 250000) * 0.0575;
    else if (x <= 1000000) tax = 27135 + (x - 500000) * 0.0625;
    else tax = 58385 + (x - 1000000) * 0.065;
  } else {
    if (x <= 1000) tax = x * 0.02;
    else if (x <= 2000) tax = 20 + (x - 1000) * 0.03;
    else if (x <= 3000) tax = 50 + (x - 2000) * 0.04;
    else if (x <= 150000) tax = 90 + (x - 3000) * 0.0475;
    else if (x <= 175000) tax = 7072.50 + (x - 150000) * 0.05;
    else if (x <= 225000) tax = 8322.50 + (x - 175000) * 0.0525;
    else if (x <= 300000) tax = 10947.50 + (x - 225000) * 0.055;
    else if (x <= 600000) tax = 15072.50 + (x - 300000) * 0.0575;
    else if (x <= 1200000) tax = 32322.50 + (x - 600000) * 0.0625;
    else tax = 69822.50 + (x - 1200000) * 0.065;
  }
  return Math.max(0, Math.round(tax));
}

function computeMaryland2025TaxTable(taxableIncome, input = {}) {
  const x = Math.max(0, Math.round(Number(taxableIncome || 0)));
  if (x <= 0) return 0;
  if (x >= 100000) return computeMaryland2025RateScheduleTax(x, input);
  const bandStart = Math.floor((x - 1) / 50) * 50 + 1;
  const midpoint = bandStart + 24;
  return computeMaryland2025RateScheduleTax(midpoint, input);
}

const MARYLAND_2025_LOCAL_RATES = Object.freeze({
  allegany: .0303, baltimore_city: .0320, baltimore_county: .0320, calvert: .0320,
  caroline: .0320, carroll: .0303, cecil: .0274, charles: .0303, dorchester: .0330,
  garrett: .0265, harford: .0306, howard: .0320, kent: .0320, montgomery: .0320,
  prince_georges: .0320, queen_annes: .0320, st_marys: .0320, somerset: .0320,
  talbot: .0240, washington: .0295, wicomico: .0320, worcester: .0225,
});

function getMaryland2025LocalBaseRate(jurisdiction) {
  const j = String(jurisdiction || "").toLowerCase();
  if (j === "anne_arundel") return .0270;
  if (j === "frederick") return .0225;
  return MARYLAND_2025_LOCAL_RATES[j] || 0;
}

function computeMaryland2025AnneArundelTax(taxableIncome, input = {}) {
  const x = Math.max(0, Number(taxableIncome || 0));
  const jointGroup = ["mfj", "hoh", "qw"].includes(normalizeMaryland2025FilingStatus(input));
  const direct = (income) => {
    if (jointGroup) {
      if (income <= 75000) return income * .0270;
      if (income <= 480000) return 2025 + (income - 75000) * .0294;
      return 13932 + (income - 480000) * .0320;
    }
    if (income <= 50000) return income * .0270;
    if (income <= 400000) return 1350 + (income - 50000) * .0294;
    return 11640 + (income - 400000) * .0320;
  };
  if (x <= 0) return 0;
  if (x < 100000) {
    const bandStart = Math.floor((Math.round(x) - 1) / 50) * 50 + 1;
    return Math.max(0, Math.round(direct(bandStart + 24)));
  }
  return Math.max(0, Math.round(direct(x)));
}

function computeMaryland2025FrederickTax(taxableIncome, input = {}) {
  const x = Math.max(0, Number(taxableIncome || 0));
  if (x <= 0) return 0;
  const jointGroup = ["mfj", "hoh", "qw"].includes(normalizeMaryland2025FilingStatus(input));
  let rate;
  if (jointGroup) {
    rate = x <= 25000 ? .0225 : x <= 100000 ? .0275 : x <= 250000 ? .0296 : .0320;
  } else {
    rate = x <= 25000 ? .0225 : x <= 50000 ? .0275 : x <= 150000 ? .0296 : .0320;
  }
  return Math.max(0, Math.round(x * rate));
}

function computeMaryland2025LocalTax(taxableIncome, input = {}) {
  const j = String(input?.mdLocalJurisdiction || "").toLowerCase();
  const x = Math.max(0, Number(taxableIncome || 0));
  if (j === "anne_arundel") return computeMaryland2025AnneArundelTax(x, input);
  if (j === "frederick") return computeMaryland2025FrederickTax(x, input);
  return Math.max(0, Math.round(x * getMaryland2025LocalBaseRate(j)));
}

function computeMaryland2025SeniorCredit(input = {}, federalAGI = 0) {
  const agi = Number(federalAGI || 0);
  const status = normalizeMaryland2025FilingStatus(input);
  const taxpayer65 = Number(input?.age || 0) >= 65;
  const spouse65 = status === "mfj" && Number(input?.spouseAge || 0) >= 65;
  if (status === "single" || status === "dependent") return taxpayer65 && agi <= 100000 ? 1000 : 0;
  if (status === "mfj") {
    if (agi > 150000 || (!taxpayer65 && !spouse65)) return 0;
    return taxpayer65 && spouse65 ? 1750 : 1000;
  }
  if (status === "hoh" || status === "qw") return taxpayer65 && agi <= 150000 ? 1750 : 0;
  return 0;
}

function computeMaryland2025ResidentChildTaxCredit(input = {}, federalAGI = 0) {
  const count = Math.max(0, Math.trunc(Number(input?.mdChildTaxCreditUnder6Count || 0))) +
    Math.max(0, Math.trunc(Number(input?.mdChildTaxCreditDisabledAge6To16Count || 0)));
  if (!count) return 0;
  const agi = Number(federalAGI || 0);
  if (agi <= 15000) return count * 500;
  if (agi > 24000) return 0;
  const steps = Math.ceil((agi - 15000) / 1000);
  return count * Math.max(0, 500 - steps * 50);
}

function computeMaryland2025Tax(input, federalSummary = {}) {
  const dollars = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const federalAGI = Math.round(dollars(federalSummary?.agi));
  const additions = Math.round(dollars(input?.mdAdditions));
  const subtractions = Math.round(dollars(input?.mdSubtractions));
  const marylandAGI = Math.round(federalAGI + additions - subtractions);
  const standardDeduction = getMaryland2025StandardDeduction(input);
  const itemizedDeduction = computeMaryland2025ItemizedDeduction(input, federalAGI);
  const deductionAmount = String(input?.mdDeductionMethod || "standard") === "itemized"
    ? Math.max(standardDeduction, itemizedDeduction) : standardDeduction;
  const exemptionAmount = computeMaryland2025ExemptionAmount(input, federalAGI);
  const marylandTaxableIncome = Math.max(0, Math.round(marylandAGI - deductionAmount - exemptionAmount));
  const regularTax = marylandTaxableIncome < 100000
    ? computeMaryland2025TaxTable(marylandTaxableIncome, input)
    : computeMaryland2025RateScheduleTax(marylandTaxableIncome, input);
  const capitalGainSubject = federalAGI > 350000 ? Math.max(0, Math.round(dollars(input?.mdCapitalGainSubjectToAdditionalTax))) : 0;
  const capitalGainAdditionalTax = Math.max(0, Math.round(capitalGainSubject * .02));
  const stateTaxBeforeCredits = regularTax + capitalGainAdditionalTax;

  const federalEitc = Math.max(0, Math.round(dollars(input?.mdFederalEITCAmount)));
  const eitcChildCount = Math.max(0, Math.trunc(Number(input?.mdEitcQualifyingChildCount || 0)));
  const status = normalizeMaryland2025FilingStatus(input);
  const noChildFullRate = federalEitc > 0 && eitcChildCount === 0 && ["single", "hoh", "qw"].includes(status);
  const stateEitcRequested = federalEitc > 0 ? Math.round(federalEitc * (noChildFullRate ? 1 : .50)) : 0;

  const familySize = 1 + (status === "mfj" ? 1 : 0) + Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  const povertyGuideline = familySize <= 8 ? 15650 + (familySize - 1) * 5500 : 54000 + (familySize - 8) * 5500;
  const earnedIncome = Math.max(0, Math.round(dollars(input?.mdEarnedIncome)));
  const povertyMeasure = Math.max(federalAGI + additions, earnedIncome);
  const statePovertyCreditRequested = input?.canBeClaimedAsDependent === true || povertyMeasure >= povertyGuideline
    ? 0 : Math.max(0, Math.round(earnedIncome * .05));
  const seniorCreditRequested = computeMaryland2025SeniorCredit(input, federalAGI);
  const otherNonrefundableCreditsRequested = Math.max(0, Math.round(dollars(input?.mdOtherNonrefundableCredits)));

  let remainingStateTax = stateTaxBeforeCredits;
  const stateEitcUsed = Math.min(remainingStateTax, stateEitcRequested); remainingStateTax -= stateEitcUsed;
  const statePovertyCreditUsed = Math.min(remainingStateTax, statePovertyCreditRequested); remainingStateTax -= statePovertyCreditUsed;
  const seniorCreditUsed = Math.min(remainingStateTax, seniorCreditRequested); remainingStateTax -= seniorCreditUsed;
  const otherNonrefundableCreditsUsed = Math.min(remainingStateTax, otherNonrefundableCreditsRequested); remainingStateTax -= otherNonrefundableCreditsUsed;
  const netStateTax = Math.max(0, remainingStateTax);

  const localTaxBeforeCredits = computeMaryland2025LocalTax(marylandTaxableIncome, input);
  const localBaseRate = getMaryland2025LocalBaseRate(input?.mdLocalJurisdiction);
  const localEitcRequested = federalEitc > 0 ? Math.max(0, Math.round(federalEitc * localBaseRate * 10)) : 0;
  const localPovertyCreditRequested = statePovertyCreditRequested > 0 ? Math.max(0, Math.round(earnedIncome * localBaseRate)) : 0;
  let remainingLocalTax = localTaxBeforeCredits;
  const localEitcUsed = Math.min(remainingLocalTax, localEitcRequested); remainingLocalTax -= localEitcUsed;
  const localPovertyCreditUsed = Math.min(remainingLocalTax, localPovertyCreditRequested); remainingLocalTax -= localPovertyCreditUsed;
  const netLocalTax = Math.max(0, remainingLocalTax);

  const stateEitcTotalRate = noChildFullRate ? 1 : .45;
  const refundableEitc = federalEitc > 0 && stateEitcUsed >= Math.min(stateTaxBeforeCredits, stateEitcRequested)
    ? Math.max(0, Math.round(federalEitc * stateEitcTotalRate) - stateTaxBeforeCredits)
    : 0;
  const residentChildTaxCredit = computeMaryland2025ResidentChildTaxCredit(input, federalAGI);
  const otherRefundableCredits = Math.max(0, Math.round(dollars(input?.mdOtherRefundableCredits)));
  const refundableCredits = refundableEitc + residentChildTaxCredit + otherRefundableCredits;

  const stateWithheld = Math.max(0, Math.round(dollars(input?.stateWithheld)));
  const otherMarylandWithholding = Math.max(0, Math.round(dollars(input?.mdOtherMarylandWithholding)));
  const otherPayments = Math.max(0, Math.round(dollars(input?.mdOtherPayments)));
  const totalStatePayments = stateWithheld + otherMarylandWithholding + otherPayments + refundableCredits;
  const voluntaryContributions = Math.max(0, Math.round(dollars(input?.mdVoluntaryContributions)));
  const underpaymentInterest = Math.max(0, Math.round(dollars(input?.mdUnderpaymentInterest)));
  const homebuyerWithdrawalPenalty = Math.max(0, Math.round(dollars(input?.mdHomebuyerWithdrawalPenalty)));
  const stateTax = netStateTax + netLocalTax + voluntaryContributions + underpaymentInterest + homebuyerWithdrawalPenalty;
  const rawNet = totalStatePayments - stateTax;
  const overpayment = Math.max(0, rawNet);
  const amountDue = Math.max(0, -rawNet);
  const creditToNextYearRequested = Math.max(0, Math.round(dollars(input?.mdCreditToNextYear)));
  const creditToNextYearUsed = Math.min(overpayment, creditToNextYearRequested);
  const refundAmount = Math.max(0, overpayment - creditToNextYearUsed);
  const owedAmount = amountDue;
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    incomeResult: { federalAGI, additions, subtractions, marylandAGI, standardDeduction, itemizedDeduction, deductionAmount, exemptionAmount, marylandTaxableIncome },
    regularTax, capitalGainSubject, capitalGainAdditionalTax, stateTaxBeforeCredits,
    stateEitcRequested, stateEitcUsed, statePovertyCreditRequested, statePovertyCreditUsed,
    seniorCreditRequested, seniorCreditUsed, otherNonrefundableCreditsRequested, otherNonrefundableCreditsUsed, netStateTax,
    localTaxBeforeCredits, localBaseRate, localEitcRequested, localEitcUsed, localPovertyCreditRequested, localPovertyCreditUsed, netLocalTax,
    federalEitc, refundableEitc, residentChildTaxCredit, otherRefundableCredits, refundableCredits,
    povertyGuideline, povertyMeasure, earnedIncome,
    stateWithheld, otherMarylandWithholding, otherPayments, totalStatePayments,
    voluntaryContributions, underpaymentInterest, homebuyerWithdrawalPenalty, stateTax,
    overpayment, creditToNextYearRequested, creditToNextYearUsed, refundAmount, owedAmount, net,
    isRefund: refundAmount > 0, isOwed: owedAmount > 0,
  };
}

// =============================================================================
// MAINE 2025 — SPECIAL FULL-YEAR RESIDENT FORM 1040ME CALCULATOR
// Supports the core resident path for Single, MFJ, HOH, and QSS. Maine's
// official Form 1040ME permits use of the published tax rate schedules.
// Part-year/nonresident, MFS, other-jurisdiction credit, special Maine-only
// EIC, amended, and other material special cases are blocked by validation.
// =============================================================================
function normalizeMaine2025FilingStatus(filingStatus) {
  const status = String(filingStatus || "single").toLowerCase();
  if (status === "qw") return "mfj";
  if (["single", "mfj", "mfs", "hoh"].includes(status)) return status;
  return "single";
}

function getMaine2025StandardDeduction(input = {}) {
  const rawStatus = String(input?.filingStatus || "single").toLowerCase();
  const status = normalizeMaine2025FilingStatus(rawStatus);
  const age = Number(input?.age || 0);
  const spouseAge = Number(input?.spouseAge || 0);
  const taxpayerBlind = input?.meTaxpayerBlind === true;
  const spouseBlind = input?.meSpouseBlind === true;
  const spouseCanBeClaimed = input?.meSpouseCanBeClaimedAsDependent === true;

  if (rawStatus === "qw") {
    return 30000 + 1600 * ((age >= 65 ? 1 : 0) + (taxpayerBlind ? 1 : 0));
  }
  if (status === "mfj") {
    const taxpayerBoxes = (age >= 65 ? 1 : 0) + (taxpayerBlind ? 1 : 0);
    const spouseBoxes = spouseCanBeClaimed ? 0 : ((spouseAge >= 65 ? 1 : 0) + (spouseBlind ? 1 : 0));
    return 30000 + 1600 * (taxpayerBoxes + spouseBoxes);
  }
  if (status === "hoh") {
    return 22500 + 2000 * ((age >= 65 ? 1 : 0) + (taxpayerBlind ? 1 : 0));
  }
  if (status === "mfs") {
    // MFS is blocked in the supported core path, but retain the published base
    // so helper behavior remains deterministic for diagnostics/tests.
    return 15000 + 1600 * ((age >= 65 ? 1 : 0) + (taxpayerBlind ? 1 : 0));
  }
  return 15000 + 2000 * ((age >= 65 ? 1 : 0) + (taxpayerBlind ? 1 : 0));
}

function applyMaine2025DeductionPhaseout(deductionBeforePhaseout, maineAGI, filingStatus) {
  const amount = Math.max(0, Math.round(Number(deductionBeforePhaseout || 0)));
  const agi = Number(maineAGI || 0);
  const status = normalizeMaine2025FilingStatus(filingStatus);
  const cfg = {
    single: { threshold: 100000, denominator: 75000 },
    mfs:    { threshold: 100000, denominator: 75000 },
    hoh:    { threshold: 150000, denominator: 112500 },
    mfj:    { threshold: 200050, denominator: 150000 },
  }[status];
  if (agi <= cfg.threshold) return amount;
  const rawRatio = Math.min(1, Math.max(0, (agi - cfg.threshold) / cfg.denominator));
  const ratio = Math.round(rawRatio * 10000) / 10000;
  const reduction = Math.round(amount * ratio);
  return Math.max(0, amount - reduction);
}

function getMaine2025PersonalExemptionCount(input = {}) {
  const rawStatus = String(input?.filingStatus || "single").toLowerCase();
  if (rawStatus === "mfj") {
    return (input?.canBeClaimedAsDependent === true ? 0 : 1) +
      (input?.meSpouseCanBeClaimedAsDependent === true ? 0 : 1);
  }
  return input?.canBeClaimedAsDependent === true ? 0 : 1;
}

function applyMaine2025PersonalExemptionPhaseout(exemptionBeforePhaseout, maineAGI, filingStatus) {
  const amount = Math.max(0, Math.round(Number(exemptionBeforePhaseout || 0)));
  const agi = Number(maineAGI || 0);
  const status = normalizeMaine2025FilingStatus(filingStatus);
  const cfg = {
    single: { threshold: 333450, denominator: 125000 },
    hoh:    { threshold: 366750, denominator: 125000 },
    mfj:    { threshold: 400100, denominator: 125000 },
    mfs:    { threshold: 200050, denominator: 62500 },
  }[status];
  if (agi <= cfg.threshold) return amount;
  const rawRatio = Math.min(1, Math.max(0, (agi - cfg.threshold) / cfg.denominator));
  const ratio = Math.round(rawRatio * 10000) / 10000;
  const reduction = Math.round(amount * ratio);
  return Math.max(0, amount - reduction);
}

function computeMaine2025RateScheduleTax(taxableIncome, filingStatus) {
  const income = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeMaine2025FilingStatus(filingStatus);
  let tax = 0;
  if (status === "mfj") {
    if (income < 53600) tax = income * 0.058;
    else if (income < 126900) tax = 3109 + (income - 53600) * 0.0675;
    else tax = 8057 + (income - 126900) * 0.0715;
  } else if (status === "hoh") {
    if (income < 40200) tax = income * 0.058;
    else if (income < 95150) tax = 2332 + (income - 40200) * 0.0675;
    else tax = 6041 + (income - 95150) * 0.0715;
  } else {
    if (income < 26800) tax = income * 0.058;
    else if (income < 63450) tax = 1554 + (income - 26800) * 0.0675;
    else tax = 4028 + (income - 63450) * 0.0715;
  }
  return Math.max(0, Math.round(tax));
}

function computeMaine2025DependentExemptionCredit(input = {}, maineAGI = 0) {
  const age6OrOlder = Math.max(0, Math.trunc(Number(input?.meDependentCreditAge6OrOlderCount || 0)));
  const under6 = Math.max(0, Math.trunc(Number(input?.meDependentCreditUnder6Count || 0)));
  const baseCredit = age6OrOlder * 305 + under6 * 610;
  const status = normalizeMaine2025FilingStatus(input?.filingStatus);
  const threshold = { single: 100000, hoh: 125000, mfj: 150000, mfs: 75000 }[status];
  const excess = Number(maineAGI || 0) - threshold;
  if (excess <= 0) return baseCredit;
  const roundedExcess = Math.ceil(excess / 500) * 500;
  const reduction = (roundedExcess / 500) * 20;
  return Math.max(0, Math.round(baseCredit - reduction));
}

function computeMaine2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const normalizedStatus = normalizeMaine2025FilingStatus(filingStatus);
  const money = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

  const federalAGI = Math.round(money(federalSummary?.agi));
  const additions = Math.round(money(input?.meAdditions));
  const subtractions = Math.round(money(input?.meSubtractions));
  const maineAGI = Math.round(federalAGI + additions - subtractions);

  const standardDeductionBeforePhaseout = getMaine2025StandardDeduction(input);
  const federalDeductionMethod = String(input?.meFederalDeductionMethod || "standard").toLowerCase();
  const itemizedDeduction = federalDeductionMethod === "itemized"
    ? Math.max(0, Math.round(money(input?.meItemizedDeductionAmount)))
    : 0;
  const deductionBeforePhaseout = federalDeductionMethod === "itemized"
    ? Math.max(standardDeductionBeforePhaseout, itemizedDeduction)
    : standardDeductionBeforePhaseout;
  const deductionAmount = applyMaine2025DeductionPhaseout(deductionBeforePhaseout, maineAGI, normalizedStatus);

  const personalExemptionCount = getMaine2025PersonalExemptionCount(input);
  const personalExemptionBeforePhaseout = personalExemptionCount * 5150;
  const personalExemptionAmount = applyMaine2025PersonalExemptionPhaseout(
    personalExemptionBeforePhaseout, maineAGI, normalizedStatus
  );
  const maineTaxableIncome = Math.max(0, Math.round(maineAGI - deductionAmount - personalExemptionAmount));
  const regularTax = computeMaine2025RateScheduleTax(maineTaxableIncome, normalizedStatus);

  const taxCreditRecapture = Math.max(0, Math.round(money(input?.meTaxCreditRecapture)));
  const taxBeforeCredits = regularTax + taxCreditRecapture;
  const nonrefundableCreditsRequested = Math.max(0, Math.round(money(input?.meOtherNonrefundableCredits)));
  const nonrefundableCreditsUsed = Math.min(taxBeforeCredits, nonrefundableCreditsRequested);
  const netTax = Math.max(0, taxBeforeCredits - nonrefundableCreditsUsed);

  const dependentExemptionCredit = computeMaine2025DependentExemptionCredit(input, maineAGI);
  const federalEitc = input?.meClaimedFederalEITC === true
    ? Math.max(0, Math.round(money(input?.meFederalEITCAmount)))
    : 0;
  const maineEitc = input?.meClaimedFederalEITC === true
    ? Math.max(0, Math.round(federalEitc * (input?.meEitcHasQualifyingChild === true ? 0.25 : 0.50)))
    : 0;
  const otherRefundableCredits = Math.max(0, Math.round(money(input?.meOtherRefundableCredits)));
  const propertyTaxFairnessCredit = Math.max(0, Math.round(money(input?.mePropertyTaxFairnessCredit)));
  const salesTaxFairnessCredit = Math.max(0, Math.round(money(input?.meSalesTaxFairnessCredit)));
  const refundableCredits = dependentExemptionCredit + maineEitc + otherRefundableCredits;

  const stateWithheld = Math.max(0, Math.round(money(input?.stateWithheld)));
  const otherMaineWithholding = Math.max(0, Math.round(money(input?.meOtherMaineWithholding)));
  const otherPayments = Math.max(0, Math.round(money(input?.meOtherPayments)));
  const totalStatePayments = stateWithheld + otherMaineWithholding + otherPayments + refundableCredits +
    propertyTaxFairnessCredit + salesTaxFairnessCredit;

  const useTax = Math.max(0, Math.round(money(input?.meUseTax)));
  const casualRentalTax = Math.max(0, Math.round(money(input?.meCasualRentalTax)));
  const voluntaryContributions = Math.max(0, Math.round(money(input?.meVoluntaryContributions)));
  const underpaymentPenalty = Math.max(0, Math.round(money(input?.meUnderpaymentPenalty)));
  const stateTax = netTax + useTax + casualRentalTax + voluntaryContributions + underpaymentPenalty;

  const rawNet = totalStatePayments - stateTax;
  const overpayment = Math.max(0, rawNet);
  const amountDue = Math.max(0, -rawNet);
  const creditToNextYearRequested = Math.max(0, Math.round(money(input?.meCreditToNextYear)));
  const creditToNextYearUsed = Math.min(overpayment, creditToNextYearRequested);
  const refundAmount = Math.max(0, overpayment - creditToNextYearUsed);
  const owedAmount = amountDue;
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    incomeResult: {
      federalAGI, additions, subtractions, maineAGI, standardDeductionBeforePhaseout,
      federalDeductionMethod, itemizedDeduction, deductionBeforePhaseout, deductionAmount,
      personalExemptionCount, personalExemptionBeforePhaseout, personalExemptionAmount, maineTaxableIncome,
    },
    normalizedStatus, regularTax, taxCreditRecapture, taxBeforeCredits,
    nonrefundableCreditsRequested, nonrefundableCreditsUsed, netTax,
    dependentExemptionCredit, federalEitc, maineEitc, otherRefundableCredits,
    propertyTaxFairnessCredit, salesTaxFairnessCredit, refundableCredits,
    stateWithheld, otherMaineWithholding, otherPayments, totalStatePayments,
    useTax, casualRentalTax, voluntaryContributions, underpaymentPenalty, stateTax,
    overpayment, creditToNextYearRequested, creditToNextYearUsed,
    refundAmount, owedAmount, net, isRefund: refundAmount > 0, isOwed: owedAmount > 0,
  };
}

// =============================================================================
// DELAWARE 2025 — SPECIAL FULL-YEAR RESIDENT PIT-RES CALCULATOR
// Supports the core full-year resident path for Single, MFJ, and HOH.
// Delaware uses a mandatory $50-band tax table when taxable income is below
// $60,000. The table is reproduced by applying the statutory rate schedule to
// the midpoint of the applicable $50 band and rounding to whole dollars.
// =============================================================================
function getDelaware2025StandardDeduction(filingStatus) {
  const status = String(filingStatus || "single").toLowerCase();
  if (status === "mfj") return 6500;
  return 3250;
}

function computeDelaware2025RateScheduleTax(taxableIncome) {
  const income = Math.max(0, Number(taxableIncome || 0));
  const cents = (value) => Math.round(Number(value || 0) * 100) / 100;
  let base = 0;
  let marginal = 0;
  if (income <= 2000) { base = 0; marginal = 0; }
  else if (income <= 5000) { base = 0; marginal = (income - 2000) * 0.022; }
  else if (income <= 10000) { base = 66; marginal = (income - 5000) * 0.039; }
  else if (income <= 20000) { base = 261; marginal = (income - 10000) * 0.048; }
  else if (income <= 25000) { base = 741; marginal = (income - 20000) * 0.052; }
  else if (income <= 60000) { base = 1001; marginal = (income - 25000) * 0.0555; }
  else { base = 2943.50; marginal = (income - 60000) * 0.066; }
  // Delaware's software-developer guidance requires the marginal calculation
  // to be rounded to cents before adding the bracket base, then the final tax
  // is rounded to the nearest whole dollar. This matters for cases such as
  // taxable income of $80,106 (official result: $4,271).
  return Math.max(0, Math.round(cents(base + cents(marginal))));
}

function computeDelaware2025TaxTable(taxableIncome) {
  const income = Math.max(0, Math.round(Number(taxableIncome || 0)));
  if (income <= 0) return 0;
  if (income < 60000) {
    const lower = Math.floor(income / 50) * 50;
    return computeDelaware2025RateScheduleTax(lower + 25);
  }
  return computeDelaware2025RateScheduleTax(income);
}

function computeDelaware2025Tax(input, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const money = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const federalAGIRaw = money(federalSummary?.agi);
  const additionsRaw = money(input?.deAdditions);
  const subtractionsRaw = money(input?.deSubtractions);
  const delawareAGIRaw = federalAGIRaw + additionsRaw - subtractionsRaw;
  const federalAGI = Math.round(federalAGIRaw);
  const additions = Math.round(additionsRaw);
  const subtractions = Math.round(subtractionsRaw);
  const delawareAGI = Math.round(delawareAGIRaw);

  const deductionMethod = String(input?.deDeductionMethod || "standard").toLowerCase();
  const baseDeductionRaw = deductionMethod === "itemized"
    ? Math.max(0, money(input?.deItemizedDeductionAmount))
    : getDelaware2025StandardDeduction(filingStatus);

  const taxpayerAge = Math.max(0, Number(input?.age || 0));
  const spouseAge = Math.max(0, Number(input?.spouseAge || 0));
  const taxpayerBlind = input?.deTaxpayerBlind === true;
  const spouseBlind = filingStatus === "mfj" && input?.deSpouseBlind === true;
  let additionalStandardBoxes = 0;
  if (deductionMethod === "standard") {
    if (taxpayerAge >= 65) additionalStandardBoxes += 1;
    if (taxpayerBlind) additionalStandardBoxes += 1;
    if (filingStatus === "mfj") {
      if (spouseAge >= 65) additionalStandardBoxes += 1;
      if (spouseBlind) additionalStandardBoxes += 1;
    }
  }
  const additionalStandardDeductionRaw = additionalStandardBoxes * 2500;
  const deductionAmount = Math.round(baseDeductionRaw);
  const additionalStandardDeduction = Math.round(additionalStandardDeductionRaw);
  const delawareTaxableIncomeRaw = Math.max(0, delawareAGIRaw - baseDeductionRaw - additionalStandardDeductionRaw);
  const delawareTaxableIncome = Math.round(delawareTaxableIncomeRaw);
  const regularTax = computeDelaware2025TaxTable(delawareTaxableIncome);

  const dependents = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  let personalCreditCount = 0;
  if (input?.canBeClaimedAsDependent !== true) {
    personalCreditCount = (filingStatus === "mfj" ? 2 : 1) + dependents;
  }
  const personalCredits = Math.round(personalCreditCount * 110);
  let age60CreditCount = taxpayerAge >= 60 ? 1 : 0;
  if (filingStatus === "mfj" && spouseAge >= 60) age60CreditCount += 1;
  const additionalPersonalCredits = Math.round(age60CreditCount * 110);

  const volunteerCount = Math.max(0, Math.trunc(Number(input?.deVolunteerFirefighterCount || 0)));
  const volunteerFirefighterCredit = volunteerCount * 1000;
  const federalChildCareCredit = Math.max(0, money(input?.deFederalChildDependentCareCredit));
  const childCareCredit = Math.min(3000, Math.round(federalChildCareCredit * 0.50));
  const otherNonrefundableCredits = Math.max(0, Math.round(money(input?.deOtherNonrefundableCredits)));
  const nonrefundableRequested = personalCredits + additionalPersonalCredits + volunteerFirefighterCredit + childCareCredit + otherNonrefundableCredits;
  const nonrefundableCreditsUsed = Math.min(regularTax, nonrefundableRequested);
  const balanceBeforeEitc = Math.max(0, regularTax - nonrefundableCreditsUsed);

  const federalEitc = Math.max(0, money(input?.deFederalEITCAmount));
  const refundableEitcCandidate = Math.round(federalEitc * 0.045);
  const nonrefundableEitcCandidate = Math.round(federalEitc * 0.20);
  let refundableEitc = 0;
  let nonrefundableEitc = 0;
  if (federalEitc > 0) {
    if (refundableEitcCandidate >= balanceBeforeEitc) {
      refundableEitc = refundableEitcCandidate;
    } else {
      nonrefundableEitc = Math.min(balanceBeforeEitc, nonrefundableEitcCandidate);
    }
  }
  const taxAfterCredits = Math.max(0, balanceBeforeEitc - nonrefundableEitc);
  const penaltyInterest = Math.max(0, Math.round(money(input?.dePenaltyInterest)));
  const stateTax = Math.max(0, taxAfterCredits + penaltyInterest);

  const stateWithheld = Math.max(0, Math.round(money(input?.stateWithheld)));
  const estimatedPayments = Math.max(0, Math.round(money(input?.deEstimatedPayments)));
  const sCorporationPayments = Math.max(0, Math.round(money(input?.deSCorporationPayments)));
  const realEstateCapitalGainsPayments = Math.max(0, Math.round(money(input?.deRealEstateCapitalGainsPayments)));
  const otherRefundableCredits = Math.max(0, Math.round(money(input?.deOtherRefundableCredits)));
  const totalStatePayments = stateWithheld + estimatedPayments + sCorporationPayments + realEstateCapitalGainsPayments + otherRefundableCredits + refundableEitc;
  const refundAmount = Math.max(0, totalStatePayments - stateTax);
  const owedAmount = Math.max(0, stateTax - totalStatePayments);
  const net = refundAmount > 0 ? refundAmount : owedAmount > 0 ? -owedAmount : 0;

  return {
    incomeResult: {
      federalAGI, additions, subtractions, delawareAGI, deductionMethod, deductionAmount,
      additionalStandardBoxes, additionalStandardDeduction, delawareTaxableIncome
    },
    regularTax, personalCreditCount, personalCredits, age60CreditCount, additionalPersonalCredits,
    volunteerFirefighterCredit, childCareCredit, otherNonrefundableCredits, nonrefundableRequested,
    nonrefundableCreditsUsed, balanceBeforeEitc, federalEitc, refundableEitc, nonrefundableEitc,
    taxAfterCredits, penaltyInterest, stateTax, stateWithheld, estimatedPayments, sCorporationPayments,
    realEstateCapitalGainsPayments, otherRefundableCredits, totalStatePayments, refundAmount, owedAmount,
    net, isRefund: refundAmount > 0, isOwed: owedAmount > 0,
  };
}

// =============================================================================
// KANSAS 2025 — SPECIAL FULL-YEAR RESIDENT FORM K-40 CALCULATOR
// 2025 K-40 uses the official $50-band tax table through $100,000 and the
// Tax Computation Worksheet above $100,000. Federal qualifying widow(er)
// maps to Kansas Head of Household.
// =============================================================================

function normalizeKansas2025FilingStatus(filingStatus) {
  const status = String(filingStatus || "single").toLowerCase();
  return status === "qw" ? "hoh" : status;
}

function computeKansas2025RateScheduleTax(taxableIncome, filingStatus) {
  const income = Math.max(0, Number(taxableIncome || 0));
  const status = normalizeKansas2025FilingStatus(filingStatus);
  if (status === "mfj") {
    if (income <= 46000) return Math.max(0, Math.round(income * 0.052));
    return Math.max(0, Math.round(2392 + (income - 46000) * 0.0558));
  }
  if (income <= 23000) return Math.max(0, Math.round(income * 0.052));
  return Math.max(0, Math.round(1196 + (income - 23000) * 0.0558));
}

function computeKansas2025TaxTable(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome));
  if (income <= 25) return 0;
  if (income > 100000) return computeKansas2025RateScheduleTax(income, filingStatus);

  // The published table has an opening 26–50 band, then 50-dollar bands.
  let lower;
  let upper;
  if (income <= 50) {
    lower = 26;
    upper = 50;
  } else {
    lower = 51 + Math.floor((income - 51) / 50) * 50;
    upper = lower + 49;
  }
  const midpoint = (lower + upper) / 2;
  return computeKansas2025RateScheduleTax(midpoint, filingStatus);
}

function getKansas2025ExemptionAllowance(input) {
  const status = normalizeKansas2025FilingStatus(input?.filingStatus);
  const base = status === "mfj" ? 18320 : 9160;
  const headOfHouseholdAddition = status === "hoh" ? 2320 : 0;
  const dependentCount = input?.canBeClaimedAsDependent === true
    ? 0
    : Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  const dependentExemptions = dependentCount * 2320;
  const newbornExemptions = Math.max(0, Math.trunc(Number(input?.ksNewbornDependentCount || 0))) * 2320;
  const stillbirthExemptions = Math.max(0, Math.trunc(Number(input?.ksStillbirthCount || 0))) * 2320;
  const disabledVeteranExemptions = Math.max(0, Math.trunc(Number(input?.ksDisabledVeteranCount || 0))) * 2320;
  return dollars(base + headOfHouseholdAddition + dependentExemptions + newbornExemptions + stillbirthExemptions + disabledVeteranExemptions);
}

function computeKansas2025Tax(input, federalAGI = 0) {
  const federalAdjustedGrossIncome = dollars(federalAGI);
  const netModifications = dollars(input?.ksNetModifications || 0);
  const kansasAdjustedGrossIncome = dollars(federalAdjustedGrossIncome + netModifications);
  const deduction = Math.max(0, dollars(input?.ksDeductionAmount || 0));
  const exemptionAllowance = getKansas2025ExemptionAllowance(input);
  const stateTaxableIncome = Math.max(0, dollars(kansasAdjustedGrossIncome - deduction - exemptionAllowance));
  const incomeTax = stateTaxableIncome <= 100000
    ? computeKansas2025TaxTable(stateTaxableIncome, input?.filingStatus)
    : computeKansas2025RateScheduleTax(stateTaxableIncome, input?.filingStatus);

  // Exact completed K-40 Line 11 is accepted because KPERS lump-sum cases can
  // require proration before the resident 13% rule is applied.
  const lumpSumDistributionTax = Math.max(0, dollars(input?.ksLumpSumDistributionTax || 0));
  const totalIncomeTax = dollars(incomeTax + lumpSumDistributionTax);

  const federalChildDependentCareCredit = Math.max(0, dollars(input?.ksFederalChildDependentCareCredit || 0));
  const childDependentCareCredit = Math.max(0, Math.round(federalChildDependentCareCredit * 0.50));
  const otherNonrefundableCredits = Math.max(0, dollars(input?.ksOtherNonrefundableCredits || 0));
  const nonrefundableBeforeEITC = Math.min(totalIncomeTax, dollars(childDependentCareCredit + otherNonrefundableCredits));
  const line16Subtotal = Math.max(0, dollars(totalIncomeTax - nonrefundableBeforeEITC));

  const federalEITCAmount = Math.max(0, dollars(input?.ksFederalEITCAmount || 0));
  const kansasEITC = Math.max(0, Math.round(federalEITCAmount * 0.17));
  const eitcNonrefundable = Math.min(line16Subtotal, kansasEITC);
  const taxBalance = Math.max(0, dollars(line16Subtotal - eitcNonrefundable));
  const eitcRefundable = Math.max(0, dollars(kansasEITC - eitcNonrefundable));

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherFormWithholding = Math.max(0, dollars(input?.ksOtherFormWithholding || 0));
  const estimatedPayments = Math.max(0, dollars(input?.ksEstimatedPayments || 0));
  const extensionPayment = Math.max(0, dollars(input?.ksExtensionPayment || 0));
  const otherRefundableCredits = Math.max(0, dollars(input?.ksOtherRefundableCredits || 0));
  const ptetCredit = Math.max(0, dollars(input?.ksPtetCredit || 0));
  const totalStatePayments = dollars(
    stateWithheld + otherFormWithholding + estimatedPayments + extensionPayment +
    eitcRefundable + otherRefundableCredits + ptetCredit
  );

  const interest = Math.max(0, dollars(input?.ksInterest || 0));
  const latePaymentPenalty = Math.max(0, dollars(input?.ksLatePaymentPenalty || 0));
  const estimatedTaxPenalty = Math.max(0, dollars(input?.ksEstimatedTaxPenalty || 0));
  const stateTax = dollars(taxBalance + interest + latePaymentPenalty + estimatedTaxPenalty);
  const preAllocationNet = dollars(totalStatePayments - stateTax);

  const creditForwardRequested = Math.max(0, dollars(input?.ksCreditForward || 0));
  const availableOverpayment = Math.max(0, preAllocationNet);
  const creditForward = Math.min(availableOverpayment, creditForwardRequested);
  const afterCreditForward = dollars(preAllocationNet - creditForward);
  const contributions = Math.max(0, dollars(input?.ksContributions || 0));
  const net = dollars(afterCreditForward - contributions);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      netModifications,
      kansasAdjustedGrossIncome,
      deduction,
      exemptionAllowance,
      stateTaxableIncome,
    },
    incomeTax,
    lumpSumDistributionTax,
    totalIncomeTax,
    federalChildDependentCareCredit,
    childDependentCareCredit,
    otherNonrefundableCredits,
    nonrefundableBeforeEITC,
    line16Subtotal,
    federalEITCAmount,
    kansasEITC,
    eitcNonrefundable,
    eitcRefundable,
    taxBalance,
    stateWithheld,
    otherFormWithholding,
    estimatedPayments,
    extensionPayment,
    otherRefundableCredits,
    ptetCredit,
    totalStatePayments,
    interest,
    latePaymentPenalty,
    estimatedTaxPenalty,
    stateTax,
    preAllocationNet,
    creditForward,
    contributions,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// NEBRASKA 2025 — SPECIAL FULL-YEAR RESIDENT FORM 1040N CALCULATOR
// Official Nebraska Tax Calculation Schedule is used instead of the paper
// midpoint tax table, matching the electronic-filer instruction path.
// =============================================================================

function computeNebraska2025RateScheduleTax(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome));
  const status = String(filingStatus || "single").toLowerCase();
  const schedule = (status === "mfj" || status === "qw")
    ? [
        [8040, 0, 0.0246],
        [48250, 197.78, 0.0351, 8040],
        [77730, 1609.15, 0.0501, 48250],
        [Infinity, 3086.10, 0.0520, 77730],
      ]
    : status === "hoh"
      ? [
          [7510, 0, 0.0246],
          [38590, 184.75, 0.0351, 7510],
          [57630, 1275.66, 0.0501, 38590],
          [Infinity, 2229.56, 0.0520, 57630],
        ]
      : [
          [4030, 0, 0.0246],
          [24120, 99.14, 0.0351, 4030],
          [38870, 804.30, 0.0501, 24120],
          [Infinity, 1543.28, 0.0520, 38870],
        ];

  for (const row of schedule) {
    const [upper, baseTax, rate, floor = 0] = row;
    if (income <= upper) {
      return Math.max(0, Math.round(baseTax + Math.max(0, income - floor) * rate));
    }
  }
  return 0;
}

function getNebraska2025PersonalExemptionCount(input) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  const taxpayer = input?.canBeClaimedAsDependent === true ? 0 : 1;
  const spouse = status === "mfj" && input?.neSpouseCanBeClaimedAsDependent !== true ? 1 : 0;
  const dependents = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  return taxpayer + spouse + dependents;
}

function computeNebraska2025Tax(input, federalAGI = 0) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  const standardDeduction = Math.max(0, dollars(input?.neStandardDeduction || 0));
  const federalItemizedDeductions = Math.max(0, dollars(input?.neFederalItemizedDeductions || 0));
  const stateLocalIncomeTaxes = Math.max(0, dollars(input?.neStateLocalIncomeTaxes || 0));
  const neItemizedDeductions = Math.max(0, dollars(federalItemizedDeductions - stateLocalIncomeTaxes));
  const deduction = Math.max(standardDeduction, neItemizedDeductions);
  const incomeBeforeAdjustments = dollars(Number(federalAGI || 0) - deduction);
  const scheduleIIncreases = dollars(input?.neScheduleIIncreases || 0);
  const scheduleIDecreases = dollars(input?.neScheduleIDecreases || 0);
  const netAdjustments = dollars(scheduleIIncreases - scheduleIDecreases);
  const stateTaxableIncome = Math.max(0, dollars(incomeBeforeAdjustments + scheduleIIncreases - scheduleIDecreases));

  const incomeTax = computeNebraska2025RateScheduleTax(stateTaxableIncome, status);
  const federalLumpSumTax = Math.max(0, dollars(input?.neFederalLumpSumTax || 0));
  const federalEarlyDistributionTax = Math.max(0, dollars(input?.neFederalEarlyDistributionTax || 0));
  const otherTax = Math.max(0, Math.round((federalLumpSumTax + federalEarlyDistributionTax) * 0.296));
  const totalTaxBeforeCredits = dollars(incomeTax + otherTax);

  const personalExemptionCount = getNebraska2025PersonalExemptionCount(input);
  const personalExemptionCredit = dollars(personalExemptionCount * 171);
  const otherNonrefundableCredits = Math.max(0, dollars(input?.neOtherNonrefundableCredits || 0));
  const nonrefundableCredits = Math.min(totalTaxBeforeCredits, dollars(personalExemptionCredit + otherNonrefundableCredits));
  const taxAfterNonrefundableCredits = Math.max(0, dollars(totalTaxBeforeCredits - nonrefundableCredits));

  const federalTaxBeforeCreditsLimit = Math.max(0, dollars(input?.neFederalTaxBeforeCreditsLimit || 0));
  const federalTaxLimitApplies = netAdjustments < 5000 && taxAfterNonrefundableCredits > federalTaxBeforeCreditsLimit;
  const line35TaxAfterCredits = federalTaxLimitApplies
    ? Math.max(0, Math.min(taxAfterNonrefundableCredits, federalTaxBeforeCreditsLimit))
    : taxAfterNonrefundableCredits;

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherFormWithholding = Math.max(0, dollars(input?.neOtherFormWithholding || 0));
  const k1Withholding = Math.max(0, dollars(input?.neK1Withholding || 0));
  const ptetCredit = Math.max(0, dollars(input?.nePtetCredit || 0));
  const estimatedPayments = Math.max(0, dollars(input?.neEstimatedPayments || 0));
  const form3800RefundableCredit = Math.max(0, dollars(input?.neForm3800RefundableCredit || 0));
  const childDependentCareRefundableCredit = Math.max(0, dollars(input?.neChildDependentCareRefundableCredit || 0));
  const beginningFarmerCredit = Math.max(0, dollars(input?.neBeginningFarmerCredit || 0));
  const federalEITCAmount = Math.max(0, dollars(input?.neFederalEITCAmount || 0));
  const neEarnedIncomeCredit = Math.max(0, Math.round(federalEITCAmount * 0.10));
  const otherRefundableCredits = Math.max(0, dollars(input?.neOtherRefundableCredits || 0));
  const totalStatePayments = dollars(
    stateWithheld + otherFormWithholding + k1Withholding + ptetCredit + estimatedPayments +
    form3800RefundableCredit + childDependentCareRefundableCredit + beginningFarmerCredit +
    neEarnedIncomeCredit + otherRefundableCredits
  );

  const underpaymentPenalty = Math.max(0, dollars(input?.neUnderpaymentPenalty || 0));
  const useTax = Math.max(0, dollars(input?.neUseTax || 0));
  const stateTax = dollars(line35TaxAfterCredits + underpaymentPenalty + useTax);
  const preAllocationNet = dollars(totalStatePayments - stateTax);
  const applyToNextYearRequested = Math.max(0, dollars(input?.neApplyToNextYear || 0));
  const wildlifeDonationRequested = Math.max(0, dollars(input?.neWildlifeDonation || 0));
  const availableOverpayment = Math.max(0, preAllocationNet);
  const applyToNextYear = Math.min(availableOverpayment, applyToNextYearRequested);
  const wildlifeDonation = Math.min(Math.max(0, availableOverpayment - applyToNextYear), wildlifeDonationRequested);
  const refundAllocations = dollars(applyToNextYear + wildlifeDonation);
  const net = preAllocationNet > 0 ? dollars(preAllocationNet - refundAllocations) : preAllocationNet;

  return {
    incomeResult: {
      federalAdjustedGrossIncome: dollars(federalAGI),
      standardDeduction,
      federalItemizedDeductions,
      stateLocalIncomeTaxes,
      neItemizedDeductions,
      deduction,
      incomeBeforeAdjustments,
      scheduleIIncreases,
      scheduleIDecreases,
      netAdjustments,
      stateTaxableIncome,
    },
    incomeTax,
    federalLumpSumTax,
    federalEarlyDistributionTax,
    otherTax,
    totalTaxBeforeCredits,
    personalExemptionCount,
    personalExemptionCredit,
    otherNonrefundableCredits,
    nonrefundableCredits,
    taxAfterNonrefundableCredits,
    federalTaxBeforeCreditsLimit,
    federalTaxLimitApplies,
    line35TaxAfterCredits,
    stateWithheld,
    otherFormWithholding,
    k1Withholding,
    ptetCredit,
    estimatedPayments,
    form3800RefundableCredit,
    childDependentCareRefundableCredit,
    beginningFarmerCredit,
    federalEITCAmount,
    neEarnedIncomeCredit,
    otherRefundableCredits,
    totalStatePayments,
    underpaymentPenalty,
    useTax,
    stateTax,
    preAllocationNet,
    applyToNextYear,
    wildlifeDonation,
    refundAllocations,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function getIowa2025ExemptionCredit(input) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  const age = Number(input?.age || 0);
  const spouseAge = Number(input?.spouseAge || 0);
  const dependents = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));

  const basePersonalCredits = (status === "mfj" || status === "hoh") ? 2 : 1;
  let credit = basePersonalCredits * 40;

  if (age >= 65) credit += 20;
  if (input?.iaTaxpayerBlind === true) credit += 20;
  if (status === "mfj") {
    if (spouseAge >= 65) credit += 20;
    if (input?.iaSpouseBlind === true) credit += 20;
  }

  credit += dependents * 40;
  return dollars(credit);
}

function computeIowa2025Tax(input, federalSummary = {}) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  const federalTaxableIncome = dollars(Number(input?.iaFederalTaxableIncomeLine2 || 0));
  const netIowaModifications = dollars(Number(input?.iaNetIowaModifications || 0));
  const iowaTaxableIncome = dollars(federalTaxableIncome + netIowaModifications);

  const specialFederalDeduction = Math.max(0, dollars(input?.iaFederalDeductionForSpecialCalc || 0));
  const federalPersonalExemption = Math.max(0, dollars(input?.iaFederalPersonalExemptionForSpecialCalc || 0));
  const qbiDeduction = Math.max(0, dollars(input?.iaQualifiedBusinessIncomeDeduction || 0));
  const nolCarryover = Math.max(0, dollars(input?.iaNolCarryover || 0));
  const lumpSumDistributionTaxableIncome = Math.max(0, dollars(input?.iaLumpSumDistributionTaxableIncome || 0));
  const specialAddbacks = dollars(specialFederalDeduction + federalPersonalExemption + qbiDeduction + nolCarryover + lumpSumDistributionTaxableIncome);
  const adjustedIowaIncome = dollars(iowaTaxableIncome + specialAddbacks);

  const taxpayerAge65 = Number(input?.age || 0) >= 65;
  const spouseAge65 = Number(input?.spouseAge || 0) >= 65;
  const claimedAsDependent = input?.canBeClaimedAsDependent === true;
  const enhancedThreshold = (taxpayerAge65 || ((status === "mfj" || status === "mfs") && spouseAge65));

  let lowIncomeExempt = false;
  if (status === "single") {
    lowIncomeExempt = claimedAsDependent
      ? iowaTaxableIncome < 5000
      : adjustedIowaIncome <= (taxpayerAge65 ? 24000 : 9000);
  } else if (status === "mfs") {
    const spouseAdjustedIncome = dollars(input?.iaMfsSpouseAdjustedIncome || 0);
    const spouseNolCarryover = Math.max(0, dollars(input?.iaMfsSpouseNolCarryover || 0));
    lowIncomeExempt = !claimedAsDependent && nolCarryover <= 0 && spouseNolCarryover <= 0 &&
      adjustedIowaIncome <= 9000 && (adjustedIowaIncome + spouseAdjustedIncome) <= 13500;
  } else {
    lowIncomeExempt = !claimedAsDependent && adjustedIowaIncome <= (enhancedThreshold ? 32000 : 13500);
  }

  const regularTax = Math.max(0, Math.round(Math.max(0, iowaTaxableIncome) * 0.038));
  let line5IowaTax = lowIncomeExempt ? 0 : regularTax;
  let alternateTaxUsed = false;
  let alternateTax = null;

  if (!lowIncomeExempt && status !== "single") {
    const altThreshold = enhancedThreshold ? 32000 : 13500;
    if (status === "mfs") {
      const spouseTaxableIncome = dollars(input?.iaMfsSpouseIowaTaxableIncome || 0);
      const spouseAdjustedIncome = dollars(input?.iaMfsSpouseAdjustedIncome || 0);
      const spouseNolCarryover = Math.max(0, dollars(input?.iaMfsSpouseNolCarryover || 0));
      const combinedAdjusted = dollars(adjustedIowaIncome + spouseAdjustedIncome);
      const combinedRegularTax = Math.max(0, Math.round(Math.max(0, iowaTaxableIncome) * 0.038)) +
        Math.max(0, Math.round(Math.max(0, spouseTaxableIncome) * 0.038));
      const combinedAlternate = Math.max(0, Math.round(Math.max(0, combinedAdjusted - altThreshold) * 0.043));
      if (nolCarryover <= 0 && spouseNolCarryover <= 0 && combinedAlternate < combinedRegularTax) {
        const ratio = combinedAdjusted > 0 ? Math.max(0, adjustedIowaIncome) / combinedAdjusted : 0;
        const roundedRatio = Math.round(ratio * 1000) / 1000;
        line5IowaTax = Math.max(0, Math.round(combinedAlternate * roundedRatio));
        alternateTaxUsed = true;
        alternateTax = line5IowaTax;
      }
    } else {
      const candidate = Math.max(0, Math.round(Math.max(0, adjustedIowaIncome - altThreshold) * 0.043));
      alternateTax = candidate;
      if (candidate < regularTax) {
        line5IowaTax = candidate;
        alternateTaxUsed = true;
      }
    }
  }

  const lumpSumTax = Math.max(0, dollars(input?.iaLumpSumTax || 0));
  const totalTaxLine7 = dollars(line5IowaTax + lumpSumTax);
  const exemptionCredit = getIowa2025ExemptionCredit(input);
  const tuitionTextbookCredit = Math.max(0, dollars(input?.iaTuitionTextbookCredit || 0));
  const volunteerCredit = Math.max(0, dollars(input?.iaVolunteerCredit || 0));
  const requestedInitialCredits = dollars(exemptionCredit + tuitionTextbookCredit + volunteerCredit);
  const initialCredits = Math.min(totalTaxLine7, requestedInitialCredits);
  let balanceLine12 = Math.max(0, dollars(totalTaxLine7 - initialCredits));

  let singleTaxReductionUsed = false;
  if (!lowIncomeExempt && status === "single" && !claimedAsDependent) {
    const threshold = taxpayerAge65 ? 24000 : 9000;
    const reductionLimit = Math.max(0, dollars(adjustedIowaIncome - threshold));
    if (reductionLimit < balanceLine12) {
      balanceLine12 = reductionLimit;
      singleTaxReductionUsed = true;
    }
  }

  const requestedOtherNonrefundableCredits = Math.max(0, dollars(input?.iaOtherNonrefundableCredits || 0));
  const otherNonrefundableCredits = Math.min(balanceLine12, requestedOtherNonrefundableCredits);
  const balanceLine18 = Math.max(0, dollars(balanceLine12 - otherNonrefundableCredits));

  const surtaxRatePercent = Number(input?.iaSchoolDistrictEmsSurtaxRate || 0);
  const schoolDistrictEmsSurtax = Math.max(0, Math.round(balanceLine18 * (surtaxRatePercent / 100)));
  const totalStateLocalTaxLine20 = dollars(balanceLine18 + schoolDistrictEmsSurtax);
  const contributions = Math.max(0, dollars(input?.iaContributions || 0));
  const totalTaxAndContributionsLine22 = dollars(totalStateLocalTaxLine20 + contributions);

  const fuelTaxCredit = Math.max(0, dollars(input?.iaFuelTaxCredit || 0));
  const childDependentOrEarlyChildhoodCredit = Math.max(0, dollars(input?.iaChildDependentOrEarlyChildhoodCredit || 0));
  const earnedIncomeTaxCredit = Math.max(0, dollars(input?.iaEarnedIncomeTaxCredit || 0));
  const otherRefundableCredits = Math.max(0, dollars(input?.iaOtherRefundableCredits || 0));
  const compositePtetCredit = Math.max(0, dollars(input?.iaCompositePtetCredit || 0));
  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const estimatedAndOtherPayments = Math.max(0, dollars(input?.iaEstimatedAndOtherPayments || 0));
  const totalStatePayments = dollars(fuelTaxCredit + childDependentOrEarlyChildhoodCredit + earnedIncomeTaxCredit + otherRefundableCredits + compositePtetCredit + stateWithheld + estimatedAndOtherPayments);

  const underpaymentPenalty = Math.max(0, dollars(input?.iaUnderpaymentPenalty || 0));
  const otherPenaltyInterest = Math.max(0, dollars(input?.iaOtherPenaltyInterest || 0));
  const totalPenalties = dollars(underpaymentPenalty + otherPenaltyInterest);
  const stateTax = dollars(totalTaxAndContributionsLine22 + totalPenalties);
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalTaxableIncome,
      netIowaModifications,
      iowaTaxableIncome,
      specialFederalDeduction,
      federalPersonalExemption,
      qbiDeduction,
      nolCarryover,
      lumpSumDistributionTaxableIncome,
      adjustedIowaIncome,
      lowIncomeExempt,
    },
    regularTax,
    alternateTax,
    alternateTaxUsed,
    singleTaxReductionUsed,
    line5IowaTax,
    lumpSumTax,
    totalTaxLine7,
    exemptionCredit,
    tuitionTextbookCredit,
    volunteerCredit,
    initialCredits,
    balanceLine12,
    otherNonrefundableCredits,
    balanceLine18,
    surtaxRatePercent,
    schoolDistrictEmsSurtax,
    totalStateLocalTaxLine20,
    contributions,
    totalTaxAndContributionsLine22,
    fuelTaxCredit,
    childDependentOrEarlyChildhoodCredit,
    earnedIncomeTaxCredit,
    otherRefundableCredits,
    compositePtetCredit,
    stateWithheld,
    estimatedAndOtherPayments,
    totalStatePayments,
    underpaymentPenalty,
    otherPenaltyInterest,
    totalPenalties,
    stateTax,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function getMinnesota2025PreliminaryStandardDeduction(input) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  const taxpayerAge65 = Number(input?.age || 0) >= 65;
  const spouseAge65 = (status === "mfj" || status === "mfs") && Number(input?.spouseAge || 0) >= 65;
  const taxpayerBlind = input?.mnTaxpayerBlind === true;
  const spouseBlind = (status === "mfj" || status === "mfs") && input?.mnSpouseBlind === true;
  const spouseBoxesAllowedForMFS = status === "mfs" && input?.mnMfsSpouseNoGrossIncomeAndNotDependent === true;

  let additionalBoxes = (taxpayerAge65 ? 1 : 0) + (taxpayerBlind ? 1 : 0);
  if (status === "mfj") additionalBoxes += (spouseAge65 ? 1 : 0) + (spouseBlind ? 1 : 0);
  if (status === "mfs" && spouseBoxesAllowedForMFS) additionalBoxes += (spouseAge65 ? 1 : 0) + (spouseBlind ? 1 : 0);

  const dependentWorksheetApplies = input?.canBeClaimedAsDependent === true || (status === "mfj" && input?.mnSpouseCanBeClaimedAsDependent === true);
  if (dependentWorksheetApplies) {
    const earned = Math.max(0, dollars(input?.mnDependentEarnedIncome || 0));
    const step1 = earned > 900 ? dollars(earned + 350) : 1250;
    const increment = status === "mfj" || status === "qw" ? 1550 : 2000;
    const cap = dollars(14950 + (additionalBoxes * increment));
    return Math.max(0, Math.min(step1, cap));
  }

  const base = status === "mfj" || status === "qw" ? 29900 : status === "hoh" ? 22500 : 14950;
  const increment = status === "mfj" || status === "mfs" || status === "qw" ? 1550 : 2000;
  return dollars(base + (additionalBoxes * increment));
}

function getMinnesota2025StandardDeduction(input, worksheetAGI) {
  const status = String(input?.filingStatus || "single").toLowerCase();
  const prelim = getMinnesota2025PreliminaryStandardDeduction(input);
  const agi = Math.max(0, dollars(worksheetAGI || 0));
  const threshold = status === "mfs" ? 119475 : 238950;
  if (agi <= threshold) return prelim;
  if (agi > 1083150) return Math.max(0, dollars(prelim * 0.20));

  const firstCapPoint = status === "mfs" ? 165150 : 330300;
  const firstCap = status === "mfs" ? 45675 : 91350;
  const step2 = agi > firstCapPoint ? firstCap : Math.max(0, agi - threshold);
  const step3 = step2 * 0.03;
  const step4 = agi > firstCapPoint ? agi - firstCapPoint : 0;
  const step5 = step4 * 0.10;
  const reduction = Math.min(step3 + step5, prelim * 0.80);
  return Math.max(0, dollars(prelim - reduction));
}

function getMinnesota2025DependentExemption(input, worksheetAGI) {
  if (input?.canBeClaimedAsDependent === true) return 0;
  const count = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  if (!count) return 0;
  const status = String(input?.filingStatus || "single").toLowerCase();
  const full = dollars(count * 5200);
  const thresholds = { mfj: 358550, qw: 358550, hoh: 298800, single: 239050, mfs: 179275 };
  const threshold = thresholds[status] ?? thresholds.single;
  const agi = Math.max(0, dollars(worksheetAGI || 0));
  if (agi <= threshold) return full;
  const excess = agi - threshold;
  const maxExcess = status === "mfs" ? 61250 : 122500;
  if (excess > maxExcess) return 0;
  const step = status === "mfs" ? 1250 : 2500;
  const increments = Math.ceil(excess / step);
  const reductionPct = increments * 0.02;
  return Math.max(0, dollars(full * (1 - reductionPct)));
}

function computeMinnesota2025RateScheduleTax(taxableIncome, filingStatus) {
  const income = Math.max(0, Number(taxableIncome || 0));
  let status = String(filingStatus || "single").toLowerCase();
  if (status === "qw") status = "mfj";
  const schedules = {
    single: [
      [32570, 0, 0.0535, 0],
      [106990, 32570, 0.068, 1742.50],
      [198630, 106990, 0.0785, 6803.06],
      [Infinity, 198630, 0.0985, 13996.80],
    ],
    mfj: [
      [47620, 0, 0.0535, 0],
      [189180, 47620, 0.068, 2547.67],
      [330410, 189180, 0.0785, 12173.75],
      [Infinity, 330410, 0.0985, 23260.31],
    ],
    mfs: [
      [23810, 0, 0.0535, 0],
      [94590, 23810, 0.068, 1273.84],
      [165205, 94590, 0.0785, 6086.88],
      [Infinity, 165205, 0.0985, 11630.16],
    ],
    hoh: [
      [40100, 0, 0.0535, 0],
      [161130, 40100, 0.068, 2145.35],
      [264050, 161130, 0.0785, 10375.39],
      [Infinity, 264050, 0.0985, 18454.61],
    ],
  };
  const rows = schedules[status] || schedules.single;
  for (const [max, floor, rate, base] of rows) {
    if (income <= max) return Math.max(0, base + ((income - floor) * rate));
  }
  return 0;
}

function computeMinnesota2025TaxTable(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome || 0));
  // The official 2025 Form M1 tax table has special opening bands:
  // $0-$19 => $0 and $20-$99 => $3 for every filing status.
  if (income < 20) return 0;
  if (income < 100) return 3;
  if (income >= 90000) return Math.max(0, Math.round(computeMinnesota2025RateScheduleTax(income, filingStatus)));
  const midpoint = (Math.floor(income / 100) * 100) + 50;
  return Math.max(0, Math.round(computeMinnesota2025RateScheduleTax(midpoint, filingStatus)));
}

function computeMinnesota2025Tax(input, federalAGI) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAdjustedGrossIncome = dollars(federalAGI || 0);
  const additions = Math.max(0, dollars(input?.mnM1Additions || 0));
  const line3Income = dollars(federalAdjustedGrossIncome + additions);
  const worksheetAGI = input?.mnHasM1NCFederalAdjustments === true
    ? dollars(input?.mnM1NCWorksheetAGI || 0)
    : federalAdjustedGrossIncome;

  const usesItemized = input?.mnUseItemizedDeductions === true;
  const deduction = usesItemized
    ? Math.max(0, dollars(input?.mnItemizedDeductions || 0))
    : getMinnesota2025StandardDeduction(input, worksheetAGI);
  const dependentExemption = getMinnesota2025DependentExemption(input, worksheetAGI);
  const stateIncomeTaxRefund = Math.max(0, dollars(input?.mnStateIncomeTaxRefund || 0));
  const otherSubtractions = Math.max(0, dollars(input?.mnM1Subtractions || 0));
  const totalSubtractions = dollars(deduction + dependentExemption + stateIncomeTaxRefund + otherSubtractions);
  const stateTaxableIncome = Math.max(0, dollars(line3Income - totalSubtractions));

  const regularTax = computeMinnesota2025TaxTable(stateTaxableIncome, filingStatus);
  const alternativeMinimumTax = Math.max(0, dollars(input?.mnAlternativeMinimumTax || 0));
  const residentIncomeTax = dollars(regularTax + alternativeMinimumTax);
  const otherTaxes = Math.max(0, dollars(input?.mnOtherTaxes || 0));
  const advanceChildTaxCreditRepayment = Math.max(0, dollars(input?.mnAdvanceChildTaxCreditRepayment || 0));
  const taxBeforeCredits = dollars(residentIncomeTax + otherTaxes + advanceChildTaxCreditRepayment);
  const requestedNonrefundableCredits = Math.max(0, dollars(input?.mnNonrefundableCredits || 0));
  const nonrefundableCredits = Math.min(taxBeforeCredits, requestedNonrefundableCredits);
  const taxAfterCredits = Math.max(0, dollars(taxBeforeCredits - nonrefundableCredits));
  const nongameWildlifeContribution = Math.max(0, dollars(input?.mnNongameWildlifeContribution || 0));
  const formM1Tax = dollars(taxAfterCredits + nongameWildlifeContribution);

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const estimatedPayments = Math.max(0, dollars(input?.mnEstimatedPayments || 0));
  const refundableCredits = Math.max(0, dollars(input?.mnRefundableCredits || 0));
  const totalStatePayments = dollars(stateWithheld + estimatedPayments + refundableCredits);
  const preliminaryNet = dollars(totalStatePayments - formM1Tax);
  const scheduleM15Penalty = Math.max(0, dollars(input?.mnScheduleM15Penalty || 0));
  const otherPenaltyInterest = Math.max(0, dollars(input?.mnOtherPenaltyInterest || 0));
  const stateTax = dollars(formM1Tax + scheduleM15Penalty + otherPenaltyInterest);
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      additions,
      line3Income,
      worksheetAGI,
      usesItemized,
      deduction,
      dependentExemption,
      stateIncomeTaxRefund,
      otherSubtractions,
      totalSubtractions,
      stateTaxableIncome,
    },
    regularTax,
    alternativeMinimumTax,
    residentIncomeTax,
    otherTaxes,
    advanceChildTaxCreditRepayment,
    taxBeforeCredits,
    requestedNonrefundableCredits,
    nonrefundableCredits,
    taxAfterCredits,
    nongameWildlifeContribution,
    formM1Tax,
    stateWithheld,
    estimatedPayments,
    refundableCredits,
    totalStatePayments,
    preliminaryNet,
    scheduleM15Penalty,
    otherPenaltyInterest,
    stateTax,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function getWisconsin2025StandardDeductionTableAmount(filingStatus, wisconsinIncome) {
  let status = String(filingStatus || "single").toLowerCase();
  // Wisconsin instructs federal qualifying surviving spouses to file Wisconsin
  // as head of household, so the HOH standard-deduction column applies.
  if (status === "qw") status = "hoh";

  const income = Math.max(0, dollars(wisconsinIncome || 0));
  let midpoint;

  // Form 1's published 2025 table uses these first two special bands and then
  // $500 bands.  The values are the rounded statutory formulas evaluated at
  // the table-band midpoint, including the final MFJ partial band.
  if (income < 13390) midpoint = 6695;
  else if (income < 13500) midpoint = 13445;
  else if (income < 155000) midpoint = 13500 + (Math.floor((income - 13500) / 500) * 500) + 250;
  else if (income < 155169) midpoint = (155000 + 155169) / 2;
  else midpoint = income;

  let amount = 0;
  if (status === "mfj") {
    if (income >= 155169) return 0;
    amount = midpoint < 28210
      ? 25110
      : 25110 - (0.19778 * (midpoint - 28210));
  } else if (status === "mfs") {
    if (midpoint >= 73710) return 0;
    amount = midpoint < 13390
      ? 11930
      : 11930 - (0.19778 * (midpoint - 13390));
  } else if (status === "hoh") {
    if (midpoint >= 132550) return 0;
    if (midpoint < 19550) amount = 17520;
    else if (midpoint < 57210) amount = 17520 - (0.22515 * (midpoint - 19550));
    else amount = 13560 - (0.12 * (midpoint - 19550));
  } else {
    if (midpoint >= 132550) return 0;
    amount = midpoint < 19550
      ? 13560
      : 13560 - (0.12 * (midpoint - 19550));
  }

  return Math.max(0, Math.round(amount));
}

function getWisconsin2025StandardDeduction(filingStatus, wisconsinIncome, dependentWorksheetApplies, dependentEarnedIncome) {
  const tableAmount = getWisconsin2025StandardDeductionTableAmount(filingStatus, wisconsinIncome);
  if (!dependentWorksheetApplies) return tableAmount;

  const earnedIncome = Math.max(0, dollars(dependentEarnedIncome || 0));
  const dependentWorksheetAmount = Math.max(1350, dollars(earnedIncome + 450));
  return Math.min(tableAmount, dependentWorksheetAmount);
}

function computeWisconsin2025RateScheduleTax(taxableIncome, filingStatus) {
  const income = Math.max(0, Number(taxableIncome || 0));
  let status = String(filingStatus || "single").toLowerCase();
  if (status === "qw") status = "hoh";

  if (status === "mfj") {
    if (income <= 19580) return income * 0.035;
    if (income <= 67300) return 685.30 + ((income - 19580) * 0.044);
    if (income <= 431060) return 2784.98 + ((income - 67300) * 0.053);
    return 22064.26 + ((income - 431060) * 0.0765);
  }
  if (status === "mfs") {
    if (income <= 9790) return income * 0.035;
    if (income <= 33650) return 342.65 + ((income - 9790) * 0.044);
    if (income <= 215530) return 1392.49 + ((income - 33650) * 0.053);
    return 11032.13 + ((income - 215530) * 0.0765);
  }

  if (income <= 14680) return income * 0.035;
  if (income <= 50480) return 513.80 + ((income - 14680) * 0.044);
  if (income <= 323290) return 2089.00 + ((income - 50480) * 0.053);
  return 16547.93 + ((income - 323290) * 0.0765);
}

function computeWisconsin2025TaxTable(taxableIncome, filingStatus) {
  const income = Math.max(0, dollars(taxableIncome || 0));
  let status = String(filingStatus || "single").toLowerCase();
  if (status === "qw") status = "hoh";

  if (income >= 100000) {
    // Form 1 Tax Computation Worksheet, used instead of the table at $100,000+.
    let tax;
    if (status === "mfj") {
      tax = income < 431060
        ? (income * 0.053) - 781.92
        : (income * 0.0765) - 10911.83;
    } else if (status === "mfs") {
      tax = income < 215530
        ? (income * 0.053) - 390.96
        : (income * 0.0765) - 5455.92;
    } else {
      tax = income < 323290
        ? (income * 0.053) - 586.44
        : (income * 0.0765) - 8183.76;
    }
    return Math.max(0, Math.round(tax));
  }

  // Form 1 Tax Table: $0-$20, $20-$40, $40-$100, then $100 bands.
  if (income < 20) return 0;
  let midpoint;
  if (income < 40) midpoint = 30;
  else if (income < 100) midpoint = 70;
  else midpoint = (Math.floor(income / 100) * 100) + 50;
  return Math.max(0, Math.round(computeWisconsin2025RateScheduleTax(midpoint, status)));
}

function computeWisconsin2025Tax(input, federalAGI) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAdjustedGrossIncome = dollars(federalAGI || 0);
  const scheduleIAdjustment = dollars(input?.wiScheduleIAdjustment || 0);
  const scheduleADAdditions = Math.max(0, dollars(input?.wiScheduleADAdditions || 0));
  const scheduleSBSubtractions = Math.max(0, dollars(input?.wiScheduleSBSubtractions || 0));

  const wisconsinIncome = dollars(
    federalAdjustedGrossIncome + scheduleIAdjustment + scheduleADAdditions - scheduleSBSubtractions
  );

  const spouseCanBeClaimed = filingStatus === "mfj" && input?.wiSpouseCanBeClaimedAsDependent === true;
  const taxpayerCanBeClaimed = input?.canBeClaimedAsDependent === true;
  const dependentWorksheetApplies = taxpayerCanBeClaimed || spouseCanBeClaimed;
  const standardDeduction = getWisconsin2025StandardDeduction(
    filingStatus,
    wisconsinIncome,
    dependentWorksheetApplies,
    input?.wiDependentEarnedIncome
  );

  let regularExemptionCount = 0;
  if (filingStatus === "mfj") {
    regularExemptionCount = (taxpayerCanBeClaimed ? 0 : 1) + (spouseCanBeClaimed ? 0 : 1);
  } else {
    regularExemptionCount = taxpayerCanBeClaimed ? 0 : 1;
  }
  regularExemptionCount += Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));

  const ageExemptionCount =
    ((!taxpayerCanBeClaimed && Number(input?.age || 0) >= 65) ? 1 : 0) +
    ((filingStatus === "mfj" && !spouseCanBeClaimed && Number(input?.spouseAge || 0) >= 65) ? 1 : 0);
  const exemptionAmount = dollars((regularExemptionCount * 700) + (ageExemptionCount * 250));

  const stateTaxableIncome = Math.max(0, dollars(wisconsinIncome - standardDeduction - exemptionAmount));
  const grossIncomeTax = computeWisconsin2025TaxTable(stateTaxableIncome, filingStatus);

  const requestedNonrefundableCredits = Math.max(0, dollars(input?.wiNonrefundableCredits || 0));
  const nonrefundableCredits = Math.min(grossIncomeTax, requestedNonrefundableCredits);
  const incomeTaxAfterNonrefundableCredits = Math.max(0, dollars(grossIncomeTax - nonrefundableCredits));

  const claimedFederalEIC = input?.wiClaimedFederalEIC === true;
  const federalEICAmount = claimedFederalEIC ? Math.max(0, dollars(input?.wiFederalEICAmount || 0)) : 0;
  const qualifyingChildren = claimedFederalEIC
    ? Math.max(0, Math.trunc(Number(input?.wiEICQualifyingChildren || 0)))
    : 0;
  const eicRate = qualifyingChildren >= 3 ? 0.34 : qualifyingChildren === 2 ? 0.11 : qualifyingChildren === 1 ? 0.04 : 0;
  const wisconsinEIC = claimedFederalEIC ? Math.max(0, Math.round(federalEICAmount * eicRate)) : 0;

  const otherRefundableCredits = Math.max(0, dollars(input?.wiOtherRefundableCredits || 0));
  const useTax = Math.max(0, dollars(input?.wiUseTax || 0));
  const donations = Math.max(0, dollars(input?.wiDonations || 0));
  const retirementAndOtherPenalties = Math.max(0, dollars(input?.wiRetirementPenaltiesAndCreditRepayments || 0));
  const underpaymentInterest = Math.max(0, dollars(input?.wiUnderpaymentInterest || 0));

  // Form 1 line 27 total tax includes income tax after credits plus lines 23-26.
  // Schedule U line 44 is then applied to the refund/amount due calculation.
  const form1TotalTax = dollars(incomeTaxAfterNonrefundableCredits + useTax + donations + retirementAndOtherPenalties);
  const stateTax = dollars(form1TotalTax + underpaymentInterest);

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const estimatedPayments = Math.max(0, dollars(input?.wiEstimatedPayments || 0));
  const totalStatePayments = dollars(stateWithheld + estimatedPayments + wisconsinEIC + otherRefundableCredits);
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      scheduleIAdjustment,
      scheduleADAdditions,
      scheduleSBSubtractions,
      wisconsinIncome,
      dependentWorksheetApplies,
      standardDeduction,
      regularExemptionCount,
      ageExemptionCount,
      exemptionAmount,
      stateTaxableIncome,
    },
    grossIncomeTax,
    requestedNonrefundableCredits,
    nonrefundableCredits,
    incomeTaxAfterNonrefundableCredits,
    claimedFederalEIC,
    federalEICAmount,
    qualifyingChildren,
    eicRate,
    wisconsinEIC,
    otherRefundableCredits,
    useTax,
    donations,
    retirementAndOtherPenalties,
    form1TotalTax,
    underpaymentInterest,
    stateTax,
    stateWithheld,
    estimatedPayments,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function getPennsylvania2025TaxForgivenessPercentage(filingStatus, dependentChildren, eligibilityIncome) {
  const status = String(filingStatus || "single").toLowerCase();
  const dependents = Math.max(0, Math.trunc(Number(dependentChildren || 0)));
  const income = Math.max(0, dollars(eligibilityIncome || 0));
  const married = status === "mfj" || status === "mfs";
  const base = (married ? 13000 : 6500) + (dependents * 9500);

  if (income <= base) return 1;
  const band = Math.ceil((income - base) / 250);
  if (band >= 10) return 0;
  return Math.max(0, (10 - band) / 10);
}

function computePennsylvania2025Tax(input) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();

  // PA-40 Lines 1c through 8 are Pennsylvania-defined income classes.  Lines
  // 4, 5 and 6 can report losses, but PA-40 Line 9 adds positive amounts only;
  // losses may not offset another class (or the other spouse on a joint return).
  const netCompensation = Math.max(0, dollars(input?.paNetCompensation || 0));
  const interestIncome = Math.max(0, dollars(input?.paInterestIncome || 0));
  const dividendIncome = Math.max(0, dollars(input?.paDividendIncome || 0));
  const businessFarmIncomeLoss = dollars(input?.paBusinessFarmIncomeLoss || 0);
  const propertyGainLoss = dollars(input?.paPropertyGainLoss || 0);
  const rentRoyaltyIncomeLoss = dollars(input?.paRentRoyaltyIncomeLoss || 0);
  const estateTrustIncome = Math.max(0, dollars(input?.paEstateTrustIncome || 0));
  const gamblingLotteryWinnings = Math.max(0, dollars(input?.paGamblingLotteryWinnings || 0));

  const totalPATaxableIncome = dollars(
    netCompensation +
    interestIncome +
    dividendIncome +
    Math.max(0, businessFarmIncomeLoss) +
    Math.max(0, propertyGainLoss) +
    Math.max(0, rentRoyaltyIncomeLoss) +
    estateTrustIncome +
    gamblingLotteryWinnings
  );

  const requestedOtherDeductions = Math.max(0, dollars(input?.paOtherDeductions || 0));
  const otherDeductions = Math.min(totalPATaxableIncome, requestedOtherDeductions);
  const adjustedPATaxableIncome = Math.max(0, dollars(totalPATaxableIncome - otherDeductions));
  const paTaxLiability = Math.max(0, Math.round(adjustedPATaxableIncome * 0.0307));

  const hasResidentCredit = input?.paHasResidentCredit === true;
  const residentCredit = hasResidentCredit
    ? Math.min(paTaxLiability, Math.max(0, dollars(input?.paResidentCredit || 0)))
    : 0;

  const claimTaxForgiveness = input?.paClaimTaxForgiveness === true;
  const taxForgivenessDependentChildren = claimTaxForgiveness
    ? Math.max(0, Math.trunc(Number(input?.paTaxForgivenessDependentChildren || 0)))
    : 0;
  const taxForgivenessEligibilityIncome = claimTaxForgiveness
    ? Math.max(0, dollars(input?.paTaxForgivenessEligibilityIncome || 0))
    : 0;
  const taxForgivenessPercentage = claimTaxForgiveness
    ? getPennsylvania2025TaxForgivenessPercentage(
        filingStatus,
        taxForgivenessDependentChildren,
        taxForgivenessEligibilityIncome
      )
    : 0;
  const dependentClaimantEligible = input?.canBeClaimedAsDependent !== true || input?.paDependentClaimantEligibleTaxForgiveness === true;
  const netTaxBeforeForgiveness = Math.max(0, dollars(paTaxLiability - residentCredit));
  const taxForgivenessCredit = claimTaxForgiveness && dependentClaimantEligible
    ? Math.min(netTaxBeforeForgiveness, Math.round(netTaxBeforeForgiveness * taxForgivenessPercentage))
    : 0;

  const childDependentCareCredit = input?.paHasChildDependentCareCredit === true
    ? Math.max(0, dollars(input?.paChildDependentCareCredit || 0))
    : 0;

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const priorYearCredit = Math.max(0, dollars(input?.paPriorYearCredit || 0));
  const estimatedPayments = Math.max(0, dollars(input?.paEstimatedPayments || 0));
  const extensionPayment = Math.max(0, dollars(input?.paExtensionPayment || 0));
  const nonresidentWithholding = Math.max(0, dollars(input?.paNonresidentWithholding || 0));

  // The Working Pennsylvanians Tax Credit begins with the 2025 return and is
  // 10% of the allowed federal EITC, capped at $805.  DOR applies it to reduce
  // PA tax or increase the refund.
  const claimedFederalEITC = input?.paClaimedFederalEITC === true;
  const federalEITCAmount = claimedFederalEITC
    ? Math.max(0, dollars(input?.paFederalEITCAmount || 0))
    : 0;
  const workingPennsylvaniansTaxCredit = claimedFederalEITC
    ? Math.min(805, Math.max(0, Math.round(federalEITCAmount * 0.10)))
    : 0;

  const paPaymentsAndCredits = dollars(
    stateWithheld +
    priorYearCredit +
    estimatedPayments +
    extensionPayment +
    nonresidentWithholding +
    taxForgivenessCredit +
    residentCredit +
    childDependentCareCredit +
    workingPennsylvaniansTaxCredit
  );

  const useTax = Math.max(0, dollars(input?.paUseTax || 0));
  const penaltiesInterest = Math.max(0, dollars(input?.paPenaltiesInterest || 0));
  const paStateTaxAndAdditions = dollars(paTaxLiability + useTax + penaltiesInterest);

  // Pennsylvania local EIT/wage-tax rates depend on the residence/work PSD.
  // The statewide estimator therefore uses exact completed local totals rather
  // than inventing a municipality or school-district rate.
  const hasLocalEarnedIncomeTax = input?.paHasLocalEarnedIncomeTax === true;
  const localEarnedIncomeTax = hasLocalEarnedIncomeTax
    ? Math.max(0, dollars(input?.paLocalEarnedIncomeTax || 0))
    : 0;
  const localEarnedIncomeWithholding = hasLocalEarnedIncomeTax
    ? Math.max(0, dollars(input?.paLocalEarnedIncomeWithholding || 0))
    : 0;
  const localEarnedIncomePayments = hasLocalEarnedIncomeTax
    ? Math.max(0, dollars(input?.paLocalEarnedIncomePayments || 0))
    : 0;
  const localTotalPayments = dollars(localEarnedIncomeWithholding + localEarnedIncomePayments);

  const stateTax = dollars(paStateTaxAndAdditions + localEarnedIncomeTax);
  const totalStatePayments = dollars(paPaymentsAndCredits + localTotalPayments);
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      netCompensation,
      interestIncome,
      dividendIncome,
      businessFarmIncomeLoss,
      propertyGainLoss,
      rentRoyaltyIncomeLoss,
      estateTrustIncome,
      gamblingLotteryWinnings,
      totalPATaxableIncome,
      requestedOtherDeductions,
      otherDeductions,
      adjustedPATaxableIncome,
    },
    paTaxLiability,
    hasResidentCredit,
    residentCredit,
    claimTaxForgiveness,
    taxForgivenessDependentChildren,
    taxForgivenessEligibilityIncome,
    taxForgivenessPercentage,
    taxForgivenessCredit,
    childDependentCareCredit,
    stateWithheld,
    priorYearCredit,
    estimatedPayments,
    extensionPayment,
    nonresidentWithholding,
    claimedFederalEITC,
    federalEITCAmount,
    workingPennsylvaniansTaxCredit,
    paPaymentsAndCredits,
    useTax,
    penaltiesInterest,
    paStateTaxAndAdditions,
    hasLocalEarnedIncomeTax,
    localEarnedIncomeTax,
    localEarnedIncomeWithholding,
    localEarnedIncomePayments,
    localTotalPayments,
    stateTax,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function computeMichigan2025Tax(input, federalAGI, federalSummary = {}) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAdjustedGrossIncome = dollars(federalAGI || 0);

  // Michigan Schedule 1 line 2 adds back the federal deduction for the
  // deductible portion of self-employment tax. The current federal engine
  // exposes that exact modeled amount as seAboveLineDeduction.
  const federalSeTaxDeductionAddback = Math.max(
    0,
    dollars(federalSummary?.seAboveLineDeduction || 0)
  );
  const otherAdditions = Math.max(0, dollars(input?.miOtherAdditions || 0));
  const totalAdditions = dollars(federalSeTaxDeductionAddback + otherAdditions);

  const taxableSocialSecurity = Math.max(0, dollars(input?.miTaxableSocialSecurity || 0));
  const otherSubtractions = Math.max(0, dollars(input?.miOtherSubtractions || 0));
  const totalSubtractions = dollars(taxableSocialSecurity + otherSubtractions);
  const incomeSubjectToTax = Math.max(
    0,
    dollars(federalAdjustedGrossIncome + totalAdditions - totalSubtractions)
  );

  const dependentCount = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  const canBeClaimedAsDependent = input?.canBeClaimedAsDependent === true;
  const taxpayerAndSpouseCount = filingStatus === "mfj" ? 2 : 1;
  const regularExemptionCount = canBeClaimedAsDependent
    ? 0
    : taxpayerAndSpouseCount + dependentCount;
  const regularExemptionAllowance = canBeClaimedAsDependent
    ? 1500
    : dollars(regularExemptionCount * 5800);

  const specialExemptionCount = Math.max(0, Math.trunc(Number(input?.miSpecialExemptionCount || 0)));
  const disabledVeteranExemptionCount = Math.max(0, Math.trunc(Number(input?.miQualifiedDisabledVeteranCount || 0)));
  const stillbirthExemptionCount = Math.max(0, Math.trunc(Number(input?.miStillbirthCount || 0)));
  const specialExemptionAllowance = dollars(specialExemptionCount * 3400);
  const disabledVeteranExemptionAllowance = dollars(disabledVeteranExemptionCount * 500);
  const stillbirthExemptionAllowance = dollars(stillbirthExemptionCount * 5800);
  const exemptionAllowance = dollars(
    regularExemptionAllowance +
    specialExemptionAllowance +
    disabledVeteranExemptionAllowance +
    stillbirthExemptionAllowance
  );

  const stateTaxableIncome = Math.max(0, dollars(incomeSubjectToTax - exemptionAllowance));
  const stateTaxBeforeCredits = dollars(stateTaxableIncome * 0.0425);

  const michiganEITC = input?.miClaimedFederalEIC === true
    ? dollars(Math.max(0, Number(input?.miFederalEICAmount || 0)) * 0.30)
    : 0;
  const useTax = input?.miHasUseTax === true
    ? Math.max(0, dollars(input?.miUseTax || 0))
    : 0;
  const stateTax = dollars(stateTaxBeforeCredits + useTax);
  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const estimatedAndExtensionPayments = Math.max(
    0,
    dollars(input?.miEstimatedAndExtensionPayments || 0)
  );
  const totalStatePayments = dollars(
    stateWithheld + estimatedAndExtensionPayments + michiganEITC
  );
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      federalSeTaxDeductionAddback,
      otherAdditions,
      totalAdditions,
      taxableSocialSecurity,
      otherSubtractions,
      totalSubtractions,
      incomeSubjectToTax,
      regularExemptionCount,
      regularExemptionAllowance,
      specialExemptionCount,
      specialExemptionAllowance,
      disabledVeteranExemptionCount,
      disabledVeteranExemptionAllowance,
      stillbirthExemptionCount,
      stillbirthExemptionAllowance,
      exemptionAllowance,
      stateTaxableIncome,
    },
    stateTaxBeforeCredits,
    michiganEITC,
    useTax,
    stateTax,
    stateWithheld,
    estimatedAndExtensionPayments,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function computeWestVirginia2025RateScheduleTax(taxableIncome, filingStatus = "single") {
  const taxable = Math.max(0, Number(taxableIncome || 0));
  const isMfs = String(filingStatus || "single").toLowerCase() === "mfs";
  let tax = 0;

  if (isMfs) {
    if (taxable < 5000) tax = taxable * 0.0222;
    else if (taxable < 12500) tax = 111 + ((taxable - 5000) * 0.0296);
    else if (taxable < 20000) tax = 333 + ((taxable - 12500) * 0.0333);
    else if (taxable < 30000) tax = 582.75 + ((taxable - 20000) * 0.0444);
    else tax = 1026.75 + ((taxable - 30000) * 0.0482);
  } else {
    if (taxable < 10000) tax = taxable * 0.0222;
    else if (taxable < 25000) tax = 222 + ((taxable - 10000) * 0.0296);
    else if (taxable < 40000) tax = 666 + ((taxable - 25000) * 0.0333);
    else if (taxable < 60000) tax = 1165.50 + ((taxable - 40000) * 0.0444);
    else tax = 2053.50 + ((taxable - 60000) * 0.0482);
  }

  return dollars(tax);
}

function computeWestVirginia2025TaxTable(taxableIncome) {
  const taxable = Math.max(0, dollars(taxableIncome));
  if (taxable < 25) return 0;
  if (taxable >= 100000) {
    return computeWestVirginia2025RateScheduleTax(taxable, "single");
  }

  let lower;
  let width;
  if (taxable < 100) {
    width = 25;
    lower = 25 + (Math.floor((taxable - 25) / 25) * 25);
  } else if (taxable < 25000) {
    width = 100;
    lower = 100 + (Math.floor((taxable - 100) / 100) * 100);
  } else if (taxable < 40000) {
    width = 60;
    lower = 25000 + (Math.floor((taxable - 25000) / 60) * 60);
  } else {
    width = 50;
    lower = 40000 + (Math.floor((taxable - 40000) / 50) * 50);
  }

  const midpoint = lower + (width / 2);
  return computeWestVirginia2025RateScheduleTax(midpoint, "single");
}

function getWestVirginia2025FamilyTaxCreditPercentage(filingStatus, familySize, modifiedFederalAGI) {
  const size = Math.min(8, Math.max(0, Math.trunc(Number(familySize || 0))));
  if (size <= 0) return 0;

  const isMfs = String(filingStatus || "single").toLowerCase() === "mfs";
  const base100 = (isMfs ? 7825 : 15650) + ((size - 1) * (isMfs ? 2750 : 5500));
  const step = isMfs ? 150 : 300;
  const income = Math.max(0, dollars(modifiedFederalAGI));

  if (income <= base100) return 1;
  const band = Math.ceil((income - base100) / step);
  if (band >= 10) return 0;
  return (10 - band) / 10;
}

function computeWestVirginia2025Tax(input, federalAGI) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAdjustedGrossIncome = dollars(federalAGI || 0);
  const totalAdditions = Math.max(0, dollars(input?.wvTotalAdditions || 0));
  const taxableSocialSecurity = Math.max(0, dollars(input?.wvTaxableSocialSecurity || 0));
  const socialSecurityThreshold = filingStatus === "mfj" ? 100000 : 50000;
  const socialSecuritySubtraction = dollars(
    taxableSocialSecurity * (federalAdjustedGrossIncome <= socialSecurityThreshold ? 1 : 0.65)
  );
  const otherSubtractions = Math.max(0, dollars(input?.wvOtherSubtractions || 0));
  const totalSubtractions = dollars(socialSecuritySubtraction + otherSubtractions);
  const westVirginiaAdjustedGrossIncome = dollars(
    federalAdjustedGrossIncome + totalAdditions - totalSubtractions
  );

  const lowIncomeThreshold = filingStatus === "mfs" ? 5000 : 10000;
  const lowIncomeEarnedIncome = Math.max(0, dollars(input?.wvLowIncomeEarnedIncome || 0));
  const lowIncomeEarnedIncomeExclusion = federalAdjustedGrossIncome <= lowIncomeThreshold
    ? Math.max(0, Math.min(
        federalAdjustedGrossIncome,
        lowIncomeEarnedIncome,
        lowIncomeThreshold
      ))
    : 0;

  const dependentCount = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  const taxpayerExemption = input?.canBeClaimedAsDependent === true ? 0 : 1;
  const spouseExemption = filingStatus === "mfj" && input?.wvSpouseCanBeClaimedAsDependent !== true ? 1 : 0;
  const allowedDependents = input?.canBeClaimedAsDependent === true ? 0 : dependentCount;
  const survivingSpouseExemption = filingStatus === "qw" && input?.wvSurvivingSpouseExemption === true ? 1 : 0;
  const totalExemptionCount = taxpayerExemption + spouseExemption + allowedDependents + survivingSpouseExemption;
  const exemptionAllowance = totalExemptionCount === 0 ? 500 : dollars(totalExemptionCount * 2000);

  const stateTaxableIncome = Math.max(0, dollars(
    westVirginiaAdjustedGrossIncome - lowIncomeEarnedIncomeExclusion - exemptionAllowance
  ));

  const stateTaxBeforeCredits = filingStatus === "mfs"
    ? computeWestVirginia2025RateScheduleTax(stateTaxableIncome, filingStatus)
    : stateTaxableIncome < 100000
      ? computeWestVirginia2025TaxTable(stateTaxableIncome)
      : computeWestVirginia2025RateScheduleTax(stateTaxableIncome, filingStatus);

  const familySizeForCredit = taxpayerExemption + spouseExemption + allowedDependents;
  const taxExemptInterestForFamilyCredit = Math.max(0, dollars(input?.wvTaxExemptInterestForFamilyCredit || 0));
  const modifiedFederalAGIForFamilyCredit = dollars(
    federalAdjustedGrossIncome + totalAdditions + taxExemptInterestForFamilyCredit
  );
  const familyTaxCreditPercentage = input?.wvFederalAMT === true
    ? 0
    : getWestVirginia2025FamilyTaxCreditPercentage(
        filingStatus,
        familySizeForCredit,
        modifiedFederalAGIForFamilyCredit
      );
  const familyTaxCredit = Math.min(
    stateTaxBeforeCredits,
    dollars(stateTaxBeforeCredits * familyTaxCreditPercentage)
  );

  const childDependentCareCredit = input?.wvHasChildDependentCareCredit === true
    ? dollars(Math.max(0, Number(input?.wvFederalChildDependentCareCredit || 0)) * 0.50)
    : 0;
  const nonrefundableCredits = Math.min(
    stateTaxBeforeCredits,
    dollars(familyTaxCredit + childDependentCareCredit)
  );
  const incomeTaxDue = Math.max(0, dollars(stateTaxBeforeCredits - nonrefundableCredits));

  const useTax = input?.wvHasUseTax === true ? Math.max(0, dollars(input?.wvUseTax || 0)) : 0;
  const stateTax = dollars(incomeTaxDue + useTax);
  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const estimatedAndExtensionPayments = Math.max(0, dollars(input?.wvEstimatedAndExtensionPayments || 0));
  const totalStatePayments = dollars(stateWithheld + estimatedAndExtensionPayments);
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      totalAdditions,
      taxableSocialSecurity,
      socialSecuritySubtraction,
      otherSubtractions,
      totalSubtractions,
      westVirginiaAdjustedGrossIncome,
      lowIncomeEarnedIncome,
      lowIncomeEarnedIncomeExclusion,
      taxpayerExemption,
      spouseExemption,
      allowedDependents,
      survivingSpouseExemption,
      totalExemptionCount,
      exemptionAllowance,
      stateTaxableIncome,
    },
    stateTaxBeforeCredits,
    familySizeForCredit,
    taxExemptInterestForFamilyCredit,
    modifiedFederalAGIForFamilyCredit,
    familyTaxCreditPercentage,
    familyTaxCredit,
    childDependentCareCredit,
    nonrefundableCredits,
    incomeTaxDue,
    useTax,
    stateTax,
    stateWithheld,
    estimatedAndExtensionPayments,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function getVirginia2025StandardDeduction(filingStatus) {
  return filingStatus === "mfj" ? 17500 : 8750;
}

function computeVirginia2025RateScheduleTax(taxableIncome) {
  const taxable = Math.max(0, dollars(taxableIncome));
  if (taxable <= 3000) return dollars(taxable * 0.02);
  if (taxable <= 5000) return dollars(60 + ((taxable - 3000) * 0.03));
  if (taxable <= 17000) return dollars(120 + ((taxable - 5000) * 0.05));
  return dollars(720 + ((taxable - 17000) * 0.0575));
}

function computeVirginia2025Tax(input, federalAGI) {
  const filingStatus = String(input?.filingStatus || "single").toLowerCase();
  const federalAdjustedGrossIncome = Math.max(0, dollars(federalAGI || 0));
  const totalAdditions = Math.max(0, dollars(input?.vaTotalAdditions || 0));
  const ageDeduction = Math.max(0, dollars(input?.vaAgeDeduction || 0));
  const socialSecuritySubtraction = Math.max(0, dollars(input?.vaTaxableSocialSecurityTier1 || 0));
  const stateIncomeTaxRefundSubtraction = Math.max(0, dollars(input?.vaStateIncomeTaxRefund || 0));
  const otherSubtractions = Math.max(0, dollars(input?.vaOtherSubtractions || 0));
  const totalSubtractions = dollars(ageDeduction + socialSecuritySubtraction + stateIncomeTaxRefundSubtraction + otherSubtractions);
  const virginiaAdjustedGrossIncome = Math.max(0, dollars(federalAdjustedGrossIncome + totalAdditions - totalSubtractions));

  const federalItemized = input?.vaFederalItemized === true;
  let deduction = federalItemized
    ? Math.max(0, dollars(input?.vaItemizedDeductions || 0))
    : getVirginia2025StandardDeduction(filingStatus);
  if (!federalItemized && input?.canBeClaimedAsDependent === true) {
    deduction = Math.min(deduction, Math.max(0, dollars(input?.vaDependentEarnedIncome || 0)));
  }

  const dependentCount = Math.max(0, Math.trunc(Number(input?.numberOfDependents || 0)));
  const personalExemptionCount = 1 + (filingStatus === "mfj" ? 1 : 0) + dependentCount;
  const age65OrOlderCount = Math.max(0, Math.trunc(Number(input?.vaAge65OrOlderCount || 0)));
  const blindCount = Math.max(0, Math.trunc(Number(input?.vaBlindCount || 0)));
  const personalExemptions = dollars(personalExemptionCount * 930);
  const additionalExemptions = dollars((age65OrOlderCount + blindCount) * 800);
  const exemptions = dollars(personalExemptions + additionalExemptions);
  const otherDeductions = Math.max(0, dollars(input?.vaOtherDeductions || 0));
  const virginiaTaxableIncome = Math.max(0, dollars(virginiaAdjustedGrossIncome - deduction - exemptions - otherDeductions));

  const zeroTaxVagiThreshold = filingStatus === "mfj" ? 23900 : 11950;
  const stateTaxBeforeAdjustment = virginiaAdjustedGrossIncome < zeroTaxVagiThreshold
    ? 0
    : computeVirginia2025RateScheduleTax(virginiaTaxableIncome);

  const spouseTaxAdjustment = filingStatus === "mfj"
    ? Math.min(259, Math.max(0, dollars(input?.vaSpouseTaxAdjustment || 0)), stateTaxBeforeAdjustment)
    : 0;
  const netIncomeTax = Math.max(0, dollars(stateTaxBeforeAdjustment - spouseTaxAdjustment));

  const creditType = String(input?.vaIncomeBasedCreditType || "none");
  const requestedIncomeBasedCredit = Math.max(0, dollars(input?.vaIncomeBasedCreditAmount || 0));
  const incomeBasedCredit = creditType === "refundable_eitc"
    ? requestedIncomeBasedCredit
    : Math.min(netIncomeTax, requestedIncomeBasedCredit);

  const stateWithheld = Math.max(0, dollars(input?.stateWithheld || 0));
  const otherWithholding = Math.max(0, dollars(input?.vaOtherWithholding || 0));
  const estimatedTaxPayments = Math.max(0, dollars(input?.vaEstimatedTaxPayments || 0));
  const priorYearOverpaymentApplied = Math.max(0, dollars(input?.vaPriorYearOverpaymentApplied || 0));
  const extensionPayment = Math.max(0, dollars(input?.vaExtensionPayment || 0));
  const totalStatePayments = dollars(
    stateWithheld + otherWithholding + estimatedTaxPayments +
    priorYearOverpaymentApplied + extensionPayment + incomeBasedCredit
  );

  const useTax = input?.vaHasUseTax === true ? Math.max(0, dollars(input?.vaUseTax || 0)) : 0;
  const stateTax = dollars(netIncomeTax + useTax);
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalAdjustedGrossIncome,
      totalAdditions,
      ageDeduction,
      socialSecuritySubtraction,
      stateIncomeTaxRefundSubtraction,
      otherSubtractions,
      totalSubtractions,
      virginiaAdjustedGrossIncome,
      deduction,
      personalExemptionCount,
      age65OrOlderCount,
      blindCount,
      personalExemptions,
      additionalExemptions,
      exemptions,
      otherDeductions,
      stateTaxableIncome: virginiaTaxableIncome,
    },
    zeroTaxVagiThreshold,
    stateTaxBeforeCredits: stateTaxBeforeAdjustment,
    spouseTaxAdjustment,
    netIncomeTax,
    incomeBasedCreditType: creditType,
    incomeBasedCredit,
    useTax,
    stateTax,
    stateWithheld,
    otherWithholding,
    estimatedTaxPayments,
    priorYearOverpaymentApplied,
    extensionPayment,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function computeSouthCarolina2025FormulaTax(taxableIncome) {
  const taxable = Math.max(0, Number(taxableIncome || 0));
  if (taxable < 3560) return 0;
  if (taxable < 17830) {
    return Math.max(0, (taxable * 0.03) - 107);
  }
  return Math.max(0, (taxable * 0.06) - 642);
}

function computeSouthCarolina2025TaxTable(taxableIncome) {
  const taxable = Math.max(0, dollars(taxableIncome));
  if (taxable <= 0) return 0;

  // SC1040TT uses $50 bands below $7,000 and $100 bands from $7,000
  // through $99,999. Published table amounts are reproduced at each
  // band's midpoint. Income of $100,000 or more uses the rate schedule.
  if (taxable < 100000) {
    const width = taxable < 7000 ? 50 : 100;
    const midpoint = (Math.floor(taxable / width) * width) + (width / 2);
    return dollars(computeSouthCarolina2025FormulaTax(midpoint));
  }

  return dollars((taxable * 0.06) - 642);
}

function computeSouthCarolina2025Tax(input, federalSummary = {}) {
  const federalTaxableIncome = Math.max(
    0,
    dollars(federalSummary?.taxableIncome || 0)
  );
  const totalAdditions = Math.max(0, dollars(input?.scTotalAdditions || 0));
  const otherSubtractions = Math.max(0, dollars(input?.scOtherSubtractions || 0));
  const dependentsUnder6 = Math.max(
    0,
    Math.trunc(Number(input?.scDependentsUnder6 || 0))
  );
  const totalDependents = Math.max(
    0,
    Math.trunc(Number(input?.numberOfDependents || 0))
  );
  const under6Deduction = dollars(dependentsUnder6 * 4930);
  const dependentExemption = dollars(totalDependents * 4930);
  const totalSubtractions = dollars(
    otherSubtractions + under6Deduction + dependentExemption
  );
  const stateTaxableIncome = Math.max(
    0,
    dollars(federalTaxableIncome + totalAdditions - totalSubtractions)
  );
  const stateTaxBeforeCredits = computeSouthCarolina2025TaxTable(
    stateTaxableIncome
  );

  let childDependentCareCredit = 0;
  if (input?.scHasChildDependentCareCredit === true) {
    const expense = Math.max(0, dollars(input?.scFederalChildCareExpense || 0));
    const qualifyingPersons = Math.max(
      0,
      Math.trunc(Number(input?.scChildCareQualifyingPersons || 0))
    );
    const cap = qualifyingPersons >= 2 ? 420 : 210;
    childDependentCareCredit = dollars(Math.min(cap, expense * 0.07));
  }

  let twoWageEarnerCredit = 0;
  if (input?.scHasTwoWageEarnerCredit === true) {
    const taxpayerQualified = Math.max(
      0,
      dollars(input?.scTaxpayerQualifiedEarnedIncome || 0)
    );
    const spouseQualified = Math.max(
      0,
      dollars(input?.scSpouseQualifiedEarnedIncome || 0)
    );
    const lowerQualified = Math.min(
      50000,
      taxpayerQualified,
      spouseQualified
    );
    twoWageEarnerCredit = dollars(Math.min(350, lowerQualified * 0.007));
  }

  let southCarolinaEIC = 0;
  if (input?.scClaimedFederalEIC === true) {
    southCarolinaEIC = dollars(
      Math.max(0, Number(input?.scFederalEICAmount || 0)) * 1.25
    );
  }

  const totalNonrefundableCredits = dollars(
    childDependentCareCredit + twoWageEarnerCredit + southCarolinaEIC
  );
  const incomeTaxAfterCredits = dollars(
    Math.max(0, stateTaxBeforeCredits - totalNonrefundableCredits)
  );
  const useTax = input?.scHasUseTax === true
    ? Math.max(0, dollars(input?.scUseTax || 0))
    : 0;
  const stateTax = dollars(incomeTaxAfterCredits + useTax);

  const stateWithheld = dollars(input?.stateWithheld || 0);
  const otherWithholding = dollars(input?.scOtherWithholding || 0);
  const estimatedTaxPayments = dollars(input?.scEstimatedTaxPayments || 0);
  const extensionPayment = dollars(input?.scExtensionPayment || 0);
  const totalStatePayments = dollars(
    stateWithheld + otherWithholding + estimatedTaxPayments + extensionPayment
  );
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      federalTaxableIncome,
      totalAdditions,
      otherSubtractions,
      dependentsUnder6,
      totalDependents,
      under6Deduction,
      dependentExemption,
      totalSubtractions,
      stateTaxableIncome,
    },
    stateTaxBeforeCredits,
    childDependentCareCredit,
    twoWageEarnerCredit,
    southCarolinaEIC,
    totalNonrefundableCredits,
    incomeTaxAfterCredits,
    useTax,
    stateTax,
    stateWithheld,
    otherWithholding,
    estimatedTaxPayments,
    extensionPayment,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

function getOklahoma2025TaxColumn(filingStatus) {
  return (filingStatus === "mfj" || filingStatus === "hoh" || filingStatus === "qw")
    ? "joint"
    : "single";
}

function computeOklahoma2025FormulaTax(taxableIncome, filingStatus) {
  const taxable = Math.max(0, Number(taxableIncome || 0));
  const joint = getOklahoma2025TaxColumn(filingStatus) === "joint";

  const brackets = joint
    ? [
        { min: 0, max: 2000, rate: 0.0025 },
        { min: 2000, max: 5000, rate: 0.0075 },
        { min: 5000, max: 7500, rate: 0.0175 },
        { min: 7500, max: 9800, rate: 0.0275 },
        { min: 9800, max: 14400, rate: 0.0375 },
        { min: 14400, max: null, rate: 0.0475 },
      ]
    : [
        { min: 0, max: 1000, rate: 0.0025 },
        { min: 1000, max: 2500, rate: 0.0075 },
        { min: 2500, max: 3750, rate: 0.0175 },
        { min: 3750, max: 4900, rate: 0.0275 },
        { min: 4900, max: 7200, rate: 0.0375 },
        { min: 7200, max: null, rate: 0.0475 },
      ];

  let tax = 0;
  for (const bracket of brackets) {
    if (taxable <= bracket.min) break;
    const ceiling = bracket.max === null ? taxable : Math.min(taxable, bracket.max);
    tax += Math.max(0, ceiling - bracket.min) * bracket.rate;
    if (bracket.max === null || taxable <= bracket.max) break;
  }
  return tax;
}

function computeOklahoma2025TaxTable(taxableIncome, filingStatus) {
  const taxable = Math.max(0, dollars(taxableIncome));
  if (taxable <= 0) return 0;

  // The official Form 511 table applies to taxable income below $100,000.
  // Each published line is a $50 band. The table amount is reproduced by
  // computing tax at the midpoint of that band and rounding to whole dollars.
  if (taxable < 100000) {
    const midpoint = (Math.floor(taxable / 50) * 50) + 25;
    return dollars(computeOklahoma2025FormulaTax(midpoint, filingStatus));
  }

  // The 2025 packet publishes the exact $100,000-and-over worksheets:
  // Single/MFS: $4,562 + 4.75% over $100,000.
  // MFJ/HOH/QW: $4,373 + 4.75% over $100,000.
  const base = getOklahoma2025TaxColumn(filingStatus) === "joint" ? 4373 : 4562;
  return dollars(base + ((taxable - 100000) * 0.0475));
}

function computeOklahoma2025CreditRatio(oklahomaAGI, federalAGI) {
  const fed = Number(federalAGI || 0);
  if (fed <= 0) return null;
  return Math.min(1, Math.max(0, Number(oklahomaAGI || 0) / fed));
}

function computeOklahoma2025Tax(input, federalAGI) {
  const oklahomaAGI = Math.max(0, dollars(input?.okOklahomaAGI || 0));
  const incomeAfterAdjustments = Math.max(
    0,
    dollars(input?.okOklahomaIncomeAfterAdjustments || 0)
  );

  const standardDeduction = getOklahoma2025StandardDeduction(input.filingStatus);
  const itemizedDeduction = Math.max(0, dollars(input?.okItemizedDeductions || 0));
  const deductionUsed = input?.okFederalItemized === true
    ? itemizedDeduction
    : standardDeduction;

  const regularExemptions = Math.max(
    0,
    Math.trunc(Number(input?.okRegularExemptions || 0))
  );
  const special65Exemptions = Math.max(
    0,
    Math.trunc(Number(input?.okSpecial65Exemptions || 0))
  );
  const blindExemptions = Math.max(
    0,
    Math.trunc(Number(input?.okBlindExemptions || 0))
  );
  const qualifyingDependents = Math.max(
    0,
    Math.trunc(Number(input?.okQualifyingDependents || 0))
  );
  const exemptionCount =
    regularExemptions + special65Exemptions + blindExemptions + qualifyingDependents;
  const exemptionAmount = dollars(exemptionCount * 1000);

  const totalDeductionsAndExemptions = dollars(deductionUsed + exemptionAmount);
  const stateTaxableIncome = Math.max(
    0,
    dollars(incomeAfterAdjustments - totalDeductionsAndExemptions)
  );
  const stateTaxBeforeCredits = computeOklahoma2025TaxTable(
    stateTaxableIncome,
    input.filingStatus
  );

  const ratio = computeOklahoma2025CreditRatio(oklahomaAGI, federalAGI);

  let childCareChildTaxCredit = 0;
  if (
    input?.okHasFederalChildOrCareCredit === true &&
    Number(federalAGI || 0) <= 100000 &&
    ratio !== null
  ) {
    const childCareTwentyPercent = dollars(
      Math.max(0, Number(input?.okFederalChildCareCredit || 0)) * 0.20
    );
    const childTaxFivePercent = dollars(
      Math.max(0, Number(input?.okFederalChildTaxCreditTotal || 0)) * 0.05
    );
    const largerFederalBasedCredit = Math.max(
      childCareTwentyPercent,
      childTaxFivePercent
    );
    childCareChildTaxCredit = dollars(largerFederalBasedCredit * ratio);
  }

  const incomeTaxAfterNonrefundableCredits = dollars(
    Math.max(0, stateTaxBeforeCredits - childCareChildTaxCredit)
  );

  const useTax = Math.max(0, dollars(input?.okUseTax || 0));
  const totalTaxAndUseTax = dollars(incomeTaxAfterNonrefundableCredits + useTax);

  let oklahomaEIC = 0;
  if (
    input?.okHasOklahomaEIC === true &&
    ratio !== null
  ) {
    const federalEicUnder2020Law = Math.max(
      0,
      dollars(input?.okFederalEIC2020Law || 0)
    );
    oklahomaEIC = dollars(
      dollars(federalEicUnder2020Law * 0.05) * ratio
    );
  }

  const stateWithheld = dollars(input.stateWithheld || 0);
  const estimatedTaxPayments = dollars(input.okEstimatedTaxPayments || 0);
  const extensionPayment = dollars(input.okExtensionPayment || 0);
  const totalStatePayments = dollars(
    stateWithheld + estimatedTaxPayments + extensionPayment + oklahomaEIC
  );
  const net = dollars(totalStatePayments - totalTaxAndUseTax);

  return {
    incomeResult: {
      federalAGI: dollars(federalAGI),
      oklahomaAGI,
      incomeAfterAdjustments,
      standardDeduction,
      itemizedDeduction,
      deductionUsed,
      regularExemptions,
      special65Exemptions,
      blindExemptions,
      qualifyingDependents,
      exemptionCount,
      exemptionAmount,
      totalDeductionsAndExemptions,
      stateTaxableIncome,
      creditRatio: ratio,
    },
    stateTaxBeforeCredits,
    childCareChildTaxCredit,
    incomeTaxAfterNonrefundableCredits,
    useTax,
    stateTax: totalTaxAndUseTax,
    oklahomaEIC,
    stateWithheld,
    estimatedTaxPayments,
    extensionPayment,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// ARKANSAS 2025 — SPECIAL FULL-YEAR RESIDENT REGULAR-TABLE CALCULATOR
// =============================================================================

function getArkansas2025StandardDeduction(filingStatus) {
  return filingStatus === "mfj" ? 4940 : 2470;
}

function getArkansas2025LowIncomeUpperLimit(filingStatus, qualifyingDependents = 0) {
  const deps = Math.max(0, Math.trunc(Number(qualifyingDependents || 0)));
  if (filingStatus === "single") return 17500;
  if (filingStatus === "mfj") return deps >= 2 ? 36100 : 29000;
  if (filingStatus === "hoh" || filingStatus === "qw") {
    return deps >= 2 ? 29000 : 25300;
  }
  return null;
}

function getArkansas2025RateAndAdjustment(income) {
  const amount = Math.max(0, Number(income || 0));
  if (amount <= 5599) return { rate: 0, adjustment: 0 };
  if (amount <= 11199) return { rate: 0.02, adjustment: 111.98 };
  if (amount <= 15999) return { rate: 0.03, adjustment: 223.97 };
  if (amount <= 26399) return { rate: 0.034, adjustment: 287.97 };
  if (amount <= 94700) return { rate: 0.039, adjustment: 419.96 };

  if (amount <= 97800) {
    const bandIndex = Math.min(
      30,
      Math.max(0, Math.floor((amount - 94701) / 100))
    );
    return {
      rate: 0.039,
      adjustment: 399.30 - (bandIndex * 10),
    };
  }

  return { rate: 0.039, adjustment: 89.30 };
}

function computeArkansas2025RegularTableTax(taxableIncome) {
  const taxable = Math.max(0, dollars(taxableIncome));
  if (taxable <= 0) return 0;

  // The official 2025 table switches to the over-$100,000 formula.
  if (taxable >= 100001) {
    return dollars(
      3809 + ((taxable - 100000) * 0.039)
    );
  }

  // Arkansas says formula-generated results must match its table exactly and
  // that each table amount is computed at the midpoint of the published income
  // level. The revised 2025 table uses ordinary $100 bands through $74,999,
  // puts exactly $75,000 in the $74,900-to-less-than-$75,001 band, and then
  // publishes $100 bands beginning at $75,001.
  let midpoint;
  if (taxable < 75000) {
    midpoint = (Math.floor(taxable / 100) * 100) + 50;
  } else if (taxable === 75000) {
    midpoint = 74950;
  } else {
    const bandStart =
      75001 +
      (Math.floor((taxable - 75001) / 100) * 100);
    midpoint = bandStart + 50;
  }

  const { rate, adjustment } =
    getArkansas2025RateAndAdjustment(midpoint);

  return dollars(
    Math.max(0, (midpoint * rate) - adjustment)
  );
}

function computeArkansas2025Tax(input) {
  const totalIncome = Math.max(
    0,
    dollars(input?.arArkansasTotalIncome || 0)
  );
  const arkansasAGI = Math.max(
    0,
    dollars(input?.arArkansasAGI || 0)
  );
  const standardDeduction =
    getArkansas2025StandardDeduction(input.filingStatus);
  const itemizedDeduction = Math.max(
    0,
    dollars(input?.arItemizedDeductions || 0)
  );

  const mfsSpouseItemizes =
    input.filingStatus === "mfs" &&
    input?.arMfsSpouseItemizes === true;

  const deductionUsed = mfsSpouseItemizes
    ? itemizedDeduction
    : Math.max(standardDeduction, itemizedDeduction);

  const stateTaxableIncome = Math.max(
    0,
    dollars(arkansasAGI - deductionUsed)
  );

  const stateTaxBeforeCredits =
    computeArkansas2025RegularTableTax(stateTaxableIncome);

  const qualifyingDependents = Math.max(
    0,
    Math.trunc(Number(input?.arQualifyingDependents || 0))
  );
  const additionalPersonalCreditBoxes = Math.max(
    0,
    Math.trunc(Number(input?.arAdditionalPersonalCreditBoxes || 0))
  );

  const basePersonalCredits =
    input.filingStatus === "mfj" ? 58 : 29;
  const filingStatusCredit =
    input.filingStatus === "hoh" || input.filingStatus === "qw"
      ? 29
      : 0;
  const dependentCredits = qualifyingDependents * 29;
  const additionalPersonalCredits =
    additionalPersonalCreditBoxes * 29;
  const totalPersonalCredits = dollars(
    basePersonalCredits +
      filingStatusCredit +
      dependentCredits +
      additionalPersonalCredits
  );

  const stateTax = dollars(
    Math.max(0, stateTaxBeforeCredits - totalPersonalCredits)
  );
  const stateWithheld = dollars(input.stateWithheld || 0);
  const estimatedTaxPayments = dollars(
    input.arEstimatedTaxPayments || 0
  );
  const extensionPayment = dollars(
    input.arExtensionPayment || 0
  );
  const totalStatePayments = dollars(
    stateWithheld + estimatedTaxPayments + extensionPayment
  );
  const net = dollars(totalStatePayments - stateTax);

  return {
    incomeResult: {
      totalIncome,
      arkansasAGI,
      standardDeduction,
      itemizedDeduction,
      deductionUsed,
      stateTaxableIncome,
      qualifyingDependents,
      additionalPersonalCreditBoxes,
      basePersonalCredits,
      filingStatusCredit,
      dependentCredits,
      additionalPersonalCredits,
      totalPersonalCredits,
    },
    stateTaxBeforeCredits,
    totalPersonalCredits,
    stateTax,
    stateWithheld,
    estimatedTaxPayments,
    extensionPayment,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// LOUISIANA 2025 — SPECIAL FULL-YEAR RESIDENT PLANNING CALCULATOR
// =============================================================================

function getLouisiana2025StandardDeduction(filingStatus) {
  return (
    filingStatus === "single" ||
    filingStatus === "mfs"
  )
    ? 12500
    : 25000;
}

function getLouisiana2025MedicalThreshold(filingStatus) {
  if (filingStatus === "mfj" || filingStatus === "qw") {
    return 31500;
  }
  if (filingStatus === "hoh") {
    return 23625;
  }
  return 15750;
}

function computeLouisiana2025Tax(input, federalAGI) {
  const federalReturnRequired =
    input?.laFederalReturnRequired === true;

  const usesScheduleE =
    input?.laUsesScheduleE === true;

  const louisianaAGI = federalReturnRequired
    ? Math.max(
        0,
        dollars(
          usesScheduleE
            ? input?.laScheduleEAdjustedGrossIncome
            : federalAGI
        )
      )
    : 0;

  const standardDeduction =
    getLouisiana2025StandardDeduction(
      input.filingStatus
    );

  const federalItemized =
    input?.laFederalItemized === true;

  const federalMedicalDentalDeduction =
    federalItemized
      ? Math.max(
          0,
          Number(
            input?.laFederalMedicalDentalDeduction ||
            0
          )
        )
      : 0;

  const medicalThreshold =
    getLouisiana2025MedicalThreshold(
      input.filingStatus
    );

  const additionalMedicalDeduction =
    federalItemized
      ? Math.max(
          0,
          dollars(
            federalMedicalDentalDeduction -
            medicalThreshold
          )
        )
      : 0;

  const stateTaxableIncome =
    federalReturnRequired
      ? Math.max(
          0,
          dollars(
            louisianaAGI -
            standardDeduction -
            additionalMedicalDeduction
          )
        )
      : 0;

  const stateTaxBeforeCredits =
    federalReturnRequired
      ? dollars(stateTaxableIncome * 0.03)
      : 0;

  const federalEIC =
    input?.laClaimedFederalEIC === true
      ? Math.max(
          0,
          Number(input?.laFederalEICAmount || 0)
        )
      : 0;

  const louisianaEIC =
    input?.laClaimedFederalEIC === true
      ? dollars(federalEIC * 0.05)
      : 0;

  const stateTax = Math.max(
    0,
    dollars(
      stateTaxBeforeCredits -
      louisianaEIC
    )
  );

  const refundableCreditExcess = Math.max(
    0,
    dollars(
      louisianaEIC -
      stateTaxBeforeCredits
    )
  );

  const stateWithheld =
    dollars(input.stateWithheld || 0);
  const estimatedTaxPayments =
    dollars(input.laEstimatedTaxPayments || 0);
  const extensionPayment =
    dollars(input.laExtensionPayment || 0);

  const totalStatePayments = dollars(
    stateWithheld +
    estimatedTaxPayments +
    extensionPayment +
    refundableCreditExcess
  );

  const net = dollars(
    totalStatePayments -
    stateTax
  );

  return {
    incomeResult: {
      federalAGI: dollars(federalAGI),
      usesScheduleE,
      louisianaAGI,
      standardDeduction,
      federalItemized,
      federalMedicalDentalDeduction:
        dollars(federalMedicalDentalDeduction),
      medicalThreshold,
      additionalMedicalDeduction,
      stateTaxableIncome,
    },
    stateTaxBeforeCredits,
    louisianaEIC,
    refundableCreditExcess,
    stateTax,
    stateWithheld,
    estimatedTaxPayments,
    extensionPayment,
    totalStatePayments,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// KENTUCKY 2025 — SPECIAL RESIDENT PLANNING CALCULATOR
// =============================================================================

const KY_2025_FAMILY_SIZE_TABLE = {
  1: [
    { max: 15650, rate: 1.00 },
    { max: 16276, rate: 0.90 },
    { max: 16902, rate: 0.80 },
    { max: 17528, rate: 0.70 },
    { max: 18154, rate: 0.60 },
    { max: 18780, rate: 0.50 },
    { max: 19406, rate: 0.40 },
    { max: 19876, rate: 0.30 },
    { max: 20345, rate: 0.20 },
    { max: 20815, rate: 0.10 },
    { max: Infinity, rate: 0.00 },
  ],
  2: [
    { max: 21150, rate: 1.00 },
    { max: 21996, rate: 0.90 },
    { max: 22842, rate: 0.80 },
    { max: 23688, rate: 0.70 },
    { max: 24534, rate: 0.60 },
    { max: 25380, rate: 0.50 },
    { max: 26226, rate: 0.40 },
    { max: 26861, rate: 0.30 },
    { max: 27495, rate: 0.20 },
    { max: 28130, rate: 0.10 },
    { max: Infinity, rate: 0.00 },
  ],
  3: [
    { max: 26650, rate: 1.00 },
    { max: 27716, rate: 0.90 },
    { max: 28782, rate: 0.80 },
    { max: 29848, rate: 0.70 },
    { max: 30914, rate: 0.60 },
    { max: 31980, rate: 0.50 },
    { max: 33046, rate: 0.40 },
    { max: 33846, rate: 0.30 },
    { max: 34645, rate: 0.20 },
    { max: 35445, rate: 0.10 },
    { max: Infinity, rate: 0.00 },
  ],
  4: [
    { max: 32150, rate: 1.00 },
    { max: 33436, rate: 0.90 },
    { max: 34722, rate: 0.80 },
    { max: 36008, rate: 0.70 },
    { max: 37294, rate: 0.60 },
    { max: 38580, rate: 0.50 },
    { max: 39866, rate: 0.40 },
    { max: 40831, rate: 0.30 },
    { max: 41795, rate: 0.20 },
    { max: 42760, rate: 0.10 },
    { max: Infinity, rate: 0.00 },
  ],
};

function getKentucky2025FamilySizeCreditRate(modifiedGrossIncome, familySize) {
  const size = Math.max(
    1,
    Math.min(4, Math.trunc(Number(familySize || 1)))
  );
  const income = Math.max(0, Number(modifiedGrossIncome || 0));
  const row =
    KY_2025_FAMILY_SIZE_TABLE[size].find(
      (entry) => income <= entry.max
    ) || { rate: 0 };

  return Number(row.rate || 0);
}

function computeKentucky2025Tax(input, federalAGI, federalSummary, stateCfg) {
  const taxpayerRetirement =
    Math.max(0, Number(input.kyTaxpayerRetirementIncome || 0));
  const spouseRetirement =
    input.filingStatus === "mfj"
      ? Math.max(0, Number(input.kySpouseRetirementIncome || 0))
      : 0;

  const retirementExclusion =
    Math.min(31110, taxpayerRetirement) +
    Math.min(31110, spouseRetirement);

  const kentuckyAGI =
    Math.max(0, Number(federalAGI || 0) - retirementExclusion);

  const standardDeduction = 3270;
  const itemizedDeduction =
    Math.max(0, Number(input.kyItemizedDeductions || 0));
  const deduction =
    Math.max(standardDeduction, itemizedDeduction);

  const stateTaxableIncome =
    Math.max(0, kentuckyAGI - deduction);

  const stateTaxBeforeCredits =
    dollars(stateTaxableIncome * Number(stateCfg.flatRate || 0.04));

  let personalCredit = 0;

  if (Number(input.age || 0) >= 65) {
    personalCredit += 40;
  }

  if (
    input.filingStatus === "mfj" &&
    Number(input.spouseAge || 0) >= 65
  ) {
    personalCredit += 40;
  }

  personalCredit += Math.max(
    0,
    Number(input.kyTaxpayerSpecialPersonalCredit || 0)
  );

  if (input.filingStatus === "mfj") {
    personalCredit += Math.max(
      0,
      Number(input.kySpouseSpecialPersonalCredit || 0)
    );
  }

  const allowedPersonalCredit =
    Math.min(stateTaxBeforeCredits, dollars(personalCredit));

  const taxAfterPersonalCredits =
    Math.max(0, stateTaxBeforeCredits - allowedPersonalCredit);

  const familySizeCreditRate =
    getKentucky2025FamilySizeCreditRate(
      federalAGI,
      input.kyFamilySize || 1
    );

  const familySizeCredit =
    dollars(taxAfterPersonalCredits * familySizeCreditRate);

  const taxAfterFamilySizeCredit =
    Math.max(
      0,
      taxAfterPersonalCredits - familySizeCredit
    );

  const federalEducationCredit =
    Math.max(
      0,
      Number(federalSummary?.educationCredit || 0)
    );

  const educationCredit =
    Math.min(
      taxAfterFamilySizeCredit,
      dollars(federalEducationCredit * 0.25)
    );

  const stateTax =
    Math.max(
      0,
      taxAfterFamilySizeCredit - educationCredit
    );

  const stateWithheld =
    dollars(input.stateWithheld || 0);
  const net =
    dollars(stateWithheld - stateTax);

  return {
    stateTaxBeforeCredits,
    dependentTaxCredit: 0,
    personalCredit: dollars(allowedPersonalCredit),
    familySizeCreditRate,
    familySizeCredit: dollars(familySizeCredit),
    educationCredit: dollars(educationCredit),
    stateTax,
    stateWithheld,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
    incomeResult: {
      federalAGI: dollars(federalAGI),
      retirementExclusion: dollars(retirementExclusion),
      kentuckyAGI: dollars(kentuckyAGI),
      standardDeduction: dollars(standardDeduction),
      itemizedDeduction: dollars(itemizedDeduction),
      stateDeduction: dollars(deduction),
      stateTaxableIncome: dollars(stateTaxableIncome),
    },
  };
}

// =============================================================================
// MISSISSIPPI 2025 — SPECIAL RESIDENT PLANNING CALCULATOR
// =============================================================================

function getMississippi2025FilingExemption(filingStatus) {
  const table = {
    single: 6000,
    mfj: 12000,
    mfs: 6000,
    hoh: 8000,
  };

  return Number(table[filingStatus] || 0);
}

function getMississippi2025StandardDeduction(filingStatus) {
  const table = {
    single: 2300,
    mfj: 4600,
    mfs: 2300,
    hoh: 3400,
  };

  return Number(table[filingStatus] || 0);
}

function computeMississippi2025Tax(input, federalAGI) {
  const filingStatus =
    input?.filingStatus || "single";

  const exemptRetirementIncome =
    Math.max(
      0,
      Number(input?.msExemptRetirementIncome || 0)
    );

  const mississippiAGI =
    Math.max(
      0,
      Number(federalAGI || 0) -
        exemptRetirementIncome
    );

  const standardDeduction =
    getMississippi2025StandardDeduction(
      filingStatus
    );

  const itemizedDeduction =
    Math.max(
      0,
      Number(input?.msItemizedDeductions || 0)
    );

  const deduction =
    Math.max(
      standardDeduction,
      itemizedDeduction
    );

  const filingExemption =
    getMississippi2025FilingExemption(
      filingStatus
    );

  const dependentExemption =
    Math.max(
      0,
      Math.trunc(
        Number(input?.numberOfDependents || 0)
      )
    ) * 1500;

  let ageBlindExemption = 0;

  if (Number(input?.age || 0) >= 65) {
    ageBlindExemption += 1500;
  }

  if (input?.msTaxpayerBlind === true) {
    ageBlindExemption += 1500;
  }

  if (filingStatus === "mfj") {
    if (Number(input?.spouseAge || 0) >= 65) {
      ageBlindExemption += 1500;
    }

    if (input?.msSpouseBlind === true) {
      ageBlindExemption += 1500;
    }
  }

  const totalExemptions =
    filingExemption +
    dependentExemption +
    ageBlindExemption;

  const totalReductions =
    deduction +
    totalExemptions;

  const stateTaxableIncome =
    Math.max(
      0,
      mississippiAGI -
        totalReductions
    );

  let taxableAboveZeroBand = 0;

  if (filingStatus === "mfj") {
    const spouseShare =
      Math.max(
        0,
        Math.min(
          mississippiAGI,
          Number(input?.msSpouseShareOfMississippiAGI || 0)
        )
      );

    const taxpayerShare =
      Math.max(
        0,
        mississippiAGI -
          spouseShare
      );

    const incomeAboveIndividualBands =
      Math.max(0, taxpayerShare - 10000) +
      Math.max(0, spouseShare - 10000);

    taxableAboveZeroBand =
      Math.max(
        0,
        incomeAboveIndividualBands -
          totalReductions
      );
  } else {
    taxableAboveZeroBand =
      Math.max(
        0,
        stateTaxableIncome -
          10000
      );
  }

  const stateTax =
    dollars(
      taxableAboveZeroBand * 0.044
    );

  const stateWithheld =
    dollars(input?.stateWithheld || 0);

  const net =
    dollars(
      stateWithheld -
        stateTax
    );

  return {
    stateTaxBeforeCredits: stateTax,
    stateTax,
    stateWithheld,
    net,
    isRefund: net > 0,
    isOwed: net < 0,
    refundAmount: net > 0 ? net : 0,
    owedAmount: net < 0 ? Math.abs(net) : 0,
    incomeResult: {
      federalAGI: dollars(federalAGI),
      exemptRetirementIncome:
        dollars(exemptRetirementIncome),
      mississippiAGI:
        dollars(mississippiAGI),
      standardDeduction:
        dollars(standardDeduction),
      itemizedDeduction:
        dollars(itemizedDeduction),
      stateDeduction:
        dollars(deduction),
      filingExemption:
        dollars(filingExemption),
      dependentExemption:
        dollars(dependentExemption),
      ageBlindExemption:
        dollars(ageBlindExemption),
      totalExemptions:
        dollars(totalExemptions),
      totalReductions:
        dollars(totalReductions),
      stateTaxableIncome:
        dollars(stateTaxableIncome),
      taxableAboveZeroBand:
        dollars(taxableAboveZeroBand),
      spouseShareOfMississippiAGI:
        filingStatus === "mfj"
          ? dollars(
              Math.max(
                0,
                Number(
                  input?.msSpouseShareOfMississippiAGI || 0
                )
              )
            )
          : 0,
    },
  };
}

// =============================================================================
// STEP 3A — NO INCOME TAX
// =============================================================================

function handleNoTax(input) {
  const stateWithheld = input.stateWithheld || 0;
  const net           = dollars(stateWithheld);

  return {
    stateTax:    0,
    stateWithheld: dollars(stateWithheld),
    net,
    isRefund:    net > 0,
    isOwed:      false,
    refundAmount: net > 0 ? net : 0,
    owedAmount:   0,
  };
}

// =============================================================================
// STEP 3B — FLAT TAX
//
// stateTax = stateTaxableIncome * flatRate
// =============================================================================

function handleFlatTax(stateTaxableIncome, flatRate, input) {
  const stateTaxBeforeCredits = dollars(stateTaxableIncome * flatRate);
  const dependentCreditResult = computeDependentTaxCredit(
    input,
    input.__stateCfgForCredit,
    input.__federalAGIForCredit,
    stateTaxBeforeCredits
  );
  const stateTax      = dependentCreditResult.taxAfterCredit;
  const stateWithheld = dollars(input.stateWithheld || 0);
  const net           = dollars(stateWithheld - stateTax);

  return {
    stateTaxBeforeCredits,
    dependentTaxCredit: dependentCreditResult.allowedCredit,
    dependentCreditResult,
    stateTax,
    stateWithheld,
    net,
    isRefund:    net > 0,
    isOwed:      net < 0,
    refundAmount: net > 0 ? net           : 0,
    owedAmount:   net < 0 ? Math.abs(net) : 0,
  };
}

// =============================================================================
// STEP 3C — GRADUATED TAX
//
// tax = 0
// for each bracket (ascending by min):
//   if taxableIncome <= bracket.min: stop
//   amountInBracket = min(taxableIncome, bracket.max ?? Infinity) - bracket.min
//   tax += amountInBracket * bracket.rate
// =============================================================================

function handleGraduatedTax(stateTaxableIncome, filingStatus, stateCfg, input) {
  const brackets = (stateCfg.brackets && stateCfg.brackets[filingStatus])
                || (stateCfg.brackets && stateCfg.brackets.single)
                || [];

  let tax = 0;
  const bracketDetail = [];

  for (const bracket of brackets) {
    if (stateTaxableIncome <= bracket.min) break;

    const ceiling   = bracket.max !== null ? bracket.max : Infinity;
    const inBracket = Math.min(stateTaxableIncome, ceiling) - bracket.min;
    const taxInBand = inBracket * bracket.rate;

    tax += taxInBand;
    bracketDetail.push({
      rate:             bracket.rate,
      min:              bracket.min,
      max:              bracket.max,
      taxableInBracket: dollars(inBracket),
      taxInBracket:     dollars(taxInBand),
    });
  }

  const stateTaxBeforeCredits = dollars(tax);
  const dependentCreditResult = computeDependentTaxCredit(
    input,
    input.__stateCfgForCredit,
    input.__federalAGIForCredit,
    stateTaxBeforeCredits
  );
  const stateTax      = dependentCreditResult.taxAfterCredit;
  const stateWithheld = dollars(input.stateWithheld || 0);
  const net           = dollars(stateWithheld - stateTax);

  return {
    stateTaxBeforeCredits,
    dependentTaxCredit: dependentCreditResult.allowedCredit,
    dependentCreditResult,
    stateTax,
    stateWithheld,
    net,
    isRefund:    net > 0,
    isOwed:      net < 0,
    refundAmount: net > 0 ? net           : 0,
    owedAmount:   net < 0 ? Math.abs(net) : 0,
    bracketDetail,
  };
}

// =============================================================================
// ORCHESTRATOR — calculateState()
// =============================================================================

/**
 * Calculate state tax estimate.
 *
 * @param  {object} input       Prepared input from prepareInput()
 * @param  {number} federalAGI  AGI from federal engine summary
 * @returns {{ summary: object, stateName: string, hasIncomeTax: boolean, canEstimate: boolean }}
 */
function calculateState(input, federalAGI, federalSummary = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("stateEngine.calculateState: input must be a non-null object.");
  }
  if (typeof federalAGI !== "number" || !isFinite(federalAGI)) {
    throw new Error("stateEngine.calculateState: federalAGI must be a finite number.");
  }

  const { stateCode, filingStatus, taxYear } = input;
  const stateCfg = loadStateConfig(stateCode, taxYear);
  const stateName = stateCfg.name || stateCode;

  // ── No income tax ──────────────────────────────────────────
  if (stateCfg.type === "none") {
    const result = handleNoTax(input);
    return {
      stateName,
      hasIncomeTax: false,
      canEstimate:  true,
      summary: {
        stateTaxableIncome: 0,
        stateTax:           0,
        stateWithheld:      result.stateWithheld,
        net:                result.net,
        isRefund:           result.isRefund,
        isOwed:             result.isOwed,
        refundAmount:       result.refundAmount,
        owedAmount:         result.owedAmount,
      },
      detail: { type: "none", stateCfg },
    };
  }

  // ── State not yet configured ───────────────────────────────
  if (stateCfg.type === "unknown") {
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate:  false,
      summary: {
        stateTaxableIncome: null,
        stateTax:           null,
        stateWithheld:      dollars(input.stateWithheld || 0),
        net:                null,
        isRefund:           false,
        isOwed:             false,
        refundAmount:       0,
        owedAmount:         0,
      },
      detail: { type: "unknown", stateCfg },
    };
  }

  // ── State-specific verified calculator ───────────────────────
  if (
    stateCfg.specialCalculator === "AL_2025"
  ) {
    const taxResult =
      computeAlabama2025Tax(
        input,
        federalAGI,
        federalSummary
      );

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome:
          taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits:
          taxResult.stateTaxBeforeCredits,
        dependentTaxCredit: 0,
        stateTax:
          taxResult.stateTax,
        stateWithheld:
          taxResult.stateWithheld,
        estimatedTaxPayments:
          taxResult.estimatedTaxPayments,
        totalStatePayments:
          taxResult.totalStatePayments,
        net:
          taxResult.net,
        isRefund:
          taxResult.isRefund,
        isOwed:
          taxResult.isOwed,
        refundAmount:
          taxResult.refundAmount,
        owedAmount:
          taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "AL_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "IN_2025"
  ) {
    const taxResult = computeIndiana2025Tax(input, federalAGI);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        countyTax: taxResult.countyTax,
        useTax: taxResult.useTax,
        stateTax: taxResult.stateTax,
        indianaEITC: taxResult.indianaEITC,
        stateWithheld: taxResult.stateWithheld,
        countyWithheld: taxResult.countyWithheld,
        estimatedAndExtensionPayments: taxResult.estimatedAndExtensionPayments,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        specialCalculator: "IN_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "MO_2025"
  ) {
    const taxResult = computeMissouri2025Tax(input, federalAGI);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        primaryTax: taxResult.primaryTax,
        spouseTax: taxResult.spouseTax,
        stateTax: taxResult.stateTax,
        missouriWorkingFamilyTaxCredit: taxResult.missouriWorkingFamilyTaxCredit,
        stateWithheld: taxResult.stateWithheld,
        estimatedTaxPayments: taxResult.estimatedTaxPayments,
        otherPayments: taxResult.otherPayments,
        extensionPayments: taxResult.extensionPayments,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "MO_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "IL_2025"
  ) {
    const taxResult = computeIllinois2025Tax(input, federalAGI);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        incomeTax: taxResult.incomeTax,
        investmentCreditRecapture: taxResult.investmentCreditRecapture,
        totalIncomeTax: taxResult.totalIncomeTax,
        totalNonrefundableCredits: taxResult.totalNonrefundableCredits,
        householdEmploymentTax: taxResult.householdEmploymentTax,
        useTax: taxResult.useTax,
        stateTax: taxResult.stateTax,
        illinoisEITC: taxResult.illinoisEITC,
        illinoisChildTaxCredit: taxResult.illinoisChildTaxCredit,
        stateWithheld: taxResult.stateWithheld,
        estimatedPayments: taxResult.estimatedPayments,
        passThroughWithholding: taxResult.passThroughWithholding,
        passThroughEntityTaxCredit: taxResult.passThroughEntityTaxCredit,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        specialCalculator: "IL_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "OH_2025"
  ) {
    const taxResult = computeOhio2025Tax(input, federalAGI);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.ohioIncomeTaxBase,
        taxableBusinessIncome: taxResult.incomeResult.taxableBusinessIncome,
        taxableNonbusinessIncome: taxResult.incomeResult.taxableNonbusinessIncome,
        nonbusinessIncomeTax: taxResult.nonbusinessIncomeTax,
        businessIncomeTax: taxResult.businessIncomeTax,
        incomeTaxBeforeCredits: taxResult.incomeTaxBeforeCredits,
        nonrefundableCredits: taxResult.nonrefundableCredits,
        interestPenalty: taxResult.interestPenalty,
        useTax: taxResult.useTax,
        ohioTaxLiability: taxResult.ohioTaxLiability,
        schoolDistrictTax: taxResult.schoolDistrictTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        estimatedAndOtherPayments: taxResult.estimatedAndOtherPayments,
        refundableCredits: taxResult.refundableCredits,
        schoolDistrictWithholding: taxResult.schoolDistrictWithholding,
        schoolDistrictPayments: taxResult.schoolDistrictPayments,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "OH_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "CO_2025"
  ) {
    const taxResult = computeColorado2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        incomeTax: taxResult.normalTax,
        alternativeMinimumTax: taxResult.alternativeMinimumTax,
        creditRecapture: taxResult.creditRecapture,
        creditRepayment: taxResult.creditRepayment,
        nonrefundableCredits: taxResult.nonrefundableCreditsUsed,
        coloradoEITC: taxResult.coloradoEITC,
        refundableCredits: taxResult.refundableCredits,
        taborRefund: taxResult.taborRefund,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        applyToNextYear: taxResult.applyToNextYear,
        voluntaryContributions: taxResult.voluntaryContributions,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        specialCalculator: "CO_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "UT_2025"
  ) {
    const taxResult = computeUtah2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.utahTaxableIncome,
        taxBeforeTaxpayerCredit: taxResult.taxBeforeTaxpayerCredit,
        taxpayerTaxCredit: taxResult.taxpayerTaxCredit,
        qualifiedExemptTaxpayer: taxResult.qualifiedExemptTaxpayer,
        utahIncomeTax: taxResult.utahIncomeTax,
        childTaxCredit: taxResult.childTaxCredit,
        utahEITC: taxResult.utahEITC,
        nonrefundableCredits: taxResult.apportionableNonrefundableCredits + taxResult.nonapportionableNonrefundableCredits,
        useTax: taxResult.useTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        refundSubtractions: taxResult.refundSubtractions,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        specialCalculator: "UT_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }


  if (
    stateCfg.specialCalculator === "ID_2025"
  ) {
    const taxResult = computeIdaho2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.idahoTaxableIncome,
        taxBeforeCredits: taxResult.taxBeforeCredits,
        childTaxCredit: taxResult.childTaxCredit,
        nonrefundableCredits: taxResult.totalNonrefundableCredits,
        incomeTaxLiability: taxResult.incomeTaxLiability,
        otherTaxes: taxResult.otherTaxes,
        stateTax: taxResult.totalTaxPlusDonations + taxResult.penaltyInterest - taxResult.priorYearNonrefundableCreditUsed,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalPaymentsAndCredits,
        refundApplyToNextYear: taxResult.refundApplyToNextYear,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        specialCalculator: "ID_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "MT_2025"
  ) {
    const taxResult = computeMontana2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.montanaTaxableIncome,
        ordinaryIncomeTax: taxResult.ordinaryIncomeTax,
        netLongTermCapitalGainsTax: taxResult.netLongTermCapitalGainsTax,
        taxBeforeCredits: taxResult.taxBeforeCredits,
        nonrefundableCredits: taxResult.otherNonrefundableCredits,
        montanaEITC: taxResult.montanaEITC,
        stateTax: taxResult.totalTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        refundApplyToNextYear: taxResult.refundApplyToNextYear,
        refund529Deposit: taxResult.refund529Deposit,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "MT_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "ND_2025"
  ) {
    const taxResult = computeNorthDakota2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.northDakotaTaxableIncome,
        incomeTaxBeforeCredits: taxResult.incomeTaxBeforeCredits,
        marriagePenaltyCredit: taxResult.marriagePenaltyCredit,
        nonrefundableCredits: taxResult.otherCreditsUsed,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        refundApplyToNextYear: taxResult.refundApplyToNextYear,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "ND_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "NM_2025"
  ) {
    const taxResult = computeNewMexico2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.newMexicoTaxableIncome,
        incomeTaxBeforeCredits: taxResult.newMexicoTax,
        nonrefundableCredits: taxResult.pitCrNonrefundableCreditsUsed,
        workingFamiliesTaxCredit: taxResult.workingFamiliesTaxCredit,
        refundableCredits: taxResult.pitRcTotalCredits + taxResult.pitCrRefundableCredits,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        applyToNextYear: taxResult.applyToNextYear,
        refundContributions: taxResult.refundContributions,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "NM_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "CA_2025"
  ) {
    const taxResult = computeCalifornia2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.californiaTaxableIncome,
        incomeTaxBeforeCredits: taxResult.regularTax,
        exemptionCredit: taxResult.exemptionCredit,
        nonrefundableCredits: taxResult.nonrefundableCreditsUsed,
        behavioralHealthServicesTax: taxResult.behavioralHealthServicesTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        useTax: taxResult.useTax,
        individualSharedResponsibilityPenalty: taxResult.individualSharedResponsibilityPenalty,
        applyToNextYear: taxResult.applyToNextYear,
        contributions: taxResult.contributions,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "CA_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "OR_2025"
  ) {
    const taxResult = computeOregon2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.oregonTaxableIncome,
        incomeTaxBeforeCredits: taxResult.regularTax,
        nonrefundableCredits: taxResult.nonrefundableCreditsUsed,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        kicker: taxResult.kicker,
        oregonEarnedIncomeCredit: taxResult.oregonEarnedIncomeCredit,
        oregonKidsCredit: taxResult.oregonKidsCredit,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.penaltyInterest,
        refundApplications: taxResult.refundApplications,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "OR_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "WA_2025"
  ) {
    const taxResult = computeWashington2025Tax(input);
    return {
      stateName,
      hasIncomeTax: false,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.taxableWashingtonCapitalGains,
        capitalGainsTaxBeforeCredits: taxResult.capitalGainsTaxBeforeCredits,
        nonrefundableCredits: taxResult.totalCreditsUsed,
        stateTax: taxResult.stateTax,
        stateWithheld: 0,
        totalStatePayments: taxResult.totalStatePayments,
        workingFamiliesTaxCredit: taxResult.workingFamiliesTaxCredit,
        penaltyInterest: taxResult.penaltyInterest,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: { type: "capital-gains-excise", specialCalculator: "WA_2025", taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "HI_2025"
  ) {
    const taxResult = computeHawaii2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.hawaiiTaxableIncome,
        incomeTaxBeforeCredits: taxResult.regularTax,
        nonrefundableCredits: taxResult.nonrefundableCreditsUsed,
        refundableCredits: taxResult.refundableEic + taxResult.otherRefundableCredits,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.penaltyInterest,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "HI_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "CT_2025"
  ) {
    const taxResult = computeConnecticut2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.connecticutTaxableIncome,
        incomeTaxBeforeCredits: taxResult.regularTax + taxResult.alternativeMinimumTax,
        nonrefundableCredits: taxResult.propertyTaxCredit + taxResult.allowableCreditsUsed,
        refundableCredits: taxResult.connecticutEitc + taxResult.otherRefundableCredits,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.penaltyInterest,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "CT_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "ME_2025"
  ) {
    const taxResult = computeMaine2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.maineTaxableIncome,
        incomeTaxBeforeCredits: taxResult.regularTax + taxResult.taxCreditRecapture,
        nonrefundableCredits: taxResult.nonrefundableCreditsUsed,
        refundableCredits: taxResult.refundableCredits + taxResult.propertyTaxFairnessCredit + taxResult.salesTaxFairnessCredit,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld + taxResult.otherMaineWithholding,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.underpaymentPenalty,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "ME_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "MA_2025"
  ) {
    const taxResult = computeMassachusetts2025Tax(input, federalSummary);
    return {
      stateName, hasIncomeTax: true, canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.surtaxBase,
        incomeTaxBeforeCredits: taxResult.line28,
        nonrefundableCredits: taxResult.limitedIncomeCredit + taxResult.otherNonrefundableCreditsUsed,
        refundableCredits: taxResult.refundableCredits,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld + taxResult.otherMassachusettsWithholding,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.penaltyInterest,
        net: taxResult.net, isRefund: taxResult.isRefund, isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount, owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "MA_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "NJ_2025"
  ) {
    const taxResult = computeNewJersey2025Tax(input, federalSummary);
    return {
      stateName, hasIncomeTax: true, canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.line42,
        incomeTaxBeforeCredits: taxResult.line43Tax,
        nonrefundableCredits: taxResult.otherNonrefundableCreditsUsed,
        refundableCredits: taxResult.refundableCredits,
        stateTax: taxResult.line54TotalTaxDue,
        stateWithheld: taxResult.withholdingTotal,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.underpaymentInterest,
        net: taxResult.net, isRefund: taxResult.isRefund, isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount, owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "NJ_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "NY_2025"
  ) {
    const taxResult = computeNewYork2025Tax(input, federalSummary);
    return {
      stateName, hasIncomeTax: true, canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.taxableIncome,
        incomeTaxBeforeCredits: taxResult.stateTaxBeforeCredits + taxResult.nycTaxBeforeCredits,
        nonrefundableCredits: taxResult.stateCreditsUsed + taxResult.nycNonrefundableUsed,
        refundableCredits: taxResult.refundableCredits,
        stateTax: taxResult.totalTax,
        stateWithheld: taxResult.withholdingTotal,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.penaltyInterest,
        net: taxResult.net, isRefund: taxResult.isRefund, isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount, owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "NY_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "RI_2025"
  ) {
    const taxResult = computeRhodeIsland2025Tax(input, federalSummary);
    return {
      stateName, hasIncomeTax: true, canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.taxableIncome,
        incomeTaxBeforeCredits: taxResult.incomeTax,
        nonrefundableCredits: taxResult.nonrefundableCreditsUsed,
        refundableCredits: taxResult.propertyTaxReliefCredit + taxResult.rhodeIslandEitc + taxResult.leadPaintCredit,
        stateTax: taxResult.totalTax,
        stateWithheld: taxResult.withholdingTotal,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.underpaymentInterest,
        net: taxResult.net, isRefund: taxResult.isRefund, isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount, owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "RI_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "VT_2025"
  ) {
    const taxResult = computeVermont2025Tax(input, federalSummary);
    return {
      stateName, hasIncomeTax: true, canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.taxableIncome,
        incomeTaxBeforeCredits: taxResult.incomeTax,
        nonrefundableCredits: taxResult.charitableContributionCredit + taxResult.nonrefundableCreditsUsed,
        refundableCredits: taxResult.refundableCredits,
        stateTax: taxResult.totalTax,
        stateWithheld: taxResult.withholdingTotal,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.underpaymentInterestPenalty,
        net: taxResult.net, isRefund: taxResult.isRefund, isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount, owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "VT_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "DC_2025"
  ) {
    const taxResult = computeDistrictOfColumbia2025Tax(input, federalSummary);
    return {
      stateName, hasIncomeTax: true, canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.taxableIncome,
        incomeTaxBeforeCredits: taxResult.incomeTax,
        nonrefundableCredits: taxResult.nonrefundableCreditsUsed,
        refundableCredits: taxResult.refundableCredits,
        stateTax: taxResult.totalTax,
        stateWithheld: taxResult.withholdingTotal,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.underpaymentInterest,
        net: taxResult.net, isRefund: taxResult.isRefund, isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount, owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "DC_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "MD_2025"
  ) {
    const taxResult = computeMaryland2025Tax(input, federalSummary);
    return {
      stateName, hasIncomeTax: true, canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.marylandTaxableIncome,
        incomeTaxBeforeCredits: taxResult.stateTaxBeforeCredits + taxResult.localTaxBeforeCredits,
        nonrefundableCredits: taxResult.stateEitcUsed + taxResult.statePovertyCreditUsed + taxResult.seniorCreditUsed + taxResult.otherNonrefundableCreditsUsed + taxResult.localEitcUsed + taxResult.localPovertyCreditUsed,
        refundableCredits: taxResult.refundableCredits,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld + taxResult.otherMarylandWithholding,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.underpaymentInterest + taxResult.homebuyerWithdrawalPenalty,
        net: taxResult.net, isRefund: taxResult.isRefund, isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount, owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "MD_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "DE_2025"
  ) {
    const taxResult = computeDelaware2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.delawareTaxableIncome,
        incomeTaxBeforeCredits: taxResult.regularTax,
        nonrefundableCredits: taxResult.nonrefundableCreditsUsed + taxResult.nonrefundableEitc,
        refundableCredits: taxResult.refundableEitc + taxResult.otherRefundableCredits,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        penaltyInterest: taxResult.penaltyInterest,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: { type: "graduated", specialCalculator: "DE_2025", incomeResult: taxResult.incomeResult, taxResult },
    };
  }

  if (
    stateCfg.specialCalculator === "KS_2025"
  ) {
    const taxResult = computeKansas2025Tax(input, federalAGI);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        incomeTax: taxResult.incomeTax,
        exemptionAllowance: taxResult.incomeResult.exemptionAllowance,
        childDependentCareCredit: taxResult.childDependentCareCredit,
        kansasEITC: taxResult.kansasEITC,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        creditForward: taxResult.creditForward,
        contributions: taxResult.contributions,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "KS_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "NE_2025"
  ) {
    const taxResult = computeNebraska2025Tax(input, federalAGI);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        incomeTax: taxResult.incomeTax,
        otherTax: taxResult.otherTax,
        personalExemptionCredit: taxResult.personalExemptionCredit,
        federalTaxLimitApplies: taxResult.federalTaxLimitApplies,
        neEarnedIncomeCredit: taxResult.neEarnedIncomeCredit,
        underpaymentPenalty: taxResult.underpaymentPenalty,
        useTax: taxResult.useTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        totalStatePayments: taxResult.totalStatePayments,
        applyToNextYear: taxResult.applyToNextYear,
        wildlifeDonation: taxResult.wildlifeDonation,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "NE_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "IA_2025"
  ) {
    const taxResult = computeIowa2025Tax(input, federalSummary);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.iowaTaxableIncome,
        adjustedIowaIncome: taxResult.incomeResult.adjustedIowaIncome,
        lowIncomeExempt: taxResult.incomeResult.lowIncomeExempt,
        regularTax: taxResult.regularTax,
        alternateTaxUsed: taxResult.alternateTaxUsed,
        singleTaxReductionUsed: taxResult.singleTaxReductionUsed,
        exemptionCredit: taxResult.exemptionCredit,
        schoolDistrictEmsSurtax: taxResult.schoolDistrictEmsSurtax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        estimatedAndOtherPayments: taxResult.estimatedAndOtherPayments,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        specialCalculator: "IA_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "MN_2025"
  ) {
    const taxResult = computeMinnesota2025Tax(input, federalAGI);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        standardOrItemizedDeduction: taxResult.incomeResult.deduction,
        dependentExemption: taxResult.incomeResult.dependentExemption,
        regularTax: taxResult.regularTax,
        alternativeMinimumTax: taxResult.alternativeMinimumTax,
        otherTaxes: taxResult.otherTaxes,
        nonrefundableCredits: taxResult.nonrefundableCredits,
        refundableCredits: taxResult.refundableCredits,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        estimatedPayments: taxResult.estimatedPayments,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "MN_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "WI_2025"
  ) {
    const taxResult = computeWisconsin2025Tax(input, federalAGI);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        wisconsinIncome: taxResult.incomeResult.wisconsinIncome,
        standardDeduction: taxResult.incomeResult.standardDeduction,
        exemptionAmount: taxResult.incomeResult.exemptionAmount,
        grossIncomeTax: taxResult.grossIncomeTax,
        nonrefundableCredits: taxResult.nonrefundableCredits,
        wisconsinEIC: taxResult.wisconsinEIC,
        otherRefundableCredits: taxResult.otherRefundableCredits,
        useTax: taxResult.useTax,
        donations: taxResult.donations,
        retirementAndOtherPenalties: taxResult.retirementAndOtherPenalties,
        underpaymentInterest: taxResult.underpaymentInterest,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        estimatedPayments: taxResult.estimatedPayments,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "WI_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "PA_2025"
  ) {
    const taxResult = computePennsylvania2025Tax(input);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.adjustedPATaxableIncome,
        totalPATaxableIncome: taxResult.incomeResult.totalPATaxableIncome,
        otherDeductions: taxResult.incomeResult.otherDeductions,
        paTaxLiability: taxResult.paTaxLiability,
        taxForgivenessCredit: taxResult.taxForgivenessCredit,
        taxForgivenessPercentage: taxResult.taxForgivenessPercentage,
        residentCredit: taxResult.residentCredit,
        childDependentCareCredit: taxResult.childDependentCareCredit,
        workingPennsylvaniansTaxCredit: taxResult.workingPennsylvaniansTaxCredit,
        useTax: taxResult.useTax,
        penaltiesInterest: taxResult.penaltiesInterest,
        localEarnedIncomeTax: taxResult.localEarnedIncomeTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        priorYearCredit: taxResult.priorYearCredit,
        estimatedPayments: taxResult.estimatedPayments,
        extensionPayment: taxResult.extensionPayment,
        nonresidentWithholding: taxResult.nonresidentWithholding,
        localEarnedIncomeWithholding: taxResult.localEarnedIncomeWithholding,
        localEarnedIncomePayments: taxResult.localEarnedIncomePayments,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        specialCalculator: "PA_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "MI_2025"
  ) {
    const taxResult = computeMichigan2025Tax(
      input,
      federalAGI,
      federalSummary
    );

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        michiganEITC: taxResult.michiganEITC,
        useTax: taxResult.useTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        estimatedAndExtensionPayments: taxResult.estimatedAndExtensionPayments,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        specialCalculator: "MI_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "WV_2025"
  ) {
    const taxResult = computeWestVirginia2025Tax(input, federalAGI);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        familyTaxCredit: taxResult.familyTaxCredit,
        childDependentCareCredit: taxResult.childDependentCareCredit,
        nonrefundableCredits: taxResult.nonrefundableCredits,
        incomeTaxDue: taxResult.incomeTaxDue,
        useTax: taxResult.useTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        estimatedAndExtensionPayments: taxResult.estimatedAndExtensionPayments,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "WV_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "VA_2025"
  ) {
    const taxResult = computeVirginia2025Tax(input, federalAGI);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        spouseTaxAdjustment: taxResult.spouseTaxAdjustment,
        incomeBasedCredit: taxResult.incomeBasedCredit,
        useTax: taxResult.useTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        otherWithholding: taxResult.otherWithholding,
        estimatedTaxPayments: taxResult.estimatedTaxPayments,
        priorYearOverpaymentApplied: taxResult.priorYearOverpaymentApplied,
        extensionPayment: taxResult.extensionPayment,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "VA_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "SC_2025"
  ) {
    const taxResult = computeSouthCarolina2025Tax(input, federalSummary);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        dependentTaxCredit: taxResult.totalNonrefundableCredits,
        childDependentCareCredit: taxResult.childDependentCareCredit,
        twoWageEarnerCredit: taxResult.twoWageEarnerCredit,
        southCarolinaEIC: taxResult.southCarolinaEIC,
        useTax: taxResult.useTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        otherWithholding: taxResult.otherWithholding,
        estimatedTaxPayments: taxResult.estimatedTaxPayments,
        extensionPayment: taxResult.extensionPayment,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "SC_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "OK_2025"
  ) {
    const taxResult = computeOklahoma2025Tax(input, federalAGI);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        dependentTaxCredit: taxResult.childCareChildTaxCredit,
        childCareChildTaxCredit: taxResult.childCareChildTaxCredit,
        oklahomaEIC: taxResult.oklahomaEIC,
        useTax: taxResult.useTax,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        estimatedTaxPayments: taxResult.estimatedTaxPayments,
        extensionPayment: taxResult.extensionPayment,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "OK_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "AR_2025"
  ) {
    const taxResult = computeArkansas2025Tax(input);

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome: taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        dependentTaxCredit: taxResult.totalPersonalCredits,
        stateTax: taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        estimatedTaxPayments: taxResult.estimatedTaxPayments,
        extensionPayment: taxResult.extensionPayment,
        totalStatePayments: taxResult.totalStatePayments,
        net: taxResult.net,
        isRefund: taxResult.isRefund,
        isOwed: taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount: taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "AR_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "LA_2025"
  ) {
    const taxResult =
      computeLouisiana2025Tax(
        input,
        federalAGI
      );

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome:
          taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits:
          taxResult.stateTaxBeforeCredits,
        dependentTaxCredit: 0,
        louisianaEIC:
          taxResult.louisianaEIC,
        refundableCreditExcess:
          taxResult.refundableCreditExcess,
        stateTax:
          taxResult.stateTax,
        stateWithheld:
          taxResult.stateWithheld,
        estimatedTaxPayments:
          taxResult.estimatedTaxPayments,
        extensionPayment:
          taxResult.extensionPayment,
        totalStatePayments:
          taxResult.totalStatePayments,
        net:
          taxResult.net,
        isRefund:
          taxResult.isRefund,
        isOwed:
          taxResult.isOwed,
        refundAmount:
          taxResult.refundAmount,
        owedAmount:
          taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        flatRate: 0.03,
        specialCalculator: "LA_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "KY_2025"
  ) {
    const taxResult =
      computeKentucky2025Tax(
        input,
        federalAGI,
        federalSummary,
        stateCfg
      );

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome:
          taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits:
          taxResult.stateTaxBeforeCredits,
        dependentTaxCredit: 0,
        personalCredit:
          taxResult.personalCredit,
        familySizeCredit:
          taxResult.familySizeCredit,
        familySizeCreditRate:
          taxResult.familySizeCreditRate,
        educationCredit:
          taxResult.educationCredit,
        stateTax:
          taxResult.stateTax,
        stateWithheld:
          taxResult.stateWithheld,
        net:
          taxResult.net,
        isRefund:
          taxResult.isRefund,
        isOwed:
          taxResult.isOwed,
        refundAmount:
          taxResult.refundAmount,
        owedAmount:
          taxResult.owedAmount,
      },
      detail: {
        type: "flat",
        flatRate: stateCfg.flatRate,
        specialCalculator: "KY_2025",
        incomeResult: taxResult.incomeResult,
        taxResult,
      },
    };
  }

  if (
    stateCfg.specialCalculator === "MS_2025"
  ) {
    const taxResult =
      computeMississippi2025Tax(
        input,
        federalAGI
      );

    return {
      stateName,
      hasIncomeTax: true,
      canEstimate: true,
      summary: {
        stateTaxableIncome:
          taxResult.incomeResult.stateTaxableIncome,
        stateTaxBeforeCredits:
          taxResult.stateTaxBeforeCredits,
        dependentTaxCredit: 0,
        stateTax:
          taxResult.stateTax,
        stateWithheld:
          taxResult.stateWithheld,
        net:
          taxResult.net,
        isRefund:
          taxResult.isRefund,
        isOwed:
          taxResult.isOwed,
        refundAmount:
          taxResult.refundAmount,
        owedAmount:
          taxResult.owedAmount,
      },
      detail: {
        type: "graduated",
        specialCalculator: "MS_2025",
        incomeResult:
          taxResult.incomeResult,
        taxResult,
      },
    };
  }

  // ── Compute taxable income (shared by flat and graduated) ──
  const incomeResult = computeStateTaxableIncome(federalAGI, input, stateCfg);
  const { stateTaxableIncome } = incomeResult;

  const calculationInput = {
    ...input,
    __stateCfgForCredit: stateCfg,
    __federalAGIForCredit: federalAGI,
  };

  let taxResult;

  // ── Flat tax ───────────────────────────────────────────────
  if (stateCfg.type === "flat") {
    taxResult = handleFlatTax(stateTaxableIncome, stateCfg.flatRate, calculationInput);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate:  true,
      summary: {
        stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        dependentTaxCredit: taxResult.dependentTaxCredit,
        stateTax:     taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        net:          taxResult.net,
        isRefund:     taxResult.isRefund,
        isOwed:       taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount:   taxResult.owedAmount,
      },
      detail: { type: "flat", flatRate: stateCfg.flatRate, incomeResult, taxResult },
    };
  }

  // ── Graduated tax ──────────────────────────────────────────
  if (stateCfg.type === "graduated") {
    taxResult = handleGraduatedTax(stateTaxableIncome, filingStatus, stateCfg, calculationInput);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate:  true,
      summary: {
        stateTaxableIncome,
        stateTaxBeforeCredits: taxResult.stateTaxBeforeCredits,
        dependentTaxCredit: taxResult.dependentTaxCredit,
        stateTax:     taxResult.stateTax,
        stateWithheld: taxResult.stateWithheld,
        net:          taxResult.net,
        isRefund:     taxResult.isRefund,
        isOwed:       taxResult.isOwed,
        refundAmount: taxResult.refundAmount,
        owedAmount:   taxResult.owedAmount,
      },
      detail: { type: "graduated", incomeResult, taxResult },
    };
  }

  // ── Fallback (should not be reached) ──────────────────────
  return {
    stateName,
    hasIncomeTax: true,
    canEstimate:  false,
    summary: {
      stateTaxableIncome: null,
      stateTax:           null,
      stateWithheld:      dollars(input.stateWithheld || 0),
      net:                null,
      isRefund:           false,
      isOwed:             false,
      refundAmount:       0,
      owedAmount:         0,
    },
    detail: { type: "unsupported", stateCfg },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  calculateState,
  getAlabama2025StandardDeduction,
  getAlabama2025PersonalExemption,
  getAlabama2025DependentExemptionPerPerson,
  computeAlabama2025TaxTable,
  computeAlabama2025Tax,
  computeIndiana2025Tax,
  computeIllinois2025ExemptionAllowance,
  computeIllinois2025Tax,
  getOhio2025ExemptionPerPerson,
  computeOhio2025NonbusinessTax,
  computeOhio2025Tax,
  computeColorado2025TaxTable,
  computeColorado2025Tax,
  getUtah2025TaxpayerCreditPhaseoutBase,
  getUtah2025ChildCreditThreshold,
  computeUtah2025Tax,
  getIdaho2025TaxThreshold,
  computeIdaho2025Tax,
  getMontana2025OrdinaryTaxParameters,
  computeMontana2025OrdinaryIncomeTax,
  computeMontana2025Tax,
  getNorthDakota2025RateParameters,
  computeNorthDakota2025RateScheduleTax,
  computeNorthDakota2025TaxTable,
  computeNorthDakota2025MarriagePenaltyCredit,
  computeNorthDakota2025Tax,
  normalizeNewMexico2025FilingStatus,
  computeNewMexico2025StatutoryTax,
  computeNewMexico2025TaxTable,
  getNewMexico2025ExemptionCount,
  getNewMexico2025CertainDependentDeduction,
  getNewMexico2025LowMiddleIncomeExemption,
  computeNewMexico2025Tax,
  normalizeCalifornia2025FilingStatus,
  computeCalifornia2025StatutoryTax,
  computeCalifornia2025TaxTable,
  getCalifornia2025ExemptionCredit,
  computeCalifornia2025Tax,
  normalizeOregon2025FilingStatus,
  getOregon2025FederalTaxSubtractionMaximum,
  computeOregon2025RateScheduleTax,
  computeOregon2025TaxTable,
  computeOregon2025Tax,
  computeWashington2025CapitalGainsTax,
  computeWashington2025Tax,
  normalizeHawaii2025FilingStatus,
  getHawaii2025StandardDeduction,
  computeHawaii2025RateScheduleTax,
  computeHawaii2025TaxTable,
  computeHawaii2025Tax,
  normalizeConnecticut2025FilingStatus,
  getConnecticut2025PersonalExemption,
  computeConnecticut2025InitialTax,
  getConnecticut2025PhaseOutAddBack,
  getConnecticut2025TaxRecapture,
  getConnecticut2025PersonalCreditRate,
  computeConnecticut2025Tax,
  normalizeMassachusetts2025FilingStatus,
  getMassachusetts2025PersonalExemption,
  computeMassachusetts2025TotalExemptions,
  computeMassachusetts2025FivePercentTax,
  getMassachusetts2025NoTaxStatusThreshold,
  getMassachusetts2025LimitedIncomeMaximum,
  computeMassachusetts2025LimitedIncomeCredit,
  computeMassachusetts2025Tax,
  normalizeNewJersey2025FilingStatus,
  computeNewJersey2025ExemptionAmount,
  computeNewJersey2025RateScheduleTax,
  computeNewJersey2025TaxTable,
  computeNewJersey2025ChildDependentCareCredit,
  getNewJersey2025ChildTaxCreditPerChild,
  computeNewJersey2025Tax,
  normalizeNewYork2025FilingStatus,
  getNewYork2025StandardDeduction,
  computeNewYork2025RateScheduleTax,
  computeNewYork2025TaxTable,
  computeNewYork2025HouseholdCredit,
  computeNewYorkCity2025RateScheduleTax,
  computeNewYorkCity2025TaxTable,
  computeNewYorkCity2025HouseholdCredit,
  computeNewYork2025EmpireStateChildCredit,
  computeNewYork2025Tax,
  normalizeRhodeIsland2025FilingStatus,
  getRhodeIsland2025BaseStandardDeduction,
  getRhodeIsland2025PhaseoutPercentage,
  getRhodeIsland2025StandardDeduction,
  getRhodeIsland2025ExemptionCount,
  getRhodeIsland2025ExemptionAmount,
  computeRhodeIsland2025RateScheduleTax,
  computeRhodeIsland2025TaxTable,
  computeRhodeIsland2025Tax,
  normalizeVermont2025FilingStatus,
  getVermont2025BaseStandardDeduction,
  getVermont2025StandardDeduction,
  getVermont2025ExemptionCount,
  computeVermont2025RateScheduleTax,
  computeVermont2025TaxTable,
  computeVermont2025ChildTaxCreditPerChild,
  computeVermont2025VeteranCredit,
  computeVermont2025Tax,
  normalizeDistrictOfColumbia2025FilingStatus,
  getDistrictOfColumbia2025BaseStandardDeduction,
  getDistrictOfColumbia2025StandardDeduction,
  computeDistrictOfColumbia2025ItemizedDeduction,
  computeDistrictOfColumbia2025RateScheduleTax,
  computeDistrictOfColumbia2025TaxTable,
  computeDistrictOfColumbia2025ChildlessEITC,
  computeDistrictOfColumbia2025Tax,
  normalizeMaryland2025FilingStatus,
  getMaryland2025StandardDeduction,
  getMaryland2025RegularExemptionPerPerson,
  computeMaryland2025ExemptionAmount,
  computeMaryland2025ItemizedDeduction,
  computeMaryland2025RateScheduleTax,
  computeMaryland2025TaxTable,
  getMaryland2025LocalBaseRate,
  computeMaryland2025AnneArundelTax,
  computeMaryland2025FrederickTax,
  computeMaryland2025LocalTax,
  computeMaryland2025SeniorCredit,
  computeMaryland2025ResidentChildTaxCredit,
  computeMaryland2025Tax,
  normalizeMaine2025FilingStatus,
  getMaine2025StandardDeduction,
  applyMaine2025DeductionPhaseout,
  getMaine2025PersonalExemptionCount,
  applyMaine2025PersonalExemptionPhaseout,
  computeMaine2025RateScheduleTax,
  computeMaine2025DependentExemptionCredit,
  computeMaine2025Tax,
  getDelaware2025StandardDeduction,
  computeDelaware2025RateScheduleTax,
  computeDelaware2025TaxTable,
  computeDelaware2025Tax,
  computeKansas2025RateScheduleTax,
  computeKansas2025TaxTable,
  getKansas2025ExemptionAllowance,
  computeKansas2025Tax,
  computeNebraska2025RateScheduleTax,
  getNebraska2025PersonalExemptionCount,
  computeNebraska2025Tax,
  getIowa2025ExemptionCredit,
  computeIowa2025Tax,
  getMinnesota2025PreliminaryStandardDeduction,
  getMinnesota2025StandardDeduction,
  getMinnesota2025DependentExemption,
  computeMinnesota2025RateScheduleTax,
  computeMinnesota2025TaxTable,
  computeMinnesota2025Tax,
  getWisconsin2025StandardDeductionTableAmount,
  getWisconsin2025StandardDeduction,
  computeWisconsin2025RateScheduleTax,
  computeWisconsin2025TaxTable,
  computeWisconsin2025Tax,
  getPennsylvania2025TaxForgivenessPercentage,
  computePennsylvania2025Tax,
  getMissouri2025StandardDeduction,
  computeMissouri2025TaxChart,
  computeMissouri2025Tax,
  computeMichigan2025Tax,
  computeWestVirginia2025RateScheduleTax,
  computeWestVirginia2025TaxTable,
  getWestVirginia2025FamilyTaxCreditPercentage,
  computeWestVirginia2025Tax,
  getVirginia2025StandardDeduction,
  computeVirginia2025RateScheduleTax,
  computeVirginia2025Tax,
  computeSouthCarolina2025FormulaTax,
  computeSouthCarolina2025TaxTable,
  computeSouthCarolina2025Tax,
  getOklahoma2025StandardDeduction,
  computeOklahoma2025FormulaTax,
  computeOklahoma2025TaxTable,
  computeOklahoma2025CreditRatio,
  computeOklahoma2025Tax,
  getArkansas2025StandardDeduction,
  getArkansas2025LowIncomeUpperLimit,
  computeArkansas2025RegularTableTax,
  computeArkansas2025Tax,
  getLouisiana2025StandardDeduction,
  getLouisiana2025MedicalThreshold,
  computeLouisiana2025Tax,
  getKentucky2025FamilySizeCreditRate,
  computeKentucky2025Tax,
  getMississippi2025FilingExemption,
  getMississippi2025StandardDeduction,
  computeMississippi2025Tax,
  computeStateChildDeduction,
  computeStateTaxableIncome,
  computeDependentTaxCredit,
  handleNoTax,
  handleFlatTax,
  handleGraduatedTax,
  getConfiguredStateYears,
  getStateSupport,
  getStateRules,
};
