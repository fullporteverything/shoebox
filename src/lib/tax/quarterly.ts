// Quarterly estimated tax (Form 1040-ES), federal only. States run their own
// estimated-tax systems with different dates and rules.
//
// The required annual payment is the smaller of 90% of this year's tax and
// 100% of last year's (110% if last year's AGI was over $150,000), IRC
// §6654(d). No penalty applies when the tax owed after withholding is under
// $1,000, §6654(e)(1). We spread what's left evenly over the remaining due
// dates; a missed earlier installment can already carry a small penalty that
// paying sooner reduces.

import type { Estimate } from './estimate.js'
import { taxTableFor } from './y2026.js'
import type { Plan } from '../types.js'

export type Installment = { due: string; amount: number; status: 'past' | 'next' | 'later' }
export type QuarterlyPlan = {
  method: 'prior_year' | 'current_year'
  requiredAnnual: number
  withheld: number
  estimatedPaid: number
  remaining: number
  belowThreshold: boolean // owed after withholding is under $1,000: no penalty either way
  installments: Installment[]
  expectedAtFiling: number // federal balance due (or refund, negative) if you pay the plan
}

export function quarterlyPlan(est: Estimate, plan: Plan, today = new Date().toISOString().slice(0, 10)): QuarterlyPlan | null {
  const t = taxTableFor(est.year)
  if (!t) return null
  const estimatedPaid = plan.estimatedPaid ?? 0
  const withheld = Math.max(0, est.paid - estimatedPaid)
  const current = 0.9 * est.federalTotal
  const prior = plan.priorYearTax != null ? plan.priorYearTax * ((plan.priorYearAgi ?? 0) > t.safeHarborHighAgi ? 1.1 : 1) : null
  const method = prior != null && prior < current ? 'prior_year' : 'current_year'
  const requiredAnnual = Math.round(method === 'prior_year' ? prior! : current)
  const belowThreshold = est.federalTotal - withheld < 1000
  const remaining = belowThreshold ? 0 : Math.max(0, Math.round(requiredAnnual - withheld - estimatedPaid))
  const upcoming = t.estimatedDue.filter((d) => d >= today)
  const each = upcoming.length ? Math.ceil(remaining / upcoming.length) : 0
  const installments: Installment[] = t.estimatedDue.map((due) => {
    const status: Installment['status'] = due < today ? 'past' : due === upcoming[0] ? 'next' : 'later'
    return { due, amount: status === 'past' ? 0 : each, status }
  })
  const plannedTotal = withheld + estimatedPaid + each * upcoming.length
  return { method, requiredAnnual, withheld, estimatedPaid, remaining, belowThreshold, installments, expectedAtFiling: Math.round(est.federalTotal - plannedTotal) }
}
