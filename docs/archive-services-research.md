# Web archive services: candidate research

Research pass for the `archive` lookup type (`backend/src/providers/archive/`), looking for
archival services beyond the five already registered (`wayback`, `archive-today`, `ghostarchive`,
`arquivo-pt`, `perma-cc`).

**All testing in this document was read-only.** No save/submission request was sent to any public
archive. Where a save endpoint is listed it is taken from the service's own documentation or from
a third-party client's source and is marked **unverified** — it was never called.

**No bot protection was bypassed, probed for weaknesses, or worked around.** Where a service
answered with a CAPTCHA, a Cloudflare challenge, an Anubis proof-of-work page or a "human
verification" interstitial, the probe stopped there and the service is recorded as blocked.

Live tests were run on 2026-09-30 from a German IP with
`User-Agent: Mozilla/5.0 (compatible; universal-lookup/1.0; +https://github.com/Bluscream/universal-lookup)`
against `https://example.com` as the target URL. Geography matters for some of these — a national
archive that times out from Germany may answer from its own country.

## Where the candidate list came from

Service names and endpoint shapes were gathered from these projects. **Only facts were taken** —
which services exist, and what URL shape each one answers on. No code was copied or translated
from any of them; this repository is now released under the Unlicense (public domain), which
cannot carry GPL/AGPL conditions, so every implementation here is written from the service's own
behaviour and documentation.

| Source | Licence | What was taken |
| :--- | :--- | :--- |
| [dessant/web-archives](https://github.com/dessant/web-archives) ("Web Archives" by Armin Sebastian, the addons.mozilla.org "View Page Archive" listing) | **GPL-3.0** | The engine table in `src/utils/data.js`: archive.org, archive.today (+ its full mirror-host list), Yandex, megalodon.jp, perma.cc, Ghostarchive, WebCite, **Software Heritage**. Facts only. |
| `archivenow` (ODU WS-DL) | MIT | Confirms the four-archive submission set: archive.org SPN, archive.today, megalodon.jp, perma.cc. Nothing new beyond the above. |
| Memento / RFC 7089 `application/link-format` timemap standard | — | The `/timemap/link/` convention that national archives share, which is why one parser covers several. |
| Common Crawl `collinfo.json` | public data | The per-crawl CDX API endpoints. |

`web-archives` also yielded the archive.today mirror-host list (`archive.is`, `archive.today`,
`archive.ph`, `archive.vn`, `archive.fo`, `archive.li`, `archive.md`) — useful as failover hosts
for the provider we already have, not as new services.

## Full candidate table

Ordered roughly by the ranking in the next section. "Standard" says whether it speaks something
this repo already parses.

| Service | Read endpoint | Save endpoint | Auth | Live result (observed) | Bot protection | Standard | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Estonian Web Archive** (`veebiarhiiv.digar.ee`) | `GET https://veebiarhiiv.digar.ee/a/timemap/link/<url>` | none published | none | **200** `application/link-format`, 152 936 bytes, real mementos of example.com back to 2010-10-23. Unknown URL → **404** `application/link-format`, 0 bytes | **none observed** | Memento `/timemap/link/` — parser exists (`archive-today.ts`) | **Implement (read-only)** |
| **Icelandic Web Archive** (`vefsafn.is`) | `GET https://vefsafn.is/timemap/link/<url>` | none published | none | **200** `application/link-format`, 352 286 bytes, **36.8 s**. Unknown URL → **404**, 0 bytes, 0.27 s. Two earlier attempts at a 25 s timeout **timed out** | **none observed** | Memento `/timemap/link/` — parser exists | **Implement (read-only)**, but slow; see note below |
| **Common Crawl** | `GET https://index.commoncrawl.org/<crawl-id>-index?url=<url>&output=json`; crawl list at `https://index.commoncrawl.org/collinfo.json` | n/a (not a submission archive) | none | `collinfo.json` **200** `application/json`. `CC-MAIN-2025-05-index` **200** `text/x-ndjson` with a real record. Newest index `CC-MAIN-2026-39-index` **504 Gateway Time-out** | **none observed** | CDX NDJSON — byte-identical in shape to what `arquivo.ts` parses | **Drop — no replay URL.** See reasoning below |
| **archive.today mirrors** (`archive.is`, `.vn`, `.fo`, `.li`, `.md`) | `GET https://archive.is/timemap/<url>` | CAPTCHA form | none | **200** `application/link-format`, 130 365 bytes — the `.is` host works identically to the `.ph` host we already use | none on `/timemap/` | Memento | **Already covered.** Worth keeping as failover hosts for the existing provider |
| **megalodon.jp** | `GET https://megalodon.jp/?url=<url>` → HTML result page, no API | `POST https://megalodon.jp/pc/get_simple/decide` (from `archivenow`) — **unverified, never called** | none | **200** `text/html`, 16 622 bytes, Japanese UI page | none observed on read | none — HTML scraping only | **Read-only, low priority.** No machine-readable read endpoint; `web-archives` drives it by clicking the DOM, which we cannot do server-side |
| **Software Heritage** | `GET https://archive.softwareheritage.org/api/1/origin/search/<q>/`, `/api/1/origin/<url>/visits/` | `POST /api/1/origin/save/<type>/url/<url>/` (token for some) | free token available | `/api/1/` root **200** JSON. But `/api/1/origin/search/…` and `/api/1/origin/…/visits/` both **200 with an Anubis interstitial** (`<title>Making sure you're not a bot!</title>`, `within.website` proof-of-work) | **yes — Anubis PoW challenge on the data routes** | its own REST JSON | **Drop.** Data routes are challenge-gated; not bypassing. Also archives *source repositories*, not arbitrary pages |
| **Library of Congress** (`webarchive.loc.gov`) | `GET /all/timemap/link/<url>` | n/a | none | **403** with `cf-mitigated: challenge`, `server: cloudflare`. Site root also **403** challenge | **yes — Cloudflare interactive challenge** | Memento | **Drop** |
| **Archive-It** (`wayback.archive-it.org`) | `GET /all/timemap/link/<url>`, `/all/cdx?url=` | n/a | none | **200** but body is a `Session Verification` interstitial, not a timemap — on both the timemap and the CDX route | **yes — session-verification interstitial** | Memento + CDX | **Drop** |
| **Stanford Web Archive** (`swap.stanford.edu`) | `GET /timemap/link/<url>` | n/a | none | **405**, body is a `Human Verification` page, `server: awselb/2.0` | **yes** | Memento | **Drop** |
| **UK Government Web Archive** (`webarchive.nationalarchives.gov.uk`) | `GET /ukgwa/timemap/link/<url>` | n/a | none | **405**, `Human Verification` page, `Server: CloudFront` | **yes** | Memento | **Drop** |
| **UK Web Archive** (`webarchive.org.uk`) | `GET /wayback/archive/timemap/link/<url>`, `/wayback/archive/cdx?url=` | n/a | none | **TLS failure** — `unable to get local issuer certificate`, on the timemap, the CDX route and the site root alike. Never reached HTTP | unknown (never got that far) | Memento + CDX | **Drop.** Incomplete certificate chain; we will not disable certificate verification to reach an archive |
| **National Library of Australia** (`webarchive.nla.gov.au`) | `GET /awa/timemap/link/<url>` | n/a | none | **307** → follows to `/.within.website/?redir=…`, **200** Anubis `Making sure you're not a bot!` page | **yes — Anubis PoW challenge** | Memento | **Drop** |
| **perma.cc** (already registered, key-gated) | `GET https://api.perma.cc/v1/public/archives/?url=` | `POST https://api.perma.cc/v1/archives/` | API key; free tier is limited | **403** `cf-mitigated: challenge` on both `api.perma.cc` and `perma.cc` root | **yes — Cloudflare challenge, newly** | its own REST JSON | **Regression on an existing provider** — see "Findings about providers we already have" |
| **Austrian Web Archive** (`webarchiv.onb.ac.at`) | unknown. Site is a JS SPA over a Spring backend at `/api/…` | n/a | likely onsite-only access | Root **200** SPA HTML. `/api/search?url=` and `?query=` → **400** JSON `Bad Request`. `/api/timemap/link/…` → **404** JSON | none observed — it answers cleanly, we just do not know the parameter names | none known | **Drop for now.** Reachable and unprotected, but the parameter shape is undocumented; the Austrian archive is also legally onsite-access-only, so replay URLs would likely not resolve publicly |
| **WebCite** (`webcitation.org`) | `GET /query?url=<url>` | submission closed since 2019 | none | **200**, but the body is a frameset stub (881 bytes). `/timemap/link/<url>` → **404**, `server: awselb/2.0` | none | none (no timemap) | **Drop — effectively defunct.** No machine-readable endpoint, no new submissions |
| **Memento TimeTravel aggregator** (`timetravel.mementoweb.org`) | `GET /timemap/link/<url>` | n/a | none | **NXDOMAIN** — `Could not resolve host` | n/a | Memento | **Drop — confirmed gone.** Matches the comment already in `arquivo.ts` |
| **MemGator** (`memgator.cs.odu.edu`) | `GET /timemap/link/<url>` | n/a | none | `/timemap/link/…` **timed out** after 25 s, twice. `/timemap/json/…` → **404** `404 page not found`, `server: nginx` — so the host is up, the aggregator route is not | none | Memento | **Drop.** Host answers but the aggregator is not serving. Self-hosting MemGator would be a separate project decision |
| **Google cache** | `GET https://webcache.googleusercontent.com/search?q=cache:<url>` | n/a | none | **302** → `consent.googleusercontent.com` consent wall | consent/bot wall | none | **Drop — discontinued** |
| **Bing cache** (`cc.bingj.com`) | `GET /cache.aspx?q=<url>` | n/a | none | **NXDOMAIN** — `Could not resolve host` | n/a | none | **Drop — gone** |
| **Yandex cache** | via yandex.com search results UI | n/a | none | Not probed. `web-archives` drives it entirely through the search-results DOM and contains an explicit check for `/showcaptcha` | **yes — CAPTCHA by the extension's own admission** | none | **Drop** |
| **Conifer** (`conifer.rhizome.org`) | `GET /api/v1/auth/curr_user` works; there is no public "is this URL archived" query | interactive capture sessions, account required | account | **200** `application/json`, issued an anonymous temp user | none observed | its own REST JSON | **Drop.** It is a personal capture tool, not a queryable public archive — there is no cross-user "who archived this URL" endpoint |
| **cachedview.nl** | `GET /` | n/a | none | **200** `text/html` | none | none | **Drop.** It is a front-end that redirects to Google/Wayback caches, not an archive with an API |
| **FreezePage** (`freezepage.com`) | `GET /` | account-gated form | account | **200** `text/html`, `server: cloudflare` | Cloudflare present, no challenge on the root | none | **Drop.** No API; saved pages are account-scoped and expire, so there is nothing to query |
| **archive.st** | unknown | unknown | unknown | Root **200**. `/api`, `/api?url=`, `/search?q=`, `/openapi.json`, `/docs` all → **404** `application/json` `{"detail":"No such archive"}` | none | none known | **Drop.** It clearly runs a JSON API (FastAPI-shaped 404s) but exposes no discoverable route and no documentation |
| **Arweave** (`arweave.net/graphql`) | GraphQL | paid, per-byte | wallet + AR tokens | **200**, but the URL now serves the "Atlas" GraphQL explorer UI, not a bare endpoint | none | none | **Drop.** Permanent storage, not a web archive: nothing indexes "is this URL archived", and saving costs money per byte |
| **Bibliotheca Alexandrina** (`web.archive.bibalex.org`) | `GET /web/timemap/link/<url>` | n/a | none | **Connection timed out** after 25 s | unknown | Memento | **Drop — unreachable** (unverified whether it is down or geo-blocked from here) |
| **Croatian Web Archive** (`haw.nsk.hr`) | unknown | n/a | none | **Connection timed out** after 25 s on the site root | unknown | unknown | **Drop — unreachable** |
| **Slovenian Web Archive** | `arhiv.spletni.nuk.uni-lj.si` → **NXDOMAIN**; `arhiv.nuk.uni-lj.si` → **timed out** after 25 s | n/a | none | unreachable both ways | unknown | unknown | **Drop — unreachable** |
| **BnF** (`archivesinternet.bnf.fr`) | — | n/a | onsite only | **NXDOMAIN** — `Could not resolve host` | n/a | n/a | **Drop.** The BnF internet archive is legally onsite-access-only; no public host |
| **PADICAT** (Catalonia) | `GET /wayback/timemap/link/<url>` | n/a | none | **301** → `http://padicat.cat/…` → **connection reset by peer**. Plain HTTP also reset | unknown | Memento (assumed) | **Drop — redirect loop into a reset connection** |
| **Web Archive Luxembourg** (`webarchive.lu`) | `GET /wayback/timemap/link/<url>` | n/a | none | **301** → **404**, and the body is an 82 KB WordPress page — there is no wayback deployment at that path | none | n/a | **Drop.** Endpoint guessed, not documented; **the read endpoint here was unverified guesswork and it was wrong** |
| **National Library of Singapore** | `GET https://eresources.nlb.gov.sg/webarchives/wayback/timemap/link/<url>` | n/a | none | **202 Accepted**, 0 bytes, `server: CloudFront` — an empty non-answer | unclear | Memento (assumed) | **Drop.** Never returned a body; endpoint shape unconfirmed |
| **Wikiwix** (`archive.wikiwix.com`) | `GET /cache/index2.php?url=<url>` | n/a | none | **200** `text/html`, 537 bytes — a JS SPA shell, not data. Same for `/cache/?url=` | none | none | **Drop for now.** The real data endpoint is behind the SPA's own XHR and was not identified; **unverified** |
| **National Library of Ireland** (`webarchive.nli.ie`) | — | n/a | none | **NXDOMAIN** | n/a | n/a | **Drop** |
| **Swiss** (`webarchiv.helveticarchives.ch`) | — | n/a | none | **NXDOMAIN** | n/a | n/a | **Drop** |

## Ranked shortlist

### 1. Estonian Web Archive — implement now

The single cleanest result of this pass.

```
$ curl https://veebiarhiiv.digar.ee/a/timemap/link/https://example.com/
200 application/link-format 152936 bytes
<https://veebiarhiiv.digar.ee/a/timemap/link/https://example.com/>; rel="self"; …,
<https://veebiarhiiv.digar.ee/a/https://example.com/>; rel="timegate",
<https://example.com/>; rel="original",
<https://veebiarhiiv.digar.ee/a/2010102…>; rel="first memento"; datetime="Sat, 23 Oct 2010 00:50:03 GMT", …
```

No key, no account, no bot protection, fast, and a correct `404` with an empty body for a URL it
has never seen — which is exactly the "this is an answer, not a failure" case the registry already
models. It is a plain RFC 7089 timemap, identical in form to the one `archive-today.ts` already
parses.

### 2. Icelandic Web Archive — implement, with a latency caveat

```
$ curl -m 60 https://vefsafn.is/timemap/link/https://example.com/
200 application/link-format 352286 bytes  (36.8 s)
$ curl -m 60 https://vefsafn.is/timemap/link/https://nonexistent-xyz-abc-999.example/
404 application/link-format 0 bytes  (0.27 s)
```

Also clean and unauthenticated, but **slow**: it timed out twice at a 25 s deadline before
succeeding at 60 s. `SERVER_TIMEOUT` defaults to 30 000 ms, so this provider will sometimes
time out — and that is fine, because a timeout produces a real `error` rather than a silent empty
answer. The 37 s figure is for `example.com`, which has an unusually large timemap; ordinary URLs
return far less. Implemented, with the slowness documented in the provider.

### 3. Common Crawl — deliberately **not** implemented

It is live, unauthenticated, unprotected, and emits the same NDJSON-per-line CDX that
`arquivo.ts` already parses — by every mechanical measure the easiest thing on this list to add.
It is excluded for a correctness reason:

**Common Crawl has no replay.** There is no URL at which a human can view the captured page. The
CDX record points into a multi-gigabyte WARC file on S3 by byte offset. The registry's
`ArchiveSnapshot` requires a `snapshot_url`, and every honest candidate for that field here is a
lie: the CDX query URL is not a snapshot, and the WARC filename is not something a browser can
open. Filling that field would mean shipping a link that does not show the archived page, which
is exactly the class of plausible-looking non-answer this codebase has been removing.

It would become worth adding the moment `ArchiveSnapshot` grows a way to say "this URL is in this
index, but there is nothing to show you" — a flag or a nullable `snapshot_url` with a mandatory
`note`. That is a types change and out of scope here.

Also note the newest crawl index (`CC-MAIN-2026-39-index`) returned **504 Gateway Time-out** while
`CC-MAIN-2025-05-index` answered fine, so any future implementation would have to pick a crawl
from `collinfo.json` and tolerate the newest one being unavailable.

### 4. archive.today mirror hosts — cheap robustness for an existing provider

`https://archive.is/timemap/<url>` returned **200** `application/link-format` (130 365 bytes),
behaving identically to the `archive.ph` host `archive-today.ts` currently hard-codes. The full
mirror set from `web-archives` is `archive.is`, `archive.today`, `archive.ph`, `archive.vn`,
`archive.fo`, `archive.li`, `archive.md`. Trying the next host on failure would make that provider
noticeably more reliable. Not done here — it changes an existing provider rather than adding one,
and belongs in its own change.

## Findings about providers we already have

Two things turned up that are not new services but do affect the current registry.

- **perma.cc is now behind a Cloudflare interactive challenge.** Both `https://perma.cc/` and
  `https://api.perma.cc/v1/public/archives/?url=…` answered **HTTP 403** with
  `cf-mitigated: challenge`. The `perma-cc` provider is marked unverified in the existing code;
  this is evidence that it cannot work from a server at all right now, key or no key, because the
  challenge sits in front of the API. Worth surfacing as a concrete error rather than leaving it
  as "key-gated, unverified".
- **The Wayback CDX endpoint is unreliable.** `https://web.archive.org/cdx/search/cdx?url=…`
  timed out at 25 s on three separate attempts. This does not affect us — `wayback.ts` uses the
  availability API, which answered fine every time — but it rules out CDX as a richer replacement
  for that provider's single-snapshot answer.

## Things I could not verify

Stated plainly, because a plausible-looking endpoint that was never called is worth exactly
nothing:

- **Every save endpoint in this document is unverified.** By design: submitting to a public
  archive is irreversible and this was a research pass. The megalodon.jp save endpoint
  (`POST /pc/get_simple/decide`) comes from `archivenow`'s source and was never called.
- **Austrian Web Archive** — the `/api/…` backend is reachable and answers structured JSON errors,
  so a working query almost certainly exists; the parameter names are undocumented and I did not
  find them.
- **Wikiwix** — responds 200 but serves an SPA shell; the underlying data request was not
  identified. The `index2.php?url=` endpoint is widely cited but did not return data to a plain
  client.
- **Luxembourg, Singapore, PADICAT** — the `/wayback/timemap/link/` paths I tried were inferred
  from the Memento convention, not from documentation. Luxembourg's returned a WordPress 404,
  proving the guess wrong; Singapore returned a bodyless 202; PADICAT reset the connection. None
  of these is evidence the archive lacks an API, only that I did not find it.
- **Bibliotheca Alexandrina, Croatia, Slovenia** — timed out or did not resolve from a German IP.
  Whether they are down, firewalled, or geo-restricted is unknown.
- **Yandex** was not probed at all; `web-archives` documents it as CAPTCHA-gated and driven only
  through browser DOM automation, which settles it without a request.

## Summary

33 candidates examined. Two are clean enough to implement — the **Estonian** and **Icelandic**
web archives, both unauthenticated RFC 7089 Memento timemaps that the existing timemap parser
covers. One more (**Common Crawl**) is technically clean but is excluded on honesty grounds
because it has no viewable snapshot URL. Everything else is behind bot protection, unreachable,
undocumented, or defunct.

The dominant reason for rejection was bot protection: Library of Congress, Archive-It, Stanford,
the UK Government Web Archive, the National Library of Australia, Software Heritage and perma.cc
are all now gated by Cloudflare challenges, Anubis proof-of-work, or session-verification
interstitials. Several of these were straightforwardly usable a few years ago. The trend is
against automated archive clients, and it is worth expecting the working set to keep shrinking.
