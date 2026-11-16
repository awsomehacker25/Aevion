import type { ReactNode } from 'react'
import { useI18n } from './i18n'
import type { ThemePref } from './theme'

const base = { width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const ICONS: Record<ThemePref, ReactNode> = {
  system: <svg {...base}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></svg>,
  dark: <svg {...base}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>,
  light: <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>,
}
const ORDER: ThemePref[] = ['system', 'dark', 'light']

/** System / Dark / Light. Icon buttons with text labels for screen readers; the choice is remembered. */
export function ThemeSwitch({ pref, setPref }: { pref: ThemePref; setPref: (p: ThemePref) => void }) {
  const { t } = useI18n()
  return (
    <div className="seg theme-seg" role="group" aria-label={t('top.theme')}>
      {ORDER.map((p) => (
        <button key={p} className={`icon-btn ${pref === p ? 'on' : ''}`} aria-pressed={pref === p} title={t(`top.theme.${p}`)} aria-label={t(`top.theme.${p}`)} onClick={() => setPref(p)}>
          {ICONS[p]}
        </button>
      ))}
    </div>
  )
}
