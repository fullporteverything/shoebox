import { Bandit } from './Bandit.js'
import React from 'react'

// Stroke icons drawn for this app, 24px grid.
const paths = {
  overview: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  inbox: 'M4 13l2.5-7.5A2 2 0 0 1 8.4 4h7.2a2 2 0 0 1 1.9 1.5L20 13M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M4 13h4.5l1.5 2.5h4l1.5-2.5H20',
  receipts: 'M6 3h12v18l-2.5-1.5L13 21l-2-1.5L9 21l-2.5-1.5L6 21zM9 8h6M9 12h6M9 16h3',
  map: 'M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  lock: 'M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  unlock: 'M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2',
  key: 'M14.5 9.5a4 4 0 1 1-1.2-2.8L21 14v3h-3v2h-2l-2.7-2.7',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.4 7.4C3.9 9.1 2.5 12 2.5 12S6 18 12 18c1.3 0 2.5-.3 3.6-.7M9.9 9.9a3 3 0 0 0 4.2 4.2',
  fire: 'M12 21c3.9 0 6.5-2.6 6.5-6.2 0-3.4-2.3-5.6-4-8.3-.7 2-1.6 3.1-3 3.6.4-2.7-.6-5.2-2.9-7.1C8.3 7.2 5.5 9.5 5.5 14.8 5.5 18.4 8.1 21 12 21z',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  fingerprint: 'M12 11v3.5c0 2-.6 3.8-1.6 5.3M8.5 9.5A3.5 3.5 0 0 1 15.5 11v2.5M5.5 9a7 7 0 0 1 13 3.5V14M5 13v1.5c0 1.5-.3 2.8-.9 4M15.5 17c-.2 1.4-.6 2.7-1.2 3.8M8 14.5c0 1.6-.3 3-.9 4.2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  tabs: 'M3 8h18v12H3zM3 8l2-4h6l2 4',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  chevron: 'M6 9l6 6 6-6',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  scale: 'M12 4v16M5 20h14M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0zM6 8h12M12 4l-6 4M12 4l6 4',
  pin: 'M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.3-1.4M17.7 6.3l1.4-1.4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  grid: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
  laptop: 'M5 5.5h14v10H5zM2.5 18.5h19',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={paths[name]} />
    </svg>
  )
}

// The brand mark is Bandit's head. His eyes follow the pointer and he hops on hover.
export function Logo({ size = 32 }: { size?: number }) {
  return <Bandit pose="head" size={size} watch hop className="brand-mark" />
}
