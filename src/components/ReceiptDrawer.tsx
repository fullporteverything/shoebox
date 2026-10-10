import React, { useState } from 'react'
import { useSession } from '../lib/session.js'
import { classify } from '../lib/tax/classify.js'
import { categories, categoryById, groupLabels } from '../lib/tax/rules.js'
import type { CategoryId } from '../lib/tax/rules.js'
import type { Receipt } from '../lib/types.js'
import { Icon } from './icons.js'
import { CatChip, CountUp, Drawer, money } from './ui.js'

const sourceLabel = { ai: 'AI suggestion, checked by the rules', rules: 'Matched by the rules engine', you: 'Set by you' }

export function ReceiptDrawer({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const { profile, saveReceipt, deleteReceipt, toast } = useSession()
  const [r, setR] = useState(receipt)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!profile) return null
  const cat = categoryById[r.classification.category]
  const isBusiness = cat.group === 'business'

  const recompute = (patch: Partial<Receipt>, override?: CategoryId) => {
    const next = { ...r, ...patch }
    const keepOverride = override ?? (next.classification.source === 'you' ? next.classification.category : undefined)
    next.classification = classify(next.extraction, profile, { override: keepOverride, businessPct: next.businessPct, source: r.classification.source === 'you' ? 'ai' : r.classification.source })
    setR(next)
  }

  const save = async (confirm: boolean) => {
    const next: Receipt = {
      ...r,
      status: confirm ? 'confirmed' : r.status,
      history: [...r.history, { at: Date.now(), what: confirm ? `Confirmed as ${categoryById[r.classification.category].label}` : 'Edited' }],
    }
    await saveReceipt(next)
    toast('good', confirm ? `Filed under ${categoryById[next.classification.category].label}.` : 'Saved.')
    onClose()
  }

  return (
    <Drawer
      onClose={onClose}
      eyebrow={r.extraction.date || 'No date'}
      title={r.extraction.merchant}
      footer={
        confirmDelete ? (
          <>
            <span className="muted" style={{ marginRight: 'auto', fontSize: 13.5 }}>Delete this receipt for good?</span>
            <button className="btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button className="btn btn-danger" onClick={async () => { await deleteReceipt(r.id); toast('info', 'Receipt deleted.'); onClose() }}>Delete</button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}><Icon name="trash" /> Delete</button>
            <button className="btn" onClick={() => save(false)}>Save</button>
            <button className="btn btn-gold" onClick={() => save(true)}><Icon name="check" /> {r.status === 'confirmed' ? 'Save and keep confirmed' : 'Confirm'}</button>
          </>
        )
      }
    >
      {r.image && (
        <div className="doc-preview">
          <img src={r.image} alt={`Scan of ${r.extraction.merchant}`} />
        </div>
      )}

      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">Counts toward deductions</div>
            <div className="big-amount" style={{ color: r.classification.deductible ? 'var(--gold-ink)' : 'var(--ink-3)' }}>
              <CountUp value={r.classification.deductible} />
            </div>
            <div className="faint" style={{ fontSize: 13 }}>of <span className="money">{money(r.extraction.total)}</span> paid · {cat.form}</div>
          </div>
          <span className={'chip ' + (r.status === 'confirmed' ? 'good' : 'warn')}>{r.status === 'confirmed' ? 'Confirmed' : 'Needs review'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <CatChip id={r.classification.category} />
          <span className="faint" style={{ fontSize: 12.5 }}>{sourceLabel[r.classification.source]} · {Math.round(r.classification.confidence * 100)}% sure</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="rd-cat">Category</label>
        <select id="rd-cat" className="select" value={r.classification.category} onChange={(e) => recompute({}, e.target.value as CategoryId)}>
          {(Object.keys(groupLabels) as (keyof typeof groupLabels)[]).map((g) => (
            <optgroup key={g} label={groupLabels[g]}>
              {categories.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {isBusiness && (
        <div className="field">
          <label htmlFor="rd-pct">Business use: {r.businessPct}%</label>
          <input id="rd-pct" type="range" min={0} max={100} step={5} value={r.businessPct} onChange={(e) => recompute({ businessPct: Number(e.target.value) })} style={{ accentColor: 'var(--gold)' }} />
          <span className="hint">For things you also use personally, such as a phone, car or internet, count only the business share.</span>
        </div>
      )}

      <div className="field">
        <label htmlFor="rd-purpose">{isBusiness ? 'Business purpose' : 'Note'}</label>
        <input
          id="rd-purpose"
          className="input"
          value={r.extraction.businessPurpose}
          placeholder={r.classification.category === 'meals' ? 'Who you met and what you discussed' : 'Why you bought it'}
          onChange={(e) => recompute({ extraction: { ...r.extraction, businessPurpose: e.target.value } })}
        />
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="eyebrow">Why it landed here</div>
        {r.classification.reasons.map((t) => <div key={t} className="reason"><Icon name="scale" /> <span>{t} <span className="faint">({cat.ruleRef})</span></span></div>)}
        {r.classification.flags.map((f) => <div key={f.text} className={'reason' + (f.level === 'warn' ? ' warn' : '')}><Icon name={f.level === 'warn' ? 'alert' : 'info'} /> <span>{f.text}</span></div>)}
        {r.classification.stateNotes.map((t) => <div key={t} className="reason state"><Icon name="pin" /> <span>{t}</span></div>)}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="eyebrow">What was read</div>
        <dl className="kv">
          <dt>Merchant</dt><dd>{r.extraction.merchant}</dd>
          <dt>Date</dt><dd>{r.extraction.date || '—'}</dd>
          <dt>Total</dt><dd className="money">{money(r.extraction.total)}</dd>
          {r.extraction.tax != null && <><dt>Tax</dt><dd className="money">{money(r.extraction.tax)}</dd></>}
          {r.extraction.tip != null && r.extraction.tip > 0 && <><dt>Tip</dt><dd className="money">{money(r.extraction.tip)}</dd></>}
          {r.extraction.paymentMethod && <><dt>Paid with</dt><dd>{r.extraction.paymentMethod}</dd></>}
          {r.extraction.formType && <><dt>Form</dt><dd>{r.extraction.formType}</dd></>}
          {r.extraction.notes && <><dt>Notes</dt><dd>{r.extraction.notes}</dd></>}
        </dl>
        {r.extraction.lineItems.length > 0 && (
          <div className="glass-card" style={{ padding: '6px 14px', borderRadius: 14 }}>
            {r.extraction.lineItems.map((l, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: i < r.extraction.lineItems.length - 1 ? '1px solid var(--glass-border)' : 0, fontSize: 13.5 }}>
                <span>{l.description}</span>
                <span className="money">{money(l.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">History</div>
        {r.history.map((h, i) => (
          <div key={i} className="faint" style={{ fontSize: 12.5 }}>{new Date(h.at).toLocaleString()} · {h.what}</div>
        ))}
      </div>
    </Drawer>
  )
}
