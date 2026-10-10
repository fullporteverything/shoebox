// The savings assistant. Every suggestion here is a rule with a citation and
// explicit conditions. A suggestion is "applies" only when the person's own
// data meets the conditions, "check" when an answer is missing (we ask rather
// than assume), and is hidden when it clearly doesn't apply. Dollar figures
// are shown only when they can be computed from the person's numbers.

import { categoryById } from './rules.js'
import { estimate, homeOfficeDeduction, mileageDeduction, savingsFor } from './estimate.js'
import type { Estimate } from './estimate.js'
import { taxTableFor } from './y2026.js'
import type { DayKind, IncomeEntry, IncomeType, Plan, Profile, Receipt, TripLog } from '../types.js'
import { emptyPlan } from '../types.js'

export const usdOf = (r: Receipt): number | null =>
  r.extraction.currency && r.extraction.currency !== 'USD' ? (r.usdAmount ?? r.extraction.usdTotal ?? null) : r.extraction.total

// ---------- income ----------

export function incomeTypeFor(formType: string | null): IncomeType {
  const f = (formType ?? '').toUpperCase()
  if (/W-?2\b/.test(f)) return 'wages'
  if (/1099-?INT/.test(f)) return 'interest'
  if (/1099-?DIV/.test(f)) return 'dividends'
  return 'self_employment'
}

export function incomesFrom(receipts: Receipt[], manual: IncomeEntry[], year: number): IncomeEntry[] {
  const fromDocs: IncomeEntry[] = receipts
    .filter((r) => r.classification.category === 'income_form')
    .map((r) => ({
      id: 'doc:' + r.id,
      date: r.extraction.date,
      source: r.extraction.merchant,
      type: incomeTypeFor(r.extraction.formType),
      amount: usdOf(r) ?? 0,
      withheld: r.extraction.tax ?? 0,
      fromReceipt: r.id,
    }))
  return [...fromDocs, ...manual].filter((i) => !i.date || i.date.startsWith(String(year)))
}

// ---------- trips (IRS Pub 463, ch. 1, "Travel Outside the United States") ----------

export type Trip = {
  key: string
  country: string
  cities: string[]
  start: string
  end: string
  receipts: Receipt[]
  totalDays: number // calendar days, start to end inclusive
  weekTestDays: number // Pub 463: don't count the departure day, count the return day
}

const day = (iso: string) => new Date(iso + 'T12:00:00Z').getTime()
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
export const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / 86_400_000)
const isUS = (c: string | null) => !c || /^(us|usa|united states( of america)?)$/i.test(c.trim())

export function detectTrips(receipts: Receipt[], logs: Record<string, TripLog>): Trip[] {
  const abroad = receipts.filter((r) => !isUS(r.extraction.country) && r.extraction.date).sort((a, b) => a.extraction.date.localeCompare(b.extraction.date))
  const groups: Receipt[][] = []
  for (const r of abroad) {
    const g = groups[groups.length - 1]
    if (g && g[0].extraction.country === r.extraction.country && daysBetween(g[g.length - 1].extraction.date, r.extraction.date) <= 4) g.push(r)
    else groups.push([r])
  }
  return groups.map((g) => {
    const country = g[0].extraction.country!
    let start = g[0].extraction.date
    let end = g[g.length - 1].extraction.date
    // Pull in flights or trains in the week before (hotel receipts carry the checkout date).
    const linked = receipts.filter(
      (r) => isUS(r.extraction.country) && r.classification.category === 'travel' && r.extraction.date && daysBetween(r.extraction.date, start) >= 0 && daysBetween(r.extraction.date, start) <= 7,
    )
    if (linked.length) start = linked.map((r) => r.extraction.date).sort()[0]
    const key = `${country}:${g[0].extraction.date}`
    const log = logs[key]
    if (log?.start) start = log.start
    if (log?.end && log.end >= start) end = log.end
    const all = [...linked, ...g]
    return {
      key, country, start, end, receipts: all,
      cities: Array.from(new Set(g.map((r) => r.extraction.city).filter(Boolean) as string[])),
      totalDays: daysBetween(start, end) + 1,
      weekTestDays: daysBetween(start, end),
    }
  })
}

export const tripDates = (t: Trip) => Array.from({ length: t.totalDays }, (_, i) => iso(day(t.start) + i * 86_400_000))

export type TripResult = {
  businessDays: number
  personalDays: number
  unmarked: number
  rule: 'unmarked' | 'primarily_personal' | 'full_transport' | 'allocate'
  transport: { paid: number; allowed: number }
  lodging: { paid: number; allowed: number }
  meals: { paid: number; allowed: number }
  other: { paid: number; allowed: number }
  allowed: number
  explain: string[]
}

export function tripResult(t: Trip, log: TripLog | undefined, profile: Pick<Profile, 'workType'>): TripResult {
  const days = tripDates(t)
  const kinds = days.map((d) => log?.days[d])
  // Travel days to and from the destination count as business days (Pub 463).
  const businessDays = kinds.filter((k): k is DayKind => k === 'business' || k === 'travel').length
  const personalDays = kinds.filter((k) => k === 'personal').length
  const unmarked = kinds.filter((k) => !k).length
  const bucket = (r: Receipt) => {
    const c = r.classification.category
    if (c === 'personal') return 'skip'
    if (c === 'meals') return 'meals'
    if (c === 'travel' && /hotel|albergo|inn|lodg|airbnb|hostel|resort|suite/i.test(r.extraction.merchant + r.extraction.notes + r.extraction.businessPurpose)) return 'lodging'
    if (c === 'travel') return 'transport'
    return 'other'
  }
  const paid = { transport: 0, lodging: 0, meals: 0, other: 0 }
  const mealsOnBusinessDays: number[] = []
  for (const r of t.receipts) {
    const b = bucket(r)
    const usd = usdOf(r)
    if (b === 'skip' || usd == null) continue
    paid[b] += usd
    if (b === 'meals' && (log?.days[r.extraction.date] === 'business' || log?.days[r.extraction.date] === 'travel')) mealsOnBusinessDays.push(usd)
  }
  const explain: string[] = []
  const zero = { transport: { paid: paid.transport, allowed: 0 }, lodging: { paid: paid.lodging, allowed: 0 }, meals: { paid: paid.meals, allowed: 0 }, other: { paid: paid.other, allowed: 0 } }
  if (profile.workType === 'w2') {
    explain.push('Employees can’t deduct unreimbursed travel on the federal return.')
    return { businessDays, personalDays, unmarked, rule: 'primarily_personal', ...zero, allowed: 0, explain }
  }
  if (unmarked === days.length) {
    explain.push('Mark each day as a business, travel or personal day. The IRS rules depend on that split.')
    return { businessDays, personalDays, unmarked, rule: 'unmarked', ...zero, allowed: 0, explain }
  }
  const counted = businessDays + personalDays
  const share = counted ? businessDays / counted : 0
  let rule: TripResult['rule']
  let transportAllowed: number
  if (businessDays <= personalDays) {
    rule = 'primarily_personal'
    transportAllowed = 0
    explain.push('More personal days than business days, so the trip looks primarily personal. Getting there and back isn’t deductible, but expenses on the days you worked can be.')
  } else if (t.weekTestDays <= 7 || personalDays / counted < 0.25) {
    rule = 'full_transport'
    transportAllowed = paid.transport
    explain.push(
      t.weekTestDays <= 7
        ? `The trip is ${t.weekTestDays} days by the IRS count (departure day not counted), which is a week or less. If it was primarily for business, the full cost of getting there and back is deductible.`
        : `Personal days are under 25% of the trip, so the full cost of getting there and back is deductible.`,
    )
  } else {
    rule = 'allocate'
    transportAllowed = paid.transport * share
    explain.push(`The trip is longer than a week and ${Math.round((personalDays / counted) * 100)}% personal, so the airfare and train costs are split: ${businessDays} business days out of ${counted} counts ${Math.round(share * 100)}%.`)
  }
  const lodgingAllowed = paid.lodging * share
  explain.push(`Lodging counts for business nights only: ${Math.round(share * 100)}% of ${fmt(paid.lodging)}.`)
  const mealsAllowed = mealsOnBusinessDays.reduce((a, b) => a + b, 0) * 0.5
  if (paid.meals) explain.push('Meals count at 50%, and only on business days.')
  const otherAllowed = paid.other * share
  const allowed = round(transportAllowed + lodgingAllowed + mealsAllowed + otherAllowed)
  if (unmarked) explain.push(`${unmarked} day${unmarked > 1 ? 's are' : ' is'} not marked yet and ${unmarked > 1 ? 'are' : 'is'} left out.`)
  return {
    businessDays, personalDays, unmarked, rule,
    transport: { paid: paid.transport, allowed: round(transportAllowed) },
    lodging: { paid: paid.lodging, allowed: round(lodgingAllowed) },
    meals: { paid: paid.meals, allowed: round(mealsAllowed) },
    other: { paid: paid.other, allowed: round(otherAllowed) },
    allowed, explain,
  }
}

const round = (n: number) => Math.round(n * 100) / 100
const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

// ---------- the whole picture ----------

export type QuestionId = keyof Plan

export type Opportunity = {
  id: string
  title: string
  status: 'applies' | 'check' | 'heads_up'
  savings: number | null // estimated tax saved, when computable
  summary: string
  why: string[]
  steps: string[]
  ref: string
  questions?: QuestionId[]
}

export type Picture = {
  plan: Plan
  incomes: IncomeEntry[]
  est: Estimate | null
  trips: { trip: Trip; result: TripResult; log?: TripLog }[]
  opportunities: Opportunity[]
  businessExpenses: number
  itemized: { propertyTax: number; mortgageInterest: number; charityCash: number; medical: number }
}

export function buildPicture(profile: Profile, receipts: Receipt[], manualIncome: IncomeEntry[], logs: Record<string, TripLog>): Picture {
  const plan = { ...emptyPlan, ...(profile.plan ?? {}) }
  const year = profile.taxYear
  const inYear = receipts.filter((r) => !r.extraction.date || r.extraction.date.startsWith(String(year)))
  const incomes = incomesFrom(inYear, manualIncome, year)
  const trips = detectTrips(inYear, logs).map((trip) => ({ trip, log: logs[trip.key], result: tripResult(trip, logs[trip.key], profile) }))

  // Business expenses: receipts on a logged trip use the trip result instead of their own numbers.
  const onLoggedTrip = new Set(trips.filter((t) => t.result.rule !== 'unmarked').flatMap((t) => t.trip.receipts.map((r) => r.id)))
  const businessExpenses =
    inYear.filter((r) => categoryById[r.classification.category].group === 'business' && !onLoggedTrip.has(r.id)).reduce((s, r) => s + r.classification.deductible, 0) +
    trips.filter((t) => t.result.rule !== 'unmarked').reduce((s, t) => s + t.result.allowed, 0)
  const sumCat = (ids: string[]) => inYear.filter((r) => ids.includes(r.classification.category)).reduce((s, r) => s + (usdOf(r) ?? 0), 0)
  const itemized = { propertyTax: sumCat(['property_tax']), mortgageInterest: sumCat(['mortgage_interest']), charityCash: sumCat(['charity']), medical: sumCat(['medical']) }
  const est = estimate({ profile, plan, incomes, businessExpenses, itemized })
  return { plan, incomes, est, trips, businessExpenses, itemized, opportunities: est ? opportunities(profile, plan, inYear, est, trips) : [] }
}

function opportunities(profile: Profile, plan: Plan, receipts: Receipt[], est: Estimate, trips: Picture['trips']): Opportunity[] {
  const t = taxTableFor(est.year)!
  const fs = profile.filingStatus
  const se = profile.workType !== 'w2'
  const hasSeIncome = est.seGross > 0
  const out: Opportunity[] = []
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const margins = `Your estimated margin is ${pct(est.marginal.federal)} federal${est.marginal.se ? ` plus ${pct(est.marginal.se)} self-employment tax` : ''}${est.marginal.state ? ` plus ${(est.marginal.state * 100).toFixed(2)}% state` : ''}.`

  // Trips needing day logs
  for (const { trip, result } of trips) {
    if (result.rule === 'unmarked' && se) {
      out.push({
        id: 'trip:' + trip.key, title: `Log your ${trip.country} trip day by day`, status: 'check', savings: null,
        summary: `${trip.receipts.length} receipts from ${trip.start} to ${trip.end}. Foreign travel is deductible only for business days, so the IRS needs a day-by-day split.`,
        why: ['Pub 463 counts travel days and days you worked as business days. Weekends between business days count too.', 'Trips over a week that are 25% or more personal must split the airfare.'],
        steps: ['Open the trip below and mark each day.', 'Attach proof for business days: clips or photos from shoots, meeting notes, contracts, published posts.'],
        ref: 'IRS Pub 463, ch. 1, Travel Outside the United States',
      })
    }
  }

  // Foreign currency waiting for a USD figure
  const needUsd = receipts.filter((r) => r.extraction.currency !== 'USD' && usdOf(r) == null)
  if (needUsd.length) {
    out.push({
      id: 'usd', title: `Add US dollar amounts to ${needUsd.length} foreign receipt${needUsd.length > 1 ? 's' : ''}`, status: 'check', savings: null,
      summary: 'Amounts must be reported in US dollars. They count once you enter what your card was actually charged.',
      why: needUsd.slice(0, 4).map((r) => `${r.extraction.merchant}: ${r.extraction.total} ${r.extraction.currency}`),
      steps: ['Open each receipt and enter the USD amount from your card or bank statement.'],
      ref: 'IRS Pub 54 / Foreign currency and currency exchange rates',
    })
  }

  // Meals missing a business purpose
  const meals = receipts.filter((r) => r.classification.category === 'meals' && !r.extraction.businessPurpose)
  if (meals.length && se) {
    const atRisk = meals.reduce((s, r) => s + r.classification.deductible, 0)
    out.push({
      id: 'meals', title: `Protect ${meals.length} meal deduction${meals.length > 1 ? 's' : ''}`, status: 'applies', savings: null,
      summary: `${fmt(atRisk)} of meal deductions have no business purpose noted. Without who attended and why, they’re easy to lose in an audit.`,
      why: ['Business meals need the amount, date, place, attendees and the business purpose.'],
      steps: ['Open each meal and write who you met and what you discussed. If you filmed a food segment, say so and link the published post.'],
      ref: 'IRS Pub 463, ch. 2 and ch. 5 (Recordkeeping)',
    })
  }

  if (se && hasSeIncome) {
    // Retirement
    const base = Math.max(0, est.seNet - est.seTax / 2)
    const sepMax = Math.min(base * 0.2, t.limits.definedContribution)
    if (plan.retirement === null || plan.retirement === 'none') {
      const deferral = Math.min(t.limits.deferral401k + (plan.age50 ? t.limits.catchUp50 : 0), base)
      const soloMax = Math.min(deferral + sepMax, t.limits.definedContribution + (plan.age50 ? t.limits.catchUp50 : 0), base)
      out.push({
        id: 'retire', title: 'Put self-employment income in a SEP-IRA or Solo 401(k)', status: plan.retirement === null ? 'check' : 'applies',
        savings: savingsFor(est, soloMax, 'adjustment') || null,
        summary: `On ${fmt(est.seNet)} of net self-employment income you could contribute up to about ${fmt(sepMax)} to a SEP-IRA, or up to about ${fmt(soloMax)} to a Solo 401(k), and deduct it.`,
        why: [`SEP and Solo 401(k) employer contributions are 20% of net earnings after half of SE tax for sole proprietors. Solo 401(k) adds an employee deferral of up to ${fmt(t.limits.deferral401k)}${plan.age50 ? ` plus ${fmt(t.limits.catchUp50)} catch-up` : ''}.`, margins, 'The savings shown is income tax only. Retirement contributions don’t reduce self-employment tax.'],
        steps: ['Open the plan with a brokerage. A Solo 401(k) is best opened before December 31.', 'A SEP-IRA can be opened and funded up to your filing deadline, including extensions.', 'Enter what you put in under Questions so the estimate updates.'],
        ref: 'IRS Pub 560; IRC §404, §415', questions: ['retirement', 'age50'],
      })
    }

    // Health insurance
    if (plan.healthPremiums === null) {
      out.push({ id: 'health', title: 'Deduct health insurance you pay yourself', status: 'check', savings: null, summary: 'If you buy your own health, dental or long-term care insurance and aren’t eligible for an employer plan, the premiums come off your income even if you don’t itemize.', why: ['Self-employed health insurance deduction, limited to your net self-employment profit.'], steps: ['Enter your yearly premiums under Questions.'], ref: 'IRC §162(l); Form 7206', questions: ['healthPremiums'] })
    }

    // HSA
    if (plan.hdhp === null) {
      out.push({ id: 'hsa', title: 'Check if you can use a Health Savings Account', status: 'check', savings: null, summary: `With a high-deductible health plan you can deduct up to ${fmt(t.limits.hsaSelf)} (self) or ${fmt(t.limits.hsaFamily)} (family) and spend it tax-free on medical costs.`, why: ['HSA contributions are deductible, grow tax-free and come out tax-free for medical expenses.', profile.state === 'CA' ? 'California doesn’t follow this: HSA contributions are taxable on your state return.' : ''].filter(Boolean), steps: ['Tell us whether your health plan is HSA-eligible.'], ref: 'IRS Pub 969', questions: ['hdhp'] })
    } else if (plan.hdhp !== 'none') {
      const cap = plan.hdhp === 'family' ? t.limits.hsaFamily : t.limits.hsaSelf
      const room = Math.max(0, cap - (plan.hsaContrib ?? 0))
      if (room > 0) out.push({ id: 'hsa', title: `Add ${fmt(room)} more to your HSA`, status: 'applies', savings: savingsFor(est, room, 'adjustment') || null, summary: `Your ${plan.hdhp} limit is ${fmt(cap)}. You can contribute for ${est.year} until the April filing deadline.`, why: [margins], steps: ['Contribute through your HSA provider and enter the total under Questions.'], ref: 'IRS Pub 969', questions: ['hsaContrib'] })
    }

    // Home office
    if (plan.homeOfficeSqFt === null) {
      out.push({ id: 'home', title: 'Claim a home office', status: 'check', savings: null, summary: 'If part of your home is used regularly and only for the business, you can deduct $5 per square foot, up to 300 square feet, with no receipts needed.', why: ['The simplified method needs only the square footage. The regular method (Form 8829) can be larger but needs actual expenses.'], steps: ['Measure the space. It must be used only for work, such as an office or editing room, not a dining table.', 'Enter the square feet under Questions.'], ref: 'IRS Pub 587', questions: ['homeOfficeSqFt'] })
    } else if (plan.homeOfficeSqFt > 0) {
      const ded = homeOfficeDeduction(plan, est.year)
      out.push({ id: 'home', title: 'Home office is counted', status: 'applies', savings: savingsFor(est, ded, 'business'), summary: `${Math.min(plan.homeOfficeSqFt, 300)} sq ft × $5 = ${fmt(ded)} off your business income.`, why: ['Simplified method. If your rent or mortgage, utilities and insurance are high, the regular method may be worth more.'], steps: ['Keep a photo and a floor sketch of the space.'], ref: 'IRS Pub 587' })
    }

    // Mileage
    const carReceipts = receipts.filter((r) => r.classification.category === 'car')
    if (plan.milesFirstHalf === null && plan.milesSecondHalf === null) {
      out.push({ id: 'miles', title: 'Log business miles', status: 'check', savings: null, summary: `${est.year} rates: 72.5¢ a mile through June 30, then 76¢ from July 1. Driving to shoots, clients, suppliers or the post office counts. Commuting doesn’t.`, why: [carReceipts.length ? `You have ${carReceipts.length} car receipts. The standard rate replaces actual fuel and repair costs, so pick one method per car.` : 'Most people under-claim mileage because they never log it.'], steps: ['Keep a mileage log with date, purpose and miles. A phone app is fine.', 'Enter business miles for each half of the year under Questions.'], ref: 'IRS Pub 463, ch. 4; Announcement 2026-11', questions: ['milesFirstHalf', 'milesSecondHalf'] })
    } else {
      const ded = mileageDeduction(plan, est.year)
      if (ded > 0) out.push({ id: 'miles', title: 'Mileage is counted', status: 'applies', savings: savingsFor(est, ded, 'business'), summary: `${((plan.milesFirstHalf ?? 0) + (plan.milesSecondHalf ?? 0)).toLocaleString()} business miles = ${fmt(ded)}.`, why: [carReceipts.length ? 'Using the standard rate, fuel and repair receipts for the same car don’t count separately.' : 'Standard mileage rate.'], steps: ['Keep the log. The IRS expects records made at the time.'], ref: 'IRS Pub 463, ch. 4' })
    }

    // Kids on payroll
    if ((plan.entity === 'sole_prop' || plan.entity === '') && (plan.dependents ?? 0) > 0) {
      const wage = t.standardDeduction.single
      out.push({
        id: 'kids', title: 'Pay your kids for real work in the business', status: plan.kidsCanWork ? 'applies' : 'check',
        savings: plan.kidsCanWork ? savingsFor(est, wage, 'business') : null,
        summary: `A sole proprietor’s wages to their own child under 18 aren’t subject to Social Security or Medicare tax, and a child’s standard deduction (${fmt(wage)} in ${est.year}) can cover the wages federally.`,
        why: ['The work has to be real: filming, editing, packing orders or cleaning the office. Pay has to be reasonable for the job and age.', 'The savings shown assumes one child paid up to the standard deduction.'],
        steps: ['Write down duties and hours, and pay by transfer, not cash.', 'Run payroll and issue a W-2. The child can put the money in a Roth IRA.'],
        ref: 'IRC §3121(b)(3)(A); IRS Pub 15, Family employees', questions: ['kidsCanWork'],
      })
    }

    // Augusta rule only fits entities that are separate from the owner
    if (plan.entity === 's_corp' || plan.entity === 'partnership') {
      out.push({ id: 'augusta', title: 'Rent your home to your company for up to 14 days', status: 'check', savings: null, summary: 'If you rent your home for 14 days or fewer in a year, the rent isn’t taxable to you, and your company can deduct a fair-market rent for real business use such as shoots, retreats or board meetings.', why: ['This works because your company is a separate taxpayer. It doesn’t work for a sole proprietorship renting from yourself.', 'Rent must match local market rates; get written quotes.'], steps: ['Document each use: date, purpose, attendees, and a rental agreement.', 'Have the company pay the rent from its own account.'], ref: 'IRC §280A(g)' })
    }

    // S-corp election: worth a conversation, not a computed claim
    if (plan.entity !== 's_corp' && est.seNet > 80_000) {
      out.push({ id: 'scorp', title: 'Ask a CPA about an S-corp election', status: 'heads_up', savings: null, summary: `At ${fmt(est.seNet)} of net profit, paying yourself a reasonable salary through an S corporation can cut self-employment tax on the rest. It adds payroll, a separate return and state fees, so it isn’t right for everyone.`, why: ['We don’t estimate this one: the answer depends on what a reasonable salary is for your work and on your state’s fees.'], steps: ['Bring your profit, expected salary and state to a CPA.'], ref: 'IRS Form 2553; Rev. Rul. 74-44 (reasonable compensation)' })
    }

    // Startup costs
    if (plan.startedThisYear === null) {
      out.push({ id: 'startup', title: 'Did the business start this year?', status: 'check', savings: null, summary: 'If so, you can deduct up to $5,000 of startup costs right away (plus $5,000 of organizational costs for a corporation or partnership), with the rest spread over 15 years. The $5,000 shrinks once costs pass $50,000.', why: ['Startup costs are what you spent before opening, such as market research, training and initial ads.'], steps: ['Answer under Questions.'], ref: 'IRC §195 (and §248 / §709)', questions: ['startedThisYear'] })
    }

    // Estimated taxes
    if (est.balance > 1_000) {
      const today = new Date().toISOString().slice(0, 10)
      const next = t.estimatedDue.find((d) => d >= today) ?? t.estimatedDue[t.estimatedDue.length - 1]
      const safe = plan.priorYearTax != null ? plan.priorYearTax * ((plan.priorYearAgi ?? 0) > t.safeHarborHighAgi ? 1.1 : 1) : null
      out.push({
        id: 'estimated', title: 'Pay estimated tax to avoid an underpayment penalty', status: plan.priorYearTax === null ? 'check' : 'applies', savings: null,
        summary: `You’re on track to owe about ${fmt(est.balance)}. The next quarterly payment is due ${next}.`,
        why: [
          safe != null ? `Safe harbor: paying ${fmt(safe)} this year (${(plan.priorYearAgi ?? 0) > t.safeHarborHighAgi ? '110%' : '100%'} of last year’s tax) through withholding and estimates avoids the penalty, even if you owe more in April.` : 'Safe harbor: pay 100% of last year’s total tax (110% if last year’s AGI was over $150,000), or 90% of this year’s, through withholding and quarterly estimates.',
          'Due dates: April 15, June 15, September 15 and January 15.',
        ],
        steps: ['Pay at IRS.gov/payments (Direct Pay) and choose "Estimated tax" (1040-ES).', 'Enter what you’ve paid under Questions.'],
        ref: 'IRC §6654; Form 1040-ES', questions: ['priorYearTax', 'priorYearAgi', 'estimatedPaid'],
      })
    }

    if (est.qbi > 0) {
      out.push({ id: 'qbi', title: 'Qualified business income deduction is counted', status: 'applies', savings: Math.round(est.qbi * est.marginal.federal), summary: `20% of qualified business income: ${fmt(est.qbi)} off taxable income.`, why: ['Applies automatically to sole proprietors below the income threshold. It isn’t a cost you pay, so make sure your preparer claims it (Form 8995).'], steps: ['Nothing to do but make sure it’s on your return.'], ref: 'IRC §199A; Form 8995' })
    }

    if (plan.occupation === 'content_creator') {
      out.push({ id: 'creator-pr', title: 'Free products from brands count as income', status: 'heads_up', savings: null, summary: 'Products sent to you to review or promote are generally taxable at fair market value. If you keep using them in the business, they can be deducted or depreciated as well.', why: ['Missing this income is a common audit issue for creators. Reporting it correctly heads off penalties.', 'Clothes and makeup are deductible only if they aren’t suitable for everyday wear, even if you wear them on camera.'], steps: ['Log each PR package: brand, date, item and retail price.', 'Keep items you use for content (props, gear) on your equipment list.'], ref: 'IRC §61 (income from any source); Pevsner v. Commissioner (clothing)' })
    }
  }

  // Employees
  if (profile.workType !== 'self_employed') {
    if (plan.tips === null || plan.overtime === null) {
      out.push({ id: 'tips-ot', title: 'New deductions for tips and overtime', status: 'check', savings: null, summary: `For 2025–2028, qualified tips (up to ${fmt(t.tips.cap)}) and the extra half of overtime pay (up to ${fmt(t.overtime.cap[fs])}) can be deducted, even without itemizing. They phase out above ${fmt(t.tips.phaseStart[fs])} of income.`, why: ['Your W-2 should show qualified tips and overtime separately.'], steps: ['Enter the amounts under Questions.'], ref: 'One Big Beautiful Bill Act; Schedule 1-A', questions: ['tips', 'overtime'] })
    }
  }
  if (plan.age65 === null) {
    out.push({ id: 'senior', title: 'Are you 65 or older?', status: 'check', savings: null, summary: `If so, you get a higher standard deduction and a new ${fmt(t.seniorDeduction.amount)} senior deduction (2025–2028), reduced above ${fmt(t.seniorDeduction.phaseStart[fs])} of income.`, why: [], steps: ['Answer under Questions.'], ref: 'One Big Beautiful Bill Act; Schedule 1-A', questions: ['age65'] })
  }
  if (plan.dependents === null) {
    out.push({ id: 'kids-q', title: 'Do you have children under 17?', status: 'check', savings: null, summary: `Each qualifying child is worth up to ${fmt(t.childTaxCredit.perChild)} as a credit in ${est.year}.`, why: [], steps: ['Answer under Questions.'], ref: 'IRC §24', questions: ['dependents'] })
  }

  // Charity for non-itemizers (new in 2026)
  const charity = receipts.filter((r) => r.classification.category === 'charity').reduce((s, r) => s + (usdOf(r) ?? 0), 0)
  if (charity > 0 && est.deductionKind === 'standard') {
    const ded = Math.min(charity, t.charityNonItemizer[fs])
    out.push({ id: 'charity', title: 'Cash gifts to charity count even without itemizing', status: 'applies', savings: Math.round(ded * (est.marginal.federal + est.marginal.state)), summary: `New for ${est.year}: up to ${fmt(t.charityNonItemizer[fs])} of cash gifts to public charities is deductible on top of the standard deduction. You’ve logged ${fmt(charity)}.`, why: ['Gifts to donor-advised funds and private foundations don’t qualify.', 'Gifts of $250 or more still need a written acknowledgment.'], steps: ['Keep each charity’s letter.'], ref: 'IRC §170, as amended by the One Big Beautiful Bill Act' })
  }

  const order = { applies: 0, check: 1, heads_up: 2 }
  return out.sort((a, b) => order[a.status] - order[b.status] || (b.savings ?? 0) - (a.savings ?? 0))
}
