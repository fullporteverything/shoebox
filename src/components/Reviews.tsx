import React, { useEffect, useRef, useState } from 'react'
import { cloud, cloudEnabled } from '../lib/cloud.js'
import type { MyReview, ReviewSummary } from '../lib/cloud.js'
import { useSession } from '../lib/session.js'
import { Icon } from './icons.js'
import { Select } from './Select.js'

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="stars" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={n <= Math.round(value) ? 'on' : ''}>
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
      ))}
    </span>
  )
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Approved reviews only, newest first, with the average over every approved
// review. Renders nothing until there's at least one real review.
export function ReviewCarousel() {
  const [data, setData] = useState<ReviewSummary | null>(null)
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (!cloudEnabled) return
    cloud.reviews().then(setData).catch(() => undefined)
  }, [])
  const n = data?.reviews.length ?? 0
  useEffect(() => {
    if (n < 2 || paused || reducedMotion()) return
    const t = setInterval(() => setI((x) => (x + 1) % n), 6500)
    return () => clearInterval(t)
  }, [n, paused])
  if (!data || !n) return null
  const r = data.reviews[i % n]
  return (
    <section className="wrap section" aria-labelledby="reviews-h">
      <div className="section-head">
        <div className="eyebrow">From people using it</div>
        <h2 id="reviews-h">What Shoebox users say</h2>
        <p className="muted reviews-sum">
          <Stars value={data.average ?? 0} /> {data.average?.toFixed(1)} average from {data.count} review{data.count === 1 ? '' : 's'}
        </p>
      </div>
      <div className="review-stage card glow-border" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
        <figure className="review" key={i} aria-live="polite">
          <Stars value={r.rating} size={18} />
          <blockquote>“{r.body}”</blockquote>
          <figcaption>
            <b>{r.name}</b>
            {r.role && <span> · {r.role}</span>}
            <span className="faint"> · {r.month}</span>
          </figcaption>
        </figure>
        {n > 1 && (
          <div className="review-nav">
            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Previous review" onClick={() => setI((x) => (x - 1 + n) % n)}>
              <Icon name="arrowRight" className="flip" />
            </button>
            <div className="review-dots" role="tablist" aria-label="Choose a review">
              {data.reviews.slice(0, 12).map((_, k) => (
                <button key={k} role="tab" aria-selected={k === i % n} aria-label={`Review ${k + 1}`} className={k === i % n ? 'on' : ''} onClick={() => setI(k)} />
              ))}
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Next review" onClick={() => setI((x) => (x + 1) % n)}>
              <Icon name="arrowRight" />
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

const roles = ['Creator', 'Self-employed', 'Freelancer', 'Small business', 'Side hustle', 'W-2 employee', 'Other'].map((r) => ({ value: r, label: r }))

const shortName = (full: string) => {
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] ?? ''
}

export function ReviewCard() {
  const { cloudLinked, myReview, submitReview, profile, toast } = useSession()
  const [mine, setMine] = useState<MyReview | undefined>(undefined)
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const [name, setName] = useState(shortName(profile?.name ?? ''))
  const [role, setRole] = useState(profile?.workType === 'w2' ? 'W-2 employee' : 'Self-employed')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (!cloudLinked || loaded.current) return
    loaded.current = true
    myReview()
      .then((r) => {
        setMine(r)
        if (r) {
          setRating(r.rating)
          setBody(r.body)
          setName(r.display_name)
          setRole(r.role || 'Other')
        }
      })
      .catch(() => setMine(null))
  }, [cloudLinked, myReview])

  if (!cloudLinked) return null
  const showForm = mine === null || editing
  const valid = rating > 0 && body.trim().length >= 20 && body.trim().length <= 600 && name.trim().length > 0

  return (
    <div className="card rise" style={{ animationDelay: '0.06s' }}>
      <div className="card-head">
        <h2>Your review</h2>
        {mine && !editing && (
          <span className={'chip ' + (mine.status === 'approved' ? 'good' : mine.status === 'rejected' ? 'bad' : 'warn')}>
            <span className="dot" /> {mine.status === 'approved' ? 'Published' : mine.status === 'rejected' ? 'Not published' : 'Waiting for review'}
          </span>
        )}
      </div>
      {mine === undefined ? (
        <p className="faint">Loading…</p>
      ) : !showForm ? (
        <>
          <Stars value={mine!.rating} />
          <p style={{ marginTop: 8 }}>“{mine!.body}”</p>
          <p className="faint" style={{ fontSize: 13, marginTop: 6 }}>Shown as {mine!.display_name}{mine!.role ? ` · ${mine!.role}` : ''}</p>
          {mine!.status === 'rejected' && <p className="hint" style={{ marginTop: 8 }}>It wasn’t published, usually because it included personal details or wasn’t about Shoebox. You can edit and resubmit.</p>}
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setEditing(true)}><Icon name="edit" /> Edit review</button>
        </>
      ) : (
        <form
          className="stack"
          style={{ gap: 14 }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (!valid) return
            setBusy(true)
            try {
              if (await submitReview({ rating, body: body.trim(), name: name.trim(), role })) {
                setMine({ rating, body: body.trim(), display_name: name.trim(), role, status: 'pending' })
                setEditing(false)
                toast('good', 'Thanks. Your review shows on the homepage once it’s been checked.')
              } else toast('bad', 'That review couldn’t be saved. Check the length and try again.')
            } catch {
              toast('bad', 'Couldn’t reach the server. Try again in a moment.')
            }
            setBusy(false)
          }}
        >
          <p className="muted" style={{ fontSize: 14 }}>Tell other people what Shoebox is actually like, good or bad. Every honest review is welcome.</p>
          <div className="field">
            <span className="label" id="rv-rating">Rating</span>
            <div className="star-pick" role="radiogroup" aria-labelledby="rv-rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)}>
                  <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="rv-body">Review</label>
            <textarea id="rv-body" className="input" rows={4} maxLength={600} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did it help with? What’s missing?" />
            <span className="hint">{body.trim().length < 20 ? `At least 20 characters (${body.trim().length}/20)` : `${body.trim().length}/600`}. Please leave out amounts, account numbers and anything private.</span>
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="rv-name">Shown as</label>
              <input id="rv-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rv-role">You are</label>
              <Select id="rv-role" value={role} onChange={setRole} options={roles} />
            </div>
          </div>
          <p className="hint">Reviews are public once approved. We only turn down spam, abuse or reviews with personal details, never a review for its rating. Your email is never shown.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            {editing && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
            <button className="btn btn-gold" disabled={!valid || busy}>{busy ? 'Sending…' : mine ? 'Resubmit review' : 'Submit review'}</button>
          </div>
        </form>
      )}
    </div>
  )
}

export { Stars }

// Overview: one gentle ask, once there's been enough use to have an opinion.
// Dismissing it is remembered in this browser; it never comes back after a
// review is written.
const NUDGE_KEY = 'shoebox:review-nudge'
export function ReviewNudge({ receiptCount }: { receiptCount: number }) {
  const { cloudLinked } = useSession()
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(NUDGE_KEY) === 'done'
    } catch {
      return false
    }
  })
  if (hidden || !cloudLinked || receiptCount < 5) return null
  const close = () => {
    try {
      localStorage.setItem(NUDGE_KEY, 'done')
    } catch {
      /* storage blocked */
    }
    setHidden(true)
  }
  return (
    <div className="card nudge rise" role="note">
      <Icon name="sparkle" size={20} />
      <div style={{ flex: 1 }}>
        <b>How’s Shoebox working for you?</b>
        <div className="muted" style={{ fontSize: 14 }}>An honest review, good or bad, helps other people decide and tells us what to fix.</div>
      </div>
      <a className="btn btn-sm btn-gold" href="#/app/profile" onClick={close}>Leave a review</a>
      <button className="btn btn-sm btn-ghost btn-icon" aria-label="Not now" onClick={close}><Icon name="x" /></button>
    </div>
  )
}
