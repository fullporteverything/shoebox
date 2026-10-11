// Stripe webhook: records a Tax Year Pass when a checkout is paid, and marks
// it refunded when the charge is refunded. Every request is checked against
// Stripe's signature before anything is read.
//
// Secrets: SHOEBOX_STRIPE_WEBHOOK_SECRET (whsec_...). Events to send:
// checkout.session.completed, checkout.session.async_payment_succeeded,
// charge.refunded.

const enc = new TextEncoder()

async function verify(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]).filter((p) => p.length === 2))
  const t = Number(parts.t)
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false // older than 5 minutes: possible replay
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)))
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  const given = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  // Constant-time compare against each v1 signature.
  return given.some((g) => g.length === expected.length && [...g].reduce((d, c, i) => d | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0)
}

async function db(fn: string, args: Record<string, unknown>) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 })
  const secret = Deno.env.get('SHOEBOX_STRIPE_WEBHOOK_SECRET')
  if (!secret) return new Response('not configured', { status: 503 })
  const payload = await req.text()
  if (!(await verify(payload, req.headers.get('stripe-signature'), secret))) return new Response('bad signature', { status: 400 })

  const event = JSON.parse(payload)
  const obj = event.data?.object ?? {}
  try {
    if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && obj.payment_status === 'paid') {
      const year = Number(obj.metadata?.tax_year)
      const user = obj.metadata?.user_id ?? obj.client_reference_id
      if (user && Number.isInteger(year)) {
        await db('shoebox_srv_record_pass', {
          p_user: user, p_year: year, p_amount: obj.amount_total, p_currency: obj.currency, p_founding: obj.metadata?.founding === 'true',
          p_session: obj.id, p_intent: typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id ?? null,
        })
      }
    } else if (event.type === 'charge.refunded' && obj.refunded && obj.payment_intent) {
      await db('shoebox_srv_refund_pass', { p_intent: typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent.id })
    }
  } catch (e) {
    console.error(String(e))
    return new Response('retry', { status: 500 }) // Stripe retries
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'content-type': 'application/json' } })
})
