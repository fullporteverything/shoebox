import React from 'react'
import { Bandit } from '../components/Bandit.js'
import { Link } from '../components/ui.js'

// An /app address that doesn't match a page, usually an old link.
export function NotFound() {
  return (
    <div className="card rise empty not-found">
      <Bandit pose="oops" size={150} />
      <h1>Nothing filed under this address</h1>
      <p className="muted">The link may be old, or the page has moved. Your receipts are safe and right where you left them.</p>
      <Link to="/app" className="btn btn-gold">Back to overview</Link>
    </div>
  )
}
