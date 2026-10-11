import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

// Hash router with View Transitions. Routes look like "/app/inbox".

const read = () => {
  const h = location.hash.replace(/^#/, '')
  return h.startsWith('/') ? h : '/'
}

let current = read()
const listeners = new Set<(r: string) => void>()

function set(r: string) {
  current = r
  listeners.forEach((l) => l(r))
}

window.addEventListener('hashchange', () => {
  const r = read()
  if (r !== current) set(r)
})

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === current) return
  const apply = () => {
    try {
      if (opts.replace) history.replaceState(null, '', '#' + to)
      else history.pushState(null, '', '#' + to)
    } catch {
      /* some frames refuse history changes; the in-memory route still moves */
    }
    set(to)
    window.scrollTo({ top: 0 })
  }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (doc.startViewTransition && !reduced()) doc.startViewTransition(() => flushSync(apply))
  else apply()
}

export function useRoute() {
  const [r, setR] = useState(current)
  useEffect(() => {
    listeners.add(setR)
    setR(current)
    return () => void listeners.delete(setR)
  }, [])
  return r
}

export const supportsViewTransitions = () => 'startViewTransition' in document

// Where to land after signing in: the app page that was asked for (a link
// back from Stripe, say), or the overview.
export const afterSignIn = () => (current.startsWith('/app') ? current : '/app')

// The ?a=b part of a route like /app/pass?paid=cs_123.
export const routeParams = (route: string) => new URLSearchParams(route.split('?')[1] ?? '')
