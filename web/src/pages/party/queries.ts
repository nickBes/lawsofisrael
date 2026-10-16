import type { ConceptPieRow } from "@/components/concept-pies"
import { useSql } from "@/db/useSql"

export const PARTY_SQL = /* sql */ `
SELECT p.party_id, p.party_name, p.color_index, s.knesset_num
FROM parties p JOIN (SELECT DISTINCT last_party_id AS party_id, knesset_num FROM mk_service) s USING (party_id)
WHERE p.party_id = ? ORDER BY s.knesset_num`

export const PARTY_COALITION_SQL = /* sql */ `
SELECT knesset_num, start::VARCHAR AS start, "end"::VARCHAR AS "end", kind
FROM coalition_membership WHERE party_id = ? AND knesset_num = coalesce(?::INTEGER, knesset_num) ORDER BY start`

// stage filter keeps reservation votes out
export const PARTY_KPI_SQL = /* sql */ `
WITH mp AS (
  SELECT s.member_id, s.knesset_num, s.n_ballots, count(*) AS eligible
  FROM mk_service s JOIN votes v ON v.knesset_num = s.knesset_num AND v.has_ballots
   AND v.vote_date BETWEEN s.first_date AND s.last_date
  WHERE s.knesset_num = coalesce(?::INTEGER, s.knesset_num) AND s.last_party_id = ? GROUP BY ALL),
kp AS (
  SELECT avg(rice) AS cohesion,
         avg((pv.position = vb.coalition_position)::INT) FILTER (pv.position IN ('for','against')
             AND vb.coalition_position <> vb.opposition_position) AS sided_with_coalition
  FROM party_vote pv JOIN vote_bloc vb USING (vote_id) JOIN vote_stage s USING (vote_id)
  WHERE pv.party_id = ? AND pv.knesset_num = coalesce(?::INTEGER, pv.knesset_num) AND s.stage IN ('preliminary','first','third'))
SELECT (SELECT count(DISTINCT member_id) FROM mp) AS n_mks, (SELECT sum(n_ballots) / sum(eligible) FROM mp) AS participation,
       kp.cohesion, kp.sided_with_coalition
FROM kp`

// party for-share (its MKs' ballots) vs the whole Knesset's pooled for-share on the same votes, by concept;
// generic legal mechanics left out. shortcut: >= 5 votes and the 50 most-voted concepts; revisit when the full concept run lands
export const PARTY_CONCEPTS_SQL = /* sql */ `
WITH kv AS (SELECT vote_id, sum(n_for) AS k_for, sum(n_against) AS k_against FROM party_vote GROUP BY vote_id)
SELECT c.concept_id, c.concept_label, count(*) AS n_votes,
       sum(pv.n_for) / sum(pv.n_for + pv.n_against) AS a_share,
       sum(pv.n_for)::BIGINT AS a_for, sum(pv.n_against)::BIGINT AS a_against,
       sum(kv.k_for) / sum(kv.k_for + kv.k_against) AS b_share,
       sum(kv.k_for)::BIGINT AS b_for, sum(kv.k_against)::BIGINT AS b_against
FROM party_vote pv JOIN votes v USING (vote_id) JOIN vote_stage s USING (vote_id) JOIN kv USING (vote_id)
JOIN bridge_bill_concepts bc USING (bill_id) JOIN concepts c USING (concept_id)
WHERE pv.party_id = ? AND pv.knesset_num = coalesce(?::INTEGER, pv.knesset_num) AND s.stage IN ('preliminary','first','third')
  AND pv.n_for + pv.n_against > 0 AND NOT c.is_generic
GROUP BY ALL HAVING count(*) >= 5
ORDER BY n_votes DESC, c.concept_label LIMIT 50`

export const PARTY_DIVISIVE_SQL = /* sql */ `
SELECT v.vote_id, v.vote_date::VARCHAR AS vote_date, v.item_title, s.stage, pv.n_for, pv.n_against, pv.rice
FROM party_vote pv JOIN votes v USING (vote_id) JOIN vote_stage s USING (vote_id)
WHERE pv.party_id = ? AND pv.knesset_num = coalesce(?::INTEGER, pv.knesset_num) AND pv.n_for + pv.n_against >= 3 AND pv.rice < 1
ORDER BY pv.rice, v.ts DESC LIMIT 20`

// bills initiated by the party's MKs (by their last party in this Knesset)
export const PARTY_BILLS_SQL = /* sql */ `
SELECT DISTINCT bl.bill_id, bl.name, bl.status, bl.passed,
       (SELECT arg_max(v.vote_id, v.ts) FROM votes v WHERE v.bill_id = bl.bill_id) AS last_vote_id
FROM bill_initiators bi
JOIN mk_service s ON s.member_id = bi.member_id AND s.knesset_num = coalesce(?::INTEGER, s.knesset_num) AND s.last_party_id = ?
JOIN bills bl ON bl.bill_id = bi.bill_id AND bl.knesset_num = s.knesset_num
ORDER BY bl.passed DESC, bl.name`

// shortcut: membership = last party per Knesset (mk_service.last_party_id); MKs who left mid-Knesset are not listed under the party they left
export const PARTY_MEMBERS_SQL = /* sql */ `
WITH mp AS (
  SELECT s.member_id, s.knesset_num, s.n_ballots, count(*) AS eligible
  FROM mk_service s JOIN votes v ON v.knesset_num = s.knesset_num AND v.has_ballots
   AND v.vote_date BETWEEN s.first_date AND s.last_date
  WHERE s.knesset_num = coalesce(?::INTEGER, s.knesset_num) AND s.last_party_id = ? GROUP BY ALL),
m1 AS (SELECT member_id, sum(n_ballots)::BIGINT AS n_ballots, sum(n_ballots) / sum(eligible) AS participation FROM mp GROUP BY 1)
SELECT m1.member_id, m.member_name, m1.n_ballots, m1.participation, ph.photo_url
FROM m1 JOIN dim_members m USING (member_id) LEFT JOIN mk_photos ph ON ph.member_id = m1.member_id
ORDER BY m.member_name`

export const useParty = (id: string) =>
  useSql<{ party_id: string; party_name: string; color_index: number; knesset_num: number }>("party", PARTY_SQL, [id])
export const usePartyCoalition = (id: string, k: number | null) =>
  useSql<{ knesset_num: number; start: string; end: string | null; kind: string }>("partyCoalition", PARTY_COALITION_SQL, [id, k])
export const usePartyKpi = (id: string, k: number | null) =>
  useSql<{ n_mks: number; participation: number | null; cohesion: number | null; sided_with_coalition: number | null }>(
    "partyKpi", PARTY_KPI_SQL, [k, id, id, k])
export const usePartyConcepts = (id: string, k: number | null) =>
  useSql<ConceptPieRow>("partyConcepts", PARTY_CONCEPTS_SQL, [id, k])
export const usePartyDivisive = (id: string, k: number | null) =>
  useSql<{ vote_id: number; vote_date: string; item_title: string; stage: string; n_for: number; n_against: number; rice: number }>(
    "partyDivisive", PARTY_DIVISIVE_SQL, [id, k])
export const usePartyBills = (id: string, k: number | null) =>
  useSql<{ bill_id: number; name: string; status: string; passed: boolean; last_vote_id: number | null }>("partyBills", PARTY_BILLS_SQL, [k, id])
export const usePartyMembers = (id: string, k: number | null) =>
  useSql<{ member_id: number; member_name: string; n_ballots: number; participation: number; photo_url: string | null }>(
    "partyMembers", PARTY_MEMBERS_SQL, [k, id])
