import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"

import { cn } from "@/lib/utils"

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Optional CSS class name to apply custom styles
   */
  className?: string
  /**
   * Whether to reverse the animation direction
   * @default false
   */
  reverse?: boolean
  /**
   * Whether to pause the animation on hover
   * @default false
   */
  pauseOnHover?: boolean
  /**
   * Content to be displayed in the marquee
   */
  children: React.ReactNode
  /**
   * Whether to animate vertically instead of horizontally
   * @default false
   */
  vertical?: boolean
  /**
   * Number of times to repeat the content
   * @default 4
   */
  repeat?: number
  /**
   * Speed in px/s; sets --duration from the measured copy size so speed does not depend on content length
   */
  speed?: number
}

export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  speed,
  ...props
}: MarqueeProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    const copy = root?.firstElementChild as HTMLElement | null
    if (!root || !copy || !speed) return
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(root)
      const size = vertical ? copy.offsetHeight : copy.offsetWidth
      const gap = parseFloat(vertical ? cs.rowGap : cs.columnGap) || 0
      // one keyframe cycle moves one copy plus the gap
      root.style.setProperty("--duration", `${(size + gap) / speed}s`)
    })
    ro.observe(copy)
    return () => ro.disconnect()
  }, [speed, vertical])

  return (
    <div
      {...props}
      ref={ref}
      className={cn(
        // rtl: copies are laid out right-to-left, so the keyframe must move them rightward
        "group flex gap-(--gap) overflow-hidden p-2 [--duration:40s] [--gap:1rem] rtl:[--marquee-dir:-1] motion-reduce:overflow-x-auto",
        {
          "flex-row": !vertical,
          "flex-col": vertical,
        },
        className
      )}
    >
      {Array(repeat)
        .fill(0)
        .map((_, i) => (
          <div
            key={i}
            // copies after the first are visual filler only: hidden from AT and focus, dropped when motion is reduced
            inert={i > 0}
            aria-hidden={i > 0 || undefined}
            className={cn("flex shrink-0 justify-around gap-(--gap) motion-reduce:animate-none", {
              "animate-marquee flex-row": !vertical,
              "animate-marquee-vertical flex-col": vertical,
              "group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]": pauseOnHover,
              "[animation-direction:reverse]": reverse,
              "motion-reduce:hidden": i > 0,
            })}
          >
            {children}
          </div>
        ))}
    </div>
  )
}
