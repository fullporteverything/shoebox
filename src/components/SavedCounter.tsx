import React, { useEffect, useState } from 'react'
import { cloud, cloudEnabled } from '../lib/cloud.js'
import { Icon } from './icons.js'
import { CountUp, money } from './ui.js'

// Shown only once the real total is big enough to mean something.
const SHOW_FROM = 1000

export function SavedCounter() {
  const [data, setData] = useState<{ total: number; people: number } | null>(null)
  useEffect(() => {
    if (!cloudEnabled) return
    cloud.savingsTotal().then(setData).catch(() => undefined)
  }, [])
  if (!data || data.total < SHOW_FROM) return null
  return (
    <div className="saved-counter rise" style={{ animationDelay: '0.75s' }}>
      <Icon name="sparkle" size={15} />
      <span>
        <b><CountUp value={data.total} format={(n) => money(n, false)} /></b> in estimated tax cut by Shoebox users
        {data.people >= 5 ? <span className="faint"> · {data.people.toLocaleString()} people</span> : null}
      </span>
    </div>
  )
}
