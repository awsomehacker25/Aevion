/** Small drawn icons, one stroke weight (1.8), in place of text glyphs. They inherit the text colour. */
const base = { width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false } as const

export const PlayIcon = () => <svg {...base}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
export const PauseIcon = () => <svg {...base}><path d="M7 5v14M17 5v14" stroke="currentColor" strokeWidth="3.4" fill="none" /></svg>
export const ChevronLeft = () => <svg {...base}><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="square" /></svg>
export const ChevronRight = () => <svg {...base}><path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="square" /></svg>
export const ChevronDown = () => <svg {...base}><path d="M5 9l7 7 7-7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="square" /></svg>

/** The same left and right chevrons as raw SVG text, for the swipe handle that MapLibre builds by hand. */
export const CHEVRONS_HTML =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="square"/></svg>'
