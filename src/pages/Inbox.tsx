import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/icons.js'
import { ReceiptDrawer } from '../components/ReceiptDrawer.js'
import { PageTitle } from '../components/Shell.js'
import { CatChip, money, paid } from '../components/ui.js'
import { AnalyzeError, analyze, detectEngine } from '../lib/ai.js'
import type { Engine } from '../lib/ai.js'
import { randomId } from '../lib/crypto.js'
import { prepareImage } from '../lib/image.js'
import { makeSamples } from '../lib/samples.js'
import { useSession } from '../lib/session.js'
import { classify, keywordCategory } from '../lib/tax/classify.js'
import { categories } from '../lib/tax/rules.js'
import type { CategoryId } from '../lib/tax/rules.js'
import type { Extraction, Receipt } from '../lib/types.js'

type Item = {
  key: string
  fileName: string
  dataUrl: string
  blob: Blob
  stage: 'reading' | 'manual' | 'done' | 'error'
  receiptId?: string
  error?: string
  truth?: Extraction
}

const blankExtraction = (merchant: string, total: number, date: string, notes: string, cat?: CategoryId): Extraction => ({
  documentType: 'receipt', merchant: merchant || 'Unknown merchant', date, total, tax: null, tip: null, currency: 'USD', paymentMethod: null,
  lineItems: [], formType: null, suggestedCategory: cat ?? keywordCategory(`${merchant} ${notes}`)?.id ?? ('nonsense' as CategoryId),
  businessPurpose: notes, confidence: cat ? 1 : 0.6, notes: '', city: null, country: null, usdTotal: null,
})

function ManualForm({ item, onSubmit, onCancel }: { item: Item; onSubmit: (ex: Extraction, cat?: CategoryId) => void; onCancel: () => void }) {
  const [merchant, setMerchant] = useState('')
  const [total, setTotal] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [cat, setCat] = useState<'' | CategoryId>('')
  const id = item.key
  return (
    <form
      className="stack"
      style={{ gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(blankExtraction(merchant, parseFloat(total) || 0, date, notes, cat || undefined), cat || undefined)
      }}
    >
      {item.error && <div className="hint" style={{ color: 'var(--warn)' }}>{item.error}</div>}
      <div className="grid-2">
        <input aria-label="Merchant" id={`m-${id}`} className="input" placeholder="Merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} required />
        <input aria-label="Total" id={`t-${id}`} className="input" placeholder="Total, e.g. 42.10" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} required />
      </div>
      <div className="grid-2">
        <input aria-label="Date" id={`d-${id}`} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select aria-label="Category" id={`c-${id}`} className="select" value={cat} onChange={(e) => setCat(e.target.value as CategoryId)}>
          <option value="">Let the rules decide</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <input aria-label="What it was for" id={`n-${id}`} className="input" placeholder="What it was for (helps the rules)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Discard</button>
        <button className="btn btn-sm btn-gold" style={{ marginLeft: 'auto' }}>Sort it</button>
      </div>
    </form>
  )
}

export function Inbox() {
  const { profile, receipts, saveReceipt, toast } = useSession()
  const [engine, setEngine] = useState<Engine | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [over, setOver] = useState(false)
  const [open, setOpen] = useState<Receipt | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  useEffect(() => void detectEngine().then(setEngine), [])
  if (!profile) return null

  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)))

  const file = async (ex: Extraction, item: Item, source: 'ai' | 'rules' | 'you', override?: CategoryId) => {
    const r: Receipt = {
      id: randomId(),
      createdAt: Date.now(),
      fileName: item.fileName,
      image: item.dataUrl,
      extraction: ex,
      classification: classify(ex, profile, { source, override }),
      status: 'needs_review',
      businessPct: 100,
      memo: '',
      history: [{ at: Date.now(), what: source === 'ai' ? 'Read by Claude and checked by the rules engine' : source === 'you' ? 'Entered by you' : 'Sorted by the rules engine' }],
    }
    await saveReceipt(r)
    patch(item.key, { stage: 'done', receiptId: r.id })
  }

  const run = async (item: Item, eng: Engine) => {
    if (eng.kind === 'manual') {
      if (item.truth) return file(item.truth, item, 'rules')
      return patch(item.key, { stage: 'manual' })
    }
    try {
      const ex = await analyze(item.blob, profile)
      await file(ex, item, 'ai')
    } catch (e) {
      const msg = e instanceof AnalyzeError ? e.message : 'Couldn’t read this one.'
      if (item.truth) {
        toast('info', `${msg} Using the sample’s built-in details instead.`)
        return file(item.truth, item, 'rules')
      }
      patch(item.key, { stage: 'manual', error: msg })
    }
  }

  const add = async (files: { fileName: string; blob: Blob; dataUrl?: string; truth?: Extraction }[]) => {
    const eng = engine ?? (await detectEngine())
    const prepared: Item[] = []
    for (const f of files) {
      try {
        const img = f.dataUrl ? { blob: f.blob, dataUrl: f.dataUrl } : await prepareImage(f.blob)
        prepared.push({ key: randomId(), fileName: f.fileName, dataUrl: img.dataUrl, blob: img.blob, stage: 'reading', truth: f.truth })
      } catch (e) {
        toast('bad', `${f.fileName}: ${e instanceof Error ? e.message : 'unreadable file'}`)
      }
    }
    setItems((xs) => [...prepared, ...xs])
    // A couple at a time keeps within AI rate limits.
    const queue = prepared.slice()
    const worker = async () => {
      while (queue.length) await run(queue.shift()!, eng)
    }
    await Promise.all([worker(), worker()])
  }

  const onFiles = (list: FileList | null) => {
    if (!list?.length) return
    void add(Array.from(list).map((f) => ({ fileName: f.name, blob: f })))
  }

  const review = receipts.filter((r) => r.status === 'needs_review')

  return (
    <>
      <PageTitle
        eyebrow="Inbox"
        title="Drop it in the shoebox."
        sub="Receipts, invoices, bills, donation letters, W-2s and 1099s. Each one is read, sorted against federal and state rules, and waits here for your OK."
        actions={engine && (
          <span className="engine" title={engine.detail}>
            <Icon name={engine.kind === 'manual' ? 'scale' : 'sparkle'} size={15} /> {engine.kind === 'manual' ? 'Rules only' : 'Claude reading'}
          </span>
        )}
      />

      <div
        className={'drop glass-card rise' + (over ? ' over' : '')}
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileRef.current?.click())}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          onFiles(e.dataTransfer.files)
        }}
      >
        <div className="orb"><Icon name="upload" /></div>
        <h2>Drop photos here, or click to choose</h2>
        <p>JPEG, PNG or WebP. Photos are shrunk and stripped of location data before anything else happens.</p>
        {engine && <p className="faint" style={{ fontSize: 13 }}>{engine.detail}</p>}
        <div className="drop-actions" onClick={(e) => e.stopPropagation()}>
          <button className="btn" onClick={() => camRef.current?.click()}><Icon name="camera" /> Take a photo</button>
          <button className="btn" onClick={async () => add((await makeSamples()).map((s) => ({ fileName: s.fileName, blob: s.blob, dataUrl: s.dataUrl, truth: s.truth })))}>
            <Icon name="sparkle" /> Try 8 sample receipts
          </button>
          <button className="btn" onClick={async () => add((await makeSamples('creator')).map((s) => ({ fileName: s.fileName, blob: s.blob, dataUrl: s.dataUrl, truth: s.truth })))}>
            <Icon name="camera" /> Creator trip example
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
      </div>

      {items.length > 0 && (
        <section style={{ marginTop: 26 }}>
          <div className="card-head"><h2 style={{ fontSize: 18 }}>This session</h2><span className="faint" style={{ fontSize: 13 }}>{items.filter((i) => i.stage === 'done').length} of {items.length} sorted</span></div>
          <div className="queue">
            {items.map((it) => {
              const rec = receipts.find((r) => r.id === it.receiptId)
              return (
                <div key={it.key} className="qcard glass-card">
                  <div className="qimg">
                    <img src={it.dataUrl} alt="" />
                    {it.stage === 'reading' && <div className="laser" />}
                    {it.stage === 'done' && <span className="done-badge"><Icon name="check" size={18} /></span>}
                  </div>
                  {it.stage === 'reading' && <div className="qstep"><Icon name="sparkle" size={15} className="spin" /> {engine?.kind === 'manual' ? 'Sorting…' : 'Reading the document…'}</div>}
                  {it.stage === 'manual' && (
                    <ManualForm
                      item={it}
                      onCancel={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}
                      onSubmit={(ex, cat) => file(ex, it, cat ? 'you' : 'rules', cat)}
                    />
                  )}
                  {it.stage === 'done' && rec && (
                    <button className="row-item" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', padding: 4 }} onClick={() => setOpen(rec)}>
                      <div style={{ minWidth: 0 }}>
                        <div className="row-title">{rec.extraction.merchant}</div>
                        <div className="row-sub"><CatChip id={rec.classification.category} small /></div>
                      </div>
                      <div className="row-amt">
                        <span className="money">{paid(rec)}</span>
                        <small>{money(rec.classification.deductible)} counts</small>
                      </div>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="card rise" style={{ marginTop: 26, animationDelay: '0.1s' }}>
        <div className="card-head">
          <h2>Waiting for your OK</h2>
          <span className="faint" style={{ fontSize: 13 }}>{review.length ? `${review.length} to review` : 'All caught up'}</span>
        </div>
        {review.length === 0 ? (
          <div className="empty">
            <svg className="art" viewBox="0 0 120 90" aria-hidden="true">
              <rect x="38" y="6" width="44" height="54" rx="4" fill="var(--glass-2)" stroke="var(--glass-border)" />
              <path d="M47 20h26M47 30h26M47 40h16" stroke="var(--ink-3)" strokeWidth="3" strokeLinecap="round" />
              <path d="M14 48 24 40h72l10 8v32a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z" fill="var(--gold)" opacity=".9" />
            </svg>
            Nothing to review. New documents land here after they’re sorted.
          </div>
        ) : (
          <div className="rows stagger">
            {review.map((r, i) => (
              <button key={r.id} className="row-item" style={{ ['--i' as string]: i }} onClick={() => setOpen(r)}>
                <span className="thumb">{r.image ? <img src={r.image} alt="" /> : <Icon name="receipts" />}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="row-title">{r.extraction.merchant}</div>
                  <div className="row-sub">
                    <CatChip id={r.classification.category} small />
                    <span>{r.extraction.date || 'No date'}</span>
                    {r.classification.flags.some((f) => f.level === 'warn') && <span style={{ color: 'var(--warn)' }}>· needs a look</span>}
                  </div>
                </div>
                <div className="row-amt">
                  <span className="money">{paid(r)}</span>
                  <small>{money(r.classification.deductible)}</small>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
      {open && <ReceiptDrawer key={open.id} receipt={receipts.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </>
  )
}
