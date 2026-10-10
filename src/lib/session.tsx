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
import { sha256 } from './crypto.js'

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
    async (targetEmail: string, sensor: string, detail: string, broadcast = true) => {
      dropKeys()
      try {
        const inc = await vault.shred(targetEmail, { at: Date.now(), sensor, detail })
        setIncident(inc)
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
      const s = await vault.createAccount(rawEmail, password, TERMS_VERSION)
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
    },
    [addLog],
  )

  const signIn = useCallback(
    async (rawEmail: string, password: string): Promise<{ error?: string; until?: number; needs2fa?: boolean }> => {
      const em = rawEmail.trim().toLowerCase()
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

  const completeUnlock = async (res: vault.UnlockResult, how = '') => {
    sessionRef.current = res.session
    pendingRef.current = null
    hydrate(res.records)
    setPhase('unlocked')
    addLog({ level: 'info', text: (res.failedBefore ? `Unlocked after ${res.failedBefore} failed attempt${res.failedBefore > 1 ? 's' : ''}` : 'Unlocked') + how + '.' })
    if (res.fingerprintChanged) await trip('fingerprint', 'alert', 'This unlock came from a different browser or time zone than last time. If it wasn’t you, change your password.')
  }

  const verifySecondFactor = useCallback(
    async (code: string, recovery: boolean): Promise<{ error?: string; until?: number }> => {
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
      await vault.setTwoFactorHint(email, true)
      setTf(next)
      addLog({ level: 'info', text: 'Two-factor authentication turned on.' })
      return codes
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addLog, email],
  )

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
      setTf(next)
      addLog({ level: 'info', text: 'New recovery codes generated; the old ones stopped working.' })
      return codes
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tf, addLog],
  )

  const twoFactor = useMemo(() => ({ enabled: !!tf?.enabled, recoveryLeft: tf?.recovery.length ?? 0, enabledAt: tf?.enabled ? tf.enabledAt : null }), [tf])

  const signOut = useCallback(() => {
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
          : { ...r, classification: classify(r.extraction, p, { businessPct: r.businessPct, source: r.classification.source, usdAmount: r.usdAmount }) },
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
    dropKeys()
    await vault.deleteAccount(em)
    writeLastEmail(null)
    setEmail('')
    setPhase('signed_out')
  }, [email])

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
    return () => {
      stopInjection()
      stopIdle()
      clearInterval(iv)
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
      deleteAccount, acknowledgeIncident,
    }),
    [phase, email, profile, receipts, incomes, tripLogs, log, policy, incident, toasts, toast, dismissToast, signUp, signIn, signOut, lock,
      verifySecondFactor, cancelSecondFactor, twoFactor, beginTwoFactor, confirmTwoFactor, disableTwoFactor, regenerateRecovery,
      saveReceipt, deleteReceipt, saveProfile, savePlan, saveIncome, deleteIncome, saveTripLog, savePolicy, changePassword, shredNow, tamperDrill,
      deleteAccount, acknowledgeIncident],
  )
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession() {
  const v = useContext(SessionCtx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
