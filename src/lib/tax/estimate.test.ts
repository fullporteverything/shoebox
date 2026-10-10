import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bracketTax, estimate } from './estimate.js'
import { detectTrips, tripResult } from './advisor.js'
import { emptyPlan } from '../types.js'
import type { Profile, Receipt } from '../types.js'
import { classify } from './classify.js'

const profile: Profile = { name: 'T', email: 't@x', state: 'TX', workType: 'self_employed', filingStatus: 'single', businessName: '', taxYear: 2026, avatarHue: 0 }

test('2026 single brackets', () => {
  // 12,400 × 10% + (50,400 − 12,400) × 12% + (60,000 − 50,400) × 22%
  assert.equal(Math.round(bracketTax(60_000, 'single').tax), Math.round(1240 + 4560 + 2112))
  assert.equal(bracketTax(60_000, 'single').rate, 0.22)
})

test('W-2 only, single, Texas', () => {
  const e = estimate({ profile: { ...profile, workType: 'w2' }, plan: emptyPlan, incomes: [{ id: '1', date: '2026-01-01', source: 'Job', type: 'wages', amount: 70_000, withheld: 7_000 }], businessExpenses: 0, itemized: { propertyTax: 0, mortgageInterest: 0, charityCash: 0, medical: 0 } })!
  assert.equal(e.deduction, 16_100)
  assert.equal(e.taxable, 53_900)
  assert.equal(e.state.kind, 'none')
  assert.equal(e.seTax, 0)
})

test('self-employment tax and QBI', () => {
  const e = estimate({ profile, plan: emptyPlan, incomes: [{ id: '1', date: '2026-02-01', source: 'Clients', type: 'self_employment', amount: 60_000, withheld: 0 }], businessExpenses: 10_000, itemized: { propertyTax: 0, mortgageInterest: 0, charityCash: 0, medical: 0 } })!
  // 50,000 × 0.9235 × 15.3%
  assert.equal(Math.round(e.seTax), Math.round(50_000 * 0.9235 * 0.153))
  assert.ok(e.qbi > 0)
  assert.equal(e.agi, Math.round((50_000 - e.seTax / 2) * 100) / 100)
})

test('flat-rate state and unknown state', () => {
  const inp = { plan: emptyPlan, incomes: [{ id: '1', date: '2026-01-01', source: 'Job', type: 'wages' as const, amount: 50_000, withheld: 0 }], businessExpenses: 0, itemized: { propertyTax: 0, mortgageInterest: 0, charityCash: 0, medical: 0 } }
  const pa = estimate({ ...inp, profile: { ...profile, state: 'PA', workType: 'w2' } })!
  assert.equal(pa.state.amount, Math.round(50_000 * 0.0307 * 100) / 100)
  const ca = estimate({ ...inp, profile: { ...profile, state: 'CA', workType: 'w2' } })!
  assert.equal(ca.state.kind, 'not_estimated')
  assert.equal(ca.state.amount, null)
})

test('no estimate for years without a verified table', () => {
  assert.equal(estimate({ profile: { ...profile, taxYear: 2024 }, plan: emptyPlan, incomes: [], businessExpenses: 0, itemized: { propertyTax: 0, mortgageInterest: 0, charityCash: 0, medical: 0 } }), null)
})

const rec = (id: string, date: string, merchant: string, cat: Receipt['classification']['category'], usd: number, country = 'Italy'): Receipt => {
  const ex = { documentType: 'receipt' as const, merchant, date, total: usd, tax: null, tip: null, currency: country === 'Italy' ? 'EUR' : 'USD', paymentMethod: null, lineItems: [], formType: null, suggestedCategory: cat, businessPurpose: 'x', confidence: 0.9, notes: '', city: null, country, usdTotal: usd }
  return { id, createdAt: 0, fileName: '', image: null, extraction: ex, classification: classify(ex, profile), status: 'confirmed', businessPct: 100, memo: '', history: [] }
}

test('foreign trip over a week, 30% personal, splits airfare', () => {
  const rs = [rec('f', '2026-06-01', 'Atlas Air', 'travel', 1000, 'United States'), rec('h', '2026-06-05', 'Hotel Roma', 'travel', 900), rec('m', '2026-06-03', 'Trattoria', 'meals', 100)]
  const [trip] = detectTrips(rs, {})
  assert.equal(trip.receipts.length, 3)
  const days: Record<string, 'business' | 'personal' | 'travel'> = {}
  const range = { start: '2026-06-01', end: '2026-06-10' }
  // Jun 1–10: 7 business/travel, 3 personal
  ;['01', '02', '03', '04', '05', '06', '07'].forEach((d) => (days[`2026-06-${d}`] = d === '01' ? 'travel' : 'business'))
  ;['08', '09', '10'].forEach((d) => (days[`2026-06-${d}`] = 'personal'))
  const log = { key: trip.key, days, evidence: [], primaryPurpose: '', ...range }
  const [t2] = detectTrips(rs, { [trip.key]: log })
  const r = tripResult(t2, log, profile)
  assert.equal(r.rule, 'allocate')
  assert.equal(r.transport.allowed, 700)
  assert.equal(r.lodging.allowed, 630)
  assert.equal(r.meals.allowed, 50)
})

test('mostly personal trip: no airfare', () => {
  const rs = [rec('f', '2026-06-01', 'Atlas Air', 'travel', 1000, 'United States'), rec('h', '2026-06-04', 'Hotel Roma', 'travel', 400)]
  const [trip] = detectTrips(rs, {})
  const log = { key: trip.key, days: { '2026-06-01': 'personal' as const, '2026-06-02': 'personal' as const, '2026-06-03': 'business' as const, '2026-06-04': 'personal' as const }, evidence: [], primaryPurpose: '' }
  const r = tripResult(detectTrips(rs, { [trip.key]: log })[0], log, profile)
  assert.equal(r.rule, 'primarily_personal')
  assert.equal(r.transport.allowed, 0)
})
