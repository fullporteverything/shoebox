import React, { useState } from 'react'
import { Icon } from '../components/icons.js'
import { PageTitle } from '../components/Shell.js'
import { Avatar, Link, Seg } from '../components/ui.js'
import { TERMS_VERSION } from '../legal/content.js'
import { passwordStrength } from '../lib/crypto.js'
import { useSession } from '../lib/session.js'
import { states } from '../lib/tax/states.js'
import type { FilingStatus, Profile as P, WorkType } from '../lib/types.js'

export function Profile() {
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
                  <select id="pf-state" className="select" value={p.state} onChange={(e) => setP({ ...p, state: e.target.value })}>
                    {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <span className="label">How you earn</span>
                <Seg label="How you earn" value={p.workType} onChange={(v: WorkType) => setP({ ...p, workType: v })} options={[{ value: 'self_employed', label: 'Self-employed' }, { value: 'both', label: 'Both' }, { value: 'w2', label: 'W-2 only' }]} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="pf-filing">Filing status</label>
                  <select id="pf-filing" className="select" value={p.filingStatus} onChange={(e) => setP({ ...p, filingStatus: e.target.value as FilingStatus })}>
                    <option value="single">Single</option>
                    <option value="married_joint">Married filing jointly</option>
                    <option value="married_separate">Married filing separately</option>
                    <option value="head_of_household">Head of household</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="pf-year">Tax year</label>
                  <select id="pf-year" className="select" value={p.taxYear} onChange={(e) => setP({ ...p, taxYear: Number(e.target.value) })}>
                    {[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
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
    </>
  )
}
