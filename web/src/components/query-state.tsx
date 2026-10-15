import type * as React from "react"
import type { UseQueryResult } from "@tanstack/react-query"
import { AlertCircleIcon, InboxIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

// Skeleton while loading, Alert on error, Empty when there are no rows.
export function QueryState<T>({
  query,
  children,
  className = "h-48",
  empty = "אין נתונים להצגה",
  description = "נסו כנסת אחרת או סננים אחרים.",
}: {
  query: UseQueryResult<T[]>
  children: (rows: T[]) => React.ReactNode
  className?: string
  empty?: string
  description?: string
}) {
  if (query.isPending) return <Skeleton className={cn("w-full", className)} />
  if (query.isError)
    return (
      <Alert variant="destructive" data-testid="query-error">
        <AlertCircleIcon />
        <AlertTitle>השאילתה נכשלה</AlertTitle>
        <AlertDescription>{String(query.error)}</AlertDescription>
      </Alert>
    )
  if (query.data.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>{empty}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return children(query.data)
}
