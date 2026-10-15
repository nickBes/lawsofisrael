import { useSql } from "@/db/useSql"

// first plenum vote as the year; there is no submission date
export const LAWS_BY_YEAR_SQL = /* sql */ `
SELECT year(first_vote_date)::INTEGER AS year, proposal_type, passed, count(*) AS n
FROM bills WHERE first_vote_date IS NOT NULL GROUP BY ALL ORDER BY 1`

export const LAWS_FUNNEL_SQL = /* sql */ `
SELECT s.stage, count(DISTINCT v.bill_id) AS bills
FROM votes v JOIN vote_stage s USING (vote_id)
WHERE v.knesset_num = ? AND s.stage IN ('preliminary','first','third') GROUP BY 1`

export const LAWS_TIME_SQL = /* sql */ `
SELECT proposal_type, count(*) AS n,
       quantile_cont(final_date - first_reading_date, 0.5)  AS median_days,
       quantile_cont(final_date - first_reading_date, 0.25) AS p25,
       quantile_cont(final_date - first_reading_date, 0.75) AS p75
FROM bills WHERE final_date IS NOT NULL AND first_reading_date IS NOT NULL GROUP BY 1 ORDER BY n DESC`

export const LAWS_CONSENSUS_SQL = /* sql */ `
SELECT year(v.vote_date)::INTEGER AS year, avg((v.n_against = 0)::INT) AS zero_against_share,
       count(*) FILTER (v.n_against = 0) AS zero_against, count(*) AS finals
FROM votes v JOIN vote_stage s USING (vote_id) WHERE s.stage = 'third' GROUP BY 1 ORDER BY 1`

export const useLawsByYear = () =>
  useSql<{ year: number; proposal_type: string; passed: boolean; n: number }>("lawsByYear", LAWS_BY_YEAR_SQL)
export const useLawsFunnel = (k: number) => useSql<{ stage: string; bills: number }>("lawsFunnel", LAWS_FUNNEL_SQL, [k])
export const useLawsTime = () =>
  useSql<{ proposal_type: string; n: number; median_days: number; p25: number; p75: number }>("lawsTime", LAWS_TIME_SQL)
export const useLawsConsensus = () =>
  useSql<{ year: number; zero_against_share: number; zero_against: number; finals: number }>("lawsConsensus", LAWS_CONSENSUS_SQL)
