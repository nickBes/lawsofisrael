import { Link, useParams } from "react-router"
import { ActivityIcon, GavelIcon, HandshakeIcon, LandmarkIcon, MagnetIcon, ScrollTextIcon, UsersIcon } from "lucide-react"

import { PageHeader } from "@/components/app-shell"
import { Caveat } from "@/components/caveat"
import { CONCEPT_EMPTY, ConceptCaveat } from "@/components/concept-caveat"
import { KnessetSelect, kParam, knessetLabel, useKnessetOrAll } from "@/components/knesset-select"
import { MkAvatar } from "@/components/mk-avatar"
import { QueryState } from "@/components/query-state"
import { ShowMore } from "@/components/show-more"
import { SplitBar } from "@/components/split-bar"
import { StageBadge } from "@/components/stage-badge"
import { StatCard } from "@/components/stat-card"
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { BlurFade } from "@/components/ui/blur-fade"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Progress } from "@/components/ui/progress"
import { ScrollProgress } from "@/components/ui/scroll-progress"
import { Skeleton } from "@/components/ui/skeleton"
import { partyColor } from "@/db/shared"
import { CHOICE_COLOR, fmtDate, fmtPct } from "@/lib/labels"
import {
  useParty,
  usePartyBills,
  usePartyCoalition,
  usePartyConcepts,
  usePartyDivisive,
  usePartyKpi,
  usePartyMembers,
} from "./queries"

const FACES = 8

export function PartyPage() {
  const id = useParams().id ?? ""
  const party = useParty(id)
  const knessets = (party.data ?? []).map((r) => r.knesset_num)
  const k = useKnessetOrAll(knessets)
  const p = party.data?.[0]

  if (!p)
    return (
      <QueryState query={party} className="h-64" empty="המפלגה לא נמצאה">
        {() => null}
      </QueryState>
    )

  return (
    <>
      <ScrollProgress />
      <BlurFade inView>
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <span className="size-4 shrink-0 rounded-full" style={{ background: partyColor(p.color_index) }} />
              {p.party_name}
            </span>
          }
          description={`כיהנה בכנסות: ${knessets.join(", ")}`}
        >
          <KnessetSelect options={knessets} allowAll />
        </PageHeader>
      </BlurFade>
      <PartyBody id={id} k={k} />
    </>
  )
}

function PartyBody({ id, k }: { id: string; k: number | null }) {
  const coalition = usePartyCoalition(id, k)
  const kpi = usePartyKpi(id, k)
  const concepts = usePartyConcepts(id, k)
  const divisive = usePartyDivisive(id, k)
  const bills = usePartyBills(id, k)
  const members = usePartyMembers(id, k)
  const kp = kpi.data?.[0]
  const pct = (x: number | null) => (x == null ? undefined : x * 100)

  return (
    <>
      {coalition.data && (
        <BlurFade inView delay={0.05} className="flex flex-wrap gap-2">
          {coalition.data.length ? (
            coalition.data.map((c) => (
              <Badge key={c.knesset_num + c.start}>
                <LandmarkIcon data-icon="inline-start" aria-hidden />
                {k == null && `הכנסת ה-${c.knesset_num} · `}
                {c.kind === "outside_support" ? "תמיכה מבחוץ" : "בקואליציה"} {fmtDate(c.start)} – {c.end ? fmtDate(c.end) : "סוף הכנסת"}
              </Badge>
            ))
          ) : (
            <Badge variant="outline">{k == null ? "באופוזיציה בכל הכנסות" : `באופוזיציה לאורך כל הכנסת ה-${k}`}</Badge>
          )}
        </BlurFade>
      )}
      {!!members.data?.length && (
        <BlurFade inView delay={0.05}>
          <AvatarGroup role="group" aria-label="חברי הכנסת של המפלגה">
            {members.data.slice(0, FACES).map((m) => (
              <MkAvatar key={m.member_id} size="lg" name={m.member_name} photoUrl={m.photo_url} />
            ))}
            {members.data.length > FACES && <AvatarGroupCount dir="ltr">+{members.data.length - FACES}</AvatarGroupCount>}
          </AvatarGroup>
        </BlurFade>
      )}

      <BlurFade inView delay={0.1} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kp ? (
          <>
            <StatCard label="חברי כנסת" value={kp.n_mks} icon={UsersIcon} accent="var(--chart-2)"
              hint={k == null ? "ח״כים שהמפלגה הייתה מפלגתם האחרונה באחת הכנסות." : "ח״כים שהמפלגה הזו הייתה מפלגתם האחרונה בכנסת זו."}
            />
            <StatCard
              label="השתתפות"
              value={kp.participation}
              format={fmtPct}
              icon={ActivityIcon}
              accent="var(--chart-1)"
              progress={pct(kp.participation)}
              gauge
              hint="הצבעות שחברי המפלגה השתתפו בהן, מתוך ההצבעות שהתקיימו בזמן כהונתם."
            />
            <StatCard
              label="לכידות"
              value={kp.cohesion}
              format={fmtPct}
              icon={MagnetIcon}
              accent="var(--chart-9)"
              progress={pct(kp.cohesion)}
              gauge
              hint="מדד רייס: עד כמה חברי המפלגה הצביעו יחד (100% = כולם באותו כיוון)."
            />
            <StatCard
              label="הצביעה עם הקואליציה"
              value={kp.sided_with_coalition}
              format={fmtPct}
              icon={HandshakeIcon}
              accent="var(--chart-12)"
              progress={pct(kp.sided_with_coalition)}
              gauge
              hint="בהצבעות שבהן הקואליציה והאופוזיציה הצביעו הפוך: כמה פעמים עמדת המפלגה הייתה כעמדת רוב הקואליציה."
            />
          </>
        ) : (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)
        )}
      </BlurFade>

      <BlurFade inView delay={0.15}>
        <Caveat>הצבעות במליאה משקפות בעיקר משמעת קואליציונית, ולא רק עמדות.</Caveat>
      </BlurFade>

      <BlurFade inView delay={0.2}>
        <Card>
          <CardHeader>
            <CardTitle>עמדת המפלגה לפי מושג</CardTitle>
            <CardDescription>
              בכמה הצבעות רוב חברי המפלגה הצביעו בעד או נגד הצעות חוק עם כל מושג, בקריאות טרומית, ראשונה ושלישית {knessetLabel(k)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ConceptCaveat />
            <QueryState query={concepts} className="h-80" {...CONCEPT_EMPTY}>
              {(rows) => (
                <ItemGroup className="grid gap-2 md:grid-cols-2">
                  {rows.map((c) => (
                    <Item key={c.concept_id} variant="outline" size="sm" asChild>
                      <Link to={`/concept/${c.concept_id}`}>
                        <ItemContent className="min-w-0">
                          <ItemTitle className="line-clamp-2">{c.concept_label}</ItemTitle>
                          <SplitBar
                            legend
                            segments={[
                              { key: "for", label: "בעד", value: c.n_for, color: CHOICE_COLOR.for },
                              { key: "against", label: "נגד", value: c.n_against, color: CHOICE_COLOR.against },
                            ]}
                          />
                        </ItemContent>
                      </Link>
                    </Item>
                  ))}
                </ItemGroup>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView>
        <Card>
          <CardHeader>
            <CardTitle>ההצבעות שבהן המפלגה התפצלה</CardTitle>
            <CardDescription>הצבעות שבהן חברי המפלגה לא הצביעו כולם באותו כיוון (לכידות נמוכה ראשונה).</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={divisive} empty="המפלגה הצביעה תמיד כגוש אחד">
              {(rows) => (
                <ShowMore
                  items={rows}
                  render={(r) => (
                    <Item variant="outline" size="sm" asChild>
                      <Link to={`/vote/${r.vote_id}`}>
                        <ItemContent className="min-w-0">
                          <ItemTitle className="line-clamp-2">{r.item_title}</ItemTitle>
                          <ItemDescription className="flex flex-wrap items-center gap-2">
                            <span className="tabular-nums">{fmtDate(r.vote_date)}</span>
                            <StageBadge stage={r.stage} />
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions className="w-28">
                          <SplitBar
                            className="w-full"
                            legend
                            segments={[
                              { key: "for", label: "בעד", value: r.n_for, color: CHOICE_COLOR.for },
                              { key: "against", label: "נגד", value: r.n_against, color: CHOICE_COLOR.against },
                            ]}
                          />
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
            <CardTitle>הצעות חוק פרטיות של חברי המפלגה</CardTitle>
            <CardDescription>הצעות שהגיעו להצבעה במליאה, ומה מהן עבר.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <QueryState query={bills} empty="אין הצעות חוק פרטיות שהגיעו להצבעה">
              {(rows) => (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <StatCard label="הצעות שהגיעו להצבעה" value={rows.length} icon={ScrollTextIcon} accent="var(--chart-6)" />
                    <StatCard label="עברו" value={rows.filter((b) => b.passed).length} icon={GavelIcon} accent="var(--chart-5)" />
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
                        </ItemContent>
                        <ItemActions className="max-sm:basis-full">
                          <Badge variant={b.passed ? "default" : "outline"}>{b.status}</Badge>
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
            <CardTitle>חברי הכנסת של המפלגה</CardTitle>
            <CardDescription>הפס מראה את שיעור ההשתתפות בהצבעות.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={members}>
              {(rows) => (
                <ShowMore
                  items={rows}
                  initial={12}
                  className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
                  render={(m) => (
                    <Item variant="outline" size="sm" asChild>
                      <Link to={`/mk/${m.member_id}?k=${kParam(k)}`}>
                        <ItemMedia>
                          <MkAvatar name={m.member_name} photoUrl={m.photo_url} />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle>{m.member_name}</ItemTitle>
                          <div className="flex items-center gap-2 text-muted-foreground tabular-nums">
                            <Progress value={m.participation * 100} className="w-20" aria-label={`השתתפות ${fmtPct(m.participation)}`} />
                            {fmtPct(m.participation)}
                          </div>
                        </ItemContent>
                      </Link>
                    </Item>
                  )}
                />
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>
    </>
  )
}
