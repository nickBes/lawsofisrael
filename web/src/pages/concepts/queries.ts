import { useSql } from "@/db/useSql"

export const CONCEPTS_SUMMARY_SQL = /* sql */ `
SELECT count(*) FILTER (NOT is_generic) AS n_concepts, count(*) FILTER (is_generic) AS n_generic,
       (SELECT count(DISTINCT bill_id) FROM bridge_bill_concepts) AS n_bills, min(k_from) AS k_from, max(k_to) AS k_to
FROM concepts`

// n_votes counts plenum votes on every stage of the concept's bills
export const CONCEPTS_LIST_SQL = /* sql */ `
SELECT c.concept_id, c.concept_label, c.n_bills, c.k_from, c.k_to,
       count(DISTINCT v.vote_id) AS n_votes, count(DISTINCT b.bill_id) FILTER (b.passed) AS n_passed
FROM concepts c JOIN bridge_bill_concepts bc USING (concept_id) JOIN bills b USING (bill_id) LEFT JOIN votes v USING (bill_id)
WHERE c.is_generic = ? AND (? = '' OR c.concept_label ILIKE '%' || ? || '%')
GROUP BY ALL ORDER BY c.n_bills DESC, c.concept_label LIMIT 60`

// bills per year (by first plenum vote) for the 5 largest non-generic concepts
export const CONCEPTS_YEARLY_SQL = /* sql */ `
WITH top AS (
  SELECT concept_id, concept_label, row_number() OVER (ORDER BY n_bills DESC, concept_id) AS rn
  FROM concepts WHERE NOT is_generic QUALIFY rn <= 5)
SELECT year(b.first_vote_date)::INTEGER AS year, t.rn, t.concept_id, t.concept_label, count(DISTINCT b.bill_id) AS n_bills
FROM top t JOIN bridge_bill_concepts bc USING (concept_id) JOIN bills b USING (bill_id)
WHERE b.first_vote_date IS NOT NULL
GROUP BY ALL ORDER BY year, t.rn`

// rising / fading: each concept's share of the concept-tagged bills, in the two latest well-covered Knessets.
// shortcut: compares only the two latest Knessets with >= 50 concept-tagged bills; add a Knesset picker if comparing other pairs is asked for
export const CONCEPTS_TREND_SQL = /* sql */ `
WITH kb AS (
  SELECT b.knesset_num, count(DISTINCT b.bill_id) AS n
  FROM bridge_bill_concepts bc JOIN bills b USING (bill_id) GROUP BY 1 HAVING n >= 50),
k AS (SELECT max(knesset_num) AS k2, max(knesset_num) FILTER (knesset_num < (SELECT max(knesset_num) FROM kb)) AS k1 FROM kb),
cc AS (
  SELECT c.concept_id, c.concept_label,
         count(DISTINCT b.bill_id) FILTER (b.knesset_num = k.k1) AS n1,
         count(DISTINCT b.bill_id) FILTER (b.knesset_num = k.k2) AS n2
  FROM concepts c JOIN bridge_bill_concepts bc USING (concept_id) JOIN bills b USING (bill_id), k
  WHERE NOT c.is_generic AND b.knesset_num IN (k.k1, k.k2)
  GROUP BY ALL)
SELECT cc.concept_id, cc.concept_label, k.k1, k.k2, cc.n1, cc.n2,
       cc.n1 / kb1.n AS share1, cc.n2 / kb2.n AS share2, cc.n2 / kb2.n - cc.n1 / kb1.n AS delta
FROM cc, k JOIN kb kb1 ON kb1.knesset_num = k.k1 JOIN kb kb2 ON kb2.knesset_num = k.k2
WHERE cc.n1 + cc.n2 >= ?
ORDER BY delta DESC, cc.concept_label`

export type ConceptListRow = {
  concept_id: string
  concept_label: string
  n_bills: number
  k_from: number
  k_to: number
  n_votes: number
  n_passed: number
}

export const useConceptsSummary = () =>
  useSql<{ n_concepts: number; n_generic: number; n_bills: number; k_from: number | null; k_to: number | null }>(
    "conceptsSummary", CONCEPTS_SUMMARY_SQL)
export const useConceptsList = (generic: boolean, q: string) =>
  useSql<ConceptListRow>("conceptsList", CONCEPTS_LIST_SQL, [generic, q, q])
export const useConceptsYearly = () =>
  useSql<{ year: number; rn: number; concept_id: string; concept_label: string; n_bills: number }>("conceptsYearly", CONCEPTS_YEARLY_SQL)
export const useConceptsTrend = () =>
  useSql<{
    concept_id: string
    concept_label: string
    k1: number
    k2: number
    n1: number
    n2: number
    share1: number
    share2: number
    delta: number
  }>("conceptsTrend", CONCEPTS_TREND_SQL, [3])
