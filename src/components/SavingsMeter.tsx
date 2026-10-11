import React from 'react'
import type { Picture } from '../lib/tax/advisor.js'
import type { Profile } from '../lib/types.js'
import { Icon } from './icons.js'
import { CountUp, Link, money } from './ui.js'

// What the receipts have already taken off the estimated tax, and what the
// computable opportunities could add. Every figure comes from the estimate
// engine run with and without the receipts; nothing here is a guess.
export function SavingsMeter({ pic, profile }: { pic: Picture | null; profile: Profile }) {
  const m = pic?.meter
  if (!pic?.est || !m) {
    return (
      <div className="card meter rise">
        <div className="meter-copy">
          <div className="eyebrow"><Icon name="sparkle" size={13} /> Savings meter</div>
          <h2>See what your receipts are worth</h2>
          <p className="muted">
            {profile.taxYear !== 2026
              ? 'Estimates cover tax year 2026. Switch the tax year in Profile to see the meter.'
              : 'Add your income so far (a pay stub, a 1099 or a quick entry) and the meter shows how much tax your receipts take off. Without income there’s nothing to measure against, so we don’t guess.'}
          </p>
        </div>
        <Link to="/app/savings" className="btn btn-gold">Add income <Icon name="arrowRight" /></Link>
      </div>
    )
  }
  const total = m.saved + m.potential
  const pct = total > 0 ? (m.saved / total) * 100 : 0
  const standardOnly = m.saved === 0 && pic.est.deductionKind === 'standard' && pic.businessExpenses === 0
  return (
    <div className="card meter glow-border rise">
      <div className="meter-copy">
        <div className="eyebrow"><Icon name="sparkle" size={13} /> Savings meter · tax year {pic.est.year}</div>
        <div className="meter-figures">
          <div>
            <div className="meter-v"><CountUp value={m.saved} format={(n) => money(n, false)} /></div>
            <div className="meter-k">less estimated tax from your receipts</div>
          </div>
          {m.potential > 0 && (
            <div className="meter-more">
              <div className="meter-v sm">+<CountUp value={m.potential} format={(n) => money(n, false)} /></div>
              <div className="meter-k">more from {m.potentialCount} thing{m.potentialCount === 1 ? '' : 's'} you could do</div>
            </div>
          )}
        </div>
        {total > 0 && (
          <div className="meter-bar" role="img" aria-label={`${money(m.saved, false)} saved of ${money(total, false)} possible`}>
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="faint meter-note">
          {standardOnly
            ? 'You’re taking the standard deduction and have no business expenses yet, so receipts don’t lower your federal tax right now. The opportunities below still can.'
            : `Your estimate with these receipts vs. without them${m.stateIncluded ? '' : ' (federal and self-employment tax only; your state isn’t estimated yet)'}. An estimate, not a promise; it moves as you add documents.`}
        </p>
      </div>
      <Link to="/app/savings" className="btn btn-gold">{m.potential > 0 ? 'See how' : 'Open savings'} <Icon name="arrowRight" /></Link>
    </div>
  )
}
