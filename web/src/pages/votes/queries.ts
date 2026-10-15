import { useSql } from "@/db/useSql"

export const PAGE_SIZE = 50

// stage 'all' and topic '' mean "no filter"
export const VOTES_SQL = /* sql */ `
SELECT v.vote_id, v.vote_date::VARCHAR AS vote_date, v.item_title, s.stage, v.n_for, v.n_against, v.n_abstain, v.accepted,
       count(*) OVER () AS total
FROM votes v JOIN vote_stage s USING (vote_id) LEFT JOIN bills b USING (bill_id)
WHERE v.knesset_num = ?
  AND (? = 'all' OR s.stage = ?)
  AND (? = '' OR b.topic_id = ?)
  AND (? = '' OR v.item_title ILIKE '%' || ? || '%')
  AND (NOT ? OR v.n_against >= 10)
ORDER BY v.ts DESC LIMIT 50 OFFSET ?`

// same filter as VOTES_SQL, for the KPI tiles
export const VOTES_SUMMARY_SQL = /* sql */ `
SELECT count(*) AS n, avg(accepted::INT) AS accepted_share, count(*) FILTER (n_against >= 10) AS contested
FROM votes v JOIN vote_stage s USING (vote_id) LEFT JOIN bills b USING (bill_id)
WHERE v.knesset_num = ?
  AND (? = 'all' OR s.stage = ?)
  AND (? = '' OR b.topic_id = ?)
  AND (? = '' OR v.item_title ILIKE '%' || ? || '%')
  AND (NOT ? OR v.n_against >= 10)`

export type VoteRow = {
  vote_id: number
  vote_date: string
  item_title: string
  stage: string
  n_for: number
  n_against: number
  n_abstain: number
  accepted: boolean | null
  total: number
}

type VoteFilter = { k: number; stage: string; topic: string; q: string; contested: boolean }
const filterParams = (f: VoteFilter) => [f.k, f.stage, f.stage, f.topic, f.topic, f.q, f.q, f.contested]

export const useVotes = (f: VoteFilter & { page: number }) =>
  useSql<VoteRow>("votes", VOTES_SQL, [...filterParams(f), (f.page - 1) * PAGE_SIZE])
export const useVotesSummary = (f: VoteFilter) =>
  useSql<{ n: number; accepted_share: number | null; contested: number }>("votesSummary", VOTES_SUMMARY_SQL, filterParams(f))
