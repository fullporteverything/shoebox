// Writes public/bandit/<pose>.svg from the Bandit component, so the standalone
// files never drift from what the app draws. Run: npx tsx scripts/bandit-export.tsx
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Bandit, banditPoses } from '../src/components/Bandit.js'

const labels: Record<string, string> = {
  receipt: 'Bandit the raccoon holding a receipt',
  wave: 'Bandit the raccoon waving hello',
  thinking: 'Bandit the raccoon thinking',
  celebrate: 'Bandit the raccoon celebrating in a gold shoebox',
  sleep: 'Bandit the raccoon napping with a receipt',
  oops: 'Bandit the raccoon looking sheepish',
  head: 'Bandit the raccoon',
}

mkdirSync('public/bandit', { recursive: true })
for (const pose of banditPoses) {
  const svg = renderToStaticMarkup(<Bandit pose={pose} size={512} label={labels[pose]} still />)
    .replace(/ class="[^"]*"/, '')
    .replace(/(<svg[^>]*>)/, `$1<title>${labels[pose]}</title>`)
  writeFileSync(`public/bandit/${pose}.svg`, `${svg}\n`)
}
console.log(`wrote ${banditPoses.length} files to public/bandit/`)
// The PNGs (receipt-1024.png, receipt-1024-dark.png) are rendered from these with a headless browser.
