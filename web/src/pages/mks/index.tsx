import * as React from "react"
import { Link, useSearchParams } from "react-router"
import { ActivityIcon, SearchIcon, UsersIcon } from "lucide-react"

import { PageHeader } from "@/components/app-shell"
import { KnessetSelect, useKnesset } from "@/components/knesset-select"
import { MkAvatar } from "@/components/mk-avatar"
import { QueryState } from "@/components/query-state"
import { StatCard } from "@/components/stat-card"
import { BlurFade } from "@/components/ui/blur-fade"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { partyColor } from "@/db/shared"
import { fmtNum, fmtPct } from "@/lib/labels"
import { usePartiesList } from "@/pages/parties/queries"
import { useMks } from "./queries"

const ALL = "all"
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

export function MksPage() {
  const [sp, setSp] = useSearchParams()
  const [k] = useKnesset()
  const q = sp.get("q") ?? ""
  const party = sp.get("party") ?? ""
  const term = React.useDeferredValue(q.trim())
  const mks = useMks(k, term, party)
  const parties = usePartiesList(k)
  const medianParticipation = median((mks.data ?? []).map((r) => r.participation))
  const set = (key: string, value: string) =>
    setSp(
      (prev) => {
        if (value) prev.set(key, value)
        else prev.delete(key)
        return prev
      },
      { replace: true }
    )

  return (
    <>
      <BlurFade inView>
        <PageHeader title="חברי כנסת" description="כל מי שהצביע במליאה בכנסת שנבחרה.">
          <KnessetSelect />
        </PageHeader>
      </BlurFade>
      <BlurFade inView delay={0.05} className="grid grid-cols-2 gap-4">
        {mks.data ? (
          <>
            <StatCard label="חברי כנסת" value={mks.data.length} icon={UsersIcon} accent="var(--chart-2)" />
            <StatCard
              label="השתתפות חציונית"
              value={medianParticipation}
              format={fmtPct}
              icon={ActivityIcon}
              accent="var(--chart-1)"
              progress={medianParticipation == null ? undefined : medianParticipation * 100}
            />
          </>
        ) : (
          [1, 2].map((i) => <Skeleton key={i} className="h-24" />)
        )}
      </BlurFade>
      <BlurFade inView delay={0.1}>
        <Card>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="mks-q">שם</FieldLabel>
                <InputGroup>
                  <InputGroupInput id="mks-q" value={q} onChange={(e) => set("q", e.target.value)} placeholder="חיפוש לפי שם" />
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                </InputGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="mks-party">מפלגה</FieldLabel>
                <Select value={party || ALL} onValueChange={(v) => set("party", v === ALL ? "" : v)}>
                  <SelectTrigger id="mks-party" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={ALL}>כל המפלגות</SelectItem>
                      {(parties.data ?? []).map((p) => (
                        <SelectItem key={p.party_id} value={p.party_id}>
                          {p.party_name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </BlurFade>
      <BlurFade inView delay={0.15}>
        <Card>
          <CardHeader>
            <CardTitle>חברי הכנסת ה-{k}</CardTitle>
            <CardDescription>מפלגה: המפלגה האחרונה שבה כיהנו בכנסת זו.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={mks} className="h-96" empty="לא נמצאו חברי כנסת">
              {(rows) => (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>שם</TableHead>
                      <TableHead>מפלגה</TableHead>
                      <TableHead className="max-lg:hidden">הצבעות</TableHead>
                      <TableHead>השתתפות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((m) => (
                      <TableRow key={m.member_id}>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <MkAvatar size="sm" name={m.member_name} photoUrl={m.photo_url} />
                            {/* taller tap area below md, the negative margin keeps the row height */}
                            <Link to={`/mk/${m.member_id}?k=${k}`} className="underline-offset-4 hover:underline max-md:-my-2.5 max-md:py-2.5">
                              {m.member_name}
                            </Link>
                          </span>
                        </TableCell>
                        <TableCell className="max-lg:whitespace-normal">
                          <span className="flex items-center gap-2">
                            {m.color_index != null && <span className="size-2.5 shrink-0 rounded-full" style={{ background: partyColor(m.color_index) }} />}
                            {m.party_name ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums max-lg:hidden">{fmtNum(m.n_ballots)}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2 tabular-nums">
                            <Progress value={m.participation * 100} className="w-24 max-lg:hidden" aria-label={`השתתפות ${fmtPct(m.participation)}`} />
                            {fmtPct(m.participation)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>
    </>
  )
}
