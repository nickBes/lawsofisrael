import {
  CircleMinusIcon,
  EyeIcon,
  FilePenIcon,
  FileTextIcon,
  GavelIcon,
  MegaphoneIcon,
  MessageSquareWarningIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  SproutIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserXIcon,
  type LucideIcon,
} from "lucide-react"

import type { ChartConfig } from "@/components/ui/chart"

export const STAGE_LABEL: Record<string, string> = {
  preliminary: "טרומית",
  first: "ראשונה",
  second: "שנייה",
  third: "שלישית",
  reservation: "הסתייגות",
  motion: "הצעה לסדר היום",
  no_confidence: "אי-אמון",
  regulation: "תקנות והודעות",
  other: "אחר",
}

export const CHOICE_LABEL: Record<string, string> = {
  for: "בעד",
  against: "נגד",
  abstain: "נמנע",
  present: "נוכח",
  absent: "נעדר",
  other: "אחר",
}

export const STAGE_ICON: Record<string, LucideIcon> = {
  preliminary: SproutIcon,
  first: FileTextIcon,
  second: FilePenIcon,
  third: GavelIcon,
  reservation: MessageSquareWarningIcon,
  motion: MegaphoneIcon,
  no_confidence: ShieldAlertIcon,
  regulation: ScrollTextIcon,
}

export const CHOICE_ICON: Record<string, LucideIcon> = {
  for: ThumbsUpIcon,
  against: ThumbsDownIcon,
  abstain: CircleMinusIcon,
  present: EyeIcon,
  absent: UserXIcon,
}

export const CHOICE_COLOR: Record<string, string> = {
  for: "var(--chart-5)",
  against: "var(--chart-4)",
  abstain: "var(--chart-9)",
  present: "var(--chart-6)",
  absent: "var(--muted-foreground)",
}

// official for / against / abstain tallies as SplitBar segments
export const tallySegments = (v: { n_for: number; n_against: number; n_abstain: number }) => [
  { key: "for", label: "בעד", value: v.n_for, color: CHOICE_COLOR.for },
  { key: "against", label: "נגד", value: v.n_against, color: CHOICE_COLOR.against },
  { key: "abstain", label: "נמנע", value: v.n_abstain, color: CHOICE_COLOR.abstain },
]

export const choiceChartConfig = {
  n_for: { label: "בעד", color: CHOICE_COLOR.for },
  n_against: { label: "נגד", color: CHOICE_COLOR.against },
  n_abstain: { label: "נמנע", color: CHOICE_COLOR.abstain },
  n_present: { label: "נוכח", color: CHOICE_COLOR.present },
  n_absent: { label: "נעדר", color: CHOICE_COLOR.absent },
} satisfies ChartConfig

export const KNESSETS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
export const SMALL_KNESSETS = [21, 22] // 16 and 86 votes only

const num = new Intl.NumberFormat("he-IL")
export const fmtNum = (n: number | null | undefined) => (n == null ? "—" : num.format(n))
export const fmtVotes = (n: number) => (n === 1 ? "הצבעה אחת" : `${fmtNum(n)} הצבעות`)
// Shares as whole percents for charts (the shadcn tooltip prints raw values).
export const pct100 = (x: number | null) => (x == null ? null : Math.round(x * 100))
export const pctTick = (v: unknown) => `${v}%`
export const fmtPct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`)
// Dates come from SQL as ISO 'YYYY-MM-DD' strings.
export const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—")

// avatar initials: first letter of the first two words
export const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")

export const billUrl = (billId: number) =>
  `https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid=${billId}`
