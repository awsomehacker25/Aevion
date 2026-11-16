import type { CSSProperties } from 'react'

export type LogoVariant = 'mark' | 'horizontal' | 'stacked'

const FILE: Record<LogoVariant, string> = { mark: 'aevion-mark.svg', horizontal: 'aevion-horizontal.svg', stacked: 'aevion-stacked.svg' }
/** width / height of each artwork's viewBox */
const ASPECT: Record<LogoVariant, number> = { mark: 1, horizontal: 249 / 76, stacked: 133 / 166 }

/**
 * The one Aevion logo, drawn in a single colour: the current text colour (--ink on dark, --bg-dark ink on light).
 * The SVG is used as a mask over currentColor, so it follows the theme and is never tinted with the data colours.
 */
export function Logo({ variant = 'horizontal', height, className = '' }: { variant?: LogoVariant; height: number; className?: string }) {
  const style = {
    '--logo': `url(${import.meta.env.BASE_URL}${FILE[variant]})`,
    height,
    width: Math.round(height * ASPECT[variant] * 100) / 100,
  } as CSSProperties
  return <span role="img" aria-label="Aevion" className={`logo ${className}`} style={style} />
}
