import { cloudEnabled } from '../lib/cloud.js'
import React, { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSession } from '../lib/session.js'
import { Icon, Logo } from './icons.js'
import type { IconName } from './icons.js'
import { Avatar, Link } from './ui.js'

const items: { to: string; label: string; icon: IconName }[] = [
  { to: '/app', label: 'Overview', icon: 'overview' },
  { to: '/app/savings', label: 'Savings', icon: 'sparkle' },
  { to: '/app/inbox', label: 'Inbox', icon: 'inbox' },
  { to: '/app/receipts', label: 'Receipts', icon: 'receipts' },
  { to: '/app/tax', label: 'Tax map', icon: 'map' },
  { to: '/app/filing', label: 'Filing pack', icon: 'doc' },
  { to: '/app/security', label: 'Security', icon: 'shield' },
  { to: '/app/profile', label: 'Profile', icon: 'user' },
]

export function Shell({ route, children }: { route: string; children: ReactNode }) {
  const { profile, receipts, lock } = useSession()
  const navRef = useRef<HTMLElement>(null)
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null)
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
            <Link key={i.to} to={i.to} data-to={i.to} aria-current={active === i.to ? 'page' : undefined} title={i.label}>
              <Icon name={i.icon} />
              <span>{i.label}</span>
              {i.to === '/app/inbox' && review > 0 && <span className="count">{review}</span>}
            </Link>
          ))}
        </nav>
        <div className="dock-foot">
          <button className="vault-status" style={{ border: 0, cursor: 'pointer' }} onClick={() => lock('Locked by you.')} title="Lock the vault now">
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
      <main className="main" id="main">
        {children}
      </main>
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
    <Link to="/app/profile/settings" className="sync-line ok"><Icon name="check" size={13} /> Synced across your devices</Link>
  ) : (
    <Link to="/app/profile/settings" className="sync-line warn"><Icon name="alert" size={13} /> Only on this device · Link it</Link>
  )
}
