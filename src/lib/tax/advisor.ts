// The savings assistant. Every suggestion here is a rule with a citation and
// explicit conditions. A suggestion is "applies" only when the person's own
// data meets the conditions, "check" when an answer is missing (we ask rather
// than assume), and is hidden when it clearly doesn't apply. Dollar figures
// are shown only when they can be computed from the person's numbers.

import { categoryById } from './rules.js'
import { estimate, homeOfficeDeduction, mileageDeduction, savingsFor } from './estimate.js'
import type { Estimate } from './estimate.js'
import { taxTableFor } from './y2026.js'
import { entityReturnDue, isLlc } from './entity.js'
import { usdFigure } from '../fx.js'
import type { DayKind, IncomeEntry, IncomeType, Plan, Profile, Receipt, TripLog } from '../types.js'
import { emptyPlan } from '../types.js'

export const usdOf = (r: Receipt): number | null => usdFigure(r.extraction, r.usdAmount, r.fx).usd

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
// Whole dollars print without cents ($4,400, not $4,400.00); other amounts keep them.
const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })
const longDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

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
  // Savings meter: estimated tax with these receipts vs. the same year without them.
  meter: Meter | null
}

export type Meter = {
  saved: number // tax the receipts have already taken off the estimate
  potential: number // more the computable savings opportunities would take off
  potentialCount: number
  stateIncluded: boolean // false when the state estimate isn't available, so the figure is federal + SE only
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
  const opps = est ? opportunities(profile, plan, inYear, est, trips) : []
  let meter: Meter | null = null
  if (est) {
    const without = estimate({ profile, plan, incomes, businessExpenses: 0, itemized: { propertyTax: 0, mortgageInterest: 0, charityCash: 0, medical: 0 } })
    // Only things that apply and aren't in the estimate yet: QBI and anything titled "…counted" already are.
    const counted = opps.filter((o) => o.status === 'applies' && o.id !== 'qbi' && !o.title.endsWith('counted') && (o.savings ?? 0) > 0)
    meter = {
      saved: without ? Math.max(0, Math.round(without.totalTax - est.totalTax)) : 0,
      potential: Math.round(counted.reduce((n, o) => n + (o.savings ?? 0), 0)),
      potentialCount: counted.length,
      stateIncluded: est.state.kind !== 'not_estimated',
    }
  }
  return { plan, incomes, est, trips, businessExpenses, itemized, opportunities: opps, meter }
}

function opportunities(profile: Profile, plan: Plan, receipts: Receipt[], est: Estimate, trips: Picture['trips']): Opportunity[] {
  const t = taxTableFor(est.year)!
  const fs = profile.filingStatus
  const se = profile.workType !== 'w2'
  const hasSeIncome = est.seGross > 0
  const out: Opportunity[] = []
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const biz = est.business
  const tr = biz.treatment
  const entity = plan.entity
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
    // Retirement. For a sole proprietor or partner it's figured on net
    // self-employment earnings; for an S corp owner, on the W-2 salary.
    const base = Math.max(0, est.seNet - est.seTax / 2)
    const sepMax = Math.min(base * 0.2, t.limits.definedContribution)
    if ((plan.retirement === null || plan.retirement === 'none') && tr === 's_corp') {
      const salary = biz.counted ? biz.salary : null
      const catchUp = plan.age50 ? t.limits.catchUp50 : 0
      const sep = salary == null ? 0 : Math.min(salary * 0.25, t.limits.definedContribution)
      const solo = salary == null ? 0 : Math.min(Math.min(t.limits.deferral401k + catchUp, salary) + sep, t.limits.definedContribution + catchUp, salary)
      if (salary !== 0) {
        out.push({
          id: 'retire', title: 'Set up a SEP-IRA or Solo 401(k) through your S corp', status: salary == null || plan.retirement === null ? 'check' : 'applies',
          savings: salary == null ? null : savingsFor(est, solo, 'adjustment') || null,
          summary: salary == null
            ? 'In an S corp, retirement contributions are based on the W-2 salary the company pays you, not on its profit. Enter your salary to see how much you could put in.'
            : `On a ${fmt(salary)} salary, your company could contribute up to about ${fmt(sep)} to a SEP-IRA, or about ${fmt(solo)} in all to a Solo 401(k) with your own deferrals.`,
          why: [`Employer contributions are capped at 25% of your W-2 pay. A Solo 401(k) adds an employee deferral of up to ${fmt(t.limits.deferral401k)}${plan.age50 ? ` plus ${fmt(t.limits.catchUp50)} catch-up` : ''}, taken out of your salary.`, 'Profit you take as a K-1 distribution doesn’t count toward these limits.', 'The savings shown is income tax only.'],
          steps: ['The company opens the plan and makes the employer contributions. Deferrals come out of your paychecks.', 'Enter the total under Questions so the estimate updates.'],
          ref: 'IRS Pub 560; IRC §404(a)(3), §415(c)', questions: ['ownerSalary', 'retirement', 'age50'],
        })
      }
    } else if ((plan.retirement === null || plan.retirement === 'none') && (tr === 'schedule_c' || biz.counted)) {
      const deferral = Math.min(t.limits.deferral401k + (plan.age50 ? t.limits.catchUp50 : 0), base)
      const soloMax = Math.min(deferral + sepMax, t.limits.definedContribution + (plan.age50 ? t.limits.catchUp50 : 0), base)
      out.push({
        id: 'retire', title: 'Put self-employment income in a SEP-IRA or Solo 401(k)', status: plan.retirement === null ? 'check' : 'applies',
        savings: savingsFor(est, soloMax, 'adjustment') || null,
        summary: `On ${fmt(est.seNet)} of net self-employment income you could contribute up to about ${fmt(sepMax)} to a SEP-IRA, or up to about ${fmt(soloMax)} to a Solo 401(k), and deduct it.`,
        why: [`SEP and Solo 401(k) employer contributions are 20% of net earnings after half of SE tax for sole proprietors${tr === 'partnership' ? ' and partners. In a partnership the plan is the partnership’s, and it has to cover your partners and eligible employees too' : ''}. Solo 401(k) adds an employee deferral of up to ${fmt(t.limits.deferral401k)}${plan.age50 ? ` plus ${fmt(t.limits.catchUp50)} catch-up` : ''}.`, margins, 'The savings shown is income tax only. Retirement contributions don’t reduce self-employment tax.'],
        steps: ['Open the plan with a brokerage. A Solo 401(k) is best opened before December 31.', 'A SEP-IRA can be opened and funded up to your filing deadline, including extensions.', 'Enter what you put in under Questions so the estimate updates.'],
        ref: 'IRS Pub 560; IRC §404, §415', questions: ['retirement', 'age50'],
      })
    }

    // Health insurance
    if (plan.healthPremiums === null) {
      const entityWhy = tr === 's_corp'
        ? 'As an S corp owner, the company has to pay or reimburse the premiums and include them in your W-2 wages. The deduction is limited to that W-2 pay.'
        : tr === 'partnership' ? 'As a partner, the partnership has to pay or reimburse the premiums and report them to you as a guaranteed payment.' : ''
      out.push({ id: 'health', title: 'Deduct health insurance you pay yourself', status: 'check', savings: null, summary: 'If you buy your own health, dental or long-term care insurance and aren’t eligible for an employer plan, the premiums come off your income even if you don’t itemize.', why: [tr === 's_corp' ? 'Self-employed health insurance deduction.' : 'Self-employed health insurance deduction, limited to your net self-employment profit.', entityWhy].filter(Boolean), steps: ['Enter your yearly premiums under Questions.'], ref: tr === 'schedule_c' ? 'IRC §162(l); Form 7206' : 'IRC §162(l); Form 7206; Rev. Rul. 91-26; Notice 2008-1', questions: ['healthPremiums'] })
    }

    // HSA
    if (plan.hdhp === null) {
      out.push({ id: 'hsa', title: 'Check if you can use a Health Savings Account', status: 'check', savings: null, summary: `With a high-deductible health plan you can deduct up to ${fmt(t.limits.hsaSelf)} (self) or ${fmt(t.limits.hsaFamily)} (family) and spend it tax-free on medical costs.`, why: ['HSA contributions are deductible, grow tax-free and come out tax-free for medical expenses.', profile.state === 'CA' ? 'California doesn’t follow this: HSA contributions are taxable on your state return.' : ''].filter(Boolean), steps: ['Tell us whether your health plan is HSA-eligible.'], ref: 'IRS Pub 969', questions: ['hdhp'] })
    } else if (plan.hdhp !== 'none') {
      const cap = plan.hdhp === 'family' ? t.limits.hsaFamily : t.limits.hsaSelf
      const room = Math.max(0, cap - (plan.hsaContrib ?? 0))
      if (room > 0) out.push({ id: 'hsa', title: `Add ${fmt(room)} more to your HSA`, status: 'applies', savings: savingsFor(est, room, 'adjustment') || null, summary: `Your ${plan.hdhp} limit is ${fmt(cap)}. You can contribute for ${est.year} until the April filing deadline.`, why: [margins], steps: ['Contribute through your HSA provider and enter the total under Questions.'], ref: 'IRS Pub 969', questions: ['hsaContrib'] })
    }

    // Home office and mileage are Schedule C items. In a partnership or S corp
    // they go through the business instead.
    if (tr === 'schedule_c') {
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
    } else {
      out.push({
        id: 'reimburse', title: 'Have the business pay you back for mileage and home office', status: 'heads_up', savings: null,
        summary: `In ${tr === 's_corp' ? 'an S corp' : 'a partnership'}, mileage and home office costs aren’t claimed on Schedule C. The usual way is an accountable plan: you give the business a mileage log or expense report, it pays you back and deducts the cost, and the payment isn’t income to you.`,
        why: [
          'We don’t count these in the estimate, because they depend on how your business pays you back.',
          tr === 's_corp'
            ? 'If the company doesn’t pay you back, you generally can’t deduct them: employee business expenses aren’t deductible federally.'
            : 'If the partnership agreement requires you to pay them yourself, you may deduct them on Schedule E as unreimbursed partnership expenses.',
        ],
        steps: ['Ask your preparer to set up a written accountable plan.', 'Turn in your mileage log and home office costs within 60 days of each expense, and keep copies.'],
        ref: tr === 's_corp' ? 'Treas. Reg. §1.62-2 (accountable plans; 60-day rule in (g)); IRC §67(g); IRS Pub 463' : 'Treas. Reg. §1.62-2 (accountable plans; 60-day rule in (g)); Schedule E instructions, Part II',
      })
    }

    // Kids on payroll: the payroll tax exemption is for a sole proprietorship,
    // or a partnership where each partner is the child's parent (Pub 15).
    const kidsFit = entity === 'sole_prop' || entity === '' || entity === 'smllc' || entity === 'partnership'
    if (kidsFit && (plan.dependents ?? 0) > 0) {
      const wage = t.standardDeduction.single
      const sure = entity === 'sole_prop' || entity === ''
      out.push({
        id: 'kids', title: 'Pay your kids for real work in the business', status: plan.kidsCanWork && sure ? 'applies' : 'check',
        savings: plan.kidsCanWork && sure ? savingsFor(est, wage, 'business') : null,
        summary: `A sole proprietor’s wages to their own child under 18 aren’t subject to Social Security or Medicare tax, and a child’s standard deduction (${fmt(wage)} in ${est.year}) can cover the wages federally.`,
        why: [
          'The work has to be real: filming, editing, packing orders or cleaning the office. Pay has to be reasonable for the job and age.',
          entity === 'partnership' ? 'In a partnership, this works only if every partner is the child’s parent, such as a business you own with your spouse.' : '',
          entity === 'smllc' ? 'Your LLC counts as its own employer for payroll taxes, so have your preparer confirm the exemption for an LLC you own alone before you rely on it.' : '',
          sure ? 'The savings shown assumes one child paid up to the standard deduction.' : '',
        ].filter(Boolean),
        steps: ['Write down duties and hours, and pay by transfer, not cash.', 'Run payroll and issue a W-2. The child can put the money in a Roth IRA.'],
        ref: entity === 'smllc' ? 'IRC §3121(b)(3)(A); IRS Pub 15, Family employees; Treas. Reg. §301.7701-2(c)(2)(iv)' : 'IRC §3121(b)(3)(A); IRS Pub 15, Family employees', questions: ['kidsCanWork'],
      })
    }

    // Augusta rule only fits entities that are separate from the owner
    if (tr !== 'schedule_c') {
      out.push({ id: 'augusta', title: 'Rent your home to your company for up to 14 days', status: 'check', savings: null, summary: 'If you rent your home for 14 days or fewer in a year, the rent isn’t taxable to you, and your company can deduct a fair-market rent for real business use such as shoots, retreats or board meetings.', why: ['This works because your company is a separate taxpayer. It doesn’t work for a sole proprietorship renting from yourself.', 'Rent must match local market rates; get written quotes.'], steps: ['Document each use: date, purpose, attendees, and a rental agreement.', 'Have the company pay the rent from its own account.'], ref: 'IRC §280A(g)' })
    }

    // S-corp election: worth a conversation, not a computed claim
    if (tr !== 's_corp' && est.seNet > 80_000) {
      const how = entity === 'sole_prop'
        ? 'A sole proprietor would first form an LLC or corporation under state law, then file Form 2553.'
        : entity === 'partnership'
          ? 'An LLC with several owners can elect too. Every owner has to sign Form 2553, and an S corp can’t have special allocations: profit is split by ownership.'
          : 'An LLC elects by filing Form 2553. That also makes it a corporation for tax purposes, so Form 8832 isn’t needed.'
      out.push({ id: 'scorp', title: 'Ask a CPA about an S-corp election', status: 'heads_up', savings: null, summary: `At ${fmt(est.seNet)} of net profit, paying yourself a reasonable salary through an S corporation can cut self-employment tax on the rest. It adds payroll, a separate return and state fees, so it isn’t right for everyone.`, why: ['We don’t estimate this one: the answer depends on what a reasonable salary is for your work and on your state’s fees.', how], steps: ['Bring your profit, expected salary and state to a CPA.', 'Form 2553 is due no more than 2 months and 15 days after the start of the tax year it’s for.'], ref: entity === 'partnership' ? 'IRS Form 2553 and instructions; IRC §1361(b)(1)(D), §1362(a)(2); Rev. Rul. 74-44 (reasonable compensation)' : 'IRS Form 2553 and instructions; Treas. Reg. §301.7701-3(c)(1)(v)(C); Rev. Rul. 74-44 (reasonable compensation)' })
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
        summary: `You’re on track to owe about ${fmt(est.balance)}. The next quarterly payment is due ${longDate(next)}.`,
        why: [
          safe != null ? `Safe harbor: paying ${fmt(safe)} this year (${(plan.priorYearAgi ?? 0) > t.safeHarborHighAgi ? '110%' : '100%'} of last year’s tax) through withholding and estimates avoids the penalty, even if you owe more in April.` : 'Safe harbor: pay 100% of last year’s total tax (110% if last year’s AGI was over $150,000), or 90% of this year’s, through withholding and quarterly estimates.',
          'Due dates: April 15, June 15, September 15 and January 15.',
        ],
        steps: ['Pay at IRS.gov/payments (Direct Pay) and choose "Estimated tax" (1040-ES).', 'Enter what you’ve paid under Questions.'],
        ref: 'IRC §6654; Form 1040-ES', questions: ['priorYearTax', 'priorYearAgi', 'estimatedPaid'],
      })
    }

    if (est.qbi > 0) {
      out.push({ id: 'qbi', title: 'Qualified business income deduction is counted', status: 'applies', savings: Math.round(est.qbi * est.marginal.federal), summary: `20% of qualified business income: ${fmt(est.qbi)} off taxable income.`, why: [tr === 'schedule_c' ? 'Applies automatically to sole proprietors below the income threshold. It isn’t a cost you pay, so make sure your preparer claims it (Form 8995).' : `Applies to your share of the business’s profit below the income threshold${tr === 's_corp' ? ', not to your salary' : ''}. The K-1 shows the figures your preparer needs for Form 8995.`], steps: ['Nothing to do but make sure it’s on your return.'], ref: 'IRC §199A; Form 8995' })
    }

    if (plan.occupation === 'content_creator') {
      out.push({ id: 'creator-pr', title: 'Free products from brands count as income', status: 'heads_up', savings: null, summary: 'Products sent to you to review or promote are generally taxable at fair market value. If you keep using them in the business, they can be deducted or depreciated as well.', why: ['Missing this income is a common audit issue for creators. Reporting it correctly heads off penalties.', 'Clothes and makeup are deductible only if they aren’t suitable for everyday wear, even if you wear them on camera.'], steps: ['Log each PR package: brand, date, item and retail price.', 'Keep items you use for content (props, gear) on your equipment list.'], ref: 'IRC §61 (income from any source); Pevsner v. Commissioner (clothing)' })
    }
  }

  if (se) out.push(...entityOpportunities(profile, plan, est))

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

// ---------- how the business is set up (entity.ts) ----------

const COMMUNITY_PROPERTY = ['AZ', 'CA', 'ID', 'LA', 'NV', 'NM', 'TX', 'WA', 'WI']

function entityOpportunities(profile: Profile, plan: Plan, est: Estimate): Opportunity[] {
  const out: Opportunity[] = []
  const biz = est.business
  const tr = biz.treatment
  const entity = plan.entity
  const hasBiz = est.seGross > 0
  const due = longDate(entityReturnDue(est.year))

  if (entity === '' && hasBiz) {
    out.push({
      id: 'entity-q', title: 'How is your business set up?', status: 'check', savings: null,
      summary: 'A sole proprietor or single-member LLC reports on Schedule C. A multi-member LLC, a partnership or an S corp files its own return, and the math is different. Until you answer, we figure it as a sole proprietor.',
      why: ['An LLC is taxed by how many owners it has and any election it filed, not by being an LLC.'],
      steps: ['Choose your business type under Questions. Your formation papers or EIN letter from the IRS (CP 575) will say.'],
      ref: 'Treas. Reg. §301.7701-3; IRS Pub 3402', questions: ['entity'],
    })
  }

  if (entity === 'smllc') {
    out.push({
      id: 'smllc', title: 'Your single-member LLC is taxed like a sole proprietorship', status: 'heads_up', savings: null,
      summary: 'With no election, the IRS disregards a single-member LLC for income tax. Its profit goes on your Schedule C with self-employment tax and the QBI deduction, the same as with no LLC. The LLC protects you legally; it doesn’t change your federal income tax.',
      why: ['It can choose to be taxed as an S corp (Form 2553) or a C corp (Form 8832).', 'For payroll and excise taxes it counts as a separate business and may need its own EIN.'],
      steps: ['Nothing extra to file for income tax. Your preparer reports the LLC on your Schedule C.'],
      ref: 'Treas. Reg. §301.7701-3(b)(1)(ii), §301.7701-2(c)(2)(iv); Schedule C instructions; IRS Pub 3402',
    })
  }

  if (tr === 'partnership') {
    if (plan.ownershipPct === null) {
      out.push({
        id: 'share-q', title: 'What share of the business do you own?', status: 'check', savings: null,
        summary: 'A multi-member LLC or partnership files its own return (Form 1065) and gives each owner a Schedule K-1. Your share of the profit goes on Schedule E, Part II and is generally subject to self-employment tax. We need your share before the business can be in your estimate.',
        why: ['Your share is set in the operating or partnership agreement, and your K-1 shows it (item J).', 'Receipts you upload count as the partnership’s expenses.'],
        steps: ['Enter your profit share under Questions.'],
        ref: 'Form 1065 and Schedule K-1 instructions; Schedule E instructions, Part II; IRC §702, §1402(a)', questions: ['ownershipPct'],
      })
    }
    out.push({
      id: 'due-1065', title: 'The partnership return is due March 15, not April 15', status: 'heads_up', savings: null,
      summary: `Form 1065 for ${est.year} is due ${due}. You need the K-1 from it to finish your own return. Form 7004, filed by then, gives the business 6 more months.`,
      why: ['The IRS charges a late-filing penalty for each partner, for each month the return is late, even when no tax is due.', 'The partnership doesn’t pay income tax itself. Each partner pays on their share, so plan your own estimated tax.'],
      steps: ['Send your preparer the business’s receipts and income early in the year.', 'Give each partner a K-1 by the due date.'],
      ref: 'Form 1065 instructions, When to file; IRC §6072(b), §6698; Form 7004',
    })
    if (profile.filingStatus === 'married_joint' && COMMUNITY_PROPERTY.includes(profile.state)) {
      out.push({
        id: 'spouse-llc', title: 'Own the LLC with your spouse? You may be able to skip Form 1065', status: 'heads_up', savings: null,
        summary: 'In a community property state, a married couple who are the only owners of an LLC can choose to treat it as a single-member LLC (Schedule C) or as a partnership (Form 1065).',
        why: ['Only if the two of you own it as community property and nobody else is an owner. Switching how you file it is a choice to make with a CPA.'],
        steps: ['Ask your preparer whether Rev. Proc. 2002-69 fits your LLC.'],
        ref: 'Rev. Proc. 2002-69',
      })
    }
  }

  if (tr === 's_corp') {
    if (plan.ownershipPct === null || plan.ownerSalary === null) {
      out.push({
        id: 'scorp-q', title: 'Tell us your S corp salary and ownership share', status: 'check', savings: null,
        summary: 'S corp profit reaches you two ways: a W-2 salary, which has payroll tax, and your share of the rest on a K-1, which doesn’t have self-employment tax. We need both before the business can be in your estimate.',
        why: ['Your share is shown on your Schedule K-1 (Form 1120-S). The salary is what the company actually paid you through payroll, from your W-2.', 'Receipts you upload count as the company’s expenses.'],
        steps: ['Enter both under Questions.'],
        ref: 'IRC §1366, §1377; Schedule E instructions, Part II', questions: ['ownershipPct', 'ownerSalary'],
      })
    } else if (biz.net > 0) {
      out.push({
        id: 'scorp-salary', title: biz.salary === 0 ? 'An S corp owner who works in the business needs a salary' : 'Keep your S corp salary reasonable', status: 'heads_up', savings: null,
        summary: biz.salary === 0
          ? 'With no salary, the IRS can treat what you take out as wages and charge payroll tax, interest and penalties on it.'
          : `Your ${fmt(biz.salary)} salary has payroll tax. Your K-1 share of ${fmt(biz.k1)} doesn’t have self-employment tax. The salary has to be reasonable for the work you do.`,
        why: ['The IRS compares your pay with what similar businesses pay for similar work. We don’t judge what’s reasonable for you.'],
        steps: ['Ask a CPA to check your salary against market data, and keep their notes.', 'Run payroll for your salary: Form 941 each quarter and a W-2 by January 31.'],
        ref: 'Rev. Rul. 74-44; IRS Fact Sheet FS-2008-25; Rev. Rul. 59-221',
      })
    }
    out.push({
      id: 'due-1120s', title: 'The S corp return is due March 15, not April 15', status: 'heads_up', savings: null,
      summary: `Form 1120-S for ${est.year} is due ${due}. You need the K-1 from it to finish your own return. Form 7004, filed by then, gives the company 6 more months.`,
      why: ['The IRS charges a late-filing penalty for each shareholder, for each month the return is late, even when no tax is due.'],
      steps: ['Send your preparer the company’s receipts, income and payroll reports early in the year.'],
      ref: 'Form 1120-S instructions, When to file; IRC §6072(b), §6699; Form 7004',
    })
  }

  // State fees for LLCs and corporations
  if (isLlc(entity) || entity === 's_corp') {
    const ca = profile.state === 'CA'
    out.push({
      id: 'state-fee', title: ca ? 'California charges your business at least $800 a year' : 'Check your state’s annual LLC or corporation fee', status: 'heads_up', savings: null,
      summary: ca
        ? tr === 's_corp'
          ? 'A California S corporation, including an LLC that elected S-corp status, pays a 1.5% franchise tax on its net income, at least $800 a year, on Form 100S.'
          : 'A California LLC pays an $800 annual tax on Form 568, plus an LLC fee once its total California income reaches $250,000.'
        : 'Most states charge LLCs and corporations an annual fee, franchise tax or report fee, separate from income tax. Amounts and due dates vary by state.',
      why: ca ? ['It’s owed even in a year the business makes nothing.'] : ['We don’t list amounts for your state yet rather than risk a wrong number.'],
      steps: ca
        ? ['Pay it to the Franchise Tax Board by its due date.', 'Upload the receipt. It’s a business expense under Taxes and licenses.']
        : ['Look up your state’s secretary of state and revenue department for the fee and due date.', 'Upload the receipt. It’s a business expense under Taxes and licenses.'],
      ref: ca
        ? tr === 's_corp' ? 'Cal. Rev. & Tax. Code §23153, §23802; FTB Form 100S' : 'Cal. Rev. & Tax. Code §17941, §17942; FTB Form 568'
        : 'Your state’s secretary of state and revenue department',
    })
  }

  return out
}
