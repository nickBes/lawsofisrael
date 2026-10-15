import { LandmarkIcon, MegaphoneIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"

// share of the party's votes cast while it was in the coalition (curated table)
export function CoalitionBadge({ share }: { share: number | null }) {
  if (share == null) return null
  if (share >= 0.95)
    return (
      <Badge>
        <LandmarkIcon data-icon="inline-start" aria-hidden />
        קואליציה
      </Badge>
    )
  if (share <= 0.05)
    return (
      <Badge variant="outline">
        <MegaphoneIcon data-icon="inline-start" aria-hidden />
        אופוזיציה
      </Badge>
    )
  return <Badge variant="secondary">קואליציה בחלק מהתקופה</Badge>
}
