// Sample documents drawn on a canvas, so people can try the app without
// uploading their own records. Each one carries the right answer, used when
// no AI is available. All merchants are made up.

import type { Extraction } from './types.js'

type Sample = {
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
    truth: { documentType: 'receipt', merchant: 'Cafe Verde', date: d(3, 14), currency: 'USD', paymentMethod: 'Visa ending 4471', formType: null, suggestedCategory: 'meals', businessPurpose: 'Lunch meeting with a client', confidence: 0.82, notes: 'Two guests. Add who attended.' },
  },
  {
    file: 'northline-fuel.jpg', title: ['NORTHLINE FUEL', 'STATION #2207'], meta: ['I-84 Exit 17, Troutdale OR', `${us(d(3, 18))}  07:55`, 'PUMP 06'],
    items: [['Regular unl 13.402 gal @ 3.899', 52.25]], tax: 0,
    footer: ['MASTERCARD ****0932', 'AUTH 448120'],
    truth: { documentType: 'receipt', merchant: 'Northline Fuel', date: d(3, 18), currency: 'USD', paymentMethod: 'Mastercard ending 0932', formType: null, suggestedCategory: 'car', businessPurpose: 'Fuel for a client site visit', confidence: 0.78, notes: 'Only the business-use share of vehicle costs counts.' },
  },
  {
    file: 'paper-and-pine.jpg', title: ['PAPER & PINE', 'office supply co.'], meta: ['22 Market Sq, Salem OR', `${us(d(4, 2))}  3:12 PM`, 'Reg 3  Cashier Dev'],
    items: [['Copy paper 8.5x11 case', 42.99], ['Gel pens 12pk', 11.49], ['Black ink cartridge', 34.99], ['Shipping labels', 13.49]], tax: 0,
    footer: ['DEBIT ****2280', 'Returns within 30 days'],
    truth: { documentType: 'receipt', merchant: 'Paper & Pine Office Supply', date: d(4, 2), currency: 'USD', paymentMethod: 'Debit ending 2280', formType: null, suggestedCategory: 'supplies', businessPurpose: 'Office supplies', confidence: 0.9, notes: '' },
  },
  {
    file: 'cloudnest.jpg', title: ['CLOUDNEST', 'INVOICE CN-58213'], meta: ['Billed to: Account 77-1042', `Invoice date ${us(d(4, 30))}`, 'Period: May 1 – May 31'],
    items: [['Pro hosting plan', 24.0], ['Custom domain renewal', 18.0], ['Daily backups', 6.0]], tax: 0,
    footer: ['Paid by card ****4471', 'Questions? billing@cloudnest.example'],
    truth: { documentType: 'invoice', merchant: 'Cloudnest', date: d(4, 30), currency: 'USD', paymentMethod: 'Card ending 4471', formType: null, suggestedCategory: 'software', businessPurpose: 'Website hosting for the business', confidence: 0.92, notes: '' },
  },
  {
    file: 'harbor-cowork.jpg', title: ['HARBOR COWORK', 'membership receipt'], meta: ['1 Pier Way, Astoria OR', `${us(d(5, 1))}`, 'Member #3391'],
    items: [['Dedicated desk – May', 325.0], ['Locker', 25.0]], tax: 0,
    footer: ['ACH transfer', 'See you at the harbor'],
    truth: { documentType: 'receipt', merchant: 'Harbor Cowork', date: d(5, 1), currency: 'USD', paymentMethod: 'ACH transfer', formType: null, suggestedCategory: 'rent', businessPurpose: 'Coworking desk rent', confidence: 0.88, notes: '' },
  },
  {
    file: 'lakeside-pharmacy.jpg', title: ['LAKESIDE PHARMACY'], meta: ['900 Shore Rd, Bend OR', `${us(d(5, 9))}  10:03 AM`, 'Rx #600-1188'],
    items: [['Prescription copay', 25.0], ['Allergy relief 30ct', 13.2]], tax: 0,
    footer: ['HSA CARD ****8810', 'Ask about flu shots'],
    truth: { documentType: 'receipt', merchant: 'Lakeside Pharmacy', date: d(5, 9), currency: 'USD', paymentMethod: 'HSA card ending 8810', formType: null, suggestedCategory: 'medical', businessPurpose: '', confidence: 0.74, notes: 'Paid with an HSA card, so it may already be tax-free. Don’t claim it twice.' },
  },
  {
    file: 'riverbend-food-bank.jpg', title: ['RIVERBEND FOOD BANK', 'donation receipt'], meta: ['A 501(c)(3) nonprofit', `Received ${us(d(6, 3))}`, 'Donor: account holder'],
    items: [['Cash gift – general fund', 300.0]],
    footer: ['No goods or services were provided', 'in exchange for this gift.'],
    truth: { documentType: 'donation_letter', merchant: 'Riverbend Food Bank', date: d(6, 3), currency: 'USD', paymentMethod: null, formType: null, suggestedCategory: 'charity', businessPurpose: '', confidence: 0.93, notes: 'Includes the no goods or services statement.' },
  },
  {
    file: 'summit-electronics.jpg', title: ['SUMMIT ELECTRONICS'], meta: ['Lloyd Center, Portland OR', `${us(d(6, 21))}  6:47 PM`, 'Order 55-90311'],
    items: [['Laptop 14" M-series 1TB', 2649.0], ['3-yr protection plan', 249.0]], tax: 0,
    footer: ['AMEX ****1006', 'Keep for warranty'],
    truth: { documentType: 'receipt', merchant: 'Summit Electronics', date: d(6, 21), currency: 'USD', paymentMethod: 'Amex ending 1006', formType: null, suggestedCategory: 'equipment', businessPurpose: 'Work laptop', confidence: 0.8, notes: '' },
  },
]

function draw(s: Sample): HTMLCanvasElement {
  const W = 560
  const lineH = 30
  const rows = s.title.length + s.meta.length + s.items.length + s.footer.length + 6
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
  const money = (n: number) => n.toFixed(2)
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

export async function makeSamples(): Promise<SampleDoc[]> {
  return Promise.all(
    samples.map(async (s) => {
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
