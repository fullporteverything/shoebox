// How the business is set up, and how the IRS taxes it. The legal form (LLC,
// corporation, none) and the tax treatment are different questions: an LLC
// is taxed like a sole proprietorship, a partnership or a corporation
// depending on its owners and any election it files. Only the tax treatment
// changes the math.
//
//   Schedule C   sole proprietor, or a single-member LLC with no election.
//                The LLC is "disregarded" (Treas. Reg. §301.7701-3(b)(1)(ii)).
//   Partnership  multi-member LLC with no election, or a partnership. The
//                business files Form 1065; each owner gets a Schedule K-1
//                (Treas. Reg. §301.7701-3(b)(1)(i)).
//   S corp       a corporation or LLC that filed Form 2553. The business
//                files Form 1120-S; owners get a K-1 and, if they work in
//                it, a W-2 salary (IRC §1361-1368).

import type { Plan } from '../types.js'

export type Entity = Plan['entity']
export type Treatment = 'schedule_c' | 'partnership' | 's_corp'

// Saved plans from before LLCs were listed separately use '', 'sole_prop',
// 's_corp' and 'partnership'. Those keep their meaning; the new values only
// add detail.
export function treatmentOf(entity: Entity | undefined): Treatment {
  switch (entity) {
    case 'partnership':
      return 'partnership'
    case 's_corp':
    case 'llc_s_corp':
      return 's_corp'
    default:
      return 'schedule_c' // '', 'sole_prop', 'smllc'
  }
}

export const isLlc = (e: Entity) => e === 'smllc' || e === 'llc_s_corp' || e === 'partnership'

export const entityOptions: { value: Entity; label: string; hint?: string }[] = [
  { value: '', label: 'Not sure' },
  { value: 'sole_prop', label: 'Sole proprietor (no LLC)' },
  { value: 'smllc', label: 'Single-member LLC', hint: 'Taxed like a sole proprietor unless it elected otherwise' },
  { value: 'llc_s_corp', label: 'LLC taxed as an S corporation', hint: 'Filed Form 2553' },
  { value: 'partnership', label: 'Multi-member LLC or partnership', hint: 'Files Form 1065' },
  { value: 's_corp', label: 'S corporation (not an LLC)', hint: 'Files Form 1120-S' },
]

export const entityLabel = (e: Entity) => entityOptions.find((o) => o.value === e)?.label ?? 'Not sure'

// The business's own return. Schedule C is part of the owner's Form 1040.
export const businessReturn: Record<Treatment, string> = { schedule_c: 'Schedule C', partnership: 'Form 1065', s_corp: 'Form 1120-S' }

// Form 1065 and Form 1120-S are due the 15th day of the 3rd month after the
// tax year ends: March 15 for a calendar year (IRC §6072(b); Form 1065 and
// 1120-S instructions). A weekend date moves to the next business day
// (IRC §7503).
export function entityReturnDue(taxYear: number) {
  const d = new Date(Date.UTC(taxYear + 1, 2, 15))
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
