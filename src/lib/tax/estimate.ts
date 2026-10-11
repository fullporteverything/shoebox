// Estimates a year's federal tax (and state tax for no-tax and flat-rate
// states) from what the person has uploaded and told us. It is an estimate:
// each simplification is listed in `assumptions` and shown in the UI.
//
// Self-employment income and business receipts belong to the business. How
// they reach the owner's Form 1040 depends on how the business is taxed
// (entity.ts): on Schedule C, or as the owner's share on a K-1. When that
// share isn't known, the business is left out and flagged, not assumed.

import type { FilingStatus, IncomeEntry, Plan, Profile } from '../types.js'
import { NO_WAGE_TAX, flatStates2026, taxTableFor } from './y2026.js'
import { treatmentOf } from './entity.js'
import type { Treatment } from './entity.js'

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
  seGross: number // business income: 1099-NEC, 1099-K, invoices
  seNet: number // profit subject to self-employment tax: Schedule C, or a partner's share
  business: {
    treatment: Treatment
    net: number // what the business made: income minus expenses, before any owner salary
    share: number | null // the owner's share, 0..1; always 1 on Schedule C; null when not answered
    counted: boolean // false when the share (or an S corp salary) is missing, so the business is left out
    k1: number // owner's share of ordinary business income on a K-1 (partnership or S corp)
    salary: number // W-2 salary from the owner's S corp, counted as wages
    payrollTax: number // Social Security and Medicare on that salary, both halves, paid through payroll
  }
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

  // The business (entity.ts). Mileage and the simplified home office are
  // owner deductions on Schedule C (Pub 463, Pub 587). In a partnership or S
  // corp they're usually reimbursed by the business under an accountable plan
  // (Treas. Reg. §1.62-2), which we can't see, so they're left out there.
  const treatment = treatmentOf(plan.entity)
  const selfEmployed = profile.workType !== 'w2'
  const ownerItems = treatment === 'schedule_c' ? mileageDeduction(plan, t.year) + homeOfficeDeduction(plan, t.year) : 0
  const bizExpenses = selfEmployed ? inp.businessExpenses + ownerItems : 0
  const net = seGross - bizExpenses
  if (seGross > 0 && seGross < bizExpenses) flags.push('Business expenses are higher than business income, which makes a loss. Losses have extra rules (hobby, at-risk, excess business loss).')
  if (treatment !== 'schedule_c' && selfEmployed && (mileageDeduction(plan, t.year) > 0 || homeOfficeDeduction(plan, t.year) > 0)) {
    assumptions.push('Mileage and home office aren’t counted. In a partnership or S corp the business usually pays them back to you under an accountable plan and deducts them itself.')
  }

  const share = treatment === 'schedule_c' ? 1 : plan.ownershipPct == null ? null : Math.min(100, Math.max(0, plan.ownershipPct)) / 100
  const salary = treatment === 's_corp' ? plan.ownerSalary : 0
  const counted = share != null && salary != null
  let seNet = 0 // net profit subject to SE tax
  let k1 = 0 // K-1 ordinary business income
  let payrollTax = 0
  if (treatment === 'schedule_c') {
    // Sole proprietor or single-member LLC: Schedule C and Schedule SE.
    seNet = Math.max(0, net)
    if (plan.entity === '' && seGross > 0) assumptions.push('Business type isn’t answered yet, so business income is figured as a sole proprietor’s (Schedule C). An LLC with partners, or one that elected S-corp status, is taxed differently.')
  } else if (!counted) {
    if (seGross > 0 || bizExpenses > 0) {
      flags.push(treatment === 'partnership'
        ? 'Your share of the business’s profit isn’t counted yet. Enter your ownership share under Questions to include it.'
        : 'Your S corp income isn’t counted yet. Enter your ownership share and the salary the company pays you under Questions to include it.')
    }
  } else if (treatment === 'partnership') {
    // A partner's distributive share of ordinary business income is generally
    // net earnings from self-employment (IRC §1402(a); Schedule SE).
    k1 = Math.round(net * share! * 100) / 100
    if (k1 < 0) flags.push('Your share is a loss. A partnership loss passes to you only up to your basis and amount at risk (IRC §704(d), §465), so it isn’t counted.')
    k1 = Math.max(0, k1)
    seNet = k1
    assumptions.push(`Your share is ${Math.round(share! * 100)}% of what the business made, as ordinary business income subject to self-employment tax. Guaranteed payments and special allocations on your K-1 aren’t included. A limited partner’s share generally isn’t subject to self-employment tax (IRC §1402(a)(13)).`)
  } else {
    // S corp: the salary is W-2 wages. The company deducts it and its half of
    // Social Security and Medicare (Form 941). What's left passes through on
    // the K-1 with no self-employment tax (Rev. Rul. 59-221).
    payrollTax = t.seRate.ss * Math.min(salary!, t.ssWageBase) + t.seRate.medicare * salary!
    const profit = net - salary! - payrollTax / 2
    if (profit < 0) flags.push('After your salary and the company’s payroll tax, the S corp shows a loss. A loss passes to you only up to your basis (IRC §1366(d)), so it isn’t counted.')
    k1 = Math.max(0, Math.round(profit * share! * 100) / 100)
    assumptions.push(`Your S corp salary of $${Math.round(salary!).toLocaleString()} is counted as W-2 wages. Your ${Math.round(share! * 100)}% of the profit after salary and payroll tax is K-1 income, with no self-employment tax.`)
    assumptions.push('Payroll tax on your salary is paid through payroll during the year, not with your return. It’s in the total tax but not in what you owe at filing. Federal tax withheld from the salary isn’t known; add it as estimated tax paid if you have it.')
    if (share! < 1) assumptions.push('Salaries paid to other owners lower the company’s profit. Add them as business expenses or your share will be high.')
    if (wages > 0) flags.push('If one of your W-2s is from your own S corp, that salary is counted twice: once under Income and once as the salary you entered. Remove one.')
  }
  const allWages = wages + (salary ?? 0)

  // Self-employment tax (Schedule SE)
  const seBase = seNet * t.seRate.netFactor
  let seTax = 0
  let halfSe = 0
  let addlMedicare = 0
  if (seBase >= 400) {
    const ss = t.seRate.ss * Math.min(seBase, Math.max(0, t.ssWageBase - allWages))
    const med = t.seRate.medicare * seBase
    seTax = ss + med
    halfSe = seTax / 2
  }
  addlMedicare = t.seRate.additionalMedicare * Math.max(0, allWages + seBase - t.additionalMedicareThreshold[fs])

  // Adjustments. A 2% S corp shareholder's health insurance deduction is
  // limited to the wages from the S corp (Notice 2008-1).
  const businessIncome = treatment === 's_corp' ? k1 : seNet
  const seHealth = selfEmployed ? Math.min(plan.healthPremiums ?? 0, treatment === 's_corp' ? salary ?? 0 : seNet) : 0
  const retirement = Math.max(0, plan.retirementContrib ?? 0)
  const hsaCap = plan.hdhp === 'family' ? t.limits.hsaFamily : plan.hdhp === 'self' ? t.limits.hsaSelf : 0
  const hsa = Math.min(plan.hsaContrib ?? 0, hsaCap)
  const agi = Math.max(0, allWages + businessIncome + investment - halfSe - seHealth - retirement - hsa)

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
  const qbiBase = Math.max(0, businessIncome - halfSe - seHealth - retirement) // W-2 salary isn't QBI (§199A(c)(4))
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
    const earned = allWages + seNet - halfSe
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

  // Payroll tax on an S corp salary is a real cost, so it's in the total, but
  // it's paid through payroll, so it isn't part of the balance at filing.
  const totalTax = federalTotal + (state.amount ?? 0) + payrollTax
  const paid = withheld + (plan.estimatedPaid ?? 0)
  assumptions.push('Federal withholding comes from the W-2s and 1099s in your vault and any you entered by hand.')

  return {
    year: t.year, wages, seGross, seNet, investment,
    business: { treatment, net: r2(net), share, counted, k1: r2(k1), salary: salary ?? 0, payrollTax: r2(payrollTax) }, seTax: r2(seTax + addlMedicare), agi: r2(agi),
    deductionKind: useItemized ? 'itemized' : 'standard', deduction: r2(deduction - charityNonItemizer), charityNonItemizer: r2(charityNonItemizer), qbi: r2(qbi), obbba: r2(obbba), taxable: r2(taxable),
    incomeTax: r2(incomeTax), credits: r2(credits), federalTotal: r2(federalTotal), state, totalTax: r2(totalTax), paid: r2(paid),
    balance: r2(federalTotal - paid + (state.amount ?? 0)),
    marginal: {
      federal: rate,
      se: seBase >= 400 ? t.seRate.netFactor * (seBase < Math.max(0, t.ssWageBase - allWages) ? t.seRate.ss + t.seRate.medicare : t.seRate.medicare) : 0,
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
  // A business deduction reaches a partner or shareholder only through their share; none when the share isn't known.
  const share = kind !== 'business' ? 1 : est.business.counted ? est.business.share ?? 0 : 0
  return r2(amount * share * (fed + se + est.marginal.state))
}
