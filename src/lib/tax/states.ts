// State notes the classifier adds on top of the federal rules. States decide
// for themselves how far they follow federal law, so these are pointers to
// check, not conclusions. Reviewed with RULES_REVIEWED in rules.ts.

import type { CategoryId } from './rules.js'

export type StateInfo = {
  code: string
  name: string
  incomeTax: boolean
  salesTax: boolean
  notes: { categories?: CategoryId[]; workType?: ('w2' | 'self_employed')[]; text: string }[]
}

const NO_INCOME_TAX = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']
const NO_SALES_TAX = ['AK', 'DE', 'MT', 'NH', 'OR'] // Alaska allows local sales taxes

const names: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

const specific: Record<string, StateInfo['notes']> = {
  CA: [
    { categories: ['equipment'], text: 'California does not follow federal bonus depreciation, and its Section 179 limit is much lower. Expect a state adjustment for big equipment purchases.' },
    { categories: ['medical'], text: 'California does not recognize HSAs. HSA contributions and earnings are taxable on the state return.' },
    { workType: ['w2'], text: 'California still allows some unreimbursed employee expenses as itemized deductions, even though federal law does not.' },
  ],
  NY: [
    { categories: ['charity', 'medical', 'property_tax', 'mortgage_interest'], text: 'New York lets you itemize on the state return even if you take the federal standard deduction.' },
    { workType: ['w2'], text: 'New York allows some unreimbursed employee expenses as state itemized deductions.' },
  ],
  PA: [
    { workType: ['w2'], text: 'Pennsylvania lets employees deduct unreimbursed business expenses on Schedule UE, so keep work receipts even though they don’t count federally.' },
    { categories: ['charity', 'medical'], text: 'Pennsylvania has no standard or itemized deductions, so these expenses do not reduce your state tax.' },
  ],
  NH: [{ text: 'New Hampshire has no tax on wages and no general sales tax.' }],
  WA: [{ text: 'Washington has no tax on wages, but it does tax some long-term capital gains.' }],
  TN: [{ text: 'Tennessee has no tax on wages.' }],
}

export const states: StateInfo[] = Object.keys(names)
  .sort((a, b) => names[a].localeCompare(names[b]))
  .map((code) => {
    const incomeTax = !NO_INCOME_TAX.includes(code)
    const salesTax = !NO_SALES_TAX.includes(code)
    const notes: StateInfo['notes'] = [...(specific[code] ?? [])]
    if (!incomeTax && salesTax) {
      notes.push({
        categories: ['equipment', 'property_tax', 'personal'],
        text: `${names[code]} has no income tax on wages, so if you itemize, deducting sales tax is usually worth it. Keep receipts for big purchases like cars, boats and home improvements.`,
      })
    }
    if (!incomeTax && !specific[code]) notes.push({ text: `${names[code]} has no state income tax on wages, so there is no state return for wages.` })
    if (incomeTax && !specific[code]) {
      notes.push({ text: `${names[code]} starts from federal income but sets its own rules for some deductions. Check its conformity before filing.` })
    }
    return { code, name: names[code], incomeTax, salesTax, notes }
  })

export const stateByCode = Object.fromEntries(states.map((s) => [s.code, s])) as Record<string, StateInfo>
