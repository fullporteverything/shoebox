import React, { useMemo, useRef, useState } from 'react'
import { Icon } from '../components/icons.js'
import { PageTitle } from '../components/Shell.js'
import { QuarterlyTable } from '../components/Quarterly.js'
import { PassGate } from './Pass.js'
import { quarterlyPlan } from '../lib/tax/quarterly.js'
import { CountUp, Drawer, Link, Seg, money, Money } from '../components/ui.js'
import { AnalyzeError, ask, detectEngine } from '../lib/ai.js'
import type { Turn } from '../lib/ai.js'
import { contextFor } from '../lib/assistant.js'
import { randomId } from '../lib/crypto.js'
import { useSession } from '../lib/session.js'
import { buildPicture, tripDates } from '../lib/tax/advisor.js'
import type { Opportunity, Picture, QuestionId, Trip, TripResult } from '../lib/tax/advisor.js'
import { estimate } from '../lib/tax/estimate.js'
import type { Estimate } from '../lib/tax/estimate.js'
import { taxTableFor } from '../lib/tax/y2026.js'
import { entityOptions, treatmentOf } from '../lib/tax/entity.js'
import type { DayKind, Evidence, IncomeType, Plan, TripLog } from '../lib/types.js'
import { Select } from '../components/Select.js'

// ---------- questions ----------

type Q = { id: QuestionId; label: string; hint?: string; kind: 'bool' | 'money' | 'number' | 'select'; options?: { value: string; label: string; hint?: string }[]; show?: (p: Plan) => boolean }

const QUESTIONS: { title: string; items: Q[] }[] = [
  {
    title: 'About you',
    items: [
      { id: 'occupation', label: 'What kind of work?', kind: 'select', options: [{ value: '', label: 'Choose…' }, { value: 'content_creator', label: 'Content creator' }, { value: 'consultant', label: 'Consultant or freelancer' }, { value: 'trades', label: 'Trades or contractor' }, { value: 'rideshare_delivery', label: 'Rideshare or delivery' }, { value: 'real_estate', label: 'Real estate' }, { value: 'retail_ecommerce', label: 'Retail or e-commerce' }, { value: 'other', label: 'Something else' }] },
      { id: 'entity', label: 'Business set up as', kind: 'select', options: entityOptions, hint: 'An LLC is taxed by how many owners it has and any election it filed. A single-member LLC with no election is taxed like a sole proprietor.' },
      { id: 'ownershipPct', label: 'Your share of the business’s profit (%)', kind: 'number', hint: 'From your operating agreement or your K-1. 0 to 100.', show: (p) => treatmentOf(p.entity) !== 'schedule_c' },
      { id: 'ownerSalary', label: 'Salary your S corp pays you this year', kind: 'money', hint: 'Gross W-2 pay from your own company. Enter it here, not under Income, so it isn’t counted twice.', show: (p) => treatmentOf(p.entity) === 's_corp' },
      { id: 'age65', label: '65 or older?', kind: 'bool' },
      { id: 'age50', label: '50 or older?', kind: 'bool', hint: 'Unlocks retirement catch-up contributions.' },
      { id: 'dependents', label: 'Children under 17', kind: 'number' },
      { id: 'kidsCanWork', label: 'Could your kids do real work in the business?', kind: 'bool' },
      { id: 'startedThisYear', label: 'Business started this year?', kind: 'bool' },
    ],
  },
  {
    title: 'Health and retirement',
    items: [
      { id: 'hdhp', label: 'HSA-eligible health plan?', kind: 'select', options: [{ value: '', label: 'Not sure' }, { value: 'none', label: 'No' }, { value: 'self', label: 'Yes, self-only' }, { value: 'family', label: 'Yes, family' }] },
      { id: 'hsaContrib', label: 'HSA contributions this year', kind: 'money' },
      { id: 'healthPremiums', label: 'Health insurance you pay yourself (yearly)', kind: 'money' },
      { id: 'retirement', label: 'Retirement plan', kind: 'select', options: [{ value: '', label: 'Not sure' }, { value: 'none', label: 'None yet' }, { value: 'sep', label: 'SEP-IRA' }, { value: 'solo401k', label: 'Solo 401(k)' }, { value: 'employer', label: 'Employer 401(k) only' }] },
      { id: 'retirementContrib', label: 'Self-employed retirement contributions', kind: 'money' },
    ],
  },
  {
    title: 'Driving, space and pay',
    items: [
      { id: 'homeOfficeSqFt', label: 'Home office square feet (used only for work)', kind: 'number' },
      { id: 'milesFirstHalf', label: 'Business miles, Jan–Jun', kind: 'number' },
      { id: 'milesSecondHalf', label: 'Business miles, Jul–Dec', kind: 'number' },
      { id: 'tips', label: 'Qualified tips (W-2)', kind: 'money' },
      { id: 'overtime', label: 'Qualified overtime premium (W-2)', kind: 'money' },
    ],
  },
  {
    title: 'Payments',
    items: [
      { id: 'estimatedPaid', label: 'Estimated tax paid this year', kind: 'money' },
      { id: 'priorYearTax', label: 'Last year’s total tax', kind: 'money', hint: 'Form 1040, line 24.' },
      { id: 'priorYearAgi', label: 'Last year’s AGI', kind: 'money', hint: 'Form 1040, line 11.' },
    ],
  },
]

const allQuestions = QUESTIONS.flatMap((g) => g.items)

function QuestionInput({ q, plan, onChange }: { q: Q; plan: Plan; onChange: (p: Partial<Plan>) => void }) {
  const v = plan[q.id]
  const id = `q-${q.id}`
  if (q.kind === 'bool') {
    return (
      <Seg label={q.label} value={v === null ? 'unset' : v ? 'yes' : 'no'} onChange={(x) => onChange({ [q.id]: x === 'unset' ? null : x === 'yes' } as Partial<Plan>)}
        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unset', label: '—' }]} />
    )
  }
  if (q.kind === 'select') {
    return (
      <Select id={id} value={(v as string | null) ?? ''} options={q.options!}
        onChange={(x) => onChange({ [q.id]: x === '' && q.id !== 'occupation' && q.id !== 'entity' ? null : x } as Partial<Plan>)} />
    )
  }
  return (
    <input id={id} className="input" inputMode="decimal" placeholder={q.kind === 'money' ? '$0' : '0'} defaultValue={v == null ? '' : String(v)}
      onBlur={(e) => {
        const raw = e.target.value.replace(/[$,\s]/g, '')
        onChange({ [q.id]: raw === '' ? null : Math.max(0, Number(raw) || 0) } as Partial<Plan>)
      }} />
  )
}

// ---------- pieces ----------

function OpportunityCard({ o, plan, onPlan, i }: { o: Opportunity; plan: Plan; onPlan: (p: Partial<Plan>) => void; i: number }) {
  const [open, setOpen] = useState(i < 2)
  const chip = { applies: 'good', check: 'gold', heads_up: 'sea' }[o.status]
  const label = { applies: 'Applies to you', check: 'Needs an answer', heads_up: 'Heads up' }[o.status]
  return (
    <div className="card opp lift" style={{ ['--i' as string]: i }}>
      <button className="opp-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div style={{ minWidth: 0 }}>
          <span className={'chip ' + chip}>{label}</span>
          <h3>{o.title}</h3>
          <p className="muted">{o.summary}</p>
        </div>
        <div className="opp-save">
          {o.savings ? <><span className="eyebrow">Could save</span><b className="money"><CountUp value={o.savings} format={(n) => money(n, false)} /></b></> : <Icon name={open ? 'x' : 'arrowRight'} />}
        </div>
      </button>
      {open && (
        <div className="opp-body rise">
          {o.why.length > 0 && <div className="stack" style={{ gap: 8 }}>{o.why.map((w) => <div key={w} className="reason"><Icon name="scale" /> <span>{w}</span></div>)}</div>}
          {o.steps.length > 0 && (
            <ol className="steps-list">{o.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          )}
          {o.questions && (
            <div className="opp-q">
              {o.questions.map((qid) => {
                const q = allQuestions.find((x) => x.id === qid)!
                return (
                  <div key={qid} className="field">
                    <label htmlFor={`q-${qid}`}>{q.label}</label>
                    <QuestionInput q={q} plan={plan} onChange={onPlan} />
                  </div>
                )
              })}
            </div>
          )}
          <div className="faint" style={{ fontSize: 12.5 }}>Rule: {o.ref}</div>
        </div>
      )}
    </div>
  )
}

const dayLabel = { business: 'Business', travel: 'Travel', personal: 'Personal' }
const nextKind = (k?: DayKind): DayKind | undefined => (k === undefined ? 'business' : k === 'business' ? 'travel' : k === 'travel' ? 'personal' : undefined)

async function thumbFor(file: File): Promise<{ thumb: string; kind: Evidence['kind'] }> {
  const canvas = document.createElement('canvas')
  const draw = (src: CanvasImageSource, w: number, h: number) => {
    const s = Math.min(1, 320 / Math.max(w, h))
    canvas.width = Math.round(w * s)
    canvas.height = Math.round(h * s)
    canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.75)
  }
  const url = URL.createObjectURL(file)
  try {
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.src = url
      await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('video')) })
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2)
      await new Promise<void>((res) => (v.onseeked = () => res()))
      return { thumb: draw(v, v.videoWidth, v.videoHeight), kind: 'video' }
    }
    const img = new Image()
    img.src = url
    await img.decode()
    return { thumb: draw(img, img.naturalWidth, img.naturalHeight), kind: 'photo' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function TripCard({ trip, result, log, onSave }: { trip: Trip; result: TripResult; log?: TripLog; onSave: (t: TripLog) => void }) {
  const { toast } = useSession()
  const fileRef = useRef<HTMLInputElement>(null)
  const current: TripLog = log ?? { key: trip.key, days: {}, evidence: [], primaryPurpose: '' }
  const dates = tripDates(trip)
  const evidenceByDay = (d: string) => current.evidence.filter((e) => e.date === d)

  const addEvidence = async (files: FileList | null) => {
    if (!files?.length) return
    const added: Evidence[] = []
    const days = { ...current.days }
    let marked = 0
    for (const f of Array.from(files).slice(0, 20)) {
      try {
        const { thumb, kind } = await thumbFor(f)
        const d = new Date(f.lastModified)
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const inTrip = dates.includes(date)
        added.push({ id: randomId(), date: inTrip ? date : dates[0], name: f.name, kind, thumb, note: inTrip ? '' : 'File date was outside the trip; attached to the first day. Move it if needed.', addedAt: Date.now() })
        if (inTrip && !days[date]) {
          days[date] = 'business'
          marked++
        }
      } catch {
        toast('bad', `${f.name} couldn’t be read. Photos and common video formats work.`)
      }
    }
    onSave({ ...current, days, evidence: [...current.evidence, ...added] })
    if (added.length) toast('good', `Attached ${added.length} file${added.length > 1 ? 's' : ''}${marked ? ` and marked ${marked} day${marked > 1 ? 's' : ''} as business. Change any that weren’t` : ''}.`)
  }

  const ruleCopy = { unmarked: 'Mark the days to see what counts', primarily_personal: 'Primarily personal', full_transport: 'Airfare fully deductible', allocate: 'Airfare split by business days' }
  return (
    <div className="card trip rise">
      <div className="card-head">
        <div>
          <div className="eyebrow">Trip detected</div>
          <h2 style={{ fontSize: 22, marginTop: 4 }}>{trip.country}{trip.cities.length ? ` · ${trip.cities.join(', ')}` : ''}</h2>
          <div className="faint" style={{ fontSize: 13 }}>{trip.start} to {trip.end} · {trip.totalDays} days · {trip.receipts.length} receipts</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="eyebrow">Counts</div>
          <div className="big-amount" style={{ fontSize: 30, color: 'var(--gold-ink)' }}><CountUp value={result.allowed} /></div>
          <span className={'chip ' + (result.rule === 'unmarked' ? 'gold' : result.rule === 'primarily_personal' ? 'warn' : 'good')}>{ruleCopy[result.rule]}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="hint" htmlFor={`ts-${trip.key}`}>Left the US</label>
        <input id={`ts-${trip.key}`} type="date" className="input" style={{ width: 'auto' }} value={trip.start} onChange={(e) => e.target.value && onSave({ ...current, start: e.target.value })} />
        <label className="hint" htmlFor={`te-${trip.key}`}>Got back</label>
        <input id={`te-${trip.key}`} type="date" className="input" style={{ width: 'auto' }} value={trip.end} onChange={(e) => e.target.value && onSave({ ...current, end: e.target.value })} />
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>Tap a day to cycle Business → Travel → Personal. Travel days to and from count as business days. Attach clips or photos from shoots as proof.</p>
      <div className="days">
        {dates.map((d) => {
          const k = current.days[d]
          const ev = evidenceByDay(d)
          return (
            <button key={d} className={'day ' + (k ?? 'unset')} onClick={() => {
              const days = { ...current.days }
              const n = nextKind(k)
              if (n) days[d] = n
              else delete days[d]
              onSave({ ...current, days })
            }}>
              <span className="dnum">{new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
              <span className="dkind">{k ? dayLabel[k] : 'Tap to mark'}</span>
              {ev.length > 0 && <span className="dev"><Icon name="camera" size={12} /> {ev.length}</span>}
            </button>
          )
        })}
      </div>
      {current.evidence.length > 0 && (
        <div className="evidence">
          {current.evidence.map((e) => (
            <figure key={e.id} title={`${e.name} · ${e.date}${e.note ? ' · ' + e.note : ''}`}>
              <img src={e.thumb} alt={e.name} />
              {e.kind === 'video' && <span className="play">▶</span>}
              <figcaption>{e.date.slice(5)}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0' }}>
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}><Icon name="camera" /> Attach shoot photos or clips</button>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (addEvidence(e.target.files), (e.target.value = ''))} />
        <span className="hint" style={{ alignSelf: 'center' }}>Videos are kept as a still frame and file details, not the full clip.</span>
      </div>
      {result.rule !== 'unmarked' && (
        <table className="tax-table">
          <thead><tr><th>Part of the trip</th><th className="r">Paid</th><th className="r">Counts</th></tr></thead>
          <tbody>
            {(['transport', 'lodging', 'meals', 'other'] as const).filter((k) => result[k].paid > 0).map((k) => (
              <tr key={k}><td>{{ transport: 'Flights and trains', lodging: 'Lodging', meals: 'Meals (50%)', other: 'Other business costs' }[k]}</td><td className="r num"><Money v={result[k].paid} /></td><td className="r num"><Money v={result[k].allowed} /></td></tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="stack" style={{ gap: 8, marginTop: 12 }}>
        {result.explain.map((x) => <div key={x} className="reason"><Icon name="scale" /> <span>{x}</span></div>)}
        <div className="reason warn"><Icon name="alert" /> <span>Filming during a vacation doesn’t make it a business trip. The main reason for the trip has to be business, and you need records made at the time: shot lists, footage dates, contracts and published content.</span></div>
      </div>
      <div className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>Rule: IRS Pub 463, ch. 1, Travel Outside the United States</div>
    </div>
  )
}

function IncomeCard({ pic }: { pic: Picture }) {
  const { saveIncome, deleteIncome, incomes } = useSession()
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ source: '', type: 'self_employment' as IncomeType, amount: '', withheld: '', date: new Date().toISOString().slice(0, 10) })
  const typeLabel: Record<IncomeType, string> = { wages: 'W-2 wages', self_employment: 'Self-employment', interest: 'Interest', dividends: 'Dividends', other: 'Other' }
  return (
    <div className="card rise">
      <div className="card-head"><h2>Income so far</h2><button className="btn btn-sm" onClick={() => setAdding(!adding)}><Icon name={adding ? 'x' : 'sparkle'} /> {adding ? 'Cancel' : 'Add income'}</button></div>
      {adding && (
        <form className="stack rise" style={{ gap: 10, marginBottom: 14 }} onSubmit={async (e) => {
          e.preventDefault()
          await saveIncome({ id: randomId(), source: f.source || 'Income', type: f.type, amount: Math.max(0, Number(f.amount) || 0), withheld: Math.max(0, Number(f.withheld) || 0), date: f.date })
          setAdding(false)
          setF({ ...f, source: '', amount: '', withheld: '' })
        }}>
          <div className="grid-2">
            <input aria-label="Source" id="inc-src" className="input" placeholder="Who paid you" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} required />
            <Select aria-label="Type" id="inc-type" value={f.type} onChange={(v) => setF({ ...f, type: v })} options={Object.entries(typeLabel).map(([k, v]) => ({ value: k as IncomeType, label: v }))} />
          </div>
          <div className="grid-2">
            <input aria-label="Amount" id="inc-amt" className="input" inputMode="decimal" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
            <input aria-label="Federal tax withheld" id="inc-wh" className="input" inputMode="decimal" placeholder="Federal tax withheld (if any)" value={f.withheld} onChange={(e) => setF({ ...f, withheld: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input aria-label="Date" id="inc-date" className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <button className="btn btn-gold">Add</button>
          </div>
        </form>
      )}
      {pic.incomes.length === 0 ? (
        <p className="faint">No income yet. Upload W-2s, 1099s or payout statements in the Inbox, or add income here.</p>
      ) : (
        <div className="rows">
          {pic.incomes.map((i) => (
            <div key={i.id} className="row-item" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto', cursor: 'default' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row-title">{i.source}</div>
                <div className="row-sub"><span className="chip sea" style={{ fontSize: 11 }}>{typeLabel[i.type]}</span><span>{i.date}</span>{i.fromReceipt && <span>· from a document</span>}</div>
              </div>
              <div className="row-amt"><span className="money"><Money v={i.amount} /></span>{i.withheld > 0 && <small style={{ color: 'var(--ink-3)' }}><Money v={i.withheld} /> withheld</small>}</div>
              {!i.fromReceipt && incomes.some((x) => x.id === i.id) ? <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove" onClick={() => deleteIncome(i.id)}><Icon name="trash" /></button> : <span />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Breakdown({ e }: { e: Estimate }) {
  const b = e.business
  const business: [string, number, string?][] =
    b.treatment === 'schedule_c'
      ? [['Self-employment income', e.seGross], ['Net business profit', e.seNet]]
      : b.treatment === 'partnership'
        ? [['Partnership income', e.seGross], ['Partnership profit', b.net], ['Your share (K-1)', b.k1]]
        : [['S corp income', e.seGross], ['Company profit before your salary', b.net], ['Your salary (W-2)', b.salary], ['Your share of profit (K-1)', b.k1]]
  const rows: [string, number, string?][] = [
    ['W-2 wages', e.wages],
    ...business,
    ['Interest, dividends, other', e.investment],
    ['Adjusted gross income', e.agi, 'strong'],
    [e.deductionKind === 'standard' ? 'Standard deduction' : 'Itemized deductions', -e.deduction],
    ['Cash gifts to charity (non-itemizer)', -e.charityNonItemizer],
    ['Tips, overtime, senior deductions', -e.obbba],
    ['Qualified business income deduction', -e.qbi],
    ['Taxable income', e.taxable, 'strong'],
    ['Income tax', e.incomeTax],
    ['Self-employment tax', e.seTax],
    ['Credits', -e.credits],
    ['Payroll tax on your salary (both halves)', b.payrollTax],
  ]
  return (
    <table className="tax-table">
      <tbody>
        {rows.filter(([, v]) => v !== 0).map(([k, v, s]) => (
          <tr key={k} style={s ? { fontWeight: 650 } : undefined}><td>{k}</td><td className="r num">{v < 0 ? '−' : ''}<Money v={Math.abs(v)} whole /></td></tr>
        ))}
        <tr><td>State tax</td><td className="r num">{e.state.amount == null ? 'Not estimated' : <Money v={e.state.amount} whole />}</td></tr>
        {!b.counted && <tr><td>Your share of the business</td><td className="r num">Not counted yet</td></tr>}
      </tbody>
    </table>
  )
}

// ---------- assistant ----------

function AskDrawer({ context, onClose }: { context: string; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [live, setLive] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ctl = useRef<AbortController | null>(null)
  const ideas = ['What else can I deduct as a creator?', 'Is my Italy trip deductible?', 'How much should I pay in estimated tax?', 'Should I open a Solo 401(k) or a SEP?']
  const send = async (q: string) => {
    if (!q.trim() || busy) return
    const next: Turn[] = [...turns, { role: 'user', content: q.trim() }]
    setTurns(next)
    setDraft('')
    setBusy(true)
    setError('')
    setLive('')
    ctl.current = new AbortController()
    try {
      const text = await ask(next, context, setLive, ctl.current.signal)
      setTurns([...next, { role: 'assistant', content: text }])
    } catch (e) {
      if ((e as AnalyzeError).code !== 'cancelled') setError(e instanceof AnalyzeError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
      setLive('')
    }
  }
  return (
    <Drawer eyebrow="Assistant" title="Ask Shoebox" onClose={() => { ctl.current?.abort(); onClose() }}
      footer={
        <form style={{ display: 'flex', gap: 8, width: '100%' }} onSubmit={(e) => (e.preventDefault(), send(draft))}>
          <input id="ask-input" className="input" placeholder="Ask about your taxes" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} />
          {busy ? <button type="button" className="btn" onClick={() => ctl.current?.abort()}>Stop</button> : <button className="btn btn-gold" disabled={!draft.trim()}><Icon name="arrowRight" /></button>}
        </form>
      }>
      <div className="reason"><Icon name="info" /> <span>Answers use your records and current tax rules. When something depends on facts it doesn’t have, it will say so instead of guessing. Not tax advice.</span></div>
      {turns.length === 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {ideas.map((q) => <button key={q} className="btn" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => send(q)}>{q}</button>)}
        </div>
      )}
      <div className="chat">
        {turns.map((t, i) => <div key={i} className={'bubble ' + t.role}>{t.content}</div>)}
        {busy && <div className="bubble assistant">{live || <span className="faint">Thinking…</span>}</div>}
        {error && <div className="error"><Icon name="alert" size={16} /> {error}</div>}
      </div>
    </Drawer>
  )
}

// ---------- page ----------

export function Savings() {
  const { profile, receipts, incomes, tripLogs, savePlan, saveTripLog, hasPass } = useSession()
  const [pace, setPace] = useState<'so_far' | 'pace'>('so_far')
  const [asking, setAsking] = useState(false)
  const [canAsk, setCanAsk] = useState(false)
  React.useEffect(() => void detectEngine().then((e) => setCanAsk(e.kind !== 'manual')), [])

  const pic = useMemo(() => (profile ? buildPicture(profile, receipts, incomes, tripLogs) : null), [profile, receipts, incomes, tripLogs])
  if (!profile || !pic) return null
  const table = taxTableFor(profile.taxYear)

  const now = new Date()
  const isCurrentYear = profile.taxYear === now.getFullYear()
  const dayOfYear = Math.max(1, Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000))
  const factor = pace === 'pace' && isCurrentYear ? 365 / dayOfYear : 1
  const shown: Estimate | null = factor === 1 || !pic.est ? pic.est : estimate({
    profile, plan: pic.plan,
    incomes: pic.incomes.map((i) => ({ ...i, amount: i.amount * factor, withheld: i.withheld * factor })),
    businessExpenses: pic.businessExpenses * factor,
    itemized: { propertyTax: pic.itemized.propertyTax * factor, mortgageInterest: pic.itemized.mortgageInterest * factor, charityCash: pic.itemized.charityCash * factor, medical: pic.itemized.medical * factor },
  })
  const onPlan = (patch: Partial<Plan>) => void savePlan(patch)
  const potential = pic.meter?.potential ?? 0
  const quarterly = pic.est && profile.workType !== 'w2' ? quarterlyPlan(pic.est, pic.plan) : null
  const context = contextFor(profile, receipts, pic)

  return (
    <>
      <PageTitle
        eyebrow={`Savings assistant · ${profile.taxYear}`}
        title="Keep more of what you made."
        sub="Your income, an estimate of the year’s tax, and the legal ways your own records say you can lower it. Each suggestion shows the rule it comes from. When we don’t know something, we ask."
        actions={canAsk && <button className="btn btn-gold" onClick={() => setAsking(true)}><Icon name="sparkle" /> Ask Shoebox</button>}
      />

      {!table && (
        <div className="card rise" style={{ marginBottom: 16 }}>
          <div className="reason warn"><Icon name="alert" /> <span>Estimates cover tax year 2026 only for now, the year whose figures we’ve verified. Switch your tax year on the <Link to="/app/profile">Profile</Link> page. Opportunities need the estimate, so they’re hidden too.</span></div>
        </div>
      )}

      {shown && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <Seg label="Basis" value={pace} onChange={setPace} options={[{ value: 'so_far', label: 'From documents so far' }, { value: 'pace', label: 'Full-year pace' }]} />
            <span className="hint">{pace === 'pace' ? `Scales income and business costs from the first ${dayOfYear} days to a full year. A projection, not a fact.` : 'Only what’s in your vault right now.'}</span>
          </div>
          <div className="kpis stagger">
            <div className="card kpi lift" style={{ ['--i' as string]: 0 }}>
              <div className="k"><Icon name="arrowRight" size={16} /> Income {pace === 'pace' ? 'for the year' : 'so far'}</div>
              <div className="v"><CountUp value={shown.wages + shown.seGross + shown.investment} format={(n) => money(n, false)} /></div>
              <div className="d">{pic.incomes.length} source{pic.incomes.length === 1 ? '' : 's'} · {shown.business.treatment === 'schedule_c' ? <>net business profit <Money v={shown.seNet} whole /></> : shown.business.counted ? <>your K-1 share <Money v={shown.business.k1} whole /></> : 'your share not counted yet'}</div>
            </div>
            <div className="card kpi lift" style={{ ['--i' as string]: 1 }}>
              <div className="k"><Icon name="scale" size={16} /> Estimated tax</div>
              <div className="v"><CountUp value={shown.totalTax} format={(n) => money(n, false)} /></div>
              <div className="d">Federal <Money v={shown.federalTotal} whole /> · state {shown.state.amount == null ? 'not estimated' : <Money v={shown.state.amount} whole />}{shown.business.payrollTax > 0 && <> · payroll <Money v={shown.business.payrollTax} whole /></>}</div>
            </div>
            <div className="card kpi lift" style={{ ['--i' as string]: 2 }}>
              <div className="k"><Icon name="check" size={16} /> Paid so far</div>
              <div className="v"><CountUp value={shown.paid} format={(n) => money(n, false)} /></div>
              <div className="d">Withholding plus estimated payments</div>
            </div>
            <div className={'card kpi kpi-main lift glow-border'} style={{ ['--i' as string]: 3 }}>
              <div className="k"><Icon name="sparkle" size={16} /> {shown.balance > 0 ? 'You may owe' : 'Possible refund'}</div>
              <div className="v"><CountUp value={Math.abs(shown.balance)} format={(n) => money(n, false)} /></div>
              <div className="d">{potential > 0 ? `${money(potential, false)} in savings found below` : 'Answer the questions below to find savings'}</div>
            </div>
          </div>
        </>
      )}

      {quarterly && (
        <div className="card rise" style={{ marginTop: 16 }}>
          <div className="card-head"><h2>Quarterly tax planner</h2><Link to="/app/filing" className="btn btn-sm btn-ghost">Filing pack <Icon name="arrowRight" /></Link></div>
          {hasPass(profile.taxYear) ? <QuarterlyTable q={quarterly} /> : <PassGate feature="The quarterly planner" year={profile.taxYear} />}
        </div>
      )}

      <div className="split" style={{ marginTop: 16 }}>
        <div className="stack">
          {pic.trips.map(({ trip, result, log }) => (
            <TripCard key={trip.key} trip={trip} result={result} log={log} onSave={(t) => void saveTripLog(t)} />
          ))}
          {pic.opportunities.length > 0 && (
            <div className="stack stagger" style={{ gap: 12 }}>
              <div className="card-head" style={{ marginBottom: 0 }}><h2 style={{ fontSize: 19 }}>Ways to save</h2><span className="faint" style={{ fontSize: 13 }}>{pic.opportunities.length} suggestion{pic.opportunities.length === 1 ? '' : 's'} from your records</span></div>
              {pic.opportunities.map((o, i) => <OpportunityCard key={o.id} o={o} plan={pic.plan} onPlan={onPlan} i={i} />)}
            </div>
          )}
          {receipts.length === 0 && pic.incomes.length === 0 && (
            <div className="card empty">Add income documents and receipts in the <Link to="/app/inbox">Inbox</Link>. Try the “Creator trip example” there to see the assistant work.</div>
          )}
        </div>
        <div className="stack">
          {shown && (
            <div className="card rise">
              <div className="card-head"><h2>How the estimate adds up</h2><span className="faint" style={{ fontSize: 13 }}>{Math.round(shown.marginal.federal * 100)}% bracket</span></div>
              <Breakdown e={shown} />
              <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                {shown.state.note && <div className="reason state"><Icon name="pin" /> <span>{shown.state.note}</span></div>}
                {shown.flags.map((f) => <div key={f} className="reason warn"><Icon name="alert" /> <span>{f}</span></div>)}
                {shown.assumptions.map((a) => <div key={a} className="reason"><Icon name="info" /> <span>{a}</span></div>)}
                <div className="faint" style={{ fontSize: 12.5 }}>Figures: {table?.sources.brackets}; {table?.sources.mileage}; {table?.sources.state}. An estimate, not a return.</div>
              </div>
            </div>
          )}
          <IncomeCard pic={pic} />
          <div className="card rise">
            <div className="card-head"><h2>Questions</h2><span className="faint" style={{ fontSize: 13 }}>Answers unlock more savings</span></div>
            <div className="stack" style={{ gap: 18 }}>
              {QUESTIONS.map((g) => (
                <div key={g.title} className="stack" style={{ gap: 10 }}>
                  <div className="eyebrow">{g.title}</div>
                  {g.items.filter((q) => !q.show || q.show(pic.plan)).map((q) => (
                    <div key={q.id} className="field">
                      <label htmlFor={`q-${q.id}`}>{q.label}</label>
                      <QuestionInput q={q} plan={pic.plan} onChange={onPlan} />
                      {q.hint && <span className="hint">{q.hint}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {canAsk && !asking && (
        <button className="fab btn btn-gold" onClick={() => setAsking(true)} aria-label="Ask Shoebox"><Icon name="sparkle" /> <span>Ask</span></button>
      )}
      {asking && <AskDrawer context={context} onClose={() => setAsking(false)} />}
    </>
  )
}
