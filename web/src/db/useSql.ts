import { useQuery } from "@tanstack/react-query"
import { getConn } from "./duckdb"

// Arrow returns BIGINT as bigint; the UI only shows counts well below 2^53.
const plain = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]))

export async function runSql<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await getConn()
  const stmt = await conn.prepare(sql) // `?` placeholders: user input never enters SQL text
  try {
    return (await stmt.query(...params)).toArray().map((r) => plain(r.toJSON()) as T)
  } finally {
    await stmt.close()
  }
}

// keepIfSame = n: while new params load, keep showing the old rows if the first n params are unchanged
// (e.g. same MK and Knesset, only mode/page changed), so the list doesn't collapse to a skeleton
export const useSql = <T>(name: string, sql: string, params: unknown[] = [], enabled = true, keepIfSame = 0) =>
  useQuery({
    queryKey: ["sql", name, ...params],
    queryFn: () => runSql<T>(sql, params),
    enabled,
    placeholderData: (prev, prevQuery) =>
      keepIfSame && prevQuery?.queryKey.slice(2, 2 + keepIfSame).every((p, i) => p === params[i]) ? prev : undefined,
  })
