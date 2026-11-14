import { areaMean } from './lib/analysis'
import type { UiMode } from './Panels'
import type { City, Grid, Overlays, UsgsContext } from './types'

const ROMAN: Record<number, string> = { 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X' }
const mmiWord = (m: number) =>
  m >= 9 ? 'violent' : m >= 8 ? 'severe' : m >= 7 ? 'very strong' : m >= 6 ? 'strong' : m >= 5 ? 'moderate' : 'light'
const fmtPop = (n: number) => n.toLocaleString('en-US')
const million = (n: number) => `${(n / 1e6).toFixed(1)} million`

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
  const sci = ui === 'scientist'
  const pg = context.pager
  const rows = [...context.cities]
    .sort((a, b) => b.pop - a.pop)
    .slice(0, sci ? 12 : 6)
    .map((c) => ({ c, d: areaMean(defo, c.lon, c.lat, 2), cv: areaMean(cov, c.lon, c.lat, 2) }))
  const exposure = pg.exposureByMmi ?? {}
  const maxExp = Math.max(1, ...Object.values(exposure))

  return (
    <details className="impact">
      <summary>{sci ? 'Impact data (USGS)' : 'Who was affected?'}</summary>

      <div className="impact-top">
        {pg.fatalityLevel && (
          <span className={`pager p-${pg.fatalityLevel}`} title="USGS PAGER estimate of the earthquake's human impact">
            PAGER alert: {pg.fatalityLevel.toUpperCase()}
          </span>
        )}
        {pg.felt != null && <span className="felt">{fmtPop(pg.felt)} people reported feeling it</span>}
      </div>
      {pg.exposedMmi7plus != null && (
        <p className="impact-line">
          {sci
            ? `USGS PAGER estimates ${fmtPop(pg.exposedMmi7plus)} people were exposed to shaking of intensity VII or more.`
            : `About ${million(pg.exposedMmi7plus)} people were exposed to very strong shaking or worse (USGS estimate).`}
        </p>
      )}

      <div className="toggles">
        <label><input type="checkbox" checked={overlays.cities} onChange={(e) => setOverlays((o) => ({ ...o, cities: e.target.checked }))} /> Show cities</label>
        <label><input type="checkbox" checked={overlays.shaking} onChange={(e) => setOverlays((o) => ({ ...o, shaking: e.target.checked }))} /> Show shaking contours</label>
      </div>

      <table className="cities">
        <thead>
          <tr>
            <th>City</th>
            <th>{sci ? 'Pop.' : 'People'}</th>
            <th>{sci ? 'MMI' : 'Shaking'}</th>
            <th>{sci ? 'LOS cm' : 'Ground moved'}</th>
            {sci && <th>Cov.</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, d, cv }) => (
            <tr key={c.name} onClick={() => onCity(c)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onCity(c) }}>
              <td>{c.name}</td>
              <td>{fmtPop(c.pop)}</td>
              <td>{sci ? `${c.mmi.toFixed(1)} (${ROMAN[Math.round(c.mmi)] ?? ''})` : mmiWord(c.mmi)}</td>
              <td>
                {d == null
                  ? <i>no data</i>
                  : !sci && Math.abs(d * 100) < 1
                    ? 'barely moved'
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
          : 'Click a city to fly there. "No data" means the radar could not measure the ground at that spot. Shaking and population figures are USGS estimates.'}
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
