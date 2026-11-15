import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'system' | 'dark' | 'light'
export type Theme = 'dark' | 'light'

const KEY = 'aevion.theme'
const isPref = (v: unknown): v is ThemePref => v === 'system' || v === 'dark' || v === 'light'

function stored(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (isPref(v)) return v
  } catch { /* storage can be blocked */ }
  return 'system'
}

const systemTheme = (): Theme => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
const resolve = (p: ThemePref): Theme => (p === 'system' ? systemTheme() : p)

function apply(t: Theme) {
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#eef2f6' : '#080c10')
}

/** Set before React renders so the first paint is already in the right theme. */
export function initTheme() { apply(resolve(stored())) }

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(stored)
  const [theme, setTheme] = useState<Theme>(() => resolve(pref))

  useEffect(() => {
    const t = resolve(pref)
    setTheme(t)
    apply(t)
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const on = () => { const n = resolve('system'); setTheme(n); apply(n) }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [pref])

  const setPref = useCallback((p: ThemePref) => {
    try { localStorage.setItem(KEY, p) } catch { /* ignore */ }
    setPrefState(p)
  }, [])

  return { pref, theme, setPref }
}
