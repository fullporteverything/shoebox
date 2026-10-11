import React, { useMemo } from 'react'
import { Icon } from '../components/icons.js'
import { PageTitle } from '../components/Shell.js'
import { Link, Money } from '../components/ui.js'
import { QuarterlyTable } from '../components/Quarterly.js'
import { buildFilingPack, receiptsCsv, scheduleCCsv } from '../lib/filing.js'
import { useSession } from '../lib/session.js'
import { PassGate } from './Pass.js'
import { PASS_REQUIRED_FROM } from '../lib/cloud.js'
import { categoryById } from '../lib/tax/rules.js'
import { stateByCode } from '../lib/tax/states.js'
import { usdOf } from '../lib/tax/advisor.js'

const filingLabels = { single: 'Single', married_joint: 'Married filing jointly', married_separate: 'Married filing separately', head_of_household: 'Head of household' } as const

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Filing() {
  const { profile, receipts, incomes, tripLogs, toast, hasPass } = useSession()
  const pack = useMemo(() => (profile ? buildFilingPack(profile, receipts, incomes, tripLogs) : null), [profile, receipts, incomes, tripLogs])
  if (!profile || !pack) return null
  const { pic, year } = pack
  if (!hasPass(year)) {
    return (
      <>
        <PageTitle eyebrow={`Filing pack · tax year ${year}`} title="Ready for your preparer" sub="Your year in the order a tax preparer or tax software asks for it, as a PDF and spreadsheets." />
        <PassGate feature="The filing pack" year={year} />
        <div className="card rise gate-preview" style={{ marginTop: 16 }}>
          <div className="card-head"><h2>What’s in yours</h2><span className="faint" style={{ fontSize: 13 }}>From your vault, right now</span></div>
          <ul className="free-list">
            <li><Icon name="check" size={16} /> A before-you-file checklist ({pack.attention.length ? `${pack.attention.length} item${pack.attention.length === 1 ? '' : 's'} to fix` : 'all clear'})</li>
            <li><Icon name="check" size={16} /> {pack.income.length} income type{pack.income.length === 1 ? '' : 's'}, with tax withheld</li>
            {profile.workType !== 'w2' && <li><Icon name="check" size={16} /> {pack.scheduleC.length} Schedule C line{pack.scheduleC.length === 1 ? '' : 's'}, totals ready to copy</li>}
            <li><Icon name="check" size={16} /> Deductions, estimated tax and your quarterly plan</li>
            <li><Icon name="check" size={16} /> All {pack.receipts.length} document{pack.receipts.length === 1 ? '' : 's'} as a PDF and two spreadsheets</li>
          </ul>
        </div>
      </>
    )
  }
  const est = pic.est
  const st = stateByCode[profile.state]
  const se = profile.workType !== 'w2'
  const unmarkedTrips = pic.trips.filter((t) => t.result.rule === 'unmarked')
  const checklist = [
    { ok: pack.attention.length === 0, text: pack.attention.length ? `${pack.attention.length} document${pack.attention.length === 1 ? '' : 's'} still need a look or are missing details.` : 'Every document is confirmed.', to: '/app/inbox' },
    { ok: pic.incomes.length > 0, text: pic.incomes.length ? `${pic.incomes.length} income record${pic.incomes.length === 1 ? '' : 's'} added.` : 'No income added yet. Add W-2s, 1099s or totals so the estimate is complete.', to: '/app/savings' },
    ...(unmarkedTrips.length ? [{ ok: false, text: `${unmarkedTrips.length} trip${unmarkedTrips.length === 1 ? '' : 's'} need business and personal days marked before travel can be counted.`, to: '/app/savings' }] : []),
    ...(se && pic.plan.priorYearTax == null ? [{ ok: false, text: 'Add last year’s total tax so the quarterly plan can use the safe harbor.', to: '/app/savings' }] : []),
  ]
  const fileBase = `shoebox-${year}-${profile.name.split(' ')[0].toLowerCase() || 'records'}`

  return (
    <div className="filing">
      <PageTitle
        eyebrow={`Filing pack · tax year ${year}`}
        title="Ready for your preparer"
        sub="Your year in the order a tax preparer or tax software asks for it. Every figure comes from your confirmed documents and answers."
        actions={
          <div className="filing-actions">
            <button className="btn" onClick={() => { download(`${fileBase}-schedule-c.csv`, scheduleCCsv(pack)); toast('good', 'Schedule C summary downloaded.') }} disabled={!se}><Icon name="doc" /> Schedule C CSV</button>
            <button className="btn" onClick={() => { download(`${fileBase}-documents.csv`, receiptsCsv(pack)); toast('good', 'Document list downloaded.') }}><Icon name="receipts" /> All documents CSV</button>
            <button className="btn btn-gold" onClick={() => window.print()}><Icon name="upload" /> Print or save as PDF</button>
          </div>
        }
      />
      <Link to="/app/pass" className="chip gold early-chip"><Icon name="sparkle" size={12} /> {Date.now() < PASS_REQUIRED_FROM ? 'Part of the Tax Year Pass · free during early access' : `Tax Year Pass · ${year}`}</Link>

      <div className="card rise filing-sec">
        <div className="card-head"><h2>Before you file</h2></div>
        <ul className="checklist">
          {checklist.map((c) => (
            <li key={c.text} className={c.ok ? 'ok' : 'todo'}>
              <Icon name={c.ok ? 'check' : 'alert'} size={16} /> <span>{c.text}</span>
              {!c.ok && <Link to={c.to} className="btn btn-sm btn-ghost no-print">Fix <Icon name="arrowRight" /></Link>}
            </li>
          ))}
        </ul>
        <dl className="facts">
          <div><dt>Name</dt><dd>{profile.name}</dd></div>
          <div><dt>Filing status</dt><dd>{filingLabels[profile.filingStatus]}</dd></div>
          <div><dt>State</dt><dd>{st?.name ?? profile.state}</dd></div>
          {profile.businessName && <div><dt>Business</dt><dd>{profile.businessName}</dd></div>}
        </dl>
      </div>

      <div className="card rise filing-sec">
        <div className="card-head"><h2>Income</h2></div>
        {pack.income.length === 0 ? (
          <p className="faint">No income recorded for {year}.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Type</th><th className="num hide-sm">Records</th><th className="num">Amount</th><th className="num">Tax withheld</th></tr></thead>
            <tbody>
              {pack.income.map((i) => <tr key={i.type}><td>{i.label}</td><td className="num hide-sm">{i.count}</td><td className="num"><Money v={i.amount} /></td><td className="num"><Money v={i.withheld} /></td></tr>)}
            </tbody>
          </table>
        )}
      </div>

      {se ? (
        <div className="card rise filing-sec">
          <div className="card-head"><h2>Schedule C expenses</h2><span className="faint" style={{ fontSize: 13 }}>Profit or loss from business</span></div>
          {pack.scheduleCTotal === 0 ? (
            <p className="faint">No business expenses recorded for {year}.</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>Line</th><th>What’s in it</th><th className="num hide-sm">Docs</th><th className="num hide-sm">Paid</th><th className="num">Deductible</th></tr></thead>
              <tbody>
                {pack.scheduleC.map((l) => <tr key={l.form}><td className="nowrap">{l.form.replace('Schedule C, ', '').replace(/^line/, 'Line')}</td><td>{l.label}</td><td className="num hide-sm">{l.count}</td><td className="num hide-sm"><Money v={l.paid} /></td><td className="num"><Money v={l.amount} /></td></tr>)}
                {pack.tripsAllowed > 0 && <tr><td className="nowrap">Lines 24a/24b</td><td>Business trips, allocated by business days</td><td className="hide-sm" /><td className="hide-sm" /><td className="num"><Money v={pack.tripsAllowed} /></td></tr>}
                {pack.mileage > 0 && <tr><td className="nowrap">Line 9</td><td>Standard mileage ({(pic.plan.milesFirstHalf ?? 0) + (pic.plan.milesSecondHalf ?? 0)} miles)</td><td className="hide-sm" /><td className="hide-sm" /><td className="num"><Money v={pack.mileage} /></td></tr>}
                {pack.homeOffice > 0 && <tr><td className="nowrap">Line 30</td><td>Home office, simplified method ({pic.plan.homeOfficeSqFt} sq ft)</td><td className="hide-sm" /><td className="hide-sm" /><td className="num"><Money v={pack.homeOffice} /></td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={2}>Total expenses</td><td className="hide-sm" colSpan={2} /><td className="num"><Money v={pack.scheduleCTotal} /></td></tr></tfoot>
            </table>
          )}
          <p className="hint" style={{ marginTop: 10 }}>Meals are already at 50% and gifts capped at $25 a person. Mileage and actual car costs can’t both be claimed for the same car; check which your preparer uses.</p>
        </div>
      ) : (
        <div className="card rise filing-sec">
          <div className="card-head"><h2>Business expenses</h2></div>
          <p className="muted" style={{ fontSize: 14 }}>Your profile says W-2 only, so there’s no Schedule C. Unreimbursed work expenses aren’t federally deductible for most employees under current law; some states still allow them.</p>
        </div>
      )}

      {est && (
        <div className="card rise filing-sec">
          <div className="card-head"><h2>Deductions and estimated tax</h2></div>
          <table className="tbl">
            <tbody>
              <tr><td>{est.deductionKind === 'itemized' ? 'Itemized deductions (Schedule A)' : 'Standard deduction'}</td><td className="num"><Money v={est.deduction} /></td></tr>
              {est.charityNonItemizer > 0 && <tr><td>Charity deduction for non-itemizers (new for 2026)</td><td className="num"><Money v={est.charityNonItemizer} /></td></tr>}
              {est.qbi > 0 && <tr><td>Qualified business income deduction</td><td className="num"><Money v={est.qbi} /></td></tr>}
              <tr><td>Adjusted gross income</td><td className="num"><Money v={est.agi} /></td></tr>
              <tr><td>Taxable income</td><td className="num"><Money v={est.taxable} /></td></tr>
              <tr><td>Federal income tax, after credits</td><td className="num"><Money v={est.incomeTax - est.credits} /></td></tr>
              {est.seTax > 0 && <tr><td>Self-employment tax</td><td className="num"><Money v={est.seTax} /></td></tr>}
              <tr><td>State tax</td><td className="num">{est.state.amount != null ? <Money v={est.state.amount} /> : <span className="faint">Not estimated</span>}</td></tr>
              <tr><td>Already paid (withholding and estimates)</td><td className="num"><Money v={est.paid} /></td></tr>
            </tbody>
            <tfoot><tr><td>{est.balance >= 0 ? 'Estimated to owe' : 'Estimated refund'}</td><td className="num"><Money v={Math.abs(est.balance)} /></td></tr></tfoot>
          </table>
          {pic.itemized.medical + pic.itemized.charityCash + pic.itemized.mortgageInterest + pic.itemized.propertyTax > 0 && est.deductionKind === 'standard' && (
            <p className="hint" style={{ marginTop: 10 }}>You have possible itemized deductions, but the standard deduction is larger, so it’s the one used.</p>
          )}
        </div>
      )}

      {pack.quarterly && se && (
        <div className="card rise filing-sec">
          <div className="card-head"><h2>Quarterly estimated tax</h2><span className="faint" style={{ fontSize: 13 }}>Form 1040-ES</span></div>
          <QuarterlyTable q={pack.quarterly} />
        </div>
      )}

      {pic.trips.length > 0 && (
        <div className="card rise filing-sec">
          <div className="card-head"><h2>Trips</h2><span className="faint" style={{ fontSize: 13 }}>IRS Publication 463</span></div>
          <table className="tbl">
            <thead><tr><th>Trip</th><th className="hide-sm">Dates</th><th className="num">Business / total days</th><th className="num">Counted</th></tr></thead>
            <tbody>
              {pic.trips.map(({ trip, result }) => (
                <tr key={trip.key}>
                  <td>{trip.cities.join(', ') || trip.country}</td>
                  <td className="nowrap hide-sm">{trip.start} to {trip.end}</td>
                  <td className="num">{result.rule === 'unmarked' ? <span className="faint">Not marked</span> : `${result.businessDays} / ${trip.totalDays}`}</td>
                  <td className="num">{result.rule === 'unmarked' ? '—' : <Money v={result.allowed} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card rise filing-sec">
        <div className="card-head"><h2>Documents</h2><span className="faint" style={{ fontSize: 13 }}>{pack.receipts.length} for {year}</span></div>
        {pack.receipts.length === 0 ? (
          <p className="faint">No documents for {year}.</p>
        ) : (
          <table className="tbl tbl-docs">
            <thead><tr><th>Date</th><th>Merchant</th><th className="hide-sm">Category</th><th className="num hide-sm">Paid</th><th className="num hide-sm">Biz %</th><th className="num">Deductible</th></tr></thead>
            <tbody>
              {pack.receipts.map((r) => (
                <tr key={r.id} className={r.status === 'needs_review' ? 'todo' : ''}>
                  <td className="nowrap">{r.extraction.date || '—'}</td>
                  <td>{r.extraction.merchant}{r.extraction.businessPurpose ? <div className="faint sub">{r.extraction.businessPurpose}</div> : null}</td>
                  <td className="hide-sm">{categoryById[r.classification.category].label}</td>
                  <td className="num hide-sm">{usdOf(r) != null ? <Money v={usdOf(r)!} /> : '—'}</td>
                  <td className="num hide-sm">{r.businessPct}%</td>
                  <td className="num"><Money v={r.classification.deductible} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="hint filing-foot">
        Prepared with Shoebox on {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}. This organizes your records for filing. It isn’t a tax return and isn’t tax advice: check every figure with your preparer or software, and keep the original documents.
      </p>
    </div>
  )
}
