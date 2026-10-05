# 🔍 Universal Lookup

[![npm version](https://img.shields.io/npm/v/universal-lookup.svg)](https://www.npmjs.com/package/universal-lookup)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](https://unlicense.org/)
[![Docker Image Version](https://img.shields.io/docker/v/bluscream1/universal-lookup?label=docker)](https://hub.docker.com/r/bluscream1/universal-lookup)
[![Platforms](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-blue)](https://github.com/Bluscream/universal-lookup)

**Universal Lookup** is a high-performance intelligence service that aggregates multiple APIs for phone numbers, IP addresses, emails, locations, and parcels. It features smart response merging, multi-layered caching, and a premium web interface.

---

## 🌟 Features

- **🚀 Instant Execution**: Run via `npx` without any setup.
- **🔄 Multi-Provider Aggregation**: Merges results from dozens of sources (Tellows, MaxMind, Google, etc.).
- **📦 Multi-Arch Docker**: Native support for **ARM64 (Apple Silicon), ARMv7 (RPi), AMD64, and x86**.
- **⚡ Smart Caching**: Persistent SQLite storage with configurable TTL per data type.
- **🎨 Premium UI**: Modern dark-mode web interface for real-time lookups.
- **📖 OpenAPI 3.0**: Fully documented REST API with Swagger UI.
- **🏠 Unraid Ready**: Optimized for Unraid with Community Applications templates.

---

## 🚀 Quick Start

### 1. Using npx (Recommended)
Run the server instantly from any terminal:
```bash
npx universal-lookup
```
*Note: Ensure you have Node.js 20+ installed.*

### 2. Using Docker
Pull the multi-arch image from GitHub or Docker Hub:
```bash
# Using Docker Hub
docker run -d -p 24010:24010 --name lookup bluscream1/universal-lookup:latest

# Using GHCR
docker run -d -p 24010:24010 --name lookup ghcr.io/bluscream/universal-lookup:latest
```

### 3. Manual Installation
```bash
git clone https://github.com/Bluscream/universal-lookup.git
cd universal-lookup
npm install
npm run build
npm start
```

---

## 📡 API Endpoints

All endpoints are available at `http://localhost:24010/api/*`.

| Endpoint | Description | Example Query |
|----------|-------------|---------------|
| `GET /api/tel/:query` | Reverse phone lookup, spam rating | `+493012345678` |
| `GET /api/ip/:query` | IP intelligence, ping, traceroute, ports | `8.8.8.8` |
| `GET /api/domain/:query` | WHOIS, DNS records, subdomains | `example.com` |
| `GET /api/email/:query` | Email validation & risk | `user@example.com` |
| `GET /api/location/:query` | Geocoding, official warnings & current weather | `Berlin, Germany` |
| `GET /api/parcel/:query` | Package tracking | `00340434515310596216` |
| `GET /api/shipment/:query` | Shipment lookup by order | `702-1234567-1234567` |
| `GET /api/order/:query` | Order details (Amazon, AliExpress) | `702-1234567-1234567` |
| `GET /api/url/:query` | URL safety, metadata, reachability | `https://example.com` |
| `GET /api/shorten/:query` | Creates a short link on your YOURLS instance and the public shorteners. A write — never auto-detected, never a fallback. | `https://example.com` |
| `GET /api/steam/:query` | Steam profile, inventory, value | `76561198000000000` |
| `GET /api/apk/:query` | Android package metadata & mirrors | `com.spotify.music` |
| `GET /api/status/:query` | Service health across ~30 providers | `discord` |
| `GET /api/web/:query` | Web search across four engines | `what is my ip` |
| `GET /api/social/:query` | Linked accounts for one handle, each described by its own platform, plus recent chat | `@bleichi_loveless` |
| `GET /api/auto/:query` | Detects the type, then dispatches | anything |

> 📖 **Full Documentation**: Explore the interactive Swagger UI at [http://localhost:24010/docs](http://localhost:24010/docs).

---

## ⚙️ Configuration

Copy `.env.example` to `.env` to customize the service.

### Server & Security
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `24011` | Backend API port. The container also serves the frontend on 24010, which proxies `/api` and `/docs` to this one — so publishing 24010 alone is enough. |
| `HOST` | `0.0.0.0` | Binding address |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `REQUIRE_TOKEN` | `null` | If set, requires `?token=` for all API calls |
| `RATE_LIMIT_MAX` | `100` | Max requests per time window |
| `RATE_LIMIT_WINDOW`| `1 minute` | Rate limit time window |

### Cache & Performance
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `./data/cache.db` | Path to SQLite database |
| `CACHE_TTL` | `86400` | Default cache duration (seconds) |
| `CACHE_TTL_PARCEL`| `3600` | Cache duration for parcels (seconds) |
| `CLIENT_TIMEOUT` | `5000` | How long a request waits before returning what is ready (ms) |
| `SERVER_TIMEOUT` | `30000` | How long providers keep working in the background (ms) |
| `PUPPETEER_TIMEOUT`| `10000` | Max wait time for headless browser (ms) |

### API Keys (Optional)
| Variable | Description |
|----------|-------------|
| `IP_API_COM_KEY` | Commercial key for ip-api.com |
| `IP_API_IO_KEY` | API key for ip-api.io features |
| `TELLOWS_API_KEY` | Partner key for Tellows |
| `MAXMIND_LICENSE_KEY` | License for GeoLite2 downloads |
| `GOOGLE_API_KEY` | Key for Google Maps & Search API |
| `GOOGLE_SEARCH_CX`| Google Custom Search Engine ID |
| `PARCELSAPP_API_KEY` | Key for ParcelsApp tracking |
| `DHL_API_KEY` | Key for official DHL API |
| `YOURLS_API_URL` | Your own YOURLS instance's `yourls-api.php`. Without it the `/shorten` lookup uses only the public shorteners. |
| `YOURLS_SIGNATURE` | YOURLS passwordless signature token (preferred). `YOURLS_USERNAME` + `YOURLS_PASSWORD` are the alternative. |

### Integration Settings
| Variable | Default | Description |
|----------|---------|-------------|
| `FRITZBOX_HOST` | `fritz.box` | FritzBox address for phone lookups |
| `PHONE_COUNTRY_PREFIX`| `0049` | Default country code |
| `PHONE_LOCAL_PREFIX`| `null` | Default local area code |
| `UNIVERSAL_RESULTS_LIMIT`| `3` | Max results shown per provider |
| `PUPPETEER_SKIP_DOWNLOAD`| `false` | Skip downloading Chromium |

### Social Lookup

`GET /api/social/:query` takes one account — `@bleichi_loveless`, a bare handle,
a channel id or a pasted profile URL — and answers with every account linked to
it. It runs in two stages: identity sources say *which* accounts exist, then
each platform is asked what its own account looks like.

**Discovery** is a fallback chain, and needs no credentials at all. Each rung is
tried only when the ones above it found nothing — a rung that *errors* does not
end the chain, because "Keybase is down" is not "Keybase says no":

1. **Synchra** — this deployment's own channels, and the only source for chat.
2. **Keybase** — free and unauthenticated.
3. **Harbor** — signed claims.
4. **The handle, taken literally**, on every platform that can be read.
5. **Each platform's own search**, first hit — only with `SOCIAL_DIRECT_SEARCH`.

Rungs 4 and 5 answer a weaker question than the first three. They report that a
handle *exists* somewhere, not that anyone linked it to the query, and two
unrelated people routinely hold the same handle on two platforms — so those
accounts carry an empty `verified_by` and a `metrics.match` of `exact-handle` or
`search-result`, against `claimed` for the rest.

Stopping early costs breadth, measurably: `Bluscream` returns 10 accounts when
all three sources are merged, because Keybase and Synchra each know 5 and
overlap only partly, but 5 when Synchra answers first. Set `SOCIAL_CASCADE=false`
to query every source at once and merge.

The sources themselves:

| Source | Covers | Notes |
|--------|--------|-------|
| [Harbor](https://harbor.social) / Polycentric | x, youtube, github, discord, hacker-news, rumble, twitch, website | Signed claims, filtered against a pinned verifier identity |
| [Keybase](https://keybase.io) | twitter, github, reddit, hackernews, facebook, coinbase, dns, web | Real proofs, but frozen since 2020 — a miss means nothing |
| Synchra | twitch, youtube, kick, rumble, discord, x, tiktok, spotify | Finds a channel by its own name **or** by a handle on any platform it connected. Also the only source for `recent_chat`. |

**Enrichment** reads each platform directly. `instagram-profile` and
`threads-profile` are a different shape from the rest: neither platform has an
API route to an arbitrary public handle any more — Instagram's Basic Display API
was shut off in December 2024 and Threads' `profile_lookup` is App-Review-gated
to Meta's own accounts — so both read the profile page's **Open Graph tags**, the
same bytes a chat client fetches to draw a link preview. That needs no
credentials, no app review and no user's session cookie, and the counts come back
as the platform rounds them for display, flagged `counts_are_rounded`.

TikTok is deliberately *not* read this way. It serves those tags only to an
allowlist of named crawlers — `facebookexternalhit` gets them, an honest agent
gets nothing, Googlebot gets 403 — and claiming to be Facebook's crawler is not
something this project will do.

`github-user` and `hackernews-user`
work anonymously; `youtube-channel`, `twitch-channel` and `reddit-user` need a
key, and without one the account is still returned, just undescribed. The same
readers serve rungs 4 and 5 — though only GitHub, Twitch and YouTube offer a
search, so Reddit and Hacker News take part in rung 4 and not rung 5.

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNCHRA_TOKEN` | `null` | Needed to *find* a channel at all (`channel:read`) — by its own name, or by a handle on any platform it has connected. Reading a channel's providers and chat is public, so without a token the Synchra source only answers for a channel uuid. |
| `SYNCHRA_BASE_URL` | `null` | Self-hosted or staging Synchra only |
| `TWITCH_CLIENT_ID` | `null` | Twitch **app** credentials, not a user login. Follower counts have needed the broadcaster's own token since 2023 and are never available here. |
| `TWITCH_CLIENT_SECRET` | `null` | Paired with the client id |
| `REDDIT_CLIENT_ID` | `null` | Reddit **app** credentials (type "script"). Reddit closed its anonymous JSON endpoints in 2026 — every unauthenticated route 403s — so Reddit accounts are returned undescribed without these. |
| `REDDIT_CLIENT_SECRET` | `null` | Paired with the client id |
| `GOOGLE_API_KEY` | `null` | Reused for YouTube — the key needs **YouTube Data API v3** enabled, which a search-only key does not have |
| `GITHUB_TOKEN` | `null` | Reused; optional, raises the rate limit from 60/h to 5000/h |
| `SOCIAL_ENRICH_LIMIT` | `12` | How many accounts get read from their platform. The rest are returned unenriched. |
| `SOCIAL_CHAT_LIMIT` | `25` | Recent chat messages carried back from Synchra |
| `SOCIAL_CASCADE` | `true` | Stop at the first source that finds anything. `false` queries all three and merges — slower, broader. |
| `SOCIAL_DIRECT_SEARCH` | `false` | Run rung 5, each platform's own user search. Off by default: a fuzzy name match is not evidence, and YouTube's search costs 100 quota units against a daily 10,000. |
| `SOCIAL_DETAILS` | `false` | Run the sub-providers. Off by default: it multiplies requests (Twitch 3 calls per channel, YouTube 3, GitHub 2). |
| `SOCIAL_DETAIL_LIMIT` | `5` | Items per sub-provider per account. A recent-activity sample, not an archive. |

**Sub-providers** are a third stage, off by default. Once an account has been
*confirmed* by its platform, a sub-provider reads what it has actually been
publishing — and only confirmed accounts, never unverified claims, because
spending three Twitch requests on a handle that may be dead is how a lookup gets
slow for no answer.

| Sub-provider | Reads |
|--------------|-------|
| `youtube-uploads` | Recent uploads with views, likes and duration, plus the uploads playlist id. Via the uploads playlist (1 quota unit), never `search` (100). |
| `twitch-videos` | Past broadcasts and top clips; the stream schedule under `details`. |
| `github-repos` | Repositories by last push, with stars, language and topics; organisations under `details`. |
| `reddit-activity` | Recent posts and comments, with score and subreddit. |
| `hackernews-activity` | Recent stories and comments via Algolia, with points. |

Everything lands as `accounts.<platform>[].activity`: one uniform entry shape —
`kind`, `title`, `url`, `time`, `views`, `score`, `duration` — whatever the
platform called it, newest first across every sub-provider. A video, a
repository and a comment are all "a thing this account put out, at a time, with
a score", and keeping them uniform is what lets one list render them all.
Genuinely platform-shaped things that are *not* published items — a stream
schedule, a list of organisations — go in `details` under the sub-provider that
read them.

Each sub-provider is an ordinary provider: individually switchable through
`PROVIDERS_BLACKLIST`, individually reported in `errors`, and individually
exercised by the live probe. A YouTube quota error does not cost the caller the
GitHub repositories read a moment earlier.

Each account says where it came from, and that distinction is the point:
`sources` lists who *claimed* the link, `verified_by` lists who cryptographically
*vouched* for it (empty means self-asserted, which is not the same as false), and
`enriched_by` names the platform reader that confirmed the account currently
exists. An account claimed by two sources is reported once, with both listed.

---

## 🛠️ Development & Deployment

The project includes a robust automation script for contributors:

```powershell
# Run QA, bump version, push to Git, build Docker (all archs), and publish to npm
.\scripts\update.ps1 -Bump patch
```

---

## 📜 License

Released into the **public domain** under the [Unlicense](https://unlicense.org/). See `LICENSE` for more information.

### Credits & Contributions
- **Lead Developer**: [Bluscream](https://github.com/Bluscream)
- **AI Coding Assistant**: [Antigravity](https://gemini.google.com/advanced) (Google DeepMind)

---

> [!NOTE]
> **AI Disclaimer**: Parts of this codebase, including core logic, documentation, and deployment scripts, were generated or optimized using Advanced Agentic AI. While thoroughly tested, users are encouraged to review critical components for their specific use cases.
