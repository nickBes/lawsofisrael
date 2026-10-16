# Self-check for derived.sql and the concept queries, in native DuckDB.
# Usage (repo root, after `cd web && npm run data`): uv run --no-project --with duckdb python web/scripts/check-derived.py
# Loads exactly the files in public/data/manifest.json, runs derived.sql, then runs the page queries straight
# from the queries.ts files with sample ids. Exits non-zero on the first failed assert or SQL error.
import json
import pathlib
import re
import time

import duckdb

WEB = pathlib.Path(__file__).resolve().parent.parent
DATA = WEB / "public/data"
SCRIPT_RE = r"[^\p{Hebrew}\p{Latin}\P{L}]|\p{Hebrew}\p{Latin}|\p{Latin}\p{Hebrew}"

con = duckdb.connect()
for f in json.loads((DATA / "manifest.json").read_text())["files"]:
    path = (DATA / f["file"]).as_posix()
    reader = f"read_csv('{path}', header = true)" if f["file"].endswith(".csv") else f"'{path}'"
    con.execute(f"CREATE OR REPLACE TABLE {f['table']} AS SELECT * FROM {reader}")
for stmt in (WEB / "src/db/derived.sql").read_text().split(";\n"):
    if stmt.strip():
        con.execute(stmt)

one = lambda sql, *p: con.execute(sql, list(p)).fetchone()[0]

assert one("SELECT count(*) FROM ballots_x WHERE party_id IS NULL") == 0, "ballots without a party"
assert one("SELECT count(*) FROM ballots_x") == one("SELECT count(*) FROM fact_ballots JOIN votes USING (vote_id)"), "ballots_x fan-out"
assert one("SELECT count(*) FROM votes WHERE vote_id NOT IN (SELECT vote_id FROM vote_stage)") == 0, "votes without a stage"
assert one("SELECT count(*) FROM concepts WHERE regexp_matches(concept_label, ?)", SCRIPT_RE) == 0, "script artifacts kept"
assert one("SELECT count(*) FROM concepts WHERE concept_id NOT IN (SELECT concept_id FROM dim_concepts)") == 0, "unknown concept_id"
assert one("SELECT count(*) FROM search_index WHERE kind = 'concept'") == one("SELECT count(*) FROM concepts"), "concepts not searchable"
print(f"concepts kept {one('SELECT count(*) FROM concepts')} of {one('SELECT count(*) FROM dim_concepts')}, "
      f"generic {one('SELECT count(*) FROM concepts WHERE is_generic')}")

# every `export const NAME = /* sql */ `...`` in the page query files
SQL = {}
for qf in WEB.glob("src/pages/*/queries.ts"):
    SQL.update(re.findall(r"export const (\w+) = /\* sql \*/ `(.*?)`", qf.read_text(), re.S))

concept = one("SELECT concept_id FROM concepts WHERE NOT is_generic ORDER BY n_bills DESC, concept_id LIMIT 1")
vote16 = one("""SELECT min(v.vote_id) FROM votes v JOIN bridge_bill_concepts bc USING (bill_id) JOIN concepts c USING (concept_id)
                WHERE v.knesset_num = 16 AND v.has_ballots""")
print("sample concept:", concept, "| K16 vote with concepts:", vote16)

def run(name, *params, expect_rows=None):
    rows = con.execute(SQL[name], list(params)).fetchall()
    print(f"{name}{params}: {len(rows)} rows")
    if expect_rows is not None:
        assert (len(rows) > 0) == expect_rows, f"{name}: expected {'rows' if expect_rows else 'no rows'}"
    return rows

run("CONCEPTS_SUMMARY_SQL", expect_rows=True)
run("CONCEPTS_LIST_SQL", False, "", "", expect_rows=True)
run("CONCEPTS_LIST_SQL", True, "", "")
run("CONCEPTS_LIST_SQL", False, "חוק", "חוק")
assert len(run("CONCEPT_SQL", concept)) == 1
run("CONCEPT_PARTIES_SQL", concept)
run("CONCEPT_BILLS_SQL", concept, expect_rows=True)
run("CONCEPT_CONTESTED_SQL", concept)
# party chart counts: for_share is exactly n_for / (n_for + n_against)
for c_id in [concept, "concept_d9a4bc90c63922b335b0d622"]:
    for r in run("CONCEPT_PARTIES_SQL", c_id):
        assert r[5] + r[6] > 0 and abs(r[3] - r[5] / (r[5] + r[6])) < 1e-9, f"for_share vs counts: {r}"
stages = run("CONCEPT_STAGES_SQL", concept, expect_rows=True)
stage_rows = [r for r in stages if r[0] is not None]
tot = {r[1]: r for r in stages if r[0] is None}
assert sum(r[2] for r in stage_rows if r[0] in ("preliminary", "first", "third")) == tot[True][2], "counted totals vs stage rows"
assert sum(r[2] for r in stage_rows) == one("""SELECT count(DISTINCT vote_id) FROM bridge_bill_concepts JOIN votes USING (bill_id)
                                               WHERE concept_id = ?""", concept), "stage rows vs votes"
# mock-specific consensus concept: no counted vote had an against, 3 reservation votes did
CONS = "concept_d9a4bc90c63922b335b0d622"
if one("SELECT count(*) FROM concepts WHERE concept_id = ?", CONS):
    st = run("CONCEPT_STAGES_SQL", CONS, expect_rows=True)
    print("  ", CONS, "stages:", st)
    assert sum(r[3] for r in st if r[0] in ("preliminary", "first", "third")) == 0, "consensus concept has counted opposition"
    assert next(r[3] for r in st if r[0] == "reservation") == 3, "consensus concept reservation opposition"
contested_c = con.execute("""SELECT bc.concept_id, count(DISTINCT v.vote_id) FILTER (v.n_against > 0) AS x
  FROM bridge_bill_concepts bc JOIN concepts c USING (concept_id) JOIN votes v USING (bill_id) JOIN vote_stage s USING (vote_id)
  WHERE s.stage IN ('preliminary','first','third') GROUP BY 1 ORDER BY x DESC, 1 LIMIT 1""").fetchone()
print("  most contested concept (counted stages):", contested_c)
run("VOTE_CONCEPTS_SQL", vote16, expect_rows=True)
run("VOTE_CONCEPTS_SQL", 46699)
mk17 = run("MK_CONCEPTS_SQL", 206, 17)
run("MK_CONCEPTS_SQL", 771, 25)
if mk17:
    cv = run("MK_CONCEPT_VOTES_SQL", mk17[0][0], 206, 17, expect_rows=True)
    assert all(r[6] for r in cv), "MK concept vote without its bill's primary bullet"
    run("MK_CONCEPT_VOTES_SQL", mk17[0][0], 206, None, expect_rows=True)

# evidence bullets (dim_bullets): unique, every referenced id resolves, primary is one of the row's bullets
assert one("SELECT count(*) - count(DISTINCT bullet_row_id) FROM dim_bullets") == 0, "dim_bullets not unique"
unresolved = one("""WITH ids AS (
    SELECT unnest(bullet_ids) AS id FROM bridge_bill_concepts UNION SELECT primary_evidence_bullet_id FROM bridge_bill_concepts
    UNION SELECT unnest(representative_bullet_ids) FROM dim_concepts)
  SELECT count(*) FROM ids WHERE id IS NOT NULL AND id NOT IN (SELECT bullet_row_id FROM dim_bullets)""")
assert unresolved == 0, f"{unresolved} unresolved bullet ids"
not_listed = one("""SELECT count(*) FROM bridge_bill_concepts
  WHERE primary_evidence_bullet_id IS NOT NULL AND NOT list_contains(bullet_ids, primary_evidence_bullet_id)""")
assert not_listed == 0, f"{not_listed} primary bullets missing from bullet_ids (add the OR fallback to the evidence joins)"
print("dim_bullets:", one("SELECT count(*) FROM dim_bullets"), "rows")
run("CONCEPT_EVIDENCE_SQL", concept, expect_rows=True)
run("VOTE_EVIDENCE_SQL", vote16, expect_rows=True)
run("VOTE_EVIDENCE_SQL", 46699)
run("PARTY_CONCEPTS_SQL", "likud", 17)
run("PARTY_CONCEPTS_SQL", "likud", 25)

# concept pies: [id, label, n_votes, a_share, a_for, a_against, b_share, b_for, b_against]
def dumbbell(name, *params):
    rows = run(name, *params)
    n = [r[2] for r in rows]
    assert n == sorted(n, reverse=True), f"{name}{params}: not sorted by votes"
    assert len(rows) <= 50, f"{name}{params}: over the limit"
    for r in rows:
        assert r[2] >= 5, f"{name}: under the 5-vote threshold {r}"
        assert abs(r[3] - r[4] / (r[4] + r[5])) < 1e-9 and abs(r[6] - r[7] / (r[7] + r[8])) < 1e-9, f"{name}: share vs counts {r}"
        assert r[7] >= r[4] and r[8] >= r[5], f"{name}: comparison side must contain the subject's ballots {r}"
    return rows

assert not dumbbell("MK_CONCEPTS_SQL", 771, 25), "mock has no K25 concepts: expected the Empty state"
for k in (17, None):
    rows = dumbbell("MK_CONCEPTS_SQL", 206, k)
    assert rows and all(r[2] == r[4] + r[5] for r in rows), f"MK 206 k={k}: one ballot per vote"
    assert any(r[5] for r in rows), f"MK 206 k={k}: no against ballots kept, the chart's left side would be empty"
    old = {r[0]: (r[1], r[2]) for r in con.execute("""
      SELECT c.concept_id, count(*) FILTER (b.choice = 'for'), count(*) FILTER (b.choice = 'against')
      FROM ballots_x b JOIN bridge_bill_concepts bc USING (bill_id) JOIN concepts c USING (concept_id)
      WHERE b.member_id = ? AND b.knesset_num = coalesce(?::INTEGER, b.knesset_num) AND b.stage IN ('preliminary','first','third')
        AND b.choice IN ('for','against') AND NOT c.is_generic GROUP BY 1""", [206, k]).fetchall()}
    assert all(old[r[0]] == (r[4], r[5]) for r in rows), f"MK 206 k={k}: counts differ from the old per-concept counts"
    if k == 17:
        party_side = con.execute("""
          WITH mv AS (SELECT b.vote_id, b.party_id FROM ballots_x b JOIN bridge_bill_concepts bc USING (bill_id)
            WHERE bc.concept_id = ? AND b.member_id = 206 AND b.knesset_num = 17 AND b.choice IN ('for','against')
              AND b.stage IN ('preliminary','first','third'))
          SELECT count(*) FILTER (o.choice = 'for'), count(*) FILTER (o.choice = 'against') FROM ballots_x o JOIN mv USING (vote_id, party_id)
          """, [rows[0][0]]).fetchone()
        assert party_side == (rows[0][7], rows[0][8]), f"MK dumbbell party side {party_side} vs {rows[0]}"
    print(f"  MK 206 k={k} dumbbell top:", rows[0][1][:40], f"{rows[0][3]:.2f} vs {rows[0][6]:.2f} n={rows[0][2]}")
assert dumbbell("PARTY_CONCEPTS_SQL", "likud", 17)
assert not dumbbell("PARTY_CONCEPTS_SQL", "likud", 25), "mock has no K25 concepts"
pc = dumbbell("PARTY_CONCEPTS_SQL", "likud", None)
assert pc and any(r[5] for r in pc), "likud all: no against ballots kept"
for r in pc[:3]:
    cp = next(x for x in run("CONCEPT_PARTIES_SQL", r[0]) if x[0] == "likud")
    assert (cp[4], cp[5], cp[6]) == (r[2], r[4], r[5]) and abs(cp[3] - r[3]) < 1e-9, f"party dumbbell vs concept page: {cp} {r}"
k_side = con.execute("""
  WITH pvotes AS (SELECT DISTINCT b.vote_id FROM ballots_x b JOIN bridge_bill_concepts bc USING (bill_id)
    WHERE bc.concept_id = ? AND b.party_id = 'likud' AND b.choice IN ('for','against') AND b.stage IN ('preliminary','first','third'))
  SELECT count(*) FILTER (choice = 'for'), count(*) FILTER (choice = 'against')
  FROM ballots_x WHERE vote_id IN (SELECT vote_id FROM pvotes)""", [pc[0][0]]).fetchone()
assert k_side == (pc[0][7], pc[0][8]), f"party dumbbell Knesset side {k_side} vs {pc[0]}"
print("  likud all dumbbell top:", pc[0][1][:40], f"{pc[0][3]:.2f} vs {pc[0][6]:.2f} n={pc[0][2]}")
# changed non-concept queries
yearly = run("MK_YEARLY_SQL", 771, 25, expect_rows=True)
print("  MK 771 K25 yearly for/against:", [(r[0], r[1], r[2]) for r in yearly])
run("MK_BILLS_SQL", 771, 25)
run("PARTY_BILLS_SQL", 25, "likud")
run("VOTES_SUMMARY_SQL", 25, "all", "all", "", "", "", "", False, expect_rows=True)

# MK photos: one official URL per member, and the photo joins don't fan out
assert one("SELECT count(*) - count(DISTINCT member_id) FROM mk_photos") == 0, "mk_photos not unique"
assert one("SELECT count(*) FROM mk_photos WHERE NOT starts_with(photo_url, 'https://fs.knesset.gov.il/')") == 0, "non-official photo host"
print("photos for ballot members:", one("SELECT count(DISTINCT member_id) FROM fact_ballots JOIN mk_photos USING (member_id)"), "of",
      one("SELECT count(DISTINCT member_id) FROM fact_ballots"))
run("MK_SERVICE_SQL", 771, expect_rows=True)
mks25 = run("MKS_SQL", 25, "", "", "", "", expect_rows=True)
assert len(mks25) == one("SELECT count(*) FROM mk_service WHERE knesset_num = 25"), "MKS_SQL fan-out"
run("MK_SIMILAR_SQL", 771, 25, 771, 25, 771, True, expect_rows=True)
run("VOTE_MKS_SQL", 46699, expect_rows=True)
run("PARTY_MEMBERS_SQL", 25, "likud", expect_rows=True)
faces = run("PARTIES_FACES_SQL", 25, expect_rows=True)
assert max(sum(1 for f in faces if f[0] == p) for p in {f[0] for f in faces}) <= 5, "more than 5 faces per party"

# MK agreement with party; against_party must match the pre-change filter
kpi = run("MK_KPI_SQL", 771, 25, expect_rows=True)
old_against = one("""WITH s AS (SELECT * FROM mk_service WHERE member_id = 771 AND knesset_num = 25)
  SELECT count(*) FROM ballots_x b JOIN party_vote pv USING (vote_id, party_id), s
  WHERE b.member_id = s.member_id AND b.knesset_num = s.knesset_num AND b.choice IN ('for','against')
    AND pv.position IN ('for','against') AND b.choice <> pv.position AND pv.n_for + pv.n_against >= 3""")
assert kpi[0][2] == old_against, f"against_party changed: {kpi[0][2]} vs {old_against}"
print("  MK 771 K25 against_party / agreement:", kpi[0][2], kpi[0][3])
print("  MK 206 K17 against_party / agreement:", run("MK_KPI_SQL", 206, 17, expect_rows=True)[0][2:4])

# all Knessets (?k=all → None): sums match the per-Knesset values, members deduped
for mk in (206, 771):
    ks = [r[0] for r in con.execute("SELECT knesset_num FROM mk_service WHERE member_id = ? ORDER BY 1", [mk]).fetchall()]
    t = time.perf_counter()
    allk = run("MK_KPI_SQL", mk, None, expect_rows=True)[0]
    t_kpi = time.perf_counter() - t
    per = [run("MK_KPI_SQL", mk, k)[0] for k in ks]
    assert allk[0] == sum(r[0] for r in per) and allk[2] == sum(r[2] for r in per), f"MK {mk} all-mode KPI vs sum: {allk} {per}"
    t = time.perf_counter()
    sim = run("MK_SIMILAR_SQL", mk, None, mk, None, mk, True, expect_rows=True)
    t_sim = time.perf_counter() - t
    print(f"  MK {mk} all Knessets {ks}: n_ballots {allk[0]} participation {allk[1]:.4f} against_party {allk[2]} "
          f"agreement {allk[3]:.4f} bills {allk[4]}/{allk[5]} max_gap {allk[6]} | similar top {sim[0][1]} {sim[0][6]:.3f} "
          f"| native KPI {t_kpi:.3f}s SIMILAR {t_sim:.3f}s")
    run("MK_SIMILAR_SQL", mk, None, mk, None, mk, False, expect_rows=True)
    run("MK_YEARLY_SQL", mk, None, expect_rows=True)
    run("MK_PARTICIPATION_SQL", mk, None, mk, expect_rows=True)
    run("MK_AGAINST_PARTY_SQL", mk, None, expect_rows=True)
    run("MK_BILLS_SQL", mk, None)
    mkc = run("MK_CONCEPTS_SQL", mk, None)
    if mkc:
        run("MK_CONCEPT_VOTES_SQL", mkc[0][0], mk, None, expect_rows=True)
n_likud = one("SELECT count(DISTINCT member_id) FROM mk_service WHERE last_party_id = 'likud'")
members = run("PARTY_MEMBERS_SQL", None, "likud", expect_rows=True)
assert len(members) == len({r[0] for r in members}) == n_likud, f"likud members: {len(members)} rows vs {n_likud} distinct"
pkpi = run("PARTY_KPI_SQL", None, "likud", "likud", None, expect_rows=True)[0]
assert pkpi[0] == n_likud, f"likud n_mks {pkpi[0]} vs {n_likud}"
coal = run("PARTY_COALITION_SQL", "likud", None, expect_rows=True)
assert len({r[0] for r in coal}) > 1, "likud coalition spans one Knesset"
run("PARTY_CONCEPTS_SQL", "likud", None, expect_rows=True)
run("PARTY_DIVISIVE_SQL", "likud", None, expect_rows=True)
run("PARTY_BILLS_SQL", None, "likud", expect_rows=True)
print(f"  likud all Knessets: n_mks {pkpi[0]} participation {pkpi[1]:.4f} cohesion {pkpi[2]:.4f} "
      f"sided_with_coalition {pkpi[3]:.4f} | coalition Knessets {sorted({r[0] for r in coal})}")

# concepts over time
run("CONCEPTS_YEARLY_SQL", expect_rows=True)
trend = run("CONCEPTS_TREND_SQL", 3, expect_rows=True)
assert len({(r[2], r[3]) for r in trend}) == 1, "trend must compare exactly one Knesset pair"
print("  trend:", trend[0][2], "->", trend[0][3], "| rising", sum(r[8] > 0 for r in trend), "fading", sum(r[8] < 0 for r in trend))
run("CONCEPT_YEARLY_SQL", concept, expect_rows=True)
run("CONCEPT_PARTY_KNESSET_SQL", concept, expect_rows=True)
run("CONCEPT_YEARLY_SQL", "missing", expect_rows=False)
single_k = one("SELECT concept_id FROM concepts WHERE k_from = k_to AND NOT is_generic ORDER BY n_bills DESC, concept_id LIMIT 1")
print("  single-Knesset concept:", single_k, "Knessets in party chart:",
      len({r[0] for r in run("CONCEPT_PARTY_KNESSET_SQL", single_k)}))

# home
run("HOME_COUNTS_SQL", expect_rows=True)
recent = run("HOME_RECENT_LAWS_SQL", expect_rows=True)
assert all(r[3] is not None for r in recent), "recent law without a final vote"

print("is_generic concepts (review when the full run lands):")
for (label, n_committees, n_bills) in con.execute(
        "SELECT concept_label, n_committees, n_bills FROM concepts WHERE is_generic ORDER BY n_committees DESC, n_bills DESC").fetchall():
    print(f"  [{n_committees} committees, {n_bills} bills] {label}")
print("OK")
