import React, { useEffect, useRef } from 'react'
import { motionReduced } from '../lib/motion.js'

// Bandit, the Shoebox raccoon. He keeps every receipt.
//
// One 256-unit drawing shared by every pose: the same head, body, tail and paws,
// with only the arms, expression and props changing. Colours are fixed (like the
// logo) so he looks the same on both themes. Outlines are 6 units everywhere;
// face markings have no outline.

export type BanditPose = 'receipt' | 'wave' | 'thinking' | 'celebrate' | 'sleep' | 'oops' | 'head'
export const banditPoses: BanditPose[] = ['receipt', 'wave', 'thinking', 'celebrate', 'sleep', 'oops', 'head']

const O = '#0c2219' // outline, the light theme's ink
const FUR = '#aab5be'
const FUR_D = '#7d8a94'
const MASK = '#2b353c'
const CREAM = '#f6f1e5'
const EAR = '#e8d3c9'
const PAPER = '#fffdf7'
const GOLD = '#f3b63f'
const GOLD_2 = '#ffd781'
const SEA = '#4fd1b5'
const BLUSH = '#f39f98'
const SW = 6

type Face = 'open' | 'happy' | 'closed' | 'up' | 'worried'

const line = { fill: 'none', stroke: O, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function Ear({ sw = SW }: { sw?: number }) {
  return (
    <>
      <path d="M62 86C52 62 52 40 60 26c4-6 10-6 16-3 14 7 26 18 34 33z" fill={FUR} stroke={O} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M71 70c-4-12-5-24-1-31 2-3 5-3 8-2 8 4 14 10 19 18z" fill={EAR} />
    </>
  )
}

function Eye({ x, face, small }: { x: number; face: Face; small?: boolean }) {
  const y = 100
  if (face === 'happy') return <path d={`M${x - 10} ${y + 4}q10-13 20 0`} {...line} stroke={CREAM} strokeWidth={5} />
  if (face === 'closed') return <path d={`M${x - 10} ${y}q10 9 20 0`} {...line} stroke={CREAM} strokeWidth={5} />
  const [dx, dy] = face === 'up' ? [3, -4] : [1, 1]
  const r = face === 'worried' ? 7.5 : 9.5
  // Tiny sizes: one bold highlight, bigger whites, so the eyes don't turn to mush.
  if (small)
    return (
      <>
        <circle cx={x} cy={y} r={16} fill="#fff" />
        <g className="b-pupil">
          <circle cx={x + 1} cy={y + 1} r={10.5} fill={O} />
          <circle cx={x - 3} cy={y - 3.5} r={4.5} fill="#fff" />
        </g>
      </>
    )
  return (
    <>
      <circle cx={x} cy={y} r={face === 'worried' ? 14 : 13} fill="#fff" />
      <g className="b-pupil">
        <circle cx={x + dx} cy={y + dy} r={r} fill={O} />
        <circle cx={x + dx - 3.5} cy={y + dy - 4} r={3.4} fill="#fff" />
        <circle cx={x + dx + 3.5} cy={y + dy + 3.5} r={1.5} fill="#fff" />
      </g>
    </>
  )
}

function Head({ face, small }: { face: Face; small?: boolean }) {
  const open = face === 'open' || face === 'up' || face === 'worried'
  const sw = small ? 11 : SW
  return (
    <g className="b-head">
      <g className="b-ear-l"><Ear sw={sw} /></g>
      <g transform="matrix(-1 0 0 1 256 0)"><g className="b-ear-r"><Ear sw={sw} /></g></g>
      <path
        d="M128 38c44 0 76 24 80 60 5 6 10 12 13 20-5 3-11 4-16 5 3 5 6 10 7 16-8 2-15 3-22 3-14 16-38 22-62 22s-48-6-62-22c-7 0-14-1-22-3 1-6 4-11 7-16-5-1-11-2-16-5 3-8 8-14 13-20 4-36 36-60 80-60z"
        fill={FUR}
        stroke={O}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      {/* forehead stripe and pale brows */}
      {!small && <path d="M128 44c-6 14-6 32 0 48 6-16 6-34 0-48z" fill={FUR_D} />}
      <ellipse cx={92} cy={small ? 78 : 80} rx={21} ry={small ? 8 : 10} fill={CREAM} transform="rotate(-10 92 80)" />
      <ellipse cx={164} cy={small ? 78 : 80} rx={21} ry={small ? 8 : 10} fill={CREAM} transform="rotate(10 164 80)" />
      {/* the mask: two soft patches, not a band */}
      <path
        d="M128 96C120 86 108 83 94 83 76 83 62 95 58 112c0 8 8 12 18 10 12-2 24 0 36-8 6-4 12-8 16-8s10 4 16 8c12 8 24 6 36 8 10 2 18-2 18-10-4-17-18-29-36-29-14 0-26 3-34 13z"
        fill={MASK}
      />
      <g className={open ? 'b-eyes' : undefined}>
        <Eye x={94} face={face} small={small} />
        <Eye x={162} face={face} small={small} />
      </g>
      {/* muzzle, nose, mouth */}
      <path d="M108 126c0-14 40-14 40 0 12 8 8 32-20 34-28-2-32-26-20-34z" fill={CREAM} />
      {!small && (
        <>
          <ellipse cx={76} cy={130} rx={10} ry={6} fill={BLUSH} opacity={0.55} />
          <ellipse cx={180} cy={130} rx={10} ry={6} fill={BLUSH} opacity={0.55} />
        </>
      )}
      <path d="M116 124c0-7 24-7 24 0 0 6-7 10-12 10s-12-4-12-10z" fill="#1c252b" />
      <ellipse cx={123} cy={121} rx={3.5} ry={2} fill="#fff" opacity={0.55} />
      {face === 'happy' ? (
        <>
          <path d="M114 140c4 14 24 14 28 0z" fill="#5b2328" stroke={O} strokeWidth={4} strokeLinejoin="round" />
          <path d="M121 147c4-3 10-3 14 0-2 3-12 3-14 0z" fill="#f08a8a" />
        </>
      ) : face === 'worried' ? (
        <path d="M117 145q5.5-5 11 0t11 0" {...line} strokeWidth={4.5} />
      ) : face === 'up' ? (
        <path d="M120 142q9 5 16-2" {...line} strokeWidth={4.5} />
      ) : (
        <path d="M128 134v6M116 140q6 7 12 0q6 7 12 0" {...line} strokeWidth={small ? 7 : 4.5} />
      )}
    </g>
  )
}

function Tail({ d, end }: { d: string; end: [number, number] }) {
  // Drawn as strokes so the width is even all the way along.
  return (
    <g className="b-tail">
      <path d={d} {...line} strokeWidth={38} />
      <path d={d} fill="none" stroke={FUR} strokeWidth={26} strokeLinecap="round" />
      <path d={d} fill="none" stroke={MASK} strokeWidth={26} pathLength={100} strokeDasharray="34 12 12 12 12 100" />
      <circle cx={end[0]} cy={end[1]} r={13} fill={MASK} />
    </g>
  )
}

function Body() {
  return (
    <>
      <path d="M82 230c-6-36 12-74 46-74s52 38 46 74q-46 8-92 0z" fill={FUR} stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M102 228c-2-26 8-48 26-48s28 22 26 48q-26 4-52 0z" fill={CREAM} />
      <ellipse cx={103} cy={230} rx={17} ry={9} fill={FUR_D} stroke={O} strokeWidth={SW} />
      <ellipse cx={153} cy={230} rx={17} ry={9} fill={FUR_D} stroke={O} strokeWidth={SW} />
    </>
  )
}

function Arm({ d, className }: { d: string; className?: string }) {
  return (
    <g className={className}>
      <path d={d} {...line} strokeWidth={30} />
      <path d={d} fill="none" stroke={FUR} strokeWidth={18} strokeLinecap="round" />
    </g>
  )
}

function Paw({ x, y, r = 0 }: { x: number; y: number; r?: number }) {
  return <ellipse cx={x} cy={y} rx={13} ry={11} fill={FUR_D} stroke={O} strokeWidth={SW} transform={`rotate(${r} ${x} ${y})`} />
}

// A receipt centred on 0,0: 52 wide, 70 tall, torn bottom edge, gold check stamp.
function Receipt({ x, y, rot = 0, scale = 1 }: { x: number; y: number; rot?: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      <path d="M-26-30q0-4 4-4h44q4 0 4 4v60l-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5z" fill={PAPER} stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M-15-20h30M-15-9h20M-15 2h12" {...line} strokeWidth={4.5} opacity={0.75} />
      <circle cx={9} cy={15} r={10} fill={GOLD} stroke={O} strokeWidth={4} />
      <path d="M4.5 15.5l3 3 6-6.5" {...line} strokeWidth={3.5} />
    </g>
  )
}

// The logo's shoebox, big enough to sit in.
function GoldBox() {
  return (
    <>
      <path d="M42 203l23-17h126l23 17z" fill={GOLD_2} stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M42 203h172v29q0 8-8 8H50q-8 0-8-8z" fill={GOLD} stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <rect x={110} y={214} width={36} height={11} rx={5.5} fill="#1d1400" opacity={0.4} />
    </>
  )
}

function Sparkle({ x, y, s = 1, fill = GOLD }: { x: number; y: number; s?: number; fill?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="b-spark" style={{ animationDelay: `${((x + y) % 7) * -0.3}s` }} d="M0-11l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill={fill} stroke={O} strokeWidth={3} strokeLinejoin="round" />
    </g>
  )
}

const tailSit = { d: 'M160 222c46 8 76-16 70-52', end: [230, 170] as [number, number] }

function Pose({ pose }: { pose: BanditPose }) {
  switch (pose) {
    case 'wave':
      return (
        <>
          <Tail {...tailSit} />
          <Body />
          <Head face="open" />
          <Arm d="M156 186q12 10 10 24" />
          <Receipt x={178} y={208} rot={10} scale={0.62} />
          <Paw x={166} y={212} />
          <g className="b-wave">
            <Arm d="M104 186c-34 4-58-14-66-52" />
            <Paw x={36} y={128} r={-70} />
          </g>
          <path d="M16 104q-10 14-4 30M28 96q-6 8-5 18" {...line} stroke={GOLD} strokeWidth={5} />
        </>
      )
    case 'thinking':
      return (
        <>
          <Tail {...tailSit} />
          <Body />
          <g transform="rotate(-6 128 166)"><Head face="up" /></g>
          <Arm d="M156 186q8 16-6 24" />
          <Receipt x={150} y={212} rot={-8} scale={0.62} />
          <Paw x={146} y={212} />
          <Arm d="M106 196q-18-14-2-34" />
          <Paw x={105} y={160} r={30} />
          <g>
            <path d="M206 34c0-12 22-12 22 0 0 9-11 9-11 20" {...line} strokeWidth={14} />
            <path d="M206 34c0-12 22-12 22 0 0 9-11 9-11 20" {...line} stroke={GOLD} strokeWidth={7} />
            <circle cx={217} cy={68} r={7} fill={GOLD} stroke={O} strokeWidth={3.5} />
          </g>
        </>
      )
    case 'celebrate':
      return (
        <>
          <Tail d="M150 206c46-2 74-20 72-52" end={[222, 154]} />
          <Body />
          <Head face="happy" />
          <Arm d="M102 188q-36-2-58-36" />
          <Arm d="M154 188q36-2 58-36" />
          <Paw x={42} y={148} r={-40} />
          <Paw x={214} y={148} r={40} />
          <Receipt x={76} y={186} rot={-14} scale={0.5} />
          <Receipt x={182} y={184} rot={12} scale={0.5} />
          <GoldBox />
          <Sparkle x={30} y={64} />
          <Sparkle x={226} y={44} s={0.8} fill={GOLD_2} />
          <Sparkle x={222} y={102} s={0.6} fill={SEA} />
          <Sparkle x={46} y={20} s={0.55} fill={SEA} />
        </>
      )
    case 'sleep':
      return (
        <>
          <Tail {...tailSit} />
          <Body />
          <g transform="rotate(7 128 166)"><Head face="closed" /></g>
          <Arm d="M100 184q-4 16 2 22" />
          <Arm d="M156 184q4 16-2 22" />
          <Receipt x={128} y={200} rot={-4} />
          <Paw x={104} y={208} />
          <Paw x={152} y={206} />
          <g className="b-zzz" {...line}>
            <path d="M198 50h16l-16 18h16M224 22h11l-11 13h11" strokeWidth={12} />
            <path d="M198 50h16l-16 18h16M224 22h11l-11 13h11" stroke={GOLD} strokeWidth={5.5} />
          </g>
        </>
      )
    case 'oops':
      return (
        <>
          <Tail {...tailSit} />
          <Body />
          <Head face="worried" />
          <Arm d="M102 186q-26 8-38-12" />
          <Arm d="M154 186q26 8 38-12" />
          <Paw x={62} y={170} r={-60} />
          <Paw x={194} y={170} r={60} />
          <Receipt x={40} y={222} rot={-68} scale={0.62} />
          <path d="M204 54c6 10 10 16 10 21a8 8 0 0 1-16 0c0-5 2-11 6-21z" fill="#a6dcff" stroke={O} strokeWidth={4} strokeLinejoin="round" />
        </>
      )
    case 'head':
      return <Head face="open" small />
    default:
      return (
        <>
          <Tail {...tailSit} />
          <Body />
          <Head face="open" />
          <Arm d="M100 184q-8 10-2 18" />
          <Arm d="M156 184q8 10 2 16" />
          <Receipt x={128} y={192} rot={-6} scale={0.9} />
          <Paw x={101} y={202} />
          <Paw x={155} y={198} />
        </>
      )
  }
}

const views: Partial<Record<BanditPose, string>> = { head: '30 -5 196 196' }

export function Bandit({
  pose = 'receipt',
  size = 160,
  label,
  className,
  style,
  still,
  watch,
  hop,
}: {
  pose?: BanditPose
  size?: number
  /** Gives the drawing role="img" with this label. Leave out when it's decorative. */
  label?: string
  className?: string
  style?: React.CSSProperties
  /** No idle motion (blinks, tail sway). */
  still?: boolean
  /** Eyes follow the pointer around the page. */
  watch?: boolean
  /** A little hop when hovered. */
  hop?: boolean
}) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!watch || still || !el || typeof window === 'undefined') return
    if (motionReduced()) return
    let raf = 0
    let px = 0
    let py = 0
    const apply = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const dx = px - (r.left + r.width / 2)
      const dy = py - (r.top + r.height * 0.42)
      const d = Math.hypot(dx, dy) || 1
      const k = Math.min(1, d / 260) * 4.5 // view-box units the pupils may travel
      el.style.setProperty('--bx', `${((dx / d) * k).toFixed(2)}px`)
      el.style.setProperty('--by', `${((dy / d) * k * 0.8).toFixed(2)}px`)
    }
    const move = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (!raf) raf = requestAnimationFrame(apply)
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [watch, still])
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={views[pose] ?? '0 0 256 256'}
      width={size}
      height={size}
      className={['bandit', `bandit-${pose}`, still ? 'still' : '', watch ? 'watching' : '', hop ? 'hop' : '', className ?? ''].filter(Boolean).join(' ')}
      style={style}
      focusable="false"
      {...a11y}
    >
      {pose !== 'head' && <ellipse cx={128} cy={240} rx={pose === 'celebrate' ? 92 : 70} ry={7} fill={O} opacity={0.14} />}
      <Pose pose={pose} />
    </svg>
  )
}
