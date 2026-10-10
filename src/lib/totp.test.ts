import { test } from 'node:test'
import assert from 'node:assert/strict'
import { base32Decode, base32Encode, hotp, verifyTotp, stepAt } from './totp.js'

const rfcSecret = new TextEncoder().encode('12345678901234567890')

test('RFC 6238 SHA-1 test vectors (8 digits)', async () => {
  // Appendix B: T = 59, 1111111109, 1111111111, 1234567890, 2000000000
  const cases: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']]
  for (const [t, want] of cases) assert.equal(await hotp(rfcSecret, Math.floor(t / 30), 8), want)
})

test('RFC 4226 HOTP test vectors (6 digits)', async () => {
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
  for (let i = 0; i < want.length; i++) assert.equal(await hotp(rfcSecret, i), want[i])
})

test('base32 round trip', () => {
  assert.equal(base32Encode(rfcSecret), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  assert.deepEqual(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), rfcSecret)
})

test('verify accepts drift of one step and refuses replays', async () => {
  const b32 = base32Encode(rfcSecret)
  const now = 1_700_000_000_000
  const code = await hotp(rfcSecret, stepAt(now) - 1)
  const step = await verifyTotp(b32, code, 0, now)
  assert.equal(step, stepAt(now) - 1)
  assert.equal(await verifyTotp(b32, code, step!, now), null)
  assert.equal(await verifyTotp(b32, 'abc123', 0, now), null)
})
