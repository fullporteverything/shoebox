// Federal tax categories and the rules the classifier enforces.
//
// These summarize IRS guidance (Schedule C instructions, Pub 463, Pub 535/334,
// Pub 502, Pub 526, Pub 587) for organizing records. They are not tax advice.
// RULES_REVIEWED records when the figures were last checked; review them every
// tax year before relying on them.

export const RULES_REVIEWED = 'October 2026'

export type CategoryId =
  | 'advertising' | 'car' | 'contract_labor' | 'insurance' | 'interest' | 'legal_professional'
  | 'office' | 'rent' | 'repairs' | 'supplies' | 'taxes_licenses' | 'travel' | 'meals'
  | 'utilities' | 'software' | 'equipment' | 'education' | 'home_office' | 'gifts'
  | 'medical' | 'charity' | 'childcare' | 'tuition' | 'property_tax' | 'mortgage_interest'
  | 'income_form' | 'personal'

export type Group = 'business' | 'itemized' | 'credit' | 'income' | 'personal'

export type Category = {
  id: CategoryId
  label: string
  group: Group
  form: string // where it lands
  deductiblePct: number // share of the amount that is deductible before limits (0..1)
  hue: number // for UI color, degrees on the color wheel
  keywords: string[]
  rule: string // one-line explanation shown to the user
  ruleRef: string
}

export const categories: Category[] = [
  { id: 'advertising', label: 'Advertising', group: 'business', form: 'Schedule C, line 8', deductiblePct: 1, hue: 32,
    keywords: ['ads', 'advert', 'facebook ads', 'google ads', 'meta', 'flyer', 'billboard', 'promo', 'marketing', 'business card', 'signage'],
    rule: 'Ads, promotion and marketing costs for your business are fully deductible.', ruleRef: 'Schedule C instructions, line 8' },
  { id: 'car', label: 'Car and truck', group: 'business', form: 'Schedule C, line 9', deductiblePct: 1, hue: 200,
    keywords: ['fuel', 'gas station', 'gasoline', 'diesel', 'parking', 'toll', 'oil change', 'tire', 'car wash', 'ev charging', 'mileage'],
    rule: 'Only the business-use share of vehicle costs counts. Choose the standard mileage rate or actual expenses, and keep a mileage log.', ruleRef: 'Pub 463, ch. 4' },
  { id: 'contract_labor', label: 'Contract labor', group: 'business', form: 'Schedule C, line 11', deductiblePct: 1, hue: 280,
    keywords: ['contractor', 'freelancer', 'upwork', 'fiverr', 'subcontract'],
    rule: 'Payments to non-employees are deductible. Paying one person $600 or more in a year usually means filing a 1099-NEC for them.', ruleRef: 'Schedule C instructions, line 11' },
  { id: 'insurance', label: 'Business insurance', group: 'business', form: 'Schedule C, line 15', deductiblePct: 1, hue: 220,
    keywords: ['liability insurance', 'business insurance', 'e&o', 'errors and omissions', 'commercial policy'],
    rule: 'Business insurance premiums are deductible. Self-employed health insurance goes on Schedule 1 instead.', ruleRef: 'Pub 535 / Pub 334' },
  { id: 'interest', label: 'Business interest', group: 'business', form: 'Schedule C, line 16', deductiblePct: 1, hue: 240,
    keywords: ['loan interest', 'business credit card interest', 'finance charge'],
    rule: 'Interest on money borrowed for the business is deductible. Interest on personal debt is not.', ruleRef: 'Schedule C instructions, line 16' },
  { id: 'legal_professional', label: 'Legal and professional', group: 'business', form: 'Schedule C, line 17', deductiblePct: 1, hue: 260,
    keywords: ['attorney', 'lawyer', 'cpa', 'accountant', 'bookkeeping', 'tax prep', 'consulting fee', 'legal'],
    rule: 'Fees for lawyers, accountants and tax preparers that relate to the business are deductible.', ruleRef: 'Schedule C instructions, line 17' },
  { id: 'office', label: 'Office expense', group: 'business', form: 'Schedule C, line 18', deductiblePct: 1, hue: 160,
    keywords: ['postage', 'ups', 'fedex', 'usps', 'shipping', 'printer ink', 'toner', 'stationery'],
    rule: 'Day-to-day office costs like postage and printing are deductible.', ruleRef: 'Schedule C instructions, line 18' },
  { id: 'rent', label: 'Rent or lease', group: 'business', form: 'Schedule C, line 20', deductiblePct: 1, hue: 180,
    keywords: ['coworking', 'office rent', 'studio rent', 'storage unit', 'equipment rental', 'lease'],
    rule: 'Rent for business space or equipment is deductible. Rent on your home goes under home office.', ruleRef: 'Schedule C instructions, line 20' },
  { id: 'repairs', label: 'Repairs and maintenance', group: 'business', form: 'Schedule C, line 21', deductiblePct: 1, hue: 20,
    keywords: ['repair', 'maintenance', 'service call', 'fix'],
    rule: 'Repairs that keep business property working are deductible. Improvements that add value are depreciated.', ruleRef: 'Schedule C instructions, line 21' },
  { id: 'supplies', label: 'Supplies', group: 'business', form: 'Schedule C, line 22', deductiblePct: 1, hue: 140,
    keywords: ['supplies', 'office supply', 'paper', 'pens', 'cleaning', 'materials', 'hardware store'],
    rule: 'Materials and supplies used up in the business are deductible in the year you buy them.', ruleRef: 'Schedule C instructions, line 22' },
  { id: 'taxes_licenses', label: 'Taxes and licenses', group: 'business', form: 'Schedule C, line 23', deductiblePct: 1, hue: 50,
    keywords: ['license', 'permit', 'business registration', 'franchise tax', 'renewal fee'],
    rule: 'Business licenses, permits and business taxes are deductible. Federal income tax is not.', ruleRef: 'Schedule C instructions, line 23' },
  { id: 'travel', label: 'Travel', group: 'business', form: 'Schedule C, line 24a', deductiblePct: 1, hue: 210,
    keywords: ['hotel', 'airbnb', 'airline', 'flight', 'delta', 'united', 'southwest', 'amtrak', 'uber', 'lyft', 'taxi', 'rental car', 'baggage'],
    rule: 'Travel away from your tax home for business is deductible. Lodging always needs a receipt.', ruleRef: 'Pub 463, ch. 1' },
  { id: 'meals', label: 'Business meals', group: 'business', form: 'Schedule C, line 24b', deductiblePct: 0.5, hue: 12,
    keywords: ['restaurant', 'cafe', 'coffee', 'diner', 'grill', 'bistro', 'kitchen', 'bar', 'pizza', 'sushi', 'taqueria', 'doordash', 'grubhub'],
    rule: 'Business meals are generally 50% deductible. Write down who you met and what you discussed. Entertainment is not deductible.', ruleRef: 'Pub 463, ch. 2' },
  { id: 'utilities', label: 'Utilities and phone', group: 'business', form: 'Schedule C, line 25', deductiblePct: 1, hue: 190,
    keywords: ['electric', 'water bill', 'internet', 'comcast', 'xfinity', 'verizon', 'at&t', 't-mobile', 'phone bill', 'wireless'],
    rule: 'Business utilities are deductible. For a phone or internet line you also use personally, deduct only the business share.', ruleRef: 'Schedule C instructions, line 25' },
  { id: 'software', label: 'Software and subscriptions', group: 'business', form: 'Schedule C, line 27a', deductiblePct: 1, hue: 300,
    keywords: ['subscription', 'saas', 'software', 'adobe', 'microsoft 365', 'google workspace', 'dropbox', 'zoom', 'slack', 'hosting', 'domain', 'cloud'],
    rule: 'Software and online services you use for the business are deductible as other expenses.', ruleRef: 'Schedule C, Part V' },
  { id: 'equipment', label: 'Equipment', group: 'business', form: 'Form 4562 / Schedule C, line 13', deductiblePct: 1, hue: 230,
    keywords: ['laptop', 'computer', 'macbook', 'monitor', 'camera', 'printer', 'desk', 'chair', 'tablet', 'ipad', 'tools'],
    rule: 'Items up to $2,500 each can usually be expensed under the de minimis safe harbor. Larger purchases are depreciated or expensed under Section 179.', ruleRef: 'Reg. 1.263(a)-1(f); Pub 946' },
  { id: 'education', label: 'Work education', group: 'business', form: 'Schedule C, line 27a', deductiblePct: 1, hue: 270,
    keywords: ['course', 'workshop', 'seminar', 'conference', 'webinar', 'training', 'certification', 'books'],
    rule: 'Education that maintains or improves skills for your current business is deductible. Training for a new career is not.', ruleRef: 'Pub 970, ch. 11' },
  { id: 'home_office', label: 'Home office', group: 'business', form: 'Form 8829 or simplified method', deductiblePct: 1, hue: 100,
    keywords: ['home office', 'rent receipt', 'renters insurance', 'mortgage statement'],
    rule: 'Space used regularly and only for business qualifies. The simplified method is $5 per square foot, up to 300 square feet.', ruleRef: 'Pub 587' },
  { id: 'gifts', label: 'Business gifts', group: 'business', form: 'Schedule C, line 27a', deductiblePct: 1, hue: 340,
    keywords: ['gift', 'gift card', 'flowers', 'gift basket'],
    rule: 'Business gifts are deductible up to $25 per recipient per year.', ruleRef: 'Pub 463, ch. 3' },
  { id: 'medical', label: 'Medical and dental', group: 'itemized', form: 'Schedule A, line 1', deductiblePct: 1, hue: 0,
    keywords: ['pharmacy', 'cvs', 'walgreens', 'doctor', 'dentist', 'clinic', 'hospital', 'copay', 'prescription', 'optometrist', 'urgent care'],
    rule: 'Only the part of total medical costs above 7.5% of your AGI is deductible, and only if you itemize.', ruleRef: 'Pub 502' },
  { id: 'charity', label: 'Charitable gifts', group: 'itemized', form: 'Schedule A, lines 11–12', deductiblePct: 1, hue: 320,
    keywords: ['donation', 'donate', 'charity', 'church', 'nonprofit', '501(c)', 'goodwill', 'salvation army', 'red cross'],
    rule: 'Gifts to qualified charities count when you itemize. Any single gift of $250 or more needs a written acknowledgment from the charity. Starting with tax year 2026, people who take the standard deduction can also deduct some cash gifts.', ruleRef: 'Pub 526' },
  { id: 'childcare', label: 'Child and dependent care', group: 'credit', form: 'Form 2441', deductiblePct: 1, hue: 80,
    keywords: ['daycare', 'child care', 'preschool', 'babysitter', 'after school', 'summer camp'],
    rule: 'Care costs so you can work may qualify for the child and dependent care credit. You need the provider’s tax ID.', ruleRef: 'Pub 503' },
  { id: 'tuition', label: 'Tuition (education credits)', group: 'credit', form: 'Form 8863', deductiblePct: 1, hue: 260,
    keywords: ['tuition', '1098-t', 'university', 'college', 'registrar'],
    rule: 'Qualified tuition may earn the American Opportunity or Lifetime Learning credit. Keep the school’s Form 1098-T.', ruleRef: 'Pub 970' },
  { id: 'property_tax', label: 'Property tax', group: 'itemized', form: 'Schedule A, line 5b', deductiblePct: 1, hue: 40,
    keywords: ['property tax', 'county tax', 'tax collector', 'assessor'],
    rule: 'State and local taxes, including property tax, are deductible when you itemize, up to the SALT cap ($40,000 for 2025, rising 1% a year, lower for high incomes).', ruleRef: 'Schedule A instructions, line 5' },
  { id: 'mortgage_interest', label: 'Mortgage interest', group: 'itemized', form: 'Schedule A, line 8a', deductiblePct: 1, hue: 60,
    keywords: ['1098', 'mortgage interest', 'mortgage statement'],
    rule: 'Home mortgage interest is deductible when you itemize, generally on up to $750,000 of debt.', ruleRef: 'Pub 936' },
  { id: 'income_form', label: 'Income document', group: 'income', form: 'Form 1040', deductiblePct: 0, hue: 150,
    keywords: ['w-2', 'w2', '1099', '1099-nec', '1099-k', '1099-int', '1099-div', 'k-1'],
    rule: 'This reports income rather than an expense. Keep it with your return; the amounts must match what the IRS receives.', ruleRef: 'Form 1040 instructions' },
  { id: 'personal', label: 'Personal (not deductible)', group: 'personal', form: '—', deductiblePct: 0, hue: 210,
    keywords: ['grocery', 'supermarket', 'clothing', 'apparel', 'netflix', 'spotify', 'gym', 'movie', 'concert'],
    rule: 'Personal, living and family expenses are not deductible.', ruleRef: 'IRC §262' },
]

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<CategoryId, Category>

export const groupLabels: Record<Group, string> = {
  business: 'Business expenses',
  itemized: 'Itemized deductions',
  credit: 'Credits',
  income: 'Income documents',
  personal: 'Not deductible',
}

// IRS recordkeeping rules that apply to individual receipts.
export const DOCUMENTARY_EVIDENCE_THRESHOLD = 75 // Pub 463: receipts required for expenses of $75 or more, and all lodging
export const GIFT_LIMIT = 25
export const DE_MINIMIS_SAFE_HARBOR = 2500
export const CHARITY_ACK_THRESHOLD = 250
export const RETENTION_YEARS = 3
