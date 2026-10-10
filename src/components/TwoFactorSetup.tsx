import React, { useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { useSession } from '../lib/session.js'
import { Icon } from './icons.js'

function Qr({ text }: { text: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    return qr.createDataURL(5, 2)
  }, [text])
  return <img className="qr" src={src} alt="QR code for your authenticator app" width={196} height={196} />
}

export function CodeInput({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      id={id}
      className="input code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={7}
      placeholder="123456"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
    />
  )
}

export function RecoveryCodes({ codes, onDone, doneLabel = 'I saved them' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const { toast } = useSession()
  const [saved, setSaved] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      toast('good', 'Recovery codes copied.')
    } catch {
      toast('info', 'Copy didn’t work here. Select the codes and copy them by hand.')
    }
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="muted" style={{ fontSize: 14 }}>If you lose your phone, each of these codes gets you in once. Save them somewhere safe, like a password manager. This is the only time you’ll see them.</p>
      <div className="recovery">{codes.map((c) => <code key={c}>{c}</code>)}</div>
      <button type="button" className="btn btn-sm" onClick={copy}><Icon name="doc" /> Copy all</button>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I’ve stored these codes somewhere safe.</span>
      </label>
      <button type="button" className="btn btn-gold" disabled={!saved} onClick={onDone}><Icon name="check" /> {doneLabel}</button>
    </div>
  )
}

// Scan → confirm a code → save recovery codes.
export function TwoFactorSetup({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const { beginTwoFactor, confirmTwoFactor } = useSession()
  const [{ secret, uri }] = useState(beginTwoFactor)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [showKey, setShowKey] = useState(false)

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />

  return (
    <form
      className="stack"
      style={{ gap: 16 }}
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        const c = await confirmTwoFactor(secret, code)
        setBusy(false)
        if (c) setCodes(c)
        else setError('That code didn’t match. Check the time on your phone is set automatically, then try the newest code.')
      }}
    >
      <div className="tf-setup">
        <div className="qr-tile"><Qr text={uri} /></div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="reason"><span className="step-n">1</span><span>Open an authenticator app, such as Google Authenticator, 1Password, Authy or your phone’s password app.</span></div>
          <div className="reason"><span className="step-n">2</span><span>Scan this code, or enter the setup key by hand.</span></div>
          <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'} setup key</button>
          {showKey && <code className="setup-key">{secret.match(/.{1,4}/g)!.join(' ')}</code>}
          <div className="reason"><span className="step-n">3</span><span>Type the 6-digit code it shows.</span></div>
        </div>
      </div>
      <div className="field">
        <label htmlFor="tf-code">Code from your app</label>
        <CodeInput id="tf-code" value={code} onChange={setCode} />
      </div>
      {error && <div className="error" role="alert"><Icon name="alert" size={16} /> {error}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {onSkip && <button type="button" className="btn btn-ghost" onClick={onSkip}>Skip for now</button>}
        <button className="btn btn-gold" style={{ marginLeft: 'auto' }} disabled={code.length !== 6 || busy}><Icon name="shield" /> {busy ? 'Checking…' : 'Turn on two-factor'}</button>
      </div>
    </form>
  )
}
