// Vercel function: the "Ask Shoebox" assistant. Receives a summary of the
// person's records (built client-side) and their question. Nothing is stored.

import Anthropic from '@anthropic-ai/sdk'
import { ASSISTANT_RULES } from '../src/lib/prompt.js'

const hits = new Map<string, number[]>()
function limited(ip: string) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > 12
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'not_configured', message: 'The assistant is not set up on this server.' })
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (limited(ip)) return json(429, { error: 'rate_limited', message: 'Too many questions at once. Wait a minute.' })
  let body: { context?: unknown; turns?: unknown }
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'bad_request', message: 'Send JSON.' })
  }
  const context = typeof body.context === 'string' ? body.context.slice(0, 12_000) : ''
  const turns = Array.isArray(body.turns) ? body.turns.slice(-10) : []
  const messages: Anthropic.Beta.BetaMessageParam[] = []
  for (const t of turns) {
    const role = (t as { role?: unknown })?.role
    const content = (t as { content?: unknown })?.content
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) messages.push({ role, content: content.slice(0, 4_000) })
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json(400, { error: 'bad_request', message: 'The last message must be a question.' })
  if (messages[0].role !== 'user') messages.shift()

  const client = new Anthropic()
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: `${ASSISTANT_RULES}\n\nTheir data:\n${context}`,
      messages,
    })
    console.log(JSON.stringify({ event: 'assistant_answer', model: response.model, input: response.usage.input_tokens, output: response.usage.output_tokens }))
    if (response.stop_reason === 'refusal') return json(422, { error: 'refused', message: 'The assistant can’t help with that one. Try asking another way.' })
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
    if (!text) return json(502, { error: 'empty', message: 'No answer came back. Try again.' })
    return json(200, { text })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: 'rate_limited', message: 'The AI service is busy. Try again in a minute.' })
    if (err instanceof Anthropic.APIError) return json(502, { error: 'upstream_error', message: 'The AI service had a problem. Try again.' })
    return json(500, { error: 'server_error', message: 'Something went wrong.' })
  }
}
