-- Derived tables, built once per data version. Dates in the Parquet files are strings, cast here once.

-- votes: one row per vote, with its bill, date and official tallies
CREATE OR REPLACE TABLE votes AS
WITH c AS (
  SELECT vote_id,
         sum(vote_count) FILTER (result_label = 'בעד')::INTEGER AS n_for,
         sum(vote_count) FILTER (result_label = 'נגד')::INTEGER AS n_against,
         sum(vote_count) FILTER (result_label = 'נמנע')::INTEGER AS n_abstain
  FROM fact_vote_counters GROUP BY vote_id)
SELECT v.vote_id, v.knesset_num::INTEGER AS knesset_num, CAST(v.vote_datetime AS TIMESTAMP) AS ts,
       CAST(CAST(v.vote_datetime AS TIMESTAMP) AS DATE) AS vote_date,
       v.item_title, v.decision, v.reading::INTEGER AS reading, v.accepted, v.lu_item_type, v.vote_type,
       b.bill_id, coalesce(c.n_for, 0) AS n_for, coalesce(c.n_against, 0) AS n_against, coalesce(c.n_abstain, 0) AS n_abstain,
       v.vote_id IN (SELECT vote_id FROM fact_ballots) AS has_ballots
FROM fact_votes v LEFT JOIN bridge_vote_bills b USING (vote_id) LEFT JOIN c USING (vote_id);

-- stage: preliminary vs first reading, and reservation votes (report §5)
CREATE OR REPLACE TABLE vote_stage AS
WITH r2 AS (SELECT DISTINCT bill_id, vote_date FROM votes WHERE reading = 2)
SELECT v.vote_id, CASE
  WHEN v.lu_item_type = 3    THEN 'no_confidence'
  WHEN v.lu_item_type = 4    THEN 'motion'
  WHEN v.lu_item_type = 6000 THEN 'regulation'
  WHEN v.bill_id IS NULL     THEN 'other'
  WHEN v.reading = 3         THEN 'third'
  WHEN v.reading = 2         THEN 'second'
  WHEN v.decision LIKE '%להכנה לקריאה ראשונה%' THEN 'preliminary'
  WHEN v.decision LIKE '%להכנה לקריאה שני%'    THEN 'first'
  WHEN v.decision = 'לקבל את ההסתייגות' THEN 'reservation'
  WHEN v.decision = 'לדחות את ההצעה' AND r2.bill_id IS NOT NULL THEN 'reservation'
  -- shortcut: other bill rejections are treated as preliminary (report §7, unverified); revisit if a stage-level source appears
  WHEN v.decision = 'לדחות את ההצעה' THEN 'preliminary'
  ELSE 'other' END AS stage
FROM votes v LEFT JOIN r2 ON r2.bill_id = v.bill_id AND r2.vote_date = v.vote_date;

-- faction stints: begin_date only, so a stint ends where the next one begins
CREATE OR REPLACE TABLE stints AS
SELECT member_id, knesset_num::INTEGER AS knesset_num, trim(faction_name) AS faction_name,
       CAST(CAST(begin_date AS TIMESTAMP) AS DATE) AS start_date
FROM bridge_member_factions;

-- bills with topic and key dates
CREATE OR REPLACE TABLE bills AS
SELECT b.bill_id, b.name, b.status, b.proposal_type, b.knesset_num::INTEGER AS knesset_num, trim(b.committee_name) AS committee_name,
       b.summary, b.initiators, b.status = 'התקבלה בקריאה שלישית' AS passed, ct.topic_id,
       min(v.vote_date) AS first_vote_date,
       min(v.vote_date) FILTER (s.stage = 'first') AS first_reading_date,
       min(v.vote_date) FILTER (s.stage = 'third') AS final_date
FROM dim_bills b
LEFT JOIN committee_topics ct ON ct.committee_name = trim(b.committee_name)
LEFT JOIN votes v USING (bill_id) LEFT JOIN vote_stage s USING (vote_id)
GROUP BY ALL;

-- concepts: LLM labels with non-Hebrew script artifacts are dropped; generic legal mechanics are flagged
CREATE OR REPLACE TABLE concepts AS
WITH s AS (
  SELECT bc.concept_id, count(DISTINCT bc.bill_id) AS n_bills,
         count(DISTINCT b.committee_name) FILTER (b.committee_name <> 'טרם נקבעה') AS n_committees,
         min(b.knesset_num) AS k_from, max(b.knesset_num) AS k_to
  FROM bridge_bill_concepts bc JOIN bills b USING (bill_id) GROUP BY 1),
tot AS (SELECT count(DISTINCT committee_name) FILTER (committee_name <> 'טרם נקבעה') AS n
        FROM bills WHERE bill_id IN (SELECT bill_id FROM bridge_bill_concepts))
SELECT c.concept_id, c.concept_label, c.concept_criterion, s.n_bills, s.n_committees, s.k_from, s.k_to,
       -- shortcut: generic = spread over >= 20% of committees; recheck the flagged list when the full run lands
       s.n_committees >= greatest(3, ceil(tot.n * 0.2)) AS is_generic
FROM dim_concepts c JOIN s USING (concept_id), tot
WHERE NOT regexp_matches(c.concept_label, '[^\p{Hebrew}\p{Latin}\P{L}]|\p{Hebrew}\p{Latin}|\p{Latin}\p{Hebrew}');

-- ballots_x: the table almost every page reads
CREATE OR REPLACE TABLE ballots_x AS
WITH b AS (
  SELECT fb.vote_id, fb.member_id, trim(fb.source_faction_name) AS source_faction, fb.vote_result_id,
         v.knesset_num, v.vote_date, v.bill_id
  FROM fact_ballots fb JOIN votes v USING (vote_id)),
cm AS (SELECT party_id, knesset_num::INTEGER AS knesset_num, CAST(start AS DATE) AS s, CAST("end" AS DATE) AS e
       FROM coalition_membership)
SELECT b.vote_id, b.member_id, b.knesset_num, b.vote_date, b.bill_id, s.stage,
       CASE b.vote_result_id WHEN 7 THEN 'for' WHEN 8 THEN 'against' WHEN 9 THEN 'abstain'
                             WHEN 6 THEN 'present' ELSE 'other' END AS choice,
       coalesce(b.source_faction, st.faction_name) AS faction_name,
       fl.party_id,
       cm.party_id IS NOT NULL AS is_coalition
FROM b
ASOF LEFT JOIN stints st ON st.member_id = b.member_id AND b.vote_date >= st.start_date
JOIN vote_stage s USING (vote_id)
LEFT JOIN faction_lineage fl ON fl.faction_name = coalesce(b.source_faction, st.faction_name)
                            AND fl.knesset_num = b.knesset_num
LEFT JOIN cm ON cm.party_id = fl.party_id AND cm.knesset_num = b.knesset_num
            AND b.vote_date >= cm.s AND (cm.e IS NULL OR b.vote_date < cm.e);

-- party position per vote. Rice = |for - against| / (for + against)
CREATE OR REPLACE TABLE party_vote AS
SELECT vote_id, party_id, knesset_num, any_value(is_coalition) AS is_coalition,
       count(*) FILTER (choice = 'for')     AS n_for,
       count(*) FILTER (choice = 'against') AS n_against,
       count(*) FILTER (choice = 'abstain') AS n_abstain,
       CASE WHEN n_for > n_against THEN 'for' WHEN n_against > n_for THEN 'against' ELSE 'split' END AS position,
       abs(n_for - n_against) / nullif(n_for + n_against, 0) AS rice
FROM ballots_x WHERE party_id IS NOT NULL GROUP BY vote_id, party_id, knesset_num;

-- bloc position per vote (NULL when a bloc cast no for/against ballots), and whether the vote split strictly along blocs
CREATE OR REPLACE TABLE vote_bloc AS
WITH t AS (
  SELECT vote_id,
         sum(n_for) FILTER (is_coalition) AS cf, sum(n_against) FILTER (is_coalition) AS ca,
         sum(n_for) FILTER (NOT is_coalition) AS of_, sum(n_against) FILTER (NOT is_coalition) AS oa
  FROM party_vote GROUP BY vote_id),
bp AS (
  SELECT vote_id,
         CASE WHEN cf + ca > 0 THEN CASE WHEN cf > ca THEN 'for' ELSE 'against' END END AS coalition_position,
         CASE WHEN of_ + oa > 0 THEN CASE WHEN of_ > oa THEN 'for' ELSE 'against' END END AS opposition_position
  FROM t)
SELECT bp.vote_id, bp.coalition_position, bp.opposition_position,
       coalesce(bp.coalition_position <> bp.opposition_position
         AND bool_and(pv.position = CASE WHEN pv.is_coalition THEN bp.coalition_position ELSE bp.opposition_position END), false)
         AS is_bloc_vote
FROM bp JOIN party_vote pv USING (vote_id)
GROUP BY bp.vote_id, bp.coalition_position, bp.opposition_position;

-- MK service window per Knesset (no end dates in the data; inferred from ballots)
CREATE OR REPLACE TABLE mk_service AS
SELECT member_id, knesset_num, min(vote_date) AS first_date, max(vote_date) AS last_date,
       arg_max(party_id, vote_date) AS last_party_id, count(*) AS n_ballots
FROM ballots_x GROUP BY ALL;

-- initiators: one row per (bill, member)
CREATE OR REPLACE TABLE bill_initiators AS
WITH n AS (SELECT DISTINCT bill_id, trim(unnest(string_split(initiators, ','))) AS name
           FROM dim_bills WHERE proposal_type = 'פרטית' AND initiators <> ''),
m AS (SELECT member_name, min(member_id) AS member_id FROM dim_members GROUP BY 1)
SELECT n.bill_id, n.name, coalesce(m.member_id, a.member_id) AS member_id
FROM n LEFT JOIN m ON m.member_name = n.name
       LEFT JOIN member_name_aliases a ON a.alias = n.name;

-- search index for the global search dialog
CREATE OR REPLACE TABLE search_index AS
SELECT 'mk' AS kind, CAST(member_id AS VARCHAR) AS id, member_name AS label FROM dim_members
  WHERE member_id IN (SELECT member_id FROM mk_service)
UNION ALL SELECT 'party', party_id, party_name FROM parties
-- a bill links to its latest vote, which shows the bill's whole path
UNION ALL SELECT 'bill', CAST(arg_max(v.vote_id, v.ts) AS VARCHAR), any_value(b.name)
  FROM bills b JOIN votes v USING (bill_id) GROUP BY b.bill_id
UNION ALL SELECT 'concept', concept_id, concept_label FROM concepts;
