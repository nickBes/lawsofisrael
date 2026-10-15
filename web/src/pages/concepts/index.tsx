import * as React from "react"
import { Link, useSearchParams } from "react-router"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChevronDownIcon, LandmarkIcon, LightbulbIcon, ScrollTextIcon, SearchIcon, TrendingDownIcon, TrendingUpIcon, type LucideIcon } from "lucide-react"

import { PageHeader } from "@/components/app-shell"
import { CONCEPT_EMPTY, ConceptCaveat } from "@/components/concept-caveat"
import { QueryState } from "@/components/query-state"
import { ShowMore } from "@/components/show-more"
import { SplitBar } from "@/components/split-bar"
import { StatCard } from "@/components/stat-card"
import { BlurFade } from "@/components/ui/blur-fade"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { MagicCard } from "@/components/ui/magic-card"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtNum, fmtPct } from "@/lib/labels"
import { useConceptsList, useConceptsSummary, useConceptsTrend, useConceptsYearly, type ConceptListRow } from "./queries"

type TrendRow = NonNullable<ReturnType<typeof useConceptsTrend>["data"]>[number]

export function ConceptsPage() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get("q") ?? ""
  const term = React.useDeferredValue(q.trim())
  const summary = useConceptsSummary()
  const list = useConceptsList(false, term)
  const generic = useConceptsList(true, term)
  const yearly = useConceptsYearly()
  const trend = useConceptsTrend()
  const s = summary.data?.[0]
  const t = trend.data?.[0]
  const empty = term ? { empty: "לא נמצאו מושגים", description: "נסו מילה אחרת." } : CONCEPT_EMPTY

  // one row per year with c1..c5 = bills of the concept ranked 1..5
  const yearRows = Object.values(
    (yearly.data ?? []).reduce<Record<number, Record<string, number>>>((acc, r) => {
      const y = (acc[r.year] ??= { year: r.year })
      y[`c${r.rn}`] = r.n_bills
      return acc
    }, {})
  )
  const top = [...new Map((yearly.data ?? []).map((r) => [r.rn, r])).values()].sort((a, b) => a.rn - b.rn)
  const yearlyConfig: ChartConfig = Object.fromEntries(
    top.map((r) => [`c${r.rn}`, { label: r.concept_label, color: `var(--chart-${r.rn})` }])
  )

  return (
    <>
      <BlurFade inView>
        <PageHeader title="מושגים" description="מה הצעות החוק עושות בפועל: מושגים משפטיים שחולצו מנוסח ההצעות, ואיך הצביעו עליהם." />
      </BlurFade>
      <BlurFade inView delay={0.05}>
        <ConceptCaveat />
      </BlurFade>

      <BlurFade inView delay={0.1} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {s ? (
          <>
            <StatCard label="מושגים" value={s.n_concepts} icon={LightbulbIcon} accent="var(--chart-9)" hint="בלי מנגנונים משפטיים כלליים." />
            <StatCard label="הצעות חוק עם מושגים" value={s.n_bills} icon={ScrollTextIcon} accent="var(--chart-6)" />
            <StatCard label="כנסות" value={s.k_from == null ? null : `${s.k_from}–${s.k_to}`} icon={LandmarkIcon} accent="var(--chart-8)" />
          </>
        ) : (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)
        )}
      </BlurFade>

      <BlurFade inView delay={0.15}>
        <Card>
          <CardHeader>
            <CardTitle>💡 מושגים לאורך השנים</CardTitle>
            <CardDescription>מספר הצעות החוק בכל שנה (לפי ההצבעה הראשונה) לחמשת המושגים הנפוצים.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <QueryState query={yearly} className="h-64" {...CONCEPT_EMPTY}>
              {() => (
                <>
                  <ChartContainer config={yearlyConfig} className="h-64 w-full">
                    <BarChart data={yearRows}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="year" tickLine={false} axisLine={false} />
                      <YAxis orientation="right" width={32} allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent className="max-w-80" />} />
                      {top.map((r) => (
                        <Bar key={r.rn} dataKey={`c${r.rn}`} stackId="a" fill={`var(--color-c${r.rn})`} />
                      ))}
                    </BarChart>
                  </ChartContainer>
                  {/* labels are long sentences, so the legend is a list of links instead of ChartLegend */}
                  <ItemGroup className="gap-1">
                    {top.map((r) => (
                      <Item key={r.rn} size="sm" asChild>
                        <Link to={`/concept/${r.concept_id}`}>
                          <ItemMedia>
                            <span className="size-2.5 rounded-full" style={{ background: `var(--chart-${r.rn})` }} />
                          </ItemMedia>
                          <ItemContent className="min-w-0">
                            <ItemTitle className="line-clamp-2">{r.concept_label}</ItemTitle>
                          </ItemContent>
                        </Link>
                      </Item>
                    ))}
                  </ItemGroup>
                </>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView delay={0.2} className="grid gap-4 lg:grid-cols-2">
        {[
          { title: "📈 מושגים בעלייה", icon: TrendingUpIcon, rows: (trend.data ?? []).filter((r) => r.delta > 0).slice(0, 5) },
          { title: "📉 מושגים בירידה", icon: TrendingDownIcon, rows: (trend.data ?? []).filter((r) => r.delta < 0).toReversed().slice(0, 5) },
        ].map((c) => (
          <Card key={c.title}>
            <CardHeader>
              <CardTitle>{c.title}</CardTitle>
              {t && <CardDescription>בין הכנסת ה-{t.k1} לכנסת ה-{t.k2}, לפי חלקם מתוך הצעות החוק עם מושגים בכל כנסת.</CardDescription>}
            </CardHeader>
            <CardContent>
              <QueryState
                query={trend}
                className="h-64"
                empty="💡 אין עדיין מספיק מושגים להשוואה"
                description="ההשוואה דורשת לפחות שתי כנסות עם 50 הצעות חוק עם מושגים לפחות."
              >
                {() => <TrendList rows={c.rows} icon={c.icon} />}
              </QueryState>
            </CardContent>
          </Card>
        ))}
      </BlurFade>

      <BlurFade inView>
        <Field className="max-w-md">
          <FieldLabel htmlFor="concepts-q">חיפוש מושג</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="concepts-q"
              value={q}
              onChange={(e) =>
                setSp(
                  (prev) => {
                    if (e.target.value) prev.set("q", e.target.value)
                    else prev.delete("q")
                    return prev
                  },
                  { replace: true }
                )
              }
              placeholder="למשל: שכר דירה"
            />
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </BlurFade>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>המושגים הנפוצים</CardTitle>
            <CardDescription>לפי מספר הצעות החוק. הפס מראה כמה מההצעות עברו.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={list} className="h-96" {...empty}>
              {(rows) => <ShowMore items={rows} initial={15} render={(c) => <ConceptRow c={c} />} />}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Collapsible>
          <Card>
            <CardHeader>
              <CardTitle>מנגנונים משפטיים כלליים</CardTitle>
              <CardDescription>מושגים שמופיעים בהצעות חוק מתחומים רבים (עונשים, תקנות, מועדי תחילה). הם לא נכללים בניתוחים.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="self-start">
                  הצגה ({fmtNum(generic.data?.length ?? 0)})
                  <ChevronDownIcon data-icon="inline-end" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <QueryState query={generic} {...empty}>
                  {(rows) => (
                    <ItemGroup className="gap-2">
                      {rows.map((c) => (
                        <ConceptRow key={c.concept_id} c={c} />
                      ))}
                    </ItemGroup>
                  )}
                </QueryState>
              </CollapsibleContent>
            </CardContent>
          </Card>
        </Collapsible>
      </BlurFade>
    </>
  )
}

function TrendList({ rows, icon: Icon }: { rows: TrendRow[]; icon: LucideIcon }) {
  if (!rows.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>אין מושגים בכיוון הזה</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  return (
    <ItemGroup className="gap-2">
      {rows.map((r) => (
        <Item key={r.concept_id} variant="outline" size="sm" asChild>
          <Link to={`/concept/${r.concept_id}`}>
            <ItemMedia variant="icon">
              <Icon aria-hidden />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="line-clamp-2">{r.concept_label}</ItemTitle>
              <ItemDescription>
                מ-{fmtNum(r.n1)} ל-{fmtNum(r.n2)} הצעות · מ-{fmtPct(r.share1)} ל-{fmtPct(r.share2)}
              </ItemDescription>
            </ItemContent>
          </Link>
        </Item>
      ))}
    </ItemGroup>
  )
}

function ConceptRow({ c }: { c: ConceptListRow }) {
  return (
    <MagicCard className="rounded-lg">
      <Item size="sm" asChild>
        <Link to={`/concept/${c.concept_id}`}>
          <ItemMedia variant="icon">
            <LightbulbIcon aria-hidden />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="line-clamp-2">{c.concept_label}</ItemTitle>
            <ItemDescription>
              {fmtNum(c.n_bills)} הצעות חוק · {fmtNum(c.n_votes)} הצבעות · <span className="whitespace-nowrap">{c.k_from === c.k_to ? `הכנסת ה-${c.k_from}` : `כנסות ${c.k_from}–${c.k_to}`}</span>
            </ItemDescription>
            <SplitBar
              segments={[
                { key: "passed", label: "עברו", value: c.n_passed, color: "var(--chart-5)" },
                { key: "not_passed", label: "לא עברו", value: c.n_bills - c.n_passed, color: "var(--muted-foreground)" },
              ]}
            />
          </ItemContent>
        </Link>
      </Item>
    </MagicCard>
  )
}
