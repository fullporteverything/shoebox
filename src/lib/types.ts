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
}

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
  memo: string
  history: { at: number; what: string }[]
}
