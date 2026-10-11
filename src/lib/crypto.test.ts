import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveKek, deriveSecrets, open, randomBytes, seal } from './crypto.js'

test('deriveSecrets gives the same KEK as deriveKek, so existing vaults still open', async () => {
  const salt = randomBytes(16)
  const old = await deriveKek('pw for test', salt, 1000)
  const wrapped = await seal(old, new Uint8Array([1, 2, 3]), 'kek/u')
  const { kek, auth } = await deriveSecrets('pw for test', salt, 1000)
  assert.deepEqual([...(await open(kek, wrapped, 'kek/u'))], [1, 2, 3])
  assert.equal(auth.length, 44)
})

test('the sign-in proof depends on the password and salt', async () => {
  const salt = randomBytes(16)
  const a = await deriveSecrets('one', salt, 1000)
  const b = await deriveSecrets('two', salt, 1000)
  const c = await deriveSecrets('one', randomBytes(16), 1000)
  assert.notEqual(a.auth, b.auth)
  assert.notEqual(a.auth, c.auth)
  assert.equal(a.auth, (await deriveSecrets('one', salt, 1000)).auth)
})
