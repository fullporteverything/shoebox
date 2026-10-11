// The filing pack: everything a tax preparer (or tax software) asks for,
// in the order they ask for it. Built from the same engine as the rest of
// the app, so the numbers match what the person sees elsewhere.

import { categoryById } from './tax/rules.js'
import { homeOfficeDeduction, mileageDeduction } from './tax/estimate.js'
import { buildPicture, usdOf } from './tax/advisor.js'
import type { Picture } from './tax/advisor.js'
import { quarterlyPlan } from './tax/quarterly.js'
import { businessReturn, entityReturnDue, treatmentOf } from './tax/entity.js'
import type { Treatment } from './tax/entity.js'
import type { QuarterlyPlan } from './tax/quarterly.js'
import type { IncomeEntry, IncomeType, Profile, Receipt, TripLog } from './types.js'

export type ScheduleCLine = { form: string; label: string; amount: number; paid: number; count: number }

export type FilingPack = {
  year: number
  profile: Profile
  pic: Picture
  // Where the business expenses go. On Schedule C they're grouped by line;
  // a partnership or S corp files its own return (Form 1065 or 1120-S) with
  // different lines, so there they're grouped by category instead.
  treatment: Treatment
  businessReturn: string
  businessReturnDue: string | null // the partnership or S corp return's due date
  scheduleC: ScheduleCLine[]
  tripsAllowed: number
  mileage: number
  homeOffice: number
  scheduleCTotal: number
  income: { type: IncomeType; label: string; amount: number; withheld: number; count: number }[]
  quarterly: QuarterlyPlan | null
  attention: Receipt[]
  receipts: Receipt[]
}

const incomeLabels: Record<IncomeType, string> = {
  wages: 'Wages (W-2)', self_employment: 'Self-employment (1099-NEC, 1099-K, invoices)', interest: 'Interest (1099-INT)', dividends: 'Dividends (1099-DIV)', other: 'Other income',
}

// Schedule C line order, so the pack reads like the form.
const lineOrder = (form: string) => {
  const m = form.match(/line (\d+)([a-z]?)/i)
  return m ? Number(m[1]) * 10 + (m[2] ? m[2].charCodeAt(0) - 96 : 0) : 999
}

export function buildFilingPack(profile: Profile, receipts: Receipt[], manualIncome: IncomeEntry[], logs: Record<string, TripLog>): FilingPack {
  const year = profile.taxYear
  const pic = buildPicture(profile, receipts, manualIncome, logs)
  const inYear = receipts.filter((r) => !r.extraction.date || r.extraction.date.startsWith(String(year)))
  const onLoggedTrip = new Set(pic.trips.filter((t) => t.result.rule !== 'unmarked').flatMap((t) => t.trip.receipts.map((r) => r.id)))

  const treatment = treatmentOf(pic.plan.entity)
  const onScheduleC = treatment === 'schedule_c'
  const lines = new Map<string, ScheduleCLine>()
  for (const r of inYear) {
    const c = categoryById[r.classification.category]
    if (c.group !== 'business' || onLoggedTrip.has(r.id)) continue
    const key = onScheduleC ? c.form : c.id
    const l = lines.get(key) ?? { form: onScheduleC ? c.form : c.label, label: c.label, amount: 0, paid: 0, count: 0 }
    if (!l.label.includes(c.label)) l.label += `, ${c.label}`
    l.amount += r.classification.deductible
    l.paid += usdOf(r) ?? 0
    l.count++
    lines.set(key, l)
  }
  const scheduleC = [...lines.values()].sort((a, b) => (onScheduleC ? lineOrder(a.form) - lineOrder(b.form) : b.amount - a.amount))
  const tripsAllowed = pic.trips.filter((t) => t.result.rule !== 'unmarked').reduce((s, t) => s + t.result.allowed, 0)
  // Mileage and the simplified home office are Schedule C items (estimate.ts).
  const se = profile.workType !== 'w2' && onScheduleC
  const mileage = se ? mileageDeduction(pic.plan, year) : 0
  const homeOffice = se ? homeOfficeDeduction(pic.plan, year) : 0

  const byType = new Map<IncomeType, FilingPack['income'][number]>()
  for (const i of pic.incomes) {
    const label = i.type === 'self_employment' && !onScheduleC ? `Business income for ${businessReturn[treatment]} (1099-NEC, 1099-K, invoices)` : incomeLabels[i.type]
    const e = byType.get(i.type) ?? { type: i.type, label, amount: 0, withheld: 0, count: 0 }
    e.amount += i.amount
    e.withheld += i.withheld
    e.count++
    byType.set(i.type, e)
  }

  return {
    year, profile, pic, treatment, businessReturn: businessReturn[treatment], businessReturnDue: onScheduleC ? null : entityReturnDue(year),
    scheduleC, tripsAllowed, mileage, homeOffice,
    scheduleCTotal: scheduleC.reduce((s, l) => s + l.amount, 0) + tripsAllowed + mileage + homeOffice,
    income: [...byType.values()],
    quarterly: pic.est ? quarterlyPlan(pic.est, pic.plan) : null,
    attention: inYear.filter((r) => r.status === 'needs_review' || r.classification.flags.some((f) => f.level === 'warn')),
    receipts: [...inYear].sort((a, b) => a.extraction.date.localeCompare(b.extraction.date)),
  }
}

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v)
  // Quote everything; neutralize spreadsheet formulas in merchant names and notes.
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
}

export function receiptsCsv(pack: FilingPack): string {
  const head = ['Date', 'Merchant', 'Category', 'Where it goes', 'Amount paid (USD)', 'Business %', 'Deductible (USD)', 'Status', 'Business purpose', 'Notes', 'Flags']
  const rows = pack.receipts.map((r) => {
    const c = categoryById[r.classification.category]
    return [
      r.extraction.date, r.extraction.merchant, c.label, c.form, usdOf(r)?.toFixed(2) ?? '', r.businessPct, r.classification.deductible.toFixed(2),
      r.status === 'confirmed' ? 'Confirmed' : 'Needs review', r.extraction.businessPurpose, r.memo, r.classification.flags.map((f) => f.text).join(' | '),
    ]
  })
  return [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

// Schedule C summary, or for a partnership or S corp, the business's expenses
// by category for its own return.
export function expensesCsv(pack: FilingPack): string {
  const onScheduleC = pack.treatment === 'schedule_c'
  const rows: (string | number)[][] = [[onScheduleC ? 'Schedule C line' : `Expense (for ${pack.businessReturn})`, 'Categories', 'Receipts', 'Paid (USD)', 'Deductible (USD)']]
  for (const l of pack.scheduleC) rows.push([l.form, l.label, l.count, l.paid.toFixed(2), l.amount.toFixed(2)])
  if (pack.tripsAllowed) rows.push([onScheduleC ? 'Schedule C, lines 24a/24b' : 'Travel and meals', 'Business trips (allocated)', '', '', pack.tripsAllowed.toFixed(2)])
  if (pack.mileage) rows.push(['Schedule C, line 9', 'Standard mileage', '', '', pack.mileage.toFixed(2)])
  if (pack.homeOffice) rows.push(['Schedule C, line 30', 'Home office (simplified)', '', '', pack.homeOffice.toFixed(2)])
  rows.push(['', 'Total', '', '', pack.scheduleCTotal.toFixed(2)])
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
