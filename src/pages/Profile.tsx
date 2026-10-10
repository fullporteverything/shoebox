import React, { useState } from 'react'
import { Icon } from '../components/icons.js'
import { navigate } from '../lib/router.js'
import { PageTitle } from '../components/Shell.js'
import { Avatar, Drawer, Link, Seg } from '../components/ui.js'
import { RecoveryCodes, TwoFactorSetup } from '../components/TwoFactorSetup.js'
import { TERMS_VERSION } from '../legal/content.js'
import { passwordStrength } from '../lib/crypto.js'
import { useSession } from '../lib/session.js'
import { states } from '../lib/tax/states.js'
import type { FilingStatus, Profile as P, WorkType } from '../lib/types.js'
import { Select } from '../components/Select.js'

function TwoFactorCard() {
  const { twoFactor, disableTwoFactor, regenerateRecovery, toast } = useSession()
  const [mode, setMode] = useState<null | 'setup' | 'disable' | 'regen'>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const close = () => { setMode(null); setCode(''); setError(''); setCodes(null) }
  return (
    <div className="card rise">
      <div className="card-head">
        <h2>Two-factor authentication</h2>
        <span className={'chip ' + (twoFactor.enabled ? 'good' : 'warn')}><span className="dot" /> {twoFactor.enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        {twoFactor.enabled
          ? `Every sign-in asks for a code from your authenticator app. ${twoFactor.recoveryLeft} recovery code${twoFactor.recoveryLeft === 1 ? '' : 's'} left.`
          : 'Add a code from your phone to every sign-in, so a stolen password alone can’t open your vault.'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        {twoFactor.enabled ? (
          <>
            <button className="btn btn-sm" onClick={() => setMode('regen')}><Icon name="key" /> New recovery codes</button>
            <button className="btn btn-sm btn-danger" onClick={() => setMode('disable')}>Turn off</button>
          </>
        ) : (
          <button className="btn btn-gold" onClick={() => setMode('setup')}><Icon name="shield" /> Turn on two-factor</button>
        )}
      </div>
      {mode === 'setup' && (
        <Drawer eyebrow="Settings" title="Set up two-factor" onClose={close}>
          <TwoFactorSetup onDone={() => { close(); toast('good', 'Two-factor is on. You’ll be asked for a code at every sign-in.') }} />
        </Drawer>
      )}
      {(mode === 'disable' || mode === 'regen') && (
        <Drawer eyebrow="Settings" title={mode === 'disable' ? 'Turn off two-factor' : 'New recovery codes'} onClose={close}>
          {codes ? (
            <RecoveryCodes codes={codes} onDone={() => { close(); toast('good', 'New recovery codes saved. The old ones no longer work.') }} doneLabel="Done" />
          ) : (
            <form className="stack" style={{ gap: 14 }} onSubmit={async (e) => {
              e.preventDefault()
              setError('')
              if (mode === 'disable') {
                if (await disableTwoFactor(code)) { close(); toast('warn', 'Two-factor is off.') }
                else setError('That code didn’t work.')
              } else {
                const c = await regenerateRecovery(code)
                if (c) setCodes(c)
                else setError('That code didn’t work.')
              }
            }}>
              <p className="muted" style={{ fontSize: 14 }}>{mode === 'disable' ? 'Confirm with a code from your authenticator app, or a recovery code. Your vault will then open with just your password.' : 'Confirm with a current code. Your old recovery codes stop working.'}</p>
              <div className="field">
                <label htmlFor="tf-confirm">Code</label>
                <input id="tf-confirm" className="input code-input" autoComplete="one-time-code" placeholder="123456 or abcd-efgh" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              {error && <div className="error"><Icon name="alert" size={16} /> {error}</div>}
              <button className={'btn ' + (mode === 'disable' ? 'btn-danger' : 'btn-gold')} disabled={code.trim().length < 6}>{mode === 'disable' ? 'Turn off two-factor' : 'Make new codes'}</button>
            </form>
          )}
        </Drawer>
      )}
    </div>
  )
}

export function Profile({ tab }: { tab: 'profile' | 'settings' }) {
  const { profile, saveProfile, changePassword, deleteAccount, signOut, toast } = useSession()
  const [p, setP] = useState<P | null>(profile)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState('')
  if (!profile || !p) return null
  const dirty = JSON.stringify(p) !== JSON.stringify(profile)
  const strength = passwordStrength(next)

  return (
    <>
      <PageTitle
        eyebrow="Profile"
        title={profile.name}
        sub="These details change how documents are sorted. When you save, every receipt you haven’t overridden is re-checked against the new rules."
        actions={<button className="btn" onClick={signOut}><Icon name="logout" /> Sign out</button>}
      />
      <div style={{ marginBottom: 18 }}>
        <Seg label="Section" value={tab} onChange={(v) => navigate(v === 'settings' ? '/app/profile/settings' : '/app/profile')} options={[{ value: 'profile', label: 'Profile' }, { value: 'settings', label: 'Settings' }]} />
      </div>
      {tab === 'profile' ? (
      <div className="split">
        <div className="stack">
          <form
            className="card rise"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              await saveProfile(p)
              setBusy(false)
              toast('good', 'Profile saved and receipts re-sorted.')
            }}
          >
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
              <button type="button" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setP({ ...p, avatarHue: (p.avatarHue + 47) % 360 })} title="Change color">
                <Avatar name={p.name} hue={p.avatarHue} size={64} />
              </button>
              <div>
                <div style={{ fontWeight: 650, fontSize: 18 }}>{p.name || 'Your name'}</div>
                <div className="faint">{profile.email}</div>
              </div>
            </div>
            <div className="stack" style={{ gap: 16 }}>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="pf-name">Name</label>
                  <input id="pf-name" className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="pf-state">State</label>
                  <Select id="pf-state" value={p.state} onChange={(v) => setP({ ...p, state: v })} options={states.map((s) => ({ value: s.code, label: s.name }))} />
                </div>
              </div>
              <div className="field">
                <span className="label">How you earn</span>
                <Seg label="How you earn" value={p.workType} onChange={(v: WorkType) => setP({ ...p, workType: v })} options={[{ value: 'self_employed', label: 'Self-employed' }, { value: 'both', label: 'Both' }, { value: 'w2', label: 'W-2 only' }]} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="pf-filing">Filing status</label>
                  <Select id="pf-filing" value={p.filingStatus} onChange={(v) => setP({ ...p, filingStatus: v })} options={[{ value: 'single', label: 'Single' }, { value: 'married_joint', label: 'Married filing jointly' }, { value: 'married_separate', label: 'Married filing separately' }, { value: 'head_of_household', label: 'Head of household' }] as { value: FilingStatus; label: string }[]} />
                </div>
                <div className="field">
                  <label htmlFor="pf-year">Tax year</label>
                  <Select id="pf-year" value={p.taxYear} onChange={(v) => setP({ ...p, taxYear: v })} options={[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => ({ value: y, label: String(y), hint: y === 2026 ? 'Estimates available' : undefined }))} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="pf-biz">Business name</label>
                <input id="pf-biz" className="input" value={p.businessName} onChange={(e) => setP({ ...p, businessName: e.target.value })} disabled={p.workType === 'w2'} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" disabled={!dirty} onClick={() => setP(profile)}>Reset</button>
                <button className="btn btn-gold" disabled={!dirty || busy}>{busy ? 'Re-sorting…' : 'Save changes'}</button>
              </div>
            </div>
          </form>
        </div>
        <div className="stack">
          <div className="card rise">
            <div className="card-head"><h2>Security settings</h2></div>
            <p className="muted" style={{ fontSize: 14 }}>Two-factor sign-in, password, agreements and account deletion are on the Settings tab.</p>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/app/profile/settings')}><Icon name="shield" /> Open settings</button>
          </div>
        </div>
      </div>
      ) : (
      <div className="split">
        <div className="stack">
          <TwoFactorCard />
          <form
            className="card rise"
            style={{ animationDelay: '0.08s' }}
            onSubmit={async (e) => {
              e.preventDefault()
              if (strength.score < 3) return setPwMsg('Pick a stronger new password.')
              try {
                await changePassword(cur, next)
                setCur('')
                setNext('')
                setPwMsg('')
                toast('good', 'Password changed.')
              } catch (err) {
                setPwMsg(err instanceof Error ? err.message : 'Couldn’t change the password.')
              }
            }}
          >
            <div className="card-head"><h2>Password</h2></div>
            <div className="stack" style={{ gap: 12 }}>
              <div className="field">
                <label htmlFor="pf-cur">Current password</label>
                <input id="pf-cur" className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required />
              </div>
              <div className="field">
                <label htmlFor="pf-new">New password</label>
                <input id="pf-new" className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
                <div className="meter" data-s={strength.score}><i /><i /><i /><i /></div>
              </div>
              {pwMsg && <div className="error"><Icon name="alert" size={16} /> {pwMsg}</div>}
              <button className="btn">Change password</button>
              <p className="hint">Only the key wrapper changes, so this is instant. Your receipts stay encrypted with the same data key.</p>
            </div>
          </form>
        </div>
        <div className="stack">
          <div className="card rise" style={{ animationDelay: '0.12s' }}>
            <div className="card-head"><h2>Agreements</h2></div>
            <p className="muted" style={{ fontSize: 14 }}>You accepted the terms version {TERMS_VERSION}.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <Link to="/legal/terms" className="btn btn-sm">Terms</Link>
              <Link to="/legal/privacy" className="btn btn-sm">Privacy</Link>
              <Link to="/legal/security" className="btn btn-sm">Security</Link>
              <Link to="/legal/disclaimer" className="btn btn-sm">Disclaimer</Link>
            </div>
          </div>
          <div className="card danger-zone rise" style={{ animationDelay: '0.16s' }}>
            <div className="card-head"><h2>Delete account</h2></div>
            <p className="hint">Erases your vault and account from this device. Type your email to confirm.</p>
            <input id="pf-del" className="input" style={{ marginTop: 10 }} value={del} onChange={(e) => setDel(e.target.value)} placeholder={profile.email} aria-label="Type your email to confirm" />
            <button className="btn btn-danger" style={{ marginTop: 10 }} disabled={del.trim().toLowerCase() !== profile.email} onClick={() => void deleteAccount()}>
              <Icon name="trash" /> Delete everything
            </button>
          </div>
        </div>
      </div>
      )}
    </>
  )
}
