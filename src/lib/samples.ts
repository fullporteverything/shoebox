// Sample documents drawn on a canvas, so people can try the app without
// uploading their own records. Each one carries the right answer, used when
// no AI is available. All merchants are made up.

import type { Extraction } from './types.js'

type Sample = {
  cur?: string // symbol printed before amounts
  usd?: number // US dollar amount printed on the slip (dynamic currency conversion)
  file: string
  title: string[]
  meta: string[]
  items: [string, number][]
  tax?: number
  tip?: number
  footer: string[]
  truth: Omit<Extraction, 'lineItems' | 'tax' | 'tip' | 'total'>
  paper?: string
}

const year = new Date().getFullYear()
const d = (m: number, day: number) => `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
const us = (iso: string) => {
  const [y, m, day] = iso.split('-')
  return `${m}/${day}/${y}`
}

const samples: Sample[] = [
  {
    file: 'cafe-verde.jpg', title: ['CAFE VERDE', 'kitchen + bar'], meta: ['418 Alder St, Portland OR', `Date ${us(d(3, 14))}  12:41 PM`, 'Server: Mika   Table 9   Guests 2'],
    items: [['Grain bowl', 16.5], ['Steak frites', 28.0], ['Sparkling water x2', 9.0], ['Espresso x2', 7.0]], tax: 0, tip: 12.1,
    footer: ['VISA ****4471', 'Thank you!'],
    truth: { documentType: 'receipt', merchant: 'Cafe Verde', date: d(3, 14), currency: 'USD', paymentMethod: 'Visa ending 4471', formType: null, city: null, country: 'United States', usdTotal: null, suggestedCategory: 'meals', businessPurpose: 'Lunch meeting with a client', confidence: 0.82, notes: 'Two guests. Add who attended.' },
  },
  {
    file: 'northline-fuel.jpg', title: ['NORTHLINE FUEL', 'STATION #2207'], meta: ['I-84 Exit 17, Troutdale OR', `${us(d(3, 18))}  07:55`, 'PUMP 06'],
    items: [['Regular unl 13.402 gal @ 3.899', 52.25]], tax: 0,
    footer: ['MASTERCARD ****0932', 'AUTH 448120'],
    truth: { documentType: 'receipt', merchant: 'Northline Fuel', date: d(3, 18), currency: 'USD', paymentMethod: 'Mastercard ending 0932', formType: null, city: null, country: 'United States', usdTotal: null, suggestedCategory: 'car', businessPurpose: 'Fuel for a client site visit', confidence: 0.78, notes: 'Only the business-use share of vehicle costs counts.' },
  },
  {
    file: 'paper-and-pine.jpg', title: ['PAPER & PINE', 'office supply co.'], meta: ['22 Market Sq, Salem OR', `${us(d(4, 2))}  3:12 PM`, 'Reg 3  Cashier Dev'],
    items: [['Copy paper 8.5x11 case', 42.99], ['Gel pens 12pk', 11.49], ['Black ink cartridge', 34.99], ['Shipping labels', 13.49]], tax: 0,
    footer: ['DEBIT ****2280', 'Returns within 30 days'],
    truth: { documentType: 'receipt', merchant: 'Paper & Pine Office Supply', date: d(4, 2), currency: 'USD', paymentMethod: 'Debit ending 2280', formType: null, city: null, country: 'United States', usdTotal: null, suggestedCategory: 'supplies', businessPurpose: 'Office supplies', confidence: 0.9, notes: '' },
  },
  {
    file: 'cloudnest.jpg', title: ['CLOUDNEST', 'INVOICE CN-58213'], meta: ['Billed to: Account 77-1042', `Invoice date ${us(d(4, 30))}`, 'Period: May 1 – May 31'],
    items: [['Pro hosting plan', 24.0], ['Custom domain renewal', 18.0], ['Daily backups', 6.0]], tax: 0,
    footer: ['Paid by card ****4471', 'Questions? billing@cloudnest.example'],
    truth: { documentType: 'invoice', merchant: 'Cloudnest', date: d(4, 30), currency: 'USD', paymentMethod: 'Card ending 4471', formType: null, city: null, country: 'United States', usdTotal: null, suggestedCategory: 'software', businessPurpose: 'Website hosting for the business', confidence: 0.92, notes: '' },
  },
  {
    file: 'harbor-cowork.jpg', title: ['HARBOR COWORK', 'membership receipt'], meta: ['1 Pier Way, Astoria OR', `${us(d(5, 1))}`, 'Member #3391'],
    items: [['Dedicated desk – May', 325.0], ['Locker', 25.0]], tax: 0,
    footer: ['ACH transfer', 'See you at the harbor'],
    truth: { documentType: 'receipt', merchant: 'Harbor Cowork', date: d(5, 1), currency: 'USD', paymentMethod: 'ACH transfer', formType: null, city: null, country: 'United States', usdTotal: null, suggestedCategory: 'rent', businessPurpose: 'Coworking desk rent', confidence: 0.88, notes: '' },
  },
  {
    file: 'lakeside-pharmacy.jpg', title: ['LAKESIDE PHARMACY'], meta: ['900 Shore Rd, Bend OR', `${us(d(5, 9))}  10:03 AM`, 'Rx #600-1188'],
    items: [['Prescription copay', 25.0], ['Allergy relief 30ct', 13.2]], tax: 0,
    footer: ['HSA CARD ****8810', 'Ask about flu shots'],
    truth: { documentType: 'receipt', merchant: 'Lakeside Pharmacy', date: d(5, 9), currency: 'USD', paymentMethod: 'HSA card ending 8810', formType: null, city: null, country: 'United States', usdTotal: null, suggestedCategory: 'medical', businessPurpose: '', confidence: 0.74, notes: 'Paid with an HSA card, so it may already be tax-free. Don’t claim it twice.' },
  },
  {
    file: 'riverbend-food-bank.jpg', title: ['RIVERBEND FOOD BANK', 'donation receipt'], meta: ['A 501(c)(3) nonprofit', `Received ${us(d(6, 3))}`, 'Donor: account holder'],
    items: [['Cash gift – general fund', 300.0]],
    footer: ['No goods or services were provided', 'in exchange for this gift.'],
    truth: { documentType: 'donation_letter', merchant: 'Riverbend Food Bank', date: d(6, 3), currency: 'USD', paymentMethod: null, formType: null, city: null, country: 'United States', usdTotal: null, suggestedCategory: 'charity', businessPurpose: '', confidence: 0.93, notes: 'Includes the no goods or services statement.' },
  },
  {
    file: 'summit-electronics.jpg', title: ['SUMMIT ELECTRONICS'], meta: ['Lloyd Center, Portland OR', `${us(d(6, 21))}  6:47 PM`, 'Order 55-90311'],
    items: [['Laptop 14" M-series 1TB', 2649.0], ['3-yr protection plan', 249.0]], tax: 0,
    footer: ['AMEX ****1006', 'Keep for warranty'],
    truth: { documentType: 'receipt', merchant: 'Summit Electronics', date: d(6, 21), currency: 'USD', paymentMethod: 'Amex ending 1006', formType: null, city: null, country: 'United States', usdTotal: null, suggestedCategory: 'equipment', businessPurpose: 'Work laptop', confidence: 0.8, notes: '' },
  },
]

// A content creator's work trip to Italy, plus two income statements.
const creator: Sample[] = [
  {
    file: 'loopstream-payout.jpg', title: ['LOOPSTREAM', 'partner payout statement'], meta: ['Creator: account holder', `Period Jan 1 – Jun 30, ${year}`, `Issued ${us(d(7, 2))}`],
    items: [['Ad revenue share', 7240.0], ['Channel memberships', 1985.0], ['Super chats', 635.0]],
    footer: ['Paid by direct deposit', 'No tax withheld'],
    truth: { documentType: 'statement', merchant: 'Loopstream Partner Program', date: d(7, 2), currency: 'USD', paymentMethod: 'Direct deposit', formType: 'Platform payout statement', city: null, country: 'United States', usdTotal: null, suggestedCategory: 'income_form', businessPurpose: '', confidence: 0.9, notes: 'Self-employment income. No tax withheld.' },
  },
  {
    file: 'verdant-invoice.jpg', title: ['INVOICE #0042', 'PAID'], meta: ['Bill to: Verdant Outdoor Co.', 'Sponsored video, 2 shorts', `Paid ${us(d(5, 20))}`],
    items: [['Sponsored integration', 5000.0], ['Short-form cutdowns x2', 1500.0]],
    footer: ['Paid via ACH', 'Thank you'],
    truth: { documentType: 'statement', merchant: 'Verdant Outdoor Co. (brand deal)', date: d(5, 20), currency: 'USD', paymentMethod: 'ACH', formType: 'Paid invoice', city: null, country: 'United States', usdTotal: null, suggestedCategory: 'income_form', businessPurpose: '', confidence: 0.85, notes: 'Brand deal income.' },
  },
  {
    file: 'atlas-air.jpg', title: ['ATLAS AIR LINES', 'e-ticket receipt'], meta: ['JFK → FCO  Jun 3', 'FCO → JFK  Jun 12', `Issued ${us(d(4, 18))}`],
    items: [['Economy fare, round trip', 1012.0], ['Taxes and carrier fees', 174.4]],
    footer: ['VISA ****4471', 'Bag allowance 1 x 23kg'],
    truth: { documentType: 'receipt', merchant: 'Atlas Air Lines', date: d(6, 3), currency: 'USD', paymentMethod: 'Visa ending 4471', formType: null, city: 'New York', country: 'United States', usdTotal: null, suggestedCategory: 'travel', businessPurpose: 'Flight for Italy shoot', confidence: 0.86, notes: 'Round trip New York to Rome, June 3 to June 12.' },
  },
  {
    file: 'hotel-aurelia.jpg', title: ['HOTEL AURELIA', 'Roma'], meta: ['Via Aurelia 112, 00165 Roma', `Check-in ${us(d(6, 4))}  Check-out ${us(d(6, 8))}`, '4 nights · Room 31'],
    items: [['Room 4 x 156.00', 624.0], ['City tax 4 x 6.00', 24.0], ['Breakfast', 36.0]], cur: '€', usd: 742.18,
    footer: ['VISA ****4471', 'Grazie!'],
    truth: { documentType: 'receipt', merchant: 'Hotel Aurelia', date: d(6, 8), currency: 'EUR', paymentMethod: 'Visa ending 4471', formType: null, city: 'Rome', country: 'Italy', usdTotal: 742.18, suggestedCategory: 'travel', businessPurpose: 'Lodging during Rome shoot', confidence: 0.84, notes: '' },
  },
  {
    file: 'ferrovie-lumina.jpg', title: ['FERROVIE LUMINA', 'biglietto'], meta: ['Roma Termini → Firenze SMN', `${us(d(6, 8))}  14:20`, 'Coach 6 · Seat 9A'],
    items: [['Standard fare', 58.9]], cur: '€',
    footer: ['Contactless ****4471', 'Buon viaggio'],
    truth: { documentType: 'receipt', merchant: 'Ferrovie Lumina', date: d(6, 8), currency: 'EUR', paymentMethod: 'Card ending 4471', formType: null, city: 'Rome', country: 'Italy', usdTotal: null, suggestedCategory: 'travel', businessPurpose: 'Train to Florence for the next shoot', confidence: 0.82, notes: '' },
  },
  {
    file: 'trattoria-lucia.jpg', title: ['TRATTORIA DA LUCIA', 'Firenze'], meta: ['Borgo San Jacopo 4', `${us(d(6, 9))}  20:15`, 'Coperti 3'],
    items: [['Ribollita x2', 22.0], ['Bistecca alla fiorentina', 58.0], ['Vino della casa', 16.5]], cur: '€', usd: 104.71,
    footer: ['VISA ****4471'],
    truth: { documentType: 'receipt', merchant: 'Trattoria da Lucia', date: d(6, 9), currency: 'EUR', paymentMethod: 'Visa ending 4471', formType: null, city: 'Florence', country: 'Italy', usdTotal: 104.71, suggestedCategory: 'meals', businessPurpose: '', confidence: 0.7, notes: 'Three diners.' },
  },
  {
    file: 'albergo-ponte.jpg', title: ['ALBERGO PONTE VECCHIO', 'Firenze'], meta: ['Lungarno 7, Firenze', `Check-in ${us(d(6, 8))}  Check-out ${us(d(6, 11))}`, '3 nights'],
    items: [['Room 3 x 158.00', 474.0], ['Tassa di soggiorno', 21.0]], cur: '€', usd: 537.1,
    footer: ['VISA ****4471'],
    truth: { documentType: 'receipt', merchant: 'Albergo Ponte Vecchio', date: d(6, 11), currency: 'EUR', paymentMethod: 'Visa ending 4471', formType: null, city: 'Florence', country: 'Italy', usdTotal: 537.1, suggestedCategory: 'travel', businessPurpose: 'Lodging during Florence shoot', confidence: 0.84, notes: '' },
  },
  {
    file: 'galleria-pass.jpg', title: ['GALLERIA DEGLI ARTI', 'biglietteria'], meta: ['Piazzale degli Uffizi', `${us(d(6, 10))}  10:05`, 'Adult x1'],
    items: [['Entry ticket', 29.0]], cur: '€', usd: 31.47,
    footer: ['Contactless ****4471'],
    truth: { documentType: 'receipt', merchant: 'Galleria degli Arti', date: d(6, 10), currency: 'EUR', paymentMethod: 'Card ending 4471', formType: null, city: 'Florence', country: 'Italy', usdTotal: 31.47, suggestedCategory: 'personal', businessPurpose: '', confidence: 0.6, notes: 'Museum ticket.' },
  },
]

function draw(s: Sample): HTMLCanvasElement {
  const W = 560
  const lineH = 30
  const rows = s.title.length + s.meta.length + s.items.length + s.footer.length + 7
  const H = 80 + rows * lineH
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = s.paper ?? '#fbfaf6'
  g.fillRect(0, 0, W, H)
  // Faint paper grain.
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.025})`
    g.fillRect(Math.random() * W, Math.random() * H, 1, 1)
  }
  g.fillStyle = '#26221d'
  g.textAlign = 'center'
  let y = 56
  s.title.forEach((t, i) => {
    g.font = i === 0 ? 'bold 30px "Courier New", monospace' : '20px "Courier New", monospace'
    g.fillText(t, W / 2, y)
    y += lineH + (i === 0 ? 6 : 0)
  })
  g.font = '18px "Courier New", monospace'
  s.meta.forEach((t) => {
    g.fillText(t, W / 2, y)
    y += lineH
  })
  const rule = () => {
    g.fillText('-'.repeat(40), W / 2, y)
    y += lineH
  }
  rule()
  g.textAlign = 'left'
  const money = (n: number) => (s.cur ?? '') + n.toFixed(2)
  const row = (a: string, b: string, bold = false) => {
    g.font = `${bold ? 'bold ' : ''}19px "Courier New", monospace`
    g.textAlign = 'left'
    g.fillText(a, 34, y)
    g.textAlign = 'right'
    g.fillText(b, W - 34, y)
    y += lineH
  }
  s.items.forEach(([a, b]) => row(a.length > 30 ? a.slice(0, 30) : a, money(b)))
  g.textAlign = 'center'
  rule()
  const sub = s.items.reduce((t, [, v]) => t + v, 0)
  row('SUBTOTAL', money(sub))
  if (s.tax !== undefined) row('TAX', money(s.tax))
  if (s.tip) row('TIP', money(s.tip))
  row('TOTAL', money(sub + (s.tax ?? 0) + (s.tip ?? 0)), true)
  if (s.usd) row('CHARGED IN USD', '$' + s.usd.toFixed(2))
  g.textAlign = 'center'
  g.font = '17px "Courier New", monospace'
  y += 8
  s.footer.forEach((t) => {
    g.fillText(t, W / 2, y)
    y += lineH
  })
  return c
}

export type SampleDoc = { fileName: string; blob: Blob; dataUrl: string; truth: Extraction }

export async function makeSamples(pack: 'everyday' | 'creator' = 'everyday'): Promise<SampleDoc[]> {
  return Promise.all(
    (pack === 'creator' ? creator : samples).map(async (s) => {
      const canvas = draw(s)
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9))
      const sub = s.items.reduce((t, [, v]) => t + v, 0)
      const total = Math.round((sub + (s.tax ?? 0) + (s.tip ?? 0)) * 100) / 100
      return {
        fileName: s.file,
        blob,
        dataUrl: canvas.toDataURL('image/jpeg', 0.9),
        truth: { ...s.truth, total, tax: s.tax ?? null, tip: s.tip ?? null, lineItems: s.items.map(([description, amount]) => ({ description, amount })) },
      }
    }),
  )
}
