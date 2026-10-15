import { Badge } from "@/components/ui/badge"
import { CHOICE_ICON, CHOICE_LABEL } from "@/lib/labels"

const VARIANT = { for: "default", against: "destructive", abstain: "secondary" } as const

export function ChoiceBadge({ choice }: { choice: string }) {
  const Icon = CHOICE_ICON[choice]
  return (
    <Badge variant={VARIANT[choice as keyof typeof VARIANT] ?? "outline"}>
      {Icon && <Icon data-icon="inline-start" aria-hidden />}
      {CHOICE_LABEL[choice] ?? choice}
    </Badge>
  )
}
