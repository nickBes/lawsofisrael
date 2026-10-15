// CI + local: copy the data files into public/data and write manifest.json (version = hash of all files).
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

const SRC = [
  ...["fact_votes", "fact_ballots", "fact_vote_counters", "bridge_vote_bills", "dim_bills", "dim_members", "bridge_member_factions", "dim_governments"]
    .map((t) => [t, `../dataset/knesset_votes/prepared/${t}.parquet`]),
  ...["faction_lineage", "parties", "coalition_membership", "committee_topics", "topics", "member_name_aliases", "mk_photos"]
    .map((t) => [t, `../dataset/curated/${t}.csv`]),
  ...["dim_concepts", "bridge_bill_concepts", "dim_bullets"].map((t) => [t, `../dataset/bill_concepts/prepared/${t}.parquet`]),
]

mkdirSync("public/data", { recursive: true })
const hash = createHash("sha256")
const files = []
for (const [table, src] of SRC) {
  const buf = readFileSync(src)
  hash.update(buf)
  const file = src.split("/").pop()
  copyFileSync(src, `public/data/${file}`)
  files.push({ table, file, bytes: buf.length })
}
// derived.sql changes the built tables, so it is part of the version too.
hash.update(readFileSync("src/db/derived.sql"))
writeFileSync("public/data/manifest.json", JSON.stringify({ version: hash.digest("hex").slice(0, 16), files }))
console.log(`copied ${files.length} files`)
