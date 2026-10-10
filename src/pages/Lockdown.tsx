import React from 'react'
import { Icon } from '../components/icons.js'
import { navigate } from '../lib/router.js'
import { useSession } from '../lib/session.js'

export function Lockdown() {
  const { incident, acknowledgeIncident, email } = useSession()
  const strips = Array.from({ length: 34 }, (_, i) => i)
  return (
    <div className="lockdown" role="alertdialog" aria-labelledby="ld-title">
      <div className="strips" aria-hidden="true">
        {strips.map((i) => (
          <i key={i} style={{ left: `${(i * 37) % 100}%`, ['--i' as string]: i, ['--r' as string]: `${((i * 53) % 60) - 30}deg`, height: `${18 + ((i * 13) % 20)}vh` }} />
        ))}
      </div>
      <div className="panel glass-card">
        <span className="chip bad"><Icon name="fire" size={14} /> Vault shredded</span>
        <h1 id="ld-title" style={{ marginTop: 14 }}>We destroyed your data to protect it.</h1>
        <p className="muted" style={{ marginTop: 10 }}>
          {incident?.sensor ?? 'A breach sensor'} fired{incident ? ` at ${new Date(incident.at).toLocaleString()}` : ''}. {incident?.detail}
        </p>
        <div className="destroyed">
          {(incident?.destroyed ?? ['Encryption key']).map((d, i) => (
            <div key={d} style={{ ['--i' as string]: i }}><Icon name="x" /> {d} destroyed</div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          Without the key, nothing that was stored can be decrypted by anyone, including us. If this wasn’t expected, treat the device as compromised: run a malware
          scan and change passwords you’ve used on it. Then you can start a fresh vault{email ? ` for ${email}` : ''}.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <button className="btn btn-gold" onClick={() => { acknowledgeIncident(); navigate('/signup', { replace: true }) }}>Start a fresh vault</button>
          <button className="btn" onClick={() => { acknowledgeIncident(); navigate('/legal/security', { replace: true }) }}>What happened?</button>
        </div>
      </div>
    </div>
  )
}
