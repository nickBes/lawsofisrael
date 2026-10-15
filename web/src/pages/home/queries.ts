import { useSql } from "@/db/useSql"

export const HOME_COUNTS_SQL = /* sql */ `
SELECT (SELECT count(*) FROM votes) AS votes,
       (SELECT count(*) FROM ballots_x) AS ballots,
       (SELECT count(*) FROM bills WHERE passed) AS laws_passed,
       (SELECT count(DISTINCT member_id) FROM mk_service) AS mks,
       (SELECT count(DISTINCT last_party_id) FROM mk_service) AS parties,
       (SELECT count(*) FILTER (NOT is_generic) FROM concepts) AS concepts,
       (SELECT max(vote_date)::VARCHAR FROM votes) AS last_date`

// 20 latest passed laws and their final (third-reading) vote
export const HOME_RECENT_LAWS_SQL = /* sql */ `
SELECT b.bill_id, b.name, b.final_date::VARCHAR AS final_date,
       (SELECT arg_max(v.vote_id, v.ts) FROM votes v JOIN vote_stage s USING (vote_id)
        WHERE v.bill_id = b.bill_id AND s.stage = 'third') AS final_vote_id
FROM bills b WHERE b.passed AND b.final_date IS NOT NULL
ORDER BY b.final_date DESC, b.bill_id DESC LIMIT 20`

export const useHomeCounts = () =>
  useSql<{ votes: number; ballots: number; laws_passed: number; mks: number; parties: number; concepts: number; last_date: string }>(
    "homeCounts", HOME_COUNTS_SQL)
export const useHomeRecentLaws = () =>
  useSql<{ bill_id: number; name: string; final_date: string; final_vote_id: number | null }>("homeRecentLaws", HOME_RECENT_LAWS_SQL)
