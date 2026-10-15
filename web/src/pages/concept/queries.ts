import { useSql } from "@/db/useSql"
import type { VoteRow } from "@/pages/votes/queries"

export const CONCEPT_SQL = /* sql */ `
SELECT c.*, (SELECT count(DISTINCT v.vote_id) FROM bridge_bill_concepts bc JOIN votes v USING (bill_id)
             WHERE bc.concept_id = c.concept_id) AS n_votes
FROM concepts c WHERE c.concept_id = ?`

// party for-share on votes about the concept's bills, all Knessets; reservation and second-reading votes are left out
export const CONCEPT_PARTIES_SQL = /* sql */ `
SELECT p.party_id, p.party_name, p.color_index, avg((b.choice = 'for')::INT) AS for_share, count(DISTINCT b.vote_id) AS n_votes,
       count(*) FILTER (b.choice = 'for') AS n_for, count(*) FILTER (b.choice = 'against') AS n_against
FROM ballots_x b JOIN bridge_bill_concepts bc USING (bill_id) JOIN parties p USING (party_id)
WHERE bc.concept_id = ? AND b.choice IN ('for','against') AND b.stage IN ('preliminary','first','third')
GROUP BY ALL ORDER BY n_votes DESC LIMIT 12`

// votes on the concept's bills by stage, and how many had any opposition (official tallies);
// plus counted/not-counted total rows (stage NULL) so bills voted in several stages are not double-counted
export const CONCEPT_STAGES_SQL = /* sql */ `
SELECT s.stage, s.stage IN ('preliminary','first','third') AS counted, count(DISTINCT v.vote_id) AS n_votes,
       count(DISTINCT v.vote_id) FILTER (v.n_against > 0) AS n_contested, count(DISTINCT v.bill_id) AS n_bills
FROM bridge_bill_concepts bc JOIN votes v USING (bill_id) JOIN vote_stage s USING (vote_id)
WHERE bc.concept_id = ?
GROUP BY GROUPING SETS ((s.stage), (s.stage IN ('preliminary','first','third')))
ORDER BY 1 NULLS LAST, 2`

export const CONCEPT_BILLS_SQL = /* sql */ `
SELECT b.bill_id, b.name, b.knesset_num, b.proposal_type, b.passed, b.final_date::VARCHAR AS final_date,
       (SELECT arg_max(v.vote_id, v.ts) FROM votes v WHERE v.bill_id = b.bill_id) AS last_vote_id
FROM bridge_bill_concepts bc JOIN bills b USING (bill_id) WHERE bc.concept_id = ?
ORDER BY b.first_vote_date DESC NULLS LAST`

// automatic bullet summaries per bill, primary first
export const CONCEPT_EVIDENCE_SQL = /* sql */ `
SELECT bc.bill_id, db.bullet, db.bullet_row_id = bc.primary_evidence_bullet_id AS is_primary
FROM bridge_bill_concepts bc JOIN dim_bullets db ON list_contains(bc.bullet_ids, db.bullet_row_id)
WHERE bc.concept_id = ? ORDER BY bc.bill_id, is_primary DESC, db.bullet_row_id`

export const CONCEPT_CONTESTED_SQL = /* sql */ `
SELECT v.vote_id, v.vote_date::VARCHAR AS vote_date, v.item_title, s.stage, v.n_for, v.n_against, v.n_abstain, v.accepted
FROM bridge_bill_concepts bc JOIN votes v USING (bill_id) JOIN vote_stage s USING (vote_id)
WHERE bc.concept_id = ? AND v.n_against >= 10 ORDER BY v.ts DESC LIMIT 50`

// bills per year (by first plenum vote), passed vs not
export const CONCEPT_YEARLY_SQL = /* sql */ `
SELECT year(b.first_vote_date)::INTEGER AS year,
       count(DISTINCT b.bill_id) FILTER (b.passed) AS n_passed,
       count(DISTINCT b.bill_id) FILTER (NOT b.passed) AS n_other
FROM bridge_bill_concepts bc JOIN bills b USING (bill_id)
WHERE bc.concept_id = ? AND b.first_vote_date IS NOT NULL
GROUP BY 1 ORDER BY 1`

// for-share by Knesset for the concept's 6 most-voting parties (same stages as CONCEPT_PARTIES_SQL)
export const CONCEPT_PARTY_KNESSET_SQL = /* sql */ `
WITH b AS (
  SELECT b.knesset_num, b.party_id, b.vote_id, b.choice
  FROM ballots_x b JOIN bridge_bill_concepts bc USING (bill_id)
  WHERE bc.concept_id = ? AND b.choice IN ('for','against') AND b.stage IN ('preliminary','first','third')),
top AS (SELECT party_id FROM b GROUP BY 1 ORDER BY count(DISTINCT vote_id) DESC, party_id LIMIT 6)
SELECT b.knesset_num, p.party_id, p.party_name, p.color_index,
       avg((b.choice = 'for')::INT) AS for_share, count(DISTINCT b.vote_id) AS n_votes
FROM b JOIN top USING (party_id) JOIN parties p USING (party_id)
GROUP BY ALL ORDER BY b.knesset_num, n_votes DESC`

export const useConceptYearly = (id: string) =>
  useSql<{ year: number; n_passed: number; n_other: number }>("conceptYearly", CONCEPT_YEARLY_SQL, [id])
export const useConceptPartyKnesset = (id: string) =>
  useSql<{ knesset_num: number; party_id: string; party_name: string; color_index: number; for_share: number; n_votes: number }>(
    "conceptPartyKnesset", CONCEPT_PARTY_KNESSET_SQL, [id])

export const useConcept = (id: string) =>
  useSql<{
    concept_id: string
    concept_label: string
    concept_criterion: string
    n_bills: number
    n_committees: number
    k_from: number
    k_to: number
    is_generic: boolean
    n_votes: number
  }>("concept", CONCEPT_SQL, [id])
export const useConceptParties = (id: string) =>
  useSql<{ party_id: string; party_name: string; color_index: number; for_share: number; n_votes: number; n_for: number; n_against: number }>(
    "conceptParties", CONCEPT_PARTIES_SQL, [id])
export const useConceptStages = (id: string) =>
  useSql<{ stage: string | null; counted: boolean | null; n_votes: number; n_contested: number; n_bills: number }>(
    "conceptStages", CONCEPT_STAGES_SQL, [id])
export const useConceptBills = (id: string) =>
  useSql<{
    bill_id: number
    name: string
    knesset_num: number
    proposal_type: string
    passed: boolean
    final_date: string | null
    last_vote_id: number | null
  }>("conceptBills", CONCEPT_BILLS_SQL, [id])
export const useConceptEvidence = (id: string) =>
  useSql<{ bill_id: number; bullet: string; is_primary: boolean }>("conceptEvidence", CONCEPT_EVIDENCE_SQL, [id])
export const useConceptContested = (id: string) =>
  useSql<Omit<VoteRow, "total">>("conceptContested", CONCEPT_CONTESTED_SQL, [id])
