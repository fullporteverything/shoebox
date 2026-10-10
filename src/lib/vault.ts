// The encrypted vault: accounts and records in IndexedDB, all record contents
// sealed with the account's data key. Only non-sensitive bookkeeping (email,
// salt, wrapped key, lockout counters, security policy) is stored in the clear.
//
// This is a local-first design: everything lives in this browser. A production
// deployment should add a server that stores the same ciphertext and enforces
// lockouts; see docs/SECURITY.md.

import {
  PBKDF2_ITERATIONS, b64, deriveKek, importDataKeys, open, openJson, randomBytes, randomId,
  seal, sealJson, sha256, sign, unb64, verify,
} from './crypto.js'
import type { DataKeys, Sealed } from './crypto.js'

const DB_NAME = 'shoebox-vault'
const CANARY = 'canary:the-quick-brown-fox'

export type Policy = { wipeAfter: 0 | 5 | 10; autoLockMin: 5 | 15 | 30; strict: boolean }
export const defaultPolicy: Policy = { wipeAfter: 10, autoLockMin: 15, strict: false }

export type Incident = { at: number; sensor: string; detail: string; destroyed: string[] }

export type Account = {
  email: string
  userId: string
  createdAt: number
  salt: string
  iterations: number
  wrapped: Sealed | null // null once shredded
  indexMac: string
  failed: number
  lockUntil: number
  policy: Policy
  lastSeen: { ua: string; tz: string; at: number } | null
  incident: Incident | null
  terms: { version: string; at: number }
  twoFactor?: boolean // display hint only; the encrypted 'security' record is what's enforced
}

type Row = { key: string; userId: string; id: string; kind: string; sealed: Sealed; h: string }

export type Session = { email: string; userId: string; keys: DataKeys }

export class VaultError extends Error {
  constructor(public code: 'no_account' | 'exists' | 'bad_password' | 'locked' | 'shredded' | 'tampered' | 'unsupported', message: string, public until?: number) {
    super(message)
  }
}

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in globalThis)) return reject(new VaultError('unsupported', 'This browser blocks local storage, so the vault can’t open. Try a normal (not private) window.'))
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const d = req.result
        d.createObjectStore('accounts', { keyPath: 'email' })
        d.createObjectStore('records', { keyPath: 'key' }).createIndex('userId', 'userId')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(new VaultError('unsupported', 'The vault could not open in this browser. Try a normal (not private) window.'))
    })
    dbp.catch(() => (dbp = null))
  }
  return dbp
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(stores, mode)
        let result: T
        const r = fn(t)
        if (r) r.onsuccess = () => (result = r.result)
        t.oncomplete = () => resolve(result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      }),
  )
}

export const getAccount = (email: string) =>
  tx<Account | undefined>(['accounts'], 'readonly', (t) => t.objectStore('accounts').get(email.trim().toLowerCase()))
const putAccount = (a: Account) => tx(['accounts'], 'readwrite', (t) => void t.objectStore('accounts').put(a))
const rowsFor = (userId: string) =>
  tx<Row[]>(['records'], 'readonly', (t) => t.objectStore('records').index('userId').getAll(userId))

// Reads the account and its rows in one transaction, so a reader never sees a
// half-applied write.
function readState(email: string): Promise<{ acct: Account | undefined; rows: Row[] }> {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(['accounts', 'records'], 'readonly')
        const a = t.objectStore('accounts').get(email)
        let rows: Row[] = []
        a.onsuccess = () => {
          const acct = a.result as Account | undefined
          if (!acct) return
          const r = t.objectStore('records').index('userId').getAll(acct.userId)
          r.onsuccess = () => (rows = r.result as Row[])
        }
        t.oncomplete = () => resolve({ acct: a.result as Account | undefined, rows })
        t.onerror = () => reject(t.error)
      }),
  )
}

// Serializes writes across every tab with the Web Locks API (or within this
// tab when it's unavailable), so two writers can't sign different indexes.
let localChain: Promise<unknown> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: { request: (n: string, cb: () => Promise<T>) => Promise<T> } }).locks
  if (locks) return locks.request('shoebox-vault-write', fn)
  const run = localChain.then(fn, fn)
  localChain = run.catch(() => undefined)
  return run
}

const aad = (userId: string, id: string, kind: string) => `${userId}/${kind}/${id}`
const indexMessage = (rows: Pick<Row, 'id' | 'h'>[]) => rows.map((r) => `${r.id}:${r.h}`).sort().join('|')

function fingerprint() {
  return { ua: navigator.userAgent, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, at: Date.now() }
}

async function writeRow(s: Session, id: string, kind: string, value: unknown) {
  const sealed = await sealJson(s.keys.dek, value, aad(s.userId, id, kind))
  const row: Row = { key: `${s.userId}:${id}`, userId: s.userId, id, kind, sealed, h: await sha256(sealed.ct) }
  return row
}

// Applies one change and re-signs the index in a single transaction.
async function commit(s: Session, change: { put?: Row; del?: string }) {
  await withLock(async () => {
    const { acct, rows } = await readState(s.email)
    if (!acct?.wrapped) throw new VaultError('no_account', 'The vault is gone.')
    const id = change.put?.id ?? change.del
    const next = rows.filter((r) => r.id !== id)
    if (change.put) next.push(change.put)
    acct.indexMac = await sign(s.keys.mac, indexMessage(next))
    await tx(['records', 'accounts'], 'readwrite', (t) => {
      if (change.put) t.objectStore('records').put(change.put)
      if (change.del) t.objectStore('records').delete(`${s.userId}:${change.del}`)
      t.objectStore('accounts').put(acct)
    })
  })
}

export async function createAccount(email: string, password: string, termsVersion: string, policy = defaultPolicy): Promise<Session> {
  email = email.trim().toLowerCase()
  const existing = await getAccount(email)
  if (existing && existing.wrapped) throw new VaultError('exists', 'An account with that email already exists on this device. Sign in instead.')
  const salt = randomBytes(16)
  const raw = randomBytes(32)
  const kek = await deriveKek(password, salt)
  const userId = randomId()
  const wrapped = await seal(kek, raw, `kek/${userId}`)
  const keys = await importDataKeys(raw)
  raw.fill(0)
  const s: Session = { email, userId, keys }
  const canary = await writeRow(s, 'canary', 'canary', CANARY)
  await tx(['records'], 'readwrite', (t) => void t.objectStore('records').put(canary))
  await putAccount({
    email, userId, createdAt: Date.now(), salt: b64(salt), iterations: PBKDF2_ITERATIONS, wrapped,
    indexMac: await sign(keys.mac, indexMessage([canary])), failed: 0, lockUntil: 0, policy,
    lastSeen: fingerprint(), incident: null, terms: { version: termsVersion, at: Date.now() },
  })
  return s
}

export type UnlockResult = { session: Session; records: { id: string; kind: string; value: unknown }[]; fingerprintChanged: boolean; failedBefore: number; secondFactor: boolean }

// Unlocks the vault and verifies it. Integrity failures throw VaultError('tampered');
// the caller decides what to do (the sentinel shreds).
export async function unlock(email: string, password: string): Promise<UnlockResult> {
  email = email.trim().toLowerCase()
  const acct = await getAccount(email)
  if (!acct) throw new VaultError('no_account', 'No account with that email on this device.')
  if (!acct.wrapped) throw new VaultError('shredded', 'This vault was shredded after a security incident.')
  if (acct.lockUntil > Date.now()) throw new VaultError('locked', 'Too many wrong passwords. Try again shortly.', acct.lockUntil)

  let raw: Uint8Array
  try {
    const kek = await deriveKek(password, unb64(acct.salt), acct.iterations)
    raw = await open(kek, acct.wrapped, `kek/${acct.userId}`)
  } catch {
    acct.failed += 1
    // Progressive lockout: 30 s after 3 misses, doubling, capped at 1 hour.
    if (acct.failed >= 3) acct.lockUntil = Date.now() + Math.min(3_600_000, 30_000 * 2 ** (acct.failed - 3))
    await putAccount(acct)
    throw new VaultError('bad_password', 'That password doesn’t match.', acct.failed)
  }
  const keys = await importDataKeys(raw)
  raw.fill(0)
  const session: Session = { email, userId: acct.userId, keys }

  const { rows } = await readState(email)
  if (!(await verify(keys.mac, indexMessage(rows), acct.indexMac))) {
    throw new VaultError('tampered', 'The vault index signature does not match. Records were added, removed or swapped outside the app.')
  }
  const records: UnlockResult['records'] = []
  for (const r of rows) {
    try {
      if ((await sha256(r.sealed.ct)) !== r.h) throw new Error('hash')
      const value = await openJson(keys.dek, r.sealed, aad(acct.userId, r.id, r.kind))
      if (r.kind === 'canary') {
        if (value !== CANARY) throw new Error('canary')
      } else records.push({ id: r.id, kind: r.kind, value })
    } catch {
      throw new VaultError('tampered', `Record ${r.kind}/${r.id} failed its authenticity check. It was altered outside the app.`)
    }
  }
  if (!rows.some((r) => r.kind === 'canary')) throw new VaultError('tampered', 'The vault’s canary record is missing.')

  const fp = fingerprint()
  const fingerprintChanged = !!acct.lastSeen && (acct.lastSeen.ua !== fp.ua || acct.lastSeen.tz !== fp.tz)
  const failedBefore = acct.failed
  // With two-factor on, the attempt counter keeps running until the code is
  // accepted too, so knowing the password doesn't buy unlimited code guesses.
  const secondFactor = records.some((r) => r.kind === 'security' && (r.value as { enabled?: boolean })?.enabled)
  if (!secondFactor) await finishUnlock(email)
  return { session, records, fingerprintChanged, failedBefore, secondFactor }
}

export function finishUnlock(email: string) {
  return withLock(async () => {
    const acct = await getAccount(email)
    if (!acct) return
    acct.failed = 0
    acct.lockUntil = 0
    acct.lastSeen = fingerprint()
    await putAccount(acct)
  })
}

// Records one wrong code (or password) with the same growing lockout.
export function noteFailure(email: string): Promise<Account | undefined> {
  return withLock(async () => {
    const acct = await getAccount(email)
    if (!acct) return undefined
    acct.failed += 1
    if (acct.failed >= 3) acct.lockUntil = Date.now() + Math.min(3_600_000, 30_000 * 2 ** (acct.failed - 3))
    await putAccount(acct)
    return acct
  })
}

export function setTwoFactorHint(email: string, on: boolean) {
  return withLock(async () => {
    const acct = await getAccount(email)
    if (!acct) return
    acct.twoFactor = on
    await putAccount(acct)
  })
}

export async function put(s: Session, id: string, kind: string, value: unknown) {
  await commit(s, { put: await writeRow(s, id, kind, value) })
}

export async function remove(s: Session, id: string) {
  await commit(s, { del: id })
}

// Cheap re-check while unlocked: does storage still match what we signed?
export async function verifyIndex(s: Session): Promise<boolean> {
  const { acct, rows } = await readState(s.email)
  if (!acct?.wrapped) return false
  for (const r of rows) if ((await sha256(r.sealed.ct)) !== r.h) return false
  return verify(s.keys.mac, indexMessage(rows), acct.indexMac)
}

export function setPolicy(email: string, policy: Policy) {
  return withLock(async () => {
    const acct = await getAccount(email)
    if (!acct) return
    acct.policy = policy
    await putAccount(acct)
  })
}

export function changePassword(s: Session, current: string, next: string) {
  return withLock(() => changePasswordLocked(s, current, next))
}

async function changePasswordLocked(s: Session, current: string, next: string) {
  const acct = await getAccount(s.email)
  if (!acct?.wrapped) throw new VaultError('no_account', 'Account not found.')
  let raw: Uint8Array
  try {
    raw = await open(await deriveKek(current, unb64(acct.salt), acct.iterations), acct.wrapped, `kek/${acct.userId}`)
  } catch {
    throw new VaultError('bad_password', 'Your current password is wrong.')
  }
  const salt = randomBytes(16)
  acct.wrapped = await seal(await deriveKek(next, salt), raw, `kek/${acct.userId}`)
  raw.fill(0)
  acct.salt = b64(salt)
  acct.iterations = PBKDF2_ITERATIONS
  await putAccount(acct)
}

// Crypto-shred: destroy the wrapped key and every record. Without the key the
// ciphertext is unreadable, and it is deleted as well.
export async function shred(email: string, incident: Omit<Incident, 'destroyed'>): Promise<Incident> {
  const acct = await getAccount(email)
  if (!acct) throw new VaultError('no_account', 'Account not found.')
  const rows = await rowsFor(acct.userId)
  await tx(['records'], 'readwrite', (t) => {
    const store = t.objectStore('records')
    for (const r of rows) store.delete(r.key)
  })
  const kinds = rows.reduce<Record<string, number>>((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {})
  const destroyed = [
    'Encryption key',
    ...Object.entries(kinds)
      .filter(([k]) => k !== 'canary')
      .map(([k, n]) => `${n} ${({ receipt: 'receipt', income: 'income record', trip: 'trip log', log: 'security log', profile: 'profile', security: 'two-factor key' } as Record<string, string>)[k] ?? k}${n > 1 ? 's' : ''}`),
  ]
  const full: Incident = { ...incident, destroyed }
  acct.wrapped = null
  acct.indexMac = ''
  acct.incident = full
  await putAccount(acct)
  return full
}

export async function deleteAccount(email: string) {
  const acct = await getAccount(email)
  if (!acct) return
  const rows = await rowsFor(acct.userId)
  await tx(['records', 'accounts'], 'readwrite', (t) => {
    for (const r of rows) t.objectStore('records').delete(r.key)
    t.objectStore('accounts').delete(acct.email)
  })
}
