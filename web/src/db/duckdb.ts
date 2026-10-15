import * as duckdb from "@duckdb/duckdb-wasm"
import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url"
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url"
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url"
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url"
import derivedSql from "./derived.sql?raw"

export type Progress = { step: string; done: number; total: number }
type Manifest = { version: string; files: { table: string; file: string; bytes: number }[] }

let connPromise: Promise<{ conn: duckdb.AsyncDuckDBConnection; persistent: boolean }> | null = null
export const getConn = () =>
  (connPromise ?? Promise.reject(new Error("db not initialised"))).then((d) => d.conn)

// Best effort: a file another tab still holds open can't be removed, and that's fine.
async function removeOpfs(drop: (name: string) => boolean) {
  const root = await navigator.storage.getDirectory()
  const names: string[] = []
  for await (const n of root.keys()) names.push(n)
  await Promise.all(names.filter(drop).map((n) => root.removeEntry(n).catch(() => {})))
}

async function openDb(bundle: duckdb.DuckDBBundle, path: string, manifest: Manifest, onProgress: (p: Progress) => void) {
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(bundle.mainWorker!))
  try {
    await db.instantiate(bundle.mainModule)
    await db.open({ path, accessMode: duckdb.DuckDBAccessMode.READ_WRITE })
    const conn = await db.connect()

    const current = await conn
      .query("SELECT version FROM meta")
      .then((t) => t.toArray()[0]?.version as string | undefined)
      .catch(() => undefined)
    if (current === manifest.version) return conn // second visit: zero data requests

    const base = import.meta.env.BASE_URL
    const total = manifest.files.reduce((s, f) => s + f.bytes, 0)
    let done = 0
    for (const f of manifest.files) {
      onProgress({ step: f.table, done, total })
      const res = await fetch(`${base}data/${f.file}?v=${manifest.version}`) // version key: never mix HTTP-cached old files into a new DB
      if (!res.ok) throw new Error(`${f.file}: HTTP ${res.status}`)
      await db.registerFileBuffer(f.file, new Uint8Array(await res.arrayBuffer()))
      // Table and file names come from our own CI-built manifest, never from user input.
      const reader = f.file.endsWith(".csv") ? `read_csv('${f.file}', header = true)` : `'${f.file}'`
      await conn.query(`CREATE OR REPLACE TABLE ${f.table} AS SELECT * FROM ${reader}`)
      await db.dropFile(f.file)
      done += f.bytes
    }
    onProgress({ step: "derived", done, total })
    await conn.query(derivedSql)
    await conn.query(`CREATE OR REPLACE TABLE meta AS SELECT '${manifest.version}' AS version`)
    if (path !== ":memory:") await conn.query("CHECKPOINT") // the tab can die at any time; make the load durable
    return conn
  } catch (e) {
    await db.terminate() // releases the OPFS handles
    throw e
  }
}

export function initDb(onProgress: (p: Progress) => void) {
  return (connPromise ??= (async () => {
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
      eh: { mainModule: ehWasm, mainWorker: ehWorker },
    })
    const manifest: Manifest = await fetch(`${import.meta.env.BASE_URL}data/manifest.json`, { cache: "no-cache" }).then((r) =>
      r.json(),
    )
    // One file per data version: duckdb-wasm fails to commit into a reopened OPFS file
    // ("File is not opened in write mode"), so a new version always loads into a fresh file.
    const file = `lawsofisrael-${manifest.version}.duckdb`
    try {
      const conn = await openDb(bundle, `opfs://${file}`, manifest, onProgress)
      await removeOpfs((n) => n.startsWith("lawsofisrael") && !n.startsWith(file)).catch(() => {})
      return { conn, persistent: true }
    } catch (e) {
      // No OPFS, another tab holds the file, or a half-written file: load into memory instead,
      // and drop this version's file so the next visit starts clean.
      console.warn("OPFS load failed, using memory", e)
      await removeOpfs((n) => n.startsWith(file)).catch(() => {})
      return { conn: await openDb(bundle, ":memory:", manifest, onProgress), persistent: false }
    }
  })())
}
