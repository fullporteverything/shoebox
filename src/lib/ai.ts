// Picks how a document gets read:
//   claude  - inside the claude.ai preview, Claude reads it on the viewer's account
//   server  - the deployed app's /api/analyze function (needs ANTHROPIC_API_KEY)
//   manual  - nothing available: the person types the key fields, rules still apply

import { extractionPrompt, normalizeExtraction } from './prompt.js'
import type { Extraction, Profile } from './types.js'

export type EngineKind = 'claude' | 'server' | 'manual'
export type Engine = { kind: EngineKind; label: string; detail: string }

type SampleFn = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>) & {
  json: (input: string, opts?: Record<string, unknown>) => Promise<unknown>
  limits: () => Promise<{ images?: { maxCount: number; mediaTypes: string[] } }>
}

let samplePromise: Promise<SampleFn | null> | null = null
function getSample(): Promise<SampleFn | null> {
  if (!samplePromise) {
    const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude
    samplePromise = c?.use ? (c.use('sample') as Promise<SampleFn | null>).catch(() => null) : Promise.resolve(null)
  }
  return samplePromise
}

let enginePromise: Promise<Engine> | null = null
export function detectEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async (): Promise<Engine> => {
      const sample = await getSample()
      if (sample) {
        const limits = await sample.limits().catch(() => null)
        if (limits?.images) return { kind: 'claude', label: 'Claude', detail: 'Claude reads each document on your Claude account. You’ll be asked once to allow it.' }
      }
      if (!__ARTIFACT__) {
        try {
          const r = await fetch('/api/analyze', { method: 'GET' })
          const j = r.ok ? await r.json() : null
          if (j?.configured) return { kind: 'server', label: 'Claude', detail: 'Documents go to our server over TLS, Claude reads them, and nothing is kept there.' }
        } catch {
          /* no server function */
        }
      }
      return { kind: 'manual', label: 'Rules only', detail: 'AI reading isn’t available here, so you enter the amount and merchant and the rules engine sorts it.' }
    })()
  }
  return enginePromise
}

export class AnalyzeError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

const sampleErrorCopy: Record<string, string> = {
  not_granted: 'Claude wasn’t allowed for this page. You can still enter details by hand.',
  sampling_disabled: 'Claude isn’t available on this account. You can still enter details by hand.',
  rate_limited: 'Claude is busy or you’ve hit a usage limit. Wait a minute and try again.',
  image_rejected: 'That image couldn’t be read. Try a JPEG or PNG under 20 MB.',
  refused: 'Claude declined to read this one. Enter the details by hand.',
  invalid_json: 'Claude’s answer came back garbled. Try again.',
}

export async function analyze(image: Blob, profile: Profile, signal?: AbortSignal): Promise<Extraction> {
  const engine = await detectEngine()
  if (engine.kind === 'claude') {
    const sample = (await getSample())!
    try {
      const raw = await sample.json(extractionPrompt(profile, true), { images: [image], modelTier: 'default', signal })
      return normalizeExtraction(raw)
    } catch (e) {
      const code = (e as { code?: string })?.code ?? 'upstream_error'
      throw new AnalyzeError(code, sampleErrorCopy[code] ?? 'Claude couldn’t read this right now. Try again, or enter the details by hand.')
    }
  }
  if (engine.kind === 'server') {
    const body = new FormData()
    body.append('file', image, 'document.jpg')
    body.append('profile', JSON.stringify({ state: profile.state, workType: profile.workType, businessName: profile.businessName, taxYear: profile.taxYear }))
    const r = await fetch('/api/analyze', { method: 'POST', body, signal })
    const j = await r.json().catch(() => null)
    if (!r.ok) throw new AnalyzeError(j?.error ?? 'server_error', j?.message ?? 'The server couldn’t read this document. Try again.')
    return normalizeExtraction(j.extraction)
  }
  throw new AnalyzeError('manual', 'AI reading isn’t available. Enter the details by hand.')
}
