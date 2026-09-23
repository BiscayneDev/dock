import { anchorSvg, firstLightSvg, sunriseSvg, type SunriseOptions } from '@/lib/brand/scene'

type Box = { className?: string; style?: React.CSSProperties }

export function Sunrise({ className, style, ...o }: SunriseOptions & Box): React.JSX.Element {
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: sunriseSvg(o) }} />
}

export function FirstLight({ className, style, ...o }: { id?: string; boatX?: number; horizon?: number } & Box): React.JSX.Element {
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: firstLightSvg(o) }} />
}

export function Anchor({ color, size, className }: { color?: string; size?: number; className?: string }): React.JSX.Element {
  return <span className={className} style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: anchorSvg(color, size) }} />
}
