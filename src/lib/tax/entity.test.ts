import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimate, savingsFor } from './estimate.js'
import { buildPicture } from './advisor.js'
import { entityReturnDue, treatmentOf } from './entity.js'
import { emptyPlan } from '../types.js'
import type { IncomeEntry, Plan, Profile } from '../types.js'

const profile: Profile = { name: 'T', email: 't@x', state: 'TX', workType: 'self_employed', filingStatus: 'single', businessName: '', taxYear: 2026, avatarHue: 0 }
const none = { propertyTax: 0, mortgageInterest: 0, charityCash: 0, medical: 0 }
const se = (amount: number): IncomeEntry[] => [{ id: '1', date: '2026-02-01', source: 'Clients', type: 'self_employment', amount, withheld: 0 }]
const est = (plan: Partial<Plan>, amount = 120_000, expenses = 20_000, p = profile) =>
  estimate({ profile: p, plan: { ...emptyPlan, ...plan }, incomes: se(amount), businessExpenses: expenses, itemized: none })!

test('old saved values keep their meaning', () => {
  assert.equal(treatmentOf(''), 'schedule_c')
  assert.equal(treatmentOf('sole_prop'), 'schedule_c')
  assert.equal(treatmentOf('smllc'), 'schedule_c')
  assert.equal(treatmentOf('partnership'), 'partnership')
  assert.equal(treatmentOf('s_corp'), 's_corp')
  assert.equal(treatmentOf('llc_s_corp'), 's_corp')
  assert.equal(treatmentOf(undefined), 'schedule_c')
})

test('single-member LLC is taxed exactly like a sole proprietor', () => {
  const plan = { milesFirstHalf: 1_000, homeOfficeSqFt: 150, healthPremiums: 6_000 }
  const sole = est({ ...plan, entity: 'sole_prop' })
  const llc = est({ ...plan, entity: 'smllc' })
  assert.deepEqual(llc, sole)
  assert.equal(llc.business.treatment, 'schedule_c')
  assert.ok(llc.seTax > 0)
  assert.ok(llc.qbi > 0)
  // Mileage and home office are on Schedule C for both.
  assert.equal(llc.seNet, 120_000 - 20_000 - 1_000 * 0.725 - 150 * 5)
})

test('multi-member LLC without an ownership share: asks, and invents nothing', () => {
  const mm = est({ entity: 'partnership' })
  assert.equal(mm.business.counted, false)
  assert.equal(mm.business.share, null)
  assert.equal(mm.seNet, 0)
  assert.equal(mm.seTax, 0)
  assert.equal(mm.qbi, 0)
  assert.equal(mm.business.k1, 0)
  assert.ok(mm.flags.some((f) => /ownership share/.test(f)))
  // Same as having no business income at all: nothing assumed about the share.
  const nothing = estimate({ profile, plan: { ...emptyPlan, entity: 'partnership' }, incomes: [], businessExpenses: 0, itemized: none })!
  assert.equal(mm.totalTax, nothing.totalTax)
  assert.equal(savingsFor(mm, 1_000, 'business'), 0)

  const pic = buildPicture({ ...profile, plan: { ...emptyPlan, entity: 'partnership' } }, [], se(120_000), {})
  const ask = pic.opportunities.find((o) => o.id === 'share-q')
  assert.equal(ask?.status, 'check')
  assert.deepEqual(ask?.questions, ['ownershipPct'])
  assert.ok(pic.opportunities.some((o) => o.id === 'due-1065' && o.status === 'heads_up'))
  // No suggestion carries a dollar figure built on the unknown share.
  assert.ok(pic.opportunities.every((o) => o.savings == null), pic.opportunities.filter((o) => o.savings != null).map((o) => o.id).join())
  assert.equal(pic.opportunities.find((o) => o.id === 'retire'), undefined)

})

test('multi-member LLC with a share: K-1 share is subject to SE tax', () => {
  const half = est({ entity: 'partnership', ownershipPct: 50 })
  assert.equal(half.business.counted, true)
  assert.equal(half.business.k1, 50_000)
  assert.equal(half.seNet, 50_000)
  assert.equal(Math.round(half.seTax), Math.round(50_000 * 0.9235 * 0.153))
  // A partner with 100% would match Schedule C on the same numbers (no mileage or home office).
  assert.equal(est({ entity: 'partnership', ownershipPct: 100 }).federalTotal, est({ entity: 'sole_prop' }).federalTotal)
})

test('S corp: no self-employment tax on the K-1 share, payroll tax on the salary', () => {
  const s = est({ entity: 'llc_s_corp', ownershipPct: 100, ownerSalary: 40_000 })
  assert.equal(s.business.counted, true)
  assert.equal(s.seNet, 0)
  assert.equal(s.seTax, 0)
  const payroll = 40_000 * 0.153
  assert.equal(s.business.payrollTax, payroll)
  // Profit 100,000 less salary and the company's half of payroll tax.
  assert.equal(s.business.k1, 100_000 - 40_000 - payroll / 2)
  assert.equal(s.agi, 40_000 + s.business.k1)
  // Payroll tax is in the total, but not in what's owed at filing.
  assert.equal(s.totalTax, s.federalTotal + payroll)
  assert.equal(s.balance, s.federalTotal)
  // Distributions avoid SE tax, so payroll on a 40k salary is less than SE tax on 100k of profit.
  assert.ok(payroll < est({ entity: 'sole_prop' }).seTax)
  // A legacy "S corporation" answer gives the same result.
  assert.deepEqual(est({ entity: 's_corp', ownershipPct: 100, ownerSalary: 40_000 }), s)
})

test('S corp without a salary answer: asks for it and leaves the business out', () => {
  const s = est({ entity: 's_corp', ownershipPct: 100 })
  assert.equal(s.business.counted, false)
  assert.equal(s.seTax, 0)
  assert.equal(s.agi, 0)
  const pic = buildPicture({ ...profile, plan: { ...emptyPlan, entity: 's_corp', ownershipPct: 100 } }, [], se(120_000), {})
  const ask = pic.opportunities.find((o) => o.id === 'scorp-q')
  assert.equal(ask?.status, 'check')
  assert.deepEqual(ask?.questions, ['ownershipPct', 'ownerSalary'])
  assert.ok(pic.opportunities.some((o) => o.id === 'due-1120s'))
})

test('S corp with no salary gets a reasonable-compensation heads-up', () => {
  const pic = buildPicture({ ...profile, plan: { ...emptyPlan, entity: 's_corp', ownershipPct: 100, ownerSalary: 0 } }, [], se(120_000), {})
  const o = pic.opportunities.find((x) => x.id === 'scorp-salary')
  assert.equal(o?.status, 'heads_up')
  assert.match(o!.ref, /Rev\. Rul\. 74-44/)
})

test('business returns are due March 15, moved off weekends', () => {
  assert.equal(entityReturnDue(2026), '2027-03-15')
  assert.equal(entityReturnDue(2025), '2026-03-16') // March 15, 2026 is a Sunday
})

test('state fee heads-up cites California law, and names no amount elsewhere', () => {
  const ca = buildPicture({ ...profile, state: 'CA', plan: { ...emptyPlan, entity: 'smllc' } }, [], se(50_000), {})
  const fee = ca.opportunities.find((o) => o.id === 'state-fee')!
  assert.match(fee.summary, /\$800/)
  assert.match(fee.ref, /§17941/)
  const tx = buildPicture({ ...profile, plan: { ...emptyPlan, entity: 'smllc' } }, [], se(50_000), {})
  assert.doesNotMatch(tx.opportunities.find((o) => o.id === 'state-fee')!.summary, /\$\d/)
  // A sole proprietor without an LLC gets no fee heads-up.
  const sole = buildPicture({ ...profile, plan: { ...emptyPlan, entity: 'sole_prop' } }, [], se(50_000), {})
  assert.equal(sole.opportunities.find((o) => o.id === 'state-fee'), undefined)
})
