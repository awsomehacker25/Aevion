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
      <div className="dock-brand"><Logo variant="horizontal" height={20} /></div>
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
      {sci && (
        <div className="dock-coords" aria-live="polite" title={t('top.coords')}>
          {coords ? <span className="mono">{fmtCoord(coords[1], 'N', 'S')}, {fmtCoord(coords[0], 'E', 'W')}</span> : <span className="dim">{t('top.coords.hint')}</span>}
        </div>
      )}
    </nav>
  )
}
