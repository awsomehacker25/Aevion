import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from './Icons'

export interface MenuItem {
  value: string
  label: string
  /** A short second line, for example the place or the language's English name. */
  hint?: string
  /** Marked in the accent colour with a diamond. */
  featured?: boolean
}

interface MenuProps {
  items: MenuItem[]
  value: string
  onChange: (value: string) => void
  /** Accessible name of the whole control. */
  label: string
  /** What the "featured" mark says to screen readers. */
  featuredLabel?: string
  className?: string
  /** Rendered under the options inside the open menu. */
  footer?: ReactNode
}

/**
 * A single-choice menu that opens upward from the dock. It follows the listbox pattern: the button opens it,
 * arrow keys / Home / End move, Enter or Space picks, Escape closes and returns focus, a click outside closes.
 */
export function Menu({ items, value, onChange, label, featuredLabel, className = '', footer }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const uid = useId()
  const selected = Math.max(0, items.findIndex((i) => i.value === value))
  const current = items[selected]

  const show = () => { setActive(selected); setOpen(true) }
  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus() }
  const pick = (i: number) => { onChange(items[i].value); close() }

  useEffect(() => {
    if (!open) return
    list.current?.focus({ preventScroll: true })
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${uid}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, uid])

  const onKey = (e: React.KeyboardEvent) => {
    const n = items.length
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + n) % n) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active) }
    else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); e.stopPropagation(); close(e.key === 'Escape') }
    else if (e.key.length === 1) { // type a letter to jump to the next item that starts with it
      const k = e.key.toLowerCase()
      const next = items.findIndex((it, i) => i > active && it.label.toLowerCase().startsWith(k))
      const from = next >= 0 ? next : items.findIndex((it) => it.label.toLowerCase().startsWith(k))
      if (from >= 0) setActive(from)
    }
  }

  return (
    <div className={`menu ${className}`} ref={root}>
      <button ref={btn} type="button" className={`menu-btn ${current?.featured ? 'featured' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.label ?? ''}`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); show() } }}>
        {current?.featured && <i className="fdiamond" aria-hidden="true" />}
        <span className="menu-label">{current?.label}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="menu-pop glass panel">
          <ul ref={list} role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={`${uid}-${active}`} onKeyDown={onKey}>
            {items.map((it, i) => (
              <li key={it.value} id={`${uid}-${i}`} role="option" aria-selected={i === selected} className={`${i === active ? 'active' : ''} ${i === selected ? 'on' : ''}`}
                onPointerEnter={() => setActive(i)} onClick={() => pick(i)}>
                <span className="mi-main">
                  <span className="mi-label">{it.label}</span>
                  {it.featured && <span className="mi-tag"><i className="fdiamond" aria-hidden="true" />{featuredLabel}</span>}
                </span>
                {it.hint && <span className="mi-hint">{it.hint}</span>}
              </li>
            ))}
          </ul>
          {footer && <div className="menu-foot">{footer}</div>}
        </div>
      )}
    </div>
  )
}
