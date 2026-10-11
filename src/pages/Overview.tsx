import React, { useMemo, useState } from 'react'
import { Icon } from '../components/icons.js'
import { ReceiptDrawer } from '../components/ReceiptDrawer.js'
import { PageTitle } from '../components/Shell.js'
import { CatChip, CountUp, Donut, Link, money, Money, Paid } from '../components/ui.js'
import { useSession } from '../lib/session.js'
import { categoryById, groupLabels } from '../lib/tax/rules.js'
import type { CategoryId } from '../lib/tax/rules.js'
import { stateByCode } from '../lib/tax/states.js'
import { buildPicture } from '../lib/tax/advisor.js'
import type { Receipt } from '../lib/types.js'
import { ReviewNudge } from '../components/Reviews.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function MonthBars({ receipts, year }: { receipts: Receipt[]; year: number }) {
  const byMonth = MONTHS.map((_, m) =>
    receipts.filter((r) => r.extraction.date.startsWith(`${year}-${String(m + 1).padStart(2, '0')}`)).reduce((s, r) => s + r.classification.deductible, 0),
  )
  const max = Math.max(...byMonth, 1)
  const W = 560
  const H = 170
  const bw = (W - 40) / 12
  const nice = Math.ceil(max / 100) * 100 || 100
  const y = (v: number) => 12 + (H - 40) * (1 - v / nice)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Deductible amount by month" style={{ width: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id="mb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--gold)" />
          <stop offset="1" stopColor="var(--sea)" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {[0, nice / 2, nice].map((t) => (
        <g key={t}>
          <line className="grid-line" x1={36} x2={W} y1={y(t)} y2={y(t)} />
          <text x={30} y={y(t) + 4} textAnchor="end">{t >= 1000 ? `$${(t / 1000).toFixed(1)}k` : `$${t}`}</text>
        </g>
      ))}
      {byMonth.map((v, i) => (
        <g key={i}>
          <rect x={40 + i * bw + bw * 0.2} y={y(v)} width={bw * 0.6} height={Math.max(0, y(0) - y(v))} rx={5} fill="url(#mb)" style={{ transformOrigin: `0 ${y(0)}px`, animation: `grow 0.9s ${i * 40}ms var(--ease-out) both` }}>
            <title>{`${MONTHS[i]}: ${money(v)}`}</title>
          </rect>
          <text x={40 + i * bw + bw / 2} y={H - 8} textAnchor="middle">{MONTHS[i][0]}</text>
        </g>
      ))}
    </svg>
  )
}

export function Overview() {
  const { profile, receipts, incomes, tripLogs } = useSession()
  const [open, setOpen] = useState<Receipt | null>(null)
  const year = profile?.taxYear ?? new Date().getFullYear()

  const stats = useMemo(() => {
    const inYear = receipts.filter((r) => !r.extraction.date || r.extraction.date.startsWith(String(year)))
    const deductible = inYear.reduce((s, r) => s + r.classification.deductible, 0)
    const business = inYear.filter((r) => categoryById[r.classification.category].group === 'business').reduce((s, r) => s + r.classification.deductible, 0)
    const byCat = new Map<CategoryId, number>()
    inYear.forEach((r) => r.classification.deductible > 0 && byCat.set(r.classification.category, (byCat.get(r.classification.category) ?? 0) + r.classification.deductible))
    const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1])
    return { inYear, deductible, business, cats, review: receipts.filter((r) => r.status === 'needs_review'), flagged: receipts.filter((r) => r.classification.flags.some((f) => f.level === 'warn')) }
  }, [receipts, year])

  const pic = useMemo(() => (profile ? buildPicture(profile, receipts, incomes, tripLogs) : null), [profile, receipts, incomes, tripLogs])
  if (!profile) return null
  const st = stateByCode[profile.state]
  const firstName = profile.name.split(' ')[0]
  const hour = new Date().getHours()

  return (
    <>
      <PageTitle
        eyebrow={`Tax year ${year} · ${st?.name ?? profile.state}`}
        title={<>{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, {firstName}.</>}
        sub={receipts.length ? `${stats.inYear.length} documents sorted so far. ${stats.review.length ? `${stats.review.length} waiting for your OK.` : 'Everything is confirmed.'}` : 'Your shoebox is empty. Add a few receipts and this fills in.'}
        actions={<Link to="/app/inbox" className="btn btn-gold"><Icon name="upload" /> Add documents</Link>}
      />

      <div className="kpis stagger">
        <div className="card kpi kpi-main lift glow-border" style={{ ['--i' as string]: 0 }}>
          <div className="k"><Icon name="sparkle" size={16} /> Deductions found</div>
          <div className="v"><CountUp value={stats.deductible} format={(n) => money(n, false)} /></div>
          <div className="d">Before AGI floors, caps and the standard deduction</div>
        </div>
        <div className="card kpi lift" style={{ ['--i' as string]: 1 }}>
          <div className="k"><Icon name="receipts" size={16} /> Business expenses</div>
          <div className="v"><CountUp value={stats.business} format={(n) => money(n, false)} /></div>
          <div className="d">{profile.workType === 'w2' ? 'Not deductible federally on W-2 income alone' : 'Schedule C, lowers income and self-employment tax'}</div>
        </div>
        <div className="card kpi lift" style={{ ['--i' as string]: 2 }}>
          <div className="k"><Icon name="inbox" size={16} /> Needs review</div>
          <div className="v"><CountUp value={stats.review.length} format={(n) => String(Math.round(n))} /></div>
          <div className="d">{stats.flagged.length} flagged for missing details</div>
        </div>
        <Link to="/app/savings" className="card kpi lift" style={{ ['--i' as string]: 3, color: 'inherit', textDecoration: 'none' }}>
          <div className="k"><Icon name="scale" size={16} /> Estimated tax</div>
          <div className="v">{pic?.est ? <CountUp value={pic.est.totalTax} format={(n) => money(n, false)} /> : '—'}</div>
          <div className="d">{pic?.est ? `${pic.opportunities.length} ways to save · open the assistant` : `Estimates cover tax year 2026`}</div>
        </Link>
      </div>

      <ReviewNudge receiptCount={receipts.length} />

      <div className="split" style={{ marginTop: 16 }}>
        <div className="stack">
          <div className="card rise" style={{ animationDelay: '0.15s' }}>
            <div className="card-head"><h2>Where your deductions come from</h2><Link to="/app/tax" className="btn btn-sm btn-ghost">Tax map <Icon name="arrowRight" /></Link></div>
            <div className="donut-wrap">
              <Donut data={stats.cats.map(([id, v]) => ({ label: categoryById[id].label, value: v, hue: categoryById[id].hue }))} />
              <div className="legend-list">
                {stats.cats.length === 0 && <p className="faint">No deductions yet.</p>}
                {stats.cats.slice(0, 7).map(([id, v]) => (
                  <div key={id} className="legend-row">
                    <span className="cat-dot" style={{ ['--h' as string]: categoryById[id].hue }} />
                    <span className="name">{categoryById[id].label} <span className="faint" style={{ fontSize: 12 }}>· {groupLabels[categoryById[id].group]}</span></span>
                    <span className="money"><Money v={v} whole /></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="card rise" style={{ animationDelay: '0.22s' }}>
            <div className="card-head"><h2>By month</h2><span className="faint" style={{ fontSize: 13 }}>{year}</span></div>
            <MonthBars receipts={stats.inYear} year={year} />
          </div>
        </div>
        <div className="stack">
          <div className="card rise" style={{ animationDelay: '0.18s' }}>
            <div className="card-head"><h2>Needs a look</h2><Link to="/app/inbox" className="btn btn-sm btn-ghost">Inbox <Icon name="arrowRight" /></Link></div>
            {stats.review.length === 0 ? (
              <p className="faint">Nothing waiting. Nice.</p>
            ) : (
              <div className="rows">
                {stats.review.slice(0, 5).map((r) => (
                  <button key={r.id} className="row-item" onClick={() => setOpen(r)}>
                    <span className="thumb">{r.image ? <img src={r.image} alt="" /> : <Icon name="receipts" />}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="row-title">{r.extraction.merchant}</div>
                      <div className="row-sub"><CatChip id={r.classification.category} small /></div>
                    </div>
                    <div className="row-amt"><span className="money"><Paid r={r} /></span></div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="card rise" style={{ animationDelay: '0.26s' }}>
            <div className="card-head"><h2>{st?.name ?? 'Your state'}</h2><span className={'chip ' + (st?.incomeTax ? 'sea' : 'gold')}>{st?.incomeTax ? 'Has income tax' : 'No wage income tax'}</span></div>
            <div className="stack" style={{ gap: 10 }}>
              {st?.notes.slice(0, 3).map((n) => <div key={n.text} className="reason state"><Icon name="pin" /> <span>{n.text}</span></div>)}
            </div>
          </div>
        </div>
      </div>
      {open && <ReceiptDrawer key={open.id} receipt={receipts.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </>
  )
}
