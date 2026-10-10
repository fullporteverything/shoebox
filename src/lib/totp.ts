// Time-based one-time passwords (RFC 6238 over RFC 4226), the codes authenticator
// apps show. HMAC-SHA1, 30-second steps, 6 digits: what every app supports.

import { randomBytes, sha256 } from './crypto.js'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const STEP = 30

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export const newSecret = () => base32Encode(randomBytes(20))

export async function hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string> {
  const msg = new Uint8Array(8)
  let c = counter
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff
    c = Math.floor(c / 256)
  }
  const key = await crypto.subtle.importKey('raw', secret as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg as BufferSource))
  const off = mac[mac.length - 1] & 0x0f
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP)

// Accepts the current step and one either side for clock drift. Returns the
// matching step so the caller can refuse a code that was already used.
export async function verifyTotp(secretB32: string, code: string, lastStep: number, now = Date.now()): Promise<number | null> {
  const c = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(c)) return null
  const secret = base32Decode(secretB32)
  const step = stepAt(now)
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastStep) continue
    if ((await hotp(secret, s)) === c) return s
  }
  return null
}

export function otpauthUri(secretB32: string, account: string, issuer = 'Shoebox') {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`
}

// Ten one-time recovery codes. Only their hashes are kept.
export async function newRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = Array.from({ length: 10 }, () => {
    const s = base32Encode(randomBytes(5)).toLowerCase().slice(0, 8)
    return `${s.slice(0, 4)}-${s.slice(4)}`
  })
  return { codes, hashes: await Promise.all(codes.map((c) => sha256(c))) }
}

export const normalizeRecovery = (c: string) => {
  const s = c.toLowerCase().replace(/[^a-z2-7]/g, '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : null
}

export type TwoFactor = { enabled: boolean; secret: string; lastStep: number; recovery: string[]; enabledAt: number }
