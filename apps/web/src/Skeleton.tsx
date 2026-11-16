import type { CSSProperties } from 'react'
import { Logo } from './Logo'

/** One placeholder block. Sizes come from the real layout so nothing jumps when the data arrives. */
export function Sk({ w, h = 12, r, className = '', style }: { w?: number | string; h?: number | string; r?: number | string; className?: string; style?: CSSProperties }) {
  return <span className={`sk ${className}`} aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

/** Lines of body text, the last one shorter, like a paragraph. */
function Lines({ n, gap = 9 }: { n: number; gap?: number }) {
  return (
    <div style={{ display: 'grid', gap }}>
      {Array.from({ length: n }, (_, i) => <Sk key={i} w={i === n - 1 ? '62%' : '100%'} h={12} />)}
    </div>
  )
}

/**
 * What a story switch shows while the next story loads: the same shell as the real app (side panel, timeline bar, dock)
 * with placeholders where the content will be. The first load shows the splash instead.
 */
export function ShellSkeleton({ label }: { label: string }) {
  return (
    <div className="app skeleton-shell" role="status" aria-busy="true" aria-label={label}>
      <aside className="side sk-side">
        <div className="side-head">
          <Sk w="70%" h={22} />
          <Sk w="45%" h={13} style={{ marginTop: 8 }} />
          <div className="sk-views"><Sk h={30} r="var(--radius-ctl)" /><Sk h={30} r="var(--radius-ctl)" /></div>
          <Sk w="55%" h={11} style={{ marginTop: 18 }} />
          <Sk h={8} style={{ marginTop: 8 }} />
          <div className="sk-tabs"><Sk w={58} h={13} /><Sk w={46} h={13} /><Sk w={44} h={13} /><Sk w={40} h={13} /></div>
        </div>
        <div className="side-body">
          <Lines n={7} />
          <div className="sk-stat"><Sk w="40%" h={13} /><Lines n={3} gap={7} /></div>
          <Sk h={38} r="var(--radius-ctl)" style={{ marginTop: 16 }} />
          <div className="sk-pair"><Sk h={36} r="var(--radius-ctl)" /><Sk h={36} r="var(--radius-ctl)" /></div>
        </div>
      </aside>
      <div className="timeline sk-timeline">
        <div className="tl-head"><Sk w={74} h={32} r="var(--radius-ctl)" /><Sk w={36} h={32} r="var(--radius-ctl)" /><Sk w={150} h={32} r="var(--radius-ctl)" /><Sk w={36} h={32} r="var(--radius-ctl)" /><Sk w={170} h={14} /></div>
        <div className="sk-rows"><Sk h={8} /><Sk h={8} style={{ width: '88%' }} /><Sk h={11} style={{ marginTop: 4 }} /></div>
      </div>
      <nav className="dock sk-dock">
        <div className="dock-brand"><Logo variant="horizontal" height={20} /></div>
        <Sk w={150} h={14} /><Sk w={190} h={14} /><span style={{ flex: 1 }} /><Sk w={170} h={30} r="var(--radius-ctl)" /><Sk w={90} h={30} r="var(--radius-ctl)" />
      </nav>
    </div>
  )
}
