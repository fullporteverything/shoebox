import React from 'react'
import type { ReactNode } from 'react'
import { Icon, Logo } from '../components/icons.js'
import { Link, Money } from '../components/ui.js'
import { legalDocs } from '../legal/content.js'
import { RULES_REVIEWED } from '../lib/tax/rules.js'
import { useSession } from '../lib/session.js'
import { ReviewCarousel } from '../components/Reviews.js'
import { FoundingBand } from '../components/Founding.js'
import { SavedCounter } from '../components/SavedCounter.js'

export function PublicFrame({ children }: { children: ReactNode }) {
  const { phase } = useSession()
  return (
    <div className="public">
      <header className="pub-nav glass-card">
        <Link to="/" className="brand" aria-label="Shoebox home">
          <Logo size={30} />
          <span className="brand-name" style={{ display: 'inline' }}>Shoebox</span>
        </Link>
        <nav className="pub-links">
          <Link to="/legal/security" className="plain">Security</Link>
          <Link to="/legal/disclaimer" className="plain">How it sorts</Link>
          {phase === 'unlocked' ? (
            <Link to="/app" className="btn btn-gold btn-sm">Open my vault</Link>
          ) : (
            <>
              <Link to="/signin" className="plain">Sign in</Link>
              <Link to="/signup" className="btn btn-gold btn-sm">Get started</Link>
            </>
          )}
        </nav>
      </header>
      <div className="pub-page">
        {children}
        <footer className="foot">
        <div className="wrap">
          <span>© 2025–{new Date().getFullYear()} Shoebox · Est. 2025. Organizes records, doesn’t give tax advice. Rules reviewed {RULES_REVIEWED}.</span>
          <nav aria-label="Legal">
            {legalDocs.map((d) => (
              <Link key={d.slug} to={`/legal/${d.slug}`}>{d.short}</Link>
            ))}
          </nav>
          </div>
        </footer>
      </div>
    </div>
  )
}

const slips = [
  { name: 'CAFE VERDE', lines: [['Grain bowl', '16.50'], ['Steak frites', '28.00'], ['Tip', '12.10']], total: '84.40', tx: '-130px', rot: '-8deg' },
  { name: 'CLOUDNEST', lines: [['Pro hosting', '24.00'], ['Domain', '18.00'], ['Backups', '6.00']], total: '48.00', tx: '0px', rot: '4deg' },
  { name: 'NORTHLINE FUEL', lines: [['13.4 gal reg', '52.25'], ['Pump 06', ''], ['MC ****0932', '']], total: '52.25', tx: '130px', rot: '9deg' },
]

function Sorter() {
  return (
    <div className="sorter" aria-hidden="true">
      <div className="scanner glass-card"><span className="lbl"><i /> Reading and sorting</span></div>
      {slips.map((s, i) => (
        <div key={s.name} className="slip" style={{ ['--i' as string]: i, ['--tx' as string]: s.tx, ['--rot' as string]: s.rot }}>
          <b>{s.name}</b>
          {s.lines.map(([a, b]) => (
            <div key={a} className="ln"><span>{a}</span><span>{b}</span></div>
          ))}
          <div className="ln tot"><span>TOTAL</span><span>{s.total}</span></div>
        </div>
      ))}
      <div className="scanbar" />
      <div className="bins">
        {[
          { t: 'Meals', s: 'Sch C · 50%', v: 42.2, h: 12 },
          { t: 'Software', s: 'Sch C · line 27a', v: 48, h: 300 },
          { t: 'Car & truck', s: 'Sch C · line 9', v: 52.25, h: 200 },
        ].map((b) => (
          <div key={b.t} className="bin glass-card">
            <div className="bt"><span className="cat-dot" style={{ ['--h' as string]: b.h }} />{b.t}</div>
            <div className="bs">{b.s}</div>
            <div className="bv"><Money v={b.v} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Landing() {
  const words = ['Throw', 'it', 'all', 'in.']
  return (
    <PublicFrame>
      <section className="wrap hero">
        <div>
          <div className="hero-chips rise" style={{ marginBottom: 20 }}>
            <span className="chip gold"><Icon name="sparkle" size={14} /> Federal and all 50 states</span>
            <span className="chip">Est. 2025</span>
          </div>
          <h1>
            {words.map((w, i) => (
              <span key={w} className="word" style={{ ['--i' as string]: i }}>{w}&nbsp;</span>
            ))}
            <br />
            <span className="word ink-gold" style={{ ['--i' as string]: 4 }}>We’ll sort it&nbsp;</span>
            <span className="word ink-gold" style={{ ['--i' as string]: 5 }}>like a pro.</span>
          </h1>
          <p className="lead rise" style={{ animationDelay: '0.45s' }}>
            W-2, side hustle or full-time creator: snap a receipt, drop in a bill or a 1099. Shoebox reads it, files it under the right Schedule C line or
            deduction, applies the limits, and flags what your state does differently.
          </p>
          <div className="hero-cta rise" style={{ animationDelay: '0.55s' }}>
            <Link to="/signup" className="btn btn-gold btn-lg">Start your vault <Icon name="arrowRight" /></Link>
            <Link to="/legal/security" className="btn btn-lg">How it stays private</Link>
          </div>
          <div className="trust rise" style={{ animationDelay: '0.65s' }}>
            <span><Icon name="lock" /> Encrypted on your device</span>
            <span><Icon name="fire" /> Shreds itself if breached</span>
            <span><Icon name="scale" /> You confirm every item</span>
          </div>
          <SavedCounter />
        </div>
        <Sorter />
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div className="eyebrow">How it works</div>
          <h2>Three steps, and none of them is data entry.</h2>
        </div>
        <div className="steps stagger">
          {[
            { n: '01', t: 'Capture', p: 'Photograph a receipt, or drop in a screenshot of an invoice, a bill, a donation letter or a tax form. Photos are shrunk and stripped of location data first.', icon: 'camera' as const },
            { n: '02', t: 'Sort', p: 'AI reads the merchant, date and amounts. Then a rules engine applies IRS limits, such as 50% on meals and $25 per gift, and adds your state’s quirks.', icon: 'sparkle' as const },
            { n: '03', t: 'Confirm', p: 'You see why each item landed where it did, adjust the business share, and confirm. Your tax map fills in as you go.', icon: 'check' as const },
          ].map((s, i) => (
            <div key={s.n} className="card step lift" style={{ ['--i' as string]: i }}>
              <div className="n">{s.n}</div>
              <h3>{s.t}</h3>
              <p>{s.p}</p>
              <div className="ill">
                <span style={{ width: 56, height: 56, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'var(--gold-soft)', color: 'var(--gold-ink)' }}>
                  <Icon name={s.icon} size={28} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <ReviewCarousel />

      <FoundingBand />

      <section className="wrap section" style={{ paddingTop: 10 }}>
        <div className="card sec-band glow-border">
          <div>
            <div className="eyebrow">Security</div>
            <h2 style={{ fontSize: 'clamp(28px,3.6vw,40px)', marginTop: 10 }}>If something’s wrong, your data is gone before anyone can read it.</h2>
            <p className="muted" style={{ marginTop: 14 }}>
              Shoebox encrypts everything with a key only your password unlocks. Breach sensors watch for tampering, password guessing and injected code. If they
              fire, the vault crypto-shreds: the key is destroyed and every record with it.
            </p>
            <Link to="/legal/security" className="btn" style={{ marginTop: 20 }}>Read the security policy</Link>
          </div>
          <div className="sec-list stagger">
            {[
              { i: 'key' as const, t: 'AES-256 per record', p: 'Sealed and signed. Change one byte and it won’t open.' },
              { i: 'fingerprint' as const, t: 'Five breach sensors', p: 'Integrity, guessing, injection, new device and idle.' },
              { i: 'fire' as const, t: 'Crypto-shredding', p: 'Destroying the key makes every copy of the data unreadable.' },
              { i: 'eye' as const, t: 'Zero knowledge', p: 'We never receive your password or your key.' },
            ].map((x, i) => (
              <div key={x.t} className="sec-item" style={{ ['--i' as string]: i }}>
                <span className="ic"><Icon name={x.i} /></span>
                <div>
                  <h4>{x.t}</h4>
                  <p>{x.p}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicFrame>
  )
}
