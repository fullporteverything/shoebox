// Estimates a year's federal tax (and state tax for no-tax and flat-rate
// states) from what the person has uploaded and told us. It is an estimate:
// each simplification is listed in `assumptions` and shown in the UI.

import type { FilingStatus, IncomeEntry, Plan, Profile } from '../types.js'
import { NO_WAGE_TAX, flatStates2026, taxTableFor } from './y2026.js'

export type Inputs = {
  profile: Profile
  plan: Plan
  incomes: IncomeEntry[]
  businessExpenses: number // deductible business amount from receipts, before mileage/home office
  itemized: { propertyTax: number; mortgageInterest: number; charityCash: number; medical: number }
}

export type Estimate = {
  year: number
  wages: number
  seGross: number
  seNet: number
  investment: number
  seTax: number
  agi: number
  deductionKind: 'standard' | 'itemized'
  deduction: number
  charityNonItemizer: number
  qbi: number
  obbba: number // tips, overtime, senior
  taxable: number
  incomeTax: number
  credits: number
  federalTotal: number
  state: { kind: 'none' | 'flat' | 'not_estimated'; amount: number | null; rate?: number; note?: string }
  totalTax: number
  paid: number
  balance: number // positive = owe, negative = refund
  marginal: { federal: number; se: number; state: number }
  qbiApplies: boolean
  assumptions: string[]
  flags: string[]
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const r2 = (n: number) => Math.round(n * 100) / 100

export function bracketTax(taxable: number, status: FilingStatus, year = 2026) {
  const t = taxTableFor(year)!
  let tax = 0
  let lower = 0
  let rate = 0.1
  for (const [upTo, r] of t.brackets[status]) {
    if (taxable > lower) {
      tax += (Math.min(taxable, upTo) - lower) * r
      rate = r
    }
    lower = upTo
    if (taxable <= upTo) break
  }
  // With no taxable income, the next dollar of deduction saves nothing.
  return { tax, rate: taxable > 0 ? rate : 0 }
}

export function mileageDeduction(plan: Plan, year = 2026) {
  const t = taxTableFor(year)
  if (!t) return 0
  return (plan.milesFirstHalf ?? 0) * t.mileage.firstHalf + (plan.milesSecondHalf ?? 0) * t.mileage.secondHalf
}

export function homeOfficeDeduction(plan: Plan, year = 2026) {
  const t = taxTableFor(year)
  if (!t || !plan.homeOfficeSqFt) return 0
  return Math.min(plan.homeOfficeSqFt, t.homeOfficeSimplified.maxSqFt) * t.homeOfficeSimplified.perSqFt
}

export function estimate(inp: Inputs): Estimate | null {
  const { profile, plan, incomes } = inp
  const t = taxTableFor(profile.taxYear)
  if (!t) return null
  const fs = profile.filingStatus
  const assumptions: string[] = []
  const flags: string[] = []

  const wages = sum(incomes.filter((i) => i.type === 'wages').map((i) => i.amount))
  const seGross = sum(incomes.filter((i) => i.type === 'self_employment').map((i) => i.amount))
  const investment = sum(incomes.filter((i) => i.type === 'interest' || i.type === 'dividends' || i.type === 'other').map((i) => i.amount))
  const withheld = sum(incomes.map((i) => i.withheld))
  if (incomes.some((i) => i.type === 'dividends')) assumptions.push('Dividends are taxed at ordinary rates here; qualified dividends may be taxed less.')

  // Schedule C
  const selfEmployed = profile.workType !== 'w2'
  const bizExpenses = selfEmployed ? inp.businessExpenses + mileageDeduction(plan, t.year) + homeOfficeDeduction(plan, t.year) : 0
  const seNet = Math.max(0, seGross - bizExpenses)
  if (seGross > 0 && seGross < bizExpenses) flags.push('Business expenses are higher than business income, which makes a loss. Losses have extra rules (hobby, at-risk, excess business loss).')

  // Self-employment tax (Schedule SE)
  const seBase = seNet * t.seRate.netFactor
  let seTax = 0
  let halfSe = 0
  let addlMedicare = 0
  if (seBase >= 400) {
    const ss = t.seRate.ss * Math.min(seBase, Math.max(0, t.ssWageBase - wages))
    const med = t.seRate.medicare * seBase
    seTax = ss + med
    halfSe = seTax / 2
  }
  addlMedicare = t.seRate.additionalMedicare * Math.max(0, wages + seBase - t.additionalMedicareThreshold[fs])

  // Adjustments
  const seHealth = selfEmployed ? Math.min(plan.healthPremiums ?? 0, seNet) : 0
  const retirement = Math.max(0, plan.retirementContrib ?? 0)
  const hsaCap = plan.hdhp === 'family' ? t.limits.hsaFamily : plan.hdhp === 'self' ? t.limits.hsaSelf : 0
  const hsa = Math.min(plan.hsaContrib ?? 0, hsaCap)
  const agi = Math.max(0, wages + seNet + investment - halfSe - seHealth - retirement - hsa)

  // New 2025–2028 deductions (Schedule 1-A)
  let obbba = 0
  const phase = (amount: number, start: number) => Math.max(0, amount - Math.max(0, Math.ceil((agi - start) / 1000)) * 100)
  if (plan.tips) obbba += phase(Math.min(plan.tips, t.tips.cap), t.tips.phaseStart[fs])
  if (plan.overtime) obbba += phase(Math.min(plan.overtime, t.overtime.cap[fs]), t.overtime.phaseStart[fs])
  if (plan.age65) obbba += Math.max(0, t.seniorDeduction.amount - t.seniorDeduction.phaseRate * Math.max(0, agi - t.seniorDeduction.phaseStart[fs]))
  if (plan.tips || plan.overtime) assumptions.push('Tips and overtime deductions assume the amounts you entered qualify under the new rules.')

  // Standard vs itemized
  const std = t.standardDeduction[fs] + (plan.age65 ? t.additionalStd65[fs] : 0)
  const saltCap = fs === 'married_separate' ? t.saltCap.married_separate : t.saltCap.other
  if (agi > 505_000) flags.push('Your SALT cap phases down above $505,000 of income; the estimate uses the full cap.')
  const salt = Math.min(saltCap, inp.itemized.propertyTax)
  const charityItemized = Math.max(0, inp.itemized.charityCash - t.charityItemizerFloorPct * agi)
  const medical = Math.max(0, inp.itemized.medical - t.medicalFloorPct * agi)
  const itemizedTotal = salt + inp.itemized.mortgageInterest + charityItemized + medical
  const useItemized = itemizedTotal > std
  let deduction = useItemized ? itemizedTotal : std
  const charityNonItemizer = useItemized ? 0 : Math.min(inp.itemized.charityCash, t.charityNonItemizer[fs]) // 2026+ cash gifts for non-itemizers
  deduction += charityNonItemizer
  if (useItemized) assumptions.push('Itemized total uses the property tax, mortgage interest, charity and medical receipts in your vault; state income tax isn’t included in SALT.')

  // QBI (§199A)
  const preQbiTaxable = Math.max(0, agi - deduction - obbba)
  let qbi = 0
  const qbiBase = Math.max(0, seNet - halfSe - seHealth - retirement)
  if (qbiBase > 0) {
    if (preQbiTaxable <= t.qbi.threshold[fs]) qbi = Math.min(t.qbi.rate * qbiBase, t.qbi.rate * preQbiTaxable)
    else flags.push(`Above $${t.qbi.threshold[fs].toLocaleString()} of taxable income the QBI deduction depends on your business type and W-2 wages, so it isn’t included.`)
  }

  const taxable = Math.max(0, preQbiTaxable - qbi)
  const { tax: incomeTax, rate } = bracketTax(taxable, fs, t.year)

  // Child tax credit: the nonrefundable part offsets income tax; up to
  // $1,700 per child of the rest is refundable.
  let credits = 0
  let nonRef = 0
  let refundable = 0
  if (plan.dependents) {
    const full = t.childTaxCredit.perChild * plan.dependents
    const reduced = Math.max(0, full - Math.max(0, Math.ceil((agi - t.childTaxCredit.phaseStart[fs]) / 1000)) * 50)
    nonRef = Math.min(reduced, incomeTax)
    const earned = wages + seNet - halfSe
    refundable = Math.min(reduced - nonRef, t.childTaxCredit.refundable * plan.dependents, Math.max(0, 0.15 * (earned - 2_500)))
    credits = nonRef + refundable
  }

  // Refundable credit can push the total below zero (a refund beyond withholding).
  const federalTotal = incomeTax - nonRef + seTax + addlMedicare - refundable

  // State
  let state: Estimate['state'] = { kind: 'not_estimated', amount: null, note: 'Your state uses graduated brackets. We don’t estimate it rather than risk a wrong number.' }
  let stateRate = 0
  if (NO_WAGE_TAX.includes(profile.state)) state = { kind: 'none', amount: 0, note: profile.state === 'WA' ? 'Washington taxes some capital gains, not wages.' : 'No state tax on wages.' }
  const flat = flatStates2026[profile.state]
  if (flat) {
    let base = flat.base === 'fed_taxable' ? taxable : agi
    base = Math.max(0, base - (flat.deduction ?? 0) - (flat.exemption ?? 0) - (flat.exemptFirst ?? 0))
    stateRate = flat.rate
    state = { kind: 'flat', amount: r2(base * flat.rate), rate: flat.rate, note: `Flat ${(flat.rate * 100).toFixed(2)}% on state taxable income, using the state’s single-filer deduction and exemption. ${flat.note ?? ''}`.trim() }
  }

  const totalTax = federalTotal + (state.amount ?? 0)
  const paid = withheld + (plan.estimatedPaid ?? 0)
  assumptions.push('Federal withholding comes from the W-2s and 1099s in your vault and any you entered by hand.')

  return {
    year: t.year, wages, seGross, seNet, investment, seTax: r2(seTax + addlMedicare), agi: r2(agi),
    deductionKind: useItemized ? 'itemized' : 'standard', deduction: r2(deduction - charityNonItemizer), charityNonItemizer: r2(charityNonItemizer), qbi: r2(qbi), obbba: r2(obbba), taxable: r2(taxable),
    incomeTax: r2(incomeTax), credits: r2(credits), federalTotal: r2(federalTotal), state, totalTax: r2(totalTax), paid: r2(paid),
    balance: r2(federalTotal - paid + (state.amount ?? 0)),
    marginal: {
      federal: rate,
      se: seBase >= 400 ? t.seRate.netFactor * (seBase < Math.max(0, t.ssWageBase - wages) ? t.seRate.ss + t.seRate.medicare : t.seRate.medicare) : 0,
      state: stateRate,
    },
    qbiApplies: qbi > 0,
    assumptions,
    flags,
  }
}

// How much a deduction of `amount` would lower tax, at the current margins.
export function savingsFor(est: Estimate, amount: number, kind: 'business' | 'adjustment' | 'itemized') {
  // When QBI applies, a dollar of business deduction also trims the 20% QBI deduction, so 80% of it reaches the bracket.
  const fed = est.marginal.federal * (kind === 'business' && est.qbiApplies ? 0.8 : 1)
  const se = kind === 'business' ? est.marginal.se : 0
  if (kind === 'itemized' && est.deductionKind === 'standard') return 0
  return r2(amount * (fed + se + est.marginal.state))
}
