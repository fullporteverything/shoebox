import { cloudEnabled } from '../lib/cloud.js'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSession } from '../lib/session.js'
import { Icon, Logo } from './icons.js'
import type { IconName } from './icons.js'
import { Avatar, Link } from './ui.js'
import { Tour } from './Tour.js'

// On phones only the `phone` items sit in the bottom bar; the rest live under More.
const items: { to: string; label: string; short?: string; icon: IconName; phone?: boolean }[] = [
  { to: '/app', label: 'Overview', icon: 'overview', phone: true },
  { to: '/app/savings', label: 'Savings', icon: 'sparkle', phone: true },
  { to: '/app/inbox', label: 'Inbox', icon: 'inbox', phone: true },
  { to: '/app/receipts', label: 'Receipts', icon: 'receipts' },
  { to: '/app/tax', label: 'Tax map', icon: 'map' },
  { to: '/app/filing', label: 'Filing pack', short: 'Filing', icon: 'doc', phone: true },
  { to: '/app/security', label: 'Security', icon: 'shield' },
  { to: '/app/profile', label: 'Profile', icon: 'user' },
]

export function Shell({ route, children }: { route: string; children: ReactNode }) {
  const { profile, receipts, lock } = useSession()
  const navRef = useRef<HTMLElement>(null)
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null)
  const [more, setMore] = useState(false)
  const active = items.slice().reverse().find((i) => route === i.to || route.startsWith(i.to + '/'))?.to ?? '/app'
  const review = receipts.filter((r) => r.status === 'needs_review').length

  // Slide the highlight to the active item.
  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>(`a[data-to="${active}"]`)
      if (el) setPill({ y: el.offsetTop, h: el.offsetHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])

  return (
    <div className="app">
      <aside className="dock glass-card" aria-label="Main">
        <Link to="/app" className="brand">
          <Logo />
          <span className="brand-name">Shoebox</span>
        </Link>
        <nav className="nav" ref={navRef}>
          {pill && <span className="nav-pill" style={{ transform: `translateY(${pill.y}px)`, height: pill.h }} />}
          {items.map((i) => (
            <Link key={i.to} to={i.to} data-to={i.to} className={i.phone ? undefined : 'phone-hide'} aria-current={active === i.to ? 'page' : undefined} title={i.label}>
              <Icon name={i.icon} />
              <span>{i.short ? <><span className="lbl-long">{i.label}</span><span className="lbl-short">{i.short}</span></> : i.label}</span>
              {i.to === '/app/inbox' && review > 0 && <span className="count">{review}</span>}
            </Link>
          ))}
          <button type="button" className="nav-more" aria-haspopup="dialog" aria-expanded={more} aria-current={items.some((i) => !i.phone && i.to === active) ? 'page' : undefined} onClick={() => setMore(true)}>
            <Icon name="grid" />
            <span>More</span>
          </button>
        </nav>
        <div className="dock-foot">
          <button className="vault-status" data-tour="vault" style={{ border: 0, cursor: 'pointer' }} onClick={() => lock('Locked by you.')} title="Lock the vault now">
            <i className="pulse" />
            <span>Vault encrypted · Lock now</span>
          </button>
          <SyncLine />
          {profile && (
            <Link to="/app/profile" className="me">
              <Avatar name={profile.name} hue={profile.avatarHue} />
              <div>
                {profile.name}
                <small>{profile.email}</small>
              </div>
            </Link>
          )}
        </div>
      </aside>
      {more && <MoreSheet active={active} onClose={() => setMore(false)} />}
      <main className="main" id="main">
        {children}
      </main>
      <Tour />
    </div>
  )
}

export function PageTitle({ title, sub, actions, eyebrow }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="topline rise">
      <div className="page-title">
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="top-actions">{actions}</div>}
    </div>
  )
}

// Whether this vault reaches other devices, at a glance.
function SyncLine() {
  const { cloudLinked } = useSession()
  if (!cloudEnabled) return null
  return cloudLinked ? (
    <Link to="/app/profile/settings" className="sync-line ok" data-tour="sync"><Icon name="check" size={13} /> Synced across your devices</Link>
  ) : (
    <Link to="/app/profile/settings" className="sync-line warn" data-tour="sync"><Icon name="alert" size={13} /> Only on this device · Link it</Link>
  )
}

// Phone-only sheet for the pages that don't fit in the bottom bar, plus the
// lock button and sync status that the desktop sidebar shows.
function MoreSheet({ active, onClose }: { active: string; onClose: () => void }) {
  const { lock, profile } = useSession()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="More">
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet-panel glass-card">
        <div className="sheet-grip" aria-hidden="true" />
        {profile && (
          <Link to="/app/profile" className="sheet-me" onClick={onClose}>
            <Avatar name={profile.name} hue={profile.avatarHue} />
            <div>{profile.name}<small>{profile.email}</small></div>
          </Link>
        )}
        <div className="sheet-grid">
          {items.filter((i) => !i.phone).map((i) => (
            <Link key={i.to} to={i.to} className="sheet-item" aria-current={active === i.to ? 'page' : undefined} onClick={onClose}>
              <Icon name={i.icon} />
              <span>{i.label}</span>
            </Link>
          ))}
        </div>
        <SyncLine />
        <button className="btn sheet-lock" onClick={() => { onClose(); lock('Locked by you.') }}><Icon name="lock" /> Lock vault now</button>
      </div>
    </div>
  )
}
