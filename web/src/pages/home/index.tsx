import type * as React from "react"
import { Link } from "react-router"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { BookOpenIcon, FlagIcon, GavelIcon, HandIcon, LightbulbIcon, ScaleIcon, UsersIcon, VoteIcon } from "lucide-react"

import { QueryState } from "@/components/query-state"
import { StatCard } from "@/components/stat-card"
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text"
import { Badge } from "@/components/ui/badge"
import { BentoCard, BentoGrid } from "@/components/ui/bento-grid"
import { BlurFade } from "@/components/ui/blur-fade"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Marquee } from "@/components/ui/marquee"
import { NumberTicker } from "@/components/ui/number-ticker"
import { Skeleton } from "@/components/ui/skeleton"
import { WordRotate } from "@/components/ui/word-rotate"
import { fmtDate, fmtNum } from "@/lib/labels"
import { useLawsConsensus } from "@/pages/laws/queries"
import { useHomeCounts, useHomeRecentLaws } from "./queries"

type Counts = NonNullable<ReturnType<typeof useHomeCounts>["data"]>[number]

const SECTIONS: { to: string; name: string; description: string; Icon: typeof VoteIcon; className: string; accent: string; count?: keyof Counts; unit?: string }[] = [
  { to: "/votes", accent: "var(--chart-1)", name: "הצבעות", description: "כל הצבעות המליאה, ומי הצביע איך.", Icon: VoteIcon, className: "md:col-span-2", count: "votes", unit: "הצבעות" },
  { to: "/parties", accent: "var(--chart-8)", name: "מפלגות", description: "איך כל מפלגה מצביעה, בכל מושג ובכל כנסת.", Icon: FlagIcon, className: "md:col-span-1", count: "parties", unit: "מפלגות" },
  { to: "/mks", accent: "var(--chart-2)", name: "חברי כנסת", description: "נוכחות, הצבעות נגד המפלגה והצעות חוק של כל ח״כ.", Icon: UsersIcon, className: "md:col-span-1", count: "mks", unit: "חברי כנסת" },
  { to: "/laws", accent: "var(--chart-5)", name: "חוקים", description: "כמה חוקים עוברים, ובאיזו מהירות.", Icon: ScaleIcon, className: "md:col-span-2", count: "laws_passed", unit: "חוקים שעברו" },
  { to: "/concepts", accent: "var(--chart-9)", name: "מושגים", description: "מה הצעות החוק עושות, ואיך הצביעו עליהן.", Icon: LightbulbIcon, className: "md:col-span-2", count: "concepts", unit: "מושגים" },
  { to: "/about", accent: "var(--chart-6)", name: "אודות", description: "מקורות הנתונים, הגדרות ומגבלות.", Icon: BookOpenIcon, className: "md:col-span-1" },
]
const WORDS = ["הצבעות", "חוקים", "חברי כנסת", "מושגים"]
const fmtInt = (n: number) => fmtNum(Math.round(n))

const consensusConfig = {
  zero_against: { label: "ללא מתנגדים", color: "var(--chart-5)" },
  contested: { label: "עם מתנגדים", color: "var(--chart-4)" },
} satisfies ChartConfig

export function HomePage() {
  const counts = useHomeCounts()
  const consensus = useLawsConsensus()
  const recent = useHomeRecentLaws()
  const c = counts.data?.[0]

  return (
    <>
      <BlurFade inView>
        <section className="relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-6 shadow-sm md:p-10">
          <h1 className="relative font-heading text-3xl font-medium md:text-4xl">
            לחקור את הכנסת לפי <span className="sr-only">הצבעות, חוקים, חברי כנסת ומושגים</span>
            <span aria-hidden>
              {/* gradient inside the moving word: a bg-clip-text parent paints child glyphs without their transform/opacity */}
              <WordRotate words={WORDS}>{(w) => <AnimatedGradientText>{w}</AnimatedGradientText>}</WordRotate>
            </span>
          </h1>
          <p className="relative text-muted-foreground">
            כלי לחקירת הצבעות המליאה מהכנסת ה-16 ואילך: מי הצביע איך, על מה ומתי. בלי המלצות, רק הנתונים.
          </p>
          {c && (
            <Badge variant="secondary" className="relative self-start">
              מעודכן עד {fmtDate(c.last_date)}
            </Badge>
          )}
        </section>
      </BlurFade>

      <BlurFade inView delay={0.05} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {c ? (
          <>
            <StatCard label="הצבעות מליאה" value={c.votes} icon={VoteIcon} accent="var(--chart-1)" />
            <StatCard label="הצבעות אישיות של ח״כים" value={c.ballots} icon={HandIcon} accent="var(--chart-3)" />
            <StatCard
              label="חוקים שעברו"
              value={c.laws_passed}
              icon={GavelIcon}
              accent="var(--chart-5)"
              hint="הצעות חוק שהתקבלו בקריאה שלישית, מתוך אלה שהגיעו להצבעה במליאה."
            />
            <StatCard label="חברי כנסת" value={c.mks} icon={UsersIcon} accent="var(--chart-2)" />
          </>
        ) : (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)
        )}
      </BlurFade>

      <BlurFade inView delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle>⚖️ חוקים שעברו לאחרונה</CardTitle>
            <CardDescription>לחיצה פותחת את ההצבעה בקריאה השלישית.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={recent} className="h-10">
              {(rows) => (
                <Marquee pauseOnHover speed={35}>
                  {rows.map((r) =>
                    r.final_vote_id == null ? null : (
                      <Badge key={r.bill_id} variant="outline" asChild className="h-auto py-1">
                        <Link to={`/vote/${r.final_vote_id}`}>
                          <GavelIcon data-icon="inline-start" aria-hidden />
                          <span className="max-w-72 truncate">{r.name}</span>
                          <span className="text-muted-foreground tabular-nums">{fmtDate(r.final_date)}</span>
                        </Link>
                      </Badge>
                    )
                  )}
                </Marquee>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView delay={0.15}>
        <Card>
          <CardHeader>
            <CardTitle>רוב החוקים עוברים בלי מתנגדים</CardTitle>
            <CardDescription>הצבעות בקריאה שלישית בכל שנה, לפי האם מישהו הצביע נגד.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={consensus} className="h-64">
              {(rows) => (
                <ChartContainer config={consensusConfig} className="h-64 w-full">
                  <BarChart data={rows.map((r) => ({ ...r, contested: r.finals - r.zero_against }))}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} />
                    <YAxis orientation="right" tickLine={false} axisLine={false} width={32} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="zero_against" stackId="a" fill="var(--color-zero_against)" />
                    <Bar dataKey="contested" stackId="a" fill="var(--color-contested)" />
                  </BarChart>
                </ChartContainer>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView delay={0.2} className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-medium">🧭 לאן ממשיכים?</h2>
        <BentoGrid className="auto-rows-[12rem] grid-cols-1 md:grid-cols-3">
          {SECTIONS.map(({ count, unit, accent, className, ...s }) => (
            <BentoCard
              key={s.to}
              {...s}
              // per-section accent on the icon only (BentoCard has no colour prop)
              className={`${className} shadow-xs [&_svg.size-10]:text-(--accent-c)`}
              style={{ "--accent-c": accent } as React.CSSProperties}
              cta="לעמוד"
              background={
                count &&
                c && (
                  <div className="absolute end-4 top-4 flex flex-col items-end">
                    <NumberTicker value={c[count] as number} format={fmtInt} className="text-2xl font-semibold" />
                    <span className="text-xs text-muted-foreground">{unit}</span>
                  </div>
                )
              }
            />
          ))}
        </BentoGrid>
      </BlurFade>
    </>
  )
}
