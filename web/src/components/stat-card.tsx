import * as React from "react"
import { InfoIcon, type LucideIcon } from "lucide-react"

import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { NumberTicker } from "@/components/ui/number-ticker"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fmtNum } from "@/lib/labels"
import { cn } from "@/lib/utils"

const fmtInt = (n: number) => fmtNum(Math.round(n))

export function StatCard({
  label,
  value,
  format = fmtInt,
  hint,
  icon: Icon,
  progress,
  gauge,
  accent,
}: {
  label: string
  value: number | string | null // numbers count up; strings (ranges, "a ← b") render as-is
  format?: (n: number) => string
  hint?: string
  icon?: LucideIcon
  progress?: number // 0-100
  gauge?: boolean // circular gauge instead of the linear bar
  accent?: string // CSS colour for the icon chip, e.g. "var(--chart-2)"
}) {
  const text = value == null ? "—" : typeof value === "number" ? format(value) : value
  const [hintOpen, setHintOpen] = React.useState(false)
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {Icon && (
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-(--accent-c)/12 text-(--accent-c) [&>svg]:size-3.5"
              style={{ "--accent-c": accent ?? "var(--muted-foreground)" } as React.CSSProperties}
            >
              <Icon aria-hidden />
            </span>
          )}
          {label}
          {hint && (
            <Tooltip open={hintOpen} onOpenChange={setHintOpen}>
              {/* 40px touch area below md; the negative margin keeps the layout */}
              <TooltipTrigger
                aria-label={`הסבר: ${label}`}
                className="max-md:-m-3.25 max-md:p-3.25"
                // Radix tooltips ignore touch and close on click; open on tap/click instead (tap outside closes)
                onClick={(e) => {
                  e.preventDefault()
                  setHintOpen(true)
                }}
              >
                <InfoIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{hint}</TooltipContent>
            </Tooltip>
          )}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {/* the invisible final text reserves the width so the ticker doesn't shift the layout */}
          <span className="grid">
            <span className="invisible col-start-1 row-start-1" aria-hidden>
              {text}
            </span>
            {typeof value === "number" ? (
              <NumberTicker value={value} format={format} aria-hidden className="col-start-1 row-start-1" />
            ) : (
              <span className="col-start-1 row-start-1">{text}</span>
            )}
          </span>
          {typeof value === "number" && <span className="sr-only">{text}</span>}
        </CardTitle>
        {gauge && progress != null && (
          <CardAction aria-hidden className="max-sm:hidden">
            <Gauge value={progress} />
          </CardAction>
        )}
      </CardHeader>
      {/* below sm the gauge crowds the label, so gauge cards fall back to the linear bar */}
      {progress != null && (
        <CardContent className={cn(gauge && "sm:hidden")}>
          <Progress value={progress} aria-label={`${label}: ${text}`} />
        </CardContent>
      )}
    </Card>
  )
}

function Gauge({ value }: { value: number }) {
  // start at 0 and set the value on the next frame so the CSS transition runs on mount
  const [shown, setShown] = React.useState(0)
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(value))
    return () => cancelAnimationFrame(raf)
  }, [value])
  return (
    <AnimatedCircularProgressBar
      value={shown}
      gaugePrimaryColor="var(--chart-1)"
      gaugeSecondaryColor="var(--muted)"
      className="size-12 text-[0.625rem]"
    />
  )
}
