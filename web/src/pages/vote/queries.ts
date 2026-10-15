import { useSql } from "@/db/useSql"

export const VOTE_SQL = /* sql */ `
SELECT v.vote_id, v.knesset_num, v.vote_date::VARCHAR AS vote_date, v.item_title, v.decision, v.reading, v.accepted,
       v.vote_type, v.bill_id, v.n_for, v.n_against, v.n_abstain, v.has_ballots, s.stage
FROM votes v JOIN vote_stage s USING (vote_id) WHERE v.vote_id = ?`

// by party, including MKs who were serving but have no ballot (absent)
export const VOTE_BY_PARTY_SQL = /* sql */ `
WITH v AS (SELECT vote_id, knesset_num, vote_date FROM votes WHERE vote_id = ?),
serving AS (
  SELECT s.member_id, s.last_party_id AS party_id FROM mk_service s, v
  WHERE s.knesset_num = v.knesset_num AND v.vote_date BETWEEN s.first_date AND s.last_date),
cast_ AS (SELECT member_id, party_id, choice FROM ballots_x WHERE vote_id = (SELECT vote_id FROM v))
SELECT p.party_id, p.party_name, p.color_index,
       count(*) FILTER (c.choice = 'for')     AS n_for,
       count(*) FILTER (c.choice = 'against') AS n_against,
       count(*) FILTER (c.choice = 'abstain') AS n_abstain,
       count(*) FILTER (c.member_id IS NULL)  AS n_absent
FROM serving s LEFT JOIN cast_ c USING (member_id)
JOIN parties p ON p.party_id = coalesce(c.party_id, s.party_id)
GROUP BY ALL ORDER BY n_for + n_against DESC, n_absent DESC`

export const VOTE_MKS_SQL = /* sql */ `
WITH v AS (SELECT vote_id, knesset_num, vote_date FROM votes WHERE vote_id = ?),
serving AS (
  SELECT s.member_id, s.last_party_id AS party_id FROM mk_service s, v
  WHERE s.knesset_num = v.knesset_num AND v.vote_date BETWEEN s.first_date AND s.last_date),
cast_ AS (SELECT member_id, party_id, choice FROM ballots_x WHERE vote_id = (SELECT vote_id FROM v))
SELECT s.member_id, m.member_name, p.party_name, coalesce(c.choice, 'absent') AS choice, ph.photo_url
FROM serving s LEFT JOIN cast_ c USING (member_id)
JOIN dim_members m ON m.member_id = s.member_id
LEFT JOIN parties p ON p.party_id = coalesce(c.party_id, s.party_id)
LEFT JOIN mk_photos ph ON ph.member_id = s.member_id
ORDER BY p.party_name, m.member_name`

export const BILL_PATH_SQL = /* sql */ `
SELECT v.vote_id, v.vote_date::VARCHAR AS vote_date, s.stage, v.decision, v.accepted, v.n_for, v.n_against
FROM votes v JOIN vote_stage s USING (vote_id)
WHERE v.bill_id = (SELECT bill_id FROM votes WHERE vote_id = ?) ORDER BY v.ts`

// generic legal mechanics last
export const VOTE_CONCEPTS_SQL = /* sql */ `
SELECT c.concept_id, c.concept_label, c.is_generic
FROM bridge_bill_concepts bc JOIN concepts c USING (concept_id)
WHERE bc.bill_id = (SELECT bill_id FROM votes WHERE vote_id = ?)
ORDER BY c.is_generic, bc.bill_bullet_share DESC`

// bullets behind the bill's concepts, generic last
export const VOTE_EVIDENCE_SQL = /* sql */ `
SELECT c.concept_id, c.concept_label, db.bullet, db.bullet_row_id = bc.primary_evidence_bullet_id AS is_primary
FROM bridge_bill_concepts bc JOIN concepts c USING (concept_id)
JOIN dim_bullets db ON list_contains(bc.bullet_ids, db.bullet_row_id)
WHERE bc.bill_id = (SELECT bill_id FROM votes WHERE vote_id = ?)
ORDER BY c.is_generic, bc.bill_bullet_share DESC, is_primary DESC, db.bullet_row_id`

export const useVoteConcepts = (id: number, enabled: boolean) =>
  useSql<{ concept_id: string; concept_label: string; is_generic: boolean }>("voteConcepts", VOTE_CONCEPTS_SQL, [id], enabled)
export const useVoteEvidence = (id: number, enabled: boolean) =>
  useSql<{ concept_id: string; concept_label: string; bullet: string; is_primary: boolean }>("voteEvidence", VOTE_EVIDENCE_SQL, [id], enabled)

export const useVote = (id: number) =>
  useSql<{
    vote_id: number
    knesset_num: number
    vote_date: string
    item_title: string
    decision: string | null
    reading: number | null
    accepted: boolean | null
    vote_type: string
    bill_id: number | null
    n_for: number
    n_against: number
    n_abstain: number
    has_ballots: boolean
    stage: string
  }>("vote", VOTE_SQL, [id])

export const useVoteByParty = (id: number, enabled: boolean) =>
  useSql<{ party_id: string; party_name: string; color_index: number; n_for: number; n_against: number; n_abstain: number; n_absent: number }>(
    "voteByParty", VOTE_BY_PARTY_SQL, [id], enabled)

export const useVoteMks = (id: number, enabled: boolean) =>
  useSql<{ member_id: number; member_name: string; party_name: string | null; choice: string; photo_url: string | null }>(
    "voteMks", VOTE_MKS_SQL, [id], enabled)

export const useBillPath = (id: number, enabled: boolean) =>
  useSql<{ vote_id: number; vote_date: string; stage: string; decision: string | null; accepted: boolean | null; n_for: number; n_against: number }>(
    "billPath", BILL_PATH_SQL, [id], enabled)
