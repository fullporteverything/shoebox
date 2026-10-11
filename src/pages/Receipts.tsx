import React, { useMemo, useState } from 'react'
import { Bandit } from '../components/Bandit.js'
import { Icon } from '../components/icons.js'
import { ReceiptDrawer } from '../components/ReceiptDrawer.js'
import { PageTitle } from '../components/Shell.js'
import { CatChip, Link, Seg, money, Money, Paid } from '../components/ui.js'
import { useSession } from '../lib/session.js'
import { categoryById } from '../lib/tax/rules.js'
import type { Group } from '../lib/tax/rules.js'
import type { Receipt } from '../lib/types.js'

export function Receipts() {
  const { receipts } = useSession()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<'all' | Group>('all')
  const [status, setStatus] = useState<'all' | Receipt['status']>('all')
  const [open, setOpen] = useState<Receipt | null>(null)

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return receipts.filter((r) => {
      const c = categoryById[r.classification.category]
      if (group !== 'all' && c.group !== group) return false
      if (status !== 'all' && r.status !== status) return false
      if (!t) return true
      return [r.extraction.merchant, c.label, r.extraction.businessPurpose, r.extraction.date, String(r.extraction.total)].join(' ').toLowerCase().includes(t)
    })
  }, [receipts, q, group, status])

  const total = shown.reduce((s, r) => s + r.classification.deductible, 0)

  return (
    <>
      <PageTitle
        eyebrow="Receipts"
        title="Every document, sorted."
        sub={`${receipts.length} in the vault. ${money(total)} counts toward deductions in this view.`}
        actions={<Link to="/app/inbox" className="btn btn-gold"><Icon name="upload" /> Add</Link>}
      />
      <div className="card rise">
        <div className="filters">
          <div className="search">
            <Icon name="search" />
            <input id="rc-search" className="input" placeholder="Search merchant, category, amount" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search receipts" />
          </div>
          <Seg label="Type" value={group} onChange={setGroup} options={[{ value: 'all', label: 'All' }, { value: 'business', label: 'Business' }, { value: 'itemized', label: 'Itemized' }, { value: 'credit', label: 'Credits' }, { value: 'personal', label: 'Personal' }]} />
          <Seg label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Any' }, { value: 'needs_review', label: 'Review' }, { value: 'confirmed', label: 'Confirmed' }]} />
        </div>
        {shown.length === 0 ? (
          <div className="empty">
            <Bandit pose="thinking" size={112} />
            {receipts.length ? 'Nothing matches those filters.' : <>No receipts yet. <Link to="/app/inbox">Add your first</Link>.</>}
          </div>
        ) : (
          <div className="rows stagger">
            {shown.map((r, i) => (
              <button key={r.id} className="row-item" style={{ ['--i' as string]: Math.min(i, 12) }} onClick={() => setOpen(r)}>
                <span className="thumb">{r.image ? <img src={r.image} alt="" /> : <Icon name="receipts" />}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="row-title">{r.extraction.merchant}</div>
                  <div className="row-sub">
                    <CatChip id={r.classification.category} small />
                    <span>{r.extraction.date || 'No date'}</span>
                    <span>· {categoryById[r.classification.category].form}</span>
                    {r.status === 'confirmed' ? <span style={{ color: 'var(--good)' }}>· confirmed</span> : <span style={{ color: 'var(--warn)' }}>· review</span>}
                  </div>
                </div>
                <div className="row-amt">
                  <span className="money"><Paid r={r} /></span>
                  <small><Money v={r.classification.deductible} /></small>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {open && <ReceiptDrawer key={open.id} receipt={receipts.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </>
  )
}
