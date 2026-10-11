// The rules engine. The AI proposes a category; this decides what is actually
// deductible, applies the limits it knows about, and explains itself. It never
// trusts a number it did not check.

import {
  CHARITY_ACK_THRESHOLD, DE_MINIMIS_SAFE_HARBOR, DOCUMENTARY_EVIDENCE_THRESHOLD, GIFT_LIMIT,
  categories, categoryById,
} from './rules.js'
import type { CategoryId } from './rules.js'
import { stateByCode } from './states.js'
import type { Classification, Extraction, Profile } from '../types.js'
import { usdFigure } from '../fx.js'
import type { Fx } from '../fx.js'

export function keywordCategory(text: string): { id: CategoryId; hits: number } | null {
  const t = ' ' + text.toLowerCase() + ' '
  let best: { id: CategoryId; hits: number } | null = null
  for (const c of categories) {
    const hits = c.keywords.filter((k) => t.includes(k)).length
    if (hits && (!best || hits > best.hits)) best = { id: c.id, hits }
  }
  return best
}

const round = (n: number) => Math.round(n * 100) / 100

export function classify(
  ex: Extraction,
  profile: Pick<Profile, 'state' | 'workType'>,
  opts: { override?: CategoryId; businessPct?: number; source?: Classification['source']; usdAmount?: number | null; fx?: Fx | null } = {},
): Classification {
  const text = [ex.merchant, ex.city ?? '', ex.formType ?? '', ex.notes, ex.businessPurpose, ...ex.lineItems.map((l) => l.description)].join(' ')
  const kw = keywordCategory(text)
  const valid = (id: string | undefined): id is CategoryId => !!id && id in categoryById

  let category: CategoryId
  let source: Classification['source']
  let confidence: number
  if (opts.override) {
    category = opts.override
    source = 'you'
    confidence = 1
  } else if (ex.documentType === 'tax_form' && /w-?2|1099|k-1/i.test(ex.formType ?? '')) {
    category = 'income_form'
    source = 'rules'
    confidence = 0.95
  } else if (valid(ex.suggestedCategory)) {
    category = ex.suggestedCategory
    source = opts.source ?? 'ai'
    confidence = ex.confidence
    // When the keywords disagree with the AI and it was unsure, lower confidence.
    if (kw && kw.id !== category && ex.confidence < 0.7) confidence = Math.min(confidence, 0.5)
  } else if (kw) {
    category = kw.id
    source = 'rules'
    confidence = Math.min(0.85, 0.45 + kw.hits * 0.15)
  } else {
    category = 'personal'
    source = 'rules'
    confidence = 0.3
  }

  const cat = categoryById[category]
  const reasons = [cat.rule]
  const flags: Classification['flags'] = []
  // IRS amounts are in US dollars. A foreign-currency document counts at the
  // statement figure, else the dollar amount printed on it, else the posted
  // exchange rate for its date (see fx.ts).
  const foreign = !!ex.currency && ex.currency !== 'USD'
  const { usd, from } = usdFigure(ex, opts.usdAmount, opts.fx)
  const total = Math.max(0, usd ?? 0)
  const businessPct = opts.businessPct ?? 100
  let deductible = total * cat.deductiblePct

  if (cat.group === 'business') {
    // W-2 employees can't deduct unreimbursed work expenses federally.
    if (profile.workType === 'w2') {
      deductible = 0
      flags.push({ level: 'warn', text: 'Employees can’t deduct unreimbursed work expenses on the federal return. This only counts if you have self-employment income.' })
    }
    deductible *= businessPct / 100
    if (businessPct < 100) reasons.push(`Counting the ${businessPct}% business share.`)
    if (category === 'meals') {
      const tip = ex.tip ?? 0
      reasons.push(`50% of the full bill${tip ? ', tip included,' : ''} counts.`)
      if (!ex.businessPurpose) flags.push({ level: 'warn', text: 'Add who you met and the business purpose. The IRS expects both for meals.' })
    }
    if (category === 'gifts') {
      deductible = Math.min(deductible, GIFT_LIMIT)
      if (total > GIFT_LIMIT) flags.push({ level: 'info', text: `Only $${GIFT_LIMIT} per recipient per year counts. If this gift was for more than one person, note who.` })
    }
    if (category === 'equipment' && total > DE_MINIMIS_SAFE_HARBOR) {
      flags.push({ level: 'info', text: `Over $${DE_MINIMIS_SAFE_HARBOR.toLocaleString()}, so this is depreciated or expensed under Section 179 rather than written off as a supply.` })
    }
    if (category === 'travel' || total >= DOCUMENTARY_EVIDENCE_THRESHOLD) {
      flags.push({ level: 'info', text: category === 'travel' ? 'Lodging always needs an itemized receipt. Keep this one.' : `$${DOCUMENTARY_EVIDENCE_THRESHOLD} or more, so keep this receipt as documentary evidence.` })
    }
  }
  if (category === 'medical') flags.push({ level: 'info', text: 'Counts only toward the total above 7.5% of AGI, and only if you itemize.' })
  if (category === 'charity' && total >= CHARITY_ACK_THRESHOLD) {
    flags.push({ level: 'warn', text: `Gifts of $${CHARITY_ACK_THRESHOLD} or more need a written acknowledgment from the charity. A card receipt alone isn’t enough.` })
  }
  if (cat.group === 'income') deductible = 0
  if (foreign && usd == null) {
    flags.push({ level: 'warn', text: `This is in ${ex.currency}, and there’s no published exchange rate for it yet. Enter the US dollar amount from your card or bank statement so it can count.` })
  } else if (from === 'fx' && opts.fx) {
    reasons.push(`Converted at the ${opts.fx.source} for ${opts.fx.date}: 1 ${ex.currency} = $${opts.fx.rate.toFixed(4)}. If your card statement shows a different dollar amount, enter it; that’s the more exact figure.`)
  } else if (foreign) {
    reasons.push(`Using the US dollar amount ${from === 'you' ? 'you entered' : 'printed on the receipt'} for this ${ex.currency} purchase.`)
  }
  if (!ex.date) flags.push({ level: 'warn', text: 'No date found. Add one so this lands in the right tax year.' })
  if (confidence < 0.6) flags.push({ level: 'warn', text: 'Low confidence. Check the category before you confirm.' })

  const st = stateByCode[profile.state]
  const stateNotes = st
    ? st.notes
        .filter((n) => (!n.categories || n.categories.includes(category)) && (!n.workType || n.workType.includes(profile.workType === 'both' ? 'self_employed' : profile.workType)))
        .map((n) => n.text)
    : []

  return { category, deductible: round(deductible), confidence: round(confidence), source, reasons, stateNotes, flags }
}
