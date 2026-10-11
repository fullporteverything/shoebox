import React, { useEffect, useState } from 'react'
import { Bandit } from '../components/Bandit.js'
import { Icon } from '../components/icons.js'
import { PageTitle } from '../components/Shell.js'
import { Link } from '../components/ui.js'
import { PASS_PRICE, PASS_REQUIRED_FROM } from '../lib/cloud.js'
import { navigate, routeParams } from '../lib/router.js'
import { useSession } from '../lib/session.js'

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`
const opens = new Date(PASS_REQUIRED_FROM).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const included = [
  { icon: 'doc' as const, t: 'Filing pack', d: 'Your year laid out the way a preparer asks for it. Print to PDF or export CSVs.' },
  { icon: 'clock' as const, t: 'Quarterly tax planner', d: 'What to pay each quarter, the safe-harbor amount, and the due dates.' },
  { icon: 'sparkle' as const, t: 'Step-by-step savings plans', d: 'The forms, deadlines and proof to keep for each way to save.' },
]
const free = ['Receipt reading and sorting', 'Tax map and savings meter', 'Every savings suggestion and its rule', 'Encryption, two-factor and devices', 'Sync and exporting your data']

export function Pass({ route }: { route: string }) {
  const { profile, pass, refreshPass, startCheckout, cloudLinked, toast } = useSession()
  const params = routeParams(route)
  const paidSession = params.get('paid')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState(!!paidSession)
  const year = profile?.taxYear ?? new Date().getFullYear()
  const owned = pass?.passes.find((p) => p.tax_year === year && p.status === 'paid')

  // Back from Stripe: the webhook usually lands within a few seconds.
  useEffect(() => {
    if (!paidSession) return
    let stop = false
    let n = 0
    const tick = async () => {
      const p = await refreshPass()
      if (stop) return
      if (p?.passes.some((x) => x.tax_year === year && x.status === 'paid')) {
        setWaiting(false)
        toast('good', `Thanks! Your ${year} Tax Year Pass is active.`)
        navigate('/app/pass', { replace: true })
      } else if (++n < 20) setTimeout(tick, 2000)
      else setWaiting(false)
    }
    void tick()
    return () => {
      stop = true
    }
  }, [paidSession, year, refreshPass, toast])

  if (!profile) return null
  const quote = pass?.quote
  const earlyAccess = Date.now() < PASS_REQUIRED_FROM

  return (
    <>
      <PageTitle
        eyebrow="Tax Year Pass"
        title={owned ? `Your ${year} pass is active` : 'Get the most out of filing season'}
        sub={owned ? 'Thanks for supporting Shoebox. Everything below is unlocked for this tax year.' : 'One payment for a tax year. No subscription, nothing renews, nothing to cancel.'}
      />

      {params.get('cancelled') && <div className="card rise reason" style={{ marginBottom: 16 }}><Icon name="info" /> <span>Checkout cancelled. You weren’t charged.</span></div>}
      {waiting && <div className="card rise reason" style={{ marginBottom: 16 }}><Icon name="clock" /> <span>Payment received. Activating your pass, this takes a few seconds…</span></div>}
      {paidSession && !waiting && !owned && (
        <div className="card rise reason warn" style={{ marginBottom: 16 }}><Icon name="alert" /> <span>Stripe took the payment, but the pass hasn’t shown up yet. It can take a minute; refresh this page shortly. If it still isn’t here, contact us with your Stripe receipt.</span></div>
      )}

      <div className="split">
        <div className="stack">
          <div className="card rise glow-border pass-card">
            <div className="pass-head">
              <div>
                <div className="eyebrow">Tax year {year}</div>
                {owned ? (
                  <div className="pass-price"><b>Active</b><small>Paid {dollars(owned.amount)}{owned.founding ? ' · founding price' : ''} on {new Date(owned.at).toLocaleDateString()}</small></div>
                ) : (
                  <div className="pass-price">
                    {quote?.founding && <span className="was">${PASS_PRICE}</span>} <b>{quote ? dollars(quote.amount) : `$${PASS_PRICE}`}</b>
                    <small>one time, for tax year {year}{quote?.founding ? ' · founding member price' : ''}</small>
                  </div>
                )}
              </div>
              {owned ? (
                <div className="pass-owned">
                  <Bandit pose="celebrate" size={92} />
                  <span className="chip good"><span className="dot" /> Unlocked</span>
                </div>
              ) : quote?.founding ? <span className="chip gold"><Icon name="sparkle" size={12} /> Founding</span> : null}
            </div>
            <ul className="pass-list">
              {included.map((f) => (
                <li key={f.t}><span className="ic"><Icon name={f.icon} size={18} /></span><div><b>{f.t}</b><p className="muted">{f.d}</p></div></li>
              ))}
            </ul>
            {!owned && (
              <>
                {error && <div className="error" style={{ marginBottom: 10 }}><Icon name="alert" size={16} /> {error}</div>}
                <button
                  className="btn btn-gold btn-lg"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={busy || !cloudLinked}
                  onClick={async () => {
                    setBusy(true)
                    setError('')
                    const err = await startCheckout(year)
                    if (err) {
                      setError(err)
                      setBusy(false)
                    }
                  }}
                >
                  <Icon name="lock" /> {busy ? 'Opening secure checkout…' : `Get the ${year} pass`}
                </button>
                <p className="hint" style={{ marginTop: 10, textAlign: 'center' }}>
                  {cloudLinked ? 'Secure checkout by Stripe. We never see your card.' : 'Link this vault to your account in Profile → Settings first.'}{' '}
                  Not for you? Ask within 30 days for a full refund.
                </p>
              </>
            )}
            {earlyAccess && (
              <p className="hint pass-early"><Icon name="sparkle" size={13} /> Everything here is free for everyone until {opens}. Buying now just locks in your price and supports the project.</p>
            )}
          </div>
        </div>
        <div className="stack">
          <div className="card rise" style={{ animationDelay: '0.08s' }}>
            <div className="card-head"><h2>Always free</h2></div>
            <ul className="free-list">
              {free.map((f) => <li key={f}><Icon name="check" size={16} /> {f}</li>)}
            </ul>
            <p className="hint" style={{ marginTop: 12 }}>W-2 only and taking the standard deduction? You probably don’t need the pass.</p>
          </div>
          <div className="card rise" style={{ animationDelay: '0.12s' }}>
            <div className="card-head"><h2>How it works</h2></div>
            <ul className="free-list plain">
              <li>One payment per tax year. Nothing renews and there’s nothing to cancel.</li>
              <li>Founding members (joined before January 1, 2027) pay $39 instead of $59 for every year they keep it without a gap.</li>
              <li>Your receipts never go to Stripe. Stripe only sees your email and card.</li>
            </ul>
            <Link to="/legal/terms" className="btn btn-sm btn-ghost" style={{ marginTop: 8 }}>Terms <Icon name="arrowRight" /></Link>
          </div>
          {pass && pass.passes.length > 0 && (
            <div className="card rise" style={{ animationDelay: '0.16s' }}>
              <div className="card-head"><h2>Your passes</h2></div>
              <table className="tbl">
                <tbody>
                  {pass.passes.map((p) => (
                    <tr key={p.tax_year}><td>Tax year {p.tax_year}</td><td className="num">{dollars(p.amount)}</td><td>{p.status === 'paid' ? <span className="chip good">Active</span> : <span className="chip">Refunded</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// Shown in place of a pass feature once early access ends, for years without a pass.
export function PassGate({ feature, year }: { feature: string; year: number }) {
  return (
    <div className="card rise glow-border pass-gate">
      <span className="ic"><Icon name="lock" size={20} /></span>
      <div style={{ flex: 1, minWidth: 220 }}>
        <b>{feature} is part of the Tax Year Pass</b>
        <p className="muted" style={{ fontSize: 14 }}>One payment for tax year {year}, no subscription. Everything else in Shoebox stays free.</p>
      </div>
      <Link to="/app/pass" className="btn btn-gold">See the pass <Icon name="arrowRight" /></Link>
    </div>
  )
}
