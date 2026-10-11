import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimate } from './estimate.js'
import { quarterlyPlan } from './quarterly.js'
import { emptyPlan } from '../types.js'
import type { Profile } from '../types.js'

const profile: Profile = { name: 'T', email: 't@x', state: 'TX', workType: 'self_employed', filingStatus: 'single', businessName: '', taxYear: 2026, avatarHue: 0 }
const none = { propertyTax: 0, mortgageInterest: 0, charityCash: 0, medical: 0 }
const se = (amount: number) => [{ id: '1', date: '2026-02-01', source: 'Clients', type: 'self_employment' as const, amount, withheld: 0 }]

test('current-year method splits 90% of the tax over the remaining dates', () => {
  const est = estimate({ profile, plan: emptyPlan, incomes: se(80_000), businessExpenses: 0, itemized: none })!
  const q = quarterlyPlan(est, emptyPlan, '2026-08-01')!
  assert.equal(q.method, 'current_year')
  assert.equal(q.requiredAnnual, Math.round(0.9 * est.federalTotal))
  const due = q.installments.filter((i) => i.status !== 'past')
  assert.deepEqual(due.map((i) => i.due), ['2026-09-15', '2027-01-15'])
  assert.equal(due[0].status, 'next')
  assert.equal(due[0].amount, Math.ceil(q.remaining / 2))
})

test('prior-year safe harbor wins when smaller, with 110% over $150k AGI', () => {
  const est = estimate({ profile, plan: emptyPlan, incomes: se(120_000), businessExpenses: 0, itemized: none })!
  const plan = { ...emptyPlan, priorYearTax: 10_000, priorYearAgi: 160_000, estimatedPaid: 2_000 }
  const q = quarterlyPlan(est, plan, '2026-01-01')!
  assert.equal(q.method, 'prior_year')
  assert.equal(q.requiredAnnual, 11_000)
  assert.equal(q.remaining, 9_000)
  assert.equal(q.installments.filter((i) => i.status !== 'past').length, 4)
})

test('no plan needed when owed after withholding is under $1,000', () => {
  const est = estimate({ profile: { ...profile, workType: 'w2' }, plan: emptyPlan, incomes: [{ id: 'w', date: '2026-01-01', source: 'Job', type: 'wages', amount: 60_000, withheld: 6_500 }], businessExpenses: 0, itemized: none })!
  const q = quarterlyPlan(est, emptyPlan, '2026-05-01')!
  assert.equal(q.belowThreshold, true)
  assert.equal(q.remaining, 0)
})
