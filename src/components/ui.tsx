import React, { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { navigate } from '../lib/router.js'
import { categoryById } from '../lib/tax/rules.js'
import type { CategoryId } from '../lib/tax/rules.js'
import { useSession } from '../lib/session.js'
import { Icon } from './icons.js'
import { usdOf } from '../lib/tax/advisor.js'
import type { Receipt } from '../lib/types.js'

export const money = (n: number, cents = true) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })

// What a receipt cost in US dollars, or its original currency if no USD figure exists yet.
export const paid = (r: Receipt) => {
  if (r.extraction.currency === 'USD') return money(r.extraction.total)
  const usd = usdOf(r)
  return usd != null ? money(usd) : `${r.extraction.total.toFixed(2)} ${r.extraction.currency}`
}

export function Link({ to, children, className, onClick, ...rest }: { to: string; children: ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a
      {...rest}
      href={'#' + to}
      className={className}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

// Counts up to a value when it changes.
export function CountUp({ value, format = (n: number) => money(n), duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const step = (t: number) => {
      const k = reduce ? 1 : Math.min(1, (t - start) / duration)
      const e = 1 - Math.pow(1 - k, 4)
      setShown(a + (value - a) * e)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <span className="num">{format(shown)}</span>
}

// Money that counts up when it appears or changes.
export function Money({ v, whole }: { v: number; whole?: boolean }) {
  return <CountUp value={v} format={(n) => money(n, !whole)} />
}

export function Count({ v }: { v: number }) {
  return <CountUp value={v} format={(n) => Math.round(n).toLocaleString('en-US')} />
}

// A receipt's paid amount: counts up in USD, or shows the original currency.
export function Paid({ r }: { r: Receipt }) {
  const usd = r.extraction.currency === 'USD' ? r.extraction.total : usdOf(r)
  return usd != null ? <Money v={usd} /> : <span className="num">{`${r.extraction.total.toFixed(2)} ${r.extraction.currency}`}</span>
}

export function CatChip({ id, small }: { id: CategoryId; small?: boolean }) {
  const c = categoryById[id]
  return (
    <span className="chip cat-chip" style={{ ['--h' as string]: c.hue, fontSize: small ? 11.5 : undefined }}>
      <span className="dot" />
      {c.label}
    </span>
  )
}

export function Avatar({ name, hue, size = 34 }: { name: string; hue: number; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
  return (
    <span className="avatar" style={{ width: size, height: size, background: `linear-gradient(150deg, hsl(${hue} 80% 72%), hsl(${(hue + 40) % 360} 70% 52%))`, fontSize: size * 0.4 }}>
      {initials}
    </span>
  )
}

export function Drawer({ title, onClose, children, footer, eyebrow }: { title: ReactNode; eyebrow?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const [closing, setClosing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => {
    setClosing(true)
    setTimeout(onClose, 220)
  }
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <>
      <div className={'scrim' + (closing ? ' closing' : '')} onClick={close} />
      <div className={'drawer' + (closing ? ' closing' : '')} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 style={{ fontSize: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={close} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  )
}

export function Toasts() {
  const { toasts, dismissToast } = useSession()
  const icon = { good: 'check', warn: 'alert', bad: 'alert', info: 'info' } as const
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass-card ${t.tone}`} onClick={() => dismissToast(t.id)} role="status">
          <span className="ic"><Icon name={icon[t.tone]} /></span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Donut({ data, size = 180 }: { data: { label: string; value: number; hue: number }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = size / 2
  const inner = r * 0.62
  let a0 = -Math.PI / 2
  const arcs = total
    ? data.map((d) => {
        const a1 = a0 + (d.value / total) * Math.PI * 2 - 0.012
        const large = a1 - a0 > Math.PI ? 1 : 0
        const p = (rad: number, a: number) => `${r + rad * Math.cos(a)} ${r + rad * Math.sin(a)}`
        const path = `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, a0)} Z`
        a0 = a1 + 0.012
        return { ...d, path }
      })
    : []
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Deductions by category">
      {!total && <circle cx={r} cy={r} r={(r + inner) / 2} fill="none" stroke="var(--glass-border)" strokeWidth={r - inner} />}
      {arcs.map((a) => (
        <path key={a.label} d={a.path} fill={`hsl(${a.hue} 65% 55%)`}>
          <title>{`${a.label}: ${money(a.value)}`}</title>
        </path>
      ))}
    </svg>
  )
}
