// Animations play for everyone by default. Anyone who finds motion
// uncomfortable can switch it off (Profile → Settings, or the homepage
// footer); the choice is kept in this browser.
const KEY = 'shoebox:motion'

export function motionReduced(): boolean {
  try {
    return localStorage.getItem(KEY) === 'reduce'
  } catch {
    return false
  }
}

export function setMotionReduced(reduce: boolean) {
  try {
    if (reduce) localStorage.setItem(KEY, 'reduce')
    else localStorage.removeItem(KEY)
  } catch { /* storage blocked: applies until reload */ }
  apply(reduce)
  window.dispatchEvent(new Event('shoebox:motion'))
}

function apply(reduce: boolean) {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = reduce ? 'reduce' : 'full'
}

apply(motionReduced())
