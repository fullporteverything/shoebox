import React, { useEffect, useState } from 'react'
import { Icon } from '../components/icons.js'
import { Link, Seg } from '../components/ui.js'
import { passwordStrength } from '../lib/crypto.js'
import { navigate, afterSignIn } from '../lib/router.js'
import { useSession } from '../lib/session.js'
import { states } from '../lib/tax/states.js'
import type { FilingStatus, Profile, WorkType } from '../lib/types.js'
import { PublicFrame } from './Public.js'
import { CodeInput, TwoFactorSetup } from '../components/TwoFactorSetup.js'
import { Select } from '../components/Select.js'

function PasswordInput({ id, value, onChange, autoComplete, invalid }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="pw-wrap">
      <input id={id} className={'input' + (invalid ? ' bad' : '')} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required style={{ paddingRight: 46 }} />
      <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  )
}

function useCountdown(until?: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!until || until < Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [until])
  return until && until > now ? Math.ceil((until - now) / 1000) : 0
}

function SecondFactor() {
  const { verifySecondFactor, cancelSecondFactor, email } = useSession()
  const [recovery, setRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [until, setUntil] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const wait = useCountdown(until)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const res = await verifySecondFactor(code, recovery)
    setBusy(false)
    if (res.error === 'shredded') return
    if (res.error) {
      setError(res.error)
      setUntil(res.until)
      setShake((x) => x + 1)
      setCode('')
    } else navigate(afterSignIn(), { replace: true })
  }
  return (
    <PublicFrame>
      <div className="auth">
        <div className={'auth-card glass-card glow-border' + (shake ? ' shake' : '')} key={shake}>
          <div className="eyebrow">Step 2 of 2 · {email}</div>
          <h1>{recovery ? 'Use a recovery code' : 'Enter your code'}</h1>
          <p className="muted" style={{ marginTop: 8 }}>{recovery ? 'Each recovery code works once.' : 'Open your authenticator app and enter the 6-digit code for Shoebox.'}</p>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="sf-code">{recovery ? 'Recovery code' : 'Code'}</label>
              {recovery ? (
                <input id="sf-code" className="input code-input" placeholder="abcd-efgh" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
              ) : (
                <CodeInput id="sf-code" value={code} onChange={setCode} autoFocus />
              )}
            </div>
            {error && <div className="error" role="alert"><Icon name="alert" size={16} /> <span>{error}{wait ? ` Try again in ${wait}s.` : ''}</span></div>}
            <button className="btn btn-gold btn-lg" disabled={busy || wait > 0 || (!recovery && code.length !== 6) || (recovery && code.replace(/[^a-z0-9]/gi, '').length < 8)}>
              <Icon name="shield" /> {busy ? 'Checking…' : 'Verify and unlock'}
            </button>
          </form>
          <div className="alt" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setRecovery(!recovery); setCode(''); setError('') }}>{recovery ? 'Use authenticator code' : 'Lost your phone? Use a recovery code'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { cancelSecondFactor(); navigate('/signin', { replace: true }) }}>Cancel</button>
          </div>
        </div>
      </div>
    </PublicFrame>
  )
}

export function SignIn({ locked }: { locked?: boolean }) {
  const { signIn, email: lastEmail, phase } = useSession()
  const [email, setEmail] = useState(lastEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [until, setUntil] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const wait = useCountdown(until)

  if (phase === 'two_factor') return <SecondFactor />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await signIn(email, password)
    setBusy(false)
    if (res.needs2fa) return
    if (res.error === 'shredded') return
    if (res.error) {
      setError(res.error)
      setUntil(res.until)
      setShake((s) => s + 1)
      setPassword('')
    } else navigate(afterSignIn(), { replace: true })
  }

  return (
    <PublicFrame>
      <div className="auth">
        <div className={'auth-card glass-card glow-border' + (shake ? ' shake' : '')} key={shake}>
          <div className="eyebrow">{locked ? 'Vault locked' : 'Welcome back'}</div>
          <h1>{locked ? 'Unlock your vault' : 'Sign in'}</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            {locked ? 'Your keys were cleared from memory. Enter your password to decrypt your records again.' : 'Your password decrypts your vault on this device. We never see it.'}
          </p>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="si-email">Email</label>
              <input id="si-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            </div>
            <div className="field">
              <label htmlFor="si-pw">Password</label>
              <PasswordInput id="si-pw" value={password} onChange={setPassword} autoComplete="current-password" invalid={!!error} />
            </div>
            {error && <div className="error" role="alert"><Icon name="alert" size={16} /> <span>{error}{wait ? ` Try again in ${wait}s.` : ''}</span></div>}
            <button className="btn btn-gold btn-lg" disabled={busy || wait > 0}>
              {busy ? <><Icon name="key" className="spin" /> Deriving key…</> : <><Icon name="unlock" /> Unlock vault</>}
            </button>
          </form>
          <p className="alt">New here? <Link to="/signup">Create a vault</Link></p>
        </div>
      </div>
    </PublicFrame>
  )
}

const workTypes: { value: WorkType; label: string }[] = [
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'both', label: 'Both' },
  { value: 'w2', label: 'W-2 only' },
]

export function SignUp() {
  const { signUp } = useSession()
  const [step, setStep] = useState(0)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [state, setState] = useState('CA')
  const [workType, setWorkType] = useState<WorkType>('self_employed')
  const [filing, setFiling] = useState<FilingStatus>('single')
  const [businessName, setBusinessName] = useState('')
  const [agree, setAgree] = useState(false)
  const [understand, setUnderstand] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const strength = passwordStrength(password)

  const next = (e: React.FormEvent) => {
    e.preventDefault()
    if (strength.score < 3) return setError('Choose a stronger password. At least 12 characters with some variety, or a short phrase.')
    if (password !== confirm) return setError('The two passwords don’t match.')
    setError('')
    setStep(1)
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!agree || !understand) return setError('Please accept the terms and confirm you understand password recovery.')
    setBusy(true)
    setError('')
    try {
      const profile: Profile = {
        name: name.trim() || email.split('@')[0], email, state, workType, filingStatus: filing, businessName: businessName.trim(),
        // Through April most people are filing for last year.
        taxYear: new Date().getMonth() < 4 ? new Date().getFullYear() - 1 : new Date().getFullYear(), avatarHue: Math.floor(Math.random() * 360),
      }
      await signUp(email, password, profile)
      setBusy(false)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t create the vault.')
      setBusy(false)
    }
  }

  return (
    <PublicFrame>
      <div className="auth">
        <div className="auth-card glass-card glow-border" key={step}>
          <div className="eyebrow">Step {step + 1} of 3{step === 2 ? ' · optional' : ''}</div>
          <h1>{step === 0 ? 'Create your vault' : step === 1 ? 'Tell us how you file' : 'Add two-factor sign-in'}</h1>
          <div className="auth-steps"><i className="on" /><i className={step >= 1 ? 'on' : ''} /><i className={step === 2 ? 'on' : ''} /></div>
          {step === 2 ? (
            <div style={{ marginTop: 20 }}>
              <p className="muted" style={{ marginBottom: 16 }}>Your vault is ready. A code from your phone on every sign-in means a stolen password alone won’t open it.</p>
              <TwoFactorSetup onDone={() => navigate('/app/inbox', { replace: true })} onSkip={() => navigate('/app/inbox', { replace: true })} />
              <p className="hint" style={{ marginTop: 12 }}>Skipping is fine. You can turn it on later in Profile → Settings.</p>
            </div>
          ) : step === 0 ? (
            <form onSubmit={next}>
              <div className="field">
                <label htmlFor="su-email">Email</label>
                <input id="su-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
              </div>
              <div className="field">
                <label htmlFor="su-pw">Password</label>
                <PasswordInput id="su-pw" value={password} onChange={setPassword} autoComplete="new-password" />
                <div className="meter" data-s={strength.score}><i /><i /><i /><i /></div>
                <span className="hint">{strength.label} · {strength.hint}</span>
              </div>
              <div className="field">
                <label htmlFor="su-pw2">Confirm password</label>
                <PasswordInput id="su-pw2" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!confirm && confirm !== password} />
              </div>
              {error && <div className="error" role="alert"><Icon name="alert" size={16} /> {error}</div>}
              <button className="btn btn-gold btn-lg">Continue <Icon name="arrowRight" /></button>
            </form>
          ) : (
            <form onSubmit={create}>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="su-name">Your name</label>
                  <input id="su-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </div>
                <div className="field">
                  <label htmlFor="su-state">State you file in</label>
                  <Select id="su-state" value={state} onChange={setState} options={states.map((s) => ({ value: s.code, label: s.name }))} />
                </div>
              </div>
              <div className="field">
                <span className="label">How you earn</span>
                <Seg label="How you earn" value={workType} options={workTypes} onChange={setWorkType} />
                <span className="hint">This changes what counts. W-2 employees can’t deduct work expenses federally.</span>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="su-filing">Filing status</label>
                  <Select id="su-filing" value={filing} onChange={setFiling} options={[{ value: 'single', label: 'Single' }, { value: 'married_joint', label: 'Married filing jointly' }, { value: 'married_separate', label: 'Married filing separately' }, { value: 'head_of_household', label: 'Head of household' }] as { value: FilingStatus; label: string }[]} />
                </div>
                <div className="field">
                  <label htmlFor="su-biz">Business name (optional)</label>
                  <input id="su-biz" className="input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} disabled={workType === 'w2'} />
                </div>
              </div>
              <label className="check">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>I’m 18 or older and agree to the <Link to="/legal/terms">Terms of Service</Link> and <Link to="/legal/privacy">Privacy Policy</Link>, and I understand Shoebox <Link to="/legal/disclaimer">isn’t tax advice</Link>.</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={understand} onChange={(e) => setUnderstand(e.target.checked)} />
                <span>I understand my password can’t be recovered, and the vault may shred itself if it detects a breach. <Link to="/legal/security">How shredding works</Link></span>
              </label>
              {error && <div className="error" role="alert"><Icon name="alert" size={16} /> {error}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn btn-lg" onClick={() => setStep(0)}>Back</button>
                <button className="btn btn-gold btn-lg" style={{ flex: 1 }} disabled={busy}>
                  {busy ? <><Icon name="key" className="spin" /> Generating keys…</> : <><Icon name="lock" /> Create encrypted vault</>}
                </button>
              </div>
            </form>
          )}
          {step < 2 && <p className="alt">Already have one? <Link to="/signin">Sign in</Link></p>}
        </div>
      </div>
    </PublicFrame>
  )
}
