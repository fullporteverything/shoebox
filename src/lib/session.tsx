import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as vault from './vault.js'
import type { Incident, Policy, Session } from './vault.js'
import { sensors, tabChannel, watchIdle, watchInjection } from './sentinel.js'
import type { SensorId, Severity } from './sentinel.js'
import { classify } from './tax/classify.js'
import type { IncomeEntry, Plan, Profile, Receipt, TripLog } from './types.js'
import { emptyPlan } from './types.js'
import { TERMS_VERSION } from '../legal/content.js'
import { newRecoveryCodes, newSecret, normalizeRecovery, otpauthUri, verifyTotp } from './totp.js'
import type { TwoFactor } from './totp.js'
import { deriveSecrets, sha256, unb64 } from './crypto.js'
import { cloud, cloudEnabled, CloudError, describeDevice, isOk, rememberDevice } from './cloud.js'
import type { Device, LoginResult, Membership, MyReview, PassState } from './cloud.js'
import { PASS_REQUIRED_FROM } from './cloud.js'
import { usdRate } from './fx.js'

export type LogEntry = { at: number; level: 'info' | 'alert' | 'lock' | 'shred'; sensor?: SensorId; text: string }
export type Phase = 'signed_out' | 'two_factor' | 'unlocked' | 'locked' | 'shredded'

type Toast = { id: number; tone: 'good' | 'warn' | 'bad' | 'info'; text: string }

type Ctx = {
  phase: Phase
  email: string
  profile: Profile | null
  receipts: Receipt[]
  incomes: IncomeEntry[]
  tripLogs: Record<string, TripLog>
  log: LogEntry[]
  policy: Policy
  incident: Incident | null
  toasts: Toast[]
  toast: (tone: Toast['tone'], text: string) => void
  dismissToast: (id: number) => void
  signUp: (email: string, password: string, profile: Profile) => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error?: string; until?: number; needs2fa?: boolean }>
  verifySecondFactor: (code: string, recovery: boolean) => Promise<{ error?: string; until?: number }>
  cancelSecondFactor: () => void
  twoFactor: { enabled: boolean; recoveryLeft: number; enabledAt: number | null }
  beginTwoFactor: () => { secret: string; uri: string }
  confirmTwoFactor: (secret: string, code: string) => Promise<string[] | null>
  disableTwoFactor: (code: string) => Promise<boolean>
  regenerateRecovery: (code: string) => Promise<string[] | null>
  signOut: () => void
  lock: (why: string) => void
  saveReceipt: (r: Receipt) => Promise<void>
  deleteReceipt: (id: string) => Promise<void>
  saveProfile: (p: Profile) => Promise<void>
  savePlan: (patch: Partial<Plan>) => Promise<void>
  saveIncome: (i: IncomeEntry) => Promise<void>
  deleteIncome: (id: string) => Promise<void>
  saveTripLog: (t: TripLog) => Promise<void>
  savePolicy: (p: Policy) => Promise<void>
  changePassword: (current: string, next: string) => Promise<void>
  shredNow: (why: string) => Promise<void>
  tamperDrill: () => Promise<void>
  deleteAccount: () => Promise<void>
  acknowledgeIncident: () => void
  cloudLinked: boolean
  listDevices: () => Promise<Device[]>
  signOutDevice: (id: string) => Promise<void>
  signOutOtherDevices: () => Promise<number>
  linkNow: () => Promise<boolean>
  reportSavings: (year: number, amount: number) => void
  membership: Membership | null
  pass: PassState | null
  hasPass: (year: number) => boolean
  refreshPass: () => Promise<PassState | null>
  startCheckout: (year: number) => Promise<string | null>
  myReview: () => Promise<MyReview>
  submitReview: (r: { rating: number; body: string; name: string; role: string }) => Promise<boolean>
}

const SessionCtx = createContext<Ctx | null>(null)

const LAST_EMAIL = 'shoebox:last-email'
const readLastEmail = () => {
  try {
    return localStorage.getItem(LAST_EMAIL) ?? ''
  } catch {
    return ''
  }
}
const writeLastEmail = (v: string | null) => {
  try {
    if (v) localStorage.setItem(LAST_EMAIL, v)
    else localStorage.removeItem(LAST_EMAIL)
  } catch {
    /* storage blocked */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('signed_out')
  const [email, setEmail] = useState(readLastEmail)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [incomes, setIncomes] = useState<IncomeEntry[]>([])
  const [tripLogs, setTripLogs] = useState<Record<string, TripLog>>({})
  const [log, setLog] = useState<LogEntry[]>([])
  const [policy, setPolicyState] = useState<Policy>(vault.defaultPolicy)
  const [incident, setIncident] = useState<Incident | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const sessionRef = useRef<Session | null>(null)
  const pendingRef = useRef<{ res: vault.UnlockResult; tf: TwoFactor } | null>(null)
  // Password accepted by the server, code still owed. The KEK waits here so
  // PBKDF2 doesn't run twice.
  const cloudPendingRef = useRef<{ email: string; ticket: string; kek: CryptoKey; auth: string } | null>(null)
  const [cloudLinked, setCloudLinked] = useState(false)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [pass, setPass] = useState<PassState | null>(null)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tf, setTf] = useState<TwoFactor | null>(null)
  const logRef = useRef<LogEntry[]>([])
  const writing = useRef(0)
  const channel = useRef<ReturnType<typeof tabChannel> | null>(null)

  const toast = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200)
  }, [])
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const persistLog = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return
    writing.current++
    try {
      await vault.put(s, 'log', 'log', logRef.current.slice(0, 200))
    } finally {
      writing.current--
    }
    if (s.cloud) scheduleSync()
  }, [])

  const addLog = useCallback(
    (e: Omit<LogEntry, 'at'>, persist = true) => {
      logRef.current = [{ ...e, at: Date.now() }, ...logRef.current].slice(0, 200)
      setLog(logRef.current)
      if (persist) void persistLog()
    },
    [persistLog],
  )

  const dropKeys = () => {
    sessionRef.current = null
    pendingRef.current = null
    cloudPendingRef.current = null
    setCloudLinked(false)
    setMembership(null)
    setPass(null)
    if (syncTimer.current) clearTimeout(syncTimer.current)
    setTf(null)
    setProfile(null)
    setReceipts([])
    setIncomes([])
    setTripLogs({})
    logRef.current = []
    setLog([])
  }

  const lock = useCallback(
    (why: string) => {
      if (!sessionRef.current) return
      addLog({ level: 'lock', text: why })
      dropKeys()
      setPhase('locked')
      channel.current?.send('lock', email)
    },
    [addLog, email],
  )

  const doShred = useCallback(
    async (targetEmail: string, sensor: string, detail: string, broadcast = true, token = sessionRef.current?.cloud?.token) => {
      dropKeys()
      try {
        const inc = await vault.shred(targetEmail, { at: Date.now(), sensor, detail })
        setIncident(inc)
        // The server copy goes too, so every signed-in device follows.
        if (token) await cloud.shred(token, inc).catch(() => undefined)
      } catch {
        setIncident({ at: Date.now(), sensor, detail, destroyed: ['Encryption key'] })
      }
      setPhase('shredded')
      if (broadcast) channel.current?.send('shred', targetEmail)
    },
    [],
  )

  const trip = useCallback(
    async (sensor: SensorId, severity: Severity, detail: string) => {
      const name = sensors.find((s) => s.id === sensor)?.name ?? sensor
      if (severity === 'alert') {
        addLog({ level: 'alert', sensor, text: detail })
        toast('warn', `${name}: ${detail}`)
      } else if (severity === 'lock') {
        toast('warn', `${name} locked the vault. ${detail}`)
        lock(`${name}: ${detail}`)
      } else {
        await doShred(email, name, detail)
      }
    },
    [addLog, doShred, email, lock, toast],
  )

  // Load decrypted records into state after an unlock.
  const hydrate = (records: vault.UnlockResult['records']) => {
    let p: Profile | null = null
    const rs: Receipt[] = []
    let lg: LogEntry[] = []
    const inc: IncomeEntry[] = []
    const trips: Record<string, TripLog> = {}
    for (const r of records) {
      if (r.kind === 'profile') p = r.value as Profile
      else if (r.kind === 'receipt') rs.push(r.value as Receipt)
      else if (r.kind === 'log') lg = r.value as LogEntry[]
      else if (r.kind === 'income') inc.push(r.value as IncomeEntry)
      else if (r.kind === 'security') setTf(r.value as TwoFactor)
      else if (r.kind === 'trip') {
        const t = r.value as TripLog
        trips[t.key] = t
      }
    }
    setIncomes(inc.sort((a, b) => b.date.localeCompare(a.date)))
    setTripLogs(trips)
    rs.sort((a, b) => b.createdAt - a.createdAt)
    setProfile(p)
    setReceipts(rs)
    logRef.current = lg
    setLog(lg)
  }

  const signUp = useCallback(
    async (rawEmail: string, password: string, p: Profile) => {
      const em = rawEmail.trim().toLowerCase()
      let online = cloudEnabled
      if (online) {
        try {
          const pre = await cloud.prelogin(em)
          if (pre.exists && !pre.shredded) throw new vault.VaultError('exists', 'An account with that email already exists. Sign in instead.')
        } catch (e) {
          if (!(e instanceof CloudError)) throw e
          online = false
        }
      }
      const { session: s, auth } = await vault.createAccount(em, password, TERMS_VERSION)
      s.auth = auth
      sessionRef.current = s
      setEmail(s.email)
      writeLastEmail(s.email)
      const prof = { ...p, email: s.email }
      await vault.put(s, 'profile', 'profile', prof)
      setProfile(prof)
      setReceipts([])
      logRef.current = []
      addLog({ level: 'info', text: 'Vault created. Encryption key generated on this device.' })
      setPolicyState(vault.defaultPolicy)
      setIncident(null)
      setPhase('unlocked')
      if (online) await linkToCloud(s, auth, null)
      else if (cloudEnabled) toast('warn', 'Couldn’t reach the server, so this vault lives on this device for now. It uploads the next time you sign in online.')
    },
    [addLog],
  )

  const signIn = useCallback(
    async (rawEmail: string, password: string): Promise<{ error?: string; until?: number; needs2fa?: boolean }> => {
      const em = rawEmail.trim().toLowerCase()
      if (cloudEnabled) {
        const r = await cloudSignIn(em, password)
        if (r) return r
      }
      try {
        const res = await vault.unlock(em, password)
        setEmail(em)
        writeLastEmail(em)
        const acct = await vault.getAccount(em)
        if (acct) setPolicyState(acct.policy)
        setIncident(null)
        if (res.secondFactor) {
          // Keys stay out of the app until the code checks out.
          pendingRef.current = { res, tf: res.records.find((r) => r.kind === 'security')!.value as TwoFactor }
          setPhase('two_factor')
          return { needs2fa: true }
        }
        await completeUnlock(res)
        return {}
      } catch (e) {
        if (!(e instanceof vault.VaultError)) return { error: 'Something went wrong opening the vault. Try again.' }
        if (e.code === 'no_account') {
          return { error: cloudEnabled ? 'No account with that email. Check the spelling, or create one.' : 'No account with that email on this device.' }
        }
        if (e.code === 'bad_password') {
          const acct = await vault.getAccount(em)
          if (acct && acct.policy.wipeAfter && acct.failed >= acct.policy.wipeAfter) {
            setEmail(em)
            await doShred(em, 'Password guessing', `${acct.failed} wrong passwords in a row reached your wipe limit of ${acct.policy.wipeAfter}.`)
            return { error: 'shredded' }
          }
          const left = acct?.policy.wipeAfter ? acct.policy.wipeAfter - (acct?.failed ?? 0) : null
          return {
            error: `That password doesn’t match.${left !== null ? ` ${left} attempt${left === 1 ? '' : 's'} left before the vault shreds itself.` : ''}`,
            until: acct?.lockUntil || undefined,
          }
        }
        if (e.code === 'locked') return { error: 'Too many wrong passwords. Wait for the timer, then try again.', until: e.until }
        if (e.code === 'tampered') {
          setEmail(em)
          await doShred(em, 'Vault integrity', e.message)
          return { error: 'shredded' }
        }
        if (e.code === 'shredded') {
          const acct = await vault.getAccount(em)
          setEmail(em)
          setIncident(acct?.incident ?? null)
          setPhase('shredded')
          return { error: 'shredded' }
        }
        return { error: e.message }
      }
    },
    [addLog, doShred, trip],
  )

  const completeUnlock = async (res: vault.UnlockResult, how = '', newDevice = false) => {
    res.session.auth = res.auth
    sessionRef.current = res.session
    pendingRef.current = null
    cloudPendingRef.current = null
    setCloudLinked(!!res.session.cloud)
    hydrate(res.records)
    setPhase('unlocked')
    addLog({ level: 'info', text: (res.failedBefore ? `Unlocked after ${res.failedBefore} failed attempt${res.failedBefore > 1 ? 's' : ''}` : 'Unlocked') + how + '.' })
    if (newDevice) {
      await trip('fingerprint', 'alert', `First sign-in from ${describeDevice(navigator.userAgent)}. It now appears in Profile → Settings → Devices. If it wasn’t you, sign it out there and change your password.`)
    } else if (res.fingerprintChanged) {
      await trip('fingerprint', 'alert', 'This unlock came from a different browser or time zone than last time. If it wasn’t you, change your password.')
    }
    // A vault made before cloud sync existed uploads itself on its first online sign-in.
    if (cloudEnabled && !res.session.cloud && (await vault.needsEnrollment(res.session.email))) {
      const sec = res.records.find((r) => r.kind === 'security')?.value as TwoFactor | undefined
      await linkToCloud(res.session, res.auth, sec?.enabled ? sec : null)
    }
  }

  const linkToCloud = async (s: Session, auth: string, sec: TwoFactor | null): Promise<boolean> => {
    try {
      const r = await vault.enroll(s, auth, sec ? { secret: sec.secret, lastStep: sec.lastStep, recovery: sec.recovery } : null)
      if (r === 'exists') {
        toast('warn', 'Another vault already uses this email on the server, so this one stays on this device only.')
        addLog({ level: 'alert', text: 'Couldn’t link this vault: the server already has a different vault under this email.' })
        return false
      }
      if (r === 'invalid') {
        toast('bad', 'The server turned down this vault’s upload. It’s still safe on this device.')
        addLog({ level: 'alert', text: 'Couldn’t link this vault: the server rejected the upload as invalid.' })
        return false
      }
      rememberDevice(r.deviceId)
      setCloudLinked(true)
      addLog({ level: 'info', text: 'Vault linked to your account. It now opens on any device you sign in from.' })
      toast('good', 'Synced. You can now sign in from any device.')
      scheduleSync(0)
      return true
    } catch (e) {
      toast('warn', 'Couldn’t reach the server to sync. This vault stays on this device for now and uploads at your next online sign-in.')
      addLog({ level: 'alert', text: `Couldn’t link this vault: ${e instanceof Error ? e.message : 'unknown error'}` })
      return false
    }
  }

  const linkNow = async () => {
    const s = sessionRef.current
    if (!s || s.cloud || !s.auth || !cloudEnabled) return false
    const sec = tf?.enabled ? tf : null
    return linkToCloud(s, s.auth, sec)
  }

  // Cloud sign-in. Returns null when the account isn't on the server or the
  // server can't be reached, so the caller falls back to this browser's copy.
  const cloudSignIn = async (em: string, password: string): Promise<{ error?: string; until?: number; needs2fa?: boolean } | null> => {
    let pre
    try {
      pre = await cloud.prelogin(em)
    } catch {
      const local = await vault.getAccount(em)
      if (local?.wrapped) {
        toast('warn', 'Couldn’t reach the server. Opening the copy saved in this browser; changes sync next time you’re online.')
        return null
      }
      return { error: 'Couldn’t reach the Shoebox server, and this browser has no saved copy of that vault. Check your connection and try again.' }
    }
    const local = await vault.getAccount(em)
    if (!pre.exists) {
      // Linked before but gone from the server: it was deleted from another device.
      if (local?.sync) {
        await vault.deleteAccount(em)
        return { error: 'That account was deleted from another device.' }
      }
      return null
    }
    setEmail(em)
    writeLastEmail(em)
    if (pre.shredded) {
      if (local?.wrapped && local.userId === pre.user_id) await vault.shred(em, pre.incident ?? { at: Date.now(), sensor: 'Remote shred', detail: 'The vault was shredded from another device.' })
      setIncident(pre.incident ? { ...pre.incident, destroyed: pre.incident.destroyed ?? ['Encryption key'] } : null)
      setPhase('shredded')
      return { error: 'shredded' }
    }
    const { kek, auth } = await deriveSecrets(password, unb64(pre.salt), pre.iterations)
    let r: LoginResult
    try {
      r = await cloud.login(em, auth)
    } catch {
      return { error: 'Couldn’t reach the Shoebox server. Try again in a moment.' }
    }
    if ('two_factor' in r) {
      cloudPendingRef.current = { email: em, ticket: r.ticket, kek, auth }
      setIncident(null)
      setPhase('two_factor')
      return { needs2fa: true }
    }
    return finishCloud(em, kek, auth, r, '')
  }

  const finishCloud = async (em: string, kek: CryptoKey, auth: string, r: LoginResult, how: string, recoveryHash?: string) => {
    if (!isOk(r)) {
      if ('two_factor' in r) return { error: 'Start again with your password.' }
      if (r.error === 'bad_password') return { error: 'That password doesn’t match.', until: r.until ?? undefined }
      if (r.error === 'bad_code') {
        const left = r.wipe_after ? r.wipe_after - r.code_failed : null
        return { error: `That code didn’t work.${left !== null ? ` ${left} attempt${left === 1 ? '' : 's'} left before the vault shreds itself.` : ''}`, until: r.until ?? undefined }
      }
      if (r.error === 'locked') return { error: 'Too many failed attempts. Wait for the timer, then try again.', until: r.until }
      if (r.error === 'shredded') {
        await vault.shred(em, r.incident ?? { at: Date.now(), sensor: 'Password guessing', detail: 'Too many failed sign-in attempts.' }).catch(() => undefined)
        dropKeys()
        setIncident(r.incident ? { ...r.incident, destroyed: r.incident.destroyed ?? ['Encryption key'] } : null)
        setPhase('shredded')
        return { error: 'shredded' }
      }
      if (r.error === 'expired') {
        dropKeys()
        setPhase('signed_out')
        return { error: 'That took too long. Enter your password again.' }
      }
      return { error: 'No account with that email.' }
    }
    rememberDevice(r.device_id)
    try {
      const keepLocal = await vault.hasPendingFor(em, r.vault.user_id, r.vault.salt)
      if (!keepLocal) await vault.importRemote(r.vault)
      let res = await vault.unlockWithKek(em, kek, auth)
      res.session.cloud = { token: r.token, deviceId: r.device_id }
      if (keepLocal) {
        await vault.sync(res.session)
        res = { ...res, records: await vault.decryptAll(res.session) }
      }
      const acct = await vault.getAccount(em)
      if (acct) setPolicyState(acct.policy)
      setIncident(null)
      // The server checked the code; keep the local copy of the two-factor state in step.
      const sec = res.records.find((x) => x.kind === 'security')
      if (sec && (sec.value as TwoFactor).enabled && (recoveryHash || r.step)) {
        const t = sec.value as TwoFactor
        const next: TwoFactor = recoveryHash ? { ...t, recovery: t.recovery.filter((h) => h !== recoveryHash) } : { ...t, lastStep: r.step ?? t.lastStep }
        await vault.put(res.session, 'security', 'security', next)
        res = { ...res, records: res.records.map((x) => (x.kind === 'security' ? { ...x, value: next } : x)) }
        if (recoveryHash) toast('warn', `Recovery code used. ${next.recovery.length} left. Make new ones in Profile → Settings if you’re running low.`)
      } else if (res.secondFactor) {
        // Two-factor is on in the vault but the server didn't ask: ask here.
        pendingRef.current = { res, tf: sec!.value as TwoFactor }
        cloudPendingRef.current = null
        setPhase('two_factor')
        return { needs2fa: true }
      }
      await completeUnlock(res, how, r.new_device)
      scheduleSync(0)
      return {}
    } catch (e) {
      if (e instanceof vault.VaultError && e.code === 'tampered') {
        await doShred(em, 'Vault integrity', e.message, true, r.token)
        return { error: 'shredded' }
      }
      return { error: 'Something went wrong opening the vault. Try again.' }
    }
  }

  // Push and pull in the background. Errors here mean another device acted:
  // a remote sign-out, a shred, or a tampered server copy.
  const runSync = async () => {
    const s = sessionRef.current
    if (!s?.cloud) return
    try {
      writing.current++
      const r = await vault.sync(s).finally(() => writing.current--)
      if (sessionRef.current !== s) return
      if (r.shredded) {
        const pre = await cloud.prelogin(s.email).catch(() => null)
        await doShred(s.email, pre && pre.exists && pre.incident ? pre.incident.sensor : 'Remote shred', pre && pre.exists && pre.incident ? pre.incident.detail : 'The vault was shredded from another device.', true, undefined)
        return
      }
      if (r.policy) setPolicyState(r.policy)
      if (r.pulled.length) {
        hydrate(await vault.decryptAll(s))
        if (r.pulled.some((k) => k !== 'log' && k !== 'canary')) toast('info', 'Updated with changes from another device.')
      }
    } catch (e) {
      if (sessionRef.current !== s) return
      if (vault.isSessionEnded(e)) {
        const pre = await cloud.prelogin(s.email).catch(() => null)
        if (pre && pre.exists && pre.shredded) {
          await doShred(s.email, pre.incident?.sensor ?? 'Remote shred', pre.incident?.detail ?? 'The vault was shredded from another device.', true, undefined)
          return
        }
        // Signed out remotely: this browser's copy goes too.
        const em = s.email
        dropKeys()
        if (pre && !pre.exists) await vault.deleteAccount(em)
        else await vault.forgetLocal(em)
        setPhase('signed_out')
        toast('warn', pre && !pre.exists ? 'This account was deleted from another device.' : 'This device was signed out from another device. Sign in again to continue.')
        channel.current?.send('lock', em)
        return
      }
      if (e instanceof vault.VaultError && e.code === 'tampered') {
        await doShred(s.email, 'Vault integrity', e.message)
        return
      }
      // Offline or a server hiccup: the changes stay queued and go up later.
    }
  }

  const scheduleSync = (delay = 600) => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => void runSync(), delay)
  }

  const verifySecondFactor = useCallback(
    async (code: string, recovery: boolean): Promise<{ error?: string; until?: number }> => {
      const pc = cloudPendingRef.current
      if (pc) {
        let arg = code.replace(/\s+/g, '')
        let hash: string | undefined
        if (recovery) {
          const norm = normalizeRecovery(code)
          if (!norm) return { error: 'Recovery codes look like abcd-efgh.' }
          hash = arg = await sha256(norm)
        }
        let r: LoginResult
        try {
          r = await cloud.login2fa(pc.ticket, arg, recovery)
        } catch {
          return { error: 'Couldn’t reach the Shoebox server. Try again in a moment.' }
        }
        return finishCloud(pc.email, pc.kek, pc.auth, r, recovery ? ' with a recovery code' : ' with a two-factor code', isOk(r) ? hash : undefined)
      }
      const pending = pendingRef.current
      if (!pending) return { error: 'Start again with your password.' }
      const em = pending.res.session.email
      const acctNow = await vault.getAccount(em)
      if (acctNow && acctNow.lockUntil > Date.now()) return { error: 'Too many wrong codes. Wait for the timer.', until: acctNow.lockUntil }
      let ok = false
      let nextTf = pending.tf
      if (recovery) {
        const norm = normalizeRecovery(code)
        const h = norm ? await sha256(norm) : ''
        if (h && pending.tf.recovery.includes(h)) {
          ok = true
          nextTf = { ...pending.tf, recovery: pending.tf.recovery.filter((x) => x !== h) }
        }
      } else {
        const step = await verifyTotp(pending.tf.secret, code, pending.tf.lastStep)
        if (step !== null) {
          ok = true
          nextTf = { ...pending.tf, lastStep: step }
        }
      }
      if (!ok) {
        const acct = await vault.noteFailure(em)
        if (acct && acct.policy.wipeAfter && acct.failed >= acct.policy.wipeAfter) {
          await doShred(em, 'Password guessing', `${acct.failed} failed sign-in attempts in a row (password or two-factor code) reached your wipe limit of ${acct.policy.wipeAfter}.`)
          return { error: 'shredded' }
        }
        const left = acct?.policy.wipeAfter ? acct.policy.wipeAfter - acct.failed : null
        return { error: `That ${recovery ? 'recovery code' : 'code'} didn’t work.${left !== null ? ` ${left} attempt${left === 1 ? '' : 's'} left before the vault shreds itself.` : ''}`, until: acct?.lockUntil || undefined }
      }
      await vault.finishUnlock(em)
      await vault.put(pending.res.session, 'security', 'security', nextTf)
      const records = pending.res.records.map((r) => (r.kind === 'security' ? { ...r, value: nextTf } : r))
      await completeUnlock({ ...pending.res, records }, recovery ? ` with a recovery code (${nextTf.recovery.length} left)` : ' with a two-factor code')
      if (recovery) toast('warn', `Recovery code used. ${nextTf.recovery.length} left. Make new ones in Profile → Settings if you’re running low.`)
      return {}
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doShred, toast],
  )

  const cancelSecondFactor = useCallback(() => {
    dropKeys()
    setPhase('signed_out')
  }, [])

  const beginTwoFactor = useCallback(() => {
    const secret = newSecret()
    return { secret, uri: otpauthUri(secret, email) }
  }, [email])

  const confirmTwoFactor = useCallback(
    async (secret: string, code: string) => {
      const step = await verifyTotp(secret, code, 0)
      if (step === null) return null
      const { codes, hashes } = await newRecoveryCodes()
      const next: TwoFactor = { enabled: true, secret, lastStep: step, recovery: hashes, enabledAt: Date.now() }
      await write((s) => vault.put(s, 'security', 'security', next))
      await pushTwoFactor(next)
      await vault.setTwoFactorHint(email, true)
      setTf(next)
      addLog({ level: 'info', text: 'Two-factor authentication turned on.' })
      return codes
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addLog, email],
  )

  // The server needs the secret to refuse sign-ins without a code.
  const pushTwoFactor = async (t: TwoFactor) => {
    const tok = sessionRef.current?.cloud?.token
    if (!tok) return
    await cloud.setTwoFactor(tok, t.enabled ? t.secret : '', t.lastStep, t.enabled ? t.recovery : []).catch(() => {
      toast('warn', 'Two-factor changed on this device but the server didn’t get it. Try again online.')
    })
  }

  // Changing two-factor settings needs a current code (or a recovery code).
  const checkCurrent = async (code: string): Promise<TwoFactor | null> => {
    if (!tf?.enabled) return null
    const step = await verifyTotp(tf.secret, code, tf.lastStep)
    if (step !== null) return { ...tf, lastStep: step }
    const norm = normalizeRecovery(code)
    const h = norm ? await sha256(norm) : ''
    if (h && tf.recovery.includes(h)) return { ...tf, recovery: tf.recovery.filter((x) => x !== h) }
    return null
  }

  const disableTwoFactor = useCallback(
    async (code: string) => {
      const ok = await checkCurrent(code)
      if (!ok) return false
      const next: TwoFactor = { enabled: false, secret: '', lastStep: 0, recovery: [], enabledAt: 0 }
      await write((s) => vault.put(s, 'security', 'security', next))
      await pushTwoFactor(next)
      await vault.setTwoFactorHint(email, false)
      setTf(next)
      addLog({ level: 'alert', text: 'Two-factor authentication turned off.' })
      return true
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tf, email, addLog],
  )

  const regenerateRecovery = useCallback(
    async (code: string) => {
      const ok = await checkCurrent(code)
      if (!ok) return null
      const { codes, hashes } = await newRecoveryCodes()
      const next = { ...ok, recovery: hashes }
      await write((s) => vault.put(s, 'security', 'security', next))
      await pushTwoFactor(next)
      setTf(next)
      addLog({ level: 'info', text: 'New recovery codes generated; the old ones stopped working.' })
      return codes
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tf, addLog],
  )

  const twoFactor = useMemo(() => ({ enabled: !!tf?.enabled, recoveryLeft: tf?.recovery.length ?? 0, enabledAt: tf?.enabled ? tf.enabledAt : null }), [tf])

  const signOut = useCallback(() => {
    const tok = sessionRef.current?.cloud?.token
    if (tok) void cloud.signOut(tok).catch(() => undefined)
    dropKeys()
    setPhase('signed_out')
  }, [])

  const write = async (fn: (s: Session) => Promise<void>) => {
    const s = sessionRef.current
    if (!s) throw new Error('The vault is locked.')
    writing.current++
    try {
      await fn(s)
    } finally {
      writing.current--
    }
    if (s.cloud) scheduleSync()
  }

  const saveReceipt = useCallback(async (r: Receipt) => {
    await write((s) => vault.put(s, r.id, 'receipt', r))
    setReceipts((rs) => {
      const i = rs.findIndex((x) => x.id === r.id)
      if (i === -1) return [r, ...rs]
      const copy = rs.slice()
      copy[i] = r
      return copy
    })
  }, [])

  const deleteReceipt = useCallback(async (id: string) => {
    await write((s) => vault.remove(s, id))
    setReceipts((rs) => rs.filter((r) => r.id !== id))
  }, [])

  const saveProfile = useCallback(
    async (p: Profile) => {
      await write((s) => vault.put(s, 'profile', 'profile', p))
      // Re-run the rules on every receipt the person hasn't overridden: state and work type change the answers.
      const updated = receipts.map((r) =>
        r.classification.source === 'you'
          ? r
          : { ...r, classification: classify(r.extraction, p, { businessPct: r.businessPct, source: r.classification.source, usdAmount: r.usdAmount, fx: r.fx }) },
      )
      for (const r of updated) await write((s) => vault.put(s, r.id, 'receipt', r))
      setReceipts(updated)
      setProfile(p)
    },
    [receipts],
  )

  // Plan answers don't change how receipts are categorized, so no re-sort.
  // Merges into the latest saved answers, so quick successive edits don't
  // overwrite each other.
  const profileRef = useRef<Profile | null>(null)
  profileRef.current = profile
  const savePlan = useCallback(async (patch: Partial<Plan>) => {
    const cur = profileRef.current
    if (!cur) return
    const p: Profile = { ...cur, plan: { ...emptyPlan, ...(cur.plan ?? {}), ...patch } }
    profileRef.current = p
    setProfile(p)
    await write((s) => vault.put(s, 'profile', 'profile', p))
  }, [])

  const saveIncome = useCallback(async (i: IncomeEntry) => {
    await write((s) => vault.put(s, 'inc:' + i.id, 'income', i))
    setIncomes((xs) => [i, ...xs.filter((x) => x.id !== i.id)].sort((a, b) => b.date.localeCompare(a.date)))
  }, [])

  const deleteIncome = useCallback(async (id: string) => {
    await write((s) => vault.remove(s, 'inc:' + id))
    setIncomes((xs) => xs.filter((x) => x.id !== id))
  }, [])

  const saveTripLog = useCallback(async (t: TripLog) => {
    await write((s) => vault.put(s, 'trip:' + t.key, 'trip', t))
    setTripLogs((m) => ({ ...m, [t.key]: t }))
  }, [])

  const savePolicy = useCallback(
    async (p: Policy) => {
      await vault.setPolicy(email, p)
      setPolicyState(p)
      const tok = sessionRef.current?.cloud?.token
      if (tok) await cloud.setPolicy(tok, p).catch(() => toast('warn', 'Saved on this device; the server copy updates next time you’re online.'))
      addLog({ level: 'info', text: `Security policy updated: wipe after ${p.wipeAfter || 'never'}, lock after ${p.autoLockMin} min idle${p.strict ? ', strict mode on' : ''}.` })
    },
    [addLog, email],
  )

  const changePassword = useCallback(
    async (current: string, next: string) => {
      await write((s) => vault.changePassword(s, current, next))
      addLog({ level: 'info', text: 'Password changed. The data key was re-wrapped with the new password.' })
    },
    [addLog],
  )

  const shredNow = useCallback((why: string) => doShred(email, 'Manual shred', why), [doShred, email])

  // Corrupts one stored record on purpose, then runs the same integrity check
  // the sensor runs. Proves the shredder end to end.
  const tamperDrill = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return
    addLog({ level: 'alert', sensor: 'integrity', text: 'Tamper drill started: corrupting one stored record.' }, false)
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('shoebox-vault')
      req.onsuccess = () => {
        const t = req.result.transaction('records', 'readwrite')
        const store = t.objectStore('records')
        const get = store.get(`${s.userId}:canary`)
        get.onsuccess = () => {
          const row = get.result
          row.sealed.ct = row.sealed.ct.slice(0, -4) + (row.sealed.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA')
          store.put(row)
        }
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
      }
      req.onerror = () => reject(req.error)
    })
    const ok = await vault.verifyIndex(s)
    if (!ok) await doShred(email, 'Vault integrity', 'Tamper drill: a stored record no longer matched its signature.')
  }, [addLog, doShred, email])

  const deleteAccount = useCallback(async () => {
    const em = email
    const tok = sessionRef.current?.cloud?.token
    if (tok) await cloud.remove(tok)
    dropKeys()
    await vault.deleteAccount(em)
    writeLastEmail(null)
    setEmail('')
    setPhase('signed_out')
  }, [email])

  const listDevices = useCallback(async () => {
    const tok = sessionRef.current?.cloud?.token
    if (!tok) return []
    return cloud.devices(tok)
  }, [])

  const signOutDevice = useCallback(
    async (id: string) => {
      const tok = sessionRef.current?.cloud?.token
      if (!tok) return
      await cloud.signOut(tok, { device: id })
      addLog({ level: 'info', text: 'Signed out a device from Settings.' })
    },
    [addLog],
  )

  const signOutOtherDevices = useCallback(async () => {
    const tok = sessionRef.current?.cloud?.token
    if (!tok) return 0
    const r = await cloud.signOut(tok, { others: true })
    addLog({ level: 'alert', text: `Signed out every other device (${r.signed_out}).` })
    return r.signed_out
  }, [addLog])

  // Public savings total: one rounded number per tax year, only with consent.
  const lastReport = useRef('')
  const reportSavings = useCallback((year: number, amount: number) => {
    const tok = sessionRef.current?.cloud?.token
    const key = `${year}:${Math.round(amount / 10)}`
    if (!tok || key === lastReport.current) return
    lastReport.current = key
    void cloud.reportSavings(tok, year, amount).catch(() => (lastReport.current = ''))
  }, [])

  const myReview = useCallback(async () => {
    const tok = sessionRef.current?.cloud?.token
    return tok ? cloud.myReview(tok) : null
  }, [])

  const submitReview = useCallback(async (r: { rating: number; body: string; name: string; role: string }) => {
    const tok = sessionRef.current?.cloud?.token
    if (!tok) return false
    const res = await cloud.submitReview(tok, r)
    return 'status' in res
  }, [])

  // Foreign receipts saved before automatic rates (or while offline) get one now.
  const fxTried = useRef(new Set<string>())
  useEffect(() => {
    if (phase !== 'unlocked' || !profile) return
    const todo = receipts.filter((r) => r.extraction.currency && r.extraction.currency !== 'USD' && r.usdAmount == null && r.extraction.usdTotal == null && !r.fx && !fxTried.current.has(r.id))
    if (!todo.length) return
    let live = true
    void (async () => {
      for (const r of todo) {
        fxTried.current.add(r.id)
        const fx = await usdRate(r.extraction.currency, r.extraction.date)
        if (!live || !fx || !sessionRef.current) continue
        const keep = r.classification.source === 'you' ? r.classification.category : undefined
        await saveReceipt({
          ...r, fx,
          classification: classify(r.extraction, profileRef.current ?? profile, { override: keep, businessPct: r.businessPct, source: r.classification.source, usdAmount: r.usdAmount, fx }),
          history: [...r.history, { at: Date.now(), what: `Converted to US dollars at the ${fx.source} for ${fx.date}` }],
        })
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, receipts])

  const refreshPass = useCallback(async () => {
    const tok = sessionRef.current?.cloud?.token
    const year = profileRef.current?.taxYear
    if (!tok || !year) return null
    const p = await cloud.passes(tok, year).catch(() => null)
    if (p && sessionRef.current?.cloud?.token === tok) setPass(p)
    return p
  }, [])

  // True when this tax year's pass features are open: everyone during early
  // access, then whoever has a paid pass for that year.
  const hasPass = useCallback(
    (year: number) => Date.now() < PASS_REQUIRED_FROM || !!pass?.passes.some((p) => p.tax_year === year && p.status === 'paid'),
    [pass],
  )

  // Returns an error message, or sends the browser to Stripe.
  const startCheckout = useCallback(async (year: number) => {
    const tok = sessionRef.current?.cloud?.token
    if (!tok) return 'Link this vault to your account first (Profile → Settings), then try again.'
    const r = await cloud.checkout(tok, year)
    if ('url' in r && r.url.startsWith('https://checkout.stripe.com/')) {
      location.assign(r.url)
      return null
    }
    const e = r as { error: string; message?: string }
    if (e.error === 'not_configured') return 'Payments aren’t switched on yet. Everything is free during early access, so there’s nothing you’re missing.'
    if (e.error === 'session_ended') return 'Your session ended. Sign in again and retry.'
    return e.message ?? 'Couldn’t start the checkout. Try again in a minute.'
  }, [])

  useEffect(() => {
    if (phase === 'unlocked' && cloudLinked) void refreshPass()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cloudLinked, profile?.taxYear, refreshPass])

  // Founding-member status, fetched once the vault is linked.
  useEffect(() => {
    const tok = sessionRef.current?.cloud?.token
    if (phase !== 'unlocked' || !cloudLinked || !tok) return
    let live = true
    cloud.membership(tok).then((m) => live && setMembership(m)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [phase, cloudLinked])

  const acknowledgeIncident = useCallback(() => {
    setIncident(null)
    setPhase('signed_out')
  }, [])

  // Sensors that run while unlocked.
  useEffect(() => {
    if (phase !== 'unlocked') return
    const sev = (id: SensorId) => sensors.find((s) => s.id === id)!.action(policy.strict) as Severity
    const stopInjection = watchInjection((detail) => void trip('injection', sev('injection'), detail))
    const stopIdle = watchIdle(policy.autoLockMin, () => lock(`Idle lock: no activity for ${policy.autoLockMin} minutes.`))
    // Re-verify storage on a timer. A mismatch is re-checked twice to rule out
    // another tab caught mid-write before anything is destroyed.
    const iv = setInterval(async () => {
      const s = sessionRef.current
      if (!s || writing.current) return
      for (let i = 0; i < 3; i++) {
        if (await vault.verifyIndex(s).catch(() => true)) return
        await new Promise((r) => setTimeout(r, 1500))
      }
      void trip('integrity', 'shred', 'Stored records changed outside the app while the vault was open.')
    }, 45_000)
    // Pick up changes from other devices, and notice a remote sign-out.
    const pull = setInterval(() => {
      if (!writing.current) void runSync()
    }, 20_000)
    const onFocus = () => void runSync()
    window.addEventListener('focus', onFocus)
    return () => {
      stopInjection()
      stopIdle()
      clearInterval(iv)
      clearInterval(pull)
      window.removeEventListener('focus', onFocus)
    }
  }, [phase, policy, lock, trip])

  // Other tabs.
  useEffect(() => {
    channel.current = tabChannel((m) => {
      if (m.email !== email) return
      if (m.type === 'lock' && sessionRef.current) {
        dropKeys()
        setPhase('locked')
      }
      if (m.type === 'shred') {
        dropKeys()
        void vault.getAccount(email).then((a) => setIncident(a?.incident ?? null))
        setPhase('shredded')
      }
    })
    return () => channel.current?.close()
  }, [email])

  const value = useMemo<Ctx>(
    () => ({
      phase, email, profile, receipts, incomes, tripLogs, log, policy, incident, toasts, toast, dismissToast, signUp, signIn, signOut, lock,
      verifySecondFactor, cancelSecondFactor, twoFactor, beginTwoFactor, confirmTwoFactor, disableTwoFactor, regenerateRecovery,
      saveReceipt, deleteReceipt, saveProfile, savePlan, saveIncome, deleteIncome, saveTripLog, savePolicy, changePassword, shredNow, tamperDrill,
      deleteAccount, acknowledgeIncident, cloudLinked, listDevices, signOutDevice, signOutOtherDevices, linkNow, reportSavings, membership, pass, hasPass, refreshPass, startCheckout, myReview, submitReview,
    }),
    [phase, email, profile, receipts, incomes, tripLogs, log, policy, incident, toasts, toast, dismissToast, signUp, signIn, signOut, lock,
      verifySecondFactor, cancelSecondFactor, twoFactor, beginTwoFactor, confirmTwoFactor, disableTwoFactor, regenerateRecovery,
      saveReceipt, deleteReceipt, saveProfile, savePlan, saveIncome, deleteIncome, saveTripLog, savePolicy, changePassword, shredNow, tamperDrill,
      deleteAccount, acknowledgeIncident, cloudLinked, listDevices, signOutDevice, signOutOtherDevices, linkNow, reportSavings, membership, pass, hasPass, refreshPass, startCheckout, myReview, submitReview],
  )
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession() {
  const v = useContext(SessionCtx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
