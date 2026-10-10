// Vercel function: reads one document with Claude and returns structured
// fields. Nothing is stored here; the image is held in memory for the length
// of the request. Requires ANTHROPIC_API_KEY in the project's environment.

import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { CATEGORY_IDS, DOC_TYPES, extractionPrompt, normalizeExtraction } from '../src/lib/prompt.js'
import { stateByCode } from '../src/lib/tax/states.js'

const MAX_BYTES = 8 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

const ExtractionSchema = z.object({
  documentType: z.enum(DOC_TYPES),
  merchant: z.string(),
  date: z.string(),
  total: z.number(),
  tax: z.number().nullable(),
  tip: z.number().nullable(),
  currency: z.string(),
  paymentMethod: z.string().nullable(),
  lineItems: z.array(z.object({ description: z.string(), amount: z.number() })),
  formType: z.string().nullable(),
  suggestedCategory: z.enum(CATEGORY_IDS),
  businessPurpose: z.string(),
  confidence: z.number(),
  notes: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  usdTotal: z.number().nullable(),
})

// Best-effort per-instance rate limit. Put a shared limiter (e.g. Vercel KV or
// the WAF) in front of this before launch; instances don't share this map.
const hits = new Map<string, number[]>()
function limited(ip: string) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > 20
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export function GET() {
  return json(200, { ok: true, configured: !!process.env.ANTHROPIC_API_KEY })
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'not_configured', message: 'AI reading is not set up on this server.' })
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (limited(ip)) return json(429, { error: 'rate_limited', message: 'Too many documents at once. Wait a minute and try again.' })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES + 64_000) return json(413, { error: 'too_large', message: 'That file is over 8 MB.' })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json(400, { error: 'bad_request', message: 'Send the document as multipart form data.' })
  }
  const file = form.get('file')
  if (!(file instanceof Blob) || !IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number])) {
    return json(415, { error: 'unsupported_type', message: 'Upload a JPEG, PNG, WebP or GIF image.' })
  }
  if (file.size > MAX_BYTES) return json(413, { error: 'too_large', message: 'That file is over 8 MB.' })

  let profile: { state: string; workType: 'w2' | 'self_employed' | 'both'; businessName: string; taxYear: number }
  try {
    const p = JSON.parse(String(form.get('profile') ?? '{}'))
    profile = {
      state: stateByCode[p.state] ? p.state : 'CA',
      workType: ['w2', 'self_employed', 'both'].includes(p.workType) ? p.workType : 'self_employed',
      businessName: String(p.businessName ?? '').slice(0, 80),
      taxYear: Number.isInteger(p.taxYear) ? p.taxYear : new Date().getFullYear(),
    }
  } catch {
    return json(400, { error: 'bad_request', message: 'Profile was not valid JSON.' })
  }

  const data = Buffer.from(await file.arrayBuffer()).toString('base64')
  const client = new Anthropic()
  try {
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      // Refused requests re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(ExtractionSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: file.type as (typeof IMAGE_TYPES)[number], data } },
            { type: 'text', text: extractionPrompt(profile, false) },
          ],
        },
      ],
    })
    if (response.stop_reason === 'refusal') return json(422, { error: 'refused', message: 'This document couldn’t be read. Enter the details by hand.' })
    if (!response.parsed_output) return json(502, { error: 'invalid_output', message: 'The answer came back incomplete. Try again.' })
    return json(200, { extraction: normalizeExtraction(response.parsed_output) })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: 'rate_limited', message: 'The AI service is busy. Try again in a minute.' })
    if (err instanceof Anthropic.AuthenticationError) return json(503, { error: 'not_configured', message: 'AI reading is misconfigured on this server.' })
    if (err instanceof Anthropic.BadRequestError) return json(400, { error: 'bad_request', message: 'This document couldn’t be processed. Try a clearer photo.' })
    if (err instanceof Anthropic.APIError) return json(502, { error: 'upstream_error', message: 'The AI service had a problem. Try again.' })
    return json(500, { error: 'server_error', message: 'Something went wrong reading this document.' })
  }
}
