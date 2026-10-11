import type { CategoryId } from './tax/rules.js'

export type WorkType = 'w2' | 'self_employed' | 'both'
export type FilingStatus = 'single' | 'married_joint' | 'married_separate' | 'head_of_household'

export type Profile = {
  name: string
  email: string
  state: string // two-letter code
  workType: WorkType
  filingStatus: FilingStatus
  businessName: string
  taxYear: number
  avatarHue: number
  plan?: Plan
}

// Answers to the savings assistant's questions. null means "not answered yet":
// the assistant asks instead of assuming.
export type Plan = {
  occupation: '' | 'content_creator' | 'consultant' | 'trades' | 'rideshare_delivery' | 'real_estate' | 'retail_ecommerce' | 'other'
  // How the business is set up; see tax/entity.ts. '' means not answered.
  entity: '' | 'sole_prop' | 'smllc' | 'llc_s_corp' | 'partnership' | 's_corp'
  ownershipPct: number | null // 0..100, your share of a partnership's or S corp's profit
  ownerSalary: number | null // W-2 salary your S corp pays you this year
  age65: boolean | null
  age50: boolean | null
  dependents: number | null // qualifying children under 17
  hdhp: 'none' | 'self' | 'family' | null
  hsaContrib: number | null
  healthPremiums: number | null // self-paid health insurance, self-employed only
  retirement: 'none' | 'sep' | 'solo401k' | 'employer' | null
  retirementContrib: number | null
  estimatedPaid: number | null
  priorYearTax: number | null
  priorYearAgi: number | null
  homeOfficeSqFt: number | null
  milesFirstHalf: number | null
  milesSecondHalf: number | null
  tips: number | null
  overtime: number | null
  kidsCanWork: boolean | null
  startedThisYear: boolean | null
  shareSavings: boolean | null // counted in the public savings total unless false
}

export const emptyPlan: Plan = {
  occupation: '', entity: '', ownershipPct: null, ownerSalary: null, age65: null, age50: null, dependents: null, hdhp: null, hsaContrib: null, healthPremiums: null,
  retirement: null, retirementContrib: null, estimatedPaid: null, priorYearTax: null, priorYearAgi: null, homeOfficeSqFt: null,
  milesFirstHalf: null, milesSecondHalf: null, tips: null, overtime: null, kidsCanWork: null, startedThisYear: null, shareSavings: null,
}

export type IncomeType = 'wages' | 'self_employment' | 'interest' | 'dividends' | 'other'

export type IncomeEntry = {
  id: string
  date: string
  source: string
  type: IncomeType
  amount: number
  withheld: number // federal income tax withheld
  fromReceipt?: string
}

export type DayKind = 'business' | 'travel' | 'personal'

export type Evidence = { id: string; date: string; name: string; kind: 'photo' | 'video'; thumb: string; note: string; addedAt: number }

export type TripLog = { key: string; days: Record<string, DayKind>; evidence: Evidence[]; primaryPurpose: string; start?: string; end?: string }

// What the AI (or the person) reads off a document. api/analyze.ts mirrors
// this shape as a zod schema; keep the two in step.
export type Extraction = {
  documentType: 'receipt' | 'invoice' | 'bill' | 'statement' | 'tax_form' | 'donation_letter' | 'other'
  merchant: string
  date: string // YYYY-MM-DD, or '' when unreadable
  total: number
  tax: number | null
  tip: number | null
  currency: string
  paymentMethod: string | null
  lineItems: { description: string; amount: number }[]
  formType: string | null
  suggestedCategory: CategoryId
  businessPurpose: string
  confidence: number // 0..1
  notes: string
  city: string | null
  country: string | null
  usdTotal: number | null // amount charged in US dollars, when the document shows it
}

export type Classification = {
  category: CategoryId
  deductible: number // dollars, before AGI floors and caps
  confidence: number
  source: 'ai' | 'rules' | 'you'
  reasons: string[] // federal rule, in plain words
  stateNotes: string[]
  flags: { level: 'info' | 'warn'; text: string }[]
}

export type Receipt = {
  id: string
  createdAt: number
  fileName: string
  image: string | null // data URL of the downscaled image, kept encrypted at rest
  extraction: Extraction
  classification: Classification
  status: 'needs_review' | 'confirmed'
  businessPct: number // 0..100, share used for business
  usdAmount?: number | null // the person's own USD figure for a foreign-currency document
  fx?: { rate: number; date: string; source: string } | null // exchange rate used when there's no USD figure
  memo: string
  history: { at: number; what: string }[]
}
