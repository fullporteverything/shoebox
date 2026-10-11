import React from 'react'
import { FOUNDING_CLOSES, FOUNDING_PRICE, PASS_PRICE } from '../lib/cloud.js'
import { useSession } from '../lib/session.js'
import { Icon } from './icons.js'
import { Link } from './ui.js'

const closes = new Date(FOUNDING_CLOSES).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
export const foundingOpen = () => Date.now() < FOUNDING_CLOSES

// Homepage: the promise to early users, in plain terms.
export function FoundingBand() {
  const { phase } = useSession()
  if (!foundingOpen()) return null
  return (
    <section className="wrap section" style={{ paddingTop: 10 }} aria-labelledby="founding-h">
      <div className="card founding glow-border">
        <div>
          <div className="eyebrow">Founding members</div>
          <h2 id="founding-h">Everything is free while we’re new. Early users keep the best price.</h2>
          <p className="muted" style={{ marginTop: 12 }}>
            Organizing receipts, the tax map, savings scans, security and sync are free for everyone, and they stay free. Later we’ll add an optional
            Tax Year Pass with the filing pack, a quarterly tax planner and step-by-step savings plans. Join before {closes} and you’ll pay
            ${FOUNDING_PRICE} a year for it instead of ${PASS_PRICE}, for as long as you keep it.
          </p>
          <p className="hint" style={{ marginTop: 10 }}>Only W-2 income and taking the standard deduction? You probably won’t need the pass, and the free side is yours to keep.</p>
        </div>
        <div className="founding-cta">
          <div className="founding-price"><span className="was">${PASS_PRICE}</span> <b>${FOUNDING_PRICE}</b><small>/ tax year, locked in</small></div>
          {phase === 'unlocked' ? (
            <Link to="/app/profile" className="btn btn-gold">See your founder status</Link>
          ) : (
            <Link to="/signup" className="btn btn-gold btn-lg">Claim a founding spot <Icon name="arrowRight" /></Link>
          )}
          <span className="faint" style={{ fontSize: 12.5 }}>No card needed. Nothing to cancel.</span>
        </div>
      </div>
    </section>
  )
}

// Profile: the user's own status.
export function FoundingCard() {
  const { membership, cloudLinked } = useSession()
  if (!cloudLinked || !membership) return null
  if (!membership.founding) return null
  return (
    <div className="card founding-card rise">
      <div className="card-head">
        <h2>Founding member</h2>
        <span className="chip gold"><Icon name="sparkle" size={12} /> #{membership.number}</span>
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        You joined on {new Date(membership.joined_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}. When the Tax Year
        Pass launches, your price is ${FOUNDING_PRICE} a year instead of ${PASS_PRICE}, for as long as you keep it. Everything you use today stays free.
      </p>
    </div>
  )
}
