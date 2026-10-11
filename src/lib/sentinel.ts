// Breach sensors. Each one watches for a specific sign of compromise and
// reports it with a severity; the session layer turns severities into actions:
//
//   alert    -> log it and tell the person
//   lock     -> drop the keys from memory and ask for the password again
//   shred    -> crypto-shred the vault (see vault.shred)
//
// These sensors see what this browser sees. Sign-in lockouts, two-factor and
// remote sign-out are enforced by the server (supabase/migrations); a shred
// here also shreds the server copy. docs/SECURITY.md has the full model.

export type Severity = 'alert' | 'lock' | 'shred'

export type SensorId = 'integrity' | 'bruteforce' | 'injection' | 'fingerprint' | 'idle' | 'crosstab'

export const sensors: { id: SensorId; name: string; watches: string; action: (strict: boolean) => Severity | 'policy' }[] = [
  { id: 'integrity', name: 'Vault integrity', watches: 'Every record is sealed with AES-GCM and the index is signed. A canary record must decrypt to a known value. Any edit, swap or deletion outside the app trips it, checked at unlock and every 45 seconds.', action: () => 'shred' },
  { id: 'bruteforce', name: 'Password guessing', watches: 'Wrong passwords trigger lockouts that grow each time, enforced by the server. If the right password is followed by wrong two-factor codes past your wipe limit, the vault shreds itself everywhere.', action: () => 'policy' },
  { id: 'injection', name: 'Code injection', watches: 'Watches the page for scripts, frames or embeds added after it loads, such as from a malicious extension or an injected script.', action: (strict) => (strict ? 'shred' : __ARTIFACT__ ? 'alert' : 'lock') },
  { id: 'fingerprint', name: 'New device signature', watches: 'Flags the first sign-in from a new device, and a change of browser or time zone since your last unlock, so you can tell if it wasn’t you. Every device is listed in Profile → Settings.', action: () => 'alert' },
  { id: 'idle', name: 'Idle lock', watches: 'Forgets the keys after a period with no activity, so an unattended screen can’t be read.', action: () => 'lock' },
  { id: 'crosstab', name: 'Tab sync', watches: 'If any open tab locks or shreds, every other tab follows at once.', action: () => 'lock' },
]

export type Trip = { sensor: SensorId; severity: Severity; detail: string }

// Watches the DOM for code that wasn't there when the app booted.
export function watchInjection(onTrip: (detail: string) => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  const suspicious = (n: Node): string | null => {
    if (!(n instanceof Element)) return null
    const tag = n.tagName.toLowerCase()
    if (tag === 'script' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
      const src = n.getAttribute('src') || n.getAttribute('data') || 'inline'
      return `A <${tag}> element (${src.slice(0, 80)}) was added to the page after it loaded.`
    }
    for (const attr of Array.from(n.attributes)) {
      if (/^on/i.test(attr.name) && !n.hasAttribute('data-sb')) return `An inline "${attr.name}" handler was injected on a <${tag}> element.`
    }
    return null
  }
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of Array.from(m.addedNodes)) {
        const hit = suspicious(n) ?? (n instanceof Element ? Array.from(n.querySelectorAll('script,iframe,object,embed')).map(suspicious).find(Boolean) ?? null : null)
        if (hit) return onTrip(hit)
      }
    }
  })
  obs.observe(document.documentElement, { childList: true, subtree: true })
  return () => obs.disconnect()
}

export function watchIdle(minutes: number, onIdle: () => void): () => void {
  let t = 0
  const reset = () => {
    clearTimeout(t)
    t = window.setTimeout(onIdle, minutes * 60_000)
  }
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart']
  events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
  reset()
  return () => {
    clearTimeout(t)
    events.forEach((e) => window.removeEventListener(e, reset))
  }
}

type TabMessage = { type: 'lock' | 'shred'; email: string; from: string }
const tabId = Math.random().toString(36).slice(2)

export function tabChannel(onMessage: (m: TabMessage) => void) {
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel('shoebox-sentinel')
    ch.onmessage = (e: MessageEvent<TabMessage>) => e.data?.from !== tabId && onMessage(e.data)
  } catch {
    /* BroadcastChannel unavailable: tabs simply don't sync */
  }
  return {
    send: (type: TabMessage['type'], email: string) => ch?.postMessage({ type, email, from: tabId }),
    close: () => ch?.close(),
  }
}
