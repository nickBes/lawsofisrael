import { Link, useParams } from "react-router"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { ChevronDownIcon, GavelIcon, LandmarkIcon, ScrollTextIcon, VoteIcon } from "lucide-react"

import { PageHeader } from "@/components/app-shell"
import { Caveat } from "@/components/caveat"
import { CONCEPT_EMPTY, ConceptCaveat, EvidenceLabel } from "@/components/concept-caveat"
import { QueryState } from "@/components/query-state"
import { ShowMore } from "@/components/show-more"
import { StatCard } from "@/components/stat-card"
import { VotesTable } from "@/components/votes-table"
import { Badge } from "@/components/ui/badge"
import { BlurFade } from "@/components/ui/blur-fade"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { partyColor } from "@/db/shared"
import { CHOICE_COLOR, fmtNum, pct100, pctTick } from "@/lib/labels"
import {
  useConcept,
  useConceptBills,
  useConceptContested,
  useConceptEvidence,
  useConceptParties,
  useConceptPartyKnesset,
  useConceptStages,
  useConceptYearly,
} from "./queries"

const partiesConfig = {
  for_share: { label: "בעד (%)", color: CHOICE_COLOR.for },
  against_share: { label: "נגד (%)", color: CHOICE_COLOR.against },
} satisfies ChartConfig
const yearlyConfig = {
  n_passed: { label: "עברו", color: "var(--chart-5)" },
  n_other: { label: "לא עברו", color: "var(--muted-foreground)" },
} satisfies ChartConfig

export function ConceptPage() {
  const id = useParams().id ?? ""
  const concept = useConcept(id)
  const parties = useConceptParties(id)
  const bills = useConceptBills(id)
  const contested = useConceptContested(id)
  const yearly = useConceptYearly(id)
  const partyKnesset = useConceptPartyKnesset(id)
  const stages = useConceptStages(id)
  const evidence = useConceptEvidence(id)
  const evidenceByBill = (evidence.data ?? []).reduce((m, e) => m.set(e.bill_id, [...(m.get(e.bill_id) ?? []), e]), new Map<number, { bullet: string }[]>())
  const c = concept.data?.[0]

  if (!c)
    return (
      <QueryState query={concept} className="h-64" empty="המושג לא נמצא">
        {() => null}
      </QueryState>
    )

  const nPassed = (bills.data ?? []).filter((b) => b.passed).length
  // counted = preliminary/first/third total row; opposition elsewhere explains an all-100% chart
  const counted = stages.data?.find((r) => r.stage == null && r.counted)
  const elsewhere = (stages.data ?? []).filter((r) => r.stage === "reservation" || r.stage === "second").reduce((a, r) => a + r.n_contested, 0)
  const consensusCaveat = counted?.n_contested === 0 && (
    <Caveat>
      אף ח״כ לא הצביע נגד בקריאות האלה, ולכן כל המפלגות ב-100%.
      {elsewhere > 0 && ` התנגדות הייתה רק בהצבעות על הסתייגויות או בקריאה שנייה (${fmtNum(elsewhere)} הצבעות).`}
    </Caveat>
  )

  return (
    <>
      <BlurFade inView>
        <PageHeader title={c.concept_label} description={c.concept_criterion}>
          {c.is_generic && <Badge variant="outline">מנגנון משפטי כללי</Badge>}
        </PageHeader>
      </BlurFade>
      <BlurFade inView delay={0.05}>
        <ConceptCaveat />
      </BlurFade>

      <BlurFade inView delay={0.1} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="הצעות חוק" value={c.n_bills} icon={ScrollTextIcon} accent="var(--chart-6)" />
        <StatCard
          label="עברו"
          value={bills.data ? nPassed : null}
          icon={GavelIcon}
          accent="var(--chart-5)"
          progress={bills.data && c.n_bills ? (100 * nPassed) / c.n_bills : undefined}
        />
        <StatCard label="הצבעות" value={c.n_votes} icon={VoteIcon} accent="var(--chart-1)" hint="הצבעות המליאה בכל שלבי ההצעות האלה, כולל הסתייגויות." />
        <StatCard label="כנסות" value={c.k_from === c.k_to ? `${c.k_from}` : `${c.k_from}–${c.k_to}`} icon={LandmarkIcon} accent="var(--chart-8)" />
      </BlurFade>

      <BlurFade inView delay={0.15}>
        <Card>
          <CardHeader>
            <CardTitle>📅 הצעות חוק לפי שנה</CardTitle>
            <CardDescription>לפי שנת ההצבעה הראשונה במליאה.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={yearly} className="h-56" {...CONCEPT_EMPTY}>
              {(rows) => (
                <ChartContainer config={yearlyConfig} className="h-56 w-full">
                  <BarChart data={rows}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} />
                    <YAxis orientation="right" width={32} allowDecimals={false} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="n_passed" stackId="a" fill="var(--color-n_passed)" />
                    <Bar dataKey="n_other" stackId="a" fill="var(--color-n_other)" />
                  </BarChart>
                </ChartContainer>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView delay={0.2}>
        <Card>
          <CardHeader>
            <CardTitle>🗳️ איך כל מפלגה הצביעה על הצעות אלה</CardTitle>
            <CardDescription>
              חלק ההצבעות "בעד" מתוך ההצבעות בעד ונגד של חברי כל מפלגה (נמנעים לא נספרים), בקריאה טרומית, ראשונה ושלישית, בכל הכנסות. הצבעות על
              הסתייגויות ובקריאה שנייה לא נספרות.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {counted && (
              <p className="text-sm text-muted-foreground">
                נספרו {fmtNum(counted.n_votes)} הצבעות על {fmtNum(counted.n_bills)} הצעות חוק; ב-{fmtNum(counted.n_contested)} מהן הצביע מישהו נגד.
              </p>
            )}
            {consensusCaveat}
            <QueryState query={parties} className="h-80" {...CONCEPT_EMPTY}>
              {(rows) => (
                <ChartContainer config={partiesConfig} className="w-full" style={{ height: rows.length * 32 + 40 }}>
                  <BarChart
                    data={rows.map((r) => ({ ...r, for_share: pct100(r.for_share), against_share: 100 - (pct100(r.for_share) ?? 0) }))}
                    layout="vertical"
                    margin={{ left: 8, right: 8 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" reversed domain={[0, 100]} tickFormatter={pctTick} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="party_name" orientation="right" width={110} tickLine={false} axisLine={false} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(label, payload) => {
                            const r = payload[0]?.payload as (typeof rows)[number] | undefined
                            return (
                              <div className="flex flex-col gap-0.5">
                                {label}
                                {r && (
                                  <span className="font-normal text-muted-foreground">
                                    {fmtNum(r.n_for)} בעד · {fmtNum(r.n_against)} נגד · {fmtNum(r.n_votes)} הצבעות
                                  </span>
                                )}
                              </div>
                            )
                          }}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="for_share" stackId="a" fill="var(--color-for_share)" />
                    <Bar dataKey="against_share" stackId="a" fill="var(--color-against_share)" />
                  </BarChart>
                </ChartContainer>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>🔀 עמדת המפלגות לאורך הכנסות</CardTitle>
            <CardDescription>
              שיעור (%) ההצבעות "בעד" בכל כנסת, לשש המפלגות שהצביעו הכי הרבה על הצעות אלה. אותה הגדרה כמו בתרשים למעלה.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {consensusCaveat}
            <QueryState query={partyKnesset} className="h-64" {...CONCEPT_EMPTY}>
              {(rows) => <PartyKnessetChart rows={rows} />}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>הצעות החוק</CardTitle>
            <CardDescription>מהחדשה לישנה. לחיצה על שם ההצעה פותחת את ההצבעה האחרונה על ההצעה, עם כל המסלול שלה.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={bills} {...CONCEPT_EMPTY}>
              {(rows) => (
                <ShowMore
                  items={rows}
                  render={(b) => {
                    // rows come primary first (CONCEPT_EVIDENCE_SQL order)
                    const [primary, ...others] = evidenceByBill.get(b.bill_id) ?? []
                    return (
                      // not a whole-row link: the item holds a ShowMore toggle
                      <Item variant="outline" size="sm">
                        <ItemContent className="min-w-0">
                          <ItemTitle className="line-clamp-2">
                            {b.last_vote_id == null ? (
                              b.name
                            ) : (
                              <Link to={`/vote/${b.last_vote_id}`} className="hover:underline">
                                {b.name}
                              </Link>
                            )}
                          </ItemTitle>
                          <ItemDescription>
                            הכנסת ה-{b.knesset_num} · {b.proposal_type}
                          </ItemDescription>
                          {primary && (
                            <div className="flex flex-col gap-1 pt-1">
                              <EvidenceLabel />
                              <p className="text-sm">{primary.bullet}</p>
                              <ShowMore
                                items={others}
                                initial={0}
                                render={(e) => (
                                  <Item size="xs" variant="muted">
                                    <ItemContent>
                                      <p className="text-sm">{e.bullet}</p>
                                    </ItemContent>
                                  </Item>
                                )}
                              />
                            </div>
                          )}
                        </ItemContent>
                        <ItemActions className="self-start">
                          {b.passed ? (
                            <Badge>
                              <GavelIcon data-icon="inline-start" aria-hidden />
                              עבר
                            </Badge>
                          ) : (
                            <Badge variant="outline">לא עבר</Badge>
                          )}
                        </ItemActions>
                      </Item>
                    )
                  }}
                />
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Collapsible>
          <Card>
            <CardHeader>
              <CardTitle>הצבעות שנויות במחלוקת</CardTitle>
              <CardDescription>הצבעות על הצעות אלה שבהן הצביעו נגד 10 ח״כים או יותר.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="self-start">
                  הצגה ({fmtNum(contested.data?.length ?? 0)})
                  <ChevronDownIcon data-icon="inline-end" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <QueryState query={contested} empty="אין הצבעות שנויות במחלוקת" description="כל ההצבעות על הצעות אלה עברו עם פחות מ-10 מתנגדים.">
                  {(rows) => <VotesTable rows={rows} />}
                </QueryState>
              </CollapsibleContent>
            </CardContent>
          </Card>
        </Collapsible>
      </BlurFade>
    </>
  )
}

type PartyKnessetRow = NonNullable<ReturnType<typeof useConceptPartyKnesset>["data"]>[number]

// one line per party across Knessets; a single Knesset has nothing to compare
function PartyKnessetChart({ rows }: { rows: PartyKnessetRow[] }) {
  const byK = Object.values(
    rows.reduce<Record<number, Record<string, number | null>>>((acc, r) => {
      const k = (acc[r.knesset_num] ??= { knesset_num: r.knesset_num })
      k[r.party_id] = pct100(r.for_share)
      return acc
    }, {})
  )
  if (byK.length < 2)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LandmarkIcon />
          </EmptyMedia>
          <EmptyTitle>המושג הופיע בכנסת אחת בלבד</EmptyTitle>
          <EmptyDescription>ראו את התרשים למעלה.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  const partyList = [...new Map(rows.map((r) => [r.party_id, r])).values()]
  const config: ChartConfig = Object.fromEntries(partyList.map((p) => [p.party_id, { label: p.party_name, color: partyColor(p.color_index) }]))
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <LineChart data={byK}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="knesset_num" tickFormatter={(k) => `ה-${k}`} padding={{ left: 24, right: 24 }} tickLine={false} axisLine={false} />
        <YAxis orientation="right" domain={[0, 100]} tickFormatter={pctTick} width={44} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {partyList.map((p) => (
          <Line key={p.party_id} dataKey={p.party_id} stroke={partyColor(p.color_index)} strokeWidth={2} dot connectNulls={false} />
        ))}
      </LineChart>
    </ChartContainer>
  )
}
