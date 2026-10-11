// Cloud copy of the vault, so an account opens on any device. The server is a
// Supabase project that stores exactly the ciphertext this browser stores and
// enforces sign-in lockouts. It never receives a password, a data key or a
// decrypted record: sign-in proves the password with a separate key derived
// from it (see crypto.deriveSecrets), and every record arrives already sealed.
//
// All calls go to public.shoebox_* database functions; the tables themselves
// are in a private schema the API doesn't expose. See
// supabase/migrations/20261011000000_shoebox_sync.sql.

import type { Sealed } from './crypto.js'

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
// The publishable key is meant to ship in browser code; access is enforced by
// the database functions, not by keeping it secret.
const URL_ = env.VITE_SUPABASE_URL ?? 'https://ovxykjbnpozndcgxkqwg.supabase.co'
const KEY = env.VITE_SUPABASE_KEY ?? 'sb_publishable_fPRIF6--vbM43dtVTDI21g_Pussn_NV'

// Off in the claude.ai preview build, which can't reach outside hosts.
export const cloudEnabled = !!URL_ && !!KEY && env.VITE_CLOUD !== 'off' && typeof fetch !== 'undefined' && !(typeof __ARTIFACT__ !== 'undefined' && __ARTIFACT__)

export class CloudError extends Error {
  constructor(public code: 'offline' | 'session_ended' | 'server', message: string) {
    super(message)
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(20_000) : undefined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    throw new CloudError('offline', 'Couldn’t reach the Shoebox server.')
  }
  const text = await res.text()
  if (!res.ok) {
    if (text.includes('session_ended')) throw new CloudError('session_ended', 'This device was signed out.')
    throw new CloudError('server', `The Shoebox server returned an error (${res.status}).`)
  }
  return (text ? JSON.parse(text) : null) as T
}

export type RemoteRow = { id: string; kind: string; sealed: Sealed; h: string }
export type RemoteVault = {
  user_id: string; email: string; created_at: number; salt: string; iterations: number; wrapped: Sealed
  index_mac: string; rev: number; policy: unknown; terms: { version: string; at: number }; records: RemoteRow[]
}
export type Grant = { token: string; device_id: string; new_device: boolean }
export type Failure = { error: 'bad_password' | 'bad_code'; failed: number; code_failed: number; wipe_after: number; until: number | null }
export type ShreddedInfo = { error: 'shredded'; incident: { at: number; sensor: string; detail: string; destroyed: string[] } | null }
type LoginOk = Grant & { vault: RemoteVault; step?: number | null }
export type LoginResult =
  | LoginOk
  | { two_factor: true; ticket: string }
  | Failure
  | ShreddedInfo
  | { error: 'no_account' | 'expired' | 'invalid' }
  | { error: 'locked'; until: number }

export type Prelogin =
  | { exists: false }
  | { exists: true; user_id: string; salt: string; iterations: number; shredded: boolean; incident: ShreddedInfo['incident'] }

export type Device = {
  id: string; label: string; ua: string; tz: string
  created_at: number; last_sign_in: number; last_seen: number; current: boolean; active: boolean
}

export type Enrollment = {
  email: string; user_id: string; created_at: number; salt: string; iterations: number; wrapped: Sealed; auth: string
  index_mac: string; policy: unknown; terms: unknown; records: RemoteRow[]
  totp_secret?: string; totp_last_step?: number; recovery?: string[]
}

export type Pull =
  | { rev: number; policy: unknown; index?: undefined }
  | { rev: number; policy: unknown; index_mac: string; index: Record<string, string>; changed: RemoteRow[] }

export const isOk = (r: LoginResult): r is LoginOk => 'token' in r

export type PublicReview = { rating: number; body: string; name: string; role: string; month: string }
export type ReviewSummary = { count: number; average: number | null; reviews: PublicReview[] }
export type MyReview = { rating: number; body: string; display_name: string; role: string; status: 'pending' | 'approved' | 'rejected' } | null
export type Membership = { joined_at: number; founding: boolean; number: number | null; closes_at: number }

// The founding-member window. Mirrors the cutoff in the reviews/founders migration.
export const FOUNDING_CLOSES = Date.UTC(2027, 0, 1)
export const PASS_PRICE = 59
export const FOUNDING_PRICE = 39

// This browser's entry in the account's device list. The id is assigned by the
// server at first sign-in and remembered here so the list doesn't grow a new
// row every time.
const DEVICE_KEY = 'shoebox:device'
const readDeviceId = () => {
  try {
    return localStorage.getItem(DEVICE_KEY) ?? ''
  } catch {
    return ''
  }
}
export const rememberDevice = (id: string) => {
  try {
    localStorage.setItem(DEVICE_KEY, id)
  } catch {
    /* storage blocked */
  }
}

export function describeDevice(ua: string): string {
  const browser =
    /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
      : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os =
    /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
      : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'unknown system'
  return `${browser} on ${os}`
}

export const thisDevice = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  return { id: readDeviceId(), label: describeDevice(ua), ua, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }
}

export const cloud = {
  prelogin: (email: string) => rpc<Prelogin>('shoebox_prelogin', { p_email: email }),
  login: (email: string, auth: string) => rpc<LoginResult>('shoebox_login', { p_email: email, p_auth: auth, p_device: thisDevice() }),
  login2fa: (ticket: string, code: string, recovery: boolean) =>
    rpc<LoginResult>('shoebox_login_2fa', { p_ticket: ticket, p_code: code, p_recovery: recovery }),
  enroll: (e: Enrollment) => rpc<(Grant & { rev: number }) | { error: 'exists' | 'invalid' }>('shoebox_enroll', { p: e, p_device: thisDevice() }),
  pull: (token: string, rev: number) => rpc<Pull>('shoebox_pull', { p_token: token, p_rev: rev }),
  commit: (token: string, base: number, puts: RemoteRow[], dels: string[], indexMac: string) =>
    rpc<{ rev: number } | { error: 'conflict'; rev: number } | { error: 'shredded' }>('shoebox_commit', {
      p_token: token, p_base: base, p_puts: puts, p_dels: dels, p_index_mac: indexMac,
    }),
  setPolicy: (token: string, policy: unknown) => rpc<null>('shoebox_set_policy', { p_token: token, p_policy: policy }),
  setTwoFactor: (token: string, secret: string, lastStep: number, recovery: string[]) =>
    rpc<null>('shoebox_set_2fa', { p_token: token, p_secret: secret, p_last_step: lastStep, p_recovery: recovery }),
  changePassword: (token: string, oldAuth: string, salt: string, iterations: number, wrapped: Sealed, newAuth: string) =>
    rpc<{ error?: 'bad_password' | 'invalid' }>('shoebox_change_password', {
      p_token: token, p_old_auth: oldAuth, p_salt: salt, p_iterations: iterations, p_wrapped: wrapped, p_new_auth: newAuth,
    }),
  shred: (token: string, incident: unknown) => rpc<unknown>('shoebox_shred', { p_token: token, p_incident: incident }),
  remove: (token: string) => rpc<null>('shoebox_delete', { p_token: token }),
  devices: (token: string) => rpc<Device[]>('shoebox_devices', { p_token: token }),
  reviews: () => rpc<ReviewSummary>('shoebox_reviews', {}),
  myReview: (token: string) => rpc<MyReview>('shoebox_my_review', { p_token: token }),
  submitReview: (token: string, r: { rating: number; body: string; name: string; role: string }) =>
    rpc<{ status: 'pending' } | { error: 'invalid' }>('shoebox_submit_review', { p_token: token, p_rating: r.rating, p_body: r.body, p_name: r.name, p_role: r.role }),
  reportSavings: (token: string, year: number, amount: number) => rpc<null>('shoebox_report_savings', { p_token: token, p_year: year, p_amount: Math.round(amount) }),
  savingsTotal: () => rpc<{ total: number; people: number }>('shoebox_savings_total', {}),
  membership: (token: string) => rpc<Membership>('shoebox_membership', { p_token: token }),
  signOut: (token: string, opts: { device?: string; others?: boolean } = {}) =>
    rpc<{ signed_out: number }>('shoebox_sign_out', { p_token: token, p_device: opts.device ?? null, p_others: !!opts.others }),
}
