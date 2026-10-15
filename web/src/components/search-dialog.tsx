import * as React from "react"
import { useNavigate } from "react-router"
import { SearchIcon } from "lucide-react"

import { SEARCH_SQL } from "@/db/shared"
import { useSql } from "@/db/useSql"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"

const GROUPS = [
  { kind: "mk", heading: "חברי כנסת", path: "/mk/" },
  { kind: "party", heading: "מפלגות", path: "/party/" },
  { kind: "bill", heading: "הצעות חוק", path: "/vote/" }, // id = the bill's latest vote
  { kind: "concept", heading: "מושגים", path: "/concept/" },
]

type Hit = { kind: string; id: string; label: string }

export function SearchDialog() {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const term = React.useDeferredValue(q.trim())
  const navigate = useNavigate()
  const hits = useSql<Hit>("search", SEARCH_SQL, [term], term.length >= 2)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  const go = (h: Hit) => {
    const g = GROUPS.find((x) => x.kind === h.kind)!
    navigate(g.path + encodeURIComponent(h.id))
    setOpen(false)
  }

  return (
    <>
      <Button variant="outline" size="sm" className="max-sm:size-10" onClick={() => setOpen(true)}>
        <SearchIcon data-icon="inline-start" />
        <span className="hidden sm:inline">חיפוש</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="חיפוש" description="חיפוש חברי כנסת, מפלגות, הצעות חוק ומושגים">
        {/* DuckDB filters; cmdk's own fuzzy filter is off */}
        <Command shouldFilter={false}>
        <CommandInput placeholder="שם חבר כנסת, מפלגה או הצעת חוק" value={q} onValueChange={setQ} />
        <CommandList>
          {term.length >= 2 && !hits.isPending && <CommandEmpty>לא נמצאו תוצאות</CommandEmpty>}
          {GROUPS.map((g) => {
            const rows = (hits.data ?? []).filter((h) => h.kind === g.kind)
            return rows.length ? (
              <CommandGroup key={g.kind} heading={g.heading}>
                {rows.map((h) => (
                  <CommandItem key={h.kind + h.id} value={h.kind + h.id} onSelect={() => go(h)}>
                    {h.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null
          })}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
