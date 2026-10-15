import { Link, useParams } from "react-router"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChevronDownIcon, ExternalLinkIcon, LightbulbIcon } from "lucide-react"

import { PageHeader } from "@/components/app-shell"
import { Caveat } from "@/components/caveat"
import { ChoiceBadge } from "@/components/choice-badge"
import { EvidenceLabel } from "@/components/concept-caveat"
import { MkAvatar } from "@/components/mk-avatar"
import { QueryState } from "@/components/query-state"
import { ShowMore } from "@/components/show-more"
import { SplitBar } from "@/components/split-bar"
import { ResultBadge, StageBadge } from "@/components/stage-badge"
import { AnimatedList } from "@/components/ui/animated-list"
import { Badge } from "@/components/ui/badge"
import { BlurFade } from "@/components/ui/blur-fade"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { billUrl, CHOICE_LABEL, choiceChartConfig, fmtDate, fmtNum, tallySegments } from "@/lib/labels"
import { useBillPath, useVote, useVoteByParty, useVoteConcepts, useVoteEvidence, useVoteMks } from "./queries"

const MK_TABS = ["for", "against", "abstain", "absent"]

export function VotePage() {
  const id = Number(useParams().id)
  const vote = useVote(id)
  const v = vote.data?.[0]
  const byParty = useVoteByParty(id, !!v?.has_ballots)
  const mks = useVoteMks(id, !!v?.has_ballots)
  const path = useBillPath(id, v?.bill_id != null)
  const concepts = useVoteConcepts(id, v?.bill_id != null)
  const evidence = useVoteEvidence(id, v?.bill_id != null)

  if (!v)
    return (
      <QueryState query={vote} className="h-64" empty="ההצבעה לא נמצאה">
        {() => null}
      </QueryState>
    )

  return (
    <>
      <BlurFade inView>
        <PageHeader title={v.item_title} description={`${fmtDate(v.vote_date)} · הכנסת ה-${v.knesset_num}`} />
      </BlurFade>
      <BlurFade inView delay={0.05}>
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap gap-2">
              <StageBadge stage={v.stage} />
              <ResultBadge accepted={v.accepted} />
              <Badge variant="outline">הצבעה {v.vote_type}</Badge>
            </CardTitle>
            <CardDescription>נוסח ההחלטה: {v.decision ?? "לא צוין"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SplitBar segments={tallySegments(v)} legend />
            {!!concepts.data?.length && (
              <div className="flex flex-wrap gap-2">
                {concepts.data.map((c) => (
                  <Badge key={c.concept_id} variant={c.is_generic ? "outline" : "secondary"} asChild className="h-auto whitespace-normal">
                    <Link to={`/concept/${c.concept_id}`}>
                      <LightbulbIcon data-icon="inline-start" aria-hidden />
                      {c.concept_label}
                    </Link>
                  </Badge>
                ))}
              </div>
            )}
            {!!evidence.data?.length && (
              <div className="flex flex-col gap-2">
                <EvidenceLabel />
                <ShowMore
                  items={evidence.data}
                  initial={3}
                  render={(e) => (
                    <Item size="xs" variant="muted">
                      <ItemContent className="min-w-0 gap-1">
                        <p className="text-sm">{e.bullet}</p>
                        {(concepts.data?.length ?? 0) > 1 && (
                          <Badge variant="outline" className="h-auto max-w-full whitespace-normal">
                            <span className="line-clamp-1">{e.concept_label}</span>
                          </Badge>
                        )}
                      </ItemContent>
                    </Item>
                  )}
                />
              </div>
            )}
          </CardContent>
          {v.bill_id != null && (
            <CardFooter>
              <Button variant="outline" size="sm" asChild>
                <a href={billUrl(v.bill_id)} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon data-icon="inline-start" />
                  הצעת החוק באתר הכנסת
                </a>
              </Button>
            </CardFooter>
          )}
        </Card>
      </BlurFade>

      {v.stage === "reservation" && (
        <BlurFade inView delay={0.1}>
          <Caveat>זו כנראה הצבעה על הסתייגות (תיקון) ביום הקריאה השנייה: "בעד" פירושו תמיכה בתיקון, לא בחוק עצמו.</Caveat>
        </BlurFade>
      )}
      {v.reading == null && v.stage !== "reservation" && (
        <BlurFade inView delay={0.1}>
          <Caveat>נוסח ההחלטה לא ציין קריאה, לכן מוצג הנוסח המקורי כפי שפורסם.</Caveat>
        </BlurFade>
      )}
      {!v.has_ballots && (
        <BlurFade inView delay={0.1}>
          <Caveat>בהצבעה זו (הרמת יד או חשאית) פורסמו רק סיכומים, בלי הצבעה אישית של חברי הכנסת.</Caveat>
        </BlurFade>
      )}

      {v.has_ballots && (
        <>
          <BlurFade inView delay={0.15}>
            <Card>
              <CardHeader>
                <CardTitle>לפי מפלגה</CardTitle>
                <CardDescription>"נעדר" הוא ח״כ שכיהן באותו יום ולא הצביע. היעדרות אינה הצבעה נגד.</CardDescription>
              </CardHeader>
              <CardContent>
                <QueryState query={byParty} className="h-80">
                  {(rows) => (
                    <ChartContainer config={choiceChartConfig} className="w-full" style={{ height: rows.length * 32 + 60 }}>
                      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 8 }}>
                        <CartesianGrid horizontal={false} />
                        <XAxis type="number" reversed tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="party_name" orientation="right" width={130} tickLine={false} axisLine={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
                        {(["n_for", "n_against", "n_abstain", "n_absent"] as const).map((k) => (
                          <Bar key={k} dataKey={k} stackId="a" fill={`var(--color-${k})`} />
                        ))}
                      </BarChart>
                    </ChartContainer>
                  )}
                </QueryState>
              </CardContent>
            </Card>
          </BlurFade>

          <BlurFade inView delay={0.2}>
            <Collapsible>
              <Card>
                <CardHeader>
                  <CardTitle>מי הצביע איך ({fmtNum(mks.data?.length ?? 0)})</CardTitle>
                  <CardDescription>כל חברי הכנסת שכיהנו ביום ההצבעה, לפי איך הצביעו.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm" className="self-start">
                      הצגת הרשימה
                      <ChevronDownIcon data-icon="inline-end" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <QueryState query={mks} className="h-64">
                      {(rows) => (
                        <Tabs defaultValue="for">
                          <TabsList>
                            {MK_TABS.map((c) => (
                              <TabsTrigger key={c} value={c}>
                                {c === "absent" ? "נעדרו" : CHOICE_LABEL[c]} ({rows.filter((r) => r.choice === c).length})
                              </TabsTrigger>
                            ))}
                          </TabsList>
                          {MK_TABS.map((c) => (
                            <TabsContent key={c} value={c}>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>שם</TableHead>
                                    <TableHead>מפלגה</TableHead>
                                    <TableHead>הצבעה</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {rows
                                    .filter((r) => r.choice === c)
                                    .map((r) => (
                                      <TableRow key={r.member_id}>
                                        <TableCell>
                                          <span className="flex items-center gap-2">
                                            <MkAvatar size="sm" name={r.member_name} photoUrl={r.photo_url} />
                                            <Link to={`/mk/${r.member_id}?k=${v.knesset_num}`} className="underline-offset-4 hover:underline">
                                              {r.member_name}
                                            </Link>
                                          </span>
                                        </TableCell>
                                        <TableCell>{r.party_name ?? "—"}</TableCell>
                                        <TableCell>
                                          <ChoiceBadge choice={r.choice} />
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                </TableBody>
                              </Table>
                            </TabsContent>
                          ))}
                        </Tabs>
                      )}
                    </QueryState>
                  </CollapsibleContent>
                </CardContent>
              </Card>
            </Collapsible>
          </BlurFade>
        </>
      )}

      {v.bill_id != null && (
        <BlurFade inView>
          <Card>
            <CardHeader>
              <CardTitle>מסלול הצעת החוק</CardTitle>
              <CardDescription>כל ההצבעות במליאה על הצעת חוק זו.</CardDescription>
            </CardHeader>
            <CardContent>
              {path.data ? (
                <ItemGroup>
                  <AnimatedList delay={150} className="gap-2">
                    {path.data.map((p) => (
                      <Item key={p.vote_id} variant={p.vote_id === id ? "muted" : "outline"} size="sm" asChild>
                        <Link to={`/vote/${p.vote_id}`}>
                          <ItemContent>
                            <ItemTitle>
                              <StageBadge stage={p.stage} />
                              {fmtDate(p.vote_date)}
                              {p.vote_id === id && <Badge variant="secondary">ההצבעה הנוכחית</Badge>}
                            </ItemTitle>
                            <ItemDescription>{p.decision}</ItemDescription>
                          </ItemContent>
                          <ItemActions className="tabular-nums">
                            {fmtNum(p.n_for)}–{fmtNum(p.n_against)}
                            <ResultBadge accepted={p.accepted} />
                          </ItemActions>
                        </Link>
                      </Item>
                    ))}
                  </AnimatedList>
                </ItemGroup>
              ) : (
                <Skeleton className="h-32 w-full" />
              )}
            </CardContent>
          </Card>
        </BlurFade>
      )}
    </>
  )
}
