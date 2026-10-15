import { useSearchParams } from "react-router"

import { Badge } from "@/components/ui/badge"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KNESSETS, SMALL_KNESSETS } from "@/lib/labels"

// ?k= from the URL. When `options` is given (Knessets an MK or party served in), an unknown k (incl. "all") falls back to the latest one.
export function useKnesset(options: number[] = KNESSETS) {
  const [sp, setSp] = useSearchParams()
  const raw = Number(sp.get("k") ?? 25)
  const k = options.includes(raw) ? raw : (options.at(-1) ?? 25)
  const setK = (v: number | "all") =>
    setSp((prev) => {
      prev.set("k", String(v))
      prev.delete("page")
      return prev
    })
  return [k, setK] as const
}

// MK and party pages: ?k=all → null (every Knesset), passed straight to `knesset_num = coalesce(?::INTEGER, knesset_num)`
export function useKnessetOrAll(options: number[]) {
  const [sp] = useSearchParams()
  const [k] = useKnesset(options)
  return sp.get("k") === "all" ? null : k
}

export const kParam = (k: number | null) => k ?? "all"
export const knessetLabel = (k: number | null) => (k == null ? "בכל הכנסות" : `בכנסת ה-${k}`)

export function KnessetSelect({ options = KNESSETS, allowAll }: { options?: number[]; allowAll?: boolean }) {
  const [sp] = useSearchParams()
  const [k, setK] = useKnesset(options)
  const value = allowAll && sp.get("k") === "all" ? "all" : String(k)
  return (
    <Field orientation="horizontal" className="w-fit">
      <FieldLabel htmlFor="knesset-select">כנסת</FieldLabel>
      <Select value={value} onValueChange={(v) => setK(v === "all" ? "all" : Number(v))}>
        <SelectTrigger id="knesset-select" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowAll && (
            <>
              <SelectGroup>
                <SelectItem value="all">כל הכנסות</SelectItem>
              </SelectGroup>
              <SelectSeparator />
            </>
          )}
          <SelectGroup>
            {options.toReversed().map((n) => (
              <SelectItem key={n} value={String(n)}>
                הכנסת ה-{n}
                {SMALL_KNESSETS.includes(n) && <Badge variant="outline">מדגם קטן</Badge>}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
