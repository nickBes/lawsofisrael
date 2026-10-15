import { BanIcon, CircleCheckIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { STAGE_ICON, STAGE_LABEL } from "@/lib/labels"

export function StageBadge({ stage }: { stage: string }) {
  const Icon = STAGE_ICON[stage]
  return (
    <Badge variant="outline">
      {Icon && <Icon data-icon="inline-start" aria-hidden />}
      {STAGE_LABEL[stage] ?? stage}
    </Badge>
  )
}

// official vote result; null when the source has none
export function ResultBadge({ accepted }: { accepted: boolean | null }) {
  if (accepted == null) return null
  return accepted ? (
    <Badge>
      <CircleCheckIcon data-icon="inline-start" aria-hidden />
      התקבל
    </Badge>
  ) : (
    <Badge variant="secondary">
      <BanIcon data-icon="inline-start" aria-hidden />
      נדחה
    </Badge>
  )
}
