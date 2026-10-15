import { useSql } from "@/db/useSql"

export const ABOUT_COVERAGE_SQL = /* sql */ `
SELECT v.knesset_num, count(*) AS votes, count(DISTINCT v.vote_date) AS days,
       count(*) FILTER (s.stage = 'third') AS finals,
       min(v.vote_date)::VARCHAR AS first_date, max(v.vote_date)::VARCHAR AS last_date
FROM votes v JOIN vote_stage s USING (vote_id) GROUP BY 1 ORDER BY 1`

export const useCoverage = () =>
  useSql<{ knesset_num: number; votes: number; days: number; finals: number; first_date: string; last_date: string }>(
    "aboutCoverage", ABOUT_COVERAGE_SQL)
