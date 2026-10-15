import { Link } from "react-router"

import { SplitBar } from "@/components/split-bar"
import { ResultBadge, StageBadge } from "@/components/stage-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fmtDate, tallySegments } from "@/lib/labels"
import type { VoteRow } from "@/pages/votes/queries"

// Shared by the votes list and the concept page.
// Narrow screens (and md, where the docked sidebar takes 16rem) drop the stage and tally columns; the vote page has both.
export function VotesTable({ rows }: { rows: Omit<VoteRow, "total">[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>תאריך</TableHead>
          <TableHead>נושא ההצבעה</TableHead>
          <TableHead className="max-sm:hidden">שלב</TableHead>
          <TableHead className="min-w-32 max-lg:hidden">בעד / נגד / נמנע</TableHead>
          <TableHead>תוצאה</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((v) => (
          <TableRow key={v.vote_id}>
            <TableCell className="tabular-nums">{fmtDate(v.vote_date)}</TableCell>
            <TableCell className="max-w-96 whitespace-normal lg:min-w-64">
              <Link to={`/vote/${v.vote_id}`} className="underline-offset-4 hover:underline">
                {v.item_title}
              </Link>
            </TableCell>
            <TableCell className="max-sm:hidden">
              <StageBadge stage={v.stage} />
            </TableCell>
            <TableCell className="max-lg:hidden">
              <Tooltip>
                <TooltipTrigger asChild>
                  <SplitBar segments={tallySegments(v)} />
                </TooltipTrigger>
                <TooltipContent className="tabular-nums">
                  {v.n_for} בעד · {v.n_against} נגד · {v.n_abstain} נמנעו
                </TooltipContent>
              </Tooltip>
            </TableCell>
            <TableCell>{v.accepted == null ? "—" : <ResultBadge accepted={v.accepted} />}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
