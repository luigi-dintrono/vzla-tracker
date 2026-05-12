"use client"

import * as React from "react"

// =============================================================================
// Tiny shared hover primitive for the pillar charts.
//   - useSvgHover: given a horizontal scale and a series length, returns the
//     active index from mouse position over a transparent <rect> capture area.
//   - SvgTooltip: positions a small html-in-svg tooltip via foreignObject so we
//     can use rich html / tailwind text instead of stacking <text> elements.
// =============================================================================

export interface SvgHoverState {
  /** Active index (0..length-1), or null when not hovering */
  idx: number | null
  /** Cursor x in user-space units (matches the chart's viewBox) */
  x: number | null
}

export function useSvgHover(length: number) {
  const [state, setState] = React.useState<SvgHoverState>({ idx: null, x: null })

  // Memoized mouse-move callback: convert the screen-space pointer back into
  // the SVG's user-space coordinates and snap to the nearest data index.
  const onMove = React.useCallback(
    (e: React.MouseEvent<SVGElement>, padding: { left: number; right: number }, innerW: number) => {
      const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement)
      const ctm = (svg as SVGSVGElement).getScreenCTM()
      if (!ctm) return
      const pt = (svg as SVGSVGElement).createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const u = pt.matrixTransform(ctm.inverse())
      if (length <= 0) return
      const t = length === 1 ? 0 : ((u.x - padding.left) / innerW) * (length - 1)
      const idx = Math.max(0, Math.min(length - 1, Math.round(t)))
      setState({ idx, x: u.x })
    },
    [length],
  )

  const onLeave = React.useCallback(() => setState({ idx: null, x: null }), [])

  return { hover: state, onMove, onLeave }
}

/**
 * Render an html tooltip inside an svg via foreignObject so the content can use
 * tailwind classes. Position is anchored on (x, y) and the tooltip auto-flips
 * to the left side if it would overflow the right edge.
 */
export function SvgTooltip({
  x,
  y,
  width = 220,
  height = 88,
  chartWidth,
  children,
}: {
  x: number
  y: number
  width?: number
  height?: number
  chartWidth: number
  children: React.ReactNode
}) {
  const offset = 12
  const flip = x + offset + width > chartWidth
  const tx = flip ? x - offset - width : x + offset
  const ty = Math.max(8, y - height / 2)
  return (
    <foreignObject x={tx} y={ty} width={width} height={height} pointerEvents="none">
      <div
        className="rounded-md border border-border bg-popover/95 backdrop-blur-sm px-3 py-2 text-[11px] leading-snug shadow-lg text-foreground"
        style={{ width, height }}
      >
        {children}
      </div>
    </foreignObject>
  )
}

/** Pure html tooltip — for non-svg charts (heatmaps, bars) where we already have a wrapper div */
export function HtmlTooltip({
  left,
  top,
  visible,
  children,
}: {
  left: number
  top: number
  visible: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full mt-[-8px] rounded-md border border-border bg-popover/95 backdrop-blur-sm px-2.5 py-1.5 text-[11px] leading-snug shadow-lg text-foreground transition-opacity duration-100 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      style={{ left, top }}
    >
      {children}
    </div>
  )
}
