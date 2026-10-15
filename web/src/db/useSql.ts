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

export const useSql = <T>(name: string, sql: string, params: unknown[] = [], enabled = true) =>
  useQuery({ queryKey: ["sql", name, ...params], queryFn: () => runSql<T>(sql, params), enabled })
