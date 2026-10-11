// The Black Box: a sealed copy of everything a person stored, built so it can
// leave the device in one direction only, to them.
//
// Sealing: AES-256-GCM under a key derived (PBKDF2, 600k) from a Black Box
// passphrase only the person knows. The app keeps that derived key inside the
// vault (sealed with the data key) so it can refresh the box while unlocked,
// and keeps the latest sealed box outside the vault so it can still be sent if
// the vault shreds before anyone unlocks it (for example after password
// guessing). Whoever intercepts the email, or redirects it, gets ciphertext.
//
// File format (.shoebox), one file per part:
//   "SHOEBOX-BLACKBOX/1\n" + JSON header + "\n" + raw ciphertext slice

import { PBKDF2_ITERATIONS, b64, randomBytes, sha256, unb64 } from './crypto.js'
import { zip } from './zip.js'
import type { ZipEntry } from './zip.js'
import { categoryById } from './tax/rules.js'
import type { IncomeEntry, Profile, Receipt, TripLog } from './types.js'

const MAGIC = 'SHOEBOX-BLACKBOX/1'
// Vercel functions accept ~4.5 MB bodies; base64 adds a third. Parts stay under it.
export const PART_BYTES = 2_900_000
const enc = new TextEncoder()

export type BoxHeader = { v: 1; salt: string; iv: string; iterations: number; part: number; parts: number; total: number; digest: string; createdAt: number; reason: string }
export type SealedBox = { header: Omit<BoxHeader, 'part' | 'parts'>; ciphertext: Uint8Array }

export async function deriveBoxKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, 256))
}

export async function newBoxKey(passphrase: string) {
  const salt = randomBytes(16)
  const raw = await deriveBoxKey(passphrase, salt)
  return { salt: b64(salt), raw: b64(raw), iterations: PBKDF2_ITERATIONS }
}

export type BoxKey = Awaited<ReturnType<typeof newBoxKey>>

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'document'

function dataUrlBytes(url: string): Uint8Array | null {
  const i = url.indexOf(',')
  if (i < 0) return null
  try {
    return unb64(url.slice(i + 1))
  } catch {
    return null
  }
}

export function buildArchive(input: { profile: Profile | null; receipts: Receipt[]; incomes: IncomeEntry[]; tripLogs: Record<string, TripLog>; log: unknown[]; reason: string }): Uint8Array {
  const now = new Date()
  const { profile, receipts, incomes, tripLogs, log } = input
  const files: ZipEntry[] = []
  files.push({
    name: 'README.txt',
    data: `Shoebox Black Box\nCreated ${now.toISOString()}\nReason: ${input.reason}\n\nThis archive holds everything that was stored in your Shoebox vault:\n- receipts.csv and income.csv: open in any spreadsheet app\n- data/*.json: the full records, including extracted fields and categories\n- documents/: every uploaded image\n- trips/: trip day logs and evidence thumbnails\n\nNo copy of this archive was kept by Shoebox.\n`,
  })
  files.push({ name: 'data/profile.json', data: JSON.stringify(profile, null, 2) })
  files.push({ name: 'data/receipts.json', data: JSON.stringify(receipts.map((r) => ({ ...r, image: r.image ? `documents/${r.id}.jpg` : null })), null, 2) })
  files.push({ name: 'data/income.json', data: JSON.stringify(incomes, null, 2) })
  files.push({ name: 'data/trips.json', data: JSON.stringify(Object.values(tripLogs).map((t) => ({ ...t, evidence: t.evidence.map((e) => ({ ...e, thumb: `trips/${e.id}.jpg` })) })), null, 2) })
  files.push({ name: 'data/security-log.json', data: JSON.stringify(log, null, 2) })
  files.push({
    name: 'receipts.csv',
    data: csv([
      ['date', 'merchant', 'category', 'form', 'total', 'currency', 'usd_amount', 'deductible', 'business_pct', 'status', 'business_purpose', 'file'],
      ...receipts.map((r) => [r.extraction.date, r.extraction.merchant, categoryById[r.classification.category]?.label, categoryById[r.classification.category]?.form, r.extraction.total, r.extraction.currency, r.usdAmount ?? r.extraction.usdTotal ?? '', r.classification.deductible, r.businessPct, r.status, r.extraction.businessPurpose, r.image ? `documents/${r.extraction.date || 'undated'}-${slug(r.extraction.merchant)}-${r.id}.jpg` : '']),
    ]),
  })
  files.push({ name: 'income.csv', data: csv([['date', 'source', 'type', 'amount', 'federal_withheld'], ...incomes.map((i) => [i.date, i.source, i.type, i.amount, i.withheld])]) })
  for (const r of receipts) {
    const bytes = r.image ? dataUrlBytes(r.image) : null
    if (bytes) files.push({ name: `documents/${r.extraction.date || 'undated'}-${slug(r.extraction.merchant)}-${r.id}.jpg`, data: bytes })
  }
  for (const t of Object.values(tripLogs)) for (const e of t.evidence) {
    const bytes = dataUrlBytes(e.thumb)
    if (bytes) files.push({ name: `trips/${e.id}.jpg`, data: bytes })
  }
  return zip(files)
}

export async function seal(archive: Uint8Array, key: BoxKey, reason: string): Promise<SealedBox> {
  const iv = randomBytes(12)
  const k = await crypto.subtle.importKey('raw', unb64(key.raw) as BufferSource, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(MAGIC) as BufferSource }, k, archive as BufferSource))
  return { header: { v: 1, salt: key.salt, iv: b64(iv), iterations: key.iterations, total: ct.length, digest: await sha256(b64(ct)), createdAt: Date.now(), reason }, ciphertext: ct }
}

// Splits a sealed box into .shoebox part files.
export function toParts(box: SealedBox): { name: string; bytes: Uint8Array }[] {
  const parts = Math.max(1, Math.ceil(box.ciphertext.length / PART_BYTES))
  const stamp = new Date(box.header.createdAt).toISOString().slice(0, 10)
  return Array.from({ length: parts }, (_, i) => {
    const header: BoxHeader = { ...box.header, part: i + 1, parts }
    const head = enc.encode(`${MAGIC}\n${JSON.stringify(header)}\n`)
    const slice = box.ciphertext.subarray(i * PART_BYTES, (i + 1) * PART_BYTES)
    const bytes = new Uint8Array(head.length + slice.length)
    bytes.set(head)
    bytes.set(slice, head.length)
    return { name: `shoebox-blackbox-${stamp}${parts > 1 ? `-part${i + 1}of${parts}` : ''}.shoebox`, bytes }
  })
}

export function readPart(bytes: Uint8Array): { header: BoxHeader; slice: Uint8Array } {
  const dec = new TextDecoder()
  const first = bytes.indexOf(10)
  const second = bytes.indexOf(10, first + 1)
  if (first < 0 || second < 0 || dec.decode(bytes.subarray(0, first)) !== MAGIC) throw new Error('This isn’t a Shoebox Black Box file.')
  const header = JSON.parse(dec.decode(bytes.subarray(first + 1, second))) as BoxHeader
  return { header, slice: bytes.subarray(second + 1) }
}

// Reassembles parts (any order) and decrypts with the passphrase.
export async function openBox(partFiles: Uint8Array[], passphrase: string): Promise<{ archive: Uint8Array; header: BoxHeader }> {
  const parts = partFiles.map(readPart)
  const h = parts[0].header
  if (parts.some((p) => p.header.digest !== h.digest)) throw new Error('These files come from different Black Boxes.')
  const have = new Set(parts.map((p) => p.header.part))
  const missing = Array.from({ length: h.parts }, (_, i) => i + 1).filter((n) => !have.has(n))
  if (missing.length) throw new Error(`Missing part ${missing.join(', ')} of ${h.parts}. Add every part from the emails.`)
  const ct = new Uint8Array(h.total)
  for (const p of parts) ct.set(p.slice, (p.header.part - 1) * PART_BYTES)
  if ((await sha256(b64(ct))) !== h.digest) throw new Error('A part is damaged or incomplete.')
  const raw = await deriveBoxKey(passphrase, unb64(h.salt), h.iterations)
  const k = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['decrypt'])
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(h.iv) as BufferSource, additionalData: enc.encode(MAGIC) as BufferSource }, k, ct as BufferSource)
    return { archive: new Uint8Array(pt), header: h }
  } catch {
    throw new Error('That passphrase doesn’t open this Black Box.')
  }
}
