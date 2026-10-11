import type { Picture } from './tax/advisor.js'
import { categoryById, RULES_REVIEWED } from './tax/rules.js'
import { stateByCode } from './tax/states.js'
import type { Profile, Receipt } from './types.js'
import { usdOf } from './tax/advisor.js'

const $ = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

// A compact, factual summary of the person's records for the assistant.
export function contextFor(profile: Profile, receipts: Receipt[], pic: Picture): string {
  const p = pic.plan
  const lines: string[] = []
  lines.push(`Tax year ${profile.taxYear}. State: ${stateByCode[profile.state]?.name ?? profile.state}. Filing status: ${profile.filingStatus.replace('_', ' ')}. Work: ${profile.workType.replace('_', ' ')}${p.occupation ? `, occupation ${p.occupation.replace('_', ' ')}` : ''}${p.entity ? `, entity ${p.entity.replace('_', ' ')}` : ''}.`)
  const known = Object.entries(p).filter(([k, v]) => v !== null && v !== '' && k !== 'occupation' && k !== 'entity').map(([k, v]) => `${k}=${v}`)
  const unknown = Object.entries(p).filter(([, v]) => v === null || v === '').map(([k]) => k)
  if (known.length) lines.push(`Answers: ${known.join(', ')}.`)
  if (unknown.length) lines.push(`Not answered yet: ${unknown.join(', ')}.`)
  const byType: Record<string, number> = {}
  pic.incomes.forEach((i) => (byType[i.type] = (byType[i.type] ?? 0) + i.amount))
  lines.push(`Income so far: ${Object.entries(byType).map(([k, v]) => `${k} ${$(v)}`).join(', ') || 'none recorded'}.`)
  const byCat: Record<string, { n: number; paid: number; ded: number }> = {}
  receipts.forEach((r) => {
    const c = (byCat[r.classification.category] ??= { n: 0, paid: 0, ded: 0 })
    c.n++
    c.paid += usdOf(r) ?? 0
    c.ded += r.classification.deductible
  })
  lines.push('Receipts by category: ' + (Object.entries(byCat).map(([k, v]) => `${categoryById[k as keyof typeof categoryById].label} ${v.n} items, paid ${$(v.paid)}, counted ${$(v.ded)}`).join('; ') || 'none') + '.')
  if (pic.est) {
    const e = pic.est
    lines.push(`Estimate: AGI ${$(e.agi)}, ${e.deductionKind} deduction ${$(e.deduction)}, QBI ${$(e.qbi)}, taxable ${$(e.taxable)}, income tax ${$(e.incomeTax)}, SE tax ${$(e.seTax)}, credits ${$(e.credits)}, state ${e.state.amount == null ? 'not estimated' : $(e.state.amount)}, total ${$(e.totalTax)}, paid ${$(e.paid)}, balance ${$(e.balance)}. Marginal federal ${Math.round(e.marginal.federal * 100)}%.`)
  }
  pic.trips.forEach(({ trip, result }) => lines.push(`Trip: ${trip.country} (${trip.cities.join(', ')}), ${trip.start} to ${trip.end}, ${trip.totalDays} days; business days ${result.businessDays}, personal ${result.personalDays}, unmarked ${result.unmarked}; rule ${result.rule}; allowed ${$(result.allowed)}.`))
  lines.push(`Suggestions already shown in the app: ${pic.opportunities.map((o) => o.title).join('; ') || 'none'}.`)
  lines.push(`App rules last reviewed ${RULES_REVIEWED}.`)
  return lines.join('\n').slice(0, 12_000)
}
