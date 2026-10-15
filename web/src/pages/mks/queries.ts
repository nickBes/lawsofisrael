import { useSql } from "@/db/useSql"

// q '' and party '' mean "no filter"
export const MKS_SQL = /* sql */ `
WITH mp AS (
  SELECT s.member_id, s.last_party_id AS party_id, s.n_ballots, count(*) AS eligible
  FROM mk_service s JOIN votes v ON v.knesset_num = s.knesset_num AND v.has_ballots
   AND v.vote_date BETWEEN s.first_date AND s.last_date
  WHERE s.knesset_num = ? GROUP BY ALL)
SELECT mp.member_id, m.member_name, mp.party_id, p.party_name, p.color_index, mp.n_ballots, mp.n_ballots / mp.eligible AS participation,
       ph.photo_url
FROM mp JOIN dim_members m USING (member_id) LEFT JOIN parties p USING (party_id)
LEFT JOIN mk_photos ph ON ph.member_id = mp.member_id
WHERE (? = '' OR m.member_name ILIKE '%' || ? || '%') AND (? = '' OR mp.party_id = ?)
ORDER BY m.member_name`

export const useMks = (k: number, q: string, party: string) =>
  useSql<{
    member_id: number
    member_name: string
    party_id: string
    party_name: string | null
    color_index: number | null
    n_ballots: number
    participation: number
    photo_url: string | null
  }>(
    "mks", MKS_SQL, [k, q, q, party, party])
