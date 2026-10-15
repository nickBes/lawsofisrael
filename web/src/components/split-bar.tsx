import type * as React from "react"

import { cn } from "@/lib/utils"
import { fmtNum } from "@/lib/labels"

export type Segment = { key: string; label: string; value: number; color: string }

// One stacked horizontal bar (HTML, so it wraps and flips with RTL), with an optional legend.
export function SplitBar({
  segments,
  legend = false,
  format = fmtNum,
  className,
  ...props
}: { segments: Segment[]; legend?: boolean; format?: (n: number) => string } & React.ComponentProps<"div">) {
  const summary = segments.map((s) => `${s.label} ${format(s.value)}`).join(", ")
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
      <div role="img" aria-label={summary} className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {segments.map((s) => (
          <div key={s.key} style={{ flexGrow: s.value, background: s.color }} />
        ))}
      </div>
      {legend && (
        <div aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {segments.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
              {s.label}
              <span className="font-medium text-foreground tabular-nums">{format(s.value)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
