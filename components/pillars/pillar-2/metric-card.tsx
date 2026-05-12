import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface MetricCardProps {
  label: string
  value: string | number
  hint?: string
  sub?: string
}

export function MetricCard({ label, value, hint, sub }: MetricCardProps) {
  return (
    <Card className="gap-3 py-5 rounded-2xl">
      <CardHeader className="px-5">
        <CardDescription className="text-[10px] font-display tracking-[0.2em] uppercase">{label}</CardDescription>
        <CardTitle className="text-3xl font-light tabular-nums">
          {value}
          {sub && <span className="ml-1.5 text-base text-muted-foreground/80">{sub}</span>}
        </CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="px-5">
          <p className="text-xs text-muted-foreground/70 leading-snug">{hint}</p>
        </CardContent>
      )}
    </Card>
  )
}
