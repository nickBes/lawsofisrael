# Collect official Knesset portrait URLs for every MK who has ballots, for the web app's avatars.
# Usage (repo root): uv run python scripts/collect_mk_photos.py
# Runs locally, not in CI. Rerunnable: responses are cached for 30 days in scripts/.http_cache_mk_photos.sqlite,
# so a rerun makes no network requests. Writes dataset/curated/mk_photos.csv (member_id, photo_url).
# Images are hotlinked by the site, never downloaded or committed.
import csv
import pathlib
import time
from datetime import timedelta

import pyarrow.parquet as pq
from requests.adapters import HTTPAdapter
from requests_cache import CachedSession
from urllib3.util.retry import Retry

ROOT = pathlib.Path(__file__).resolve().parent.parent
PREPARED = ROOT / "dataset/knesset_votes/prepared"
OUT = ROOT / "dataset/curated/mk_photos.csv"
API = "https://www.knesset.gov.il/WebSiteApi/knessetapi"
OFFICIAL = "https://fs.knesset.gov.il/"

session = CachedSession(str(ROOT / "scripts/.http_cache_mk_photos"), backend="sqlite",
                        expire_after=timedelta(days=30), allowable_codes=(200,))
session.headers["User-Agent"] = "lawsofisrael-data-collection/0.2"
session.mount("https://", HTTPAdapter(max_retries=Retry(total=4, backoff_factor=0.5, status_forcelist=(429, 500, 502, 503, 504))))
network_requests = 0


def get_json(url, **params):
    global network_requests
    r = session.get(url, params=params, timeout=60)
    r.raise_for_status()
    if not getattr(r, "from_cache", False):
        network_requests += 1
        time.sleep(1.0)  # be polite to the Knesset site
    return r.json()


ids = sorted(set(pq.read_table(PREPARED / "fact_ballots.parquet", columns=["member_id"]).column("member_id").to_pylist()))

# One bulk request covers every current and former MK.
photos = {}
lobby = get_json(f"{API}/MkLobby/GetMksPrevious", lang="he")
for row in (lobby.get("mkPrevious") or []) + (lobby.get("factionPrevious") or []):
    if row.get("MkId") is not None and row.get("ImgPath"):
        photos.setdefault(int(row["MkId"]), row["ImgPath"])

# Per-MK header endpoint only for the few the bulk list misses.
for mk_id in (i for i in ids if i not in photos):
    img = (get_json(f"{API}/MKs/GetMkdetailsHeader", mkId=mk_id, languageKey="he") or {}).get("MkImage")
    if img:
        photos[mk_id] = img

# Trust boundary: only official Knesset-hosted image URLs reach the site.
rows = [(i, photos[i]) for i in ids if isinstance(photos.get(i), str) and photos[i].startswith(OFFICIAL)]
with OUT.open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["member_id", "photo_url"])
    w.writerows(rows)

names = dict(zip(*pq.read_table(PREPARED / "dim_members.parquet", columns=["member_id", "member_name"]).to_pydict().values()))
have = {i for i, _ in rows}
print(f"photos: {len(rows)} of {len(ids)}")
print("missing:", [(i, names.get(i)) for i in ids if i not in have])
print("network requests:", network_requests)
