import * as React from "react"
import { useInView } from "motion/react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { initials } from "@/lib/labels"

// shortcut: full-size Knesset portraits (~60–130 kB each) are hotlinked; serve resized thumbnails if page weight becomes a problem
export function MkAvatar({
  name,
  photoUrl,
  className,
  size,
}: {
  name: string
  photoUrl?: string | null
  className?: string
  size?: "default" | "sm" | "lg"
}) {
  const ref = React.useRef<HTMLSpanElement>(null)
  // Radix preloads AvatarImage on mount and ignores loading="lazy"; mount the image only once the avatar is near the viewport
  const seen = useInView(ref, { once: true, margin: "200px" })
  return (
    <Avatar ref={ref} size={size} className={className}>
      {seen && photoUrl && <AvatarImage src={photoUrl} alt={name} loading="lazy" className="object-top" />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
