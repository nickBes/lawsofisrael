import { type ComponentPropsWithoutRef } from "react"

import { cn } from "@/lib/utils"

export interface AnimatedGradientTextProps extends ComponentPropsWithoutRef<"span"> {
  speed?: number
  colorFrom?: string
  colorTo?: string
}

export function AnimatedGradientText({
  children,
  className,
  speed = 1,
  colorFrom = "var(--chart-1)",
  colorTo = "var(--chart-8)",
  ...props
}: AnimatedGradientTextProps) {
  return (
    <span
      style={
        {
          "--bg-size": `${speed * 300}%`,
          "--color-from": colorFrom,
          "--color-to": colorTo,
        } as React.CSSProperties
      }
      className={cn(
        `animate-gradient motion-reduce:animate-none inline bg-linear-to-r from-(--color-from) via-(--color-to) to-(--color-from) bg-size-[var(--bg-size)_100%] bg-clip-text text-transparent`,
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
