import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { setDateLocale } from '../lib/data'
import en from './en'

/** Languages the app can show. Each story offers English plus the language of the place it is about. */
export type Lang = 'en' | 'es' | 'ru' | 'haw' | 'as' | 'hi'
export type Dict = Record<string, string>

export interface LangInfo {
  name: string
  /** The language's own name, shown in the switcher. */
  native: string
  /** BCP 47 tag for Intl. */
  locale: string
  /** True while the text was machine translated and no native speaker has checked it. English is the only reviewed language. */
  machine: boolean
}

export const LANGS: Record<Lang, LangInfo> = {
  en: { name: 'English', native: 'English', locale: 'en-US', machine: false },
  es: { name: 'Spanish', native: 'Español', locale: 'es', machine: true },
  ru: { name: 'Russian', native: 'Русский', locale: 'ru', machine: true },
  haw: { name: 'Hawaiian', native: 'ʻŌlelo Hawaiʻi', locale: 'haw', machine: true },
  as: { name: 'Assamese', native: 'অসমীয়া', locale: 'as-IN', machine: true },
  hi: { name: 'Hindi', native: 'हिन्दी', locale: 'hi-IN', machine: true },
}

const loaders: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Dict }>> = {
  es: () => import('./es'),
  ru: () => import('./ru'),
  haw: () => import('./haw'),
  as: () => import('./as'),
  hi: () => import('./hi'),
}

export const isLang = (v: string | null | undefined): v is Lang => !!v && v in LANGS

/** Number and date formats for a language. Hawaiian has no browser locale data, so it borrows English formats. */
function intlLocale(lang: Lang): string {
  const tag = LANGS[lang].locale
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : 'en-US'
  } catch {
    return 'en-US'
  }
}

interface I18n {
  lang: Lang
  /** Looks up a string, fills {placeholders} and falls back to English, then to the key itself. */
  t: (key: string, vars?: Record<string, string | number>) => string
  /** A date from an ISO string or a time in ms (UTC). */
  date: (v: string | number, opts?: Intl.DateTimeFormatOptions) => string
  num: (v: number, digits?: number) => string
  setLang: (l: Lang) => void
  /** True until a native speaker reviews this language. */
  machine: boolean
}

const Ctx = createContext<I18n>({
  lang: 'en',
  t: (k) => en[k] ?? k,
  date: (v) => String(v),
  num: (v) => String(v),
  setLang: () => {},
  machine: false,
})

export const useI18n = () => useContext(Ctx)
export const useT = () => useContext(Ctx).t

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m)) : s

const STORE = 'aevion-lang'

/** The language asked for in the address (?lang=es) or remembered from last time. */
export function initialLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang')
    if (isLang(q)) return q
    const s = localStorage.getItem(STORE)
    if (isLang(s)) return s
  } catch { /* storage blocked */ }
  return 'en'
}

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
    setDateLocale(loc)
  }, [shown, loc])

  const t = useCallback((key: string, vars?: Record<string, string | number>) => fill(dict.d[key] ?? en[key] ?? key, vars), [dict])
  const date = useCallback((v: string | number, opts?: Intl.DateTimeFormatOptions) => {
    const ms = typeof v === 'number' ? v : Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v)
    return new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC', ...opts }).format(ms)
  }, [loc])
  const num = useCallback((v: number, digits = 0) => new Intl.NumberFormat(loc, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v), [loc])

  const value = useMemo<I18n>(() => ({ lang: shown, t, date, num, setLang, machine: LANGS[shown].machine }), [shown, t, date, num, setLang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function rememberLang(l: Lang) {
  try { localStorage.setItem(STORE, l) } catch { /* ignore */ }
  try {
    const url = new URL(location.href)
    if (l === 'en') url.searchParams.delete('lang'); else url.searchParams.set('lang', l)
    history.replaceState(null, '', url)
  } catch { /* ignore */ }
}
