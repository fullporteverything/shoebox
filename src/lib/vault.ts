// The encrypted vault: accounts and records in IndexedDB, all record contents
// sealed with the account's data key. Only non-sensitive bookkeeping (email,
// salt, wrapped key, lockout counters, security policy) is stored in the clear.
//
// Local-first: every read and write goes through this browser's copy. When the
// account is linked to the cloud (cloud.ts), each change is also pushed as
// ciphertext and changes from other devices are pulled in, so the same vault
// opens anywhere. See docs/SECURITY.md.

import {
  PBKDF2_ITERATIONS, b64, deriveSecrets, importDataKeys, open, openJson, randomBytes, randomId,
  seal, sealJson, sha256, sign, unb64, verify,
} from './crypto.js'
import type { DataKeys, Sealed } from './crypto.js'
import { cloud, CloudError } from './cloud.js'
import type { Enrollment, Pull, RemoteRow, RemoteVault } from './cloud.js'

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
  // Present once the vault is linked to the cloud. rev and index describe the
  // server's copy; dirty lists records changed here that the server hasn't got.
  sync?: { rev: number; index: Record<string, string>; dirty: string[] }
}

type Row = { key: string; userId: string; id: string; kind: string; sealed: Sealed; h: string }

export type Session = { email: string; userId: string; keys: DataKeys; cloud?: { token: string; deviceId: string } }

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
    if (acct.sync && id && !acct.sync.dirty.includes(id)) acct.sync.dirty.push(id)
    await tx(['records', 'accounts'], 'readwrite', (t) => {
      if (change.put) t.objectStore('records').put(change.put)
      if (change.del) t.objectStore('records').delete(`${s.userId}:${change.del}`)
      t.objectStore('accounts').put(acct)
    })
  })
}

export async function createAccount(email: string, password: string, termsVersion: string, policy = defaultPolicy): Promise<{ session: Session; auth: string }> {
  email = email.trim().toLowerCase()
  const existing = await getAccount(email)
  if (existing && existing.wrapped) throw new VaultError('exists', 'An account with that email already exists on this device. Sign in instead.')
  const salt = randomBytes(16)
  const raw = randomBytes(32)
  const { kek, auth } = await deriveSecrets(password, salt)
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
  return { session: s, auth }
}

export type UnlockResult = {
  session: Session; records: { id: string; kind: string; value: unknown }[]; fingerprintChanged: boolean; failedBefore: number
  secondFactor: boolean; auth: string
}

// Unlocks the vault and verifies it. Integrity failures throw VaultError('tampered');
// the caller decides what to do (the sentinel shreds).
export async function unlock(email: string, password: string): Promise<UnlockResult> {
  email = email.trim().toLowerCase()
  const acct = await getAccount(email)
  if (!acct) throw new VaultError('no_account', 'No account with that email on this device.')
  if (!acct.wrapped) throw new VaultError('shredded', 'This vault was shredded after a security incident.')
  if (acct.lockUntil > Date.now()) throw new VaultError('locked', 'Too many wrong passwords. Try again shortly.', acct.lockUntil)

  const { kek, auth } = await deriveSecrets(password, unb64(acct.salt), acct.iterations)
  let raw: Uint8Array
  try {
    raw = await open(kek, acct.wrapped, `kek/${acct.userId}`)
  } catch {
    acct.failed += 1
    // Progressive lockout: 30 s after 3 misses, doubling, capped at 1 hour.
    if (acct.failed >= 3) acct.lockUntil = Date.now() + Math.min(3_600_000, 30_000 * 2 ** (acct.failed - 3))
    await putAccount(acct)
    throw new VaultError('bad_password', 'That password doesn’t match.', acct.failed)
  }
  const res = await openVerified(email, acct, raw, auth)
  // With two-factor on, the attempt counter keeps running until the code is
  // accepted too, so knowing the password doesn't buy unlimited code guesses.
  if (!res.secondFactor) await finishUnlock(email)
  return res
}

// Opens a vault whose password the server already checked. kek comes from the
// same derivation the caller used for the server proof, so PBKDF2 runs once.
export async function unlockWithKek(email: string, kek: CryptoKey, auth: string): Promise<UnlockResult> {
  const acct = await getAccount(email)
  if (!acct?.wrapped) throw new VaultError('no_account', 'The vault is gone.')
  let raw: Uint8Array
  try {
    raw = await open(kek, acct.wrapped, `kek/${acct.userId}`)
  } catch {
    throw new VaultError('tampered', 'The server accepted the password but the downloaded key doesn’t open with it. The cloud copy was altered.')
  }
  const res = await openVerified(email, acct, raw, auth)
  await finishUnlock(email)
  return res
}

async function openVerified(email: string, acct: Account, raw: Uint8Array, auth: string): Promise<UnlockResult> {
  const keys = await importDataKeys(raw)
  raw.fill(0)
  const session: Session = { email, userId: acct.userId, keys }
  const records = await decryptAll(session, acct)
  const fp = fingerprint()
  const fingerprintChanged = !!acct.lastSeen && (acct.lastSeen.ua !== fp.ua || acct.lastSeen.tz !== fp.tz)
  const secondFactor = records.some((r) => r.kind === 'security' && (r.value as { enabled?: boolean })?.enabled)
  return { session, records, fingerprintChanged, failedBefore: acct.failed, secondFactor, auth }
}

// Verifies every stored record against the signed index and decrypts it.
export async function decryptAll(s: Session, acctIn?: Account): Promise<UnlockResult['records']> {
  const { acct: fresh, rows } = await readState(s.email)
  const acct = acctIn ?? fresh
  if (!acct) throw new VaultError('no_account', 'The vault is gone.')
  if (!(await verify(s.keys.mac, indexMessage(rows), acct.indexMac))) {
    throw new VaultError('tampered', 'The vault index signature does not match. Records were added, removed or swapped outside the app.')
  }
  const records: UnlockResult['records'] = []
  for (const r of rows) {
    try {
      if ((await sha256(r.sealed.ct)) !== r.h) throw new Error('hash')
      const value = await openJson(s.keys.dek, r.sealed, aad(acct.userId, r.id, r.kind))
      if (r.kind === 'canary') {
        if (value !== CANARY) throw new Error('canary')
      } else records.push({ id: r.id, kind: r.kind, value })
    } catch {
      throw new VaultError('tampered', `Record ${r.kind}/${r.id} failed its authenticity check. It was altered outside the app.`)
    }
  }
  if (!rows.some((r) => r.kind === 'canary')) throw new VaultError('tampered', 'The vault’s canary record is missing.')
  return records
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
  const old = await deriveSecrets(current, unb64(acct.salt), acct.iterations)
  let raw: Uint8Array
  try {
    raw = await open(old.kek, acct.wrapped, `kek/${acct.userId}`)
  } catch {
    throw new VaultError('bad_password', 'Your current password is wrong.')
  }
  const salt = randomBytes(16)
  const fresh = await deriveSecrets(next, salt)
  const wrapped = await seal(fresh.kek, raw, `kek/${acct.userId}`)
  raw.fill(0)
  // The server copy changes first, so a failure there leaves both copies on the old password.
  if (s.cloud) {
    const r = await cloud.changePassword(s.cloud.token, old.auth, b64(salt), PBKDF2_ITERATIONS, wrapped, fresh.auth)
    if (r?.error === 'bad_password') throw new VaultError('bad_password', 'Your current password is wrong.')
    if (r?.error) throw new Error('The server refused the new password.')
  } else if (acct.sync) {
    throw new Error('Changing the password needs a connection to the Shoebox server. Sign in again while online.')
  }
  acct.wrapped = wrapped
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

// Cloud sync ---------------------------------------------------------------
//
// Invariant: this browser's rows = the server's rows (sync.index) with every
// id in sync.dirty replaced by its local version or deletion. Every push is
// tied to the server revision it was built on; if another device got there
// first the server says "conflict", we pull its changes, keep ours for the
// dirty ids and try again. Each push carries an index signature over the
// exact rows the server will hold afterwards, so the server copy always
// verifies on its own.

const BATCH_BYTES = 1_500_000
const toRemote = (r: Row): RemoteRow => ({ id: r.id, kind: r.kind, sealed: r.sealed, h: r.h })
const fromRemote = (userId: string, r: RemoteRow): Row => ({ key: `${userId}:${r.id}`, userId, id: r.id, kind: r.kind, sealed: r.sealed, h: r.h })
const indexOf = (rows: Pick<Row, 'id' | 'h'>[]) => Object.fromEntries(rows.map((r) => [r.id, r.h]))
const indexRows = (index: Record<string, string>) => Object.entries(index).map(([id, h]) => ({ id, h }))

// Stores a vault downloaded at sign-in as this browser's copy. A different
// account kept here under the same email (made before sync existed) is set
// aside rather than overwritten.
export async function importRemote(v: RemoteVault): Promise<void> {
  await withLock(async () => {
    const email = v.email.trim().toLowerCase()
    const { acct: local, rows: oldRows } = await readState(email)
    const rows = v.records.map((r) => fromRemote(v.user_id, r))
    const acct: Account = {
      email, userId: v.user_id, createdAt: v.created_at, salt: v.salt, iterations: v.iterations, wrapped: v.wrapped,
      indexMac: v.index_mac, failed: 0, lockUntil: 0, policy: { ...defaultPolicy, ...(v.policy as Partial<Policy>) },
      lastSeen: local?.userId === v.user_id ? local.lastSeen : null, incident: null, terms: v.terms,
      twoFactor: local?.userId === v.user_id ? local.twoFactor : undefined,
      sync: { rev: v.rev, index: indexOf(rows), dirty: [] },
    }
    await tx(['records', 'accounts'], 'readwrite', (t) => {
      const recs = t.objectStore('records')
      if (local && local.userId !== v.user_id) {
        if (local.wrapped) t.objectStore('accounts').put({ ...local, email: `${email}#set-aside-${local.userId}` })
      } else {
        for (const r of oldRows) recs.delete(r.key)
      }
      for (const r of rows) recs.put(r)
      t.objectStore('accounts').put(acct)
    })
  })
}

// True when this browser holds unpushed edits for the same account and key,
// so sign-in should keep them and merge instead of replacing the local copy.
export async function hasPendingFor(email: string, userId: string, salt: string): Promise<boolean> {
  const acct = await getAccount(email)
  return !!acct?.wrapped && acct.userId === userId && acct.salt === salt && !!acct.sync?.dirty.length
}

export async function needsEnrollment(email: string): Promise<boolean> {
  const acct = await getAccount(email)
  return !!acct?.wrapped && !acct.sync
}

// First upload of a vault that only lived in this browser. Large vaults go up
// in several signed steps; until the last one lands the rest stay "dirty".
export async function enroll(s: Session, auth: string, twoFactor: { secret: string; lastStep: number; recovery: string[] } | null) {
  return withLock(async () => {
    const { acct, rows } = await readState(s.email)
    if (!acct?.wrapped) throw new VaultError('no_account', 'The vault is gone.')
    const first: Row[] = []
    const later: Row[] = []
    let bytes = 0
    for (const r of [...rows].sort((a, b) => (a.kind === 'receipt' ? 1 : 0) - (b.kind === 'receipt' ? 1 : 0))) {
      const size = r.sealed.ct.length
      if (r.kind === 'canary' || bytes + size < BATCH_BYTES) {
        first.push(r)
        bytes += size
      } else later.push(r)
    }
    const e: Enrollment = {
      email: acct.email, user_id: acct.userId, created_at: acct.createdAt, salt: acct.salt, iterations: acct.iterations,
      wrapped: acct.wrapped, auth, index_mac: await sign(s.keys.mac, indexMessage(first)), policy: acct.policy, terms: acct.terms,
      records: first.map(toRemote),
      ...(twoFactor ? { totp_secret: twoFactor.secret, totp_last_step: twoFactor.lastStep, recovery: twoFactor.recovery } : {}),
    }
    const r = await cloud.enroll(e)
    if ('error' in r) return r.error
    acct.sync = { rev: r.rev, index: indexOf(first), dirty: later.map((x) => x.id) }
    await putAccount(acct)
    s.cloud = { token: r.token, deviceId: r.device_id }
    return { deviceId: r.device_id, newDevice: r.new_device }
  })
}

export type SyncResult = { pulled: boolean; policy?: Policy; shredded?: boolean }

// Pushes local changes and pulls remote ones. Safe to call often.
export function sync(s: Session): Promise<SyncResult> {
  return withLock(() => syncLocked(s))
}

async function syncLocked(s: Session): Promise<SyncResult> {
  if (!s.cloud) return { pulled: false }
  const token = s.cloud.token
  let pulled = false
  for (let attempt = 0; attempt < 6; attempt++) {
    const { acct, rows } = await readState(s.email)
    if (!acct?.wrapped || !acct.sync) return { pulled }
    const sync = acct.sync
    if (!sync.dirty.length) {
      const p = await cloud.pull(token, sync.rev)
      if (p.index) {
        await applyRemote(s, acct, rows, p)
        pulled = true
      }
      const policy = { ...defaultPolicy, ...(p.policy as Partial<Policy>) }
      if (JSON.stringify(policy) !== JSON.stringify(acct.policy)) {
        const a = await getAccount(s.email)
        if (a) await putAccount({ ...a, policy })
        return { pulled, policy }
      }
      return { pulled }
    }
    // Push the dirty ids in batches, each signed over the server's resulting rows.
    const byId = new Map(rows.map((r) => [r.id, r]))
    const pending = [...sync.dirty]
    let conflict = false
    while (pending.length) {
      const puts: Row[] = []
      const dels: string[] = []
      let bytes = 0
      while (pending.length) {
        const id = pending[0]
        const r = byId.get(id)
        const size = r ? r.sealed.ct.length : 0
        if ((puts.length || dels.length) && bytes + size > BATCH_BYTES) break
        pending.shift()
        if (r) puts.push(r)
        else dels.push(id)
        bytes += size
      }
      const nextIndex = { ...sync.index }
      for (const d of dels) delete nextIndex[d]
      for (const r of puts) nextIndex[r.id] = r.h
      const mac = await sign(s.keys.mac, indexMessage(indexRows(nextIndex)))
      const res = await cloud.commit(token, sync.rev, puts.map(toRemote), dels, mac)
      if ('error' in res) {
        if (res.error === 'shredded') return { pulled, shredded: true }
        conflict = true
        break
      }
      sync.rev = res.rev
      sync.index = nextIndex
      const done = new Set([...puts.map((r) => r.id), ...dels])
      sync.dirty = sync.dirty.filter((d) => !done.has(d))
      const a = await getAccount(s.email)
      if (a) await putAccount({ ...a, sync })
    }
    if (!conflict) return { pulled }
    // Someone else pushed first: take their changes, keep ours, go again.
    const fresh = await readState(s.email)
    if (!fresh.acct?.sync) return { pulled }
    const p = await cloud.pull(token, fresh.acct.sync.rev)
    if (p.index) {
      await applyRemote(s, fresh.acct, fresh.rows, p)
      pulled = true
    }
  }
  return { pulled }
}

async function applyRemote(s: Session, acct: Account, rows: Row[], p: Extract<Pull, { index_mac: string }>) {
  if (!(await verify(s.keys.mac, indexMessage(indexRows(p.index)), p.index_mac))) {
    throw new VaultError('tampered', 'The server’s copy of the vault doesn’t match its signature. It was changed by someone without your key.')
  }
  const dirty = new Set(acct.sync!.dirty)
  const local = new Map(rows.map((r) => [r.id, r]))
  const changed = new Map(p.changed.map((r) => [r.id, r]))
  for (const r of p.changed) {
    if (p.index[r.id] !== r.h || (await sha256(r.sealed.ct)) !== r.h) {
      throw new VaultError('tampered', `A record downloaded from the server (${r.kind}) doesn’t match its signature.`)
    }
  }
  const next: Row[] = []
  for (const [id, h] of Object.entries(p.index)) {
    if (dirty.has(id)) continue
    const c = changed.get(id)
    if (c) next.push(fromRemote(acct.userId, c))
    else {
      const l = local.get(id)
      if (!l || l.h !== h) throw new VaultError('tampered', 'This browser’s copy and the server’s copy disagree about a record neither side changed.')
      next.push(l)
    }
  }
  for (const id of dirty) {
    const l = local.get(id)
    if (l) next.push(l)
  }
  acct.indexMac = await sign(s.keys.mac, indexMessage(next))
  acct.sync = { rev: p.rev, index: p.index, dirty: [...dirty] }
  const keep = new Set(next.map((r) => r.id))
  await tx(['records', 'accounts'], 'readwrite', (t) => {
    const store = t.objectStore('records')
    for (const r of rows) if (!keep.has(r.id)) store.delete(r.key)
    for (const r of next) if (local.get(r.id)?.h !== r.h) store.put(r)
    t.objectStore('accounts').put(acct)
  })
}

export function isSessionEnded(e: unknown) {
  return e instanceof CloudError && e.code === 'session_ended'
}

// Drops this browser's copy after a remote sign-out. The server copy stays.
export const forgetLocal = deleteAccount
