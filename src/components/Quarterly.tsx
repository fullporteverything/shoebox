import React from 'react'
import type { QuarterlyPlan } from '../lib/tax/quarterly.js'
import { Money } from './ui.js'

const fmtDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export function QuarterlyTable({ q }: { q: QuarterlyPlan }) {
  if (q.belowThreshold) {
    return <p className="muted" style={{ fontSize: 14 }}>You’re on track to owe less than $1,000 after withholding, so there’s no underpayment penalty and no federal quarterly payments to make.</p>
  }
  return (
    <>
      <table className="tbl">
        <thead><tr><th>Due</th><th className="num">Pay (federal)</th><th /></tr></thead>
        <tbody>
          {q.installments.map((i) => (
            <tr key={i.due} className={i.status === 'past' ? 'past' : i.status === 'next' ? 'next' : ''}>
              <td>{fmtDate(i.due)}</td>
              <td className="num">{i.status === 'past' ? '—' : <Money v={i.amount} whole />}</td>
              <td>{i.status === 'next' ? <span className="chip gold">Next</span> : i.status === 'past' ? <span className="faint">Passed</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 10 }}>
        {q.method === 'prior_year'
          ? `Based on last year’s tax (the safe harbor): pay ${'$' + q.requiredAnnual.toLocaleString()} in total this year through withholding and estimates and there’s no penalty, even if you owe more in April.`
          : `Based on 90% of this year’s estimated federal tax (${'$' + q.requiredAnnual.toLocaleString()}). Add last year’s total tax under Questions and the plan can use last year’s figure instead, which is often lower and doesn’t move as you earn more.`}{' '}
        {q.remaining > 0 && q.installments.some((i) => i.status === 'past') && 'Earlier due dates have passed, so what’s left falls on the remaining ones; paying sooner shrinks any penalty for the quarters you missed. '}
        So far: <Money v={q.withheld} whole /> withheld, <Money v={q.estimatedPaid} whole /> paid in estimates. Pay at irs.gov/payments. Your state has its own dates and rules.
      </p>
    </>
  )
}
