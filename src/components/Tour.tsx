import React, { useEffect, useLayoutEffect, useState } from 'react'
import { Icon } from './icons.js'
import type { IconName } from './icons.js'

// A four-stop look at the security features. Shown once per browser after
// the first sign-in, skippable at every step, replayable from Security.
const KEY = 'shoebox:tour'
export const TOUR_EVENT = 'shoebox:tour-start'

const steps: { target: string; icon: IconName; title: string; body: string }[] = [
  { target: '[data-tour="vault"]', icon: 'lock', title: 'Encrypted before it’s saved', body: 'Every receipt is locked with a key only your password opens. Lock the vault here any time; it also locks itself when you step away.' },
  { target: '[data-to="/app/security"]', icon: 'shield', title: 'Breach sensors', body: 'They watch for tampering, password guessing and injected code. If one fires, the vault shreds itself: the key is destroyed, so nothing can be read.' },
  { target: '[data-tour="sync"]', icon: 'laptop', title: 'Every device, in one list', body: 'Your vault syncs to the devices you sign in from. Settings shows each one, and you can sign any of them out.' },
  { target: '[data-to="/app/profile"]', icon: 'key', title: 'Add two-factor', body: 'Turn it on in Profile → Settings so a stolen password alone can’t open your vault. It takes a minute.' },
]

const seen = () => {
  try {
    return localStorage.getItem(KEY) === 'done'
  } catch {
    return true
  }
}
const markSeen = () => {
  try {
    localStorage.setItem(KEY, 'done')
  } catch {
    /* storage blocked */
  }
}

export const startTour = () => window.dispatchEvent(new Event(TOUR_EVENT))

type Box = { top: number; left: number; width: number; height: number } | null

export function Tour() {
  const [i, setI] = useState<number | null>(null)
  const [box, setBox] = useState<Box>(null)

  useEffect(() => {
    const start = () => setI(0)
    window.addEventListener(TOUR_EVENT, start)
    const t = seen() ? undefined : setTimeout(start, 1400)
    return () => {
      window.removeEventListener(TOUR_EVENT, start)
      if (t) clearTimeout(t)
    }
  }, [])

  useLayoutEffect(() => {
    if (i === null) return
    const place = () => {
      const el = document.querySelector<HTMLElement>(steps[i].target)
      const r = el?.getBoundingClientRect()
      setBox(r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null)
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [i])

  useEffect(() => {
    if (i === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft' && i > 0) setI(i - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (i === null) return null
  const s = steps[i]
  const close = () => {
    markSeen()
    setI(null)
  }
  const next = () => (i < steps.length - 1 ? setI(i + 1) : close())

  // Beside the target when there's room, else below it, else centered.
  const W = 320
  let pos: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  if (box) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (box.left + box.width + 16 + W < vw) pos = { left: box.left + box.width + 16, top: Math.min(Math.max(12, box.top + box.height / 2 - 90), vh - 220) }
    else pos = { left: Math.min(Math.max(12, box.left), vw - W - 12), top: box.top + box.height + 12 > vh - 220 ? Math.max(12, box.top - 220) : box.top + box.height + 12 }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className={'tour-scrim' + (box ? ' clear' : '')} onClick={close} />
      {box && <div className="tour-ring" style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }} />}
      <div className="tour-card glass-card" style={{ ...pos, width: W }} key={i}>
        <div className="tour-top">
          <span className="tour-ico"><Icon name={s.icon} size={18} /></span>
          <span className="faint" style={{ fontSize: 12 }}>{i + 1} of {steps.length}</span>
        </div>
        <h3 id="tour-title">{s.title}</h3>
        <p className="muted">{s.body}</p>
        <div className="tour-actions">
          <button className="btn btn-ghost btn-sm" onClick={close}>{i < steps.length - 1 ? 'Skip tour' : 'Close'}</button>
          <div style={{ display: 'flex', gap: 6 }}>
            {i > 0 && <button className="btn btn-sm" onClick={() => setI(i - 1)}>Back</button>}
            <button className="btn btn-gold btn-sm" onClick={next} autoFocus>{i < steps.length - 1 ? 'Next' : 'Got it'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
