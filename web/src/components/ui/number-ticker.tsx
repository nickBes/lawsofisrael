import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react"

import { cn } from "@/lib/utils"

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  format: (n: number) => string
  startValue?: number
  direction?: "up" | "down"
  delay?: number
}

export function NumberTicker({
  value,
  format,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  // MotionConfig reducedMotion doesn't cover springs driven by .set(), so check it here too
  const reduce = useReducedMotion()
  const motionValue = useMotionValue(direction === "down" ? value : startValue)
  // critically damped: the registry's damping 60 crawls for ~9 s on values in the millions
  const springValue = useSpring(motionValue, {
    damping: 20,
    stiffness: 100,
  })
  const isInView = useInView(ref, { once: true, margin: "0px" })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const target = direction === "down" ? startValue : value

    if (reduce) {
      motionValue.jump(target)
      springValue.jump(target)
    } else if (isInView) {
      timer = setTimeout(() => {
        motionValue.set(target)
      }, delay * 1000)
    }

    return () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [motionValue, springValue, reduce, isInView, delay, value, direction, startValue])

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) {
          ref.current.textContent = format(latest)
        }
      }),
    [springValue, format]
  )

  return (
    <span
      ref={ref}
      className={cn("inline-block tabular-nums", className)}
      {...props}
    >
      {format(reduce ? (direction === "down" ? startValue : value) : direction === "down" ? value : startValue)}
    </span>
  )
}
