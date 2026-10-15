import { Link } from "react-router"
import { LandmarkIcon, MegaphoneIcon } from "lucide-react"

import { PageHeader } from "@/components/app-shell"
import { CoalitionBadge } from "@/components/coalition-badge"
import { KnessetSelect, useKnesset } from "@/components/knesset-select"
import { MkAvatar } from "@/components/mk-avatar"
import { QueryState } from "@/components/query-state"
import { SplitBar } from "@/components/split-bar"
import { StatCard } from "@/components/stat-card"
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { BlurFade } from "@/components/ui/blur-fade"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MagicCard } from "@/components/ui/magic-card"
import { Progress } from "@/components/ui/progress"
import { partyColor } from "@/db/shared"
import { fmtNum, fmtPct } from "@/lib/labels"
import { usePartiesFaces, usePartiesList } from "./queries"

const FACES = 5

export function PartiesPage() {
  const [k] = useKnesset()
  const parties = usePartiesList(k)
  const faces = usePartiesFaces(k)
  const facesOf = (id: string) => (faces.data ?? []).filter((f) => f.party_id === id)
  return (
    <>
      <BlurFade inView>
        <PageHeader title="מפלגות" description="המפלגות שחבריהן הצביעו בכנסת שנבחרה. רשימות משותפות משויכות למפלגה המובילה.">
          <KnessetSelect />
        </PageHeader>
      </BlurFade>
      <QueryState query={parties} className="h-96">
        {(rows) => {
          // a party counts as coalition when it was in the coalition for most of its votes
          const coalition = rows.filter((p) => (p.coalition_share ?? 0) >= 0.5).reduce((s, p) => s + p.n_mks, 0)
          const total = rows.reduce((s, p) => s + p.n_mks, 0)
          return (
            <>
              <BlurFade inView delay={0.05}>
                <Card>
                  <CardHeader>
                    <CardTitle>חברי הכנסת ה-{k} לפי מפלגה</CardTitle>
                    <CardDescription>כל מי שכיהן בכנסת, כולל מחליפים, לפי המפלגה האחרונה שלו.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SplitBar
                      legend
                      segments={rows.map((p) => ({ key: p.party_id, label: p.party_name, value: p.n_mks, color: partyColor(p.color_index) }))}
                    />
                  </CardContent>
                </Card>
              </BlurFade>
              <BlurFade inView delay={0.1} className="grid grid-cols-2 gap-4">
                <StatCard
                  label="ח״כים בקואליציה"
                  value={coalition}
                  icon={LandmarkIcon}
                  accent="var(--chart-1)"
                  hint="מפלגה נספרת בקואליציה אם הייתה בה ברוב ההצבעות בכנסת זו."
                />
                <StatCard label="ח״כים באופוזיציה" value={total - coalition} icon={MegaphoneIcon} accent="var(--chart-4)" />
              </BlurFade>
              <BlurFade inView delay={0.15} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((p) => (
                  // MagicCard paints the card surface and the spotlight border; the Card inside keeps its composition
                  <MagicCard key={p.party_id} className="rounded-xl">
                    <Card size="sm" className="h-full bg-transparent ring-0">
                      <CardHeader>
                        <CardTitle>
                          <Link to={`/party/${p.party_id}?k=${k}`} className="flex items-center gap-2 underline-offset-4 hover:underline">
                            <span className="size-3 shrink-0 rounded-full" style={{ background: partyColor(p.color_index) }} />
                            {p.party_name}
                          </Link>
                        </CardTitle>
                        <CardDescription>{fmtNum(p.n_mks)} חברי כנסת</CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-2">
                        <AvatarGroup role="group" aria-label={`חברי הכנסת של ${p.party_name}`}>
                          {facesOf(p.party_id).map((f) => (
                            <MkAvatar key={f.member_id} size="sm" name={f.member_name} photoUrl={f.photo_url} />
                          ))}
                          {p.n_mks > FACES && (
                            <AvatarGroupCount dir="ltr" className="text-xs">
                              +{p.n_mks - FACES}
                            </AvatarGroupCount>
                          )}
                        </AvatarGroup>
                        <CoalitionBadge share={p.coalition_share} />
                        <div className="flex items-center gap-2 text-muted-foreground tabular-nums">
                          השתתפות
                          <Progress value={p.participation * 100} className="flex-1" aria-label={`השתתפות ${fmtPct(p.participation)}`} />
                          {fmtPct(p.participation)}
                        </div>
                      </CardContent>
                    </Card>
                  </MagicCard>
                ))}
              </BlurFade>
            </>
          )
        }}
      </QueryState>
    </>
  )
}
