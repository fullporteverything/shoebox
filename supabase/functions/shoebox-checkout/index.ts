// Starts a Stripe Checkout for the Tax Year Pass. The browser sends its
// Shoebox session token; the price comes from the database (founding or
// standard), never from the browser.
//
// Secrets (Supabase -> Edge Functions -> Secrets): SHOEBOX_STRIPE_SECRET_KEY.
// Named for Shoebox because other apps share this project and may have their own STRIPE_SECRET_KEY.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } })

async function db(fn: string, args: Record<string, unknown>) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text.includes('session_ended') ? 'session_ended' : `db ${res.status}`)
  return text ? JSON.parse(text) : null
}

// Where Stripe sends people back: the page they came from, if it's https (or local dev).
function returnBase(origin: string | null) {
  if (!origin) return null
  try {
    const u = new URL(origin)
    if (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.origin
  } catch { /* fall through */ }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method' })
  const stripeKey = Deno.env.get('SHOEBOX_STRIPE_SECRET_KEY')
  if (!stripeKey) return json(503, { error: 'not_configured', message: 'Payments aren’t switched on yet.' })

  let body: { token?: string; taxYear?: number }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const year = Number(body.taxYear)
  const thisYear = new Date().getUTCFullYear()
  if (!body.token || !Number.isInteger(year) || year < thisYear - 2 || year > thisYear) return json(400, { error: 'bad_request' })
  const base = returnBase(req.headers.get('origin'))
  if (!base) return json(400, { error: 'bad_origin' })

  let info: { user_id: string; email: string; owned: boolean; amount: number; founding: boolean }
  try {
    info = await db('shoebox_srv_checkout_info', { p_token: body.token, p_year: year })
  } catch (e) {
    return e instanceof Error && e.message === 'session_ended' ? json(401, { error: 'session_ended' }) : json(502, { error: 'server' })
  }
  if (!info) return json(401, { error: 'session_ended' })
  if (info.owned) return json(409, { error: 'owned', message: `You already have the ${year} pass.` })

  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(info.amount),
    'line_items[0][price_data][product_data][name]': `Shoebox Tax Year Pass · ${year}`,
    'line_items[0][price_data][product_data][description]': `Filing pack, quarterly planner and step-by-step savings plans for tax year ${year}. One-time payment, no auto-renewal.${info.founding ? ' Founding member price.' : ''}`,
    customer_email: info.email,
    client_reference_id: info.user_id,
    'metadata[user_id]': info.user_id,
    'metadata[tax_year]': String(year),
    'metadata[founding]': String(info.founding),
    'payment_intent_data[metadata][user_id]': info.user_id,
    'payment_intent_data[metadata][tax_year]': String(year),
    success_url: `${base}/#/app/pass?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/#/app/pass?cancelled=1`,
  })
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${stripeKey}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': crypto.randomUUID() },
    body: form,
  })
  const session = await res.json()
  if (!res.ok || !session.url) {
    console.error('stripe checkout failed', res.status, session?.error?.message)
    return json(502, { error: 'stripe', message: 'Stripe couldn’t start the checkout. Try again in a minute.' })
  }
  return json(200, { url: session.url })
})
