import * as React from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { ChevronDownIcon, GavelIcon, HandshakeIcon, ScrollTextIcon, TimerIcon } from "lucide-react"

import { PageHeader } from "@/components/app-shell"
import { Caveat } from "@/components/caveat"
import { KnessetSelect, useKnesset } from "@/components/knesset-select"
import { QueryState } from "@/components/query-state"
import { StatCard } from "@/components/stat-card"
import { BlurFade } from "@/components/ui/blur-fade"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmtNum, fmtPct, pct100, pctTick } from "@/lib/labels"
import { useLawsByYear, useLawsConsensus, useLawsFunnel, useLawsTime } from "./queries"

const TYPES = { פרטית: "type_private", ממשלתית: "type_gov", ועדה: "type_committee" } as Record<string, string>
const byTypeConfig = {
  type_private: { label: "פרטית", color: "var(--chart-1)" },
  type_gov: { label: "ממשלתית", color: "var(--chart-4)" },
  type_committee: { label: "ועדה", color: "var(--chart-9)" },
} satisfies ChartConfig
const byOutcomeConfig = {
  passed: { label: "עברו", color: "var(--chart-5)" },
  not_passed: { label: "לא עברו", color: "var(--muted-foreground)" },
} satisfies ChartConfig
const funnelConfig = { bills: { label: "הצעות חוק", color: "var(--chart-1)" } } satisfies ChartConfig
const timeConfig = { median_days: { label: "ימים (חציון)", color: "var(--chart-1)" } } satisfies ChartConfig
const consensusConfig = { share: { label: "ללא מתנגדים (%)", color: "var(--chart-5)" } } satisfies ChartConfig
const FUNNEL = [
  { stage: "preliminary", label: "הצבעה טרומית" },
  { stage: "first", label: "קריאה ראשונה" },
  { stage: "third", label: "קריאה שלישית" },
]

export function LawsPage() {
  const [k] = useKnesset()
  const [mode, setMode] = React.useState<"type" | "outcome">("type")
  const byYear = useLawsByYear()
  const funnel = useLawsFunnel(k)
  const time = useLawsTime()
  const consensus = useLawsConsensus()
  const reached = (byYear.data ?? []).reduce((s, r) => s + r.n, 0)
  const passed = (byYear.data ?? []).reduce((s, r) => s + (r.passed ? r.n : 0), 0)
  const gov = time.data?.find((r) => r.proposal_type === "ממשלתית")
  const lastYear = consensus.data?.at(-1)

  const yearRows = Object.values(
    (byYear.data ?? []).reduce<Record<number, Record<string, number>>>((acc, r) => {
      const y = (acc[r.year] ??= { year: r.year })
      const key = mode === "type" ? TYPES[r.proposal_type] : r.passed ? "passed" : "not_passed"
      y[key] = (y[key] ?? 0) + r.n
      return acc
    }, {})
  )

  return (
    <>
      <BlurFade inView>
        <PageHeader title="חוקים לאורך זמן" description="מה הכנסת מחוקקת, כמה ובאיזו מהירות." />
      </BlurFade>
      <BlurFade inView delay={0.05} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {byYear.data && time.data && consensus.data ? (
          <>
            <StatCard label="הצעות שהגיעו להצבעה" value={reached} icon={ScrollTextIcon} accent="var(--chart-6)" />
            <StatCard label="עברו" value={passed} icon={GavelIcon} accent="var(--chart-5)" progress={reached ? (100 * passed) / reached : undefined} />
            <StatCard
              label="ימים מקריאה ראשונה לחוק"
              value={gov?.median_days ?? null}
              icon={TimerIcon}
              accent="var(--chart-3)"
              hint="חציון, בהצעות חוק ממשלתיות."
            />
            <StatCard
              label={`בלי מתנגדים ב-${lastYear?.year ?? ""}`}
              value={lastYear?.zero_against_share ?? null}
              format={fmtPct}
              icon={HandshakeIcon}
              accent="var(--chart-12)"
              progress={lastYear ? lastYear.zero_against_share * 100 : undefined}
              hint="שיעור ההצבעות בקריאה שלישית שבהן אף אחד לא הצביע נגד, בשנה האחרונה בנתונים."
            />
          </>
        ) : (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)
        )}
      </BlurFade>
      <BlurFade inView delay={0.1}>
        <Caveat>הנתונים כוללים רק הצעות חוק שהגיעו להצבעה במליאה. רוב ההצעות הפרטיות לא מגיעות לשם כלל.</Caveat>
      </BlurFade>

      <BlurFade inView delay={0.15}>
        <Card>
          <CardHeader>
            <CardTitle>הצעות חוק לפי שנה</CardTitle>
            <CardDescription>לפי שנת ההצבעה הראשונה במליאה (אין בנתונים תאריך הגשה).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "type" | "outcome")} aria-label="פילוח">
              <ToggleGroupItem value="type">לפי סוג</ToggleGroupItem>
              <ToggleGroupItem value="outcome">לפי תוצאה</ToggleGroupItem>
            </ToggleGroup>
            <QueryState query={byYear} className="h-72">
              {() => (
                <ChartContainer config={mode === "type" ? byTypeConfig : byOutcomeConfig} className="h-72 w-full">
                  <BarChart data={yearRows}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} />
                    <YAxis orientation="right" width={40} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    {Object.keys(mode === "type" ? byTypeConfig : byOutcomeConfig).map((key) => (
                      <Bar key={key} dataKey={key} stackId="a" fill={`var(--color-${key})`} />
                    ))}
                  </BarChart>
                </ChartContainer>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView delay={0.2} className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>משפך הקריאות</CardTitle>
            <CardDescription>כמה הצעות חוק הגיעו לכל שלב. הצעות ממשלתיות מתחילות בקריאה ראשונה.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <KnessetSelect />
            <QueryState query={funnel} className="h-48">
              {(rows) => (
                <ChartContainer config={funnelConfig} className="h-48 w-full">
                  <BarChart
                    data={FUNNEL.map((f) => ({ label: f.label, bills: rows.find((r) => r.stage === f.stage)?.bills ?? 0 }))}
                    layout="vertical"
                    margin={{ left: 8, right: 8 }}
                  >
                    <XAxis type="number" reversed hide />
                    <YAxis type="category" dataKey="label" orientation="right" width={100} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="bills" fill="var(--color-bills)" radius={4} />
                  </BarChart>
                </ChartContainer>
              )}
            </QueryState>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>מקריאה ראשונה לחוק</CardTitle>
            <CardDescription>חציון הימים מהקריאה הראשונה עד השלישית, לפי סוג ההצעה.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <QueryState query={time} className="h-48">
              {(rows) => (
                <>
                  <ChartContainer config={timeConfig} className="h-48 w-full">
                    <BarChart data={rows}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="proposal_type" reversed tickLine={false} axisLine={false} />
                      <YAxis orientation="right" width={40} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="median_days" fill="var(--color-median_days)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                  <Collapsible className="flex flex-col gap-2">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="self-start">
                        פירוט
                        <ChevronDownIcon data-icon="inline-end" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>סוג</TableHead>
                            <TableHead>חוקים</TableHead>
                            <TableHead>חציון ימים</TableHead>
                            <TableHead>טווח בינרבעוני</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((r) => (
                            <TableRow key={r.proposal_type}>
                              <TableCell>{r.proposal_type}</TableCell>
                              <TableCell className="tabular-nums">{fmtNum(r.n)}</TableCell>
                              <TableCell className="tabular-nums">{fmtNum(Math.round(r.median_days))}</TableCell>
                              <TableCell className="tabular-nums">
                                {fmtNum(Math.round(r.p25))}–{fmtNum(Math.round(r.p75))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CollapsibleContent>
                  </Collapsible>
                </>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>חוקים שעברו בלי מתנגדים</CardTitle>
            <CardDescription>שיעור ההצבעות בקריאה שלישית שבהן אף אחד לא הצביע נגד, לפי שנה.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={consensus} className="h-64">
              {(rows) => (
                <ChartContainer config={consensusConfig} className="h-64 w-full">
                  <LineChart data={rows.map((r) => ({ year: r.year, share: pct100(r.zero_against_share) }))}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="year" padding={{ left: 24, right: 24 }} tickLine={false} axisLine={false} />
                    <YAxis orientation="right" domain={[0, 100]} tickFormatter={pctTick} width={44} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="share" stroke="var(--color-share)" strokeWidth={2} />
                  </LineChart>
                </ChartContainer>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>
    </>
  )
}
