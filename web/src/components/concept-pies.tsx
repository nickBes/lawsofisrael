import { Label, Pie, PieChart } from "recharts"

import { ShowMore } from "@/components/show-more"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { CHOICE_COLOR, CHOICE_ICON, fmtNum, fmtPct } from "@/lib/labels"

export type ConceptPieRow = {
  concept_id: string
  concept_label: string
  n_votes: number
  a_share: number
  a_for: number
  a_against: number
  b_share: number
  b_for: number
  b_against: number
}

const TOP = 6 // list rows before "show all"
const MIN_SLICE = 0.03 // own slice from 3% (~11°): smaller ones are hard to see and hover
// --chart-4/5 already mean against/for (CHOICE_COLOR), so concepts get the other 10 colours, one named slice each
const SLICE_COLORS = [1, 2, 3, 6, 7, 8, 9, 10, 11, 12].map((n) => `var(--chart-${n})`)
const OTHER = "var(--muted-foreground)"
type Slice = { key: string; label: string; value: number; fill: string; row?: ConceptPieRow }

// same concept -> same colour in both pies; over the cap, the most-voted concepts keep a colour and the rest fall into "אחר"
function sliceColors(named: ConceptPieRow[]) {
  const union = [...new Map(named.map((r) => [r.concept_id, r])).values()].sort((x, y) => y.a_for + y.a_against - (x.a_for + x.a_against))
  return new Map(union.slice(0, SLICE_COLORS.length).map((r, i) => [r.concept_id, SLICE_COLORS[i]]))
}

function pieSlices(sorted: ConceptPieRow[], k: "a_for" | "a_against", big: ConceptPieRow[], color: Map<string, string>): Slice[] {
  const named = big.filter((r) => color.has(r.concept_id))
  const slices: Slice[] = named.map((r) => ({ key: r.concept_id, label: r.concept_label, value: r[k], fill: color.get(r.concept_id)!, row: r }))
  const rest = sorted.reduce((n, r) => n + r[k], 0) - named.reduce((n, r) => n + r[k], 0)
  if (rest) slices.push({ key: "other", label: "אחר", value: rest, fill: OTHER })
  return slices
}

const ChoiceIcon = ({ choice }: { choice: "for" | "against" }) => {
  const Icon = CHOICE_ICON[choice]
  return <Icon aria-hidden className="size-3.5 shrink-0" style={{ color: CHOICE_COLOR[choice] }} />
}

// Two donuts: each concept's share of all for (against) ballots in `rows`, plus a per-concept list with the exact counts.
// A ballot on a bill with several concepts counts once per concept. `compare` (MK page) labels b_share in the list.
export function ConceptPies({
  rows,
  onSelect,
  compare,
}: {
  rows: ConceptPieRow[]
  onSelect: (r: ConceptPieRow) => void
  compare?: string
}) {
  const sides = (["for", "against"] as const).map((choice) => {
    const k = choice === "for" ? ("a_for" as const) : ("a_against" as const)
    const sorted = rows.filter((r) => r[k] > 0).sort((x, y) => y[k] - x[k])
    const total = sorted.reduce((n, r) => n + r[k], 0)
    const big = sorted.filter((r) => r[k] >= MIN_SLICE * total)
    return { choice, k, sorted, total, big, title: choice === "for" ? "מושגים שהצביע/ה בעד" : "מושגים שהצביע/ה נגד" }
  })
  const color = sliceColors(sides.flatMap((s) => s.big))
  const listed = [...rows].sort((x, y) => Number(color.has(y.concept_id)) - Number(color.has(x.concept_id)))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {sides.map(({ choice, k, sorted, total, big, title }) => {
          const slices = pieSlices(sorted, k, big, color)
          return (
            <div key={choice} className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <ChoiceIcon choice={choice} />
                {title}
              </div>
              {total ? (
                <>
                  <div role="img" aria-label={`${title}: ${fmtNum(total)} קולות. הנתונים ברשימה שאחריו.`} className="w-full">
                    <ChartContainer config={{}} className="mx-auto aspect-square max-h-64">
                      <PieChart>
                        <ChartTooltip content={({ active, payload }) => active && payload?.[0] && <SliceTip s={payload[0].payload} total={total} choice={choice} />} />
                        <Pie
                          data={slices}
                          dataKey="value"
                          nameKey="label"
                          innerRadius="55%"
                          strokeWidth={2}
                          className="cursor-pointer"
                          onClick={(d) => (d.payload as Slice).row && onSelect((d.payload as Slice).row!)}
                        >
                          <Label
                            content={({ viewBox }) =>
                              viewBox && "cx" in viewBox && (
                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                  <tspan x={viewBox.cx} className="fill-foreground text-2xl font-bold">
                                    {fmtNum(total)}
                                  </tspan>
                                  <tspan x={viewBox.cx} dy={22} className="fill-muted-foreground">
                                    קולות
                                  </tspan>
                                </text>
                              )
                            }
                          />
                        </Pie>
                      </PieChart>
                    </ChartContainer>
                  </div>
                  <ul className="sr-only">
                    {slices.map((s) => (
                      <li key={s.key}>
                        {s.label}: {fmtNum(s.value)} ({fmtPct(s.value / total)})
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <Empty className="w-full border">
                  <EmptyHeader>
                    <EmptyTitle>אין קולות</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          )
        })}
      </div>
      <ShowMore
        items={listed}
        initial={TOP}
        render={(r) => (
          <Item variant="outline" size="sm" asChild>
            <button type="button" className="w-full text-start" onClick={() => onSelect(r)}>
              <span aria-hidden className="size-2.5 shrink-0 self-start rounded-full mt-1" style={{ background: color.get(r.concept_id) ?? OTHER }} />
              <ItemContent className="min-w-0">
                <ItemTitle className="line-clamp-none">{r.concept_label}</ItemTitle>
                <ItemDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                  <span className="flex items-center gap-1">
                    <ChoiceIcon choice="for" />
                    {fmtNum(r.a_for)} בעד
                  </span>
                  <span className="flex items-center gap-1">
                    <ChoiceIcon choice="against" />
                    {fmtNum(r.a_against)} נגד
                  </span>
                  {compare && (
                    <span>
                      {compare}: {fmtPct(r.b_share)} בעד
                    </span>
                  )}
                </ItemDescription>
              </ItemContent>
            </button>
          </Item>
        )}
      />
    </div>
  )
}

function SliceTip({ s, total, choice }: { s: Slice; total: number; choice: "for" | "against" }) {
  return (
    <div className="grid max-w-[min(18rem,calc(100vw-8rem))] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{s.label}</div>
      <span className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
        <ChoiceIcon choice={choice} />
        <span className="text-foreground">{fmtNum(s.value)}</span> {choice === "for" ? "בעד" : "נגד"} · {fmtPct(s.value / total)}
      </span>
    </div>
  )
}
