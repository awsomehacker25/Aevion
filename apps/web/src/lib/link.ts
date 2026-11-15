/**
 * Shareable links. Every story keeps the same few short keys in the address after the #:
 *   v = map view, d = date, t = side-panel tab, c = compare date (flood story), p = measured period.
 * Dates are six digits, yymmdd (so 22 July 2026 is 260722). Longer forms from older links still open.
 */

/** "2026-07-22" to "260722". */
export const shortDate = (iso: string) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10)

/** "260722" (or an older "2026-07-22") to "2026-07-22", or null when it is neither. */
export function longDate(s: string | null | undefined): string | null {
  if (!s) return null
  if (/^\d{6}$/.test(s)) return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** The link's keys, with older long names (tab) still understood. */
export function readLink() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''))
  return { v: h.get('v'), d: longDate(h.get('d')), c: longDate(h.get('c')), t: h.get('t') ?? h.get('tab'), p: h.get('p') }
}

/** Replaces the link in the address bar without adding a history entry. Empty values are left out. */
export function writeLink(parts: Record<string, string | null | undefined>) {
  const url = new URL(location.href)
  url.hash = Object.entries(parts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&')
  history.replaceState(null, '', url)
}

/** An epoch id such as "ep-2025-12-12" as a six-digit code, and back. */
export const epochCode = (id: string) => shortDate(id.replace(/^ep-/, ''))
export const epochFromCode = (code: string | null, ids: string[]) =>
  ids.find((id) => id === code || (longDate(code) != null && id === `ep-${longDate(code)}`)) ?? null
