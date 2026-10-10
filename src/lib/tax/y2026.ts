// Tax year 2026 figures. Every number here was checked against a published
// source (listed beside it) in October 2026. The estimator only runs for years
// that have a table like this one; it never extrapolates.

import type { FilingStatus } from '../types.js'

type Brackets = [upTo: number, rate: number][]

export const Y2026 = {
  year: 2026,
  sources: {
    brackets: 'IRS Rev. Proc. 2025-32 (via Tax Foundation, 2026 Tax Brackets)',
    payroll: 'SSA 2026 wage base; IRS 2026 retirement and HSA limits',
    mileage: 'IRS news release (Dec 29, 2025) and Announcement 2026-11',
    obbba: 'One Big Beautiful Bill Act (P.L. 119-21), Schedule 1-A',
    state: 'Tax Foundation, State Individual Income Tax Rates 2026',
  },
  // Taxable-income thresholds where each rate ends.
  brackets: {
    single: [[12_400, 0.1], [50_400, 0.12], [105_700, 0.22], [201_775, 0.24], [256_225, 0.32], [640_600, 0.35], [Infinity, 0.37]],
    married_joint: [[24_800, 0.1], [100_800, 0.12], [211_400, 0.22], [403_550, 0.24], [512_450, 0.32], [768_700, 0.35], [Infinity, 0.37]],
    married_separate: [[12_400, 0.1], [50_400, 0.12], [105_700, 0.22], [201_775, 0.24], [256_225, 0.32], [384_350, 0.35], [Infinity, 0.37]],
    head_of_household: [[17_700, 0.1], [67_450, 0.12], [105_700, 0.22], [201_775, 0.24], [256_200, 0.32], [640_600, 0.35], [Infinity, 0.37]],
  } satisfies Record<FilingStatus, Brackets>,
  standardDeduction: { single: 16_100, married_joint: 32_200, married_separate: 16_100, head_of_household: 24_150 } satisfies Record<FilingStatus, number>,
  additionalStd65: { single: 2_050, head_of_household: 2_050, married_joint: 1_650, married_separate: 1_650 } satisfies Record<FilingStatus, number>,
  seniorDeduction: { amount: 6_000, phaseStart: { single: 75_000, married_joint: 150_000, married_separate: 75_000, head_of_household: 75_000 }, phaseRate: 0.06 },
  tips: { cap: 25_000, phaseStart: { single: 150_000, married_joint: 300_000, married_separate: 150_000, head_of_household: 150_000 } },
  overtime: { cap: { single: 12_500, married_joint: 25_000, married_separate: 12_500, head_of_household: 12_500 }, phaseStart: { single: 150_000, married_joint: 300_000, married_separate: 150_000, head_of_household: 150_000 } },
  childTaxCredit: { perChild: 2_200, refundable: 1_700, phaseStart: { single: 200_000, married_joint: 400_000, married_separate: 200_000, head_of_household: 200_000 } },
  qbi: { rate: 0.2, threshold: { single: 201_775, married_joint: 403_500, married_separate: 201_775, head_of_household: 201_775 } },
  saltCap: { married_separate: 20_200, other: 40_400 },
  charityNonItemizer: { single: 1_000, married_joint: 2_000, married_separate: 1_000, head_of_household: 1_000 },
  charityItemizerFloorPct: 0.005,
  medicalFloorPct: 0.075,
  ssWageBase: 184_500,
  seRate: { ss: 0.124, medicare: 0.029, netFactor: 0.9235, additionalMedicare: 0.009 },
  additionalMedicareThreshold: { single: 200_000, married_joint: 250_000, married_separate: 125_000, head_of_household: 200_000 },
  mileage: { firstHalf: 0.725, secondHalf: 0.76 }, // per business mile; rate rose July 1, 2026
  limits: { deferral401k: 24_500, catchUp50: 8_000, definedContribution: 72_000, hsaSelf: 4_400, hsaFamily: 8_750, hsaCatchUp55: 1_000 },
  homeOfficeSimplified: { perSqFt: 5, maxSqFt: 300 },
  estimatedDue: ['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15'],
  safeHarborHighAgi: 150_000,
}

// Flat-rate states (one bracket in 2026) and how their taxable income starts.
// Local income taxes (Ohio and Pennsylvania cities, Indiana counties,
// Michigan cities) are not included. Progressive states are not estimated.
export type FlatState = { rate: number; base: 'agi' | 'fed_taxable'; deduction?: number; exemption?: number; exemptFirst?: number; note?: string }

export const flatStates2026: Record<string, FlatState> = {
  AZ: { rate: 0.025, base: 'agi', deduction: 8_350 },
  CO: { rate: 0.044, base: 'fed_taxable' },
  GA: { rate: 0.0519, base: 'agi', deduction: 12_000 },
  ID: { rate: 0.053, base: 'fed_taxable', exemptFirst: 4_811 },
  IL: { rate: 0.0495, base: 'agi', exemption: 2_925 },
  IN: { rate: 0.0295, base: 'agi', exemption: 1_000, note: 'County income tax not included.' },
  IA: { rate: 0.038, base: 'agi', deduction: 16_100 },
  KY: { rate: 0.035, base: 'agi', deduction: 3_360 },
  LA: { rate: 0.03, base: 'agi', deduction: 12_875 },
  MI: { rate: 0.0425, base: 'agi', exemption: 5_900, note: 'City income taxes not included.' },
  MS: { rate: 0.04, base: 'agi', deduction: 2_300, exemption: 6_000, exemptFirst: 10_000 },
  NC: { rate: 0.0399, base: 'agi', deduction: 12_750 },
  OH: { rate: 0.0275, base: 'agi', exemptFirst: 26_050, note: 'Exemptions vary with income; city taxes not included.' },
  PA: { rate: 0.0307, base: 'agi', note: 'Local earned income tax not included.' },
}

export const NO_WAGE_TAX = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']

export const taxTableFor = (year: number) => (year === 2026 ? Y2026 : null)
