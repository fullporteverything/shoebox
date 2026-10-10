import React from 'react'
import { Icon } from '../components/icons.js'
import { PageTitle } from '../components/Shell.js'
import { money } from '../components/ui.js'
import { useSession } from '../lib/session.js'
import { RETENTION_YEARS, RULES_REVIEWED, categories, groupLabels } from '../lib/tax/rules.js'
import type { Group } from '../lib/tax/rules.js'
import { stateByCode } from '../lib/tax/states.js'

export function TaxMap() {
  const { profile, receipts } = useSession()
  if (!profile) return null
  const st = stateByCode[profile.state]
  const groups = Object.keys(groupLabels) as Group[]
  const totals = (id: string) => {
    const rs = receipts.filter((r) => r.classification.category === id)
    return { n: rs.length, paid: rs.reduce((s, r) => s + r.extraction.total, 0), ded: rs.reduce((s, r) => s + r.classification.deductible, 0) }
  }
  return (
    <>
      <PageTitle
        eyebrow="Tax map"
        title="Where everything lands on your return."
        sub={`Each category maps to a form and line. Hand this to your tax preparer. Rules reviewed ${RULES_REVIEWED}.`}
      />
      <div className="split">
        <div className="stack">
          {groups.map((g, gi) => {
            const cats = categories.filter((c) => c.group === g)
            const sum = cats.reduce((s, c) => s + totals(c.id).ded, 0)
            return (
              <div key={g} className="card rise" style={{ animationDelay: `${gi * 60}ms` }}>
                <div className="card-head"><h2>{groupLabels[g]}</h2><span className="money" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>{money(sum)}</span></div>
                <div className="table-wrap">
                  <table className="tax-table">
                    <thead><tr><th>Category</th><th>Form and line</th><th className="r">Items</th><th className="r">Paid</th><th className="r">Counts</th></tr></thead>
                    <tbody>
                      {cats.map((c) => {
                        const t = totals(c.id)
                        return (
                          <tr key={c.id} style={{ opacity: t.n ? 1 : 0.55 }}>
                            <td>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><span className="cat-dot" style={{ ['--h' as string]: c.hue }} />{c.label}</div>
                              <div className="faint" style={{ fontSize: 12.5, marginTop: 3, maxWidth: 380 }}>{c.rule}</div>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>{c.form}<div className="faint" style={{ fontSize: 12 }}>{c.ruleRef}</div></td>
                            <td className="r num">{t.n}</td>
                            <td className="r num">{money(t.paid)}</td>
                            <td className="r num">{money(t.ded)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
        <div className="stack">
          <div className="card rise glow-border" style={{ animationDelay: '0.1s' }}>
            <div className="card-head"><h2>{st?.name}</h2><span className={'chip ' + (st?.incomeTax ? 'sea' : 'gold')}>{st?.incomeTax ? 'State income tax' : 'No wage tax'}</span></div>
            <div className="stack" style={{ gap: 12 }}>
              {st?.notes.map((n) => <div key={n.text} className="reason state"><Icon name="pin" /> <span>{n.text}</span></div>)}
              <div className="reason"><Icon name="info" /> <span>{st?.salesTax ? 'Has a statewide sales tax.' : 'No statewide sales tax.'} If you itemize, you deduct either state income tax or sales tax, not both, within the SALT cap.</span></div>
            </div>
          </div>
          <div className="card rise" style={{ animationDelay: '0.16s' }}>
            <div className="card-head"><h2>Recordkeeping rules</h2></div>
            <div className="stack" style={{ gap: 10 }}>
              {[
                `Keep records at least ${RETENTION_YEARS} years after filing; 6 if you under-report income by over 25%; 7 for bad debts or worthless securities.`,
                'Expenses of $75 or more, and all lodging, need documentary evidence such as a receipt.',
                'For meals, record who attended and the business purpose.',
                'Keep a contemporaneous mileage log if you deduct vehicle use.',
                'Charitable gifts of $250 or more need a written acknowledgment.',
              ].map((t) => <div key={t} className="reason"><Icon name="check" /> <span>{t}</span></div>)}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
