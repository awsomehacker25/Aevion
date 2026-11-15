import { createContext, useContext } from 'react'
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

export const loaders: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Dict }>> = {
  es: () => import('./es'),
  ru: () => import('./ru'),
  haw: () => import('./haw'),
  as: () => import('./as'),
  hi: () => import('./hi'),
}

export const isLang = (v: string | null | undefined): v is Lang => !!v && v in LANGS

/** Number and date formats for a language. Hawaiian has no browser locale data, so it borrows English formats. */
export function intlLocale(lang: Lang): string {
  const tag = LANGS[lang].locale
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : 'en-US'
  } catch {
    return 'en-US'
  }
}

export interface I18n {
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

export const Ctx = createContext<I18n>({
  lang: 'en',
  t: (k, vars) => fill(en[k] ?? k, vars),
  date: (v, opts) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC', ...opts })
    .format(typeof v === 'number' ? v : Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v)),
  num: (v, digits = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v),
  setLang: () => {},
  machine: false,
})

export const useI18n = () => useContext(Ctx)
export const useT = () => useContext(Ctx).t

export const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m)) : s

export const STORE = 'aevion-lang'

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

export function rememberLang(l: Lang) {
  try { localStorage.setItem(STORE, l) } catch { /* ignore */ }
  try {
    const url = new URL(location.href)
    if (l === 'en') url.searchParams.delete('lang'); else url.searchParams.set('lang', l)
    history.replaceState(null, '', url)
  } catch { /* ignore */ }
}
