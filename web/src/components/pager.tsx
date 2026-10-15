import { useHref, useSearchParams } from "react-router"

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

export const usePage = () => {
  const [sp] = useSearchParams()
  return Math.max(1, Number(sp.get("page") ?? 1))
}

// Previous / next links bound to ?page=, keeping the other search params.
export function Pager({ total, pageSize }: { total: number; pageSize: number }) {
  const [sp] = useSearchParams()
  const page = usePage()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const at = (p: number) => {
    const next = new URLSearchParams(sp)
    next.set("page", String(p))
    return `?${next}`
  }
  const prevHref = useHref(at(page - 1))
  const nextHref = useHref(at(page + 1))
  if (pages <= 1) return null
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious text="הקודם" className="max-sm:size-10" href={page > 1 ? prevHref : undefined} aria-disabled={page <= 1} />
        </PaginationItem>
        <PaginationItem className="px-3 text-sm text-muted-foreground tabular-nums">
          עמוד {page} מתוך {pages}
        </PaginationItem>
        <PaginationItem>
          <PaginationNext text="הבא" className="max-sm:size-10" href={page < pages ? nextHref : undefined} aria-disabled={page >= pages} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
