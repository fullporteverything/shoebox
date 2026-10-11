import React, { useState } from 'react'
import { Icon } from '../components/icons.js'
import type { IconName } from '../components/icons.js'
import { PageTitle } from '../components/Shell.js'
import { Count, Link, Seg, Switch } from '../components/ui.js'
import { PBKDF2_ITERATIONS } from '../lib/crypto.js'
import { sensors } from '../lib/sentinel.js'
import type { SensorId } from '../lib/sentinel.js'
import { useSession } from '../lib/session.js'
import { startTour } from '../components/Tour.js'
import type { Policy } from '../lib/vault.js'

const sensorIcon: Record<SensorId, IconName> = { integrity: 'key', bruteforce: 'lock', injection: 'code', fingerprint: 'fingerprint', idle: 'clock', crosstab: 'tabs' }
const actionCopy = { alert: 'Alerts you', lock: 'Locks the vault', shred: 'Shreds the vault', policy: 'Lockout, then shred' }
const levelColor = { info: 'var(--sea)', alert: 'var(--warn)', lock: 'var(--info)', shred: 'var(--bad)' }

function ConfirmBox({ phrase, label, onConfirm, onCancel }: { phrase: string; label: string; onConfirm: () => void; onCancel: () => void }) {
  const [v, setV] = useState('')
  return (
    <div className="stack rise" style={{ gap: 10, marginTop: 12 }}>
      <label className="hint" htmlFor={`cf-${phrase}`}>Type <b className="money" style={{ color: 'var(--bad)' }}>{phrase}</b> to continue. This can’t be undone.</label>
      <input id={`cf-${phrase}`} className="input" value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-danger" disabled={v !== phrase} onClick={onConfirm}><Icon name="fire" /> {label}</button>
      </div>
    </div>
  )
}

export function Security() {
  const { policy, savePolicy, log, lock, shredNow, tamperDrill, toast, twoFactor } = useSession()
  const [confirm, setConfirm] = useState<null | 'drill' | 'shred'>(null)
  const set = (p: Partial<Policy>) => void savePolicy({ ...policy, ...p }).then(() => toast('good', 'Security policy saved.'))
  const recentTrips = log.filter((l) => l.level !== 'info').length

  return (
    <>
      <PageTitle
        eyebrow="Security center"
        title="Watching, so you don’t have to."
        sub="Your vault is encrypted on this device, and the sensors below watch for signs of a breach. If one fires, the response is automatic."
        actions={
          <>
            <button className="btn btn-ghost" onClick={startTour}><Icon name="sparkle" /> Take the tour</button>
            <button className="btn" onClick={() => lock('Locked by you.')}><Icon name="lock" /> Lock now</button>
          </>
        }
      />

      <div className="split">
        <div className="stack">
          <div className="card rise glow-border radar-card">
            <div className="radar" aria-hidden="true">
              <div className="ring" /><div className="ring" /><div className="ring" />
              <div className="sweep" />
              {[[30, 50], [150, 40], [170, 150], [60, 170], [100, 18], [20, 110]].map(([x, y], i) => (
                <span key={i} className="blip" style={{ left: x, top: y, animationDelay: `${i * 0.66}s` }} />
              ))}
              <div className="core"><Icon name="shield" /></div>
            </div>
            <div>
              <span className="chip good"><span className="dot" /> All sensors armed</span>
              <h2 style={{ fontSize: 26, marginTop: 12 }}><Count v={sensors.length} /> sensors on watch</h2>
              <p className="muted" style={{ marginTop: 8 }}>
                {recentTrips ? `${recentTrips} event${recentTrips > 1 ? 's' : ''} in your log need a look.` : 'Nothing suspicious so far.'} Keys are derived with PBKDF2 at{' '}
                {PBKDF2_ITERATIONS.toLocaleString()} iterations and every record is sealed with AES-256-GCM.
              </p>
            </div>
          </div>

          <div className="card rise" style={{ animationDelay: '0.08s' }}>
            <div className="card-head"><h2>Breach sensors</h2><span className="faint" style={{ fontSize: 13 }}>What each one does when it fires</span></div>
            {sensors.map((s) => {
              const act = s.action(policy.strict)
              return (
                <div key={s.id} className="sensor">
                  <span className="ic"><Icon name={sensorIcon[s.id]} /></span>
                  <div>
                    <h4>{s.name}</h4>
                    <p>{s.watches}</p>
                  </div>
                  <span className={'chip ' + (act === 'shred' ? 'bad' : act === 'lock' || act === 'policy' ? 'gold' : 'sea')}>{actionCopy[act]}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="stack">
          <div className="card rise" style={{ animationDelay: '0.1s' }}>
            <div className="card-head"><h2>Two-factor sign-in</h2><span className={'chip ' + (twoFactor.enabled ? 'good' : 'warn')}><span className="dot" /> {twoFactor.enabled ? 'On' : 'Off'}</span></div>
            <p className="muted" style={{ fontSize: 14 }}>{twoFactor.enabled ? 'A code from your authenticator app is required at every sign-in. Wrong codes count toward your shred limit.' : 'Turn it on so a stolen password alone can’t open your vault.'}</p>
            <Link to="/app/profile/settings" className="btn btn-sm" style={{ marginTop: 12 }}><Icon name="shield" /> {twoFactor.enabled ? 'Manage' : 'Turn on'}</Link>
          </div>
          <div className="card rise" style={{ animationDelay: '0.12s' }}>
            <div className="card-head"><h2>Policy</h2></div>
            <div className="stack" style={{ gap: 18 }}>
              <div className="field">
                <span className="label">Shred after this many wrong two-factor codes</span>
                <Seg label="Wipe after" value={policy.wipeAfter} onChange={(v) => set({ wipeAfter: v })} options={[{ value: 5, label: '5' }, { value: 10, label: '10' }, { value: 0, label: 'Never' }]} />
                <span className="hint">Counts wrong codes entered after the right password, the sign that someone has it. Wrong passwords alone only lock the account: 3 misses, then waits that double up to an hour. Without two-factor, the limit applies to this device’s offline copy.</span>
              </div>
              <div className="field">
                <span className="label">Lock when idle for</span>
                <Seg label="Idle lock" value={policy.autoLockMin} onChange={(v) => set({ autoLockMin: v })} options={[{ value: 5, label: '5 min' }, { value: 15, label: '15 min' }, { value: 30, label: '30 min' }]} />
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <Switch checked={policy.strict} onChange={(v) => set({ strict: v })} label="Strict mode" />
                <div>
                  <div style={{ fontWeight: 600 }}>Strict mode</div>
                  <div className="hint">Shred, not just lock, when code is injected into the page. Turn this on if you only use Shoebox on a clean browser with no extensions.</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card rise" style={{ animationDelay: '0.16s' }}>
            <div className="card-head"><h2>Event log</h2><span className="faint" style={{ fontSize: 13 }}>Stored encrypted</span></div>
            <div className="log">
              {log.length === 0 && <p className="faint">No events yet.</p>}
              {log.map((l, i) => (
                <div key={i} className="log-row">
                  <time>{new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                  <span className="lv" style={{ background: levelColor[l.level] }} />
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card danger-zone rise" style={{ animationDelay: '0.2s' }}>
            <div className="card-head"><h2>Danger zone</h2></div>
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <div style={{ fontWeight: 600 }}>Run a tamper drill</div>
                <p className="hint" style={{ marginTop: 4 }}>Corrupts one stored record on purpose so you can watch the integrity sensor catch it and shred the vault. All your data will be destroyed.</p>
                {confirm === 'drill' ? (
                  <ConfirmBox phrase="DRILL" label="Run drill" onCancel={() => setConfirm(null)} onConfirm={() => void tamperDrill()} />
                ) : (
                  <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setConfirm('drill')}><Icon name="code" /> Start drill</button>
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>Shred now</div>
                <p className="hint" style={{ marginTop: 4 }}>Destroy the key and every record immediately, for example if your device was stolen while unlocked.</p>
                {confirm === 'shred' ? (
                  <ConfirmBox phrase="SHRED" label="Shred everything" onCancel={() => setConfirm(null)} onConfirm={() => void shredNow('You started a manual shred from the Security center.')} />
                ) : (
                  <button className="btn btn-sm btn-danger" style={{ marginTop: 10 }} onClick={() => setConfirm('shred')}><Icon name="fire" /> Shred vault</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
