// Exchange rates for foreign-currency receipts. Shoebox is for US taxpayers,
// so every state's "home currency" is the US dollar and every rate here is
// into USD.
//
// The IRS wants amounts in dollars at the rate prevailing when you paid, and
// accepts any posted rate used consistently. We use the European Central
// Bank's daily reference rate for the receipt's date (the last published
// rate on or before it, for weekends and holidays), via the Frankfurter API.
// Only the currency code and date are sent, never the amount or merchant.
// A dollar figure from the card statement, or printed on the receipt, always
// wins over this.

export type Fx = { rate: number; date: string; source: string } // rate: USD per one unit

const API = 'https://api.frankfurter.dev/v1'
export const FX_SOURCE = 'European Central Bank reference rate'
const cache = new Map<string, Promise<Fx | null>>()

const today = () => new Date().toISOString().slice(0, 10)

export function usdRate(currency: string, date: string): Promise<Fx | null> {
  const cur = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(cur) || cur === 'USD') return Promise.resolve(null)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today() ? date : 'latest'
  const key = `${cur}:${day}`
  let p = cache.get(key)
  if (!p) {
    p = fetch(`${API}/${day}?base=${cur}&symbols=USD`, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout?.(10_000) })
      .then(async (res) => {
        if (!res.ok) return null // currency the ECB doesn't publish
        const j = (await res.json()) as { date?: string; rates?: { USD?: number } }
        const rate = j.rates?.USD
        return typeof rate === 'number' && rate > 0 ? { rate, date: j.date ?? day, source: FX_SOURCE } : null
      })
      .catch(() => {
        cache.delete(key) // offline: try again next time
        return null
      })
    cache.set(key, p)
  }
  return p
}

const r2 = (n: number) => Math.round(n * 100) / 100

// The dollar figure a receipt counts at, and where it came from.
export function usdFigure(ex: { currency: string; total: number; usdTotal: number | null }, usdAmount?: number | null, fx?: Fx | null): { usd: number | null; from: 'native' | 'you' | 'receipt' | 'fx' | null } {
  if (!ex.currency || ex.currency === 'USD') return { usd: ex.total, from: 'native' }
  if (usdAmount != null) return { usd: usdAmount, from: 'you' }
  if (ex.usdTotal != null) return { usd: ex.usdTotal, from: 'receipt' }
  if (fx) return { usd: r2(ex.total * fx.rate), from: 'fx' }
  return { usd: null, from: null }
}
