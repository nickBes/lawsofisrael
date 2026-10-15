import * as React from "react"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ItemGroup } from "@/components/ui/item"

// First `initial` items, the rest behind a "show all" toggle. `className` styles both item groups (e.g. a grid).
export function ShowMore<T>({
  items,
  initial = 5,
  render,
  className = "gap-2",
}: {
  items: T[]
  initial?: number
  render: (item: T) => React.ReactNode
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const rest = items.slice(initial)
  const list = (xs: T[]) => (
    <ItemGroup className={className}>
      {xs.map((x, i) => (
        <React.Fragment key={i}>{render(x)}</React.Fragment>
      ))}
    </ItemGroup>
  )
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
      {list(items.slice(0, initial))}
      {rest.length > 0 && (
        <>
          <CollapsibleContent>{list(rest)}</CollapsibleContent>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="self-start">
              {open ? "הצג פחות" : `הצג הכל (${items.length})`}
              {open ? <ChevronUpIcon data-icon="inline-end" /> : <ChevronDownIcon data-icon="inline-end" />}
            </Button>
          </CollapsibleTrigger>
        </>
      )}
    </Collapsible>
  )
}
