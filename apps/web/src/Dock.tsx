import { useEffect, useRef, useState } from 'react'
import { LANGS, isLang, rememberLang, useI18n } from './i18n'
import type { Lang } from './i18n'
import { Logo } from './Logo'
import { Menu } from './Menu'
import { ThemeSwitch } from './ThemeSwitch'
import type { ThemePref } from './theme'
import type { Story, StoryIndexEntry } from './types'
import type { UiMode } from './Panels'

interface DockProps {
  story: Pick<Story, 'id' | 'dataStatus' | 'dataStatusNote' | 'statusDetail'>
  ui: UiMode
  setUi: (m: UiMode) => void
  stories: StoryIndexEntry[]
  onSwitchStory: (id: string) => void
  /** Languages this story is offered in. The language menu is hidden when there is only English. */
  languages?: string[]
  theme: { pref: ThemePref; setPref: (p: ThemePref) => void }
  /** The map point the person clicked, shown at the right end in Scientist mode. */
  coords?: [number, number] | null
}

const fmtCoord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`

/**
 * The bottom navigation: logo, story menu, data status (always visible), Story / Scientist, language, theme,
 * and in Scientist mode the coordinates readout. Menus open upward.
 */
export function Dock({ story, ui, setUi, stories, onSwitchStory, languages, theme, coords }: DockProps) {
  const { t, lang, setLang, machine } = useI18n()
  const sci = ui === 'scientist'
  const langs = (languages ?? ['en']).filter(isLang)
  const detail = story.statusDetail ? (sci ? story.statusDetail.scientist : story.statusDetail.story) : ''
  return (
    <nav className="dock" aria-label={t('dock.aria')}>
      <div className="dock-brand"><Logo variant="horizontal" height={20} className="logo-wide" /><Logo variant="mark" height={24} className="logo-mark" /></div>
      {stories.length > 1 && (
        <Menu className="dock-story" label={t('top.chooseStory')} featuredLabel={t('top.featured')} value={story.id} onChange={onSwitchStory}
          items={stories.map((s) => ({ value: s.id, label: s.label ?? s.title, hint: s.label ? s.title : undefined, featured: s.featured }))} />
      )}
      <div className={`status s-${story.dataStatus}`} title={[story.dataStatusNote, detail].filter(Boolean).join(' - ')}>
        <span className="dot" />
        <span className="s-full">{t(`status.${story.dataStatus}`)}</span>
        <span className="s-short">{t(`status.short.${story.dataStatus}`)}</span>
        {sci && (story.statusDetail || story.dataStatus === 'placeholder') && (
          <em> &middot; {story.statusDetail ? story.statusDetail.scientist : t('status.placeholderDetail')}</em>
        )}
      </div>
      <div className="seg" role="group" aria-label={t('top.mode')}>
        <button aria-pressed={!sci} className={!sci ? 'on' : ''} onClick={() => setUi('story')}>{t('top.story')}</button>
        <button aria-pressed={sci} className={sci ? 'on' : ''} onClick={() => setUi('scientist')}>{t('top.scientist')}</button>
      </div>
      {langs.length > 1 && (
        <Menu className="dock-lang" label={t('top.language')} value={lang} onChange={(l) => { const v = l as Lang; rememberLang(v); setLang(v) }}
          items={langs.map((l) => ({ value: l, label: LANGS[l].native, hint: LANGS[l].machine ? t('lang.machine') : undefined }))}
          footer={<>{t('lang.machine.title')}</>} />
      )}
      {machine && <span className="mt-note" title={t('lang.machine.title')}>{t('lang.machine')}</span>}
      <ThemeSwitch pref={theme.pref} setPref={theme.setPref} />
      <DockMore story={story} detail={detail} langs={langs} theme={theme} />
      {sci && (
        <div className="dock-coords" aria-live="polite" title={t('top.coords')}>
          {coords ? <span className="mono">{fmtCoord(coords[1], 'N', 'S')}, {fmtCoord(coords[0], 'E', 'W')}</span> : <span className="dim">{t('top.coords.hint')}</span>}
        </div>
      )}
    </nav>
  )
}

/**
 * Phones: language, theme and the data status fold into one options button, so the top bar stays a single tidy row.
 * (On wider screens this is hidden and the same things sit in the dock itself.)
 */
function DockMore({ story, detail, langs, theme }: { story: DockProps['story']; detail: string; langs: Lang[]; theme: DockProps['theme'] }) {
  const { t, lang, setLang, machine } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const note = [story.dataStatusNote, detail].filter(Boolean).join(' - ')
  return (
    <div className="dock-more" ref={box}>
      <button ref={btn} type="button" className={`more-btn s-${story.dataStatus}`} aria-haspopup="dialog" aria-expanded={open} aria-label={t('dock.options')} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
        <span className="dot" aria-hidden="true" />
      </button>
      {open && (
        <div className="more-pop glass panel" role="dialog" aria-label={t('dock.options')}>
          <section className={`more-sec s-${story.dataStatus}`}>
            <h3>{t('dock.status')}</h3>
            <p className="more-status"><span className="dot" aria-hidden="true" />{t(`status.${story.dataStatus}`)}</p>
            {note && <p className="more-note">{note}</p>}
          </section>
          {langs.length > 1 && (
            <section className="more-sec">
              <h3>{t('top.language')}</h3>
              <div className="more-langs" role="group" aria-label={t('top.language')}>
                {langs.map((l) => (
                  <button key={l} type="button" className={l === lang ? 'on' : ''} aria-pressed={l === lang} lang={l} onClick={() => { rememberLang(l); setLang(l) }}>{LANGS[l].native}</button>
                ))}
              </div>
              {machine && <p className="more-note">{t('lang.machine.title')}</p>}
            </section>
          )}
          <section className="more-sec">
            <h3>{t('top.theme')}</h3>
            <ThemeSwitch pref={theme.pref} setPref={theme.setPref} />
          </section>
        </div>
      )}
    </div>
  )
}
