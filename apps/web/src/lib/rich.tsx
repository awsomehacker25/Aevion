import type { ReactNode } from 'react'

/**
 * Tiny inline markup for story text so translators never touch HTML:
 * **bold**, *italic* and [label](https://link). Everything else is plain text.
 */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:[^)\s]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] != null) out.push(<b key={i++}>{m[1]}</b>)
    else if (m[2] != null) out.push(<i key={i++}>{m[2]}</i>)
    else out.push(<a key={i++} href={m[4]} target="_blank" rel="noreferrer noopener">{m[3]}</a>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

/** Paragraphs of rich text. */
export function Paras({ items, className }: { items: string[]; className?: string }) {
  return <>{items.map((p, i) => <p key={i} className={className}><Rich text={p} /></p>)}</>
}
