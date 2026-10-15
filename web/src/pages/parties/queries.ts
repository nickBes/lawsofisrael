import { useSql } from "@/db/useSql"

// per-MK eligible votes: ballot-carrying votes inside the MK's service window
export const PARTIES_LIST_SQL = /* sql */ `
WITH mp AS (
  SELECT s.member_id, s.last_party_id AS party_id, s.n_ballots, count(*) AS eligible
  FROM mk_service s JOIN votes v ON v.knesset_num = s.knesset_num AND v.has_ballots
   AND v.vote_date BETWEEN s.first_date AND s.last_date
  WHERE s.knesset_num = ? GROUP BY ALL),
co AS (SELECT party_id, avg(is_coalition::INT) AS coalition_share FROM party_vote WHERE knesset_num = ? GROUP BY 1)
SELECT p.party_id, p.party_name, p.color_index, count(*) AS n_mks,
       sum(mp.n_ballots) / sum(mp.eligible) AS participation, any_value(co.coalition_share) AS coalition_share
FROM mp JOIN parties p USING (party_id) LEFT JOIN co USING (party_id)
GROUP BY ALL ORDER BY n_mks DESC`

export type PartyListRow = {
  party_id: string
  party_name: string
  color_index: number
  n_mks: number
  participation: number
  coalition_share: number | null
}

export const usePartiesList = (k: number) => useSql<PartyListRow>("partiesList", PARTIES_LIST_SQL, [k, k])

// up to 5 most-active MKs per party in Knesset ?
export const PARTIES_FACES_SQL = /* sql */ `
SELECT s.last_party_id AS party_id, s.member_id, m.member_name, ph.photo_url
FROM mk_service s JOIN dim_members m USING (member_id) LEFT JOIN mk_photos ph USING (member_id)
WHERE s.knesset_num = ?
QUALIFY row_number() OVER (PARTITION BY s.last_party_id ORDER BY s.n_ballots DESC, s.member_id) <= 5
ORDER BY party_id, s.n_ballots DESC`

export const usePartiesFaces = (k: number) =>
  useSql<{ party_id: string; member_id: number; member_name: string; photo_url: string | null }>("partiesFaces", PARTIES_FACES_SQL, [k])
