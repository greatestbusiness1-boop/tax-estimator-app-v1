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
      deduction: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800, qw: 27700 },
      exemption: { single: 0, mfj: 0, mfs: 0, hoh: 0, qw: 0 },
      dependentExemption: 100,
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
// CONFIG ACCESSOR
// =============================================================================

function getStateRules(stateCode, taxYear) {
  const requestedYear = Number(taxYear);
  let yearRules = STATE_RULES[requestedYear];

  if (!yearRules) {
    const availableYears = Object.keys(STATE_RULES)
      .map(Number)
      .filter(y => !Number.isNaN(y))
      .sort((a, b) => b - a);

    const fallbackYear = availableYears.find(y => y <= requestedYear) || availableYears[0];
    yearRules = STATE_RULES[fallbackYear];
  }

  return yearRules?.[stateCode] || { name: stateCode, type: "unknown" };
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

function computeStateTaxableIncome(federalAGI, input, stateCfg) {
  const { filingStatus, numberOfDependents = 0 } = input;

  const deduction  = (stateCfg.deduction  && stateCfg.deduction[filingStatus])  || 0;
  const exemption  = (stateCfg.exemption  && stateCfg.exemption[filingStatus])  || 0;
  const depExempt  = (stateCfg.dependentExemption || 0) * numberOfDependents;

  const totalReductions = deduction + exemption + depExempt;
  const taxableIncome   = Math.max(0, federalAGI - totalReductions);

  return {
    federalAGI:       dollars(federalAGI),
    stateDeduction:   dollars(deduction),
    stateExemption:   dollars(exemption),
    dependentExempt:  dollars(depExempt),
    totalReductions:  dollars(totalReductions),
    stateTaxableIncome: dollars(taxableIncome),
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
  const stateTax      = dollars(stateTaxableIncome * flatRate);
  const stateWithheld = dollars(input.stateWithheld || 0);
  const net           = dollars(stateWithheld - stateTax);

  return {
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

  const stateTax      = dollars(tax);
  const stateWithheld = dollars(input.stateWithheld || 0);
  const net           = dollars(stateWithheld - stateTax);

  return {
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
function calculateState(input, federalAGI) {
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

  // ── Compute taxable income (shared by flat and graduated) ──
  const incomeResult = computeStateTaxableIncome(federalAGI, input, stateCfg);
  const { stateTaxableIncome } = incomeResult;

  let taxResult;

  // ── Flat tax ───────────────────────────────────────────────
  if (stateCfg.type === "flat") {
    taxResult = handleFlatTax(stateTaxableIncome, stateCfg.flatRate, input);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate:  true,
      summary: {
        stateTaxableIncome,
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
    taxResult = handleGraduatedTax(stateTaxableIncome, filingStatus, stateCfg, input);
    return {
      stateName,
      hasIncomeTax: true,
      canEstimate:  true,
      summary: {
        stateTaxableIncome,
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
  computeStateTaxableIncome,
  handleNoTax,
  handleFlatTax,
  handleGraduatedTax,
  getStateRules,
};
