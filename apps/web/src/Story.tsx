import type { Story, TourStep } from './types'

export function WhyCards({ items }: { items?: Story['why'] }) {
  if (!items?.length) return null
  return (
    <div className="why">
      <h2>Why did this happen?</h2>
      {items.map((c) => (
        <details key={c.title}>
          <summary>{c.title}</summary>
          <p>{c.body}</p>
        </details>
      ))}
    </div>
  )
}

/** A simple side-view of how the satellite looks at the ground and what orange and blue mean. */
export function LosDiagram({ sci, incidence, azimuth }: { sci: boolean; incidence?: number; azimuth?: number }) {
  return (
    <details className="los">
      <summary>{sci ? 'Viewing geometry' : 'How does the satellite see this?'}</summary>
      <svg viewBox="0 0 300 160" role="img" aria-label="Diagram: the satellite looks down at the ground at an angle. Orange is motion away from it, blue is toward it.">
        <defs>
          <marker id="arrO" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#f39237" /></marker>
          <marker id="arrB" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#3b8fd4" /></marker>
        </defs>
        <path d="M0 132 Q60 118 110 124 T220 128 T300 120 L300 160 L0 160 Z" fill="#2a3a2a" opacity="0.9" />
        <g transform="translate(236 26)">
          <rect x="-9" y="-6" width="18" height="12" rx="2" fill="#cdd8ef" />
          <rect x="-34" y="-3" width="22" height="6" fill="#6aa5ff" />
          <rect x="12" y="-3" width="22" height="6" fill="#6aa5ff" />
        </g>
        <line x1="236" y1="34" x2="116" y2="122" stroke="#9fb4d9" strokeWidth="1.6" strokeDasharray="5 4" />
        <circle cx="116" cy="124" r="4.5" fill="#fff" />
        <line x1="128" y1="100" x2="86" y2="131" stroke="#f39237" strokeWidth="3" markerEnd="url(#arrO)" />
        <line x1="132" y1="148" x2="174" y2="117" stroke="#3b8fd4" strokeWidth="3" markerEnd="url(#arrB)" />
        <text x="14" y="104" fill="#f39237" fontSize="10.5" fontWeight="600">away = orange (+)</text>
        <text x="150" y="150" fill="#3b8fd4" fontSize="10.5" fontWeight="600">toward = blue (-)</text>
        <text x="196" y="64" fill="#9fb4d9" fontSize="10">line of sight</text>
      </svg>
      <p>
        {sci
          ? `The satellite looks left of its path at about ${incidence ?? 40} degrees from vertical, toward ${azimuth ?? 260} degrees (west-southwest). A single pass only measures the part of the motion along this line, so it cannot separate up, down, east and west.`
          : 'The satellite sees the ground from the side, not from straight above. It can only tell whether the ground moved closer or farther along that slanted line, which is why one pass cannot say "up" or "down" on its own.'}
      </p>
    </details>
  )
}

export function TourButton({ onStart, available }: { onStart: () => void; available: boolean }) {
  if (!available) return null
  return (
    <button className="cta" onClick={onStart}>Start the story tour</button>
  )
}

export function ReplayButton({ running, onStart, onStop }: { running: boolean; onStart: () => void; onStop: () => void }) {
  return (
    <button className="cta ghost" onClick={running ? onStop : onStart} aria-pressed={running}>
      {running ? 'Stop replay' : 'Replay the quake (illustrative)'}
    </button>
  )
}

export function TourCard(p: { steps: TourStep[]; index: number; onPrev: () => void; onNext: () => void; onExit: () => void }) {
  const step = p.steps[p.index]
  const last = p.index === p.steps.length - 1
  return (
    <div className="tour" role="dialog" aria-label="Guided tour">
      <div className="tour-top">
        <span className="tour-count">Step {p.index + 1} of {p.steps.length}</span>
        <button className="x" onClick={p.onExit} aria-label="Exit tour">&times;</button>
      </div>
      <h3>{step.title}</h3>
      <p>{step.text}</p>
      <div className="tour-dots" aria-hidden="true">
        {p.steps.map((s, i) => <i key={s.title} className={i === p.index ? 'on' : ''} />)}
      </div>
      <div className="tour-nav">
        <button className="btn" onClick={p.onPrev} disabled={p.index === 0}>Back</button>
        <button className="btn primary" onClick={last ? p.onExit : p.onNext}>{last ? 'Finish' : 'Next'}</button>
      </div>
    </div>
  )
}
