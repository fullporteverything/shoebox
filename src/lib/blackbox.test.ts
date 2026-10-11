import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, unzipList, zip } from './zip.js'
import { PART_BYTES, newBoxKey, openBox, seal, toParts } from './blackbox.js'

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
})

test('zip round trip', () => {
  const z = zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }])
  const files = unzipList(z)
  assert.deepEqual(files.map((f) => f.name), ['a.txt', 'dir/b.bin'])
  assert.equal(new TextDecoder().decode(files[0].data), 'hello')
})

test('seal, split into parts, reassemble out of order, open', async () => {
  const big = new Uint8Array(PART_BYTES * 2 + 1234).map((_, i) => i % 251)
  const key = await newBoxKey('correct horse battery staple')
  const box = await seal(big, key, 'test')
  const parts = toParts(box)
  assert.equal(parts.length, 3)
  const { archive } = await openBox([parts[2].bytes, parts[0].bytes, parts[1].bytes], 'correct horse battery staple')
  assert.deepEqual(archive, big)
  await assert.rejects(openBox(parts.map((p) => p.bytes), 'wrong passphrase'), /passphrase/)
  await assert.rejects(openBox([parts[0].bytes, parts[1].bytes], 'correct horse battery staple'), /Missing part 3/)
})
