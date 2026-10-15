import * as React from "react"
import { queryOptions, useQuery } from "@tanstack/react-query"
import { AlertCircleIcon, CircleCheckIcon, RotateCwIcon } from "lucide-react"

import { initDb, type Progress } from "@/db/duckdb"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AnimatedList } from "@/components/ui/animated-list"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress as ProgressBar } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"

let report: (p: Progress) => void = () => {}

// Shared so the shell can read `persistent` from the cache.
export const dbQuery = queryOptions({
  queryKey: ["db"],
  queryFn: () => initDb((p) => report(p)).then((d) => ({ persistent: d.persistent })),
  staleTime: Infinity,
  retry: false,
})

const STEP_LABEL: Record<string, string> = {
  fact_votes: "🗳️ הצבעות המליאה",
  fact_ballots: "🙋 הצבעות חברי הכנסת",
  fact_vote_counters: "🔢 תוצאות ההצבעות",
  bridge_vote_bills: "🔗 קישור הצבעות להצעות חוק",
  dim_bills: "📜 הצעות חוק",
  dim_members: "👥 חברי הכנסת",
  bridge_member_factions: "🏷️ שיוך לסיעות",
  dim_governments: "🏛️ ממשלות ושרים",
  faction_lineage: "🧬 גלגולי המפלגות",
  parties: "🚩 מפלגות",
  coalition_membership: "🤝 קואליציה ואופוזיציה",
  committee_topics: "🗂️ ועדות הכנסת",
  topics: "🗂️ תחומי ועדות",
  member_name_aliases: "🔤 שמות חלופיים",
  mk_photos: "📸 תמונות חברי הכנסת",
  dim_concepts: "💡 מושגים מתוך החוקים",
  bridge_bill_concepts: "💡 קישור חוקים למושגים",
  dim_bullets: "📝 תקצירי סעיפים מתוך הצעות החוק",
  derived: "⚙️ מחשב ניתוחים…",
}

export function DbGate({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = React.useState<Progress | null>(null)
  const [steps, setSteps] = React.useState<string[]>([])
  React.useEffect(() => {
    report = (p) => {
      setProgress(p)
      // done === 0 starts over (the :memory: retry reloads every table)
      setSteps((s) => (p.done === 0 ? [p.step] : s.includes(p.step) ? s : [...s, p.step]))
    }
  }, [])
  const db = useQuery(dbQuery)

  if (db.isSuccess) return children

  const current = progress ? steps.indexOf(progress.step) : -1
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      {db.isError ? (
        <Alert variant="destructive" className="max-w-md">
          <AlertCircleIcon />
          <AlertTitle>טעינת הנתונים נכשלה</AlertTitle>
          <AlertDescription>
            <p>{String(db.error)}</p>
            <Button variant="outline" size="sm" onClick={() => location.reload()}>
              <RotateCwIcon data-icon="inline-start" />
              נסו שוב
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="w-full max-w-md" data-testid="db-loader">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Spinner />
              טוען נתונים
            </CardTitle>
            <CardDescription>{progress ? "טוענים את הנתונים לדפדפן, פעם אחת בלבד" : "מאתחל את מסד הנתונים בדפדפן"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ProgressBar value={progress ? (100 * progress.done) / progress.total : 0} aria-label="התקדמות הטעינה" />
            <div aria-live="polite">
              <AnimatedList delay={100} className="gap-1">
                {steps.map((s, i) => (
                  <div key={s} className="flex items-center gap-2 text-sm">
                    {i < current ? <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-chart-5" /> : <Spinner />}
                    {STEP_LABEL[s] ?? "טוען נתונים"}
                  </div>
                ))}
              </AnimatedList>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
