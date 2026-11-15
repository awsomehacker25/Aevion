import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { setDateLocale } from '../lib/data'
import { formatCustomDate } from '../lib/months'
import { Ctx, LANGS, fill, intlLocale, loaders } from './context'
import type { Dict, I18n, Lang } from './context'
import en from './en'

export function I18nProvider({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children: ReactNode }) {
  const [dict, setDict] = useState<{ lang: Lang; d: Dict }>({ lang: 'en', d: en })

  useEffect(() => {
    let live = true
    if (lang === 'en') { setDict({ lang: 'en', d: en }); return }
    loaders[lang]().then((m) => { if (live) setDict({ lang, d: m.default }) }).catch(() => { if (live) setDict({ lang: 'en', d: en }) })
    return () => { live = false }
  }, [lang])

  const shown = dict.lang
  const loc = intlLocale(shown)
  useEffect(() => {
    document.documentElement.lang = shown
    setDateLocale(loc, shown)
  }, [shown, loc])

  const t = useCallback((key: string, vars?: Record<string, string | number>) => fill(dict.d[key] ?? en[key] ?? key, vars), [dict])
  const date = useCallback((v: string | number, opts?: Intl.DateTimeFormatOptions) => {
    const ms = typeof v === 'number' ? v : Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v)
    const o = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC', ...opts } as Intl.DateTimeFormatOptions
    // Assamese and Hawaiian have no browser date data, so their month names come from lib/months.ts
    return formatCustomDate(ms, shown, { month: o.month as 'short' | 'long' | undefined, day: o.day as 'numeric' | undefined, year: o.year as 'numeric' | undefined }) ?? new Intl.DateTimeFormat(loc, o).format(ms)
  }, [loc, shown])
  const num = useCallback((v: number, digits = 0) => new Intl.NumberFormat(loc, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v), [loc])

  const value = useMemo<I18n>(() => ({ lang: shown, t, date, num, setLang, machine: LANGS[shown].machine }), [shown, t, date, num, setLang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
