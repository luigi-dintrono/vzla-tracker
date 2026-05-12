import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { Pillar } from "@/lib/data/pillars"

export function PillarHero({ pillar }: { pillar: Pillar }) {
  const Icon = pillar.icon
  return (
    <section className="px-6 pt-12 pb-16 md:pt-20 md:pb-24 border-b border-border">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-[200px_1fr] lg:grid-cols-[240px_1fr] gap-8 md:gap-16">
          <div className="flex items-start">
            <Badge variant="outline" className="font-display tracking-[0.2em] uppercase text-[10px]">
              Pillar {pillar.number}
            </Badge>
          </div>
          <div className="max-w-3xl">
            <Icon className="w-7 h-7 text-muted-foreground mb-6" strokeWidth={1.5} />
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-light font-sans leading-[1.1] mb-6">
              {pillar.title}
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground font-light leading-relaxed mb-4">
              {pillar.tagline}
            </p>
            <p className="text-sm md:text-base text-muted-foreground/80 font-light leading-relaxed">
              {pillar.description}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export function PillarSection({
  label,
  title,
  description,
  children,
}: {
  label: string
  title?: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="px-6 py-16 md:py-24 border-b border-border last:border-b-0">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-[200px_1fr] lg:grid-cols-[240px_1fr] gap-8 md:gap-16">
          <p className="text-sm text-muted-foreground">{label}</p>
          <div>
            {title && (
              <h2 className="text-2xl md:text-3xl font-light font-sans leading-[1.2] mb-4">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-sm md:text-base text-muted-foreground font-light leading-relaxed mb-8 max-w-2xl">
                {description}
              </p>
            )}
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}

export function MetricPlaceholder({
  label,
  hint,
}: {
  label: string
  hint?: string
}) {
  return (
    <Card className="gap-3 py-5 rounded-2xl">
      <CardHeader className="px-5">
        <CardDescription className="text-[10px] font-display tracking-[0.2em] uppercase">
          {label}
        </CardDescription>
        <CardTitle className="text-3xl font-light tabular-nums text-muted-foreground/40">
          —
        </CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="px-5">
          <p className="text-xs text-muted-foreground/70">{hint}</p>
        </CardContent>
      )}
    </Card>
  )
}

export function ChartPlaceholder({ label }: { label: string }) {
  return (
    <Card className="py-0 overflow-hidden rounded-2xl">
      <div className="aspect-[16/7] w-full grid place-items-center bg-muted/30 border-b border-border">
        <div className="text-center">
          <p className="text-[10px] font-display tracking-[0.25em] uppercase text-muted-foreground/60 mb-2">
            Visualization
          </p>
          <p className="text-sm text-muted-foreground/80">{label}</p>
        </div>
      </div>
      <CardContent className="py-4 text-xs text-muted-foreground/70">
        Wire this to a cleaned CSV in <code className="font-mono text-[11px]">data/&lt;pillar&gt;/cleaned/</code>.
      </CardContent>
    </Card>
  )
}
