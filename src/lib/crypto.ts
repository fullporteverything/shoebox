// WebCrypto helpers. Nothing here is home-made cryptography: PBKDF2 stretches
// the password, AES-256-GCM encrypts and authenticates every record, HKDF and
// HMAC-SHA-256 sign the vault index.
//
// Key layout (envelope encryption):
//   password --PBKDF2--> KEK --AES-GCM--> wrapped DEK (stored)
//   DEK --AES-GCM--> every record          DEK --HKDF--> index MAC key
// Destroying the wrapped DEK makes every record unreadable ("crypto-shredding").

export const PBKDF2_ITERATIONS = 600_000 // OWASP's current floor for PBKDF2-HMAC-SHA256

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('This browser does not support secure encryption (WebCrypto).')
  return globalThis.crypto.subtle
}
const enc = new TextEncoder()
const dec = new TextDecoder()

export type Sealed = { iv: string; ct: string }

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

export function unb64(s: string): Uint8Array {
  const bin = atob(s)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n))
export const randomId = () => b64(randomBytes(12)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!)

export async function deriveKek(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle().importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// One PBKDF2 run gives both the KEK (same bits deriveKek produces, so existing
// vaults still open) and a sign-in proof for the server. The proof goes
// through HKDF, so knowing it reveals nothing about the KEK.
export async function deriveSecrets(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<{ kek: CryptoKey; auth: string }> {
  const base = await subtle().importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, 256))
  const kek = await subtle().importKey('raw', bits as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  const hk = await subtle().importKey('raw', bits as BufferSource, 'HKDF', false, ['deriveBits'])
  bits.fill(0)
  const auth = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('shoebox/v1') as BufferSource, info: enc.encode('server-auth') as BufferSource },
    hk,
    256,
  )
  return { kek, auth: b64(auth) }
}

export type DataKeys = { dek: CryptoKey; mac: CryptoKey }

export async function importDataKeys(raw: Uint8Array): Promise<DataKeys> {
  const dek = await subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  const hk = await subtle().importKey('raw', raw as BufferSource, 'HKDF', false, ['deriveKey'])
  const mac = await subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('shoebox/v1') as BufferSource, info: enc.encode('index-mac') as BufferSource },
    hk,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  )
  return { dek, mac }
}

export async function seal(key: CryptoKey, data: Uint8Array, aad: string): Promise<Sealed> {
  const iv = randomBytes(12)
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource }, key, data as BufferSource)
  return { iv: b64(iv), ct: b64(ct) }
}

// Throws if the ciphertext, IV or associated data were changed in any way.
export async function open(key: CryptoKey, s: Sealed, aad: string): Promise<Uint8Array> {
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv: unb64(s.iv) as BufferSource, additionalData: enc.encode(aad) as BufferSource },
    key,
    unb64(s.ct) as BufferSource,
  )
  return new Uint8Array(pt)
}

export const sealJson = (key: CryptoKey, v: unknown, aad: string) => seal(key, enc.encode(JSON.stringify(v)), aad)
export const openJson = async <T,>(key: CryptoKey, s: Sealed, aad: string): Promise<T> => JSON.parse(dec.decode(await open(key, s, aad)))

export async function sign(key: CryptoKey, msg: string) {
  return b64(await subtle().sign('HMAC', key, enc.encode(msg) as BufferSource))
}

export async function verify(key: CryptoKey, msg: string, sig: string) {
  return subtle().verify('HMAC', key, unb64(sig) as BufferSource, enc.encode(msg) as BufferSource)
}

export async function sha256(s: string) {
  return b64(await subtle().digest('SHA-256', enc.encode(s) as BufferSource))
}

// Rough strength estimate for the sign-up meter. The real defence is PBKDF2
// plus the lockout policy; this just nudges people away from weak choices.
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; hint: string } {
  if (!pw) return { score: 0, label: 'Empty', hint: 'Use at least 12 characters.' }
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/\d/.test(pw)) pool += 10
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33
  let bits = pw.length * Math.log2(Math.max(pool, 1))
  if (/(.)\1{2,}/.test(pw)) bits -= 10
  if (/password|qwerty|12345|letmein|shoebox|tax/i.test(pw)) bits -= 25
  const score = (bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4) as 1 | 2 | 3 | 4
  const label = ['Empty', 'Weak', 'Fair', 'Strong', 'Excellent'][score]
  const hint = pw.length < 12 ? 'Use at least 12 characters.' : score < 3 ? 'Add length or mix in symbols. A short phrase works well.' : 'Good. Store it in a password manager.'
  return { score: pw.length < 12 ? (Math.min(score, 1) as 1) : score, label: pw.length < 12 ? 'Too short' : label, hint }
}
