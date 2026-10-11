import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usdFigure } from './fx.js'
import { classify } from './tax/classify.js'
import type { Extraction, Profile } from './types.js'

const profile: Profile = { name: 'T', email: 't@x', state: 'NY', workType: 'self_employed', filingStatus: 'single', businessName: '', taxYear: 2026, avatarHue: 0 }
const ex = (o: Partial<Extraction> = {}): Extraction => ({ documentType: 'receipt', merchant: 'Hotel Aurelia', date: '2026-06-08', total: 640, tax: null, tip: null, currency: 'EUR', paymentMethod: null, lineItems: [], formType: null, suggestedCategory: 'travel', businessPurpose: 'Shoot', confidence: 0.9, notes: '', city: 'Rome', country: 'Italy', usdTotal: null, ...o })
const fx = { rate: 1.154, date: '2026-06-08', source: 'European Central Bank reference rate' }

test('statement figure beats the printed USD figure beats the exchange rate', () => {
  assert.deepEqual(usdFigure(ex({ usdTotal: 750 }), 742.18, fx), { usd: 742.18, from: 'you' })
  assert.deepEqual(usdFigure(ex({ usdTotal: 750 }), null, fx), { usd: 750, from: 'receipt' })
  assert.deepEqual(usdFigure(ex(), null, fx), { usd: 738.56, from: 'fx' })
  assert.deepEqual(usdFigure(ex(), null, null), { usd: null, from: null })
  assert.deepEqual(usdFigure(ex({ currency: 'USD', total: 20 }), 5, fx), { usd: 20, from: 'native' })
})

test('a converted foreign receipt counts, and says how', () => {
  const c = classify(ex(), profile, { fx })
  assert.equal(c.deductible, 738.56)
  assert.ok(c.reasons.some((r) => r.includes('1 EUR = $1.1540')))
  assert.ok(!c.flags.some((f) => f.text.includes('no published exchange rate')))
  const none = classify(ex({ currency: 'VND' }), profile, {})
  assert.equal(none.deductible, 0)
  assert.ok(none.flags.some((f) => f.text.includes('no published exchange rate')))
})
