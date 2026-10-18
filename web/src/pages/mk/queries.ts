import type { ConceptPieRow } from "@/components/concept-pies"
import { useSql } from "@/db/useSql"
import { PAGE_SIZE } from "@/pages/votes/queries"

export const MK_SERVICE_SQL = /* sql */ `
SELECT m.member_name, s.knesset_num, s.first_date::VARCHAR AS first_date, s.last_date::VARCHAR AS last_date,
       s.last_party_id, p.party_name, s.n_ballots, ph.photo_url
FROM dim_members m JOIN mk_service s USING (member_id) LEFT JOIN mk_photos ph USING (member_id)
LEFT JOIN parties p ON p.party_id = s.last_party_id
WHERE m.member_id = ? ORDER BY s.knesset_num`

export const MK_POSITIONS_SQL = /* sql */ `
SELECT DISTINCT government_id, position_name, ministry_name, left(start_date, 10) AS start_date, left(finish_date, 10) AS finish_date
FROM dim_governments WHERE member_id = ? ORDER BY start_date`

export const MK_KPI_SQL = /* sql */ `
WITH s AS (SELECT * FROM mk_service WHERE member_id = ? AND knesset_num = coalesce(?::INTEGER, knesset_num)),
el AS (SELECT count(*) AS eligible FROM votes v JOIN s ON v.knesset_num = s.knesset_num
       WHERE v.has_ballots AND v.vote_date BETWEEN s.first_date AND s.last_date),
reb AS (SELECT count(*) FILTER (b.choice <> pv.position) AS n, avg((b.choice = pv.position)::INT) AS agreement
        FROM ballots_x b JOIN party_vote pv USING (vote_id, party_id)
        JOIN s ON b.member_id = s.member_id AND b.knesset_num = s.knesset_num
        WHERE b.choice IN ('for','against') AND pv.position IN ('for','against') AND pv.n_for + pv.n_against >= 3),
bi AS (SELECT count(DISTINCT bl.bill_id) AS initiated, count(DISTINCT bl.bill_id) FILTER (bl.passed) AS passed
       FROM bill_initiators i JOIN bills bl USING (bill_id) JOIN s ON i.member_id = s.member_id AND bl.knesset_num = s.knesset_num),
-- per Knesset: the gap between two Knessets is an election, not an absence
gap AS (SELECT max(d - prev) AS max_gap_days FROM (
        SELECT vote_date AS d, lag(vote_date) OVER (PARTITION BY knesset_num ORDER BY vote_date) AS prev
        FROM (SELECT DISTINCT b.knesset_num, b.vote_date FROM ballots_x b
              JOIN s ON b.member_id = s.member_id AND b.knesset_num = s.knesset_num))),
tot AS (SELECT sum(n_ballots)::BIGINT AS n_ballots, count(*) AS n_k FROM s)
SELECT tot.n_ballots, tot.n_ballots / el.eligible AS participation, reb.n AS against_party, reb.agreement AS agreement_with_party,
       bi.initiated, bi.passed, gap.max_gap_days
FROM tot, el, reb, bi, gap WHERE tot.n_k > 0`

export const MK_YEARLY_SQL = /* sql */ `
SELECT year(vote_date)::INTEGER AS year,
       count(*) FILTER (choice = 'for')     AS n_for,
       count(*) FILTER (choice = 'against') AS n_against,
       count(*) FILTER (choice = 'abstain') AS n_abstain,
       count(*) FILTER (choice = 'present') AS n_present
FROM ballots_x WHERE member_id = ? AND knesset_num = coalesce(?::INTEGER, knesset_num) AND stage NOT IN ('reservation','second') GROUP BY 1 ORDER BY 1`

// participation by year: ballots cast ÷ ballot-carrying votes inside the service window, MK vs median of the party's MKs
export const MK_PARTICIPATION_SQL = /* sql */ `
WITH me AS (SELECT knesset_num, last_party_id FROM mk_service WHERE member_id = ? AND knesset_num = coalesce(?::INTEGER, knesset_num)),
peers AS (SELECT s.* FROM mk_service s JOIN me ON s.knesset_num = me.knesset_num AND s.last_party_id = me.last_party_id),
py AS (
  SELECT p.member_id, year(v.vote_date) AS year, count(*) AS eligible, count(b.vote_id) AS cast_
  FROM peers p JOIN votes v ON v.knesset_num = p.knesset_num AND v.has_ballots AND v.vote_date BETWEEN p.first_date AND p.last_date
  LEFT JOIN ballots_x b ON b.vote_id = v.vote_id AND b.member_id = p.member_id
  GROUP BY ALL)
SELECT year::INTEGER AS year, max(cast_ / eligible) FILTER (member_id = ?) AS mk, median(cast_ / eligible) AS party_median
FROM py GROUP BY year ORDER BY year`

// MK for-share vs own party's for-share (all its MKs' ballots, the MK included) on the same votes, by concept;
// generic legal mechanics left out. shortcut: >= 5 votes and the 50 most-voted concepts; revisit when the full concept run lands
export const MK_CONCEPTS_SQL = /* sql */ `
SELECT c.concept_id, c.concept_label, count(*) AS n_votes,
       avg((b.choice = 'for')::INT) AS a_share,
       count(*) FILTER (b.choice = 'for') AS a_for, count(*) FILTER (b.choice = 'against') AS a_against,
       sum(pv.n_for) / sum(pv.n_for + pv.n_against) AS b_share,
       sum(pv.n_for)::BIGINT AS b_for, sum(pv.n_against)::BIGINT AS b_against
FROM ballots_x b JOIN bridge_bill_concepts bc USING (bill_id) JOIN concepts c USING (concept_id)
JOIN party_vote pv USING (vote_id, party_id)
WHERE b.member_id = ? AND b.knesset_num = coalesce(?::INTEGER, b.knesset_num) AND b.stage IN ('preliminary','first','third')
  AND b.choice IN ('for','against') AND NOT c.is_generic
GROUP BY ALL HAVING count(*) >= 5
ORDER BY n_votes DESC, c.concept_label LIMIT 50`

export const MK_CONCEPT_VOTES_SQL = /* sql */ `
SELECT v.vote_id, v.vote_date::VARCHAR AS vote_date, v.item_title, s.stage, b.choice, pv.position, db.bullet
FROM ballots_x b
JOIN bridge_bill_concepts bc ON bc.bill_id = b.bill_id AND bc.concept_id = ?
LEFT JOIN dim_bullets db ON db.bullet_row_id = bc.primary_evidence_bullet_id
JOIN party_vote pv USING (vote_id, party_id)
JOIN votes v USING (vote_id) JOIN vote_stage s USING (vote_id)
WHERE b.member_id = ? AND b.knesset_num = coalesce(?::INTEGER, b.knesset_num) AND b.choice IN ('for','against')
  AND s.stage IN ('preliminary','first','third')
ORDER BY v.ts DESC LIMIT 200`

// every ballot, paged; against_party = for/against opposite the party majority, at least 2 other party members voted
// (same rule as against_party in MK_KPI_SQL); the third ? limits to those
export const MK_VOTES_SQL = /* sql */ `
SELECT v.vote_id, v.vote_date::VARCHAR AS vote_date, v.item_title, b.stage, b.choice, pv.position,
       b.choice IN ('for','against') AND pv.position IN ('for','against') AND b.choice <> pv.position
         AND pv.n_for + pv.n_against >= 3 AS against_party,
       count(*) OVER () AS total
FROM ballots_x b JOIN party_vote pv USING (vote_id, party_id) JOIN votes v USING (vote_id)
WHERE b.member_id = ? AND b.knesset_num = coalesce(?::INTEGER, b.knesset_num)
  AND (NOT ? OR (b.choice IN ('for','against') AND pv.position IN ('for','against') AND b.choice <> pv.position
                 AND pv.n_for + pv.n_against >= 3))
ORDER BY v.ts DESC, v.vote_id DESC LIMIT 50 OFFSET ?`

// votes most like (optionally excluding strict coalition-vs-opposition votes)
export const MK_SIMILAR_SQL = /* sql */ `
WITH me AS (
  SELECT vote_id, choice FROM ballots_x
  WHERE member_id = ? AND knesset_num = coalesce(?::INTEGER, knesset_num) AND choice IN ('for','against')),
mine AS (SELECT arg_max(last_party_id, knesset_num) AS last_party_id FROM mk_service
         WHERE member_id = ? AND knesset_num = coalesce(?::INTEGER, knesset_num)),
sim AS (
  SELECT o.member_id, arg_max(o.party_id, o.vote_date) AS party_id,
         count(*) AS n_common, avg((o.choice = me.choice)::INT) AS agreement
  FROM me JOIN ballots_x o USING (vote_id)
  JOIN vote_bloc vb USING (vote_id)
  WHERE o.member_id <> ? AND o.choice IN ('for','against')
    AND (NOT ? OR NOT vb.is_bloc_vote)
  GROUP BY o.member_id
  HAVING count(*) >= 100)
SELECT sim.member_id, m.member_name, sim.party_id, p.party_name, p.color_index, sim.n_common, sim.agreement,
       sim.party_id IS DISTINCT FROM (SELECT last_party_id FROM mine) AS cross_party, ph.photo_url
FROM sim JOIN dim_members m USING (member_id) LEFT JOIN parties p USING (party_id)
LEFT JOIN mk_photos ph ON ph.member_id = sim.member_id
ORDER BY sim.agreement DESC, sim.n_common DESC LIMIT 20`

// bills initiated, and how far they got
export const MK_BILLS_SQL = /* sql */ `
SELECT bl.bill_id, bl.name, bl.status,
       CASE WHEN bl.passed THEN 'passed' WHEN bl.first_reading_date IS NOT NULL THEN 'first'
            ELSE 'preliminary' END AS reached,
       (SELECT arg_max(v.vote_id, v.ts) FROM votes v WHERE v.bill_id = bl.bill_id) AS last_vote_id
FROM bill_initiators bi JOIN bills bl USING (bill_id)
WHERE bi.member_id = ? AND bl.knesset_num = coalesce(?::INTEGER, bl.knesset_num)
ORDER BY bl.passed DESC, bl.name`

export const MK_STINTS_SQL = /* sql */ `
SELECT knesset_num, faction_name, start_date::VARCHAR AS start_date
FROM stints WHERE member_id = ? AND knesset_num >= 16 ORDER BY start_date`

type VoteLine = { vote_id: number; vote_date: string; item_title: string; stage: string; choice: string; position: string }

export const useMkService = (id: number) =>
  useSql<{ member_name: string; knesset_num: number; first_date: string; last_date: string; last_party_id: string; party_name: string; n_ballots: number; photo_url: string | null }>(
    "mkService", MK_SERVICE_SQL, [id])
export const useMkPositions = (id: number) =>
  useSql<{ government_id: number; position_name: string; ministry_name: string | null; start_date: string; finish_date: string | null }>(
    "mkPositions", MK_POSITIONS_SQL, [id])
export const useMkKpi = (id: number, k: number | null) =>
  useSql<{
    n_ballots: number
    participation: number
    against_party: number
    agreement_with_party: number | null
    initiated: number
    passed: number
    max_gap_days: number | null
  }>(
    "mkKpi", MK_KPI_SQL, [id, k])
export const useMkYearly = (id: number, k: number | null) =>
  useSql<{ year: number; n_for: number; n_against: number; n_abstain: number; n_present: number }>("mkYearly", MK_YEARLY_SQL, [id, k])
export const useMkParticipation = (id: number, k: number | null) =>
  useSql<{ year: number; mk: number | null; party_median: number }>("mkParticipation", MK_PARTICIPATION_SQL, [id, k, id])
export const useMkConcepts = (id: number, k: number | null) =>
  useSql<ConceptPieRow>("mkConcepts", MK_CONCEPTS_SQL, [id, k])
export const useMkConceptVotes = (id: number, k: number | null, concept: string) =>
  useSql<VoteLine & { bullet: string | null }>("mkConceptVotes", MK_CONCEPT_VOTES_SQL, [concept, id, k], concept !== "")
// LIMIT 50 in MK_VOTES_SQL must match PAGE_SIZE
export const useMkVotes = (id: number, k: number | null, againstOnly: boolean, page: number) =>
  useSql<VoteLine & { against_party: boolean; total: number }>("mkVotes", MK_VOTES_SQL, [id, k, againstOnly, (page - 1) * PAGE_SIZE], true, 2)
export const useMkSimilar = (id: number, k: number | null, excludeBloc: boolean) =>
  useSql<{
    member_id: number
    member_name: string
    party_id: string
    party_name: string | null
    color_index: number | null
    n_common: number
    agreement: number
    cross_party: boolean
    photo_url: string | null
  }>(
    "mkSimilar", MK_SIMILAR_SQL, [id, k, id, k, id, excludeBloc])
export const useMkBills = (id: number, k: number | null) =>
  useSql<{ bill_id: number; name: string; status: string; reached: "passed" | "first" | "preliminary"; last_vote_id: number | null }>(
    "mkBills", MK_BILLS_SQL, [id, k])
export const useMkStints = (id: number) =>
  useSql<{ knesset_num: number; faction_name: string; start_date: string }>("mkStints", MK_STINTS_SQL, [id])
