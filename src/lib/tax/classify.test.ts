import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, keywordCategory } from './classify.js'
import type { Extraction } from '../types.js'

const base: Extraction = {
  documentType: 'receipt', merchant: '', date: '2026-03-02', total: 100, tax: null, tip: null, currency: 'USD',
  paymentMethod: null, lineItems: [], formType: null, suggestedCategory: 'supplies', businessPurpose: 'client work',
  confidence: 0.9, notes: '',
}
const se = { state: 'TX', workType: 'self_employed' as const }

test('meals are 50% deductible', () => {
  const c = classify({ ...base, suggestedCategory: 'meals', total: 84.4 }, se)
  assert.equal(c.deductible, 42.2)
})

test('W-2 employees get no federal deduction for business expenses', () => {
  const c = classify({ ...base, suggestedCategory: 'supplies' }, { state: 'TX', workType: 'w2' })
  assert.equal(c.deductible, 0)
  assert.ok(c.flags.some((f) => f.text.includes('unreimbursed')))
})

test('business share scales the deduction', () => {
  const c = classify({ ...base, suggestedCategory: 'utilities', total: 90 }, se, { businessPct: 40 })
  assert.equal(c.deductible, 36)
})

test('gifts are capped at $25', () => {
  assert.equal(classify({ ...base, suggestedCategory: 'gifts', total: 60 }, se).deductible, 25)
})

test('income forms are never deductible', () => {
  const c = classify({ ...base, documentType: 'tax_form', formType: '1099-NEC', suggestedCategory: 'supplies' }, se)
  assert.equal(c.category, 'income_form')
  assert.equal(c.deductible, 0)
})

test('an invalid AI category falls back to keywords', () => {
  const c = classify({ ...base, merchant: 'Shell gas station', suggestedCategory: 'nonsense' as never }, se)
  assert.equal(c.category, 'car')
  assert.equal(c.source, 'rules')
})

test('large charity gifts need an acknowledgment', () => {
  const c = classify({ ...base, suggestedCategory: 'charity', total: 300 }, se)
  assert.ok(c.flags.some((f) => f.text.includes('acknowledgment')))
})

test('state notes follow the profile state', () => {
  const pa = classify({ ...base, suggestedCategory: 'supplies' }, { state: 'PA', workType: 'w2' })
  assert.ok(pa.stateNotes.some((n) => n.includes('Schedule UE')))
  const ca = classify({ ...base, suggestedCategory: 'equipment', total: 3200 }, { state: 'CA', workType: 'self_employed' })
  assert.ok(ca.stateNotes.some((n) => n.includes('bonus depreciation')))
})

test('keyword matcher', () => {
  assert.equal(keywordCategory('Delta Air Lines boarding')?.id, 'travel')
  assert.equal(keywordCategory('zzz'), null)
})
