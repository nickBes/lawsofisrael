import * as React from "react"
import { Link, useParams } from "react-router"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { ActivityIcon, HandIcon, HandshakeIcon, HourglassIcon, SplitIcon, SproutIcon, TrophyIcon } from "lucide-react"

import { PageHeader } from "@/components/app-shell"
import { Caveat } from "@/components/caveat"
import { ChoiceBadge } from "@/components/choice-badge"
import { CONCEPT_EMPTY, ConceptCaveat, EVIDENCE_LABEL, EvidenceLabel } from "@/components/concept-caveat"
import { KnessetSelect, kParam, knessetLabel, useKnessetOrAll } from "@/components/knesset-select"
import { QueryState } from "@/components/query-state"
import { ShowMore } from "@/components/show-more"
import { SplitBar } from "@/components/split-bar"
import { StageBadge } from "@/components/stage-badge"
import { MkAvatar } from "@/components/mk-avatar"
import { StatCard } from "@/components/stat-card"
import { Badge } from "@/components/ui/badge"
import { BlurFade } from "@/components/ui/blur-fade"
import { ScrollProgress } from "@/components/ui/scroll-progress"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { partyColor } from "@/db/shared"
import { CHOICE_COLOR, choiceChartConfig, fmtDate, fmtNum, fmtPct, pct100, pctTick } from "@/lib/labels"
import {
  useMkAgainstParty,
  useMkBills,
  useMkConcepts,
  useMkConceptVotes,
  useMkKpi,
  useMkParticipation,
  useMkPositions,
  useMkService,
  useMkSimilar,
  useMkStints,
  useMkYearly,
} from "./queries"

const REACHED = {
  passed: "עבר",
  first: "נתקע אחרי קריאה ראשונה",
  preliminary: "נתקע בשלב הטרומי",
}

const participationConfig = {
  mk: { label: "חבר הכנסת", color: "var(--chart-1)" },
  party_median: { label: "חציון המפלגה", color: "var(--muted-foreground)" },
} satisfies ChartConfig

export function MkPage() {
  const id = Number(useParams().id)
  const service = useMkService(id)
  const positions = useMkPositions(id)
  const knessets = (service.data ?? []).map((s) => s.knesset_num)
  const k = useKnessetOrAll(knessets)
  const first = service.data?.[0]
  const latest = service.data?.at(-1)
  // all Knessets: the whole span, so ministerInK covers every term
  const cur =
    k == null
      ? first && latest && { first_date: first.first_date, last_date: latest.last_date }
      : service.data?.find((s) => s.knesset_num === k)

  if (!latest || !cur)
    return (
      <QueryState query={service} className="h-64" empty="חבר הכנסת לא נמצא">
        {() => null}
      </QueryState>
    )

  // shortcut: positions are shown deduplicated by title; the full dated list is in dim_governments
  const titles = [...new Set((positions.data ?? []).map((p) => p.position_name + (p.ministry_name && p.ministry_name !== p.position_name ? ` (${p.ministry_name})` : "")))]
  const ministerInK = (positions.data ?? []).some(
    (p) => p.start_date <= cur.last_date && (p.finish_date == null || p.finish_date >= cur.first_date)
  )

  return (
    <>
      <ScrollProgress />
      <BlurFade inView>
        <PageHeader
          title={
            <span className="flex items-center gap-3">
              <MkAvatar className="size-14" name={latest.member_name} photoUrl={latest.photo_url} />
              {latest.member_name}
            </span>
          }
          description={`${latest.party_name ?? ""} · כיהן בכנסות ${knessets.join(", ")}`}
        >
          <KnessetSelect options={knessets} allowAll />
        </PageHeader>
      </BlurFade>
      {titles.length > 0 && (
        <BlurFade inView delay={0.05} className="flex flex-wrap gap-2">
          {titles.slice(0, 8).map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
          {titles.length > 8 && <Badge variant="outline">ועוד {titles.length - 8} תפקידים</Badge>}
        </BlurFade>
      )}
      <MkBody id={id} k={k} ministerInK={ministerInK} />
    </>
  )
}

function MkBody({ id, k, ministerInK }: { id: number; k: number | null; ministerInK: boolean }) {
  const kpi = useMkKpi(id, k)
  const yearly = useMkYearly(id, k)
  const participation = useMkParticipation(id, k)
  const concepts = useMkConcepts(id, k)
  const against = useMkAgainstParty(id, k)
  const [excludeBloc, setExcludeBloc] = React.useState(true)
  const similar = useMkSimilar(id, k, excludeBloc)
  const bills = useMkBills(id, k)
  const stints = useMkStints(id)
  const [sheetConcept, setSheetConcept] = React.useState<{ id: string; label: string } | null>(null)
  const conceptVotes = useMkConceptVotes(id, k, sheetConcept?.id ?? "")
  const kp = kpi.data?.[0]
  const reached = (r: keyof typeof REACHED) => (bills.data ?? []).filter((b) => b.reached === r).length

  return (
    <>
      <BlurFade inView delay={0.1} className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {kp ? (
          <>
            <StatCard
              label="השתתפות"
              value={kp.participation}
              format={fmtPct}
              icon={ActivityIcon}
              accent="var(--chart-1)"
              progress={kp.participation * 100}
              gauge
              hint={`הצבעות שהשתתף בהן, מתוך ההצבעות האלקטרוניות והשמיות שהתקיימו בין ההצבעה הראשונה לאחרונה שלו ${knessetLabel(k)}.`}
            />
            <StatCard
              label="הסכמה עם המפלגה"
              value={kp.agreement_with_party}
              format={fmtPct}
              icon={HandshakeIcon}
              accent="var(--chart-12)"
              progress={kp.agreement_with_party == null ? undefined : kp.agreement_with_party * 100}
              gauge
              hint="בהצבעות בעד/נגד שבהן לפחות שלושה מחברי מפלגתו הצביעו: כמה פעמים הצביע כמו רובם."
            />
            <StatCard label="הצבעות" value={kp.n_ballots} icon={HandIcon} accent="var(--chart-3)" />
            <StatCard
              label="הצבעות נגד המפלגה"
              value={kp.against_party}
              icon={SplitIcon}
              accent="var(--chart-4)"
              hint="בעד/נגד הפוך מרוב חברי מפלגתו שהצביעו, כשלפחות שניים נוספים מהמפלגה הצביעו."
            />
            <StatCard
              label="הצעות חוק שיזם ← עברו"
              value={`${fmtNum(kp.initiated)} ← ${fmtNum(kp.passed)}`}
              icon={TrophyIcon}
              accent="var(--chart-5)"
              hint="הצעות חוק פרטיות שהגיעו להצבעה במליאה."
            />
          </>
        ) : (
          [1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24" />)
        )}
      </BlurFade>

      {kp?.max_gap_days != null && kp.max_gap_days > 150 && (
        <BlurFade inView delay={0.15}>
          <Caveat>
            יש פער של {fmtNum(kp.max_gap_days)} ימים בין שתי הצבעות שלו {knessetLabel(k)}. ייתכן שלא כיהן בתקופה הזו (למשל בגלל החוק הנורווגי), ולכן
            ההשתתפות עשויה להיראות נמוכה מהאמת.
          </Caveat>
        </BlurFade>
      )}
      {ministerInK && (
        <BlurFade inView delay={0.15}>
          <Caveat>כיהן כשר או סגן שר {knessetLabel(k)}. שרים משתתפים פחות בהצבעות בגלל תפקידם.</Caveat>
        </BlurFade>
      )}

      <BlurFade inView delay={0.2} className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>הצבעות לפי שנה</CardTitle>
            <CardDescription>בלי הצבעות בקריאה שנייה ועל הסתייגויות, שהן הצבעות על סעיפים ותיקונים ולא על החוק כולו.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={yearly} className="h-64">
              {(rows) => (
                <ChartContainer config={choiceChartConfig} className="h-64 w-full">
                  <BarChart data={rows}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} />
                    <YAxis orientation="right" width={40} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    {(["n_for", "n_against", "n_abstain", "n_present"] as const).map((key) => (
                      <Bar key={key} dataKey={key} stackId="a" fill={`var(--color-${key})`} />
                    ))}
                  </BarChart>
                </ChartContainer>
              )}
            </QueryState>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>השתתפות לפי שנה (%)</CardTitle>
            <CardDescription>מול החציון של חברי מפלגתו.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={participation} className="h-64">
              {(rows) => (
                <ChartContainer config={participationConfig} className="h-64 w-full">
                  <LineChart data={rows.map((r) => ({ ...r, mk: pct100(r.mk), party_median: pct100(r.party_median) }))}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="year" padding={{ left: 24, right: 24 }} tickLine={false} axisLine={false} />
                    <YAxis orientation="right" domain={[0, 100]} tickFormatter={pctTick} width={44} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line dataKey="mk" stroke="var(--color-mk)" strokeWidth={2} />
                    <Line dataKey="party_median" stroke="var(--color-party_median)" strokeWidth={2} strokeDasharray="4 4" />
                  </LineChart>
                </ChartContainer>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>מושגים שהצביע עליהם</CardTitle>
            <CardDescription>
              ההצבעות שלו בעד ונגד הצעות חוק לפי מושג, בקריאות טרומית, ראשונה ושלישית, וכמה פעמים הצביע כמו מפלגתו. לחצו על מושג לרשימת ההצבעות.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ConceptCaveat />
            <QueryState query={concepts} className="h-80" {...CONCEPT_EMPTY}>
              {(rows) => (
                <ItemGroup className="grid gap-2 md:grid-cols-2">
                  {rows.map((c) => (
                    <Item key={c.concept_id} variant="outline" size="sm">
                      <ItemContent className="min-w-0">
                        <ItemTitle className="line-clamp-none">
                          <Button
                            variant="link"
                            className="h-auto shrink p-0 text-start whitespace-normal"
                            onClick={() => setSheetConcept({ id: c.concept_id, label: c.concept_label })}
                          >
                            {c.concept_label}
                          </Button>
                        </ItemTitle>
                        <SplitBar
                          segments={[
                            { key: "for", label: "בעד", value: c.n_for, color: CHOICE_COLOR.for },
                            { key: "against", label: "נגד", value: c.n_against, color: CHOICE_COLOR.against },
                          ]}
                        />
                        <ItemDescription>
                          {fmtNum(c.n_for)} בעד · {fmtNum(c.n_against)} נגד · הסכמה עם המפלגה {fmtPct(c.agreement_with_party)}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <Sheet open={sheetConcept != null} onOpenChange={(o) => !o && setSheetConcept(null)}>
        {/* data-[side=left]: needed to beat the Sheet's own w-3/4; pe-6 keeps the title clear of the close button */}
        <SheetContent side="left" className="overflow-y-auto data-[side=left]:w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="pe-6">{sheetConcept?.label}</SheetTitle>
            <SheetDescription>
              ההצבעות של חבר הכנסת על הצעות חוק עם מושג זה, מול עמדת מפלגתו.{" "}
              {sheetConcept && (
                <Link to={`/concept/${sheetConcept.id}`} className="underline underline-offset-4">
                  לעמוד המושג
                </Link>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4 pb-4">
            {conceptVotes.data?.some((r) => r.bullet) && <EvidenceLabel />}
            <QueryState query={conceptVotes}>
              {(rows) => <ShowMore items={rows} initial={20} render={(r) => <VoteLine r={r} bullet={r.bullet} />} />}
            </QueryState>
          </div>
        </SheetContent>
      </Sheet>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>הצבעות נגד המפלגה</CardTitle>
            <CardDescription>הצבעות שבהן הצביע הפוך מרוב חברי מפלגתו.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={against} empty={`לא הצביע נגד מפלגתו ${knessetLabel(k)}`}>
              {(rows) => <ShowMore items={rows} render={(r) => <VoteLine r={r} />} />}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>מצביעים הכי דומה</CardTitle>
            <CardDescription>
              ח״כים שהצביעו כמוהו בהכי הרבה הצבעות משותפות (לפחות 100). בלי ההצבעות "גוש מול גוש" רואים דמיון שאינו רק קואליציה מול אופוזיציה.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ToggleGroup
              type="single"
              variant="outline"
              value={excludeBloc ? "exclude" : "all"}
              onValueChange={(v) => v && setExcludeBloc(v === "exclude")}
              aria-label="אילו הצבעות לכלול"
            >
              <ToggleGroupItem value="exclude">בלי הצבעות גוש מול גוש</ToggleGroupItem>
              <ToggleGroupItem value="all">כל ההצבעות</ToggleGroupItem>
            </ToggleGroup>
            <QueryState query={similar} className="h-96" empty="אין מספיק הצבעות משותפות">
              {(rows) => (
                <ShowMore
                  items={rows}
                  render={(r) => (
                    <Item variant="outline" size="sm" asChild>
                      <Link to={`/mk/${r.member_id}?k=${kParam(k)}`}>
                        <ItemMedia>
                          <MkAvatar name={r.member_name} photoUrl={r.photo_url} />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle>
                            {r.member_name}
                            {r.cross_party && <Badge variant="outline">מפלגה אחרת</Badge>}
                          </ItemTitle>
                          <ItemDescription className="flex items-center gap-1.5">
                            {r.color_index != null && <span className="size-2 shrink-0 rounded-full" style={{ background: partyColor(r.color_index) }} />}
                            {r.party_name ?? "—"} · {fmtNum(r.n_common)} הצבעות משותפות
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions className="tabular-nums max-sm:basis-full">
                          <Progress value={r.agreement * 100} className="w-20 sm:w-28" aria-label={`הסכמה ${fmtPct(r.agreement)}`} />
                          {fmtPct(r.agreement)}
                        </ItemActions>
                      </Link>
                    </Item>
                  )}
                />
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>הצעות חוק שיזם</CardTitle>
            <CardDescription>הצעות חוק פרטיות שהגיעו להצבעה במליאה, ועד איפה הגיעו.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <QueryState query={bills} empty={`אין הצעות חוק פרטיות שהגיעו להצבעה ${knessetLabel(k)}`}>
              {(rows) => (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <StatCard label="עברו" value={reached("passed")} icon={TrophyIcon} accent="var(--chart-5)" />
                    <StatCard label="נתקעו אחרי קריאה ראשונה" value={reached("first")} icon={HourglassIcon} accent="var(--chart-9)" />
                    <StatCard label="נתקעו בשלב הטרומי" value={reached("preliminary")} icon={SproutIcon} accent="var(--chart-11)" />
                  </div>
                  <ShowMore
                    items={rows}
                    render={(b) => (
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
                          <ItemDescription>{b.status}</ItemDescription>
                        </ItemContent>
                        <ItemActions className="max-sm:basis-full">
                          <Badge variant={b.reached === "passed" ? "default" : "outline"}>{REACHED[b.reached]}</Badge>
                        </ItemActions>
                      </Item>
                    )}
                  />
                </>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>היסטוריית סיעות</CardTitle>
            <CardDescription>מהכנסת ה-16 ואילך. לכל סיעה יש תאריך התחלה בלבד.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={stints}>
              {(rows) => (
                <div className="flex flex-wrap gap-2">
                  {rows.map((s) => (
                    <Badge key={s.start_date + s.faction_name} variant="secondary" className="h-auto whitespace-normal">
                      K{s.knesset_num} · {s.faction_name} · {fmtDate(s.start_date)}
                    </Badge>
                  ))}
                </div>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>
    </>
  )
}

// one vote: MK's choice against the party's position
function VoteLine({
  r,
  bullet,
}: {
  r: { vote_id: number; vote_date: string; item_title: string; stage: string; choice: string; position: string }
  bullet?: string | null
}) {
  return (
    <Item variant="outline" size="sm" asChild>
      <Link to={`/vote/${r.vote_id}`}>
        <ItemContent className="min-w-0">
          <ItemTitle className="line-clamp-2">{r.item_title}</ItemTitle>
          <ItemDescription className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{fmtDate(r.vote_date)}</span>
            <StageBadge stage={r.stage} />
          </ItemDescription>
          {bullet && (
            <ItemDescription title={EVIDENCE_LABEL}>
              <span aria-hidden>📝 </span>
              <span className="sr-only">{EVIDENCE_LABEL}: </span>
              {bullet}
            </ItemDescription>
          )}
        </ItemContent>
        {/* own row below sm, otherwise it squeezes the title to a few characters */}
        <ItemActions className="text-xs text-muted-foreground max-sm:basis-full">
          הוא <ChoiceBadge choice={r.choice} />
          המפלגה {r.position === "split" ? <Badge variant="outline">חלוקה</Badge> : <ChoiceBadge choice={r.position} />}
        </ItemActions>
      </Link>
    </Item>
  )
}
