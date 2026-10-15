import { useEffect, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion, type MotionProps } from "motion/react"

import { cn } from "@/lib/utils"

interface WordRotateProps {
  words: string[]
  duration?: number
  motionProps?: MotionProps
  className?: string
  /** Renders each word inside the moving element, e.g. clipped-gradient text, which must not wrap it from outside. */
  children?: (word: string) => ReactNode
}

// Inline (span) so it can sit inside a heading.
export function WordRotate({
  words,
  duration = 2500,
  // em travel: the clip box is one line tall, so ±50px slid the word out of view almost at once
  motionProps = {
    initial: { opacity: 0, y: "-0.6em" },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: "0.6em" },
    transition: { duration: 0.4, ease: "easeOut" },
  },
  className,
  children,
}: WordRotateProps) {
  const [index, setIndex] = useState(0)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (reduce) return
    const interval = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % words.length)
    }, duration)

    // Clean up interval on unmount
    return () => clearInterval(interval)
  }, [words, duration, reduce])

  const word = words[reduce ? 0 : index]
  // overflow-clip is not a scroll container, so the box keeps the word's baseline (overflow-hidden would not)
  return (
    <span className="inline-flex overflow-y-clip align-baseline">
      <AnimatePresence mode="wait">
        <motion.span key={word} className={cn("inline-block", className)} {...motionProps}>
          {children ? children(word) : word}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
