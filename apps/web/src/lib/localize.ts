import { useEffect, useState } from 'react'
import { loadStoryText } from './data'
import { useI18n } from '../i18n'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Lays one language's text over the English story. Objects merge key by key, arrays of objects merge by position
 * (so a translated tour step keeps the camera and date of the English one), anything else is replaced.
 */
export function overlay<T>(base: T, ov: unknown): T {
  if (ov == null) return base
  if (Array.isArray(base) && Array.isArray(ov)) {
    if (base.length && isObj(base[0])) return base.map((b, i) => (ov[i] !== undefined ? overlay(b, ov[i]) : b)) as T
    return (ov.length ? ov : base) as T
  }
  if (isObj(base) && isObj(ov)) {
    const out: Record<string, unknown> = { ...base }
    for (const k of Object.keys(ov)) {
      if (k.startsWith('_')) continue
      out[k] = k in base ? overlay((base as Record<string, unknown>)[k], ov[k]) : ov[k]
    }
    return out as T
  }
  return typeof ov === typeof base || base == null ? (ov as T) : base
}

/** True when a story offers this language. */
export const offers = (languages: string[] | undefined, lang: string) => lang === 'en' || !!languages?.includes(lang)

/** The story in the viewer's language: the English story with that language's text laid over it. */
export function useLocalizedStory<T>(id: string, story: T | null | undefined): T | null {
  const { lang } = useI18n()
  const [ov, setOv] = useState<{ lang: string; id: string; text: unknown } | null>(null)
  useEffect(() => {
    let live = true
    if (lang === 'en') { setOv(null); return }
    loadStoryText<unknown>(id, lang).then((text) => { if (live) setOv({ lang, id, text }) })
    return () => { live = false }
  }, [id, lang])
  if (!story) return null
  return ov && ov.lang === lang && ov.id === id ? overlay(story, ov.text) : story
}
