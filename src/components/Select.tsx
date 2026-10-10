import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons.js'

// A themed replacement for <select>. The native picker's open list is drawn
// by the operating system and can't be styled, so this renders its own
// listbox in a portal (so drawers can't clip it), with the keyboard behavior
// people expect: arrows, Home/End, Enter/Space, Escape, Tab and type-ahead.

export type SelectOption<T extends string | number> = { value: T; label: string; group?: string; hint?: string }

type Props<T extends string | number> = {
  id?: string
  value: T
  options: SelectOption<T>[]
  onChange: (v: T) => void
  'aria-label'?: string
  placeholder?: string
  disabled?: boolean
}

export function Select<T extends string | number>({ id, value, options, onChange, placeholder, disabled, ...rest }: Props<T>) {
  const autoId = useId()
  const btnId = id ?? `sel-${autoId}`
  const listId = `${btnId}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const selectedIdx = Math.max(0, options.findIndex((o) => o.value === value))
  const current = options.find((o) => o.value === value)

  const place = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const want = Math.min(320, options.length * 40 + 12)
    const up = below < Math.min(want, 220) && above > below
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 : r.bottom + 6, maxH: Math.max(140, Math.min(want, up ? above : below)), up })
  }

  const openList = () => {
    if (disabled) return
    place()
    setActive(selectedIdx)
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }
  const choose = (i: number) => {
    const o = options[i]
    if (o) onChange(o.value)
    close()
  }

  useLayoutEffect(() => {
    if (!open) return
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false)
    }
    const onMove = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return
      place()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onMove, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(last, a + 1)))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)))
    else if (e.key === 'Home') (e.preventDefault(), setActive(0))
    else if (e.key === 'End') (e.preventDefault(), setActive(last))
    else if (e.key === 'PageDown') (e.preventDefault(), setActive((a) => Math.min(last, a + 8)))
    else if (e.key === 'PageUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 8)))
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), choose(active))
    else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close())
    else if (e.key === 'Tab') close(false)
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead: jump to the first option starting with what was typed.
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text))
      if (i >= 0) setActive(i)
    }
  }

  const groups = useMemo(() => {
    const out: { group?: string; items: { o: SelectOption<T>; i: number }[] }[] = []
    options.forEach((o, i) => {
      const g = out[out.length - 1]
      if (g && g.group === o.group) g.items.push({ o, i })
      else out.push({ group: o.group, items: [{ o, i }] })
    })
    return out
  }, [options])

  return (
    <>
      <button
        ref={btn}
        id={btnId}
        type="button"
        className={'select-btn' + (open ? ' open' : '')}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={rest['aria-label']}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
      >
        <span className={current ? '' : 'faint'}>{current?.label ?? placeholder ?? 'Choose…'}</span>
        <Icon name="chevron" className="select-chev" />
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            className={'select-pop glass-card' + (pos.up ? ' up' : '')}
            style={{ left: pos.left, width: Math.max(pos.width, 180), maxHeight: pos.maxH, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
            onKeyDown={onKey}
          >
            {groups.map((g, gi) => (
              <div key={gi} role={g.group ? 'group' : undefined} aria-label={g.group}>
                {g.group && <div className="select-group">{g.group}</div>}
                {g.items.map(({ o, i }) => (
                  <div
                    key={String(o.value)}
                    id={`${listId}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={o.value === value}
                    className={'select-opt' + (i === active ? ' active' : '') + (o.value === value ? ' chosen' : '')}
                    // Only real pointer movement moves the highlight; the browser's
                    // synthetic hover after the list opens or scrolls would otherwise
                    // steal it from someone using the keyboard.
                    onPointerMove={(e) => (e.movementX || e.movementY) && active !== i && setActive(i)}
                    onClick={() => choose(i)}
                  >
                    <span>{o.label}{o.hint && <small>{o.hint}</small>}</span>
                    {o.value === value && <Icon name="check" className="select-tick" />}
                  </div>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
