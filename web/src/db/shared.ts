import type { ChartConfig } from "@/components/ui/chart"
import { useSql } from "./useSql"

export const SEARCH_SQL = /* sql */ `
SELECT kind, id, label FROM search_index WHERE label ILIKE '%' || ? || '%' ORDER BY kind, length(label) LIMIT 30`

export const PARTIES_SQL = /* sql */ `
SELECT party_id, party_name, color_index FROM parties ORDER BY party_name`

export const TOPICS_SQL = /* sql */ `
SELECT topic_id, topic_name FROM topics ORDER BY topic_name`

export type Party = { party_id: string; party_name: string; color_index: number }
export type Topic = { topic_id: string; topic_name: string }

export const useParties = () => useSql<Party>("parties", PARTIES_SQL)
export const useTopics = () => useSql<Topic>("topics", TOPICS_SQL)

export const partyColor = (colorIndex: number) => `var(--chart-${colorIndex})`

// Chart config keyed by party_id, colors from the theme.
export const partyChartConfig = (parties: Party[] = []): ChartConfig =>
  Object.fromEntries(parties.map((p) => [p.party_id, { label: p.party_name, color: partyColor(p.color_index) }]))
