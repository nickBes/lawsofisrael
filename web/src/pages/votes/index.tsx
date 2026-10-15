import * as React from "react"
import { useSearchParams } from "react-router"
import { CircleCheckIcon, SearchIcon, SwordsIcon, VoteIcon } from "lucide-react"

import { PageHeader } from "@/components/app-shell"
import { KnessetSelect, useKnesset } from "@/components/knesset-select"
import { Pager, usePage } from "@/components/pager"
import { QueryState } from "@/components/query-state"
import { StatCard } from "@/components/stat-card"
import { TopicCombobox } from "@/components/topic-combobox"
import { VotesTable } from "@/components/votes-table"
import { BlurFade } from "@/components/ui/blur-fade"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmtNum, fmtPct } from "@/lib/labels"
import { PAGE_SIZE, useVotes, useVotesSummary } from "./queries"

const STAGES = [
  { value: "all", label: "הכל" },
  { value: "preliminary", label: "טרומית" },
  { value: "first", label: "ראשונה" },
  { value: "third", label: "שלישית" },
]

export function VotesPage() {
  const [sp, setSp] = useSearchParams()
  const [k] = useKnesset()
  const page = usePage()
  const stage = sp.get("stage") ?? "all"
  const topic = sp.get("topic") ?? ""
  const contested = sp.get("contested") === "1"
  const q = sp.get("q") ?? ""
  const term = React.useDeferredValue(q.trim())
  const votes = useVotes({ k, stage, topic, q: term, contested, page })
  const summary = useVotesSummary({ k, stage, topic, q: term, contested })
  const s = summary.data?.[0]

  // every filter change goes back to page 1
  const set = (key: string, value: string) =>
    setSp(
      (prev) => {
        if (value) prev.set(key, value)
        else prev.delete(key)
        prev.delete("page")
        return prev
      },
      { replace: true }
    )

  return (
    <>
      <BlurFade inView>
        <PageHeader title="הצבעות" description="כל הצבעות המליאה בכנסת שנבחרה, מהחדשה לישנה.">
          <KnessetSelect />
        </PageHeader>
      </BlurFade>
      <BlurFade inView delay={0.05} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {s ? (
          <>
            <StatCard label="הצבעות" value={s.n} icon={VoteIcon} accent="var(--chart-1)" />
            <StatCard
              label="התקבלו"
              value={s.accepted_share}
              format={fmtPct}
              icon={CircleCheckIcon}
              accent="var(--chart-5)"
              progress={s.accepted_share == null ? undefined : s.accepted_share * 100}
            />
            <StatCard label="שנויות במחלוקת" value={s.contested} icon={SwordsIcon} accent="var(--chart-4)" hint="הצבעות שבהן הצביעו נגד 10 ח״כים או יותר." />
          </>
        ) : (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)
        )}
      </BlurFade>
      <BlurFade inView delay={0.1}>
        <Card>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="votes-q">חיפוש בכותרת</FieldLabel>
                <InputGroup>
                  <InputGroupInput id="votes-q" value={q} onChange={(e) => set("q", e.target.value)} placeholder="למשל: חוק יסוד" />
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                </InputGroup>
              </Field>
              <Field>
                <FieldLabel id="votes-stage">שלב</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  aria-labelledby="votes-stage"
                  value={stage}
                  onValueChange={(v) => v && set("stage", v === "all" ? "" : v)}
                >
                  {STAGES.map((s) => (
                    <ToggleGroupItem key={s.value} value={s.value}>
                      {s.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="votes-topic">תחום (לפי ועדה)</FieldLabel>
                <TopicCombobox id="votes-topic" value={topic} onChange={(v) => set("topic", v)} />
              </Field>
              <Field orientation="horizontal" className="self-end">
                <Switch id="votes-contested" checked={contested} onCheckedChange={(c) => set("contested", c ? "1" : "")} />
                <FieldLabel htmlFor="votes-contested">רק הצבעות שנויות במחלוקת (10 מתנגדים ומעלה)</FieldLabel>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </BlurFade>
      <BlurFade inView delay={0.15}>
        <Card>
          <CardHeader>
            <CardTitle>תוצאות</CardTitle>
            <CardDescription>{votes.data ? `${fmtNum(votes.data[0]?.total ?? 0)} הצבעות` : "טוען…"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <QueryState query={votes} className="h-96" empty="לא נמצאו הצבעות">
              {(rows) => (
                <>
                  <VotesTable rows={rows} />
                  <Pager total={rows[0].total} pageSize={PAGE_SIZE} />
                </>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>
    </>
  )
}
