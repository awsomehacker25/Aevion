import { areaMean } from './lib/analysis'
import type { UiMode } from './Panels'
import type { City, Grid, Overlays, UsgsContext } from './types'
import { useI18n } from './i18n'

const ROMAN: Record<number, string> = { 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X' }
const mmiKey = (m: number) => (m >= 9 ? 'violent' : m >= 8 ? 'severe' : m >= 7 ? 'verystrong' : m >= 6 ? 'strong' : m >= 5 ? 'moderate' : 'light')

interface Props {
  context: UsgsContext
  defo: Grid
  cov: Grid
  ui: UiMode
  overlays: Overlays
  setOverlays: (f: (o: Overlays) => Overlays) => void
  onCity: (c: City) => void
}

export function ImpactPanel({ context, defo, cov, ui, overlays, setOverlays, onCity }: Props) {
  const { t, num } = useI18n()
  const sci = ui === 'scientist'
  const pg = context.pager
  const rows = [...context.cities]
    .sort((a, b) => b.pop - a.pop)
    .slice(0, sci ? 12 : 6)
    .map((c) => ({ c, d: areaMean(defo, c.lon, c.lat, 2), cv: areaMean(cov, c.lon, c.lat, 2) }))
  const fmtPop = (n: number) => num(n)
  const million = (n: number) => t('num.million', { n: num(n / 1e6, 1) })
  const exposure = pg.exposureByMmi ?? {}
  const maxExp = Math.max(1, ...Object.values(exposure))

  return (
    <details className="impact">
      <summary>{sci ? 'Impact data (USGS)' : t('s.impact.title')}</summary>

      <div className="impact-top">
        {pg.fatalityLevel && (
          <span className={`pager p-${pg.fatalityLevel}`} title={t('s.impact.pagerTip')}>
            {t('s.impact.pager', { level: pg.fatalityLevel.toUpperCase() })}
          </span>
        )}
        {pg.felt != null && <span className="felt">{t('s.impact.felt', { n: fmtPop(pg.felt) })}</span>}
      </div>
      {pg.exposedMmi7plus != null && (
        <p className="impact-line">
          {sci
            ? `USGS PAGER estimates ${fmtPop(pg.exposedMmi7plus)} people were exposed to shaking of intensity VII or more.`
            : t('s.impact.exposed', { n: million(pg.exposedMmi7plus) })}
        </p>
      )}

      <div className="toggles">
        <label><input type="checkbox" checked={overlays.cities} onChange={(e) => setOverlays((o) => ({ ...o, cities: e.target.checked }))} /> {t('s.impact.showCities')}</label>
        <label><input type="checkbox" checked={overlays.shaking} onChange={(e) => setOverlays((o) => ({ ...o, shaking: e.target.checked }))} /> {t('s.impact.showShaking')}</label>
      </div>

      <table className="cities">
        <thead>
          <tr>
            <th>{t('s.impact.city')}</th>
            <th>{sci ? 'Pop.' : t('s.impact.people')}</th>
            <th>{sci ? 'MMI' : t('s.impact.shaking')}</th>
            <th>{sci ? 'LOS cm' : t('s.impact.moved')}</th>
            {sci && <th>Cov.</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, d, cv }) => (
            <tr key={c.name} onClick={() => onCity(c)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onCity(c) }}>
              <td>{c.name}</td>
              <td>{fmtPop(c.pop)}</td>
              <td>{sci ? `${c.mmi.toFixed(1)} (${ROMAN[Math.round(c.mmi)] ?? ''})` : t(`s.mmi.${mmiKey(c.mmi)}`)}</td>
              <td>
                {d == null
                  ? <i>{t('s.nodata')}</i>
                  : !sci && Math.abs(d * 100) < 1
                    ? t('s.impact.barely')
                    : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(sci ? 1 : 0)} cm`}
              </td>
              {sci && <td>{cv == null ? '-' : cv.toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        {sci
          ? 'MMI = Modified Mercalli intensity (USGS ShakeMap at the city). LOS is the NISAR-derived motion along the line of sight, averaged around the city, relative to an unknown reference. Click a row to fly there.'
          : t('s.impact.hint')}
      </p>

      {sci && Object.keys(exposure).length > 0 && (
        <div className="exposure">
          <h4>People exposed, by shaking intensity</h4>
          {['5', '6', '7', '8', '9'].map((m) => (
            <div className="bar-row" key={m}>
              <span>{ROMAN[Number(m)]}</span>
              <i style={{ width: `${(100 * (exposure[m] ?? 0)) / maxExp}%` }} />
              <em>{million(exposure[m] ?? 0)}</em>
            </div>
          ))}
        </div>
      )}
    </details>
  )
}
